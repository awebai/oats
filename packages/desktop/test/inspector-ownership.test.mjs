import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { createSoulInspector } from '../renderer/soul-inspector.mjs';
import { postJson, wsQuery, workspaceGeneration, currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';
import { runtimeState } from '../renderer/instance-presentation.mjs';
import { createSoulMark } from '../renderer/identity-marks.mjs';
import { capabilityFacts, reportedText } from '../renderer/workspace-discovery.mjs';
import { renderSoulDeclarations } from '../renderer/soul-declarations.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = (request, outcome, value) => outcome === 'resolve' ? request.resolve(value) : request.reject(new Error('obsolete request failed'));
const selection = root => ({ agent: { name: 'dev', agentsRoot: `/team/${root}/agents` }, selector: { soul: 'dev', agentsRoot: `/team/${root}/agents` } });
// Current CLI inspection contract: operation declarations are arrays on enabled
// layer capabilities; souls use camelCase values and CLI-named editable fields.
function inspection(root) {
  return {
    operationsApi: 1, scope: { context: `/team/${root}` }, selected: { source: 'config' },
    souls: [{ ...selection(root).agent, runtime: 'pi', model: `${root}-model`, launchConfig: `${root}-launch`,
      editable: { fields: ['model', 'launch-config'], instructions: true }, instructions: { text: `${root}-instructions` } }],
    layers: { knowledge: { id: `fixture.${root}` } },
    capabilities: [{ id: `fixture.${root}`, layer: 'knowledge', activation: { enabled: true },
      operations: [{ name: 'inspect', kind: 'view', available: true, args: [] }, { name: 'digest', kind: 'action', available: true, args: [] }] }],
  };
}
function ui(api, factory = createSoulInspector) {
  const previousWorkspace = currentWorkspace(); setWorkspace('/team');
  const dom = new JSDOM('<body><main><aside></aside></main></body>');
  const el = dom.window.document.querySelector('aside');
  const calls = []; let compatible = true, changes = 0;
  const controller = factory(el, { available: () => compatible, changed: () => changes++,
    ctx: { api: async (url, opts) => { const body = JSON.parse(opts.body); calls.push({ url, ...body }); return api(body); } } });
  const control = text => { const b = [...el.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(b, `button ${text}`); return b; };
  return { dom, el, controller, calls, control, click: text => control(text).click(),
    operation: name => [...el.querySelectorAll('[data-operation]')].find(b => b.dataset.operation === `knowledge:${name}`),
    status: () => el.querySelector('[role="status"]').textContent,
    setCompatible(value) { compatible = value; controller.syncAvailability(); },
    get changes() { return changes; },
    close() { controller.dispose(); dom.window.close(); setWorkspace(previousWorkspace); },
  };
}

async function saveRefreshRace(outcome, boundary, factory = createSoulInspector) {
  const refresh = deferred(); let aReads = 0;
  const view = ui(body => {
    if (body.action === 'set') return { file: '/team/a/agents/dev/soul/soul.yaml' };
    assert.equal(body.action, 'inspect');
    if (body.selector.agentsRoot === selection('a').selector.agentsRoot && ++aReads === 2) return refresh.promise;
    return inspection(body.selector.agentsRoot === selection('a').selector.agentsRoot ? 'a' : 'b');
  }, factory);
  try {
    await view.controller.show(selection('a')); view.click('Edit defaults');
    view.el.querySelector('[name="model"]').value = 'saved-a-model'; view.click('Save defaults'); await tick();
    assert.deepEqual(view.calls.map(c => c.action), ['inspect', 'set', 'inspect'], 'race is at the post-save second await');
    if (boundary === 'selection') await view.controller.show(selection('b'));
    else if (boundary === 'workspace') { setWorkspace('/elsewhere'); setWorkspace('/team'); }
    else view.controller.dispose();
    const before = view.el.innerHTML;
    settle(refresh, outcome, inspection('a')); await tick();
    assert.equal(view.el.innerHTML, before, 'stale save refresh must not paint or unlock current owner');
    assert.equal(view.changes, 0, 'stale save refresh must not notify current owner');
    if (boundary === 'selection') {
      view.click('Edit defaults');
      assert.equal(view.el.querySelector('[name="model"]').value, 'b-model');
      assert.equal(view.control('Save defaults').disabled, false);
      view.click('Cancel');
      assert.match(view.el.textContent, /b-instructions/, 'Cancel must render B data, not the obsolete A refresh');
      assert.match(view.el.textContent, /fixture\.b/);
      assert.ok(view.control('Edit defaults'));
      view.click('Edit defaults');
      assert.equal(view.el.querySelector('[name="launch-config"]').value, 'b-launch');
    }
    assert.equal(view.calls.length, boundary === 'selection' ? 4 : 3, 'no incidental refresh or mutation');
    assert.deepEqual(view.calls[1].selector, selection('a').selector);
    assert.deepEqual(view.calls[1].fields, { model: 'saved-a-model' });
    assert.equal(view.calls[2].url, '/api/capabilities?ws=%2Fteam');
  } finally { view.close(); }
}

async function operationDowngrade(outcome, factory = createSoulInspector) {
  const request = deferred();
  const view = ui(body => body.action === 'inspect' ? inspection('a') : request.promise, factory);
  try {
    await view.controller.show(selection('a'));
    const control = view.operation('inspect'); control.click();
    view.controller.syncAvailability();
    assert.equal(control.disabled, true, 'availability sync must preserve the operation pending lock');
    // A queued click cannot bypass the lock even if dispatched directly.
    control.dispatchEvent(new view.dom.window.Event('click'));
    assert.equal(view.calls.length, 2, 'pending operation must not dispatch twice');
    view.setCompatible(false);
    settle(request, outcome, { result: { summary: 'current view' } }); await tick();
    assert.equal(control.disabled, true, 'settlement must preserve CLI unavailability');
    assert.equal(view.operation('digest').disabled, true);
    assert.equal(view.status(), outcome === 'resolve' ? 'Complete.' : 'obsolete request failed', 'current completion still reports its result');
    control.dispatchEvent(new view.dom.window.Event('click'));
    assert.equal(view.calls.length, 2, 'downgrade never reruns an operation');
    view.setCompatible(true);
    assert.equal(control.disabled, false, 'only a settled operation can unlock on CLI recovery');
    assert.equal(view.calls.length, 2, 'CLI recovery is not a rerun');
  } finally { view.close(); }
}

async function operationOverlap(outcome, factory = createSoulInspector) {
  const first = deferred(), second = deferred();
  const view = ui(body => body.action === 'inspect' ? inspection('a') : body.operation === 'knowledge:inspect' ? first.promise : second.promise, factory);
  try {
    await view.controller.show(selection('a'));
    const inspect = view.operation('inspect'), digest = view.operation('digest');
    inspect.click(); digest.click(); view.controller.syncAvailability();
    assert.ok(inspect.disabled && digest.disabled, 'each overlapping operation keeps its pending lock');
    const message = view.status();
    settle(first, outcome, { result: { summary: 'obsolete output' } }); await tick();
    assert.equal(view.status(), message, 'older operation cannot replace latest status on success or rejection');
    assert.equal(view.el.querySelector('.operation-output'), null, 'older operation cannot paint output');
    assert.equal(inspect.disabled, false, 'older operation releases only its own lock');
    assert.equal(digest.disabled, true, 'older settlement must not unlock a different pending operation');
    settle(second, outcome, { result: { currentDigest: true } }); await tick();
    assert.equal(view.status(), outcome === 'resolve' ? 'Complete.' : 'obsolete request failed');
    if (outcome === 'resolve') assert.match(view.el.querySelector('.operation-output pre').textContent, /"currentDigest": true/);
    assert.equal(digest.disabled, false, 'latest operation releases its own lock');
    assert.deepEqual(view.calls.filter(c => c.action === 'run').map(c => c.operation), ['knowledge:inspect', 'knowledge:digest'], 'no incidental rerun');
  } finally { view.close(); }
}

async function operationInvalidation(outcome, boundary, factory = createSoulInspector) {
  const first = deferred(), second = deferred(); let runs = 0;
  const view = ui(body => body.action === 'inspect' ? inspection(body.selector.agentsRoot === selection('a').selector.agentsRoot ? 'a' : 'b') : ++runs === 1 ? first.promise : second.promise, factory);
  try {
    await view.controller.show(selection('a'));
    const oldControl = view.operation('inspect'); oldControl.click();
    if (boundary === 'selection') {
      await view.controller.show(selection('b')); view.operation('inspect').click();
      oldControl.dispatchEvent(new view.dom.window.Event('click'));
      assert.equal(runs, 2, 'obsolete control must not dispatch against the new selection');
    } else if (boundary === 'workspace') {
      setWorkspace('/elsewhere'); setWorkspace('/team'); view.controller.syncAvailability();
    } else {
      view.click('Edit defaults');
    }
    const before = view.el.innerHTML;
    settle(first, outcome, { result: { summary: 'obsolete output' } }); await tick();
    assert.equal(view.el.innerHTML, before, 'invalidated operation must not paint, report errors or unlock current controls');
    if (boundary === 'selection') {
      assert.equal(view.operation('inspect').disabled, true);
      second.resolve({ result: { summary: 'B output' } }); await tick();
      assert.match(view.el.textContent, /B output/);
      assert.equal(view.operation('inspect').disabled, false);
      assert.deepEqual(view.calls.filter(c => c.action === 'run').map(c => c.selector), [selection('a').selector, selection('b').selector]);
    } else if (boundary === 'editor') {
      view.click('Cancel');
      assert.equal(view.operation('inspect').disabled, false, 'replacement control has no pending owner');
      oldControl.dispatchEvent(new view.dom.window.Event('click'));
      assert.equal(runs, 1, 'detached operation control cannot run after editor cancellation');
    } else assert.equal(oldControl.disabled, true, 'workspace generation remains unavailable until fresh inspection');
  } finally { view.close(); }
}

for (const outcome of ['resolve', 'reject']) {
  for (const boundary of ['selection', 'workspace', 'dispose']) {
    test(`post-save refresh ${outcome} respects ${boundary} ownership`, () => saveRefreshRace(outcome, boundary));
  }
  test(`operation ${outcome} retains pending and downgraded CLI availability`, () => operationDowngrade(outcome));
  test(`overlapping operations own separate locks on ${outcome}`, () => operationOverlap(outcome));
  for (const boundary of ['selection', 'workspace', 'editor']) {
    test(`operation ${outcome} respects ${boundary} ownership`, () => operationInvalidation(outcome, boundary));
  }
}

// Bounded mutation verification of these regressions only, entirely in memory.
// Never replace the live worktree module or launch an app to test a mutant.
function mutant(from, to) {
  const source = createSoulInspector.toString();
  assert.equal(source.split(from).length, 2, 'mutation targets exactly one production guard');
  return runInNewContext(`(${source.replace(from, to)})`, { postJson, wsQuery, workspaceGeneration, runtimeState, capabilityFacts, reportedText, createSoulMark, renderSoulDeclarations });
}
test('mutation: committing post-save data before validation is detected by Cancel', async () => {
  const factory = mutant("const refreshed = await request({ action: 'inspect', selector: target.selector }, query);", "const refreshed = data = await request({ action: 'inspect', selector: target.selector }, query);");
  await assert.rejects(saveRefreshRace('resolve', 'selection', factory), /Cancel must render B data/);
});
test('mutation: stale save rejection must retain the ownership guard', async () => {
  const factory = mutant("if (!valid(id, gen)) return;\n      busy = false; content.querySelectorAll", 'busy = false; content.querySelectorAll');
  await assert.rejects(saveRefreshRace('reject', 'selection', factory), /stale save refresh must not paint/);
});
test('mutation: pending ownership is essential during availability sync', async () => {
  const factory = mutant('busy || pendingOperations.has(control) || !available()', 'busy || !available()');
  await assert.rejects(operationDowngrade('resolve', factory), /availability sync must preserve/);
});
for (const outcome of ['resolve', 'reject']) {
  test(`mutation: unconditional operation unlock is detected on ${outcome}`, async () => {
    const factory = mutant('pendingOperations.delete(control); syncAvailability();', 'pendingOperations.delete(control); control.disabled = false;');
    await assert.rejects(operationDowngrade(outcome, factory), /settlement must preserve CLI unavailability/);
  });
  test(`mutation: latest operation status ownership is essential on ${outcome}`, async () => {
    const factory = mutant('ownsControl() && op === operationSerial', 'ownsControl()');
    await assert.rejects(operationOverlap(outcome, factory), /older operation cannot replace latest status/);
  });
  test(`mutation: workspace generation is essential on ${outcome}`, async () => {
    const factory = mutant(' && gen === workspaceGeneration()', '');
    await assert.rejects(operationInvalidation(outcome, 'workspace', factory), /invalidated operation must not paint/);
  });
}
