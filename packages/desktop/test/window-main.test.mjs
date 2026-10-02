// One Desktop window per workspace (#481): main's shipped window section, run in a vm with the real
// registry (window-set.mjs) and records (window-records.mjs) over fake BrowserWindows. Covers the window
// channels (claim in place, open, New Window), restore at launch, titles, and closing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createWindowSet } from '../window-set.mjs';
import { parseWindowRecords, resolveView, restorePlan, clampBounds, windowTitle, createWindowRecords } from '../window-records.mjs';
import { trustedForgeFrame } from '../forge-proxy.mjs';
import { validWorkspaceId } from '../renderer/workspace-id.mjs';
import { workspaceHash, trustedRendererUrl } from '../renderer/window-binding.mjs';

const RENDERER = 'file:///app/renderer/index.html';
const A = 'ws:aaaaaaaaaaaaaaaaaaaa', B = 'ws:bbbbbbbbbbbbbbbbbbbb';
const SERVED = [{ id: A, name: 'oats', deployments: ['/d/oats'] }, { id: B, name: 'tsm', deployments: ['/d/tsm'] },
  { id: 'remote:rigel:/x', name: 'x', deployments: ['remote:rigel:/x'], machines: ['rigel'], remote: true }];
const source = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('// ---- windows: one per workspace (#481)'), source.indexOf('function createWindow(workspaceId'));
const windowBlock = source.match(/function createWindow\(workspaceId, record = null\)[^]*?\n\}/)[0];
const noteServedBlock = source.match(/function noteServed\(list\) \{[^]*?\n\}/)[0];
const tick = () => new Promise((r) => setImmediate(r));

class FakeWindow extends EventEmitter {
  constructor(options) {
    super(); this.options = options; this.title = options.title; this.destroyed = false; this.minimized = false; this.calls = [];
    this.bounds = { x: options.x ?? 100, y: options.y ?? 100, width: options.width, height: options.height };
    this.webContents = Object.assign(new EventEmitter(), { id: FakeWindow.next++, setWindowOpenHandler() {} });
    this.webContents.mainFrame = { url: RENDERER };
    FakeWindow.all.push(this);
  }
  setTitle(title) { this.title = title; }
  isDestroyed() { return this.destroyed; } isMinimized() { return this.minimized; }
  restore() { this.calls.push('restore'); } show() { this.calls.push('show'); } focus() { this.calls.push('focus'); }
  maximize() { this.calls.push('maximize'); } setFullScreen(on) { this.calls.push(`fullscreen:${on}`); }
  getNormalBounds() { return this.bounds; } isMaximized() { return false; } isFullScreen() { return false; }
  async loadFile(_file, options) { this.loaded = options; if (options.hash) this.webContents.mainFrame.url = `${RENDERER}#${options.hash}`; }
  close({ quitting = false } = {}) { main.quitStarted = quitting; this.emit('close'); this.destroyed = true; this.emit('closed'); }
}
FakeWindow.next = 1; FakeWindow.all = [];
let main;

function boot({ records = [], served = SERVED, dirs = ['/d/oats', '/d/tsm'], displays = [{ workArea: { x: 0, y: 25, width: 1440, height: 875 } }] } = {}) {
  FakeWindow.all = [];
  const handlers = new Map(), file = join(mkdtempSync(join(tmpdir(), 'oats-win-')), 'windows.json');
  const context = {
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, app: { getPath: () => '/memory' }, join, HERE: '/memory',
    BrowserWindow: Object.assign(FakeWindow, { fromWebContents: (wc) => FakeWindow.all.find((w) => w.webContents === wc) }),
    screen: { getAllDisplays: () => displays }, RENDERER_URL: RENDERER, servedList: served, allowedWs: new Set(served.map((w) => w.id)),
    advertisedBefore: new Set(), quitStarted: false, console, Menu: {}, shell: {},
    createWindowSet, restorePlan, resolveView, clampBounds, windowTitle, trustedForgeFrame, validWorkspaceId, workspaceHash, trustedRendererUrl,
    terminalBroker: { register() {} }, suggestionCalls: { forget() {} }, lastPickChoices: new Map(), workspaceDirs: dirs,
  };
  context.advertisedNow = () => context.allowedWs;
  main = runInNewContext(`${section}\n${windowBlock}\n${noteServedBlock}\n({ noteServed, windows, choosers, openWorkspaceWindow, openNewWindow, restoreWindows, setRecords: (r) => { windowRecords = r; }, setAdvertised: (set) => { allowedWs = set; }, setServed: (list) => { servedList = list; }, get windowRecords() { return windowRecords; } })`, context);
  Object.defineProperty(main, 'quitStarted', { set: (v) => { context.quitStarted = v; } });
  main.setRecords(createWindowRecords({ file, initial: records, timers: { setTimeout: () => 1, clearTimeout() {} } }));
  const event = (win) => ({ sender: Object.assign(win.webContents, { isDestroyed: () => false }), senderFrame: win.webContents.mainFrame });
  // Replies built in the vm are compared by value (their prototypes are the vm's).
  const plain = (value) => JSON.parse(JSON.stringify(value));
  return { main, handlers, event, file, claim: async (win, id, options) => plain(await handlers.get('window:claim-workspace')(event(win), id, options)),
    open: async (win, id) => plain(await handlers.get('window:open-workspace')(event(win), id)) };
}
const record = (workspace, x = 50) => ({ workspace, bounds: { x, y: 60, width: 900, height: 700 }, maximized: false });

