// Capability warnings (OATS 0.49.0, `hook-event-unsupported`), review regressions for three fixes, in jsdom with
// fixture answers (no CLI, server or GUI):
//  1. the sidebar inspector's readiness Open capability, end to end through the REAL Workspace host (spawn.mjs wires
//     the sidebar's openCapability; nothing is injected): the warning's button opens the workspace's capability page;
//  2. Sources: two warnings naming same-named capabilities from different repositories (or a package and a member)
//     each open their own catalog row, told apart by the warning's path;
//  3. Sources: a roster repaint that leaves the warnings unchanged keeps an open warning's Details open (the same
//     element); a changed warning set repaints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as spawn from '../renderer/views/spawn.mjs';
import { createWorkspaceDiscovery } from '../renderer/workspace-discovery.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';
import { refreshCli, resetCliStateForTests } from '../renderer/views/cli-status.mjs';
import { workspaceStatusData, deploymentStatusData } from '../../client/deployment-data.mjs';
import * as readiness from './helpers/readiness-fixture.mjs';
import { homeInspection } from './helpers/inspect-fixture.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

/* ── 1. the sidebar's readiness → Open capability, through the real host ─────────────────────────────── */
// The home inspection's capabilities (the kernel capture) include the member capability nw-release-tooling, which the
// soul composes: the instance's own capability, so its warning resolves against the inspection (warningTargets).
const CAP = 'nw-release-tooling';
const TOOL = { code: 'hook-event-unsupported', capability: CAP, path: `local//fixture/base/fx/remotes/agents.git:capabilities/${CAP}/oats.json#/hooks/on-merge`,
  message: `capability ${CAP} declares hook "on-merge", which this kernel does not run; it is ignored` };
const ELSEWHERE = { ...TOOL, capability: 'acme.elsewhere', path: 'package:acme:capabilities/x/oats.json#/hooks/on-merge', message: 'capability acme.elsewhere declares hook "on-merge"' };
// Readiness (readinessApi 2) and inspection (operationsApi 2) both advertised: the sidebar shows an instance's readiness.
const HOST_CLI = { ...readiness.cli, operationsApi: 2, features: [...readiness.cli.features, 'operations'], relations: true };
// The multi-deployment host also shows a capability's Contents (feature capability-show).
const SCOPED_CLI = { ...HOST_CLI, features: [...HOST_CLI.features, 'capability-show'], capabilityShowApi: 1 };

