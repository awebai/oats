// Control rules (design v4.1, board 7; renderer/README.md "Control rules"): selection,
// focus and search fields in the shell chrome. In-memory CSSOM/cascade checks (jsdom
// matches :focus-visible on the focused element), plus effective-colour contrast in every
// theme. No Electron, network or workspace access.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { discoveryCSS } from "../renderer/workspace-discovery.mjs";
import { notificationCSS } from "../renderer/notifications.mjs";
import { lifecycleCSS } from "../renderer/lifecycle-dialog.mjs";
import { connectionsCSS } from "../renderer/connections.mjs";
import { readinessCSS } from "../renderer/readiness-view.mjs";
import { automationsCSS } from "../renderer/views/automations.mjs";
import { hierarchyCSS } from "../renderer/views/hierarchy.mjs";
import { setupCSS } from "../renderer/workspace-setup.mjs";
import { inspectorCSS } from "../renderer/soul-inspector.mjs";
import { soulTeamsHereCSS } from "../renderer/soul-teams-here.mjs";
import { instanceEventsCSS } from "../renderer/instance-events-view.mjs";
import { teamsCSS } from "../renderer/teams-panel.mjs";

const read = name => readFileSync(new URL(`../renderer/${name}`, import.meta.url), "utf8");
const theme = read("theme.css"), shell = read("shell.css");
// Every style source spec A owns: the two shell sheets, the shared segmented control and
// the shell-owned dialogs/toasts whose focus rules moved to the global one.
// Plus the view files whose focus/outline lines spec A converted (CSS lines only; the brain
// view keeps its sheet private, so its source is read). Sheets another spec owns are cut out.
const owned = { "theme.css": theme, "shell.css": shell, "workspace-discovery.mjs (spec A lines)": discoveryLines(),
  "notifications.mjs": notificationCSS, "lifecycle-dialog.mjs": lifecycleCSS, "connections.mjs": connectionsCSS, "readiness-view.mjs": readinessCSS,
  "views/automations.mjs": automationsCSS, "views/hierarchy.mjs": hierarchyCSS, "views/brain.mjs": brainStyles(), "workspace-setup.mjs": setupCSS,
  "soul-inspector.mjs": inspectorCSS.replace(teamsCSS, "") /* teams-panel.mjs is spec B's */, "soul-teams-here.mjs": soulTeamsHereCSS, "instance-events-view.mjs": instanceEventsCSS };
function discoveryLines() {
  return discoveryCSS.split("\n").filter(line => /\.ws-segmented|\.workspace-tabs button|\.ws-search/.test(line)).join("\n");
}
function brainStyles() {
  const source = read("views/brain.mjs"), start = source.indexOf("const CSS = `");
  assert.ok(start >= 0, "brain view CSS");
  return source.slice(start, source.indexOf("`;", start));
}

const markup = `<div id="app"><aside id="sidebar">
  <div class="side-head"><button id="ws-trigger" type="button">Workspace</button></div>
  <div class="ws-menu"><input id="ws-menu-search" type="search"><div class="ws-options">
    <button class="ws-option" aria-selected="false">One</button></div>
    <button class="ws-add-open" type="button">Add</button></div>
  <nav id="nav"><button class="nav-item">Workspace</button><button class="nav-item active">Active</button></nav>
  <section id="instance-roster">
    <label class="ctx-filter-field"><span class="ctx-filter-icon"></span><input class="ctx-filter" placeholder="Filter instances"><kbd class="shortcut-hint" hidden></kbd></label>
    <div class="ctx-list"><div class="ctx-tree-row"><button class="ctx-inst">Row</button>
      <span class="ctx-row-tools"><button class="ctx-instance-actions">…</button></span></div></div></section>
  <div id="nav-foot"><button id="sidebar-spawn" class="primary">Spawn</button>
    <div id="sidebar-tools"><button id="sidebar-toggle" class="nav-item">S</button></div></div></aside>
  <main id="main"><div id="tabstrip"><div id="tabbar-row"><div id="tabbar">
    <div class="tab active"><button class="tab-trigger">Tab</button><button class="close">×</button></div>
  </div><div id="tab-actions"><button id="split-right">▥</button></div></div></div>
  <div id="tabhost" class="split-row"><div class="group-cell focused-group"><button class="split-empty">Empty</button></div></div></main></div>
  <div class="ws-modal"><section class="ws-dialog"><input id="ws-suggestion-search" type="search">
    <div class="ws-suggestions"><button class="ws-suggestion" aria-checked="false">Suggestion</button></div>
    <footer class="ws-dialog-foot"><button class="secondary">Cancel</button><button class="primary">Add workspace</button></footer></section></div>
  <div class="palette-overlay"><div class="palette"><input class="palette-input"></div></div>
  <div class="kb-editor"><button class="kb-chord">⌘K</button><button class="kb-close">Close</button></div>
  <div class="oats-view"><div class="ws-segmented" role="group" aria-label="Setup view">
      <button type="button" aria-pressed="true">List</button><button type="button" aria-pressed="false">Graph</button></div>
    <button class="act">Secondary</button><button class="act primary">Primary</button><button class="act danger">Danger</button><input class="field"></div>
  <div class="app-notifications"><div class="app-toast"><button class="app-toast-dismiss">×</button></div></div>
  <div class="lifecycle-dialog" data-operation="retire"><button class="lifecycle-close">Close</button><button class="lifecycle-confirm">Remove</button></div>
  <div class="ctx-instance-menu"><button data-action="open">Open</button></div>`;

