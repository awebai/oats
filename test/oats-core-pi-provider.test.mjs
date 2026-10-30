// oats.core's warning for a pi with no provider: pi's own words count, and nothing else does.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { piHasNoProvider, PI_NO_PROVIDER_WARNING, runHook } from "../oats-package/capabilities/oats-core/bin/oats-core.mjs";

function fakePi(t, body) {
  const dir = mkdtempSync(join(tmpdir(), "oats-core-pi-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "pi");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}
const NONE = 'echo "No models available. Use /login to log into a provider via OAuth or API key. See:"';
const hookEnv = (executable, extra = {}) => ({ PATH: process.env.PATH, OATS_HARNESS: "pi", OATS_HARNESS_EXECUTABLE: executable, ...extra });

for (const event of ["spawn", "launch"]) test(`a pi with no provider warns at ${event} and names the fix`, (t) => {
  const answer = runHook(event, hookEnv(fakePi(t, NONE)));
  assert.deepEqual(answer, { warning: PI_NO_PROVIDER_WARNING });
  assert.match(PI_NO_PROVIDER_WARNING, /in the environment of this command, so this session may do nothing/);
  assert.match(PI_NO_PROVIDER_WARNING, /PI_CODING_AGENT_DIR/);
  assert.match(answer.warning, /\/login/);
  assert.match(answer.warning, /oats soul launch set/);
});

test("a pi with a provider says nothing", (t) => {
  assert.deepEqual(runHook("launch", hookEnv(fakePi(t, 'echo "provider model"'))), {});
});

test("a preview runs no probe", (t) => {
  assert.deepEqual(runHook("launch", hookEnv(fakePi(t, NONE), { OATS_LAUNCH_PREVIEW: "1" })), {});
});

test("what can't be told says nothing", (t) => {
  assert.equal(piHasNoProvider({}), false, "no executable handed");
  assert.equal(piHasNoProvider({ OATS_HARNESS_EXECUTABLE: "pi" }), false, "not absolute");
  assert.equal(piHasNoProvider({ OATS_HARNESS_EXECUTABLE: "/no/such/pi" }), false, "missing");
  assert.equal(piHasNoProvider(hookEnv(fakePi(t, `${NONE}; exit 1`))), false, "a failed probe");
  assert.equal(piHasNoProvider(hookEnv(fakePi(t, 'echo "something else"'))), false, "other words");
});

test("a slow pi can't hold up a spawn", (t) => {
  const started = Date.now();
  assert.equal(piHasNoProvider(hookEnv(fakePi(t, `exec sleep 30`))), false);
  assert.ok(Date.now() - started < 5000, "bounded at 3 s");
});

test("the other harnesses run no pi probe", (t) => {
  const executable = fakePi(t, NONE);
  assert.deepEqual(runHook("spawn", hookEnv(executable, { OATS_HARNESS: "codex" })), {});
});
