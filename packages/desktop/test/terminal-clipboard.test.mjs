// #520: OSC 52 from the terminal (tmux's copy of a drag selection) reaches the clipboard, write-only:
// a clipboard query is never answered, nothing oversized or malformed is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { osc52Text, attachClipboardWrite, OSC52_MAX_BYTES } from '../renderer/terminal-clipboard.mjs';

const b64 = text => Buffer.from(text, 'utf8').toString('base64');

test('osc52Text: tmux\'s copy (empty selection), and c/p/s/0-7 selections, decoded as UTF-8', () => {
  assert.equal(osc52Text(`;${b64('line one')}`), 'line one');
  assert.equal(osc52Text(`c;${b64('alpha\nbravo — ✓')}`), 'alpha\nbravo — ✓');
  for (const sel of ['p', 's', '0', 'cp']) assert.equal(osc52Text(`${sel};${b64('x')}`), 'x', sel);
  assert.equal(osc52Text(`;${b64('\ufeffhello')}`), '\ufeffhello', 'a leading U+FEFF is the copied text, not a BOM to drop');
  assert.equal(osc52Text(`;${b64('\ufeff')}`), '\ufeff');
});

test('osc52Text: a query, a clear, a malformed or an oversized request writes nothing', () => {
  assert.equal(osc52Text('c;?'), null, 'a query is never answered');
  assert.equal(osc52Text(';?'), null);
  assert.equal(osc52Text('c;'), null, 'a clear is not done');
  assert.equal(osc52Text('c;not base64!'), null);
  assert.equal(osc52Text('no-separator'), null);
  assert.equal(osc52Text('x;' + b64('y')), null, 'an unknown selection');
  assert.equal(osc52Text(';' + b64('a'.repeat(OSC52_MAX_BYTES + 1))), null);
  assert.equal(osc52Text(';' + Buffer.from([0xff, 0xfe]).toString('base64')), null, 'not UTF-8');
});

function fakeTerm() {
  const handlers = new Map(), echoed = [];
  return { handlers, echoed, input: data => echoed.push(data), write: data => echoed.push(data),
    parser: { registerOscHandler(id, fn) { handlers.set(id, fn); return { dispose: () => handlers.delete(id) }; } } };
}

test('attachClipboardWrite: OSC 52 writes the text and is handled; a query writes nothing and answers nothing; dispose unregisters', () => {
  const term = fakeTerm(), written = [];
  const off = attachClipboardWrite(term, text => { written.push(text); });
  const handler = term.handlers.get(52);
  assert.equal(handler(`;${b64('alpha\nbravo')}`), true);
  assert.deepEqual(written, ['alpha\nbravo']);
  assert.equal(handler('c;?'), true, 'consumed, never passed on');
  assert.deepEqual(written, ['alpha\nbravo']); assert.deepEqual(term.echoed, [], 'nothing is sent back to the remote side');
  off.dispose(); assert.equal(term.handlers.has(52), false);
});

test('attachClipboardWrite: a failed clipboard write is contained', async () => {
  const term = fakeTerm();
  attachClipboardWrite(term, () => Promise.reject(new Error('not focused')));
  assert.equal(term.handlers.get(52)(`;${b64('x')}`), true);
  await new Promise(r => setImmediate(r)); // no unhandled rejection
});
