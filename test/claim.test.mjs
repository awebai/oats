// The claim protocol's own edges, lib/claim.mjs (awebai/oats#870, #874): a holder that is a zombie,
// a path that exists and never reads as a claim, a gone holder whose file cannot be taken over, and
// a takeover that fails once it has ended the holder's step. Units of acquireClaim and of withClaim
// (lib/worktree.mjs); the commands that use the claim are in test/retire-exclusive.test.mjs and
// test/worktree-event.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAIM_WAIT_MS, acquireClaim, readClaim, releaseClaim, removeGoneClaim } from "../lib/claim.mjs";
import { defectOf } from "../lib/errors.mjs";
import { retireClaimRefusals } from "../lib/core.mjs";
import { purposeClaimBusy, withClaim, worktreeClaimRefusals } from "../lib/worktree.mjs";
import { processStartToken, selfIdentity } from "../lib/worktree-hooks.mjs";
import { hostProcessState, zombieSync } from "./helpers/host-fixture.mjs";

const N1 = "a".repeat(32), N2 = "b".repeat(32);
/** A real pid whose process has exited and been reaped. */
const exitedPid = () => spawnSync(process.execPath, ["-e", ""], { env: { PATH: process.env.PATH } }).pid;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** A directory for one test's claim, and the refusals of a caller, each naming itself and what it
 *  was given: → { dir, lock, opts(extra), entries() }. */
function claimDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "oats-claim-edges-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const refusal = (kind, facts) => Object.assign(new Error(kind), { code: "E_LIFECYCLE_BUSY", kind, ...facts });
  return {
    dir, lock: join(dir, "p.lock"),
    opts: (extra = {}) => ({
      busy: (holder, unknown, at) => refusal("busy", { holder, unknown, at }),
      ownStartUnreadable: (reason, at) => refusal("ownStartUnreadable", { reason, at }),
      unreadableClaim: (at) => refusal("unreadableClaim", { at }),
      cannotTakeOver: (holder, at, why) => refusal("cannotTakeOver", { holder, at, why }),
      ...extra,
    }),
    entries: () => readdirSync(dir).sort(),
  };
}
/** The error `fn` throws. */
function thrown(fn) {
  try { fn(); } catch (e) { return e; }
  assert.fail("it did not throw");
}
/** Replace `node:fs`'s `name` with `wrap(original)` until `t` ends: lib/claim.mjs calls it then. */
function wrapFs(t, name, wrap) {
  const original = fs[name];
  fs[name] = wrap(original);
  syncBuiltinESMExports();
  t.after(() => { fs[name] = original; syncBuiltinESMExports(); });
}
/** A process group of its own that runs until it is ended, standing in for the git step a dead
 *  holder recorded: not this process's child (as at a recovery, where its parent was the killed
 *  command), so that it is reaped when it ends. → its id, which is its leader's pid. */
function runningStep(t) {
  const middle = spawnSync(process.execPath, ["-e", 'const c = require("node:child_process").spawn("sleep", ["60"], { detached: true, stdio: "ignore" }); c.unref(); console.log(c.pid);'], { encoding: "utf8" });
  const step = Number(middle.stdout.trim());
  assert.ok(Number.isSafeInteger(step) && alive(step), `the step runs: ${JSON.stringify(middle)}`);
  t.after(() => { try { process.kill(-step, "SIGKILL"); } catch { /* gone */ } });
  return step;
}
/** An error as the system gives it for a claim that is already there. */
const eexist = () => Object.assign(new Error("EEXIST: file already exists, link"), { code: "EEXIST" });
/** Count the attempts to link a claim into place at `path` (each pass of the loop makes one). */
function countLinks(t, path) {
  const seen = { n: 0 };
  wrapFs(t, "linkSync", (linkSync) => function (from, to) { if (to === path) seen.n++; return linkSync.call(this, from, to); });
  return seen;
}

