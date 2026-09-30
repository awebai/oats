// Spec F, Parts 1 and 2: Quick Open's pick opens the spawn dialog scoped to that soul, and the
// dialog works from the keyboard — Mod+Enter from any field, Tab in visual order, roving
// segmented controls, pickers that close first on Escape, and a soul listbox. Mounted in the
// real Workspace view with the kernel captures (helpers/spawn-dialog-host.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSpawn, settle, catalogAgents, ROOT } from './helpers/spawn-dialog-host.mjs';
import * as spawn from '../renderer/views/spawn.mjs';

const key = (u, target, k, fields = {}) => {
  const event = new u.dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...fields });
  target.dispatchEvent(event); return event;
};
const asMac = u => Object.defineProperty(u.dom.window.navigator, 'platform', { value: 'MacIntel', configurable: true });
const card = (u, name) => [...u.doc.querySelectorAll('.soul-card')].find(c => c.dataset.agent === name);
/** Tab stops in DOM order (what Tab walks): enabled, tabIndex >= 0, not hidden, not in a closed <details>. */
function tabStops(u) {
  const dialog = u.dialog(), view = u.dom.window;
  return [...dialog.querySelectorAll('button, input, select, textarea, summary')].filter(el => {
    if (el.disabled || el.tabIndex < 0) return false;
    for (let n = el; n && n !== dialog.parentElement; n = n.parentElement) {
      if (n.hidden || view.getComputedStyle(n).display === 'none') return false;
      if (n.tagName === 'DETAILS' && !n.open && el !== n.querySelector('summary')) return false;
    }
    return true;
  });
}
const label = el => el.classList.contains('fpurpose') ? 'Name' : el.classList.contains('fprefix') ? 'Prefix'
  : el.matches('.spawn-run label:first-child .spawn-choice-trigger') ? 'Harness' : el.classList.contains('fmodel') ? 'Model'
  : el.matches('.spawn-model-controls .spawn-choice-trigger') ? 'Model choices' : el.closest('.frelation') ? `Relationship:${el.value}`
  : el.classList.contains('frelto') ? 'Relationship target' : el.closest('.spawn-team-list') ? `Team:${el.value || 'default'}`
  : el.classList.contains('ftask') ? 'Opening instruction' : el.matches('.spawn-advanced > summary') ? 'Developer settings'
  : el.classList.contains('fcancel') ? 'Cancel' : el.classList.contains('fspawn') ? 'Spawn'
  : el.classList.contains('spawn-change-soul') ? 'Change soul' : el.classList.contains('close-act') ? 'Close'
  : el.classList.contains('spawn-details-toggle') ? 'Details' : el.className;

// ── Part 1: Quick Open → the scoped spawn dialog ─────────────────────────

test('Quick Open picks a soul: the spawn dialog opens scoped to it (header, preview, Change soul) with focus on Name', async t => {
  const u = await mountSpawn(t);
  spawn.preselectSpawn({ name: 'release-manager', agentsRoot: ROOT, onDismiss: () => true }); await settle();
  const dialog = u.dialog(); assert.ok(dialog, 'the dialog is open');
  assert.equal(dialog.dataset.layout, 'scoped');
  assert.equal(u.text('h2#spawn-dialog-title'), 'Spawn release-manager');
  assert.equal(u.q('.spawn-preview').hidden, false); assert.equal(u.q('.spawn-change-soul').hidden, false);
  assert.equal(u.doc.activeElement, u.q('.fpurpose'), 'focus lands in Name');
  assert.equal(u.doc.querySelector('.workspace-soul-page').hidden, true, 'no soul page on the way');
});

test('dismissing a Quick Open dialog returns to where the operator was; if that is gone, the dialog restores focus itself', async t => {
  const u = await mountSpawn(t);
  const returns = [];
  spawn.preselectSpawn({ name: 'release-manager', agentsRoot: ROOT, onDismiss: () => { returns.push('back'); return true; } }); await settle();
  key(u, u.q('.fpurpose'), 'Escape'); await settle();
  assert.equal(u.dialog(), null); assert.deepEqual(returns, ['back']);
  assert.notEqual(u.doc.activeElement, card(u, 'release-manager'), 'not to the card: the shell returned focus');
  // The operator moved on (the shell refuses the return): the dialog's own restore, the soul's card.
  spawn.preselectSpawn({ name: 'release-manager', agentsRoot: ROOT, onDismiss: () => false }); await settle();
  u.q('.fcancel').click(); await settle();
  assert.equal(u.doc.activeElement, card(u, 'release-manager'));
  // A successful spawn is not a dismissal: the return never runs.
});

