/** On-demand kernel inspection, read-only: a v2 soul is edited in its
 * repository (soul-repository.mjs), never in place. Roster polling never
 * rebuilds the selected inspector. */
import { postJson, wsQuery, workspaceGeneration } from './views/common.mjs';
import { runtimeState } from './instance-presentation.mjs';
import { createSoulMark } from './identity-marks.mjs';
import { declarationsCSS, renderSoulDeclarations } from './soul-declarations.mjs';
import { createReadinessView, readinessCSS } from './readiness-view.mjs';
import { cliStatus } from './views/cli-status.mjs';
import { iconElement } from './shell-icons.mjs';
import { soulRepository } from './soul-repository.mjs';
import { inspectData, inspectFacts } from './inspect-contract.mjs';
import { createTeamsPanel, teamsOperations, teamsCSS } from './teams-panel.mjs';


export const inspectorCSS = `
${declarationsCSS}
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
export function createSoulInspector(container, { ctx, presentation, launch, schedule, files, canFiles = () => false, canLaunch = () => true, launchReason = () => 'Requires a compatible installed OATS CLI.', available = () => true, instances = () => [], workspace = () => null, closed }) {
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
  let status, content, summary, readiness;
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
    serial++; selection = null; selectionGen = null; data = null; teamsPanel = null; container.hidden = true;
    readiness?.dispose(); readiness = null;
    container.replaceChildren();
    if (presentation) presentation.setPresent(false);
    else container.parentElement?.classList.remove('inspecting');
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
    } catch (error) { if (valid(id, gen)) message(`${error.code ? `${error.code}: ` : ''}${error.message || 'Inspection failed. Refresh to retry.'}`, true); }
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
    content.replaceChildren();
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
      content.append(node('h3', 'Instance')); facts(inspectFacts.instance(inspected.instance));
      instructions(inspected.instance.instructions, 'Instructions are truncated here.');
      // Team controls: only when the home's messaging provider declares them.
      const teams = teamsOperations(inspected);
      if (teams) {
        const id = serial, gen = selectionGen;
        teamsPanel = createTeamsPanel(content, { operations: teams, selector: selection.selector, request, owns: () => valid(id, gen) && selectionGen === workspaceGeneration(), available });
      }
      if (soul) renderSoul(soul, false);
    } else if (soul) {
      content.append(node('p', 'What a spawn of this soul resolves now.', 'muted'));
      renderSoul(soul, true);
    } else content.append(node('p', 'The kernel did not report this soul. Refresh to retry.', 'muted'));
    renderCapabilities(inspected);
    renderOperations(inspected);
  }
  // Roster-owned actions do not depend on operationsApi, inspect success, or
  // an editable soul record. Keep their DOM stable while inspection settles.
  function renderSelectedSoul() {
    const agent = selection.agent, id = serial, gen = selectionGen;
    const actions = node('div', undefined, 'inspector-actions');
    const action = (label, cls, can, run) => {
      const control = button(label, () => {
        if (valid(id, gen) && control.isConnected && !control.disabled && can(agent)) run?.(agent);
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
    renderRepository(agent, roster, id, gen);
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
  // Roster-owned like the actions above: from the `oats souls` source, never
  // from inspection. The Desktop does not edit a declared soul in place.
  function renderRepository(agent, parent, id, gen) {
    const where = soulRepository(agent.soulSource);
    const block = node('div', undefined, 'inspector-repository');
    block.append(node('h3', 'Edit this soul in its repository'));
    if (!where) { block.append(node('p', 'Its repository is not reported.', 'muted')); parent.append(block); return; }
    block.append(node('p', where.path ? `${where.path} in ${where.repository}` : where.repository, 'muted'));
    if (where.url) {
      const open = button('Open repository', () => {
        if (valid(id, gen) && open.isConnected && typeof ctx?.openExternal === 'function') ctx.openExternal(where.url);
      });
      open.title = where.url; block.append(open);
    }
    parent.append(block);
  }
  function renderSoul(soul, withInstructions) {
    content.append(node('h3', 'Soul')); facts(inspectFacts.soul(soul));
    renderSoulDeclarations(content, soul);
    if (withInstructions) instructions(soul.instructions, 'Instructions are truncated here. The full document is in the soul\'s repository.');
  }
  function renderCapabilities(inspected) {
    content.append(node('h3', 'Effective providers'));
    facts(inspectFacts.layers(inspected.layers));
    content.append(node('h3', `Capabilities · ${inspected.capabilities.length}`));
    if (!inspected.capabilities.length) content.append(node('p', 'No capabilities resolved.', 'muted'));
    for (const cap of inspected.capabilities) {
      const card = node('section', undefined, 'inspector-cap'); card.append(node('h4', cap.id));
      facts(inspectFacts.capability(cap), card);
      if (cap.settings && typeof cap.settings === 'object' && Object.keys(cap.settings).length) {
        const settings = node('details'); settings.append(node('summary', 'Settings'), node('pre', JSON.stringify(cap.settings, null, 2))); card.append(settings);
      }
      content.append(card);
    }
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
      const control = summary?.querySelector('.spawn-act:not([disabled])');
      if (!control?.isConnected || control.closest('[hidden], [inert]')) return false;
      control.focus(); return true;
    },
    dispose() { if (!alive) return; alive = false; reset(); } };
}
