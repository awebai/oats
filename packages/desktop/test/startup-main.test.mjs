// A Finder launch (cwd `/`, no --dir) runs main's shipped startup in a vm (#518): the real registry,
// records and window code over a real userData folder and real deployment folders, with Electron and
// the backend process faked at their boundary. What the backend is spawned with (argv, cwd and stdio, through
// the real serverSpawnSpec), the
// window it opens and what is written to workspace-open.json and windows.json are asserted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, realpathSync, lstatSync, rmSync, opendirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createWindowSet } from '../window-set.mjs';
import { parseWindowRecords, resolveView, restorePlan, clampBounds, windowTitle, createWindowRecords } from '../window-records.mjs';
import { validateWorkspace, deploymentsInside } from '../../client/workspace-admission.mjs';
import { restoreWorkspaceDirs, savedWorkspacePaths, persistableDirs, startupOpenSet, saveWorkspaceDirs, workspaceSuggestions } from '../workspace-registry.mjs';
import { trustedForgeFrame } from '../forge-proxy.mjs';
import { validWorkspaceId } from '../renderer/workspace-id.mjs';
import { workspaceHash, trustedRendererUrl } from '../renderer/window-binding.mjs';
import { fakeWindowClass } from './helpers/fake-window.mjs';
import { serverSpawnSpec, LIFELINE_FLAG } from '../server-host.mjs';

const RENDERER = 'file:///app/renderer/index.html';
const HERE = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const source = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8');
const between = (from, to) => { const i = source.indexOf(from); assert.ok(i >= 0, from); const j = source.indexOf(to, i); assert.ok(j > i, to); return source.slice(i, j); };
const windowSection = between('// ---- windows: one per workspace (#481)', 'function createWindow(workspaceId');
const windowBlock = source.match(/function createWindow\(workspaceId, record = null\)[^]*?\n\}/)[0];
const noteServedBlock = source.match(/function noteServed\(list\) \{[^]*?\n\}/)[0];
const wsValidateBlock = source.match(/const wsValidate = \(p\) => validateWorkspace\(p, \{[^]*?\n\}\);/)[0];
const spawnChildBlock = source.match(/spawnChild: (\(dirs, onPort\) => \{[^]*?\n {2}\}),/)[1];
const knownDirsBlock = source.match(/const knownDirs = new Set\(\);\nconst knowDirs = [^\n]*/)[0];
const listEntriesBlock = source.match(/function listEntries\(dir, limit\) \{[^]*?\n\}/)[0];
const suggestionListBlock = source.match(/list: (\(\) => workspaceSuggestions\(\{[^]*?\}\)),/)[1];
const startupBody = (() => {
  const head = 'const primaryInstance = startSingleInstance(app, (argv, workingDirectory) => openLaunch(launchDirectory(argv, workingDirectory)), async () => {';
  return between(head, '\n});\n\nif (primaryInstance)').slice(head.length);
})();
const FakeWindow = fakeWindowClass(RENDERER);

/** A machine: a home holding real deployments (a regular oats-local.yaml) and plain folders. */
function machine() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oats-startup-')));
  const userData = join(root, 'userData'), home = join(root, 'home');
  for (const dir of [userData, join(home, 'Agents', 'oats'), join(home, 'cjr'), join(home, 'awebai', 'oats')]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(home, 'Agents', 'oats', 'oats-local.yaml'), '');
  return { root, userData, home, deployment: join(home, 'Agents', 'oats'), folders: [join(home, 'cjr'), join(home, 'awebai', 'oats')] };
}

