import test from "node:test";
import assert from "node:assert/strict";
import { runtimeState, unsupportedSession } from "../../client/instance-presentation.mjs";
import { HERDR_REMOVED } from "../../client/terminal-contract.mjs";
import { httpError } from "../renderer/views/common.mjs";

test("unreachable and missing runtime state are unknown, distinct from an observed stop", () => {
  assert.equal(runtimeState({ running: null }), "unknown");
  assert.equal(runtimeState({}), "unknown");
  assert.equal(runtimeState({ running: false }), "stopped");
  assert.equal(runtimeState({ running: true }), "running");
});

test("an incomplete result rides on the HTTP error", () => {
  const result = { server: "build", workRecoveries: [{ path: "/first", classes: ["tracked work"] }] };
  assert.equal(httpError({ status: 502, body: { error: "Incomplete", result } }, "/retire").result, result);
});

test("unsupportedSession names why a Herdr-recorded row cannot open or start, from any kernel", () => {
  const stem = `E_HERDR_REMOVED: ${HERDR_REMOVED}`;
  assert.equal(unsupportedSession({ runtimeState: "unsupported", runtimeError: `${stem} (h1)` }), `${stem} (h1)`);
  assert.equal(unsupportedSession({ runtimeState: "unsupported" }), stem);
  assert.equal(unsupportedSession({ sessionTarget: { backend: "herdr" }, runtimeState: "unreachable", runtimeError: "spawn herdr ENOENT" }), stem);
  assert.equal(unsupportedSession({ backend: "herdr", running: true }), stem);
  for (const row of [{}, { running: true, tmux: { session: "s" } }, { backend: "tmux" }, { sessionTarget: null }, { runtimeState: "unreachable", runtimeError: "x" }]) {
    assert.equal(unsupportedSession(row), null);
  }
});
