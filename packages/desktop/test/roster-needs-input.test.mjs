// Spec D: "Needs input" on the sidebar roster. Executes the shipped roster render (shell.mjs
// renderContextRoster + needsInputMark) and the shipped card (roster-tip.mjs) against a stub store;
// no shell startup, HTTP, Electron, CLI or session.
import test from "node:test";
import { viewContext } from "./helpers/view-context.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import * as tree from "../renderer/instance-tree.mjs";
import { instanceActions, captureInstanceActionMenu } from "../renderer/instance-actions.mjs";
import { instanceActionTarget, sameInstanceActionTarget } from "../renderer/instance-action-target.mjs";
import { instanceSplitPlan } from "../renderer/instance-split.mjs";
import { runtimeState, unsupportedSession } from "../renderer/instance-presentation.mjs";
import { canAddressRemote, rowReason } from "../renderer/remote-address.mjs";
import { createRuntimeBadge } from "../renderer/identity-marks.mjs";
import { iconElement } from "../renderer/shell-icons.mjs";
import { createRosterTip, rosterTipFacts } from "../renderer/roster-tip.mjs";
import { waitingClock } from "../renderer/waiting-on-you.mjs";

const read = name => readFileSync(new URL(`../renderer/${name}`, import.meta.url), "utf8");
const css = read("shell.css"), html = read("index.html"), shell = read("shell.mjs");
const fn = name => shell.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0];
const source = ["renderContextRoster", "needsInputMark"].map(name => { const s = fn(name); assert.ok(s, name); return s; }).join("\n");

const SINCE = "2026-10-03T09:00:00.000Z";
const claim = (extra = {}) => ({ since: SINCE, producer: "claude-hooks", reason: "permission", message: null, ...extra });
const instance = (name, parentInstance, extra = {}) => ({ instance: name, parentInstance, agent: "dev",
  home: `/synthetic/${name}`, agentsRoot: "/synthetic/agents", repoName: "desktop-repo", running: true, runtimeState: "running", ...extra });

function fixture(t, extra = {}) {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const tips = new Map();
  const context = {
    ...tree, document: doc, instanceActions, captureInstanceActionMenu, runtimeState, unsupportedSession, canAddressRemote, rowReason, createRuntimeBadge,
    iconElement, instanceActionTarget, instanceSplitPlan, connectionGeneration: 0, menuState() {}, runAction: assert.fail,
    applyChordTitles() {}, updateActiveContexts() {}, getBinding: () => null, formatChord: c => c, isMac: true,
    contextRosterEl: doc.querySelector("#instance-roster"), contextFilter: "", contextWorkspace: "A",
    rosterState: { hasData: true, state: "ready" }, rosterStale: false, contextDeploymentNote: null, ...viewContext(),
    currentWorkspace: () => "A", workspaceGeneration: () => 0, collapsedInstances: new Set(),
    rosterTip: { bind(el, facts) { tips.set(el.dataset.treeInstance, facts); }, hide() {}, sync() {} }, rosterTipFacts,
    rosterPrs: { get: () => null, refresh() {} },
    spawnJobs: { rows: () => [], announce: () => false, check() {}, ...(extra.jobs || {}) },
    tabs: new Map(), activeTab: null, tabOpenIntents: { applyFocus: f => f() },
    openTerminalTab() {}, openInstanceStart() {}, openLifecycleDialog: assert.fail, onRosterRowKey() {},
    api: assert.fail, showStage: assert.fail, refreshContextRoster: assert.fail,
    ...(extra.context || {}),
  };
  context.splitOpenState = () => ({ split: null, activeId: null, tabs: context.tabs, workspace: "A", visible: false });
  context.ownsInstanceTarget = () => true;
  const render = runInNewContext(`${source}\nrenderContextRoster`, context);
  const list = doc.querySelector(".ctx-list");
  const row = name => [...list.querySelectorAll(".ctx-inst")].find(b => b.querySelector(".ctx-name")?.textContent === name);
  const marks = name => [...(row(name)?.querySelectorAll(".ctx-attn") || [])];
  const facts = name => tips.get(`/synthetic/${name}`)?.();
  const fact = (name, key) => facts(name)?.rows.find(([k]) => k === key)?.[1];
  return { doc, dom, context, render, list, row, marks, facts, fact };
}

