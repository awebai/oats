import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createLifecycleDialog, lifecycleCSS } from '../renderer/lifecycle-dialog.mjs';
import { lifecycleReceipt, lifecycleReason } from '../renderer/lifecycle-contract.mjs';
import { pullRequest } from '../renderer/forge-contract.mjs';
import { pr as rawPr } from './helpers/forge-fixture.mjs';
import { createLifecycleBoundary } from '../server/instance-lifecycle.mjs';
import { cli, context, envelope, instance, target, options, stopPlan, retirePlan, stopReceipt, retireReceipt, deferred, tick } from './helpers/lifecycle-fixture.mjs';
import { assertIsolatedDetail, MESSY, MESSY_LINE } from './helpers/detail-line.mjs';
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
test('changing Stop children or the Remove choice revokes the displayed ref and obtains a fresh plan', async () => {
  const f = fixture();
  try {
    f.open(); await tick(); const check = f.doc.querySelector('input'); check.checked = false; check.dispatchEvent(new f.dom.window.Event('change')); await tick();
    assert.equal(f.calls.at(-1).body.options.recursive, false);
    f.open('retire'); await tick(); const inputs = [...f.doc.querySelectorAll('input')];
    assert.equal(inputs.length, 2, 'the children choice (hidden for Remove) and the worktree choice');
    assert.deepEqual(f.calls.at(-1).body.options, { discardWorktree: false }); assert.equal(inputs[1].disabled, false);
    inputs[1].checked = true; inputs[1].dispatchEvent(new f.dom.window.Event('change')); await tick();
    assert.deepEqual(f.calls.at(-1).body.options, { discardWorktree: true });
    inputs[1].checked = false; inputs[1].dispatchEvent(new f.dom.window.Event('change')); await tick();
    assert.deepEqual(f.calls.at(-1).body.options, { discardWorktree: false });
    assert.equal(f.calls.length, 5); assert.ok(f.calls.every(c => c.body.action === 'plan'));
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
/** Everything the dialog tells a person: its text, and every element's title, accessible name and description. */
const told = doc => [doc.body.textContent, ...[...doc.querySelectorAll('*')].flatMap(el => ['title', 'aria-label', 'aria-description', 'aria-valuetext', 'placeholder', 'value', 'alt']
  .map(name => el.getAttribute(name) ?? ''))].join('\n');
test('incomplete cleanup remains partial even after home removal; ambiguous children are not hidden or acted on', async () => {
  const raw = retirePlan(); raw.facts.ambiguous = [{ instance: 'kid', agent: 'ops', home: '/ops/kid', reason: 'parent not unique' }];
  const result = retireReceipt({ key: 'k', revision: raw.planRevision }); result.rollbackIncomplete = ['cleanup'];
  const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned('retire', reference, raw)
    : { lifecycleApi: 1, status: 'partial', target, receipt: lifecycleReceipt(result, raw, 'k') } });
  try {
    f.open('retire'); await tick(); assert.match(f.doc.body.textContent, /not unique/); assert.match(f.doc.body.textContent, /ops\/kid/);
    f.button('lifecycle-confirm').click(); await tick();
    assert.equal(f.doc.querySelector('.lifecycle-dialog [role=status]').textContent, 'Not every requested effect completed. Review the recorded outcome.');
    assert.match(f.doc.body.textContent, /Home removedtrue/); assert.doesNotMatch(f.doc.body.textContent, /Kernel operation completed/);
  } finally { f.close(); }
});
test('Remove shows one choice, the worktree, and says it never deletes a branch; its result has no branch row', async () => {
  const raw = retirePlan(), result = retireReceipt({ key: 'k', revision: raw.planRevision });
  const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned('retire', reference, raw)
    : { lifecycleApi: 1, status: 'complete', target, receipt: lifecycleReceipt(result, raw, 'k') } });
  try {
    f.open('retire'); await tick();
    const labels = [...f.doc.querySelectorAll('.lifecycle-options label')];
    assert.deepEqual(labels.filter(label => !label.hidden).map(label => label.textContent), ['Also delete the worktree']);
    assert.deepEqual(labels.map(label => label.textContent), ['Include recorded children', 'Also delete the worktree']);
    assert.equal(f.doc.querySelectorAll('.lifecycle-dialog input').length, 2);
    const explanation = f.doc.querySelector('.lifecycle-dialog > p.lifecycle-note').textContent;
    assert.ok(explanation.includes('The worktree is retained unless selected below. Remove never deletes a branch. The PR is never changed.'), explanation);
    assert.ok(explanation.startsWith('Remove the instance home. The kernel stops children first and retains their homes; if one will not stop, Remove refuses and names it.'), explanation);
    // The plan still reads both branches.
    const facts = [...f.doc.querySelectorAll('.lifecycle-facts dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent]);
    assert.deepEqual(facts.filter(([label]) => /branch/i.test(label)), [['Worktree branch', 'feat/work'], ['Recorded branch', 'agents/dev-1']]);
    assert.doesNotMatch(told(f.doc), /delete the local branch|local branch/i);
    f.button('lifecycle-confirm').click(); await tick();
    assert.equal(f.doc.querySelector('.lifecycle-dialog [role=status]').textContent, 'Kernel operation completed.');
    assert.deepEqual([...f.doc.querySelectorAll('.lifecycle-result dt')].map(dt => dt.textContent), ['Home removed', 'Worktree', 'Retained location', 'Recovery location']);
    assert.doesNotMatch(told(f.doc), /Branch deleted|Branch deletion|delete the local branch|local branch/i);
  } finally { f.close(); }
  // Stop has neither.
  const stop = fixture();
  try {
    stop.open(); await tick();
    assert.deepEqual([...stop.doc.querySelectorAll('.lifecycle-options label')].filter(label => !label.hidden).map(label => label.textContent), ['Include recorded children']);
    assert.doesNotMatch(told(stop.doc), /local branch/i);
  } finally { stop.close(); }
});
test('the dialog refuses a receipt that reports a branch deletion or a skip, whatever status came with it, and shows nothing of it', async () => {
  const raw = retirePlan(), accepted = lifecycleReceipt(retireReceipt({ key: 'k', revision: raw.planRevision }), raw, 'k');
  const reports = [r => { r.branchDeleted = true; }, r => { r.retention.branchDeleted = 'UNSHOWN-branch'; },
    r => { r.retention.branchDeletionSkipped = { expected: 'feat/work', actual: 'UNSHOWN-branch', reason: 'UNSHOWN reason' }; }];
  for (const report of reports) for (const status of ['complete', 'partial']) {
    const receipt = structuredClone(accepted); receipt.retention.branch = 'UNSHOWN-branch'; report(receipt);
    const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned('retire', reference, raw) : { lifecycleApi: 1, status, target, receipt } });
    try {
      f.open('retire'); await tick(); f.button('lifecycle-confirm').click(); await tick();
      assert.equal(f.doc.querySelector('.lifecycle-dialog [role=status]').textContent, lifecycleReason('E_OUTCOME_UNKNOWN').message);
      assert.equal(f.doc.querySelector('.lifecycle-result').textContent, '', 'no row of the refused receipt');
      assert.doesNotMatch(told(f.doc), /UNSHOWN|Home removed|Branch deleted|Branch deletion|Kernel operation completed/);
      assert.equal(f.button('lifecycle-retry').hidden, false); assert.equal(f.settled.length, 0);
    } finally { f.close(); }
  }
  // The same receipt without a report is shown.
  const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned('retire', reference, raw) : { lifecycleApi: 1, status: 'complete', target, receipt: structuredClone(accepted) } });
  try {
    f.open('retire'); await tick(); f.button('lifecycle-confirm').click(); await tick();
    assert.equal(f.doc.querySelector('.lifecycle-dialog [role=status]').textContent, 'Kernel operation completed.'); assert.match(f.doc.body.textContent, /Home removedtrue/);
  } finally { f.close(); }
});
test('a deferred Remove is shown as pending; one that reports a branch deletion or a skip is refused and shows nothing of it', async () => {
  const raw = retirePlan(), deferredReceipt = { action: 'retire', instance: instance.instance, home: instance.home, planRevision: raw.planRevision, replayed: false, deferred: true };
  const shown = async receipt => {
    const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned('retire', reference, raw) : { lifecycleApi: 1, status: 'pending', target, receipt } });
    try {
      f.open('retire'); await tick(); f.button('lifecycle-confirm').click(); await tick();
      return { status: f.doc.querySelector('.lifecycle-dialog [role=status]').textContent, all: told(f.doc), retryHidden: f.button('lifecycle-retry').hidden, settled: f.settled.length };
    } finally { f.close(); }
  };
  const pending = await shown(structuredClone(deferredReceipt));
  assert.equal(pending.status, 'Retirement is deferred; no completed removal is established.'); assert.equal(pending.retryHidden, false); assert.equal(pending.settled, 1);
  for (const report of [r => { r.branchDeleted = true; }, r => { r.retention = { worktree: 'removed', branch: 'UNSHOWN-branch', recordedBranch: null, branchDeleted: 'UNSHOWN-branch' }; },
    r => { r.retention = { worktree: 'removed', branch: 'UNSHOWN-branch', recordedBranch: null, branchDeletionSkipped: { expected: 'feat/work', actual: 'UNSHOWN-branch', reason: 'UNSHOWN reason' } }; }]) {
    const receipt = structuredClone(deferredReceipt); report(receipt);
    const refused = await shown(receipt);
    assert.equal(refused.status, lifecycleReason('E_OUTCOME_UNKNOWN').message); assert.doesNotMatch(refused.all, /UNSHOWN|deferred/);
    assert.equal(refused.retryHidden, false); assert.equal(refused.settled, 0);
  }
});
test('the dialog refuses a retire plan whose defaults report a branch deletion; false or absent is accepted', async () => {
  for (const [value, accepted] of [[undefined, true], [false, true], [true, false]]) {
    const raw = retirePlan(); if (value === undefined) delete raw.defaults.deleteBranch; else raw.defaults.deleteBranch = value;
    const f = fixture({ request: () => planned('retire', reference, raw) });
    try {
      f.open('retire'); await tick();
      assert.equal(f.doc.querySelector('.lifecycle-dialog [role=status]').textContent, accepted ? 'Review these facts before confirming.' : lifecycleReason('E_CLI_PROTOCOL').message, String(value));
      assert.equal(f.button('lifecycle-confirm').disabled, !accepted, String(value)); assert.equal(f.doc.querySelector('.lifecycle-facts').textContent === '', !accepted);
    } finally { f.close(); }
  }
});
test('a local Remove refused by inspection shows the inspection sentence under the unknown outcome, never "CLI is unavailable", and no Details when the CLI sent no message', async () => {
  const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned('retire')
    : { lifecycleApi: 1, status: 'unknown', target, planRef: reference, options: options('retire'), plan: null, receipt: null,
      reason: lifecycleReason('E_OUTCOME_UNKNOWN'), cause: lifecycleReason('E_WORK_INSPECTION_FAILED') } });
  try {
    f.open('retire'); await tick(); f.button('lifecycle-confirm').click(); await tick();
    assert.equal(f.doc.querySelector('.lifecycle-dialog [role=status]').textContent, lifecycleReason('E_OUTCOME_UNKNOWN').message);
    const shown = f.doc.querySelector('.lifecycle-result').textContent;
    assert.equal(shown, lifecycleReason('E_WORK_INSPECTION_FAILED').message);
    assert.notEqual(shown, lifecycleReason('E_CLI_FAILED').message);
    assert.equal(f.doc.querySelector('.lifecycle-details'), null, 'no message from the CLI, no Details');
    assert.equal(f.button('lifecycle-retry').hidden, false);
  } finally { f.close(); }
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

