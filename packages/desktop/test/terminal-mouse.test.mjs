// #672: a terminal tab selects natively. The far side's mouse-tracking requests are recorded, not
// obeyed, so xterm's selection keeps the buttons; the wheel is reported to the far side the way
// xterm 5.5 reports it, so tmux's wheel scrollback and an app's own wheel work as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { attachTerminalMouse, TRACKING_MODES } from '../renderer/terminal-mouse.mjs';
import { attachClipboardWrite, attachSelectionCopy, copyTerminalSelection } from '../renderer/terminal-clipboard.mjs';

// The screen: 80×24 cells of 10×20 px, its top-left corner at (10, 20).
const RECT = { left: 10, top: 20, width: 800, height: 480 };
function fakeTerm({ rect = RECT, options = {} } = {}) {
  const csi = new Map(), esc = new Map(), sent = [];
  const term = {
    cols: 80, rows: 24, options, sent, cleared: 0, wheel: null, csi, esc,
    osc: new Map(),
    parser: {
      registerOscHandler(id, fn) { term.osc.set(id, fn); return { dispose: () => term.osc.delete(id) }; },
      registerCsiHandler(id, fn) {
        const key = `${id.prefix || ''}${id.final}`;
        csi.set(key, fn);
        return { dispose: () => { if (csi.get(key) === fn) csi.delete(key); } };
      },
      registerEscHandler(id, fn) {
        esc.set(id.final, fn);
        return { dispose: () => { if (esc.get(id.final) === fn) esc.delete(id.final); } };
      },
    },
    attachCustomWheelEventHandler(fn) { term.wheel = fn; },
    input(data, wasUserInput) { sent.push({ data, wasUserInput }); },
    clearSelection() { term.cleared++; },
    element: { querySelector: sel => (sel === '.xterm-screen' && rect ? { getBoundingClientRect: () => rect } : null) },
  };
  return term;
}
// What the parser would call for `CSI ? <params> h|l`.
const set = (term, ...params) => term.csi.get('?h')(params);
const reset = (term, ...params) => term.csi.get('?l')(params);
// A wheel event over the cell (col, row), 1-based.
function wheel({ deltaY = 0, deltaX = 0, deltaMode = 0, col = 4, row = 3, clientX, clientY, ...mods } = {}) {
  return { deltaY, deltaX, deltaMode, clientX: clientX ?? RECT.left + (col - 1) * 10 + 5, clientY: clientY ?? RECT.top + (row - 1) * 20 + 5,
    shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, prevented: 0, stopped: 0,
    preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; }, ...mods };
}
const tracked = (encoding = [1006]) => {
  const term = fakeTerm(), mouse = attachTerminalMouse(term);
  set(term, 1000); set(term, 1002); for (const mode of encoding) set(term, mode);
  return { term, mouse };
};

test('the tracking modes are X10, VT200, highlight, button-event and any-event', () => {
  assert.deepEqual([...TRACKING_MODES], [9, 1000, 1001, 1002, 1003]);
});

test('tracking-only sequences are consumed and recorded, set and reset, the latest one winning', () => {
  const term = fakeTerm(), mouse = attachTerminalMouse(term);
  assert.deepEqual(mouse.state(), { tracking: 0, wheel: false, encoding: 'default', xtermTracks: false });
  assert.equal(set(term, 1000), true, 'xterm never applies it, so its selection keeps the buttons');
  assert.equal(mouse.state().tracking, 1000);
  assert.equal(set(term, 1002), true);
  assert.equal(mouse.state().tracking, 1002);
  assert.equal(set(term, 1003), true);
  assert.equal(mouse.state().wheel, true);
  assert.equal(reset(term, 1000), true, 'resetting any protocol clears it, as in xterm');
  assert.deepEqual(mouse.state(), { tracking: 0, wheel: false, encoding: 'default', xtermTracks: false });
  assert.equal(set(term, 1000, 1002), true, 'several tracking modes in one sequence');
  assert.equal(mouse.state().tracking, 1002);
  // The parser's shape: `?1000:25h` is [1000, [25]], `?1006:1000h` is [1006, [1000]]. A sub-parameter
  // list belongs to the mode before it and is no mode itself, as in xterm's InputHandler.
  assert.equal(set(term, 1000, [25]), true, 'still tracking-only: consumed');
  assert.equal(mouse.state().tracking, 1000);
  assert.equal(set(term, 1006, [1003]), false, 'only 1006 is a mode here');
  assert.deepEqual([mouse.state().tracking, mouse.state().encoding], [1000, 'sgr']);
});

