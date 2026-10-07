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
  const dom = new JSDOM('<!doctype html><button id="opener">Actions</button><div id="roster"><button id="successor">dev-2</button></div>', { pretendToBeVisual: true });
  const doc = dom.window.document, calls = [], settled = []; let generation = 0, workspaceChange;
  const dialog = createLifecycleDialog({ doc, generation: () => generation,
    subscribeWorkspace: fn => { workspaceChange = fn; return () => {}; }, onSettled: (...args) => settled.push(args),
    request: async (workspace, body) => { calls.push({ workspace, body }); return request ? request(workspace, body)
      : { ...planned(body.operation), options: body.options, plan: body.operation === 'stop' ? stopPlan(body.options.recursive) : retirePlan() }; }, ...extra });
  return { dom, doc, dialog, calls, settled, open: (operation = 'stop') => dialog.open({ operation, instance, workspace: 'team' }),
    bumpGenerationWithoutEvent() { generation++; }, switchWorkspace() { generation++; workspaceChange(); }, button: cls => doc.querySelector(`.${cls}`),
    status: () => doc.querySelector('.lifecycle-dialog [role=status]').textContent, title: () => doc.querySelector('.lifecycle-dialog h2').textContent,
    key(value) { doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); },
    check(input, checked) { input.checked = checked; input.dispatchEvent(new dom.window.Event('change')); },
    close() { dialog.dispose(); dom.window.close(); } };
}
/** Whether `el` is on screen inside the dialog: no `hidden` ancestor, and not the visually hidden status of the done phase. */
const onScreen = el => { for (let n = el; n; n = n.parentElement) { if (n.hidden || n.classList?.contains('lifecycle-sr')) return false; if (n.classList?.contains('lifecycle-dialog')) return true; } return false; };
/** The footer buttons on screen, by label. */
const footer = f => [...f.doc.querySelectorAll('.lifecycle-footer button')].filter(onScreen).map(b => b.textContent);
/** Spec "done when" 8: every button and input on screen is enabled, or names why beside it: a visible
 * aria-describedby target with text, or a <small> note next to it. Run in every phase. */
