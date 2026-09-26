// Roster PR badges (forge-roster, #234): each local instance's pull request on its
// roster row — the number and state beside the name, the link in the row tools —
// read at most once a minute, nothing when gh is unavailable, never a guess.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import * as tree from '../renderer/instance-tree.mjs';
import { instanceActions, captureInstanceActionMenu } from '../renderer/instance-actions.mjs';
import { instanceActionTarget, sameInstanceActionTarget } from '../renderer/instance-action-target.mjs';
import { instanceSplitPlan } from '../renderer/instance-split.mjs';
import { runtimeState } from '../renderer/instance-presentation.mjs';
import { createRuntimeBadge } from '../renderer/identity-marks.mjs';
import { iconElement } from '../renderer/shell-icons.mjs';
import { rosterTipFacts } from '../renderer/roster-tip.mjs';
import { createRosterPrs, rosterPrRow, prChip, prState, prText, ROSTER_PR_TTL } from '../renderer/roster-pr.mjs';

const pr = (home, extra = {}) => ({ home, number: 231, state: 'OPEN', isDraft: false, url: 'https://github.com/awebai/oats/pull/231', ...extra });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('a row is shown only with the documented fields; a non-https url is no link', () => {
  assert.deepEqual(rosterPrRow(pr('/h')), pr('/h'));
  assert.equal(rosterPrRow(pr('/h', { url: null })).url, null);
  assert.equal(rosterPrRow(pr('/h', { url: 'http://example.test/1' })).url, null);
  for (const bad of [null, pr(''), pr('/h', { number: 0 }), pr('/h', { number: '231' }), pr('/h', { state: 'open' }), pr('/h', { isDraft: 'no' })]) assert.equal(rosterPrRow(bad), null);
});

