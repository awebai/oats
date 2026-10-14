// #855: the context panel's lifecycle row, the roster row's actions menu and the overview popover offer the same
// acts, enabled the same way, because all three draw them from packages/client/instance-acts.mjs. The panel and
// the menu are built here for one row at a time and read as plain data; the popover is read off a mounted canvas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createContextPanel, contextPanelCSS } from '../renderer/context-panel.mjs';
import { instanceActions } from '../renderer/instance-actions.mjs';
import { reasonLine } from '../renderer/speaker-line.mjs';
import * as hierarchy from '../renderer/views/hierarchy.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';
import { instanceActs, openAct } from '../../client/instance-acts.mjs';
import { ROWS as MENU_ROWS } from './helpers/instance-menu-probe.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const HERDR = 'E_HERDR_REMOVED: Herdr is no longer supported by OATS (removed in 0.31.0); tmux is the only session backend.';
const local = (name, extra = {}) => ({ instance: name, agent: 'dev', agentsRoot: '/team/agents', home: `/team/agents/dev/instances/${name}`, harness: 'pi', ...extra });
const remote = (name, extra = {}) => ({ instance: name, agent: 'dev', agentsRoot: '/remote/agents', home: `/remote/agents/dev/instances/${name}`,
  server: 'host', repoName: 'Build box', harness: 'claude', ...extra });

/** The spec's rows (#855), each with what the panel offers: [verb, enabled] in the panel's order. */
const ROWS = {
  running: [local('running', { running: true }), [['restart', true], ['stop', true], ['retire', true]]],
  stopped: [local('stopped', { running: false }), [['start', true], ['stop', true], ['retire', true]]],
  'state unknown': [local('unknown', { running: null }), [['stop', true], ['retire', true]]],
  'held: spawning': [local('spawning', { running: false, spawnInProgress: true }), []],
  'held: spawn incomplete': [local('rollback', { running: false, rollbackIncomplete: true }), [['retire', true]]],
  'held: retire incomplete': [local('retiring', { running: true, retirePending: true }), [['retire', true]]],
  'unsupported session (Herdr)': [local('herdr', { running: null, runtimeState: 'unsupported', runtimeError: HERDR }), [['start', false], ['stop', true], ['retire', true]]],
  'server not reached': [remote('unreached', { serverUnreached: true, running: null, addressable: true, savedRoute: true, missingRemotely: false,
    runtimeError: 'ssh: connect to host timed out' }), [['stop', true], ['retire', true]]],
  'not addressable': [remote('unrouted', { addressable: false, running: true }), []],
  'not addressable (gone from the server)': [remote('gone', { addressable: false, savedRoute: true, missingRemotely: true, running: null }), []],
};
const VERBS = ['restart', 'start', 'stop', 'retire'];

function panelFixture(t) {
  const dom = new JSDOM('<!doctype html><body><div id="app"><aside id="context-panel"></aside></div></body>');
  const document = dom.window.document, style = document.createElement('style'); style.textContent = contextPanelCSS; document.head.append(style);
  const calls = [], lifecycle = Object.fromEntries(VERBS.map(op => [op, instance => calls.push(`${op} ${instance.instance}`)]));
  const panel = createContextPanel({ document, root: document.getElementById('context-panel'), lifecycle });
  t.after(() => { panel.dispose(); dom.window.close(); });
  const control = op => document.querySelector(`[data-lifecycle="${op}"]`);
  return {
    document, calls, control,
    /** What the panel's lifecycle row offers for `row`: [verb, enabled], in its order. */
    offer(row) {
      panel.setContext({ workspace: 'A', instance: row, key: row.home });
      return VERBS.filter(op => !control(op).hidden).map(op => [op, !control(op).disabled]);
    },
  };
}

/** What the roster menu offers for `row` (no shell items in front): [verb, enabled], `inspect` left out. */
function menuOffer(row) {
  const dom = new JSDOM('<body></body>'), doc = dom.window.document;
  const wrapper = instanceActions(doc, row, { scope: 'ws', owner: () => true, invoke: async () => ({}), openLifecycle: () => {} });
  doc.body.append(wrapper);
  const items = [...wrapper.querySelectorAll('[role="menuitem"]')].filter(item => item.dataset.action !== 'inspect');
  const trigger = wrapper.querySelector('.ctx-instance-actions');
  const answer = { offer: items.map(item => [item.dataset.action, !item.disabled]), triggerDisabled: trigger.disabled, triggerTitle: trigger.title };
  dom.window.close();
  return answer;
}

