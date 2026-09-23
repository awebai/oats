import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { registerAction, setActiveContexts, getBinding, formatChord, setBinding, resetBinding, runAction, handleKeydown, onKeymapChange } from '../renderer/keybindings.mjs';
import { instanceActions, captureInstanceActionMenu } from "../renderer/instance-actions.mjs";
import { cliRetire, parseRetireEnvelope } from "../cli-adapter.mjs";

// jsdom has no top-layer API. Model only its open/close events here; native
// light-dismiss and rendering are Chromium's behavior, not this test's claim.
function menuDom() {
  const dom = new JSDOM("<body></body>", { pretendToBeVisual: true });
  for (const [method, newState] of [["showPopover", "open"], ["hidePopover", "closed"]]) {
    dom.window.HTMLElement.prototype[method] = function () {
      const event = new dom.window.Event("beforetoggle");
      Object.defineProperty(event, "newState", { value: newState });
      this.dispatchEvent(event);
      if (newState === "open") this.querySelector("[autofocus]")?.focus();
    };
  }
  const click = dom.window.HTMLButtonElement.prototype.click;
  dom.window.HTMLButtonElement.prototype.click = function () {
    click.call(this);
    const target = this.popoverTargetElement;
    if (!this.disabled && target) target[target.dataset.instanceMenuOpen === "true" ? "hidePopover" : "showPopover"]();
  };
  return dom;
}
const triggerOf = (control) => control.querySelector(".ctx-instance-actions");
const choose = async (control, action) => {
  control.querySelector(`[data-action="${action}"]`).click();
  await new Promise((r) => setImmediate(r));
};

test("instance actions keep full identity and open plan dialogs, never dispatch unguarded stop/retire", async () => {
  const dom = menuDom();
  const instance = { instance: "dev-one", home: "/remote/home", server: "host", savedRoute: true };
  const calls = [], dialogs = [];
  const select = instanceActions(dom.window.document, instance, {
    invoke: async (...args) => { calls.push(args); return {}; },
    openLifecycle: (...args) => dialogs.push(args), done: () => {}, report: (m) => assert.fail(m),
  });
  dom.window.document.body.append(select);
  await choose(select, "retire"); assert.equal(calls.length, 0);
  await choose(select, "inspect"); assert.deepEqual(calls[0], ["inspect", instance]);
  await choose(select, 'stop'); assert.deepEqual(dialogs, [['retire', instance], ['stop', instance]]);
  assert.equal(calls.length, 1);
  select.remove(); await choose(select, 'retire'); assert.equal(dialogs.length, 2, 'detached old controls are revoked');
  assert.equal(triggerOf(select).disabled, false);
  assert.equal(triggerOf(instanceActions(dom.window.document, { ...instance, savedRoute: false }, {})).disabled, true);
  dom.window.close();
});

