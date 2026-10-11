// The deployments a client holds and the views over them (packages/client/panel-views.mjs, #855 1d), called
// directly with a `held` of the test's own: what a second client does. The Desktop's own call shape (its
// `held`, its terms, every route) is test/workspace-views-server.test.mjs, over the same fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as views from '../../client/panel-views.mjs';
import * as panel from '../../client/deployment-panel.mjs';
import { clientTerms } from '../../client/client-terms.mjs';
import { deploymentState, primaryDeployment, isMultiDeployment, rowStale } from '../../client/roster-sections.mjs';
import { createRemoteIdentityStore } from '../server/remote-identity.mjs';
import { DESKTOP_TERMS } from '../renderer/desktop-terms.mjs';
import { CLI, juanState, identity, observed, unavailable, row, group, OATS, LAB, A, B, L, R, V, V_OATS, V_LAB } from './helpers/workspace-views-fixture.mjs';

const AT = '2026-10-11T12:00:00.000Z';
const TUI = clientTerms({ name: 'oats tui', self: 'oats tui', selfInitial: 'oats tui', update: 'OATS', thisMachine: 'This machine' });
/** A store that only reads: its writing method fails the test that reaches it. */
const reading = (store = createRemoteIdentityStore({ file: null })) => ({ get: id => store.get(id), note: id => store.note(id), all: () => store.all(), observe: () => assert.fail('the shared home never writes the remembered identities') });
/** `held` from the fixture's state (its keys are the Desktop server's variable names). */
const heldOf = (state = {}, over = {}) => ({ ctxs: state.ctxs ?? [], snapshot: state.snapshot ?? { byWs: new Map() }, remoteGroups: state.remoteGroups ?? [], remembered: reading(state.remoteIdentities),
  rosterAnswered: state.rosterAnswered ?? true, rosterFailure: state.rosterFailure ?? null, cli: state.cliState ?? CLI, observing: state.observing ?? new Set(), remoteCollecting: state.remoteCollecting ?? false,
  home: '/Users/juan', at: AT, ...over });
const juanHeld = (over = {}, heldOver = {}) => heldOf(juanState(over).state, heldOver);
/** Everything of a value a function could change, as text: Maps and Sets by their contents. */
const plain = v => JSON.stringify(v, (k, x) => (x === undefined ? '__undefined__' : x instanceof Map ? { map: [...x] } : x instanceof Set ? { set: [...x] } : typeof x === 'function' ? '__function__' : x));
/** Frozen at every depth, into Maps and Sets: a write to any object or array of it throws. */
const frozen = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const item of value instanceof Map ? [...value.values()] : value instanceof Set ? [...value] : Object.values(value)) frozen(item, seen);
  return Object.freeze(value);
};

test('a second client: the views over what it holds, in its own terms, with its own home and time', () => {
  const held = juanHeld({}, { home: '/Users/juan/Agents' });
  const model = views.viewModel(held, TUI);
  assert.deepEqual(model.views.map(v => [v.id, v.primary, v.deployments]), [[V_OATS, A, [A, B, R]], [V_LAB, V, [V]], [L, L, [L]]]);
  // This machine's label is the client's; a path is shortened under the home the client gave, and only under it.
  const a = views.deploymentInfo(held, views.deployments(held)[0], TUI);
  assert.deepEqual([a.machine, a.label, a.path], ['This machine', '~/oats', A]);
  assert.deepEqual(views.workspaceChoices(held, TUI, model)[0].deploymentLabels, ['This machine · ~/oats', 'This machine · /Users/juan/awebai/oats-v2', 'altair · ~/oats']);
  const panel = views.panelData(held, V_OATS, TUI);
  assert.deepEqual(panel.instances.map(i => [i.instance, i.deployment.machine]), [['dev-a', 'This machine'], ['idle', 'This machine'], ['dev-b', 'This machine'], ['far-a', 'altair']]);
  // The same call with the Desktop's terms differs in those words only.
  const desktop = views.panelData(held, V_OATS, DESKTOP_TERMS);
  assert.equal(plain(desktop).replaceAll('This Mac', 'This machine'), plain(panel));
  assert.notEqual(plain(desktop), plain(panel));
});

