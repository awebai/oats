// A window with no workspace lists the deployments on this computer in its switcher menu (#518): the
// suggestions main makes (the deployments in ~/Agents, a saved one not served), each added and opened
// in this window with one click. Its served choices follow what the server serves (#521).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createWorkspaceSwitcher, LOCAL_SECTION } from "../renderer/workspace-switcher.mjs";

const html = readFileSync(new URL("../renderer/index.html", import.meta.url), "utf8");
const deferred = () => { let resolve, reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const found = (name) => ({ id: `/h/Agents/${name}`, path: `/h/Agents/${name}`, name, team: null, reason: "found in ~/Agents" });
const FOUR = ["aweb", "jro", "oats", "tsm"].map(found);
const REMOTE = { id: "ws:aaaaaaaaaaaaaaaaaaaa", name: "tsm", deployments: ["remote:altair:/srv/tsm"], machines: ["altair"] };

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
    ...overrides,
  });
  const document = dom.window.document;
  const local = () => [...document.querySelectorAll(".ws-local-option")];
  const view = () => ({
    open: !document.getElementById("ws-menu").hidden,
    section: document.querySelector(".ws-local-group .ws-option-section")?.textContent ?? null,
    local: local().map((b) => b.querySelector(".ws-option-name").textContent),
    served: [...document.querySelectorAll(".ws-option:not(.ws-local-option)")].map((b) => b.dataset.workspaceId),
    empty: document.querySelector(".ws-menu-empty").hidden ? "" : document.querySelector(".ws-menu-empty").textContent,
    status: document.querySelector(".ws-menu-status").textContent,
    addLocal: !!document.getElementById("ws-add-open") && !document.getElementById("ws-add-open").hidden,
  });
  return { dom, document, controller, calls, local, view };
}

test("a window with no workspace lists the deployments on this computer, one option each, above Add local workspace…", async () => {
  const s = setup();
  s.controller.choose([]); s.controller.openMenu(); await tick();
  const v = s.view();
  assert.equal(v.open, true);
  assert.equal(v.section, LOCAL_SECTION); assert.equal(LOCAL_SECTION, "On this computer");
  assert.deepEqual(v.local, ["aweb", "jro", "oats", "tsm"]);
  assert.equal(v.empty, "", "something to choose: no empty message");
  assert.equal(v.addLocal, true, "Add local workspace… stays for Browse");
  const group = s.document.querySelector(".ws-local-group");
  assert.equal(group.getAttribute("role"), "group");
  assert.equal(group.getAttribute("aria-labelledby"), group.querySelector(".ws-option-section").id);
  assert.equal(s.local()[2].title, "/h/Agents/oats", "the full path is the tooltip");
  assert.equal(s.local()[2].getAttribute("role"), "option");
  s.dom.window.close();
});

test("the empty message says nothing is reported only when nothing is served and nothing was found", async () => {
  const pending = deferred();
  const s = setup({ discoverSuggestions: () => pending.promise });
  s.controller.choose([]); s.controller.openMenu();
  assert.equal(s.view().empty, "Looking for workspaces on this computer…", "while looking, never \"none\"");
  pending.resolve({ stale: false, suggestions: [] }); await tick();
  assert.equal(s.view().empty, "No workspace choices reported.");
  const failing = setup({ discoverSuggestions: async () => { throw new Error("main is gone"); } });
  failing.controller.choose([]); failing.controller.openMenu(); await tick();
  assert.equal(failing.view().empty, "No workspace choices reported.", "a failed look finds nothing");
  s.dom.window.close(); failing.dom.window.close();
});

test("a deployment a served view already holds is not offered again; served choices list first", async () => {
  const servedOats = { id: "ws:bbbbbbbbbbbbbbbbbbbb", name: "oats", deployments: ["/h/Agents/oats"], machines: ["This Mac"] };
  const s = setup();
  s.controller.choose([servedOats, REMOTE]); s.controller.openMenu(); await tick();
  assert.deepEqual(s.view().served, [servedOats.id, REMOTE.id]);
  assert.deepEqual(s.view().local, ["aweb", "jro", "tsm"]);
  s.dom.window.close();
});

test("one click adds the deployment and opens it in this window; a second click while adding does nothing", async () => {
  const add = deferred();
  const s = setup({ addWorkspace: (path) => { s.calls.added.push(path); return add.promise; } });
  s.controller.choose([]); s.controller.openMenu(); await tick();
  const oats = s.local()[2];
  oats.focus(); oats.click();
  assert.deepEqual(s.calls.added, ["/h/Agents/oats"]);
  assert.equal(s.view().status, "Adding oats…");
  assert.equal(s.document.querySelector(".ws-local-group").getAttribute("aria-busy"), "true");
  s.local()[0].click(); oats.click();
  assert.deepEqual(s.calls.added, ["/h/Agents/oats"], "busy: no second add");
  add.resolve({ ok: true, workspace: { id: "/h/Agents/oats", path: "/h/Agents/oats", name: "oats" } }); await tick();
  assert.deepEqual(s.calls.selected, ["/h/Agents/oats"], "this window opens it");
  assert.equal(s.view().open, false, "the menu closes");
  assert.equal(s.document.activeElement, s.document.getElementById("ws-trigger"));
  s.dom.window.close();
});