/** Run main's startup for a launch from `launch` (Finder: `/`) and return what it did. */
async function launch(m, { launch: WORKSPACE = '/', openSet, windowsFile } = {}) {
  if (openSet !== undefined) writeFileSync(join(m.userData, 'workspace-open.json'), JSON.stringify(openSet));
  if (windowsFile !== undefined) writeFileSync(join(m.userData, 'windows.json'), JSON.stringify(windowsFile));
  FakeWindow.reset();
  const spawned = [], handlers = new Map(), appEvents = new Map(), logs = [];
  const context = {
    // Electron, at its boundary.
    app: { getPath: () => m.userData, on: (event, fn) => appEvents.set(event, fn) },
    BrowserWindow: Object.assign(FakeWindow, { fromWebContents: (wc) => FakeWindow.all.find((w) => w.webContents === wc), getAllWindows: () => FakeWindow.all }),
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 25, width: 1440, height: 875 } }] },
    Menu: {}, shell: {}, console: { log: (m) => logs.push(m), error: (m) => logs.push(m) },
    // The backend process, at its boundary: what main spawns it with is recorded. The spec is the real one.
    serverSpawnSpec,
    spawn: (bin, args, options) => {
      spawned.push({ bin, args: [...args], cwd: options.cwd, stdio: [...options.stdio] });
      return { stdin: { on() {} }, stdout: { on() {} }, stderr: { on() {} } };
    },
    process: { execPath: '/app/OATS Desktop', env: {} }, homedir: () => m.home, readCliChoice: () => null, loginPath: { source: 'login-shell', error: null },
    REMOTE_IDENTITY_FILE: () => join(m.userData, 'remote-identity.json'), HERE,
    // The real code main runs at startup.
    WORKSPACE, workspaceDirs: [], openDirs: [], join, existsSync, readFileSync, realpathSync, lstatSync, validateWorkspace,
    restoreWorkspaceDirs, savedWorkspacePaths, persistableDirs, startupOpenSet, saveWorkspaceDirs, createWindowRecords, parseWindowRecords,
    createWindowSet, restorePlan, resolveView, clampBounds, windowTitle, trustedForgeFrame, validWorkspaceId, workspaceHash, trustedRendererUrl,
    WINDOWS_FILE: () => join(m.userData, 'windows.json'), OPEN_WORKSPACES_FILE: () => join(m.userData, 'workspace-open.json'),
    RENDERER_URL: RENDERER, servedList: [], allowedWs: new Set(), advertisedBefore: new Set(), quitStarted: false,
    applyLoginPath: async () => {}, installAppMenu: () => {}, sweepOrphanViewers: () => {}, rememberWorkspaceParent: () => {},
    workspaceSuggestions, deploymentsInside, opendirSync, readRecents: () => [],
    noteWindowActivity: () => {}, terminalBroker: { register() {} }, suggestionCalls: { forget() {} }, lastPickChoices: new Map(),
    serverHost: { owned: () => true },
  };
  context.advertisedNow = () => context.allowedWs;
  const main = runInNewContext(`${wsValidateBlock}
${knownDirsBlock}
${listEntriesBlock}
const suggestions = ${suggestionListBlock};
const spawnChild = ${spawnChildBlock};
${windowSection}
${windowBlock}
${noteServedBlock}
/* The backend serves the local deployments it was spawned with (and here no remote one). */
let serving = [];
async function ensureServer() { spawnChild([...workspaceDirs], 4821); serving = [...workspaceDirs]; await panelWorkspaces(); }
async function panelWorkspaces() {
  const list = serving.map((dir) => ({ id: dir, name: dir.split('/').pop(), deployments: [dir] }));
  allowedWs = new Set(list.map((w) => w.id)); noteServed(list); return list;
}
({ windows, choosers, suggestions, start: async () => {${startupBody}} })`, context);
  await main.start();
  appEvents.get('will-quit')?.(); // windows.json is written as it is at quit
  const read = (name) => { try { return JSON.parse(readFileSync(join(m.userData, name), 'utf8')); } catch { return undefined; } };
  const claim = async (win, id) => JSON.parse(JSON.stringify(await handlers.get('window:claim-workspace')(
    { sender: Object.assign(win.webContents, { isDestroyed: () => false }), senderFrame: win.webContents.mainFrame }, id, { focus: false, initial: true })));
  return { spawned, windows: FakeWindow.all, main, claim, logs, openFile: read('workspace-open.json'), windowsFile: read('windows.json') };
}

test('main spawns the backend with its stdin as the owner lifeline: a pipe, and the flag (#698)', async () => {
  const m = machine();
  try {
    const r = await launch(m, { launch: m.deployment });
    assert.equal(r.spawned.length, 1, 'one backend');
    const { bin, args, stdio } = r.spawned[0];
    assert.equal(bin, '/app/OATS Desktop', 'the executable, run as Node');
    assert.deepEqual(args.slice(0, 4), [join(HERE, 'server', 'oats-web.mjs'), 'start', '--port', '4821']);
    assert.ok(args.includes(LIFELINE_FLAG), `the server is told stdin is its lifeline: ${args.join(' ')}`);
    assert.deepEqual(stdio, ['pipe', 'pipe', 'pipe'], 'stdin a pipe main holds, never "ignore"');
  } finally { rmSync(m.root, { recursive: true, force: true }); }
});

const record = (workspace, deployments) => ({ workspace, deployments, bounds: { x: 80, y: 60, width: 1200, height: 800 }, maximized: false });
const mentionsSlash = (value) => JSON.stringify(value ?? null).includes('"/"');

