/** Schedules and Triggers pages (§2.3a, human 2026-09-26: one tab each, one layout).
 * Rows are grouped by where they run — this computer, needs attention here, elsewhere —
 * because the first question is what THIS computer does. Workspace (Git) and local
 * items sit together, each marked with its origin. A row opens its detail page.
 *
 * IO is injected (`read`, `act`, `openFile`): the page renders `automationRows(json)`
 * and never re-derives placement. It is mounted only once the Desktop server serves
 * the kernel's `automations` lists (feature `automations`, automationsApi 1). */
import {
  automationRows, groupRows, filterRows, placementText, ownerParts, taskParts, cronInWords, onSummary, relativeTime,
  hostLogin, templateLabel, soulOriginText, testResult, triggerStatus,
} from '../automation-rows.mjs';
import { pageCardCSS, pageBar, pageCard, pageFacts, pageSection } from '../capability-page.mjs';
import { iconElement } from '../shell-icons.mjs';
import { harnessName } from '../identity-marks.mjs';
import { postJson, ensureTheme, wsQuery, currentWorkspace, onWorkspaceChange } from './common.mjs';
import { cliStatus, cliCard, cliKnownUnavailable, onCliChange } from './cli-status.mjs';

export const automationsCSS = `
.automations { display:flex; flex-direction:column; height:100%; min-height:0; min-width:0; background:var(--bg); color:var(--fg); container-type:inline-size; }
.automations[hidden], .automations [hidden] { display:none !important; }
.auto-header { flex:none; display:flex; align-items:center; gap:12px; height:48px; padding:0 16px; box-sizing:border-box; border-bottom:1px solid var(--border); background:var(--surface); }
.auto-header h2 { display:flex; align-items:baseline; gap:8px; margin:0; font-size:14px; font-weight:700; }
.auto-count { color:var(--muted); font:10.5px var(--mono,monospace); font-weight:400; }
.auto-spacer { flex:1; }
.auto-scheduler { display:inline-flex; align-items:center; gap:7px; color:var(--muted); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
.auto-dot { width:7px; height:7px; flex:none; border-radius:50%; background:var(--faint); }
.auto-dot.ok { background:var(--ok); }
.auto-dot.warn { background:var(--warn); }
.oats-view .auto-header button.auto-icon { display:inline-grid; place-items:center; width:30px; height:30px; min-height:30px; padding:0; border:1px solid var(--border); border-radius:7px; background:var(--surface); color:var(--fg); flex:none; }
.oats-view .auto-header button.act:not(.auto-icon) { height:30px; min-height:30px; padding:0 12px; border-radius:7px; font-size:12.5px; font-weight:600; }
.oats-view .auto-header button.act.primary:not(:disabled) { background:var(--primary-bg); color:var(--primary-fg); border-color:var(--primary-bg); }
.oats-view .auto-banner button.act { margin-left:auto; height:28px; min-height:28px; padding:0 10px; border-radius:6px; font-size:12px; font-weight:600; flex:none; }
.auto-body { flex:1; min-height:0; overflow:auto; padding:16px 20px 24px; }
.auto-banner { display:flex; align-items:center; gap:10px; margin:0 0 14px; padding:10px 12px; border:1px solid var(--attn-border); border-radius:8px; background:var(--attn-bg); color:var(--fg); font-size:12.5px; }
.auto-banner .shell-icon { flex:none; color:var(--warn); }
.auto-toolbar { display:flex; align-items:center; flex-wrap:wrap; justify-content:space-between; gap:8px 10px; margin:0 0 14px; min-width:0; }
.auto-seg { display:inline-flex; height:28px; border:1px solid var(--border); border-radius:7px; overflow:hidden; background:var(--surface); }
.oats-view .auto-seg button { display:inline-flex; align-items:center; gap:6px; height:100%; min-height:0; padding:0 10px; border:0; border-radius:0; background:transparent; color:var(--muted); font:12px var(--sans,system-ui); }
.oats-view .auto-seg button + button { border-left:1px solid var(--border); }
.oats-view .auto-seg button[aria-pressed=true] { background:var(--surface-2); color:var(--fg); font-weight:650; }
.auto-seg-count { font:10.5px var(--mono,monospace); }
.auto-search { display:flex; align-items:center; gap:7px; flex:0 1 240px; min-width:0; height:28px; padding:0 10px; box-sizing:border-box; border:1px solid var(--border); border-radius:7px; background:var(--surface); color:var(--muted); }
.auto-search .shell-icon { flex:none; }
.oats-view .auto-search input { flex:1; min-width:0; height:100%; min-height:0; padding:0; border:0; background:transparent; color:var(--fg); font-size:12px; outline:none; }
.auto-search:focus-within { outline:2px solid var(--accent); outline-offset:1px; }
.auto-group { display:flex; flex-direction:column; gap:8px; margin:0 0 20px; }
.auto-group-title { display:flex; align-items:baseline; gap:8px; margin:0; padding:0 2px; font-size:12.5px; font-weight:650; color:var(--fg); }
.auto-group-title.warn { color:var(--warn); }
.auto-group-note { color:var(--muted); font-weight:500; }
.auto-table { background:var(--surface); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
.auto-row { display:grid; grid-template-columns:40px minmax(170px,1.4fr) minmax(120px,1fr) minmax(150px,1.2fr) minmax(130px,1fr) minmax(110px,.9fr) 34px; gap:12px; align-items:center; min-height:54px; padding:6px 12px; box-sizing:border-box; border-top:1px solid var(--tag-bg); font-size:12px; }
.auto-row.head { min-height:32px; border-top:0; border-bottom:1px solid var(--border); color:var(--muted); font-size:11px; font-weight:650; letter-spacing:.05em; text-transform:uppercase; }
.auto-row.head + .auto-row { border-top:0; }
.auto-cell { display:flex; flex-direction:column; gap:2px; min-width:0; }
.auto-main-line { display:flex; align-items:center; gap:6px; min-width:0; color:var(--fg); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.auto-main-line > span { min-width:0; overflow:hidden; text-overflow:ellipsis; }
/* A text-only line: the event or cron words wrap rather than clip; a one-line fact ellipsizes (title keeps it whole). */
.auto-main-line.auto-wrap { display:block; white-space:normal; overflow-wrap:anywhere; }
.auto-main-line.auto-text { display:block; }
.auto-sub { color:var(--muted); font-size:11.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.auto-mono { font-family:var(--mono,monospace); }
.oats-view .auto-row button.auto-open { display:flex; flex-direction:column; align-items:flex-start; gap:3px; min-width:0; min-height:0; padding:2px 0; border:0; background:transparent; color:var(--fg); text-align:left; font:inherit; cursor:pointer; }
.auto-open .auto-id { max-width:100%; font:650 12.5px var(--mono,monospace); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.oats-view .auto-row button.auto-open:hover .auto-id { text-decoration:underline; }
.auto-tags { display:flex; flex-wrap:wrap; gap:4px; min-width:0; }
.auto-tag { display:inline-flex; align-items:center; gap:4px; height:18px; padding:0 6px; border-radius:4px; background:var(--tag-bg); color:var(--fg); font-size:10.5px; font-weight:600; white-space:nowrap; }
.auto-tag .shell-icon { color:var(--muted); }
.auto-tag.muted { background:transparent; border:1px solid var(--border); color:var(--muted); font-weight:500; }
.auto-tag.warn { background:var(--attn-bg); color:var(--fg); }
.auto-row.off .auto-id, .auto-row.off .auto-main-line { color:var(--muted); }
.auto-place { display:flex; align-items:center; gap:6px; min-width:0; }
.auto-place.warn { color:var(--warn); font-weight:600; }
.oats-view button.auto-switch { position:relative; width:30px; height:18px; min-height:18px; padding:0; border:1px solid var(--border); border-radius:999px; background:var(--surface-2); flex:none; }
.oats-view button.auto-switch::after { content:""; position:absolute; top:2px; left:2px; width:12px; height:12px; border-radius:50%; background:var(--muted); }
.oats-view button.auto-switch[aria-checked=true] { border-color:var(--primary-bg); background:var(--primary-bg); }
.oats-view button.auto-switch[aria-checked=true]::after { left:14px; background:var(--primary-fg); }
.oats-view button.auto-switch:focus-visible, .auto-menu summary:focus-visible, .oats-view .auto-row button.auto-open:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.auto-menu { position:relative; justify-self:end; }
.auto-menu summary { display:grid; place-items:center; width:28px; height:28px; border-radius:6px; color:var(--muted); cursor:pointer; list-style:none; }
.auto-menu summary::-webkit-details-marker { display:none; }
.auto-menu summary:hover { background:var(--surface-2); color:var(--fg); }
.auto-menu-list { position:absolute; right:0; top:32px; z-index:5; display:flex; flex-direction:column; min-width:170px; padding:4px; border:1px solid var(--border); border-radius:8px; background:var(--surface); box-shadow:var(--shadow-popover); }
.oats-view .auto-menu-list button { justify-content:flex-start; height:30px; min-height:30px; padding:0 10px; border:0; border-radius:5px; background:transparent; color:var(--fg); font-size:12.5px; text-align:left; }
.oats-view .auto-menu-list button:hover:not(:disabled) { background:var(--surface-2); }
.auto-none { color:var(--muted); }
.auto-foot { margin:6px 2px 0; color:var(--muted); font-size:12px; }
.auto-empty { margin:40px auto; max-width:460px; text-align:center; color:var(--muted); font-size:13px; line-height:1.5; }
.auto-empty strong { display:block; margin-bottom:6px; color:var(--fg); font-size:14px; }
.auto-status { margin:0 0 12px; color:var(--muted); font-size:12px; }
.auto-status.error { color:var(--danger); }
@container (max-width: 900px) {
  .auto-row { grid-template-columns:40px minmax(0,1fr) 34px; grid-auto-rows:auto; row-gap:4px; }
  .auto-row.head { display:none; }
  .auto-row > .auto-cell:not(.auto-name) { grid-column:2; }
  .auto-row > .auto-menu { grid-column:3; grid-row:1; }
}
.auto-page { flex:1; min-height:0; overflow:auto; }
.auto-page .page-title.mono { font-size:18px; }
.auto-cards { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
@container (max-width: 700px) { .auto-cards { grid-template-columns:minmax(0,1fr); } }
.auto-page .page-identity > .auto-switch { margin-left:auto; }
/* Detail facts wrap instead of cropping (the list rows keep one line, with a title). */
.auto-page .page-kv { align-items:start; padding:7px 0; min-height:0; }
.auto-page .page-kv dd { white-space:normal; overflow-wrap:anywhere; }
.auto-prompt { margin:0; padding:12px 14px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--fg); font:12.5px/1.6 var(--mono,monospace); white-space:pre-wrap; overflow-wrap:anywhere; }
.auto-token { padding:1px 4px; border-radius:4px; background:var(--chip-bg); color:var(--fg); font-weight:650; }
.auto-verdict { display:flex; align-items:center; gap:7px; margin-top:4px; font-size:12.5px; font-weight:600; }
.auto-verdict.warn { color:var(--warn); }
.auto-runs { display:flex; flex-direction:column; }
.auto-run { display:grid; grid-template-columns:120px minmax(0,1fr); gap:10px; align-items:baseline; padding:7px 0; border-top:1px solid var(--tag-bg); font-size:12px; }
.auto-run:first-child { border-top:0; }
.auto-run time { color:var(--muted); font-size:11.5px; }
.auto-test-line { margin:0; font-size:12px; overflow-wrap:anywhere; }
.auto-test-line.warn { color:var(--warn); }
`;

