// The opening task reaches the transcript exactly once, whenever the
// @awebai/pi welcome turn starts (awebai/oats#469). The bridge runs in a
// PiHost (pi-host.mjs), which models pi 0.85.1's prompt() refusal rules;
// opening-task-real-pi.test.mjs runs the same races in pi itself.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RUNNER = fileURLToPath(new URL("./run-opening-scenario.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function run(t, scenario) {
  const home = mkdtempSync(join(tmpdir(), "oats-pi-opening-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  writeFileSync(join(home, "instance.json"), "{}\n");
  const env = { ...process.env, OATS_PKG_ROOT: REPO_ROOT };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", RUNNER, scenario, home], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  return JSON.parse(r.stdout);
}
const texts = (transcript, role) => transcript.filter((m) => m.role === role).map((m) => m.text);
const at = (transcript, text) => transcript.findIndex((m) => m.text === text);

function assertDeliveredOnce(result, { afterWelcome }) {
  assert.deepEqual(texts(result.transcript, "user"), ["THE TASK"], JSON.stringify(result));
  if (afterWelcome) assert.ok(at(result.transcript, "THE TASK") > at(result.transcript, "WELCOME"), "the task runs after the welcome turn");
}

test("no race: the task is the first message, delivered once", (t) => {
  const result = run(t, "no-race");
  assert.equal(result.promptError, null);
  assert.deepEqual(result.transcript, [{ role: "user", text: "THE TASK" }, { role: "assistant", text: "reply to THE TASK" }]);
});

test("welcome first: the task is queued behind the running welcome turn", (t) => {
  const result = run(t, "welcome-first");
  assertDeliveredOnce(result, { afterWelcome: true });
});

test("task first, welcome during its preflight: the displaced task is delivered after the welcome", (t) => {
  const result = run(t, "welcome-in-preflight");
  assertDeliveredOnce(result, { afterWelcome: true });
  assert.deepEqual(result.bridgeSent, ["THE TASK", "THE TASK"], "one send, one redelivery");
});

test("task first, welcome during before_agent_start: the displaced task is delivered after the welcome", (t) => {
  const result = run(t, "welcome-in-before-agent-start");
  assertDeliveredOnce(result, { afterWelcome: true });
  assert.deepEqual(result.bridgeSent, ["THE TASK", "THE TASK"], "one send, one redelivery");
});

test("task started, then the welcome: no redelivery", (t) => {
  const result = run(t, "welcome-after-task-started");
  assertDeliveredOnce(result, { afterWelcome: false });
  assert.ok(at(result.transcript, "THE TASK") < at(result.transcript, "WELCOME"));
  assert.deepEqual(result.bridgeSent, ["THE TASK"], "sent once, never redelivered");
});

test("redelivery happens at most once", (t) => {
  const result = run(t, "displaced-twice");
  assert.deepEqual(result.bridgeSent, ["THE TASK", "THE TASK"], "one send, one redelivery, no more");
  assert.deepEqual(texts(result.transcript, "user"), []);
});

test("later input is not the opening task: the bridge leaves it to pi", (t) => {
  const result = run(t, "no-race");
  assert.notEqual(result.laterError, null, "the bridge did not take the prompt over");
  assert.ok(!result.bridgeSent.includes("LATER"));
});
