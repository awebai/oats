// Plain `oats` inside an instance is the kernel that launched it. Every launch
// (spawn, session start, session restart) writes <home>/.oats/bin/oats, a
// symlink to the launching kernel's bin/oats.mjs, and runs the harness with
// <home>/.oats/bin first on PATH. The recipe records the target (kernelBin).
// A different `oats` earlier on the host's PATH (a second kernel) is not what
// the instance finds.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { OATS_VERSION, launchEnvRefs, launchShellCommand, parseLaunchCommand, renderLaunchCommand, restartInstanceSession, startInstanceSession } from "../lib/core.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { isolateSessionEnvironment, oatsSocket, waitUntil } from "./helpers/host-fixture.mjs";

const KERNEL_BIN = realpathSync(resolve(new URL("../bin/oats.mjs", import.meta.url).pathname));
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-kernel-shim-")));
const session = "k";
const restoreEnvironment = isolateSessionEnvironment(base);
const socket = oatsSocket(); // the fixture's own `oats` server: where the kernel creates windows
const tmux = (...args) => execFileSync("tmux", ["-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const windows = () => { try { return tmux("list-windows", "-t", session, "-F", "#{window_name}").split("\n").filter(Boolean); } catch { return []; } };
test.after(() => { try { tmux("kill-server"); } catch { /* gone */ } finally { restoreEnvironment(); rmSync(base, { recursive: true, force: true }); } });
function write(p, c, mode) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); if (mode) chmodSync(p, mode); }
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// A harness that records what the instance would see: its PATH, which `oats` that finds, and
// what that `oats` says it is. It idles until TERM, or exits at once under PROBE_ONCE. The idle is an
// `exec`ed sleep, not a shell loop, so the session never reads as the fallback prompt (#415).
const binDir = join(base, "bin");
const probe = join(binDir, "probe");
write(probe, `#!/bin/sh
printf '%s\\n' "$PATH" > "$OATS_INSTANCE_HOME/path.txt"
printf '%s\\n' "$@" > "$OATS_INSTANCE_HOME/args.txt"
command -v oats > "$OATS_INSTANCE_HOME/which-oats.txt"
oats version --json > "$OATS_INSTANCE_HOME/version.json" 2> "$OATS_INSTANCE_HOME/version.err"
[ -n "$PROBE_ONCE" ] && exit 0
echo $$ > "$OATS_INSTANCE_HOME/pid.txt"
exec sleep 86400
`, 0o755);
// A second kernel on the host's PATH, as a machine with a global 0.24 and a prefix 0.30 has.
const fakeKernel = join(binDir, "oats");
write(fakeKernel, `#!/bin/sh\nprintf '{"version":"0.0.0-fake"}\\n'\n`, 0o755);
process.env.PATH = `${binDir}:${process.env.PATH}`;
const systemBin = process.env.PATH.split(":")[1];

const fx = v2Deployment({
  souls: { dev: {} },
  local: { "launch-configs": {
    probe: { harness: "claude", executable: probe },
    codexprobe: { harness: "codex", executable: probe },
    codexliteral: { harness: "codex", executable: probe, env: { PATH: `${systemBin}:/usr/bin:/bin` } },
    literal: { harness: "claude", executable: probe, env: { PATH: `${systemBin}:/usr/bin:/bin` } },
    ref: { harness: "claude", executable: probe, env: { PATH: { fromEnv: "SHIM_TEST_PATH" } } },
  } },
});
test.after(() => fx.cleanup());

