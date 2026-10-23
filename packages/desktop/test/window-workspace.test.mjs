// One Desktop window per workspace (#481), the renderer side: a window's workspace comes from its
// hash; the shared localStorage selection is only the default of a window opened with none, and only
// when no other window has it. A switch is bound by main first: it rewrites the window's own hash with
// history.replaceState, or, when another window has the workspace, that window is focused and this one
// does not change; a take-over moves it here instead, and the window that had it leaves it for the newest
// workspace of its session history it can still show, else the switcher. A window with no workspace
// chooses one (the switcher) and reads nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceHash } from '../renderer/window-binding.mjs';

const WS_KEY = 'oats.desktop.ws';
const A = 'ws:aaaaaaaaaaaaaaaaaaaa', B = 'ws:bbbbbbbbbbbbbbbbbbbb', C = '/d/c', D = 'ws:dddddddddddddddddddd';
const CHOICES = [{ id: A, name: 'a' }, { id: B, name: 'b' }];
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
let loads = 0;

/** A fresh common.mjs for one window: its hash, the shared storage and main's claim answers. */
async function windowWith({ hash = '', stored = null, claim = async () => ({ ok: true }), choices = null, bridge = true } = {}) {
  const store = new Map(stored === null ? [] : [[WS_KEY, stored]]);
  const replaced = [], claims = [];
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.location = { hash, pathname: '/app/renderer/index.html', search: '' };
  globalThis.history = { state: null, replaceState: (_state, _title, url) => { replaced.push(url); globalThis.location.hash = url.startsWith('#') ? url : ''; } };
  globalThis.oatsDesktop = bridge ? { windowClaimWorkspace: (id, options) => { claims.push([id, options]); return claim(id, options); },
    ...(choices ? { windowChoices: () => choices() } : {}) } : {};
  const common = await import(`../renderer/views/common.mjs?window=${++loads}`);
  return { common, store, replaced, claims };
}

test('the workspace comes from the hash, not the shared selection', async () => {
  const w = await windowWith({ hash: workspaceHash(A), stored: B });
  assert.equal(w.common.currentWorkspace(), A);
  assert.equal(await w.common.startWindow(), 'bound');
  assert.deepEqual(w.claims, [[A, { focus: false }]], 'a bound window confirms its binding, focusing nothing');
  assert.deepEqual(w.replaced, [workspaceHash(A)]);
});

// #1488: a page that loaded or reloaded while another window took its workspace over never heard the ask
// to release it; main has moved the binding. Its hash still names the workspace, and it must not show it.
test('a window whose hash names a workspace main no longer binds to it chooses at start, and reads nothing', async () => {
  const w = await windowWith({ hash: workspaceHash(A), stored: A, claim: async () => ({ ok: false, code: 'open-elsewhere', workspaces: CHOICES }) });
  const states = [], seen = []; w.common.onWindowState((state) => states.push(state)); w.common.onWorkspaceChange((ws) => seen.push(ws));
  const gen = w.common.workspaceGeneration();
  assert.equal(await w.common.startWindow(), 'choosing');
  assert.equal(w.common.currentWorkspace(), '');
  assert.deepEqual(w.common.choosingWorkspaces(), CHOICES);
  assert.deepEqual(w.replaced, ['/app/renderer/index.html'], 'the hash is cleared');
  assert.ok(w.common.workspaceGeneration() > gen, 'nothing in flight may paint the workspace');
  assert.deepEqual(states, ['choosing']); assert.deepEqual(seen, ['']);
  assert.equal(w.store.get(WS_KEY), A, 'the shared default is left as it is');
});

test('a hash-bound window main refuses for another reason (or whose claim throws) stays bound, as before', async () => {
  for (const claim of [async () => ({ ok: false, code: 'bad-workspace' }), async () => ({ ok: false, code: 'unknown-window' }), async () => { throw new Error('ipc'); }]) {
    const w = await windowWith({ hash: workspaceHash(A), claim });
    assert.equal(await w.common.startWindow(), 'bound');
    assert.equal(w.common.currentWorkspace(), A);
    assert.deepEqual(w.replaced, []);
  }
});

test('a window with no hash takes the shared default when main says no other window has it, and binds its hash', async () => {
  const w = await windowWith({ stored: B });
  assert.equal(w.common.currentWorkspace(), B);
  assert.equal(await w.common.startWindow(), 'bound');
  assert.deepEqual(w.claims, [[B, { focus: false, initial: true }]]);
  assert.deepEqual(w.replaced, [workspaceHash(B)]);
});

