// The shipped host theme reader against the real file system (#602). Run as a
// child, with a deadline, by test/host-theme-main.test.mjs: a reader that waits
// for a FIFO's writer blocks this process, never the suite.
//
//   node read-real-fs.mjs <an empty directory>
//
// Each case gets a `current/` of its own under that directory, and nothing is
// written anywhere else. One JSON line is printed per step, as it happens, so
// the output of a child that was killed says how far it got.
import { execFileSync } from "node:child_process";
import { closeSync, copyFileSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, renameSync, statSync, symlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readOmarchyTheme } from "../../../host-theme.mjs";

const root = process.argv[2];
if (!root) { process.stderr.write("usage: node read-real-fs.mjs <an empty directory>\n"); process.exit(2); }

/** The functions main hands the reader, less the watch. */
const real = { statSync, fstatSync, openSync, readSync, closeSync };
const tokyoNight = fileURLToPath(new URL("./tokyo-night.toml", import.meta.url));
const say = line => writeSync(1, `${JSON.stringify(line)}\n`);
/** The colours path of a case, under a `current/` of its own with an empty `theme/`. */
function coloursPath(name) {
  const theme = join(root, name, "theme");
  mkdirSync(theme, { recursive: true });
  return join(theme, "colors.toml");
}
const read = (name, fs = real) => say({ case: name, result: readOmarchyTheme(fs, join(root, name)) });

copyFileSync(tokyoNight, coloursPath("regular"));
read("regular");

symlinkSync(join(root, "regular", "theme", "colors.toml"), coloursPath("symlink"));
read("symlink");

// The swap: the path names a regular file until the reader opens it. The FIFO
// is made beforehand and moved over the file in one step, just before the real
// open, which gets the reader's own arguments unchanged.
const swapped = coloursPath("swap"), fifo = join(root, "swap", "fifo");
copyFileSync(tokyoNight, swapped);
execFileSync("mkfifo", [fifo]);
read("swap", { ...real, openSync(path, ...rest) {
  const before = lstatSync(path).isFile();
  renameSync(fifo, path);
  say({ case: "swap", replaced: path === swapped && before && lstatSync(path).isFIFO() });
  return openSync(path, ...rest);
} });

execFileSync("mkfifo", [coloursPath("fifo")]);
read("fifo");

mkdirSync(coloursPath("directory"));
read("directory");

symlinkSync(join(root, "nowhere"), coloursPath("dangling"));
read("dangling");
