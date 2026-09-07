/** On-demand kernel inspection. Roster polling never replaces an editor. */
import { postJson, wsQuery, workspaceGeneration } from './views/common.mjs';

export const inspectorCSS = `
.souls-body { display:flex; flex:1; min-height:0; }
.souls-body.inspecting > .souls-grid { flex:0 0 310px; grid-template-columns:minmax(0,1fr); padding:12px; }
.soul-inspector { flex:1; min-width:0; overflow:auto; padding:22px; border-left:1px solid var(--border); }
.soul-inspector[hidden] { display:none; }
.inspector-head { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:16px; }
.inspector-head h2 { flex:1; margin:0; font-size:19px; overflow-wrap:anywhere; }
.inspector-content { max-width:900px; }
.inspector-content h3 { margin:22px 0 10px; font-size:15px; }
.inspector-content p { line-height:1.5; }
.inspector-content .muted { color:var(--muted); }
.inspector-content pre { white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.6 var(--mono,monospace); }
.inspector-facts { display:grid; grid-template-columns:max-content minmax(0,1fr); gap:8px 18px; font-size:13px; }
.inspector-facts dt { color:var(--muted); }
.inspector-facts dd { margin:0; overflow-wrap:anywhere; }
.inspector-cap { padding:14px 0; border-top:1px solid var(--border); }
.inspector-cap h4 { margin:0 0 7px; font-size:14px; }
.inspector-actions { display:flex; gap:8px; flex-wrap:wrap; margin:10px 0; }
.inspector-form { display:grid; gap:12px; max-width:650px; }
.inspector-form label { display:grid; gap:5px; font-size:13px; color:var(--muted); }
.inspector-form textarea { width:100%; min-height:250px; box-sizing:border-box; font:13px/1.6 monospace; }
.inspector-status { min-height:1.5em; font-size:13px; color:var(--muted); white-space:pre-wrap; }
.inspector-status:empty { min-height:0; margin:0; }
.inspector-status.error { color:var(--danger); }
@media(max-width:850px) { .souls-body.inspecting > .souls-grid { display:none; } .soul-inspector { border-left:0; padding:16px; } }
`;

