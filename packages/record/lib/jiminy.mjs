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

// `<source>:session:<id>` -> the principal id; null for non-session
// threads (mail threads are read by the owner directly, not by a jiminy).
export function principalOf(thread) {
  const m = /^(cc|pi|codex):session:(.+)$/.exec(thread ?? "");
  return m ? m[2] : null;
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
// --session-id creates it if missing). RFC-4122-shaped so pi and its
// session tooling treat it as an ordinary uuid.
export function jiminySessionId(thread) {
  const p = principalOf(thread);
  if (!p) return null;
  const h = createHash("sha256").update(`jiminy:${p}`).digest("hex");
  return (
    `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}` +
    `-8${h.slice(17, 20)}-${h.slice(20, 32)}`
  );
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
