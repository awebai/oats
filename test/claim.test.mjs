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
import { dirname, join } from "node:path";
import { CLAIM_WAIT_MS, acquireClaim, readClaim, releaseClaim, removeGoneClaim } from "../lib/claim.mjs";
import { BUSY_HOLDERS, defectOf } from "../lib/errors.mjs";
import { claimHomeFor, lifecycleClaimRefusals, releaseHomeClaim, retireClaimPath, retireClaimRefusals } from "../lib/core.mjs";
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
      heldAgain: (holder, at, times) => refusal("heldAgain", { holder, at, times }),
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
  const middle = spawnSync(process.execPath, ["-e", 'const c = require("node:child_process").spawn("sleep", ["60"], { detached: true, stdio: "ignore" }); c.unref(); process.stdout.write(String(c.pid));'], { encoding: "utf8" });
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

/** The pauses lib/claim.mjs takes until `t` ends, each by its length in ms. It pauses with
 *  Atomics.wait; nothing else does in a test that ends no recorded step. What a test says about
 *  waiting is this list and the attempts (countLinks), never how long the host took: where every
 *  liveness read is a `ps`, an upper bound in ms is a bound on the host, not on the claim. */
function countPauses(t) {
  const original = Atomics.wait, seen = [];
  Atomics.wait = function (array, index, value, ms) { seen.push(ms); return original.call(this, array, index, value, ms); };
  t.after(() => { Atomics.wait = original; });
  return seen;
}
/** Run `fn` on a clock that only those pauses move: Date.now() stands still but for the length of
 *  each pause, which takes no time. For what holds at an exact moment of the wait, on any host.
 *  → { result, pauses }. Synchronous, as the claim is: nothing else runs on that clock. A loop
 *  that reads it again and again without pausing would never see its wait end: that is an error
 *  here, not a test that hangs. */
