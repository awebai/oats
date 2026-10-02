// The opening-task races of opening-task.test.mjs, run in pi itself. pi is
// not a dependency of this repository: the case runs where the pi on PATH
// resolves to its SDK (@earendil-works/pi-coding-agent), and skips, saying
// why, where it does not.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RUNNER = fileURLToPath(new URL("./run-opening-scenario-real-pi.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/** The pi SDK behind the `pi` on PATH, or why there is none. */
function findPi() {
  const bin = (process.env.PATH || "").split(delimiter).map((d) => join(d, "pi")).find((p) => existsSync(p));
  if (!bin) return { reason: "no pi on PATH" };
  for (let d = dirname(realpathSync(bin)); d !== dirname(d); d = dirname(d)) {
    const manifest = join(d, "package.json");
    if (!existsSync(manifest)) continue;
    const { name, version } = JSON.parse(readFileSync(manifest, "utf8"));
    if (name !== PI_PACKAGE) continue;
    const piAi = [join(d, "node_modules", "@earendil-works", "pi-ai"), join(dirname(d), "pi-ai")].find((p) => existsSync(join(p, "dist", "index.js")));
    if (!piAi) return { reason: `${PI_PACKAGE} ${version} at ${d} has no resolvable @earendil-works/pi-ai` };
    return { root: d, version, piAiEntry: join(piAi, "dist", "index.js") };
  }
  return { reason: `${bin} is not part of ${PI_PACKAGE}` };
}
const PI = findPi();
const skip = PI.root ? false : `pi SDK not found: ${PI.reason}`;
if (PI.root) console.log(`# real pi: ${PI_PACKAGE} ${PI.version} at ${PI.root}`);

function run(t, scenario) {
  const home = mkdtempSync(join(tmpdir(), "oats-pi-opening-real-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  writeFileSync(join(home, "instance.json"), "{}\n");
  const env = { ...process.env, OATS_PKG_ROOT: REPO_ROOT };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [RUNNER, PI.root, PI.piAiEntry, scenario, home], { env, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const users = (result) => result.transcript.filter((m) => m.role === "user").map((m) => m.text);
const at = (result, text) => result.transcript.findIndex((m) => m.text === text);

function assertDeliveredOnce(result, { afterWelcome }) {
  assert.deepEqual(users(result), ["THE TASK"], JSON.stringify(result));
  if (afterWelcome) assert.ok(at(result, "THE TASK") > at(result, "WELCOME"), "the task runs after the welcome turn");
}

test("real pi, no race: the task is the first message, delivered once", { skip }, (t) => {
  const result = run(t, "no-race");
  assert.equal(result.promptError, null);
  assert.deepEqual(result.transcript, [{ role: "user", text: "THE TASK" }, { role: "assistant", text: "reply" }]);
});

test("real pi, welcome first: the task is queued behind the running welcome turn", { skip }, (t) => {
  assertDeliveredOnce(run(t, "welcome-first"), { afterWelcome: true });
});

test("real pi, task first, welcome during its preflight: delivered after the welcome", { skip }, (t) => {
  const result = run(t, "welcome-in-preflight");
  assertDeliveredOnce(result, { afterWelcome: true });
  assert.deepEqual(result.bridgeSent, ["THE TASK", "THE TASK"], "one send, one redelivery");
});

test("real pi, task first, welcome during before_agent_start: delivered after the welcome", { skip }, (t) => {
  const result = run(t, "welcome-in-before-agent-start");
  assertDeliveredOnce(result, { afterWelcome: true });
  assert.deepEqual(result.bridgeSent, ["THE TASK", "THE TASK"], "one send, one redelivery");
});

test("real pi, task started, then the welcome: no redelivery", { skip }, (t) => {
  const result = run(t, "welcome-after-task-started");
  assertDeliveredOnce(result, { afterWelcome: false });
  assert.ok(at(result, "THE TASK") < at(result, "WELCOME"));
  assert.deepEqual(result.bridgeSent, ["THE TASK"], "sent once, never redelivered");
});

test("real pi, redelivery happens at most once", { skip }, (t) => {
  const result = run(t, "displaced-twice");
  assert.deepEqual(result.bridgeSent, ["THE TASK", "THE TASK"], "one send, one redelivery, no more");
  assert.deepEqual(users(result), []);
});
