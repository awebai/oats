// Spec F: the selected tab is always visible. Whenever a tab becomes active, a
// tab closes or a strip resizes (window, sidebar, panel, split), each strip —
// the flat #tabbar and every split group's .group-tabbar — scrolls its active
// tab fully into view, moving only that strip's scrollLeft.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { revealInStrip } from "../renderer/reveal-in-scrollport.mjs";

const source = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
const shellFunction = name => {
  const found = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
  assert.ok(found, `${name} is exercised from the shipped shell`);
  return found[0];
};

/** A strip at x=100 of `width` px holding `count` tabs of `tabWidth` px. */
function geometry(dom, strip, tabWidth, width = 300) {
  Object.defineProperties(strip, { clientWidth: { value: width, configurable: true }, clientLeft: { value: 0, configurable: true } });
  strip.getBoundingClientRect = () => ({ left: 100, right: 100 + width, width });
  for (const tab of strip.querySelectorAll(":scope > .tab")) {
    tab.getBoundingClientRect = () => {
      const start = 100 + [...strip.children].filter(el => !el.hidden).indexOf(tab) * tabWidth - strip.scrollLeft;
      return { left: start, right: start + tabWidth, width: tabWidth };
    };
  }
  const visible = el => { const r = el.getBoundingClientRect(); return r.left >= 100 && r.right <= 100 + width; };
  return { visible };
}

function fixture(t, html) {
  const dom = new JSDOM(`<!doctype html><body><div id="outer">${html}</div></body>`);
  t.after(() => dom.window.close());
  // Any scrollIntoView could move the workbench or the page: only a strip's scrollLeft may move.
  dom.window.HTMLElement.prototype.scrollIntoView = () => assert.fail("must not scroll ancestors");
  dom.window.scrollTo = () => assert.fail("must not scroll the window");
  const outer = dom.window.document.getElementById("outer"); outer.scrollTop = 7; outer.scrollLeft = 3;
  return { dom, document: dom.window.document, assertOuter: () => { assert.equal(outer.scrollTop, 7); assert.equal(outer.scrollLeft, 3); } };
}
const tabsHtml = (n, active) => Array.from({ length: n }, (_, i) => `<div class="tab${i === active ? " active" : ""}"></div>`).join("");

test("revealInStrip moves only the strip, by the smallest amount, and leaves a visible tab alone", t => {
  const u = fixture(t, `<div id="strip">${tabsHtml(6, -1)}</div>`);
  const strip = u.document.getElementById("strip"), tabs = [...strip.children];
  const g = geometry(u.dom, strip, 120);
  revealInStrip(strip, tabs[4]); // 480–600 in a 300px strip: scroll right by 300
  assert.equal(strip.scrollLeft, 300); assert.ok(g.visible(tabs[4]));
  revealInStrip(strip, tabs[3]); // 360–480 visible at scrollLeft 300: no move, no jitter
  assert.equal(strip.scrollLeft, 300);
  revealInStrip(strip, tabs[1]); // left of the viewport: align its start
  assert.equal(strip.scrollLeft, 120); assert.ok(g.visible(tabs[1]));
  revealInStrip(strip, tabs[0]);
  assert.equal(strip.scrollLeft, 0);
  u.assertOuter();
});

test("revealInStrip shows the start of a tab wider than its strip, and ignores what it does not own", t => {
  const u = fixture(t, `<div id="strip">${tabsHtml(3, -1)}</div><div class="tab" id="elsewhere"></div>`);
  const strip = u.document.getElementById("strip"), tabs = [...strip.children];
  geometry(u.dom, strip, 400); // a very narrow group: every tab is wider than the strip
  revealInStrip(strip, tabs[2]);
  assert.equal(strip.scrollLeft, 800, "the start of the tab (status dot and name) is what shows");
  revealInStrip(strip, u.document.getElementById("elsewhere"));
  assert.equal(strip.scrollLeft, 800, "an element outside the strip never scrolls it");
  Object.defineProperty(strip, "clientWidth", { value: 0 }); strip.scrollLeft = 50;
  revealInStrip(strip, tabs[0]);
  assert.equal(strip.scrollLeft, 50, "a hidden (zero-width) strip has no geometry to act on");
  revealInStrip(null, tabs[0]);
  u.assertOuter();
});

