// The rows of a stop's `results` and of a retire's `childrenStopped` (#866): which kernel answered, how its
// rows are decoded, what each row is as data, and the sentences chosen from the rows.
// Every kernel `message` in a fixture is a stand-in, and nothing here reads one: Desktop decides from data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createLifecycleDialog } from '../renderer/lifecycle-dialog.mjs';
import { createLifecycleBoundary } from '../server/instance-lifecycle.mjs';
import { answeringFeatures, stoppedTargets, decodedStoppedTargets, lifecycleReceipt, publicLifecycleReceipt, stoppedRowKind, stoppedRowText,
  stopResultWords, childrenRefusedMessage, lifecycleReason } from '../../client/lifecycle-contract.mjs';
import { DESKTOP_TERMS } from '../renderer/desktop-terms.mjs';
import { cli, context, envelope, instance, stopPlan, retirePlan, stopReceipt, tick } from './helpers/lifecycle-fixture.mjs';
import { assertIsolatedDetail, MESSY, MESSY_LINE } from './helpers/detail-line.mjs';

const FEATURE = 'lifecycle-kernel-codes', PROBE_FEATURES = 'server-probe-features', STAND_IN = 'a stand-in for the kernel message';
// Each sentence whole, once: every assertion below names it.
const LINE = { idle: 'Was already stopped', stopped: 'Stopped', unrecorded: "Stopped, but OATS couldn't record it", unconfirmed: "Didn't stop",
  retiring: 'Not stopped: it is being retired', locked: "Not stopped: OATS couldn't lock its home",
  running: pids => `Didn't stop (still running: ${pids.join(', ')})` };
const NOT_EVERY = { status: 'Not every session stopped:', title: 'Not every session stopped' };
const UNRECORDED_TITLE = 'Stopped, but not recorded';
const ONE_UNRECORDED = name => `${name} stopped, but OATS couldn't record it.`;
const ALL_UNRECORDED = "Every session stopped, but OATS couldn't record all of them:";
const CHILDREN_RUNNING = "A child instance wouldn't stop, so nothing was retired. Other children may already have stopped.";
const CHILDREN_UNRECORDED = "The child instances stopped, but OATS couldn't record it for all of them, so nothing was retired.";

const kid = { instance: 'kid', agent: 'dev', home: '/team/agents/dev/instances/kid' };
const kid2 = { instance: 'kid-2', agent: 'dev', home: '/team/agents/dev/instances/kid-2' };
const failed = (who, stillRunning) => ({ instance: who.instance, home: who.home, ok: false, code: 'E_SESSION_STOP_FAILED', message: STAND_IN, stillRunning });
const fine = (who, alreadyIdle = false) => ({ instance: who.instance, home: who.home, ok: true, stopped: !alreadyIdle, alreadyIdle });
/** A stop plan of `kid` then dev-1 (children first), or of dev-1 alone. */
const stopOf = (...children) => { const plan = stopPlan(); plan.targets.unshift(...children.map(c => ({ ...plan.targets[0], ...c, depth: 1, midTask: false }))); return plan; };
/** A stop receipt whose rows are `rows` (in the plan's order); `ok` follows them, as the kernel answers. */
const stopAnswer = (args, plan, rows) => ({ ...stopReceipt(args, plan), ok: rows.every(r => r.ok), results: rows.map(r => r.ok ? { ...r, state: 'stopped' } : r) });
const retireOf = (...children) => { const plan = retirePlan(); plan.facts.children = children.map(c => ({ ...c, session: { state: 'running', present: true, established: true, backend: 'tmux' } })); return plan; };
const childrenRefused = (plan, rows) => ({ schemaVersion: 1, ok: false, error: { code: 'E_CHILDREN_RUNNING', message: STAND_IN, details: { plan, childrenStopped: rows } } });

