// E_LIFECYCLE_BUSY read by `error.details.holder` (#866): the headline says that waiting ends the refusal
// only when the kernel says another command runs. Decided from the code, the field and the answering
// kernel's features, never from the kernel's message.
// Every kernel message in a fixture is a stand-in: no test depends on its words, and Desktop shows the whole
// line or none of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createLifecycleDialog } from '../renderer/lifecycle-dialog.mjs';
import { createLifecycleBoundary } from '../../client/instance-lifecycle.mjs';
import { busyHolder, busyHeadline, busyAbout, busyRefusal, lifecycleReason } from '../../client/lifecycle-contract.mjs';
import { DETAIL_WITHHELD } from '../../client/display-text.mjs';
import { DESKTOP_TERMS } from '../renderer/desktop-terms.mjs';
import { cli, context, envelope, instance, stopPlan, retirePlan, stopReceipt, retireReceipt, tick } from './helpers/lifecycle-fixture.mjs';
import { assertIsolatedDetail, MESSY, MESSY_LINE } from './helpers/detail-line.mjs';

const FEATURE = 'lifecycle-claim-stop', PROBE_FEATURES = 'server-probe-features';
const SAID = 'a stand-in for the kernel sentence: what was refused, and the step that ends it';
// Each sentence whole, once: every assertion below names it.
const TODAY = 'Another stop or retire is already running. Wait for it to finish, then review again.';
const HEADLINE = { running: 'Another OATS command is already running. Wait for it to finish, then review again.',
  unknown: "Nothing was done. OATS can't tell whether another command is still running.",
  none: 'Nothing was done, and there is no other command to wait for.',
  unstated: 'Nothing was done: OATS refused this as busy.' };
const LEAD = { unknown: 'It says what to check:', none: 'OATS says what to do:', unstated: 'It says:' };
const ABOUT = name => `This is about ${name}, which is in this plan.`;
const LEFTOVER_BUSY = "OATS can't confirm that the spawn which left this home has stopped, so it won't retire it yet. Check the process it names, then retire it from the CLI with --force.";
/** The answers a kernel can give in `details.holder`, with how each is read: the list, an absent field, and values outside the list. */
const HOLDERS = [['running', { holder: 'running' }], ['unknown', { holder: 'unknown' }], ['none', { holder: 'none' }],
  ['unstated', {}], ['unstated', { holder: 'paused' }], ['unstated', { holder: null }], ['unstated', { holder: 'unstated' }], ['unstated', { holder: ['running'] }]];

const kid = { instance: 'kid', agent: 'dev', home: '/team/agents/dev/instances/kid' };
const stopOf = (...children) => { const plan = stopPlan(); plan.targets.unshift(...children.map(c => ({ ...plan.targets[0], ...c, depth: 1, midTask: false }))); return plan; };
/** The kernel's error envelope as the adapter passes it on (`origin: 'kernel'`). */
const refused = (code, message, details) => ({ schemaVersion: 1, ok: false, origin: 'kernel', error: { code, message, details } });
const busy = (details, ...message) => refused('E_LIFECYCLE_BUSY', message.length ? message[0] : SAID, details);
const localContext = (features = []) => { const ctx = context(); ctx.cli.features.push(...features); return ctx; };
const routedContext = ({ local = [PROBE_FEATURES], probe } = {}) => ({ cli: { ...structuredClone(cli), features: [...cli.features, ...local], remote: ['lifecycle-plans'] }, localCwd: '/Users/me/work',
  workspace: { id: 'team', name: 'Build box', scope: '/srv', remote: true, server: 'build', group: probe === undefined ? {} : { probe } },
  instances: [{ ...instance, server: 'build', addressable: true, missingRemotely: false, savedRoute: false, running: true }] });
const WITH = [['local', () => localContext([FEATURE])], ['routed', () => routedContext({ probe: { ok: true, features: [FEATURE] } })]];
const WITHOUT = [['local', () => localContext()], ['routed, a host without it', () => routedContext({ local: [PROBE_FEATURES, FEATURE], probe: { ok: true, features: ['lifecycle-plans'] } })],
  ['routed, a host whose features are not known', () => routedContext({ local: [PROBE_FEATURES, FEATURE], probe: { ok: true, features: null } })],
  ['routed, a failed roster read', () => routedContext({ local: [PROBE_FEATURES, FEATURE], probe: { ok: false, features: [FEATURE] } })]];