test('a New Window (or a default open elsewhere) chooses: no workspace, the served choices, nothing read', async () => {
  for (const code of ['choose', 'open-elsewhere']) {
    const w = await windowWith({ stored: B, claim: async () => ({ ok: false, code, workspaces: CHOICES }) });
    const states = []; w.common.onWindowState((state) => states.push(state));
    assert.equal(await w.common.startWindow(), 'choosing', code);
    assert.equal(w.common.currentWorkspace(), '', 'no workspace: no read can name one');
    assert.equal(w.common.windowState(), 'choosing');
    assert.deepEqual(w.common.choosingWorkspaces(), CHOICES);
    assert.deepEqual(states, ['choosing']);
    assert.equal(w.store.get(WS_KEY), B, 'the shared default is left as it is');
  }
});

test('with no default (a first launch), the window adopts the served workspace and binds it then', async () => {
  const w = await windowWith({ claim: async (id) => (id ? { ok: true } : { ok: false, code: 'bad-workspace' }) });
  assert.equal(await w.common.startWindow(), 'adopting');
  w.common.adoptWorkspace(A);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(w.claims.at(-1), [A, { focus: false, initial: true }]);
  assert.deepEqual(w.replaced, [workspaceHash(A)]); assert.equal(w.common.windowState(), 'bound');
});

test('an in-place switch is bound by main first, then rewrites the window\'s hash', async () => {
  const w = await windowWith({ hash: workspaceHash(A) });
  const changes = []; w.common.onWorkspaceChange((id) => changes.push(id));
  assert.deepEqual(await w.common.switchWorkspace(B), { ok: true });
  assert.deepEqual(w.claims, [[B, { focus: true }]]);
  assert.equal(w.common.currentWorkspace(), B); assert.deepEqual(changes, [B]);
  assert.deepEqual(w.replaced, [workspaceHash(B)], 'history.replaceState, so a reload keeps it');
  assert.equal(w.store.get(WS_KEY), B, 'the shared default follows the last choice, as before');
});

test('selecting a workspace open elsewhere asks main to focus it and leaves this window unchanged', async () => {
  const w = await windowWith({ hash: workspaceHash(A), claim: async () => ({ ok: false, code: 'focused-other' }) });
  const changes = []; w.common.onWorkspaceChange((id) => changes.push(id));
  const generation = w.common.workspaceGeneration();
  assert.deepEqual(await w.common.switchWorkspace(B), { ok: false, code: 'focused-other' });
  assert.equal(w.common.currentWorkspace(), A); assert.deepEqual(changes, []); assert.deepEqual(w.replaced, []);
  assert.equal(w.common.workspaceGeneration(), generation, 'nothing in flight is invalidated');
});

test('switches run one at a time; a queued switch superseded before dispatch is never sent', async () => {
  const gates = [];
  const w = await windowWith({ hash: workspaceHash(A), claim: () => { const g = deferred(); gates.push(g); return g.promise; } });
  const first = w.common.switchWorkspace(B);
  await new Promise((r) => setImmediate(r)); // dispatched to main
  const skipped = w.common.switchWorkspace(C), last = w.common.switchWorkspace(A);
  await new Promise((r) => setImmediate(r));
  assert.equal(gates.length, 1, 'one claim in flight');
  gates[0].resolve({ ok: true });
  assert.deepEqual(await first, { ok: true });
  assert.equal(w.common.currentWorkspace(), B, 'main bound this window to B: the window follows it');
  assert.deepEqual(await skipped, { ok: false, code: 'superseded' });
  await new Promise((r) => setImmediate(r));
  gates[1].resolve({ ok: true });
  assert.deepEqual(await last, { ok: true });
  assert.deepEqual(w.claims.map(([id]) => id), [B, A], 'C was never claimed');
  assert.equal(w.common.currentWorkspace(), A);
});

test('a choosing window binds by a switch and leaves the choosing state', async () => {
  const w = await windowWith({ stored: B, claim: async (id, o) => (o?.initial ? { ok: false, code: 'choose', workspaces: CHOICES } : { ok: true }) });
  await w.common.startWindow();
  const states = []; w.common.onWindowState((state) => states.push(state));
  assert.deepEqual(await w.common.switchWorkspace(A), { ok: true });
  assert.equal(w.common.windowState(), 'bound'); assert.deepEqual(states, ['bound']);
  assert.equal(w.common.currentWorkspace(), A);
});

