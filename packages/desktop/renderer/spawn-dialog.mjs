/** Frame 02 composition. Moves the real existing controls; owns no launch API. */
import { createSoulMark, createRuntimeBadge } from './identity-marks.mjs';
import { distinguishingRootTags } from './instance-tree.mjs';
import { createChoicePopup as popup } from './choice-popup.mjs';

export const spawnDialogCSS = `
.spawn-modal .spawn-dialog { width:860px; max-width:100%; box-sizing:border-box; max-height:calc(100vh - 48px); padding:0; gap:0; overflow:hidden; }
.spawn-modal .spawn-dialog-head { min-height:52px; flex:none; align-items:center; padding:0 12px 0 20px; border-bottom:1px solid var(--border); }
.spawn-modal .spawn-dialog-head h2 { flex:none; font-size:15px; font-weight:700; }
.spawn-context { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--muted); font-size:12px; }
.spawn-launch-label { margin-left:auto; display:flex; align-items:center; gap:6px; color:var(--muted); font-size:11.5px; }
.spawn-dialog .spawn-launch-label select { min-height:26px; height:26px; max-width:170px; padding:0 6px; font-size:11.5px; }
.spawn-dialog .close-act { flex:none; margin-left:0; }
.spawn-columns { display:grid; grid-template-columns:320px minmax(0,1fr); height:calc(100vh - 100px); max-height:720px; min-height:0; overflow:hidden; }
.spawn-chooser { border-right:1px solid var(--border); min-width:0; min-height:0; overflow:auto; padding:12px 8px; }
.spawn-search-label { display:flex; align-items:center; gap:6px; margin:0 4px 6px; }
.spawn-search-label input { min-width:0; flex:1; }
.spawn-search-count { flex:none; color:var(--muted); font:10.5px var(--mono,monospace); }
.spawn-chooser h3 { margin:8px 8px 3px; font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); overflow-wrap:anywhere; }
.spawn-choice { width:100%; min-height:56px; display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid transparent; border-radius:8px; text-align:left; background:var(--surface); color:var(--fg); font:inherit; cursor:pointer; }
.spawn-choice[aria-pressed=true] { background:var(--sel); border-color:var(--accent); }
.spawn-choice:disabled { color:var(--muted); cursor:default; }
.spawn-choice-copy { min-width:0; display:flex; flex:1; flex-direction:column; gap:1px; }
.spawn-choice strong { font-size:12.5px; overflow-wrap:anywhere; }
.spawn-choice small { font-size:11px; line-height:1.5; color:var(--muted); overflow-wrap:anywhere; }
.spawn-choice .identity-mark { flex:none; width:30px; height:30px; border-radius:8px; }
.spawn-dialog .soul-form { min-width:0; min-height:520px; overflow:auto; margin:0; padding:16px 20px 12px; gap:14px; box-sizing:border-box; }
.spawn-provider-row, .spawn-work-row { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.spawn-dialog .soul-form label { font-size:11.5px; font-weight:650; gap:5px; min-width:0; }
.spawn-dialog .soul-form .field { min-width:0; width:100%; box-sizing:border-box; }
.spawn-dialog .ftask { min-height:80px; resize:vertical; }
.spawn-default-note, .spawn-seam-note, .spawn-launch-status, .spawn-config-status, .spawn-observation-note { color:var(--muted); font-size:11px; line-height:1.5; overflow-wrap:anywhere; }
.spawn-launch-status { margin:0; }
.spawn-default-note:empty, .spawn-launch-status:empty, .spawn-config-status:empty { display:none; }
.spawn-future-toggles { display:flex; gap:12px; flex-wrap:wrap; }
.spawn-dialog .spawn-future-toggles label { display:flex; flex-direction:row; align-items:center; flex-wrap:wrap; }
.spawn-future-toggles small { width:100%; color:var(--muted); font-weight:400; }
.spawn-dialog .spawn-more { border-top:1px solid var(--border); padding-top:10px; }
.spawn-more summary { cursor:pointer; font-size:12px; font-weight:650; }
.spawn-more-body { display:flex; flex-direction:column; gap:10px; padding-top:10px; }
.spawn-dialog .spawn-footer { margin-top:auto; border-top:1px solid var(--border); padding-top:12px; flex-wrap:wrap; }
.spawn-readiness { display:flex; gap:4px 10px; flex-wrap:wrap; flex:1 1 100%; color:var(--muted); font-size:11.5px; }
.spawn-readiness-label { font-weight:650; }
.spawn-footer .fcancel { margin-left:auto; }
.spawn-footer .fspawn::after { content:attr(data-shortcut); margin-left:8px; font:10.5px var(--mono,monospace); }
.spawn-dialog .fstatus { flex-basis:100%; overflow-wrap:anywhere; }
.spawn-choice-popover { position:relative; min-width:0; }
.spawn-choice-trigger { width:100%; min-height:36px; border:1px solid var(--border); border-radius:7px; background:var(--surface); color:var(--fg); font:600 12.5px var(--sans,system-ui); text-align:left; padding:0 10px; display:flex; align-items:center; gap:8px; cursor:pointer; }
.spawn-choice-trigger::after { content:'⌄'; margin-left:auto; color:var(--muted); }
.spawn-choice-trigger .identity-mark { width:20px; height:20px; border-radius:5px; flex:none; }
.spawn-choice-menu { position:absolute; left:0; top:calc(100% + 4px); width:min(300px,calc(100vw - 60px)); max-height:260px; overflow:auto; z-index:2; border:1px solid var(--border); border-radius:9px; padding:6px; box-shadow:var(--shadow-popover); background:var(--surface); }
.spawn-dialog .spawn-popup-search input.field { min-height:30px; height:30px; padding:0 8px; font-size:12px; }
.spawn-popup-search { position:sticky; top:0; z-index:1; background:var(--surface); padding:0 2px 6px; border-bottom:1px solid var(--border); margin-bottom:4px; }
.spawn-popup-group { padding:6px 8px 3px; font-size:10px; font-weight:650; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
.spawn-popup-status { padding:6px 8px; margin:0; color:var(--muted); font-size:11.5px; }
.spawn-popup-status:empty { display:none; }
.spawn-choice-menu button { width:100%; min-height:36px; border:0; border-radius:6px; background:var(--surface); color:var(--fg); text-align:left; padding:8px 9px; font:12.5px var(--sans,system-ui); cursor:pointer; }
.spawn-choice-menu button[aria-selected=true] { background:var(--sel); }
.spawn-choice-menu button:disabled { color:var(--muted); cursor:default; }
.spawn-choice-menu small { display:block; font-size:10.5px; color:var(--muted); }
.spawn-dialog :is(button,summary,input,textarea,select):focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.spawn-dialog [hidden] { display:none; }
.spawn-future-row { display:flex; gap:4px; min-width:0; }
.spawn-future-row button { flex:none; }
.spawn-dialog .spawn-future-row select { width:45%; }
.spawn-model-controls { display:flex; gap:4px; min-width:0; }
.spawn-model-controls .spawn-choice-popover { flex:none; }
.spawn-model-controls .spawn-choice-trigger { width:32px; padding:0 8px; }
.spawn-model-controls .spawn-choice-trigger::after { margin-left:0; }
.spawn-model-controls .spawn-choice-menu { left:auto; right:0; }
.spawn-native { margin-top:5px; }
.spawn-preview-details { font-size:11.5px; }
.spawn-preview-details pre { white-space:pre-wrap; overflow-wrap:anywhere; color:var(--fg); background:var(--surface-2); padding:8px; }
@media(max-height:650px) { .spawn-dialog .soul-form { min-height:0; } }
@media(max-width:760px) {
 .spawn-columns { grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(0,1fr); }
 .spawn-chooser { max-height:220px; overflow:auto; border-right:0; border-bottom:1px solid var(--border); }
 .spawn-dialog .spawn-dialog-head { flex-wrap:wrap; padding:8px 12px; gap:6px; }
 .spawn-dialog .soul-form { min-height:0; padding:14px; }
}
`;
const identity = soul => JSON.stringify([soul?.agentsRoot || '', soul?.name || '', soul?.server || '']);
const node = (doc, tag, text, cls) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };

