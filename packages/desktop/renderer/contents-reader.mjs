/** The Contents card, shared by the capability page's Contents (capability-contents.mjs) and the soul page's
 * Instructions (soul-instructions.mjs): one card grammar (a navigation tree left, a reader right), one tree
 * keyboard model and one file reader. The hosts own what is listed, what is read and when; this module owns
 * how a tree moves and how a file is shown.
 *
 * The reader: a sticky head (path, size, a truncated flag), then the file. Every text is untrusted repository
 * content: Markdown goes through the viewer's sanitising pipeline in its strict profile (no raw HTML, no
 * images, nothing fetched), with its front matter as a facts table; anything else is highlighted text. Links
 * settle to three kinds only: a file the host lists opens in place, https goes out through `openExternal`,
 * an in-document fragment scrolls the reader; anything else becomes its text. */
import { renderMarkdownHtml, renderCodeHtml, isMarkdownName, decorateMarkdown, copyCodeBlock } from './views/markdown.mjs';
import { splitFrontMatter } from './front-matter.mjs';

export const contentsCardCSS = `
/* The section's own display rules (grid, flex) would beat the HTML hidden attribute: hidden always wins here. */
.cap-contents-section [hidden] { display:none !important; }
.cap-contents-gate { margin:0; color:var(--muted); font-size:12.5px; }
.cap-contents { display:grid; grid-template-columns:220px minmax(0,1fr); height:min(70vh, 720px); min-width:0; background:var(--surface); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
.cap-contents-nav { min-height:0; overflow:auto; padding:10px 8px 12px; border-right:1px solid var(--border); box-sizing:border-box; font-size:12px; }
/* The reader is the Markdown viewer's own ground (--bg): its text, link and code colours are the ones the viewer's contrast checks cover. */
.cap-contents-reader { position:relative; min-height:0; min-width:0; overflow:auto; box-sizing:border-box; background:var(--bg); color:var(--fg); }
@container (max-width: 860px) {
  .cap-contents { grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(0,1fr); }
  .cap-contents-nav { max-height:200px; border-right:0; border-bottom:1px solid var(--border); }
}
.cap-contents-problems { display:flex; flex-direction:column; gap:6px; margin:0 4px 10px; }
.cap-contents-problem { margin:0; color:var(--muted); font-size:11.5px; line-height:1.45; overflow-wrap:anywhere; }
.cap-contents-problem .mono { font-family:var(--mono,monospace); color:var(--fg); }
.cap-contents-group-label { margin:6px 6px 4px; color:var(--muted); font-size:10.5px; font-weight:650; letter-spacing:.05em; text-transform:uppercase; }
.cap-contents-group-label:not(:first-child) { margin-top:14px; }
.cap-contents-note { margin:2px 6px; color:var(--muted); font-size:12px; }
.cap-tree, .cap-tree ul { list-style:none; margin:0; padding:0; }
.cap-tree li[role=treeitem] { outline:none; }
.cap-node { display:flex; align-items:flex-start; gap:4px; min-width:0; padding:4px 6px; border-radius:6px; cursor:pointer; color:var(--fg); }
.cap-node:hover { background:var(--surface-2); }
.cap-tree li[role=treeitem]:focus-visible > .cap-node { outline:1px solid var(--accent); outline-offset:-1px; background:var(--sel); }
.cap-tree li[aria-selected=true] > .cap-node { background:var(--sel); }
.cap-node-twisty { flex:none; width:12px; margin-top:1px; color:var(--muted); font-size:10px; text-align:center; }
.cap-node-copy { display:flex; flex-direction:column; gap:1px; min-width:0; }
.cap-node-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cap-node-name.mono, .cap-node-file { font-family:var(--mono,monospace); }
.cap-node-file, .cap-node-desc { color:var(--muted); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* A skill's files (a group inside a skill item; the top-level groups are Instructions and Skills): indented, monospace. */
.cap-tree [role=treeitem] [role=group] .cap-node { padding-left:22px; font-family:var(--mono,monospace); font-size:11.5px; }
.cap-tree .cap-more { padding:3px 6px 3px 22px; color:var(--muted); font-size:11px; }
.cap-reader-head { position:sticky; top:0; z-index:1; display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 12px; padding:8px 16px; border-bottom:1px solid var(--border); background:var(--bg); font-size:11.5px; }
.cap-reader-path { color:var(--fg); font:600 11.5px var(--mono,monospace); overflow-wrap:anywhere; }
.cap-reader-size { color:var(--muted); }
.cap-reader-flag { color:var(--warn); font-weight:600; }
.cap-reader-body { padding:14px 18px 24px; }
.cap-reader-body > .loading-failed { margin:0; }
.cap-reader-line { margin:0; color:var(--muted); font-size:12.5px; }
.cap-reader-skeleton { display:flex; flex-direction:column; gap:10px; }
.cap-reader-skeleton .skeleton-line { height:11px; width:80%; }
.cap-reader-skeleton .skeleton-line:nth-child(3n) { width:55%; }
.cap-nav-skeleton { display:flex; flex-direction:column; gap:10px; padding:6px; }
.cap-nav-skeleton .skeleton-line { height:11px; width:75%; }
.cap-nav-skeleton .skeleton-line:nth-child(2n) { width:55%; }
.cap-contents-nav > .loading-failed, .cap-contents-reader .loading-failed { margin:6px; }
/* The viewer's reader (.mdv, views/markdown.mjs) sized for a pane: its colours and code styles are the viewer's own. */
.cap-reader-body .mdv { max-width:none; margin:0; padding:0; font-size:13px; line-height:1.6; overflow-wrap:anywhere; }
/* A file is read inside the page: its headings stay below the page's own title (20px), its code at the page's 12px. */
.cap-reader-body .mdv h1 { font-size:1.35em; }
.cap-reader-body .mdv h2 { font-size:1.18em; }
.cap-reader-body .mdv h3, .cap-reader-body .mdv h4 { font-size:1.04em; }
.cap-reader-body .mdv code { font-size:12px; }
.cap-reader-body .mdv pre.md-code { white-space:pre-wrap; overflow-wrap:anywhere; }
.cap-reader-body .mdv > :first-child { margin-top:0; }
.cap-fm { width:100%; margin:0 0 16px; border-collapse:collapse; font-size:12px; }
/* The facts table sits inside .mdv: none of the viewer's Markdown-table chrome (block display, cell borders, a tinted head). */
.cap-reader-body .mdv table.cap-fm { display:table; }
.cap-reader-body .mdv .cap-fm th, .cap-reader-body .mdv .cap-fm td { border:0; background:none; }
.cap-fm th { width:1%; padding:5px 14px 5px 0; color:var(--muted); font-weight:500; text-align:left; vertical-align:top; white-space:nowrap; }
.cap-fm td { padding:5px 0; color:var(--fg); vertical-align:top; overflow-wrap:anywhere; white-space:pre-wrap; }
.cap-reader-body .mdv .cap-fm tr + tr > * { border-top:1px solid var(--tag-bg); }
`;