test('a view that moved under a bound window: adopted through main without focusing; open elsewhere, the window chooses', async () => {
  const ok = await windowWith({ hash: workspaceHash(C) });
  ok.common.adoptWorkspace(A);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ok.claims, [[A, { focus: false }]]); assert.deepEqual(ok.replaced, [workspaceHash(A)]);

  const held = await windowWith({ hash: workspaceHash(C), claim: async (id) => (id === null ? { ok: true } : { ok: false, code: 'open-elsewhere', workspaces: CHOICES }) });
  held.common.adoptWorkspace(A);
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.deepEqual(held.claims, [[A, { focus: false }], [null, undefined]], 'main unbinds the window');
  assert.equal(held.common.windowState(), 'choosing'); assert.equal(held.common.currentWorkspace(), '');
  assert.equal(held.replaced.at(-1), '/app/renderer/index.html', 'the hash is cleared');
});

test('without the window bridge (the browser harness) a switch is today\'s plain selection', async () => {
  const w = await windowWith({ hash: '', stored: A, bridge: false });
  assert.equal(await w.common.startWindow(), 'bound');
  assert.deepEqual(await w.common.switchWorkspace(B), { ok: true });
  assert.equal(w.common.currentWorkspace(), B);
});

test('a shared default the server does not serve leaves the window adopting (today\'s rewrite and adoption)', async () => {
  const w = await windowWith({ stored: 'ws:gonegonegonegonegone', claim: async () => ({ ok: false, code: 'not-served' }) });
  assert.equal(await w.common.startWindow(), 'adopting');
  assert.deepEqual(w.replaced, [], 'no hash for a workspace that is not served');
  w.common.adoptWorkspace(A);
  await new Promise((r) => setImmediate(r));
  assert.equal(w.common.currentWorkspace(), A);
});

test('a switch, a start or an adoption binds the workspace main bound (a deployment id\'s view), so hash and registry agree', async () => {
  const resolve = async (id) => ({ ok: true, workspace: id === C ? B : id });
  const w = await windowWith({ hash: workspaceHash(A), claim: resolve });
  assert.deepEqual(await w.common.switchWorkspace(C), { ok: true });
  assert.equal(w.common.currentWorkspace(), B); assert.deepEqual(w.replaced, [workspaceHash(B)]);
  const start = await windowWith({ stored: C, claim: resolve });
  assert.equal(await start.common.startWindow(), 'bound');
  assert.equal(start.common.currentWorkspace(), B); assert.deepEqual(start.replaced, [workspaceHash(B)]);
  const adopt = await windowWith({ hash: workspaceHash(A), claim: resolve });
  adopt.common.adoptWorkspace(C);
  await new Promise((r) => setImmediate(r));
  assert.equal(adopt.common.currentWorkspace(), B); assert.deepEqual(adopt.replaced, [workspaceHash(B)]);
});

test('entering the choosing state: the workspace listeners already see it, so a view refreshing then sends nothing', async () => {
  const w = await windowWith({ hash: workspaceHash(C), claim: async (id) => (id === null ? { ok: true } : { ok: false, code: 'open-elsewhere', workspaces: CHOICES }) });
  const seen = []; w.common.onWorkspaceChange(() => seen.push([w.common.windowState(), w.common.currentWorkspace()]));
  w.common.adoptWorkspace(A);
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.deepEqual(seen, [['choosing', '']]);
});

test('a choosing window refreshes its choices from main as they are served; a bound window asks nothing (#521)', async () => {
  const REMOTE = [...CHOICES, { id: 'ws:cccccccccccccccccccc', name: 'c' }];
  let asked = 0;
  const w = await windowWith({ stored: B, claim: async () => ({ ok: false, code: 'choose', workspaces: [] }),
    choices: async () => { asked++; return { ok: true, workspaces: REMOTE }; } });
  assert.equal(await w.common.startWindow(), 'choosing');
  assert.deepEqual(w.common.choosingWorkspaces(), []);
  assert.deepEqual(await w.common.refreshChoices(), REMOTE);
  assert.deepEqual(w.common.choosingWorkspaces(), REMOTE, 'the remote views that arrived later are now choices');
  const bound = await windowWith({ hash: workspaceHash(A), choices: async () => { asked++; return { ok: true, workspaces: REMOTE }; } });
  const before = asked;
  assert.equal(await bound.common.refreshChoices(), null);
  assert.equal(asked, before, 'a bound window reads its own workspace instead');
});

