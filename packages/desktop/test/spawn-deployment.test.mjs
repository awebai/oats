// #482 (decision Q2): the spawn dialog's Deployment field. With two or more deployments in the view the
// dialog asks which one; availability is the chosen deployment's own catalog; the default is the last used
// in this view if it has the soul, else the first that has it (local before remote), else the last used
// (blocked, saying why). Every spawn request addresses the chosen deployment; jobs are owned by the view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountSpawn, settle, catalogAgents, deferred, DEPLOYMENT, ROOT } from './helpers/spawn-dialog-host.mjs';
import { anchor } from './helpers/spawn-preview-fixture.mjs';
import { createSpawnDeploymentField, defaultSpawnDeployment, catalogSoul, lastSpawnDeployment, rememberSpawnDeployment, spawnDeployments,
  SPAWN_DEPLOYMENT_KEY, SPAWN_DEPLOYMENT_VIEWS_MAX } from '../renderer/spawn-deployment-field.mjs';
import { createSpawnJobs } from '../renderer/spawn-jobs.mjs';
import { currentWorkspace } from '../renderer/views/common.mjs';

const A = DEPLOYMENT, B = '/fixture/other/northwind', R = 'remote:altair:k1';
const local = (id, label, extra = {}) => ({ id, machine: 'This Mac', path: id, label, local: true, reachable: true, identityFrom: 'reported', primary: false, ...extra });
const DA = local(A, '…/base/northwind-workspace', { primary: true }), DB = local(B, '…/other/northwind');
const DR = { id: R, machine: 'altair', path: '/Users/juan/Agents/tsm', label: '~/Agents/tsm', local: false, reachable: true, identityFrom: 'reported', primary: false };
const remoteSoul = { name: 'release-manager', description: '', kind: 'persistent', work: 'worktree', agentsRoot: '/srv/agents', server: 'altair', remote: true, repoName: 'altair' };
const memory = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
const wsOf = path => decodeURIComponent(/[?&]ws=([^&]*)/.exec(path)?.[1] ?? '');
const previewWs = u => u.calls.filter(c => c.path.startsWith('/api/workspace-spawn-preview')).map(c => wsOf(c.path));
const spawnWs = u => u.calls.filter(c => c.path.startsWith('/api/spawn?')).map(c => [wsOf(c.path), c.body.action]);
const options = u => [...u.q('.fdeployment').options].map(o => o.textContent);
async function choose(u, id) { await u.change('.fdeployment', id); await settle(); }

// ── the rules, alone ──────────────────────────────────────────────────────────────────────────────

test('default rule: last used if it has the soul, else the first that has it (local before remote), else the last used', () => {
  const list = [DR, DA, DB];
  const has = map => id => map[id] ?? null;
  assert.equal(defaultSpawnDeployment(list, { has: has({ [A]: true, [B]: true, [R]: true }), lastUsed: B }), B, 'the last used has it');
  assert.equal(defaultSpawnDeployment(list, { has: has({ [A]: true, [B]: false, [R]: true }), lastUsed: B }), A, 'else the first local that has it, before a remote listed first');
  assert.equal(defaultSpawnDeployment(list, { has: has({ [A]: false, [B]: false, [R]: true }), lastUsed: B }), R, 'a remote one when no local one has it');
  assert.equal(defaultSpawnDeployment(list, { has: has({ [A]: false, [B]: false, [R]: false }), lastUsed: B }), B, 'none has it: the last used (blocked)');
  assert.equal(defaultSpawnDeployment(list, { has: () => null }), A, 'nothing known, nothing used: the first local one');
  assert.equal(defaultSpawnDeployment([DR, { ...DR, id: 'remote:b:2' }], { has: () => null }), R, 'no local one: the first');
  assert.equal(defaultSpawnDeployment(list, { has: () => null, lastUsed: '/gone' }), A, 'a last used no longer in the view is ignored');
});

