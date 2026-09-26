/** Workspace v4 Setup (W1 list, W2 graph): what the workspace declares in git
 * (members, packages, teams) beside what lives only on this computer.
 * Presentation only, from `oats workspace status` (and the roster, the CLI
 * probe, the souls list): nothing is inferred and unreported facts are not
 * shown. Kernel #217 (desktop-facts) adds the files, this computer's clones,
 * available package versions, disabled souls and the lock file; each is shown
 * only when reported. */
import { iconElement } from './shell-icons.mjs';
import { memberState } from './workspace-catalog.mjs';
import { packageOrigin } from './capability-page.mjs';

export const setupCSS = `
.setup { display:flex; flex-direction:column; gap:16px; min-width:0; }
.setup-lede { display:flex; align-items:baseline; flex-wrap:wrap; gap:4px 12px; min-width:0; }
.setup-lede h2 { margin:0; color:var(--fg); font-size:18px; font-weight:700; letter-spacing:-.01em; }
.setup-lede-where { color:var(--muted); font-size:12.5px; min-width:0; overflow-wrap:anywhere; }
.setup-lede-where .mono { font-family:var(--mono,monospace); }
.setup-lede-where .strong { color:var(--fg); }
.setup-cols { display:grid; grid-template-columns:minmax(0,1fr) 380px; gap:16px; align-items:start; min-width:0; }
.setup-col { display:flex; flex-direction:column; gap:16px; min-width:0; }
@container (max-width: 980px) { .setup-cols { grid-template-columns:minmax(0,1fr); } }
.setup-box { background:var(--surface); border:1px solid var(--border); border-radius:10px; overflow:hidden; min-width:0; }
.setup-box-head { display:flex; align-items:center; gap:10px; min-height:44px; padding:0 16px; box-sizing:border-box; border-bottom:1px solid var(--border); min-width:0; }
.setup-box-head h3 { margin:0; flex:none; color:var(--fg); font-size:13px; font-weight:650; }
.setup-box-head .shell-icon { flex:none; color:var(--muted); }
.setup-box-lead { min-width:0; color:var(--muted); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.setup-scope { display:inline-flex; align-items:center; gap:5px; flex:none; margin-left:auto; height:20px; padding:0 7px; border-radius:5px; background:var(--tag-bg); color:var(--muted); font-size:11px; font-weight:550; white-space:nowrap; }
.setup-row { display:grid; grid-template-columns:minmax(0,1.3fr) 150px minmax(0,1fr) 150px; gap:12px; align-items:center; min-height:42px; padding:0 16px; box-sizing:border-box; border-top:1px solid var(--tag-bg); }
.setup-box-head + .setup-row { border-top:0; }
.setup-row > * { min-width:0; }
.setup-name { display:flex; align-items:center; gap:8px; min-width:0; color:var(--fg); font:12.5px var(--mono,monospace); }
.setup-name .shell-icon { flex:none; color:var(--muted); }
.setup-name-text { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
.setup-version { flex:none; color:var(--muted); }
.setup-host { flex:none; padding:0 5px; border:1px solid var(--border); border-radius:4px; color:var(--muted); font:10.5px var(--sans,system-ui); }
.setup-state { display:inline-flex; align-items:center; gap:6px; justify-self:start; height:22px; padding:0 8px; border-radius:5px; background:var(--tag-bg); color:var(--muted); font-size:11.5px; font-weight:600; white-space:nowrap; }
.setup-state.warn { background:var(--attn-bg); color:var(--warn); }
.setup-cell { color:var(--fg); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.setup-cell.muted { color:var(--muted); }
.setup-cell.warn { color:var(--warn); }
.setup-end { justify-self:end; color:var(--muted); font-size:12px; white-space:nowrap; }
.setup-end.warn { color:var(--warn); font-weight:600; }
.oats-view .setup button.setup-link-act { justify-self:end; height:auto; min-height:0; padding:2px 0; border:0; background:transparent; color:var(--accent); font:600 12px var(--sans,system-ui); white-space:nowrap; cursor:pointer; }
.oats-view .setup button.setup-link-act:hover { text-decoration:underline; }
.oats-view .setup button.setup-link-act:focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:3px; }
.setup-empty { margin:0; padding:14px 16px; color:var(--muted); font-size:12px; }
.setup-team { display:flex; flex-direction:column; gap:4px; padding:10px 16px; border-top:1px solid var(--tag-bg); }
.setup-box-head + .setup-team { border-top:0; }
.setup-team-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.setup-team-label { display:inline-flex; align-items:center; height:22px; padding:0 8px; border-radius:5px; background:var(--tag-bg); color:var(--fg); font-size:12px; font-weight:650; }
.setup-team-meta { color:var(--muted); font-size:11.5px; }
.setup-team-warn { color:var(--warn); font-size:11.5px; line-height:1.45; }
.setup-team-note { margin:0; padding:10px 16px; border-top:1px solid var(--tag-bg); color:var(--muted); font-size:11.5px; line-height:1.5; }
.setup-local { background:var(--surface-2); border:1px dashed var(--border); border-radius:10px; overflow:hidden; min-width:0; }
.setup-local .setup-box-head { border-bottom:1px dashed var(--border); }
.setup-local .setup-scope { background:var(--surface); border:1px solid var(--border); }
.setup-local-rows { display:flex; flex-direction:column; padding:6px 16px 10px; margin:0; }
.setup-kv { display:grid; grid-template-columns:96px minmax(0,1fr); gap:10px; align-items:center; min-height:30px; }
.setup-kv dt { color:var(--muted); font-size:12px; }
.setup-kv dd { margin:0; color:var(--fg); font:12px var(--mono,monospace); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.setup-kv dd.warn { color:var(--warn); }
.setup-kv dd.muted { color:var(--muted); }
.setup-kv dd.wrap { white-space:normal; overflow:visible; overflow-wrap:anywhere; padding:6px 0; line-height:1.45; }
.setup-local-sub { margin:0; padding:10px 16px 0; border-top:1px dashed var(--border); color:var(--muted); font-size:11px; font-weight:650; letter-spacing:.05em; text-transform:uppercase; }
.oats-view .setup button.setup-file { height:auto; min-height:0; padding:0; border:0; background:transparent; color:var(--accent); font:inherit; font-family:var(--mono,monospace); text-decoration:underline; text-underline-offset:2px; cursor:pointer; overflow-wrap:anywhere; text-align:left; }
.oats-view .setup button.setup-file:focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:3px; }
/* W2: this computer → the workspace → its members and packages. */
.setup-graph-wrap { display:grid; grid-template-columns:minmax(0,1fr); gap:16px; align-items:stretch; min-width:0; }
.setup-graph-wrap.with-panel { grid-template-columns:minmax(0,1fr) 340px; }
@container (max-width: 1060px) { .setup-graph-wrap.with-panel { grid-template-columns:minmax(0,1fr); } }
.setup-graph-box { container-type:inline-size; min-width:0; }
.setup-graph { display:flex; align-items:center; min-width:0; margin:0; }
.setup-here { flex:none; width:230px; display:flex; flex-direction:column; gap:10px; padding:14px; box-sizing:border-box; border:1px dashed var(--border); border-radius:12px; background:var(--surface-2); }
.setup-caption { color:var(--muted); font-size:11px; font-weight:650; letter-spacing:.05em; text-transform:uppercase; }
.setup-card { display:flex; flex-direction:column; gap:3px; min-width:0; padding:10px 12px; box-sizing:border-box; border:1px solid var(--border); border-radius:8px; background:var(--surface); }
.setup-card-title { color:var(--fg); font-size:12.5px; font-weight:650; overflow-wrap:anywhere; }
.setup-card-meta { color:var(--muted); font-size:11.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.setup-card-meta.mono { font:11.5px var(--mono,monospace); }
.setup-lock { flex:none; width:96px; display:flex; flex-direction:column; align-items:center; gap:4px; color:var(--muted); font:10.5px var(--mono,monospace); }
.setup-lock.warn { color:var(--warn); }
.setup-lock-text { display:inline-flex; align-items:center; gap:2px; }
.setup-edge { display:block; width:100%; border-top:1.5px solid var(--graph-edge); }
.setup-shared { flex:1; min-width:0; align-self:stretch; display:flex; flex-direction:column; padding:14px 18px; box-sizing:border-box; border:1px solid var(--border); border-radius:12px; background:var(--surface); }
.setup-shared-body { flex:1; display:flex; align-items:center; min-width:0; }
.setup-ws { flex:none; width:176px; border:1.5px solid var(--live); background:var(--sel); }
.setup-ws .setup-card-title { font-weight:700; }
.setup-ws .setup-card-meta { color:var(--fg); }
.setup-stub { flex:none; width:28px; border-top:1.5px solid var(--graph-edge); }
.setup-tree { flex:1; min-width:0; display:flex; flex-direction:column; margin:0; padding:0; list-style:none; }
.setup-tree > li { position:relative; padding:4px 0 4px 22px; }
.setup-tree > li::before { content:''; position:absolute; left:0; top:0; bottom:0; border-left:1.5px solid var(--graph-edge); }
.setup-tree > li:first-child::before { top:50%; }
.setup-tree > li:last-child::before { bottom:50%; }
.setup-tree > li.setup-tree-label { padding:10px 0 4px 22px; color:var(--muted); font-size:11px; font-weight:650; letter-spacing:.05em; text-transform:uppercase; }
.setup-tree > li.setup-tree-label:first-child { padding-top:4px; }
.setup-tree > li:not(.setup-tree-label)::after { content:''; position:absolute; left:0; top:50%; width:22px; border-top:1.5px solid var(--graph-edge); }
.setup-tree > li.bad::after { border-top:1.5px dashed var(--attn-dot); }
.setup-node { display:flex; align-items:center; gap:8px; width:100%; height:34px; min-height:34px; padding:0 10px; box-sizing:border-box; border:1px solid var(--border); border-radius:7px; background:var(--surface); color:var(--fg); font:inherit; text-align:left; }
.oats-view .setup button.setup-node { cursor:pointer; font-weight:400; }
.oats-view .setup button.setup-node:hover { border-color:var(--sel-border); }
.oats-view .setup button.setup-node:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
.setup-node .shell-icon { flex:none; color:var(--muted); }
.setup-node-name { min-width:0; font:600 12px var(--mono,monospace); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.setup-node-meta { flex:none; margin-left:auto; color:var(--muted); font-size:11.5px; white-space:nowrap; }
.setup-node.bad { border-style:dashed; border-color:var(--attn-border); background:var(--attn-bg); }
.setup-node.bad .setup-node-meta { color:var(--warn); }
.setup-node.selected { border-color:var(--live); box-shadow:0 0 0 3px var(--sel); }
.setup-node.bad.selected { border-color:var(--attn-dot); box-shadow:0 0 0 3px var(--attn-border); }
@container (max-width: 720px) {
 .setup-graph { flex-direction:column; align-items:stretch; }
 .setup-here { width:auto; }
 .setup-lock { width:auto; flex-direction:row; justify-content:center; padding:6px 0; }
 .setup-lock-text { display:inline-flex; align-items:center; gap:2px; }
.setup-edge { width:0; height:14px; border-top:0; border-left:1.5px solid var(--graph-edge); }
 .setup-shared-body { flex-direction:column; align-items:stretch; gap:10px; }
 .setup-ws { width:auto; }
 .setup-stub { display:none; }
}
@container (max-width: 860px) { .setup-here { width:190px; } .setup-lock { width:64px; } .setup-ws { width:150px; } .setup-stub { width:18px; } }
/* The Member panel (W2): the handshake, what it means, the kernel's detail. */
.setup-panel { display:flex; flex-direction:column; min-width:0; background:var(--surface); border:1px solid var(--border); border-radius:12px; overflow:hidden; }
.setup-panel-head { display:flex; align-items:center; gap:8px; min-height:48px; padding:0 10px 0 16px; box-sizing:border-box; border-bottom:1px solid var(--border); }
.setup-panel-head h3 { margin:0; color:var(--fg); font-size:13px; font-weight:650; }
.oats-view .setup-panel-head button.icon-act { margin-left:auto; width:28px; height:28px; min-height:28px; padding:0; display:grid; place-items:center; }
.setup-panel-body { display:flex; flex-direction:column; gap:20px; padding:18px 16px; }
.setup-panel-id { display:flex; flex-direction:column; align-items:flex-start; gap:6px; }
.setup-panel-name { color:var(--fg); font:700 15px var(--mono,monospace); overflow-wrap:anywhere; }
.setup-panel section { display:flex; flex-direction:column; gap:8px; }
.setup-panel h4 { margin:0; color:var(--muted); font-size:11px; font-weight:650; letter-spacing:.05em; text-transform:uppercase; }
.setup-hand { border:1px solid var(--border); border-radius:8px; overflow:hidden; }
.setup-hand-row { display:flex; gap:10px; padding:10px 12px; }
.setup-hand-row + .setup-hand-row { border-top:1px solid var(--tag-bg); }
.setup-hand-mark { flex:none; width:13px; padding-top:2px; color:var(--fg); font-weight:700; line-height:1; }
.setup-hand-mark.warn { color:var(--warn); }
.setup-hand-mark.unknown { color:var(--muted); }
.setup-hand-copy { display:flex; flex-direction:column; gap:2px; min-width:0; }
.setup-hand-title { color:var(--fg); font-size:12.5px; font-weight:600; }
.setup-hand-sub { color:var(--muted); font-size:11.5px; overflow-wrap:anywhere; }
.setup-panel p { margin:0; color:var(--fg); font-size:12.5px; line-height:1.55; }
.setup-panel p.muted { color:var(--muted); font-size:11.5px; line-height:1.5; }
.setup-panel p.warn { color:var(--warn); }
.setup-panel p.mono { font-size:12px; overflow-wrap:anywhere; }
.setup-panel-acts { display:flex; flex-wrap:wrap; gap:8px; }
.setup-panel .mono { font-family:var(--mono,monospace); }
.setup-detail { padding:10px 12px; border-radius:8px; background:var(--surface-2); color:var(--fg); font:12px/1.6 var(--mono,monospace); overflow-wrap:anywhere; }
`;

