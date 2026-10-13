import test from "node:test";
import assert from "node:assert/strict";
import { runtimeState, unsupportedSession, unsupportedSessionOrigin, knownOrigin, hasRuntimeError } from "../../client/instance-presentation.mjs";
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

test("unsupportedSessionOrigin: the kernel for the row's own reason, no speaker for the stand-in written here, and the answer of unsupportedSession is unchanged", () => {
  const stem = `E_HERDR_REMOVED: ${HERDR_REMOVED}`, own = `${stem} (dev-a)`;
  const rows = [
    [{ runtimeState: "unsupported", runtimeError: own }, own, "kernel"],
    [{ runtimeState: "unsupported", runtimeError: own, sessionTarget: { backend: "herdr" } }, own, "kernel"],
    // The stand-in: an unsupported row with no text, an empty one, or one that is not a string.
    [{ runtimeState: "unsupported" }, stem, null], [{ runtimeState: "unsupported", runtimeError: "" }, stem, null], [{ runtimeState: "unsupported", runtimeError: 5 }, stem, null],
    // An older kernel's Herdr row: its runtimeError is a Herdr probe's, and the stem stands in.
    [{ sessionTarget: { backend: "herdr" }, runtimeState: "unreachable", runtimeError: "spawn herdr ENOENT" }, stem, null], [{ backend: "herdr", runtimeError: "Herdr snapshot unavailable" }, stem, null],
    // Not a Herdr row: nothing to answer, and no speaker.
    [{ running: null, runtimeState: "unreachable", runtimeError: "no server" }, null, null], [{}, null, null], [null, null, null], [undefined, null, null],
  ];
  for (const [row, text, origin] of rows) assert.deepEqual([unsupportedSession(row), unsupportedSessionOrigin(row)], [text, origin], JSON.stringify(row));
});

test("the three speakers, and what a runtimeError is", () => {
  for (const origin of ["kernel", "terminal-probe", "roster-read"]) assert.equal(knownOrigin(origin), true, origin);
  for (const origin of ["Kernel", "server-probe", "", "__proto__", "constructor", "toString", 0, 7, null, undefined, ["kernel"], { kernel: true }]) assert.equal(knownOrigin(origin), false, JSON.stringify(origin));
  assert.equal(hasRuntimeError({ runtimeError: "x" }), true);
  for (const runtimeError of [undefined, null, "", 0, 5, true, {}, ["x"]]) assert.equal(hasRuntimeError({ runtimeError }), false, JSON.stringify(runtimeError));
  assert.equal(hasRuntimeError(null), false); assert.equal(hasRuntimeError(undefined), false);
});
