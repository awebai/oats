// Spec D (B1): the soul page's Instructions section — the soul's own AGENTS.md from the inspection, in the
// Contents card's grammar (the shared tree model and reader, contents-reader.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createSoulInstructions, soulInstructionsPath, soulInstructionsOf, SOUL_INSTRUCTIONS_COPY, OWN } from '../renderer/soul-instructions.mjs';
import { createSoulInspector } from '../renderer/soul-inspector.mjs';
import { setWorkspace, currentWorkspace } from '../renderer/views/common.mjs';

const TEXT = `---\nname: release-manager\ndescription: Ships the releases.\n---\n# Release manager\n\nRead [the guide](https://example.com/guide), [usage](#usage), [a sibling](skills/x/SKILL.md), [plain](http://example.com/y) and [mail](mailto:a@b.c).\n\n<script>alert(1)</script><img src="https://evil.example/x.png" onerror="alert(2)">\n\n## Usage\n\n\`\`\`sh\noats spawn\n\`\`\`\n`;
const row = (over = {}) => ({ soulsApi: 2, name: 'release-manager', path: 'souls/release-manager', kind: 'member',
  instructions: { file: '/Users/someone/OATS/agents/release-manager/souls/abc123/AGENTS.md', text: TEXT, truncated: false }, ...over });
const flush = () => new Promise(r => setTimeout(r, 0));

function setup(t, options = {}) {
  const dom = new JSDOM('<!doctype html><body><main></main></body>', { pretendToBeVisual: true });
  const doc = dom.window.document, host = doc.querySelector('main'), opened = [];
  const section = createSoulInstructions(doc, { openExternal: url => opened.push(url), ...options });
  host.append(section.element);
  t.after(() => { section.dispose(); dom.window.close(); });
  const $ = s => host.querySelector(s), $$ = s => [...host.querySelectorAll(s)];
  const key = (el, k) => el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  return { dom, doc, host, section, opened, $, $$, key, readerText: () => $('.cap-reader-body').textContent.trim() };
}
/** jsdom does not lay out: give an element a scroll offset that sticks, like a scrolled pane's. */
function scrollable(el) { let top = 0; Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: v => { top = Math.max(0, Number(v) || 0); } }); return el; }

test('the path shown is the file in its repository, never the host cache path', () => {
  assert.equal(soulInstructionsPath('souls/release-manager'), 'souls/release-manager/AGENTS.md');
  assert.equal(soulInstructionsPath('oats-package/souls/knowledge-harvester'), 'oats-package/souls/knowledge-harvester/AGENTS.md', 'a package soul: its directory in the package repository');
  assert.equal(soulInstructionsPath('souls/x/'), 'souls/x/AGENTS.md', 'an external soul entry may end in a slash');
  for (const bad of [null, undefined, '', '/', '/abs/souls/x', '../x', 'souls/../x', 'souls/./x', 'souls//x', 'a\\b', 'souls/x\n', 42]) assert.equal(soulInstructionsPath(bad), 'AGENTS.md', JSON.stringify(bad));
  assert.deepEqual(soulInstructionsOf(row()), { path: 'souls/release-manager/AGENTS.md', text: TEXT, truncated: false });
  assert.deepEqual(soulInstructionsOf(row({ instructions: null })), { path: 'souls/release-manager/AGENTS.md', text: null, truncated: false }, 'no soul directory reported: unreadable');
  assert.deepEqual(soulInstructionsOf(row({ path: null, instructions: { file: '/x', text: 5, truncated: 'yes' } })), { path: 'AGENTS.md', text: null, truncated: false });
});

