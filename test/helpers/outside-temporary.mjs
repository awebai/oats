// A fixture base outside every temporary directory, for the tests of the auto-add of this computer's
// deployments: it never lists a deployment under one (awebai/oats#1397, lib/deployments.mjs
// underTemporaryDirectory), so a fixture there would test that skip and nothing else.
//
// The base is a mkdtemp'd directory of /var/tmp (on macOS /private/var/tmp: under neither /tmp nor
// /var/folders), mode 0700, removed when the test ends, failed or not. Its name starts with
// OUTSIDE_TEMPORARY_PREFIX and, under the root run, names the run and the file
// (`<prefix><ot-XXXXXX>.<n>-`): the run reads /var/tmp for its own when it has ended and fails
// naming the file that left one (scripts/run-tests.mjs, awebai/oats#1025). Where /var/tmp is
// missing, not writable, or itself under a temporary directory, outsideTemporaryUnavailable() says
// why and such a test skips: it never falls back to /tmp, where it would pass for the wrong reason.
import { accessSync, chmodSync, constants, existsSync, lstatSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { underTemporaryDirectory } from "../../lib/deployments.mjs";

// scripts/run-tests.mjs holds a copy of these two names: change them together.
export const OUTSIDE_TEMPORARY_PARENT = "/var/tmp";
export const OUTSIDE_TEMPORARY_PREFIX = "oats-deployments-test-";

/** Why no base outside the temporary directories can be made here, or null when one can. */
export function outsideTemporaryUnavailable() {
  const why = `needs a writable ${OUTSIDE_TEMPORARY_PARENT} outside the temporary directories (the auto-add skips those, awebai/oats#1397)`;
  try {
    if (!statSync(OUTSIDE_TEMPORARY_PARENT).isDirectory()) return `${why}: it is not a directory`;
    accessSync(OUTSIDE_TEMPORARY_PARENT, constants.W_OK | constants.X_OK);
    if (underTemporaryDirectory(realpathSync.native(OUTSIDE_TEMPORARY_PARENT))) return `${why}: it is ${realpathSync.native(OUTSIDE_TEMPORARY_PARENT)}`;
  } catch (e) { return `${why}: ${e.code ?? e.message}`; }
  return null;
}

/** The run and the file this process is, as the root run names them (scripts/test-file-tmpdir.mjs:
 *  TMPDIR is `<run>/ot-XXXXXX/<n>` with `<n>.file` beside it), or "" outside it. */
function runTag() {
  const dir = tmpdir();
  return /[/\\]ot-[^/\\]+[/\\]\d+$/.test(dir) && existsSync(`${dir}.file`) ? `${basename(dirname(dir))}.${basename(dir)}-` : "";
}

/** Remove `base` whatever a test left of its permissions: every directory under it is made
 *  writable again first (a test that failed while a directory was read-only included). */
export function removeOutsideBase(base) {
  const writable = (p) => {
    try { if (!lstatSync(p).isDirectory()) return; chmodSync(p, 0o700); for (const entry of readdirSync(p)) writable(join(p, entry)); } catch { /* gone */ }
  };
  writable(base);
  rmSync(base, { recursive: true, force: true });
}

/** A new base outside the temporary directories, as its realpath, removed after `t` by the one hook
 *  this registers (removeOutsideBase): the caller registers no removal of its own. */
export function outsideTemporaryBase(t) {
  const base = realpathSync(mkdtempSync(join(OUTSIDE_TEMPORARY_PARENT, `${OUTSIDE_TEMPORARY_PREFIX}${runTag()}`)));
  t.after(() => removeOutsideBase(base));
  if ((statSync(base).mode & 0o777) !== 0o700) throw new Error(`${base} is not 0700`);
  return base;
}