test('X10 (9) and 1001 are consumed, but neither reports the wheel, as in xterm', () => {
  const term = fakeTerm(), mouse = attachTerminalMouse(term);
  assert.equal(set(term, 9), true);
  assert.deepEqual([mouse.state().tracking, mouse.state().wheel], [9, false]);
  assert.equal(term.wheel(wheel({ deltaY: -100 })), true, 'left to xterm');
  assert.equal(set(term, 1000), true);
  assert.equal(set(term, 1001), true, 'consumed; xterm ignores 1001 and so does the state');
  assert.equal(mouse.state().tracking, 1000);
  assert.equal(reset(term, 1001), true);
  assert.equal(mouse.state().tracking, 1000);
});

test('sequences with no tracking mode go to xterm; 1006 and 1016 are recorded for the wheel encoding', () => {
  const term = fakeTerm(), mouse = attachTerminalMouse(term);
  for (const mode of [1006, 2004, 1049, 25, 1, 1004, 1016]) assert.equal(set(term, mode), false, `?${mode}h`);
  assert.equal(mouse.state().encoding, 'sgr-pixels');
  assert.equal(set(term, 1006), false);
  assert.equal(mouse.state().encoding, 'sgr');
  assert.equal(reset(term, 2004), false);
  assert.equal(mouse.state().encoding, 'sgr');
  assert.equal(reset(term, 1006), false);
  assert.equal(mouse.state().encoding, 'default');
  assert.equal(mouse.state().tracking, 0);
});

test('fallback: a mixed sequence goes to xterm, and so do tracking-only ones until xterm stops tracking', () => {
  const term = fakeTerm(), mouse = attachTerminalMouse(term);
  assert.equal(set(term, 1000, 1006), false, 'xterm applies all of it, tracking included: today\'s behaviour');
  assert.deepEqual(mouse.state(), { tracking: 1000, wheel: true, encoding: 'sgr', xtermTracks: true });
  assert.equal(set(term, 1002), false, 'xterm tracks, so its state follows this one too');
  assert.equal(mouse.state().tracking, 1002);
  assert.equal(reset(term, 1002), false, 'the reset reaches xterm, which then stops tracking: nothing sticks');
  assert.deepEqual(mouse.state(), { tracking: 0, wheel: false, encoding: 'sgr', xtermTracks: false });
  assert.equal(set(term, 1000), true, 'consumed again');
  assert.equal(mouse.state().xtermTracks, false);
  assert.equal(reset(term, 1000, 1006), false, 'a mixed reset goes to xterm too');
  assert.deepEqual(mouse.state(), { tracking: 0, wheel: false, encoding: 'default', xtermTracks: false });
});

test('fallback: a mixed sequence that tracks nothing in xterm (1001 is ignored) does not hand later requests to xterm', () => {
  const term = fakeTerm(), mouse = attachTerminalMouse(term);
  assert.equal(set(term, 1000), true);
  assert.equal(set(term, 1001, 1006), false, 'mixed: left to xterm, which ignores 1001 and sets SGR');
  assert.deepEqual(mouse.state(), { tracking: 1000, wheel: true, encoding: 'sgr', xtermTracks: false });
  assert.equal(set(term, 1002), true, 'xterm tracks nothing, so this is consumed: the buttons stay with the selection');
  assert.equal(mouse.state().xtermTracks, false);
});

test('fallback: while xterm tracks, the wheel is still reported once, by this handler (xterm\'s own report is suppressed)', () => {
  const term = fakeTerm();
  attachTerminalMouse(term);
  set(term, 1000, 1006);
  assert.equal(term.wheel(wheel({ deltaY: -100 })), false);
  assert.deepEqual(term.sent, [{ data: '\x1b[<64;4;3M', wasUserInput: false }]);
});

test('RIS resets the recorded state and still reaches xterm', () => {
  const { term, mouse } = tracked();
  assert.equal(term.esc.get('c')(), false);
  assert.deepEqual(mouse.state(), { tracking: 0, wheel: false, encoding: 'default', xtermTracks: false });
});

