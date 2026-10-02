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

import { closeSync, constants, fstatSync, openSync, readFileSync, watch } from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, join } from "node:path";
import process from "node:process";

import { RecordStore } from "../lib/store.mjs";
import { captureAllSessions, captureSessions } from "../lib/capture-cc.mjs";
import { sessionsForHome } from "../lib/sessions-for-home.mjs";
import { jsonlLines, SESSION_FORMATS } from "../lib/formats.mjs";
import { cwdOfLine } from "../lib/sessions-for-home.mjs";
import { digest, readRange } from "../lib/session-snapshot.mjs";
import { captureAwLogs, defaultCommLogDir } from "../lib/capture-aw.mjs";
import { RecordIndex } from "../lib/index-db.mjs";
import { IgnoreError, ignoreFilePath, loadIgnore } from "../lib/ignore.mjs";
import { acquireCaptureLock } from "../lib/capture-lock.mjs";

// Fail closed but actionably: an unreadable ignore file must stop capture,
// as one clear line naming the file — never an uncaught stack trace.
function loadIgnoreOrExit(recordRoot) {
  try {
    return loadIgnore(recordRoot);
  } catch (err) {
    console.error(err instanceof IgnoreError ? err.message : String(err));
    process.exit(1);
  }
}

// Every flag this program understands. An unknown flag is rejected rather
// than ignored, because the fall-through from argument parsing is pass() —
// a WRITE. `capture --help` was once a full reconciliation pass under a
// hostname-derived owner, which forked the whole record into a second owner
// namespace: 571 duplicate journals from one typo. Parsing must refuse what
// it does not understand before anything can be written.
const VALUE_FLAGS = new Set(["root", "owner", "home", "file", "format"]);
const BOOL_FLAGS = new Set([
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
  capture --watch              pass now, then re-pass on filesystem change
                               (debounced) and every 15 minutes regardless
  capture --status             show store/stream summary, capture nothing
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
      if (value === undefined) throw new UsageError(`${a} needs a value`);
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

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  if (!(err instanceof UsageError)) throw err;
  // --file --json answers JSON even for a usage error: it is for programs.
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ status: "failed", complete: false, code: "E_USAGE", error: err.message }, null, 2));
    process.exit(2);
  }
  console.error(`capture: ${err.message}\n\n${USAGE}`);
  process.exit(2);
}

if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

const root = args.root ?? process.env.TURN_RECORD_ROOT ?? join(homedir(), ".turn-record");
const ownerExplicit = args.owner !== undefined || process.env.TURN_RECORD_OWNER !== undefined;
const owner = args.owner ?? process.env.TURN_RECORD_OWNER ?? hostname().split(".")[0];
const quiet = Boolean(args.quiet);
const store = new RecordStore(root, { owner });

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
  let others;
  try {
    others = new Set(
      store
        .listStreams()
        .map((id) => id.slice(0, id.indexOf("~")))
        .filter(Boolean),
    );
  } catch {
    return; // unreadable or absent root: not this function's business
  }
  if (others.size === 0 || others.has(owner)) return;
  console.error(
    `capture: writing as owner "${owner}" (from hostname), but this record holds ` +
      `streams only under ${[...others].sort().map((o) => `"${o}"`).join(", ")}. ` +
      `Pass --owner or set TURN_RECORD_OWNER if that is not what you meant — ` +
      `capturing under a second owner duplicates the record rather than extending it.`,
  );
}

function log(...parts) {
  if (!quiet) console.log(...parts);
}

/** Take the root's single-run lock, or say who holds it. A hook-triggered
 *  pass that finds it held exits 0: the holder's pass, or the next one,
 *  reconciles the same sessions.
 *
 *  `fn` must return or throw, never call process.exit: the lock is released
 *  in the finally, and a release that did not happen is said so on stderr
 *  with the operator recovery and a nonzero exit status. Likewise an owner
 *  record that could not be written: the lock never silently outlives the
 *  pass that created it. */
