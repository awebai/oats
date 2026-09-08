import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { recipeFromLegacyCommand, restartInstanceSession, startInstanceSession, inspectInstanceSession, stopHarness } from "../lib/core.mjs";
import { spawn as spawnProcess } from "node:child_process";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
// ---- real tmux on a private socket, fake harnesses that record and idle ----
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-session-restart-")));
const socket = join(base, "tmux.sock");
const session = "r";
const tmux = (...args) => execFileSync("tmux", ["-u", "-S", socket, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const windows = () => { try { return tmux("list-windows", "-t", session, "-F", "#{window_name}").split("\n").filter(Boolean); } catch { return []; } };
test.after(() => { try { tmux("kill-server"); } catch { /* gone */ } rmSync(base, { recursive: true, force: true }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
// A harness that records argv and environment, then idles; `polite` exits on TERM, `stubborn` ignores it.
const binDir = join(base, "bin"); mkdirSync(binDir);
write(join(binDir, "polite"), `#!/bin/sh\nprintf '%s\\n' "$@" > "$OATS_INSTANCE_HOME/argv.txt"\nenv > "$OATS_INSTANCE_HOME/env.txt"\necho $$ > "$OATS_INSTANCE_HOME/pid.txt"\ntrap 'exit 0' TERM\nwhile :; do sleep 0.2; done\n`);
write(join(binDir, "stubborn"), `#!/bin/sh\necho $$ > "$OATS_INSTANCE_HOME/pid.txt"\ntrap '' TERM\nwhile :; do sleep 0.2; done\n`);
for (const n of ["polite", "stubborn", "claude", "codex", "pi"]) chmodSync(join(binDir, n === "claude" || n === "codex" || n === "pi" ? "polite" : n), 0o755);
for (const n of ["claude", "codex", "pi"]) { write(join(binDir, n), readFileSync(join(binDir, "polite"), "utf8")); chmodSync(join(binDir, n), 0o755); }
const env = (extra = {}) => { const e = { ...process.env, PATH: `${binDir}:${process.env.PATH}`, OATS_HOME_DIR: join(base, "oats-home"), ...extra }; for (const k of ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT"]) delete e[k]; return e; };
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// A scope with a soul and two configurations; homes are written the way spawn writes them (recipe or legacy command).
const repo = join(base, "repo"); mkdirSync(join(repo, "agents", "dev", "soul"), { recursive: true });
spawnSync("git", ["init", "-q", repo]);
write(join(repo, "agents", "dev", "soul", "soul.yaml"), "name: dev\nrepo: .\nwork: checkout\nruntime: claude\n");
write(join(repo, "agents", "dev", "soul", "AGENTS.md"), "# dev\n");
write(join(repo, "oats-config.yaml"), `name: r\ncapabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\nlaunch-configs:\n  polite:\n    runtime: claude\n    executable: ${JSON.stringify(join(binDir, "polite"))}\n    args:\n      - "--flag"\n      - "a b c"\n    env:\n      KEY:\n        fromEnv: RESTART_TEST_SRC\n      LIT: "plain"\n    model: "claude-opus-5"\n  stubborn:\n    runtime: claude\n    executable: ${JSON.stringify(join(binDir, "stubborn"))}\n  codexy:\n    runtime: codex\n    executable: ${JSON.stringify(join(binDir, "polite"))}\n`);
function makeHome(name, { command, launch, runtime = "claude", model, capabilityRuntime } = {}) {
  const home = join(repo, "agents", "dev", "instances", name); mkdirSync(home, { recursive: true });
  write(join(home, "TASK.md"), "task\n");
  const meta = { agent: "dev", kind: "persistent", instance: name, home, repo, work: "checkout", branch: null, runtime, ...(model ? { model } : {}), tmux: { session, window: name, socket }, command, ...(launch ? { launch } : {}), launched: true, createdAt: "2026-09-07T00:00:00.000Z", ...(capabilityRuntime ? { capabilityRuntime } : {}) };
  write(join(home, "instance.json"), JSON.stringify(meta, null, 2) + "\n");
  const key = createHash("sha256").update(home).digest("hex");
  const baselinePath = join(dirname(home), ".oats-retirement", "baselines", `${key}.json`);
  write(baselinePath, JSON.stringify({ version: 2, home, homeFingerprint: { files: 3, digest: "fp" }, disposableReceipts: [], generatedWorkFingerprint: { digest: "fp-work" }, runtime: { launched: true, tmux: { session, window: name, socket } } }, null, 2) + "\n");
  return { home, meta };
}
const recipeFor = (home, name, { executable, args = [], env = {}, hooksEnv = {}, contributions = [] } = {}) => ({ version: 1, runtime: "claude", launchConfig: null, launchConfigSource: null, executable, executableDeclared: null, executableResolvedFrom: "PATH", args, env, model: null, yolo: true, hooks: { launch: {}, env: hooksEnv, contributions }, prompt: { kind: "task-file", file: "TASK.md" } });
const renderFor = (home, name, exe, extraEnv = "") => `OATS_INSTANCE=${shq(name)} OATS_INSTANCE_HOME=${shq(home)} PI_AGENT_INSTANCE=${shq(name)} PI_AGENT_HOME=${shq(home)}${extraEnv} ${shq(exe)} --dangerously-skip-permissions -- "$(cat TASK.md)"`;
async function waitFor(pred, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if (pred()) return true; await sleep(100); } return pred(); }
const runningPid = (home) => { try { const pid = Number(readFileSync(join(home, "pid.txt"), "utf8").trim()); process.kill(pid, 0); return pid; } catch { return null; } };

test("restart: every preflight before the stop; a polite harness ends on SIGTERM and the new configuration starts in place with literal args and the reference under its alias", async () => {
  const name = "dev-polite";
  const { home } = makeHome(name, { command: renderFor(join(repo, "agents", "dev", "instances", name), name, join(binDir, "polite")), launch: recipeFor(join(repo, "agents", "dev", "instances", name), name, { executable: join(binDir, "polite") }) });
  tmux("new-session", "-d", "-s", session, "-n", "hq", "-c", home);
  const first = startInstanceSession(home, { env: env() });
  assert.equal(first.reused, "new");
  assert.ok(await waitFor(() => runningPid(home) !== null), "the first harness is up");
  const oldPid = runningPid(home);
  // Preflight refusals leave the running harness alone.
  for (const [sel, code] of [[{ launchConfig: "nope" }, "E_LAUNCH_CONFIG_UNKNOWN"], [{ launchConfig: "polite", runtime: "codex" }, "E_LAUNCH_CONFIG_MISMATCH"], [{ launchConfig: "polite" }, "E_LAUNCH_ENV_MISSING"]]) {
    assert.throws(() => restartInstanceSession(home, { ...sel, env: env() }), (e) => e.code === code, code);
    assert.equal(runningPid(home), oldPid, `${code}: still the same harness`);
    assert.equal(existsSync(join(home, ".oats-restart.json")), false, `${code}: no stop was attempted`);
  }
  // The restart: stop observed, then the in-place start; the pane gets the alias, the command names no source variable.
  const r = restartInstanceSession(home, { launchConfig: "polite", env: env({ RESTART_TEST_SRC: "s3cret" }), stopGraceMs: 5000 });
  assert.equal(r.reused, "pane"); assert.equal(r.stop.exited, true); assert.equal(r.stop.signal, "SIGTERM"); assert.equal(r.stop.requested[0].pid, oldPid);
  assert.equal(r.launchConfig, "polite"); assert.equal(r.model, "claude-opus-5");
  assert.ok(await waitFor(() => runningPid(home) !== null && runningPid(home) !== oldPid), "a new harness is up");
  const argv = readFileSync(join(home, "argv.txt"), "utf8").split("\n");
  assert.deepEqual(argv.slice(0, 5), ["--dangerously-skip-permissions", "--model", "claude-opus-5", "--flag", "a b c"], "literal args, spaces intact");
  const paneEnv = Object.fromEntries(readFileSync(join(home, "env.txt"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  assert.equal(paneEnv.KEY, "s3cret", "the reference resolved in the pane"); assert.equal(paneEnv.LIT, "plain"); assert.equal(paneEnv.OATS_LAUNCH_REF_KEY, "s3cret");
  const meta = readJson(join(home, "instance.json"));
  assert.equal(meta.launch.launchConfig, "polite"); assert.deepEqual(meta.launch.env, { KEY: { fromEnv: "RESTART_TEST_SRC" }, LIT: "plain" });
  assert.ok(meta.command.includes(`KEY="$OATS_LAUNCH_REF_KEY"`) && !meta.command.includes("s3cret") && !meta.command.includes("RESTART_TEST_SRC"), meta.command);
  assert.equal(meta.restartCount, 2); assert.equal(meta.runtime, "claude");
  const receipt = readJson(join(home, ".oats-restart.json"));
  assert.equal(receipt.stop.exited, true); assert.equal(receipt.next.launchConfig, "polite");
  assert.ok(!JSON.stringify(receipt).includes("s3cret"));
  assert.deepEqual(windows().filter((w) => w === name), [name], "one window for the home");
  // A model-only start later keeps the recorded configuration and re-checks its references.
  process.kill(runningPid(home), "SIGTERM"); await waitFor(() => runningPid(home) === null);
  await waitFor(() => inspectInstanceSession(home).state === "shell");
  assert.throws(() => startInstanceSession(home, { model: "claude-sonnet-5", env: env() }), (e) => e.code === "E_LAUNCH_ENV_MISSING", "the recorded reference is re-checked on a model-only start");
  const again = startInstanceSession(home, { model: "claude-sonnet-5", env: env({ RESTART_TEST_SRC: "again" }) });
  assert.equal(again.model, "claude-sonnet-5"); assert.equal(again.launchConfig, "polite");
  assert.ok(await waitFor(() => runningPid(home) !== null));
  assert.equal(Object.fromEntries(readFileSync(join(home, "env.txt"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])).KEY, "again");
  assert.equal(readJson(join(home, "instance.json")).launch.model, "claude-sonnet-5", "the recipe follows the model-only start");
});

test("restart: a harness that ignores SIGTERM is reported still running after the bounded wait; nothing is escalated or launched; a neighbour window is untouched", async () => {
  const name = "dev-stubborn";
  const { home } = makeHome(name, { command: renderFor(join(repo, "agents", "dev", "instances", name), name, join(binDir, "stubborn")), launch: recipeFor(join(repo, "agents", "dev", "instances", name), name, { executable: join(binDir, "stubborn") }) });
  tmux("new-window", "-t", `${session}:`, "-n", "neighbour", "-c", home, "sleep 60");
  startInstanceSession(home, { env: env() });
  assert.ok(await waitFor(() => runningPid(home) !== null));
  const pid = runningPid(home);
  const before = readFileSync(join(home, "instance.json"), "utf8");
  const t = Date.now();
  assert.throws(() => restartInstanceSession(home, { launchConfig: "polite", env: env({ RESTART_TEST_SRC: "x" }), stopGraceMs: 1500 }), (e) => e.code === "E_SESSION_STOP_FAILED" && /still running after/.test(e.message) && /nothing was escalated/.test(e.message));
  assert.ok(Date.now() - t < 6000, "bounded");
  assert.equal(runningPid(home), pid, "the stubborn harness is still there, untouched by any stronger signal");
  assert.equal(readFileSync(join(home, "instance.json"), "utf8"), before, "metadata unchanged");
  assert.equal(existsSync(join(home, ".oats-start-pending.json")), false, "no launch receipt was written");
  const receipt = readJson(join(home, ".oats-restart.json"));
  assert.equal(receipt.stop.exited, false); assert.deepEqual(receipt.stop.stillRunning, [pid]);
  assert.ok(windows().includes("neighbour") && windows().filter((w) => w === name).length === 1);
  process.kill(pid, "SIGKILL"); // test cleanup only
});

test("legacy homes: a plain session-delivery command converts narrowly (environment attributed through the recorded capability declarations) and can switch runtime; unclassified arguments are refused", async () => {
  const capabilityRuntime = [{ id: "oats.aweb", layer: "messaging", level: repo, settings: { delivery: "session" }, hooks: {}, requiredHooks: [], environment: ["AWEB_DELIVERY"], environmentNamespaces: ["AWEB_"], missingRequires: [], trust: { trusted: true, integrity: "sha256-x" }, executable: true }];
  const name = "dev-legacy";
  const home = join(repo, "agents", "dev", "instances", name);
  makeHome(name, { command: renderFor(home, name, join(binDir, "polite"), " AWEB_DELIVERY='session'"), model: "claude-x", capabilityRuntime });
  const meta = readJson(join(home, "instance.json"));
  const { recipe, extras } = recipeFromLegacyCommand(meta, home);
  assert.deepEqual(extras, []);
  assert.deepEqual([recipe.runtime, recipe.executable, recipe.yolo, recipe.model, recipe.args, recipe.env, recipe.hooks.env, recipe.legacy], ["claude", join(binDir, "polite"), true, "claude-x", [], {}, { AWEB_DELIVERY: "session" }, { convertedFrom: "command", unclassified: [] }]);
  assert.deepEqual(recipe.hooks.contributions.map((c) => [c.capability, c.env, c.trust.trusted, c.settings]), [["oats.aweb", ["AWEB_DELIVERY"], true, { delivery: "session" }]], "the environment is attributed to the capability that declared it");
  // The switch to a codex configuration, from the command line: no stop needed (stopped home), conversion recorded, env carried.
  tmux("new-window", "-t", `${session}:`, "-n", name, "-c", home, "exec ${SHELL:-/bin/zsh}");
  await sleep(300);
  const r = spawnSync(process.execPath, [CLI, "session", "restart", "--home", home, "--launch-config", "codexy", "--json"], { encoding: "utf8", env: env() });
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.ok, true, r.stdout + r.stderr);
  assert.equal(out.result.runtime, "codex"); assert.equal(out.result.launchConfig, "codexy"); assert.equal(out.result.model, null, "no model crosses the runtime");
  assert.ok(await waitFor(() => runningPid(home) !== null));
  const after = readJson(join(home, "instance.json"));
  assert.equal(after.runtime, "codex"); assert.equal(after.launch.launchConfig, "codexy"); assert.deepEqual(after.launch.hooks.env, { AWEB_DELIVERY: "session" }); assert.equal(after.launch.legacy.convertedFrom, "command");
  assert.ok(after.command.includes("AWEB_DELIVERY='session'") && after.command.includes("--cd") && !after.command.includes("--dangerously-skip-permissions"), after.command);
  assert.equal(Object.fromEntries(readFileSync(join(home, "env.txt"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])).AWEB_DELIVERY, "session", "the runtime-neutral environment reached the codex pane");
  process.kill(runningPid(home), "SIGTERM");
  // Unclassified arguments (a channel flag) with no launch hook to prepare them: refused with the arguments named.
  const name2 = "dev-channel";
  const home2 = join(repo, "agents", "dev", "instances", name2);
  makeHome(name2, { command: renderFor(home2, name2, join(binDir, "polite")).replace(" -- ", " --dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace -- "), capabilityRuntime });
  const conv = recipeFromLegacyCommand(readJson(join(home2, "instance.json")), home2);
  assert.deepEqual(conv.extras, ["--dangerously-load-development-channels", "plugin:aweb-channel@awebai-marketplace"]);
  assert.throws(() => restartInstanceSession(home2, { runtime: "codex", env: env() }), (e) => e.code === "E_LAUNCH_LEGACY" && /dangerously-load-development-channels/.test(e.message) && /launch hook/.test(e.message));
  assert.equal(existsSync(join(home2, ".oats-restart.json")), false);
});

test("every start of a recipe home goes through the planner: a missing recorded executable or an unknown recipe shape refuses an ordinary start before anything", () => {
  const name = "dev-badrecipe";
  const home = join(repo, "agents", "dev", "instances", name);
  makeHome(name, { command: renderFor(home, name, join(binDir, "polite")), launch: recipeFor(home, name, { executable: join(base, "no-such-harness") }) });
  assert.throws(() => startInstanceSession(home, { env: env() }), (e) => e.code === "E_LAUNCH_EXECUTABLE" && /no-such-harness/.test(e.message));
  assert.throws(() => startInstanceSession(home, { model: "claude-x", env: env() }), (e) => e.code === "E_LAUNCH_EXECUTABLE", "model-only starts are planned too");
  const meta = readJson(join(home, "instance.json"));
  write(join(home, "instance.json"), JSON.stringify({ ...meta, launch: { ...meta.launch, version: 7 } }));
  assert.throws(() => startInstanceSession(home, { env: env() }), (e) => e.code === "E_LAUNCH_RECIPE_UNSUPPORTED");
  assert.equal(existsSync(join(home, ".oats-start-pending.json")), false, "nothing was allocated");
  assert.ok(!windows().includes(name));
});

test("a restart to another runtime whose metadata write is interrupted is recovered by the next start with ONE allocation and the new recipe; a running recovered target refuses a new selection factually", async () => {
  const name = "dev-recover";
  const home = join(repo, "agents", "dev", "instances", name);
  makeHome(name, { command: renderFor(home, name, join(binDir, "polite")), launch: recipeFor(home, name, { executable: join(binDir, "polite") }) });
  startInstanceSession(home, { env: env() });
  assert.ok(await waitFor(() => runningPid(home) !== null));
  assert.throws(() => restartInstanceSession(home, { launchConfig: "codexy", env: env(), stopGraceMs: 5000, io: { failBeforeMetadataWrite: true } }), (e) => e.code === "E_SESSION_START_INCOMPLETE");
  const pending = readJson(join(home, ".oats-start-pending.json"));
  assert.deepEqual([pending.runtime, pending.launch.launchConfig, pending.launch.runtime, pending.model], ["codex", "codexy", "codex", null], "the receipt carries the new recipe");
  assert.equal(readJson(join(home, "instance.json")).runtime, "claude", "metadata still says the old runtime");
  assert.ok(await waitFor(() => runningPid(home) !== null), "the new harness is up");
  const recovered = startInstanceSession(home, { env: env() });
  assert.equal(recovered.reused, "adopted"); assert.equal(recovered.runtime, "codex"); assert.equal(recovered.launchConfig, "codexy"); assert.equal(recovered.model, null);
  const meta = readJson(join(home, "instance.json"));
  assert.deepEqual([meta.runtime, meta.launch.launchConfig, meta.launch.runtime, meta.model], ["codex", "codexy", "codex", undefined]);
  assert.equal(windows().filter((w) => w === name).length, 1, "one allocation");
  assert.equal(existsSync(join(home, ".oats-start-pending.json")), true, "the receipt stays until the command exits");
  // A choice made now against the running recovered target is refused, not silently ignored.
  assert.throws(() => startInstanceSession(home, { launchConfig: "polite", env: env({ RESTART_TEST_SRC: "x" }) }), (e) => e.code === "E_SESSION_RUNNING" && /was not applied/.test(e.message));
  assert.throws(() => startInstanceSession(home, { runtime: "claude", env: env() }), (e) => e.code === "E_SESSION_RUNNING" && /was not applied/.test(e.message));
  // A pending receipt whose recipe is not a shape this kernel starts from is refused before anything.
  write(join(home, ".oats-start-pending.json"), JSON.stringify({ ...pending, launch: { ...pending.launch, version: 9 } }));
  assert.throws(() => startInstanceSession(home, { env: env() }), (e) => e.code === "E_SESSION_UNKNOWN" && /invalid receipt/.test(e.message));
  write(join(home, ".oats-start-pending.json"), JSON.stringify(pending));
  process.kill(runningPid(home), "SIGTERM");
});

test("Herdr: the pane shell's verified process tree is signalled (never the shell itself, never a fabricated pid); exit is observed through Herdr; a timeout reports the process still running; an unverifiable pid refuses", async () => {
  // A real launcher shell with a real polite harness child stands in for the pane (as Herdr's `exec /bin/sh -c` leaves it); Herdr's answers come from a fake transport.
  const home = join(base, "herdr-home"); mkdirSync(home, { recursive: true });
  const child = spawnProcess("/bin/sh", ["-c", `${JSON.stringify(join(binDir, "polite"))}; exit 0`], { stdio: "ignore", env: { ...process.env, OATS_INSTANCE_HOME: home } });
  try {
    assert.ok(await waitFor(() => existsSync(join(home, "pid.txt"))), "the harness child is up");
    const harnessPid = Number(readFileSync(join(home, "pid.txt"), "utf8").trim());
    const target = { backend: "herdr", binary: "/fake/herdr", socket: join(base, "herdr.sock"), protocol: 20, workspaceId: "w0", paneId: "p0", terminalId: "t0" };
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    let info = () => ({ shell_pid: child.pid, foreground_process_group_id: child.pid, foreground_processes: [{ name: "sh", pid: alive(harnessPid) ? harnessPid : child.pid }] });
    const calls = [];
    const fakeExec = (binary, args, options) => {
      if (binary === "ps") return execFileSync(binary, args, options);
      calls.push(args.join(" "));
      let result;
      if (args.join(" ") === "api snapshot") result = { snapshot: { protocol: 20, panes: [{ pane_id: "p0", terminal_id: "t0", workspace_id: "w0" }], agents: alive(harnessPid) ? [{ terminal_id: "t0", agent_status: "working" }] : [] } };
      else if (args[1] === "process-info") result = { process_info: info() };
      else assert.fail(`unexpected Herdr call: ${args}`);
      return JSON.stringify({ result });
    };
    const io = { exec: fakeExec };
    // Timeout first: the injected kill withholds the signal, so the process stays and nothing is escalated.
    let r = stopHarness(target, { graceMs: 600, io, kill: (pid, sig) => { if (sig === 0) return process.kill(pid, 0); calls.push(`kill ${pid} ${sig}`); } });
    assert.equal(r.exited, false); assert.ok(r.requested.some((x) => x.pid === harnessPid) && !r.requested.some((x) => x.pid === child.pid), "the harness under the pane shell, not the shell");
    assert.deepEqual(r.stillRunning.includes(harnessPid), true);
    assert.ok(calls.includes(`kill ${harnessPid} SIGTERM`) && !calls.some((c) => /SIGKILL/.test(c)));
    assert.ok(alive(harnessPid), "still there");
    // The real SIGTERM: the harness ends, the launcher shell finishes, Herdr's snapshot loses the agent, exit is observed.
    r = stopHarness(target, { graceMs: 5000, io });
    assert.equal(r.exited, true); assert.ok(r.requested.some((x) => x.pid === harnessPid)); assert.ok(!alive(harnessPid));
    // An unverifiable pane shell pid is refused before any signal.
    info = () => ({ shell_pid: 999999, foreground_process_group_id: null, foreground_processes: [] });
    const running = { exec: (b, a, o) => b === "ps" ? execFileSync(b, a, o) : a.join(" ") === "api snapshot" ? JSON.stringify({ result: { snapshot: { protocol: 20, panes: [{ pane_id: "p0", terminal_id: "t0", workspace_id: "w0" }], agents: [{ terminal_id: "t0", agent_status: "working" }] } } }) : fakeExec(b, a, o) };
    assert.throws(() => stopHarness(target, { graceMs: 100, io: running }), (e) => e.code === "E_SESSION_UNKNOWN" && /no such process/.test(e.message));
  } finally {
    try { child.kill("SIGKILL"); } catch { /* gone */ }
    try { process.kill(Number(readFileSync(join(home, "pid.txt"), "utf8").trim()), "SIGKILL"); } catch { /* gone */ }
  }
});
