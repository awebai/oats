// #1630 (option C): the client of the warm reader (packages/client/warm-reader.mjs) against this checkout's
// real `oats reader --stdio`. One fixture deployment (test/helpers/v2-deployment.mjs), read the way the
// Desktop's observer reads it: the probe record this kernel's `version --json` makes (cli-locator.mjs
// `cliRecord`), node's own spawn, the CLI fallback through a recording execFile. A background read
// (--max-age 60) starts the reader and is the CLI's; once the reader is ready, the same reads are its,
// run no CLI, and give what the CLI read gives for the same argv: the same validated answer. A live read
// (--max-age 0) stays the CLI's. stop() ends the reader through its stdin.
// The client rules themselves are proved against a stand-in reader (packages/desktop/test/warm-reader.test.mjs);
// this is the one test against the kernel's. A kernel that does not list the reader skips it.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { CLI, v2Deployment } from "./helpers/v2-deployment.mjs";
import { createWarmReader } from "../packages/client/warm-reader.mjs";
import { cliDeploymentRead } from "../packages/client/deployment-read-cli.mjs";
import { parseProbeStdout, cliRecord } from "../packages/client/cli-locator.mjs";

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(probe, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (await probe()) return true;
    if (Date.now() > end) return false;
    await new Promise((ok) => setTimeout(ok, 50));
  }
}
/** Time-dependent by contract (test/read-call-equivalence.test.mjs), and nothing else. */
function normalise(answer) {
  const copy = structuredClone(answer);
  for (const holder of [copy.document?.observation, copy.document?.result?.observation, copy.document?.result?.workspace]) {
    if (holder && Object.hasOwn(holder, "observedAt")) holder.observedAt = "<observed>";
  }
  return copy;
}

test("the warm reader client against the kernel's reader: background reads answered by it, as the CLI answers them", { timeout: 300_000 }, async (t) => {
  const version = spawnSync(process.execPath, [CLI, "version", "--json"], { encoding: "utf8" });
  const probe = parseProbeStdout(version.stdout);
  if (!probe?.features?.includes("warm-reader") || probe.readerApi !== 1) return t.skip("this kernel does not list the warm reader (#1630, PR B)");
  const fx = v2Deployment({ t, name: "warm-client", souls: { dev: {} } });
  const ok = (r) => { assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`); return r.json(); };
  ok(fx.cli(["sync", "--json"]));
  ok(fx.cli(["spawn", "dev", "--purpose", "a", "--work", "directory", "--no-launch", "--json"]));

  const cli = cliRecord(probe, { bin: CLI, source: "persisted" });
  const started = [];
  const reader = createWarmReader({ spawn: (bin, args, options) => { const child = spawn(bin, args, options); started.push(child); return child; } });
  fx.beforeCleanup(() => {
    reader.stop();
    for (const child of started) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  const runs = [];
  const io = { env: fx.env, exec: (bin, argv, options, done) => { runs.push(argv); return execFile(bin, argv, options, done); } };
  const read = (action, maxAge) => reader.read(cli, { action, context: fx.dep, maxAge }, io);

  // The first background read starts the reader and is the CLI's: no read waits for the reader's start.
  assert.equal((await read("status", 60)).ok, true);
  assert.equal(runs.length, 1);
  assert.equal(started.length, 1);
  assert.deepEqual(started[0].spawnargs.slice(-2), ["reader", "--stdio"]);
  assert.equal(await until(() => reader.status().state === "ready", 60_000), true, JSON.stringify(reader.status()));

  for (const action of ["status", "workspace-status"]) {
    const before = runs.length;
    const warm = await read(action, 60);
    assert.equal(runs.length, before, `${action}: answered by the reader, no CLI run`);
    assert.equal(warm.ok, true, JSON.stringify(warm.reason));
    const cold = await cliDeploymentRead(cli, { action, context: fx.dep, maxAge: 60 }, io);
    assert.deepEqual(normalise(warm), normalise(cold), `${action}: the reader's answer is the CLI's`);
  }
  // A kernel error answered by the reader is the CLI's too: a deployment that is not one.
  const missing = fx.base; // a directory, but no deployment
  const before = runs.length;
  const refused = await reader.read(cli, { action: "status", context: missing, maxAge: 60 }, io);
  assert.equal(runs.length, before, "the error was the reader's answer");
  assert.deepEqual(refused, await cliDeploymentRead(cli, { action: "status", context: missing, maxAge: 60 }, io));
  assert.equal(refused.ok, false);

  // A live read is the CLI's, with the reader ready.
  const live = runs.length;
  assert.equal((await read("status", 0)).ok, true);
  assert.equal(runs.length, live + 1, "a live read runs the CLI");
  assert.equal(started.length, 1, "one reader for the whole run");

  const pid = started[0].pid;
  reader.stop();
  assert.equal(await until(() => !alive(pid) || started[0].exitCode !== null, 10_000), true, "stop() ends the reader");
  assert.equal(reader.status().state, "stopped");
});
