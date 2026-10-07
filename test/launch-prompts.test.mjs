import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLaunchPromptController } from "../lib/launch-prompts.mjs";

// These invented frames exercise the mechanism. They are NOT accepted harness
// fixtures, source evidence, or a basis for enabling any production matcher.
const target = { socket: "/private/test.sock", windowId: "@4", paneId: "%7", pid: "42" };
function setup(t, options = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-launch-prompt-")));
  const home = join(base, "home");
  mkdirSync(home);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const prompt = `SYNTHETIC development plugin:aweb-channel@awebai-marketplace for ${home}\nYes [selected]\nExit`;
  const done = "SYNTHETIC known boundary";
  const frame = (text, kind, after = [], rest = {}) => ({ text, width: 80, height: 24, kind, after, ...rest });
  const fixture = { id: "synthetic-only", home, harness: "claude", version: "test-version", platform: "test-platform", frames: [
    frame(prompt, "prompt", [], { class: "awebDevelopmentChannel" }),
    frame(done, "completed", ["awebDevelopmentChannel"]),
    frame("SYNTHETIC startup", "startup"),
  ] };
  const io = { time: 0, text: prompt, sends: [], audits: [], captures: 0, snapshotHook: null, sendHook: null, auditHook: null,
    snapshot(tgt, timeout) {
      assert.ok(timeout > 0 && timeout <= 30000);
      this.captures++;
      const screen = { ...tgt, width: 80, height: 24, text: this.text };
      return this.snapshotHook?.(screen) ?? screen;
    },
    send(tgt, key, timeout) {
      assert.deepEqual(tgt, target);
      assert.ok(timeout > 0 && timeout <= 30000);
      this.sends.push(key);
      if (this.sendHook) return this.sendHook(key);
      this.text = done;
      return { status: "submitted" };
    },
    audit(data) {
      this.audits.push(data);
      return this.auditHook?.(data) ?? { ok: true, row: { at: "2026-10-06T00:00:00.000Z", kind: "launch-prompt", incarnation: "test-incarnation", data: { ...data } }, results: [{ path: join(home, "events.jsonl"), ok: true }, { path: "/unavailable/log", ok: false }] };
    },
  };
  const args = { home, startId: "start-test", harness: { name: "claude", version: "test-version", platform: "test-platform", developmentChannelEligible: true },
    policy: { awebDevelopmentChannel: true, consentSource: "local exact home" },
    transport: io, audit: data => io.audit(data), now: () => io.time, sleep: ms => { io.time += ms; }, fixtures: [fixture] };
  options.configure?.({ args, fixture, io, prompt, done, home, base });
  const controller = createLaunchPromptController(args);
  return { controller, io, fixture, args, prompt, done, home, base };
}

test("synthetic channel audits its sole submission and closes at exact boundary", t => {
  const { controller, io, home } = setup(t);
  const result = controller.observeNew(target);
  assert.equal(result.status, "completed");
  assert.deepEqual(io.sends, ["Enter"]);
  assert.deepEqual(result.answers.map(a => a.class), ["awebDevelopmentChannel"]);
  assert.deepEqual(io.audits.map(a => a.status), ["attempted", "submitted", "completed"]);
  assert.ok(io.audits.every(a => !JSON.stringify(a).includes("SYNTHETIC")));
  assert.equal(result.receipt[0].results[0].path, join(home, "events.jsonl"));
  assert.equal(result.receipt[0].results[1].ok, false);
  assert.equal(result.receipt[0].row.kind, "launch-prompt");
  assert.equal(result.receipt[0].row.data.startId, "start-test");
  assert.equal(result.receipt[0].row.data.status, "attempted");
  assert.equal(result.receipt[0].row.data.signatureId, "synthetic-only");
  assert.match(result.receipt[0].row.data.signatureDigest, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result.receipt).includes("SYNTHETIC"));
  assert.equal(controller.observeNew(target), result);
  assert.equal(io.sends.length, 1);
});

test("production default has no fixtures and never authorizes any prompt", t => {
  const { controller, io } = setup(t, { configure({ args }) { delete args.fixtures; } });
  assert.equal(controller.observeNew(target).reason, "blocked: unexpected prompt");
  assert.deepEqual(io.sends, []);
});

