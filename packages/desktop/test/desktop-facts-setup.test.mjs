// Kernel #217 desktop facts on the Setup tab (views only): the workspace and
// membership files, this computer's clones, available package versions,
// disabled souls and the lock file, read from the real capture through the
// server projection. An older kernel reports none of them and Setup is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { workspaceStatusData } from '../../client/deployment-data.mjs';
import { renderSetup, setupCSS, teamsBox } from '../renderer/workspace-setup.mjs';

const DEPLOYMENT = '/fixture/base/northwind-workspace';
const capture = () => JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/desktop-facts/workspace-status.json', import.meta.url), 'utf8'));
const statusOf = (edit = () => {}) => { const doc = capture(); edit(doc.result); return workspaceStatusData(doc, DEPLOYMENT); };
const host = () => { const doc = new JSDOM('<!doctype html><body></body>').window.document; return doc.body.appendChild(doc.createElement('div')); };
const local = root => Object.fromEntries([...root.querySelectorAll('[data-box="This computer"] > dl:not([aria-label]) .setup-kv')].map(r => [r.querySelector('dt').textContent, r.querySelector('dd')]));
const MARKETING = 'local//fixture/base/fx/remotes/marketing.git';
// The captured workspace commit (a fresh Northwind build each capture), shown short.
const SHORT = capture().result.workspace.commit.slice(0, 7);

