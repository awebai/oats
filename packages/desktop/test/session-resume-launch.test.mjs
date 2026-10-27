// Lost sessions resumed, main side (session-resume-launch.mjs): the trigger's wiring, the notices queue taken
// whole, its one channel, and how main.mjs and preload.cjs wire them. The module is driven with fakes (no
// Electron, no kernel, no sweep is ever run). main.mjs and preload.cjs are read as source and their shipped
// pieces run in a vm, as host-theme-main.test.mjs does.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { trustedRendererUrl } from "../renderer/window-binding.mjs";
import { createResumeTrigger, localDeploymentIds } from "../../client/session-resume-trigger.mjs";
import { readResumeSweep } from "../../client/session-resume.mjs";
import { RESUME_PROBE, resumedRow, sweepAnswer } from "./helpers/resume-sweep.mjs";
import { createResumeNotices, createResumeWiring, installResumeHandlers, sendToLiveWindows } from "../session-resume-launch.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));
/** A summary as the reader makes one: `a<n>` resumed. */
const summary = (n) => readResumeSweep(sweepAnswer([resumedRow(`a${n}`)])).summary;
const SUMMARY = summary(0);
const CLI = Object.freeze({ ...RESUME_PROBE, probedAt: 1 });

// ── The notices queue ────────────────────────────────────────────────────────

test("notices: take returns every pending summary, oldest first, and clears them; [] when none", () => {
  const notices = createResumeNotices();
  assert.deepEqual(notices.take(), [], "before any");
  notices.push(summary(1)); notices.push(summary(2)); notices.push(summary(3));
  const taken = notices.take();
  assert.deepEqual(taken, [summary(1), summary(2), summary(3)]);
  assert.deepEqual(notices.take(), [], "taken once");
  notices.push(summary(4));
  assert.deepEqual(taken, [summary(1), summary(2), summary(3)], "a later push never reaches an array already taken");
  assert.deepEqual(notices.take(), [summary(4)]);
});

test("notices: at most 10 pending; an 11th drops the oldest", () => {
  const notices = createResumeNotices();
  for (let n = 1; n <= 10; n++) notices.push(summary(n));
  assert.deepEqual(notices.take(), Array.from({ length: 10 }, (_, i) => summary(i + 1)), "10 kept");
  for (let n = 1; n <= 13; n++) notices.push(summary(n));
  assert.deepEqual(notices.take(), Array.from({ length: 10 }, (_, i) => summary(i + 4)), "the three oldest dropped");
  const small = createResumeNotices({ cap: 2 });
  small.push(summary(1)); small.push(summary(2)); small.push(summary(3));
  assert.deepEqual(small.take(), [summary(2), summary(3)]);
});

// ── The reading's routing ────────────────────────────────────────────────────

/** The wiring over a fake trigger maker; `calls` records what the routing did, in order. */
function wiring() {
  const calls = [], notices = createResumeNotices();
  let options = null;
  const made = { launch() {}, observed() {}, dispose() {} };
  const cli = () => CLI;
  const trigger = createResumeWiring({
    createTrigger: (o) => { options = o; return made; }, cli, notices,
    broadcast: () => calls.push(["broadcast", notices.take().length]),
    error: (line) => calls.push(["error", line]),
  });
  assert.equal(trigger, made, "the wiring returns what the maker made");
  assert.equal(options.cli, cli, "the CLI is passed as given");
  assert.deepEqual(Object.keys(options).sort(), ["cli", "onReading"], "run and read are the trigger's defaults");
  return { calls, notices, onReading: options.onReading };
}

