// The workspace list (renderer/workspace-switcher.mjs): always shown at the sidebar's top, one row per
// workspace. Its rows and their order (served views, then unattached ones, then this computer's rows), the
// current row, the rows that can't be opened, the needs-input dot and its words, a row another window shows,
// the leader's moves (`step`), the roving tab stop, and how often this computer's rows are asked of main.
// The Add dialog, Remove and Open in new window are workspace-switcher*.test.mjs and
// workspace-open-in-window.test.mjs; the pure move rule is workspace-step.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  createWorkspaceSwitcher, LISTED_STATE_TEXT, LISTED_STATE_WORD, moreBelowText, LOCAL_SECTION, OTHER_WINDOW_TEXT, WAITING_NAME, WAITING_TITLE,
  LISTED_EVERY_MS, LISTED_BLURRED_MS,
} from "../renderer/workspace-switcher.mjs";
import { UNMATCHED_SECTION } from "../../client/workspace-choices.mjs";
import { iconElement } from "../renderer/shell-icons.mjs";
import { onDeploymentTabRequest } from "../renderer/deployment-tabs.mjs";

const html = readFileSync(new URL("../renderer/index.html", import.meta.url), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise((ok) => { resolve = ok; }); return { promise, resolve }; };
// The list's slow re-read never fires unless a test drives the clock.
const INERT = { setTimeout: () => 0, clearTimeout() {} };
/** A clock the test drives: what is pending (each delay), and firing the next one. */
function fakeTimers() {
  const pending = new Map(); let next = 1;
  return {
    setTimeout(fn, ms) { const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimeout(id) { pending.delete(id); },
    delays: () => [...pending.values()].map((entry) => entry.ms),
    fire() { const [[id, entry]] = [...pending]; pending.delete(id); entry.fn(); },
  };
}

const view = (name, fields = {}) => ({ id: `ws:${name.padEnd(20, "0")}`, name, team: null, deployments: [`/h/${name}`], machines: ["This Mac"], notLive: 0, ...fields });
const listed = (name, fields = {}) => ({ id: `/h/Agents/${name}`, path: `/h/Agents/${name}`, name, team: null, reason: "On this computer", state: "ok", removable: true, ...fields });
const A = view("alpha"), B = view("beta"), C = view("gamma");
const HELD = view("held", { shown: true });
const LOOSE = view("loose", { id: "remote:vega:loose", deployments: ["remote:vega:loose"], machines: ["vega"], unattached: true, short: "Not reached" });

function setup(t, { suggestions = [], discover = null, timers = INERT, focused = true, ...overrides } = {}) {
  const dom = new JSDOM(html, { url: "file:///renderer/index.html" });
  const document = dom.window.document;
  // Whether the window is in front decides the re-read's delay: the test says so.
  const state = { focused };
  document.hasFocus = () => state.focused;
  const calls = { selected: [], added: [], asked: 0, tabs: [] };
  t.after(onDeploymentTabRequest((request) => calls.tabs.push(request)));
  const controller = createWorkspaceSwitcher({
    document, timers,
    selectWorkspace: (id) => calls.selected.push(id),
    discoverSuggestions: discover ?? (async () => { calls.asked++; return { stale: false, suggestions, list: { state: "ok" } }; }),
    addWorkspace: async (path) => { calls.added.push(path); return { ok: true, workspace: { id: path, path, name: path.split("/").pop() } }; },
    pickWorkspace: async () => ({ ok: false, code: "cancelled" }),
    removeListed: async () => ({ ok: true }),
    openInNewWindow: () => {},
    ...overrides,
  });
  t.after(() => { controller.dispose(); dom.window.close(); });
  const rows = () => [...document.querySelectorAll("#ws-options .ws-option")];
  const keyOf = (button) => button.dataset.workspaceId || button.dataset.workspacePath;
  const row = (key) => rows().find((button) => keyOf(button) === key) ?? null;
  const current = () => document.querySelector('.ws-option[aria-current="true"]');
  const icon = (name, size) => iconElement(document, name, { size }).outerHTML;
  return { dom, document, controller, calls, state, rows, row, keyOf, current, icon };
}

/* ── the rows ── */
test("rows: served views, then unattached ones under their heading, then this computer's rows under theirs; buttons, not a listbox", async (t) => {
  const s = setup(t, { suggestions: [listed("one"), listed("gone", { state: "missing" }), listed("two")] });
  s.controller.begin()(A, [A, LOOSE, HELD]); await tick();
  assert.deepEqual(s.rows().map(s.keyOf), [A.id, HELD.id, LOOSE.id, "/h/Agents/one", "/h/Agents/gone", "/h/Agents/two"], "the order as drawn");
  const list = s.document.getElementById("ws-list");
  assert.equal(s.document.getElementById(list.getAttribute("aria-labelledby")).textContent, "Workspaces");
  const groups = [...s.document.querySelectorAll("#ws-options > ul.ws-group")];
  assert.equal(groups.length, 3);
  assert.equal(groups[0].getAttribute("aria-label"), "Workspaces");
  assert.deepEqual(groups.slice(1).map((g) => s.document.getElementById(g.getAttribute("aria-labelledby")).textContent), [UNMATCHED_SECTION, LOCAL_SECTION]);
  assert.deepEqual(groups.map((g) => [...g.querySelectorAll(".ws-option")].map(s.keyOf).length), [2, 1, 3]);
  for (const button of s.rows()) {
    assert.equal(button.tagName, "BUTTON"); assert.equal(button.type, "button");
    assert.equal(button.parentElement.tagName, "LI"); assert.ok(button.parentElement.classList.contains("ws-option-row"));
    assert.equal(button.getAttribute("role"), null);
  }
  assert.equal(list.querySelector('[role="listbox"], [role="option"], [role="menu"]'), null, "the sidebar's plain keys stay live on it");
});

test("one workspace only: the list still shows it, one current row", async (t) => {
  const s = setup(t);
  s.controller.begin()(A, [A]); await tick();
  assert.equal(s.document.getElementById("ws-list").hidden, false);
  assert.deepEqual(s.rows().map(s.keyOf), [A.id]);
  assert.equal(s.current(), s.rows()[0]);
  assert.equal(s.document.querySelector(".ws-menu-empty").hidden, true, "a row, not the empty note");
  assert.equal(s.controller.step(1), false); assert.equal(s.controller.step(-1), false);
  assert.deepEqual(s.calls.selected, []);
});

test("the current row: aria-current and the check, on that row only; the list's description names it", async (t) => {
  const s = setup(t, { suggestions: [listed("one")] });
  s.controller.begin()(B, [A, B, HELD]); await tick();
  assert.deepEqual(s.rows().map((b) => b.getAttribute("aria-current")), [null, "true", null, null]);
  assert.equal(s.current().querySelector(".ws-check svg").outerHTML, s.icon("check", 14));
  assert.equal(s.row(A.id).querySelector(".ws-check").childElementCount, 0, "no mark on another row");
  assert.equal(s.row("/h/Agents/one").querySelector(".ws-check").childElementCount, 0);
  assert.equal(s.document.getElementById("ws-list").getAttribute("aria-description"), "Current workspace: beta");
  s.controller.begin()(A, [A, B, HELD]);
  assert.equal(s.current(), s.row(A.id), "it follows what this window shows");
  assert.equal(s.row(B.id).querySelector(".ws-check").childElementCount, 0);
});

test("rows that can't be opened say their state in a word on one line (the sentence said and in the tooltip, no mark) and are not selectable; the moves pass over them", async (t) => {
  const states = ["missing", "not-a-deployment", "unreadable"];
  const s = setup(t, { suggestions: [...states.map((state) => listed(state, { state })), listed("ok")] });
  s.controller.begin()(A, [A]); await tick();
  for (const state of states) {
    const button = s.row(`/h/Agents/${state}`);
    assert.equal(button.getAttribute("aria-disabled"), "true", state);
    const meta = button.querySelector(".ws-option-meta");
    assert.equal(meta.textContent, LISTED_STATE_WORD[state], "one short line");
    assert.equal(meta.getAttribute("aria-hidden"), "true", "the word is for the eye");
    assert.equal(button.querySelector(".sr-only").textContent, `, ${LISTED_STATE_TEXT[state]}`, "the sentence is in the accessible name");
    assert.equal(button.title, `/h/Agents/${state}\n${LISTED_STATE_TEXT[state]}`, "and in the tooltip");
    assert.equal(button.querySelector(".deployment-mark"), null, "no warning mark: that is a view's not live");
    button.click();
  }
  await tick();
  assert.deepEqual(s.calls.added, [], "a click opens nothing");
  assert.equal(s.row("/h/Agents/ok").getAttribute("aria-disabled"), null);
  assert.equal(s.controller.step(1), true, "past the three, to the one that can be opened");
  assert.deepEqual(s.calls.added, ["/h/Agents/ok"]);
});

/* ── the dot ── */
const dotOf = (button) => button.querySelector(".ws-waiting");
const saidOf = (button) => button.querySelector(".ws-option-name").nextElementSibling;

test("the dot: an instance needs input (waiting true) draws it, says it in the row's name and its tooltip", async (t) => {
  const tipped = view("tipped", { waiting: true, deploymentLabels: ["This Mac · ~/Agents/tipped"] });
  const plain = view("plain", { waiting: true, machines: [], deployments: [] });
  const s = setup(t);
  s.controller.begin()(tipped, [tipped, plain]); await tick();
  for (const button of [s.row(tipped.id), s.row(plain.id)]) {
    const dot = dotOf(button);
    assert.ok(dot, "the dot, the current row included");
    assert.equal(dot.getAttribute("aria-hidden"), "true", "a graphic: its words are the name's");
    assert.equal(dot.parentElement, button.querySelector(".ws-option-line"), "beside the name");
    assert.ok(saidOf(button).classList.contains("sr-only"));
    assert.equal(saidOf(button).textContent, WAITING_NAME);
  }
  assert.equal(WAITING_NAME, ", needs input"); assert.equal(WAITING_TITLE, "An instance here needs input");
  assert.equal(s.row(tipped.id).querySelector(".ws-option-line").textContent, `tipped${WAITING_NAME}`, "the accessible name reads it after the name");
  assert.equal(s.row(tipped.id).title, `This Mac · ~/Agents/tipped\n${WAITING_TITLE}`, "after the row's own tooltip");
  assert.equal(s.row(plain.id).title, WAITING_TITLE, "the whole tooltip when the row has none");
});

test("the dot: false, unknown (null, absent) or anything but true draws none and says nothing", async (t) => {
  const s = setup(t);
  const choices = [false, null, undefined, "true", 1, {}].map((waiting, i) => view(`w${i}`, { waiting, deploymentLabels: [`This Mac · ~/w${i}`] }));
  s.controller.begin()(choices[0], choices); await tick();
  for (const [i, button] of s.rows().entries()) {
    assert.equal(dotOf(button), null, String(choices[i].waiting));
    assert.equal(button.querySelector(".sr-only"), null);
    assert.equal(button.title, `This Mac · ~/w${i}`);
  }
});

test("the dot on this computer's rows: true draws it; false and null (unknown) none; a stale row never shows one", async (t) => {
  const s = setup(t, { suggestions: [listed("yes", { waiting: true }), listed("no", { waiting: false }), listed("unknown", { waiting: null }),
    listed("gone", { state: "missing", waiting: true })] });
  s.controller.begin()(A, [A]); await tick();
  const yes = s.row("/h/Agents/yes");
  assert.ok(dotOf(yes)); assert.equal(saidOf(yes).textContent, WAITING_NAME);
  assert.equal(yes.title, `/h/Agents/yes\n${WAITING_TITLE}`);
  for (const name of ["no", "unknown"]) {
    assert.equal(dotOf(s.row(`/h/Agents/${name}`)), null, name);
    assert.equal(s.row(`/h/Agents/${name}`).title, `/h/Agents/${name}`);
  }
  const gone = s.row("/h/Agents/gone");
  assert.equal(dotOf(gone), null, "its read is not the deployment's");
  assert.deepEqual([...gone.querySelectorAll(".sr-only")].map((el) => el.textContent), [`, ${LISTED_STATE_TEXT.missing}`], "its state, never needs input");
  assert.equal(gone.title, `/h/Agents/gone\n${LISTED_STATE_TEXT.missing}`);
});

test("the dot never reorders the list", async (t) => {
  const s = setup(t);
  s.controller.begin()(A, [A, B, C]);
  const before = s.rows().map(s.keyOf);
  s.controller.begin()(A, [A, B, { ...C, waiting: true }]);
  assert.deepEqual(s.rows().map(s.keyOf), before);
  assert.ok(dotOf(s.row(C.id)));
});

/* ── a workspace another window shows ── */
test("a row another window shows says so in words (its Open in new window is its one window icon); picking it takes it over into this window", async (t) => {
  const s = setup(t);
  s.controller.begin()(A, [A, HELD, { ...B, shown: false }]); await tick();
  const held = s.row(HELD.id);
  assert.equal(held.dataset.otherWindow, "true");
  assert.equal(held.querySelector(".ws-option-meta").textContent, OTHER_WINDOW_TEXT);
  assert.equal(OTHER_WINDOW_TEXT, "In another window");
  assert.equal(held.querySelector(".ws-check").childElementCount, 0, "no mark in the check's place");
  assert.equal(held.closest(".ws-option-row").querySelectorAll("svg.shell-icon").length, 1, "one window icon on the row: its Open in new window");
  assert.equal(held.getAttribute("aria-current"), null);
  assert.equal(held.getAttribute("aria-disabled"), null, "it can be picked");
  assert.equal(s.row(B.id).dataset.otherWindow, undefined);
  assert.equal(s.row(B.id).querySelector(".ws-option-meta").textContent, "This Mac");
  held.click();
  assert.deepEqual(s.calls.selected, [HELD.id], "selected here: the shell asks main to take it over");
  // This window's own workspace is never "in another window", whatever `shown` says.
  s.controller.begin()(HELD, [A, HELD]);
  assert.equal(s.row(HELD.id).dataset.otherWindow, undefined);
  assert.equal(s.row(HELD.id).querySelector(".ws-check svg").outerHTML, s.icon("check", 14));
  assert.equal(s.row(HELD.id).querySelector(".ws-option-meta").textContent, "This Mac");
});

/* ── the leader's moves ── */
test("step: the next row as drawn, onto a held row, then an unattached one, then this computer's, past what can't be opened", async (t) => {
  const s = setup(t, { suggestions: [listed("gone", { state: "missing" }), listed("next")] });
  const list = [A, HELD, LOOSE];
  // Each switch lands as the shell lands it: reset(the workspace now selected), then its roster's answer.
  const land = (workspace) => { s.controller.reset(workspace.id); s.controller.begin()(workspace, list); };
  s.controller.begin()(A, list); await tick();
  assert.equal(s.controller.step(1), true);
  assert.deepEqual(s.calls.selected, [HELD.id], "a held row is not passed over: the move takes it over");
  land(HELD); // main moved it here
  assert.equal(s.controller.step(1), true);
  assert.deepEqual(s.calls.selected, [HELD.id, LOOSE.id], "down into the unattached section");
  assert.deepEqual(s.calls.tabs, [{ view: LOOSE.id, tab: LOOSE.deployments[0] }], "as a click does: its deployment's tab");
  land(LOOSE);
  assert.equal(s.controller.step(1), true, "past the stale row");
  assert.deepEqual(s.calls.added, ["/h/Agents/next"], "a listed row is admitted, as its click");
  await tick();
  assert.deepEqual(s.calls.selected, [HELD.id, LOOSE.id, "/h/Agents/next"], "then opened in this window");
  assert.equal(s.current()?.dataset.workspaceId, "/h/Agents/next");
  s.controller.reset("/h/Agents/next"); // that switch lands
  land(HELD);
  assert.equal(s.controller.step(-1), true);
  assert.equal(s.calls.selected.at(-1), A.id, "up");
});

test("step: no wrap; false at either end, nothing selected", async (t) => {
  const s = setup(t, { suggestions: [listed("gone", { state: "unreadable" })] });
  s.controller.begin()(A, [A, LOOSE]); await tick();
  assert.equal(s.controller.step(-1), false, "the first row: nothing above");
  s.controller.begin()(LOOSE, [A, LOOSE]);
  assert.equal(s.controller.step(1), false, "only a row that can't be opened below: nothing to move to");
  assert.deepEqual(s.calls.selected, []); assert.deepEqual(s.calls.added, []);
  assert.equal(s.controller.step(-1), true); assert.deepEqual(s.calls.selected, [A.id]);
});

test("step with nothing current: the first openable row going down, the last going up", async (t) => {
  const down = setup(t, { suggestions: [listed("last"), listed("gone", { state: "missing" })] });
  down.controller.choose([A, B]); await tick();
  assert.equal(down.controller.step(1), true); assert.deepEqual(down.calls.selected, [A.id]);
  const up = setup(t, { suggestions: [listed("last"), listed("gone", { state: "missing" })] });
  up.controller.choose([A, B]); await tick();
  assert.equal(up.controller.step(-1), true); assert.deepEqual(up.calls.added, ["/h/Agents/last"], "the last row that can be opened");
});

test("step: this computer's rows wait while an add is running; an add whose window moved on opens nothing here", async (t) => {
  const add = deferred();
  const s = setup(t, { suggestions: [listed("one"), listed("two")], addWorkspace: (path) => { s.calls.added.push(path); return add.promise; } });
  s.controller.begin()(B, [A, B]); await tick();
  assert.equal(s.controller.step(1), true);
  assert.deepEqual(s.calls.added, ["/h/Agents/one"]);
  assert.deepEqual(["/h/Agents/one", "/h/Agents/two"].map((key) => s.row(key).getAttribute("aria-disabled")), ["true", "true"], "busy");
  assert.equal(s.controller.step(1), false, "busy rows are not openable");
  assert.deepEqual(s.calls.added, ["/h/Agents/one"], "one add at a time");
  s.controller.begin()(A, [A, B]); // another workspace became current meanwhile
  add.resolve({ ok: true, workspace: { id: "/h/Agents/one", path: "/h/Agents/one", name: "one" } }); await tick();
  assert.deepEqual(s.calls.selected, [], "its result is dropped");
  assert.equal(s.current().dataset.workspaceId, A.id);
  assert.equal(s.row("/h/Agents/one").getAttribute("aria-disabled"), null, "not left busy");
});

/* ── the roving tab stop ── */
test("roving stop: one row in the Tab order, the current one, then the last focused; focusList goes to the current row", async (t) => {
  const s = setup(t);
  const stops = () => s.rows().filter((b) => b.tabIndex === 0).map(s.keyOf);
  s.controller.begin()(B, [A, B, C]); await tick();
  assert.deepEqual(stops(), [B.id], "the current row");
  assert.ok([...s.document.querySelectorAll(".ws-open-window")].every((b) => b.tabIndex === -1), "a row's own button is reached with Right Arrow");
  s.row(C.id).focus();
  assert.deepEqual(stops(), [C.id], "the row last focused");
  s.controller.begin()(B, [A, B, C]);
  assert.deepEqual(stops(), [C.id], "kept across a repaint");
  assert.equal(s.document.activeElement, s.row(C.id));
  s.document.getElementById("ws-add-open").focus();
  assert.equal(s.controller.focusList(), true);
  assert.equal(s.document.activeElement, s.row(B.id), "w, o and Ctrl+Alt+O land on the current row");
  assert.deepEqual(stops(), [B.id]);
  s.row(C.id).focus();
  s.controller.begin()(B, [A, B]);
  assert.equal(s.document.activeElement, s.row(B.id), "the focused row is gone: focus goes to the current row");
  assert.deepEqual(stops(), [B.id]);
});

test("roving stop with nothing current is the first row; an empty list's focus is Add local workspace…", async (t) => {
  const s = setup(t);
  s.controller.choose([A, B]); await tick();
  assert.deepEqual(s.rows().filter((b) => b.tabIndex === 0).map(s.keyOf), [A.id]);
  assert.equal(s.controller.focusList(), true); assert.equal(s.document.activeElement, s.row(A.id));
  const empty = setup(t);
  empty.controller.choose([]); await tick();
  assert.equal(empty.controller.focusList(), true);
  assert.equal(empty.document.activeElement, empty.document.getElementById("ws-add-open"));
});

/* ── how often this computer's rows are asked ── */
test("the list asks at start, on window focus, and on a timer: every LISTED_EVERY_MS in front, LISTED_BLURRED_MS behind", async (t) => {
  const clock = fakeTimers();
  const s = setup(t, { timers: clock, suggestions: [listed("one")] });
  assert.equal(LISTED_EVERY_MS, 60_000); assert.equal(LISTED_BLURRED_MS, 300_000);
  assert.equal(s.calls.asked, 1, "at start");
  assert.deepEqual(clock.delays(), [LISTED_EVERY_MS], "one timer, the window in front");
  clock.fire(); await tick();
  assert.equal(s.calls.asked, 2);
  assert.deepEqual(clock.delays(), [LISTED_EVERY_MS], "asked again, then the next one set");
  s.state.focused = false; s.dom.window.dispatchEvent(new s.dom.window.Event("blur"));
  assert.equal(s.calls.asked, 2, "a blur asks nothing");
  assert.deepEqual(clock.delays(), [LISTED_BLURRED_MS], "the slower delay replaces the pending one");
  clock.fire(); await tick();
  assert.equal(s.calls.asked, 3);
  assert.deepEqual(clock.delays(), [LISTED_BLURRED_MS]);
  s.state.focused = true; s.dom.window.dispatchEvent(new s.dom.window.Event("focus"));
  assert.equal(s.calls.asked, 4, "the window coming to the front asks at once");
  await tick();
  assert.deepEqual(clock.delays(), [LISTED_EVERY_MS]);
  assert.equal(s.row("/h/Agents/one") !== null, true, "and paints");
});

test("no ask of the list while the Add dialog is open; it asks again as the dialog closes", async (t) => {
  const clock = fakeTimers();
  const s = setup(t, { timers: clock });
  assert.equal(s.calls.asked, 1);
  const closers = [
    ["Cancel", () => s.document.getElementById("ws-cancel").click()],
    ["the close button", () => s.document.getElementById("ws-dialog-close").click()],
    ["the backdrop", () => s.document.getElementById("ws-modal").dispatchEvent(new s.dom.window.MouseEvent("mousedown", { bubbles: true }))],
    ["Escape", () => s.document.querySelector("#ws-modal .ws-dialog").dispatchEvent(new s.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))],
  ];
  for (const [how, close] of closers) {
    const before = s.calls.asked;
    await s.controller.openModal();
    assert.equal(s.calls.asked, before + 1, "the dialog's own ask");
    clock.fire(); await tick();
    s.dom.window.dispatchEvent(new s.dom.window.Event("focus")); await tick();
    s.controller.refreshListed(); await tick();
    assert.equal(s.calls.asked, before + 1, `${how}: the timer, a focus and a refresh ask nothing while it is open`);
    assert.deepEqual(clock.delays(), [LISTED_EVERY_MS], "the timer keeps running");
    close(); await tick();
    assert.equal(s.document.getElementById("ws-modal").hidden, true);
    assert.equal(s.calls.asked, before + 2, `${how}: asked again as it closes`);
  }
});

