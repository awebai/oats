import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { compositionEntries, whyTag, desktopFacts, renderSoulCapabilities } from '../renderer/capability-page.mjs';

// Kernel #217 (feature desktop-facts): the soul page says why each capability is there from
// `capabilities[].composedFrom` and `capabilitiesOff[]`, never from a guess. The f7 capture
// predates #217, so the two facts are added here in the documented shape (docs/desktop-cli-api.md
// § "Desktop facts").
const inspected = () => JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/f7/inspect-soul.json', import.meta.url), 'utf8')).result;
function withFacts() {
  const v = inspected(), from = { 'nw-deploy': 'team:engineering', 'nw-house-style': 'workspace', 'nw-release-tooling': 'soul', 'nw.teams': 'workspace', 'oats.core': 'workspace', 'oats.okf': 'workspace' };
  for (const cap of v.capabilities) cap.composedFrom = from[cap.id];
  v.capabilitiesOff = [{ id: 'acme-lint', off: true, from: 'soul', reason: 'off', overrides: 'team:engineering' },
    { id: 'nw.tasks', off: true, from: 'soul', reason: 'slot-none', slot: 'tasks', overrides: 'workspace' }];
  return v;
}
const view = entries => entries.map(e => [e.cap?.id ?? e.name, e.why, ...(e.team ? [e.team] : [])]);

test('the gate: desktop facts are read only from a CLI that reports them', () => {
  assert.equal(desktopFacts({ features: ['desktop-facts'] }), true);
  assert.equal(desktopFacts({ features: ['layers-from'] }), false); assert.equal(desktopFacts(null), false);
});

test("with the facts, the kernel's composedFrom and capabilitiesOff say why, in layer order", () => {
  assert.deepEqual(view(compositionEntries(withFacts(), null, { facts: true })), [
    ['nw-house-style', 'workspace'], ['oats.core', 'workspace'], ['nw-deploy', 'team', 'engineering'], ['nw-release-tooling', 'soul'],
    ['acme-lint', 'off'], ['nw.tasks', 'off']], 'core capabilities (knowledge, messaging) stay on their cards');
  const off = compositionEntries(withFacts(), null, { facts: true }).filter(e => e.why === 'off');
  assert.deepEqual(off.map(whyTag), [
    ['turned off by soul', "This soul turns off the engineering team's default", true],
    ['turned off by soul', 'This soul empties the tasks slot, which the workspace default filled with nw.tasks', true]]);
  assert.deepEqual(whyTag({ why: 'team', team: 'engineering' }), ['team · engineering', 'A default of the engineering team', false]);
});

test('without the feature, or on an instance (composedFrom null), the page keeps reading the declarations', () => {
  assert.ok(compositionEntries(withFacts(), null, { facts: false }).every(e => e.why === 'default'), 'an older CLI: nothing is claimed');
  const home = withFacts(); for (const cap of home.capabilities) cap.composedFrom = null; home.capabilitiesOff = [];
  assert.ok(compositionEntries(home, null, { facts: true }).every(e => e.why === 'default'));
});

test('the soul table shows the tags with their reasons as titles', () => {
  const dom = new JSDOM('<!doctype html><body><div class="soul"></div></body>'), host = dom.window.document.querySelector('.soul');
  try {
    renderSoulCapabilities(host, { status: null, entries: compositionEntries(withFacts(), null, { facts: true }) });
    const rows = [...host.querySelectorAll('.soul-cap-row:not(.head)')].map(r => [r.dataset.capability, r.querySelector('.why-tag, .why-note').textContent, r.querySelector('.why-tag, .why-note').title]);
    assert.deepEqual(rows.map(r => r.slice(0, 2)), [['nw-house-style', 'workspace'], ['oats.core', 'workspace'], ['nw-deploy', 'team · engineering'],
      ['nw-release-tooling', 'soul'], ['acme-lint', 'turned off by soul'], ['nw.tasks', 'turned off by soul']]);
    assert.match(rows.at(-1)[2], /empties the tasks slot/);
  } finally { dom.window.close(); }
});
