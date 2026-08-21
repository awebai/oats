#!/usr/bin/env node
// recall — search the turn record.
//
//   recall <query...>                 FTS5 query over mail, chat, sessions
//   recall --kind mail <query...>     filter by kind (mail|chat|session|note)
//   recall --thread <thread> [query]  filter/list by thread
//   recall --from <name> <query...>   filter by speaker
//   recall --limit N                  max results (default 20)
//   recall --show <turn-id>           print one turn as JSON
//   recall --reindex                  rebuild the derived index and exit
//
// Store root: --root, else $TURN_RECORD_ROOT, else ~/.turn-record

import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { RecordStore } from "../lib/store.mjs";
import { RecordIndex } from "../lib/index-db.mjs";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["--root", "--kind", "--thread", "--from", "--role", "--limit", "--show"].includes(a)) {
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
  if (args.reindex) {
    index.rebuild();
    console.log(JSON.stringify(index.counts()));
    process.exit(0);
  }

  if (args.show) {
    const { resolveTurn } = await import("../lib/index-db.mjs");
    const byId = store.readAll();
    const turn = resolveTurn(store, index, args.show, byId);
    if (!turn) {
      console.error(`no turn ${args.show}`);
      process.exit(1);
    }
    // Tombstoned turns are hidden from tool output, id lookup included.
    if (store.hiddenIds(byId).has(args.show)) {
      console.error(`turn ${args.show} is tombstoned`);
      process.exit(1);
    }
    console.log(JSON.stringify(turn, null, 2));
    process.exit(0);
  }

  const query = args._.join(" ").trim();
  if (!query && !args.thread) {
    console.error("usage: recall [--kind k] [--thread t] [--from f] [--role r] [--limit n] <query>");
    process.exit(2);
  }

  const limit = args.limit ? Number(args.limit) : 20;
  let rows;
  if (query) {
    rows = index.search(query, {
      kind: args.kind,
      thread: args.thread,
      from: args.from,
      role: args.role,
      limit,
    });
  } else {
    // Thread listing without a text query: chronological turns of a thread.
    rows = index.db
      .prepare(
        `SELECT id, ts, from_name, to_name, thread, kind, source, stream, '' AS loc, kind AS role, '' AS snip
         FROM turns WHERE thread = ? AND hidden = 0 AND superseded = 0
         ORDER BY ts LIMIT ?`,
      )
      .all(args.thread, limit);
  }

  if (rows.length === 0) {
    console.error("no matches");
    process.exit(1);
  }
  for (const r of rows) {
    const where = r.loc ? ` @${r.loc}` : "";
    const to = r.to_name ? ` -> ${r.to_name}` : "";
    console.log(`${r.ts}  [${r.kind}] ${r.from_name}${to}  ${r.thread ?? ""}${where}`);
    if (r.snip) console.log(`    ${r.snip.replaceAll("\n", " ")}`);
    console.log(`    ${r.id}`);
  }
} finally {
  index.close();
}