test('`at` stamps only a panel with no observation behind it; an observed entry keeps its own time', () => {
  const held = juanHeld();
  assert.equal(views.panelData(held, '/nope', DESKTOP_TERMS).generatedAt, AT, 'no view: nothing was observed for it');
  assert.equal(views.deploymentPanel(held, null).generatedAt, AT);
  assert.equal(views.deploymentPanel(held, { id: '/Users/juan/never-read', name: 'never-read' }).generatedAt, AT, 'a served deployment not read yet');
  assert.equal(views.deploymentPanel(held, views.deployments(held)[0]).generatedAt, held.snapshot.byWs.get(A).generatedAt);
  assert.equal(views.deploymentPanel(heldOf({}, { at: '2027-01-01T00:00:00.000Z' }), null).generatedAt, '2027-01-01T00:00:00.000Z', 'it is the caller\'s time, not a clock read here');
});

test('deploymentEntry is what deploymentState reads: live, stale, not observed, not reached, remembered', () => {
  const state = (held, id) => { const model = views.viewModel(held, DESKTOP_TERMS); return deploymentState(views.deploymentEntry(model.infos.get(id), views.viewFor(held, id, DESKTOP_TERMS, model).primary)); };
  const held = juanHeld();
  assert.deepEqual(state(held, A), { key: 'live', text: 'live', detail: '' });
  assert.deepEqual(state(held, L), { key: 'unobserved', text: 'not observed', detail: 'E_CLI_FAILED: boom' });
  // A failed re-read kept the last observation: stale, with the kernel's message.
  const kept = juanState().state; kept.snapshot.byWs.set(A, { ...kept.snapshot.byWs.get(A), error: 'the cache is locked' });
  assert.deepEqual(state(heldOf(kept), A), { key: 'stale', text: 'stale', detail: "This deployment's last read failed: the cache is locked. It shows what was last observed." });
  // A machine that did not answer: not reached; with a remembered identity, remembered.
  const { altair, vega } = juanState(), down = { ...altair, probe: { ok: false, error: { code: 'E_SSH', message: 'Connection timed out' } }, workspace: null };
  const unreached = state(heldOf(juanState({ remoteGroups: [down, vega] }).state), R);
  assert.equal(unreached.key, 'unreached'); assert.ok(unreached.detail.length > 0);
  const store = createRemoteIdentityStore({ file: null }); store.observe([altair, vega]);
  assert.equal(state(heldOf({ ...juanState({ remoteGroups: [down, vega] }).state, remoteIdentities: store }), R).key, 'remembered');
  // The panel's own list is those entries, and the helpers that read it agree on the primary.
  const deployments = views.panelData(held, V_OATS, DESKTOP_TERMS).deployments;
  assert.deepEqual(deployments, [A, B, R].map(id => views.deploymentEntry(views.viewModel(held, DESKTOP_TERMS).infos.get(id), A)));
  assert.deepEqual([primaryDeployment(deployments).id, isMultiDeployment(deployments), rowStale({ deployment: { id: A } }, deployments)], [A, true, false]);
});

