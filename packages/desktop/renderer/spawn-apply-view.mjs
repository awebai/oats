/** Explicit review/confirm/recovery over a server-owned intent. No placement,
 * key minting, persisted tasks, automatic replay, or diagnostic-based handoff. */
import { postJson, workspaceGeneration } from './views/common.mjs';
import { spawnApplySupported, spawnPrepareInput, spawnApplyView, spawnApplyReason } from './spawn-apply-contract.mjs';
import { sameSpawnDecision } from './spawn-decision.mjs';
const terminal = new Set(['complete', 'partial', 'incomplete']);
export function createSpawnApply(modal, { ctx, soul, workspace, cli, instances, owns, previewRead, task, wake,
  canSubmit = () => '', busy = () => false, setBusy = () => {}, onCreated = async () => {} }) {
  const form = modal.querySelector('.soul-form'), button = form.querySelector('.fspawn'), status = form.querySelector('.fstatus'), doc = modal.ownerDocument;
  const details = doc.createElement('details'); details.className = 'spawn-preview-details spawn-confirm-details'; details.hidden = true;
  const summary = doc.createElement('summary'); summary.textContent = 'Server-owned spawn confirmation';
  const output = doc.createElement('pre'); details.append(summary, output); form.insertBefore(details, form.querySelector('.spawn-footer'));
  const selector = { soul: soul.name, agentsRoot: soul.agentsRoot }, mount = workspaceGeneration();
  let alive = true, serial = 0, flight = null, phase = 'idle', touched = false, submitted = false, detached = false, wasOwned = false;
  let prepared = null, fingerprint = '', delivered = false;
  const current = () => alive && owns() && mount === workspaceGeneration();
  const mandatory = () => current() && spawnApplySupported(cli()) && !workspace()?.remote && !workspace()?.server && !soul.remote && !soul.server && !form.querySelector('.fserver').value;
  const active = () => mandatory() && previewRead.active() && soul.work !== 'attached' && !soul.captured;
  const handles = () => mandatory() || current() && touched;
  const unavailable = () => spawnApplyReason(mandatory() ? 'E_UNSUPPORTED_MODE' : 'E_APPLY_UNAVAILABLE').message;
  const input = () => { const requestedWake = wake?.(); return { action: 'prepare', selector, choices: previewRead.choices(), task: task(), ...(requestedWake ? { wake: requestedWake } : {}) }; };
  function signature() {
    try {
      const value = input(), anchor = value.choices?.relation?.anchor;
      const anchors = anchor ? (instances() || []).filter(i => i.instance === anchor.instance && i.agent === anchor.agent && i.agentsRoot === anchor.agentsRoot && !i.server)
        .map(i => [i.home, i.createdAt, i.captured ?? null]) : [];
      const c = cli(), w = workspace();
      return JSON.stringify([workspaceGeneration(), w?.id, w?.scope, w?.server, w?.remote, c?.ok, c?.bin, c?.version,
        c?.spawnPreviewApi, c?.spawnApplyApi, c?.features, c?.runtimes, c?.sessionBackends, c?.launchOptions, c?.relations, value, anchors]);
    } catch { return null; }
  }
  function invalidate(force = false) {
    if (!current()) return;
    const next = signature(); if (!force && next === fingerprint) return;
    fingerprint = next; serial++;
    if (!submitted) { prepared = null; phase = 'idle'; details.hidden = true; output.textContent = ''; }
    else { detached = true; if (!terminal.has(phase)) phase = 'unknown'; }
    if (handles()) {
      status.textContent = submitted ? terminal.has(phase) ? 'This outcome belongs to the earlier confirmed draft. Current edits were not submitted; inspect the roster or schedules.'
        : 'Current edits do not change the submitted intent. Check its original result before starting another spawn.' : '';
      sync();
    }
  }
  function sync() {
    if (!current()) return;
    const next = signature(); if (next !== fingerprint) { invalidate(); return; }
    previewRead.syncSubmission?.();
    const controlled = handles();
    if (!controlled) {
      details.hidden = true;
      if (wasOwned && !busy()) { button.textContent = 'Spawn'; button.disabled = !cli()?.ok || !!previewRead.canSubmit(); button.title = ''; status.textContent = ''; }
      wasOwned = false; return;
    }
    wasOwned = true;
    button.textContent = flight ? phase === 'preparing' ? 'Reviewing…' : 'Checking spawn…'
      : phase === 'prepared' ? 'Confirm spawn' : ['unknown', 'pending'].includes(phase) && prepared ? 'Check result'
      : terminal.has(phase) ? phase === 'incomplete' ? 'Spawn incomplete' : 'Agent created' : 'Review spawn';
    button.disabled = !!flight || busy() || !active() || terminal.has(phase);
    button.title = !active() ? unavailable() : ['unknown', 'pending'].includes(phase)
      ? 'Reads the retained result and may retry this same intent if unknown. If its home was retired, inspect the roster instead.' : '';
    if (!active() && controlled && !flight) { status.classList.add('err'); status.textContent = unavailable() + ' Close or explicitly reset an unsubmitted confirmation; no ordinary-spawn fallback.'; }
  }
  function showPlan(view) {
    const d = view.preview.decision, e = d.effective;
    output.textContent = [`Instance: ${d.instance}`, `Home: ${d.home}`, `Work: ${e.work} · Repository: ${e.repo}`,
      `Branch: ${d.branch ?? 'not applicable'}`, `Base: ${d.base ? `${d.base.ref} @ ${d.base.oid}` : 'not applicable'}`,
      `Runtime: ${e.runtime} · Model: ${e.model ?? 'native default'} (${view.preview.modelSource})`, `Launch configuration: ${e.launchConfig ?? 'resolved defaults'}`,
      `Backend: ${e.backend}`, `Permissions: ${e.yolo === null ? 'not reported / native default' : e.yolo ? 'YOLO' : 'native permission policy'}`,
      `Child spawns: ${e.childSpawns ? 'allowed' : 'not allowed'}`, `Relation: ${e.relation ? `${e.relation.kind} · ${e.relation.anchor.instance} · ${e.relation.anchor.agentsRoot}` : 'unrelated'}`,
      `Wake: ${view.wakeRequested ? 'requested; outcome reported after creation' : 'not requested'}`, `Decision revision: ${d.revision}`,
      'Not reserved. Confirming submits this immutable intent; drift requires another review.'].join('\n');
    details.hidden = false; details.open = true;
  }
  async function run() {
    sync();
    if (!handles() || flight || busy() || terminal.has(phase)) return;
    if (!active()) { sync(); return; }
    const ws = workspace()?.id, intent = prepared;
    const checking = ['unknown', 'pending'].includes(phase) && intent;
    const applying = phase === 'prepared' && intent;
    const reason = !checking && canSubmit();
    if (reason) { status.classList.add('err'); status.textContent = reason; return; }
    let draft;
    try { if (!checking && !applying) draft = spawnPrepareInput(input()); } catch { /* invalid wake/form */ }
    if (!checking && !applying && !draft) { status.classList.add('err'); status.textContent = spawnApplyReason('E_BAD_ARGS').message; return; }
    const ticket = ++serial, sig = signature(), token = {}, connection = ctx.connectionGeneration?.() ?? 0;
    touched = true; flight = token; setBusy(true);
    phase = applying || checking ? 'unknown' : 'preparing';
    if (applying) submitted = true;
    status.classList.remove('err'); status.textContent = applying ? 'Submitting the confirmed spawn…' : checking ? 'Checking the original submitted intent…' : 'Preparing a server-owned confirmation…';
    sync();
    const valid = () => current() && active() && serial === ticket && signature() === sig && connection === (ctx.connectionGeneration?.() ?? 0);
    const request = async body => {
      const raw = await postJson(ctx, `/api/spawn?ws=${encodeURIComponent(ws)}`, body);
      if (!valid()) return null;
      const view = spawnApplyView(raw, { workspace: ws, ref: body.spawnRef, selector });
      if (!view || view.preview && body.action !== 'prepare' && !sameSpawnDecision(view.preview.decision, intent.preview.decision)) throw Object.assign(Error(), { code: 'E_CLI_PROTOCOL' });
      return view;
    };
    try {
      let view = await request(checking ? { action: 'result', spawnRef: intent.spawnRef } : applying ? { action: 'apply', spawnRef: intent.spawnRef } : draft);
      if (!view || !valid()) return;
      if (checking && view.status === 'unknown') {
        // This is the user's explicit recovery click, not a timer/status poll.
        // Same server ref/key only; pending/complete/partial never dispatch here.
        submitted = true; view = await request({ action: 'apply', spawnRef: intent.spawnRef });
        if (!view || !valid()) return;
      }
      if (checking && view.status === 'prepared') {
        submitted = false;
        if (detached) { prepared = null; phase = 'idle'; details.hidden = true; status.textContent = 'No submitted attempt is recorded. Review the current draft again before confirming.'; }
        else { prepared = view; phase = 'prepared'; showPlan(view); status.textContent = 'No submitted attempt is recorded. Review this intent and explicitly confirm it.'; }
        return;
      }
      if (draft) {
        if (view.status !== 'prepared') {
          if (!['unavailable', 'refused'].includes(view.status)) throw Object.assign(Error(), { code: 'E_CLI_PROTOCOL' });
          phase = 'unavailable'; status.classList.add('err'); status.textContent = view.reason.message; return;
        }
        if (view.wakeRequested !== !!draft.wake) throw Object.assign(Error(), { code: 'E_CLI_PROTOCOL' });
        prepared = view; phase = 'prepared'; showPlan(view);
        status.textContent = 'Review this bound decision. Confirm spawn submits it; nothing has launched yet.'; return;
      }
      phase = view.status;
      if (['complete', 'partial'].includes(phase)) {
        status.classList.toggle('err', phase === 'partial');
        status.textContent = view.reason?.message || `Created ${view.receipt.instance}${view.receipt.launched ? ' — session launched' : ' — not launched'}.`;
        if (!delivered) { delivered = true; await onCreated(view, () => valid() && !detached); }
      } else if (phase === 'incomplete') {
        status.classList.add('err'); status.textContent = `${view.reason.message} ${view.incomplete.instance} — inspect it from the roster.`;
      } else if (phase === 'pending') {
        status.textContent = 'The original spawn is still pending. Check result again; no second command was started.';
      } else {
        status.classList.add('err'); status.textContent = view.reason?.message || spawnApplyReason('E_CLI_PROTOCOL').message;
        if (phase !== 'unknown') { prepared = null; submitted = false; details.hidden = true; }
      }
    } catch (error) {
      if (!valid()) return;
      phase = submitted ? 'unknown' : 'unavailable'; status.classList.add('err');
      status.textContent = spawnApplyReason(submitted ? 'E_OUTCOME_UNKNOWN' : error?.code).message;
    } finally {
      // Release only our own flight; draft edits invalidate result authority but
      // cannot leave the form locked forever or unlock a successor operation.
      if (flight === token) { flight = null; if (current()) { setBusy(false); sync(); } }
    }
  }
  function reset() {
    if (!current() || flight || submitted) { invalidate(true); return; }
    touched = false; prepared = null; phase = 'idle'; detached = false; invalidate(true); sync();
  }
  const onInput = () => invalidate();
  form.addEventListener('input', onInput); form.addEventListener('change', onInput);
  return { active, handles, run, sync, invalidate: () => invalidate(true), reset,
    needsReset: () => current() && touched && !submitted && !flight && !active(),
    dispose() { alive = false; serial++; form.removeEventListener('input', onInput); form.removeEventListener('change', onInput); } };
}