const selectorOf = ctx => ({ instance: instance.instance, agent: instance.agent, agentsRoot: instance.agentsRoot, server: ctx.workspace.server ?? null });
const optionsOf = operation => operation === 'stop' ? { recursive: true } : { discardWorktree: false };
const planOf = operation => operation === 'stop' ? stopPlan() : retirePlan();

/** The boundary's replies: to a plan read the kernel answers with `planAnswer`, and to an apply with `answer`. */
async function replies(ctx, operation, { plan = planOf(operation), planAnswer, answer } = {}) {
  const service = createLifecycleBoundary({ terms: DESKTOP_TERMS, invoke: async (_bin, args) => args.phase === 'plan' ? planAnswer ?? envelope(plan) : answer });
  const planned = await service({ action: 'plan', operation, selector: selectorOf(ctx), options: optionsOf(operation) }, () => ctx);
  return { planned, applied: planned.status === 'plan' ? await service({ action: 'apply', planRef: planned.planRef }, () => ctx) : null };
}

test('busyHolder: the field is read only under E_LIFECYCLE_BUSY and only from a kernel that names lifecycle-claim-stop; a value it does not know reads as the weaker claim', () => {
  for (const [read, details] of HOLDERS) assert.equal(busyHolder('E_LIFECYCLE_BUSY', details, [FEATURE]), read, JSON.stringify(details));
  for (const details of [undefined, null, 'running', ['running'], 7]) assert.equal(busyHolder('E_LIFECYCLE_BUSY', details, [FEATURE]), 'unstated', JSON.stringify(details) ?? 'undefined');
  // Without the feature name, with null and with no argument: the rule does not apply, whatever the answer carries.
  for (const features of [['lifecycle-plans'], [], null, undefined, FEATURE]) assert.equal(busyHolder('E_LIFECYCLE_BUSY', { holder: 'none' }, features), null, JSON.stringify(features) ?? 'undefined');
  // Under any other code the field means nothing to a client.
  for (const code of ['E_LIFECYCLE_FAILED', 'E_INSTANCE_RETIRING', 'E_PLAN_STALE', undefined]) assert.equal(busyHolder(code, { holder: 'none' }, [FEATURE]), null, String(code));
  assert.deepEqual(Object.fromEntries(Object.keys(HEADLINE).map(holder => [holder, busyHeadline(holder)])), HEADLINE);
  // Only `running` tells the person to wait.
  for (const [holder, headline] of Object.entries(HEADLINE)) assert.equal(/\bwait\b/i.test(headline) && !/no other command to wait for/.test(headline), holder === 'running', holder);
});

test('the boundary, an apply: with the feature the reason carries how the busy answer is read, local and routed; without it the reason is today\'s', async () => {
  for (const operation of ['stop', 'retire']) {
    for (const [name, ctx] of WITH) for (const [read, details] of HOLDERS) {
      const c = ctx(), { applied } = await replies(c, operation, { answer: busy(details) });
      const where = `${operation}, ${name}, ${JSON.stringify(details)}`;
      assert.equal(applied.status, 'refused', where);
      assert.deepEqual(applied.reason, c.workspace.server ? { code: 'E_LIFECYCLE_BUSY', message: HEADLINE[read], detail: SAID, remote: true, holder: read }
        : { code: 'E_LIFECYCLE_BUSY', message: HEADLINE[read], detail: SAID, holder: read }, where);
    }
    for (const [name, ctx] of WITHOUT) for (const [, details] of HOLDERS) {
      const c = ctx(), { applied } = await replies(c, operation, { answer: busy(details) });
      assert.deepEqual(applied.reason, c.workspace.server ? { code: 'E_LIFECYCLE_BUSY', message: TODAY, detail: SAID, remote: true } : { code: 'E_LIFECYCLE_BUSY', message: TODAY, detail: SAID },
        `${operation}, ${name}, ${JSON.stringify(details)}`);
    }
  }
  assert.equal(lifecycleReason('E_LIFECYCLE_BUSY', DESKTOP_TERMS).message, TODAY, 'the code keeps its sentence');
});