test('Setup names the files the kernel reports, and links them only when they have a web address', () => {
  const plain = host();
  renderSetup(plain, { status: statusOf(), openExternal: () => assert.fail('no url, no link') });
  const where = plain.querySelector('.setup-lede-where');
  assert.match(where.textContent, new RegExp(`^declared in agents's oats-workspace\\.yaml @ ${SHORT}$`));
  assert.equal(where.querySelector('button'), null, 'the capture has url: null, so the path is plain text');
  renderSetup(plain, { status: statusOf(), view: 'graph', selected: MARKETING, onSelect() {}, openExternal: () => assert.fail() });
  const subs = [...plain.querySelectorAll('.setup-panel .setup-hand-sub')].map(s => s.textContent);
  assert.deepEqual(subs, ["in agents's oats-workspace.yaml", "The repo's oats-membership.yaml names this workspace"]);
  assert.equal(plain.querySelector('.setup-panel [data-verb=repo]'), null, 'no repository link without a web address');

  const opened = [], hosted = host();
  const status = statusOf(r => {
    r.workspace.file.url = `https://github.com/northwind/agents/blob/${SHORT}/oats-workspace.yaml`;
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
  assert.match(root.querySelector('.setup-lede-where').textContent, new RegExp(`'s workspace file @ ${SHORT}$`));
  assert.equal(root.querySelector('dl[aria-label="Member clones"]'), null);
  assert.deepEqual(Object.keys(local(root)).filter(k => ['Lock file', 'Disabled souls'].includes(k)), []);
  renderSetup(root, { status, view: 'graph', selected: MARKETING, onSelect() {} });
  assert.deepEqual([...root.querySelectorAll('.setup-panel .setup-hand-sub')].map(s => s.textContent), ["in agents's workspace file", "The repo's membership file names this workspace"]);
  assert.equal(root.querySelector('.setup-panel [data-clone]'), null);
});

test('Defaults shows the workspace slots and default capabilities as declared; each team says what it adds or turns off', () => {
  const root = host();
  const status = statusOf(r => r.defaults.byTeam.engineering.capabilities.push({ name: 'nw-house-style', from: null, off: true }));
  renderSetup(root, { status });
  // Teams moved to the Workspace's own Teams tab (human, 2026-09-28): Setup no longer has the box.
  assert.deepEqual([...root.querySelectorAll('.setup-box, .setup-local')].map(b => b.dataset.box), ['Members', 'Packages', 'Defaults', 'This computer']);
  root.append(teamsBox(root.ownerDocument, { status }));
  const rows = Object.fromEntries([...root.querySelectorAll('[data-box=Defaults] .setup-def')].map(r => [r.dataset.slot, r.querySelector('dd')]));
  assert.deepEqual(Object.keys(rows), ['knowledge', 'messaging', 'tasks', 'capabilities']);
  assert.equal(rows.knowledge.textContent, 'oats.okfpackage');
  assert.equal(rows.messaging.textContent, 'none'); assert.ok(rows.messaging.classList.contains('muted'));
  assert.deepEqual([...rows.capabilities.querySelectorAll('.setup-def-cap')].map(c => [c.dataset.capability, c.querySelector('.setup-def-from').textContent]),
    [['nw-house-style', 'agents'], ['oats.core', 'package']], 'a member key reads as the member name');
  const team = label => root.querySelector(`[data-team-defaults="${label}"]`);
  assert.equal(team('global'), null, 'a team that adds nothing says nothing');
  assert.deepEqual([...team('engineering').children].map(part => part.firstChild.textContent), ['adds ', 'turns off ']);
  const off = team('engineering').querySelector('.setup-def-cap.off');
  assert.equal(off.dataset.capability, 'nw-house-style'); assert.equal(off.querySelector('.setup-def-from'), null, '"turns off" already says it');
  assert.equal(team('marketing').textContent, 'adds nw-brand-voicemarketing');
});

test('Defaults: a null slot reads "not set"; a standalone deployment (no defaults) and an older kernel show no Defaults box', () => {
  const root = host();
  renderSetup(root, { status: statusOf(r => { r.defaults.slots.tasks = null; }) });
  assert.equal(root.querySelector('[data-box=Defaults] [data-slot=tasks] dd').textContent, 'not set');
  renderSetup(root, { status: statusOf(r => { r.defaults = { slots: { knowledge: null, messaging: null, tasks: null }, capabilities: [], byTeam: {} }; }) });
  assert.equal(root.querySelector('[data-box=Defaults]'), null, 'standalone: the workspace declares no defaults');
  renderSetup(root, { status: statusOf(r => { delete r.defaults; }) });
  assert.equal(root.querySelector('[data-box=Defaults]'), null); assert.equal(root.querySelector('[data-team-defaults]'), null);
});

// Spec A (Setup roles): the host (it holds the workspace file) and the members (trusted for their souls and
// capabilities) at a glance: a legend under the lede, the host's row first with Host · <file>, and Member on
// every member row, the host's included. File names only as the kernel reports them.
const AGENTS = 'local//fixture/base/fx/remotes/agents.git';
test('Setup list: the legend names the files the kernel reports; the host leads with Host · its file, and every member says Member', () => {
  const root = host();
  // The host listed last: the view still puts it first, the others in the kernel's order.
  renderSetup(root, { status: statusOf(r => { r.members.push(r.members.shift()); }) });
  const header = root.querySelector('.setup > .setup-header');
  assert.deepEqual([...header.children].map(c => c.className), ['setup-lede', 'setup-legend'], 'the lede and the legend read as one header');
  assert.equal(header.querySelector('.setup-legend').textContent,
    "Hostholds oats-workspace.yaml, the workspace's declarationsMemberbacklinks with oats-membership.yaml; its souls and capabilities are trustedThe host is a member too.");
  assert.deepEqual([...root.querySelectorAll('.setup-legend .setup-badge')].map(b => [b.textContent, b.className]), [['Host', 'setup-badge host'], ['Member', 'setup-badge member']]);
  assert.equal(root.querySelector('[data-box=Members] .setup-box-lead').textContent, 'repos the workspace trusts for souls and capabilities · always latest');
  const rows = [...root.querySelectorAll('[data-box=Members] .setup-row[data-member]')];
  assert.deepEqual(rows.map(r => r.querySelector('.setup-name-text').textContent), ['agents', 'platform', 'data', 'marketing', 'nw-tools'], 'host first');
  assert.deepEqual(rows.map(r => [...r.querySelectorAll('.setup-badge')].map(b => b.textContent)),
    [['Host·oats-workspace.yaml', 'Member'], ['Member'], ['Member'], ['Member'], ['Member']], 'Member on every row, the host included');
  assert.equal(rows[0].dataset.member, AGENTS);
  assert.equal(rows[0].querySelector('.setup-badge.host button'), null, 'no web address: the file name is plain text');
  assert.equal(root.querySelector('.setup-host'), null, 'the old lowercase tag is gone');
  // The graph keeps its lede alone (no legend) and says the host is a member too.
  renderSetup(root, { status: statusOf(), view: 'graph', onSelect() {} });
  assert.equal(root.querySelector('.setup-legend'), null);
  assert.ok(root.querySelector('.setup > .setup-lede'));
  const leaf = root.querySelector(`.setup-node[data-member="${AGENTS}"]`);
  assert.equal(leaf.querySelector('.setup-node-meta').textContent, 'host · member · 2 souls');
  assert.equal(leaf.getAttribute('aria-label'), 'agents: host · member · 2 souls — show its membership');
  assert.equal(root.querySelector('.setup-node[data-member$="platform.git"] .setup-node-meta').textContent, '2 souls');
});

test('Setup list: the Host badge links its file when the kernel gives a web address; an older kernel keeps generic words', () => {
  const opened = [], root = host();
  const url = `https://github.com/northwind/agents/blob/${SHORT}/oats-workspace.yaml`;
  renderSetup(root, { status: statusOf(r => { r.workspace.file.url = url; }), openExternal: u => opened.push(u) });
  const link = root.querySelector('[data-box=Members] .setup-badge.host button.setup-file');
  assert.equal(link.textContent, 'oats-workspace.yaml'); assert.equal(link.getAttribute('aria-label'), 'Open oats-workspace.yaml');
  link.click(); assert.deepEqual(opened, [url]);
  const old = host();
  renderSetup(old, { status: statusOf(r => { delete r.workspace.file; for (const m of r.members) delete m.membershipFile; }) });
  assert.equal(old.querySelector('.setup-legend').textContent,
    "Hostholds the workspace file, the workspace's declarationsMemberbacklinks with a membership file; its souls and capabilities are trustedThe host is a member too.");
  assert.doesNotMatch(old.querySelector('.setup').textContent, /oats-workspace\.yaml|oats-membership\.yaml/, 'never a guessed file name');
  assert.deepEqual([...old.querySelectorAll('[data-box=Members] .setup-row')[0].querySelectorAll('.setup-badge')].map(b => b.textContent), ['Host', 'Member']);
});

test('Setup list: hostile names and file paths render literally', () => {
  const root = host(), hostile = '<img src=x onerror=alert(1)>';
  renderSetup(root, { status: statusOf(r => { r.workspace.file.path = hostile; r.members[0].name = hostile; r.members[1].membershipFile.path = hostile; }) });
  assert.equal(root.querySelector('img'), null);
  assert.ok(root.querySelector('.setup-legend').textContent.includes(hostile));
  assert.equal(root.querySelector('[data-box=Members] .setup-row .setup-name-text').textContent, hostile);
});

test('Setup list: the rows switch to two lines by their own box\'s width (the sidebar takes part of the tab), and badges wrap, never overflow', () => {
  const rule = selector => { const m = setupCSS.match(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'm')); assert.ok(m, selector); return m[1]; };
  assert.match(rule('.setup-box[data-box=Members], .setup-box[data-box=Packages]'), /container:setup-rows \/ inline-size/);
  assert.match(setupCSS, /@container setup-rows \(max-width: 960px\) \{\n \.setup-row \{ grid-template-columns:130px minmax\(0,1fr\) auto;/);
  assert.match(rule('.setup-badges'), /flex-wrap:wrap;.*min-width:0/);
});
