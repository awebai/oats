/* oats desktop — copies from the terminal reach the clipboard (#520, #672).

   A drag in a terminal tab is xterm's own selection (terminal-mouse.mjs keeps the buttons from tmux),
   copied by ⌘C / Edit › Copy, right-click › Copy, or the terminal.copySelection action, which writes
   it with copyTerminalSelection below. No drag from a Desktop tab reaches tmux, whatever the remote's
   version: the renderer consumes the tracking requests. OSC 52 is how tmux's own copies arrive: a
   copy made in copy mode from the keyboard, or a drag after the mixed-sequence fallback has handed
   tracking to xterm (terminal-mouse.mjs). tmux, with its default `set-clipboard external`, sends the text to the terminal as OSC 52
   (`ESC ] 52 ; <selection> ; <base64> BEL`), and attachClipboardWrite writes it to the clipboard.

   Every copy of a selection trims the spaces and tabs at the end of each line (trimLineEnds), as
   Ghostty, kitty and VTE do: tmux redraws copy mode with written spaces, which xterm keeps in a
   selection, so a copy from scrollback would be padded to the pane's width. ⌘C / Edit › Copy and
   right-click › Copy both reach the xterm textarea's `copy` event, which attachSelectionCopy takes
   first; terminal.copySelection trims the same way.

   Write-only: a clipboard query (`?`) is consumed and never answered, so nothing on the other side of
   the terminal can read the clipboard. A clear request, a malformed or an oversized one writes nothing.
   Programs inside the panes cannot reach this: tmux sends only its own copies (set-clipboard external).

   Pure: no node: imports. */

/** The largest decoded text written (bytes). */
export const OSC52_MAX_BYTES = 1 << 20;
const SELECTION = /^[cpqs0-7]*$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The text an OSC 52 payload (`<selection>;<base64>`) asks to copy, or null when it writes nothing. */
export function osc52Text(data) {
  if (typeof data !== 'string') return null;
  const split = data.indexOf(';');
  if (split < 0) return null;
  const selection = data.slice(0, split), payload = data.slice(split + 1);
  if (!SELECTION.test(selection) || !payload || payload === '?' || !BASE64.test(payload) || payload.length % 4 !== 0) return null;
  if (payload.length / 4 * 3 > OSC52_MAX_BYTES + 2) return null;
  let bytes;
  try { bytes = Uint8Array.from(atob(payload), c => c.charCodeAt(0)); } catch { return null; }
  if (!bytes.length || bytes.length > OSC52_MAX_BYTES) return null;
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return null; }
}

// A write the clipboard refused is reported once to `onError(error)`, never thrown or left unhandled.
function writeText(write, text, onError) {
  let written;
  try { written = Promise.resolve(write(text)); } catch (error) { written = Promise.reject(error); }
  written.catch(error => { try { onError(error); } catch { /* reporting must not throw */ } });
}

/** Handle OSC 52 on an xterm terminal: each copy is passed to `write(text)` (the clipboard), and a write
 * the clipboard refuses to `onError(error)`; every OSC 52 is consumed. Returns the registration
 * (dispose() removes it). */
export function attachClipboardWrite(term, write, onError = () => {}) {
  return term.parser.registerOscHandler(52, data => {
    const text = osc52Text(data);
    if (text !== null) writeText(write, text, onError);
    return true;
  });
}

/** `text` without the spaces and tabs that end each of its lines. Leading and inner whitespace, line
 * breaks and their style (\n or \r\n) stay as they are; a line of only whitespace becomes empty. */
export function trimLineEnds(text) {
  return String(text).replace(/[ \t]+(?=\r?\n|$)/g, '');
}

/** Copy the terminal's selection: `write(text)` gets what xterm selected, its line ends trimmed, and a
 * refused write goes to `onError(error)`. With nothing selected nothing is written, and nothing reaches
 * the pty. Returns whether there was a selection to copy. */
export function copyTerminalSelection(term, write, onError = () => {}) {
  if (!term?.hasSelection?.()) return false;
  const text = term.getSelection();
  if (!text) return false;
  writeText(write, trimLineEnds(text), onError);
  return true;
}

/** ⌘C / Edit › Copy and right-click › Copy put the selection on the clipboard trimmed. xterm's own `copy`
 * listener (on its element, bubble phase) would write it untrimmed, so this one listens on an ancestor
 * (`target`, the tab's wrap) in the capture phase and, when there is a selection, sets the data and stops
 * the event there. With no selection the event is left alone. Returns { dispose() }. */
export function attachSelectionCopy(term, target) {
  const onCopy = event => {
    if (!term.hasSelection() || !event.clipboardData) return;
    event.clipboardData.setData('text/plain', trimLineEnds(term.getSelection()));
    event.preventDefault();
    event.stopPropagation();
  };
  target.addEventListener('copy', onCopy, true);
  return { dispose: () => target.removeEventListener('copy', onCopy, true) };
}

/** Linux's primary selection, which middle-click pastes, trimmed like every copy. On Linux xterm puts a mouse
 * selection in its textarea and selects it there, which is what makes it the primary selection. When the
 * selection settles (onSelectionChange), and the textarea holds exactly xterm's copy of it, this puts the
 * trimmed text there instead and selects it again. Anything else in the textarea (typed or composed text, a
 * selection not made with the mouse, another platform) is left alone. Returns the subscription. */
export function attachPrimarySelectionTrim(term) {
  return term.onSelectionChange(() => {
    const area = term.textarea;
    if (!area || !term.hasSelection()) return;
    const text = term.getSelection();
    if (area.value !== text) return;
    const trimmed = trimLineEnds(text);
    if (trimmed === text) return;
    area.value = trimmed;
    area.select();
  });
}
