import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createSoulMark, createRuntimeBadge, identityCSS } from "../renderer/identity-marks.mjs";
import { createOfficialCatalog, officialCatalogCSS } from "../renderer/official-catalog.mjs";
import { createDeploymentInventory, inventoryCSS } from "../renderer/deployment-inventory.mjs";

const renderer = new URL("../renderer/", import.meta.url);
const css = readFileSync(new URL("theme.css", renderer), "utf8");
const themeJs = readFileSync(new URL("theme.mjs", renderer), "utf8");
function shippedStyleSources(dir = renderer) {
  const chunks = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) chunks.push(...shippedStyleSources(url));
    else if (/\.(?:css|mjs)$/.test(entry.name)) chunks.push({ path: url.pathname, text: readFileSync(url, "utf8") });
  }
  return chunks;
}
const shipped = shippedStyleSources();
const allStyles = shipped.map(({ path, text }) => `\n/* ${path} */\n${text}`).join("");

function tokens(block) {
  return new Map([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6}(?:[0-9a-f]{2})?)\b/gi)]
    .map((m) => [m[1], m[2].toLowerCase()]));
}

const dark = tokens(css.match(/:root, \[data-theme="dark"\] \{([\s\S]*?)\n\}/)?.[1] || "");
const light = new Map(dark);
for (const [key, value] of tokens(css.match(/\[data-theme="light"\] \{([\s\S]*?)\n\}/)?.[1] || "")) light.set(key, value);
const solarized = new Map(dark);
for (const [key, value] of tokens(css.match(/\[data-theme="solarized"\] \{([\s\S]*?)\n\}/)?.[1] || "")) solarized.set(key, value);
const palettes = [["light", light], ["solarized", solarized], ["dark", dark]];
const soulTones = ["sand", "sage", "slate", "mauve", "clay", "olive"];
const runtimes = ["claude", "pi", "codex", "unknown"];

function opaqueChannels(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i, "foregrounds and base surfaces must be opaque hex colors");
  return hex.slice(1).match(/../g).map((value) => parseInt(value, 16));
}

