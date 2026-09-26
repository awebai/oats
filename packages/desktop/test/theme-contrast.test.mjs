import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createSoulMark, createRuntimeBadge, identityCSS } from "../renderer/identity-marks.mjs";
import { workspaceStatusData, syncData } from "../deployment-data.mjs";
import { renderCapabilities, renderCapabilitySections, capabilitySections, renderFilters, filterChoices, memberNames } from "../renderer/workspace-catalog.mjs";
import { renderSetup } from "../renderer/workspace-setup.mjs";
import { discoveryCSS } from "../renderer/workspace-discovery.mjs";
import { createConnections, connectionsCSS } from '../renderer/connections.mjs';
import { createForgePrPanel } from '../renderer/forge-pr.mjs';
import { instanceGitCSS } from '../renderer/instance-git.mjs';
import { createContextPanel, contextPanelCSS } from '../renderer/context-panel.mjs';
import { prChip, rosterPrCSS } from '../renderer/roster-pr.mjs';
import { createNotificationCenter, notificationCSS } from '../renderer/notifications.mjs';
import { createWorkspaceSwitcher } from '../renderer/workspace-switcher.mjs';
import { instanceActions } from '../renderer/instance-actions.mjs';
import { instanceActionTarget } from '../renderer/instance-action-target.mjs';
import { pullRequest } from '../renderer/forge-contract.mjs';
import { target as forgeTarget, pr as forgePr } from './helpers/forge-fixture.mjs';
import { createLifecycleDialog, lifecycleCSS } from '../renderer/lifecycle-dialog.mjs';
import { createReadinessView, readinessCSS } from '../renderer/readiness-view.mjs';
import { cli as readinessCli, workspace as readinessWorkspace, selector as readinessSelector, view as readinessView, data as readinessFixture } from './helpers/readiness-fixture.mjs';
import { instance as lifeInstance, target as lifeTarget, stopPlan as stopFixture, retirePlan as retireFixture } from './helpers/lifecycle-fixture.mjs';
import { createSchedulesView } from '../renderer/views/schedules.mjs';
import { createSoulInspector, inspectorCSS } from '../renderer/soul-inspector.mjs';
import { readinessCSS as readinessViewCSS } from '../renderer/readiness-view.mjs';
import { createInstanceGitPanel } from '../renderer/instance-git.mjs';
import { spawnDialogCSS } from '../renderer/spawn-dialog.mjs';
import { createAutomationsView } from '../renderer/views/automations.mjs';
import { setWorkspace } from '../renderer/views/common.mjs';

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
  ["chip-fg", "chip-bg"], ["accent", "chip-bg"], ["warn", "chip-bg"], ["fg", "chip-bg"],
  ["primary-fg", "primary-bg"], ["term-fg", "term-bg"], ["term-sel-fg", "term-sel"],
  ["term-fg", "surface-2"], ["muted", "term-bg"],
  ["fg", "term-bg"], ["accent", "term-bg"], ["violet", "term-bg"], ["violet", "surface-2"],
  ...["fg", "muted", "faint", "accent", "warn", "ok"].map((fg) => [fg, "sel"]),
  ...["fg", "muted", "accent", "violet", "ok", "warn"].map((fg) => [fg, "md-code-bg"]),
  ...ansi.map((fg) => [fg, "term-bg"]),
  // Workspace v4: amber attention chips/nodes, and reason/tag chips.
  ["warn", "attn-bg"], ["fg", "attn-bg"], ["muted", "attn-bg"],
  ...["fg", "muted"].map((fg) => [fg, "tag-bg"]),
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