test('frame10 extra actions dispatch registered IDs, refresh reasons/hints on open, and skip disabled entries', async () => {
  const dom = menuDom(), doc = dom.window.document; let available = false, hint = 'first', active;
  const calls = [], dispatched = [];
  const control = instanceActions(doc, { instance: 'dev', home: '/home/dev' }, { scope: 'A', invoke: async action => calls.push(action),
    extra: [{ action: 'open-split', actionId: 'instance.openSplit', label: 'Open in split', reason: () => available ? '' : 'Select a destination.' }],
    shortcut: () => hint, onMenuState: value => { active = value; }, dispatch: id => { dispatched.push(id); return active?.run('open-split'); } });
  doc.body.append(control); const trigger = triggerOf(control), item = control.querySelector('[data-action="open-split"]');
  assert.equal(item.disabled, true); trigger.click(); assert.equal(doc.activeElement.dataset.action, 'inspect');
  control.querySelector('[role=menu]').hidePopover(); available = true; hint = 'rebound'; trigger.click(); assert.equal(item.disabled, false); assert.equal(item.querySelector('kbd').textContent, 'rebound');
  item.click(); await new Promise(setImmediate); assert.deepEqual(dispatched, ['instance.openSplit']); assert.deepEqual(calls, ['open-split']); assert.equal(active, null); dom.window.close();
});
for (const reject of [false, true]) test(`frame10 owner revokes menu late ${reject ? 'rejection' : 'success'} and old completion cannot unlock another workspace`, async () => {
  const dom = menuDom(), doc = dom.window.document; let current = true, finish, fail; const effects = [];
  const options = { scope: 'A', owner: () => current, invoke: () => new Promise((a,b) => { finish = a; fail = b; }), done: () => effects.push('done'), report: () => effects.push('error') };
  const row = { instance: 'dev', home: '/home/dev', createdAt: 'birth' }, first = instanceActions(doc, row, options); doc.body.append(first);
  first.querySelector('[data-action=inspect]').click(); current = false;
  const next = instanceActions(doc, row, { ...options, scope: 'B', owner: () => true }); doc.body.append(next);
  assert.equal(triggerOf(next).disabled, false, 'pending key includes workspace'); if (reject) fail(Error('PRIVATE')); else finish({}); await new Promise(setImmediate);
  assert.deepEqual(effects, []); assert.equal(triggerOf(first).disabled, true); assert.equal(triggerOf(next).disabled, false);
  dom.window.close();
});
test('shipped frame10 action registration is menu-focus scoped, mouse/key equivalent and live rebind-aware without default Ctrl chords', async () => {
  const dom = menuDom(), doc = dom.window.document, source = readFileSync(new URL('../renderer/shell.mjs', import.meta.url), 'utf8'), off = [], calls = [];
  const c = { document: doc, activeInstanceMenu: null, tabLayerVisible: false, stage: null, setActiveContexts, getBinding, formatChord,
    baseTitles: new WeakMap(), isMac: true, registerAction: spec => off.push(registerAction(spec)) };
  const functions = ['updateActiveContexts', 'menuState', 'applyChordTitles'].map(name => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0]).join('\n');
  const start = source.indexOf('for (const [id, action, label] of'), end = source.indexOf('registerAction({ id: "app.palette"', start);
  const s = runInNewContext(`${functions}\n${source.slice(start, end)}\n({ menuState, updateActiveContexts, applyChordTitles })`, c);
  const offKeys = onKeymapChange(s.applyChordTitles);
  try {
    assert.equal(getBinding('instance.openSplit'), null); assert.equal(getBinding('instance.openPullRequest'), null);
    setBinding('instance.openSplit', 'Mod+Shift+S');
    const outside = doc.createElement('input'); doc.body.append(outside);
    const control = instanceActions(doc, { instance: 'dev', home: '/dev' }, { scope: 'A', owner: () => true,
      extra: [{ action: 'open-split', actionId: 'instance.openSplit', label: 'Open in split' }],
      shortcut: id => getBinding(id) ? formatChord(getBinding(id), true) : '', dispatch: runAction,
      onMenuState: s.menuState, onFocusChange: s.updateActiveContexts, invoke: async action => calls.push(action) });
    doc.body.append(control); triggerOf(control).click();
    const event = new dom.window.KeyboardEvent('keydown', { key: 'S', metaKey: true, shiftKey: true, cancelable: true });
    assert.equal(handleKeydown(event, { isMac: true }), true); await new Promise(setImmediate); assert.deepEqual(calls, ['open-split']);
    triggerOf(control).click(); setBinding('instance.openSplit', 'Mod+Shift+O');
    assert.equal(control.querySelector('kbd').textContent, formatChord('Mod+Shift+O', true));
    control.querySelector('[data-action=open-split]').click(); await new Promise(setImmediate); assert.deepEqual(calls, ['open-split', 'open-split']);
    triggerOf(control).click(); outside.focus(); runAction('instance.openSplit'); await new Promise(setImmediate);
    assert.equal(calls.length, 2); assert.equal(runAction('instance.openSplit'), false);
    resetBinding('instance.openSplit'); assert.equal(getBinding('instance.openSplit'), null);
  } finally { offKeys(); resetBinding('instance.openSplit'); resetBinding('instance.openPullRequest'); for (const dispose of off) dispose(); setActiveContexts(new Set()); dom.window.close(); }
});
test('frame10 hidden or removed controls cannot execute or restore focus', async () => {
  const dom = menuDom(), doc = dom.window.document, wrap = doc.createElement('div'); doc.body.append(wrap);
  let calls = 0; const control = instanceActions(doc, { instance: 'dev', home: '/home/dev' }, { invoke: async () => { calls++; } }); wrap.append(control);
  wrap.hidden = true; await choose(control, 'inspect'); assert.equal(calls, 0); wrap.hidden = false; control.remove(); await choose(control, 'inspect'); assert.equal(calls, 0); dom.window.close();
});