test("a failed add says why in the menu and gives focus back to the same deployment", async () => {
  const add = deferred();
  const s = setup({ addWorkspace: () => add.promise });
  s.controller.choose([]); s.controller.openMenu(); await tick();
  s.local()[2].focus(); s.local()[2].click();
  add.resolve({ ok: false, code: "server-timeout", reason: "The workspace server did not answer." }); await tick();
  assert.equal(s.view().open, true);
  assert.equal(s.view().status, "The workspace server did not answer.");
  assert.equal(s.document.activeElement?.dataset.workspacePath, "/h/Agents/oats", "focus by identity, after the repaint");
  assert.equal(s.document.querySelector(".ws-local-group").getAttribute("aria-busy"), "false");
  assert.deepEqual(s.calls.selected, []);
  const thrown = setup({ addWorkspace: async () => { throw new Error("bridge failed"); } });
  thrown.controller.choose([]); thrown.controller.openMenu(); await tick();
  thrown.local()[0].click(); await tick();
  assert.equal(thrown.view().status, "bridge failed");
  s.dom.window.close(); thrown.dom.window.close();
});

test("an add that finishes after the window chose something else opens nothing here", async () => {
  const add = deferred();
  const s = setup({ addWorkspace: () => add.promise });
  s.controller.choose([REMOTE]); s.controller.openMenu(); await tick();
  s.local()[2].click();
  s.controller.begin()(REMOTE, [REMOTE]); // the window was bound meanwhile (a served choice, another path)
  add.resolve({ ok: true, workspace: { id: "/h/Agents/oats", path: "/h/Agents/oats", name: "oats" } }); await tick();
  assert.deepEqual(s.calls.selected, [], "a superseded add never switches this window");
  s.dom.window.close();
});

test("a bound window shows no local group; the filter applies to it; Ctrl+Enter on a local option opens no window", async () => {
  const s = setup();
  s.controller.begin()(REMOTE, [REMOTE]); s.controller.openMenu(); await tick();
  assert.equal(s.view().section, null); assert.deepEqual(s.view().local, []);
  assert.equal(s.calls.discovered, 0, "a bound window does not look");
  s.controller.choose([]); s.controller.openMenu(); await tick();
  const search = s.document.getElementById("ws-menu-search");
  search.value = "jr"; search.dispatchEvent(new s.dom.window.Event("input"));
  assert.deepEqual(s.view().local, ["jro"], "filtered on what is shown: the name and the short path");
  search.value = "zzz"; search.dispatchEvent(new s.dom.window.Event("input"));
  assert.equal(s.view().empty, "No workspaces match this filter.");
  search.value = ""; search.dispatchEvent(new s.dom.window.Event("input"));
  const option = s.local()[0]; option.focus();
  option.dispatchEvent(new s.dom.window.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
  assert.deepEqual(s.calls.opened, []);
  s.dom.window.close();
});

test("Arrow keys move through the served and the local options as one list", async () => {
  const s = setup();
  s.controller.choose([REMOTE]); s.controller.openMenu(); await tick();
  const key = (k) => s.document.activeElement.dispatchEvent(new s.dom.window.KeyboardEvent("keydown", { key: k, bubbles: true }));
  key("ArrowDown"); assert.equal(s.document.activeElement.dataset.workspaceId, REMOTE.id);
  key("ArrowDown"); assert.equal(s.document.activeElement.dataset.workspacePath, "/h/Agents/aweb");
  key("End"); assert.equal(s.document.activeElement.dataset.workspacePath, "/h/Agents/tsm");
  s.dom.window.close();
});

test("new served choices repaint an open chooser menu in place, without looking again or moving focus (#521)", async () => {
  const s = setup();
  s.controller.choose([]); s.controller.openMenu(); await tick();
  s.local()[1].focus();
  s.controller.choose([REMOTE]);
  assert.deepEqual(s.view().served, [REMOTE.id]);
  assert.equal(s.view().open, true, "still open");
  assert.equal(s.document.activeElement?.dataset.workspacePath, "/h/Agents/jro", "focus kept by identity");
  assert.equal(s.calls.discovered, 1, "choices arriving do not rescan the disk");
  s.dom.window.close();
});
