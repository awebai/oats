/** Producer-owned K6 decision data. Never compute revisions or derive argv from it. */
import { absolute, record } from './readiness-contract.mjs';
import { harnessOf, HARNESSES } from './harness-names.mjs';
const name = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(v);
const safe = v => typeof v === 'string' && v.length <= 4096
  && !/[\x00-\x1f\x7f]|https?:\/\/[^/\s]*@|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}/.test(v);
const nullable = v => v === null || safe(v);
export function spawnEffective(v) {
  if (!record(v) || !absolute(v.repo) || !['worktree', 'checkout', 'directory', 'workspace', 'attached'].includes(v.work)
    || !HARNESSES.includes(harnessOf(v)) || !nullable(v.model) || !nullable(v.launchConfig)
    || v.yolo !== null && typeof v.yolo !== 'boolean' || !['tmux', 'herdr'].includes(v.backend)
    || typeof v.childSpawns !== 'boolean') return null;
  let relation = null;
  if (v.relation !== null) {
    const r = v.relation, a = r?.anchor;
    if (!record(r) || !['child', 'sibling', 'parent'].includes(r.kind) || !record(a)
      || !name(a.instance) || !absolute(a.agentsRoot)) return null;
    relation = { kind: r.kind, anchor: { instance: a.instance, agentsRoot: a.agentsRoot } };
  }
  return { repo: v.repo, work: v.work, harness: harnessOf(v), model: v.model, launchConfig: v.launchConfig,
    yolo: v.yolo, backend: v.backend, childSpawns: v.childSpawns, relation };
}
export function spawnDecision(v, { effectiveRequired = false } = {}) {
  if (!record(v) || !name(v.instance) || !absolute(v.home) || !nullable(v.branch)
    || typeof v.revision !== 'string' || !/^[a-f0-9]{24}$/.test(v.revision)) return null;
  let base = null;
  if (v.base !== null) {
    if (!record(v.base) || !safe(v.base.ref) || !v.base.ref || typeof v.base.oid !== 'string'
      || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v.base.oid)) return null;
    base = { ref: v.base.ref, oid: v.base.oid };
  }
  const hasEffective = Object.hasOwn(v, 'effective');
  const effective = hasEffective ? spawnEffective(v.effective) : null;
  if (hasEffective && !effective || effectiveRequired && !effective) return null;
  if (effective && (effective.work === 'worktree' ? !v.branch || !base : v.branch !== null || base !== null)) return null;
  // The workspace resolution the decision binds (a member that moved between
  // preview and apply is E_DECISION_STALE); absent only before workspace v2.
  if (Object.hasOwn(v, 'resolution') && (typeof v.resolution !== 'string' || !/^[a-f0-9]{24}$/.test(v.resolution))) return null;
  return { instance: v.instance, home: v.home, branch: v.branch, base,
    ...(hasEffective ? { effective } : {}), ...(Object.hasOwn(v, 'resolution') ? { resolution: v.resolution } : {}), revision: v.revision };
}
/** Equality of projected strong decisions, not an attempt to recompute their hash. */
export function sameSpawnDecision(a, b) {
  const left = spawnDecision(a, { effectiveRequired: true }), right = spawnDecision(b, { effectiveRequired: true });
  return !!left && !!right && JSON.stringify(left) === JSON.stringify(right);
}
