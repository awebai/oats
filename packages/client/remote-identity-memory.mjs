/** What a client remembers of the machines its roster answers reported (#482; #855, 3a): the last
 * workspace identity each remote roster group reported, keyed by the group id (`<server>:<targetKey>`,
 * the kernel's own group key), and the sentence left for a machine that moved to another workspace.
 * A machine that stops answering keeps its place in its workspace through it ("not reached",
 * identityFrom "remembered": panel-views.mjs `deploymentInfo`). A fresh report always wins. Only
 * remote groups are remembered: memory never attaches a local deployment.
 *
 * No state. The memory and the notes are two Maps the client holds and passes in:
 *
 *   memory: Map<group id, { server, label, targetKey, path, workspace, reportedAt }>
 *   notes:  Map<group id, string>   the sentence for a machine that moved to another workspace
 *
 * `observeIdentities` answers new Maps and changes neither. Where a client keeps them between calls,
 * and whether on disk, is its own: the Desktop's file is packages/desktop/server/remote-identity.mjs.
 * Nothing here caps the memory: an answer drops every group it no longer lists, so the memory is
 * never larger than the roster answer. */
import { readIdentity, attachment, viewId } from './workspace-views.mjs';

const GROUP_ID = /^[a-z0-9][a-z0-9-]{0,63}:[A-Za-z0-9._-]{1,128}$/;
const SERVER = /^[a-z0-9][a-z0-9-]{0,63}$/;
const text = v => typeof v === 'string' && v.length > 0 && v.length <= 2048 && !v.includes('\0');

/** A remembered entry read from outside the client (a file): the entry as the memory keeps it, or null
 * when the id or any field of `raw` is not what `observeIdentities` would have stored. */
export function entryOf(id, raw) {
  if (!GROUP_ID.test(id) || !raw || typeof raw !== 'object') return null;
  const { server, label, targetKey, path, workspace, reportedAt } = raw;
  if (!SERVER.test(server ?? '') || !text(label) || !text(targetKey) || id !== `${server}:${targetKey}` || !text(path) || !path.startsWith('/')
    || !text(reportedAt) || Number.isNaN(Date.parse(reportedAt))) return null;
  const read = readIdentity(workspace);
  if (read.status !== 'identity') return null;
  return { server, label, targetKey, path, workspace: read.identity, reportedAt };
}

const sameIdentity = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** The view an identity attaches to, or null (an unattached identity has no workspace view). */
const viewOf = identity => { const a = attachment(identity); return a.unattached ? null : viewId(a.key, a.team); };
/** The name the move note gives the new workspace: the last segment of its key. */
const workspaceName = identity => identity?.key ? String(identity.key).split('/').filter(Boolean).pop() : null;

/**
 * One roster answer: remember each fresh report, note a move, and drop the memory (and the note) of
 * every group the answer no longer lists. Only a group that was reached (`probe.ok === true`), whose id
 * and server have the kernel's form, whose path is absolute and whose workspace reads as an identity
 * (a `key` field) is a report; a failed probe changes nothing, and its group is kept while listed. A
 * report equal to what is remembered (identity, label, path) changes nothing. A report that moves the
 * group to another view leaves its note.
 *
 * `groups` is what remote-roster.mjs `remoteRosterState` answers as `reported`; `at` is the caller's
 * time, kept as each new entry's `reportedAt`.
 * @param {{ memory: Map, notes: Map }} held
 * @param {Array<{id, server, label, target:{workspace}, probe, workspace}>} groups
 * @returns {{ memory: Map, notes: Map, changed: boolean }} new Maps; `changed` says the memory changed
 *   (a client that keeps it on disk writes then).
 */
export function observeIdentities({ memory, notes }, groups, at) {
  if (typeof at !== 'string' || !at) throw new TypeError('observeIdentities: at must be the time of the call, a non-empty string');
  const next = new Map(memory), nextNotes = new Map(notes);
  let changed = false;
  const listed = new Set(groups.map(g => g.id));
  for (const id of [...next.keys()]) if (!listed.has(id)) { next.delete(id); nextNotes.delete(id); changed = true; }
  for (const g of groups) {
    if (g?.probe?.ok !== true || !GROUP_ID.test(g.id ?? '') || !SERVER.test(g.server ?? '')) continue;
    const read = readIdentity(g.workspace);
    if (read.status !== 'identity') continue;
    const targetKey = g.id.slice(g.server.length + 1);
    const path = g.target?.workspace;
    if (!text(path) || !path.startsWith('/')) continue;
    const previous = next.get(g.id);
    if (previous && sameIdentity(previous.workspace, read.identity) && previous.label === (g.label || g.server) && previous.path === path) continue;
    if (previous && !sameIdentity(previous.workspace, read.identity) && viewOf(previous.workspace) !== viewOf(read.identity)) {
      const name = workspaceName(read.identity);
      nextNotes.set(g.id, name ? `${g.label || g.server} now reports workspace ${name}.` : `${g.label || g.server} now reports another workspace.`);
    }
    next.set(g.id, { server: g.server, label: text(g.label) ? g.label : g.server, targetKey, path, workspace: read.identity, reportedAt: at });
    changed = true;
  }
  return { memory: next, notes: nextNotes, changed };
}

/** The three readers panel-views.mjs takes as `held.remembered`, over one memory and its notes. They
 * read and change nothing: `get(id)` is the remembered entry of a group, or null; `note(id)` the move
 * sentence of a group, or null; `all()` every remembered entry, each with its `id`. */
export function identityMemory({ memory, notes }) {
  return {
    get: id => memory.get(id) ?? null,
    note: id => notes.get(id) ?? null,
    all: () => [...memory.entries()].map(([id, e]) => ({ id, ...e })),
  };
}
