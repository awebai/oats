import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { startInstanceSession } from "../lib/core.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { isolateSessionEnvironment, oatsSocket, waitUntil } from "./helpers/host-fixture.mjs";

// Launch hooks may register a home with a provider on a real start (a side
// effect), so the kernel tells them when they run for a preview
// (OATS_LAUNCH_PREVIEW=1), and a real start runs them only after its
// preflight has passed. The fixture provider records every run of its launch
// hook, with the flag it saw, in <home>/hook-runs.jsonl.
const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-launch-hook-preview-")));
const session = "p";
const restoreEnvironment = isolateSessionEnvironment(base);
const socket = oatsSocket(); // the fixture's own `oats` server: where the kernel creates windows
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
// A hook that does not know the preview flag (a provider released before it) and answers a new value
// on every call, as a provider renewing a credential at each start does.
const renewingHook = `import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"; import { join } from "node:path";
appendFileSync(join(process.env.OATS_HOME, "hook-runs.jsonl"), JSON.stringify({ preview: process.env.OATS_LAUNCH_PREVIEW ?? null, harness: process.env.OATS_HARNESS }) + "\\n");
const counter = join(process.env.OATS_HOME, "renewals");
const n = (existsSync(counter) ? Number(readFileSync(counter, "utf8")) : 0) + 1;
writeFileSync(counter, String(n));
process.stdout.write(JSON.stringify({ env: { TEST_RENEWED: \`grant-\${n}\` } }) + "\\n");
`;
// A preview-aware hook answering what the test wrote to <home>/preview.json (under the flag) or
// <home>/real.json (a real run), recording each run.
const answeringHook = `import { appendFileSync, readFileSync } from "node:fs"; import { join } from "node:path";
const preview = process.env.OATS_LAUNCH_PREVIEW ?? null;
appendFileSync(join(process.env.OATS_HOME, "hook-runs.jsonl"), JSON.stringify({ preview, harness: process.env.OATS_HARNESS }) + "\\n");
process.stdout.write(readFileSync(join(process.env.OATS_HOME, preview === "1" ? "preview.json" : "real.json"), "utf8") + "\\n");
`;
const fx = v2Deployment({
  souls: { hooked: { soul: { capabilities: { "test.sidefx": { from: "here" } } } }, renewing: { soul: { capabilities: { "test.renewing": { from: "here" } } } },
    volatile: { soul: { capabilities: { "test.volatile": { from: "here" } } } } },
  capabilities: { "test.sidefx": { manifest: { launchPreview: true, hooks: { launch: "bin/launch.mjs" }, environment: ["TEST_SIDEFX"], settings: {} }, files: { "bin/launch.mjs": recordingHook } },
    "test.renewing": { manifest: { hooks: { launch: "bin/launch.mjs" }, environment: ["TEST_RENEWED"], settings: {} }, files: { "bin/launch.mjs": renewingHook } },
    "test.volatile": { manifest: { launchPreview: true, hooks: { launch: "bin/launch.mjs" }, environment: ["TEST_GRANT", "TEST_STEADY", "CLAUDE_CONFIG_DIR"], environmentNamespaces: ["CLAUDE_"], settings: {} }, files: { "bin/launch.mjs": answeringHook } } },
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
const homeOf = (name, soul = "hooked") => join(fx.root, soul, "instances", name);
const recipeFor = (executable) => ({ version: 2, harness: "claude", launchConfig: null, launchConfigSource: null, executable, executableDeclared: null, executableResolvedFrom: "PATH", args: [], env: {}, model: null, yolo: true, hooks: { launch: {}, env: {}, contributions: [] }, prompt: { kind: "task-file", file: "TASK.md" } });
const renderFor = (home, name, exe) => `OATS_INSTANCE=${shq(name)} OATS_INSTANCE_HOME=${shq(home)} PI_AGENT_INSTANCE=${shq(name)} PI_AGENT_HOME=${shq(home)} ${shq(exe)} --dangerously-skip-permissions -- "$(cat TASK.md)"`;
// A home spawned through the workspace path, given the private tmux socket and a recipe.
async function makeHome(name, soul = "hooked") {
  const { home } = await fx.spawn(soul, { name, work: "checkout", launch: false, harness: "claude" });
  assert.equal(home, homeOf(name, soul));
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
  // The flag is the kernel's to give: an ambient one (an `oats` run from inside a previewed hook) is not inherited.
  process.env.OATS_LAUNCH_PREVIEW = "1";
  try { startInstanceSession(home, { env: env() }); } finally { delete process.env.OATS_LAUNCH_PREVIEW; }
  assert.ok(await waitUntil(() => existsSync(join(home, "pid.txt")), "harness up"));
  assert.deepEqual(runs(home), [{ preview: "1", harness: "claude" }, { preview: null, harness: "claude" }], "the preflight's preview run, then exactly one real run");
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

test("a launch hook that does not declare preview awareness runs once, for real, and a home whose hook renews its env at every call still starts", async () => {
  const name = "renewing-start", home = await makeHome(name, "renewing");
  try { tmux("has-session", "-t", session); } catch { tmux("new-session", "-d", "-s", session, "-n", "hq", "-c", home); }
  startInstanceSession(home, { env: env() });
  assert.ok(await waitUntil(() => existsSync(join(home, "pid.txt")), "harness up"));
  assert.deepEqual(runs(home), [{ preview: null, harness: "claude" }], "one real run, no preview run");
  assert.ok(readJson(join(home, "instance.json")).command.includes("TEST_RENEWED='grant-1'"), "the start launches with that run's value");
});

test("a launch preview never runs a launch hook that does not declare preview awareness; it shows the recorded contribution and says so", async () => {
  const home = await makeHome("renewing-preview", "renewing");
  const r = spawnSync(process.execPath, [CLI, "launch-config", "preview", "--home", home, "--launch-config", "polite", "--json"], { encoding: "utf8", env: env() });
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.ok, true, r.stdout + r.stderr);
  assert.deepEqual(runs(home), [], "the hook did not run");
  assert.match(out.result.preflight.find((c) => c.check === "capabilities").detail, /test\.renewing/);
  assert.match(out.result.preflight.find((c) => c.check === "capabilities").detail, /not preview-aware/);
});

// A home of the preview-aware provider answering `preview` under the flag and `real` for real.
async function volatileHome(name, preview, real) {
  const home = await makeHome(name, "volatile");
  write(join(home, "preview.json"), JSON.stringify(preview));
  write(join(home, "real.json"), JSON.stringify(real));
  try { tmux("has-session", "-t", session); } catch { tmux("new-session", "-d", "-s", session, "-n", "hq", "-c", home); }
  return home;
}

test("a preview-aware hook's volatileEnv: the start launches with the real run's value, recorded in the recipe", async () => {
  const home = await volatileHome("volatile-start", { env: { TEST_GRANT: "not-minted-yet", TEST_STEADY: "s" }, volatileEnv: ["TEST_GRANT"] }, { env: { TEST_GRANT: "grant-minted", TEST_STEADY: "s" } });
  startInstanceSession(home, { env: env() });
  assert.ok(await waitUntil(() => existsSync(join(home, "pid.txt")), "harness up"));
  assert.deepEqual(runs(home).map((r) => r.preview), ["1", null], "a preview run, then one real run");
  const meta = readJson(join(home, "instance.json"));
  assert.ok(meta.command.includes("TEST_GRANT='grant-minted'") && !meta.command.includes("not-minted-yet"), meta.command);
  assert.equal(meta.launch.hooks.env.TEST_GRANT, "grant-minted");
  assert.ok(!JSON.stringify(meta).includes("volatileEnv"), "volatileEnv is not persisted");
});

test("a preview-aware hook whose non-volatile env differs between the passes is refused", async () => {
  const home = await volatileHome("volatile-differ", { env: { TEST_GRANT: "a", TEST_STEADY: "s" }, volatileEnv: ["TEST_GRANT"] }, { env: { TEST_GRANT: "b", TEST_STEADY: "changed" } });
  const before = readJson(join(home, "instance.json"));
  assert.throws(() => startInstanceSession(home, { env: env() }), (e) => e.code === "E_LAUNCH_PREPARATION" && /test\.volatile/.test(e.message) && /differs from its preview contribution/.test(e.message));
  assert.equal(existsSync(join(home, "pid.txt")), false, "nothing was started");
  assert.deepEqual(readJson(join(home, "instance.json")).launch, before.launch, "nothing was recorded");
});

test("volatileEnv may name only env the same hook returned, and never a harness's configuration selector", async () => {
  let home = await volatileHome("volatile-unreturned", { env: { TEST_STEADY: "s" }, volatileEnv: ["TEST_GRANT"] }, { env: { TEST_STEADY: "s" } });
  assert.throws(() => startInstanceSession(home, { env: env() }), (e) => e.code === "E_LAUNCH_PREPARATION" && /TEST_GRANT volatile but did not return it/.test(e.message));
  assert.deepEqual(realRuns(home), [], "refused in preflight: no real run");
  home = await volatileHome("volatile-selector", { env: { CLAUDE_CONFIG_DIR: "/tmp/x" }, volatileEnv: ["CLAUDE_CONFIG_DIR"] }, { env: { CLAUDE_CONFIG_DIR: "/tmp/y" } });
  assert.throws(() => startInstanceSession(home, { env: env() }), (e) => e.code === "E_LAUNCH_PREPARATION" && /CLAUDE_CONFIG_DIR volatile/.test(e.message) && /harness package resolution/.test(e.message));
  assert.deepEqual(realRuns(home), [], "refused in preflight: no real run");
});
