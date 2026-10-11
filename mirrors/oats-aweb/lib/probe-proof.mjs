// CLI verification establishes signature/continuity; these checks bind its
// signed plaintext projection to the nonce and exact message we accept.
import {parseProbeJson, refuse} from './probe-runtime.mjs';
export const probeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
export const serverTime = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT[0-9:.]+(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export function fullNonce(body, nonce) {
  return typeof body === 'string' && /^[a-f0-9]{32,128}$/.test(nonce) && new RegExp(`(?:^|[^A-Za-z0-9_-])${nonce}(?![A-Za-z0-9_-])`).test(body);
}
export function proofMessage(message, {from, to, conversation, nonce, messageId, distinctFrom}) {
  if (!object(message)) return false;
  const encrypted = message.content_mode === 'encrypted_v2' || message.message_version === 2 || message.encrypted_envelope != null;
  if (!encrypted && message.content_mode !== undefined && !['', 'legacy_plaintext_v1'].includes(message.content_mode)) return false;
  if (!encrypted && message.message_version !== undefined && ![0, 1].includes(message.message_version)) return false;
  if (!probeId(message.message_id) || message.message_id === distinctFrom || (messageId !== undefined && message.message_id !== messageId) || message.conversation_id !== conversation || message.from_did !== from || message.to_did !== to || message.verification_status !== 'verified' || !fullNonce(message.body, nonce)) return false;
  if (message.type !== undefined && message.type !== 'mail') return false;
  if (encrypted) {
    // Qualified aw succeeds only after signature verification, decrypt and inner/outer
    // envelope checks; body is overwritten with decrypted plaintext. The displayed
    // message/thread IDs are NOT overwritten, so bind them to the verified envelope.
    const e = message.encrypted_envelope;
    return message.content_mode === 'encrypted_v2' && message.message_version === 2 && object(e) &&
      e.message_version === 2 && e.envelope_type === 'aweb.e2ee.message' && e.kind === 'mail' &&
      e.message_id === message.message_id && e.conversation_id === conversation &&
      e.from?.did === from && !e.from?.stable_id && Array.isArray(e.recipients) && e.recipients.length === 1 &&
      e.recipients[0]?.did === to && !e.recipients[0]?.stable_id;
  }
  if (typeof message.signed_payload !== 'string' || !message.signed_payload) return false;
  let signed;
  try { signed = parseProbeJson(message.signed_payload); } catch { return false; }
  if (!object(signed) || signed.type !== 'mail') return false;
  for (const field of ['body', 'message_id', 'conversation_id', 'from_did', 'to_did']) {
    if (typeof signed[field] !== 'string' || signed[field] !== message[field]) return false;
  }
  return true;
}
export function exactProbeMessage(envelope, id) {
  if (!Array.isArray(envelope?.messages) || envelope.messages.length !== 1 || envelope.messages[0]?.message_id !== id) refuse('exact-message-mismatch');
  return envelope.messages[0];
}
export function conversationMessages(envelope) {
  if (!Array.isArray(envelope?.messages) || envelope.messages.length > 500) refuse('invalid-conversation');
  return {messages: envelope.messages, incomplete: envelope.messages.length === 500 || envelope.has_more === true || !!envelope.next_cursor};
}
export function sameProof(a, b) {
  return ['message_id', 'conversation_id', 'from_did', 'to_did', 'body', 'signed_payload', 'verification_status', 'created_at', 'content_mode', 'message_version'].every(key => a[key] === b[key]) && JSON.stringify(a.encrypted_envelope) === JSON.stringify(b.encrypted_envelope);
}
