// Qualification Q2a (#1108 checkpoint Q): large frames under the capped
// supervised worker (256 MiB heap, production policy). A historical frame is
// one journal record whose captured native line (body.line) a release without
// a record limit wrote; the operator counted 42 records over 8 MiB, the largest
// 22,296,807 bytes. After cache loss, journal validation, the journal side of
// the prefix proof and indexing each read such a record whole, so the largest
// frame bounds recovery memory. The frames here are written by the public
// synchronous capture: the journal format and turn are the same in every
// release, it keeps no record limit, and it needs neither the network nor the
// time an installed outgoing release would cost this file (Q1d and Q3 run
// v0.61.0 itself). Runs only on the dispatched "Linux tests" runner; a skip is
// not evidence. Peaks are reported; a frame that cannot complete under the cap
// is reported as the gap, never a failure of this file. The assertions are
// structural: no record duplicated or rewritten, near-limit records captured
// once, and a record that cannot complete isolated with a visible row.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { CAPTURE_POLICY } from "../lib/capture-budget.mjs";
import { captureHealth } from "../lib/capture-state.mjs";
import { dropDerived, realManagerSkip, report, runnerFacts, scratch, sessionPath, table } from "./fixtures/qualify.mjs";
import { awEntry, awStream, captureHistorical, codexLine, exactLine, HEAVY, indexedCounts, journalShape, lineForFrame,
  sessionProgress, settle, smallLine, smallSessions, stateRows, stateValue, streamOf, writeSession } from "./fixtures/qualify-frames.mjs";

const skip = realManagerSkip("linux") ?? false;
const MiB = 1024 * 1024;
// Frame sizes are of the journal record. The last case reads the 22.3 MB
// target as the captured native line itself, whose frame the second escaping
// makes larger still.
const FRAMES = [{ label: "frame-8MB", frameBytes: 8_000_000 }, { label: "frame-16MB", frameBytes: 16_000_000 },
  { label: "frame-22.3MB", frameBytes: 22_300_000 }, { label: "line-22.3MB", lineBytes: 22_300_000 }];
// Just under the raw-record limit, newline included.
const NEAR_LIMIT = CAPTURE_POLICY.maxRecordBytes - 8;
const frameSession = (home, n, spec) => {
  const path = sessionPath(home, "codex", n), build = text => codexLine(n, text);
  const line = spec.frameBytes ? lineForFrame(build, HEAVY, spec.frameBytes) : exactLine(build, HEAVY, spec.lineBytes);
  return { format: "codex", path, stream: streamOf("codex", path), lines: 1, lineBytes: writeSession(path, [line]) - 1 };
};
const health = (root, home) => captureHealth(root, { home });

