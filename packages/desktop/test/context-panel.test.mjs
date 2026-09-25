import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createContextPanel, contextPanelCSS } from '../renderer/context-panel.mjs';

const panelAPI = ['setContext', 'attach', 'release', 'toggle', 'setCollapsed', 'setFocusMode', 'toggleFocusMode', 'isFocusMode', 'dispose'];
const leaseAPI = ['setPresent', 'isVisible', 'collapse', 'dispose'];
function fixture(t) {
  // Inert DOM only: no scripts, server, bridge, native processes or resources.
  const dom = new JSDOM(`<!doctype html><body><div id="app">
    <aside id="sidebar"><input id="sidebar-input"></aside>
    <button id="sidebar-restore">Restore sidebar</button>
    <main id="main"><div id="tabhost"><input id="terminal-input"></div></main>
    <aside id="context-panel"></aside>
    <footer><button id="panel-toggle">Panel</button><button id="focus-mode-toggle">Focus mode</button></footer>
  </div></body>`);
  const document = dom.window.document;
  const style = document.createElement('style');
  // The parent owns these shell rules; they are only a fixture for focus tests.
  style.textContent = `${contextPanelCSS}
    #app.focus-mode #sidebar, #app.focus-mode #sidebar-restore { display:none; }`;
  document.head.append(style);
  const root = document.getElementById('context-panel');
  const intents = [], focusCalls = [], modeCalls = [];
  let applying = false;
  const panel = createContextPanel({ document, root,
    onIntent: event => { assert.equal(applying, false, 'projected focus cannot mint intent'); intents.push(event.type); },
    applyFocus: callback => { applying = true; focusCalls.push('apply'); try { return callback(); } finally { applying = false; } },
    onFocusModeChange: value => modeCalls.push(value),
  });
  t.after(() => { panel.dispose(); dom.window.close(); });
  const query = selector => document.querySelector(selector);
  const tab = id => query(`[data-context-tab="${id}"]`);
  const value = id => query(`[data-context-field="${id}"]`).textContent;
  const select = (instance, key = instance?.home, workspace = 'A') => panel.setContext({ workspace, instance, key });
  const stage = () => {
    const element = document.createElement('section');
    const header = document.createElement('header'); header.textContent = 'Existing stage header';
    const close = document.createElement('button'); close.textContent = 'Existing close'; header.append(close);
    const form = document.createElement('form');
    const input = document.createElement('textarea'); input.value = 'original draft';
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Save';
    const status = document.createElement('p'); status.textContent = 'Pending';
    form.append(input, submit, status); element.append(header, form);
    return { element, header, form, input, submit, status };
  };
  return { dom, document, root, panel, query, tab, value, select, stage, intents, focusCalls, modeCalls };
}
const instance = (home, extra = {}) => ({ instance: 'same-name', agent: 'dev', home, runtime: 'pi', running: true, ...extra });

test('exact APIs, safe absent-host defaults, shell-owned root and no footer click binding', t => {
  const inert = createContextPanel();
  assert.deepEqual(Object.keys(inert), panelAPI);
  assert.deepEqual(Object.keys(inert.attach()), leaseAPI);
  inert.setContext(); inert.toggle(); inert.toggleFocusMode(); inert.dispose();
  assert.equal(inert.isFocusMode(), false);
  const u = fixture(t);
  assert.deepEqual(Object.keys(u.panel), panelAPI);
  assert.equal(u.root.closest('#main, #tabhost'), null);
  assert.equal(u.root.hidden, true);
  assert.equal(u.query('#panel-toggle').disabled, true);
  assert.equal(u.query('#panel-toggle').getAttribute('aria-expanded'), 'false');
  u.select(instance('/A/one'));
  u.query('#panel-toggle').click(); u.query('#focus-mode-toggle').click();
  assert.equal(u.root.classList.contains('is-collapsed'), false, 'parent binds registry clicks');
  assert.equal(u.panel.isFocusMode(), false);
  assert.equal(u.query('#panel-toggle').disabled, false);
  assert.equal(u.query('#panel-toggle').getAttribute('aria-expanded'), 'true');
});

