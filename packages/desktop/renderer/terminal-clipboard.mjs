/* oats desktop — copies from the terminal reach the clipboard (#520).

   An agent's terminal is a tmux client with tmux's mouse on, so a drag is a tmux copy-mode selection
   (tmux-target.mjs binds it in the viewer's locked table). On release tmux copies it and, with its
   default `set-clipboard external`, sends the text to the terminal as OSC 52
   (`ESC ] 52 ; <selection> ; <base64> BEL`). This handler writes that text to the system clipboard.

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

/** Handle OSC 52 on an xterm terminal: each copy is passed to `write(text)` (the clipboard); every OSC 52
 * is consumed. Returns the registration (dispose() removes it). */
export function attachClipboardWrite(term, write) {
  return term.parser.registerOscHandler(52, data => {
    const text = osc52Text(data);
    if (text !== null) {
      try { Promise.resolve(write(text)).catch(() => {}); } catch { /* the clipboard refused: nothing to undo */ }
    }
    return true;
  });
}
