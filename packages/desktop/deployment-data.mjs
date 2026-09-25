/** Native kernel JSON → bounded public observations. This module has no I/O.
 * It does not resolve a deployment, read metadata, infer drift, or reproduce
 * any kernel lifecycle/trust logic. Producer shapes remain command-specific. */
import { dirname, basename, join, isAbsolute, resolve } from 'node:path';
import { deploymentRecord as record } from './renderer/deployment-contract.mjs';
const text = value => typeof value === 'string' && value.length <= 8192 && !value.includes('\0');
const absolute = value => text(value) && isAbsolute(value) && resolve(value) === value;
const own = (value, key) => Object.hasOwn(value, key);
const bad = (code = 'E_CLI_PROTOCOL') => { throw Object.assign(new Error(code), { code }); };
const check = (condition, code) => { if (!condition) bad(code); };
const array = (value, limit = 2000) => { check(Array.isArray(value) && value.length <= limit); return value; };
const strings = value => array(value).map(v => { check(text(v)); return v; });
function fields(value, names) {
  check(record(value));
  const out = {};
  for (const key of names) if (own(value, key)) { check(value[key] === null || text(value[key])); out[key] = value[key]; }
  return out;
}
function flags(value, names, into) {
  for (const key of names) if (own(value, key)) { check(typeof value[key] === 'boolean'); into[key] = value[key]; }
  return into;
}
function source(value) {
  return fields(value, ['kind', 'package', 'version', 'commit', 'integrity', 'repoKey']);
}
function soulSource(value) {
  return value === null ? null : fields(value, ['repoKey', 'commit', 'current', 'status', 'path']);
}
function modules(value) {
  if (Array.isArray(value)) return array(value).map(row => {
    const out = fields(row, ['name', 'commit', 'status', 'reason']);
    check(text(row.name) && row.name.length > 0);
    if (own(row, 'from')) out.from = source(row.from);
    if (own(row, 'current')) out.current = row.current === null ? null : fields(row.current, ['commit', 'version']);
    return out;
  });
  // Native v2's offline result is the recorded map, NOT live drift rows.
  // Preserve that distinction; never fabricate "current" or convert it into
  // a claimed online observation just because a commit was recorded.
  check(record(value)); check(Object.keys(value).length <= 2000);
  return Object.fromEntries(Object.entries(value).map(([name, row]) => {
    check(text(name) && name.length > 0);
    const out = fields(row, ['commit', 'digest', 'materializedAt']);
    if (own(row, 'from')) out.from = source(row.from);
    return [name, out];
  }));
}
function servedIdentity(value) {
  if (value === null) return null;
  const out = fields(value, ['mode', 'alias', 'team', 'address', 'resident', 'provider']);
  if (own(value, 'grant')) {
    out.grant = fields(value.grant, ['id', 'expiresAt']);
    if (own(value.grant, 'scopes')) out.grant.scopes = strings(value.grant.scopes);
  }
  return out;
}
function recordedWorkspace(value) {
  const out = fields(value, ['key', 'commit', 'resolution']);
  flags(value, ['standalone'], out);
  if (own(value, 'soul')) out.soul = fields(value.soul, ['id', 'repoKey', 'commit', 'team']);
  return out;
}

/** workspace status is the sole header authority (lock current / out of
 * date). Declaring a package in `packages:` is the trust decision, so there
 * is no approval state to read. No inspect.scope dependency. */
export function workspaceStatusData(document, deployment) {
  check(absolute(deployment), 'E_BAD_ARGS');
  check(record(document) && document.schemaVersion === 1 && document.ok === true);
  const data = document.result;
  check(record(data) && data.workspaceStatusApi === 1);
  check(record(data.workspace) && absolute(data.workspace.local));
  check(data.workspace.local === join(deployment, 'oats-local.yaml'), 'E_DEPLOYMENT_SCOPE');
  const workspace = fields(data.workspace, ['name', 'key', 'url', 'commit', 'observedAt', 'local']);
  check(text(workspace.name) && text(workspace.key));
  if (own(data.workspace, 'teams')) workspace.teams = strings(data.workspace.teams);
  const members = array(data.members).map(memberRow);
  const packages = array(data.packages).map(packageRow);
  return flags(data, ['standalone'], { workspaceStatusApi: 1, workspace, members, packages,
    declaredPackages: strings(data.declaredPackages), unsynced: strings(data.unsynced), stale: strings(data.stale),
    external: array(data.external).map(row => fields(row, ['source', 'soul', 'team'])),
    problems: problemRows(data.problems), // warnings[] since kernel #185 (for example an unmapped team label); absent before.
    warnings: own(data, 'warnings') ? array(data.warnings).map(row => fields(row, ['code', 'message', 'label', 'soul', 'repoKey'])) : [] });
}

/** status stays a native {root,agents,workspace} observation. No task/state
 * parsing, file counts, runtime defaults, metadata hydration or v1 card DTO.
 * Liveness here is the kernel's report; terminal-target observation is a
 * separate v2-agnostic Desktop concern. */
