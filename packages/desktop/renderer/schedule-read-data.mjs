/** History API3 projection. No filesystem/log reader, run-ID reconstruction,
 * outcome inference, or mutation authority. Draft bytes are a separate channel. */
import { harnessOf, HARNESSES } from './harness-names.mjs';
import { absolute, record } from './readiness-contract.mjs';
import { eventsTimestamp } from './instance-events-contract.mjs';
import { scheduleReadId, scheduleReadRequest, scheduleReadFailure, scheduleSource, CAPTURED_SCHEDULE_EDIT_UNAVAILABLE } from './schedule-read-contract.mjs';
const count = v => Number.isSafeInteger(v) && v >= 0;
const unsafe = /[\x00-\x08\x0b-\x1f\x7f]|[a-z][a-z0-9+.-]*:\/\/\S+|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}|(?:token|authorization|password|secret|api[_ -]?key)\s*[:=]\s*\S+/i;
const opaque = v => typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\x00-\x1f\x7f]/.test(v) && !unsafe.test(v);
const text = (v, max = 512) => typeof v !== 'string' ? null : unsafe.test(v) ? '[Detail withheld]' : v.length > max ? v.slice(0, max) + '…' : v;
const time = v => eventsTimestamp(v) ? v : null;
const policyKeys = ['definitionVersion', 'recurrencePolicy', 'execution', 'preparation', 'executionBinding', 'responsibleHuman'];
const editReasons = {
  captured: CAPTURED_SCHEDULE_EDIT_UNAVAILABLE,
  'unsupported-kind': 'This schedule kind cannot be edited here; edit via CLI.',
  unpreservable: 'This definition cannot be preserved by this editor; edit via CLI.',
};
export const scheduleEditReason = code => Object.hasOwn(editReasons, code) ? editReasons[code] : null;
function session(v) {
  if (!record(v) || !['launched', 'delivered-active', 'none'].includes(v.delivery)
    || !['instance', 'home', 'server', 'incarnation'].every(k => v[k] === null || typeof v[k] === 'string')) throw Error('invalid session');
  return { instance: text(v.instance, 256), home: text(v.home, 4096), incarnation: time(v.incarnation), server: text(v.server, 256), delivery: v.delivery };
}
const corruptRun = () => ({ runId: null, legacy: true, corrupt: true });
/** Bad individual history elements remain visible as corrupt, never as empty history. */
function run(v, { last = false, publicView = false } = {}) {
  try {
    if (!record(v) || v.corrupt === true) return corruptRun();
    if (!(v.runId === null || opaque(v.runId))) return corruptRun();
    if (!last && (typeof v.legacy !== 'boolean' || (v.legacy ? v.runId !== null || v.settled !== null || v.transitions !== null
      : v.runId === null || typeof v.settled !== 'boolean' || !time(v.recordedAt) || !Array.isArray(v.transitions)
        || !v.transitions.length || v.transitions.length > 256 || v.transitions.some(t => !opaque(t))))) return corruptRun();
    if (!opaque(v.outcome) || !last && !v.legacy && (v.transitions.at(-1) !== v.outcome || v.pending === true && v.settled !== false)) return corruptRun();
    const dates = Object.fromEntries(['scheduledFor', 'startedAt', 'endedAt', 'recordedAt'].map(k => [k, time(v[k])]));
    const invalidTimes = ['scheduledFor', 'startedAt', 'endedAt', 'recordedAt'].some(k => v[k] != null && dates[k] === null)
      || publicView && v.invalidTimes === true;
    return { runId: v.runId, ...(last ? {} : { legacy: v.legacy, settled: v.settled,
      transitions: v.transitions === null ? null : [...v.transitions] }), ...dates,
      kind: text(v.kind, 64), outcome: v.outcome, pending: v.pending === true, session: session(v.session),
      invalidTimes, hasError: publicView ? v.hasError === true : v.error != null, corrupt: false };
  } catch { return corruptRun(); }
}
function history(v, rows) {
  if (!record(v) || !Array.isArray(rows) || rows.length > 50) throw Error('invalid history');
  if (v.status === 'corrupt' && v.stored === null && v.truncated === false && !rows.length) return { status: 'corrupt', stored: null, truncated: false };
  if (v.status !== 'ok' || !count(v.stored) || rows.length !== Math.min(v.stored, 50) || v.truncated !== (v.stored > 50)) throw Error('invalid history bounds');
  return { status: 'ok', stored: v.stored, truncated: v.truncated };
}
function integrity(v) {
  if (!record(v) || !Array.isArray(v.sources) || v.sources.length !== 2) return null;
  const sources = v.sources.map(scheduleSource);
  return sources.every(Boolean) && sources[0].path !== sources[1].path ? { sources } : null;
}
const draftString = v => typeof v === 'string' && v.length <= 1048576 && !v.includes('\0');
/** Exact legacy editor inputs only: no previews/redactions/trim, no captured fields.
 * If the adapter cannot preserve a definition, it is not an editable draft. */
