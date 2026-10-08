// Units of the `worktree` event (#796): the manifest contract, the remote URL scrub, process
// identity by start time, and the hook order. The runs themselves: test/worktree-event.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { manifestContractProblems } from "../lib/capability-contract.mjs";
import { processStartToken, scrubRemoteUrl, selfIdentity, terminateRecordedGroup, verifiedAlive, worktreeHooksOf, worktreeHookTimeoutMs, WORKTREE_HOOK_TIMEOUT_MS, interruptExitStatus } from "../lib/worktree-hooks.mjs";

const problems = (hooks) => manifestContractProblems({ capability: "acme.tool", hooks }).map((p) => `${p.pointer}: ${p.message}`);

test("the manifest contract: worktree is an approved event, and required is allowed on spawn and worktree only", () => {
  assert.deepEqual(problems({ worktree: "bin/setup.mjs" }), []);
  assert.deepEqual(problems({ worktree: { command: "bin/setup.mjs", required: true } }), []);
  assert.deepEqual(problems({ spawn: { command: "bin/s.mjs", required: true } }), []);
  for (const event of ["launch", "retire", "soul-scaffold"]) {
    const [p] = problems({ [event]: { command: "bin/h.mjs", required: true } });
    assert.match(p, new RegExp(`^/hooks/${event}/required: .*cannot be required — only the spawn and worktree hooks are enforced`));
  }
  assert.match(problems({ worktree: { command: "../escape.mjs" } })[0], /escapes the capability directory/);
  assert.match(problems({ worktree: { command: "x.mjs", timeout: 5 } })[0], /unknown: timeout/);
});

test("OATS_TREE_REMOTE never carries userinfo (A2)", () => {
  assert.equal(scrubRemoteUrl("https://user:tok@host/r.git"), "https://host/r.git");
  assert.equal(scrubRemoteUrl("https://tok@host/r.git"), "https://host/r.git");
  assert.equal(scrubRemoteUrl("git@host:o/r.git"), "host:o/r.git");
  assert.equal(scrubRemoteUrl("ssh://git:p%40ss@host:22/o/r.git"), "ssh://host:22/o/r.git");
  assert.equal(scrubRemoteUrl("https://a@b@host/r.git"), "https://host/r.git", "the last @ ends the userinfo");
  assert.equal(scrubRemoteUrl("https://host/r.git"), "https://host/r.git");
  assert.equal(scrubRemoteUrl("host:o/r.git"), "host:o/r.git");
  assert.equal(scrubRemoteUrl("/srv/git/r.git"), "/srv/git/r.git");
  assert.equal(scrubRemoteUrl("./rel/r@x.git"), "./rel/r@x.git", "a local path keeps its @");
  assert.equal(scrubRemoteUrl("file:///srv/r.git"), "file:///srv/r.git");
});

test("a pid is alive only with its recorded start time", async () => {
  const me = selfIdentity();
  assert.equal(me.pid, process.pid);
  assert.ok(me.processStart);
  assert.equal(verifiedAlive(me), true);
  assert.equal(verifiedAlive({ pid: process.pid, processStart: "proc:1" }), false, "same pid, another start: a reused pid");
  assert.equal(verifiedAlive({ pid: process.pid }), false, "a pid alone is never verified");
  assert.equal(verifiedAlive({ pid: 0, processStart: me.processStart }), false);
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const token = processStartToken(child.pid);
  await new Promise((r) => child.on("exit", r));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(verifiedAlive({ pid: child.pid, processStart: token }), false, "an exited process");
});

test("hooks run in capability-name order; the timeout is fixed unless the test seam sets it; 128+signal", () => {
  const caps = [
    { id: "zeta.b", hooks: { worktree: "node z" }, requiredHooks: [] },
    { id: "acme.a", hooks: { worktree: "node a" }, requiredHooks: ["worktree"] },
    { id: "mid.c", hooks: { spawn: "node m" } },
  ];
  assert.deepEqual(worktreeHooksOf(caps).map((h) => [h.id, h.required]), [["acme.a", true], ["zeta.b", false]]);
  assert.equal(WORKTREE_HOOK_TIMEOUT_MS, 30 * 60 * 1000);
  assert.equal(worktreeHookTimeoutMs({}), WORKTREE_HOOK_TIMEOUT_MS);
  assert.equal(worktreeHookTimeoutMs({ OATS_TEST_WORKTREE_HOOK_TIMEOUT_MS: "250" }), 250);
  assert.equal(worktreeHookTimeoutMs({ OATS_TEST_WORKTREE_HOOK_TIMEOUT_MS: "nope" }), WORKTREE_HOOK_TIMEOUT_MS);
  assert.deepEqual(["SIGHUP", "SIGINT", "SIGTERM"].map(interruptExitStatus), [129, 130, 143]);
});

const groupAlive = (pgid) => { try { process.kill(-pgid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const settle = async (cond, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end && !cond()) await new Promise((r) => setTimeout(r, 20)); return cond(); };
/** A detached group, started through a middle process that exits at once, so its leader is not
 *  this process's child (as at recovery, where its parent was the killed kernel): `leaderStays`
 *  keeps the leader (a sleeping shell); otherwise the leader exits and leaves one member (`sleep`)
 *  behind, so the group has no leader. */
async function testGroup(t, { leaderStays }) {
  const script = `const c = require("node:child_process").spawn("/bin/sh", ["-c", ${JSON.stringify(leaderStays ? "sleep 30; :" : "sleep 30 & sleep 0.3; exit 0")}], { detached: true, stdio: "ignore" }); c.unref(); console.log(c.pid);`;
  const middle = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"] });
  let out = ""; middle.stdout.on("data", (c) => { out += c; });
  await new Promise((r) => middle.on("close", r));
  const pgid = Number(out.trim());
  t.after(() => { try { process.kill(-pgid, "SIGKILL"); } catch { /* gone */ } });
  const leaderStart = processStartToken(pgid);
  assert.ok(leaderStart, "the leader's start time was read");
  if (!leaderStays) assert.ok(await settle(() => processStartToken(pgid) === null), "the leader exited");
  assert.ok(groupAlive(pgid));
  return { pgid, leaderStart };
}

test("a recorded hook group is signalled only while its leader runs with the recorded start time", async (t) => {
  const own = await testGroup(t, { leaderStays: true });
  assert.equal(terminateRecordedGroup({ hookPgid: own.pgid, hookStart: own.leaderStart }, 2000), "terminated");
  assert.ok(await settle(() => !groupAlive(own.pgid)), "the group was ended");
  // A record naming an unrelated group (another start time) never signals it.
  const foreign = await testGroup(t, { leaderStays: true });
  assert.equal(terminateRecordedGroup({ hookPgid: foreign.pgid, hookStart: "proc:another-run" }, 2000), "foreign");
  assert.equal(groupAlive(foreign.pgid), true);
});

test("a recorded hook group whose leader exited is never signalled: unverified, its members untouched", async (t) => {
  // The stale-record case: the recorded id now names a leaderless group, whatever its history.
  const leaderless = await testGroup(t, { leaderStays: false });
  for (const hookStart of [leaderless.leaderStart, "proc:another-run"]) {
    assert.equal(terminateRecordedGroup({ hookPgid: leaderless.pgid, hookStart }, 2000), "unverified");
    assert.equal(groupAlive(leaderless.pgid), true, "no member was signalled");
  }
  assert.equal(terminateRecordedGroup({ hookPgid: 2147483646, hookStart: "proc:x" }), "none");
});