test("revealInStrip keeps a revealed tab clear of the group strip's pinned split buttons (scroll padding)", t => {
  const u = fixture(t, `<div id="strip" style="scroll-padding-right: 74px">${tabsHtml(4, -1)}</div>`);
  const strip = u.document.getElementById("strip"), tabs = [...strip.children];
  geometry(u.dom, strip, 120); // 300px strip, the last 74px under the sticky #tab-actions
  revealInStrip(strip, tabs[0]); // 0–120: inside the 226px that stays clear
  assert.equal(strip.scrollLeft, 0);
  revealInStrip(strip, tabs[1]); // 120–240: its last 14px sit under the buttons
  assert.equal(strip.scrollLeft, 14);
  revealInStrip(strip, tabs[2]); // 240–360 must end at 226
  assert.equal(strip.scrollLeft, 134);
  u.assertOuter();
  // The shipped group strip pins the split buttons and declares that padding.
  const css = readFileSync(new URL("../renderer/shell.css", import.meta.url), "utf8");
  assert.match(css, /\.group-tabbar > #tab-actions \{ margin-left: auto; position: sticky; right: 0;[^}]*background: var\(--bg\); \}/);
  assert.match(css, /\.group-tabbar:has\(> #tab-actions\) \{ scroll-padding-right: 74px; \}/);
  assert.match(css, /--tab-actions-w: 74px;[^\n]*\n?[^}]*width: var\(--tab-actions-w\);/, "the padding is the controls' own width");
});

function shell(t) {
  const u = fixture(t, `<div id="tabbar">${tabsHtml(5, 4)}</div><div id="tabhost">
    <div class="group-cell"><div class="group-tabbar">${tabsHtml(4, 3)}</div></div>
    <div class="group-cell"><div class="group-tabbar">${tabsHtml(2, 0)}</div></div></div>`);
  const observed = [];
  let callback = null;
  class ResizeObserver {
    constructor(fn) { callback = fn; }
    observe(el) { observed.push(el); }
    disconnect() { observed.length = 0; }
  }
  const c = {
    tabbar: u.document.getElementById("tabbar"), tabhost: u.document.getElementById("tabhost"), revealInStrip, ResizeObserver,
  };
  const resize = source.match(/^const tabStripResize = [^\n]+/m)[0];
  const api = runInNewContext(`${["tabStrips", "revealActiveTabs", "observeTabStrips"].map(shellFunction).join("\n")}
${resize}
({ revealActiveTabs, observeTabStrips });`, c);
  return { ...u, ...api, c, observed, resize: () => callback([]) };
}

test("the shell observes exactly the current strips and reveals each strip's active tab when one resizes", t => {
  const s = shell(t);
  const strips = [s.c.tabbar, ...s.c.tabhost.querySelectorAll(".group-tabbar")];
  s.observeTabStrips();
  assert.deepEqual(s.observed, strips, "the flat strip and every group strip");
  const views = strips.map(strip => geometry(s.dom, strip, 120));
  const active = strips.map(strip => strip.querySelector(".tab.active"));
  assert.deepEqual(active.map((tab, i) => views[i].visible(tab)), [false, false, true]);
  s.resize(); // the window, the sidebar, the panel or a split changed a strip's width
  assert.deepEqual(active.map((tab, i) => views[i].visible(tab)), [true, true, true], "every strip shows its active tab");
  assert.deepEqual(strips.map(strip => strip.scrollLeft), [300, 180, 0]);
  s.assertOuter();
  // A group that goes away is no longer observed.
  s.c.tabhost.lastElementChild.remove();
  s.observeTabStrips();
  assert.deepEqual(s.observed, strips.slice(0, 2));
});

test("a hidden active tab (another workspace) is not revealed; the strip keeps its scroll", t => {
  const s = shell(t);
  const strip = s.c.tabbar, g = geometry(s.dom, strip, 120), tab = strip.querySelector(".tab.active");
  tab.hidden = true;
  s.revealActiveTabs();
  assert.equal(strip.scrollLeft, 0);
  tab.hidden = false;
  s.revealActiveTabs();
  assert.ok(g.visible(tab));
});

test("activation, closing a tab and every split projection reveal the active tab", () => {
  const body = name => shellFunction(name);
  assert.match(body("activateTab"), /updateSplitControls\(\);\n  revealActiveTabs\(\);/, "every activation path: click, keyboard, Mod+1–9, roster, palette, a new tab");
  assert.match(body("closeTab"), /tabs\.delete\(id\);\n  revealActiveTabs\(\);/, "the remaining tabs widen: the active one may move");
  assert.match(body("renderSplit"), /observeTabStrips\(\);\n\}$/, "group strips appear and disappear with the split");
  assert.doesNotMatch(source, /\.scrollIntoView\?\.\(\{ block: "nearest", inline: "nearest" \}\)/);
  const chrome = readFileSync(new URL("../renderer/tab-a11y.mjs", import.meta.url), "utf8");
  assert.match(chrome, /revealInStrip\(tabEl\.parentElement, control\)/, "keyboard focus reveals within the strip too");
  assert.doesNotMatch(chrome, /scrollIntoView/);
});