test('answeringFeatures: a local command is answered by the selected CLI, a routed one by the host, and anything not known is null', () => {
  const local = { ...cli, features: [...cli.features, FEATURE] };
  assert.deepEqual(answeringFeatures({ cli: local, routed: false }), local.features);
  assert.notEqual(answeringFeatures({ cli: local, routed: false }), local.features, 'a copy: the answer keeps nothing of the caller');
  // Routed: the host's own list, relayed in the workspace's roster group. This computer's list says nothing of the host.
  const relaying = { ...cli, features: [...cli.features, PROBE_FEATURES] }, group = features => ({ probe: { ok: true, features } });
  assert.deepEqual(answeringFeatures({ cli: relaying, routed: true, group: group([FEATURE, 'lifecycle-plans']) }), [FEATURE, 'lifecycle-plans']);
  assert.deepEqual(answeringFeatures({ cli: { ...relaying, features: [...relaying.features, FEATURE] }, routed: true, group: group(['lifecycle-plans']) }), ['lifecycle-plans'],
    "the host's list, not this computer's");
  // Unknown: each is null, never this computer's list.
  const strong = { ...relaying, features: [...relaying.features, FEATURE] };
  for (const [name, input] of [
    ['probe.ok false', { cli: strong, routed: true, group: { probe: { ok: false, features: [FEATURE] } } }],
    ['features: null (an older host)', { cli: strong, routed: true, group: group(null) }],
    ['no features key', { cli: strong, routed: true, group: { probe: { ok: true } } }],
    ['no probe (a failed roster read)', { cli: strong, routed: true, group: {} }],
    ['no group', { cli: strong, routed: true }],
    ["this computer's CLI does not relay the hosts' lists", { cli: { ...local }, routed: true, group: group([FEATURE]) }],
    ['routed not said', { cli: strong, group: group([FEATURE]) }],
    ['routed not a boolean', { cli: strong, routed: 'false' }],
    ['a CLI that is not accepted', { cli: { ...strong, ok: false }, routed: false }],
    ['a CLI without a features list', { cli: { ...strong, features: 'lifecycle-kernel-codes' }, routed: false }],
    ['no CLI', { routed: false }],
  ]) assert.equal(answeringFeatures(input), null, name);
  assert.equal(answeringFeatures(), null);
});

test("the decoder keeps a failed row's `[]` only for a kernel that names lifecycle-kernel-codes; without it, with null and with no argument it is null", () => {
  const stop = stopOf(kid), key = 'k', raw = () => stopAnswer({ revision: stop.planRevision, key }, stop, [failed(kid, []), fine(instance)]);
  const retire = retireOf(kid, kid2), rows = () => [failed(kid, []), fine(kid2)];
  const decodedStop = features => lifecycleReceipt(raw(), stop, key, features === undefined ? undefined : { features }).results[0].stillRunning;
  const decodedChild = (...more) => stoppedTargets(rows(), retire.facts.children, false, ...more)[0].stillRunning;
  // With the name: `[]` says the harness exited.
  assert.deepEqual(decodedStop([FEATURE]), []); assert.deepEqual(decodedChild({ features: ['lifecycle-plans', FEATURE] }), []);
  // Without: a list that lacks it, null, an option bag without it, no argument, and a value that is no list.
  for (const features of [['lifecycle-plans'], [], null, undefined, FEATURE, { [FEATURE]: true }]) assert.equal(decodedStop(features), null, JSON.stringify(features));
  for (const more of [[{ features: ['lifecycle-plans'] }], [{ features: null }], [{}], [], [{ features: FEATURE }]]) assert.equal(decodedChild(...more), null, JSON.stringify(more));
  assert.equal(stoppedTargets(rows(), retire.facts.children)[0].stillRunning, null, 'a caller that forgets the argument makes the weaker claim');
  // The other two values are the kernel's in every kernel: pids stay pids, null stays null.
  for (const features of [[FEATURE], null]) {
    assert.deepEqual(stoppedTargets([failed(kid, [42, 43]), failed(kid2, null)], retire.facts.children, false, { features }).map(r => r.stillRunning), [[42, 43], null]);
  }
  // The message of a row is never part of a decoded row.
  assert.doesNotMatch(JSON.stringify([lifecycleReceipt(raw(), stop, key, { features: [FEATURE] }), stoppedTargets(rows(), retire.facts.children, false, { features: [FEATURE] })]), /stand-in/);
});

test("the re-read of rows a server already decoded keeps a failed row's `[]`, takes no features and never decodes again", () => {
  const stop = stopOf(kid), key = 'k';
  const receipt = lifecycleReceipt(stopAnswer({ revision: stop.planRevision, key }, stop, [failed(kid, []), fine(instance)]), stop, key, { features: [FEATURE] });
  assert.deepEqual(publicLifecycleReceipt(structuredClone(receipt), stop), receipt);
  assert.deepEqual(publicLifecycleReceipt(structuredClone(receipt), stop).results[0].stillRunning, []);
  // A server that decoded a kernel without the feature sent null: it stays null.
  const weaker = lifecycleReceipt(stopAnswer({ revision: stop.planRevision, key }, stop, [failed(kid, []), fine(instance)]), stop, key);
  assert.equal(publicLifecycleReceipt(structuredClone(weaker), stop).results[0].stillRunning, null);
  const retire = retireOf(kid, kid2), children = stoppedTargets([failed(kid, []), fine(kid2)], retire.facts.children, false, { features: [FEATURE] });
  assert.deepEqual(decodedStoppedTargets(structuredClone(children), retire.facts.children), children);
  assert.deepEqual(decodedStoppedTargets(structuredClone(children), retire.facts.children)[0].stillRunning, []);
  // Still a validation: identities, order and the shape of each row.
  assert.equal(decodedStoppedTargets([children[1], children[0]], retire.facts.children), null);
  assert.equal(decodedStoppedTargets([{ ...children[0], stillRunning: [0] }, children[1]], retire.facts.children), null);
  assert.equal(decodedStoppedTargets(children.slice(0, 1), retire.facts.children), null);
});

