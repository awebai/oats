import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { startInstanceSession } from "../lib/core.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { isolateSessionEnvironment, waitUntil } from "./helpers/host-fixture.mjs";

// Launch hooks may register a home with a provider on a real start (a side
// effect), so the kernel tells them when they run for a preview
// (OATS_LAUNCH_PREVIEW=1), and a real start runs them only after its
// preflight has passed. The fixture provider records every run of its launch
// hook, with the flag it saw, in <home>/hook-runs.jsonl.
const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-launch-hook-preview-")));
const socket = join(base, "tmux.sock");
const session = "p";
const restoreEnvironment = isolateSessionEnvironment(base, socket);
const tmux = (...args) => execFileSync("tmux", ["-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
test.after(() => { try { tmux("kill-server"); } catch { /* gone */ } finally { restoreEnvironment(); rmSync(base, { recursive: true, force: true }); } });
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
// A harness that records its pid, then idles.
const binDir = join(base, "bin"); mkdirSync(binDir);
write(join(binDir, "polite"), `#!/bin/sh\necho $$ > "$OATS_INSTANCE_HOME/pid.txt"\nexec sleep 86400\n`);
chmodSync(join(binDir, "polite"), 0o755);
for (const n of ["claude", "codex", "pi"]) { write(join(binDir, n), readFileSync(join(binDir, "polite"), "utf8")); chmodSync(join(binDir, n), 0o755); }
process.env.PATH = `${binDir}:${process.env.PATH}`;
const env = (extra = {}) => { const e = { ...process.env, PATH: `${binDir}:${process.env.PATH}`, OATS_HOME_DIR: join(base, "oats-home"), ...extra }; for (const k of ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "OATS_LAUNCH_PREVIEW", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT"]) delete e[k]; return e; };
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// With <home>/differ present, the real run answers another value than the preview: a hook bug.
const recordingHook = `import { appendFileSync, existsSync } from "node:fs"; import { join } from "node:path";
const preview = process.env.OATS_LAUNCH_PREVIEW ?? null;
appendFileSync(join(process.env.OATS_HOME, "hook-runs.jsonl"), JSON.stringify({ preview, harness: process.env.OATS_HARNESS }) + "\\n");
const value = existsSync(join(process.env.OATS_HOME, "differ")) && preview !== "1" ? "other" : "registered";
process.stdout.write(JSON.stringify({ env: { TEST_SIDEFX: value } }) + "\\n");
`;
const fx = v2Deployment({
  souls: { hooked: { soul: { capabilities: { "test.sidefx": { from: "here" } } } } },
  capabilities: { "test.sidefx": { manifest: { hooks: { launch: "bin/launch.mjs" }, environment: ["TEST_SIDEFX"], settings: {} }, files: { "bin/launch.mjs": recordingHook } } },
  local: { "launch-configs": {
    polite: { harness: "claude", executable: join(binDir, "polite") },
    codexy: { harness: "codex", executable: join(binDir, "polite") },
    // A reference this host does not set: a start under it fails preflight (E_LAUNCH_ENV_MISSING).
    unset: { harness: "claude", executable: join(binDir, "polite"), env: { KEY: { fromEnv: "LAUNCH_HOOK_PREVIEW_UNSET" } } },
    // Overrides an environment name the provider owns: preflight fails (E_LAUNCH_ENV_CONFLICT), a
    // check that needs the hook's contribution.
    clash: { harness: "claude", executable: join(binDir, "polite"), env: { TEST_SIDEFX: "mine" } },
  } },
});
test.after(() => fx.cleanup());
const homeOf = (name) => join(fx.root, "hooked", "instances", name);
const recipeFor = (executable) => ({ version: 2, harness: "claude", launchConfig: null, launchConfigSource: null, executable, executableDeclared: null, executableResolvedFrom: "PATH", args: [], env: {}, model: null, yolo: true, hooks: { launch: {}, env: {}, contributions: [] }, prompt: { kind: "task-file", file: "TASK.md" } });
const renderFor = (home, name, exe) => `OATS_INSTANCE=${shq(name)} OATS_INSTANCE_HOME=${shq(home)} PI_AGENT_INSTANCE=${shq(name)} PI_AGENT_HOME=${shq(home)} ${shq(exe)} --dangerously-skip-permissions -- "$(cat TASK.md)"`;
// A home spawned through the workspace path, given the private tmux socket and a recipe.
async function makeHome(name) {
  const { home } = await fx.spawn("hooked", { name, work: "checkout", launch: false, harness: "claude" });
  assert.equal(home, homeOf(name));
  const polite = join(binDir, "polite");
  write(join(home, "instance.json"), JSON.stringify({ ...readJson(join(home, "instance.json")), harness: "claude", tmux: { session, window: name, socket }, launched: true, command: renderFor(home, name, polite), launch: recipeFor(polite) }, null, 2) + "\n");
  const baselinePath = join(dirname(home), ".oats-retirement", "baselines", `${createHash("sha256").update(home).digest("hex")}.json`);
  write(baselinePath, JSON.stringify({ ...readJson(baselinePath), runtime: { launched: true, tmux: { session, window: name, socket } } }, null, 2) + "\n");
  rmSync(join(home, "hook-runs.jsonl"), { force: true });
  return home;
}
const runs = (home) => existsSync(join(home, "hook-runs.jsonl")) ? readFileSync(join(home, "hook-runs.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const realRuns = (home) => runs(home).filter((r) => r.preview !== "1");

test("a launch preview runs launch hooks with OATS_LAUNCH_PREVIEW=1, and their contribution is still previewed", async () => {
  const home = await makeHome("hooked-preview");
  const r = spawnSync(process.execPath, [CLI, "launch-config", "preview", "--home", home, "--launch-config", "codexy", "--json"], { encoding: "utf8", env: env() });
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.ok, true, r.stdout + r.stderr);
  assert.equal(out.result.ok, true, JSON.stringify(out.result.preflight));
  assert.deepEqual(runs(home), [{ preview: "1", harness: "codex" }], "the hook ran once, told it is a preview");
  assert.ok(out.result.environment.some((e) => e.name === "TEST_SIDEFX"), "the hook's contribution is in the preview");
});

test("a real start runs launch hooks without OATS_LAUNCH_PREVIEW", async () => {
  const name = "hooked-start", home = await makeHome(name);
  tmux("new-session", "-d", "-s", session, "-n", "hq", "-c", home);
  startInstanceSession(home, { env: env() });
  assert.ok(await waitUntil(() => existsSync(join(home, "pid.txt")), "harness up"));
  assert.deepEqual(realRuns(home), [{ preview: null, harness: "claude" }], "exactly one real run");
  assert.ok(readJson(join(home, "instance.json")).launch.hooks.contributions.some((c) => c.capability === "test.sidefx" && (c.env || []).includes("TEST_SIDEFX")), "the real run's contribution is recorded");
});

test("a start whose preflight fails has run no launch hook for real", async () => {
  const home = await makeHome("hooked-refused");
  assert.throws(() => startInstanceSession(home, { launchConfig: "unset", env: env() }), (e) => e.code === "E_LAUNCH_ENV_MISSING", "an unresolved reference fails preflight");
  assert.deepEqual(realRuns(home), [], "E_LAUNCH_ENV_MISSING: no hook ran outside a preview");
  assert.throws(() => startInstanceSession(home, { launchConfig: "clash", env: env() }), (e) => e.code === "E_LAUNCH_ENV_CONFLICT", "a configuration overriding the provider's environment fails preflight");
  assert.deepEqual(realRuns(home), [], "E_LAUNCH_ENV_CONFLICT: no hook ran outside a preview");
});

test("a start of a running home is refused before any launch hook runs for real", async () => {
  const name = "hooked-running", home = await makeHome(name);
  try { tmux("has-session", "-t", session); } catch { tmux("new-session", "-d", "-s", session, "-n", "hq", "-c", home); }
  startInstanceSession(home, { env: env() });
  assert.ok(await waitUntil(() => existsSync(join(home, "pid.txt")), "harness up"));
  // A home its spawn launched has no pending start receipt: a start reaches the planner and the
  // running check, not the receipt's recovery.
  rmSync(join(home, ".oats-start-pending.json"), { force: true });
  rmSync(join(home, "hook-runs.jsonl"), { force: true });
  assert.throws(() => startInstanceSession(home, { env: env() }), (e) => e.code === "E_SESSION_RUNNING");
  assert.throws(() => startInstanceSession(home, { launchConfig: "codexy", env: env() }), (e) => e.code === "E_SESSION_RUNNING", "another harness for a running home");
  assert.deepEqual(realRuns(home), [], "E_SESSION_RUNNING: no hook ran outside a preview");
});

test("a launch hook whose real contribution differs from its preview contribution is refused", async () => {
  const name = "hooked-differ", home = await makeHome(name);
  try { tmux("has-session", "-t", session); } catch { tmux("new-session", "-d", "-s", session, "-n", "hq", "-c", home); }
  write(join(home, "differ"), "");
  const before = readJson(join(home, "instance.json"));
  assert.throws(() => startInstanceSession(home, { env: env() }), (e) => e.code === "E_LAUNCH_PREPARATION" && /test\.sidefx/.test(e.message) && /differs from its preview contribution/.test(e.message) && /nothing was stopped/.test(e.message));
  assert.equal(existsSync(join(home, "pid.txt")), false, "nothing was started");
  assert.deepEqual(readJson(join(home, "instance.json")).launch, before.launch, "nothing was recorded");
});
