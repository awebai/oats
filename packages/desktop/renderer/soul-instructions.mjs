/** The soul page's Instructions section (spec D, part B1): what the soul tells its instances, in the Contents
 * card's grammar (contents-reader.mjs: a navigation tree left, the file right). It shows the soul's own
 * AGENTS.md from the inspection the page already read (`souls[0].instructions` = { file, text, truncated }):
 * no request of its own. The path shown is the file's place in its repository (the soul row's `path`, the
 * soul's directory there), never the host cache path in `file`.
 *
 * One controller per soul page subject (the inspector creates it with the frame and disposes it with the
 * subject), its element re-appended by every repaint of the page: an unchanged inspection never rebuilds its
 * tree or reader, and `hold()` carries focus and both scroll offsets across the re-append. Every text is
 * untrusted repository content, rendered by the shared reader's strict profile. */
// Its styles are the Contents card's (contentsCardCSS), which the Workspace view carries as capabilityContentsCSS.
import { createContentsTree, createContentsReader } from './contents-reader.mjs';

export const SOUL_INSTRUCTIONS_COPY = Object.freeze({
  title: 'Instructions',
  lead: 'what its instances are told',
  own: 'This soul',
  file: 'AGENTS.md',
  unreadable: "This soul's AGENTS.md could not be read.",
  // The kernel's inspection caps a file at 200,000 characters (lib/instance-inspect.mjs readTextCapped).
  truncated: 'Truncated at 200,000 characters',
});

/** The selection key of the soul's own AGENTS.md (D2 adds the composed document beside it). */
export const OWN = 'own';

/** The soul's AGENTS.md as a repository path: `<dir>/AGENTS.md` from the soul row's `path` (its directory in its
 * repository, e.g. `souls/<soul>`), when that is a plain relative path; else just `AGENTS.md`. */
export function soulInstructionsPath(dir) {
  if (typeof dir !== 'string') return SOUL_INSTRUCTIONS_COPY.file;
  const trimmed = dir.replace(/\/+$/, '');
  const segments = trimmed.split('/');
  const plain = trimmed && !trimmed.startsWith('/') && !/[\\\u0000-\u001f\u007f]/.test(trimmed) && segments.every(s => s && s !== '.' && s !== '..');
  return plain ? `${trimmed}/${SOUL_INSTRUCTIONS_COPY.file}` : SOUL_INSTRUCTIONS_COPY.file;
}
/** What the section shows for an inspected soul row: the own file's path, text (null: unreadable) and truncation. */
export function soulInstructionsOf(soul) {
  const reported = soul?.instructions && typeof soul.instructions === 'object' ? soul.instructions : null;
  return { path: soulInstructionsPath(soul?.path), text: typeof reported?.text === 'string' ? reported.text : null, truncated: reported?.truncated === true };
}
const utf8Bytes = text => typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : null;

/**
 * @param {Document} doc
 * @param {object} [o]
 * @param {(url: string) => void} [o.openExternal]  an https: link
 */
export function createSoulInstructions(doc, { openExternal = null } = {}) {
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

  let alive = true, own = null, navSignature = null, readerSignature = null, selected = OWN;
  const uid = `soul-instructions-${++instances}`;
  const keys = createContentsTree(nav, { selected: () => selected, activate: item => { if (item.dataset.path) open(item.dataset.path); } });
  const fileReader = createContentsReader(doc, { reader, head, body, alive: () => alive, openExternal });

  /** The page's inspected soul row (`inspected.souls[0]`). Unchanged → nothing: a repaint never touches what is open. */
  function update(soul) {
    if (!alive) return;
    own = soulInstructionsOf(soul);
    reader.setAttribute('aria-label', `Instructions of ${typeof soul?.name === 'string' && soul.name ? soul.name : 'this soul'}`);
    const signature = JSON.stringify([soul?.name ?? null, own.path]);
    if (signature !== navSignature) { navSignature = signature; paintNav(soul?.name); }
    const content = JSON.stringify(own);
    if (content !== readerSignature) { readerSignature = content; paintReader(); }
  }

  function paintNav(name) {
    const focused = nav.contains(doc.activeElement);
    navBody.replaceChildren();
    // One tree of labelled groups (one tab stop): D1 has the soul's own file only.
    const tree = node('ul', 'cap-tree'); tree.setAttribute('role', 'tree'); tree.setAttribute('aria-label', `Instructions of ${name || 'this soul'}`);
    tree.addEventListener('keydown', keys.onKey);
    const wrap = node('li'); wrap.setAttribute('role', 'none');
    const label = node('div', 'cap-contents-group-label', SOUL_INSTRUCTIONS_COPY.own); label.id = `${uid}-own`;
    const items = node('ul'); items.setAttribute('role', 'group'); items.setAttribute('aria-labelledby', label.id);
    const shown = own.path !== SOUL_INSTRUCTIONS_COPY.file ? own.path : null;
    items.append(leaf(OWN, [node('span', 'cap-node-name', SOUL_INSTRUCTIONS_COPY.file), ...(shown ? [node('span', 'cap-node-file', shown)] : [])],
      { level: 1, label: shown ? `${SOUL_INSTRUCTIONS_COPY.file}, ${shown}` : SOUL_INSTRUCTIONS_COPY.file }));
    wrap.append(label, items); tree.append(wrap); navBody.append(tree);
    keys.syncRoving();
    // The tree item that held focus is found again by its key.
    if (focused) nav.querySelector(`[data-focus-key="instructions:${OWN}"]`)?.focus({ preventScroll: true });
  }
  function leaf(path, content, { level, label }) {
    const item = node('li'); item.setAttribute('role', 'treeitem'); item.setAttribute('aria-level', String(level));
    item.setAttribute('aria-selected', String(path === selected)); item.setAttribute('aria-label', label);
    item.dataset.path = path; item.dataset.focusKey = `instructions:${path}`; item.tabIndex = -1;
    const row = node('div', 'cap-node'); const twisty = node('span', 'cap-node-twisty'); twisty.setAttribute('aria-hidden', 'true');
    const copy = node('span', 'cap-node-copy'); copy.append(...content); row.append(twisty, copy); item.append(row);
    row.addEventListener('click', () => { keys.focusItem(item); open(path); });
    return item;
  }
  /** Select an item; the reader already shows it unless its content changed. */
  function open(path) {
    if (!alive || path !== OWN) return;
    selected = path; keys.markSelected();
  }
  /** The own file into the reader. A changed file (a refresh after an edit) repaints in place: the host's hold()
   * keeps the reader's offset, which the browser clamps to the new length. */
  function paintReader() {
    fileReader.paintHead(own.path, { bytes: own.text !== null && !own.truncated ? utf8Bytes(own.text) : null, flag: own.truncated ? SOUL_INSTRUCTIONS_COPY.truncated : null });
    fileReader.paintFile({ path: own.path, text: own.text, binary: false }, { missing: SOUL_INSTRUCTIONS_COPY.unreadable, binary: null });
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
    dispose() { alive = false; fileReader.dispose(); },
  };
}
let instances = 0; // ids for the group labels, unique per document
