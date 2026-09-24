// Workspace model v2 verbs (F2): fixed argv, exit semantics, refusal
// projection, projectors and the server's approval binding — all against
// kernel-captured fixtures (test/fixtures/workspace-v2/f2, provenance.json).
// No CLI, network, GUI or native process is launched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { cliWorkspace, workspaceArgv, validWorkspaceRef, WORKSPACE_READ_TIMEOUT, WORKSPACE_WRITE_TIMEOUT, WORKSPACE_MAX_BUFFER } from '../workspace-cli.mjs';
import { syncData, capabilitiesData, onboardData } from '../deployment-data.mjs';
import { createWorkspaceSyncBoundary } from '../server/workspace-sync.mjs';

const file = name => new URL(`./fixtures/workspace-v2/f2/${name}.json`, import.meta.url);
const fixture = name => JSON.parse(readFileSync(file(name), 'utf8'));
const provenance = fixture('provenance');
const deployment = '/fixture/base/northwind-workspace';
const cli = () => ({ ...fixture('version'), ok: true, bin: '/fixture/bin/oats' });
const exitError = code => Object.assign(new Error(`exit ${code}`), { code });
/** Replays a captured document with the exit the kernel produced. */
const replay = name => (_bin, _argv, _options, done) => {
  const exit = provenance.files[name].exit;
  done(exit ? exitError(exit) : null, JSON.stringify(fixture(name)));
};

test('F2 fixtures are kernel documents with recorded argv, exit and hashes', () => {
  assert.equal(provenance.kernel, fixture('version').version);
  for (const [name, entry] of Object.entries(provenance.files)) {
    assert.equal(createHash('sha256').update(readFileSync(file(name))).digest('hex'), entry.fixtureSha256, name);
    assert.equal(entry.argv.at(-1), '--json'); assert.equal(entry.kernel, provenance.kernel);
  }
  assert.equal(provenance.files['sync-pending'].exit, 2, 'exit 2 = lock written, approvals pending');
  assert.equal(provenance.files['onboard-pending'].exit, 2);
  assert.equal(provenance.files['sync-integrity'].exit, 1);
});

test('argv is fixed per verb; approvals pass the reported version verbatim', () => {
  assert.deepEqual(workspaceArgv({ action: 'capabilities', context: deployment }).argv, ['capabilities', '--dir', deployment, '--json']);
  assert.equal(workspaceArgv({ action: 'capabilities', context: deployment }).timeout, WORKSPACE_READ_TIMEOUT);
  assert.deepEqual(workspaceArgv({ action: 'sync', context: deployment }).argv, ['sync', '--dir', deployment, '--json']);
  const pending = syncData(fixture('sync-pending'), deployment).approvalNeeded;
  const approve = workspaceArgv({ action: 'approve', context: deployment, approvals: pending.map(({ id, version }) => ({ id, version })) });
  assert.deepEqual(approve.argv, ['sync', '--dir', deployment, ...pending.flatMap(row => ['--approve', `${row.id}@${row.version}`]), '--json']);
  assert.equal(approve.timeout, WORKSPACE_WRITE_TIMEOUT);
  assert.deepEqual(workspaceArgv({ action: 'onboard', dir: '/work/acme', workspace: 'github.com/acme/agents' }),
    { argv: ['onboard', '/work/acme', '--workspace', 'github.com/acme/agents', '--json'], cwd: '/work/acme', timeout: WORKSPACE_WRITE_TIMEOUT });
  // Nothing option-shaped, relative, duplicated or extra reaches argv.
  for (const bad of [
    { action: 'sync', context: 'relative' }, { action: 'sync', context: deployment, extra: 1 }, { action: 'list', context: deployment },
    { action: 'approve', context: deployment, approvals: [] }, { action: 'approve', context: deployment, approvals: [{ id: '--dir', version: '1' }] },
    { action: 'approve', context: deployment, approvals: [{ id: 'a', version: '1 2' }] },
    { action: 'approve', context: deployment, approvals: [{ id: 'a', version: '1' }, { id: 'a', version: '2' }] },
    { action: 'onboard', dir: '/work/acme', workspace: '--help' }, { action: 'onboard', dir: 'rel', workspace: 'x' },
    { action: 'onboard', dir: '/work/acme', workspace: 'a\nb' }, { action: 'onboard', dir: '/work/acme', workspace: ' padded' },
  ]) assert.equal(workspaceArgv(bad), null, JSON.stringify(bad));
  assert.equal(validWorkspaceRef('github.com/acme/agents'), true);
  assert.equal(validWorkspaceRef(''), false);
});

