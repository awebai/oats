// K8b — `schedule-read-2` (scheduleHistoryApi 3): run identity by time not outcome; bounded descriptor-safe state reads; per-job isolation; subject truth; session provenance (never a transcript).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as S from "../lib/schedule.mjs";

function scope(t) {
  const ws = mkdtempSync(join(tmpdir(), "k8b-")); t.after(() => rmSync(ws, { recursive: true, force: true }));
  mkdirSync(join(ws, ".agents", "schedules"), { recursive: true });
  const defs = (jobs) => writeFileSync(S.definitionsPath(ws), JSON.stringify({ version: 1, jobs }));
  const state = (jobs) => writeFileSync(join(ws, ".agents", "schedules", "state.json"), JSON.stringify({ jobs }));
  const job = (id, extra = {}) => ({ id, kind: "wake", home: join(ws, "agents", "x", "instances", "x-1"), message: "hi", cron: "* * * * *", enabled: false, ...extra });
  return { ws, defs, state, job };
}
const io = { hostStatus: () => ({ status: "unknown" }) };

test("1 — run identity: unknown→ended is ONE row with two transitions; pending 'started' is a transition of the same run; a different start is a new run; legacy outcome-keyed rows are reported legacy and never merged", (t) => {
  const s = scope(t); s.defs({ j: s.job("j") });
  const st = { jobs: { j: { lastRun: { scheduledFor: "2026-01-01T00:00:00.000Z", startedAt: "2026-01-01T00:00:01.000Z", kind: "wake", outcome: "started", pending: true, instance: "x-1", home: s.job("j").home } } } };
  S.writeState(s.ws, st);
  let d = S.describe(s.ws, "j", io); assert.equal(d.scheduleHistoryApi, 3); assert.equal(d.recentRuns.length, 1); assert.equal(d.recentRuns[0].settled, false); assert.deepEqual(d.recentRuns[0].transitions, ["started"]);
  st.jobs.j.lastRun = { ...st.jobs.j.lastRun, outcome: "unknown", pending: false }; S.writeState(s.ws, st);
  st.jobs.j.lastRun = { ...st.jobs.j.lastRun, outcome: "ended", endedAt: "2026-01-01T00:05:00.000Z" }; S.writeState(s.ws, st);
  d = S.describe(s.ws, "j", io);
  assert.equal(d.recentRuns.length, 1, "one run, not three rows"); assert.equal(d.recentRuns[0].outcome, "ended"); assert.equal(d.recentRuns[0].settled, true);
  assert.deepEqual(d.recentRuns[0].transitions, ["started", "unknown", "ended"]); assert.equal(typeof d.recentRuns[0].runId, "string"); assert.equal(d.recentRuns[0].legacy, false);
  st.jobs.j.lastRun = { scheduledFor: "2026-01-01T00:10:00.000Z", startedAt: "2026-01-01T00:10:01.000Z", kind: "wake", outcome: "delivered" }; S.writeState(s.ws, st);
  d = S.describe(s.ws, "j", io); assert.equal(d.recentRuns.length, 2, "a different start is a new run"); assert.equal(d.recentRuns[0].outcome, "delivered");
  // legacy rows
  const raw = JSON.parse(readFileSync(join(s.ws, ".agents", "schedules", "state.json"), "utf8"));
  raw.jobs.j.recentRuns.push({ key: "a|b|ended", scheduledFor: "a", startedAt: "b", outcome: "ended" });
  writeFileSync(join(s.ws, ".agents", "schedules", "state.json"), JSON.stringify(raw));
  d = S.describe(s.ws, "j", io); const leg = d.recentRuns.find((r) => r.legacy); assert.ok(leg); assert.equal(leg.runId, null); assert.equal(leg.settled, null); assert.equal(leg.key, undefined);
  assert.equal(d.lastRun.runId, d.recentRuns[0].runId, "lastRun carries the same runId as its history row");
});