test('a reopened tab is a new Terminal with fresh state; a re-attach re-sends the modes', () => {
  tracked();
  const term = fakeTerm(), mouse = attachTerminalMouse(term);
  assert.equal(mouse.state().tracking, 0);
  assert.equal(term.wheel(wheel({ deltaY: -100 })), true);
  set(term, 1000); set(term, 1002); set(term, 1006);
  assert.deepEqual([mouse.state().tracking, mouse.state().encoding], [1002, 'sgr']);
});

test('the wheel with no tracking is xterm\'s: nothing written, nothing cancelled', () => {
  const term = fakeTerm();
  attachTerminalMouse(term);
  set(term, 1006);
  const ev = wheel({ deltaY: -100 });
  assert.equal(term.wheel(ev), true);
  assert.deepEqual(term.sent, []);
  assert.equal(ev.prevented, 0);
  assert.equal(term.cleared, 0);
});

test('wheel up / down with tracking on writes one SGR report at the pointer cell, clears the selection, cancels the event', () => {
  const { term } = tracked();
  const up = wheel({ deltaY: -100, col: 4, row: 3 });
  assert.equal(term.wheel(up), false);
  const down = wheel({ deltaY: 100, col: 80, row: 24 });
  assert.equal(term.wheel(down), false);
  assert.deepEqual(term.sent, [
    { data: '\x1b[<64;4;3M', wasUserInput: false },
    { data: '\x1b[<65;80;24M', wasUserInput: false },
  ]);
  assert.equal(term.cleared, 2, 'the content scrolls under the selection');
  assert.deepEqual([up.prevented, up.stopped, down.prevented, down.stopped], [1, 1, 1, 1]);
});

test('one report per event however far it scrolls, as xterm reports', () => {
  const { term } = tracked();
  term.wheel(wheel({ deltaY: -1000 }));
  term.wheel(wheel({ deltaY: 5, deltaMode: 1 }));
  term.wheel(wheel({ deltaY: -1, deltaMode: 2 }));
  assert.deepEqual(term.sent.map(s => s.data), ['\x1b[<64;4;3M', '\x1b[<65;4;3M', '\x1b[<64;4;3M']);
});

test('the pointer cell is clamped to the screen, 1-based', () => {
  const { term } = tracked();
  term.wheel(wheel({ deltaY: -100, clientX: 0, clientY: 0 }));
  term.wheel(wheel({ deltaY: -100, clientX: 5000, clientY: 5000 }));
  term.wheel(wheel({ deltaY: -100, clientX: RECT.left + 9.99, clientY: RECT.top + 20 }));
  assert.deepEqual(term.sent.map(s => s.data), ['\x1b[<64;1;1M', '\x1b[<64;80;24M', '\x1b[<64;1;2M']);
});

test('modifier bits are xterm\'s: Ctrl 16, Alt 8 (Alt also scrolls fast); Shift scrolls nothing', () => {
  const { term } = tracked();
  term.wheel(wheel({ deltaY: -100, ctrlKey: true }));
  term.wheel(wheel({ deltaY: 100, altKey: true }));
  term.wheel(wheel({ deltaY: 4, altKey: true, ctrlKey: true }));
  const shifted = wheel({ deltaY: -100, shiftKey: true });
  assert.equal(term.wheel(shifted), false);
  assert.equal(shifted.prevented, 1, 'xterm cancelled every wheel event while the far side tracked');
  assert.deepEqual(term.sent.map(s => s.data), ['\x1b[<80;4;3M', '\x1b[<73;4;3M', '\x1b[<89;4;3M'],
    '4 px with Alt is 20 px, one row: reported with both bits');
});

test('X10 encoding without 1006: ESC [ M and three bytes of value + 32; one that needs a byte above 127 is not sent', () => {
  const { term } = tracked([]);
  term.wheel(wheel({ deltaY: -100, col: 4, row: 3 }));
  term.wheel(wheel({ deltaY: 100, col: 80, row: 24 }));
  assert.deepEqual(term.sent.map(s => s.data), [`\x1b[M${String.fromCharCode(96, 36, 35)}`, `\x1b[M${String.fromCharCode(97, 112, 56)}`]);
  const wide = fakeTerm({ rect: { ...RECT, width: 1200 } });
  wide.cols = 120;
  attachTerminalMouse(wide); set(wide, 1000);
  wide.wheel(wheel({ deltaY: -100, clientX: RECT.left + 99 * 10 + 5 }));
  assert.deepEqual(wide.sent, [], 'column 100 would be byte 132, UTF-8 encoded on its way to the pty');
  assert.equal(wide.cleared, 1);
});