test("a claim whose holder is a zombie with the recorded start is taken over, as any gone holder's, without waiting for the reap", async (t) => {
  const c = claimDir(t);
  const holder = spawn("sleep", ["60"], { stdio: "ignore" });
  t.after(() => { try { process.kill(holder.pid, "SIGKILL"); } catch { /* gone */ } });
  const record = { pid: holder.pid, processStart: processStartToken(holder.pid), nonce: N1, at: "2026-10-10T00:00:00.000Z" };
  writeFileSync(c.lock, JSON.stringify(record) + "\n");
  // The control: while it runs, it holds the claim.
  const busy = thrown(() => acquireClaim(c.lock, c.opts({ waitMs: 0 })));
  assert.deepEqual([busy.kind, busy.holder, busy.unknown, busy.at], ["busy", record, null, c.lock]);
  // From here to the takeover nothing awaits: this process is the zombie's parent and does not reap it.
  t.diagnostic(`the host's state of the zombie holder: ${JSON.stringify(zombieSync(holder.pid))}`);
  const me = acquireClaim(c.lock, c.opts({ waitMs: 0 }));
  assert.match(hostProcessState(holder.pid) ?? "", /^Z/, "the holder was still a zombie when its claim was taken over");
  assert.deepEqual([me.pid, readClaim(c.lock).nonce], [process.pid, me.nonce], "the claim is this process's");
  assert.deepEqual(c.entries(), ["p.lock"], "no takeover claim and no private file is left");
  releaseClaim(c.lock, me);
  // withClaim, the purpose claim's own caller, the same way.
  writeFileSync(c.lock, JSON.stringify(record) + "\n");
  const ran = withClaim(c.lock, () => "ran", { busy: c.opts().busy });
  assert.match(hostProcessState(holder.pid) ?? "", /^Z/);
  assert.equal(await ran, "ran");
  assert.deepEqual(c.entries(), []);
});

for (const [what, waitMs] of [["no wait", 0], ["the default wait", undefined]]) {
  test(`a dangling symbolic link where the claim belongs, with ${what}: refused in a bounded time, having paused between its attempts, naming the path`, (t) => {
    const c = claimDir(t);
    const target = join(c.dir, "nowhere");
    symlinkSync(target, c.lock);
    const links = countLinks(t, c.lock);
    const t0 = Date.now();
    const e = thrown(() => acquireClaim(c.lock, c.opts(waitMs === undefined ? {} : { waitMs })));
    const took = Date.now() - t0;
    // The refusal for a path that is no readable claim, never the one that says somebody is running.
    assert.deepEqual([e.code, e.kind, e.at], ["E_LIFECYCLE_BUSY", "unreadableClaim", c.lock]);
    // Bounded: the wait, then five more passes, 50 ms apart; and never hot: one pause after each pass.
    const wait = waitMs ?? CLAIM_WAIT_MS;
    assert.ok(took >= wait + 5 * 50 && took < wait + 5000, `it took ${took} ms`);
    if (waitMs === 0) assert.equal(links.n, 6, "the first attempt and five retries");
    assert.ok(links.n >= 2 && links.n <= Math.ceil(took / 50) + 1, `${links.n} attempts in ${took} ms: at least 50 ms apart`);
    assert.ok(took >= (links.n - 1) * 50, `${links.n} attempts in ${took} ms: it paused between them`);
    assert.deepEqual([lstatSync(c.lock).isSymbolicLink(), readlinkSync(c.lock), existsSync(target)], [true, target, false], "the link is as it was, and nothing was written through it");
    assert.deepEqual(c.entries(), ["p.lock"], "no private file is left");
  });
}

