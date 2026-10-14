// Private command inventory. The caller owns the root capture lock; public
// synchronous capture never opens this queue. Pages and discovery checkpoints
// commit together. Source content/cursors remain the owning capture helpers'
// responsibility, and losing this derived queue only restarts enumeration.
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";

const sources = new Set(["aw", "cc", "pi", "codex"]);
const outcomes = new Set(["ready", "complete", "pending", "set-aside", "ignored", "failed"]);
const pageSize = 128;
const visitFlags = Object.freeze({ filesVisited: 1, inputsPending: 2, inputsSetAside: 4, inputsFailed: 8, inputsIgnored: 16 });
const validInput = input => input && sources.has(input.source) && typeof input.path === "string" &&
  isAbsolute(input.path) && !input.path.includes("\0") && typeof input.stream === "string" && input.stream &&
  (input.details === undefined || input.details && typeof input.details === "object" && !Array.isArray(input.details));

export class CaptureSourceQueue {
  constructor(state, { owner, selection }) {
    if (state.depth || typeof owner !== "string" || !owner || typeof selection !== "string" || !selection)
      throw new Error("invalid capture source queue selection");
    this.state = state; this.owner = owner; this.selection = selection;
    const present = state.db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='capture_sources'").get()?.found;
    if (!present) state.transaction(() => { state.db.exec(`
      CREATE TABLE IF NOT EXISTS capture_sources (
        scope TEXT NOT NULL, position INTEGER NOT NULL, source TEXT NOT NULL,
        path TEXT NOT NULL, stream TEXT NOT NULL, details TEXT NOT NULL,
        outcome TEXT NOT NULL DEFAULT 'ready', PRIMARY KEY(scope,position), UNIQUE(scope,source,path)
      );
      CREATE INDEX IF NOT EXISTS capture_sources_ready ON capture_sources(scope,outcome,position);
      CREATE INDEX IF NOT EXISTS capture_sources_stream ON capture_sources(scope,stream,outcome,position);
    `);
      // A missing inventory table cannot inherit a completed discovery cursor.
      // Re-enumeration is safe: journal IDs/source proofs still own dedupe.
      state.db.exec("DELETE FROM state WHERE kind IN ('source-sweep','source-queue-garbage')");
    });
    // Private inventory metadata, never an outgoing-release source cursor.
    // Additive columns also accept queues created by an earlier service build.
    const columns = new Set(state.db.prepare("PRAGMA table_info(capture_sources)").all().map(column => column.name));
    if (!columns.has("visited_run") || !columns.has("visited_flags")) state.transaction(() => {
      if (!columns.has("visited_run")) state.db.exec("ALTER TABLE capture_sources ADD COLUMN visited_run TEXT");
      if (!columns.has("visited_flags")) state.db.exec("ALTER TABLE capture_sources ADD COLUMN visited_flags INTEGER NOT NULL DEFAULT 0");
    });
    const prior = state.get("source-sweep", owner);
    if (prior && (!prior.id || prior.owner !== owner || typeof prior.selection !== "string" ||
        !Number.isSafeInteger(prior.next) || prior.next < 1 || typeof prior.discovered !== "boolean" ||
        typeof prior.finished !== "boolean")) throw new Error("invalid capture source sweep");
    if (prior && prior.selection === selection && !prior.finished) this.sweep = prior;
    else {
      this.sweep = { id: randomUUID(), owner, selection, next: 1, discovered: false, finished: false, discovery: null };
      state.transaction(() => {
        if (prior) state.set("source-queue-garbage", prior.id, true);
        state.set("source-sweep", owner, this.sweep);
      });
    }
  }

  current() {
    const row = this.state.get("source-sweep", this.owner);
    if (row?.id !== this.sweep.id) throw new Error("capture source sweep changed");
    return row;
  }