// The markdown scroll surface paints --bg behind its translucent code blocks.
// Do NOT strip the alpha byte, or test against the uncomposited foreground of
// --md-code-bg. Keep fractional sRGB channels until luminance is calculated.
const backgroundParents = new Map([["md-code-bg", "bg"]]);
function backgroundChannels(name, palette) {
  const hex = palette.get(name);
  assert.ok(hex, `defines --${name}`);
  if (hex.length === 7) return opaqueChannels(hex);
  assert.match(hex, /^#[0-9a-f]{8}$/i);
  assert.ok(backgroundParents.has(name), `translucent --${name} needs an explicit painted backdrop`);
  const parent = backgroundChannels(backgroundParents.get(name), palette);
  const alpha = parseInt(hex.slice(7), 16) / 255;
  return opaqueChannels(hex.slice(0, 7)).map((value, i) => value * alpha + parent[i] * (1 - alpha));
}

function luminance(rgb) {
  const channels = rgb.map((value) => value / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const ansi = [
  "ansi-black", "ansi-red", "ansi-green", "ansi-yellow", "ansi-blue", "ansi-magenta", "ansi-cyan", "ansi-white",
  "ansi-bright-black", "ansi-bright-red", "ansi-bright-green", "ansi-bright-yellow",
  "ansi-bright-blue", "ansi-bright-magenta", "ansi-bright-cyan", "ansi-bright-white",
];

// Explicitly mirrors shipped foreground/background use: shell/view metadata can
// sit on any base/raised surface; status text appears in shell and transcript;
// chip and terminal colors have their dedicated surfaces; ANSI is xterm-only.
const pairs = [
  ...["surface", "surface-2", "sel"].map(bg => ["nav-fg", bg]),
  ...soulTones.map(name => [`soul-${name}-fg`, `soul-${name}-bg`]),
  ...runtimes.map(name => [`runtime-${name}-fg`, `runtime-${name}-bg`]),
  ...["fg", "muted", "faint", "accent"].flatMap((fg) => ["bg", "surface", "surface-2"].map((bg) => [fg, bg])),
  ...["ok", "warn", "danger"].flatMap((fg) => ["bg", "surface", "surface-2", "term-bg"].map((bg) => [fg, bg])),
  ["chip-fg", "chip-bg"], ["accent", "chip-bg"], ["warn", "chip-bg"],
  ["primary-fg", "primary-bg"], ["term-fg", "term-bg"], ["term-sel-fg", "term-sel"],
  ["term-fg", "surface-2"], ["muted", "term-bg"],
  ["fg", "term-bg"], ["accent", "term-bg"], ["violet", "term-bg"], ["violet", "surface-2"],
  ...["fg", "muted", "faint", "accent", "warn", "ok"].map((fg) => [fg, "sel"]),
  ...["fg", "muted", "accent", "violet", "ok", "warn"].map((fg) => [fg, "md-code-bg"]),
  ...ansi.map((fg) => [fg, "term-bg"]),
];

test("contrast inventory retains alpha and composites code backgrounds over the painted --bg", () => {
  assert.equal(dark.get("md-code-bg"), "#ffffff10");
  assert.equal(light.get("md-code-bg"), "#ffffff60");
  assert.equal(solarized.get("md-code-bg"), "#58637510");
  assert.deepEqual(backgroundChannels("md-code-bg", new Map([
    ["md-code-bg", "#ffffff10"], ["bg", "#000000"],
  ])), [16, 16, 16], "the alpha byte is 16/255, not 10% or opaque white");
  for (const [, palette] of palettes) {
    const base = opaqueChannels(palette.get("bg"));
    const overlay = opaqueChannels(palette.get("md-code-bg").slice(0, 7));
    const painted = backgroundChannels("md-code-bg", palette);
    const alpha = parseInt(palette.get("md-code-bg").slice(7), 16) / 255;
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(painted[i] - (base[i] + (overlay[i] - base[i]) * alpha)) < 1e-10);
    assert.notDeepEqual(painted, base, "code is not painted directly on the unmodified base");
    assert.notDeepEqual(painted, overlay, "code background is not the opaque overlay color");
  }
  assert.throws(() => opaqueChannels("#ffffff80"), /must be opaque/);
  assert.throws(() => backgroundChannels("unknown", new Map([["unknown", "#ffffff10"]])), /explicit painted backdrop/);
});

test("all shipped hljs foregrounds are paired with their actual code background", () => {
  const rules = [...allStyles.matchAll(/\.hljs\b[^{}]*\{([^{}]*)\}/g)];
  const used = new Set();
  for (const [, body] of rules) {
    for (const match of body.matchAll(/\bcolor:\s*var\(--([\w-]+)\)/g)) {
      used.add(match[1]);
      assert.ok(pairs.some(([fg, bg]) => fg === match[1] && bg === "md-code-bg"),
        `hljs --${match[1]} needs contrast coverage on --md-code-bg`);
    }
  }
  assert.deepEqual([...used].sort(), ["accent", "fg", "muted", "ok", "violet", "warn"]);
});

test("xterm JavaScript theme fields use the same validated tokens with no raw fallback", () => {
  const fields = new Map([...themeJs.matchAll(/(\w+):\s*v\("(--[\w-]+)"\)/g)]
    .map((match) => [match[1], match[2].slice(2)]));
  assert.equal(fields.get("foreground"), "term-fg");
  assert.equal(fields.get("background"), "term-bg");
  assert.equal(fields.get("selectionForeground"), "term-sel-fg");
  assert.equal(fields.get("selectionBackground"), "term-sel");
  assert.doesNotMatch(themeJs, /v\("--[\w-]+"\s*,/,
    "xterm colors cannot bypass the CSS token inventory through JS fallbacks");
});

test("every shipped renderer foreground is an opaque, validated semantic token", () => {
  const unvalidated = [...allStyles.matchAll(/(?:^|[;{])\s*color:\s*(color-mix\(|#[0-9a-f]{3,8}\b|var\([^;]+,)/gim)];
  assert.deepEqual(unvalidated.map((m) => m[0].trim()), [],
    "raw, fallback, and derived text colors must become named tokens included in the matrix");
  const opacity = shipped.filter(({ text }) => /\bopacity\s*:/.test(text)).map(({ path }) => path);
  assert.deepEqual(opacity, [], "container/text opacity is forbidden because it invalidates token contrast");

  const validatedForegrounds = new Set(pairs.map(([fg]) => fg));
  const usedForegrounds = [...allStyles.matchAll(/(?:^|[;{])\s*color:\s*var\(--([\w-]+)\)/gim)].map((m) => m[1]);
  assert.deepEqual([...new Set(usedForegrounds.filter((token) => !validatedForegrounds.has(token)))], [],
    "every semantic foreground used by any shipped CSS/MJS source must appear in the contrast matrix");
});

for (const [name, palette] of palettes) {
  test(`theme contrast: ${name} text and ANSI pairings meet WCAG AA`, () => {
    for (const [fgName, bgName] of pairs) {
      const fg = palette.get(fgName), bg = palette.get(bgName);
      assert.ok(fg, `${name} defines --${fgName}`);
      assert.ok(bg, `${name} defines --${bgName}`);
      const painted = backgroundChannels(bgName, palette);
      const ratio = contrast(opaqueChannels(fg), painted);
      assert.ok(ratio >= 4.5,
        `${name} --${fgName} ${fg} on --${bgName} ${bg} (painted ${painted.join(", ")}): ${ratio.toFixed(2)}:1 < 4.5:1`);
    }
  });
}

// Color fixtures are local: no external reference paths, renderer startup or
// installed theme is needed to detect drift from the approved visual port.
test("White uses neutral surfaces, ink primaries and AA-safe orange distinct from errors", () => {
  const expected = {
    bg: "#f4f4f1", surface: "#ffffff", "surface-2": "#f8f8f6", border: "#e3e3df",
    fg: "#1a1a18", muted: "#5f5f5a", faint: "#686862", accent: "#ad5500", sel: "#fff0df", "nav-fg": "#50504b",
    "primary-bg": "#1a1a18", "primary-fg": "#ffffff", "term-bg": "#ffffff", "term-fg": "#1a1a18",
  };
  for (const [key, value] of Object.entries(expected)) assert.equal(light.get(key), value, key);
  const onSelection = hex => contrast(opaqueChannels(hex), backgroundChannels("sel", light));
  assert.ok(onSelection("#b35400") < 4.5, "a brighter orange needs darkening for small text on selection");
  assert.ok(onSelection(light.get("accent")) >= 4.5);
  assert.ok(onSelection("#9a9a95") < 4.5, "faint export ink must not be restored");
  assert.notEqual(light.get("accent"), light.get("ok"), "running/selection is not success green");
  assert.equal(light.get("danger"), "#b52f35");
  assert.equal(light.get("ok"), "#267548");
  assert.equal(light.get("term-sel"), light.get("sel"));
  assert.equal(light.get("graph-edge-coord"), light.get("accent"));
});

test("dark color palette is preserved; primary is an existing opaque ink/surface pair", () => {
  const expected = {
    bg: "#0e1116", surface: "#161b22", "surface-2": "#1c2129", border: "#2d333c",
    fg: "#e6edf3", muted: "#9aa4b2", faint: "#8b949e", accent: "#4493f8", "accent-fg": "#ffffff",
    violet: "#c297ff", ok: "#3fb950", warn: "#d29922", danger: "#f85149",
    "chip-bg": "#21262e", "chip-fg": "#adb6c2", sel: "#1b2b40",
    "term-bg": "#0a0d12", "term-fg": "#e6edf3", "term-sel": "#264f78", "term-sel-fg": "#f5f9ff",
    "md-code-bg": "#ffffff10", "md-rule": "#ffffff2e", "graph-edge": "#2d333c", "graph-edge-coord": "#4493f8",
  };
  for (const [key, value] of Object.entries(expected)) assert.equal(dark.get(key), value, key);
  assert.deepEqual(ansi.map(key => dark.get(key)), [
    "#768390", "#ff7b72", "#4ac26b", "#d9a032", "#6cb2ff", "#c297ff", "#4ed1db", "#c3ccd6",
    "#8b949e", "#ffa198", "#63e084", "#edbb4a", "#8cc5ff", "#d5b3ff", "#70e0e8", "#f5f9ff",
  ]);
  assert.equal(dark.get("primary-bg"), dark.get("fg"));
  assert.equal(dark.get("primary-fg"), dark.get("bg"));
});


test("Solarized retains every prior Light semantic and ANSI color from b280ce1b", () => {
  const expected = {
    bg: "#f3eddd", surface: "#fdf6e3", "surface-2": "#f0e9d2", border: "#ddd4bc",
    fg: "#37424a", muted: "#56676d", faint: "#55666b", accent: "#155f96", "accent-fg": "#ffffff",
    violet: "#7f3f98", ok: "#465f00", warn: "#725500", danger: "#b52f35",
    "chip-bg": "#ede5cc", "chip-fg": "#56676d", sel: "#dce7e8",
    "term-bg": "#fdf6e3", "term-fg": "#52666c", "term-sel": "#d3c9a8", "term-sel-fg": "#37424a",
    "md-code-bg": "#58637510", "md-rule": "#5863752e", "graph-edge": "#ddd4bc", "graph-edge-coord": "#1f6fb2",
  };
  for (const [key, value] of Object.entries(expected)) assert.equal(solarized.get(key), value, key);
  assert.deepEqual(ansi.map(key => solarized.get(key)), [
    "#55666b", "#b52f35", "#465f00", "#725500", "#155d91", "#9d2b61", "#0f6863", "#56676d",
    "#56676d", "#a43a14", "#4f6f00", "#725500", "#155f96", "#9d2b61", "#0f6863", "#37424a",
  ]);
});

test("nav ink is subtly darker than muted; identity palettes are opaque and distinct", () => {
  for (const [name, palette] of palettes) {
    const nav = luminance(opaqueChannels(palette.get("nav-fg")));
    const muted = luminance(opaqueChannels(palette.get("muted")));
    assert.ok(nav < muted && nav > muted * 0.6, `${name} nav subtly darkens muted`);
    assert.equal(new Set(soulTones.map(tone => palette.get(`soul-${tone}-bg`))).size, 6);
    for (const tone of soulTones) {
      const bg = luminance(opaqueChannels(palette.get(`soul-${tone}-bg`)));
      const fg = luminance(opaqueChannels(palette.get(`soul-${tone}-fg`)));
      assert.ok(name === "dark" ? fg > bg : bg > fg, `${name} ${tone} uses same-family readable ink`);
    }
  }
});


// Real marker constructors in representative shipped containers, with shell and
// view rules loaded AFTER theme.css just like the app. JSDOM preserves var()
// values: resolve the winning declaration through the actual root CSSOM, not
// a hand-picked expected palette, before measuring contrast. No browser launch.
for (const [name] of palettes) test(`${name}: actual identity/runtime markup wins the cascade and meets AA`, t => {
  const dom = new JSDOM(`<!doctype html><html data-theme="${name}"><head></head><body>
    <div id="app"><aside id="sidebar"><button class="ctx-inst active"></button></aside>
      <div class="oats-view"><button class="soul-card"><span class="sname"></span></button>
        <button class="act primary"><span class="inspector-marks"></span></button></div></div>
  </body></html>`);
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const spawnSource = readFileSync(new URL("views/spawn.mjs", renderer), "utf8");
  const spawnCSS = spawnSource.match(/const CSS = `([\s\S]*?)`;/)?.[1];
  assert.ok(spawnCSS, "exercise actual late-mounted soul card/glyph rules");
  for (const source of [css, readFileSync(new URL("shell.css", renderer), "utf8"), spawnCSS, identityCSS]) {
    const style = document.createElement("style"); style.textContent = source; document.head.append(style);
  }
  const root = dom.window.getComputedStyle(document.documentElement);
  function check(mark, prefix) {
    const style = dom.window.getComputedStyle(mark);
    const fg = `var(--${prefix}-fg)`, bg = `var(--${prefix}-bg)`;
    assert.equal(style.color, fg, `${name} ${mark.outerHTML} foreground is not overridden`);
    assert.equal(style.background, bg, `${name} ${mark.outerHTML} background is not overridden`);
    const ratio = contrast(opaqueChannels(root.getPropertyValue(`--${prefix}-fg`).trim()),
      opaqueChannels(root.getPropertyValue(`--${prefix}-bg`).trim()));
    assert.ok(ratio >= 4.5, `${name} ${prefix} actual marked pair ${ratio.toFixed(2)}:1`);
    assert.equal(style.opacity, "1", "no text opacity composition");
  }
  for (const selector of [".ctx-inst", ".soul-card .sname", ".inspector-marks"]) {
    const container = document.querySelector(selector);
    for (const color of soulTones) {
      const mark = createSoulMark(document, { name: "Fixture soul", agentsRoot: "/fixture/agents", color });
      mark.classList.add("glyph"); container.append(mark);
      assert.equal(mark.dataset.avatarColor, color);
      check(mark, `soul-${color}`);
    }
    for (const runtime of runtimes) {
      const badge = createRuntimeBadge(document, runtime); badge.classList.add("sruntime", "ctx-runtime");
      container.append(badge); check(badge, `runtime-${runtime}`);
    }
    const hostile = createRuntimeBadge(document, "red; background:url(https://fixture.invalid)");
    container.append(hostile); check(hostile, "runtime-unknown");
    assert.equal(hostile.getAttribute("style"), null);
    const invalid = document.createElement("span"); invalid.dataset.avatarColor = "red; background:url(x)";
    container.append(invalid); check(invalid, "chip");
  }
});

for (const [name] of palettes) test(`${name}: catalog and inventory text use AA tokens on their computed surfaces`, async t => {
  const dom = new JSDOM(`<!doctype html><html data-theme="${name}"><body><main class="oats-view"></main></body></html>`);
  const doc = dom.window.document, host = doc.querySelector('main');
  for (const source of [css, identityCSS, officialCatalogCSS, inventoryCSS]) {
    const style = doc.createElement('style'); style.textContent = source; doc.head.append(style);
  }
  const ctx = { api: async path => path === '/api/catalog' ? {
    catalogApi: 1, scope: 'local-cli', status: 'available', minimumVersion: '0.24.6', reason: null,
    description: { schemaVersion: 1, catalog: { origin: 'override', file: '/fixture/catalog.json', kernelVersion: '0.24.6' },
      packages: [{ package: 'fixture.pkg', url: null, ref: null, path: 'oats', acquire: { argv: ['oats', 'install', 'fixture.pkg'] } }], capabilityAliases: [], notes: [] },
  } : { inventoryApi: 1, scope: { kind: 'classic', context: '/fixture' }, packages: [], capabilities: [{ capability: 'fixture.cap', level: '/fixture' }], legacy: [] } };
  const catalog = createOfficialCatalog(host, { ctx }), inventory = createDeploymentInventory(host, { ctx });
  t.after(() => { catalog.dispose(); inventory.dispose(); dom.window.close(); });
  await catalog.update({ active: true, identity: name });
  await inventory.update({ active: true, identity: name, workspace: { scope: '/fixture' }, context: '/fixture', selector: {}, cli: { ok: true } });
  const root = dom.window.getComputedStyle(doc.documentElement);
  for (const [selector, painted, fg, bg] of [
    ['.official-catalog-note', '.oats-view', 'muted', 'bg'],
    ['.official-catalog-warning', '.official-catalog-warning', 'danger', 'surface'],
    ['.official-catalog-command', '.official-catalog-command', 'fg', 'surface'],
    ['.official-catalog-table th', '.official-catalog-table th', 'muted', 'surface-2'],
    ['.inventory-note', '.oats-view', 'muted', 'bg'],
    ['.inventory-table th', '.inventory-table th', 'muted', 'surface-2'],
    ['.inventory-table small', '.inventory-table', 'muted', 'surface'],
    ['.inventory-table summary', '.inventory-table', 'fg', 'surface'],
    ['.inventory-table dt', '.inventory-table', 'muted', 'surface'],
    ['.inventory-refresh', '.inventory-refresh', 'fg', 'surface'],
  ]) {
    const el = doc.querySelector(selector), surface = doc.querySelector(painted);
    assert.ok(el && surface, selector);
    assert.equal(dom.window.getComputedStyle(el).color, `var(--${fg})`, selector);
    assert.equal(dom.window.getComputedStyle(surface).background, `var(--${bg})`, painted);
    assert.ok(contrast(opaqueChannels(root.getPropertyValue(`--${fg}`).trim()), opaqueChannels(root.getPropertyValue(`--${bg}`).trim())) >= 4.5, selector);
    for (let parent = el; parent; parent = parent.parentElement) assert.equal(dom.window.getComputedStyle(parent).opacity, '1');
  }
});

for (const [name] of palettes) test(`${name}: shipped sidebar shortcut hints meet AA on their actual painted controls`, t => {
  const dom = new JSDOM(readFileSync(new URL("index.html", renderer), "utf8"));
  t.after(() => dom.window.close());
  const doc = dom.window.document; doc.documentElement.dataset.theme = name;
  for (const source of [css, readFileSync(new URL("shell.css", renderer), "utf8")]) {
    const style = doc.createElement("style"); style.textContent = source; doc.head.append(style);
  }
  const root = dom.window.getComputedStyle(doc.documentElement);
  for (const [selector, foreground, background] of [
    [".ctx-filter-field", "muted", "bg"], ["#sidebar-spawn", "primary-fg", "primary-bg"],
  ]) {
    const control = doc.querySelector(selector), hint = control.querySelector(".shortcut-hint");
    hint.hidden = false; hint.textContent = "Ctrl+Shift+J";
    const hintStyle = dom.window.getComputedStyle(hint), controlStyle = dom.window.getComputedStyle(control);
    assert.equal(hintStyle.color, `var(--${foreground})`);
    assert.equal(controlStyle.background, `var(--${background})`);
    for (let node = hint; node; node = node.parentElement) {
      assert.equal(dom.window.getComputedStyle(node).opacity, "1");
    }
    assert.ok(contrast(opaqueChannels(root.getPropertyValue(`--${foreground}`).trim()),
      opaqueChannels(root.getPropertyValue(`--${background}`).trim())) >= 4.5);
    hint.hidden = true; assert.equal(dom.window.getComputedStyle(hint).display, "none");
  }
});
