import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createForgePrPanel } from '../renderer/forge-pr.mjs';
import { createConnections, authKeyName } from '../renderer/connections.mjs';
import { createKeybindingsEditor } from '../renderer/keybindings-editor.mjs';
import { pullRequest, AUTH_PANE_LABEL } from '../renderer/forge-contract.mjs';
import { target, pr, deferred, tick } from './helpers/forge-fixture.mjs';
const key = 'e'.repeat(64), id = 'f'.repeat(64), hostRef = 'd'.repeat(64);
const selected = { target, key, branch: 'feat/a', revision: 'a'.repeat(40) };
const card = () => ({ forgeApi: 1, status: 'available', target,
  observation: { key, branch: selected.branch, revision: selected.revision }, host: 'github.com', repository: 'owner/repo',
  data: pullRequest(pr(), { host: 'github.com', path: 'owner/repo', branch: 'feat/a' }), reason: null });
const connection = (login = null) => ({ forgeApi: 1, status: login ? 'connected' : 'not-connected', host: 'github.com', login,
  hostRef, connectionRef: id, hosts: [{ host: 'github.com', hostRef }] });
const dom = () => new JSDOM('<!doctype html><button id="opener">Settings</button><main id="root"></main>', { pretendToBeVisual: true });
test('PR card renders reported facts/checks, validates external URL, and never claims local HEAD was pushed', async () => {
  const window = dom().window, root = window.document.querySelector('main'), opened = [];
  const panel = createForgePrPanel(root, { request: async (_ws, body) => { assert.deepEqual(Object.keys(body).sort(), ['observationKey', 'selector']); return card(); }, openExternal: url => opened.push(url) });
  await panel.update(selected);
  assert.match(root.textContent, /#42 · A real PR/); assert.match(root.textContent, /Reported PR checks/);
  assert.match(root.textContent, /not proof that the local revision was pushed/);
  root.querySelector('a').click(); assert.deepEqual(opened, [pr().url]);
  panel.dispose(); window.close();
});
test('PR stale success and rejection after newer selection never overwrite the newer card (including A→B→A)', async () => {
  for (const reject of [false, true]) {
    const window = dom().window, root = window.document.querySelector('main'), pending = deferred(); let calls = 0;
    const panel = createForgePrPanel(root, { request: () => ++calls === 1 ? pending.promise : Promise.resolve({ ...card(), data: { ...card().data, title: 'New observation' } }) });
    const old = panel.update(selected); panel.update(null); await panel.update({ ...selected });
    if (reject) pending.reject(new Error('SECRET')); else pending.resolve(card()); await old;
    assert.match(root.textContent, /New observation/); assert.doesNotMatch(root.textContent, /A real PR|SECRET|unavailable/i);
    panel.dispose(); window.close();
  }
});
test('CSS-hidden PR completion on success and rejection cannot paint a covered panel', async () => {
  for (const reject of [false, true]) {
    const window = dom().window, root = window.document.querySelector('main'), gate = deferred();
    const panel = createForgePrPanel(root, { request: () => gate.promise });
    const pending = panel.update(selected); root.style.display = 'none'; const before = root.innerHTML;
    if (reject) gate.reject(new Error('PRIVATE')); else gate.resolve(card());
    await pending; assert.equal(root.innerHTML, before); panel.dispose(); window.close();
  }
});

test('connection generation partitions PR paints, no-PR differs from unavailable, old Connect controls are revoked', async () => {
  const window = dom().window, root = window.document.querySelector('main'); let change, gen = 0, result = {
    ...card(), status: 'not-connected', data: null, connectionRef: id, hostRef,
  }; const connects = [];
  const panel = createForgePrPanel(root, { request: async () => result, connectionGeneration: () => gen,
    subscribeConnections: fn => { change = fn; return () => {}; }, connect: choice => connects.push(choice) });
  await panel.update(selected); const button = root.querySelector('button'); button.click(); assert.equal(connects.length, 1);
  result = { ...card(), status: 'no-pull-request', data: null }; gen++; change(); await tick();
  assert.match(root.textContent, /No pull request found/); button.click(); assert.equal(connects.length, 1);
  result = { ...card(), status: 'unavailable', data: null, reason: { code: 'E_GH_TIMEOUT', message: 'SECRET' } }; gen++; change(); await tick();
  assert.match(root.textContent, /did not answer in time/); assert.doesNotMatch(root.textContent, /SECRET|No pull request found/);
  panel.dispose(); window.close();
});
function settingsFixture(options = {}) {
  const window = dom().window, doc = window.document, calls = [], data = new Map(), exits = new Map(), listeners = new Set(), terminals = [];
  let gen = 0;
  const notify = () => { gen++; for (const fn of listeners) fn(); };
  const desk = {
    forgeConnect: async () => { calls.push('connect'); notify(); return { ok: true, lease: key }; },
    forgeDisconnect: async () => ({ ok: true, hostRef }), forgeAuthClose: async lease => { calls.push(`close:${lease}`); return { ok: true }; },
    forgeAuthKey: async (_lease, name) => { calls.push(`key:${name}`); return { ok: true }; },
    forgeAuthResize: async lease => { assert.ok(data.has(lease)); assert.ok(exits.has(lease)); calls.push('ready'); return { ok: true }; },
    onForgeAuthData: (lease, fn) => { data.set(lease, fn); return () => data.delete(lease); },
    onForgeAuthExit: (lease, fn) => { exits.set(lease, fn); return () => exits.delete(lease); }, ...options.desk,
  };
  const view = createConnections({ doc, desk, openShortcuts: options.openShortcuts, request: options.request || (async () => connection()),
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, generation: () => gen,
    terminalFactory: options.terminalFactory || (mount => {
      const input = doc.createElement('textarea'); mount.append(input);
      const term = { cols: 80, rows: 24, writes: [], focus: () => input.focus(), fit() {}, write(v) { this.writes.push(v); },
        onData(fn) { this.input = fn; return { dispose() {} }; }, onResize() { return { dispose() {} }; },
        setKeyHandler(fn) { this.keyHandler = fn; }, dispose() { this.disposed = true; } };
      terminals.push(term); return term;
    }),
  });
  return { window, doc, view, desk, calls, data, exits, terminals, notify };
}
test('Settings/Connections keeps its own Connect alive across the generation bump, subscribes before starting PTY, forbids token paste', async () => {
  const f = settingsFixture();
  try {
    f.view.open(); await tick();
    const connect = [...f.doc.querySelectorAll('button')].find(b => b.textContent === 'Connect GitHub'); connect.focus(); connect.click(); await tick(); await tick();
    assert.equal(f.terminals.length, 1); assert.ok(f.calls.includes('ready')); assert.match(f.doc.body.textContent, /GitHub CLI sign-in/);
    assert.ok(f.doc.body.textContent.includes(AUTH_PANE_LABEL));
    f.terminals[0].input('ghp_NOT_A_BYTE_CHANNEL'); f.terminals[0].input('\r');
    assert.deepEqual(f.calls.filter(c => c.startsWith('key:')), ['key:enter']);
    const paste = new f.window.Event('paste', { bubbles: true, cancelable: true });
    f.doc.querySelector('.forge-terminal textarea').dispatchEvent(paste); assert.equal(paste.defaultPrevented, true);
    f.view.close(); assert.equal(f.terminals[0].disposed, true); assert.equal(f.data.size, 0);
  } finally { f.view.dispose(); f.window.close(); }
});
test('old Settings read successes/rejections cannot repaint a reopened dialog', async () => {
  for (const reject of [false, true]) {
    const gate = deferred(); let calls = 0; const f = settingsFixture({ request: () => ++calls === 1 ? gate.promise : Promise.resolve(connection('new-user')) });
    f.view.open(); f.view.close(); f.view.open(); await tick();
    if (reject) gate.reject(new Error('SECRET')); else gate.resolve(connection('old-user')); await tick();
    assert.match(f.doc.body.textContent, /new-user/); assert.doesNotMatch(f.doc.body.textContent, /old-user|SECRET/);
    f.view.dispose(); f.window.close();
  }
});
test('close/reopen during auth prepare cleans the old lease BEFORE a new connect can reuse it', async () => {
  const gate = deferred(), calls = []; let n = 0;
  const f = settingsFixture({ desk: { forgeConnect: async () => { calls.push('connect'); return ++n === 1 ? gate.promise : { ok: true, lease: id }; },
    forgeAuthClose: async lease => { calls.push(`close:${lease}`); return { ok: true }; } } });
  f.view.open({ connectionRef: id, hostRef }); await tick(); f.view.close(); f.view.open({ connectionRef: id, hostRef }); await tick();
  assert.equal(calls.length, 1); gate.resolve({ ok: true, lease: key }); await tick(); await tick();
  assert.deepEqual(calls.slice(0, 3), ['connect', `close:${key}`, 'connect']); assert.equal(f.terminals.length, 1);
  f.view.dispose(); f.window.close();
});
test('Settings → Keyboard shortcuts transfers the original focus-return target instead of stranding it on body', async () => {
  let shortcuts;
  const f = settingsFixture({ openShortcuts: () => shortcuts.open() });
  shortcuts = createKeybindingsEditor({ doc: f.doc, isMac: true });
  const opener = f.doc.getElementById('opener'); opener.focus(); f.view.open(); await tick();
  [...f.doc.querySelectorAll('button')].find(b => b.textContent === 'Keyboard shortcuts').click();
  assert.equal(f.doc.querySelector('.forge-overlay'), null); assert.ok(f.doc.querySelector('.kb-overlay'));
  shortcuts.close(); assert.equal(f.doc.activeElement, opener);
  f.view.dispose(); f.window.close();
});

test('failed terminal construction closes prepared lease; modal is keyboard reachable and input is a closed enum', async () => {
  const f = settingsFixture({ terminalFactory: () => { throw new Error('SECRET'); } });
  f.view.open({ connectionRef: id, hostRef }); await tick(); await tick();
  assert.ok(f.calls.includes(`close:${key}`)); assert.doesNotMatch(f.doc.body.textContent, /SECRET/);
  assert.equal(f.doc.querySelector('[role=dialog]').getAttribute('aria-label'), 'Settings');
  assert.equal(authKeyName('paste token'), null); assert.equal(authKeyName('\x03'), 'interrupt');
  f.view.dispose(); f.window.close();
});