  // The walker may conservatively replay a basename after a removed anchor.
  // Duplicate discovery never renumbers an input or erases completed work.
  add(inputs, checkpoint, { complete = false } = {}) {
    if (!Array.isArray(inputs) || inputs.length > pageSize || inputs.some(input => !validInput(input)) || typeof complete !== "boolean")
      throw new Error("invalid capture discovery page");
    this.state.transaction(() => {
      const row = this.current();
      if (row.discovered || row.finished) throw new Error("capture source discovery already completed");
      const insert = this.state.db.prepare(`INSERT INTO capture_sources(scope,position,source,path,stream,details)
        VALUES (?,?,?,?,?,?) ON CONFLICT(scope,source,path) DO NOTHING`);
      for (const input of inputs) {
        const existing = this.state.db.prepare("SELECT stream,details FROM capture_sources WHERE scope=? AND source=? AND path=?")
          .get(row.id, input.source, input.path);
        const details = JSON.stringify(input.details ?? {});
        // Early node:sqlite can return an object of nulls for no match.
        // stream is NOT NULL for every real inventory row.
        if (existing?.stream != null && (existing.stream !== input.stream || existing.details !== details)) throw new Error("capture input changed during discovery");
        if (existing?.stream == null) {
          if (!Number.isSafeInteger(row.next + 1)) throw new Error("capture source inventory position overflow");
          insert.run(row.id, row.next++, input.source, input.path, input.stream, details);
        }
      }
      row.discovery = checkpoint; row.discovered = complete;
      this.state.set("source-sweep", this.owner, row);
      this.sweep = row;
    });
  }

  // Admission writes this cursor BEFORE processing; a rolled-back append must
  // not force every new worker back to the first growing input. Each stage has
  // its own position, so index work cannot erase source-stage fairness.
  cursor(position) { return `${this.sweep.id}:${position}`; }
  position(cursor) {
    if (typeof cursor !== "string" || !cursor.startsWith(`${this.sweep.id}:`)) return 0;
    const n = Number(cursor.slice(this.sweep.id.length + 1));
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("invalid capture source queue cursor");
    return n;
  }

  *ready({ stopped = () => false, work } = {}) {
    const row = this.current();
    const after = this.position(this.state.get("capture-schedule", "position:capture")?.after);
    // Native collision precedence is unchanged: an earlier source sharing its
    // stream must finish its fixed snapshot (or reach pending/refusal) before
    // a later one can run. AW alone may interleave across its shared stream.
    for (const later of [true, false]) {
      let last = later ? after : 0;
      while (!stopped()) {
        const page = this.state.db.prepare(`SELECT q.position,q.source,q.path,q.stream,q.details,q.outcome
          FROM capture_sources q WHERE q.scope=? AND q.outcome='ready' AND q.position>?
          ${later ? "" : "AND q.position<=?"}
          AND (q.source='aw' OR NOT EXISTS (
            SELECT 1 FROM capture_sources prior WHERE prior.scope=q.scope AND prior.stream=q.stream
            AND prior.outcome='ready' AND prior.position<q.position))
          ORDER BY q.position LIMIT ${pageSize}`).all(...(later ? [row.id, last] : [row.id, last, after]));
        if (work) work.inventoryRows = (work.inventoryRows ?? 0) + page.length;
        if (!page.length) break;
        for (const input of page) {
          if (stopped()) return;
          last = input.position;
          yield { ...input, details: JSON.parse(input.details), next: { stage: "capture", after: this.cursor(input.position) } };
        }
      }
    }
  }

  // Use inside the SAME processing transaction as the input's committed
  // source checkpoint. This is scheduling state, never append/proof authority.
  mark(position, outcome) {
    if (!this.state.depth || !Number.isSafeInteger(position) || position < 1 || !outcomes.has(outcome))
      throw new Error("capture source result requires its processing transaction");
    this.current();
    const changed = this.state.db.prepare("UPDATE capture_sources SET outcome=? WHERE scope=? AND position=? AND outcome!=?")
      .run(outcome, this.sweep.id, position, outcome);
    if (!changed.changes && !this.state.db.prepare("SELECT 1 AS found FROM capture_sources WHERE scope=? AND position=?").get(this.sweep.id, position)?.found)
      throw new Error("capture source queue input is missing");
  }

