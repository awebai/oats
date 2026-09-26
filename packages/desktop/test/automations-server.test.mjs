// Triggers and schedules (feature automations, automationsApi 1; kernel 2b #213): the
// server boundary for the Schedules + Triggers views. Kernel captures:
// test/fixtures/automations/kernel (main, scratch Northwind; host fixture-laptop,
// stub gh fixture-bot), replayed through the real adapter argv and the boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cliAutomation, AUTOMATION_ID } from '../cli-adapter.mjs';
import { automationsRequest, automationsSupported } from '../server/automations.mjs';

const doc = name => JSON.parse(readFileSync(new URL(`./fixtures/automations/kernel/${name}.json`, import.meta.url), 'utf8'));
const provenance = doc('provenance');
const version = doc('version');
const DEPLOYMENT = '/fixture/base/northwind-workspace';
const cli = { ok: true, bin: '/fixture/oats', version: version.version, features: [...version.features], automationsApi: version.automationsApi };
const workspace = { id: 'northwind', scope: DEPLOYMENT };
/** The adapter with an exec that answers the captured document for this argv. */
const replay = name => { const calls = [];
  const invoke = (bin, opts) => cliAutomation(bin, opts, { exec: (b, argv, o, done) => { calls.push({ bin: b, argv, cwd: o.cwd, shell: o.shell });
    const d = doc(name); done(d.ok ? null : Object.assign(new Error('exit 1'), { code: 1 }), JSON.stringify(d)); } });
  return { invoke, calls };
};
const captured = name => provenance.files[name].argv.slice(1).map(v => v.replaceAll('<base>', '/fixture/base'));

test('the capture: feature automations, automationsApi 1; the rows carry placement the Desktop never derives', () => {
  assert.ok(version.features.includes('automations')); assert.equal(version.automationsApi, 1);
  assert.equal(automationsSupported(cli), true);
  for (const bad of [{ ...cli, automationsApi: undefined }, { ...cli, features: cli.features.filter(f => f !== 'automations') }, { ...cli, ok: false }, null]) assert.equal(automationsSupported(bad), false);
  const triggers = doc('trigger-list').result.triggers;
  assert.deepEqual(triggers.map(t => [t.qualifiedId, t.origin.kind, t.runsHere, t.reason]), [
    ['local/hotfix', 'local', true, null], ['agents/docs-sync', 'workspace', false, 'assigned-elsewhere'],
    ['agents/pr-review', 'workspace', true, null], ['agents/triage', 'workspace', false, 'owner-mismatch']]);
  assert.deepEqual(doc('schedule-list').result.schedules.map(s => [s.qualifiedId, s.origin.kind, s.runsHere]),
    [['local/digest', 'local', true], ['agents/nightly', 'workspace', true], ['agents/weekly', 'workspace', false]]);
  assert.equal(doc('trigger-list').result.snapshot.problems, 1, 'the wrong-kind file is a discovery problem, not a row');
});

test('list, enable/disable, test and run: the captured argv, the kernel\'s document verbatim', async () => {
  for (const [name, request] of [['trigger-list', { kind: 'trigger', action: 'list' }], ['schedule-list', { kind: 'schedule', action: 'list' }],
    ['trigger-disable', { kind: 'trigger', action: 'disable', key: 'agents/pr-review' }], ['trigger-enable', { kind: 'trigger', action: 'enable', key: 'agents/pr-review' }],
    ['schedule-disable', { kind: 'schedule', action: 'disable', key: 'agents/nightly' }], ['trigger-test', { kind: 'trigger', action: 'test', key: 'agents/pr-review' }], ['trigger-status', { kind: 'trigger', action: 'status' }],
    ['schedule-test', { kind: 'schedule', action: 'test', key: 'agents/nightly' }], ['schedule-test-elsewhere', { kind: 'schedule', action: 'test', key: 'agents/weekly' }],
    ['trigger-test-mismatch', { kind: 'trigger', action: 'test', key: 'agents/triage' }]]) {
    const { invoke, calls } = replay(name);
    const out = await automationsRequest(request, { workspace, cli, invoke });
    assert.deepEqual(calls.map(c => c.argv), [captured(name)], `${name}: the Desktop argv is the argv the kernel was captured with`);
    assert.equal(calls[0].shell, false); assert.equal(calls[0].cwd, DEPLOYMENT);
    assert.equal(out.status, 'ok', name); assert.deepEqual(out.result, doc(name).result, `${name}: verbatim`);
    assert.deepEqual([out.kind, out.action, out.reason], [request.kind, request.action, null]);
  }
  const mismatch = await automationsRequest({ kind: 'trigger', action: 'test', key: 'agents/triage' }, { workspace, cli, invoke: replay('trigger-test-mismatch').invoke });
  assert.equal(mismatch.result.placement.reason, 'owner-mismatch', 'the kernel\'s placement, not the Desktop\'s');
});

test('kernel refusals keep their own code and message (E_AUTOMATION_NOT_HERE, E_AUTOMATION_WORKSPACE)', async () => {
  const run = await automationsRequest({ kind: 'schedule', action: 'run', key: 'agents/weekly' }, { workspace, cli, invoke: replay('schedule-run-elsewhere').invoke });
  assert.equal(run.status, 'unavailable'); assert.equal(run.reason.code, 'E_AUTOMATION_NOT_HERE');
  assert.equal(run.reason.message, doc('schedule-run-elsewhere').error.message);
  assert.equal(doc('schedule-remove-workspace').error.code, 'E_AUTOMATION_WORKSPACE', 'workspace items are edited in Git (captured)');
});

