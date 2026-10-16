// Qualification Q1c (#1108 checkpoint Q): memory scaling with caps disabled.
// Peak RSS of a first capture at N = 300, 1,300 and 3,000 streams of one fixed
// session shape, so only the stream count varies, and the least-squares slope in
// bytes per stream. Caps off concerns the memory caps only: heap and RSS are
// raised, the production 300 s pass deadline stays. Runs only on the dispatched
// "Linux tests" runner; a skip is not evidence. Measurements are reported; the
// only assertion is that each N completes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { CAPTURE_POLICY } from "../lib/capture-budget.mjs";
import { nativeLine, passRow, realManagerSkip, report, runnerFacts, scratch, sessionPath, table, untilComplete } from "./fixtures/qualify.mjs";

const skip = realManagerSkip("linux") ?? false;
const CAPS_OFF = Object.freeze({ ...CAPTURE_POLICY, heapMiB: 4096, rssBytes: 16 * 1024 ** 3 });
const SIZES = [300, 1300, 3000], LINES = 20, LINE_BYTES = 400;
// The file must fit the runner's 20-minute bound. A pass may run to its 300 s
// deadline after untilComplete's budget check, so each N's budget leaves that
// reserve before the file's end.
const FILE_MS = 19 * 60_000, PASS_RESERVE_MS = 330_000;

/** N sessions of exactly LINES lines of about LINE_BYTES each (cc/codex/pi by
 *  n % 10 as 7/2/1): the same per-stream shape at every N.
 *  → { home, bytes, lines } */
function fixedHome(base, streams) {
  const home = join(base, `home-${streams}`);
  let bytes = 0;
  for (let n = 0; n < streams; n++) {
    const format = n % 10 < 7 ? "cc" : n % 10 < 9 ? "codex" : "pi", path = sessionPath(home, format, n);
    const text = Array.from({ length: LINES }, (_, i) => nativeLine(format, n * 100_000 + i, LINE_BYTES)).join("");
    fs.mkdirSync(join(path, ".."), { recursive: true }); fs.writeFileSync(path, text); bytes += Buffer.byteLength(text);
  }
  return { home, bytes, lines: streams * LINES };
}
const max = values => values.reduce((a, b) => b === null || b === undefined ? a : Math.max(a ?? 0, b), null);
/** Least-squares slope and intercept of y on x over the points with a y. */
function fit(points) {
  const usable = points.filter(([, y]) => Number.isFinite(y));
  if (usable.length < 2) return { points: usable.length, slope: null, intercept: null };
  const mx = usable.reduce((a, [x]) => a + x, 0) / usable.length, my = usable.reduce((a, [, y]) => a + y, 0) / usable.length;
  const slope = usable.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / usable.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  return { points: usable.length, slope: Math.round(slope), intercept: Math.round(my - slope * mx) };
}

test("Q1c caps disabled: peak RSS of a first capture at N = 300, 1,300 and 3,000 fixed-shape streams, and its slope", { skip, timeout: 20 * 60_000 }, async t => {
  const began = performance.now(), base = scratch(t, "qualify-memory-");
  fs.mkdirSync(join(base, "record-300"));
  runnerFacts(t, { root: join(base, "record-300"), scratch: base });
  report(t, "memory-policy", { policy: CAPS_OFF, lines: LINES, lineBytes: LINE_BYTES });
  const rows = [];
  for (const streams of SIZES) {
    const root = join(base, `record-${streams}`), synthetic = fixedHome(base, streams);
    const budgetMs = Math.max(1, began + FILE_MS - performance.now() - PASS_RESERVE_MS);
    const run = await untilComplete(root, synthetic.home, { policy: CAPS_OFF, budgetMs });
    table(t, `Q1c N=${streams} passes`, run.passes.map((pass, i) => passRow(`pass ${i + 1}`, pass)));
    const row = { streams, homeBytes: synthetic.bytes, lines: synthetic.lines, complete: run.complete, passes: run.passes.length,
      wallMs: run.wallMs, peakRssBytes: max(run.passes.map(pass => pass.status?.lastRun?.peakRssBytes)),
      vmHwmBytes: max(run.passes.map(pass => pass.counts.vmHwmBytes)), lastOutcome: run.passes.at(-1)?.result.outcome ?? null,
      lastReason: run.passes.at(-1)?.result.reason ?? null };
    report(t, "memory-scaling", row); rows.push(row);
    // Only the measurements stay; the next N starts from a fresh root and home.
    for (const path of [root, `${root}.qualify-counts`, synthetic.home]) fs.rmSync(path, { recursive: true, force: true });
  }
  const slopes = { peakRss: fit(rows.map(r => [r.streams, r.peakRssBytes])), vmHwm: fit(rows.map(r => [r.streams, r.vmHwmBytes])) };
  report(t, "memory-slope", { unit: "bytes per stream", ...slopes, completeAtEveryN: rows.every(r => r.complete) });
  table(t, "Q1c peak RSS by stream count (caps disabled)", rows.map(({ streams, homeBytes, complete, passes, wallMs, peakRssBytes, vmHwmBytes }) =>
    ({ streams, homeBytes, complete, passes, wallMs, peakRssBytes, vmHwmBytes })));
  table(t, "Q1c least-squares slope", [{ measure: "status peakRssBytes", ...slopes.peakRss }, { measure: "worker VmHWM", ...slopes.vmHwm }]);
  for (const row of rows) assert.equal(row.complete, true, `N=${row.streams} did not complete: ${row.passes} passes in ${row.wallMs} ms, last ${row.lastOutcome}/${row.lastReason}`);
});