// `scope`: a multi-deployment view (#482) — the view `team` whose primary is `primary`, the instance tagged with its own
// deployment (and a server, for a remote row). Without it, the single-deployment view the other tests use.
async function workspaceHost(t, scope = null) {
  const dom = new JSDOM('<!doctype html><html><body><div id="stage"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const doc = dom.window.document;
  const saved = { document: globalThis.document, window: globalThis.window, setInterval: globalThis.setInterval, ws: currentWorkspace() };
  globalThis.document = doc; globalThis.window = dom.window; globalThis.setInterval = () => 0;
  const home = scope ? { ...readiness.instance, deployment: { id: scope.deployment }, ...(scope.server ? { server: scope.server } : {}) } : readiness.instance, calls = [];
  // Readiness echoes the deployment it read: the instance's own (soul-inspector syncReadiness).
  const readTarget = scope ? { ...readiness.instanceTarget, workspace: scope.deployment } : readiness.instanceTarget;
  const ctx = {
    hasWorkspaceSwitcher: true, openBrain() {}, openView() {},
    api: async (path, opts = {}) => {
      const body = opts.body ? JSON.parse(opts.body) : undefined; calls.push({ path, body });
      if (path === '/api/cli') return scope ? SCOPED_CLI : HOST_CLI;
      if (path.startsWith('/api/agents')) return { agents: [{ ...readiness.soul, runtime: 'pi', work: 'worktree' }] };
      if (path.startsWith('/api/panel')) return { workspace: scope ? { id: currentWorkspace(), primary: scope.primary, deployments: ['deployment-A', 'deployment-B'] } : { id: currentWorkspace() }, workspaces: [], instances: [{ ...home, running: true }] };
      if (path.startsWith('/api/workspace-readiness')) {
        return readiness.view(readTarget, { ...readiness.data(readTarget), warnings: [TOOL, ELSEWHERE] });
      }
      // The capability page's Contents (`capabilities show`) stays in flight: the destination is the page itself.
      if (path.startsWith('/api/capabilities')) return body?.action === 'show' ? new Promise(() => {}) : homeInspection(home.home, { instance: home.instance, soul: home.agent });
      // A scoped host reads the catalog (the capability page's row, whose selector `capabilities show` takes).
      if (path.startsWith('/api/workspace-sync')) return scope ? catalogAnswer() : new Promise(() => {});
      if (path.startsWith('/api/servers')) return { servers: [] };
      return {};
    },
  };
  t.after(() => {
    spawn.unmount(); resetCliStateForTests(); setWorkspace(saved.ws);
    globalThis.document = saved.document; globalThis.window = saved.window; globalThis.setInterval = saved.setInterval;
    dom.window.close();
  });
  setWorkspace(readiness.workspace.id); resetCliStateForTests();
  await refreshCli({ api: async () => scope ? SCOPED_CLI : HOST_CLI });
  spawn.mount(doc.querySelector('#stage'), ctx); await settle();
  return { dom, doc, calls, home,
    // Open the instance in the sidebar inspector (the Workspace's own handoff).
    select: async () => { spawn.preselectHome(home); await settle(); } };
}

test('sidebar readiness: a warning\'s Open capability (a keyboard-reachable button) opens the workspace\'s capability page through the real host', async t => {
  const u = await workspaceHost(t);
  await u.select();
  const sidebar = u.doc.querySelector('#workspace-inspector');
  assert.equal(sidebar.hidden, false, 'the instance is in the sidebar');
  const view = sidebar.querySelector('.readiness-view');
  assert.ok(view, 'the sidebar shows the instance\'s readiness');
  const items = [...view.querySelectorAll('.readiness-warnings .cap-warning')];
  assert.equal(items.length, 2);
  const [tool, elsewhere] = items;
  assert.equal(tool.querySelector('.cap-warning-message').textContent, TOOL.message);
  assert.equal(tool.querySelector('.cap-warning-capability').textContent, CAP);
  const open = tool.querySelector('button.cap-warning-open');
  assert.ok(open, 'Open capability for the instance\'s own capability');
  assert.equal(open.localName, 'button'); assert.equal(open.type, 'button');
  assert.equal(open.textContent, 'Open capability'); assert.equal(open.getAttribute('aria-label'), `Open capability ${CAP}`);
  assert.equal(open.tabIndex, 0, 'in the tab order');
  assert.equal(elsewhere.querySelector('button'), null, 'not this instance\'s capability: nothing to open');
  const page = u.doc.querySelector('.workspace-cap-page');
  assert.equal(page.hidden, true, 'no capability page before the press');
  // Keyboard: focus it and press Enter. Enter is the native button's: an uncancelled keydown is followed by its click.
  open.focus(); assert.equal(u.doc.activeElement, open);
  const enter = open.dispatchEvent(new u.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal(enter, true, 'nothing cancels Enter on the button');
  open.click(); await settle();
  // The destination: the Workspace's capability page for that capability, with Back, in place of the list.
  assert.equal(page.hidden, false, 'the capability page is shown');
  assert.equal(page.querySelector('h2.page-title > span').textContent, CAP);
  assert.equal(page.querySelector('.page-crumb-current').textContent, CAP);
  const back = page.querySelector('.page-back');
  assert.ok(back, 'Back is present'); assert.equal(back.getAttribute('aria-label'), 'Back to Capabilities');
  assert.equal(u.doc.activeElement, back, 'focus moves into the page');
  // Back returns to the list; the sidebar's subject stays.
  back.click(); await settle();
  assert.equal(page.hidden, true); assert.equal(sidebar.hidden, false);
});

/* ── 2/3. Workspace › Sources ─────────────────────────────────────────────────────────────────────────── */
const f2 = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/f2/${name}.json`, import.meta.url), 'utf8'));
const dir = '/fixture/base/northwind-workspace';
const CLI = { ...f2('version'), ok: true, bin: '/fixture/bin/oats', operationsApi: 1, relations: true };
const roster = deploymentStatusData(f2('status'), dir);
const rosterInstances = () => roster.agents.flatMap(agent => agent.instances.map(i => ({ ...i, agent: i.agent || agent.name, agentsRoot: roster.root })));
const AGENTS = 'local//fixture/base/fx/remotes/agents.git', DATA = 'local//fixture/base/fx/remotes/data.git';
const rows = f2('capabilities').result.capabilities;
const house = rows.find(r => r.name === 'nw-house-style');
// The catalog with a second nw-house-style from another member repository, and a package and a member both named nw-dual.
const catalogRows = [...rows,
  { ...house, origin: `member ${DATA} @ 9a532aa0`, repoKey: DATA, commit: '9a532aa02ebb34fdd7b824b417a180a64968057c', team: 'engineering' },
  { name: 'nw-dual', origin: 'package nw.tools v0.4.0', kind: 'package', package: 'nw.tools', version: '0.4.0', commit: '8ecaae496cb9d4ee0119fee04eac9d35a1918f6f', team: 'unassigned', private: false },
  { ...house, name: 'nw-dual', path: 'capabilities/nw-dual' }];
const catalogAnswer = () => ({ workspaceSyncApi: 1, status: 'ok', report: null, reason: null, capabilities: { capabilitiesApi: 1, ...f2('capabilities').result, capabilities: structuredClone(catalogRows) } });
const hook = (capability, path, message) => ({ code: 'hook-event-unsupported', capability, path, message });
const HOUSE_AGENTS = hook('nw-house-style', `${AGENTS}:capabilities/nw-house-style/oats.json#/hooks/on-merge`, 'nw-house-style (agents) declares hook "on-merge"');
const HOUSE_DATA = hook('nw-house-style', `${DATA}:capabilities/nw-house-style/oats.json#/hooks/on-merge`, 'nw-house-style (data) declares hook "on-merge"');
const DUAL_PACKAGE = hook('nw-dual', 'package:nw.tools:capabilities/nw-dual/oats.json#/hooks/on-tag', 'nw-dual (package) declares hook "on-tag"');
const DUAL_MEMBER = hook('nw-dual', `${AGENTS}:capabilities/nw-dual/oats.json#/hooks/on-tag`, 'nw-dual (member) declares hook "on-tag"');
const statusWith = warnings => ({ ...workspaceStatusData(f2('workspace-status'), dir), warnings });

// createWorkspaceDiscovery mounted on its own, fed the roster as the host feeds it (updateRoster).
async function sources(t, warnings) {
  const dom = new JSDOM('<!doctype html><html><body><main class="oats-view"><header></header><section id="panel"></section><section id="souls"></section></main></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const doc = dom.window.document, previous = currentWorkspace(), opened = [], panel = doc.querySelector('#panel');
  setWorkspace('/team');
  await refreshCli({ api: async () => CLI });
  const ctx = { api: async (path) => {
    if (path === '/api/cli') return CLI;
    if (path.startsWith('/api/workspace-sync')) return catalogAnswer();
    if (path.startsWith('/api/servers')) return { servers: [] };
    return new Promise(() => {});
  } };
  const view = createWorkspaceDiscovery(doc.querySelector('header'), panel, { ctx, soulsPanel: doc.querySelector('#souls'), onOpenCapability: row => opened.push(row) });
  t.after(() => { view.dispose(); setWorkspace(previous); dom.window.close(); });
  let status = statusWith(warnings), instances = rosterInstances();
  const agents = roster.agents.map(({ instances: _i, ...soul }) => ({ ...soul, agentsRoot: roster.root }));
  const push = async () => {
    view.updateRoster(agents, { workspace: { id: currentWorkspace(), scope: currentWorkspace() }, instances,
      deployment: { status: 'observed', root: roster.root, workspace: status.workspace, workspaceStatus: status, reachable: { reachable: true }, withheld: [] } });
    await settle();
  };
  await push();
  view.setTab('sources'); await settle();
  return { doc, view, opened, panel,
    items: () => [...doc.querySelectorAll('.catalog-notes .cap-warning')],
    byMessage: message => [...doc.querySelectorAll('.catalog-notes .cap-warning')].find(i => i.querySelector('.cap-warning-message').textContent === message),
    roster: async next => { instances = next; await push(); },
    status: async next => { status = next; await push(); } };
}

test('Sources: two warnings for same-named capabilities in different repositories each open their own row', async t => {
  const u = await sources(t, [HOUSE_AGENTS, HOUSE_DATA]);
  assert.equal(u.items().length, 2);
  const buttons = [...u.doc.querySelectorAll('.catalog-notes button.cap-warning-open')];
  assert.equal(buttons.length, 2, 'each warning has its own Open capability (neither is withheld as ambiguous)');
  assert.deepEqual(buttons.map(b => b.getAttribute('aria-label')), ['Open capability nw-house-style', 'Open capability nw-house-style']);
  u.byMessage(HOUSE_DATA.message).querySelector('button.cap-warning-open').click();
  u.byMessage(HOUSE_AGENTS.message).querySelector('button.cap-warning-open').click();
  assert.equal(u.opened.length, 2);
  assert.deepEqual(u.opened.map(row => [row.name, row.kind, row.repoKey]), [['nw-house-style', 'member', DATA], ['nw-house-style', 'member', AGENTS]],
    'each press opens the row its path names');
});

test('Sources: a package and a member of one name each open their own row', async t => {
  const u = await sources(t, [DUAL_MEMBER, DUAL_PACKAGE]);
  const buttons = [...u.doc.querySelectorAll('.catalog-notes button.cap-warning-open')];
  assert.equal(buttons.length, 2);
  u.byMessage(DUAL_PACKAGE.message).querySelector('button.cap-warning-open').click();
  u.byMessage(DUAL_MEMBER.message).querySelector('button.cap-warning-open').click();
  assert.deepEqual(u.opened.map(row => [row.name, row.kind, row.package ?? null, row.repoKey ?? null]),
    [['nw-dual', 'package', 'nw.tools', null], ['nw-dual', 'member', null, AGENTS]]);
});

test('Sources: an unrelated roster repaint keeps an open warning\'s Details open; a changed warning set repaints', async t => {
  const u = await sources(t, [HOUSE_AGENTS, HOUSE_DATA]);
  const details = u.byMessage(HOUSE_AGENTS.message).querySelector('details.cap-warning-details');
  assert.ok(details); details.open = true;
  // Setup's own content (the panel's last host) is rebuilt on every repaint: it proves the tab did repaint.
  const setupBefore = u.panel.lastElementChild.firstElementChild;
  assert.ok(setupBefore, 'Setup is painted');
  // A roster poll: an instance's running state flips. The tab repaints (Setup reads the roster) ...
  const next = rosterInstances(); assert.ok(next.length, 'the roster has instances');
  next[0] = { ...next[0], running: !next[0].running };
  await u.roster(next);
  // ... but the warnings are unchanged: the same list, the same Details, still open.
  assert.equal(details.isConnected, true, 'the same Details element');
  assert.equal(details.open, true, 'still open');
  assert.equal(u.byMessage(HOUSE_AGENTS.message).querySelector('details.cap-warning-details'), details);
  assert.equal(u.doc.querySelectorAll('.catalog-notes .cap-warnings').length, 1, 'listed once');
  assert.equal(setupBefore.isConnected, false, 'the tab repainted (Setup was rebuilt)');
  // Open capability still opens the row as it is now (the list outlived the render that drew it).
  u.byMessage(HOUSE_DATA.message).querySelector('button.cap-warning-open').click();
  assert.deepEqual(u.opened.map(row => row.repoKey), [DATA]);
  // A changed warning set repaints: the new message shows, and the old Details element is gone.
  const changed = { ...HOUSE_AGENTS, message: 'nw-house-style (agents) now declares hook "on-tag"' };
  await u.status(statusWith([changed, HOUSE_DATA]));
  assert.ok(u.byMessage(changed.message), 'the new message shows');
  assert.equal(u.byMessage(HOUSE_AGENTS.message), undefined, 'the old message is gone');
  assert.equal(details.isConnected, false, 'the list was rebuilt');
});

// Review round 2: the capability page reads the view's PRIMARY deployment (the catalog, `capabilities show` scoped by
// the view), so an instance's warning opens it only when that instance is on this computer in the primary deployment.
// In another deployment, or on a server, there is no Open capability: never the primary's capability of the same name.
test('sidebar readiness in a multi-deployment view: Open capability only for an instance in the primary deployment; the page reads that deployment', async t => {
  const u = await workspaceHost(t, { primary: 'deployment-A', deployment: 'deployment-A' });
  await u.select();
  const view = u.doc.querySelector('#workspace-inspector .readiness-view');
  assert.ok(view, 'readiness shows');
  // The readiness and the inspection were read in the instance's own deployment.
  assert.ok(u.calls.some(c => c.path.startsWith('/api/workspace-readiness') && c.path.includes('ws=deployment-A')), 'readiness read in deployment-A');
  const open = view.querySelector('.readiness-warnings button.cap-warning-open');
  assert.ok(open, 'in the primary deployment: Open capability');
  open.click(); await settle();
  assert.equal(u.doc.querySelector('.workspace-cap-page').hidden, false, 'the capability page is shown');
  // Its Contents is read through the view, which the server resolves to the primary deployment: the instance's own.
  const shows = u.calls.filter(c => c.path.startsWith('/api/capabilities') && c.body?.action === 'show');
  assert.equal(shows.length, 1); assert.equal(shows[0].body.capability.name, CAP);
  assert.equal(new URL(shows[0].path, 'http://x').searchParams.get('ws'), 'team', 'the view, whose primary is deployment-A');
});

for (const [label, scope] of [['another deployment of the view', { primary: 'deployment-A', deployment: 'deployment-B' }],
  ['a server', { primary: 'deployment-A', deployment: 'deployment-A', server: 'build-box' }]]) {
  test(`sidebar readiness for an instance in ${label}: the warning shows, with no Open capability, and no capability is read`, async t => {
    const u = await workspaceHost(t, scope);
    await u.select();
    const view = u.doc.querySelector('#workspace-inspector .readiness-view');
    if (scope.server && !view?.querySelector('.readiness-warnings')) {
      // A remote row may be refused before readiness reads (remote-address.mjs): then there is no warning to open at all.
      assert.equal(u.doc.querySelector('#workspace-inspector button.cap-warning-open'), null);
      return;
    }
    const items = [...view.querySelectorAll('.readiness-warnings .cap-warning')];
    assert.equal(items.length, 2, 'the warnings still show');
    assert.equal(view.querySelector('button.cap-warning-open'), null, 'nothing to open: the page would read the primary deployment');
    assert.equal(u.calls.filter(c => c.body?.action === 'show').length, 0, 'no capability is read');
  });
}
