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

// ── Spec E: focus on open, and the section keys ──────────────────────────

test('Spec E: Reopen spawn (a restored draft) lands on Name with the caret at the end, nothing selected', async t => {
  const u = await mountSpawn(t);
  spawn.preselectSpawn({ name: 'release-manager', agentsRoot: ROOT, draft: { layout: 'scoped', restore: { choices: { purpose: 'api-v2' } } } }); await settle();
  const purpose = u.q('.fpurpose');
  assert.equal(u.dialog().dataset.layout, 'scoped'); assert.equal(purpose.value, 'api-v2');
  assert.equal(u.doc.activeElement, purpose);
  assert.deepEqual([purpose.selectionStart, purpose.selectionEnd], [6, 6], 'the caret after the restored name, no select-all');
});

test('Spec E: Change soul keeps today\'s focus in the list; a click pick goes on to Name', async t => {
  const u = await mountSpawn(t);
  await u.open(); await u.type('.fpurpose', 'api-v2');
  u.q('.spawn-change-soul').click();
  assert.equal(u.doc.activeElement, u.q('.spawn-choice[aria-selected=true]'), 'the picker layout: the soul list, as before');
  [...u.doc.querySelectorAll('.spawn-choice')].find(b => b.dataset.agent === 'support-triager').click(); await settle();
  assert.equal(u.dialog().dataset.layout, 'picker');
  assert.equal(u.doc.activeElement, u.q('.fpurpose'), 'after the pick: Name');
});

const SECTIONS = [
  ['1', u => u.q('.fpurpose'), 'Name'],
  ['2', u => u.q('.spawn-run label:first-child .spawn-choice-trigger'), 'Harness'],
  ['3', u => u.q('.fmodel'), 'Model'],
  ['4', u => u.q('.frelation input:checked'), 'Relationship'],
  ['6', u => u.q('.ftask'), 'Opening instruction'],
];
for (const platform of ['mac', 'other']) {
  test(`Spec E: Mod+1–Mod+6 jump to their section, from any field, and never reach the shell behind the modal (${platform})`, async t => {
    const u = await mountSpawn(t);
    if (platform === 'mac') asMac(u);
    await u.open();
    const mod = platform === 'mac' ? { metaKey: true } : { ctrlKey: true };
    const behind = []; u.dom.window.addEventListener('keydown', e => behind.push(e.key));
    for (const [digit, target, name] of SECTIONS) {
      const from = u.q('.ftask') === target(u) ? u.q('.fpurpose') : u.q('.ftask'); from.focus();
      const e = key(u, from, digit, mod);
      assert.equal(e.defaultPrevented, true, `Mod+${digit} is the dialog's`);
      assert.equal(u.doc.activeElement, target(u), `Mod+${digit} → ${name}`);
    }
    assert.deepEqual(behind, [], 'the section keys stop at the dialog: nothing behind the modal sees them');
    // The other platform's modifier is not the chord here: it does nothing in the dialog.
    u.q('.ftask').focus(); key(u, u.q('.ftask'), '1', platform === 'mac' ? { ctrlKey: true } : { metaKey: true });
    assert.equal(u.doc.activeElement, u.q('.ftask'));
    behind.length = 0;
    // Teams is not offered here: Mod+5 moves nothing, and still never reaches the shell.
    const five = key(u, u.q('.ftask'), '5', mod);
    assert.equal(five.defaultPrevented, true); assert.equal(u.doc.activeElement, u.q('.ftask'));
    // A held key repeats: still the dialog's, and nothing moves.
    const held = key(u, u.q('.ftask'), '1', { ...mod, repeat: true });
    assert.equal(held.defaultPrevented, true); assert.equal(u.doc.activeElement, u.q('.ftask'));
    assert.deepEqual(behind, [], 'nothing propagated past the dialog');
    assert.ok(u.dialog(), 'the dialog stays open');
  });
}

