// In-memory CSSOM/cascade checks, not browser layout or live-app verification.
// No scripts, network resources, Electron, CLI or real workspace mutations.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { shellIcon } from "../renderer/shell-icons.mjs";

const read = name => readFileSync(new URL(`../renderer/${name}`, import.meta.url), "utf8");
const theme = read("theme.css"), shell = read("shell.css");
const icon = shellIcon("workspace");
const markup = `<div id="app"><aside id="sidebar">
  <div class="side-head"><button id="ws-trigger" aria-expanded="false">
    <span class="ws-brand-mark">${icon}</span><span class="ws-heading-copy">
      <span id="ws-name">Workspace</span><span id="ws-context">/fixture/workspace</span>
    </span><span class="ws-chevron">${icon}</span></button></div>
  <div class="ws-menu" hidden><input id="ws-menu-search"><div class="ws-options">
    <button class="ws-option" aria-selected="true"><span class="ws-check">✓</span><span class="ws-option-path">/fixture/workspace</span></button>
  </div></div>
  <nav id="nav"><button class="nav-item active"><span class="icon">${icon}</span>Workspace</button></nav>
  <section id="instance-roster"><div class="ctx-head">Instances</div><input class="ctx-filter">
    <div class="ctx-list"><div class="ctx-tree-row"><button class="ctx-inst active"><span class="ctx-dot on"></span>
      <span class="ctx-copy"><span class="ctx-name">Fixture instance</span><span class="ctx-repo-label">fixture</span></span>
    </button></div></div></section>
  <div id="nav-foot"><button id="sidebar-spawn" class="primary">${icon}Spawn instance</button>
    <div id="sidebar-tools">${["Sidebar", "Theme", "Shortcuts", "Palette"].map(label => `<button class="nav-item" aria-label="${label}">${icon}</button>`).join("")}</div>
  </div></aside><button id="sidebar-restore">${icon}</button>
  <main id="main"><div id="tabstrip"><div id="tabbar-row"><div id="tabbar">
    <div class="tab active"><button class="tab-trigger">Fixture tab</button><button class="close">×</button></div>
  </div><div id="tab-actions" hidden>${["splitRight", "splitDown", "splitClose"].map(name => `<button>${shellIcon(name)}</button>`).join("")}</div></div></div>
  <div id="tabhost" class="split-row"><div class="group-cell focused-group">
    <div class="group-tabbar"></div><button class="split-empty">Open an instance in this panel</button>
  </div></div></main></div>
  <div class="ws-modal" hidden><section class="ws-dialog"><footer class="ws-dialog-foot">
    <button class="primary">Add workspace</button></footer></section></div>
  <div class="oats-view"><button class="act primary">Primary</button><button class="act danger">Danger</button>
    <button class="act">Secondary</button><input class="field"><textarea class="field"></textarea><select class="field"><option>Fixture</option></select></div>
  <div class="ctx-instance-menu"><button data-action="retire">Remove instance</button></div>`;

function fixture(t, palette = "light") {
  const dom = new JSDOM(`<!doctype html><html data-theme="${palette}"><head></head><body>${markup}</body></html>`);
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  for (const css of [theme, shell]) {
    const style = doc.createElement("style"); style.textContent = css; doc.head.append(style);
  }
  const rules = [...doc.styleSheets].flatMap(sheet => [...sheet.cssRules]);
  const rule = selector => {
    const matches = rules.filter(rule => rule.selectorText?.replace(/\s+/g, " ") === selector);
    assert.equal(matches.length, 1, `one shipped rule: ${selector}`);
    return matches[0].style;
  };
  return { doc, rule, get: selector => doc.querySelector(selector),
    style: selector => dom.window.getComputedStyle(doc.querySelector(selector)) };
}

