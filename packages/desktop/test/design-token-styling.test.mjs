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
    <li class="ws-option-row"><button class="ws-option" aria-current="true"><span class="ctx-dot on" aria-hidden="true"></span><span class="ws-option-name">fixture</span><span class="sr-only">, needs input</span><span class="ws-waiting attn-mark" aria-hidden="true"></span></button></li>
    <li class="ws-option-row"><button class="ws-option"><span class="ws-option-name">other</span></button></li>
  </ul></div></section>
  <section id="ws-current" class="ws-current" aria-label="Current workspace"><nav id="nav"><button class="nav-item active"><span class="icon">${icon}</span><span class="label">Deployments</span></button><button class="nav-item"><span class="icon">${icon}</span><span class="label">Workspace</span></button></nav>
  <section id="instance-roster"><div class="ctx-head roster-head"><span>Instances</span><span class="ctx-count">● 1 running</span><button id="sidebar-spawn" class="ws-add-open ctx-head-add icon-button" type="button" aria-label="Spawn instance">${icon}</button></div>
    <div class="ctx-list"><div class="ctx-deployment" role="heading" aria-level="3"><span class="ctx-deployment-label">altair</span><span class="deployment-mark" role="img" aria-label="remembered">${icon}</span></div><div class="ctx-tree-row"><button class="ctx-inst active"><span class="ctx-dot on"></span>
      <span class="ctx-copy"><span class="ctx-name">Fixture instance</span><span class="ctx-repo-label">fixture</span></span>
      <span class="runtime-badge ctx-runtime" data-runtime="claude">C</span>
    </button></div></div></section></section>
  <div id="nav-foot" role="group" aria-label="Sidebar tools"><span class="sidebar-brand" aria-hidden="true"><img class="sidebar-brand-image" width="20" height="20" alt=""></span><button id="sidebar-toggle" class="ws-add-open icon-button" type="button" aria-label="Hide the sidebar">${icon}</button>
    <button id="sidebar-settings" class="ws-add-open sidebar-settings icon-button" type="button" aria-label="Settings">${icon}</button>
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
  // JSDOM's computed style lets a later shorthand (.ctx-head's padding) override an earlier longhand of a higher
  // specificity (.ctx-head.ws-head's padding-left), which Chromium never does: `cascaded` reads one longhand the way
  // the cascade does, from the top-level rules matching the element, by specificity, then source order.
  const specificity = part => {
    const plain = part.replace(/::?(?:before|after)\b/g, "").replace(/:where\([^)]*\)/g, "");
    return [(plain.match(/#[\w-]+/g) || []).length,
      (plain.match(/\.[\w-]+|\[[^\]]+\]|:(?!is\(|not\(|where\()[\w-]+/g) || []).length,
      (plain.replace(/\[[^\]]+\]|\([^)]*\)/g, "").match(/(?:^|[\s>+~(])[a-z][\w-]*/gi) || []).length];
  };
  const cascaded = (selector, property) => {
    const el = doc.querySelector(selector); assert.ok(el, selector);
    let best = null;
    rules.forEach((r, order) => {
      const value = r.selectorText && r.style?.getPropertyValue(property);
      if (!value) return;
      const parts = r.selectorText.split(/,(?![^(]*\))/).map(part => part.trim()).filter(part => { try { return el.matches(part); } catch { return false; } });
      if (!parts.length) return;
      const spec = parts.map(specificity).sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0];
      const wins = !best || spec[0] - best.spec[0] || spec[1] - best.spec[1] || spec[2] - best.spec[2] || 1;
      if (wins > 0) best = { spec, value, order };
    });
    return best?.value ?? "";
  };
  return { doc, rule, cascaded, get: selector => doc.querySelector(selector),
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
  for (const prop of ["height", "paddingTop", "paddingRight", "paddingBottom", "display", "alignItems", "gap", "color", "fontSize", "fontWeight"]) {
    assert.equal(wsHead[prop], rosterHead[prop], `the two heads share ${prop}`);
  }
  // Their left edge too: both headings' text 17px in (no cog before Workspaces since it moved to the foot).
  assert.deepEqual([u.cascaded(".roster-head", "padding-left"), u.cascaded(".ws-head", "padding-left")], ["17px", "17px"]);
  assert.equal(shell.match(/\.ws-head\s*\{|\.ws-head > \.sidebar-settings|\.ctx-head\.ws-head/), null, "no rule moves the Workspaces heading");
  // The two headings are the sidebar's top level (2026-10-23): the nav items' 13px at 650 in --fg, on one line, the row's 36px kept.
  assert.deepEqual([wsHead.height, wsHead.color, wsHead.fontSize, wsHead.fontWeight, wsHead.whiteSpace], ["36px", "var(--fg)", "13px", "650", "nowrap"]);
  assert.equal(u.style("#ws-add-open").marginLeft, "auto", "Add local workspace… at the head's right end");
  assert.deepEqual([u.style("#ws-add-open").width, u.style("#ws-add-open").height, u.style("#ws-add-open").flexShrink], ["28px", "28px", "0"]);
  for (const id of ["#ws-add-open", "#sidebar-spawn", "#sidebar-toggle", "#sidebar-settings"]) {
    assert.equal(u.style(id).display, "grid", id);
    assert.equal(u.style(id).color, "var(--muted)", id);
  }
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
  // One line, under the list and over the current workspace's section (2026-10-23): the section's ::before, a 1px
  // --border rule across the sidebar's full width, so it runs over the views; none before Instances, and no border
  // of the list's, the section's or the roster's own.
  for (const prop of ["border", "borderBottom", "borderBottomWidth", "borderBottomStyle"]) assert.equal(u.rule(".ws-list")[prop], "", `.ws-list ${prop}`);
  for (const selector of [".ws-current", "#instance-roster"]) {
    for (const prop of ["border", "borderTop", "borderTopWidth", "borderTopStyle"]) assert.equal(u.rule(selector)[prop], "", `${selector} ${prop}`);
  }
  const line = u.rule(".ws-current::before");
  // JSDOM drops a var() border's longhands: the shorthand's text is pinned.
  assert.deepEqual([line.content, line.flexShrink, line.margin, line.getPropertyValue("border-top")], ['""', "0", "", "1px solid var(--border)"]);
  assert.equal(shell.match(/#instance-roster::before|#instance-roster::after|#nav::before|#nav::after/), null, "no line before Instances, none of the views' own");
  const current = u.style(".ws-current");
  assert.deepEqual([current.display, current.flexDirection, current.flexGrow, current.minHeight], ["flex", "column", "1", "0px"], "it takes the sidebar's rest, the roster scrolling inside it");
  assert.deepEqual([...u.get("#ws-current").children].map(el => el.id), ["nav", "instance-roster"]);
  assert.equal(u.rule(".ws-list").paddingTop, "0px", "the list starts right under its heading");
  assert.equal(u.style(".ws-options").maxHeight, "276px");
  assert.equal(u.style(".ws-options").overflowY, "auto");
  assert.equal(u.style(".ws-option").alignItems, "center");
  assert.equal(u.style(".ws-option").padding, "6px 8px 6px 10px", "its circle in the column of the roster's top-level dots");
  // The needs-input mark (2026-10-23): the drawn "!" badge (its size from the switcher, its colours and 3:1 in
  // theme-contrast), a block graphic that never shrinks, with no stroke of its own.
  const dot = u.style(".ws-waiting");
  assert.deepEqual([dot.display, dot.flexShrink, u.rule(".attn-mark").getPropertyValue("stroke")], ["block", "0", "none"]);
  // A row is one line (pr3-simplify): the roster's circle, the name, which gives way and ends in an ellipsis, then the
  // dot at the far right; the current row is told by style alone, its circle filled and its name in bold
  // (theme-contrast). The circle sits from the name as an instance's dot does (.ctx-inst's 9px).
  assert.deepEqual([u.style(".ws-option").display, u.style(".ws-option").gap], ["flex", "9px"]);
  assert.equal(u.style(".ws-option").gap, u.style(".ctx-inst").gap);
  assert.equal(u.style(".ws-waiting").marginLeft, "auto", "the dot at the row's far right");
  const name = u.style(".ws-option-name");
  assert.deepEqual([name.flexGrow, name.flexShrink, name.minWidth, name.overflow], ["0", "1", "0px", "hidden"]);
  // A bit more prominent than the body text (2026-10-23): 14px at 500, the current one at 650.
  assert.deepEqual([u.rule(".ws-option-name").fontSize, u.rule(".ws-option-name").fontWeight], ["14px", "500"]);
  assert.equal(u.style('.ws-option:not([aria-current]) .ws-option-name').fontSize, "14px");
  assert.equal(u.style('.ws-option:not([aria-current]) .ws-option-name').fontWeight, "500");
  assert.equal(u.style('.ws-option[aria-current="true"] .ws-option-name').fontWeight, "650");
  assert.notEqual(u.style('.ws-option:not([aria-current]) .ws-option-name').fontWeight, "650", "another row's name is not bold");
  assert.equal(shell.match(/\.ws-option-(?:meta|line|copy|section)\b|\.ws-check\b|\.ws-open-window\b|\.ws-option \.workspace-avatar/), null, "no mark, machine line, check or button rules");
  // The deployment mark (the roster's headings): the warning shape in --warn at the 12px icon size the filter uses, never the 16px default.
  assert.equal(u.style(".deployment-mark").color, "var(--warn)"); assert.equal(u.style(".deployment-mark").flexShrink, "0");
  assert.equal(u.style(".deployment-mark > .shell-icon").width, "12px");
  // Deployment headings: muted 12px capitals at 400, a step under the sections' headings (2026-10-23).
  const heading = u.style(".ctx-deployment");
  assert.deepEqual([heading.color, heading.fontSize, heading.fontWeight, heading.textTransform, heading.letterSpacing],
    ["var(--muted)", "12px", "400", "uppercase", "0.06em"]);
  assert.equal(u.get("#ws-deployments"), null);
});

test("nav and foot rhythm stays separate from the 48px roster rows", t => {
  const u = fixture(t);
  // The views sit under the list of workspaces (2026-10-23): Workspace and Deployments side by side, each from its
  // own label's width (the longer one is not squeezed to half), each label on one line, with no title.
  assert.deepEqual([u.style("#nav").display, u.style("#nav").flexDirection, u.style("#nav").flexShrink, u.style("#nav").gap], ["flex", "row", "0", "4px"]);
  assert.equal(u.get("#nav").parentElement, u.get("#ws-current")); assert.equal(u.get("#ws-current").previousElementSibling, u.get("#ws-list"));
  assert.equal(u.get("#nav").previousElementSibling, null, "first in the section, under its line");
  assert.equal(u.get("#nav").nextElementSibling, u.get("#instance-roster"));
  // On the list's 8px sides, 8px under the line (the section's ::before) and 8px before the Instances heading.
  const nav = u.style("#nav");
  assert.deepEqual([nav.marginTop, nav.marginRight, nav.marginBottom, nav.marginLeft], ["8px", "8px", "8px", "8px"]);
  assert.equal(u.cascaded("#nav", "margin-top"), "8px", "the section's rule wins the cascade, as in Chromium");
  assert.deepEqual([u.style(".ws-list").paddingLeft, u.style(".ws-list").paddingRight], [nav.marginLeft, nav.marginRight], "the list's sides");
  // Its width, which the container query's cutoff is set against (shell-design pins the cutoff): the 264px
  // sidebar less its 1px right border and the 8px sides, 247px.
  // JSDOM drops a var() border's longhands: the 1px is read from the rule's text.
  const edge = Number(shell.match(/^#sidebar \{[^}]*border-right: (\d+)px solid var\(--border\);/m)?.[1]);
  assert.equal(u.style("#sidebar").width, "264px");
  assert.equal(264 - edge - parseFloat(nav.marginLeft) - parseFloat(nav.marginRight), 247);
  assert.match(shell, /the 264px sidebar's nav is 247px/, "the CSS comment says the same");
  const item = u.style("#nav .nav-item");
  // Read the shipped declaration, as JSDOM's CSSOM may drop or rewrite the shorthand.
  assert.match(shell.match(/^#nav \.nav-item \{([^}]*)\}/m)?.[1] ?? "", /(?:^|;)\s*flex:\s*1 1 auto\s*;/, "each from its label's width, sharing the rest, and may shrink");
  assert.equal(item.minWidth, "0px");
  assert.deepEqual([item.justifyContent, item.gap, item.padding, item.whiteSpace], ["center", "6px", "3px 6px", "nowrap"]);
  assert.equal(item.minHeight, "26px", "compact (2026-10-23; was 30px)");
  const label = u.style("#nav .nav-item .label");
  assert.deepEqual([label.minWidth, label.overflow, label.textOverflow], ["0px", "hidden", "ellipsis"], "a label gives way, never wraps");
  assert.deepEqual([u.rule("#nav .shell-icon").width, u.rule("#nav .shell-icon").height, u.rule("#nav .nav-item .icon").width], ["14px", "14px", "14px"], "its icons 14px");
  for (const selector of ["#nav .nav-item .icon", "#nav-foot .shell-icon"]) assert.equal(u.style(selector).width, "14px", selector);
  assert.equal(shell.match(/\.nav-title|#nav-title/), null, "no title over the views: no rule left for it");
  // The foot (2026-10-23): the OATS mark at the left, the sidebar toggle and the settings cog together at the
  // right, 24px boxes with 14px icons, under the --border line.
  const foot = u.style("#nav-foot");
  assert.deepEqual([foot.display, foot.alignItems, foot.gap, foot.flexShrink, foot.marginTop], ["flex", "center", "2px", "0", "auto"]);
  assert.deepEqual([foot.paddingTop, foot.paddingRight, foot.paddingBottom, foot.paddingLeft], ["4px", "13px", "4px", "12px"]);
  assert.equal(u.rule("#nav-foot").borderTop, "1px solid var(--border)", "the foot keeps its one rule above it");
  assert.deepEqual([...u.get("#nav-foot").children].map(el => el.id || el.className), ["sidebar-brand", "sidebar-toggle", "sidebar-settings"]);
  for (const id of ["#sidebar-toggle", "#sidebar-settings"]) {
    const button = u.style(id);
    assert.deepEqual([button.width, button.height, button.display, button.position], ["24px", "24px", "grid", "relative"], id);
    assert.equal(u.doc.defaultView.getComputedStyle(u.get(`${id} .shell-icon`)).width, "14px", `${id}: a 14px icon`);
  }
  // The tools row went (2026-10-23): no rule is left for it, nor for the old foot buttons by id.
  assert.equal(shell.match(/#sidebar-(?:tools|toggle|theme|shortcuts)\b/), null, "no rule left for the tools row or its buttons");
  // Spawn instance is the Instances heading's + now: the headings' icon button (.ws-add-open), with no styling of
  // its own but its place (last, after the count and "Refreshing…", which loading.mjs appends to the heading).
  assert.equal(shell.match(/#sidebar-spawn\b/), null, "Spawn instance has no styling of its own: it is the headings' +");
  const spawn = u.style("#sidebar-spawn");
  assert.deepEqual([spawn.width, spawn.height, spawn.display, spawn.color], ["28px", "28px", "grid", "var(--muted)"]);
  assert.equal(u.rule(".ctx-head > .ctx-head-add").order, "1", "last in its heading, whatever is appended after it");
  assert.equal(u.style(".ctx-count").marginLeft, "auto", "the count and the + at the heading's right end");
  assert.equal(u.style(".ctx-tree-row").minHeight, "48px");
  assert.equal(u.style(".ctx-inst").minHeight, "44px");
  assert.equal(u.style(".ctx-inst").height, "auto");
  assert.equal(u.style(".ctx-copy").gap, "3px");
  assert.equal(u.style(".ctx-list").overflowY, "auto");
});

// The right-hand column (2026-10-23): the headings' + (Add local workspace…, Spawn instance), the workspace rows'
// needs-input mark and the instance rows' harness mark all centre 25px in from the sidebar's right edge. Each centre
// is computed from the shipped rules (JSDOM has no layout): the box's offset from the right edge plus half its width.
test("the right-hand column: the headings' +, the workspace rows' needs-input mark and the instance rows' harness mark centre 25px from the sidebar's right edge", t => {
  const u = fixture(t), px = value => { assert.match(value, /^-?\d+(\.\d+)?px$/, value); return parseFloat(value); };
  // The rules each centre is made of.
  assert.equal(u.style(".ctx-head").paddingRight, "11px", "the headings' right padding (was 12px)");
  assert.equal(u.style(".roster-head").paddingRight, "11px");
  assert.equal(u.style(".ws-waiting").marginRight, "2px");
  assert.equal(u.style(".ws-option").paddingRight, "8px");
  for (const selector of [".ws-list", ".ctx-list"]) assert.deepEqual([u.style(selector).paddingLeft, u.style(selector).paddingRight], ["8px", "8px"], selector);
  assert.equal(u.style(".ctx-inst").paddingRight, "8px");
  assert.deepEqual([u.style(".ctx-runtime").width, u.style(".ctx-runtime").height], ["18px", "18px"]);
  for (const id of ["#ws-add-open", "#sidebar-spawn"]) assert.deepEqual([u.style(id).width, u.style(id).height], ["28px", "28px"], id);
  // The needs-input mark's size is the switcher's (an svg's width attribute, not a rule): 14px, on a row and on "N more below".
  const switcher = read("workspace-switcher.mjs");
  const sizes = [...switcher.matchAll(/iconElement\(document, "attention", \{ size: (\d+), className: "ws-waiting attn-mark" \}\)/g)].map(m => Number(m[1]));
  assert.deepEqual(sizes, [14, 14], "the mark is 14px wherever the switcher draws it");
  // Each is the last thing on its line: the + after the count, the mark after the name, the badge after the copy.
  assert.equal(u.get(".roster-head").lastElementChild, u.get("#sidebar-spawn"));
  assert.equal(u.get(".ws-head").lastElementChild, u.get("#ws-add-open"));
  assert.equal(u.get(".ws-option .ws-waiting").nextElementSibling, null);
  assert.equal(u.get(".ctx-inst .ctx-runtime").nextElementSibling, null);
  assert.equal(u.style(".ws-waiting").marginLeft, "auto"); assert.equal(u.style(".ctx-copy").flexGrow, "1");
  // The arithmetic: the + 11 + 14, the mark 8 + 8 + 2 + 7, the harness 8 + 8 + 9.
  const plus = px(u.style(".ctx-head").paddingRight) + px(u.style("#sidebar-spawn").width) / 2;
  const addPlus = px(u.style(".ws-head").paddingRight) + px(u.style("#ws-add-open").width) / 2;
  const mark = px(u.style(".ws-list").paddingRight) + px(u.style(".ws-option").paddingRight) + px(u.style(".ws-waiting").marginRight) + sizes[0] / 2;
  const harness = px(u.style(".ctx-list").paddingRight) + px(u.style(".ctx-inst").paddingRight) + px(u.style(".ctx-runtime").width) / 2;
  assert.deepEqual({ plus, addPlus, mark, harness }, { plus: 25, addPlus: 25, mark: 25, harness: 25 }, "one column, 25px in");
  // The lists hide their scrollbars (the roster's, and the workspace list's since this layout), so a long list never
  // takes width from its rows and moves their marks off the column.
  assert.match(shell, /^\.ws-options \{[^}]*scrollbar-width: none;/m, "the workspace list: no scrollbar");
  assert.match(shell, /^\.ws-options::-webkit-scrollbar \{ display: none; \}/m, "nor Chromium's");
  assert.match(shell, /^\.ctx-list \{ scrollbar-width: none; \}/m, "as the roster's");
});

// The foot (2026-10-23): [mark] … [toggle][cog]. The OATS mark's centre on the workspace rows' circles (22px in from
// the left), the settings cog's in the right-hand column (25px in from the right, as the headings' +), the sidebar
// toggle 2px left of the cog, all computed from the rules.
test("the foot: the OATS mark on the rows' circles (22px in), the cog in the right-hand column (25px from the right), the toggle 2px before it", t => {
  const u = fixture(t), px = value => { assert.match(value, /^-?\d+(\.\d+)?px$/, value); return parseFloat(value); };
  const foot = u.style("#nav-foot"), brand = u.style(".sidebar-brand"), image = u.style(".sidebar-brand-image");
  const toggle = u.style("#sidebar-toggle"), cog = u.style("#sidebar-settings");
  assert.deepEqual([...u.get("#nav-foot").children].map(el => el.id || el.className), ["sidebar-brand", "sidebar-toggle", "sidebar-settings"]);
  // The mark: 20px, its image too (the 48px artwork at 2x and more), pushed left by its auto margin.
  assert.deepEqual([brand.width, brand.height, brand.flexShrink, brand.marginRight], ["20px", "20px", "0", "auto"]);
  assert.deepEqual([image.width, image.height, image.display], ["20px", "20px", "block"]);
  for (const button of [toggle, cog]) assert.deepEqual([button.width, button.height], ["24px", "24px"]);
  for (const id of ["#sidebar-toggle", "#sidebar-settings"]) assert.equal(u.doc.defaultView.getComputedStyle(u.get(`${id} .shell-icon`)).width, "14px", `${id}: a 14px icon`);
  // From the left: the foot's 12px and half the mark's 20px. From the right: the foot's 13px and half the cog's
  // 24px; the toggle another 24px and the 2px gap further.
  const markCentre = px(foot.paddingLeft) + px(brand.width) / 2;
  const cogCentre = px(foot.paddingRight) + px(cog.width) / 2;
  const toggleCentre = px(foot.paddingRight) + px(cog.width) + px(foot.gap) + px(toggle.width) / 2;
  // A workspace row's circle: the list's 8px, the row's 10px, half the 8px circle.
  const row = u.style(".ws-option"), circle = u.style(".ws-option .ctx-dot");
  const rowCircle = px(u.style(".ws-list").paddingLeft) + px(row.paddingLeft) + px(circle.width) / 2;
  // The right-hand column: the headings' + (the .ctx-head's 11px and half its 28px).
  const plus = px(u.style(".ctx-head").paddingRight) + px(u.style("#sidebar-spawn").width) / 2;
  assert.deepEqual({ markCentre, rowCircle }, { markCentre: 22, rowCircle: 22 }, "12 + 10, on 8 + 10 + 4");
  assert.deepEqual({ cogCentre, plus }, { cogCentre: 25, plus: 25 }, "13 + 12, on 11 + 14");
  assert.equal(toggleCentre, 51, "13 + 24 + 2 + 12: the toggle right before the cog");
  assert.equal(px(foot.gap), 2);
});

for (const palette of ["light", "solarized", "dark"]) test(`${palette}: primary, danger, disabled and focus states keep their own semantic pairs`, t => {
  const u = fixture(t, palette);
  // Spawn instance is no longer a primary button (2026-10-23): it is the Instances heading's +, painted like the
  // sidebar's other icon buttons (Add local workspace…, the foot's sidebar toggle and settings cog).
  for (const selector of ["#sidebar-spawn", "#ws-add-open", "#sidebar-toggle", "#sidebar-settings"]) {
    assert.equal(u.style(selector).color, "var(--muted)", selector);
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
  nav.disabled = true;
  assert.equal(u.style("#nav .nav-item").color, "var(--faint)");
});

test("theme component rules remain token-only, including all new identity markers", () => {
  const components = theme.slice(theme.indexOf("/* Keyboard-first" )).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(components, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\bopacity\s*:/i);
  assert.doesNotMatch(components, /\battr\(/i, "data attributes select named rules, never arbitrary CSS values");
});