test('catalogSoul: the same root, else the one row of that name, else the one from the same repository; never a guess', () => {
  const soul = { name: 'dev', agentsRoot: '/a/agents', repoName: 'oats', soulKind: 'member' };
  assert.equal(catalogSoul([{ name: 'dev', agentsRoot: '/a/agents' }, { name: 'dev', agentsRoot: '/x' }], soul).agentsRoot, '/a/agents');
  assert.equal(catalogSoul([{ name: 'dev', agentsRoot: '/b/agents' }], soul).agentsRoot, '/b/agents');
  assert.equal(catalogSoul([{ name: 'dev', agentsRoot: '/b', repoName: 'oats', soulKind: 'member' }, { name: 'dev', agentsRoot: '/c', repoName: 'other', soulKind: 'member' }], soul).agentsRoot, '/b');
  assert.equal(catalogSoul([{ name: 'dev', agentsRoot: '/b' }, { name: 'dev', agentsRoot: '/c' }], soul), null, 'ambiguous: none');
  assert.equal(catalogSoul([{ name: 'qa', agentsRoot: '/a/agents' }], soul), null);
  assert.equal(catalogSoul('junk', soul), null);
});

test('last used: per view, deployment ids only, bounded to the most recent views', () => {
  const storage = memory();
  rememberSpawnDeployment('ws:one', B, storage);
  assert.equal(lastSpawnDeployment('ws:one', storage), B); assert.equal(lastSpawnDeployment('ws:two', storage), null);
  for (let i = 0; i < SPAWN_DEPLOYMENT_VIEWS_MAX + 5; i++) rememberSpawnDeployment(`ws:v${i}`, `/d/${i}`, storage);
  rememberSpawnDeployment('ws:v3', '/d/again', storage); // used again: the most recent
  const kept = JSON.parse(storage.getItem(SPAWN_DEPLOYMENT_KEY));
  assert.equal(Object.keys(kept).length, SPAWN_DEPLOYMENT_VIEWS_MAX);
  assert.equal(lastSpawnDeployment('ws:one', storage), null, 'the oldest view left');
  assert.equal(lastSpawnDeployment('ws:v3', storage), '/d/again');
  assert.ok(Object.values(kept).every(v => typeof v === 'string'), 'only ids');
  rememberSpawnDeployment('ws:bad', 'a\nb', storage); assert.equal(lastSpawnDeployment('ws:bad', storage), null, 'never a control character');
  storage.setItem(SPAWN_DEPLOYMENT_KEY, '{not json'); assert.equal(lastSpawnDeployment('ws:v3', storage), null, 'junk reads as nothing');
  assert.doesNotThrow(() => rememberSpawnDeployment('ws:x', B, { getItem: () => { throw Error('no'); }, setItem: () => { throw Error('no'); } }));
  assert.deepEqual(spawnDeployments([DA, DA, null, { id: '' }, DB]).map(d => d.id), [A, B], 'duplicates and junk are dropped');
});

test('the field: none with one deployment; options labelled by machine; marks a deployment without the soul; catalog replies follow the latest intent', async () => {
  const dom = new JSDOM('<!doctype html><body></body>'), doc = dom.window.document;
  const soul = { name: 'release-manager', agentsRoot: ROOT };
  assert.equal(createSpawnDeploymentField(doc, { soul, viewId: 'v', deployments: [DA], read: async () => [] }), null, 'one deployment: no field');
  assert.equal(createSpawnDeploymentField(doc, { soul, viewId: 'v', deployments: [], read: async () => [] }), null);
  const gates = new Map(), changes = [];
  const read = id => { const d = deferred(); gates.set(id, [...(gates.get(id) || []), d]); return d.promise; };
  const field = createSpawnDeploymentField(doc, { soul, viewId: 'v', deployments: [DR, DA, { ...DB, reachable: false }], read, storage: memory(), onChange: c => changes.push(c) });
  const label = field.select.closest('label');
  assert.equal(label.textContent.startsWith('Deployment'), true, 'a labelled control');
  assert.equal(field.select.getAttribute('aria-describedby'), field.hint.id);
  assert.equal(field.value(), A, 'provisional: the first local one');
  assert.equal(field.pending(), true);
  field.start(); await settle();
  gates.get(R)[0].resolve([remoteSoul]); gates.get(A)[0].resolve([]); gates.get(B)[0].resolve([]);
  await settle();
  assert.deepEqual([...field.select.options].map(o => o.textContent),
    ['altair · ~/Agents/tsm', 'This Mac · …/base/northwind-workspace (no release-manager here)', 'This Mac · …/other/northwind (not reached)']);
  assert.equal(field.value(), R, 'only the remote deployment has it');
  assert.deepEqual(changes, [{ moved: true, programmatic: true }]);
  assert.equal(field.server(), 'altair'); assert.deepEqual(field.selector(), { soul: 'release-manager', agentsRoot: '/srv/agents' });
  field.select.value = A; field.select.dispatchEvent(new dom.window.Event('change'));
  assert.equal(field.blocked(), true); assert.equal(field.blockText(), "release-manager isn't available on This Mac");
  assert.equal(field.hint.textContent, "release-manager isn't available on This Mac."); assert.ok(field.hint.classList.contains('err'));
  // A newer read supersedes an older one; after dispose nothing lands.
  field.start(); field.start(); await settle();
  for (const id of [A, B, R]) gates.get(id)[2].resolve(id === R ? [remoteSoul] : []);
  await settle();
  assert.equal(field.blocked(), true, 'the latest read: A has no release-manager');
  gates.get(A)[1].resolve([{ name: 'release-manager', agentsRoot: ROOT }]); await settle();
  assert.equal(field.blocked(), true, 'a superseded catalog reply never applies');
  const heard = changes.length;
  field.start(); await settle(); field.dispose();
  for (const id of [A, B, R]) gates.get(id)[3].resolve([{ name: 'release-manager', agentsRoot: ROOT }]); await settle();
  assert.equal(changes.length, heard, 'nothing is heard after dispose');
  assert.equal(field.select.options[1].textContent, 'This Mac · …/base/northwind-workspace', 'nor painted (still read as unknown)');
  dom.window.close();
});

