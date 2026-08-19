// Derived SQLite index over the record: turn metadata + FTS5 text.
// The index is cache: deleting <root>/index/ loses nothing; rebuild()
// reconstructs it from streams + objects. It is never replicated.
//
// update() is incremental: it indexes only journal lines appended since the
// last pass (per-stream position in index_state), so a capture pass costs
// seconds, not a rescan of every blob. rebuild() is reset + update-from-zero
// — one code path, identical semantics.
//
// Session turns are snapshots; only the latest snapshot per thread is
// searchable (the store keeps every snapshot as truth). Text for session
// turns is extracted from the referenced transcript blob: one FTS row per
// conversational event, so a hit names the turn AND the event line.

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  from_name TEXT NOT NULL,
  to_name TEXT,
  thread TEXT,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  fidelity TEXT NOT NULL,
  stream TEXT NOT NULL,
  events INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  superseded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS turns_thread ON turns(thread);
CREATE INDEX IF NOT EXISTS turns_ts ON turns(ts);
CREATE TABLE IF NOT EXISTS tombstones (
  ref TEXT NOT NULL,
  from_name TEXT NOT NULL,
  PRIMARY KEY (ref, from_name)
);
CREATE TABLE IF NOT EXISTS index_state (
  stream TEXT PRIMARY KEY,
  indexed_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS turn_text USING fts5(
  turn_id UNINDEXED, loc UNINDEXED, role UNINDEXED, text
);
`;

export class RecordIndex {
  constructor(store) {
    this.store = store;
    const dir = join(store.root, "index");
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(join(dir, "turns.db"));
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  recordOwner() {
    if (this.store.owner) return this.store.owner;
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'owner'").get();
    return row ? row.value : null;
  }

  // Index everything appended since the last pass.
  update() {
    const owner = this.store.owner;
    this.db.exec("BEGIN");
    try {
      if (owner) {
        this.db
          .prepare("INSERT INTO meta (key, value) VALUES ('owner', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
          .run(owner);
      }
      const effectiveOwner = this.recordOwner();
      const getState = this.db.prepare("SELECT indexed_count FROM index_state WHERE stream = ?");
      const setState = this.db.prepare(
        "INSERT INTO index_state (stream, indexed_count) VALUES (?, ?) ON CONFLICT(stream) DO UPDATE SET indexed_count = excluded.indexed_count",
      );
      for (const streamId of this.store.listStreams()) {
        const turns = this.store.readStream(streamId);
        const done = Number(getState.get(streamId)?.indexed_count ?? 0);
        for (let i = done; i < turns.length; i++) {
          this.addTurn(turns[i], streamId, effectiveOwner);
        }
        setState.run(streamId, turns.length);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // Full rebuild = reset + update from zero. Same code path as update().
  rebuild() {
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM turns");
      this.db.exec("DELETE FROM turn_text");
      this.db.exec("DELETE FROM tombstones");
      this.db.exec("DELETE FROM index_state");
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    this.update();
  }

  // Insert one turn, maintaining hidden/superseded invariants in both
  // arrival orders (tombstone before or after target; snapshots out of
  // order). Duplicate ids across streams: first seen wins.
  addTurn(turn, streamId, owner) {
    if (typeof turn.id !== "string") return;
    const existing = this.db.prepare("SELECT stream FROM turns WHERE id = ?").get(turn.id);
    if (existing) {
      // Duplicate id across streams. Keep attribution deterministic and in
      // agreement with RecordStore.readAll(): alphabetically first stream,
      // regardless of indexing order.
      if (streamId < existing.stream) {
        this.db.prepare("UPDATE turns SET stream = ? WHERE id = ?").run(streamId, turn.id);
      }
      return;
    }

    const fromName = String(turn.from ?? "");
    // Hidden if a valid tombstone already arrived for this id.
    const tombs = this.db.prepare("SELECT from_name FROM tombstones WHERE ref = ?").all(turn.id);
    const hidden = tombs.some((t) => t.from_name === fromName || (owner && t.from_name === owner))
      ? 1
      : 0;

    const events = turn.kind === "session" ? Number(turn.body?.events ?? 0) : 0;
    let superseded = 0;
    let displacedId = null;
    if (turn.kind === "session" && turn.thread) {
      const current = this.db
        .prepare(
          "SELECT id, ts, events FROM turns WHERE thread = ? AND kind = 'session' AND superseded = 0",
        )
        .get(turn.thread);
      if (current) {
        const newer =
          events !== Number(current.events)
            ? events > Number(current.events)
            : String(turn.ts) > String(current.ts);
        if (newer) displacedId = current.id;
        else superseded = 1;
      }
    }

    this.db
      .prepare(
        `INSERT INTO turns (id, ts, from_name, to_name, thread, kind, source, fidelity, stream, events, hidden, superseded)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        turn.id,
        String(turn.ts ?? ""),
        fromName,
        turn.to === undefined ? null : Array.isArray(turn.to) ? turn.to.join(",") : String(turn.to),
        turn.thread ?? null,
        String(turn.kind ?? ""),
        String(turn.provenance?.source ?? ""),
        String(turn.provenance?.fidelity ?? ""),
        streamId,
        events,
        hidden,
        superseded,
      );

    if (displacedId) {
      this.db.prepare("UPDATE turns SET superseded = 1 WHERE id = ?").run(displacedId);
      this.db.prepare("DELETE FROM turn_text WHERE turn_id = ?").run(displacedId);
    }

    if (turn.kind === "tombstone") {
      for (const link of turn.links ?? []) {
        if (link.rel !== "tombstones" || typeof link.ref !== "string") continue;
        this.db
          .prepare("INSERT OR IGNORE INTO tombstones (ref, from_name) VALUES (?, ?)")
          .run(link.ref, fromName);
        // Apply to a target that arrived first.
        const target = this.db
          .prepare("SELECT id, from_name FROM turns WHERE id = ? AND hidden = 0")
          .get(link.ref);
        if (target && (target.from_name === fromName || (owner && fromName === owner))) {
          this.db.prepare("UPDATE turns SET hidden = 1 WHERE id = ?").run(target.id);
          this.db.prepare("DELETE FROM turn_text WHERE turn_id = ?").run(target.id);
        }
      }
    }

    if (!hidden && !superseded) {
      const insText = this.db.prepare(
        "INSERT INTO turn_text (turn_id, loc, role, text) VALUES (?, ?, ?, ?)",
      );
      for (const doc of this.extractText(turn)) {
        insText.run(turn.id, doc.loc, doc.role, doc.text);
      }
    }
  }

  // Text documents for one turn. Mail/chat: one doc. Session: one doc per
  // conversational event extracted from the transcript blob.
  extractText(turn) {
    if (turn.kind === "mail" || turn.kind === "chat" || turn.kind === "note") {
      const subject = turn.body?.subject ?? "";
      const text = turn.body?.text ?? "";
      const joined = subject ? subject + "\n" + text : text;
      return joined.trim() ? [{ loc: "", role: turn.kind, text: joined }] : [];
    }
    if (turn.kind === "session" && turn.body?.ref) {
      let bytes;
      try {
        bytes = this.store.getObject(turn.body.ref);
      } catch {
        return []; // blob not replicated here; metadata still indexed
      }
      return extractSessionText(bytes);
    }
    return [];
  }

  // FTS query with optional filters. Returns rows with turn metadata and a
  // snippet. Hidden (tombstoned) and superseded turns never match.
  //
  // User text is not FTS5 syntax: a colon, a trailing AND, or an unbalanced
  // quote raises a parse error inside SQLite. First try the query as given
  // (so power users keep operators), then fall back to quoting every term
  // as a literal, then to no matches — never a crash.
  search(query, opts = {}) {
    try {
      return this.searchRaw(query, opts);
    } catch {
      const quoted = String(query)
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => '"' + t.replaceAll('"', '""') + '"')
        .join(" ");
      if (!quoted) return [];
      try {
        return this.searchRaw(quoted, opts);
      } catch {
        return [];
      }
    }
  }

  searchRaw(query, { kind, thread, from, limit = 20 } = {}) {
    let sql = `
      SELECT t.id, t.ts, t.from_name, t.to_name, t.thread, t.kind, t.source, t.stream,
             x.loc, x.role, snippet(turn_text, 3, '', '', ' … ', 24) AS snip
      FROM turn_text x
      JOIN turns t ON t.id = x.turn_id
      WHERE turn_text MATCH ? AND t.hidden = 0 AND t.superseded = 0`;
    const params = [query];
    if (kind) {
      sql += " AND t.kind = ?";
      params.push(kind);
    }
    if (thread) {
      sql += " AND t.thread = ?";
      params.push(thread);
    }
    if (from) {
      sql += " AND t.from_name = ?";
      params.push(from);
    }
    sql += " ORDER BY rank LIMIT ?";
    params.push(limit);
    return this.db.prepare(sql).all(...params);
  }

  counts() {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS turns,
                SUM(hidden) AS hidden,
                SUM(superseded) AS superseded,
                (SELECT COUNT(*) FROM turn_text) AS docs
         FROM turns`,
      )
      .get();
    return {
      turns: Number(row.turns ?? 0),
      hidden: Number(row.hidden ?? 0),
      superseded: Number(row.superseded ?? 0),
      docs: Number(row.docs ?? 0),
    };
  }
}

// Pull searchable text out of a Claude Code transcript blob: user and
// assistant message text parts. Everything else (tool results, snapshots,
// attachments) stays in the blob, findable via `capture` but not indexed —
// indexing tool output would bury conversational hits in noise.
export function extractSessionText(bytes) {
  const docs = [];
  const lines = bytes.toString("utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.type !== "user" && d.type !== "assistant") continue;
    const content = d.message?.content;
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n");
    }
    if (text.trim()) docs.push({ loc: `line:${i + 1}`, role: d.type, text });
  }
  return docs;
}

export function dropIndex(store) {
  rmSync(join(store.root, "index"), { recursive: true, force: true });
}
