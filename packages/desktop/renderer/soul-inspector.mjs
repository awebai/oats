/** On-demand kernel inspection, read-only: a v2 soul is edited in its
 * repository (soul-repository.mjs), never in place. Roster polling never
 * rebuilds the selected inspector. */
import { harnessOf } from './harness-names.mjs';
import { postJson, wsQuery, workspaceGeneration } from './views/common.mjs';
import { runtimeState } from './instance-presentation.mjs';
import { createSoulMark, createRuntimeBadge } from './identity-marks.mjs';
import { createReadinessView, readinessCSS } from './readiness-view.mjs';
import { cliStatus } from './views/cli-status.mjs';
import { iconElement } from './shell-icons.mjs';
import { inspectData, inspectFacts, originText } from './inspect-contract.mjs';
import { createTeamsPanel, teamsOperations, teamsCSS, soulTeams, teamLabels } from './teams-panel.mjs';
import { ageText } from './age-text.mjs';
import { pageBar, pageCard, pageSection, capabilityIcon } from './capability-page.mjs';
import { layerLabel } from './workspace-catalog.mjs';


const HARNESS_NAMES = { pi: 'Pi', claude: 'Claude Code', codex: 'Codex' };
const harnessName = value => HARNESS_NAMES[value] || value;
const WORK_TEXT = { worktree: 'works in its own worktree', checkout: 'works in the repo checkout', attached: 'attaches to an owning instance' };
const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
/** Why a core capability is the soul's (`layers.<slot>.from`). */
function coreWhy(from) {
  if (from === 'workspace') return 'workspace default';
  if (from === 'soul') return 'chosen by this soul';
  const team = typeof from === 'string' && /^team:(.+)$/.exec(from);
  return team ? `team · ${team[1]}` : typeof from === 'string' && from ? from : null;
}
/** What a core capability does for this soul, from its own declarations and teams. */
function coreDetail(slot, declared, teams, mapped) {
  if (slot === 'knowledge' && record(declared.knowledge)) {
    const reads = Array.isArray(declared.knowledge.reads) ? declared.knowledge.reads.length : 0;
    const parts = [typeof declared.knowledge.owns === 'string' && declared.knowledge.owns ? 'Owns 1 node' : null, reads ? `reads ${reads}` : null].filter(Boolean);
    const text = parts.join(' · ');
    return text ? text[0].toUpperCase() + text.slice(1) : null;
  }
  if (slot === 'messaging' && teams) return mapped.length ? `Personal team · can join ${mapped.map(t => t.label).join(', ')}` : 'Personal team only';
  return null;
}
/** An instance's build against its soul, from the roster's drift rows: older
 * when the soul or a module moved since; current only when every row says so. */
