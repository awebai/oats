#!/usr/bin/env node
// mind — the reader (Jiminy): segment an agent's life into clothes.
//
//   mind --backfill <thread> [--engine <cmd>] [--window-chars N] [--note s]
//   mind --map <thread>          print the current segment map, read nothing
//
// The reader resumes from its last closed annotation, so re-running after
// a crash or on a grown thread reads only what is new. Engine:
// --engine or TURN_RECORD_ENGINE (a shell command reading a prompt on
// stdin, printing one JSON object).

import { homedir, hostname } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { RecordStore } from "../lib/store.mjs";
import { readThread, ReaderError } from "../lib/reader.mjs";
import { segmentsFor } from "../lib/segments.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["--backfill", "--map", "--engine", "--window-chars", "--note", "--root", "--owner"].includes(a)) {
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

if (!args.backfill) {
  console.error("usage: mind --backfill <thread> [--engine cmd] [--window-chars N] [--note s]\n       mind --map <thread>");
  process.exit(2);
}

const engine = args.engine ?? process.env.TURN_RECORD_ENGINE;
try {
  const r = readThread(store, {
    thread: args.backfill,
    engine,
    engineLabel: engine ? engine.split(/\s+/)[0] : undefined,
    windowChars: args["window-chars"] ? Number(args["window-chars"]) : undefined,
    threadNote: args.note,
    onWindow: (p) =>
      console.error(
        `[mind] window ${p.windows}: ${p.cursor}/${p.total} entries read, ${p.written} segment notes, ${p.open} open`,
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