test("a dangling symbolic link where a takeover's own claim belongs: the same bounded refusal, naming that path, and the dead holder's claim is kept", (t) => {
  const c = claimDir(t);
  const held = JSON.stringify({ pid: exitedPid(), processStart: "proc:gone", nonce: N1 }) + "\n";
  writeFileSync(c.lock, held);
  const reclaim = `${c.lock}.reclaim-${N1}`;
  symlinkSync(join(c.dir, "nowhere"), reclaim);
  const links = countLinks(t, reclaim);
  const t0 = Date.now();
  const e = thrown(() => acquireClaim(c.lock, c.opts({ waitMs: 0 })));
  assert.deepEqual([e.kind, e.at], ["unreadableClaim", reclaim]);
  assert.ok(Date.now() - t0 < 5000 && links.n === 6, `${links.n} attempts in ${Date.now() - t0} ms`);
  assert.equal(readFileSync(c.lock, "utf8"), held, "the claim it could not take over is as it was");
  assert.deepEqual(c.entries(), ["p.lock", `p.lock.reclaim-${N1}`]);
});

test("a directory where the claim belongs is refused at once as unreadable, and left as it is", (t) => {
  const c = claimDir(t);
  mkdirSync(c.lock);
  const links = countLinks(t, c.lock);
  const e = thrown(() => acquireClaim(c.lock, c.opts()));
  assert.deepEqual([e.kind, e.at, links.n], ["unreadableClaim", c.lock, 1]);
  assert.deepEqual([lstatSync(c.lock).isDirectory(), c.entries()], [true, ["p.lock"]]);
});

test("a claim released between the failed link and the read is taken on the next pass, with no wait: the true race is retried", (t) => {
  const c = claimDir(t);
  // The first link meets a claim that its holder releases before this process reads it.
  let first = true;
  wrapFs(t, "linkSync", (linkSync) => function (from, to) {
    if (to === c.lock && first) { first = false; throw eexist(); }
    return linkSync.call(this, from, to);
  });
  const me = acquireClaim(c.lock, c.opts({ waitMs: 0 }));
  assert.equal(readClaim(c.lock).nonce, me.nonce);
  releaseClaim(c.lock, me);
  assert.deepEqual(c.entries(), []);
});

test("a gone holder whose claim cannot be taken over is refused as that, never as a holder that runs: a nonce that is not 32 hex, and a takeover nested 8 deep", (t) => {
  const c = claimDir(t);
  const gone = exitedPid();
  // A hand-written or damaged claim: it parses, its holder is gone, and no takeover can be serialized on it.
  for (const nonce of ["short", "A".repeat(32), 7, undefined]) {
    const record = { pid: gone, processStart: "proc:gone", ...(nonce === undefined ? {} : { nonce }), at: "2026-10-10T00:00:00.000Z" };
    const held = JSON.stringify(record) + "\n";
    writeFileSync(c.lock, held);
    for (const waitMs of [0, 200]) {
      const t0 = Date.now();
      const e = thrown(() => acquireClaim(c.lock, c.opts({ waitMs })));
      assert.deepEqual([e.code, e.kind, e.holder, e.at, e.why], ["E_LIFECYCLE_BUSY", "cannotTakeOver", record, c.lock, "its nonce is not the 32 hexadecimal digits a claim carries"], JSON.stringify(nonce));
      assert.ok(Date.now() - t0 < 150, "at once: nobody is waited for");
    }
    assert.equal(removeGoneClaim(c.lock, c.opts({ waitMs: 0 })), false, "the abandoned-claim removal skips it");
    assert.equal(readFileSync(c.lock, "utf8"), held, "the file is as it was");
    assert.deepEqual(c.entries(), ["p.lock"]);
  }
  // The claim of a takeover nested as deep as takeovers go (acquireClaim's own `depth`): not taken over either.
  const record = { pid: gone, processStart: "proc:gone", nonce: N1 };
  writeFileSync(c.lock, JSON.stringify(record) + "\n");
  const e = thrown(() => acquireClaim(c.lock, c.opts({ waitMs: 0 }), 8));
  assert.deepEqual([e.kind, e.holder, e.at, e.why], ["cannotTakeOver", record, c.lock, "it is the claim of a takeover nested 8 deep"]);
  assert.deepEqual([readClaim(c.lock), c.entries()], [record, ["p.lock"]], "the file is as it was");
  // One level less deep, it is.
  releaseClaim(c.lock, acquireClaim(c.lock, c.opts({ waitMs: 0 }), 7));
  assert.deepEqual(c.entries(), []);
});

