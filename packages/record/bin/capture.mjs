#!/usr/bin/env node
// capture — land sessions and aw client logs in the turn record.
//
// The flag list lives in USAGE below, once, so `--help` and this header
// cannot drift apart.
//
// An unrecognized flag or a positional argument is a usage error, never a
// silently ignored option: parsing falls through to pass(), a WRITE, so it
// must refuse what it does not understand before anything is written.
//
// Privacy: `<root>/ignore` lists glob patterns (paths, session ids,
// accounts) whose sources are never captured — see lib/ignore.mjs.
// Reconciliation is the capture; hooks and watch only decide when to run it.

import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync, watch } from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import process from "node:process";

import { RecordStore } from "../lib/store.mjs";
import { captureSessions } from "../lib/capture-cc.mjs";
import { sessionsForHome } from "../lib/sessions-for-home.mjs";
import { SESSION_FORMATS } from "../lib/formats.mjs";
import { cwdOfLine } from "../lib/sessions-for-home.mjs";
import { stageSnapshot } from "../lib/session-snapshot.mjs";
import { cleanupCaptureScratch } from "../lib/capture-scratch.mjs";
import { bufferLines } from "../lib/file-lines.mjs";
import { withReceiptSummaries } from "../lib/receipt-summary.mjs";
import { RecordIndex } from "../lib/index-db.mjs";
import { IgnoreError, ignoreFilePath, loadIgnore } from "../lib/ignore.mjs";
import { CAPTURE_SOURCES, captureHealth, resetSourceCursors, writeCaptureStatus } from "../lib/capture-state.mjs";
import { acquireCaptureLock } from "../lib/capture-lock.mjs";
import { captureHealthForDoctor } from "../lib/capture-health.mjs";
import { captureDefaultRootPlan, resolveCaptureDefaultRoots } from "../lib/capture-default-roots.mjs";
import { captureCommandPass, reportLockInitializationFailure, reportReclaimedLock, releaseDetail } from "../lib/capture-command-output.mjs";
import { captureCommandEntry } from "../lib/capture-command.mjs";
import { captureSignalPoll } from "../lib/capture-supervisor.mjs";
import { captureWatchQueue } from "../lib/capture-watch.mjs";
import { launchCaptureHook } from "../lib/capture-hook.mjs";

// Fail closed but actionably: an unreadable ignore file must stop capture,
// as one clear line naming the file — never an uncaught stack trace.
class PrintedCaptureFailure extends Error {}
function loadIgnoreForCommand(recordRoot) {
  try {
    return loadIgnore(recordRoot);
  } catch (err) {
    console.error(err instanceof IgnoreError ? err.message : String(err));
    throw new PrintedCaptureFailure();
  }
}

// Every flag this program understands. An unknown flag is rejected rather
// than ignored, because the fall-through from argument parsing is pass() —
// a WRITE. `capture --help` was once a full reconciliation pass under a
// hostname-derived owner, which forked the whole record into a second owner
// namespace: 571 duplicate journals from one typo. Parsing must refuse what
// it does not understand before anything can be written.
const VALUE_FLAGS = new Set(["root", "owner", "home", "file", "format", "source"]);
const BOOL_FLAGS = new Set([
  "hook",
  "reset-cursors",
  "retry-set-aside",
  "health",
  "watch",
  "status",
  "install-hint",
  "help",
  "quiet",
  "sessions-only",
  "aw-only",
  "no-index",
  "current-roots",
  "json",
]);

