// The terminal as a native terminal shows it (the operator's review, 2026-10-02):
// fitTerminal centres the grid in its pane, across and down, with no width kept
// for a scrollbar tmux never uses; createGlyphRenderer puts xterm on its WebGL
// renderer, so box drawing is drawn, not taken from the font, and falls back to
// the DOM renderer when WebGL is missing or lost. jsdom has no layout: the pane's
// size is its declared style, and the xterm is a double with xterm's own shape.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { fitTerminal, createGlyphRenderer } from "../renderer/terminal-tab.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** A pane of `width`×`height` with the shipped 12px side gutters, holding an
 * xterm double whose renderer measured `cell` (null: not measured yet). */
function pane(t, { width, height, cell = { width: 8, height: 17 }, ratio = 1, cols = 80, rows = 24 }) {
  const dom = new JSDOM(`<!doctype html><div class="term-wrap" style="width:${width}px;height:${height}px">
    <div class="xterm" style="padding:0 12px"><div class="xterm-screen"></div></div></div>`);
  t.after(() => dom.window.close());
  Object.defineProperty(dom.window, "devicePixelRatio", { value: ratio });
  const element = dom.window.document.querySelector(".xterm");
  const calls = [];
  const term = {
    cols, rows, element,
    _core: { _renderService: { dimensions: { css: { cell } }, clear: () => calls.push("clear") } },
    resize(c, r) { calls.push(`resize ${c}x${r}`); this.cols = c; this.rows = r; },
  };
  const fit = { fit: () => calls.push("fit") };
  return { term, fit, calls, screen: element.querySelector(".xterm-screen") };
}

test("fitTerminal fills the padded pane with whole cells and splits the rest evenly, across and down", t => {
  const p = pane(t, { width: 796, height: 600 });
  fitTerminal(p.term, p.fit);
  // 772 across: 96 cells of 8 (768), 4 left over; 600 down: 35 rows of 17 (595), 5 left over.
  assert.deepEqual(p.calls, ["clear", "resize 96x35"], "the renderer is cleared, then the grid resized; FitAddon is not used");
  assert.equal(p.screen.style.marginLeft, "2px", "half the rest on each side");
  assert.equal(p.screen.style.marginTop, "2px", "2.5px floors to the whole device pixel at 1×");
  p.calls.length = 0;
  fitTerminal(p.term, p.fit);
  assert.deepEqual(p.calls, [], "an unchanged grid is not resized again");
});

test("fitTerminal keeps no width for xterm's scrollbar: the gutters match", t => {
  // FitAddon would keep 15px for the scrollbar: 742 / 8 = 92 columns, the right gutter 21px wider.
  const p = pane(t, { width: 781, height: 340 });
  fitTerminal(p.term, p.fit);
  assert.equal(p.term.cols, 94, "757px of grid width: 94 cells");
  assert.equal(p.screen.style.marginLeft, "2px", "the 5px rest, halved, in whole device pixels");
  assert.equal(p.term.rows, 20);
  assert.equal(p.screen.style.marginTop, "0px");
  assert.match(read("renderer/shell.css"), /\.term-wrap \.xterm-viewport \{ scrollbar-width: none; \}\n\.term-wrap \.xterm-viewport::-webkit-scrollbar \{ display: none; \}/,
    "the scrollbar is hidden on terminal tabs, so the grid can take its width");
});

test("fitTerminal rounds the centring margin to device pixels, so glyphs stay sharp", t => {
  const p = pane(t, { width: 397.5, height: 600, ratio: 2 }); // a split half: 373.5px across
  fitTerminal(p.term, p.fit);
  assert.equal(p.term.cols, 46); // 368px of grid, 5.5px left over
  assert.equal(p.screen.style.marginLeft, "2.5px", "2.75px floors to the 0.5px device grid at 2×");
  assert.equal(p.screen.style.marginTop, "2.5px");
});

test("fitTerminal leaves an unmeasured or hidden pane to FitAddon", t => {
  const unmeasured = pane(t, { width: 796, height: 600, cell: { width: 0, height: 0 } });
  fitTerminal(unmeasured.term, unmeasured.fit);
  assert.deepEqual(unmeasured.calls, ["fit"]);
  const hidden = pane(t, { width: 0, height: 0 });
  fitTerminal(hidden.term, hidden.fit);
  assert.deepEqual(hidden.calls, ["fit"], "a hidden pane has no size: FitAddon's own no-op");
  const calls = [];
  fitTerminal({}, { fit: () => calls.push("fit") });
  assert.deepEqual(calls, ["fit"], "a terminal not opened yet");
});

