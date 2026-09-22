import { cli, context, data, envelope } from './spawn-preview-fixture.mjs';
export { envelope };
export const applyCli = () => ({ ...structuredClone(cli), spawnApplyApi: 1,
  features: [...cli.features, 'spawn-apply-2', 'spawn-idempotency-2', 'schedule'] });
export const applyContext = () => ({ ...context(), cli: applyCli() });
export function applyPreview(target) {
  const v = data(target);
  v.home = v.decision.home = `${v.subject.agentsRoot}/${v.subject.soul}/instances/${v.instance}`;
  v.worktree = `${v.home}/work`;
  v.decision.effective = { repo: v.repo, work: v.work, runtime: v.runtime, model: v.model, launchConfig: v.launchConfig,
    yolo: v.yolo ?? null, backend: v.backend, childSpawns: v.policy.childSpawns.allowed, relation: null };
  return v;
}
export function creation(preview, changes = {}) {
  const d = preview.decision, e = d.effective;
  return { agent: preview.subject.soul, instance: d.instance, home: d.home, branch: d.branch, repo: e.repo, work: e.work,
    runtime: e.runtime, model: e.model, launched: true, warnings: [], decision: structuredClone(d), replayed: false,
    wake: { requested: false, saved: null, error: null }, ...changes };
}