test('fractional geometry: the cell comes from the unrounded position, as in xterm\'s MouseService', () => {
  // A scaled display or a centred grid: the screen starts at x = 0.5 and cells are 7.5 px wide.
  const term = fakeTerm({ rect: { left: 0.5, top: 0, width: 600, height: 480 } });
  attachTerminalMouse(term); set(term, 1000); set(term, 1006);
  term.wheel(wheel({ deltaY: -100, clientX: 8, clientY: 20 }));
  assert.deepEqual(term.sent.map(s => s.data), ['\x1b[<64;2;2M'], 'floor((8 - 0.5) / 7.5) + 1 = 2, not column 1');
  const pixels = fakeTerm({ rect: { left: 0.5, top: 0, width: 600, height: 480 } });
  attachTerminalMouse(pixels); set(pixels, 1000); set(pixels, 1016);
  pixels.wheel(wheel({ deltaY: -100, clientX: 8, clientY: 20.75 }));
  assert.deepEqual(pixels.sent.map(s => s.data), ['\x1b[<64;7;20M'], 'SGR pixels reports whole pixels');
});

test('SGR pixels (1016) reports the pointer\'s pixel position', () => {
  const { term } = tracked([1016]);
  term.wheel(wheel({ deltaY: -100, clientX: RECT.left + 35.7, clientY: RECT.top + 45.2 }));
  assert.deepEqual(term.sent.map(s => s.data), ['\x1b[<64;35;45M']);
});

test('pixel deltas accumulate per row height exactly as xterm\'s Viewport.getLinesScrolled does', () => {
  const { term } = tracked();
  // Row height 20 px: 7 px is 0.35 of a row. xterm: partial += 0.35; amount = floor(|partial|); partial %= 1.
  assert.equal(term.wheel(wheel({ deltaY: 7 })), false);
  assert.equal(term.wheel(wheel({ deltaY: 7 })), false);
  assert.deepEqual(term.sent, [], '0.35, then 0.70 of a row: nothing yet');
  term.wheel(wheel({ deltaY: 7 }));
  assert.deepEqual(term.sent.map(s => s.data), ['\x1b[<65;4;3M'], '1.05 rows: one report, 0.05 carried');
  term.wheel(wheel({ deltaY: -2 }));
  assert.equal(term.sent.length, 1, '0.05 - 0.1 = -0.05: nothing');
  term.wheel(wheel({ deltaY: -19 }));
  assert.deepEqual(term.sent.map(s => s.data).slice(1), ['\x1b[<64;4;3M'], '-0.05 - 0.95 = -1: one report up');
  term.wheel(wheel({ deltaY: 7, deltaMode: 1 }));
  term.wheel(wheel({ deltaY: 0.2, deltaMode: 1 }));
  assert.equal(term.sent.length, 4, 'line deltas are taken as they are, fractions included (xterm: amount 0.2 is not 0)');
  assert.equal(term.cleared, 4, 'cleared on each report only');
});

test('scrollSensitivity and fastScrollSensitivity scale pixel deltas as in xterm', () => {
  const term = fakeTerm({ options: { scrollSensitivity: 2, fastScrollModifier: 'alt', fastScrollSensitivity: 5 } });
  attachTerminalMouse(term); set(term, 1000); set(term, 1006);
  term.wheel(wheel({ deltaY: 10 }));
  assert.equal(term.sent.length, 1, '10 px × 2 = one 20 px row');
  term.wheel(wheel({ deltaY: 2, altKey: true }));
  assert.equal(term.sent.length, 2, '2 px × 2 × 5 = one row, Alt bit set');
  assert.equal(term.sent[1].data, '\x1b[<73;4;3M');
});

test('a horizontal-only wheel event sends nothing', () => {
  const { term } = tracked();
  const ev = wheel({ deltaX: 120 });
  assert.equal(term.wheel(ev), false);
  assert.deepEqual(term.sent, []);
  assert.equal(term.cleared, 0);
});

test('a terminal with no measurable screen sends nothing', () => {
  for (const rect of [null, { ...RECT, width: 0 }, { ...RECT, height: 0 }]) {
    const term = fakeTerm({ rect });
    attachTerminalMouse(term); set(term, 1000);
    assert.equal(term.wheel(wheel({ deltaY: -100 })), false);
    assert.deepEqual(term.sent, []);
  }
});

