#!/usr/bin/env node
// mind — the reader (Jiminy): segment an agent's life into clothes.
//
//   mind --backfill <thread> [--engine <cmd>] [--window-chars N] [--note s]
//   mind --map <thread>          print the current segment map, read nothing
//   mind --follow                wake per capture batch: watch this owner's
//                                session streams and read every thread whose
//                                journal grew (one reader per machine)
//     --min-new-bytes N          growth threshold before waking (default 30000)
//     --interval-secs N          reconcile interval (default 300)
//     --catch-up                 also read backlog present at startup
//     --once                     one pass, then exit (cron-style operation)
//     --stale-hours N            a born jiminy whose principal's journal
//                                has not grown for N hours gets one final
//                                wake, then a farewell note; growth after
//                                the farewell revives it (default 24;
//                                0 disables death handling)
//
// The reader resumes from its last closed annotation, so re-running after
// a crash or on a grown thread reads only what is new. Engine:
// --engine or TURN_RECORD_ENGINE (a shell command reading a prompt on
// stdin, printing one JSON object). An engine template containing
// {session} resolves per thread to that jiminy's own deterministic pi
// session id — the consciousness's long-lived memory, e.g.:
//   --engine 'pi -p --provider openai-codex --no-extensions --no-skills \
//             --no-context-files --session-id {session} "$(cat)"'

import { watch } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { RecordStore } from "../lib/store.mjs";
import { readThread, ReaderError } from "../lib/reader.mjs";
import { segmentsFor } from "../lib/segments.mjs";
import { followPass } from "../lib/follow.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["--backfill", "--map", "--engine", "--engine-label", "--window-chars", "--note", "--root", "--owner", "--min-new-bytes", "--interval-secs", "--stale-hours"].includes(a)) {
      args[a.slice(2)] = argv[++i];
    } else if (a.startsWith("--")) args[a.slice(2)] = true;
    else {
      console.error(`unknown argument ${a}`);
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const root = args.root ?? process.env.TURN_RECORD_ROOT ?? join(homedir(), ".turn-record");
const owner = args.owner ?? process.env.TURN_RECORD_OWNER ?? hostname().split(".")[0];
const store = new RecordStore(root, { owner });

function printMap(thread) {
  const segs = segmentsFor(store, thread);
  if (segs.length === 0) {
    console.error(`no segments for ${thread}`);
    process.exit(1);
  }
  for (const s of segs) {
    const span = s.end ? `${s.start}..${s.end}` : `${s.start}..`;
    console.log(`${span.padEnd(24)} ${s.type.padEnd(15)} ${s.outcome.padEnd(11)} ${s.established}`);
  }
}

if (args.map) {
  printMap(args.map);
  process.exit(0);
}

if (args.follow) {
  const engine = args.engine ?? process.env.TURN_RECORD_ENGINE;
  if (!engine) {
    console.error("mind --follow: an engine command is required (--engine or TURN_RECORD_ENGINE)");
    process.exit(2);
  }
  const state = new Map();
  const minNewBytes = args["min-new-bytes"] ? Number(args["min-new-bytes"]) : undefined;
  let catchUp = Boolean(args["catch-up"]);
  const run = (thread, streamId, { final = false } = {}) =>
    readThread(store, {
      thread,
      engine,
      engineLabel: args["engine-label"] ?? engine,
      windowChars: args["window-chars"] ? Number(args["window-chars"]) : undefined,
      threadNote: final
        ? "The principal has stopped; this is the final window. Close every open segment the evidence lets you close."
        : undefined,
      onWindow: (p) =>
        console.error(`[mind] ${thread} window ${p.windows}: ${p.cursor}/${p.total} entries, ${p.written} notes`),
    });
  const staleAfterMs = args["stale-hours"] !== undefined ? Number(args["stale-hours"]) * 3600 * 1000 : undefined;
  const pass = () => {
    try {
      const r = followPass(store, { owner, state, minNewBytes, catchUp, staleAfterMs, run });
      catchUp = false; // backlog is a startup concern; growth from here on
      for (const x of r.ran) console.error(`[mind] read ${x.thread}: ${x.result.segments ?? 0} segment notes`);
      for (const x of r.died) console.error(`[mind] farewell ${x.thread}`);
      for (const x of r.failed) console.error(`[mind] FAILED ${x.thread}: ${x.error}`);
    } catch (err) {
      console.error(`[mind] follow pass failed: ${err.message}`);
    }
  };
  pass();
  if (args.once) process.exit(0);
  // Engine runs are slow; debounce generously and reconcile on a timer
  // even if fs events were missed (the capture watcher's idiom).
  let timer = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      pass();
    }, 10000);
  };
  try {
    watch(join(root, "streams"), { recursive: true }, schedule);
    console.error(`[mind] following ${owner}'s session streams under ${root}`);
  } catch (err) {
    console.error(`[mind] cannot watch ${root}/streams: ${err.message}`);
  }
  const intervalSecs = args["interval-secs"] ? Number(args["interval-secs"]) : 300;
  setInterval(schedule, intervalSecs * 1000);
} else if (!args.backfill) {
  console.error(
    "usage: mind --backfill <thread> [--engine cmd] [--window-chars N] [--note s]\n" +
      "       mind --map <thread>\n" +
      "       mind --follow [--engine cmd] [--min-new-bytes N] [--interval-secs N] [--catch-up]",
  );
  process.exit(2);
} else {
  const engine = args.engine ?? process.env.TURN_RECORD_ENGINE;
  try {
    const r = readThread(store, {
      thread: args.backfill,
      engine,
      engineLabel: args["engine-label"] ?? engine,
      windowChars: args["window-chars"] ? Number(args["window-chars"]) : undefined,
      threadNote: args.note,
      onWindow: (p) =>
        console.error(
          `[mind] window ${p.windows}: ${p.cursor}/${p.total} entries read, ${p.written} segment notes, ${p.open} open, ${p.engineMs}ms engine`,
        ),
    });
    console.error(
      `[mind] done: ${r.entries} entries in ${r.windows} windows -> ${r.segments} segment notes`,
    );
    printMap(args.backfill);
  } catch (err) {
    if (err instanceof ReaderError) {
      console.error(err.message);
      process.exit(2);
    }
    throw err;
  }
}
