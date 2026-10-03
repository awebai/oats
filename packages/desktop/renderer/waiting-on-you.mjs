/** "Needs input" (Spec D): the kernel's `waitingOnYou` claim on an `oats status --json` row, validated
 * once here and read through one liveness gate by every surface (row mark, card, description, collapsed
 * roll-up). Pure, no DOM, never throws. `null` (or absent) means unknown, never "not waiting".
 * Display-only: nothing in Desktop acts on a claim. */
import { record } from './readiness-contract.mjs';
import { eventsTimestamp, eventsId, eventsDetail } from './instance-events-contract.mjs';
import { instanceId, instanceVisibleInTree, resolveLinkId } from './instance-tree.mjs';

/** A claim's note: one line ≤ 200 chars, no control characters; unsafe text is withheld (the activity
 * view's house rule). Absent, empty or malformed → null: the claim itself is kept. */
export function waitingMessage(v) {
  if (typeof v !== 'string' || !v || v.length > 200 || /[\x00-\x1f\x7f]/.test(v)) return null;
  return eventsDetail(v, 200);
}

/** `{ since, producer, reason, message }` or null. Only `since` and `producer` can drop a claim: a
 * missing or malformed reason (never rendered) is null, a malformed message is null. Extra keys are
 * ignored (forward compatible). */
export function waitingOnYouData(v) {
  if (!record(v) || !eventsTimestamp(v.since) || !eventsId(v.producer)) return null;
  const reason = typeof v.reason === 'string' && v.reason.length <= 64 ? v.reason : null;
  return { since: v.since, producer: v.producer, reason, message: waitingMessage(v.message) };
}

/** The claim a row may show, or null. The only gate: the Desktop's own liveness says running (a tmux
 * `shell`, a stopped pane, an unreachable or unsupported session never shows it), and the row is
 * current: a remote row whose server was not reached, or a row the roster holds stale (`stale`: its
 * last re-read failed), carries a last-known claim, which is unknown. */
export function waitingClaim(row, { stale = false } = {}) {
  if (stale || !record(row) || row.running !== true || row.serverUnreached === true) return null;
  if (row.runtimeState !== undefined && row.runtimeState !== 'running') return null;
  return waitingOnYouData(row.waitingOnYou);
}

const LABELS = Object.freeze({ permission: 'Waiting for a tool approval', question: 'Asked you a question', attention: 'Asked for your attention' });
/** The reason in words. The raw reason is never rendered: an unknown one reads "Needs input". */
export const waitingLabel = claim => Object.hasOwn(LABELS, claim?.reason ?? '') ? LABELS[claim.reason] : 'Needs input';

/** How long it has waited (floor): "under a minute", "N min", "N h", "N d". A future `since` (clock skew)
 * reads "under a minute". Computed when shown, never painted into the row. */
export function waitedText(since, now = Date.now()) {
  const ms = now - Date.parse(since);
  if (!Number.isFinite(ms) || ms < 60000) return 'under a minute';
  const min = Math.floor(ms / 60000); if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60); if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** The claim's start as local HH:MM. */
export function waitingClock(since) {
  const at = new Date(since);
  return Number.isFinite(at.getTime()) ? `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` : '';
}

/** "dev-a, dev-b" — up to 3 names, then "and N more". */
export function waitingNames(rows) {
  const names = rows.map(r => r.instance);
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
}

/** The card's "Below" fact: "2 need input: dev-a, dev-b". */
export const waitingBelowText = rows => `${rows.length} ${rows.length === 1 ? 'needs' : 'need'} input: ${waitingNames(rows)}`;

/** What an unavailable row (no card) appends to its title/aria-description sentence. Absolute time only:
 * the sentence is painted once. */
export function waitingSentence(claim, below = []) {
  const parts = [];
  if (claim) parts.push(`Needs input: ${claim.message ?? waitingLabel(claim)} since ${waitingClock(claim.since)}`);
  if (below.length) parts.push(`${below.length} below need input: ${waitingNames(below)}`);
  return parts.map(p => ` · ${p}`).join('');
}

/** Waiting instances hidden by a collapse, attributed to their nearest visible ancestor:
 * Map(instanceId(ancestor) → [waiting rows]). Computed over the full roster (as clustering is) by the
 * parent relation only (resolveLinkId: never across a remote server), cycle-safe; a missing or cyclic
 * parent chain degrades to no roll-up. Filtering on → nothing is collapsed → empty. `stale(row)`: the
 * caller's held-stale test; a stale row contributes nothing. */
export function waitingRollup(instances, collapsed, workspace, { filtering = false, stale = () => false } = {}) {
  const out = new Map();
  if (filtering || !collapsed?.size) return out;
  const byId = new Map(instances.map(i => [instanceId(i), i]));
  const byName = new Map();
  for (const i of instances) { if (!byName.has(i.instance)) byName.set(i.instance, []); byName.get(i.instance).push(i); }
  for (const i of instances) {
    if (!waitingClaim(i, { stale: stale(i) }) || instanceVisibleInTree(i, instances, collapsed, workspace)) continue;
    const seen = new Set([instanceId(i)]);
    let cursor = i, owner = null;
    while (cursor?.parentInstance) {
      const pid = resolveLinkId(cursor, cursor.parentInstance, byName);
      if (!pid || seen.has(pid)) break;
      seen.add(pid); cursor = byId.get(pid);
      if (cursor && instanceVisibleInTree(cursor, instances, collapsed, workspace)) { owner = pid; break; }
    }
    if (owner === null) continue;
    if (!out.has(owner)) out.set(owner, []);
    out.get(owner).push(i);
  }
  return out;
}