test('what a row is, as data: the five kinds; `[]` in a row that is ok is not unrecorded', () => {
  const kinds = [[fine(kid, true), 'idle'], [fine(kid), 'stopped'], [failed(kid, [7]), 'running'], [failed(kid, []), 'unrecorded'], [failed(kid, null), 'unconfirmed']];
  for (const [row, kind] of kinds) assert.equal(stoppedRowKind(row), kind);
  assert.equal(stoppedRowKind({ ...fine(kid), stillRunning: [] }), 'stopped'); assert.equal(stoppedRowKind({ ...fine(kid, true), stillRunning: [] }), 'idle');
  // A failed row with no stillRunning at all establishes nothing.
  assert.equal(stoppedRowKind({ instance: 'kid', home: kid.home, ok: false, code: 'E_SESSION_STOP_FAILED' }), 'unconfirmed');
  assert.deepEqual(kinds.map(([row]) => stoppedRowText(row)), [LINE.idle, LINE.stopped, LINE.running([7]), LINE.unrecorded, LINE.unconfirmed]);
  assert.equal(stoppedRowText(failed(kid, [7, 8])), "Didn't stop (still running: 7, 8)");
});

test('the sentence above the rows is chosen from the rows: all unrecorded reads as stopped and not recorded, anything else as today', () => {
  assert.deepEqual(stopResultWords([failed(instance, [])]), { status: ONE_UNRECORDED('dev-1'), title: UNRECORDED_TITLE });
  assert.equal(ONE_UNRECORDED('dev-1'), "dev-1 stopped, but OATS couldn't record it.");
  assert.deepEqual(stopResultWords([fine(kid), failed(instance, [])]), { status: ALL_UNRECORDED, title: UNRECORDED_TITLE });
  assert.deepEqual(stopResultWords([failed(kid, []), failed(instance, [])]), { status: ALL_UNRECORDED, title: UNRECORDED_TITLE });
  for (const rows of [[failed(instance, null)], [failed(instance, [9])], [failed(kid, []), failed(instance, null)], [failed(kid, [9]), failed(instance, [])], [fine(kid), failed(instance, null)]])
    assert.deepEqual(stopResultWords(rows), NOT_EVERY, JSON.stringify(rows.map(r => r.stillRunning)));
  assert.equal(childrenRefusedMessage([failed(kid, [])]), CHILDREN_UNRECORDED); assert.equal(childrenRefusedMessage([fine(kid), failed(kid2, [])]), CHILDREN_UNRECORDED);
  for (const rows of [[failed(kid, null)], [failed(kid, [9])], [failed(kid, []), failed(kid2, null)], [failed(kid, []), failed(kid2, [9])]]) assert.equal(childrenRefusedMessage(rows), CHILDREN_RUNNING);
  assert.equal(lifecycleReason('E_CHILDREN_RUNNING', DESKTOP_TERMS).message, CHILDREN_RUNNING, 'the code keeps its sentence');
});

/** A local context whose CLI names `features` beside the lifecycle ones. */
const localContext = (features = []) => { const ctx = context(); ctx.cli.features.push(...features); return ctx; };
/** A routed context: this computer's CLI names `local`, the host's roster group reports `probe`. */
const routedContext = ({ local = [PROBE_FEATURES], probe } = {}) => ({ cli: { ...structuredClone(cli), features: [...cli.features, ...local], remote: ['lifecycle-plans'] }, localCwd: '/Users/me/work',
  workspace: { id: 'team', name: 'Build box', scope: '/srv', remote: true, server: 'build', group: probe === undefined ? {} : { probe } },
  instances: [{ ...instance, server: 'build', addressable: true, missingRemotely: false, savedRoute: false, running: true }] });
