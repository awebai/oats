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
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { ensureOatsSocketDir, waitUntil } from "./helpers/host-fixture.mjs";

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

test("instance stop --apply in a home that cannot be written: the receipt's target is E_SESSION_STOP_FAILED with the system's text, and says its harness was signalled and has exited", async (t) => {
  if (ROOT) { t.skip(SKIP_FOR_ROOT); return; }
  const w = await instance(t, "a5");
  const { fx, home, name } = w;
  // The fixture's own `oats` tmux server (its private TMUX_TMPDIR), which its cleanup kills by socket.
  const socket = ensureOatsSocketDir(fx.env.TMUX_TMPDIR);
  const session = "door";
  const tmux = (...args) => execFileSync("tmux", ["-f", "/dev/null", "-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, env: { ...fx.env, SHELL: "/bin/sh" }, stdio: ["ignore", "pipe", "pipe"] }).trim();
  // A stand-in harness that says which process it is, then idles and ends on SIGTERM; and the pane's
  // launcher, which runs it and stays as the pane's shell once it has ended.
  const pidFile = join(fx.base, "harness.pid"), harness = join(fx.base, "harness"), launcher = join(fx.base, "launcher");
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
  tmux("new-session", "-d", "-s", session, "-n", "keeper", "-c", fx.base, "sleep 600");
  tmux("new-window", "-d", "-t", `${session}:`, "-n", name, "-c", home, launcher);
  const harnessPid = () => { try { const text = readFileSync(pidFile, "utf8").trim(); return /^\d+$/.test(text) && Number(text) > 1 ? Number(text) : null; } catch { return null; } };
  await waitUntil(() => harnessPid() !== null && alive(harnessPid()), "the stand-in harness to run");
  const pid = harnessPid();

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

// ---- 6. the wrapping never answers a code that says nothing happened ----

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
