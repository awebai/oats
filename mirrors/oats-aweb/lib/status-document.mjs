// The signed agent status document of aweb-acah.3 (aweb
// docs/drafts/agent-health.md, "The status document"; conformance vector
// docs/vectors/agent-status-v1.json). oats.aweb builds the document and checks
// it before aw signs and sends it; the same rules verify a signed document, so
// the tests hold this module to every case of the vector. Checks run in the
// vector's order: size before parsing, canonical bytes before fields, type
// before any other field. Each refusal is {ok:false, error, message} with the
// vector's error code.
import {createPublicKey, verify} from 'node:crypto';

export const MAX_DOCUMENT_BYTES = 2048;
export const REASON_TEXT_MAX_BYTES = 160;
export const FIXING_TEXT_MAX_BYTES = 120;
export const REASON_CODE_MAX_BYTES = 64;
export const MAX_VALIDITY_MS = 900 * 1000;
export const CLOCK_SKEW_MS = 300 * 1000;
export const REACHABLE = ['yes', 'degraded', 'no', 'unknown'];
export const FIXING_BY = ['automatic', 'operator', 'nobody', 'unknown'];

const TOP_LEVEL = ['v', 'type', 'team_id', 'agent', 'publisher_did', 'seq', 'reachable', 'reason', 'fixing', 'observed_at', 'valid_until'];
const ALWAYS_REQUIRED = ['v', 'type', 'team_id', 'agent', 'publisher_did', 'seq', 'reachable', 'observed_at', 'valid_until'];
const REASON_KEYS = ['code', 'text'];
const FIXING_KEYS = ['by', 'text'];
const REASON_CODE = /^[a-z][a-z0-9]*\.[a-z0-9_]+$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
// One line: no C0 or C1 control character, no DEL, no line or paragraph separator.
export const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const refuse = (error, message) => ({ok: false, error, message});
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const utf8Length = (s) => Buffer.byteLength(s, 'utf8');
const byCodePoint = (a, b) => {
  const x = [...a], y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d) return d;
  }
  return x.length - y.length;
};

function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort(byCodePoint).map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** The canonical bytes: UTF-8 JSON, keys sorted by code point, separators ','
 *  and ':', no ASCII escaping. */
export function canonicalBytes(document) {
  return Buffer.from(canonicalJSON(document), 'utf8');
}