const list = v => Array.isArray(v) ? v : [];
const text = v => typeof v === 'string' && v ? v : null;
const short = v => typeof v === 'string' && /^[0-9a-f]{7,}$/i.test(v) ? v.slice(0, 7) : v;
const tail = v => String(v || '').split('/').filter(Boolean).pop()?.replace(/\.git$/, '') || String(v || '');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
function el(doc, tag, value, cls) {
  const node = doc.createElement(tag);
  if (value !== undefined && value !== null) node.textContent = value;
  if (cls) node.className = cls;
  return node;
}

/** A member's handshake chip: a check and "confirmed", or "○ <state>" (warn). */
function stateChip(doc, member) {
  const state = memberState(member);
  const chip = el(doc, 'span', null, `setup-state${state.ok ? '' : ' warn'}`);
  chip.append(state.ok ? iconElement(doc, 'check', { size: 12 }) : el(doc, 'span', '○'), el(doc, 'span', state.label));
  chip.dataset.state = state.status;
  return chip;
}
const memberName = member => text(member?.name) || tail(member?.key);
const webUrl = v => typeof v === 'string' && /^https:\/\//.test(v) ? v : null;
const fileRef = v => text(v?.path) ? v : null;
/** A file the kernel names ({ path, url }): its path, a link when it has a web address. */
function fileName(doc, file, openExternal) {
  const url = webUrl(file.url);
  if (!url || !openExternal) { const name = el(doc, 'span', file.path, 'mono'); name.title = file.path; return name; }
  const link = el(doc, 'button', file.path, 'setup-file'); link.type = 'button'; link.title = url;
  link.setAttribute('aria-label', `Open ${file.path}`); link.addEventListener('click', () => openExternal(url));
  return link;
}
/** A path under the deployment folder, relative to it. */
const within = (path, folder) => folder && path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path;
/** A newer version of a catalog package than the lock holds (packages[].latest). */
const available = pkg => text(pkg?.latest?.version) ? pkg.latest : null;
/** What a member contributes, or why it contributes nothing yet. */
function contribution(member) {
  const state = memberState(member), souls = list(member.souls).length, caps = list(member.capabilities).length;
  if (!state.ok) return { text: souls ? `${plural(souls, 'soul')} hidden until it ${member.status === 'cannot-read' ? 'can be read' : 'joins'}` : `contributes nothing until it ${member.status === 'cannot-read' ? 'can be read' : 'joins'}`, muted: true };
  const parts = [souls ? plural(souls, 'soul') : null, caps ? plural(caps, 'capability', 'capabilities') : null].filter(Boolean);
  return { text: parts.join(' · ') || 'nothing yet', muted: !parts.length };
}
/** The lock in workspace status terms: current, or what is out of date. */
export function lockText(status) {
  const unsynced = list(status?.unsynced).length, stale = list(status?.stale).length;
  if (!unsynced && !stale) return { text: 'current', warn: false };
  return { text: ['out of date', unsynced ? `${unsynced} not locked` : null, stale ? `${stale} no longer declared` : null].filter(Boolean).join(' · '), warn: true };
}
const scope = (doc, label, icon) => { const tag = el(doc, 'span', null, 'setup-scope'); tag.append(iconElement(doc, icon, { size: 12 }), el(doc, 'span', label)); return tag; };
function box(doc, title, lead, scopeLabel, { local = false, icon = null } = {}) {
  const card = el(doc, 'section', null, local ? 'setup-local' : 'setup-box'); card.dataset.box = title;
  const head = el(doc, 'div', null, 'setup-box-head');
  if (icon) head.append(iconElement(doc, icon, { size: 15 }));
  head.append(el(doc, 'h3', title));
  if (lead) head.append(el(doc, 'span', lead, 'setup-box-lead'));
  head.append(scope(doc, scopeLabel, local ? 'computer' : 'repo'));
  card.append(head);
  return card;
}