test("visual shell geometry: 264px sidebar, aligned 48px bars, 24px brand and 16px icons", t => {
  const u = fixture(t);
  assert.equal(u.style("#sidebar").width, "264px");
  assert.equal(u.style("#sidebar").minWidth, "264px");
  assert.equal(u.style("#sidebar").flexShrink, "0");
  assert.equal(u.rule(':root, [data-theme="dark"]').getPropertyValue("--bar-h"), "48px");
  for (const selector of [".side-head", "#tabbar", ".group-tabbar"]) assert.equal(u.style(selector).height, "var(--bar-h)");
  assert.equal(u.style(".side-head").padding, "0px 10px 0px 12px");
  assert.equal(u.style("#ws-trigger").gap, "9px");
  assert.equal(u.style("#ws-trigger").height, "36px");
  for (const [selector, size] of [[".ws-brand-mark", "24px"], [".shell-icon", "16px"]]) {
    assert.equal(u.style(selector).width, size); assert.equal(u.style(selector).height, size);
    assert.equal(u.style(selector).flexShrink, "0");
  }
  assert.equal(u.style(".ws-heading-copy").minWidth, "0px");
  assert.equal(u.style(".ws-heading-copy").flexDirection, "column");
  for (const selector of ["#ws-name", "#ws-context"]) {
    assert.equal(u.style(selector).whiteSpace, "nowrap");
    assert.equal(u.style(selector).textOverflow, "ellipsis");
  }
  assert.equal(u.style("#ws-name").fontSize, "13.5px");
  assert.equal(u.style("#ws-context").fontSize, "10.5px");
});

test("nav/footer rhythm stays separate from the newer roomy auto-height roster", t => {
  const u = fixture(t);
  assert.equal(u.style("#nav").padding, "8px 8px 6px");
  assert.equal(u.style("#nav").gap, "1px");
  assert.equal(u.style("#nav .nav-item").minHeight, "30px");
  assert.equal(u.style("#nav .nav-item").gap, "9px");
  assert.equal(u.style("#nav-foot").padding, "10px");
  assert.equal(u.style("#nav-foot").gap, "8px");
  assert.equal(u.style("#sidebar-spawn").minHeight, "32px");
  assert.equal(u.style("#sidebar-tools").gap, "2px");
  assert.equal(u.doc.querySelectorAll("#sidebar-tools .nav-item").length, 4);
  assert.equal(u.style("#sidebar-tools .nav-item").height, "26px");
  assert.equal(u.style("#sidebar-tools .nav-item").flexGrow, "1");
  assert.equal(u.style(".ctx-tree-row").minHeight, "56px");
  assert.equal(u.style(".ctx-tree-row").height, "auto");
  assert.equal(u.style(".ctx-inst").minHeight, "48px");
  assert.equal(u.style(".ctx-inst").height, "auto");
  assert.equal(u.style(".ctx-copy").gap, "4px");
  assert.equal(u.style(".ctx-list").overflowY, "auto");
});

for (const palette of ["light", "solarized", "dark"]) test(`${palette}: primary, danger, disabled and focus states keep their own semantic pairs`, t => {
  const u = fixture(t, palette);
  for (const selector of ["#sidebar-spawn", ".ws-dialog-foot .primary", ".oats-view .primary"]) {
    assert.equal(u.style(selector).color, "var(--primary-fg)", selector);
    assert.equal(u.style(selector).background, "var(--primary-bg)", selector);
    u.get(selector).disabled = true;
    assert.equal(u.style(selector).color, "var(--faint)", `${selector} disabled`);
    assert.equal(u.style(selector).background, "var(--surface-2)", `${selector} disabled`);
  }
  assert.equal(u.style(".act.danger").color, "var(--danger)");
  assert.equal(u.style(".act:not(.primary):not(.danger)").color, "var(--fg)");
  assert.equal(u.style('[data-action="retire"]').color, "var(--danger)");
  assert.equal(u.rule('.ctx-instance-menu button[data-action="retire"]:is(:hover, :focus-visible), .ctx-instance-menu button.danger:is(:hover, :focus-visible)').background, "var(--surface-2)",
    "danger hover uses the AA-validated raised surface, not dark selection");
  assert.equal(u.rule(".oats-view button.act.primary:hover:not(:disabled)").color, "var(--primary-fg)");
  assert.equal(u.rule(":focus-visible").outline, "2px solid var(--accent)");
  for (const selector of ["#ws-trigger:focus-visible", ".ws-option:focus-visible", ".ctx-instance-menu button:focus-visible", ".split-empty:focus-visible"]) {
    assert.equal(u.rule(selector).outline, "2px solid var(--accent)", selector);
  }
});

test("running indicators use accent, while success stays distinct", t => {
  const u = fixture(t);
  assert.equal(u.rule(".ctx-dot.on").background, "var(--accent)");
  assert.equal(u.rule(".palette-item .pdot.on").background, "var(--accent)");
  assert.equal(u.rule(".palette-item .pdot.on").borderColor, "var(--accent)");
  assert.equal(u.rule(".tab.active").boxShadow, "inset 0 2px 0 var(--accent)");
  assert.equal(u.rule(".ctx-inst.active").background, "var(--sel)");
});

