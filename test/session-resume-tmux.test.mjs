// Session resume (#1559) on real tmux: the fixture's own `oats` server in a private TMUX_TMPDIR,
// stand-in harnesses (one node script, named by absolute path in each deployment's launch
// configurations) that record the argv and environment they were started with, write a transcript
// where their harness would (Claude's projects, pi's sessions), and idle. Two deployments in one
// machine registry, A and C, differ in their launch configurations.
//
// The homes are started, one is stopped with OATS, one ends on its own (`exit 0`), and the tmux
// server is killed. `oats session resume --json` then brings back the lost ones in their own
// conversations (asserted on the argv the stand-ins received), under their own deployment's launch
// configuration; the stopped and the exited ones are not listed; a second sweep reports `already-running` and starts nothing; a refusal is reported again in the same boot
// (`refused-this-boot`) without a second start; a held lock answers E_RESUME_BUSY.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { RESUME_NOTICE, stopInstanceSession } from "../lib/core.mjs";
import { readStartExited } from "../lib/session-end.mjs";
import { bootId, readBootNote, resumeSessions } from "../lib/session-resume.mjs";
import { FRESH_REASON, OUTCOME, ROW_REASON, SESSION_END } from "../lib/session-resume-contract.mjs";
import { fixtureBase, isolateSessionEnvironment, oatsSocket, waitUntil } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const hasTmux = !spawnSync("tmux", ["-V"], { stdio: "ignore" }).error;
const TMUX = { skip: !hasTmux && "tmux is not installed" };
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// The fixture, made in test.before and removed in test.after (docs/implementation.md, "Tests and
// gates"): the directory, the isolated environment with its private tmux server, the stand-in, the
// deployments and the machine's registry.
let base, socket, oatsHome, records, standIn, machine;
let restoreEnvironment = () => {};
const deployments = {};
/** Deployments a test makes for itself: their homes run on the one server, so they are removed with
 *  the others, once it is gone. */
const later = [];
const config = (harness, mark, extra = {}) => ({ harness, executable: standIn, env: { RESUME_MARK: mark, STANDIN_HARNESS: harness,
  ...(harness === "claude" ? { CLAUDE_CONFIG_DIR: join(base, `claude-${mark}`) } : harness === "pi" ? { PI_CODING_AGENT_DIR: join(base, `pi-${mark}`) } : { CODEX_HOME: join(base, `codex-${mark}`) }), ...(extra.env ?? {}) }, args: extra.args ?? [] });

test.before(() => {
  if (!hasTmux) return;
  base = fixtureBase("oats-resume-");
  restoreEnvironment = isolateSessionEnvironment(base);
  socket = oatsSocket();
  oatsHome = join(base, "oats-home");
  records = join(base, "argv");
  mkdirSync(records, { recursive: true });

  // The stand-in harness. Its argv, RESUME_MARK and RESUME_SECRET go to <records>/<instance>.<n>.json.
  // A fresh launch (no --resume / --session) writes a transcript whose cwd is the home, unless
  // NO_TRANSCRIPT is set. `exit-now` in the home: it ends at once with status 0. `show-dialog` in the
  // home: a resumed launch paints Claude's resume-cost dialog; otherwise it paints Claude's banner.
  standIn = join(base, "stand-in");
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

  deployments.A = v2Deployment({ name: "a", local: { "launch-configs": { "claude-a": config("claude", "dep-a", { args: ["--from-a"] }), "pi-a": config("pi", "dep-a"), "codex-a": config("codex", "dep-a"), "exit-a": config("claude", "dep-a", { env: { EXIT_NOW: "1", NO_TRANSCRIPT: "1" } }) } } });
  deployments.C = v2Deployment({ name: "c", local: { "launch-configs": {
    "claude-c": config("claude", "dep-c", { args: ["--from-c"], env: { NO_TRANSCRIPT: "1" } }),
    "needs-src": config("claude", "dep-c", { env: { RESUME_SECRET: { fromEnv: "RESUME_TEST_SRC" } } }) } } });
  // One machine: one OATS_HOME_DIR, whose registry lists the two deployments.
  machine = { OATS_HOME_DIR: oatsHome };
  mkdirSync(join(oatsHome, "config"), { recursive: true });
  writeFileSync(join(oatsHome, "config", "deployments.json"), JSON.stringify({ schemaVersion: 1, imports: {},
    deployments: Object.values(deployments).map((fx) => ({ path: fx.dep, addedAt: "2026-10-27T00:00:00.000Z", via: "cli" })) }, null, 2) + "\n");
});