const selectorOf = ctx => ({ instance: instance.instance, agent: instance.agent, agentsRoot: instance.agentsRoot, server: ctx.workspace.server ?? null });
/** The boundary's reply to one apply: `plan` is what the kernel plans, `answer(args)` what it answers the apply. */
async function applied(ctx, operation, plan, answer) {
  const service = createLifecycleBoundary({ invoke: async (_bin, args) => args.phase === 'plan' ? envelope(plan) : answer(args) });
  const planned = await service({ action: 'plan', operation, selector: selectorOf(ctx), options: operation === 'stop' ? { recursive: true } : { discardWorktree: false } }, () => ctx);
  assert.equal(planned.status, 'plan', JSON.stringify(planned.reason));
  return service({ action: 'apply', planRef: planned.planRef }, () => ctx);
}
/** Contexts whose answering kernel names the feature, and contexts where it does not or is not known. */
const WITH = [['local', () => localContext([FEATURE])], ['routed', () => routedContext({ probe: { ok: true, features: [FEATURE] } })]];
const WITHOUT = [['local', () => localContext()], ['routed, a host without it', () => routedContext({ local: [PROBE_FEATURES, FEATURE], probe: { ok: true, features: ['lifecycle-plans'] } })],
  ['routed, features: null', () => routedContext({ local: [PROBE_FEATURES, FEATURE], probe: { ok: true, features: null } })],
  ['routed, probe.ok false', () => routedContext({ local: [PROBE_FEATURES, FEATURE], probe: { ok: false, features: [FEATURE] } })],
  ['routed, no probe', () => routedContext({ local: [PROBE_FEATURES, FEATURE] })],
  ['routed, this CLI does not relay the list', () => routedContext({ local: [FEATURE], probe: { ok: true, features: [FEATURE] } })]];

test("the boundary, a stop's receipt: a failed row's `[]` reaches the reply only from a kernel that names the feature; the reply is partial either way", async () => {
  const plan = stopOf(kid), answer = args => envelope(stopAnswer(args, plan, [failed(kid, []), fine(instance)]));
  for (const [name, ctx] of WITH) {
    const reply = await applied(ctx(), 'stop', plan, answer);
    assert.equal(reply.status, 'partial', name); assert.deepEqual(reply.receipt.results.map(r => r.ok ? 'ok' : r.stillRunning), [[], 'ok'], name);
    assert.deepEqual(reply.reason, lifecycleReason('E_SESSION_STOP_FAILED', DESKTOP_TERMS), 'no code, status or reason of the reply changes');
  }
  for (const [name, ctx] of WITHOUT) {
    const reply = await applied(ctx(), 'stop', plan, answer);
    assert.equal(reply.status, 'partial', name); assert.deepEqual(reply.receipt.results.map(r => r.ok ? 'ok' : r.stillRunning), [null, 'ok'], name);
    assert.deepEqual(reply.reason, lifecycleReason('E_SESSION_STOP_FAILED', DESKTOP_TERMS), name);
  }
});

test("the boundary, a retire refused with E_CHILDREN_RUNNING: the child rows follow the same rule, and the refusal stays a refusal", async () => {
  const plan = retireOf(kid, kid2), answer = () => childrenRefused(plan, [failed(kid, []), fine(kid2)]);
  for (const [name, ctx] of WITH) {
    const reply = await applied(ctx(), 'retire', plan, answer);
    assert.equal(reply.status, 'refused', name); assert.deepEqual(reply.childrenStopped.map(r => r.ok ? 'ok' : r.stillRunning), [[], 'ok'], name);
    assert.deepEqual(reply.reason, lifecycleReason('E_CHILDREN_RUNNING', DESKTOP_TERMS), name);
  }
  for (const [name, ctx] of WITHOUT) {
    const reply = await applied(ctx(), 'retire', plan, answer);
    assert.equal(reply.status, 'refused', name); assert.deepEqual(reply.childrenStopped.map(r => r.ok ? 'ok' : r.stillRunning), [null, 'ok'], name);
  }
});