test("takeovers that each died holding their own claim: the one whose own takeover the system will not name is refused, naming that file, and with it removed the chain is taken over", (t) => {
  const c = claimDir(t);
  const gone = exitedPid();
  // Each nested claim's name is 41 bytes longer than the one it takes over, and a claim is taken
  // through a private file with a longer name still. The chain is as deep as a takeover could
  // have made it on this file system: a claim is in it only if its private file can be named.
  const files = [];
  for (let path = c.lock, i = 0; i < 12; i++) {
    const record = { pid: gone, processStart: "proc:gone", nonce: String(i % 10).repeat(32) };
    const probe = `${path}.tmp-${process.pid}-${record.nonce}`;
    try { writeFileSync(probe, ""); rmSync(probe); }
    catch (e) { assert.equal(e.code, "ENAMETOOLONG"); break; }
    writeFileSync(path, JSON.stringify(record) + "\n");
    files.push({ path, record });
    path = `${path}.reclaim-${record.nonce}`;
  }
  assert.ok(files.length >= 3 && files.length < 12, `the file system named ${files.length} claims of the chain`);
  const names = () => files.map((f) => f.path.slice(c.dir.length + 1)).sort();
  const deepest = files.at(-1);
  t.diagnostic(`on this file system a chain of dead takeovers is ${files.length} claims deep at most (the deepest name is ${names().at(-1).length} bytes long)`);
  const e = thrown(() => acquireClaim(c.lock, c.opts({ waitMs: 0 })));
  // Its own refusal, about the file to remove: never the system's error about a file that does not exist.
  assert.deepEqual([e.code, e.kind, e.at, e.holder, e.why], ["E_LIFECYCLE_BUSY", "cannotTakeOver", deepest.path, deepest.record, "the claim of one more takeover would have a name longer than this file system allows"]);
  assert.deepEqual(c.entries(), names(), "nothing was done: every claim of the chain is there, and nothing beside them");
  for (const f of files) assert.deepEqual(readClaim(f.path), f.record);
  // The way out the refusal names: with that one file removed, the rest of the chain is taken over.
  rmSync(deepest.path);
  files.pop();
  const me = acquireClaim(c.lock, c.opts({ waitMs: 0 }));
  assert.deepEqual(c.entries(), ["p.lock"], `the ${files.length} claims left were taken over, and no takeover claim is left`);
  releaseClaim(c.lock, me);
});

test("a claim that is held again by a gone process after every takeover ends in a refusal: the passes that find nobody holding it are bounded too", (t) => {
  const c = claimDir(t);
  const gone = exitedPid();
  const dead = (n) => JSON.stringify({ pid: gone, processStart: "proc:gone", nonce: String(n).repeat(32) }) + "\n";
  writeFileSync(c.lock, dead(0));
  // Whenever this process tries to take the claim, another has taken it first and has died.
  let links = 0;
  wrapFs(t, "linkSync", (linkSync) => function (from, to) {
    if (to !== c.lock) return linkSync.call(this, from, to);
    links++;
    if (!existsSync(c.lock)) writeFileSync(c.lock, dead(links % 10));
    throw eexist();
  });
  const t0 = Date.now();
  const e = thrown(() => acquireClaim(c.lock, c.opts({ waitMs: 0 })));
  assert.deepEqual([e.kind, e.at, e.why], ["cannotTakeOver", c.lock, "this command found it without a live holder 5 times, and it is held again by a process that is gone"]);
  assert.equal(links, 6, "the first attempt and five retries");
  assert.ok(Date.now() - t0 >= 250 && Date.now() - t0 < 5000, "it paused between them");
  assert.equal(readClaim(c.lock).nonce, e.holder.nonce, "the refusal is about the claim that is there");
  assert.deepEqual(c.entries(), ["p.lock"], "no takeover claim is left");
});

