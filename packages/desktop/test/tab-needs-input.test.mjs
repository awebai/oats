// #558: an open terminal tab shows Needs input. Executes the shipped syncTabNeedsInput (shell.mjs) over
// tab triggers built by the shipped createTabChrome (tab-a11y.mjs); no shell startup, Electron or session.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { createTabChrome, tabNameTailStart } from "../renderer/tab-a11y.mjs";
import { terminalKey } from "../renderer/instance-tree.mjs";
import { iconElement } from "../renderer/shell-icons.mjs";
import { waitingClaim, waitingLabel, waitingClock } from "../renderer/waiting-on-you.mjs";
import { rowStale } from "../renderer/view-deployments.mjs";
import { remotePanel, unavailableGroups } from "../server/remote-roster.mjs";
import { kernelRemoteRow, kernelRemoteGroup, remoteRows } from "./helpers/kernel-remote-row.mjs";

const read = name => readFileSync(new URL(`../renderer/${name}`, import.meta.url), "utf8");
const shell = read("shell.mjs"), css = read("shell.css");
const source = shell.match(/function syncTabNeedsInput\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(source, "the shipped syncTabNeedsInput");

const SINCE = "2026-10-03T09:00:00.000Z";
const claim = (extra = {}) => ({ since: SINCE, producer: "agent", reason: "attention", message: "Pick one?", ...extra });
const row = (name, extra = {}) => ({ instance: name, agent: "dev", home: `/ws/agents/dev/instances/${name}`, agentsRoot: "/ws/agents",
  running: true, runtimeState: "running", ...extra });

function fixture(t, { stale = false } = {}) {
  const dom = new JSDOM("<!doctype html><body><div class='strip-a'></div><div class='strip-b'></div></body>", { pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document, tabs = new Map();
  const context = { document: doc, tabs, terminalKey, waitingClaim, waitingLabel, waitingClock, iconElement, rowStale,
    contextDeployments: [], rosterStale: stale, tabNeedsInputRoster: { instances: [], workspace: null } };
  Object.defineProperty(context, "Date", { get: () => Date, enumerable: true }); // the test realm's (mockable) clock
  const sync = runInNewContext(`${source}\nsyncTabNeedsInput`, context);
  let id = 0;
  // A terminal tab exactly as openTerminalTabInner draws it: the name, its live dot, its key and workspace.
  const open = (inst, { workspace = "A", strip = ".strip-a" } = {}) => {
    const tabId = ++id, name = inst.instance;
    const chrome = createTabChrome(doc, tabId, name, true, { dot: inst.running ? "on" : "off", tailAt: tabNameTailStart(name, inst.agent), tailEnd: name.length });
    doc.querySelector(strip).append(chrome.tabEl);
    const tab = { ...chrome, title: name, key: terminalKey(workspace, inst), kind: "terminal", workspace };
    tabs.set(tabId, tab);
    return tab;
  };
  return { doc, dom, sync, open, context, tabs };
}
const cue = tab => tab.triggerEl.querySelector(":scope > .tab-attn");

test("the cue appears with the claim and clears on the next poll, giving back the drawn dot, label and title", async t => {
  const u = fixture(t), tab = u.open(row("dev-a")), trigger = tab.triggerEl;
  const dot = trigger.querySelector(":scope > .tab-dot"), label = trigger.querySelector(".tab-label");
  assert.equal(trigger.getAttribute("aria-label"), "dev-a");
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(SINCE) + 60e3 });
  u.sync([row("dev-a", { waitingOnYou: claim() })], "A");
  const mark = cue(tab);
  assert.ok(mark, "the alert glyph shows");
  assert.equal(mark.getAttribute("aria-hidden"), "true"); assert.ok(mark.querySelector("svg"));
  assert.equal(trigger.querySelector(":scope > .tab-dot"), null, "it takes the dot's place");
  assert.equal(trigger.firstElementChild, mark, "in the same slot, before the label");
  assert.equal(mark.nextElementSibling, label, "the label is the same element");
  assert.equal(trigger.getAttribute("aria-label"), "dev-a, needs input");
  assert.equal(trigger.title, `dev-a\nNeeds input: Pick one? since ${waitingClock(SINCE, Date.now())}`);
  u.sync([row("dev-a", { waitingOnYou: claim({ message: null, reason: "question" }) })], "A");
  assert.equal(cue(tab), mark, "a repaint keeps the same glyph element");
  assert.match(trigger.title, /\nNeeds input: Asked you a question since /);
  u.sync([row("dev-a", { waitingOnYou: null })], "A");
  assert.equal(cue(tab), null);
  assert.equal(trigger.firstElementChild, dot, "exactly the dot it was drawn with");
  assert.equal(trigger.getAttribute("aria-label"), "dev-a"); assert.equal(trigger.title, "dev-a");
  u.sync([row("dev-a", { waitingOnYou: claim() })], "A"); u.sync([row("dev-a")], "A");
  assert.equal(trigger.firstElementChild, dot, "absent is unknown: no cue, the drawn dot");
});

test("focus on a tab trigger survives a poll that toggles the cue; the trigger and tab are never rebuilt", async t => {
  const u = fixture(t), tab = u.open(row("dev-a")), { tabEl, triggerEl } = tab;
  triggerEl.focus();
  assert.equal(u.doc.activeElement, triggerEl);
  for (const waiting of [claim(), null, claim(), null]) {
    u.sync([row("dev-a", { waitingOnYou: waiting })], "A");
    assert.equal(u.doc.activeElement, triggerEl, "focus stays");
    assert.equal(tabEl.firstElementChild, triggerEl); assert.ok(tabEl.isConnected);
    assert.equal(triggerEl.id, "tab-1");
  }
});

test("every open terminal tab, in every editor group strip, follows its own row", async t => {
  const u = fixture(t), a = u.open(row("dev-a")), b = u.open(row("dev-b"), { strip: ".strip-b" });
  u.sync([row("dev-a", { waitingOnYou: claim() }), row("dev-b", { waitingOnYou: claim({ message: "Other" }) })], "A");
  assert.ok(cue(a) && cue(b));
  u.sync([row("dev-a"), row("dev-b", { waitingOnYou: claim() })], "A");
  assert.equal(cue(a), null); assert.ok(cue(b));
});

test("a same-named instance in another root, or the same home in another workspace, never lights a tab", async t => {
  const u = fixture(t), tab = u.open(row("dev-a")), other = u.open(row("dev-a"), { workspace: "B" });
  const twin = row("dev-a", { home: "/other/agents/dev/instances/dev-a", agentsRoot: "/other/agents", waitingOnYou: claim() });
  u.sync([row("dev-a"), twin], "A");
  assert.equal(cue(tab), null, "matched by its qualified key (home), never the bare name");
  u.sync([row("dev-a", { waitingOnYou: claim() })], "A");
  assert.ok(cue(tab));
  assert.equal(cue(other), null, "workspace B's tab is not painted by workspace A's roster");
  assert.equal(other.triggerEl.getAttribute("aria-label"), "dev-a");
});

test("a stale, non-running or unreachable row never lights a tab, and a held-stale roster clears a lit one", async t => {
  const u = fixture(t), tab = u.open(row("dev-a"));
  // A positive control each time (#584): the same row lights this tab without the condition, so the
  // cleared cue is the gate's doing, never a row that stopped matching the tab.
  for (const extra of [{ running: false, runtimeState: "shell" }, { running: false, runtimeState: "stopped" }, { running: null, runtimeState: "unreachable" },
    { running: null, runtimeState: "unsupported" }]) {
    u.sync([row("dev-a", { waitingOnYou: claim() })], "A");
    assert.ok(cue(tab), `lit without ${JSON.stringify(extra)}`);
    u.sync([row("dev-a", { waitingOnYou: claim(), ...extra })], "A");
    assert.equal(cue(tab), null, JSON.stringify(extra));
  }
  // A remote row's tab is keyed by its server, so it is opened from the remote row. The row is what
  // remotePanel makes of a kernel roster row: runtimeState null, "not reported" (#582).
  const [reached] = remoteRows([kernelRemoteRow("dev-r", { waitingOnYou: claim() })]);
  const [group] = unavailableGroups([kernelRemoteGroup([kernelRemoteRow("dev-r", { waitingOnYou: claim() })])], { code: "E_SSH", message: "Connection refused" });
  const [lastKnown] = remotePanel(group).instances;
  assert.deepEqual([reached.runtimeState, reached.serverUnreached, lastKnown.serverUnreached], [null, false, true]);
  const remoteTab = u.open(reached);
  assert.equal(remoteTab.key, terminalKey("A", lastKnown), "the unreached row is the same tab's row");
  assert.notEqual(remoteTab.key, tab.key);
  for (const unreached of [{ ...reached, serverUnreached: true }, lastKnown]) {
    u.sync([reached], "A");
    assert.ok(cue(remoteTab), "a reached remote row lights its tab");
    assert.equal(cue(tab), null, "and no other tab");
    u.sync([unreached], "A");
    assert.equal(cue(remoteTab), null, "its server was not reached: last-known is unknown");
  }
  u.sync([row("dev-a", { waitingOnYou: claim() })], "A");
  assert.ok(cue(tab));
  u.context.rosterStale = true;
  u.sync([row("dev-a", { waitingOnYou: claim() })], "A");
  assert.equal(cue(tab), null, "last-known is unknown");
  assert.equal(tab.triggerEl.getAttribute("aria-label"), "dev-a");
  u.context.rosterStale = false;
  u.sync([], "A");
  assert.equal(cue(tab), null, "a roster without the row (a failed read) is unknown");
});

test("the title's start carries its date when the claim is not from today (#559)", async t => {
  const u = fixture(t), tab = u.open(row("dev-a"));
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(SINCE) + 2 * 86400e3 });
  u.sync([row("dev-a", { waitingOnYou: claim() })], "A");
  assert.match(tab.triggerEl.title, / since Oct \d{1,2}, \d\d:\d\d$/);
});

test("CSS: the glyph fits the dot's slot (the label does not move), in --warn, never animated", () => {
  const rule = name => css.match(new RegExp(`${name.replace(".", "\\.")} \\{([^}]*)\\}`))?.[1] || "";
  const px = (body, prop) => Number(body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*(-?\\d+)px`))?.[1]);
  const attn = rule(".tab-attn"), dot = rule(".tab-dot");
  assert.equal(px(attn, "width") + px(attn, "margin-right"), px(dot, "width"), "12px glyph − 5px = the 7px dot's advance");
  assert.match(attn, /flex: none/); assert.match(attn, /color: var\(--warn\)/);
  assert.doesNotMatch(attn, /animation|transition|opacity/);
  assert.match(css, /\.tab-attn > \.shell-icon \{ width: 12px; height: 12px; \}/);
});

test("shell: every roster paint syncs the tabs, and a new terminal tab syncs at once", () => {
  assert.match(shell, /function refreshPanelInstance\(instances, workspace\) \{\n  syncTabNeedsInput\(instances, workspace\);/);
  assert.match(shell, /lost a race to an identical tab\n[^\n]*\n  syncTabNeedsInput\(tabNeedsInputRoster\.instances, tabNeedsInputRoster\.workspace\);/);
});
