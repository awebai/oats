import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { startSingleInstance, launchDirectory, createLaunchOpener } from "../single-instance.mjs";

function fixture(lock) {
  const app = new EventEmitter();
  const calls = [];
  app.requestSingleInstanceLock = () => { calls.push("lock"); return lock; };
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
