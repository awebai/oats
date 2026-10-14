import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { RecordStore } from "../lib/store.mjs";
import { DerivedState, fileVersion } from "../lib/derived-state.mjs";
import { withCaptureGroup, captureContext } from "../lib/capture-context.mjs";
import { readCaptureAdmission, readCaptureRetry } from "../lib/capture-admission.mjs";
import { reconcileCaptureInterruption, selectCaptureWork, resolveCaptureRetry } from "../lib/capture-retry.mjs";
import { readIssueBacklog } from "../lib/capture-issues.mjs";
import { resetSourceCursors, retrySetAside } from "../lib/capture-state.mjs";
import { finishTurn } from "../lib/canonical.mjs";

const now = Date.parse("2026-01-01T00:00:00.000Z"), due = now + 30 * 60000;
const streams = ["fixture~a", "fixture~b"], healthy = "fixture~z";
const turn = n => finishTurn({ v: 1, ts: "2026-01-01T00:00:00Z", from: "fixture", kind: "note", body: { text: `turn ${n}` } });
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), "capture-retry-"));
  const f = { root, store: new RecordStore(root, { owner: "fixture" }), state: new DerivedState(root) };
  t.after(() => { f.state.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return f;
}
const candidate = (f, stream) => ({ stream, stage: "index", offset: 0,
  generation: fileVersion(f.store.journalPath(stream)), next: { stage: "index", after: stream } });
function select(f, names, runId, at = now) {
  return selectCaptureWork(f.store, f.state, names.map(s => candidate(f, s)), { runId, now: at });
}
function run(f, admission, fn, at = now) {
  return withCaptureGroup(f.store, admission.members.map(m => m.stream), fn, { state: f.state, admission, admissionNow: at });
}
function interrupt(f, names = streams, runId = "failed-group", at = now) {
  const admission = select(f, names, runId, at);
  assert.throws(() => run(f, admission, () => { throw Error("injected interruption"); }, at), /injected interruption/);
  return readCaptureAdmission(f.state);
}
function reopen(f) { f.state.close(); f.state = new DerivedState(f.root); }
function resolve(f, stream, options = {}) {
  return resolveCaptureRetry(f.state, { id: captureContext(f.store).admission.id, stream, ...options });
}

test("unknown group defers without member blame; healthy work proceeds in the same pass; next due attempts are single", t => {
  const f = fixture(t), active = interrupt(f);
  const result = reconcileCaptureInterruption(f.state, { reason: "heap", now });
  assert.deepEqual(result, { id: active.id, runId: "failed-group", reason: "interrupted", memberCount: 2 });
  assert.equal(readCaptureAdmission(f.state), null);
  assert.deepEqual([...f.state.entries("capture-failed")], []);
  let backlog = readIssueBacklog(f.state.db); assert.equal(backlog.pending, true); assert.equal(backlog.failedCount, 0);
  const next = select(f, [...streams, healthy], "failed-group");
  assert.deepEqual(next.members.map(m => m.stream), [healthy]);
  run(f, next, () => f.store.append(healthy, turn(0)));
  assert.equal(f.store.readStream(healthy).length, 1);
  assert.equal(select(f, streams, "later", due - 1), null);
  reopen(f);
  const first = select(f, streams, "due-pass", due);
  assert.equal(first.retry, true); assert.equal(first.members.length, 1); assert.equal(first.members[0].stream, streams[0]);
  // The admitted member has its OWN failure; the other remains unknown.
  assert.throws(() => run(f, first, () => { throw Error("member failed"); }, due), /member failed/);
  reconcileCaptureInterruption(f.state, { reason: "rss", now: due });
  backlog = readIssueBacklog(f.state.db);
  assert.deepEqual(backlog.failed, [{ stream: streams[0], offset: 0, reason: "rss", attempts: 1,
    nextRetryAt: new Date(due + 30 * 60000).toISOString() }]);
  const second = select(f, streams, "due-pass", due);
  assert.deepEqual(second.members.map(m => m.stream), [streams[1]]);
  run(f, second, () => {
    f.store.append(streams[1], turn(1));
    assert.equal(resolve(f, streams[1], { reconciled: true }), true);
  }, due);
  assert.equal(f.store.readStream(streams[1]).length, 1);
  assert.equal(readCaptureRetry(f.state, streams[1]), null);
  assert.equal(select(f, streams.slice(0, 1), "due-pass", due), null);
  assert.equal(readIssueBacklog(f.state.db).failedCount, 1);
});

test("admission enforces due time, one member, same-pass exclusion and durable fairness after partial work", t => {
  const f = fixture(t); interrupt(f); reconcileCaptureInterruption(f.state, { now });
  const attempt = select(f, streams, "next", due);
  assert.throws(() => run(f, attempt, () => assert.fail(), due - 1), /due single-stream/);
  const grouped = { ...attempt, members: streams.map(s => { const c = candidate(f, s); return { stream: s, offset: 0, generation: c.generation }; }) };
  assert.throws(() => run(f, grouped, () => assert.fail(), due), /due single-stream/);
  assert.throws(() => run(f, { ...attempt, retry: false }, () => assert.fail(), due), /due single-stream/);
  run(f, attempt, () => {}, due); // cooperative incomplete work preserves retry
  assert.throws(() => run(f, attempt, () => assert.fail(), due), /due single-stream/);
  reopen(f);
  const later = select(f, streams, "later-pass", due);
  assert.equal(later.members[0].stream, streams[1], "admission rotates deferred fairness even without processing progress");
  run(f, later, () => {}, due);
  assert.equal(select(f, streams, "later-pass", due).members[0].stream, streams[0]);
  assert.equal(readCaptureRetry(f.state, streams[0]).nextRetryAt, new Date(due).toISOString());
  assert.equal(readIssueBacklog(f.state.db).failedCount, 0);
});

test("one reconciliation commit is atomic and idempotent, with no cursor changes or per-member transactions", t => {
  const f = fixture(t), names = Array.from({ length: 128 }, (_, n) => `fixture~${n}`);
  f.state.set("fixture-cursor", "position", 17);
  const active = interrupt(f, names), exec = f.state.db.exec.bind(f.state.db); let commits = 0;
  f.state.db.exec = sql => { if (sql === "COMMIT") { commits++; throw Error("injected reconciliation commit"); } return exec(sql); };
  assert.throws(() => reconcileCaptureInterruption(f.state, { now }), /injected reconciliation commit/);
  f.state.db.exec = exec;
  assert.equal(commits, 1); assert.equal(readCaptureAdmission(f.state).id, active.id);
  assert.deepEqual([...f.state.entries("capture-retry")], []);
  assert.equal(f.state.get("capture-run-failure", "last"), null);
  let begins = 0; commits = 0;
  f.state.db.exec = sql => { if (sql === "BEGIN IMMEDIATE") begins++; if (sql === "COMMIT") commits++; return exec(sql); };
  reconcileCaptureInterruption(f.state, { now });
  assert.deepEqual({ begins, commits }, { begins: 1, commits: 1 });
  assert.equal(reconcileCaptureInterruption(f.state, { now }), null);
  assert.equal(commits, 1); f.state.db.exec = exec;
  reopen(f);
  assert.equal([...f.state.entries("capture-retry")].length, 128);
  assert.equal(f.state.get("fixture-cursor", "position"), 17);
  assert.deepEqual(f.state.get("capture-schedule", "position"), active.next);
});

test("only committed completion or validated reconciliation clears failure; restart/reset/growth do not", t => {
  const f = fixture(t), stream = streams[0]; f.store.append(stream, turn(0));
  interrupt(f, [stream]); reconcileCaptureInterruption(f.state, { reason: "io", now });
  const prior = f.state.get("capture-failed", stream), attempt = select(f, [stream], "retry", due);
  assert.throws(() => run(f, attempt, () => {
    assert.equal(resolve(f, stream, { through: prior.generation.size - 1 }), false);
    assert.equal(resolve(f, stream, { through: prior.generation.size }), true);
    throw Error("processing commit not reached");
  }, due), /processing commit not reached/);
  assert.deepEqual(f.state.get("capture-failed", stream), prior);
  reconcileCaptureInterruption(f.state, { now: due });
  assert.equal(f.state.get("capture-failed", stream).attempts, 2);
  resetSourceCursors(f.root, "fixture", "aw"); retrySetAside(f.root);
  f.store.append(stream, turn(1)); reopen(f);
  const nextTime = due + 60 * 60000, next = select(f, [stream], "retry2", nextTime);
  assert.equal(next.members[0].offset, 0, "changed journal generation restarts recovery");
  run(f, next, () => {
    assert.equal(resolve(f, stream, { through: next.members[0].generation.size }), false, "growth alone does not prove the old unit resolved");
    assert.equal(resolve(f, stream, { reconciled: true }), true);
  }, nextTime);
  assert.equal(f.state.get("capture-failed", stream), null); assert.equal(readCaptureRetry(f.state, stream), null);
  assert.equal(f.store.readStream(stream).length, 2);
  assert.equal(readIssueBacklog(f.state.db).pending, false);
});

test("failed single unit reports its new admission start, never the prior group's guessed frame", t => {
  const f = fixture(t); for (const s of streams) f.store.append(s, turn(s));
  interrupt(f); reconcileCaptureInterruption(f.state, { now });
  const retry = select(f, streams, "due", due); retry.members[0].offset = 5;
  assert.throws(() => run(f, retry, () => { throw Error("failed"); }, due), /failed/);
  reconcileCaptureInterruption(f.state, { now: due });
  assert.equal(readIssueBacklog(f.state.db).failed[0].offset, 5);
  assert.equal(readIssueBacklog(f.state.db).failed[0].reason, "interrupted");
  assert.equal(readIssueBacklog(f.state.db).failedCount, 1);
});

test("malformed deferred evidence fails closed and cannot be selected as healthy", t => {
  const f = fixture(t), stream = streams[0]; f.state.set("capture-retry", stream, { nextRetryAt: "bad" });
  assert.throws(() => select(f, [stream], "pass"), /invalid deferred/);
  assert.throws(() => select(f, [], "pass"), /invalid deferred/);
});

test("killed group is reconciled after restart without duplicate append or attribution to its members", t => {
  const f = fixture(t), admission = select(f, streams, "killed-pass");
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import {RecordStore} from ${JSON.stringify(new URL("../lib/store.mjs", import.meta.url).href)};
    import {withCaptureGroup,captureContext} from ${JSON.stringify(new URL("../lib/capture-context.mjs", import.meta.url).href)};
    const store=new RecordStore(${JSON.stringify(f.root)},{owner:'fixture'});
    withCaptureGroup(store,${JSON.stringify(streams)},()=>{
      store.append(${JSON.stringify(streams[0])},${JSON.stringify(turn(0))});
      captureContext(store).state.set('fixture-cursor','rolled-back',1);
      process.kill(process.pid,'SIGKILL');
    },{admission:${JSON.stringify(admission)}});
  `], { encoding: "utf8", env: { HOME: f.root, TMPDIR: f.root, PATH: process.env.PATH }, timeout: 5000 });
  assert.equal(child.signal, "SIGKILL", child.stderr); reopen(f);
  reconcileCaptureInterruption(f.state, { now });
  assert.equal(f.state.get("fixture-cursor", "rolled-back"), null);
  assert.equal(f.store.readStream(streams[0]).length, 1);
  assert.equal(readIssueBacklog(f.state.db).failedCount, 0);
  run(f, select(f, [...streams, healthy], "killed-pass"), () => f.store.append(healthy, turn(1)));
  assert.equal(f.store.readStream(healthy).length, 1);
  const retry = select(f, streams, "next-due", due);
  run(f, retry, () => {
    assert.equal(f.store.appendUniqueBatch(streams[0], [turn(0)]), 0);
    assert.equal(resolve(f, streams[0], { reconciled: true }), true);
  }, due);
  assert.equal(f.store.readStream(streams[0]).length, 1);
  assert.equal(readCaptureRetry(f.state, streams[0]), null);
  assert.notEqual(readCaptureRetry(f.state, streams[1]), null);
});
