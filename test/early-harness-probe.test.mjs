// The early harness package probe (oats spawn): `claude plugin list --json` starts when the command
// starts, from local inputs only (lib/core.mjs startHarnessPackageProbe, bin/oats.mjs
// startEarlyHarnessProbe). The spawn adopts its answer only for exactly the (bin, env) it then selects,
// and probes as before otherwise; a probe nobody adopts never outlives the command.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn as spawnChild, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI, v2Deployment } from "./helpers/v2-deployment.mjs";

const REQUIRES = { "acme.chan": { manifest: { requires: [{ harness: "claude", package: "chan@acme-marketplace" }] } } };
const DEV = (soul = {}) => ({ dev: { soul: { capabilities: { "acme.chan": { from: "here" } }, ...soul } } });
/** This host's claude default (TEST_TOKEN=selected), and `alt`, another claude configuration. */
const CONFIGS = { "launch-configs": { mine: { harness: "claude", env: { TEST_TOKEN: "selected" }, default: true }, alt: { harness: "claude", env: { TEST_TOKEN: "alt" } } } };

/** A deployment whose `dev` soul's capability requires a claude plugin, and a fake `claude` first on PATH.
 *  The fake logs `start <pid> <token>` and `done <pid> <token>` for every `plugin list`, lists the plugin
 *  only under TEST_TOKEN `selected` or `alt`, and under a token starting with `sleep` records its pid and
 *  its sleeping child's in probe.pids and never answers. */
function deployment(t, { souls = DEV(), local = CONFIGS, capabilities = REQUIRES } = {}) {
  const fx = v2Deployment({ souls, capabilities, local });
  t.after(() => fx.cleanup());
  const bin = join(fx.base, "fake-bin"); mkdirSync(bin);
  fx.log = join(fx.base, "probe.log"); fx.pids = join(fx.base, "probe.pids");
  writeFileSync(join(bin, "claude"), `#!/bin/sh
if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then
  echo "start $$ \${TEST_TOKEN:-}" >> '${fx.log}'
  case "\${TEST_TOKEN:-}" in sleep*) echo $$ >> '${fx.pids}'; sleep 600 & echo $! >> '${fx.pids}'; wait; exit 0;; esac
  case "\${TEST_TOKEN:-}" in selected|alt) printf '[{"id":"chan@acme-marketplace","scope":"user","enabled":true}]';; *) printf '[]';; esac
  echo "done $$ \${TEST_TOKEN:-}" >> '${fx.log}'
  exit 0
fi
exit 0
`, { mode: 0o755 });
  // Run once now: macOS checks a freshly written executable at its first exec, which can take longer than a
  // spawn takes to decide, so a probe killed early would never have reached its first line.
  spawnSync(join(bin, "claude"), ["--version"]);
  fx.path = `${bin}:${fx.env.PATH}`;
  fx.oats = (args, env = {}) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: fx.dep, env: { ...fx.env, PATH: fx.path, TMUX: "", ...env }, encoding: "utf8", timeout: 60000 });
    assert.equal(r.signal, null, `the CLI hung: ${r.stderr.slice(0, 400)}`);
    return { ...r, json: JSON.parse(r.stdout.trim().split("\n").pop()) };
  };
  fx.probes = () => (existsSync(fx.log) ? readFileSync(fx.log, "utf8").trim().split("\n").filter(Boolean).map((l) => l.split(" ")) : []);
  return fx;
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
/** The pids a sleeping fake recorded that are still alive after a bounded wait (SIGKILL delivery and
 *  reaping are asynchronous: killed and not yet reaped is not a survivor). */
