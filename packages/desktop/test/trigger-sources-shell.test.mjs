// "Open capability" from a trigger's source, through the shell-to-view boundary: the SHIPPED shell code that puts
// `openCapability` on the views' context (renderer/shell.mjs) is executed, and that same context object is given
// to the real Triggers page (mountAutomationsPage). Only the module loader, the stage switch and the HTTP boundary
// are synthetic. A callback the page is not given (one defined anywhere but on `ctx`) offers no button: that is
// what this file is for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { mountAutomationsPage } from '../renderer/views/automations.mjs';
import { setWorkspace, currentWorkspace } from '../renderer/views/common.mjs';
import { createSelectionOwnership } from '../renderer/selection-ownership.mjs';

const source = readFileSync(new URL('../renderer/shell.mjs', import.meta.url), 'utf8');
const doc = name => JSON.parse(readFileSync(new URL(`./fixtures/trigger-sources/${name}.json`, import.meta.url), 'utf8'));
const CLI = { ok: true, bin: '/fixture/oats', features: ['schedule', 'triggers', 'automations', 'trigger-sources'], automationsApi: 1 };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

/** The shell's own composition of `ctx.openCapability`, over a context whose other callbacks record. */
function shell(t, { catalog = [{ name: 'acme.graph', kind: 'member' }] } = {}) {
  const previous = currentWorkspace(); setWorkspace('/team');
  const setup = source.match(/const tabOpenIntents = [^\n]+/)[0];
  const composed = source.match(/\nctx\.openCapability = async \(name\) => \{[^]*?\n\};/)?.[0];
  assert.ok(composed, 'the shell puts openCapability on ctx, the object every view is mounted with');
  assert.ok(composed.includes('await import("./views/spawn.mjs")'));
  const loads = [], stages = [], notices = [], requests = [];
  let generation = 0;
  const c = {
    createSelectionOwnership, currentWorkspace, workspaceGeneration: () => generation,
    loadSpawn() { const gate = deferred(); loads.push(gate); return gate.promise; },
    showStage: async name => { stages.push(name); },
    ctx: { notify: text => notices.push(text), api: async (path, opts) => {
      const body = JSON.parse(opts.body), route = path.split('?')[0]; requests.push([route, body]);
      if (route === '/api/workspace-sync') return { status: 'ok', capabilities: { capabilities: catalog } };
      if (route !== '/api/automations') return {};
      return { automationsViewApi: 1, status: 'ok', kind: body.kind, action: body.action, reason: null, result: doc(body.action === 'list' ? 'trigger-list' : 'trigger-status-good').result };
    } },
  };
  const s = runInNewContext(`${setup}\n${composed.replace('import("./views/spawn.mjs")', 'loadSpawn()')}\n({ tabOpenIntents });`, c);
  const dom = new JSDOM('<!doctype html><body><main></main></body>', { pretendToBeVisual: true });
  const el = dom.window.document.querySelector('main');
  const page = mountAutomationsPage(el, c.ctx, 'trigger', undefined, { cli: () => CLI, subscribeCli: () => () => {} });
  t.after(() => { page.dispose(); dom.window.close(); setWorkspace(previous); });
  const preselected = [], spawn = { preselectCapability: (name, options) => preselected.push([name, options]) };
  return { ...s, c, el, loads, stages, notices, requests, preselected, spawn,
    switchWorkspace(id) { generation++; setWorkspace(id); },
    async press() { await settle(); el.querySelector('.auto-row[data-id="ws/trusted"] .auto-open').click(); await settle(); const b = el.querySelector('button[data-verb=capability]'); b?.click(); await settle(); return b; } };
}

test('the shell\'s ctx gives the Triggers page its Open capability: the press loads Workspace, preselects the capability by name and shows it', async t => {
  const u = shell(t);
  assert.equal(typeof u.c.ctx.openCapability, 'function');
  const button = await u.press();
  assert.ok(button, 'the real page, mounted with the shell\'s ctx, offers the button');
  assert.equal(button.getAttribute('aria-label'), 'Open capability acme.graph');
  assert.deepEqual(u.requests.filter(([route]) => route === '/api/workspace-sync'), [['/api/workspace-sync', { action: 'read' }]], 'one catalog read for the page');
  assert.equal(u.loads.length, 1); assert.deepEqual([u.preselected, u.stages], [[], []], 'nothing before the module is there');
  u.loads[0].resolve(u.spawn); await settle();
  assert.deepEqual(u.preselected.map(([name]) => name), ['acme.graph']); assert.deepEqual(u.stages, ['spawn']);
  // A name the catalog no longer lists once: the handoff says why nothing opened.
  const { onMiss } = u.preselected[0][1];
  onMiss(0); onMiss(2);
  assert.deepEqual(u.notices, ["acme.graph is not in this workspace's capability list.", 'This workspace lists more than one capability named acme.graph. Open it from Workspace.']);
});

test('a capability the catalog does not list exactly once stays text: no button, so no handoff', async t => {
  for (const catalog of [[], [{ name: 'acme.graph', kind: 'member' }, { name: 'acme.graph', kind: 'package' }], [{ name: 'other', kind: 'member' }]]) {
    const u = shell(t, { catalog });
    assert.equal(await u.press(), null, JSON.stringify(catalog)); assert.equal(u.loads.length, 0);
    assert.equal(u.el.querySelector('.page-card[data-card="On"] dd').textContent, 'acme.graph · harvest-branches');
  }
});

test('a current module rejection is contained and said; nothing is preselected and no stage changes', async t => {
  const u = shell(t); await u.press();
  u.loads[0].reject(new Error('chunk missing')); await settle();
  assert.deepEqual(u.notices, ['Could not open the capability: chunk missing']); assert.deepEqual([u.preselected, u.stages], [[], []]);
});

for (const outcome of ['success', 'rejection']) for (const [what, supersede] of [
  ['a newer tab or view choice', u => { u.tabOpenIntents.begin(); }],
  ['an invalidated intent', u => { u.tabOpenIntents.invalidate(); }],
  ['another workspace', u => { u.switchWorkspace('/other'); }],
  ['another workspace and back', u => { u.switchWorkspace('/other'); u.switchWorkspace('/team'); }],
]) test(`superseded by ${what} while Workspace loads, module ${outcome}: nothing opens and nothing is said`, async t => {
  const u = shell(t); await u.press();
  assert.equal(u.loads.length, 1);
  supersede(u);
  if (outcome === 'success') u.loads[0].resolve(u.spawn); else u.loads[0].reject(new Error('chunk missing'));
  await settle();
  assert.deepEqual([u.preselected, u.stages, u.notices], [[], [], []]);
});

test('openCapability is not an option of anything else in the shell: the views\' ctx is its one home', () => {
  assert.equal(source.match(/openCapability\s*:/g), null, 'no object literal in shell.mjs carries it as a key');
  assert.equal(source.match(/ctx\.openCapability\s*=/g).length, 1);
});
