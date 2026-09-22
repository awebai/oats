import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createLifecycleDialog } from '../renderer/lifecycle-dialog.mjs';
import { lifecycleReceipt } from '../renderer/lifecycle-contract.mjs';
import { pullRequest } from '../renderer/forge-contract.mjs';
import { pr as rawPr } from './helpers/forge-fixture.mjs';
import { instance, target, options, stopPlan, retirePlan, stopReceipt, retireReceipt, deferred, tick } from './helpers/lifecycle-fixture.mjs';
const reference = 'd'.repeat(64), newReference = 'e'.repeat(64);
const planned = (operation = 'stop', planRef = reference, raw) => ({ lifecycleApi: 1, status: 'plan', target,
  planRef, plan: raw || (operation === 'stop' ? stopPlan() : retirePlan()), options: options(operation), receipt: null, reason: null });
function fixture({ request, ...extra } = {}) {
  const dom = new JSDOM('<!doctype html><button id="opener">Actions</button>', { pretendToBeVisual: true });
  const doc = dom.window.document, calls = [], settled = []; let generation = 0, workspaceChange;
  const dialog = createLifecycleDialog({ doc, generation: () => generation,
    subscribeWorkspace: fn => { workspaceChange = fn; return () => {}; }, onSettled: (...args) => settled.push(args),
    request: async (workspace, body) => { calls.push({ workspace, body }); return request ? request(workspace, body)
      : { ...planned(body.operation), options: body.options, plan: body.operation === 'stop' ? stopPlan(body.options.recursive) : retirePlan() }; }, ...extra });
  return { dom, doc, dialog, calls, settled, open: (operation = 'stop') => dialog.open({ operation, instance, workspace: 'team' }),
    bumpGenerationWithoutEvent() { generation++; }, switchWorkspace() { generation++; workspaceChange(); }, button: cls => doc.querySelector(`.${cls}`),
    close() { dialog.dispose(); dom.window.close(); } };
}
test('opening reads a plan only; exact selector/typed facts render; explicit confirm submits only opaque ref', async () => {
  const gate = deferred(); const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned() : gate.promise });
  try {
    f.doc.getElementById('opener').focus(); f.open(); await tick();
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].body.action, 'plan'); assert.equal(f.calls[0].body.selector.home, undefined);
    assert.match(f.doc.body.textContent, /Mid-task \(reported\)true/); assert.match(f.doc.body.textContent, /2 changed · 1 untracked/);
    f.button('lifecycle-confirm').click(); f.button('lifecycle-confirm').click(); await tick();
    assert.deepEqual(f.calls[1].body, { action: 'apply', planRef: reference }); assert.equal(f.calls.length, 2);
    assert.equal(f.button('lifecycle-close').textContent, 'Close status');
    const raw = stopReceipt({ revision: stopPlan().planRevision, key: 'server' });
    gate.resolve({ lifecycleApi: 1, status: 'complete', target, receipt: lifecycleReceipt(raw, stopPlan(), 'server') }); await tick();
    assert.match(f.doc.body.textContent, /Kernel operation completed/); assert.equal(f.button('lifecycle-confirm').disabled, true);
    f.dialog.close(); assert.equal(f.doc.activeElement.id, 'opener');
  } finally { f.close(); }
});
test('changing Stop children or Remove choices revokes the displayed ref and obtains a fresh plan', async () => {
  const f = fixture();
  try {
    f.open(); await tick(); const check = f.doc.querySelector('input'); check.checked = false; check.dispatchEvent(new f.dom.window.Event('change')); await tick();
    assert.equal(f.calls.at(-1).body.options.recursive, false);
    f.open('retire'); await tick(); const inputs = [...f.doc.querySelectorAll('input')];
    assert.equal(inputs[2].disabled, true); inputs[1].checked = true; inputs[1].dispatchEvent(new f.dom.window.Event('change')); await tick();
    assert.equal(f.calls.at(-1).body.options.discardWorktree, true); assert.equal(inputs[2].disabled, false);
    inputs[2].checked = true; inputs[2].dispatchEvent(new f.dom.window.Event('change')); await tick();
    assert.deepEqual(f.calls.at(-1).body.options, { discardWorktree: true, deleteBranch: true });
    assert.ok(f.calls.every(c => c.body.action === 'plan'));
  } finally { f.close(); }
});
test('late plan success AND rejection after A→B→A cannot repaint a newer modal', async () => {
  for (const reject of [false, true]) {
    const gate = deferred(); let n = 0;
    const f = fixture({ request: () => ++n === 1 ? gate.promise : planned('retire') });
    f.open(); f.dialog.close(); f.open('retire'); await tick(); const before = f.doc.body.innerHTML;
    if (reject) gate.reject(new Error('PRIVATE')); else gate.resolve(planned()); await tick();
    assert.equal(f.doc.body.innerHTML, before); f.close();
  }
});
test('old controls after close/reopen and workspace replacement cannot confirm or close the new selection', async () => {
  const f = fixture();
  f.open(); await tick(); const oldApply = f.button('lifecycle-confirm'), oldClose = f.button('lifecycle-close');
  f.dialog.close(); f.open('retire'); await tick(); const before = f.calls.length;
  oldApply.click(); oldClose.click(); await tick(); assert.equal(f.calls.length, before); assert.ok(f.doc.querySelector('.lifecycle-overlay'));
  f.switchWorkspace(); assert.equal(f.doc.querySelector('.lifecycle-overlay'), null); f.close();
});
test('workspace generation invalidates existing controls even before a disposal notification arrives', async () => {
  const f = fixture(); f.open(); await tick(); const count = f.calls.length;
  f.bumpGenerationWithoutEvent(); f.button('lifecycle-confirm').click(); [...f.doc.querySelectorAll('button')].find(b => b.textContent === 'Refresh plan').click(); await tick();
  assert.equal(f.calls.length, count); f.button('lifecycle-close').click(); assert.equal(f.doc.querySelector('.lifecycle-overlay'), null); f.close();
});