const shimDir = (home) => join(home, ".oats", "bin");
/** A spawned home, not launched, pointed at the private tmux socket as a started home would be. */
async function spawnHome(name, launchConfig = "probe") {
  const { home } = await fx.spawn("dev", { name, work: "checkout", launch: false, launchConfig });
  const meta = { ...readJson(join(home, "instance.json")), tmux: { session, window: name, socket }, launched: true };
  write(join(home, "instance.json"), JSON.stringify(meta, null, 2) + "\n");
  const baselinePath = join(dirname(home), ".oats-retirement", "baselines", `${createHash("sha256").update(home).digest("hex")}.json`);
  write(baselinePath, JSON.stringify({ ...readJson(baselinePath), runtime: { launched: true, tmux: { session, window: name, socket } } }, null, 2) + "\n");
  return home;
}
/** The composed launch of a home's persisted command, run once under /bin/sh from the home, as a pane would. */
function runComposed(home, extraEnv = {}) {
  const meta = readJson(join(home, "instance.json"));
  const refs = Object.fromEntries(launchEnvRefs(meta.launch, { ...process.env, ...extraEnv }).map((r) => [r.name, r.value]));
  const r = spawnSync("/bin/sh", ["-c", launchShellCommand(meta.command, home)], { cwd: home, encoding: "utf8", env: { ...process.env, ...extraEnv, ...refs, PROBE_ONCE: "1" } });
  assert.equal(r.status, 0, r.stderr);
  return { path: readFileSync(join(home, "path.txt"), "utf8").trim(), which: readFileSync(join(home, "which-oats.txt"), "utf8").trim(), version: readJson(join(home, "version.json")).version };
}
const pathOf = (home) => readFileSync(join(home, "path.txt"), "utf8").trim();

test("spawn --no-launch writes the shim to this kernel and records it; the composed launch finds it first, not the host's other oats", async () => {
  const home = await spawnHome("shim-spawn");
  const shim = join(shimDir(home), "oats");
  assert.ok(lstatSync(shim).isSymbolicLink(), "the shim is a symlink");
  assert.equal(readlinkSync(shim), KERNEL_BIN, "it points at this kernel's canonical bin/oats.mjs");
  const meta = readJson(join(home, "instance.json"));
  assert.equal(meta.launch.kernelBin, KERNEL_BIN, "the recipe records the shim target");
  // The persisted command is unchanged in shape: no PATH in it, and it round-trips byte for byte.
  assert.ok(!meta.command.includes(".oats/bin") && !/(^| )PATH=/.test(meta.command), meta.command);
  assert.equal(renderLaunchCommand(parseLaunchCommand(meta.command).tokens), meta.command);
  // The host's PATH finds the fake kernel first; the instance does not.
  assert.equal(execFileSync("/bin/sh", ["-c", "command -v oats"], { encoding: "utf8" }).trim(), fakeKernel);
  const seen = runComposed(home);
  assert.equal(seen.path, `${shimDir(home)}:${process.env.PATH}`, "the shim directory first, the rest of PATH unchanged");
  assert.equal(seen.which, shim);
  assert.equal(seen.version, OATS_VERSION, "plain oats is this kernel");
});

test("a configuration's PATH, literal or a reference, keeps the shim first", async () => {
  const literal = await spawnHome("shim-literal", "literal");
  assert.equal(runComposed(literal).path, `${shimDir(literal)}:${systemBin}:/usr/bin:/bin`);
  process.env.SHIM_TEST_PATH = `${systemBin}:/opt/elsewhere`; // a reference must resolve at spawn
  const ref = await spawnHome("shim-ref", "ref");
  const seen = runComposed(ref);
  assert.equal(seen.path, `${shimDir(ref)}:${systemBin}:/opt/elsewhere`);
  assert.equal(seen.version, OATS_VERSION);
});

test("session start runs the harness with the shim first; restart re-points a shim another kernel wrote", async () => {
  const home = await spawnHome("shim-start");
  const shim = join(shimDir(home), "oats");
  rmSync(shim); // start writes it, whatever spawn left
  startInstanceSession(home);
  await waitUntil(() => existsSync(join(home, "pid.txt")), "the harness to start");
  assert.equal(pathOf(home).split(":")[0], shimDir(home));
  assert.equal(readFileSync(join(home, "which-oats.txt"), "utf8").trim(), shim);
  assert.equal(readJson(join(home, "version.json")).version, OATS_VERSION);
  assert.equal(readJson(join(home, "instance.json")).launch.kernelBin, KERNEL_BIN);
  // Another kernel launched it last: its shim and its recorded target.
  rmSync(shim); symlinkSync(fakeKernel, shim);
  const meta = readJson(join(home, "instance.json"));
  write(join(home, "instance.json"), JSON.stringify({ ...meta, launch: { ...meta.launch, kernelBin: fakeKernel } }, null, 2) + "\n");
  for (const f of ["pid.txt", "version.json", "path.txt"]) rmSync(join(home, f), { force: true });
  restartInstanceSession(home, { stopGraceMs: 5000 });
  await waitUntil(() => existsSync(join(home, "pid.txt")), "the restarted harness");
  assert.equal(readlinkSync(shim), KERNEL_BIN, "the restarting kernel re-points the shim");
  assert.equal(readJson(join(home, "instance.json")).launch.kernelBin, KERNEL_BIN, "and records itself");
  assert.equal(readJson(join(home, "version.json")).version, OATS_VERSION);
  assert.equal(pathOf(home).split(":")[0], shimDir(home));
});

