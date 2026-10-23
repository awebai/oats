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
  <div class="ctx-head ws-head"><span id="ws-heading" class="ws-heading">Workspaces</span>
    <button id="ws-add-open" class="ws-add-open icon-button" type="button" aria-label="Add local workspace…">${icon}</button></div>
  <section id="ws-list" class="ws-list" aria-labelledby="ws-heading"><div id="ws-options" class="ws-options"><ul class="ws-group">
    <li class="ws-option-row"><button class="ws-option" aria-current="true"><span class="ws-option-name">fixture</span><span class="sr-only">, needs input</span><span class="ws-waiting" aria-hidden="true"></span></button></li>
    <li class="ws-option-row"><button class="ws-option"><span class="ws-option-name">other</span></button></li>
  </ul></div></section>
  <section id="instance-roster"><div class="ctx-head roster-head">Instances</div>
    <div class="ctx-list"><div class="ctx-deployment" role="heading" aria-level="3"><span class="ctx-deployment-label">altair</span><span class="deployment-mark" role="img" aria-label="remembered">${icon}</span></div><div class="ctx-tree-row"><button class="ctx-inst active"><span class="ctx-dot on"></span>
      <span class="ctx-copy"><span class="ctx-name">Fixture instance</span><span class="ctx-repo-label">fixture</span></span>
    </button></div></div></section>
  <div id="nav-foot"><nav id="nav"><button class="nav-item active"><span class="icon">${icon}</span><span class="label">Deployments</span></button><button class="nav-item"><span class="icon">${icon}</span><span class="label">Workspace</span></button></nav>
    <div id="sidebar-tools">${["Sidebar", "Theme", "Shortcuts"].map(label => `<button class="nav-item icon-button" aria-label="${label}">${icon}</button>`).join("")}<button id="sidebar-spawn" class="nav-item icon-button" aria-label="Spawn instance">${icon}</button></div>
  </div></aside>
  <main id="main"><button id="show-sidebar" class="main-edge-control" hidden>${icon}</button><div id="tabstrip"><div id="tabbar-row"><div id="tabbar">
    <div class="tab active"><button class="tab-trigger">Fixture tab</button><button class="close">×</button></div>
  </div><div id="tab-actions" hidden>${["splitRight", "splitDown"].map(name => `<button>${shellIcon(name)}</button>`).join("")}</div></div></div>
  <div id="tabhost" class="split-row"><div class="group-cell focused-group">
    <div class="group-tabbar"></div><button class="split-empty">Open an instance in this panel</button>
  </div></div></main></div>
  <div class="ws-modal" hidden><section class="ws-dialog"><footer class="ws-dialog-foot">
    <button class="primary">Onboard</button></footer></section></div>
  <div class="oats-view"><button class="act primary">Primary</button><button class="act danger">Danger</button>
    <button class="act">Secondary</button><input class="field"><textarea class="field"></textarea><select class="field"><option>Fixture</option></select></div>
  <div class="ctx-instance-menu"><button data-action="retire">Retire instance</button></div>`;

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

test("visual shell geometry: 264px sidebar, aligned 48px bars, two alike section heads and 16px icons", t => {
  const u = fixture(t);
  assert.equal(u.style("#sidebar").width, "264px");
  assert.equal(u.style("#sidebar").minWidth, "264px");
  assert.equal(u.style("#sidebar").flexShrink, "0");
  assert.equal(u.rule(':root, [data-theme="dark"]').getPropertyValue("--bar-h"), "48px");
  // Every bar is 48px including its 1px rule; the flat strip's inner row
  // yields that rule to #tabstrip so the active tab keeps its bottom border.
  for (const selector of ["#tabstrip", ".group-tabbar"]) assert.equal(u.style(selector).height, "var(--bar-h)", selector);
  for (const selector of ["#tabstrip", ".group-tabbar"]) assert.equal(u.style(selector).boxSizing, "border-box", selector);
  assert.equal(u.style("#tabbar").height, "calc(var(--bar-h) - 1px)");
  // The sidebar layout (2026-10-23): the Workspaces head is the Instances head (.ctx-head), with no bar, logo or
  // rule of its own; the heading, then Add local workspace… as a 28px icon button pushed to the right end.
  assert.equal(shell.match(/\.side-head\b|\.ws-brand-(?:mark|image)\b|\.ws-heading\s*[,{]/), null, "no rules left for the old head, its mark or a heading style of its own");
  const [wsHead, rosterHead] = [u.style(".ws-head"), u.style(".roster-head")];
  for (const prop of ["height", "padding", "display", "alignItems", "gap", "color", "fontSize", "fontWeight"]) {
    assert.equal(wsHead[prop], rosterHead[prop], `the two heads share ${prop}`);
  }
  // The two headings are the sidebar's top level (2026-10-23): 14px 600 in --fg, on one line, the row's 36px kept.
  assert.deepEqual([wsHead.height, wsHead.color, wsHead.fontSize, wsHead.fontWeight, wsHead.whiteSpace], ["36px", "var(--fg)", "14px", "600", "nowrap"]);
  assert.equal(u.style(".ws-head > .ws-add-open").marginLeft, "auto", "Add local workspace… at the head's right end");
  assert.deepEqual([u.style(".ws-add-open").width, u.style(".ws-add-open").height, u.style(".ws-add-open").flexShrink], ["28px", "28px", "0"]);
  assert.equal(u.style(".ws-add-open").display, "grid");
  assert.equal(u.style(".ws-add-open").color, "var(--muted)");
  for (const [selector, size] of [[".shell-icon", "16px"]]) {
    assert.equal(u.style(selector).width, size); assert.equal(u.style(selector).height, size);
    assert.equal(u.style(selector).flexShrink, "0");
  }
  for (const selector of [".ws-option-name", ".ctx-deployment-label"]) {
    assert.equal(u.style(selector).whiteSpace, "nowrap", selector);
    assert.equal(u.style(selector).textOverflow, "ellipsis", selector);
  }
  // The list: always shown under the head, about six rows at most, then it scrolls inside itself.
  assert.equal(u.style(".ws-list").flexShrink, "0");
  // One line between the list and Instances (2026-10-23): the roster's ::before, a 1px --border rule inset to the
  // rows' 8px gutters; no border of the list's or the roster's own, which would run edge to edge.
  for (const prop of ["border", "borderBottom", "borderBottomWidth", "borderBottomStyle"]) assert.equal(u.rule(".ws-list")[prop], "", `.ws-list ${prop}`);
  for (const prop of ["border", "borderTop", "borderTopWidth", "borderTopStyle"]) assert.equal(u.rule("#instance-roster")[prop], "", `#instance-roster ${prop}`);
  const line = u.rule("#instance-roster::before");
  // JSDOM drops a var() border's longhands: the shorthand's text is pinned.
  assert.deepEqual([line.content, line.flexShrink, line.margin, line.getPropertyValue("border-top")], ['""', "0", "0px 8px", "1px solid var(--border)"]);
  assert.equal(u.rule(".ws-list").paddingTop, "0px", "the list starts right under its heading");
  assert.equal(u.style(".ws-options").maxHeight, "276px");
  assert.equal(u.style(".ws-options").overflowY, "auto");
  assert.equal(u.style(".ws-option").alignItems, "center");
  assert.equal(u.style(".ws-option").padding, "6px 8px 6px 10px", "its circle in the column of the roster's top-level dots");
  // The needs-input dot: the roster's attention token, a 7px graphic that never shrinks.
  const dot = u.style(".ws-waiting");
  assert.deepEqual([dot.width, dot.height, dot.boxSizing, dot.borderRadius, dot.flexShrink, dot.background, dot.borderTopWidth, dot.borderTopStyle],
    ["8px", "8px", "border-box", "50%", "0", "var(--attn-dot)", "1px", "solid"], "a yellow fill in a ring (its --warn colour and 3:1: theme-contrast)");
  // A row is one line (pr3-simplify): the roster's circle, the name, which gives way and ends in an ellipsis, then the
  // dot at the far right; the current row is told by style alone, its circle filled and its name in bold
  // (theme-contrast). The circle sits from the name as an instance's dot does (.ctx-inst's 9px).
  assert.deepEqual([u.style(".ws-option").display, u.style(".ws-option").gap], ["flex", "9px"]);
  assert.equal(u.style(".ws-option").gap, u.style(".ctx-inst").gap);
  assert.equal(u.style(".ws-waiting").marginLeft, "auto", "the dot at the row's far right");
  const name = u.style(".ws-option-name");
  assert.deepEqual([name.flexGrow, name.flexShrink, name.minWidth, name.overflow], ["0", "1", "0px", "hidden"]);
  assert.equal(u.style('.ws-option[aria-current="true"] .ws-option-name').fontWeight, "650");
  assert.notEqual(u.style('.ws-option:not([aria-current]) .ws-option-name').fontWeight, "650", "another row's name is not bold");
  assert.equal(shell.match(/\.ws-option-(?:meta|line|copy|section)\b|\.ws-check\b|\.ws-open-window\b|\.ws-option \.workspace-avatar/), null, "no mark, machine line, check or button rules");
  // The deployment mark (the roster's headings): the warning shape in --warn at the 12px icon size the filter uses, never the 16px default.
  assert.equal(u.style(".deployment-mark").color, "var(--warn)"); assert.equal(u.style(".deployment-mark").flexShrink, "0");
  assert.equal(u.style(".deployment-mark > .shell-icon").width, "12px");
  // Deployment headings: muted 11px capitals at 500, a step under the sections' headings (2026-10-23).
  const heading = u.style(".ctx-deployment");
  assert.deepEqual([heading.color, heading.fontSize, heading.fontWeight, heading.textTransform, heading.letterSpacing],
    ["var(--muted)", "11px", "500", "uppercase", "0.06em"]);
  assert.equal(u.get("#ws-deployments"), null);
});