const sharedOffer = row => instanceActs(row).acts.filter(act => act.verb !== 'inspect').map(act => [act.verb, act.enabled]);

test('#855: for each row the context panel offers the acts the roster menu offers, enabled the same way, and the ones the spec names', t => {
  const u = panelFixture(t);
  for (const [name, [row, expected]] of Object.entries(ROWS)) {
    const panel = u.offer(row);
    assert.deepEqual(panel, expected, `${name}: the panel`);
    assert.deepEqual(menuOffer(row).offer, panel, `${name}: the roster menu offers what the panel does`);
    assert.deepEqual(sharedOffer(row), panel, `${name}: and both are instanceActs' answer`);
  }
});

test("#855: the panel agrees with the roster menu on every row of the menu's own probe table", t => {
  const u = panelFixture(t);
  for (const [name, row] of Object.entries(MENU_ROWS)) {
    const panel = u.offer(row);
    assert.deepEqual(menuOffer(row).offer, panel, name);
    assert.deepEqual(sharedOffer(row), panel, `${name}: instanceActs`);
  }
});

test('#855: Stop on a stopped row and on one whose state is unknown opens the plan-backed Stop, as the menu does', t => {
  const u = panelFixture(t);
  for (const row of [ROWS.stopped[0], ROWS['state unknown'][0], ROWS['server not reached'][0]]) {
    u.offer(row); u.control('stop').click();
  }
  assert.deepEqual(u.calls, ['stop stopped', 'stop unknown', 'stop unreached']);
});

test('#855: a row whose server was not reached lists Stop and Retire enabled, and its terminal does not open: its state is unknown', () => {
  const [row] = ROWS['server not reached'];
  const { blocked, limited, acts } = instanceActs(row);
  assert.equal(blocked, null); assert.equal(limited, null);
  assert.deepEqual(acts.filter(act => ['stop', 'retire'].includes(act.verb)).map(({ verb, enabled }) => [verb, enabled]), [['stop', true], ['retire', true]]);
  const open = openAct(row);
  assert.equal(open.enabled, false); assert.equal(open.reason.code, 'state-unknown');
});

test('#855: a herdr row keeps Start visible, disabled, with the kernel reason as its title; the other controls carry no title', t => {
  const u = panelFixture(t);
  u.offer(ROWS['unsupported session (Herdr)'][0]);
  assert.equal(u.control('start').title, HERDR);
  for (const op of ['stop', 'retire']) assert.equal(u.control(op).title, '', op);
});

test('#855: a blocked row (not addressable) offers no lifecycle control in the panel, as the menu offers none, whose trigger says why', t => {
  const u = panelFixture(t);
  for (const name of ['not addressable', 'not addressable (gone from the server)']) {
    const [row] = ROWS[name], { blocked } = instanceActs(row);
    assert.equal(blocked?.code, 'unaddressable', name);
    assert.deepEqual(u.offer(row), [], `${name}: no control, not disabled ones`);
    for (const op of VERBS) assert.equal(u.control(op).hidden, true, `${name}: ${op}`);
    const menu = menuOffer(row);
    assert.deepEqual(menu.offer, [], `${name}: the menu has no item`);
    assert.equal(menu.triggerDisabled, true); assert.equal(menu.triggerTitle, reasonLine(blocked), `${name}: the roster says why`);
  }
});

