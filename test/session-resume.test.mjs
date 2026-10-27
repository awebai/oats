// Session resume (#1559), the parts that need no tmux: the exit marker in both forms, how a home's
// last session ended (sessionEnd), the resume selectors renderLaunchRecipe renders, the refusals of
// `session start --resume` before anything is read, and the sweep's machine lock, per-boot note and
// row mapping. The real-tmux sweep is test/session-resume-tmux.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeLaunchCommand, parseLaunchCommand, renderLaunchCommand, renderLaunchRecipe, RESUME_NOTICE, startInstanceSession } from "../lib/core.mjs";
import { readStartExited, sessionEndOf } from "../lib/session-end.mjs";
import { acquireResumeLock, bootId, noteSweep, readBootNote, resumeSessions, resumeStateDir, rowFromStart } from "../lib/session-resume.mjs";

const scratch = (t) => { const d = mkdtempSync(join(tmpdir(), "oats-resume-")); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const write = (home, name, value) => writeFileSync(join(home, name), typeof value === "string" ? value : JSON.stringify(value));
/** OATS_HOME_DIR on a scratch directory for the length of one test. */
function oatsHome(t) {
  const dir = scratch(t), saved = process.env.OATS_HOME_DIR;
  process.env.OATS_HOME_DIR = dir;
  t.after(() => { if (saved === undefined) delete process.env.OATS_HOME_DIR; else process.env.OATS_HOME_DIR = saved; });
  return dir;
}

test("the exit marker reads in both forms: the legacy start id on one line, and {startId, status}", (t) => {
  const home = scratch(t);
  assert.equal(readStartExited(home), null, "no marker");
  write(home, ".oats-start-exited", "abc-123\n");
  assert.deepEqual(readStartExited(home), { startId: "abc-123", status: null });
  write(home, ".oats-start-exited", '{"startId":"abc-123","status":0}\n');
  assert.deepEqual(readStartExited(home), { startId: "abc-123", status: 0 });
  write(home, ".oats-start-exited", '{"startId":"abc-123","status":137}\n');
  assert.deepEqual(readStartExited(home), { startId: "abc-123", status: 137 });
  for (const junk of ["", "two words\n", "{not json", '{"status":0}', '["abc"]']) {
    write(home, ".oats-start-exited", junk);
    assert.equal(readStartExited(home), null, JSON.stringify(junk));
  }
});

test("sessionEnd: the full table, legacy forms included", (t) => {
  const created = "2026-10-01T10:00:00.000Z", restarted = "2026-10-02T10:00:00.000Z";
  const meta = { startId: "s2", createdAt: created, restarts: [{ startedAt: restarted }] };
  const before = "2026-10-01T12:00:00.000Z", after = "2026-10-02T12:00:00.000Z";
  const rows = [
    ["a stop that names this start", { stop: { at: before, startId: "s2" } }, "stopped"],
    ["a stop that names this start, beside its 143", { stop: { at: after, startId: "s2" }, exited: { startId: "s2", status: 143 } }, "stopped"],
    ["a stop of an earlier start, the harness then ended on its own", { stop: { at: after, startId: "s1" }, exited: { startId: "s2", status: 0 } }, "exited"],
    ["a stop of an earlier start, nothing else", { stop: { at: after, startId: "s1" } }, "lost"],
    ["a stop receipt without a start id, after this start", { stop: { at: after } }, "stopped"],
    ["a stop receipt without a start id, before this start", { stop: { at: before } }, "lost"],
    ["a stop receipt whose start id is null, after this start", { stop: { at: after, startId: null } }, "stopped"],
    ["exit status 0 (/exit)", { exited: { startId: "s2", status: 0 } }, "exited"],
    ["exit status 1 (its own error)", { exited: { startId: "s2", status: 1 } }, "exited"],
    ["exit status 127", { exited: { startId: "s2", status: 127 } }, "exited"],
    ["exit status 128", { exited: { startId: "s2", status: 128 } }, "lost"],
    ["killed (137, an OOM kill of the harness alone)", { exited: { startId: "s2", status: 137 } }, "lost"],
    ["143 with no stop", { exited: { startId: "s2", status: 143 } }, "lost"],
    ["a marker of an earlier start", { exited: { startId: "s1", status: 0 } }, "lost"],
    ["the legacy marker naming this start", { exited: "s2\n" }, "exited"],
    ["the legacy marker naming an earlier start", { exited: "s1\n" }, "lost"],
    ["neither file", {}, "lost"],
  ];
  for (const [what, files, want] of rows) {
    const home = scratch(t);
    if (files.stop) write(home, ".oats-stop.json", { instance: "x", stop: {}, retained: [], ...files.stop });
    if (files.exited) write(home, ".oats-start-exited", files.exited);
    assert.equal(sessionEndOf(home, meta), want, what);
  }
  // A home that records no start id (spawned before 0.69, never restarted): only a stop after its
  // createdAt names it; a legacy marker cannot.
  const legacy = { createdAt: created };
  for (const [what, files, want] of [
    ["no start id, no stop", { exited: "whatever\n" }, "lost"],
    ["no start id, a stop after createdAt", { stop: { at: before } }, "stopped"],
    ["no start id, a stop before createdAt", { stop: { at: "2026-09-30T00:00:00.000Z" } }, "lost"],
    ["no start id, a stop that names a start", { stop: { at: before, startId: "s0" } }, "lost"],
  ]) {
    const home = scratch(t);
    if (files.stop) write(home, ".oats-stop.json", { instance: "x", ...files.stop });
    if (files.exited) write(home, ".oats-start-exited", files.exited);
    assert.equal(sessionEndOf(home, legacy), want, what);
  }
  // The current start's time is the last restart's, else createdAt.
  const spawned = scratch(t);
  write(spawned, ".oats-stop.json", { at: before });
  assert.equal(sessionEndOf(spawned, { startId: "s1", createdAt: created }), "stopped", "after createdAt, no restart");
  assert.equal(sessionEndOf(spawned, { startId: "s2", createdAt: created, restarts: [{ startedAt: restarted }] }), "lost", "before the last restart");
});

test("renderLaunchRecipe: the resume selectors, byte for byte, `--` included; Codex has none", () => {
  const hooks = { launch: { claude: "--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace", pi: "--extension '/x/ext.ts'" }, env: { AWEB_DELIVERY: "channel" }, contributions: [] };
  const recipe = (harness) => ({ harness, executable: `/x/${harness}`, args: ["--setting", "a b"], env: { TOKEN: { fromEnv: "SRC" } }, model: "m-1", yolo: true, hooks });
  const resume = { sessionId: "0f8b6a2e-1111-4222-8333-944445555666", prompt: RESUME_NOTICE };
  assert.equal(RESUME_NOTICE, "OATS resumed this session after it was lost (the host restarted or its terminal server ended). Continue from where you were.");
  const env = `OATS_INSTANCE='n' OATS_INSTANCE_HOME='/h' AWEB_DELIVERY='channel' TOKEN="$OATS_LAUNCH_REF_TOKEN"`;
  const claude = renderLaunchRecipe(recipe("claude"), { home: "/h", instance: "n", resume });
  assert.equal(claude, `${env} '/x/claude' --dangerously-skip-permissions --model 'm-1' --resume '${resume.sessionId}' '--setting' 'a b' --dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace -- '${RESUME_NOTICE}'`);
  assert.equal(renderLaunchRecipe(recipe("claude"), { home: "/h", instance: "n" }), `${env} '/x/claude' --dangerously-skip-permissions --model 'm-1' '--setting' 'a b' --dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace -- '@TASK.md'`, "the ordinary rendering is unchanged");
  const pi = renderLaunchRecipe(recipe("pi"), { home: "/h", instance: "n", resume });
  assert.equal(pi, `${env} '/x/pi' --append-system-prompt '/h/AGENTS.md' --approve --name 'n' --model 'm-1' --session '${resume.sessionId}' '${RESUME_NOTICE}' '--setting' 'a b' --extension '/x/ext.ts'`);
  assert.equal(renderLaunchRecipe(recipe("pi"), { home: "/h", instance: "n" }), `${env} '/x/pi' --append-system-prompt '/h/AGENTS.md' --approve --name 'n' --model 'm-1' '@TASK.md' '--setting' 'a b' --extension '/x/ext.ts'`);
  // The notice is the last argument after `--` for Claude, the positional where @TASK.md stands for pi.
  const argv = (cmd) => describeLaunchCommand(cmd).argv;
  assert.deepEqual(argv(claude).slice(-2), ["--", RESUME_NOTICE]);
  assert.equal(argv(pi)[argv(pi).indexOf("--session") + 2], RESUME_NOTICE);
  for (const cmd of [claude, pi]) assert.equal(renderLaunchCommand(parseLaunchCommand(cmd).tokens), cmd, "the kernel's own parser round-trips it");
  assert.throws(() => renderLaunchRecipe(recipe("codex"), { home: "/h", instance: "n", resume }), /codex has no resume rendering/);
});

test("session start --resume with a launch choice, or as a restart, is refused before anything is read", () => {
  const home = "/nonexistent/oats-resume/home"; // a read would refuse otherwise (no instance.json)
  for (const [o, flag] of [[{ launchConfig: "x" }, "--launch-config"], [{ harness: "pi" }, "--harness"], [{ model: "m" }, "--model"], [{ yolo: true }, "--yolo"], [{ yolo: false }, "--no-yolo"], [{ reselectLaunch: true }, "--reselect-launch"]]) {
    assert.throws(() => startInstanceSession(home, { resume: true, ...o }), (e) => e.code === "E_BAD_ARGS" && e.message.includes(flag) && /nothing was read or started/.test(e.message), flag);
  }
  assert.throws(() => startInstanceSession(home, { resume: true, restart: true }), (e) => e.code === "E_BAD_ARGS");
});

test("bootId: Linux's boot id, macOS's boot time, else none", () => {
  assert.equal(bootId({ platform: "linux", read: () => "0f8b6a2e-1111\n" }), "0f8b6a2e-1111");
  assert.equal(bootId({ platform: "darwin", sysctl: () => "{ sec = 1761555000, usec = 123456 } Mon Oct 27 08:50:00 2026\n" }), "1761555000.123456");
  assert.equal(bootId({ platform: "win32" }), null);
  assert.equal(bootId({ platform: "linux", read: () => { throw new Error("EACCES"); } }), null);
});

test("the machine lock: one sweep at a time; a dead owner's lock, or another boot's, is taken over", (t) => {
  oatsHome(t);
  const lock = join(resumeStateDir(), "lock");
  const release = acquireResumeLock({ boot: "boot-1" });
  assert.equal(JSON.parse(readFileSync(join(lock, "owner.json"), "utf8")).pid, process.pid);
  assert.throws(() => acquireResumeLock({ boot: "boot-1" }), (e) => e.code === "E_RESUME_BUSY" && e.message.includes(`pid ${process.pid}`));
  release();
  assert.equal(existsSync(lock), false, "released");
  // A dead pid: stale.
  mkdirSync(lock); writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: 2 ** 22 + 12345, bootId: "boot-1" }));
  acquireResumeLock({ boot: "boot-1" })();
  // A live pid, recorded in another boot: stale (the pid is someone else's now).
  mkdirSync(lock); writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.ppid, bootId: "boot-0" }));
  acquireResumeLock({ boot: "boot-1" })();
  // A live pid in this boot: busy.
  mkdirSync(lock); writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.ppid, bootId: "boot-1" }));
  assert.throws(() => acquireResumeLock({ boot: "boot-1" }), (e) => e.code === "E_RESUME_BUSY");
  // No owner yet: an acquirer's own for the grace, a crashed one's after it.
  rmSync(lock, { recursive: true }); mkdirSync(lock);
  assert.throws(() => acquireResumeLock({ boot: "boot-1" }), (e) => e.code === "E_RESUME_BUSY");
  const old = new Date(Date.now() - 120_000); utimesSync(lock, old, old);
  acquireResumeLock({ boot: "boot-1" })();
});

