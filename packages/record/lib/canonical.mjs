// Canonical JSON, turn ids, and signature verification for turn.jsonl v1.
// Contract: aweb-oss docs/turn-record-sot.md. The byte rules intentionally
// match awid message signing (sorted keys, minimal separators, no HTML
// escaping, ensure_ascii=false) so the same canonical form serves both.

import { createHash, createPublicKey, verify as edVerify } from "node:crypto";

export class CanonicalError extends Error {}

// Canonical JSON serialization. Numbers must be integers within the safe
// range: float serialization is not canonical across languages, so floats
// are forbidden anywhere in a turn's canonical core.
export function canonicalJson(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") {
    if (!Number.isInteger(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new CanonicalError(`non-integer number in canonical core: ${value}`);
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (t === "object") {
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
  }
  throw new CanonicalError(`unsupported value in canonical core: ${t}`);
}

// Canonical core = the turn without `id` and `sig`.
export function coreString(turn) {
  const core = {};
  for (const k of Object.keys(turn)) {
    if (k !== "id" && k !== "sig") core[k] = turn[k];
  }
  return canonicalJson(core);
}

export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

export function turnId(turn) {
  return "t1:" + sha256Hex(Buffer.from(coreString(turn), "utf8"));
}

// Return a copy of `core` (a turn without id/sig) with its computed id.
export function finishTurn(core) {
  return { ...core, id: turnId(core) };
}

export function verifyTurnId(turn) {
  return typeof turn.id === "string" && turnId(turn) === turn.id;
}

// --------------------------------------------------------------- did:key

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(s) {
  let n = 0n;
  for (const c of s) {
    const i = B58_ALPHABET.indexOf(c);
    if (i < 0) throw new CanonicalError(`invalid base58 character ${JSON.stringify(c)}`);
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) {
    bytes.push(Number(n & 0xffn));
    n >>= 8n;
  }
  bytes.reverse();
  for (const c of s) {
    if (c === "1") bytes.unshift(0);
    else break;
  }
  return Uint8Array.from(bytes);
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function publicKeyFromDidKey(did) {
  if (!did.startsWith("did:key:z")) throw new CanonicalError(`unsupported did ${did}`);
  const decoded = base58Decode(did.slice("did:key:z".length));
  if (decoded.length !== 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new CanonicalError(`not an ed25519 did:key: ${did}`);
  }
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(decoded.subarray(2))]),
    format: "der",
    type: "spki",
  });
}

// Base64 signatures arrive unpadded, in either the standard or URL-safe
// alphabet (awid accepts both; so do we).
export function base64DecodeLoose(s) {
  const normalized = s.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

// Verify an Ed25519 signature by a did:key over utf-8 payload text.
// Returns boolean; malformed inputs are a failed verification, not a throw.
export function verifyDidKeySignature(did, payloadText, signatureB64) {
  try {
    return edVerify(
      null,
      Buffer.from(payloadText, "utf8"),
      publicKeyFromDidKey(did),
      base64DecodeLoose(signatureB64),
    );
  } catch {
    return false;
  }
}

// Verify a turn's envelope signature (`sig` over the canonical core).
export function verifyTurnSig(turn) {
  if (!turn.sig) return false;
  return verifyDidKeySignature(turn.sig.by, coreString(turn), turn.sig.sig);
}

// Value equality via canonical bytes — `to` may legally be an array, so a
// reference compare would flag every multi-recipient turn read from disk.
function sameValue(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return canonicalJson(a) === canonicalJson(b);
}

// Consistency rule for turns that carry a source signed_payload: readable
// duplicated fields must equal the signed_payload fields (the payload is
// authoritative). Throws CanonicalError on violation.
export function checkSignedConsistency(turn) {
  const p = JSON.parse(turn.signed_payload);
  const pairs = [
    [turn.ts, p.timestamp, "ts/timestamp"],
    [turn.from, p.from, "from"],
    [turn.to, p.to, "to"],
    [turn.body?.subject, p.subject, "body.subject/subject"],
    [turn.body?.text, p.body, "body.text/body"],
  ];
  for (const [a, b, what] of pairs) {
    if (!sameValue(a, b)) throw new CanonicalError(`signed consistency violation on ${what}`);
  }
}