function onPausedClock(fn) {
  const now = Date.now, wait = Atomics.wait, pauses = [];
  let at = Date.now(), reads = 0;
  Date.now = () => {
    if (++reads > 1000) throw new Error(`the clock was read ${reads} times with no pause between: a loop that does not pause`);
    return at;
  };
  Atomics.wait = (array, index, value, ms) => { pauses.push(ms); at += ms; reads = 0; return "timed-out"; };
  try { return { result: fn(), pauses }; }
  finally { Date.now = now; Atomics.wait = wait; }
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
    const acquire = () => thrown(() => acquireClaim(c.lock, c.opts(waitMs === undefined ? {} : { waitMs })));
    // Bounded by what it does, never by how long this host takes: the attempts its wait has room
    // for at 50 ms apart, then five more and the one that refuses. And never hot: one pause of
    // 50 ms after each attempt but the last.
    let e, pauses;
    if (waitMs === 0) {
      // With no wait, on the host's own clock: the pauses are real, so it cannot have taken less
      // than they add up to. A lower bound only; how much longer it took is the host's.
      pauses = countPauses(t);
      const t0 = Date.now();
      e = acquire();
      const took = Date.now() - t0;
      assert.ok(took >= 5 * 50, `it took ${took} ms`);
      assert.equal(links.n, 6, "the first attempt and five retries");
    } else {
      // The default wait, on a clock that only its pauses move: every attempt of that wait is
      // made, and the refusal comes five pauses after it is over.
      ({ result: e, pauses } = onPausedClock(acquire));
      assert.equal(links.n, CLAIM_WAIT_MS / 50 + 6, `${links.n} attempts for a wait of ${CLAIM_WAIT_MS} ms`);
    }
    // The refusal for a path that is no readable claim, never the one that says somebody is running.
    assert.deepEqual([e.code, e.kind, e.at], ["E_LIFECYCLE_BUSY", "unreadableClaim", c.lock]);
    assert.deepEqual(pauses, Array(links.n - 1).fill(50), "one pause of 50 ms after each attempt but the last");
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
  const links = countLinks(t, reclaim), pauses = countPauses(t);
  const e = thrown(() => acquireClaim(c.lock, c.opts({ waitMs: 0 })));
  assert.deepEqual([e.kind, e.at], ["unreadableClaim", reclaim]);
  assert.deepEqual([links.n, pauses], [6, Array(5).fill(50)], "six attempts at the takeover's claim, a pause after each but the last, and no more");
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
  const links = countLinks(t, c.lock), pauses = countPauses(t);
  // A hand-written or damaged claim: it parses, its holder is gone, and no takeover can be serialized on it.
  for (const nonce of ["short", "A".repeat(32), 7, undefined]) {
    const record = { pid: gone, processStart: "proc:gone", ...(nonce === undefined ? {} : { nonce }), at: "2026-10-10T00:00:00.000Z" };
    const held = JSON.stringify(record) + "\n";
    writeFileSync(c.lock, held);
    for (const waitMs of [0, 200]) {
      links.n = 0; pauses.length = 0;
      const e = thrown(() => acquireClaim(c.lock, c.opts({ waitMs })));
      assert.deepEqual([e.code, e.kind, e.holder, e.at, e.why], ["E_LIFECYCLE_BUSY", "cannotTakeOver", record, c.lock, "its nonce is not the 32 hexadecimal digits a claim carries"], JSON.stringify(nonce));
      assert.deepEqual([links.n, pauses], [1, []], `at once, whatever the wait (${waitMs} ms): one attempt and no pause, nobody is waited for`);
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
  const pauses = countPauses(t);
  const e = thrown(() => acquireClaim(c.lock, c.opts({ waitMs: 0 })));
  assert.deepEqual([e.kind, e.at, e.times], ["heldAgain", c.lock, 5], "its own refusal: the file is a claim like any other, and is never said to be one that cannot be taken over");
  assert.equal(links, 6, "the first attempt and five retries");
  assert.deepEqual(pauses, Array(5).fill(50), "it paused between them, once after each takeover");
  assert.equal(readClaim(c.lock).nonce, e.holder.nonce, "the refusal is about the claim that is there");
  assert.deepEqual(c.entries(), ["p.lock"], "no takeover claim is left");
});

test("a claim that every pass found held again by a process that is gone has a refusal of its own in each builder: E_LIFECYCLE_BUSY with holder none, what happened, the verb's own words and to run the command again; never that the file is no claim to take over, and the next run takes it", async (t) => {
  const gone = exitedPid();
  const AT = "2026-10-10T00:00:00.000Z";
  const dead = (n, more) => JSON.stringify({ pid: gone, processStart: "proc:gone", nonce: String(n).repeat(32), ...more }) + "\n";
  /** Until `over()`: whenever this process tries to take `lock`, another has taken it first and has died. */
  const takenAgain = (st, lock, more) => {
    const race = { on: true, links: 0, over() { this.on = false; } };
    wrapFs(st, "linkSync", (linkSync) => function (from, to) {
      if (to !== lock || !race.on) return linkSync.call(this, from, to);
      race.links++;
      if (!existsSync(lock)) writeFileSync(lock, dead(race.links % 10, more));
      throw eexist();
    });
    return race;
  };
  const neverThat = (e) => assert.ok(!/not a claim this kernel can take over|inspect|remove it/.test(e.message), `nothing is wrong with the file, and nothing is to be removed: ${e.message}`);

  await t.test("the worktree commands' (worktreeClaimRefusals)", async (st) => {
    const c = claimDir(st);
    writeFileSync(c.lock, dead(0));
    const race = takenAgain(st, c.lock);
    const run = (fn) => withClaim(c.lock, fn, { busy: purposeClaimBusy("p", c.lock), waitMs: 0 });
    const e = await run(() => assert.fail("the claim was not taken")).then(() => assert.fail("it did not throw"), (err) => err);
    assert.equal(e.code, "E_LIFECYCLE_BUSY");
    assert.equal(e.message, `the claim ${c.lock} was found without a live holder 5 times and was taken again each time, the last time by a process that is gone (pid ${gone}); nothing was done — run the command again`);
    assert.deepEqual(e.details, { purpose: "p", lock: c.lock, pid: gone, holder: "none" });
    neverThat(e);
    assert.equal(race.links, 6, "the first attempt and five retries");
    assert.deepEqual(c.entries(), ["p.lock"], "the last dead holder's claim is there, and no takeover claim");
    // The remedy is true: the same command again, with nobody racing it, takes that claim over.
    race.over();
    assert.equal(await run(() => "ran"), "ran");
    assert.deepEqual(c.entries(), [], "and releases it");
  });

  for (const [verb, nothing] of [["retire", "nothing was done"], ["stop", "nothing was stopped"]]) {
    await t.test(`the home's (lifecycleClaimRefusals), for oats ${verb === "stop" ? "instance stop" : verb}`, (st) => {
      const instances = mkdtempSync(join(tmpdir(), "oats-claim-edges-"));
      st.after(() => rmSync(instances, { recursive: true, force: true }));
      const home = join(instances, "worker-1"), lock = retireClaimPath(home);
      mkdirSync(dirname(lock), { recursive: true });
      // Each of the dead holders was a stop: the refusal names the last one's verb, as every
      // refusal of the home's claim names its holder's.
      writeFileSync(lock, dead(0, { action: "stop", at: AT }));
      const race = takenAgain(st, lock, { action: "stop", at: AT });
      const e = thrown(() => claimHomeFor(verb, "worker-1", home));
      assert.equal(e.code, "E_LIFECYCLE_BUSY");
      assert.equal(e.message, `the claim ${lock} was found without a live holder 5 times and was taken again each time, the last time by a process that is gone (pid ${gone}); ${nothing} — run the command again`);
      assert.deepEqual(e.details, { instance: "worker-1", home, lock, pid: gone, since: AT, action: "stop", holder: "none" });
      neverThat(e);
      assert.equal(race.links, 6, "the first attempt and five retries: this verb waits for nobody");
      assert.deepEqual(readdirSync(dirname(lock)), ["worker-1.lock"], "the last dead holder's claim is there, and no takeover claim");
      race.over();
      const holding = claimHomeFor(verb, "worker-1", home);
      assert.deepEqual([readClaim(lock).nonce, readClaim(lock).action], [holding.me.nonce, verb], "the same command again takes that claim over");
      releaseHomeClaim(holding);
      assert.deepEqual(readdirSync(dirname(lock)), []);
    });
  }
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
  // the wait was over; the next link finds it free. On a clock that only the claim's pauses move,
  // so that "before the wait was over" is the loop's own moment, on any host: the wait starts when
  // the acquisition does, and nothing but a pause comes between.
  let early = 0, late = 0, started;
  wrapFs(t, "linkSync", (linkSync) => function (from, to) {
    if (to !== c.lock || late) return linkSync.call(this, from, to);
    if (Date.now() >= started + waitMs) late++; else early++;
    throw eexist();
  });
  const { result: me, pauses } = onPausedClock(() => { started = Date.now(); return acquireClaim(c.lock, c.opts({ waitMs })); });
  assert.equal(early, waitMs / 50, `${early} passes found it released before the wait was over: more than the retries there are after it`);
  assert.equal(late, 1, "and one more at the deadline, which is retried");
  assert.deepEqual(pauses, Array(early + late).fill(50), "a pause after each of them");
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
    assert.equal(error.message, `${said(step)}; after that: the claim ${c.lock} was found without a live holder 5 times and was taken again each time, the last time by a process that is gone (pid ${gone}); nothing else was done — run the command again`);
    assert.deepEqual(error.details, { purpose: "p", lock: c.lock, pid: gone, holder: "none" }, "the refusal's own details: nobody runs, and the next run takes the claim over");
    assert.equal(error.cause, undefined, "a refusal of the kernel's has no cause");
    assert.deepEqual(c.entries(), ["p.lock"], "no takeover claim is left");
  });
  await t.test("taken first by another command that runs", async (st) => {
    const { c, step, error } = await refusedAfterEnding(st, (lock) => heldBy(lock, { ...selfIdentity(), nonce: N2 }));
    assert.equal(error.message, `${said(step)}; after that: another oats worktree add or remove of purpose p is running (pid ${process.pid} holds ${c.lock}); nothing else was done — retry when it has finished`);
    assert.deepEqual(error.details, { purpose: "p", lock: c.lock, pid: process.pid, holder: "running" });
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
  await t.test("the home's refusals after an ended step: a stop that then meets a retire that runs, and a retire that then meets a stop that runs, say what was ended first and that nothing else was done", (st) => {
    // The home's claim records no step today (a retire and a stop pass no `endHolderStep`): the
    // step here stands in for one, to hold the builder to what it says after an effect.
    const endedHooks = "the hook process group 77 of a killed oats retire was ended";
    const home = "/agents/worker/instances/worker-1";
    const cases = [
      ["stop", "retire", (lock, live) => [`worker-1 is being retired (pid ${process.pid}, since ${live.at}); nothing else was done`, { instance: "worker-1", home, lock, pid: process.pid, since: live.at, action: "retire" }]],
      ["retire", "stop", (lock, live) => [`a stop of worker-1 is already running (pid ${process.pid}, since ${live.at}); nothing else was done — wait for it to finish`, { instance: "worker-1", home, lock, pid: process.pid, since: live.at, action: "stop", holder: "running" }]],
    ];
    for (const [arriving, holding, expected] of cases) {
      const c = claimDir(st);
      writeFileSync(c.lock, JSON.stringify({ pid: gone, processStart: "proc:gone", nonce: N1, action: "retire", at: "2026-10-10T00:00:00.000Z" }) + "\n");
      const live = { ...selfIdentity(), nonce: N2, action: holding, at: "2026-10-10T00:00:01.000Z" };
      let links = 0;
      const original = fs.linkSync;
      fs.linkSync = function (from, to) {
        if (to !== c.lock) return original.call(this, from, to);
        if (++links === 1) throw eexist(); // the dead holder's own claim
        return heldBy(c.lock, live);
      };
      syncBuiltinESMExports();
      let error;
      try { error = thrown(() => acquireClaim(c.lock, { ...lifecycleClaimRefusals(arriving, "worker-1", home, c.lock), facts: { action: arriving }, waitMs: 0, endHolderStep: () => ({ ended: endedHooks }) })); }
      finally { fs.linkSync = original; syncBuiltinESMExports(); }
      const [sentence, details] = expected(c.lock, live);
      assert.deepEqual([error.code, error.message, error.details], ["E_LIFECYCLE_FAILED", `${endedHooks}; after that: ${sentence}`, details], `oats ${arriving === "stop" ? "instance stop" : arriving} beside a ${holding}`);
      assert.equal(readClaim(c.lock).nonce, N2, "the live holder's claim is untouched");
    }
  });
  await t.test("a refusal that does not hold the words is passed as it is after what was ended", async (st) => {
    const plain = () => (holder) => Object.assign(new Error(`held by ${holder?.pid ?? "?"}`), { code: "E_LIFECYCLE_BUSY", details: { held: true } });
    const { step, error } = await refusedAfterEnding(st, (lock) => heldBy(lock, { ...selfIdentity(), nonce: N2 }), plain);
    assert.equal(error.message, `${said(step)}; after that: held by ${process.pid}`);
    assert.deepEqual(error.details, { held: true });
  });
});

test("every refusal of a claim, of the three callers and of the verb that only reads it, says what was not done exactly once: in its verb's own words before any effect, and as nothing else was done after an ended step, where the answer is E_LIFECYCLE_FAILED, what was ended first, with the same sentence and details; and says who holds it (details.holder), with the step that ends it when nobody is known to run", () => {
  const holder = { pid: 4242, processStart: "proc:1", nonce: N1, at: "2026-10-10T00:00:00.000Z" };
  const home = "/agents/worker/instances/worker-1", claim = "/claims/worker-1.lock";
  // Each caller's refusals, its claim file, and its verb's words for "nothing happened".
  const callers = {
    "oats retire": [retireClaimRefusals("worker-1", home, claim), claim, "nothing was done"],
    "oats instance stop": [lifecycleClaimRefusals("stop", "worker-1", home, claim), claim, "nothing was stopped"],
    "oats worktree add, which reads the home's claim": [lifecycleClaimRefusals("worktree add", "worker-1", home, claim), claim, "no tree was made"],
    "oats worktree": [worktreeClaimRefusals(purposeClaimBusy("p", "/trees/p.lock")), "/trees/p.lock", "nothing was done"],
  };
  const ELSE = "nothing else was done";
  const WORDS = ["nothing was done", "nothing was stopped", "no tree was made", ELSE];
  const count = (text, words) => text.split(words).length - 1;
  /** `text` says `words` once, and none of the other ways of saying that nothing happened. */
  const saysOnce = (text, words, what) => assert.deepEqual(WORDS.map((w) => [w, count(text, w)]), WORDS.map((w) => [w, w === words ? 1 : 0]), what);
  // What a takeover ended before the refusal, as lib/claim.mjs hands it: the clauses, in order.
  const ended = ["git process group 77, left running by a killed oats worktree command, was ended", "git process group 78, left running by a killed oats worktree command, was ended"];
  assert.deepEqual([...BUSY_HOLDERS], ["running", "unknown", "none"], "the closed list of details.holder");
  for (const [caller, [r, lock, nothing]] of Object.entries(callers)) {
    // The refusals lib/claim.mjs asks a caller for, and no other.
    assert.deepEqual(Object.keys(r).sort(), ["busy", "cannotTakeOver", "heldAgain", "ownStartUnreadable", "unreadableClaim"], caller);
    // A stop and a worktree add beside a retire that runs are E_INSTANCE_RETIRING: the one refusal
    // of a claim that is not E_LIFECYCLE_BUSY, with no `holder` and no step that ends it.
    const besideRetire = caller === "oats instance stop" || caller.startsWith("oats worktree add");
    for (const at of [lock, `${lock}.reclaim-${N1}`]) {
      // Each refusal, as the claim asks for it with `steps` ended before it, and what its
      // details.holder is: the same for every caller.
      const refusals = {
        "busy, a holder that runs": [(steps) => r.busy({ ...holder, action: "stop" }, null, at, steps), "running"],
        "busy, a retire that runs": [(steps) => r.busy(holder, null, at, steps), besideRetire ? null : "running"],
        "busy, a holder whose start cannot be read": [(steps) => r.busy(holder, "ps: simulated failure", at, steps), "unknown"],
        ownStartUnreadable: [(steps) => r.ownStartUnreadable("ps: simulated failure", at, steps), "none"],
        unreadableClaim: [(steps) => r.unreadableClaim(at, steps), "unknown"],
        cannotTakeOver: [(steps) => r.cannotTakeOver(holder, at, "its nonce is not the 32 hexadecimal digits a claim carries", steps), "none"],
        heldAgain: [(steps) => r.heldAgain(holder, at, 5, steps), "none"],
      };
      for (const [which, [make, who]] of Object.entries(refusals)) {
        // Before any effect: the claim hands an empty list.
        const e = make([]);
        const what = `${caller}, ${which}: ${e.message}`;
        saysOnce(e.message, nothing, what);
        assert.ok(!e.message.includes("\n"), what);
        assert.equal(e.details.lock, at, what);
        if (who === null) {
          assert.equal(e.code, "E_INSTANCE_RETIRING", what);
          assert.ok(e.message.endsWith(`; ${nothing}`) && !e.message.includes(" — "), `${what}: it ends by saying what was not done, and names no step: the instance is on its way out`);
          assert.equal("holder" in e.details, false, `${what}: details.holder is of E_LIFECYCLE_BUSY`);
        } else {
          assert.equal(e.code, "E_LIFECYCLE_BUSY", what);
          assert.equal(e.details.holder, who, what);
          assert.ok(BUSY_HOLDERS.includes(e.details.holder), what);
          // The message is `<what was refused> — <the step that ends it>`: the refusal states its
          // effects before the dash, once, and never after it.
          const dash = e.message.indexOf(" — ");
          assert.ok(dash > 0, `${what}: the refusal and the step that ends it, one dash between them`);
          const said = e.message.slice(0, dash), remedy = e.message.slice(dash + " — ".length);
          assert.ok(said.endsWith(`; ${nothing}`), `${what}: what was refused ends by saying what was not done`);
          assert.ok(remedy.trim().length > 0 && WORDS.every((w) => !remedy.includes(w)), `${what}: a step that ends it follows the dash`);
          // Waiting ends nothing unless a command is known to run: only that refusal says to wait.
          assert.equal(/wait for it to finish|retry when it has finished/.test(e.message), who === "running", what);
        }
        // A caller that hands no list (the verb that only reads the claim) gets the same answer.
        const bare = make(undefined);
        assert.deepEqual([bare.code, bare.message, bare.details], [e.code, e.message, e.details], `${what}: with no list, as with an empty one`);
        // After an ended step: no longer an answer that says nothing happened, in its code or in
        // its words. The same sentence but for those words, and the same details.
        for (const steps of [ended.slice(0, 1), ended]) {
          const after = make(steps);
          const then = `${what} → after ${steps.length} ended: ${after.message}`;
          assert.equal(after.code, "E_LIFECYCLE_FAILED", then);
          const first = `${steps.join("; ")}; after that: `;
          assert.ok(after.message.startsWith(first), then);
          const sentence = after.message.slice(first.length);
          saysOnce(sentence, ELSE, then);
          assert.equal(sentence, e.message.replace(nothing, ELSE), `${then}: the refusal's own sentence, with the words for after an effect where its verb's words were`);
          assert.deepEqual(after.details, e.details, `${then}: the refusal's details`);
          assert.ok(!after.message.includes("\n"), then);
        }
      }
    }
  }
  // The refusal without a pid to name carries none; a retire's names the holder's verb where a
  // holder was read (a record without `action` is a retire's).
  const [retire, at] = callers["oats retire"], [worktree, tree] = callers["oats worktree"];
  const own = { instance: "worker-1", home: "/agents/worker/instances/worker-1", lock: at };
  assert.deepEqual([retire.busy(holder, null, at).details, retire.busy(holder, "ps: simulated failure", at).details, retire.ownStartUnreadable("ps: simulated failure", at).details, retire.unreadableClaim(at).details, retire.cannotTakeOver(holder, at, "why").details], [
    { ...own, pid: 4242, since: holder.at, action: "retire", holder: "running" },
    { ...own, pid: 4242, since: holder.at, action: "retire", unknown: "ps: simulated failure", holder: "unknown" },
    { ...own, holder: "none" },
    { ...own, holder: "unknown" },
    { ...own, pid: 4242, since: holder.at, action: "retire", holder: "none" },
  ], "oats retire: the details of each refusal");
  assert.deepEqual(retire.busy({ ...holder, action: "stop" }, null, at).details, { ...own, pid: 4242, since: holder.at, action: "stop", holder: "running" }, "oats retire: details.action is the verb the holder recorded");
  assert.deepEqual(retire.heldAgain({ ...holder, action: "stop" }, at, 5).details, { ...own, pid: 4242, since: holder.at, action: "stop", holder: "none" }, "oats retire: the claim taken again and again names the last holder, which is gone");
  assert.deepEqual(worktree.heldAgain(holder, tree, 5).details, { purpose: "p", lock: tree, pid: 4242, holder: "none" }, "oats worktree: the same");
  assert.deepEqual([retire.heldAgain(holder, at, 5).message, worktree.heldAgain(holder, tree, 5).message].map((m) => m.slice(m.indexOf(" — "))), [" — run the command again", " — run the command again"], "the step that ends it: the next run takes the claim over");
  assert.deepEqual([worktree.busy(holder, null, tree).details, worktree.busy(holder, "ps: simulated failure", tree).details, worktree.ownStartUnreadable("ps: simulated failure", tree).details, worktree.unreadableClaim(tree).details, worktree.cannotTakeOver(holder, tree, "why").details], [
    { purpose: "p", lock: tree, pid: 4242, holder: "running" },
    { purpose: "p", lock: tree, pid: 4242, unknown: "ps: simulated failure", holder: "unknown" },
    { purpose: "p", lock: tree, holder: "none" },
    { purpose: "p", lock: tree, holder: "unknown" },
    { purpose: "p", lock: tree, pid: 4242, holder: "none" },
  ], "oats worktree: the details of each refusal");
});

test("a claim's record is open: what its holder recorded beside the protocol's own fields is kept and handed to the refusals", (t) => {
  const c = claimDir(t);
  const record = { ...selfIdentity(), nonce: N1, at: "2026-10-10T00:00:00.000Z", verb: "stop", more: { of: "it" } };
  writeFileSync(c.lock, JSON.stringify(record) + "\n");
  const e = thrown(() => acquireClaim(c.lock, c.opts({ waitMs: 0 })));
  assert.deepEqual([e.kind, e.holder], ["busy", record]);
  assert.equal(alive(record.pid), true);
});