const USAGE = `capture — land sessions and aw client logs in the turn record.

  capture                      one reconciliation pass (sessions + aw logs)
  capture --sessions-only      only session transcripts (Claude Code, pi, codex)
  capture --aw-only            only aw client comm logs
  capture --hook               launch detached capture; exit 0 acknowledges
                               launch only, never capture completion
  capture --watch              pass now, then re-pass on filesystem change
                               (debounced) and every 15 minutes regardless
  capture --status             show store/stream summary, capture nothing
  capture --health [--json]    read offline installation, run and issue diagnosis
  capture --reset-cursors [--source aw|cc|pi|codex]
                               reset selected source cursors and exit; the next
                               pass reprocesses them with journal deduplication
  capture --retry-set-aside    revalidate set-aside inputs in one reconciliation;
                               does not authorize changing captured transcripts
  capture --home <dir>         capture the sessions that ran inside <dir> (an
                               OATS instance home) and print them as JSON:
                               thread, stream, turn count, first/last turn id;
                               status, complete, skipped, held, incomplete,
                               failed, ignored (explicit privacy exclusions).
                               Only complete:true confirms a performed pass
                               with no holds, incomplete tails, unattributed
                               sources or errors. Lock skips/holds exit 0 but
                               report complete:false; failures exit 1.
                               Only attributed files are captured, even in
                               shared directories. Unattributed non-ignored
                               sources conservatively block completion.
                               Tombstoned turns are never a boundary.
  capture --current-roots --home <dir>
                               explicit observer-time inventory for standalone
                               or legacy sources lacking launch history. Not a
                               certificate of all historical source locations.
  capture --file <path> --format cc|pi|codex --home <dir> [--json]
                               capture ONE session file (an archived session,
                               say) as the --home capture of <dir> would: under
                               the capture lock, as a final pass, ignore rules
                               applied. <dir> must be an OATS instance home and
                               the owner explicit (--owner or TURN_RECORD_OWNER;
                               never the hostname). The format is never sniffed.
                               The file must be a regular file (no symlink, FIFO
                               or directory); it is read once. The session id
                               comes from the file NAME, as for live capture: a
                               renamed file lands in another stream. Again with
                               the same file and owner appends nothing.
                               --json prints {thread, stream, firstTurnId,
                               lastTurnId, turns, appended, ignored, sha256 (of
                               the bytes captured), status, complete, ...};
                               without it, one line. Lock skips, holds and
                               incomplete tails exit 0 with complete:false.
                               Errors print {status:"failed", complete:false,
                               code, error}: E_USAGE (exit 2); E_FILE_UNREADABLE,
                               E_NOT_REGULAR_FILE, E_IGNORED (an ignore rule
                               excludes it; nothing read), E_NO_TURNS (no
                               records), E_FORMAT (no session header of that
                               format) and E_CAPTURE_FAILED (exit 1).
  capture --install-hint       print the Claude Code hook snippet
  capture --help               this text
  capture --quiet              suppress per-pass progress
  capture --no-index           append turns without updating the derived index

  --root <dir>                 store root (else $TURN_RECORD_ROOT, else ~/.turn-record)
  --owner <name>               stream owner (else $TURN_RECORD_OWNER, else short hostname)

Every invocation with no explicit subcommand WRITES. Reconciliation is the
capture; hooks and watch only decide when to run it.`;

class UsageError extends Error {}
const hookRequested = process.argv.slice(2).some(arg => arg === "--hook" || arg.startsWith("--hook="));
function hookLaunchError(error) {
  console.error(`capture hook launch failed: ${String(error.message).replace(/[\r\n]+/g, " ")}`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // capture takes no positional arguments. Accepting one silently is the
    // same defect as accepting an unknown flag: `capture status`, meaning
    // `capture --status`, would run a full write pass instead.
    if (!a.startsWith("--")) throw new UsageError(`unexpected argument "${a}" (capture takes no positional arguments)`);
    const name = a.slice(2);
    if (VALUE_FLAGS.has(name)) {
      const value = argv[++i];
      if (value === undefined || hookRequested && value.startsWith("--")) throw new UsageError(`${a} needs a value`);
      if (name === "file" && args.file !== undefined) throw new UsageError("one --file per call");
      args[name] = value;
    } else if (BOOL_FLAGS.has(name)) {
      args[name] = true;
    } else {
      throw new UsageError(`unknown flag ${a}`);
    }
  }
  return args;
}

// Terminal branches return instead of forcing termination while stdout/stderr
// may still contain queued pipe writes. Returning also prevents reporting from
// falling through to capture. Lock/child owners finish before returning; watch
// retains its signal lifecycle. No stream is closed or given an arbitrary delay.
const finish = code => { process.exitCode = code; };
async function main() {
let args;
try {
  args = parseArgs(process.argv.slice(2));
  const recovery = ["reset-cursors", "retry-set-aside", "health"].filter(key => args[key]);
  if (recovery.length > 1) throw new UsageError("choose one recovery or health operation");
  if (args.source !== undefined && (!args["reset-cursors"] || !CAPTURE_SOURCES.includes(args.source))) throw new UsageError("--source requires --reset-cursors and aw|cc|pi|codex");
  if (recovery.length && ["home", "file", "format", "watch", "status", "install-hint", "current-roots", "sessions-only", "aw-only"].some(key => args[key])) throw new UsageError("recovery/health cannot be combined with another capture mode");
  if (args.hook && ["home", "file", "format", "watch", "status", "install-hint", "help", "current-roots", "json", ...recovery].some(key => args[key] !== undefined))
    throw new UsageError("--hook cannot be combined with proof, recovery, JSON or another capture mode");
} catch (err) {
  if (!(err instanceof UsageError)) throw err;
  // Claude treats hook exit2 as blocking/model feedback. Explicit hook usage
  // failures report launch failure on stderr/exit1, never that special status.
  if (hookRequested) {
    hookLaunchError(err);
    return finish(1);
  }
  // --file --json answers JSON even for a usage error: it is for programs.
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ status: "failed", complete: false, code: "E_USAGE", error: err.message }, null, 2));
    return finish(2);
  }
  console.error(`capture: ${err.message}\n\n${USAGE}`);
  return finish(2);
}

