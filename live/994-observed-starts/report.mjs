// The sanitation check and the summary of one #994 live run. Run by run.sh after drive.mjs; see
// README.md. Usage: node report.mjs <out-dir>
//
// Reads every regular file of the out dir except `throwaway-home/` (Claude's own files, not
// evidence). Writes summary.txt and sanitation.json there, and nothing else. Executes nothing.
// Exit status: 0 when no file holds a forbidden string, 1 when one does (it names the files).
//
// Forbidden strings: the caller's home directory path, user name and host name; the value of a
// HOME passed in LIVE_994_EXTRA_ENV; and each string of LIVE_994_ALSO_FORBID. None of them is ever
// printed or written: a failure names the file and the class, and for LIVE_994_ALSO_FORBID the
// position of the string in the list.
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const real = (path) => { try { return realpathSync(path); } catch { return null; } };
const unique = (values) => [...new Set(values.filter((v) => typeof v === "string" && v.length > 0))];

/** LIVE_994_EXTRA_ENV as [name, value] pairs. A refusal never repeats an entry: a malformed one may
 *  be a piece of a value. */
export function parseExtraEnv(text) {
  return String(text || "").split(/\s+/).filter(Boolean).map((pair, index) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(pair);
    if (!m) throw new Error(`LIVE_994_EXTRA_ENV: entry ${index + 1} is not NAME=value (a value cannot hold a space)`);
    return [m[1], m[2]];
  });
}

/** What no written file may hold, as { class, value } rows. `home` rows are directory paths. */
export function forbidden(env = process.env) {
  // No password entry for this user (some containers): the caller's variables are all there is.
  let info = { username: null, homedir: null };
  try { info = userInfo(); } catch { /* as above */ }
  const host = hostname();
  let extraHome = null;
  try { extraHome = parseExtraEnv(env.LIVE_994_EXTRA_ENV).filter(([name]) => name === "HOME").map(([, value]) => value).pop() ?? null; } catch { /* refused by drive.mjs */ }
  const homes = (paths) => unique(paths.flatMap((p) => [p, p && real(p)])).filter((p) => p !== "/");
  return [
    ...homes([env.LIVE_994_CALLER_HOME, info.homedir]).map((value) => ({ class: "home", value })),
    ...unique([info.username, env.LIVE_994_CALLER_USER]).map((value) => ({ class: "user", value })),
    ...unique([host, host.split(".")[0]]).map((value) => ({ class: "host", value })),
    ...homes([extraHome]).map((value) => ({ class: "extra-env-home", value })),
    ...String(env.LIVE_994_ALSO_FORBID || "").split(/\s+/).filter(Boolean).map((value, index) => ({ class: `also-forbid-${index + 1}`, value })),
  ];
}

function files(dir, root = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (dir === root && entry.name === "throwaway-home") return [];
    if (entry.isDirectory()) return files(path, root);
    return lstatSync(path).isFile() ? [path] : [];
  });
}

function scan(out, rows) {
  const checked = files(out);
  const failed = [];
  for (const file of checked) {
    const bytes = readFileSync(file);
    const classes = [...new Set(rows.filter((row) => bytes.includes(Buffer.from(row.value))).map((row) => row.class))];
    if (classes.length) failed.push({ file: relative(out, file), classes });
  }
  return { checked: checked.length, notChecked: ["throwaway-home/"], classes: [...new Set(rows.map((row) => row.class))], failed };
}

const at = (ms) => (ms === null || ms === undefined ? "never" : `${ms} ms`);
const yes = (value) => (value === null || value === undefined ? "unknown" : value ? "yes" : "no");

