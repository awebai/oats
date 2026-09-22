/** API2 preview is an observation, never a launch or a legacy-submit option. */
import { postJson, workspaceGeneration } from './views/common.mjs';
import { createReadinessView } from './readiness-view.mjs';
import { previewSupported, previewChoices, previewData, previewTarget, previewFailure, PREVIEW_ONLY, absolute } from './spawn-preview-contract.mjs';
export function createSpawnPreview(modal, { ctx, soul, workspace, cli, instances, owns, layout, submitting = () => false }) {
  const doc = modal.ownerDocument, form = modal.querySelector('.soul-form'), field = cls => modal.querySelector(`.${cls}`);
  const node = (tag, text, cls) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const button = (text, cls) => { const b = node('button', text, `act ${cls}`); b.type = 'button'; return b; };
  const native = field('spawn-native'), purpose = field('fpurpose'), purposeLabel = purpose.closest('label'), originalPurposeParent = purposeLabel.parentNode, originalPurposeNext = purposeLabel.nextSibling;
  const oldFuture = field('spawn-work-row'), oldChild = field('spawn-future-toggles')?.children[1];
  const panel = node('section', undefined, 'spawn-k6-panel'); panel.hidden = true;
  const work = node('div', undefined, 'spawn-work-row'), purposeHost = node('div');
  const branchLabel = node('label', 'Branch / base · preview only'), branch = node('input', undefined, 'field preview-branch'), base = node('input', undefined, 'field preview-base');
  branch.placeholder = 'Kernel default branch'; branch.setAttribute('aria-label', 'New branch for preview');
  base.placeholder = 'HEAD (kernel default)'; base.setAttribute('aria-label', 'Base ref for preview');
  branchLabel.append(branch, base); work.append(purposeHost, branchLabel);
  const childLabel = node('label', 'Allow this instance to spawn children · preview only'), child = node('select', undefined, 'field preview-children');
  for (const [value, label] of [['', 'Inherit declared policy'], ['true', 'Allow children'], ['false', 'Do not allow children']]) { const option = node('option', label); option.value = value; child.append(option); }
  childLabel.append(child);
  const actions = node('div', undefined, 'readiness-actions'), preview = button('Preview spawn', 'spawn-k6-preview'), suggest = button('Suggest default name', 'spawn-k6-suggest'), reset = button('Clear preview-only choices', 'spawn-k6-reset'); actions.append(preview, suggest, reset);
  const status = node('p', '', 'spawn-launch-status spawn-k6-status'); status.setAttribute('role', 'status');
  const details = node('details', undefined, 'spawn-preview-details spawn-k6-details'); details.hidden = true; const output = node('pre'); details.append(node('summary', 'Read-only spawn decision'), output);
  const readinessDetails = node('details'); readinessDetails.append(node('summary', 'Observed soul readiness — not the proposed launch’s readiness'));
  const readinessHost = node('div'); readinessDetails.append(readinessHost); const readiness = createReadinessView(readinessHost, { ctx });
  panel.append(work, childLabel, actions, status, details, node('p', 'Read only: this decision is not applied or reserved. Existing Spawn uses existing options only. Guarded apply, knowledge attachment, auto-PR and branch enumeration are separate follow-ups.', 'spawn-seam-note'));
  form.insertBefore(panel, oldFuture); form.querySelector('.spawn-footer').prepend(readinessDetails);
  const unavailable = node('p', '', 'spawn-seam-note spawn-k6-unavailable'); form.insertBefore(unavailable, panel);
  let alive = true, enabled = false, serial = 0, fingerprint = '', nativeMode = false, busy = false, generation = workspaceGeneration();
  const selector = { soul: soul.name, agentsRoot: soul.agentsRoot };
  const current = () => alive && generation === workspaceGeneration() && owns();
  const accepts = () => current() && !!workspace()?.id && absolute(workspace()?.scope) && previewSupported(cli()) && !workspace()?.remote && !workspace()?.server && !soul.remote && !soul.server && !field('fserver').value;
  function visible() { for (let el = modal; el; el = el.parentElement) if (el.hidden || el.inert || el.style.display === 'none') return false; return modal.isConnected; }
  function submitReason() { return branch.value || base.value || child.value || nativeMode || field('fmodel').value === '@native-default' ? PREVIEW_ONLY : ''; }
  function syncSubmit() {
    const reason = submitReason(), spawn = field('fspawn');
    // Do not unlock the existing mutation controller's in-flight button.
    if (submitting()) return;
    if (spawn.dataset.previewBlocked === 'true' && !reason) { delete spawn.dataset.previewBlocked; spawn.disabled = false; spawn.title = ''; }
    if (reason) { spawn.dataset.previewBlocked = 'true'; spawn.disabled = true; spawn.title = reason; }
    reset.disabled = !reason;
  }
  function invalidate() {
    if (!alive) return;
    serial++; busy = false; details.hidden = true; output.textContent = ''; status.textContent = '';
    preview.disabled = suggest.disabled = !accepts(); syncSubmit();
  }
  function choices(defaultName = false) {
    const anchorName = field('frelto').value, anchorRoot = field('frelto').selectedOptions?.[0]?.dataset.root;
    const relation = field('frelation').value || 'unrelated';
    let related;
    if (relation !== 'unrelated') {
      const candidates = (instances() || []).filter(i => i.instance === anchorName && i.agentsRoot === anchorRoot && !i.remote && !i.server);
      if (candidates.length !== 1) return null;
      const a = candidates[0]; related = { kind: relation, anchor: { instance: a.instance, agent: a.agent, agentsRoot: a.agentsRoot, server: null } };
    }
    return previewChoices({ ...(!defaultName && purpose.value ? { purpose: purpose.value } : {}), ...(branch.value ? { branch: branch.value } : {}), ...(base.value ? { base: base.value } : {}),
      ...(child.value ? { allowChildSpawns: child.value === 'true' } : {}), ...(field('fruntime').value ? { runtime: field('fruntime').value } : {}),
      ...(field('fbackend').value ? { backend: field('fbackend').value } : {}), ...(layout.config.value ? { launchConfig: layout.config.value } : {}),
      ...(field('fyolo').value ? { yolo: field('fyolo').value === 'true' } : {}),
      model: nativeMode ? { kind: 'native-default' } : field('fmodel').value ? { kind: 'custom', value: field('fmodel').value } : { kind: 'inherit' },
      ...(related ? { relation: related } : {}) });
  }
  async function read(defaultName = false) {
    if (!accepts() || !visible() || busy) return;
    invalidate(); const requested = choices(defaultName), ws = workspace()?.id, ticket = serial;
    if (!requested || !ws) { status.textContent = previewFailure('E_BAD_ARGS').reason.message; return; }
    busy = true; preview.disabled = suggest.disabled = true; status.textContent = 'Reading spawn preview…';
    const valid = () => current() && accepts() && serial === ticket;
    try {
      const response = await postJson(ctx, `/api/workspace-spawn-preview?ws=${encodeURIComponent(ws)}`, { action: 'preview', selector, choices: requested });
      if (!valid()) return;
      if (response?.spawnPreviewViewApi !== 1) throw Object.assign(Error(), { code: 'E_CLI_PROTOCOL' });
      if (response.status !== 'available') throw Object.assign(Error(), { code: response.reason?.code });
      const target = previewTarget(response.target), data = previewData(response.data, target);
      if (!data || target.workspace !== ws || target.selector.soul !== soul.name || target.selector.agentsRoot !== soul.agentsRoot) throw Object.assign(Error(), { code: 'E_CLI_PROTOCOL' });
      const d = data.decision;
      output.textContent = [`${defaultName ? 'Suggested default (purpose input unchanged)' : 'Candidate'}: ${d.instance}`, `Home: ${d.home}`, `Worktree: ${data.worktree ?? 'not applicable'}`,
        `Branch: ${d.branch ?? 'not applicable'}`, `Base: ${d.base ? `${d.base.ref} @ ${d.base.oid}` : 'not applicable'}`,
        `Runtime: ${data.runtime} · Model: ${data.model ?? 'native default'} (${data.modelSource})`, `Launch config: ${data.launchConfig ?? 'resolved defaults'}`,
        `Backend: ${data.backendStatus.name} · installed ${data.backendStatus.installed ? 'yes' : 'no'} · started false (reachability not reported)`, `Preflight: ${data.preflight.status} (${data.preflight.elapsedMs} ms elapsed / ${data.preflight.budgetMs} ms budget)`,
        `Permissions override: ${data.yolo === null ? 'not reported' : data.yolo ? 'YOLO' : 'native permission policy'}`,
        `Child policy: ${data.policy.childSpawns.allowed ? 'allowed' : 'not allowed'} · ${data.policy.childSpawns.origin.kind}; captured only by actual spawn`,
        `Decision revision: ${d.revision} (not submitted)`, 'Preview is not a launch receipt or complete launch readiness.'].join('\n');
      details.hidden = false; status.textContent = 'Preview observed. Nothing submitted for spawn; guarded apply remains unavailable.';
    } catch (error) { if (valid()) status.textContent = previewFailure(error?.code).reason.message; }
    finally { if (valid()) { busy = false; preview.disabled = suggest.disabled = false; syncSubmit(); } }
  }
  const input = event => {
    if (!current()) return;
    if (event.target === field('fmodel')) { nativeMode = false; native.setAttribute('aria-pressed', 'false'); }
    invalidate();
  };
  form.addEventListener('input', input); form.addEventListener('change', input);
  native.addEventListener('click', () => { if (!accepts() || !visible() || native.disabled) return; nativeMode = !nativeMode; native.setAttribute('aria-pressed', String(nativeMode)); invalidate(); });
  preview.addEventListener('click', () => { void read(); }); suggest.addEventListener('click', () => { void read(true); });
  reset.addEventListener('click', () => {
    if (!current() || !visible()) return;
    branch.value = base.value = child.value = ''; nativeMode = false; native.setAttribute('aria-pressed', 'false');
    if (field('fmodel').value === '@native-default') field('fmodel').value = '';
    invalidate();
  });
  return {
    active: accepts, invalidate, canSubmit: submitReason, preview: read,
    sync() {
      if (!alive) return;
      const c = cli(), w = workspace();
      const next = JSON.stringify([workspaceGeneration(), c?.ok, c?.bin, c?.version, c?.spawnPreviewApi, c?.features, c?.readinessApi,
        w?.id, w?.scope, w?.server, w?.remote, field('fserver').value, owns(), (instances() || []).map(i => [i.instance, i.agent, i.agentsRoot, i.server, i.home, i.createdAt])]);
      if (next !== fingerprint) { fingerprint = next; generation = workspaceGeneration(); invalidate(); }
      const supported = accepts(), changed = supported !== enabled; enabled = supported;
      // Keep reset reachable after a downgrade with preview-only choices retained.
      panel.hidden = !enabled && !submitReason(); unavailable.hidden = enabled;
      unavailable.textContent = previewFailure(w?.remote || w?.server || soul.server || field('fserver').value ? 'unsupported-remote-operation' : 'E_PREVIEW_UNAVAILABLE').reason.message;
      oldFuture.hidden = enabled; if (oldChild) oldChild.hidden = enabled;
      layout.preview.hidden = layout.launchStatus.hidden = enabled;
      if (enabled) layout.previewDetails.hidden = true;
      layout.readiness.hidden = enabled; readinessDetails.hidden = !enabled;
      native.disabled = !enabled; native.textContent = enabled ? 'Force native default · preview only' : 'Force native default — available after K6 API 2'; native.setAttribute('aria-pressed', String(nativeMode));
      for (const el of [branch, base, child]) el.disabled = !enabled || el !== child && soul.work !== 'worktree';
      if (changed) {
        const focused = doc.activeElement === purpose;
        if (enabled) purposeHost.append(purposeLabel);
        else originalPurposeParent.insertBefore(purposeLabel, originalPurposeNext?.parentNode === originalPurposeParent ? originalPurposeNext : null);
        if (focused && visible()) purpose.focus({ preventScroll: true });
      }
      preview.disabled = suggest.disabled = !enabled || busy; syncSubmit();
      readiness.update({ active: enabled, workspace: w, selector: { kind: 'soul', ...selector }, cli: c });
    },
    dispose() { alive = false; serial++; readiness.dispose(); form.removeEventListener('input', input); form.removeEventListener('change', input); },
  };
}
