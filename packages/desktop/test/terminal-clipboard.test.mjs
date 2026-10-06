// #520: OSC 52 from the terminal (tmux's copy of a drag selection) reaches the clipboard, write-only:
// a clipboard query is never answered, nothing oversized or malformed is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { osc52Text, attachClipboardWrite, copyTerminalSelection, attachSelectionCopy, trimLineEnds, OSC52_MAX_BYTES } from '../renderer/terminal-clipboard.mjs';

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

test('attachClipboardWrite: a refused write is reported once, so the failure is never silent (#672)', async () => {
  const term = fakeTerm(), errors = [];
  attachClipboardWrite(term, () => Promise.reject(new Error('not focused')), error => errors.push(error.message));
  term.handlers.get(52)(`;${b64('x')}`);
  attachClipboardWrite(term, () => { throw new Error('no clipboard'); }, error => errors.push(error.message));
  term.handlers.get(52)(`;${b64('y')}`);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(errors, ['not focused', 'no clipboard']);
});

// #672: the terminal.copySelection action (Ctrl+Shift+C on Linux/Windows) copies xterm's own selection.
const selecting = text => ({ hasSelection: () => text !== '', getSelection: () => text, input() { throw new Error('nothing reaches the pty'); } });

test('copyTerminalSelection: exactly the selected text is written', async () => {
  const written = [], errors = [];
  assert.equal(copyTerminalSelection(selecting('alpha\n  bravo ✓'), text => { written.push(text); }, e => errors.push(e)), true);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(written, ['alpha\n  bravo ✓']);
  assert.deepEqual(errors, []);
});

test('copyTerminalSelection: with nothing selected nothing is written and nothing is sent', () => {
  const written = [];
  assert.equal(copyTerminalSelection(selecting(''), text => written.push(text)), false);
  assert.equal(copyTerminalSelection({ hasSelection: () => true, getSelection: () => '' }, text => written.push(text)), false);
  assert.equal(copyTerminalSelection(null, text => written.push(text)), false);
  assert.deepEqual(written, []);
});

test('copyTerminalSelection: a refused write reaches onError, never an unhandled rejection', async () => {
  const errors = [];
  copyTerminalSelection(selecting('x'), () => Promise.reject(new Error('Document is not focused.')), e => errors.push(e.message));
  copyTerminalSelection(selecting('y'), () => { throw new Error('denied'); }, e => errors.push(e.message));
  copyTerminalSelection(selecting('z'), () => Promise.reject(new Error('quiet')), () => { throw new Error('a reporter that throws'); });
  await new Promise(r => setImmediate(r));
  assert.deepEqual(errors, ['Document is not focused.', 'denied']);
});

// #672: every copy of a selection trims the spaces and tabs that end its lines, as Ghostty, kitty and VTE
// do. tmux redraws copy mode with written spaces, which xterm keeps in a selection.
test('trimLineEnds: trailing spaces and tabs go; indentation, inner whitespace and line breaks stay', () => {
  assert.equal(trimLineEnds('alpha   \nbravo  '), 'alpha\nbravo', 'trailing spaces, last line included');
  assert.equal(trimLineEnds('alpha\t\t\nbravo \t'), 'alpha\nbravo', 'trailing tabs');
  assert.equal(trimLineEnds('alpha\n   \n\t\nbravo'), 'alpha\n\n\nbravo', 'a whitespace-only line becomes empty and stays a line');
  assert.equal(trimLineEnds('alpha  \r\nbravo \r\n'), 'alpha\r\nbravo\r\n', 'CRLF kept as CRLF');
  assert.equal(trimLineEnds('    indented  code\n\tif (x)   {  '), '    indented  code\n\tif (x)   {', 'leading and inner whitespace kept');
  assert.equal(trimLineEnds('a wrapped line   whose rows xterm joins  '), 'a wrapped line   whose rows xterm joins', 'no break added inside a wrapped line');
  assert.equal(trimLineEnds('no change'), 'no change');
  assert.equal(trimLineEnds(''), '');
});

test('copyTerminalSelection: the copy-mode padding is trimmed (a 124-column pane in tmux copy mode)', async () => {
  const written = [];
  const padded = ['claudelike line 084 alpha beta gamma', 'claudelike line 085 alpha beta gamma'].map(line => line.padEnd(124)).join('\n');
  copyTerminalSelection(selecting(padded), text => { written.push(text); });
  await new Promise(r => setImmediate(r));
  assert.deepEqual(written, ['claudelike line 084 alpha beta gamma\nclaudelike line 085 alpha beta gamma']);
});

// ⌘C / Edit › Copy and right-click › Copy reach the xterm textarea's copy event; xterm's own listener on
// its element (bubble phase) would set the untrimmed text after ours, so ours must stop it.
function copyDom(t, selection) {
  const dom = new JSDOM('<div class="term-wrap"><div class="xterm"><textarea class="xterm-helper-textarea"></textarea></div></div>');
  t.after(() => dom.window.close());
  const doc = dom.window.document, wrap = doc.querySelector('.term-wrap'), element = doc.querySelector('.xterm');
  const term = { hasSelection: () => selection !== '', getSelection: () => selection };
  const xtermRan = [];
  // xterm 5.5: addDisposableDomListener(this.element, 'copy', ev => copyHandler(ev, selectionService)), bubble phase.
  element.addEventListener('copy', event => { xtermRan.push(true); event.clipboardData.setData('text/plain', term.getSelection()); event.preventDefault(); });
  const copy = () => {
    const data = new Map();
    const event = new dom.window.Event('copy', { bubbles: true, cancelable: true });
    event.clipboardData = { setData: (type, value) => data.set(type, value) };
    doc.querySelector('textarea').dispatchEvent(event);
    return { data: data.get('text/plain'), prevented: event.defaultPrevented };
  };
  return { wrap, term, xtermRan, copy };
}

test('attachSelectionCopy: with a selection, the trimmed text is set and xterm\'s untrimmed handler never runs', t => {
  const d = copyDom(t, 'line one   \n  line two\t\r\n');
  const off = attachSelectionCopy(d.term, d.wrap);
  assert.deepEqual(d.copy(), { data: 'line one\n  line two\r\n', prevented: true });
  assert.deepEqual(d.xtermRan, [], 'stopped before xterm\'s listener');
  off.dispose();
  assert.deepEqual(d.copy(), { data: 'line one   \n  line two\t\r\n', prevented: true }, 'disposed: xterm\'s own copy again');
  assert.equal(d.xtermRan.length, 1);
});

test('attachSelectionCopy: with no selection the event is left alone', t => {
  const d = copyDom(t, '');
  attachSelectionCopy(d.term, d.wrap);
  const result = d.copy();
  assert.equal(d.xtermRan.length, 1, 'xterm\'s listener still runs');
  assert.equal(result.data, '', 'only xterm touched the data');
});