  // Count each input/category at most once in a run even when its recovery or
  // append spans many workers. These facts commit with the source checkpoint.
  visit(position, runId, categories = {}) {
    if (!this.state.depth || typeof runId !== "string" || !runId ||
        !Number.isSafeInteger(position) || position < 1 ||
        Object.keys(categories).some(key => !Object.hasOwn(visitFlags, key) || typeof categories[key] !== "boolean"))
      throw new Error("capture input visits require valid committed accounting");
    this.current();
    const row = this.state.db.prepare("SELECT visited_run,visited_flags FROM capture_sources WHERE scope=? AND position=?")
      .get(this.sweep.id, position);
    if (!row || !Number.isSafeInteger(row.visited_flags) || row.visited_flags < 0 || row.visited_flags > 31)
      throw new Error("capture input visit state is missing or invalid");
    const before = row.visited_run === runId ? row.visited_flags : 0;
    let flags = before; const delta = {};
    for (const [name, flag] of Object.entries(visitFlags)) if (name === "filesVisited" || categories[name]) {
      if (!(flags & flag)) { flags |= flag; delta[name] = 1; }
    }
    if (row.visited_run !== runId || flags !== before) this.state.db
      .prepare("UPDATE capture_sources SET visited_run=?,visited_flags=? WHERE scope=? AND position=?")
      .run(runId, flags, this.sweep.id, position);
    return delta;
  }

  // Used only for a due single-stream retry. Native precedence remains the
  // earliest unfinished source; AW resumes after the durable account position.
  forStream(stream) {
    const after = this.position(this.state.get("capture-schedule", "position:capture")?.after);
    const row = this.state.db.prepare(`SELECT position,source,path,stream,details,outcome FROM capture_sources
      WHERE scope=? AND stream=? AND outcome='ready'
      ORDER BY CASE WHEN source='aw' AND position<=? THEN 1 ELSE 0 END,position LIMIT 1`)
      .get(this.sweep.id, stream, after);
    return row?.position != null ? { ...row, details: JSON.parse(row.details), next: { stage: "capture", after: this.cursor(row.position) } } : null;
  }

  finish() {
    if (!this.state.depth) throw new Error("capture source sweep finish requires a transaction");
    const row = this.current();
    if (!row.discovered || this.state.db.prepare("SELECT 1 AS found FROM capture_sources WHERE scope=? AND outcome='ready' LIMIT 1").get(row.id)?.found)
      return false;
    row.finished = true; this.state.set("source-sweep", this.owner, row); this.sweep = row;
    // Finished enumeration/visits do NOT imply a successful pass: pending,
    // set-aside and failed outcomes still need the worker's truthful receipt.
    return true;
  }

  // No table-wide reset or scan of every current row. Replacing a sweep
  // atomically publishes its exact obsolete scope; cleanup seeks that scope
  // and removes at most one page. Other owners' active scopes are untouched.
  cleanup() {
    if (!this.state.depth) throw new Error("capture source cleanup requires a transaction");
    const obsolete = this.state.db.prepare("SELECT key FROM state WHERE kind='source-queue-garbage' ORDER BY key LIMIT 1").get()?.key;
    if (obsolete == null) return 0;
    const count = Number(this.state.db.prepare(`DELETE FROM capture_sources WHERE rowid IN (
      SELECT rowid FROM capture_sources WHERE scope=? ORDER BY position LIMIT ${pageSize})`).run(obsolete).changes);
    if (!this.state.db.prepare("SELECT 1 AS found FROM capture_sources WHERE scope=? LIMIT 1").get(obsolete)?.found)
      this.state.delete("source-queue-garbage", obsolete);
    return count;
  }
}