// ── the dialog ────────────────────────────────────────────────────────────────────────────────────

test('one deployment: no Deployment field, nothing new on screen, and the spawn routes address that deployment (pin)', async t => {
  const u = await mountSpawn(t, { deployments: [DA] });
  await u.open();
  assert.equal(u.q('.fdeployment'), null, 'no field');
  assert.ok(u.q('.spawn-place'), 'Where to run stays where it was');
  assert.ok(previewWs(u).length > 0); assert.ok(previewWs(u).every(ws => ws === A), 'the deployment, never the view id');
  assert.equal(u.calls.filter(c => c.path.startsWith('/api/agents?ws=')).filter(c => wsOf(c.path) === A).length, 0, 'no catalog read per deployment');
});

test('two deployments: the field replaces Where to run, defaults to the first that has the soul, and a deployment without it blocks Spawn', async t => {
  const u = await mountSpawn(t, { deployments: [DA, DB], catalogs: { [A]: catalogAgents(), [B]: [] } });
  await u.open(); await settle();
  assert.ok(u.q('.fdeployment')); assert.equal(u.q('.spawn-place'), null, 'Where to run is replaced');
  assert.deepEqual(options(u), ['This Mac · …/base/northwind-workspace', 'This Mac · …/other/northwind (no release-manager here)']);
  assert.equal(u.q('.fdeployment').value, A);
  assert.equal(u.q('.fspawn').disabled, false);
  const before = previewWs(u).length;
  await choose(u, B);
  assert.equal(u.q('.fspawn').disabled, true, 'blocked');
  assert.equal(u.text('.fstatus'), "release-manager isn't available on This Mac.");
  assert.ok(u.q('.fstatus').classList.contains('err'));
  assert.equal(u.text('.spawn-deployment-hint'), "release-manager isn't available on This Mac.");
  assert.equal(previewWs(u).length, before, 'nothing is read for a deployment without the soul');
  await choose(u, A);
  assert.equal(previewWs(u).at(-1), A, 'back: re-read for that deployment');
  assert.equal(u.q('.fspawn').disabled, false);
});

test('a deployment change re-reads the preview there, and a reply for the previous deployment is discarded', async t => {
  const held = deferred(); let holdA = false;
  const u = await mountSpawn(t, { deployments: [DA, DB], catalogs: { [A]: catalogAgents(), [B]: catalogAgents() },
    previewGate: async (_body, ws) => { if (holdA && ws === A) await held.promise; } });
  await u.open(); await settle();
  holdA = true; await u.type('.fpurpose', 'docs'); // A's read for these choices is now held in the air
  const reads = previewWs(u).length;
  await choose(u, B);
  assert.equal(previewWs(u).at(-1), B); assert.ok(previewWs(u).length > reads);
  assert.equal(u.text('.fstatus'), 'Preview ready');
  held.resolve(); await settle();
  // The late reply of A changes nothing: Spawn prepares and applies at B.
  await u.spawn();
  assert.deepEqual(spawnWs(u), [[B, 'prepare'], [B, 'apply']]);
  assert.equal(u.applied.length, 1); assert.equal(u.applied[0].target.workspace, B);
});

