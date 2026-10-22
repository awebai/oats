// The workspace list fed from this computer's deployments list (#1390), shown in every window: a stale
// row in words with a warning mark, Remove beside each list row (reached with the arrow keys, asking
// nothing), the line a CLI without the list gets, and the Add dialog that offers only what can be opened.
// The registry's side (provenance, the import, the listing of each add) is deployments-list.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createWorkspaceSwitcher, LISTED_STATE_TEXT, LIST_UNSUPPORTED_TEXT, LOCAL_SECTION, REMOVE_HINT, listFailedText } from "../renderer/workspace-switcher.mjs";

const html = readFileSync(new URL("../renderer/index.html", import.meta.url), "utf8");
const tick = () => new Promise((r) => setTimeout(r, 0));
const deferred = () => { let resolve; const promise = new Promise((ok) => { resolve = ok; }); return { promise, resolve }; };
const live = (name) => ({ id: `/h/${name}`, path: `/h/${name}`, name, team: null, reason: "On this computer", state: "ok", removable: true });
const stale = (name, state) => ({ id: `/h/${name}`, path: `/h/${name}`, name, team: null, reason: "", state, removable: true });
const saved = (name) => ({ ...live(name), reason: "Saved, not open", removable: false });
// The list's slow re-read never fires here (its cadence is workspace-list.test.mjs).
const INERT = { setTimeout: () => 0, clearTimeout() {} };

function setup({ suggestions = [], list = { state: "ok" }, ...overrides } = {}) {
  const dom = new JSDOM(html, { url: "file:///renderer/index.html" });
  const calls = { added: [], removed: [], discovered: 0, selected: [] };
  const controller = createWorkspaceSwitcher({
    document: dom.window.document,
    selectWorkspace: (id) => calls.selected.push(id),
    discoverSuggestions: async () => { calls.discovered++; return { stale: false, suggestions, list }; },
    addWorkspace: async (path) => { calls.added.push(path); return { ok: true, workspace: { id: path, path, name: path.split("/").pop() } }; },
    pickWorkspace: async () => ({ ok: false, code: "cancelled" }),
    removeListed: async (path) => { calls.removed.push(path); return { ok: true, removed: true }; },
    timers: INERT,
    ...overrides,
  });
  const document = dom.window.document;
  const options = () => [...document.querySelectorAll(".ws-local-option")];
  const row = (name) => options().find((b) => b.dataset.workspacePath === `/h/${name}`);
  const removeOf = (name) => document.querySelector(`.ws-remove-listed[data-workspace-path="/h/${name}"]`);
  const key = (target, k) => target.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true }));
  return { dom, document, controller, calls, options, row, removeOf, key,
    status: () => document.querySelector(".ws-menu-status").textContent,
    note: () => document.querySelector(".ws-local-note")?.textContent ?? null };
}

test("the workspace list shows this computer's rows: an openable one with its path, a stale one with its state in words and a warning mark", async () => {
  const s = setup({ suggestions: [saved("tsm"), live("acme"), stale("gone", "missing"), stale("old", "not-a-deployment"), stale("locked", "unreadable")] });
  s.controller.choose([]); await tick();
  const group = s.document.querySelector(".ws-local-group");
  assert.equal(s.document.getElementById(group.getAttribute("aria-labelledby")).textContent, LOCAL_SECTION, "the section's heading names the group");
  assert.deepEqual(s.options().map((b) => b.querySelector(".ws-option-meta").textContent), [
    "h/tsm", "h/acme", LISTED_STATE_TEXT.missing, LISTED_STATE_TEXT["not-a-deployment"], LISTED_STATE_TEXT.unreadable]);
  assert.deepEqual(LISTED_STATE_TEXT, {
    missing: "Missing: the folder is gone, or its volume isn't mounted",
    "not-a-deployment": "Not a deployment any more: no oats-local.yaml",
    unreadable: "Can't be checked: OATS couldn't read this folder",
  });
  const gone = s.row("gone");
  assert.equal(gone.getAttribute("aria-disabled"), "true", "a stale row can't be opened");
  assert.equal(gone.querySelector(".deployment-mark").getAttribute("aria-label"), LISTED_STATE_TEXT.missing, "its state is never the mark alone");
  assert.equal(gone.title, `/h/gone\n${LISTED_STATE_TEXT.missing}`);
  assert.equal(s.row("acme").getAttribute("aria-disabled"), null);
  gone.click(); await tick();
  assert.deepEqual(s.calls.added, [], "clicking a stale row adds nothing");
  s.row("acme").click(); await tick();
  assert.deepEqual(s.calls.added, ["/h/acme"], "a live row is the normal add");
  s.dom.window.close();
});