test("only the latest ask paints; a stale answer keeps what the list shows", async (t) => {
  const asks = [];
  const s = setup(t, { discover: () => { const ask = deferred(); asks.push(ask); return ask.promise; } });
  s.controller.begin()(A, [A]);
  s.dom.window.dispatchEvent(new s.dom.window.Event("focus"));
  assert.equal(asks.length, 2);
  asks[1].resolve({ stale: false, suggestions: [listed("new")] }); await tick();
  asks[0].resolve({ stale: false, suggestions: [listed("old")] }); await tick();
  assert.deepEqual(s.rows().map(s.keyOf), [A.id, "/h/Agents/new"], "the older answer, landing last, paints nothing");
  s.controller.refreshListed();
  asks[2].resolve({ stale: true }); await tick();
  assert.deepEqual(s.rows().map(s.keyOf), [A.id, "/h/Agents/new"], "a superseded (stale) answer changes nothing");
});

test("dispose stops the timer and the focus listener; nothing asks afterwards", async (t) => {
  const clock = fakeTimers();
  const s = setup(t, { timers: clock });
  assert.deepEqual(clock.delays(), [LISTED_EVERY_MS]);
  s.controller.dispose();
  assert.deepEqual(clock.delays(), [], "the pending re-read is cleared");
  s.dom.window.dispatchEvent(new s.dom.window.Event("focus"));
  s.dom.window.dispatchEvent(new s.dom.window.Event("blur"));
  s.controller.refreshListed(); await tick();
  assert.equal(s.calls.asked, 1, "only the first ask, at start");
  assert.deepEqual(clock.delays(), [], "no timer comes back");
});

