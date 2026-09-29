// desktop/loading-states item 6: the Workspace's Capabilities tab — table-row skeletons (the real card
// rows) after 150ms, tab counts that reserve their width with a pill, a held table that is never set to
// null by a CLI emit or a sync (it refreshes in place), a failed re-read that keeps the table stale with
// Retry, and spec 02's held-table shapes. Timers run on a fake window clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import * as spawn from '../renderer/views/spawn.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';
import { refreshCli } from '../renderer/views/cli-status.mjs';
import { workspaceStatusData, deploymentStatusData } from '../deployment-data.mjs';
import { PENDING_DELAY_MS, REFRESHING_DELAY_MS } from '../renderer/loading.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const f2 = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/f2/${name}.json`, import.meta.url), 'utf8'));
const dir = '/fixture/base/northwind-workspace';
const CLI = { ...f2('version'), ok: true, bin: '/fixture/bin/oats', operationsApi: 1, relations: true };
const status = workspaceStatusData(f2('workspace-status'), dir);
const roster = deploymentStatusData(f2('status'), dir);
const agents = roster.agents.map(({ instances: _i, ...soul }) => ({ ...soul, agentsRoot: roster.root }));
const CATALOG = { capabilitiesApi: 1, ...f2('capabilities').result };
const okRead = (extra = {}) => ({ workspaceSyncApi: 1, status: 'ok', report: null, capabilities: CATALOG, reason: null, ...extra });
const failedRead = (extra = {}) => ({ workspaceSyncApi: 1, status: 'unavailable', reason: { code: 'E_CLI_TIMEOUT', message: 'The workspace command exceeded its time limit.' }, ...extra });

function clock(win) {
  let now = 1_000_000, seq = 0; const timers = new Map();
  win.setTimeout = (fn, ms = 0) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; };
  win.clearTimeout = id => { timers.delete(id); };
  return { advance(ms) {
    const until = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = until;
  } };
}

async function setup(t, { holdRoster = false, holdReads = false } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="host"></div>', { url: 'http://localhost' });
  const saved = { document: globalThis.document, window: globalThis.window, setInterval: globalThis.setInterval, ws: currentWorkspace() };
  globalThis.document = dom.window.document; globalThis.window = dom.window;
  const polls = []; globalThis.setInterval = fn => { polls.push(fn); return 0; };
  const timers = clock(dom.window);
  const rosters = [], reads = [], calls = [];
  const panel = () => ({ workspace: { id: currentWorkspace(), scope: currentWorkspace() }, workspaces: [], instances: [],
    deployment: { status: 'observed', root: roster.root, workspace: status.workspace, workspaceStatus: status, reachable: { reachable: true }, withheld: [] } });
  const ctx = { hasWorkspaceSwitcher: true, api: async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined; calls.push({ path, body });
    if (path === '/api/cli') return CLI;
    if (path.startsWith('/api/agents')) { if (!holdRoster) return { agents }; const r = deferred(); rosters.push(r); return r.promise; }
    if (path.startsWith('/api/panel')) return panel();
    if (path.startsWith('/api/workspace-sync')) { if (!holdReads) return okRead(); const r = deferred(); reads.push({ ...r, body }); return r.promise; }
    if (path === '/api/servers') return { servers: [] };
    throw new Error(`Unexpected fixture API request: ${path}`);
  } };
  const doc = dom.window.document;
  t.after(() => { spawn.unmount(); setWorkspace(saved.ws); globalThis.document = saved.document; globalThis.window = saved.window; globalThis.setInterval = saved.setInterval; dom.window.close(); });
  setWorkspace('/team'); await refreshCli({ api: async () => CLI });
  spawn.mount(doc.querySelector('#host'), ctx); await settle();
  const q = sel => doc.querySelector(sel);
  return {
    doc, timers, rosters, reads, calls, q,
    tab: async name => { doc.getElementById(`workspace-tab-${name}`).click(); await settle(); },
    count: name => q(`#workspace-tab-${name} .workspace-count`),
    rows: () => [...doc.querySelectorAll('.catalog-table .catalog-row:not(.head):not(.skeleton-catalog-row)')],
    state: () => q('.catalog-state'), skeleton: () => q('.catalog-state [data-skeleton]'), status: () => q('.discovery-load-status'), notice: () => q('.discovery-notice'),
    reads_: () => calls.filter(c => c.path.startsWith('/api/workspace-sync')).map(c => c.body),
    resolveRead: async (index, reply) => { reads[index].resolve(reply); await settle(); },
    poll: () => polls.at(-1)(),
    cliEmit: async () => { await refreshCli({ api: async () => ({ ...CLI, probedAt: (CLI.probedAt || 0) + 1 }) }); await settle(); },
  };
}

