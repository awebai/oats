import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { registerAction, setActiveContexts, getBinding, formatChord, setBinding, resetBinding, runAction, handleKeydown, onKeymapChange } from '../renderer/keybindings.mjs';
import { instanceActions, captureInstanceActionMenu } from "../renderer/instance-actions.mjs";
import { markStaleControl, ROSTER_STALE_TITLE } from "../renderer/instance-tree.mjs";
import { cliRetire, parseRetireEnvelope } from "../../client/cli-adapter.mjs";

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
  const instance = { instance: "dev-one", home: "/remote/home", server: "host", addressable: true };
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
  // A remote row the kernel does not report addressable: no actions, and the trigger says why (a saved route is not enough).
  const refused = triggerOf(instanceActions(dom.window.document, { ...instance, repoName: 'Build box', savedRoute: true, addressable: false, missingRemotely: true }, {}));
  assert.equal(refused.disabled, true);
  assert.equal(refused.title, 'dev-one is no longer on Build box. Remove it from this computer with: oats server forget host --instance dev-one');
  dom.window.close();
});

test('a Herdr-recorded row shows Start disabled with the kernel reason, offers no Restart, and still retires through the plan', async () => {
  const reason = 'E_HERDR_REMOVED: Herdr is no longer supported by OATS (removed in 0.31.0); tmux is the only session backend.';
  for (const instance of [{ instance: 'h1', home: '/home/h1', running: null, runtimeState: 'unsupported', runtimeError: `${reason} (h1)` },
    { instance: 'h2', home: '/remote/h2', server: 'host', addressable: true, running: true, backend: 'herdr' }]) {
    const dom = menuDom(), doc = dom.window.document, calls = [], dialogs = [];
    const control = instanceActions(doc, instance, { invoke: async (...args) => calls.push(args), openLifecycle: (...args) => dialogs.push(args), report: m => assert.fail(m) });
    doc.body.append(control);
    const start = control.querySelector('[data-action="start"]'), shown = instance.runtimeError || reason;
    assert.equal(start.disabled, true); assert.equal(start.title, shown); assert.equal(start.querySelector('small').textContent, shown);
    assert.equal(control.querySelector('[data-action="restart"]'), null);
    await choose(control, 'start'); assert.deepEqual(calls, []);
    await choose(control, 'retire'); assert.deepEqual(dialogs, [['retire', instance]]);
    dom.window.close();
  }
});

