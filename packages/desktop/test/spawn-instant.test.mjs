// Spec C: Cmd-Enter spawns instantly. The dialog hands a confirmed press to the background-spawn
// store (renderer/spawn-jobs.mjs) and closes; the store runs prepare → apply on the real broker,
// owns the pending roster row and the outcome notice, and keeps the draft for Reopen spawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSpawn, settle, deferred, kernel, ROOT, DEPLOYMENT, catalogAgents, kernelPreviewName } from './helpers/spawn-dialog-host.mjs';
import { cli as CLI } from './helpers/spawn-preview-fixture.mjs';
import { createSpawnPreviewBoundary } from '../server/spawn-preview.mjs';
import { createSpawnApplyBoundary } from '../server/spawn-apply.mjs';
import { creation } from './helpers/spawn-apply-fixture.mjs';
import { createSpawnJobs, pendingPlacement, DRIFT_TEXT } from '../renderer/spawn-jobs.mjs';

const created = (name = 'preview-worktree-purpose') => kernel(name).result;
const receipt = (preview = created(), changes = {}) => ({ started: true, envelope: { schemaVersion: 1, ok: true, result: creation(preview, changes) } });
const failure = (code, started = false) => ({ started, envelope: { schemaVersion: 1, ok: false, error: { code, message: `kernel says ${code}` } } });
const realRow = (preview = created(), extra = {}) => {
  const d = preview.decision;
  return { instance: d.instance, agent: 'release-manager', agentsRoot: ROOT, home: d.home, running: true, tmux: { session: 'oats', window: d.instance }, ...extra };
};
const reopenButton = notice => notice.options.buttons?.find(b => b.label === 'Reopen spawn');

test('a valid press with a settled preview closes the dialog at once; the pending row carries the kernel’s name; the real row replaces it', async t => {
  const u = await mountSpawn(t, { jobs: true, apply: () => receipt() });
  await u.open(); await u.type('.fpurpose', 'api-v2'); await u.type('.ftask', 'Cut 3.2');
  u.q('.fspawn').click();
  assert.equal(u.dialog(), null, 'closed in the same task as the press (no await before the handoff)');
  const [row] = u.jobs.rows('northwind');
  assert.equal(row.instance, created().decision.instance); assert.equal(row.home, created().decision.home);
  assert.equal(row.pending, 'spawning'); assert.equal(row.agent, 'release-manager'); assert.equal(row.agentsRoot, ROOT);
  await settle(20);
  assert.deepEqual(u.spawns().map(b => b.action), ['prepare', 'apply']);
  assert.equal(u.spawns()[0].task, 'Cut 3.2');
  assert.equal(u.jobs.rows('northwind').length, 1, 'created but not yet in the roster: still “Spawning…”');
  u.jobs.observe('northwind', [realRow()]);
  assert.equal(u.jobs.rows('northwind').length, 0, 'the roster reports it: the real row replaces the pending one');
  assert.equal(u.notified.length, 1, '“<name> spawned” with Open'); assert.equal(u.notified[0].row.instance, created().decision.instance);
  assert.deepEqual(u.opens, [], 'no terminal is auto-opened'); assert.equal(u.jobs.size(), 0);
});

test('Cmd-Enter hands off the same way; two presses in one task start one spawn', async t => {
  const u = await mountSpawn(t, { jobs: true, apply: () => receipt() });
  await u.open(); await u.type('.fpurpose', 'api-v2');
  const button = u.q('.fspawn'), ta = u.q('.ftask'); ta.focus();
  ta.dispatchEvent(new u.dom.window.KeyboardEvent('keydown', { key: 'Enter', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true }));
  button.click(); button.click();
  assert.equal(u.dialog(), null); assert.equal(u.jobs.size(), 1);
  await settle(20);
  assert.deepEqual(u.spawns().map(b => b.action), ['prepare', 'apply'], 'one prepare, one apply');
});

test('a press that waits for its preview (“Checking…”) closes as soon as the preview settles, not after apply', async t => {
  let gate = null;
  const applied = deferred();
  const u = await mountSpawn(t, { jobs: true, previewGate: () => gate?.promise, spawnGate: body => body.action === 'apply' ? applied.promise : undefined, apply: () => receipt() });
  await u.open(); await u.type('.fpurpose', 'api');
  gate = deferred();
  await u.type('.fpurpose', 'api-v2');
  u.q('.fspawn').click(); await settle();
  assert.ok(u.dialog(), 'held while the preview for these values is still reading'); assert.equal(u.jobs.size(), 0);
  gate.resolve(); await settle(20);
  assert.equal(u.dialog(), null, 'closed once the preview settled'); assert.equal(u.jobs.size(), 1);
  assert.deepEqual(u.spawns().map(b => b.action), ['prepare', 'apply'], 'apply still in flight after the close');
  applied.resolve(); await settle(20);
});