test('pending: both tab counts are pills; on Capabilities the real card rows as a skeleton after 150ms, aria-busy and "Loading capabilities…"; hidden on other tabs', async t => {
  const u = await setup(t, { holdRoster: true, holdReads: true });
  assert.ok(u.count('souls').querySelector('.skeleton-pill'), 'the Souls count reserves its width'); assert.ok(u.count('capabilities').querySelector('.skeleton-pill'));
  u.rosters[0].resolve({ agents }); await settle();
  assert.equal(u.count('souls').textContent, String(agents.length)); assert.ok(u.count('capabilities').querySelector('.skeleton-pill'), 'the catalog is being read');
  assert.equal(u.reads.length, 1, 'read once on mount, on any tab');
  assert.equal(u.state().hidden, true, 'the Souls tab shows nothing of it'); assert.equal(u.status().hidden, true);
  await u.tab('capabilities');
  assert.equal(u.state().hidden, false); assert.equal(u.state().getAttribute('aria-busy'), 'true'); assert.equal(u.status().textContent, 'Loading capabilities…');
  assert.doesNotMatch(u.doc.body.textContent, /Reading the workspace capabilities/);
  assert.equal(u.skeleton(), null, 'nothing before 150ms'); u.timers.advance(PENDING_DELAY_MS);
  const sk = u.skeleton(); assert.ok(sk); assert.equal(sk.getAttribute('aria-hidden'), 'true'); assert.equal(sk.textContent, '');
  const bones = sk.querySelectorAll('button.catalog-row.skeleton-catalog-row'); assert.ok(bones.length >= 5, 'card rows wearing the table classes');
  for (const row of bones) { assert.equal(row.disabled, true); assert.equal(row.tabIndex, -1); assert.ok(row.querySelector('.catalog-tile.skeleton')); assert.ok(row.querySelector('.catalog-cap .skeleton-name')); }
  await u.resolveRead(0, okRead());
  assert.equal(u.skeleton(), null); assert.equal(u.rows().length, 10); assert.equal(u.state().getAttribute('aria-busy'), null);
  assert.equal(u.count('capabilities').textContent, '10'); assert.equal(u.status().textContent, '');
});

test('a CLI emit never sets the held table to null: it refreshes in place ("Refreshing…" after 400ms), keeps its nodes and focus', async t => {
  const u = await setup(t, { holdReads: true });
  await u.resolveRead(0, okRead()); await u.tab('capabilities');
  const [first] = u.rows(); first.focus(); assert.equal(u.doc.activeElement, first);
  await u.cliEmit();
  assert.equal(u.reads.length, 2, 're-read'); assert.equal(u.rows().length, 10, 'the table stays'); assert.equal(u.rows()[0], first);
  assert.equal(u.count('capabilities').textContent, '10', 'the count stays a number'); assert.equal(u.state().getAttribute('aria-busy'), null);
  assert.equal(u.q('.discovery-refreshing .loading-refreshing'), null); u.timers.advance(REFRESHING_DELAY_MS);
  assert.equal(u.q('.discovery-refreshing .loading-refreshing')?.textContent, 'Refreshing…');
  await u.resolveRead(1, okRead());
  assert.equal(u.q('.discovery-refreshing .loading-refreshing'), null); assert.equal(u.rows()[0], first, 'identical data: the same nodes'); assert.equal(u.doc.activeElement, first);
});