const inside = (path, parent) => path.startsWith(parent.endsWith('/') ? parent : parent + '/');
function sessionTarget(value) {
  check(record(value));
  const out = fields(value, ['backend', 'socket', 'paneId', 'terminalId']);
  if (own(value, 'protocol')) { check(Number.isSafeInteger(value.protocol)); out.protocol = value.protocol; }
  return out;
}
export function deploymentStatusData(document, deployment) {
  check(absolute(deployment), 'E_BAD_ARGS'); check(record(document));
  check(document.root === join(deployment, 'agents'), 'E_DEPLOYMENT_SCOPE');
  const root = document.root;
  const seenHomes = new Set(), seenSouls = new Set(), withheld = [];
  const agents = array(document.agents).map(agent => {
    check(record(agent) && text(agent.name) && agent.name.length > 0 && absolute(agent.dir));
    // Every soul directory the kernel reports must belong to the selected
    // deployment. The Desktop does not name or search any layout itself.
    check(inside(agent.dir, deployment), 'E_DEPLOYMENT_SCOPE');
    check(!seenSouls.has(agent.dir)); seenSouls.add(agent.dir);
    const out = fields(agent, ['name', 'description', 'work', 'runtime', 'model', 'backend', 'team', 'dir', 'kind', 'repo', 'capability', 'color', 'launch-config']);
    if (own(agent, 'yolo')) { check(agent.yolo === null || typeof agent.yolo === 'boolean'); out.yolo = agent.yolo; }
    if (own(agent, 'soulSource')) out.soulSource = soulSource(agent.soulSource);
    if (own(agent, 'retireFailures')) out.retireFailures = array(agent.retireFailures).map(row => fields(row, ['instance', 'completedAt', 'error', 'resultPath']));
    out.instances = array(agent.instances, 10000).flatMap(instance => {
      check(record(instance) && text(instance.instance) && instance.instance.length > 0 && absolute(instance.home));
      // A row whose reported home is not <soul dir>/instances/<instance>, or
      // that repeats another row's home, is WITHHELD — never acted on, never
      // silently dropped: the count and reason reach the header.
      if (dirname(instance.home) !== join(agent.dir, 'instances') || basename(instance.home) !== instance.instance) {
        withheld.push({ agent: agent.name, instance: instance.instance, reason: 'home-outside-soul' }); return [];
      }
      if (seenHomes.has(instance.home)) { withheld.push({ agent: agent.name, instance: instance.instance, reason: 'duplicate-home' }); return []; }
      check(seenHomes.size < 10000); seenHomes.add(instance.home);
      const row = fields(instance, ['instance', 'agent', 'home', 'repo', 'work', 'branch', 'runtime', 'model', 'createdAt',
        'parentInstance', 'siblingInstance', 'relation', 'relativeTo', 'runtimeState', 'runtimeError', 'spawnOrigin', 'capability']);
      for (const key of ['running', 'launched', 'captured']) if (own(instance, key)) {
        check(instance[key] === null || typeof instance[key] === 'boolean'); row[key] = instance[key];
      }
      if (own(instance, 'tmux')) row.tmux = instance.tmux === null ? null : fields(instance.tmux, ['session', 'window', 'socket']);
      if (own(instance, 'sessionTarget')) row.sessionTarget = sessionTarget(instance.sessionTarget);
      if (own(instance, 'retirePending')) row.retirePending = true;
      if (own(instance, 'rollbackIncomplete')) row.rollbackIncomplete = true;
      if (own(instance, 'modules')) row.modules = modules(instance.modules);
      if (own(instance, 'soul')) row.soul = soulSource(instance.soul);
      if (own(instance, 'workspace')) row.workspace = recordedWorkspace(instance.workspace);
      // Missing identity is the producer's absent fact, not a fabricated null
      // principal or a name/address guessed from the instance/soul.
      if (own(instance, 'identity')) row.identity = servedIdentity(instance.identity);
      return [row];
    });
    return out;
  });
  const out = { root, agents, withheld };
  if (own(document, 'workspace')) {
    out.workspace = fields(document.workspace, ['code', 'reason', 'message']);
    flags(document.workspace, ['reachable'], out.workspace);
  }
  return out;
}

/* ── Workspace model v2 catalog, sync and onboarding (F2) ───────────────
   Command-specific shapes, projected once where they are read. The kernel's
   rows are kept verbatim within bounds; nothing is joined, inferred or
   re-derived (members' publishes and package capabilities stay distinct —
   the non-collapse rule). */