test('the dialog stays open for a refusal: nothing is handed off', async t => {
  const u = await mountSpawn(t, { jobs: true, previewName: () => 'preview-soul-unknown' });
  await u.open(); await u.type('.fpurpose', 'api-v2');
  u.q('.fspawn').click(); await settle(10);
  assert.ok(u.dialog()); assert.equal(u.jobs.size(), 0); assert.deepEqual(u.spawns(), []);
});

test('a refused apply removes the row, says why with Reopen spawn, and Reopen restores the whole draft', async t => {
  const u = await mountSpawn(t, { jobs: true, apply: () => failure('E_BRANCH_EXISTS') });
  await u.open(); await u.type('.fpurpose', 'api-v2'); await u.type('.ftask', 'Cut 3.2');
  await u.change('.fruntime', 'claude'); await u.type('.fmodel', 'opus-custom');
  u.q('.fspawn').click(); await settle(20);
  assert.equal(u.dialog(), null);
  assert.deepEqual(u.jobs.rows('northwind'), [], 'the pending row is gone');
  assert.equal(u.notices.length, 1);
  const [notice] = u.notices;
  assert.equal(notice.options.sticky, true); assert.equal(notice.options.group, 'spawn-failed');
  assert.doesNotMatch(notice.message, /changed since you last looked/, 'E_BRANCH_EXISTS keeps its own words');
  assert.doesNotMatch(notice.message, /E_[A-Z]/);
  assert.equal(reopenButton(notice).ariaLabel, `Reopen spawn for ${created().decision.instance}`);
  await reopenButton(notice).activate(); await settle(20);
  assert.equal(notice.shown, false, 'Reopen dismisses the notice'); assert.equal(u.jobs.size(), 0, 'the draft moved back into the dialog');
  assert.ok(u.dialog(), 'the dialog is open again for that soul');
  assert.equal(u.q('.fpurpose').value, 'api-v2'); assert.equal(u.q('.ftask').value, 'Cut 3.2');
  assert.equal(u.q('.fruntime').value, 'claude'); assert.equal(u.q('.fmodel').value, 'opus-custom');
});

test('only a kernel decision drift (E_DECISION_STALE) reads “These values changed…”; name and placement conflicts keep their own words', async t => {
  for (const [code, drift] of [['E_DECISION_STALE', true], ['E_INSTANCE_NAME_TAKEN', false], ['E_PLACEMENT_TAKEN', false], ['E_IDEMPOTENCY_CONFLICT', false]]) {
    await t.test(code, async t => {
      const u = await mountSpawn(t, { jobs: true, apply: () => failure(code, true) });
      await u.open(); await u.type('.fpurpose', 'api-v2');
      u.q('.fspawn').click(); await settle(20);
      assert.equal(u.notices.length, 1);
      if (drift) assert.equal(u.notices[0].message, DRIFT_TEXT);
      else assert.notEqual(u.notices[0].message, DRIFT_TEXT);
      assert.ok(reopenButton(u.notices[0]));
    });
  }
});

test('a decision that moved between the press and prepare is never applied: drift wording, Reopen', async t => {
  let drift = false;
  const u = await mountSpawn(t, { jobs: true, previewName: () => drift ? 'preview-after-apply' : 'preview-worktree-purpose' });
  await u.open(); await u.type('.fpurpose', 'api-v2');
  drift = true; u.q('.fspawn').click(); await settle(20);
  assert.deepEqual(u.spawns().map(b => b.action), ['prepare']); assert.equal(u.applied.length, 0);
  assert.equal(u.notices[0].message, DRIFT_TEXT);
});

