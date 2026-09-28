// Automations (human 2026-09-28): ONE nav item, with Schedules | Triggers as subtabs in the
// Workspace's tab style — the bar holds "Automations", the two tabs (each with its row count), then
// the shown page's own tools. On the captured kernel lists (test/fixtures/automations/kernel).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createAutomationsStage, preselectAutomationsTab } from '../renderer/views/automations.mjs';
import { setWorkspace, currentWorkspace } from '../renderer/views/common.mjs';

const fx = name => JSON.parse(readFileSync(new URL(`./fixtures/automations/kernel/${name}.json`, import.meta.url), 'utf8')).result;
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const CLI = { ok: true, features: ['schedule', 'automations'], automationsApi: 1 };

async function mount(t, { cli = CLI } = {}) {
  const previous = currentWorkspace(); setWorkspace('/team');
  const dom = new JSDOM('<!doctype html><body><main></main></body>', { pretendToBeVisual: true });
  const doc = dom.window.document, el = doc.querySelector('main'), bodies = [];
  const ctx = { api: async (path, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : {}; bodies.push([path.split('?')[0], body]);
    if (path.startsWith('/api/automations')) return { automationsViewApi: 1, status: 'ok', kind: body.kind, action: body.action, result: fx(`${body.kind}-list`), reason: null };
    return {};
  } };
  const stage = createAutomationsStage(el, ctx, { cli: () => cli, subscribeCli: () => () => {} });
  t.after(() => { stage.dispose(); dom.window.close(); setWorkspace(previous); });
  await settle();
  const tabs = () => [...el.querySelectorAll('.auto-tabs [role=tab]')];
  const tab = kind => el.querySelector(`#automations-tab-${kind}`);
  return { dom, doc, el, stage, bodies, tabs, tab };
}

test('one bar: "Automations", then Schedules | Triggers with their counts, then the page\'s own tools; Schedules first', async t => {
  preselectAutomationsTab('schedule');
  const u = await mount(t);
  const header = u.el.querySelector('.auto-header');
  assert.ok(header.classList.contains('auto-framed'));
  assert.equal(header.querySelector('.auto-heading h1').textContent, 'Automations');
  assert.equal(header.querySelector('h2'), null, 'the page title is the selected tab, not a second heading');
  const schedules = fx('schedule-list').schedules.length, triggers = fx('trigger-list').triggers.length;
  assert.deepEqual(u.tabs().map(b => [b.firstChild.textContent, b.querySelector('.auto-tab-count').textContent, b.getAttribute('aria-selected'), b.tabIndex]),
    [['Schedules', String(schedules), 'true', 0], ['Triggers', String(triggers), 'false', -1]]);
  assert.equal(u.el.querySelector('.automations').dataset.kind, 'schedule');
  assert.equal(u.el.querySelector('[role=tabpanel]').getAttribute('aria-labelledby'), 'automations-tab-schedule');
  assert.ok(header.querySelector('button[aria-label="Refresh schedules"]'), "the page's tools stay in the bar");
  assert.deepEqual(u.bodies.map(([, b]) => [b.kind, b.action]), [['schedule', 'list'], ['trigger', 'list']], "the page's read, and one read for the other tab's count");
});

test('a click or the arrow keys switch the subtab; focus follows the keyboard; the choice is kept for the session', async t => {
  preselectAutomationsTab('schedule');
  const u = await mount(t);
  u.tab('trigger').click(); await settle();
  assert.equal(u.el.querySelector('.automations').dataset.kind, 'trigger');
  assert.equal(u.tab('trigger').getAttribute('aria-selected'), 'true');
  assert.equal(u.el.querySelectorAll('.auto-header').length, 1, 'one page at a time');
  const key = (el, value) => el.dispatchEvent(new u.dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  u.tab('trigger').focus(); key(u.tab('trigger'), 'ArrowLeft'); await settle();
  assert.equal(u.el.querySelector('.automations').dataset.kind, 'schedule');
  assert.equal(u.doc.activeElement, u.tab('schedule'), 'focus moves to the new tab');
  key(u.tab('schedule'), 'End'); await settle();
  assert.equal(u.doc.activeElement, u.tab('trigger'));
  u.stage.dispose();
  const again = await mount(t);
  assert.equal(again.tab('trigger').getAttribute('aria-selected'), 'true', 'reopening Automations returns to the last subtab');
  preselectAutomationsTab('schedule');
});

test("a soul's Schedule… opens Automations on Schedules; an older OATS gets each tab's gate in the same bar", async t => {
  preselectAutomationsTab('trigger'); preselectAutomationsTab('schedule');
  const old = await mount(t, { cli: { ok: true, features: ['schedule'], scheduleApi: 2 } });
  assert.equal(old.tab('schedule').getAttribute('aria-selected'), 'true');
  assert.equal(old.el.querySelector('.auto-heading h1').textContent, 'Automations');
  assert.match(old.el.textContent, /Schedules need OATS 0\.29 or later/);
  assert.deepEqual(old.bodies.filter(([p]) => p === '/api/automations'), [], 'nothing read from an older OATS, not even a count');
  old.tab('trigger').click(); await settle();
  assert.match(old.el.textContent, /Triggers need OATS 0\.29 or later/);
});
