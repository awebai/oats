/** Remembered remote identities (#482): `remote-identity.json` in the app's user data, the last
 * workspace identity each remote roster group reported, keyed by the group id (`<server>:<targetKey>`,
 * the kernel's own group key). An unreachable remote keeps its workspace view through it ("not
 * reached", identityFrom "remembered"). A fresh report always wins and is written at once; a remote
 * that now reports another identity moves to that view, and the move is noted for the session.
 * Memory never attaches a local deployment: only remote groups are stored.
 *
 * The file is written atomically (a temporary file in the same directory, then rename) with mode
 * 0600. A missing, unreadable or malformed file is an empty memory; a malformed entry is skipped. */
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { readIdentity, attachment, viewId } from './workspace-views.mjs';

export const REMOTE_IDENTITY_VERSION = 1;
const MAX_ENTRIES = 256;
const GROUP_ID = /^[a-z0-9][a-z0-9-]{0,63}:[A-Za-z0-9._-]{1,128}$/;
const SERVER = /^[a-z0-9][a-z0-9-]{0,63}$/;
const text = v => typeof v === 'string' && v.length > 0 && v.length <= 2048 && !v.includes('\0');

function entryOf(id, raw) {
  if (!GROUP_ID.test(id) || !raw || typeof raw !== 'object') return null;
  const { server, label, targetKey, path, workspace, reportedAt } = raw;
  if (!SERVER.test(server ?? '') || !text(label) || !text(targetKey) || id !== `${server}:${targetKey}` || !text(path) || !path.startsWith('/')
    || !text(reportedAt) || Number.isNaN(Date.parse(reportedAt))) return null;
  const read = readIdentity(workspace);
  if (read.status !== 'identity') return null;
  return { server, label, targetKey, path, workspace: read.identity, reportedAt };
}

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

const sameIdentity = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** The view an identity attaches to, or null (an unattached identity has no workspace view). */
const viewOf = identity => { const a = attachment(identity); return a.unattached ? null : viewId(a.key, a.team); };
/** The name the move note gives the new workspace: the last segment of its key. */
const workspaceName = identity => identity?.key ? String(identity.key).split('/').filter(Boolean).pop() : null;

/**
 * @param {{ file: string|null, read?: (f:string)=>string, write?: (f:string, s:string)=>void,
 *   now?: () => string }} io  `file` null keeps memory in this process only (a standalone server).
 */
export function createRemoteIdentityStore({ file, read = f => readFileSync(f, 'utf8'), write = atomicWrite, now = () => new Date().toISOString() }) {
  let entries = new Map();
  if (file) { try { entries = parseRemoteIdentities(read(file)); } catch { entries = new Map(); } }
  const notes = new Map(); // group id → the move sentence, for this session
  const persist = () => {
    if (!file) return;
    const groups = Object.fromEntries([...entries].slice(0, MAX_ENTRIES));
    try { write(file, `${JSON.stringify({ version: REMOTE_IDENTITY_VERSION, groups }, null, 2)}\n`); } catch { /* memory stays; the next report retries */ }
  };
  return {
    /** The remembered entry of a group, or null. */
    get: id => entries.get(id) ?? null,
    /** Every remembered entry (for a session with no roster answer at all). */
    all: () => [...entries.entries()].map(([id, e]) => ({ id, ...e })),
    /** The session note for a group that moved to another workspace, or null. */
    note: id => notes.get(id) ?? null,
    /**
     * One roster answer: remember each fresh report, note a move, and drop the memory of groups
     * the answer no longer lists. Only a reached group (probe ok) with an identity (a `key` field)
     * is a report; a failed probe changes nothing. Returns true when the file changed.
     * @param {Array<{id, server, label, target:{workspace}, probe, workspace}>} groups
     */
    observe(groups) {
      let changed = false;
      const listed = new Set(groups.map(g => g.id));
      for (const id of [...entries.keys()]) if (!listed.has(id)) { entries.delete(id); notes.delete(id); changed = true; }
      for (const g of groups) {
        if (g?.probe?.ok !== true || !GROUP_ID.test(g.id ?? '') || !SERVER.test(g.server ?? '')) continue;
        const read = readIdentity(g.workspace);
        if (read.status !== 'identity') continue;
        const targetKey = g.id.slice(g.server.length + 1);
        const path = g.target?.workspace;
        if (!text(path) || !path.startsWith('/')) continue;
        const previous = entries.get(g.id);
        if (previous && sameIdentity(previous.workspace, read.identity) && previous.label === (g.label || g.server) && previous.path === path) continue;
        if (previous && !sameIdentity(previous.workspace, read.identity) && viewOf(previous.workspace) !== viewOf(read.identity)) {
          const name = workspaceName(read.identity);
          notes.set(g.id, name ? `${g.label || g.server} now reports workspace ${name}.` : `${g.label || g.server} now reports another workspace.`);
        }
        entries.set(g.id, { server: g.server, label: text(g.label) ? g.label : g.server, targetKey, path, workspace: read.identity, reportedAt: now() });
        changed = true;
      }
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
