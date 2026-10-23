import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { tabNumber, numberTabStrips } from "../renderer/tab-numbers.mjs";
import { createTabChrome, tabNameTailStart } from "../renderer/tab-a11y.mjs";

const shellCss = readFileSync(new URL("../renderer/shell.css", import.meta.url), "utf8");

function fixture(t) {
  const dom = new JSDOM("<!doctype html><html><head></head><body><div id=\"tabbar\"></div><div id=\"tabhost\"></div></body></html>");
  t.after(() => dom.window.close());
  const doc = dom.window.document, style = doc.createElement("style");
  style.textContent = shellCss; doc.head.append(style);
  return { doc, window: dom.window };
}
const strip = (doc, titles, { group = false, prefix = "t" } = {}) => {
  const bar = doc.createElement("div");
  if (group) bar.className = "group-tabbar"; else bar.id = "tabbar-test";
  const tabs = titles.map((title, i) => createTabChrome(doc, `${prefix}${i}`, title, false, { dot: "on" }));
  for (const { tabEl } of tabs) bar.append(tabEl);
  doc.body.append(bar);
  return { bar, tabs };
};
const shown = tabs => tabs.map(({ triggerEl }) => { const num = triggerEl.querySelector(":scope > .tab-num"); return num.hidden ? null : num.textContent; });

// The lead's rule: "go to tab N" reaches tab N of the strip, and 9 the last (shell.mjs gotoTab).
test("tabNumber: 1–8 by position, 9 for the last of nine or more, nothing for the rest", () => {
  assert.deepEqual([...Array(8).keys()].map(i => tabNumber(i, 8)), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...Array(9).keys()].map(i => tabNumber(i, 9)), [1, 2, 3, 4, 5, 6, 7, 8, 9], "the 9th of 9 is 9");
  assert.deepEqual([...Array(12).keys()].map(i => tabNumber(i, 12)), [1, 2, 3, 4, 5, 6, 7, 8, null, null, null, 9],
    "of 12, positions 9–11 show nothing and the 12th shows 9");
  assert.equal(tabNumber(0, 1), 1, "a lone tab is 1");
  for (const [index, count] of [[-1, 3], [3, 3], [0, 0], [1.5, 3], [null, 3], [0, "3"]]) assert.equal(tabNumber(index, count), null, `${index} of ${count}`);
});

