#!/usr/bin/env node
// capture — land sessions and aw client logs in the turn record.
//
//   capture                      one reconciliation pass (sessions + aw logs)
//   capture --sessions-only      only Claude Code transcripts
//   capture --aw-only            only aw client comm logs
//   capture --watch              pass now, then re-pass on filesystem change
//                                (debounced) and every 15 minutes regardless
//   capture --status             show store/stream summary, capture nothing
//   capture --install-hint       print the Claude Code hook snippet
//
// Store root: --root, else $TURN_RECORD_ROOT, else ~/.turn-record
// Stream owner: --owner, else $TURN_RECORD_OWNER, else short hostname.
// Reconciliation is the capture; hooks and watch only decide when to run it.

import { watch } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { RecordStore } from "../lib/store.mjs";
import { captureSessions, defaultSessionRoots } from "../lib/capture-cc.mjs";
import { captureAwLogs, defaultCommLogDir } from "../lib/capture-aw.mjs";
import { RecordIndex } from "../lib/index-db.mjs";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root" || a === "--owner") args[a.slice(2)] = argv[++i];
    else if (a.startsWith("--")) args[a.slice(2)] = true;
    else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const root = args.root ?? process.env.TURN_RECORD_ROOT ?? join(homedir(), ".turn-record");
const owner = args.owner ?? process.env.TURN_RECORD_OWNER ?? hostname().split(".")[0];
const quiet = Boolean(args.quiet);
const store = new RecordStore(root, { owner });

function log(...parts) {
  if (!quiet) console.log(...parts);
}

function pass() {
  const out = { appended: 0 };
  if (!args["aw-only"]) {
    const r = captureSessions(store, { owner, roots: defaultSessionRoots() });
    out.appended += r.appended;
    log(`sessions: ${r.sessions} scanned, ${r.appended} new snapshots -> ${r.stream}`);
  }
  if (!args["sessions-only"]) {
    let awEntries = 0;
    let awAppended = 0;
    let awFailed = 0;
    let awFiles = 0;
    for (const r of captureAwLogs(store, { owner })) {
      awFiles++;
      awEntries += r.entries;
      awAppended += r.appended;
      awFailed += r.failed;
      out.appended += r.appended;
      if (r.failed) console.error(`aw-log ${r.account}: ${r.failed} entries failed to project`);
    }
    log(`aw-logs: ${awFiles} files, ${awEntries} entries, ${awAppended} new, ${awFailed} failed`);
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
  for (const streamId of store.listStreams()) {
    console.log(`  ${streamId}: ${store.readStream(streamId).length} turns`);
  }
  process.exit(0);
}

pass();

if (args.watch) {
  const roots = [...defaultSessionRoots(), defaultCommLogDir()];
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