test("a refused plan read follows the same rule: the kernel builds every E_LIFECYCLE_BUSY one way", async () => {
  for (const [name, ctx] of WITH) for (const [read, details] of HOLDERS) {
    const { planned } = await replies(ctx(), 'retire', { planAnswer: busy(details) });
    assert.equal(planned.status, 'unavailable', name); assert.equal(planned.reason.holder, read, `${name}, ${JSON.stringify(details)}`);
    assert.equal(planned.reason.message, HEADLINE[read]); assert.equal(Object.hasOwn(planned.reason, 'about'), false, 'a plan read has no plan to name a target from');
  }
  for (const [name, ctx] of WITHOUT) {
    const { planned } = await replies(ctx(), 'retire', { planAnswer: busy({ holder: 'none' }) });
    assert.equal(Object.hasOwn(planned.reason, 'holder'), false, name); assert.equal(planned.reason.message, TODAY, name);
  }
});

test("the field changes nothing outside the kernel's own E_LIFECYCLE_BUSY: another code, an answer that is not the kernel's, and Desktop's own busy", async () => {
  const strong = () => localContext([FEATURE]);
  // `details.holder` on an E_LIFECYCLE_FAILED (an answer made after a takeover ended a dead holder's step): not read.
  const failedAnswer = await replies(strong(), 'retire', { answer: refused('E_LIFECYCLE_FAILED', SAID, { holder: 'none', home: instance.home }) });
  assert.equal(failedAnswer.applied.status, 'unknown'); assert.equal(Object.hasOwn(failedAnswer.applied.cause, 'holder'), false);
  assert.doesNotMatch(JSON.stringify(failedAnswer.applied), /Nothing was done|no other command/);
  for (const code of ['E_INSTANCE_RETIRING', 'E_SESSION_UNKNOWN']) {
    const { applied } = await replies(strong(), 'stop', { answer: refused(code, SAID, { holder: 'none' }) });
    assert.deepEqual(applied.reason, { ...lifecycleReason(code, DESKTOP_TERMS), detail: SAID }, code);
  }
  // An envelope that does not say the kernel answered (no origin, or another one): today's sentence, whatever it carries.
  for (const origin of [undefined, 'adapter', true]) {
    const { applied, planned } = await replies(strong(), 'retire', { answer: { ...busy({ holder: 'none' }), origin } });
    assert.equal(Object.hasOwn(applied.reason, 'holder'), false, String(origin)); assert.equal(applied.reason.message, TODAY, String(origin)); assert.equal(planned.status, 'plan');
    const read = await replies(strong(), 'retire', { planAnswer: { ...busy({ holder: 'none' }), origin } });
    assert.equal(Object.hasOwn(read.planned.reason, 'holder'), false, String(origin)); assert.equal(read.planned.reason.message, TODAY);
  }
  // Desktop's own busy: the one apply slot. It carries no envelope, and keeps today's sentence with no detail.
  const ctx = strong(); let release;
  const service = createLifecycleBoundary({ terms: DESKTOP_TERMS, invoke: (_bin, args) => args.phase === 'plan' ? envelope(stopPlan()) : new Promise(resolve => { release = () => resolve(envelope(stopReceipt(args))); }) });
  const plan = () => service({ action: 'plan', operation: 'stop', selector: selectorOf(ctx), options: optionsOf('stop') }, () => ctx);
  const a = await plan(), b = await plan(), first = service({ action: 'apply', planRef: a.planRef }, () => ctx); await tick();
  assert.deepEqual((await service({ action: 'apply', planRef: b.planRef }, () => ctx)).reason, { code: 'E_LIFECYCLE_BUSY', message: TODAY });
  release(); assert.equal((await first).status, 'complete');
});

