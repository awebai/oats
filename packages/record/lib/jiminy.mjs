// The consciousness's identity: one jiminy per followed life.
//
// Every followed life gets its own jiminy — its own name, its own
// judgment stream, and its own long-lived pi session as memory. The
// principal is the most durable name the followed thing has: today's
// working agents are session-bound, so the principal is the session id;
// when working agents carry aweb names, `<name>-jiminy` takes over and
// follows the agent across its runtime sessions.
//
// Everything here is deterministic in the principal, so no state map is
// needed anywhere: the same followed life always resolves to the same
// jiminy name, the same mind stream, and the same memory session.

import { createHash } from "node:crypto";

// The marker that makes a memory session self-identifying, everywhere
// its id appears: session filename, captured stream id, thread.
export const JIMINY_MEMORY_PREFIX = "jiminy-";

// `<source>:session:<id>` -> the principal id; null for non-session
// threads (mail threads are read by the owner directly, not by a jiminy)
// AND for jiminy memory sessions — a memory has no principal, because a
// jiminy is never assigned a jiminy.
export function principalOf(thread) {
  const m = /^(cc|pi|codex):session:(.+)$/.exec(thread ?? "");
  if (!m) return null;
  return m[2].startsWith(JIMINY_MEMORY_PREFIX) ? null : m[2];
}

export function jiminyNameFor(thread) {
  const p = principalOf(thread);
  return p ? `jiminy-${p.slice(0, 8)}` : null;
}

// The jiminy's judgment stream: one per followed life, mirroring
// per-session capture streams. Non-session threads fall back to the
// owner's bulk mind stream (owner-level notes: outfits, spawn notes).
export function mindStreamFor(owner, thread) {
  const p = principalOf(thread);
  return p ? `${owner}~mind.${p}` : `${owner}~mind`;
}

// The jiminy's memory: a pi session whose id derives from the principal,
// so every wake resumes the same session by construction (pi's
// --session-id creates it if missing, and accepts non-uuid ids).
//
// The id is MARKED — "jiminy-" prefix — so the fact that a session is a
// consciousness's memory lives in its own name: in the session filename,
// in the captured stream id, and in the thread. Jiminys must never be
// assigned a jiminy, and a guarantee that strong cannot depend on
// cross-referencing birth notes (which can be unsynced, unreadable, or
// missing); the name itself is sufficient for any follower on any
// machine, and for the reader itself, to refuse.
export function jiminySessionId(thread) {
  const p = principalOf(thread);
  if (!p) return null;
  const h = createHash("sha256").update(`jiminy:${p}`).digest("hex");
  return `${JIMINY_MEMORY_PREFIX}${h.slice(0, 32)}`;
}

// Is this thread a jiminy's memory session? True for any session whose
// id carries the marker, regardless of source harness.
export function isJiminyMemory(thread) {
  const m = /^[a-z]+:session:(.+)$/.exec(thread ?? "");
  return m !== null && m[1].startsWith(JIMINY_MEMORY_PREFIX);
}

// The birth note: the consciousness's existence is itself recorded,
// symmetric with dressed agents' spawn notes. Written once, on the
// jiminy's first wake; its absence from a mind stream is what marks a
// jiminy as not-yet-born.
export function followTurnCore({ jiminy, principalThread, ts }) {
  const jiminyThread = `pi:session:${jiminySessionId(principalThread)}`;
  return {
    v: 1,
    ts,
    from: jiminy,
    kind: "note",
    links: [
      { rel: "follows", ref: principalThread },
      { rel: "spawned", ref: jiminyThread },
    ],
    body: {
      text: `born: ${jiminy} follows ${principalThread}`,
      follow: { agent: jiminyThread, follows: principalThread, harness: "pi" },
    },
    provenance: { source: "mind", fidelity: "projected", origin: {} },
  };
}

// The farewell note: the jiminy records its principal's death after the
// final wake. Death is a point, not a sentence — journal growth after
// the farewell (a resumed session) revives the jiminy; the follower
// compares farewell time against journal modification time. The ts is
// derived from the journal's last modification (deterministic), so
// racing passes build the identical note and dedupe by id.
export function farewellTurnCore({ jiminy, principalThread, ts, reason = "stale" }) {
  return {
    v: 1,
    ts,
    from: jiminy,
    kind: "note",
    links: [{ rel: "follows", ref: principalThread }],
    body: {
      text: `farewell: ${principalThread} stopped (${reason})`,
      farewell: { follows: principalThread, reason },
    },
    provenance: { source: "mind", fidelity: "projected", origin: {} },
  };
}

export function parseFarewell(turn) {
  const f = turn?.body?.farewell;
  if (!f || typeof f !== "object" || !f.follows) return null;
  return {
    jiminy: String(turn.from ?? ""),
    follows: String(f.follows),
    reason: f.reason ? String(f.reason) : null,
    ts: turn.ts,
    turnId: turn.id,
  };
}

export function parseFollow(turn) {
  const f = turn?.body?.follow;
  if (!f || typeof f !== "object" || !f.agent || !f.follows) return null;
  return {
    jiminy: String(turn.from ?? ""),
    agent: String(f.agent),
    follows: String(f.follows),
    harness: f.harness ? String(f.harness) : null,
    ts: turn.ts,
    turnId: turn.id,
  };
}