test('an unknown outcome keeps the row (“Outcome unknown”) and says so once; Check result asks on the same intent', async t => {
  let n = 0;
  const u = await mountSpawn(t, { jobs: true, apply: () => ++n === 1 ? failure('E_CLI_TIMEOUT', true) : receipt() });
  await u.open(); await u.type('.fpurpose', 'api-v2');
  u.q('.fspawn').click(); await settle(20);
  const [row] = u.jobs.rows('northwind');
  assert.equal(row.pending, 'unknown'); assert.equal(u.notices.length, 1);
  assert.match(u.notices[0].message, /couldn’t confirm whether the instance was created/);
  u.jobs.observe('northwind', []); u.jobs.observe('northwind', []);
  assert.equal(u.notices.length, 1, 'said once'); assert.equal(u.jobs.rows('northwind').length, 1, 'never silently disappears');
  await u.jobs.check(row.id); await settle(10);
  assert.deepEqual(u.spawns().map(b => b.action), ['prepare', 'apply', 'result', 'apply']);
  assert.equal(u.applied[0].key, u.applied[1].key, 'the same idempotency key');
  u.jobs.observe('northwind', [realRow()]);
  assert.equal(u.jobs.rows('northwind').length, 0); assert.equal(u.notified.length, 1);
});

test('the draft survives while the spawn runs, and a new spawn of the same soul reads a fresh preview', async t => {
  const hold = deferred();
  const u = await mountSpawn(t, { jobs: true, spawnGate: body => body.action === 'apply' ? hold.promise : undefined, apply: () => receipt() });
  await u.open(); await u.type('.fpurpose', 'api-v2');
  u.q('.fspawn').click(); await settle(10);
  const before = u.previews().length;
  await u.open(); await settle(10);
  assert.ok(u.dialog(), 'a new spawn of the same soul may open');
  assert.equal(u.q('.fpurpose').value, '', 'a fresh dialog, not the in-flight draft');
  assert.ok(u.previews().length > before, 'its name comes from a fresh preview');
  hold.resolve(); await settle(20);
  assert.equal(u.jobs.size(), 1);
});

// ── the store alone ────────────────────────────────────────────────────────

const decision = { instance: 'dev-x', home: '/d/agents/dev/instances/dev-x', revision: 'r1' };
function store(overrides = {}) {
  const posted = [], notes = [], spawned = [];
  const s = createSpawnJobs({
    post: async (_ws, body) => { posted.push(body); throw Object.assign(Error('offline'), { code: 'E_BACKEND_UNREACHABLE' }); },
    notify: (message, options = {}) => { const n = { message, options, shown: true }; notes.push(n); return { dismiss() { n.shown = false; }, get shown() { return n.shown; } }; },
    notifySpawned: row => spawned.push(row), currentWorkspace: () => 'A', ...overrides });
  return { s, posted, notes, spawned };
}
const spec = (extra = {}) => ({ token: {}, workspace: 'A', soul: { name: 'dev', agentsRoot: '/d/agents' }, selector: { soul: 'dev', agentsRoot: '/d/agents' },
  input: { action: 'prepare', selector: { soul: 'dev', agentsRoot: '/d/agents' }, choices: {} }, decision, draft: { purpose: 'x', task: 'do' }, ...extra });

test('store: one press token starts one spawn; a new press of the same soul is its own job', async () => {
  const { s, posted } = store();
  const press = spec();
  const first = s.submit(press);
  assert.ok(first); assert.equal(s.submit(press), null, 'the same press never starts a second spawn');
  assert.ok(s.submit(spec()), 'a new press is allowed');
  await settle(4);
  assert.equal(posted.filter(b => b.action === 'prepare').length, 2);
});

test('store: a failure before submit is a refusal whose draft Reopen restores; dismissing the notice forgets it', async () => {
  const reopened = [];
  const { s, notes } = store({ reopen: job => reopened.push(job) });
  s.submit(spec()); await settle(4);
  assert.equal(s.rows('A').length, 0); assert.equal(s.size(), 1, 'the store keeps the draft until Reopen or dismissal');
  assert.match(notes[0].message, /Nothing was created/);
  notes[0].options.onDismiss(); assert.equal(s.size(), 0);
  s.submit(spec()); await settle(4);
  await notes[1].options.buttons[0].activate();
  assert.equal(reopened.length, 1); assert.deepEqual(reopened[0].draft, { purpose: 'x', task: 'do' });
});

test('store: an outcome is held while another workspace is on screen and posted on return; a cleared failure is posted again', async () => {
  let ws = 'B';
  const { s, notes } = store({ currentWorkspace: () => ws });
  s.submit(spec()); await settle(4);
  assert.equal(notes.length, 0, 'held'); assert.equal(s.rows('A').length, 0);
  ws = 'A'; s.observe('A', []);
  assert.equal(notes.length, 1, 'posted on return');
  s.observe('A', []); assert.equal(notes.length, 1, 'posted once while shown');
  notes[0].shown = false; // the center cleared it (scope change)
  s.observe('A', []); assert.equal(notes.length, 2, 're-posted after a clear');
});

