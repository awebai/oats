// Mount the real Workspace view (renderer/views/spawn.mjs) with the spawn
// dialog wired to the REAL preview boundary and apply broker. Their CLI
// invocations return the kernel captures in test/fixtures/workspace-v2/f3 —
// no process, runtime or filesystem is touched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as spawn from '../../renderer/views/spawn.mjs';
import { currentWorkspace, setWorkspace } from '../../renderer/views/common.mjs';
import { refreshCli } from '../../renderer/views/cli-status.mjs';
import { createSpawnPreviewBoundary } from '../../server/spawn-preview.mjs';
import { createSpawnApplyBoundary } from '../../server/spawn-apply.mjs';
import { soulsData, workspaceStatusData } from '../../deployment-data.mjs';
import { cli as CLI, kernel, DEPLOYMENT, ROOT, anchor, anchorHome, deferred } from './spawn-preview-fixture.mjs';
import { creation } from './spawn-apply-fixture.mjs';
export { deferred, kernel, DEPLOYMENT, ROOT };
export const tick = () => new Promise(resolve => setImmediate(resolve));
/** Let pending I/O, microtasks AND zero-delay timers (the preview debounce) run. */
export async function settle(n = 12) { for (let i = 0; i < n; i++) { await tick(); if (i % 3 === 2) await new Promise(resolve => setTimeout(resolve, 0)); } }

/** The spawn catalog exactly as the server's agentsData projects `oats souls`. */
export function catalogAgents() {
  return soulsData(kernel('souls')).souls.map(s => ({ name: s.name, description: s.description || '', kind: 'persistent', work: s.work,
    ...(s.team ? { team: s.team } : {}), origin: s.origin, soulKind: s.kind, repo: s.repoKey, capability: null,
    soulSource: { repoKey: s.repoKey, commit: s.commit }, agentsRoot: ROOT, workspace: DEPLOYMENT,
    repoName: s.kind === 'external' ? 'external' : s.repoKey.split('/').pop().replace(/\.git$/, '') }));
}
/** platform-reviewer is private (not in the catalog); the checkout cases add it as a catalog row would look. */
export const checkoutSoul = () => ({ name: 'platform-reviewer', description: 'Reviews platform PRs; internal to this repo.', kind: 'persistent', work: 'checkout',
  team: 'engineering', origin: 'member', soulKind: 'member', repo: 'platform', capability: null, agentsRoot: ROOT, workspace: DEPLOYMENT, repoName: 'platform' });

/** Which captured preview answers these choices (the capture's own argv). */
export function kernelPreviewName(soul, choices = {}) {
  if (soul === 'platform-reviewer') return choices.work === 'worktree' ? 'preview-checkout-as-worktree' : 'preview-checkout-default';
  if (soul === 'support-triager') return 'preview-directory';
  if (soul !== 'release-manager') return 'preview-soul-unknown';
  if (!choices.purpose) return 'preview-worktree-default';
  if (choices.runtime === 'claude') return 'preview-runtime-claude';
  if (choices.model?.kind === 'native-default') return 'preview-native-default';
  if (choices.yolo === true) return 'preview-yolo';
  if (choices.base === 'no-such-ref') return 'preview-base-unknown';
  if (choices.branch) return 'preview-branch-base';
  if (choices.purpose === 'docs') return 'preview-other';
  if (choices.purpose === 'race') return 'preview-race';
  return 'preview-worktree-purpose';
}
const northwind = JSON.parse(readFileSync(new URL('../fixtures/workspace-v2/f3/../workspace-status.json', import.meta.url), 'utf8'));
const northwindDir = northwind.result.workspace.local.replace(/\/oats-local\.yaml$/, '');

