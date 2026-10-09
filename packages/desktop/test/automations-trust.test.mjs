// Automation trust (0.30; docs/desktop-cli-api.md "Shared row fields and workspace automations", kernel
// PR #300 shapes e9010e72): a workspace automation placed on this host runs only when oats-local.yaml
// automations.trust admits it. Every document here is the REAL kernel at #300's head
// (fixtures/automations-trust, capture-trust.mjs; provenance.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { automationRows, automationRow, placementText } from '../renderer/automation-rows.mjs';
import { createAutomationsView } from '../renderer/views/automations.mjs';
import { workspaceStatusData } from '../../client/deployment-data.mjs';

const real = name => JSON.parse(readFileSync(new URL(`./fixtures/automations-trust/${name}.json`, import.meta.url), 'utf8')).result;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const LINE = id => `declared for this host, not trusted here; to run it, add the line "- ${id}" under automations: trust: in oats-local.yaml`;

test('untrusted (real): a row placed here but not trusted needs attention, "Not trusted here", with the kernel\'s line to add verbatim', () => {
  for (const [kind, name, id] of [['trigger', 'untrusted-trigger-list', 'ws/kb-review'], ['schedule', 'untrusted-schedule-list', 'ws/nightly']]) {
    const { rows, host } = automationRows(real(name), kind), row = rows.find(r => r.id === id);
    assert.deepEqual([row.reason, row.runsHere, row.group, row.runsOn, row.owner], ['untrusted', false, 'attention', 'kb-host', 'github.com/kb-bot'], kind);
    assert.deepEqual(placementText(row, host), { label: 'Not trusted here', tone: 'warn', detail: LINE(id) }, kind);
  }
  // Trusted by name: the trigger runs here; the schedule is still untrusted.
  assert.deepEqual(automationRows(real('partial-trigger-list'), 'trigger').rows.map(r => [r.id, r.group, r.reason, r.runsHere]), [['ws/kb-review', 'here', null, true]]);
  assert.deepEqual(automationRows(real('partial-schedule-list'), 'schedule').rows.map(r => [r.id, r.group, r.reason]), [['ws/nightly', 'attention', 'untrusted']]);
});

test('a reason this Desktop does not know does not run here: attention, "Doesn\'t run here", its detail or its code', () => {
  const raw = structuredClone(real('untrusted-trigger-list').triggers[0]);
  const row = automationRow({ ...raw, reason: 'quarantined', reasonDetail: 'held by policy' }, 'trigger');
  assert.deepEqual([row.reason, row.reasonCode, row.group], ['other', 'quarantined', 'attention']);
  assert.deepEqual(placementText(row, null), { label: "Doesn't run here", tone: 'warn', detail: 'held by policy' });
  const bare = automationRow({ ...raw, reason: 'quarantined', reasonDetail: null }, 'trigger');
  assert.equal(placementText(bare, null).detail, 'reason: quarantined');
  assert.equal(automationRow({ ...raw, reason: null, runsHere: true }, 'trigger').group, 'here', 'no reason: as before');
});

test('Automations list (real): the untrusted row sits under needs-attention with the line to add in the row, wrapped, not only in a tooltip', async t => {
  const dom = new JSDOM('<!doctype html><body><main></main></body>', { pretendToBeVisual: true });
  const host = dom.window.document.querySelector('main');
  const view = createAutomationsView(host, { kind: 'trigger', read: async () => real('untrusted-trigger-list'), now: () => Date.parse('2026-09-29T12:00:00Z') });
  t.after(() => { view.dispose(); dom.window.close(); });
  await tick(); await tick();
  const row = host.querySelector('.auto-row[data-id="ws/kb-review"]');
  assert.equal(row.dataset.group, 'attention');
  assert.equal(row.closest('.auto-group').querySelector('.auto-group-title').classList.contains('warn'), true);
  assert.equal(row.querySelector('.auto-place').textContent, 'Not trusted here');
  assert.equal(row.querySelector('.auto-remedy').textContent, LINE('ws/kb-review'), 'verbatim, in the row');
  assert.match(row.querySelector('.auto-switch').title, /not trusted on this computer: it runs only once oats-local\.yaml trusts it/);
});

test('workspace status (real): automation-untrusted keeps kind, id and remedy; automation-trust-stale keeps its entry; all verbatim', () => {
  const dir = '/fixture/base/deployment';
  const untrusted = workspaceStatusData({ schemaVersion: 1, ok: true, result: real('untrusted-workspace-status') }, dir).warnings;
  assert.deepEqual(untrusted.map(w => [w.code, w.kind, w.id, w.remedy]), [
    ['automation-untrusted', 'trigger', 'ws/kb-review', 'add the line "- ws/kb-review" under automations: trust: in oats-local.yaml'],
    ['automation-untrusted', 'schedule', 'ws/nightly', 'add the line "- ws/nightly" under automations: trust: in oats-local.yaml']]);
  assert.equal(untrusted[0].message, 'trigger ws/kb-review is declared for this host (kb-host, as github.com/kb-bot) but not trusted here, so it does not run');
  const partial = workspaceStatusData({ schemaVersion: 1, ok: true, result: real('partial-workspace-status') }, dir).warnings;
  assert.deepEqual(partial.map(w => [w.code, w.id ?? w.entry]), [['automation-untrusted', 'ws/nightly'], ['automation-trust-stale', 'ws/gone']]);
  assert.match(partial[1].message, /automations\.trust names ws\/gone, which is no workspace trigger or schedule/);
});
