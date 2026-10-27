// Session resume (#1559) on real tmux: the fixture's own `oats` server in a private TMUX_TMPDIR,
// stand-in harnesses (one node script, named by absolute path in each deployment's launch
// configurations) that record the argv and environment they were started with, write a transcript
// where their harness would (Claude's projects, pi's sessions), and idle. Three deployments in one
// machine registry: A and C differ in their launch configurations, B opts out
// (`session.resume: off`).
//
// The homes are started, one is stopped with OATS, one ends on its own (`exit 0`), and the tmux
// server is killed. `oats session resume --json` then brings back the lost ones in their own
// conversations (asserted on the argv the stand-ins received), under their own deployment's launch
// configuration; the stopped and the exited ones are not listed; B's home is not started; a second
// sweep reports `already-running` and starts nothing; a refusal is reported again in the same boot
// (`refused-this-boot`) without a second start; a held lock answers E_RESUME_BUSY.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { RESUME_NOTICE, stopInstanceSession } from "../lib/core.mjs";
import { readStartExited } from "../lib/session-end.mjs";
import { bootId } from "../lib/session-resume.mjs";
import { fixtureBase, isolateSessionEnvironment, oatsSocket, waitUntil } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const hasTmux = !spawnSync("tmux", ["-V"], { stdio: "ignore" }).error;
const TMUX = { skip: !hasTmux && "tmux is not installed" };
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const base = fixtureBase("oats-resume-");
const restoreEnvironment = hasTmux ? isolateSessionEnvironment(base) : () => {};
const socket = hasTmux ? oatsSocket() : null;
const oatsHome = join(base, "oats-home");
const records = join(base, "argv");
mkdirSync(records, { recursive: true });

// The stand-in harness. Its argv, RESUME_MARK and RESUME_SECRET go to <records>/<instance>.<n>.json.
// A fresh launch (no --resume / --session) writes a transcript whose cwd is the home, unless
// NO_TRANSCRIPT is set. `exit-now` in the home: it ends at once with status 0. `show-dialog` in the
// home: a resumed launch paints Claude's resume-cost dialog; otherwise it paints Claude's banner.
const standIn = join(base, "stand-in");
writeFileSync(standIn, `#!${process.execPath}
const { existsSync, mkdirSync, realpathSync, renameSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const args = process.argv.slice(2), env = process.env, home = env.OATS_INSTANCE_HOME;
const resumed = args.includes("--resume") || args.includes("--session");
const file = join(${JSON.stringify(records)}, env.OATS_INSTANCE + "." + Date.now() + "." + process.pid + ".json");
writeFileSync(file + ".tmp", JSON.stringify({ args, mark: env.RESUME_MARK ?? null, secret: env.RESUME_SECRET ?? null }));
renameSync(file + ".tmp", file);
if (!resumed && !env.NO_TRANSCRIPT && env.STANDIN_HARNESS !== "codex") {
  const id = randomUUID(), cwd = realpathSync(process.cwd()), now = new Date().toISOString();
  if (env.STANDIN_HARNESS === "pi") {
    const dir = join(env.PI_CODING_AGENT_DIR, "sessions", "--home--");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, now.replace(/[:.]/g, "-") + "_" + id + ".jsonl"), JSON.stringify({ type: "session", version: 3, id, timestamp: now, cwd }) + "\\n");
  } else {
    const dir = join(env.CLAUDE_CONFIG_DIR, "projects", "p");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, id + ".jsonl"), JSON.stringify({ type: "user", cwd, sessionId: id }) + "\\n");
  }
}
if (existsSync(join(home, "exit-now")) || env.EXIT_NOW) process.exit(0);
process.stdout.write(resumed && existsSync(join(home, "show-dialog"))
  ? " This session is 3d old and 912k tokens.\\n\\n ❯ 1. Resume from summary (recommended)\\n   2. Resume full session as-is\\n   3. Don't ask me again\\n"
  : "Claude Code v2.1.308\\n");
setInterval(() => {}, 1 << 30);
`, { mode: 0o755 });