export function buildState(instance) {
  const modules = Array.isArray(instance?.modules) ? instance.modules : null;
  if (instance?.soul?.status === 'moved' || modules?.some(m => m?.status === 'moved')) return 'older build';
  return instance?.soul?.status === 'current' && modules?.every(m => m?.status === 'current') ? 'current' : null;
}
export const inspectorCSS = `
${readinessCSS}
${teamsCSS}
.souls { container-type:inline-size; }
.souls-body { display:grid; grid-template-columns:minmax(0,1fr); flex:1; min-height:0; min-width:0; }
.souls-body.inspecting { grid-template-columns:minmax(0,1fr) 340px; }
.workspace-main { display:flex; flex-direction:column; min-height:0; min-width:0; }
.soul-inspector { width:340px; max-width:100%; min-width:0; min-height:0; box-sizing:border-box; overflow:auto; background:var(--surface); border-left:1px solid var(--border); }
.soul-inspector[hidden] { display:none; }
.soul-inspector .inspector-head { min-height:48px; box-sizing:border-box; padding:0 14px; margin:0; flex-wrap:nowrap; border-bottom:1px solid var(--border); }
.soul-inspector .inspector-head h2 { min-width:0; font-size:14px; line-height:20px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.soul-inspector .inspector-head button { flex:none; }
.soul-inspector .inspector-head .identity-mark { width:28px; height:28px; border-radius:7px; font-size:13px; }
.soul-inspector .inspector-content { padding:0 14px 16px; }
.soul-inspector .inspector-summary { padding:0 14px; }
.soul-inspector .inspector-summary .inspector-content { padding:0; }
.soul-inspector > .inspector-status { padding:0 14px; }
.oats-view .soul-inspector button.primary:not(:disabled) { background:var(--primary-bg); color:var(--primary-fg); border-color:var(--primary-bg); }
/* The soul page (Workspace v4 W4): the page bar in place of the Workspace
   tabs, then identity, core capabilities and the composition table beside a
   300px column of cards (pageCardCSS). */
.workspace-page { flex:1; min-height:0; min-width:0; overflow-y:auto; padding:0; box-sizing:border-box; container-type:inline-size; background:var(--bg); }
.workspace-page[hidden] { display:none; }
.oats-view .workspace-page button.primary:not(:disabled) { background:var(--primary-bg); color:var(--primary-fg); border-color:var(--primary-bg); }
.oats-view .soul-page .page-bar-actions .inspector-actions { display:flex; gap:8px; margin:0; }
.oats-view .soul-page .page-bar-actions button.icon-act { display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; min-height:30px; padding:0; }
.soul-page .inspector-content h3.page-section-title { margin:0; color:var(--fg); font-size:13.5px; font-weight:650; letter-spacing:0; text-transform:none; }
.soul-page .inspector-content h3.page-section-title .page-section-lead { color:var(--muted); font-size:12px; font-weight:400; }
.soul-page .inspector-summary { min-width:0; padding:0; }
.soul-page .inspector-head { display:flex; align-items:center; gap:14px; min-width:0; margin:0; flex-wrap:nowrap; }
.soul-page .inspector-head .identity-mark { width:48px; height:48px; border-radius:11px; font-size:20px; font-weight:700; flex:none; }
.soul-page .page-identity-copy { display:flex; flex-direction:column; gap:3px; min-width:0; }
.soul-page .inspector-head h2 { flex:none; margin:0; font-size:20px; font-weight:700; letter-spacing:-.01em; line-height:1.3; }
.soul-page .inspector-head .inspector-lede { margin:0; color:var(--muted); font-size:13px; line-height:1.45; }
.soul-page .page-facts-row:empty { display:none; }
.soul-page .page-main > .inspector-status:empty { display:none; }
.soul-page .inspector-main { display:flex; flex-direction:column; gap:22px; padding:0; }
.soul-page .inspector-main:empty { display:none; }
.soul-page .soul-page-side { display:flex; flex-direction:column; gap:14px; min-width:0; }
.soul-page .soul-page-side:empty { display:none; }
.soul-page .page-sr { display:inline-block; width:1px; height:1px; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
/* Core capabilities: one card per slot. */
.core-card { display:flex; flex-direction:column; align-items:stretch; gap:8px; min-width:0; padding:14px; box-sizing:border-box; background:var(--surface); border:1px solid var(--border); border-radius:10px; color:var(--fg); text-align:left; font-size:12px; font-weight:400; }
.oats-view .soul-page button.core-card { height:auto; min-height:0; font:inherit; font-size:12px; cursor:pointer; }
.oats-view .soul-page button.core-card:hover { border-color:var(--sel-border); }
.oats-view .soul-page button.core-card:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.core-slot { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:11px; font-weight:650; letter-spacing:.05em; text-transform:uppercase; }
.core-slot-icon { display:grid; place-items:center; width:26px; height:26px; border-radius:7px; background:var(--bg); color:var(--fg); flex:none; }
.core-id { display:flex; align-items:center; gap:6px; min-width:0; color:var(--fg); font:650 13px var(--mono,monospace); }
.core-id .shell-icon { color:var(--muted); flex:none; }
.core-id-name { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
.core-version { color:var(--muted); font-weight:500; white-space:nowrap; }
.core-card.none .core-id { color:var(--muted); font-family:var(--sans,system-ui); font-weight:500; }
.core-detail { color:var(--fg); font-size:12px; }
.core-why { padding-top:8px; border-top:1px solid var(--tag-bg); color:var(--muted); font-size:11.5px; }
/* Side cards: teams, knowledge nodes, instances. */
.soul-team { display:flex; flex-direction:column; gap:3px; padding:8px 0; border-top:1px solid var(--tag-bg); }
.soul-team-name { display:flex; align-items:center; gap:8px; color:var(--fg); font-size:13px; font-weight:650; }
.soul-team-name .page-tag { height:18px; padding:0 6px; border-radius:4px; font-size:10.5px; }
.soul-team-note { color:var(--muted); font-size:12px; }
.knowledge-role { margin-left:auto; flex:none; color:var(--muted); font:600 11px var(--sans,system-ui); }
.knowledge-role.owns { color:var(--accent); }
.oats-view .soul-page button.inspector-instance { display:flex; align-items:center; gap:8px; width:100%; min-height:28px; height:auto; margin:0; padding:0 4px; box-sizing:border-box; border:0; border-radius:6px; background:var(--surface); color:var(--fg); text-align:left; font:inherit; font-size:12.5px; font-weight:500; white-space:nowrap; }
.oats-view .soul-page button.inspector-instance:hover:not(:disabled) { background:var(--surface-2); color:var(--fg); }
.oats-view .soul-page button.inspector-instance:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
.soul-page .instance-dot { width:7px; height:7px; border-radius:50%; box-sizing:border-box; border:1.5px solid var(--muted); flex:none; }
.soul-page .instance-dot.running { border-color:var(--live); background:var(--live); }
.soul-page .instance-name { min-width:0; overflow:hidden; text-overflow:ellipsis; }
.soul-page .instance-build { margin-left:auto; flex:none; color:var(--muted); font-size:11px; }
/* The readiness title reads as a section title, like every other card's. */
.soul-inspector .readiness-view h2 { font-size:10.5px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); margin:0 0 var(--title-gap); }
.inspector-head { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:16px; }
.inspector-head h2 { flex:1; margin:0; font-size:19px; overflow-wrap:anywhere; }
.inspector-content { min-width:0; overflow-wrap:anywhere; }
.inspector-content .field { min-width:0; max-width:100%; box-sizing:border-box; }
.inspector-content h3 { margin:var(--section-gap) 0 var(--title-gap); font-size:10.5px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; }
.inspector-content p { line-height:1.5; }
.inspector-content .muted { color:var(--muted); }
.inspector-content pre { white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.6 var(--mono,monospace); }
.inspector-facts { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.6fr); gap:8px 12px; font-size:12px; }
.inspector-facts dt { color:var(--muted); overflow-wrap:anywhere; }
.inspector-facts dd { margin:0; overflow-wrap:anywhere; }
.inspector-cap { padding:14px 0; border-top:1px solid var(--border); }
.inspector-instance { display:block; width:100%; min-height:56px; height:auto; margin:6px 0; text-align:left; overflow-wrap:anywhere; white-space:normal; }
.inspector-cap h4 { margin:0 0 7px; font-size:14px; }
.inspector-actions { display:flex; gap:8px; flex-wrap:wrap; margin:10px 0; }
.inspector-status { min-height:1.5em; font-size:13px; color:var(--muted); white-space:pre-wrap; }
.inspector-status:empty { min-height:0; margin:0; }
.inspector-status.error { color:var(--danger); }
/* F7: cards and compact lists (the spawn modal / context panel language); tokens only. */
.inspector-content h3.inspector-section { color:var(--muted); }
.inspector-content > h3.inspector-section:first-child { margin-top:4px; }
.inspector-readiness { padding-bottom:0; }
.inspector-readiness .readiness-view { margin-bottom:0; }
.inspector-lede { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--fg); }
.inspector-card { border:1px solid var(--border); border-radius:8px; background:var(--surface); padding:10px 12px; }
.inspector-card .inspector-facts { font-size:12px; margin:0; }
.inspector-list { border:1px solid var(--border); border-radius:8px; background:var(--surface); overflow:hidden; }
.inspector-item { display:grid; grid-template-columns:minmax(0,1fr) auto; column-gap:12px; row-gap:4px; align-items:center; padding:9px 12px; }
.inspector-item + .inspector-item { border-top:1px solid var(--border); }
.inspector-item-name { font-size:12.5px; font-weight:650; color:var(--fg); overflow-wrap:anywhere; }
.inspector-item-meta { font-size:11.5px; color:var(--muted); overflow-wrap:anywhere; }
.inspector-item > details { grid-column:1 / -1; font-size:12px; }
.inspector-item > details > summary, .inspector-disclosure > summary { cursor:pointer; color:var(--muted); font-size:12px; }
.inspector-chips { display:flex; flex-wrap:wrap; gap:6px; margin:var(--title-gap) 0; }
.inspector-chip { font-size:12px; font-weight:600; line-height:1; color:var(--fg); background:var(--surface); border:1px solid var(--border); border-radius:999px; padding:6px 10px; white-space:nowrap; }
.inspector-teams-lede { margin:0; }
.inspector-disclosure { margin-top:14px; }
.inspector-spawned { display:flex; align-items:center; gap:12px; justify-content:space-between; }
@container(max-width:700px) {
 .souls-body, .souls-body.inspecting { display:block; overflow:auto; }
 .workspace-main { height:auto; }
 .workspace-main > .souls-grid, .workspace-main > .workspace-discovery { flex:none; overflow:visible; }
 .soul-inspector { width:100%; max-width:none; overflow:visible; border-left:0; border-top:1px solid var(--border); }
}
`;

