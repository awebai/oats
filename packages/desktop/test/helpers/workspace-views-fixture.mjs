// Workspace views (#482) over held observations, for the server tests: the OATSWEB_VIEWS block of
// server/oats-web.mjs extracted with its real helpers, and Juan's deployments as fixtures.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as remote from '../../server/remote-roster.mjs';
import { readIdentity, attachment, buildViews, deploymentReason, deploymentReasonParts, viewId } from '../../server/workspace-views.mjs';
import { createRemoteIdentityStore } from '../../server/remote-identity.mjs';
import { THIS_MACHINE, shortPath, deploymentLabel } from '../../renderer/deployment-label.mjs';
import { deploymentUnavailableText } from '../../renderer/deployment-header.mjs';
import { teamMembers } from '../../server/team-members.mjs';

export const SOURCE = readFileSync(new URL('../../server/oats-web.mjs', import.meta.url), 'utf8');
export const between = (begin, end) => SOURCE.slice(SOURCE.indexOf(begin), SOURCE.indexOf(end));
export const VIEWS_BLOCK = between('/* OATSWEB_VIEWS_BEGIN', '/* OATSWEB_VIEWS_END */');
/** The block's functions a test reads. */
export const VIEW_FUNCTIONS = ['deployments', 'viewModel', 'viewFor', 'deploymentFor', 'surfaceDeployment', 'viewForgeContext', 'isServed',
  'teamMembersFor', 'panelData', 'workspaceChoices', 'deploymentRows'];
export const CLI = { ok: true, bin: '/oats', features: ['workspace-identity'], remote: ['roster'] };

/** The block's dependencies, real by default. */
export function viewDeps(state = {}) {
  return { ctxs: [], snapshot: { byWs: new Map() }, remoteGroups: [], remote, cliState: CLI, observing: new Set(), remoteCollecting: false,
    remoteIdentities: createRemoteIdentityStore({ file: null }), rosterAnswered: true, rosterFailure: null, homedir: () => '/Users/juan', basename,
    readIdentity, attachment, buildViews, deploymentReason, deploymentReasonParts, THIS_MACHINE, shortPath, deploymentLabel, deploymentUnavailableText, teamMembers, ...state };
}
export function loadViews(state = {}) {
  const deps = viewDeps(state);
  return new Function(...Object.keys(deps), `${VIEWS_BLOCK}\nreturn { ${VIEW_FUNCTIONS.join(', ')} };`)(...Object.values(deps));
}

export const OATS = 'github.com/awebai/oats', LAB = 'github.com/x/lab', TSM = 'github.com/GreaterSkies/tsm';
export const identity = (key = OATS, team = 'aweb:oats') => ({ key, ref: `git:${key}`, keyFrom: 'workspace', standalone: false,
  defaultTeam: { label: 'default', team }, teams: { default: team }, teamsFrom: 'observed' });
/** Juan's deployments: two local deployments of oats, a loose local one; altair (oats) and vega (lab) remotes. */
export const A = '/Users/juan/Agents/oats', B = '/Users/juan/awebai/oats-v2', L = '/Users/juan/loose';
export const R = 'remote:altair:a1', V = 'remote:vega:v1';
export const V_OATS = viewId(OATS, 'aweb:oats'), V_LAB = viewId(LAB, 'aweb:lab'), V_TSM = viewId(TSM, 'gs:tsm');
export const row = (deployment, name, extra = {}) => ({ instance: name, agent: 'dev', agentsRoot: `${deployment}/agents`,
  home: `${deployment}/agents/dev/instances/${name}`, running: true, createdAt: '2026-10-01T00:00:00.000Z',
  identity: { alias: name, team: 'aweb:oats' }, team: null, tmux: { session: 'oats', window: name }, ...extra });
export const observed = (id, ws, rows) => ({
  deployment: { status: 'observed', root: `${id}/agents`, workspace: { name: basename(id) },
    workspaceStatus: { clones: [{ key: `clone:${basename(id)}`, path: `${id}/clone` }] },
    reachable: ws === undefined ? null : ws, withheld: [], souls: [{ name: 'dev' }], catalog: { souls: [] }, catalogKey: 'k' },
  instances: rows, generatedAt: `2026-10-02T09:00:0${basename(id).length % 10}.000Z`, observedAt: '2026-10-02T08:59:00.000Z' });