if (args.help) {
  console.log(USAGE);
  return finish(0);
}

const root = args.root ?? process.env.TURN_RECORD_ROOT ?? join(homedir(), ".turn-record");
const ownerExplicit = args.owner !== undefined || process.env.TURN_RECORD_OWNER !== undefined;
const owner = args.owner ?? process.env.TURN_RECORD_OWNER ?? hostname().split(".")[0];
const quiet = Boolean(args.quiet || args.json && (args["reset-cursors"] || args["retry-set-aside"]));
const store = args.hook || args.health ? null : new RecordStore(root, { owner });

if (args.health) {
  try {
    // Remedies name the command the person has: `oats` when the kernel runs
    // this script (it imports it, so argv[1] is the kernel's entry, an npm bin
    // symlink named oats included) or handed a node, as setup's remedies do;
    // `turn-record` when run alone.
    const entry = (() => {
      try { return realpathSync(process.argv[1] ?? ""); }
      catch (error) { if (error.code === "ENOENT") return process.argv[1] ?? ""; throw error; }
    })();
    const viaKernel = basename(entry) === "oats.mjs" || isAbsolute(process.env.OATS_NODE_BIN ?? "");
    const health = viaKernel ? captureHealthForDoctor(root) : captureHealth(root);
    if (args.json) console.log(JSON.stringify(health, null, 2));
    else {
      console.log(`capture: ${health.status}`);
      for (const row of health.rows) console.log(`${row.code}: ${row.message}`);
      for (const entry of health.backlog.setAside) console.log(`${entry.source}: ${entry.path}:${entry.line ?? "?"} offset ${entry.offset}: ${entry.reason}`);
      if (health.backlog.truncated) console.log("showing first 100 set-aside inputs");
      for (const entry of health.backlog.failed) console.log(`${entry.stream}: unit starting at byte ${entry.offset} (failing frame unknown): ${entry.reason}; attempts ${entry.attempts}; next retry ${entry.nextRetryAt}`);
      if (health.backlog.failedTruncated) console.log("showing first 100 failed stream units");
    }
  } catch (err) {
    if (args.json) console.log(JSON.stringify({ status: "failed", error: err.message }));
    else console.error(`capture: ${err.message}`);
    process.exitCode = 1;
  }
  return;
}
if (args["reset-cursors"] || args["retry-set-aside"]) {
  try {
    const result = args["reset-cursors"]
      ? await observingSignals(() => withCaptureLock(() => { resetSourceCursors(root, owner, args.source); return { reset: true, sources: args.source ? [args.source] : CAPTURE_SOURCES }; }, "reset-cursors", "the cursor reset was committed"))
      : await pass({ retry: true });
    if (result.skipped) throw new Error("capture lock held; recovery was not performed");
    if (process.exitCode) throw new Error("recovery failed to release its capture lock");
    if (args.json) console.log(JSON.stringify(result));
    else if (args["reset-cursors"]) log(`capture: reset source cursors (${result.sources.join(", ")})`);
  } catch (err) {
    if (err instanceof PrintedCaptureFailure) throw err;
    if (args.json) console.log(JSON.stringify({ status: "failed", complete: false, error: err.message }));
    else console.error(`capture: ${err.message}`);
    process.exitCode = 1;
  }
  return;
}

if (args.hook) {
  try {
    await launchCaptureHook(root, { owner, plan: commandPlan(), indexEnabled: !args["no-index"], trigger: "hook", retrySetAside: false });
    log("capture launched; launch is not completion (see capture --health)");
  } catch (error) {
    hookLaunchError(error);
    process.exitCode = 1;
  }
  // No capture work or discovery in the harness process. The detached owner
  // takes the lock and retains the existing worker lifetime/reaping contract.
  return;
}