test("onReading: a notice queues its summary, then every live window is told", () => {
  const w = wiring();
  w.onReading({ kind: "notice", summary: SUMMARY });
  assert.deepEqual(w.calls, [["broadcast", 1]], "queued before the broadcast");
  w.calls.length = 0;
  const kept = createResumeNotices(), sends = [];
  const trigger = createResumeWiring({ createTrigger: (o) => o, cli: () => CLI, notices: kept, error: () => assert.fail("no error"),
    broadcast: () => sendToLiveWindows([{ webContents: { isDestroyed: () => false, send: (...args) => sends.push(args) } }], "session-resume:ready") });
  trigger.onReading({ kind: "notice", summary: summary(1) });
  trigger.onReading({ kind: "notice", summary: summary(2) });
  assert.deepEqual(sends, [["session-resume:ready"], ["session-resume:ready"]], "on each new summary, no payload");
  assert.deepEqual(kept.take(), [summary(1), summary(2)]);
});

test("onReading: failed logs one line with its code only; a code that is not one is E_CLI_PROTOCOL", () => {
  for (const [code, logged] of [["E_CLI_FAILED", "E_CLI_FAILED"], ["E_SESSION_RESUME_9", "E_SESSION_RESUME_9"],
    ["kernel says: rm -rf /home/x", "E_CLI_PROTOCOL"], ["E_lower", "E_CLI_PROTOCOL"], [`E_${"A".repeat(65)}`, "E_CLI_PROTOCOL"],
    [undefined, "E_CLI_PROTOCOL"], [{ toString: () => "E_X" }, "E_CLI_PROTOCOL"], ["E_X\n", "E_CLI_PROTOCOL"]]) {
    const w = wiring();
    w.onReading({ kind: "failed", code, message: "stderr: /home/someone/secret" });
    assert.deepEqual(w.calls, [["error", `oats-desktop: the session resume sweep failed: ${logged}`]], String(code));
    assert.deepEqual(w.notices.take(), []);
  }
});

test("onReading: quiet, busy, unsupported and anything else leave nothing and log nothing", () => {
  for (const reading of [{ kind: "quiet", summary: SUMMARY }, { kind: "busy" }, { kind: "unsupported" }, { kind: "later" }, {}, null, undefined]) {
    const w = wiring();
    w.onReading(reading);
    assert.deepEqual(w.calls, [], JSON.stringify(reading));
    assert.deepEqual(w.notices.take(), [], JSON.stringify(reading));
  }
});

test("the wiring over the real trigger: the launch's notice is queued, broadcast, and taken whole", async () => {
  const notices = createResumeNotices(), calls = [];
  const trigger = createResumeWiring({
    createTrigger: (options) => createResumeTrigger({ ...options, run: async () => ({ envelope: true }), read: () => ({ kind: "notice", summary: SUMMARY }) }),
    cli: async () => CLI, notices, broadcast: () => calls.push("broadcast"), error: (line) => calls.push(line),
  });
  await trigger.launch();
  assert.deepEqual(calls, ["broadcast"]);
  assert.deepEqual(notices.take(), [SUMMARY]);
  trigger.dispose();
});

test("ready reaches every live window; a destroyed or closing one is skipped", () => {
  const sends = [];
  sendToLiveWindows([
    { webContents: { isDestroyed: () => false, send: (...args) => sends.push(["one", ...args]) } },
    { webContents: { isDestroyed: () => true, send: () => assert.fail("a destroyed window gets nothing") } },
    { webContents: { isDestroyed: () => false, send: () => { throw new Error("closing"); } } },
    { webContents: { isDestroyed: () => false, send: (...args) => sends.push(["two", ...args]) } },
  ], "session-resume:ready");
  assert.deepEqual(sends, [["one", "session-resume:ready"], ["two", "session-resume:ready"]], "no payload");
});

// ── The IPC, behind main's guard ─────────────────────────────────────────────

const main = readFileSync(new URL("../main.mjs", import.meta.url), "utf8");
const preload = readFileSync(new URL("../preload.cjs", import.meta.url), "utf8");
const RENDERER = "file:///fixture/renderer/index.html";
/** Main's shipped trusted-frame guard, from its source. */
function shippedGuard() {
  const start = main.indexOf("function trustedFrame(e) {"), end = main.indexOf("// ---- IPC: the theme of this computer", start);
  assert.ok(start >= 0 && end > start, "main.mjs defines its guard just before the host theme");
  return runInNewContext(`${main.slice(start, end)}\nguard`, { trustedRendererUrl, RENDERER_URL: RENDERER });
}