test("nav/footer rhythm stays separate from the 48px roster rows", t => {
  const u = fixture(t);
  // The nav is at the bottom, in the footer (2026-10-23): Deployments and Workspace side by side, each from its
  // own label's width (the longer one is not squeezed to half), each label on one line.
  assert.deepEqual([u.style("#nav").display, u.style("#nav").flexDirection, u.style("#nav").flexShrink, u.style("#nav").gap], ["flex", "row", "0", "4px"]);
  const item = u.style("#nav .nav-item");
  // Read the shipped declaration, as JSDOM's CSSOM may drop or rewrite the shorthand.
  assert.match(shell.match(/^#nav \.nav-item \{([^}]*)\}/m)?.[1] ?? "", /(?:^|;)\s*flex:\s*1 1 auto\s*;/, "each from its label's width, sharing the rest, and may shrink");
  assert.equal(item.minWidth, "0px");
  assert.deepEqual([item.justifyContent, item.gap, item.padding, item.whiteSpace], ["center", "6px", "5px 6px", "nowrap"]);
  assert.equal(item.minHeight, "30px");
  const label = u.style("#nav .nav-item .label");
  assert.deepEqual([label.minWidth, label.overflow, label.textOverflow], ["0px", "hidden", "ellipsis"], "a label gives way, never wraps");
  assert.equal(u.style("#nav-foot").padding, "10px");
  assert.equal(u.style("#nav-foot").gap, "8px");
  assert.equal(u.rule("#nav-foot").borderTop, "1px solid var(--border)", "the footer keeps its one rule above it");
  assert.equal(u.style("#sidebar-tools").gap, "2px");
  // The tools: sidebar, theme, shortcuts, then Spawn instance, all the same small icon button.
  assert.equal(u.doc.querySelectorAll("#sidebar-tools .nav-item").length, 4);
  for (const button of u.doc.querySelectorAll("#sidebar-tools .nav-item")) {
    const style = u.doc.defaultView.getComputedStyle(button);
    assert.deepEqual([style.height, style.minHeight, style.flexGrow, style.padding, style.justifyContent], ["26px", "26px", "1", "0px", "center"], button.getAttribute("aria-label"));
  }
  assert.equal(shell.match(/#sidebar-spawn\b/), null, "Spawn instance has no styling of its own: it is one of the tools");
  assert.equal(u.style(".ctx-tree-row").minHeight, "48px");
  assert.equal(u.style(".ctx-inst").minHeight, "44px");
  assert.equal(u.style(".ctx-inst").height, "auto");
  assert.equal(u.style(".ctx-copy").gap, "3px");
  assert.equal(u.style(".ctx-list").overflowY, "auto");
});

for (const palette of ["light", "solarized", "dark"]) test(`${palette}: primary, danger, disabled and focus states keep their own semantic pairs`, t => {
  const u = fixture(t, palette);
  // Spawn instance is no longer a primary button (2026-10-23): it is a footer tool, painted like the others.
  for (const selector of ["#sidebar-tools .nav-item:first-child", "#sidebar-spawn"]) {
    assert.equal(u.style(selector).color, "var(--nav-fg)", selector);
    assert.notEqual(u.style(selector).background, "var(--primary-bg)", selector);
  }
  for (const selector of [".ws-dialog-foot .primary", ".oats-view .primary"]) {
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
  // Control rule 2 (control-rules.test.mjs has the full contract): one global 1px inset
  // accent edge plus the brand tint on keyboard focus; no per-component 2px rings remain.
  assert.equal(u.rule(":focus-visible").outline, "1px solid var(--accent)");
  assert.equal(u.rule(":focus-visible").outlineOffset, "-1px");
  assert.equal(u.rule(":is(button, a, summary):focus-visible").background, "var(--sel)");
  for (const selector of [".ws-option:focus-visible", ".ctx-instance-menu button:hover, .ctx-instance-menu button:focus-visible", "#tab-actions button:focus-visible"]) {
    assert.equal(u.rule(selector).background, "var(--sel)", selector);
    assert.equal(u.rule(selector).outline, "", selector);
  }
});

test("running indicators use accent, while success stays distinct", t => {
  const u = fixture(t);
  assert.equal(u.rule(".ctx-dot.on").background, "var(--accent)");
  assert.equal(u.rule(".palette-item .pdot.on").background, "var(--accent)");
  assert.equal(u.rule(".palette-item .pdot.on").borderColor, "var(--accent)");
  assert.equal(u.rule(".tab.active").boxShadow, "inset 0 2px 0 var(--accent)");
  assert.equal(u.rule(".ctx-tree-row.active").backgroundColor, "var(--sel)");
});

test("component geometry: rounded popovers, 36px fields and persistent scrollable groups", t => {
  const u = fixture(t);
  assert.equal(shell.match(/\.ws-menu\s*[,{]/), null, "no dropdown popover rule: the workspace list is always shown");
  for (const selector of [".ctx-instance-menu"]) {
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
  assert.equal(u.style(".tab").flexShrink, "1", "tabs shrink evenly (spec F)");
  assert.equal(u.style(".tab").minWidth, "var(--tab-min)", "down to a floor, then the strip scrolls");
  assert.equal(u.style(".tab .close").width, "20px");
  assert.equal(u.style(".tab .close").height, "20px");
  assert.equal(u.style("#tab-actions button").width, "28px");
  assert.equal(u.style("#tab-actions button").height, "28px");
  assert.equal(u.style(".group-cell.focused-group").outline, "1px solid var(--accent)");
  assert.equal(u.style(".split-empty").display, "flex", "empty panels remain visible");
  assert.notEqual(u.style(".ws-list").display, "none", "the workspace list has no hidden state");
  for (const selector of [".ws-modal", "#tab-actions"]) {
    assert.equal(u.style(selector).display, "none", `${selector} honors hidden`);
    u.get(selector).hidden = false;
    assert.notEqual(u.style(selector).display, "none", `${selector} can be revealed`);
  }
  assert.equal(u.style("#show-sidebar").display, "none", "Show sidebar honors hidden");
  u.get("#app").classList.add("sidebar-hidden"); u.get("#show-sidebar").hidden = false;
  assert.equal(u.style("#sidebar").display, "none");
  assert.equal(u.style("#show-sidebar").display, "grid", "the sidebar leaves no edge: Show sidebar sits in the top bar");
  assert.equal(u.style("#show-sidebar").position, "absolute");
});

test("shell component paints use tokens, not raw colors or text transparency", () => {
  const rules = shell.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\bopacity\s*:/i);
  assert.doesNotMatch(rules, /font:\s*[^;{}]+\s+inherit\s*;/, "control font shorthands must be valid CSS");
});


test("coordinated shell inset applies equally to selected and unselected rows; icons share one Lucide stroke", t => {
  const u = fixture(t);
  const row = u.get(".ctx-inst");
  assert.equal(u.style(".ctx-inst").paddingLeft, "10px");
  row.classList.remove("active");
  assert.equal(u.style(".ctx-inst").paddingLeft, "10px", "selection never shifts the content");
  assert.equal(u.style(".ctx-inst").paddingRight, "8px");
  for (const svg of u.doc.querySelectorAll("#tab-actions .shell-icon")) assert.equal(svg.getAttribute("stroke-width"), "2");
  assert.equal(u.style("#tab-actions .shell-icon").width, "16px");
  assert.equal(u.get("#nav .shell-icon").getAttribute("stroke-width"), "2", "navigation uses the same Lucide stroke");
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
