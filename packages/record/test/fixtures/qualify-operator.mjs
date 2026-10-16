// The operator-shaped first upgrade (#1108 checkpoint Q, B): most bytes in
// sessions over 8 MiB, recovered on the retained path, beside the small-session
// tail, at about 1,300 and 3,000 streams. The large sessions keep the
// operator's proportion (5 among 1,315 streams) and a fixed size, so the shape
// is the same at both counts and the volume is scaled by a stated F. Journals
// are written by the public synchronous capture (the journal format every
// release writes), then the derived state is dropped and this head recovers
// through supervised passes at production policy. Only completion is asserted;
// wall time, passes and read amplification are reported for the bars on #1108.
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { CAPTURE_POLICY } from "../../lib/capture-budget.mjs";
import { SMALL_SNAPSHOT_BYTES } from "../../lib/capture-small-snapshot.mjs";
import { OPERATOR, REPORT_MARGIN_MS, TEST_TIMEOUT_MS, dropDerived, journalBytes, passRow, readBreakdown, report, runnerFacts,
  scratch, sumReads, syntheticHome, table, untilComplete } from "./qualify.mjs";
import { captureHistorical } from "./qualify-frames.mjs";

const MiB = 1024 * 1024;
// One large session per this many streams, as the operator's five among 1,315.
const STREAMS_PER_LARGE = OPERATOR.streams / OPERATOR.oversizedSessions;
const LARGE_BYTES = 40 * MiB, LARGE_LINE_BYTES = 64 * 1024;

/** Bytes read over bytes held, for the sources at `paths`. */
function amplification(files, paths) {
  let read = 0, size = 0;
  for (const path of paths) { read += files[path]?.bytes ?? 0; size += fs.statSync(path).size; }
  return { sources: paths.length, sizeBytes: size, bytesRead: read, ratio: size ? Math.round(read / size * 100) / 100 : null };
}

/** The operator-shaped first upgrade at `streams` streams. */
export async function qualifyOperatorShaped(t, { streams }) {
  const began = performance.now(), end = began + TEST_TIMEOUT_MS - REPORT_MARGIN_MS;
  const base = scratch(t, `qualify-operator-${streams}-`), root = join(base, "record");
  fs.mkdirSync(root);
  runnerFacts(t, { root, scratch: base });

  const large = Math.round(streams / STREAMS_PER_LARGE);
  const synthetic = syntheticHome(base, { streams, large, largeBytes: LARGE_BYTES, largeLineBytes: LARGE_LINE_BYTES, accounts: 0 });
  const retained = synthetic.sessions.filter(s => fs.statSync(s.path).size > SMALL_SNAPSHOT_BYTES).map(s => s.path);
  const tail = synthetic.sessions.filter(s => !retained.includes(s.path)).map(s => s.path);
  const retainedBytes = retained.reduce((sum, path) => sum + fs.statSync(path).size, 0);
  const shape = { streams, largeSessions: large, largeBytes: LARGE_BYTES, largeLineBytes: LARGE_LINE_BYTES, retainedSources: retained.length,
    retainedBytes, tailSources: tail.length, tailBytes: synthetic.bytes - retainedBytes, sourceBytes: synthetic.bytes,
    retainedShare: Math.round(retainedBytes / synthetic.bytes * 1000) / 1000, F: synthetic.bytes / OPERATOR.journalBytes, operator: OPERATOR };
  report(t, "operator-shape", shape);
  assert.equal(retained.length, large, "every large session is over the retained-path threshold");

  const historical = performance.now();
  captureHistorical(root, synthetic.sessions);
  const journals = journalBytes(root);
  report(t, "operator-journals", { journalBytes: journals.bytes, journalStreams: journals.streams, wallMs: Math.round(performance.now() - historical),
    writer: "public synchronous captureSessions (no record limit)" });
  dropDerived(root);

  const upgrade = await untilComplete(root, synthetic.home, { budgetMs: end - performance.now() });
  const rows = upgrade.passes.map((pass, i) => passRow(`first upgrade ${i + 1}`, pass));
  for (const row of rows) report(t, "operator-pass", row);
  table(t, `operator-shaped first upgrade at ${streams} streams: passes`, rows);
  const reads = sumReads(upgrade.passes.map(pass => pass.reads)), files = reads.files.source;
  const bytesRead = upgrade.passes.reduce((sum, pass) => sum + Object.values(pass.counts.readBytes).reduce((a, b) => a + b, 0), 0);
  const rchar = upgrade.passes.reduce((sum, pass) => sum + (pass.counts.io.rchar ?? 0), 0);
  const summary = { streams, complete: upgrade.complete, stalled: upgrade.stalled, passes: upgrade.passes.length, wallMs: upgrade.wallMs,
    passDeadlineMs: CAPTURE_POLICY.deadlineSeconds * 1000, wallShareOfOnePass: Math.round(upgrade.wallMs / (CAPTURE_POLICY.deadlineSeconds * 1000) * 1000) / 1000,
    retained: amplification(files, retained), tail: amplification(files, tail), bytesRead, rchar,
    bytesReadPerSourceByte: Math.round(bytesRead / synthetic.bytes * 100) / 100, journalBytes: journals.bytes, ...shape };
  report(t, "operator-first-upgrade", summary);
  report(t, "operator-first-upgrade-reads", { streams, ...readBreakdown(reads, { bases: { home: synthetic.home, root } }) });
  table(t, `operator-shaped first upgrade at ${streams} streams (reported against the #1108 bars, not asserted)`, [{
    streams, passes: summary.passes, wallMs: summary.wallMs, wallShareOfOnePass: summary.wallShareOfOnePass,
    retainedRatio: summary.retained.ratio, tailRatio: summary.tail.ratio, bytesRead, rchar, sourceBytes: synthetic.bytes, F: shape.F.toExponential(3) }]);
  assert.ok(upgrade.complete, `the operator-shaped first upgrade at ${streams} streams did not complete: ${upgrade.passes.length} passes in ${upgrade.wallMs} ms` +
    `${upgrade.stalled ? " (stalled)" : ""}, last ${rows.at(-1)?.outcome}/${rows.at(-1)?.reason}`);
}
