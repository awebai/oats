// main's wiring of the listed-waiting scheduler (the needs-input dot of a listed workspace no window
// serves): main's shipped block, from `const listedWaiting` to its will-quit, run in a vm with the real
// scheduler (packages/client/listed-waiting.mjs, on fake timers) over a faked served CLI, identity read and
// Electron app. Its read passes the scheduler's maxAge through to cliDeploymentIdentity with the CLI the
// server serves and main's CLI environment; a failed /api/cli read answers null and runs no CLI; the focus
// follows BrowserWindow.getAllWindows() on every window focus and blur; will-quit stops it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createListedWaiting, LISTED_WAITING_MAX_AGE } from '../../client/listed-waiting.mjs';

const source = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8');
const block = (() => {
  const from = source.indexOf('const listedWaiting = createListedWaiting({');
  const end = 'app.on("will-quit", () => listedWaiting.stop());';
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'main\'s listedWaiting block');
  return source.slice(from, to + end.length);
})();
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };

function boot({ cli = { version: '9.9.9', features: ['waiting-on-you'] }, identity = async () => ({ ok: true, workspace: null, waiting: true }) } = {}) {
  const appEvents = new Map(), reads = [], focus = [], timers = [];
  const windows = [];
  let stopped = 0;
  const context = {
    app: { on: (event, fn) => appEvents.set(event, fn) },
    BrowserWindow: { getAllWindows: () => windows },
    process: { env: { PATH: '/usr/bin' } },
    cliEnvironment: (env) => ({ from: env }),
    readServedCli: async () => { if (cli instanceof Error) throw cli; return cli; },
    cliDeploymentIdentity: async (...args) => { reads.push(args); return identity(...args); },
    // The real scheduler, on timers the test fires; its focus and stop are recorded.
    createListedWaiting: (options) => {
      const real = createListedWaiting({ ...options, timers: { setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {} } });
      return { ...real, setFocused: (value) => { focus.push(value); real.setFocused(value); }, stop: () => { stopped++; real.stop(); } };
    },
  };
  const listedWaiting = runInNewContext(`${block}\nlistedWaiting`, context);
  return { listedWaiting, appEvents, reads, focus, windows, timers, stopped: () => stopped,
    fire: async () => { for (const fn of timers.splice(0)) fn(); await flush(); } };
}
const win = (focused, destroyed = false) => ({ isFocused: () => focused, isDestroyed: () => destroyed });

test('a listed row is read with the served CLI, the scheduler\'s maxAge and main\'s CLI environment', async () => {
  const cli = { version: '9.9.9', features: ['waiting-on-you'] };
  const m = boot({ cli });
  m.listedWaiting.setPaths(['/d/listed']);
  await m.fire();
  assert.equal(m.reads.length, 1);
  const [readCli, path, options, io] = m.reads[0];
  assert.equal(readCli, cli, 'the CLI the server serves (/api/cli)');
  assert.equal(path, '/d/listed');
  assert.deepEqual({ ...options }, { maxAge: LISTED_WAITING_MAX_AGE }, 'maxAge passed through: the read\'s --max-age');
  assert.deepEqual(JSON.parse(JSON.stringify(io)), { env: { from: { PATH: '/usr/bin' } } }, 'main\'s CLI environment');
  assert.equal(m.listedWaiting.waiting('/d/listed'), true);
});

test('a failed /api/cli read answers null: no CLI runs, and the row shows no dot', async () => {
  const m = boot({ cli: new Error('backend down') });
  m.listedWaiting.setPaths(['/d/listed']);
  await m.fire();
  assert.deepEqual(m.reads, [], 'no identity read without a served CLI');
  assert.equal(m.listedWaiting.waiting('/d/listed'), null);
});

test('focus and blur set the focus from every live window; will-quit stops the reads', async () => {
  const m = boot();
  for (const event of ['browser-window-focus', 'browser-window-blur', 'will-quit']) assert.equal(typeof m.appEvents.get(event), 'function', event);
  m.windows.push(win(false), win(true, true)); // a destroyed window never counts, focused or not
  m.appEvents.get('browser-window-blur')();
  m.windows.push(win(true));
  m.appEvents.get('browser-window-focus')();
  m.windows.splice(2, 1);
  m.appEvents.get('browser-window-focus')(); // the focused window closed meanwhile
  assert.deepEqual(m.focus, [false, true, false]);
  m.appEvents.get('will-quit')();
  assert.equal(m.stopped(), 1);
  m.listedWaiting.setPaths(['/d/listed']);
  await m.fire();
  assert.deepEqual(m.reads, [], 'nothing is read after quit');
});