test("IPC: the one channel refuses an untrusted frame before it takes anything, then takes every pending summary", () => {
  const handlers = new Map(), notices = createResumeNotices();
  let takes = 0;
  const counted = { take: () => { takes++; return notices.take(); } };
  installResumeHandlers({ ipc: { handle: (channel, fn) => handlers.set(channel, fn) }, guard: shippedGuard(), notices: counted });
  assert.deepEqual([...handlers.keys()], ["session-resume:take"], "the preference channels are gone");
  notices.push(summary(1)); notices.push(summary(2));
  const take = handlers.get("session-resume:take");
  for (const url of ["https://evil.example/", "file:///fixture/renderer/other.html", "file:///fixture/renderer/index.html#ws=", undefined]) {
    assert.throws(() => take({ senderFrame: url === undefined ? undefined : { url } }), /forbidden: untrusted frame/, String(url));
  }
  assert.equal(takes, 0, "refused before the take");
  const ok = { senderFrame: { url: RENDERER } };
  assert.deepEqual(take(ok), [summary(1), summary(2)]);
  assert.deepEqual(take(ok), []);
  assert.equal(takes, 2);
});

// ── main.mjs wiring (source) ─────────────────────────────────────────────────

test("main builds one trigger with the settled CLI, its notices, the ready broadcast and the guard", async () => {
  const start = main.indexOf("const resumeNotices = createResumeNotices();"), tail = "installResumeHandlers({ ipc: ipcMain, guard, notices: resumeNotices });";
  const end = main.indexOf(tail, start);
  assert.ok(start >= 0 && end > start, "main.mjs wires the trigger");
  const calls = {}, sends = [], guard = () => {}, ipcMain = {}, readServedCli = () => {}, createResumeTrigger = () => {};
  const made = { launch() {}, observed() {} }, queue = { push() {}, take() {} };
  const out = runInNewContext(`${main.slice(start, end + tail.length)}\n;({ resumeTrigger, resumeNotices })`, {
    ipcMain, guard, readServedCli, createResumeTrigger,
    settledCli: (read, options) => { calls.settled = [read, options]; return "cli"; },
    createResumeNotices: (...args) => { calls.notices = args; return queue; },
    createResumeWiring: (io) => { calls.io = io; return made; },
    installResumeHandlers: (options) => { calls.handlers = options; },
    sendToLiveWindows: (windows, channel) => sends.push([windows, channel]),
    BrowserWindow: { getAllWindows: () => ["w1", "w2"] },
    console: { log: () => assert.fail("nothing is logged as log"), error: (line) => { calls.errored = line; } },
  });
  assert.equal(out.resumeTrigger, made); assert.equal(out.resumeNotices, queue);
  assert.deepEqual(calls.notices, [], "the queue's default cap");
  const io = calls.io;
  assert.equal(io.createTrigger, createResumeTrigger, "the shared trigger, with its own run and read");
  assert.deepEqual(Object.keys(io).sort(), ["broadcast", "cli", "createTrigger", "error", "notices"]);
  assert.equal(io.notices, queue);
  assert.equal(await io.cli(), "cli");
  assert.equal(calls.settled[0], readServedCli);
  assert.equal(JSON.stringify(calls.settled[1]), '{"attempts":60}', "as startupDeploymentList reads it");
  io.broadcast();
  assert.deepEqual(sends, [[["w1", "w2"], "session-resume:ready"]]);
  io.error("b");
  assert.equal(calls.errored, "b");
  assert.equal(calls.handlers.guard, guard, "the existing trusted-frame guard");
  assert.equal(calls.handlers.ipc, ipcMain); assert.equal(calls.handlers.notices, queue);
  assert.deepEqual(Object.keys(calls.handlers).sort(), ["guard", "ipc", "notices"]);
});

