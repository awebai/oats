// E_LAUNCH_CONFIG_AMBIGUOUS on a start or restart of an existing home (awebai/oats#999): a launch that is
// selected anew and names no configuration, among several for its harness with no default, is refused
// whichever command asks. `oats session start|restart --reselect-launch` (with or without --harness) and
// `--harness X` alone select anew; a plain start runs the recorded recipe, and --launch-config <name> and
// --launch-config none name what to run. A refusal comes before anything is stopped: the session that
// was running still runs, on the same PID. Every way out the refusal names is run here as it is written.
// Real tmux on a private socket, and a harness that records its PID and idles.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { isolateSessionEnvironment, oatsSocket, waitUntil } from "./helpers/host-fixture.mjs";
import { startInstanceSession } from "../lib/core.mjs";

const CODE = "E_LAUNCH_CONFIG_AMBIGUOUS";
const LOCAL = "oats-local.yaml";
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-ambiguous-session-")));
const restoreEnvironment = isolateSessionEnvironment(base);
const socket = oatsSocket();
const session = "a";
const tmux = (...args) => execFileSync("tmux", ["-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const windows = () => { try { return tmux("list-windows", "-t", session, "-F", "#{window_name}").split("\n").filter(Boolean); } catch { return []; } };
const binDir = join(base, "bin"); mkdirSync(binDir);
for (const name of ["polite", "claude", "pi", "codex"]) { writeFileSync(join(binDir, name), `#!/bin/sh\necho $$ > "$OATS_INSTANCE_HOME/pid.txt"\nexec sleep 86400\n`); chmodSync(join(binDir, name), 0o755); }
process.env.PATH = `${binDir}:${process.env.PATH}`;
const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const sessionEnv = (fx) => { const e = { ...process.env, PATH: `${binDir}:${process.env.PATH}`, OATS_HOME_DIR: join(base, "oats-home"), OATS_REMOTE_CACHE: fx.env.OATS_REMOTE_CACHE }; for (const k of ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT"]) delete e[k]; return e; };
const oats = (fx, args, input) => spawnSync(process.execPath, [CLI, ...args, "--json"], { encoding: "utf8", env: sessionEnv(fx), ...(input === undefined ? {} : { input }) });
const envelope = (r) => { try { return JSON.parse(r.stdout.trim().split("\n").pop()); } catch { assert.fail(`no envelope: ${r.stdout}${r.stderr}`); } };
const ok = (r, what) => { const j = envelope(r); assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`); assert.equal(j.ok, true, `${what}: ${r.stdout}`); return j.result; };
const refused = (r, what) => { const j = envelope(r); assert.equal(j.ok, false, `${what}: ${r.stdout}`); assert.notEqual(r.status, 0, what); assert.equal(j.error.code, CODE, `${what}: ${r.stdout}`); return j.error; };
const setLocal = (fx, edit) => { const p = join(fx.dep, LOCAL); const v = YAML.parse(readFileSync(p, "utf8")); edit(v); writeFileSync(p, YAML.stringify(v, { lineWidth: 0 })); };
const runningPid = (home) => {
  try {
    const text = readFileSync(join(home, "pid.txt"), "utf8").trim();
    const pid = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(pid) || pid <= 1) return null;
    process.kill(pid, 0);
    return pid;
  } catch { return null; }
};
test.after(() => { try { tmux("kill-server"); } catch { /* gone */ } finally { restoreEnvironment(); rmSync(base, { recursive: true, force: true }); } });

// Two configurations for claude and two for pi, none `default: true`; one for codex.
const CONFIGS = { personal: { harness: "claude" }, work: { harness: "claude" }, fast: { harness: "pi" }, slow: { harness: "pi" }, only: { harness: "codex" } };
const SET_CONFIG = "oats soul launch set <soul> --launch-config <name>";
const SET_DEFAULT_CONFIG = "oats soul launch set '*' --launch-config <name>";
const SET = "oats launch-config set";
const MARK = `mark one default: true (${SET})`;
const bare = (harness) => `--launch-config none --harness ${harness}`;
/** The three sentences, by what was asked (docs/desktop-cli-api.md "Launch preferences"). */
const FIX = {
  harness: (harness) => `name one with --launch-config <name>, ask for the bare harness with ${bare(harness)}, or ${MARK}`,
  reselect: (harness) => `without --reselect-launch, name one with --launch-config <name> or ask for the bare harness with ${bare(harness)}; or pin the soul to one (${SET_CONFIG}) or ${MARK}, then reselect again`,
  reselectDefault: (harness) => `without --reselect-launch, name one with --launch-config <name> or ask for the bare harness with ${bare(harness)}; or name one for every soul without an entry (${SET_DEFAULT_CONFIG}), pin the soul to one (${SET_CONFIG}), or ${MARK}, then reselect again`,
  reselectHarness: (harness) => `without --reselect-launch, name one with --launch-config <name> or ask for the bare harness with ${bare(harness)}; or ${MARK}, then reselect again`,
};

/** A deployment in that state, a home of `dev` whose harness runs on the private socket, and one that is stopped. */
async function fixture(t, { launch = { dev: { harness: "claude" } } } = {}) {
  const fx = v2Deployment({ name: "acme", souls: { dev: {} }, local: { "launch-configs": CONFIGS, souls: { launch } } });
  // The fixture refuses to go while a process still works in it: end the panes first, then remove it.
  t.after(() => { try { tmux("kill-server"); } catch { /* gone */ } fx.cleanup(); });
  async function makeHome(name) {
    const { home } = await fx.spawn("dev", { name, work: "checkout", launch: false, harness: "claude", launchConfig: "none" });
    const command = `OATS_INSTANCE=${shq(name)} OATS_INSTANCE_HOME=${shq(home)} PI_AGENT_INSTANCE=${shq(name)} PI_AGENT_HOME=${shq(home)} ${shq(join(binDir, "polite"))} --dangerously-skip-permissions -- "$(cat TASK.md)"`;
    const meta = { ...JSON.parse(readFileSync(join(home, "instance.json"), "utf8")), harness: "claude", tmux: { session, window: name, socket }, launched: true, command,
      launch: { version: 2, harness: "claude", launchConfig: null, launchConfigSource: null, executable: join(binDir, "polite"), executableDeclared: null, executableResolvedFrom: "PATH", args: [], env: {}, model: null, yolo: true, hooks: { launch: {}, env: {}, contributions: [] }, prompt: { kind: "task-file", file: "TASK.md" } } };
    writeFileSync(join(home, "instance.json"), `${JSON.stringify(meta, null, 2)}\n`);
    const baselinePath = receiptOf(home);
    writeFileSync(baselinePath, `${JSON.stringify({ ...JSON.parse(readFileSync(baselinePath, "utf8")), runtime: { launched: true, tmux: { session, window: name, socket } } }, null, 2)}\n`);
    return home;
  }
  const home = await makeHome("dev-run");
  tmux("new-session", "-d", "-s", session, "-n", "hq", "-c", home);
  assert.equal(startInstanceSession(home, { env: sessionEnv(fx) }).reused, "new");
  await waitUntil(() => runningPid(home) !== null, "the harness to be up");
  const stopped = await makeHome("dev-idle");
  return { fx, home, stopped };
}
const receiptOf = (home) => join(dirname(home), ".oats-retirement", "baselines", `${createHash("sha256").update(home).digest("hex")}.json`);
/** What a refused start or restart must leave as it was: instance.json, the session receipt, and no trace of a stop or a pending start. */
const kept = (home) => ({ instance: readFileSync(join(home, "instance.json"), "utf8"), receipt: readFileSync(receiptOf(home), "utf8"), restart: existsSync(join(home, ".oats-restart.json")), events: existsSync(join(home, ".oats-events.jsonl")) ? readFileSync(join(home, ".oats-events.jsonl"), "utf8") : null });
/** A restart that goes on: a new harness process, and the launch instance.json records. */
async function restarted(fx, home, flags, what) {
  const before = runningPid(home);
  const result = ok(oats(fx, ["session", "restart", "--home", home, ...flags, "--stop-grace", "5"]), what);
  await waitUntil(() => runningPid(home) !== null && runningPid(home) !== before, `${what}: the new harness`);
  const meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  return { result, meta, launch: [meta.harness, meta.launch.launchConfig, meta.launch.launchConfigDefault === true, meta.launchFrom ?? null] };
}

test("a refused restart leaves the harness running with the same PID: session restart --reselect-launch, --reselect-launch --harness X and --harness X alone, and the same start of a stopped home starts nothing", async (t) => {
  const { fx, home, stopped } = await fixture(t);
  const pid = runningPid(home);
  const before = { [home]: kept(home), [stopped]: kept(stopped) };
  const rows = [
    [["--reselect-launch"], "claude", ["personal", "work"], FIX.reselect("claude")],
    [["--reselect-launch", "--harness", "claude"], "claude", ["personal", "work"], FIX.reselectHarness("claude")],
    [["--reselect-launch", "--harness", "pi"], "pi", ["fast", "slow"], FIX.reselectHarness("pi")],
    // --harness alone: the harness the home already runs, and another.
    [["--harness", "claude"], "claude", ["personal", "work"], FIX.harness("claude")],
    [["--harness", "pi"], "pi", ["fast", "slow"], FIX.harness("pi")],
  ];
  for (const [flags, harness, configurations, fix] of rows) for (const verb of ["restart", "start"]) {
    const target = verb === "restart" ? home : stopped;
    const what = `session ${verb} ${flags.join(" ")}`;
    const error = refused(oats(fx, ["session", verb, "--home", target, ...flags]), what);
    assert.deepEqual(error.details, { harness, configurations, fix }, what);
    assert.equal(error.message, `${LOCAL} declares 2 ${harness} launch configurations (${configurations.join(", ")}) and none is default: true, and this launch names none; ${fix}`, what);
    assert.equal(runningPid(home), pid, `${what}: the harness that was running still runs, with the same PID`);
    assert.deepEqual(kept(target), before[target], `${what}: instance.json, the receipt and the events are as they were, and no stop was attempted`);
    assert.deepEqual(windows().sort(), ["dev-run", "hq"], `${what}: no window was opened or closed`);
  }
  // A harness with one configuration and no default is not ambiguous: --harness codex runs the bare codex.
  const codex = await restarted(fx, home, ["--harness", "codex"], "--harness codex");
  assert.deepEqual(codex.launch, ["codex", null, false, "flag"]);
});

test("not refused in that state: a plain start or restart (the recorded recipe), --launch-config <name>, and --launch-config none alone or with --harness", async (t) => {
  const { fx, home, stopped } = await fixture(t);
  const recorded = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  const plain = await restarted(fx, home, [], "a plain restart");
  assert.deepEqual(plain.meta.launch, recorded.launch, "the recorded recipe runs, and stays");
  assert.deepEqual([plain.meta.launchFrom, plain.meta.launchAt], [recorded.launchFrom, recorded.launchAt], "nothing was selected: what the spawn recorded stays");
  assert.deepEqual((await restarted(fx, home, ["--launch-config", "work"], "--launch-config work")).launch, ["claude", "work", false, "flag"]);
  assert.deepEqual((await restarted(fx, home, ["--launch-config", "none"], "--launch-config none")).launch, ["claude", null, false, "flag"]);
  assert.deepEqual((await restarted(fx, home, ["--launch-config", "none", "--harness", "pi"], "--launch-config none --harness pi")).launch, ["pi", null, false, "flag"]);
  assert.deepEqual((await restarted(fx, home, ["--launch-config", "none", "--harness", "claude"], "--launch-config none --harness claude")).launch, ["claude", null, false, "flag"]);
  // A start of the stopped home, the same way.
  ok(oats(fx, ["session", "start", "--home", stopped]), "a plain start");
  await waitUntil(() => runningPid(stopped) !== null, "the plain start's harness");
  assert.deepEqual(windows().sort(), ["dev-idle", "dev-run", "hq"]);
});

/** The ways a fix names, in its order, each as the words a person types: a flag form to put on the
 *  refused command, or a command to run before it. A way the sentence does not name is not in the list. */
function waysOf(fix, harness) {
  const ways = [];
  for (const [kind, text] of [["flag", "--launch-config <name>"], ["flag", bare(harness)], ["command", SET_DEFAULT_CONFIG], ["command", SET_CONFIG], ["command", SET]]) {
    // `--launch-config <name>` also ends each `oats soul launch set` command: the flag way is its first mention.
    const at = kind === "flag" && text === "--launch-config <name>" ? (fix.startsWith("name one with --launch-config <name>") || fix.startsWith("without --reselect-launch, name one with --launch-config <name>") ? 0 : -1) : fix.indexOf(text);
    if (at >= 0) ways.push({ kind, text });
  }
  return ways;
}
const FLAGS = ["--launch-config <name>", bare("claude")];
const words = (text, soul, name) => text.replace("<soul>", soul).replace("<name>", name).replace("'*'", "*").split(" ");

test("each way out the refusal names, run as written after it, lets the refused start go on: for --reselect-launch (where the soul's entry, and where \"*\", chose the harness), --reselect-launch --harness X and --harness X alone", async (t) => {
  const { fx, home } = await fixture(t);
  const local = join(fx.dep, LOCAL);
  const cases = [
    { flags: ["--reselect-launch"], launch: { dev: { harness: "claude" } }, fix: FIX.reselect("claude"), ways: [...FLAGS, SET_CONFIG, SET], from: "local" },
    { flags: ["--reselect-launch"], launch: { "*": { harness: "claude" } }, fix: FIX.reselectDefault("claude"), ways: [...FLAGS, SET_DEFAULT_CONFIG, SET_CONFIG, SET], from: "local-default" },
    // With --harness no way through the soul is named: a flag decides before any layer.
    { flags: ["--reselect-launch", "--harness", "claude"], launch: { dev: { harness: "pi" } }, fix: FIX.reselectHarness("claude"), ways: [...FLAGS, SET], from: "flag" },
    { flags: ["--harness", "claude"], launch: { dev: { harness: "pi" } }, fix: FIX.harness("claude"), ways: [...FLAGS, SET], from: "flag" },
  ];
  for (const c of cases) {
    setLocal(fx, (v) => { v["launch-configs"] = structuredClone(CONFIGS); v.souls = { launch: c.launch }; });
    const state = readFileSync(local, "utf8");
    const what = `session restart ${c.flags.join(" ")} (${JSON.stringify(c.launch)})`;
    const error = refused(oats(fx, ["session", "restart", "--home", home, ...c.flags]), what);
    assert.equal(error.details.fix, c.fix, what);
    // A flag the sentence gives "without --reselect-launch" replaces it; otherwise it joins the command.
    const reselects = c.flags.includes("--reselect-launch");
    const kept = reselects ? c.flags.filter((f) => f !== "--reselect-launch") : c.flags;
    const ways = waysOf(error.details.fix, "claude");
    assert.deepEqual(ways.map((way) => way.text), c.ways, what);
    for (const way of ways) {
      writeFileSync(local, state);
      refused(oats(fx, ["session", "restart", "--home", home, ...c.flags]), `${what}, before ${way.text}`);
      const step = `${what}, after: ${way.text}`;
      if (way.kind === "flag") {
        // --harness stays where the sentence's flag does not carry one of its own.
        const flag = words(way.text, "dev", "work");
        const rest = flag.includes("--harness") ? kept.filter((f, i) => f !== "--harness" && kept[i - 1] !== "--harness") : kept;
        const r = await restarted(fx, home, [...rest, ...flag], step);
        assert.deepEqual(r.launch, ["claude", way.text === bare("claude") ? null : "work", false, "flag"], step);
        continue;
      }
      if (way.text === SET) ok(oats(fx, ["launch-config", "set", "work", "--file", "-", "--dir", fx.dep], JSON.stringify({ harness: "claude", default: true })), step);
      else ok(oats(fx, [...words(way.text, "dev", "work").slice(1), "--dir", fx.dep]), step);
      // "then reselect again": the same command as was refused.
      const r = await restarted(fx, home, c.flags, step);
      assert.deepEqual(r.launch, ["claude", "work", way.text === SET, way.text === SET ? c.from : way.text === SET_DEFAULT_CONFIG ? "local-default" : "local"], step);
    }
  }
});