function withCaptureLock(fn) {
  let lock;
  try {
    lock = acquireCaptureLock(root);
    // Said by the pass that removed it, never quiet, whether or not it then took the lock: a pass that
    // died holding the lock is worth knowing about.
    if (lock.reclaimed) console.error(`capture: reclaimed ${lock.path} from pid ${lock.reclaimed.pid}, which died (started ${lock.reclaimed.startedAt || "?"})`);
  } catch (err) {
    if (err.lockCleanup) {
      const c = err.lockCleanup;
      const outcome = c.removed ? "the initializing lock was removed"
        : c.reason === "gone" ? "the initializing lock was already gone (removed by another party)"
        : c.reason === "replaced" ? (c.owner
          ? `the lock now belongs to pid ${c.owner.pid} (started ${c.owner.startedAt || "?"}) and was left alone`
          : "the lock directory changed or its identity could not be verified, no owner record was readable, and it was left alone")
        : `the initializing lock could NOT be removed${c.error ? ` (${c.error})` : ""}; ${c.recovery}`;
      console.error(`capture: could not write the owner record of ${c.path}: ${err.message}; ${outcome}`);
    }
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
    return fn();
  } finally {
    const r = lock.release();
    if (!r.released) {
      // Say what was observed: gone, unreadable (unknown), another owner, or
      // our own lock that would not go away; never a guess about liveness.
      const detail = r.reason === "gone" ? "it was already removed by another party (an operator recovery?); nothing to release"
        : r.reason === "not-owner" ? `it now belongs to pid ${r.owner.pid} (started ${r.owner.startedAt || "?"}); left alone`
        : r.reason === "unknown-owner" ? `its owner record is missing or unreadable, so it may be an operator removal in progress or a newer pass initializing; left alone; ${r.recovery}`
        : `${r.error ? `${r.error}; ` : ""}${r.recovery}`;
      console.error(`capture: did not release ${lock.path} (${r.reason}): ${detail}`);
      process.exitCode = 1;
    }
  }
}

function pass() {
  // The privacy loader fails closed by exiting; it runs before the lock is
  // taken so that exit never leaves the lock behind.
  const ignore = loadIgnoreOrExit(root);
  return withCaptureLock(() => {
  const out = { appended: 0 };
  if (!args["aw-only"]) {
    for (const r of captureAllSessions(store, { owner, ignore })) {
      out.appended += r.appended;
      const extras = [r.ignored ? `${r.ignored} ignored` : "", r.held ? `${r.held} held` : "", r.incomplete ? `${r.incomplete} incomplete` : ""]
        .filter(Boolean)
        .join(", ");
      log(
        `sessions: ${r.sessions} scanned, ${r.appended} new turns in ${r.streams} sessions${extras ? ` (${extras})` : ""} -> ${r.stream}`,
      );
    }
  }
  if (!args["sessions-only"]) {
    let awEntries = 0;
    let awAppended = 0;
    let awFailed = 0;
    let awFiles = 0;
    let awIgnored = 0;
    for (const r of captureAwLogs(store, { owner, ignore })) {
      if (r.ignored) {
        awIgnored++;
        continue;
      }
      awFiles++;
      awEntries += r.entries;
      awAppended += r.appended;
      awFailed += r.failed;
      out.appended += r.appended;
      if (r.failed) console.error(`aw-log ${r.account}: ${r.failed} entries failed to project`);
    }
    const ignored = awIgnored ? `, ${awIgnored} ignored` : "";
    log(`aw-logs: ${awFiles} files, ${awEntries} entries, ${awAppended} new, ${awFailed} failed${ignored}`);
  }
  // Index whenever this pass may index, not only when THIS pass appended:
  // an append-only pass (--no-index, the hook form) leaves turns behind
  // that the next indexing pass must pick up. index.update() walks
  // per-stream cursors, so a pass with nothing new is cheap.
  if (!args["no-index"]) {
    const index = new RecordIndex(store);
    try {
      index.update();
      log(`index: updated (${JSON.stringify(index.counts())})`);
    } finally {
      index.close();
    }
  }
  return out;
  });
}

// capture --file: ONE session file the operator attributes to an instance home (an archived session the
// --home sweep can no longer find), captured exactly as --home capture would capture it: same stream
// identity, same lock, final, ignore rules applied. The file is opened once and read from that descriptor;
// the receipt's sha256 is of the bytes captured. Every outcome that binds nothing is an error code.
const SESSION_HEADER = { cc: "record with a cwd", pi: "session record", codex: "session_meta" };
// pi and codex headers are specific; any record with a cwd reads as cc, so cc is tried last.
const HEADER_ORDER = ["pi", "codex", "cc"];

/** Records (non-blank lines, an undecodable one included) and the formats whose session header a COMPLETE
 *  line carries, stopping at the stated format's. A line its writer never terminated is no header. */