export const unavailable = () => ({ deployment: { status: 'unavailable', reason: { code: 'E_CLI_FAILED', message: 'boom' } }, instances: [],
  generatedAt: '2026-10-02T09:00:00.000Z' });
export const remoteRow = (name, root, extra = {}) => ({ instance: name, agent: 'dev', agentsRoot: `${root}/agents`, home: `${root}/agents/dev/instances/${name}`,
  running: true, savedRoute: false, addressable: true, missingRemotely: false, createdAt: null, identity: { alias: name, team: 'aweb:oats' }, ...extra });
export const group = (id, server, root, ws, instances = [], extra = {}) => ({ id, server, label: server, registrationPresent: true,
  target: { sshHost: `${server}.lan`, workspace: root }, probe: { ok: true }, agentsRoot: `${root}/agents`,
  workspace: ws === null ? null : { reachable: true, ...ws }, souls: [], instances, retireFailures: [], ...extra });

/** Juan's state: `{ altair, vega, state }`, `state` ready for loadViews / viewDeps (overrides win). */
export function juanState(over = {}) {
  const altair = group('altair:a1', 'altair', '/home/juan/oats', identity(), [remoteRow('far-a', '/home/juan/oats')]);
  const vega = group('vega:v1', 'vega', '/srv/lab', identity(LAB, 'aweb:lab'), [remoteRow('lab-a', '/srv/lab', { identity: { alias: 'lab-a', team: 'aweb:lab' } })]);
  const remoteGroups = over.remoteGroups ?? [altair, vega];
  const byWs = new Map([
    [A, observed(A, { reachable: true, ...identity() }, [row(A, 'dev-a'), row(A, 'idle', { running: false })])],
    [B, observed(B, { reachable: true, ...identity() }, [row(B, 'dev-b')])],
    [L, unavailable()],
    ...remoteGroups.map(g => [`remote:${g.id}`, remote.remotePanel(g)]),
  ]);
  return { altair, vega, state: { ctxs: [A, B, L], snapshot: { byWs }, remoteGroups, ...over } };
}
export function juan(over = {}) {
  const { altair, vega, state } = juanState(over);
  return { altair, vega, views: loadViews(state) };
}
export const tag = (id, machine, path) => ({ id, machine, path });

/* The shipped HTTP handler over the real views block, the instance lookup and the error shaping. */
export const FINDINST_BLOCK = between('/* OATSWEB_FINDINST_BEGIN', '/* OATSWEB_FINDINST_END */');
export const SPAWNERR_BLOCK = between('function spawnErrorPayload(e)', '/* OATSWEB_SPAWNERR_END */');
export const HANDLER = between('const send = (res, code, body, type', '\nserver.on("error",');
/** `{ views, request }`: `request({ url, method, body, headers })` resolves `{ status, headers, body }`.
 * `extra` supplies the handler's other free names (doubles); the views' state comes from `state`. */
export async function loadServer(state = {}, extra = {}) {
  const { EventEmitter } = await import('node:events');
  const deps = { ...viewDeps(state), createServer: fn => fn, ...extra };
  const { server, views } = new Function(...Object.keys(deps),
    `${VIEWS_BLOCK}\n${FINDINST_BLOCK}\n${SPAWNERR_BLOCK}\n${HANDLER}\nreturn { server, views: { ${VIEW_FUNCTIONS.join(', ')} } };`)(...Object.values(deps));
  async function request({ url, method = 'GET', body, headers = { host: '127.0.0.1:4820', origin: 'http://localhost:4820' } }) {
    const req = new EventEmitter(); Object.assign(req, { url, method, headers }); let result;
    const res = { writeHead(status, h) { result = { status, headers: h }; }, end(text) { result.body = JSON.parse(text); } };
    const done = server(req, res);
    if (body !== undefined) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    req.emit('end'); await done; return result;
  }
  return { views, request };
}
