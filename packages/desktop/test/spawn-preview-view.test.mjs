import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSpawnPreview } from '../renderer/spawn-preview-view.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';
import { previewFailure, PREVIEW_ONLY } from '../renderer/spawn-preview-contract.mjs';
import { view as readinessView, data as readinessData } from './helpers/readiness-fixture.mjs';
import { cli, soul, workspace, anchor, target, view, deferred, tick } from './helpers/spawn-preview-fixture.mjs';
function setup(t, api = () => view()) {
  const dom = new JSDOM(`<body><div class="spawn-modal"><select class="config"><option value=""></option></select><div class="soul-form">
  <input class="fmodel"><button class="spawn-native" type="button" disabled>Native</button><select class="fruntime"><option value=""></option><option>claude</option><option>codex</option></select>
  <select class="fbackend"><option value=""></option><option>tmux</option><option>herdr</option></select><select class="fyolo"><option value=""></option><option>true</option><option>false</option></select>
  <select class="fserver"><option value=""></option><option>remote</option></select><select class="frelation"><option>unrelated</option><option>child</option></select>
  <select class="frelto"><option value=""></option><option data-root="/team/agents">boss-1</option></select>
  <button class="old-preview" type="button">Old preview</button><details class="old-details" hidden><pre></pre></details><p class="old-status"></p><div class="spawn-work-row"></div>
  <textarea class="ftask"></textarea><div class="spawn-future-toggles"><label></label><label></label><label></label></div><div class="more"><label>Purpose<input class="fpurpose"></label></div>
  <div class="spawn-footer"><div class="old-readiness"></div><button class="fspawn" type="button">Spawn</button></div></div></div></body>`, { pretendToBeVisual: true });
  const doc = dom.window.document, modal = doc.querySelector('.spawn-modal'), previous = currentWorkspace(); setWorkspace('team');
  const one = s => modal.querySelector(s), calls = []; let currentCli = structuredClone(cli), ws = { ...workspace }, active = true, submitting = false;
  const layout = { config: one('.config'), preview: one('.old-preview'), previewDetails: one('.old-details'), launchStatus: one('.old-status'), readiness: one('.old-readiness') };
  const controller = createSpawnPreview(modal, { layout, ctx: { api: (path, opts) => { const body = JSON.parse(opts.body); calls.push({ path, body }); return api(path, body); } },
    soul, workspace: () => ws, cli: () => currentCli, instances: () => [{ ...anchor, home: '/team/agents/boss/instances/boss-1' }], owns: () => active, submitting: () => submitting });
  t.after(() => { controller.dispose(); setWorkspace(previous); dom.window.close(); });
  controller.sync();
  return { dom, doc, modal, one, calls, controller, change(s, value) { const el = one(s); el.value = value; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); el.dispatchEvent(new dom.window.Event('change', { bubbles: true })); },
    setCli(c) { currentCli = c; controller.sync(); }, setWorkspace(w) { ws = w; controller.sync(); }, setActive(v) { active = v; controller.sync(); }, submitting(v) { submitting = v; } };
}
test('API2 only explicit Preview/Suggest; task stays private and Suggest never rewrites purpose', async t => {
  const u = setup(t); assert.equal(u.calls.length, 0); assert.equal(u.one('.old-preview').hidden, true);
  u.change('.fpurpose', 'review'); u.change('.ftask', 'PRIVATE INSTRUCTION'); u.change('.fmodel', 'unlisted/model,fallback');
  for (let n = 0; n < 5; n++) u.controller.sync(); assert.equal(u.calls.length, 0);
  u.one('.spawn-k6-preview').click(); await tick(); assert.equal(u.calls.length, 1);
  assert.equal(u.calls[0].body.choices.purpose, 'review'); assert.deepEqual(u.calls[0].body.choices.model, { kind: 'custom', value: 'unlisted/model,fallback' });
  assert.doesNotMatch(JSON.stringify(u.calls), /PRIVATE|task|expectDecision/); assert.match(u.one('.spawn-k6-details').textContent, /not submitted|not a launch receipt/);
  u.one('.spawn-k6-suggest').click(); await tick(); assert.equal(u.calls.length, 2); assert.equal(u.calls[1].body.choices.purpose, undefined); assert.equal(u.one('.fpurpose').value, 'review');
});
test('preview-only choices disable legacy submit, survive downgrade, and have a reachable reset', async t => {
  const u = setup(t); u.change('.preview-branch', 'feat/read'); assert.equal(u.controller.canSubmit(), PREVIEW_ONLY); assert.equal(u.one('.fspawn').disabled, true);
  u.setCli({ ...cli, spawnPreviewApi: 1, features: ['spawn-preview'] }); assert.equal(u.one('.preview-branch').disabled, true);
  assert.equal(u.one('.spawn-k6-panel').hidden, false); assert.equal(u.one('.spawn-k6-reset').disabled, false);
  u.one('.spawn-k6-preview').dispatchEvent(new u.dom.window.Event('click')); await tick(); assert.equal(u.calls.length, 0);
  u.one('.spawn-k6-reset').click(); assert.equal(u.controller.canSubmit(), ''); assert.equal(u.one('.fspawn').disabled, false);
});
test('native-default is a preview-only tagged mode, not a legacy model string; old controls cannot run it', async t => {
  const u = setup(t); u.one('.spawn-native').click(); assert.equal(u.one('.fmodel').value, ''); assert.equal(u.controller.canSubmit(), PREVIEW_ONLY);
  u.one('.spawn-k6-preview').click(); await tick(); assert.deepEqual(u.calls[0].body.choices.model, { kind: 'native-default' });
  u.change('.fmodel', 'custom'); assert.equal(u.controller.canSubmit(), '');
  const button = u.one('.spawn-k6-preview'); u.controller.dispose(); button.click(); await tick(); assert.equal(u.calls.length, 1);
});
test('reset never unlocks a legacy spawn in flight', t => {
  const u = setup(t); u.change('.preview-base', 'release'); u.submitting(true); u.one('.spawn-k6-reset').click(); assert.equal(u.one('.fspawn').disabled, true);
  u.submitting(false); u.controller.sync(); assert.equal(u.one('.fspawn').disabled, false);
});
for (const reject of [false, true]) for (const boundary of ['edit', 'CLI', 'workspace', 'A-B-A', 'close', 'global']) test(`stale ${reject ? 'rejection' : 'success'} after ${boundary} cannot paint or unlock`, async t => {
  const requests = []; const u = setup(t, () => { const d = deferred(); requests.push(d); return d.promise; }); u.one('.spawn-k6-preview').click();
  if (boundary === 'close') u.controller.dispose();
  else if (boundary === 'global') { setWorkspace('other'); setWorkspace('team'); }
  else {
    if (boundary === 'edit') u.change('.fpurpose', 'new');
    if (boundary === 'CLI') u.setCli({ ...cli, bin: '/other/oats' });
    if (boundary === 'workspace' || boundary === 'A-B-A') { u.setWorkspace({ ...workspace, id: 'other' }); if (boundary === 'A-B-A') u.setWorkspace(workspace); }
    u.one('.spawn-k6-preview').click(); requests.at(-1).resolve(previewFailure('E_BASE_UNKNOWN')); await tick();
  }
  const before = u.modal.innerHTML, focused = u.doc.activeElement;
  if (reject) requests[0].reject(Error('PRIVATE')); else requests[0].resolve(view());
  await tick(); assert.equal(u.modal.innerHTML, before); assert.equal(u.doc.activeElement, focused);
});
test('observed soul K5 Ready never erases a K6 refusal or certifies draft overrides', async t => {
  const rt = { workspace: 'team', context: '/team', observedAs: 'soul', selector: { kind: 'soul', soul: 'dev', agentsRoot: '/team/agents' } };
  const rd = readinessData(rt); rd.checks.configured.status = 'pass'; rd.checks.configured.items[0].status = 'pass'; rd.summary = { ready: true, required: 3, pass: 3, fail: 0, unknown: 0 };
  const u = setup(t, path => path.startsWith('/api/workspace-readiness') ? readinessView(rt, rd) : previewFailure('E_BASE_UNKNOWN'));
  u.setCli({ ...cli, readinessApi: 1, features: [...cli.features, 'readiness'] }); await tick();
  assert.match(u.modal.textContent, /Observed soul readiness.*not the proposed launch/); assert.match(u.one('.readiness-status').textContent, /^Ready/);
  u.one('.spawn-k6-preview').click(); await tick(); assert.match(u.one('.spawn-k6-status').textContent, /base does not resolve/);
  assert.match(u.one('.readiness-status').textContent, /^Ready/); assert.equal(u.calls.filter(c => c.path.startsWith('/api/workspace-spawn-preview')).length, 1);
});

test('remote execution never substitutes local K6; protocol/transport errors are safe, not launch success', async t => {
  const u = setup(t, () => { throw Error('PRIVATE'); });
  u.change('.fserver', 'remote'); u.controller.sync(); u.one('.spawn-k6-preview').click(); await tick(); assert.equal(u.calls.length, 0);
  u.change('.fserver', ''); u.controller.sync(); u.one('.spawn-k6-preview').click(); await tick();
  assert.match(u.one('.spawn-k6-status').textContent, /could not complete/); assert.doesNotMatch(u.modal.textContent, /PRIVATE/); assert.equal(u.one('.spawn-k6-details').hidden, true);
});
