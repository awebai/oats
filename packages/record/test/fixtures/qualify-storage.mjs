// The storage and durability qualification (#1108 checkpoint Q1a/Q1b), shared
// by the 1,300- and 3,000-stream files. A synthetic home's journals are made by
// the outgoing release's own capture; dropping the derived cache and index over
// them is a first upgrade, which this head then captures through the supervised
// path at production policy, followed by a no-op pass and, where asked, a small
// append. Volume is a scaled run: F = journal bytes / the operator's, and no
// full-volume time is claimed. Only completion, the no-op's bound and content
// read, and the append's committed work are asserted; the rest is reported.
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { CAPTURE_POLICY } from "../../lib/capture-budget.mjs";
import { CAPTURE_COUNT_FIELDS } from "../../lib/capture-status.mjs";
import { OPERATOR, appendSessions, cliCapture, dropDerived, installRelease, journalBytes, measuredPass, passRow,
  report, runnerFacts, scratch, syntheticHome, table, untilComplete } from "./qualify.mjs";

/** The runner's per-file bound on the Linux platform. */
export const FILE_BOUND_MS = 20 * 60_000;
export const OUTGOING = "0.61.0";
const PASS_MS = CAPTURE_POLICY.deadlineSeconds * 1000;
// Expected cost of one later phase (a no-op or append pass) and of reporting,
// not their worst case: the no-op's own assertion is the 300 s bound.
const LATER_PHASE_MS = 120_000, MARGIN_MS = 30_000;
const MB = 1e6;

// measuredPass sums every worker file it has not seen; a phase starts with an
// empty counts directory so it never re-sums an earlier phase's workers.
const freshCounts = root => fs.rmSync(`${root}.qualify-counts`, { recursive: true, force: true });
const sum = values => values.reduce((a, b) => a + b, 0);
const addInto = (total, part) => { for (const [k, n] of Object.entries(part)) total[k] = (total[k] ?? 0) + n; return total; };

/** Totals of the passes' worker counts and their receipts' committed counts. */
function totals(passes) {
  const t = { passes: passes.length, workers: 0, sqlite: { opens: 0, begins: 0, commits: 0 }, fsync: {}, rename: {}, mkdir: 0, io: {}, vmHwmBytes: 0,
    receipt: Object.fromEntries(CAPTURE_COUNT_FIELDS.map(key => [key, 0])) };
  for (const { counts, status } of passes) {
    t.workers += counts.workers; t.mkdir += counts.mkdir; t.vmHwmBytes = Math.max(t.vmHwmBytes, counts.vmHwmBytes);
    addInto(t.sqlite, counts.sqlite); addInto(t.fsync, counts.fsync); addInto(t.rename, counts.rename); addInto(t.io, counts.io);
    // Each pass is its own run, so its receipt holds only that pass's counts.
    for (const key of CAPTURE_COUNT_FIELDS) t.receipt[key] += status?.lastRun?.counts?.[key] ?? 0;
  }
  t.durabilityOps = sum(Object.values(t.fsync)) + sum(Object.values(t.rename));
  return t;
}
function reportPasses(t, label, run) {
  const rows = run.passes.map((pass, i) => passRow(`${label} ${i + 1}`, pass));
  for (const row of rows) report(t, `${label}-pass`, row);
  table(t, `${label}: passes`, rows);
  return rows;
}
const brief = rows => rows.map(r => `${r.label}: ${r.outcome}${r.reason ? `/${r.reason}` : ""} ${r.wallMs}ms committed ${r.bytesCommitted} indexed ${r.turnsIndexed}`).join("; ");

