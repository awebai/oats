import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { cliDeploymentRead, DEPLOYMENT_READ_MAX_BUFFER, DEPLOYMENT_READ_TIMEOUT } from '../deployment-read-cli.mjs';
import { deploymentReadGate, DEPLOYMENT_FEATURES } from '../renderer/deployment-contract.mjs';
import { deploymentStatusData, workspaceStatusData } from '../deployment-data.mjs';

const file = name => new URL(`./fixtures/workspace-v2/${name}.json`, import.meta.url);
const fixture = name => JSON.parse(readFileSync(file(name), 'utf8'));
const status = fixture('status'), header = fixture('workspace-status'), probe = fixture('version');
const context = dirname(status.root);
// An already accepted locator result. The producer's source version is retained
// in the fixture and provenance; version-band tests belong to the locator.
const cli = () => ({ ...probe, ok: true, bin: '/fixture/bin/oats' });
const input = action => ({ action, context });
const reply = (document, error = null) => (_bin, _args, _options, callback) => callback(error, JSON.stringify(document));

test('Northwind producer fixtures have recorded hashes and honest source/exit provenance', () => {
  const provenance = fixture('provenance');
  for (const [name, entry] of Object.entries(provenance.files)) {
    assert.equal(createHash('sha256').update(readFileSync(file(name))).digest('hex'), entry.fixtureSha256);
  }
  assert.equal(provenance.files.status.exit.status, 86);
  assert.equal(provenance.files['workspace-status'].exit.status, 0);
  assert.equal(probe.workspaceApi, 2);
  for (const feature of DEPLOYMENT_FEATURES) assert.ok(probe.features.includes(feature), feature);
});

for (const action of ['status', 'workspace-status']) test(`${action}: fixed argv, selected cwd, bounded I/O and ambient selector removal`, async () => {
  const environment = { KEEP: 'fixture', PI_AGENTS_ROOT: '/foreign', OATS_DEPLOYMENT: '/foreign', OATS_RESOLUTION: 'foreign', OATS_INSTANCE_HOME: '/foreign', PI_AGENT_HOME: '/foreign', OATS_HOME: '/foreign', OATS_INSTANCE: 'foreign', PI_AGENT_INSTANCE: 'foreign' };
  let calls = 0;
  const document = action === 'status' ? status : header;
  const result = await cliDeploymentRead(cli(), input(action), { env: environment, exec(bin, args, options, callback) {
    calls++; assert.equal(bin, '/fixture/bin/oats');
    assert.deepEqual(args, [...(action === 'status' ? ['status'] : ['workspace', 'status']), '--dir', context, '--json']);
    assert.equal(options.cwd, context); assert.equal(options.shell, false); assert.equal(options.encoding, 'utf8');
    assert.equal(options.timeout, DEPLOYMENT_READ_TIMEOUT); assert.equal(options.maxBuffer, DEPLOYMENT_READ_MAX_BUFFER);
    assert.deepEqual(options.env, { KEEP: 'fixture' }); callback(null, JSON.stringify(document));
  } });
  assert.equal(calls, 1); assert.deepEqual(result, { ok: true, document });
  assert.equal(environment.OATS_INSTANCE_HOME, '/foreign', 'caller environment is not mutated');
});

