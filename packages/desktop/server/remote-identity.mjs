/** Remembered remote identities (#482): `remote-identity.json` in the app's user data, the last
 * workspace identity each remote roster group reported, keyed by the group id (`<server>:<targetKey>`,
 * the kernel's own group key). An unreachable remote keeps its workspace view through it ("not
 * reached", identityFrom "remembered"). A fresh report always wins and is written at once; a remote
 * that now reports another identity moves to that view, and the move is noted for the session.
 * Memory never attaches a local deployment: only remote groups are stored.
 *
 * What is remembered, and what one roster answer makes of it, is the shared home's
 * (packages/client/remote-identity-memory.mjs): this module keeps the memory between answers and on
 * disk. The file holds at most MAX_ENTRIES groups; the memory itself is as large as the roster answer.
 *
 * The file is written atomically (a temporary file in the same directory, then rename) with mode
 * 0600. A missing, unreadable or malformed file is an empty memory; a malformed entry is skipped. */
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { entryOf, observeIdentities, identityMemory } from '../../client/remote-identity-memory.mjs';

export const REMOTE_IDENTITY_VERSION = 1;
const MAX_ENTRIES = 256;

/** Parse the file's text into a Map of valid entries (anything else is dropped). */
export function parseRemoteIdentities(source) {
  const out = new Map();
  let doc;
  try { doc = JSON.parse(source); } catch { return out; }
  if (!doc || doc.version !== REMOTE_IDENTITY_VERSION || !doc.groups || typeof doc.groups !== 'object' || Array.isArray(doc.groups)) return out;
  for (const [id, raw] of Object.entries(doc.groups).slice(0, MAX_ENTRIES)) {
    const entry = entryOf(id, raw);
    if (entry) out.set(id, entry);
  }
  return out;
}

/**
 * @param {{ file: string|null, read?: (f:string)=>string, write?: (f:string, s:string)=>void,
 *   now?: () => string }} io  `file` null keeps memory in this process only (a standalone server).
 */
export function createRemoteIdentityStore({ file, read = f => readFileSync(f, 'utf8'), write = atomicWrite, now = () => new Date().toISOString() }) {
  // What this process holds between roster answers: the memory, and each moved group's sentence for this session.
  let held = { memory: new Map(), notes: new Map() };
  if (file) { try { held.memory = parseRemoteIdentities(read(file)); } catch { held.memory = new Map(); } }
  const persist = () => {
    if (!file) return;
    const groups = Object.fromEntries([...held.memory].slice(0, MAX_ENTRIES));
    try { write(file, `${JSON.stringify({ version: REMOTE_IDENTITY_VERSION, groups }, null, 2)}\n`); } catch { /* memory stays; the next report retries */ }
  };
  return {
    /** The remembered entry of a group, or null. */
    get: id => identityMemory(held).get(id),
    /** Every remembered entry (for a session with no roster answer at all). */
    all: () => identityMemory(held).all(),
    /** The session note for a group that moved to another workspace, or null. */
    note: id => identityMemory(held).note(id),
    /**
     * One roster answer (remote-identity-memory.mjs `observeIdentities`), stamped with this store's
     * time; the file is written when the memory changed. Returns true when it did.
     * @param {Array<{id, server, label, target:{workspace}, probe, workspace}>} groups
     */
    observe(groups) {
      const { memory, notes, changed } = observeIdentities(held, groups, now());
      held = { memory, notes };
      if (changed) persist();
      return changed;
    },
  };
}

/** Write a file atomically: a temporary file beside it, then rename over it. */
export function atomicWrite(file, contents) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, contents, { mode: 0o600 });
    renameSync(tmp, file);
  } catch (error) {
    try { unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw error;
  }
}