export function createSoulInspector(container, { ctx, launch, schedule, changed, closed }) {
  const doc = container.ownerDocument;
  let alive = true, serial = 0, selection, data, busy = false;
  const node = (tag, text, cls) => {
    const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el;
  };
  const button = (text, run) => {
    const b = node('button', text, 'act'); b.type = 'button'; b.addEventListener('click', run); return b;
  };
  const request = (body, query = wsQuery()) => postJson(ctx, `/api/capabilities${query}`, body);
  const valid = (id, gen) => alive && id === serial && gen === workspaceGeneration();
  let status, content;
  function message(text, error = false) {
    if (!status) return; status.textContent = text; status.classList.toggle('error', error);
  }
  function frame(title) {
    container.hidden = false; container.parentElement.classList.add('inspecting'); container.replaceChildren();
    const head = node('div', undefined, 'inspector-head');
    head.append(button('Back', close), node('h2', title), button('Refresh', () => show(selection)));
    if (selection.contexts?.length > 1) {
      const scopes = node('select'); scopes.className = 'field'; scopes.setAttribute('aria-label', 'Capability configuration scope');
      for (const scope of selection.contexts) { const option = node('option', scope.label); option.value = scope.context || ''; scopes.append(option); }
      scopes.value = selection.selector.context || '';
      scopes.addEventListener('change', () => show({ contexts: selection.contexts, selector: scopes.value ? { context: scopes.value } : {} })); head.append(scopes);
    }
    status = node('p', '', 'inspector-status'); status.setAttribute('role', 'status');
    content = node('div', undefined, 'inspector-content'); container.append(head, status, content);
  }
  function close() {
    serial++; selection = null; data = null; busy = false; container.hidden = true;
    container.replaceChildren(); container.parentElement.classList.remove('inspecting'); closed?.();
  }
  async function show(next) {
    if (!next || !alive) return;
    selection = next; const id = ++serial, gen = workspaceGeneration(); busy = false;
    frame(next.agent?.name || next.instance?.instance || 'Capabilities'); message('Loading…');
    try {
      const result = await request({ action: 'inspect', selector: next.selector });
      if (!valid(id, gen)) return;
      data = result; render(); message('');
    } catch (error) { if (valid(id, gen)) message(error.message, true); }
  }
  async function mutate(body) {
    if (busy) return;
    busy = true; const id = serial, gen = workspaceGeneration(), target = selection, query = wsQuery();
    content.querySelectorAll('button, input, textarea, select').forEach(el => { el.disabled = true; });
    message('Saving…');
    let saved = false;
    try {
      const receipt = await request({ ...body, selector: target.selector }, query);
      saved = true;
      if (!valid(id, gen)) return;
      // Refresh only after this explicit write, never in the roster interval.
      data = await request({ action: 'inspect', selector: target.selector }, query);
      if (!valid(id, gen)) return;
      busy = false; render(); message(`Saved${receipt.file ? ` to ${receipt.file}` : ''}. Future instances use these defaults; existing homes retain their snapshot.`);
      changed?.();
    } catch (error) {
      if (!valid(id, gen)) return;
      busy = false; content.querySelectorAll('button, input, textarea, select').forEach(el => { el.disabled = false; });
      message(saved ? `Saved, but refreshing failed: ${error.message}. Refresh to see the new state.` : error.message, true);
    }
  }
  function facts(entries, parent = content) {
    const dl = node('dl', undefined, 'inspector-facts');
    for (const [key, value] of entries) dl.append(node('dt', key), node('dd', value === undefined || value === null || value === '' ? '—' : String(value)));
    parent.append(dl);
  }
  function render() {
    content.replaceChildren();
    if (!data || data.operationsApi !== 1) { message('This CLI does not support capability inspection. Update OATS and refresh.', true); return; }
    for (const problem of data.problems || []) content.append(node('p', `${problem.code}: ${problem.message}`));
    const snapshot = data.selected?.source === 'snapshot';
    content.append(node('p', snapshot ? 'Instance snapshot: the instructions and capabilities this home was created with.' : 'Saved configuration for future instances. Changes here do not rewrite existing agent homes.', 'muted'));
    facts([['Scope', data.scope?.context], ['Source', snapshot ? 'Instance snapshot' : selection.agent ? `Soul: ${selection.agent.name}` : 'Workspace defaults']]);
    const soul = data.souls?.find(s => s.name === selection.agent?.name && s.agentsRoot === selection.agent?.agentsRoot) || (selection.agent && data.souls?.length === 1 ? data.souls[0] : null);
    if (soul && !snapshot) renderSoul(soul);
    if (snapshot) {
      content.append(node('h3', 'Instructions'));
      content.append(node('pre', data.snapshot?.instructions?.text || 'No instructions reported.'));
      if (data.snapshot?.drift?.length) {
        content.append(node('h3', 'Configuration changes since creation'), node('pre', JSON.stringify(data.snapshot.drift, null, 2)));
      }
    }
    renderCapabilities(snapshot);
    if (snapshot || selection.agent) renderOperations();
  }
  function renderSoul(soul) {
    const actions = node('div', undefined, 'inspector-actions');
    if (selection.agent.work !== 'attached') actions.append(button('Launch…', () => launch?.(selection.agent)), button('Schedule…', () => schedule?.(selection.agent)));
    content.append(actions, node('h3', 'Launch defaults'));
    facts([['Runtime', soul.runtime], ['Model', soul.model || 'Runtime default'], ['Permissions', soul.yolo === null || soul.yolo === undefined ? 'Scope default' : soul.yolo ? 'YOLO enabled' : 'Ask for permission'], ['Session backend', soul.backend], ['Description', soul.description]]);
    const editable = soul.editable || {};
    if (editable.fields?.length) content.append(button('Edit defaults', () => editDefaults(soul)));
    else if (editable.reason) content.append(node('p', editable.reason, 'muted'));
    const instructions = node('details'); instructions.append(node('summary', 'Instructions'), node('pre', soul.instructions?.text || 'No instructions reported.'));
    content.append(instructions);
    if (soul.instructions?.truncated) content.append(node('p', 'Instructions are truncated. Edit the source file to preserve the full document.', 'muted'));
    if (editable.instructions && !soul.instructions?.truncated) content.append(button('Edit instructions', () => editInstructions(soul)));
  }
  function field(form, label, key, value, choices) {
    const wrap = node('label', label); const input = node(choices ? 'select' : 'input'); input.className = 'field'; input.name = key;
    if (choices) for (const [val, text] of choices) { const option = node('option', text); option.value = val; input.append(option); }
    input.value = value ?? ''; wrap.append(input); form.append(wrap); return input;
  }
  function editor(title) {
    content.replaceChildren(node('h3', title)); const form = node('form', undefined, 'inspector-form'); content.append(form); return form;
  }
  function editDefaults(soul) {
    const form = editor('Edit launch defaults'); const inputs = {};
    for (const key of ['runtime', 'model', 'backend', 'yolo', 'description']) {
      if (!soul.editable.fields.includes(key)) continue;
      const options = key === 'runtime' ? ['pi', 'claude', 'codex'].map(x => [x, x]) : key === 'backend' ? ['tmux', 'herdr'].map(x => [x, x]) : key === 'yolo' ? [...(soul.yolo === null || soul.yolo === undefined ? [['', 'Scope default']] : []), ['false', 'Ask for permission'], ['true', 'YOLO — skip permission prompts']] : null;
      inputs[key] = field(form, key === 'yolo' ? 'Permissions' : key[0].toUpperCase() + key.slice(1), key, key === 'yolo' ? soul[key] == null ? '' : String(soul[key]) : soul[key], options);
    }
    form.append(node('p', 'Leave Model empty to use the runtime default. Changes apply when creating future instances.', 'muted'));
    const save = button('Save defaults', () => form.requestSubmit()); form.append(save, button('Cancel', render));
    form.addEventListener('submit', event => {
      event.preventDefault(); const fields = {};
      for (const [key, input] of Object.entries(inputs)) {
        if (key === 'yolo' && input.value === '') continue;
        const value = key === 'yolo' ? input.value === 'true' : input.value;
        if (value !== (key === 'yolo' ? soul[key] : soul[key] ?? '')) fields[key] = value;
      }
      if (!Object.keys(fields).length) { render(); return; }
      void mutate({ action: 'set', fields });
    });
  }
  function editInstructions(soul) {
    const form = editor('Edit instructions'); const text = node('textarea'); text.className = 'field'; text.setAttribute('aria-label', 'Soul instructions'); text.value = soul.instructions?.text || '';
    form.append(text, button('Save instructions', () => form.requestSubmit()), button('Cancel', render));
    form.addEventListener('submit', event => { event.preventDefault(); void mutate({ action: 'set', fields: { instructions: text.value } }); });
  }
  function renderCapabilities(snapshot) {
    content.append(node('h3', 'Effective providers'));
    facts(['knowledge', 'messaging', 'tasks'].map(layer => [layer[0].toUpperCase() + layer.slice(1), data.layers?.[layer]?.id || (data.layers?.[layer]?.disabled ? 'Disabled' : 'None configured')]));
    if (!snapshot) {
      const actions = node('details'); actions.append(node('summary', 'Layer defaults'));
      for (const layer of ['knowledge', 'messaging', 'tasks']) {
        const row = node('div', undefined, 'inspector-actions'); row.append(node('span', layer));
        row.append(button('Disable layer', () => mutate({ action: 'use', binding: { action: 'none', layer } })),
          button('Inherit layer', () => mutate({ action: 'use', binding: { action: 'inherit', capability: data.layers?.[layer]?.id || 'none', layer } })));
        actions.append(row);
      }
      content.append(actions);
    }
    content.append(node('h3', 'Installed capabilities'));
    if (!data.capabilities?.length) content.append(node('p', 'No capabilities installed at this scope.'));
    for (const cap of data.capabilities || []) {
      const card = node('section', undefined, 'inspector-cap'); card.append(node('h4', cap.id));
      const activation = cap.activation || {}, health = cap.health || {};
      facts([['Version', cap.version], ['Source', typeof cap.source === 'object' ? JSON.stringify(cap.source) : cap.source || cap.origin], ['Health', health.status || 'Unknown'], ['Activation', activation.enabled ? `Enabled · ${activation.target || ''}` : 'Inactive'], ['Binding', Array.isArray(activation.provenance) ? activation.provenance.join(' → ') : activation.provenance]], card);
      if (health.detail) card.append(node('p', health.detail));
      if (health.problems?.length) card.append(node('p', health.problems.join('\n')));
      if (Object.keys(activation.settings || {}).length) {
        const settings = node('details'); settings.append(node('summary', 'Effective settings'), node('pre', JSON.stringify(activation.settings, null, 2))); card.append(settings);
      }
      if (!snapshot) {
        const actions = node('div', undefined, 'inspector-actions');
        for (const [action, label] of [['enable', cap.layer ? `Use for ${cap.layer}` : 'Enable'], ['disable', 'Disable here'], ['inherit', 'Inherit']]) {
          actions.append(button(label, () => mutate({ action: 'use', binding: { capability: cap.id, action } })));
        }
        card.append(actions);
      }
      content.append(card);
    }
    if (!snapshot) content.append(node('p', '“Inherit” removes the binding at this scope. “Disable here” explicitly excludes that capability. Installing a capability does not activate it.', 'muted'));
  }
  function renderOperations() {
    content.append(node('h3', 'Provider operations'));
    const providers = (data.capabilities || []).filter(cap => cap.layer && cap.activation?.enabled);
    let count = 0;
    for (const provider of providers) for (const operation of provider.operations || []) {
      count++; const row = node('div', undefined, 'inspector-cap');
      row.append(node('h4', `${provider.layer}: ${operation.name}`), node('p', operation.description || provider.id, 'muted'));
      if (!operation.available || operation.args?.some(arg => arg.required)) row.append(node('p', operation.reason || 'This operation requires arguments; run it with the OATS CLI.', 'muted'));
      else {
        const address = `${provider.layer}:${operation.name}`;
        row.append(button(operation.kind === 'view' ? 'View' : 'Run', async event => {
          const control = event.currentTarget; control.disabled = true; const id = serial, gen = workspaceGeneration();
          message(`Running ${address}…`);
          try {
            const result = await request({ action: 'run', selector: selection.selector, operation: address });
            if (!valid(id, gen)) return;
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
          } catch (error) { if (valid(id, gen)) message(error.message, true); }
          finally { if (valid(id, gen)) control.disabled = false; }
        }));
      }
      content.append(row);
    }
    if (!count) content.append(node('p', 'The active providers do not declare operations.'));
  }
  return { show, close, dispose() { alive = false; close(); } };
}