for (const feature of ['workspace-v2', 'instance-modules', 'served-identity']) test(`actual exec owner refuses missing ${feature}, names it, and never invokes`, async () => {
  const state = cli(); state.features = state.features.filter(f => f !== feature);
  const result = await cliDeploymentRead(state, input('status'), { exec() { assert.fail('unadvertised dispatch'); } });
  assert.equal(result.ok, false); assert.equal(result.reason.feature, feature); assert.match(result.reason.message, new RegExp(feature));
});
for (const value of [undefined, 1, '2', 3]) test(`workspaceApi ${String(value)} is not API2`, async () => {
  const result = await cliDeploymentRead({ ...cli(), workspaceApi: value }, input('workspace-status'), { exec() { assert.fail('unsupported dispatch'); } });
  assert.equal(result.reason.code, 'E_DEPLOYMENT_FEATURE');
});
test('workspace header does not require roster-only features', () => {
  assert.equal(deploymentReadGate({ ...cli(), features: ['workspace-v2'] }, 'workspace-status'), null);
  assert.equal(deploymentReadGate({ ...cli(), features: 'workspace-v2' }, 'workspace-status').ok, false);
});
for (const options of [{ action: 'sync', context }, { action: 'status', context: 'relative' }, { action: 'status', context: context + '/..' }, { action: 'status', context, argv: ['--force'] }, { action: 'status', context: context + '\0' }]) test(`invalid input is refused: ${JSON.stringify(options)}`, async () => {
  assert.equal((await cliDeploymentRead(cli(), options, { exec() { assert.fail('bad input dispatched'); } })).reason.code, 'E_BAD_ARGS');
});
test('unavailable CLI cannot observe through a filesystem fallback', async () => {
  assert.equal((await cliDeploymentRead({ ...cli(), ok: false }, input('status'), { exec() { assert.fail(); } })).reason.code, 'E_CLI_UNAVAILABLE');
});
for (const error of [{ code: 86 }, { code: 1 }, { signal: 'SIGTERM' }]) test(`plausible status on failed exit is never success: ${JSON.stringify(error)}`, async () => {
  assert.equal((await cliDeploymentRead(cli(), input('status'), { exec: reply(status, error) })).reason?.code, 'E_CLI_FAILED');
});
for (const [error, code] of [[{ killed: true }, 'E_CLI_TIMEOUT'], [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, 'E_CLI_OUTPUT_LIMIT']]) test(`transport failure ${code} wins over plausible output`, async () => {
  assert.equal((await cliDeploymentRead(cli(), input('status'), { exec: reply(status, error) })).reason?.code, code);
});
for (const output of ['not json', '{}\n{}', 'null', '[]', JSON.stringify(header)]) test(`status refuses a contaminated or wrong-family document: ${output.slice(0, 25)}`, async () => {
  const result = await cliDeploymentRead(cli(), input('status'), { exec(_b, _a, _o, cb) { cb(null, output); } });
  assert.equal(result.reason.code, 'E_CLI_PROTOCOL');
});
test('workspace status does not accept the raw status family', async () => {
  assert.equal((await cliDeploymentRead(cli(), input('workspace-status'), { exec: reply(status) })).reason.code, 'E_CLI_PROTOCOL');
});
test('independent UTF8 byte fence works when a custom invoker ignores maxBuffer', async () => {
  const result = await cliDeploymentRead(cli(), input('status'), { exec(_b, _a, _o, cb) { cb(null, 'é'.repeat(DEPLOYMENT_READ_MAX_BUFFER / 2 + 1)); } });
  assert.equal(result.reason?.code, 'E_CLI_OUTPUT_LIMIT');
});
test('kernel domain refusal retains bounded code/message, not process diagnostics/details', async () => {
  const message = 'package integrity refused';
  const result = await cliDeploymentRead(cli(), input('workspace-status'), { exec: reply({ schemaVersion: 1, ok: false, error: { code: 'E_PACKAGE_INTEGRITY', message, details: { secret: 'withheld' } } }, { code: 1, message: 'private argv' }) });
  assert.deepEqual(result, { ok: false, reason: { code: 'E_PACKAGE_INTEGRITY', message } });
});

