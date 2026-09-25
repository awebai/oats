// In-memory display-only contracts. No browser, server, CLI, file writes or GUI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { SOUL_COLORS, normalizeSoulColor, colorForIdentity, soulColor } from '../renderer/soul-colors.mjs';
import { createSoulMark, createCapabilityMark, createRuntimeBadge, identityCSS } from '../renderer/identity-marks.mjs';

const soul = { agentsRoot: '/team/one/shared/agents', name: 'dev', server: 'host-one' };

test('color metadata accepts only the closed named palette without coercing values', () => {
  assert.deepEqual(SOUL_COLORS, ['sand', 'sage', 'slate', 'mauve', 'clay', 'olive']);
  assert.ok(Object.isFrozen(SOUL_COLORS));
  for (const name of SOUL_COLORS) {
    assert.equal(normalizeSoulColor(name), name);
    assert.equal(normalizeSoulColor(` ${name.toUpperCase()} `), name);
    assert.equal(soulColor({ ...soul, color: name }), name);
  }
  for (const value of [undefined, null, false, 1, [], {}, { toString: assert.fail },
    '#ffa500', 'orange', 'var(--accent)', 'url(https://fixture.invalid)', 'sage; color:red',
    '<img src=x onerror=evil()>', '__proto__', 'constructor', 'sage\u0000']) {
    assert.equal(normalizeSoulColor(value), null);
    assert.equal(soulColor({ ...soul, color: value }), soulColor(soul));
  }
});

test('stable assignment uses full current root/name/host, not basename, iteration order or display metadata', () => {
  const identities = Array.from({ length: 60 }, (_, i) => ({ ...soul, agentsRoot: `/team/${i}/shared/agents` }));
  const original = identities.map(soulColor);
  assert.ok(new Set(original).size > 1, 'same basename is not the identity');
  assert.ok(new Set(identities.map((_, i) => soulColor({ ...soul, server: `host-${i}` }))).size > 1, 'host affects identity');
  assert.ok(new Set(identities.map((_, i) => soulColor({ ...soul, name: `dev-${i}` }))).size > 1, 'name affects identity');
  assert.deepEqual([...identities].reverse().map(soulColor).reverse(), original);
  const before = structuredClone(soul);
  assert.equal(soulColor({ ...soul, repoName: 'Renamed display', workspace: '/elsewhere', runtime: 'codex', description: 'Edited', running: false }), soulColor(soul));
  assert.deepEqual(soul, before);
  assert.equal(soulColor(soul), colorForIdentity({ root: soul.agentsRoot, name: soul.name, host: soul.server }));
  assert.ok(SOUL_COLORS.includes(soulColor(null)));
  // Delimiters and hostile metadata never become CSS or confuse tuple slots.
  for (const name of ['dev:a', 'dev\u0000b', '<img src=x>', 'https://fixture.invalid']) assert.ok(SOUL_COLORS.includes(soulColor({ ...soul, name })));
  const counts = new Map(SOUL_COLORS.map(color => [color, 0]));
  for (let i = 0; i < 600; i++) { const color = soulColor({ ...soul, name: `soul-${i}` }); counts.set(color, counts.get(color) + 1); }
  for (const count of counts.values()) assert.ok(count >= 60 && count <= 140, 'muted tones are dispersed, not a sequential render-time cycle');
});