// The private server is killed first, so each fixture's check that nothing still works in it holds;
// the directory is removed whatever failed before.
test.after(() => {
  if (!base) return;
  try { execFileSync("tmux", ["-u", "-S", socket, "kill-server"], { stdio: "ignore" }); } catch { /* gone */ }
  let failed;
  for (const fx of [...Object.values(deployments), ...later]) { try { fx.cleanup(); } catch (e) { failed ??= e; } }
  try { restoreEnvironment(); } finally { rmSync(base, { recursive: true, force: true }); }
  if (failed) throw failed;
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
/** Kill the window of `home`'s session by hand: no marker, no stop; the home reads lost. */
function killWindow(home) {
  const { tmux } = readJson(join(home, "instance.json"));
  execFileSync("tmux", ["-u", tmux.socket.includes("/") ? "-S" : "-L", tmux.socket, "kill-window", "-t", `${tmux.session}:${tmux.window}`], { stdio: "ignore" });
}
async function startHome(fx, home, name, extra = {}) {
  ok(cli(fx, ["session", "start", "--home", home, "--json"], extra), `start ${name}`);
  await waitUntil(() => launches(name).length > 0, `${name}'s stand-in to run`);
}

test("after the tmux server dies, the sweep resumes the lost homes in their own conversations, under their own deployment's launch configuration; stopped and exited homes stay as they are", TMUX, async () => {
  const { A, C } = deployments;
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
  // C: its own launch configurations.
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
    { a1: [false, SESSION_END.LOST], a2: [false, SESSION_END.STOPPED], a3: [false, SESSION_END.EXITED], a4: [false, SESSION_END.LOST], a5: [false, SESSION_END.LOST], a6: [false, SESSION_END.LOST], a7: [false, SESSION_END.LOST] });

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
  assert.deepEqual(planned, { a1: [OUTCOME.RESUMED, ids.a1], a4: [OUTCOME.RESUMED, ids.a4], a5: [OUTCOME.FRESH, FRESH_REASON.RESUME_UNPROVEN], a6: [OUTCOME.RESUMED, ids.a6], a7: [OUTCOME.RESUMED, ids.a7], c1: [OUTCOME.FRESH, FRESH_REASON.NO_CONVERSATION], c2: [OUTCOME.RESUMED, planned.c2?.[1]] });
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
    { deployment: A.dep, state: "ok", swept: true }, { deployment: C.dep, state: "ok", swept: true },
  ].sort((x, y) => (x.deployment < y.deployment ? -1 : 1)));
  const rows = Object.fromEntries(answer.rows.map((r) => [r.instance, r]));
  assert.deepEqual(Object.keys(rows).sort(), ["a1", "a4", "a5", "a6", "a7", "c1", "c2"], "stopped and exited homes are not listed");
  for (const r of answer.rows) {
    assert.deepEqual(Object.keys(r).slice(0, 4), ["deployment", "instance", "home", "outcome"]);
    if (r.warnings !== undefined) assert.ok(Array.isArray(r.warnings) && r.warnings.length && r.warnings.every((w) => typeof w === "string"), JSON.stringify(r.warnings));
  }
  const outcome = (r) => [r.outcome, r.reason ?? null, r.sessionId ?? null, r.code ?? null];
  assert.deepEqual(outcome(rows.a1), [OUTCOME.RESUMED, null, ids.a1, null]);
  assert.deepEqual(outcome(rows.a4), [OUTCOME.RESUMED, null, ids.a4, null]);
  assert.deepEqual(outcome(rows.a5), [OUTCOME.FRESH, FRESH_REASON.RESUME_UNPROVEN, null, null]);
  assert.deepEqual(outcome(rows.a6), [OUTCOME.RESUMED, null, ids.a6, null]);
  assert.deepEqual(outcome(rows.a7), [OUTCOME.BLOCKED, ROW_REASON.RESUME_CONFIRMATION, ids.a7, null]);
  assert.deepEqual(outcome(rows.c1), [OUTCOME.FRESH, FRESH_REASON.NO_CONVERSATION, null, null]);
  assert.deepEqual(outcome(rows.c2), [OUTCOME.REFUSED, ROW_REASON.START_REFUSED, null, "E_LAUNCH_ENV_MISSING"]);
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
  for (const name of ["a1", "a4", "a5", "a6", "a7", "c1"]) assert.deepEqual(second[name], [OUTCOME.ALREADY_RUNNING, null, null], name);
  assert.deepEqual(second.c2, bootId() ? [OUTCOME.REFUSED, ROW_REASON.REFUSED_THIS_BOOT, "E_LAUNCH_ENV_MISSING"] : [OUTCOME.REFUSED, ROW_REASON.START_REFUSED, "E_LAUNCH_ENV_MISSING"]);
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
  rmSync(lock, { recursive: true });
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
  assert.equal(statusRows(A).r1.sessionEnd, SESSION_END.EXITED);
  const retired = cli(A, ["retire", "r1", "--json"]);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.equal(existsSync(home), false, "the home is gone");
  const recovery = join(dirname(home), ".oats-retirement", "recovery");
  assert.deepEqual(existsSync(recovery) ? readdirSync(recovery).filter((e) => e.includes("r1-")) : [], [], "no recovery copy");
});

