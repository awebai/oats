// Main's window-activity reduction and its edge-triggered POST. Fake
// BrowserWindows only; a destroyed window throws from every accessor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityNotifier, windowActivity } from '../window-activity.mjs';

const win = ({ visible = true, minimized = false, focused = true } = {}) => ({
  isVisible: () => visible, isMinimized: () => minimized, isFocused: () => focused,
});
const destroyed = () => {
  const boom = () => { throw new TypeError('Object has been destroyed'); };
  return { isVisible: boom, isMinimized: boom, isFocused: boom };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('windowActivity: any visible, un-minimized, focused window is activity', () => {
  assert.equal(windowActivity([]), false);
  assert.equal(windowActivity(undefined), false);
  assert.equal(windowActivity([win()]), true);
  assert.equal(windowActivity([win({ focused: false })]), false);
  assert.equal(windowActivity([win({ visible: false })]), false);
  assert.equal(windowActivity([win({ minimized: true })]), false);
  assert.equal(windowActivity([win({ visible: false, focused: true }), win({ minimized: true, focused: true })]), false);
  assert.equal(windowActivity([win({ focused: false }), win()]), true);
});

test('windowActivity: a destroyed window is inactive, not an exception', () => {
  assert.equal(windowActivity([destroyed()]), false);
  assert.equal(windowActivity([destroyed(), win()]), true);
  assert.equal(windowActivity([win(), destroyed()]), true);
});

test('notifier: one POST per transition, none for identical states', async () => {
  const posts = [];
  const n = createActivityNotifier({ post: async body => { posts.push(body); } });
  assert.equal(n.current(), true, 'a freshly created window is assumed focused');
  assert.equal(n.update([win()]), true);
  assert.equal(n.update([win()]), true);
  assert.deepEqual(posts, [], 'initial true: the first focus posts nothing');
  assert.equal(n.update([win({ focused: false })]), false);
  assert.deepEqual(posts, [{ focused: false }], 'the first blur posts once');
  assert.equal(n.update([win({ focused: false })]), false);
  assert.equal(n.update([win({ visible: false })]), false);
  assert.equal(n.update([win({ minimized: true })]), false);
  assert.deepEqual(posts, [{ focused: false }], 'blur→hide→minimize is one inactive state');
  assert.equal(n.current(), false);
  assert.equal(n.update([win()]), true);
  assert.deepEqual(posts, [{ focused: false }, { focused: true }]);
  assert.equal(n.update([]), false);
  assert.equal(n.update([destroyed()]), false);
  assert.equal(n.update([win()]), true);
  assert.deepEqual(posts, [{ focused: false }, { focused: true }, { focused: false }, { focused: true }]);
  await tick();
});

test('notifier: initial false makes the first focus the first POST', () => {
  const posts = [];
  const n = createActivityNotifier({ post: body => { posts.push(body); }, initial: false });
  assert.equal(n.current(), false);
  n.update([win({ focused: false })]);
  assert.deepEqual(posts, []);
  n.update([win()]);
  assert.deepEqual(posts, [{ focused: true }]);
});

test('notifier: a throwing or rejecting post is swallowed and the value is still recorded', async () => {
  let calls = 0;
  const throwing = createActivityNotifier({ post: () => { calls++; throw new Error('server down'); } });
  assert.equal(throwing.update([win({ focused: false })]), false);
  assert.equal(throwing.current(), false, 'recorded despite the throw');
  assert.equal(throwing.update([win({ focused: false })]), false);
  assert.equal(calls, 1, 'no retry storm: the state did not flip again');
  const rejecting = createActivityNotifier({ post: () => Promise.reject(new Error('ECONNREFUSED')) });
  let unhandled = null;
  const onUnhandled = e => { unhandled = e; };
  process.on('unhandledRejection', onUnhandled);
  try {
    assert.equal(rejecting.update([win({ focused: false })]), false);
    assert.equal(rejecting.current(), false);
    await tick(); await tick();
    assert.equal(unhandled, null, 'a rejected post must not surface as an unhandled rejection');
  } finally { process.off('unhandledRejection', onUnhandled); }
});