test('exec: bounded, no shell, scrubbed instance selectors, caller env untouched', async () => {
  const env = { KEEP: '1', OATS_INSTANCE_HOME: '/foreign', PI_AGENTS_ROOT: '/foreign', OATS_DEPLOYMENT: '/foreign' };
  const result = await cliWorkspace(cli(), { action: 'capabilities', context: deployment }, { env, exec(bin, argv, options, done) {
    assert.equal(bin, '/fixture/bin/oats'); assert.equal(options.shell, false); assert.equal(options.cwd, deployment);
    assert.equal(options.maxBuffer, WORKSPACE_MAX_BUFFER); assert.deepEqual(options.env, { KEEP: '1' });
    replay('capabilities-approved')(bin, argv, options, done);
  } });
  assert.equal(result.ok, true); assert.equal(result.pending, false);
  assert.equal(env.OATS_INSTANCE_HOME, '/foreign');
});

test('exit semantics: 2 with ok:true is pending for sync/onboard, never for a read; refusals keep only code/message', async () => {
  const run = (options, name) => cliWorkspace(cli(), options, { exec: replay(name) });
  assert.deepEqual(Object.keys(await run({ action: 'sync', context: deployment }, 'sync-pending')), ['ok', 'pending', 'document']);
  assert.equal((await run({ action: 'sync', context: deployment }, 'sync-pending')).pending, true);
  assert.equal((await run({ action: 'sync', context: deployment }, 'sync-current')).pending, false);
  assert.equal((await cliWorkspace(cli(), { action: 'capabilities', context: deployment }, { exec: (_b, _a, _o, done) => done(exitError(2), JSON.stringify(fixture('capabilities-approved'))) })).reason.code,
    'E_CLI_FAILED', 'a read cannot be "pending"');
  const integrity = await run({ action: 'sync', context: deployment }, 'sync-integrity');
  assert.deepEqual(Object.keys(integrity.reason), ['code', 'message']);
  assert.equal(integrity.reason.code, 'E_PACKAGE_INTEGRITY');
  assert.match(integrity.reason.message, /the tag moved; a version string must change when its content does/, 'the kernel message, verbatim');
  const rolled = await run({ action: 'onboard', dir: '/fixture/base/other-workspace', workspace: '/fixture/base/fx/remotes/missing.git' }, 'onboard-unreadable');
  assert.deepEqual(rolled.reason, { code: 'E_REMOTE_UNREADABLE', message: fixture('onboard-unreadable').error.message, rolledBack: true });
  // A refusal on a success exit, garbage, timeouts and huge output fail closed.
  assert.equal((await cliWorkspace(cli(), { action: 'sync', context: deployment }, { exec: (_b, _a, _o, done) => done(null, JSON.stringify(fixture('sync-integrity'))) })).reason.code, 'E_CLI_PROTOCOL');
  assert.equal((await cliWorkspace(cli(), { action: 'sync', context: deployment }, { exec: (_b, _a, _o, done) => done(null, 'SECRET') })).reason.code, 'E_CLI_PROTOCOL');
  assert.equal((await cliWorkspace(cli(), { action: 'sync', context: deployment }, { exec: (_b, _a, _o, done) => done({ killed: true }, '') })).reason.code, 'E_CLI_TIMEOUT');
  assert.equal((await cliWorkspace(cli(), { action: 'sync', context: deployment }, { exec: (_b, _a, _o, done) => done({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, '') })).reason.code, 'E_CLI_OUTPUT_LIMIT');
  assert.doesNotMatch(JSON.stringify(await cliWorkspace(cli(), { action: 'sync', context: deployment }, { exec: (_b, _a, _o, done) => done(exitError(1), 'SECRET stderr') })), /SECRET/);
});

test('gate: workspace-v2 feature and API 2 are required; nothing dispatches otherwise', async () => {
  for (const state of [{ ...cli(), ok: false }, { ...cli(), workspaceApi: 1 }, { ...cli(), features: [] }, { ...cli(), bin: 'oats' }]) {
    const result = await cliWorkspace(state, { action: 'sync', context: deployment }, { exec: assert.fail });
    assert.equal(result.ok, false);
  }
});

test('projectors keep command shapes: approval rows bind id/version/commit/executables/targets', () => {
  const pending = syncData(fixture('sync-pending'), deployment);
  assert.deepEqual(pending.approvalNeeded.map(row => row.id), ['nw.tools', 'oats.framework', 'oats.okf']);
  for (const row of pending.approvalNeeded) {
    assert.match(row.commit, /^[0-9a-f]{40}$/); assert.match(row.executables, /^sha256-[0-9a-f]{64}$/); assert.ok(Array.isArray(row.targets));
  }
  assert.equal(syncData(fixture('sync-approved'), deployment).approvalNeeded.length, 0);
  const moved = syncData(fixture('sync-moved'), deployment);
  assert.equal(moved.members.find(m => m.name === 'marketing').status, 'no-backlink');
  assert.throws(() => syncData(fixture('sync-pending'), '/elsewhere'), { code: 'E_DEPLOYMENT_SCOPE' });
  const tampered = fixture('sync-pending'); tampered.result.approvalNeeded[0].executables = 'sha256-short';
  assert.throws(() => syncData(tampered, deployment), { code: 'E_CLI_PROTOCOL' });
  const duplicate = fixture('sync-pending'); duplicate.result.approvalNeeded.push(duplicate.result.approvalNeeded[0]);
  assert.throws(() => syncData(duplicate, deployment), { code: 'E_CLI_PROTOCOL' });
  const catalog = capabilitiesData(fixture('capabilities-pending'));
  assert.deepEqual([...new Set(catalog.capabilities.map(c => c.kind))].sort(), ['member', 'package']);
  assert.ok(catalog.capabilities.filter(c => c.kind === 'package').every(c => c.approved === false && c.team === 'unassigned'));
  assert.ok(capabilitiesData(fixture('capabilities-approved')).capabilities.filter(c => c.kind === 'package').every(c => c.approved === true));
  const onboard = onboardData(fixture('onboard-pending'), deployment);
  assert.equal(onboard.sync.approvalNeeded.length, 3);
  assert.deepEqual(onboard.next.clone.map(c => c.name), ['agents', 'platform', 'data', 'marketing', 'nw-tools']);
  assert.equal(onboard.hosting.hostIsMember, true);
  assert.throws(() => onboardData(fixture('onboard-pending'), '/fixture/base/other'), { code: 'E_DEPLOYMENT_SCOPE' });
});

/* ── the server boundary ─────────────────────────────────────────────── */
const workspace = { id: deployment, scope: deployment };
function boundary(script) {
  const calls = [];
  const invoke = async (state, options) => {
    calls.push(options);
    const step = script.shift();
    if (!step) assert.fail(`unexpected ${options.action}`);
    return typeof step === 'function' ? step(state, options) : cliWorkspace(state, options, { exec: replay(step) });
  };
  return { request: createWorkspaceSyncBoundary({ invoke }), calls };
}
const rows = name => syncData(fixture(name), deployment).approvalNeeded.map(({ id, version, executables }) => ({ id, version, executables }));

test('read returns the projected catalog; sync reports pending with the approval rows', async () => {
  const b = boundary(['capabilities-pending', 'sync-pending']);
  const read = await b.request({ action: 'read' }, { workspace, cli: cli() });
  assert.equal(read.status, 'ok'); assert.equal(read.capabilities.capabilities.length, 10);
  const sync = await b.request({ action: 'sync' }, { workspace, cli: cli() });
  assert.equal(sync.status, 'pending'); assert.equal(sync.report.approvalNeeded.length, 3);
  assert.deepEqual(b.calls.map(c => c.action), ['capabilities', 'sync']);
});

test('approve admits only rows the latest sync showed — exact id, version and executables digest', async () => {
  const b = boundary(['sync-pending', 'sync-approve-partial', 'sync-approved']);
  assert.equal((await b.request({ action: 'approve', approvals: rows('sync-pending').slice(0, 1) }, { workspace, cli: cli() })).reason.code,
    'E_APPROVAL_STALE', 'no report held yet: nothing to approve against');
  await b.request({ action: 'sync' }, { workspace, cli: cli() });
  const shown = rows('sync-pending');
  for (const forged of [
    [{ ...shown[0], executables: `sha256-${'0'.repeat(64)}` }], [{ ...shown[0], version: '9.9.9' }], [{ id: 'unknown.pkg', version: '1.0.0', executables: shown[0].executables }],
  ]) assert.equal((await b.request({ action: 'approve', approvals: forged }, { workspace, cli: cli() })).reason.code, 'E_APPROVAL_STALE');
  for (const malformed of [[], [{ id: 'nw.tools' }], [{ ...shown[0], extra: 1 }], [shown[0], shown[0]], 'x'])
    assert.equal((await b.request({ action: 'approve', approvals: malformed }, { workspace, cli: cli() })).reason.code, 'E_BAD_ARGS');
  const partial = await b.request({ action: 'approve', approvals: shown.slice(0, 1) }, { workspace, cli: cli() });
  assert.equal(partial.status, 'pending'); assert.equal(partial.report.approvalNeeded.length, 2);
  assert.deepEqual(b.calls.at(-1), { action: 'approve', context: deployment, approvals: [{ id: shown[0].id, version: shown[0].version }] });
  // The held report is now the partial one: the first row is no longer pending.
  assert.equal((await b.request({ action: 'approve', approvals: shown.slice(0, 1) }, { workspace, cli: cli() })).reason.code, 'E_APPROVAL_STALE');
  const done = await b.request({ action: 'approve', approvals: rows('sync-approve-partial') }, { workspace, cli: cli() });
  assert.equal(done.status, 'ok'); assert.equal(done.report.approvalNeeded.length, 0);
});

test('another CLI or a refused mutation revokes the held review', async () => {
  const b = boundary(['sync-pending', 'sync-integrity']);
  await b.request({ action: 'sync' }, { workspace, cli: cli() });
  const other = { ...cli(), bin: '/other/oats' };
  assert.equal((await b.request({ action: 'approve', approvals: rows('sync-pending') }, { workspace, cli: other })).reason.code, 'E_APPROVAL_STALE');
  const refused = await b.request({ action: 'sync' }, { workspace, cli: cli() });
  assert.equal(refused.status, 'refused'); assert.equal(refused.reason.code, 'E_PACKAGE_INTEGRITY');
  assert.equal((await b.request({ action: 'approve', approvals: rows('sync-pending') }, { workspace, cli: cli() })).reason.code, 'E_APPROVAL_STALE');
});

test('one mutation per deployment; a report that contradicts its exit is a protocol failure', async () => {
  let release;
  const b = boundary([() => new Promise(done => { release = () => done(cliWorkspace(cli(), { action: 'sync', context: deployment }, { exec: replay('sync-pending') })); })]);
  const first = b.request({ action: 'sync' }, { workspace, cli: cli() });
  await new Promise(r => setImmediate(r));
  assert.equal((await b.request({ action: 'sync' }, { workspace, cli: cli() })).reason.code, 'E_SYNC_BUSY');
  release(); assert.equal((await first).status, 'pending');
  const liar = boundary([async () => ({ ok: true, pending: false, document: fixture('sync-pending') })]);
  assert.equal((await liar.request({ action: 'sync' }, { workspace, cli: cli() })).reason.code, 'E_CLI_PROTOCOL');
});

test('remote, unknown or pre-v2 contexts never dispatch', async () => {
  const b = boundary([]);
  for (const [ws, state] of [[null, cli()], [{ ...workspace, remote: true }, cli()], [{ ...workspace, server: 'h' }, cli()], [workspace, { ...cli(), features: [] }]]) {
    const result = await b.request({ action: 'sync' }, { workspace: ws, cli: state });
    assert.notEqual(result.status, 'ok');
  }
  for (const bad of [null, { action: 'list' }, { action: 'sync', extra: 1 }, { action: 'read', approvals: [] }])
    assert.equal((await b.request(bad, { workspace, cli: cli() })).reason.code, 'E_BAD_ARGS');
  assert.equal(b.calls.length, 0);
});

/* ── the real HTTP route, extracted from the shipped server ─────────── */
function httpHarness(workspaceSyncRequest) {
  const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('const send = (res, code, body, type');
  const end = source.indexOf('\nserver.on("error",');
  const errorStart = source.indexOf('function spawnErrorPayload(e)');
  const errorEnd = source.indexOf('/* OATSWEB_SPAWNERR_END */', errorStart);
  const { syncFailure } = { syncFailure: code => ({ workspaceSyncApi: 1, status: 'unavailable', reason: { code } }) };
  let refreshes = 0;
  const dependencies = {
    createServer: callback => callback, workspaceSyncRequest, syncFailure, refreshSnapshot: () => { refreshes++; },
    cliState: cli(), ctxs: [deployment], workspaces: () => [workspace],
  };
  const handler = new Function(...Object.keys(dependencies), `${source.slice(errorStart, errorEnd)}\n${source.slice(start, end)}\nreturn server;`)(...Object.values(dependencies));
  return {
    refreshes: () => refreshes,
    async request({ url = `/api/workspace-sync?ws=${encodeURIComponent(deployment)}`, body = '{}', headers = { host: '127.0.0.1:4820', origin: 'http://localhost:4820' } } = {}) {
      const req = new EventEmitter(); req.url = url; req.method = 'POST'; req.headers = headers;
      let result;
      const res = { writeHead(status) { result = { status }; }, end(raw) { result.body = JSON.parse(raw); } };
      const completion = handler(req, res);
      req.emit('data', Buffer.from(body)); req.emit('end'); await completion;
      return result;
    },
  };
}

test('HTTP: loopback Host/Origin guards first, one ws selector, snapshot refresh only after a mutation', async () => {
  const b = boundary(['capabilities-pending', 'sync-pending']);
  const http = httpHarness(b.request);
  for (const headers of [{ host: 'evil.invalid' }, { host: 'localhost', origin: 'https://evil.invalid' }, { host: 'localhost', origin: 'null' }])
    assert.equal((await http.request({ headers, body: '{"action":"sync"}' })).status, 403);
  for (const url of ['/api/workspace-sync', `/api/workspace-sync?ws=a&ws=b`, `/api/workspace-sync?ws=${encodeURIComponent(deployment)}&x=1`])
    assert.equal((await http.request({ url, body: '{"action":"sync"}' })).status, 400);
  assert.equal((await http.request({ body: 'not JSON' })).status, 400);
  assert.equal(b.calls.length, 0);
  assert.equal((await http.request({ body: '{"action":"read"}' })).body.status, 'ok');
  assert.equal(http.refreshes(), 0, 'a catalog read is not a mutation');
  assert.equal((await http.request({ body: '{"action":"sync"}' })).body.status, 'pending');
  assert.equal(http.refreshes(), 1);
});

test('mutation: the executables digest is essential to the approval binding', async () => {
  const url = new URL('../server/workspace-sync.mjs', import.meta.url);
  const from = 'shown.version !== row.version || shown.executables !== row.executables';
  let source = readFileSync(url, 'utf8');
  assert.equal(source.split(from).length, 2);
  source = source.replace(from, 'shown.version !== row.version').replace(/from '(\.[^']+)'/g, (_all, spec) => `from '${new URL(spec, url).href}'`);
  const { createWorkspaceSyncBoundary: weakened } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const forged = [{ ...rows('sync-pending')[0], executables: `sha256-${'0'.repeat(64)}` }];
  for (const [create, expected] of [[createWorkspaceSyncBoundary, 'E_APPROVAL_STALE'], [weakened, null]]) {
    const script = ['sync-pending', 'sync-approve-partial'];
    const request = create({ invoke: (state, options) => cliWorkspace(state, options, { exec: replay(script.shift()) }) });
    await request({ action: 'sync' }, { workspace, cli: cli() });
    const result = await request({ action: 'approve', approvals: forged }, { workspace, cli: cli() });
    assert.equal(result.reason?.code ?? null, expected, expected ? 'the shipped binding refuses an unseen digest' : 'without it, an unseen digest would be approved');
  }
});
