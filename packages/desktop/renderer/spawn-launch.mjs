/** Read-only launch list/preview and qualified capability observations for6a.
 * No config editing, readiness certification, model resolver or K6 request. */
import { postJson, wsQuery, workspaceGeneration } from './views/common.mjs';

const string = value => typeof value === 'string' ? value : '';
const runtimeNames = { pi: 'Pi', claude: 'Claude Code', codex: 'Codex' };
export function runtimeOptions(cli) {
  const values = Array.isArray(cli?.runtimes) ? cli.runtimes.filter(v => typeof v === 'string' && v) : ['pi', 'claude'];
  const source = cli?.runtimesSource === 'reported' ? 'reported by CLI'
    : cli?.runtimesSource === 'assumed' || !Array.isArray(cli?.runtimes) ? 'assumed (CLI did not report)' : 'provenance not reported';
  return [...new Set(values)].map(value => ({ value, label: `${Object.hasOwn(runtimeNames, value) ? runtimeNames[value] : value} · ${source}`,
    disabled: !Object.hasOwn(runtimeNames, value) }));
}

export function createSpawnLaunch(modal, { ctx, soul, workspace, cli, owns, layout, previewRead }) {
  const doc = modal.ownerDocument, selector = { soul: soul.name, agentsRoot: soul.agentsRoot };
  const config = layout.config, runtime = modal.querySelector('.fruntime'), model = modal.querySelector('.fmodel');
  const permissions = modal.querySelector('.fyolo'), server = modal.querySelector('.fserver');
  let alive = true, epoch = 0, listTicket = 0, previewTicket = 0, fingerprint = '', selectedConfigs = [], routeReason = '';
  const current = (owner, gen) => alive && epoch === owner && workspaceGeneration() === gen && owns();
  const targetMatches = value => value?.selected?.soul === soul.name && value.selected.agentsRoot === soul.agentsRoot && !value.selected.home;
  const choices = () => ({ ...(config.value ? { launchConfig: config.value } : {}), ...(runtime.value ? { runtime: runtime.value } : {}),
    ...(model.value ? { model: model.value } : {}), ...(permissions.value === '' ? {} : { yolo: permissions.value === 'true' }) });
  function invalidatePreview() {
    previewTicket++; layout.previewDetails.hidden = true; layout.preview.disabled = !!launchReason(); layout.launchStatus.textContent = '';
    layout.previewDetails.querySelector('pre').textContent = '';
    layout.defaultNote.textContent = model.value ? 'Explicit custom/advisory model. Preview to check the resolved invocation.' : 'Use resolved defaults. Preview reports the actual model and its source.';
  }
  function unknown() {
    for (const key of ['installed', 'trusted', 'configured', 'enrolled']) modal.querySelector(`.spawn-${key}`).textContent = `${key}: unknown`;
  }
  function launchReason() {
    const status = cli();
    if (!status?.ok || !status.features?.includes('launch-config')) return 'Launch configuration list/preview requires CLI launch-config support.';
    if (soul.server && !status.remote?.includes('launch-config')) return 'Remote launch configuration preview is not supported by this CLI.';
    return routeReason;
  }
  function renderConfigs(prefer = config.value) {
    config.replaceChildren(); const option = doc.createElement('option'); option.value = ''; option.textContent = 'Use resolved defaults'; config.append(option);
    for (const row of selectedConfigs) { const option = doc.createElement('option'); option.value = row.name; option.textContent = `${row.name} (${row.runtime})`; config.append(option); }
    if (prefer && !selectedConfigs.some(row => row.name === prefer)) {
      const unavailable = doc.createElement('option'); unavailable.value = prefer; unavailable.textContent = `${prefer} — unavailable`; unavailable.disabled = true; config.append(unavailable);
    }
    config.value = prefer;
  }
  async function preview() {
    if (previewRead?.active()) { previewRead.invalidate(); return; }
    invalidatePreview();
    const reason = launchReason();
    if (reason) { layout.launchStatus.textContent = reason; return; }
    const owner = epoch, gen = workspaceGeneration(), ticket = previewTicket;
    const requested = choices(); layout.preview.disabled = true; layout.launchStatus.textContent = 'Checking launch preview…';
    try {
      const data = await postJson(ctx, `/api/launch-configs${wsQuery()}`, { action: 'preview', selector, choices: requested });
      if (!current(owner, gen) || ticket !== previewTicket) return;
      if (!targetMatches(data) || (typeof data.modelSource !== 'string' || !data.modelSource.trim()) || (data.model !== null && typeof data.model !== 'string')
        || !Array.isArray(data.preflight) || data.preflight.some(check => !check || typeof check.check !== 'string')
        || ![true, false].includes(data.ok)) throw Error('Launch preview did not report this exact soul and model provenance.');
      layout.defaultNote.textContent = `Resolved model: ${data.model == null || data.model === '' ? 'Not specified' : string(data.model)} · ${data.modelSource}`;
      const checks = Array.isArray(data.preflight) ? data.preflight : [];
      const lines = checks.map(check => `${check.ok === true ? 'Reported check' : check.ok === false ? 'Needs attention' : 'Unknown'}: ${string(check.check)}${check.detail ? ` — ${string(check.detail)}` : ''}`);
      layout.previewDetails.querySelector('pre').textContent = [string(data.command), ...lines].filter(Boolean).join('\n');
      layout.previewDetails.hidden = false;
      layout.launchStatus.textContent = data.ok === false || checks.some(check => check.ok === false)
        ? 'Launch preview reports failed checks. Nothing was launched.' : 'Preview only. Complete readiness remains unknown; nothing was launched.';
    } catch (error) {
      if (!current(owner, gen) || ticket !== previewTicket) return;
      layout.previewDetails.hidden = true; layout.launchStatus.textContent = `Preview unavailable: ${error.message || 'read failed'}`;
    }
    if (current(owner, gen) && ticket === previewTicket) layout.preview.disabled = !!launchReason();
  }
  async function loadConfigs() {
    const reason = launchReason();
    selectedConfigs = []; renderConfigs(); layout.refreshConfigs.disabled = true;
    if (reason) { layout.configStatus.textContent = reason; return; }
    const owner = epoch, gen = workspaceGeneration(), ticket = ++listTicket, priorPreview = previewTicket;
    layout.configStatus.textContent = 'Loading launch configurations…';
    try {
      const data = await postJson(ctx, `/api/launch-configs${wsQuery()}`, { action: 'list', selector });
      if (!current(owner, gen) || ticket !== listTicket) return;
      if (!targetMatches(data) || !Array.isArray(data.configurations) || data.configurations.some(row => !row || typeof row.name !== 'string' || typeof row.runtime !== 'string')) throw Error('Configuration list did not report this exact soul.');
      selectedConfigs = data.configurations; renderConfigs(); layout.configStatus.textContent = '';
      // A newer explicit model/provider/preview intent must not be retried or
      // overwritten just because an earlier configuration list finally arrived.
      if (priorPreview === previewTicket && !previewRead?.active()) void preview();
    } catch (error) {
      if (!current(owner, gen) || ticket !== listTicket) return;
      layout.configStatus.textContent = `Launch configurations unavailable: ${error.message || 'read failed'}`;
    }
    if (current(owner, gen) && ticket === listTicket) layout.refreshConfigs.disabled = !!launchReason();
  }
  async function inspect() {
    if (previewRead?.active()) return;
    unknown();
    const status = cli();
    if (routeReason || !status?.ok || status.operationsApi !== 1 || !status.features?.includes('operations')) return;
    if (soul.server && !status.remote?.includes('operations')) return;
    const owner = epoch, gen = workspaceGeneration();
    try {
      const data = await postJson(ctx, `/api/capabilities${wsQuery()}`, { action: 'inspect', selector });
      if (!current(owner, gen)) return;
      if (data?.operationsApi !== 1 || !targetMatches(data) || data.selected.source !== 'config' || !Array.isArray(data.problems) || data.problems.length
        || !Array.isArray(data.capabilities) || !data.capabilities.length) return;
      for (const [field, key] of [['installed', 'installed'], ['trusted', 'trusted']]) {
        if (data.capabilities.some(cap => !cap || typeof cap.id !== 'string' || typeof cap.health?.[field] !== 'boolean')) continue;
        const count = data.capabilities.filter(cap => cap.health[field] === true).length;
        modal.querySelector(`.spawn-${key}`).textContent = `${key}: ${count}/${data.capabilities.length} inspected`;
      }
    } catch { if (!current(owner, gen)) return; unknown(); }
  }
  function sync() {
    if (!alive) return;
    const status = cli(), ws = workspace(), admitted = owns();
    const next = JSON.stringify([status?.ok, status?.bin, status?.version, status?.runtimes, status?.runtimesSource, status?.features, status?.operationsApi, status?.spawnPreviewApi, status?.remote,
      ws?.id, ws?.scope, ws?.server, ws?.registrationPresent, server.value, admitted]);
    if (next === fingerprint) return;
    const targetChanged = fingerprint && routeServer !== server.value;
    fingerprint = next; routeServer = server.value; epoch++; listTicket++; invalidatePreview();
    const oldRuntime = runtime.value;
    runtime.replaceChildren(); const inherit = doc.createElement('option'); inherit.value = ''; inherit.textContent = 'Use resolved defaults'; runtime.append(inherit);
    for (const item of runtimeOptions(status)) { const option = doc.createElement('option'); option.value = item.value; option.textContent = item.label; option.disabled = item.disabled; runtime.append(option); }
    if (oldRuntime && ![...runtime.options].some(option => option.value === oldRuntime)) {
      const option = doc.createElement('option'); option.value = oldRuntime; option.textContent = `${oldRuntime} — no longer reported`; option.disabled = true; runtime.append(option);
    }
    runtime.value = oldRuntime; layout.syncRuntime(); layout.closePopups();
    routeReason = !admitted ? 'The exact selected soul is no longer available for launch observations.'
      : server.value && server.value !== (soul.server || '') ? 'Select the remote workspace and its soul for qualified preview/observations; local facts are not substituted.'
      : soul.server && (ws?.server !== soul.server || !ws.registrationPresent) ? 'Remote preview/observations require the registered execution workspace.' : '';
    if (targetChanged) config.value = ''; // explicit execution-target change revokes the old scope's named choice
    layout.launchStatus.textContent = launchReason(); layout.preview.disabled = !!launchReason();
    void loadConfigs(); void inspect();
    return true;
  }
  let routeServer = server.value;
  layout.preview.addEventListener('click', () => { if (alive && owns()) void preview(); });
  layout.refreshConfigs.addEventListener('click', () => { if (alive && owns()) void loadConfigs(); });
  config.addEventListener('change', () => { if (alive && owns()) void preview(); });
  for (const field of [runtime, permissions, model]) field.addEventListener('change', () => { if (alive && owns()) void preview(); });
  model.addEventListener('input', invalidatePreview); // typing never fans out CLI preview processes
  server.addEventListener('change', sync);
  return { sync, value: () => config.value || undefined, clear() { config.value = ''; invalidatePreview(); previewRead?.invalidate(); },
    canSubmit() {
      const blocked = previewRead?.canSubmit(); if (blocked) return blocked;
      if (runtime.value && runtime.selectedOptions[0]?.disabled) return 'Choose an available runtime or use resolved defaults.';
      if (config.value && (launchReason() || !selectedConfigs.some(row => row.name === config.value))) return 'Choose a configuration reported for this execution context, or use resolved defaults.';
      return '';
    },
    dispose() { alive = false; epoch++; listTicket++; previewTicket++; },
  };
}