/** The dialog over the real server boundary. `plan` is the kernel's plan, `answer(args)` its answer to the apply. */
function mount(t, { ctx, operation, plan, answer }) {
  const dom = new JSDOM('<!doctype html><button id="opener">Actions</button>', { pretendToBeVisual: true }), doc = dom.window.document, replies = [];
  const service = createLifecycleBoundary({ invoke: async (_bin, args) => args.phase === 'plan' ? envelope(plan) : answer(args) });
  const dialog = createLifecycleDialog({ doc, request: async (_ws, body) => { const reply = await service(body, () => ctx); replies.push(structuredClone(reply)); return reply; } });
  t.after(() => { dialog.dispose(); dom.window.close(); });
  const row = ctx.workspace.server ? { ...instance, server: ctx.workspace.server, repoName: ctx.workspace.name, addressable: true } : instance;
  const shown = el => { for (let n = el; n; n = n.parentElement) if (n.hidden) return false; return true; };
  return { doc, replies,
    async confirm() { dialog.open({ operation, instance: row, workspace: 'team' }); await tick(); this.markBefore = doc.querySelector('.lifecycle-mark').innerHTML;
      doc.querySelector('.lifecycle-confirm').click(); await tick(); },
    status: () => doc.querySelector('.lifecycle-dialog [role=status]').textContent, title: () => doc.querySelector('.lifecycle-dialog h2').textContent,
    lines: () => [...doc.querySelectorAll('.lifecycle-result li')].map(li => li.textContent),
    /** Each row as its line and, under it, the element that quotes the kernel (or null). */
    rows: () => [...doc.querySelectorAll('.lifecycle-result li')].map(li => ({ line: li.firstElementChild.textContent, quote: li.querySelector('.lifecycle-quote') })),
    footer: () => [...doc.querySelectorAll('.lifecycle-footer button')].filter(shown).map(b => b.textContent),
    mark: () => doc.querySelector('.lifecycle-mark'), phase: () => doc.querySelector('.lifecycle-dialog').dataset.phase };
}
/** Never done: no check mark, the result phase, Review again offered. */
function assertNotDone(u, where) {
  assert.equal(u.phase(), 'result', where); assert.equal(u.mark().dataset.tone, undefined, `${where}: no ok tone`);
  assert.equal(u.mark().innerHTML, u.markBefore, `${where}: the mark is not replaced by a check`);
  assert.deepEqual(u.footer(), ['Review again', 'Close'], where);
}

test('a stop of one target whose session stopped and was not recorded: its own status line and title, the row says so, and it is never done', async t => {
  for (const [name, ctx] of WITH) {
    const plan = stopPlan(), u = mount(t, { ctx: ctx(), operation: 'stop', plan, answer: args => envelope(stopAnswer(args, plan, [failed(instance, [])])) });
    await u.confirm();
    assert.equal(u.replies.at(-1).status, 'partial', name);
    assert.equal(u.status(), ONE_UNRECORDED('dev-1'), name); assert.equal(u.title(), UNRECORDED_TITLE, name);
    assert.deepEqual(u.lines(), [`dev-1: ${LINE.unrecorded}`], name);
    assertNotDone(u, name);
  }
});

test('a stop of several targets, every failed row unrecorded: "Every session stopped, but…", each row its own line', async t => {
  for (const [name, ctx] of WITH) {
    const plan = stopOf(kid, kid2), u = mount(t, { ctx: ctx(), operation: 'stop', plan,
      answer: args => envelope(stopAnswer(args, plan, [failed(kid, []), fine(kid2, true), failed(instance, [])])) });
    await u.confirm();
    assert.equal(u.status(), ALL_UNRECORDED, name); assert.equal(u.title(), UNRECORDED_TITLE, name);
    assert.deepEqual(u.lines(), [`kid: ${LINE.unrecorded}`, `kid-2: ${LINE.idle}`, `dev-1: ${LINE.unrecorded}`], name);
    assertNotDone(u, name);
  }
});

test("rows of mixed kinds keep today's sentence above them, each row its own line", async t => {
  const plan = stopOf(kid, kid2);
  for (const [rows, lines] of [
    [[failed(kid, []), failed(kid2, null), fine(instance)], [`kid: ${LINE.unrecorded}`, `kid-2: ${LINE.unconfirmed}`, `dev-1: ${LINE.stopped}`]],
    [[failed(kid, [4242]), failed(kid2, []), failed(instance, [])], [`kid: ${LINE.running([4242])}`, `kid-2: ${LINE.unrecorded}`, `dev-1: ${LINE.unrecorded}`]],
    [[fine(kid), fine(kid2), failed(instance, null)], [`kid: ${LINE.stopped}`, `kid-2: ${LINE.stopped}`, `dev-1: ${LINE.unconfirmed}`]],
  ]) {
    const u = mount(t, { ctx: localContext([FEATURE]), operation: 'stop', plan, answer: args => envelope(stopAnswer(args, plan, rows)) });
    await u.confirm();
    assert.equal(u.status(), NOT_EVERY.status); assert.equal(u.title(), NOT_EVERY.title); assert.deepEqual(u.lines(), lines); assertNotDone(u, lines.join('|'));
  }
});