function sessionHeaders(bytes, stated) {
  let records = 0;
  const found = new Set();
  const terminated = bytes.length > 0 && bytes[bytes.length - 1] === 10;
  const take = (text, complete) => {
    if (text === null || text.trim() !== "") records++;
    if (complete && text !== null) for (const source of HEADER_ORDER) if (cwdOfLine(source, text) !== undefined) found.add(source);
  };
  let pending;
  for (const { text } of jsonlLines(bytes)) {
    if (pending !== undefined) take(pending, true);
    if (found.has(stated)) return { records, found };
    pending = text;
  }
  if (pending !== undefined) take(pending, terminated);
  return { records, found };
}

function fileKind(stat) {
  return stat.isDirectory() ? "a directory" : stat.isFIFO() ? "a FIFO" : stat.isSocket() ? "a socket" : stat.isCharacterDevice() || stat.isBlockDevice() ? "a device" : "not a regular file";
}

/** → the exit status. */
function fileCapture() {
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
  const path = args.file;
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
  let stat, bytes;
  try {
    stat = fstatSync(fd);
    if (!stat.isFile()) return fail("E_NOT_REGULAR_FILE", `${path} is ${fileKind(stat)}, not a regular file`, where);
    bytes = readRange(fd, 0, stat.size, path);
  } catch (err) {
    return fail("E_FILE_UNREADABLE", `cannot read ${path}: ${err.message}`, where);
  } finally { closeSync(fd); }

  const { records, found } = sessionHeaders(bytes, args.format);
  if (!records) return fail("E_NO_TURNS", `${path} has no records${bytes.length ? " (only blank lines)" : " (it is empty)"}`, where);
  if (!found.has(args.format)) {
    const other = HEADER_ORDER.find((f) => found.has(f));
    return fail("E_FORMAT", `${path} has no ${args.format} session header (a ${SESSION_HEADER[args.format]})${other ? `; it has a ${other} ${SESSION_HEADER[other]} header; pass --format ${other}` : ""}`, where);
  }

  const sha256 = digest(bytes);
  const fileStore = new RecordStore(root, { owner: fileOwner });
  const outcome = { appended: 0, skipped: false, held: 0, incomplete: 0, failed: 0, ignored: 0 };
  const issues = [];
  try {
    Object.assign(outcome, withCaptureLock(() => {
      const r = captureSessions(fileStore, { owner: fileOwner, files: [{ path, pinned: { bytes, stat } }], format: args.format, ignore, final: true });
      outcome.appended += r.appended;
      outcome.held += r.held;
      outcome.incomplete += r.incomplete;
      outcome.ignored += r.ignored;
      issues.push(...r.issues);
      if (!args["no-index"]) {
        const index = new RecordIndex(fileStore);
        try { index.update(); } finally { index.close(); }
      }
      return outcome;
    }));
  } catch (err) {
    // A failed pass may have appended part of the file: never claim a count for it.
    return fail("E_CAPTURE_FAILED", err.message || String(err), { ...where, sha256, appended: null });
  }
  if (process.exitCode) return fail("E_CAPTURE_FAILED", "capture lock release failed; see stderr for recovery", { ...where, sha256 });

  const stream = `${fileOwner}~${fmt.source}.${sessionId}`;
  const claims = fileStore.tombstoneClaims();
  const turns = fileStore.readStream(stream).filter((t) => !fileStore.claimHides(claims, t));
  const status = outcome.skipped ? "skipped" : outcome.held ? "held" : outcome.incomplete ? "incomplete" : "complete";
  const { lock: _lock, ...counts } = outcome;
  const receipt = {
    ...where, instance, thread: `${fmt.source}:session:${sessionId}`, stream, sessionId,
    turns: turns.length, firstTurnId: turns[0]?.id ?? null, lastTurnId: turns.at(-1)?.id ?? null,
    ...counts, status, complete: status === "complete", sha256, ...(issues.length ? { issues } : {}),
  };
  if (json) console.log(JSON.stringify(receipt, null, 2));
  else console.log(`capture --file: ${status}, ${receipt.turns} turns (${outcome.appended} new) in ${stream}, sha256 ${sha256}`);
  return 0;
}

if (args.file !== undefined || args.format !== undefined || args.json) process.exit(fileCapture());

