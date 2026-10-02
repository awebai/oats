// Native picker starting directories (awebai/oats#460): the pure decision
// main.mjs passes as showOpenDialog's defaultPath.
import test from "node:test";
import assert from "node:assert/strict";
import { pickerDefaultPath, workspacePickerCandidates, cliPickerCandidates } from "../picker-default-path.mjs";

const HOME = "/Users/juan";
const existing = (...dirs) => (dir) => dirs.includes(dir);

test("workspace picker opens in the parent of the most recently added workspace", () => {
  const candidates = workspacePickerCandidates({
    recents: ["/Users/juan/Agents/team-b", "/Users/juan/work/team-a"],
    open: ["/Users/juan/work/team-a", "/Users/juan/Agents/team-b"],
  });
  assert.equal(candidates[0], "/Users/juan/Agents");
  assert.equal(pickerDefaultPath({ candidates, exists: existing("/Users/juan/Agents", "/Users/juan/work"), home: HOME }),
    "/Users/juan/Agents");
});

test("a remembered directory that no longer exists falls through to the next candidate", () => {
  const candidates = workspacePickerCandidates({ recents: ["/Volumes/gone/team-b", "/Users/juan/work/team-a"], open: [] });
  assert.equal(pickerDefaultPath({ candidates, exists: existing("/Users/juan/work"), home: HOME }), "/Users/juan/work");
  const throwing = (dir) => { if (dir === "/Volumes/gone") throw new Error("EACCES"); return dir === "/Users/juan/work"; };
  assert.equal(pickerDefaultPath({ candidates, exists: throwing, home: HOME }), "/Users/juan/work");
});

test("without recents the open set is used, latest-opened first", () => {
  const candidates = workspacePickerCandidates({ recents: [], open: ["/srv/first/ws", "/srv/second/ws"] });
  assert.deepEqual(candidates, ["/srv/second", "/srv/first"]);
});

test("no history opens the home directory", () => {
  const candidates = workspacePickerCandidates({ recents: [], open: [] });
  assert.deepEqual(candidates, []);
  assert.equal(pickerDefaultPath({ candidates, exists: () => true, home: HOME }), HOME);
  assert.equal(pickerDefaultPath({ candidates: ["/Users/juan/gone"], exists: () => false, home: HOME }), HOME);
});

test("never returns ~/Downloads, the location the OS would otherwise reuse", () => {
  const all = () => true;
  assert.notEqual(pickerDefaultPath({ candidates: [], exists: all, home: HOME }), `${HOME}/Downloads`);
  const fromRecent = workspacePickerCandidates({ recents: [`${HOME}/Downloads/team`], open: [] });
  assert.equal(pickerDefaultPath({ candidates: fromRecent, exists: all, home: HOME }), HOME);
  assert.equal(pickerDefaultPath({ candidates: [`${HOME}/Downloads`, "/srv"], exists: all, home: HOME }), "/srv");
});

test("relative, empty and non-string candidates are ignored", () => {
  assert.equal(pickerDefaultPath({ candidates: [null, undefined, "", "relative/dir", 7], exists: () => true, home: HOME }), HOME);
  assert.deepEqual(workspacePickerCandidates({ recents: ["relative", null], open: [42] }), []);
});

test("CLI picker opens in the chosen CLI's directory, then the resolved one's, else home", () => {
  const both = cliPickerCandidates({ chosen: "/opt/homebrew/bin/oats", resolved: "/Users/juan/.npm-global/bin/oats" });
  assert.deepEqual(both, ["/opt/homebrew/bin", "/Users/juan/.npm-global/bin"]);
  assert.equal(pickerDefaultPath({ candidates: both, exists: () => true, home: HOME }), "/opt/homebrew/bin");
  assert.equal(pickerDefaultPath({ candidates: both, exists: existing("/Users/juan/.npm-global/bin"), home: HOME }),
    "/Users/juan/.npm-global/bin");
  const resolvedOnly = cliPickerCandidates({ chosen: null, resolved: "/usr/local/bin/oats" });
  assert.equal(pickerDefaultPath({ candidates: resolvedOnly, exists: () => true, home: HOME }), "/usr/local/bin");
  assert.equal(pickerDefaultPath({ candidates: cliPickerCandidates({}), exists: () => true, home: HOME }), HOME);
  assert.deepEqual(cliPickerCandidates({ chosen: "/usr/local/bin/oats", resolved: "/usr/local/bin/oats" }), ["/usr/local/bin"]);
});
