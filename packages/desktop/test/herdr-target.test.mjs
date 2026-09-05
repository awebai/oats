import test from "node:test";
import assert from "node:assert/strict";
import { herdrTargetKey, readHerdrTarget, openHerdrTerm } from "../herdr-target.mjs";
import { requireExecutionSupport } from "../cli-locator.mjs";
const target = { backend: "herdr", socket: "/tmp/herdr.sock", paneId: "w1:p1", terminalId: "term_abc123", protocol: 20, binary: "/untrusted/workspace/program" };
test("Desktop inspects Herdr with a host-owned executable and exact terminal identity", () => {
  const inspect = (terminal) => readHerdrTarget(target, (binary, argv, options) => {
    assert.equal(binary, "herdr");
    assert.equal(options.env.HERDR_SOCKET_PATH, target.socket);
    return JSON.stringify({ result: { snapshot: { protocol: 20, panes: [{ pane_id: "w1:p1", terminal_id: terminal }] } } });
  });
  assert.equal(inspect("term_abc123").present, true);
  assert.equal(inspect("term_replacement").present, false);
  assert.notEqual(herdrTargetKey(target), herdrTargetKey({ ...target, socket: "/tmp/another.sock" }));
});
test("Desktop viewer preflights the terminal and closing the viewer performs no lifecycle operation", () => {
  let spawnCount = 0;
  const spawnPty = (argv, cols, rows) => { spawnCount++; assert.deepEqual(argv, ["terminal", "attach", target.terminalId]); assert.equal(cols, 100); assert.equal(rows, 30); return {}; };
  assert.throws(() => openHerdrTerm({ sessionTarget: target, cols: 100, rows: 30 }, { inspect: () => ({ present: false }), spawnPty }), /no longer exists/);
  assert.equal(spawnCount, 0);
  const result = openHerdrTerm({ sessionTarget: target, cols: 100, rows: 30 }, { inspect: () => ({ present: true }), spawnPty });
  result.killViewer();
  assert.equal(spawnCount, 1);
});
test("old CLI cannot silently substitute an unsupported runtime or backend", () => {
  const old = { version: "0.22.1" };
  assert.doesNotThrow(() => requireExecutionSupport(old, "pi", "tmux"));
  assert.throws(() => requireExecutionSupport(old, "codex", "tmux"), /does not support runtime codex/);
  assert.throws(() => requireExecutionSupport(old, "claude", "herdr"), /does not support session backend herdr/);
  assert.doesNotThrow(() => requireExecutionSupport({ ...old, runtimes: ["codex"], sessionBackends: ["herdr"] }, "codex", "herdr"));
});

test("old CLI cannot silently ignore explicit yolo overrides", () => {
  assert.throws(() => requireExecutionSupport({ version: "old" }, "claude", "tmux", false), /yolo overrides/);
  assert.doesNotThrow(() => requireExecutionSupport({ launchOptions: ["yolo"] }, "claude", "tmux", true));
});
