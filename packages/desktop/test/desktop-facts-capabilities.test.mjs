import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { capabilitiesData } from '../deployment-data.mjs';
import { renderCapabilityPage } from '../renderer/capability-page.mjs';
import { renderCapabilities } from '../renderer/workspace-catalog.mjs';

// Kernel #217 (desktop-facts) on the capability views, from the real capture through the
// server's projection (#230): description, what it provides, its file and its fingerprint.
const capture = JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/desktop-facts/capabilities.json', import.meta.url), 'utf8'));
const rows = capabilitiesData(capture).capabilities;
const row = name => rows.find(r => r.name === name);

function page(t, target, options = {}) {
  const dom = new JSDOM('<!doctype html><body><main></main></body>'), host = dom.window.document.querySelector('main');
  t.after(() => dom.window.close());
  renderCapabilityPage(host, { row: target, status: null, instances: [], root: '/fx', onBack() {}, ...options });
  const facts = card => Object.fromEntries([...host.querySelectorAll(`.page-card[data-card="${card}"] .page-kv`)].map(r => [r.querySelector('dt').textContent, r.querySelector('dd').textContent]));
  const provides = kind => [...host.querySelectorAll(`.page-card[data-provides="${kind}"] .page-list-item`)].map(i => i.textContent);
  return { host, facts, provides, $: s => host.querySelector(s) };
}

test('a member capability: description, what it provides, its manifest path and its tree fingerprint', t => {
  const cap = row('nw-release-tooling'), u = page(t, cap);
  assert.equal(u.$('.page-lede').textContent, cap.description);
  assert.deepEqual([u.provides('skills'), u.provides('commands'), u.provides('hooks')], [['cut-release'], ['cut', 'verify'], []]);
  assert.equal(u.$('.page-card[data-provides="hooks"] .page-note').textContent, 'None');
  const from = u.facts('Comes from');
  assert.equal(from.Fingerprint, cap.tree.slice(0, 7)); assert.equal(from.File, 'capabilities/nw-release-tooling/oats.json');
  assert.equal(u.$('.page-card[data-card="Comes from"] button[data-verb=file]'), null, 'the capture\'s repos are local: no web address, the path shows');
});

test('a package capability keeps its lock integrity as fingerprint (tree is null); a core one says its layer', t => {
  const okf = row('oats.okf'), u = page(t, okf);
  assert.equal(okf.tree, null); assert.equal(okf.layer, 'knowledge', 'package rows carry layer now');
  assert.match(u.$('.page-title').textContent, /Core · Knowledge/);
  assert.deepEqual(u.provides('hooks'), ['retire', 'spawn']);
  assert.equal(Object.hasOwn(u.facts('Comes from'), 'File'), true);
});

test('skills a spawn could not list say so; a hosted manifest opens as its web page', t => {
  const url = 'https://github.com/northwind/agents/blob/abc/capabilities/nw-house-style/oats.json', opened = [];
  const u = page(t, { ...row('nw-house-style'), skills: null, file: { path: 'capabilities/nw-house-style/oats.json', url } }, { openExternal: link => opened.push(link) });
  assert.match(u.$('.page-card[data-provides="skills"] .page-note').textContent, /Not listable/);
  u.$('.page-card[data-card="Comes from"] button[data-verb=file]').click(); assert.deepEqual(opened, [url]);
});

test('an older kernel (no facts) shows none of it; the catalog table adds the description line', t => {
  const { description, skills, commands, hooks, file, tree, ...old } = row('nw-deploy');
  const u = page(t, old);
  assert.equal(u.$('.page-lede'), null); assert.equal(u.$('[data-provides]'), null); assert.equal(Object.hasOwn(u.facts('Comes from'), 'File'), false);
  const dom = new JSDOM('<!doctype html><body><div></div></body>'), host = dom.window.document.querySelector('div');
  t.after(() => dom.window.close());
  renderCapabilities(host, { rows: [row('nw-deploy'), old], status: null, instances: [] });
  const lines = [...host.querySelectorAll('.catalog-row:not(.head)')].map(r => r.querySelector('.catalog-desc')?.textContent ?? null);
  assert.deepEqual(lines, [description, null]);
});
