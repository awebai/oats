/** The soul page's Instructions section (spec D): what the soul tells its instances, in the Contents card's
 * grammar (contents-reader.mjs: a navigation tree left, the file right). It shows the soul's own AGENTS.md
 * from the inspection the page already read (`souls[0].instructions` = { file, text, truncated }) and, when
 * the inspection carries it (feature soul-composed-instructions, `inspect --soul --instructions`), the
 * composed AGENTS.md a new instance here would get (`souls[0].composedInstructions`): no request of its own.
 * The path shown is the file's place in its repository (the soul row's `path`, the soul's directory there),
 * never the host cache path in `file`.
 *
 * The composed document is read as one continuous text made of its parts in the kernel's order: the soul's
 * own body ("From this soul") then each injected block ("Injected by …"), its `<!-- oats:… -->` marker lines
 * dropped (the part headers stand for them). The kernel's ranges are trusted only when they tile the text
 * exactly as its contract says; an answer that does not is not shown.
 *
 * One controller per soul page subject (the inspector creates it with the frame and disposes it with the
 * subject), its element re-appended by every repaint of the page: an unchanged inspection never rebuilds its
 * tree or reader, and `hold()` carries focus and both scroll offsets across the re-append. Every text is
 * untrusted repository content, rendered by the shared reader's strict profile. */
import { createContentsTree, createContentsReader, sizeText } from './contents-reader.mjs';

export const SOUL_INSTRUCTIONS_COPY = Object.freeze({
  title: 'Instructions',
  lead: 'what its instances are told',
  own: 'This soul',
  file: 'AGENTS.md',
  unreadable: "This soul's AGENTS.md could not be read.",
  // The kernel caps a file it reports at 200,000 characters (instance-inspect.mjs readTextCapped, soul-composition.mjs).
  truncated: 'Truncated at 200,000 characters',
  composedGroup: 'Instance',
  composedNote: 'after spawn, with injects',
  composed: 'Composed AGENTS.md',
  parts: n => `${n} part${n === 1 ? '' : 's'}`,
  soulPart: 'This soul',
  fromSoul: 'From this soul',
  injectedBy: label => `Injected by ${label}`,
  partTruncated: 'Truncated',
  pastCap: 'Not included: past the size limit.',
  openCapability: 'Open capability',
  copy: 'Copy composed AGENTS.md',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  cannotCompose: "Can't be composed here: see the problem above.",
  cannotRead: "This OATS answered composed instructions this Desktop can't read.",
});
export const COMPOSED_FEATURE = 'soul-composed-instructions';
/** The CLI composes a soul's AGENTS.md on request (`inspect --soul --instructions`). */
export const composedSupported = cli => !!cli?.ok && Array.isArray(cli.features) && cli.features.includes(COMPOSED_FEATURE);

export const soulInstructionsCSS = `
/* A part's file and nav labels: the soul's parts are prose labels, a capability's its id (monospace). */
.soul-instructions .cap-tree [role=treeitem] [role=group] .cap-node { font-family:inherit; font-size:12px; }
.soul-instructions .cap-tree [role=treeitem] [role=group] .cap-node-name.mono { font-family:var(--mono,monospace); font-size:11.5px; }
.oats-view .soul-instructions button.soul-copy { height:24px; min-height:24px; margin-left:auto; padding:0 8px; font-size:11.5px; }
.soul-part + .soul-part { margin-top:22px; }
.soul-part-head { display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 10px; margin:0 0 8px; font-size:11.5px; }
.soul-part-title { color:var(--fg); font-size:12.5px; font-weight:650; }
.soul-part-file { color:var(--fg); font-family:var(--mono,monospace); overflow-wrap:anywhere; }
.soul-part-size { color:var(--muted); }
.soul-part-flag { color:var(--warn); font-weight:600; }
.oats-view .soul-instructions button.soul-part-open { height:22px; min-height:22px; margin-left:auto; padding:0 8px; font-size:11.5px; }
/* The rules are secondary: the header text says where a part comes from (WCAG 1.4.1). */
.soul-part-body { padding-left:12px; border-left:3px solid var(--border); }
.soul-part[data-source=soul] > .soul-part-body { border-left-color:var(--accent); }
`;

/** Selection keys: the soul's own AGENTS.md, the composed document, and a part of it (by its index). */
export const OWN = 'own';
export const COMPOSED = 'composed';
const partKey = i => `part:${i}`;

/** The soul's AGENTS.md as a repository path: `<dir>/AGENTS.md` from the soul row's `path` (its directory in its
 * repository, e.g. `souls/<soul>`), when that is a plain relative path; else just `AGENTS.md`. */