test('a refresh answered after the window bound, or after a newer refresh, changes nothing; a refusal keeps the choices (#521)', async () => {
  const late = deferred(), newer = deferred();
  let n = 0;
  const w = await windowWith({ stored: B, claim: async (id, options) => (options?.initial ? { ok: false, code: 'choose', workspaces: CHOICES } : { ok: true }),
    choices: () => (++n === 1 ? late.promise : newer.promise) });
  await w.common.startWindow();
  const first = w.common.refreshChoices(), second = w.common.refreshChoices();
  newer.resolve({ ok: true, workspaces: [CHOICES[0]] });
  assert.deepEqual(await second, [CHOICES[0]]);
  late.resolve({ ok: true, workspaces: [] });
  assert.equal(await first, null, 'superseded by the newer refresh');
  assert.deepEqual(w.common.choosingWorkspaces(), [CHOICES[0]]);
  const binding = deferred();
  const v = await windowWith({ stored: B, claim: async (id, options) => (options?.initial ? { ok: false, code: 'choose', workspaces: CHOICES } : { ok: true }),
    choices: () => binding.promise });
  await v.common.startWindow();
  const pending = v.common.refreshChoices();
  await v.common.switchWorkspace(A);
  binding.resolve({ ok: true, workspaces: [] });
  assert.equal(await pending, null, 'bound meanwhile: nothing to choose');
  const refused = await windowWith({ stored: B, claim: async () => ({ ok: false, code: 'choose', workspaces: CHOICES }), choices: async () => ({ ok: false, code: 'forbidden' }) });
  await refused.common.startWindow();
  assert.equal(await refused.common.refreshChoices(), null);
  assert.deepEqual(refused.common.choosingWorkspaces(), CHOICES);
  const thrown = await windowWith({ stored: B, claim: async () => ({ ok: false, code: 'choose', workspaces: CHOICES }), choices: async () => { throw new Error('gone'); } });
  await thrown.common.startWindow();
  assert.equal(await thrown.common.refreshChoices(), null, 'a rejection is a refusal, never an error out of the poll');
});

/* ── the take-over (a pick from the list of workspaces) ── */

test('a take-over switch asks main to take the workspace over, with no focus option', async () => {
  const w = await windowWith({ hash: workspaceHash(A) });
  assert.deepEqual(await w.common.switchWorkspace(B, { takeOver: true }), { ok: true });
  assert.deepEqual(w.claims, [[B, { takeOver: true }]], 'never { focus }: nothing is focused');
  assert.equal(w.common.currentWorkspace(), B); assert.deepEqual(w.replaced, [workspaceHash(B)]);
  assert.deepEqual(await w.common.switchWorkspace(A), { ok: true });
  assert.deepEqual(w.claims.at(-1), [A, { focus: true }], 'a plain switch is unchanged');
});

/** A window that has shown B, then C, then A (its session history, the newest last), on A now; main
 * answers its claims with `claim` from then on. */
async function shownBCA(claim = async () => ({ ok: true })) {
  let answer = async () => ({ ok: true });
  const w = await windowWith({ hash: workspaceHash(D), claim: (id, options) => answer(id, options) });
  for (const id of [B, C, A]) assert.deepEqual(await w.common.switchWorkspace(id), { ok: true });
  w.claims.length = 0; answer = claim;
  return w;
}

test('a window whose workspace is taken over shows the newest workspace of its history that main serves', async () => {
  const w = await shownBCA();
  const changes = []; w.common.onWorkspaceChange((id) => changes.push(id));
  // A is taken; C is not served any more (it is not among main's choices): B, the newest left.
  await w.common.leaveTakenWorkspace(A, [{ id: A }, { id: B }]);
  assert.deepEqual(w.claims, [[B, { focus: false }]], 'claimed without focusing anything');
  assert.equal(w.common.currentWorkspace(), B); assert.deepEqual(changes, [B]);
  assert.equal(w.replaced.at(-1), workspaceHash(B)); assert.equal(w.common.windowState(), 'bound');
  const newest = await shownBCA();
  await newest.common.leaveTakenWorkspace(A, CHOICES.concat({ id: C }));
  assert.deepEqual(newest.claims, [[C, { focus: false }]], 'newest first: C before B');
});