test('safe decorative monograms and closed runtime placeholders never create resource markup or provider claims', t => {
  const dom = new JSDOM('<body></body>'); t.after(() => dom.window.close()); const doc = dom.window.document;
  for (const name of ['dev', '<img src=x onerror=evil()>', 'π-worker', '👻', '', null]) {
    const mark = createSoulMark(doc, { ...soul, name, color: 'url(javascript:evil())' }); doc.body.append(mark);
    assert.ok(SOUL_COLORS.includes(mark.dataset.avatarColor));
    assert.equal(mark.getAttribute('aria-hidden'), 'true'); assert.equal(mark.children.length, 0);
    assert.equal(mark.hasAttribute('style'), false); assert.equal(mark.hasAttribute('title'), false);
    assert.ok(mark.textContent.length > 0);
  }
  for (const [value, key, label, text] of [['pi', 'pi', 'Pi', 'π'], ['Claude', 'claude', 'Claude', 'C'], ['codex', 'codex', 'Codex', 'Cx'],
    ['<img src=x>', undefined, '<img src=x>', '?'], [null, undefined, 'Not reported', '?'], ['constructor', undefined, 'constructor', '?']]) {
    const badge = createRuntimeBadge(doc, value); doc.body.append(badge);
    assert.equal(badge.dataset.runtime, key); assert.equal(badge.textContent, text);
    assert.equal(badge.getAttribute('role'), 'img'); assert.equal(badge.getAttribute('aria-label'), `Harness: ${label}`);
    assert.equal(badge.title, `Harness: ${label}`); assert.equal(badge.children.length, 0);
    assert.doesNotMatch(badge.getAttribute('aria-label'), /installed|authenticated|trusted/i);
  }
  const cap = createCapabilityMark(doc, { id: 'fixture.notes', usedBy: ['invented-soul'], source: 'javascript:evil()' }, { root: '/team', host: 'one' });
  assert.equal(cap.getAttribute('aria-hidden'), 'true'); assert.equal(cap.children.length, 0);
  assert.equal(cap.textContent, 'F'); assert.ok(SOUL_COLORS.includes(cap.dataset.avatarColor)); doc.body.append(cap);
  assert.equal(doc.querySelector('img,svg,script,a,[style],link'), null);
  assert.doesNotMatch(doc.body.textContent, /invented-soul|javascript:/);
});

for (const theme of ['light', 'solarized', 'dark']) test(`${theme}: real marker nodes use the same theme-owned opaque pairs in cards, inspector and sidebar`, t => {
  const dom = new JSDOM(`<html data-theme="${theme}"><head></head><body><div id="app"><aside id="sidebar"></aside><main class="oats-view"><button class="soul-card"><span class="sname"></span></button><aside class="inspector-head"></aside></main></div></body></html>`);
  t.after(() => dom.window.close()); const doc = dom.window.document;
  for (const css of [readFileSync(new URL('../renderer/theme.css', import.meta.url), 'utf8'), identityCSS]) {
    const style = doc.createElement('style'); style.textContent = css; doc.head.append(style);
  }
  for (const color of SOUL_COLORS) for (const target of ['.sname', '.inspector-head']) {
    const mark = createSoulMark(doc, { ...soul, color }); doc.querySelector(target).append(mark);
    const css = dom.window.getComputedStyle(mark);
    assert.equal(css.background, `var(--soul-${color}-bg)`); assert.equal(css.color, `var(--soul-${color}-fg)`);
  }
  for (const runtime of ['pi', 'claude', 'codex']) for (const target of ['#sidebar', '.sname']) {
    const mark = createRuntimeBadge(doc, runtime); doc.querySelector(target).append(mark);
    const css = dom.window.getComputedStyle(mark);
    assert.equal(css.background, `var(--runtime-${runtime}-bg)`); assert.equal(css.color, `var(--runtime-${runtime}-fg)`);
  }
});

test('pure color module is served and packaged with the renderer without IO or random dependencies', () => {
  const source = readFileSync(new URL('../renderer/soul-colors.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bimport\b|\brequire\s*\(|Math\.random|\b(?:window|document|localStorage|fetch|process)\s*\./);
  const config = readFileSync(new URL('../electron-builder.config.cjs', import.meta.url), 'utf8');
  assert.match(config, /"renderer\/\*\*\/\*"/);
  const marks = readFileSync(new URL('../renderer/identity-marks.mjs', import.meta.url), 'utf8');
  assert.match(marks, /from '\.\/soul-colors\.mjs'/, 'same renderer directory is served by the existing guarded harness');
  assert.match(config, /publish: null/);
});
