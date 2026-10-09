// Triggers and schedules (feature automations, automationsApi 1; kernel 2b #213): the
// server boundary for the Schedules + Triggers views. Kernel captures:
// test/fixtures/automations/kernel (main, scratch Northwind; host fixture-laptop,
// stub gh fixture-bot), replayed through the real adapter argv and the boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cliAutomation, AUTOMATION_ID } from '../cli-adapter.mjs';
import { automationsRequest, automationsSupported, automationDescriptionsSupported } from '../server/automations.mjs';

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

test('schedule actions carry 100-character names through server and CLI, preserving trigger and option guards', async () => {
  const actions = { schedule: ['enable', 'disable', 'test', 'run', 'reconcile'], trigger: ['enable', 'disable', 'test'] };
  for (const kind of ['schedule', 'trigger']) {
    const limit = kind === 'schedule' ? 100 : 64; // Existing trigger action admission remains unchanged; the kernel validates definitions.
    for (const action of actions[kind]) {
      for (const prefix of ['', 'local/', 'repo/']) {
        for (const [name, valid] of [['s'.repeat(64), true], ['s'.repeat(65), kind === 'schedule'], ['s'.repeat(limit), true], ['s'.repeat(limit + 1), false], ['--dir', false], ['-x', false], ['a/b/c', false], ['a b', false], ['a\0b', false], ['', false]]) {
          const id = prefix + name, calls = [];
          const io = { exec: (bin, argv, options, done) => {
            calls.push(argv); assert.equal(options.shell, false);
            done(null, JSON.stringify({ schemaVersion: 1, ok: true, result: {} }));
          } };
          const invoke = (bin, opts) => cliAutomation(bin, opts, io);
          const out = await automationsRequest({ kind, action, key: id }, { workspace, cli, invoke });
          const label = `${kind} ${action} ${JSON.stringify(id)}`;
          assert.equal(out.status, valid ? 'ok' : 'unavailable', label);
          if (valid) assert.deepEqual(calls, [[kind, action, id, '--dir', DEPLOYMENT, '--json']], label);
          else {
            assert.equal(out.reason.code, 'E_BAD_ARGS', label);
            assert.deepEqual(calls, [], label);
            const direct = await cliAutomation(cli.bin, { kind, action, id, workspaceDir: DEPLOYMENT }, io);
            assert.equal(direct.error.code, 'E_BAD_ARGS', label);
            assert.deepEqual(calls, [], label);
          }
        }
      }
    }
  }
});

// describe (feature automation-descriptions, kernel 0.43): `<kind> update <local key> --description=<text>`.
// Kernel captures: test/fixtures/automation-descriptions (capture-descriptions.mjs on the K branch, provenance.json).
const described = name => JSON.parse(readFileSync(new URL(`./fixtures/automation-descriptions/${name}.json`, import.meta.url), 'utf8'));
const describedVersion = described('version'), describedProvenance = described('provenance');
const describeCli = { ok: true, bin: '/fixture/oats', version: describedVersion.version, features: [...describedVersion.features], automationsApi: describedVersion.automationsApi };
/** The kernel's captured answer to `<kind> update … --description=<text>` (set, or clear with ""). */
const updated = (kind, key, description) => described(`${kind}-update-${description ? 'describe' : 'clear'}`);
const describing = answer => { const calls = [];
  const invoke = (bin, opts) => cliAutomation(bin, opts, { exec: (b, argv, o, done) => { calls.push({ argv, cwd: o.cwd, shell: o.shell, timeout: o.timeout });
    const d = typeof answer === 'function' ? answer(argv) : answer; done(d.ok ? null : Object.assign(new Error('exit 1'), { code: 1 }), JSON.stringify(d)); } });
  return { invoke, calls };
};

test('describe: one --description= token on `update`, argv only, the kernel\'s result verbatim', async () => {
  for (const [kind, key, description] of [['schedule', 'local/digest', 'Daily digest of open PRs'], ['trigger', 'hotfix', 'Hotfix labels'],
    ['schedule', 'digest', ''], ['trigger', 'local/hotfix', '--json'], ['schedule', 'local/digest', '-x --dir /etc']]) {
    const answer = updated(kind, key, description), { invoke, calls } = describing(answer);
    const out = await automationsRequest({ kind, action: 'describe', key, description }, { workspace, cli: describeCli, invoke });
    assert.deepEqual(calls.map(c => c.argv), [[kind, 'update', key, `--description=${description}`, '--dir', DEPLOYMENT, '--json']], `${kind} ${JSON.stringify(description)}`);
    assert.notEqual(calls[0].shell, true); assert.equal(calls[0].cwd, DEPLOYMENT); assert.equal(calls[0].timeout, 30_000);
    assert.deepEqual([out.status, out.kind, out.action, out.reason], ['ok', kind, 'describe', null]); assert.deepEqual(out.result, answer.result);
  }
  const { invoke, calls } = describing(updated('schedule', 'digest', ''));
  await automationsRequest({ kind: 'schedule', action: 'describe', key: 'digest', description: '' }, { workspace, cli: describeCli, invoke });
  assert.equal(calls[0].argv[3], '--description=', 'clearing is exactly the empty `=` token');
});

