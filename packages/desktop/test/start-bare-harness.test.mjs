// The Start and Restart dialog offers the bare harness (awebai/oats#1079). The kernel's way to it is
// `--launch-config none`, and it is the way out of a start refused because it names a harness and no
// configuration where several are declared for that harness and none is the default (awebai/oats#999).
//
// Held here: the word and who is known to read it (packages/client/launch-contract.mjs), the key by which
// the server says so (server/launch-configs.mjs), what the adapter and the start route send, and the choice
// in the dialog (renderer/launch-config-fields.mjs, renderer/start-instance.mjs). The sentence for the
// refusal is start-refusal-sentence.test.mjs's; what the word does on the real kernel is the root test's
// (test/desktop-start-bare-harness-kernel.test.mjs). No kernel sentence is written in this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { LAUNCH_CONFIG_NONE, launchConfigNoneKnown } from '../../client/launch-contract.mjs';
import { answeringFeatures } from '../../client/lifecycle-contract.mjs';
import { cliStart, cliLaunchConfig } from '../../client/cli-adapter.mjs';
import { requireRemoteSupport } from '../../client/cli-locator.mjs';
import { harnessFlag } from '../../client/harness-names.mjs';
import { canAddressRemote, unaddressableSentence } from '../../client/remote-address.mjs';
import { retainedSpawnDetails } from '../../client/launch-prompt-outcome.mjs';
import { launchConfigRequest } from '../server/launch-configs.mjs';
import { LABEL, BARE_LINE, PREVIEW_ONLY, HERE, PERSONAL, PLACES, workspace, agents, home, instances, onServer, envelope, settle, dialog } from './helpers/start-dialog.mjs';

/* ── The word, and who is known to read it ── */

test('the word is one constant of the launch vocabulary', () => {
  assert.equal(LAUNCH_CONFIG_NONE, 'none');
});

test('launchConfigNoneKnown: only a kernel known to read the word is true (this computer, a server\'s host, and each way of not knowing)', () => {
  const lists = features => ({ ok: true, features });
  const TABLE = [
    ['this computer\'s kernel lists launch-config', { cli: HERE, routed: false }, true],
    ['this computer\'s kernel does not list it', { cli: lists(['session-start']), routed: false }, false],
    ['a server whose host\'s list names it', { cli: HERE, routed: true, group: { probe: { ok: true, features: ['status', 'launch-config'] } } }, true],
    ['a server whose host\'s list does not name it', { cli: HERE, routed: true, group: { probe: { ok: true, features: ['status'] } } }, false],
    ['a server whose host\'s list is empty', { cli: HERE, routed: true, group: { probe: { ok: true, features: [] } } }, false],
    ['a server whose host reports no list (before 0.49.0)', { cli: HERE, routed: true, group: { probe: { ok: true, features: null } } }, false],
    ['a server whose roster read failed', { cli: HERE, routed: true, group: { probe: { ok: false, features: ['launch-config'] } } }, false],
    ['a server with no roster group held', { cli: HERE, routed: true }, false],
    ['a server read by a CLI that does not relay the hosts\' lists', { cli: lists(['launch-config']), routed: true, group: { probe: { ok: true, features: ['launch-config'] } } }, false],
    ['no accepted CLI', { cli: { ok: false, features: ['launch-config'] }, routed: false }, false],
  ];
  for (const [name, asked, known] of TABLE) assert.equal(launchConfigNoneKnown(answeringFeatures(asked)), known, name);
  // The function itself: an array that names the feature, and nothing else.
  assert.equal(launchConfigNoneKnown(['launch-config']), true);
  for (const unknown of [null, undefined, [], ['launch-config-default'], 'launch-config', { 0: 'launch-config', length: 1 }, true]) assert.equal(launchConfigNoneKnown(unknown), false, JSON.stringify(unknown));
});

/* ── The server says it: one key of the Desktop's own on the list answer ── */

