import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { JSDOM } from 'jsdom';
import { memberLabel, moduleDriftText, servedIdentityText, soulSourceText } from '../renderer/deployment-facts.mjs';
import { createDeploymentHeader, deploymentUnavailableText, lockStateLines } from '../renderer/deployment-header.mjs';
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

test('module drift names moved/missing rows with reason and origin; the recorded map says drift is unobserved', () => {
  const i = instance();
  i.modules[0] = { ...i.modules[0], status: 'moved', current: { commit: 'f'.repeat(40) } };
  i.modules[1] = { ...i.modules[1], status: 'missing', reason: 'capability-absent', current: null };
  const text = moduleDriftText(i.modules);
  assert.match(text, /^nw-deploy: moved since — package nw\.tools @ 98aa32b; nw-house-style: missing \(capability-absent\) — member agents @ 42dda77; 3 current$/);
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

test('lock state and unavailable text use header ID arrays and named features', () => {
  const h = workspaceStatusData(header, context);
  assert.deepEqual(lockStateLines(h), ['Every locked package is approved.']);
  assert.deepEqual(lockStateLines({ ...h, approval: { approved: [], needed: ['a', 'b'] } }), ['Approval needed: a, b']);
  assert.match(deploymentUnavailableText({ status: 'unavailable', reason: { code: 'E_DEPLOYMENT_FEATURE', feature: 'served-identity' } }), /does not advertise served-identity/);
  assert.equal(deploymentUnavailableText({ status: 'unavailable', reason: { code: 'E_X', message: 'kernel said' } }), 'E_X: kernel said');
  assert.equal(deploymentUnavailableText({ status: 'observed' }), '');
});

test('withheld instance rows are reported in the header with their names', () => {
  const dom = new JSDOM('<section></section>');
  const view = createDeploymentHeader(dom.window.document.querySelector('section'));
  view.update({ status: 'observed', workspaceStatus: workspaceStatusData(header, context), reachable: { reachable: true },
    withheld: [{ agent: 'release-manager', instance: 'rm-evil', reason: 'home-outside-soul' }] });
  assert.match(dom.window.document.body.textContent, /1 instance row was withheld: .*\(rm-evil\)/);
  view.dispose(); view.update({ status: 'pending' });
  assert.equal(dom.window.document.querySelector('section').textContent, '', 'a disposed header stays inert');
  dom.window.close();
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