test('section, navigation and default selection: one tree, the "This soul" group, its AGENTS.md open', t => {
  const u = setup(t); u.section.update(row());
  const title = u.$('h3.page-section-title');
  assert.equal(title.firstChild.textContent, 'Instructions'); assert.equal(title.querySelector('.page-section-lead').textContent, 'what its instances are told');
  assert.equal(u.section.element.dataset.section, 'Instructions');
  assert.ok(u.$('.cap-contents > nav.cap-contents-nav + .cap-contents-reader'), 'the Contents card grammar');
  const tree = u.$('[role=tree]'); assert.equal(tree.getAttribute('aria-label'), 'Instructions of release-manager');
  const group = u.$('[role=tree] > li[role=none] > ul[role=group]');
  assert.equal(u.doc.getElementById(group.getAttribute('aria-labelledby')).textContent, SOUL_INSTRUCTIONS_COPY.own);
  const items = u.$$('[role=treeitem]'); assert.equal(items.length, 1);
  const [item] = items;
  assert.equal(item.getAttribute('aria-label'), 'AGENTS.md, souls/release-manager/AGENTS.md');
  assert.equal(item.getAttribute('aria-selected'), 'true'); assert.equal(item.getAttribute('aria-level'), '1'); assert.equal(item.tabIndex, 0, 'the one tab stop');
  assert.deepEqual([...item.querySelectorAll('.cap-node-name, .cap-node-file')].map(n => n.textContent), ['AGENTS.md', 'souls/release-manager/AGENTS.md']);
  assert.equal(u.section.selected, OWN);
  assert.equal(u.$('.cap-contents-reader').getAttribute('aria-label'), 'Instructions of release-manager');
  assert.equal(u.$('.cap-reader-path').textContent, 'souls/release-manager/AGENTS.md');
  assert.equal(u.$('.cap-reader-size').textContent, `${Buffer.byteLength(TEXT)} B`);
  assert.equal(u.$('.cap-reader-flag'), null);
  assert.doesNotMatch(u.host.textContent, /\/Users\/someone|abc123/, 'never the host cache path');
  assert.doesNotMatch(u.host.textContent, /Instance composed|Composed|after spawn/, 'without composedInstructions there is no composed view');
});

test('the file reads like a capability inject: front matter as facts, Markdown, highlighted code with copy', t => {
  const u = setup(t); u.section.update(row());
  assert.deepEqual(u.$$('.cap-fm th').map(th => th.textContent), ['name', 'description']);
  assert.equal(u.$('.mdv h1').textContent, 'Release manager');
  assert.ok(u.$('.mdv pre.md-code .md-copy'), 'code blocks carry the copy button');
});

test('links settle as in Contents: https out through openExternal, a fragment stays in the reader, anything else inert', t => {
  const u = setup(t); u.section.update(row());
  const links = u.$$('.cap-reader-body a');
  assert.deepEqual(links.map(a => a.getAttribute('href')), ['https://example.com/guide', '#usage'], 'the relative, http and mailto links are inert text');
  assert.match(u.readerText(), /a sibling.*plain.*mail/s, 'their text stays');
  links[0].click(); assert.deepEqual(u.opened, ['https://example.com/guide']);
  links[1].click(); assert.deepEqual(u.opened, ['https://example.com/guide'], 'a fragment never goes out');
});

test('untrusted content: no raw HTML, scripts, handlers or images', t => {
  const u = setup(t); u.section.update(row());
  assert.equal(u.$('.cap-reader-body script, .cap-reader-body img, .cap-reader-body [onerror]'), null);
});

test('unreadable and truncated: the reader line, and the head flag worded for the inspection cap', t => {
  const u = setup(t);
  u.section.update(row({ instructions: { file: '/x/AGENTS.md', text: null, truncated: false } }));
  assert.equal(u.readerText(), "This soul's AGENTS.md could not be read.");
  assert.equal(u.$('.cap-reader-path').textContent, 'souls/release-manager/AGENTS.md'); assert.equal(u.$('.cap-reader-size'), null);
  u.section.update(row({ instructions: null }));
  assert.equal(u.readerText(), "This soul's AGENTS.md could not be read.");
  u.section.update(row({ instructions: { file: '/x/AGENTS.md', text: '# Long\n', truncated: true } }));
  assert.equal(u.$('.cap-reader-flag').textContent, 'Truncated at 200,000 characters');
  assert.equal(u.$('.cap-reader-size'), null, 'no size for a cut text: it would be the cut size');
  u.section.update(row({ path: null }));
  assert.equal(u.$('.cap-reader-path').textContent, 'AGENTS.md', 'no derivable path: just the file name');
  assert.equal(u.$('[role=treeitem]').getAttribute('aria-label'), 'AGENTS.md'); assert.equal(u.$('.cap-node-file'), null);
});

