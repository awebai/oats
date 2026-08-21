#!/usr/bin/env node
// segments — search the segment catalog (the wardrobe).
//
//   segments [query]                 FTS over established/lesson
//   segments --thread <t>            one agent's map
//   segments --type exploration      structural filters
//   segments --about <slug> --outcome fruitful --include-dead --json
//
// Dead-end and superseded segments are excluded unless --include-dead or
// an explicit --outcome asks for them.

import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { RecordStore } from "../../record/lib/store.mjs";
import { RecordIndex } from "../../record/lib/index-db.mjs";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["--root", "--thread", "--type", "--outcome", "--about", "--limit"].includes(a)) {
      args[a.slice(2)] = argv[++i];
    } else if (a.startsWith("--")) args[a.slice(2)] = true;
    else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const root = args.root ?? process.env.TURN_RECORD_ROOT ?? join(homedir(), ".turn-record");
const store = new RecordStore(root, {});
const index = new RecordIndex(store);
try {
  const rows = index.segmentCatalog({
    thread: args.thread,
    type: args.type,
    outcome: args.outcome,
    about: args.about,
    q: args._.join(" ").trim() || undefined,
    includeDead: Boolean(args["include-dead"]),
    limit: args.limit ? Number(args.limit) : 50,
  });
  if (rows.length === 0) {
    console.error("no segments match");
    process.exit(1);
  }
  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    for (const r of rows) {
      const span = r.end_n ? `${r.start_n}..${r.end_n}` : `${r.start_n}..`;
      console.log(
        `${r.thread.slice(0, 40).padEnd(41)} ${span.padEnd(12)} ${r.type.padEnd(15)} ${r.outcome.padEnd(11)} ${r.established.slice(0, 100)}`,
      );
      console.log(`  ${r.note_id}`);
    }
  }
} finally {
  index.close();
}