test('attach never selects; replacement invalidates old leases without disposing content', t => {
  const u = fixture(t), owner = Object.freeze({}), first = u.stage(), second = u.stage();
  u.select(instance('/A/terminal'));
  const old = u.panel.attach(owner, first.element);
  assert.deepEqual(Object.keys(old), leaseAPI);
  assert.equal(old.isVisible(), false);
  assert.equal(u.query('.context-panel-generic').hidden, false, 'foreground remains terminal');
  u.panel.setContext({ workspace: 'A', owner });
  assert.equal(old.isVisible(), true);
  assert.equal(first.element.closest('.oats-view')?.classList.contains('context-panel-stage'), true);
  assert.equal(u.query('.context-panel-generic').hidden, true, 'no duplicate generic header or close');
  assert.equal(u.root.querySelector('.context-panel-stage header'), first.header, 'real existing header');
  const replacement = u.panel.attach(owner, second.element);
  old.setPresent(false); old.collapse(); old.dispose();
  assert.equal(replacement.isVisible(), true);
  assert.equal(old.isVisible(), false);
  assert.equal(first.element.isConnected, false);
  assert.equal(first.input.value, 'original draft', 'release detaches, never clears nested forms');
  assert.equal(second.element.isConnected, true);
  u.panel.release(owner);
  assert.equal(replacement.isVisible(), false);
  assert.equal(u.root.hidden, true);
  replacement.setPresent(true);
  assert.equal(u.root.hidden, true);
});

test('hidden stage present changes cannot claim foreground or collapse a different owner', t => {
  const u = fixture(t), a = {}, b = {}, formA = u.stage(), formB = u.stage();
  u.panel.setContext({ workspace: 'A' });
  const leaseA = u.panel.attach(a, formA.element), leaseB = u.panel.attach(b, formB.element);
  assert.equal(u.root.hidden, true, 'attachments do not select');
  u.panel.setContext({ workspace: 'A', owner: b });
  leaseA.setPresent(false); leaseA.setPresent(true); leaseA.collapse();
  assert.equal(leaseA.isVisible(), false);
  assert.equal(leaseB.isVisible(), true);
  assert.equal(formA.element.parentElement.hidden, true);
  u.panel.setContext({ workspace: 'A', owner: a });
  assert.equal(leaseA.isVisible(), true, 'hidden stage can prepare presence without selecting');
  leaseA.setPresent(false);
  assert.equal(u.root.hidden, true, 'no other live slot becomes fallback selection');
  assert.equal(u.query('#panel-toggle').disabled, true);
  u.panel.setContext({ workspace: 'A', owner: b, instance: instance('/A/ignored'), key: 'ignored' });
  assert.equal(leaseB.isVisible(), true, 'owner selection takes precedence over terminal context');
  u.panel.setContext({ workspace: 'A', owner: {} });
  assert.equal(u.root.hidden, true, 'unknown owner never falls back to a previous owner');
  u.select(instance('/A/terminal'));
  leaseA.setPresent(true);
  assert.equal(leaseA.isVisible(), false);
  assert.equal(u.value('home'), '/A/terminal');
});

test('collapsed stage retains form identity, pending completion and listeners', async t => {
  const u = fixture(t), owner = {}, form = u.stage();
  u.panel.setContext({ workspace: 'A', owner });
  const lease = u.panel.attach(owner, form.element);
  let submits = 0, finish;
  form.form.addEventListener('submit', event => { event.preventDefault(); submits++; });
  const pending = new Promise(resolve => { finish = resolve; }).then(text => {
    form.status.textContent = text; form.submit.disabled = false; lease.setPresent(true);
  });
  form.input.value = 'unsubmitted\ntext'; form.submit.disabled = true; form.input.focus();
  const intents = u.intents.length;
  lease.collapse();
  assert.equal(lease.isVisible(), false);
  assert.equal(form.element.isConnected, true, 'collapse parks DOM rather than detaching it');
  assert.equal(u.document.activeElement, u.query('.context-panel-expand'));
  assert.equal(u.intents.length, intents, 'recovery focus is projection, not entry intent');
  assert.equal(u.focusCalls.length, 1);
  assert.equal(u.query('#panel-toggle').getAttribute('aria-expanded'), 'false');
  finish('Saved by pending operation'); await pending;
  assert.equal(u.root.classList.contains('is-collapsed'), true, 'late presence is not auto-expand');
  u.query('#terminal-input').focus();
  u.query('.context-panel-expand').click();
  assert.equal(lease.isVisible(), true);
  assert.equal(u.root.querySelector('textarea'), form.input);
  assert.equal(form.input.value, 'unsubmitted\ntext');
  assert.equal(form.status.textContent, 'Saved by pending operation');
  assert.equal(u.document.activeElement, u.query('#terminal-input'), 'expansion cannot steal unrelated focus');
  form.submit.click(); assert.equal(submits, 1);
});

