// F3b-1: a v2 soul is edited in its repository. The inspector names where
// (from the `oats souls` source: repoKey, commit, path) and links hosted
// repositories; it never edits a declared soul in place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { soulRepository } from '../renderer/soul-repository.mjs';
import { createSoulInspector, capabilityFacts, reportedText } from '../renderer/soul-inspector.mjs';
import { createReadinessView } from '../renderer/readiness-view.mjs';
import { cliStatus } from '../renderer/views/cli-status.mjs';
import { postJson, wsQuery, workspaceGeneration, setWorkspace, currentWorkspace } from '../renderer/views/common.mjs';
import { runtimeState } from '../renderer/instance-presentation.mjs';
import { createSoulMark } from '../renderer/identity-marks.mjs';
import { renderSoulDeclarations } from '../renderer/soul-declarations.mjs';
import { iconElement } from '../renderer/shell-icons.mjs';

// Kernel-captured catalog rows (f3/souls.json: local member keys) and the
// kernel API document's hosted example (docs/desktop-cli-api.md, `oats souls`).
const captured = JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/f3/souls.json', import.meta.url), 'utf8')).result.souls;
const hosted = { repoKey: 'github.com/acme/agents', commit: '3f2a9c1e'.padEnd(40, '0'), path: 'souls/release-manager' };

test('local member: the repository is the directory on this machine; no link', () => {
  const row = captured.find(s => s.name === 'release-manager');
  const where = soulRepository(row);
  assert.deepEqual(where, { repository: row.repoKey.slice('local/'.length), path: row.path, url: null });
  for (const soul of captured) assert.equal(soulRepository(soul).url, null, soul.name);
});

test('hosted keys: github.com links the soul directory at its resolved commit; other hosts link the repository home', () => {
  assert.deepEqual(soulRepository(hosted), { repository: 'github.com/acme/agents', path: 'souls/release-manager',
    url: `https://github.com/acme/agents/tree/${hosted.commit}/souls/release-manager` });
  assert.equal(soulRepository({ ...hosted, repoKey: 'gitlab.example.org/team/agents' }).url, 'https://gitlab.example.org/team/agents');
  assert.equal(soulRepository({ ...hosted, commit: null }).url, 'https://github.com/acme/agents', 'no resolved commit: the repository home');
  assert.equal(soulRepository({ ...hosted, repoKey: 'github.com/acme/agents/sub' }).url, 'https://github.com/acme/agents/sub', 'not owner/repo: home only');
});

test('only well-formed sources are named or linked', () => {
  for (const repoKey of ['', 'javascript:alert(1)', 'https://github.com/acme/agents', 'github.com', 'github.com/../x', 'evil host/x', 'github.com/a b/c', 'local/relative', 'local/\0x', null, 42]) {
    assert.equal(soulRepository({ ...hosted, repoKey }), null, String(repoKey));
  }
  for (const path of ['../secrets', '/etc', 'souls//x', 'souls/<b>', 'souls/%2e%2e']) {
    const where = soulRepository({ ...hosted, path });
    assert.equal(where.path, null, path); assert.equal(where.url, 'https://github.com/acme/agents', `${path}: never linked into the tree`);
  }
  assert.equal(soulRepository(undefined), null);
});

const tick = () => new Promise(resolve => setImmediate(resolve));
function ui(soulSource, factory = createSoulInspector) {
  const previous = currentWorkspace(); setWorkspace('/team');
  const dom = new JSDOM('<body><main><aside hidden></aside></main></body>'); const el = dom.window.document.querySelector('aside');
  const opened = [];
  const inspect = { operationsApi: 1, scope: { context: '/team' }, selected: { source: 'config' }, layers: {}, capabilities: [], souls: [] };
  const controller = factory(el, { ctx: { api: async () => inspect, openExternal: url => opened.push(url) } });
  const agent = name => ({ name, agentsRoot: '/team/agents', soulSource });
  return { el, opened, controller, show: name => controller.show({ agent: agent(name), selector: { soul: name, agentsRoot: '/team/agents' } }),
    open: () => [...el.querySelectorAll('button')].find(b => b.textContent === 'Open repository'),
    close() { controller.dispose(); dom.window.close(); setWorkspace(previous); } };
}

test('inspector: "Edit this soul in its repository" names the path and opens exactly the hosted link', async () => {
  const view = ui(hosted);
  try {
    await view.show('release-manager'); await tick();
    const block = view.el.querySelector('.inspector-repository');
    assert.equal(block.querySelector('h3').textContent, 'Edit this soul in its repository');
    assert.equal(block.querySelector('p').textContent, 'souls/release-manager in github.com/acme/agents');
    view.open().click();
    assert.deepEqual(view.opened, [`https://github.com/acme/agents/tree/${hosted.commit}/souls/release-manager`]);
  } finally { view.close(); }
});

test('inspector: a local member names its directory without a link; an unreported source says so', async () => {
  const row = captured.find(s => s.name === 'release-manager');
  const local = ui({ repoKey: row.repoKey, commit: row.commit, path: row.path });
  try {
    await local.show('release-manager');
    assert.equal(local.el.querySelector('.inspector-repository p').textContent, `${row.path} in ${row.repoKey.slice('local/'.length)}`);
    assert.equal(local.open(), undefined);
  } finally { local.close(); }
  const unknown = ui(null);
  try {
    await unknown.show('release-manager');
    assert.equal(unknown.el.querySelector('.inspector-repository p').textContent, 'Its repository is not reported.');
    assert.equal(unknown.open(), undefined);
  } finally { unknown.close(); }
});

async function staleOpen(factory) {
  const view = ui(hosted, factory);
  try {
    await view.show('release-manager'); const old = view.open();
    await view.show('other');
    old.click(); // a control from the replaced selection
    assert.deepEqual(view.opened, [], 'a stale control never opens a link');
    view.open().click(); assert.equal(view.opened.length, 1);
  } finally { view.close(); }
}
test('inspector: a control from a replaced selection cannot open its link', () => staleOpen());
test('mutation: the open guard is what refuses the stale control', async () => {
  const source = createSoulInspector.toString(), guard = 'if (valid(id, gen) && open.isConnected && typeof';
  assert.equal(source.split(guard).length, 2);
  const mutant = runInNewContext(`(${source.replace(guard, 'if (typeof')})`, { postJson, wsQuery, workspaceGeneration, runtimeState, capabilityFacts, reportedText,
    createSoulMark, renderSoulDeclarations, createReadinessView, cliStatus, iconElement, soulRepository });
  await assert.rejects(staleOpen(mutant), /a stale control never opens a link/);
});
