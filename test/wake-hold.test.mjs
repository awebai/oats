// A wake holds while a dialog is open (feature wake-hold, awebai/oats#1670): the read that decides
// (waitingHold), the tick's record of a hold across ticks, and that no key goes during one. The
// session is the tick's own seam here (`io.inspect`, `io.input`); the real tmux walk of a hold, with
// real bytes, is in schedule-session.
import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deploymentsImported } from "./helpers/host-fixture.mjs";
import { eventsData } from "../packages/desktop/renderer/instance-events-data.mjs";

const base = realpathSync(mkdtempSync(join(tmpdir(), "o-wh-")));
process.env.OATS_HOME_DIR = deploymentsImported(join(base, "h"));
delete process.env.OATS_INSTANCE; delete process.env.OATS_INSTANCE_HOME; delete process.env.PI_AGENTS_ROOT;
const S = await import("../lib/schedule.mjs");
const { appendEvent, liveWaiting, readEvents, recordStartBoundary, setWaiting, waitingHold } = await import("../lib/instance-events.mjs");
const { retirePendingMarkerPath } = await import("../lib/core.mjs");
test.after(() => rmSync(base, { recursive: true, force: true }));

const BIRTH = "2026-01-01T00:00:00.000Z";
const at = (iso) => new Date(iso);
let n = 0;
/** A deployment with one home in it: a real scope for the tick, and the two logs the read merges. */
function deployment() {
  const ws = join(base, `ws-${++n}`), home = join(ws, "agents", "dev", "instances", "dev-1");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(ws, "oats-local.yaml"), "schemaVersion: 2\nworkspace: example.invalid/acme/workspace\n");
  writeFileSync(join(home, "instance.json"), JSON.stringify({ agent: "dev", instance: "dev-1", home, createdAt: BIRTH }));
  return { ws, home, homeLog: join(home, ".oats-events.jsonl"), wsLog: join(ws, ".agents", "events", "dev--dev-1.jsonl") };
}
const row = (d, kind, extra = {}) => JSON.stringify({ eventsApi: 2, at: new Date().toISOString(), instance: "dev-1", home: d.home, incarnation: BIRTH, producer: "kernel", kind, ...extra }) + "\n";
const boundary = (d, id = "s1") => recordStartBoundary(d.home, { startId: id, startedAt: new Date().toISOString(), harness: "claude", backend: "tmux", launchConfig: null, phase: "start" });
const claim = (d, reason, producer = "oats.core", message) => setWaiting(d.home, { producer, waiting: true, reason, ...(message ? { message } : {}) });
/** Rows of a kernel kind past MAX_BYTES, so a read returns only the log's tail. */
function pastTheBound(d, path) {
  const line = row(d, "launch-warning", { data: { message: "x".repeat(1000) } });
  mkdirSync(join(path, ".."), { recursive: true });
  appendFileSync(path, line.repeat(Math.ceil(4.1 * 1024 * 1024 / line.length)));
}
const CLAIM = (reason, producer = "oats.core") => ({ claimReason: reason, producer });
const unreadable = (pattern) => (hold) => { assert.deepEqual([hold?.claimReason, hold?.producer], [null, null]); assert.match(hold.unreadable, pattern); assert.ok(hold.unreadable.length < 80, "short: it goes in an event"); };

// ---- the read: every row of the spec's table ----

test("the release lane's case: an `agent` attention claim with text plus an oats.core permission claim with no text holds", () => {
  const d = deployment();
  boundary(d);
  claim(d, "permission");
  claim(d, "attention", "agent", "need the npm token");
  assert.equal(liveWaiting(d.home).reason, "attention", "the summary does show attention: reading it would press Enter");
  assert.deepEqual(waitingHold(d.home), CLAIM("permission"));
});

test("a hold reads permission, question and a null reason from any producer, the newest if several; attention alone is no hold", () => {
  const d = deployment();
  boundary(d);
  assert.equal(waitingHold(d.home), null, "no claim");
  claim(d, "attention", "agent", "over to you");
  assert.equal(waitingHold(d.home), null, "only attention: this home gets its wake");
  claim(d, "permission", "some.producer");
  assert.deepEqual(waitingHold(d.home), CLAIM("permission", "some.producer"));
  claim(d, "question");
  assert.deepEqual(waitingHold(d.home), CLAIM("question"), "the newest");
  setWaiting(d.home, { producer: "oats.core", waiting: false });
  assert.deepEqual(waitingHold(d.home), CLAIM("permission", "some.producer"), "the other claim still holds");
  setWaiting(d.home, { producer: "some.producer", waiting: false });
  assert.equal(waitingHold(d.home), null);
});

