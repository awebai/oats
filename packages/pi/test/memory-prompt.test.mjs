// A freshly spawned pi home gets no "continue from STATE.md's Next" nudge;
// a home that has had a session gets it on restart (awebai/oats#1251). The
// bridge decides from its own record of a past session, never from what a
// knowledge capability seeded into STATE.md. Each run is one pi process.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RUNNER = fileURLToPath(new URL("./run-session-start.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
// What oats.okf's spawn hook seeds.
const OKF_SEED = "# Working state\n\n# Task\n\n# Next\n";
// The template text the bridge used to look for (no package writes it now).
const OLD_TEMPLATE = "# State\n\n_No task assigned yet._\n\n## Next\n\n_(the single next action)_\n";

function home(t, state) {
  const dir = mkdtempSync(join(tmpdir(), "oats-pi-memory-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "instance.json"), "{}\n");
  if (state !== undefined) writeFileSync(join(dir, "STATE.md"), state);
  return dir;
}
function start(dir, reason = "startup") {
  const env = { ...process.env, OATS_PKG_ROOT: REPO_ROOT };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", RUNNER, reason, dir], { env, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  return JSON.parse(r.stdout).memory;
}
function assertNudge(memory, dir) {
  assert.equal(memory.length, 1);
  assert.match(memory[0].message.content, /Read \.\/STATE\.md and the recent entries of \.\/log\.md now/);
  assert.ok(memory[0].message.content.includes(dir));
  assert.deepEqual(memory[0].options, { deliverAs: "steer", triggerTurn: false });
}

test("a fresh home seeded by oats.okf gets no nudge at its first startup", (t) => {
  const dir = home(t, OKF_SEED);
  assert.deepEqual(start(dir), []);
  assert.ok(existsSync(join(dir, ".oats-pi-started")), "the bridge records the session");
});

test("a fresh home with no STATE.md gets no nudge, at its first startup or after", (t) => {
  const dir = home(t);
  assert.deepEqual(start(dir), []);
  assert.deepEqual(start(dir), []);
});

test("a home that has had a session gets the nudge on restart", (t) => {
  const dir = home(t, OKF_SEED);
  assert.deepEqual(start(dir), []);
  writeFileSync(join(dir, "STATE.md"), "# Working state\n\n# Task\nfix it\n\n# Next\nrun the tests\n");
  assertNudge(start(dir), dir);
  assertNudge(start(dir), dir);
});

test("STATE.md's text decides nothing: a fresh home with written state gets no nudge, a started one with template text does", (t) => {
  const fresh = home(t, "# Working state\n\n# Next\nsomething a capability seeded\n");
  assert.deepEqual(start(fresh), []);
  const started = home(t, OLD_TEMPLATE);
  start(started);
  assertNudge(start(started), started);
});

test("a resumed or new session in the process gets the nudge, as before", (t) => {
  const dir = home(t, OKF_SEED);
  assertNudge(start(dir, "resume"), dir);
  assertNudge(start(dir, "new"), dir);
});

test("a reload sends nothing", (t) => {
  const dir = home(t, OKF_SEED);
  start(dir);
  assert.deepEqual(start(dir, "reload"), []);
});