// The owner decides the stream namespace, and turn ids hash it into the
// canonical core — so the same conversation captured under two owners yields
// two sets of ids for identical content, which the index cannot dedupe. When
// the derived owner is a stranger to a record that already has streams, say
// so. A WARNING, never a refusal: capture runs on every agent's session hooks,
// and a guard that misjudges would stop capture everywhere — strictly worse
// than the duplication it prevents. First run on a new machine sees an empty
// root, no other owners, and nothing is printed.
function warnOnStrangerOwner() {
  if (ownerExplicit) return;
  let example;
  try {
    for (const stream of store.iterateStreams()) {
      const existing = stream.slice(0, stream.indexOf("~"));
      if (existing === owner) return;
      if (existing) example ??= existing;
    }
  } catch { return; }
  if (!example) return;
  console.error(
    `capture: writing as owner "${owner}" (from hostname), but this record holds ` +
      `streams under another owner such as "${example}". ` +
      `Pass --owner or set TURN_RECORD_OWNER if that is not what you meant — ` +
      `capturing under a second owner duplicates the record rather than extending it.`,
  );
}

function log(...parts) {
  if (!quiet) console.log(...parts);
}

// The exact commands (--home, --file, --reset-cursors) run in this process.
// TERM/INT while one runs is observed only at its safe points: before the
// lock, after taking it, before each format's batch of exact files and before
// the index update. Discovery, one format's batch, the index update and the
// receipt summaries are synchronous and cannot be preempted, so a signal
// waits for the segment it arrived in; no response time is promised. An
// interruption at a safe point unwinds through the lock's release.
class CaptureInterrupted extends Error {}
let signalled = null;
const onSignal = signal => { signalled ??= signal; };
/** Run `fn` with TERM/INT observed, from before its lock until it returns. */
async function observingSignals(fn) {
  process.on("SIGTERM", onSignal); process.on("SIGINT", onSignal);
  try { return await fn(); }
  finally { process.off("SIGTERM", onSignal); process.off("SIGINT", onSignal); }
}
/** A safe point: a signal pending from synchronous work dispatches during
 *  the poll this yields to, and an observed one ends the command here.
 *  `after` says what had already been done, so the answer never implies it
 *  was not. */
async function safePoint(after) {
  await captureSignalPoll();
  if (signalled) throw new CaptureInterrupted(`capture interrupted by ${signalled}${after ? ` after ${after}` : ""}`);
}

/** Take the root's single-run lock, or say who holds it. A hook-triggered
 *  pass that finds it held exits 0: the holder's pass, or the next one,
 *  reconciles the same sessions.
 *
 *  `fn` must return or throw, never call process.exit: the lock is released
 *  in the finally, and a release that did not happen is said so on stderr
 *  with the operator recovery and a nonzero exit status. Likewise an owner
 *  record that could not be written: the lock never silently outlives the
 *  pass that created it. `command` labels the owner record; `done` names
 *  what `fn` committed, for an interruption observed after it returned. */
async function withCaptureLock(fn, command, done) {
  let lock;
  await safePoint();
  try {
    lock = acquireCaptureLock(root, { command, caller: { entry: captureCommandEntry(), trigger: "manual" } });
    // Said by the pass that removed it, never quiet, whether or not it then took the lock: a pass that
    // died holding the lock is worth knowing about.
    if (lock.reclaimed) reportReclaimedLock({ path: lock.path, ...lock.reclaimed });
  } catch (err) {
    reportLockInitializationFailure(err);
    throw err;
  }
  if (lock.held) {
    // Never quiet: a stale lock after a killed pass needs the operator, and
    // the line says exactly what to check and what to remove.
    const line = `capture: another pass holds ${root}: ${lock.held.recovery}; skipping this pass`;
    if (args.home) { if (!quiet || lock.held.liveness !== "alive") console.error(line); }
    else if (lock.held.liveness === "alive") log(line); else console.error(line);
    return { appended: 0, skipped: true, lock: lock.held };
  }
  try {
    let result, failure;
    // The callback's last segment is synchronous too: poll once more before
    // its result can become a success answer.
    try { cleanupCaptureScratch(root, lock); await safePoint(); result = await fn(); await safePoint(done); return result; }
    catch (err) { failure = err; throw err; }
    finally {
      try { writeCaptureStatus(root, { pending: Boolean(failure || result?.pending || result?.held || result?.incomplete || result?.failed) }); }
      catch (err) {
        if (failure) throw new Error(`${failure.message}; capture status persistence also failed: ${err.message}`, { cause: failure });
        throw err;
      }
    }
  } finally {
    const r = lock.release();
    if (!r.released) {
      // Say what was observed: gone, unreadable (unknown), another owner, or
      // our own lock that would not go away; never a guess about liveness.
      console.error(`capture: did not release ${lock.path} (${r.reason}): ${releaseDetail(r)}`);
      process.exitCode = 1;
    }
  }
}