for (const [name, state] of [
  ['(a) nothing saved', (m) => ({})],
  ['(b) a saved set of folders that are not deployments', (m) => ({ openSet: m.folders })],
  ['(c) windows.json holding a window bound to "/"', (m) => ({ openSet: [m.folders[0]], windowsFile: [record('/', ['/'])] })],
]) {
  test(`a Finder launch from "/" with ${name}: nothing is served, the window chooses, neither file gains or keeps "/" (#518)`, async () => {
    const m = machine();
    try {
      const given = state(m);
      const r = await launch(m, given);
      assert.equal(r.spawned.length, 1, 'one backend');
      const { args, cwd } = r.spawned[0];
      assert.deepEqual(args.filter((_, i) => args[i - 1] === '--dir'), [], 'no --dir at all: no folder that is not a deployment is served');
      assert.ok(!args.includes('/'), 'never --dir /');
      assert.equal(cwd, m.home, 'the backend runs in the home directory, never the launch folder');
      assert.equal(r.windows.length, 1, 'one window');
      const [win] = r.windows;
      assert.deepEqual({ ...win.loaded }, {}, 'bound to nothing (no #ws=)');
      assert.equal(win.title, 'OATS Desktop');
      for (const id of ['', '/']) assert.equal((await r.claim(win, id)).code, 'choose', `its first claim (${JSON.stringify(id)}) is refused: it shows the switcher`);
      assert.equal(r.main.windows.keyOf(win), null);
      assert.deepEqual(r.openFile, given.openSet, 'workspace-open.json is left as it was (absent, or the saved paths)');
      assert.ok(!mentionsSlash(r.openFile), 'workspace-open.json never names "/"');
      assert.ok(!mentionsSlash(r.windowsFile), `windows.json never names "/": ${JSON.stringify(r.windowsFile)}`);
      if (given.windowsFile) assert.deepEqual(r.windowsFile, [], 'the window saved on "/" is forgotten at launch');
    } finally { rmSync(m.root, { recursive: true, force: true }); }
  });
}

test('a Finder launch whose saved set holds a deployment serves it, from it, and its window binds (#461, #518)', async () => {
  const m = machine();
  try {
    const r = await launch(m, { openSet: [m.deployment, m.folders[0]], windowsFile: [record('/', ['/']), record(m.deployment, [m.deployment])] });
    const { args, cwd } = r.spawned[0];
    assert.deepEqual(args.filter((_, i) => args[i - 1] === '--dir'), [m.deployment]);
    assert.equal(cwd, m.deployment, 'the backend runs in the first served deployment');
    assert.deepEqual(r.windows.map((w) => w.title), ['oats'], 'the deployment\'s window is restored; the "/" one is not');
    assert.deepEqual(r.openFile, [m.deployment, m.folders[0]], 'the saved set is kept as it was (#472)');
    assert.deepEqual(r.windowsFile.map((w) => w.workspace), [m.deployment], 'only the "/" record is dropped');
  } finally { rmSync(m.root, { recursive: true, force: true }); }
});

test('a launch on a deployment (--dir, or a deployment cwd) serves it and opens its window, and saves it', async () => {
  const m = machine();
  try {
    const r = await launch(m, { launch: m.deployment });
    assert.deepEqual(r.spawned[0].args.filter((_, i, a) => a[i - 1] === '--dir'), [m.deployment]);
    assert.deepEqual(r.windows.map((w) => [w.title, w.loaded.hash]), [['oats', workspaceHash(m.deployment).slice(1)]]);
    assert.deepEqual(r.openFile, [m.deployment]);
    assert.equal(basename(r.windowsFile[0].workspace), 'oats');
  } finally { rmSync(m.root, { recursive: true, force: true }); }
});

test('the switcher suggests this computer\'s deployments not served: those in ~/Agents, and a saved one that came back (#518)', async () => {
  const m = machine();
  try {
    // Saved, but its volume was not mounted at launch: kept, not served (#472).
    const later = join(m.root, 'Volumes', 'work', 'tsm');
    mkdirSync(join(m.home, 'Agents', 'jro'), { recursive: true }); writeFileSync(join(m.home, 'Agents', 'jro', 'oats-local.yaml'), '');
    const r = await launch(m, { openSet: [m.deployment, later] });
    assert.deepEqual(r.spawned[0].args.filter((_, i, a) => a[i - 1] === '--dir'), [m.deployment]);
    mkdirSync(later, { recursive: true }); writeFileSync(join(later, 'oats-local.yaml'), ''); // mounted now
    const offered = r.main.suggestions().map((s) => [s.path, s.reason]);
    assert.deepEqual(offered, [[later, 'known workspace'], [join(m.home, 'Agents', 'jro'), 'found in ~/Agents']],
      'the served oats is not offered; a plain folder never is');
  } finally { rmSync(m.root, { recursive: true, force: true }); }
});