test('restore with two workspaces: a window each, bound by its hash, titled from the served list, with its bounds', () => {
  const b = boot({ records: [record(A), record(B, 300)] });
  b.main.restoreWindows();
  assert.equal(FakeWindow.all.length, 2);
  assert.deepEqual(FakeWindow.all.map((w) => [w.loaded.hash, w.title, w.options.x]), [[workspaceHash(A).slice(1), 'oats', 50], [workspaceHash(B).slice(1), 'tsm', 300]]);
});

test('restore with one workspace missing: no window for it, and windows.json still lists it', () => {
  const b = boot({ records: [record('/d/gone'), record(B)] });
  b.main.restoreWindows();
  assert.deepEqual(FakeWindow.all.map((w) => w.title), ['tsm']);
  assert.deepEqual(b.main.windowRecords.records().map((r) => r.workspace), ['/d/gone', B]);
});

test('restore with bounds off-screen: clamped onto a visible display', () => {
  const b = boot({ records: [{ ...record(A), bounds: { x: 4000, y: 3000, width: 900, height: 700 } }] });
  b.main.restoreWindows();
  const { x, y, width, height } = FakeWindow.all[0].options;
  assert.deepEqual({ x, y, width, height }, { x: 270, y: 112, width: 900, height: 700 });
});

test('with nothing to restore (the first launch after the update), one window that takes the shared default', () => {
  const b = boot();
  b.main.restoreWindows();
  assert.equal(FakeWindow.all.length, 1);
  assert.deepEqual({ ...FakeWindow.all[0].loaded }, {}, 'no hash: the renderer takes the localStorage selection when main lets it');
  assert.equal(FakeWindow.all[0].title, 'OATS Desktop');
});

test('a Finder launch serving no local deployment opens one unbound window that chooses, never one on / (#518)', async () => {
  for (const served of [[], SERVED.filter((w) => w.remote)]) {
    // (a) nothing saved, (b) a saved set of non-deployments, (c) a windows.json record bound to '/': none is served.
    const b = boot({ records: [{ ...record('/'), deployments: ['/'] }], served, dirs: [] });
    b.main.restoreWindows();
    assert.equal(FakeWindow.all.length, 1);
    const win = FakeWindow.all[0];
    assert.deepEqual({ ...win.loaded }, {}, 'no #ws=: bound to nothing');
    assert.equal(win.title, 'OATS Desktop');
    for (const id of ['', '/']) {
      const refused = await b.claim(win, id, { focus: false, initial: true });
      assert.equal(refused.code, 'choose', 'the shared default (even a stale "/") is never taken: the switcher opens');
      assert.deepEqual(refused.workspaces, served);
    }
    assert.equal(b.main.windows.keyOf(win), null);
    assert.deepEqual(b.main.windowRecords.records().map((r) => r.workspace), ['/'], 'restore binds nothing to "/" (startup cleans the stale record: forgetNonDeployments)');
  }
});

test('the launch\'s own deployment gets its window beside the restored ones, or focuses the one it has', () => {
  const b = boot({ records: [record(A)] });
  b.main.restoreWindows(B);
  assert.deepEqual(FakeWindow.all.map((w) => w.title), ['oats', 'tsm']);
  const again = boot({ records: [record(A)] });
  again.main.restoreWindows(A);
  assert.equal(FakeWindow.all.length, 1); assert.deepEqual(FakeWindow.all[0].calls, ['show', 'focus']);
});

test('open: a workspace\'s window is focused when it has one, and no duplicate is created', async () => {
  const b = boot();
  const first = FakeWindow.all[0] ?? b.main.openNewWindow();
  assert.deepEqual(await b.open(first, A), { ok: true, opened: true });
  const created = FakeWindow.all.length;
  assert.deepEqual(await b.open(first, A), { ok: true, focused: true });
  assert.equal(FakeWindow.all.length, created, 'refuses a duplicate');
  assert.deepEqual(FakeWindow.all.at(-1).calls, ['show', 'focus']);
  assert.deepEqual(await b.open(first, 'a\nb'), { ok: false, code: 'bad-workspace' });
});

