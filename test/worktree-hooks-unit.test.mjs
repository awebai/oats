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

test("the purpose claim: taken over from a dead holder (and from a dead takeover), waited for and refused while its holder lives, never removed when unreadable", async (t) => {
  const { withClaim } = await import("../lib/worktree.mjs");
  const { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "oats-claim-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lock = join(dir, "p.lock");
  const busy = (holder) => Object.assign(new Error(`busy ${holder?.pid ?? "?"}`), { code: "E_LIFECYCLE_BUSY" });
  const dead = (nonce) => JSON.stringify({ pid: 2147483646, processStart: "proc:gone", nonce });
  const N1 = "a".repeat(32), N2 = "b".repeat(32);

  assert.equal(await withClaim(lock, () => JSON.parse(readFileSync(lock, "utf8")).pid, { busy }), process.pid, "held while fn runs");
  assert.equal(existsSync(lock), false, "released");

  writeFileSync(lock, dead(N1));
  assert.equal(await withClaim(lock, () => "ran", { busy }), "ran", "a dead holder's claim is taken over");
  // A takeover that was itself killed: its own claim is taken over in turn.
  writeFileSync(lock, dead(N1));
  writeFileSync(`${lock}.reclaim-${N1}`, dead(N2));
  assert.equal(await withClaim(lock, () => "ran", { busy }), "ran");
  assert.deepEqual(readdirSync(dir), [], "nothing left behind");

  // A live holder (this process, under another holding): waited for, then refused.
  writeFileSync(lock, JSON.stringify({ ...selfIdentity(), nonce: N2 }));
  const t0 = Date.now();
  await assert.rejects(withClaim(lock, () => "ran", { busy, waitMs: 300 }), (e) => e.code === "E_LIFECYCLE_BUSY" && e.message === `busy ${process.pid}`);
  assert.ok(Date.now() - t0 >= 300, "it waited");
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).nonce, N2, "a live holder's claim is untouched");

  writeFileSync(lock, "{not json");
  await assert.rejects(withClaim(lock, () => "ran", { busy }), (e) => e.code === "E_LIFECYCLE_BUSY" && /not a readable claim/.test(e.message));
  assert.equal(readFileSync(lock, "utf8"), "{not json", "an unreadable claim is never removed");
});

test("a timed-out git step: its whole group, a SIGTERM-ignoring member without pipes included, is ended before its identity is cleared", async (t) => {
  const { trackedGit } = await import("../lib/worktree.mjs");
  const { mkdtempSync, readFileSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "oats-tracked-git-"));
  const memberFile = join(dir, "member");
  // A `git` that leaves a member ignoring SIGTERM, holding no pipe, then waits to be ended.
  writeFileSync(join(dir, "git"), `#!/bin/sh\n(trap '' TERM; exec sleep 60) </dev/null >/dev/null 2>&1 &\necho $! > ${JSON.stringify(memberFile)}\nexec sleep 60\n`, { mode: 0o755 });
  const hostPath = process.env.PATH;
  process.env.PATH = `${dir}:${hostPath}`;
  let member = null;
  t.after(() => { process.env.PATH = hostPath; if (member) { try { process.kill(member, "SIGKILL"); } catch { /* gone */ } } rmSync(dir, { recursive: true, force: true }); });
  const calls = [];
  const r = await trackedGit(["status"], { track: (g) => calls.push(g), timeout: 500 });
  member = Number(readFileSync(memberFile, "utf8"));
  const memberAlive = (() => { try { process.kill(member, 0); return true; } catch { return false; } })();
  assert.equal(memberAlive, false, "the member is gone when the step answers");
  assert.equal(r.ok, false);
  assert.match(r.err, /timed out/);
  assert.equal(typeof calls[0]?.gitPid, "number", "the step was recorded before it ran");
  assert.equal(calls.at(-1), null, "and cleared only after its group was gone");
});

// ---------- the `ps` path of a start time (macOS has no /proc): OATS_TEST_PROCESS_START_PS=1 ----------