test("a stored reason outside the closed set, or none, is a claim that can't be read: it holds", () => {
  for (const data of [{ waitingOnYou: true, reason: "dialog" }, { waitingOnYou: true }]) {
    const d = deployment();
    boundary(d);
    appendFileSync(d.homeLog, row(d, "waiting", { producer: "hand.edited", data }));
    assert.deepEqual(waitingHold(d.home), CLAIM(null, "hand.edited"));
  }
});

test("a kernel session boundary voids a claim, and an earlier incarnation's claim is none", () => {
  for (const kind of ["launched", "restarted", "stopped"]) {
    const d = deployment();
    boundary(d);
    claim(d, "permission");
    assert.deepEqual(waitingHold(d.home), CLAIM("permission"));
    appendFileSync(d.homeLog, row(d, kind));
    assert.equal(waitingHold(d.home), null, kind);
  }
  const d = deployment();
  boundary(d);
  appendFileSync(d.homeLog, row(d, "waiting", { incarnation: "2025-01-01T00:00:00.000Z", producer: "oats.core", data: { waitingOnYou: true, reason: "question" } }));
  assert.equal(waitingHold(d.home), null);
});

test("the two logs are merged: a claim in either holds, and an absent log is an answer", () => {
  const onlyHome = deployment();
  appendFileSync(onlyHome.homeLog, row(onlyHome, "waiting", { producer: "oats.core", data: { waitingOnYou: true, reason: "permission" } }));
  assert.equal(existsSync(onlyHome.wsLog), false);
  assert.deepEqual(waitingHold(onlyHome.home), CLAIM("permission"));
  const onlyWorkspace = deployment();
  mkdirSync(join(onlyWorkspace.wsLog, ".."), { recursive: true });
  appendFileSync(onlyWorkspace.wsLog, row(onlyWorkspace, "waiting", { producer: "oats.core", data: { waitingOnYou: true, reason: "question" } }));
  assert.equal(existsSync(onlyWorkspace.homeLog), false);
  assert.deepEqual(waitingHold(onlyWorkspace.home), CLAIM("question"));
  assert.equal(waitingHold(deployment().home), null, "both absent: no hold");
});

test("an unknown incarnation is unreadable", () => {
  const d = deployment();
  boundary(d);
  claim(d, "attention", "agent", "not the point");
  writeFileSync(join(d.home, "instance.json"), "{ not json");
  unreadable(/instance\.json/)(waitingHold(d.home));
  writeFileSync(join(d.home, "instance.json"), JSON.stringify({ agent: "dev", instance: "dev-1" }));
  unreadable(/instance\.json/)(waitingHold(d.home));
  rmSync(join(d.home, "instance.json"));
  unreadable(/instance\.json/)(waitingHold(d.home));
});

test("a log that is refused is unreadable, whichever log it is", () => {
  const link = deployment();
  boundary(link);
  rmSync(link.homeLog);
  symlinkSync(link.wsLog, link.homeLog);
  unreadable(/home events log was refused/)(waitingHold(link.home));
  const dir = deployment();
  boundary(dir);
  rmSync(dir.wsLog);
  mkdirSync(dir.wsLog);
  unreadable(/workspace events log was refused/)(waitingHold(dir.home));
});

test("a tail with no kernel session boundary of this incarnation is unreadable, a real log past 4 MiB", () => {
  for (const log of ["homeLog", "wsLog"]) {
    const d = deployment();
    boundary(d);
    pastTheBound(d, d[log]);
    assert.ok(readEvents(d.home).integrity.sources.some((s) => s.status === "tail"), "the read returns only the tail");
    unreadable(/tail holds no session boundary/)(waitingHold(d.home));
  }
  const other = deployment();
  pastTheBound(other, other.homeLog);
  appendFileSync(other.homeLog, row(other, "launched", { incarnation: "2025-01-01T00:00:00.000Z" }));
  unreadable(/tail holds no session boundary/)(waitingHold(other.home));
  const foreign = deployment();
  pastTheBound(foreign, foreign.homeLog);
  appendFileSync(foreign.homeLog, row(foreign, "launched", { home: "/elsewhere/dev-1" }));
  unreadable(/tail holds no session boundary/)(waitingHold(foreign.home));
  const notKernel = deployment();
  pastTheBound(notKernel, notKernel.homeLog);
  appendFileSync(notKernel.homeLog, row(notKernel, "launched", { producer: "some.producer" }));
  unreadable(/tail holds no session boundary/)(waitingHold(notKernel.home));
});

