// This computer's deployments list in the Desktop's privileged side (#1390): what the switcher is told of a
// list read, the suggestions fed from it, the Remove's provenance and its saved entry, each committed add
// listed after the commit, and the one-time import of the Desktop's own lists (the recents file renamed).
// The switcher's DOM is workspace-switcher-list.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGenerations, createPerformAdd, createRemoveListed, importDesktopLists, listState, unsavedOpenSet, workspaceSuggestions } from "../workspace-registry.mjs";

test("listState: what the switcher says of a list read", () => {
  assert.deepEqual(listState({ ok: true, value: { ok: true, rows: [] } }), { state: "ok" });
  assert.deepEqual(listState({ ok: false, reason: { code: "E_DEPLOYMENTS_FEATURE", message: "x" } }), { state: "unsupported" });
  assert.deepEqual(listState({ ok: false, reason: { code: "E_CLI_UNAVAILABLE", message: "x" } }), { state: "unavailable" });
  assert.deepEqual(listState({ ok: false, reason: { code: "E_DEPLOYMENTS_INVALID", message: "not JSON" } }), { state: "failed", message: "not JSON" });
  assert.equal(listState(null).state, "failed");
});

test("suggestions: a stale row is offered with its state, never validated or added, and a served path is never offered", () => {
  const validate = (p) => (p === "/h/acme" || p === "/h/served" ? { id: p, name: p.split("/").pop(), team: null, path: p } : null);
  const rows = [{ path: "/h/acme", name: "acme", state: "ok" }, { path: "/h/gone", name: "gone", state: "missing" },
    { path: "/h/served", name: "served", state: "ok" }, { path: "/h/raced", name: "raced", state: "ok" }];
  const list = workspaceSuggestions({ knownPaths: [], listed: rows, advertised: new Set(["/h/served"]), validate });
  assert.deepEqual(list.map((s) => [s.path, s.state, s.removable]), [["/h/acme", "ok", true], ["/h/gone", "missing", true]],
    "a row the kernel called ok that does not validate here is left for the next read");
});

const removeIo = (over = {}) => {
  const log = { removed: [], unsaved: [] };
  const io = {
    removable: (scope) => (scope === "w1" ? new Set(["/h/gone", "/h/acme"]) : new Set()),
    served: (path) => path === "/h/acme",
    remove: async (path) => { log.removed.push(path); return { ok: true, value: { path, removed: true } }; },
    unsave: (path) => log.unsaved.push(path),
    ...over,
  };
  return { log, remove: createRemoveListed(io) };
};

test("Remove: only a row this window was offered as removable, never a served one; the kernel removes it, then its saved entry goes", async () => {
  const { log, remove } = removeIo();
  assert.deepEqual(await remove("/h/gone", "w1"), { ok: true, removed: true });
  assert.deepEqual(log, { removed: ["/h/gone"], unsaved: ["/h/gone"] });
  assert.equal((await remove("/h/gone", "w2")).code, "not-suggested", "another window was never offered it");
  assert.equal((await remove("/h/other", "w1")).code, "not-suggested");
  assert.equal((await remove(42, "w1")).code, "not-suggested");
  assert.equal((await remove("/h/acme", "w1")).code, "served", "removing a served deployment is #476, not this");
  assert.deepEqual(log.removed, ["/h/gone"], "nothing else reached the kernel");
});

test("Remove: the kernel's refusal is said, and nothing is unsaved; a failed save after the kernel's remove is said too", async () => {
  const refused = removeIo({ remove: async () => ({ ok: false, reason: { code: "E_DEPLOYMENTS_BUSY", message: "locked" } }) });
  assert.deepEqual(await refused.remove("/h/gone", "w1"), { ok: false, code: "E_DEPLOYMENTS_BUSY", reason: "locked" });
  assert.deepEqual(refused.log.unsaved, []);
  const disk = removeIo({ unsave: () => { throw new Error("disk full"); } });
  const answer = await disk.remove("/h/gone", "w1");
  assert.equal(answer.code, "save-failed"); assert.match(answer.reason, /disk full/);
  assert.deepEqual(unsavedOpenSet(["/a", "/h/gone", "/b"], "/h/gone"), ["/a", "/b"]);
});

