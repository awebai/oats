// Mount the real Workspace view (renderer/views/spawn.mjs) with the spawn
// dialog wired to the REAL preview boundary and apply broker. Their CLI
// invocations return the kernel captures in test/fixtures/workspace-v2/f3 —
// no process, runtime or filesystem is touched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as spawn from '../../renderer/views/spawn.mjs';
import { currentWorkspace, setWorkspace, postJson } from '../../renderer/views/common.mjs';
import { createSpawnJobs } from '../../renderer/spawn-jobs.mjs';
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
  // options.deployments (#482): the view's deployments as /api/panel lists them; the preview and spawn routes then
  // answer for the deployment their ?ws= names (the server echoes it), and options.catalogs[<id>] is that
  // deployment's /api/agents catalog (an array, or a function returning one or a promise of one).
  const wsOf = path => { const m = /[?&]ws=([^&]*)/.exec(path); return m ? decodeURIComponent(m[1]) : null; };
  const context = (ws = null) => ({ workspace: { id: options.deployments && ws ? ws : 'northwind', scope: DEPLOYMENT }, cli, agents, instances });
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
  const panel = () => ({ workspace: { id: 'northwind', name: 'northwind', team: null }, workspaces: options.workspaces ?? [], instances,
    ...(options.deployments ? { deployments: options.deployments } : {}),
    deployment: { status: 'observed', root: `${northwindDir}/agents`, workspace: workspaceStatusData(northwind, northwindDir).workspace,
      workspaceStatus: workspaceStatusData(northwind, northwindDir), reachable: { reachable: true } } });
  const ctx = { hasWorkspaceSwitcher: true, spawnTiming: { previewDelay: options.previewDelay ?? 0, busyDelay: options.busyDelay ?? 0, wait: { tries: 3, delayMs: 0, sleep: options.sleep ?? (async () => {}) } },
    api: async (path, opts = {}) => {
      const body = opts.body ? JSON.parse(opts.body) : undefined; calls.push({ path, body, method: opts.method || 'GET' });
      if (path === '/api/cli') return cli;
      if (path.startsWith('/api/agents') && options.catalogs && Object.hasOwn(options.catalogs, wsOf(path) ?? '')) {
        const c = options.catalogs[wsOf(path)];
        return { workspace: { id: wsOf(path) }, agents: await (typeof c === 'function' ? c() : c) };
      }
      if (path.startsWith('/api/agents')) return { workspace: { id: 'northwind', name: 'northwind' }, agents, ...(options.catalog ? { catalog: options.catalog } : {}) };
      // A remote workspace's panel (the relation picker for a chosen server): options.serverPanels[<ws id>] rows.
      if (path.startsWith('/api/panel?ws=remote')) await options.serverPanelGate;
      if (path.startsWith('/api/panel?ws=remote')) return { workspace: { id: decodeURIComponent(path.split('ws=')[1]), remote: true }, instances: options.serverPanels?.[decodeURIComponent(path.split('ws=')[1])] ?? [] };
      if (path.startsWith('/api/panel')) return panel();
      if (path.startsWith('/api/team-members')) return options.teamMembers ?? { members: [], servers: [], notReached: [] };
      if (path.startsWith('/api/workspace-spawn-preview')) { await options.previewGate?.(body, wsOf(path)); return previewBoundary(body, () => context(wsOf(path))); }
      if (path.startsWith('/api/spawn?')) { await options.spawnGate?.(body); return broker(body, () => context(wsOf(path))); }
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
  // options.jobs: the shell's background-spawn store (Spec C), wired as shell.mjs wires it; its options override.
  const notices = [], reopened = [], schedules = [], shownRows = [], followed = [];
  if (options.jobs) {
    ctx.showPendingSpawn = id => { shownRows.push(id); return true; };
    ctx.followSpawn = id => followed.push(id); // Spec E: the shell reveals the pending row and follows the spawn
    ctx.spawnJobs = createSpawnJobs({ post: (ws, body) => postJson(ctx, `/api/spawn?ws=${encodeURIComponent(ws)}`, body),
      notify: (message, opts = {}) => {
        const n = { message, options: opts, shown: true }; notices.push(n);
        return { dismiss() { n.shown = false; }, get shown() { return n.shown; } };
      },
      notifySpawned: (row, ws, _epoch, arrival) => notified.push({ row, ws, ...(arrival ? { arrival } : {}) }),
      reopen: job => { reopened.push(job); spawn.preselectSpawn({ name: job.soul.name, agentsRoot: job.soul.agentsRoot, draft: job.draft }); },
      viewSchedules: () => schedules.push(true), currentWorkspace, ...(options.jobs === true ? {} : options.jobs) });
  }
  t.after(() => { ctx.spawnJobs?.dispose(); spawn.unmount(); setWorkspace(previous.ws); globalThis.document = previous.document; globalThis.window = previous.window; globalThis.setInterval = previous.setInterval; dom.window.close(); });
  setWorkspace('northwind');
  await refreshCli({ api: async () => cli });
  spawn.mount(dom.window.document.querySelector('#host'), ctx); await settle();
  const doc = dom.window.document;
  const u = {
    doc, dom, calls, opens, notified, applied, polls, ctx, notices, reopened, schedules, shownRows, followed, jobs: ctx.spawnJobs,
    dialog: () => doc.querySelector('.spawn-dialog'),
    q: selector => doc.querySelector(`.spawn-dialog ${selector}`),
    text: selector => (doc.querySelector(`.spawn-dialog ${selector}`)?.textContent || '').trim(),
    previews: () => calls.filter(c => c.path.startsWith('/api/workspace-spawn-preview')).map(c => c.body),
    spawns: () => calls.filter(c => c.path.startsWith('/api/spawn')).map(c => c.body),
    async open(name = 'release-manager') {
      const card = [...doc.querySelectorAll('.soul-card')].find(c => c.dataset.agent === name); assert.ok(card, `card ${name}`);
      card.click(); await settle(3);
      const launch = doc.querySelector('.workspace-soul-page .spawn-act'); assert.ok(launch, 'Launch'); launch.click();
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