/** An Ed25519 did:key's public key, or null when it is not one. */
function didKeyPublicKey(did) {
  if (typeof did !== 'string' || !did.startsWith('did:key:z')) return null;
  const bytes = base58btcDecode(did.slice('did:key:z'.length));
  if (!bytes || bytes.length !== 34 || bytes[0] !== 0xed || bytes[1] !== 0x01) return null;
  return createPublicKey({key: {kty: 'OKP', crv: 'Ed25519', x: Buffer.from(bytes.subarray(2)).toString('base64url')}, format: 'jwk'});
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58btcDecode(text) {
  let n = 0n;
  for (const ch of text) {
    const digit = BASE58.indexOf(ch);
    if (digit < 0) return null;
    n = n * 58n + BigInt(digit);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  for (const ch of text) { if (ch !== '1') break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}

/** True when `signature` (raw standard base64, no padding) is the Ed25519
 *  signature of `bytes` by the did:key `signerDid`. */
export function verifySignature(bytes, signature, signerDid) {
  const key = didKeyPublicKey(signerDid);
  if (!key || typeof signature !== 'string') return false;
  try { return verify(null, bytes, key, Buffer.from(signature, 'base64')); } catch { return false; }
}

const parseTimestamp = (s) => (typeof s === 'string' && TIMESTAMP.test(s) && !Number.isNaN(Date.parse(s)) && new Date(Date.parse(s)).toISOString().replace('.000Z', 'Z') === s) ? Date.parse(s) : null;

function checkText(value, field, maxBytes, required) {
  if (value === undefined) return required ? refuse('missing_field', `${field} is required`) : null;
  if (typeof value !== 'string' || value === '') return refuse('invalid_value', `${field} must be a non-empty string`);
  if (CONTROL_CHARACTER.test(value)) return refuse('control_character', `${field} must be one line with no control characters`);
  if (utf8Length(value) > maxBytes) return refuse('text_too_long', `${field} is over ${maxBytes} bytes`);
  return null;
}

function checkPart(value, name, keys) {
  if (!isObject(value)) return refuse('invalid_value', `${name} must be an object`);
  const unknown = Object.keys(value).find((k) => !keys.includes(k));
  return unknown === undefined ? null : refuse('unknown_field', `${name}.${unknown} is not a v1 field`);
}

/** The field rules, on a parsed document whose type is already agent_status. */
function checkFields(doc) {
  const unknown = Object.keys(doc).find((k) => !TOP_LEVEL.includes(k));
  if (unknown !== undefined) return refuse('unknown_field', `${unknown} is not a v1 field`);
  if (doc.reason !== undefined) { const r = checkPart(doc.reason, 'reason', REASON_KEYS); if (r) return r; }
  if (doc.fixing !== undefined) { const r = checkPart(doc.fixing, 'fixing', FIXING_KEYS); if (r) return r; }
  const missing = ALWAYS_REQUIRED.find((k) => doc[k] === undefined);
  if (missing) return refuse('missing_field', `${missing} is required`);
  if (doc.reachable !== 'yes') {
    if (doc.reason === undefined) return refuse('missing_field', 'reason is required unless reachable is yes');
    if (doc.fixing === undefined) return refuse('missing_field', 'fixing is required unless reachable is yes');
  }
  if (doc.v !== 1) return refuse('invalid_value', 'v must be 1');
  if (typeof doc.team_id !== 'string' || doc.team_id === '') return refuse('invalid_value', 'team_id must be a non-empty string');
  if (typeof doc.agent !== 'string' || !/^did:(aw|key):\S+$/.test(doc.agent)) return refuse('invalid_value', 'agent must be a did:aw or a did:key');
  if (typeof doc.publisher_did !== 'string' || !/^did:key:\S+$/.test(doc.publisher_did)) return refuse('invalid_value', 'publisher_did must be a did:key');
  if (!Number.isSafeInteger(doc.seq) || doc.seq < 1) return refuse('invalid_value', 'seq must be an integer from 1 to 2^53-1');
  if (!REACHABLE.includes(doc.reachable)) return refuse('invalid_value', `reachable must be one of ${REACHABLE.join(', ')}`);
  if (doc.reason !== undefined) {
    if (doc.reason.code === undefined) return refuse('missing_field', 'reason.code is required');
    if (typeof doc.reason.code !== 'string' || utf8Length(doc.reason.code) > REASON_CODE_MAX_BYTES || !REASON_CODE.test(doc.reason.code)) return refuse('invalid_value', 'reason.code must be a namespaced code of at most 64 bytes');
    const r = checkText(doc.reason.text, 'reason.text', REASON_TEXT_MAX_BYTES, true); if (r) return r;
  }
  if (doc.fixing !== undefined) {
    if (doc.fixing.by === undefined) return refuse('missing_field', 'fixing.by is required');
    if (!FIXING_BY.includes(doc.fixing.by)) return refuse('invalid_value', `fixing.by must be one of ${FIXING_BY.join(', ')}`);
    const r = checkText(doc.fixing.text, 'fixing.text', FIXING_TEXT_MAX_BYTES, false); if (r) return r;
  }
  for (const k of ['observed_at', 'valid_until']) if (parseTimestamp(doc[k]) === null) return refuse('invalid_value', `${k} must be YYYY-MM-DDTHH:MM:SSZ`);
  return null;
}

/** The rules that depend on the evaluation time. */
function checkTimes(doc, now) {
  const observed = parseTimestamp(doc.observed_at), until = parseTimestamp(doc.valid_until);
  if (until <= observed || until - observed > MAX_VALIDITY_MS) return refuse('validity_window', 'valid_until must be after observed_at and at most 15 minutes later');
  if (now > until) return refuse('expired', 'valid_until has passed');
  if (Math.abs(now - observed) > CLOCK_SKEW_MS) return refuse('clock_skew', 'observed_at is outside the 5-minute clock skew');
  return null;
}

/** Size, canonical bytes, then type, on the bytes as presented. */
function parseCanonical(bytes) {
  if (bytes.length > MAX_DOCUMENT_BYTES) return refuse('document_too_large', `the document is over ${MAX_DOCUMENT_BYTES} bytes`);
  let doc;
  try { doc = JSON.parse(bytes.toString('utf8')); } catch { return refuse('non_canonical', 'the document is not JSON'); }
  if (!isObject(doc) || !canonicalBytes(doc).equals(bytes)) return refuse('non_canonical', 'the document bytes are not canonical JSON');
  if (doc.type !== 'agent_status') return refuse('wrong_type', 'type must be agent_status');
  return {ok: true, document: doc};
}

/** The publisher's check before handing a document to aw: everything a server
 *  checks except the signature and the stored seq. */
export function checkDocument(document, {now}) {
  const parsed = parseCanonical(canonicalBytes(document));
  if (!parsed.ok) return parsed;
  return checkFields(parsed.document) || checkTimes(parsed.document, now) || {ok: true};
}

/** Verifies a published status ({signed_payload, signature}) as the server
 *  does: signed by `signerDid`, which publisher_did names, and with a seq
 *  above `storedSeq` when one is stored. */
export function verifyStatus({signed_payload, signature}, {now, signerDid, storedSeq}) {
  const bytes = Buffer.from(String(signed_payload ?? ''), 'base64url');
  const parsed = parseCanonical(bytes);
  if (!parsed.ok) return parsed;
  if (!verifySignature(bytes, signature, signerDid)) return refuse('bad_signature', 'the signature does not verify for the authenticated signer');
  const doc = parsed.document;
  if (doc.publisher_did !== signerDid) return refuse('publisher_mismatch', 'publisher_did is not the authenticated signer');
  const refused = checkFields(doc) || checkTimes(doc, now);
  if (refused) return refused;
  if (storedSeq !== undefined && doc.seq <= storedSeq) return refuse('stale_seq', 'seq is not greater than the stored seq');
  return {ok: true, document: doc};
}
