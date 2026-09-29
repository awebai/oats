// Native terminal geometry (060de502; the human's 2026-09-29 direction over
// the Redesign v3 "transcript rhythm"): 13px system monospace, xterm's default
// line height, horizontal-only 32px gutters. Isolated renderer module + CSSOM;
// no browser layout, Electron, storage or live app.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";

const read = name => readFileSync(new URL(`../renderer/${name}`, import.meta.url), "utf8");
const themeSource = read("theme.mjs"), html = read("index.html");
const themeCSS = read("theme.css"), shellCSS = read("shell.css");

function fixture(t, { stored = {}, noStorage = false, palette } = {}) {
  const dom = new JSDOM(html);
  t.after(() => dom.window.close());
  const style = dom.window.document.createElement("style");
  style.textContent = `${themeCSS}\n${shellCSS}`; dom.window.document.head.append(style);
  if (palette) dom.window.document.documentElement.dataset.theme = palette;
  const context = {
    document: dom.window.document,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }) },
  };
  if (!noStorage) context.localStorage = { getItem: key => stored[key] ?? null, setItem() {}, removeItem() {} };
  const theme = runInNewContext(`${themeSource.replace(/\bexport /g, "")}\n({ terminalTypography })`, context);
  const rule = selector => {
    for (const sheet of dom.window.document.styleSheets) {
      for (const r of sheet.cssRules) if (r.selectorText === selector) return r.style;
    }
    return null;
  };
  return { theme, doc: dom.window.document, rule };
}

for (const palette of ["light", "solarized", "dark"]) {
  test(`fresh Desktop (${palette}): terminal typography is 13px system monospace with no line height`, t => {
    const u = fixture(t, { palette });
    const type = u.theme.terminalTypography();
    assert.equal(type.fontSize, 13, "the July/OAS default, not the Redesign v3 12px");
    assert.match(type.fontFamily, /^ui-monospace,/, "OS monospace stack from --term-font-family");
    assert.equal("lineHeight" in type, false, "typography carries no line height; xterm's default 1.0 applies");
    assert.deepEqual(Object.keys(type).sort(), ["fontFamily", "fontSize"]);
  });
}

test("theme.css seeds --term-font-size: 13px and defines no --term-line-height token", t => {
  const u = fixture(t);
  const root = u.doc.defaultView.getComputedStyle(u.doc.documentElement);
  assert.equal(root.getPropertyValue("--term-font-size").trim(), "13px");
  assert.equal(root.getPropertyValue("--term-line-height").trim(), "", "no --term-line-height token");
  assert.doesNotMatch(themeCSS, /--term-line-height/, "the token must not come back under another rule");
});

test("a persisted user size is respected, not migrated (12 stays 12; reset lands on 13)", t => {
  const u = fixture(t, { stored: { "oats.desktop.terminal.fontSize": "12", "oats.desktop.terminal.fontFamily": "Menlo" } });
  const type = u.theme.terminalTypography();
  assert.equal(type.fontSize, 12, "a size the user chose is kept");
  assert.equal(type.fontFamily, "Menlo");
  assert.equal("lineHeight" in type, false);
  const fresh = fixture(t, { noStorage: true }).theme.terminalTypography();
  assert.equal(fresh.fontSize, 13, "storage-less falls back to the 13px token");
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
