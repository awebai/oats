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

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["--root", "--owner", "--thread", "--budget-chars", "--since", "--out"].includes(a)) {
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
if (!args.thread) {
  console.error(
    "usage: dress --thread <thread> [--budget-chars N] [--since <iso-ts>] [--out file] [--no-log]",
  );
  process.exit(2);
}

const root = args.root ?? process.env.TURN_RECORD_ROOT ?? join(homedir(), ".turn-record");
const owner = args.owner ?? process.env.TURN_RECORD_OWNER ?? hostname().split(".")[0];
const store = new RecordStore(root, { owner });

let result;
try {
  result = dress(store, {
    thread: args.thread,
    budgetChars: args["budget-chars"] ? Number(args["budget-chars"]) : undefined,
    since: args.since ?? null,
    log: !args["no-log"],
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