test('dispose removes the CSI and ESC handlers and hands the wheel back to xterm', () => {
  const { term, mouse } = tracked();
  mouse.dispose();
  assert.deepEqual([...term.csi.keys(), ...term.esc.keys()], []);
  assert.equal(term.wheel(wheel({ deltaY: -100 })), true);
  assert.deepEqual(term.sent, []);
  mouse.dispose();
});

// The real parser (@xterm/xterm 5.5, headless: no open()): what xterm itself ends up tracking.
const require = createRequire(import.meta.url);
function realTerm(t) {
  const { Terminal } = require('@xterm/xterm');
  const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  t.after(() => term.dispose());
  const mouse = attachTerminalMouse(term);
  const write = data => new Promise(resolve => term.write(data, resolve));
  return { term, mouse, write };
}

test('real xterm: tmux\'s separate requests never turn xterm\'s tracking on; the far side\'s state is recorded', async t => {
  const { term, mouse, write } = realTerm(t);
  for (const sequence of ['\x1b[?1006h', '\x1b[?1000h', '\x1b[?1002h', '\x1b[?2004h', '\x1b[?1049h']) await write(sequence);
  assert.equal(term.modes.mouseTrackingMode, 'none', 'xterm\'s selection keeps the buttons');
  assert.equal(term.modes.bracketedPasteMode, true, 'everything else reaches xterm');
  assert.deepEqual(mouse.state(), { tracking: 1002, wheel: true, encoding: 'sgr', xtermTracks: false });
  await write('\x1b[?1002l');
  assert.equal(mouse.state().tracking, 0);
  await write('\x1b[?1000:25h');
  assert.equal(term.modes.mouseTrackingMode, 'none', 'a sub-parameter does not make it mixed');
  assert.equal(mouse.state().tracking, 1000);
});

test('real xterm: 1001 in a mixed sequence leaves xterm untracked, so the next request is still consumed', async t => {
  const { term, mouse, write } = realTerm(t);
  await write('\x1b[?1000h');
  await write('\x1b[?1001;1006h');
  assert.equal(term.modes.mouseTrackingMode, 'none');
  await write('\x1b[?1002h');
  assert.equal(term.modes.mouseTrackingMode, 'none', 'native selection is not disabled');
  assert.deepEqual(mouse.state(), { tracking: 1002, wheel: true, encoding: 'sgr', xtermTracks: false });
});

test('real xterm: a mixed sequence is xterm\'s (today\'s behaviour) and its tracking follows the next sequences to none', async t => {
  const { term, mouse, write } = realTerm(t);
  await write('\x1b[?1000;1006h');
  assert.equal(term.modes.mouseTrackingMode, 'vt200', 'the documented fallback');
  await write('\x1b[?1002h');
  assert.equal(term.modes.mouseTrackingMode, 'drag', 'followed while xterm tracks');
  await write('\x1b[?1002l');
  assert.equal(term.modes.mouseTrackingMode, 'none', 'the reset reached xterm: nothing sticks');
  await write('\x1b[?1003h');
  assert.equal(term.modes.mouseTrackingMode, 'none', 'consumed again');
  assert.deepEqual(mouse.state(), { tracking: 1003, wheel: true, encoding: 'sgr', xtermTracks: false });
});

test('real xterm: RIS resets xterm and the recorded state alike', async t => {
  const { term, mouse, write } = realTerm(t);
  await write('\x1b[?1000;2004h');
  await write('\x1bc');
  assert.equal(term.modes.mouseTrackingMode, 'none');
  assert.deepEqual(mouse.state(), { tracking: 0, wheel: false, encoding: 'default', xtermTracks: false });
  await write('\x1b[?1000h');
  assert.equal(term.modes.mouseTrackingMode, 'none', 'consumed after the reset');
});