const config = (harness, mark, extra = {}) => ({ harness, executable: standIn, env: { RESUME_MARK: mark, STANDIN_HARNESS: harness,
  ...(harness === "claude" ? { CLAUDE_CONFIG_DIR: join(base, `claude-${mark}`) } : harness === "pi" ? { PI_CODING_AGENT_DIR: join(base, `pi-${mark}`) } : { CODEX_HOME: join(base, `codex-${mark}`) }), ...(extra.env ?? {}) }, args: extra.args ?? [] });
const deployments = hasTmux ? {
  A: v2Deployment({ name: "a", local: { "launch-configs": { "claude-a": config("claude", "dep-a", { args: ["--from-a"] }), "pi-a": config("pi", "dep-a"), "codex-a": config("codex", "dep-a"), "exit-a": config("claude", "dep-a", { env: { EXIT_NOW: "1", NO_TRANSCRIPT: "1" } }) } } }),
  B: v2Deployment({ name: "b", local: { session: { resume: "off" }, "launch-configs": { "claude-b": config("claude", "dep-b") } } }),
  C: v2Deployment({ name: "c", local: { "launch-configs": {
    "claude-c": config("claude", "dep-c", { args: ["--from-c"], env: { NO_TRANSCRIPT: "1" } }),
    "needs-src": config("claude", "dep-c", { env: { RESUME_SECRET: { fromEnv: "RESUME_TEST_SRC" } } }) } } }),
} : {};
// One machine: one OATS_HOME_DIR, whose registry lists the three deployments.
const machine = { OATS_HOME_DIR: oatsHome };
if (hasTmux) {
  mkdirSync(join(oatsHome, "config"), { recursive: true });
  writeFileSync(join(oatsHome, "config", "deployments.json"), JSON.stringify({ schemaVersion: 1, imports: {},
    deployments: Object.values(deployments).map((fx) => ({ path: fx.dep, addedAt: "2026-10-27T00:00:00.000Z", via: "cli" })) }, null, 2) + "\n");
}

test.after(() => {
  try { if (hasTmux) execFileSync("tmux", ["-u", "-S", socket, "kill-server"], { stdio: "ignore" }); } catch { /* gone */ }
  restoreEnvironment();
  for (const fx of Object.values(deployments)) fx.cleanup();
});

/** The stand-in's records of `instance`, oldest first. */
const launches = (instance) => readdirSync(records).filter((f) => f.startsWith(`${instance}.`) && f.endsWith(".json"))
  .sort((a, b) => Number(a.split(".")[1]) - Number(b.split(".")[1]) || a.localeCompare(b)).map((f) => readJson(join(records, f)));
const cli = (fx, args, extra = {}) => fx.cli(args, { env: { ...machine, ...extra } });
const ok = (r, what) => { assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`); const env = r.json(); assert.equal(env.ok, true, `${what}: ${r.stdout}`); return env.result; };
const statusRows = (fx) => {
  const r = cli(fx, ["status", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return Object.fromEntries(JSON.parse(r.stdout).agents.flatMap((a) => a.instances).map((i) => [i.instance, i]));
};
const transcripts = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".jsonl")).map(String) : []);

async function spawnHome(fx, name, launchConfig, { launch = false, env = {} } = {}) {
  const saved = { ...process.env };
  Object.assign(process.env, { PATH: fx.env.PATH, ...env });
  try { return (await fx.spawn("dev", { name, launchConfig, ...(launch ? { launch: true } : {}) })).home; }
  finally { for (const k of ["PATH", ...Object.keys(env)]) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
async function startHome(fx, home, name, extra = {}) {
  ok(cli(fx, ["session", "start", "--home", home, "--json"], extra), `start ${name}`);
  await waitUntil(() => launches(name).length > 0, `${name}'s stand-in to run`);
}

