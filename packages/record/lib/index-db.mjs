// Derived SQLite index over the record: turn metadata + FTS5 text.
// The index is cache: deleting <root>/index/ loses nothing; rebuild()
// reconstructs it from the streams. It is never replicated.
//
// update() is incremental: it indexes only journal lines appended since the
// last pass (per-stream position in index_state), so a capture pass costs
// seconds, not a rescan of the record. rebuild() is reset + update-from-zero
// — one code path, identical semantics.
//
// Session turns are one per native transcript event (body.line holds the
// verbatim record); text is extracted from that line, so a hit names the
// turn AND the event's line in the original transcript.

import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Bump whenever the derived schema changes shape. The index is cache:
// a version mismatch self-heals by deleting the database and rebuilding
// from the record — never by in-place migration.
const SCHEMA_VERSION = 1;

import { extractCcText, extractSessionTextFor } from "./formats.mjs";
import { parseOutfit, parseTag } from "./tags.mjs";
import { parseSegment, parseSpawn } from "./segments.mjs";

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
CREATE TABLE IF NOT EXISTS tags (
  tag_id TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  about TEXT NOT NULL,
  acts TEXT NOT NULL,
  case_slug TEXT,
  note TEXT NOT NULL,
  PRIMARY KEY (tag_id)
);
CREATE INDEX IF NOT EXISTS tags_target ON tags(target_ref);
CREATE INDEX IF NOT EXISTS tags_case ON tags(case_slug);
CREATE TABLE IF NOT EXISTS outfits (
  outfit_id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  status TEXT NOT NULL,
  members TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS segments (
  note_id TEXT PRIMARY KEY,
  thread TEXT NOT NULL,
  start_n INTEGER NOT NULL,
  end_n INTEGER,
  type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  about TEXT NOT NULL,
  established TEXT NOT NULL,
  lesson TEXT,
  ts TEXT NOT NULL,
  ts_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS segments_thread ON segments(thread, start_n);
CREATE TABLE IF NOT EXISTS spawns (
  note_id TEXT PRIMARY KEY,
  agent_thread TEXT NOT NULL,
  outfit_id TEXT NOT NULL,
  task TEXT,
  harness TEXT,
  grant_ref TEXT,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS spawns_agent ON spawns(agent_thread);
CREATE VIRTUAL TABLE IF NOT EXISTS turn_text USING fts5(
  turn_id UNINDEXED, loc UNINDEXED, role UNINDEXED, text
);
`;

export class RecordIndex {
  constructor(store) {
    this.store = store;
    const dir = join(store.root, "index");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "turns.db");
    const open = () => {
      const db = new DatabaseSync(path);
      // Concurrent index users (watcher pass, manual reindex, recall)
      // wait for each other instead of dying on "database is locked".
      db.exec("PRAGMA busy_timeout = 60000");
      return db;
    };
    this.db = open();
    const version = this.db.prepare("PRAGMA user_version").get().user_version;
    const isNew = !this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'turns'")
      .get();
    if (!isNew && version !== SCHEMA_VERSION) {
      // Old-schema index: self-heal by starting over. Deleting the cache
      // loses nothing; an in-place ALTER would just be a second way to
      // get this wrong.
      this.db.close();
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          if (existsSync(path + suffix)) unlinkSync(path + suffix);
        } catch {
          // Two processes self-healing at the same instant: the loser's
          // unlink races the winner's; either way the schema ends fixed.
        }
      }
      this.db = open();
    }
    this.db.exec(SCHEMA);
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
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
      this.db.exec("DELETE FROM tags");
      this.db.exec("DELETE FROM outfits");
      this.db.exec("DELETE FROM segments");
      this.db.exec("DELETE FROM spawns");
      this.db.exec("DELETE FROM index_state");
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    this.update();
  }

  // Insert one turn, maintaining the hidden invariant in both arrival
  // orders (tombstone before or after target). Duplicate ids across
  // streams: first seen wins.
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

    // Sessions are one turn per native event (no snapshots, nothing to
    // supersede); events/superseded columns remain for schema stability.
    const events = 0;
    const superseded = 0;

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
          this.db.prepare("DELETE FROM segments WHERE note_id = ?").run(target.id);
          this.db.prepare("DELETE FROM spawns WHERE note_id = ?").run(target.id);
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

    // Selection map: tags, outfits, segments, and spawns are note turns
    // with structured bodies; the index makes them queryable. A malformed
    // note turn must never break indexing — the rebuild invariant (one
    // bad turn anywhere cannot make the index unrecoverable) outranks
    // completeness of the selection map.
    let tag = null;
    let outfitParsed = null;
    let segParsed = null;
    let spawnParsed = null;
    if (turn.kind === "note") {
      try {
        tag = parseTag(turn);
        outfitParsed = parseOutfit(turn);
        segParsed = parseSegment(turn);
        spawnParsed = parseSpawn(turn);
      } catch {
        tag = null;
        outfitParsed = null;
        segParsed = null;
        spawnParsed = null;
      }
    }
    if (tag) {
      this.db
        .prepare(
          "INSERT OR IGNORE INTO tags (tag_id, target_ref, about, acts, case_slug, note) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(turn.id, tag.target, JSON.stringify(tag.about), JSON.stringify(tag.acts), tag.caseSlug, tag.note);
    }
    const outfit = outfitParsed;
    if (outfit) {
      this.db
        .prepare("INSERT OR IGNORE INTO outfits (outfit_id, task, status, members) VALUES (?, ?, ?, ?)")
        .run(turn.id, outfit.task, outfit.status, JSON.stringify(outfit.members));
    }
    if (segParsed && !hidden) {
      const locN = (r) => Number(/line:(\d+)/.exec(r ?? "")?.[1] ?? null);
      const tsMs = Date.parse(String(turn.ts ?? ""));
      this.db
        .prepare(
          `INSERT OR IGNORE INTO segments (note_id, thread, start_n, end_n, type, outcome, about, established, lesson, ts, ts_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          turn.id,
          segParsed.thread,
          locN(segParsed.start) ?? 0,
          segParsed.end ? locN(segParsed.end) : null,
          segParsed.type,
          segParsed.outcome,
          JSON.stringify(segParsed.about),
          segParsed.established,
          segParsed.lesson,
          String(turn.ts ?? ""),
          Number.isFinite(tsMs) ? tsMs : 0,
        );
      // Full established+lesson searchable under role "segment".
      this.db
        .prepare("INSERT INTO turn_text (turn_id, loc, role, text) VALUES (?, ?, ?, ?)")
        .run(turn.id, "", "segment", segParsed.established + (segParsed.lesson ? "\n" + segParsed.lesson : ""));
    }
    if (spawnParsed && !hidden) {
      this.db
        .prepare(
          "INSERT OR IGNORE INTO spawns (note_id, agent_thread, outfit_id, task, harness, grant_ref, ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(turn.id, spawnParsed.agent, spawnParsed.outfit, spawnParsed.task, spawnParsed.harness, spawnParsed.grant, String(turn.ts ?? ""));
    }
  }

  // The segment catalog: latest revision per (thread, start), structural
  // filters + optional FTS over established/lesson. Dead ends and
  // superseded judgments are excluded unless asked for.
  segmentCatalog({ thread, type, outcome, about, q, includeDead = false, limit = 50 } = {}) {
    let rows = this.db
      .prepare(
        `SELECT * FROM segments s WHERE NOT EXISTS (
           SELECT 1 FROM segments s2 WHERE s2.thread = s.thread AND s2.start_n = s.start_n
             AND (s2.ts_ms > s.ts_ms OR (s2.ts_ms = s.ts_ms AND s2.note_id > s.note_id)))`,
      )
      .all();
    if (q) {
      const hits = new Set(this.search(q, { role: "segment", limit: 500 }).map((h) => h.id));
      rows = rows.filter((r) => hits.has(r.note_id));
    }
    rows = rows.filter((r) => {
      if (thread && r.thread !== thread) return false;
      if (type && r.type !== type) return false;
      if (outcome && r.outcome !== outcome) return false;
      if (!outcome && !includeDead && (r.outcome === "dead-end" || r.outcome === "superseded")) return false;
      if (about && !JSON.parse(r.about).includes(about)) return false;
      return true;
    });
    rows.sort((a, b) => a.thread.localeCompare(b.thread) || a.start_n - b.start_n);
    return rows.slice(0, limit).map((r) => ({ ...r, about: JSON.parse(r.about) }));
  }

  // Creation mapping lookups for quality assessment.
  spawnsFor({ agent, outfit } = {}) {
    const rows = this.db.prepare("SELECT * FROM spawns").all();
    return rows.filter(
      (r) => (!agent || r.agent_thread === agent) && (!outfit || r.outfit_id === outfit),
    );
  }

  // Turn refs tagged with a case or topic slug (exact slug match).
  // The unfiltered scan is v1 debt: fine while the mind stream is small,
  // needs paging when tags accumulate over the record's lifetime.
  taggedRefs({ caseSlug, about } = {}) {
    const rows = caseSlug
      ? this.db
          .prepare("SELECT target_ref, about, acts, case_slug, note FROM tags WHERE case_slug = ?")
          .all(caseSlug)
      : this.db.prepare("SELECT target_ref, about, acts, case_slug, note FROM tags").all();
    return rows
      .filter((r) => {
        if (caseSlug && r.case_slug !== caseSlug) return false;
        if (about && !JSON.parse(r.about).includes(about)) return false;
        return true;
      })
      .map((r) => ({
        ref: r.target_ref,
        about: JSON.parse(r.about),
        acts: JSON.parse(r.acts),
        caseSlug: r.case_slug,
        note: r.note,
      }));
  }

  outfitsFor(taskWords) {
    const rows = this.db.prepare("SELECT outfit_id, task, status, members FROM outfits").all();
    const words = taskWords.toLowerCase().split(/\s+/).filter(Boolean);
    return rows
      .filter((r) => words.some((w) => r.task.toLowerCase().includes(w)))
      .map((r) => ({ id: r.outfit_id, task: r.task, status: r.status, members: JSON.parse(r.members) }));
  }

  // Text documents for one turn. Mail/chat: one doc. Session: one doc per
  // conversational event extracted from the transcript blob.
  extractText(turn) {
    return extractTurnText(turn);
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

  searchRaw(query, { kind, thread, from, role, limit = 20 } = {}) {
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
    if (role) {
      sql += " AND x.role = ?";
      params.push(role);
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

// Journal text extraction is independent of the derived search database.
export function extractTurnText(turn) {
  if (turn.kind === "note" && turn.body?.segment) return []; // dedicated role "segment" row
  if (turn.kind === "mail" || turn.kind === "chat" || turn.kind === "note") {
    const subject = turn.body?.subject ?? "";
    const text = turn.body?.text ?? "";
    const joined = subject ? subject + "\n" + text : text;
    return joined.trim() ? [{ loc: "", role: turn.kind, text: joined }] : [];
  }
  if (turn.kind === "session" && typeof turn.body?.line === "string") {
    const loc = `line:${turn.provenance?.origin?.line ?? 0}`;
    return extractSessionTextFor(turn.provenance?.source, Buffer.from(turn.body.line, "utf8")).map(
      (d) => ({ ...d, loc }),
    );
  }
  return [];
}

// Claude Code text extraction, re-exported for compatibility; the
// per-format extractors live in formats.mjs.
export const extractSessionText = extractCcText;

export function dropIndex(store) {
  rmSync(join(store.root, "index"), { recursive: true, force: true });
}

// Resolve a turn id wherever it lives: bulk streams first, then (for
// session-event turns, whose streams bulk reads exclude) via the index's
// stream column and a targeted journal read.
export function resolveTurn(store, index, id, byId = null) {
  const bulk = byId ?? store.readAll();
  const hit = bulk.get(id);
  if (hit) return hit.turn;
  const row = index.db.prepare("SELECT stream FROM turns WHERE id = ?").get(id);
  if (!row) return null;
  for (const t of store.readStream(row.stream)) if (t.id === id) return t;
  return null;
}