test('a failed re-read keeps the table stale: the line with the cause behind Details and Retry above it; Retry reads live and announces', async t => {
  const u = await setup(t, { holdReads: true });
  await u.resolveRead(0, okRead()); await u.tab('capabilities');
  await u.cliEmit(); await u.resolveRead(1, failedRead());
  assert.equal(u.rows().length, 10, 'Retry keeps the table');
  const line = u.notice().querySelector('.loading-notice[data-kind=stale]'); assert.ok(line);
  assert.equal(line.querySelector('.loading-notice-text').textContent, "Couldn't refresh capabilities");
  assert.equal(line.querySelector('.loading-notice-cause').textContent, 'The workspace command exceeded its time limit. (E_CLI_TIMEOUT)');
  assert.equal(u.status().textContent, "Couldn't refresh capabilities."); assert.ok(u.status().classList.contains('loading-quiet'));
  assert.equal(u.count('capabilities').textContent, '10', 'the last observation stays counted');
  const retry = line.querySelector('.loading-retry'); retry.focus(); retry.click(); await settle();
  assert.deepEqual(u.reads.at(-1).body, { action: 'read', refresh: true }); assert.equal(retry.getAttribute('aria-disabled'), 'true'); assert.equal(u.doc.activeElement, retry);
  retry.click(); await settle(); assert.equal(u.reads.length, 3, 'a repeat activation while busy is ignored');
  await u.resolveRead(2, okRead());
  assert.equal(u.notice().childElementCount, 0); assert.equal(u.status().textContent, 'Capabilities updated'); assert.equal(u.rows().length, 10);
});

test("spec 02's held-table shapes: ok + reason (a failed re-read behind a held table) and non-ok + lastGood both paint the table stale with the observation's age", async t => {
  const u = await setup(t, { holdReads: true });
  const old = new Date(Date.now() - 3 * 60_000).toISOString();
  await u.resolveRead(0, okRead({ reason: { code: 'E_CLI_TIMEOUT', message: 'timed out' }, observedAt: old, refreshing: false })); await u.tab('capabilities');
  assert.equal(u.rows().length, 10);
  let line = u.notice().querySelector('.loading-notice[data-kind=stale]'); assert.ok(line, 'ok with a reason: stale');
  assert.equal(line.querySelector('.loading-notice-text').textContent, "Couldn't refresh capabilities · observed 3 min ago");
  const v = await setup(t, { holdReads: true });
  await v.resolveRead(0, { workspaceSyncApi: 1, status: 'unavailable', reason: { code: 'E_CLI_FAILED', message: 'bridge down' }, lastGood: { capabilities: CATALOG, observedAt: old } }); await v.tab('capabilities');
  assert.equal(v.rows().length, 10, 'the last good table is shown');
  line = v.notice().querySelector('.loading-notice[data-kind=stale]'); assert.ok(line);
  assert.equal(line.querySelector('.loading-notice-text').textContent, "Couldn't refresh capabilities · observed 3 min ago");
  assert.equal(line.querySelector('.loading-notice-cause').textContent, 'bridge down (E_CLI_FAILED)');
  assert.equal(v.count('capabilities').textContent, '10');
});

test('a successful read of an old observation says so, muted, without Retry; a fresh one says nothing', async t => {
  const u = await setup(t, { holdReads: true });
  await u.resolveRead(0, okRead({ observedAt: new Date(Date.now() - 5 * 60_000).toISOString() })); await u.tab('capabilities');
  const line = u.notice().querySelector('.loading-notice[data-kind=observed]'); assert.ok(line);
  assert.equal(line.querySelector('.loading-notice-text').textContent, 'Observed 5 min ago'); assert.equal(line.querySelector('.loading-retry'), null);
  const v = await setup(t, { holdReads: true });
  await v.resolveRead(0, okRead({ observedAt: new Date().toISOString() })); await v.tab('capabilities');
  assert.equal(v.notice().childElementCount, 0);
});

test('a failed roster read with nothing to show leaves the Souls count empty and still (no pill); a workspace switch makes both counts pills again', async t => {
  const u = await setup(t, { holdRoster: true, holdReads: true });
  u.rosters[0].reject(new Error('down')); await settle();
  assert.equal(u.count('souls').textContent, ''); assert.equal(u.count('souls').querySelector('.skeleton'), null);
  u.poll(); await tick(); u.rosters[1].resolve({ agents }); await settle();
  assert.equal(u.count('souls').textContent, String(agents.length));
  setWorkspace('/other'); await settle();
  assert.ok(u.count('souls').querySelector('.skeleton-pill')); assert.ok(u.count('capabilities').querySelector('.skeleton-pill'));
});

test('retired wording: "Reading the workspace capabilities" and the separate Retry button are gone from the source', () => {
  const source = readFileSync(new URL('../renderer/workspace-discovery.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Reading the workspace capabilities \(|discovery-retry/);
});