// The shipped wiring (shell.mjs), executed: each terminal tab installs the mouse and the clipboard once,
// its onClose tears both down, and terminal.copySelection copies the terminal the chord was pressed in.
const shellSource = readFileSync(new URL('../renderer/shell.mjs', import.meta.url), 'utf8');
const shipped = name => {
  const match = shellSource.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, `shipped ${name}`);
  return match[0];
};
function shellWiring(t) {
  const dom = new JSDOM('<div id="pane"><div class="term-wrap"><textarea></textarea></div></div><input id="outside">');
  t.after(() => dom.window.close());
  const doc = dom.window.document, written = [], notices = [];
  const c = {
    attachTerminalMouse, attachClipboardWrite, attachSelectionCopy, copyTerminalSelection,
    terminalSelections: new Map(), writeClipboard: text => { written.push(text); },
    clipboardRefused: error => notices.push(error.message),
    activeTab: 1, tabs: new Map([[1, { paneEl: doc.getElementById('pane') }]]),
  };
  const s = runInNewContext(`${shipped('wireTerminalSelection')}\n${shipped('copyTerminalSelectionFrom')}\n({ wireTerminalSelection, copyTerminalSelectionFrom })`, c);
  return { ...s, c, doc, written, notices };
}

test('shell: a terminal tab is wired once and its teardown removes everything it installed', t => {
  const { wireTerminalSelection, c, doc } = shellWiring(t);
  const term = fakeTerm(), wrap = doc.querySelector('.term-wrap');
  const unwire = wireTerminalSelection(term, wrap);
  assert.deepEqual([...term.csi.keys()].sort(), ['?h', '?l']);
  assert.deepEqual([...term.esc.keys(), ...term.osc.keys()], ['c', 52]);
  assert.equal(c.terminalSelections.get(wrap), term);
  assert.equal(set(term, 1000), true);
  // ⌘C / right-click › Copy inside the wrap is taken by the trimming copy hook.
  Object.assign(term, { hasSelection: () => true, getSelection: () => 'copied   ' });
  const copy = () => { const data = []; const event = new doc.defaultView.Event('copy', { bubbles: true, cancelable: true });
    event.clipboardData = { setData: (type, value) => data.push(value) }; wrap.querySelector('textarea').dispatchEvent(event); return data; };
  assert.deepEqual(copy(), ['copied']);
  unwire();
  assert.deepEqual(copy(), [], 'the copy hook is gone');
  assert.deepEqual([...term.csi.keys(), ...term.esc.keys(), ...term.osc.keys()], []);
  assert.equal(c.terminalSelections.has(wrap), false);
  assert.equal(term.wheel(wheel({ deltaY: -100 })), true, 'the wheel is xterm\'s again');
  // The tab's onClose (and the lost-race path) run the teardown with the theme hooks.
  assert.match(shellSource, /const unwireSelection = wireTerminalSelection\(term, wrap\);\n  const unwire = \(\) => \{ offTheme\(\); offTypography\(\); unwireSelection\(\); \};/);
  assert.match(shellSource, /onClose: \(\) => unwire\(\),/);
  assert.match(shellSource, /if \(!made\) \{ unwire\(\); term\.dispose\(\); return; \}/);
});

test('shell: terminal.copySelection copies the terminal it was pressed in, never from outside one', async t => {
  const { wireTerminalSelection, copyTerminalSelectionFrom, doc, written, notices } = shellWiring(t);
  const wrap = doc.querySelector('.term-wrap');
  const term = Object.assign(fakeTerm(), { hasSelection: () => true, getSelection: () => 'selected text' });
  wireTerminalSelection(term, wrap);
  copyTerminalSelectionFrom({ target: doc.getElementById('outside') });
  assert.deepEqual(written, [], 'a chord outside a terminal copies nothing');
  copyTerminalSelectionFrom({ target: wrap.querySelector('textarea') });
  copyTerminalSelectionFrom(undefined);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(written, ['selected text', 'selected text'], 'the pressed terminal; with no key event, the active tab\'s');
  assert.deepEqual(term.sent, [], 'nothing reaches the pty');
  assert.deepEqual(notices, []);
});

test('shell: a refused clipboard write is said, for the copy action and for OSC 52', async t => {
  const { wireTerminalSelection, copyTerminalSelectionFrom, c, doc, notices } = shellWiring(t);
  c.writeClipboard = () => Promise.reject(new Error('Document is not focused.'));
  const wrap = doc.querySelector('.term-wrap');
  const term = Object.assign(fakeTerm(), { hasSelection: () => true, getSelection: () => 'x' });
  wireTerminalSelection(term, wrap);
  copyTerminalSelectionFrom({ target: wrap });
  term.osc.get(52)(`;${Buffer.from('y').toString('base64')}`);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(notices, ['Document is not focused.', 'Document is not focused.']);
  assert.match(shellSource, /const clipboardRefused = error => notifications\.notify\("Couldn't copy to the clipboard\.", \{ detail: /);
});