test("the per-boot note: refusals and each home's count of sweep starts, replaced in another boot, nothing kept without a boot id", (t) => {
  oatsHome(t);
  const a = { home: "/d/agents/s/instances/a", startId: "s1", code: "E_LAUNCH_ENV_MISSING", message: "m", at: "2026-10-27T10:00:00.000Z" };
  const b = "/d/agents/s/instances/b";
  noteSweep({ refusals: [a], launched: [b] }, "boot-1");
  assert.deepEqual(readBootNote("boot-1"), { bootId: "boot-1", refused: [a], resumes: { [b]: 1 } });
  assert.deepEqual(readBootNote("boot-2"), { bootId: "boot-2", refused: [], resumes: {} }, "another boot's note is no note");
  noteSweep({ refusals: [{ ...a, startId: "s2" }], launched: [b] }, "boot-1");
  noteSweep({ launched: [b, a.home] }, "boot-1");
  const note = readBootNote("boot-1");
  assert.deepEqual(note.refused.map((r) => r.startId), ["s2"], "a home's refusal is replaced");
  assert.deepEqual(note.resumes, { [b]: 3, [a.home]: 1 }, "each launch counts once more, by home");
  noteSweep({ launched: [b] }, "boot-2");
  assert.deepEqual(readBootNote("boot-2"), { bootId: "boot-2", refused: [], resumes: { [b]: 1 } }, "another boot's note is replaced whole");
  rmSync(resumeStateDir(), { recursive: true });
  noteSweep({ refusals: [a], launched: [b] }, null);
  assert.equal(existsSync(resumeStateDir()), false, "no boot id: nothing written");
});