test("a takeover that cannot remove the gone holder's claim after it ended that holder's step says so: the step was ended and the claim is kept, never that nothing was done", async (t) => {
  const c = claimDir(t);
  const gone = exitedPid();
  // The step a dead holder recorded: a group of its own, still running.
  const step = runningStep(t);
  const record = { pid: gone, processStart: "proc:gone", nonce: N1, gitPid: step, gitStart: processStartToken(step) };
  writeFileSync(c.lock, JSON.stringify(record) + "\n");
  // The system refuses the removal of that claim, and of that claim only.
  wrapFs(t, "unlinkSync", (unlinkSync) => function (path) {
    if (path === c.lock) throw Object.assign(new Error(`EACCES: permission denied, unlink '${path}'`), { code: "EACCES", syscall: "unlink" });
    return unlinkSync.call(this, path);
  });
  const busy = (holder) => Object.assign(new Error(`busy ${holder?.pid ?? "?"}`), { code: "E_LIFECYCLE_BUSY" });
  const e = await withClaim(c.lock, () => "ran", { busy }).then(() => assert.fail("it did not throw"), (err) => err);
  assert.equal(e.code, "E_LIFECYCLE_FAILED");
  assert.equal(e.message, `the claim ${c.lock} could not be taken (EACCES: permission denied, unlink '${c.lock}'): git process group ${step}, left running by a killed oats worktree command, was ended, and the claim it left is kept; nothing else was done`);
  assert.deepEqual(e.details, { cause: { code: "EACCES", syscall: "unlink" } });
  assert.ok(!/nothing was done/.test(e.message), "it does not say that nothing was done");
  assert.equal(alive(step), false, "the recorded step was ended");
  assert.deepEqual(readClaim(c.lock), record, "the claim is kept, as it was");
  assert.deepEqual(c.entries(), ["p.lock"], "the takeover's own claim is released");

  // The same failure when the holder recorded no step: nothing was ended, and the answer is the one
  // for any claim that cannot be taken.
  const plain = { pid: gone, processStart: "proc:gone", nonce: N2 };
  writeFileSync(c.lock, JSON.stringify(plain) + "\n");
  const e2 = await withClaim(c.lock, () => "ran", { busy }).then(() => assert.fail("it did not throw"), (err) => err);
  assert.equal(e2.code, "E_LIFECYCLE_FAILED");
  assert.equal(e2.message, `the claim ${c.lock} could not be taken (EACCES: permission denied, unlink '${c.lock}'); nothing was done`);
  assert.deepEqual([readClaim(c.lock), c.entries()], [plain, ["p.lock"]]);
});

test("passes that find nobody holding the claim before the wait is over do not spend its retries: a claim released at the deadline is still taken", (t) => {
  const c = claimDir(t);
  const waitMs = 300;
  // The claim is there at every link and released before every read, until one pass has come after
  // the wait was over; the next link finds it free.
  let early = 0, late = 0;
  const started = Date.now();
  wrapFs(t, "linkSync", (linkSync) => function (from, to) {
    if (to !== c.lock || late) return linkSync.call(this, from, to);
    if (Date.now() >= started + waitMs + 10) late++; else early++;
    throw eexist();
  });
  const me = acquireClaim(c.lock, c.opts({ waitMs }));
  assert.ok(early >= 5, `${early} passes found it released before the wait was over: more than the retries there are after it`);
  assert.equal(late, 1, "and one more at the deadline, which is retried");
  assert.equal(readClaim(c.lock).nonce, me.nonce, "the next pass took it");
  releaseClaim(c.lock, me);
  assert.deepEqual(c.entries(), []);
});

