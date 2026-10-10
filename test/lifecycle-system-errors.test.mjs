// What the lifecycle verbs answer when the SYSTEM fails them (an entry that cannot be read, a claim
// that cannot be written, a home that cannot be written into, a directory that cannot be emptied).
// Before, such an error left the CLI with Node's own code (`EACCES`, `ENOENT`, `ENOTEMPTY`). Now
// every answer carries a kernel code, the system's code is in `error.details.cause`, and a retire's
// error says, in its last sentence and in `error.details.reached`, what the retire had done by then.
//
//   - awebai/oats#892: an entry of the home that the retire cannot read is E_WORK_INSPECTION_FAILED,
//     at the first inspection (nothing touched) and at the one after the retire hooks;
//   - awebai/oats#874 item 3: a claim that cannot be taken (`oats retire`, `oats worktree add|remove`)
//     is E_LIFECYCLE_FAILED, and nothing was done;
//   - awebai/oats#891: a stop whose target fails for a reason of the system's is that target's
//     E_SESSION_STOP_FAILED in the receipt, with what is true of its harness;
//   - awebai/oats#866: a home whose removal fails is E_LIFECYCLE_FAILED, with what is left on disk.
//
// Every case runs the real CLI against a file shape that fails the same way each time: no pause, no
// second process. Each `reached` is compared with what is on disk in the same test.
import test from "node:test";
import assert from "node:assert/strict";
import cp, { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { CLI, v2Deployment } from "./helpers/v2-deployment.mjs";
import { ensureOatsSocketDir, waitUntil } from "./helpers/host-fixture.mjs";
import { retireFailure, stopInstanceSession } from "../lib/core.mjs";
import { oatsError, reportDefect } from "../lib/errors.mjs";

/** A mode no longer keeps root out: the shapes that rest on one are skipped for root. */
const ROOT = process.getuid?.() === 0;
const SKIP_FOR_ROOT = "root reads, writes and empties whatever the mode says: this shape cannot fail";
/** Codes that say nothing happened, or that the caller asked for the wrong thing: never the answer
 *  to a system error (case 6). */
const NOTHING_HAPPENED = ["E_LIFECYCLE_BUSY", "E_PLAN_STALE", "E_INSTANCE_RETIRING", "E_SESSION_UNKNOWN", "E_UNIDENTIFIED_INSTANCE_HOME"];
/** Every error this file was answered, for the last test. */
const answered = [];

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

/** Every entry under `dir`, one row each: its path, its mode, and a file's bytes (as a digest) or a
 *  link's target. An entry its owner may not read is listed with its mode, and neither read nor
 *  entered: that is the shape under test. */
function listing(dir, rel = "") {
  const rows = [];
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const at = join(rel, name), abs = join(dir, at), st = lstatSync(abs);
    const mode = (st.mode & 0o7777).toString(8), readable = (st.mode & 0o400) !== 0;
    if (st.isSymbolicLink()) rows.push(`${at} -> ${readlinkSync(abs)}`);
    else if (st.isDirectory()) { rows.push(`${at}/ ${mode}`); if (readable) rows.push(...listing(dir, at)); }
    else if (st.isFile()) rows.push(`${at} ${mode} ${readable ? sha(readFileSync(abs)) : "(not read)"}`);
    else rows.push(`${at} ${mode} (not a file)`);
  }
  return rows;
}
/** Give every directory under `path` back to its owner, so that the fixture can be removed: the
 *  shapes here are modes, and a retire's recovery copy keeps the modes of what it copies. */
function makeRemovable(path) {
  let st;
  try { st = lstatSync(path); } catch { return; }
  if (!st.isDirectory()) return; // lstat: a link is never followed
  if ((st.mode & 0o700) !== 0o700) chmodSync(path, (st.mode & 0o7777) | 0o700);
  for (const name of readdirSync(path)) makeRemovable(join(path, name));
}

/** A retire hook that appends one line to `<agents root>/retire-hook.log`, outside every home. */
const HOOK_LOGS = `import { appendFileSync } from "node:fs";
import { join } from "node:path";
appendFileSync(join(process.env.OATS_ROOT, "retire-hook.log"), "ran\\n");
`;
const HOOK_DONE = `console.log(JSON.stringify({ meta: { retired: true } }));\n`;
/** The same, which then leaves in the home a file nobody may read. */
const HOOK_LEAVES_UNREADABLE = `${HOOK_LOGS}import { chmodSync, writeFileSync } from "node:fs";
const left = join(process.env.OATS_INSTANCE_HOME, "left-by-the-hook");
writeFileSync(left, "the hook's\\n");
chmodSync(left, 0o000);
${HOOK_DONE}`;

/** A deployment with one instance `name` of the soul `dev`, whose capability has a retire hook.
 *  Modes are given back before the fixture removes its base. */