test("--plan takes no lock and writes no note", async (t) => {
  oatsHome(t);
  const answer = await resumeSessions({ plan: true, boot: "boot-1", kernel: { execPath: process.execPath, bin: "/nonexistent" } });
  assert.deepEqual(answer, { schemaVersion: 1, plan: true, deployments: [], rows: [] });
  assert.equal(existsSync(resumeStateDir()), false);
  const held = acquireResumeLock({ boot: "boot-1" });
  t.after(held);
  assert.deepEqual((await resumeSessions({ plan: true, boot: "boot-1", kernel: {} })).rows, [], "a held lock does not stop a plan");
  await assert.rejects(resumeSessions({ boot: "boot-1", kernel: {} }), (e) => e.code === "E_RESUME_BUSY");
});

test("a start's answer maps to the sweep's row", () => {
  const row = { deployment: "/d", instance: "a", home: "/d/agents/s/instances/a", startId: "s1" };
  const id = { deployment: "/d", instance: "a", home: row.home };
  const ok = (result) => rowFromStart(row, { ok: true, result });
  const fail = (code, details) => rowFromStart(row, { ok: false, error: { code, message: `${code} message`, ...(details ? { details } : {}) } });
  assert.deepEqual(ok({ resume: { resumed: true, harness: "claude", sessionId: "x" }, warnings: [] }), { ...id, outcome: "resumed", sessionId: "x" });
  assert.deepEqual(ok({ resume: { resumed: true, harness: "claude", sessionId: "x" }, warnings: ["w channel-cache-unchecked"] }), { ...id, outcome: "resumed", sessionId: "x", warnings: ["w channel-cache-unchecked"] });
  assert.deepEqual(ok({ resume: { resumed: true, harness: "claude", sessionId: "x", waiting: "resume-confirmation" } }), { ...id, outcome: "blocked", reason: "resume-confirmation", sessionId: "x" });
  for (const reason of ["no-conversation", "no-receipts", "resume-unproven"]) assert.deepEqual(ok({ resume: { resumed: false, reason, harness: "pi" } }), { ...id, outcome: "fresh", reason });
  assert.deepEqual(fail("E_SPAWN_INCOMPLETE", { launchPrompts: { status: "blocked" } }), { ...id, outcome: "blocked", reason: "launch-prompt", code: "E_SPAWN_INCOMPLETE", launchPrompts: { status: "blocked" } });
  assert.deepEqual(fail("E_SESSION_START_BUSY"), { ...id, outcome: "skipped", reason: "start-busy", code: "E_SESSION_START_BUSY" });
  assert.deepEqual(fail("E_RESUME_NOT_LOST"), { ...id, outcome: "skipped", reason: "not-lost", code: "E_RESUME_NOT_LOST" });
  assert.deepEqual(fail("E_SESSION_RUNNING"), { ...id, outcome: "skipped", reason: "not-lost", code: "E_SESSION_RUNNING" });
  assert.deepEqual(fail("E_LAUNCH_LEGACY"), { ...id, outcome: "refused", reason: "start-refused", code: "E_LAUNCH_LEGACY", message: "E_LAUNCH_LEGACY message" });
  assert.equal(rowFromStart(row, undefined).code, "E_SESSION_START_FAILED", "no answer");
});