test("before the first answer of this computer's rows, the list says it is looking, never that nothing was found", async (t) => {
  let answer;
  const s = setup(t, { discover: () => new Promise((resolve) => { answer = resolve; }) });
  const empty = s.document.querySelector(".ws-menu-empty");
  assert.equal(empty.hidden, false);
  assert.equal(empty.textContent, "Looking for workspaces on this computer…");
  answer({ stale: false, suggestions: [], list: { state: "ok" } }); await tick();
  assert.equal(empty.textContent, "No workspace choices reported.", "an answer with nothing says so");
});

/* ── the bounded height ── */
test("rows cut off below the list's bounded height are said under it, at any scroll; none when all fit", async (t) => {
  const s = setup(t);
  const options = s.document.getElementById("ws-options"), more = s.document.querySelector(".ws-more");
  assert.equal(more.getAttribute("aria-hidden"), "true", "a cue for the eye: every row is in the list");
  // Layout, as a browser gives it: 40px rows in a 100px list, scrolled by scrollTop.
  let scrollTop = 0;
  options.getBoundingClientRect = () => ({ top: 0, bottom: 100 });
  const rowRect = (button) => { const i = s.rows().indexOf(button); return { top: i * 40 - scrollTop, bottom: (i + 1) * 40 - scrollTop }; };
  t.after(() => { delete s.dom.window.HTMLButtonElement.prototype.getBoundingClientRect; });
  s.dom.window.HTMLButtonElement.prototype.getBoundingClientRect = function () { return rowRect(this); };
  s.controller.begin()(A, [A, B, C, HELD]); await tick();
  assert.equal(more.hidden, false);
  assert.equal(more.textContent, moreBelowText(2), "the third row is cut: it and the fourth are below");
  assert.equal(moreBelowText(2), "2 more below");
  scrollTop = 60; options.dispatchEvent(new s.dom.window.Event("scroll"));
  assert.equal(more.hidden, true, "scrolled to the end: nothing below");
  scrollTop = 0; s.controller.begin()(A, [A, B]); await tick();
  assert.equal(more.hidden, true, "all fit"); assert.equal(more.textContent, "");
});

