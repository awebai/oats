// The shell's side of a launch's --instance (D3 of #1665): main's ask (onLaunchFocus) becomes a request of the
// shipped launch focus, the rows the window already shows answer it at once, and the one act it takes is
// showInRoster. No terminal opens, nothing starts, and no read or write is made for it. The shipped shell.mjs
// lines run in a vm over fakes that record every call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createLaunchFocus } from '../renderer/launch-focus.mjs';

const source = readFileSync(new URL('../renderer/shell.mjs', import.meta.url), 'utf8');
const between = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return source.slice(a, b); };
const creation = between("// A launch's --instance (launch-focus.mjs): its row is selected", '// Persistent recursive instance tree');
const subscription = between('// A launch asks this window to select an instance', '/** Another window took `workspace` over.');
const row = (instance) => ({ instance, home: `/d/acme/agents/x/instances/${instance}`, deployment: { id: '/d/acme' } });

function shell({ shown = null } = {}) {
  const calls = [];
  let subscriber = null, ticket = 0;
  const forbidden = (name) => () => { throw new Error(`${name} must not run for a launch's --instance`); };
  const c = {
    createLaunchFocus, calls,
    tabOpenIntents: { watch: () => { const mine = ticket; return () => mine === ticket; } },
    operator: { input: () => 0, pointer: () => 0 },
    showInRoster: async (r) => { calls.push(['showInRoster', r.instance]); return true; },
    notifications: { notify: (text) => calls.push(['notify', text]) },
    window: { addEventListener() {} },
    desktopBridge: { onLaunchFocus: (fn) => { subscriber = fn; } },
    shownRoster: shown, currentWorkspace: () => 'ws:acme',
    openTerminalTab: forbidden('openTerminalTab'), openInstanceStart: forbidden('openInstanceStart'), api: forbidden('api'),
  };
  runInNewContext(`${creation}\n${subscription}\nglobalThis.launchFocus = launchFocus;`, c);
  return { c, ask: (m) => subscriber(m), choose: () => { ticket++; } };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("second launch on a window already showing the row: selected at once through showInRoster, and nothing else", async () => {
  const s = shell({ shown: { ws: 'ws:acme', instances: [row('dev-1'), row('dev-2')] } });
  s.ask({ deployment: '/d/acme', name: 'dev-2' });
  await settle();
  assert.deepEqual(s.c.calls, [['showInRoster', 'dev-2']]);
});

test('first launch: the ask waits for the first roster read, which selects the row', async () => {
  const s = shell();
  s.ask({ deployment: '/d/acme', name: 'dev-2' });
  assert.equal(s.c.launchFocus.pending(), true);
  s.c.launchFocus.observe([row('dev-2')]);
  await settle();
  assert.deepEqual(s.c.calls, [['showInRoster', 'dev-2']]);
});

test('rows of another workspace do not answer an ask', async () => {
  const s = shell({ shown: { ws: 'ws:other', instances: [row('dev-2')] } });
  s.ask({ deployment: '/d/acme', name: 'dev-2' });
  await settle();
  assert.deepEqual(s.c.calls, []);
  assert.equal(s.c.launchFocus.pending(), true);
});

test('an invalid value is said in the window as text, without the value', async () => {
  const s = shell({ shown: { ws: 'ws:acme', instances: [row('dev-1')] } });
  s.ask({ invalid: true });
  assert.deepEqual(s.c.calls, [['notify', "The instance named at launch isn't a valid instance name."]]);
});

test("a person's selection before the next read drops a pending ask", async () => {
  const s = shell();
  s.ask({ deployment: '/d/acme', name: 'dev-2' });
  s.c.launchFocus.observe([row('dev-1')]);
  s.choose();
  s.c.launchFocus.observe([row('dev-2')]);
  await settle();
  assert.deepEqual(s.c.calls, []);
});

test('the shell feeds the launch focus only observed reads of this computer\'s rows, after the paint', () => {
  const read = between('async function refreshContextRoster(', '\n/** #1237: close every terminal tab');
  const paint = read.indexOf('renderContextRoster(contextInstances);\n  }\n'), feed = read.indexOf('if (!reportedFailure && !panel.workspace?.remote) launchFocus.observe(contextInstances);');
  assert.ok(paint > 0 && feed > paint, 'observed after the rows are painted');
  assert.equal(read.split('launchFocus.').length - 1, 1, 'one place');
});