/** presentation is an optional host lease. Presence belongs to this controller;
 * effective visibility/collapse belongs to the host, not request completions. */
export function createSoulInspector(container, { ctx, presentation, openSoul = null, layout = 'sidebar', backLabel = 'Souls', openInstance = null, capabilityTable = null, openCapability = null, launch, schedule, files, canFiles = () => false, canLaunch = () => true, launchReason = () => 'Requires a compatible installed OATS CLI.', available = () => true, instances = () => [], workspace = () => null, closed }) {
  const doc = container.ownerDocument;
  let alive = true, serial = 0, operationSerial = 0, selectionGen = null, selection, data, teamsPanel = null;
  const pendingOperations = new WeakMap();
  const node = (tag, text, cls) => {
    const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el;
  };
  const button = (text, run) => {
    const b = node('button', text, 'act'); b.type = 'button'; b.addEventListener('click', run); return b;
  };
  const mutationButton = (text, run) => { const control = button(text, run); control.dataset.mutate = '1'; control.disabled = !available(); return control; };
  const request = (body, query = wsQuery()) => postJson(ctx, `/api/capabilities${query}`, body);
  const valid = (id, gen) => alive && id === serial && gen === workspaceGeneration();
  let status, content, summary, readiness, headActions = null, facts$ = null, side = null;
  function syncReadiness() {
    const w = workspace();
    const ref = selection?.instance;
    const selector = ref ? { kind: 'instance', instance: ref.instance, agent: ref.agent, agentsRoot: ref.agentsRoot, server: ref.server ?? null }
      : selection?.agent ? { kind: 'soul', soul: selection.agent.name, agentsRoot: selection.agent.agentsRoot } : null;
    readiness?.update({ active: !!selection && selectionGen === workspaceGeneration(), workspace: w, selector, cli: cliStatus(), identity: ref?.createdAt });
  }
  function message(text, error = false) {
    if (!status) return; status.textContent = text; status.classList.toggle('error', error);
  }
  function frame(title) {
    container.hidden = false;
    if (presentation) presentation.setPresent(true);
    else if (layout !== 'page') container.parentElement?.classList.add('inspecting'); // the page replaces the list; no side column
    readiness?.dispose(); readiness = null; container.replaceChildren();
    const head = node('div', undefined, 'inspector-head');
    container.classList.toggle('soul-page', layout === 'page');
    const heading = node('h2', title); heading.title = title;
    status = node('p', '', 'inspector-status'); status.setAttribute('role', 'status');
    content = node('div', undefined, 'inspector-content inspector-main');
    if (layout === 'page') {
      // Workspace v4 (W4): the page bar replaces the Workspace tabs; back returns to the list it came from.
      const bar = pageBar(doc, { backLabel, crumbs: ['Workspace', backLabel], current: title, onBack: () => { if (alive) close({ restoreFocus: true }); } });
      bar.back.classList.add('inspector-back');
      headActions = bar.actions;
      const refresh = button('', () => show(selection)); refresh.classList.add('icon-act');
      refresh.append(iconElement(doc, 'refresh', { size: 14 }), node('span', 'Refresh', 'page-sr')); refresh.title = 'Inspect again';
      headActions.append(refresh);
      summary = node('div', undefined, 'inspector-summary');
      const copy = node('div', undefined, 'page-identity-copy');
      facts$ = node('div', undefined, 'page-facts-row');
      if (selection.agent) head.append(createSoulMark(doc, selection.agent));
      copy.append(heading, facts$); head.append(copy); summary.append(head);
      side = node('div', undefined, 'soul-page-side');
      const body = node('div', undefined, 'page-body'), main = node('div', undefined, 'page-main'), column = node('div', undefined, 'page-side');
      main.append(summary, status, content); column.append(side); body.append(main, column);
      container.append(bar.bar, body);
      if (selection.agent) renderSelectedSoul(column);
      return;
    }
    headActions = null; facts$ = null; side = null;
    // Hosted X hides the slot without deselecting or rebuilding an editor.
    const closeControl = button('', () => {
      if (!alive) return;
      if (presentation) presentation.collapse();
      else close({ restoreFocus: true });
    });
    closeControl.classList.add('icon-act'); closeControl.append(iconElement(doc, 'close', { size: 14 }));
    closeControl.setAttribute('aria-label', 'Close inspector');
    if (selection.agent) head.append(createSoulMark(doc, selection.agent));
    head.append(heading, button('Refresh', () => show(selection)), closeControl);
    summary = node('div', undefined, 'inspector-summary');
    // Readiness is a first question ("can it run?"): one line under the summary, its checks behind a disclosure.
    const readinessHost = node('div', undefined, 'inspector-content inspector-readiness');
    // Readiness belongs to an instance; a soul's page shows what a person needs (human, F7).
    const withReadiness = !selection.agent;
    container.append(head, summary, status, ...(withReadiness ? [readinessHost] : []), content);
    readiness = withReadiness ? createReadinessView(readinessHost, { ctx, compact: true }) : null; syncReadiness();
    if (selection.agent) renderSelectedSoul();
  }
  // Resets are silent by default: workspace/subtab/disposal must not focus an
  // obsolete or hidden card. Only an explicit standalone X restores focus.
  function close({ restoreFocus = false } = {}) {
    if (alive) reset(restoreFocus);
  }
  function reset(restoreFocus = false) {
    serial++; selection = null; selectionGen = null; data = null; teamsPanel = null; container.hidden = true;
    readiness?.dispose(); readiness = null;
    container.replaceChildren();
    if (presentation) presentation.setPresent(false);
    else if (layout !== 'page') container.parentElement?.classList.remove('inspecting');
    closed?.({ restoreFocus: !presentation && restoreFocus });
  }
  async function show(next) {
    if (!next || !alive) return;
    selection = next; const id = ++serial, gen = workspaceGeneration(); selectionGen = gen; data = null;
    frame(next.agent?.name || next.instance?.instance || ''); message('Loading…');
    if (!available()) { message('Inspection needs an installed OATS CLI with operations API 2. Update OATS and refresh.', true); return; }
    try {
      const result = await request({ action: 'inspect', selector: next.selector });
      if (!valid(id, gen)) return;
      data = result; message(''); render();
    } catch (error) {
      // One plain sentence (the kernel's), the code behind Details — e.g. E_TEAM_CONFLICT names the two labels.
      if (!valid(id, gen)) return;
      message(error.message || 'Inspection failed. Refresh to retry.', true);
      // E_TEAM_CONFLICT: the soul can't be spawned until the workspace agrees; name the two labels.
      const labels = error.code === 'E_TEAM_CONFLICT' ? teamLabels(error.labels) : null;
      if (labels) content.append(node('p', `Team labels in conflict: ${labels.join(', ')}`, 'muted inspector-conflict-labels'));
      if (error.code) { const more = node('details', undefined, 'inspector-problem-code'); more.append(node('summary', 'Details'), node('p', error.code, 'muted')); content.append(more); }
    }
  }
  function facts(entries, parent = content) {
    const dl = node('dl', undefined, 'inspector-facts');
    for (const [key, value] of entries) dl.append(node('dt', key), node('dd', value === undefined || value === null || value === '' ? '—' : String(value)));
    parent.append(dl);
  }
  // One plain sentence each (the kernel's own message); the code waits behind Details.
  function problem(p, parent = content) {
    const row = node('div', undefined, 'inspector-problem');
    row.append(node('p', typeof p?.message === 'string' && p.message ? p.message : 'The kernel reported a problem.'));
    if (typeof p?.code === 'string' && p.code) { const more = node('details'); more.append(node('summary', 'Details'), node('p', p.code, 'muted')); row.append(more); }
    parent.append(row);
  }
  function instructions(doc, truncatedNote) {
    const box = node('details'); box.append(node('summary', 'AGENTS.md / instructions'), node('pre', doc?.text || 'No instructions reported.'));
    if (Array.isArray(doc?.sources) && doc.sources.length) box.append(node('p', `Composed from: ${doc.sources.map(x => x?.source).filter(Boolean).join(', ')}`, 'muted'));
    content.append(box);
    if (doc?.truncated) content.append(node('p', truncatedNote, 'muted'));
  }
  function render() {
    operationSerial++; teamsPanel = null;
    content.replaceChildren(); side?.replaceChildren();
    const inspected = inspectData(data, selection);
    if (!inspected) {
      // Dispatch on the payload's own integer: a classic scope still answers operationsApi 1.
      message(data?.operationsApi === 1 ? 'This workspace still uses the classic layout, which answers an older inspection. The inspector shows it once it is on the workspace model.'
        : 'The installed OATS CLI returned an inspection this Desktop cannot read. Update OATS and refresh.', true);
      return;
    }
    for (const p of inspected.problems) problem(p);
    const soul = inspected.souls[0] ?? null;
    if (inspected.subject.kind === 'instance') {
      summary.replaceChildren();
      content.append(node('p', 'As spawned: an instance never changes under itself. A newer soul or module needs a new instance.', 'muted'));
      // Teams first (join/leave), then the instance, the soul it came from, and the as-spawned detail.
      const teams = teamsOperations(inspected);
      if (teams) {
        section('Teams'); const id = serial, gen = selectionGen;
        teamsPanel = createTeamsPanel(content, { operations: teams, selector: selection.selector, request, heading: false,
          owns: () => valid(id, gen) && selectionGen === workspaceGeneration(), available });
      }
      section('Instance'); card(instanceFacts(inspected.instance));
      if (soul) spawnedFrom(soul);
      instructions(inspected.instance.instructions, 'Instructions are truncated here.');
      renderCapabilities(inspected, { collapsed: true });
    } else if (soul && layout === 'page') renderSoulPage(inspected, soul);
    else if (soul) {
      renderSoulTeams(inspected);
      // The harness it declares by default, and the model within it (if any).
      section('Harness');
      if (typeof harnessOf(soul) === 'string' && harnessOf(soul)) card([['Default harness', harnessName(harnessOf(soul))], ...(typeof soul.model === 'string' && soul.model ? [['Default model', soul.model]] : [])]);
      else content.append(node('p', 'No default harness: you choose one when you launch it.', 'muted'));
      renderCapabilities(inspected);
    } else content.append(node('p', 'The kernel did not report this soul. Refresh to retry.', 'muted'));
    // Operations run on a live home: a soul shows none (human, F7); an instance lists what it can run.
    if (inspected.subject.kind === 'instance') renderOperations(inspected);
  }
  function section(title) { const h = node('h3', title, 'inspector-section'); content.append(h); return h; }
  function card(entries, parent = content) { const box = node('div', undefined, 'inspector-card'); facts(entries, box); parent.append(box); return box; }
  const item = (name, meta, side) => {
    const el = node('div', undefined, 'inspector-item'), main = node('div');
    main.append(node('div', name, 'inspector-item-name')); for (const m of meta) if (m) main.append(node('div', m, 'inspector-item-meta'));
    el.append(main); if (side) el.append(side); return el;
  };
  // Created as a relative age; the exact value and the resolution stay reachable.
  function instanceFacts(instance) {
    return inspectFacts.instance(instance).map(([key, value]) => key === 'Created' && instance.createdAt ? [key, `${ageText(instance.createdAt)}`] : [key, value]);
  }
  function spawnedFrom(soul) {
    const box = node('div', undefined, 'inspector-card inspector-spawned');
    const commit = typeof soul.commit === 'string' && soul.commit ? ` @ ${soul.commit.slice(0, 7)}` : '';
    box.append(node('span', `Spawned from ${soul.name}${commit}`));
    // The host resolves the soul in its roster (exact identity) and selects it; a miss is said, not silent.
    const ref = { name: soul.name, agentsRoot: selection.instance?.agentsRoot, server: selection.instance?.server ?? null };
    if (typeof openSoul === 'function' && ref.name && ref.agentsRoot) {
      const id = serial, gen = selectionGen;
      const open = button('Open soul', () => {
        if (!valid(id, gen) || !open.isConnected) return;
        if (openSoul(ref) !== true) message(`${ref.name} is not in this workspace's souls.`);
      });
      open.title = 'Inspect the soul this instance was spawned from'; box.append(open);
    }
    content.append(box);
  }
  // The soul's teams (kernel `teams`): one row of chips, primary first and marked;
  // unmapped ones greyed, with the reason on one line. Joining is per instance.
  function renderSoulTeams(inspected) {
    const all = soulTeams(inspected.teams);
    if (!all) return;
    // Only the teams the soul has access to (mapped by this workspace); unmapped labels are not shown.
    const teams = all.filter(t => t.mapped);
    section('Teams');
    if (!teams.length) { content.append(node('p', 'Personal team only: this soul has access to no other team.', 'muted')); return; }
    content.append(node('p', "The teams this soul has access to. Its instances start in their person's personal team only and can join these:", 'muted inspector-teams-lede'));
    const row = node('div', undefined, 'inspector-chips');
    teams.forEach(t => {
      const chip = node('span', t.label === all[0].label ? `${t.label} · primary` : t.label, 'inspector-chip');
      chip.title = `${t.label} (${t.team})`;
      row.append(chip);
    });
    content.append(row);
  }
  // Roster-owned actions do not depend on operationsApi, inspect success, or
  // an editable soul record. Keep their DOM stable while inspection settles.
  function renderSelectedSoul(column = null) {
    const agent = selection.agent, id = serial, gen = selectionGen;
    const actions = node('div', undefined, 'inspector-actions');
    const action = (label, cls, can, run) => {
      const control = button(label, () => {
        if (valid(id, gen) && control.isConnected && !control.disabled && can(agent)) run?.(agent);
      });
      control.classList.add(cls); return control;
    };
    // The page names the launch for what it opens first: the spawn preview (Workspace v4).
    const launchButton = action(column ? 'Preview spawn' : 'Launch…', 'spawn-act', canLaunch, launch); launchButton.classList.add('primary'); launchButton.dataset.launch = '1';
    const scheduleButton = action('Schedule…', 'schedule-act', canLaunch, schedule); scheduleButton.dataset.launch = '1';
    const filesButton = action('Files', 'brain-act', canFiles, files); filesButton.dataset.files = '1';
    actions.append(filesButton, scheduleButton, launchButton);
    if (headActions) headActions.prepend(actions); else summary.append(actions);
    syncAvailability();
    const homes = instances(agent);
    const openHome = (instance, control) => {
      if (!valid(id, gen) || !control.isConnected) return;
      // Instances keep the sidebar: from a soul page, the host opens it beside the page.
      if (typeof openInstance === 'function') openInstance(instance); else void show({ instance, selector: { home: instance.home } });
    };
    if (column) {
      // Identity: what it does, then where it works (the harness joins once inspected).
      if (agent.description) facts$.before(node('p', agent.description, 'inspector-lede'));
      if (typeof agent.repoName === 'string' && agent.repoName) facts$.append(pageFact('repo', agent.repoName, 'mono'));
      if (typeof agent.work === 'string' && agent.work) facts$.append(pageFact('branch', WORK_TEXT[agent.work] || `works in ${agent.work}`, 'muted'));
      const card = pageCard(doc, 'Instances', { count: homes.length }); card.card.classList.add('inspector-instances');
      if (!homes.length) card.card.append(node('p', 'No instances yet.', 'page-note'));
      for (const instance of homes) {
        const control = node('button', undefined, 'inspector-instance'); control.type = 'button';
        const state = runtimeState(instance), build = buildState(instance);
        const dot = node('span', undefined, `instance-dot ${state}`); dot.setAttribute('aria-hidden', 'true');
        control.append(dot, node('span', instance.instance, 'instance-name'));
        if (build) control.append(node('span', build, 'instance-build'));
        control.setAttribute('aria-label', [instance.instance, state, build].filter(Boolean).join(', '));
        control.addEventListener('click', () => openHome(instance, control));
        control.disabled = !instance.home;
        control.title = instance.home ? `${state} — open its details` : 'No instance home reported';
        card.card.append(control);
      }
      column.append(card.card);
      return;
    }
    const roster = node('div', undefined, 'inspector-content');
    // What a person needs: what it does, and its instances.
    if (agent.description) roster.append(node('p', agent.description, 'inspector-lede'));
    roster.append(node('h3', `Instances · ${homes.length}`));
    if (!homes.length) roster.append(node('p', 'No instances reported for this soul.', 'muted'));
    for (const instance of homes) {
      const control = button(`${instance.instance} · ${runtimeState(instance)}`, () => openHome(instance, control));
      control.classList.add('inspector-instance'); control.disabled = !instance.home;
      control.title = instance.home ? 'Inspect the immutable instance snapshot' : 'No instance home reported';
      roster.append(control);
    }
    summary.append(roster);
  }
  function pageFact(icon, value, cls) {
    const fact = node('span', undefined, 'page-fact');
    fact.dataset.fact = icon; fact.append(iconElement(doc, icon, { size: 15 }), node('span', value, cls)); return fact;
  }
  // Workspace v4 (W4): the soul's harness joins its identity; core capabilities
  // as cards; its composition (host-injected table) with why each is there;
  // teams and knowledge beside. Only reported facts: what the kernel does not
  // say (which default a capability came from) is said as not reported.
  function renderSoulPage(inspected, soul) {
    const harness = harnessOf(soul);
    if (typeof harness === 'string' && harness) {
      const fact = node('span', undefined, 'page-fact'); fact.dataset.fact = 'harness';
      fact.append(createRuntimeBadge(doc, harness), node('span', harnessName(harness), 'strong'));
      if (typeof soul.model === 'string' && soul.model) fact.append(node('span', `${soul.model} by default`, 'muted'));
      const work = facts$.querySelector('[data-fact="branch"]'); if (work) work.before(fact); else facts$.append(fact);
    }
    const declared = record(soul.declarations) ? soul.declarations : {};
    const teams = soulTeams(inspected.teams), mapped = (teams || []).filter(t => t.mapped);
    // Core capabilities: one card per slot, the provider, what it does for this soul, and why.
    const core = pageSection(doc, 'Core capabilities', 'one of each per soul');
    const cards = node('div', undefined, 'page-cards3');
    for (const slot of ['knowledge', 'messaging', 'tasks']) {
      const layer = inspected.layers?.[slot], cap = layer?.id ? inspected.capabilities.find(c => c.id === layer.id) : null;
      const opens = !!cap && typeof openCapability === 'function';
      const card = node(opens ? 'button' : 'div', undefined, `core-card${layer?.id ? '' : ' none'}`); card.dataset.layer = slot;
      const head = node('span', undefined, 'core-slot'), icon = node('span', undefined, 'core-slot-icon');
      icon.append(iconElement(doc, capabilityIcon({ layer: slot }), { size: 15 })); head.append(icon, node('span', layerLabel(slot)));
      const id = node('span', undefined, 'core-id');
      if (layer?.id) {
        const kind = cap?.from?.kind;
        if (kind === 'package' || kind === 'member') id.append(iconElement(doc, kind === 'package' ? 'package' : 'repo', { size: 13 }));
        id.append(node('span', layer.id, 'core-id-name'));
        const version = kind === 'package' ? cap.version : kind === 'member' ? 'latest' : null;
        if (typeof version === 'string' && version) id.append(node('span', version, 'core-version'));
      } else id.append(node('span', layer ? 'None' : 'Not reported'));
      card.append(head, id);
      const detail = layer?.id ? coreDetail(slot, declared, teams, mapped) : null;
      if (detail) card.append(node('span', detail, 'core-detail'));
      const why = layer?.id && layersFrom() ? coreWhy(layer.from) : null;
      if (why) card.append(node('span', why, 'core-why'));
      if (opens) {
        card.type = 'button'; card.dataset.capability = cap.id;
        card.setAttribute('aria-label', [`${layerLabel(slot)}: ${cap.id}`, detail, why].filter(Boolean).join(', ') + ' — open its page');
        card.addEventListener('click', () => { if (alive && card.isConnected) openCapability(cap, selection.agent); });
      }
      cards.append(card);
    }
    core.append(cards); content.append(core);
    // Composition: every other capability with its source and why it is here.
    const coreIds = new Set(['knowledge', 'messaging', 'tasks'].map(slot => inspected.layers?.[slot]?.id).filter(Boolean));
    const choices = record(declared.capabilities) ? declared.capabilities : {};
    const entries = inspected.capabilities.filter(cap => !coreIds.has(cap.id)).map(cap => {
      const own = record(choices[cap.id]);
      return { cap, why: own ? 'soul' : 'default', repoOwned: own && choices[cap.id].from === 'here' };
    });
    for (const [name, choice] of Object.entries(choices)) if (choice === 'off' && !inspected.capabilities.some(cap => cap.id === name)) entries.push({ name, why: 'off' });
    const order = { default: 0, soul: 1, off: 2 }; entries.sort((a, b) => order[a.why] - order[b.why]);
    const composition = pageSection(doc, 'Capabilities', 'workspace defaults → team defaults → this soul · later wins');
    const table = node('div', undefined, 'inspector-capability-table'); composition.append(table); content.append(composition);
    if (typeof capabilityTable === 'function') capabilityTable(table, entries, { soul: selection.agent });
    // Beside: its teams (joining is per instance) and its knowledge nodes.
    if (teams) {
      const card = pageCard(doc, 'Teams', { lead: 'organise · add defaults · never restrict' });
      if (!mapped.length) card.card.append(node('p', 'Personal team only: this soul has access to no other team.', 'page-note'));
      for (const team of mapped) {
        const row = node('div', undefined, 'soul-team'), name = node('span', undefined, 'soul-team-name');
        name.append(node('span', team.label)); if (team.label === teams[0].label) name.append(node('span', 'primary', 'page-tag'));
        row.title = `${team.label} (${team.team})`;
        row.append(name, node('span', `Instances can join the ${team.label} team chat`, 'soul-team-note'));
        card.card.append(row);
      }
      side.append(card.card);
    }
    const knowledge = record(declared.knowledge) ? declared.knowledge : null;
    const nodes = knowledge ? [...(typeof knowledge.owns === 'string' && knowledge.owns ? [[knowledge.owns, 'owns']] : []),
      ...(Array.isArray(knowledge.reads) ? knowledge.reads.filter(r => typeof r === 'string' && r).map(r => [r, 'reads']) : [])] : [];
    if (nodes.length) {
      const card = pageCard(doc, 'Knowledge');
      for (const [path, role] of nodes) {
        const row = node('div', undefined, 'page-list-item'); row.append(node('span', path), node('span', role, `knowledge-role ${role}`));
        card.card.append(row);
      }
      side.append(card.card);
    }
  }
  // Core capabilities name their origin only when the CLI advertises layers-from.
  const layersFrom = () => Array.isArray(cliStatus()?.features) && cliStatus().features.includes('layers-from');
  function renderCapabilities(inspected, { collapsed = false } = {}) {
    let host = content;
    if (collapsed) { host = node('details', undefined, 'inspector-disclosure'); host.append(node('summary', `Modules as spawned · ${inspected.capabilities.length}`)); content.append(host); }
    host.append(node('h3', 'Core capabilities', 'inspector-section'));
    card(inspectFacts.layers(inspected.layers, { from: layersFrom() }), host);
    host.append(node('h3', `Capabilities · ${inspected.capabilities.length}`, 'inspector-section'));
    if (!inspected.capabilities.length) { host.append(node('p', 'No capabilities resolved.', 'muted')); return; }
    const list = node('div', undefined, 'inspector-list');
    for (const cap of inspected.capabilities) {
      const missing = Array.isArray(cap.missingRequires) && cap.missingRequires.length ? `Missing: ${cap.missingRequires.join(', ')}` : '';
      const row = item(cap.id, [[cap.version, cap.layer ? `${cap.layer} provider` : '', originText(cap.from)].filter(Boolean).join(' · '), missing]);
      row.classList.add('inspector-cap-row');
      const more = node('details'); more.append(node('summary', 'Details')); facts(inspectFacts.capability(cap), more);
      if (cap.settings && typeof cap.settings === 'object' && Object.keys(cap.settings).length) more.append(node('pre', JSON.stringify(cap.settings, null, 2)));
      row.append(more); list.append(row);
    }
    host.append(list);
  }
  function renderOperations(inspected) {
    const id = serial, gen = selectionGen;
    content.append(node('h3', 'Provider operations'));
    // A layer provider is the module that fills the layer (no activation record in v2).
    const providers = inspected.capabilities.filter(cap => cap.layer);
    // The Teams section owns messaging:teams|join|leave on an instance (one control per verb).
    const owned = inspected.subject.kind === 'instance' && teamsOperations(inspected)?.supported;
    let count = 0;
    for (const provider of providers) for (const operation of provider.operations || []) {
      if (owned && provider.layer === 'messaging' && ['teams', 'join', 'leave'].includes(operation.name)) continue;
      count++; const row = node('div', undefined, 'inspector-cap');
      row.append(node('h4', `${provider.layer}: ${operation.name}`), node('p', operation.description || provider.id, 'muted'));
      if (!operation.available || operation.args?.some(arg => arg.required)) row.append(node('p', operation.reason || 'This operation requires arguments; run it with the OATS CLI.', 'muted'));
      else {
        const address = `${provider.layer}:${operation.name}`;
        const control = mutationButton(operation.kind === 'view' ? 'View' : 'Run', async () => {
          if (!available() || !valid(id, gen) || !control.isConnected || !content.contains(control) || pendingOperations.has(control)) return;
          const op = ++operationSerial; pendingOperations.set(control, op); control.disabled = true;
          // Output/status follow latest intent; each pending control owns only its lock.
          const ownsControl = () => valid(id, gen) && control.isConnected && content.contains(control) && pendingOperations.get(control) === op;
          const owns = () => ownsControl() && op === operationSerial;
          message(`Running ${address}…`);
          try {
            const result = await request({ action: 'run', selector: selection.selector, operation: address });
            if (!owns()) return;
            // Dispatch on the payload's own integer; the result must be for this operation.
            if (result?.operationsApi !== 2 || result.operation !== address) {
              message(result?.operationsApi === 1 ? 'This workspace still uses the classic layout, which answers an older operation result.'
                : 'The installed OATS CLI returned an operation result this Desktop cannot read.', true);
              return;
            }
            const output = result.result;
            const area = node('div');
            if (operation.kind === 'view') {
              if (output?.summary) area.append(node('p', output.summary));
              for (const document of output?.documents || []) {
                area.append(node('h4', document.label));
                if (document.path) area.append(node('p', document.path, 'muted'));
                area.append(node('pre', document.text ?? 'No inline content provided.'));
              }
            } else area.append(node('pre', JSON.stringify(output, null, 2)));
            row.querySelector('.operation-output')?.remove(); area.className = 'operation-output'; row.append(area); message('Complete.');
          } catch (error) { if (owns()) message(error.message, true); }
          finally {
            if (ownsControl()) { pendingOperations.delete(control); syncAvailability(); }
          }
        });
        control.dataset.operation = address; row.append(control);
      }
      content.append(row);
    }
    if (!count) content.append(node('p', 'The active providers do not declare operations.'));
  }
  function syncAvailability() {
    syncReadiness(); teamsPanel?.sync();
    if (!selection || !content) return;
    for (const control of content.querySelectorAll('[data-mutate]')) control.disabled = pendingOperations.has(control) || !available() || selectionGen !== workspaceGeneration();
    for (const control of container.querySelectorAll('[data-launch]')) {
      control.disabled = !alive || selectionGen !== workspaceGeneration() || !canLaunch(selection.agent) || selection.agent?.work === 'attached' || !selection.agent?.agentsRoot;
      control.title = selection.agent?.work === 'attached' ? 'Attached only — requires an owning instance.' : control.disabled ? launchReason(selection.agent) : '';
    }
    for (const control of container.querySelectorAll('[data-files]')) {
      control.disabled = !alive || selectionGen !== workspaceGeneration() || !canFiles(selection.agent);
      control.title = control.disabled ? 'Files need an unambiguous local soul in this workspace.' : 'Read-only soul files';
    }
  }
  return { show, close, syncAvailability,
    focusLaunch(agent) {
      const selected = selection?.agent;
      if (!alive || container.hidden || (presentation && !presentation.isVisible())
        || selectionGen !== workspaceGeneration() || !selected || selected.name !== agent.name
        || (selected.agentsRoot || '') !== (agent.agentsRoot || '') || (selected.server || '') !== (agent.server || '')) return false;
      const control = container.querySelector('.spawn-act:not([disabled])'); // the page keeps its actions in the head
      if (!control?.isConnected || control.closest('[hidden], [inert]')) return false;
      control.focus(); return true;
    },
    dispose() { if (!alive) return; alive = false; reset(); } };
}