test("2 — bounds/integrity: an over-budget state file is REFUSED typed (never truncated JSON); a symlinked file is refused; >50 stored rows are capped at read with historyTruncated; one job's corrupt history does not fail the list; integrity.sources reports each file", (t) => {
  const s = scope(t); s.defs({ a: s.job("a"), b: s.job("b") });
  const rows = Array.from({ length: 61 }, (_, i) => ({ runId: `r${i}`, scheduledFor: `2026-01-01T00:${String(i).padStart(2, "0")}:00.000Z`, startedAt: `s${i}`, outcome: "ended", settled: true, transitions: ["ended"] }));
  s.state({ a: { recentRuns: rows }, b: { recentRuns: "not-an-array" } });
  const l = S.listSchedules(s.ws, io);
  assert.equal(l.scope, s.ws); assert.equal(l.scheduleHistoryApi, 3); assert.deepEqual(l.integrity.sources.map((x) => x.path + ":" + x.status), ["definitions:ok", "state:ok"]);
  const a = l.schedules.find((x) => x.id === "a"), b = l.schedules.find((x) => x.id === "b");
  assert.equal(a.recentRuns.length, 50); assert.deepEqual(a.history, { status: "ok", stored: 61, truncated: true });
  assert.deepEqual(b.history, { status: "corrupt", stored: null, truncated: false }); assert.deepEqual(b.recentRuns, []); assert.equal(b.cron, "* * * * *", "the job itself still reads");
  // oversize
  writeFileSync(join(s.ws, ".agents", "schedules", "state.json"), JSON.stringify({ jobs: { a: { pad: "x".repeat(S.SCHEDULE_FILE_BUDGET + 10) } } }));
  assert.throws(() => S.listSchedules(s.ws, io), (e) => e.code === "E_SCHEDULE_STATE_OVERSIZE" && e.source.status === "oversize");
  assert.equal(S.scheduleIntegrity(s.ws).sources[1].status, "oversize", "integrity reports it without throwing");
  // symlink
  rmSync(join(s.ws, ".agents", "schedules", "state.json")); writeFileSync(join(s.ws, "elsewhere.json"), JSON.stringify({ jobs: {} })); symlinkSync(join(s.ws, "elsewhere.json"), join(s.ws, ".agents", "schedules", "state.json"));
  assert.throws(() => S.readState(s.ws), (e) => e.code === "E_SCHEDULE_INVALID" && e.source.status === "refused");
  assert.equal(S.scheduleIntegrity(s.ws).sources[1].status, "refused");
  // absent state is fine and says so
  rmSync(join(s.ws, ".agents", "schedules", "state.json")); assert.equal(S.scheduleIntegrity(s.ws).sources[1].status, "absent"); assert.equal(S.listSchedules(s.ws, io).schedules.length, 2);
});

test("3 — subject truth: show echoes scope + canonical id; a definition whose own id differs from its key is refused E_SCHEDULE_IDENTITY (and isolated in list); malformed ids are refused before any read", (t) => {
  const s = scope(t); s.defs({ good: s.job("good"), bad: s.job("other") });
  const d = S.describe(s.ws, "good", io); assert.equal(d.scope, s.ws); assert.equal(d.id, "good");
  assert.throws(() => S.describe(s.ws, "bad", io), (e) => e.code === "E_SCHEDULE_IDENTITY" && e.key === "bad" && e.declared === "other");
  const l = S.listSchedules(s.ws, io); const bad = l.schedules.find((x) => x.id === "bad"); assert.equal(bad.unreadable.code, "E_SCHEDULE_IDENTITY"); assert.equal(l.schedules.find((x) => x.id === "good").unreadable, undefined);
  for (const id of ["-x", "a b", "", "x".repeat(129), "../y"]) assert.throws(() => S.describe(s.ws, id, io), (e) => e.code === "E_BAD_ARGS", JSON.stringify(id));
});

test("4 — session provenance, never a transcript: delivered-active names the instance only when the input result did; launched runs carry home+incarnation (+server when the answering envelope had one); no `transcript` key anywhere", (t) => {
  const s = scope(t); const home = s.job("j").home; mkdirSync(home, { recursive: true }); writeFileSync(join(home, "instance.json"), JSON.stringify({ createdAt: "2026-02-02T00:00:00.000Z" }));
  s.defs({ j: s.job("j") });
  const st = { jobs: { j: { lastRun: { scheduledFor: "2026-01-01T00:00:00.000Z", startedAt: "2026-01-01T00:00:01.000Z", kind: "wake", outcome: "delivered", action: "delivered", home, incarnation: "2026-02-02T00:00:00.000Z" } } } };
  S.writeState(s.ws, st);
  let d = S.describe(s.ws, "j", io);
  assert.deepEqual(d.recentRuns[0].session, { instance: null, home, incarnation: "2026-02-02T00:00:00.000Z", server: null, delivery: "delivered-active" }, "active delivery without a named instance says instance:null explicitly");
  assert.ok(!JSON.stringify(d).includes('"transcript"'));
  st.jobs.j.lastRun = { scheduledFor: "2026-01-01T00:10:00.000Z", startedAt: "s2", kind: "command", outcome: "ended", launched: true, instance: "x-9", home, incarnation: "2026-02-02T00:00:00.000Z", server: "peer-a" }; S.writeState(s.ws, st);
  d = S.describe(s.ws, "j", io); assert.deepEqual(d.recentRuns[0].session, { instance: "x-9", home, incarnation: "2026-02-02T00:00:00.000Z", server: "peer-a", delivery: "launched" });
  st.jobs.j.lastRun = { scheduledFor: "2026-01-01T00:20:00.000Z", startedAt: "s3", kind: "wake", outcome: "blocked", launched: false }; S.writeState(s.ws, st);
  d = S.describe(s.ws, "j", io); assert.equal(d.recentRuns[0].session.delivery, "none");
});