test("which instance the refusal is about: the boundary names a target of the plan by its home, and only one that is not the instance acted on", async () => {
  const plan = stopOf(kid), about = async details => (await replies(localContext([FEATURE]), 'stop', { plan, answer: busy(details) })).applied.reason.about;
  assert.deepEqual(await about({ holder: 'unknown', home: kid.home, instance: 'A-NAME-THE-KERNEL-SENT' }), { instance: 'kid', home: kid.home }, 'the name is the plan\'s, never details.instance');
  for (const details of [{ holder: 'unknown', home: instance.home }, { holder: 'unknown', home: '/team/agents/dev/instances/other' }, { holder: 'unknown' }, { holder: 'unknown', home: 7 }, { holder: 'unknown', instance: 'kid' }])
    assert.equal(await about(details), undefined, JSON.stringify(details));
  // A retire's claim refusal is of the home it retires: no target to name, a child's home included.
  const retire = retirePlan(); retire.facts.children = [{ ...kid, session: { state: 'running', present: true, established: true, backend: 'tmux' } }];
  assert.equal((await replies(localContext([FEATURE]), 'retire', { plan: retire, answer: busy({ holder: 'unknown', home: kid.home }) })).applied.reason.about, undefined);
  // Without the feature nothing of the details is read.
  assert.equal((await replies(localContext(), 'stop', { plan, answer: busy({ holder: 'unknown', home: kid.home }) })).applied.reason.about, undefined);
  assert.deepEqual(busyAbout(plan, kid.home), { instance: 'kid', home: kid.home }); assert.equal(busyAbout(plan, instance.home), null); assert.equal(busyAbout(null, kid.home), null);
});

test('busyRefusal re-validates a relayed reason: the headline is chosen from holder, never the reply\'s message; a sentence that is not a display line is not shown', () => {
  const reason = (holder, more = {}) => ({ code: 'E_LIFECYCLE_BUSY', message: 'A HEADLINE FROM THE REPLY', detail: SAID, holder, ...more });
  assert.deepEqual(busyRefusal(reason('running')), { headline: HEADLINE.running, about: null, lead: null, sentence: null, details: { code: 'E_LIFECYCLE_BUSY', detail: SAID } });
  for (const holder of ['unknown', 'none', 'unstated'])
    assert.deepEqual(busyRefusal(reason(holder)), { headline: HEADLINE[holder], about: null, lead: LEAD[holder], sentence: SAID, details: null }, holder);
  // Withheld by the filter: no second part, and Details shows that a detail was withheld. Nothing to show: neither.
  for (const holder of ['unknown', 'none', 'unstated']) {
    assert.deepEqual(busyRefusal(reason(holder, { detail: DETAIL_WITHHELD })), { headline: HEADLINE[holder], about: null, lead: null, sentence: null, details: { code: 'E_LIFECYCLE_BUSY', detail: DETAIL_WITHHELD } });
    for (const detail of [undefined, null, '', 'UNSHOWN two\nlines', 'UNSHOWN two  spaces', 'UNSHOWN token=abc123', 7])
      assert.deepEqual(busyRefusal(reason(holder, { detail })), { headline: HEADLINE[holder], about: null, lead: null, sentence: null, details: null }, `${holder} ${JSON.stringify(detail)}`);
  }
  // Not a busy reason that says who holds: read by the code's fixed sentence. A holder that is no string is
  // none of the names, also where it would be coerced to one as a property key.
  for (const other of [reason('paused'), reason(undefined), reason(null), reason('constructor'), reason(['none']), reason(['running']), reason([['unknown']]),
    reason({ toString: () => 'none' }), reason(new String('none')), { code: 'E_LIFECYCLE_BUSY', message: TODAY }, { ...reason('none'), code: 'E_LIFECYCLE_FAILED' }, null, 'E_LIFECYCLE_BUSY', [reason('none')]])
    assert.equal(busyRefusal(other), null, JSON.stringify(other));
  // The name: only a target of the reader's own plan, matched by home and by name, and never the instance acted on.
  const plan = stopOf(kid), named = about => busyRefusal(reason('unknown', { about }), plan).about;
  assert.equal(named({ instance: 'kid', home: kid.home }), ABOUT('kid')); assert.equal(ABOUT('kid'), 'This is about kid, which is in this plan.');
  for (const about of [{ instance: 'UNSHOWN', home: kid.home }, { instance: 'kid', home: '/team/agents/dev/instances/UNSHOWN' }, { instance: 'dev-1', home: instance.home }, { instance: 'kid' }, 'kid', null, undefined])
    assert.equal(named(about), null, JSON.stringify(about));
  assert.equal(busyRefusal(reason('unknown', { about: { instance: 'kid', home: kid.home } })).about, null, 'no plan snapshot, no name');
  assert.equal(busyRefusal(reason('unknown', { about: { instance: 'kid', home: kid.home } }), retirePlan()).about, null, 'a retire plan names no target');
});