test('a workspace another window has is passed over: the next one is tried', async () => {
  const w = await shownBCA(async (id, options) => (id === C && options?.focus === false ? { ok: false, code: 'open-elsewhere', workspaces: CHOICES } : { ok: true }));
  await w.common.leaveTakenWorkspace(A, [{ id: A }, { id: B }, { id: C }]);
  assert.deepEqual(w.claims, [[C, { focus: false }], [B, { focus: false }]]);
  assert.equal(w.common.currentWorkspace(), B);
});

test('with no workspace left to show, the window chooses: main unbinds it and it shows the switcher', async () => {
  const w = await shownBCA(async (id, options) => (id !== null && options?.focus === false ? { ok: false, code: 'open-elsewhere' } : { ok: true }));
  await w.common.leaveTakenWorkspace(A, [{ id: A }, { id: B }]);
  assert.deepEqual(w.claims, [[B, { focus: false }], [null, undefined]], 'B is refused; then the window binds nothing');
  assert.equal(w.common.windowState(), 'choosing'); assert.equal(w.common.currentWorkspace(), '');
  assert.deepEqual(w.common.choosingWorkspaces(), [{ id: A }, { id: B }], 'its choices: what main sent');
  assert.equal(w.replaced.at(-1), '/app/renderer/index.html', 'the hash is cleared');
  const alone = await windowWith({ hash: workspaceHash(A) });
  await alone.common.switchWorkspace(B); alone.claims.length = 0;
  await alone.common.leaveTakenWorkspace(B, null);
  assert.deepEqual(alone.claims, [[null, undefined]], 'no choices sent: nothing in the history is served');
  assert.deepEqual(alone.common.choosingWorkspaces(), []);
});

test('a window that already left the workspace taken over does nothing', async () => {
  const w = await shownBCA();
  await w.common.leaveTakenWorkspace(B, CHOICES);
  assert.deepEqual(w.claims, []); assert.equal(w.common.currentWorkspace(), A);
});

test('a leave runs after a switch already queued: one that moved the window away leaves nothing to do', async () => {
  const gates = [];
  const w = await shownBCA((id) => { const g = deferred(); gates.push([id, g]); return g.promise; });
  const switched = w.common.switchWorkspace(B);
  await new Promise((r) => setImmediate(r));
  const left = w.common.leaveTakenWorkspace(A, [{ id: A }, { id: B }, { id: C }]);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(gates.map(([id]) => id), [B], 'the leave waits for the switch in flight');
  gates[0][1].resolve({ ok: true });
  assert.deepEqual(await switched, { ok: true }); await left;
  assert.deepEqual(gates.map(([id]) => id), [B], 'on B already: nothing more is claimed');
  assert.equal(w.common.currentWorkspace(), B);
  // A queued switch main refused leaves the window on the workspace taken: the leave then runs.
  const refused = await shownBCA(async (id, options) => (options?.focus === true && id === D ? { ok: false, code: 'focused-other' } : { ok: true }));
  const blocked = refused.common.switchWorkspace(D);
  await refused.common.leaveTakenWorkspace(A, [{ id: A }, { id: B }, { id: C }, { id: D }]);
  assert.deepEqual((await blocked).code, 'focused-other');
  assert.deepEqual(refused.claims, [[D, { focus: true }], [C, { focus: false }]]);
  assert.equal(refused.common.currentWorkspace(), C);
});

test('without the window bridge, a leave is a plain selection of the newest served workspace', async () => {
  const w = await windowWith({ hash: '', stored: A, bridge: false });
  for (const id of [B, A]) await w.common.switchWorkspace(id);
  await w.common.leaveTakenWorkspace(A, CHOICES);
  assert.equal(w.common.currentWorkspace(), B);
});

// The workspace a window was opened on (its hash, or a restored window's) is the first of its session
// history: startWindow confirms it with main and keeps it.
test('the workspace a window was opened on is in its history: taken over after one switch, it goes back there', async () => {
  const w = await windowWith({ hash: workspaceHash(B) });
  assert.equal(await w.common.startWindow(), 'bound');
  await w.common.switchWorkspace(A); w.claims.length = 0;
  await w.common.leaveTakenWorkspace(A, CHOICES);
  assert.deepEqual(w.claims, [[B, { focus: false }]]);
  assert.equal(w.common.currentWorkspace(), B);
});

