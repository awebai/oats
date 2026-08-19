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

// `<owner>~<source>.<session-id>` -> `<source>:session:<session-id>`,
// for this owner's session streams only; null for everything else.
export function sessionThreadOf(streamId, owner) {
  if (!streamId.startsWith(`${owner}~`)) return null;
  const rest = streamId.slice(owner.length + 1);
  const m = /^(cc|pi|codex)\.(.+)$/.exec(rest);
  return m ? `${m[1]}:session:${m[2]}` : null;
}

// One follow pass: scan this owner's session streams, run the reader on
// every thread whose journal grew by at least minNewBytes since the last
// successful run. `run(thread, streamId)` does the actual reading (the
// bin passes readThread with its engine); a throwing run leaves the
// stream's state untouched, so the next pass retries it.
export function followPass(store, { owner, state, minNewBytes = 30000, catchUp = false, run }) {
  if (!owner) throw new Error("followPass requires an owner");
  if (!(state instanceof Map)) throw new Error("followPass requires a state Map");
  if (typeof run !== "function") throw new Error("followPass requires a run function");
  let scanned = 0;
  const ran = [];
  const failed = [];
  for (const streamId of store.listStreams()) {
    const thread = sessionThreadOf(streamId, owner);
    if (!thread) continue;
    scanned++;
    let size;
    try {
      size = statSync(store.journalPath(streamId)).size;
    } catch {
      continue; // stream listed but journal missing: nothing to follow
    }
    if (!state.has(streamId)) {
      state.set(streamId, catchUp ? 0 : size);
      if (!catchUp) continue; // baseline only; react to growth from here
    }
    if (size - state.get(streamId) < minNewBytes) continue;
    try {
      const result = run(thread, streamId);
      state.set(streamId, size);
      ran.push({ thread, streamId, result });
    } catch (err) {
      failed.push({ thread, streamId, error: err?.message ?? String(err) });
    }
  }
  return { scanned, ran, failed };
}