const remoteInstance = { ...instance, server: 'build', repoName: 'Build box', addressable: true };
const remoteTarget = { ...target, server: 'build' };
test('a remote plan says "Reading from <server>…" in flight; a host refusal shows its headline with the kernel\'s code and message in Details', async () => {
  const gate = deferred();
  const f = fixture({ request: () => gate.promise });
  try {
    f.dialog.open({ operation: 'retire', instance: remoteInstance, workspace: 'team' }); await tick();
    assert.deepEqual(f.calls[0].body.selector, { instance: instance.instance, agent: instance.agent, agentsRoot: instance.agentsRoot, server: 'build' });
    assert.equal(f.doc.querySelector('.lifecycle-dialog [role=status]').textContent, 'Reading from Build box…');
    gate.resolve({ lifecycleApi: 1, status: 'unavailable', target: remoteTarget, planRef: null, plan: null, receipt: null,
      reason: { code: 'E_REMOTE_INCOMPATIBLE', message: "Build box runs an OATS that can't do this yet.", detail: 'build runs 0.30.2: lifecycle-plans needs lifecycleApi 1', remote: true } });
    await tick();
    assert.equal(f.doc.querySelector('.lifecycle-dialog [role=status]').textContent, "Build box runs an OATS that can't do this yet.");
    const details = f.doc.querySelector('.lifecycle-details');
    assert.equal(details.querySelector('summary').textContent, 'Details');
    assert.equal(details.querySelector('p').textContent, 'E_REMOTE_INCOMPATIBLE: build runs 0.30.2: lifecycle-plans needs lifecycleApi 1');
    assert.equal(f.button('lifecycle-confirm').disabled, true);
  } finally { f.close(); }
});
test('a remote apply that lost the link is an unknown outcome with the transport cause, never a failure; Check recorded result stays', async () => {
  const f = fixture({ request: (_ws, body) => body.action === 'plan' ? { ...planned('stop'), target: remoteTarget }
    : { lifecycleApi: 1, status: 'unknown', target: remoteTarget, planRef: reference, options: options('stop'), plan: null, receipt: null,
      reason: { code: 'E_OUTCOME_UNKNOWN', message: 'The submitted operation has no confirmed outcome. Observe current state; do not assume no effect.' },
      cause: { code: 'E_SSH', message: "Couldn't reach Build box.", detail: 'ssh: connect to host build-host port 22: Connection refused', remote: true } } });
  try {
    f.dialog.open({ operation: 'stop', instance: remoteInstance, workspace: 'team' }); await tick();
    f.button('lifecycle-confirm').click(); await tick();
    assert.match(f.doc.querySelector('.lifecycle-dialog [role=status]').textContent, /no confirmed outcome/);
    assert.match(f.doc.querySelector('.lifecycle-result').textContent, /Couldn't reach Build box\./);
    assert.equal(f.doc.querySelector('.lifecycle-result .lifecycle-details p').textContent, 'E_SSH: ssh: connect to host build-host port 22: Connection refused');
    assert.equal(f.button('lifecycle-retry').hidden, false);
    assert.equal(f.settled.length, 1, 'the host settles the roster refresh even for an unknown outcome');
  } finally { f.close(); }
});

/** The dialog's `request`, answered by the server boundary for a remote workspace: what the dialog reads is
 * what the server sends. `respond.plan` / `respond.apply`: the installed CLI's answer for that phase. */
function remoteServer(respond = {}) {
  const context = { cli: { ...structuredClone(cli), remote: ['lifecycle-plans'] }, localCwd: '/Users/me/work',
    workspace: { id: 'team', name: 'Build box', scope: '/team', remote: true, server: 'build' },
    instances: [{ ...instance, server: 'build', addressable: true, missingRemotely: false, savedRoute: false, running: true }] };
  const service = createLifecycleBoundary({ invoke: async (_bin, args) => respond[args.phase]?.(args)
    ?? envelope(args.phase === 'plan' ? args.operation === 'stop' ? stopPlan() : retirePlan() : stopReceipt(args)) });
  return (_workspace, body) => service(body, () => context);
}
test('from the server: a host message with line breaks and a character of the set is one line in Details, alone in its <bdi>, the code outside it', async () => {
  const refusedBy = code => () => ({ schemaVersion: 1, ok: false, error: { code, message: MESSY } });
  // A refused plan.
  let f = fixture({ request: remoteServer({ plan: refusedBy('E_REMOTE_INCOMPATIBLE') }) });
  try {
    f.dialog.open({ operation: 'retire', instance: remoteInstance, workspace: 'team' }); await tick();
    assert.equal(f.doc.querySelector('.lifecycle-dialog [role=status]').textContent, "Build box runs an OATS that can't do this yet.");
    assert.equal(f.doc.querySelector('.lifecycle-details summary').textContent, 'Details');
    assertIsolatedDetail(f.doc.querySelector('.lifecycle-details p'), { before: 'E_REMOTE_INCOMPATIBLE: ', detail: MESSY_LINE });
  } finally { f.close(); }
  // An apply with no confirmed outcome: the cause's headline in its own element, its Details under it.
  f = fixture({ request: remoteServer({ apply: refusedBy('E_SSH') }) });
  try {
    f.dialog.open({ operation: 'stop', instance: remoteInstance, workspace: 'team' }); await tick();
    f.button('lifecycle-confirm').click(); await tick();
    assert.match(f.doc.querySelector('.lifecycle-dialog [role=status]').textContent, /no confirmed outcome/);
    assert.equal(f.doc.querySelector('.lifecycle-result .lifecycle-note').textContent, "Couldn't reach Build box.");
    assertIsolatedDetail(f.doc.querySelector('.lifecycle-result .lifecycle-details p'), { before: 'E_SSH: ', detail: MESSY_LINE });
  } finally { f.close(); }
});
/** The dialog's `request`, answered by the server boundary for a local workspace. */
function localServer(respond = {}) {
  const ctx = context();
  const service = createLifecycleBoundary({ invoke: async (_bin, args) => respond[args.phase]?.(args)
    ?? envelope(args.phase === 'plan' ? args.operation === 'stop' ? stopPlan() : retirePlan() : args.operation === 'stop' ? stopReceipt(args) : retireReceipt(args)) });
  return (_workspace, body) => service(body, () => ctx);
}
const localError = (code, message) => () => ({ schemaVersion: 1, ok: false, error: { code, message } });
test("from the server: a local Remove refused by inspection shows Desktop's sentence and, in Details, the code and the CLI's message as one line alone in its <bdi>", async () => {
  const f = fixture({ request: localServer({ apply: localError('E_WORK_INSPECTION_FAILED', MESSY) }) });
  try {
    f.open('retire'); await tick(); f.button('lifecycle-confirm').click(); await tick();
    assert.equal(f.doc.querySelector('.lifecycle-dialog [role=status]').textContent, lifecycleReason('E_OUTCOME_UNKNOWN').message);
    assert.equal(f.doc.querySelector('.lifecycle-result .lifecycle-note').textContent, lifecycleReason('E_WORK_INSPECTION_FAILED').message, "the headline is Desktop's fixed sentence, in its own element");
    assert.equal(f.doc.querySelectorAll('.lifecycle-details').length, 1); assert.equal(f.doc.querySelector('.lifecycle-details summary').textContent, 'Details');
    // A line break, a tab, the line separators and a character of the set: one line, the character shown as U+FFFD.
    assertIsolatedDetail(f.doc.querySelector('.lifecycle-result .lifecycle-details p'), { before: 'E_WORK_INSPECTION_FAILED: ', detail: MESSY_LINE });
    assert.equal(f.doc.body.textContent.split(MESSY_LINE).length, 2, 'said once, in Details');
    assert.equal(f.button('lifecycle-retry').hidden, false);
  } finally { f.close(); }
});
test('a local message that looks like a credential shows "[Detail withheld]"; a local E_CLI_TIMEOUT shows no Details, whatever came with it', async () => {
  let f = fixture({ request: localServer({ apply: localError('E_WORK_INSPECTION_FAILED', 'could not read the work root: token=abc123') }) });
  try {
    f.open('retire'); await tick(); f.button('lifecycle-confirm').click(); await tick();
    assertIsolatedDetail(f.doc.querySelector('.lifecycle-result .lifecycle-details p'), { before: 'E_WORK_INSPECTION_FAILED: ', detail: '[Detail withheld]' });
    assert.doesNotMatch(f.doc.body.textContent, /abc123|work root/);
  } finally { f.close(); }
  f = fixture({ request: localServer({ apply: localError('E_CLI_TIMEOUT', 'TEXT FROM THE ENVELOPE') }) });
  try {
    f.open('retire'); await tick(); f.button('lifecycle-confirm').click(); await tick();
    assert.equal(f.doc.querySelector('.lifecycle-result .lifecycle-note').textContent, lifecycleReason('E_CLI_TIMEOUT').message);
    assert.equal(f.doc.querySelector('.lifecycle-details'), null); assert.doesNotMatch(f.doc.body.textContent, /TEXT FROM/);
  } finally { f.close(); }
});
test("from the server: a local plan the kernel refuses shows the fixed sentence and the CLI's message in Details", async () => {
  const f = fixture({ request: localServer({ plan: localError('E_INSTANCE_RETIRING', MESSY) }) });
  try {
    f.open('retire'); await tick();
    assert.equal(f.doc.querySelector('.lifecycle-dialog [role=status]').textContent, lifecycleReason('E_INSTANCE_RETIRING').message);
    assertIsolatedDetail(f.doc.querySelector('.lifecycle-details p'), { before: 'E_INSTANCE_RETIRING: ', detail: MESSY_LINE });
    assert.equal(f.button('lifecycle-confirm').disabled, true);
  } finally { f.close(); }
});
test("from the server: a Remove whose receipt reports a branch deletion or a skip shows Desktop's two fixed sentences and nothing of the receipt", async () => {
  const reports = [r => { r.branchDeleted = true; r.retention.branchDeleted = 'UNSHOWN-branch'; }, r => { r.retention.branchDeleted = 'UNSHOWN-branch'; },
    r => { r.retention.branchDeletionSkipped = { expected: 'feat/work', actual: 'UNSHOWN-branch', reason: 'UNSHOWN reason' }; }];
  for (const report of reports) {
    const replies = [], server = localServer({ apply: args => { const r = retireReceipt(args); r.retention.branch = 'UNSHOWN-branch'; report(r); return envelope(r); } });
    const f = fixture({ request: async (workspace, body) => { const reply = await server(workspace, body); replies.push(structuredClone(reply)); return reply; } });
    try {
      f.open('retire'); await tick(); f.button('lifecycle-confirm').click(); await tick();
      assert.equal(replies.length, 2); assert.equal(replies[1].status, 'unknown'); assert.equal(replies[1].receipt, null);
      assert.deepEqual(replies[1].reason, lifecycleReason('E_OUTCOME_UNKNOWN')); assert.deepEqual(replies[1].cause, lifecycleReason('E_CLI_PROTOCOL'));
      assert.doesNotMatch(JSON.stringify(replies[1]), /UNSHOWN/);
      assert.equal(f.doc.querySelector('.lifecycle-dialog [role=status]').textContent, lifecycleReason('E_OUTCOME_UNKNOWN').message);
      assert.equal(f.doc.querySelector('.lifecycle-result').textContent, lifecycleReason('E_CLI_PROTOCOL').message, 'the cause sentence alone: no row, no Details');
      assert.equal(f.doc.querySelector('.lifecycle-details'), null);
      assert.doesNotMatch(told(f.doc), /UNSHOWN|Home removed|Branch deleted|Branch deletion/);
      assert.equal(f.button('lifecycle-retry').hidden, false);
    } finally { f.close(); }
  }
});
test("the dialog re-validates a local detail: only a display line, only for a code with its own sentence that Desktop does not raise, and never as the headline", async () => {
  const fixed = lifecycleReason('E_WORK_INSPECTION_FAILED');
  const shown = async cause => {
    const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned('retire')
      : { lifecycleApi: 1, status: 'unknown', target, planRef: reference, options: options('retire'), plan: null, receipt: null, reason: lifecycleReason('E_OUTCOME_UNKNOWN'), cause } });
    try {
      f.open('retire'); await tick(); f.button('lifecycle-confirm').click(); await tick();
      return { headline: f.doc.querySelector('.lifecycle-result .lifecycle-note').textContent, details: f.doc.querySelector('.lifecycle-details p')?.textContent ?? null, text: f.doc.body.textContent };
    } finally { f.close(); }
  };
  // Kept: the headline is the fixed sentence for the code, whatever the reply's `message` says.
  const kept = await shown({ ...fixed, message: 'A HEADLINE FROM THE REPLY', detail: 'one line' });
  assert.equal(kept.headline, fixed.message); assert.equal(kept.details, 'E_WORK_INSPECTION_FAILED: one line'); assert.doesNotMatch(kept.text, /A HEADLINE FROM THE REPLY/);
  // Dropped: not a display line; one of Desktop's own codes; a code without a sentence; a reason that claims to be remote.
  for (const cause of [{ ...fixed, detail: 'UNSHOWN two\nlines' }, { ...fixed, detail: 'UNSHOWN two  spaces' }, { ...fixed, detail: `UNSHOWN a${String.fromCodePoint(0x202E)}b` },
    { ...fixed, detail: 'UNSHOWN token=abc123' }, { ...fixed, detail: 7 }, { ...lifecycleReason('E_CLI_TIMEOUT'), detail: 'UNSHOWN line' },
    { ...lifecycleReason('E_OUTCOME_UNKNOWN'), detail: 'UNSHOWN line' }, { ...fixed, detail: 'UNSHOWN line', remote: false }]) {
    const view = await shown(cause);
    assert.equal(view.details, null, JSON.stringify(cause)); assert.equal(view.headline, lifecycleReason(cause.code).message);
    assert.doesNotMatch(view.text, /UNSHOWN/, JSON.stringify(cause));
  }
  const unknown = await shown({ code: 'E_NOT_IN_THE_TABLE', message: 'A HEADLINE FROM THE REPLY', detail: 'UNSHOWN line' });
  assert.equal(unknown.headline, lifecycleReason('E_CLI_FAILED').message); assert.equal(unknown.details, null); assert.doesNotMatch(unknown.text, /UNSHOWN|A HEADLINE/);
});
test('each dialog shows only its own choices: a hidden choice stays hidden despite the label layout (Stop has no worktree option, Remove no children option)', () => {
  // The label's display:flex beats the user agent's [hidden] rule in Chromium; jsdom's cascade does not model that, so pin the rule.
  const dom = new JSDOM('<!doctype html><style></style>'), sheet = dom.window.document.querySelector('style');
  sheet.textContent = lifecycleCSS;
  const rule = [...sheet.sheet.cssRules].find(r => r.selectorText === '.lifecycle-dialog label[hidden]');
  assert.equal(rule?.style.display, 'none');
  dom.window.close();
});
