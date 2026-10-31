import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRosterTip, rosterTipFacts, rosterTipCSS } from '../renderer/roster-tip.mjs';
import { createContextPanel, contextPanelCSS } from '../renderer/context-panel.mjs';

const row = (version = '1.5.9', extra = {}) => ({
  instance: 'test-agent', agent: 'dev', home: '/synthetic/agent', harness: 'claude', running: true,
  modules: [{ name: 'oats.core', from: { kind: 'package', package: 'oats.framework', version } }], ...extra,
});
const HOVER = "Can't be reported: its oats.core is older than 2.4.0";
const note = version => `This agent can't report needs input: its oats.core (oats.framework ${version}) is older than 2.4.0. Upgrade or respawn it to get the marker.`;

function fixture(t) {
  const dom = new JSDOM('<!doctype html><body><button id="row">test-agent</button><aside id="context-panel"></aside></body>');
  const document = dom.window.document, root = document.getElementById('context-panel');
  const style = document.createElement('style'); style.textContent = contextPanelCSS + rosterTipCSS; document.head.append(style);
  const panel = createContextPanel({ document, root }), tip = createRosterTip(document), trigger = document.getElementById('row');
  let selected;
  tip.bind(trigger, () => rosterTipFacts(selected));
  // The card's keyboard path shows synchronously, without a hover timer.
  trigger.matches = selector => selector === ':focus-visible';
  const select = instance => { selected = instance; panel.setContext({ workspace: 'test', instance, key: instance.home }); trigger.dispatchEvent(new dom.window.FocusEvent('focus')); };
  const hoverFact = () => [...document.querySelectorAll('.ctx-tip-fact')].find(el => el.querySelector('dt').textContent === 'Needs input');
  t.after(() => { tip.hide(); panel.dispose(); dom.window.close(); });
  return { document, root, trigger, select, hoverFact };
}

test('the hover fact and Session note say the exact words, in DOM text associated with their cards', t => {
  const u = fixture(t);
  for (const version of ['1.5.9', '1.6.0-rc.1', '1.5.9+build.01']) {
    u.select(row(version));
    assert.equal(u.hoverFact().querySelector('dd').textContent, HOVER);
    assert.equal(u.hoverFact().parentElement.className, 'ctx-tip-facts', 'same grid as the other facts');
    const card = u.document.getElementById(u.trigger.getAttribute('aria-describedby'));
    assert.equal(card.getAttribute('role'), 'tooltip');
    assert.ok(card.contains(u.hoverFact()));
    const message = u.root.querySelector('.context-panel-session-note');
    assert.equal(message.hidden, false);
    assert.equal(message.textContent, note(version));
    assert.equal(message.childElementCount, 0, 'the recorded version is inserted as text');
    assert.equal(message.previousElementSibling.className, 'context-panel-session-lines', 'under the session lines');
    assert.ok(message.closest('.context-panel-session'));
    assert.ok(message.classList.contains('context-panel-note'), 'uses the existing muted note token');
    assert.equal(u.trigger.textContent, 'test-agent', 'row label is unchanged');
    assert.equal(u.document.querySelector('.ctx-attn, .needs-input-mark'), null, 'no claim pill');
  }
});

test('both explanations clear on upgrade or selection and stay absent without the exact evidence', t => {
  const u = fixture(t);
  for (const next of [row('1.6.0'), row('1.6.0+build'), row('1.5.9', { harness: 'pi' }),
    row('1.5.9', { modules: null }), row('1.5.9', { modules: undefined }), row('<img src=x>'),
    row('1.5.9', { modules: { 'oats.core': { from: { kind: 'member', version: '1.5.9' } } } }),
  ]) {
    u.select(row());
    assert.ok(u.hoverFact());
    u.select(next);
    assert.equal(u.hoverFact(), undefined);
    const message = u.root.querySelector('.context-panel-session-note');
    assert.equal(message.hidden, true);
    assert.equal(message.textContent, '', 'no stale or malformed version remains in the DOM');
  }
});