/** Q1 at `streams` streams; `append` adds the small-append case. */
export async function qualifyStorage(t, { streams, append = false, k = 50, linesEach = 3 }) {
  const began = performance.now(), elapsed = () => Math.round(performance.now() - began);
  const base = scratch(t, `qualify-storage-${streams}-`), root = join(base, "record");
  fs.mkdirSync(root);
  runnerFacts(t, { root, scratch: base });

  const synthetic = syntheticHome(base, { streams });
  const formats = Object.fromEntries(["cc", "codex", "pi"].map(f => [f, synthetic.sessions.filter(s => s.format === f).length]));
  report(t, "synthetic-home", { streams, formats, sourceBytes: synthetic.bytes, setupMs: elapsed() });

  // Journals made by the outgoing release, then its derived state dropped.
  const release = installRelease(base, OUTGOING);
  report(t, "outgoing-release", { version: release.version, integrity: release.integrity });
  const outgoing = cliCapture(release.cli, root, synthetic.home), journals = journalBytes(root);
  const scale = { F: journals.bytes / OPERATOR.journalBytes, streamRatio: journals.streams / OPERATOR.streams };
  report(t, "outgoing-capture", { version: release.version, exit: outgoing.status, signal: outgoing.signal, wallMs: outgoing.wallMs,
    journalBytes: journals.bytes, journalStreams: journals.streams, ...scale, operator: OPERATOR });
  if (outgoing.status !== 0) t.diagnostic(`outgoing capture output:\n${outgoing.stdout.slice(-4000)}${outgoing.stderr.slice(-4000)}`);
  assert.equal(outgoing.status, 0, `the outgoing ${release.version} capture exited ${outgoing.status} (signal ${outgoing.signal})`);
  assert.ok(journals.bytes > 0, "the outgoing capture wrote no journals");
  dropDerived(root);

  // First upgrade at production policy, within what the file bound leaves after
  // the last pass's own deadline and the later phases.
  const budgetMs = FILE_BOUND_MS - elapsed() - PASS_MS - (append ? 2 : 1) * LATER_PHASE_MS - MARGIN_MS;
  assert.ok(budgetMs > 0, `setup used ${elapsed()}ms of the ${FILE_BOUND_MS}ms file bound; no first-upgrade budget is left`);
  const upgrade = await untilComplete(root, synthetic.home, { budgetMs });
  const rows = reportPasses(t, "first-upgrade", upgrade), sums = totals(upgrade.passes);
  const seconds = upgrade.wallMs / 1000, megabytes = journals.bytes / MB;
  report(t, "first-upgrade", { streams, complete: upgrade.complete, budgetMs, wallMs: upgrade.wallMs, ...sums,
    journalBytes: journals.bytes, journalBytesPerSecond: Math.round(journals.bytes / seconds),
    readBytesPerSecond: sums.io.read_bytes == null ? null : Math.round(sums.io.read_bytes / seconds),
    rcharPerSecond: sums.io.rchar == null ? null : Math.round(sums.io.rchar / seconds),
    durabilityOpsPerMB: sums.durabilityOps / megabytes, sqliteCommitsPerMB: sums.sqlite.commits / megabytes,
    // Staged copies live under the record root: its filesystem type is the runner line's "root".
    stagingPath: join(root, ".capture-tmp"), ...scale, operator: OPERATOR,
    note: `scaled run (F = ${scale.F.toExponential(3)} of the operator's journal bytes): no full-volume completion time is claimed` });
  table(t, "first-upgrade: totals", [{ streams, passes: sums.passes, wallMs: upgrade.wallMs, sqliteCommits: sums.sqlite.commits,
    journalFsyncs: sums.fsync.journal ?? 0, stagingFsyncs: sums.fsync.staging ?? 0, renames: sum(Object.values(sums.rename)),
    readBytes: sums.io.read_bytes ?? null, rchar: sums.io.rchar ?? null, journalBytes: journals.bytes, F: scale.F.toExponential(3),
    bytesPerSec: Math.round(journals.bytes / seconds), durabilityOpsPerMB: (sums.durabilityOps / megabytes).toFixed(2) }]);
  assert.ok(upgrade.complete, `first upgrade at ${streams} streams did not complete within ${budgetMs}ms: ` +
    `${upgrade.passes.length} passes in ${upgrade.wallMs}ms (${brief(rows)})`);

  // No-op over the completed state: content read must be ~0 beyond metadata.
  freshCounts(root);
  const noop = await measuredPass(root, synthetic.home), row = passRow("no-op", noop), counts = noop.status?.lastRun?.counts ?? {};
  report(t, "no-op", { streams, journalStreams: journals.streams, ...row, sqliteBegins: noop.counts.sqlite.begins,
    sqliteCommitsPerStream: row.sqliteCommits / journals.streams, sqliteBeginsPerStream: noop.counts.sqlite.begins / journals.streams,
    rcharPerStream: row.rchar == null ? null : row.rchar / journals.streams, fsync: noop.counts.fsync, rename: noop.counts.rename });
  table(t, "no-op", [row]);
  assert.equal(noop.result.outcome, "complete", `no-op outcome ${noop.result.outcome}/${noop.result.reason}`);
  assert.ok(noop.wallMs < 300_000, `no-op took ${noop.wallMs}ms at ${streams} streams`);
  assert.equal(counts.bytesCommitted, 0, "a no-op commits no content");
  assert.equal(counts.turnsAppended, 0, "a no-op appends no turns");
  if (!append) return;

  // A small append to k streams, captured by fresh passes: committed work is
  // exactly the appended source bytes and lines (ordinary cursor continuation).
  freshCounts(root);
  const appendedBytes = appendSessions(synthetic, k, linesEach), appendedLines = k * linesEach;
  const grown = await untilComplete(root, synthetic.home, { budgetMs: Math.max(1, FILE_BOUND_MS - elapsed() - PASS_MS - MARGIN_MS) });
  const appendRows = reportPasses(t, "append", grown), work = totals(grown.passes);
  report(t, "append", { streams, k, appendedLines, appendedBytes, complete: grown.complete, wallMs: grown.wallMs, ...work,
    readBytesPerAppendedByte: work.io.read_bytes == null ? null : work.io.read_bytes / appendedBytes,
    rcharPerAppendedByte: work.io.rchar == null ? null : work.io.rchar / appendedBytes });
  table(t, "append: totals", [{ k, appendedLines, appendedBytes, turnsAppended: work.receipt.turnsAppended, bytesCommitted: work.receipt.bytesCommitted,
    passes: work.passes, wallMs: grown.wallMs, sqliteCommits: work.sqlite.commits, journalFsyncs: work.fsync.journal ?? 0,
    readBytes: work.io.read_bytes ?? null, rchar: work.io.rchar ?? null }]);
  assert.ok(grown.complete, `the append did not complete: ${grown.passes.length} passes (${brief(appendRows)})`);
  assert.equal(work.receipt.turnsAppended, appendedLines, "one turn per appended line");
  assert.equal(work.receipt.bytesCommitted, appendedBytes, "committed source bytes are the appended bytes");
}