/** The whole Setup tab. view: 'list' | 'graph'; selected: a member key (graph panel). */
export function renderSetup(host, { status, instances = [], souls = [], cli = null, view = 'list', selected = null, onSelect = () => {}, onOpenRepo = null, onOpenPackages = null, openExternal = null }) {
  const doc = host.ownerDocument;
  host.replaceChildren();
  const root = el(doc, 'div', null, 'setup'); root.dataset.view = view;
  root.append(lede(doc, status, openExternal));
  if (view === 'graph') root.append(graph(doc, { status, instances, selected, onSelect, onOpenRepo, onOpenPackages, openExternal }));
  else root.append(columns(doc, { status, instances, souls, cli, onSelect, onOpenRepo, onOpenPackages }));
  host.append(root);
  return root;
}

/** "<name> declared in <host>'s workspace file @ <commit>", naming the file when the
 * kernel reports it (workspace.file); the Desktop never guesses a file name. */
function lede(doc, status, openExternal) {
  const ws = status?.workspace || {};
  const line = el(doc, 'div', null, 'setup-lede');
  line.append(el(doc, 'h2', text(ws.name) || 'Workspace'));
  if (text(ws.key)) {
    const host = list(status?.members).find(m => m.key === ws.key);
    const where = el(doc, 'span', null, 'setup-lede-where'); where.title = ws.url || ws.key;
    where.append('declared in ', el(doc, 'span', host ? memberName(host) : tail(ws.url || ws.key), 'mono strong'));
    const file = fileRef(ws.file);
    if (file) where.append("'s ", fileName(doc, file, openExternal)); else where.append("'s workspace file");
    if (text(ws.commit)) { where.append(' @ '); const c = el(doc, 'span', short(ws.commit), 'mono'); c.title = ws.commit; where.append(c); }
    line.append(where);
  }
  return line;
}

