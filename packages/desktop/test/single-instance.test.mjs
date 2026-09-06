import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { startSingleInstance } from "../single-instance.mjs";

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
  assert.equal(startSingleInstance(app, () => { throw new Error("must not inspect windows"); },
    () => { throw new Error("must not start the desktop"); }), false);
  await tick();
  assert.deepEqual(calls, ["lock", "quit"]);
  assert.equal(app.listenerCount("second-instance"), 0);
});

test("repeated launch during startup waits, then restores and focuses the existing window", async () => {
  const { app, calls } = fixture(true);
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const win = { isDestroyed: () => false, isMinimized: () => true,
    restore: () => calls.push("restore"), show: () => calls.push("show"), focus: () => calls.push("focus") };
  assert.equal(startSingleInstance(app, () => [win], async () => {
    calls.push("start"); await pending;
  }), true);
  app.emit("second-instance");
  await tick();
  assert.deepEqual(calls, ["lock", "ready", "start"]);
  finish(); await tick();
  assert.deepEqual(calls, ["lock", "ready", "start", "restore", "show", "focus"]);
  app.emit("second-instance"); await tick();
  assert.equal(calls.filter((x) => x === "start").length, 1);
  assert.equal(calls.filter((x) => x === "focus").length, 2);
});

test("a repeated launch after the window closes does not create another window", async () => {
  const { app, calls } = fixture(true);
  startSingleInstance(app, () => [{ isDestroyed: () => true }], () => calls.push("start"));
  await tick(); app.emit("second-instance"); await tick();
  assert.deepEqual(calls, ["lock", "ready", "start"]);
});
