// Qualification Q2b (#1108 checkpoint Q): Codex in-prefix recovery shaped like
// the operator's population, whose 42 captured lines over 8 MiB lie in 5 Codex
// sessions, 12 of them over 16 MiB, the largest 22,280,296 bytes. One session
// here holds 9 such lines, 3 over 16 MiB, the largest exactly that size, among
// small lines; a release without a record limit captured it (the public
// synchronous capture writes the same journal). With the derived cache
// deleted, the capped supervised worker proves the captured prefix again: each
// staged source line is digested over chunks, while the journal side reads
// each record whole. Reported: pass and worker wall times beside the line
// sizes (no seam times one line of the proof alone), whether a later pass made
// no progress (a deadline stop restarting at a line), and journal-side peak
// memory. Asserted: recovery completes without duplicating or setting aside a
// captured line, and a later append is captured exactly once. Linux runner
// only; a skip is not evidence.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { CAPTURE_POLICY } from "../lib/capture-budget.mjs";
import { captureHealth } from "../lib/capture-state.mjs";
import { dropDerived, OPERATOR, realManagerSkip, report, runnerFacts, scratch, sessionPath, table } from "./fixtures/qualify.mjs";
import { captureHistorical, CODE, codexLine, exactLine, indexedCounts, journalShape, lastRecords, settle, smallLine,
  streamOf, writeSession } from "./fixtures/qualify-frames.mjs";

const skip = realManagerSkip("linux") ?? false;
// Captured native line sizes (body.line bytes), in source order.
const LARGE = [8_600_000, 9_300_000, 10_500_000, 12_000_000, 13_700_000, 15_400_000, 17_100_000, 19_500_000, OPERATOR.largestLineBytes];
const SMALL_RUN = 20, APPENDED = 3;

test("Q2b Codex in-prefix recovery of captured lines up to 22,280,296 bytes under the capped worker, then growth captured once", { skip, timeout: 19 * 60_000 }, async t => {
  const base = scratch(t, "qualify-inprefix-"), home = join(base, "home"), root = join(base, "record");
  fs.mkdirSync(root);
  runnerFacts(t, { root, scratch: base });
  const path = sessionPath(home, "codex", 1), session = { format: "codex", path, stream: streamOf("codex", path) };
  let n = 0;
  function* population() {
    for (const bytes of LARGE) {
      for (let i = 0; i < SMALL_RUN; i++) yield smallLine("codex", n++);
      // exactLine builds the line more than once: its number is fixed first.
      const large = n++;
      yield exactLine(text => codexLine(large, text), CODE, bytes);
    }
    for (let i = 0; i < SMALL_RUN; i++) yield smallLine("codex", n++);
  }
  const sourceBytes = writeSession(path, population()), lines = n;
  assert.equal(captureHistorical(root, [session]), lines);
  const journal = journalShape(root, session.stream);
  report(t, "inprefix-population", { lines, sourceBytes, largeLines: LARGE, over16MiB: LARGE.filter(b => b > 16 * 1024 * 1024).length,
    journalBytes: journal.bytes, largestFrameBytes: journal.largestFrameBytes,
    operator: { oversizedLines: OPERATOR.oversizedLines, oversizedSessions: OPERATOR.oversizedSessions, largestLineBytes: OPERATOR.largestLineBytes } });
  assert.equal(journal.lines, lines);

  dropDerived(root);
  // No pass starts after 11 minutes; one started may run its full 300 s, which
  // still leaves the growth pass inside the file's 20-minute bound.
  const recovery = await settle(t, "inprefix-recovery", root, home, { maxPasses: 4, budgetMs: 11 * 60_000 });
  // A pass after the first that leaves lastProgressAt where the previous one
  // left it made no durable progress: a deadline stop restarting the proof.
  const stalled = recovery.passes.slice(1).filter((pass, i) => pass.status?.lastProgressAt === recovery.passes[i].status?.lastProgressAt).length;
  const passes = recovery.passes.map((pass, i) => ({ pass: i + 1, outcome: pass.result.outcome, reason: pass.result.reason ?? "",
    wallMs: pass.wallMs, workers: pass.workers.length, workerMs: pass.workers.map(w => w.endMs === null ? null : w.endMs - w.startMs).join("/"),
    withoutExitReport: pass.workers.filter(w => !w.exitReport).length, lastProgressAt: pass.status?.lastProgressAt ?? null,
    vmHwmBytes: Math.max(0, ...pass.workers.map(w => Math.max(w.sampledHwmBytes ?? 0, w.reportedHwmBytes ?? 0))),
    rchar: pass.workers.reduce((a, w) => a + (w.rchar ?? 0), 0) }));
  table(t, "Q2b in-prefix recovery passes (capped worker, production policy)", passes);
  const proof = { largestLineBytes: OPERATOR.largestLineBytes, largestFrameBytes: journal.largestFrameBytes, complete: recovery.complete,
    outcome: recovery.outcome, reason: recovery.reason, passes: recovery.passes.length, wallMs: recovery.wallMs,
    passWallMs: passes.map(p => p.wallMs), stalledPasses: stalled, restartSuspected: recovery.passes.length > 1 && stalled > 0,
    journalSidePeak: { vmHwmBytes: recovery.vmHwmBytes, statusPeakRssBytes: recovery.peakRssBytes, heapUsedAtExitBytes: recovery.heapUsedAtExitBytes, heapMiB: CAPTURE_POLICY.heapMiB },
    attribution: "pass and worker wall times; no seam isolates the proof of one line" };
  report(t, "inprefix-proof", proof);
  assert.equal(recovery.complete, true, `in-prefix recovery did not complete: ${JSON.stringify(proof)}`);
  const recovered = journalShape(root, session.stream), issues = captureHealth(root, { home });
  assert.deepEqual(recovered, journal, "recovery rewrote or duplicated captured lines");
  assert.equal(indexedCounts(root).get(session.stream), lines);
  // Records already captured are not refused, whatever their size.
  assert.equal(issues.backlog.setAsideCount, 0, `captured lines were set aside: ${JSON.stringify(issues.backlog.setAside)}`);

  const appended = Array.from({ length: APPENDED }, () => smallLine("codex", n++));
  writeSession(path, appended, { append: true });
  const growth = await settle(t, "inprefix-growth", root, home, { budgetMs: 3 * 60_000 });
  report(t, "inprefix-growth", { complete: growth.complete, outcome: growth.outcome, reason: growth.reason, passes: growth.passes.length,
    wallMs: growth.wallMs, vmHwmBytes: growth.vmHwmBytes, rchar: growth.passes.flatMap(p => p.workers).reduce((a, w) => a + (w.rchar ?? 0), 0) });
  assert.equal(growth.complete, true, `growth capture did not complete: ${growth.outcome}/${growth.reason}`);
  assert.equal(journalShape(root, session.stream).lines, lines + APPENDED, "the appended lines were not captured exactly once");
  assert.deepEqual(lastRecords(root, session.stream, APPENDED).map(turn => [turn.body.line, turn.provenance.origin.line]), appended.map((line, i) => [line, lines + i + 1]));
  assert.equal(indexedCounts(root).get(session.stream), lines + APPENDED);
});
