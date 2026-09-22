/** Best-effort credential redaction for the explicitly approved *live gh output*
 * exception. Not a claim that arbitrary output of a defective binary is safe.
 * No token is ever requested; all OSC/DCS/APC/PM strings are discarded. */
export function createAuthOutputFilter() {
  let mode = 'text', sequence = '', word = '', styles = '', oversized = false;
  const flush = () => {
    const value = oversized ? '[redacted oversized output]' : word
      .replace(/(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]*/g, '[redacted]')
      .replace(/\b[a-fA-F0-9]{40}\b/g, '[redacted]');
    const out = value + styles; word = ''; styles = ''; oversized = false; return out;
  };
  function feed(input) {
    let out = '';
    for (const char of String(input)) {
      if (mode === 'string') {
        if (char === '\x07' || char === '\x9c') mode = 'text';
        else if (char === '\x1b') mode = 'stringEscape';
        continue;
      }
      if (mode === 'stringEscape') { mode = char === '\\' ? 'text' : char === '\x1b' ? 'stringEscape' : 'string'; continue; }
      if (mode === 'escape') {
        if (char === '[') { mode = 'csi'; sequence = '\x1b['; }
        else if ([']', 'P', '_', '^', 'X'].includes(char)) mode = 'string';
        else mode = 'text';
        continue;
      }
      if (mode === 'csi') {
        sequence += char;
        if (/[\x40-\x7e]/.test(char)) {
          if (/^\x1b\[[0-9;]{0,40}[mABCDEFGHJKSTf]$/.test(sequence) || /^\x1b\[\?25[hl]$/.test(sequence)) {
            if (word || oversized) { if (styles.length < 4096) styles += sequence; }
            else out += sequence;
          }
          mode = 'text'; sequence = '';
        } else if (sequence.length > 48) { mode = 'text'; sequence = ''; }
        continue;
      }
      if (char === '\x1b') { mode = 'escape'; continue; }
      // C1 terminal control strings have the same authority as their ESC forms.
      if (['\x90', '\x9d', '\x9e', '\x9f'].includes(char)) { mode = 'string'; continue; }
      if (char === '\x9b') { mode = 'csi'; sequence = '\x1b['; continue; }
      if (char === '\b') { word = word.slice(0, -1); continue; }
      if (/[A-Za-z0-9_]/.test(char)) {
        if (!oversized) {
          if (word.length === 4096) { word = ''; oversized = true; }
          else word += char;
        }
      } else if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(char)) {
        // Invisible separators must not split a credential into visible pieces.
      } else out += flush() + char;
    }
    return out;
  }
  return { feed, end() { mode = 'text'; sequence = ''; return flush(); } };
}
