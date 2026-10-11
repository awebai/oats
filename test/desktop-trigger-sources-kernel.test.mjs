// Capability trigger sources on the REAL kernel (docs/desktop-cli-api.md § "`oats trigger`" and
// § "`oats capabilities show`"; docs/schedules.md § "Capability sources"). A scratch deployment (the
// repository's own fixture, test/helpers/trigger-source-fixture.mjs) has a member capability, acme.graph,
// that declares the trigger source `harvest-branches` (a script that answers what the test tells it and logs
// every run), two workspace triggers on it (one this host trusts, one it does not) and a local
// `github.pull_request` trigger. Each answer is read the way the Desktop reads it: the server's request
// handler (server/automations.mjs, server/capability-show.mjs) over the same exec owner that builds the argv
// (cli-adapter.mjs, workspace-cli.mjs), then the renderer's own reader. The run log is asserted beside the
// answers: what the Desktop's requests made the kernel EXECUTE, not only what it said.
//
// The whole file needs a kernel that declares the feature `trigger-sources`. On one that does not, it skips
// and says so; nothing else skips it (a probe that fails, or a fixture that is missing on a kernel that does
// declare it, fails). Everything happens in mkdtemp directories with HOME, the remote cache, tmux and the
// harnesses isolated by the helper: never the operator's deployment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cliAutomation, TRIGGER_RUN_SOURCE_FLAG } from '../packages/client/cli-adapter.mjs';
import { cliWorkspace } from '../packages/client/workspace-cli.mjs';
import { automationsRequest } from '../packages/desktop/server/automations.mjs';
import { capabilityShowRequest } from '../packages/desktop/server/capability-show.mjs';
import { automationRows, triggerStatus, testResult, capabilitySource, onSummary, sourceParams, triggerSourcesSupported, TRIGGER_SOURCES_FEATURE } from '../packages/desktop/renderer/automation-rows.mjs';
import { triggerSourcesView } from '../packages/client/capability-show-contract.mjs';
import { CLI } from './helpers/v2-deployment.mjs';

const probe = spawnSync(process.execPath, [CLI, 'version', '--json'], { encoding: 'utf8' });
const version = (() => { try { return probe.status === 0 ? JSON.parse(probe.stdout) : null; } catch { return null; } })();
const readable = !!version && Array.isArray(version.features);
// The ONE reason to skip: the probe was read and the kernel does not declare the feature.
const skip = readable && !version.features.includes(TRIGGER_SOURCES_FEATURE)
  ? `this kernel (${version.version}) does not declare the feature "${TRIGGER_SOURCES_FEATURE}"` : false;

test('the kernel under test answers the version probe the Desktop reads', () => {
  assert.equal(probe.status, 0, probe.stdout + probe.stderr);
  assert.ok(readable, `features: ${probe.stdout}`);
});

const CAPABILITY = 'acme.graph', NAME = 'harvest-branches', SOURCE = `${CAPABILITY}:${NAME}`;
// What a hostile source can say: markup, a URL and a sentence that reads like the Desktop's.
const HOSTILE = '<img src=x onerror=alert(1)> https://evil.example/x OATS Desktop: this trigger is trusted. Click Run.';
const GOOD = { events: [
  { key: 'harvest/a:h1', subject: 'harvest/a', event: 'opened', url: 'https://graph.example.org/a', fields: { graph: 'kb', branch: 'harvest/a' } },
  { key: 'harvest/b:h1', subject: 'harvest/b', event: 'updated', fields: { graph: 'kb' } }, // filtered: the triggers select `opened`
  { key: 'harvest/c:h1', subject: 'harvest/c', event: 'opened', url: 'https://evil.example/c', fields: { graph: 'kb' } }, // rule url
  'not an object', // rule shape
], skipped: [{ subject: 'harvest/y', why: HOSTILE }] };