async function instance(t, name, { work = "directory", hook = HOOK_LOGS + HOOK_DONE } = {}) {
  const fx = v2Deployment({ t,
    souls: { dev: { soul: { work, capabilities: { "test.retire": { from: "here" } } } } },
    capabilities: { "test.retire": { manifest: { hooks: { retire: "hook.mjs" } }, files: { "hook.mjs": hook } } },
  });
  fx.beforeCleanup(() => makeRemovable(fx.base));
  // An in-process spawn finds its harness on this process's PATH: the fixture's inert ones.
  const hostPath = process.env.PATH;
  process.env.PATH = fx.env.PATH;
  let home;
  try { ({ home } = await fx.spawn("dev", { name, work })); } finally { process.env.PATH = hostPath; }
  assert.equal(home, join(fx.root, "dev", "instances", name));
  const instances = dirname(home);
  const retirement = join(instances, ".oats-retirement");
  const recoveryRoot = join(retirement, "recovery");
  return {
    fx, name, home, instances, retirement, recoveryRoot,
    claim: join(retirement, "claims", `${name}.lock`),
    /** How many times the retire hook ran. */
    hookRuns: () => { try { return readFileSync(join(fx.root, "retire-hook.log"), "utf8").split("\n").filter(Boolean).length; } catch (e) { if (e.code === "ENOENT") return 0; throw e; } },
    /** What is in the recovery directory: this retire's copies, and (named `.…`) a copy left half-made. */
    recoveries: () => { try { return readdirSync(recoveryRoot).sort(); } catch (e) { if (e.code === "ENOENT") return []; throw e; } },
    retire: (...flags) => fx.cli(["retire", name, ...flags]),
  };
}

/** The one error of a CLI run that failed with `--json`: exit 1 and exactly one envelope on stdout. */
function refusal(r) {
  assert.equal(r.status, 1, `exit status\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1, `exactly one envelope on stdout: ${r.stdout}`);
  const envelope = JSON.parse(lines[0]);
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.ok, false);
  assert.equal(typeof envelope.error.message, "string");
  answered.push(envelope.error);
  return envelope.error;
}
/** The code of the system's that an answer keeps in `details.cause`: never a kernel code. */
function systemCause(error) {
  const code = error.details?.cause?.code;
  assert.equal(typeof code, "string", `details.cause.code: ${JSON.stringify(error.details)}`);
  assert.doesNotMatch(code, /^E_/, "the cause is the system's code, not a kernel code");
  return code;
}

// ---- 1. an entry the first inspection cannot read (awebai/oats#892) ----

const UNREADABLE = [
  { what: "a file", syscall: "open", make: (path) => { writeFileSync(path, "kept from everyone\n"); chmodSync(path, 0o000); } },
  { what: "a directory", syscall: "scandir", make: (path) => { mkdirSync(path); writeFileSync(join(path, "inside.txt"), "inside\n"); chmodSync(path, 0o000); } },
];
for (const { what, syscall, make } of UNREADABLE) {
  test(`retire of a home holding ${what} nobody may read: E_WORK_INSPECTION_FAILED with the system's ${syscall} error as its cause, and nothing was stopped, run or removed`, async (t) => {
    if (ROOT) { t.skip(SKIP_FOR_ROOT); return; }
    const w = await instance(t, "a1");
    const entry = join(w.home, "unreadable");
    make(entry);
    const before = listing(w.home);

    const error = refusal(w.retire("--json"));
    assert.equal(error.code, "E_WORK_INSPECTION_FAILED");
    assert.ok(error.message.startsWith("could not inspect the home of a1 or its work: "), error.message);
    assert.ok(error.message.includes(entry), `the message names the entry: ${error.message}`);
    assert.ok(error.message.endsWith("Nothing was stopped, run or removed."), error.message);
    assert.deepEqual(error.details.cause, { code: "EACCES", syscall });
    assert.deepEqual(error.details.reached, { phase: "before-effects", sessionStopAttempted: false, hooksStarted: false, home: "kept", recovery: null });

    // What `reached` says, on disk.
    assert.deepEqual(listing(w.home), before, "home: kept, byte for byte");
    assert.equal(w.hookRuns(), 0, "hooksStarted: false, and no retire hook ran");
    assert.deepEqual(w.recoveries(), [], "recovery: null, and neither a copy nor a half-made one is in the recovery directory");

    // Text mode: the same message on stderr, nothing on stdout.
    const text = w.retire();
    assert.equal(text.status, 1, text.stderr + text.stdout);
    assert.equal(text.stdout, "");
    assert.equal(text.stderr.trimEnd(), `oats: ${error.message}`);
    assert.deepEqual(listing(w.home), before, "the home is still as it was");
    assert.equal(w.hookRuns(), 0);
    assert.deepEqual(w.recoveries(), []);
  });
}

// ---- 2. an entry the retire hook made unreadable: the inspection after the hooks meets it ----