test('workspace A → B → A clears presence synchronously; reuse renews lease and retains DOM', t => {
  const u = fixture(t), owner = {}, form = u.stage();
  u.panel.setContext({ workspace: 'A', owner });
  const old = u.panel.attach(owner, form.element);
  form.input.value = 'draft survives workspace';
  u.panel.setCollapsed(true);
  u.panel.setContext({ workspace: 'B', owner });
  assert.equal(u.root.hidden, true);
  assert.equal(form.element.parentElement.hidden, true);
  old.setPresent(true);
  assert.equal(u.root.hidden, true, 'A completion cannot show in B');
  u.select(instance('/B/one'), 'b-key', 'B');
  assert.equal(u.root.classList.contains('is-collapsed'), false, 'B starts with independent preference');
  u.panel.setContext({ workspace: 'A', owner });
  assert.equal(u.root.hidden, true, 'returning to A does not resurrect stale presence');
  old.setPresent(true); old.collapse();
  assert.equal(u.root.hidden, true, 'old A epoch is still stale after return');
  const wrapper = form.element.parentElement;
  const fresh = u.panel.attach(owner, form.element);
  assert.equal(form.element.parentElement, wrapper, 'renewal does not rebuild the styling wrapper');
  assert.equal(form.input.value, 'draft survives workspace');
  old.dispose(); old.setPresent(false);
  assert.equal(form.element.isConnected, true, 'stale disposal cannot remove renewed slot');
  assert.equal(u.root.hidden, false);
  assert.equal(u.root.classList.contains('is-collapsed'), true, 'A collapse preference survives');
  u.panel.toggle(); assert.equal(fresh.isVisible(), true);
});

test('moving one real element to a new owner invalidates its former lease', t => {
  const u = fixture(t), first = {}, next = {}, form = u.stage();
  u.panel.setContext({ workspace: 'A', owner: first });
  const old = u.panel.attach(first, form.element);
  const moved = u.panel.attach(next, form.element);
  assert.equal(u.root.hidden, true, 'move does not select next owner');
  assert.equal(moved.isVisible(), false);
  old.dispose(); old.setPresent(true);
  u.panel.setContext({ workspace: 'A', owner: next });
  assert.equal(moved.isVisible(), true);
  assert.equal(u.root.querySelector('textarea'), form.input);
  assert.equal(u.root.querySelectorAll('.context-panel-stage').length, 1);
});

test('same-name instances use the exact supplied selection; reported text is inert and missing data stays unknown', t => {
  const u = fixture(t), unsafe = '<img src=x onerror="throw 1">';
  const a = Object.freeze(instance('/A/one', { model: unsafe, description: unsafe, work: 'worktree', agentsRoot: '/A/agents' }));
  u.select(a, 'qualified-one');
  assert.equal(u.value('model'), unsafe);
  assert.equal(u.value('description'), unsafe);
  assert.equal(u.root.querySelector('img'), null);
  const b = Object.freeze(instance('/A/two', { running: false, runtime: null, model: null }));
  u.select(b, 'qualified-two');
  assert.equal(u.value('instance'), 'same-name');
  assert.equal(u.value('home'), '/A/two');
  assert.equal(u.value('running'), 'Stopped');
  assert.equal(u.value('model'), 'Not reported');
  assert.equal(u.value('description'), 'Not reported', 'no same-name metadata carryover');
  assert.equal(u.value('runtime'), 'Not reported', 'never invent a runtime');
  u.panel.setContext({ workspace: 'A', key: 'key-only' });
  assert.equal(u.root.hidden, false);
  assert.equal(u.value('home'), 'Not reported', 'key-only selection cannot retain last instance');
  assert.equal(u.value('running'), 'Not reported');
  u.tab('git').click();
  const diagnostic = u.query('[data-context-page="git"]').textContent;
  assert.match(diagnostic, /Integration unavailable.*K1/);
  assert.doesNotMatch(diagnostic, /\b0\b|clean|up.to.date/i);
  assert.equal(u.root.querySelector('[data-mutate], a, input, select, textarea'), null);
  u.panel.setContext({ workspace: 'A' }); assert.equal(u.root.hidden, true);
});