export function scheduleDraft(v) {
  if (!record(v) || policyKeys.some(k => Object.hasOwn(v, k)) || !scheduleReadId(v.id)
    || !['spawn', 'wake', 'operation'].includes(v.kind) || !draftString(v.cron) || !v.cron.trim()
    || !draftString(v.tz) || !v.tz.trim() || typeof v.enabled !== 'boolean') return null;
  const common = ['id', 'kind', 'cron', 'tz', 'enabled', 'createdAt', 'updatedAt', 'scope', 'scheduleApi', 'scheduleHistoryApi',
    'executionStatus', 'nextRun', 'lastRun', 'history', 'recentRuns', 'running', 'attempt', 'pendingWake'];
  // A stored job's harness is `harness` (0.27) or a released kernel's `runtime`; the draft speaks harness.
  const fields = v.kind === 'spawn' ? ['agent', 'agentsRoot', 'repo', 'task', 'harness', 'runtime', 'model', 'backend', 'purpose', 'yolo', 'wake']
    : v.kind === 'wake' ? ['home', 'message'] : ['home', 'operation'];
  if (Object.keys(v).some(k => !common.includes(k) && !fields.includes(k))) return null;
  const out = { id: v.id, kind: v.kind, cron: v.cron, tz: v.tz, enabled: v.enabled };
  const required = v.kind === 'spawn' ? ['agent', 'agentsRoot', 'task'] : v.kind === 'wake' ? ['home', 'message'] : ['home', 'operation'];
  if (required.some(k => !draftString(v[k]) || !v[k].trim())) return null;
  for (const k of required) out[k] = v[k];
  if (v.kind === 'spawn') {
    if (Object.hasOwn(v, 'harness') && Object.hasOwn(v, 'runtime')) return null;
    for (const k of ['repo', 'model', 'backend', 'purpose']) if (Object.hasOwn(v, k)) {
      if (!draftString(v[k])) return null;
      out[k] = v[k];
    }
    const harness = harnessOf(v);
    if (harness !== undefined) { if (!draftString(harness)) return null; out.harness = harness; }
    if (Object.hasOwn(v, 'yolo')) { if (typeof v.yolo !== 'boolean') return null; out.yolo = v.yolo; }
    if (Object.hasOwn(v, 'wake')) {
      if (!record(v.wake) || Object.keys(v.wake).some(k => !['cron', 'tz', 'message'].includes(k))
        || ['cron', 'tz', 'message'].some(k => !draftString(v.wake[k]) || !v.wake[k].trim())) return null;
      out.wake = { cron: v.wake.cron, tz: v.wake.tz, message: v.wake.message };
    }
    // The current form cannot retain an unknown select option.
    if (out.harness && !HARNESSES.includes(out.harness) || v.backend && !['tmux', 'herdr'].includes(v.backend)) return null;
  }
  return out;
}
function entry(v, scope, publicView) {
  if (!record(v) || !opaque(v.id) || !scheduleReadId(v.id) && !record(v.unreadable)
    || v.scope !== scope || v.scheduleApi !== 2 || v.scheduleHistoryApi !== 3) throw Error('invalid entry identity');
  const h = history(v.history, v.recentRuns);
  const base = { id: v.id, scope, scheduleApi: 2, scheduleHistoryApi: 3, history: h };
  if (v.unreadable != null) {
    if (!record(v.unreadable) || h.status !== 'corrupt' || v.recentRuns.length) throw Error('invalid unreadable entry');
    return { ...base, unreadable: scheduleReadFailure(v.unreadable.code).reason, recentRuns: [] };
  }
  if (typeof v.enabled !== 'boolean' || typeof v.running !== 'boolean' || !opaque(v.kind)
    || !(v.nextRun === null || time(v.nextRun))) throw Error('invalid definition facts');
  const captured = publicView ? v.captured === true : policyKeys.some(k => Object.hasOwn(v, k)) || v.executionStatus?.kind === 'captured';
  const reason = captured ? 'captured' : !['spawn', 'wake', 'operation'].includes(v.kind) ? 'unsupported-kind'
    : publicView ? v.editReason : scheduleDraft(v) ? null : 'unpreservable';
  if (reason !== null && !Object.hasOwn(editReasons, reason)) throw Error('invalid edit state');
  return { ...base, unreadable: null, kind: v.kind, enabled: v.enabled, running: v.running, captured, editReason: reason,
    agent: text(v.agent, 256), home: text(v.home, 4096), operation: text(v.operation, 256), cron: text(v.cron, 256), tz: text(v.tz, 256),
    createdAt: time(v.createdAt), updatedAt: time(v.updatedAt),
    nextRun: v.nextRun, lastRun: v.lastRun === null ? null : run(v.lastRun, { last: true, publicView }),
    recentRuns: v.recentRuns.map(r => run(r, { publicView })) };
}
function host(v) {
  if (!record(v)) return null;
  const out = {};
  for (const k of ['installed', 'active', 'registered']) out[k] = typeof v[k] === 'boolean' ? v[k] : null;
  for (const k of ['maxConcurrent', 'tickIntervalSec', 'live']) out[k] = count(v[k]) ? v[k] : null;
  out.lastTick = time(v.lastTick);
  return out; // no host unit path/argv/registry/workspaces/raw diagnostics
}
/** Private CLI DTO -> public bounded view. On IPC, reproject the already-public
 * shape independently. The request/context are supplied by an owning boundary. */
