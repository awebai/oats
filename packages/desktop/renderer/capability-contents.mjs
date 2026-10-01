/** The capability page's Contents section (spec C): what an instance gets — the injected instructions
 * and every skill's files — read through `oats capabilities show` (capability-show-contract.mjs) and
 * readable in place: a navigation tree on the left, the selected file on the right.
 *
 * The section is one long-lived element owned by this controller, so the page around it can be rebuilt
 * (a catalog repaint) without losing what is open: the host re-appends `element` and calls `update()`
 * with the page's current subject. Presentation only: every file listed is the kernel's, nothing is
 * inferred, and every text is untrusted repository content — Markdown goes through the viewer's
 * sanitising pipeline in its strict profile (no raw HTML, no images), anything else is highlighted text.
 *
 * Latest intent: the show read and each file read carry a ticket checked on success and on failure; a
 * read for a subject or a selection the user has since left is discarded (A→B→A included). Selection and
 * focus never move on a background repaint: the tree is rebuilt only when the answer changed, focus is
 * found again by `data-focus-key`, and the open file stays open while it is still listed. */
import { capabilityShowSupported, capabilitySelector, capabilityShowData, capabilityFileData, listedFiles, skillFilePath, skillRelativePath, CAPABILITY_SHOW_UNREADABLE } from './capability-show-contract.mjs';
import { renderMarkdownHtml, renderCodeHtml, isMarkdownName, decorateMarkdown, copyCodeBlock } from './views/markdown.mjs';
import { splitFrontMatter } from './front-matter.mjs';
import { createDataState, skeleton, captureFocusState } from './loading.mjs';

export const CONTENTS_COPY = Object.freeze({
  title: 'Contents',
  lead: commit => `What an instance gets, at ${commit}`,
  unsupported: "This OATS version can't show what a capability ships. Update OATS to see its instructions and skill files.",
  remote: 'Not available for a remote workspace yet.',
  external: "Contents can't be shown for an external capability.",
  unlisted: "Not in the workspace's capability list, so its contents can't be shown.",
  noInject: 'Injects no instructions.',
  noSkills: 'Ships no skills.',
  skillsUnlistable: "Its skills can't be listed: a spawn of it would refuse.",
  moreFiles: 'More files not listed.',
  skillUnlisted: "Its files can't be listed.",
  inject: 'Injected instructions',
  binary: 'Binary file; not shown.',
  truncated: 'Truncated at 256 KiB',
  tooLarge: size => `Too large to show${size ? ` (${size})` : ''}.`,
  notAvailable: 'Not available.',
  empty: 'Nothing to show: this capability injects no instructions and ships no skills.',
  moved: 'The capability changed while it was read. Its contents are read again when the list is refreshed.',
});

export const capabilityContentsCSS = `
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
.cap-tree ul[role=group] .cap-node { padding-left:22px; font-family:var(--mono,monospace); font-size:11.5px; }
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
.cap-reader-body .mdv { max-width:none; margin:0; padding:0; font-size:13.5px; line-height:1.6; overflow-wrap:anywhere; }
.cap-reader-body .mdv pre.md-code { white-space:pre-wrap; overflow-wrap:anywhere; }
.cap-fm { width:100%; margin:0 0 16px; border-collapse:collapse; font-size:12px; }
.cap-fm th { width:1%; padding:5px 14px 5px 0; color:var(--muted); font-weight:500; text-align:left; vertical-align:top; white-space:nowrap; }
.cap-fm td { padding:5px 0; color:var(--fg); vertical-align:top; overflow-wrap:anywhere; white-space:pre-wrap; }
.cap-fm tr + tr > * { border-top:1px solid var(--tag-bg); }
`;

const isSkillMd = (skill, file) => file.path === `${skill.path}/SKILL.md`;
const shortCommit = v => typeof v === 'string' && /^[0-9a-f]{40}$/i.test(v) ? v.slice(0, 7) : null;
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

/** What the section shows for a page subject, before any read: a gate line, the pending skeleton, or a
 * selector to read. `row`: the catalog row (or the merged row a soul page opens); `cli`: the probe. */
