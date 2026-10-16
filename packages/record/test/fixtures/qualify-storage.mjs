// The storage and durability qualification (#1108 checkpoint Q1a/Q1b), shared
// by the 1,300- and 3,000-stream files. A synthetic home's journals are made by
// the outgoing release's own capture; dropping the derived cache and index over
// them is a first upgrade, which this head then captures through the supervised
// path at production policy, followed by a no-op pass and, where asked, a small
// append. Volume is a scaled run: F = journal bytes / the operator's, and no
// full-volume time is claimed. Only completion, the no-op's bound and content
// read, and the append's committed work are asserted; the rest is reported.
// Every phase ends before the test's timeout: a pass starts only with a whole
// pass's reserve left, and a phase without it is reported as not run.
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { CAPTURE_COUNT_FIELDS } from "../../lib/capture-status.mjs";
import { OPERATOR, REPORT_MARGIN_MS, TEST_TIMEOUT_MS, appendSessions, cliCapture, dropDerived, installRelease, journalBytes,
  measuredPass, passReserveMs, passRow, readBreakdown, report, runnerFacts, scratch, sumReads, syntheticHome, table, untilComplete } from "./qualify.mjs";

export const OUTGOING = "0.61.0";
const MB = 1e6;
// Source and journal bytes a no-op over unchanged, completed inputs may read
// per stream: none. A native unit returns unchanged before any source or
// journal read (lib/capture-native-unit.mjs:97 compares versions without a
// probe, :117 returns); an AW unit's journal validation returns its complete
// checkpoint unread (lib/store.mjs:473, from lib/capture-aw-unit.mjs:43), and
// it returns unchanged without a witness read (:52, :63); the index's one-byte
// boundary read happens only behind the journal (lib/index-capture.mjs:14,
// lib/index-db.mjs:163); repairTail reads only on append (lib/store.mjs:652).
const NOOP_CONTENT_BYTES_PER_STREAM = 0;
// The cache-probe no-op's SQLite page cache: 256 MiB (negative is KiB), under
// the production RSS cap. The operation's own setting is 2 MiB.
const PROBE_CACHE_SIZE = -262144;

const sum = values => values.reduce((a, b) => a + b, 0);
const addInto = (total, part) => { for (const [k, n] of Object.entries(part)) total[k] = (total[k] ?? 0) + n; return total; };

