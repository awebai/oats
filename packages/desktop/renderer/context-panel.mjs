import { moduleDriftText, servedIdentityText, soulSourceText } from './deployment-facts.mjs';
import { iconElement } from './shell-icons.mjs';
import { ageText } from './age-text.mjs';
import { createSoulMark } from './identity-marks.mjs';
/** Shell-owned contextual surface. Optional Git reads are delegated to an
 * injected controller; this host performs no IO, lookup or lifecycle actions. */
export const contextPanelCSS = `
#context-panel.context-panel { display:flex; flex:0 0 340px; width:340px; min-width:0; min-height:0; flex-direction:column; box-sizing:border-box; overflow:hidden; border-left:1px solid var(--border); background:var(--surface); color:var(--fg); font:13px/1.45 -apple-system,"Segoe UI",system-ui,sans-serif; }
#context-panel.context-panel[hidden], #context-panel [hidden] { display:none !important; }
#context-panel.context-panel.is-collapsed { flex-basis:44px; width:44px; }
#context-panel .context-panel-header { display:flex; align-items:center; flex:none; height:48px; box-sizing:border-box; border-bottom:1px solid var(--border); padding:0 6px; gap:4px; }
#context-panel .context-panel-tabs { display:flex; flex:1; min-width:0; height:100%; align-items:center; gap:2px; }
#context-panel .context-panel-control { font:inherit; color:var(--muted); background:var(--surface); border:0; border-radius:4px; cursor:pointer; padding:6px; }
#context-panel .context-panel-tab { font-size:12px; white-space:nowrap; min-height:32px; }
#context-panel .context-panel-tab[aria-selected="true"] { color:var(--accent); background:var(--sel); }
#context-panel .context-panel-control:hover { background:var(--surface-2); color:var(--fg); }
#context-panel .context-panel-control:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
#context-panel .context-panel-rail { display:flex; flex-direction:column; align-items:center; flex:1; min-height:0; }
#context-panel .context-panel-rail { gap:4px; padding:8px 0; box-sizing:border-box; }
#context-panel .context-panel-rail-tab { position:relative; width:30px; height:30px; padding:0; }
#context-panel .context-panel-rail-tab[aria-pressed=true] { color:var(--accent); background:var(--sel); }
#context-panel .context-panel-dot { position:absolute; right:1px; top:1px; width:7px; height:7px; border-radius:50%; background:var(--accent); border:1px solid var(--surface); }
#context-panel .context-panel-expand { width:30px; min-height:30px; padding:0; margin-top:auto; }
#context-panel .context-panel-generic, #context-panel .context-panel-stages { display:flex; flex:1; min-height:0; min-width:0; flex-direction:column; overflow:hidden; }
#context-panel .context-panel-page { flex:1; min-height:0; overflow:auto; padding:16px; box-sizing:border-box; overflow-wrap:anywhere; }
#context-panel .context-panel-page h2 { font-size:14px; margin:0 0 12px; }
#context-panel .context-panel-note { color:var(--muted); }
/* Redesign v3 instance page: identity header, then labelled sections. */
#context-panel .context-panel-page[data-context-page="instance"], #context-panel .context-panel-page[data-context-page="soul"] { display:flex; flex-direction:column; gap:var(--section-gap); }
#context-panel .context-panel-page[hidden] { display:none; }
#context-panel .context-panel-identity { display:flex; align-items:center; gap:10px; min-width:0; }
#context-panel .context-panel-identity .identity-mark { width:36px; height:36px; border-radius:9px; font-size:15px; font-weight:700; }
#context-panel .context-panel-identity-copy { display:flex; flex-direction:column; min-width:0; flex:1; }
#context-panel .context-panel-identity-name { font-size:13.5px; font-weight:700; line-height:1.45; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#context-panel .context-panel-identity-sub { font-size:11.5px; line-height:1.45; color:var(--muted); overflow-wrap:anywhere; }
#context-panel .context-panel-state { flex:none; display:flex; align-items:center; gap:5px; font-size:11.5px; font-weight:650; color:var(--muted); }
#context-panel .context-panel-state[data-state="running"] { color:var(--accent); }
#context-panel .context-panel-state::before { content:''; width:6px; height:6px; border-radius:50%; box-sizing:border-box; border:1.5px solid currentColor; }
#context-panel .context-panel-state[data-state="running"]::before { background:currentColor; }
#context-panel .context-panel-section { display:flex; flex-direction:column; gap:var(--title-gap); min-width:0; }
#context-panel .context-panel-label { font-size:10.5px; font-weight:650; line-height:1.45; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); }
#context-panel .context-panel-card { display:flex; flex-direction:column; gap:5px; padding:10px 12px; min-width:0; border:1px solid var(--border); border-radius:8px; background:var(--surface-2); }
#context-panel .context-panel-branch { display:flex; align-items:center; gap:8px; min-width:0; font:700 12px ui-monospace, Menlo, monospace; }
#context-panel .context-panel-branch > .shell-icon { width:13px; height:13px; flex:none; color:var(--muted); }
#context-panel .context-panel-branch > span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* A path: one line, clipped at the start so its meaningful end shows (full value in the title), plus Copy. */
#context-panel .context-panel-pathline { display:flex; align-items:center; gap:8px; min-width:0; }
#context-panel .context-panel-path { flex:1; min-width:0; font:11px/1.55 ui-monospace, Menlo, monospace; color:var(--muted); overflow:hidden; white-space:nowrap; text-overflow:ellipsis; text-align:left; }
#context-panel .context-panel-copy { flex:none; font:600 11px/1 inherit; color:var(--fg); background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:5px 8px; cursor:pointer; }
#context-panel .context-panel-copy:hover { background:var(--surface-2); }
#context-panel .context-panel-copy:focus-visible, #context-panel .context-panel-action:focus-visible, #context-panel .context-panel-details > summary:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
#context-panel .context-panel-details { border-top:1px solid var(--border); padding-top:12px; min-width:0; }
#context-panel .context-panel-details > summary { cursor:pointer; font-size:12px; font-weight:650; color:var(--fg); }
#context-panel .context-panel-details[open] > summary { margin-bottom:12px; }
#context-panel .context-panel-detail { display:flex; flex-direction:column; gap:6px; margin-bottom:12px; min-width:0; }
#context-panel .context-panel-actions { display:flex; gap:8px; flex-wrap:wrap; }
#context-panel .context-panel-action { font:600 12.5px/1 inherit; height:32px; padding:0 14px; border-radius:7px; background:var(--primary-bg); color:var(--primary-fg); border:1px solid var(--primary-bg); cursor:pointer; }
#context-panel .context-panel-action:disabled { background:var(--surface-2); color:var(--muted); border-color:var(--border); cursor:default; }
/* Facts are cards of hairline-separated rows (like the design's Changes
   card): label column, value column; nothing is clipped — long paths and
   ids wrap on any character in mono. */
#context-panel .context-panel-facts { margin:0; border:1px solid var(--border); border-radius:8px; overflow:hidden; background:var(--surface); font-size:12px; line-height:1.45; }
#context-panel .context-panel-fact { display:grid; grid-template-columns:minmax(76px,30%) minmax(0,1fr); gap:12px; align-items:baseline; padding:7px 12px; min-height:32px; box-sizing:border-box; }
#context-panel .context-panel-fact + .context-panel-fact { border-top:1px solid var(--border); }
#context-panel .context-panel-facts dt { color:var(--muted); font-size:11.5px; }
#context-panel .context-panel-facts dd { margin:0; min-width:0; color:var(--fg); overflow-wrap:anywhere; }
#context-panel .context-panel-facts dd.is-mono { font:11px/1.6 ui-monospace, Menlo, monospace; }
#context-panel .context-panel-facts dd[data-unreported] { color:var(--muted); }
#context-panel .context-panel-stage.oats-view { display:flex; flex:1; flex-direction:column; width:100%; min-width:0; min-height:0; overflow:auto; background:var(--surface); }
#context-panel .context-panel-stage > * { max-width:100%; box-sizing:border-box; }
`;

