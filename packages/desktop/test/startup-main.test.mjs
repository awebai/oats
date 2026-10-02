// A Finder launch (cwd `/`, no --dir) runs main's shipped startup in a vm (#518): the real registry,
// records and window code over a real userData folder and real deployment folders, with Electron and
// the backend process faked at their boundary. What the backend is spawned with (argv and cwd), the
// window it opens and what is written to workspace-open.json and windows.json are asserted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, realpathSync, lstatSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createWindowSet } from '../window-set.mjs';
import { parseWindowRecords, resolveView, restorePlan, clampBounds, windowTitle, createWindowRecords } from '../window-records.mjs';
import { validateWorkspace, restoreWorkspaceDirs, savedWorkspacePaths, persistableDirs, startupOpenSet, saveWorkspaceDirs } from '../workspace-registry.mjs';
import { trustedForgeFrame } from '../forge-proxy.mjs';
import { validWorkspaceId } from '../renderer/workspace-id.mjs';
import { workspaceHash, trustedRendererUrl } from '../renderer/window-binding.mjs';
import { fakeWindowClass } from './helpers/fake-window.mjs';

const RENDERER = 'file:///app/renderer/index.html';
const HERE = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const source = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8');
const between = (from, to) => { const i = source.indexOf(from); assert.ok(i >= 0, from); const j = source.indexOf(to, i); assert.ok(j > i, to); return source.slice(i, j); };
const windowSection = between('// ---- windows: one per workspace (#481)', 'function createWindow(workspaceId');
const windowBlock = source.match(/function createWindow\(workspaceId, record = null\)[^]*?\n\}/)[0];
const noteServedBlock = source.match(/function noteServed\(list\) \{[^]*?\n\}/)[0];
const wsValidateBlock = source.match(/const wsValidate = \(p\) => validateWorkspace\(p, \{[^]*?\n\}\);/)[0];
const spawnChildBlock = source.match(/spawnChild: (\(dirs, onPort\) => \{[^]*?\n {2}\}),/)[1];
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
    // The backend process, at its boundary: what main spawns it with is recorded.
    spawn: (bin, args, options) => { spawned.push({ bin, args: [...args], cwd: options.cwd }); return { stdout: { on() {} }, stderr: { on() {} } }; },
    process: { execPath: '/app/OATS Desktop', env: {} }, homedir: () => m.home, readCliChoice: () => null, loginPath: { source: 'login-shell', error: null },
    REMOTE_IDENTITY_FILE: () => join(m.userData, 'remote-identity.json'), HERE,
    // The real code main runs at startup.
    WORKSPACE, workspaceDirs: [], openDirs: [], join, existsSync, readFileSync, realpathSync, lstatSync, validateWorkspace,
    restoreWorkspaceDirs, savedWorkspacePaths, persistableDirs, startupOpenSet, saveWorkspaceDirs, createWindowRecords, parseWindowRecords,
    createWindowSet, restorePlan, resolveView, clampBounds, windowTitle, trustedForgeFrame, validWorkspaceId, workspaceHash, trustedRendererUrl,
    WINDOWS_FILE: () => join(m.userData, 'windows.json'), OPEN_WORKSPACES_FILE: () => join(m.userData, 'workspace-open.json'),
    RENDERER_URL: RENDERER, servedList: [], allowedWs: new Set(), advertisedBefore: new Set(), quitStarted: false,
    applyLoginPath: async () => {}, installAppMenu: () => {}, sweepOrphanViewers: () => {}, rememberWorkspaceParent: () => {}, knowDirs: () => {},
    noteWindowActivity: () => {}, terminalBroker: { register() {} }, suggestionCalls: { forget() {} }, lastPickChoices: new Map(),
    serverHost: { owned: () => true },
  };
  context.advertisedNow = () => context.allowedWs;
  const main = runInNewContext(`${wsValidateBlock}
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
({ windows, choosers, start: async () => {${startupBody}} })`, context);
  await main.start();
  appEvents.get('will-quit')?.(); // windows.json is written as it is at quit
  const read = (name) => { try { return JSON.parse(readFileSync(join(m.userData, name), 'utf8')); } catch { return undefined; } };
  const claim = async (win, id) => JSON.parse(JSON.stringify(await handlers.get('window:claim-workspace')(
    { sender: Object.assign(win.webContents, { isDestroyed: () => false }), senderFrame: win.webContents.mainFrame }, id, { focus: false, initial: true })));
  return { spawned, windows: FakeWindow.all, main, claim, logs, openFile: read('workspace-open.json'), windowsFile: read('windows.json') };
}

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
