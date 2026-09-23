/** Workspace-exact read-only K8 boundary. No core import, state scanner or
 * schedule mutation fallback. One process-wide two-slot budget. */
import { absolute, record } from '../renderer/readiness-contract.mjs';
import { scheduleReadRequest, scheduleReadSupported, scheduleReadFailure } from '../renderer/schedule-read-contract.mjs';
import { scheduleReadData } from '../renderer/schedule-read-data.mjs';
import { cliScheduleRead } from '../schedule-read-cli.mjs';
const flights = new Set();
const byInvoker = new WeakMap();
const changed = Symbol('changed-before-dispatch');
const fail = (code, selected, details) => ({ ...scheduleReadFailure(code, selected?.scope, details), workspace: selected?.workspace ?? null });
export function admitScheduleRead(request, context = {}) {
  const input = scheduleReadRequest(request), w = context.workspace, cli = context.cli;
  if (!input) return { error: 'E_BAD_ARGS' };
  if (!record(w) || typeof w.id !== 'string' || !w.id || w.id.length > 4096 || /[\x00-\x1f\x7f]/.test(w.id) || !absolute(w.scope)) return { error: 'E_WORKSPACE_UNKNOWN' };
  if (w.remote || w.server) return { error: 'unsupported-remote-operation' };
  if (cli?.ok !== true || !absolute(cli.bin)) return { error: 'cli-unavailable' };
  if (!scheduleReadSupported(cli)) return { error: 'E_SCHEDULE_READ_UNAVAILABLE' };
  const copied = structuredClone(cli);
  const identity = JSON.stringify([w.id, w.scope, w.roots ?? null, w.revision ?? null, context.epoch ?? null,
    copied.bin, copied.version, copied.scheduleHistoryApi, copied.features, input]);
  return { workspace: w.id, scope: w.scope, input, identity, cli: copied };
}
export function createScheduleReadBoundary({ invoke = cliScheduleRead } = {}) {
  return async function read(request, getContext) {
    let selected;
    try {
      const input = scheduleReadRequest(request);
      if (!input) return fail('E_BAD_ARGS');
      selected = admitScheduleRead(input, getContext());
      if (selected.error) return fail(selected.error);
      const { identity, scope, workspace, cli } = selected;
      const owns = () => { try { return admitScheduleRead(input, getContext()).identity === identity; } catch { return false; } };
      if (typeof invoke !== 'function') return fail('E_CLI_FAILED', selected);
      let pending = byInvoker.get(invoke);
      if (!pending) { pending = new Map(); byInvoker.set(invoke, pending); }
      if (!pending.has(identity)) {
        if (flights.size >= 2) return fail('E_BUSY', selected);
        const slot = {}; flights.add(slot);
        const flight = Promise.resolve().then(() => owns() ? invoke(cli, { ...input, context: scope }) : changed).then(envelope => {
          if (envelope === changed) return fail('E_TARGET_CHANGED', selected);
          if (envelope?.schemaVersion !== 1 || typeof envelope.ok !== 'boolean') return fail('E_CLI_PROTOCOL', selected);
          if (!envelope.ok) return fail(envelope.error?.code, selected, envelope.error?.details);
          const data = scheduleReadData(envelope.result, scope, input);
          return data ? { scheduleReadViewApi: 1, status: 'available', workspace, scope, data, reason: null } : fail('E_CLI_PROTOCOL', selected);
        }).catch(() => fail('E_CLI_FAILED', selected)).finally(() => { pending.delete(identity); flights.delete(slot); });
        pending.set(identity, flight);
      }
      const result = await pending.get(identity);
      return owns() ? structuredClone(result) : fail('E_TARGET_CHANGED', selected);
    } catch { return fail(selected?.identity ? 'E_TARGET_CHANGED' : 'E_CLI_FAILED', selected); }
  };
}
export const scheduleReadRequestBoundary = createScheduleReadBoundary();