test('the list answer of the launch configurations carries noneKnown, the Desktop\'s own: for a home here, and for a server\'s by its host\'s list', async () => {
  const listed = { context: '/team', configurations: [{ name: 'personal', harness: 'codex', source: '/team' }] };
  const ask = (ws, cli = HERE, result = listed, action = 'list') => launchConfigRequest({ action, selector: { home } },
    { workspace: ws, cli, agents, instances, localCwd: '/local', invoke: async () => envelope(result) });
  assert.deepEqual(await ask(workspace), { ...listed, noneKnown: true }, 'this computer: its kernel lists launch-config, and the kernel\'s own keys pass as they came');
  assert.equal((await ask(onServer({ ok: true, features: ['launch-config'] }))).noneKnown, true, 'a host whose list names it');
  assert.equal((await ask(onServer({ ok: true, features: ['status'] }))).noneKnown, false, 'a host whose list does not');
  assert.equal((await ask(onServer({ ok: true, features: null }))).noneKnown, false, 'a host that reports no list');
  assert.equal((await ask(onServer({ ok: false }))).noneKnown, false, 'a host that was not read');
  assert.equal((await ask(onServer({ ok: true, features: ['launch-config'] }), { ...HERE, features: HERE.features.filter(f => f !== 'server-probe-features') })).noneKnown, false,
    'a CLI here that does not relay the hosts\' lists');
  // The key is the Desktop's: an answer that claims it is not believed.
  assert.equal((await ask(onServer({ ok: true, features: ['status'] }), HERE, { ...listed, noneKnown: true })).noneKnown, false);
  // Only the list answer carries it.
  assert.equal(Object.hasOwn(await ask(workspace, HERE, { command: 'x', ok: true }, 'preview'), 'noneKnown'), false);
});

/* ── What travels: the word, as given ── */

test('the adapter sends the word as --launch-config none, alone and beside a harness, for a start, a restart and a preview', async () => {
  const run = async (fn, args) => { let argv; await fn(HERE.bin, args, { exec: (_, a, _o, done) => { argv = a; done(null, JSON.stringify(envelope({}))); } }); return argv; };
  assert.deepEqual(await run(cliStart, { home, launchConfig: LAUNCH_CONFIG_NONE }), ['session', 'start', '--home', home, '--launch-config', 'none', '--json']);
  assert.deepEqual(await run(cliStart, { home, restart: true, server: 'host', workspaceDir: '/local', launchConfig: LAUNCH_CONFIG_NONE, harness: 'codex', harnessFlag: '--harness' }),
    ['session', 'restart', '--home', home, '--server', 'host', '--launch-config', 'none', '--harness', 'codex', '--json']);
  const preview = await run(cliLaunchConfig, { action: 'preview', home, choices: { launchConfig: LAUNCH_CONFIG_NONE, harness: 'codex', harnessFlag: '--harness' }, localCwd: '/team' });
  assert.deepEqual(preview.slice(preview.indexOf('--launch-config'), preview.indexOf('--launch-config') + 4), ['--launch-config', 'none', '--harness', 'codex']);
});