test('edges: no memory of a group, a kernel without workspace-identity, nothing served, an id in no view', () => {
  // A machine that did not answer and that nothing remembers: not reached, no identity, never a throw.
  const { altair, vega } = juanState(), down = { ...altair, probe: { ok: false, error: { code: 'E_SSH', message: 'Connection timed out' } }, workspace: null };
  const forgotten = heldOf(juanState({ remoteGroups: [down, vega] }).state);
  const info = views.viewModel(forgotten, DESKTOP_TERMS).infos.get(R);
  assert.deepEqual([info.reachable, info.identityFrom, info.identity, info.note], [false, null, null, null]);
  assert.equal(views.viewFor(forgotten, R, DESKTOP_TERMS).id, R, 'its own view, under its own id');
  // No roster answer and nothing remembered: no remembered groups, and the local deployments as before.
  const silent = heldOf({ ...juanState({ remoteGroups: [] }).state, rosterAnswered: false, rosterFailure: 'no route' });
  assert.deepEqual(views.rememberedGroups(silent), []);
  assert.deepEqual(views.deployments(silent).map(d => d.id), [A, B, L]);
  // A kernel that does not report workspace identity: nothing matches, every deployment is its own view, none "unattached".
  const old = juanHeld({ cliState: { ok: true, bin: '/oats', features: [], remote: ['roster'] } });
  assert.deepEqual(views.viewModel(old, DESKTOP_TERMS).views.map(v => v.id), [A, B, L, R, V]);
  for (const choice of views.workspaceChoices(old, DESKTOP_TERMS)) assert.equal(Object.hasOwn(choice, 'unattached'), false, choice.id);
  // A record with no feature list and no remote list at all reads the same way.
  assert.deepEqual(views.viewModel(juanHeld({ cliState: { ok: false } }), DESKTOP_TERMS).views.map(v => v.id), [A, B, L, R, V]);
  // Nothing served.
  const none = heldOf();
  assert.deepEqual([views.deployments(none), views.viewModel(none, DESKTOP_TERMS).views, views.workspaceChoices(none, DESKTOP_TERMS)], [[], [], []]);
  assert.deepEqual([views.viewFor(none, undefined, DESKTOP_TERMS), views.deploymentFor(none, undefined, DESKTOP_TERMS), views.isServed(none, A, DESKTOP_TERMS)], [null, null, false]);
  assert.deepEqual(views.panelData(none, undefined, DESKTOP_TERMS), { workspace: null, team: null, deployment: { status: 'pending' }, generatedAt: AT, observedAt: null, refreshing: false, running: 0, instances: [], workspaces: [], deployments: [] });
  // An id that is in no view: no view, no deployment, not served, no members, no machines, an empty forge context.
  const held = juanHeld();
  for (const id of ['/nope', 'remote:nope', 'ws:0000']) {
    assert.deepEqual([views.viewFor(held, id, DESKTOP_TERMS), views.deploymentFor(held, id, DESKTOP_TERMS), views.isServed(held, id, DESKTOP_TERMS), views.teamMembersFor(held, id, DESKTOP_TERMS),
      views.machineScope(held, id, DESKTOP_TERMS), views.surfaceDeployment(held, id, { selector: { home: '/h' } }, DESKTOP_TERMS)], [null, null, false, null, null, undefined], id);
    assert.deepEqual(views.viewForgeContext(held, id, DESKTOP_TERMS), { workspace: undefined, cli: held.cli, instances: [], clones: [] });
    assert.deepEqual(views.panelData(held, id, DESKTOP_TERMS).deployments, []);
  }
});

test('nothing is kept and nothing given is changed: every function over a frozen `held`, twice', (t) => {
  // The clock is another year than `held.at` and moves between the two runs: an answer that read it would
  // hold that year, or differ the second time.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2031-03-04T05:06:07.000Z') });
  const store = createRemoteIdentityStore({ file: null }); const { altair, vega } = juanState(); store.observe([altair, vega]);
  const states = [juanState().state, { ...juanState({ remoteGroups: [] }).state, rosterAnswered: false, rosterFailure: 'no route', remoteIdentities: store }, { ctxs: [] }];
  for (const state of states) {
    const held = frozen(heldOf(state, { remembered: frozen(reading(state.remoteIdentities)) }));
    const before = plain(held);
    const run = () => {
      const model = views.viewModel(held, DESKTOP_TERMS), all = views.deployments(held);
      const out = [all, views.rememberedGroups(held), model, views.workspaceChoices(held, DESKTOP_TERMS), views.workspaceChoices(held, DESKTOP_TERMS, frozen(views.viewModel(held, DESKTOP_TERMS)))];
      for (const id of [undefined, A, B, L, R, V, V_OATS, V_LAB, '/nope']) {
        out.push(views.viewFor(held, id, DESKTOP_TERMS), views.viewFor(held, id, DESKTOP_TERMS, model), views.deploymentFor(held, id, DESKTOP_TERMS), views.viewForgeContext(held, id, DESKTOP_TERMS),
          views.isServed(held, id, DESKTOP_TERMS), views.teamMembersFor(held, id, DESKTOP_TERMS), views.machineScope(held, id, DESKTOP_TERMS), views.panelData(held, id, DESKTOP_TERMS),
          views.surfaceDeployment(held, id, frozen({ selector: { home: '/h' } }), DESKTOP_TERMS), views.workspaceEntry(held, id ?? A));
      }
      for (const d of all) {
        const info = views.deploymentInfo(held, frozen(d), DESKTOP_TERMS);
        out.push(info, views.deploymentPanel(held, d), views.deploymentRows(held, d), views.deploymentTag(frozen(info)), views.deploymentEntry(info, A), views.reasonFields(frozen({ detail: 'd', short: 's', fix: ['f'] })));
      }
      return plain(out);
    };
    const first = run();
    t.mock.timers.tick(61_000);
    assert.equal(run(), first, 'the same answers the second time: nothing was kept between the calls, and no clock was read');
    assert.doesNotMatch(first, /2031-/, 'no answer holds the time of the clock');
    assert.equal(plain(held), before, '`held` is as it was');
  }
});

