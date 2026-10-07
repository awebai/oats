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
// Claude's spark (Simple Icons 16.34.0 `claude`) as published: its geometry ships unmodified.
const CLAUDE_SPARK = 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z';
// The pi.dev press-kit badge (https://pi.dev/favicon.svg) as published: its geometry ships unmodified.
const PI_BADGE = { viewBox: '0 0 560 560', paths: ['M420 280H280V140H0V0H420V280Z', 'M560 560H420V280H560V560Z', 'M140 560H0V140H140V280H280V420H140V560Z'] };

test('harness marks are static, currentColor-painted geometry; Pi is the press-kit badge verbatim', t => {
  const dom = new JSDOM('<body></body>'); t.after(() => dom.window.close()); const doc = dom.window.document;
  const marks = Object.fromEntries(['claude', 'pi', 'codex'].map(key => [key, createRuntimeBadge(doc, key).firstElementChild]));
  assert.equal(marks.pi.getAttribute('viewBox'), PI_BADGE.viewBox);
  assert.deepEqual([...marks.pi.children].map(path => path.getAttribute('d')), PI_BADGE.paths);
  assert.equal(marks.pi.getAttribute('fill'), 'currentColor', 'the theme, not the file\'s prefers-color-scheme style, picks the colour');
  assert.equal(marks.claude.getAttribute('fill'), 'currentColor');
  // Claude's spark (Simple Icons 16.34.0 `claude`, harness-marks/README.md) as published: geometry unmodified.
  assert.equal(marks.claude.getAttribute('viewBox'), '0 0 24 24');
  assert.deepEqual([...marks.claude.children].map(path => path.getAttribute('d')), [CLAUDE_SPARK]);
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