for (const change of ["directory", "question", "options", "partial", "wrapped", "ambiguous", "scrollback", "width", "height", "version", "platform", "home", "duplicate"]) {
  test(`exact fixture rejects ${change}`, t => {
    const { controller, io } = setup(t, { configure({ args, fixture, io, prompt }) {
      if (change === "directory") io.text = prompt.replace(fixture.home, "/foreign");
      if (change === "question") io.text = prompt.replace("development", "permission");
      if (change === "options") io.text = prompt.replace("Yes", "Always");
      if (change === "partial") io.text = prompt.slice(0, -4);
      if (change === "wrapped") io.text = prompt.replace("development", "develop\nment");
      if (change === "ambiguous") io.text = `${prompt}\n${prompt}`;
      if (change === "scrollback") io.text = `history\n${prompt}`;
      if (["width", "height"].includes(change)) io.snapshotHook = s => ({ ...s, [change]: 10 });
      if (change === "version") args.harness.version = "other";
      if (change === "platform") args.harness.platform = "other";
      if (change === "home") fixture.home += "/work";
      if (change === "duplicate") args.fixtures.push(structuredClone(fixture));
    } });
    assert.equal(controller.observeNew(target).status, "blocked");
    assert.deepEqual(io.sends, []);
  });
}

for (const policy of [{}, { awebDevelopmentChannel: false }, { awebDevelopmentChannel: "true" }, { workspaceTrust: true }]) {
  test(`strict exact class consent ${JSON.stringify(policy)}`, t => {
    const { controller, io } = setup(t, { configure({ args }) { args.policy = policy; } });
    assert.equal(controller.observeNew(target).reason, "blocked: prompt consent absent");
    assert.deepEqual(io.sends, []);
  });
}

test("selected mode alone never authorizes development", t => {
  for (const configure of [({ args }) => { args.policy.awebDevelopmentChannel = false; }, ({ args }) => { args.harness.developmentChannelEligible = false; }]) {
    const { controller, io } = setup(t, { configure });
    assert.equal(controller.observeNew(target).reason, "blocked: prompt consent absent");
    assert.deepEqual(io.sends, []);
  }
});

test("blank screen and allowed startup are bounded at 30 seconds and 100 ms", t => {
  for (const text of ["", " \n", "SYNTHETIC startup"]) {
    const { controller, io } = setup(t);
    io.text = text;
    assert.equal(controller.observeNew(target).reason, "blocked: observation timeout");
    assert.equal(io.time, 30000);
    assert.equal(io.captures, 300);
    assert.deepEqual(io.sends, []);
    assert.equal(controller.observeNew(target).status, "blocked");
  }
});

test("foreign or replaced target and capture failures never send", t => {
  for (const field of ["socket", "windowId", "paneId", "pid", "throw"]) {
    const { controller, io } = setup(t);
    io.snapshotHook = s => {
      if (field === "throw") throw new Error("secret output");
      return { ...s, [field]: "foreign" };
    };
    const result = controller.observeNew(target);
    assert.equal(result.status, "blocked");
    assert.deepEqual(io.sends, []);
    assert.ok(!JSON.stringify(result).includes("secret"));
  }
});

test("home inode substitution after intent prevents input", t => {
  const { controller, io, home } = setup(t);
  io.auditHook = data => {
    if (data.status === "attempted") { renameSync(home, home + "-old"); mkdirSync(home); }
    return { ok: true, results: [{ path: "/actual", ok: true }] };
  };
  assert.equal(controller.observeNew(target).status, "incomplete");
  assert.deepEqual(io.sends, []);
});

test("injected fixtures cannot authorize another prompt class", t => {
  for (const klass of ["workspaceTrust", "otherPermission"]) {
    const { controller, io } = setup(t, { configure({ fixture }) { fixture.frames[0].class = klass; } });
    assert.equal(controller.observeNew(target).status, "blocked");
    assert.deepEqual(io.sends, []);
  }
});

test("screen mutation while durable intent is written prevents input", t => {
  const { controller, io } = setup(t);
  io.auditHook = data => { if (data.status === "attempted") io.text = "different prompt"; return { ok: true }; };
  assert.equal(controller.observeNew(target).status, "blocked");
  assert.deepEqual(io.sends, []);
});

test("audit intent failure sends nothing and post-send failure is incomplete without retry", t => {
  for (const status of ["attempted", "submitted"]) {
    const { controller, io } = setup(t);
    io.auditHook = data => ({ ok: data.status !== status, results: [{ path: "/log", ok: data.status !== status }] });
    const result = controller.observeNew(target);
    assert.equal(result.status, "incomplete");
    assert.deepEqual(io.sends, status === "attempted" ? [] : ["Enter"]);
    controller.observeNew(target);
    assert.equal(result.answers.length, 0);
  }
});

test("failed, thrown, and ambiguous key outcomes are never retried or answered", t => {
  for (const result of [{ status: "failed" }, { status: "uncertain" }, undefined, "throw"]) {
    const { controller, io } = setup(t);
    io.sendHook = () => { if (result === "throw") throw new Error("possibly sent"); return result; };
    const observed = controller.observeNew(target);
    assert.equal(observed.status, "incomplete");
    assert.deepEqual(io.sends, ["Enter"]);
    assert.deepEqual(observed.answers, []);
    controller.observeNew(target);
    assert.deepEqual(io.sends, ["Enter"]);
  }
});