test("a tail that holds the boundary is fine: everything before it is void, or a log past 4 MiB would hold for good", () => {
  const d = deployment();
  claim(d, "permission");
  pastTheBound(d, d.homeLog);
  pastTheBound(d, d.wsLog);
  boundary(d);
  assert.ok(readEvents(d.home).integrity.sources.every((s) => s.status === "tail"));
  assert.equal(waitingHold(d.home), null);
  claim(d, "question");
  assert.deepEqual(waitingHold(d.home), CLAIM("question"), "a claim after the boundary still holds");
});

test("a torn row after a log's last boundary is unreadable, anywhere when it has none; before the boundary it is fine", () => {
  for (const log of ["homeLog", "wsLog"]) {
    const after = deployment();
    boundary(after);
    appendFileSync(after[log], '{"eventsApi":2,"kind":"waiting","at":"torn\n');
    appendFileSync(after[log], row(after, "launch-warning"));
    unreadable(/torn row in this session/)(waitingHold(after.home));
    const before = deployment();
    mkdirSync(join(before[log], ".."), { recursive: true });
    appendFileSync(before[log], "not a row\n");
    boundary(before);
    assert.equal(waitingHold(before.home), null, "an ended session's row can't hold this one");
    assert.equal(readEvents(before.home).integrity.unreadableRows, 1, "the read's own count is what it was");
  }
  const none = deployment();
  appendFileSync(none.homeLog, "not a row\n");
  appendFileSync(none.homeLog, row(none, "launch-warning"));
  unreadable(/torn row in this session/)(waitingHold(none.home));
  const shape = deployment();
  boundary(shape);
  appendFileSync(shape.homeLog, '{"kind":"waiting"}\n');
  unreadable(/torn row in this session/)(waitingHold(shape.home));
});

// ---- the tick ----

/** A wake job at the home, and the session as the tick sees it. */
function job(d, { cron = "*/5 * * * *" } = {}) {
  const inputs = [];
  const session = { state: { present: true, state: "unknown" } };
  const io = { inspect: () => session.state, input: (home, text) => { inputs.push(text); return { submitted: true }; }, start: () => { session.state = { present: true, state: "unknown" }; return { instance: "dev-1", target: { backend: "tmux" } }; } };
  S.addSchedule(d.ws, { id: "w", cron, tz: "UTC", kind: "wake", home: d.home, message: "hello" });
  const reg = S.readRegistry();
  const tick = (iso) => S.tickWorkspace(d.ws, { now: at(iso), io, reg })[0];
  const shown = () => S.describe(d.ws, "w", io);
  return { inputs, session, io, tick, shown };
}
const heldRows = (d) => readEvents(d.home).events.filter((r) => r.kind === "wake-held");
const rowsIn = (path) => (existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);