function fixture(t, palette = "light") {
  const dom = new JSDOM(`<!doctype html><html data-theme="${palette}"><head></head><body>${markup}</body></html>`);
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  for (const css of [theme, shell, discoveryCSS, notificationCSS, lifecycleCSS]) {
    const style = doc.createElement("style"); style.textContent = css; doc.head.append(style);
  }
  const rules = [...doc.styleSheets].flatMap(sheet => [...sheet.cssRules]);
  const rule = selector => {
    const matches = rules.filter(rule => rule.selectorText?.replace(/\s+/g, " ") === selector);
    assert.equal(matches.length, 1, `one shipped rule: ${selector}`);
    return matches[0].style;
  };
  const get = selector => { const el = doc.querySelector(selector); assert.ok(el, selector); return el; };
  const style = selector => dom.window.getComputedStyle(get(selector));
  // Keyboard focus in jsdom: its :focus-visible heuristic (dom-selector) needs a modifier-free
  // keydown on the focused element, and its computed-style cache only refreshes on a mutation.
  const focused = selector => {
    const el = get(selector); el.focus();
    assert.equal(doc.activeElement, el, `${selector} takes focus`);
    el.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    el.setAttribute("data-focus-probe", ""); el.removeAttribute("data-focus-probe");
    assert.ok(el.matches(":focus-visible"), `${selector} matches :focus-visible`);
    return dom.window.getComputedStyle(el);
  };
  const root = dom.window.getComputedStyle(doc.documentElement);
  const token = name => root.getPropertyValue(`--${name}`).trim();
  return { doc, rules, rule, get, style, focused, token };
}