test("this computer's rows: the full path is the tooltip, whatever the visible line cuts", async (t) => {
  const s = setup(t, { suggestions: [listed("deep")] });
  s.controller.begin()(A, [A]); await tick();
  const row = s.row("/h/Agents/deep");
  assert.equal(row.title, "/h/Agents/deep");
  assert.equal(row.querySelector(".ws-option-meta").textContent, "Agents/deep");
});

/* ── a switch on its way ── */
test("a switch landing here keeps every row (the list never empties while the new roster is read, or when it fails); the next move goes on", async (t) => {
  const s = setup(t);
  s.controller.begin()(A, [A, B, C]); await tick();
  assert.equal(s.controller.step(1), true);
  assert.deepEqual(s.calls.selected, [B.id]);
  s.controller.reset(B.id); // the shell's restoreWorkspaceTabs, as the switch lands: B's roster not read yet
  assert.deepEqual(s.rows().map(s.keyOf), [A.id, B.id, C.id], "the rows stay");
  assert.equal(s.current().dataset.workspaceId, B.id, "B is current at once");
  assert.equal(s.controller.step(1), true, "B's read has not answered (or failed): the next move still reaches C");
  assert.deepEqual(s.calls.selected, [B.id, C.id]);
  s.controller.reset("ws:unknown00000000000000");
  assert.equal(s.rows().length, 3, "a workspace not among the rows yet: the rows stay too");
  assert.equal(s.current(), null);
});