test('describe: the captured argv (the capture ran in its scope; the Desktop adds --dir), and the captured answers', async () => {
  for (const name of ['schedule-update-describe', 'schedule-update-clear', 'trigger-update-describe', 'trigger-update-clear']) {
    const [, kind, , key, flag] = describedProvenance.files[name].argv, description = flag.slice('--description='.length);
    const { invoke, calls } = describing(described(name));
    const out = await automationsRequest({ kind, action: 'describe', key, description }, { workspace, cli: describeCli, invoke });
    assert.deepEqual(calls[0].argv, [...describedProvenance.files[name].argv.slice(1, -1), '--dir', DEPLOYMENT, '--json'], name);
    assert.equal(out.status, 'ok'); assert.equal(out.result[kind].qualifiedId, key);
    assert.equal(out.result[kind].description, description || null, `${name}: the row carries the new summary`);
  }
});

test('describe: gated on automation-descriptions; refused before any call when the key or summary is not admissible', async () => {
  assert.ok(describedVersion.features.includes('automation-descriptions'), 'the captured kernel reports the feature');
  assert.equal(automationDescriptionsSupported(cli), false, 'the 0.29 capture does not'); assert.equal(automationDescriptionsSupported(describeCli), true);
  assert.equal(automationDescriptionsSupported({ ...describeCli, automationsApi: undefined }), false); assert.equal(automationDescriptionsSupported(null), false);
  let calls = 0; const invoke = async () => { calls++; return updated('schedule', 'local/digest', 'x'); };
  const ok = { kind: 'schedule', action: 'describe', key: 'local/digest', description: 'Daily digest' };
  const gated = await automationsRequest(ok, { workspace, cli, invoke });
  assert.equal(gated.reason.code, 'E_DESCRIPTIONS_UNAVAILABLE'); assert.match(gated.reason.message, /0\.43/);
  assert.equal((await automationsRequest(ok, { workspace, cli: { ...describeCli, automationsApi: undefined }, invoke })).reason.code, 'E_AUTOMATIONS_UNAVAILABLE');
  assert.equal((await automationsRequest(ok, { workspace: { ...workspace, remote: true, server: 'host' }, cli: describeCli, invoke })).reason.code, 'E_UNSUPPORTED_REMOTE');
  for (const request of [{ ...ok, key: 'agents/nightly' }, { ...ok, kind: 'trigger', key: 'agents/pr-review' }, { ...ok, key: '--dir' }, { kind: 'schedule', action: 'describe', description: 'x' },
    { ...ok, description: 'one\ntwo' }, { ...ok, description: 'one\r' }, { ...ok, description: 'x'.repeat(201) }, { ...ok, description: 'tab\there' }, { ...ok, description: 'a\u0000b' },
    { ...ok, description: 'a\u2028b' }, { ...ok, description: 'a\u2029b' }, { ...ok, description: 'a\u007fb' }, { ...ok, description: 42 }, { ...ok, description: null }, { ...ok, description: ['x'] },
    { kind: 'schedule', action: 'describe', key: 'local/digest' }, { kind: 'trigger', action: 'enable', key: 'local/hotfix', description: 'x' }, { kind: 'trigger', action: 'list', description: '' },
    { ...ok, extra: 1 }, { ...ok, id: 'local/digest' }]) {
    assert.equal((await automationsRequest(request, { workspace, cli: describeCli, invoke })).reason.code, 'E_BAD_ARGS', JSON.stringify(request));
  }
  assert.equal(calls, 0);
  // The adapter keeps the same guard on its own (defense in depth).
  for (const opts of [{ kind: 'schedule', action: 'describe', id: 'agents/nightly', description: 'x' }, { kind: 'schedule', action: 'describe', id: 'digest' },
    { kind: 'trigger', action: 'describe', id: 'hotfix', description: 'a\nb' }, { kind: 'trigger', action: 'enable', id: 'hotfix', description: 'x' }, { kind: 'trigger', action: 'enable', id: 'hotfix', description: '' }]) {
    const r = await cliAutomation('/fixture/oats', { ...opts, workspaceDir: DEPLOYMENT }, { exec: () => assert.fail('must not execute') });
    assert.equal(r.error.code, 'E_BAD_ARGS', JSON.stringify(opts));
  }
});