test("an acquisition whose takeover ended the dead holder's step and that is then refused answers E_LIFECYCLE_FAILED, the ended step first: never that nothing was done", async (t) => {
  const gone = exitedPid();
  const said = (step) => `git process group ${step}, left running by a killed oats worktree command, was ended`;
  /** A claim whose dead holder recorded a step that still runs; every later link of it meets what
   *  `then(lock, n)` does (the nth one, from 1) in place of taking it. → { c, step, error }. */
  const refusedAfterEnding = async (st, then, busyOf = (c) => purposeClaimBusy("p", c.lock)) => {
    const c = claimDir(st), step = runningStep(st);
    writeFileSync(c.lock, JSON.stringify({ pid: gone, processStart: "proc:gone", nonce: N1, gitPid: step, gitStart: processStartToken(step) }) + "\n");
    let links = 0;
    wrapFs(st, "linkSync", (linkSync) => function (from, to) {
      if (to !== c.lock) return linkSync.call(this, from, to);
      if (++links === 1) throw eexist(); // the dead holder's own claim
      return then(c.lock, links - 1);
    });
    const error = await withClaim(c.lock, () => assert.fail("the claim was not taken"), { busy: busyOf(c), waitMs: 0 }).then(() => assert.fail("it did not throw"), (e) => e);
    assert.equal(alive(step), false, "the recorded step was ended");
    assert.equal(error.code, "E_LIFECYCLE_FAILED", error.message);
    assert.ok(error.message.startsWith(`${said(step)}; after that: `), error.message);
    assert.ok(!/nothing was done/.test(error.message), `it does not say that nothing was done: ${error.message}`);
    return { c, step, error };
  };
  const heldBy = (lock, record) => { if (!existsSync(lock)) writeFileSync(lock, JSON.stringify(record) + "\n"); throw eexist(); };

  await t.test("held again and again by a process that is gone, until the retries are spent", async (st) => {
    const { c, step, error } = await refusedAfterEnding(st, (lock, n) => heldBy(lock, { pid: gone, processStart: "proc:gone", nonce: String(n % 10).repeat(32) }));
    assert.equal(error.message, `${said(step)}; after that: the process that held ${c.lock} (pid ${gone}) is gone, and this file is not a claim this kernel can take over (this command found it without a live holder 5 times, and it is held again by a process that is gone); nothing else was done — inspect ${c.lock} and remove it if no oats worktree command holds it, then retry`);
    assert.deepEqual(error.details, { purpose: "p", lock: c.lock, pid: gone }, "the refusal's own details");
    assert.equal(error.cause, undefined, "a refusal of the kernel's has no cause");
    assert.deepEqual(c.entries(), ["p.lock"], "no takeover claim is left");
  });
  await t.test("taken first by another command that runs", async (st) => {
    const { c, step, error } = await refusedAfterEnding(st, (lock) => heldBy(lock, { ...selfIdentity(), nonce: N2 }));
    assert.equal(error.message, `${said(step)}; after that: another oats worktree add or remove of purpose p is running (pid ${process.pid} holds ${c.lock}); nothing else was done — retry when it has finished`);
    assert.deepEqual(error.details, { purpose: "p", lock: c.lock, pid: process.pid });
    assert.equal(readClaim(c.lock).nonce, N2, "the live holder's claim is untouched");
  });
  await t.test("an error of the system's", async (st) => {
    const denied = Object.assign(new Error("EACCES: permission denied, link"), { code: "EACCES", syscall: "link" });
    const { c, step, error } = await refusedAfterEnding(st, () => { throw denied; });
    assert.equal(error.message, `${said(step)}; after that: the claim ${c.lock} could not be taken (EACCES: permission denied, link); nothing else was done`);
    assert.deepEqual(error.details, { cause: { code: "EACCES", syscall: "link" } }, "the system's code stays in details.cause");
    assert.equal(error.cause, denied);
    assert.deepEqual(c.entries(), []);
  });
  await t.test("a refusal written as a plain Error without a code: no cause in its details", async (st) => {
    const refused = new Error("the file system said no");
    const { c, step, error } = await refusedAfterEnding(st, () => { throw refused; });
    assert.equal(error.message, `${said(step)}; after that: the claim ${c.lock} could not be taken (the file system said no); nothing else was done`);
    assert.equal(error.details, undefined, "a refusal has no cause to name");
    assert.equal(defectOf(error), undefined, "and it is no defect");
  });
  await t.test("a defect, a thrown value that is falsy included, is still the defect the answer wraps", async (st) => {
    for (const thrown of [new TypeError("x is not a function"), undefined, 0]) {
      const { error } = await refusedAfterEnding(st, () => { throw thrown; });
      assert.deepEqual(error.details, { cause: { name: thrown instanceof Error ? "TypeError" : "Error" } }, String(thrown));
      assert.ok(Object.hasOwn(error, "cause"), `the answer holds what it wrapped: ${String(thrown)}`);
      assert.deepEqual(defectOf(error), { thrown }, `whoever answers it can still report it: ${String(thrown)}`);
    }
  });
  await t.test("a refusal that does not hold the words is passed as it is after what was ended", async (st) => {
    const plain = () => (holder) => Object.assign(new Error(`held by ${holder?.pid ?? "?"}`), { code: "E_LIFECYCLE_BUSY", details: { held: true } });
    const { step, error } = await refusedAfterEnding(st, (lock) => heldBy(lock, { ...selfIdentity(), nonce: N2 }), plain);
    assert.equal(error.message, `${said(step)}; after that: held by ${process.pid}`);
    assert.deepEqual(error.details, { held: true });
  });
});

