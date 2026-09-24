/** On-demand kernel inspection. Roster polling never replaces an editor. */
import { postJson, wsQuery, workspaceGeneration } from './views/common.mjs';
import { runtimeState } from './instance-presentation.mjs';
import { createSoulMark } from './identity-marks.mjs';
import { declarationsCSS, renderSoulDeclarations } from './soul-declarations.mjs';
import { createReadinessView, readinessCSS } from './readiness-view.mjs';
import { cliStatus } from './views/cli-status.mjs';
import { iconElement } from './shell-icons.mjs';


/* Operations-API capability facts for the soul inspector (replaced with the
   v2 instance card in F3/F4). */
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export function reportedText(value, fallback = 'Not reported') {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
export function capabilityFacts(cap) {
  cap = record(cap);
  const health = record(cap.health), activation = record(cap.activation);
  return [
    ['Installation', health.installed === true ? 'Installed' : health.installed === false ? 'Not installed' : 'Not reported'],
    ['Health', reportedText(health.status)],
    ['Trust', health.trusted === true ? 'Trusted' : health.trusted === false ? 'Not trusted' : 'Not reported'],
    ['Activation', activation.enabled === true ? 'Enabled' : activation.enabled === false ? 'Disabled' : 'Not reported'],
    ...(activation.target ? [['Target', reportedText(activation.target)]] : []),
    ...(activation.provenance ? [['Binding', reportedText(activation.provenance)]] : []),
  ];
}

export const inspectorCSS = `
${declarationsCSS}
${readinessCSS}
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
.inspector-head { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:16px; }
.inspector-head h2 { flex:1; margin:0; font-size:19px; overflow-wrap:anywhere; }
.inspector-content { min-width:0; overflow-wrap:anywhere; }
.inspector-content .field { min-width:0; max-width:100%; box-sizing:border-box; }
.inspector-content h3 { margin:18px 0 8px; font-size:10.5px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; }
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
.inspector-form { display:grid; gap:12px; max-width:650px; }
.inspector-form label { display:grid; gap:5px; font-size:13px; color:var(--muted); }
.inspector-form textarea { width:100%; min-height:250px; box-sizing:border-box; font:13px/1.6 monospace; }
.inspector-status { min-height:1.5em; font-size:13px; color:var(--muted); white-space:pre-wrap; }
.inspector-status:empty { min-height:0; margin:0; }
.inspector-status.error { color:var(--danger); }
@container(max-width:700px) {
 .souls-body, .souls-body.inspecting { display:block; overflow:auto; }
 .workspace-main { height:auto; }
 .workspace-main > .souls-grid, .workspace-main > .workspace-discovery { flex:none; overflow:visible; }
 .soul-inspector { width:100%; max-width:none; overflow:visible; border-left:0; border-top:1px solid var(--border); }
}
`;

/** presentation is an optional host lease. Presence belongs to this controller;
 * effective visibility/collapse belongs to the host, not request completions. */
export function createSoulInspector(container, { ctx, presentation, launch, schedule, files, canFiles = () => false, canLaunch = () => true, launchReason = () => 'Requires a compatible installed OATS CLI.', available = () => true, instances = () => [], workspace = () => null, changed, closed }) {
  const doc = container.ownerDocument;
  let alive = true, serial = 0, operationSerial = 0, selectionGen = null, selection, data, busy = false;
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
  let status, content, summary, readiness;
  function syncReadiness() {
    const w = workspace();
    const ref = selection?.instance;
    const selector = ref ? { kind: 'instance', instance: ref.instance, agent: ref.agent, agentsRoot: ref.agentsRoot, server: ref.server ?? null }
      : selection?.agent ? { kind: 'soul', soul: selection.agent.name, agentsRoot: selection.agent.agentsRoot }
        : { kind: 'scope', context: selection?.selector?.context || w?.scope };
    readiness?.update({ active: !!selection && selectionGen === workspaceGeneration(), workspace: w, selector, cli: cliStatus(), identity: ref?.createdAt });
  }
  function message(text, error = false) {
    if (!status) return; status.textContent = text; status.classList.toggle('error', error);
  }
  function frame(title) {
    container.hidden = false;
    if (presentation) presentation.setPresent(true);
    else container.parentElement?.classList.add('inspecting');
    readiness?.dispose(); readiness = null; container.replaceChildren();
    const head = node('div', undefined, 'inspector-head');
    // Hosted X hides the slot without deselecting or rebuilding an editor.
    const closeControl = button('', () => {
      if (!alive) return;
      if (presentation) presentation.collapse();
      else close({ restoreFocus: true });
    });
    closeControl.classList.add('icon-act'); closeControl.append(iconElement(doc, 'close', { size: 14 }));
    closeControl.setAttribute('aria-label', 'Close inspector');
    const heading = node('h2', title); heading.title = title;
    if (selection.agent) head.append(createSoulMark(doc, selection.agent));
    head.append(heading, button('Refresh', () => show(selection)), closeControl);
    summary = node('div', undefined, 'inspector-summary');
    if (selection.contexts?.length > 1) {
      const scopes = node('select'); scopes.className = 'field'; scopes.setAttribute('aria-label', 'Capability configuration scope');
      for (const scope of selection.contexts) { const option = node('option', scope.label); option.value = scope.context || ''; scopes.append(option); }
      scopes.value = selection.selector.context || '';
      scopes.addEventListener('change', () => show({ contexts: selection.contexts, selector: scopes.value ? { context: scopes.value } : {} })); summary.append(scopes);
    }
    status = node('p', '', 'inspector-status'); status.setAttribute('role', 'status');
    content = node('div', undefined, 'inspector-content'); container.append(head, summary, status, content);
    const readinessHost = node('div', undefined, 'inspector-content'); container.append(readinessHost);
    readiness = createReadinessView(readinessHost, { ctx }); syncReadiness();
    if (selection.agent) renderSelectedSoul();
  }
  // Resets are silent by default: workspace/subtab/disposal must not focus an
  // obsolete or hidden card. Only an explicit standalone X restores focus.
  function close({ restoreFocus = false } = {}) {
    if (alive) reset(restoreFocus);
  }
  function reset(restoreFocus = false) {
    serial++; selection = null; selectionGen = null; data = null; busy = false; container.hidden = true;
    readiness?.dispose(); readiness = null;
    container.replaceChildren();
    if (presentation) presentation.setPresent(false);
    else container.parentElement?.classList.remove('inspecting');
    closed?.({ restoreFocus: !presentation && restoreFocus });
  }
  async function show(next) {
    if (!next || !alive) return;
    selection = next; const id = ++serial, gen = workspaceGeneration(); selectionGen = gen; data = null; busy = false;
    frame(next.agent?.name || next.instance?.instance || 'Reported capabilities'); message('Loading…');
    if (!available()) { message('Capability inspection requires a compatible OATS CLI with operations support. Check the CLI and refresh.', true); return; }
    try {
      const result = await request({ action: 'inspect', selector: next.selector });
      if (!valid(id, gen)) return;
      data = result; message(''); render();
    } catch (error) { if (valid(id, gen)) message(`${error.code ? `${error.code}: ` : ''}${error.message || 'Inspection failed. Refresh to retry.'}`, true); }
  }
  async function mutate(body) {
    if (busy || !available() || !selection || selectionGen !== workspaceGeneration()) return;
    operationSerial++;
    busy = true; const id = serial, gen = workspaceGeneration(), target = selection, query = wsQuery();
    content.querySelectorAll('button, input, textarea, select').forEach(el => { el.disabled = true; });
    syncAvailability(); message('Saving…');
    let saved = false;
    try {
      const receipt = await request({ ...body, selector: target.selector }, query);
      saved = true;
      if (!valid(id, gen)) return;
      // Refresh only after this explicit write, never in the roster interval.
      const refreshed = await request({ action: 'inspect', selector: target.selector }, query);
      if (!valid(id, gen)) return;
      data = refreshed;
      busy = false; render(); syncAvailability(); message(`Saved${receipt.file ? ` to ${receipt.file}` : ''}. Future instances use these defaults; existing homes retain their snapshot.`);
      changed?.();
    } catch (error) {
      if (!valid(id, gen)) return;
      busy = false; content.querySelectorAll('button, input, textarea, select').forEach(el => { el.disabled = false; });
      syncAvailability();
      message(saved ? `Saved, but refreshing failed: ${error.message}. Refresh to see the new state.` : error.message, true);
    }
  }
  function facts(entries, parent = content) {
    const dl = node('dl', undefined, 'inspector-facts');
    for (const [key, value] of entries) dl.append(node('dt', key), node('dd', value === undefined || value === null || value === '' ? '—' : String(value)));
    parent.append(dl);
  }
  function render() {
    operationSerial++;
    content.replaceChildren();
    if (!data || data.operationsApi !== 1) { message('This CLI does not support capability inspection. Update OATS and refresh.', true); return; }
    for (const problem of data.problems || []) content.append(node('p', `${problem.code}: ${problem.message}`));
    const snapshot = data.selected?.source === 'snapshot';
    content.append(node('p', snapshot ? 'Instance snapshot: the instructions and capabilities this home was created with.' : 'Saved configuration for future instances. Changes here do not rewrite existing agent homes.', 'muted'));
    facts([['Scope', data.scope?.context], ['Source', snapshot ? 'Instance snapshot' : selection.agent ? `Soul: ${selection.agent.name}` : 'Workspace defaults']]);
    const matches = selection.agent ? (Array.isArray(data.souls) ? data.souls : []).filter(s => s?.name === selection.agent.name && s?.agentsRoot === selection.agent.agentsRoot) : [];
    const soul = matches.length === 1 ? matches[0] : null;
    if (snapshot) summary.replaceChildren();
    if (soul && !snapshot) renderSoul(soul);
    else if (selection.agent && !snapshot) content.append(node('p', 'The selected soul was not reported at this scope. Refresh to retry.', 'muted'));
    if (snapshot) {
      content.append(node('h3', 'AGENTS.md / instructions'));
      content.append(node('pre', data.snapshot?.instructions?.error || data.snapshot?.instructions?.text || 'No instructions reported.'));
      if (data.snapshot?.drift?.length) {
        content.append(node('h3', 'Configuration changes since creation'), node('pre', JSON.stringify(data.snapshot.drift, null, 2)));
      }
    }
    renderCapabilities(snapshot);
    if (snapshot || selection.agent) renderOperations();
  }
  // Roster-owned actions do not depend on operationsApi, inspect success, or
  // an editable soul record. Keep their DOM stable while inspection settles.
  function renderSelectedSoul() {
    const agent = selection.agent, id = serial, gen = selectionGen;
    const actions = node('div', undefined, 'inspector-actions');
    const action = (label, cls, can, run) => {
      const control = button(label, () => {
        if (valid(id, gen) && control.isConnected && !control.disabled && !busy && can(agent)) run?.(agent);
      });
      control.classList.add(cls); return control;
    };
    const launchButton = action('Launch…', 'spawn-act', canLaunch, launch); launchButton.classList.add('primary'); launchButton.dataset.launch = '1';
    const scheduleButton = action('Schedule…', 'schedule-act', canLaunch, schedule); scheduleButton.dataset.launch = '1';
    const filesButton = action('Files', 'brain-act', canFiles, files); filesButton.dataset.files = '1';
    actions.append(launchButton, filesButton, scheduleButton);
    summary.append(actions); syncAvailability();
    const homes = instances(agent);
    const roster = node('div', undefined, 'inspector-content');
    facts([['Reported runtime', agent.runtime], ['Source', agent.repoName || agent.workspace], ['Description', agent.description]], roster);
    roster.append(node('h3', `Instances · ${homes.length}`));
    if (!homes.length) roster.append(node('p', 'No instances reported for this soul.', 'muted'));
    for (const instance of homes) {
      const control = button(`${instance.instance} · ${runtimeState(instance)}`, () => {
        if (valid(id, gen) && control.isConnected) void show({ instance, selector: { home: instance.home } });
      });
      control.classList.add('inspector-instance'); control.disabled = !instance.home;
      control.title = instance.home ? 'Inspect the immutable instance snapshot' : 'No instance home reported';
      roster.append(control);
    }
    summary.append(roster);
  }
  function renderSoul(soul) {
    renderSoulDeclarations(content, soul);
    content.append(node('h3', 'Future-instance defaults'));
    facts([['Runtime', soul.runtime], ['Launch configuration', soul.launchConfig || 'None'], ['Model', soul.model || 'Runtime default'], ['Permissions', soul.yolo === null || soul.yolo === undefined ? 'Scope default' : soul.yolo ? 'YOLO enabled' : 'Ask for permission'], ['Session backend', soul.backend], ['Description', soul.description]]);
    const editable = soul.editable || {};
    if (editable.fields?.length) content.append(button('Edit defaults', () => editDefaults(soul)));
    else if (editable.reason) content.append(node('p', editable.reason, 'muted'));
    const instructions = node('details'); instructions.append(node('summary', 'AGENTS.md / instructions'), node('pre', soul.instructions?.error || soul.instructions?.text || 'No instructions reported.'));
    content.append(instructions);
    if (soul.instructions?.truncated) content.append(node('p', 'Instructions are truncated. Edit the source file to preserve the full document.', 'muted'));
    if (editable.instructions && !soul.instructions?.truncated && !soul.instructions?.error) content.append(button('Edit instructions', () => editInstructions(soul)));
  }
  function field(form, label, key, value, choices) {
    const wrap = node('label', label); const input = node(choices ? 'select' : 'input'); input.className = 'field'; input.name = key;
    if (choices) for (const [val, text] of choices) { const option = node('option', text); option.value = val; input.append(option); }
    input.value = value ?? ''; wrap.append(input); form.append(wrap); return input;
  }
  function editor(title) {
    operationSerial++;
    content.replaceChildren(node('h3', title)); const form = node('form', undefined, 'inspector-form'); content.append(form); return form;
  }
  function editDefaults(soul) {
    const form = editor('Edit launch defaults'); const inputs = {};
    // The inspect JSON uses camelCase; mutations use the CLI field names.
    const valueOf = key => key === 'launch-config' ? soul.launchConfig : soul[key];
    for (const key of ['runtime', 'launch-config', 'model', 'backend', 'yolo', 'description']) {
      if (!soul.editable.fields.includes(key)) continue;
      const options = key === 'runtime' ? ['pi', 'claude', 'codex'].map(x => [x, x]) : key === 'backend' ? ['tmux', 'herdr'].map(x => [x, x]) : key === 'yolo' ? [...(soul.yolo === null || soul.yolo === undefined ? [['', 'Scope default']] : []), ['false', 'Ask for permission'], ['true', 'YOLO — skip permission prompts']] : null;
      inputs[key] = field(form, key === 'yolo' ? 'Permissions' : key === 'launch-config' ? 'Launch configuration' : key[0].toUpperCase() + key.slice(1), key, key === 'yolo' ? valueOf(key) == null ? '' : String(valueOf(key)) : valueOf(key), options);
    }
    form.append(node('p', 'Leave Model empty to use the runtime default. Changes apply when creating future instances.', 'muted'));
    const save = mutationButton('Save defaults', () => form.requestSubmit()); form.append(save, button('Cancel', render));
    form.addEventListener('submit', event => {
      event.preventDefault(); const fields = {};
      for (const [key, input] of Object.entries(inputs)) {
        if (key === 'yolo' && input.value === '') continue;
        const value = key === 'yolo' ? input.value === 'true' : input.value;
        if (value !== (key === 'yolo' ? valueOf(key) : valueOf(key) ?? '')) fields[key] = value;
      }
      if (!Object.keys(fields).length) { render(); return; }
      void mutate({ action: 'set', fields });
    });
  }
  function editInstructions(soul) {
    const form = editor('Edit instructions'); const text = node('textarea'); text.className = 'field'; text.setAttribute('aria-label', 'Soul instructions'); text.value = soul.instructions?.text || '';
    form.append(text, mutationButton('Save instructions', () => form.requestSubmit()), button('Cancel', render));
    form.addEventListener('submit', event => { event.preventDefault(); void mutate({ action: 'set', fields: { instructions: text.value } }); });
  }
  function renderCapabilities(snapshot) {
    content.append(node('h3', 'Effective providers'));
    facts(['knowledge', 'messaging', 'tasks'].map(layer => [layer[0].toUpperCase() + layer.slice(1), data.layers?.[layer] === undefined ? 'Not reported' : data.layers[layer]?.id || (data.layers[layer]?.disabled ? 'Disabled' : 'None configured')]));
    if (!snapshot && !selection.agent) {
      const actions = node('details'); actions.append(node('summary', 'Layer defaults'));
      for (const layer of ['knowledge', 'messaging', 'tasks']) {
        const row = node('div', undefined, 'inspector-actions'); row.append(node('span', layer));
        row.append(mutationButton('Disable layer', () => mutate({ action: 'use', binding: { action: 'none', layer } })),
          mutationButton('Inherit layer', () => mutate({ action: 'use', binding: { action: 'inherit', capability: data.layers?.[layer]?.id || 'none', layer } })));
        actions.append(row);
      }
      content.append(actions);
    }
    content.append(node('h3', 'Reported capabilities'));
    if (!Array.isArray(data.capabilities)) content.append(node('p', 'Reported capabilities are unavailable from this CLI.'));
    else if (!data.capabilities.length) content.append(node('p', 'No capabilities reported at this scope.'));
    for (const cap of (Array.isArray(data.capabilities) ? data.capabilities : []).filter(cap => cap && typeof cap === "object")) {
      const card = node('section', undefined, 'inspector-cap'); card.append(node('h4', cap.id));
      const activation = cap.activation || {}, health = cap.health || {};
      facts([['Version', cap.version], ['Source', reportedText(cap.source)], ['Origin', reportedText(cap.origin)], ...capabilityFacts(cap)], card);
      if (health.detail) card.append(node('p', health.detail));
      if (health.problems?.length) card.append(node('p', health.problems.join('\n')));
      if (Object.keys(activation.settings || {}).length) {
        const settings = node('details'); settings.append(node('summary', 'Effective settings'), node('pre', JSON.stringify(activation.settings, null, 2))); card.append(settings);
      }
      if (!snapshot) {
        const actions = node('div', undefined, 'inspector-actions');
        for (const [action, label] of [['enable', cap.layer ? `Use for ${cap.layer}` : 'Enable'], ['disable', 'Disable here'], ['inherit', 'Inherit']]) {
          actions.append(mutationButton(label, () => mutate({ action: 'use', binding: { capability: cap.id, action } })));
        }
        card.append(actions);
      }
      content.append(card);
    }
    if (!snapshot) content.append(node('p', '“Inherit” removes the binding at this scope. “Disable here” explicitly excludes that capability. Installing a capability does not activate it.', 'muted'));
  }
  function renderOperations() {
    const id = serial, gen = selectionGen;
    content.append(node('h3', 'Provider operations'));
    const providers = (Array.isArray(data.capabilities) ? data.capabilities : []).filter(cap => cap?.layer && cap.activation?.enabled);
    let count = 0;
    for (const provider of providers) for (const operation of provider.operations || []) {
      count++; const row = node('div', undefined, 'inspector-cap');
      row.append(node('h4', `${provider.layer}: ${operation.name}`), node('p', operation.description || provider.id, 'muted'));
      if (!operation.available || operation.args?.some(arg => arg.required)) row.append(node('p', operation.reason || 'This operation requires arguments; run it with the OATS CLI.', 'muted'));
      else {
        const address = `${provider.layer}:${operation.name}`;
        const control = mutationButton(operation.kind === 'view' ? 'View' : 'Run', async () => {
          if (busy || !available() || !valid(id, gen) || !control.isConnected || !content.contains(control) || pendingOperations.has(control)) return;
          const op = ++operationSerial; pendingOperations.set(control, op); control.disabled = true;
          // Output/status follow latest intent; each pending control owns only its lock.
          const ownsControl = () => valid(id, gen) && control.isConnected && content.contains(control) && pendingOperations.get(control) === op;
          const owns = () => ownsControl() && op === operationSerial;
          message(`Running ${address}…`);
          try {
            const result = await request({ action: 'run', selector: selection.selector, operation: address });
            if (!owns()) return;
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
    syncReadiness();
    if (!selection || !content) return;
    for (const control of content.querySelectorAll('[data-mutate]')) control.disabled = busy || pendingOperations.has(control) || !available() || selectionGen !== workspaceGeneration();
    for (const control of container.querySelectorAll('[data-launch]')) {
      control.disabled = busy || !alive || selectionGen !== workspaceGeneration() || !canLaunch(selection.agent) || selection.agent?.work === 'attached' || !selection.agent?.agentsRoot;
      control.title = selection.agent?.work === 'attached' ? 'Attached only — requires an owning instance.' : control.disabled ? launchReason(selection.agent) : '';
    }
    for (const control of container.querySelectorAll('[data-files]')) {
      control.disabled = busy || !alive || selectionGen !== workspaceGeneration() || !canFiles(selection.agent);
      control.title = control.disabled ? 'Files need an unambiguous local soul in this workspace.' : 'Read-only soul files';
    }
  }
  return { show, close, syncAvailability,
    focusLaunch(agent) {
      const selected = selection?.agent;
      if (!alive || container.hidden || (presentation && !presentation.isVisible())
        || selectionGen !== workspaceGeneration() || !selected || selected.name !== agent.name
        || (selected.agentsRoot || '') !== (agent.agentsRoot || '') || (selected.server || '') !== (agent.server || '')) return false;
      const control = summary?.querySelector('.spawn-act:not([disabled])');
      if (!control?.isConnected || control.closest('[hidden], [inert]')) return false;
      control.focus(); return true;
    },
    dispose() { if (!alive) return; alive = false; reset(); } };
}