/** "812 B" / "4.2 KiB" / "1.3 MiB"; null when unknown. */
export function sizeText(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MiB`;
}
/** A description's first sentence (the navigation's second line); the full text goes in the title. */
export function firstSentence(text) {
  if (typeof text !== 'string') return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(?=\s|$)/.exec(flat);
  return m ? m[1] : flat;
}

/**
 * The tree's keyboard model (WAI-ARIA tree): ONE tab stop (roving tabindex), Up/Down through the visible items,
 * Home/End, Right expands a closed item or enters an open one, Left collapses an open item or climbs from a
 * nested one, Enter/Space activate. An expandable item is one carrying `aria-expanded`; its children are its
 * `:scope > ul[role=group]`. Items carry `data-focus-key` (focus is found again by it after a repaint) and a
 * leaf its `data-path` (the open one is the tab stop when nothing was focused).
 *
 * @param {HTMLElement} nav  the element holding the tree (it may be repainted: items are looked up live)
 * @param {object} o
 * @param {() => string|null} o.selected  the open path
 * @param {(item: HTMLElement) => void} o.activate  Enter/Space on an item
 * @param {(item: HTMLElement, open: boolean) => void} [o.onExpand]  an item was expanded or collapsed
 */
export function createContentsTree(nav, { selected, activate, onExpand = null }) {
  const doc = nav.ownerDocument;
  let focusKey = null;
  const visibleItems = () => [...nav.querySelectorAll('[role=treeitem]')].filter(item => !item.parentElement.closest('[role=treeitem][aria-expanded=false]'));
  const focusedItem = () => nav.contains(doc.activeElement) ? doc.activeElement.closest('[role=treeitem]') : null;
  /** One tab stop: the focused item, else the open file's, else the first visible one. */
  function syncRoving(target = null) {
    const items = visibleItems(), open = selected();
    const stop = target || items.find(i => focusKey && i.dataset.focusKey === focusKey) || items.find(i => i.dataset.path === open) || items[0] || null;
    for (const item of nav.querySelectorAll('[role=treeitem]')) item.tabIndex = item === stop ? 0 : -1;
  }
  function focusItem(item) { focusKey = item.dataset.focusKey; syncRoving(item); item.focus({ preventScroll: false }); }
  function setExpanded(item, value) {
    if (!item?.hasAttribute('aria-expanded')) return;
    item.setAttribute('aria-expanded', String(value));
    item.querySelector(':scope > ul[role=group]').hidden = !value;
    item.querySelector(':scope > .cap-node .cap-node-twisty').textContent = value ? '▾' : '▸';
    onExpand?.(item, value);
    syncRoving(focusedItem());
  }
  const toggle = item => setExpanded(item, item.getAttribute('aria-expanded') !== 'true');
  function onKey(event) {
    const item = event.target.closest?.('[role=treeitem]'); if (!item || event.altKey || event.ctrlKey || event.metaKey) return;
    const items = visibleItems(), at = items.indexOf(item), expandable = item.hasAttribute('aria-expanded'), isOpen = item.getAttribute('aria-expanded') === 'true';
    const go = target => { if (target) focusItem(target); };
    switch (event.key) {
      case 'ArrowDown': go(items[at + 1]); break;
      case 'ArrowUp': go(items[at - 1]); break;
      case 'Home': go(items[0]); break;
      case 'End': go(items[items.length - 1]); break;
      case 'ArrowRight': if (expandable && !isOpen) setExpanded(item, true); else if (expandable) go(item.querySelector('[role=treeitem]')); else return; break;
      case 'ArrowLeft': if (expandable && isOpen) setExpanded(item, false); else if (!expandable && item.getAttribute('aria-level') !== '1') go(item.parentElement.closest('[role=treeitem]')); else return; break;
      case 'Enter': case ' ': activate(item); break;
      default: return;
    }
    event.preventDefault(); event.stopPropagation();
  }
  /** aria-selected follows the open path; the tab stop stays on what holds focus. */
  function markSelected() {
    const open = selected();
    for (const item of nav.querySelectorAll('[role=treeitem][data-path]')) item.setAttribute('aria-selected', String(item.dataset.path === open));
    syncRoving(focusedItem());
  }
  return { onKey, syncRoving, focusItem, setExpanded, toggle, markSelected, visibleItems };
}

/**
 * The reader: its head and body inside the scrolling `reader` region.
 * @param {Document} doc
 * @param {object} o
 * @param {HTMLElement} o.reader  the scroll container (the head is sticky inside it)
 * @param {HTMLElement} o.head
 * @param {HTMLElement} o.body
 * @param {() => boolean} o.alive
 * @param {(url: string) => void} [o.openExternal]  an https: link
 * @param {(path: string) => boolean} [o.isLocal]  a repository path the host lists (a link to it opens in place)
 * @param {(path: string) => void} [o.openLocal]
 */
export function createContentsReader(doc, { reader, head, body, alive, openExternal = null, isLocal = () => false, openLocal = null }) {
  const node = (tag, cls, text) => { const el = doc.createElement(tag); if (cls) el.className = cls; if (text !== undefined && text !== null) el.textContent = text; return el; };
  /** The sticky head: the path, its size when known, and the host's truncated flag text when truncated. */
  function paintHead(path, { bytes = null, flag = null } = {}) {
    head.replaceChildren(node('span', 'cap-reader-path', path));
    const size = sizeText(bytes); if (size) head.append(node('span', 'cap-reader-size', size));
    if (flag) head.append(node('span', 'cap-reader-flag', flag));
    head.hidden = false;
  }
  const line = text => node('p', 'cap-reader-line', text);
  /** A file `{ path, text, binary }` into the body. `missing`: the line for `text: null`; `binary`: the line for a binary file. */
  function paintFile(file, { missing, binary }) {
    body.replaceChildren();
    if (file.binary) { body.append(line(binary)); return; }
    if (file.text === null) { body.append(line(missing)); return; }
    const view = node('div', 'mdv');
    if (isMarkdownName(file.path)) {
      const { frontMatter, body: markdown } = splitFrontMatter(file.text);
      if (frontMatter?.entries) view.append(factsTable(frontMatter.entries));
      let html = frontMatter && !frontMatter.entries ? renderCodeHtml(frontMatter.raw, 'front-matter.yaml') : '';
      html += renderMarkdownHtml(markdown, doc, { path: `/${file.path}`, rootedLinks: false, strict: true });
      const content = node('div'); content.innerHTML = html; view.append(...content.childNodes);
      decorateMarkdown(view, doc, { anchors: false });
      settleLinks(view);
    } else {
      view.innerHTML = renderCodeHtml(file.text, file.path);
      decorateMarkdown(view, doc, { anchors: false });
    }
    body.append(view);
  }
  function factsTable(entries) {
    const table = node('table', 'cap-fm'); table.setAttribute('aria-label', 'Front matter');
    const rows = node('tbody');
    for (const [key, value] of entries) {
      const tr = node('tr'); tr.append(node('th', null, key), node('td', null, Array.isArray(value) ? value.join(', ') : value.replace(/\n+$/, '')));
      tr.firstChild.setAttribute('scope', 'row'); rows.append(tr);
    }
    table.append(rows); return table;
  }
  /** Links: a listed file opens here; https goes out through openExternal; an in-document fragment scrolls the
   * reader; anything else becomes its text (inert, and nothing is fetched). */
  function settleLinks(root) {
    for (const a of [...root.querySelectorAll('a')]) {
      const local = a.getAttribute('data-open-file');
      if (local !== null) {
        const path = local.replace(/^\/+/, '');
        if (isLocal(path)) { a.dataset.capPath = path; a.setAttribute('href', '#'); a.removeAttribute('data-open-file'); continue; }
      } else {
        const href = a.getAttribute('href') || '';
        if (href.startsWith('#') && href.length > 1) continue;
        if (/^https:\/\//i.test(href) && typeof openExternal === 'function') { a.removeAttribute('target'); continue; }
      }
      a.replaceWith(...a.childNodes);
    }
  }
  /** Scroll the reader so `target` sits just below the sticky head. */
  const scrollTo = target => { reader.scrollTop = Math.max(0, target.offsetTop - head.offsetHeight - 8); };
  const copyTimers = new Set();
  function onClick(event) {
    const copy = event.target.closest?.('.md-copy');
    if (copy && body.contains(copy)) { if (event.type === 'click') copyCodeBlock(copy, doc, { alive, timers: copyTimers }); return; }
    const a = event.target.closest?.('a'); if (!a || !body.contains(a)) return;
    event.preventDefault();
    if (event.type === 'auxclick') return;
    if (a.dataset.capPath) { openLocal?.(a.dataset.capPath); return; }
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) {
      let id; try { id = decodeURIComponent(href.slice(1)); } catch { return; }
      const target = [...body.querySelectorAll('[id]')].find(el => el.id === id);
      if (target) scrollTo(target);
      return;
    }
    if (/^https:\/\//i.test(href)) openExternal?.(href);
  }
  body.addEventListener('click', onClick);
  body.addEventListener('auxclick', onClick);
  return {
    paintHead, paintFile, line, scrollTo,
    /** Empty the head and body. */
    clear() { head.hidden = true; head.replaceChildren(); body.replaceChildren(); },
    dispose() { for (const timer of copyTimers) clearTimeout(timer); copyTimers.clear(); body.removeEventListener('click', onClick); body.removeEventListener('auxclick', onClick); },
  };
}