test('the return target survives Change soul; Enter on a soul in the list picks it and moves to Name', async t => {
  const u = await mountSpawn(t);
  const returns = [];
  spawn.preselectSpawn({ name: 'release-manager', agentsRoot: ROOT, onDismiss: () => { returns.push('back'); return true; } }); await settle();
  await u.type('.fpurpose', 'api-v2');
  u.q('.spawn-change-soul').click();
  const listbox = u.q('.spawn-soul-choices');
  assert.equal(listbox.getAttribute('role'), 'listbox');
  const selected = u.q('.spawn-choice[aria-selected=true]');
  assert.equal(selected.getAttribute('role'), 'option'); assert.equal(u.doc.activeElement, selected);
  key(u, selected, 'ArrowDown'); key(u, u.doc.activeElement, 'End'); key(u, u.doc.activeElement, 'Home');
  const first = u.doc.activeElement; assert.equal(first.getAttribute('role'), 'option');
  key(u, first, 'Enter'); await settle();
  assert.equal(u.text('h2'), 'Spawn instance', 'the picker layout stays');
  assert.equal(u.q('.spawn-choice[aria-selected=true]').dataset.agent, first.dataset.agent);
  assert.equal(u.doc.activeElement, u.q('.fpurpose'), 'Enter goes on to Name');
  assert.equal(u.q('.fpurpose').value, 'api-v2', 'nothing typed is lost');
  u.q('.close-act').click(); await settle();
  assert.deepEqual(returns, ['back']);
});

test('the soul list filters as you type; Enter in its search picks the best match and moves to Name', async t => {
  const u = await mountSpawn(t);
  await u.open(); u.q('.spawn-change-soul').click();
  const option = u.doc.activeElement;
  key(u, option, 's'); // typing on the list goes to its search
  const search = u.q('.spawn-soul-search');
  assert.equal(u.doc.activeElement, search); assert.equal(search.value, 's');
  search.value = 'triager'; search.dispatchEvent(new u.dom.window.Event('input', { bubbles: true }));
  assert.equal(u.text('.spawn-search-count'), '1 of 8');
  key(u, search, 'Enter'); await settle();
  assert.equal(u.q('.spawn-choice[aria-selected=true]').dataset.agent, 'support-triager');
  assert.equal(u.doc.activeElement, u.q('.fpurpose'));
});

test('an attached-only soul goes to its page (which explains why), never the dialog', async t => {
  const agents = [...catalogAgents(), { ...catalogAgents()[0], name: 'attached-helper', work: 'attached' }];
  const u = await mountSpawn(t, { agents });
  spawn.preselectSpawn({ name: 'attached-helper', agentsRoot: ROOT, onDismiss: () => assert.fail('no dialog to dismiss') }); await settle();
  assert.equal(u.dialog(), null);
  const page = u.doc.querySelector('.workspace-soul-page');
  assert.equal(page.hidden, false); assert.match(page.querySelector('.inspector-head h2').textContent, /attached-helper/);
});

// ── Part 2: the dialog from the keyboard ─────────────────────────────────

for (const platform of ['mac', 'other']) {
  test(`Mod+Enter spawns from the instruction textarea and from a segmented control (${platform})`, async t => {
    for (const from of ['.ftask', '.frelation input:checked']) {
      const u = await mountSpawn(t);
      if (platform === 'mac') asMac(u);
      await u.open(); await u.type('.fpurpose', 'api-v2');
      const mod = platform === 'mac' ? { metaKey: true } : { ctrlKey: true };
      assert.equal(u.q('.fspawn').dataset.chord, platform === 'mac' ? '⌘↵' : 'Ctrl+Enter', 'the button shows the effective chord');
      const field = u.q(from); field.focus();
      key(u, field, 'Enter'); await settle();
      assert.equal(u.spawns().length, 0, 'plain Enter never spawns');
      // The other platform's modifier is not the chord here.
      key(u, field, 'Enter', platform === 'mac' ? { ctrlKey: true } : { metaKey: true }); await settle();
      assert.equal(u.spawns().length, 0);
      const e = key(u, field, 'Enter', mod); await settle(20);
      assert.equal(e.defaultPrevented, true);
      assert.equal(u.spawns()[0]?.action, 'prepare', `spawned from ${from}`);
    }
  });
}

