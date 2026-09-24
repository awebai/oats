/** Private Desktop terminal wire v2. No numeric compatibility/owner inference. */
export const TERMINAL_API = 2;
export const TERM_WRITE_BYTES = 64 * 1024;
export const TERM_CALLER_BYTES = 1024 * 1024;
export const TERM_READY_BYTES = 64 * 1024;
export const TERM_READY_MS = 5000;
export const TERM_CLOSE_MS = 2000;
export const TERM_PREPARE_MS = 30000;
export const TERM_ATTACHMENTS_MAX = 4;
export function terminalHandle(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Number.isSafeInteger(v.id) && v.id > 0
    && typeof v.lease === 'string' && /^[a-f0-9]{64}$/.test(v.lease) ? Object.freeze({ id: v.id, lease: v.lease }) : null;
}
export const terminalGeometry = (cols, rows) => Number.isInteger(cols) && cols >= 1 && cols <= 1000 && Number.isInteger(rows) && rows >= 1 && rows <= 1000;
const messages = {
  E_TERM_FORBIDDEN_FRAME: 'This document cannot access terminals.',
  E_TERM_LEASE: 'This terminal handle is no longer owned by this document.',
  E_TERM_BAD_ARGS: 'Invalid terminal request.', E_TERM_CAP: 'Terminal limit reached. Close a terminal first.',
  E_TERM_CONTEXT_CHANGED: 'The terminal owner or preparation context changed.',
  E_TERM_OPEN_FAILED: 'Could not attach to the requested terminal.',
  E_TERM_NOT_READY: 'The terminal has not acknowledged readiness.',
  E_TERM_REUSED: 'This terminal is already open.',
  E_TERM_READY_TIMEOUT: 'terminal did not become ready; closed',
  E_TERM_OUTPUT_LIMIT: 'Terminal readiness output exceeded its safe limit; closed.',
  E_TERM_PREPARE_TIMEOUT: 'Terminal preparation timed out.',
  E_TERM_CLOSING: 'closing… not yet confirmed', E_TERM_CLOSE_PENDING: 'closing… not yet confirmed',
  E_TERM_BUSY: 'This terminal operation is already in progress.',
  E_TERM_ATTACHMENT_FAILED: 'Could not prepare these attachments.',
  E_TERM_ATTACHMENT_INTERRUPTED: 'Attachment interrupted; some file copies may already exist. No input was inserted.',
  E_TERM_INPUT_LIMIT: 'Terminal input exceeds the safe write limit. Nothing was sent.',
  E_TERM_TRANSPORT: 'The terminal service did not confirm the operation.',
};
export function terminalFailure(code) {
  if (typeof code !== 'string' || !Object.hasOwn(messages, code)) code = 'E_TERM_OPEN_FAILED';
  return { terminalApi: TERMINAL_API, ok: false, code, message: messages[code] };
}
export const terminalSuccess = (status, extra = {}) => ({ terminalApi: TERMINAL_API, ok: true, status, ...extra });
export const terminalSameHandle = (a, b) => !!a && !!b && a.id === b.id && a.lease === b.lease;
