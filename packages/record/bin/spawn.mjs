#!/usr/bin/env node
// spawn — compile an outfit into a native pi session and hand back the
// command that starts the dressed agent. The kernel primitive made real:
// the new agent begins life with the selected segments already in its
// context, as native conversation history, and the record holds a spawn
// note mapping the agent to the exact segment versions it wears.
//
//   spawn --outfit <t1:...>            compile + spawn note, print command
//   spawn --outfit <ref> --task "..."  override the outfit's task text
//   spawn --cwd <dir>                  agent working directory (default: here)
//   spawn --session-dir <dir>          pi session storage (default: ~/.pi/agent/sessions)
//   spawn --dry-run                    compile to a temp path, no spawn note
//
// Store root: --root, else $TURN_RECORD_ROOT, else ~/.turn-record
// Spawn-note owner: --owner, else $TURN_RECORD_OWNER, else short hostname.

import { mkdtempSync } from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { RecordStore } from "../lib/store.mjs";
import { CompileError, compileOutfit } from "../lib/compile-pi.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["--root", "--owner", "--outfit", "--task", "--cwd"].includes(a)) {
      args[a.slice(2)] = argv[++i];
    } else if (a === "--session-dir") {
      args.sessionDir = argv[++i];
    } else if (a === "--dry-run") {
      args.dryRun = true;
    } else {
      console.error(`unknown argument ${a}`);
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.outfit) {
  console.error("spawn: --outfit <turn-id> is required (freeze one with: turn-record dress --segment ...)");
  process.exit(2);
}
const root = args.root ?? process.env.TURN_RECORD_ROOT ?? join(homedir(), ".turn-record");
const owner = args.owner ?? process.env.TURN_RECORD_OWNER ?? hostname().split(".")[0];
const store = new RecordStore(root, { owner });

try {
  const r = compileOutfit(store, {
    outfit: args.outfit,
    owner,
    task: args.task,
    cwd: args.cwd ?? process.cwd(),
    sessionDir: args.dryRun ? mkdtempSync(join(tmpdir(), "turn-record-spawn-dry-")) : args.sessionDir,
    log: !args.dryRun,
  });
  console.error(
    `spawned ${r.agentThread}: ${r.segments} segments, ${r.entries} entries` +
      (r.spawn ? `, spawn note ${r.spawn.id.slice(0, 16)}…` : ", dry run (no spawn note)"),
  );
  console.error(`session: ${r.path}`);
  console.log(r.command);
} catch (err) {
  if (err instanceof CompileError) {
    console.error(`spawn: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
