// Restore on relaunch (#481, item 7) and window titles (item 6). windows.json in userData records
// `[{ workspace, bounds, maximized, fullscreen? }]`, written atomically and debounced. At launch every
// record whose workspace is served gets its window back, bounds clamped to a visible display; one
// that isn't served gets no window and stays recorded. A record is dropped only when the operator
// closes that window while it's served.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseWindowRecords, resolveView, restorePlan, clampBounds, windowTitle, createWindowRecords } from '../window-records.mjs';

const A = 'ws:aaaaaaaaaaaaaaaaaaaa', B = 'ws:bbbbbbbbbbbbbbbbbbbb';
const SERVED = [
  { id: A, name: 'oats', deployments: ['/d/oats', 'remote:altair:/srv/oats'], machines: ['This Mac', 'altair'] },
  { id: B, name: 'tsm', deployments: ['/d/tsm'], machines: ['This Mac'] },
  { id: 'remote:rigel:/srv/x', name: 'x', deployments: ['remote:rigel:/srv/x'], machines: ['rigel'], server: 'rigel', remote: true },
];
const record = (workspace, x = 10, extra = {}) => ({ workspace, bounds: { x, y: 20, width: 800, height: 600 }, maximized: false, ...extra });
const DISPLAYS = [{ workArea: { x: 0, y: 25, width: 1440, height: 875 } }, { workArea: { x: 1440, y: 0, width: 1920, height: 1080 } }];

test('parse: valid records kept in order, malformed ones and junk refused', () => {
  const text = JSON.stringify([record(A), { workspace: 'a\nb', bounds: record(A).bounds, maximized: false }, record(B, 30, { maximized: true, fullscreen: true }),
    { workspace: A }, { workspace: A, bounds: { x: 'x', y: 0, width: 1, height: 1 }, maximized: false }, 'junk']);
  assert.deepEqual(parseWindowRecords(text), [record(A), record(B, 30, { maximized: true, fullscreen: true })]);
  for (const bad of ['', 'not json', '{}', 'null', '3']) assert.deepEqual(parseWindowRecords(bad), []);
});

test('resolve: a view id as itself; a deployment id as the view that holds it (viewFor); else null', () => {
  assert.equal(resolveView(A, SERVED), A);
  assert.equal(resolveView('/d/oats', SERVED), A, 'a deployment recorded before it matched a workspace');
  assert.equal(resolveView('remote:altair:/srv/oats', SERVED), A);
  assert.equal(resolveView('/d/gone', SERVED), null);
  assert.equal(resolveView(A, null), null);
});

test('restore with two workspaces: two windows, in record order, each with its record', () => {
  const records = [record(A), record(B, 400)];
  assert.deepEqual(restorePlan(records, SERVED), [{ key: A, record: records[0] }, { key: B, record: records[1] }]);
});

test('restore with one workspace missing: no window for it, and its record is kept', () => {
  const records = [record('/d/gone'), record(B)];
  assert.deepEqual(restorePlan(records, SERVED), [{ key: B, record: records[1] }]);
  assert.equal(records.length, 2, 'the plan never drops a record');
});

test('restore: two records resolving to one view give one window (the first record\'s)', () => {
  const records = [record('/d/oats'), record(A, 500)];
  assert.deepEqual(restorePlan(records, SERVED), [{ key: A, record: records[0] }]);
});

test('clamp: bounds on a display are kept; off-screen bounds come back onto a visible display', () => {
  const on = { x: 100, y: 100, width: 800, height: 600 };
  assert.deepEqual(clampBounds(on, DISPLAYS), on);
  const second = { x: 2000, y: 100, width: 800, height: 600 };
  assert.deepEqual(clampBounds(second, DISPLAYS), second, 'the second display is visible');
  // A display that was unplugged: entirely off every work area -> centred on the first (primary) display.
  assert.deepEqual(clampBounds({ x: 5000, y: 3000, width: 800, height: 600 }, DISPLAYS), { x: 320, y: 162, width: 800, height: 600 });
  // Straddling the right edge of the primary: moved fully onto the display it mostly covers.
  assert.deepEqual(clampBounds({ x: 1000, y: 100, width: 800, height: 600 }, DISPLAYS), { x: 640, y: 100, width: 800, height: 600 });
  // Larger than the work area: shrunk to it.
  assert.deepEqual(clampBounds({ x: 0, y: 0, width: 3000, height: 2000 }, DISPLAYS.slice(0, 1)), { x: 0, y: 25, width: 1440, height: 875 });
  assert.deepEqual(clampBounds(on, []), on, 'no display known: unchanged');
});