test("a running, waiting row shows “Needs input” on its name line: an icon and text, part of the row's accessible name", async t => {
  const u = fixture(t);
  u.render([instance("dev-a", undefined, { waitingOnYou: claim() }), instance("dev-b")]);
  const [mark] = u.marks("dev-a");
  assert.ok(mark, "the mark is painted");
  assert.equal(mark.textContent, "Needs input");
  assert.equal(mark.className, "ctx-attn");
  assert.equal(mark.querySelector("svg").getAttribute("aria-hidden"), "true", "the text carries the state; the icon is decoration");
  assert.equal(mark.parentElement.className, "ctx-name-line");
  assert.equal(mark.previousElementSibling.className, "ctx-name", "after the name");
  assert.match(u.row("dev-a").textContent, /^dev-aNeeds input/, "in the row button's name");
  assert.ok(u.row("dev-a").querySelector(".ctx-dot.on"), "the dot stays liveness");
  assert.equal(u.marks("dev-b").length, 0);
  assert.equal(u.row("dev-b").querySelector(".ctx-name-line"), null, "a row without marks keeps its plain name");
});

test("never on a row whose Desktop liveness is not running, whose server was not reached, or that the roster holds stale", async t => {
  const waiting = { waitingOnYou: claim() };
  const rows = [
    instance("shell", undefined, { ...waiting, running: false, runtimeState: "shell" }),
    instance("stopped", undefined, { ...waiting, running: false, runtimeState: "stopped" }),
    instance("unreachable", undefined, { ...waiting, running: null, runtimeState: "unreachable" }),
    instance("unsupported", undefined, { ...waiting, running: null, runtimeState: "unsupported" }),
    instance("kernel-running", undefined, { ...waiting, runtimeState: "shell" }), // the kernel said running; tmux says shell
    instance("unreached", undefined, { ...waiting, server: "s1", addressable: true, serverUnreached: true }),
  ];
  const u = fixture(t);
  u.render(rows);
  for (const r of rows) assert.equal(u.marks(r.instance).length, 0, r.instance);
  for (const r of rows) assert.equal(u.fact(r.instance, "Waiting"), undefined, `${r.instance}: no card row either`);
  const stale = fixture(t, { context: { rosterStale: true } });
  stale.render([instance("dev-a", undefined, waiting)]);
  assert.equal(stale.marks("dev-a").length, 0, "a held-stale row's claim is last-known: unknown");
  assert.equal(stale.fact("dev-a", "Waiting"), undefined);
});

test("an invalid claim is dropped and the roster still renders", async t => {
  const u = fixture(t);
  u.render([instance("dev-a", undefined, { waitingOnYou: { since: "yesterday", producer: "x" } }),
    instance("dev-b", undefined, { waitingOnYou: claim({ producer: "https://evil.example/x" }) }), instance("dev-c")]);
  assert.equal(u.list.querySelectorAll(".ctx-inst").length, 3);
  assert.equal(u.list.querySelectorAll(".ctx-attn").length, 0);
});

test("the mark disappears on the first repaint after the claim clears", async t => {
  const u = fixture(t);
  u.render([instance("dev-a", undefined, { waitingOnYou: claim() })]);
  assert.equal(u.marks("dev-a").length, 1);
  u.render([instance("dev-a", undefined, { waitingOnYou: null })]);
  assert.equal(u.marks("dev-a").length, 0);
  u.render([instance("dev-a")]);
  assert.equal(u.marks("dev-a").length, 0, "absent is unknown, never a mark");
});

test("with New: Needs input first, then New, both on the name line", async t => {
  const u = fixture(t, { jobs: { isNew: (_ws, i) => i.instance === "dev-a" } });
  u.render([instance("dev-a", undefined, { waitingOnYou: claim() })]);
  const line = u.row("dev-a").querySelector(".ctx-name-line");
  assert.deepEqual([...line.children].map(el => el.className), ["ctx-name", "ctx-attn", "ctx-new"]);
});

test("CSS: the pill keeps its size, paints its own opaque surface with background-color, and never animates", () => {
  const rule = css.match(/\.ctx-attn \{([^}]*)\}/)?.[1];
  assert.ok(rule, ".ctx-attn rule");
  for (const decl of ["flex: none", "display: inline-flex", "background-color: var(--attn-bg)", "color: var(--warn)",
    "border: 1px solid var(--attn-border)", "font-size: 10.5px", "font-weight: 600", "line-height: 15px"]) assert.ok(rule.includes(decl), decl);
  assert.doesNotMatch(rule, /background:|opacity|animation|transition/);
  assert.match(css, /\.ctx-name-line > \.ctx-name \{ min-width: 0; \}/, "the name is what ellipsizes");
  assert.doesNotMatch(css, /\.ctx-attn[^{]*\{[^}]*animation/);
});