test("across ticks: the first skip, the same since with exactly one wake-held row, then it delivers once and no hold is left on the record", () => {
  const d = deployment();
  boundary(d);
  claim(d, "permission");
  const j = job(d);

  const first = j.tick("2026-09-07T10:00:00Z");
  const since = "2026-09-07T10:00:00.000Z";
  assert.deepEqual(first, { workspace: d.ws, id: "w", minute: "2026-09-07T10:00", action: "skipped", reason: "waiting-on-you", pending: true, held: { since, claimReason: "permission", producer: "oats.core" } });
  assert.deepEqual(j.inputs, [], "no key");
  let row1 = j.shown();
  assert.deepEqual([row1.lastRun.outcome, row1.lastRun.reason, row1.lastRun.pending], ["skipped", "waiting-on-you", true]);
  assert.deepEqual(row1.lastRun.held, { since, claimReason: "permission", producer: "oats.core" });
  assert.equal(row1.pendingWake.heldSince, since);
  assert.equal(S.jobLockInfo(d.ws, "w"), null, "a hold takes no slot");
  const rows = heldRows(d);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].producer, rows[0].data], ["kernel", { schedule: "w", since, claimReason: "permission", producer: "oats.core" }]);
  assert.equal(rowsIn(d.homeLog).filter((r) => r.kind === "wake-held").length, 1);
  assert.equal(rowsIn(d.wsLog).filter((r) => r.kind === "wake-held").length, 1);

  for (const iso of ["2026-09-07T10:01:00Z", "2026-09-07T10:05:00Z", "2026-09-07T10:06:00Z"]) {
    const later = j.tick(iso);
    assert.deepEqual([later.action, later.reason, later.pending, later.held.since], ["skipped", "waiting-on-you", true, since], iso);
  }
  row1 = j.shown();
  assert.equal(row1.lastRun.held.since, since, "since survives ticks");
  assert.equal(row1.recentRuns.length, 1, "one run, however many ticks");
  assert.equal(row1.recentRuns[0].held.since, since);
  assert.equal(heldRows(d).length, 1, "one row at the start of a hold, never one per tick");
  assert.deepEqual(j.inputs, [], "no key, and none because a hold ran long");

  setWaiting(d.home, { producer: "oats.core", waiting: false });
  assert.equal(j.tick("2026-09-07T10:07:00Z").action, "delivered");
  assert.deepEqual(j.inputs, ["hello"], "delivers once");
  const done = j.shown();
  assert.equal(done.lastRun.outcome, "delivered");
  for (const [name, rec] of [["lastRun", done.lastRun], ["the history row", done.recentRuns[0]]]) {
    assert.equal("reason" in rec, false, `${name} keeps no reason`);
    assert.equal("held" in rec, false, `${name} keeps no held`);
  }
  assert.equal(done.recentRuns.length, 1);
  assert.equal(done.pendingWake, undefined);
  assert.equal(heldRows(d).length, 1);
  assert.equal(j.tick("2026-09-07T10:08:00Z"), undefined, "nothing is pending and nothing is due");
  assert.deepEqual(j.inputs, ["hello"]);
});

test("attention only delivers; a boundary voids a claim and the wake goes", () => {
  const d = deployment();
  boundary(d);
  claim(d, "attention", "agent", "failed turn");
  const j = job(d);
  assert.equal(j.tick("2026-09-07T10:00:00Z").action, "delivered");
  assert.deepEqual(j.inputs, ["hello"]);
  assert.equal(heldRows(d).length, 0);
  claim(d, "question");
  assert.equal(j.tick("2026-09-07T10:05:00Z").reason, "waiting-on-you");
  boundary(d, "s2");
  assert.equal(j.tick("2026-09-07T10:06:00Z").action, "delivered");
  assert.deepEqual(j.inputs, ["hello", "hello"]);
});

test("the hold reads claims, never the home's statement: `not-exposed` with a claim holds, `on-claims` with none delivers", () => {
  const d = deployment();
  boundary(d);
  claim(d, "permission");
  const meta = JSON.parse(readFileSync(join(d.home, "instance.json"), "utf8"));
  writeFileSync(join(d.home, "instance.json"), JSON.stringify({ ...meta, dialogClaims: { "a.producer": "none" } }));
  const j = job(d);
  assert.equal(j.tick("2026-09-07T10:00:00Z").reason, "waiting-on-you");
  assert.deepEqual(j.inputs, []);
  setWaiting(d.home, { producer: "oats.core", waiting: false });
  writeFileSync(join(d.home, "instance.json"), JSON.stringify({ ...meta, dialogClaims: { "a.producer": "reported" } }));
  assert.equal(j.tick("2026-09-07T10:01:00Z").action, "delivered");
  assert.deepEqual(j.inputs, ["hello"]);
});

