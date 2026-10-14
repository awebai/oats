// How the end-to-end tests of `oats tui` compare a terminal's line settings
// (test/tui-terminal.test.mjs, test/tui-open-terminal.test.mjs): `stty -g`, read in the pane's own
// shell, through comparableStty below. One copy for both files.

/** A `stty -g` line as the terminal tests compare it: the line itself, but for one bit of
 *  macOS's `lflag`. That bit, 0x20000000, is PENDIN, and it is state of the terminal driver, not a setting: the
 *  driver sets it when the terminal goes canonical and clears it when something reads or watches
 *  the terminal. It changes with no TUI running, in both directions, and no program can put it
 *  back (the control's output: awebai/oats#935, comment 6108614331). So it is cleared here, where a
 *  line is read, and every comparison is of everything else.
 *  Only macOS's format is touched (`gfmt1:cflag=...:lflag=<hex>:...`), and its `lflag` is found by
 *  name. A Linux line (hex fields with no names) is returned as it is; so is a macOS line whose
 *  `lflag` is missing, written twice or not hex, which then fails its comparison as it stands. */
export const PENDIN = 0x20000000n;
export function comparableStty(line) {
  const fields = line.split(":");
  if (fields[0] !== "gfmt1") return line;
  const at = fields.flatMap((field, i) => (field.startsWith("lflag=") ? [i] : []));
  const hex = at.length === 1 ? fields[at[0]].slice("lflag=".length) : "";
  if (!/^[0-9a-f]+$/i.test(hex)) return line;
  const lflag = BigInt(`0x${hex}`);
  if ((lflag & PENDIN) === 0n) return line;
  fields[at[0]] = `lflag=${(lflag & ~PENDIN).toString(16)}`;
  return fields.join(":");
}