test("the card shows the reason, the message and the age, computed when shown", async t => {
  const u = fixture(t);
  u.render([instance("dev-a", undefined, { waitingOnYou: claim({ message: "Allow Bash(rm -rf build)?" }) }),
    instance("dev-b", undefined, { waitingOnYou: claim({ reason: "approval" }) })]);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(SINCE) + 3 * 3600e3 + 59 * 60e3 });
  assert.equal(u.fact("dev-a", "Waiting"), `Waiting for a tool approval · 3 h (since ${waitingClock(SINCE)})`);
  assert.equal(u.fact("dev-a", "Message"), "Allow Bash(rm -rf build)?");
  const keys = u.facts("dev-a").rows.map(([k]) => k);
  assert.equal(keys.indexOf("Waiting"), keys.indexOf("Status") + 1, "after Status");
  assert.equal(u.fact("dev-b", "Waiting"), `Needs input · 3 h (since ${waitingClock(SINCE)})`, "an unknown reason is never shown raw");
  assert.equal(u.fact("dev-b", "Message"), undefined, "no message, no row");
  t.mock.timers.setTime(Date.parse(SINCE) + 2 * 86400e3 + 5);
  assert.equal(u.fact("dev-a", "Waiting"), `Waiting for a tool approval · 2 d (since ${waitingClock(SINCE)})`, "not frozen at paint");
});

test("the card renders the message as text: markup is shown literally, never parsed", async t => {
  const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document, tip = createRosterTip(doc);
  const row = doc.createElement("button"); row.dataset.treeInstance = "/synthetic/dev-a"; doc.body.append(row);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  tip.bind(row, () => rosterTipFacts(instance("dev-a", undefined, { waitingOnYou: claim({ message: "<b>bold</b><script>x()</script>" }) }), "Open dev-a terminal"));
  row.dispatchEvent(new dom.window.Event("mouseenter"));
  t.mock.timers.tick(400);
  const card = doc.querySelector(".ctx-tip");
  assert.equal(card.hidden, false);
  const message = [...card.querySelectorAll(".ctx-tip-fact")].find(f => f.querySelector("dt").textContent === "Message");
  assert.equal(message.querySelector("dd").textContent, "<b>bold</b><script>x()</script>");
  assert.equal(card.querySelector("b, script"), null, "no element created from the message");
});

test("a collapsed parent surfaces waiting rows its collapse hides; expanding it hands the marks back", async t => {
  const rows = [instance("root"), instance("dev-a", "root", { waitingOnYou: claim() }), instance("dev-b", "root", { waitingOnYou: claim({ reason: "question" }) }),
    instance("dev-c", "root"), instance("solo")];
  const collapsed = new Set([tree.collapseKey("A", "/synthetic/root")]);
  const u = fixture(t, { context: { collapsedInstances: collapsed } });
  u.render(rows);
  assert.equal(u.row("dev-a"), undefined, "the children are hidden");
  const [mark] = u.marks("root");
  assert.equal(mark.className, "ctx-attn rollup");
  assert.equal(mark.textContent, "2 below need input", "the visible “2 below” plus the visually hidden rest");
  assert.equal(mark.querySelector(".ctx-attn-said").textContent, " need input");
  assert.match(u.row("root").textContent, /2 below need input/, "the row's accessible name says it");
  assert.equal(u.fact("root", "Below"), "2 need input: dev-a, dev-b");
  assert.equal(u.fact("root", "Waiting"), undefined, "root itself is not waiting");
  assert.equal(u.marks("solo").length, 0);
  collapsed.clear();
  u.render(rows);
  assert.equal(u.marks("root").length, 0, "the roll-up is derived on every paint");
  assert.equal(u.marks("dev-a")[0].textContent, "Needs input");
  assert.equal(u.marks("dev-b")[0].textContent, "Needs input");
  assert.equal(u.fact("root", "Below"), undefined);
});