test('an in-place switch rebinds the window: its title and its record follow', async () => {
  const b = boot({ records: [record(A)] });
  b.main.restoreWindows();
  const win = FakeWindow.all[0];
  assert.deepEqual(await b.claim(win, B), { ok: true, workspace: B });
  assert.equal(win.title, 'tsm', 'the title follows the switch');
  assert.equal(b.main.windows.windowOf(B), win); assert.equal(b.main.windows.windowOf(A), null);
  assert.deepEqual(b.main.windowRecords.records().map((r) => r.workspace), [B], 'the window\'s record follows it');
  assert.deepEqual(await b.claim(win, 'remote:rigel:/x'), { ok: true, workspace: 'remote:rigel:/x' });
  assert.equal(win.title, 'x — rigel', 'a remote workspace is titled with its server');
});

test('a claim for a workspace another window has focuses that window and refuses with the choices', async () => {
  const b = boot({ records: [record(A), record(B)] });
  b.main.restoreWindows();
  const [a, other] = FakeWindow.all;
  const refused = await b.claim(a, B);
  assert.equal(refused.ok, false); assert.equal(refused.code, 'focused-other'); assert.equal(refused.workspaces.length, SERVED.length);
  assert.deepEqual(other.calls, ['show', 'focus']); assert.equal(a.title, 'oats', 'this window does not change');
  const quiet = await b.claim(a, B, { focus: false });
  assert.equal(quiet.code, 'open-elsewhere'); assert.deepEqual(other.calls, ['show', 'focus'], 'not focused again');
});

test('a New Window chooses: its first claim of the shared default is refused; its choice then binds it', async () => {
  const b = boot();
  const win = b.main.openNewWindow();
  const refused = await b.claim(win, A, { focus: false, initial: true });
  assert.equal(refused.code, 'choose'); assert.equal(refused.workspaces.length, SERVED.length);
  assert.deepEqual(await b.claim(win, A), { ok: true, workspace: A });
  assert.equal(win.title, 'oats');
});

test('a window that leaves its workspace (claim null) keeps its record, untitled', async () => {
  const b = boot({ records: [record(A)] });
  b.main.restoreWindows();
  const win = FakeWindow.all[0];
  assert.deepEqual(await b.claim(win, null), { ok: true });
  assert.equal(win.title, 'OATS Desktop'); assert.equal(b.main.windows.windowOf(A), null);
  win.close();
  assert.deepEqual(b.main.windowRecords.records().map((r) => r.workspace), [A], 'not the window\'s any more: kept');
});

test('closing removes a window from the registry; its record goes only if its workspace is served and the app is not quitting', () => {
  const b = boot({ records: [record(A), record(B)] });
  b.main.restoreWindows();
  const [a, other] = FakeWindow.all;
  a.close();
  assert.equal(b.main.windows.windowOf(A), null);
  assert.deepEqual(b.main.windowRecords.records().map((r) => r.workspace), [B]);
  other.close({ quitting: true });
  assert.deepEqual(b.main.windowRecords.records().map((r) => r.workspace), [B], 'quitting forgets nothing');
});

test('a closed window whose workspace is not served keeps its record', () => {
  const b = boot({ records: [record(A)] });
  b.main.restoreWindows();
  b.main.setAdvertised(new Set([B])); // the server stopped serving A
  FakeWindow.all[0].close();
  assert.deepEqual(b.main.windowRecords.records().map((r) => r.workspace), [A]);
});