test('local apply goes to ?ws=<deployment>; the last used is recorded per view and becomes the default', async t => {
  const u = await mountSpawn(t, { deployments: [DA, DB], catalogs: { [A]: catalogAgents(), [B]: catalogAgents() } });
  await u.open(); await settle();
  assert.equal(u.q('.fdeployment').value, A, 'nothing used yet: the first local one');
  await choose(u, B); await u.spawn();
  assert.deepEqual(spawnWs(u), [[B, 'prepare'], [B, 'apply']]);
  assert.deepEqual(JSON.parse(u.dom.window.localStorage.getItem(SPAWN_DEPLOYMENT_KEY)), { northwind: B }, 'per view: the view id keys the deployment id');
});

test('the default: last used when it has the soul, else the first with it; with none, the last used and a blocking message', async t => {
  const prime = (u, id) => u.dom.window.localStorage.setItem(SPAWN_DEPLOYMENT_KEY, JSON.stringify({ northwind: id }));
  const u = await mountSpawn(t, { deployments: [DA, DB], catalogs: { [A]: catalogAgents(), [B]: catalogAgents() } });
  prime(u, B); await u.open(); await settle();
  assert.equal(u.q('.fdeployment').value, B);
  assert.ok(previewWs(u).length > 0); assert.ok(previewWs(u).every(ws => ws === B), 'no read for the provisional choice before the catalogs answered');
});

test('the default when the last used lacks the soul: the first that has it; when none has it, the last used, blocked', async t => {
  const u = await mountSpawn(t, { deployments: [DA, DB], catalogs: { [A]: catalogAgents(), [B]: [] } });
  u.dom.window.localStorage.setItem(SPAWN_DEPLOYMENT_KEY, JSON.stringify({ northwind: B }));
  await u.open(); await settle();
  assert.equal(u.q('.fdeployment').value, A);
  assert.ok(previewWs(u).length > 0);
  assert.ok(previewWs(u).every(ws => ws === A), 'the provisional choice (the last used, B) is never read before the catalogs answered');
  const v = await mountSpawn(t, { deployments: [DA, DB], catalogs: { [A]: [], [B]: [] } });
  v.dom.window.localStorage.setItem(SPAWN_DEPLOYMENT_KEY, JSON.stringify({ northwind: B }));
  await v.open(); await settle();
  assert.equal(v.q('.fdeployment').value, B);
  assert.equal(v.q('.fspawn').disabled, true); assert.equal(v.text('.fstatus'), "release-manager isn't available on This Mac.");
  assert.equal(v.text('.spawn-preview-empty'), "release-manager isn't available on This Mac.");
});

test('relation anchors: the chosen deployment\'s rows only', async t => {
  const row = (instance, deployment, root = ROOT) => ({ ...anchor, instance, agentsRoot: root, home: `${root}/release-manager/instances/${instance}`, running: true,
    createdAt: 'first', tmux: { session: 's', window: 'w' }, deployment: { id: deployment, machine: 'This Mac', path: deployment } });
  const u = await mountSpawn(t, { deployments: [DA, DB], catalogs: { [A]: catalogAgents(), [B]: catalogAgents() },
    instances: [row('on-a', A), row('on-b', B), { ...row('far', R, '/srv/agents'), server: 'altair' }] });
  await u.open(); await settle();
  const names = () => [...u.q('.frelto').options].map(o => o.value).filter(Boolean);
  assert.deepEqual(names(), ['on-a']);
  await choose(u, B); assert.deepEqual(names(), ['on-b']);
});

test('a remote deployment spawns through its server with its own catalog\'s root; the reply\'s view is this one, so no switch', async t => {
  const bodies = [];
  const u = await mountSpawn(t, { deployments: [DA, DR], catalogs: { [A]: catalogAgents(), [R]: [remoteSoul] },
    remote: body => { bodies.push(body); return { spawned: true, instance: 'release-manager-x', agent: 'release-manager', home: '/srv/agents/release-manager/instances/release-manager-x', server: 'altair', launched: true, workspaceId: 'northwind' }; } });
  await u.open(); await settle();
  assert.deepEqual(options(u), ['This Mac · …/base/northwind-workspace', 'altair · ~/Agents/tsm'], 'remote ones are named by their machine');
  const reads = previewWs(u).length;
  await choose(u, R);
  assert.equal(previewWs(u).length, reads, 'the host decides a remote spawn: no local preview');
  assert.equal(u.text('.spawn-preview-empty'), 'Decided on altair when it spawns.');
  await u.spawn();
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].serverId, 'altair'); assert.equal(bodies[0].agentsRoot, '/srv/agents'); assert.equal(bodies[0].agent, 'release-manager');
  assert.equal(currentWorkspace(), 'northwind', 'the reply names this view: no switch');
  assert.equal(spawnWs(u).length, 0, 'never the local transaction');
});