/** Totals of the passes' worker counts and their receipts' committed counts. */
function totals(passes) {
  const t = { passes: passes.length, starts: 0, workers: 0, uncounted: 0, sqlite: { opens: 0, begins: 0, commits: 0 }, fsync: {}, rename: {}, mkdir: 0, readBytes: {}, io: {}, vmHwmBytes: 0,
    receipt: Object.fromEntries(CAPTURE_COUNT_FIELDS.map(key => [key, 0])) };
  for (const { counts, status, result } of passes) {
    // Workers killed without their exit report are missing from the sums below.
    t.starts += result.starts ?? 0; t.uncounted += (result.starts ?? 0) - counts.workers;
    t.workers += counts.workers; t.mkdir += counts.mkdir; t.vmHwmBytes = Math.max(t.vmHwmBytes, counts.vmHwmBytes);
    addInto(t.sqlite, counts.sqlite); addInto(t.fsync, counts.fsync); addInto(t.rename, counts.rename); addInto(t.readBytes, counts.readBytes); addInto(t.io, counts.io);
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
  const end = began + TEST_TIMEOUT_MS - REPORT_MARGIN_MS, left = () => end - performance.now(), reserve = passReserveMs();
  const base = scratch(t, `qualify-storage-${streams}-`), root = join(base, "record");
  fs.mkdirSync(root);
  runnerFacts(t, { root, scratch: base });

  // What any pass reads with no content: an empty home into a fresh root.
  const empty = join(base, "home-empty"), baselineRoot = join(base, "record-baseline");
  fs.mkdirSync(empty); fs.mkdirSync(baselineRoot);
  const baseline = await measuredPass(baselineRoot, empty), baselineRow = passRow("baseline", baseline);
  report(t, "baseline", baselineRow);

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

  // First upgrade at production policy, leaving a whole pass each for the
  // no-op and the cache probe and, where asked, at least one for the append.
  const budgetMs = Math.round(left() - (append ? 3 : 2) * reserve);
  if (budgetMs < reserve) report(t, "first-upgrade", { streams, ran: false, reason: "file bound", leftMs: Math.round(left()), setupMs: elapsed() });
  assert.ok(budgetMs >= reserve, `setup used ${elapsed()}ms of the ${TEST_TIMEOUT_MS}ms test bound; no first-upgrade pass fits`);
  const upgrade = await untilComplete(root, synthetic.home, { budgetMs });
  const rows = reportPasses(t, "first-upgrade", upgrade), sums = totals(upgrade.passes);
  const contentRead = { source: sums.readBytes.source ?? 0, journal: sums.readBytes.journal ?? 0, byKind: sums.readBytes };
  const seconds = upgrade.wallMs / 1000, megabytes = journals.bytes / MB;
  report(t, "first-upgrade", { streams, complete: upgrade.complete, budgetMs, wallMs: upgrade.wallMs, ...sums, contentRead,
    journalBytes: journals.bytes, journalBytesPerSecond: Math.round(journals.bytes / seconds),
    readBytesPerSecond: sums.io.read_bytes == null ? null : Math.round(sums.io.read_bytes / seconds),
    rcharPerSecond: sums.io.rchar == null ? null : Math.round(sums.io.rchar / seconds),
    durabilityOpsPerMB: sums.durabilityOps / megabytes, sqliteCommitsPerMB: sums.sqlite.commits / megabytes,
    // Staged copies live under the record root: its filesystem type is the runner line's "root".
    stagingPath: join(root, ".capture-tmp"), ...scale, operator: OPERATOR,
    note: `scaled run (F = ${scale.F.toExponential(3)} of the operator's journal bytes): no full-volume completion time is claimed` });
  // Where the first upgrade's reads went, reported only: path classes, call
  // sites, and each source and journal file's bytes read over its size.
  const bases = { home: synthetic.home, root };
  report(t, "first-upgrade-reads", { streams, ...readBreakdown(sumReads(upgrade.passes.map(pass => pass.reads)), { bases }) });
  table(t, "first-upgrade: totals", [{ streams, passes: sums.passes, uncounted: sums.uncounted, wallMs: upgrade.wallMs, sqliteCommits: sums.sqlite.commits,
    journalFsyncs: sums.fsync.journal ?? 0, stagingFsyncs: sums.fsync.staging ?? 0, renames: sum(Object.values(sums.rename)),
    readBytes: sums.io.read_bytes ?? null, rchar: sums.io.rchar ?? null, journalBytes: journals.bytes, F: scale.F.toExponential(3),
    bytesPerSec: Math.round(journals.bytes / seconds), durabilityOpsPerMB: (sums.durabilityOps / megabytes).toFixed(2) }]);
  assert.ok(upgrade.complete, `first upgrade at ${streams} streams did not complete within ${budgetMs}ms: ` +
    `${upgrade.passes.length} passes in ${upgrade.wallMs}ms (${brief(rows)})`);
  // The read counters see the operation: a first upgrade reads sources and journals.
  assert.ok(contentRead.source > 0 && contentRead.journal > 0, `the read counters saw no first-upgrade source or journal bytes: ${JSON.stringify(contentRead.byKind)}`);

  // No-op over the completed state: it reads no content, only metadata.
  // The first upgrade's budget left it a whole pass.
  const noop = await measuredPass(root, synthetic.home), row = passRow("no-op", noop), counts = noop.status?.lastRun?.counts ?? {};
  const sourceStreams = synthetic.sessions.length + synthetic.logs;
  const read = { source: row.sourceRead, journal: row.journalRead, byKind: noop.counts.readBytes,
    boundBytes: NOOP_CONTENT_BYTES_PER_STREAM * sourceStreams, perStream: NOOP_CONTENT_BYTES_PER_STREAM, sourceStreams,
    // rchar also holds SQLite's page reads, which the spec allows: reported, not asserted.
    rchar: row.rchar, baselineRchar: baselineRow.rchar, excessRchar: row.rchar == null || baselineRow.rchar == null ? null : row.rchar - baselineRow.rchar,
    sourceBytes: synthetic.bytes };
  report(t, "no-op", { streams, journalStreams: journals.streams, ...row, sqliteBegins: noop.counts.sqlite.begins,
    sqliteCommitsPerStream: row.sqliteCommits / journals.streams, sqliteBeginsPerStream: noop.counts.sqlite.begins / journals.streams,
    rcharPerStream: row.rchar == null ? null : row.rchar / journals.streams, read, fsync: noop.counts.fsync, rename: noop.counts.rename });
  table(t, "no-op", [row, baselineRow]);
  report(t, "no-op-reads", { streams, ...readBreakdown(noop.reads, { bases }) });
  assert.equal(noop.result.outcome, "complete", `no-op outcome ${noop.result.outcome}/${noop.result.reason}`);
  assert.ok(noop.wallMs < 300_000, `no-op took ${noop.wallMs}ms at ${streams} streams`);
  assert.equal(counts.bytesCommitted, 0, "a no-op commits no content");
  assert.equal(counts.turnsAppended, 0, "a no-op appends no turns");
  assert.ok(read.source + read.journal <= read.boundBytes, `the no-op read ${read.source} source and ${read.journal} journal bytes ` +
    `over ${sourceStreams} unchanged sources (bound ${read.boundBytes}): ${JSON.stringify(read.byKind)}`);

  // Cache probe, reported only: the same no-op with a SQLite page cache large
  // enough for the derived databases. Reads that grow faster than the stream
  // count but turn linear here are page-cache misses; rows changed per pass
  // show whether a no-op rewrites per-stream bookkeeping.
  const probe = await measuredPass(root, synthetic.home, { cacheSize: PROBE_CACHE_SIZE }), probeRow = passRow("no-op, large cache", probe);
  const perStream = value => value == null ? null : Math.round(value / sourceStreams);
  const compare = [row, probeRow].map(r => ({ label: r.label, outcome: r.outcome, wallMs: r.wallMs, rchar: r.rchar, rcharPerStream: perStream(r.rchar),
    sqliteChanges: r.sqliteChanges, changesPerStream: r.sqliteChanges == null ? null : r.sqliteChanges / sourceStreams, sqliteCommits: r.sqliteCommits }));
  report(t, "no-op-cache-probe", { streams, sourceStreams, cacheSize: { default: "operation's own (-2048)", probe: PROBE_CACHE_SIZE }, rows: compare,
    probeBytesCommitted: probe.status?.lastRun?.counts?.bytesCommitted ?? null });
  table(t, "no-op: default cache vs large cache (reported, not asserted)", compare);
  if (!append) return;

  // A small append to k streams, captured by fresh passes: committed work is
  // exactly the appended source bytes and lines (ordinary cursor continuation).
  const appendedBytes = appendSessions(synthetic, k, linesEach), appendedLines = k * linesEach;
  if (left() < reserve) report(t, "append", { streams, ran: false, reason: "file bound", leftMs: Math.round(left()) });
  const grown = await untilComplete(root, synthetic.home, { budgetMs: left() });
  const appendRows = reportPasses(t, "append", grown), work = totals(grown.passes);
  report(t, "append", { streams, k, appendedLines, appendedBytes, complete: grown.complete, wallMs: grown.wallMs, ...work,
    readBytesPerAppendedByte: work.io.read_bytes == null ? null : work.io.read_bytes / appendedBytes,
    rcharPerAppendedByte: work.io.rchar == null ? null : work.io.rchar / appendedBytes });
  table(t, "append: totals", [{ k, appendedLines, appendedBytes, turnsAppended: work.receipt.turnsAppended, bytesCommitted: work.receipt.bytesCommitted,
    passes: work.passes, uncounted: work.uncounted, wallMs: grown.wallMs, sqliteCommits: work.sqlite.commits, journalFsyncs: work.fsync.journal ?? 0,
    readBytes: work.io.read_bytes ?? null, rchar: work.io.rchar ?? null }]);
  assert.ok(grown.complete, `the append did not complete: ${grown.passes.length} passes (${brief(appendRows)})`);
  assert.equal(work.receipt.turnsAppended, appendedLines, "one turn per appended line");
  assert.equal(work.receipt.bytesCommitted, appendedBytes, "committed source bytes are the appended bytes");
}
