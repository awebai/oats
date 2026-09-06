import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createInstanceStarter } from "../renderer/start-instance.mjs";
import { setWorkspace } from "../renderer/views/common.mjs";
import { cliStart } from "../cli-adapter.mjs";

const tick = () => new Promise((r) => setImmediate(r));
function setup({ running = false, cli = { ok: true, features: ["session-start"], remote: ["session-start"] }, start, ready = true } = {}) {
  const dom = new JSDOM("<body><button id='opener'>Start</button></body>");
  setWorkspace("/workspace");
  const instance = { instance: "accountant-minerva", home: "/workspace/agents/accountant/instances/accountant-minerva", runtime: "claude", model: "sonnet", running };
  const calls = [], opened = [];
  const ctx = { api: async (path, opts) => {
    calls.push({ path, opts });
    if (path === "/api/cli") return cli;
    if (path.startsWith("/api/panel")) return { instances: [instance] };
    if (path === "/api/models") return { models: [{ id: "opus" }] };
    if (path.startsWith("/api/start/")) return start ? start() : { instance: instance.instance, home: instance.home };
    assert.fail(path);
  }, openTerminal: async (ref) => opened.push(ref) };
  const opener = dom.window.document.querySelector("#opener"); opener.focus();
  const open = createInstanceStarter(dom.window.document, ctx, { waitForReady: async () => ready });
  const modal = open(instance);
  const submit = () => modal.querySelector("form").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  const cleanup = () => { setWorkspace("/finished"); dom.window.close(); };
  return { dom, instance, calls, opened, modal, submit, cleanup, open };
}

test("Start chooses a model for the exact existing home then opens its terminal", async () => {
  const s = setup();
  try {
    await tick();
    assert.equal(s.modal.querySelector(".start-submit").disabled, false);
    assert.equal(s.modal.querySelector(".start-model").placeholder, "sonnet");
    s.modal.querySelector(".start-model").value = "opus";
    s.submit(); await tick();
    const call = s.calls.find((c) => c.path.startsWith("/api/start/"));
    const url = new URL(call.path, "http://localhost");
    assert.equal(url.searchParams.get("home"), s.instance.home);
    assert.equal(url.searchParams.get("ws"), "/workspace");
    assert.deepEqual(JSON.parse(call.opts.body), { model: "opus" });
    assert.deepEqual(s.opened, [s.instance]);
    assert.equal(s.modal.isConnected, false);
    assert.equal(s.dom.window.document.activeElement.id, "opener");
  } finally { s.cleanup(); }
});

test("already running opens the terminal, and unknown status never starts", async () => {
  for (const running of [true, null]) {
    const s = setup({ running });
    try {
      await tick(); s.submit(); await tick();
      assert.equal(s.calls.some((c) => c.path.startsWith("/api/start/")), false);
      assert.equal(s.opened.length, running ? 1 : 0);
      if (running === null) assert.match(s.modal.querySelector(".start-status").textContent, /verify/);
    } finally { s.cleanup(); }
  }
});

test("old CLI explains the update rather than sending an unsupported start", async () => {
  const s = setup({ cli: { ok: true, features: [], install: "npm install -g @awebai/oats@0.22.9" } });
  try {
    await tick(); s.submit(); await tick();
    assert.equal(s.modal.querySelector(".start-submit").disabled, true);
    assert.match(s.modal.querySelector(".start-status").textContent, /npm install/);
    assert.equal(s.calls.some((c) => c.path.startsWith("/api/start/")), false);
  } finally { s.cleanup(); }
});

test("double submit launches once; workspace switch cannot open the old instance", async () => {
  let finish;
  const s = setup({ start: () => new Promise((r) => { finish = r; }) });
  try {
    await tick(); s.submit(); s.submit();
    assert.equal(s.calls.filter((c) => c.path.startsWith("/api/start/")).length, 1);
    setWorkspace("/elsewhere"); finish({}); await tick();
    assert.equal(s.modal.isConnected, false);
    assert.equal(s.opened.length, 0);
  } finally { s.cleanup(); }
});

test("failed start requires a status refresh before retry and preserves the chosen model", async () => {
  const s = setup({ start: () => { throw new Error("Start timed out"); } });
  try {
    await tick(); s.modal.querySelector(".start-model").value = "opus";
    s.submit(); await tick();
    assert.match(s.modal.querySelector(".start-status").textContent, /timed out/);
    assert.equal(s.modal.querySelector(".start-submit").disabled, true);
    assert.equal(s.modal.querySelector(".start-model").value, "opus");
    s.modal.querySelector(".start-retry").click(); await tick();
    assert.equal(s.modal.querySelector(".start-submit").disabled, false);
  } finally { s.cleanup(); }
});

test("start adapter preserves saved home/server and treats the model as one argv value", async () => {
  let call;
  const exec = (bin, argv, opts, cb) => { call = { bin, argv, opts }; cb(null, '{"schemaVersion":1,"ok":true,"result":{"launched":true}}'); };
  const result = await cliStart("/installed/oats", { home: "/saved/home", workspaceDir: "/local", server: "remote", model: "provider/model" }, { exec });
  assert.equal(result.ok, true);
  assert.deepEqual(call.argv, ["session", "start", "--home", "/saved/home", "--server", "remote", "--model", "provider/model", "--json"]);
  assert.equal(call.opts.cwd, "/local");
  assert.equal(call.opts.shell, false);
  for (const model of ["--force", { nested: true }, "bad\0model"]) {
    const r = await cliStart("/installed/oats", { home: "/saved/home", model }, { exec: () => assert.fail("must not execute") });
    assert.equal(r.error.code, "E_BAD_ARGS");
  }
});

test("an accepted launch that exits permits recovery after a fresh status check", async () => {
  const s = setup({ ready: false });
  try {
    await tick(); s.submit(); await tick();
    assert.equal(s.opened.length, 0);
    assert.match(s.modal.querySelector(".start-status").textContent, /may have exited/);
    assert.equal(s.modal.querySelector(".start-submit").disabled, true);
    assert.equal(s.modal.querySelector(".start-retry").disabled, false);
    s.modal.querySelector(".start-retry").click(); await tick();
    assert.equal(s.modal.querySelector(".start-submit").disabled, false);
  } finally { s.cleanup(); }
});
