// Lost sessions resumed when Desktop opens, main side (session-resume-launch.mjs): the once-per-launch
// trigger, the pending notice taken once, the preference file, and how main.mjs and preload.cjs wire them.
// The module is driven with fakes (no Electron, no kernel, no sweep is ever run); the preference file is
// real, in a temporary directory each test makes and removes. main.mjs and preload.cjs are read as source
// and their shipped pieces run in a vm, as host-theme-main.test.mjs does.
import test from "node:test";
import assert from "node:assert/strict";
import * as realFs from "node:fs";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { trustedRendererUrl } from "../renderer/window-binding.mjs";
import { createResumeAtLaunch, installResumeHandlers, readResumePreference, sendToLiveWindows, writeResumePreference } from "../session-resume-launch.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));
/** A temporary userData; `file` is its session-resume.json. */
function userData(t) {
  const dir = mkdtempSync(join(tmpdir(), "session-resume-launch-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, file: join(dir, "session-resume.json") };
}
const SUMMARY = Object.freeze({ resumed: [{ instance: "a", deployment: "/d", warnings: [], omitted: 0 }], fresh: [], waiting: [], refused: [], optedOut: [], unswept: [], omitted: 0, totals: { resumed: 1, fresh: 0, waiting: 0, refused: 0 } });
const CLI = Object.freeze({ ok: true, bin: "/usr/bin/oats", features: ["session-resume"], probedAt: 1 });

/** A launch over fakes; `calls` records what it did, in order. */
function launch(overrides = {}) {
  const calls = [];
  const io = {
    readCli: async () => { calls.push("cli"); return CLI; },
    supported: (cli) => { calls.push("supported"); return cli === CLI; },
    preference: () => { calls.push("preference"); return { resumeAtLaunch: true }; },
    run: async (cli) => { calls.push(["run", cli]); return { envelope: true }; },
    read: (envelope) => { calls.push(["read", envelope]); return { kind: "notice", summary: SUMMARY }; },
    broadcast: () => calls.push("broadcast"),
    log: (line) => calls.push(["log", line]),
    error: (line) => calls.push(["error", line]),
    ...overrides,
  };
  return { calls, launch: createResumeAtLaunch(io) };
}
const lines = (calls) => calls.filter((c) => Array.isArray(c) && (c[0] === "log" || c[0] === "error"));

// ── The preference file ───────────────────────────────────────────────────────

test("preference: a missing file is on; exactly {resumeAtLaunch: boolean} is that; anything else is off and malformed", (t) => {
  const u = userData(t);
  assert.deepEqual(readResumePreference(u.file), { resumeAtLaunch: true }, "no file: on");
  for (const [text, expected] of [
    ['{"resumeAtLaunch": true}', { resumeAtLaunch: true }],
    ['{"resumeAtLaunch": false}', { resumeAtLaunch: false }],
    ['{"resumeAtLaunch": false}\n', { resumeAtLaunch: false }],
    ["", { resumeAtLaunch: false, malformed: true }],
    ["{resumeAtLaunch: true", { resumeAtLaunch: false, malformed: true }],
    ["true", { resumeAtLaunch: false, malformed: true }],
    ["null", { resumeAtLaunch: false, malformed: true }],
    ["[true]", { resumeAtLaunch: false, malformed: true }],
    ["{}", { resumeAtLaunch: false, malformed: true }],
    ['{"resumeAtLaunch": "true"}', { resumeAtLaunch: false, malformed: true }],
    ['{"resumeAtLaunch": 1}', { resumeAtLaunch: false, malformed: true }],
    ['{"resumeAtLaunch": true, "later": 1}', { resumeAtLaunch: false, malformed: true }],
    ['{"resumeatlaunch": true}', { resumeAtLaunch: false, malformed: true }],
  ]) {
    writeFileSync(u.file, text);
    assert.deepEqual(readResumePreference(u.file), expected, JSON.stringify(text));
  }
  // A file that is there and cannot be read (a directory in its place) is off, not on.
  rmSync(u.file); mkdirSync(u.file);
  assert.deepEqual(readResumePreference(u.file), { resumeAtLaunch: false, malformed: true });
  // Only a missing file is on: any other read error is off.
  const failing = (code) => ({ readFileSync: () => { throw Object.assign(new Error("x"), { code }); } });
  assert.deepEqual(readResumePreference("/f", failing("ENOENT")), { resumeAtLaunch: true });
  for (const code of ["EACCES", "EISDIR", "EIO", undefined]) assert.deepEqual(readResumePreference("/f", failing(code)), { resumeAtLaunch: false, malformed: true }, String(code));
});

test("preference write: a boolean is written atomically and read back; anything else is E_BAD_ARGS and touches nothing", (t) => {
  const u = userData(t);
  assert.deepEqual(writeResumePreference(u.file, false), { ok: true, resumeAtLaunch: false });
  assert.deepEqual(JSON.parse(readFileSync(u.file, "utf8")), { resumeAtLaunch: false });
  assert.equal(statSync(u.file).mode & 0o777, 0o600);
  assert.deepEqual(readResumePreference(u.file), { resumeAtLaunch: false });
  assert.deepEqual(writeResumePreference(u.file, true), { ok: true, resumeAtLaunch: true });
  assert.deepEqual(readResumePreference(u.file), { resumeAtLaunch: true });
  assert.deepEqual(readdirSync(u.dir), ["session-resume.json"], "no temporary file is left");
  for (const value of [undefined, null, 0, 1, "true", "false", {}, [], { resumeAtLaunch: true }]) {
    const calls = [];
    const fs = new Proxy({}, { get: (_t, name) => () => { calls.push(name); } });
    assert.deepEqual(writeResumePreference(u.file, value, { fs }), { ok: false, code: "E_BAD_ARGS" }, JSON.stringify(value));
    assert.deepEqual(calls, [], "nothing touched");
  }
  assert.deepEqual(readResumePreference(u.file), { resumeAtLaunch: true }, "the old value stays");
});

test("preference write: the temporary file is its own (wx, 0600, synced) in the same directory, then renamed over", (t) => {
  const u = userData(t);
  const calls = [];
  const fs = Object.fromEntries(["mkdirSync", "openSync", "writeSync", "fsyncSync", "closeSync", "renameSync", "unlinkSync"].map((name) => [name, (...args) => {
    calls.push([name, ...args.filter((a) => !Buffer.isBuffer(a))]);
    return realFs[name](...args);
  }]));
  assert.deepEqual(writeResumePreference(u.file, false, { fs, stamp: "s1" }), { ok: true, resumeAtLaunch: false });
  const own = join(u.dir, ".session-resume.json.s1.tmp");
  const names = calls.map((c) => c[0]);
  assert.deepEqual(names.filter((n) => n !== "writeSync"), ["mkdirSync", "openSync", "fsyncSync", "closeSync", "renameSync"]);
  assert.deepEqual(calls[1], ["openSync", own, "wx", 0o600]);
  assert.deepEqual(calls.at(-1), ["renameSync", own, u.file]);
});

test("preference write: a failed step answers E_PREFERENCE_WRITE, removes its temporary file and keeps the old file", (t) => {
  for (const failing of ["openSync", "writeSync", "fsyncSync", "renameSync", "mkdirSync"]) {
    const u = userData(t);
    writeFileSync(u.file, '{"resumeAtLaunch": true}');
    const fs = { ...realFs, [failing]: () => { throw new Error("disk says no: /secret/path"); } };
    const answer = writeResumePreference(u.file, false, { fs, stamp: "s2" });
    assert.deepEqual(answer, { ok: false, code: "E_PREFERENCE_WRITE" }, failing);
    assert.deepEqual(readdirSync(u.dir), ["session-resume.json"], `${failing}: no temporary file is left`);
    assert.deepEqual(readResumePreference(u.file), { resumeAtLaunch: true }, `${failing}: the old file stays`);
  }
  // A temporary name that is already there is never written through.
  const u = userData(t);
  writeFileSync(join(u.dir, ".session-resume.json.s3.tmp"), "someone's");
  assert.deepEqual(writeResumePreference(u.file, true, { stamp: "s3" }), { ok: false, code: "E_PREFERENCE_WRITE" });
  assert.equal(readFileSync(join(u.dir, ".session-resume.json.s3.tmp"), "utf8"), "someone's", "and never removed: it is not this write's own");
  assert.equal(realFs.existsSync(u.file), false);
});

// ── The trigger ──────────────────────────────────────────────────────────────

test("start: with the preference on, the sweep runs with the settled CLI and a notice becomes pending, every window told", async () => {
  const l = launch();
  await l.launch.start();
  assert.deepEqual(l.calls, ["cli", "supported", "preference", ["run", CLI], ["read", { envelope: true }], "broadcast"]);
  assert.equal(l.launch.take(), SUMMARY);
});

test("start: once per launch; a second call (window, focus, workspace switch, server replacement) runs nothing more", async () => {
  let release;
  const l = launch({ run: (cli) => { l.calls.push(["run", cli]); return new Promise((resolve) => { release = resolve; }); } });
  const first = l.launch.start(), again = l.launch.start();
  assert.equal(first, again, "the same promise");
  await tick();
  release({ envelope: true });
  await first;
  await l.launch.start();
  assert.equal(l.calls.filter((c) => Array.isArray(c) && c[0] === "run").length, 1);
  assert.equal(l.calls.filter((c) => c === "cli").length, 1);
});

test("start: no settled CLI, or one without the feature, runs nothing and logs nothing", async () => {
  for (const readCli of [async () => null, async () => ({ ...CLI, features: [] })]) {
    const l = launch({ readCli });
    await l.launch.start();
    assert.ok(!l.calls.includes("preference"), "the preference is not read");
    assert.ok(!l.calls.some((c) => Array.isArray(c) && c[0] === "run"));
    assert.deepEqual(lines(l.calls), []);
    assert.equal(l.launch.take(), null);
  }
});

test("start: the preference off runs nothing and logs one line; malformed runs nothing and logs another", async () => {
  const off = launch({ preference: () => ({ resumeAtLaunch: false }) });
  await off.launch.start();
  assert.ok(!off.calls.some((c) => Array.isArray(c) && c[0] === "run"));
  assert.deepEqual(lines(off.calls), [["log", "oats-desktop: resuming lost sessions when Desktop opens is turned off"]]);
  const malformed = launch({ preference: () => ({ resumeAtLaunch: false, malformed: true }) });
  await malformed.launch.start();
  assert.ok(!malformed.calls.some((c) => Array.isArray(c) && c[0] === "run"));
  assert.deepEqual(lines(malformed.calls), [["error", "oats-desktop: the session resume preference could not be read; lost sessions are not resumed at this launch"]]);
  // The real reader behind it: missing on, malformed off.
  const missing = launch({ preference: () => readResumePreference(join("/", "nonexistent", "session-resume.json")) });
  await missing.launch.start();
  assert.equal(missing.launch.take(), SUMMARY, "a missing file is on");
});

test("start: busy, quiet and unsupported leave nothing pending and log nothing; failed logs its code only", async () => {
  for (const reading of [{ kind: "busy" }, { kind: "quiet", summary: SUMMARY }, { kind: "unsupported" }]) {
    const l = launch({ read: () => reading });
    await l.launch.start();
    assert.ok(!l.calls.includes("broadcast"), reading.kind);
    assert.deepEqual(lines(l.calls), [], reading.kind);
    assert.equal(l.launch.take(), null, reading.kind);
  }
  const failed = launch({ read: () => ({ kind: "failed", code: "E_CLI_FAILED" }) });
  await failed.launch.start();
  assert.deepEqual(lines(failed.calls), [["error", "oats-desktop: the session resume sweep failed: E_CLI_FAILED"]]);
  assert.equal(failed.launch.take(), null);
  // A code that is not one is never logged as text.
  const odd = launch({ read: () => ({ kind: "failed", code: "kernel says: rm -rf /home/x" }) });
  await odd.launch.start();
  assert.deepEqual(lines(odd.calls), [["error", "oats-desktop: the session resume sweep failed: E_CLI_PROTOCOL"]]);
});

test("start: never rejects; a throw anywhere is one line without its text", async () => {
  const secret = new Error("stderr: /home/someone/secret");
  for (const overrides of [
    { readCli: async () => { throw secret; } },
    { preference: () => { throw secret; } },
    { run: async () => { throw secret; } },
    { read: () => { throw secret; } },
  ]) {
    const l = launch(overrides);
    await l.launch.start();
    assert.deepEqual(lines(l.calls), [["error", "oats-desktop: the session resume sweep could not be run"]]);
    assert.equal(l.launch.take(), null);
  }
});

test("take: the summary once, then null; null before the sweep has one", async () => {
  const l = launch();
  assert.equal(l.launch.take(), null, "before");
  await l.launch.start();
  assert.equal(l.launch.take(), SUMMARY);
  assert.equal(l.launch.take(), null);
  assert.equal(l.launch.take(), null);
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
const RENDERER = "file:///fixture/renderer/index.html";
/** Main's shipped trusted-frame guard, from its source. */
function shippedGuard() {
  const start = main.indexOf("function trustedFrame(e) {"), end = main.indexOf("// ---- IPC: the theme of this computer", start);
  assert.ok(start >= 0 && end > start, "main.mjs defines its guard just before the host theme");
  return runInNewContext(`${main.slice(start, end)}\nguard`, { trustedRendererUrl, RENDERER_URL: RENDERER });
}

test("IPC: every channel refuses an untrusted frame before it reads, writes or takes anything", async (t) => {
  const u = userData(t);
  const handlers = new Map(), taken = [];
  installResumeHandlers({ ipc: { handle: (channel, fn) => handlers.set(channel, fn) }, guard: shippedGuard(),
    launch: { take: () => { taken.push(1); return SUMMARY; } }, file: () => u.file });
  assert.deepEqual([...handlers.keys()], ["session-resume:take", "session-resume:preference", "session-resume:set-preference"]);
  for (const [channel, handler] of handlers) {
    for (const url of ["https://evil.example/", "file:///fixture/renderer/other.html", "file:///fixture/renderer/index.html#ws=", undefined]) {
      assert.throws(() => handler({ senderFrame: url === undefined ? undefined : { url } }, false), /forbidden: untrusted frame/, `${channel} ${url}`);
    }
  }
  assert.deepEqual(taken, []);
  assert.deepEqual(readdirSync(u.dir), [], "nothing written");
  const ok = { senderFrame: { url: RENDERER } };
  assert.deepEqual(handlers.get("session-resume:preference")(ok), { resumeAtLaunch: true }, "missing: on");
  assert.deepEqual(handlers.get("session-resume:set-preference")(ok, "off"), { ok: false, code: "E_BAD_ARGS" });
  assert.deepEqual(handlers.get("session-resume:set-preference")(ok, false), { ok: true, resumeAtLaunch: false });
  assert.deepEqual(handlers.get("session-resume:preference")(ok), { resumeAtLaunch: false });
  writeFileSync(u.file, "not json");
  assert.deepEqual(handlers.get("session-resume:preference")(ok), { resumeAtLaunch: false }, "malformed answers false, and only resumeAtLaunch");
  assert.equal(handlers.get("session-resume:take")(ok), SUMMARY);
  assert.deepEqual(taken, [1]);
});

// ── main.mjs wiring (source) ─────────────────────────────────────────────────

test("main constructs the launch with the settled CLI, the runner, the reader, userData/session-resume.json and its guard", async () => {
  const start = main.indexOf("const RESUME_PREFERENCE_FILE = () =>"), tail = "installResumeHandlers({ ipc: ipcMain, guard, launch: resumeAtLaunch, file: RESUME_PREFERENCE_FILE });";
  const end = main.indexOf(tail, start);
  assert.ok(start >= 0 && end > start, "main.mjs wires the launch's sweep");
  const calls = {}, sends = [], guard = () => {}, ipcMain = {};
  const readServedCli = () => {}, runResumeSweep = (...args) => { calls.run = args; return "envelope"; };
  const resumeSupported = () => true, readResumeSweep = () => {};
  const made = { start() {}, take() {} };
  runInNewContext(`${main.slice(start, end + tail.length)}\n;({ file: RESUME_PREFERENCE_FILE() })`, {
    app: { getPath: (name) => { assert.equal(name, "userData"); return "/user/data"; } }, join, ipcMain, guard, readServedCli,
    settledCli: (read, options) => { calls.settled = [read, options]; return "cli"; },
    resumeSupported, runResumeSweep, readResumeSweep,
    readResumePreference: (file) => { calls.preference = file; return { resumeAtLaunch: true }; },
    sendToLiveWindows: (windows, channel) => sends.push([windows, channel]),
    BrowserWindow: { getAllWindows: () => ["w1", "w2"] },
    createResumeAtLaunch: (io) => { calls.io = io; return made; },
    installResumeHandlers: (options) => { calls.handlers = options; },
    console: { log: (line) => { calls.logged = line; }, error: (line) => { calls.errored = line; } },
  });
  const io = calls.io;
  assert.equal(await io.readCli(), "cli");
  assert.equal(calls.settled[0], readServedCli);
  assert.equal(JSON.stringify(calls.settled[1]), '{"attempts":60}', "as startupDeploymentList reads it");
  assert.equal(io.supported, resumeSupported); assert.equal(io.read, readResumeSweep);
  assert.equal(io.run("the cli"), "envelope");
  assert.deepEqual(calls.run, ["the cli"], "the runner's default exec: no io is passed");
  io.preference();
  assert.equal(calls.preference, "/user/data/session-resume.json");
  io.broadcast();
  assert.deepEqual(sends, [[["w1", "w2"], "session-resume:ready"]]);
  io.log("a"); io.error("b");
  assert.equal(calls.logged, "a"); assert.equal(calls.errored, "b");
  assert.equal(calls.handlers.guard, guard, "the existing trusted-frame guard");
  assert.equal(calls.handlers.ipc, ipcMain); assert.equal(calls.handlers.launch, made);
  assert.equal(calls.handlers.file(), "/user/data/session-resume.json");
});

/** The primary instance's startup callback, from its source. */
function startupCallback() {
  const start = main.indexOf("const primaryInstance = startSingleInstance(app,"), end = main.indexOf("}, ownLaunch(app), offerVersionRestart);", start);
  assert.ok(start >= 0 && end > start, "main.mjs has the primary instance's startup");
  return { start, end, source: main.slice(start, end) };
}
const CHAIN = /void startupDeploymentList\(launchedPath\)\.catch\(\(e\) => console\.error\(`oats-desktop: \$\{e\?\.message \|\| e\}`\)\)\s*\.finally\(\(\) => resumeAtLaunch\.start\(\)\);/;

test("main starts the sweep once, in the startup callback only, after the deployments-list step settles", () => {
  const startup = startupCallback();
  const starts = [...main.matchAll(/resumeAtLaunch\.start\(/g)].map((m) => m.index);
  assert.equal(starts.length, 1, "one start in main.mjs");
  assert.ok(starts[0] > startup.start && starts[0] < startup.end, "inside the primary instance's startup callback");
  assert.match(startup.source, CHAIN, "chained after the list step, whether it succeeded or failed, and void");
  assert.ok(startup.source.indexOf("await ensureServer();") < startup.source.search(CHAIN), "after the server is ensured");
  // Nowhere else: the launch is named only where it is made, given to its handlers and started.
  assert.deepEqual([...main.matchAll(/\bresumeAtLaunch\b/g)].length, 3);
  assert.equal([...main.matchAll(/\brunResumeSweep\b/g)].length, 2, "imported, and run only by the launch");
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

test("main's shipped chain runs the sweep after the list step resolves, and after it rejects, without waiting on it", async () => {
  const chain = startupCallback().source.match(CHAIN)[0];
  for (const outcome of ["resolve", "reject"]) {
    const order = [];
    let settle;
    const listed = new Promise((resolve, reject) => { settle = () => (outcome === "resolve" ? resolve() : reject(new Error("list failed"))); });
    runInNewContext(chain, {
      launchedPath: "/d",
      startupDeploymentList: (path) => { order.push(["list", path]); return listed; },
      resumeAtLaunch: { start: () => { order.push("start"); return new Promise(() => {}); } },
      console: { error: (line) => order.push(["error", line]) },
    });
    order.push("startup goes on");
    await tick();
    assert.deepEqual(order, [["list", "/d"], "startup goes on"], `${outcome}: not before the list step settles`);
    settle();
    await tick(); await tick();
    assert.deepEqual(order, outcome === "resolve"
      ? [["list", "/d"], "startup goes on", "start"]
      : [["list", "/d"], "startup goes on", ["error", "oats-desktop: list failed"], "start"], outcome);
  }
});

test("shutdown leaves the sweep's child alone: quit names nothing of it", () => {
  const at = main.indexOf("async function shutdown() {");
  assert.ok(at >= 0);
  const body = main.slice(at, main.indexOf("\n}\n", at));
  assert.doesNotMatch(body, /resume/i);
  const quit = main.slice(main.indexOf("let quitStarted = false"), main.indexOf("process.on(sig, () => app.quit());"));
  assert.ok(quit.length > 0);
  assert.doesNotMatch(quit, /resume/i);
  // The launch holds no child and has nothing to dispose.
  assert.deepEqual(Object.keys(launch().launch).sort(), ["start", "take"]);
});

// ── preload.cjs ──────────────────────────────────────────────────────────────

test("preload: the four bridge functions invoke their channels, and the ready event hands over nothing and unsubscribes", async () => {
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
  runInNewContext(readFileSync(new URL("../preload.cjs", import.meta.url), "utf8"),
    { process: { argv: [] }, require: (name) => (name === "electron" ? electron : require(name === "./terminal-bridge.cjs" ? "../terminal-bridge.cjs" : name)) });
  assert.equal(await api.takeResumeNotice("ignored"), "answer");
  assert.equal(await api.resumeAtLaunch("ignored"), "answer");
  assert.equal(await api.setResumeAtLaunch(false, "ignored"), "answer");
  assert.deepEqual(invoked, [["session-resume:take"], ["session-resume:preference"], ["session-resume:set-preference", false]]);
  const heard = [];
  const off = api.onResumeNoticeReady((...args) => heard.push(args));
  listeners.get("session-resume:ready")({ sender: "the IPC event stays in the preload" }, "a payload is never passed on");
  assert.deepEqual(heard, [[]]);
  off();
  assert.equal(listeners.has("session-resume:ready"), false);
});
