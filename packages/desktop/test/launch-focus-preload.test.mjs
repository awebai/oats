// A launch's ask to select an instance (window:focus-instance, D3 of #1665), the preload side: it is heard from the
// page's start, and one that comes before the shell subscribes (onLaunchFocus) is kept for the first subscriber.
// Only the latest is kept: a later launch's ask replaces an earlier one. Shipped preload.cjs, in a vm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

function preload() {
  const require = createRequire(import.meta.url);
  let api = null;
  const listeners = new Map();
  const electron = {
    contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
    ipcRenderer: {
      invoke: () => { throw new Error('a launch focus invokes nothing'); }, send: () => { throw new Error('a launch focus sends nothing'); },
      on: (channel, fn) => { listeners.set(channel, [...(listeners.get(channel) ?? []), fn]); },
      removeListener: (channel, fn) => { listeners.set(channel, (listeners.get(channel) ?? []).filter((each) => each !== fn)); },
    },
    webUtils: {},
  };
  runInNewContext(readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8'),
    { process: { argv: [] }, require: (name) => (name === 'electron' ? electron : require(name === './terminal-bridge.cjs' ? '../terminal-bridge.cjs' : name)) });
  const send = (message) => { for (const fn of listeners.get('window:focus-instance') ?? []) fn({ sender: 'main' }, message); };
  return { api, send };
}
const ask = (name) => ({ deployment: '/d/acme', name });
const plain = (value) => JSON.parse(JSON.stringify(value));

test('an ask before the shell subscribes is kept, only the latest, and handed to the first subscriber once', () => {
  const p = preload();
  p.send(ask('dev-1'));
  p.send(ask('dev-2'));
  const first = [], second = [];
  p.api.onLaunchFocus((m) => first.push(m));
  p.api.onLaunchFocus((m) => second.push(m));
  assert.deepEqual(plain(first), [ask('dev-2')]);
  assert.deepEqual(second, []);
  p.send({ invalid: true });
  assert.deepEqual(plain(first), [ask('dev-2'), { invalid: true }], 'then each ask as it comes');
});

test('an unsubscribed shell hears nothing; asks are kept again for the next subscriber', () => {
  const p = preload();
  const off = p.api.onLaunchFocus(() => assert.fail('unsubscribed'));
  off();
  p.send(ask('dev-3'));
  const heard = [];
  p.api.onLaunchFocus((m) => heard.push(m));
  assert.deepEqual(plain(heard), [ask('dev-3')]);
});