/** A WebglAddon double: records its life, and can fail where WebGL would. */
function webgl({ failConstruct = false } = {}) {
  const made = [];
  class Addon {
    constructor() { if (failConstruct) throw new Error("WebGL2 unavailable"); this.disposed = 0; made.push(this); }
    onContextLoss(fn) { this.lose = fn; return { dispose() {} }; }
    dispose() { this.disposed++; }
  }
  return { Addon, made };
}
function xterm({ opened = true, failLoad = false } = {}) {
  const loaded = [];
  return { loaded, element: opened ? {} : undefined, loadAddon(addon) { if (failLoad) throw new Error("context creation failed"); loaded.push(addon); } };
}

test("createGlyphRenderer loads the WebGL renderer once the terminal is open, and only once", () => {
  const { Addon, made } = webgl(), term = xterm({ opened: false });
  let changes = 0;
  const glyphs = createGlyphRenderer({ term, Addon, onChange: () => changes++ });
  assert.equal(glyphs.ensure(), false, "xterm refuses addons that need a renderer before open()");
  assert.equal(made.length, 0);
  term.element = {};
  assert.equal(glyphs.ensure(), true);
  assert.equal(glyphs.ensure(), true);
  assert.deepEqual([made.length, term.loaded.length, changes, glyphs.active], [1, 1, 1, true], "one addon; the cell size may change, so one refit");
});

test("a lost WebGL context falls back to the DOM renderer, and showing the tab tries again", () => {
  const { Addon, made } = webgl(), term = xterm();
  let changes = 0;
  const glyphs = createGlyphRenderer({ term, Addon, onChange: () => changes++ });
  glyphs.ensure();
  made[0].lose(); // Chromium dropped the context (too many, sleep, GPU reset)
  assert.deepEqual([glyphs.active, made[0].disposed, changes], [false, 1, 2], "disposed: xterm goes back to its DOM renderer, and refits");
  made[0].lose();
  assert.equal(made[0].disposed, 1, "a second loss of the dropped addon is ignored");
  assert.equal(glyphs.ensure(), true, "the next show loads a fresh one");
  assert.equal(made.length, 2);
});

test("without WebGL the terminal stays on the DOM renderer", () => {
  const term = xterm();
  assert.equal(createGlyphRenderer({ term, Addon: undefined }).ensure(), false, "the addon script did not load");
  assert.equal(createGlyphRenderer({ term, Addon: webgl({ failConstruct: true }).Addon }).ensure(), false);
  const { Addon, made } = webgl();
  let changes = 0;
  const glyphs = createGlyphRenderer({ term: xterm({ failLoad: true }), Addon, onChange: () => changes++ });
  assert.equal(glyphs.ensure(), false);
  assert.deepEqual([made[0].disposed, changes, glyphs.active], [1, 0, false], "a half-made addon is disposed; nothing changed");
});

test("terminal tabs are wired to both: WebGL after open and on show, centred fits everywhere", () => {
  const shell = read("renderer/shell.mjs"), html = read("renderer/index.html");
  const pkg = JSON.parse(read("package.json"));
  assert.match(shell, /createGlyphRenderer\(\{ term, Addon: globalThis\.WebglAddon\?\.WebglAddon,/);
  assert.match(shell, /term\.open\(wrap\);\n  glyphs\.ensure\(\);\n  fitTerminal\(term, fit\);/, "WebGL needs an opened terminal, and may change the cell");
  assert.match(shell, /onShow: \(\) => \{ requestAnimationFrame\(\(\) => \{ try \{ glyphs\.ensure\(\); fitTerminal\(term, fit\); \} catch \{\} \}\); \},/);
  assert.match(shell, /fit: \(\) => fitTerminal\(term, fit\),/, "the pane's ResizeObserver refits through the same centring");
  const xtermAt = html.indexOf("@xterm/xterm/lib/xterm.js"), webglAt = html.indexOf('<script src="../node_modules/@xterm/addon-webgl/lib/addon-webgl.js"></script>');
  assert.ok(xtermAt > 0 && webglAt > xtermAt, "the addon loads after xterm, from the app's own node_modules");
  assert.equal(pkg.dependencies["@xterm/addon-webgl"], "^0.18.0", "the addon line built for xterm 5");
  assert.match(pkg.dependencies["@xterm/xterm"], /^\^5\./);
});