test('gates and admission: no call without the feature, a known local workspace and a valid verb/id', async () => {
  let calls = 0; const invoke = async () => { calls++; return { ok: true, result: { triggers: [] } }; };
  const cases = [
    [{ kind: 'trigger', action: 'list' }, { ...cli, automationsApi: undefined }, workspace, 'E_AUTOMATIONS_UNAVAILABLE'],
    [{ kind: 'trigger', action: 'list' }, cli, undefined, 'E_WORKSPACE_UNKNOWN'],
    [{ kind: 'trigger', action: 'list' }, cli, { ...workspace, remote: true, server: 'host' }, 'E_UNSUPPORTED_REMOTE'],
    [{ kind: 'trigger', action: 'run', key: 'agents/pr-review' }, cli, workspace, 'E_BAD_ARGS'],
    [{ kind: 'trigger', action: 'reconcile', key: 'agents/pr-review' }, cli, workspace, 'E_BAD_ARGS'],
    [{ kind: 'schedule', action: 'remove', key: 'local/digest' }, cli, workspace, 'E_BAD_ARGS'],
    [{ kind: 'trigger', action: 'list', key: 'x' }, cli, workspace, 'E_BAD_ARGS'],
    [{ kind: 'trigger', action: 'enable', id: 'agents/pr-review' }, cli, workspace, 'E_BAD_ARGS'],
    [{ kind: 'trigger', action: 'enable' }, cli, workspace, 'E_BAD_ARGS'],
    [{ kind: 'trigger', action: 'enable', key: 'agents/pr-review', extra: 1 }, cli, workspace, 'E_BAD_ARGS'],
    [{ kind: 'automation', action: 'list' }, cli, workspace, 'E_BAD_ARGS'],
  ];
  for (const [request, c, w, code] of cases) assert.equal((await automationsRequest(request, { workspace: w, cli: c, invoke })).reason.code, code, JSON.stringify(request));
  assert.equal(calls, 0);
  // A document of the wrong shape is a protocol failure, never rendered.
  assert.equal((await automationsRequest({ kind: 'schedule', action: 'list' }, { workspace, cli, invoke: async () => ({ ok: true, result: { triggers: [] } }) })).reason.code, 'E_CLI_PROTOCOL');
  assert.equal((await automationsRequest({ kind: 'trigger', action: 'status' }, { workspace, cli, invoke: async () => ({ ok: true, result: { schedules: [] } }) })).reason.code, 'E_CLI_PROTOCOL');
});

test('ids: qualified or bare, never option-shaped or with a path; the adapter refuses before exec', async () => {
  for (const ok of ['local/digest', 'agents/pr-review', 'digest', 'nw.tools/job_1']) assert.ok(AUTOMATION_ID.test(ok), ok);
  for (const bad of ['--dir', '-x', 'a/b/c', '../x', 'a b', '', '/abs', 'agents/', 'x'.repeat(65)]) {
    assert.equal(AUTOMATION_ID.test(bad), false, bad);
    const r = await cliAutomation('/fixture/oats', { kind: 'trigger', action: 'enable', id: bad, workspaceDir: DEPLOYMENT }, { exec: () => assert.fail('must not execute') });
    assert.equal(r.error.code, 'E_BAD_ARGS', bad);
  }
  const r = await cliAutomation('/fixture/oats', { kind: 'trigger', action: 'list', workspaceDir: 'relative' }, { exec: () => assert.fail('must not execute') });
  assert.equal(r.error.code, 'E_BAD_ARGS');
});

test('the renderer adapter reads the real kernel shapes the boundary serves (a check on the hand-built view fixtures)', async () => {
  const { automationRows, testResult, triggerStatus } = await import('../renderer/automation-rows.mjs');
  const t = automationRows(doc('trigger-list').result, 'trigger');
  assert.deepEqual(t.host, { name: 'fixture-laptop', ghUser: { 'github.com': 'fixture-bot' } });
  assert.equal(t.snapshot.problems, 1); assert.equal(t.scheduler.installed, false);
  assert.deepEqual(t.rows.map(r => [r.id, r.group, r.origin.kind, typeof r.origin.localPath]), [
    ['local/hotfix', 'here', 'local', 'string'], ['agents/docs-sync', 'elsewhere', 'workspace', 'string'],
    ['agents/pr-review', 'here', 'workspace', 'string'], ['agents/triage', 'attention', 'workspace', 'string']]);
  const s = automationRows(doc('schedule-list').result, 'schedule');
  assert.deepEqual(s.rows.map(r => [r.id, r.group, r.run]), [['local/digest', 'here', 'command'], ['agents/nightly', 'here', 'spawn'], ['agents/weekly', 'elsewhere', 'command']]);
  const mismatch = testResult(doc('trigger-test-mismatch').result, 'trigger');
  assert.equal(mismatch.ok, false); assert.match(mismatch.problems[0], /owner-mismatch/);
  assert.deepEqual([testResult(doc('schedule-test').result, 'schedule').ok, testResult(doc('schedule-test').result, 'schedule').nextDue], [true, doc('schedule-test').result.test.nextDue]);
  assert.match(testResult(doc('schedule-test-elsewhere').result, 'schedule').problems[0], /assigned-elsewhere/);
  assert.deepEqual(triggerStatus(doc('trigger-status').result, 'agents/pr-review'), { fired: [], firedTotal: 0, live: [], liveCount: 0, max: 1, pending: [], lastPoll: null, lastError: null });
});