test('keyboard: the shared tree model — one tab stop, Enter/Space keep it open, Home/End, Left/Right on a leaf are not consumed', t => {
  const u = setup(t); u.section.update(row());
  const item = u.$('[role=treeitem]'); item.focus();
  for (const k of ['Enter', ' ', 'Home', 'End', 'ArrowDown', 'ArrowUp']) {
    const consumed = !u.key(item, k); assert.equal(consumed, true, k);
    assert.equal(u.doc.activeElement, item, k); assert.equal(item.getAttribute('aria-selected'), 'true', k);
  }
  for (const k of ['ArrowLeft', 'ArrowRight', 'a']) assert.equal(u.key(item, k), true, `${k} is not consumed`);
  assert.equal(item.tabIndex, 0);
  item.querySelector('.cap-node').click(); assert.equal(u.doc.activeElement, item, 'a click focuses the item');
});

test('repaint stability: unchanged data never rebuilds the tree or reader; hold() keeps focus and both scroll offsets', t => {
  const u = setup(t); u.section.update(row());
  const nav = scrollable(u.$('.cap-contents-nav')), reader = scrollable(u.$('.cap-contents-reader'));
  const item = u.$('[role=treeitem]'), view = u.$('.cap-reader-body .mdv');
  u.section.update(structuredClone(row()));
  assert.equal(u.$('[role=treeitem]'), item, 'the tree is the same nodes'); assert.equal(u.$('.cap-reader-body .mdv'), view, 'the reader is the same nodes');
  // A page repaint detaches and re-appends the element: focus (on the item, then in the reader) and offsets survive.
  for (const focused of [item, reader]) {
    focused.focus(); nav.scrollTop = 30; reader.scrollTop = 420;
    const keep = u.section.hold(); u.section.element.remove();
    nav.scrollTop = 0; reader.scrollTop = 0; // what a detach does to a real pane
    u.host.append(u.section.element); u.section.update(row()); keep();
    assert.equal(u.doc.activeElement, focused); assert.equal(nav.scrollTop, 30); assert.equal(reader.scrollTop, 420);
  }
  // A changed file repaints the reader in place; the tree stays.
  u.section.update(row({ instructions: { file: '/x', text: '# Changed\n', truncated: false } }));
  assert.equal(u.$('[role=treeitem]'), item); assert.equal(u.$('.mdv h1').textContent, 'Changed');
});

/* ── on the soul page ─────────────────────────────────────────────────────── */
const fixture = JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/f7/inspect-soul.json', import.meta.url), 'utf8')).result;
const agentsRoot = '/fixture/base/northwind-workspace/agents';
const selection = name => ({ agent: { name, agentsRoot }, selector: { soul: name, agentsRoot } });
const inspection = (name, text, over = {}) => { const v = structuredClone(fixture); v.subject.soul = name; Object.assign(v.souls[0], { name, path: `souls/${name}`, instructions: { file: `/cache/${name}/AGENTS.md`, text, truncated: false } }, over); return v; };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

function page(t, answer, { layout = 'page', opened = [] } = {}) {
  const previous = currentWorkspace(); setWorkspace('/team');
  const dom = new JSDOM('<body><main><aside hidden></aside></main></body>', { pretendToBeVisual: true }), el = dom.window.document.querySelector('aside');
  const inspector = createSoulInspector(el, { layout, ctx: { openExternal: url => opened.push(url), api: async (url, opts) => {
    if (!url.startsWith('/api/capabilities')) return { status: 'ok', soulTeams: {} };
    const out = answer(JSON.parse(opts.body)); return out?.promise ? out.promise : structuredClone(out);
  } } });
  t.after(() => { inspector.dispose(); dom.window.close(); setWorkspace(previous); });
  const settle = async () => { for (let i = 0; i < 4; i++) await flush(); };
  return { el, dom, doc: dom.window.document, inspector, settle, $: s => el.querySelector(s), sections: () => [...el.querySelectorAll('.inspector-main > .page-section')].map(s => s.dataset.section) };
}