test("`session resume --deployment <dir>` sweeps that deployment alone, registered or not; a deployment removed from the registry is not swept; a stop of a lost home, and of an exited home from before 0.69, records the stop and keeps it stopped", TMUX, async () => {
  const D = v2Deployment({ name: "d", local: { "launch-configs": { "claude-d": config("claude", "dep-d"), "exit-d": config("claude", "dep-d", { env: { EXIT_NOW: "1", NO_TRANSCRIPT: "1" } }) } } });
  later.push(D);
  const homes = {};
  for (const name of ["d1", "d2"]) { homes[name] = await spawnHome(D, name, "claude-d"); await startHome(D, homes[name], name); }
  // d1 and d2 lose their windows (killed by hand: no marker, no stop).
  for (const name of ["d1", "d2"]) killWindow(homes[name]);
  // d3: launched by spawn, its harness ended by itself; then made a home from before 0.69, which
  // records no start id and whose window wrote no marker.
  homes.d3 = ok(cli(D, ["spawn", "dev", "--name", "d3", "--launch-config", "exit-d", "--json"]), "spawn d3").home;
  await waitUntil(() => readStartExited(homes.d3) !== null, "d3's exit marker");
  rmSync(join(homes.d3, ".oats-start-exited"));
  const legacy = readJson(join(homes.d3, "instance.json"));
  delete legacy.startId;
  writeFileSync(join(homes.d3, "instance.json"), JSON.stringify(legacy, null, 2) + "\n");
  await waitUntil(() => { const r = statusRows(D); return ["d1", "d2", "d3"].every((n) => r[n].sessionEnd === SESSION_END.LOST); }, "d1, d2 and d3 to read lost");

  // The explicit form, on a deployment the registry does not list; its refusals.
  const plan = ok(cli(D, ["session", "resume", "--deployment", D.dep, "--plan", "--json"]), "plan --deployment");
  assert.deepEqual(plan.deployments, [{ deployment: D.dep, state: "ok", swept: true }]);
  assert.deepEqual(plan.rows.map((r) => r.instance), ["d1", "d2", "d3"]);
  for (const [args, code] of [[["--deployment"], "E_BAD_ARGS"], [["--deployment", join(D.base, "nowhere")], "E_BAD_ARGS"]]) {
    const r = cli(D, ["session", "resume", ...args, "--plan", "--json"]);
    assert.equal(r.status, 1, r.stdout);
    assert.equal(r.json().error.code, code, `${args.join(" ")}: ${r.stdout}`);
  }
  const captured = cli(D, ["status", "--deployment", D.dep, "--json"]);
  assert.equal(captured.json().error.code, "E_UNSUPPORTED_MODE", "--deployment stays a refused captured selector for other commands");

  // Registered, then removed: its tombstone is not swept, and nothing of it starts.
  ok(cli(D, ["deployments", "add", D.dep, "--json"]), "deployments add");
  assert.ok(ok(cli(D, ["session", "resume", "--plan", "--json"]), "registered plan").deployments.some((d) => d.deployment === D.dep), "fixture premise: a registered deployment is swept");
  ok(cli(D, ["deployments", "remove", D.dep, "--json"]), "deployments remove");
  const counts = Object.fromEntries(["d1", "d2", "d3"].map((n) => [n, launches(n).length]));
  const sweep = ok(cli(D, ["session", "resume", "--json"]), "registry sweep");
  assert.equal(sweep.deployments.some((d) => d.deployment === D.dep), false, "the removed deployment is not listed");
  assert.equal(sweep.rows.some((r) => r.deployment === D.dep), false, "nor are its homes");
  assert.deepEqual(Object.fromEntries(["d1", "d2", "d3"].map((n) => [n, launches(n).length])), counts, "nothing of it was started");

  // Stopped with OATS while lost: nothing to signal, the stop recorded; both stay stopped.
  for (const name of ["d1", "d3"]) {
    const s = await D.inEnv(() => stopInstanceSession(homes[name], { graceMs: 5000 }));
    assert.deepEqual([s.stopped, s.alreadyIdle], [false, true], name);
    const receipt = readJson(join(homes[name], ".oats-stop.json"));
    assert.deepEqual([receipt.stop, receipt.startId], [null, readJson(join(homes[name], "instance.json")).startId ?? null], name);
  }
  const rows = statusRows(D);
  assert.deepEqual(["d1", "d2", "d3"].map((n) => rows[n].sessionEnd), [SESSION_END.STOPPED, SESSION_END.LOST, SESSION_END.STOPPED]);
  const swept = ok(cli(D, ["session", "resume", "--deployment", D.dep, "--json"]), "sweep --deployment");
  assert.deepEqual(swept.rows.map((r) => [r.instance, r.outcome]), [["d2", OUTCOME.RESUMED]]);
  await waitUntil(() => launches("d2").length === counts.d2 + 1, "d2's stand-in to run again");
  assert.deepEqual([launches("d1").length, launches("d3").length], [counts.d1, counts.d3], "the stopped homes were not started");
});