test('Spec E: Mod+7 opens Developer settings on its first control, and again closes it back on its summary', async t => {
  const u = await mountSpawn(t);
  await u.open();
  const advanced = u.q('.spawn-advanced');
  assert.equal(advanced.open, false);
  key(u, u.q('.fpurpose'), '7', { ctrlKey: true });
  assert.equal(advanced.open, true);
  const first = u.doc.activeElement;
  assert.ok(u.q('.spawn-advanced-body').contains(first), 'focus inside Developer settings');
  assert.ok(['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(first.tagName));
  key(u, first, '7', { ctrlKey: true });
  assert.equal(advanced.open, false); assert.equal(u.doc.activeElement, u.q('.spawn-advanced > summary'));
});

test('Spec E: each section shows its chord as a quiet hint (aria-hidden) and the control says aria-keyshortcuts; a rebind follows', async t => {
  const { setBinding, resetBinding } = await import('../renderer/keybindings.mjs');
  const u = await mountSpawn(t);
  asMac(u);
  await u.open();
  const hints = [...u.dialog().querySelectorAll('kbd.spawn-key-hint')];
  assert.equal(hints.length, 7);
  for (const hint of hints) assert.equal(hint.getAttribute('aria-hidden'), 'true');
  const shown = hints.filter(h => !h.closest('[hidden]')).map(h => h.textContent);
  assert.deepEqual(shown, ['⌘1', '⌘2', '⌘3', '⌘4', '⌘6', '⌘7'], 'Teams is not offered here: its hint is in its hidden row');
  assert.equal(u.q('label[for=spawn-purpose] kbd').textContent, '⌘1', 'beside the Name label');
  assert.equal(u.q('.fpurpose').getAttribute('aria-keyshortcuts'), 'Meta+1');
  assert.equal(u.q('.spawn-run label:first-child .spawn-choice-trigger').getAttribute('aria-keyshortcuts'), 'Meta+2');
  assert.equal(u.q('.fmodel').getAttribute('aria-keyshortcuts'), 'Meta+3');
  assert.ok([...u.dialog().querySelectorAll('.frelation input')].every(i => i.getAttribute('aria-keyshortcuts') === 'Meta+4'));
  assert.equal(u.q('.ftask').getAttribute('aria-keyshortcuts'), 'Meta+6');
  assert.equal(u.q('.spawn-advanced > summary').getAttribute('aria-keyshortcuts'), 'Meta+7');
  assert.equal(u.q('label[for=spawn-purpose]').textContent.replace(u.q('label[for=spawn-purpose] kbd').textContent, ''), 'Name');
  t.after(() => resetBinding('spawn.jumpName'));
  setBinding('spawn.jumpName', 'Mod+Shift+N');
  assert.equal(u.q('label[for=spawn-purpose] kbd').textContent, '⇧⌘N');
  assert.equal(u.q('.fpurpose').getAttribute('aria-keyshortcuts'), 'Meta+Shift+N');
  u.q('.ftask').focus(); key(u, u.q('.ftask'), 'N', { metaKey: true, shiftKey: true });
  assert.equal(u.doc.activeElement, u.q('.fpurpose'), 'the rebound chord jumps');
  u.q('.ftask').focus(); key(u, u.q('.ftask'), '1', { metaKey: true });
  assert.equal(u.doc.activeElement, u.q('.ftask'), 'the old chord no longer jumps');
  setBinding('spawn.jumpName', null);
  assert.equal(u.q('label[for=spawn-purpose] kbd').hidden, true, 'unbound: no hint');
  assert.equal(u.q('.fpurpose').hasAttribute('aria-keyshortcuts'), false);
});

test('Spec E: the dialog keys are listed in the shortcuts editor under Spawn dialog, and shadow no global key', async () => {
  const { listActions, findConflict, registerAction } = await import('../renderer/keybindings.mjs');
  const { groupActions } = await import('../renderer/keybindings-editor.mjs');
  const { registerSpawnDialogKeys } = await import('../renderer/spawn-dialog-keys.mjs');
  registerSpawnDialogKeys(); registerSpawnDialogKeys(); // idempotent
  const ids = listActions().filter(a => a.context === 'spawn-dialog-local').map(a => a.id).sort();
  assert.deepEqual(ids, ['spawn.jumpHarness', 'spawn.jumpModel', 'spawn.jumpName', 'spawn.jumpRelationship', 'spawn.jumpTask', 'spawn.jumpTeams', 'spawn.submit', 'spawn.toggleAdvanced']);
  assert.equal(groupActions().find(g => g.context === 'spawn-dialog-local').label, 'Spawn dialog');
  const release = registerAction({ id: 'fixture.showActive', label: 'Show Active', context: 'global', defaultChord: 'Mod+1', run: () => {} });
  try {
    assert.equal(findConflict('Mod+1', 'spawn-dialog-local', 'spawn.jumpName', true), null, 'the open dialog owns Mod+1; Active keeps it elsewhere');
    assert.equal(findConflict('Mod+1', 'global', 'fixture.showActive', true), null);
    assert.equal(findConflict('Mod+2', 'spawn-dialog-local', 'spawn.jumpName', true)?.id, 'spawn.jumpHarness', 'within the dialog, a clash is a clash');
  } finally { release(); }
});

test('Spec E: a section key from an open Harness picker closes the picker and moves on; Escape then closes the dialog as usual', async t => {
  const u = await mountSpawn(t);
  await u.open();
  const trigger = u.q('.spawn-run label:first-child .spawn-choice-trigger'), menu = () => u.q('#spawn-runtime-choices');
  trigger.focus(); key(u, trigger, 'Enter'); await settle();
  assert.equal(menu().hidden, false, 'the picker is open');
  const e = key(u, u.doc.activeElement, '6', { ctrlKey: true });
  assert.equal(e.defaultPrevented, true);
  assert.equal(menu().hidden, true, 'closed by the jump, not left behind');
  assert.equal(u.doc.activeElement, u.q('.ftask'), 'focus moved on (not restored to the picker trigger)');
  key(u, u.q('.ftask'), 'Escape'); await settle();
  assert.equal(u.dialog(), null, 'no picker is open, so Escape closes the dialog');
});

// Quick Open's pick from a terminal tab opens the dialog before the Workspace stage is on screen (the shell
// shows it right after): focus on Name cannot land yet. It lands once the stage is shown, unless the
// operator focused something else in between. (Seen live: the dialog opened with focus on <body>.)
for (const [why, between, lands] of [
  ['the stage shows a frame later: Name takes focus then', show => show(), true],
  ['the operator focused something else first: it stays theirs', (show, u) => { const b = u.doc.createElement('button'); u.doc.body.append(b); b.focus(); show(); }, false],
  ['the operator focused a control in the dialog first: it stays theirs', (show, u) => { show(); u.q('.ftask').focus(); }, false],
]) test(`opened before its stage is on screen: ${why}`, async t => {
  const u = await mountSpawn(t);
  const proto = u.dom.window.HTMLElement.prototype, focus = proto.focus;
  let offscreen = true; // a control under a hidden stage does not take focus
  proto.focus = function (...args) { if (offscreen && this.closest?.('.spawn-dialog')) return; return focus.apply(this, args); };
  t.after(() => { proto.focus = focus; });
  // The host collects setInterval (the view's polls), which jsdom's own frames run on: drive frames here.
  u.dom.window.requestAnimationFrame = f => setTimeout(f, 16);
  spawn.preselectSpawn({ name: 'release-manager', agentsRoot: ROOT, onDismiss: () => true });
  assert.ok(u.dialog(), 'the dialog is open'); assert.notEqual(u.doc.activeElement, u.q('.fpurpose'), 'not yet');
  between(() => { offscreen = false; }, u); // the stage is shown
  const other = u.doc.activeElement;
  await new Promise(r => setTimeout(r, 250)); // more than the 10 frames the retry may take
  if (lands) assert.equal(u.doc.activeElement, u.q('.fpurpose'), 'focus lands in Name');
  else assert.equal(u.doc.activeElement, other, 'the operator\'s focus is not taken');
});