function summary(out) {
  const read = (name) => { try { return JSON.parse(readFileSync(join(out, name), "utf8")); } catch { return null; } };
  const host = read("host.json"), verdict = read("verdict.json"), cleanup = read("cleanup.json"), chrome = read("chrome-setting.json");
  const lines = [];
  if (!host) return ["no host.json: the run stopped before it started anything"];
  lines.push(`${host.mode}${host.optOut ? ` ${host.optOut}` : ""} on ${host.platform}: Claude ${host.claudeVersion} (${host.claudeVersionSource}), `
    + `executable from ${host.executableVariable}${host.stub ? " (DRY-RUN STUB: this shows nothing about Claude)" : ""}, `
    + `pane ${host.pane?.width ?? "?"}x${host.pane?.height ?? "?"}, ${host.tmuxVersion}, oats ${host.oatsHead}`);
  if (host.extraEnvNames?.length) lines.push(`extra pane environment, by name: ${host.extraEnvNames.join(", ")}`);
  for (const row of verdict?.probe ?? []) {
    lines.push(`probe \`${row.argv.join(" ")}\`: exit ${row.exitStatus ?? `none (${row.signal ?? row.failedToStart ?? "timed out"})`}, stdout is a JSON array: ${yes(row.stdoutIsJsonArray)}, stderr: ${row.stderr ? "see below" : "empty"}`);
  }
  if (verdict && verdict.pane !== false) {
    const v = verdict, h = v.harness, s = v.settledFrame;
    lines.push(`outcome: ${v.outcome}${v.outcomeMs === null ? "" : ` at ${v.outcomeMs} ms`} (from the screen alone: ${v.screenOnlyOutcome})`);
    lines.push(`first non-blank capture: ${at(v.firstNonBlankMs)}; first capture with a marker: ${at(v.firstMarkerMs)}${v.firstMarkers.length ? ` ${JSON.stringify(v.firstMarkers)}` : ""}; `
      + `clean window completed: ${at(v.cleanWindowCompletedMs)}`);
    lines.push(`questionAfterNoPrompt: ${v.questionAfterNoPrompt}${v.questionAfterNoPrompt ? ` (no-prompt at ${v.questionAfterNoPromptTimes.cleanWindowCompletedMs} ms, the first marker at ${v.questionAfterNoPromptTimes.firstMarkerMs} ms)` : ""}`);
    lines.push(`marker captures: ${v.markerCaptures}${v.markerRuns.length ? ` in ${v.markerRuns.map((r) => `${r.captures} from ${r.fromMs} ms`).join(", ")}` : ""}; session banner first at: ${at(v.sessionBannerFirstMs)}`);
    lines.push(`harness: ${h.firstRunningMs === null ? "never read as running" : `first read as running at ${h.firstRunningMs} ms, after ${h.capturesBeforeRunning} earlier captures`}; `
      + `no longer running: ${at(h.noLongerRunningMs)}; single not-running readings: ${h.singleNotRunningReadings}; `
      + `exit file first seen: ${at(v.exitFile.firstSeenMs)}${v.exitFile.status === null ? "" : `, status ${v.exitFile.status}`}`);
    if (s) lines.push(`settled frame: ${s.frame ?? "none"}, held ${s.heldMs} ms to the end (${s.settled ? "settled" : "still changing"}); markers ${s.markers.length}, `
      + `notice blocks ${s.noticeBlocks}, session banner ${yes(s.sessionBanner)}, flag-ignored entry ${s.flagIgnoredEntry ?? "none"}`);
    if ("questionMatchedMarker" in v) lines.push(v.questionMatchedMarker
      ? "questionMatchedMarker: true (the settled frame holds a marker of the kernel's list)"
      : "questionMatchedMarker: FALSE: the settled frame holds no marker of the kernel's list. If it asks something, the kernel would not see it: read the frame");
    if ("noticeBlocksAtSettledFrame" in v) lines.push(`${host.optOut}=1: notice blocks at the settled frame: ${v.noticeBlocksAtSettledFrame}`);
    lines.push(`captures: ${v.captures} (${v.failedCaptures} failed, ${v.blankCaptures} blank, ${v.distinctFrames} distinct frames) over ${at(v.observedMs)}; `
      + `geometry changes: ${v.geometryChanges.length ? v.geometryChanges.map((g) => `${g.width}x${g.height} at ${g.ms} ms`).join(", ") : "none"}`);
    if (v.failure) lines.push(`RUN FAILED: ${v.failure}`);
    if (v.interrupted) lines.push(`interrupted by ${v.interrupted}`);
  }
  if (chrome) lines.push(`${chrome.key} in the configuration: before ${chrome.before}, after ${chrome.after}`);
  if (cleanup) lines.push(`cleanup: tmux server gone ${yes(cleanup.serverGone)}, pane process group gone ${yes(cleanup.paneProcessGroupGone)}`);
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) { console.error("usage: node report.mjs <out-dir>"); process.exit(2); }
  const lines = summary(out);
  writeFileSync(join(out, "summary.txt"), lines.join("\n") + "\n");
  const result = scan(out, forbidden());
  writeFileSync(join(out, "sanitation.json"), JSON.stringify(result, null, 2) + "\n");
  console.log("\n== summary (summary.txt in the out dir)");
  for (const line of lines) console.log(line);
  if (result.failed.length) {
    console.log(`sanitation: FAILED, ${result.failed.length} of ${result.checked} files hold a forbidden string:`);
    for (const row of result.failed) console.log(`  ${row.file}: ${row.classes.join(", ")}`);
    process.exit(1);
  }
  // A probe's stderr line is printed only once the check has passed over the file that holds it.
  let probe = null;
  try { probe = JSON.parse(readFileSync(join(out, "probe.json"), "utf8")); } catch { /* no probe in this mode */ }
  for (const row of probe ?? []) if (row.stderrFirstLine) console.log(`probe \`${row.argv.join(" ")}\` stderr, first line: ${row.stderrFirstLine}`);
  console.log(`sanitation: passed (${result.checked} files; throwaway-home/ is not checked and is not evidence)`);
}