function columns(doc, { status, instances, souls, cli, onSelect }) {
  const ws = status?.workspace || {};
  const cols = el(doc, 'div', null, 'setup-cols'), main = el(doc, 'div', null, 'setup-col'), side = el(doc, 'div', null, 'setup-col');
  // Members: the repositories that contribute souls and capabilities, always at their latest.
  const members = box(doc, 'Members', 'repos that contribute souls and capabilities · always latest', 'Shared · Git');
  for (const member of list(status?.members)) {
    const row = el(doc, 'div', null, 'setup-row'); row.dataset.member = member.key;
    const name = el(doc, 'span', null, 'setup-name'); name.append(iconElement(doc, 'repo', { size: 15 }));
    const label = el(doc, 'span', memberName(member), 'setup-name-text'); label.title = member.key; name.append(label);
    if (member.key === ws.key) name.append(el(doc, 'span', 'host', 'setup-host'));
    const gives = contribution(member), state = memberState(member);
    const cell = el(doc, 'span', gives.text, `setup-cell${gives.muted ? ' muted' : ''}`); cell.title = gives.text;
    row.append(name, stateChip(doc, member), cell);
    if (!state.ok) {
      const act = el(doc, 'button', 'Why?', 'setup-link-act'); act.type = 'button';
      act.setAttribute('aria-label', `${memberName(member)}: why it ${state.why}`);
      act.addEventListener('click', () => onSelect(member.key)); row.append(act);
    } else row.append(el(doc, 'span', '', 'setup-end'));
    members.append(row);
  }
  if (!list(status?.members).length) members.append(el(doc, 'p', 'No member repositories reported.', 'setup-empty'));
  // External souls: listed by the workspace from a repository it does not take as a member.
  for (const item of list(status?.external)) {
    const row = el(doc, 'div', null, 'setup-row'); row.dataset.external = text(item.soul) || '';
    const name = el(doc, 'span', null, 'setup-name'); name.append(iconElement(doc, 'repo', { size: 15 }));
    const label = el(doc, 'span', text(item.soul) || 'soul', 'setup-name-text'); label.title = text(item.source) || ''; name.append(label);
    row.append(name, el(doc, 'span', 'external soul', 'setup-state'), el(doc, 'span', [tail(String(item.source || '').replace(/@[^@/]*$/, '')), text(item.team)].filter(Boolean).join(' · '), 'setup-cell muted'), el(doc, 'span', '', 'setup-end'));
    members.append(row);
  }
  // Packages: versioned bundles, pinned here and fingerprinted in the lock.
  const packages = box(doc, 'Packages', 'versioned bundles · pinned here, fingerprinted in the lock', 'Shared · Git');
  for (const pkg of list(status?.packages)) {
    const row = el(doc, 'div', null, 'setup-row'); row.dataset.package = pkg.id;
    const name = el(doc, 'span', null, 'setup-name'); name.append(iconElement(doc, 'package', { size: 15 }), el(doc, 'span', pkg.id, 'setup-name-text'));
    if (text(pkg.version)) name.append(el(doc, 'span', pkg.version, 'setup-version'));
    const origin = el(doc, 'span', packageOrigin(pkg.source) || '', 'setup-cell muted'); origin.title = text(pkg.source) || '';
    const caps = list(pkg.capabilities).join(' · ');
    const provides = el(doc, 'span', caps, 'setup-cell'); provides.title = caps;
    row.append(name, origin, provides);
    const newer = available(pkg), end = el(doc, 'span', newer ? `${newer.version} available` : 'locked', 'setup-end');
    if (newer) end.title = `The official catalog has ${pkg.id} ${newer.version}${text(newer.ref) ? ` (${newer.ref})` : ''}; the lock holds ${pkg.version}.`;
    row.append(end);
    packages.append(row);
  }
  for (const id of list(status?.unsynced)) {
    const row = el(doc, 'div', null, 'setup-row'); row.dataset.package = id;
    const name = el(doc, 'span', null, 'setup-name'); name.append(iconElement(doc, 'package', { size: 15 }), el(doc, 'span', id, 'setup-name-text'));
    row.append(name, el(doc, 'span', 'declared', 'setup-cell muted'), el(doc, 'span', '', 'setup-cell'), el(doc, 'span', 'not locked · Sync', 'setup-end warn'));
    packages.append(row);
  }
  if (!list(status?.packages).length && !list(status?.unsynced).length) packages.append(el(doc, 'p', 'No packages declared.', 'setup-empty'));
  main.append(members, packages);
  // Teams: the labels the workspace declares, how many souls take each as primary, and the kernel's warnings about them.
  const teams = box(doc, 'Teams', null, 'Shared · Git');
  const unmapped = new Map(list(status?.warnings).filter(w => w?.code === 'unmapped-team-label' && text(w.label)).map(w => [w.label, w]));
  for (const label of list(ws.teams).filter(text)) {
    const row = el(doc, 'div', null, 'setup-team'); row.dataset.team = label;
    const head = el(doc, 'div', null, 'setup-team-head'); head.append(el(doc, 'span', label, 'setup-team-label'));
    const count = list(souls).filter(s => s?.team === label).length;
    head.append(el(doc, 'span', plural(count, 'soul'), 'setup-team-meta'));
    row.append(head);
    // The kernel's own warning about this label, verbatim.
    if (text(unmapped.get(label)?.message)) row.append(el(doc, 'span', unmapped.get(label).message, 'setup-team-warn'));
    teams.append(row);
  }
  if (!list(ws.teams).length) teams.append(el(doc, 'p', 'The workspace declares no teams.', 'setup-empty'));
  teams.append(el(doc, 'p', 'Teams organise and add defaults. They never restrict what a soul can do.', 'setup-team-note'));
  // This computer: what is not shared.
  const local = box(doc, 'This computer', null, 'Not shared', { local: true, icon: 'computer' });
  const rows = el(doc, 'dl', null, 'setup-local-rows');
  const kv = (key, value, cls = '', title = value) => { if (!text(value)) return; const r = el(doc, 'div', null, 'setup-kv'); const dd = el(doc, 'dd', value, cls); dd.title = title; r.append(el(doc, 'dt', key), dd); rows.append(r); };
  const settings = text(ws.local);
  kv('Folder', settings ? settings.replace(/\/[^/]+$/, '') : null);
  kv('Settings', settings ? settings.split('/').pop() : null, '', settings);
  const folder = settings ? settings.replace(/\/[^/]+$/, '') : null;
  const lock = lockText(status); kv('Lock', lock.text, lock.warn ? 'warn' : '');
  if (text(status?.lock?.path)) kv('Lock file', within(status.lock.path, folder), '', `${status.lock.path} · lockfile version ${status.lock.lockfileVersion}`);
  kv('CLI', text(cli?.version) ? `oats ${cli.version}` : null);
  const all = list(instances), running = all.filter(i => i?.running === true).length;
  kv('Instances', all.length ? `${all.length} · ${running} running` : 'none yet');
  const disabled = list(status?.disabledSouls).filter(text);
  if (disabled.length) kv('Disabled souls', disabled.join(', '), 'wrap');
  local.append(rows);
  // Clones: where each member is checked out here (clones[]), or why it is not.
  const clones = list(status?.clones).filter(row => text(row?.key));
  if (clones.length) {
    const names = new Map(list(status?.members).map(m => [m.key, memberName(m)]));
    const list$ = el(doc, 'dl', null, 'setup-local-rows'); list$.setAttribute('aria-label', 'Member clones');
    for (const clone of clones) {
      const r = el(doc, 'div', null, 'setup-kv'); r.dataset.clone = clone.key;
      const where = cloneText(clone, folder), dd = el(doc, 'dd', where.text, where.cls); dd.title = where.title;
      r.append(el(doc, 'dt', names.get(clone.key) || text(clone.name) || tail(clone.key)), dd); list$.append(r);
    }
    local.append(el(doc, 'h4', 'Member clones', 'setup-local-sub'), list$);
  }
  side.append(teams, local);
  cols.append(main, side);
  return cols;
}

