// Projections of aweb messages into turns, per docs/turn-record-sot.md
// "Projection of aweb messages", plus the client-side aw log projections
// (~/.config/aw/logs/<account>.jsonl and .aw/interaction-log.jsonl).
//
// Every projection here is a pure function of its source data: the same
// source projected on any machine yields byte-identical canonical cores,
// hence identical ids, and union dedupes them.

import { CanonicalError, checkSignedConsistency, finishTurn } from "./canonical.mjs";

// ------------------------------------------------- server rows (signed)

// Project a signed message row (mail or chat). The row carries the
// canonical signed_payload string and signature byte-verbatim.
export function projectSignedRow(row, kind) {
  if (kind !== "mail" && kind !== "chat") throw new CanonicalError(`bad kind ${kind}`);
  const p = JSON.parse(row.signed_payload);
  const core = {
    v: 1,
    ts: p.timestamp,
    from: p.from,
    to: p.to,
    thread: "aweb:conv:" + row.conversation_id,
    kind,
    body: { subject: p.subject, text: p.body },
    signature: row.signature,
    signed_payload: row.signed_payload,
    provenance: {
      source: kind === "mail" ? "aweb-mail" : "aweb-chat",
      fidelity: "projected",
      origin: { message_id: row.message_id, conversation_id: row.conversation_id },
    },
  };
  return finishTurn(core);
}

// Project a legacy unsigned mail row.
export function projectLegacyRow(row) {
  const origin = {
    message_id: row.message_id,
    conversation_id: row.conversation_id,
  };
  for (const k of ["from_did", "from_stable_id", "to_did", "to_stable_id", "priority"]) {
    if (row[k] !== undefined) origin[k] = row[k];
  }
  origin.timestamp_source = "created_at";
  const core = {
    v: 1,
    ts: row.created_at,
    from: row.from,
    to: row.to,
    thread: "aweb:conv:" + row.conversation_id,
    kind: "mail",
    body: { subject: row.subject, text: row.body },
    provenance: { source: "aweb-mail", fidelity: "projected", origin },
  };
  return finishTurn(core);
}

// Reconstruct the source row fields from a projected aweb turn.
// For signed turns, signed_payload is authoritative and its consistency
// with the turn is checked first.
export function unprojectRow(turn) {
  const out = {};
  if (turn.signed_payload !== undefined) {
    checkSignedConsistency(turn);
    const p = JSON.parse(turn.signed_payload);
    Object.assign(out, p);
    out.message_id = turn.provenance.origin.message_id;
    out.conversation_id = turn.provenance.origin.conversation_id;
    out.signature = turn.signature;
    out.signed_payload = turn.signed_payload;
    if (p.message_id !== undefined && p.message_id !== out.message_id) {
      throw new CanonicalError("signed_payload message_id disagrees with origin");
    }
    if (p.conversation_id !== undefined && p.conversation_id !== out.conversation_id) {
      throw new CanonicalError("signed_payload conversation_id disagrees with origin");
    }
    return out;
  }
  const origin = turn.provenance.origin;
  out.message_id = origin.message_id;
  out.conversation_id = origin.conversation_id;
  for (const k of ["from_did", "from_stable_id", "to_did", "to_stable_id", "priority"]) {
    if (origin[k] !== undefined) out[k] = origin[k];
  }
  out.from = turn.from;
  out.to = turn.to;
  out.subject = turn.body.subject;
  out.body = turn.body.text;
  if (origin.timestamp_source === "created_at") out.created_at = turn.ts;
  return out;
}

// The canonical core forbids non-integer numbers (float serialization is
// not canonical across languages), but real log entries may carry them.
// Per the SOT, anything non-integral is carried as a string: floats are
// converted in place and their locations recorded so unprojection restores
// them exactly. Paths are '/'-joined key/index chains relative to origin,
// with JSON-Pointer escaping ("~" -> "~0", "/" -> "~1") so keys containing
// either character cannot corrupt the path.
function escapeKey(key) {
  return String(key).replaceAll("~", "~0").replaceAll("/", "~1");
}

function unescapeKey(key) {
  return key.replaceAll("~1", "/").replaceAll("~0", "~");
}

function stringifyFloats(value, path, paths) {
  if (typeof value === "number" && !Number.isInteger(value)) {
    paths.push(path);
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => stringifyFloats(v, `${path}/${i}`, paths));
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const seg = escapeKey(k);
      out[k] = stringifyFloats(v, path ? `${path}/${seg}` : seg, paths);
    }
    return out;
  }
  return value;
}

// Sanitize source fields for the canonical core and attach the projection
// markers under the reserved "~" key.
function sanitizeOrigin(origin, markers) {
  const paths = [];
  const out = stringifyFloats(origin, "", paths);
  if (paths.length > 0) markers.float_paths = paths;
  out["~"] = markers;
  return out;
}