test("a kernel that does not name the feature: a failed row with `[]` shows exactly today's text, from the server's reply to the screen", async t => {
  for (const [name, ctx] of WITHOUT) {
    const one = stopPlan(), u = mount(t, { ctx: ctx(), operation: 'stop', plan: one, answer: args => envelope(stopAnswer(args, one, [failed(instance, [])])) });
    await u.confirm();
    assert.equal(u.replies.at(-1).receipt.results[0].stillRunning, null, name);
    assert.equal(u.status(), NOT_EVERY.status, name); assert.equal(u.title(), NOT_EVERY.title, name);
    assert.deepEqual(u.lines(), [`dev-1: ${LINE.unconfirmed}`], name); assertNotDone(u, name);
    assert.doesNotMatch(u.doc.body.textContent, /record/, `${name}: nothing says "stopped, but not recorded"`);
    const plan = retireOf(kid), v = mount(t, { ctx: ctx(), operation: 'retire', plan, answer: () => childrenRefused(plan, [failed(kid, [])]) });
    await v.confirm();
    assert.equal(v.status(), CHILDREN_RUNNING, name); assert.equal(v.title(), "dev-1 wasn't retired", name);
    assert.deepEqual(v.lines(), [`kid: ${LINE.unconfirmed}`], name);
    assert.doesNotMatch(v.doc.body.textContent, /record/, name);
  }
});

test("a retire refused with E_CHILDREN_RUNNING whose children all stopped: the sentence says so, the child list agrees, and it is still a refusal", async t => {
  for (const [name, ctx] of WITH) {
    const plan = retireOf(kid, kid2), u = mount(t, { ctx: ctx(), operation: 'retire', plan, answer: () => childrenRefused(plan, [failed(kid, []), fine(kid2)]) });
    await u.confirm();
    assert.equal(u.replies.at(-1).status, 'refused', name); assert.equal(u.replies.at(-1).reason.code, 'E_CHILDREN_RUNNING', name);
    assert.equal(u.status(), CHILDREN_UNRECORDED, name); assert.equal(u.title(), "dev-1 wasn't retired", name);
    assert.equal(u.doc.querySelector('.lifecycle-result .lifecycle-note').textContent, 'Child instances:');
    assert.deepEqual(u.lines(), [`kid: ${LINE.unrecorded}`, `kid-2: ${LINE.stopped}`], name);
    assertNotDone(u, name);
  }
  // A child that still runs, or whose stop established nothing, beside one that stopped unrecorded: today's sentence.
  for (const other of [failed(kid2, [4242]), failed(kid2, null)]) {
    const plan = retireOf(kid, kid2), u = mount(t, { ctx: localContext([FEATURE]), operation: 'retire', plan, answer: () => childrenRefused(plan, [failed(kid, []), other]) });
    await u.confirm();
    assert.equal(u.status(), CHILDREN_RUNNING);
    assert.deepEqual(u.lines(), [`kid: ${LINE.unrecorded}`, `kid-2: ${other.stillRunning ? LINE.running([4242]) : LINE.unconfirmed}`]);
  }
});

test('the dialog validates the child rows of a reply and never decodes them again: a row that is no decoded row is an unknown outcome', async t => {
  const plan = retireOf(kid), target = { ...instance, workspace: 'team', server: null };
  const dom = new JSDOM('<!doctype html>', { pretendToBeVisual: true }), doc = dom.window.document;
  let children;
  const dialog = createLifecycleDialog({ doc, request: async (_ws, body) => body.action === 'plan'
    ? { lifecycleApi: 1, status: 'plan', target, planRef: 'd'.repeat(64), plan, options: { discardWorktree: false }, receipt: null, reason: null }
    : { lifecycleApi: 1, status: 'refused', target, planRef: null, plan: null, receipt: null, reason: lifecycleReason('E_CHILDREN_RUNNING', DESKTOP_TERMS), childrenStopped: children } });
  t.after(() => { dialog.dispose(); dom.window.close(); });
  const shown = async rows => { children = rows; dialog.open({ operation: 'retire', instance, workspace: 'team' }); await tick(); doc.querySelector('.lifecycle-confirm').click(); await tick();
    return { status: doc.querySelector('.lifecycle-dialog [role=status]').textContent, lines: [...doc.querySelectorAll('.lifecycle-result li')].map(li => li.textContent) }; };
  // The reply's `[]` is the server's decoded value: kept, with no features passed by the dialog.
  assert.deepEqual(await shown([{ instance: 'kid', home: kid.home, ok: false, code: 'E_SESSION_STOP_FAILED', stillRunning: [] }]), { status: CHILDREN_UNRECORDED, lines: [`kid: ${LINE.unrecorded}`] });
  for (const rows of [[{ instance: 'other', home: kid.home, ok: false, code: 'E_SESSION_STOP_FAILED', stillRunning: [] }], [], 'rows']) {
    const view = await shown(rows);
    assert.equal(view.status, lifecycleReason('E_OUTCOME_UNKNOWN', DESKTOP_TERMS).message, JSON.stringify(rows)); assert.deepEqual(view.lines, []);
  }
});

