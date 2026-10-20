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
 * The soul's own skills (feature soul-skills, `inspect --soul --skills`: `souls[0].skills`) are a Skills group, in
 * the Contents card's skill grammar (contents-reader.mjs `skillTreeItem`): each skill expands to its files, and a
 * file opens in the reader under its repository path. The kernel's answer carries every file's text, so nothing
 * more is read. A group that can't list anything is its label and one note, never a guess.
 *
 * The tree has two sections, a rule between them: "Defined in this soul" (its AGENTS.md, its Skills) and "Composed
 * for an instance" (the composed AGENTS.md, and Skills: every skill an instance gets, each row saying where it comes
 * from). Each section is a top-level group of the one tree, named by its heading, so assistive technology meets
 * the boundary too; the tree stays one tab stop and the arrows cross it. Until the kernel lists the skills its
 * capabilities add (feature soul-composed-skills, a later change), the composed Skills are the soul's own, each
 * "From this soul", then one note saying a newer OATS lists the rest. A composed skill row is its own copy with its
 * own keys: selecting a file there selects that row, not the one above. A capability's skill (`module:<id>`) will say
 * "From <id>" (skillSource) and offer Open capability in the reader's head, as a composed part does in its header.
 *
 * Links resolve by repository path across the card: a link to a listed skill file opens it in place, from a skill
 * file or from an AGENTS.md, in the section the reader is showing.
 *
 * One controller per soul page subject (the inspector creates it with the frame and disposes it with the
 * subject), its element re-appended by every repaint of the page: an unchanged inspection never rebuilds its
 * tree or reader, and `hold()` carries focus and both scroll offsets across the re-append. Every text is
 * untrusted repository content, rendered by the shared reader's strict profile. */
import { createContentsTree, createContentsReader, skillTreeItem, sizeText, SKILL_COPY } from './contents-reader.mjs';
import { createHeadingSlugger } from './views/markdown.mjs';