test("a home lost again after each resume is started by sweeps at most 3 times in a boot, then answered keeps-getting-lost, predicted by --plan; a start by hand is not counted; another boot starts it again", { skip: TMUX.skip || (!bootId() && "this host has no boot id: nothing is counted") }, async () => {
  const E = v2Deployment({ name: "e", local: { "launch-configs": { "claude-e": config("claude", "dep-e") } } });
  later.push(E);
  const home = await spawnHome(E, "e1", "claude-e");
  await startHome(E, home, "e1");
  const notePath = join(oatsHome, "session-resume", "note.json");
  const count = () => (existsSync(notePath) ? readJson(notePath).resumes?.[home] : undefined);
  const lose = async () => {
    killWindow(home);
    await waitUntil(() => statusRows(E).e1.sessionEnd === SESSION_END.LOST, "e1 to read lost");
  };
  const sweep = (...flags) => ok(cli(E, ["session", "resume", "--deployment", E.dep, ...flags, "--json"]), `sweep ${flags.join(" ")}`).rows;
  assert.equal(count(), undefined, "a start by hand is not counted");

  for (let n = 1; n <= 3; n++) {
    await lose();
    const runs = launches("e1").length;
    assert.deepEqual(sweep().map((r) => [r.instance, r.outcome]), [["e1", OUTCOME.RESUMED]], `sweep ${n}`);
    await waitUntil(() => launches("e1").length === runs + 1, `e1's stand-in to run after sweep ${n}`);
    assert.equal(count(), n, `sweep ${n} is counted`);
  }

  // A resume by hand is neither bounded nor counted.
  await lose();
  let runs = launches("e1").length;
  assert.equal(ok(cli(E, ["session", "start", "--resume", "--home", home, "--json"]), "start --resume by hand").resume.resumed, true);
  await waitUntil(() => launches("e1").length === runs + 1, "e1's stand-in to run after the start by hand");
  assert.equal(count(), 3);

  // The fourth sweep: predicted, then answered, and nothing started.
  await lose();
  runs = launches("e1").length;
  const keeps = (r) => { assert.deepEqual([r.instance, r.outcome, r.reason, r.code], ["e1", OUTCOME.REFUSED, ROW_REASON.KEEPS_GETTING_LOST, undefined]); assert.match(r.message, /resumed 3 times in this boot/); };
  const [predicted] = sweep("--plan");
  keeps(predicted);
  const [answered] = sweep();
  keeps(answered);
  assert.equal(launches("e1").length, runs, "nothing was started");
  assert.equal(count(), 3);
  assert.equal(statusRows(E).e1.sessionEnd, SESSION_END.LOST);

  // Another boot's count is no count.
  writeFileSync(notePath, JSON.stringify({ ...readJson(notePath), bootId: "another-boot" }));
  assert.deepEqual(sweep().map((r) => [r.instance, r.outcome]), [["e1", OUTCOME.RESUMED]]);
  await waitUntil(() => launches("e1").length === runs + 1, "e1's stand-in to run in the new boot");
  assert.deepEqual(readJson(notePath).resumes, { [home]: 1 }, "the note of this boot, the count started again");
});