test('background spawn: the job is owned by the view and addressed to the chosen deployment', async t => {
  const remembered = [];
  const u = await mountSpawn(t, { deployments: [DA, DB], catalogs: { [A]: catalogAgents(), [B]: catalogAgents() },
    jobs: { rememberDeployment: (view, deployment) => remembered.push([view, deployment]) } });
  await u.open(); await settle();
  await choose(u, B); await u.spawn();
  assert.equal(u.dialog(), null, 'handed off');
  const [row] = u.jobs.rows('northwind');
  assert.ok(row, 'the pending row belongs to the view'); assert.deepEqual(row.deployment, { id: B });
  assert.equal(u.jobs.get(row.id).workspace, 'northwind'); assert.equal(u.jobs.get(row.id).deployment, B);
  assert.equal(u.jobs.get(row.id).draft.restore.deployment, B, 'Reopen spawn chooses the same deployment again');
  assert.deepEqual(spawnWs(u), [[B, 'prepare'], [B, 'apply']]);
  assert.deepEqual(remembered, [['northwind', B]], 'created: the view\'s last used');
  // Created: the pending row stays until ITS deployment's row reports it (both deployments share these strings here).
  const real = deployment => ({ instance: row.instance, home: row.home, agentsRoot: ROOT, agent: 'release-manager', running: true, tmux: { session: 's' }, deployment: { id: deployment } });
  u.jobs.observe('northwind', [real(A)]);
  assert.equal(u.jobs.rows('northwind').length, 1, 'another deployment\'s identical row is not this spawn');
  u.jobs.observe('northwind', [real(A), real(B)]);
  assert.equal(u.jobs.rows('northwind').length, 0, 'its own deployment reports it');
});

// ── the store, alone ──────────────────────────────────────────────────────────────────────────────

test('spawn jobs: post addresses the deployment, ownership and storage keep the view, observe matches the deployment\'s row', async () => {
  const posts = [], storage = memory();
  const s = createSpawnJobs({ post: async (ws, body) => { posts.push([ws, body.action]); return new Promise(() => {}); }, notify: () => ({}), currentWorkspace: () => 'ws:v', storage });
  const decision = { instance: 'dev-a', home: '/b/agents/dev/instances/dev-a' };
  const id = s.submit({ token: {}, workspace: 'ws:v', deployment: '/b', soul: { name: 'dev', agentsRoot: '/a/agents' }, selector: { soul: 'dev', agentsRoot: '/b/agents' }, input: { action: 'prepare' }, decision });
  await settle();
  assert.deepEqual(posts, [['/b', 'prepare']]);
  assert.equal(s.inFlight('ws:v', { name: 'dev', agentsRoot: '/a/agents' })?.id, id, 'in flight in the view');
  assert.equal(s.rows('/b').length, 0); assert.equal(s.rows('ws:v').length, 1);
  // Without a deployment, the view addresses it (as before).
  const t = createSpawnJobs({ post: async (ws) => { posts.push([ws]); return new Promise(() => {}); }, notify: () => ({}) });
  t.submit({ token: {}, workspace: '/w', soul: { name: 'dev', agentsRoot: '/w/agents' }, selector: { soul: 'dev', agentsRoot: '/w/agents' }, input: {}, decision });
  await settle(); assert.deepEqual(posts.at(-1), ['/w']);
  // Recovery keeps the deployment.
  storage.setItem('oats.spawnJobs.v1', JSON.stringify([{ workspace: 'ws:v', deployment: '/b', spawnRef: 'r1', soul: { name: 'dev', agentsRoot: '/a/agents' },
    selector: { soul: 'dev', agentsRoot: '/b/agents' }, instance: 'dev-b', home: '/b/agents/dev/instances/dev-b', placement: {}, startedAt: 1 }]));
  const recovered = [];
  const r = createSpawnJobs({ post: async (ws, body) => { recovered.push([ws, body.action]); return new Promise(() => {}); }, notify: () => ({}), storage });
  assert.equal(r.recover(), 1); await settle();
  assert.deepEqual(recovered, [['/b', 'result']]);
  assert.equal(r.rows('ws:v')[0].deployment.id, '/b');
});
