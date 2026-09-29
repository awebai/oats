/** Exact admitted offline K5 read. Process slots are reserved before await. */
import { dirname } from 'node:path';
import { cliReadiness } from '../readiness-cli.mjs';
import { admitInstance } from './instance-admission.mjs';
import { absolute, record, readinessSelector, readinessSupported, readinessFailure, readinessMessage, readinessData } from '../renderer/readiness-contract.mjs';
import { hostReason } from '../renderer/remote-address.mjs';
const flights = new Set(); // one owning-process cap, not one cap per renderer/workspace
const pendingByInvoker = new WeakMap();
function admit(selector, { workspace: w, cli, agents = [], instances = [], localCwd } = {}) {
  const fail = (code, reason = null) => ({ error: code, reason });
  if (!w || typeof w.id !== 'string' || !w.id || !absolute(w.scope)) return fail('E_WORKSPACE_UNKNOWN');
  let context = w.scope, home, incarnation = null, route;
  if (selector.kind === 'soul') {
    // A soul's readiness is read on this machine only.
    if (w.remote || w.server) return fail('unsupported-remote-operation');
    const rows = agents.filter(a => a.name === selector.soul && a.agentsRoot === selector.agentsRoot);
    if (rows.length !== 1) return fail('E_SOUL_UNKNOWN');
    if (rows[0].remote || rows[0].server) return fail('unsupported-remote-operation');
    context = dirname(rows[0].agentsRoot);
  } else {
    const { kind, ...instance } = selector;
    const admitted = admitInstance(instance, { workspace: w, cli, instances, operation: 'readiness', localCwd });
    if (admitted.code) return fail(admitted.code, admitted.reason);
    home = admitted.target.home;
    // A remote row: `--server S --home H` from this machine's cwd; the target keeps the host's workspace as its context.
    if (admitted.remote) route = { server: admitted.remote.server, cwd: admitted.context, label: admitted.remote.label };
    const row = instances.find(i => i.instance === selector.instance && i.agent === selector.agent && i.agentsRoot === selector.agentsRoot && (i.server ?? null) === selector.server);
    incarnation = [row?.createdAt ?? null, row?.repo ?? null]; // reported identity, not a synthetic kernel revision
  }
  const target = { workspace: w.id, context, selector, observedAs: selector.kind, ...(home ? { home } : {}) };
  if (cli?.ok !== true || !absolute(cli.bin)) return fail('cli-unavailable');
  if (!readinessSupported(cli)) return fail('cli-no-readiness');
  const identity = JSON.stringify([w.id, w.scope, w.remote ?? false, w.server ?? null, target, incarnation, route ?? null, cli.bin, cli.version, cli.readinessApi, cli.features, cli.remote ?? null]);
  return { target, bin: cli.bin, identity, route };
}
export function createReadinessBoundary({ invoke = cliReadiness } = {}) {
  return async function read(request, getContext) {
    try {
      if (!record(request) || request.action !== 'read' || Object.keys(request).some(k => !['action', 'selector'].includes(k))) return readinessFailure('E_BAD_ARGS');
      const selector = readinessSelector(request.selector);
      if (!selector) return readinessFailure('E_BAD_ARGS');
      const selected = admit(selector, getContext());
      if (selected.error) return readinessFailure(selected.error, null, selected.reason);
      const { target, bin, identity, route } = selected;
      let pending = pendingByInvoker.get(invoke);
      if (!pending) { pending = new Map(); pendingByInvoker.set(invoke, pending); }
      if (!pending.has(identity)) {
        if (flights.size >= 4) return readinessFailure('E_BUSY', target);
        const slot = {}; flights.add(slot);
        const flight = Promise.resolve().then(() => invoke(bin, { target, ...(route ? { route: { server: route.server, cwd: route.cwd } } : {}) })).then(envelope => {
          if (envelope?.schemaVersion !== 1 || envelope.ok !== true) return readinessFailure(envelope?.error?.code, target,
            route ? hostReason(envelope?.error, route.label, readinessMessage(envelope?.error?.code)) : null);
          const data = readinessData(envelope.result, target);
          if (data) return { readinessViewApi: 1, status: 'available', target, data, reason: null };
          // Dispatch on the payload's own integer: a classic scope still answers readinessApi 1.
          return readinessFailure(envelope.result?.readinessApi === 1 ? 'classic-workspace' : 'E_CLI_PROTOCOL', target);
        }).catch(() => readinessFailure('E_CLI_FAILED', target)).finally(() => { flights.delete(slot); pending.delete(identity); });
        pending.set(identity, flight);
      }
      const result = await pending.get(identity);
      // Each coalesced caller has its own admission lifetime, including rejection.
      const current = admit(selector, getContext());
      return current.identity === identity ? result : readinessFailure('E_TARGET_CHANGED', target);
    } catch { return readinessFailure('E_CLI_FAILED'); }
  };
}
export const readinessRequest = createReadinessBoundary();