export const SOUL_INSTRUCTIONS_COPY = Object.freeze({
  title: 'Instructions',
  lead: 'what its instances are told',
  soulSection: 'Defined in this soul',
  composedSection: 'Composed for an instance',
  file: 'AGENTS.md',
  unreadable: "This soul's AGENTS.md could not be read.",
  // The kernel caps a file it reports at 200,000 characters (instance-inspect.mjs readTextCapped, soul-composition.mjs).
  truncated: 'Truncated at 200,000 characters',
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
  skillsGroup: 'Skills',
  skillsAbsent: "This OATS doesn't report a soul's skills.",
  noSkills: 'No skills of its own.',
  skillsUnlistable: "Its skills can't be listed: see the problem above.",
  skillsUnreadable: "This OATS answered skills this Desktop can't read.",
  omitted: 'Not shown: past the size limit of this answer.',
  fromCapability: id => `From ${id}`,
  capabilitySkills: 'Skills that capabilities add are listed by a newer OATS.',
});
/** When the page asks for the composed AGENTS.md: composed-gate.mjs (shared with the server). */
export { COMPOSED_FEATURE, composedSupported } from '../../client/composed-gate.mjs';

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
/* The two sections of the tree: a heading each, a rule above the second. */
.soul-instructions .soul-section-title { margin:4px 6px 6px; color:var(--fg); font-size:11.5px; font-weight:650; }
.soul-instructions .soul-section + .soul-section { margin-top:12px; padding-top:10px; border-top:1px solid var(--border); }
.soul-instructions .soul-subgroup > .cap-contents-group-label { margin-top:12px; }
/* The rules are secondary: the header text says where a part comes from (WCAG 1.4.1). */
.soul-part-body { padding-left:12px; border-left:3px solid var(--border); }
.soul-part[data-source=soul] > .soul-part-body { border-left-color:var(--accent); }
`;

/** Selection keys: the soul's own AGENTS.md, the composed document, a part of it (by its index), and a skill file (by
 * its soul-relative path, unique in the answer), in "Defined in this soul" or in the composed Skills (its own keys).
 * A skill item is expanded, never selected: its key names it in `expanded`. */
export const OWN = 'own';
export const COMPOSED = 'composed';
const partKey = i => `part:${i}`;
const skillKey = (path, composed = false) => `${composed ? 'composed-' : ''}skill:${path}`;
const fileKey = (path, composed = false) => `${composed ? 'composed-' : ''}file:${path}`;
/** Where a composed skill comes from, in the vocabulary of instance.json and the spawn preview (#1421 §1): the soul
 * (`soul`), or a capability's module (`module:<capability id>`, once the kernel lists them). Its row's label, and the
 * capability its reader may open. Any other value names nothing: no label, rather than a guess. */
export function skillSource(source) {
  if (source === 'soul') return { label: SOUL_INSTRUCTIONS_COPY.fromSoul, capability: null };
  const capability = typeof source === 'string' ? /^module:(.+)$/.exec(source) : null;
  return capability ? { label: SOUL_INSTRUCTIONS_COPY.fromCapability(capability[1]), capability: capability[1] } : { label: null, capability: null };
}

/** A soul file's repository path: `<dir>/<path>` from the soul row's `path` (its directory in its repository, e.g.
 * `souls/<soul>`), when that is a plain relative path; else the soul-relative path alone. */
export function soulFilePath(dir, path) {
  const trimmed = typeof dir === 'string' ? dir.replace(/\/+$/, '') : null;
  return plainPath(trimmed) ? `${trimmed}/${path}` : path;
}
/** The soul's AGENTS.md as a repository path: `<dir>/AGENTS.md`, else just `AGENTS.md`. */
export const soulInstructionsPath = dir => soulFilePath(dir, SOUL_INSTRUCTIONS_COPY.file);
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
 * The soul's own skills of an inspected soul row: `undefined` without the key (the CLI was not asked, or does not report
 * them), `null` when the kernel answered they can't be listed (a problem names `skills`), `false` when the answer breaks
 * its contract, else the list in the kernel's order. One bad skill or file makes the whole answer `false`: a partial
 * answer is never shown. Every path is a plain path relative to the soul's directory, a file's under its skill's; a
 * file's `text` is `null` exactly when it is binary or omitted (past the answer's text budget).
 */
export function skillsOf(soul) {
  if (!record(soul) || !Object.hasOwn(soul, 'skills')) return undefined;
  const v = soul.skills;
  if (v === null) return null;
  if (!Array.isArray(v)) return false;
  const skillPaths = new Set(), filePaths = new Set(), out = [];
  for (const s of v) {
    if (!record(s) || typeof s.name !== 'string' || !s.name || !plainPath(s.path) || skillPaths.has(s.path)) return false;
    if (!(s.description === undefined || s.description === null || typeof s.description === 'string')) return false;
    if (!(s.filesTruncated === undefined || typeof s.filesTruncated === 'boolean') || !(s.files === null || Array.isArray(s.files))) return false;
    if (s.files === null && s.filesTruncated) return false;
    skillPaths.add(s.path);
    let files = null;
    if (s.files) {
      files = [];
      for (const f of s.files) {
        if (!record(f) || !plainPath(f.path) || !f.path.startsWith(`${s.path}/`) || filePaths.has(f.path)) return false;
        if (!Number.isSafeInteger(f.bytes) || f.bytes < 0 || !(f.text === null || typeof f.text === 'string') || typeof f.binary !== 'boolean' || typeof f.truncated !== 'boolean') return false;
        if (!(f.omitted === undefined || f.omitted === true)) return false;
        const omitted = f.omitted === true;
        if ((f.binary || omitted) !== (f.text === null)) return false;
        filePaths.add(f.path);
        files.push({ path: f.path, bytes: f.bytes, text: f.text, binary: f.binary, truncated: f.truncated, omitted });
      }
    }
    out.push({ name: s.name, path: s.path, description: typeof s.description === 'string' ? s.description : null, files, filesTruncated: s.filesTruncated === true });
  }
  return out;
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

  // `shown`: what the reader holds ('own' | 'composed' | a skill file's key); a part is a place in the composed document.
  // `files`: each listed skill file by its key ({ skill, file, path: its repository path, composed: in the composed
  // Skills }); `local`: the keys by repository path, [own, composed copy].
  let alive = true, name = null, own = null, composed, skills, files = new Map(), local = new Map();
  let navSignature = null, ownSignature = null, composedSignature = null, fileSignature = null, localSignature = null, shown = null, selected = OWN;
  const expanded = new Set(); // the composed item's key and each expanded skill's skillKey
  const uid = `soul-instructions-${++instances}`;
  const timers = new Set();
  // A skill item toggles (Enter/Space, as in Contents); any other item opens what it names.
  // An expandable item's key is its focus key's (the composed item's, or a skill's in either section).
  const keys = createContentsTree(nav, { selected: () => selected,
    activate: item => { if (item.dataset.skill !== undefined) keys.toggle(item); else if (item.dataset.path) open(item.dataset.path); },
    onExpand: (item, value) => { const key = item.dataset.focusKey.slice('instructions:'.length); if (value) expanded.add(key); else expanded.delete(key); } });
  // A link opens the file in the section the reader shows: from the composed document or a composed skill file, its composed copy.
  const inComposed = () => shown === 'composed' || !!files.get(shown)?.composed;
  const fileReader = createContentsReader(doc, { reader, head, body, alive: () => alive, openExternal,
    isLocal: path => local.has(path), openLocal: path => { const [mine, copy] = local.get(path) || []; open(inComposed() ? copy : mine); } });
  const hasKey = key => key === OWN || files.has(key) || (!!composed && (key === COMPOSED || composed.parts.some((_, i) => partKey(i) === key)));
  // Found by its key as data, never through a selector: a key holds the soul's own paths.
  const itemFor = focusKey => [...nav.querySelectorAll('[role=treeitem]')].find(item => item.dataset.focusKey === focusKey) || null;
  const fileSig = key => { const entry = files.get(key); return JSON.stringify(entry ? [entry.path, entry.file] : null); };

  /** The page's inspected soul row (`inspected.souls[0]`). Unchanged → nothing: a repaint never touches what is open. */
  function update(soul) {
    if (!alive) return;
    name = typeof soul?.name === 'string' && soul.name ? soul.name : null;
    own = soulInstructionsOf(soul);
    composed = composedOf(soul, own.path);
    skills = skillsOf(soul);
    files = new Map(); local = new Map();
    for (const skill of Array.isArray(skills) ? skills : []) for (const file of skill.files || []) {
      const path = soulFilePath(soul?.path, file.path);
      files.set(fileKey(file.path), { skill, file, path, composed: false });
      files.set(fileKey(file.path, true), { skill, file, path, composed: true });
      local.set(path, [fileKey(file.path), fileKey(file.path, true)]);
    }
    reader.setAttribute('aria-label', `Instructions of ${name || 'this soul'}`);
    if (!hasKey(selected)) selected = OWN;
    const listed = Array.isArray(skills) ? skills.map(s => [s.name, s.path, s.description, s.filesTruncated, s.files && s.files.map(f => f.path)]) : String(skills);
    const signature = JSON.stringify([name, own.path, composed && composed.parts.map(p => [p.nav, p.capability ?? null]), composed === null ? 'null' : composed === false ? 'false' : composed === undefined ? 'absent' : 'parts', listed]);
    if (signature !== navSignature) { navSignature = signature; paintNav(); }
    // What the reader's links resolve to is part of what it shows: another set of listed files repaints it.
    const ownNow = JSON.stringify(own), composedNow = JSON.stringify(composed ?? null), localNow = JSON.stringify([...local.keys()]);
    const linksChanged = localNow !== localSignature;
    const ownChanged = ownNow !== ownSignature || linksChanged, composedChanged = composedNow !== composedSignature || linksChanged;
    ownSignature = ownNow; composedSignature = composedNow; localSignature = localNow;
    // A repaint of what is shown keeps the reader's offset (the host's hold()); the browser clamps it.
    if (selected === OWN) { if (shown !== 'own' || ownChanged) paintOwn(); }
    else if (files.has(selected)) { if (shown !== selected || linksChanged || fileSig(selected) !== fileSignature) paintFile(selected); }
    else if (shown !== 'composed' || composedChanged) paintComposed();
  }

  /* ── navigation ──────────────────────────────────────────────────────── */
  function paintNav() {
    const focused = nav.contains(doc.activeElement) ? doc.activeElement.closest('[role=treeitem]') : null;
    const focusKey = focused?.dataset.focusKey, parentKey = focused?.parentElement.closest('[role=treeitem]')?.dataset.focusKey;
    navBody.replaceChildren();
    // One tree of two labelled sections, each holding its labelled groups (one tab stop; the arrows cross every boundary).
    const tree = node('ul', 'cap-tree'); tree.setAttribute('role', 'tree'); tree.setAttribute('aria-label', `Instructions of ${name || 'this soul'}`);
    tree.addEventListener('keydown', keys.onKey);
    /** A labelled group in `parent`: its wrapper row (role none) holds the title and the group, which it returns. */
    const group = (parent, id, title, cls) => {
      const wrap = node('li', cls); wrap.setAttribute('role', 'none');
      title.id = id;
      const items = node('ul'); items.setAttribute('role', 'group'); items.setAttribute('aria-labelledby', id);
      wrap.append(title, items); parent.append(wrap); return items;
    };
    /** A row that is not a tree item: a group's label and its note in place of the group, or a note alone. */
    const noteRow = (parent, label, ...notes) => {
      const row = node('li', label ? 'soul-subgroup' : null); row.setAttribute('role', 'none');
      if (label) row.append(node('div', 'cap-contents-group-label', label));
      row.append(...notes.map(text => node('p', 'cap-contents-note', text)));
      parent.append(row); return row;
    };
    const listed = Array.isArray(skills) && skills.length > 0;
    // Defined in this soul: its AGENTS.md, then its Skills.
    const soulItems = group(tree, `${uid}-soul`, node('div', 'soul-section-title', SOUL_INSTRUCTIONS_COPY.soulSection), 'soul-section');
    const shownPath = own.path !== SOUL_INSTRUCTIONS_COPY.file ? own.path : null;
    soulItems.append(leaf(OWN, [node('span', 'cap-node-name', SOUL_INSTRUCTIONS_COPY.file), ...(shownPath ? [node('span', 'cap-node-file', shownPath)] : [])],
      { level: 1, label: shownPath ? `${SOUL_INSTRUCTIONS_COPY.file}, ${shownPath}` : SOUL_INSTRUCTIONS_COPY.file }));
    if (listed) {
      const items = group(soulItems, `${uid}-skills`, node('div', 'cap-contents-group-label', SOUL_INSTRUCTIONS_COPY.skillsGroup), 'soul-subgroup');
      for (const skill of skills) items.append(skillItem(skill));
    } else noteRow(soulItems, SOUL_INSTRUCTIONS_COPY.skillsGroup, skillsNote());
    // Composed for an instance: the composed AGENTS.md (or why there is none; nothing when this OATS doesn't compose), then Skills.
    const composedItems = group(tree, `${uid}-composed`, node('div', 'soul-section-title', SOUL_INSTRUCTIONS_COPY.composedSection), 'soul-section');
    if (composed) composedItems.append(composedNode());
    else if (composed === null || composed === false) noteRow(composedItems, null, composed === null ? SOUL_INSTRUCTIONS_COPY.cannotCompose : SOUL_INSTRUCTIONS_COPY.cannotRead);
    if (listed) {
      const items = group(composedItems, `${uid}-composed-skills`, node('div', 'cap-contents-group-label', SOUL_INSTRUCTIONS_COPY.skillsGroup), 'soul-subgroup');
      for (const skill of skills) items.append(skillItem(skill, skillSource('soul')));
      items.parentElement.append(node('p', 'cap-contents-note', SOUL_INSTRUCTIONS_COPY.capabilitySkills));
    } else if (Array.isArray(skills)) noteRow(composedItems, SOUL_INSTRUCTIONS_COPY.skillsGroup, skillsNote(), SOUL_INSTRUCTIONS_COPY.capabilitySkills);
    else noteRow(composedItems, SOUL_INSTRUCTIONS_COPY.skillsGroup, skillsNote());
    navBody.append(tree);
    keys.syncRoving();
    // The tree item that held focus is found again by its key, else its parent's (a part's composed item, a file's skill).
    if (focusKey) (itemFor(focusKey) || (parentKey && itemFor(parentKey)) || nav.querySelector('[role=treeitem]'))?.focus({ preventScroll: true });
  }
  /** A skill's item: in "Defined in this soul", or (with `source`) its copy in the composed Skills, its own keys and the source as its second line. */
  function skillItem(skill, source = null) {
    const composedCopy = !!source;
    return skillTreeItem(doc, skill, { open: expanded.has(skillKey(skill.path, composedCopy)), focusKey: `instructions:${skillKey(skill.path, composedCopy)}`, keys,
      source: source?.label ?? null,
      fileItem: (file, shown) => leaf(fileKey(file.path, composedCopy), [node('span', 'cap-node-name mono', shown)], { level: 2, label: shown }) });
  }
  const skillsNote = () => skills === undefined ? SOUL_INSTRUCTIONS_COPY.skillsAbsent : skills === null ? SOUL_INSTRUCTIONS_COPY.skillsUnlistable
    : skills === false ? SOUL_INSTRUCTIONS_COPY.skillsUnreadable : SOUL_INSTRUCTIONS_COPY.noSkills;
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
  /** "Composed for an instance"'s "AGENTS.md" (parallel to the soul's), "after spawn, with injects" on its second line (the
   * description style, `cap-node-desc`, as a skill's description in Contents; not the path's mono): selectable (the composed document at its top) and
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
  /** Open an item: the own file, a skill file (its skill expanded, as a link to it may come from elsewhere), the
   * composed document at its top, or the composed document at a part. */
  function open(key) {
    if (!alive || !hasKey(key)) return;
    selected = key; keys.markSelected();
    if (key === OWN) { if (shown !== 'own') { paintOwn(); reader.scrollTop = 0; } return; }
    const entry = files.get(key);
    if (entry) {
      const item = itemFor(`instructions:${skillKey(entry.skill.path, entry.composed)}`);
      if (item?.getAttribute('aria-expanded') === 'false') keys.setExpanded(item, true);
      if (shown !== key) { paintFile(key); reader.scrollTop = 0; }
      return;
    }
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
  /** A skill file into the reader, under its repository path: its full size, the kernel's cut, and its text through the
   * strict reader; a binary file and a file past the answer's text budget are a line each. */
  function paintFile(key) {
    const { file, path } = files.get(key);
    shown = key; fileSignature = fileSig(key);
    fileReader.paintHead(path, { bytes: file.bytes, flag: file.truncated ? SKILL_COPY.truncated : null });
    fileReader.paintFile({ path, text: file.text, binary: file.binary }, { missing: SOUL_INSTRUCTIONS_COPY.omitted, binary: SKILL_COPY.binary });
  }
  /** The composed document: one section per part, its header saying where the part comes from. */
  function paintComposed() {
    shown = 'composed';
    fileReader.paintHead(SOUL_INSTRUCTIONS_COPY.composed, { bytes: composed.truncated ? null : utf8Bytes(composed.text),
      flag: composed.truncated ? SOUL_INSTRUCTIONS_COPY.truncated : null, actions: [copyButton(composed.text)] });
    body.replaceChildren(...composed.parts.map(partSection));
    uniqueIds([...body.querySelectorAll(':scope > .soul-part')]);
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
    content.append(part.past ? fileReader.line(SOUL_INSTRUCTIONS_COPY.pastCap) : fileReader.fileView({ path: part.file || SOUL_INSTRUCTIONS_COPY.file, text: part.text }, { markdown: true }));
    section.append(headRow, content);
    return section;
  }
  /** Each part is rendered on its own, so its heading ids are numbered within the part. The composed document
   * renumbers them in document order with one slugger (`usage`, `usage-1`, `usage-2`: the ids the whole AGENTS.md
   * would give), and a part's own `#fragment` links follow its renamed headings; any other fragment is looked up
   * across the whole document, as written. */
  function uniqueIds(sections) {
    const slugOf = createHeadingSlugger();
    for (const section of sections) {
      const renamed = new Map();
      for (const h of section.querySelectorAll('.soul-part-body h1, .soul-part-body h2, .soul-part-body h3, .soul-part-body h4')) {
        const id = slugOf(h.textContent);
        if (id !== h.id) { renamed.set(h.id, id); h.id = id; }
      }
      if (!renamed.size) continue;
      for (const a of section.querySelectorAll('.soul-part-body a[href^="#"]')) {
        let id; try { id = decodeURIComponent(a.getAttribute('href').slice(1)); } catch { continue; }
        if (renamed.has(id)) a.setAttribute('href', `#${encodeURIComponent(renamed.get(id))}`);
      }
    }
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