test('the shipped menu handler handles every action the menu can invoke and refuses any other, sending nothing (#627)', async () => {
  // The roster's `invoke` from shell.mjs, run as shipped: only its collaborators are stubbed (the inspect
  // view's dynamic import included). Each handled action records what it opened; no request may be sent.
  const source = readFileSync(new URL('../renderer/shell.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('invoke: async (action, instance) => {'), end = source.indexOf('\n          openLifecycle:', start);
  assert.ok(start > 0 && end > start, 'the roster menu handler is found in shell.mjs');
  const handler = source.slice(start + 'invoke: '.length, end).trim().replace(/,$/, '');
  const opened = [], requests = [];
  const c = { ws: 'A', rosterGeneration: 1, currentWorkspace: () => 'A', workspaceGeneration: () => 1, actionTarget: {}, menuOwner: () => true,
    openTerminalTab: () => opened.push('open-split'), instancePrAction: { open: () => opened.push('open-pr') },
    openInstanceStart: (_, { restart }) => opened.push(restart ? 'restart' : 'start'),
    tabOpenIntents: { begin: () => () => true }, loadView: async () => ({ preselectHome: () => {} }), showStage: async () => opened.push('inspect'),
    api: (...args) => requests.push(args), postJson: (...args) => requests.push(args), instanceApiPath: (...args) => requests.push(args) };
  const invoke = runInNewContext(`(${handler.replace('import("./views/spawn.mjs")', 'loadView("./views/spawn.mjs")')})`, c);
  // Every action a row's menu passes to invoke, in each launch state, with the shell's extra items.
  const invoked = new Set();
  for (const running of [true, false, undefined]) {
    const dom = menuDom(), doc = dom.window.document, instance = { instance: 'dev', home: '/home/dev', running };
    const control = instanceActions(doc, instance, { scope: 'A',
      extra: [{ action: 'open-split', label: 'Open in split' }, { action: 'open-pr', label: 'Open pull request…' }],
      invoke: (action, row) => { invoked.add(action); return invoke(action, row); },
      openLifecycle: () => {}, report: (headline, { detail }) => assert.fail(`${headline} ${detail}`) });
    doc.body.append(control);
    for (const item of control.querySelectorAll('[data-action]')) await choose(control, item.dataset.action);
    dom.window.close();
  }
  assert.deepEqual([...invoked].sort(), ['inspect', 'open-pr', 'open-split', 'restart', 'start']);
  assert.deepEqual([...new Set(opened)].sort(), [...invoked].sort(), 'each invoked action reached its own handler');
  // Anything else is refused: no path is built from the action's name.
  for (const action of ['harvest', 'chat', 'retire', 'stop', '../panel']) {
    await assert.rejects(invoke(action, { instance: 'dev', home: '/home/dev' }), { message: `Unknown instance action "${action}"` }, action);
  }
  assert.deepEqual(requests, []);
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
  assert.equal(triggerOf(next).hasAttribute('aria-disabled'), false, 'pending key includes workspace'); if (reject) fail(Error('PRIVATE')); else finish({}); await new Promise(setImmediate);
  assert.deepEqual(effects, []); assert.equal(triggerOf(first).getAttribute('aria-disabled'), 'true'); assert.equal(triggerOf(next).hasAttribute('aria-disabled'), false);
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
  assert.equal(triggerOf(replacement).getAttribute("aria-disabled"), "true");
  assert.equal(triggerOf(replacement).title, "Waiting for Knowledge & capabilities to finish");
  replacement.querySelector('[data-action="retire"]').click();
  assert.equal(calls, 1);
  finish({}); await new Promise((r) => setImmediate(r));
  assert.equal(triggerOf(replacement).hasAttribute("aria-disabled"), false, "the currently displayed control re-enables without another poll");
  assert.equal(triggerOf(instanceActions(dom.window.document, instance, options)).hasAttribute("aria-disabled"), false);
  dom.window.close();
});

test("a pending action marks its trigger aria-disabled with why it waits, keeps focus, and clears only its own marking", async () => {
  const dom = menuDom(), doc = dom.window.document; dom.window.alert = () => assert.fail("no alert");
  let finish; let calls = 0;
  const instance = { instance: "dev-wait", home: "/home/dev-wait" };
  const options = { invoke: () => { calls++; return new Promise((r) => { finish = r; }); }, openLifecycle: assert.fail, done() {}, report: assert.fail };
  const waiting = "Waiting for Knowledge & capabilities to finish";
  const marked = (trigger, reason) => {
    assert.equal(trigger.disabled, false, "never `disabled`: Chromium would blur a focused trigger");
    assert.equal(trigger.getAttribute("aria-disabled"), "true"); assert.equal(trigger.title, reason); assert.equal(trigger.getAttribute("aria-description"), reason);
  };
  const clear = trigger => { for (const name of ["aria-disabled", "title", "aria-description"]) assert.equal(trigger.hasAttribute(name), false, name); };
  const first = instanceActions(doc, instance, options); doc.body.append(first);
  const trigger = triggerOf(first); trigger.click(); assert.equal(doc.activeElement.dataset.action, "inspect");
  doc.activeElement.click(); assert.equal(calls, 1);
  marked(trigger, waiting); assert.equal(doc.activeElement, trigger, "focus returns to, and stays on, the waiting trigger");
  trigger.click(); assert.equal(trigger.getAttribute("aria-expanded"), "false", "a pending trigger cannot open its menu");
  trigger.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  await choose(first, "inspect"); assert.equal(calls, 1, "no second action while one is pending");
  const replacement = instanceActions(doc, instance, options); doc.body.append(replacement); marked(triggerOf(replacement), waiting);
  const stale = instanceActions(doc, instance, options); doc.body.append(stale); markStaleControl(triggerOf(stale));
  finish({}); await new Promise(setImmediate);
  clear(trigger); clear(triggerOf(replacement)); assert.equal(triggerOf(replacement).dataset.pendingAction, undefined);
  marked(triggerOf(stale), ROSTER_STALE_TITLE);
  dom.window.close();
});

test("a failing action reports a plain headline with the error as detail, never an alert", async () => {
  const dom = menuDom(), doc = dom.window.document; dom.window.alert = () => assert.fail("no alert");
  const reports = [], instance = { instance: "dev-fail", home: "/home/dev-fail" };
  const control = instanceActions(doc, instance, { invoke: async () => { throw new Error("E_SPAWN: preview refused"); },
    openLifecycle: assert.fail, done: assert.fail, report: (...args) => reports.push(args),
    extra: [{ action: "open-split", label: "Open in split" }] });
  doc.body.append(control);
  await choose(control, "inspect"); await choose(control, "open-split");
  assert.deepEqual(reports, [
    ["Knowledge & capabilities didn't finish for dev-fail.", { detail: "E_SPAWN: preview refused", action: "inspect", instance }],
    ["Open in split didn't finish for dev-fail.", { detail: "E_SPAWN: preview refused", action: "open-split", instance }]]);
  assert.equal(triggerOf(control).hasAttribute("aria-disabled"), false);
  const unplanned = instanceActions(doc, instance, { invoke: assert.fail, report: (...args) => reports.push(args) }); doc.body.append(unplanned);
  await choose(unplanned, "retire");
  assert.deepEqual(reports.at(-1), ["A plan-backed confirmation is required for Stop or Retire.", { action: "retire", instance }]);
  dom.window.close();
});

test("the retire item reads Retire instance…", () => {
  const dom = menuDom();
  const control = instanceActions(dom.window.document, { instance: "dev", home: "/home/dev" }, {});
  assert.equal(control.querySelector('[data-action="retire"]').textContent, "Retire instance…");
  assert.doesNotMatch(control.textContent, /Remove/);
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