test('E_PLAN_STALE displays producer fresh facts but requires NEW explicit confirmation; no automatic apply', async () => {
  const fresh = stopPlan(); fresh.planRevision = 'c'.repeat(24); fresh.targets[0].work.changed = 9;
  const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned() : { ...planned('stop', newReference, fresh), status: 'stale', reason: { code: 'E_PLAN_STALE' } } });
  f.open(); await tick(); f.button('lifecycle-confirm').click(); await tick();
  assert.match(f.doc.body.textContent, /9 changed/); assert.match(f.doc.body.textContent, /confirm again/);
  assert.equal(f.calls.length, 2); assert.equal(f.button('lifecycle-confirm').disabled, false);
  f.button('lifecycle-confirm').click(); await tick(); assert.equal(f.calls[2].body.planRef, newReference); f.close();
});
test('transport loss is unknown and explicit Check result keeps the same ref; Close cannot cancel a dispatched operation', async () => {
  let attempts = 0;
  const f = fixture({ request: (_ws, body) => {
    if (body.action === 'plan') return planned(); attempts++; throw new Error('PRIVATE connection lost');
  } });
  f.open(); await tick(); f.button('lifecycle-confirm').click(); await tick();
  assert.match(f.doc.body.textContent, /no confirmed outcome/); assert.doesNotMatch(f.doc.body.textContent, /PRIVATE/);
  f.button('lifecycle-retry').click(); await tick(); assert.equal(attempts, 2);
  assert.deepEqual(f.calls.filter(c => c.body.action === 'apply').map(c => c.body.planRef), [reference, reference]);
  f.dialog.close(); assert.equal(f.calls.length, 3, 'close issues no signal/cancel request'); f.close();
});
test('late apply success and rejection after close never steal focus or refresh a newer view', async () => {
  for (const reject of [false, true]) {
    const gate = deferred(), f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned() : gate.promise });
    f.open(); await tick(); f.button('lifecycle-confirm').click(); await tick(); f.dialog.close(); const focused = f.doc.activeElement;
    if (reject) gate.reject(new Error('PRIVATE')); else gate.resolve({ lifecycleApi: 1, status: 'complete', target,
      receipt: lifecycleReceipt(stopReceipt({ key: 'k', revision: stopPlan().planRevision }), stopPlan(), 'k') });
    await tick(); assert.equal(f.settled.length, 0); assert.equal(f.doc.activeElement, focused); assert.equal(f.doc.querySelector('.lifecycle-overlay'), null); f.close();
  }
});
test('branch skip remains partial even after home/worktree removal; ambiguous children are not hidden or acted on', async () => {
  const raw = retirePlan(); raw.facts.ambiguous = [{ instance: 'kid', agent: 'ops', home: '/ops/kid', reason: 'parent not unique' }];
  const result = retireReceipt({ key: 'k', revision: raw.planRevision }); result.worktreeRemoved = true;
  result.retention = { worktree: 'removed', branch: 'changed', recordedBranch: 'agents/dev-1', branchDeletionSkipped: { expected: 'feat/work', actual: 'changed', reason: 'changed after confirmation' } };
  const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned('retire', reference, raw)
    : { lifecycleApi: 1, status: 'partial', target, receipt: lifecycleReceipt(result, raw, 'k') } });
  f.open('retire'); await tick(); assert.match(f.doc.body.textContent, /not unique/); assert.match(f.doc.body.textContent, /ops\/kid/);
  f.button('lifecycle-confirm').click(); await tick(); assert.match(f.doc.body.textContent, /Branch deletion skipped/); assert.match(f.doc.body.textContent, /Home removedtrue/);
  assert.doesNotMatch(f.doc.body.textContent, /Kernel operation completed/); f.close();
});
test('a correlated PR link uses external-open only while this confirmation owns it', async () => {
  const opened = [], raw = { ...rawPr(), headRefName: 'feat/work', title: '<script>inert title</script>' };
  const f = fixture({ openExternal: url => opened.push(url),
    gitRequest: async () => ({ target, status: 'available', observationKey: reference, data: { observation: { revision: 'a'.repeat(40), branch: 'feat/work' } } }),
    forgeRequest: async () => ({ forgeApi: 1, target, status: 'available', observation: { key: reference, revision: 'a'.repeat(40), branch: 'feat/work' }, host: 'github.com', repository: 'owner/repo',
      data: pullRequest(raw, { host: 'github.com', path: 'owner/repo', branch: 'feat/work' }) }) });
  f.open('retire'); await tick(); await tick(); const link = f.doc.querySelector('.lifecycle-forge a'); assert.ok(link);
  assert.equal(f.doc.querySelector('script'), null); link.click(); assert.deepEqual(opened, [raw.url]);
  f.switchWorkspace(); link.click(); assert.equal(opened.length, 1); f.close();
});