test('soul page: Instructions follows Capabilities; the sidebar inspector and the instance view are unchanged', async t => {
  const opened = [];
  const u = page(t, () => inspection('release-manager', '# Hello\n\n[out](https://example.com)\n'), { opened });
  await u.inspector.show(selection('release-manager')); await u.settle();
  assert.deepEqual(u.sections(), ['Core capabilities', 'Capabilities', 'Instructions']);
  assert.equal(u.$('.soul-instructions .mdv h1').textContent, 'Hello');
  u.$('.soul-instructions .mdv a').click(); assert.deepEqual(opened, ['https://example.com'], "through the host's openExternal");
  const side = page(t, () => inspection('release-manager', '# Hello\n'), { layout: 'sidebar' });
  await side.inspector.show(selection('release-manager')); await side.settle();
  assert.equal(side.$('.soul-instructions'), null, 'the 340px inspector has no Instructions section');
});

test('soul page: a same-subject Refresh keeps the section; a changed inspection repaints the page around it, focus and scroll kept', async t => {
  let text = '# One\n', launchNote = null;
  const u = page(t, () => { const v = inspection('release-manager', text); if (launchNote) v.souls[0].description = launchNote; return v; });
  await u.inspector.show(selection('release-manager')); await u.settle();
  const section = u.$('.soul-instructions'), item = section.querySelector('[role=treeitem]'), reader = scrollable(section.querySelector('.cap-contents-reader'));
  const view = section.querySelector('.mdv');
  item.focus();
  await u.inspector.show(selection('release-manager'), { user: true }); await u.settle();
  assert.equal(u.$('.soul-instructions'), section); assert.equal(section.querySelector('.mdv'), view); assert.equal(u.doc.activeElement, item, 'unchanged: nothing moved');
  // Another fact of the inspection changed: the content is repainted, the section re-appended with its state.
  launchNote = 'Ships the releases, now weekly.'; reader.focus(); reader.scrollTop = 250;
  await u.inspector.show(selection('release-manager'), { user: true }); await u.settle();
  assert.equal(u.$('.soul-instructions'), section, 'the same long-lived element'); assert.equal(section.querySelector('.mdv'), view, 'its reader not rebuilt');
  assert.equal(u.doc.activeElement, reader, 'focus in the reader survives the repaint'); assert.equal(reader.scrollTop, 250);
  // The soul's AGENTS.md changed: its reader follows.
  text = '# Two\n';
  await u.inspector.show(selection('release-manager'), { user: true }); await u.settle();
  assert.equal(u.$('.soul-instructions'), section); assert.equal(section.querySelector('.mdv h1').textContent, 'Two');
});

test('soul page: a new subject starts fresh; latest intent wins across A → B → A', async t => {
  const waits = [];
  const u = page(t, body => { const d = deferred(); waits.push({ soul: body.selector.soul, d }); return d; });
  void u.inspector.show(selection('alpha')); await flush();
  void u.inspector.show(selection('beta')); await flush();
  void u.inspector.show(selection('alpha')); await flush();
  assert.deepEqual(waits.map(w => w.soul), ['alpha', 'beta', 'alpha']);
  // The answers land out of order: only the last intent (the second alpha) paints.
  waits[2].d.resolve(inspection('alpha', '# Alpha latest\n')); await u.settle();
  waits[1].d.resolve(inspection('beta', '# Beta\n')); await u.settle();
  waits[0].d.resolve(inspection('alpha', '# Alpha stale\n')); await u.settle();
  assert.equal(u.$('.soul-instructions .mdv h1').textContent, 'Alpha latest');
  assert.equal(u.el.querySelectorAll('.soul-instructions').length, 1);
  const first = u.$('.soul-instructions');
  const next = page(t, body => inspection(body.selector.soul, `# ${body.selector.soul}\n`));
  await next.inspector.show(selection('alpha')); await next.settle();
  const a = next.$('.soul-instructions');
  await next.inspector.show(selection('beta')); await next.settle();
  assert.notEqual(next.$('.soul-instructions'), a, 'another soul: a fresh controller');
  assert.equal(next.$('.soul-instructions .mdv h1').textContent, 'beta');
  assert.ok(first.isConnected);
});