const HOOKS_MODULE = new URL("../lib/worktree-hooks.mjs", import.meta.url).href;
const WORKTREE_MODULE = new URL("../lib/worktree.mjs", import.meta.url).href;
/** Run `code` (an ES module body) in a child with `env` on top of this process's; → its stdout, trimmed. */
async function inChild(code, env) {
  const c = spawn(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  c.stdout.on("data", (b) => { out += b; }); c.stderr.on("data", (b) => { err += b; });
  const status = await new Promise((r) => c.on("close", r));
  assert.equal(status, 0, err);
  return out.trim();
}
/** The reader environments a macOS `ps -o lstart=` answered four different ways for one pid (a
 *  maintainer's run): two time zones, the C locale and a German one. */
const READERS = [{ TZ: "UTC" }, { TZ: "Asia/Tokyo" }, { LC_ALL: "C" }, { LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8" }];
const ZONES = [{ TZ: "Pacific/Kiritimati", LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8" }, { TZ: "America/Los_Angeles", LANG: "C", LC_ALL: "C" }];

test("the ps start token of one process is the same whatever the reader's TZ and locale", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const target = spawn("sleep", ["30"], { stdio: "ignore" });
  t.after(() => { try { target.kill("SIGKILL"); } catch { /* gone */ } });
  // The environment does matter to `ps` itself: the same process reads differently by reader.
  const raw = READERS.map((z) => spawnSync("ps", ["-o", "lstart=", "-p", String(target.pid)], { encoding: "utf8", env: { PATH: process.env.PATH, ...z } }).stdout.trim());
  assert.ok(new Set(raw).size > 1, `this host's ps answers in the reader's environment: ${JSON.stringify(raw)}`);
  // The kernel's token does not: its `ps` gets only PATH, LC_ALL=C and TZ=UTC, whatever its caller has.
  const tokens = [];
  for (const z of READERS) tokens.push(await inChild(`const { processStartToken } = await import(${JSON.stringify(HOOKS_MODULE)}); console.log(processStartToken(${target.pid}));`, { OATS_TEST_PROCESS_START_PS: "1", ...z }));
  assert.match(tokens[0], /^ps:/, "the ps path was taken");
  assert.deepEqual(new Set(tokens), new Set([tokens[0]]), `one process, one token: ${JSON.stringify(tokens)}`);
});

test("a live claim holder is not taken over by a reader in another TZ and locale (ps path)", async (t) => {
  const { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "oats-claim-tz-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lock = join(dir, "p.lock"), heldFile = join(dir, "held"), release = join(dir, "release");
  const busy = `(holder, unknown) => Object.assign(new Error("busy " + (unknown ?? "live")), { code: "E_LIFECYCLE_BUSY" })`;
  // The holder takes the claim in one zone and keeps it until released.
  const holder = spawn(process.execPath, ["--input-type=module", "-e", `const { withClaim } = await import(${JSON.stringify(WORKTREE_MODULE)});
const { existsSync, writeFileSync } = await import("node:fs");
await withClaim(${JSON.stringify(lock)}, async () => { writeFileSync(${JSON.stringify(heldFile)}, ""); while (!existsSync(${JSON.stringify(release)})) await new Promise((r) => setTimeout(r, 20)); }, { busy: ${busy} });`],
  { env: { ...process.env, OATS_TEST_PROCESS_START_PS: "1", ...ZONES[0] }, stdio: "ignore" });
  t.after(() => { try { holder.kill("SIGKILL"); } catch { /* gone */ } });
  for (let i = 0; i < 400 && !existsSync(heldFile); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(existsSync(heldFile), "the holder holds the claim");
  const held = readFileSync(lock, "utf8");
  // A taker in another zone reads the holder as alive: it waits, then is refused; it never takes over.
  const answer = await inChild(`const { withClaim } = await import(${JSON.stringify(WORKTREE_MODULE)});
try { await withClaim(${JSON.stringify(lock)}, () => "took", { busy: ${busy}, waitMs: 300 }); console.log("took"); } catch (e) { console.log(e.code + " " + e.message); }`,
  { OATS_TEST_PROCESS_START_PS: "1", ...ZONES[1] });
  assert.equal(answer, "E_LIFECYCLE_BUSY busy live");
  assert.equal(readFileSync(lock, "utf8"), held, "the live holder's claim is untouched");
  writeFileSync(release, "");
  await new Promise((r) => holder.on("close", r));
});

test("a start that cannot be read is unknown, never gone: liveness says so, and its group is not signalled", async (t) => {
  const { processLiveness, processStart } = await import("../lib/worktree-hooks.mjs");
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const own = await testGroup(t, { leaderStays: true });
  const dir = mkdtempSync(join(tmpdir(), "oats-ps-stub-"));
  const realPs = execFileSync("sh", ["-c", "command -v ps"], { encoding: "utf8" }).trim();
  writeFileSync(join(dir, "ps"), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "${own.pgid}" ] && { echo "ps: simulated failure" >&2; exit 2; }; done\nexec ${JSON.stringify(realPs)} "$@"\n`, { mode: 0o755 });
  const saved = { PATH: process.env.PATH, seam: process.env.OATS_TEST_PROCESS_START_PS };
  process.env.PATH = `${dir}:${saved.PATH}`; process.env.OATS_TEST_PROCESS_START_PS = "1";
  t.after(() => { process.env.PATH = saved.PATH; if (saved.seam === undefined) delete process.env.OATS_TEST_PROCESS_START_PS; else process.env.OATS_TEST_PROCESS_START_PS = saved.seam; rmSync(dir, { recursive: true, force: true }); });
  assert.equal(processStart(own.pgid).state, "unknown");
  assert.equal(processStart(2147483646).state, "gone", "ps's own 'no such process' is gone");
  assert.equal(processLiveness({ pid: own.pgid, processStart: own.leaderStart }).state, "unknown");
  assert.equal(terminateRecordedGroup({ hookPgid: own.pgid, hookStart: own.leaderStart }, 500), "unverified");
  assert.equal(groupAlive(own.pgid), true, "not signalled");
});