test('connection change invalidates old forge success/rejection without invalidating the lifecycle plan', async () => {
  for (const reject of [false, true]) {
    const gate = deferred(); let account = 0, changed, calls = 0;
    const f = fixture({ connectionGeneration: () => account, subscribeConnections: fn => { changed = fn; return () => {}; },
      gitRequest: async () => ({ target, status: 'available', observationKey: reference, data: { observation: { revision: 'a'.repeat(40), branch: 'feat/work' } } }),
      forgeRequest: () => ++calls === 1 ? gate.promise : Promise.resolve({ forgeApi: 1, status: 'not-connected' }) });
    f.open('retire'); await tick(); account++; changed(); await tick();
    if (reject) gate.reject(new Error('PRIVATE')); else gate.resolve({ forgeApi: 1, target, status: 'no-pull-request', data: null, observation: { key: reference, revision: 'a'.repeat(40), branch: 'feat/work' }, host: 'github.com', repository: 'owner/repo' });
    await tick(); assert.match(f.doc.querySelector('.lifecycle-forge').textContent, /unknown/); assert.equal(f.button('lifecycle-confirm').disabled, false); f.close();
  }
});

test('forge overlay requires target/revision/branch/repository match; late rejection leaves unknown, never no PR', async () => {
  for (const mode of ['match', 'revision', 'repo', 'reject']) {
    const f = fixture({ gitRequest: async () => ({ target, status: 'available', observationKey: reference, data: { observation: { revision: 'a'.repeat(40), branch: 'feat/work' } } }),
      forgeRequest: async () => { if (mode === 'reject') throw new Error('PRIVATE'); return { forgeApi: 1, target, status: 'no-pull-request', data: null,
        observation: { key: reference, revision: (mode === 'revision' ? 'b' : 'a').repeat(40), branch: 'feat/work' }, host: 'github.com', repository: mode === 'repo' ? 'other/repo' : 'owner/repo' }; } });
    f.open('retire'); await tick(); await tick();
    assert.match(f.doc.querySelector('.lifecycle-forge').textContent, mode === 'match' ? /No pull request reported/ : /unknown/); f.close();
  }
});