test("component geometry: rounded popovers, 36px fields and persistent scrollable groups", t => {
  const u = fixture(t);
  for (const selector of [".ws-menu", ".ctx-instance-menu"]) {
    assert.equal(u.style(selector).borderRadius, "9px");
    assert.equal(u.style(selector).padding, "6px");
    assert.equal(u.style(selector).boxShadow, "var(--shadow-popover)");
  }
  for (const selector of ["input.field", "select.field"]) assert.equal(u.style(selector).minHeight, "36px");
  assert.equal(u.style("textarea.field").minHeight, "64px");
  assert.equal(u.style("input.field").borderRadius, "7px");
  assert.equal(u.style("input.field").background, "var(--surface)");
  assert.equal(u.style("#tabbar").overflowX, "auto");
  assert.equal(u.style(".group-tabbar").overflowX, "auto");
  assert.equal(u.style(".tab").flexShrink, "0");
  assert.equal(u.style(".tab .close").width, "20px");
  assert.equal(u.style(".tab .close").height, "20px");
  assert.equal(u.style("#tab-actions button").width, "28px");
  assert.equal(u.style("#tab-actions button").height, "28px");
  assert.equal(u.style(".group-cell.focused-group").outline, "1px solid var(--accent)");
  assert.equal(u.style(".split-empty").display, "flex", "empty panels remain visible");
  for (const selector of [".ws-menu", ".ws-modal", "#tab-actions"]) {
    assert.equal(u.style(selector).display, "none", `${selector} honors hidden`);
    u.get(selector).hidden = false;
    assert.notEqual(u.style(selector).display, "none", `${selector} can be revealed`);
  }
  u.get("#app").classList.add("sidebar-hidden");
  assert.equal(u.style("#sidebar").display, "none");
  assert.equal(u.style("#sidebar-restore").display, "flex");
});

test("shell component paints use tokens, not raw colors or text transparency", () => {
  const rules = shell.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\bopacity\s*:/i);
  assert.doesNotMatch(rules, /font:\s*[^;{}]+\s+inherit\s*;/, "control font shorthands must be valid CSS");
});


test("coordinated shell inset applies equally to selected and unselected rows; split strokes are thinner only", t => {
  const u = fixture(t);
  const row = u.get(".ctx-inst");
  assert.equal(u.style(".ctx-inst").paddingLeft, "8px");
  row.classList.remove("active");
  assert.equal(u.style(".ctx-inst").paddingLeft, "8px", "selection never shifts the content");
  assert.equal(u.style(".ctx-inst").paddingTop, "4px");
  assert.equal(u.style(".ctx-inst").paddingBottom, "4px");
  assert.equal(u.style(".ctx-inst").paddingRight, "7px");
  for (const svg of u.doc.querySelectorAll("#tab-actions .shell-icon")) assert.equal(svg.getAttribute("stroke-width"), "1.1");
  assert.equal(u.style("#tab-actions .shell-icon").width, "16px");
  assert.equal(u.get("#nav .shell-icon").getAttribute("stroke-width"), "1.4", "navigation icons retain their supplied strokes");
});

for (const palette of ["light", "solarized", "dark"]) test(`${palette}: nav ink reaches labels/icons without recoloring active or disabled states`, t => {
  const u = fixture(t, palette);
  const nav = u.get("#nav .nav-item");
  assert.equal(u.style("#nav .icon").color, "var(--accent)");
  nav.classList.remove("active");
  assert.equal(u.style("#nav .nav-item").color, "var(--nav-fg)");
  assert.equal(u.style("#nav .icon").color, "var(--nav-fg)");
  assert.equal(u.style("#sidebar-tools .nav-item").color, "var(--nav-fg)");
  nav.disabled = true;
  assert.equal(u.style("#nav .nav-item").color, "var(--faint)");
});

test("theme component rules remain token-only, including all new identity markers", () => {
  const components = theme.slice(theme.indexOf("/* Keyboard-first" )).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(components, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\bopacity\s*:/i);
  assert.doesNotMatch(components, /\battr\(/i, "data attributes select named rules, never arbitrary CSS values");
});
