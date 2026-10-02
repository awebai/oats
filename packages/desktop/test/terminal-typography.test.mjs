// Native terminal geometry (060de502; the human's 2026-09-29 direction over
// the Redesign v3 "transcript rhythm"): xterm's default line height,
// horizontal-only 32px gutters. Spec F item 6 made the face the bundled
// Inconsolata at 14px, which keeps the old 13px stack's 15px cell height. Isolated renderer module + CSSOM;
// no browser layout, Electron, storage or live app.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";

const read = name => readFileSync(new URL(`../renderer/${name}`, import.meta.url), "utf8");
const themeSource = read("theme.mjs"), html = read("index.html");
const themeCSS = read("theme.css"), shellCSS = read("shell.css");
// Font stacks compared as lists: jsdom drops the space after a comma in custom properties.
const stack = value => String(value).trim().replace(/\s*,\s*/g, ", ");

function fixture(t, { stored = {}, noStorage = false, palette, fonts } = {}) {
  const dom = new JSDOM(html);
  t.after(() => dom.window.close());
  const style = dom.window.document.createElement("style");
  style.textContent = `${themeCSS}\n${shellCSS}`; dom.window.document.head.append(style);
  if (palette) dom.window.document.documentElement.dataset.theme = palette;
  // jsdom has no FontFaceSet: a stub stands in for the bundled face's load state.
  if (fonts) Object.defineProperty(dom.window.document, "fonts", { value: fonts });
  const context = {
    document: dom.window.document,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }) },
  };
  if (!noStorage) context.localStorage = { getItem: key => stored[key] ?? null, setItem: (key, value) => { stored[key] = String(value); }, removeItem: key => { delete stored[key]; } };
  const theme = runInNewContext(`${themeSource.replace(/\bexport /g, "")}\n({ terminalTypography, onTerminalTypographyChange, setTerminalFontFamily, setTerminalFontSize, resetTerminalTypography, BUNDLED_MONO, TERMINAL_FONT_SIZE })`, context);
  const rule = selector => {
    for (const sheet of dom.window.document.styleSheets) {
      for (const r of sheet.cssRules) if (r.selectorText === selector) return r.style;
    }
    return null;
  };
  return { theme, doc: dom.window.document, rule };
}

for (const palette of ["light", "solarized", "dark"]) {
  test(`fresh Desktop (${palette}): terminal typography is 14px Inconsolata, then the OS monospace stack, with no line height`, t => {
    const u = fixture(t, { palette });
    const type = u.theme.terminalTypography();
    assert.equal(type.fontSize, 14, "Inconsolata at 14px: the old 13px stack's 15px cell height");
    assert.match(stack(type.fontFamily), /^"Inconsolata", ui-monospace,/, "the bundled face first, then the OS stack (--term-font-family)");
    assert.equal("lineHeight" in type, false, "typography carries no line height; xterm's default 1.0 applies");
    assert.deepEqual(Object.keys(type).sort(), ["fontFamily", "fontSize"]);
  });
}

test("theme.css seeds --term-font-size: 14px (the JS default agrees) and defines no --term-line-height token", t => {
  const u = fixture(t);
  const root = u.doc.defaultView.getComputedStyle(u.doc.documentElement);
  assert.equal(root.getPropertyValue("--term-font-size").trim(), "14px");
  assert.equal(u.theme.TERMINAL_FONT_SIZE, 14, "the storage- and token-less fallback is the same size");
  assert.equal(root.getPropertyValue("--term-line-height").trim(), "", "no --term-line-height token");
  assert.doesNotMatch(themeCSS, /--term-line-height/, "the token must not come back under another rule");
});

test("a persisted user size is respected, not migrated (12 and 13 stay); reset forgets it and lands on 14", t => {
  const stored = { "oats.desktop.terminal.fontSize": "12", "oats.desktop.terminal.fontFamily": "Menlo" };
  const u = fixture(t, { stored });
  const type = u.theme.terminalTypography();
  assert.equal(type.fontSize, 12, "a size the user chose is kept");
  assert.equal(type.fontFamily, "Menlo");
  assert.equal("lineHeight" in type, false);
  assert.equal(fixture(t, { stored: { "oats.desktop.terminal.fontSize": "13" } }).theme.terminalTypography().fontSize, 13,
    "a stored 13 (the old default, kept by a size change) stays: the new default applies only where nothing is stored");
  const heard = [];
  u.theme.onTerminalTypographyChange(value => heard.push(value));
  u.theme.resetTerminalTypography();
  assert.deepEqual(Object.keys(stored), [], "reset stores nothing: later default changes reach the user");
  assert.equal(heard.length, 1, "live terminals hear the reset");
  assert.equal(heard[0].fontSize, 14);
  assert.match(stack(heard[0].fontFamily), /^"Inconsolata",/);
  const fresh = fixture(t, { noStorage: true }).theme.terminalTypography();
  assert.equal(fresh.fontSize, 14, "storage-less falls back to the 14px token");
  u.theme.setTerminalFontSize("nonsense");
  assert.equal(stored["oats.desktop.terminal.fontSize"], "14", "an unreadable size falls back to the default");
});