export function composeSpawnDialog(modal, { soul, agents, workspace, choose, canChoose, query = '' }) {
  const doc = modal.ownerDocument, el = (tag, text, cls) => node(doc, tag, text, cls);
  const dialog = modal.querySelector('.spawn-dialog'), form = modal.querySelector('.soul-form'), header = modal.querySelector('.spawn-dialog-head');
  const close = header.querySelector('.fcancel-x'), title = header.querySelector('h2'); title.textContent = 'Spawn instance';
  const context = el('span', `in ${workspace?.name || workspace?.id || soul.repoName || 'current workspace'}`, 'spawn-context'); context.title = context.textContent;
  const selectionSummary = el('span', `Selected soul ${soul.name}, ${soul.agentsRoot}${soul.server ? ` on ${soul.server}` : ''}`, 'workspace-sr-only');
  selectionSummary.id = 'spawn-selection-summary'; dialog.setAttribute('aria-describedby', selectionSummary.id);
  const configLabel = el('label', 'Launch config', 'spawn-launch-label'), config = el('select', undefined, 'field launch-config-select');
  config.setAttribute('aria-label', 'Launch configuration');
  const defaultConfig = el('option', 'Use resolved defaults'); defaultConfig.value = ''; config.append(defaultConfig);
  const refreshConfigs = el('button', '↻', 'act spawn-config-refresh'); refreshConfigs.type = 'button'; refreshConfigs.setAttribute('aria-label', 'Refresh launch configurations');
  configLabel.append(config, refreshConfigs);
  header.replaceChildren(title, context, selectionSummary, configLabel, close);
  const columns = el('div', undefined, 'spawn-columns'), chooser = el('section', undefined, 'spawn-chooser'); chooser.setAttribute('aria-label', 'Choose a soul');
  const searchLabel = el('label', undefined, 'spawn-search-label'), search = el('input', undefined, 'field spawn-soul-search'), count = el('span', '', 'spawn-search-count');
  search.type = 'search'; search.autocomplete = 'off'; search.placeholder = 'Search souls…'; search.setAttribute('aria-label', 'Search souls to spawn'); search.value = query;
  searchLabel.append(search, count); const list = el('div', undefined, 'spawn-soul-choices');
  const empty = el('p', '', 'spawn-chooser-empty spawn-seam-note'); empty.setAttribute('role', 'status');
  chooser.append(searchLabel, list, empty);
  const rows = [];
  const groups = new Map();
  for (const candidate of agents) {
    const key = JSON.stringify([candidate.agentsRoot || '', candidate.server || '']);
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(candidate);
  }
  const groupLabel = first => `${first.repoName || first.workspace || first.agentsRoot || 'Reported context'}${first.server ? ` · ${first.server}` : ''}`;
  const labels = [...groups.values()].map(group => groupLabel(group[0]));
  const rootTags = distinguishingRootTags([...groups.values()].map(group => group[0].agentsRoot).filter(Boolean));
  for (const group of groups.values()) {
    const first = group[0], groupEl = el('div'), label = groupLabel(first);
    const suffix = labels.filter(value => value === label).length > 1 ? ` · ${rootTags.get(first.agentsRoot) || first.agentsRoot || 'context unknown'}` : '';
    const heading = el('h3', label + suffix);
    heading.title = first.agentsRoot || ''; groupEl.append(heading);
    for (const candidate of group) {
      const row = el('button', undefined, 'spawn-choice'); row.type = 'button'; row.dataset.agent = candidate.name; row.dataset.root = candidate.agentsRoot || ''; row.dataset.server = candidate.server || '';
      row.disabled = !canChoose(candidate); row.tabIndex = -1; row.setAttribute('aria-pressed', String(identity(candidate) === identity(soul)));
      const copy = el('span', undefined, 'spawn-choice-copy'); copy.append(el('strong', candidate.name), el('small', candidate.work === 'attached' ? 'Attached only — cannot launch standalone' : candidate.description || candidate.agentsRoot || ''));
      row.append(createSoulMark(doc, candidate), copy);
      row.addEventListener('click', () => { if (!row.disabled && row.isConnected) choose(candidate, search.value); }); groupEl.append(row);
      rows.push({ row, group: groupEl, text: [candidate.name, candidate.description, candidate.agentsRoot, candidate.repoName, candidate.server].join('\n').toLowerCase() });
    }
    list.append(groupEl);
  }
  const filter = () => {
    let shown = 0;
    for (const entry of rows) { entry.row.hidden = !entry.text.includes(search.value.toLowerCase()); if (!entry.row.hidden) shown++; }
    for (const group of list.children) group.hidden = !rows.some(entry => entry.group === group && !entry.row.hidden);
    count.textContent = `${shown} of ${rows.length}`;
    empty.hidden = shown > 0; empty.textContent = shown ? '' : rows.length ? 'No souls match this filter.' : 'No souls reported for this chooser.';
    const visible = rows.filter(entry => !entry.row.hidden && !entry.row.disabled);
    const tabStop = visible.find(entry => entry.row === doc.activeElement) || visible.find(entry => entry.row.getAttribute('aria-pressed') === 'true') || visible[0];
    for (const entry of rows) entry.row.tabIndex = entry === tabStop ? 0 : -1;
  }; search.addEventListener('input', filter); filter();
  search.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' || event.isComposing || event.keyCode === 229) return;
    const entry = rows.find(entry => !entry.row.hidden && !entry.row.disabled && entry.row.tabIndex === 0);
    if (entry) { event.preventDefault(); event.stopPropagation(); entry.row.focus(); }
  });
  list.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.isComposing) return;
    const visible = rows.filter(entry => !entry.row.hidden && !entry.row.disabled).map(entry => entry.row), at = visible.indexOf(doc.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
    event.preventDefault(); event.stopPropagation();
    for (const row of visible) row.tabIndex = row === visible[next] ? 0 : -1;
    visible[next]?.focus();
  });
  columns.append(chooser, form); dialog.append(columns);
  const runtime = form.querySelector('.fruntime'), model = form.querySelector('.fmodel'), task = form.querySelector('.ftask');
  const runtimeLabel = runtime.closest('label'), modelLabel = model.closest('label'), taskLabel = task.closest('label');
  runtimeLabel.firstChild.textContent = 'Provider · runtime'; runtime.hidden = true; runtime.tabIndex = -1;
  modelLabel.firstChild.textContent = 'Model'; model.placeholder = 'Use resolved defaults';
  model.removeAttribute('list'); // one controlled popup: native datalist Enter must not bypass its consumption guard
  model.setAttribute('aria-label', 'Model override — empty uses resolved defaults');
  taskLabel.firstChild.textContent = 'Opening instruction · optional';
  const providerRow = el('div', undefined, 'spawn-provider-row'); providerRow.append(runtimeLabel, modelLabel);
  runtimeLabel.append(el('small', 'Local CLI support list only; execution-host installation and support are not inferred.', 'spawn-seam-note'));
  const modelControls = el('div', undefined, 'spawn-model-controls'); modelControls.append(model); modelLabel.append(modelControls);
  const defaultNote = el('p', 'Use resolved defaults. Preview reports the actual model and its source.', 'spawn-default-note');
  const native = el('button', 'Force native default — available after K6', 'act spawn-native'); native.type = 'button'; native.disabled = true; modelLabel.append(native);
  const future = el('div', undefined, 'spawn-work-row');
  for (const [label, note, branch] of [['Workspace / work-area name', 'Worktree path: available after K6', false], ['Base / new branch', 'Base revision and branch naming available after K6', true]]) {
    const field = el('label', label), input = el('input', undefined, 'field spawn-future'); input.disabled = true; input.placeholder = 'Available after K6';
    const row = el('span', undefined, 'spawn-future-row');
    if (branch) { const base = el('select', undefined, 'field spawn-base'); base.disabled = true; base.setAttribute('aria-label', 'Base branch — available after K6'); base.append(el('option', 'Base unknown')); row.append(base); }
    row.append(input);
    if (!branch) { const suggest = el('button', 'Suggest', 'act spawn-suggest'); suggest.type = 'button'; suggest.disabled = true; suggest.title = 'Available after K6'; row.append(suggest); }
    field.append(row, el('small', note, 'spawn-seam-note')); future.append(field);
  }
  const toggles = el('div', undefined, 'spawn-future-toggles');
  for (const [label, note] of [['Attach knowledge · node count unknown', 'Available after K6 + knowledge provider'], ['Allow child spawns', 'Enforced policy available after K6'], ['Open PR automatically', 'Available after K6 + Git provider']]) {
    const field = el('label'), input = el('input'); input.type = 'checkbox'; input.disabled = true; input.indeterminate = true;
    field.append(input, doc.createTextNode(label), el('small', note)); toggles.append(field);
  }
  const more = el('details', undefined, 'spawn-more'); more.open = true; more.append(el('summary', 'More options'));
  const moreBody = el('div', undefined, 'spawn-more-body'); more.append(moreBody);
  const footer = form.querySelector('.frow'); footer.classList.add('spawn-footer');
  const readiness = el('div', undefined, 'spawn-readiness'); readiness.setAttribute('role', 'status');
  readiness.append(el('span', 'Observed capabilities:', 'spawn-readiness-label'));
  for (const key of ['installed', 'trusted', 'configured', 'enrolled']) readiness.append(el('span', `${key}: unknown`, `spawn-${key}`));
  footer.prepend(readiness);
  footer.append(footer.querySelector('.fcancel'), footer.querySelector('.fspawn'), footer.querySelector('.fstatus'));
  const launchStatus = el('p', '', 'spawn-launch-status'); launchStatus.setAttribute('role', 'status');
  const configStatus = el('p', '', 'spawn-config-status'); configStatus.setAttribute('role', 'status');
  const preview = el('button', 'Preview invocation', 'act launch-preview'); preview.type = 'button';
  const previewDetails = el('details', undefined, 'spawn-preview-details'); previewDetails.hidden = true;
  previewDetails.append(el('summary', 'Invocation preview'), el('pre', '', 'launch-preview-output'));
  // Move every remaining legacy field into the expanded supplementary section.
  for (const child of [...form.children]) if (![footer, taskLabel].includes(child)) moreBody.append(child);
  form.replaceChildren(providerRow, defaultNote, configStatus, preview, launchStatus, previewDetails, future, taskLabel, toggles, more,
    el('p', 'Capability observations are not complete launch readiness. Configured and enrolled remain unknown.', 'spawn-observation-note'), footer);
  const providers = popup(doc, runtimeLabel, 'Choose provider', 'spawn-provider-choices', () => [...runtime.options].map(option => ({ value: option.value, label: option.textContent, disabled: option.disabled, selected: option.selected })), item => {
    runtime.value = item.value; runtime.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  });
  const models = popup(doc, modelControls, 'Model choices', 'spawn-model-choices', () => {
    const suggestions = [...form.querySelectorAll('datalist option')];
    return [
      { value: '', label: 'Use resolved defaults', selected: !model.value, group: 'Defaults', search: false },
      { label: 'Force native default — available after K6', disabled: true, group: 'Defaults', search: false },
      ...suggestions.map(option => ({ value: option.value, label: option.label || option.value,
        detail: option.label && option.label !== option.value ? option.value : undefined, selected: model.value === option.value, group: 'Reported suggestions' })),
      { custom: true, label: 'Custom entry…', detail: model.value || 'Type a model ID or preference list', group: 'Custom', search: false,
        selected: !!model.value && !suggestions.some(option => option.value === model.value) },
    ];
  }, item => { if (!item.custom) { model.value = item.value; model.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true })); } model.focus(); }, {
    searchable: true, scope: () => JSON.stringify([runtime.value, form.querySelector('.fserver')?.value || '']),
    nothingReported: 'No model suggestions reported. Custom model text is still accepted.', noMatch: 'No reported model suggestions match this filter.',
  });
  models.trigger.textContent = ''; models.trigger.setAttribute('aria-label', 'Choose model');
  model.addEventListener('change', models.refresh);
  const syncRuntime = () => {
    providers.trigger.replaceChildren();
    if (runtime.value) providers.trigger.append(createRuntimeBadge(doc, runtime.value));
    const label = runtime.selectedOptions[0]?.textContent || 'Use resolved defaults';
    providers.trigger.append(doc.createTextNode(label)); providers.trigger.setAttribute('aria-label', `Provider: ${label}`);
  }; runtime.addEventListener('change', syncRuntime); syncRuntime();
  return { config, refreshConfigs, configStatus, moreBody, search, defaultNote, launchStatus, preview, previewDetails, readiness,
    syncRuntime, refreshChoices() { providers.refresh(); models.refresh(); }, closePopups() { providers.close(); models.close(); },
    dispose() { providers.dispose(); models.dispose(); model.removeEventListener('change', models.refresh); runtime.removeEventListener('change', syncRuntime); },
  };
}