// A child that another command holds (#866): nothing was tried on it, so its row never reads "Didn't stop".
// The documented shape of a held child: `stillRunning: null`, one row per plan child, in the plan's order.
const held = (who, code, ...message) => ({ instance: who.instance, home: who.home, ok: false, code, message: message.length ? message[0] : STAND_IN, stillRunning: null });

test('a row with E_INSTANCE_RETIRING is retiring and one with E_LIFECYCLE_BUSY is locked, whatever its stillRunning says: the code decides first', () => {
  for (const stillRunning of [null, [], [4242]]) {
    assert.equal(stoppedRowKind({ ...held(kid, 'E_INSTANCE_RETIRING'), stillRunning }), 'retiring', JSON.stringify(stillRunning));
    assert.equal(stoppedRowKind({ ...held(kid, 'E_LIFECYCLE_BUSY'), stillRunning }), 'locked', JSON.stringify(stillRunning));
    assert.equal(stoppedRowText({ ...held(kid, 'E_INSTANCE_RETIRING'), stillRunning }), LINE.retiring); assert.equal(stoppedRowText({ ...held(kid, 'E_LIFECYCLE_BUSY'), stillRunning }), LINE.locked);
  }
  // A row that is ok is never one of them, whatever else it carries.
  assert.equal(stoppedRowKind({ ...fine(kid), code: 'E_LIFECYCLE_BUSY' }), 'stopped');
  // Neither is "stopped, but not recorded": those sentences need every failed row to be unrecorded.
  for (const code of ['E_INSTANCE_RETIRING', 'E_LIFECYCLE_BUSY']) {
    assert.deepEqual(stopResultWords([failed(kid, []), { ...held(instance, code), stillRunning: [] }]), NOT_EVERY, code);
    assert.equal(childrenRefusedMessage([failed(kid, []), { ...held(kid2, code), stillRunning: [] }]), CHILDREN_RUNNING, code);
    assert.equal(childrenRefusedMessage([held(kid, code)]), CHILDREN_RUNNING, code);
  }
});

test("the decoder keeps a row's kernel sentence for a locked row only, as one display line; the re-read keeps it only when it is one", () => {
  const retire = retireOf(kid, kid2), decode = rows => stoppedTargets(rows, retire.facts.children, false, { features: [FEATURE] });
  assert.deepEqual(decode([held(kid, 'E_LIFECYCLE_BUSY', MESSY), held(kid2, 'E_INSTANCE_RETIRING', MESSY)]), [
    { instance: 'kid', home: kid.home, ok: false, code: 'E_LIFECYCLE_BUSY', stillRunning: null, detail: MESSY_LINE },
    { instance: 'kid-2', home: kid2.home, ok: false, code: 'E_INSTANCE_RETIRING', stillRunning: null }]);
  // Every other failed row drops its message, as before.
  for (const code of ['E_SESSION_STOP_FAILED', 'E_INSTANCE_RETIRING', 'E_SESSION_UNAVAILABLE']) assert.equal(Object.hasOwn(decode([held(kid, code, 'UNSHOWN'), fine(kid2)])[0], 'detail'), false, code);
  // Withheld whole when it looks like a credential; absent when the kernel sent nothing to show.
  assert.equal(decode([held(kid, 'E_LIFECYCLE_BUSY', 'see https://user:pw@host/x'), fine(kid2)])[0].detail, '[Detail withheld]');
  for (const none of [undefined, null, '', ' \n\t ', 7]) assert.equal(Object.hasOwn(decode([held(kid, 'E_LIFECYCLE_BUSY', none), fine(kid2)])[0], 'detail'), false, String(none));
  // A stop's results are decoded by the same rule.
  const stop = stopOf(kid), receipt = lifecycleReceipt(stopAnswer({ revision: stop.planRevision, key: 'k' }, stop, [held(kid, 'E_LIFECYCLE_BUSY', MESSY), fine(instance)]), stop, 'k');
  assert.equal(receipt.results[0].detail, MESSY_LINE); assert.deepEqual(publicLifecycleReceipt(structuredClone(receipt), stop), receipt);
  // The re-read: a detail that is already a display line is kept, under that code only; a kernel's `message` is never read there.
  const decoded = decode([held(kid, 'E_LIFECYCLE_BUSY', MESSY), fine(kid2)]);
  assert.deepEqual(decodedStoppedTargets(structuredClone(decoded), retire.facts.children), decoded);
  for (const detail of ['UNSHOWN two\nlines', 'UNSHOWN two  spaces', `UNSHOWN a${String.fromCodePoint(0x202E)}b`, 'UNSHOWN token=abc123', 7, null])
    assert.equal(Object.hasOwn(decodedStoppedTargets([{ ...decoded[0], detail }, decoded[1]], retire.facts.children)[0], 'detail'), false, JSON.stringify(detail));
  const { detail: _detail, ...bare } = decoded[0];
  assert.equal(Object.hasOwn(decodedStoppedTargets([{ ...bare, message: 'UNSHOWN line' }, decoded[1]], retire.facts.children)[0], 'detail'), false);
  assert.equal(Object.hasOwn(decodedStoppedTargets([{ ...bare, code: 'E_INSTANCE_RETIRING', detail: 'UNSHOWN line' }, decoded[1]], retire.facts.children)[0], 'detail'), false);
});