export function soulInstructionsPath(dir) {
  if (typeof dir !== 'string') return SOUL_INSTRUCTIONS_COPY.file;
  const trimmed = dir.replace(/\/+$/, '');
  return plainPath(trimmed) ? `${trimmed}/${SOUL_INSTRUCTIONS_COPY.file}` : SOUL_INSTRUCTIONS_COPY.file;
}
const plainPath = p => typeof p === 'string' && !!p && !p.startsWith('/') && !/[\\\u0000-\u001f\u007f]/.test(p) && p.split('/').every(s => s && s !== '.' && s !== '..');
/** What the section shows for an inspected soul row: the own file's path, text (null: unreadable) and truncation. */
export function soulInstructionsOf(soul) {
  const reported = soul?.instructions && typeof soul.instructions === 'object' ? soul.instructions : null;
  return { path: soulInstructionsPath(soul?.path), text: typeof reported?.text === 'string' ? reported.text : null, truncated: reported?.truncated === true };
}
const utf8Bytes = text => typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : null;
const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
const span = v => record(v) && Number.isSafeInteger(v.start) && Number.isSafeInteger(v.end) && v.start >= 0 && v.start <= v.end && typeof v.truncated === 'boolean';

/** A block's text without its marker lines: the first line when it opens a block (`<!-- oats:`), and, after trailing
 * whitespace, the last when it closes one (`<!-- /oats:`; a block cut by the cap may have none). */
export function blockText(raw) {
  let text = raw;
  const first = text.indexOf('\n');
  if ((first < 0 ? text : text.slice(0, first)).startsWith('<!-- oats:')) text = first < 0 ? '' : text.slice(first + 1);
  text = text.replace(/\s+$/, '');
  const last = text.lastIndexOf('\n');
  if (text.slice(last + 1).startsWith('<!-- /oats:')) text = last < 0 ? '' : text.slice(0, last);
  return text;
}
/** A source's labels: in the navigation, and its part header's "Injected by …" (a capability's id; OATS's own blocks named). */
export function sourceLabels(source) {
  const capability = /^capability:(.+)$/.exec(source);
  if (capability) return { nav: capability[1], header: capability[1], capability: capability[1] };
  if (source === 'kernel:instance-boundary') return { nav: 'Instance boundary · OATS', header: 'OATS · instance boundary' };
  const mode = /^work-mode:(.+)$/.exec(source);
  if (mode) return { nav: `Work mode · ${mode[1]}`, header: `OATS · work mode ${mode[1]}` };
  const kernel = /^kernel:(.+)$/.exec(source);
  if (kernel) return { nav: `${kernel[1]} · OATS`, header: `OATS · ${kernel[1]}` };
  return { nav: source, header: source };
}
/**
 * The composed AGENTS.md of an inspected soul row: `undefined` without the key (the CLI was not asked, or cannot
 * compose), `null` when the kernel answered it cannot be composed here, `false` when the answer breaks its contract,
 * else `{ text, truncated, parts }` with the soul's part first.
 */
export function composedOf(soul, ownPath = soulInstructionsPath(soul?.path)) {
  if (!record(soul) || !Object.hasOwn(soul, 'composedInstructions')) return undefined;
  const c = soul.composedInstructions;
  if (c === null) return null;
  if (!record(c) || typeof c.text !== 'string' || typeof c.truncated !== 'boolean' || !span(c.body) || c.body.start !== 0 || !Array.isArray(c.sources)) return false;
  // The ranges tile the text, in order: body, then every block, the last ending at the text's end.
  let at = c.body.end;
  for (const s of c.sources) {
    if (!record(s) || typeof s.source !== 'string' || !s.source || !(s.file === null || typeof s.file === 'string') || !span(s) || s.start !== at) return false;
    at = s.end;
  }
  if (at !== c.text.length) return false;
  const soulPart = { source: 'soul', nav: SOUL_INSTRUCTIONS_COPY.soulPart, header: SOUL_INSTRUCTIONS_COPY.fromSoul, file: ownPath,
    text: c.text.slice(c.body.start, c.body.end).replace(/\s+$/, ''), truncated: c.body.truncated, past: c.body.truncated && c.body.start === c.body.end };
  const parts = [soulPart, ...c.sources.map(s => ({ source: s.source, ...sourceLabels(s.source), header: SOUL_INSTRUCTIONS_COPY.injectedBy(sourceLabels(s.source).header),
    file: plainPath(s.file) ? s.file : null, text: blockText(c.text.slice(s.start, s.end)), truncated: s.truncated, past: s.truncated && s.start === s.end && s.end === c.text.length }))];
  return { text: c.text, truncated: c.truncated, parts };
}

