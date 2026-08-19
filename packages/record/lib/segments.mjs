// Segment conventions — the reader's output, the unit of clothing.
//
// A piece of clothing is never a single turn: it is a segment, a
// contiguous stretch of conversation (tool calls and results included)
// that does one thing — an exploration, a design argument, an
// implementation, a wrong track. Segments are worn whole or not at all;
// wrong tracks are never worn.
//
// A segment is recorded as a note turn. Its identity is (thread, start):
// a later note with the same identity revises it — extends the span,
// closes the outcome — and the latest (by the revising turn's ts, then
// id) wins, exactly like session snapshots.

import { finishTurn } from "./canonical.mjs";

export const SEGMENT_TYPES = new Set([
  "exploration",
  "design",
  "implementation",
  "review",
  "handoff",
  "wrong-track",
  "admin",
]);

export const SEGMENT_OUTCOMES = new Set(["fruitful", "dead-end", "superseded", "ongoing"]);

export function segmentTurnCore({
  owner,
  thread,
  start,
  end = null,
  type,
  about = [],
  established,
  outcome,
  ts,
  model,
}) {
  if (!SEGMENT_TYPES.has(type)) throw new Error(`bad segment type ${type}`);
  if (!SEGMENT_OUTCOMES.has(outcome)) throw new Error(`bad segment outcome ${outcome}`);
  return {
    v: 1,
    ts,
    from: owner,
    kind: "note",
    links: [{ rel: "segments", ref: thread }],
    body: {
      text: String(established ?? "").slice(0, 300),
      segment: {
        span: [start, ...(end ? [end] : [])],
        type,
        ...(about.length > 0 ? { about } : {}),
        established: String(established ?? ""),
        outcome,
      },
    },
    provenance: {
      source: "mind",
      fidelity: "summary",
      origin: { thread, ...(model ? { model } : {}) },
    },
  };
}

export function parseSegment(turn) {
  const seg = turn?.body?.segment;
  if (!seg || typeof seg !== "object" || !Array.isArray(seg.span) || seg.span.length < 1) {
    return null;
  }
  const links = Array.isArray(turn.links) ? turn.links : [];
  const thread = links.find((l) => l?.rel === "segments")?.ref;
  if (!thread) return null;
  return {
    thread,
    start: String(seg.span[0]),
    end: seg.span.length > 1 ? String(seg.span[1]) : null,
    type: String(seg.type ?? ""),
    about: Array.isArray(seg.about) ? seg.about : [],
    established: String(seg.established ?? ""),
    outcome: String(seg.outcome ?? "ongoing"),
    ts: turn.ts,
    turnId: turn.id,
  };
}

function tsMs(ts) {
  const ms = Date.parse(String(ts));
  return Number.isFinite(ms) ? ms : 0;
}

// Resolve the current segment map for a thread from mind streams:
// group by (thread, start), latest revision wins (empty/unparseable
// timestamps compare as epoch so revision still resolves by turn id).
// Returns segments in start order (numeric when starts are line refs).
// v1 debt, accepted like taggedRefs: this scans the whole store
// (readAll + hiddenIds) on every call; cost grows with the record, not
// the thread. Index backing when the mind stream grows real volume.
export function segmentsFor(store, thread) {
  const latest = new Map();
  // Tombstoned segment notes are hidden like any other turn: readers of
  // the map must not resurrect retracted judgments.
  const byId = store.readAll();
  const hidden = store.hiddenIds(byId);
  for (const streamId of store.listStreams()) {
    if (!streamId.includes("~mind")) continue;
    for (const turn of store.readStream(streamId)) {
      if (hidden.has(turn.id)) continue;
      let seg;
      try {
        seg = parseSegment(turn);
      } catch {
        continue;
      }
      if (!seg || seg.thread !== thread) continue;
      const key = seg.start;
      const prev = latest.get(key);
      if (!prev || tsMs(seg.ts) > tsMs(prev.ts) || (tsMs(seg.ts) === tsMs(prev.ts) && seg.turnId > prev.turnId)) {
        latest.set(key, seg);
      }
    }
  }
  const locNum = (ref) => {
    const m = /line:(\d+)/.exec(ref);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  return [...latest.values()].sort((a, b) => locNum(a.start) - locNum(b.start));
}