function assertExplained(f, where) {
  const controls = [...f.doc.querySelectorAll('.lifecycle-dialog button, .lifecycle-dialog input')].filter(onScreen);
  assert.ok(controls.length, `${where}: some control is on screen`);
  for (const el of controls) {
    if (!el.disabled && el.getAttribute('aria-disabled') !== 'true') continue;
    const described = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map(id => f.doc.getElementById(id))
      .some(reason => reason && onScreen(reason) && reason.textContent.trim());
    const note = el.parentElement?.querySelector('small');
    assert.ok(described || note?.textContent.trim(), `${where}: "${el.textContent || el.type}" is disabled with no visible reason`);
  }
}
const disabledOnScreen = f => [...f.doc.querySelectorAll('.lifecycle-dialog button, .lifecycle-dialog input')].filter(el => onScreen(el) && el.disabled);
const happenLines = f => [...f.doc.querySelectorAll('.lifecycle-happen li')].map(li => li.textContent);
const factRows = f => [...f.doc.querySelectorAll('.lifecycle-facts dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent]);

test('opening reads a plan only; plain facts render; explicit confirm submits only opaque ref; running, then done with Done focused', async () => {
  const gate = deferred(); const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned() : gate.promise });
  try {
    f.doc.getElementById('opener').focus(); f.open(); await tick();
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].body.action, 'plan'); assert.equal(f.calls[0].body.selector.home, undefined);
    assert.equal(f.title(), 'Stop dev-1?');
    assert.deepEqual(happenLines(f), ['Stops the session of dev-1.', 'Nothing is deleted. Its home, worktree, transcript and launch settings are kept; you can start it again.',
      'A session that refuses to stop is left running; nothing is forced.', 'dev-1 reports it is in the middle of a task.']);
    assert.deepEqual(factRows(f), [['dev-1', 'Running']]);
    assert.deepEqual(footer(f), ['Cancel', 'Stop session']); assertExplained(f, 'review');
    f.button('lifecycle-confirm').click(); f.button('lifecycle-confirm').click(); await tick();
    assert.deepEqual(f.calls[1].body, { action: 'apply', planRef: reference }); assert.equal(f.calls.length, 2);
    assert.equal(f.title(), 'Stopping dev-1…'); assert.deepEqual(footer(f), ['Close']); assertExplained(f, 'running');
    const raw = stopReceipt({ revision: stopPlan().planRevision, key: 'server' });
    gate.resolve({ lifecycleApi: 1, status: 'complete', target, receipt: lifecycleReceipt(raw, stopPlan(), 'server') }); await tick();
    assert.equal(f.title(), 'dev-1 stopped'); assert.equal(f.doc.querySelector('.lifecycle-result').textContent, 'dev-1: Stopped');
    assert.deepEqual(footer(f), ['Done']); assert.equal(f.doc.activeElement, f.button('lifecycle-done'));
    assert.deepEqual(disabledOnScreen(f), [], 'nothing disabled when it is done'); assertExplained(f, 'done');
    f.button('lifecycle-done').click(); assert.equal(f.doc.querySelector('.lifecycle-overlay'), null); assert.equal(f.doc.activeElement.id, 'opener');
  } finally { f.close(); }
});
test('changing Stop children or the Retire choice revokes the displayed ref and obtains a fresh plan', async () => {
  const f = fixture();
  try {
    f.open(); await tick(); f.check(f.doc.querySelector('input'), false); await tick();
    assert.equal(f.calls.at(-1).body.options.recursive, false);
    f.open('retire'); await tick(); const inputs = [...f.doc.querySelectorAll('input')];
    assert.equal(inputs.length, 2, 'the children choice (hidden for Retire) and the worktree choice');
    assert.deepEqual(f.calls.at(-1).body.options, { discardWorktree: false }); assert.equal(inputs[1].disabled, false);
    f.check(inputs[1], true); await tick();
    assert.deepEqual(f.calls.at(-1).body.options, { discardWorktree: true });
    f.check(inputs[1], false); await tick();
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
  f.open(); await tick(); const oldApply = f.button('lifecycle-confirm'), oldClose = f.button('lifecycle-close'), oldCheck = f.button('lifecycle-check');
  f.dialog.close(); f.open('retire'); await tick(); const before = f.calls.length;
  oldApply.click(); oldClose.click(); oldCheck.click(); await tick(); assert.equal(f.calls.length, before); assert.ok(f.doc.querySelector('.lifecycle-overlay'));
  f.switchWorkspace(); assert.equal(f.doc.querySelector('.lifecycle-overlay'), null); f.close();
});
test('workspace generation invalidates existing controls even before a disposal notification arrives', async () => {
  const f = fixture(); f.open(); await tick(); const count = f.calls.length;
  f.bumpGenerationWithoutEvent(); f.button('lifecycle-confirm').click(); f.button('lifecycle-check').click(); await tick();
  assert.equal(f.calls.length, count); f.button('lifecycle-close').click(); assert.equal(f.doc.querySelector('.lifecycle-overlay'), null); f.close();
});

test('E_PLAN_STALE returns to review with the fresh facts and an attention line, but requires NEW explicit confirmation; no automatic apply', async () => {
  const fresh = stopPlan(); fresh.planRevision = 'c'.repeat(24); fresh.targets[0].midTask = false; fresh.targets[0].session = { state: 'stopped', present: false, established: true, backend: 'tmux' };
  const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned() : { ...planned('stop', newReference, fresh), status: 'stale', reason: { code: 'E_PLAN_STALE' } } });
  try {
    f.open(); await tick(); f.button('lifecycle-confirm').click(); await tick();
    assert.equal(f.title(), 'Stop dev-1?'); assert.deepEqual(factRows(f), [['dev-1', 'Not running']]);
    assert.doesNotMatch(f.doc.querySelector('.lifecycle-happen').textContent, /middle of a task/);
    assert.equal(f.status(), 'Something changed since you opened this. Review it and confirm again.');
    assert.equal(f.calls.length, 2); assert.equal(f.button('lifecycle-confirm').disabled, false); assert.deepEqual(footer(f), ['Cancel', 'Stop session']);
    assert.equal(f.doc.activeElement, f.button('lifecycle-close'), 'focus on Cancel'); assert.equal(f.settled.length, 0); assertExplained(f, 'stale review');
    await tick(); assert.equal(f.calls.length, 2, 'never applies by itself');
    f.button('lifecycle-confirm').click(); await tick(); assert.equal(f.calls[2].body.planRef, newReference);
  } finally { f.close(); }
});
test('transport loss is uncertain: Check again resubmits the same ref; Close cannot cancel a dispatched operation', async () => {
  let attempts = 0;
  const f = fixture({ request: (_ws, body) => {
    if (body.action === 'plan') return planned(); attempts++; throw new Error('PRIVATE connection lost');
  } });
  try {
    f.open(); await tick(); f.button('lifecycle-confirm').click(); await tick();
    assert.equal(f.status(), lifecycleReason('E_OUTCOME_UNKNOWN').message); assert.doesNotMatch(f.doc.body.textContent, /PRIVATE/);
    assert.equal(f.title(), 'Result not confirmed'); assert.deepEqual(footer(f), ['Check again', 'Close']);
    assert.equal(f.doc.activeElement, f.button('lifecycle-close'), 'Close, never the resubmitting action'); assertExplained(f, 'uncertain result');
    f.button('lifecycle-retry').click(); await tick(); assert.equal(attempts, 2);
    assert.deepEqual(f.calls.filter(c => c.body.action === 'apply').map(c => c.body.planRef), [reference, reference]);
    f.dialog.close(); assert.equal(f.calls.length, 3, 'close issues no signal/cancel request');
  } finally { f.close(); }
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
test('incomplete cleanup remains partial even after home removal; ambiguous children are named, not hidden or acted on', async () => {
  const raw = retirePlan(); raw.facts.ambiguous = [{ instance: 'kid', agent: 'ops', home: '/ops/kid', reason: 'parent not unique' }];
  const result = retireReceipt({ key: 'k', revision: raw.planRevision }); result.rollbackIncomplete = ['cleanup'];
  const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned('retire', reference, raw)
    : { lifecycleApi: 1, status: 'partial', target, receipt: lifecycleReceipt(result, raw, 'k') } });
  try {
    f.open('retire'); await tick();
    const note = [...f.doc.querySelectorAll('.lifecycle-facts p')].find(p => p.textContent.startsWith('Not included: kid'));
    assert.equal(note.textContent, "Not included: kid (another instance has the same parent name, so OATS can't tell whose child it is).");
    assert.equal(note.title, '/ops/kid', 'its home in the tooltip, not inline');
    f.button('lifecycle-confirm').click(); await tick();
    assert.equal(f.status(), "Retirement didn't finish. Some steps ran:"); assert.equal(f.title(), "Retirement didn't finish");
    assert.deepEqual([...f.doc.querySelectorAll('.lifecycle-result li')].map(li => li.textContent),
      ['Home folder deleted.', 'Worktree kept at/team/.agents/worktrees/repo/feat-work', "Cleanup didn't finish."]);
    assert.deepEqual(footer(f), ['Review again', 'Close'], 'a partial outcome is never done'); assertExplained(f, 'partial result');
  } finally { f.close(); }
});
test('Retire shows one choice, the worktree, says in plain words what happens and that branches are not changed; its result has no branch line', async () => {
  const raw = retirePlan(), result = retireReceipt({ key: 'k', revision: raw.planRevision });
  const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned('retire', reference, raw)
    : { lifecycleApi: 1, status: 'complete', target, receipt: lifecycleReceipt(result, raw, 'k') } });
  try {
    f.open('retire'); await tick();
    assert.equal(f.title(), 'Retire dev-1?'); assert.deepEqual(footer(f), ['Cancel', 'Retire instance']);
    const labels = [...f.doc.querySelectorAll('.lifecycle-options label')];
    assert.deepEqual(labels.filter(label => !label.hidden).map(label => label.textContent), ['Also delete the worktree']);
    assert.deepEqual(labels.map(label => label.textContent), ['Include child instances', 'Also delete the worktree']);
    assert.equal(f.doc.querySelectorAll('.lifecycle-dialog input').length, 2);
    assert.deepEqual(happenLines(f), ['Stops its session.', `Saves a recovery copy of any uncommitted work, then deletes its home folder.${instance.home}`,
      'Keeps its worktree, moved aside, on branch feat/work.', 'Branches and pull requests are not changed.']);
    assert.deepEqual(factRows(f), [['Session', 'Running'], ['Uncommitted work', '2 changed, 1 untracked'], ['Branch', 'feat/work']]);
    assert.ok([...f.doc.querySelectorAll('.lifecycle-facts p')].some(p => p.textContent === 'The worktree is on feat/work, not the branch it was spawned on (agents/dev-1).'));
    assert.match(f.doc.querySelector('.lifecycle-observed').textContent, /^Observed (just now|\d+s ago|\d+ min ago|at \d\d:\d\d) Check again$/);
    // Plain words: no timestamps, no kernel, none of the old row labels.
    assert.doesNotMatch(told(f.doc), /kernel|Recorded branch|Worktree by default|\d{4}-\d\d-\d\dT|local branch/i);
    f.button('lifecycle-confirm').click(); await tick();
    assert.equal(f.title(), 'dev-1 retired'); assert.equal(f.status(), 'dev-1 retired.');
    assert.deepEqual([...f.doc.querySelectorAll('.lifecycle-result li')].map(li => li.textContent),
      ['Session stopped.', 'Home folder deleted.', 'Worktree kept at/team/.agents/worktrees/repo/feat-work']);
    assert.doesNotMatch(f.doc.querySelector('.lifecycle-result').textContent, /Branch|branch/);
    assert.doesNotMatch(told(f.doc), /Branch deleted|Branch deletion|delete the local branch|local branch/i);
  } finally { f.close(); }
  // Stop has neither.
  const stop = fixture();
  try {
    stop.open(); await tick();
    assert.deepEqual([...stop.doc.querySelectorAll('.lifecycle-options label')].filter(label => !label.hidden).map(label => label.textContent), ['Include child instances']);
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
      assert.equal(f.status(), lifecycleReason('E_OUTCOME_UNKNOWN').message);
      assert.equal(f.doc.querySelector('.lifecycle-result').textContent, '', 'no row of the refused receipt');
      assert.doesNotMatch(told(f.doc), /UNSHOWN|Home folder deleted|Branch deleted|Branch deletion|dev-1 retired/);
      assert.equal(f.button('lifecycle-retry').hidden, false); assert.equal(f.settled.length, 0);
    } finally { f.close(); }
  }
  // The same receipt without a report is shown.
  const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned('retire', reference, raw) : { lifecycleApi: 1, status: 'complete', target, receipt: structuredClone(accepted) } });
  try {
    f.open('retire'); await tick(); f.button('lifecycle-confirm').click(); await tick();
    assert.equal(f.title(), 'dev-1 retired'); assert.match(f.doc.querySelector('.lifecycle-result').textContent, /Home folder deleted\./);
  } finally { f.close(); }
});
test('a deferred Retire is a result, never done, with Check again; one that reports a branch deletion or a skip is refused and shows nothing of it', async () => {
  const raw = retirePlan(), deferredReceipt = { action: 'retire', instance: instance.instance, home: instance.home, planRevision: raw.planRevision, replayed: false, deferred: true };
  const shown = async receipt => {
    const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned('retire', reference, raw) : { lifecycleApi: 1, status: 'pending', target, receipt } });
    try {
      f.open('retire'); await tick(); f.button('lifecycle-confirm').click(); await tick();
      return { status: f.status(), title: f.title(), all: told(f.doc), footer: footer(f), settled: f.settled.length };
    } finally { f.close(); }
  };
  const pending = await shown(structuredClone(deferredReceipt));
  assert.equal(pending.status, 'Retirement was accepted and will finish in the background. Check the roster for its result.');
  assert.equal(pending.title, 'Retirement accepted'); assert.deepEqual(pending.footer, ['Check again', 'Close']); assert.equal(pending.settled, 1);
  for (const report of [r => { r.branchDeleted = true; }, r => { r.retention = { worktree: 'removed', branch: 'UNSHOWN-branch', recordedBranch: null, branchDeleted: 'UNSHOWN-branch' }; },
    r => { r.retention = { worktree: 'removed', branch: 'UNSHOWN-branch', recordedBranch: null, branchDeletionSkipped: { expected: 'feat/work', actual: 'UNSHOWN-branch', reason: 'UNSHOWN reason' } }; }]) {
    const receipt = structuredClone(deferredReceipt); report(receipt);
    const refused = await shown(receipt);
    assert.equal(refused.status, lifecycleReason('E_OUTCOME_UNKNOWN').message); assert.doesNotMatch(refused.all, /UNSHOWN|background|accepted/);
    assert.deepEqual(refused.footer, ['Check again', 'Close']); assert.equal(refused.settled, 0);
  }
});
test('the dialog refuses a retire plan whose defaults report a branch deletion; false or absent is accepted', async () => {
  for (const [value, accepted] of [[undefined, true], [false, true], [true, false]]) {
    const raw = retirePlan(); if (value === undefined) delete raw.defaults.deleteBranch; else raw.defaults.deleteBranch = value;
    const f = fixture({ request: () => planned('retire', reference, raw) });
    try {
      f.open('retire'); await tick();
      assert.equal(f.status(), accepted ? '' : lifecycleReason('E_CLI_PROTOCOL').message, String(value));
      assert.deepEqual(footer(f), accepted ? ['Cancel', 'Retire instance'] : ['Review again', 'Close'], String(value));
      assert.equal(f.doc.querySelector('.lifecycle-facts').textContent === '', !accepted);
    } finally { f.close(); }
  }
});
test('a local Retire refused by inspection shows the inspection sentence under the unknown outcome, never "OATS couldn\'t be run", and no Details when the CLI sent no message', async () => {
  const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned('retire')
    : { lifecycleApi: 1, status: 'unknown', target, planRef: reference, options: options('retire'), plan: null, receipt: null,
      reason: lifecycleReason('E_OUTCOME_UNKNOWN'), cause: lifecycleReason('E_WORK_INSPECTION_FAILED') } });
  try {
    f.open('retire'); await tick(); f.button('lifecycle-confirm').click(); await tick();
    assert.equal(f.status(), lifecycleReason('E_OUTCOME_UNKNOWN').message);
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
  assert.match(f.doc.querySelector('.lifecycle-forge').textContent, /^Pull request#\d+ · <script>inert title<\/script> · \w+ \(not changed\)$/);
  assert.equal(f.doc.querySelector('script'), null); link.click(); assert.deepEqual(opened, [raw.url]);
  f.switchWorkspace(); link.click(); assert.equal(opened.length, 1); f.close();
});

