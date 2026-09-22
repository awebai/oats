/** K7 exact local read admission. No kernel import, filesystem or log reader. */
import { admitInstance } from './instance-admission.mjs';
import { cliInstanceEvents } from '../instance-events-cli.mjs';
import { eventsRequest, eventsTarget, eventsSupported, eventsFailure } from '../renderer/instance-events-contract.mjs';
import { eventsData } from '../renderer/instance-events-data.mjs';
const flights = new Set(); // process-wide, not per window/workspace/factory
const byInvoker = new WeakMap();
const changedBeforeDispatch = Symbol('changed-before-dispatch');
export function admitInstanceEvents(request, context = {}) {
  const parsed = eventsRequest(request);
  if (!parsed) return { error: 'E_BAD_ARGS' };
  const admitted = admitInstance(parsed.selector, context);
  if (admitted.code) return { error: admitted.code };
  const row = context.instances.find(i => i.instance === parsed.selector.instance && i.agent === parsed.selector.agent
    && i.agentsRoot === parsed.selector.agentsRoot && (i.server ?? null) === null);
  // Refuse explicit captured-mode observations, never reinterpret them as classic.
  // The CLI also owns mode refusals for captured targets absent from this roster.
  if (context.workspace.captured || row?.captured || row?.mode === 'captured') return { error: 'E_UNSUPPORTED_MODE' };
  if (!eventsSupported(context.cli)) return { error: 'E_EVENTS_UNAVAILABLE' };
  const target = eventsTarget({ workspace: admitted.target.workspace, context: admitted.context, selector: parsed.selector,
    home: admitted.target.home, incarnation: row.createdAt ?? null });
  if (!target) return { error: 'E_HOME_MISMATCH' };
  const cli = structuredClone(context.cli);
  const identity = JSON.stringify([target, parsed.limit, context.workspace.roots ?? null, context.workspace.revision ?? null,
    context.epoch ?? null, cli.bin, cli.version, cli.eventsApi, cli.features]);
  return { target, identity, cli, limit: parsed.limit };
}
export function createInstanceEventsBoundary({ invoke = cliInstanceEvents } = {}) {
  return async function read(request, getContext) {
    let selected;
    try {
      const input = eventsRequest(request);
      if (!input) return eventsFailure('E_BAD_ARGS');
      selected = admitInstanceEvents(input, getContext());
      if (selected.error) return eventsFailure(selected.error);
      const { target, identity, cli, limit } = selected;
      const owns = () => {
        try { return admitInstanceEvents(input, getContext()).identity === identity; }
        catch { return false; }
      };
      if (typeof invoke !== 'function') return eventsFailure('E_CLI_FAILED', target);
      let pending = byInvoker.get(invoke);
      if (!pending) { pending = new Map(); byInvoker.set(invoke, pending); }
      if (!pending.has(identity)) {
        if (flights.size >= 2) return eventsFailure('E_BUSY', target);
        const slot = {}; flights.add(slot); // reserve synchronously, before await
        const flight = Promise.resolve().then(() => owns() ? invoke(cli, { target: structuredClone(target), limit }) : changedBeforeDispatch).then(envelope => {
          if (envelope === changedBeforeDispatch) return eventsFailure('E_TARGET_CHANGED', target);
          if (envelope?.schemaVersion !== 1 || typeof envelope.ok !== 'boolean') return eventsFailure('E_CLI_PROTOCOL', target);
          if (!envelope.ok) return eventsFailure(envelope.error?.code, target);
          const data = eventsData(envelope.result, target, limit);
          return data ? { instanceEventsViewApi: 1, status: 'available', target, data, reason: null } : eventsFailure('E_CLI_PROTOCOL', target);
        }).catch(() => eventsFailure('E_CLI_FAILED', target)).finally(() => { pending.delete(identity); flights.delete(slot); });
        pending.set(identity, flight);
      }
      const result = await pending.get(identity);
      // Every coalesced waiter has its own lifetime, including a rejected CLI.
      return owns() ? structuredClone(result) : eventsFailure('E_TARGET_CHANGED', target);
    } catch { return eventsFailure(selected?.identity ? 'E_TARGET_CHANGED' : 'E_CLI_FAILED', selected?.target); }
  };
}
export const instanceEventsRequest = createInstanceEventsBoundary();