test("retire adapter preserves incomplete local results and routes remote by saved identity", async () => {
  assert.equal(parseRetireEnvelope('{"retired":"dev-one","removedDir":true}').ok, true);
  const partial = parseRetireEnvelope('{"retired":"dev-one","removedDir":false,"rollbackIncomplete":["cleanup"]}');
  assert.equal(partial.ok, false); assert.equal(partial.error.code, "E_RETIRE_INCOMPLETE");
  assert.equal(parseRetireEnvelope(JSON.stringify({ schemaVersion: 1, ok: true, result: partial.result })).ok, false);
  let call;
  const env = await cliRetire("/installed/oats", { instance: "dev-one", home: "/remote/selected", workspaceDir: "/local", server: "host" }, {
    exec: (bin, argv, opts, cb) => { call = { bin, argv, opts }; cb(null, '{"schemaVersion":1,"ok":true,"result":{"retired":"dev-one"}}'); },
  });
  assert.equal(env.ok, true);
  assert.deepEqual(call.argv, ["retire", "dev-one", "--home", "/remote/selected", "--server", "host", "--json"]);
  assert.equal(call.opts.cwd, "/local");
});

test("roster rebuilds cannot submit a second lifecycle action while one is pending", async () => {
  const dom = menuDom();
  let finish; let calls = 0;
  const instance = { instance: "dev-pending", home: "/home/dev-pending" };
  const options = { invoke: () => { calls++; return new Promise((r) => { finish = r; }); },
    openLifecycle: assert.fail, done() {}, report: assert.fail };
  const first = instanceActions(dom.window.document, instance, options);
  dom.window.document.body.append(first);
  first.querySelector('[data-action="inspect"]').click();
  const replacement = instanceActions(dom.window.document, instance, options);
  assert.equal(triggerOf(replacement).disabled, true);
  replacement.querySelector('[data-action="retire"]').click();
  assert.equal(calls, 1);
  finish({}); await new Promise((r) => setImmediate(r));
  assert.equal(triggerOf(replacement).disabled, false, "the currently displayed control re-enables without another poll");
  assert.equal(triggerOf(instanceActions(dom.window.document, instance, options)).disabled, false);
  dom.window.close();
});


test("actions are app buttons with keyboard navigation, dismissal and refresh restoration", () => {
  const dom = menuDom(), doc = dom.window.document;
  const instance = { instance: "menu-worker", home: "/menu/worker" };
  const options = { invoke: assert.fail, openLifecycle: assert.fail, done() {}, report: assert.fail };
  let control = instanceActions(doc, instance, options); doc.body.append(control);
  assert.equal(control.querySelector("select"), null, "no OS-formatted select or native dropdown arrow");
  let trigger = triggerOf(control), menu = control.querySelector('[role="menu"]');
  assert.equal(trigger.tagName, "BUTTON");
  const key = (element, value) => element.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }));
  trigger.click();
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(doc.activeElement.dataset.action, "inspect");
  key(doc.activeElement, "ArrowDown");
  assert.equal(doc.activeElement.dataset.action, 'stop');
  key(doc.activeElement, 'ArrowDown');
  assert.equal(doc.activeElement.dataset.action, "retire");
  const restore = captureInstanceActionMenu(doc.body);
  control.remove(); control = instanceActions(doc, instance, options); doc.body.append(control); restore();
  trigger = triggerOf(control); menu = control.querySelector('[role="menu"]');
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(doc.activeElement.dataset.action, "retire", "refresh keeps the selected action");
  key(doc.activeElement, "Home"); assert.equal(doc.activeElement.dataset.action, "inspect");
  key(doc.activeElement, "End"); assert.equal(doc.activeElement.dataset.action, "retire");
  key(doc.activeElement, "Escape");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(doc.activeElement, trigger);
  key(trigger, "ArrowUp"); assert.equal(doc.activeElement.dataset.action, "retire");
  key(doc.activeElement, "Tab"); assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(doc.activeElement, trigger, "Tab continues from the trigger, not a hidden menu item");
  trigger.click(); menu.hidePopover(); // the browser's light-dismiss path
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  dom.window.close();
});