test("main and preload carry nothing of the preference", () => {
  for (const [name, source] of [["main.mjs", main], ["preload.cjs", preload]]) {
    assert.doesNotMatch(source, /session-resume:(set-)?preference|resumeAtLaunch|ResumeAtLaunch|ResumePreference|RESUME_PREFERENCE|session-resume\.json/, name);
  }
});

/** The primary instance's startup callback, from its source. */
function startupCallback() {
  const start = main.indexOf("const primaryInstance = startSingleInstance(app,"), end = main.indexOf("}, ownLaunch(app), offerVersionRestart);", start);
  assert.ok(start >= 0 && end > start, "main.mjs has the primary instance's startup");
  return { start, end, source: main.slice(start, end) };
}
const CHAIN = /void startupDeploymentList\(launchedPath\)\.catch\(\(e\) => console\.error\(`oats-desktop: \$\{e\?\.message \|\| e\}`\)\)\s*\.finally\(\(\) => resumeTrigger\.launch\(\)\);/;
/** main's `api` IPC handler, from its source. */
function apiHandler() {
  const start = main.indexOf('ipcMain.handle("api", async (e, pathname, opts) => {'), end = main.indexOf("\n});\n", start);
  assert.ok(start >= 0 && end > start, "main.mjs has its api handler");
  return { start, end, source: main.slice(start, end) };
}
const ACCEPTED = "if (epoch === serverEpoch && !serverHost.inTransition() && r.ok && route === 'panel') {";
/** The accepted-panel-reply block of the api handler, from its source. */
function acceptedBlock() {
  const api = apiHandler(), start = api.source.indexOf(ACCEPTED);
  assert.ok(start >= 0, "the api handler accepts a panel reply under the epoch, transition, ok and route checks");
  const end = api.source.indexOf("\n  }\n", start);
  assert.ok(end > start);
  return { start: api.start + start, end: api.start + end, source: api.source.slice(start, end + 4) };
}

