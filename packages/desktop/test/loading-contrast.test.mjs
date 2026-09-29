// Effective-colour contrast for the loading states (desktop/loading-states):
// the status-line, refreshing, stale and failed texts meet WCAG AA 4.5:1 on the
// backgrounds they are actually painted over in every theme, computed from
// the declarations loading.css ships (resolved through each theme's tokens),
// and the decorative skeleton fill is visible on every host surface.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const renderer = new URL('../renderer/', import.meta.url);
const theme = readFileSync(new URL('theme.css', renderer), 'utf8');
const css = readFileSync(new URL('loading.css', renderer), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function tokens(block) {
  return new Map([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map(m => [m[1], m[2].toLowerCase()]));
}
const dark = tokens(theme.match(/:root, \[data-theme="dark"\] \{([\s\S]*?)\n\}/)[1]);
const palette = name => { const p = new Map(dark); for (const [k, v] of tokens(theme.match(new RegExp(`\\[data-theme="${name}"\\] \\{([\\s\\S]*?)\\n\\}`))[1])) p.set(k, v); return p; };
const palettes = [['light', palette('light')], ['solarized', palette('solarized')], ['dark', dark]];

const channels = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16));
const luminance = rgb => { const c = rgb.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/** The declarations of one selector's rule, as a map. */
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  assert.ok(body, `loading.css declares ${selector}`);
  return new Map(body.split(';').map(d => d.split(':').map(s => s.trim())).filter(([k, v]) => k && v));
}
/** `var(--x)` → the theme's hex; anything else must already be a hex. */
function resolve(value, p) {
  const token = /^var\(--([\w-]+)\)$/.exec(value);
  const hex = token ? p.get(token[1]) : value;
  assert.match(hex ?? '', /^#[0-9a-f]{6}$/i, `${value} resolves to an opaque colour`);
  return channels(hex.toLowerCase());
}
/** color-mix(in srgb, var(--fg) N%, transparent) composited over an opaque host. */
function mixedOver(value, hostHex, p) {
  const m = /^color-mix\(in srgb, var\(--([\w-]+)\) (\d+)%, transparent\)$/.exec(value);
  assert.ok(m, `${value} is a token mixed over transparent`);
  const fg = channels(p.get(m[1])), host = channels(hostHex), a = Number(m[2]) / 100;
  return fg.map((v, i) => v * a + host[i] * (1 - a));
}

// Where each text is painted: the surfaces that host these lines today
// (sidebar and inspector: --surface; the hierarchy bar: --surface; views: --bg; hover rows: --surface-2).
const HOSTS = ['bg', 'surface', 'surface-2'];

test('status, refreshing, observed and failed texts are AA on every host surface, in every theme', () => {
  const muted = [rule('.loading-status'), rule('.loading-refreshing'), rule('.loading-notice[data-kind="observed"]'), rule('.loading-failed-details > summary'), rule('.loading-failed-code')];
  const strong = [rule('.loading-failed')];
  for (const [name, p] of palettes) for (const host of HOSTS) {
    const bg = channels(p.get(host));
    for (const r of muted) { const c = contrast(resolve(r.get('color'), p), bg); assert.ok(c >= 4.5, `${name}: ${r.get('color')} on --${host} = ${c.toFixed(2)}`); }
    for (const r of strong) { const c = contrast(resolve(r.get('color'), p), bg); assert.ok(c >= 4.5, `${name}: ${r.get('color')} on --${host} = ${c.toFixed(2)}`); }
  }
});

test('the stale line paints its own attention background; its text and border read on it in every theme', () => {
  const stale = rule('.loading-notice[data-kind="stale"]');
  for (const [name, p] of palettes) {
    const bg = resolve(stale.get('background'), p), fg = resolve(stale.get('color'), p);
    const c = contrast(fg, bg); assert.ok(c >= 4.5, `${name}: stale text ${c.toFixed(2)}`);
    // The line sits on a host surface: its own fill is opaque, so the host never shows through the text.
    assert.match(stale.get('background'), /^var\(--attn-bg\)$/);
    const border = /var\(--([\w-]+)\)/.exec(stale.get('border'))[1];
    assert.ok(contrast(channels(p.get(border)), channels(p.get('surface'))) >= 1.2, `${name}: the border is visible on --surface`);
  }
});

test('Retry reads on its own surface, enabled and aria-disabled, in every theme', () => {
  const button = rule('button.loading-retry'), busy = rule('button.loading-retry[aria-disabled="true"]');
  for (const [name, p] of palettes) {
    const bg = resolve(button.get('background'), p);
    assert.ok(contrast(resolve(button.get('color'), p), bg) >= 4.5, `${name}: Retry`);
    assert.ok(contrast(resolve(busy.get('color'), p), bg) >= 4.5, `${name}: Retry while busy`);
  }
});

test('the skeleton fill is a token mix, visible (a real shade step) on every host surface in every theme, never a text colour', () => {
  const fill = rule('.skeleton').get('background');
  for (const [name, p] of palettes) for (const host of HOSTS) {
    const bg = channels(p.get(host)), over = mixedOver(fill, p.get(host), p);
    const delta = Math.max(...over.map((v, i) => Math.abs(v - bg[i])));
    assert.ok(delta >= 12, `${name}: skeleton over --${host} differs by ${delta.toFixed(1)}/255`);
    assert.ok(contrast(over, bg) < 3, `${name}: a skeleton is a soft shape, not a high-contrast block (${contrast(over, bg).toFixed(2)})`);
  }
});