test('the store is read through get, note and all, and nothing else of it is touched', () => {
  const store = createRemoteIdentityStore({ file: null }); const { altair, vega } = juanState(); store.observe([altair, vega]);
  const touched = new Set();
  const remembered = new Proxy(reading(store), { get(target, key) { touched.add(key); return target[key]; } });
  const down = { ...altair, probe: { ok: false, error: { code: 'E_SSH', message: 'Connection timed out' } }, workspace: null };
  for (const state of [juanState({ remoteGroups: [down, vega] }).state, { ...juanState({ remoteGroups: [] }).state, rosterAnswered: false }]) {
    const held = heldOf(state, { remembered });
    views.panelData(held, undefined, DESKTOP_TERMS); views.workspaceChoices(held, DESKTOP_TERMS); views.teamMembersFor(held, R, DESKTOP_TERMS); views.machineScope(held, A, DESKTOP_TERMS);
  }
  assert.deepEqual([...touched].sort(), ['all', 'get', 'note']);
});

test('the Desktop\'s server holds none of what moved: it declares no name the two shared modules export', () => {
  const server = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /OATSWEB_VIEWS_|OATSWEB_PANELPROJ_|projectPanelInstance/);
  const moved = [...Object.keys(views), ...Object.keys(panel)];
  assert.ok(moved.includes('deploymentInfo') && moved.includes('panelInstance') && moved.length >= 28, 'the names read are the shared modules\' own');
  const declared = name => new RegExp(`(?:function\\*?|const|let|var|class)\\s+${name}\\b`).test(server);
  assert.deepEqual(moved.filter(declared), []);
  // The check finds a declaration when there is one.
  assert.equal(declared('observeDeployment'), true); assert.equal(declared('held'), true);
});

test('a remote view is made at `held.at`: the same `held` answers the same, whatever the clock says', (t) => {
  // The clock is not held still: it is another year than `held.at`, and it moves between the two calls.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2031-03-04T05:06:07.000Z') });
  const remoteOnly = { ...juanState().state, ctxs: [], snapshot: { byWs: new Map() } };
  for (const [what, held] of [['beside this machine\'s deployments', frozen(juanHeld())], ['with no deployment on this machine', frozen(heldOf(remoteOnly))]]) {
    const remote = views.deployments(held).filter(d => d.remote);
    assert.deepEqual(remote.map(d => d.id), [R, V], what);
    for (const d of remote) {
      const first = views.deploymentPanel(held, d), firstData = views.panelData(held, d.id, TUI), firstMembers = views.teamMembersFor(held, d.id, TUI);
      t.mock.timers.tick(61_000);
      assert.deepEqual(views.deploymentPanel(held, d), first, `${what}: ${d.id}`);
      assert.deepEqual(views.panelData(held, d.id, TUI), firstData, `${what}: ${d.id}`);
      assert.deepEqual(views.teamMembersFor(held, d.id, TUI), firstMembers, `${what}: ${d.id}`);
      assert.equal(first.generatedAt, AT, `${what}: ${d.id}: the panel's time is held.at`);
      assert.doesNotMatch(plain([first, firstData, firstMembers]), /2031-/, `${what}: ${d.id}`);
      // A view's panel is its primary deployment's: with no local deployment that is a remote one.
      if (held.ctxs.length === 0) assert.equal(firstData.generatedAt, AT, `${what}: ${d.id}: and so is its view's`);
    }
  }
});
