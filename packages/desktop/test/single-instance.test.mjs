import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { startSingleInstance, launchDirectory, createLaunchOpener, ownLaunch, versionHandoffBox, relaunchOptions,
  createVersionHandoff } from "../single-instance.mjs";

function fixture(lock, version = "0.67.1") {
  const app = new EventEmitter();
  const calls = [];
  app.getVersion = () => version;
  app.requestSingleInstanceLock = (data) => { calls.push("lock"); app.lockData = data; return lock; };
  app.quit = () => calls.push("quit");
  app.whenReady = () => { calls.push("ready"); return Promise.resolve(); };
  return { app, calls };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("secondary launch quits without starting a backend, window, or readiness work", async () => {
  const { app, calls } = fixture(false);
  assert.equal(startSingleInstance(app, () => { throw new Error("must not handle a launch"); },
    () => { throw new Error("must not start the desktop"); }), false);
  await tick();
  assert.deepEqual(calls, ["lock", "quit"]);
  assert.equal(app.listenerCount("second-instance"), 0);
});

test("a repeated launch during startup waits for it, then is handed its argv and working directory", async () => {
  const { app, calls } = fixture(true);
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const launches = [];
  assert.equal(startSingleInstance(app, (argv, cwd) => launches.push([argv, cwd]), async () => {
    calls.push("start"); await pending;
  }), true);
  app.emit("second-instance", {}, ["/Applications/OATS Desktop.app/Contents/MacOS/OATS Desktop", "--dir", "/d/a"], "/Users/juan");
  await tick();
  assert.deepEqual(calls, ["lock", "ready", "start"]); assert.deepEqual(launches, []);
  finish(); await tick();
  assert.deepEqual(launches, [[["/Applications/OATS Desktop.app/Contents/MacOS/OATS Desktop", "--dir", "/d/a"], "/Users/juan"]]);
  app.emit("second-instance", {}, [], "/"); await tick();
  assert.equal(calls.filter((x) => x === "start").length, 1, "one startup, one server");
  assert.equal(launches.length, 2);
});

// Chromium reorders a second instance's command line (switches first, loose arguments last), so the
// argv the running instance is handed can put another switch after --dir. The second instance sends its
// own argv and working directory with the lock request instead, and those are what a launch reads.
const REORDERED = ["/x/Electron", "--user-data-dir=/u", "--dir", "--allow-file-access-from-files", "--enable-avfoundation", "/app", "/d/beta"];

test("a second instance sends its own argv and working directory with the lock request", () => {
  const { app } = fixture(false);
  startSingleInstance(app, () => {}, () => {}, { argv: ["/x/Electron", "/app", "--dir", "/d/beta"], workingDirectory: "/Users/juan" });
  assert.deepEqual(app.lockData, { argv: ["/x/Electron", "/app", "--dir", "/d/beta"], workingDirectory: "/Users/juan" });
});

test("the running instance reads the launch's own argv, not Chromium's reordered one", async () => {
  const { app } = fixture(true);
  const launches = [];
  startSingleInstance(app, (argv, cwd) => launches.push([argv, cwd]), async () => {});
  await tick();
  app.emit("second-instance", {}, REORDERED, "/", { argv: ["/x/Electron", "/app", "--dir", "/d/beta"], workingDirectory: "/Users/juan" });
  await tick();
  assert.deepEqual(launches, [[["/x/Electron", "/app", "--dir", "/d/beta"], "/Users/juan"]]);
});

test("launch data of the wrong shape is not used: the event's own argv and directory are", async () => {
  for (const data of [undefined, null, "x", { argv: "nope" }, { argv: [1, 2] }, { argv: ["a"], workingDirectory: 7 }, { argv: Array(1001).fill("a") }]) {
    const { app } = fixture(true);
    const launches = [];
    startSingleInstance(app, (argv, cwd) => launches.push([argv, cwd]), async () => {});
    await tick();
    app.emit("second-instance", {}, ["/x/Electron"], "/w", data);
    await tick();
    assert.deepEqual(launches, [[["/x/Electron"], "/w"]], JSON.stringify(data));
  }
});

// ── A launch of another version (an installer replaced while Desktop runs) ──

test("a launch sends its version and what relaunches its copy: the AppImage file when there is one", () => {
  const proc = (env) => ({ argv: ["/tmp/.mount_x/oats-desktop", "--dir", "/d"], cwd: () => "/home/j", env, execPath: "/tmp/.mount_x/oats-desktop" });
  const app = { getVersion: () => "0.67.1" };
  assert.deepEqual(ownLaunch(app, proc({ APPIMAGE: "/home/j/OATS-Desktop-0.67.1.AppImage" })), { argv: ["/tmp/.mount_x/oats-desktop", "--dir", "/d"],
    workingDirectory: "/home/j", version: "0.67.1", execPath: "/home/j/OATS-Desktop-0.67.1.AppImage" });
  assert.equal(ownLaunch(app, proc({})).execPath, "/tmp/.mount_x/oats-desktop", "a DEB or a checkout: its executable");
  assert.equal(ownLaunch(app, proc({ APPIMAGE: "" })).execPath, "/tmp/.mount_x/oats-desktop");
});

test("the lock request carries the injected launch's version and execPath", () => {
  const { app } = fixture(false);
  const launch = { argv: ["/x/oats-desktop"], workingDirectory: "/w", version: "0.67.1", execPath: "/x/oats.AppImage" };
  startSingleInstance(app, () => {}, () => {}, launch);
  assert.deepEqual(app.lockData, launch);
});

/** A running 0.65.0 handed one launch; what onSecondLaunch and onOtherVersion saw, in order. */
async function handOver(data, { running = "0.65.0", handled = "win" } = {}) {
  const { app } = fixture(true, running);
  const log = [];
  startSingleInstance(app, async (argv) => { await tick(); log.push(["launch", argv]); return handled; }, async () => {},
    undefined, (launch, win) => log.push(["other-version", launch, win]));
  await tick();
  app.emit("second-instance", {}, ["/x/reordered"], "/", data);
  for (let i = 0; i < 4; i++) await tick();
  return log;
}
const SENT = { argv: ["/m/oats-desktop", "--dir", "/d/a"], workingDirectory: "/w", version: "0.67.1", execPath: "/home/j/OATS.AppImage" };

test("a different version: the launch is handled first, then handed on with its validated launch and window", async () => {
  assert.deepEqual(await handOver(SENT), [["launch", SENT.argv], ["other-version", SENT, "win"]]);
  const older = await handOver({ ...SENT, version: "0.65.0" }, { running: "0.67.1" });
  assert.equal(older[1][1].version, "0.65.0", "an older launch while a newer runs is told too");
});

test("same version, no version or a malformed one: handled as before, nothing more", async () => {
  for (const version of ["0.65.0", undefined, null, "", 65, ["0.67.1"], "0.67.1 beta", "0.67.1;rm", "v".repeat(65), "0.67.1\n"]) {
    const log = await handOver({ ...SENT, version });
    assert.deepEqual(log, [["launch", SENT.argv]], JSON.stringify(version));
  }
  assert.equal((await handOver({ ...SENT, version: "1".repeat(64) }))[1]?.[0], "other-version", "64 characters is a version");
  assert.equal((await handOver({ ...SENT, version: "1.0.0-rc.1+b.2" }))[1]?.[0], "other-version");
});

test("a relative, oversized, non-string or NUL-bearing execPath reads as none: the version is still told", async () => {
  for (const execPath of ["oats.AppImage", "./x", "/" + "a".repeat(4096), 7, null, undefined, "/x\0y"]) {
    const log = await handOver({ ...SENT, execPath });
    assert.equal(log[1]?.[0], "other-version", JSON.stringify(execPath));
    assert.equal(log[1][1].execPath, null, JSON.stringify(execPath));
  }
  assert.equal((await handOver({ ...SENT, execPath: "/" + "a".repeat(4095) }))[1][1].execPath.length, 4096);
});

test("a launch whose handling fails is not followed by the version box", async () => {
  const { app } = fixture(true, "0.65.0");
  const seen = [], logged = [];
  const original = console.error; console.error = (m) => logged.push(String(m));
  try {
    startSingleInstance(app, () => { throw new Error("boom"); }, async () => {}, undefined, () => seen.push("other"));
    await tick();
    app.emit("second-instance", {}, [], "/", SENT); await tick(); await tick();
  } finally { console.error = original; }
  assert.deepEqual(seen, []); assert.equal(logged.length, 1);
});

test("the box: Restart into the launched version (default) or Keep the running one (cancel, Esc)", () => {
  assert.deepEqual(versionHandoffBox("0.67.1", "0.65.0", true), {
    type: "info", title: "OATS Desktop", noLink: true,
    message: "OATS Desktop 0.67.1 was opened, but 0.65.0 is still running.",
    detail: "The version you opened takes effect only after this one quits. Restarting closes Desktop's windows and starts 0.67.1; your agents keep running in their sessions.",
    buttons: ["Restart into 0.67.1", "Keep 0.65.0"], defaultId: 0, cancelId: 1,
  });
});

test("the box with no usable relaunch path: one OK, and how to switch by hand", () => {
  assert.deepEqual(versionHandoffBox("0.67.1", "0.65.0", false), {
    type: "info", title: "OATS Desktop", noLink: true,
    message: "OATS Desktop 0.67.1 was opened, but 0.65.0 is still running.",
    detail: "The version you opened takes effect only after this one quits. Quit OATS Desktop, then open it again.",
    buttons: ["OK"], defaultId: 0, cancelId: 0,
  });
});

test("relaunch options: the sent execPath and the sent argv after its executable", () => {
  assert.deepEqual(relaunchOptions(SENT), { execPath: "/home/j/OATS.AppImage", args: ["--dir", "/d/a"] });
  assert.deepEqual(relaunchOptions({ ...SENT, argv: ["/m/oats-desktop"] }).args, []);
  assert.deepEqual(relaunchOptions({ ...SENT, argv: [] }).args, []);
});

test("the running instance relaunches the sent argv, not Chromium's reordered one", async () => {
  const { app } = fixture(true, "0.65.0");
  const relaunched = [];
  const offer = createVersionHandoff({ running: "0.65.0", ask: async () => ({ response: 0 }), isRegularFile: () => true,
    relaunch: (o) => relaunched.push(o), quit: () => {} });
  startSingleInstance(app, async () => "win", async () => {}, undefined, offer);
  await tick();
  app.emit("second-instance", {}, REORDERED, "/", { ...SENT, argv: ["/x/Electron", "/app", "--dir", "/d/beta"] });
  for (let i = 0; i < 4; i++) await tick();
  assert.deepEqual(relaunched, [{ execPath: SENT.execPath, args: ["/app", "--dir", "/d/beta"] }]);
});

function handoff({ responses = [0], files = () => true, askFails = false } = {}) {
  const log = [];
  const pending = [];
  const offer = createVersionHandoff({
    running: "0.65.0",
    ask: (win, box) => {
      log.push(["ask", win, box.buttons]);
      if (askFails) return Promise.reject(new Error("window gone"));
      const response = responses.shift();
      if (response === "hold") return new Promise((resolve) => pending.push(resolve));
      return Promise.resolve({ response });
    },
    isRegularFile: (path) => { log.push(["stat", path]); return files(path); },
    relaunch: (options) => log.push(["relaunch", options]),
    quit: () => log.push(["quit"]),
  });
  return { offer, log, pending };
}

test("Restart relaunches the launched copy and quits through the normal path", async () => {
  const h = handoff({ responses: [0] });
  await h.offer(SENT, "win");
  assert.deepEqual(h.log, [["stat", SENT.execPath], ["ask", "win", ["Restart into 0.67.1", "Keep 0.65.0"]], ["stat", SENT.execPath],
    ["relaunch", { execPath: SENT.execPath, args: ["--dir", "/d/a"] }], ["quit"]]);
});

test("Keep (or Esc) changes nothing, and the next launch asks again", async () => {
  const h = handoff({ responses: [1, 1] });
  await h.offer(SENT, "win"); await h.offer(SENT, "win");
  assert.deepEqual(h.log.filter(([k]) => k !== "stat").map(([k]) => k), ["ask", "ask"]);
});

test("no window: the box is shown unparented", async () => {
  const h = handoff({ responses: [1] });
  await h.offer(SENT, undefined);
  assert.equal(h.log.find(([k]) => k === "ask")[1], null);
});

test("no usable relaunch path (none sent, missing, not a regular file, unreadable): OK only, never a relaunch", async () => {
  for (const [execPath, files] of [[null, () => assert.fail("nothing to check")], ["/gone", () => false], ["/dir", () => false],
    ["/denied", () => { throw new Error("EACCES"); }]]) {
    const h = handoff({ responses: [0], files });
    await h.offer({ ...SENT, execPath }, "win");
    assert.deepEqual(h.log.filter(([k]) => k !== "stat"), [["ask", "win", ["OK"]]], String(execPath));
  }
});

test("a relaunch path gone while the box was open is not run: the OK box says how instead", async () => {
  let present = true;
  const h = handoff({ responses: [0, 0], files: () => { const was = present; present = false; return was; } });
  await h.offer(SENT, "win");
  assert.deepEqual(h.log.filter(([k]) => k !== "stat"), [["ask", "win", ["Restart into 0.67.1", "Keep 0.65.0"]], ["ask", "win", ["OK"]]]);
});

test("while one box is open another launch does not stack a second; once it closes, the next one asks", async () => {
  const h = handoff({ responses: ["hold", 1] });
  const first = h.offer(SENT, "win");
  await h.offer({ ...SENT, version: "0.68.0" }, "win2");
  assert.equal(h.log.filter(([k]) => k === "ask").length, 1);
  h.pending[0]({ response: 1 }); await first;
  await h.offer(SENT, "win");
  assert.equal(h.log.filter(([k]) => k === "ask").length, 2);
});

test("a box that fails (its window closed underneath) is logged and changes nothing", async () => {
  const h = handoff({ askFails: true });
  const logged = [];
  const original = console.error; console.error = (m) => logged.push(String(m));
  try {
    await h.offer(SENT, "win");
    assert.deepEqual(h.log.filter(([k]) => k === "relaunch" || k === "quit"), []);
    assert.match(logged[0], /version message not shown: window gone/);
    h.log.length = 0;
    await h.offer(SENT, "win");
    assert.equal(h.log.filter(([k]) => k === "ask").length, 1, "not left marked open");
  } finally { console.error = original; }
});

// ── main.mjs's own wiring, evaluated from its source ──

const main = readFileSync(new URL("../main.mjs", import.meta.url), "utf8");

test("main: the opener resolves with the window the launch opened or focused", async () => {
  const start = main.indexOf("const openLaunch = createLaunchOpener({"), end = main.indexOf("// A repeated launch of another version", start);
  assert.ok(start >= 0 && end > start, "main.mjs builds the launch opener");
  const ctx = { createLaunchOpener, realpathSync: (p) => p, wsValidate: (p) => p === "/d/a",
    performAdd: async () => ({ ok: true, workspace: { id: "/d/a" } }), resolveView: () => "ws:a", panelWorkspaces: async () => [], servedList: [],
    openWorkspaceWindow: (key) => ({ opened: true, win: `window of ${key}` }), windows: { focusRecent: () => "recent window" } };
  const openLaunch = runInNewContext(`${main.slice(start, end)}\nopenLaunch`, ctx);
  assert.equal(await openLaunch("/d/a"), "window of ws:a");
  assert.equal(await openLaunch("/home"), "recent window");
});

test("main: the version box is native, over the launch's window when it is alive, and Restart relaunches then quits", async () => {
  const start = main.indexOf("const offerVersionRestart = createVersionHandoff({"), end = main.indexOf("const primaryInstance = startSingleInstance(", start);
  assert.ok(start >= 0 && end > start, "main.mjs builds the version handoff just before the lock");
  const calls = [];
  const ctx = { createVersionHandoff,
    app: { getVersion: () => "0.65.0", relaunch: (o) => calls.push(["relaunch", o]), quit: () => calls.push(["quit"]) },
    dialog: { showMessageBox: (...args) => { calls.push(["box", args.length === 2 ? args[0].name : null, args.at(-1).buttons]); return Promise.resolve({ response: 0 }); } },
    statSync: (path) => ({ isFile: () => path === SENT.execPath }) };
  const offer = runInNewContext(`${main.slice(start, end)}\nofferVersionRestart`, ctx);
  await offer(SENT, { name: "win", isDestroyed: () => false });
  assert.deepEqual(calls, [["box", "win", ["Restart into 0.67.1", "Keep 0.65.0"]], ["relaunch", { execPath: SENT.execPath, args: ["--dir", "/d/a"] }], ["quit"]]);
  calls.length = 0;
  await offer({ ...SENT, execPath: "/a/dir" }, { name: "closed", isDestroyed: () => true });
  assert.deepEqual(calls, [["box", null, ["OK"]]], "a destroyed window: unparented; not a regular file: OK only");
});

test("main: the lock request sends ownLaunch and different versions go to the handoff", () => {
  assert.match(main, /\n\}, ownLaunch\(app\), offerVersionRestart\);\n\nif \(primaryInstance\) app\.on\("window-all-closed"/);
  assert.match(main, /const primaryInstance = startSingleInstance\(app, \(argv, workingDirectory\) => openLaunch\(launchDirectory\(argv, workingDirectory\)\), async \(\) => \{/);
});

test("a launch whose handler fails is reported, never swallowed", async () => {
  const { app } = fixture(true);
  const logged = [];
  const original = console.error; console.error = (m) => logged.push(String(m));
  try {
    startSingleInstance(app, () => { throw new Error("boom"); }, async () => {});
    await tick();
    app.emit("second-instance", {}, [], "/"); await tick(); await tick();
  } finally { console.error = original; }
  assert.equal(logged.length, 1); assert.match(logged[0], /second launch.*boom/);
});

test("launchDirectory: a --dir followed by another switch (a reordered argv) is no --dir", () => {
  assert.equal(launchDirectory(REORDERED, "/w"), "/w");
});

test("launchDirectory: --dir (relative to the launch's working directory), else that directory", () => {
  assert.equal(launchDirectory(["app", "--dir", "/d/a"], "/x"), "/d/a");
  assert.equal(launchDirectory(["app", "--some-flag", "--dir", "a/b"], "/x/y"), "/x/y/a/b");
  assert.equal(launchDirectory(["app"], "/d/b"), "/d/b");
  assert.equal(launchDirectory(["app", "--dir"], "/d/b"), "/d/b", "a --dir with no value is no --dir");
  assert.equal(launchDirectory(["app"], ""), null);
  assert.equal(launchDirectory(undefined, undefined), null);
});

function opener({ deployments = ["/d/new", "/d/open"], views = { "/d/new": "ws:new", "/d/open": "ws:open" }, admitFails = false } = {}) {
  const log = [];
  const open = createLaunchOpener({
    isDeployment: (dir) => deployments.includes(dir),
    admit: async (dir) => { log.push(["admit", dir]); return admitFails ? null : views[dir]; },
    open: (key) => log.push(["open", key]),
    focusRecent: () => log.push(["focus-recent"]),
  });
  return { open, log };
}

test("second launch with --dir for a new workspace: admitted through the add path, then its window opened", async () => {
  const o = opener();
  await o.open("/d/new");
  assert.deepEqual(o.log, [["admit", "/d/new"], ["open", "ws:new"]]);
});

test("second launch with --dir for an open workspace: the add path finds it served; its window is opened or focused", async () => {
  const o = opener();
  await o.open("/d/open");
  assert.deepEqual(o.log, [["admit", "/d/open"], ["open", "ws:open"]], "open() focuses the window that holds it (window-set)");
});

test("second launch with a non-deployment, or no dir: nothing is admitted; the most recent window is focused", async () => {
  for (const dir of ["/Users/juan", null]) {
    const o = opener();
    await o.open(dir);
    assert.deepEqual(o.log, [["focus-recent"]], String(dir));
  }
});

test("second launch whose add fails: the most recent window is focused", async () => {
  const o = opener({ admitFails: true });
  await o.open("/d/new");
  assert.deepEqual(o.log, [["admit", "/d/new"], ["focus-recent"]]);
});

test("a check that throws is not a deployment", async () => {
  const log = [];
  const open = createLaunchOpener({ isDeployment: () => { throw new Error("EACCES"); }, admit: async () => "x",
    open: () => log.push("open"), focusRecent: () => log.push("focus-recent") });
  await open("/d/x");
  assert.deepEqual(log, ["focus-recent"]);
});