// The store on the real broker (the kernel captures), for outcomes the dialog cannot reach by typing.
function brokerStore({ apply, wake = null, ...overrides } = {}) {
  const context = () => ({ workspace: { id: 'northwind', scope: DEPLOYMENT }, cli: structuredClone(CLI), agents: catalogAgents(), instances: [] });
  const read = createSpawnPreviewBoundary({ invoke: async (_c, { target, choices }) => kernel(kernelPreviewName(target.selector.soul, choices)) });
  let ids = 0;
  const broker = createSpawnApplyBoundary({ mint: () => (++ids).toString(16).padStart(64, '0'), read, invoke: async args => apply(args) });
  const selector = { soul: 'release-manager', agentsRoot: ROOT };
  const t = store({ post: async (_ws, body) => broker(body, context), currentWorkspace: () => 'northwind', ...overrides });
  const id = t.s.submit({ token: {}, workspace: 'northwind', soul: { name: 'release-manager', agentsRoot: ROOT }, selector,
    input: { action: 'prepare', selector, choices: { purpose: 'api-v2', model: { kind: 'inherit' }, relation: { kind: 'unrelated' } }, task: '', ...(wake ? { wake } : {}) },
    decision: created().decision, draft: { purpose: 'api-v2' } });
  return { ...t, id };
}

test('store: complete but not seen in the roster in time says so truthfully, and opens nothing', async () => {
  let clock = 0;
  const { s, notes, spawned } = brokerStore({ apply: () => receipt(), now: () => clock, visibleWithinMs: 1000 });
  await settle(10);
  assert.equal(s.settling('northwind'), true); assert.equal(s.rows('northwind')[0].pending, 'spawning');
  s.observe('northwind', [realRow(created(), { running: true, tmux: null })]);
  assert.equal(notes.length + spawned.length, 0, 'present without a session is not “spawned”');
  clock = 1000; s.observe('northwind', []);
  assert.match(notes[0].message, /not yet visible as a running session/); assert.equal(spawned.length, 0);
  assert.equal(s.rows('northwind').length, 0); assert.equal(s.settling('northwind'), false);
});

test('store: partial (the wake was not saved) posts the kernel’s words with View schedules', async () => {
  const viewed = [];
  const { s, notes } = brokerStore({ viewSchedules: () => viewed.push(true), wake: { cron: '0 * * * *', tz: 'UTC', message: 'wake', enabled: false },
    apply: () => receipt(created(), { wake: { requested: true, saved: false, error: { code: 'E_SCHEDULE', message: 'secret provider text' } } }) });
  await settle(10);
  assert.equal(notes.length, 1); assert.doesNotMatch(notes[0].message, /secret provider text/);
  const view = notes[0].options.buttons.find(b => b.label === 'View schedules');
  await view.activate(); assert.equal(viewed.length, 1);
  assert.equal(s.rows('northwind')[0].pending, 'spawning', 'the row waits for the roster');
  s.observe('northwind', [realRow()]); assert.equal(s.size(), 0);
});

test('store: incomplete keeps the existing wording (open it from the instance list)', async () => {
  const d = created().decision;
  const { s, notes } = brokerStore({ apply: () => ({ started: true, envelope: { schemaVersion: 1, ok: false,
    error: { code: 'E_SPAWN_INCOMPLETE', message: 'x', details: { instance: d.instance, home: d.home, launched: false } } } }) });
  await settle(10);
  assert.equal(notes[0].message, `${d.instance} was created but didn’t finish starting. Open it from the instance list instead of spawning again.`);
  assert.equal(s.rows('northwind').length, 1);
});

test('pendingPlacement: the row sits where the roster will place the real one', () => {
  const anchor = { instance: 'lead', agentsRoot: '/r' };
  assert.deepEqual(pendingPlacement({ kind: 'unrelated' }), {});
  assert.deepEqual(pendingPlacement({ kind: 'child', anchor }), { parentInstance: 'lead' });
  assert.deepEqual(pendingPlacement({ kind: 'sibling', anchor }, [{ instance: 'lead', agentsRoot: '/r', parentInstance: 'boss' }]), { parentInstance: 'boss' });
  assert.deepEqual(pendingPlacement({ kind: 'sibling', anchor }, [{ instance: 'lead', agentsRoot: '/r' }]), { siblingInstance: 'lead' });
  assert.deepEqual(pendingPlacement({ kind: 'parent', anchor }), { siblingInstance: 'lead' });
});