export function scheduleReadData(v, context, request, { publicView = false } = {}) {
  try {
    const input = scheduleReadRequest(request);
    if (!input || !absolute(context) || !record(v)) return null;
    const show = input.action === 'show';
    const rows = publicView ? v.schedules : show ? [v.schedule] : v.schedules;
    if (!Array.isArray(rows) || rows.length > 200 || show && rows.length !== 1) return null;
    if (publicView ? v.action !== input.action || v.scope !== context
      : !show && (v.scope !== context || v.scheduleApi !== 2 || v.scheduleHistoryApi !== 3)) return null;
    const sources = show ? null : integrity(v.integrity);
    if (!show && !sources || publicView && show && v.integrity !== null) return null;
    const schedules = rows.map(r => entry(r, context, publicView));
    if (new Set(schedules.map(s => s.id)).size !== schedules.length || show && (schedules[0].id !== input.id || schedules[0].unreadable)) return null;
    let draft = null;
    if (show && schedules[0].editReason === null) {
      draft = scheduleDraft(publicView ? v.draft : rows[0]);
      if (!draft || draft.id !== input.id || draft.kind !== schedules[0].kind) return null;
    } else if (publicView && v.draft !== null) return null;
    return { action: input.action, scope: context, integrity: sources, schedules, scheduler: show ? null : host(v.scheduler), draft };
  } catch { return null; }
}
/** Aggregate only the rows actually returned, never deduplicate legacy/new IDs.
 * ISO timestamps sort; missing/invalid timestamps remain explicitly unknown. */
export function scheduleRecentRuns(data) {
  return (data?.schedules || []).flatMap(s => s.recentRuns.map((run, index) => ({ id: s.id, index, run })))
    .sort((a, b) => (b.run.startedAt || b.run.scheduledFor || '').localeCompare(a.run.startedAt || a.run.scheduledFor || ''))
    .slice(0, 50);
}
export const scheduleReadIncomplete = data => !!data && (data.integrity?.sources.some(s => !['ok', 'absent'].includes(s.status))
  || data.schedules.some(s => s.unreadable || s.history.status === 'corrupt' || s.history.truncated || s.recentRuns.some(r => r.corrupt || r.invalidTimes)));