const HEADS = ['On', 'Automation', 'Soul', 'When', 'Runs on', 'Last · next', ''];
const TITLES = { schedule: 'Schedules', trigger: 'Triggers' };
const OUTCOMES = { launched: 'agent launched', active: 'agent active', running: 'agent active', ended: 'run ended', stopped: 'agent stopped', unknown: 'launch state unknown', 'launch-failed': 'launch failed', skipped: 'skipped', delivered: 'wake delivered' };

/** read(): the list JSON · act(verb, row): enable|disable|test|run → kernel JSON · status(row): a trigger's
 * `oats trigger status` JSON (fire history, live instances) · openFile(row): open its defining file. */
/** verbs: the act verbs this server serves (default all) · headerActions(doc): extra header controls ·
 * rowActions(row): extra { label, run, enabled } for a row's menu and page · onEnableScheduler: the banner's action. */
export function createAutomationsView(host, { kind, read, act = null, status = null, openFile = null, now = () => Date.now(),
  verbs = null, headerActions = null, rowActions = null, onEnableScheduler = null, onResult = null } = {}) {
  const doc = host.ownerDocument;
  const node = (tag, value, cls) => { const el = doc.createElement(tag); if (value !== undefined && value !== null) el.textContent = value; if (cls) el.className = cls; return el; };
  const title = TITLES[kind], noun = kind === 'trigger' ? 'trigger' : 'schedule';
  const root = node('section', undefined, 'oats-view automations'); root.dataset.kind = kind;
  const style = node('style'); style.textContent = pageCardCSS + automationsCSS;
  const header = node('header', undefined, 'auto-header'), h2 = node('h2'), count = node('span', '', 'auto-count');
  h2.append(node('span', title), count);
  const scheduler = node('span', '', 'auto-scheduler'); scheduler.hidden = true;
  const refreshButton = node('button', undefined, 'act auto-icon'); refreshButton.type = 'button';
  refreshButton.append(iconElement(doc, 'refresh', { size: 14 })); refreshButton.setAttribute('aria-label', `Refresh ${title.toLowerCase()}`); refreshButton.title = 'Refresh';
  header.append(h2, node('span', undefined, 'auto-spacer'), scheduler, ...(headerActions ? headerActions(doc) : []), refreshButton);
  const body = node('div', undefined, 'auto-body'), page = node('div', undefined, 'auto-page'); page.hidden = true;
  root.append(style, header, body, page); host.append(root);

  let alive = true, serial = 0, data = null, failure = '', loading = false, origin = 'all', query = '', openId = null, busy = false, notice = '';
  const tests = new Map(), statuses = new Map();
  // An item's defining file opens read-only from this machine (a local item, a cloned member),
  // else as its web page; the kernel reports both, the Desktop never builds a path.
  const canOpen = row => !!openFile && !!(row.origin.localPath || row.origin.url);
  const openTitle = row => row.origin.localPath || row.origin.url
    || 'This computer has no clone of this member, and the kernel reports no web address for the file';
  const supports = verb => !!act && (!verbs || verbs.includes(verb));
  const rowById = id => data?.rows.find(r => r.id === id) || null;

  // ── toolbar (persistent: the search keeps focus across renders) ──
  const toolbar = node('div', undefined, 'auto-toolbar');
  const seg = node('div', undefined, 'auto-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', `Show ${title.toLowerCase()} from`);
  const segButtons = new Map();
  for (const [id, label] of [['all', 'All'], ['workspace', 'Workspace'], ['local', 'Local']]) {
    const b = node('button'); b.type = 'button'; b.dataset.origin = id; b.append(node('span', label), node('span', '', 'auto-seg-count'));
    b.addEventListener('click', () => { origin = id; render(); }); segButtons.set(id, b); seg.append(b);
  }
  const search = node('label', undefined, 'auto-search'), input = node('input');
  input.type = 'search'; input.placeholder = `Search ${title.toLowerCase()}`; input.autocomplete = 'off'; input.setAttribute('aria-label', `Search ${title.toLowerCase()}`);
  input.addEventListener('input', () => { query = input.value; render(); });
  search.append(iconElement(doc, 'search', { size: 14 }), input); toolbar.append(seg, search);
  // The body's parts persist; each render replaces only the notices and the list,
  // so the search keeps its focus and caret while it narrows the rows.
  const notices = node('div'), listHost = node('div');
  body.append(notices, toolbar, listHost);

  async function refresh() {
    const id = ++serial; loading = true; failure = ''; render();
    try {
      const next = automationRows(await read(), kind);
      if (!alive || id !== serial) return;
      if (!next) throw new Error(`This OATS did not answer a ${noun} list.`);
      data = next;
    } catch (error) { if (alive && id === serial) failure = error?.message || String(error); }
    finally { if (alive && id === serial) { loading = false; render(); } }
  }
  async function perform(verb, row) {
    if (!act || busy) return;
    busy = true; render();
    try {
      const result = await act(verb, row);
      if (!alive) return;
      if (verb === 'test') tests.set(row.id, testResult(result, kind) || { ok: false, error: `This OATS did not answer a ${noun} test.` });
      else { onResult?.(verb, row, result); await refresh(); }
    } catch (error) { if (alive) { if (verb === 'test') tests.set(row.id, { ok: false, error: error?.message || String(error) }); else failure = error?.message || String(error); } }
    finally { if (alive) { busy = false; render(); } }
  }

  // ── pieces ──
  function switchFor(row) {
    if (row.group === 'elsewhere') return node('span');
    const b = node('button', undefined, 'auto-switch'); b.type = 'button'; b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(row.enabledHere)); b.setAttribute('aria-label', `${row.id} enabled on this computer`);
    b.title = row.enabledHere ? 'On here: click to turn it off on this computer' : 'Off here: click to turn it on';
    b.disabled = busy || !supports(row.enabledHere ? 'disable' : 'enable');
    b.addEventListener('click', () => perform(row.enabledHere ? 'disable' : 'enable', row));
    return b;
  }
  function originTag(row) {
    const tag = node('span', undefined, 'auto-tag');
    tag.append(iconElement(doc, row.origin.kind === 'local' ? 'computer' : 'repo', { size: 11 }), node('span', row.origin.kind === 'local' ? 'local' : row.origin.member || 'workspace'));
    tag.title = row.origin.kind === 'local' ? 'Local to this computer' : [row.origin.repoKey, row.origin.path].filter(Boolean).join(' · ');
    return tag;
  }
  function stateTags(row, tags) {
    if (!row.enabledHere && row.group !== 'elsewhere') tags.append(node('span', 'Off here', 'auto-tag muted'));
    const bad = row.invalid || row.unreadable;
    if (bad) { const t = node('span', 'Invalid', 'auto-tag warn'); t.title = bad.message || bad.code || ''; tags.append(t); }
    const template = templateLabel(row.template);
    if (template) { const t = node('span', undefined, 'auto-tag muted'); t.append(iconElement(doc, 'package', { size: 11 }), node('span', template)); t.title = `From the package template ${template}${row.template.version ? ` ${row.template.version}` : ''}`; tags.append(t); }
  }
  function soulLine(row) {
    const line = node('span', undefined, 'auto-main-line');
    if (!row.soul) { line.append(node('span', row.run && row.run !== 'spawn' ? `${row.run}` : 'Not reported', 'auto-none')); return line; }
    const o = row.soul.origin, icon = o?.kind === 'package' ? 'package' : o?.kind === 'external' ? 'external' : o?.kind === 'ambiguous' || !o ? 'warning' : 'repo';
    line.append(iconElement(doc, icon, { size: 12 }), node('span', row.soul.name, 'auto-mono'));
    line.title = `${row.soul.name} · ${soulOriginText(o).long}`;
    return line;
  }
  const soulSub = row => row.soul ? soulOriginText(row.soul.origin).short : '';
  function whenCell(row) {
    const cell = node('div', undefined, 'auto-cell');
    if (row.kind === 'schedule') {
      const main = node('span', cronInWords(row.cron) || row.cron || 'Not reported', 'auto-main-line auto-wrap'); main.title = [row.cron, row.tz].filter(Boolean).join(' · ');
      cell.append(main);
      // The cron itself goes under its words; with no words, the main line is already the cron.
      cell.append(node('span', [cronInWords(row.cron) ? row.cron : null, row.tz].filter(Boolean).join(' · '), 'auto-sub auto-mono'));
    } else {
      const on = onSummary(row.on);
      const main = node('span', on?.title || 'Not reported', 'auto-main-line auto-wrap'); main.title = main.textContent;
      cell.append(main);
      if (on) cell.append(node('span', [on.repo, ...on.labels.map(l => `#${l}`)].filter(Boolean).join(' · '), 'auto-sub'));
    }
    return cell;
  }
  function runsOnCell(row) {
    const cell = node('div', undefined, 'auto-cell'), p = placementText(row, data.host);
    const place = node('span', undefined, `auto-place${p.tone === 'warn' ? ' warn' : ''}`);
    place.append(node('span', '', `auto-dot ${p.tone}`), node('span', p.label)); place.title = p.detail || '';
    const owner = ownerParts(row.owner);
    cell.append(place, node('span', row.origin.kind === 'local' ? 'local' : owner ? `as @${owner.login}` : row.owner || '', 'auto-sub'));
    return cell;
  }
  function lastNextCell(row) {
    const cell = node('div', undefined, 'auto-cell');
    if (!row.runsHere && row.group !== 'here') { cell.append(node('span', '—', 'auto-none')); return cell; }
    const next = relativeTime(row.nextDue, now()), last = relativeTime(row.lastRun?.at || row.lastRun?.startedAt || row.lastRun?.scheduledFor, now());
    // A trigger that runs here but has not polled yet polls at the next tick (nextDue null).
    const n = node('span', next ? `Next ${next.label}` : !row.enabledHere ? 'Off here' : row.runsHere && kind === 'trigger' ? 'Polls at the next tick' : 'Next not reported', 'auto-main-line auto-text'); n.title = next ? next.title : n.textContent;
    const l = node('span', last ? `Last ${last.label}${row.lastRun?.outcome ? ` · ${OUTCOMES[row.lastRun.outcome] || row.lastRun.outcome}` : row.lastRun?.number ? ` · #${row.lastRun.number}` : ''}` : 'Not run yet', 'auto-sub'); if (last) l.title = last.title;
    cell.append(n, l); return cell;
  }
  function menuFor(row) {
    const menu = node('details', undefined, 'auto-menu'), summary = node('summary');
    summary.append(iconElement(doc, 'more', { size: 15 })); summary.setAttribute('aria-label', `Actions for ${row.id}`);
    const items = node('div', undefined, 'auto-menu-list');
    const item = (label, verb, enabled = true) => { const b = node('button', label); b.type = 'button'; b.dataset.verb = verb; b.disabled = busy || !enabled; b.addEventListener('click', () => { menu.open = false; if (verb === 'open') openRow(row.id); else if (verb === 'file') openFile?.(row); else void perform(verb, row); }); items.append(b); };
    item('Open', 'open');
    if (supports('test')) item('Test', 'test');
    if (row.kind === 'schedule' && row.runsHere && supports('run')) item('Run now', 'run');
    if (row.group !== 'elsewhere' && supports(row.enabledHere ? 'disable' : 'enable')) item(row.enabledHere ? 'Turn off here' : 'Turn on here', row.enabledHere ? 'disable' : 'enable');
    if (canOpen(row)) item('Open file', 'file');
    for (const extra of rowActions ? rowActions(row) : []) {
      const b = node('button', extra.label); b.type = 'button'; b.dataset.verb = extra.verb || ''; b.disabled = busy || extra.enabled === false;
      b.addEventListener('click', () => { menu.open = false; extra.run(); }); items.append(b);
    }
    menu.append(summary, items); return menu;
  }
  function rowEl(row) {
    const el = node('div', undefined, `auto-row${!row.enabledHere && row.group !== 'elsewhere' ? ' off' : ''}`); el.setAttribute('role', 'row'); el.dataset.id = row.id; el.dataset.group = row.group;
    const nameCell = node('div', undefined, 'auto-cell auto-name'), open = node('button', undefined, 'auto-open'); open.type = 'button';
    const id = node('span', row.id, 'auto-id'); id.title = row.id; const tags = node('span', undefined, 'auto-tags'); tags.append(originTag(row)); stateTags(row, tags);
    open.append(id, tags); open.setAttribute('aria-label', `Open ${row.id}`); open.addEventListener('click', () => openRow(row.id));
    nameCell.append(open); if (row.description) nameCell.append(node('span', row.description, 'auto-sub'));
    const soul = node('div', undefined, 'auto-cell'); soul.append(soulLine(row), node('span', soulSub(row), 'auto-sub'));
    const cells = [switchFor(row), nameCell, soul, whenCell(row), runsOnCell(row), lastNextCell(row), menuFor(row)];
    for (const [i, cell] of cells.entries()) { if (i && i < 6) cell.setAttribute('role', 'cell'); el.append(cell); }
    return el;
  }

  // ── list ──
  function renderList() {
    notices.replaceChildren(); listHost.replaceChildren();
    const rows = data?.rows || [];
    toolbar.hidden = !data;
    setText(count, data ? String(rows.length) : '');
    renderScheduler();
    if (failure) notices.append(node('p', failure, 'auto-status error'));
    if (notice) { const n = node('p', notice, 'auto-status auto-notice'); n.setAttribute('role', 'status'); notices.append(n); }
    if (!data) { if (loading) notices.append(node('p', `Reading ${title.toLowerCase()}…`, 'auto-status')); return; }
    if (!data.host.name && rows.some(r => r.reason === 'host-unnamed')) banner(`This computer has no host name, so it runs none of the workspace's ${title.toLowerCase()}. Name it in this deployment's local settings to take on the ones assigned to it.`);
    if (data.scheduler && !schedulerOn(data.scheduler) && rows.some(r => r.runsHere)) banner('The scheduler is not running on this computer, so nothing here runs until it is enabled.', onEnableScheduler && ['Enable scheduler', onEnableScheduler]);
    for (const [id, b] of segButtons) { b.setAttribute('aria-pressed', String(id === origin)); setText(b.querySelector('.auto-seg-count'), String(id === 'all' ? rows.length : rows.filter(r => r.origin.kind === id).length)); }
    if (!rows.length) {
      const empty = node('div', undefined, 'auto-empty'); empty.append(node('strong', `No ${title.toLowerCase()} yet`));
      empty.append(node('span', `Commit one to a member repository's ${noun}s folder to share it with the workspace, or add a local one on this computer.`));
      listHost.append(empty);
    } else {
      const shown = filterRows(rows, { origin, query });
      if (!shown.length) listHost.append(node('p', `No ${title.toLowerCase()} match.`, 'auto-status'));
      for (const group of groupRows(shown)) {
        const section = node('section', undefined, 'auto-group'); section.dataset.group = group.id;
        const head = node('h3', undefined, `auto-group-title${group.id === 'attention' ? ' warn' : ''}`); head.id = `auto-${kind}-${group.id}`;
        head.append(node('span', group.title), node('span', String(group.rows.length), 'auto-group-note'));
        const table = node('div', undefined, 'auto-table'); table.setAttribute('role', 'table'); table.setAttribute('aria-labelledby', head.id);
        const hr = node('div', undefined, 'auto-row head'); hr.setAttribute('role', 'row');
        for (const label of HEADS) { const c = node('span', label); if (label) c.setAttribute('role', 'columnheader'); hr.append(c); }
        table.append(hr, ...group.rows.map(rowEl)); section.append(head, table); listHost.append(section);
      }
    }
    const foot = node('p', undefined, 'auto-foot');
    const snap = data.snapshot ? relativeTime(data.snapshot.takenAt, now()) : null;
    foot.textContent = [data.snapshot ? `Workspace ${title.toLowerCase()} as of the last sync${snap ? ` (${snap.label})` : ''}` : 'Workspace items appear after the next sync',
      data.snapshot?.problems ? `${data.snapshot.problems} discovery ${data.snapshot.problems === 1 ? 'problem' : 'problems'}` : null,
      'Only members you can read in Git contribute.'].filter(Boolean).join(' · ');
    listHost.append(foot);
  }
  function banner(message, action = null) {
    const b = node('div', undefined, 'auto-banner'); b.setAttribute('role', 'note'); b.append(iconElement(doc, 'warning', { size: 15 }), node('span', message));
    if (action) { const a = node('button', action[0], 'act'); a.type = 'button'; a.disabled = busy; a.addEventListener('click', async () => { busy = true; render(); try { await action[1](); } catch (e) { failure = e?.message || String(e); } finally { busy = false; await refresh(); } }); b.append(a); }
    notices.append(b);
  }
  const schedulerOn = s => s.installed === true && s.active === true && s.registered !== false;
  function renderScheduler() {
    const s = data?.scheduler; scheduler.hidden = !s; if (!s) return;
    const checked = relativeTime(s.lastTick, now());
    scheduler.replaceChildren(node('span', '', `auto-dot ${schedulerOn(s) ? 'ok' : 'warn'}`),
      node('span', schedulerOn(s) ? ['Scheduler on', checked ? `checked ${checked.label}` : null, Number.isInteger(s.maxConcurrent) ? `up to ${s.maxConcurrent} at once` : null].filter(Boolean).join(' · ') : 'Scheduler off'));
  }

  // ── detail page ──
  function openRow(id) { openId = id; render(); page.querySelector('.page-back')?.focus(); void loadStatus(id); }
  /** A trigger's fire history, read once per open; a stale answer never lands on another page. */
  async function loadStatus(id) {
    const row = rowById(id);
    if (kind !== 'trigger' || !status || !row) return;
    try {
      const st = triggerStatus(await status(row), row.id);
      if (!alive || !st) return;
      statuses.set(row.id, st);
      if (openId === id) { const back = doc.activeElement === page.querySelector('.page-back'); render(); if (back) page.querySelector('.page-back')?.focus(); }
    } catch { /* the row's last fire still shows */ }
  }
  function closeRow() {
    const id = openId; openId = null; render();
    [...body.querySelectorAll('.auto-row')].find(r => r.dataset.id === id)?.querySelector('.auto-open')?.focus();
  }
  function renderPage(row) {
    page.replaceChildren();
    const { bar, actions } = pageBar(doc, { backLabel: title, crumbs: [title], current: row.id, onBack: closeRow });
    const button = (label, verb, primary = false, enabled = true) => { const b = node('button', label, `act${primary ? ' primary' : ''}`); b.type = 'button'; b.dataset.verb = verb; b.disabled = busy || !enabled; b.addEventListener('click', () => verb === 'file' ? openFile?.(row) : perform(verb, row)); actions.append(b); return b; };
    if (canOpen(row)) button('Open file', 'file');
    for (const extra of rowActions ? rowActions(row) : []) { const b = node('button', extra.label, 'act'); b.type = 'button'; b.dataset.verb = extra.verb || ''; b.disabled = busy || extra.enabled === false; b.addEventListener('click', () => extra.run()); actions.append(b); }
    if (row.kind === 'schedule' && row.runsHere && supports('run')) button('Run now', 'run');
    if (supports('test')) button('Test', 'test', true);
    const pageBody = node('div', undefined, 'page-body'), main = node('div', undefined, 'page-main'), side = node('div', undefined, 'page-side');
    // Identity.
    const identity = node('div', undefined, 'page-identity'), glyph = node('span', undefined, 'page-glyph');
    glyph.append(iconElement(doc, kind === 'trigger' ? 'triggers' : 'schedules', { size: 22 }));
    const copy = node('div', undefined, 'page-identity-copy'), h = node('h2', undefined, 'page-title mono'); h.append(node('span', row.id));
    const tags = node('div', undefined, 'auto-tags'); tags.append(originTag(row)); stateTags(row, tags);
    copy.append(h, tags); if (row.description) copy.append(node('p', row.description, 'page-lede'));
    identity.append(glyph, copy);
    if (row.group !== 'elsewhere') identity.append(switchFor(row));
    main.append(identity);
    // Prompt.
    const prompt = pageSection(doc, row.run === 'wake' ? 'Wake message' : 'Prompt', kind === 'trigger' ? 'highlighted fields are filled from the event' : '');
    if (row.task) {
      const pre = node('pre', undefined, 'auto-prompt');
      for (const part of taskParts(row.task)) pre.append(part.field ? node('span', `{${part.field}}`, 'auto-token') : doc.createTextNode(part.text));
      prompt.append(pre);
      if (kind === 'trigger') prompt.append(node('p', 'Pull request titles and bodies are never inserted: the instance reads them from its event file.', 'page-note'));
    } else prompt.append(node('p', row.run && row.run !== 'spawn' ? `No prompt: this ${noun} runs a ${row.run}.` : 'No prompt reported.', 'page-note'));
    main.append(prompt);
    // When / On, and Spawns.
    const cards = node('div', undefined, 'auto-cards');
    const when = pageCard(doc, kind === 'trigger' ? 'On' : 'When', { icon: kind === 'trigger' ? 'triggers' : 'schedules' });
    if (kind === 'trigger') { const on = onSummary(row.on); when.body.append(pageFacts(doc, [['Event', on?.title], ['Repo', on?.repo], ['Labels', on?.labels.join(', ')], ['Base', on?.base], ['Polls', on?.poll ? `every ${on.poll}` : null]])); }
    else when.body.append(pageFacts(doc, [['Runs', cronInWords(row.cron)], ['Cron', row.cron], ['Time zone', row.tz], ['Next', row.runsHere ? relativeTime(row.nextDue, now())?.label : null]]));
    const spawns = pageCard(doc, 'Spawns', { icon: 'soul' });
    const conc = row.concurrency ? [Number.isInteger(row.concurrency.max) ? `${row.concurrency.max} at once` : null, Number.isInteger(row.concurrency.perKey) ? `${row.concurrency.perKey} per event` : null].filter(Boolean).join(' · ') : null;
    spawns.body.append(pageFacts(doc, [['Soul', row.soul ? `${row.soul.name}${soulSub(row) ? ` · ${soulSub(row)}` : ''}` : null], ['Purpose', row.spawn?.purpose], ['Teams', row.teams.join(', ')],
      ['Launch config', row.launchConfig], ['Harness', [row.harness ? harnessName(row.harness) : null, row.model].filter(Boolean).join(' · ')], ['Concurrency', conc]]));
    cards.append(when.card, spawns.card); main.append(cards);
    // Recent runs (this computer only).
    // A trigger's history comes from `trigger status` (fired, live, pending); the row alone has only its last fire.
    const st = kind === 'trigger' ? statuses.get(row.id) : null;
    const lead = st ? [st.liveCount !== null ? `${st.liveCount}${st.max !== null ? ` of ${st.max}` : ''} live now` : null, st.firedTotal ? `${st.firedTotal} fired in all` : null, st.pending.length ? `${st.pending.length} waiting` : null].filter(Boolean).join(' · ') : '';
    const runs = pageSection(doc, kind === 'trigger' ? 'Recent fires' : 'Recent runs', ['on this computer', lead].filter(Boolean).join(' · '));
    const history = node('div', undefined, 'auto-runs');
    if (st?.lastError) history.append(node('p', `Last error: ${st.lastError.message || st.lastError.code}`, 'auto-test-line warn'));
    const items = st?.fired.length ? st.fired : row.recentRuns.length ? row.recentRuns : row.lastRun ? [row.lastRun] : [];
    for (const run of items.slice(0, 10)) {
      const at = relativeTime(run.at || run.startedAt || run.scheduledFor, now()), line = node('div', undefined, 'auto-run'), time = node('time', at?.label || '—'); if (at) time.title = at.title;
      line.append(time, node('span', [run.outcome ? OUTCOMES[run.outcome] || run.outcome : null, run.event ? String(run.event).replace(/_/g, ' ') : null, run.number ? `#${run.number}` : null, run.instance].filter(Boolean).join(' · ') || 'Recorded'));
      history.append(line);
    }
    if (!items.length) history.append(node('p', row.runsHere ? 'Not run yet on this computer.' : 'Runs are recorded on the computer that runs it.', 'page-note'));
    runs.append(history); main.append(runs);
    // Side: where it runs, where it comes from, the test result.
    const where = pageCard(doc, 'Where it runs', { icon: 'computer' }), p = placementText(row, data.host);
    where.body.append(pageFacts(doc, row.origin.kind === 'local' ? [['Runs on', 'This computer']] : [['Runs on', row.runsOn], ['This computer', data.host.name || 'no host name'], ['Acts as', row.owner], ['Logged in', hostLogin(data.host, row.owner)]]));
    const verdict = node('div', undefined, `auto-verdict${p.tone === 'warn' ? ' warn' : ''}`); verdict.append(node('span', '', `auto-dot ${p.tone}`), node('span', row.runsHere ? 'Runs on this computer' : p.label));
    where.body.append(verdict); if (row.reasonDetail) where.body.append(node('p', row.reasonDetail, 'page-note'));
    const from = pageCard(doc, 'Comes from', { icon: row.origin.kind === 'local' ? 'computer' : 'repo' });
    if (row.origin.kind === 'workspace') from.body.append(pageFacts(doc, [['Member', row.origin.member], ['Repo', row.origin.repoKey], ['Path', row.origin.path], ['Commit', row.origin.commit ? row.origin.commit.slice(0, 7) : null, row.origin.commit]]));
    else from.body.append(node('p', 'Local to this computer; not shared through Git.', 'page-note'));
    if (openFile) {
      const f = node('button', 'Open file', 'act'); f.type = 'button'; f.disabled = !canOpen(row); f.title = openTitle(row);
      f.addEventListener('click', () => { if (canOpen(row)) openFile(row); }); from.body.append(f);
    }
    side.append(where.card, from.card);
    const tested = tests.get(row.id);
    if (tested) {
      const card = pageCard(doc, 'Test result', { icon: 'test' });
      card.body.append(node('p', tested.error || (tested.ok ? 'Ready: it would run here.' : 'Not ready on this computer.'), `auto-test-line${tested.ok ? '' : ' warn'}`));
      for (const problem of tested.problems || []) card.body.append(node('p', problem, 'auto-test-line warn'));
      for (const warning of tested.warnings || []) card.body.append(node('p', warning, 'auto-test-line'));
      // The soul's own error, unless a problem already says it.
      if (tested.soul && !tested.soul.resolves && !(tested.problems || []).length) card.body.append(node('p', `The soul does not resolve${tested.soul.error ? `: ${tested.soul.error}` : ''}`, 'auto-test-line warn'));
      if (tested.account) card.body.append(node('p', `gh acts as ${tested.account}`, 'auto-test-line'));
      if (tested.wouldFire) card.body.append(node('p', tested.wouldFire.length ? `Would fire now: ${tested.wouldFire.map(f => `${f.number ? `#${f.number}` : f.key}${f.held ? ' (held)' : ''}`).join(', ')}` : 'Nothing would fire now.', 'auto-test-line'));
      const due = relativeTime(tested.nextDue, now());
      if (due) card.body.append(node('p', `Next due ${due.label}`, 'auto-test-line'));
      side.append(card.card);
    }
    pageBody.append(main, side); page.append(bar, pageBody);
  }

  function render() {
    if (!alive) return;
    refreshButton.disabled = loading;
    const row = openId ? rowById(openId) : null;
    if (openId && !row && data) openId = null;
    page.hidden = !row; body.hidden = !!row; header.hidden = !!row;
    if (row) renderPage(row); else renderList();
  }
  const setText = (el, value) => { if (el.textContent !== value) el.textContent = value; };
  refreshButton.addEventListener('click', () => void refresh());
  root.addEventListener('keydown', e => { if (e.key === 'Escape' && openId && !e.defaultPrevented) { e.preventDefault(); closeRow(); } });
  // One menu open at a time; a click elsewhere closes it.
  const closeMenus = e => { for (const m of root.querySelectorAll('.auto-menu[open]')) if (!m.contains(e.target)) m.open = false; };
  doc.addEventListener('click', closeMenus);
  render(); void refresh();
  return { refresh, open: openRow, setNotice(text) { notice = text || ''; render(); }, setBusy(v) { busy = !!v; render(); }, dispose() { alive = false; serial++; doc.removeEventListener('click', closeMenus); root.remove(); } };
}

