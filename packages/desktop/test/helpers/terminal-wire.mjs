// Synthetic physical IDs are test bookkeeping, never the shipped wire grammar.
export const handle = id => Object.freeze({ id, lease: id.toString(16).padStart(64, '0') });
export const opened = id => ({ terminalApi: 2, ok: true, status: 'opened', handle: handle(id) });
export const confirmed = h => ({ terminalApi: 2, ok: true, status: 'closed', handle: h });
export const ready = h => ({ terminalApi: 2, ok: true, status: 'ready', handle: h });
