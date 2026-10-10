// An accepted Start/Restart closes its dialog and opens the instance's terminal once it is ready (#525),
// but only while the operator has not chosen something else since: a newer terminal selection made while
// the started one was getting ready keeps the foreground. The real dialog, the real selection ownership
// and the shipped openTerminalTabFlow, composed as shell.mjs does; only the roster read, the key wait
// and the terminal's mount are stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { createInstanceStarter } from "../renderer/start-instance.mjs";
import { createSelectionOwnership } from "../renderer/selection-ownership.mjs";
import { setWorkspace, currentWorkspace, workspaceGeneration } from "../renderer/views/common.mjs";
import { terminalKey } from "../renderer/instance-tree-view.mjs";

const shellSource = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
const flowSource = shellSource.match(/async function openTerminalTabFlow\(ref, notify, options = \{\}\) \{[\s\S]*?\n\}/)?.[0];
const WS = "/Users/me/Agents/oats";
const D = { id: WS, machine: "This Mac", path: WS };
const inst = (name, extra = {}) => ({ instance: name, agent: "dev", home: `${WS}/agents/dev/instances/${name}`, agentsRoot: `${WS}/agents`, deployment: D, ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

test("the shell gives the dialog the selection watch it gives a followed spawn", () => {
  assert.match(shellSource, /watchSelection: \(\) => tabOpenIntents\.watch\(\),/);
  assert.match(shellSource, /const openInstanceStart = createInstanceStarter\(document, ctx\);/);
  assert.ok(flowSource && flowSource.includes("tabOpenIntents.begin()"), "an open takes the foreground with its own ticket");
});

function compose(t) {
  const dom = new JSDOM("<body><button id='opener'>Start</button></body>");
  t.after(() => { setWorkspace("/finished"); dom.window.close(); });
  setWorkspace(WS);
  const document = dom.window.document;
  let nextTab = 1, started = false;
  const A = inst("a", { running: false }), B = inst("b", { running: true, tmux: { session: "pi-agents" } });
  const opened = [], notified = [];
  // The shell's side: its open flow, over the real selection ownership.
  const c = {
    tabs: new Map(), activeTab: null, pendingTerms: new Set(), split: null, connectionGeneration: 0, currentWorkspace, workspaceGeneration,
    setSidebarMode() {}, setNavActive() {}, refreshContextRoster() {}, instanceSplitPlan() {}, instanceSplitIdentity() {}, splitOpenState() {},
    api: async () => ({ instances: [started ? { ...A, running: true, tmux: { session: "pi-agents" } } : A, B] }),
    resolveTerminalOpen: (instances, ref, ws) => { const found = instances.find((i) => i.home === ref.home); return found ? { inst: found, key: terminalKey(ws, found) } : { error: "unknown", name: ref.instance }; },
    whenKeyFree: async () => {},
    openTerminalTabInner: async (found, ws, key, owns) => {
      if (!owns()) return;
      const id = nextTab++; c.tabs.set(id, { kind: "terminal", key, instance: found.instance }); c.activeTab = id; opened.push(found.instance);
    },
  };
  c.tabOpenIntents = createSelectionOwnership(c);
  const flow = runInNewContext(`(${flowSource})`, c);
  const openTerminal = (ref, options) => flow(ref, (m) => notified.push(m), options);
  // The dialog's side: the shell's ctx, with the watch it hands the dialog.
  const ready = deferred();
  const ctx = {
    api: async (path) => {
      if (path === "/api/cli") return { ok: true, features: ["session-start"] };
      if (path.startsWith("/api/panel")) return { instances: [A, B] };
      if (path === "/api/models") return { models: [] };
      if (path.startsWith("/api/start/")) { started = true; return { instance: "a", home: A.home }; }
      throw new Error(path);
    },
    openTerminal, notify: (m) => notified.push(m), watchSelection: () => c.tabOpenIntents.watch(),
  };
  document.getElementById("opener").focus();
  const open = createInstanceStarter(document, ctx, { waitForReady: () => ready.promise });
  return { document, dom, c, A, B, opened, notified, ready, openTerminal, startA: async () => {
    const modal = open(A); await settle();
    modal.querySelector("form").dispatchEvent(new dom.window.Event("submit", { cancelable: true })); await settle();
    assert.equal(modal.isConnected, false, "accepted: the dialog closed");
  } };
}

test("accepted A, then terminal B opened while A gets ready: A's late readiness leaves B selected", async (t) => {
  const u = compose(t);
  await u.startA();
  await u.openTerminal(u.B, { quiet: true }); await settle();
  assert.deepEqual(u.opened, ["b"]); const bTab = u.c.activeTab;
  u.ready.resolve(true); await settle();
  assert.deepEqual(u.opened, ["b"], "A does not take the foreground");
  assert.equal(u.c.activeTab, bTab);
  assert.deepEqual(u.notified, [], "and says nothing");
});

test("accepted A, then a newer choice, then A's wait fails: nothing is reported", async (t) => {
  const u = compose(t);
  await u.startA();
  u.c.tabOpenIntents.begin(); // another tab, view or the sidebar
  u.ready.reject(new Error("panel unreachable")); await settle();
  assert.deepEqual(u.opened, []); assert.deepEqual(u.notified, []);
});

test("accepted A and nothing chosen since: A's terminal opens when it is ready", async (t) => {
  const u = compose(t);
  await u.startA();
  u.ready.resolve(true); await settle();
  assert.deepEqual(u.opened, ["a"]);
  assert.deepEqual(u.notified, []);
});

test("accepted A and nothing chosen since, but never ready: the notice", async (t) => {
  const u = compose(t);
  await u.startA();
  u.ready.resolve(false); await settle();
  assert.deepEqual(u.opened, []);
  assert.deepEqual(u.notified, ["a was started, but its terminal isn't ready yet. Open it from its row when it is."]);
});
