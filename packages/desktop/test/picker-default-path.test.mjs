// Native picker starting directories (awebai/oats#460): the pure decision
// main.mjs passes as showOpenDialog's defaultPath.
import test from "node:test";
import assert from "node:assert/strict";
import { pickerDefaultPath, workspacePickerCandidates, cliPickerCandidates, parseLastWorkspaceParent, lastWorkspaceParentState } from "../picker-default-path.mjs";

const HOME = "/Users/juan";
const existing = (...dirs) => (dir) => dirs.includes(dir);

test("workspace picker opens in the remembered parent of the last added or opened workspace", () => {
  // main.mjs writes lastWorkspaceParentState on every successful add or open
  // and reads it back on the next pick, including after a relaunch.
  const last = parseLastWorkspaceParent(lastWorkspaceParentState("/Users/juan/Agents/team-b"));
  assert.equal(last, "/Users/juan/Agents");
  const candidates = workspacePickerCandidates({ last, recents: ["/Users/juan/work/team-a"], open: ["/Users/juan/work/team-a"] });
  assert.equal(candidates[0], "/Users/juan/Agents");
  assert.equal(pickerDefaultPath({ candidates, exists: existing("/Users/juan/Agents", "/Users/juan/work"), home: HOME }),
    "/Users/juan/Agents");
});

test("a newer open beats an older add: the remembered parent outranks recents and the open set", () => {
  // Add /prior/team-a, relaunch with --dir /new/team-b (or re-pick an already
  // open workspace): recents still lead with team-a and the restored open set
  // is startup-first, so only the remembered parent knows team-b is newest.
  const candidates = workspacePickerCandidates({
    last: parseLastWorkspaceParent(lastWorkspaceParentState("/new/team-b")),
    recents: ["/prior/team-a"],
    open: ["/new/team-b", "/prior/team-a"],
  });
  assert.equal(pickerDefaultPath({ candidates, exists: () => true, home: HOME }), "/new");
});

test("without a remembered parent, recents lead, then the open set", () => {
  assert.deepEqual(workspacePickerCandidates({ recents: ["/a/ws", "/b/ws"], open: ["/c/ws", "/a/ws"] }), ["/a", "/b", "/c"]);
});

test("malformed remembered state is ignored", () => {
  for (const raw of ["", "not json", "null", "[]", "{}", '{"parent":"relative"}', '{"parent":7}']) {
    assert.equal(parseLastWorkspaceParent(raw), null, raw);
  }
});

test("a remembered directory that no longer exists falls through to the next candidate", () => {
  const candidates = workspacePickerCandidates({ last: "/Volumes/gone", recents: ["/Users/juan/work/team-a"], open: [] });
  assert.equal(pickerDefaultPath({ candidates, exists: existing("/Users/juan/work"), home: HOME }), "/Users/juan/work");
  const throwing = (dir) => { if (dir === "/Volumes/gone") throw new Error("EACCES"); return dir === "/Users/juan/work"; };
  assert.equal(pickerDefaultPath({ candidates, exists: throwing, home: HOME }), "/Users/juan/work");
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