/** The dialog over the real server boundary. `row` is the roster row it opens for. */
function mount(t, { ctx, operation, plan = planOf(operation), planAnswer, answer, row = instance }) {
  const dom = new JSDOM('<!doctype html><button id="opener">Actions</button>', { pretendToBeVisual: true }), doc = dom.window.document;
  const service = createLifecycleBoundary({ terms: DESKTOP_TERMS, invoke: async (_bin, args) => args.phase === 'plan' ? planAnswer ?? envelope(plan) : answer });
  const dialog = createLifecycleDialog({ doc, request: (_ws, body) => service(body, () => ctx) });
  t.after(() => { dialog.dispose(); dom.window.close(); });
  const opened = ctx.workspace.server ? { ...row, server: ctx.workspace.server, repoName: ctx.workspace.name, addressable: true } : row;
  const status = () => doc.querySelector('.lifecycle-dialog [role=status]');
  return { doc, async open() { dialog.open({ operation, instance: opened, workspace: 'team' }); await tick(); },
    async confirm() { await this.open(); doc.querySelector('.lifecycle-confirm').click(); await tick(); },
    title: () => doc.querySelector('.lifecycle-dialog h2').textContent,
    /** What the live region holds, in order: the headline, then each line under it. */
    said: () => { const [text, more] = status().querySelector('.lifecycle-status-body').children; return [text.textContent, ...[...more.children].map(el => el.textContent)]; },
    status, more: () => status().querySelector('.lifecycle-status-more'), details: () => doc.querySelector('.lifecycle-details'),
    result: () => doc.querySelector('.lifecycle-result') };
}

test('the dialog, with the feature: each holder has its headline; only running keeps the kernel sentence in Details, the others show it as the main text', async t => {
  for (const operation of ['stop', 'retire']) for (const [name, ctx] of WITH) for (const [read, details] of HOLDERS) {
    const u = mount(t, { ctx: ctx(), operation, answer: busy(details, MESSY) }), where = `${operation}, ${name}, ${JSON.stringify(details)}`;
    await u.confirm();
    assert.equal(u.title(), `dev-1 wasn't ${operation === 'stop' ? 'stopped' : 'retired'}`, where);
    if (read === 'running') {
      assert.deepEqual(u.said(), [HEADLINE.running], where); assert.equal(u.more().hidden, true);
      assert.equal(u.details().querySelector('summary').textContent, 'Details');
      assertIsolatedDetail(u.details().querySelector('p'), { before: 'E_LIFECYCLE_BUSY: ', detail: MESSY_LINE });
    } else {
      assert.deepEqual(u.said(), [HEADLINE[read], LEAD[read], MESSY_LINE], where); assert.equal(u.more().hidden, false);
      // The kernel's sentence: one display line, alone in its <bdi>, shown and not behind Details.
      assertIsolatedDetail(u.more().lastElementChild, { before: '', detail: MESSY_LINE });
      assert.equal(u.details(), null, where);
    }
    assert.equal(u.doc.body.textContent.split(MESSY_LINE).length, 2, `${where}: the kernel's sentence is said once`);
    assert.doesNotMatch(u.doc.body.textContent, /stop or retire is already running/, where);
    assert.deepEqual([...u.doc.querySelectorAll('.lifecycle-footer button')].filter(b => !b.hidden).map(b => b.textContent), ['Review again', 'Close'], where);
  }
});

test('a screen reader gets all of it with the headline: the lines are in the status live region, after the status text, in the order they are shown', async t => {
  const plan = stopOf(kid), u = mount(t, { ctx: localContext([FEATURE]), operation: 'stop', plan, answer: busy({ holder: 'unknown', home: kid.home }) });
  await u.confirm();
  const status = u.status();
  assert.equal(status.getAttribute('role'), 'status'); assert.equal(status.hidden, false);
  assert.deepEqual(u.said(), [HEADLINE.unknown, ABOUT('kid'), LEAD.unknown, SAID]);
  // One region, read in document order, with the lines apart as text.
  assert.equal(status.textContent, [HEADLINE.unknown, ABOUT('kid'), LEAD.unknown, SAID].join(' '));
  for (const el of u.more().children) assert.equal(status.contains(el), true);
  assert.equal(u.result().textContent, '', 'nothing of the refusal is outside the live region');
  // The next status replaces them: a review after the refusal says nothing of the old answer.
  u.doc.querySelector('.lifecycle-review').click();
  assert.equal(u.more().hidden, true); assert.equal(u.more().childNodes.length, 0);
  assert.doesNotMatch(status.textContent, /Nothing was done|This is about/);
});

