// The verdict of one #994 live run, computed from timeline.json alone. See README.md, "How to read
// the verdict". Usage: node verdict.mjs <out-dir>   (prints the verdict again; writes nothing)
//
// The rule, for a start that expects no confirmation (issue #994, decision 6133250945):
//   - a capture is CLEAN when it is non-blank and holds no question marker;
//   - the first capture with a marker ends the start as `blocked: unexpected prompt`;
//   - the harness no longer running ends it as `blocked: harness exited`;
//   - CLEAN_WINDOW_MS of consecutive clean captures ends it as `no-prompt` (a blank capture, a
//     capture with a marker or a failed capture restarts the window);
//   - none of them by the end of the observation is `blocked: observation timeout`.
// Whichever comes first decides. The witness goes on capturing after that, which is the point: the
// verdict says whether a question was first painted after the rule had already answered `no-prompt`.
//
// This file reads no screen text: only the rows drive.mjs wrote (times, booleans, counts and the
// kernel's own marker strings).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The settle window of lib/launch-prompts.mjs (`SETTLE`, not exported). */
export const CLEAN_WINDOW_MS = 2000;
/** The modes whose screen is expected to ask something. */
export const QUESTION_MODES = ["trust", "chrome-offer"];

export function judge(timeline) {
  const rows = Array.isArray(timeline.rows) ? timeline.rows : [];
  const ok = rows.filter((r) => !r.failed);
  const marked = ok.filter((r) => r.markers.length > 0);

  // Each stretch of consecutive captures that held a marker, so one that was on screen for a
  // single capture shows as `captures: 1`.
  const markerRuns = [];
  let run = null;
  for (const r of rows) {
    if (r.failed || r.markers.length === 0) { run = null; continue; }
    if (!run) markerRuns.push(run = { fromMs: r.ms, toMs: r.ms, captures: 0, markers: [] });
    run.toMs = r.ms;
    run.captures += 1;
    for (const m of r.markers) if (!run.markers.includes(m)) run.markers.push(m);
  }

  // The first clean window anywhere in the timeline: where it began and the capture that completed it.
  let began = null, cleanWindowStartMs = null, cleanWindowCompletedMs = null;
  for (const r of rows) {
    if (r.failed || r.blank || r.markers.length > 0) { began = null; continue; }
    began ??= r.ms;
    if (r.ms - began >= CLEAN_WINDOW_MS) { cleanWindowStartMs = began; cleanWindowCompletedMs = r.ms; break; }
  }

  // The harness is no longer running at the first of two consecutive not-running readings: at the
  // first capture the pane's shell may not have started the executable yet, which reads the same.
  // A single not-running reading is counted, never judged.
  const readings = rows.filter((r) => typeof r.harnessRunning === "boolean");
  let exitedMs = null, singleNotRunningReadings = 0;
  readings.forEach((r, i) => {
    if (r.harnessRunning) return;
    const before = readings[i - 1], after = readings[i + 1];
    if (exitedMs === null && after && after.harnessRunning === false) exitedMs = r.ms;
    if ((!before || before.harnessRunning) && (!after || after.harnessRunning)) singleNotRunningReadings += 1;
  });
  const firstRunning = readings.findIndex((r) => r.harnessRunning);

  const firstMarkerMs = marked[0]?.ms ?? null;
  // On a tie the process decides before the screen: a harness that is gone asks nothing.
  const decide = (events) => events.filter(([at]) => at !== null).sort((a, b) => a[0] - b[0])[0] ?? [null, "blocked: observation timeout"];
  const [outcomeMs, outcome] = decide([[exitedMs, "blocked: harness exited"], [firstMarkerMs, "blocked: unexpected prompt"], [cleanWindowCompletedMs, "no-prompt"]]);
  // What the same rule answers from the screen alone, without the pane's process.
  const [, screenOnlyOutcome] = decide([[firstMarkerMs, "blocked: unexpected prompt"], [cleanWindowCompletedMs, "no-prompt"]]);
  const questionAfterNoPrompt = outcome === "no-prompt" && firstMarkerMs !== null;

  // The settled frame: the last frame of the observation, and how long it had held unchanged.
  let settledFrame = null;
  if (ok.length) {
    const last = ok[ok.length - 1];
    let first = last;
    for (let i = ok.length - 1; i >= 0; i--) { first = ok[i]; if (ok[i].changed) break; }
    const heldMs = last.ms - first.ms;
    settledFrame = { ms: first.ms, lastMs: last.ms, heldMs, settled: heldMs >= CLEAN_WINDOW_MS, frame: first.frame ?? null,
      blank: last.blank, markers: last.markers, sessionBanner: last.sessionBanner, noticeBlocks: last.noticeBlocks,
      flagIgnoredEntry: last.flagIgnoredEntry ?? null };
  }

  const exitRow = rows.find((r) => r.exitFile);
  return {
    live: "awebai/oats#994", mode: timeline.mode, ...(timeline.optOut ? { optOut: timeline.optOut } : {}),
    rule: { cleanWindowMs: CLEAN_WINDOW_MS, intervalMs: timeline.intervalMs ?? null },
    outcome, outcomeMs, screenOnlyOutcome,
    firstNonBlankMs: ok.find((r) => !r.blank)?.ms ?? null,
    firstMarkerMs, firstMarkers: marked[0]?.markers ?? [],
    cleanWindowStartMs, cleanWindowCompletedMs,
    questionAfterNoPrompt,
    questionAfterNoPromptTimes: questionAfterNoPrompt ? { cleanWindowCompletedMs, firstMarkerMs } : null,
    markerCaptures: marked.length, markerRuns,
    sessionBannerFirstMs: ok.find((r) => r.sessionBanner)?.ms ?? null,
    harness: {
      readings: readings.length,
      firstRunningMs: firstRunning < 0 ? null : readings[firstRunning].ms,
      // How many readings passed before the executable was first seen under the pane's process.
      readingsBeforeRunning: firstRunning < 0 ? null : firstRunning,
      firstNotRunningMs: readings.find((r) => !r.harnessRunning)?.ms ?? null,
      noLongerRunningMs: exitedMs,
      singleNotRunningReadings,
    },
    exitFile: { firstSeenMs: exitRow?.ms ?? null, status: timeline.exitStatus ?? null },
    settledFrame,
    ...(QUESTION_MODES.includes(timeline.mode) ? { questionMatchedMarker: settledFrame ? settledFrame.markers.length > 0 : null } : {}),
    ...(timeline.mode === "approved-optout" ? { noticeBlocksAtSettledFrame: settledFrame?.noticeBlocks ?? null } : {}),
    captures: rows.length, failedCaptures: rows.length - ok.length, blankCaptures: ok.filter((r) => r.blank).length,
    distinctFrames: ok.filter((r) => r.changed).length,
    geometryChanges: ok.filter((r) => r.geometryChanged).map((r) => ({ ms: r.ms, width: r.width, height: r.height })),
    observedMs: rows.length ? rows[rows.length - 1].ms : null,
    failure: timeline.failure ?? null, interrupted: timeline.interrupted ?? null,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) { console.error("usage: node verdict.mjs <out-dir>"); process.exit(2); }
  console.log(JSON.stringify(judge(JSON.parse(readFileSync(join(out, "timeline.json"), "utf8"))), null, 2));
}