function commandPlan() {
  // Copy caller selection before spawning; only the admitted worker resolves
  // the capture roots. Both selection flags retain their existing empty union.
  const sources = CAPTURE_SOURCES.filter(source => source === "aw" ? !args["sessions-only"] : !args["aw-only"]);
  return captureDefaultRootPlan({ home: homedir(), cwd: process.cwd(), env: process.env, sources });
}

async function pass({ retry = false, trigger = "manual" } = {}) {
  // Privacy refusal unwinds to the command boundary before the lock is
  // taken, leaving no admitted child or lock. The worker independently
  // reloads privacy rules; this preflight supplies the existing actionable error.
  loadIgnoreForCommand(root);
  // Recovery JSON keeps its existing small shape. Never read a later status
  // file after releasing the lock to reconstruct this pass's counters.
  return captureCommandPass(root, { owner, plan: commandPlan(), indexEnabled: !args["no-index"], trigger, retrySetAside: retry }, { log, entry: captureCommandEntry() });
}

/** A final capture of exact files, one batch per format, under the lock: counts into `outcome`, issues into
 *  `issues`, then the index unless --no-index. → withCaptureLock's answer (`outcome`, or a skip). */
function captureUnderLock(recordStore, recordOwner, batches, ignore, outcome, issues, command) {
  return withCaptureLock(async () => {
    for (const [format, files] of batches) {
      await safePoint();
      const r = captureSessions(recordStore, { owner: recordOwner, files, format, ignore, final: true });
      outcome.appended += r.appended;
      outcome.held += r.held;
      outcome.incomplete += r.incomplete;
      outcome.ignored += r.ignored;
      issues.push(...r.issues);
    }
    if (!args["no-index"]) { // an earlier append-only pass may have left unindexed turns
      await safePoint();
      const index = new RecordIndex(recordStore);
      try {
        index.update();
      } finally {
        index.close();
      }
    }
    return outcome;
  }, command, "every batch completed");
}

/** The outcome vocabulary: complete only with no failure, skip, hold or incomplete tail (and, for --home, no
 *  unattributed source). */
function statusOf(outcome, unattributed = 0) {
  return outcome.failed ? "failed" : outcome.skipped ? "skipped" : outcome.held ? "held" : outcome.incomplete || unattributed ? "incomplete" : "complete";
}

// capture --file: ONE session file the operator attributes to an instance home (an archived session the
// --home sweep can no longer find), captured exactly as --home capture would capture it: same stream
// identity, same lock, final, ignore rules applied. The file is opened once and read from that descriptor;
// the receipt's sha256 is of the bytes captured. Every outcome that binds nothing is an error code.
const SESSION_HEADER = { cc: "a record with a cwd", pi: "a session record with a cwd", codex: "a session_meta record with a payload cwd" };
const HEADER_HINT = { cc: "a cc record with a cwd", pi: "a pi session header", codex: "a codex session_meta header" };
// pi and codex headers are specific; any record with a cwd reads as cc, so cc is named last.
const HEADER_ORDER = ["pi", "codex", "cc"];

/** Whether the headers `found` in a file make it a `stated` session. pi and codex need their header. cc needs a
 *  record with a cwd and NO other format's session header anywhere in the file: a cc transcript never holds
 *  one, so a single one is decisive (pi's session record carries a top-level cwd too). */
function isFormat(found, stated) {
  return stated === "cc" ? found.has("cc") && !found.has("pi") && !found.has("codex") : found.has(stated);
}

/** Records (non-blank lines, an undecodable one included) and the formats whose session header a COMPLETE
 *  line carries. A pi or codex file is settled at its header; a cc file is judged whole. A line its writer
 *  never terminated is no header. */
