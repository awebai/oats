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

import { watch } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

import { RecordStore } from "../lib/store.mjs";
import { captureAllSessions, captureSessions } from "../lib/capture-cc.mjs";
import { sessionsForHome } from "../lib/sessions-for-home.mjs";
import { SESSION_FORMATS } from "../lib/formats.mjs";
import { captureAwLogs, defaultCommLogDir } from "../lib/capture-aw.mjs";
import { RecordIndex } from "../lib/index-db.mjs";
import { IgnoreError, ignoreFilePath, loadIgnore } from "../lib/ignore.mjs";

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
const VALUE_FLAGS = new Set(["root", "owner", "home"]);
const BOOL_FLAGS = new Set([
  "watch",
  "status",
  "install-hint",
  "help",
  "quiet",
  "sessions-only",
  "aw-only",
  "no-index",
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
                               thread, stream, turn count, first/last turn id.
                               Tombstoned turns are never a boundary. Codex
                               keeps a day's rollouts in one directory, so the
                               pass captures that day; the list is filtered.
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

function pass() {
  const out = { appended: 0 };
  const ignore = loadIgnoreOrExit(root);
  if (!args["aw-only"]) {
    for (const r of captureAllSessions(store, { owner, ignore })) {
      out.appended += r.appended;
      const extras = [r.ignored ? `${r.ignored} ignored` : "", r.held ? `${r.held} held` : ""]
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
  if (out.appended > 0 && !args["no-index"]) {
    const index = new RecordIndex(store);
    try {
      index.update();
      log(`index: updated (${JSON.stringify(index.counts())})`);
    } finally {
      index.close();
    }
  }
  return out;
}

if (args["install-hint"]) {
  const self = new URL(import.meta.url).pathname;
  console.log(`Add to Claude Code settings.json to capture on session stop/end:

{
  "hooks": {
    "Stop":       [{"hooks": [{"type": "command", "command": "node ${self} --sessions-only --quiet"}]}],
    "SessionEnd": [{"hooks": [{"type": "command", "command": "node ${self} --sessions-only --quiet"}]}]
  }
}

A dropped hook is recovered by any later pass (capture, or capture --watch).`);
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
  const ignore = loadIgnoreOrExit(root);
  const unattributed = [];
  const found = sessionsForHome(args.home, { onUnattributed: (source, path) => unattributed.push({ source, path }) });
  const sessions = [];
  const dirs = new Map(); // one capture pass per (format, directory)
  for (const s of found) dirs.set(`${s.source}\0${dirname(s.path)}`, { format: s.source, dir: dirname(s.path) });
  let appended = 0;
  for (const { format, dir } of dirs.values()) {
    appended += captureSessions(store, { owner, roots: [dir], format, ignore }).appended;
  }
  if (appended > 0 && !args["no-index"]) {
    const index = new RecordIndex(store);
    try {
      index.update();
    } finally {
      index.close();
    }
  }
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
  console.log(JSON.stringify({ home: args.home, owner, appended, sessions, ...(unattributed.length ? { unattributed } : {}) }, null, 2));
  process.exit(0);
}

warnOnStrangerOwner();
pass();

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