test("a codex start also sets the shim-first PATH for its tool commands; the persisted command carries no PATH", async () => {
  const home = await spawnHome("shim-codex", "codexprobe");
  const meta = readJson(join(home, "instance.json"));
  assert.ok(!meta.command.includes(".oats/bin") && !meta.command.includes("shell_environment_policy.set.PATH"), meta.command);
  startInstanceSession(home);
  await waitUntil(() => existsSync(join(home, "pid.txt")), "the harness to start");
  const args = readFileSync(join(home, "args.txt"), "utf8").split("\n");
  const set = args.filter((a) => a.startsWith("shell_environment_policy.set.PATH="));
  assert.equal(set.length, 1, args.join(" "));
  assert.equal(args[args.indexOf(set[0]) - 1], "-c");
  const value = JSON.parse(set[0].slice("shell_environment_policy.set.PATH=".length));
  assert.equal(value, pathOf(home), "the PATH the session runs under, shim first");
  assert.equal(value.split(":")[0], shimDir(home));
  assert.ok(args.some((a) => a === `shell_environment_policy.set.OATS_INSTANCE_HOME=${JSON.stringify(home)}`), "and the instance env, from the persisted command");
});

test("a codex configuration's literal PATH reaches tool commands behind the shim, never from the persisted command", async () => {
  const home = await spawnHome("shim-codex-literal", "codexliteral");
  assert.ok(!readJson(join(home, "instance.json")).command.includes("shell_environment_policy.set.PATH"));
  startInstanceSession(home);
  await waitUntil(() => existsSync(join(home, "pid.txt")), "the harness to start");
  const set = readFileSync(join(home, "args.txt"), "utf8").split("\n").filter((a) => a.startsWith("shell_environment_policy.set.PATH="));
  assert.deepEqual(set, [`shell_environment_policy.set.PATH=${JSON.stringify(`${shimDir(home)}:${systemBin}:/usr/bin:/bin`)}`]);
});

test("a home that records only its command still gets the shim and the PATH, with nothing recorded", async () => {
  const home = await spawnHome("shim-frozen");
  const meta = readJson(join(home, "instance.json"));
  delete meta.launch;
  write(join(home, "instance.json"), JSON.stringify(meta, null, 2) + "\n");
  rmSync(join(shimDir(home), "oats"));
  startInstanceSession(home);
  await waitUntil(() => existsSync(join(home, "pid.txt")), "the harness to start");
  assert.equal(readlinkSync(join(shimDir(home), "oats")), KERNEL_BIN);
  assert.equal(pathOf(home).split(":")[0], shimDir(home));
  assert.equal(readJson(join(home, "version.json")).version, OATS_VERSION);
  assert.equal(readJson(join(home, "instance.json")).launch, undefined, "a frozen command gains no recipe");
});

test("a start that cannot write the shim fails with E_LAUNCH_SHIM and starts nothing", async () => {
  const home = await spawnHome("shim-blocked");
  const shim = join(shimDir(home), "oats");
  rmSync(shim); write(join(shim, "occupied"), "a directory where the shim goes\n");
  assert.throws(() => startInstanceSession(home), (e) => e.code === "E_LAUNCH_SHIM" && e.message.includes(shim) && /nothing was started/.test(e.message), "named, with the path");
  assert.ok(!windows().includes("shim-blocked"), "no window was opened");
  assert.ok(!existsSync(join(home, ".oats-start-pending.json")), "no start receipt");
  assert.ok(!existsSync(join(home, "pid.txt")));
});

