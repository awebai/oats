/** #982: what each place that shows a source's text is asked, the same in every view's test.
 * `SPEAKERS` is each speaker's lead in the Desktop's terms; `shown(text)` is one case per mark a row can
 * carry, with the line the place must show; `HOSTILE` is text that must stay text or be withheld. */
export const SPEAKERS = Object.freeze({ kernel: "OATS says:", "terminal-probe": "Desktop's terminal check says:", "roster-read": "Desktop's read of other machines says:" });
export const HERDR = "E_HERDR_REMOVED: Herdr is no longer supported by OATS (removed in 0.31.0); tmux is the only session backend.";
export const MARKUP = "<b>bold</b><script>x()</script>";
export const CONTROL = "gone\u001b[2Jagain";
export const DETAIL_WITHHELD = "[Detail withheld]";
/** `[origin, line]` for each of the three speakers, then for no mark and for a value that is not one. */
export const shown = (text) => [
  ...Object.entries(SPEAKERS).map(([origin, lead]) => [origin, `${lead} ${text}`]),
  [undefined, text], ["server-probe", text],
];
