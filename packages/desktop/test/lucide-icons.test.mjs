// The shell's icon set is generated data from the pinned `lucide` package.
// No network, GUI, CLI or Electron: regenerate in memory and compare.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { generate, LUCIDE_NAMES, TARGET } from '../build-lucide-icons.mjs';
import { LUCIDE_ICONS, LUCIDE_VERSION } from '../renderer/lucide-icons.mjs';
import { ICONS, icon, iconElement } from '../renderer/shell-icons.mjs';
import { JSDOM } from 'jsdom';

const PKG = new URL('..', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));

test('renderer/lucide-icons.mjs is exactly what the pinned lucide package generates', async () => {
  assert.equal(pkg.devDependencies.lucide, '1.48.0', 'lucide is pinned exactly (dev-only: the renderer ships generated data)');
  assert.equal(pkg.dependencies?.lucide, undefined);
  const installed = JSON.parse(readFileSync(createRequire(import.meta.url).resolve('lucide/package.json'), 'utf8')).version;
  assert.equal(LUCIDE_VERSION, installed);
  assert.equal(readFileSync(TARGET, 'utf8'), await generate(), 'run `npm run icons:lucide` to regenerate');
  assert.deepEqual(Object.keys(LUCIDE_ICONS).sort(), [...LUCIDE_NAMES].sort());
  assert.equal(pkg.scripts['icons:lucide'], 'node build-lucide-icons.mjs');
  assert.match(readFileSync(join(PKG, 'electron-builder.config.cjs'), 'utf8'), /"!build-lucide-icons\.mjs"/, 'the generator is not packaged');
});

test('every semantic shell icon resolves to generated Lucide geometry with safe attributes only', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  for (const name of Object.keys(ICONS)) {
    const html = icon(name);
    assert.match(html, /^<svg class="shell-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"/, name);
    assert.doesNotMatch(html, /on[a-z]+=|javascript:|<script|foreignObject/i, name);
    const el = iconElement(dom.window.document, name, { size: 12 });
    assert.equal(el.getAttribute('width'), '12'); assert.equal(el.getAttribute('aria-hidden'), 'true');
    assert.ok(el.children.length > 0, `${name} has geometry`);
  }
  assert.throws(() => icon('not-an-icon'), TypeError);
  dom.window.close();
});

test('renderer chrome uses icons, not the replaced text glyphs', () => {
  const files = [];
  const walk = dir => { for (const entry of readdirSync(dir)) { const path = join(dir, entry); statSync(path).isDirectory() ? walk(path) : /\.(mjs|html)$/.test(entry) && files.push(path); } };
  walk(join(PKG, 'renderer'));
  // The renderer modules that moved to the shared home (packages/client) still build what the page shows.
  walk(join(PKG, '..', 'client'));
  for (const path of files) {
    if (/vendor|lucide-icons\.mjs$/.test(path)) continue;
    // Code only: strip comments so documentation may still name a glyph.
    const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/<!--[\s\S]*?-->/g, '');
    for (const glyph of ['⋯', '≡', '◈', '⌗', '✕', '↻', '⟳', '✓', '⚠']) {
      assert.ok(!code.includes(glyph), `${path.slice(PKG.length)} still renders the ${glyph} glyph`);
    }
  }
});

// The needs-input mark (2026-10-23) is drawn here, not Lucide's: OWN_ICONS, outside ICONS, so the inventory above stays
// Lucide's alone. A full disc, then the "!" as a bar and a separate dot, with room between them at 10–14px.
test('the attention mark: a disc and a bold "!", by class, with safe attributes only', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  assert.equal(Object.hasOwn(ICONS, 'attention'), false, 'not a Lucide name');
  const el = iconElement(dom.window.document, 'attention', { size: 10, className: 'attn-mark' });
  assert.equal(el.getAttribute('class'), 'attn-mark'); assert.equal(el.getAttribute('viewBox'), '0 0 24 24');
  assert.deepEqual([...el.children].map(c => [c.localName, c.getAttribute('class')]), [['circle', 'attn-disc'], ['rect', 'attn-glyph'], ['circle', 'attn-glyph']]);
  const [disc, bar, dot] = el.children;
  assert.deepEqual(['cx', 'cy', 'r'].map(k => disc.getAttribute(k)), ['12', '12', '12'], 'the full 24-unit disc');
  const barEnd = Number(bar.getAttribute('y')) + Number(bar.getAttribute('height')), dotTop = Number(dot.getAttribute('cy')) - Number(dot.getAttribute('r'));
  assert.ok(dotTop - barEnd >= 1.9, `the bar and the dot stay apart (${(dotTop - barEnd).toFixed(1)} units, 0.83px at 10px)`);
  assert.ok(Number(bar.getAttribute('width')) >= 3, 'a bold bar');
  assert.doesNotMatch(icon('attention'), /on[a-z]+=|javascript:|<script|foreignObject/i);
  dom.window.close();
});