test('titles are main\'s: the page cannot retitle a window', () => {
  boot().main.restoreWindows();
  let prevented = false;
  FakeWindow.all[0].emit('page-title-updated', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
});

test('the shared default is taken only while the server advertises it: otherwise not-served, and the window adopts as before', async () => {
  const b = boot();
  b.main.restoreWindows();
  const win = FakeWindow.all[0];
  const refused = await b.claim(win, 'ws:gonegonegonegonegone', { focus: false, initial: true });
  assert.equal(refused.code, 'not-served');
  assert.equal(b.main.windows.keyOf(win), null, 'still no workspace: it reads with the verified one and adopts');
  assert.deepEqual(await b.claim(win, A, { focus: false, initial: true }), { ok: true, workspace: A });
});

test('a relaunch before observation restores the window through its deployments; it follows to its ws: view once observed', async () => {
  // Before the server has read alpha's identity, alpha is served under its own deployment id.
  const unobserved = [{ id: '/d/oats', name: 'oats', deployments: ['/d/oats'], unattached: true }, SERVED[1]];
  const b = boot({ records: [{ ...record(A), deployments: ['/d/oats'] }], served: unobserved });
  b.main.restoreWindows();
  assert.equal(FakeWindow.all.length, 1, 'restored, not lost');
  const win = FakeWindow.all[0];
  assert.equal(win.loaded.hash, workspaceHash('/d/oats').slice(1)); assert.equal(win.options.x, 50, 'with its bounds');
  // Observed: the view is served under its ws: id; the renderer's rehome claims it without focusing anything.
  b.main.setAdvertised(new Set(SERVED.map((w) => w.id)));
  assert.deepEqual(await b.claim(win, A, { focus: false }), { ok: true, workspace: A });
  assert.deepEqual(b.main.windowRecords.records().map((r) => r.workspace), [A], 'the record follows the window (rewritten, not added)');
  assert.deepEqual(win.calls, [], 'nothing focused');
});

test('a claim or open naming a deployment id is resolved to the view that holds it: an open view keeps its window', async () => {
  const b = boot({ records: [record(A), record(B)] });
  b.main.restoreWindows();
  const [a, other] = FakeWindow.all;
  // Browse… to the folder of a workspace another window has: that window is focused; this one is unchanged.
  const refused = await b.claim(other, '/d/oats');
  assert.equal(refused.code, 'focused-other');
  assert.deepEqual(a.calls, ['show', 'focus']); assert.equal(b.main.windows.keyOf(other), B);
  assert.equal(b.main.windows.windowOf('/d/oats'), null, 'never a second key for the same workspace');
  // Open in new window by deployment id: the view's window.
  assert.deepEqual(await b.open(other, '/d/tsm'), { ok: true, focused: true });
  assert.equal(FakeWindow.all.length, 2);
});

test('a claim of a deployment id whose view has no window binds the view, and says so', async () => {
  const b = boot();
  const win = b.main.openNewWindow();
  assert.deepEqual(await b.claim(win, '/d/tsm'), { ok: true, workspace: B });
  assert.equal(b.main.windows.keyOf(win), B); assert.equal(win.title, 'tsm');
});

test('a window left with no workspace is one main knows has nothing to read', async () => {
  const b = boot({ records: [record(A), record(B)] });
  b.main.restoreWindows();
  const [a, other] = FakeWindow.all;
  await b.claim(a, null);
  assert.equal((await b.claim(a, B, { focus: false, initial: true })).code, 'choose', 'left choosing: never the shared default');
  const fresh = b.main.openNewWindow(); b.main.choosers.delete(fresh); // a window opened with no workspace, adopting
  assert.equal((await b.claim(fresh, B, { focus: false, initial: true })).code, 'open-elsewhere');
  assert.equal((await b.claim(fresh, A, { focus: false, initial: true })).code, 'choose', 'its default open elsewhere: it chooses from then on');
  assert.deepEqual(await b.claim(fresh, '/d/gone'), { ok: true, workspace: '/d/gone' }, 'a choice binds it');
  assert.equal(b.main.choosers.has(fresh), false);
  assert.equal(other.title, 'tsm');
});

test('a window keyed by a deployment moves to its view in main as soon as the served list names it, so no second window can take it', async () => {
  const unobserved = [{ id: '/d/oats', name: 'oats', deployments: ['/d/oats'], unattached: true }, SERVED[1]];
  const b = boot({ records: [{ ...record(A), deployments: ['/d/oats'] }, record(B)], served: unobserved });
  b.main.restoreWindows();
  const [win, other] = FakeWindow.all;
  assert.equal(b.main.windows.keyOf(win), '/d/oats');
  b.main.noteServed(SERVED); // the identity observed: the served list now names the view ws:aaaa…
  assert.equal(b.main.windows.keyOf(win), A, 'rekeyed in main at once, before the window\'s next read');
  assert.equal(win.title, 'oats', 'titled from its view');
  assert.deepEqual(win.calls, [], 'nothing focused');
  assert.deepEqual(b.main.windowRecords.records().map((r) => r.workspace), [A, B]);
  const refused = await b.claim(other, A);
  assert.equal(refused.code, 'focused-other', 'another window cannot take the workspace in the meantime');
  assert.deepEqual(await b.claim(win, A, { focus: false }), { ok: true, workspace: A }, 'the window\'s own follow is a no-op');
});

test('a window keyed by a deployment whose view another window already has is left to its own follow (it will choose)', () => {
  const unobserved = [{ id: '/d/oats', name: 'oats', deployments: ['/d/oats'], unattached: true }, SERVED[1]];
  const b = boot({ served: unobserved });
  const byPath = b.main.openWorkspaceWindow('/d/oats').win;
  b.main.setServed(SERVED);
  const byView = b.main.openWorkspaceWindow(A).win;
  b.main.noteServed(SERVED);
  assert.equal(b.main.windows.keyOf(byPath), '/d/oats', 'not moved onto the view another window has');
  assert.equal(b.main.windows.keyOf(byView), A);
  assert.deepEqual(byView.calls, [], 'the other window is not focused');
});
