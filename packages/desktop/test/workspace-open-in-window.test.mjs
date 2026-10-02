// One Desktop window per workspace (#481): the switcher's Open in new window action and the window
// that has no workspace yet. Each workspace option has a trailing button OUTSIDE the option, labelled
// "Open <label> in a new window" (aria-label and tooltip), reached with ArrowRight from its option and
// left with ArrowLeft or Escape; ⌘Enter (macOS) / Ctrl+Enter on the option does the same, and the
// option's aria-describedby hint says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createWorkspaceSwitcher } from '../renderer/workspace-switcher.mjs';

const html = readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
const A = { id: 'ws:aaaaaaaaaaaaaaaaaaaa', name: 'oats', machines: ['This Mac'] };
const B = { id: 'ws:bbbbbbbbbbbbbbbbbbbb', name: 'tsm', machines: ['This Mac', 'altair'] };
const LOOSE = { id: 'remote:rigel:/x', name: 'rigel', unattached: true, deployments: ['remote:rigel:/x'], machines: ['rigel'], short: 'Not reached' };

function setup({ mac = true, openInNewWindow = true } = {}) {
  const dom = new JSDOM(html, { url: 'file:///renderer/index.html' });
  const document = dom.window.document, selected = [], opened = [];
  const controller = createWorkspaceSwitcher({ document, mac,
    selectWorkspace: (id) => selected.push(id), discoverSuggestions: async () => [],
    addWorkspace: async () => ({ ok: false }), pickWorkspace: async () => ({ ok: false, code: 'cancelled' }),
    ...(openInNewWindow ? { openInNewWindow: (id) => opened.push(id) } : {}) });
  controller.begin()(A, [A, B, LOOSE]);
  document.getElementById('ws-trigger').click();
  const key = (el, init) => el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  return { dom, document, controller, selected, opened, key };
}
const option = (document, id) => document.querySelector(`.ws-option[data-workspace-id="${id}"]`);
const action = (document, id) => document.querySelector(`.ws-open-window[data-workspace-id="${id}"]`);

test('every option has its Open in new window button, outside the option, labelled for assistive technology', () => {
  const { document } = setup();
  for (const [choice, label] of [[A, 'oats'], [B, 'tsm'], [LOOSE, 'rigel']]) {
    const button = action(document, choice.id), opt = option(document, choice.id);
    assert.ok(button, choice.id); assert.equal(button.tagName, 'BUTTON'); assert.equal(button.type, 'button');
    assert.equal(opt.contains(button), false, 'never nested inside the option');
    assert.equal(button.getAttribute('aria-label'), `Open ${label} in a new window`);
    assert.equal(button.title, `Open ${label} in a new window`);
    assert.equal(button.tabIndex, -1, 'reached with ArrowRight, not a second Tab stop per row');
    assert.equal(button.querySelector('svg').getAttribute('aria-hidden'), 'true');
  }
});

test('the option says how to reach the action (aria-describedby hint, platform chord)', () => {
  for (const [mac, chord] of [[true, '⌘Enter'], [false, 'Ctrl+Enter']]) {
    const { document } = setup({ mac });
    const hintId = option(document, A.id).getAttribute('aria-describedby');
    assert.ok(hintId);
    const hint = document.getElementById(hintId);
    assert.ok(hint, 'the hint exists in the document');
    assert.match(hint.textContent, new RegExp(`${chord.replace('+', '\\+')}.*new window`, 'i'));
    assert.match(hint.textContent, /Right Arrow/);
    assert.equal(option(document, B.id).getAttribute('aria-describedby'), hintId, 'one shared hint');
  }
});

test('clicking the button opens that workspace in a new window, never selecting it here', () => {
  const { document, selected, opened } = setup();
  action(document, B.id).click();
  assert.deepEqual(opened, [B.id]); assert.deepEqual(selected, []);
  assert.equal(document.getElementById('ws-menu').hidden, true, 'the menu closes');
});

test('ArrowRight moves to the option\'s button; ArrowLeft and Escape return to the option; Enter activates it', () => {
  const { document, key, opened } = setup();
  option(document, B.id).focus();
  key(option(document, B.id), { key: 'ArrowRight' });
  assert.equal(document.activeElement, action(document, B.id));
  key(document.activeElement, { key: 'ArrowLeft' });
  assert.equal(document.activeElement, option(document, B.id));
  key(option(document, B.id), { key: 'ArrowRight' });
  key(document.activeElement, { key: 'Escape' });
  assert.equal(document.activeElement, option(document, B.id), 'Escape on the button returns to its option');
  assert.equal(document.getElementById('ws-menu').hidden, false, '…without closing the menu');
  key(option(document, B.id), { key: 'ArrowRight' });
  document.activeElement.click(); // a native button: Enter and Space click it
  assert.deepEqual(opened, [B.id]);
});

test('ArrowDown and ArrowUp from a button move between options, as from the option', () => {
  const { document, key } = setup();
  option(document, A.id).focus();
  key(option(document, A.id), { key: 'ArrowRight' });
  key(document.activeElement, { key: 'ArrowDown' });
  assert.equal(document.activeElement, option(document, B.id));
});

test('⌘Enter on macOS, Ctrl+Enter elsewhere, on an option opens it in a new window; plain Enter still selects', () => {
  for (const [mac, chord] of [[true, { metaKey: true }], [false, { ctrlKey: true }]]) {
    const { document, key, opened, selected } = setup({ mac });
    option(document, B.id).focus();
    assert.equal(key(option(document, B.id), { key: 'Enter', ...chord }), false, 'consumed');
    assert.deepEqual(opened, [B.id]); assert.deepEqual(selected, []);
    const other = mac ? { ctrlKey: true } : { metaKey: true };
    key(option(document, A.id), { key: 'Enter', ...other });
    assert.deepEqual(opened, [B.id], 'the other platform\'s chord does nothing');
  }
});

test('without a window bridge (the browser harness) there is no action and no hint', () => {
  const { document } = setup({ openInNewWindow: false });
  assert.equal(document.querySelector('.ws-open-window'), null);
  assert.equal(option(document, A.id).hasAttribute('aria-describedby'), false);
});

test('a window with no workspace: the trigger asks to choose one, the choices come from main, none is selected', () => {
  const { document, controller } = setup();
  controller.choose([A, B]);
  assert.equal(document.getElementById('ws-name').textContent, 'Choose a workspace');
  assert.equal(document.getElementById('ws-trigger').title, 'This window has no workspace yet');
  document.getElementById('ws-trigger').click(); document.getElementById('ws-trigger').click();
  const options = [...document.querySelectorAll('.ws-option')];
  assert.deepEqual(options.map((o) => o.dataset.workspaceId), [A.id, B.id]);
  assert.ok(options.every((o) => o.getAttribute('aria-selected') === 'false'));
});
