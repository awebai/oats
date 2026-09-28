/** Team model v2 (feature team-model-2): the deployment's teams and a soul's teams, through the
 * kernel verbs `oats teams` and `oats soul teams`. The kernel is the only writer of
 * oats-local.yaml; this boundary validates the request, runs the verb (argv only), decodes the
 * document, and passes kernel refusals through with their details. Local workspaces only. */
import { isAbsolute } from 'node:path';
import { cliTeams, cliSoulTeams } from '../cli-adapter.mjs';
import { teamsData, soulTeamsData } from '../deployment-data.mjs';

// The answer shape is the lead's (0.30 D2 review): {status: 'ok', teams | soulTeams: <the decoded
// kernel result>}; a refusal is {status: 'refused', reason: {code, message, details?}}, the
// kernel's code and message verbatim, and the Desktop's own codes with a plain message.
const MESSAGES = { E_BAD_ARGS: 'Invalid teams request', E_TEAMS_UNAVAILABLE: 'This OATS CLI has no team model v2 (feature team-model-2, OATS 0.30)',
  'unsupported-remote-operation': 'Teams are edited on the computer that runs the workspace', E_WORKSPACE_UNKNOWN: 'Select a known workspace',
  E_BUSY: 'Another team change is in progress; try again', E_CLI_PROTOCOL: 'The OATS CLI answered in an unexpected shape',
  E_DEPLOYMENT_SCOPE: 'The OATS CLI answered for another deployment', E_CLI_FAILED: 'The OATS CLI failed' };
const TEAM_ACTIONS = ['list', 'add', 'remove', 'default'], SOUL_ACTIONS = ['show', 'add', 'remove', 'default', 'clear-default'];
const TEAM_CODES = new Set(['E_TEAM_IN_USE', 'E_TEAM_SHARED', 'E_TEAM_EXISTS', 'E_TEAM_UNKNOWN', 'E_TEAM_NOT_ELIGIBLE']);
const CODE = /^(?:E_[A-Z0-9_]{1,62}|[a-z][a-z0-9-]{1,63})$/, LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);

/** A kernel team refusal's details, bounded and closed: the label, where it is used/defined. */
function refusalDetails(code, d) {
  if (!TEAM_CODES.has(code) || !record(d)) return undefined;
  const out = {};
  if (LABEL.test(d.label ?? '')) out.label = d.label;
  if (Array.isArray(d.usedBy) && d.usedBy.length <= 256 && d.usedBy.every(u => text(u, 300) && /^(?:defaultTeam|souls\.(?:teams|default):.+)$/.test(u))) out.usedBy = [...d.usedBy];
  for (const k of ['at', 'from', 'soul']) if (text(d[k], 512)) out[k] = d[k];
  return Object.keys(out).length ? out : undefined;
}
export function teamsFailure(code, message, details) {
  const c = CODE.test(code ?? '') ? code : 'E_CLI_FAILED';
  const said = text(message, 512) ? message : MESSAGES[c] ?? `The OATS CLI refused the request (${c})`;
  return { status: 'refused', reason: { code: c, message: said, ...(refusalDetails(c, details) ? { details: refusalDetails(c, details) } : {}) } };
}
function admit({ workspace: w, cli } = {}) {
  if (!w || typeof w.id !== 'string' || !w.id || typeof w.scope !== 'string' || !isAbsolute(w.scope)) return 'E_WORKSPACE_UNKNOWN';
  if (w.remote || w.server) return 'unsupported-remote-operation';
  if (!cli?.bin || !Array.isArray(cli.features) || !cli.features.includes('team-model-2')) return 'E_TEAMS_UNAVAILABLE';
  return null;
}
const keysOnly = (v, allowed) => Object.keys(v).every(k => allowed.includes(k));
/** { action: list|add|remove|default, label?, team?, description? } → cliTeams arguments. */
function teamsArgs(r) {
  if (!record(r) || !TEAM_ACTIONS.includes(r.action) || !keysOnly(r, ['action', 'label', 'team', 'description'])) return null;
  const { action, label, team, description } = r;
  return { action, ...(label !== undefined ? { label } : {}), ...(team !== undefined ? { team } : {}), ...(description !== undefined ? { description } : {}) };
}
/** { action: show|add|remove|default|clear-default, soul, labels?, label? } → cliSoulTeams arguments. */
function soulTeamsArgs(r) {
  if (!record(r) || !SOUL_ACTIONS.includes(r.action) || typeof r.soul !== 'string' || !keysOnly(r, ['action', 'soul', 'labels', 'label'])) return null;
  const { action, soul, labels, label } = r;
  const needsLabels = action === 'add' || action === 'remove', needsLabel = action === 'default';
  if (needsLabels !== (labels !== undefined) || needsLabel !== (label !== undefined)) return null;
  return { soul, ...(action === 'add' ? { add: labels } : {}), ...(action === 'remove' ? { remove: labels } : {}),
    ...(needsLabel ? { defaultLabel: label } : {}), ...(action === 'clear-default' ? { clearDefault: true } : {}) };
}

export function createTeamsBoundary({ teams = cliTeams, soulTeams = cliSoulTeams } = {}) {
  const writing = new Set(); // one mutation per deployment at a time; the kernel serializes the file
  const run = async (request, getContext, { args, invoke, decode, read, key }) => {
    try {
      const parsed = args(request);
      if (!parsed) return teamsFailure('E_BAD_ARGS');
      const context = getContext(), refused = admit(context);
      if (refused) return teamsFailure(refused);
      const { workspace, cli } = context, mutation = !read(request);
      if (mutation && writing.has(workspace.id)) return teamsFailure('E_BUSY');
      if (mutation) writing.add(workspace.id);
      try {
        const envelope = await invoke(cli.bin, { ...parsed, workspaceDir: workspace.scope });
        if (envelope?.schemaVersion !== 1 || envelope.ok !== true) return teamsFailure(envelope?.error?.code, envelope?.error?.message, envelope?.error?.details);
        let data;
        try { data = decode(envelope, workspace.scope); } catch (e) { return teamsFailure(e?.code === 'E_DEPLOYMENT_SCOPE' ? e.code : 'E_CLI_PROTOCOL'); }
        return { status: 'ok', [key]: data };
      } finally { if (mutation) writing.delete(workspace.id); }
    } catch { return teamsFailure('E_CLI_FAILED'); }
  };
  return {
    teams: (request, getContext) => run(request, getContext, { args: teamsArgs, invoke: teams, decode: (e, dir) => teamsData(e, dir), read: r => r.action === 'list', key: 'teams' }),
    soulTeams: (request, getContext) => run(request, getContext, { args: soulTeamsArgs, invoke: soulTeams, decode: e => soulTeamsData(e), read: r => r.action === 'show', key: 'soulTeams' }),
  };
}
const boundary = createTeamsBoundary();
export const teamsRequest = boundary.teams, soulTeamsRequest = boundary.soulTeams;