if (args["install-hint"]) {
  const self = new URL(import.meta.url).pathname;
  console.log(`Add to Claude Code settings.json to capture on session stop/end:

{
  "hooks": {
    "Stop":       [{"hooks": [{"type": "command", "command": "node ${self} --sessions-only --no-index --quiet"}]}],
    "SessionEnd": [{"hooks": [{"type": "command", "command": "node ${self} --sessions-only --no-index --quiet"}]}]
  }
}

Hook passes append turns only (--no-index); the search index is updated by
capture --watch (every 15 minutes and on change) or by a plain capture pass.
One pass runs per record root at a time: a hook pass that finds another
running exits at once, and a dropped hook is recovered by any later pass.`);
  process.exit(0);
}

if (args.status) {
  console.log(`root:  ${root}\nowner: ${owner}`);
  const ignore = loadIgnoreOrExit(root);
  if (ignore.size > 0) {
    console.log(`ignore: ${ignore.size} pattern${ignore.size === 1 ? "" : "s"} (${ignoreFilePath(root)})`);
  }
  for (const streamId of store.listStreams()) {
    console.log(`  ${streamId}: ${store.readStream(streamId).length} turns`);
  }
  process.exit(0);
}

// One instance home: capture its own sessions and report them with exact
// sequence boundaries (first and last captured turn id), so a consumer such
// as the OKF harvester can name what it read without timestamps, which tie
// and which late capture appends behind. Output is JSON, always: this mode
// exists for programs.
if (args.home) {
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
    Object.assign(outcome, withCaptureLock(() => {
      for (const [format, files] of formats) {
        const r = captureSessions(store, { owner, files, format, ignore, final: true });
        outcome.appended += r.appended;
        outcome.held += r.held;
        outcome.incomplete += r.incomplete;
        outcome.ignored += r.ignored;
        issues.push(...r.issues);
      }
      if (!args["no-index"]) { // an earlier append-only pass may have left unindexed turns
        const index = new RecordIndex(store);
        try {
          index.update();
        } finally {
          index.close();
        }
      }
      return outcome;
    }));
    // A tombstoned turn is hidden everywhere; a boundary naming one would be
    // refused by recall, so boundaries come from the visible turns only.
    const claims = store.tombstoneClaims();
    for (const s of found) {
      const stream = `${owner}~${s.source}.${s.sessionId}`;
      const turns = store.readStream(stream).filter((t) => !store.claimHides(claims, t));
      if (!turns.length) continue; // ignored by rule, nothing capturable yet, or all hidden
      sessions.push({
        thread: s.thread,
        source: s.source,
        sessionId: s.sessionId,
        path: s.path,
        cwd: s.cwd,
        stream,
        turns: turns.length,
        firstTurnId: turns[0].id,
        lastTurnId: turns[turns.length - 1].id,
        lastTs: turns[turns.length - 1].ts,
      });
    }
  } catch (err) {
    error = err.message || String(err);
    console.error(`capture pass failed: ${error}`);
    outcome.failed++;
    // captureSessions can throw after appending part of a directory. Do not
    // claim zero (or a complete count) for a partially performed failed pass.
    outcome.appended = null;
    process.exitCode = 1;
  }
  if (process.exitCode && !outcome.failed) {
    outcome.failed++;
    error = "capture lock release failed; see stderr for recovery";
  }
  const status = outcome.failed ? "failed" : outcome.skipped ? "skipped" : outcome.held ? "held" : outcome.incomplete || unattributed.length ? "incomplete" : "complete";
  console.log(JSON.stringify({ home: args.home, owner, ...outcome, status, complete: status === "complete", sessions, sourceRoots: args["current-roots"] ? "current-env" : "launch-history",
    ...(error ? { error } : {}), ...(issues.length ? { issues } : {}), ...(unattributed.length ? { unattributed } : {}),
  }, null, 2));
  // Let stdout drain naturally, including large session-boundary receipts.
} else {

warnOnStrangerOwner();
try {
  pass();
} catch (err) {
  // The lock's finally has run by now; one line, then the status.
  console.error(`capture pass failed: ${err.message}`);
  process.exit(1);
}

if (args.watch) {
  const roots = [
    ...Object.values(SESSION_FORMATS).flatMap((f) => f.defaultRoots()),
    defaultCommLogDir(),
  ];
  let timer = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        pass();
      } catch (err) {
        console.error(`capture pass failed: ${err.message}`);
      }
    }, 2000);
  };
  for (const dir of roots) {
    try {
      watch(dir, { recursive: true }, schedule);
      log(`watching ${dir}`);
    } catch (err) {
      console.error(`cannot watch ${dir}: ${err.message}`);
    }
  }
  setInterval(schedule, 15 * 60 * 1000); // reconcile even if events were missed
}

}
