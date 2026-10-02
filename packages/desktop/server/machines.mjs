/** A workspace's own machines (#517): the registrations whose `workspaceKey` is the window's, the
 * one-time backfill of unknown keys, and Check, Remove and Add a machine (`server connect`, then
 * `aweb connect`). Every read and mutation is the installed CLI's (`oats server … --json`); the
 * Desktop keeps no registry, only the last check of each machine in this run.
 *
 * A window's scope is `{ key, deployment, messaging, reason }` (`machineScope` in oats-web.mjs): the
 * key its primary local deployment reports (keyFrom "workspace" only), that deployment's directory
 * (the cwd of every call) and its messaging slot. With `key: null` the window offers no remote
 * machine and `reason` says why.
 *
 * Gated on the probe (features servers-per-workspace and server-connect, capability-route for the
 * messaging step); without them `forScope` answers null and the caller keeps today's list. */
import { machinesGated, awebConnectGated, machineFieldProblem, MACHINE_ID, MACHINE_SCOPE_REASONS } from '../renderer/machine-contract.mjs';
import { mapBounded } from './deployment-observer.mjs';

/** Unknown keys checked at once by the backfill. */
export const BACKFILL_CONCURRENCY = 2;
const AWEB = 'oats.aweb';

const refuse = (code, message) => { throw Object.assign(new Error(message), { code }); };
const text = value => typeof value === 'string' && value.length > 0;

/** One `server list` row as the Desktop serves it. */
const registration = row => ({ id: row.id, label: text(row.label) ? row.label : row.id, sshHost: row.sshHost, workspace: row.workspace,
  workspaceKey: text(row.workspaceKey) ? row.workspaceKey : null });

/** What a check says about a machine: reachable (its deployment answered), its OATS version, or why not. */
function checkFacts(envelope) {
  if (envelope?.ok === true) {
    const r = envelope.result || {};
    return { reachable: r.workspaceReachable === true, version: text(r.remote?.version) ? r.remote.version : null,
      error: r.workspaceReachable === true ? null : text(r.error?.message) ? r.error.message : null };
  }
  return { reachable: false, version: null, error: text(envelope?.error?.message) ? envelope.error.message : 'The check did not answer.' };
}

export function createMachines({ adapter, cli, concurrency = BACKFILL_CONCURRENCY, backfill = true }) {
  const checks = new Map();     // id → the last check's facts, this run
  const connecting = new Set(); // ids with a connect in flight
  let backfillRun = null;

  const gate = () => { if (!machinesGated(cli())) refuse('E_FEATURE', 'This OATS CLI does not connect machines to a workspace'); };
  const keyed = scope => { if (!scope?.key || !scope.deployment) refuse('E_NO_WORKSPACE_KEY', MACHINE_SCOPE_REASONS[scope?.reason] || MACHINE_SCOPE_REASONS['no-key']); };
  async function registrations(cwd) {
    const envelope = await adapter.cliServers(cli().bin, { cwd });
    if (!envelope?.ok) refuse(envelope?.error?.code || 'E_SERVERS', envelope?.error?.message || 'The server registry could not be read');
    return (Array.isArray(envelope.result?.servers) ? envelope.result.servers : []).filter(row => text(row?.id)).map(registration);
  }
  /** The registration `id` names, admitted only when its key is one of `keys` (null: not reported yet). */
  async function admitted(scope, id, keys) {
    if (typeof id !== 'string' || !MACHINE_ID.test(id)) refuse('E_BAD_ARGS', 'Select a machine');
    const row = (await registrations(scope.deployment)).find(r => r.id === id);
    if (!row) refuse('E_SERVER_UNKNOWN', `No machine is registered as ${id}`);
    if (!keys.includes(row.workspaceKey)) refuse('E_SERVER_OTHER_WORKSPACE', `${id} is not a machine of this workspace`);
    return row;
  }
  async function runCheck(id, cwd) {
    const facts = checkFacts(await adapter.cliServerCheck(cli().bin, id, { cwd }));
    checks.set(id, facts);
    return facts;
  }
  /** Once per start, in the background: check every registration whose key is unknown (the check
   * records the host's key), a bounded few at a time. Every list read is fresh, so the next one sees them. */
  function startBackfill(rows, cwd) {
    if (!backfill || backfillRun) return;
    const unknown = rows.filter(r => r.workspaceKey === null).map(r => r.id);
    backfillRun = mapBounded(unknown, concurrency, id => runCheck(id, cwd).catch(() => null)).then(() => undefined);
  }

  return {
    /** Where to run and the Setup tab: this window's machines, or null when the gates are off. */
    async forScope(scope) {
      if (!machinesGated(cli())) return null;
      if (!scope?.key || !scope.deployment) return { servers: [], key: null, filtered: true, reason: MACHINE_SCOPE_REASONS[scope?.reason] || MACHINE_SCOPE_REASONS['no-key'] };
      const rows = await registrations(scope.deployment);
      startBackfill(rows, scope.deployment);
      return { servers: rows.filter(r => r.workspaceKey === scope.key).map(r => ({ ...r, check: checks.get(r.id) ?? null })), key: scope.key, filtered: true };
    },
    /** Settles when this start's backfill has run (at once when none started). */
    backfilled: () => backfillRun ?? Promise.resolve(),
    /** Check: a machine of this workspace, or one whose key is not known yet. */
    async check(scope, id) {
      gate(); keyed(scope);
      await admitted(scope, id, [scope.key, null]);
      return { id, check: await runCheck(id, scope.deployment) };
    },
    /** Remove: a machine of this workspace only. The CLI's envelope is relayed. */
    async remove(scope, id) {
      gate(); keyed(scope);
      await admitted(scope, id, [scope.key]);
      const envelope = await adapter.cliServerRemove(cli().bin, id, { cwd: scope.deployment });
      if (envelope?.ok) checks.delete(id);
      return envelope;
    },
    /** Add a machine: phase "connect" (`server connect`) or "aweb" (`aweb connect`, only when this
     * deployment's messaging is oats.aweb and the probe routes capability commands). One run per machine. */
    async connect(scope, body) {
      gate(); keyed(scope);
      const { phase, id } = body || {};
      if (phase === 'connect') {
        const fields = { id: body.id, host: body.host, folder: body.folder };
        if (machineFieldProblem(fields) || (body.installOats !== undefined && typeof body.installOats !== 'boolean')) refuse('E_BAD_ARGS', 'Invalid machine fields');
      } else if (phase === 'aweb') {
        if (scope.messaging !== AWEB || !awebConnectGated(cli())) refuse('E_NOT_AWEB', 'This workspace does not use oats.aweb for messaging here');
        await admitted(scope, id, [scope.key]);
      } else refuse('E_BAD_ARGS', 'Unknown connect phase');
      if (connecting.has(id)) refuse('E_BUSY', `${id} is already being connected`);
      connecting.add(id);
      try {
        return phase === 'connect'
          ? await adapter.cliServerConnect(cli().bin, { id, host: body.host, folder: body.folder, installOats: body.installOats === true, workspaceDir: scope.deployment })
          : await adapter.cliAwebConnect(cli().bin, { id, workspaceDir: scope.deployment });
      } finally { connecting.delete(id); }
    },
  };
}
