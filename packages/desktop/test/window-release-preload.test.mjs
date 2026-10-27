// A take-over's ask to release this window's workspace (window:release-workspace, #1488), the preload
// side: it is heard from the page's start. One that comes while the page is still loading, before the
// shell subscribes (onWorkspaceRelease, at the end of shell.mjs's top level), is kept and handed to the
// first subscriber, so a window just opened or reloading never drops it. Shipped preload.cjs, in a vm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

/** A fresh preload over a fake electron: its exposed api, and main's sends to the page. */
function preload() {
  const require = createRequire(import.meta.url);
  let api = null;
  const listeners = new Map();
  const electron = {
    contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
    ipcRenderer: {
      invoke: () => Promise.resolve(null), send() {},
      on: (channel, fn) => { listeners.set(channel, [...(listeners.get(channel) ?? []), fn]); },
      removeListener: (channel, fn) => { listeners.set(channel, (listeners.get(channel) ?? []).filter((each) => each !== fn)); },
    },
    webUtils: {},
  };
  runInNewContext(readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8'),
    { process: { argv: [] }, require: (name) => (name === 'electron' ? electron : require(name === './terminal-bridge.cjs' ? '../terminal-bridge.cjs' : name)) });
  const send = (message) => { for (const fn of listeners.get('window:release-workspace') ?? []) fn({ sender: 'main' }, message); };
  return { api, send, listeners };
}
const ask = (request) => ({ request, workspace: 'ws:bbbbbbbbbbbbbbbbbbbb', workspaces: [] });
const plain = (value) => JSON.parse(JSON.stringify(value));

test('an ask that comes before the shell subscribes is kept, and the first subscriber gets it', () => {
  const p = preload();
  p.send(ask(1)); // the page is still loading
  const heard = [];
  p.api.onWorkspaceRelease((message) => heard.push(message));
  assert.deepEqual(plain(heard), [ask(1)]);
  p.send(ask(2));
  assert.deepEqual(plain(heard), [ask(1), ask(2)], 'then each ask as it comes');
});

test('a kept ask is handed over once: a later subscriber does not get it again', () => {
  const p = preload();
  p.send(ask(1));
  const first = [], second = [];
  p.api.onWorkspaceRelease((message) => first.push(message));
  p.api.onWorkspaceRelease((message) => second.push(message));
  assert.equal(first.length, 1); assert.deepEqual(second, []);
});

test('while no one subscribes (after an unsubscribe too), asks are kept, at most 8, the newest', () => {
  const p = preload();
  const off = p.api.onWorkspaceRelease(() => assert.fail('unsubscribed'));
  off();
  for (let request = 1; request <= 10; request++) p.send(ask(request));
  const heard = [];
  p.api.onWorkspaceRelease((message) => heard.push(message.request));
  assert.deepEqual(heard, [3, 4, 5, 6, 7, 8, 9, 10]);
});

test('the IPC event never reaches the page; one listener on the channel, from the start', () => {
  const p = preload();
  assert.equal(p.listeners.get('window:release-workspace')?.length, 1, 'listening before any subscriber');
  const heard = [];
  const off = p.api.onWorkspaceRelease((...args) => heard.push(args));
  p.send(ask(1));
  assert.deepEqual(plain(heard), [[ask(1)]], 'the message only');
  off();
  assert.equal(p.listeners.get('window:release-workspace')?.length, 1, 'an unsubscribe leaves the preload listening');
});
