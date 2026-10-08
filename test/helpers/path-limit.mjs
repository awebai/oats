// The longest path a host opens. Linux opens 4095 characters (PATH_MAX 4096), macOS 1023 (PATH_MAX
// 1024), whatever each component's length (at most NAME_MAX, 255). A fixture that needs a longer path
// cannot be built on a host below it: a deployment spelled through links, or a long branch, which Git
// stores as a file under refs/heads/ (and logs/refs/heads/). Such a test skips there, naming the limit,
// and asserts nothing weaker where it runs.
import { lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** null when this host opens a path of `length` characters, probed in `dir`; else why not, as a skip reason. */
export function pathLimitSkip(length, dir) {
  const probe = mkdtempSync(join(dir, ".path-limit-"));
  try {
    // A file spelled through links to "." in its own directory, each "/<link>" of 2 to 251 characters.
    let need = length - probe.length - "/f".length;
    const file = need === 1 ? "ff" : "f";
    if (need === 1) need = 0;
    writeFileSync(join(probe, file), "");
    const links = [];
    while (need > 0) {
      const segment = need > 251 ? (need - 251 < 2 ? 249 : 251) : need;
      const name = "l".repeat(segment - 1);
      try { lstatSync(join(probe, name)); } catch { symlinkSync(".", join(probe, name)); }
      links.push(name);
      need -= segment;
    }
    const path = [probe, ...links, file].join("/");
    try { lstatSync(path); return null; } catch (e) {
      if (e.code !== "ENAMETOOLONG") throw e;
      return `this host does not open a path of ${path.length} characters (ENAMETOOLONG: its PATH_MAX is lower), which this fixture needs`;
    }
  } finally { rmSync(probe, { recursive: true, force: true }); }
}