test("the sweep notes each start's count as soon as that start has answered: a home whose start answered is counted while another start of the sweep still runs (a sweep killed then has counted it), once each, and its 4th sweep is keeps-getting-lost", TMUX, async () => {
  const F = v2Deployment({ name: "f", local: { "launch-configs": { "claude-f": config("claude", "dep-f") } } });
  later.push(F);
  const homes = {};
  for (const name of ["f1", "f2"]) { homes[name] = await spawnHome(F, name, "claude-f"); await startHome(F, homes[name], name); killWindow(homes[name]); }
  await waitUntil(() => { const r = statusRows(F); return r.f1.sessionEnd === SESSION_END.LOST && r.f2.sessionEnd === SESSION_END.LOST; }, "f1 and f2 to read lost");
  // The starts are the test's (resumeSessions' `start`): f1's answers at once, f2's when the test
  // releases it. Nothing is launched, so both homes stay lost from one sweep to the next. The sweep
  // runs in this file's machine environment (OATS_HOME_DIR is oatsHome), where the note is read.
  const boot = "interrupted-sweep-boot";
  const counted = (name) => readBootNote(boot).resumes[homes[name]] ?? 0;
  const answer = { ok: true, result: { warnings: [], resume: { resumed: true, harness: "claude", sessionId: "seam" } } };
  for (let n = 1; n <= 3; n++) {
    let release;
    const f2Answer = new Promise((r) => { release = r; });
    const sweep = resumeSessions({ deployment: F.dep, boot, start: (row) => (row.instance === "f1" ? Promise.resolve(answer) : f2Answer) });
    await waitUntil(() => counted("f1") === n, `f1's answer in sweep ${n} to be noted while f2's start runs`);
    assert.equal(counted("f2"), n - 1, `sweep ${n}: f2's start has not answered`);
    release(answer);
    assert.deepEqual((await sweep).rows.map((r) => [r.instance, r.outcome]), [["f1", OUTCOME.RESUMED], ["f2", OUTCOME.RESUMED]]);
    assert.deepEqual([counted("f1"), counted("f2")], [n, n], `sweep ${n}: each answer counted once`);
  }
  const fourth = await resumeSessions({ deployment: F.dep, boot, start: () => assert.fail("a 4th sweep starts nothing") });
  assert.deepEqual(fourth.rows.map((r) => [r.instance, r.outcome, r.reason]), [["f1", OUTCOME.REFUSED, ROW_REASON.KEEPS_GETTING_LOST], ["f2", OUTCOME.REFUSED, ROW_REASON.KEEPS_GETTING_LOST]]);
});