test("a refused retire's child list: a child being retired and a child whose home could not be locked read \"Not stopped\", with why; the header is today's", async t => {
  // With and without the feature names: the two lines are keyed on the row's code alone.
  for (const ctx of [() => localContext(), () => localContext([FEATURE, 'lifecycle-claim-stop']), () => routedContext({ probe: { ok: true, features: null } })]) {
    const plan = retireOf(kid, kid2), u = mount(t, { ctx: ctx(), operation: 'retire', plan,
      answer: () => childrenRefused(plan, [held(kid, 'E_INSTANCE_RETIRING'), held(kid2, 'E_LIFECYCLE_BUSY', MESSY)]) });
    await u.confirm();
    assert.equal(u.status(), CHILDREN_RUNNING); assert.equal(u.title(), "dev-1 wasn't retired");
    const rows = u.rows();
    assert.deepEqual(rows.map(r => r.line), [`kid: ${LINE.retiring}`, `kid-2: ${LINE.locked}`]);
    assert.equal(rows[0].quote, null, 'only the locked row quotes the kernel');
    // The kernel's sentence for that row: one display line, alone in its <bdi>, under the line.
    assertIsolatedDetail(rows[1].quote, { before: '', detail: MESSY_LINE });
    assert.equal(u.doc.body.textContent.split(MESSY_LINE).length, 2, 'said once');
    assert.doesNotMatch(u.doc.body.textContent, /Didn't stop/);
    assertNotDone(u, 'held children');
  }
});

test('a locked row whose sentence is withheld says so; one with no sentence has no quote', async t => {
  for (const [message, quote] of [['the claim: token=abc123', '[Detail withheld]'], [undefined, null]]) {
    const plan = retireOf(kid), u = mount(t, { ctx: localContext(), operation: 'retire', plan, answer: () => childrenRefused(plan, [held(kid, 'E_LIFECYCLE_BUSY', message)]) });
    await u.confirm();
    const [row] = u.rows();
    assert.equal(row.line, `kid: ${LINE.locked}`); assert.equal(row.quote?.textContent ?? null, quote);
    assert.doesNotMatch(u.doc.body.textContent, /abc123/);
  }
});

test("the same two lines in a stop's result: one function words both lists, and the sentence above stays today's", async t => {
  const plan = stopOf(kid, kid2), u = mount(t, { ctx: localContext(), operation: 'stop', plan,
    answer: args => envelope(stopAnswer(args, plan, [held(kid, 'E_INSTANCE_RETIRING'), held(kid2, 'E_LIFECYCLE_BUSY', MESSY), fine(instance)])) });
  await u.confirm();
  assert.equal(u.status(), NOT_EVERY.status); assert.equal(u.title(), NOT_EVERY.title);
  const rows = u.rows();
  assert.deepEqual(rows.map(r => r.line), [`kid: ${LINE.retiring}`, `kid-2: ${LINE.locked}`, `dev-1: ${LINE.stopped}`]);
  assertIsolatedDetail(rows[1].quote, { before: '', detail: MESSY_LINE });
  assertNotDone(u, 'a stop with held targets');
});