function restoreFloats(target, paths) {
  for (const path of paths ?? []) {
    const keys = path.split("/").map(unescapeKey);
    let node = target;
    for (let i = 0; i < keys.length - 1 && node !== undefined && node !== null; i++) {
      node = node[Array.isArray(node) ? Number(keys[i]) : keys[i]];
    }
    if (node === undefined || node === null) continue;
    const last = Array.isArray(node) ? Number(keys[keys.length - 1]) : keys[keys.length - 1];
    if (typeof node[last] === "string") node[last] = Number(node[last]);
  }
}

// ------------------------------------------------- aw client comm log

// Fields lifted from a comm-log entry onto the turn itself; everything else
// (known or future) is preserved verbatim in provenance.origin, which makes
// the projection lossless by construction against schema drift.
const COMMLOG_LIFTED = new Set(["ts", "from", "to", "subject", "body", "ch", "conversation_id", "session_id"]);

// Projection bookkeeping lives under the single reserved origin key "~"
// (a key no real log schema plausibly uses), so a source field named
// "log", "account", or "float_paths" can never collide with a marker.
// A source field literally named "~" would still collide; accepted.

// Project one entry of ~/.config/aw/logs/<account>.jsonl. `selfName` names
// the account whose log this is; it becomes `from` on entries that omit it
// (the client logs its own sends without a from).
export function projectCommLogEntry(entry, { selfName }) {
  const kind = entry.ch === "chat" ? "chat" : "mail";
  const conversation = entry.conversation_id ?? entry.session_id;
  const markers = { log: "commlog", account: selfName };
  const origin = {};
  for (const [k, v] of Object.entries(entry)) {
    if (!COMMLOG_LIFTED.has(k)) origin[k] = v;
  }
  if (entry.session_id !== undefined) markers.thread_key = "session_id";
  if (entry.from === undefined) markers.from_omitted = true;
  if (entry.body === undefined) markers.body_omitted = true;
  const safeOrigin = sanitizeOrigin(origin, markers);
  const core = {
    v: 1,
    ts: entry.ts,
    from: entry.from ?? (entry.dir === "recv" ? "unknown" : selfName),
    ...(entry.to !== undefined ? { to: entry.to } : {}),
    kind,
    body: {
      ...(entry.subject !== undefined ? { subject: entry.subject } : {}),
      text: entry.body ?? "",
    },
    provenance: { source: "aw-log", fidelity: "projected", origin: safeOrigin },
  };
  if (conversation !== undefined) core.thread = "aweb:conv:" + conversation;
  return finishTurn(core);
}

export function unprojectCommLogEntry(turn) {
  const origin = turn.provenance.origin;
  const markers = origin["~"] ?? {};
  const entry = {};
  for (const [k, v] of Object.entries(origin)) {
    if (k === "~") continue;
    entry[k] = structuredClone(v);
  }
  restoreFloats(entry, markers.float_paths);
  entry.ts = turn.ts;
  entry.ch = turn.kind;
  if (!markers.from_omitted) entry.from = turn.from;
  if (turn.to !== undefined) entry.to = turn.to;
  if (turn.body.subject !== undefined) entry.subject = turn.body.subject;
  if (!markers.body_omitted) entry.body = turn.body.text;
  if (turn.thread !== undefined) {
    const conversation = turn.thread.slice("aweb:conv:".length);
    if (markers.thread_key === "session_id") entry.session_id = conversation;
    else entry.conversation_id = conversation;
  }
  return entry;
}

// ------------------------------------------------- .aw/interaction-log

// Entries look like {ts, kind: "mail_out"|"mail_in"|"chat_out"|..., message_id?,
// from?, to?, subject?, text}. Same lossless strategy: lift what maps onto
// the turn, preserve the rest in origin.
const INTERACTION_LIFTED = new Set(["ts", "kind", "from", "to", "subject", "text"]);

export function projectInteractionLogEntry(entry, { selfName, workspace }) {
  const m = /^(mail|chat)_(out|in)$/.exec(entry.kind ?? "");
  const kind = m ? m[1] : "note";
  const dir = m ? (m[2] === "out" ? "send" : "recv") : undefined;
  const markers = { log: "interaction", account: selfName, entry_kind: entry.kind };
  if (workspace !== undefined) markers.workspace = workspace;
  if (dir !== undefined) markers.dir = dir;
  const origin = {};
  for (const [k, v] of Object.entries(entry)) {
    if (!INTERACTION_LIFTED.has(k)) origin[k] = v;
  }
  if (entry.from === undefined) markers.from_omitted = true;
  const safeOrigin = sanitizeOrigin(origin, markers);
  const core = {
    v: 1,
    ts: entry.ts,
    from: entry.from ?? (dir === "recv" ? "unknown" : selfName),
    ...(entry.to !== undefined ? { to: entry.to } : {}),
    kind,
    body: {
      ...(entry.subject !== undefined ? { subject: entry.subject } : {}),
      text: entry.text ?? "",
    },
    provenance: { source: "aw-log", fidelity: "projected", origin: safeOrigin },
  };
  return finishTurn(core);
}