test('a kernel sentence the filter withholds drops the second part of the headline, and Details shows that a detail was withheld; no sentence, no Details', async t => {
  for (const [read, details] of HOLDERS) {
    const withheld = mount(t, { ctx: localContext([FEATURE]), operation: 'retire', answer: busy(details, 'remove the claim: token=abc123') });
    await withheld.confirm();
    assert.deepEqual(withheld.said(), [HEADLINE[read]], JSON.stringify(details));
    assertIsolatedDetail(withheld.details().querySelector('p'), { before: 'E_LIFECYCLE_BUSY: ', detail: '[withheld]' });
    assert.doesNotMatch(withheld.doc.body.textContent, /abc123|remove the claim|It says|OATS says/);
    for (const message of [undefined, '', ' \n\t ']) {
      const bare = mount(t, { ctx: localContext([FEATURE]), operation: 'retire', answer: busy(details, message) });
      await bare.confirm();
      assert.deepEqual(bare.said(), [HEADLINE[read]], JSON.stringify(details)); assert.equal(bare.details(), null);
    }
  }
});

test("the dialog, without the feature: every busy answer reads as today, whatever holder it carries", async t => {
  for (const operation of ['stop', 'retire']) for (const [name, ctx] of WITHOUT) for (const [, details] of HOLDERS.slice(0, 4)) {
    const u = mount(t, { ctx: ctx(), operation, answer: busy(details, MESSY) }), where = `${operation}, ${name}, ${JSON.stringify(details)}`;
    await u.confirm();
    assert.deepEqual(u.said(), [TODAY], where); assert.equal(u.more().hidden, true, where);
    assertIsolatedDetail(u.details().querySelector('p'), { before: 'E_LIFECYCLE_BUSY: ', detail: MESSY_LINE });
    assert.doesNotMatch(u.doc.body.textContent, /Nothing was done|Another OATS command/, where);
  }
});

test('a refused plan read reads by holder too, with the feature; without it, as today', async t => {
  const u = mount(t, { ctx: localContext([FEATURE]), operation: 'retire', planAnswer: busy({ holder: 'none' }) });
  await u.open();
  assert.equal(u.title(), "Couldn't check what retiring dev-1 will do"); assert.deepEqual(u.said(), [HEADLINE.none, LEAD.none, SAID]);
  const v = mount(t, { ctx: localContext(), operation: 'retire', planAnswer: busy({ holder: 'none' }) });
  await v.open();
  assert.deepEqual(v.said(), [TODAY]); assert.equal(v.details().querySelector('p').textContent, `E_LIFECYCLE_BUSY: ${SAID}`);
});

test('the name line: a child of the plan is named between the headline and the kernel sentence; the acted instance and a home outside the plan give no line', async t => {
  const plan = stopOf(kid);
  for (const [read, details] of HOLDERS.slice(0, 4)) for (const [name, ctx] of WITH) {
    const u = mount(t, { ctx: ctx(), operation: 'stop', plan, answer: busy({ ...details, home: kid.home, instance: 'A-NAME-THE-KERNEL-SENT' }) });
    await u.confirm();
    assert.deepEqual(u.said(), read === 'running' ? [HEADLINE.running, ABOUT('kid')] : [HEADLINE[read], ABOUT('kid'), LEAD[read], SAID], `${name}, ${read}`);
    assert.doesNotMatch(u.doc.body.textContent, /A-NAME-THE-KERNEL-SENT/, 'details.instance is never shown');
  }
  for (const home of [instance.home, '/team/agents/dev/instances/other', undefined]) {
    const u = mount(t, { ctx: localContext([FEATURE]), operation: 'stop', plan, answer: busy({ holder: 'unknown', home }) });
    await u.confirm();
    assert.deepEqual(u.said(), [HEADLINE.unknown, LEAD.unknown, SAID], String(home));
  }
});