test("main launches the trigger once, in the startup callback only, after the deployments-list step settles", () => {
  const startup = startupCallback();
  const launches = [...main.matchAll(/\.launch\(/g)].map((m) => m.index);
  assert.equal(launches.length, 1, "one launch in main.mjs");
  assert.ok(launches[0] > startup.start && launches[0] < startup.end, "inside the primary instance's startup callback");
  assert.match(startup.source, CHAIN, "chained after the list step, whether it succeeded or failed, and void");
  assert.ok(startup.source.indexOf("await ensureServer();") < startup.source.search(CHAIN), "after the server is ensured");
  // Nowhere else: the trigger is named only where it is made, launched and observed.
  assert.equal([...main.matchAll(/\bresumeTrigger\b/g)].length, 3);
  assert.equal([...main.matchAll(/\bcreateResumeTrigger\b/g)].length, 2, "imported, and given only to the wiring");
  assert.equal([...main.matchAll(/\bresumeNotices\b/g)].length, 3, "made, given to the wiring and to the handler");
  assert.doesNotMatch(main, /resume\w*\.dispose\(/i, "the trigger is never disposed in main");
  // Not on focus, window creation, activate, a workspace switch or a server replacement.
  for (const [what, re] of [
    ["browser-window-focus", /app\.on\("browser-window-focus", \(\) => \{[^]*?\n {2}\}\);/],
    ["browser-window-created", /app\.on\("browser-window-created", [^]*?\n {2}\}\);/],
  ]) {
    const block = startup.source.match(re)?.[0];
    assert.ok(block, `${what} is in the startup`);
    assert.doesNotMatch(block, /resume/i, what);
  }
  for (const name of ["function restoreWindows(", "function openWorkspaceWindow(", "async function ensureServer("]) {
    const at = main.indexOf(name);
    assert.ok(at >= 0, `main.mjs has ${name}`);
    assert.doesNotMatch(main.slice(at, main.indexOf("\n}\n", at)), /resume/i, name);
  }
  const replacement = main.match(/^const replaceServer = .*$/m)?.[0];
  assert.ok(replacement, "main.mjs replaces its server through the adapter");
  assert.doesNotMatch(replacement, /resume/i);
  for (const channel of ["workspace:add", "window:claim-workspace", "window:open-workspace", "workspace:onboard"]) {
    const at = main.search(new RegExp(`ipcMain\\.handle\\(["']${channel}["']`));
    assert.ok(at >= 0, `main.mjs handles ${channel}`);
    assert.doesNotMatch(main.slice(at, main.indexOf("\n});", at)), /resume/i, channel);
  }
});

test("main's shipped chain launches the trigger after the list step resolves, and after it rejects, without waiting on it", async () => {
  const chain = startupCallback().source.match(CHAIN)[0];
  for (const outcome of ["resolve", "reject"]) {
    const order = [];
    let settle;
    const listed = new Promise((resolve, reject) => { settle = () => (outcome === "resolve" ? resolve() : reject(new Error("list failed"))); });
    runInNewContext(chain, {
      launchedPath: "/d",
      startupDeploymentList: (path) => { order.push(["list", path]); return listed; },
      resumeTrigger: { launch: () => { order.push("launch"); return new Promise(() => {}); } },
      console: { error: (line) => order.push(["error", line]) },
    });
    order.push("startup goes on");
    await tick();
    assert.deepEqual(order, [["list", "/d"], "startup goes on"], `${outcome}: not before the list step settles`);
    settle();
    await tick(); await tick();
    assert.deepEqual(order, outcome === "resolve"
      ? [["list", "/d"], "startup goes on", "launch"]
      : [["list", "/d"], "startup goes on", ["error", "oats-desktop: list failed"], "launch"], outcome);
  }
});

test("main observes once, in the api handler, inside the accepted-panel-reply condition, on an instances array", () => {
  const observed = [...main.matchAll(/observed\(/g)].map((m) => m.index);
  assert.equal(observed.length, 1, "one observed call in main.mjs");
  const api = apiHandler(), block = acceptedBlock();
  assert.ok(observed[0] > api.start && observed[0] < api.end, "inside the api handler");
  assert.ok(observed[0] > block.start && observed[0] < block.end, "inside the accepted-panel-reply condition");
  assert.match(block.source, /^ {4}if \(Array\.isArray\(json\?\.instances\)\) void resumeTrigger\.observed\(json\.instances, \{ localDeploymentIds: localDeploymentIds\(json\) \}\);$/m,
    "on the reply's instances array, with the reply's own local deployments, void");
  assert.match(main, /^import \{ createResumeTrigger, localDeploymentIds \} from "\.\.\/client\/session-resume-trigger\.mjs";$/m, "the shared reading of the reply's local deployments");
  assert.match(block.source, /^ {4}if \(Array\.isArray\(json\?\.workspaces\)\) \{\n {6}allowedWs = servedSelectors\(json\.workspaces\);\n {6}noteServed\(json\.workspaces\);\n {4}\}$/m,
    "the workspaces update keeps its own condition");
  assert.equal(api.source.split(ACCEPTED).length, 2, "one accepted-panel-reply condition");
});

test("main's shipped accepted-panel block observes only accepted panel replies, with their local deployments, and updates workspaces as before", () => {
  const { source } = acceptedBlock();
  const instances = [{ home: "/h/a" }], workspaces = [{ id: "w" }];
  const deployments = [{ id: "/d", local: true }, { id: "remote:altair:a1", local: false }, { id: "/e", local: true }];
  const run = ({ epoch = 7, serverEpoch = 7, transition = false, ok = true, route = "panel", json = { instances, workspaces, deployments } } = {}) => {
    const seen = { observed: [], options: [], served: [] };
    const context = {
      epoch, serverEpoch, r: { ok }, route, json, allowedWs: "before",
      serverHost: { inTransition: () => transition },
      servedSelectors: (list) => `selectors of ${list.length}`,
      noteServed: (list) => seen.served.push(list),
      resumeTrigger: { observed: (rows, options) => { seen.observed.push(rows); seen.options.push(options); return Promise.resolve(); } },
      localDeploymentIds,
    };
    runInNewContext(source, context);
    return { ...seen, allowedWs: context.allowedWs };
  };
  const accepted = run();
  assert.equal(accepted.observed.length, 1); assert.equal(accepted.observed[0], instances, "the reply's own rows");
  const plain = (v) => JSON.parse(JSON.stringify(v)); // made in the vm's realm
  assert.deepEqual(plain(accepted.options), [{ localDeploymentIds: ["/d", "/e"] }], "the reply's local deployments, never a remote one");
  for (const odd of [undefined, null, "x", [{ id: "/d" }], [{ id: "/d", local: "true" }]]) {
    assert.deepEqual(plain(run({ json: { instances, deployments: odd } }).options), [{ localDeploymentIds: [] }], JSON.stringify(odd));
  }
  assert.deepEqual(accepted.served, [workspaces]); assert.equal(accepted.allowedWs, "selectors of 1");
  const noWorkspaces = run({ json: { instances } });
  assert.equal(noWorkspaces.observed[0], instances, "the instances need only the accepted reply");
  assert.deepEqual(noWorkspaces.served, []); assert.equal(noWorkspaces.allowedWs, "before");
  for (const odd of [{ workspaces }, { instances: "rows", workspaces }, { instances: { length: 1 }, workspaces }, null, { raw: "text" }]) {
    const r = run({ json: odd });
    assert.deepEqual(r.observed, [], JSON.stringify(odd));
  }
  for (const [what, refused] of [["a non-panel reply", { route: "roster" }], ["another route", { route: "instance-events" }], ["no route", { route: null }],
    ["a non-ok reply", { ok: false }], ["a stale epoch", { epoch: 6 }], ["a request sent during a transition", { epoch: null }], ["in transition", { transition: true }]]) {
    const r = run(refused);
    assert.deepEqual(r.observed, [], what);
    assert.deepEqual(r.served, [], what);
    assert.equal(r.allowedWs, "before", what);
  }
});

test("shutdown leaves the sweeps' children alone: quit names nothing of the trigger", () => {
  const at = main.indexOf("async function shutdown() {");
  assert.ok(at >= 0);
  const body = main.slice(at, main.indexOf("\n}\n", at));
  assert.doesNotMatch(body, /resume/i);
  const quit = main.slice(main.indexOf("let quitStarted = false"), main.indexOf("process.on(sig, () => app.quit());"));
  assert.ok(quit.length > 0);
  assert.doesNotMatch(quit, /resume/i);
});

// ── preload.cjs ──────────────────────────────────────────────────────────────

test("preload: the take invokes its channel, the ready event hands over nothing and unsubscribes, and the preference is gone", async () => {
  const require = createRequire(import.meta.url);
  let api = null;
  const listeners = new Map(), invoked = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, "oatsDesktop"); api = value; } },
    ipcRenderer: {
      invoke: (...args) => { invoked.push(args); return Promise.resolve("answer"); },
      on: (channel, fn) => { listeners.set(channel, fn); }, removeListener: (channel, fn) => { if (listeners.get(channel) === fn) listeners.delete(channel); },
      send() {},
    },
    webUtils: {},
  };
  runInNewContext(preload,
    { process: { argv: [] }, require: (name) => (name === "electron" ? electron : require(name === "./terminal-bridge.cjs" ? "../terminal-bridge.cjs" : name)) });
  assert.equal(await api.takeResumeNotice("ignored"), "answer");
  assert.deepEqual(invoked, [["session-resume:take"]]);
  assert.equal(api.resumeAtLaunch, undefined); assert.equal(api.setResumeAtLaunch, undefined);
  const heard = [];
  const off = api.onResumeNoticeReady((...args) => heard.push(args));
  listeners.get("session-resume:ready")({ sender: "the IPC event stays in the preload" }, "a payload is never passed on");
  assert.deepEqual(heard, [[]]);
  off();
  assert.equal(listeners.has("session-resume:ready"), false);
});