function sessionHeaders(chunks, stated) {
  let records = 0;
  const found = new Set();
  for (const line of bufferLines(chunks)) {
    const complete = line[line.length - 1] === 10;
    let text = null;
    try { text = (complete ? line.subarray(0, -1) : line).toString("utf8"); }
    catch (err) { if (err.code !== "ERR_STRING_TOO_LONG") throw err; }
    if (text === null || text.trim() !== "") records++;
    if (complete && text !== null) for (const source of HEADER_ORDER) if (cwdOfLine(source, text) !== undefined) found.add(source);
    if (stated !== "cc" && found.has(stated)) break;
  }
  return { records, found };
}

function fileKind(stat) {
  return stat.isDirectory() ? "a directory" : stat.isFIFO() ? "a FIFO" : stat.isSocket() ? "a socket" : stat.isCharacterDevice() || stat.isBlockDevice() ? "a device" : "not a regular file";
}

/** → the exit status. */
async function fileCapture() {
  const json = Boolean(args.json);
  const fail = (code, error, extra = {}) => {
    if (json) console.log(JSON.stringify({ ...extra, status: "failed", complete: false, code, error }, null, 2));
    else console.error(`capture --file: ${code}: ${error}`);
    return code === "E_USAGE" ? 2 : 1;
  };
  if (args.file === undefined) return fail("E_USAGE", args.format !== undefined ? "--format needs --file" : "--json needs --file");
  for (const mode of ["watch", "status", "install-hint", "sessions-only", "aw-only", "current-roots"]) {
    if (args[mode]) return fail("E_USAGE", `--file does not combine with --${mode}`);
  }
  if (args.home === undefined) return fail("E_USAGE", "--file needs --home <instance home>: the instance the session belongs to");
  let instance;
  try {
    const meta = JSON.parse(readFileSync(join(args.home, "instance.json"), "utf8"));
    if (typeof meta?.instance === "string" && meta.instance) instance = meta.instance;
  } catch { /* not an instance home: said below */ }
  if (!instance) return fail("E_USAGE", `--home ${args.home} is not an instance home (no instance.json naming an instance)`);
  const fileOwner = args.owner ?? process.env.TURN_RECORD_OWNER;
  if (!fileOwner) return fail("E_USAGE", "--file needs an explicit owner: --owner <name> or TURN_RECORD_OWNER (the hostname is never assumed)");
  if (args.format === undefined) return fail("E_USAGE", "--file needs --format cc|pi|codex (the format is never guessed)");
  if (!Object.hasOwn(SESSION_FORMATS, args.format)) return fail("E_USAGE", `--format must be cc, pi or codex, not ${JSON.stringify(args.format)}`);
  const fmt = SESSION_FORMATS[args.format];
  // Absolute, as every other capture caller passes: path ignore rules, the offsets key and the receipt all
  // read the path, and a relative spelling would slip past a path rule.
  const path = resolve(args.file);
  const where = { home: args.home, owner: fileOwner, file: path, format: args.format };

  let ignore;
  try { ignore = loadIgnore(root); } catch (err) { return fail("E_CAPTURE_FAILED", err.message, where); }
  const sessionId = fmt.sessionId(path);
  // Before the open, on the path and its keys, as every capture checks: an ignored file is never read.
  if (ignore.ignores(path, [basename(path), sessionId, ...(fmt.ignoreKeys?.(path) ?? [])])) {
    return fail("E_IGNORED", `a capture ignore rule (${ignoreFilePath(root)}) excludes ${path}; nothing was read`, where);
  }
  let fd;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (err) {
    if (err.code === "ELOOP" || err.code === "EMLINK") return fail("E_NOT_REGULAR_FILE", `${path} is a symbolic link; pass the file it names`, where);
    return fail("E_FILE_UNREADABLE", `cannot open ${path}: ${err.message}`, where);
  }
  let stat, pinned;
  try {
    stat = fstatSync(fd);
    if (!stat.isFile()) return fail("E_NOT_REGULAR_FILE", `${path} is ${fileKind(stat)}, not a regular file`, where);
    pinned = stageSnapshot(fd, stat, path, undefined, root);
  } catch (err) {
    return fail("E_FILE_UNREADABLE", `cannot read ${path}: ${err.message}`, where);
  } finally { closeSync(fd); }

  try {
  const { records, found } = sessionHeaders(pinned.chunks(), args.format);
  if (!records) return fail("E_NO_TURNS", `${path} has no records${stat.size ? " (only blank lines)" : " (it is empty)"}`, where);
  if (!isFormat(found, args.format)) {
    const other = HEADER_ORDER.find((f) => f !== args.format && isFormat(found, f));
    return fail("E_FORMAT", other
      ? `${path} is not a ${args.format} session: it has ${HEADER_HINT[other]}; pass --format ${other}`
      : `${path} has no ${args.format} session header (${SESSION_HEADER[args.format]})`, where);
  }

  const sha256 = pinned.hash;
  const fileStore = new RecordStore(root, { owner: fileOwner });
  const outcome = { appended: 0, skipped: false, held: 0, incomplete: 0, failed: 0, ignored: 0 };
  const issues = [];
  try {
    Object.assign(outcome, await captureUnderLock(fileStore, fileOwner, [[args.format, [{ path, pinned }]]], ignore, outcome, issues, "file"));
  } catch (err) {
    // A failed pass may have appended part of the file: never claim a count for it.
    // An interruption stops only between whole batches, so its count is confirmed.
    return fail("E_CAPTURE_FAILED", err.message || String(err), { ...where, sha256, appended: err instanceof CaptureInterrupted ? outcome.appended : null });
  }
  if (process.exitCode) return fail("E_CAPTURE_FAILED", "capture lock release failed; see stderr for recovery", { ...where, sha256 });

  const stream = `${fileOwner}~${fmt.source}.${sessionId}`;
  const turns = withReceiptSummaries(fileStore, summary => summary(stream));
  // The summaries are synchronous: a signal during them is still answered.
  try { await safePoint("every batch completed"); }
  catch (err) { return fail("E_CAPTURE_FAILED", err.message, { ...where, sha256, appended: outcome.appended }); }
  const status = statusOf(outcome);
  const { lock: _lock, ...counts } = outcome;
  const receipt = {
    ...where, instance, thread: `${fmt.source}:session:${sessionId}`, stream, sessionId,
    turns: turns.count, firstTurnId: turns.first?.id ?? null, lastTurnId: turns.last?.id ?? null,
    ...counts, status, complete: status === "complete", sha256, ...(issues.length ? { issues } : {}),
  };
  if (json) console.log(JSON.stringify(receipt, null, 2));
  else console.log(`capture --file: ${status}, ${receipt.turns} turns (${outcome.appended} new) in ${stream}, sha256 ${sha256}`);
  return 0;
  } finally { pinned.close(); }
}

