// Pure DOM/lease integration. No native shell, server, process or live session.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createContextPanel } from '../renderer/context-panel.mjs';
import { createPanelOwner } from '../renderer/panel-owner.mjs';

function fixture(t) {
  const dom = new JSDOM('<aside id="context-panel"></aside>');
  const document = dom.window.document, root = document.querySelector('aside');
  const panel = createContextPanel({ document });
  const owner = { name: 'spawn' }, raw = [];
  let workspace = 'A', generation = 0;
  panel.setContext({ workspace, owner });
  const observed = { ...panel, attach(...args) { const lease = panel.attach(...args); raw.push(lease); return lease; } };
  const stage = createPanelOwner(observed, owner, () => generation);
  const element = document.createElement('section'), field = document.createElement('textarea');
  field.value = 'unsaved'; element.append(field);
  const facade = stage.attach(element);
  t.after(() => { stage.dispose(); panel.dispose(); dom.window.close(); });
  return { document, root, panel, owner, stage, element, field, facade, raw,
    visit(next) { workspace = next; generation++; panel.setContext({ workspace, owner }); },
  };
}

test('stable facade renews only on presentation writes; A→B→A raw leases never regain ownership', t => {
  const u = fixture(t), wrapper = u.element.parentElement, facade = u.facade;
  assert.equal(facade.isVisible(), true); assert.equal(u.raw.length, 1);
  for (const next of ['B', 'A']) {
    const old = u.raw.at(-1), count = u.raw.length;
    u.visit(next);
    assert.equal(u.root.hidden, true); assert.equal(facade.isVisible(), false);
    facade.collapse(); assert.equal(u.raw.length, count, 'queries and collapse cannot renew old workspace content');
    facade.setPresent(false); assert.equal(u.raw.length, count + 1);
    old.setPresent(true); old.collapse(); old.dispose();
    assert.equal(u.root.hidden, true, 'stale raw callbacks cannot expose or dispose the renewed slot');
    facade.setPresent(true);
    assert.equal(facade.isVisible(), true); assert.equal(u.element.parentElement, wrapper);
    assert.equal(u.field.value, 'unsaved'); assert.equal(u.field.isConnected, true);
    assert.equal(u.root.classList.contains('is-collapsed'), false);
  }
  u.raw[0].dispose(); assert.equal(facade.isVisible(), true);
  assert.equal(u.raw.length, 3); assert.equal(u.root.querySelectorAll('.context-panel-stage').length, 1);
});

test('stale facade disposal cannot dispose a replacement attachment or reacquire ownership', t => {
  const u = fixture(t), replacement = u.document.createElement('section'); replacement.textContent = 'replacement';
  const next = u.stage.attach(replacement);
  u.facade.dispose(); u.facade.setPresent(true); u.facade.collapse();
  assert.equal(u.facade.isVisible(), false); assert.equal(next.isVisible(), true);
  assert.equal(u.raw.length, 2); assert.equal(u.root.querySelector('.context-panel-stage').textContent, 'replacement');
  u.visit('B'); u.facade.setPresent(true); assert.equal(u.raw.length, 2, 'disposed facade never renews');
  next.setPresent(true); assert.equal(next.isVisible(), true);
});

test('hidden presence completion never selects the foreground or discards retained form/control nodes', t => {
  const u = fixture(t), save = u.document.createElement('button'); save.textContent = 'Save'; u.element.append(save);
  u.facade.collapse(); u.facade.setPresent(true);
  assert.equal(u.facade.isVisible(), false); assert.equal(u.root.classList.contains('is-collapsed'), true);
  u.panel.setCollapsed(false);
  u.panel.setContext({ workspace: 'A', key: 'terminal', instance: { instance: 'foreground' } });
  u.facade.setPresent(true); assert.equal(u.facade.isVisible(), false);
  assert.equal(u.root.querySelector('[data-context-field="instance"]').textContent, 'foreground');
  u.panel.setContext({ workspace: 'A', owner: u.owner });
  assert.equal(u.facade.isVisible(), true); assert.equal(u.element.querySelector('textarea'), u.field);
  assert.equal(u.element.querySelector('button'), save); assert.equal(save.disabled, false); assert.equal(u.field.value, 'unsaved');
});

test('closed stage releases mounted DOM and late facade operations cannot resurrect it after a reset', t => {
  const u = fixture(t); u.visit('B');
  const count = u.raw.length; u.stage.dispose(); u.stage.dispose();
  assert.equal(u.root.querySelector('.context-panel-stage'), null); assert.equal(u.element.isConnected, false);
  u.facade.dispose(); u.facade.setPresent(true); u.facade.collapse();
  const dead = u.stage.attach(u.document.createElement('section')); dead.setPresent(true); dead.dispose();
  assert.equal(dead.isVisible(), false); assert.equal(u.raw.length, count);
  assert.equal(u.root.hidden, true); assert.equal(u.root.querySelector('.context-panel-stage'), null);
});