/** The Desktop shows these pages only for an OATS that reports them (kernel 0.29.0). */
export const automationsSupported = cli => !!cli?.ok && Array.isArray(cli.features) && cli.features.includes('automations') && cli.automationsApi === 1;
/** The row verbs the Desktop server serves per kind (POST /api/automations); a trigger's
 * `status` feeds its detail page and a schedule's `reconcile` its run-state check. */
export const AUTOMATION_VERBS = Object.freeze({ trigger: ['enable', 'disable', 'test'], schedule: ['enable', 'disable', 'test', 'run'] });

/** A Schedules or Triggers stage: the gate (CLI + workspace), the /api/automations IO, and
 * a fresh view per workspace. `extend(call)` adds page-specific options (the local form).
 * `call({ kind, action, key? })`: `key` is the row's qualified id. */
export function mountAutomationsPage(el, ctx, kind, extend = () => ({}), { cli: readCli = cliStatus, subscribeCli = onCliChange } = {}) {
  const doc = el.ownerDocument; ensureTheme(doc);
  const title = TITLES[kind];
  const root = doc.createElement('div'); root.className = 'automations-stage'; root.style.height = '100%';
  el.append(root);
  let view = null, card = null, shown = null, alive = true;
  async function call(body) {
    const r = await postJson(ctx, `/api/automations${wsQuery()}`, body);
    if (r?.status !== 'ok') { const e = new Error(r?.reason?.message || `${title} are unavailable.`); e.code = r?.reason?.code; throw e; }
    return r.result;
  }
  function gate(message, detail) {
    const section = doc.createElement('section'); section.className = 'oats-view automations';
    const style = doc.createElement('style'); style.textContent = automationsCSS;
    const header = doc.createElement('header'); header.className = 'auto-header'; const h = doc.createElement('h2'); h.textContent = title; header.append(h);
    const body = doc.createElement('div'); body.className = 'auto-body';
    const empty = doc.createElement('div'); empty.className = 'auto-empty auto-gate';
    const strong = doc.createElement('strong'); strong.textContent = message; empty.append(strong);
    if (detail) { const span = doc.createElement('span'); span.textContent = detail; empty.append(span); }
    body.append(empty); section.append(style, header, body); root.replaceChildren(section);
    return body;
  }
  function build() {
    if (!alive) return;
    const cli = readCli(), ok = automationsSupported(cli), ws = currentWorkspace();
    const key = JSON.stringify([ok, ws, cliKnownUnavailable()]);
    if (key === shown) return; // CLI polls re-emit; rebuild only when the gate changes
    shown = key; view?.dispose(); view = null; card?.dispose?.(); card = null;
    if (cliKnownUnavailable()) { const body = gate(`${title} need the OATS CLI`); card = cliCard(doc, ctx); body.append(card.el); return; }
    if (!cli) { gate('Checking the OATS CLI…'); return; }
    if (!ok) { gate(`${title} need OATS 0.29 or later`, `Update OATS to see the workspace's ${title.toLowerCase()} and this computer's own, and where each one runs.`); return; }
    if (!ws) { gate('Choose a workspace', `${title} are read for one local workspace.`); return; }
    root.replaceChildren();
    view = createAutomationsView(root, {
      kind, now: () => Date.now(), verbs: AUTOMATION_VERBS[kind],
      read: () => call({ kind, action: 'list' }),
      act: (verb, row) => call({ kind, action: verb, key: row.key }),
      status: kind === 'trigger' ? row => call({ kind, action: 'status', key: row.key }) : null,
      // Read-only through the contained /api/file; a member without a clone opens its web page.
      openFile: row => { if (row.origin.localPath) ctx.openFile?.(row.origin.localPath); else if (row.origin.url) ctx.openExternal?.(row.origin.url); },
      ...extend(call),
    });
  }
  const offCli = subscribeCli(build), offWs = onWorkspaceChange(() => { shown = null; build(); });
  build();
  return {
    refresh: () => view?.refresh(),
    get view() { return view; },
    dispose() { alive = false; offCli(); offWs(); view?.dispose(); card?.dispose?.(); root.remove(); },
  };
}