test("each committed add is listed after the commit; its failure rides on the answer and never undoes the add", async () => {
  const workspace = { id: "/h/acme", name: "acme", team: null, path: "/h/acme" };
  const order = [];
  const performAdd = (listed, decision = { ok: true, workspace, action: "replace-server" }) => createPerformAdd({
    generations: createGenerations(), decide: () => decision, realpath: (p) => p, choices: () => ({ choices: [] }), offer: () => null,
    execute: async () => { order.push("commit"); return { ok: true, workspace }; }, added: () => order.push("added"), listed,
  });
  assert.deepEqual(await performAdd(async (ws) => { order.push(`listed ${ws.path}`); return null; })("/h/acme", true), { ok: true, workspace });
  assert.deepEqual(order, ["commit", "added", "listed /h/acme"]);
  const failure = { code: "E_DEPLOYMENTS_BUSY", message: "locked" };
  assert.deepEqual(await performAdd(async () => failure)("/h/acme", true), { ok: true, workspace, listed: failure });
  assert.deepEqual((await performAdd(async () => { throw new Error("bridge"); })("/h/acme", true)).listed, { code: "E_CLI_FAILED", message: "bridge" });
  let asked = 0;
  await performAdd(async () => { asked++; return null; }, { ok: true, workspace, action: "already-advertised" })("/h/acme", true);
  assert.equal(asked, 0, "a workspace that was already open is not an add");
  const failing = createPerformAdd({ generations: createGenerations(), decide: () => ({ ok: true, workspace, action: "replace-server" }), realpath: (p) => p,
    choices: () => ({ choices: [] }), offer: () => null, execute: async () => ({ ok: false, code: "server-timeout", reason: "late" }),
    listed: async () => { asked++; return null; } });
  assert.equal((await failing("/h/acme", true)).code, "server-timeout");
  assert.equal(asked, 0, "an add that did not commit is not listed");
});

/** userData with the Desktop's own files, and the import as main.mjs wires it (the real rename). */
function userData({ recents, open }) {
  const dir = mkdtempSync(join(tmpdir(), "oats-import-"));
  const recentsFile = join(dir, "workspace-recents.json"), openFile = join(dir, "workspace-open.json"), imported = join(dir, "workspace-recents.imported.json");
  if (recents !== undefined) writeFileSync(recentsFile, recents);
  if (open !== undefined) writeFileSync(openFile, open);
  const read = (file) => { try { return readFileSync(file, "utf8"); } catch { return null; } };
  const asked = [];
  const run = (answer) => importDesktopLists({
    readRecents: () => read(recentsFile), readOpen: () => read(openFile),
    importPaths: async (paths) => { asked.push(paths); return answer; },
    retire: () => renameSync(recentsFile, imported),
  });
  return { dir, recentsFile, openFile, imported, asked, run };
}

test("the import: recents ∪ the saved open set, as written, once; the kernel answered, so the recents file is renamed and never read again", async () => {
  const u = userData({ recents: JSON.stringify(["/h/acme", "relative", "/h/gone", "/h/acme/", 7]), open: JSON.stringify(["/h/tsm", "/h/acme", "/Volumes/x/team"]) });
  try {
    assert.deepEqual(await u.run({ ok: true, value: { imported: true, at: "2026-10-19T10:00:00.000Z", added: [] } }), { status: "imported" });
    assert.deepEqual(u.asked, [["/h/acme", "/h/gone", "/h/tsm", "/Volumes/x/team"]], "absolute, canonical, each once, whatever their state");
    assert.equal(existsSync(u.recentsFile), false);
    assert.equal(readFileSync(u.imported, "utf8"), JSON.stringify(["/h/acme", "relative", "/h/gone", "/h/acme/", 7]), "renamed whole");
    assert.equal(existsSync(u.openFile), true, "the open set is the Desktop's own, kept");
    assert.deepEqual(await u.run({ ok: true, value: { imported: true, at: "x", added: [] } }), { status: "none" });
    assert.equal(u.asked.length, 1, "no recents file: the kernel is not asked again");
  } finally { rmSync(u.dir, { recursive: true, force: true }); }
});

test("the import: an import done before (a crash before the rename) also renames; a refusal or a CLI without the list keeps the file", async () => {
  const again = userData({ recents: "[]" });
  const kept = userData({ recents: "not json", open: JSON.stringify(["/h/tsm"]) });
  try {
    assert.deepEqual(await again.run({ ok: true, value: { imported: false, at: "2026-10-19T10:00:00.000Z", added: [] } }), { status: "already" });
    assert.deepEqual(again.asked, [[]], "nothing to name is still the import: the kernel sets its marker");
    assert.equal(existsSync(again.imported), true);
    const refused = await kept.run({ ok: false, reason: { code: "E_DEPLOYMENTS_BUSY", message: "locked" } });
    assert.deepEqual(refused, { status: "kept", reason: "locked" });
    assert.deepEqual(kept.asked, [["/h/tsm"]], "a recents file that is not JSON names nothing; the open set still goes");
    assert.equal(existsSync(kept.recentsFile), true, "kept for the next launch");
    assert.equal((await kept.run({ ok: false, reason: { code: "E_DEPLOYMENTS_FEATURE", message: "no list" } })).status, "kept");
    assert.equal(existsSync(kept.imported), false);
  } finally { rmSync(again.dir, { recursive: true, force: true }); rmSync(kept.dir, { recursive: true, force: true }); }
});

test("the import: a rename that fails keeps the status honest", async () => {
  const u = userData({ recents: "[]" });
  try {
    mkdirSync(u.imported); writeFileSync(join(u.imported, "x"), ""); // a non-empty directory where the rename goes
    const answer = await u.run({ ok: true, value: { imported: true, at: "x", added: [] } });
    assert.equal(answer.status, "kept"); assert.match(answer.reason, /could not be renamed/);
  } finally { rmSync(u.dir, { recursive: true, force: true }); }
});