test('connection change invalidates old forge success/rejection without invalidating the lifecycle plan; an unknown PR is left out', async () => {
  for (const reject of [false, true]) {
    const gate = deferred(); let account = 0, changed, calls = 0;
    const f = fixture({ connectionGeneration: () => account, subscribeConnections: fn => { changed = fn; return () => {}; },
      gitRequest: async () => ({ target, status: 'available', observationKey: reference, data: { observation: { revision: 'a'.repeat(40), branch: 'feat/work' } } }),
      forgeRequest: () => ++calls === 1 ? gate.promise : Promise.resolve({ forgeApi: 1, status: 'not-connected' }) });
    f.open('retire'); await tick(); account++; changed(); await tick();
    if (reject) gate.reject(new Error('PRIVATE')); else gate.resolve({ forgeApi: 1, target, status: 'no-pull-request', data: null, observation: { key: reference, revision: 'a'.repeat(40), branch: 'feat/work' }, host: 'github.com', repository: 'owner/repo' });
    await tick(); assert.equal(f.doc.querySelector('.lifecycle-forge').textContent, ''); assert.equal(f.button('lifecycle-confirm').disabled, false); f.close();
  }
});

test('forge overlay requires target/revision/branch/repository match; late rejection leaves the row out, never no PR', async () => {
  for (const mode of ['match', 'revision', 'repo', 'reject']) {
    const f = fixture({ gitRequest: async () => ({ target, status: 'available', observationKey: reference, data: { observation: { revision: 'a'.repeat(40), branch: 'feat/work' } } }),
      forgeRequest: async () => { if (mode === 'reject') throw new Error('PRIVATE'); return { forgeApi: 1, target, status: 'no-pull-request', data: null,
        observation: { key: reference, revision: (mode === 'revision' ? 'b' : 'a').repeat(40), branch: 'feat/work' }, host: 'github.com', repository: mode === 'repo' ? 'other/repo' : 'owner/repo' }; } });
    f.open('retire'); await tick(); await tick();
    assert.equal(f.doc.querySelector('.lifecycle-forge').textContent, mode === 'match' ? 'Pull requestNone for this branch' : ''); f.close();
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
    assert.equal(f.status(), 'Reading from Build box…'); assertExplained(f, 'remote loading');
    gate.resolve({ lifecycleApi: 1, status: 'unavailable', target: remoteTarget, planRef: null, plan: null, receipt: null,
      reason: { code: 'E_REMOTE_INCOMPATIBLE', message: "Build box runs an OATS that can't do this yet.", detail: 'build runs 0.30.2: lifecycle-plans needs lifecycleApi 1', remote: true } });
    await tick();
    assert.equal(f.status(), "Build box runs an OATS that can't do this yet.");
    const details = f.doc.querySelector('.lifecycle-details');
    assert.equal(details.querySelector('summary').textContent, 'Details');
    assert.equal(details.querySelector('p').textContent, 'E_REMOTE_INCOMPATIBLE: build runs 0.30.2: lifecycle-plans needs lifecycleApi 1');
    assert.equal(f.button('lifecycle-confirm').hidden, true); assert.deepEqual(footer(f), ['Review again', 'Close']);
  } finally { f.close(); }
});
test('a remote apply that lost the link is an unknown outcome with the transport cause, never a failure; Check again stays', async () => {
  const f = fixture({ request: (_ws, body) => body.action === 'plan' ? { ...planned('stop'), target: remoteTarget }
    : { lifecycleApi: 1, status: 'unknown', target: remoteTarget, planRef: reference, options: options('stop'), plan: null, receipt: null,
      reason: { code: 'E_OUTCOME_UNKNOWN', message: 'The submitted operation has no confirmed outcome.' },
      cause: { code: 'E_SSH', message: "Couldn't reach Build box.", detail: 'ssh: connect to host build-host port 22: Connection refused', remote: true } } });
  try {
    f.dialog.open({ operation: 'stop', instance: remoteInstance, workspace: 'team' }); await tick();
    f.button('lifecycle-confirm').click(); await tick();
    assert.equal(f.status(), lifecycleReason('E_OUTCOME_UNKNOWN').message);
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
    assert.equal(f.status(), "Build box runs an OATS that can't do this yet.");
    assert.equal(f.doc.querySelector('.lifecycle-details summary').textContent, 'Details');
    assertIsolatedDetail(f.doc.querySelector('.lifecycle-details p'), { before: 'E_REMOTE_INCOMPATIBLE: ', detail: MESSY_LINE });
  } finally { f.close(); }
  // An apply with no confirmed outcome: the cause's headline in its own element, its Details under it.
  f = fixture({ request: remoteServer({ apply: refusedBy('E_SSH') }) });
  try {
    f.dialog.open({ operation: 'stop', instance: remoteInstance, workspace: 'team' }); await tick();
    f.button('lifecycle-confirm').click(); await tick();
    assert.equal(f.status(), lifecycleReason('E_OUTCOME_UNKNOWN').message);
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
test("from the server: a local Retire refused by inspection shows Desktop's sentence and, in Details, the code and the CLI's message as one line alone in its <bdi>", async () => {
  const f = fixture({ request: localServer({ apply: localError('E_WORK_INSPECTION_FAILED', MESSY) }) });
  try {
    f.open('retire'); await tick(); f.button('lifecycle-confirm').click(); await tick();
    assert.equal(f.status(), lifecycleReason('E_OUTCOME_UNKNOWN').message);
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
    assert.equal(f.status(), lifecycleReason('E_INSTANCE_RETIRING').message);
    assertIsolatedDetail(f.doc.querySelector('.lifecycle-details p'), { before: 'E_INSTANCE_RETIRING: ', detail: MESSY_LINE });
    assert.equal(f.button('lifecycle-confirm').hidden, true); assert.deepEqual(footer(f), ['Review again', 'Close']);
  } finally { f.close(); }
});
test("from the server: a Retire whose receipt reports a branch deletion or a skip shows Desktop's two fixed sentences and nothing of the receipt", async () => {
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
      assert.equal(f.status(), lifecycleReason('E_OUTCOME_UNKNOWN').message);
      assert.equal(f.doc.querySelector('.lifecycle-result').textContent, lifecycleReason('E_CLI_PROTOCOL').message, 'the cause sentence alone: no row, no Details');
      assert.equal(f.doc.querySelector('.lifecycle-details'), null);
      assert.doesNotMatch(told(f.doc), /UNSHOWN|Home folder deleted|Branch deleted|Branch deletion/);
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
test('each dialog shows only its own choices: a hidden choice stays hidden despite the label layout (Stop has no worktree option, Retire no children option)', () => {
  // The label's display:flex beats the user agent's [hidden] rule in Chromium; jsdom's cascade does not model that, so pin the rules.
  const dom = new JSDOM('<!doctype html><style></style>'), sheet = dom.window.document.querySelector('style');
  sheet.textContent = lifecycleCSS;
  const rules = [...sheet.sheet.cssRules];
  assert.equal(rules.find(r => r.selectorText === '.lifecycle-dialog label[hidden]')?.style.display, 'none');
  // Every region that sets its own display (the facts and options boxes, the status line) still hides: the generic rule comes last.
  const hidden = rules.findIndex(r => r.selectorText === '.lifecycle-dialog [hidden]');
  assert.equal(rules[hidden]?.style.display, 'none');
  for (const selector of ['.lifecycle-dialog .lifecycle-facts, .lifecycle-dialog .lifecycle-options', '.lifecycle-status', '.lifecycle-section', '.lifecycle-footer'])
    assert.ok(rules.findIndex(r => r.selectorText === selector) < hidden, selector);
  // No layout jump when the status line comes and goes (updating, Check again): it sits under the title, in a column tall enough for both.
  const titles = rules.find(r => r.selectorText === '.lifecycle-titles');
  assert.equal(titles?.style.minHeight, '42px'); assert.equal(titles.style.justifyContent, 'center');
  dom.window.close();
});
test('the status line lives in the heading, under the title, never between the title and the facts', () => {
  const f = fixture();
  try { f.open('retire'); const status = f.doc.querySelector('.lifecycle-status');
    assert.equal(status.parentElement.className, 'lifecycle-titles'); assert.equal(status.previousElementSibling.tagName, 'H2');
    assert.equal(status.parentElement.parentElement.className, 'lifecycle-heading'); } finally { f.close(); }
});

// ── The phases (spec: loading, review, updating, running, done, result) ──
test('loading: within one frame, the title, a skeleton What will happen (aria-busy), a visible status, and a disabled confirm described by it; focus on Cancel before and after the plan', async () => {
  const gate = deferred();
  const f = fixture({ request: () => gate.promise });
  try {
    f.doc.getElementById('opener').focus(); f.open('retire');
    // Synchronously after open: nothing has been awaited.
    assert.equal(f.title(), 'Retire dev-1?');
    const happen = f.doc.querySelector('.lifecycle-happen');
    assert.equal(happen.getAttribute('aria-busy'), 'true'); assert.ok(happen.querySelector('.skeleton[data-skeleton]'), 'skeleton lines from loading.mjs');
    assert.equal(happen.closest('section').querySelector('h3').textContent, 'What will happen');
    assert.equal(f.status(), 'Checking what retiring dev-1 will do…'); assert.equal(onScreen(f.doc.querySelector('.lifecycle-status')), true);
    const confirm = f.button('lifecycle-confirm');
    assert.equal(confirm.textContent, 'Retire instance'); assert.equal(confirm.disabled, true);
    assert.equal(f.doc.getElementById(confirm.getAttribute('aria-describedby')), f.doc.querySelector('.lifecycle-status'));
    assert.deepEqual(footer(f), ['Cancel', 'Retire instance']);
    assert.equal(f.doc.activeElement, f.button('lifecycle-close')); assert.equal(f.doc.activeElement.textContent, 'Cancel');
    // The worktree option is not offered yet: a one-line skeleton holds its place.
    assert.equal(f.doc.querySelectorAll('.lifecycle-options label:not([hidden])').length, 0);
    assert.ok(onScreen(f.doc.querySelector('.lifecycle-options .skeleton')));
    assertExplained(f, 'loading');
    gate.resolve(planned('retire')); await tick();
    assert.equal(happen.getAttribute('aria-busy'), 'false'); assert.equal(happen.querySelector('.skeleton'), null);
    assert.equal(confirm.disabled, false); assert.equal(confirm.hasAttribute('aria-describedby'), false);
    assert.equal(f.doc.activeElement, f.button('lifecycle-close'), 'focus did not move when the plan arrived');
    assert.equal(onScreen(f.doc.querySelector('.lifecycle-options .skeleton')), false);
    assertExplained(f, 'review');
  } finally { f.close(); }
});
test('a stop of several targets: one plain line, children first; "Stop sessions"; skipped children named; several stopped is the done title', async () => {
  const raw = stopPlan(); const child = { ...raw.targets[0], instance: 'kid', home: '/team/agents/dev/instances/kid', depth: 1, midTask: false };
  raw.targets.unshift(child);
  const receipt = stopReceipt({ revision: raw.planRevision, key: 'k' }, raw); receipt.results[0].alreadyIdle = true; receipt.results[0].stopped = false;
  const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned('stop', reference, raw)
    : { lifecycleApi: 1, status: 'complete', target, receipt: lifecycleReceipt(receipt, raw, 'k') } });
  try {
    f.open(); await tick();
    assert.equal(happenLines(f)[0], 'Stops 2 sessions, children first: kid, dev-1.');
    assert.deepEqual(factRows(f), [['kid', 'Running'], ['dev-1', 'Running']]); assert.equal(f.button('lifecycle-confirm').textContent, 'Stop sessions');
    f.button('lifecycle-confirm').click(); await tick();
    assert.equal(f.title(), '2 sessions stopped');
    assert.deepEqual([...f.doc.querySelectorAll('.lifecycle-result li')].map(li => li.textContent), ['kid: Was already stopped', 'dev-1: Stopped']);
  } finally { f.close(); }
  const skipped = stopPlan(false); skipped.skipped = [{ instance: 'kid', agent: 'dev', home: '/team/agents/dev/instances/kid', reason: 'not recursive' }];
  const g = fixture({ request: (_ws, body) => ({ ...planned('stop', reference, body.options.recursive ? stopPlan() : skipped), options: body.options }) });
  try {
    g.open(); g.check(g.doc.querySelector('input'), false); await tick();
    assert.ok(happenLines(g).includes('Not stopped: kid (children not included).'));
  } finally { g.close(); }
});
test('option toggle: every fact stays on screen while the new plan is read, the old ref is never submitted, and only the latest plan lands', async () => {
  const gates = [], refs = ['1', '2', '3'].map(c => c.repeat(64));
  const f = fixture({ request: (_ws, body) => {
    if (body.action === 'apply') return { lifecycleApi: 1, status: 'unknown', target, reason: lifecycleReason('E_OUTCOME_UNKNOWN') };
    const n = gates.length; if (n === 0) { gates.push(null); return planned('retire', refs[0]); } // the first read answers at once
    const gate = deferred(); gates.push(gate); return gate.promise.then(() => ({ ...planned('retire', refs[n]), options: body.options }));
  } });
  try {
    f.open('retire'); await tick();
    const before = { lines: happenLines(f), rows: factRows(f), nodes: f.doc.querySelectorAll('.lifecycle-happen li, .lifecycle-facts dt').length };
    const discard = f.doc.querySelectorAll('input')[1]; discard.focus(); f.check(discard, true);
    // Synchronously after the toggle: no empty frame, no layout jump.
    assert.deepEqual(happenLines(f), before.lines); assert.deepEqual(factRows(f), before.rows);
    assert.equal(f.doc.querySelectorAll('.lifecycle-happen li, .lifecycle-facts dt').length, before.nodes);
    assert.equal(f.doc.querySelector('.lifecycle-happen').getAttribute('aria-busy'), 'true');
    assert.equal(f.status(), 'Updating for this choice…');
    const confirm = f.button('lifecycle-confirm'); assert.equal(confirm.disabled, true);
    assert.equal(f.doc.getElementById(confirm.getAttribute('aria-describedby')).textContent, 'Updating for this choice…');
    assert.equal(discard.disabled, false, 'the latest choice wins'); assert.equal(f.doc.activeElement, discard, 'the checkbox keeps focus');
    assertExplained(f, 'updating');
    confirm.click(); await tick(); assert.equal(f.calls.filter(c => c.body.action === 'apply').length, 0);
    f.check(discard, false); await tick();
    assert.equal(f.calls.length, 3);
    // The first toggle's plan answers late: it never paints.
    gates[1].resolve(); await tick();
    assert.equal(f.status(), 'Updating for this choice…'); assert.equal(confirm.disabled, true); assert.equal(f.doc.querySelector('.lifecycle-warning').hidden, true);
    gates[2].resolve(); await tick();
    assert.equal(f.status(), ''); assert.equal(confirm.disabled, false); assert.equal(f.doc.activeElement, discard);
    confirm.click(); await tick();
    assert.deepEqual(f.calls.filter(c => c.body.action === 'apply').map(c => c.body.planRef), [refs[2]], 'neither the first nor the superseded ref');
  } finally { f.close(); }
});
test('checking "Also delete the worktree" swaps in a plan whose lines and warning say what it deletes and what it keeps', async () => {
  const f = fixture();
  try {
    f.open('retire'); await tick(); f.check(f.doc.querySelectorAll('input')[1], true); await tick();
    assert.ok(happenLines(f).includes('Deletes its worktree. Branch feat/work stays in the repository.'));
    const warning = f.doc.querySelector('.lifecycle-warning');
    assert.equal(warning.hidden, false);
    assert.equal(warning.textContent, 'Deletes the worktree folder, including 3 uncommitted changes (a recovery copy is saved first). Branch feat/work stays in the repository.');
  } finally { f.close(); }
  const unobserved = retirePlan(); unobserved.facts.work = { observed: false, reason: 'unreadable' };
  const g = fixture({ request: (_ws, body) => ({ ...planned('retire', reference, structuredClone(unobserved)), options: body.options }) });
  try {
    g.open('retire'); await tick();
    assert.deepEqual(factRows(g), [['Session', 'Running'], ['Uncommitted work', 'Unknown (unreadable)']]);
    g.check(g.doc.querySelectorAll('input')[1], true); await tick();
    assert.equal(g.doc.querySelector('.lifecycle-warning').textContent,
      'Deletes the worktree folder, including uncommitted changes, if any (a recovery copy is saved first). Branch agents/dev-1 stays in the repository.');
  } finally { g.close(); }
});
test('the worktree option is not offered for an instance without one; if a stale choice meets such a plan, the reason is visible and the choice can be undone', async () => {
  let mode = 'worktree';
  const f = fixture({ request: (_ws, body) => { const raw = retirePlan(); raw.facts.workMode = mode; return { ...planned('retire', reference, raw), options: body.options }; } });
  try {
    mode = 'directory'; f.open('retire'); await tick();
    assert.equal(f.doc.querySelector('.lifecycle-options').hidden, true, 'no choice to make, so no disabled checkbox');
    assert.equal(happenLines(f).some(l => /worktree/.test(l)), false);
    f.dialog.close(); mode = 'worktree'; f.open('retire'); await tick();
    f.check(f.doc.querySelectorAll('input')[1], true); await tick();
    mode = 'directory'; f.button('lifecycle-check').click(); assert.equal(f.status(), 'Checking again…'); await tick();
    assert.equal(f.status(), lifecycleReason('E_OPTION_UNAVAILABLE').message);
    assert.equal(f.button('lifecycle-confirm').disabled, true); assert.equal(f.doc.querySelectorAll('input')[1].parentElement.hidden, false);
    assertExplained(f, 'option unavailable');
  } finally { f.close(); }
});
test('running: only Close in the footer, a spinner and the note that it continues; Esc closes without cancelling, and the late answer paints nothing', async () => {
  const gate = deferred(); const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned('retire') : gate.promise });
  try {
    f.open('retire'); await tick(); f.button('lifecycle-confirm').focus(); f.button('lifecycle-confirm').click(); await tick();
    assert.equal(f.title(), 'Retiring dev-1…');
    assert.equal(f.status(), 'Retiring dev-1. This can take up to a minute while sessions stop.');
    assert.equal(onScreen(f.doc.querySelector('.lifecycle-status .spinner')), true);
    const note = [...f.doc.querySelectorAll('.lifecycle-note')].find(p => p.textContent === 'You can close this window; retirement continues.');
    assert.ok(note && onScreen(note)); assert.ok(onScreen(f.doc.querySelector('.lifecycle-happen')), 'What will happen stays as the context');
    assert.deepEqual(footer(f), ['Close']); assert.equal(f.doc.activeElement, f.button('lifecycle-close'));
    assert.deepEqual(disabledOnScreen(f), []); assertExplained(f, 'running');
    f.key('Escape'); assert.equal(f.doc.querySelector('.lifecycle-overlay'), null);
    const calls = f.calls.length;
    gate.resolve({ lifecycleApi: 1, status: 'complete', target, receipt: lifecycleReceipt(retireReceipt({ key: 'k', revision: retirePlan().planRevision }), retirePlan(), 'k') }); await tick();
    assert.equal(f.calls.length, calls, 'no further request'); assert.equal(f.settled.length, 0);
  } finally { f.close(); }
});
test('done: Done (or Esc) closes; when the retired row is gone, focus lands in the roster, never on <body>', async () => {
  for (const how of ['done', 'escape']) {
    const gate = deferred(), f = fixture({ fallbackFocus: () => f.doc.getElementById('successor'),
      request: (_ws, body) => body.action === 'plan' ? planned('retire') : gate.promise });
    try {
      f.doc.getElementById('opener').focus(); f.open('retire'); await tick(); f.button('lifecycle-confirm').click(); await tick();
      f.doc.getElementById('opener').remove(); // the roster refresh removed the retired row
      gate.resolve({ lifecycleApi: 1, status: 'complete', target, receipt: lifecycleReceipt(retireReceipt({ key: 'k', revision: retirePlan().planRevision }), retirePlan(), 'k') }); await tick();
      assert.equal(f.doc.activeElement, f.button('lifecycle-done')); assert.deepEqual(disabledOnScreen(f), []);
      assert.equal(f.doc.querySelector('.lifecycle-mark').dataset.tone, 'ok'); assert.equal(f.doc.querySelector('.lifecycle-mark').getAttribute('aria-hidden'), 'true');
      if (how === 'done') f.button('lifecycle-done').click(); else f.key('Escape');
      assert.equal(f.doc.querySelector('.lifecycle-overlay'), null);
      assert.equal(f.doc.activeElement.id, 'successor', how); assert.notEqual(f.doc.activeElement, f.doc.body);
    } finally { f.close(); }
  }
});
test('a refusal after dispatch lists what did happen and offers Review again, which reads a fresh plan and returns to review with Cancel', async () => {
  const raw = retirePlan(); raw.facts.children = [{ instance: 'kid', agent: 'dev', home: '/team/agents/dev/instances/kid', session: { state: 'running', present: true, established: true, backend: 'tmux' } }];
  let phase = 'first';
  const f = fixture({ request: (_ws, body) => body.action === 'apply'
    ? { lifecycleApi: 1, status: 'refused', target, planRef: null, plan: null, receipt: null, reason: lifecycleReason('E_CHILDREN_RUNNING'),
      childrenStopped: [{ instance: 'kid', home: '/team/agents/dev/instances/kid', ok: false, code: 'E_SESSION_STOP_FAILED', stillRunning: [4242] }] }
    : planned('retire', phase === 'first' ? reference : newReference, raw) });
  try {
    f.open('retire'); await tick();
    assert.ok(happenLines(f).includes('Stops its 1 child instance first: kid. They are kept, with their homes.'));
    assert.ok(happenLines(f).includes("If a child won't stop, nothing is retired."));
    f.button('lifecycle-confirm').click(); await tick();
    assert.equal(f.title(), "dev-1 wasn't retired");
    assert.equal(f.status(), "A child instance wouldn't stop, so nothing was retired. Other children may already have stopped.");
    assert.match(f.doc.querySelector('.lifecycle-result').textContent, /kid: Didn't stop \(still running: 4242\)/);
    assert.deepEqual(footer(f), ['Review again', 'Close']); assert.equal(f.doc.activeElement, f.button('lifecycle-close')); assertExplained(f, 'refusal');
    phase = 'second'; f.button('lifecycle-review').click();
    assert.equal(f.calls.at(-1).body.action, 'plan'); assert.equal(f.title(), 'Retire dev-1?'); assert.deepEqual(footer(f), ['Cancel', 'Retire instance']);
    assert.ok(f.doc.querySelector('.lifecycle-happen .skeleton')); assertExplained(f, 'loading again');
    await tick(); f.button('lifecycle-confirm').click(); await tick();
    assert.deepEqual(f.calls.filter(c => c.body.action === 'apply').map(c => c.body.planRef), [reference, newReference]);
  } finally { f.close(); }
});
test('a plan read that fails leaves no skeleton: a result with the reason and Review again', async () => {
  let fail = true;
  const f = fixture({ request: () => fail ? { lifecycleApi: 1, status: 'unavailable', target, reason: lifecycleReason('E_LIFECYCLE_BUSY') } : planned('retire') });
  try {
    f.open('retire'); await tick();
    assert.equal(f.title(), "Couldn't check what retiring dev-1 will do"); assert.equal(f.status(), lifecycleReason('E_LIFECYCLE_BUSY').message);
    assert.equal([...f.doc.querySelectorAll('.skeleton')].some(onScreen), false); assert.deepEqual(footer(f), ['Review again', 'Close']); assertExplained(f, 'plan failed');
    fail = false; f.button('lifecycle-review').click(); await tick(); assert.deepEqual(footer(f), ['Cancel', 'Retire instance']);
  } finally { f.close(); }
});
test('Check again in review keeps the facts on screen, says why confirm waits, and revokes the ref on screen', async () => {
  const gate = deferred(); let n = 0;
  const f = fixture({ request: (_ws, body) => body.action === 'apply' ? assert.fail('no apply') : ++n === 1 ? planned('retire') : gate.promise });
  try {
    f.open('retire'); await tick(); const lines = happenLines(f);
    f.button('lifecycle-check').click();
    assert.deepEqual(happenLines(f), lines); assert.equal(f.status(), 'Checking again…'); assert.equal(f.button('lifecycle-confirm').disabled, true);
    assertExplained(f, 'checking again');
    gate.resolve({ ...planned('retire', newReference) }); await tick(); assert.equal(f.button('lifecycle-confirm').disabled, false);
  } finally { f.close(); }
});
test('no user-visible "Remove" for retirement, in any phase or in the contract messages', async () => {
  const codes = ['E_BAD_ARGS', 'E_WORKSPACE_UNKNOWN', 'E_SESSION_UNKNOWN', 'E_AMBIGUOUS_INSTANCE', 'E_HOME_MISMATCH', 'cli-unavailable', 'E_LIFECYCLE_UNAVAILABLE',
    'unsupported-remote-operation', 'E_PLAN_REQUIRED', 'E_PLAN_EXPIRED', 'E_PLAN_CHANGED', 'E_OPTION_UNAVAILABLE', 'E_PLAN_STALE', 'E_PLAN_LIMIT', 'E_LIFECYCLE_BUSY',
    'E_INSTANCE_RETIRING', 'E_CHILDREN_RUNNING', 'E_SESSION_STOP_FAILED', 'E_WORK_PRESERVATION_FAILED', 'E_WORK_INSPECTION_FAILED', 'E_RETIRE_INCOMPLETE',
    'E_CLI_TIMEOUT', 'E_CLI_OUTPUT_LIMIT', 'E_CLI_PROTOCOL', 'E_CLI_FAILED', 'E_OUTCOME_UNKNOWN', 'E_FORBIDDEN_FRAME'];
  for (const code of codes) {
    assert.equal(lifecycleReason(code).code, code, `${code} has its own sentence`);
    assert.doesNotMatch(lifecycleReason(code).message, /\bRemove\b|kernel|Observe a fresh plan/, code);
  }
  const gate = deferred(), f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned('retire') : gate.promise });
  try {
    f.open('retire'); assert.doesNotMatch(told(f.doc), /\bRemove\b/, 'loading'); await tick(); assert.doesNotMatch(told(f.doc), /\bRemove\b/, 'review');
    f.button('lifecycle-confirm').click(); await tick(); assert.doesNotMatch(told(f.doc), /\bRemove\b/, 'running');
    gate.resolve({ lifecycleApi: 1, status: 'complete', target, receipt: lifecycleReceipt(retireReceipt({ key: 'k', revision: retirePlan().planRevision }), retirePlan(), 'k') }); await tick();
    assert.doesNotMatch(told(f.doc), /\bRemove\b/, 'done');
  } finally { f.close(); }
});
test('a replayed result says nothing ran again', async () => {
  const raw = retireReceipt({ key: 'k', revision: retirePlan().planRevision }); raw.replayed = true;
  const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned('retire') : { lifecycleApi: 1, status: 'complete', target, receipt: lifecycleReceipt(raw, retirePlan(), 'k') } });
  try {
    f.open('retire'); await tick(); f.button('lifecycle-confirm').click(); await tick();
    assert.match(f.doc.querySelector('.lifecycle-result').textContent, /This is the result already recorded for this confirmation; nothing ran again\./);
  } finally { f.close(); }
});
test('like Chromium, hiding a focused control blurs it: focus still lands on the control that stays, never <body>', async () => {
  let fail = true;
  const f = fixture({ request: (_ws, body) => body.action === 'plan' ? planned('retire', fail ? reference : newReference)
    : fail ? { lifecycleApi: 1, status: 'unknown', target, reason: lifecycleReason('E_OUTCOME_UNKNOWN') } : { lifecycleApi: 1, status: 'refused', target, reason: lifecycleReason('E_PLAN_EXPIRED') } });
  // jsdom keeps focus on a control that becomes hidden; Chromium blurs it at once, during the click that hid it.
  const hidden = Object.getOwnPropertyDescriptor(f.dom.window.HTMLElement.prototype, 'hidden');
  Object.defineProperty(f.dom.window.HTMLElement.prototype, 'hidden', { configurable: true, get: hidden.get,
    set(value) { hidden.set.call(this, value); if (value && this.contains(f.doc.activeElement)) f.doc.activeElement.blur(); } });
  try {
    f.open('retire'); await tick();
    f.button('lifecycle-confirm').focus(); f.button('lifecycle-confirm').click();
    assert.equal(f.doc.activeElement, f.button('lifecycle-close'), 'running: Close'); await tick();
    assert.deepEqual(footer(f), ['Check again', 'Close']);
    fail = false; f.button('lifecycle-retry').focus(); f.button('lifecycle-retry').click();
    assert.equal(f.doc.activeElement, f.button('lifecycle-close'), 'Check again → running: Close'); await tick();
    assert.deepEqual(footer(f), ['Review again', 'Close']);
    f.button('lifecycle-review').focus(); f.button('lifecycle-review').click();
    assert.equal(f.doc.activeElement, f.button('lifecycle-close'), 'Review again → loading: Cancel'); assert.equal(f.doc.activeElement.textContent, 'Cancel');
  } finally { f.close(); }
});
