// Live-follow for the reader — the consciousness waking per capture batch.
//
// The working agents on this machine keep living; capture appends their
// events to per-session streams; the follower notices which journals grew
// and runs the reader on exactly those threads. readThread already
// resumes from the last closed annotation, so a follow run reads only
// what is new — waking often is cheap in reading, and the byte threshold
// keeps it cheap in engine calls too.
//
// One follower per machine follows that machine's own captures (streams
// of its owner). State is in-memory: a fresh follower baselines at the
// journals' current sizes and reacts to growth from there; pre-existing
// backlog is read either with `mind --backfill` or by starting the
// follower with catchUp.

import { statSync } from "node:fs";

import { farewellTurnCore, jiminyNameFor, mindStreamFor, parseFarewell, parseFollow } from "./jiminy.mjs";

// `<owner>~<source>.<session-id>` -> `<source>:session:<session-id>`,
// for this owner's session streams only; null for everything else.
export function sessionThreadOf(streamId, owner) {
  if (!streamId.startsWith(`${owner}~`)) return null;
  const rest = streamId.slice(owner.length + 1);
  const m = /^(cc|pi|codex)\.(.+)$/.exec(rest);
  return m ? `${m[1]}:session:${m[2]}` : null;
}

// Death by staleness. A principal whose journal has not grown for
// staleAfterMs gets ONE final wake (threshold waived, so the reader sees
// the remaining tail and can close what the evidence closes), then a
// farewell note. Only BORN jiminies die — a never-followed historical
// session is backfill's business, not a corpse. Death is a point, not a
// sentence: journal growth after the farewell revives the jiminy, since
// the follower compares farewell time against journal mtime.
function handleStale(store, { owner, thread, streamId, mtimeMs, run }) {
  const mindStream = mindStreamFor(owner, thread);
  let notes;
  try {
    notes = store.readStream(mindStream);
  } catch {
    return null; // unreadable mind stream: fail toward silence, not a wake
  }
  if (!notes.some((t) => parseFollow(t))) return null; // never born
  const farewells = notes.map(parseFarewell).filter(Boolean);
  const lastFarewell = farewells.reduce((m, f) => Math.max(m, Date.parse(f.ts) || 0), 0);
  if (lastFarewell >= mtimeMs) return null; // already mourned this death
  const result = run(thread, streamId, { final: true });
  store.appendCore(
    mindStream,
    farewellTurnCore({
      jiminy: jiminyNameFor(thread),
      principalThread: thread,
      ts: new Date(mtimeMs).toISOString(),
      reason: "stale",
    }),
  );
  return result;
}

// One follow pass: scan this owner's session streams, run the reader on
// every thread whose journal grew by at least minNewBytes since the last
// successful run, and mourn the born jiminies whose principals went
// stale. `run(thread, streamId, {final})` does the actual reading (the
// bin passes readThread with its engine; final marks a death's last
// wake); a throwing run leaves the stream's state untouched, so the
// next pass retries it.
export function followPass(
  store,
  { owner, state, minNewBytes = 30000, catchUp = false, staleAfterMs = 24 * 3600 * 1000, run },
) {
  if (!owner) throw new Error("followPass requires an owner");
  if (!(state instanceof Map)) throw new Error("followPass requires a state Map");
  if (typeof run !== "function") throw new Error("followPass requires a run function");
  let scanned = 0;
  const ran = [];
  const failed = [];
  const died = [];
  for (const streamId of store.listStreams()) {
    const thread = sessionThreadOf(streamId, owner);
    if (!thread) continue;
    scanned++;
    let stat;
    try {
      stat = statSync(store.journalPath(streamId));
    } catch {
      continue; // stream listed but journal missing: nothing to follow
    }
    const size = stat.size;
    // First sighting baselines at current size (or 0 with catchUp): the
    // growth gate reacts from here. Staleness is judged from the
    // journal's own mtime — durable — so a death is noticed on the very
    // first pass after a follower restart, not one pass later.
    if (!state.has(streamId)) state.set(streamId, catchUp ? 0 : size);
    const grown = size - state.get(streamId) >= minNewBytes;
    const stale = staleAfterMs > 0 && Date.now() - stat.mtimeMs > staleAfterMs;
    if (!grown && !stale) continue;
    try {
      if (grown) {
        const result = run(thread, streamId, { final: false });
        state.set(streamId, size);
        ran.push({ thread, streamId, result });
      } else {
        const result = handleStale(store, { owner, thread, streamId, mtimeMs: stat.mtimeMs, run });
        if (result !== null) {
          state.set(streamId, size);
          died.push({ thread, streamId, result });
        }
      }
    } catch (err) {
      failed.push({ thread, streamId, error: err?.message ?? String(err) });
    }
  }
  return { scanned, ran, failed, died };
}