if (args.file !== undefined || args.format !== undefined || args.json) return finish(await observingSignals(fileCapture));

if (args["install-hint"]) {
  const self = new URL("./capture-hook.mjs", import.meta.url).pathname;
  console.log(`Add to Claude Code settings.json to capture on session stop/end:

{
  "hooks": {
    "Stop":       [{"hooks": [{"type": "command", "command": "node ${self} --sessions-only --no-index --quiet", "async": false, "timeout": 10}]}],
    "SessionEnd": [{"hooks": [{"type": "command", "command": "node ${self} --sessions-only --no-index --quiet", "async": false, "timeout": 10}]}]
  }
}

Hook acknowledgement means capture launched, not capture completed. The
harness waits only for the launcher (async:false, timeout:10); its detached
supervisor inherits no harness output pipes. Hook failures exit 1, never 2.
These hook passes append turns only (--no-index); the search index is updated by
capture --watch (every 15 minutes and on change) or by a plain capture pass.
One pass runs per record root at a time: the detached supervisor skips an
overlap; launch acknowledgement does not report that later decision. A dropped
hook is recovered by any later pass.`);
  return finish(0);
}

if (args.status) {
  console.log(`root:  ${root}\nowner: ${owner}`);
  const ignore = loadIgnoreForCommand(root);
  if (ignore.size > 0) {
    console.log(`ignore: ${ignore.size} pattern${ignore.size === 1 ? "" : "s"} (${ignoreFilePath(root)})`);
  }
  for (const streamId of store.listStreams()) {
    console.log(`  ${streamId}: ${store.readStream(streamId).length} turns`);
  }
  return finish(0);
}