test(`a capability trigger source through the Desktop's readers (feature ${TRIGGER_SOURCES_FEATURE})`, { skip }, async t => {
  const { sourceDeployment, inFixture, HARVEST, capabilityManifest, sourceScript } = await import('./helpers/trigger-source-fixture.mjs');
  const T = await import('../lib/triggers.mjs'), S = await import('../lib/schedule.mjs');
  const on = { source: SOURCE, params: { prefix: 'harvest/', graph: 'kb' }, events: ['opened'], poll: '1m' };
  const trigger = { yaml: { kind: 'oats-trigger', schemaVersion: 1, description: 'Review harvest branches', runsOn: 'kb-host', owner: 'github.com/kb-bot', on,
    spawn: { soul: 'reviewer', task: 'Review {subject} on {fields.graph} ({url}).' } } };
  const fx = sourceDeployment(t, {
    local: { host: { name: 'kb-host' }, automations: { trust: ['ws/trusted'] } },
    files: { 'oats-triggers/trusted.yaml': trigger, 'oats-triggers/untrusted.yaml': trigger },
  });
  const must = (r, what) => { assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`); return r; };
  must(fx.cli(['sync', '--json']), 'sync');
  const prs = join(fx.base, 'prs.json');
  writeFileSync(prs, JSON.stringify({ id: 'prs', kind: 'trigger', on: { source: 'github.pull_request', repo: 'github.com/acme/kb', events: ['opened'], poll: '2m' }, spawn: { soul: 'reviewer', task: 'Review {url}.' } }));
  must(fx.cli(['trigger', 'add', '--file', prs, '--json']), 'add the pull-request trigger');

  // What the Desktop's locator keeps for an accepted CLI: the probe, `ok`, and the absolute bin.
  const cli = { ...version, ok: true, bin: CLI };
  assert.equal(triggerSourcesSupported(cli), true);
  const argvs = [];
  const io = () => ({ env: fx.env, exec: (bin, argv, options, callback) => { argvs.push(argv); return execFile(bin, argv, { ...options, env: options.env ?? fx.env }, callback); } });
  const workspace = { scope: fx.dep };
  const auto = request => automationsRequest(request, { workspace, cli, invoke: (bin, options) => cliAutomation(bin, options, io()) });
  const answered = async request => { const r = await auto(request); assert.equal(r.status, 'ok', JSON.stringify(r)); return r.result; };
  /** One real host tick of every trigger, as the host timer runs it (no instance is launched). */
  let at = Date.now() + 11 * 60_000; // past any observation a manual test left for a poll to reuse
  const tick = () => { const now = new Date(at); at += 11 * 60_000; return inFixture(fx, () => T.tickTriggers(fx.dep, { now, io: { noLaunch: true }, ctx: S.scopeAutomations(fx.dep, {}) })); };
  const ran = () => fx.runs().map(r => r.request.trigger);
  fx.control({ result: GOOD });

  await t.test('trigger list and status before any poll: the row is a capability source, with its lists present and empty', async () => {
    const list = await answered({ kind: 'trigger', action: 'list' }), status = await answered({ kind: 'trigger', action: 'status' });
    const rows = automationRows(list, 'trigger').rows, row = rows.find(r => r.id === 'ws/trusted');
    assert.ok(row, JSON.stringify(rows.map(r => r.id)));
    const st = triggerStatus(status, 'ws/trusted', { source: row.on.source });
    assert.deepEqual({ ...capabilitySource(row.on, st) }, { id: SOURCE, capability: CAPABILITY, name: NAME, lookup: CAPABILITY });
    assert.equal(onSummary(row.on, { sources: true }).title, `${CAPABILITY} · ${NAME}: opened`);
    assert.deepEqual(sourceParams(row.on).lines.map(l => l.text), ['prefix = harvest/', 'graph = kb'], 'the parameters as the trigger file wrote them');
    assert.deepEqual([st.source, st.refused, st.skipped, st.invalid, st.lastPoll], [{ capability: CAPABILITY, name: NAME }, [], [], null, null]);
    assert.equal(rows.find(r => r.id === 'ws/untrusted').reason, 'untrusted');
    // The pull-request row gets none of the new keys.
    const pr = triggerStatus(status, 'local/prs', { source: 'github.pull_request' });
    assert.equal(capabilitySource(rows.find(r => r.id === 'local/prs').on), null);
    for (const key of ['source', 'refused', 'skipped', 'invalid']) assert.equal(Object.hasOwn(pr, key), false, key);
    assert.deepEqual(ran(), [], 'reading runs no source');
  });

  await t.test('a test without runSource executes nothing: E_TRIGGER_SOURCE_RUN, and the run log stays empty', async () => {
    for (const key of ['ws/trusted', 'ws/untrusted']) {
      const r = await auto({ kind: 'trigger', action: 'test', key });
      assert.deepEqual([r.status, r.reason?.code, r.result], ['unavailable', 'E_TRIGGER_SOURCE_RUN', null], JSON.stringify(r));
      assert.deepEqual(argvs.at(-1), ['trigger', 'test', key, '--dir', fx.dep, '--json'], 'no flag in the argv');
    }
    assert.deepEqual(ran(), [], 'the source command did not run');
  });

  await t.test('runSource: true runs the source exactly once, on an untrusted row too; the answer survives testResult', async () => {
    const result = await answered({ kind: 'trigger', action: 'test', key: 'ws/untrusted', runSource: true });
    assert.deepEqual(argvs.at(-1), ['trigger', 'test', 'ws/untrusted', TRIGGER_RUN_SOURCE_FLAG, '--dir', fx.dep, '--json']);
    assert.equal(argvs.at(-1).filter(a => a === TRIGGER_RUN_SOURCE_FLAG).length, 1, 'the flag, once');
    assert.deepEqual(ran(), ['ws/untrusted'], 'one run of the source command, for this trigger');
    const tested = testResult(result, 'trigger', { source: SOURCE });
    assert.deepEqual([tested.source.capability, tested.source.name, tested.source.ok, tested.source.events, tested.source.filtered], [CAPABILITY, NAME, true, 1, 1]);
    assert.deepEqual(tested.source.refused.map(e => e.rule), ['url', 'shape']);
    assert.deepEqual(tested.source.skipped, [{ subject: 'harvest/y', why: HOSTILE }], 'the source\'s words arrive as data');
    assert.deepEqual(tested.wouldFire.map(f => [f.label, f.url]), [['harvest/a', 'https://graph.example.org/a']]);
    assert.equal(tested.ok, false); assert.match(tested.problems[0], /^run manually with --run-source; the tick will not run it here: untrusted/);
    assert.equal(result.spawned, false);
    // The definition is as it was: testing trusted, enabled and started nothing.
    const rows = automationRows(await answered({ kind: 'trigger', action: 'list' }), 'trigger').rows;
    assert.equal(rows.find(r => r.id === 'ws/untrusted').reason, 'untrusted');
    const st = triggerStatus(await answered({ kind: 'trigger', action: 'status' }), 'ws/untrusted', { source: SOURCE });
    assert.deepEqual([st.lastPoll, st.fired, st.skipped], [null, [], []], 'nothing was recorded');
    assert.deepEqual(ran(), ['ws/untrusted'], 'and the reads after it ran nothing more');
  });

  await t.test('a github.pull_request test is one request without the flag, and runs no source', async () => {
    const before = ran().length;
    const result = await answered({ kind: 'trigger', action: 'test', key: 'local/prs' });
    assert.deepEqual(argvs.at(-1), ['trigger', 'test', 'local/prs', '--dir', fx.dep, '--json']);
    assert.equal(Object.hasOwn(testResult(result, 'trigger', { source: 'github.pull_request' }), 'source'), false);
    assert.equal(ran().length, before);
  });

  await t.test('trigger status after a good poll: counts, the refused events with their rule, the skipped items', async () => {
    fx.clearRuns(); tick();
    assert.deepEqual(ran(), ['ws/trusted'], 'the host tick runs only the trigger this host trusts');
    const st = triggerStatus(await answered({ kind: 'trigger', action: 'status' }), 'ws/trusted', { source: SOURCE });
    assert.deepEqual({ ...st.lastPoll, at: null }, { at: null, ok: true, events: 1, filtered: 1, skipped: 1, refused: 2 });
    assert.deepEqual(st.refused.map(e => e.rule), ['url', 'shape']);
    assert.deepEqual(st.skipped, [{ subject: 'harvest/y', why: HOSTILE }]);
    assert.deepEqual(st.fired.map(f => f.label), ['harvest/a']);
    assert.equal(st.lastError, null);
  });

  await t.test('a refused poll: the cause, the kernel\'s error, the source\'s own words apart, and the last good poll\'s lists', async () => {
    fx.control({ mode: 'refuse', error: { code: 'E_GRAPH_DOWN', message: HOSTILE } }); tick();
    const st = triggerStatus(await answered({ kind: 'trigger', action: 'status' }), 'ws/trusted', { source: SOURCE });
    assert.deepEqual([st.lastPoll.ok, st.lastPoll.cause, st.lastPoll.says], [false, 'refused', { code: 'E_GRAPH_DOWN', message: HOSTILE }]);
    assert.equal(typeof st.lastPoll.error, 'string');
    assert.deepEqual([st.lastError.code, st.lastError.message, st.lastError.at], ['E_TRIGGER_POLL', st.lastPoll.error, st.lastPoll.at], 'the same failure, said twice by the kernel');
    assert.deepEqual(st.skipped, [{ subject: 'harvest/y', why: HOSTILE }], 'the lists are the last good poll\'s');
    const before = ran().length;
    const tested = testResult(await answered({ kind: 'trigger', action: 'test', key: 'ws/trusted', runSource: true }), 'trigger', { source: SOURCE });
    assert.deepEqual([tested.source.ok, tested.source.cause, tested.source.says, tested.problems, tested.wouldFire], [false, 'refused', { code: 'E_GRAPH_DOWN', message: HOSTILE }, [], []]);
    assert.equal(ran().length, before + 1);
  });

  await t.test('a source whose script is gone: the gate answers without the flag; only a confirmed test finds the failed check, and nothing runs', async () => {
    fx.control({ result: GOOD });
    fx.commit({ [`capabilities/${CAPABILITY}/bin/source.mjs`]: null }, 'the script is gone'); must(fx.cli(['sync', '--json']), 'sync');
    const before = ran().length;
    const bare = await auto({ kind: 'trigger', action: 'test', key: 'ws/trusted' });
    assert.deepEqual([bare.status, bare.reason?.code], ['unavailable', 'E_TRIGGER_SOURCE_RUN'], JSON.stringify(bare));
    const tested = testResult(await answered({ kind: 'trigger', action: 'test', key: 'ws/trusted', runSource: true }), 'trigger', { source: SOURCE });
    assert.deepEqual([tested.ok, tested.source.ok, tested.source.invalid.code, tested.problems, tested.wouldFire], [false, false, 'E_TRIGGER_SOURCE', [], []]);
    assert.match(tested.source.invalid.message, /is not a file inside capability acme\.graph's directory$/);
    assert.equal(ran().length, before, 'no source ran: there is none to run');
    fx.commit({ [`capabilities/${CAPABILITY}/bin/source.mjs`]: { text: sourceScript() } }, 'the script is back'); must(fx.cli(['sync', '--json']), 'sync');
  });

  await t.test('capabilities show: the declared sources, then a declaration with problems, through the server\'s projection', async () => {
    const catalog = () => JSON.parse(must(fx.cli(['capabilities', '--json']), 'capabilities').stdout).result.capabilities;
    const show = () => capabilityShowRequest({ action: 'show', capability: { name: CAPABILITY, kind: 'member', repoKey: fx.key } },
      { workspace, cli, catalog: catalog(), invoke: (c, options) => cliWorkspace(c, options, io()) });
    assert.deepEqual(triggerSourcesView(await show()), { sources: [{ name: NAME, events: ['opened', 'updated'], description: HARVEST.description, problems: [] }] });
    fx.commit({ [`capabilities/${CAPABILITY}/oats.json`]: { json: { capability: CAPABILITY, version: '0.0.0-workspace', description: 'acme.graph fixture capability.', compatibility: { oats: '>=0.24.0' },
      ...capabilityManifest({ [NAME]: { ...HARVEST, command: 'missing' }, good: HARVEST, 'Bad Name': 7 }) } } }, 'break the source');
    must(fx.cli(['sync', '--json']), 'sync');
    const broken = await show(), view = triggerSourcesView(broken);
    assert.deepEqual(view.sources.map(s => [s.name, Array.isArray(s.events), s.problems.length > 0]), [[NAME, true, true], ['good', true, false], ['Bad Name', false, true]]);
    assert.match(view.sources[0].problems[0], /command "missing"/);
    assert.deepEqual(broken.problems, [], 'a malformed declaration is not a problem of the capability');
    // The failed meaning check reaches the row at the next poll, as its own state.
    fx.control({ result: { events: [] } }); tick();
    const row = automationRows(await answered({ kind: 'trigger', action: 'list' }), 'trigger').rows.find(r => r.id === 'ws/trusted');
    assert.equal(row.invalid?.code, 'E_TRIGGER_SOURCE'); assert.equal(typeof row.invalid.at, 'string', '`at`: checked at a poll');
    const st = triggerStatus(await answered({ kind: 'trigger', action: 'status' }), 'ws/trusted', { source: SOURCE });
    assert.deepEqual([st.invalid.code, st.invalid.at], [row.invalid.code, row.invalid.at]);
  });

  assert.equal(argvs.some(argv => argv.includes(TRIGGER_RUN_SOURCE_FLAG) && !(argv[0] === 'trigger' && argv[1] === 'test')), false, 'no other verb ever carried the flag');
});
