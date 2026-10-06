/* oats desktop — copies from the terminal reach the clipboard (#520, #672).

   A drag in a terminal tab is xterm's own selection (terminal-mouse.mjs keeps the buttons from tmux),
   copied by ⌘C / Edit › Copy, right-click › Copy, or the terminal.copySelection action, which writes
   it with copyTerminalSelection below. OSC 52 is still how tmux's own copies arrive: a copy made in
   copy mode from the keyboard, or by an older remote whose viewer still gives tmux the drag. tmux,
   with its default `set-clipboard external`, sends the text to the terminal as OSC 52
   (`ESC ] 52 ; <selection> ; <base64> BEL`), and attachClipboardWrite writes it to the clipboard.

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

/** Copy the terminal's selection: `write(text)` gets exactly what xterm selected, and a refused write
 * goes to `onError(error)`. With nothing selected nothing is written, and nothing reaches the pty.
 * Returns whether there was a selection to copy. */
export function copyTerminalSelection(term, write, onError = () => {}) {
  if (!term?.hasSelection?.()) return false;
  const text = term.getSelection();
  if (!text) return false;
  writeText(write, text, onError);
  return true;
}