function channels(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `opaque hex: ${hex}`);
  return hex.slice(1).match(/../g).map(value => parseInt(value, 16));
}
function luminance(rgb) {
  const c = rgb.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const la = luminance(channels(a)), lb = luminance(channels(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ── rule 1: selected state = brand tint ──
test("segmented control: selected segment is --sel/--accent at 650, unselected is transparent --muted", t => {
  const u = fixture(t);
  const on = u.style(".ws-segmented [aria-pressed=true]"), off = u.style(".ws-segmented [aria-pressed=false]");
  assert.equal(on.background, "var(--sel)"); assert.equal(on.color, "var(--accent)"); assert.equal(on.fontWeight, "650");
  assert.match(off.background, /^(transparent|rgba\(0, 0, 0, 0\))$/); assert.equal(off.color, "var(--muted)");
  for (const state of [on, off]) { assert.equal(state.borderWidth, "0px"); assert.equal(state.borderRadius, "6px"); }
  const group = u.rule(".ws-segmented");
  assert.equal(group.border, "1px solid var(--border)", "one outer frame");
  assert.equal(group.padding, "2px", "2px inner padding");
  assert.equal(group.background, "var(--surface)");
  assert.equal(group.overflow, "", "segments are not clipped by the frame; they are inset");
  // No dividers: a sibling rule may only clear a border (e.g. border-left:0), never paint one.
  const dividers = u.rules.filter(r => /\.ws-segmented button \+ button/.test(r.selectorText || ""))
    .filter(r => [r.style.borderLeft, r.style.borderLeftWidth, r.style.borderLeftStyle].some(v => v && !/^(0(px)?|none)( |$)/.test(v)));
  assert.deepEqual(dividers.map(r => r.selectorText), [], "no dividers between segments");
  assert.equal(u.rule(".oats-view .ws-segmented button:focus-visible").background, "var(--sel)", "keyboard focus tints an unselected segment");
});

// ── rule 2: no ring on pointer interaction; tint + 1px accent edge on keyboard focus ──
test("focus: one global 1px inset accent edge and tint replace every 2px ring and :focus visual", t => {
  const u = fixture(t);
  const global = u.rule(":focus-visible");
  assert.equal(global.outline, "1px solid var(--accent)"); assert.equal(global.outlineOffset, "-1px");
  assert.equal(u.rule(":is(button, a, summary):focus-visible").background, "var(--sel)");
  for (const [name, css] of Object.entries(owned)) {
    assert.doesNotMatch(css, /outline:\s*2px/, `${name}: no 2px focus ring`);
    // Selectors that style :focus (not :focus-visible / :focus-within) paint on mouse click.
    const selectors = [...css.matchAll(/^[^{}/]*\{/gm)].map(m => m[0]).filter(s => /:focus(?!-visible|-within)/.test(s));
    assert.deepEqual(selectors, [], `${name}: visuals hang off :focus-visible, never :focus`);
  }
  assert.equal(u.rule(".ctx-instance-actions:hover").background, "var(--surface-2)");
  assert.equal(u.rule(".ctx-instance-actions:focus-visible").background, "var(--sel)",
    "the menu trigger, refocused when its menu closes after a click, styles :focus-visible only, with the tint");
});

test("focus: keyboard focus on plain shell controls paints the tint and the edge", t => {
  const u = fixture(t);
  for (const selector of ["#ws-trigger", ".ws-option", ".ws-add-open", ".nav-item:not(.active)", ".ctx-inst", ".tab-trigger", ".tab .close",
    "#tab-actions button", ".ws-suggestion", ".ws-dialog-foot .secondary", ".kb-chord", ".kb-close", ".ws-segmented [aria-pressed=false]",
    ".ctx-instance-menu button", ".ctx-instance-actions", ".lifecycle-close", ".oats-view .act:not(.primary):not(.danger)"]) {
    const s = u.focused(selector);
    assert.equal(s.background, "var(--sel)", `${selector} tint`);
    assert.equal(s.outline, "1px solid var(--accent)", `${selector} edge`);
    assert.equal(s.outlineOffset, "-1px", `${selector} inset edge`);
  }
});

test("focus: controls with their own opaque pair keep it and show the edge only", t => {
  const u = fixture(t);
  for (const [selector, bg, fg, edge = "accent"] of [["#sidebar-spawn", "primary-bg", "primary-fg"], [".ws-dialog-foot .primary", "primary-bg", "primary-fg"],
    [".oats-view .act.primary", "primary-bg", "primary-fg"], [".lifecycle-confirm", "danger", "primary-fg"],
    [".app-toast-dismiss", "primary-fg", "primary-bg", "primary-fg"] /* toast buttons invert inside the dark toast, edge in its ink */]) {
    const s = u.focused(selector);
    assert.equal(s.background, `var(--${bg})`, `${selector} background`);
    assert.equal(s.color, `var(--${fg})`, `${selector} colour`);
    assert.equal(s.outline, `1px solid var(--${edge})`, `${selector} edge`);
    // On its own opaque fill the edge would be invisible (accent on --primary-bg/--danger < 3:1), so
    // it sits 1px outside, on the surrounding surface (theme-contrast.test.mjs checks those pairs).
    assert.equal(s.outlineOffset, "1px", `${selector} edge sits outside its own fill`);
  }
  assert.equal(u.focused(".oats-view .act.danger").outlineOffset, "-1px", "danger ink on --surface keeps the inset edge");
  assert.equal(u.focused(".split-empty").background, "var(--term-bg)", "an empty pane never tints as a whole");
  assert.equal(u.focused(".oats-view .act.danger").background, "var(--surface)", "danger ink is not AA on the dark tint: edge only");
  assert.equal(u.focused(".oats-view .act.danger").color, "var(--danger)");
});

// ── rule 3: search and filter fields have one border ──
test("search fields: the wrapper or the field's own border is the only frame; the input never outlines", t => {
  const u = fixture(t);
  const wrapper = u.rule(".ctx-filter-field"), focusWithin = u.rule(".ctx-filter-field:focus-within");
  assert.equal(wrapper.border, "1px solid var(--border)"); assert.equal(focusWithin.borderColor, "var(--accent)");
  const idle = u.style(".ctx-filter");
  assert.equal(idle.outline, "none"); assert.equal(idle.borderWidth, "0px");
  const filter = u.focused(".ctx-filter");
  assert.equal(filter.outline, "none", "focused filter input draws no inner ring (board 7 Before)");
  assert.equal(filter.borderWidth, "0px");
  assert.equal(filter.background, "var(--bg)");
  assert.equal(u.rule("#ws-menu-search, #ws-suggestion-search").border, "1px solid var(--border)", "bare search inputs: own 1px frame");
  assert.equal(u.rule("#ws-menu-search, #ws-suggestion-search").outline, "none");
  // jsdom does not resolve var() in computed border colours: focus frames are read from the declared rules.
  assert.equal(u.rule("#ws-menu-search:focus-visible, #ws-suggestion-search:focus-visible").borderColor, "var(--accent)");
  for (const selector of ["#ws-menu-search", "#ws-suggestion-search", ".oats-view input.field", ".palette-input"]) {
    assert.equal(u.focused(selector).outline, "none", `${selector} draws no outline when focused`);
  }
  const fieldRule = u.rule(".oats-view input.field:focus-visible, .oats-view textarea.field:focus-visible, .oats-view select.field:focus-visible");
  assert.equal(fieldRule.outline, "none"); assert.equal(fieldRule.borderColor, "var(--accent)");
  const inputRule = u.rule(":is(input:not([type=\"checkbox\"]):not([type=\"radio\"]), textarea, select):focus-visible");
  assert.equal(inputRule.outline, "none"); assert.equal(inputRule.borderColor, "var(--accent)", "the palette input's bottom rule turns accent through this rule");
  assert.equal(u.rule(".palette-input").borderBottom, "1px solid var(--border)", "the palette input's only frame is its bottom rule");
});

// ── done-when 7: effective colours in every theme ──
for (const palette of ["light", "solarized", "dark"]) test(`${palette}: selected-segment text, focus tint and focused-field border meet WCAG on effective colours`, t => {
  const u = fixture(t, palette);
  const sel = u.token("sel"), accent = u.token("accent"), surface = u.token("surface"), bg = u.token("bg");
  assert.ok(contrast(accent, sel) >= 4.5, `${palette}: selected segment --accent on --sel ${contrast(accent, sel).toFixed(2)}:1`);
  for (const fg of ["fg", "muted", "nav-fg"]) assert.ok(contrast(u.token(fg), sel) >= 4.5, `${palette}: keyboard-focus tint keeps --${fg} readable`);
  // The 1px accent edge and the focused field border are non-text UI (WCAG 1.4.11, 3:1) against
  // the surfaces they sit on, including the tint it borders.
  for (const [name, on] of [["surface", surface], ["bg", bg], ["sel", sel]]) {
    assert.ok(contrast(accent, on) >= 3, `${palette}: --accent edge on --${name} ${contrast(accent, on).toFixed(2)}:1`);
  }
  assert.equal(u.style(".ws-segmented [aria-pressed=true]").color, "var(--accent)");
  assert.equal(u.rule(".ctx-filter-field:focus-within").borderColor, "var(--accent)");
});

test("view search fields and tab strips follow rules 2 and 3 (Capabilities search, Automations search, workspace tabs)", () => {
  const find = (css, selector) => {
    const hit = css.split("\n").find(line => line.startsWith(`${selector} {`));
    assert.ok(hit, `rule: ${selector}`); return hit;
  };
  assert.match(find(discoveryCSS, ".oats-view .ws-search:focus-within input.field"), /border-color:var\(--accent\); outline:none;/);
  assert.match(find(discoveryCSS, ".oats-view .ws-search input.field"), /border:1px solid var\(--border\)/, "the input's own border is the one frame");
  assert.match(find(automationsCSS, ".auto-search:focus-within"), /\{ border-color:var\(--accent\); \}/, "the wrapper frame turns accent, no ring");
  assert.match(find(automationsCSS, ".oats-view .auto-search input"), /border:0;.*outline:none;/);
  assert.match(find(discoveryCSS, ".workspace-tabs button:focus-visible"), /background:var\(--sel\)/);
  assert.match(find(automationsCSS, ".oats-view .auto-tabs button:focus-visible"), /background:var\(--sel\)/);
  assert.match(find(hierarchyCSS, ".hier-canvas:focus-visible"), /outline: 1px solid var\(--accent\); outline-offset: -1px;/,
    "the canvas clears its outline in its base rule, so it restates the edge for keyboard focus");
});
