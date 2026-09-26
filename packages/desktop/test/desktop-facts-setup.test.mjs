// Kernel #217 desktop facts on the Setup tab (views only): the workspace and
// membership files, this computer's clones, available package versions,
// disabled souls and the lock file, read from the real capture through the
// server projection. An older kernel reports none of them and Setup is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { workspaceStatusData } from '../deployment-data.mjs';
import { renderSetup } from '../renderer/workspace-setup.mjs';

const DEPLOYMENT = '/fixture/base/northwind-workspace';
const capture = () => JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/desktop-facts/workspace-status.json', import.meta.url), 'utf8'));
const statusOf = (edit = () => {}) => { const doc = capture(); edit(doc.result); return workspaceStatusData(doc, DEPLOYMENT); };
const host = () => { const doc = new JSDOM('<!doctype html><body></body>').window.document; return doc.body.appendChild(doc.createElement('div')); };
const local = root => Object.fromEntries([...root.querySelectorAll('[data-box="This computer"] > dl:not([aria-label]) .setup-kv')].map(r => [r.querySelector('dt').textContent, r.querySelector('dd')]));
const MARKETING = 'local//fixture/base/fx/remotes/marketing.git';

test('Setup names the files the kernel reports, and links them only when they have a web address', () => {
  const plain = host();
  renderSetup(plain, { status: statusOf(), openExternal: () => assert.fail('no url, no link') });
  const where = plain.querySelector('.setup-lede-where');
  assert.match(where.textContent, /^declared in agents's oats-workspace\.yaml @ 5ce1d9b$/);
  assert.equal(where.querySelector('button'), null, 'the capture has url: null, so the path is plain text');
  renderSetup(plain, { status: statusOf(), view: 'graph', selected: MARKETING, onSelect() {}, openExternal: () => assert.fail() });
  const subs = [...plain.querySelectorAll('.setup-panel .setup-hand-sub')].map(s => s.textContent);
  assert.deepEqual(subs, ["in agents's oats-workspace.yaml", "The repo's oats-membership.yaml names this workspace"]);
  assert.equal(plain.querySelector('.setup-panel [data-verb=repo]'), null, 'no repository link without a web address');

  const opened = [], hosted = host();
  const status = statusOf(r => {
    r.workspace.file.url = 'https://github.com/northwind/agents/blob/5ce1d9b/oats-workspace.yaml';
    const m = r.members.find(x => x.key === MARKETING);
    m.url = 'https://github.com/northwind/marketing/tree/abc'; m.membershipFile.url = 'https://github.com/northwind/marketing/blob/abc/oats-membership.yaml';
  });
  renderSetup(hosted, { status, view: 'graph', selected: MARKETING, onSelect() {}, openExternal: url => opened.push(url) });
  hosted.querySelector('.setup-lede-where button.setup-file').click();
  hosted.querySelector('.setup-panel .setup-hand-sub button.setup-file[aria-label="Open oats-membership.yaml"]').click();
  hosted.querySelector('.setup-panel [data-verb=repo]').click();
  assert.deepEqual(opened, [status.workspace.file.url, status.members.find(x => x.key === MARKETING).membershipFile.url, 'https://github.com/northwind/marketing/tree/abc']);
});

test('This computer shows the lock file, disabled souls and each member clone; a package with a newer catalog version says so', () => {
  const root = host();
  const status = statusOf(r => {
    r.packages.find(p => p.id === 'oats.okf').latest = { version: '4.0.0', ref: 'v4.0.0' };
    Object.assign(r.clones.find(c => c.name === 'data'), { path: null, rule: null });
    Object.assign(r.clones.find(c => c.name === 'marketing'), { path: null, rule: null, problem: { code: 'E_CLONE_MISMATCH', message: 'marketing is not a clone of this member' } });
  });
  renderSetup(root, { status });
  const kv = local(root);
  assert.equal(kv['Lock file'].textContent, 'oats-lock.json', 'relative to the deployment folder');
  assert.equal(kv['Lock file'].title, `${DEPLOYMENT}/oats-lock.json · lockfile version 3`);
  assert.equal(kv['Disabled souls'].textContent, 'campaign-writer');
  const clones = Object.fromEntries([...root.querySelectorAll('dl[aria-label="Member clones"] .setup-kv')].map(r => [r.querySelector('dt').textContent, r.querySelector('dd')]));
  assert.deepEqual(Object.keys(clones), ['agents', 'platform', 'data', 'marketing', 'nw-tools']);
  assert.equal(clones.agents.textContent, 'agents-repo');
  assert.equal(clones.agents.title, `${DEPLOYMENT}/agents-repo · beside the deployment`);
  assert.equal(clones.data.textContent, 'not cloned here');
  assert.equal(clones.marketing.textContent, 'marketing is not a clone of this member', 'the refusal a spawn would meet, verbatim');
  assert.ok(clones.marketing.classList.contains('warn') && clones.marketing.classList.contains('wrap'), 'a refusal wraps, never cropped');
  const ends = Object.fromEntries([...root.querySelectorAll('[data-box=Packages] .setup-row')].map(r => [r.dataset.package, r.querySelector('.setup-end').textContent]));
  assert.deepEqual(ends, { 'nw.tools': 'locked', 'oats.framework': 'locked', 'oats.okf': '4.0.0 available' });
  renderSetup(root, { status, view: 'graph', selected: MARKETING, onSelect() {} });
  assert.equal(root.querySelector('.setup-node[data-package="oats.okf"] .setup-node-meta').textContent, '4.0.0 available');
  assert.equal(root.querySelector('.setup-panel [data-clone] p').textContent, 'marketing is not a clone of this member');
});

test('an older kernel (no desktop facts) keeps the generic words and shows no clones, lock file or disabled souls', () => {
  const root = host();
  const status = statusOf(r => { delete r.workspace.file; for (const m of r.members) { delete m.url; delete m.membershipFile; } for (const p of r.packages) delete p.latest; for (const k of ['defaults', 'clones', 'disabledSouls', 'lock']) delete r[k]; });
  renderSetup(root, { status });
  assert.match(root.querySelector('.setup-lede-where').textContent, /'s workspace file @ 5ce1d9b$/);
  assert.equal(root.querySelector('dl[aria-label="Member clones"]'), null);
  assert.deepEqual(Object.keys(local(root)).filter(k => ['Lock file', 'Disabled souls'].includes(k)), []);
  renderSetup(root, { status, view: 'graph', selected: MARKETING, onSelect() {} });
  assert.deepEqual([...root.querySelectorAll('.setup-panel .setup-hand-sub')].map(s => s.textContent), ["in agents's workspace file", "The repo's membership file names this workspace"]);
  assert.equal(root.querySelector('.setup-panel [data-clone]'), null);
});