function memberRow(row) {
  const out = fields(row, ['key', 'name', 'commit', 'status', 'detail', 'team']);
  check(text(out.key)); flags(row, ['confirmed'], out);
  for (const key of ['souls', 'capabilities']) if (own(row, key)) out[key] = strings(row[key]);
  if (own(row, 'publishes')) out.publishes = row.publishes === null ? null : fields(row.publishes, ['package', 'version']);
  return out;
}
function packageRow(row) {
  const out = fields(row, ['id', 'version', 'source', 'commit', 'integrity']); check(text(out.id));
  if (own(row, 'capabilities')) out.capabilities = strings(row.capabilities);
  return out;
}
const problemRows = value => array(value).map(row => fields(row, ['code', 'message', 'repoKey', 'path']));

/** `oats sync --json` (syncApi 1): the lock it wrote and what changed. */
export function syncData(document, deployment) {
  check(absolute(deployment), 'E_BAD_ARGS');
  check(record(document) && document.schemaVersion === 1 && document.ok === true);
  const data = document.result;
  check(record(data) && data.syncApi === 1 && record(data.workspace));
  check(data.workspace.local === join(deployment, 'oats-local.yaml'), 'E_DEPLOYMENT_SCOPE');
  const workspace = fields(data.workspace, ['name', 'key', 'url', 'commit', 'observedAt', 'local', 'lock']);
  check(text(workspace.name) && text(workspace.key));
  return flags(data, ['standalone'], { syncApi: 1, workspace,
    members: array(data.members).map(memberRow), packages: array(data.packages).map(packageRow),
    changes: array(data.changes).map(row => { const out = fields(row, ['id', 'from', 'to', 'commit']); check(text(out.id)); return out; }),
    problems: problemRows(data.problems) });
}

/** `oats capabilities --json` (capabilitiesApi 1): every non-private item of
 * every confirmed member, external souls' and locked packages' capabilities. */
export function capabilitiesData(document) {
  check(record(document) && document.schemaVersion === 1 && document.ok === true);
  const data = document.result;
  check(record(data) && data.capabilitiesApi === 1);
  const workspace = fields(data.workspace, ['name', 'key', 'commit']);
  const capabilities = array(data.capabilities).map(row => {
    const out = fields(row, ['name', 'origin', 'kind', 'repoKey', 'commit', 'team', 'path', 'layer', 'version', 'package']);
    check(text(out.name) && out.name.length > 0 && ['member', 'package', 'external'].includes(out.kind));
    return flags(row, ['private'], out);
  });
  return { capabilitiesApi: 1, workspace, capabilities, problems: problemRows(data.problems) };
}

/** `oats souls --json` (soulsApi 1): the deployment's spawn catalog — every
 * non-private soul of a confirmed member, and external souls, with the work
 * mode each declares. Names are unique per catalog (the kernel refuses an
 * ambiguous bare name with E_SOUL_AMBIGUOUS; such a soul is not offered). */
const SOUL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
export function soulsData(document) {
  check(record(document) && document.schemaVersion === 1 && document.ok === true);
  const data = document.result;
  check(record(data) && data.soulsApi === 1);
  const workspace = fields(data.workspace, ['name', 'key', 'commit']);
  const seen = new Map();
  for (const row of array(data.souls)) {
    const out = fields(row, ['name', 'origin', 'kind', 'repoKey', 'commit', 'team', 'path', 'work', 'description']);
    check(SOUL_NAME.test(out.name ?? '') && ['member', 'external'].includes(out.kind)
      && ['worktree', 'checkout', 'directory', 'workspace', 'attached'].includes(out.work));
    flags(row, ['private'], out);
    seen.set(out.name, seen.has(out.name) ? null : out);
  }
  const souls = [...seen.values()].filter(Boolean);
  const ambiguous = [...seen].filter(([, row]) => row === null).map(([name]) => name);
  return { soulsApi: 1, workspace, souls, ambiguous, problems: problemRows(data.problems) };
}

/** `oats onboard --json` (onboardApi 2) for the directory the operator chose. */
export function onboardData(document, dir) {
  check(absolute(dir), 'E_BAD_ARGS');
  check(record(document) && document.schemaVersion === 1 && document.ok === true);
  const data = document.result;
  check(record(data) && data.onboardApi === 2 && data.dir === dir, 'E_DEPLOYMENT_SCOPE');
  check(data.local === join(dir, 'oats-local.yaml'), 'E_DEPLOYMENT_SCOPE');
  const out = fields(data, ['local', 'dir', 'agents', 'lock']);
  out.sync = syncData({ schemaVersion: 1, ok: true, result: data.sync }, dir);
  if (own(data, 'hosting')) { out.hosting = fields(data.hosting, ['host', 'rule']); flags(data.hosting, ['hostIsMember'], out.hosting); }
  check(record(data.next));
  out.next = { clone: array(data.next.clone).map(row => flags(row, ['present', 'host'], fields(row, ['key', 'name', 'url', 'dir']))),
    spawn: data.next.spawn === null || data.next.spawn === undefined ? null : (check(text(data.next.spawn)), data.next.spawn),
    souls: own(data.next, 'souls') ? strings(data.next.souls) : [] };
  return out;
}