/**
 * @param {Document} doc
 * @param {object} [o]
 * @param {(url: string) => void} [o.openExternal]  an https: link
 * @param {(id: string) => boolean} [o.canOpenCapability]  the soul page can open this capability's page
 * @param {(id: string) => void} [o.openCapability]
 */
export function createSoulInstructions(doc, { openExternal = null, canOpenCapability = () => false, openCapability = null } = {}) {
  const node = (tag, cls, text) => { const el = doc.createElement(tag); if (cls) el.className = cls; if (text !== undefined && text !== null) el.textContent = text; return el; };
  const element = node('section', 'page-section cap-contents-section soul-instructions'); element.dataset.section = 'Instructions';
  const heading = node('h3', 'page-section-title'); heading.append(node('span', null, SOUL_INSTRUCTIONS_COPY.title), node('span', 'page-section-lead', SOUL_INSTRUCTIONS_COPY.lead));
  const card = node('div', 'cap-contents');
  const nav = node('nav', 'cap-contents-nav'); nav.setAttribute('aria-label', SOUL_INSTRUCTIONS_COPY.title);
  const navBody = node('div', 'cap-contents-nav-body');
  const reader = node('div', 'cap-contents-reader'); reader.setAttribute('role', 'region'); reader.tabIndex = 0;
  const head = node('div', 'cap-reader-head'); head.hidden = true;
  const body = node('div', 'cap-reader-body');
  nav.append(navBody); reader.append(head, body); card.append(nav, reader);
  element.append(heading, card);

  // `shown`: what the reader holds ('own' | 'composed'); a part is a place in the composed document.
  let alive = true, name = null, own = null, composed, navSignature = null, ownSignature = null, composedSignature = null, shown = null, selected = OWN;
  const expanded = new Set();
  const uid = `soul-instructions-${++instances}`;
  const timers = new Set();
  const keys = createContentsTree(nav, { selected: () => selected, activate: item => { if (item.dataset.path) open(item.dataset.path); },
    onExpand: (item, value) => { if (value) expanded.add(item.dataset.path); else expanded.delete(item.dataset.path); } });
  const fileReader = createContentsReader(doc, { reader, head, body, alive: () => alive, openExternal });
  const hasKey = key => key === OWN || (!!composed && (key === COMPOSED || composed.parts.some((_, i) => partKey(i) === key)));

  /** The page's inspected soul row (`inspected.souls[0]`). Unchanged → nothing: a repaint never touches what is open. */
  function update(soul) {
    if (!alive) return;
    name = typeof soul?.name === 'string' && soul.name ? soul.name : null;
    own = soulInstructionsOf(soul);
    composed = composedOf(soul, own.path);
    reader.setAttribute('aria-label', `Instructions of ${name || 'this soul'}`);
    if (!hasKey(selected)) selected = OWN;
    const signature = JSON.stringify([name, own.path, composed && composed.parts.map(p => [p.nav, p.capability ?? null]), composed === null ? 'null' : composed === false ? 'false' : composed === undefined ? 'absent' : 'parts']);
    if (signature !== navSignature) { navSignature = signature; paintNav(); }
    const ownNow = JSON.stringify(own), composedNow = JSON.stringify(composed ?? null);
    const ownChanged = ownNow !== ownSignature, composedChanged = composedNow !== composedSignature;
    ownSignature = ownNow; composedSignature = composedNow;
    // A repaint of what is shown keeps the reader's offset (the host's hold()); the browser clamps it.
    if (selected === OWN && (shown !== 'own' || ownChanged)) paintOwn();
    else if (selected !== OWN && (shown !== 'composed' || composedChanged)) paintComposed();
  }

  /* ── navigation ──────────────────────────────────────────────────────── */
  function paintNav() {
    const focusKey = nav.contains(doc.activeElement) ? doc.activeElement.closest('[role=treeitem]')?.dataset.focusKey : null;
    navBody.replaceChildren();
    // One tree of labelled groups (one tab stop; the arrows cross from one group to the other).
    const tree = node('ul', 'cap-tree'); tree.setAttribute('role', 'tree'); tree.setAttribute('aria-label', `Instructions of ${name || 'this soul'}`);
    tree.addEventListener('keydown', keys.onKey);
    const group = (id, title) => {
      const wrap = node('li'); wrap.setAttribute('role', 'none');
      title.id = id;
      const items = node('ul'); items.setAttribute('role', 'group'); items.setAttribute('aria-labelledby', id);
      wrap.append(title, items); tree.append(wrap); return items;
    };
    const shownPath = own.path !== SOUL_INSTRUCTIONS_COPY.file ? own.path : null;
    group(`${uid}-own`, node('div', 'cap-contents-group-label', SOUL_INSTRUCTIONS_COPY.own)).append(leaf(OWN, [node('span', 'cap-node-name', SOUL_INSTRUCTIONS_COPY.file), ...(shownPath ? [node('span', 'cap-node-file', shownPath)] : [])],
      { level: 1, label: shownPath ? `${SOUL_INSTRUCTIONS_COPY.file}, ${shownPath}` : SOUL_INSTRUCTIONS_COPY.file }));
    if (composed) group(`${uid}-composed`, node('div', 'cap-contents-group-label', SOUL_INSTRUCTIONS_COPY.composedGroup)).append(composedNode());
    navBody.append(tree);
    // The kernel answered but there is nothing to list: the group's label and a note beside the tree (notes are not tree items).
    if (composed === null || composed === false) navBody.append(node('div', 'cap-contents-group-label', SOUL_INSTRUCTIONS_COPY.composedGroup),
      node('p', 'cap-contents-note', composed === null ? SOUL_INSTRUCTIONS_COPY.cannotCompose : SOUL_INSTRUCTIONS_COPY.cannotRead));
    keys.syncRoving();
    // The tree item that held focus is found again by its key (or its group's composed item when its part is gone).
    if (focusKey) (nav.querySelector(`[data-focus-key="${focusKey}"]`) || nav.querySelector(`[data-focus-key="instructions:${COMPOSED}"]`) || nav.querySelector('[role=treeitem]'))?.focus({ preventScroll: true });
  }
  function leaf(key, content, { level, label }) {
    const item = treeItem(key, content, { level, label });
    item.querySelector(':scope > .cap-node').addEventListener('click', () => { keys.focusItem(item); open(key); });
    return item;
  }
  function treeItem(key, content, { level, label }) {
    const item = node('li'); item.setAttribute('role', 'treeitem'); item.setAttribute('aria-level', String(level));
    item.setAttribute('aria-selected', String(key === selected)); item.setAttribute('aria-label', label);
    item.dataset.path = key; item.dataset.focusKey = `instructions:${key}`; item.tabIndex = -1;
    const row = node('div', 'cap-node'); const twisty = node('span', 'cap-node-twisty'); twisty.setAttribute('aria-hidden', 'true');
    const copy = node('span', 'cap-node-copy'); copy.append(...content); row.append(twisty, copy); item.append(row);
    return item;
  }
  /** The Instance group's "AGENTS.md" (parallel to the soul's), "after spawn, with injects" on its second line (the
   * soul item's path style, in the proportional face: it is prose): selectable (the composed document at its top) and
   * expandable (its parts, in order). The reader's head names it "Composed AGENTS.md". */
  function composedNode() {
    const open_ = expanded.has(COMPOSED), count = SOUL_INSTRUCTIONS_COPY.parts(composed.parts.length);
    const item = treeItem(COMPOSED, [node('span', 'cap-node-name', SOUL_INSTRUCTIONS_COPY.file), node('span', 'cap-node-desc', SOUL_INSTRUCTIONS_COPY.composedNote)],
      { level: 1, label: `${SOUL_INSTRUCTIONS_COPY.file}, ${SOUL_INSTRUCTIONS_COPY.composedNote}` });
    item.setAttribute('aria-expanded', String(open_)); item.setAttribute('aria-description', count);
    const twisty = item.querySelector('.cap-node-twisty'); twisty.textContent = open_ ? '▾' : '▸';
    const children = node('ul'); children.setAttribute('role', 'group'); children.hidden = !open_;
    composed.parts.forEach((part, i) => children.append(leaf(partKey(i), [node('span', `cap-node-name${part.capability ? ' mono' : ''}`, part.nav)], { level: 2, label: part.nav })));
    item.append(children);
    // A click on the twisty only folds; anywhere else on the row opens the document (and shows its parts).
    item.querySelector(':scope > .cap-node').addEventListener('click', event => {
      keys.focusItem(item);
      if (event.target === twisty) { keys.toggle(item); return; }
      open(COMPOSED);
    });
    return item;
  }

  /* ── reader ──────────────────────────────────────────────────────────── */
  /** Open an item: the own file, the composed document at its top, or the composed document at a part. */
  function open(key) {
    if (!alive || !hasKey(key)) return;
    selected = key; keys.markSelected();
    if (key === OWN) { if (shown !== 'own') { paintOwn(); reader.scrollTop = 0; } return; }
    if (shown !== 'composed') paintComposed();
    if (key === COMPOSED) {
      const item = nav.querySelector(`[data-path="${COMPOSED}"]`);
      if (item?.getAttribute('aria-expanded') === 'false') keys.setExpanded(item, true);
      reader.scrollTop = 0; return;
    }
    const part = body.querySelector(`.soul-part[data-part="${key.slice(5)}"]`);
    if (part) fileReader.scrollTo(part);
  }
  /** The own file into the reader. A changed file (a refresh after an edit) repaints in place: the host's hold()
   * keeps the reader's offset, which the browser clamps to the new length. */
  function paintOwn() {
    shown = 'own';
    fileReader.paintHead(own.path, { bytes: own.text !== null && !own.truncated ? utf8Bytes(own.text) : null, flag: own.truncated ? SOUL_INSTRUCTIONS_COPY.truncated : null });
    fileReader.paintFile({ path: own.path, text: own.text, binary: false }, { missing: SOUL_INSTRUCTIONS_COPY.unreadable, binary: null });
  }
  /** The composed document: one section per part, its header saying where the part comes from. */
  function paintComposed() {
    shown = 'composed';
    fileReader.paintHead(SOUL_INSTRUCTIONS_COPY.composed, { bytes: composed.truncated ? null : utf8Bytes(composed.text),
      flag: composed.truncated ? SOUL_INSTRUCTIONS_COPY.truncated : null, actions: [copyButton(composed.text)] });
    body.replaceChildren(...composed.parts.map(partSection));
  }
  function partSection(part, i) {
    const section = node('section', 'soul-part'); section.dataset.part = String(i); section.dataset.source = part.source;
    const title = node('span', 'soul-part-title', part.header); title.id = `${uid}-part-${i}`;
    section.setAttribute('aria-labelledby', title.id);
    const headRow = node('div', 'soul-part-head'); headRow.append(title);
    if (part.file) headRow.append(node('span', 'soul-part-file', part.file));
    const size = part.source !== 'soul' && !part.past ? sizeText(utf8Bytes(part.text)) : null; if (size) headRow.append(node('span', 'soul-part-size', size));
    if (part.truncated && !part.past) headRow.append(node('span', 'soul-part-flag', SOUL_INSTRUCTIONS_COPY.partTruncated));
    if (part.capability && typeof openCapability === 'function' && canOpenCapability(part.capability)) {
      const button = node('button', 'act soul-part-open', SOUL_INSTRUCTIONS_COPY.openCapability); button.type = 'button';
      button.dataset.focusKey = `instructions:open:${part.capability}`; button.setAttribute('aria-description', part.capability);
      button.addEventListener('click', () => { if (alive) openCapability(part.capability); });
      headRow.append(button);
    }
    const content = node('div', 'soul-part-body');
    content.append(part.past ? fileReader.line(SOUL_INSTRUCTIONS_COPY.pastCap) : fileReader.fileView({ path: part.file || SOUL_INSTRUCTIONS_COPY.file, text: part.text }));
    section.append(headRow, content);
    return section;
  }
  /** Copies the kernel's exact text (markers included): what a new instance's AGENTS.md would hold. */
  function copyButton(text) {
    const button = node('button', 'act soul-copy', SOUL_INSTRUCTIONS_COPY.copy); button.type = 'button'; button.dataset.focusKey = 'instructions:copy';
    const say = label => {
      button.textContent = label;
      const timer = setTimeout(() => { timers.delete(timer); if (alive) button.textContent = SOUL_INSTRUCTIONS_COPY.copy; }, 1200); timers.add(timer);
    };
    button.addEventListener('click', async () => {
      try { await doc.defaultView.navigator.clipboard.writeText(text); if (alive) say(SOUL_INSTRUCTIONS_COPY.copied); }
      catch { if (alive) say(SOUL_INSTRUCTIONS_COPY.copyFailed); }
    });
    return button;
  }

  return {
    element, update,
    /** Before the host moves `element` (a page repaint re-appends it): detaching drops focus and the panes'
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
    dispose() { alive = false; for (const timer of timers) clearTimeout(timer); timers.clear(); fileReader.dispose(); },
  };
}
let instances = 0; // ids for the group labels, unique per document
