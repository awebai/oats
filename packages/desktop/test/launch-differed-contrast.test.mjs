// What a blocked launch differed in (renderer/launch-differed.mjs) meets WCAG AA 4.5:1 on the surface each
// host paints it over, in every built-in theme: computed from the CSS the host ships, resolved through
// the theme's tokens. Token colours only, and nothing above the text is translucent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { launchDiffered } from '../renderer/launch-differed.mjs';
import { sourceQuoteCSS } from '../renderer/source-quote.mjs';
import { spawnDialogCSS } from '../renderer/spawn-dialog.mjs';
import { differed } from './helpers/launch-prompt-fixture.mjs';

const renderer = new URL('../renderer/', import.meta.url);
const theme = readFileSync(new URL('theme.css', renderer), 'utf8');
const channels = hex => { assert.match(hex, /^#[0-9a-f]{6}$/i, 'an opaque hex colour'); return hex.slice(1).match(/../g).map(v => parseInt(v, 16)); };
const luminance = rgb => { const c = rgb.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// One side with text and one without: the quote, and the plain note of a side with nothing to show.
const INVENTORY = [['.launch-differed-lead', 'muted'], ['.source-quote-lead', 'muted'], ['.source-quote-text', 'fg'], ['.source-quote-note', 'muted']];

/** `host`: { name, html (the host's markup, with one element matching `into`), into, painted (the element whose background is under the text), bg, styles } */
function holds(host) {
  for (const name of ['light', 'solarized', 'dark']) test(`${name}: what differed meets computed AA in ${host.name}`, () => {
    const dom = new JSDOM(`<!doctype html><html data-theme="${name}"><body>${host.html}</body></html>`, { pretendToBeVisual: true });
    const doc = dom.window.document;
    for (const source of [theme, ...host.styles]) { const style = doc.createElement('style'); style.textContent = source; doc.head.append(style); }
    doc.querySelector(host.into).append(launchDiffered(doc, differed({ found: '' })));
    const root = dom.window.getComputedStyle(doc.documentElement), surface = doc.querySelector(host.painted);
    assert.equal(dom.window.getComputedStyle(surface).background.replace(/^.*(var\(--[\w-]+\)).*$/, '$1'), `var(--${host.bg})`, host.painted);
    for (const [selector, fg] of INVENTORY) {
      const el = doc.querySelector(`${host.into} ${selector}`); assert.ok(el, selector);
      assert.equal(dom.window.getComputedStyle(el).color, `var(--${fg})`, selector);
      assert.ok(contrast(channels(root.getPropertyValue(`--${fg}`).trim()), channels(root.getPropertyValue(`--${host.bg}`).trim())) >= 4.5, `${name} ${selector} on --${host.bg}`);
      for (let parent = el; parent; parent = parent.parentElement) assert.equal(dom.window.getComputedStyle(parent).opacity, '1');
    }
    dom.window.close();
  });
}

// The Spawn dialog's footer: under the status, on the dialog's surface (views/spawn.mjs ships the quote's CSS beside the dialog's).
holds({ name: "the Spawn dialog's footer", styles: [sourceQuoteCSS, spawnDialogCSS], into: '.spawn-status-differed', painted: '.spawn-footer', bg: 'surface',
  html: '<div class="spawn-modal"><div class="spawn-dialog"><div class="spawn-footer"><p class="fstatus err">x</p><div class="spawn-status-differed"></div></div></div></div>' });
