/** Diagnostic projection only: neither a retained target nor an audit receipt
 * grants terminal authority. Bad additive data must never erase a retained home. */
import { record, absolute } from './spawn-preview-contract.mjs';
import { eventsUnsafe } from './instance-events-contract.mjs';
const safe = (v, max = 1024) => typeof v === 'string' && v.length <= max && !/[\x00-\x1f\x7f]/.test(v) && !eventsUnsafe.test(v);
const reasons = new Set([
  'blocked: unexpected prompt', 'blocked: observation timeout', 'blocked: launch observation failed',
  'blocked: invalid target', 'blocked: respawn ownership not proven', 'blocked: respawn geometry changed before fresh screen',
  'blocked: launch geometry not pinned', 'blocked: repeated or unsupported prompt', 'blocked: prompt consent absent',
  'blocked: prompt changed before input', 'blocked: launch authority already used',
  'launch prompt audit failed', 'launch prompt audit failed after possible input',
  'launch prompt audit failed before geometry pin', 'launch prompt audit failed after geometry pin',
  'launch prompt geometry pin failed', 'launch prompt geometry restoration incomplete',
  'launch prompt input failed', 'launch prompt input uncertain',
]);
export const LAUNCH_INSPECTION = 'Launch requires inspection';
export const LAUNCH_DIAGNOSTIC_BYTES = 32768;
const unknown = () => ({ status: 'unknown', answers: [], reason: LAUNCH_INSPECTION, receipt: [] });
export function launchPromptOutcome(v) {
  // A failed audit can follow a possible key even with answers: []. Never
  // translate missing diagnostics into “no input” or a recoverable spawn retry.
  try {
    if (!record(v) || new TextEncoder().encode(JSON.stringify(v)).length > LAUNCH_DIAGNOSTIC_BYTES
      || !['blocked', 'incomplete', 'unknown'].includes(v.status)) return unknown();
    const answers = Array.isArray(v.answers) && v.answers.length <= 8 ? v.answers.flatMap(a =>
      record(a) && a.class === 'awebDevelopmentChannel' && a.status === 'submitted' && safe(a.signatureId, 256)
        ? [{ class: a.class, signatureId: a.signatureId, status: a.status }] : []) : [];
    const receipt = Array.isArray(v.receipt) && v.receipt.length <= 16 ? v.receipt.flatMap(r => {
      if (!record(r) || typeof r.ok !== 'boolean' || !Array.isArray(r.results) || r.results.length > 2) return [];
      const results = r.results.flatMap(w => record(w) && typeof w.ok === 'boolean' && safe(w.path) && absolute(w.path)
        ? [{ path: w.path, ok: w.ok }] : []);
      // Keep write outcomes and actual paths; raw event/OS diagnostic text is
      // deliberately excluded. The Activity reader owns event-row projection.
      return [{ ok: r.ok, results }];
    }) : [];
    return { status: v.status, answers, reason: reasons.has(v.reason) ? v.reason : LAUNCH_INSPECTION, receipt };
  } catch { return unknown(); }
}
export function retainedSpawnDetails(d) {
  if (!record(d) || typeof d.instance !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(d.instance)
    || !absolute(d.home) || ![false, 'unknown'].includes(d.launched)) return null;
  const out = { instance: d.instance, home: d.home, launched: d.launched };
  if (Object.hasOwn(d, 'launchPrompts')) {
    out.launchPrompts = launchPromptOutcome(d.launchPrompts);
    if (typeof d.parentLineageCommitted === 'boolean') out.parentLineageCommitted = d.parentLineageCommitted;
    if (record(d.target)) {
      out.target = {};
      for (const key of ['socket', 'session', 'window', 'windowId', 'paneId']) if (safe(d.target[key])) out.target[key] = d.target[key];
      if (d.target.backend === 'tmux') out.target.backend = 'tmux';
      if (Number.isSafeInteger(d.target.pid) && d.target.pid > 0 || safe(d.target.pid, 32) && /^\d+$/.test(d.target.pid)) out.target.pid = d.target.pid;
    }
  }
  return out;
}
export function retainedSpawnMessage(d) {
  if (!d.launchPrompts) return `${d.instance} was created but didn’t finish starting. Open it from the instance list instead of spawning again.`;
  const p = launchPromptOutcome(d.launchPrompts);
  const sent = p.answers.length ? ' A launch-prompt answer was submitted; this does not confirm readiness.'
    : p.status === 'incomplete' ? ' Input may already have been sent.' : '';
  return `${d.instance} was retained: ${p.reason}.${sent} Inspect its existing pane, then use oats session start --home for this home. Do not spawn again.`;
}