test("repeated prompt or unknown post-answer frame closes authority", t => {
  for (const mode of ["repeat", "unknown"]) {
    const { controller, io, prompt } = setup(t);
    io.sendHook = () => { io.text = mode === "repeat" ? prompt : "normal-looking but unknown"; return { status: "submitted" }; };
    const result = controller.observeNew(target);
    assert.equal(result.status, "blocked");
    assert.equal(result.answers[0].status, "submitted");
    assert.ok(result.receipt.some(r => r.row?.data.status === "submitted"));
    assert.deepEqual(io.sends, ["Enter"]);
    io.text = prompt;
    assert.equal(controller.observeNew(target), result);
    assert.deepEqual(io.sends, ["Enter"], "a later valid frame cannot reopen authority");
  }
});

test("respawn requires private old capture, changed PID, exact target and fresh bytes", t => {
  for (const mode of ["valid", "same-pid", "stale", "foreign", "missing", "forged"]) {
    const { controller, io, prompt } = setup(t);
    io.text = mode === "stale" ? prompt : "old process screen";
    const old = { ...target, pid: mode === "same-pid" ? target.pid : "41" };
    const token = mode === "missing" ? undefined : mode === "forged" ? { ok: true } : controller.captureBeforeRespawn(old);
    io.text = prompt;
    const result = controller.observeRespawn(mode === "foreign" ? { ...target, paneId: "%9" } : target, token);
    assert.equal(result.status, mode === "valid" ? "completed" : "blocked");
    if (mode !== "valid") assert.deepEqual(io.sends, []);
  }
});

test("respawn waits for visible bytes to change even after PID changes", t => {
  const { controller, io, prompt } = setup(t);
  const token = controller.captureBeforeRespawn({ ...target, pid: "41" });
  io.snapshotHook = s => {
    if (io.captures === 3) io.text = "";
    if (io.captures === 4) io.text = prompt;
    return s;
  };
  assert.equal(controller.observeRespawn(target, token).status, "completed");
  assert.ok(io.time >= 200);
});

test("other harnesses cannot answer the channel prompt", t => {
  const { controller, io } = setup(t, { configure({ args, fixture }) { args.harness.name = fixture.harness = "other"; } });
  assert.equal(controller.observeNew(target).status, "blocked");
  assert.deepEqual(io.sends, []);
});

function geometrySetup(t, configure = () => {}) {
  const calls = [], token = Object.freeze({ previous: { width: 100, height: 35, windowSize: "latest" } });
  const state = { pinned: false, restored: false };
  const result = setup(t, { configure(context) {
    const { args, io } = context;
    args.geometry = { width: 80, height: 24 };
    io.pin = (tgt, size, timeout) => {
      assert.deepEqual(tgt, target);
      assert.deepEqual(size, args.geometry);
      assert.ok(timeout > 0);
      calls.push("pin");
      state.pinned = true;
      return token;
    };
    io.restore = (tgt, given, timeout) => {
      assert.deepEqual(tgt, target);
      assert.equal(given, token);
      assert.equal(timeout, 3000);
      calls.push("restore");
      state.restored = true;
      return { status: "restored" };
    };
    io.snapshotHook = s => state.pinned ? s : { ...s, width: 100, height: 35 };
    configure(context, state);
  } });
  return { ...result, calls, state };
}

test("qualified geometry is audited and restored after successful closure", t => {
  const { controller, io, calls } = geometrySetup(t);
  assert.equal(controller.observeNew(target).status, "completed");
  assert.deepEqual(calls, ["pin", "restore"]);
  assert.deepEqual(io.audits.filter(a => a.action).map(a => [a.action, a.status]), [
    ["pin-geometry", "attempted"], ["pin-geometry", "submitted"], ["restore-geometry", "attempted"], ["restore-geometry", "submitted"],
  ]);
});

test("geometry restoration runs on blocked, timeout, send and audit failures", t => {
  for (const mode of ["unknown", "timeout", "send", "audit", "restore-audit", "restore-failure"]) {
    const { controller, io, calls } = geometrySetup(t, ({ io }) => {
      if (mode === "unknown") io.text = "unknown";
      if (mode === "timeout") io.text = "";
      if (mode === "send") io.sendHook = () => { throw new Error("unknown outcome"); };
      if (mode === "audit") io.auditHook = data => ({ ok: !(data.action === "pin-geometry" && data.status === "submitted") });
      if (mode === "restore-audit") io.auditHook = data => ({ ok: data.action !== "restore-geometry" });
    });
    if (mode === "restore-failure") io.restore = () => { calls.push("restore"); throw new Error("lost target"); };
    const result = controller.observeNew(target);
    assert.equal(result.status, ["unknown", "timeout"].includes(mode) ? "blocked" : "incomplete");
    assert.deepEqual(calls, ["pin", "restore"]);
  }
});

