#!/usr/bin/env node
// dress — compose a budgeted spawning context from the record.
//
//   dress --thread <thread>            briefing to stdout
//   dress --thread <thread> --out f    briefing to a file
//   dress --budget-chars N             selection budget (default 40000)
//   dress --since <iso-ts>             drop turns before a handoff point
//                                      (the thread opener is always kept)
//   dress --no-log                     do not record the manifest turn
//
// Store root: --root, else $TURN_RECORD_ROOT, else ~/.turn-record
// Manifest owner: --owner, else $TURN_RECORD_OWNER, else short hostname.

import { writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { RecordStore } from "../lib/store.mjs";
import { dress, DressError } from "../lib/dress.mjs";
import { RecordIndex } from "../lib/index-db.mjs";
import { LibrarianError, renderClothes, selectClothes, selectionEntries } from "../lib/librarian.mjs";

function parseArgs(argv) {
  const args = { pin: [], threads: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pin") {
      args.pin.push(argv[++i]);
    } else if (a === "--thread") {
      args.threads.push(argv[++i]);
      args.thread = args.threads[0];
    } else if (["--root", "--owner", "--thread", "--budget-chars", "--since", "--out", "--task", "--engine"].includes(a)) {
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
if (!args.thread && !args.task) {
  console.error(
    "usage: dress --thread <thread> [--budget-chars N] [--since <iso-ts>] [--pin <ref>]... [--out file] [--no-log]\n" +
      "       dress --task \"<task>\" [--thread <t>]... [--pin <ref>]... [--engine <cmd>] [--out file]",
  );
  process.exit(2);
}

const root = args.root ?? process.env.TURN_RECORD_ROOT ?? join(homedir(), ".turn-record");
const owner = args.owner ?? process.env.TURN_RECORD_OWNER ?? hostname().split(".")[0];
const store = new RecordStore(root, { owner });

if (args.task) {
  // Librarian mode: intelligent task-scoped selection over the whole
  // record, memoized as tag + outfit turns. See lib/librarian.mjs.
  const engine = args.engine ?? process.env.TURN_RECORD_ENGINE;
  const index = new RecordIndex(store);
  try {
    const r = selectClothes(store, index, {
      task: args.task,
      threads: args.threads,
      pins: args.pin,
      engine,
      engineLabel: engine ? engine.split(/\s+/)[0] : undefined,
    });
    if (r.dropped > 0) console.error(`note: candidate cap dropped ${r.dropped} mechanical candidates`);
    if (r.selection.length === 0) {
      console.error(`no turns selected for task (judged ${r.judged} candidates)`);
      process.exit(1);
    }
    const entries = selectionEntries(store, r.selection);
    const outText = renderClothes(args.task, r.selection, entries);
    if (args.out) {
      writeFileSync(args.out, outText);
      console.error(`wrote ${args.out}: ${r.selection.length} turns, outfit ${r.outfit.id}`);
    } else {
      process.stdout.write(outText);
      console.error(`\n[dress] ${r.selection.length} turns, outfit ${r.outfit.id}`);
    }
    process.exit(0);
  } catch (err) {
    if (err instanceof LibrarianError) {
      console.error(err.message);
      process.exit(2);
    }
    throw err;
  } finally {
    index.close();
  }
}

let result;
try {
  result = dress(store, {
    thread: args.thread,
    budgetChars: args["budget-chars"] ? Number(args["budget-chars"]) : undefined,
    since: args.since ?? null,
    log: !args["no-log"],
    pin: args.pin,
  });
} catch (err) {
  if (err instanceof DressError) {
    console.error(err.message);
    process.exit(2);
  }
  throw err;
}

if (result.kept === 0) {
  console.error(`no turns found for thread ${args.thread}`);
  process.exit(1);
}
if (args.out) {
  writeFileSync(args.out, result.briefing);
  console.error(
    `wrote ${args.out}: ${result.kept} turns kept, ${result.omitted} omitted, manifest ${result.manifest.id}`,
  );
} else {
  process.stdout.write(result.briefing);
  console.error(
    `\n[dress] ${result.kept} kept, ${result.omitted} omitted, manifest ${result.manifest.id}`,
  );
}