test("moves faster than a switch go on from the pick on its way, not from what is shown", async (t) => {
  const s = setup(t, { selectWorkspace: (id) => { s.calls.selected.push(id); return new Promise(() => {}); } });
  s.controller.begin()(A, [A, B, C]); await tick();
  assert.equal(s.controller.step(1), true); assert.equal(s.controller.step(1), true);
  assert.deepEqual(s.calls.selected, [B.id, C.id], "two presses, two moves");
  assert.equal(s.controller.step(1), false, "C is the last");
  assert.equal(s.controller.step(-1), true);
  assert.deepEqual(s.calls.selected, [B.id, C.id, B.id]);
});

test("the latest pick wins: the current row picked while another pick is on its way supersedes it; a refused pick leaves none", async (t) => {
  let answer = () => new Promise(() => {});
  const s = setup(t, { selectWorkspace: (id) => { s.calls.selected.push(id); return answer(id); } });
  s.controller.begin()(A, [A, HELD]); await tick();
  s.row(HELD.id).click();
  s.row(HELD.id).click();
  assert.deepEqual(s.calls.selected, [HELD.id], "a second click on the pick on its way picks nothing again");
  s.row(A.id).click();
  assert.deepEqual(s.calls.selected, [HELD.id, A.id], "the current row, picked after: it is what this window ends on");
  s.row(A.id).click();
  assert.deepEqual(s.calls.selected, [HELD.id, A.id], "and once is enough");
  answer = async () => ({ ok: false, code: "failed" });
  s.row(HELD.id).click(); await tick(); await tick();
  s.row(A.id).click();
  assert.deepEqual(s.calls.selected, [HELD.id, A.id, HELD.id], "the refused pick is no pick: the current row is just current");
});

test("an older pick's answer never clears a newer pick of the same workspace: D on its way, then B, C, B; the first B superseded", async (t) => {
  const D = view("delta"), answers = [];
  const s = setup(t, { selectWorkspace: (id) => { s.calls.selected.push(id); const gate = {}; gate.promise = new Promise((r) => { gate.resolve = r; }); answers.push(gate); return gate.promise; } });
  s.controller.begin()(A, [A, B, C, D]); await tick();
  s.row(D.id).click();
  for (const row of [B, C, B]) s.row(row.id).click();
  assert.deepEqual(s.calls.selected, [D.id, B.id, C.id, B.id]);
  answers[0].resolve({ ok: true }); s.controller.reset(D.id); // D lands
  answers[1].resolve({ ok: false, code: "superseded" }); answers[2].resolve({ ok: false, code: "superseded" });
  await tick(); await tick();
  assert.equal(s.current().dataset.workspaceId, D.id, "D is shown");
  assert.equal(s.controller.step(1), true, "the newest pick, B, is still on its way: the move goes on from it");
  assert.equal(s.calls.selected.at(-1), C.id);
});