test('workspace header consumes exact producer approval IDs, members and packages, without inspect scope', () => {
  const result = workspaceStatusData(header, context);
  assert.deepEqual(result.workspace, header.result.workspace);
  assert.deepEqual(result.members, header.result.members);
  assert.deepEqual(result.packages, header.result.packages);
  assert.deepEqual(result.approval, { approved: ['nw.tools', 'oats.framework', 'oats.okf'], needed: [] });
  assert.equal(Object.hasOwn(result, 'approvalNeeded'), false);
  assert.equal(Object.hasOwn(result, 'scope'), false);
});
test('native roster retains module drift, recorded soul/workspace and absent identity', () => {
  const result = deploymentStatusData(status, context);
  assert.equal(result.agents.length, status.agents.length);
  const soul = result.agents.find(a => a.name === 'release-manager'), original = status.agents.find(a => a.name === soul.name);
  assert.deepEqual(soul.soulSource, original.soulSource);
  const instance = soul.instances[0], raw = original.instances[0];
  assert.deepEqual(instance.modules, raw.modules); assert.deepEqual(instance.soul, raw.soul);
  assert.deepEqual(instance.workspace, raw.workspace); assert.equal(Object.hasOwn(instance, 'identity'), false);
  assert.equal(instance.running, false); assert.deepEqual(instance.tmux, raw.tmux);
  for (const key of ['command', 'launch', 'capabilityRuntime', 'composition', 'instructions', 'capabilities', 'providers', 'layers']) assert.equal(Object.hasOwn(instance, key), false, key);
  assert.equal(Object.hasOwn(instance, 'task'), false); assert.equal(Object.hasOwn(instance, 'knowledgeCount'), false);
  assert.equal(Object.hasOwn(instance, 'team'), false, 'ambient inspect/config team is not header authority');
  instance.modules[0].name = 'mutated caller copy'; assert.notEqual(raw.modules[0].name, instance.modules[0].name);
});
for (const [name, project, data] of [['status', deploymentStatusData, status], ['workspace-status', workspaceStatusData, header]]) test(`${name} refuses a mismatched deployment`, () => {
  assert.throws(() => project(data, '/another/deployment'), { code: 'E_DEPLOYMENT_SCOPE' });
});
test('a roster root other than <deployment>/agents rejects the whole observation', () => {
  for (const root of ['/outside/agents', join(context, 'other'), context]) {
    assert.throws(() => deploymentStatusData({ ...structuredClone(status), root }, context), { code: 'E_DEPLOYMENT_SCOPE' }, root);
  }
  assert.throws(() => deploymentStatusData(status, '/another/deployment'), { code: 'E_DEPLOYMENT_SCOPE' }, 'observation of another deployment');
});
test('a soul directory outside the deployment rejects the whole observation', () => {
  const raw = structuredClone(status); raw.agents[0].dir = '/outside/soul';
  assert.throws(() => deploymentStatusData(raw, context), { code: 'E_DEPLOYMENT_SCOPE' });
});
for (const [reason, mutate] of [
  ['home-outside-soul', r => { r.agents[0].instances[0].home = '/outside/home'; }],
  ['home-outside-soul', r => { r.agents[0].instances[0].instance = 'renamed'; }],
  ['duplicate-home', r => { r.agents[0].instances.push(structuredClone(r.agents[0].instances[0])); }],
]) test(`an instance row with a ${reason} is withheld and counted, never acted on or silently dropped`, () => {
  const raw = structuredClone(status); mutate(raw);
  const result = deploymentStatusData(raw, context);
  assert.equal(result.withheld.length, 1); assert.equal(result.withheld[0].reason, reason);
  assert.equal(result.withheld[0].agent, 'release-manager');
  const homes = result.agents.flatMap(a => a.instances.map(i => i.home));
  assert.ok(!homes.includes('/outside/home')); assert.equal(new Set(homes).size, homes.length);
});
test('a clean capture withholds nothing', () => assert.deepEqual(deploymentStatusData(status, context).withheld, []));

test('the locator carries only an integer workspaceApi 2 from the probe into the accepted CLI state', async () => {
  const { discover } = await import('../cli-locator.mjs');
  const run = async payload => discover({ persisted: () => '/fixture/bin/oats', env: {}, isExecutableFile: () => true },
    async () => ({ stdout: JSON.stringify(payload) }));
  assert.equal((await run(probe)).workspaceApi, 2, 'the captured probe advertises workspaceApi 2');
  for (const value of [1, '2', 3, undefined]) {
    const state = await run({ ...probe, workspaceApi: value });
    assert.equal(state.ok, true); assert.equal(Object.hasOwn(state, 'workspaceApi'), false, String(value));
    assert.equal(deploymentReadGate(state, 'workspace-status').reason.feature, 'workspace-v2');
  }
});

test('every package-root module the bundled server imports (transitively) is in the packaged file list', () => {
  const pkg = new URL('../', import.meta.url);
  const config = readFileSync(new URL('electron-builder.config.cjs', pkg), 'utf8');
  const seen = new Set(), rootModules = new Set();
  const visit = url => {
    if (seen.has(url.href)) return; seen.add(url.href);
    const source = readFileSync(url, 'utf8');
    for (const [, spec] of source.matchAll(/^import[^'"]*['"](\.{1,2}\/[^'"]+)['"]/gm)) {
      const next = new URL(spec, url);
      const rel = next.href.slice(pkg.href.length);
      if (!rel.includes('/')) rootModules.add(rel);
      if (rel.endsWith('.mjs')) visit(next);
    }
  };
  visit(new URL('server/oats-web.mjs', pkg));
  assert.ok(rootModules.has('deployment-read-cli.mjs') && rootModules.has('deployment-data.mjs'));
  for (const file of rootModules) assert.ok(config.includes(`"${file}"`), `${file} is packaged`);
});