test('describe: 200 code points of astral text is one line (code points, not UTF-16 units); 201 is not', async () => {
  const emoji = '\u{1F600}'.repeat(200); assert.equal(emoji.length, 400);
  const { invoke, calls } = describing(updated('trigger', 'local/hotfix', emoji));
  const out = await automationsRequest({ kind: 'trigger', action: 'describe', key: 'local/hotfix', description: emoji }, { workspace, cli: describeCli, invoke });
  assert.equal(out.status, 'ok'); assert.equal(calls[0].argv[3], `--description=${emoji}`);
  assert.equal((await automationsRequest({ kind: 'trigger', action: 'describe', key: 'local/hotfix', description: emoji + '\u{1F600}' }, { workspace, cli: describeCli, invoke })).reason.code, 'E_BAD_ARGS');
  assert.equal(calls.length, 1);
});

test('describe: kernel refusals keep their code and message; a success of the wrong shape is a protocol failure', async () => {
  // Captured refusals: out of rule, a workspace item (asked by a newer client), an unknown id, another flag.
  for (const [kind, name, code] of [['schedule', 'schedule-update-invalid', 'E_SCHEDULE_INVALID'], ['schedule', 'schedule-update-workspace', 'E_AUTOMATION_WORKSPACE'],
    ['trigger', 'trigger-update-workspace', 'E_AUTOMATION_WORKSPACE'], ['trigger', 'trigger-update-unknown', 'E_TRIGGER_UNKNOWN'], ['trigger', 'trigger-update-flag', 'E_BAD_ARGS']]) {
    const answer = described(name); assert.equal(answer.error.code, code, name);
    const { invoke } = describing(answer);
    const out = await automationsRequest({ kind, action: 'describe', key: 'local/x', description: 'Fine' }, { workspace, cli: describeCli, invoke });
    assert.deepEqual([out.status, out.reason.code, out.reason.message], ['unavailable', code, answer.error.message], name);
  }
  for (const [kind, result] of [['schedule', {}], ['trigger', {}], ['schedule', { trigger: {} }], ['trigger', { schedule: {} }], ['schedule', { schedule: [] }], ['trigger', { trigger: null }]]) {
    const { invoke } = describing({ schemaVersion: 1, ok: true, result });
    assert.equal((await automationsRequest({ kind, action: 'describe', key: 'local/x', description: 'Fine' }, { workspace, cli: describeCli, invoke })).reason.code, 'E_CLI_PROTOCOL', `${kind} ${JSON.stringify(result)}`);
  }
});