const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
test('the start route passes the word to the adapter as given, for a home here and for a server\'s, and adds no refusal of its own', async () => {
  const block = source.match(/\/\* OATSWEB_START_BEGIN[^]*?\*\/([^]*?)\/\* OATSWEB_START_END \*\//)?.[1];
  assert.ok(block);
  const invoke = new Function('inst', 'cliState', 'readBody', 'verifiedLocalHome', 'adapter', 'locator', 'dirname', 'harnessFlag', 'canAddressRemote', 'unaddressableSentence', 'retainedSpawnDetails', 'action',
    `return (async () => { const hm = [null, action], req = {}, res = {}, ctxs = ["/local"];
     const send = (_, status, body) => ({ status, body });
     const observeMutation = () => {}, refreshRemoteSnapshot = () => {}, url = { searchParams: new URLSearchParams("ws=/team") };
     ${block} })();`);
  const here = { instance: 'dev-one', home, agentsRoot: '/team/agents' }, there = { ...here, server: 'host', addressable: true };
  for (const inst of [here, there]) for (const action of ['start', 'restart']) for (const body of [{ launchConfig: LAUNCH_CONFIG_NONE }, { launchConfig: LAUNCH_CONFIG_NONE, harness: 'codex' }]) {
    let call = null;
    const adapter = { cliStart: async (bin, args) => { call = args; return { ok: true, result: { launched: true } }; } };
    const answer = await invoke(inst, HERE, async () => ({ ...body }), () => home, adapter, { requireRemoteSupport }, dirname, harnessFlag, canAddressRemote, unaddressableSentence, retainedSpawnDetails, action);
    assert.equal(answer.status, 200, `${action} ${inst.server ?? 'here'}`);
    assert.equal(call.launchConfig, 'none'); assert.equal(call.harness, body.harness); assert.equal(call.server, inst.server); assert.equal(call.restart, action === 'restart');
  }
});

/* ── The choice in the dialog ── */

for (const [place, at] of PLACES) test(`${place}: the choice is drawn second, under its own line, and the Harness list stays usable with it`, async () => {
  const d = dialog(at);
  try {
    await settle();
    assert.deepEqual(d.options(), [['', 'Keep the recorded launch'], [LAUNCH_CONFIG_NONE, LABEL], ['personal', 'personal (codex)']]);
    assert.equal(d.q('.launch-config-source').textContent, "Use this home's recorded launch.");
    d.choose(d.harness, 'codex');
    d.choose(d.select, LAUNCH_CONFIG_NONE);
    assert.equal(d.q('.launch-config-source').textContent, BARE_LINE);
    assert.equal(d.harness.disabled, false, 'the Harness list is usable');
    assert.equal(d.harness.value, 'codex', 'and keeps what was picked before the choice');
    d.choose(d.harness, 'pi'); assert.equal(d.harness.value, 'pi');
    // A named configuration still empties and disables it, as before.
    d.choose(d.select, 'personal');
    assert.equal(d.harness.disabled, true); assert.equal(d.harness.value, '');
    d.choose(d.select, LAUNCH_CONFIG_NONE);
    assert.equal(d.harness.disabled, false); assert.equal(d.q('.launch-config-source').textContent, BARE_LINE);
  } finally { d.close(); }
});

for (const [place, at] of PLACES) test(`${place}: the choice sends the word, alone with "Keep recorded harness" and beside a picked harness, at a start and at a preview`, async () => {
  for (const picked of ['', 'codex']) {
    const d = dialog(at);
    try {
      await settle();
      if (picked) d.choose(d.harness, picked);
      d.choose(d.select, LAUNCH_CONFIG_NONE);
      await d.preview();
      assert.deepEqual(d.previewed(), { action: 'preview', selector: { home }, choices: { ...(picked ? { harness: picked } : {}), launchConfig: 'none' } });
      assert.equal(d.q('.launch-config-status').textContent, PREVIEW_ONLY);
      await d.submit();
      assert.deepEqual(d.started(), { ...(picked ? { harness: picked } : {}), launchConfig: 'none' });
    } finally { d.close(); }
  }
});

test('the choice is drawn only when the server says the answering kernel is known to read the word', async () => {
  for (const [name, list] of [['false', { context: '/team', configurations: [PERSONAL], noneKnown: false }], ['absent', { context: '/team', configurations: [PERSONAL] }],
    ['not a boolean', { context: '/team', configurations: [PERSONAL], noneKnown: 'true' }]]) {
    const d = dialog({ list, server: 'host' });
    try {
      await settle();
      assert.deepEqual(d.options(), [['', 'Keep the recorded launch'], ['personal', 'personal (codex)']], name);
    } finally { d.close(); }
  }
});

test('a row of the list named as the word is never drawn as a configuration, so no entry of a list can send it', async () => {
  for (const name of [LAUNCH_CONFIG_NONE, [LAUNCH_CONFIG_NONE], { toString: () => LAUNCH_CONFIG_NONE }]) for (const noneKnown of [true, false]) {
    const named = { name, harness: 'codex', source: '/team', args: ['--from-a-list'] };
    const d = dialog({ list: { context: '/team', configurations: [named, PERSONAL], noneKnown } });
    try {
      await settle();
      assert.deepEqual(d.options(), [['', 'Keep the recorded launch'], ...(noneKnown ? [[LAUNCH_CONFIG_NONE, LABEL]] : []), ['personal', 'personal (codex)']], `noneKnown ${noneKnown}`);
      if (!noneKnown) continue;
      // The choice is the choice, not that row: its line, a usable Harness list, and an editor that holds nothing of the row.
      d.choose(d.select, LAUNCH_CONFIG_NONE);
      assert.equal(d.q('.launch-config-source').textContent, BARE_LINE);
      assert.equal(d.harness.disabled, false);
      assert.equal(d.q('.lc-name').value, ''); assert.equal(d.q('.lc-args').value, '[]');
    } finally { d.close(); }
  }
});