test('#855: a blocked row says why in the action row, once: a remote row not reported addressable, a home still spawning; a row gone from its server says it in its Work note alone', t => {
  const u = panelFixture(t), line = () => u.document.querySelector('[data-context-actions-note]'), work = () => u.document.querySelector('[data-context-work-note]');
  for (const name of ['not addressable', 'held: spawning']) {
    const [row] = ROWS[name], { blocked } = instanceActs(row);
    assert.ok(blocked, name);
    assert.deepEqual(u.offer(row), [], name);
    assert.equal(line().hidden, false, name); assert.equal(line().textContent, reasonLine(blocked), name);
    assert.ok(line().textContent, `${name}: a sentence, not an empty line`);
    assert.ok(line().classList.contains('context-panel-note'), `${name}: the panel's muted note`);
  }
  assert.equal(line().textContent, 'spawning is setting up its worktree. It can\'t be used until the spawn finishes.');
  // A row gone from its server: the Work note says it, and the action row says nothing more.
  const [gone] = ROWS['not addressable (gone from the server)'];
  u.offer(gone);
  assert.equal(work().hidden, false); assert.equal(work().textContent, reasonLine(instanceActs(gone).blocked));
  assert.equal(line().hidden, true); assert.equal(line().textContent, '');
  // No row that offers acts carries the line.
  for (const [name, [row]] of Object.entries(ROWS)) {
    if (instanceActs(row).blocked) continue;
    u.offer(row);
    assert.equal(line().hidden, true, name); assert.equal(line().textContent, '', name);
  }
});

/* ── the overview popover: Restart with… and Terminal/Start… ── */
async function canvas(t, rows) {
  const dom = new JSDOM('<body><main id="host"></main></body>', { url: 'http://localhost' });
  const doc = dom.window.document, host = doc.querySelector('main');
  const old = { window: globalThis.window, document: globalThis.document, setInterval: globalThis.setInterval, ws: currentWorkspace() };
  globalThis.window = dom.window; globalThis.document = doc; globalThis.setInterval = () => 0;
  doc.hasFocus = () => true;
  setWorkspace('/team');
  const opened = [], started = [], restarted = [];
  const read = () => ({ instances: rows, workspace: { id: '/team' }, workspaces: [{ id: '/team', name: 'Team' }], generatedAt: 'observation-time' });
  const dispose = hierarchy.mount(host, { hasWorkspaceSwitcher: true, api: read, openTerminal: ref => opened.push(ref.instance),
    startInstance: ref => started.push(ref.instance), restartInstance: ref => restarted.push(ref.instance), openView() {} });
  t.after(() => { dispose(); setWorkspace(old.ws); globalThis.window = old.window; globalThis.document = old.document; globalThis.setInterval = old.setInterval; dom.window.close(); });
  await tick();
  host.querySelector('.hier-canvas').getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 800 });
  const mouse = (target, type) => target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, button: 0 }));
  const node = name => [...host.querySelectorAll('.hnode')].find(n => n.dataset.name === name);
  return { host, mouse, node, opened, started, restarted };
}

test('#855: the overview popover enables Restart with… and Terminal/Start… exactly as the shared acts do', async t => {
  const rows = Object.values(ROWS).map(([row]) => row), u = await canvas(t, rows);
  for (const [name, [row]] of Object.entries(ROWS)) {
    u.mouse(u.node(row.instance), 'click');
    const terminal = u.host.querySelector('.pterm'), restart = u.host.querySelector('.prestart');
    assert.ok(terminal && restart, `${name}: the popover is open`);
    const menu = new Map(menuOffer(row).offer), stopped = row.running === false;
    assert.equal(!restart.disabled, menu.get('restart') === true, `${name}: Restart with… as the menu's Restart`);
    assert.equal(terminal.textContent, stopped ? 'Start…' : 'Terminal', name);
    const enabled = stopped ? menu.get('start') === true : openAct(row)?.enabled === true;
    assert.equal(!terminal.disabled, enabled, `${name}: ${terminal.textContent} as the ${stopped ? 'menu\'s Start' : 'shared open act'}`);
    // The double-click and Enter paths act exactly when the button would.
    const before = [u.opened.length, u.started.length];
    u.mouse(u.node(row.instance), 'dblclick');
    assert.deepEqual([u.opened.length - before[0], u.started.length - before[1]], enabled ? stopped ? [0, 1] : [1, 0] : [0, 0], `${name}: a double-click`);
  }
  // The rows the spec names, read off the canvas: only the running row opens and restarts, only the stopped one starts.
  assert.deepEqual(u.opened, ['running']); assert.deepEqual(u.started, ['stopped']); assert.deepEqual(u.restarted, []);
});