/** One clone row: its path (relative to the deployment), the kernel's refusal, or not cloned. */
function cloneText(clone, folder) {
  if (text(clone?.problem?.message)) return { text: clone.problem.message, cls: 'warn wrap', title: clone.problem.code || '' };
  if (text(clone?.path)) return { text: within(clone.path, folder), cls: '', title: `${clone.path}${clone.rule === 'clones' ? ' · set in this computer\'s settings' : clone.rule === 'convention' ? ' · beside the deployment' : ''}` };
  return { text: 'not cloned here', cls: 'muted', title: '' };
}

function graph(doc, { status, instances, selected, onSelect, onOpenRepo, onOpenPackages, openExternal }) {
  const ws = status?.workspace || {};
  const members = list(status?.members), chosen = members.find(m => m.key === selected) || null;
  const wrap = el(doc, 'div', null, `setup-graph-wrap${chosen ? ' with-panel' : ''}`);
  const figure = el(doc, 'figure', null, 'setup-graph'); figure.setAttribute('aria-label', 'How this workspace is set up');
  // This computer: the deployment folder and its instances.
  const here = el(doc, 'div', null, 'setup-here'); here.append(el(doc, 'span', 'This computer', 'setup-caption'));
  const deployment = el(doc, 'div', null, 'setup-card setup-computer');
  const settings = text(ws.local), folder = settings ? settings.replace(/\/[^/]+$/, '') : null;
  deployment.append(el(doc, 'span', 'Deployment', 'setup-card-title'));
  if (folder) { const path = el(doc, 'span', folder, 'setup-card-meta mono'); path.title = folder; deployment.append(path); }
  const all = list(instances);
  deployment.append(el(doc, 'span', [settings ? settings.split('/').pop() : null, plural(all.length, 'instance')].filter(Boolean).join(' · '), 'setup-card-meta'));
  here.append(deployment);
  // The lock between them.
  const lock = lockText(status);
  const link = el(doc, 'div', null, `setup-lock${lock.warn ? ' warn' : ''}`); link.setAttribute('aria-label', `Lock ${lock.text}`);
  const said = el(doc, 'span', lock.warn ? 'lock out of date' : 'lock ', 'setup-lock-text'); if (!lock.warn) said.append(iconElement(doc, 'check', { size: 11 }));
  link.append(said, el(doc, 'span', null, 'setup-edge'));
  if (text(ws.commit)) link.append(el(doc, 'span', short(ws.commit)));
  // Shared in git: the workspace, its members and packages.
  const shared = el(doc, 'div', null, 'setup-shared'); shared.append(el(doc, 'span', 'Shared · Git', 'setup-caption'));
  const body = el(doc, 'div', null, 'setup-shared-body');
  const card = el(doc, 'div', null, 'setup-card setup-ws');
  card.append(el(doc, 'span', `Workspace ${text(ws.name) || ''}`.trim(), 'setup-card-title'));
  const host = members.find(m => m.key === ws.key);
  if (text(ws.key)) { const h = el(doc, 'span', host ? memberName(host) : tail(ws.url || ws.key), 'setup-card-meta mono'); h.title = ws.key; card.append(h); }
  card.append(el(doc, 'span', [plural(list(ws.teams).length, 'team'), plural(list(status?.packages).length, 'package')].join(' · '), 'setup-card-meta'));
  const tree = el(doc, 'ul', null, 'setup-tree'); tree.setAttribute('aria-label', 'What the workspace is built from');
  const label = value => tree.append(el(doc, 'li', value, 'setup-tree-label'));
  const leaf = (node, bad = false) => { const li = el(doc, 'li', null, bad ? 'bad' : ''); li.append(node); tree.append(li); };
  const item = (icon, name, meta, { bad = false, run = null, aria = null, pressed = null } = {}) => {
    const node = el(doc, run ? 'button' : 'div', null, `setup-node${bad ? ' bad' : ''}`);
    if (run) { node.type = 'button'; node.addEventListener('click', run); if (aria) node.setAttribute('aria-label', aria); }
    if (pressed !== null) { node.setAttribute('aria-pressed', String(pressed)); node.classList.toggle('selected', pressed); }
    const label = el(doc, 'span', name, 'setup-node-name'); label.title = name;
    node.append(iconElement(doc, icon, { size: 14 }), label, el(doc, 'span', meta, 'setup-node-meta'));
    return node;
  };
  if (members.length) label('Members · latest');
  for (const member of members) {
    const state = memberState(member), souls = list(member.souls).length;
    const meta = state.ok ? [member.key === ws.key ? 'host' : null, plural(souls, 'soul')].filter(Boolean).join(' · ') : state.label;
    const node = item('repo', memberName(member), meta, { bad: !state.ok, pressed: member.key === selected,
      run: () => onSelect(member.key === selected ? null : member.key), aria: `${memberName(member)}: ${meta} — show its membership` });
    node.dataset.member = member.key; leaf(node, !state.ok);
  }
  const packages = list(status?.packages);
  if (packages.length || list(status?.unsynced).length) label('Packages · pinned');
  for (const pkg of packages) {
    const origin = String(pkg.source || '').startsWith('catalog:') ? 'official' : 'git tag';
    const newer = available(pkg);
    const node = item('package', [pkg.id, pkg.version].filter(text).join(' '), newer ? `${newer.version} available` : origin, // latest is only reported for catalog packages
      onOpenPackages ? { run: () => onOpenPackages(), aria: `${pkg.id}: show package capabilities` } : {});
    node.dataset.package = pkg.id; leaf(node);
  }
  for (const id of list(status?.unsynced)) { const node = item('package', id, 'not locked', { bad: true }); node.dataset.package = id; leaf(node, true); }
  if (list(status?.external).length) label('External souls');
  for (const row of list(status?.external)) leaf(item('repo', text(row.soul) || 'soul', tail(String(row.source || '').replace(/@[^@/]*$/, ''))));
  if (!tree.children.length) tree.append(el(doc, 'li', 'No members or packages reported yet.', 'setup-tree-label'));
  body.append(card, el(doc, 'span', null, 'setup-stub'), tree);
  shared.append(body);
  figure.append(here, link, shared);
  const frame = el(doc, 'div', null, 'setup-graph-box'); frame.append(figure); wrap.append(frame);
  if (chosen) wrap.append(memberPanel(doc, chosen, { status, onClose: () => onSelect(null), onOpenRepo, openExternal }));
  return wrap;
}