for (const [name] of palettes) test(`${name}: workspace catalog, sources and sync text use AA tokens on their computed surfaces`, t => {
  const dom = new JSDOM(`<!doctype html><html data-theme="${name}"><body><main class="oats-view"><header class="workspace-header"><div class="ws-sync"><span class="ws-sync-state warn">Lock out of date</span></div></header><p class="catalog-note warn">note</p><div class="filters"></div><div class="caps"></div><div class="sections"></div><div class="sources"></div><div class="graph"></div></main></body></html>`);
  const doc = dom.window.document;
  for (const source of [css, identityCSS, discoveryCSS]) { const style = doc.createElement('style'); style.textContent = source; doc.head.append(style); }
  t.after(() => dom.window.close());
  // Kernel captures (F2): the catalog paints locked/confirmed chips; a later
  // sync's members carry an unconfirmed (warn) row with its detail.
  const f2 = file => JSON.parse(readFileSync(new URL(`fixtures/workspace-v2/f2/${file}.json`, new URL("./", import.meta.url)), "utf8"));
  const dir = '/fixture/base/northwind-workspace';
  const status = { ...workspaceStatusData(f2('workspace-status'), dir), members: syncData(f2('sync-moved'), dir).members };
  // Kernel #217: rows carry a description (rendered as a muted line under the name).
  const rows = f2('capabilities').result.capabilities.map(r => ({ ...r, description: `About ${r.name}.` }));
  const names = memberNames(status);
  renderFilters(doc.querySelector('.filters'), { ...filterChoices(rows, names), value: { team: 'marketing', repo: null }, shown: 2, total: 5, onChange() {} });
  renderCapabilities(doc.querySelector('.caps'), { rows, status, instances: [], root: dir });
  // F7 (kernel #185): the three sections, with a repo-owned (private) row.
  const sections = capabilitySections(JSON.parse(readFileSync(new URL('fixtures/workspace-v2/f7/capabilities.json', new URL('./', import.meta.url)), 'utf8')).result.capabilities);
  renderCapabilitySections(doc.querySelector('.sections'), { sections, shown: sections.workspace, filterHost: null, privateListed: true, status, instances: [], root: dir });
  // Kernel #217 desktop facts: a hosted workspace file, clones (one here, one refused, the rest not cloned), the lock file.
  const unconfirmed = status.members.find(m => m.status !== 'confirmed');
  const facts = { ...status, workspace: { ...status.workspace, file: { path: 'oats-workspace.yaml', url: 'https://github.com/northwind/agents/blob/a/oats-workspace.yaml' } },
    clones: status.members.map((m, i) => m.key === unconfirmed.key ? { key: m.key, name: m.name, path: null, rule: null, problem: { code: 'E_CLONE_MISMATCH', message: 'not a clone of this member' } }
      : { key: m.key, name: m.name, path: i ? null : `${dir}/${m.name}`, rule: i ? null : 'convention' }),
    disabledSouls: ['campaign-writer'], lock: { path: `${dir}/oats-lock.json`, lockfileVersion: 3 },
    defaults: { slots: { knowledge: { name: 'oats.okf', from: 'package' }, messaging: 'none', tasks: null }, capabilities: [{ name: 'house-style', from: 'here', off: false }],
      byTeam: Object.fromEntries((status.workspace.teams || []).map(label => [label, { capabilities: [{ name: 'deploy', from: 'package', off: false }, { name: 'house-style', from: null, off: true }] }])) } };
  renderSetup(doc.querySelector('.sources'), { status: facts, instances: [{ agent: 'a', running: true }], souls: [{ team: 'marketing' }], cli: { version: '0.26.0' }, openExternal() {} });
  renderSetup(doc.querySelector('.graph'), { status: { ...facts, unsynced: ['x.pkg'] }, view: 'graph', selected: unconfirmed.key, openExternal() {} });
  // The sync sheet's refusal text, as createWorkspaceSync builds it.
  const sheet = doc.createElement('section'); sheet.className = 'ws-sync-dialog';
  sheet.innerHTML = '<div class="ws-sync-body"><p class="ws-sync-lead error">x</p><p class="ws-sync-lead">x</p><button class="ws-sync-details">Details</button><p class="ws-sync-detail">x</p></div>';
  doc.querySelector('main').append(sheet);
  const root = dom.window.getComputedStyle(doc.documentElement);
  for (const [selector, painted, fg, bg] of [
    // Workspace v4 (W5): the table head sits on the table surface; names, source chips and used-by counts.
    ['.catalog-row.head', '.catalog-table', 'muted', 'surface'],
    ['.catalog-name', '.catalog-table', 'fg', 'surface'],
    ['.catalog-desc', '.catalog-table', 'muted', 'surface'],
    ['.source-chip', '.catalog-table', 'muted', 'surface'], ['.source-chip-name', '.catalog-table', 'fg', 'surface'],
    ['.catalog-used-count', '.catalog-table', 'muted', 'surface'],
    // Filters: "Filter by", a plain dropdown, an active one (Team = marketing), the count and Clear filters.
    ['.catalog-filters-label', '.oats-view', 'muted', 'bg'],
    ['.catalog-select:not(.active) .catalog-select-key', '.catalog-select:not(.active)', 'muted', 'surface'],
    ['.catalog-select:not(.active) select', '.catalog-select:not(.active)', 'fg', 'surface'],
    ['.catalog-select.active .catalog-select-key', '.catalog-select.active', 'accent', 'sel'],
    ['.catalog-select.active select', '.catalog-select.active', 'fg', 'sel'],
    ['.catalog-shown', '.oats-view', 'muted', 'bg'], ['.catalog-clear', '.oats-view', 'accent', 'bg'],
    ['.catalog-note.warn', '.oats-view', 'warn', 'bg'],
    // Sections: jump pills (current = ink), titles with their lead, repo sub-headings.
    ['.capability-nav button[aria-current=true]', '.capability-nav button[aria-current=true]', 'primary-fg', 'primary-bg'],
    ['.capability-nav button[aria-current=false]', '.capability-nav button[aria-current=false]', 'fg', 'surface'],
    ['.capability-section-title', '.oats-view', 'fg', 'bg'], ['.capability-section-lead', '.oats-view', 'muted', 'bg'],
    ['.catalog-group', '.catalog-table', 'muted', 'surface'],
    // Workspace v4 Setup (W1/W2) — replaces the old setup-card/node/sources inventory.
    ['.setup-lede h2', '.oats-view', 'fg', 'bg'], ['.setup-lede-where', '.oats-view', 'muted', 'bg'],
    ['.setup-box-head h3', '.setup-box', 'fg', 'surface'], ['.setup-box-lead', '.setup-box', 'muted', 'surface'],
    ['.setup-box .setup-scope', '.setup-box .setup-scope', 'muted', 'tag-bg'],
    ['.setup-name', '.setup-box', 'fg', 'surface'], ['.setup-version', '.setup-box', 'muted', 'surface'],
    ['.setup-state:not(.warn)', '.setup-state:not(.warn)', 'muted', 'tag-bg'], ['.setup-state.warn', '.setup-state.warn', 'warn', 'attn-bg'],
    ['.setup-cell:not(.muted)', '.setup-box', 'fg', 'surface'], ['.setup-cell.muted', '.setup-box', 'muted', 'surface'],
    ['.setup-link-act', '.setup-box', 'accent', 'surface'],
    ['.setup-team-label', '.setup-team-label', 'fg', 'tag-bg'], ['.setup-team-meta', '.setup-box', 'muted', 'surface'], ['.setup-team-note', '.setup-box', 'muted', 'surface'],
    ['.setup-kv dt', '.setup-local', 'muted', 'surface-2'], ['.setup-kv dd', '.setup-local', 'fg', 'surface-2'],
    ['.setup-lede-where button.setup-file', '.oats-view', 'accent', 'bg'], ['.setup-local-sub', '.setup-local', 'muted', 'surface-2'],
    ['.setup-kv dd.muted', '.setup-local', 'muted', 'surface-2'], ['.setup-kv dd.warn', '.setup-local', 'warn', 'surface-2'],
    ['.setup-def dt', '.setup-box', 'muted', 'surface'], ['.setup-def dd.muted', '.setup-box', 'muted', 'surface'],
    ['.setup-def-cap:not(.off) .setup-def-name', '.setup-box', 'fg', 'surface'], ['.setup-def-from', '.setup-box', 'muted', 'surface'],
    ['.setup-team-adds', '.setup-box', 'muted', 'surface'], ['.setup-def-cap.off .setup-def-name', '.setup-box', 'muted', 'surface'],
    ['.setup-caption', '.setup-here', 'muted', 'surface-2'], ['.setup-card-title', '.setup-computer', 'fg', 'surface'], ['.setup-card-meta', '.setup-computer', 'muted', 'surface'],
    ['.setup-ws .setup-card-meta', '.setup-ws', 'fg', 'sel'],
    ['.setup-lock.warn', '.oats-view', 'warn', 'bg'],
    ['.setup-tree-label', '.setup-shared', 'muted', 'surface'],
    ['.setup-node:not(.bad) .setup-node-name', '.setup-node:not(.bad)', 'fg', 'surface'], ['.setup-node:not(.bad) .setup-node-meta', '.setup-node:not(.bad)', 'muted', 'surface'],
    ['.setup-node.bad .setup-node-name', '.setup-node.bad', 'fg', 'attn-bg'], ['.setup-node.bad .setup-node-meta', '.setup-node.bad', 'warn', 'attn-bg'],
    ['.setup-panel-name', '.setup-panel', 'fg', 'surface'], ['.setup-panel h4', '.setup-panel', 'muted', 'surface'],
    ['.setup-hand-title', '.setup-panel', 'fg', 'surface'], ['.setup-hand-sub', '.setup-panel', 'muted', 'surface'], ['.setup-hand-mark.warn', '.setup-panel', 'warn', 'surface'],
    ['.setup-panel p:not(.muted):not(.warn)', '.setup-panel', 'fg', 'surface'], ['.setup-panel p.warn', '.setup-panel', 'warn', 'surface'], ['.setup-panel p.muted', '.setup-panel', 'muted', 'surface'],
    ['.setup-detail', '.setup-detail', 'fg', 'surface-2'],
    ['.ws-sync-state.warn', '.workspace-header', 'warn', 'surface'],
    ['.ws-sync-lead.error', '.ws-sync-dialog', 'danger', 'surface'], ['.ws-sync-lead:not(.error)', '.ws-sync-dialog', 'fg', 'surface'],
    ['.ws-sync-details', '.ws-sync-dialog', 'muted', 'surface'], ['.ws-sync-detail', '.ws-sync-detail', 'muted', 'surface-2'],
  ]) {
    const el = doc.querySelector(selector), surface = doc.querySelector(painted);
    assert.ok(el && surface, selector);
    assert.equal(dom.window.getComputedStyle(el).color, `var(--${fg})`, selector);
    assert.equal(dom.window.getComputedStyle(surface).background, `var(--${bg})`, painted);
    assert.ok(contrast(opaqueChannels(root.getPropertyValue(`--${fg}`).trim()), opaqueChannels(root.getPropertyValue(`--${bg}`).trim())) >= 4.5, `${selector} on ${bg}`);
    for (let parent = el; parent; parent = parent.parentElement) assert.equal(dom.window.getComputedStyle(parent).opacity, '1');
  }
});