const noop = () => {};
const inertLease = () => ({ setPresent: noop, isVisible: () => false, collapse: noop, dispose: noop });
const inertPanel = () => ({
  setContext: noop, attach: inertLease, release: noop, toggle: noop, setCollapsed: noop,
  setFocusMode: noop, toggleFocusMode: noop, isFocusMode: () => false, dispose: noop,
});
const reported = value => typeof value === 'string' && value.length ? value
  : typeof value === 'number' && Number.isFinite(value) ? String(value)
    : typeof value === 'boolean' ? String(value) : 'Not reported';

/**
 * setContext is the ONLY foreground selector; attach never selects an owner.
 * workspace and key are exact, opaque identities supplied by the shell.
 * An attached slot starts present. setPresent only changes that slot's presence,
 * never the current context or the user's collapse preference.
 *
 * Leases are bound to the workspace generation in which attach was called.
 * Workspace changes clear presence synchronously, retaining the real DOM. To
 * reuse a retained stage on a later visit, attach(owner, sameElement) renews its
 * lease without rebuilding it. Old callbacks (including A → B → A completions)
 * cannot revive presence or dispose the renewed lease. Callers must guard their
 * own asynchronous content writes; this module owns visibility, not their forms.
 */
export function createContextPanel({
  document: suppliedDocument, root: suppliedRoot, onIntent = noop,
  applyFocus = callback => callback(), onFocusModeChange = noop, createGitPanel, createTeamsSection, openSoul,
  connectionGeneration = () => 0, subscribeConnections = () => noop,
} = {}) {
  const document = suppliedDocument ?? suppliedRoot?.ownerDocument ?? globalThis.document;
  const root = suppliedRoot ?? document?.getElementById('context-panel');
  if (!document || !root) return inertPanel();

  let disposed = false, focusMode = false, applyingFocus = false, epoch = 0;
  let context = { workspace: null, owner: null, instance: null, key: null };
  let gitSummary = null;
  const contextIdentity = () => JSON.stringify([context.workspace, context.key, context.instance?.home, context.instance?.agent,
    context.instance?.agentsRoot, context.instance?.server || null, context.instance?.createdAt ?? null]);
  const preferences = new Map(); // Only chrome preferences, never selection.
  const slots = new Map();
  const app = document.getElementById('app');
  const node = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  // Controls carry a decorative app icon; the aria-label/title name them.
  const control = (className, iconName, label, click) => {
    const el = node('button', `context-panel-control ${className}`);
    if (iconName) el.append(iconElement(document, iconName, { size: 15 }));
    el.type = 'button'; el.setAttribute('aria-label', label); el.title = label;
    el.addEventListener('click', click);
    return el;
  };
  const pref = () => {
    if (!preferences.has(context.workspace)) preferences.set(context.workspace, { collapsed: false, tab: 'instance' });
    return preferences.get(context.workspace);
  };
  const visible = el => {
    if (!el?.isConnected || el.disabled) return false;
    for (let current = el; current; current = current.parentElement) {
      if (current.hidden || current.inert) return false;
      const style = document.defaultView?.getComputedStyle(current);
      if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    }
    return true;
  };
  const projectFocus = callback => {
    const previous = applyingFocus; applyingFocus = true;
    try { return applyFocus(callback); }
    finally { applyingFocus = previous; }
  };
  const focus = el => {
    if (visible(el)) projectFocus(() => el.focus({ preventScroll: true }));
  };
  const rail = node('div', 'context-panel-rail');
  rail.setAttribute('role', 'toolbar'); rail.setAttribute('aria-label', 'Context sections'); rail.setAttribute('aria-orientation', 'vertical');
  const expand = control('context-panel-expand', 'chevronLeft', 'Expand context panel', event => {
    if (!disposed && visible(event.currentTarget)) { onIntent(event); setCollapsed(false); }
  });
  expand.setAttribute('aria-expanded', 'false'); expand.setAttribute('aria-controls', 'context-panel'); expand.dataset.action = 'panel.toggle';
  const railTabs = new Map();
  for (const [id, glyph, label] of [['instance', 'info', 'Instance'], ['soul', 'soul', 'Soul'], ['git', 'branch', 'Git & GitHub']]) {
    const button = control('context-panel-rail-tab', glyph, label, event => {
      if (disposed || root.hidden || !hasGeneric() || !pref().collapsed || !visible(button)) return;
      onIntent(event);
      project(() => { pref().tab = id; pref().collapsed = false; });
      focus(tabs.get(id));
    });
    button.dataset.contextRail = id; button.setAttribute('aria-controls', `context-panel-page-${id}`);
    railTabs.set(id, button); rail.append(button);
  }
  const gitDot = node('span', 'context-panel-dot'); gitDot.hidden = true; gitDot.setAttribute('aria-hidden', 'true'); railTabs.get('git').append(gitDot);
  rail.append(expand);
  rail.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey || !visible(event.target)) return;
    const buttons = [...railTabs.values(), expand].filter(visible), at = buttons.indexOf(document.activeElement);
    if (at < 0) return;
    event.preventDefault(); event.stopPropagation(); onIntent(event);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    focus(buttons[next]);
  });
  const generic = node('div', 'context-panel-generic');
  const header = node('div', 'context-panel-header');
  const tablist = node('div', 'context-panel-tabs');
  tablist.setAttribute('role', 'tablist'); tablist.setAttribute('aria-label', 'Instance context');
  const collapse = control('context-panel-collapse', 'close', 'Collapse context panel', event => {
    if (!disposed && visible(event.currentTarget)) { onIntent(event); setCollapsed(true); }
  });
  collapse.setAttribute('aria-expanded', 'true'); collapse.setAttribute('aria-controls', 'context-panel');
  header.append(tablist, collapse); generic.append(header);
  const tabs = new Map(), pages = new Map();
  for (const [id, label] of [['instance', 'Instance'], ['soul', 'Soul'], ['git', 'Git & GitHub']]) {
    const tab = control('context-panel-tab', null, label, event => selectTab(id, event)); tab.textContent = label;
    tab.id = `context-panel-tab-${id}`; tab.dataset.contextTab = id;
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `context-panel-page-${id}`);
    tab.addEventListener('keydown', event => {
      const ids = [...tabs.keys()], index = ids.indexOf(id);
      const next = event.key === 'ArrowRight' ? (index + 1) % ids.length
        : event.key === 'ArrowLeft' ? (index + ids.length - 1) % ids.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : null;
      if (next === null || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault(); selectTab(ids[next], event); focus(tabs.get(ids[next]));
    });
    tabs.set(id, tab); tablist.append(tab);
    const page = node('section', 'context-panel-page');
    page.id = `context-panel-page-${id}`; page.dataset.contextPage = id;
    page.setAttribute('role', 'tabpanel'); page.setAttribute('aria-labelledby', tab.id); page.tabIndex = 0;
    pages.set(id, page); generic.append(page);
  }
  const fields = new Map();
  function facts(pageId, entries) {
    const dl = node('dl', 'context-panel-facts');
    for (const [id, label] of entries) {
      const value = node('dd', null, 'Not reported'); value.dataset.contextField = id;
      fields.set(id, value); dl.append(node('dt', null, label), value);
    }
    pages.get(pageId).append(dl);
  }
  // Instance page (Redesign v3): identity header — soul mark, name, "soul ·
  // harness · model", state — then Worktree and Details. Every value is the
  // roster row's own reported fact; unreported facts read "Not reported".
  const identityHeader = (pageId) => {
    const wrap = node('div', 'context-panel-identity'), mark = node('span', 'context-panel-mark');
    const copy = node('div', 'context-panel-identity-copy');
    wrap.append(mark, copy); pages.get(pageId).append(wrap);
    return { mark, copy };
  };
  const section = (pageId, label) => {
    const el = node('section', 'context-panel-section'); el.append(node('div', 'context-panel-label', label));
    pages.get(pageId).append(el); return el;
  };
  const field = (tag, className, id) => { const el = node(tag, className, 'Not reported'); el.dataset.contextField = id; fields.set(id, el); return el; };
  pages.get('instance').dataset.contextPage = 'instance'; pages.get('soul').dataset.contextPage = 'soul';
  const instanceHead = identityHeader('instance');
  const instanceSub = node('div', 'context-panel-identity-sub');
  instanceHead.copy.append(field('div', 'context-panel-identity-name', 'instance'), instanceSub);
  const state = field('span', 'context-panel-state', 'running');
  instanceHead.copy.after(state);
  // A path shows its meaningful end (clipped at the start, full in the title)
  // with a Copy control; the field keeps the full reported value.
  const copyControl = (id) => {
    const b = node('button', 'context-panel-copy', 'Copy'); b.type = 'button'; b.dataset.copy = id;
    b.setAttribute('aria-label', 'Copy path'); b.title = 'Copy path';
    b.addEventListener('click', async () => {
      const text = fields.get(id)?.textContent;
      if (!text || text === 'Not reported') return;
      try { await document.defaultView?.navigator?.clipboard?.writeText(text); b.textContent = 'Copied'; } catch { b.textContent = 'Copy failed'; }
      setTimeout(() => { if (b.isConnected) b.textContent = 'Copy'; }, 1500);
    });
    return b;
  };
  const pathLine = (id) => {
    const line = node('div', 'context-panel-pathline'), clip = node('div', 'context-panel-path');
    clip.dir = 'rtl'; clip.append(field('bdi', null, id)); line.dataset.row = id; line.append(clip, copyControl(id));
    rows.set(id, line); return line;
  };
  const rows = new Map();
  const worktree = section('instance', 'Worktree'), card = node('div', 'context-panel-card');
  const branchLine = node('div', 'context-panel-branch'); branchLine.append(iconElement(document, 'branch', { size: 13 }), field('span', null, 'branch'));
  card.append(branchLine, pathLine('repo')); worktree.append(card);
  // Teams (teams contract): injected like Git — this host performs no IO.
  const teamsHost = section('instance', 'Teams'); teamsHost.dataset.contextSection = 'teams'; teamsHost.hidden = true;
  const teamsSection = typeof createTeamsSection === 'function' ? createTeamsSection(teamsHost, { onPresence(present) { if (!disposed) teamsHost.hidden = !present; } }) : null;
  // Only what the instance reported: an unreported fact hides its row (the
  // field keeps "Not reported"), and a section with no reported row hides.
  function facts(host, entries) {
    const dl = node('dl', 'context-panel-facts');
    for (const [id, label, mono] of entries) {
      const row = node('div', 'context-panel-fact'); row.dataset.row = id; rows.set(id, row);
      row.append(node('dt', null, label), field('dd', mono ? 'is-mono' : null, id)); dl.append(row);
    }
    host.append(dl); return dl;
  }
  const session = section('instance', 'Session');
  facts(session, [['harness', 'Harness'], ['model', 'Model'], ['work', 'Work mode'], ['createdAt', 'Created']]);
  const lineage = section('instance', 'Lineage');
  facts(lineage, [['parentInstance', 'Parent'], ['siblingInstance', 'Sibling']]);
  const details = node('details', 'context-panel-details'); details.append(node('summary', null, 'Details'));
  const homeRow = node('div', 'context-panel-detail'); homeRow.append(node('div', 'context-panel-label', 'Home'), pathLine('home'));
  details.append(homeRow);
  facts(details, [['team', 'Team label'], ['soulSource', 'Soul source'], ['modules', 'Modules'], ['identity', 'Served identity']]);
  pages.get('instance').append(details);
  const soulHead = identityHeader('soul');
  const soulSub = field('div', 'context-panel-identity-sub', 'description');
  soulHead.copy.append(field('div', 'context-panel-identity-name', 'agent'), soulSub);
  const soulActions = node('div', 'context-panel-actions');
  const openSoulControl = node('button', 'context-panel-action', 'Open in Workspace'); openSoulControl.type = 'button';
  openSoulControl.title = 'Show this soul in the Workspace view'; openSoulControl.dataset.action = 'soul.open';
  openSoulControl.addEventListener('click', event => {
    if (disposed || !hasGeneric() || typeof openSoul !== 'function' || !context.instance?.agent) return;
    onIntent(event); openSoul({ workspace: context.workspace, name: context.instance.agent, agentsRoot: context.instance.agentsRoot, server: context.instance.server || undefined });
  });
  soulActions.append(openSoulControl); pages.get('soul').append(soulActions);
  const soulDetails = node('details', 'context-panel-details'); soulDetails.append(node('summary', null, 'Details'));
  const rootRow = node('div', 'context-panel-detail'); rootRow.append(node('div', 'context-panel-label', 'Agents root'), pathLine('agentsRoot'));
  soulDetails.append(rootRow); pages.get('soul').append(soulDetails);
  const gitPanel = typeof createGitPanel === 'function' ? createGitPanel(pages.get('git'), { applyFocus: projectFocus,
    onObservation(summary) {
      if (disposed) return;
      gitSummary = summary && summary.identity === contextIdentity() && summary.connection === connectionGeneration() ? { ...summary } : null;
      paintGitDot();
    },
  }) : null;
  function paintGitDot() {
    const changed = hasGeneric() && gitSummary?.identity === contextIdentity() && gitSummary.connection === connectionGeneration() && gitSummary.changed === true;
    gitDot.hidden = !changed;
    const label = changed ? 'Git & GitHub — changes in the last accepted observation' : 'Git & GitHub';
    railTabs.get('git').title = label; railTabs.get('git').setAttribute('aria-label', label);
  }
  if (!gitPanel) pages.get('git').append(node('h2', null, 'Git & GitHub'), node('p', 'context-panel-note',
    'Integration unavailable. This host has no K1 Git reader. No changes, diffs, pull requests, or checks are reported here.'));
  const stages = node('div', 'context-panel-stages');
  root.classList.add('context-panel');
  if (!root.hasAttribute('aria-label')) root.setAttribute('aria-label', 'Context panel');
  root.append(rail, generic, stages);

  const currentSlot = () => context.owner == null ? null : slots.get(context.owner);
  const slotPresent = slot => !!slot && slot.epoch === epoch && slot.present;
  function hasGeneric() { return context.owner == null && (context.instance != null || context.key != null); }
  const hasContent = () => context.owner != null ? slotPresent(currentSlot()) : hasGeneric();
  function render() {
    const present = !disposed && hasContent(), collapsed = pref().collapsed;
    const expanded = present && !focusMode && !collapsed;
    root.hidden = !present || focusMode;
    root.classList.toggle('is-collapsed', collapsed);
    rail.hidden = !present || !collapsed || focusMode;
    for (const [id, button] of railTabs) { button.hidden = !hasGeneric(); button.setAttribute('aria-pressed', String(pref().tab === id)); }
    paintGitDot();
    generic.hidden = !expanded || !hasGeneric();
    stages.hidden = !expanded || context.owner == null;
    for (const slot of slots.values()) slot.wrapper.hidden = !expanded || slot !== currentSlot() || !slotPresent(slot);
    for (const [id, tab] of tabs) {
      const selected = pref().tab === id;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
      pages.get(id).hidden = !selected;
    }
    gitPanel?.update({ active: expanded && hasGeneric() && pref().tab === 'git',
      workspace: context.workspace, instance: context.instance, key: context.key });
    teamsSection?.update({ active: expanded && hasGeneric() && pref().tab === 'instance',
      workspace: context.workspace, instance: context.instance, key: context.key });
    const toggle = document.getElementById('panel-toggle');
    if (toggle) {
      toggle.disabled = !present || focusMode;
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-controls', 'context-panel');
    }
    const mode = document.getElementById('focus-mode-toggle');
    if (mode) {
      mode.setAttribute('aria-pressed', String(focusMode));
      const text = focusMode ? 'Exit focus mode' : 'Focus mode';
      if (mode.textContent !== text) mode.textContent = text;
      mode.setAttribute('aria-label', text);
    }
  }
  // Restore only when this projection hides/removes the focused container.
  // Never focus a newly selected instance or form during background polling.
  function project(change, changed = noop) {
    if (disposed) return;
    const active = document.activeElement;
    const inside = root.contains(active);
    const inSidebar = document.getElementById('sidebar')?.contains(active)
      || document.getElementById('sidebar-restore')?.contains(active);
    const wasFocusMode = focusMode;
    change(); render(); changed();
    if ((inside && !visible(active)) || (inSidebar && !wasFocusMode && focusMode)) {
      focus(visible(expand) ? expand : document.getElementById('focus-mode-toggle'));
    }
  }
  /** Status bar (Redesign v3): the focused terminal's reported branch and
   * "harness · model" — the row's own facts, nothing inferred or fetched. */
  function projectStatus(instance) {
    const el = document.getElementById('context-status');
    if (!el) return;
    const parts = [];
    if (typeof instance?.branch === 'string' && instance.branch) {
      const branch = node('span', 'context-status-branch');
      branch.append(iconElement(document, 'branch', { size: 12 }), node('span', '', instance.branch)); parts.push(branch);
    }
    const detail = [instance?.harness, instance?.model].filter(v => typeof v === 'string' && v).join(' · ');
    if (detail) parts.push(node('span', '', detail));
    el.replaceChildren(...parts);
  }
  function projectMetadata() {
    projectStatus(context.instance);
    const instance = context.instance ?? {};
    // Header: soul mark and the "soul · harness · model" line omit what the
    // row did not report (Details still says "Not reported" for each).
    const soul = typeof instance.agent === 'string' && instance.agent ? { name: instance.agent, agentsRoot: instance.agentsRoot } : null;
    const markKey = JSON.stringify([soul?.name ?? null, soul?.agentsRoot ?? null]);
    for (const head of [instanceHead, soulHead]) if (head.mark.dataset.markKey !== markKey) {
      head.mark.dataset.markKey = markKey; head.mark.replaceChildren(...(soul ? [createSoulMark(document, soul)] : []));
    }
    const sub = [instance.agent, instance.harness, instance.model].filter(v => typeof v === 'string' && v).join(' · ');
    if (instanceSub.textContent !== sub) instanceSub.textContent = sub;
    state.dataset.state = instance.running === true ? 'running' : instance.running === false ? 'stopped' : 'unknown';
    for (const [id, el] of fields) {
      const value = id === 'running' ? instance.running === true ? 'Running'
        : instance.running === false ? 'Stopped' : 'Not reported'
        : id === 'soulSource' ? soulSourceText(instance.soul) ?? 'Not reported'
        : id === 'modules' ? moduleDriftText(instance.modules) ?? 'Not reported'
        // Absent identity is the provider's absent fact: nothing is inferred.
        : id === 'identity' ? servedIdentityText(instance.identity) ?? 'Not reported'
        : reported(instance[id]);
      const shown = id === 'createdAt' && value !== 'Not reported' ? ageText(value) : value;
      if (el.textContent !== shown) el.textContent = shown;
      if (id === 'createdAt') el.title = value === 'Not reported' ? '' : value;
      else if (el.closest('.context-panel-path')) el.closest('.context-panel-path').title = value === 'Not reported' ? '' : value;
      el.toggleAttribute('data-unreported', value === 'Not reported');
      const row = rows.get(id); if (row) row.hidden = value === 'Not reported';
    }
    // A section with nothing reported is not shown; the header sub-line omits an unreported description.
    soulSub.hidden = fields.get('description').textContent === 'Not reported';
    for (const host of [session, lineage]) host.hidden = [...host.querySelectorAll('[data-row]')].every(r => r.hidden);
    for (const box of [details, soulDetails]) box.hidden = [...box.querySelectorAll('[data-row]')].every(r => r.hidden);
    openSoulControl.disabled = typeof openSoul !== 'function' || typeof instance.agent !== 'string' || !instance.agent;
  }
  function selectTab(id, event) {
    if (!tabs.has(id) || !hasGeneric() || !visible(tabs.get(id))) return;
    onIntent(event);
    project(() => { pref().tab = id; });
  }
  function setCollapsed(value) { project(() => { pref().collapsed = !!value; }); }
  function setFocusMode(value) {
    const next = !!value;
    if (disposed || next === focusMode) return;
    project(() => { focusMode = next; app?.classList.toggle('focus-mode', next); }, () => onFocusModeChange(next));
  }
  const entry = event => {
    if (!disposed && !applyingFocus && !root.hidden && visible(event.target)) onIntent(event);
  };
  root.addEventListener('pointerdown', entry); root.addEventListener('focusin', entry);
  const offConnection = subscribeConnections(() => { gitSummary = null; paintGitDot(); });
  render();
  return {
    setContext({ workspace = null, owner = null, instance = null, key = null } = {}) {
      project(() => {
        if (workspace !== context.workspace) {
          epoch++;
          for (const slot of slots.values()) slot.present = false;
        }
        const previous = contextIdentity();
        context = { workspace, owner, instance, key };
        if (previous !== contextIdentity() || owner != null) gitSummary = null;
        projectMetadata();
      });
    },
    attach(owner, element) {
      if (disposed || owner == null || !element || element.nodeType !== 1 || element === root || element.contains(root)) return inertLease();
      let slot;
      project(() => {
        // The same DOM cannot have two live owners. Moving it invalidates the
        // former lease just as replacing the element for one owner does.
        for (const [other, existing] of slots) {
          if (other !== owner && existing.element === element) { existing.wrapper.remove(); slots.delete(other); }
        }
        const previous = slots.get(owner);
        const wrapper = previous?.wrapper ?? node('div', 'context-panel-stage oats-view');
        if (previous?.element !== element) wrapper.replaceChildren(element);
        if (!wrapper.parentNode) stages.append(wrapper);
        slot = { element, wrapper, epoch, present: true };
        slots.set(owner, slot);
      });
      const owns = () => !disposed && slots.get(owner) === slot;
      const current = () => owns() && slot.epoch === epoch;
      return {
        setPresent(value) { if (current()) project(() => { slot.present = !!value; }); },
        isVisible: () => current() && currentSlot() === slot && slot.present && !root.hidden && !pref().collapsed,
        collapse() { if (current() && currentSlot() === slot && slot.present) setCollapsed(true); },
        dispose() {
          if (owns()) project(() => { slots.delete(owner); slot.wrapper.remove(); });
        },
      };
    },
    release(owner) {
      const slot = slots.get(owner);
      if (slot) project(() => { slots.delete(owner); slot.wrapper.remove(); });
    },
    toggle() { if (!disposed && hasContent() && !focusMode) setCollapsed(!pref().collapsed); },
    setCollapsed,
    setFocusMode,
    toggleFocusMode() { setFocusMode(!focusMode); },
    isFocusMode: () => focusMode,
    dispose() {
      if (disposed) return;
      project(() => {
        const changed = focusMode;
        focusMode = false; app?.classList.remove('focus-mode');
        for (const slot of slots.values()) slot.wrapper.remove();
        slots.clear(); context = { workspace: null, owner: null, instance: null, key: null };
        gitPanel?.dispose(); teamsSection?.dispose?.();
        rail.remove(); generic.remove(); stages.remove();
        if (changed) onFocusModeChange(false);
      });
      disposed = true; preferences.clear(); offConnection?.(); gitSummary = null;
      root.removeEventListener('pointerdown', entry); root.removeEventListener('focusin', entry);
    },
  };
}
