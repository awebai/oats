import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { JSDOM } from 'jsdom';
import { memberLabel, moduleDriftText, servedIdentityText, soulSourceText } from '../renderer/deployment-facts.mjs';
import { deploymentUnavailableText } from '../renderer/deployment-header.mjs';
import { deploymentNotes, lockNotes } from '../renderer/workspace-catalog.mjs';
import { deploymentStatusData, workspaceStatusData } from '../deployment-data.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/${name}.json`, import.meta.url), 'utf8'));
const status = fixture('status'), header = fixture('workspace-status');
const context = dirname(status.root);
const instance = () => structuredClone(deploymentStatusData(status, context).agents[0].instances[0]);

test('captured roster facts render in the kernel\'s own terms', () => {
  const i = instance();
  assert.equal(soulSourceText(i.soul), `repo: agents @ ${i.soul.commit.slice(0, 7)}`);
  assert.equal(moduleDriftText(i.modules), '5 current');
  assert.equal(servedIdentityText(i.identity), null, 'the captured Northwind instance has no served identity');
  assert.equal(memberLabel('local//x/fx/remotes/nw-tools.git'), 'nw-tools');
});

test('served identity from the exit-0 capture: absent key stays absent; local and grant rows are copied, keyed on provider presence', () => {
  const rows = Object.fromEntries(deploymentStatusData(fixture('status-identities'), context).agents[0].instances.map(i => [i.instance, i]));
  assert.equal(Object.hasOwn(rows['release-manager-cap'], 'identity'), false, 'no identity key is synthesized');
  assert.equal(servedIdentityText(rows['release-manager-cap'].identity), null);
  assert.deepEqual(rows['release-manager-local-id'].identity, { mode: 'local', alias: 'release-manager-local-id', team: 'engineering:example.org', address: null, resident: null, provider: 'example.chat' });
  assert.equal(servedIdentityText(rows['release-manager-local-id'].identity), 'alias release-manager-local-id on engineering:example.org');
  assert.deepEqual(rows['release-manager-grant-id'].identity.grant, { expiresAt: '2026-12-31T00:00:00Z' });
  assert.equal(servedIdentityText(rows['release-manager-grant-id'].identity), 'acts as example.org/release-manager via grant, expires 2026-12-31T00:00:00Z');
  const renamed = { ...rows['release-manager-local-id'].identity, provider: 'some.other.provider' };
  assert.equal(servedIdentityText(renamed), servedIdentityText(rows['release-manager-local-id'].identity), 'rendering never keys on a provider name');
});

test('module drift names moved/missing rows with reason and origin; the recorded map says drift is unobserved', () => {
  const i = instance();
  i.modules[0] = { ...i.modules[0], status: 'moved', current: { commit: 'f'.repeat(40) } };
  i.modules[1] = { ...i.modules[1], status: 'missing', reason: 'capability-absent', current: null };
  const text = moduleDriftText(i.modules);
  // Names, origins and recorded commits come from the capture (never hand-typed SHAs).
  const [a, b] = i.modules, at = m => m.commit.slice(0, 7);
  assert.deepEqual([a.name, a.from.kind, a.from.package, b.name, b.from.kind], ['nw-deploy', 'package', 'nw.tools', 'nw-house-style', 'member']);
  assert.equal(text, `nw-deploy: moved since — package nw.tools @ ${at(a)}; nw-house-style: missing (capability-absent) — member agents @ ${at(b)}; 3 current`);
  assert.equal(moduleDriftText({ a: {}, b: {} }), '2 recorded — drift not observed (workspace unreachable)');
  assert.equal(moduleDriftText([]), 'None');
  assert.equal(moduleDriftText(undefined), null);
});

test('soul source reports the member moved since, never a computed drift', () => {
  const soul = { ...instance().soul, status: 'moved', current: '1234567abcdef' };
  assert.match(soulSourceText(soul), /— member moved since \(now @ 1234567\)$/);
  assert.equal(soulSourceText({ ...soul, status: 'no-longer-present' }).endsWith('— no-longer-present'), true);
  assert.equal(soulSourceText(null), null);
});

test('served identity follows the documented layer contract; absent stays absent', () => {
  assert.equal(servedIdentityText({ mode: 'global', address: 'example.aweb.ai/coordinator', grant: { id: 'g', expiresAt: '2026-09-24T18:00:00Z' } }),
    'acts as example.aweb.ai/coordinator via grant, expires 2026-09-24T18:00:00Z');
  assert.equal(servedIdentityText({ mode: 'local', alias: 'dev-one', team: 'aweb:example' }), 'alias dev-one on aweb:example');
  for (const absent of [undefined, null, 'string']) assert.equal(servedIdentityText(absent), null);
});

test('lock notes and unavailable text use workspace status arrays and named features', () => {
  const h = workspaceStatusData(header, context);
  assert.deepEqual(lockNotes(h), [], 'a locked, approved, declared set needs no note');
  assert.deepEqual(lockNotes({ ...h, unsynced: ['a'], stale: ['b'] }).map(n => n.text),
    ['Declared but not locked: a. Sync to lock them.', 'Locked but no longer declared: b. Sync to drop them.']);
  assert.match(deploymentUnavailableText({ status: 'unavailable', reason: { code: 'E_DEPLOYMENT_FEATURE', feature: 'served-identity' } }), /does not advertise served-identity/);
  assert.equal(deploymentUnavailableText({ status: 'unavailable', reason: { code: 'E_X', message: 'kernel said' } }), 'E_X: kernel said');
  assert.equal(deploymentUnavailableText({ status: 'observed' }), '');
});

test('withheld instance rows and an unreachable workspace are reported with their names and codes', () => {
  const notes = deploymentNotes({ status: 'observed', workspaceStatus: workspaceStatusData(header, context),
    reachable: { reachable: false, code: 'E_REMOTE_UNREADABLE', message: 'network' },
    withheld: [{ agent: 'release-manager', instance: 'rm-evil', reason: 'home-outside-soul' }] }).map(n => n.text);
  assert.match(notes[0], /Workspace unreachable — module drift is not current\. E_REMOTE_UNREADABLE: network/);
  assert.match(notes[1], /1 instance row was withheld: .*\(rm-evil\)/);
});

test('the context panel instance page projects soul source, modules and served identity from the roster row', async () => {
  const dom = new JSDOM('<!doctype html><html><body><aside id="context-panel"></aside></body></html>', { url: 'http://localhost' });
  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = dom.window.document; globalThis.window = dom.window;
  try {
    const { createContextPanel } = await import('../renderer/context-panel.mjs');
    const panel = createContextPanel(dom.window.document.getElementById('context-panel'), {});
    const row = { ...instance(), identity: { mode: 'local', alias: 'dev-one', team: 'aweb:example' } };
    panel.setContext({ workspace: { id: context }, instance: row, key: row.home });
    const field = id => dom.window.document.querySelector(`[data-context-field="${id}"]`).textContent;
    assert.equal(field('soulSource'), `repo: agents @ ${row.soul.commit.slice(0, 7)}`);
    assert.equal(field('modules'), '5 current');
    assert.equal(field('identity'), 'alias dev-one on aweb:example');
    panel.setContext({ workspace: { id: context }, instance: instance(), key: row.home });
    assert.equal(field('identity'), 'Not reported', 'absent identity is never synthesized');
    panel.dispose?.();
  } finally { globalThis.document = previous.document; globalThis.window = previous.window; dom.window.close(); }
});