// One instance home: capture its own sessions and report them with exact
// sequence boundaries (first and last captured turn id), so a consumer such
// as the OKF harvester can name what it read without timestamps, which tie
// and which late capture appends behind. Output is JSON, always: this mode
// exists for programs.
if (args.home) await observingSignals(async () => {
  warnOnStrangerOwner();
  const unattributed = [];
  let found = [];
  const sessions = [];
  const outcome = { appended: 0, skipped: false, held: 0, incomplete: 0, failed: 0, ignored: 0 };
  const issues = [];
  let error;
  try {
    // Unlike background passes, --home always answers JSON, including errors.
    // Do not exit from inside the lock callback: its finally owns release.
    const ignore = loadIgnore(root);
    found = sessionsForHome(args.home, {
      ignore,
      ...(args["current-roots"] ? { fallback: "current-env" } : {}),
      onIgnored: () => outcome.ignored++,
      onUnattributed: (source, path) => unattributed.push({ source, path }),
    });
    const formats = new Map(); // exact files, not their shared directories
    for (const s of found) {
      if (!formats.has(s.source)) formats.set(s.source, []);
      formats.get(s.source).push(s);
    }
    Object.assign(outcome, await captureUnderLock(store, owner, formats, ignore, outcome, issues, "home"));
    withReceiptSummaries(store, summary => {
    for (const s of found) {
      const stream = `${owner}~${s.source}.${s.sessionId}`;
      const turns = summary(stream);
      if (!turns.count) continue; // ignored by rule, nothing capturable yet, or all hidden
      sessions.push({
        thread: s.thread,
        source: s.source,
        sessionId: s.sessionId,
        path: s.path,
        cwd: s.cwd,
        stream,
        turns: turns.count,
        firstTurnId: turns.first.id,
        lastTurnId: turns.last.id,
        lastTs: turns.last.ts,
      });
    }
    });
    // Summaries are synchronous: a signal that arrived during them is still a
    // signal this command received before answering.
    await safePoint("every batch completed");
  } catch (err) {
    error = err.message || String(err);
    console.error(`capture pass failed: ${error}`);
    outcome.failed++;
    // captureSessions can throw after appending part of a directory. Do not
    // claim zero (or a complete count) for a partially performed failed pass.
    // An interruption stops only between whole format batches: its count of
    // completed batches is confirmed.
    if (!(err instanceof CaptureInterrupted)) outcome.appended = null;
    process.exitCode = 1;
  }
  if (process.exitCode && !outcome.failed) {
    outcome.failed++;
    error = "capture lock release failed; see stderr for recovery";
  }
  const status = statusOf(outcome, unattributed.length);
  console.log(JSON.stringify({ home: args.home, owner, ...outcome, status, complete: status === "complete", sessions, sourceRoots: args["current-roots"] ? "current-env" : "launch-history",
    ...(error ? { error } : {}), ...(issues.length ? { issues } : {}), ...(unattributed.length ? { unattributed } : {}),
  }, null, 2));
  // Let stdout drain naturally, including large session-boundary receipts.
}); else {

warnOnStrangerOwner();
try {
  await pass({ trigger: args.watch ? "watch" : "manual" });
} catch (err) {
  if (err instanceof PrintedCaptureFailure) throw err;
  // The lock's finally has run by now; one line, then the status.
  console.error(`capture pass failed: ${err.message}`);
  return finish(1);
}

if (args.watch) {
  const queue = captureWatchQueue(() => pass({ trigger: "watch" }), {
    onError: err => {
      process.exitCode = 1;
      // A privacy refusal used to terminate immediately. It still stops the
      // watch, before child admission, but lets its already printed error drain.
      if (err instanceof PrintedCaptureFailure) { stop(); return; }
      console.error(`capture pass failed: ${err.message}`);
    },
  });
  const watchers = [], plan = commandPlan();
  // These are notification hints only. Their enumeration has parent metadata
  // cost, supplies no capture authority, and may fail independently of a pass.
  for (const source of plan.sources) {
    try {
      for (const dir of resolveCaptureDefaultRoots(plan, source)) {
        try {
          const watcher = watch(dir, { recursive: true }, () => queue.schedule());
          watcher.on("error", err => { console.error(`cannot watch ${dir}: ${err.message}`); watcher.close(); });
          watchers.push(watcher);
          log(`watching ${dir}`);
        } catch (err) { console.error(`cannot watch ${dir}: ${err.message}`); }
      }
    } catch (err) { console.error(`cannot select ${source} watch hints: ${err.message}`); }
  }
  const interval = setInterval(() => queue.schedule(), 15 * 60 * 1000);
  const stop = () => {
    queue.close(); clearInterval(interval);
    for (const watcher of watchers) watcher.close();
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    // If a pass is active its supervisor also observes this signal and owns
    // child termination/reaping and lock release. No new pass may start.
  };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}

}
}

try { await main(); }
catch (error) {
  if (!(error instanceof PrintedCaptureFailure)) throw error;
  // Privacy already printed its one actionable error. No duplicate diagnostic
  // and no later mode may run, but both output pipes can finish normally.
  process.exitCode = 1;
}