test("each list row has Remove beside it, a saved entry not on the list has none; Right Arrow reaches it, Left Arrow and Escape leave it", async () => {
  const s = setup({ suggestions: [saved("tsm"), live("acme"), stale("gone", "missing")] });
  s.controller.choose([]); await tick();
  assert.equal(s.removeOf("tsm"), null, "not on the list: nothing to remove");
  const remove = s.removeOf("gone");
  assert.equal(remove.textContent, "Remove");
  assert.equal(remove.getAttribute("aria-label"), "Remove gone from this computer's list");
  assert.equal(remove.tabIndex, -1, "reached with the arrow keys, not Tab");
  assert.equal(s.row("gone").getAttribute("aria-describedby"), "ws-remove-hint");
  assert.equal(s.document.getElementById("ws-remove-hint").textContent, REMOVE_HINT);
  s.row("gone").focus(); s.key(s.row("gone"), "ArrowRight");
  assert.equal(s.document.activeElement, remove);
  s.key(remove, "ArrowLeft");
  assert.equal(s.document.activeElement, s.row("gone"));
  s.key(s.row("gone"), "ArrowRight"); s.key(s.removeOf("gone"), "Escape");
  assert.equal(s.document.activeElement, s.row("gone"), "Escape on Remove goes back to its row");
  s.dom.window.close();
});

test("Remove asks nothing, says what it did, reads the list again and moves focus to the next row", async () => {
  const gate = deferred();
  let suggestions = [live("acme"), stale("gone", "missing"), live("zeta")], discovered = 0;
  // The list asks as it starts (inside setup): its count is the test's own.
  const s = setup({ removeListed: (path) => { s.calls.removed.push(path); return gate.promise; },
    discoverSuggestions: async () => { discovered++; return { stale: false, suggestions, list: { state: "ok" } }; } });
  s.controller.choose([]); await tick();
  s.removeOf("gone").focus(); s.removeOf("gone").click();
  assert.deepEqual(s.calls.removed, ["/h/gone"]);
  assert.equal(s.status(), "Removing gone…");
  assert.equal(s.document.querySelector(".ws-local-group").getAttribute("aria-busy"), "true");
  s.removeOf("acme").click(); s.row("acme").click(); await tick();
  assert.deepEqual(s.calls.removed, ["/h/gone"], "one at a time");
  assert.deepEqual(s.calls.added, [], "no add while removing");
  suggestions = [live("acme"), live("zeta")];
  gate.resolve({ ok: true, removed: true }); await tick(); await tick();
  assert.equal(s.status(), "Removed gone from this computer's list.");
  assert.equal(s.row("gone"), undefined);
  assert.equal(s.document.activeElement, s.row("zeta"), "focus on the row that took its place");
  assert.equal(discovered, 2, "the list is read again (after its first read, when the list started)");
  s.dom.window.close();
});

test("a failed Remove says why and keeps focus on its Remove", async () => {
  const s = setup({ suggestions: [stale("gone", "missing")],
    removeListed: async () => ({ ok: false, code: "E_DEPLOYMENTS_BUSY", reason: "this computer's deployments list is locked" }) });
  s.controller.choose([]); await tick();
  s.removeOf("gone").focus(); s.removeOf("gone").click(); await tick();
  assert.equal(s.status(), "this computer's deployments list is locked");
  assert.ok(s.row("gone"), "still listed");
  assert.equal(s.document.activeElement, s.removeOf("gone"));
  s.dom.window.close();
});

test("a CLI without the list: the saved entries and one line saying so; a failed read says why; neither is a choice", async () => {
  const s = setup({ suggestions: [saved("tsm")], list: { state: "unsupported" } });
  s.controller.choose([]); await tick();
  assert.equal(s.note(), LIST_UNSUPPORTED_TEXT);
  assert.equal(LIST_UNSUPPORTED_TEXT, "This oats can't list this computer's deployments. Update oats.");
  assert.deepEqual(s.options().map((b) => b.dataset.workspacePath), ["/h/tsm"]);
  const none = setup({ suggestions: [], list: { state: "unsupported" } });
  none.controller.choose([]); await tick();
  assert.equal(none.note(), LIST_UNSUPPORTED_TEXT, "said with nothing else to show");
  assert.equal(none.document.querySelector(".ws-menu-empty").hidden, true, "the line is the section's whole answer");
  const failed = setup({ suggestions: [], list: { state: "failed", message: "the file is not JSON" } });
  failed.controller.choose([]); await tick();
  assert.equal(failed.note(), listFailedText("the file is not JSON"));
  assert.equal(failed.note(), "Couldn't read this computer's deployments: the file is not JSON");
  const quiet = setup({ suggestions: [], list: { state: "unavailable" } });
  quiet.controller.choose([]); await tick();
  assert.equal(quiet.note(), null, "no compatible CLI: the degradation card says so, not the list");
  for (const x of [s, none, failed, quiet]) x.dom.window.close();
});

test("the Add dialog suggests only what can be opened: a stale row is the list's to show and remove", async () => {
  const s = setup({ suggestions: [live("acme"), stale("gone", "missing"), saved("tsm")] });
  s.controller.openModal(); await tick();
  assert.deepEqual([...s.document.querySelectorAll(".ws-suggestion")].map((b) => [b.dataset.workspaceId, b.querySelector(".ws-suggestion-reason")?.textContent]),
    [["/h/acme", "On this computer"], ["/h/tsm", "Saved, not open"]]);
  assert.equal(s.document.querySelector("#ws-modal .ws-remove-listed"), null, "no Remove in the dialog");
  assert.ok(s.removeOf("gone"), "the list beside it still has its Remove");
  s.dom.window.close();
});
