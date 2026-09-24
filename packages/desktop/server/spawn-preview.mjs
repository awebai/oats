/** Exact local soul/anchor admission against the deployment's spawn catalog,
 * and the two-slot read-only preview budget. */
import { dirname } from 'node:path';
import { cliSpawnPreview } from '../spawn-preview-cli.mjs';
import { admitInstance } from './instance-admission.mjs';
import { absolute, record, previewSelector, previewChoices, previewSupported, previewFailure, previewData } from '../renderer/spawn-preview-contract.mjs';
const flights = new Set(), byInvoker = new WeakMap();
export function admitSpawnSelection(selector, choices, { workspace: w, cli, agents = [], instances = [] } = {}) {
  const fail = error => ({ error });
  if (!w || typeof w.id !== 'string' || !w.id || !absolute(w.scope)) return fail('E_WORKSPACE_UNKNOWN');
  if (w.remote || w.server) return fail('unsupported-remote-operation');
  if (!previewSupported(cli)) return fail('E_PREVIEW_UNAVAILABLE');
  const rows = agents.filter(a => a.name === selector.soul && a.agentsRoot === selector.agentsRoot);
  if (rows.length !== 1) return fail('E_SOUL_UNKNOWN');
  const soul = rows[0];
  if (soul.remote || soul.server) return fail('unsupported-remote-operation');
  if (soul.work === 'attached') return fail('E_UNSUPPORTED_MODE'); // no renderer workDir authority
  // An exact (unprefixed) name only where the CLI advertises it.
  if (choices.name !== undefined && !cli.features.includes('spawn-name')) return fail('E_UNSUPPORTED_OPTION');
  if (choices.identity !== undefined && !cli.features.includes('spawn-provider-payload')) return fail('E_UNSUPPORTED_OPTION');
  // The one work override offered: a checkout soul asked for a worktree.
  if (choices.work !== undefined && soul.work !== 'checkout') return fail('E_UNSUPPORTED_OPTION');
  const work = choices.work ?? soul.work;
  if ((choices.base !== undefined || choices.branch !== undefined) && work !== 'worktree') return fail('E_UNSUPPORTED_OPTION');
  const supports = (values, value) => Array.isArray(values) && values.includes(value);
  if (choices.runtime && !supports(cli.runtimes, choices.runtime) || choices.backend && !supports(cli.sessionBackends, choices.backend)
    || choices.yolo !== undefined && !supports(cli.launchOptions, 'yolo') || choices.launchConfig && !cli.features.includes('launch-config')) return fail('E_UNSUPPORTED_OPTION');
  let anchorIdentity = null;
  if (choices.relation.kind !== 'unrelated') {
    const a = choices.relation.anchor, admitted = admitInstance(a, { workspace: w, cli, instances });
    if (admitted.code) return fail(admitted.code);
    // The CLI takes name+root, not agent+name+root. Do not pretend that a more
    // precise renderer selector can disambiguate what its public argv cannot.
    const expressible = instances.filter(i => i.instance === a.instance && i.agentsRoot === a.agentsRoot && (i.server ?? null) === null);
    if (expressible.length !== 1) return fail('E_RELATIVE_AMBIGUOUS');
    anchorIdentity = [admitted.target, expressible[0].createdAt ?? null];
  }
  const target = { workspace: w.id, context: dirname(soul.agentsRoot), selector };
  const identity = JSON.stringify([w.id, w.scope, target, soul.work, soul.repo, soul.capability, anchorIdentity, choices,
    cli.bin, cli.version, cli.spawnPreviewApi, cli.spawnApplyApi, cli.features, cli.runtimes, cli.sessionBackends, cli.launchOptions]);
  return { target, identity, cli: structuredClone(cli) };
}
export function createSpawnPreviewBoundary({ invoke = cliSpawnPreview } = {}) {
  return async function read(request, getContext) {
    try {
      if (!record(request) || request.action !== 'preview' || Object.keys(request).some(k => !['action', 'selector', 'choices'].includes(k))) return previewFailure('E_BAD_ARGS');
      const selector = previewSelector(request.selector), choices = previewChoices(request.choices);
      if (!selector || !choices) return previewFailure('E_BAD_ARGS');
      const selected = admitSpawnSelection(selector, choices, getContext());
      if (selected.error) return previewFailure(selected.error);
      const { target, identity, cli } = selected;
      let pending = byInvoker.get(invoke); if (!pending) { pending = new Map(); byInvoker.set(invoke, pending); }
      if (!pending.has(identity)) {
        if (flights.size >= 2) return previewFailure('E_BUSY', target);
        const slot = {}; flights.add(slot);
        const flight = Promise.resolve().then(() => invoke(cli, { target, choices })).then(envelope => {
          if (envelope?.schemaVersion !== 1 || envelope.ok !== true) return previewFailure(envelope?.error?.code, target, envelope?.error?.message);
          const data = previewData(envelope.result, target);
          return data ? { spawnPreviewViewApi: 1, status: 'available', target, data, reason: null } : previewFailure('E_CLI_PROTOCOL', target);
        }).catch(() => previewFailure('E_CLI_FAILED', target)).finally(() => { flights.delete(slot); pending.delete(identity); });
        pending.set(identity, flight);
      }
      const result = await pending.get(identity), current = admitSpawnSelection(selector, choices, getContext());
      return current.identity === identity ? result : previewFailure('E_TARGET_CHANGED', target);
    } catch { return previewFailure('E_CLI_FAILED'); }
  };
}
export const spawnPreviewRequest = createSpawnPreviewBoundary();
