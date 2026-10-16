// Processing outcomes are distinct from inventory membership. A stored complete
// mark can suppress work only while journal validation and index cursors still
// match. No outcome or audit page by itself is a final command receipt.
import { captureContext } from "./capture-context.mjs";
import { captureIndexWork } from "./capture-index-work.mjs";
import { readCaptureRetry } from "./capture-admission.mjs";
import { fileVersion, sameVersion } from "./derived-state.mjs";

function evidence(index, state, stream) {
  const checkpoint = state.get("journal", stream), path = index.store.journalPath(stream);
  const generation = fileVersion(path);
  if (!checkpoint || checkpoint.complete !== true || checkpoint.resetting ||
      !sameVersion(checkpoint.version, generation) || typeof checkpoint.epoch !== "string" ||
      !Number.isSafeInteger(checkpoint.bytes) || checkpoint.bytes < 0 || checkpoint.bytes > (generation?.size ?? 0) ||
      !Number.isSafeInteger(checkpoint.count) || checkpoint.count < 0 || checkpoint.count > checkpoint.bytes) return null;
  const row = index.db.prepare(`SELECT s.indexed_count,b.bytes,b.indexed_count AS byte_count,b.epoch
    FROM index_state s LEFT JOIN index_bytes b ON b.stream=s.stream WHERE s.stream=?`).get(stream);
  const cursor = row?.indexed_count != null ? { count: row.indexed_count, bytes: row.bytes,
    byteCount: row.byte_count, epoch: row.epoch } : null;
  if (cursor ? cursor.count !== checkpoint.count || cursor.byteCount !== checkpoint.count ||
      cursor.bytes !== checkpoint.bytes || cursor.epoch !== checkpoint.epoch : checkpoint.bytes !== 0 || checkpoint.count !== 0)
    return null;
  if (!sameVersion(generation, fileVersion(path))) return null;
  return { generation, epoch: checkpoint.epoch, bytes: checkpoint.bytes, count: checkpoint.count, cursor };
}

export class CaptureIndexOutcomes {
  constructor(index, inventory) {
    this.index = index; this.inventory = inventory; this.state = inventory.state;
    inventory.current();
  }

  complete(row) {
    if (row.phase !== "complete" || row.proof === null || readCaptureRetry(this.state, row.stream)) return false;
    const current = evidence(this.index, this.state, row.stream);
    return current !== null && JSON.stringify(JSON.parse(row.proof)) === JSON.stringify(current);
  }

  // With `memo`, a stream verified complete is not verified again in this
  // worker's pass until the pass writes it, and a walk that ends with every row
  // verified leaves the stage clean until then. Every pass verifies each row.
  *ready({ stopped = () => false, work, memo = false } = {}) {
    const verified = memo ? this.inventory.verified : null;
    let pending = false;
    for (const stream of this.inventory.ordered({ stopped, work, skip: verified && (name => verified.has(name)) })) {
      const row = this.state.db.prepare("SELECT stream,phase,proof FROM capture_index_inventory WHERE scope=? AND stream=?")
        .get(this.inventory.id, stream);
      if (this.complete(row)) verified?.add(stream);
      else { pending = true; yield stream; }
    }
    if (memo && !pending && !stopped()) this.inventory.clean = true;
  }

  resetRequired() {
    this.inventory.current();
    return !!this.state.db.prepare("SELECT 1 AS found FROM capture_index_inventory WHERE scope=? AND phase='reset' LIMIT 1")
      .get(this.inventory.id)?.found;
  }

  // Called by captureIndexWork after index commit and accounting, still inside
  // its stream locks and capture.db processing transaction. Any throw rolls
  // these marks/counters back together and leaves durable admission intact.
  record(result) {
    const context = captureContext(this.index.store), names = result.streams.map(row => row.stream);
    if (context?.state !== this.state || !this.state.depth || context.admission?.stage !== "index" ||
        names.length !== context.admission.members.length || new Set(names).size !== names.length ||
        names.some(stream => !context.held.has(stream))) throw new Error("index outcomes require their admitted processing transaction");
    this.inventory.include(names);
    const update = this.state.db.prepare(`UPDATE capture_index_inventory SET phase=?,proof=? WHERE scope=? AND stream=?
      AND (phase!=? OR proof IS NOT ?)`);
    for (const item of result.streams) {
      if (!["complete", "validation", "index", "reset"].includes(item.phase)) throw new Error("invalid index processing outcome");
      const proof = item.phase === "complete" ? evidence(this.index, this.state, item.stream) : null;
      if (item.phase === "complete" && proof === null) throw new Error("index completion evidence changed before publication");
      const encoded = proof === null ? null : JSON.stringify(proof);
      update.run(item.phase, encoded, this.inventory.id, item.stream, item.phase, encoded);
      // A complete outcome was just verified against current evidence; any
      // other leaves work for a later walk.
      if (item.phase === "complete") this.inventory.verified.add(item.stream);
      else this.inventory.changed([item.stream]);
    }
  }

  advance(run, start, { memo = false, ...options } = {}) {
    if (this.state.depth) throw new Error("index outcome scheduling must precede processing");
    if (start.budget.sample() !== null) return { selected: 0, stopped: true };
    // Reset is union-wide. A completed/failed detecting admission does not
    // authorize retrying reset in this worker or quietly dropping the request.
    if (this.resetRequired()) return { selected: 0, resetRequired: true };
    // A clean stage offers no candidates; due retries are still selected.
    const streams = memo && this.inventory.clean ? [] : this.ready({ stopped: () => start.budget.sample() !== null, memo });
    return captureIndexWork(this.index, this.state, streams, run, start, { ...options, outcomes: this });
  }

  // Page completion is only the end of this audit's enumeration. The owning
  // scheduler must include unfinished discovery, retries, newly captured
  // streams, reset and other stages in its final decision. Recheck after writes.
  audit({ after = "", limit = 128, stopped = () => false } = {}) {
    if (typeof after !== "string" || !Number.isSafeInteger(limit) || limit < 1 || limit > 128 || typeof stopped !== "function")
      throw new Error("invalid capture index outcome audit page");
    this.inventory.current();
    const rows = this.state.db.prepare(`SELECT stream,phase,proof FROM capture_index_inventory
      WHERE scope=? AND stream>? ORDER BY stream LIMIT ?`).all(this.inventory.id, after, limit);
    let pending = 0, checked = 0;
    for (const row of rows) {
      if (stopped()) return { checked, pending, after, complete: false, stopped: true };
      if (!this.complete(row)) pending++;
      checked++; after = row.stream;
    }
    return { checked: rows.length, pending, after: rows.at(-1)?.stream ?? after,
      complete: rows.length < limit, discovered: this.inventory.current().phase === "complete", resetRequired: this.resetRequired() };
  }
}
