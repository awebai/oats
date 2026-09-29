/** lib/local-inputs.mjs (spec Addendum 4): a no-op until activated, then a 24-hex digest of the local
 *  configuration inputs recorded — canonical paths (a symlinked directory is one input), the first bytes
 *  recorded for a path win, absent differs from present, and the revision names no path or content. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLocalInputs, localRevision, recordLocalInput } from "../lib/local-inputs.mjs";

const base = mkdtempSync(join(tmpdir(), "oats-local-inputs-"));
test.after(() => rmSync(base, { recursive: true, force: true }));

test("inactive: recording does nothing and there is no revision", () => {
  recordLocalInput(join(base, "a.yaml"), "x");
  assert.equal(localRevision(), null);
});

test("active: the empty set, then a stable digest of what was recorded; first bytes win; absent differs; symlinks canonicalised", () => {
  activateLocalInputs();
  const empty = localRevision();
  assert.match(empty, /^[0-9a-f]{24}$/);
  const real = join(base, "real"), link = join(base, "link");
  mkdirSync(real);
  symlinkSync(real, link);
  writeFileSync(join(real, "oats-local.yaml"), "schemaVersion: 2\n");
  recordLocalInput(join(link, "oats-local.yaml"), "schemaVersion: 2\n");
  const one = localRevision();
  assert.notEqual(one, empty);
  recordLocalInput(join(real, "oats-local.yaml"), "changed later in the command\n"); // the same file: first bytes win
  assert.equal(localRevision(), one, "one canonical input, its first bytes");
  recordLocalInput(join(real, "oats-lock.json"), null);
  const withAbsent = localRevision();
  assert.notEqual(withAbsent, one, "an absent input counts");
  recordLocalInput(join(link, "oats-lock.json"), "{}"); // already recorded (absent) through the real path
  assert.equal(localRevision(), withAbsent);
  assert.ok(!localRevision().includes("real") && !/[^0-9a-f]/.test(localRevision()));
});