test("every refusal of a claim, of both callers, says that nothing was done exactly once: the words an answer after an ended step turns into nothing else was done", () => {
  const holder = { pid: 4242, processStart: "proc:1", nonce: N1, at: "2026-10-10T00:00:00.000Z" };
  const callers = {
    "oats retire": [retireClaimRefusals("worker-1", "/agents/worker/instances/worker-1", "/claims/worker-1.lock"), "/claims/worker-1.lock"],
    "oats worktree": [worktreeClaimRefusals(purposeClaimBusy("p", "/trees/p.lock")), "/trees/p.lock"],
  };
  for (const [caller, [r, lock]] of Object.entries(callers)) {
    // The refusals lib/claim.mjs asks a caller for, and no other.
    assert.deepEqual(Object.keys(r).sort(), ["busy", "cannotTakeOver", "ownStartUnreadable", "unreadableClaim"], caller);
    for (const at of [lock, `${lock}.reclaim-${N1}`]) {
      const refusals = {
        "busy, a holder that runs": r.busy(holder, null, at),
        "busy, a holder whose start cannot be read": r.busy(holder, "ps: simulated failure", at),
        ownStartUnreadable: r.ownStartUnreadable("ps: simulated failure", at),
        unreadableClaim: r.unreadableClaim(at),
        cannotTakeOver: r.cannotTakeOver(holder, at, "its nonce is not the 32 hexadecimal digits a claim carries"),
      };
      for (const [which, e] of Object.entries(refusals)) {
        const what = `${caller}, ${which}: ${e.message}`;
        assert.equal(e.code, "E_LIFECYCLE_BUSY", what);
        assert.equal(e.message.split("nothing was done").length - 1, 1, what);
        assert.ok(!e.message.includes("\n"), what);
        assert.equal(e.details.lock, at, what);
      }
    }
  }
});

test("a claim's record is open: what its holder recorded beside the protocol's own fields is kept and handed to the refusals", (t) => {
  const c = claimDir(t);
  const record = { ...selfIdentity(), nonce: N1, at: "2026-10-10T00:00:00.000Z", verb: "stop", more: { of: "it" } };
  writeFileSync(c.lock, JSON.stringify(record) + "\n");
  const e = thrown(() => acquireClaim(c.lock, c.opts({ waitMs: 0 })));
  assert.deepEqual([e.kind, e.holder], ["busy", record]);
  assert.equal(alive(record.pid), true);
});
