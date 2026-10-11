// One native select style (spec B item 4): every <select class="field"> in Desktop, in a view or
// not, is theme.css's select.field: no platform chrome, the field's frame, a static --muted chevron,
// and a color-scheme per theme so its open list and scrollbars follow the theme. Pages size a select;
// they never restyle it. In-memory CSSOM/cascade checks; no Electron.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { JSDOM } from "jsdom";
import { connectionsCSS } from "../renderer/connections.mjs";
import { soulTeamsHereCSS } from "../renderer/soul-teams-here.mjs";
import { spawnDialogCSS } from "../renderer/spawn-dialog.mjs";
import { GRAPHIC_PAIRS } from "../renderer/contrast-inventory.mjs";

const renderer = new URL("../renderer/", import.meta.url);
const read = name => readFileSync(new URL(name, renderer), "utf8");
const theme = read("theme.css"), shell = read("shell.css");
function viewCss(name) {
  const source = read(name), start = source.indexOf("const CSS = `");
  return start < 0 ? "" : source.slice(start + 13, source.indexOf("`;", start));
}
const brainCSS = viewCss("views/brain.mjs"), schedulesCSS = viewCss("views/schedules.mjs");

function fixture(t, palette, body) {
  const dom = new JSDOM(`<!doctype html><html data-theme="${palette}"><head></head><body>${body}</body></html>`);
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  for (const css of [theme, shell, connectionsCSS, soulTeamsHereCSS, spawnDialogCSS, brainCSS, schedulesCSS]) {
    const style = doc.createElement("style"); style.textContent = css; doc.head.append(style);
  }
  return { doc, win: dom.window, rules: [...doc.styleSheets].flatMap(sheet => [...sheet.cssRules]) };
}

test("color-scheme is declared per theme: dark for Dark (and the default), light for White and Solarized", t => {
  const { rules } = fixture(t, "light", "");
  const scheme = selector => rules.find(rule => rule.selectorText?.replace(/\s+/g, " ") === selector)?.style.getPropertyValue("color-scheme");
  assert.equal(scheme(':root, [data-theme="dark"]'), "dark");
  assert.equal(scheme('[data-theme="light"]'), "light");
  assert.equal(scheme('[data-theme="solarized"]'), "light");
});

test("select.field: no platform chrome, the field's frame, a static --muted chevron over its right padding", t => {
  const { rules } = fixture(t, "light", "");
  const own = rules.filter(rule => rule.selectorText === "select.field");
  assert.equal(own.length, 1, "one rule set, in theme.css");
  const s = own[0].style;
  assert.equal(s.getPropertyValue("appearance"), "none");
  assert.equal(s.getPropertyValue("background-color"), "var(--surface)");
  assert.equal(s.getPropertyValue("border"), "1px solid var(--border)");
  assert.equal(s.getPropertyValue("color"), "var(--fg)");
  assert.equal(s.getPropertyValue("padding-right"), "30px", "room for the chevron");
  const image = s.getPropertyValue("background-image");
  // Static: the chevron is two gradient halves in a theme token; no data URI, nothing interpolated.
  const strokes = image.match(/linear-gradient\((45|135)deg, transparent calc\(50% - \.9px\), var\(--muted\) calc\(50% - \.4px\), var\(--muted\) calc\(50% \+ \.4px\), transparent calc\(50% \+ \.9px\)\)/g) || [];
  assert.equal(strokes.length, 2, `two thin --muted strokes: ${image}`);
  assert.doesNotMatch(image.replace(/var\(--muted\)/g, ""), /var\(|#|rgb|url/, "only the --muted token: no other colour, nothing interpolated");
  assert.doesNotMatch(theme, /select[^{]*\{[^}]*url\(/, "no image URL in a select rule");
  const disabled = rules.find(rule => rule.selectorText === "select.field:disabled").style;
  assert.equal(disabled.getPropertyValue("background-color"), "var(--surface-2)");
  assert.equal(disabled.getPropertyValue("background-image"), "", "the chevron stays on a disabled select");
  for (const bg of ["surface", "surface-2"]) assert.ok(GRAPHIC_PAIRS.some(([fg, on]) => fg === "muted" && on === bg), `the chevron on --${bg} is in the contrast inventory`);
});

test("every Desktop select keeps the one style wherever it is drawn: pages size it, never restyle it", t => {
  const { doc, win } = fixture(t, "dark", `
    <div class="brain"><div class="brain-bar"><select class="field" id="brain"></select></div></div>
    <div class="palette-overlay"><section class="forge-settings"><label>Host<select class="field" id="forge"></select></label></section></div>
    <div class="oats-view">
      <div class="soul-teams-here"><div class="sth-add"><select class="field" id="sth"></select></div></div>
      <div class="spawn-dialog"><div class="spawn-form"><select class="field" id="spawn"></select></div></div>
      <form class="schedule-form"><select class="field" id="schedule"></select></form>
      <div class="launch-config-fields"><select class="field" id="launch"></select></div>
    </div>`);
  for (const id of ["brain", "forge", "sth", "spawn", "schedule", "launch"]) {
    const style = win.getComputedStyle(doc.getElementById(id));
    assert.equal(style.getPropertyValue("appearance"), "none", `${id}: no platform chrome`);
    assert.equal(style.getPropertyValue("background-color"), "var(--surface)", `${id}: the field's surface`);
    assert.match(style.getPropertyValue("background-image"), /var\(--muted\)/, `${id}: the chevron`);
    assert.equal(style.getPropertyValue("border-radius"), "7px", `${id}: the field's radius`);
    assert.equal(style.getPropertyValue("color"), "var(--fg)", `${id}: the field's ink`);
    assert.equal(style.getPropertyValue("padding-right"), "30px", `${id}: the chevron's room`);
  }
});

test("every native select in the renderer is a .field select (none keeps a per-page look)", () => {
  const files = [];
  const walk = dir => {
    for (const entry of readdirSync(new URL(dir, renderer), { withFileTypes: true })) {
      if (entry.isDirectory()) { if (entry.name !== "vendor" && entry.name !== "fonts") walk(`${dir}${entry.name}/`); }
      else if (entry.name.endsWith(".mjs")) files.push(`${dir}${entry.name}`);
    }
  };
  walk("");
  // The renderer modules that moved to the shared home (packages/client); `read` resolves from renderer/.
  walk("../../client/");
  let seen = 0;
  for (const file of files) {
    const source = read(file);
    for (const m of source.matchAll(/<select\s[^>]*>/g)) { seen++; assert.match(m[0], /class="field\b/, `${file}: ${m[0]}`); }
    for (const m of source.matchAll(/(?:createElement\(|\bel\(|\bnode\()(?:doc, )?["']select["'][^;]*;/g)) {
      seen++;
      // The class rides on the call, or on the next statement (brain: sel.className = "field").
      const near = source.slice(m.index, m.index + m[0].length + 80);
      assert.match(near, /["']field\b|className = ["']field/, `${file}: ${m[0]}`);
    }
    // A sheet may size a select (width, height, padding-top/bottom, flex, font-size), never paint it.
    for (const m of source.matchAll(/([^{}\n]*\bselect\b[^{}\n]*)\{([^}]*)\}/g)) {
      if (file === "theme.css" || /focus-visible|querySelector/.test(m[1]) || !/[.\s]select\b/.test(` ${m[1]}`)) continue;
      assert.doesNotMatch(m[2], /\b(background|border(?!-box)|color|appearance|border-radius|font-family)\s*:/, `${file}: ${m[1].trim()} restyles a select`);
    }
  }
  assert.ok(seen >= 20, `found the Desktop's selects (${seen})`);
});