export function contentsSubject({ row, cli, remote = false, catalogPending = false }) {
  if (remote) return { gate: CONTENTS_COPY.remote };
  if (!capabilityShowSupported(cli)) return { gate: CONTENTS_COPY.unsupported };
  if (catalogPending) return { pending: true };
  if (row?.kind === 'external') return { gate: CONTENTS_COPY.external };
  const selector = capabilitySelector(row);
  return selector ? { selector } : { gate: CONTENTS_COPY.unlisted };
}
/** The selection key of an inject whose manifest value is not a safe path (`inject.path: null`): it is shown (its
 * problem says why) but never read. A leading `/` is never a listed path, nor where a link can resolve. */
export const UNSAFE_INJECT = '/inject';
/** The file opened first: the inject, else the first skill's SKILL.md (else its first file), else none. */
export function defaultSelection(show) {
  if (show?.inject) return show.inject.path ?? UNSAFE_INJECT;
  const skill = (show?.skills || []).find(s => s.files?.length);
  if (!skill) return null;
  const file = skill.files.find(f => isSkillMd(skill, f)) || skill.files[0];
  return skillFilePath(skill, file);
}

/**
 * @param {Document} doc
 * @param {object} o
 * @param {(body: object) => Promise<object>} o.request  POST /api/capabilities for this page's workspace: resolves the
 *   CLI's result, rejects with an Error carrying `code` and the CLI's message
 * @param {(url: string) => void} [o.openExternal]  an https: link
 * @param {() => void} [o.onCatalogStale]  what was read disagrees with the catalog row (E_CAPABILITY_UNKNOWN, or an answer
 *   at another commit than the row's): re-read the catalog; the page's next update() brings the new row
 */