test('same-key polling updates values without recreating controls, stealing focus or minting intent', t => {
  const u = fixture(t);
  u.select(instance('/A/one', { model: 'old' }), 'one');
  const controls = [...u.root.querySelectorAll('button')], model = u.query('[data-context-field="model"]');
  u.tab('soul').focus();
  const count = u.intents.length;
  for (const next of ['new', 'new', 'latest']) u.select(instance('/A/one', { model: next }), 'one');
  assert.deepEqual([...u.root.querySelectorAll('button')], controls);
  assert.equal(u.query('[data-context-field="model"]'), model);
  assert.equal(model.textContent, 'latest');
  assert.equal(u.document.activeElement, u.tab('soul'));
  assert.equal(u.intents.length, count);
  assert.equal(u.focusCalls.length, 0);
  u.query('#terminal-input').focus();
  u.select(instance('/A/two'), 'two');
  assert.equal(u.document.activeElement, u.query('#terminal-input'));
  assert.equal(u.focusCalls.length, 0, 'even a new selection is focus-neutral outside its panel');
  u.tab('instance').dispatchEvent(new u.dom.window.Event('pointerdown', { bubbles: true }));
  u.tab('instance').focus();
  assert.deepEqual(u.intents.slice(count), ['pointerdown', 'focusin'], 'native entry forwards intent');
});

