// In-memory display-only contracts. No browser, server, CLI, file writes or GUI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { SOUL_COLORS, normalizeSoulColor, colorForIdentity, soulColor } from '../renderer/soul-colors.mjs';
import { createSoulMark, createCapabilityMark, createRuntimeBadge, harnessName, identityCSS } from '../renderer/identity-marks.mjs';

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
  for (const [value, key, label] of [['pi', 'pi', 'Pi'], ['Claude', 'claude', 'Claude'], ['codex', 'codex', 'Codex'],
    ['<img src=x>', undefined, '<img src=x>'], [null, undefined, 'Not reported'], ['constructor', undefined, 'constructor']]) {
    const badge = createRuntimeBadge(doc, value); doc.body.append(badge);
    assert.equal(badge.dataset.runtime, key);
    assert.equal(badge.getAttribute('role'), 'img'); assert.equal(badge.getAttribute('aria-label'), `Harness: ${label}`);
    assert.equal(badge.title, `Harness: ${label}`);
    assert.doesNotMatch(badge.getAttribute('aria-label'), /installed|authenticated|trusted/i);
    if (key) {
      // A known harness draws its mark: one decorative <svg>, no text letter.
      assert.equal(badge.children.length, 1); assert.equal(badge.textContent, '');
      const svg = badge.firstElementChild;
      assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg'); assert.equal(svg.localName, 'svg');
      assert.equal(svg.getAttribute('aria-hidden'), 'true'); assert.equal(svg.getAttribute('class'), 'runtime-mark');
    } else { assert.equal(badge.textContent, '?'); assert.equal(badge.children.length, 0); }
  }
  const cap = createCapabilityMark(doc, { id: 'fixture.notes', usedBy: ['invented-soul'], source: 'javascript:evil()' }, { root: '/team', host: 'one' });
  assert.equal(cap.getAttribute('aria-hidden'), 'true'); assert.equal(cap.children.length, 0);
  assert.equal(cap.textContent, 'F'); assert.ok(SOUL_COLORS.includes(cap.dataset.avatarColor)); doc.body.append(cap);
  assert.equal(doc.querySelector('img,script,a,[style],link,use,image,foreignObject'), null);
  assert.equal(doc.querySelectorAll('svg').length, 3, 'only the three known harnesses draw a mark');
  assert.doesNotMatch(doc.body.textContent, /invented-soul|javascript:/);
});

const SVG_NS = 'http://www.w3.org/2000/svg';
// The pi.dev press-kit badge (https://pi.dev/favicon.svg) as published: its geometry ships unmodified.
const PI_BADGE = { viewBox: '0 0 560 560', paths: ['M420 280H280V140H0V0H420V280Z', 'M560 560H420V280H560V560Z', 'M140 560H0V140H140V280H280V420H140V560Z'] };

test('harness marks are static, currentColor-painted geometry; Pi is the press-kit badge verbatim', t => {
  const dom = new JSDOM('<body></body>'); t.after(() => dom.window.close()); const doc = dom.window.document;
  const marks = Object.fromEntries(['claude', 'pi', 'codex'].map(key => [key, createRuntimeBadge(doc, key).firstElementChild]));
  assert.equal(marks.pi.getAttribute('viewBox'), PI_BADGE.viewBox);
  assert.deepEqual([...marks.pi.children].map(path => path.getAttribute('d')), PI_BADGE.paths);
  assert.equal(marks.pi.getAttribute('fill'), 'currentColor', 'the theme, not the file\'s prefers-color-scheme style, picks the colour');
  assert.equal(marks.claude.getAttribute('fill'), 'currentColor');
  assert.equal(marks.codex.getAttribute('stroke'), 'currentColor'); assert.equal(marks.codex.getAttribute('fill'), 'none');
  assert.equal(marks.codex.getAttribute('stroke-linecap'), 'round');
  // >= ~1.25px at the smallest (16px) badge: the stroke is 2.25/24 of the tile.
  assert.ok(Number(marks.codex.getAttribute('stroke-width')) * 16 / 24 >= 1.25);
  for (const [key, svg] of Object.entries(marks)) {
    for (const el of [svg, ...svg.querySelectorAll('*')]) {
      assert.ok(el.localName === 'svg' || el.localName === 'path', `${key}: only <svg> and <path>`);
      for (const { name, value } of el.attributes) {
        assert.ok(['class', 'viewBox', 'aria-hidden', 'focusable', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd'].includes(name), `${key}: ${name}`);
        if (name === 'fill' || name === 'stroke') assert.ok(['currentColor', 'none'].includes(value), `${key} ${name}=${value}: no raw colour`);
      }
    }
  }
  // Each badge builds its own nodes: a mark is never shared or mutated across badges.
  assert.notEqual(createRuntimeBadge(doc, 'pi').firstElementChild, createRuntimeBadge(doc, 'pi').firstElementChild);
});

test('unknown and hostile harness values render "?" with no data-runtime and no SVG; only the label carries the value', t => {
  const dom = new JSDOM('<body></body>'); t.after(() => dom.window.close()); const doc = dom.window.document;
  for (const value of ['opencode', 'pi"><svg onload=evil()>', 'claude; background:url(https://fixture.invalid)', 'url(javascript:evil())',
    '__proto__', 'hasOwnProperty', 'pi\u0000', 'codex2', '', '   ', 42, {}, ['pi'], { toString: () => 'pi' }]) {
    const badge = createRuntimeBadge(doc, value); doc.body.append(badge);
    assert.equal(badge.hasAttribute('data-runtime'), false, String(value));
    assert.equal(badge.textContent, '?'); assert.equal(badge.children.length, 0);
    assert.equal(badge.getElementsByTagNameNS(SVG_NS, 'svg').length, 0);
    const reported = typeof value === 'string' ? value.trim() : '';
    assert.equal(badge.getAttribute('aria-label'), `Harness: ${reported || 'Not reported'}`);
    assert.deepEqual([...badge.attributes].map(a => a.name).sort(), ['aria-label', 'class', 'role', 'title']);
    assert.equal(badge.className, 'runtime-badge');
  }
  // Known keys match after trimming and case-folding, and still draw only static marks.
  for (const [value, key, name] of [[' PI ', 'pi', 'Pi'], ['Claude', 'claude', 'Claude'], ['CODEX\n', 'codex', 'Codex']]) {
    const badge = createRuntimeBadge(doc, value);
    assert.equal(badge.dataset.runtime, key); assert.equal(badge.getAttribute('aria-label'), `Harness: ${name}`);
    assert.equal(badge.getElementsByTagNameNS(SVG_NS, 'svg').length, 1);
    assert.equal(harnessName(value), name);
  }
  assert.equal(doc.querySelector('svg,img,script,[style],[onload]'), null);
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
