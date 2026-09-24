import { cli, context, data, envelope, kernel } from './spawn-preview-fixture.mjs';
export { envelope };
/** The captured CLI already advertises the full confirmed-apply fence. */
export const applyCli = () => structuredClone(cli);
export const applyContext = () => ({ ...context(), cli: applyCli() });
/** The kernel preview the captured apply was bound to. */
export function applyPreview() { return data(); }
/** A creation receipt: the captured bound apply (launched false, --no-launch),
 * re-bound to the given preview's decision; `changes` are test mutations. */
export function creation(preview, changes = {}) {
  const receipt = kernel('apply-bound').result, d = preview.decision, e = d.effective;
  return { ...receipt, agent: preview.subject.soul, instance: d.instance, home: d.home, branch: d.branch, repo: e.repo, work: e.work,
    runtime: e.runtime, model: e.model, launched: true, decision: structuredClone(d), replayed: false, ...changes };
}