test('the chip says its number, and its state when not open; a draft is dashed and muted, never faded', () => {
  const doc = new JSDOM('').window.document;
  const cases = [[pr('/h'), 'open', '#231'], [pr('/h', { isDraft: true }), 'draft', '#231 draft'], [pr('/h', { state: 'MERGED' }), 'merged', '#231 merged'], [pr('/h', { state: 'CLOSED', isDraft: true }), 'closed', '#231 closed']];
  for (const [row, state, text] of cases) {
    const chip = prChip(doc, row);
    assert.equal(prState(row), state); assert.equal(chip.dataset.prState, state);
    assert.equal(chip.textContent, text); assert.equal(chip.getAttribute('aria-label'), `pull request ${prText(row)}`);
    assert.equal(chip.querySelector('svg').getAttribute('aria-hidden'), 'true');
  }
  const css = readFileSync(new URL('../renderer/roster-pr.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /opacity/, 'state by colour tokens, never opacity');
});

test('reads once a minute per workspace; gh unavailable clears; busy or failed keeps; a switch clears and ignores the old answer', async () => {
  let clock = 0, changes = 0; const calls = [], answers = [];
  const prs = createRosterPrs({ now: () => clock, onChange: () => changes++, request: ws => { calls.push(ws); return answers.shift()(ws); } });
  assert.equal(prs.refresh(null), null); assert.deepEqual(calls, [], 'no workspace (or a remote one): no read');
  answers.push(() => ({ forgeApi: 1, status: 'ok', rows: [pr('/a'), { home: '/b', bogus: true }], reason: null }));
  await prs.refresh('A');
  assert.deepEqual(prs.get('/a'), pr('/a')); assert.equal(prs.get('/b'), null); assert.equal(changes, 1);
  clock += ROSTER_PR_TTL - 1; prs.refresh('A'); await tick();
  assert.deepEqual(calls, ['A'], 'the server caches for 60 s; so does the roster');
  clock += 1; answers.push(() => ({ status: 'ok', rows: [pr('/a')] })); await prs.refresh('A');
  assert.equal(calls.length, 2); assert.equal(changes, 1, 'the same rows: no re-render');
  clock += ROSTER_PR_TTL; answers.push(() => ({ status: 'unavailable', rows: null, reason: { code: 'E_FORGE_BUSY' } })); await prs.refresh('A');
  assert.deepEqual(prs.get('/a'), pr('/a'), 'busy: keep what was shown');
  clock += ROSTER_PR_TTL; answers.push(() => Promise.reject(new Error('down'))); await prs.refresh('A');
  assert.deepEqual(prs.get('/a'), pr('/a'), 'failed: keep what was shown');
  clock += ROSTER_PR_TTL; answers.push(() => ({ status: 'unavailable', rows: null, reason: { code: 'E_GH_UNAVAILABLE' } })); await prs.refresh('A');
  assert.equal(prs.get('/a'), null, 'gh missing or signed out: nothing'); assert.equal(changes, 2);
  // A switch clears at once; an answer for the old workspace is dropped.
  clock += ROSTER_PR_TTL; let release; answers.push(() => new Promise(r => { release = r; }));
  answers.push(() => ({ status: 'ok', rows: [pr('/b')] }));
  const stale = prs.refresh('A'); await tick();
  await prs.refresh('B'); release({ status: 'ok', rows: [pr('/a')] }); await stale;
  assert.equal(prs.get('/a'), null); assert.deepEqual(prs.get('/b'), pr('/b'));
});

test('the shipped roster row: the chip beside the name, the link in the row tools, the PR in the hover card', t => {
  const read = name => readFileSync(new URL(`../renderer/${name}`, import.meta.url), 'utf8');
  const source = read('shell.mjs').match(/function renderContextRoster\(instances\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source, 'exercise the shipped roster composition');
  const dom = new JSDOM(read('index.html')); t.after(() => dom.window.close());
  const doc = dom.window.document;
  const row = (name, extra = {}) => ({ instance: name, home: `/synthetic/${name}`, agentsRoot: '/synthetic/agents', repoName: 'oats', branch: `b/${name}`, running: true, ...extra });
  const roster = [row('with-pr'), row('draft-no-url'), row('none'), row('remote', { server: 'http://remote' })];
  const rows = new Map([[roster[0].home, pr(roster[0].home)], [roster[1].home, pr(roster[1].home, { number: 7, isDraft: true, url: null })], [roster[3].home, pr(roster[3].home)]]);
  const opened = [], tips = new Map();
  const context = {
    ...tree, document: doc, instanceActions, captureInstanceActionMenu, runtimeState, createRuntimeBadge, instanceActionTarget, instanceSplitPlan,
    iconElement, prChip, prText, rosterPrs: { get: home => rows.get(home) ?? null }, ctx: { openExternal: url => opened.push(url) },
    rosterTip: { bind(el, facts) { tips.set(el.dataset.treeInstance, facts); }, hide() {}, sync() {} }, rosterTipFacts,
    connectionGeneration: 0, menuState() {}, runAction: assert.fail, getBinding: () => null, formatChord: c => c, isMac: true,
    contextRosterEl: doc.querySelector('#instance-roster'), contextFilter: '', contextWorkspace: 'A', contextInstances: roster,
    currentWorkspace: () => 'A', workspaceGeneration: () => 0, collapsedInstances: new Set(), tabs: new Map(), activeTab: null,
    tabOpenIntents: { applyFocus: fn => fn() }, openTerminalTab: assert.fail, openInstanceStart: assert.fail, onRosterRowKey: assert.fail,
    api: assert.fail, showStage: assert.fail, updateActiveContexts() {}, applyChordTitles() {},
  };
  context.splitOpenState = () => ({ split: null, activeId: null, tabs: context.tabs, workspace: 'A', visible: false });
  context.ownsInstanceTarget = target => roster.filter(r => sameInstanceActionTarget(target, r, 'A')).length === 1;
  runInNewContext(`${source}\nrenderContextRoster`, context)(roster);
  const at = name => [...doc.querySelectorAll('.ctx-tree-row')].find(r => r.querySelector('.ctx-name').textContent === name);
  const withPr = at('with-pr');
  const chip = withPr.querySelector('.ctx-name-line > .ctx-pr');
  assert.equal(chip.textContent, '#231'); assert.equal(chip.previousElementSibling.className, 'ctx-name', 'right after the name');
  assert.equal(withPr.querySelector('.ctx-inst a, .ctx-inst button'), null, 'the row button holds no nested control');
  const open = withPr.querySelector('.ctx-row-tools button.ctx-pr-open');
  assert.equal(open.getAttribute('aria-label'), "Open with-pr's pull request #231 · open on GitHub");
  open.click(); assert.deepEqual(opened, ['https://github.com/awebai/oats/pull/231']);
  assert.deepEqual(tips.get(withPr.querySelector('.ctx-inst').dataset.treeInstance)().rows.at(-1), ['Pull request', '#231 · open', 'mono']);
  const draft = at('draft-no-url');
  assert.equal(draft.querySelector('.ctx-pr').dataset.prState, 'draft');
  assert.equal(draft.querySelector('.ctx-pr-open'), null, 'no web address: no link');
  assert.equal(at('none').querySelector('.ctx-pr, .ctx-pr-open, .ctx-name-line'), null, 'no PR: the row is unchanged');
  assert.equal(at('remote').querySelector('.ctx-pr'), null, 'a remote instance never shows a local read');
});