export async function mountSpawn(t, options = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const previous = { document: globalThis.document, window: globalThis.window, setInterval: globalThis.setInterval, ws: currentWorkspace() };
  globalThis.document = dom.window.document; globalThis.window = dom.window;
  const polls = []; globalThis.setInterval = fn => { polls.push(fn); return 0; };
  let cli = structuredClone(options.cli ?? CLI), agents = options.agents ?? catalogAgents();
  let instances = options.instances ?? [{ ...anchor, home: anchorHome, running: true, createdAt: 'first', tmux: { session: 's', window: 'w' } }];
  const calls = [], opens = [], notified = [], applied = [];
  const context = () => ({ workspace: { id: 'northwind', scope: DEPLOYMENT }, cli, agents, instances });
  const kernelInvoke = options.kernel ?? ((_cli, { target, choices }) => kernel(options.previewName?.(target.selector.soul, choices) ?? kernelPreviewName(target.selector.soul, choices)));
  const previewBoundary = createSpawnPreviewBoundary({ invoke: async (c, args) => kernelInvoke(c, args) });
  let ids = 0;
  const broker = createSpawnApplyBoundary({ mint: () => (++ids).toString(16).padStart(64, '0'), read: previewBoundary,
    invoke: async (c, args) => {
      applied.push(structuredClone(args));
      if (options.apply) return options.apply(args);
      const preview = kernel(kernelPreviewName(args.target.selector.soul, args.choices)).result;
      return { started: true, envelope: { schemaVersion: 1, ok: true, result: creation(preview) } };
    } });
  // The workspace exactly as /api/panel sends it: id and name, no scope.
  const panel = () => ({ workspace: { id: 'northwind', name: 'northwind', team: null }, workspaces: [], instances,
    deployment: { status: 'observed', root: `${northwindDir}/agents`, workspace: workspaceStatusData(northwind, northwindDir).workspace,
      workspaceStatus: workspaceStatusData(northwind, northwindDir), reachable: { reachable: true } } });
  const ctx = { hasWorkspaceSwitcher: true, spawnTiming: { previewDelay: options.previewDelay ?? 0, wait: { tries: 3, delayMs: 0, sleep: options.sleep ?? (async () => {}) } },
    api: async (path, opts = {}) => {
      const body = opts.body ? JSON.parse(opts.body) : undefined; calls.push({ path, body, method: opts.method || 'GET' });
      if (path === '/api/cli') return cli;
      if (path.startsWith('/api/agents')) return { workspace: { id: 'northwind', name: 'northwind' }, agents, ...(options.catalog ? { catalog: options.catalog } : {}) };
      if (path.startsWith('/api/panel')) return panel();
      if (path.startsWith('/api/workspace-spawn-preview')) { await options.previewGate?.(body); return previewBoundary(body, context); }
      if (path.startsWith('/api/spawn?')) { await options.spawnGate?.(body); return broker(body, context); }
      if (path === '/api/spawn') return options.remote ? options.remote(body) : assert.fail('no unguarded spawn in these tests');
      if (path === '/api/models') return options.models ? options.models(body) : { models: [] };
      if (path.startsWith('/api/launch-configs')) return options.configs ? options.configs(body) : { selected: body.selector, configurations: [] };
      if (path === '/api/servers') return { servers: options.servers ?? [] };
      if (path.startsWith('/api/capabilities')) return { operationsApi: 1, selected: { source: 'config' }, souls: [], capabilities: [], problems: [] };
      if (path.startsWith('/api/workspace-sync')) return { workspaceSyncApi: 1, status: 'ok', report: null, capabilities: null, reason: null };
      if (path.startsWith('/api/workspace-readiness')) return { readinessViewApi: 1, status: 'unavailable', reason: { code: 'E_UNSUPPORTED', message: 'x' } };
      throw new Error(`Unexpected fixture API request: ${path}`);
    },
    openTerminal: (ref, o) => opens.push({ ref, o }), notifySpawn: (row, ws) => notified.push({ row, ws }), notify: () => {}, openBrain: () => {} };
  t.after(() => { spawn.unmount(); setWorkspace(previous.ws); globalThis.document = previous.document; globalThis.window = previous.window; globalThis.setInterval = previous.setInterval; dom.window.close(); });
  setWorkspace('northwind');
  await refreshCli({ api: async () => cli });
  spawn.mount(dom.window.document.querySelector('#host'), ctx); await settle();
  const doc = dom.window.document;
  const u = {
    doc, dom, calls, opens, notified, applied, polls, ctx,
    dialog: () => doc.querySelector('.spawn-dialog'),
    q: selector => doc.querySelector(`.spawn-dialog ${selector}`),
    text: selector => (doc.querySelector(`.spawn-dialog ${selector}`)?.textContent || '').trim(),
    previews: () => calls.filter(c => c.path.startsWith('/api/workspace-spawn-preview')).map(c => c.body),
    spawns: () => calls.filter(c => c.path.startsWith('/api/spawn')).map(c => c.body),
    async open(name = 'release-manager') {
      const card = [...doc.querySelectorAll('.soul-card')].find(c => c.dataset.agent === name); assert.ok(card, `card ${name}`);
      card.click(); await settle(3);
      const launch = doc.querySelector('.soul-inspector .spawn-act'); assert.ok(launch, 'Launch'); launch.click();
      await settle(); return u.dialog();
    },
    async type(selector, value) { const el = u.q(selector); el.value = value; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await settle(); return el; },
    async change(selector, value) {
      const el = u.q(selector);
      if (el.type === 'checkbox') el.checked = value; else el.value = value;
      el.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await settle(); return el;
    },
    async spawn() { u.q('.fspawn').click(); await settle(20); },
    setCli: async value => { cli = value; await refreshCli({ api: async () => cli }); },
    setAgents: value => { agents = value; }, setInstances: value => { instances = value; },
  };
  return u;
}
