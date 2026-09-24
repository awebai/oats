import { takePickerFocusReturn } from './overlay-picker.mjs';
import { gitTarget, gitTargetKey } from './instance-git-contract.mjs';
import { lifecyclePlan, lifecycleOptions, planReference, lifecycleReason, publicLifecycleReceipt, stoppedTargets, lifecycleChoicesApplicable } from './lifecycle-contract.mjs';
import { projectedPullRequest } from './forge-contract.mjs';
import { iconElement } from './shell-icons.mjs';
export const lifecycleCSS = `
.lifecycle-dialog { width:min(420px,calc(100vw - 32px)); max-height:88vh; overflow:auto; display:flex; flex-direction:column; gap:14px; padding:20px; border:1px solid var(--border); border-radius:12px; background:var(--surface); color:var(--fg); box-shadow:var(--shadow-popover); font-size:12.5px; }
.lifecycle-dialog h2 { margin:0; font-size:15px; font-weight:700; overflow-wrap:anywhere; }
.lifecycle-heading { display:flex; gap:14px; align-items:flex-start; }
.lifecycle-mark { flex:none; width:36px; height:36px; border-radius:10px; display:grid; place-items:center; background:var(--surface-2); color:var(--danger); font-size:16px; }
.lifecycle-dialog p { margin:0; line-height:1.5; overflow-wrap:anywhere; }
.lifecycle-dialog a { color:var(--accent); overflow-wrap:anywhere; }
.lifecycle-dialog .lifecycle-note, .lifecycle-dialog dt { color:var(--muted); }
.lifecycle-dialog .lifecycle-warning { color:var(--danger); }
.lifecycle-dialog .lifecycle-facts, .lifecycle-dialog .lifecycle-options { padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--surface-2); display:grid; gap:8px; }
.lifecycle-dialog dl { display:grid; grid-template-columns:auto minmax(0,1fr); gap:6px 10px; margin:0; }
.lifecycle-dialog dd { margin:0; overflow-wrap:anywhere; }
.lifecycle-dialog ul { margin:0; padding-left:18px; }
.lifecycle-dialog li { margin:6px 0; overflow-wrap:anywhere; }
.lifecycle-dialog label { display:flex; gap:8px; align-items:flex-start; }
.lifecycle-dialog input { accent-color:var(--accent); }
.lifecycle-dialog button { height:32px; padding:0 14px; border:1px solid var(--border); border-radius:7px; background:var(--surface); color:var(--fg); font:inherit; font-size:12.5px; font-weight:600; cursor:pointer; }
.lifecycle-dialog button:disabled { color:var(--faint); background:var(--surface-2); cursor:default; }
.lifecycle-dialog button:focus-visible, .lifecycle-dialog input:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.lifecycle-dialog .lifecycle-confirm:not(:disabled) { background:var(--primary-bg); color:var(--primary-fg); }
.lifecycle-dialog[data-operation=retire] .lifecycle-confirm:not(:disabled) { background:var(--danger); color:var(--primary-fg); }
.lifecycle-footer { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.lifecycle-footer .lifecycle-close { margin-left:auto; }
`;
const report = v => v === null || v === undefined ? 'Unknown' : String(v);
/** A fresh explicit confirmation every time; no Don't-ask-again bypass. */
export function createLifecycleDialog({ doc, request, gitRequest, forgeRequest, generation = () => 0,
  subscribeWorkspace = () => () => {}, subscribeConnections = () => () => {}, connectionGeneration = () => 0,
  onIntent = () => {}, applyFocus = fn => fn(), onSettled = () => {}, openExternal = () => {} } = {}) {
  let alive = true, overlay = null, ui = null, target = null, operation = null, choices = null, plan = null, planRef = null;
  let life = 0, ticket = 0, applying = false, restore = null, submission = null;
  const node = (tag, text, cls) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const capture = () => ({ life, ticket, generation: generation(), target, overlay });
  const owns = ref => alive && overlay && ref.overlay === overlay && overlay.isConnected && ref.life === life && ref.ticket === ticket
    && ref.generation === generation() && ref.target === target;
  const selector = () => ({ instance: target.instance, agent: target.agent, agentsRoot: target.agentsRoot, server: target.server });
  function close({ restoreFocus = true } = {}) {
    if (!overlay) return;
    life++; ticket++; overlay.remove(); overlay = null; ui = null; target = null; plan = null; planRef = null; applying = false; submission = null;
    if (restoreFocus) applyFocus(() => restore?.restore()); restore = null;
  }
  function locks() {
    if (!ui) return;
    ui.confirm.disabled = applying || !plan || !planRef || !lifecycleChoicesApplicable(plan, choices);
    ui.confirm.title = plan && !lifecycleChoicesApplicable(plan, choices) ? lifecycleReason('E_OPTION_UNAVAILABLE').message : '';
    ui.refresh.disabled = applying;
    ui.recursive.disabled = applying || !plan;
    ui.discard.disabled = applying || !plan || operation === 'retire' && plan.facts.workMode !== 'worktree' && !choices.discardWorktree;
    ui.branch.disabled = applying || !plan || !choices.discardWorktree;
    if (operation === 'retire' && plan && !choices.deleteBranch && (!plan.facts.work.observed || plan.facts.work.branch === null || plan.facts.workMode !== 'worktree')) ui.branch.disabled = true;
    ui.retry.disabled = applying; ui.retry.hidden = !submission || !submission.uncertain;
    ui.close.textContent = applying ? 'Close status' : 'Close';
  }
  function rows(parent, values) {
    const dl = node('dl'); for (const [label, value] of values) dl.append(node('dt', label), node('dd', report(value))); parent.append(dl);
  }
  function excluded(parent, values, ambiguous = false) {
    if (!values.length) return;
    parent.append(node('p', ambiguous ? 'Not acted on — parent name not unique' : 'Children not included', 'lifecycle-note'));
    const list = node('ul'); for (const v of values) list.append(node('li', `${v.instance} · ${v.agent} · ${v.home}`)); parent.append(list);
  }
  function targetFacts(parent, t) {
    const title = node('strong', `${t.instance} · ${t.agent}`); parent.append(title, node('p', t.home, 'lifecycle-note'));
    rows(parent, [['Session', t.session.established ? t.session.state : 'Unknown — not established'], ['Present', t.session.present],
      ['Mid-task (reported)', t.midTask === 'unknown' ? 'Unknown' : t.midTask],
      ['Work', t.work.observed ? `${t.work.changed} changed · ${t.work.untracked} untracked` : `Unknown — ${t.work.reason}`],
      ['Worktree branch', t.work.observed ? t.work.branch : null]]);
  }
  function renderPlan(value) {
    ui.facts.replaceChildren(); ui.result.replaceChildren(); ui.forge.replaceChildren();
    if (operation === 'stop') {
      ui.explanation.textContent = 'Stop the listed sessions, children first. Home, worktree, transcript and launch configuration are retained. Nothing is killed harder if a session refuses to stop.';
      for (const t of value.targets) targetFacts(ui.facts, t);
      excluded(ui.facts, value.skipped); excluded(ui.facts, value.ambiguous, true);
    } else {
      const f = value.facts;
      ui.explanation.textContent = 'Remove the instance home. The kernel stops children first and retains their homes; if one will not stop, Remove refuses and names it. Retain the worktree and local branch unless selected below. The PR is never changed.';
      rows(ui.facts, [['Session', f.session.established ? f.session.state : 'Unknown — not established'],
        ['Work', f.work.observed ? `${f.work.changed} changed · ${f.work.untracked} untracked` : `Unknown — ${f.work.reason}`],
        ['Worktree branch', f.work.observed ? f.work.branch : null], ['Recorded branch', f.recordedBranch],
        ['Worktree by default', value.defaults.retainWorktree ? 'Retained and re-homed by OATS' : 'Not reported as an owned worktree']]);
      if (f.work.observed && f.work.drift) ui.facts.append(node('p', 'Branch drift: actions use the observed worktree branch, not the recorded spawn name.', 'lifecycle-warning'));
      if (f.children.length) { const list = node('ul'); for (const c of f.children) list.append(node('li', `${c.instance} · ${c.agent} · ${c.home} · ${c.session.established ? c.session.state : 'Unknown session'}`)); ui.facts.append(node('p', 'Children stopped first; their homes are retained.'), list); }
      excluded(ui.facts, f.ambiguous, true);
      ui.forge.append(node('p', 'Pull request: unknown. Forge facts are informational; the kernel never touches a PR.', 'lifecycle-note'));
    }
    ui.facts.append(node('p', `Observed ${value.at}`, 'lifecycle-note')); locks();
  }
  function validTarget(result, ref) {
    return result?.lifecycleApi === 1 && result.target && gitTargetKey(result.target) === gitTargetKey(ref.target);
  }
  async function overlayForge(ref, snapshot) {
    if (operation !== 'retire' || !snapshot.facts.work.observed || !gitRequest || !forgeRequest) return;
    const account = connectionGeneration();
    const current = () => owns(ref) && plan === snapshot && !applying && account === connectionGeneration();
    try {
      const git = await gitRequest(ref.target.workspace, { action: 'git', selector: selector() });
      if (!current()) return;
      const expected = snapshot.facts.work, observed = git?.data?.observation;
      if (!git.target || gitTargetKey(git.target) !== gitTargetKey(ref.target) || git.status !== 'available' || !planReference(git.observationKey)
        || observed?.revision !== expected.revision || observed.branch !== expected.branch) return;
      const result = await forgeRequest(ref.target.workspace, { selector: selector(), observationKey: git.observationKey });
      if (!current() || result?.forgeApi !== 1 || !result.target || gitTargetKey(result.target) !== gitTargetKey(ref.target)
        || result.observation?.key !== git.observationKey || result.observation.revision !== expected.revision || result.observation.branch !== expected.branch
        || result.host !== expected.remote?.host || result.repository !== expected.remote?.path) return;
      if (result.status === 'no-pull-request' && result.data === null) ui.forge.replaceChildren(node('p', 'No pull request reported for this observed branch. PRs are never changed by Remove.', 'lifecycle-note'));
      else if (result.status === 'available') {
        const pr = projectedPullRequest(result.data, { host: result.host, path: result.repository, branch: expected.branch }); if (!pr) return;
        const a = node('a', `PR #${pr.number} · ${pr.title} · ${pr.state}`); a.href = pr.url; a.rel = 'noopener noreferrer';
        a.addEventListener('click', event => { event.preventDefault(); if (current() && a.isConnected) openExternal(pr.url); });
        ui.forge.replaceChildren(a, node('p', 'Informational forge observation; this PR will not be changed.', 'lifecycle-note'));
      }
    } catch { /* unknown stays unknown; never invent no PR or block kernel facts */ }
  }
  async function refresh() {
    if (!overlay || applying) return;
    ticket++; const ref = capture(), requested = { ...choices };
    plan = null; planRef = null; submission = null; ui.facts.replaceChildren(); ui.result.replaceChildren(); ui.forge.replaceChildren();
    ui.status.textContent = 'Reading the kernel plan…'; locks();
    try {
      const result = await request(ref.target.workspace, { action: 'plan', operation, selector: selector(), options: requested });
      if (!owns(ref)) return;
      if (!validTarget(result, ref) || result.status !== 'plan') { ui.status.textContent = lifecycleReason(result?.reason?.code).message; return; }
      const value = lifecyclePlan(result.plan, ref.target, operation, requested);
      if (!value || !planReference(result.planRef) || JSON.stringify(lifecycleOptions(operation, result.options)) !== JSON.stringify(requested)) throw new Error('Invalid plan');
      plan = value; planRef = result.planRef; ui.status.textContent = 'Review these facts before confirming.'; renderPlan(plan); void overlayForge(ref, plan);
    } catch { if (owns(ref)) ui.status.textContent = lifecycleReason('E_CLI_PROTOCOL').message; }
    finally { if (owns(ref)) locks(); }
  }
  function stopped(parent, values) {
    const list = node('ul');
    for (const v of values) list.append(node('li', `${v.instance} · ${v.home}: ${v.ok ? v.alreadyIdle ? 'Already idle' : 'Stopped' : `Not stopped; reported running PIDs: ${v.stillRunning?.join(', ') || 'unknown'}`}`));
    parent.append(list);
  }
  async function apply(retry = false) {
    if (!overlay || applying || (retry ? !submission : !plan || !planRef || !lifecycleChoicesApplicable(plan, choices))) return;
    onIntent(); ticket++; const ref = capture(), snapshot = retry ? submission.plan : plan, selectedRef = retry ? submission.reference : planRef;
    submission = { reference: selectedRef, plan: snapshot, uncertain: true };
    applying = true; planRef = null; ui.status.textContent = 'Operation submitted. Closing this status does not cancel it.'; ui.result.replaceChildren(); locks();
    try {
      const result = await request(ref.target.workspace, { action: 'apply', planRef: selectedRef });
      if (!owns(ref)) return;
      if (!validTarget(result, ref)) { ui.status.textContent = lifecycleReason('E_OUTCOME_UNKNOWN').message; return; }
      submission.uncertain = ['unknown', 'pending'].includes(result.status);
      if (result.status === 'stale') {
        const fresh = lifecyclePlan(result.plan, ref.target, operation, choices);
        if (!fresh) throw new Error('Invalid fresh plan');
        plan = fresh; planRef = planReference(result.planRef) ? result.planRef : null;
        renderPlan(fresh); ui.status.textContent = lifecycleReason('E_PLAN_STALE').message;
      } else if (result.receipt) {
        const receipt = publicLifecycleReceipt(result.receipt, snapshot); if (!receipt) throw new Error('Invalid receipt');
        const expectedStatus = receipt.deferred ? 'pending' : (receipt.action === 'stop' ? receipt.ok : receipt.removedDir && !receipt.incomplete && !receipt.retention?.branchDeletionSkipped) ? 'complete' : 'partial';
        if (result.status !== expectedStatus) throw new Error('Invalid outcome');
        ui.status.textContent = receipt.deferred ? 'Retirement is deferred; no completed removal is established.'
          : result.status === 'complete' ? 'Kernel operation completed.' : 'Not every requested effect completed. Review the recorded outcome.';
        if (receipt.action === 'stop') stopped(ui.result, receipt.results);
        else if (!receipt.deferred) {
          stopped(ui.result, receipt.childrenStopped);
          rows(ui.result, [['Home removed', receipt.removedDir], ['Worktree', receipt.retention?.worktree ?? 'Not reported'],
            ['Retained location', receipt.retention?.movedTo ?? null], ['Branch deleted', receipt.retention?.branchDeleted ?? (receipt.branchDeleted ? 'Deletion reported; branch name not provided' : 'No branch deletion reported')],
            ['Recovery location', receipt.recoveryPath]]);
          if (receipt.retention?.branchDeletionSkipped) ui.result.append(node('p', `Branch deletion skipped: expected ${report(receipt.retention.branchDeletionSkipped.expected)}, actual ${report(receipt.retention.branchDeletionSkipped.actual)}. No branch was deleted; home/worktree effects are listed separately.`, 'lifecycle-warning'));
        }
        if (receipt.replayed || result.repeated) ui.result.append(node('p', 'Recorded result for this confirmation, not a new action.', 'lifecycle-note'));
      } else {
        ui.status.textContent = lifecycleReason(result.reason?.code || 'E_OUTCOME_UNKNOWN').message;
        if (result.cause) ui.result.append(node('p', lifecycleReason(result.cause.code).message, 'lifecycle-note'));
        if (result.childrenStopped) {
          const children = stoppedTargets(result.childrenStopped, snapshot.facts?.children || []); if (!children) throw new Error('Invalid child outcomes');
          stopped(ui.result, children);
        }
      }
      if (owns(ref) && result.status !== 'stale') {
        try { Promise.resolve(onSettled(result, ref.target)).catch(() => {}); } catch { /* refresh cannot erase a recorded outcome */ }
      }
    } catch { if (owns(ref)) { submission.uncertain = true; ui.status.textContent = lifecycleReason('E_OUTCOME_UNKNOWN').message; } }
    finally { if (owns(ref)) { applying = false; locks(); } }
  }
  function open({ operation: next, instance, workspace }) {
    close({ restoreFocus: false }); if (!alive || !['stop', 'retire'].includes(next)) return;
    target = gitTarget({ workspace, instance: instance?.instance, agent: instance?.agent, agentsRoot: instance?.agentsRoot, home: instance?.home, server: instance?.server ?? null });
    if (!target) return;
    onIntent(); restore = takePickerFocusReturn(doc); life++; operation = next;
    choices = next === 'stop' ? { recursive: true } : { discardWorktree: false, deleteBranch: false };
    overlay = node('div', undefined, 'palette-overlay lifecycle-overlay');
    const dialog = node('section', undefined, 'lifecycle-dialog'); dialog.dataset.operation = operation;
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', `${next === 'stop' ? 'Stop' : 'Remove'} ${target.instance}?`);
    const heading = node('div', undefined, 'lifecycle-heading'), mark = node('span', undefined, 'lifecycle-mark'); mark.append(iconElement(doc, next === 'stop' ? 'stop' : 'remove', { size: 18 })); mark.setAttribute('aria-hidden', 'true');
    heading.append(mark, node('h2', `${next === 'stop' ? 'Stop' : 'Remove'} ${target.instance}?`));
    const explanation = node('p', '', 'lifecycle-note'), status = node('p', '', 'lifecycle-note'); status.setAttribute('role', 'status');
    const facts = node('div', undefined, 'lifecycle-facts'), options = node('div', undefined, 'lifecycle-options');
    function choice(label, checked) { const line = node('label'), input = node('input'); input.type = 'checkbox'; input.checked = checked; line.append(input, node('span', label)); options.append(line); return input; }
    const recursive = choice('Include recorded children', true), discard = choice('Also delete the worktree', false), branch = choice('Also delete the local branch (requires worktree deletion)', false);
    recursive.parentElement.hidden = next !== 'stop'; discard.parentElement.hidden = branch.parentElement.hidden = next !== 'retire';
    const mounted = life, mountedGeneration = generation();
    const current = () => alive && overlay && life === mounted && dialog.isConnected && generation() === mountedGeneration;
    const changed = event => {
      if (!current() || !event.target.isConnected || event.target.disabled || applying) return; onIntent();
      if (operation === 'stop') choices = { recursive: recursive.checked };
      else { if (!discard.checked) branch.checked = false; choices = { discardWorktree: discard.checked, deleteBranch: branch.checked }; }
      void refresh();
    };
    for (const input of [recursive, discard, branch]) input.addEventListener('change', changed);
    const forge = node('div', undefined, 'lifecycle-forge'), result = node('div', undefined, 'lifecycle-result'), footer = node('div', undefined, 'lifecycle-footer');
    const button = (label, action, cls) => { const b = node('button', label, cls); b.type = 'button';
      b.addEventListener('click', () => {
        if (cls === 'lifecycle-close' && alive && overlay && life === mounted && b.isConnected) { close({ restoreFocus: generation() === mountedGeneration }); return; }
        if (current() && b.isConnected && !b.disabled) action();
      }); return b; };
    const refreshButton = button('Refresh plan', () => { onIntent(); void refresh(); }), closeButton = button('Close', () => close(), 'lifecycle-close');
    const confirmButton = button(next === 'stop' ? 'Stop' : 'Remove instance', () => void apply(), 'lifecycle-confirm');
    const retryButton = button('Check recorded result', () => void apply(true), 'lifecycle-retry');
    footer.append(refreshButton, retryButton, closeButton, confirmButton); dialog.append(heading, explanation, status, facts, options, forge, result, footer); overlay.append(dialog); doc.body.append(overlay);
    ui = { explanation, status, facts, forge, result, recursive, discard, branch, confirm: confirmButton, refresh: refreshButton, close: closeButton, retry: retryButton };
    overlay.addEventListener('keydown', event => {
      if (!current()) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key !== 'Tab') return;
      const visible = el => { for (let n = el; n && n !== dialog; n = n.parentElement) if (n.hidden) return false; return true; };
      const all = [...dialog.querySelectorAll('button,input,a')].filter(el => !el.disabled && el.tabIndex >= 0 && visible(el));
      if (event.shiftKey && doc.activeElement === all[0]) { event.preventDefault(); all.at(-1)?.focus(); }
      else if (!event.shiftKey && doc.activeElement === all.at(-1)) { event.preventDefault(); all[0]?.focus(); }
    });
    applyFocus(() => closeButton.focus()); locks(); void refresh();
  }
  const off = subscribeWorkspace(() => close({ restoreFocus: false }));
  const offConnections = subscribeConnections(() => {
    if (!overlay || operation !== 'retire' || !plan || applying) return;
    ui.forge.replaceChildren(node('p', 'Pull request: unknown. The connection changed; refreshing informational facts.', 'lifecycle-note'));
    void overlayForge(capture(), plan);
  });
  return { open, close, dispose() { close({ restoreFocus: false }); alive = false; off(); offConnections(); } };
}