test('plain Enter in Name does not spawn; Enter or Space on the focused Spawn button does', async t => {
  const u = await mountSpawn(t);
  await u.open(); await u.type('.fpurpose', 'api-v2');
  key(u, u.q('.fpurpose'), 'Enter'); await settle();
  assert.equal(u.spawns().length, 0);
  const button = u.q('.fspawn'); button.focus();
  key(u, button, 'Enter'); await settle(20);
  assert.equal(u.spawns()[0]?.action, 'prepare');
});

test('Tab walks the form in visual order: Name, Prefix, Harness, Model, Relationship (one stop), its target, Instruction, Developer settings, Cancel, Spawn; the header after', async t => {
  const u = await mountSpawn(t, { cli: { ...(await import('./helpers/spawn-preview-fixture.mjs')).cli, features: [...(await import('./helpers/spawn-preview-fixture.mjs')).cli.features, 'spawn-name'] } });
  await u.open(); await u.type('.fpurpose', 'api-v2');
  assert.deepEqual(tabStops(u).map(label), ['Change soul', 'Close', 'Name', 'Prefix', 'Harness', 'Model', 'Model choices', 'Relationship:unrelated', 'Opening instruction', 'Developer settings', 'Cancel', 'Spawn']);
  // A relationship with a target: the target joins, right after the (one) Relationship stop.
  const independent = u.q('.frelation input:checked'); independent.focus();
  key(u, independent, 'ArrowRight'); await settle();
  assert.equal(u.q('.frelation input:checked').value, 'child', 'arrows choose, like native radios');
  assert.equal(u.doc.activeElement, u.q('.frelation input:checked'));
  const stops = tabStops(u).map(label);
  assert.deepEqual(stops.slice(stops.indexOf('Relationship:child'), stops.indexOf('Relationship:child') + 2), ['Relationship:child', 'Relationship target']);
  assert.equal(stops.filter(s => s.startsWith('Relationship:')).length, 1, 'a radio group is one tab stop');
  key(u, u.doc.activeElement, 'End'); assert.equal(u.q('.frelation input:checked').value, 'parent');
  key(u, u.doc.activeElement, 'Home'); assert.equal(u.q('.frelation input:checked').value, 'unrelated');
  await settle(20); // the preview for these choices settles and Spawn enables
  // The trap: Tab from Spawn wraps to the header, Shift+Tab from it back to Spawn.
  const spawnButton = u.q('.fspawn'); assert.equal(spawnButton.disabled, false); spawnButton.focus();
  key(u, spawnButton, 'Tab'); assert.equal(u.doc.activeElement, u.q('.spawn-change-soul'));
  key(u, u.doc.activeElement, 'Tab', { shiftKey: true }); assert.equal(u.doc.activeElement, spawnButton);
});

test('the Harness picker opens with Enter, Space or Alt+Down; Escape closes it back to its trigger, and only then closes the dialog', async t => {
  const u = await mountSpawn(t);
  await u.open();
  const trigger = u.q('.spawn-run label:first-child .spawn-choice-trigger'), menu = () => u.q('#spawn-runtime-choices');
  for (const open of [['Enter'], ['ArrowDown', { altKey: true }]]) {
    trigger.focus(); key(u, trigger, ...open); await settle();
    assert.equal(menu().hidden, false, `${open[0]} opens it`);
    key(u, u.doc.activeElement, 'Escape'); await settle();
    assert.equal(menu().hidden, true); assert.equal(u.doc.activeElement, trigger, 'focus back on its trigger');
    assert.ok(u.dialog(), 'the dialog stays open');
  }
  trigger.click(); await settle(); assert.equal(menu().hidden, false, 'Space is the button\'s own click');
  key(u, u.doc.activeElement, 'Escape'); await settle();
  key(u, trigger, 'Escape'); await settle();
  assert.equal(u.dialog(), null, 'Escape with no picker open closes the dialog');
});
