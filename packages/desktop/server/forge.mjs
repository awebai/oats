/** Machine Connections + qualified PR read. No auth mutation is exposed by HTTP. */
import { createHmac, randomBytes } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { realpathSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { cliInstanceGit } from '../cli-adapter.mjs';
import { gitState, gitTargetKey } from '../renderer/instance-git-contract.mjs';
import { object, ref, FORGE_API, forgeFailure, forgeReason } from '../renderer/forge-contract.mjs';
import { createGhRunner, discoverGh, ghStatus, ghLogin, ghPullRequest, forgeEnvironment } from '../forge-cli.mjs';
import { admitInstanceGit } from './instance-git.mjs';
import { forgeObservation } from './forge-observation.mjs';
import { rosterTargets } from './forge-roster.mjs';

export { FORGE_EPOCH_HEADER, validForgeEpoch } from '../forge-proxy.mjs';
import { validForgeEpoch } from '../forge-proxy.mjs';
const cliKey = cli => JSON.stringify([cli.bin, cli.version, cli.stamp, cli.profile]);
const noObservation = { target: null, observation: null };
const metadata = (target, o) => ({ target, observation: { key: o.observationKey, revision: o.revision, branch: o.branch } });
export function createForgeBoundary({ env = forgeEnvironment(), run = createGhRunner({ env }),
  discover = () => discoverGh({ run, env }), invokeGit = cliInstanceGit, now = () => performance.now(), realpath = realpathSync.native } = {}) {
  const secret = randomBytes(32), flights = new Map(), probes = new Map(), statuses = new Map();
  const hosts = new Map(), actions = new Map();
  const digest = fields => createHmac('sha256', secret).update(JSON.stringify(fields)).digest('hex');
  const sweep = () => {
    for (const map of [hosts, actions]) for (const [key, value] of map) if (value.expires <= now()) map.delete(key);
  };
  const shared = (map, key, work) => {
    if (map.has(key)) return map.get(key);
    const promise = Promise.resolve().then(work).catch(() => ({ ok: false, code: 'E_GH_FAILED' })).finally(() => map.delete(key));
    map.set(key, promise); return promise;
  };
  const failure = (code, epoch, extras = {}) => forgeFailure(code, { readEpoch: epoch, observedAt: new Date().toISOString(), ...extras });
  const flight = (key, epoch, work, extras = {}) => {
    if (flights.has(key)) return flights.get(key);
    if (flights.size >= 4) return Promise.resolve(failure('E_FORGE_BUSY', epoch, extras));
    const promise = Promise.resolve().then(work).catch(() => failure('E_GH_FAILED', epoch, extras)).finally(() => flights.delete(key));
    flights.set(key, promise); return promise;
  };
  function rememberHost(cli, host) {
    const hostRef = digest(['host', cliKey(cli), host]);
    if (!hosts.has(hostRef) && hosts.size >= 32) return null;
    const item = { hostRef, host, context: cliKey(cli), expires: now() + 15 * 60_000 };
    hosts.set(hostRef, item); return item;
  }
  async function connection({ hostRef = null, wantedHost = null, epoch, deadline }) {
    sweep();
    const selection = hostRef ? hosts.get(hostRef) || actions.get(hostRef) : null;
    if (hostRef && !selection) return failure('E_CONNECTION_CHANGED', epoch);
    const cli = await shared(probes, epoch, discover);
    if (!cli?.ok) return failure(cli?.code || 'E_GH_FAILED', epoch);
    const context = cliKey(cli);
    if (selection && selection.context !== context) return failure('E_CONNECTION_CHANGED', epoch);
    const snapshot = await shared(statuses, JSON.stringify([epoch, context]), () => ghStatus(cli, run, Math.min(10_000, deadline - now())));
    if (!snapshot.ok) return failure(snapshot.code, epoch);
    // A missing/overflowed list is never interpreted as complete or unsupported.
    for (const host of new Set(['github.com', ...snapshot.hosts.keys()])) if (!rememberHost(cli, host)) return failure('E_FORGE_LIMIT', epoch);
    const host = selection?.host || wantedHost || 'github.com';
    const admitted = hosts.get(digest(['host', context, host]));
    if (!admitted) return failure('E_UNSUPPORTED_FORGE', epoch, { host,
      remedy: `configure it in GitHub CLI first (\`gh auth login --hostname ${host}\` from a terminal)` });
    const candidate = snapshot.hosts.get(host);
    let status = candidate?.status || 'not-connected', login = null, reason = null;
    if (status === 'candidate') {
      const verified = await ghLogin(cli, host, candidate.login, run, Math.min(10_000, deadline - now()));
      if (verified.ok) { status = 'connected'; login = verified.login; }
      else { status = 'unavailable'; reason = forgeReason(verified.code); }
    } else if (status === 'unavailable') reason = forgeReason('E_GH_FAILED');
    if (selection?.connectionRef && (selection.status !== status || selection.login !== login)) return failure('E_CONNECTION_CHANGED', epoch);
    const connectionRef = digest(['account', context, host, status, login]);
    if (!actions.has(connectionRef) && actions.size >= 32) return failure('E_FORGE_LIMIT', epoch);
    actions.set(connectionRef, { connectionRef, context, host, status, login, expires: now() + 120_000 });
    return { forgeApi: FORGE_API, status, data: null, reason, readEpoch: epoch, observedAt: new Date().toISOString(),
      host, hostRef: admitted.hostRef, connectionRef, login,
      // Metadata is typed and non-secret; main must verify it before auth. No
      // renderer-provided path ever becomes a command. Never include env values.
      cli: { bin: cli.bin, version: cli.version, stamp: cli.stamp, profile: cli.profile },
      hosts: [...hosts.values()].filter(h => h.context === context).map(h => ({ host: h.host, hostRef: h.hostRef })) };
  }
  function connections(request, epoch = 'standalone:0') {
    if (!validForgeEpoch(epoch) || !object(request) || Object.keys(request).some(k => k !== 'hostRef')
      || (Object.hasOwn(request, 'hostRef') && !ref(request.hostRef))) return Promise.resolve(failure('E_BAD_ARGS', 'invalid'));
    return flight(JSON.stringify(['connections', epoch, request.hostRef || null]), epoch,
      () => connection({ hostRef: request.hostRef, epoch, deadline: now() + 20_000 }));
  }
  async function observe(admitted, cli, deadline) {
    if (deadline <= now()) return { code: 'E_GH_TIMEOUT' };
    const result = await invokeGit(admitted.bin, admitted.options, { timeout: Math.min(15_000, deadline - now()) });
    if (result?.schemaVersion !== 1 || result.ok !== true) return { code: 'E_GH_FAILED' };
    const safe = gitState(result.result, admitted.target);
    if (!safe || !isAbsolute(safe.observation.worktree)) return { code: 'E_GH_PROTOCOL' };
    return forgeObservation(result.result, admitted.target, cli);
  }
  function pull(request, getContext, epoch = 'standalone:0') {
    if (!validForgeEpoch(epoch) || !object(request) || Object.keys(request).some(k => !['selector', 'observationKey'].includes(k)) || !ref(request.observationKey)) {
      return Promise.resolve(failure('E_BAD_ARGS', 'invalid', noObservation));
    }
    const context = getContext(), admitted = admitInstanceGit({ action: 'git', selector: request.selector }, context);
    if (admitted.failure) return Promise.resolve({ ...failure('E_GH_FAILED', epoch, noObservation),
      target: admitted.failure.target, reason: admitted.failure.reason });
    const key = JSON.stringify(['pr', epoch, admitted.bin, context.cli.version, admitted.context, gitTargetKey(admitted.target), request.observationKey]);
    return flight(key, epoch, async () => {
      const deadline = now() + 45_000;
      const observation = await observe(admitted, context.cli, deadline);
      if (!observation.observationKey) return failure(observation.code, epoch, { ...noObservation, target: admitted.target });
      const echo = metadata(admitted.target, observation);
      if (observation.observationKey !== request.observationKey) return failure('E_OBSERVATION_CHANGED', epoch, echo);
      if (observation.code) return failure(observation.code, epoch, echo);
      const conn = await connection({ wantedHost: observation.route.host, epoch, deadline });
      let result;
      if (conn.status !== 'connected') result = { ...conn, ...echo };
      else {
        const pr = await ghPullRequest(conn.cli, { ...observation.route, branch: observation.branch }, run, Math.min(10_000, deadline - now()), { threads: true });
        result = pr.ok ? { forgeApi: FORGE_API, status: pr.data ? 'available' : 'no-pull-request', data: pr.data, reason: null,
          ...echo, host: conn.host, repository: observation.route.path, hostRef: conn.hostRef, connectionRef: conn.connectionRef, readEpoch: epoch, observedAt: new Date().toISOString() }
          : failure(pr.code, epoch, echo);
      }
      const latest = getContext(), again = admitInstanceGit({ action: 'git', selector: request.selector }, latest);
      if (again.failure || again.context !== admitted.context || gitTargetKey(again.target) !== gitTargetKey(admitted.target)) return failure('E_OBSERVATION_CHANGED', epoch, echo);
      const verified = await observe(again, latest.cli, deadline);
      if (verified.observationKey !== observation.observationKey) return failure('E_OBSERVATION_CHANGED', epoch, echo);
      return result;
    }, { ...noObservation, target: admitted.target });
  }
  /* forge-roster: the open/closed/merged PR of each LOCAL instance's branch, for the roster.
     The repository is the kernel's (clones[] member key, forge-roster.mjs); gh runs as this
     host's own auth (never a token in argv, env or output); a row is exactly
     { home, number, state, isDraft, url }, and an instance without a PR has no row. */
  const rosterCache = new Map(), ROSTER_TTL = 60_000;
  const rosterDone = (epoch, rows) => ({ forgeApi: FORGE_API, status: 'ok', rows, reason: null, readEpoch: epoch, observedAt: new Date().toISOString() });
  function roster(request, getContext, epoch = 'standalone:0') {
    if (!validForgeEpoch(epoch) || !object(request) || Object.keys(request).length) return Promise.resolve(failure('E_BAD_ARGS', 'invalid', { rows: null }));
    const context = getContext();
    if (!context?.workspace) return Promise.resolve(failure('E_WORKSPACE_UNKNOWN', epoch, { rows: null }));
    if (context.workspace.remote) return Promise.resolve(failure('unsupported-remote-operation', epoch, { rows: null }));
    const targets = rosterTargets({ instances: context.instances, clones: context.clones, realpath });
    if (!targets.length) return Promise.resolve(rosterDone(epoch, []));
    return flight(JSON.stringify(['roster', epoch, context.workspace.id]), epoch, async () => {
      const deadline = now() + 45_000;
      const conn = await connection({ wantedHost: 'github.com', epoch, deadline });
      if (conn.status === 'cli-not-installed' || conn.status === 'not-connected') return failure('E_GH_UNAVAILABLE', epoch, { rows: null });
      if (conn.status !== 'connected') return failure(conn.reason?.code || 'E_GH_FAILED', epoch, { rows: null });
      for (const [key, value] of rosterCache) if (value.expires <= now()) rosterCache.delete(key);
      const found = new Map();
      for (const t of targets) {
        const key = JSON.stringify([t.host, t.path, t.branch]);
        if (found.has(key)) continue;
        let hit = rosterCache.get(key);
        if (!hit) {
          if (deadline - now() < 1_000) break; // what did not fit is absent, never guessed
          const pr = await ghPullRequest(conn.cli, t, run, Math.min(10_000, deadline - now()));
          if (!pr.ok) { found.set(key, null); continue; }
          hit = { data: pr.data, expires: now() + ROSTER_TTL };
          if (rosterCache.size < 256) rosterCache.set(key, hit);
        }
        found.set(key, hit.data);
      }
      const rows = [];
      for (const t of targets) {
        const data = found.get(JSON.stringify([t.host, t.path, t.branch]));
        if (data) rows.push({ home: t.home, number: data.number, state: data.state, isDraft: data.isDraft, url: data.url });
      }
      return rosterDone(epoch, rows);
    }, { rows: null });
  }
  return { connections, pull, roster };
}
export const forgeBoundary = createForgeBoundary();