test("retire whose hook leaves a file nobody may read: E_WORK_INSPECTION_FAILED after the hooks, the home and the pre-hook recovery kept", async (t) => {
  if (ROOT) { t.skip(SKIP_FOR_ROOT); return; }
  const w = await instance(t, "a2", { hook: HOOK_LEAVES_UNREADABLE });
  // Something to preserve before the hooks: the home changed since its spawn, so the retire copies
  // it to a recovery before it runs any hook.
  mkdirSync(join(w.home, "notes"));
  writeFileSync(join(w.home, "notes", "x.md"), "written after the spawn\n");

  const error = refusal(w.retire("--json"));
  assert.equal(error.code, "E_WORK_INSPECTION_FAILED");
  assert.ok(error.message.startsWith("could not inspect the home of a2 or its work: "), error.message);
  assert.ok(error.message.includes(join(w.home, "left-by-the-hook")), `the message names the entry: ${error.message}`);
  assert.ok(error.message.endsWith("The retire hooks have run; the home, its work and the pre-hook recovery (if any) are kept; this retire stopped no session."), error.message);
  assert.equal(error.details.cause.code, "EACCES");

  // The recovery this retire wrote before its hooks: the one entry of the recovery directory.
  const copies = w.recoveries();
  assert.equal(copies.length, 1, `one recovery, and no half-made one: ${copies.join(", ")}`);
  assert.match(copies[0], /^a2-/);
  const recovery = join(w.recoveryRoot, copies[0]);
  assert.deepEqual(error.details.reached, { phase: "after-hooks", sessionStopAttempted: false, hooksStarted: true, home: "kept", recovery: { path: recovery, phase: "before-hooks" } });

  // What `reached` says, on disk.
  assert.equal(w.hookRuns(), 1, "hooksStarted: true, and the retire hook ran exactly once");
  assert.equal(lstatSync(w.home).isDirectory(), true, "home: kept");
  assert.equal(readFileSync(join(w.home, "notes", "x.md"), "utf8"), "written after the spawn\n", "with what it held");
  assert.equal(lstatSync(join(w.home, "left-by-the-hook")).mode & 0o777, 0, "and what the hook left in it");
  assert.equal(readJson(join(recovery, "recovery.json")).phase, "before-hooks", "the recovery's own manifest says before-hooks");
  assert.equal(readFileSync(join(recovery, "home", "notes", "x.md"), "utf8"), "written after the spawn\n", "and it holds the home as it was before the hooks");
});

// ---- 3. a claim that cannot be taken for a reason of the system's (awebai/oats#874 item 3) ----

const RETIRE_CLAIM_SHAPES = [
  { what: "a regular file is where its claims directory belongs", root: true, make: (claims) => { rmSync(claims, { recursive: true, force: true }); writeFileSync(claims, "not a directory\n"); },
    after: (claims) => assert.equal(readFileSync(claims, "utf8"), "not a directory\n", "the file is as it was") },
  { what: "its claims directory is read-only", root: false, code: "EACCES", make: (claims) => { mkdirSync(claims, { recursive: true }); chmodSync(claims, 0o500); },
    after: (claims) => assert.deepEqual(readdirSync(claims), [], "nothing was left in the claims directory") },
];
for (const { what, root, code, make, after } of RETIRE_CLAIM_SHAPES) {
  test(`retire when ${what}: E_LIFECYCLE_FAILED naming the claim, the system's error as its cause, and nothing was done`, async (t) => {
    if (ROOT && !root) { t.skip(SKIP_FOR_ROOT); return; }
    const w = await instance(t, "a3");
    const claims = dirname(w.claim);
    mkdirSync(w.retirement, { recursive: true });
    make(claims);
    const before = listing(w.home);

    const error = refusal(w.retire("--json"));
    assert.equal(error.code, "E_LIFECYCLE_FAILED");
    assert.match(error.message, new RegExp(`^the claim ${escapeRegExp(w.claim)} could not be taken \\(.*\\); nothing was done$`));
    const cause = systemCause(error);
    if (code) assert.equal(cause, code);
    assert.ok(error.message.includes(cause), `the message carries the system's text: ${error.message}`);
    // The retire of the home never began: there is no `reached` to report.
    assert.equal(Object.hasOwn(error.details, "reached"), false, JSON.stringify(error.details));

    // "nothing was done", on disk.
    assert.deepEqual(listing(w.home), before, "the home is as it was, byte for byte");
    assert.equal(w.hookRuns(), 0, "no retire hook ran");
    assert.deepEqual(w.recoveries(), [], "no recovery was written");
    after(claims);
  });
}