test("an unreadable read holds with the cause recorded, and a throw from it holds too", () => {
  const d = deployment();
  boundary(d);
  const j = job(d);
  const record = readFileSync(join(d.home, "instance.json"));
  writeFileSync(join(d.home, "instance.json"), "{ not json");
  const first = j.tick("2026-09-07T10:00:00Z");
  assert.deepEqual([first.action, first.reason, first.pending], ["skipped", "waiting-on-you", true]);
  assert.deepEqual(first.held, { since: "2026-09-07T10:00:00.000Z", claimReason: null, producer: null, unreadable: "no readable instance.json" });
  assert.deepEqual(j.inputs, []);
  writeFileSync(join(d.home, "instance.json"), record);
  assert.equal(liveWaiting(d.home), null, "not a claim: an unreadable hold shows nothing on the roster");
  assert.deepEqual(rowsIn(d.homeLog).filter((r) => r.kind === "wake-held").map((r) => r.data), [{ schedule: "w", since: "2026-09-07T10:00:00.000Z", claimReason: null, producer: null, unreadable: "no readable instance.json" }]);

  const threw = S.tickWorkspace(d.ws, { now: at("2026-09-07T10:01:00Z"), io: { ...j.io, waitingHold: () => { throw new Error("EIO"); } }, reg: S.readRegistry() })[0];
  assert.deepEqual(threw.held, { since: "2026-09-07T10:00:00.000Z", claimReason: null, producer: null, unreadable: "the claims could not be read" });
  assert.deepEqual(j.inputs, [], "an action-path proof: the read threw and no input ran");
  assert.equal(j.tick("2026-09-07T10:02:00Z").action, "delivered");
  assert.deepEqual(j.inputs, ["hello"]);
});

test("mid-hold, a claim whose reason changes is the same hold: since stands, claimReason updates, no second row", () => {
  const d = deployment();
  boundary(d);
  claim(d, "permission");
  const j = job(d);
  j.tick("2026-09-07T10:00:00Z");
  claim(d, "question");
  const later = j.tick("2026-09-07T10:01:00Z");
  assert.deepEqual(later.held, { since: "2026-09-07T10:00:00.000Z", claimReason: "question", producer: "oats.core" });
  assert.equal(j.shown().lastRun.held.claimReason, "question");
  assert.equal(heldRows(d).length, 1);
  // The read turning unreadable is the same hold too.
  const record = readFileSync(join(d.home, "instance.json"));
  writeFileSync(join(d.home, "instance.json"), "{ not json");
  const blind = j.tick("2026-09-07T10:02:00Z");
  assert.deepEqual([blind.held.since, blind.held.claimReason, blind.held.producer], ["2026-09-07T10:00:00.000Z", null, null]);
  writeFileSync(join(d.home, "instance.json"), record);
});

test("mid-hold, the session stops and starts: the run is no hold, its fields go, the wake delivers once; a new claim is a new hold", () => {
  const d = deployment();
  boundary(d);
  claim(d, "permission");
  const j = job(d);
  j.tick("2026-09-07T10:00:00Z");
  j.session.state = { present: false, state: "stopped" };
  appendFileSync(d.homeLog, row(d, "stopped"));
  const stopped = j.tick("2026-09-07T10:01:00Z");
  assert.match(stopped.reason, /session stopped/);
  assert.equal("held" in stopped, false);
  let shown = j.shown();
  assert.equal("held" in shown.lastRun, false);
  assert.match(shown.lastRun.reason, /session stopped/);
  assert.equal("heldSince" in shown.pendingWake, false, "dropped when a run isn't a hold");
  assert.equal(j.tick("2026-09-07T10:05:00Z").action, "started");
  shown = j.shown();
  assert.equal("held" in shown.lastRun, false, "a started run after a hold carries no held");
  assert.equal("held" in shown.recentRuns[0], false);
  assert.notEqual(shown.lastRun.reason, "waiting-on-you");

  // The new session opens a dialog at once: a new hold, a new since, a second row.
  boundary(d, "s2");
  claim(d, "question");
  const again = j.tick("2026-09-07T10:06:00Z");
  assert.deepEqual([again.reason, again.held.since, again.held.claimReason], ["waiting-on-you", "2026-09-07T10:06:00.000Z", "question"]);
  assert.equal(heldRows(d).length, 2);
  setWaiting(d.home, { producer: "oats.core", waiting: false });
  assert.equal(j.tick("2026-09-07T10:07:00Z").action, "delivered");
  assert.deepEqual(j.inputs, ["hello"]);
  shown = j.shown();
  assert.equal("reason" in shown.lastRun, false);
  assert.equal("held" in shown.lastRun, false);
  assert.equal("held" in shown.recentRuns[0], false);
  assert.equal("reason" in shown.recentRuns[0], false);
});