test("oats status names the kernel a home launches with: under --verbose, and whenever it is not this oats", async () => {
  const home = await spawnHome("shim-status");
  const line = (args) => fx.cli(["status", ...args]).stdout.split("\n").filter((l) => l.includes("kernel:")).map((l) => l.trim());
  assert.ok(!line([]).some((l) => l.includes(KERNEL_BIN)), "this kernel's own homes add no line by default");
  assert.ok(line(["--verbose"]).includes(`kernel: ${KERNEL_BIN}`));
  const meta = readJson(join(home, "instance.json"));
  write(join(home, "instance.json"), JSON.stringify({ ...meta, launch: { ...meta.launch, kernelBin: fakeKernel } }, null, 2) + "\n");
  assert.ok(line([]).includes(`kernel: ${fakeKernel} (not this oats)`));
});

test("a command an earlier kernel recorded round-trips byte for byte, and runs with only the shim PATH added before the binary", () => {
  const home = "/w/agents/dev/instances/it's";
  const recorded = `OATS_INSTANCE='dev-1' OATS_INSTANCE_HOME='/w/agents/dev/instances/it'\\''s' PI_AGENT_INSTANCE='dev-1' PI_AGENT_HOME='/w/agents/dev/instances/it'\\''s' AWEB_DELIVERY='session' KEY="$OATS_LAUNCH_REF_KEY" '/opt/homebrew/bin/claude' --dangerously-skip-permissions -- "$(cat TASK.md)"`;
  assert.equal(renderLaunchCommand(parseLaunchCommand(recorded).tokens), recorded);
  const dir = `'/w/agents/dev/instances/it'\\''s/.oats/bin'`;
  assert.equal(launchShellCommand(recorded, home), recorded.replace(` '/opt/homebrew/bin/claude'`, ` PATH=${dir}:"$PATH" '/opt/homebrew/bin/claude'`));
  const withPath = recorded.replace(`KEY="$OATS_LAUNCH_REF_KEY"`, `KEY="$OATS_LAUNCH_REF_KEY" PATH='/usr/bin:/bin'`);
  assert.equal(launchShellCommand(withPath, home), recorded.replace(`KEY="$OATS_LAUNCH_REF_KEY"`, `KEY="$OATS_LAUNCH_REF_KEY" PATH=${dir}:'/usr/bin:/bin'`));
});

test("a symlinked .oats or .oats/bin is refused: the shim is never written outside the home, and nothing starts", async () => {
  for (const [name, component] of [["shim-link-oats", ".oats"], ["shim-link-bin", join(".oats", "bin")]]) {
    const home = await spawnHome(name);
    const outside = join(base, `outside-${name}`);
    write(join(outside, "bin", "oats"), "#!/bin/sh\necho outside\n", 0o755);
    const before = readFileSync(join(outside, "bin", "oats"));
    const link = join(home, component);
    // Keep what .oats holds (the module copies) when it is the link that moves.
    if (component === ".oats") cpSync(join(home, ".oats", "modules"), join(outside, "modules"), { recursive: true });
    rmSync(link, { recursive: true, force: true });
    symlinkSync(component === ".oats" ? outside : join(outside, "bin"), link);
    assert.throws(() => startInstanceSession(home), (e) => e.code === "E_LAUNCH_SHIM" && e.message.includes(link) && /nothing was started/.test(e.message), component);
    assert.ok(lstatSync(join(outside, "bin", "oats")).isFile(), `${component}: the outside oats is still a file`);
    assert.deepEqual(readFileSync(join(outside, "bin", "oats")), before, `${component}: byte-identical`);
    assert.ok(!windows().includes(name), `${component}: no window`);
    assert.ok(!existsSync(join(home, ".oats-start-pending.json")), `${component}: no start receipt`);
  }
});

test("kernelBin stays in the home's record and out of every JSON answer (spawn, status)", async () => {
  const spawned = await fx.spawn("dev", { name: "shim-json", work: "checkout", launch: false, launchConfig: "probe" });
  assert.equal(readJson(join(spawned.home, "instance.json")).launch.kernelBin, KERNEL_BIN, "recorded on disk");
  assert.ok(spawned.launch && !Object.hasOwn(spawned.launch, "kernelBin"), "the spawn answer's recipe carries no kernelBin");
  const status = JSON.parse(fx.cli(["status", "--json"]).stdout);
  const row = status.agents.flatMap((a) => a.instances).find((i) => i.instance === "shim-json");
  assert.ok(row?.launch && !Object.hasOwn(row.launch, "kernelBin"), "the status row's recipe carries no kernelBin");
  assert.ok(!JSON.stringify(status).includes("kernelBin"));
});