/* ── the layout a take-over hands over (renderer/layout-handover.mjs) ── */
const LAYOUT = { terminals: [{ instance: 'dev' }], split: null, active: 0 };

test('handedLayout: a take-over\'s layout, read once by the switch\'s listeners, then null', async () => {
  const w = await windowWith({ hash: workspaceHash(A), claim: async (id) => ({ ok: true, workspace: id, layout: LAYOUT }) });
  const seen = [];
  w.common.onWorkspaceChange((id) => seen.push([id, w.common.handedLayout(id), w.common.handedLayout(id)]));
  assert.deepEqual(await w.common.switchWorkspace(B, { takeOver: true }), { ok: true });
  assert.deepEqual(seen, [[B, LAYOUT, null]], 'once, during the listeners');
  assert.equal(w.common.handedLayout(B), null, 'none after the switch');
});

test('handedLayout: a plain switch carries none, nor does a take-over main answered without one', async () => {
  const w = await windowWith({ hash: workspaceHash(A), claim: async (id, options) => ({ ok: true, workspace: id, ...(options?.takeOver ? {} : { layout: LAYOUT }) }) });
  const seen = []; w.common.onWorkspaceChange((id) => seen.push(w.common.handedLayout(id)));
  await w.common.switchWorkspace(B);
  await w.common.switchWorkspace(A, { takeOver: true });
  assert.deepEqual(seen, [null, null]);
});

test('handedLayout: the layout is the bound workspace\'s only (a deployment id\'s view); another workspace gets none', async () => {
  const w = await windowWith({ hash: workspaceHash(A), claim: async () => ({ ok: true, workspace: B, layout: LAYOUT }) });
  const seen = []; w.common.onWorkspaceChange((id) => seen.push([id, w.common.handedLayout(C), w.common.handedLayout(id)]));
  await w.common.switchWorkspace(C, { takeOver: true }); // C is a deployment of B: main bound B
  assert.deepEqual(seen, [[B, null, null]], 'C, the id asked, is not the workspace bound; and a read for it spends the layout');
  const v = await windowWith({ hash: workspaceHash(A), claim: async () => ({ ok: true, workspace: B, layout: LAYOUT }) });
  const got = []; v.common.onWorkspaceChange((id) => got.push(v.common.handedLayout(id)));
  await v.common.switchWorkspace(C, { takeOver: true });
  assert.deepEqual(got, [LAYOUT], 'the view main bound gets it');
});

test('a release naming the view of the deployment this window holds it under (main rekeyed it first) leaves it', async () => {
  // History C, then B; on the deployment /d/oats now, which main has already bound as the view ws:oats….
  const OATS = '/d/oats', VIEW = 'ws:oooooooooooooooooooo';
  const w = await windowWith({ hash: workspaceHash(C) });
  for (const id of [B, OATS]) assert.deepEqual(await w.common.switchWorkspace(id), { ok: true });
  w.claims.length = 0;
  const served = [{ id: VIEW, deployments: [OATS] }, { id: B }, { id: C }];
  assert.deepEqual([...w.common.takenWorkspaceIds(VIEW, served)], [VIEW, OATS]);
  await w.common.leaveTakenWorkspace(VIEW, served);
  assert.deepEqual(w.claims, [[B, { focus: false }]], 'it leaves, for the newest of its history that is not the workspace taken');
  assert.equal(w.common.currentWorkspace(), B);
});

test('the latest pick wins: a take-over still waiting on main, then a switch back, ends on the switch back', async () => {
  // Main answers B's take-over only after the release wait; meanwhile the window is switched back to A.
  const gate = deferred(), bound = [];
  const w = await windowWith({ hash: workspaceHash(A), claim: async (id, options) => {
    if (id === B) await gate.promise;
    bound.push(id); return { ok: true };
  } });
  const toB = w.common.switchWorkspace(B, { takeOver: true });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(w.claims, [[B, { takeOver: true }]], "B's claim is with main");
  const backToA = w.common.switchWorkspace(A, { takeOver: true });
  gate.resolve();
  assert.deepEqual(await toB, { ok: true }, 'main had bound B: this window follows it');
  assert.deepEqual(await backToA, { ok: true });
  assert.deepEqual(bound, [B, A], 'main binds A last');
  assert.equal(w.common.currentWorkspace(), A, 'and so does this window');
});