test("a waiting, collapsed parent shows “Needs input” only; its card names the rest", async t => {
  const rows = [instance("root", undefined, { waitingOnYou: claim() }), instance("dev-a", "root", { waitingOnYou: claim() })];
  const u = fixture(t, { context: { collapsedInstances: new Set([tree.collapseKey("A", "/synthetic/root")]) } });
  u.render(rows);
  assert.deepEqual(u.marks("root").map(m => m.textContent), ["Needs input"]);
  assert.ok(u.fact("root", "Waiting"));
  assert.equal(u.fact("root", "Below"), "1 needs input: dev-a");
});

test("names up to three, then “and N more”; nested collapses attribute to the nearest visible ancestor", async t => {
  const kids = ["k1", "k2", "k3", "k4", "k5"].map(n => instance(n, "mid", { waitingOnYou: claim() }));
  const rows = [instance("root"), instance("mid", "root"), ...kids];
  const u = fixture(t, { context: { collapsedInstances: new Set([tree.collapseKey("A", "/synthetic/mid"), tree.collapseKey("A", "/synthetic/root")]) } });
  u.render(rows);
  assert.equal(u.row("mid"), undefined);
  assert.equal(u.marks("root")[0].textContent, "5 below need input");
  assert.equal(u.fact("root", "Below"), "5 need input: k1, k2, k3 and 2 more");
});

test("no roll-up while filtering, and none from a stale or non-running row", async t => {
  const rows = [instance("root"), instance("dev-a", "root", { waitingOnYou: claim() }), instance("dev-b", "root", { waitingOnYou: claim(), running: false, runtimeState: "shell" })];
  const collapsed = new Set([tree.collapseKey("A", "/synthetic/root")]);
  const filtering = fixture(t, { context: { collapsedInstances: collapsed, contextFilter: "dev" } });
  filtering.render(rows);
  assert.equal(filtering.list.querySelector(".ctx-attn.rollup"), null, "nothing is collapsed while filtering");
  assert.equal(filtering.marks("dev-a")[0].textContent, "Needs input");
  const only = fixture(t, { context: { collapsedInstances: collapsed } });
  only.render(rows);
  assert.equal(only.marks("root")[0].textContent, "1 below need input", "the shell row is not counted");
  const stale = fixture(t, { context: { collapsedInstances: collapsed, rosterStale: true } });
  stale.render(rows);
  assert.equal(stale.list.querySelector(".ctx-attn"), null);
});

test("a parent cycle or a missing parent degrades to no roll-up", async t => {
  const rows = [instance("a", "b", { waitingOnYou: claim() }), instance("b", "a"), instance("orphan", "gone", { waitingOnYou: claim() })];
  const u = fixture(t, { context: { collapsedInstances: new Set([tree.collapseKey("A", "/synthetic/a"), tree.collapseKey("A", "/synthetic/b")]) } });
  u.render(rows);
  assert.equal(u.list.querySelector(".ctx-attn.rollup"), null);
  assert.equal(u.marks("orphan")[0].textContent, "Needs input");
});

test("an unavailable row (no card) says it in its title and description: message or label, absolute time", async t => {
  const remote = (name, parentInstance, extra = {}) => instance(name, parentInstance, { server: "s1", addressable: false, home: `/remote/${name}`, ...extra });
  const rows = [remote("dev-a", undefined, { waitingOnYou: claim({ message: "Proceed?" }) }), remote("dev-b", undefined, { waitingOnYou: claim({ reason: "question" }) }),
    remote("root"), remote("kid", "root", { waitingOnYou: claim() })];
  const u = fixture(t, { context: { collapsedInstances: new Set([tree.collapseKey("A", tree.instanceId(rows[2]))]) } });
  u.render(rows);
  const a = u.row("dev-a"), b = u.row("dev-b"), root = u.row("root");
  assert.equal(a.getAttribute("aria-disabled"), "true");
  assert.match(a.getAttribute("aria-description"), new RegExp(` · Needs input: Proceed\\? since ${waitingClock(SINCE)}$`));
  assert.equal(a.title, a.getAttribute("aria-description"));
  assert.match(b.getAttribute("aria-description"), / · Needs input: Asked you a question since \d\d:\d\d$/);
  assert.equal(u.marks("dev-a")[0].textContent, "Needs input");
  assert.equal(u.marks("root")[0].textContent, "1 below need input");
  assert.match(root.getAttribute("aria-description"), / · 1 below need input: kid$/);
});
