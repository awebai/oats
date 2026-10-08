import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createContextPanel, contextPanelCSS } from '../renderer/context-panel.mjs';
import { remotePanel } from '../server/remote-roster.mjs';
import { kernelRemoteRow, kernelGoneRow, kernelRemoteGroup } from './helpers/kernel-remote-row.mjs';

const panelAPI = ['setContext', 'attach', 'release', 'toggle', 'setCollapsed', 'setFocusMode', 'toggleFocusMode', 'isFocusMode', 'dispose'];
const leaseAPI = ['setPresent', 'isVisible', 'collapse', 'dispose'];
function fixture(t) {
  // Inert DOM only: no scripts, server, bridge, native processes or resources.
  const dom = new JSDOM(`<!doctype html><body><div id="app">
    <aside id="sidebar"><input id="sidebar-input"></aside>
    <button id="sidebar-restore">Restore sidebar</button>
    <main id="main"><div id="tabbar"><button id="active-tab">dev-1</button><div id="tab-actions"><button id="split-right">Split</button></div></div>
      <div id="tabhost"><input id="terminal-input"></div></main>
    <aside id="context-panel"></aside>
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
    fallbackFocus: () => document.getElementById('active-tab'),
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
const instance = (home, extra = {}) => ({ instance: 'same-name', agent: 'dev', home, harness: 'pi', running: true, ...extra });

test('exact APIs, safe absent-host defaults, shell-owned root and no tab-bar toggle to project', t => {
  const inert = createContextPanel();
  assert.deepEqual(Object.keys(inert), panelAPI);
  assert.deepEqual(Object.keys(inert.attach()), leaseAPI);
  inert.setContext(); inert.toggle(); inert.toggleFocusMode(); inert.dispose();
  assert.equal(inert.isFocusMode(), false);
  const u = fixture(t);
  assert.deepEqual(Object.keys(u.panel), panelAPI);
  assert.equal(u.root.closest('#main, #tabhost'), null);
  assert.equal(u.root.hidden, true);
  // Spec F: the tab bar has no panel toggle; projection touches no control outside the panel.
  const outside = u.query('#tab-actions').outerHTML;
  u.select(instance('/A/one'));
  assert.equal(u.root.hidden, false); assert.equal(u.root.classList.contains('is-collapsed'), false);
  u.panel.toggle();
  assert.equal(u.root.classList.contains('is-collapsed'), true, 'panel.toggle collapses to the rail');
  assert.equal(u.panel.isFocusMode(), false);
  u.panel.toggle();
  assert.equal(u.root.classList.contains('is-collapsed'), false);
  assert.equal(u.query('#tab-actions').outerHTML, outside);
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
  const b = Object.freeze(instance('/A/two', { running: false, harness: null, model: null }));
  u.select(b, 'qualified-two');
  assert.equal(u.value('instance'), 'same-name');
  assert.equal(u.value('home'), '/A/two');
  assert.equal(u.value('running'), 'Stopped');
  assert.equal(u.value('model'), 'Not reported');
  assert.equal(u.value('description'), 'Not reported', 'no same-name metadata carryover');
  assert.equal(u.value('harness'), 'Not reported', 'never invent a harness');
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
  // Instance · Soul · Developer: Developer (tab id `git`) is last.
  assert.deepEqual([...u.root.querySelectorAll('[data-context-tab]')].map(t => [t.dataset.contextTab, t.textContent.trim()]), [['instance', 'Instance'], ['soul', 'Soul'], ['git', 'Developer']]);
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
  assert.equal(u.document.activeElement, u.query('#active-tab'), 'the hidden form\'s focus lands on the active tab');
  assert.equal(u.intents.length, count);
  lease.setPresent(true);
  assert.equal(u.root.hidden, true, 'late update does not exit focus mode');
  u.panel.setFocusMode(true); assert.deepEqual(u.modeCalls, [true], 'idempotent mode set');
  u.panel.toggleFocusMode();
  assert.equal(lease.isVisible(), true);
  assert.equal(u.root.querySelector('textarea'), form.input);
  assert.equal(form.input.value, 'focus mode draft'); assert.equal(form.submit.disabled, true);
  assert.equal(u.document.activeElement, u.query('#active-tab'), 'no auto-refocus of draft');
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
  assert.equal(u.document.activeElement, u.query('#active-tab'));
  u.panel.setFocusMode(false);
  u.query('#sidebar-restore').focus(); u.panel.setFocusMode(true);
  assert.equal(u.document.activeElement, u.query('#active-tab'));
  u.panel.setFocusMode(false);
  u.query('#terminal-input').focus();
  const count = u.focusCalls.length;
  u.panel.setFocusMode(true); u.panel.setFocusMode(false);
  assert.equal(u.document.activeElement, u.query('#terminal-input'));
  assert.equal(u.focusCalls.length, count);
  u.panel.setContext({ workspace: 'A', owner }); u.panel.attach(owner, form.element);
  form.input.focus(); u.panel.release(owner);
  assert.equal(u.document.activeElement, u.query('#active-tab'));
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
  u.query('#active-tab').remove();
  const minimal = createContextPanel({ root: u.root });
  minimal.setContext({ instance: instance('/minimal'), key: 'minimal' });
  minimal.setCollapsed(true); minimal.setFocusMode(true); minimal.dispose();
  assert.equal(u.root.hidden, true);
});

test('a Herdr-recorded instance: the footer shows Start disabled with the kernel reason, no Restart or Stop, and Retire stays available', t => {
  const u = fixture(t), reason = 'E_HERDR_REMOVED: Herdr is no longer supported by OATS (removed in 0.31.0); tmux is the only session backend.';
  u.select(instance('/A/h1', { running: null, runtimeState: 'unsupported', runtimeError: reason }));
  const control = op => u.query(`[data-lifecycle="${op}"]`);
  assert.equal(control('start').hidden, false); assert.equal(control('start').disabled, true); assert.equal(control('start').title, reason);
  assert.equal(control('restart').hidden, true); assert.equal(control('stop').hidden, true);
  assert.equal(control('retire').hidden, false); assert.equal(control('retire').disabled, false);
  u.select(instance('/A/t1', { running: false }));
  assert.equal(control('start').disabled, false); assert.equal(control('start').title, '', 'a tmux row carries no Herdr reason');
});

// #675 item 5: a remote row's work, build and drift facts as the kernel relays them (null when the host
// doesn't supply one); the repository from its own `repo`, never its repoName (the server's label).
const remoteRow = (extra = {}) => ({ instance: 'dev-r', agent: 'dev', home: '/srv/agents/dev/instances/dev-r', agentsRoot: '/srv/agents',
  server: 'build', repoName: 'Build box', addressable: true, running: true, harness: 'claude', model: 'opus',
  deployment: { id: 'remote:g1' }, ...extra });
const SIX = { work: 'worktree', repo: '/srv/code/northwind', branch: 'feat/remote', modelFrom: 'soul',
  soul: { status: 'moved' }, modules: [] };
const workParts = u => {
  const section = u.query('[data-context-work]').closest('.context-panel-section'), note = u.query('[data-context-work-note]');
  return { section, note, sentence: u.query('[data-context-work]'), chip: u.query('[data-context-drift]') };
};

test('a remote row with the six facts: the Work card (repository from repo, not the server label), model from, drift chip', t => {
  const u = fixture(t); u.select(remoteRow(SIX));
  const { section, note, sentence, chip } = workParts(u);
  assert.equal(section.hidden, false); assert.equal(note.hidden, true);
  assert.equal(sentence.textContent, 'Works in its own worktree of northwind, on branch feat/remote.');
  assert.doesNotMatch(sentence.textContent, /Build box/, 'never the server label');
  assert.equal(u.query('.context-panel-mode-tile').dataset.work, 'worktree');
  assert.equal(u.value('modelFrom'), "the soul's choice"); assert.equal(u.query('[data-context-field="modelFrom"]').hidden, false);
  assert.equal(chip.hidden, false); assert.match(chip.title, /Its soul's repository has moved on/);
  // A trailing slash or a bare name still names the repository's last segment.
  u.select(remoteRow({ ...SIX, repo: '/srv/code/northwind/', soul: { status: 'current' } }));
  assert.equal(sentence.textContent, 'Works in its own worktree of northwind, on branch feat/remote.');
  assert.equal(chip.hidden, true, 'a current soul: no chip');
  // repo null (the host doesn't supply it): the generic words, never the server label.
  u.select(remoteRow({ ...SIX, repo: null }));
  assert.equal(sentence.textContent, "Works in its own worktree of its soul's repository, on branch feat/remote.");
});

test('a remote row whose host reports the keys as null: "<Server> doesn\'t report…", no Work card, no chip, no wrong value', t => {
  const u = fixture(t);
  u.select(remoteRow({ work: null, repo: null, branch: null, modelFrom: null, soul: null, modules: null }));
  const { section, note, chip } = workParts(u);
  assert.equal(section.hidden, true, 'no Work card');
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, "Build box doesn't report this instance's work and build. Update OATS on Build box.");
  assert.equal(note.className, 'context-panel-note context-panel-work-note');
  assert.equal(note.previousElementSibling, section, "in the Work section's place");
  assert.equal(chip.hidden, true); assert.equal(u.query('[data-context-field="modelFrom"]').hidden, true);
  // The label is one display line (a line break folds); a withheld label reads "the server".
  u.select(remoteRow({ work: null, repoName: 'Build\nbox' }));
  assert.equal(note.textContent, "Build box doesn't report this instance's work and build. Update OATS on Build box.");
  u.select(remoteRow({ work: null, repoName: 'box\x07bell' }));
  assert.equal(note.textContent, "The server doesn't report this instance's work and build. Update OATS on the server.");
});

test('a remote row without the keys (this computer\'s OATS predates the relay): "This computer\'s OATS…"', t => {
  const u = fixture(t); u.select(remoteRow());
  const { section, note, chip } = workParts(u);
  assert.equal(section.hidden, true);
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, "This computer's OATS doesn't show the work and build of instances on Build box. Update OATS here.");
  assert.equal(chip.hidden, true);
  // Unchanged words on a repaint: no write.
  const observer = new u.dom.window.MutationObserver(() => {}); observer.observe(note, { childList: true, subtree: true, characterData: true });
  u.select(remoteRow({ running: false }));
  assert.equal(observer.takeRecords().length, 0); observer.disconnect();
  // The server id stands in for an empty label.
  u.select(remoteRow({ repoName: '' }));
  assert.equal(note.textContent, "This computer's OATS doesn't show the work and build of instances on build. Update OATS here.");
});

test('a local row: unchanged — repoName in the sentence, never the remote note', t => {
  const u = fixture(t);
  u.select(instance('/A/one', { work: 'worktree', repoName: 'northwind', repo: '/elsewhere/other', branch: 'main' }));
  const { section, note } = workParts(u);
  assert.equal(section.hidden, false); assert.equal(note.hidden, true); assert.equal(note.textContent, '');
  assert.equal(u.query('[data-context-work]').textContent, 'Works in its own worktree of northwind, on branch main.');
  for (const extra of [{}, { work: null }, { work: undefined }]) {
    u.select(instance('/A/two', extra));
    assert.equal(section.hidden, true); assert.equal(note.hidden, true, JSON.stringify(extra));
  }
  // Switching from a remote row to a local one clears the note.
  u.select(remoteRow()); assert.equal(note.hidden, false);
  u.select(instance('/A/three', { work: 'directory' })); assert.equal(note.hidden, true); assert.equal(section.hidden, false);
});

// The kernel's own row shape (helpers/kernel-remote-row.mjs: every REMOTE_ROW_FACTS key, null unless the host
// reported it) through the shipped remotePanel projection, not a hand-built row.
const kernelRows = (instances, extra) => remotePanel(kernelRemoteGroup(instances, extra)).instances
  .map(row => ({ ...row, deployment: { id: 'remote:host' } }));

test('kernel-shaped remote rows: a listed row whose host reports null says "doesn\'t report"; saved-route rows say why instead, never "Update OATS on…"', t => {
  const u = fixture(t);
  const { section, note } = workParts(u);
  const [listed] = kernelRows([kernelRemoteRow()]);
  assert.ok(Object.hasOwn(listed, 'work') && listed.work === null, 'the kernel relays the key, null');
  u.select(listed);
  assert.equal(section.hidden, true);
  assert.equal(note.textContent, "Build server doesn't report this instance's work and build. Update OATS on Build server.");
  // A saved route the host no longer lists: the forget sentence.
  const [gone] = kernelRows([kernelGoneRow()]);
  u.select(gone);
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, 'dev-gone is no longer on Build server. Remove it from this computer with: oats server forget host --instance dev-gone');
  // A group whose last roster read failed: its rows are last-known, the server unreached.
  const [unreached] = kernelRows([kernelRemoteRow()], { probe: { ok: false, error: { code: 'E_SSH', message: 'ssh: timeout' } } });
  assert.equal(unreached.serverUnreached, true);
  u.select(unreached);
  assert.equal(note.textContent, "Build server wasn't reached, so this instance's work and build aren't known.");
  assert.equal(section.hidden, true);
  for (const row of [gone, unreached]) { u.select(row); assert.doesNotMatch(note.textContent, /Update OATS on/); }
  // A withheld label reads "The server" here too.
  const [hidden] = kernelRows([kernelRemoteRow()], { label: 'box\x07bell', probe: { ok: false, error: { code: 'E_SSH', message: 'x' } } });
  u.select(hidden);
  assert.equal(note.textContent, "The server wasn't reached, so this instance's work and build aren't known.");
  // Last-known facts on an unreached row stay as they were read: the Work card, no note.
  const [known] = kernelRows([kernelRemoteRow('dev-one', { work: 'worktree', repo: '/srv/code/northwind', branch: 'main' })], { probe: { ok: false, error: { code: 'E_SSH', message: 'x' } } });
  u.select(known);
  assert.equal(section.hidden, false); assert.equal(note.hidden, true);
});

test('#802: a held home: a spawning one shows no lifecycle control, a quarantined one Retire only', t => {
  const u = fixture(t), control = op => u.query(`[data-lifecycle="${op}"]`);
  const shown = () => ['restart', 'start', 'stop', 'retire'].filter(op => !control(op).hidden);
  u.select(instance('/A/s1', { running: false, spawnInProgress: true }));
  assert.deepEqual(shown(), [], 'setting up its worktree: no Start, Stop or Retire');
  u.select(instance('/A/q1', { running: false, rollbackIncomplete: true }));
  assert.deepEqual(shown(), ['retire'], "a spawn that didn't finish: Retire only");
  u.select(instance('/A/q2', { running: true, retirePending: true }));
  assert.deepEqual(shown(), ['retire'], "a retire that didn't finish: Retire only, even with a live session");
  u.select(instance('/A/q3', { running: false, spawnInProgress: true, rollbackIncomplete: true }));
  assert.deepEqual(shown(), ['retire'], 'rollbackIncomplete wins');
  u.select(instance('/A/t1', { running: false }));
  assert.deepEqual(shown(), ['start', 'retire'], 'an ordinary stopped row is unchanged');
});
