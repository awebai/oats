// The workspace list shows the deployments on this computer not served yet, under "On this computer" (#518),
// in every window, one with a workspace or not: the suggestions main makes (this computer's deployments
// list, a saved one not served, #1390), each added and opened in this window with one click. A window with no
// workspace follows what the server serves (#521). The list's stale rows and Remove are
// workspace-switcher-list.test.mjs; its order, dot, moves and cadence are workspace-list.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createWorkspaceSwitcher, LOCAL_SECTION } from "../renderer/workspace-switcher.mjs";

const html = readFileSync(new URL("../renderer/index.html", import.meta.url), "utf8");
const deferred = () => { let resolve, reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const found = (name) => ({ id: `/h/Agents/${name}`, path: `/h/Agents/${name}`, name, team: null, reason: "On this computer", state: "ok", removable: false });
const FOUR = ["aweb", "jro", "oats", "tsm"].map(found);
const REMOTE = { id: "ws:aaaaaaaaaaaaaaaaaaaa", name: "tsm", deployments: ["remote:altair:/srv/tsm"], machines: ["altair"] };
// The list's slow re-read never fires here (its cadence is workspace-list.test.mjs).
const INERT = { setTimeout: () => 0, clearTimeout() {} };

function setup(overrides = {}) {
  const dom = new JSDOM(html, { url: "file:///renderer/index.html" });
  const calls = { selected: [], added: [], discovered: 0, opened: [] };
  const controller = createWorkspaceSwitcher({
    document: dom.window.document,
    selectWorkspace: (id) => calls.selected.push(id),
    discoverSuggestions: async () => { calls.discovered++; return { stale: false, suggestions: FOUR }; },
    addWorkspace: async (path) => { calls.added.push(path); return { ok: true, workspace: { id: path, path, name: path.split("/").pop() } }; },
    pickWorkspace: async () => ({ ok: false, code: "cancelled" }),
    openInNewWindow: (id) => calls.opened.push(id),
    timers: INERT,
    ...overrides,
  });
  const document = dom.window.document;
  const local = () => [...document.querySelectorAll(".ws-local-option")];
  const group = () => document.querySelector(".ws-local-group");
  const view = () => ({
    section: group() ? document.getElementById(group().getAttribute("aria-labelledby"))?.textContent ?? null : null,
    local: local().map((b) => b.querySelector(".ws-option-name").textContent),
    served: [...document.querySelectorAll(".ws-option:not(.ws-local-option)")].map((b) => b.dataset.workspaceId),
    empty: document.querySelector(".ws-menu-empty").hidden ? "" : document.querySelector(".ws-menu-empty").textContent,
    status: document.querySelector(".ws-menu-status").textContent,
    addLocal: !!document.getElementById("ws-add-open") && !document.getElementById("ws-add-open").hidden,
  });
  return { dom, document, controller, calls, local, view, group };
}

test("a window with no workspace lists the deployments on this computer, one row each, with Add local workspace… in the header", async () => {
  const s = setup();
  s.controller.choose([]); await tick();
  const v = s.view();
  assert.equal(v.section, LOCAL_SECTION); assert.equal(LOCAL_SECTION, "On this computer");
  assert.deepEqual(v.local, ["aweb", "jro", "oats", "tsm"]);
  assert.equal(v.empty, "", "something to choose: no empty message");
  assert.equal(v.addLocal, true, "Add local workspace… stays for Browse");
  const group = s.group();
  assert.equal(group.tagName, "UL", "a list of buttons, not a listbox");
  assert.equal(group.previousElementSibling.id, group.getAttribute("aria-labelledby"), "its heading, just above it");
  assert.equal(s.local()[2].title, "/h/Agents/oats", "the full path is the tooltip");
  assert.equal(s.local()[2].tagName, "BUTTON");
  assert.equal(s.local()[2].getAttribute("role"), null, "a plain button: the sidebar's keys stay live on it");
  s.dom.window.close();
});

test("the empty message says nothing is reported only when nothing is served and nothing was found", async () => {
  const pending = deferred();
  const s = setup({ discoverSuggestions: () => pending.promise });
  s.controller.choose([]);
  assert.equal(s.view().empty, "Looking for workspaces on this computer…", "while looking, never \"none\"");
  pending.resolve({ stale: false, suggestions: [] }); await tick();
  assert.equal(s.view().empty, "No workspace choices reported.");
  const failing = setup({ discoverSuggestions: async () => { throw new Error("main is gone"); } });
  failing.controller.choose([]); await tick();
  assert.equal(failing.view().empty, "No workspace choices reported.", "a failed look finds nothing");
  s.dom.window.close(); failing.dom.window.close();
});

test("a deployment a served view already holds is not offered again; served choices list first", async () => {
  const servedOats = { id: "ws:bbbbbbbbbbbbbbbbbbbb", name: "oats", deployments: ["/h/Agents/oats"], machines: ["This Mac"] };
  const s = setup();
  s.controller.choose([servedOats, REMOTE]); await tick();
  assert.deepEqual(s.view().served, [servedOats.id, REMOTE.id]);
  assert.deepEqual(s.view().local, ["aweb", "jro", "tsm"]);
  s.dom.window.close();
});

test("one click adds the deployment and opens it in this window; a second click while adding does nothing", async () => {
  const add = deferred();
  const s = setup({ addWorkspace: (path) => { s.calls.added.push(path); return add.promise; } });
  s.controller.choose([]); await tick();
  const oats = s.local()[2];
  oats.focus(); oats.click();
  assert.deepEqual(s.calls.added, ["/h/Agents/oats"]);
  assert.equal(s.view().status, "Adding oats…");
  assert.equal(s.group().getAttribute("aria-busy"), "true");
  s.local()[0].click(); oats.click();
  assert.deepEqual(s.calls.added, ["/h/Agents/oats"], "busy: no second add");
  add.resolve({ ok: true, workspace: { id: "/h/Agents/oats", path: "/h/Agents/oats", name: "oats" } }); await tick();
  assert.deepEqual(s.calls.selected, ["/h/Agents/oats"], "this window opens it");
  const opened = s.document.querySelector('.ws-option[aria-current="true"]');
  assert.equal(opened?.dataset.workspaceId, "/h/Agents/oats", "its row is a served one now, the current one");
  assert.equal(s.document.activeElement, opened, "focus stays on the workspace it opened");
  assert.deepEqual(s.view().local, ["aweb", "jro", "tsm"], "no longer offered under this computer's rows");
  s.dom.window.close();
});

test("a failed add says why in the list and gives focus back to the same deployment", async () => {
  const add = deferred();
  const s = setup({ addWorkspace: () => add.promise });
  s.controller.choose([]); await tick();
  s.local()[2].focus(); s.local()[2].click();
  add.resolve({ ok: false, code: "server-timeout", reason: "The workspace server did not answer." }); await tick();
  assert.equal(s.view().status, "The workspace server did not answer.");
  assert.equal(s.document.activeElement?.dataset.workspacePath, "/h/Agents/oats", "focus by identity, after the repaint");
  assert.equal(s.group().getAttribute("aria-busy"), "false");
  assert.deepEqual(s.calls.selected, []);
  const thrown = setup({ addWorkspace: async () => { throw new Error("bridge failed"); } });
  thrown.controller.choose([]); await tick();
  thrown.local()[0].click(); await tick();
  assert.equal(thrown.view().status, "bridge failed");
  s.dom.window.close(); thrown.dom.window.close();
});

test("an add that finishes after the window chose something else opens nothing here", async () => {
  const add = deferred();
  const s = setup({ addWorkspace: () => add.promise });
  s.controller.choose([REMOTE]); await tick();
  s.local()[2].click();
  s.controller.begin()(REMOTE, [REMOTE]); // the window was bound meanwhile (a served choice, another path)
  add.resolve({ ok: true, workspace: { id: "/h/Agents/oats", path: "/h/Agents/oats", name: "oats" } }); await tick();
  assert.deepEqual(s.calls.selected, [], "a superseded add never switches this window");
  s.dom.window.close();
});

test("a window showing a workspace lists this computer's rows too, after its served ones; Ctrl+Enter on a local option opens no window", async () => {
  const s = setup();
  s.controller.begin()(REMOTE, [REMOTE]); await tick();
  assert.equal(s.view().section, LOCAL_SECTION);
  assert.deepEqual(s.view().served, [REMOTE.id]);
  assert.deepEqual(s.view().local, ["aweb", "jro", "oats", "tsm"]);
  assert.equal(s.calls.discovered, 1, "the list asked once, as it started");
  assert.equal(s.document.getElementById("ws-menu-search"), null, "the list has no filter field");
  const option = s.local()[0]; option.focus();
  option.dispatchEvent(new s.dom.window.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
  assert.deepEqual(s.calls.opened, []);
  s.dom.window.close();
});

test("Arrow keys move through the served and the local rows as one list", async () => {
  const s = setup();
  s.controller.choose([REMOTE]); await tick();
  const key = (k) => s.document.activeElement.dispatchEvent(new s.dom.window.KeyboardEvent("keydown", { key: k, bubbles: true }));
  s.controller.focusList(); assert.equal(s.document.activeElement.dataset.workspaceId, REMOTE.id, "nothing current: the first row");
  key("ArrowDown"); assert.equal(s.document.activeElement.dataset.workspacePath, "/h/Agents/aweb");
  key("End"); assert.equal(s.document.activeElement.dataset.workspacePath, "/h/Agents/tsm");
  s.dom.window.close();
});

test("new served choices repaint the list in place, without looking again or moving focus (#521)", async () => {
  const s = setup();
  s.controller.choose([]); await tick();
  s.local()[1].focus();
  s.controller.choose([REMOTE]);
  assert.deepEqual(s.view().served, [REMOTE.id]);
  assert.equal(s.document.activeElement?.dataset.workspacePath, "/h/Agents/jro", "focus kept by identity");
  assert.equal(s.calls.discovered, 1, "choices arriving do not rescan the disk");
  s.dom.window.close();
});

test("a served workspace chosen while a one-click add is pending wins: the add, finishing first, opens nothing here", async () => {
  const add = deferred();
  const s = setup({ addWorkspace: () => add.promise });
  s.controller.choose([REMOTE]); await tick();
  s.local()[2].click();
  assert.equal(s.view().status, "Adding oats…");
  s.document.querySelector(`.ws-option[data-workspace-id="${REMOTE.id}"]`).click(); // its claim is still pending in main
  assert.deepEqual(s.calls.selected, [REMOTE.id]);
  assert.equal(s.view().status, "", "the newer choice clears the add's line at once");
  add.resolve({ ok: true, workspace: { id: "/h/Agents/oats", path: "/h/Agents/oats", name: "oats" } }); await tick();
  assert.deepEqual(s.calls.selected, [REMOTE.id], "the newer choice stays the final one");
  s.controller.choose([REMOTE]); await tick();
  assert.equal(s.group().getAttribute("aria-busy"), "false", "not left busy");
  assert.equal(s.view().status, "");
  const failing = deferred();
  const f = setup({ addWorkspace: () => failing.promise });
  f.controller.choose([REMOTE]); await tick();
  f.local()[0].click();
  f.document.querySelector(`.ws-option[data-workspace-id="${REMOTE.id}"]`).click();
  failing.resolve({ ok: false, reason: "late failure" }); await tick();
  f.controller.choose([REMOTE]); await tick();
  assert.equal(f.view().status, "", "a superseded add's failure is not shown either");
  s.dom.window.close(); f.dom.window.close();
});

test("a choices poll during a one-click add does not cancel it", async () => {
  const add = deferred();
  const s = setup({ addWorkspace: () => add.promise });
  s.controller.choose([]); await tick();
  s.local()[2].click();
  s.controller.choose([REMOTE]);
  add.resolve({ ok: true, workspace: { id: "/h/Agents/oats", path: "/h/Agents/oats", name: "oats" } }); await tick();
  assert.deepEqual(s.calls.selected, ["/h/Agents/oats"]);
  s.dom.window.close();
});

test("a choices poll keeps keyboard focus on a served workspace's Open in new window action; gone, focus falls back to the list's tab stop", async () => {
  const s = setup();
  const OTHER = { id: "ws:bbbbbbbbbbbbbbbbbbbb", name: "ac", deployments: ["remote:altair:/srv/ac"], machines: ["altair"] };
  s.controller.choose([REMOTE]); await tick();
  const action = () => s.document.querySelector(`.ws-open-window[data-workspace-id="${REMOTE.id}"]`);
  action().focus();
  s.controller.choose([REMOTE]);
  assert.equal(s.document.activeElement, action(), "unchanged list: the same action, repainted");
  s.controller.choose([OTHER, REMOTE]);
  assert.equal(s.document.activeElement, action(), "updated list: still that workspace's action");
  s.document.activeElement.dispatchEvent(new s.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  s.document.activeElement.click();
  assert.deepEqual(s.calls.opened, [REMOTE.id], "Enter (a click on the button) opens the intended workspace");
  s.controller.choose([OTHER]); await tick();
  s.document.querySelector(`.ws-open-window[data-workspace-id="${OTHER.id}"]`).focus();
  s.controller.choose([REMOTE]);
  assert.equal(s.document.activeElement, s.document.querySelector(`.ws-option[data-workspace-id="${REMOTE.id}"]`),
    "its workspace is gone: the list's tab stop (the first row, nothing being current)");
  assert.equal(s.document.activeElement.tabIndex, 0);
  s.dom.window.close();
});