/** The Member panel: the two sides of the handshake, what it means now, and the kernel's own detail. */
function memberPanel(doc, member, { status, onClose, onOpenRepo, openExternal }) {
  const ws = status?.workspace || {};
  const state = memberState(member), name = memberName(member);
  const panel = el(doc, 'aside', null, 'setup-panel'); panel.setAttribute('aria-label', `Member ${name}`); panel.dataset.member = member.key;
  const head = el(doc, 'div', null, 'setup-panel-head'); head.append(el(doc, 'h3', 'Member'));
  const close = el(doc, 'button', null, 'act icon-act'); close.type = 'button'; close.setAttribute('aria-label', 'Close member details');
  close.append(iconElement(doc, 'close', { size: 15 })); close.addEventListener('click', onClose); head.append(close);
  const body = el(doc, 'div', null, 'setup-panel-body');
  const id = el(doc, 'div', null, 'setup-panel-id'); id.append(el(doc, 'span', name, 'setup-panel-name'), stateChip(doc, member));
  body.append(id);
  // Handshake: the workspace lists it; the repo points back. Unknown sides stay unknown.
  const listed = member.status === 'not-listed' ? false : member.status === 'cannot-read' ? null : true;
  const back = member.status === 'confirmed' ? true : ['no-backlink', 'backlink-elsewhere'].includes(member.status) ? false : null;
  const hand = el(doc, 'section'); hand.append(el(doc, 'h4', 'Handshake'));
  const rows = el(doc, 'div', null, 'setup-hand');
  const side = (ok, title, sub) => {
    const row = el(doc, 'div', null, 'setup-hand-row');
    const mark = el(doc, 'span', ok === false ? '○' : ok === null ? '?' : null, `setup-hand-mark${ok === false ? ' warn' : ok === null ? ' unknown' : ''}`);
    mark.dataset.side = ok === true ? 'yes' : ok === false ? 'no' : 'unknown';
    if (ok === true) mark.append(iconElement(doc, 'check', { size: 13 }));
    row.append(mark);
    const copy = el(doc, 'span', null, 'setup-hand-copy'); copy.append(el(doc, 'span', title, 'setup-hand-title'));
    if (sub) { const said = el(doc, 'span', null, 'setup-hand-sub'); said.append(...[sub].flat()); copy.append(said); }
    row.append(copy); rows.append(row);
  };
  const hostName = tail(ws.url || ws.key);
  // The files, by the names the kernel reports (workspace.file, membershipFile); generic words otherwise.
  const wsFile = fileRef(ws.file), memberFile = fileRef(member.membershipFile);
  const named = (file, words) => file ? fileName(doc, file, openExternal) : words;
  side(listed, 'The workspace lists it', text(ws.key) ? [`in ${hostName}'s `, named(wsFile, 'workspace file')] : null);
  side(back, 'The repo points back', back === true ? ["The repo's ", named(memberFile, 'membership file'), ' names this workspace'] : member.status === 'backlink-elsewhere' ? 'It names a different workspace' : back === false ? ['No ', named(memberFile, 'membership file'), ' in the repo names this workspace'] : "Can't tell without read access");
  hand.append(rows); body.append(hand);
  // Where it is checked out on this computer (clones[]), when the kernel reports it.
  const clone = list(status?.clones).find(row => row?.key === member.key);
  if (clone) {
    const folder = text(ws.local) ? ws.local.replace(/\/[^/]+$/, '') : null, where = cloneText(clone, folder);
    const here = el(doc, 'section'); here.dataset.clone = member.key; here.append(el(doc, 'h4', 'On this computer'));
    const p = el(doc, 'p', where.text, clone.problem ? 'warn' : text(clone.path) ? 'mono' : 'muted'); p.title = where.title; here.append(p);
    body.append(here);
  }
  // What this means now.
  const means = el(doc, 'section'); means.append(el(doc, 'h4', 'What this means'));
  const souls = list(member.souls).filter(text);
  const p = el(doc, 'p');
  if (state.ok) {
    const caps = list(member.capabilities).length;
    p.append(`It contributes ${[plural(souls.length, 'soul'), plural(caps, 'capability', 'capabilities')].join(' and ')} at its latest commit.`);
  } else {
    p.append('Until both sides agree, this repo contributes nothing.');
    if (souls.length) {
      p.append(` Its soul${souls.length === 1 ? '' : 's'} `);
      souls.forEach((soul, i) => { if (i) p.append(i === souls.length - 1 ? ' and ' : ', '); p.append(el(doc, 'span', soul, 'mono')); });
      p.append(` ${souls.length === 1 ? 'is' : 'are'} hidden from Souls and can't be spawned.`);
    }
  }
  means.append(p); body.append(means);
  // The kernel's own words about it (for example which file is missing).
  if (text(member.detail)) {
    const fix = el(doc, 'section'); fix.append(el(doc, 'h4', state.ok ? 'Detail' : 'Fix'), el(doc, 'div', member.detail, 'setup-detail'));
    body.append(fix);
  }
  const acts = el(doc, 'div', null, 'setup-panel-acts');
  if (state.ok && list(member.capabilities).length && onOpenRepo) {
    const open = el(doc, 'button', 'Show its capabilities', 'act'); open.type = 'button'; open.addEventListener('click', () => onOpenRepo(member.key));
    acts.append(open);
  }
  // The repository on the web (members[].url), when it has a web address.
  if (webUrl(member.url) && openExternal) {
    const web = el(doc, 'button', 'Open repository', 'act'); web.type = 'button'; web.title = member.url;
    web.dataset.verb = 'repo'; web.addEventListener('click', () => openExternal(member.url)); acts.append(web);
  }
  if (acts.children.length) body.append(acts);
  body.append(el(doc, 'p', 'Membership is the trust: whoever can push to a member decides its souls and capabilities.', 'muted'));
  panel.append(head, body);
  return panel;
}