test("unqualified fixture and failed resize intent cannot mutate geometry", t => {
  for (const mode of ["no-fixture", "unqualified-version", "audit", "no-consent"]) {
    const { controller, calls } = geometrySetup(t, ({ args, io }) => {
      if (mode === "no-fixture") args.fixtures = [];
      if (mode === "unqualified-version") args.harness.version = "unknown";
      if (mode === "no-consent") args.policy = {};
      if (mode === "audit") io.auditHook = () => ({ ok: false });
    });
    assert.notEqual(controller.observeNew(target).status, "completed");
    assert.deepEqual(calls, []);
  }
});

test("respawn proves fresh bytes at original geometry before any pin", t => {
  for (const mode of ["stale", "geometry-changed", "fresh"]) {
    const { controller, io, prompt, calls } = geometrySetup(t);
    io.text = mode === "fresh" ? "old process" : prompt;
    const before = controller.captureBeforeRespawn({ ...target, pid: "41" });
    io.text = prompt;
    if (mode === "geometry-changed") io.snapshotHook = s => ({ ...s, width: 90, height: 35 });
    assert.equal(controller.observeRespawn(target, before).status, mode === "fresh" ? "completed" : "blocked");
    assert.deepEqual(calls, mode === "fresh" ? ["pin", "restore"] : []);
  }
});

test("partial pin with failed internal rollback is retained incomplete", t => {
  const { controller, io } = geometrySetup(t);
  io.pin = () => { throw Object.assign(new Error("partial mutation"), { geometryRestoreFailed: true }); };
  assert.equal(controller.observeNew(target).status, "incomplete");
  assert.deepEqual(io.sends, []);
});

test("creation-time home identity cannot be replaced before controller construction", t => {
  const { controller, io } = setup(t, { configure({ args }) { args.expectedHomeIdentity = { dev: -1, ino: -1 }; } });
  assert.notEqual(controller.observeNew(target).status, "completed");
  assert.deepEqual(io.sends, []);
});

test("qualified executable identity is revalidated after durable intent", t => {
  let valid = true;
  const { controller, io } = setup(t, { configure({ args, io }) {
    args.validateExecutable = () => valid;
    io.auditHook = data => { if (data.status === "attempted") valid = false; return { ok: true }; };
  } });
  assert.equal(controller.observeNew(target).status, "blocked");
  assert.deepEqual(io.sends, []);
});

test("pre-respawn capture and dispatch share the original 30-second deadline", t => {
  const { controller, io } = setup(t);
  io.text = "old screen";
  io.snapshotHook = screen => { io.time += 19000; return screen; };
  const before = controller.captureBeforeRespawn({ ...target, pid: "41" });
  assert.equal(before.ok, true);
  io.time += 1000; // Time spent dispatching belongs to this same authority.
  io.snapshotHook = screen => screen;
  io.text = "";
  const result = controller.observeRespawn(target, before);
  assert.equal(result.reason, "blocked: observation timeout");
  assert.equal(io.time, 30000);
  assert.equal(io.captures, 101);
  assert.deepEqual(io.sends, []);
});

test("constructor deadline can expire before any dispatch observation", t => {
  const { controller, io } = setup(t);
  io.time = 30000;
  assert.equal(controller.observeNew(target).reason, "blocked: observation timeout");
  assert.equal(io.captures, 0);
  assert.deepEqual(io.sends, []);
});

test("geometry pin waits one bounded observation interval before matching redraw", t => {
  let pinnedAt;
  const { controller, io } = geometrySetup(t, ({ io }, state) => {
    const pin = io.pin;
    io.pin = (...args) => { pinnedAt = io.time; return pin(...args); };
    io.snapshotHook = screen => {
      if (!state.pinned) return { ...screen, width: 100, height: 35 };
      assert.ok(io.time - pinnedAt >= 100, "resized capture waits for redraw");
      return screen;
    };
  });
  assert.equal(controller.observeNew(target).status, "completed");
  assert.deepEqual(io.sends, ["Enter"]);
});

test("failed rollback audit remains incomplete even if later terminal audit succeeds", t => {
  const { controller, io } = geometrySetup(t);
  io.pin = () => { throw Object.assign(new Error("partial pin rolled back"), { geometryRestored: true }); };
  io.auditHook = data => ({ ok: data.reason !== "partial pin rollback" });
  const result = controller.observeNew(target);
  assert.equal(result.status, "incomplete");
  assert.equal(io.audits.at(-1).status, "incomplete");
  assert.deepEqual(io.sends, []);
});