test("after the tmux server dies, the sweep resumes the lost homes in their own conversations, under their own deployment's launch configuration; stopped, exited and opted-out homes stay as they are", TMUX, async () => {
  const { A, B, C } = deployments;
  const homes = {};
  // A: lost ones of each harness, one stopped with OATS, one that ends on its own, one launched by
  // spawn itself (its window's marker and startId), one that will stop at the resume-cost dialog.
  for (const [name, cfg] of [["a1", "claude-a"], ["a2", "claude-a"], ["a3", "claude-a"], ["a4", "pi-a"], ["a5", "codex-a"], ["a7", "claude-a"]]) homes[name] = await spawnHome(A, name, cfg);
  writeFileSync(join(homes.a3, "exit-now"), "");
  writeFileSync(join(homes.a7, "show-dialog"), "");
  for (const name of ["a1", "a2", "a3", "a4", "a5", "a7"]) await startHome(A, homes[name], name);
  homes.a6 = await spawnHome(A, "a6", "claude-a", { launch: true });
  await waitUntil(() => launches("a6").length > 0, "a6's stand-in, launched by spawn, to run");
  const spawned = readJson(join(homes.a6, "instance.json"));
  assert.match(spawned.startId ?? "", /^[0-9a-f-]{36}$/, "spawn records the start id of its launch");
  // B (opted out) and C (its own launch configurations).
  homes.b1 = await spawnHome(B, "b1", "claude-b");
  await startHome(B, homes.b1, "b1");
  homes.c1 = await spawnHome(C, "c1", "claude-c");
  homes.c2 = await spawnHome(C, "c2", "needs-src", { env: { RESUME_TEST_SRC: "s3cret" } });
  await startHome(C, homes.c1, "c1");
  await startHome(C, homes.c2, "c2", { RESUME_TEST_SRC: "s3cret" });
  assert.equal(launches("c2")[0].secret, "s3cret");

  // a2 is stopped with OATS; a3 ended by itself with status 0 (its marker names its start).
  const stopped = await A.inEnv(() => stopInstanceSession(homes.a2, { graceMs: 5000 }));
  assert.equal(stopped.stopped, true);
  assert.equal(readJson(join(homes.a2, ".oats-stop.json")).startId, readJson(join(homes.a2, "instance.json")).startId, "the stop receipt names the start it ended");
  await waitUntil(() => readStartExited(homes.a3) !== null, "a3's exit marker");
  assert.deepEqual(readStartExited(homes.a3), { startId: readJson(join(homes.a3, "instance.json")).startId, status: 0 });

  const conversation = (name) => {
    const dir = name === "a4" ? join(base, "pi-dep-a", "sessions") : join(base, "claude-dep-a", "projects");
    const files = transcripts(dir).filter((f) => readFileSync(join(dir, f), "utf8").includes(JSON.stringify(homes[name])));
    assert.equal(files.length, 1, `${name} wrote one transcript: ${files}`);
    return name === "a4" ? JSON.parse(readFileSync(join(dir, files[0]), "utf8")).id : files[0].split("/").pop().replace(/\.jsonl$/, "");
  };
  const ids = { a1: conversation("a1"), a4: conversation("a4"), a6: conversation("a6"), a7: conversation("a7") };

  // The shutdown: the server is killed under the live harnesses. No marker is written.
  execFileSync("tmux", ["-u", "-S", socket, "kill-server"], { stdio: "ignore" });
  await waitUntil(() => !existsSync(socket) || spawnSync("tmux", ["-u", "-S", socket, "has-session"]).status !== 0, "the server to be gone");
  const rowsA = statusRows(A);
  assert.deepEqual(Object.fromEntries(Object.entries(rowsA).map(([n, r]) => [n, [r.running, r.sessionEnd]])),
    { a1: [false, "lost"], a2: [false, "stopped"], a3: [false, "exited"], a4: [false, "lost"], a5: [false, "lost"], a6: [false, "lost"], a7: [false, "lost"] });
  assert.equal(statusRows(B).b1.sessionEnd, "lost");

  // Exited and stopped homes are refused one by one, before anything starts.
  for (const name of ["a2", "a3"]) {
    const r = cli(A, ["session", "start", "--resume", "--home", homes[name], "--json"]);
    assert.equal(r.status, 1, r.stdout);
    assert.equal(r.json().error.code, "E_RESUME_NOT_LOST", r.stdout);
  }
  const before = (name) => launches(name).length;
  const counts = Object.fromEntries(Object.keys(homes).map((n) => [n, before(n)]));

  // --plan: the prediction, nothing started, no lock or note.
  const plan = ok(cli(A, ["session", "resume", "--plan", "--json"]), "plan");
  assert.equal(plan.plan, true);
  const planned = Object.fromEntries(plan.rows.map((r) => [r.instance, [r.outcome, r.reason ?? r.sessionId ?? null]]));
  assert.deepEqual(planned, { a1: ["resumed", ids.a1], a4: ["resumed", ids.a4], a5: ["fresh", "resume-unproven"], a6: ["resumed", ids.a6], a7: ["resumed", ids.a7], c1: ["fresh", "no-conversation"], c2: ["resumed", planned.c2?.[1]] });
  assert.match(planned.c2[1], /^[0-9a-f-]{36}$/, "c2's refusal comes at its start: a plan reads the conversation only");
  assert.equal(existsSync(join(oatsHome, "session-resume")), false, "a plan takes no lock and writes no note");
  assert.deepEqual(Object.fromEntries(Object.keys(homes).map((n) => [n, before(n)])), counts, "a plan starts nothing");

  // The sweep. The envelope is the standard one; exit 0 whatever the rows say.
  const swept = cli(A, ["session", "resume", "--json"]);
  assert.equal(swept.status, 0, swept.stdout + swept.stderr);
  const envelope = swept.json();
  assert.deepEqual(Object.keys(envelope).filter((k) => k !== "warnings"), ["schemaVersion", "ok", "result"]);
  assert.equal(envelope.schemaVersion, 1);
  const answer = envelope.result;
  assert.deepEqual([answer.schemaVersion, answer.plan], [1, false]);
  assert.deepEqual(answer.deployments, [
    { deployment: A.dep, state: "ok", swept: true }, { deployment: B.dep, state: "ok", swept: false, reason: "opted-out" }, { deployment: C.dep, state: "ok", swept: true },
  ].sort((x, y) => (x.deployment < y.deployment ? -1 : 1)));
  const rows = Object.fromEntries(answer.rows.map((r) => [r.instance, r]));
  assert.deepEqual(Object.keys(rows).sort(), ["a1", "a4", "a5", "a6", "a7", "c1", "c2"], "stopped, exited and opted-out homes are not listed");
  for (const r of answer.rows) {
    assert.deepEqual(Object.keys(r).slice(0, 4), ["deployment", "instance", "home", "outcome"]);
    if (r.warnings !== undefined) assert.ok(Array.isArray(r.warnings) && r.warnings.length && r.warnings.every((w) => typeof w === "string"), JSON.stringify(r.warnings));
  }
  const outcome = (r) => [r.outcome, r.reason ?? null, r.sessionId ?? null, r.code ?? null];
  assert.deepEqual(outcome(rows.a1), ["resumed", null, ids.a1, null]);
  assert.deepEqual(outcome(rows.a4), ["resumed", null, ids.a4, null]);
  assert.deepEqual(outcome(rows.a5), ["fresh", "resume-unproven", null, null]);
  assert.deepEqual(outcome(rows.a6), ["resumed", null, ids.a6, null]);
  assert.deepEqual(outcome(rows.a7), ["blocked", "resume-confirmation", ids.a7, null]);
  assert.deepEqual(outcome(rows.c1), ["fresh", "no-conversation", null, null]);
  assert.deepEqual(outcome(rows.c2), ["refused", "start-refused", null, "E_LAUNCH_ENV_MISSING"]);
  assert.match(rows.c2.message, /RESUME_TEST_SRC/);

  // What each stand-in received: the selector and the notice; the fresh ones their task prompt.
  const last = (name) => launches(name).at(-1);
  await waitUntil(() => ["a1", "a4", "a5", "a6", "a7", "c1"].every((n) => before(n) === counts[n] + 1), "each started home's stand-in to run once more");
  assert.deepEqual(last("a1").args, ["--resume", ids.a1, "--from-a", "--", RESUME_NOTICE]);
  assert.equal(last("a1").mark, "dep-a", "A's home under A's launch configuration");
  assert.deepEqual(last("a6").args.slice(0, 2), ["--resume", ids.a6]);
  const pi = last("a4").args;
  assert.deepEqual(pi.slice(pi.indexOf("--session"), pi.indexOf("--session") + 3), ["--session", ids.a4, RESUME_NOTICE]);
  assert.ok(!pi.includes("@TASK.md"));
  assert.equal(last("a5").args.at(-1), "Read TASK.md in this directory first: it is your briefing and your task.", "Codex: the fresh start");
  assert.ok(!last("a5").args.includes("resume"));
  assert.deepEqual(last("c1").args, ["--from-c", "--", "@TASK.md"], "C's home under C's launch configuration, fresh (R2)");
  assert.equal(last("c1").mark, "dep-c");
  assert.equal(before("c2"), counts.c2, "a refused start launched nothing");
  assert.equal(before("b1"), counts.b1, "the opted-out deployment's home was not started");
  assert.equal(statusRows(B).b1.sessionEnd, "lost", "and still reads lost");

  // What is persisted stays the ordinary launch: instance.json, the pending receipt and the recipe.
  for (const name of ["a1", "a4"]) {
    const meta = readJson(join(homes[name], "instance.json")), pending = readJson(join(homes[name], ".oats-start-pending.json"));
    for (const [what, command] of [["instance.json", meta.command], ["the pending receipt", pending.command]]) {
      assert.doesNotMatch(command, /--resume|--session|OATS resumed/, `${name}: ${what}`);
      assert.match(command, /@TASK\.md/, `${name}: ${what}`);
    }
    assert.equal(JSON.stringify(meta.launch).includes(ids[name]), false, `${name}: the recipe`);
  }

  // A second sweep: the resumed homes run; nothing is started again; c2's refusal is reported again
  // from this boot's note (on a host that has a boot id).
  const again = ok(cli(A, ["session", "resume", "--json"]), "second sweep");
  const second = Object.fromEntries(again.rows.map((r) => [r.instance, [r.outcome, r.reason ?? null, r.code ?? null]]));
  for (const name of ["a1", "a4", "a5", "a6", "a7", "c1"]) assert.deepEqual(second[name], ["already-running", null, null], name);
  assert.deepEqual(second.c2, bootId() ? ["refused", "refused-this-boot", "E_LAUNCH_ENV_MISSING"] : ["refused", "start-refused", "E_LAUNCH_ENV_MISSING"]);
  assert.equal(before("c2"), counts.c2);
  for (const name of ["a1", "a4", "a5", "a6", "a7", "c1"]) assert.equal(before(name), counts[name] + 1, `${name} was not started again`);

  // A held lock: E_RESUME_BUSY through the standard failure envelope, nothing started.
  const lock = join(oatsHome, "session-resume", "lock");
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, bootId: bootId() }));
  const busy = cli(A, ["session", "resume", "--json"]);
  assert.equal(busy.status, 1, busy.stdout);
  const failure = busy.json();
  assert.deepEqual([failure.schemaVersion, failure.ok, failure.error.code], [1, false, "E_RESUME_BUSY"]);
  assert.equal(typeof failure.error.message, "string");
});

test("a home launched by spawn whose harness exits on its own retires without a recovery copy caused by its exit marker", TMUX, async () => {
  const { A } = deployments;
  // `exit-a`: the stand-in ends at once with status 0, writing nothing in the home. The home then
  // holds the spawn's bytes and what the kernel wrote, the exit marker of spawn's own window included.
  const spawned = cli(A, ["spawn", "dev", "--name", "r1", "--launch-config", "exit-a", "--json"]);
  const home = ok(spawned, "spawn r1").home;
  const startId = readJson(join(home, "instance.json")).startId;
  assert.match(startId ?? "", /^[0-9a-f-]{36}$/, "spawn records its launch's start id");
  await waitUntil(() => readStartExited(home) !== null, "the exit marker of spawn's window");
  assert.deepEqual(readStartExited(home), { startId, status: 0 });
  assert.equal(statusRows(A).r1.sessionEnd, "exited");
  const retired = cli(A, ["retire", "r1", "--json"]);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.equal(existsSync(home), false, "the home is gone");
  const recovery = join(dirname(home), ".oats-retirement", "recovery");
  assert.deepEqual(existsSync(recovery) ? readdirSync(recovery).filter((e) => e.includes("r1-")) : [], [], "no recovery copy");
});