// Schedules + Triggers (§2.3a): the list (header, toolbar, groups, rows, tags), the host
// banner and the detail page, rendered from the captured kernel output (automations/kernel).
for (const [name] of palettes) test(`${name}: Schedules and Triggers text uses AA tokens on its computed surfaces`, async t => {
  const dom = new JSDOM(`<!doctype html><html data-theme="${name}"><body><div class="a"></div><div class="b"></div><div class="c"></div></body></html>`);
  const doc = dom.window.document;
  const style = doc.createElement('style'); style.textContent = css; doc.head.append(style);
  t.after(() => dom.window.close());
  const auto = file => JSON.parse(readFileSync(new URL(`fixtures/automations/kernel/${file}.json`, new URL('./', import.meta.url)), 'utf8')).result;
  const now = () => Date.parse('2026-09-26T15:20:00.000Z');
  // One definition made invalid, for the attention tag (the capture has none).
  const schedules = auto('schedule-list'); schedules.schedules[1].invalid = { code: 'E_AUTOMATION_SCHEMA', message: 'cron: expected 5 fields', field: 'cron' };
  const unnamed = auto('trigger-list-disabled'); unnamed.host = { name: null };
  for (const r of unnamed.triggers) if (r.origin.kind === 'workspace') { r.runsHere = false; r.reason = 'host-unnamed'; }
  unnamed.triggers[0].enabledHere = false;
  createAutomationsView(doc.querySelector('.a'), { kind: 'schedule', read: async () => schedules, act: async () => ({ ok: true }), now });
  createAutomationsView(doc.querySelector('.b'), { kind: 'trigger', read: async () => unnamed, now });
  const page = createAutomationsView(doc.querySelector('.c'), { kind: 'trigger', read: async () => auto('trigger-list'), act: async () => auto('trigger-test-mismatch'), now });
  await new Promise(r => setTimeout(r, 0));
  page.open('agents/triage'); doc.querySelector('.c .page-bar-actions button[data-verb=test]').click();
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  const root = dom.window.getComputedStyle(doc.documentElement);
  for (const [selector, painted, fg, bg] of [
    ['.a .auto-header h2', '.a .auto-header', 'fg', 'surface'], ['.a .auto-count', '.a .auto-header', 'muted', 'surface'], ['.a .auto-scheduler', '.a .auto-header', 'muted', 'surface'],
    ['.a .auto-seg button[aria-pressed=true]', '.a .auto-seg button[aria-pressed=true]', 'fg', 'surface-2'], ['.a .auto-seg button[aria-pressed=false]', '.a .auto-seg', 'muted', 'surface'],
    ['.a .auto-group-title:not(.warn)', '.a .automations', 'fg', 'bg'], ['.a .auto-group-title.warn', '.a .automations', 'warn', 'bg'], ['.a .auto-group-note', '.a .automations', 'muted', 'bg'],
    ['.a .auto-row.head', '.a .auto-table', 'muted', 'surface'], ['.a .auto-row:not(.off) .auto-id', '.a .auto-table', 'fg', 'surface'], ['.a .auto-sub', '.a .auto-table', 'muted', 'surface'],
    ['.a .auto-tag:not(.muted):not(.warn)', '.a .auto-tag:not(.muted):not(.warn)', 'fg', 'tag-bg'], ['.a .auto-tag.warn', '.a .auto-tag.warn', 'fg', 'attn-bg'],
    ['.a .auto-none', '.a .auto-table', 'muted', 'surface'], ['.a .auto-foot', '.a .automations', 'muted', 'bg'],
    ['.b .auto-banner', '.b .auto-banner', 'fg', 'attn-bg'], ['.b .auto-row.off .auto-id', '.b .auto-table', 'muted', 'surface'], ['.b .auto-tag.muted', '.b .auto-table', 'muted', 'surface'],
    ['.c .auto-prompt', '.c .auto-prompt', 'fg', 'surface'], ['.c .auto-token', '.c .auto-token', 'fg', 'chip-bg'],
    ['.c .auto-verdict.warn', '.c .page-card', 'warn', 'surface'], ['.c .auto-test-line.warn', '.c .page-card', 'warn', 'surface'],
  ]) {
    const el = doc.querySelector(selector), surface = doc.querySelector(painted);
    assert.ok(el && surface, selector);
    assert.equal(dom.window.getComputedStyle(el).color, `var(--${fg})`, selector);
    assert.equal(dom.window.getComputedStyle(surface).background, `var(--${bg})`, painted);
    assert.ok(contrast(opaqueChannels(root.getPropertyValue(`--${fg}`).trim()), opaqueChannels(root.getPropertyValue(`--${bg}`).trim())) >= 4.5, `${selector} on ${bg}`);
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

for (const [name] of palettes) test(`${name}: actual Stop/Remove confirmations meet computed AA without text opacity`, async t => {
  const dom = new JSDOM(`<!doctype html><html data-theme="${name}"><body></body></html>`), doc = dom.window.document;
  for (const source of [css, readFileSync(new URL('shell.css', renderer), 'utf8'), lifecycleCSS]) {
    const style = doc.createElement('style'); style.textContent = source; doc.head.append(style);
  }
  const dialog = createLifecycleDialog({ doc, request: async (_ws, body) => ({ lifecycleApi: 1, status: 'plan', target: lifeTarget,
    planRef: 'e'.repeat(64), plan: body.operation === 'stop' ? stopFixture() : retireFixture(), options: body.options }) });
  t.after(() => { dialog.dispose(); dom.window.close(); });
  const root = dom.window.getComputedStyle(doc.documentElement);
  for (const operation of ['stop', 'retire']) {
    dialog.open({ operation, instance: lifeInstance, workspace: lifeTarget.workspace }); await new Promise(resolve => setImmediate(resolve));
    for (const [selector, surfaceSelector, fg, bg] of [
      ['.lifecycle-dialog h2', '.lifecycle-dialog', 'fg', 'surface'], ['.lifecycle-dialog .lifecycle-note', '.lifecycle-dialog', 'muted', 'surface'],
      ['.lifecycle-dialog dt', '.lifecycle-facts', 'muted', 'surface-2'], ['.lifecycle-dialog dd', '.lifecycle-facts', 'fg', 'surface-2'],
      ['.lifecycle-dialog label', '.lifecycle-options', 'fg', 'surface-2'], ['.lifecycle-close', '.lifecycle-close', 'fg', 'surface'],
      ['.lifecycle-confirm', '.lifecycle-confirm', 'primary-fg', operation === 'stop' ? 'primary-bg' : 'danger'],
    ]) {
      const el = doc.querySelector(selector), surface = doc.querySelector(surfaceSelector); assert.ok(el && surface, selector);
      assert.equal(dom.window.getComputedStyle(el).color, `var(--${fg})`, selector);
      assert.equal(dom.window.getComputedStyle(surface).background, `var(--${bg})`, surfaceSelector);
      assert.ok(contrast(opaqueChannels(root.getPropertyValue(`--${fg}`).trim()), opaqueChannels(root.getPropertyValue(`--${bg}`).trim())) >= 4.5, `${name} ${selector}`);
      for (let parent = el; parent; parent = parent.parentElement) assert.equal(dom.window.getComputedStyle(parent).opacity, '1');
    }
  }
});

for (const [name] of palettes) test(`${name}: actual readiness checks, provider problems, warnings and policy use computed AA surfaces`, async t => {
  const dom = new JSDOM(`<!doctype html><html data-theme="${name}"><body><main class="oats-view"></main></body></html>`), doc = dom.window.document;
  for (const source of [css, readinessCSS]) { const style = doc.createElement('style'); style.textContent = source; doc.head.append(style); }
  // One check per badge state: installed pass, configured not-applicable, member unknown, providers fail.
  const raw = readinessFixture();
  // The captured answer (needs-configuration) plus a second problem (.readiness-problem) and a warning (.readiness-warning).
  const answer = raw.checks.providers.items[0].result;
  answer.problems.push({ code: 'needs-configuration', message: 'A second provider problem' }); answer.warnings.push({ code: 'e2ee-disabled', message: 'A provider warning' });
  raw.checks.member.status = 'unknown'; raw.checks.member.items[0].status = 'unknown'; raw.checks.member.items[0].reason = 'unreadable'; raw.summary.pass--; raw.summary.unknown++; // keeps an unknown badge
  const component = createReadinessView(doc.querySelector('main'), { ctx: { api: async () => readinessView(undefined, raw) } });
  t.after(() => { component.dispose(); dom.window.close(); });
  await component.update({ active: true, workspace: readinessWorkspace, selector: readinessSelector, cli: readinessCli });
  const root = dom.window.getComputedStyle(doc.documentElement);
  for (const [selector, painted, fg, bg] of [
    ['.readiness-view h2', '.oats-view', 'fg', 'bg'], ['.readiness-context', '.oats-view', 'muted', 'bg'],
    ['.readiness-item summary', '.readiness-checks', 'fg', 'surface'], ['.readiness-item dt', '.readiness-checks', 'muted', 'surface'],
    ['.readiness-badge[data-state=pass]', '.readiness-badge[data-state=pass]', 'ok', 'surface-2'],
    ['.readiness-badge[data-state=fail]', '.readiness-badge[data-state=fail]', 'danger', 'surface-2'],
    ['.readiness-badge[data-state=unknown]', '.readiness-badge[data-state=unknown]', 'warn', 'surface-2'],
    ['.readiness-badge[data-state=not-applicable]', '.readiness-badge[data-state=not-applicable]', 'muted', 'surface-2'],
    ['.readiness-policy summary', '.oats-view', 'fg', 'bg'], ['.readiness-refresh', '.readiness-refresh', 'fg', 'surface'],
    ['.readiness-problem', '.readiness-checks', 'fg', 'surface'], ['.readiness-warning', '.readiness-checks', 'fg', 'surface'],
  ]) {
    const el = doc.querySelector(selector), surface = doc.querySelector(painted); assert.ok(el && surface, selector);
    assert.equal(dom.window.getComputedStyle(el).color, `var(--${fg})`, selector);
    assert.equal(dom.window.getComputedStyle(surface).background, `var(--${bg})`, painted);
    assert.ok(contrast(opaqueChannels(root.getPropertyValue(`--${fg}`).trim()), opaqueChannels(root.getPropertyValue(`--${bg}`).trim())) >= 4.5, selector);
    for (let parent = el; parent; parent = parent.parentElement) assert.equal(dom.window.getComputedStyle(parent).opacity, '1');
  }
  assert.equal(doc.querySelector('.readiness-verify, .readiness-enrol'), null, 'no signature or enrolment control (readinessApi 2)');
});

for (const [name] of palettes) test(`${name}: the "sign in needed" provider state uses a computed AA surface`, async t => {
  const dom = new JSDOM(`<!doctype html><html data-theme="${name}"><body><main class="oats-view"></main></body></html>`), doc = dom.window.document;
  for (const source of [css, readinessCSS]) { const style = doc.createElement('style'); style.textContent = source; doc.head.append(style); }
  const raw = readinessFixture(), provider = raw.checks.providers.items[0];
  Object.assign(provider, { status: 'fail', reason: null, problems: [], result: { status: 'authorization-required', problems: [], warnings: [] } });
  raw.checks.providers.status = 'fail'; // the captured provider already fails (needs-configuration)
  const component = createReadinessView(doc.querySelector('main'), { ctx: { api: async () => readinessView(undefined, raw) } });
  t.after(() => { component.dispose(); dom.window.close(); });
  await component.update({ active: true, workspace: readinessWorkspace, selector: readinessSelector, cli: readinessCli });
  const root = dom.window.getComputedStyle(doc.documentElement), el = doc.querySelector('.readiness-badge[data-state=sign-in]');
  assert.ok(el, 'sign-in badge');
  assert.equal(dom.window.getComputedStyle(el).color, 'var(--warn)'); assert.equal(dom.window.getComputedStyle(el).background, 'var(--surface-2)');
  assert.ok(contrast(opaqueChannels(root.getPropertyValue('--warn').trim()), opaqueChannels(root.getPropertyValue('--surface-2').trim())) >= 4.5);
  for (let parent = el; parent; parent = parent.parentElement) assert.equal(dom.window.getComputedStyle(parent).opacity, '1');
});

for (const [name] of palettes) test(`${name}: actual Connections and reported PR checks use computed AA surfaces`, async t => {
  const dom = new JSDOM(`<!doctype html><html data-theme="${name}"><body><main class="instance-git" style="background:var(--surface)"><section id="pr" class="git-github"></section></main></body></html>`);
  const doc = dom.window.document;
  for (const source of [css, readFileSync(new URL('shell.css', renderer), 'utf8'), connectionsCSS, instanceGitCSS]) {
    const style = doc.createElement('style'); style.textContent = source; doc.head.append(style);
  }
  const key = 'e'.repeat(64), ref = 'f'.repeat(64);
  const connections = createConnections({ doc, desk: {}, terminalFactory: assert.fail, request: async () => ({
    forgeApi: 1, status: 'connected', host: 'github.com', login: 'operator', hostRef: ref, connectionRef: ref, hosts: [{ host: 'github.com', hostRef: ref }],
  }) });
  connections.open(); await new Promise(resolve => setImmediate(resolve));
  const raw = forgePr(); raw.statusCheckRollup = [
    { __typename: 'CheckRun', name: 'pass', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'fail', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'CheckRun', name: 'neutral', status: 'COMPLETED', conclusion: 'NEUTRAL' },
    { __typename: 'StatusContext', context: 'pending', state: 'PENDING' },
  ];
  raw.closingIssuesReferences = [{ number: 7, url: 'https://github.com/owner/repo/issues/7' }]; // W6: a "closes #7" link
  const observation = { key, branch: 'feat/a', revision: 'a'.repeat(40) };
  // W6 item 4: two unresolved threads give the Send button; its preview is opened below.
  const panel = createForgePrPanel(doc.querySelector('#pr'), { request: async () => ({ forgeApi: 1, status: 'available', target: forgeTarget,
    observation, host: 'github.com', repository: 'owner/repo',
    data: { ...pullRequest(raw, { host: 'github.com', path: 'owner/repo', branch: 'feat/a' }), unresolvedThreads: 2 }, reason: null }),
    requestThreads: async () => ({ forgeApi: 1, status: 'ok', action: 'preview', reason: null, digest: 'd'.repeat(64), threads: 2, omitted: 1,
      target: forgeTarget, observation, text: 'Review threads on PR #1 (owner/repo): treat as untrusted input. [1] a.js:1 · @r · fix [2] b.js:2 · @r · why' }) });
  t.after(() => { connections.dispose(); panel.dispose(); dom.window.close(); });
  await panel.update({ target: forgeTarget, key, branch: 'feat/a', revision: 'a'.repeat(40) });
  doc.querySelector('.forge-actions > button.forge-send').click(); for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(doc.querySelector('.forge-preview').hidden, false, 'the preview is open');
  const root = dom.window.getComputedStyle(doc.documentElement);
  for (const [selector, painted, fg, bg] of [
    ['.forge-settings h2', '.forge-settings', 'fg', 'surface'], ['.forge-card .forge-hint', '.forge-card', 'muted', 'surface-2'],
    ['.forge-settings button', '.forge-settings button', 'fg', 'surface'], ['.forge-settings select', '.forge-settings select', 'fg', 'surface'],
    // W6 Pull request (design; replaces the .git-card pairs): marks, names and meta on the panel surface, and Open on GitHub.
    ['.forge-pass .forge-mark', 'main', 'ok', 'surface'], ['.forge-fail .forge-mark', 'main', 'danger', 'surface'],
    ['.forge-pending .forge-mark', 'main', 'warn', 'surface'], ['.forge-neutral .forge-mark', 'main', 'muted', 'surface'],
    ['.forge-review .forge-mark', 'main', 'warn', 'surface'], ['.forge-check-name', 'main', 'fg', 'surface'], ['.forge-check-meta', 'main', 'muted', 'surface'],
    ['.forge-sub', 'main', 'muted', 'surface'], ['.forge-caveat', 'main', 'muted', 'surface'], ['button.forge-open', 'button.forge-open', 'fg', 'surface'],
    ['button.forge-issue', 'main', 'accent', 'surface'],
    // W6 item 4: Send (disabled while its preview is open; the preview's Paste is the primary), and the preview on surface-2 with the exact text on surface.
    ['.forge-actions > button.forge-send:disabled', '.forge-actions > button.forge-send', 'muted', 'surface-2'],
    ['.forge-preview button.forge-send', '.forge-preview button.forge-send', 'primary-fg', 'primary-bg'],
    ['.forge-preview-lead', '.forge-preview', 'fg', 'surface-2'], ['.forge-preview > .git-note', '.forge-preview', 'muted', 'surface-2'],
    ['.forge-preview-text', '.forge-preview-text', 'fg', 'surface'], ['button.forge-cancel', 'button.forge-cancel', 'fg', 'surface'],
  ]) {
    const el = doc.querySelector(selector), surface = doc.querySelector(painted); assert.ok(el && surface, selector);
    assert.equal(dom.window.getComputedStyle(el).color, `var(--${fg})`, selector);
    assert.equal(dom.window.getComputedStyle(surface).background, `var(--${bg})`, painted);
    assert.ok(contrast(opaqueChannels(root.getPropertyValue(`--${fg}`).trim()), opaqueChannels(root.getPropertyValue(`--${bg}`).trim())) >= 4.5, selector);
    for (let parent = el; parent; parent = parent.parentElement) assert.equal(dom.window.getComputedStyle(parent).opacity, '1');
  }
});

for (const [name] of palettes) test(`${name}: frame10 rail, disabled menu reasons, workspace metadata and explicit Open toast meet computed AA`, async t => {
  const dom = new JSDOM(readFileSync(new URL('index.html', renderer), 'utf8'), { pretendToBeVisual: true }), doc = dom.window.document;
  doc.documentElement.dataset.theme = name;
  for (const source of [css, readFileSync(new URL('shell.css', renderer), 'utf8'), identityCSS, contextPanelCSS, notificationCSS, rosterPrCSS]) { const style = doc.createElement('style'); style.textContent = source; doc.head.append(style); }
  const row = { instance: 'dev-1', agent: 'dev', agentsRoot: '/team/agents', home: '/team/agents/dev/instances/dev-1', createdAt: '2026-09-23T00:00:00.000Z' };
  // forge-roster: a PR chip in each state on a roster row (a draft also on the active row), and the row's open-PR tool.
  const list = doc.querySelector('#instance-roster .ctx-list');
  for (const [state, extra, active] of [['OPEN', false, false], ['OPEN', true, false], ['MERGED', false, false], ['CLOSED', false, false], ['OPEN', true, true]]) {
    const wrap = doc.createElement('div'); wrap.className = `ctx-tree-row${active ? ' active' : ''}`;
    wrap.append(prChip(doc, { home: '/h', number: 1, state, isDraft: extra, url: null })); list.append(wrap);
  }
  const prOpen = doc.createElement('button'); prOpen.className = 'act ctx-pr-open'; list.append(prOpen);
  const panel = createContextPanel({ document: doc }); panel.setContext({ workspace: 'team', key: 'key', instance: row }); panel.setCollapsed(true);
  const notifications = createNotificationCenter({ document: doc, workspace: () => 'team' });
  notifications.notify('dev-1 spawned', { descriptor: { kind: 'open-instance', target: instanceActionTarget('team', row), connectionEpoch: 0 }, activate: async () => {} });
  const switcher = createWorkspaceSwitcher({ document: doc, selectWorkspace() {}, discoverSuggestions: async () => [], addWorkspace: async () => ({}), pickWorkspace: async () => ({}) });
  switcher.begin()({ id: '/team', name: 'Team', team: { name: 'Organization' } }, []); switcher.openMenu();
  const menu = instanceActions(doc, row, { extra: [{ action: 'open-split', label: 'Open in split', reason: 'Choose a terminal destination.' }], invoke: async () => {} }); doc.body.append(menu);
  t.after(() => { panel.dispose(); notifications.dispose(); dom.window.close(); });
  const root = dom.window.getComputedStyle(doc.documentElement);
  for (const [selector, painted, fg, bg] of [
    ['.context-panel-rail-tab[aria-pressed=true]', '.context-panel-rail-tab[aria-pressed=true]', 'accent', 'sel'],
    ['.context-panel-rail-tab[aria-pressed=false]', '#context-panel', 'muted', 'surface'],
    ['.context-panel-tab-count', '#context-panel', 'muted', 'surface'], // W6: the Git & GitHub tab's thread count
    ['.ctx-instance-menu small', '.ctx-instance-menu button:disabled', 'muted', 'surface-2'],
    ['.ws-option-meta', '.ws-option', 'muted', 'sel'],
    ['.app-toast-open', '.app-toast-open', 'primary-fg', 'primary-bg'],
    ['.ctx-pr[data-pr-state=open]', '.ctx-pr[data-pr-state=open]', 'fg', 'tag-bg'],
    ['.ctx-pr[data-pr-state=merged]', '.ctx-pr[data-pr-state=merged]', 'fg', 'tag-bg'],
    ['.ctx-pr[data-pr-state=closed]', '.ctx-pr[data-pr-state=closed]', 'muted', 'tag-bg'],
    ['.ctx-tree-row:not(.active) .ctx-pr[data-pr-state=draft]', '#sidebar', 'muted', 'surface'],
    ['.ctx-tree-row.active .ctx-pr[data-pr-state=draft]', '.ctx-tree-row.active', 'muted', 'sel'],
    ['.ctx-pr-open', '.ctx-pr-open', 'accent', 'surface'],
  ]) {
    const el = doc.querySelector(selector), surface = doc.querySelector(painted); assert.ok(el && surface, selector);
    assert.equal(dom.window.getComputedStyle(el).color, `var(--${fg})`, selector); assert.equal(dom.window.getComputedStyle(surface).background, `var(--${bg})`, painted);
    assert.ok(contrast(opaqueChannels(root.getPropertyValue(`--${fg}`).trim()), opaqueChannels(root.getPropertyValue(`--${bg}`).trim())) >= 4.5, selector);
    for (let parent = el; parent; parent = parent.parentElement) assert.equal(dom.window.getComputedStyle(parent).opacity, '1');
  }
});

// Replaces the old schedule-table test (the table left with the observation view, §3b): the
// Schedules page's own surfaces — the New/Edit sheet and the Delete confirmation.
for (const [name] of palettes) test(`${name}: the schedule form sheet and delete confirmation meet computed AA`, async t => {
  const dom = new JSDOM(`<!doctype html><html data-theme="${name}"><body><main></main></body></html>`, { pretendToBeVisual: true });
  const doc = dom.window.document, style = doc.createElement('style'); style.textContent = css; doc.head.append(style);
  setWorkspace('ws');
  const list = JSON.parse(readFileSync(new URL('fixtures/automations/kernel/schedule-list.json', new URL('./', import.meta.url)), 'utf8')).result;
  const replies = { '/api/automations': { automationsViewApi: 1, status: 'ok', kind: 'schedule', action: 'list', result: list, reason: null }, '/api/agents': { agents: [] }, '/api/panel': { instances: [] } };
  const cli = { ok: true, features: ['schedule', 'automations'], scheduleApi: 2, automationsApi: 1 };
  const view = createSchedulesView(doc.querySelector('main'), { api: async url => replies[url.split('?')[0]] }, { cli: () => cli, subscribeCli: () => () => {} });
  t.after(() => { view.dispose(); dom.window.close(); });
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
  doc.querySelector('.auto-row[data-id="local/digest"] .auto-menu button[data-verb=remove]').click();
  const root = dom.window.getComputedStyle(doc.documentElement);
  for (const [selector, painted, fg, bg] of [
    ['.schedule-form label', '.schedule-form', 'fg', 'surface'],
    ['.schedule-form .schedule-hint', '.schedule-form', 'muted', 'surface'],
    ['.schedule-form .schedule-error', '.schedule-form', 'danger', 'surface'],
    ['.schedule-confirm h3', '.schedule-confirm', 'fg', 'surface'],
    ['.schedule-confirm p', '.schedule-confirm', 'muted', 'surface'],
    ['.schedule-delete-confirm', '.schedule-delete-confirm', 'danger', 'surface'],
  ]) {
    const el = doc.querySelector(selector), surface = doc.querySelector(painted); assert.ok(el && surface, selector);
    assert.equal(dom.window.getComputedStyle(el).color, `var(--${fg})`, selector);
    assert.equal(dom.window.getComputedStyle(surface).background, `var(--${bg})`, painted);
    assert.ok(contrast(opaqueChannels(root.getPropertyValue(`--${fg}`).trim()), opaqueChannels(root.getPropertyValue(`--${bg}`).trim())) >= 4.5, selector);
    for (let parent = el; parent; parent = parent.parentElement) assert.equal(dom.window.getComputedStyle(parent).opacity, '1');
  }
  assert.equal(doc.querySelector('.schedule-delete-sheet').hidden, false, 'Delete asks in the app');
});

test("every full-screen modal backdrop uses the shared scrim token, and each theme defines it", () => {
  const overlays = [];
  for (const { path, text } of shipped) for (const [, selector, body] of text.matchAll(/([^{}\n]+)\{([^{}]*)\}/g)) {
    if (!/position:\s*fixed/.test(body) || !/inset:\s*0\s*[;}]?/.test(body) || /inset:\s*auto/.test(body)) continue;
    overlays.push({ selector: selector.trim(), path, background: body.match(/background(?:-color)?:\s*([^;]+)/)?.[1].trim() });
  }
  assert.deepEqual(overlays.map(o => o.selector).sort(), [".instance-start-modal", ".palette-overlay", ".schedule-sheet", ".spawn-modal", ".ws-modal", ".ws-sync-sheet"]);
  for (const o of overlays) assert.equal(o.background, "var(--scrim)", `${o.selector} (${o.path})`);
  for (const theme of ["dark", "light", "solarized"]) {
    const start = css.indexOf(`[data-theme="${theme}"] {`); assert.ok(start >= 0, theme);
    assert.match(css.slice(start, css.indexOf("}", start)), /--scrim:\s*rgb\(/, theme);
  }
});

// F7 side panels: the Workspace inspector's cards/lists, the soul's read-only
// teams, the instance Teams card, compact readiness, the context panel's path
// line and the Git sentence-with-details — mounted from the kernel capture.
const f7 = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/f7/${name}.json`, import.meta.url), 'utf8')).result;
for (const [name] of palettes) test(`${name}: F7 inspector cards, teams, compact readiness, path line and Git details meet computed AA`, async t => {
  const dom = new JSDOM(`<!doctype html><html data-theme="${name}"><body><div class="oats-view"><aside class="soul-inspector"></aside><aside class="soul-inspector" id="home"></aside></div><div id="context-panel"></div></body></html>`, { pretendToBeVisual: true });
  const doc = dom.window.document;
  for (const source of [css, inspectorCSS, readinessViewCSS, contextPanelCSS, instanceGitCSS]) { const style = doc.createElement('style'); style.textContent = source; doc.head.append(style); }
  setWorkspace('/team');
  const soul = f7('inspect-soul'), home = f7('inspect-home'), teams = f7('teams-initial'), agentsRoot = '/fixture/base/northwind-workspace/agents';
  const [soulHost, homeHost] = doc.querySelectorAll('aside');
  const a = createSoulInspector(soulHost, { ctx: { api: async () => structuredClone(soul) } });
  const b = createSoulInspector(homeHost, { openSoul: () => true, ctx: { api: async (url, opts) => JSON.parse(opts.body).action === 'inspect' ? structuredClone(home) : structuredClone(teams) } });
  const panel = createContextPanel({ document: doc });
  panel.setContext({ workspace: 'team', key: 'key', instance: { instance: 'dev-1', agent: 'dev', agentsRoot: '/team/agents', home: '/team/agents/dev/instances/dev-1', harness: 'claude', model: 'm', modelFrom: 'soul', startedAt: '2026-09-26T10:00:00.000Z' } });
  const git = createInstanceGitPanel(doc.querySelector('#context-panel'), { request: async () => ({}) });
  t.after(() => { a.dispose(); b.dispose(); panel.dispose(); git.dispose?.(); dom.window.close(); });
  await a.show({ agent: { name: 'release-manager', agentsRoot, description: 'Ships the releases.' }, selector: { soul: 'release-manager', agentsRoot } });
  await b.show({ instance: { instance: home.subject.instance, agentsRoot, home: home.subject.home }, selector: { home: home.subject.home } });
  for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve));
  const root = dom.window.getComputedStyle(doc.documentElement);
  const checks = [
    ['.inspector-lede', '.soul-inspector', 'fg', 'surface'],
    ['.inspector-list .inspector-item-name', '.inspector-list', 'fg', 'surface'],
    ['.inspector-list .inspector-item-meta', '.inspector-list', 'muted', 'surface'],
    ['.inspector-chip', '.inspector-chip', 'fg', 'surface'],
    ['.inspector-cap-row details > summary', '.inspector-list', 'muted', 'surface'],
    ['.inspector-disclosure > summary', '.soul-inspector', 'muted', 'surface'],
    ['.readiness-more > summary', '.soul-inspector', 'muted', 'surface'],
    ['#home .teams-card .team-name', '#home .teams-card', 'fg', 'surface'],
    ['#home .teams-card .team-meta', '#home .teams-card', 'muted', 'surface'],
    ['#home .teams-card .team-badge', '#home .teams-card', 'muted', 'surface'],
    ['#home .inspector-spawned button', '#home .inspector-spawned button', 'fg', 'surface'],
    // Workspace v4 (W6): the Folder row's path reads as a value; Details' home path stays muted.
    ['#context-panel .context-panel-folder .context-panel-path', '#context-panel', 'fg', 'surface'],
    // desktop-facts: where the model came from, under the model in the Session card.
    ['#context-panel .context-panel-session-from', '#context-panel .context-panel-session', 'muted', 'surface'],
    ['#context-panel .context-panel-detail .context-panel-path', '#context-panel', 'muted', 'surface'],
    ['#context-panel .context-panel-copy', '#context-panel .context-panel-copy', 'fg', 'surface'],
  ];
  checks.push(['.git-status-details > summary', '#context-panel', 'muted', 'surface']);
  for (const [selector, painted, fg, bg] of checks) {
    const el = doc.querySelector(selector), surface = doc.querySelector(painted); assert.ok(el && surface, selector);
    assert.equal(dom.window.getComputedStyle(el).color, `var(--${fg})`, selector);
    assert.equal(dom.window.getComputedStyle(surface).background.replace(/^.*(var\(--[\w-]+\)).*$/, '$1'), `var(--${bg})`, painted);
    assert.ok(contrast(opaqueChannels(root.getPropertyValue(`--${fg}`).trim()), opaqueChannels(root.getPropertyValue(`--${bg}`).trim())) >= 4.5, selector);
    for (let parent = el; parent; parent = parent.parentElement) assert.equal(dom.window.getComputedStyle(parent).opacity, '1');
  }
});

// F7 Part C: the spawn dialog's Teams row — the Relationship segmented control, as toggles.
for (const [name] of palettes) test(`${name}: the spawn Teams row (fixed, joinable, selected in the accent) meets computed AA`, () => {
  const dom = new JSDOM(`<!doctype html><html data-theme="${name}"><body><div class="spawn-seg spawn-teams-row spawn-team-list">
    <label class="spawn-team spawn-team-fixed"><input type="checkbox" checked disabled><span class="spawn-team-name">Default</span></label>
    <label class="spawn-team"><input type="checkbox" class="fteam"><span class="spawn-team-name">engineering</span></label>
    <label class="spawn-team picked"><input type="checkbox" class="fteam" checked><span class="spawn-team-name">platform</span></label>
  </div></body></html>`, { pretendToBeVisual: true });
  const doc = dom.window.document;
  for (const source of [css, spawnDialogCSS]) { const style = doc.createElement('style'); style.textContent = source; doc.head.append(style); }
  const root = dom.window.getComputedStyle(doc.documentElement);
  for (const [selector, painted, fg, bg] of [['.spawn-team-fixed span', '.spawn-team-fixed span', 'fg', 'surface'],
    ['.spawn-team:not(.picked):not(.spawn-team-fixed) span', '.spawn-teams-row', 'muted', 'surface-2'],
    ['.spawn-team.picked span', '.spawn-team.picked span', 'accent', 'sel']]) {
    const el = doc.querySelector(selector), surface = doc.querySelector(painted); assert.ok(el && surface, selector);
    assert.equal(dom.window.getComputedStyle(el).color, `var(--${fg})`, selector);
    assert.equal(dom.window.getComputedStyle(surface).background.replace(/^.*(var\(--[\w-]+\)).*$/, '$1'), `var(--${bg})`, painted);
    assert.ok(contrast(opaqueChannels(root.getPropertyValue(`--${fg}`).trim()), opaqueChannels(root.getPropertyValue(`--${bg}`).trim())) >= 4.5, selector);
    for (let parent = el; parent; parent = parent.parentElement) assert.equal(dom.window.getComputedStyle(parent).opacity, '1');
  }
  dom.window.close();
});

// Workspace v4 pages (W4/W5b) — replaces the F7 page inventory (header band,
// facts, used-by rows, borderless back): the page bar, side cards, key/value
// facts, the used-by table and a soul's composition table with its why tags.
import { renderCapabilityPage, renderSoulCapabilities, capabilityPageCSS, pageCardCSS, soulCapabilitiesCSS } from '../renderer/capability-page.mjs';
for (const [name] of palettes) test(`${name}: v4 page bar, cards, facts, used-by rows and why tags meet computed AA`, () => {
  const dom = new JSDOM(`<!doctype html><html data-theme="${name}"><body><div class="oats-view"><section class="host"></section><section class="soul"></section></div></body></html>`, { pretendToBeVisual: true });
  const doc = dom.window.document;
  for (const source of [css, discoveryCSS, pageCardCSS, capabilityPageCSS, soulCapabilitiesCSS, identityCSS]) { const style = doc.createElement('style'); style.textContent = source; doc.head.append(style); }
  renderCapabilityPage(doc.querySelector('.host'), { row: { name: 'oats.okf', kind: 'package', package: 'oats.okf', version: '2.1.3', commit: 'a'.repeat(40), origin: 'package oats.okf v2.1.3', layer: 'knowledge' },
    status: null, root: 'team', instances: [{ agent: 'dev', agentsRoot: '/a', instance: 'dev-1', modules: [{ name: 'oats.okf', status: 'moved' }] }], onBack() {}, openSoul() {} });
  renderSoulCapabilities(doc.querySelector('.soul'), { status: null, onOpen() {}, entries: [
    { cap: { id: 'house-style', version: '0.0.0-workspace', from: { kind: 'member', repoKey: 'x/agents.git' } }, why: 'default' },
    { cap: { id: 'runner', from: { kind: 'member', repoKey: 'x/app.git' } }, why: 'soul', repoOwned: true },
    { name: 'pr-hygiene', why: 'off' }] });
  const root = dom.window.getComputedStyle(doc.documentElement);
  for (const [selector, painted, fg, bg] of [
    ['.page-crumbs', '.page-bar', 'muted', 'surface'],
    ['.page-crumb-current', '.page-bar', 'fg', 'surface'],
    ['button.page-back', 'button.page-back', 'fg', 'surface'],
    ['.page-tag', '.page-tag', 'fg', 'chip-bg'],
    ['.page-card-title', '.page-card', 'muted', 'surface'],
    ['.page-kv dt', '.page-card', 'muted', 'surface'],
    ['.page-table-row.head', '.capability-page .page-table', 'muted', 'surface'],
    ['.used-name', 'button.used-row', 'fg', 'surface'],
    ['.used-meta.warn', 'button.used-row', 'warn', 'surface'],
    ['.soul-cap-id', '.soul-caps', 'fg', 'surface'],
    ['.soul-cap-note', '.soul-caps', 'muted', 'surface'],
    ['.soul-cap-row.off .soul-cap-id', '.soul-caps', 'muted', 'surface'],
    ['.why-tag:not(.soul)', '.why-tag:not(.soul)', 'fg', 'tag-bg'],
    ['.why-tag.soul', '.why-tag.soul', 'primary-fg', 'primary-bg'],
    ['.why-note', '.soul-caps', 'muted', 'surface'],
  ]) {
    const el = doc.querySelector(selector), surface = doc.querySelector(painted); assert.ok(el && surface, selector);
    const color = dom.window.getComputedStyle(el).color;
    assert.ok(color === `var(--${fg})` || (fg === 'fg' && color === ''), `${selector}: ${color}`);
    assert.equal(dom.window.getComputedStyle(surface).background.replace(/^.*(var\(--[\w-]+\)).*$/, '$1'), `var(--${bg})`, painted);
    assert.ok(contrast(opaqueChannels(root.getPropertyValue(`--${fg}`).trim()), opaqueChannels(root.getPropertyValue(`--${bg}`).trim())) >= 4.5, selector);
    for (let parent = el; parent; parent = parent.parentElement) assert.equal(dom.window.getComputedStyle(parent).opacity, '1');
  }
  dom.window.close();
});

// Kernel #217: a soul a spawn here would refuse says why on its card and its page, in the warn token.
for (const [name] of palettes) test(`${name}: the can't-spawn-here notes meet computed AA`, t => {
  const dom = new JSDOM(`<!doctype html><html data-theme="${name}"><body><div class="oats-view"><div class="souls"><div class="soul-tile"><button class="soul-card"><span class="sbody"><span class="sproblem">Can't spawn here</span></span></button></div></div>
    <aside class="soul-inspector soul-page"><div class="inspector-head"><p class="inspector-refusal">Can't spawn here</p></div></aside></div></body></html>`);
  t.after(() => dom.window.close());
  const doc = dom.window.document, spawnCSS = readFileSync(new URL('views/spawn.mjs', renderer), 'utf8').match(/const CSS = `([\s\S]*?)`;/)[1];
  for (const source of [css, spawnCSS, inspectorCSS]) { const style = doc.createElement('style'); style.textContent = source; doc.head.append(style); }
  const root = dom.window.getComputedStyle(doc.documentElement);
  const painted = el => { for (let p = el; p; p = p.parentElement) { const bg = dom.window.getComputedStyle(p).background; if (/^var\(--/.test(bg)) return bg.slice(6, -1); } return null; };
  for (const selector of ['.sproblem', '.inspector-refusal']) {
    const el = doc.querySelector(selector), bg = painted(el);
    assert.equal(dom.window.getComputedStyle(el).color, 'var(--warn)', selector); assert.ok(bg, selector);
    assert.ok(contrast(opaqueChannels(root.getPropertyValue('--warn').trim()), opaqueChannels(root.getPropertyValue(`--${bg}`).trim())) >= 4.5, `${selector} on ${bg}`);
    for (let p = el; p; p = p.parentElement) assert.equal(dom.window.getComputedStyle(p).opacity, '1');
  }
});