test("Q2a large historical frames: recovery, parse and index under the capped worker at 8, 16 and 22.3 MB", { skip, timeout: 9 * 60_000 }, async t => {
  const base = scratch(t, "qualify-frames-");
  fs.mkdirSync(join(base, "record"));
  runnerFacts(t, { root: join(base, "record"), scratch: base });
  report(t, "frame-policy", { policy: CAPTURE_POLICY, unit: HEAVY, frameWriter: "public synchronous captureSessions (no record limit)" });
  const rows = [];
  for (const spec of FRAMES) {
    const dir = join(base, spec.label), home = join(dir, "home"), root = join(dir, "record");
    const frame = frameSession(home, 1, spec);
    assert.equal(captureHistorical(root, [frame]), 1);
    const before = journalShape(root, frame.stream);
    dropDerived(root);
    const run = await settle(t, spec.label, root, home, { maxPasses: 3, budgetMs: 90_000 });
    const indexed = indexedCounts(root).get(frame.stream) ?? 0, issues = health(root, home);
    const row = { label: spec.label, lineBytes: frame.lineBytes, frameBytes: before.largestFrameBytes, complete: run.complete,
      outcome: run.outcome, reason: run.reason, passes: run.passes.length, wallMs: run.wallMs, workers: run.workers,
      withoutExitReport: run.withoutExitReport, peakRssBytes: run.peakRssBytes, vmHwmBytes: run.vmHwmBytes,
      heapUsedAtExitBytes: run.heapUsedAtExitBytes, indexed };
    report(t, "frame", { ...row, failed: issues.backlog.failed, healthRows: issues.rows.map(r => r.code) });
    rows.push(row);
    // Recovery never rewrites or duplicates a captured record, whatever its outcome.
    assert.deepEqual(journalShape(root, frame.stream), before, `${spec.label}: the journal changed during recovery`);
    if (run.complete) assert.equal(indexed, 1, `${spec.label}: complete but the frame is not indexed`);
    else if (run.failed) {
      // A failed single-stream unit: unindexed, and a visible failed row at its unit start.
      assert.equal(indexed, 0, `${spec.label}: a failed frame was indexed`);
      assert.ok(issues.backlog.failed.some(r => r.stream === frame.stream), `${spec.label}: no failed row names ${frame.stream}: ${JSON.stringify(issues.backlog)}`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  table(t, "Q2a peak memory by frame size (capped worker, production policy)", rows);
  const gaps = rows.filter(r => !r.complete);
  if (gaps.length) {
    report(t, "frame-gap", { heapMiB: CAPTURE_POLICY.heapMiB, incomplete: gaps.map(({ label, frameBytes, outcome, reason, vmHwmBytes }) => ({ label, frameBytes, outcome, reason, vmHwmBytes })) });
    t.diagnostic(`GAP: ${gaps.map(r => `${r.label} (${r.frameBytes} B frame) ${r.outcome}/${r.reason}`).join("; ")} did not complete under ${CAPTURE_POLICY.heapMiB} MiB; the peaks above are the evidence.`);
  }
});

test("Q2a near-limit raw records: a native line and an aw comm log entry just under 8 MiB complete under the cap and are captured once", { skip, timeout: 3 * 60_000 }, async t => {
  const base = scratch(t, "qualify-near-"), home = join(base, "home"), root = join(base, "record");
  const path = sessionPath(home, "codex", 1), native = { format: "codex", path, stream: streamOf("codex", path), lines: 3 };
  const nativeBytes = writeSession(path, [smallLine("codex", 1), exactLine(text => codexLine(2, text), HEAVY, NEAR_LIMIT - 1), smallLine("codex", 3)]);
  const aw = { stream: awStream, lines: 3 };
  const awBytes = writeSession(join(home, ".config", "aw", "logs", "account-0.jsonl"),
    [awEntry(1, "small"), exactLine(text => awEntry(2, text), HEAVY, NEAR_LIMIT - 1), awEntry(3, "small")]);
  report(t, "near-limit-input", { limit: CAPTURE_POLICY.maxRecordBytes, recordBytes: NEAR_LIMIT, nativeBytes, awBytes });
  const first = await settle(t, "near-limit", root, home, { budgetMs: 60_000 });
  const captured = sessionProgress(root, [native, aw]), issues = health(root, home);
  const row = { complete: first.complete, outcome: first.outcome, reason: first.reason, passes: first.passes.length, wallMs: first.wallMs,
    peakRssBytes: first.peakRssBytes, vmHwmBytes: first.vmHwmBytes, heapUsedAtExitBytes: first.heapUsedAtExitBytes,
    nativeFrameBytes: journalShape(root, native.stream).largestFrameBytes, awFrameBytes: journalShape(root, aw.stream).largestFrameBytes };
  report(t, "near-limit", { ...row, captured, setAside: issues.backlog.setAside });
  table(t, "Q2a near-limit records (capped worker)", [row]);
  assert.equal(first.complete, true, `near-limit capture did not complete: ${first.outcome}/${first.reason}`);
  assert.equal(issues.backlog.setAsideCount, 0, "a record under the limit was set aside");
  for (const s of captured) assert.ok(s.done, `${s.stream}: ${s.journal} journal records, ${s.indexed} indexed, expected ${s.lines}`);
  // A later pass over unchanged inputs adds nothing: each record is captured once.
  const again = await settle(t, "near-limit-again", root, home, { budgetMs: 60_000 });
  assert.equal(again.complete, true);
  assert.deepEqual(sessionProgress(root, [native, aw]).map(s => [s.journal, s.indexed]), [[3, 3], [3, 3]]);
});

test("Q2a failure isolation: a record that cannot complete keeps its cursor, other streams progress in the same pass, and a row shows it", { skip, timeout: 7 * 60_000 }, async t => {
  const base = scratch(t, "qualify-isolation-");

  // A raw source record over the 8 MiB limit, beyond a captured prefix, after a first upgrade.
  {
    const dir = join(base, "oversized"), home = join(dir, "home"), root = join(dir, "record");
    const path = sessionPath(home, "codex", 0), blocked = { format: "codex", path, stream: streamOf("codex", path), lines: 5 };
    const offset = writeSession(path, Array.from({ length: 5 }, (_, i) => smallLine("codex", i)));
    const recovered = smallSessions(home, 1, 20);
    assert.equal(captureHistorical(root, [blocked, ...recovered]), 5 + 20 * 6);
    dropDerived(root);
    writeSession(path, [exactLine(text => codexLine(5, text), HEAVY, 9 * MiB - 1), smallLine("codex", 6), smallLine("codex", 7)], { append: true });
    const fresh = smallSessions(home, 21, 20), aw = { stream: awStream, lines: 5 };
    writeSession(join(home, ".config", "aw", "logs", "account-0.jsonl"), Array.from({ length: 5 }, (_, i) => awEntry(100 + i, `message ${i}`)));
    const healthy = [...recovered, ...fresh, aw];

    const pass = await settle(t, "oversized", root, home, { maxPasses: 1 });
    const cursor = stateValue(root, "codex", `${blocked.stream}:${path}`), issues = health(root, home);
    const progress = sessionProgress(root, healthy), entry = issues.backlog.setAside.find(r => r.path === path);
    report(t, "isolation-oversized", { outcome: pass.outcome, reason: pass.reason, wallMs: pass.wallMs, offset, cursorBytes: cursor?.bytes ?? null,
      blockedJournal: journalShape(root, blocked.stream).lines, healthyDone: progress.filter(s => s.done).length, healthy: healthy.length,
      setAside: issues.backlog.setAside, healthRows: issues.rows.map(r => r.code) });
    assert.equal(journalShape(root, blocked.stream).lines, 5, "a record at or after the oversized one was captured");
    assert.equal(cursor?.bytes, offset, "the source cursor moved off the oversized record's start");
    assert.deepEqual(entry && { source: entry.source, offset: entry.offset, reason: entry.reason }, { source: "codex", offset, reason: "record-too-large" });
    assert.ok(issues.rows.some(r => r.code === "capture-input-set-aside"), `no set-aside health row: ${JSON.stringify(issues.rows)}`);
    for (const s of progress) assert.ok(s.done, `${s.stream} did not progress in the same pass: ${s.journal} journal, ${s.indexed} indexed of ${s.lines}`);
    // The set-aside input does not consume the next pass, nor is anything captured twice.
    await settle(t, "oversized-again", root, home, { maxPasses: 1 });
    assert.equal(stateValue(root, "codex", `${blocked.stream}:${path}`)?.bytes, offset);
    assert.equal(journalShape(root, blocked.stream).lines, 5);
    assert.ok(sessionProgress(root, healthy).every(s => s.done), "a healthy stream changed on the next pass");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // The largest historical frame among healthy neighbours after a first upgrade.
  // More neighbours than one admission unit holds (128) puts some outside the frame's unit.
  {
    const dir = join(base, "frame"), home = join(dir, "home"), root = join(dir, "record");
    const frame = frameSession(home, 0, FRAMES.at(-1)), recovered = smallSessions(home, 1, 150), fresh = smallSessions(home, 151, 30);
    assert.equal(captureHistorical(root, [frame, ...recovered]), 1 + 150 * 6);
    const before = journalShape(root, frame.stream);
    dropDerived(root);
    const run = await settle(t, "frame-isolation", root, home, { maxPasses: 3, budgetMs: 150_000 });
    const healthy = [...recovered, ...fresh];
    if (!run.failed) {
      report(t, "isolation-frame", { exercised: false, outcome: run.outcome, reason: run.reason, frameBytes: before.largestFrameBytes, vmHwmBytes: run.vmHwmBytes });
      t.diagnostic(`The ${before.largestFrameBytes} B frame did not fail under ${CAPTURE_POLICY.heapMiB} MiB (${run.outcome}/${run.reason}): its isolation is not exercised.`);
      assert.deepEqual(journalShape(root, frame.stream), before);
    } else {
      const retries = stateRows(root, "capture-retry"), failed = stateRows(root, "capture-failed"), issues = health(root, home);
      const frameRetry = retries.find(r => r.key === frame.stream)?.value ?? null;
      // The replacement worker reconciles the interrupted unit, so the frame is always deferred.
      assert.ok(frameRetry, `the failed frame has no retry row: ${JSON.stringify(retries.map(r => r.key))}`);
      const unit = retries.filter(r => r.value.unitId === frameRetry.unitId).map(r => r.key);
      const progress = sessionProgress(root, healthy), deferred = new Set(retries.map(r => r.key));
      const frameFailure = issues.backlog.failed.find(r => r.stream === frame.stream) ?? null;
      report(t, "isolation-frame", { exercised: true, frameBytes: before.largestFrameBytes, outcome: run.outcome, reason: run.reason,
        passes: run.passes.length, frameIndexed: indexedCounts(root).get(frame.stream) ?? 0, unitMembers: unit.length,
        healthyDone: progress.filter(s => s.done).length, healthyDeferred: progress.filter(s => deferred.has(s.stream)).length, healthy: healthy.length,
        frameFailure, failedRows: failed.length, pending: issues.backlog.pending, healthRows: issues.rows.map(r => r.code) });
      assert.deepEqual(journalShape(root, frame.stream), before, "the failed frame's journal changed");
      assert.equal(indexedCounts(root).get(frame.stream) ?? 0, 0, "the failed frame was indexed");
      for (const s of progress) assert.ok(s.done || deferred.has(s.stream), `${s.stream} neither progressed nor is deferred: ${s.journal} journal, ${s.indexed} indexed of ${s.lines}`);
      assert.ok(progress.some(s => s.done), `no other stream progressed in the failing pass (${unit.length} streams in the frame's unit)`);
      assert.equal(issues.backlog.pending, true, "the failed frame leaves no pending work in health");
      if (unit.length === 1) assert.ok(frameFailure && Number.isSafeInteger(frameFailure.offset), `a single-stream failure has no failed row: ${JSON.stringify(issues.backlog.failed)}`);
      else {
        report(t, "isolation-frame-gap", { unitMembers: unit.length, nextRetryAt: frameRetry.nextRetryAt });
        t.diagnostic(`GAP: the frame failed inside a ${unit.length}-stream unit; attribution is unknown by design, so no failed row names it until its single-stream retry at ${frameRetry.nextRetryAt}.`);
      }
      // Backoff: the next pass does not retry the frame before its retry time,
      // and a new healthy stream progresses in it.
      const later = smallSessions(home, 181, 1);
      const next = await settle(t, "frame-isolation-next", root, home, { maxPasses: 1 });
      const after = stateRows(root, "capture-retry").find(r => r.key === frame.stream)?.value ?? null;
      report(t, "isolation-frame-next", { outcome: next.outcome, reason: next.reason, withoutExitReport: next.withoutExitReport, frameRetry: after });
      assert.equal(next.withoutExitReport, 0, "the deferred frame was retried and crashed a worker before its retry time");
      assert.deepEqual(after, frameRetry, "the deferred frame's retry changed before its retry time");
      assert.ok(sessionProgress(root, later)[0].done, "a new stream did not progress while the frame is deferred");
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