test('collapsed tab preferences are workspace-local; keyboard navigation keeps ARIA and focus aligned', t => {
  const u = fixture(t);
  u.select(instance('/A/one'));
  u.tab('instance').focus();
  // Instance · Soul · Git & GitHub: Git is last.
  assert.deepEqual([...u.root.querySelectorAll('[data-context-tab]')].map(t => t.dataset.contextTab), ['instance', 'soul', 'git']);
  u.tab('instance').dispatchEvent(new u.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(u.document.activeElement, u.tab('soul'));
  u.tab('soul').dispatchEvent(new u.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(u.document.activeElement, u.tab('git'));
  assert.equal(u.tab('git').getAttribute('aria-selected'), 'true');
  assert.equal(u.tab('git').tabIndex, 0);
  assert.equal(u.tab('instance').tabIndex, -1);
  assert.equal(u.query('[data-context-page="instance"]').hidden, true);
  assert.equal(u.query('[data-context-page="git"]').hidden, false);
  const count = u.intents.length;
  u.panel.setCollapsed(true);
  assert.equal(u.document.activeElement, u.query('.context-panel-expand'));
  assert.equal(u.intents.length, count);
  assert.equal(u.query('.context-panel-expand').tagName, 'BUTTON', 'native keyboard-expand control');
  u.select(instance('/A/one', { running: false }));
  assert.equal(u.tab('git').getAttribute('aria-selected'), 'true');
  u.select(instance('/B/one'), 'b', 'B');
  assert.equal(u.root.classList.contains('is-collapsed'), false);
  assert.equal(u.tab('instance').getAttribute('aria-selected'), 'true');
  u.tab('soul').click();
  u.select(instance('/A/one'));
  assert.equal(u.root.classList.contains('is-collapsed'), true);
  assert.equal(u.tab('git').getAttribute('aria-selected'), 'true');
  u.panel.toggle(); assert.equal(u.query('[data-context-page="git"]').hidden, false);
  u.select(instance('/B/one'), 'b', 'B');
  assert.equal(u.tab('soul').getAttribute('aria-selected'), 'true');
});

test('focus mode hides panel/sidebar rails, preserves preferences and stage form, and restores no content focus', t => {
  const u = fixture(t), owner = {}, form = u.stage();
  u.query('#app').classList.add('sidebar-hidden');
  u.panel.setContext({ workspace: 'A', owner });
  const lease = u.panel.attach(owner, form.element);
  form.input.value = 'focus mode draft'; form.submit.disabled = true;
  form.input.focus(); const count = u.intents.length;
  u.panel.toggleFocusMode();
  assert.equal(u.panel.isFocusMode(), true);
  assert.equal(u.root.hidden, true);
  assert.equal(lease.isVisible(), false);
  assert.equal(u.query('#app').classList.contains('focus-mode'), true);
  assert.equal(u.query('#app').classList.contains('sidebar-hidden'), true, 'sidebar preference untouched');
  assert.equal(u.query('#panel-toggle').disabled, true);
  assert.equal(u.query('#panel-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(u.query('#focus-mode-toggle').getAttribute('aria-pressed'), 'true');
  assert.equal(u.query('#focus-mode-toggle').textContent, 'Exit focus mode');
  assert.equal(u.document.activeElement, u.query('#focus-mode-toggle'));
  assert.equal(u.intents.length, count);
  lease.setPresent(true);
  assert.equal(u.root.hidden, true, 'late update does not exit focus mode');
  u.panel.setFocusMode(true); assert.deepEqual(u.modeCalls, [true], 'idempotent mode set');
  u.panel.toggleFocusMode();
  assert.equal(lease.isVisible(), true);
  assert.equal(u.root.querySelector('textarea'), form.input);
  assert.equal(form.input.value, 'focus mode draft'); assert.equal(form.submit.disabled, true);
  assert.equal(u.document.activeElement, u.query('#focus-mode-toggle'), 'no auto-refocus of draft');
  assert.equal(u.query('#focus-mode-toggle').getAttribute('aria-pressed'), 'false');
  assert.equal(u.query('#focus-mode-toggle').textContent, 'Focus mode');
  u.panel.setCollapsed(true); u.query('.context-panel-expand').focus();
  u.panel.setFocusMode(true); u.panel.setFocusMode(false);
  assert.equal(u.root.classList.contains('is-collapsed'), true, 'collapsed panel remains collapsed after mode');
  assert.equal(u.query('.context-panel-rail').hidden, false);
  assert.equal(u.query('#app').classList.contains('sidebar-hidden'), true);
  assert.deepEqual(u.modeCalls, [true, false, true, false]);
});

test('focus recovery is limited to containers hidden by this transition, including sidebar and detached slots', t => {
  const u = fixture(t), owner = {}, form = u.stage();
  u.query('#sidebar-input').focus();
  u.panel.setFocusMode(true);
  assert.equal(u.document.activeElement, u.query('#focus-mode-toggle'));
  u.panel.setFocusMode(false);
  u.query('#sidebar-restore').focus(); u.panel.setFocusMode(true);
  assert.equal(u.document.activeElement, u.query('#focus-mode-toggle'));
  u.panel.setFocusMode(false);
  u.query('#terminal-input').focus();
  const count = u.focusCalls.length;
  u.panel.setFocusMode(true); u.panel.setFocusMode(false);
  assert.equal(u.document.activeElement, u.query('#terminal-input'));
  assert.equal(u.focusCalls.length, count);
  u.panel.setContext({ workspace: 'A', owner }); u.panel.attach(owner, form.element);
  form.input.focus(); u.panel.release(owner);
  assert.equal(u.document.activeElement, u.query('#focus-mode-toggle'));
  assert.equal(u.focusCalls.length, count + 1, 'removal recovers only its own focused container');
});

test('dispose releases only component DOM and listeners; missing shell controls remain safe', t => {
  const u = fixture(t), owner = {}, form = u.stage();
  u.panel.setContext({ workspace: 'A', owner }); const lease = u.panel.attach(owner, form.element);
  u.panel.setFocusMode(true); u.panel.dispose();
  assert.equal(u.root.isConnected, true, 'aside remains shell-owned');
  assert.equal(u.root.hidden, true); assert.equal(u.root.children.length, 0);
  assert.equal(form.input.value, 'original draft');
  assert.equal(u.query('#app').classList.contains('focus-mode'), false);
  assert.equal(u.panel.isFocusMode(), false);
  assert.deepEqual(u.modeCalls, [true, false]);
  const count = u.intents.length;
  lease.dispose(); lease.setPresent(true); lease.collapse();
  u.panel.setContext({ workspace: 'B', owner }); u.panel.toggleFocusMode(); u.panel.dispose();
  u.root.dispatchEvent(new u.dom.window.Event('pointerdown', { bubbles: true }));
  assert.equal(lease.isVisible(), false); assert.equal(u.intents.length, count);
  assert.equal(u.root.children.length, 0);
  u.query('#panel-toggle').remove(); u.query('#focus-mode-toggle').remove();
  const minimal = createContextPanel({ root: u.root });
  minimal.setContext({ instance: instance('/minimal'), key: 'minimal' });
  minimal.setCollapsed(true); minimal.setFocusMode(true); minimal.dispose();
  assert.equal(u.root.hidden, true);
});