// ── runSource (feature trigger-sources, #669 2b item 7): the one request key that lets the kernel run a capability
// source's command for a test. Only the strict boolean `true`, only a trigger's test, only a CLI that declares the
// feature; the flag is composed in cliAutomation, from one constant. ──
test('runSource: refused everywhere but a trigger test on a CLI with trigger-sources, before any CLI runs', async () => {
  const { TRIGGER_RUN_SOURCE_FLAG, automationRunSourceValid } = await import('../cli-adapter.mjs');
  const { triggerSourcesSupported } = await import('../server/automations.mjs');
  const sources = { ...cli, features: [...cli.features, 'trigger-sources'] };
  assert.equal(TRIGGER_RUN_SOURCE_FLAG, '--run-source');
  assert.deepEqual([triggerSourcesSupported(sources), triggerSourcesSupported(cli), triggerSourcesSupported({ ...sources, automationsApi: 2 })], [true, false, false]);
  const never = () => assert.fail('must not execute');
  const refused = async (request, withCli = sources) => assert.deepEqual((await automationsRequest(request, { workspace, cli: withCli, invoke: never })).reason, { code: 'E_BAD_ARGS', message: 'Invalid automation request.' }, JSON.stringify(request));
  // Not the strict boolean true.
  for (const runSource of [false, 'true', 1, null, 'yes', {}, [true], undefined]) await refused({ kind: 'trigger', action: 'test', key: 'agents/pr-review', runSource });
  // Any action but test, and any kind but trigger.
  for (const action of ['list', 'status', 'enable', 'disable', 'describe']) await refused({ kind: 'trigger', action, ...(action === 'list' ? {} : { key: 'local/hotfix-watch' }), ...(action === 'describe' ? { description: 'x' } : {}), runSource: true });
  for (const action of ['list', 'test', 'run', 'enable', 'disable', 'reconcile']) await refused({ kind: 'schedule', action, ...(action === 'list' ? {} : { key: 'digest' }), runSource: true });
  // A CLI that does not declare trigger-sources.
  await refused({ kind: 'trigger', action: 'test', key: 'agents/pr-review', runSource: true }, cli);
  // The adapter refuses the same on its own, with nothing executed. It is told the probe's features by its
  // caller (it never probes): each case below has them, so what refuses it is the value, the action or the kind.
  const adapter = async o => assert.equal((await cliAutomation('/fixture/oats', { workspaceDir: DEPLOYMENT, features: sources.features, ...o }, { exec: never })).error.code, 'E_BAD_ARGS', JSON.stringify(o));
  for (const runSource of [false, 'true', 1, null]) await adapter({ kind: 'trigger', action: 'test', id: 'agents/pr-review', runSource });
  for (const o of [{ kind: 'trigger', action: 'status', id: 'agents/pr-review' }, { kind: 'trigger', action: 'list' }, { kind: 'trigger', action: 'enable', id: 'agents/pr-review' },
    { kind: 'schedule', action: 'test', id: 'digest' }, { kind: 'schedule', action: 'run', id: 'digest' }]) await adapter({ ...o, runSource: true });
  // And without the feature in the probe it was told, whatever else is right: no features, another list, not a list.
  for (const features of [undefined, null, [], cli.features, 'trigger-sources', { 'trigger-sources': true }, ['Trigger-Sources']]) await adapter({ kind: 'trigger', action: 'test', id: 'agents/pr-review', runSource: true, features });
  assert.deepEqual([automationRunSourceValid('trigger', 'test', true, sources.features), automationRunSourceValid('trigger', 'test', true), automationRunSourceValid('trigger', 'test', true, cli.features),
    automationRunSourceValid('trigger', 'test', undefined), automationRunSourceValid('schedule', 'run', undefined)], [true, false, false, true, true]);
  // The features alone change nothing: a test without runSource has the argv it always had, on either CLI.
  for (const features of [undefined, cli.features, sources.features]) {
    const calls = [];
    await cliAutomation('/fixture/oats', { kind: 'trigger', action: 'test', id: 'agents/pr-review', workspaceDir: DEPLOYMENT, features }, { exec: (b, argv, o, done) => { calls.push(argv); done(null, JSON.stringify(doc('trigger-test'))); } });
    assert.deepEqual(calls, [['trigger', 'test', 'agents/pr-review', '--dir', DEPLOYMENT, '--json']]);
  }
});

test('runSource: true reaches the argv as the flag, once; without it a test\'s argv is as before', async () => {
  const sources = { ...cli, features: [...cli.features, 'trigger-sources'] }, calls = [];
  const invoke = (bin, opts) => cliAutomation(bin, opts, { exec: (b, argv, o, done) => { calls.push({ argv, shell: o.shell }); done(null, JSON.stringify(doc('trigger-test'))); } });
  const confirmed = await automationsRequest({ kind: 'trigger', action: 'test', key: 'agents/pr-review', runSource: true }, { workspace, cli: sources, invoke });
  assert.equal(confirmed.status, 'ok');
  assert.deepEqual(calls[0], { argv: ['trigger', 'test', 'agents/pr-review', '--run-source', '--dir', DEPLOYMENT, '--json'], shell: false });
  assert.equal(calls[0].argv.filter(a => a === '--run-source').length, 1);
  await automationsRequest({ kind: 'trigger', action: 'test', key: 'agents/pr-review' }, { workspace, cli: sources, invoke });
  assert.deepEqual(calls[1].argv, ['trigger', 'test', 'agents/pr-review', '--dir', DEPLOYMENT, '--json'], 'no flag unless the request carries runSource');
  // The kernel's refusal of an unconfirmed run keeps its code for the renderer (the message is not parsed).
  const unconfirmed = JSON.parse(readFileSync(new URL('./fixtures/trigger-sources/trigger-test-unconfirmed.json', import.meta.url), 'utf8'));
  const answer = await automationsRequest({ kind: 'trigger', action: 'test', key: 'agents/pr-review' }, { workspace, cli: sources, invoke: async () => unconfirmed });
  assert.deepEqual([answer.status, answer.reason.code, answer.result], ['unavailable', 'E_TRIGGER_SOURCE_RUN', null]);
});