test('titles: the workspace\'s name; a remote workspace\'s name with its server; never an id', () => {
  assert.equal(windowTitle(A, SERVED), 'oats');
  assert.equal(windowTitle('remote:rigel:/srv/x', SERVED), 'x — rigel');
  assert.equal(windowTitle('remote:none', [{ id: 'remote:none', name: 'y', remote: true, server: 'srv-1' }]), 'y — srv-1', 'no machine label: the server id');
  assert.equal(windowTitle('/d/gone', SERVED), 'OATS Desktop', 'not served: the app\'s name');
  assert.equal(windowTitle(null, SERVED), 'OATS Desktop', 'unbound');
  assert.equal(windowTitle(A, [{ id: A, name: '' }]), 'OATS Desktop', 'no name: never the ws: id');
});

function timers() {
  const pending = new Map(); let next = 1;
  return { setTimeout: (fn) => { const id = next++; pending.set(id, fn); return id; }, clearTimeout: (id) => pending.delete(id),
    run() { const fns = [...pending.values()]; pending.clear(); for (const fn of fns) fn(); }, count: () => pending.size };
}

test('records: binding appends or rewrites the window\'s record; moves are debounced into one atomic write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oats-windows-')), file = join(dir, 'windows.json'), t = timers();
  const store = createWindowRecords({ file, initial: [record('/d/gone')], timers: t });
  const win = {};
  store.bind(win, '/d/oats', { bounds: record(A).bounds, maximized: false });
  assert.deepEqual(store.records().map((r) => r.workspace), ['/d/gone', '/d/oats']);
  store.bind(win, A); // the view it resolves to (Q6), or an in-place switch: the same record follows
  store.update(win, { bounds: { x: 1, y: 2, width: 3, height: 4 }, maximized: true, fullscreen: false });
  store.update(win, { bounds: { x: 5, y: 6, width: 7, height: 8 }, maximized: false, fullscreen: false });
  assert.equal(existsSync(file), false, 'debounced'); assert.equal(t.count(), 1);
  t.run();
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), [record('/d/gone'),
    { workspace: A, bounds: { x: 5, y: 6, width: 7, height: 8 }, maximized: false, fullscreen: false }]);
  assert.equal(existsSync(`${file}.tmp`), false, 'written through a temporary file and renamed');
});

test('records: a restored window adopts its record; closing while served drops it, closing while not served keeps it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oats-windows-')), file = join(dir, 'windows.json'), t = timers();
  const initial = [record(A), record(B)];
  const store = createWindowRecords({ file, initial, timers: t });
  const a = {}, b = {};
  store.adopt(a, store.records()[0]); store.adopt(b, store.records()[1]);
  store.close(a, { served: false });
  store.close(b, { served: true });
  store.flush();
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).map((r) => r.workspace), [A]);
  store.close({}, { served: true }); // a window with no record (unbound): nothing to drop
  assert.deepEqual(store.records().map((r) => r.workspace), [A]);
});

test('records: a write that fails keeps the records and the previous file', () => {
  const t = timers(), errors = [];
  const store = createWindowRecords({ file: '/nonexistent-root-dir/x/windows.json', initial: [], timers: t, onError: (e) => errors.push(e) });
  store.bind({}, A, { bounds: record(A).bounds, maximized: false });
  t.run();
  assert.equal(errors.length, 1); assert.equal(store.records().length, 1);
});