const TREE_CLAIM_SHAPES = [
  { what: "a regular file is where its trees directory belongs", root: true, make: (trees) => { rmSync(trees, { recursive: true, force: true }); writeFileSync(trees, "not a directory\n"); } },
  { what: "its trees directory is read-only", root: false, code: "EACCES", make: (trees) => { mkdirSync(trees, { recursive: true }); chmodSync(trees, 0o500); } },
];
for (const { what, root, code, make } of TREE_CLAIM_SHAPES) {
  test(`worktree add and worktree remove in a home where ${what}: E_LIFECYCLE_FAILED naming the purpose's claim, the system's error as its cause, and nothing was done`, async (t) => {
    if (ROOT && !root) { t.skip(SKIP_FOR_ROOT); return; }
    const w = await instance(t, "a4", { work: "worktree" });
    const trees = join(w.home, ".oats", "trees");
    const claim = join(trees, "p.lock");
    assert.equal(lstatSync(join(w.home, ".oats")).isDirectory(), true, "fixture premise: a spawned home has its .oats directory");
    make(trees);
    const before = listing(w.home);
    const branch = "agents/a4-p";
    const commands = {
      add: ["worktree", "add", "--purpose", "p", "--branch", branch, "--base", "main", "--json"],
      remove: ["worktree", "remove", "--purpose", "p", "--json"],
    };
    for (const [verb, args] of Object.entries(commands)) {
      const error = refusal(w.fx.cli(args, { cwd: w.home, env: { OATS_INSTANCE_HOME: w.home } }));
      assert.equal(error.code, "E_LIFECYCLE_FAILED", `${verb}: ${JSON.stringify(error)}`);
      assert.match(error.message, new RegExp(`^the claim ${escapeRegExp(claim)} could not be taken \\(.*\\); nothing was done$`), verb);
      const cause = systemCause(error);
      if (code) assert.equal(cause, code, verb);
      assert.ok(error.message.includes(cause), `${verb}: the message carries the system's text: ${error.message}`);

      // "nothing was done", on disk.
      assert.deepEqual(listing(w.home), before, `${verb}: the home is as it was, byte for byte`);
      assert.equal(existsSync(join(w.home, ".work-p")), false, `${verb}: no tree was made`);
      assert.throws(() => execFileSync("git", ["-C", w.fx.member, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { env: w.fx.env, stdio: "ignore" }), `${verb}: no branch was made in the clone`);
    }
  });
}

// ---- 4. a stop whose target fails for a reason of the system's (awebai/oats#891) ----

/** Run a stand-in harness for the instance `w` in a window of the fixture's own `oats` tmux server
 *  (its private TMUX_TMPDIR, which its cleanup kills by socket), and record the home as launched
 *  there. → the harness's pid. */
async function launchHarness(w) {
  const { fx, home, name } = w;
  const socket = ensureOatsSocketDir(fx.env.TMUX_TMPDIR);
  const session = "door";
  const tmux = (...args) => execFileSync("tmux", ["-f", "/dev/null", "-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, env: { ...fx.env, SHELL: "/bin/sh" }, stdio: ["ignore", "pipe", "pipe"] }).trim();
  // A stand-in harness that says which process it is, then idles and ends on SIGTERM; and the pane's
  // launcher, which runs it and stays as the pane's shell once it has ended.
  const pidFile = join(fx.base, `harness-${name}.pid`), harness = join(fx.base, `harness-${name}`), launcher = join(fx.base, `launcher-${name}`);
  writeFileSync(harness, `#!/bin/sh\necho $$ > '${pidFile}'\nexec sleep 86400\n`);
  writeFileSync(launcher, `#!/bin/sh\n'${harness}'\nexec /bin/sh\n`);
  for (const script of [harness, launcher]) chmodSync(script, 0o755);
  // The home recorded as launched in that window: in instance.json and in the independent session
  // receipt (the spawn's retirement baseline), which is the stop's authority.
  const endpoint = { session, window: name, socket };
  const metaPath = join(home, "instance.json");
  writeFileSync(metaPath, JSON.stringify({ ...readJson(metaPath), launched: true, tmux: endpoint }, null, 2) + "\n");
  const baselinePath = join(w.retirement, "baselines", `${sha(home)}.json`);
  writeFileSync(baselinePath, JSON.stringify({ ...readJson(baselinePath), runtime: { launched: true, tmux: endpoint } }, null, 2) + "\n");
  let hasSession = true;
  try { tmux("has-session", "-t", `=${session}`); } catch { hasSession = false; }
  if (!hasSession) tmux("new-session", "-d", "-s", session, "-n", "keeper", "-c", fx.base, "sleep 600");
  tmux("new-window", "-d", "-t", `${session}:`, "-n", name, "-c", home, launcher);
  const harnessPid = () => { try { const text = readFileSync(pidFile, "utf8").trim(); return /^\d+$/.test(text) && Number(text) > 1 ? Number(text) : null; } catch { return null; } };
  await waitUntil(() => harnessPid() !== null && alive(harnessPid()), "the stand-in harness to run");
  return harnessPid();
}


test("instance stop --apply in a home that cannot be written: the receipt's target is E_SESSION_STOP_FAILED with the system's text, and says its harness was signalled and has exited", async (t) => {
  if (ROOT) { t.skip(SKIP_FOR_ROOT); return; }
  const w = await instance(t, "a5");
  const { fx, home, name } = w;
  const pid = await launchHarness(w);

  // From here on nothing can be written in the home: the stop signals the harness, sees it gone,
  // and then cannot write its own record (<home>/.oats-stop.json).
  chmodSync(home, 0o555);
  const stop = (...flags) => fx.cli(["instance", "stop", name, ...flags, "--json"]);
  const planned = () => { const r = stop("--plan"); assert.equal(r.status, 0, r.stderr + r.stdout); return r.json().result; };
  // The session's state is part of the plan's revision: plan once the pane reads as a running harness.
  let plan;
  await waitUntil(() => { plan = planned(); const s = plan.targets[0].session; return s.present === true && s.state !== "shell"; }, "the session to read as running");
  assert.deepEqual(plan.targets.map((target) => target.instance), [name]);
  const before = listing(home);

  const r = stop("--apply", "--plan-revision", plan.planRevision, "--idempotency-key", "k1");
  // That part of the contract is unchanged: an applied stop answers its receipt, whatever its targets did.
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1, `exactly one envelope on stdout: ${r.stdout}`);
  const envelope = JSON.parse(lines[0]);
  assert.equal(envelope.ok, true);
  const receipt = envelope.result;
  assert.equal(receipt.ok, false);
  assert.equal(receipt.results.length, 1);
  const [result] = receipt.results;
  assert.deepEqual(Object.keys(result).sort(), ["code", "home", "instance", "message", "ok", "stillRunning"], "no new field in a target's result");
  assert.equal(result.instance, name);
  assert.equal(result.home, home);
  assert.equal(result.ok, false);
  assert.equal(result.code, "E_SESSION_STOP_FAILED", "never the system's code");
  assert.ok(result.message.startsWith(`${name}: `), result.message);
  assert.ok(result.message.includes("EACCES"), `the system's text: ${result.message}`);
  assert.ok(result.message.endsWith("its harness was signalled (SIGTERM) and has exited"), result.message);

  // What the message says, on disk: the harness is gone, and the record the stop could not write is not there.
  assert.equal(alive(pid), false, "the harness the stop signalled has exited");
  assert.deepEqual(listing(home), before, "nothing was written in the home");
  assert.equal(existsSync(join(home, ".oats-stop.json")), false);
  // What the stop's own receipt established: it signalled the harness and saw it gone, so none is
  // still running. `null` is for a stop that has no receipt.
  assert.deepEqual(result.stillRunning, []);
});

test("a stop that finds the harness already idle when it comes to signal it, and then cannot write its record: no signal reached the harness, and the answer says so", async (t) => {
  if (ROOT) { t.skip(SKIP_FOR_ROOT); return; }
  const w = await instance(t, "a7");
  const { fx, home, name } = w;
  // The home recorded as launched in a window of a server that does not exist: what its pane reads as
  // is given below, one answer for each time the stop asks. No process is started and none is signalled.
  const endpoint = { session: "door", window: name, socket: join(fx.base, "no-server.sock") };
  const metaPath = join(home, "instance.json");
  writeFileSync(metaPath, JSON.stringify({ ...readJson(metaPath), launched: true, tmux: endpoint }, null, 2) + "\n");
  const baselinePath = join(w.retirement, "baselines", `${sha(home)}.json`);
  writeFileSync(baselinePath, JSON.stringify({ ...readJson(baselinePath), runtime: { launched: true, tmux: endpoint } }, null, 2) + "\n");
  // The harness exits between the stop's own look at the session and the look of the step that
  // signals: a running command the first time, a dead pane from then on.
  const PANES = ["%1\t0\tsleep\t111\n", "%1\t1\tsleep\t111\n", "%1\t1\tsleep\t111\n"];
  let asked = 0, signals = 0;
  const original = cp.execFileSync;
  cp.execFileSync = function (command, args, ...rest) {
    if (command === "tmux" && Array.isArray(args) && args.includes("list-panes")) {
      assert.ok(asked < PANES.length, "fixture premise: the stop reads the pane three times");
      return PANES[asked++];
    }
    return original.call(this, command, args, ...rest);
  };
  syncBuiltinESMExports();
  chmodSync(home, 0o555); // the stop's record cannot be written
  let thrown;
  try {
    await fx.inEnv(() => {
      try { stopInstanceSession(home, { io: { sleep() {}, kill() { signals++; } } }); } catch (e) { thrown = e; }
    });
  } finally {
    cp.execFileSync = original;
    syncBuiltinESMExports();
    chmodSync(home, 0o755);
  }
  assert.ok(thrown, "the stop failed: its record could not be written");
  assert.equal(asked, PANES.length, "fixture premise: the stop read the pane three times");
  assert.equal(signals, 0, "no signal was sent");
  assert.equal(thrown.code, "E_SESSION_STOP_FAILED");
  assert.deepEqual(thrown.details, { cause: { code: "EACCES", syscall: "open" } });
  assert.ok(thrown.message.startsWith(`${name}: `) && thrown.message.includes("EACCES"), thrown.message);
  assert.ok(thrown.message.endsWith("; no signal reached its harness, which had already exited"), thrown.message);
  assert.doesNotMatch(thrown.message, /was signalled/);
  // The step's own answer goes with the error: it signalled no process and saw none running.
  assert.equal(thrown.receipt.sentAt, null);
  assert.deepEqual(thrown.receipt.requested, []);
  assert.deepEqual(thrown.receipt.stillRunning, []);
});

// An exception without a code (a defect) inside a stop. The stop's error does not travel up to the
// CLI's door: an applied stop, and a retire that stops its recorded children, turn it into a row of
// results. Its stack is printed there, on stderr, and never in the answer.

/** A preload for a CLI child that makes the write of a stop's own record (`<home>/.oats-stop.json`)
 *  throw a TypeError, which has no code: a kernel defect on demand. Every other call is the original.
 *  → the CLI run with it, as fx.cli runs the CLI. */
function cliWithStopDefect(fx, args) {
  const preload = join(fx.base, "stop-record-defect.mjs");
  writeFileSync(preload, `// Written by test/lifecycle-system-errors.test.mjs.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const writeFileSync = fs.writeFileSync;
fs.writeFileSync = function (path, ...rest) {
  if (String(path).includes("/.oats-stop.json")) throw new TypeError("boom from the test preload");
  return writeFileSync.call(this, path, ...rest);
};
syncBuiltinESMExports();
`);
  return spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, CLI, ...args], { cwd: fx.dep, env: fx.env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}
const DEFECT_STACK = /^TypeError: boom from the test preload\n(?: {4}at .+\n)+/m;
/** Nothing of a stack in what the CLI answered on stdout. */
const noStackIn = (stdout) => assert.doesNotMatch(stdout, /\bat .*:\d+:\d+|stop-record-defect|core\.mjs|"stack"/, `the answer carries no stack: ${stdout}`);

test("instance stop --apply whose stop meets an exception without a code: the target is E_SESSION_STOP_FAILED in the receipt, and the exception's stack is on stderr", async (t) => {
  const w = await instance(t, "a8");
  const { fx, home, name } = w;
  const pid = await launchHarness(w);
  const stop = (...flags) => fx.cli(["instance", "stop", name, ...flags, "--json"]);
  let plan;
  await waitUntil(() => { const r = stop("--plan"); assert.equal(r.status, 0, r.stderr + r.stdout); plan = r.json().result; const s = plan.targets[0].session; return s.present === true && s.state !== "shell"; }, "the session to read as running");

  const r = cliWithStopDefect(fx, ["instance", "stop", name, "--apply", "--plan-revision", plan.planRevision, "--idempotency-key", "k1", "--json"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1, `exactly one envelope on stdout: ${r.stdout}`);
  const receipt = JSON.parse(lines[0]).result;
  assert.equal(receipt.ok, false);
  const [result] = receipt.results;
  assert.deepEqual(Object.keys(result).sort(), ["code", "home", "instance", "message", "ok", "stillRunning"], "no new field in a target's result");
  assert.equal(result.code, "E_SESSION_STOP_FAILED");
  assert.equal(result.message, `${name}: boom from the test preload; its harness was signalled (SIGTERM) and has exited`);
  assert.deepEqual(result.stillRunning, []);
  assert.match(r.stderr, DEFECT_STACK, `the stack of the exception is on stderr: ${r.stderr}`);
  noStackIn(r.stdout);
  assert.equal(alive(pid), false, "the harness the stop signalled has exited");
  assert.equal(existsSync(join(home, ".oats-stop.json")), false, "the record the stop could not write is not there");
});

test("retire whose stop of a recorded child meets an exception without a code: E_CHILDREN_RUNNING with that child's E_SESSION_STOP_FAILED, the stack on stderr, and reached says a stop was attempted", async (t) => {
  const w = await instance(t, "a9");
  const { fx, name } = w;
  // A second instance of the same agent, recorded as the first one's child and launched.
  const hostPath = process.env.PATH;
  process.env.PATH = fx.env.PATH;
  let kidHome;
  try { ({ home: kidHome } = await fx.spawn("dev", { name: "a9-kid", work: "directory" })); } finally { process.env.PATH = hostPath; }
  const kid = { fx, name: "a9-kid", home: kidHome, retirement: w.retirement };
  const kidMeta = join(kid.home, "instance.json");
  writeFileSync(kidMeta, JSON.stringify({ ...readJson(kidMeta), parentInstance: name }, null, 2) + "\n");
  const pid = await launchHarness(kid);
  await waitUntil(() => { const r = fx.cli(["instance", "stop", kid.name, "--plan", "--json"]); assert.equal(r.status, 0, r.stderr + r.stdout); const s = r.json().result.targets[0].session; return s.present === true && s.state !== "shell"; }, "the child's session to read as running");
  const before = listing(w.home);

  const r = cliWithStopDefect(fx, ["retire", name, "--json"]);
  const error = refusal(r);
  assert.equal(error.code, "E_CHILDREN_RUNNING");
  assert.deepEqual(error.details.childrenStopped, [{ instance: kid.name, home: kid.home, ok: false, code: "E_SESSION_STOP_FAILED",
    message: `${kid.name}: boom from the test preload; its harness was signalled (SIGTERM) and has exited`, stillRunning: [] }]);
  // The child's harness was signalled: the untouched value is no longer true, and nothing else was reached.
  assert.deepEqual(error.details.reached, { phase: "before-hooks", sessionStopAttempted: true, hooksStarted: false, home: "kept", recovery: null });
  assert.match(r.stderr, DEFECT_STACK, `the stack of the exception is on stderr: ${r.stderr}`);
  noStackIn(r.stdout);

  // What `reached` says, on disk.
  assert.equal(alive(pid), false, "sessionStopAttempted: true, and the child's harness has exited");
  assert.deepEqual(listing(w.home), before, "home: kept, byte for byte");
  assert.equal(w.hookRuns(), 0, "hooksStarted: false, and no retire hook ran");
  assert.deepEqual(w.recoveries(), [], "recovery: null, and none was written");
  assert.equal(existsSync(kid.home), true, "the child is kept");
});

// A kernel that lists feature `lifecycle-kernel-codes` promises kernel codes in every answer of these
// commands, and a replay is one: of a receipt that an older kernel may have stored with the system's
// own code in a failed target's row.
test("instance stop --apply replaying a receipt an older kernel stored with a system code: the probe lists lifecycle-kernel-codes, the replay answers E_SESSION_STOP_FAILED, and the stored receipt is not rewritten", async (t) => {
  const w = await instance(t, "a10");
  const { fx, home, name } = w;
  const probe = fx.cli(["version", "--json"]);
  assert.equal(probe.status, 0, probe.stderr);
  assert.ok(probe.json().features.includes("lifecycle-kernel-codes"), "the kernel announces the rule");
  const plan = fx.cli(["instance", "stop", name, "--plan", "--json"]).json().result;
  // The receipt as the kernel before this feature stored it: the thrown error's own code in the row.
  const row = { instance: name, home, ok: false, code: "ENOENT", message: `ENOENT: no such file or directory, open '${join(home, ".oats-stop.json")}'`, stillRunning: null };
  const stored = { lifecycleApi: plan.lifecycleApi, action: "stop", instance: name, home, idempotencyKey: "old-key", planRevision: plan.planRevision, at: "2026-10-01T00:00:00.000Z",
    ok: false, results: [row], retained: ["home", "work", "transcript", "launch"], replayed: false };
  const receiptPath = join(home, ".oats-stop-receipt.old-key.json");
  const bytes = JSON.stringify(stored, null, 2) + "\n";
  writeFileSync(receiptPath, bytes);
  const before = listing(home);

  const r = fx.cli(["instance", "stop", name, "--apply", "--plan-revision", plan.planRevision, "--idempotency-key", "old-key", "--json"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1, `exactly one envelope on stdout: ${r.stdout}`);
  const receipt = JSON.parse(lines[0]).result;
  // The stored receipt, field for field, but for the two things a replay changes.
  assert.deepEqual(receipt, { ...stored, replayed: true, results: [{ ...row, code: "E_SESSION_STOP_FAILED" }] });
  assert.ok(receipt.results[0].message.includes("ENOENT"), "the system's text stays in the message");
  assert.equal(readFileSync(receiptPath, "utf8"), bytes, "the stored receipt is evidence: not rewritten");
  assert.deepEqual(listing(home), before, "a replay acts on nothing");
});

// ---- 5. the removal of the home fails (the code path of the ENOTEMPTY of awebai/oats#866) ----

// This shape, a read-only directory that still holds a file, is awebai/oats#894 item 3, which a later
// PR (PR 6) makes succeed: this test will then need another way to fail the removal.
test("retire of a home whose removal the system refuses: E_LIFECYCLE_FAILED at the removal, naming the complete recovery and what is left at the home", async (t) => {
  if (ROOT) { t.skip(SKIP_FOR_ROOT); return; }
  const w = await instance(t, "a6");
  // The inspections and the recovery copy read it; the removal cannot empty it.
  mkdirSync(join(w.home, "notes", "ro"), { recursive: true });
  writeFileSync(join(w.home, "notes", "ro", "f"), "in a read-only directory\n");
  chmodSync(join(w.home, "notes", "ro"), 0o555);

  const error = refusal(w.retire("--json"));
  assert.equal(error.code, "E_LIFECYCLE_FAILED");
  systemCause(error); // which errno is the system's business
  const copies = w.recoveries();
  assert.equal(copies.length, 1, `one recovery, and no half-made one: ${copies.join(", ")}`);
  assert.match(copies[0], /^a6-/);
  const recovery = join(w.recoveryRoot, copies[0]);
  assert.ok(error.message.startsWith(`a6: the directory at ${w.home} could not be removed: `), error.message);
  assert.ok(error.message.endsWith(`The retire hooks have run; its recovery (complete) is at ${recovery}; its retired event is recorded; what is left at ${w.home} may not be a whole instance home; this retire stopped no session.`), error.message);
  // hooksStarted is true because the retire hook runner was called, which it is for a home that
  // records the repository it was spawned for (instance.json `repo`), as every spawned home does.
  assert.equal(typeof readJson(join(recovery, "home", "instance.json")).repo, "string", "fixture premise: the home recorded its repository");
  assert.deepEqual(error.details.reached, { phase: "removal", sessionStopAttempted: false, hooksStarted: true, home: "partial", recovery: { path: recovery, phase: "complete" } });

  // What `reached` and the message say, on disk.
  assert.equal(w.hookRuns(), 1, "hooksStarted: true, and the retire hook ran exactly once");
  assert.equal(lstatSync(w.home).isDirectory(), true, "home: partial, the directory is still there");
  assert.equal(readJson(join(recovery, "recovery.json")).phase, "complete", "the recovery's own manifest says complete");
  assert.equal(readFileSync(join(recovery, "home", "notes", "ro", "f"), "utf8"), "in a read-only directory\n", "and it holds what the home held");
  const events = readFileSync(join(w.fx.dep, ".agents", "events", "dev--a6.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.kind === "retired").length, 1, "its retired event is recorded in the workspace log");
});

// ---- 6. no answer of a retire without `reached` once the retire of the home has begun ----

// An answer of a retire without `reached` says that the retire of the home had not begun and that
// nothing was done. So the function that makes a retire's error (lib/core.mjs retireFailure, the
// whole handler of retireClaimed) must give one WITH `reached` whatever goes wrong while it makes
// it: a sentence that throws, an error that cannot carry details, a read from disk that cannot be
// made. Nothing in the kernel throws there today; the test forces each, with a tracker of its own.
test("retireFailure never answers without reached: when the sentence throws, when the error cannot carry details, and when the disk cannot be read, the answer is the error's own message with reached", () => {
  const tracker = (more = {}) => ({ phase: "after-hooks", sessionTouched: true, hooksStarted: true, removing: false, recoveryPath: null, said: () => "The retire hooks have run", lead: null, ...more });
  const REACHED = { phase: "after-hooks", sessionStopAttempted: true, hooksStarted: true, home: "kept", recovery: null };
  const systemError = () => Object.assign(new Error("EACCES: permission denied, open '/x'"), { code: "EACCES", syscall: "open" });
  const gone = join(tmpdir(), `oats-door-no-such-home-${process.pid}`);
  /** What `fn` returns, and what it wrote on stderr. */
  const withStderr = (fn) => {
    const write = process.stderr.write;
    let written = "";
    process.stderr.write = (chunk) => { written += String(chunk); return true; };
    try { return [fn(), written]; } finally { process.stderr.write = write; }
  };

  // The ordinary case, for contrast: the sentence of the point, the cause, reached.
  const [ordinary, quiet] = withStderr(() => retireFailure(systemError(), tracker(), gone));
  assert.equal(ordinary.code, "E_LIFECYCLE_FAILED");
  assert.equal(ordinary.message, "EACCES: permission denied, open '/x'. The retire hooks have run.");
  assert.deepEqual(ordinary.details, { cause: { code: "EACCES", syscall: "open" }, reached: REACHED });
  assert.equal(quiet, "");

  // The sentence throws: the error's own message, with its cause and reached; the sentence's own
  // failure is a defect, and its stack is printed.
  for (const broken of [{ said: () => { throw new TypeError("the sentence broke"); } }, { lead: () => { throw new TypeError("the sentence broke"); } }, { said: undefined }]) {
    const [failure, stderr] = withStderr(() => retireFailure(systemError(), tracker(broken), gone));
    assert.equal(failure.code, "E_LIFECYCLE_FAILED");
    assert.equal(failure.message, "EACCES: permission denied, open '/x'");
    assert.deepEqual(failure.details, { cause: { code: "EACCES", syscall: "open" }, reached: REACHED });
    assert.match(stderr, /^TypeError: /, "what broke the sentence is reported");
  }

  // A kernel error that cannot carry details (frozen): its code, its message, its details, and reached.
  const frozen = Object.freeze(Object.assign(oatsError("E_PLAN_STALE", "the plan changed"), { details: { plan: { planRevision: "abc" } } }));
  const [stale] = withStderr(() => retireFailure(frozen, tracker(), gone));
  assert.notEqual(stale, frozen);
  assert.equal(stale.code, "E_PLAN_STALE");
  assert.equal(stale.message, "the plan changed");
  assert.deepEqual(stale.details, { plan: { planRevision: "abc" }, reached: REACHED });

  // The disk cannot be read: the conservative value. No recovery is named; a home whose removal
  // began and that cannot be looked at is "partial", never "kept" and never "removed".
  const [unread] = withStderr(() => retireFailure(systemError(), tracker({ phase: "removal", removing: true, recoveryPath: { not: "a path" } }), { not: "a path" }));
  assert.deepEqual(unread.details.reached, { phase: "removal", sessionStopAttempted: true, hooksStarted: true, home: "partial", recovery: null });
  // And what the disk says when it can be read: nothing there is "removed", something there is "partial".
  const [removed] = withStderr(() => retireFailure(systemError(), tracker({ phase: "removal", removing: true }), gone));
  assert.equal(removed.details.reached.home, "removed");
  const [partial] = withStderr(() => retireFailure(systemError(), tracker({ phase: "removal", removing: true }), tmpdir()));
  assert.equal(partial.details.reached.home, "partial");

  // Whatever was thrown: a refusal without a code has no cause; a thrown undefined is a defect.
  const [plain] = withStderr(() => retireFailure(new Error("session no longer exists"), tracker(), gone));
  assert.equal(plain.code, "E_LIFECYCLE_FAILED");
  assert.equal(plain.message, "session no longer exists. The retire hooks have run.");
  assert.deepEqual(plain.details, { reached: REACHED });
  const [nothing] = withStderr(() => retireFailure(undefined, tracker(), gone));
  assert.equal(nothing.code, "E_LIFECYCLE_FAILED");
  assert.deepEqual(nothing.details, { cause: { name: "Error" }, reached: REACHED });
  // The answer still holds what was thrown, so that the door prints the defect: a value that is not truthy too.
  assert.equal(Object.hasOwn(nothing, "cause"), true);
  const [, reported] = withStderr(() => reportDefect(nothing));
  assert.equal(reported, "A value that is no Error was thrown: undefined\n");
});

// ---- 7. the wrapping never answers a code that says nothing happened ----

test("no answer to a system error carries a code that says nothing happened, and every code is a kernel code", async (t) => {
  // Two of the shapes above again, so that this holds when the test runs alone; then every error
  // this file was answered.
  const claimed = await instance(t, "a7");
  mkdirSync(claimed.retirement, { recursive: true });
  writeFileSync(dirname(claimed.claim), "not a directory\n");
  assert.equal(refusal(claimed.retire("--json")).code, "E_LIFECYCLE_FAILED");
  if (!ROOT) {
    const unread = await instance(t, "a8");
    writeFileSync(join(unread.home, "unreadable"), "kept from everyone\n");
    chmodSync(join(unread.home, "unreadable"), 0o000);
    assert.equal(refusal(unread.retire("--json")).code, "E_WORK_INSPECTION_FAILED");
  }
  assert.ok(answered.length >= 1);
  for (const error of answered) {
    assert.match(error.code, /^E_[A-Z0-9_]+$/, JSON.stringify(error));
    assert.equal(NOTHING_HAPPENED.includes(error.code), false, JSON.stringify(error));
  }
});