test("terminal gutters: .term-wrap .xterm has 32px horizontal padding only, and .term-wrap none", t => {
  const u = fixture(t);
  const xterm = u.rule(".term-wrap .xterm");
  assert.ok(xterm, ".term-wrap .xterm rule present");
  assert.equal(xterm.paddingLeft, "32px"); assert.equal(xterm.paddingRight, "32px");
  assert.equal(xterm.paddingTop, "0px", "no vertical inset: tmux owns row geometry");
  assert.equal(xterm.paddingBottom, "0px");
  assert.equal(xterm.width, "100%"); assert.equal(xterm.height, "100%");
  // FitAddon subtracts padding from .xterm itself; a gutter on .term-wrap
  // would allocate columns wider than the visible terminal.
  const wrap = u.rule(".term-wrap");
  assert.ok(wrap, ".term-wrap rule present");
  assert.equal(wrap.padding, "", "gutters live on .xterm, not .term-wrap");
});

// Spec F item 6: Inconsolata, bundled, is the default monospace face of the terminal and the UI.
test("theme.css bundles Inconsolata with @font-face and puts it first in --term-font-family and --mono", t => {
  const u = fixture(t);
  const root = u.doc.defaultView.getComputedStyle(u.doc.documentElement);
  const os = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  assert.equal(stack(root.getPropertyValue("--term-font-family")), `"Inconsolata", ${os}`);
  assert.equal(stack(root.getPropertyValue("--mono")), `"Inconsolata", ${os}`, "terminal and UI agree");
  const face = themeCSS.match(/@font-face \{[^}]*\}/)?.[0];
  assert.ok(face, "an @font-face rule");
  assert.match(face, /font-family: "Inconsolata"; src: url\("fonts\/Inconsolata-VF\.ttf"\) format\("truetype"\);/);
  assert.match(face, /font-weight: 200 900;/); assert.match(face, /font-display: block;/, "text in the face waits for it instead of swapping in a fallback");
  const font = readFileSync(new URL("../renderer/fonts/Inconsolata-VF.ttf", import.meta.url));
  assert.equal(font.readUInt32BE(0), 0x00010000, "a TrueType file");
  assert.match(readFileSync(new URL("../renderer/fonts/OFL.txt", import.meta.url), "utf8"), /SIL Open Font License, Version 1\.1/);
  const notice = readFileSync(new URL("../renderer/fonts/README.md", import.meta.url), "utf8");
  assert.match(notice, /version 3\.001/); assert.match(notice, /github\.com\/google\/fonts/);
  const builder = readFileSync(new URL("../electron-builder.config.cjs", import.meta.url), "utf8");
  assert.match(builder, /"renderer\/\*\*\/\*"/, "the font ships with the renderer");
  assert.match(html, /default-src 'self'/, "the CSP admits a local font (no font-src restriction)");
  assert.doesNotMatch(html, /font-src/);
  assert.match(shellCSS, /\.ctx-repo-label \{[^}]*font-family: var\(--mono\);/, "the roster's paths use the shared token");
});

test("a stored terminal font wins; the bundled default applies only where nothing is stored", t => {
  assert.equal(fixture(t, { stored: { "oats.desktop.terminal.fontFamily": "JetBrains Mono" } }).theme.terminalTypography().fontFamily, "JetBrains Mono");
  assert.match(stack(fixture(t, { stored: {} }).theme.terminalTypography().fontFamily), /^"Inconsolata",/);
});

test("until Inconsolata has loaded, terminals get the rest of the stack, then the full family (xterm re-measures)", async t => {
  let loaded = false, loads = 0, settle;
  const fonts = {
    check: spec => { assert.equal(spec, '13px "Inconsolata"', "a probe size: availability does not depend on it"); return loaded; },
    load: () => { loads++; return new Promise(resolve => { settle = () => { loaded = true; resolve([{}]); }; }); },
  };
  const u = fixture(t, { fonts });
  const heard = [];
  u.theme.onTerminalTypographyChange(value => heard.push(value.fontFamily));
  const early = u.theme.terminalTypography();
  assert.equal(stack(early.fontFamily), "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", "never measured with fallback metrics under the bundled name");
  u.theme.terminalTypography();
  await Promise.resolve();
  assert.equal(loads, 1, "one load, however many terminals ask");
  settle(); await new Promise(setImmediate);
  assert.deepEqual(heard.map(stack), ['"Inconsolata", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'],
    "a real option change: live terminals switch and re-measure");
  assert.match(stack(u.theme.terminalTypography().fontFamily), /^"Inconsolata",/);
});

test("a face that fails to load still settles to the full family (the stack falls back as the browser would)", async t => {
  const fonts = { check: () => false, load: () => Promise.reject(new Error("no font")) };
  const u = fixture(t, { fonts });
  const heard = [];
  u.theme.onTerminalTypographyChange(value => heard.push(value.fontFamily));
  assert.doesNotMatch(u.theme.terminalTypography().fontFamily, /Inconsolata/);
  await new Promise(setImmediate);
  assert.equal(heard.length, 1);
  assert.match(stack(u.theme.terminalTypography().fontFamily), /^"Inconsolata",/);
});

test("the shell's reset (⌘0 and the palette) forgets the stored typography instead of pinning a size", () => {
  const shell = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
  assert.equal(shell.match(/Terminal: reset typography"[^\n]*run: \(\) => resetTerminalTypography\(\) \}/g)?.length, 2, "the action and the palette command");
  assert.doesNotMatch(shell, /setTerminalFontSize\(1[34]\)/, "no hard-coded default size in the shell");
});