export function createCapabilityContents(doc, { request, openExternal = null, onCatalogStale = null } = {}) {
  const node = (tag, cls, text) => { const el = doc.createElement(tag); if (cls) el.className = cls; if (text !== undefined && text !== null) el.textContent = text; return el; };
  const element = node('section', 'page-section cap-contents-section'); element.dataset.section = 'Contents';
  const heading = node('h3', 'page-section-title'); heading.append(node('span', null, CONTENTS_COPY.title));
  const lead = node('span', 'page-section-lead'); lead.hidden = true; heading.append(lead);
  const gate = node('p', 'cap-contents-gate'); gate.hidden = true;
  const card = node('div', 'cap-contents'); card.hidden = true;
  const nav = node('nav', 'cap-contents-nav'); nav.setAttribute('aria-label', 'Contents');
  const navNotice = node('div', 'cap-contents-nav-notice'); // the stale line (a re-read failed over an answer on screen) and "Refreshing…"
  const navBody = node('div', 'cap-contents-nav-body');
  const reader = node('div', 'cap-contents-reader'); reader.setAttribute('role', 'region'); reader.tabIndex = 0;
  const head = node('div', 'cap-reader-head'); head.hidden = true;
  const body = node('div', 'cap-reader-body');
  nav.append(navNotice, navBody); reader.append(head, body); card.append(nav, reader);
  element.append(heading, gate, card);

  let alive = true, subjectKey = null, identityKey = null, selector = null, rowCommit = null, show = null, files = new Map();
  let selected = null, readerPath = null, focusKey = null, expanded = new Set(), showTicket = 0, fileTicket = 0, rendered = null;

  const navState = createDataState({ doc, noun: 'contents', region: nav, skeletonHost: navBody, indicatorHost: navNotice,
    skeleton: () => { const block = node('div', 'cap-nav-skeleton'); block.setAttribute('aria-hidden', 'true'); for (let i = 0; i < 6; i++) block.append(skeleton(doc, 'line')); return block; },
    onRetry: () => readShow({ user: true }), focusFallback: () => reader });
  const fileState = createDataState({ doc, noun: 'file', region: reader, skeletonHost: body,
    skeleton: () => { const block = node('div', 'cap-reader-skeleton'); block.setAttribute('aria-hidden', 'true'); for (let i = 0; i < 7; i++) block.append(skeleton(doc, 'line')); return block; },
    onRetry: () => { if (selected) open(selected, { force: true }); }, focusFallback: () => nav.querySelector('[role=treeitem][tabindex="0"]') || reader });

  function showGate(text) {
    subjectKey = identityKey = null; selector = show = null; files = new Map(); showTicket++; fileTicket++;
    navState.reset(); fileState.reset();
    gate.textContent = text; gate.hidden = false; card.hidden = true; lead.hidden = true;
  }

  /** The page's subject now. Unchanged → nothing (a background repaint never touches what is open). */
  function update({ row, cli, remote = false, catalogPending = false, deployment = null }) {
    if (!alive) return;
    const subject = contentsSubject({ row, cli, remote, catalogPending });
    if (subject.gate) { if (gate.textContent !== subject.gate || gate.hidden) showGate(subject.gate); return; }
    gate.hidden = true; card.hidden = false;
    reader.setAttribute('aria-label', `File of ${row?.name || 'this capability'}`);
    if (subject.pending) {
      // The selector comes from the catalog row, which is not read yet: the navigation's skeleton stands.
      if (subjectKey !== 'pending') { subjectKey = identityKey = null; selector = show = null; files = new Map(); rendered = null; showTicket++; navState.reset(); navBody.replaceChildren(); clearReader(); lead.hidden = true; subjectKey = 'pending'; navState.begin(); }
      return;
    }
    const identity = JSON.stringify([deployment, subject.selector]);
    const key = JSON.stringify([identity, typeof row?.commit === 'string' ? row.commit : null]);
    if (key === subjectKey) return;
    // Another capability (or deployment) starts afresh; the same one at a moved commit keeps the open path when it is still listed.
    if (identity !== identityKey) { selected = null; expanded = new Set(); show = null; files = new Map(); rendered = null; navState.reset(); navBody.replaceChildren(); clearReader(); lead.hidden = true; }
    subjectKey = key; identityKey = identity; selector = subject.selector; rowCommit = typeof row?.commit === 'string' ? row.commit : null;
    readShow();
  }

  async function readShow({ user = false } = {}) {
    if (!selector) return;
    const ticket = ++showTicket, asked = selector;
    navState.begin({ user });
    let data;
    try {
      const result = await request({ action: 'show', capability: asked });
      if (!alive || ticket !== showTicket) return;
      data = capabilityShowData(result, { selector: asked });
      if (!data) throw Object.assign(new Error(CAPABILITY_SHOW_UNREADABLE), { code: 'E_CLI_PROTOCOL' });
      // The member head moved between the catalog read and this one: never render a mix of the two.
      if (rowCommit && data.commit !== rowCommit) throw Object.assign(new Error(CONTENTS_COPY.moved), { code: 'E_CAPABILITY_MOVED' });
    } catch (error) {
      if (!alive || ticket !== showTicket) return;
      // With an answer on screen it stays, stale (the line with Retry above the tree); without one, the failed
      // block with the CLI's message (a repeated failure updates it in place: its Retry may hold focus).
      navState.fail(error);
      if (STALE_CODES.has(error?.code)) onCatalogStale?.();
      return;
    }
    navState.succeed({ empty: !data.inject && !(data.skills || []).length });
    applyShow(data);
  }

  function applyShow(data) {
    const previous = show; show = data; files = listedFiles(data);
    if (data.inject && data.inject.path === null) files.set(UNSAFE_INJECT, { kind: 'inject', file: data.inject });
    const short = shortCommit(data.commit); lead.textContent = short ? CONTENTS_COPY.lead(short) : ''; lead.hidden = !short;
    // Keep the open file while it is listed; else the default.
    if (!selected || !files.has(selected)) selected = defaultSelection(data);
    const parent = selected ? files.get(selected) : null;
    if (parent?.kind === 'skill') expanded.add(parent.skill.path);
    // An unchanged answer (a re-read at the same commit) never rebuilds the tree under focus.
    const signature = JSON.stringify(data);
    if (signature !== rendered) { rendered = signature; paintNav(); }
    const moved = !!previous && previous.commit !== data.commit;
    if (!previous || moved || readerPath !== selected) open(selected, { force: moved });
  }

  /* ── navigation ──────────────────────────────────────────────────────── */
  function paintNav() {
    const restore = captureFocusState(nav, { scroller: nav });
    navBody.replaceChildren();
    if (show.problems.length) {
      const notices = node('div', 'cap-contents-problems');
      for (const p of show.problems) {
        const line = node('p', 'cap-contents-problem'); line.dataset.code = p.code;
        if (p.path) line.append(node('span', 'mono', p.path), doc.createTextNode(' — '));
        line.append(doc.createTextNode(p.message)); notices.append(line);
      }
      navBody.append(notices);
    }
    // Both groups live in ONE tree (one tab stop; the arrows cross from one group to the other), each a
    // labelled role=group. An empty group is a label and a note beside the tree, in its place: notes are
    // not tree items. Order: Instructions, then Skills.
    const uid = `cap-contents-${++instances}`;
    const tree = node('ul', 'cap-tree'); tree.setAttribute('role', 'tree'); tree.setAttribute('aria-label', `Files of ${show.name}`);
    tree.addEventListener('keydown', onTreeKey);
    const group = (id, label) => {
      const wrap = node('li'); wrap.setAttribute('role', 'none');
      const title = node('div', 'cap-contents-group-label', label); title.id = id;
      const items = node('ul'); items.setAttribute('role', 'group'); items.setAttribute('aria-labelledby', id);
      wrap.append(title, items); tree.append(wrap);
      return items;
    };
    const note = (label, text) => [node('div', 'cap-contents-group-label', label), node('p', 'cap-contents-note', text)];
    if (show.inject) {
      const where = show.inject.path; // null: the manifest's value is not a safe path (its problem says so)
      group(`${uid}-instructions`, 'Instructions').append(leaf(where ?? UNSAFE_INJECT,
        [node('span', 'cap-node-name', CONTENTS_COPY.inject), ...(where ? [node('span', 'cap-node-file', where)] : [])], { level: 1, label: where ? `${CONTENTS_COPY.inject}, ${where}` : CONTENTS_COPY.inject }));
    } else navBody.append(...note('Instructions', CONTENTS_COPY.noInject));
    if (show.skills?.length) { const items = group(`${uid}-skills`, 'Skills'); for (const skill of show.skills) items.append(skillNode(skill)); }
    if (tree.childElementCount) navBody.append(tree);
    if (!show.skills?.length) navBody.append(...note('Skills', show.skills === null ? CONTENTS_COPY.skillsUnlistable : CONTENTS_COPY.noSkills));
    syncRoving();
    restore();
  }
  function leaf(path, content, { level, label }) {
    const item = node('li'); item.setAttribute('role', 'treeitem'); item.setAttribute('aria-level', String(level));
    item.setAttribute('aria-selected', String(path === selected)); item.setAttribute('aria-label', label);
    item.dataset.path = path; item.dataset.focusKey = `file:${path}`; item.tabIndex = -1;
    const row = node('div', 'cap-node'); const twisty = node('span', 'cap-node-twisty'); twisty.setAttribute('aria-hidden', 'true');
    const copy = node('span', 'cap-node-copy'); copy.append(...content); row.append(twisty, copy); item.append(row);
    row.addEventListener('click', () => { focusItem(item); open(path); });
    return item;
  }
  function skillNode(skill) {
    if (skill.files === null) return unlistedSkill(skill);
    const open_ = expanded.has(skill.path);
    const item = node('li'); item.setAttribute('role', 'treeitem'); item.setAttribute('aria-level', '1'); item.setAttribute('aria-expanded', String(open_));
    item.setAttribute('aria-label', skill.name); item.dataset.skill = skill.path; item.dataset.focusKey = `skill:${skill.path}`; item.tabIndex = -1;
    const sentence = firstSentence(skill.description);
    if (sentence) item.setAttribute('aria-description', [sentence, skill.filesTruncated ? CONTENTS_COPY.moreFiles : ''].filter(Boolean).join(' '));
    else if (skill.filesTruncated) item.setAttribute('aria-description', CONTENTS_COPY.moreFiles);
    const row = node('div', 'cap-node'); if (skill.description) row.title = skill.description;
    const twisty = node('span', 'cap-node-twisty', open_ ? '▾' : '▸'); twisty.setAttribute('aria-hidden', 'true');
    const copy = node('span', 'cap-node-copy'); copy.append(node('span', 'cap-node-name mono', skill.name));
    if (sentence) copy.append(node('span', 'cap-node-desc', sentence));
    row.append(twisty, copy); item.append(row);
    const children = node('ul'); children.setAttribute('role', 'group'); children.hidden = !open_;
    // Its files relative to the skill directory, SKILL.md first, then the kernel's (sorted) order.
    for (const f of [...skill.files].sort((a, b) => isSkillMd(skill, b) - isSkillMd(skill, a))) {
      const shown = skillRelativePath(skill, f);
      children.append(leaf(skillFilePath(skill, f), [node('span', 'cap-node-name', shown)], { level: 2, label: shown }));
    }
    if (skill.filesTruncated) { const more = node('li', 'cap-more', CONTENTS_COPY.moreFiles); more.setAttribute('role', 'none'); more.setAttribute('aria-hidden', 'true'); children.append(more); }
    item.append(children);
    row.addEventListener('click', () => { focusItem(item); toggle(item); });
    return item;
  }
  /** A skill whose directory could not be listed (a problem names it): a reachable item that opens nothing. */
  function unlistedSkill(skill) {
    const item = node('li'); item.setAttribute('role', 'treeitem'); item.setAttribute('aria-level', '1'); item.setAttribute('aria-disabled', 'true');
    item.setAttribute('aria-label', skill.name); item.setAttribute('aria-description', CONTENTS_COPY.skillUnlisted);
    item.dataset.focusKey = `skill:${skill.path}`; item.tabIndex = -1;
    const row = node('div', 'cap-node'); if (skill.description) row.title = skill.description;
    const twisty = node('span', 'cap-node-twisty'); twisty.setAttribute('aria-hidden', 'true');
    const copy = node('span', 'cap-node-copy'); copy.append(node('span', 'cap-node-name mono', skill.name), node('span', 'cap-node-desc', CONTENTS_COPY.skillUnlisted));
    row.append(twisty, copy); item.append(row);
    row.addEventListener('click', () => focusItem(item));
    return item;
  }
  const visibleItems = () => [...nav.querySelectorAll('[role=treeitem]')].filter(item => !item.parentElement.closest('[role=treeitem][aria-expanded=false]'));
  /** One tab stop: the focused item, else the open file's, else the first visible one. */
  function syncRoving(target = null) {
    const items = visibleItems();
    const stop = target || items.find(i => focusKey && i.dataset.focusKey === focusKey) || items.find(i => i.dataset.path === selected) || items[0] || null;
    for (const item of nav.querySelectorAll('[role=treeitem]')) item.tabIndex = item === stop ? 0 : -1;
  }
  function focusItem(item) { focusKey = item.dataset.focusKey; syncRoving(item); item.focus({ preventScroll: false }); }
  function setExpanded(item, value) {
    if (!item?.dataset.skill || !item.hasAttribute('aria-expanded')) return;
    if (value) expanded.add(item.dataset.skill); else expanded.delete(item.dataset.skill);
    item.setAttribute('aria-expanded', String(value));
    item.querySelector(':scope > ul[role=group]').hidden = !value;
    item.querySelector(':scope > .cap-node .cap-node-twisty').textContent = value ? '▾' : '▸';
    syncRoving(nav.contains(doc.activeElement) ? doc.activeElement.closest('[role=treeitem]') : null);
  }
  const toggle = item => setExpanded(item, item.getAttribute('aria-expanded') !== 'true');
  function onTreeKey(event) {
    const item = event.target.closest?.('[role=treeitem]'); if (!item || event.altKey || event.ctrlKey || event.metaKey) return;
    const items = visibleItems(), at = items.indexOf(item), skill = !!item.dataset.skill, isOpen = item.getAttribute('aria-expanded') === 'true';
    const go = target => { if (target) focusItem(target); };
    switch (event.key) {
      case 'ArrowDown': go(items[at + 1]); break;
      case 'ArrowUp': go(items[at - 1]); break;
      case 'Home': go(items[0]); break;
      case 'End': go(items[items.length - 1]); break;
      case 'ArrowRight': if (skill && !isOpen) setExpanded(item, true); else if (skill) go(item.querySelector('[role=treeitem]')); else return; break;
      case 'ArrowLeft': if (skill && isOpen) setExpanded(item, false); else if (!skill && item.getAttribute('aria-level') === '2') go(item.parentElement.closest('[role=treeitem]')); else return; break;
      case 'Enter': case ' ': if (skill) toggle(item); else if (item.dataset.path) open(item.dataset.path); break;
      default: return;
    }
    event.preventDefault(); event.stopPropagation();
  }
  function markSelected() {
    for (const item of nav.querySelectorAll('[role=treeitem][data-path]')) item.setAttribute('aria-selected', String(item.dataset.path === selected));
    syncRoving(nav.contains(doc.activeElement) ? doc.activeElement.closest('[role=treeitem]') : null);
  }

  /* ── reader ──────────────────────────────────────────────────────────── */
  function clearReader() { readerPath = null; fileTicket++; head.hidden = true; head.replaceChildren(); body.replaceChildren(); fileState.reset(); }
  function paintHead(path, bytes, truncated) {
    head.replaceChildren(node('span', 'cap-reader-path', path));
    const size = sizeText(bytes); if (size) head.append(node('span', 'cap-reader-size', size));
    if (truncated) head.append(node('span', 'cap-reader-flag', CONTENTS_COPY.truncated));
    head.hidden = false;
  }
  const line = text => node('p', 'cap-reader-line', text);
  /** Open a listed file in the reader (and select it on the left). `force`: read again even when it is the one shown. */
  function open(path, { force = false } = {}) {
    if (!alive) return;
    if (!path) { clearReader(); body.append(line(CONTENTS_COPY.empty)); return; }
    const listed = files.get(path); if (!listed) return;
    selected = path; markSelected();
    if (readerPath === path && !force) return;
    // A Retry of the file on screen keeps its failed block (and the Retry's focus) until the read settles.
    const retrying = readerPath === path && fileState.settled === 'failed';
    readerPath = path; const ticket = ++fileTicket;
    if (!retrying) { reader.scrollTop = 0; body.replaceChildren(); fileState.reset(); }
    paintHead(listed.file.path ?? CONTENTS_COPY.inject, listed.file.bytes, listed.kind === 'inject' ? listed.file.truncated : false);
    if (listed.kind === 'inject') { paintFile(listed.file); return; } // the show answer carries the inject's text: no --file call
    fileState.begin();
    request({ action: 'file', capability: selector, path }).then(result => {
      if (!alive || ticket !== fileTicket) return; // the user has left this file (A→B→A: B's ticket won, A's new read owns it)
      const data = capabilityFileData(result, { selector, path });
      if (!data) throw Object.assign(new Error(CAPABILITY_SHOW_UNREADABLE), { code: 'E_CLI_PROTOCOL' });
      if (data.commit !== show.commit) throw Object.assign(new Error(CONTENTS_COPY.moved), { code: 'E_CAPABILITY_MOVED' });
      fileState.succeed(); paintHead(path, data.file.bytes ?? listed.file.bytes, data.file.truncated); paintFile(data.file);
    }).catch(error => {
      if (!alive || ticket !== fileTicket) return;
      // By design (the kernel's 200-file cap, a symlink) or too large: a muted line, not the failed state.
      if (error?.code === 'E_CAPABILITY_FILE_UNKNOWN') { fileState.succeed(); body.replaceChildren(line(CONTENTS_COPY.notAvailable)); return; }
      if (error?.code === 'E_REMOTE_FILE_OVERSIZE') { fileState.succeed(); body.replaceChildren(line(CONTENTS_COPY.tooLarge(sizeText(listed.file.bytes)))); return; }
      fileState.fail(error);
      if (STALE_CODES.has(error?.code)) onCatalogStale?.();
    });
  }
  function paintFile(file) {
    body.replaceChildren();
    if (file.binary) { body.append(line(CONTENTS_COPY.binary)); return; }
    if (file.text === null) {
      // Missing, over the kernel's budget, or not a safe path (path null): its problem says why, verbatim.
      const problem = show?.problems.find(p => p.path === file.path);
      body.append(line(problem ? problem.message : CONTENTS_COPY.notAvailable)); return;
    }
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
  /** Links: a listed file of this capability opens here; https goes out through openExternal; an in-document
   * fragment scrolls the reader; anything else becomes its text (inert, and nothing is fetched). */
  function settleLinks(root) {
    for (const a of [...root.querySelectorAll('a')]) {
      const local = a.getAttribute('data-open-file');
      if (local !== null) {
        const path = local.replace(/^\/+/, '');
        if (files.has(path)) { a.dataset.capPath = path; a.setAttribute('href', '#'); a.removeAttribute('data-open-file'); continue; }
      } else {
        const href = a.getAttribute('href') || '';
        if (href.startsWith('#') && href.length > 1) continue;
        if (/^https:\/\//i.test(href) && typeof openExternal === 'function') { a.removeAttribute('target'); continue; }
      }
      a.replaceWith(...a.childNodes);
    }
  }
  const copyTimers = new Set();
  function onReaderClick(event) {
    const copy = event.target.closest?.('.md-copy');
    if (copy && body.contains(copy)) { if (event.type === 'click') copyCodeBlock(copy, doc, { alive: () => alive, timers: copyTimers }); return; }
    const a = event.target.closest?.('a'); if (!a || !body.contains(a)) return;
    event.preventDefault();
    if (event.type === 'auxclick') return;
    if (a.dataset.capPath) {
      const path = a.dataset.capPath, parent = files.get(path);
      if (parent?.kind === 'skill' && !expanded.has(parent.skill.path)) setExpanded([...nav.querySelectorAll('[role=treeitem][data-skill]')].find(i => i.dataset.skill === parent.skill.path), true);
      open(path); return;
    }
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) {
      let id; try { id = decodeURIComponent(href.slice(1)); } catch { return; }
      const target = [...body.querySelectorAll('[id]')].find(el => el.id === id);
      if (target) reader.scrollTop = Math.max(0, target.offsetTop - head.offsetHeight - 8);
      return;
    }
    if (/^https:\/\//i.test(href)) openExternal?.(href);
  }
  body.addEventListener('click', onReaderClick);
  body.addEventListener('auxclick', onReaderClick);

  return {
    element, update,
    /** Re-read the show answer (the page's catalog was refreshed by the user). */
    refresh() { if (selector) readShow({ user: true }); },
    /** Before the host moves `element` (a page rebuild re-appends it): detaching drops focus and the panes'
     * scroll offsets, so take them now and put them back once it is in the document again. */
    hold() {
      const active = element.contains(doc.activeElement) ? doc.activeElement : null, navTop = nav.scrollTop, readerTop = reader.scrollTop;
      return () => {
        if (!alive || !element.isConnected) return;
        nav.scrollTop = navTop; reader.scrollTop = readerTop;
        if (active?.isConnected && doc.activeElement !== active) active.focus({ preventScroll: true });
      };
    },
    get selected() { return selected; },
    dispose() { alive = false; showTicket++; fileTicket++; for (const timer of copyTimers) clearTimeout(timer); copyTimers.clear(); navState.dispose(); fileState.dispose(); body.removeEventListener('click', onReaderClick); body.removeEventListener('auxclick', onReaderClick); },
  };
}
/** Codes after which the catalog row is re-read: the kernel no longer knows the capability, or it moved. */
const STALE_CODES = new Set(['E_CAPABILITY_UNKNOWN', 'E_CAPABILITY_MOVED']);
let instances = 0; // ids for the group labels, unique per document