test("a name that is not in the renderer's own plan snapshot is not shown, whatever the reply says", async t => {
  const plan = stopOf(kid), target = { ...instance, workspace: 'team', server: null };
  const dom = new JSDOM('<!doctype html>', { pretendToBeVisual: true }), doc = dom.window.document;
  let about;
  const dialog = createLifecycleDialog({ doc, request: async (_ws, body) => body.action === 'plan'
    ? { lifecycleApi: 1, status: 'plan', target, planRef: 'd'.repeat(64), plan, options: { recursive: true }, receipt: null, reason: null }
    : { lifecycleApi: 1, status: 'refused', target, planRef: null, plan: null, receipt: null,
      reason: { code: 'E_LIFECYCLE_BUSY', message: 'A HEADLINE FROM THE REPLY', detail: SAID, holder: 'unknown', about } } });
  t.after(() => { dialog.dispose(); dom.window.close(); });
  const said = async value => { about = value; dialog.open({ operation: 'stop', instance, workspace: 'team' }); await tick(); doc.querySelector('.lifecycle-confirm').click(); await tick();
    return doc.querySelector('.lifecycle-dialog [role=status]').textContent; };
  assert.equal(await said({ instance: 'kid', home: kid.home }), [HEADLINE.unknown, ABOUT('kid'), LEAD.unknown, SAID].join(' '));
  for (const value of [{ instance: 'UNSHOWN', home: kid.home }, { instance: 'UNSHOWN', home: '/team/agents/dev/instances/UNSHOWN' }, { instance: 'kid', home: '/elsewhere/kid' }, { instance: 'dev-1', home: instance.home }, 'UNSHOWN']) {
    assert.equal(await said(value), [HEADLINE.unknown, LEAD.unknown, SAID].join(' '), JSON.stringify(value));
    assert.doesNotMatch(doc.body.textContent, /UNSHOWN|A HEADLINE FROM THE REPLY|This is about/);
  }
});

// The leftover sentence (a retire of a home a spawn left, `rollbackIncomplete`).
const leftover = { ...instance, rollbackIncomplete: true };

test('with the feature the holder decides and the row does not: the Desktop\'s own "--force" sentence is never shown, for any holder', async t => {
  for (const [name, ctx] of WITH) for (const [read, details] of HOLDERS) {
    const u = mount(t, { ctx: ctx(), operation: 'retire', answer: busy(details), row: leftover }), where = `${name}, ${JSON.stringify(details)}`;
    await u.confirm();
    assert.equal(u.said()[0], HEADLINE[read], where);
    assert.doesNotMatch(u.doc.body.textContent, /--force|the spawn which left this home/, where);
    assert.equal(u.doc.body.textContent.includes(LEFTOVER_BUSY), false, where);
  }
  // A retire of such a row refused because a stop is in flight is `running`: the waiting sentence.
  const u = mount(t, { ctx: localContext([FEATURE]), operation: 'retire', answer: busy({ holder: 'running', action: 'stop' }), row: leftover });
  await u.confirm(); assert.deepEqual(u.said(), [HEADLINE.running]);
});

test("without the feature the leftover sentence is shown as today: a retire, a rollbackIncomplete row, the kernel's busy with a message, a local answer", async t => {
  for (const [, details] of HOLDERS.slice(0, 4)) {
    const u = mount(t, { ctx: localContext(), operation: 'retire', answer: busy(details, MESSY), row: leftover });
    await u.confirm();
    assert.deepEqual(u.said(), [LEFTOVER_BUSY], JSON.stringify(details));
    assertIsolatedDetail(u.result().querySelector('p'), { before: '', detail: MESSY_LINE }); assert.equal(u.details(), null);
  }
  // A host whose features are not known: today's rule for a routed answer, which never was the leftover sentence.
  const routed = mount(t, { ctx: routedContext({ local: [PROBE_FEATURES, FEATURE], probe: { ok: true, features: null } }), operation: 'retire', answer: busy({ holder: 'unknown' }), row: leftover });
  await routed.confirm(); assert.deepEqual(routed.said(), [TODAY]);
});