async function survivors(fx) {
  const pids = existsSync(fx.pids) ? readFileSync(fx.pids, "utf8").trim().split("\n").filter(Boolean).map(Number) : [];
  assert.ok(pids.length >= 2, `the sleeping probe started and forked its child: ${JSON.stringify(pids)} (log: ${existsSync(fx.log) ? readFileSync(fx.log, "utf8") : "none"})`);
  const deadline = Date.now() + 10000;
  while (pids.some(alive) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  return pids.filter(alive).map((pid) => `${pid} (${spawnSync("ps", ["-o", "stat=,command=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim() || "gone"})`);
}
const packagesOf = (home) => JSON.parse(readFileSync(join(home, "instance.json"), "utf8")).composition.materialized.harnessPackages;

test("the early probe is adopted for the selected (bin, env): one probe, the same answer as the synchronous probe", async (t) => {
  const fx = deployment(t);
  const r = fx.oats(["spawn", "dev", "--harness", "claude", "--name", "dev-early", "--no-launch", "--json"]);
  assert.equal(r.json.ok, true, r.stdout + r.stderr);
  const probes = fx.probes();
  assert.deepEqual(probes.map(([what, , token]) => `${what} ${token}`), ["start selected", "done selected"], "one probe, under the selected configuration's env, adopted");
  // The synchronous probe (an in-process spawn starts no early probe) answers the same.
  const saved = process.env.PATH;
  process.env.PATH = fx.path;
  try {
    const sync = await fx.spawn("dev", { name: "dev-sync", harness: "claude" });
    assert.deepEqual(packagesOf(r.json.result.home), packagesOf(sync.home));
    assert.equal(packagesOf(sync.home)[0].package, "chan@acme-marketplace");
  } finally { process.env.PATH = saved; }
  assert.equal(fx.probes().length, 4, "the in-process spawn probed synchronously, once");
  // A preview adopts it too, and its harness packages are identical.
  const pv = fx.oats(["spawn", "dev", "--harness", "claude", "--preview", "--json"]);
  assert.equal(pv.json.ok, true, pv.stdout + pv.stderr);
  assert.equal(pv.json.result.preflight.status, "complete");
  assert.equal(fx.probes().length, 6, "the preview probed once");
});

test("a selection other than the local guess kills the early probe and probes as before", async (t) => {
  // No flags: the guess is the claude default (mine); this host's souls.launch selects alt instead.
  const fx = deployment(t, { souls: DEV({ launch: { harness: "claude" } }), local: { ...CONFIGS, "launch-configs": { ...CONFIGS["launch-configs"], mine: { ...CONFIGS["launch-configs"].mine, env: { TEST_TOKEN: "sleep-guess" } } }, souls: { launch: { "*": "alt" } } } });
  const r = fx.oats(["spawn", "dev", "--name", "dev-alt", "--no-launch", "--json"]);
  assert.equal(r.json.ok, true, r.stdout + r.stderr);
  const tokens = fx.probes().map(([what, , token]) => `${what} ${token}`);
  assert.ok(tokens.includes("start sleep-guess"), `the guess was probed early: ${tokens}`);
  assert.ok(tokens.includes("start alt") && tokens.includes("done alt"), `the selected configuration was probed synchronously: ${tokens}`);
  assert.deepEqual(await survivors(fx), [], "the mismatched early probe was killed");
});

test("the soul's harness is not claude: the speculative probe is killed", async (t) => {
  const fx = deployment(t, { local: { "launch-configs": { mine: { harness: "claude", env: { TEST_TOKEN: "sleep-pi" }, default: true } } } });
  const r = fx.oats(["spawn", "dev", "--name", "dev-pi", "--no-launch", "--json"]);
  assert.equal(r.json.ok, true, r.stdout + r.stderr);
  assert.equal(r.json.result.harness, "pi");
  assert.deepEqual(await survivors(fx), [], "the probe of a harness the spawn did not choose was killed");
});

test("a probe still pending never outlives the command: a refusal, and a signal", async (t) => {
  const fx = deployment(t, { local: { "launch-configs": { mine: { harness: "claude", env: { TEST_TOKEN: "sleep-exit" }, default: true } } } });
  // A refusal after the probe started (the soul does not exist).
  const refused = fx.oats(["spawn", "ghost", "--harness", "claude", "--no-launch", "--json"]);
  assert.equal(refused.json.ok, false);
  assert.deepEqual(await survivors(fx), [], "a refused spawn killed its probe");
  // SIGTERM and SIGINT while the apply waits for the probe it adopted.
  for (const [signal, code] of [["SIGTERM", 143], ["SIGINT", 130]]) {
    writeFileSync(fx.pids, "");
    const child = spawnChild(process.execPath, [CLI, "spawn", "dev", "--harness", "claude", "--name", `dev-${signal.toLowerCase()}`, "--no-launch", "--json"], { cwd: fx.dep, env: { ...fx.env, PATH: fx.path, TMUX: "" }, stdio: "ignore" });
    const exited = new Promise((r) => child.once("exit", (status, sig) => r({ status, sig })));
    const deadline = Date.now() + 30000;
    while (readFileSync(fx.pids, "utf8").trim().split("\n").filter(Boolean).length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    // Let the apply reach the adoption it then waits on.
    await new Promise((r) => setTimeout(r, 1500));
    child.kill(signal);
    const { status } = await exited;
    assert.equal(status, code, `${signal} exits ${code}`);
    assert.deepEqual(await survivors(fx), [], `${signal}: the probe was killed`);
  }
});

/** A budgeted preview through the CLI (early probe) and in-process (the synchronous probe), same inputs. */
async function budgetedPreviews(fx) {
  const started = Date.now();
  const early = fx.oats(["spawn", "dev", "--harness", "claude", "--preview", "--json"], { OATS_PREVIEW_PREFLIGHT_BUDGET_MS: "1500" }).json;
  assert.ok(Date.now() - started < 30000, "the preview returned within its budget, not the probe's own timeout");
  assert.deepEqual(await survivors(fx), [], "the early probe was killed at the deadline");
  const saved = { PATH: process.env.PATH, B: process.env.OATS_PREVIEW_PREFLIGHT_BUDGET_MS };
  process.env.PATH = fx.path; process.env.OATS_PREVIEW_PREFLIGHT_BUDGET_MS = "1500";
  try { return { early, sync: await fx.spawn("dev", { harness: "claude", preview: true }).then((result) => ({ ok: true, result }), (e) => ({ ok: false, error: { code: e.code, message: e.message } })) }; }
  finally { process.env.PATH = saved.PATH; if (saved.B === undefined) delete process.env.OATS_PREVIEW_PREFLIGHT_BUDGET_MS; else process.env.OATS_PREVIEW_PREFLIGHT_BUDGET_MS = saved.B; }
}
const SLEEPING_DEFAULT = { "launch-configs": { mine: { harness: "claude", env: { TEST_TOKEN: "sleep-budget" }, default: true } } };

test("a preview's preflight budget bounds the adopted probe: killed at the deadline, and the preview answers as with the synchronous probe", async (t) => {
  // A required package the exhausted probe could not list fails closed, exactly as the synchronous probe's
  // refusal (the CLI reports E_HARNESS_RESOURCE_MISSING as E_SPAWN_FAILED, as it always has).
  const required = await budgetedPreviews(deployment(t, { local: SLEEPING_DEFAULT }));
  assert.equal(required.early.ok, false); assert.equal(required.sync.ok, false);
  assert.equal(required.sync.error.code, "E_HARNESS_RESOURCE_MISSING"); assert.equal(required.early.error.code, "E_SPAWN_FAILED");
  assert.equal(required.early.error.message, required.sync.error.message);
  // A package required only if installed: the preview succeeds, its preflight status `timeout`, as today.
  const optional = await budgetedPreviews(deployment(t, { local: SLEEPING_DEFAULT, capabilities: { "acme.chan": { manifest: { requires: [{ harness: "claude", package: "chan@acme-marketplace", ifInstalled: true }] } } } }));
  assert.equal(optional.early.ok, true, JSON.stringify(optional.early).slice(0, 400)); assert.equal(optional.sync.ok, true);
  assert.equal(optional.sync.result.preflight.status, "timeout");
  assert.equal(optional.early.result.preflight.status, "timeout"); assert.equal(optional.early.result.preflight.budgetMs, 1500);
});
