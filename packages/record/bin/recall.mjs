#!/usr/bin/env node
// recall — search the turn record.
//
//   recall <query...>                 FTS5 query over mail, chat, sessions
//   recall --kind mail <query...>     filter by kind (mail|chat|session|note)
//   recall --thread <thread> [query]  filter/list by thread
//   recall --thread <thread> --json   the thread's turns in journal order,
//     [--after <id>] [--until <id>]   with extracted text; exact id bounds
//     [--limit n] [--ids-only]        (after is exclusive, until inclusive);
//                                     --ids-only lists id, ts and the bytes
//                                     each turn occupies in the --json output
//                                     (text extracted but not emitted), so a
//                                     consumer can size a window it will read
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
import { extractTurnText, RecordIndex } from "../lib/index-db.mjs";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["--root", "--kind", "--thread", "--from", "--role", "--limit", "--show", "--after", "--until"].includes(a)) {
      args[a.slice(2)] = argv[++i];
    } else if (a.startsWith("--")) args[a.slice(2)] = true;
    else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const root = args.root ?? process.env.TURN_RECORD_ROOT ?? join(homedir(), ".turn-record");
const store = new RecordStore(root, {});
let index;
const getIndex = () => (index ??= new RecordIndex(store));

try {
  if (args.reindex) {
    const index = getIndex();
    index.rebuild();
    console.log(JSON.stringify(index.counts()));
    process.exit(0);
  }

  if (args.show) {
    const index = getIndex();
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

  // Thread turns straight from the journal, in capture SEQUENCE: the order a
  // consumer can bound exactly with turn ids. Timestamps tie within a turn
  // and late capture appends older stamps behind newer ones, so a window
  // named by ids is the only one two passes agree on. after is exclusive,
  // until inclusive; an unknown id is an error, never an empty answer.
  if (args.json && args.thread && !query) {
    // Session streams are not in readAll(), so hiddenIds() cannot see them:
    // resolve tombstone claims once and test each session turn directly
    // (store.mjs, tombstoneClaims). A redacted line must never reach the
    // harvester, which promotes what it reads into a durable soul.
    const claims = store.tombstoneClaims();
    const turns = [];
    const sessionStreams = store.sessionStreamsFor(args.thread);
    for (const streamId of sessionStreams) {
      for (const t of store.readStream(streamId)) if (!store.claimHides(claims, t)) turns.push(t);
    }
    if (!sessionStreams.length) {
      // not a session thread (mail, chat, note): the bulk read has them
      for (const { turn } of store.readAll().values()) if (turn.thread === args.thread && !store.claimHides(claims, turn)) turns.push(turn);
    }
    const ids = turns.map((t) => t.id);
    let start = 0;
    let end = turns.length;
    if (args.after) {
      const i = ids.indexOf(args.after);
      if (i < 0) { console.error(`--after: no turn ${args.after} in thread ${args.thread}`); process.exit(1); }
      start = i + 1;
    }
    if (args.until) {
      const i = ids.indexOf(args.until);
      if (i < 0) { console.error(`--until: no turn ${args.until} in thread ${args.thread}`); process.exit(1); }
      end = i + 1;
    }
    const cap = args.limit ? Number(args.limit) : Infinity;
    const stop = Math.min(end, start + cap);
    const window = turns.slice(start, stop);
    // A window is a bounded read: a consumer that plans one (the OKF
    // harvester) sizes it with --ids-only first, then reads exactly that.
    const out = window.map((t) => {
      const docs = extractTurnText(t);
      const base = { id: t.id, ts: t.ts, thread: t.thread, kind: t.kind, source: t.provenance?.source ?? null };
      const full = { ...base, text: docs.map((d) => ({ role: d.role, text: d.text })) };
      // bytes = what this turn occupies in the pretty-printed --json answer,
      // so a consumer's byte cap bounds what it will actually receive.
      if (args["ids-only"]) return { ...base, bytes: Buffer.byteLength(JSON.stringify(full, null, 2), "utf8") + 8 };
      return full;
    });
    console.log(JSON.stringify({ thread: args.thread, total: turns.length, from: start, to: stop, remaining: end - stop, turns: out }, null, 2));
    process.exit(0);
  }

  const index = getIndex();
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

  if (rows.length === 0 && args.json) {
    console.log("[]");
    process.exit(0);
  }
  if (rows.length === 0) {
    console.error("no matches");
    process.exit(1);
  }
  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  }
  for (const r of rows) {
    const where = r.loc ? ` @${r.loc}` : "";
    const to = r.to_name ? ` -> ${r.to_name}` : "";
    console.log(`${r.ts}  [${r.kind}] ${r.from_name}${to}  ${r.thread ?? ""}${where}`);
    if (r.snip) console.log(`    ${r.snip.replaceAll("\n", " ")}`);
    console.log(`    ${r.id}`);
  }
} finally {
  index?.close();
}