test("run-now on a held job stays held: since stands, no second row, no key; after the claim clears it delivers once", () => {
  const d = deployment();
  boundary(d);
  claim(d, "permission");
  const j = job(d, { cron: "0 3 * * *" });
  const first = S.runNow(d.ws, "w", { now: at("2026-09-07T10:00:00Z"), io: j.io });
  assert.deepEqual(first.run.held, { since: "2026-09-07T10:00:00.000Z", claimReason: "permission", producer: "oats.core" });
  assert.equal(heldRows(d).length, 1, "a run-now that begins a hold writes its row");
  const again = S.runNow(d.ws, "w", { now: at("2026-09-07T10:03:00Z"), io: j.io });
  assert.equal(again.run.held.since, "2026-09-07T10:00:00.000Z");
  assert.equal(S.readState(d.ws).jobs.w.pendingWake.heldSince, "2026-09-07T10:00:00.000Z", "the site that rebuilds pendingWake keeps it");
  assert.equal(heldRows(d).length, 1);
  assert.deepEqual(j.inputs, []);
  // The tick's own pending site continues the same hold.
  assert.equal(j.tick("2026-09-07T10:04:00Z").held.since, "2026-09-07T10:00:00.000Z");
  setWaiting(d.home, { producer: "oats.core", waiting: false });
  const done = S.runNow(d.ws, "w", { now: at("2026-09-07T10:05:00Z"), io: j.io });
  assert.equal(done.run.outcome, "delivered");
  assert.equal("held" in done.run, false);
  assert.equal("reason" in done.run, false);
  assert.deepEqual(j.inputs, ["hello"]);
  assert.equal(S.readState(d.ws).jobs.w.pendingWake, undefined);
});

test("a retiring home's wake-held row goes to the workspace log only", () => {
  const d = deployment();
  boundary(d);
  claim(d, "permission");
  writeFileSync(retirePendingMarkerPath(d.home), "{}");
  const before = readFileSync(d.homeLog, "utf8");
  const j = job(d);
  assert.equal(j.tick("2026-09-07T10:00:00Z").reason, "waiting-on-you");
  assert.equal(readFileSync(d.homeLog, "utf8"), before, "retirement fingerprints the home");
  assert.equal(rowsIn(d.wsLog).filter((r) => r.kind === "wake-held").length, 1);
});

test("a failed event write doesn't change the hold", () => {
  const d = deployment();
  boundary(d);
  const j = job(d);
  // Neither log can take a row. A log that is a directory is refused by the read too, so the read is given.
  for (const log of [d.homeLog, d.wsLog]) { rmSync(log); mkdirSync(log); }
  const hold = S.tickWorkspace(d.ws, { now: at("2026-09-07T10:00:00Z"), io: { ...j.io, waitingHold: () => CLAIM("permission") }, reg: S.readRegistry() })[0];
  assert.deepEqual([hold.action, hold.reason, hold.pending, hold.held.since], ["skipped", "waiting-on-you", true, "2026-09-07T10:00:00.000Z"]);
  assert.equal(S.readState(d.ws).jobs.w.pendingWake.heldSince, "2026-09-07T10:00:00.000Z");
  assert.deepEqual(j.inputs, []);
});

test("wake-held is not a claim and carries no waitingOnYou; the Desktop's events reader reads it", () => {
  const d = deployment();
  boundary(d);
  const j = job(d);
  const res = appendEvent(d.home, { kind: "wake-held", data: { schedule: "w", since: "2026-09-07T10:00:00.000Z", claimReason: "permission", producer: "oats.core" } });
  assert.equal(res.ok, true);
  assert.equal(waitingHold(d.home), null, "the row is never a claim, so it can't hold its own wake");
  assert.equal(j.tick("2026-09-07T10:00:00Z").action, "delivered");
  const read = readEvents(d.home);
  assert.deepEqual([read.waitingOnYou, read.waitingClaims], [null, []]);
  const rows = read.events.filter((r) => r.kind === "wake-held");
  assert.equal("waitingOnYou" in rows[0].data, false);
  const unreadableRow = { ...rows[0], data: { ...rows[0].data, claimReason: null, producer: null, unreadable: "the home events log's tail holds no session boundary" } };
  const target = { workspace: "ws", context: d.ws, selector: { instance: "dev-1", agent: "dev", agentsRoot: join(d.ws, "agents"), server: null }, home: d.home, incarnation: BIRTH };
  const events = [read.events[0], rows[0], unreadableRow];
  const last = events.at(-1);
  const out = eventsData({ ...read, count: events.length, returned: events.length, events, lastEvent: { kind: last.kind, at: last.at, producer: last.producer, incarnation: last.incarnation } }, target);
  assert.ok(out, "a new kind refuses no read");
  assert.equal(out.events[1].kind, "wake-held");
});