test("numberTabStrips numbers each strip's shown tabs in DOM order; the number is decorative", t => {
  const { doc } = fixture(t);
  const titles = Array.from({ length: 10 }, (_, i) => `oats-desktop-developer-tab-${i}`);
  const { bar, tabs } = strip(doc, titles);
  // createTabChrome ends every trigger with an empty, hidden number.
  for (const { triggerEl } of tabs) {
    const num = triggerEl.lastElementChild;
    assert.equal(num.className, "tab-num");
    assert.deepEqual([num.textContent, num.hidden, num.getAttribute("aria-hidden")], ["", true, "true"]);
  }
  numberTabStrips([bar]);
  assert.deepEqual(shown(tabs), ["1", "2", "3", "4", "5", "6", "7", "8", null, "9"]);
  tabs.forEach(({ triggerEl }, i) => {
    assert.equal(triggerEl.getAttribute("aria-label"), titles[i], "the accessible name stays the bare title");
    assert.equal(triggerEl.title, titles[i]);
    assert.equal(triggerEl.getAttribute("role"), "tab");
    assert.equal(triggerEl.querySelector(".tab-num").getAttribute("aria-hidden"), "true");
  });
  // A hidden tab (another context or workspace) does not count, and loses its number.
  tabs[2].tabEl.hidden = true;
  numberTabStrips([bar]);
  assert.deepEqual(shown(tabs), ["1", "2", null, "3", "4", "5", "6", "7", "8", "9"], "nine shown: the last is 9");
  // Removal renumbers; a strip of eight shows 1–8.
  tabs[9].tabEl.remove(); numberTabStrips([bar]);
  assert.deepEqual(shown(tabs.slice(0, 9)), ["1", "2", null, "3", "4", "5", "6", "7", "8"]);
  tabs[2].tabEl.hidden = false; numberTabStrips([bar]);
  assert.deepEqual(shown(tabs.slice(0, 9)), ["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  // Only the strip's own tabs: anything else in it (the split controls) is left alone.
  const actions = doc.createElement("div"); actions.id = "tab-actions"; bar.append(actions);
  numberTabStrips([bar]);
  assert.equal(actions.textContent, "");
});

test("two group strips number their tabs independently, and a moved tab takes its new strip's number", t => {
  const { doc } = fixture(t);
  const left = strip(doc, ["a", "b", "c"], { group: true, prefix: "l" });
  const right = strip(doc, ["d", "e"], { group: true, prefix: "r" });
  numberTabStrips([null, left.bar, right.bar]);
  assert.deepEqual(shown(left.tabs), ["1", "2", "3"]);
  assert.deepEqual(shown(right.tabs), ["1", "2"]);
  right.bar.prepend(left.tabs[1].tabEl); // a tab moved to the other group, at its start
  numberTabStrips([left.bar, right.bar]);
  assert.deepEqual(shown([left.tabs[0], left.tabs[2]]), ["1", "2"]);
  assert.deepEqual(shown([left.tabs[1], ...right.tabs]), ["1", "2", "3"]);
});

test("numberTabStrips writes only what changed, so a strip observer sees nothing on a no-op pass", async t => {
  const { doc, window } = fixture(t);
  const { bar } = strip(doc, ["a", "b", "c"]);
  numberTabStrips([bar]);
  const seen = [];
  const observer = new window.MutationObserver(records => seen.push(...records));
  observer.observe(bar, { childList: true, subtree: true, characterData: true, attributes: true });
  numberTabStrips([bar]);
  await new Promise(resolve => setTimeout(resolve, 0));
  observer.disconnect();
  assert.deepEqual(seen, []);
});

// The number never crowds out the name (shell.css .tab-trigger). jsdom has no layout, so the geometry is
// proven live: the renderer's shell.css and theme.css in Chromium (dark palette, the shipped system UI face,
// 12.5px, bold active tab; Playwright on a static page, 2026-10-23). The number is 6.6px wide at 11px
// ui-monospace, after the trigger's 8px gap.
//   - At the floor (168px tab, 117px trigger), "oats-desktop-developer-spawn-flow" (natural 213px) and
//     "…-tabs-palette" show "oats-…awn-flow" / "oats-…palette" at exactly 102px and no number: it sits on the
//     clipped second line (its top 55px into the 47px trigger), not a half-clipped digit.
//   - At the floor, "README.md" (icon, 74px) and "A-reviewer" (dot, 60px) keep their numbers, centred (0px off).
//   - Shrinking one long-named tab a pixel at a time: the number shows down to a 183px tab, where the name is
//     102.4px, and hides at 182px, where the name takes the room back (116px); with a branch, 191px / 190px
//     (the branch's own gap), and the branch wraps away at 175px. An artifact tab with a long name: 190px / 189px,
//     its name 95px at the floor as before (the icon's lead).
//   - With room, "oats-desktop-developer-ui" (natural 156.28px) shows whole beside its number: the tab is
//     236.88px = 51 chrome + 15 dot + 156.28 + 8 + 6.6, so the number adds to the tab's natural width and takes
//     nothing from the name. Tabs and triggers stay 47px tall in #tabbar and .group-tabbar; content is centred.
// This pins the rules that make that happen.
test("the number gives way to the name: the trigger wraps onto a clipped line once the name is at its minimum", t => {
  const { doc, window } = fixture(t);
  const name = "oats-desktop-developer-spawn-flow";
  const { tabEl, triggerEl } = createTabChrome(doc, "n", name, false, { dot: "on", detail: "feat/x", tailAt: tabNameTailStart(name, "oats-desktop-developer"), tailEnd: name.length });
  doc.getElementById("tabbar").append(tabEl);
  const style = el => window.getComputedStyle(el);
  assert.deepEqual([...triggerEl.children].map(el => el.className), ["tab-dot on", "tab-label split", "tab-detail", "tab-num"], "the number comes last");
  const trigger = style(triggerEl);
  assert.deepEqual([trigger.display, trigger.flexWrap, trigger.alignContent, trigger.alignItems, trigger.overflow, trigger.alignSelf],
    ["flex", "wrap", "flex-start", "center", "hidden", "stretch"], "what wraps lands on a second line the trigger clips");
  assert.equal(trigger.gap, "8px");
  const rules = [...doc.styleSheets].flatMap(sheet => [...sheet.cssRules]);
  const spacer = rules.find(rule => rule.selectorText === ".tab-trigger::before");
  assert.ok(spacer, "a spacer holds the first line at the trigger's full height");
  assert.deepEqual(["content", "width", "height", "margin-right", "flex-shrink"].map(p => spacer.style.getPropertyValue(p)),
    ['""', "0px", "100%", "-8px", "0"], "zero wide, full height, its gap cancelled");
  const label = style(triggerEl.querySelector(".tab-label"));
  assert.equal(label.flexBasis, "min(var(--tab-name-min), 100% - 22px)", "line breaking sees the name at its minimum at most");
  assert.deepEqual([label.flexGrow, label.flexShrink, label.maxWidth, label.minWidth], ["1000", "1", "max-content", "0px"],
    "it grows from there to its whole width, no further, ahead of the branch");
  const px = prop => Number.parseFloat(style(tabEl).getPropertyValue(prop));
  const DOT_AND_GAP = 7 + 8, WIDEST_LEAD = 14 + 8; // the dot (or the Needs input glyph) and its gap; an artifact's icon and its gap
  assert.equal(px("--tab-name-min"), px("--tab-min") - px("--tab-chrome") - DOT_AND_GAP,
    "the name's minimum is what the floor budgets it (visual-rendering-regressions.test.mjs), so at the floor a long name hides the number");
  assert.equal(Number(/100% - (\d+)px/.exec(label.flexBasis)[1]), WIDEST_LEAD,
    "the basis never exceeds the line after the widest lead, so the name itself never wraps");
  const detail = style(triggerEl.querySelector(".tab-detail"));
  assert.deepEqual([detail.flexGrow, detail.flexBasis], ["1", "0px"], "the branch still gives way first");
  const num = triggerEl.querySelector(".tab-num"), n = style(num);
  assert.deepEqual([n.flexGrow, n.flexShrink, n.whiteSpace], ["0", "0", "nowrap"], "the number is whole or gone, never squeezed");
  assert.equal(n.color, "var(--faint)");
  assert.equal(n.fontSize, "11px", "quiet, like the branch");
  assert.equal(n.display, "none", "an unnumbered tab's number takes no room");
  num.hidden = false; num.textContent = "1";
  assert.notEqual(style(num).display, "none");
  // The tab's cap and floor are unchanged (visual-rendering-regressions.test.mjs pins them).
  assert.equal(style(tabEl).maxWidth, "fit-content");
});
