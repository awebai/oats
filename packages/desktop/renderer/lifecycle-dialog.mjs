import { takePickerFocusReturn } from './overlay-picker.mjs';
import { gitTarget, gitTargetKey } from './instance-git-contract.mjs';
import { lifecyclePlan, lifecycleOptions, planReference, lifecycleReason, lifecycleDetailCode, publicLifecycleReceipt, stoppedTargets, lifecycleChoicesApplicable } from './lifecycle-contract.mjs';
import { projectedPullRequest } from './forge-contract.mjs';
import { iconElement } from './shell-icons.mjs';
import { codeLineNodes, readingFrom, remoteReason, serverLabel } from './remote-address.mjs';
import { cleanLine, displayLine } from './display-text.mjs';
import { skeleton, observedAgeText, AGE_TICK_MS } from './loading.mjs';
export const lifecycleCSS = `
.lifecycle-dialog { width:min(420px,calc(100vw - 32px)); max-height:88vh; overflow:auto; display:flex; flex-direction:column; gap:14px; padding:20px; border:1px solid var(--border); border-radius:12px; background:var(--surface); color:var(--fg); box-shadow:var(--shadow-popover); font-size:12.5px; }
.lifecycle-dialog h2 { margin:0; font-size:15px; line-height:1.3; font-weight:700; overflow-wrap:anywhere; }
.lifecycle-dialog h3 { margin:0; font-size:11.5px; font-weight:650; color:var(--muted); }
.lifecycle-heading { display:flex; gap:14px; align-items:center; }
/* The title and the status line under it share a column tall enough for both, so a status that comes and goes moves nothing below. */
.lifecycle-titles { flex:1; min-width:0; min-height:42px; display:flex; flex-direction:column; justify-content:center; gap:2px; }
.lifecycle-mark { flex:none; width:36px; height:36px; border-radius:10px; display:grid; place-items:center; background:var(--surface-2); color:var(--danger); font-size:16px; }
.lifecycle-mark[data-tone=ok] { color:var(--ok); }
.lifecycle-dialog p { margin:0; line-height:1.5; overflow-wrap:anywhere; }
.lifecycle-dialog a { color:var(--accent); overflow-wrap:anywhere; }
.lifecycle-dialog .lifecycle-note, .lifecycle-dialog dt, .lifecycle-dialog .lifecycle-path { color:var(--muted); }
.lifecycle-dialog .lifecycle-path { display:block; font-size:11.5px; user-select:text; overflow-wrap:anywhere; }
.lifecycle-dialog .lifecycle-warning { color:var(--danger); }
.lifecycle-dialog .lifecycle-attention { color:var(--warn); }
.lifecycle-section { display:grid; gap:6px; }
.lifecycle-dialog[data-phase=running] .lifecycle-happen { color:var(--muted); }
.lifecycle-dialog .lifecycle-facts, .lifecycle-dialog .lifecycle-options { padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--surface-2); display:grid; gap:8px; }
.lifecycle-dialog dl { display:grid; grid-template-columns:auto minmax(0,1fr); gap:6px 10px; margin:0; }
.lifecycle-dialog dd { margin:0; overflow-wrap:anywhere; }
.lifecycle-dialog ul { margin:0; padding-left:18px; }
.lifecycle-dialog li { margin:6px 0; overflow-wrap:anywhere; }
.lifecycle-skeleton { display:grid; gap:9px; padding:3px 0; }
.lifecycle-skeleton .skeleton-line:nth-child(2n) { width:75%; }
.lifecycle-skeleton .skeleton-line:nth-child(3n) { width:45%; }
.lifecycle-status { display:flex; gap:8px; align-items:center; }
.lifecycle-dialog .spinner { flex:none; width:14px; height:14px; box-sizing:border-box; border:2px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:oats-spin .7s linear infinite; }
.lifecycle-sr { position:absolute; width:1px; height:1px; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
.lifecycle-dialog label { display:flex; gap:8px; align-items:flex-start; }
.lifecycle-dialog label[hidden] { display:none; }
.lifecycle-dialog input { accent-color:var(--accent); }
.lifecycle-dialog button { height:32px; padding:0 14px; border:1px solid var(--border); border-radius:7px; background:var(--surface); color:var(--fg); font:inherit; font-size:12.5px; font-weight:600; cursor:pointer; }
.lifecycle-dialog button:disabled { color:var(--faint); background:var(--surface-2); cursor:default; }
.lifecycle-dialog button:focus-visible { background:var(--sel); }
.lifecycle-dialog .lifecycle-confirm:not(:disabled), .lifecycle-dialog .lifecycle-done:not(:disabled) { background:var(--primary-bg); color:var(--primary-fg); }
/* Done paints its own opaque pair, so it keeps it under keyboard focus and its edge sits outside (theme.css :focus-visible). */
.lifecycle-dialog .lifecycle-done:focus-visible { outline-offset:1px; }
.lifecycle-dialog[data-operation=retire] .lifecycle-confirm:not(:disabled) { background:var(--danger); color:var(--primary-fg); }
.lifecycle-dialog .lifecycle-check { height:auto; padding:0 2px; border:0; border-radius:4px; background:none; color:var(--accent); font-weight:600; text-decoration:underline; }
.lifecycle-footer { display:flex; align-items:center; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
.lifecycle-dialog [hidden] { display:none; }
`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const names = values => values.map(v => v.instance).join(', ');
/** What a person reads for a session: whether it runs, never the backend's raw state word. */
const sessionText = s => !s.established ? "Unknown (couldn't be checked)" : s.present ? 'Running' : 'Not running';
/** The kernel's reason for unobserved work is a code or a sentence for operators (E_NO_WORKTREE, a path):
 * never inline, only in the row's title. */
const workText = w => !w.observed ? "Unknown (couldn't be checked)" : !w.changed && !w.untracked ? 'None'
  : [w.changed && `${w.changed} changed`, w.untracked && `${w.untracked} untracked`].filter(Boolean).join(', ');
/** The worktree's branch as observed, else the one recorded at spawn; null when detached or unknown. */
const branchOf = f => f.work.observed ? f.work.branch : f.recordedBranch;
/** A retire the kernel refuses as busy for a home a spawn left (`rollbackIncomplete`): the spawn may still run. */
const LEFTOVER_BUSY = "OATS can't confirm that the spawn which left this home has stopped, so it won't retire it yet. Check the process it names, then retire it from the CLI with --force.";
const ambiguousText = v => `Not included: ${v.instance} (another instance has the same parent name, so OATS can't tell whose child it is).`;
let dialogs = 0;
/** A fresh explicit confirmation every time; no Don't-ask-again bypass.
 * One phase decides which controls exist (loading, review, updating, running, done, result); the ownership
 * guards (life, ticket, owns, submission, generation) decide whether an answer may paint at all. Every node
 * is built once per modal and updated in place, so a repaint never rebuilds the focused control. */
export function createLifecycleDialog({ doc, request, gitRequest, forgeRequest, generation = () => 0,
  subscribeWorkspace = () => () => {}, subscribeConnections = () => () => {}, connectionGeneration = () => 0,
  onIntent = () => {}, applyFocus = fn => fn(), onSettled = () => {}, openExternal = () => {}, fallbackFocus = () => null } = {}) {
  let alive = true, overlay = null, ui = null, target = null, operation = null, choices = null, plan = null, planRef = null, server = null;
  // The row the dialog was opened for is a home a failed spawn left (quarantined, `rollbackIncomplete`).
  let leftover = false;
  let life = 0, ticket = 0, applying = false, restore = null, submission = null, phase = null, shown = null, ticker = null;
  const node = (tag, text, cls) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const capture = () => ({ life, ticket, generation: generation(), target, overlay });
  const owns = ref => alive && overlay && ref.overlay === overlay && overlay.isConnected && ref.life === life && ref.ticket === ticket
    && ref.generation === generation() && ref.target === target;
  const selector = () => ({ instance: target.instance, agent: target.agent, agentsRoot: target.agentsRoot, server: target.server });
  const retire = () => operation === 'retire';
  const question = () => `${retire() ? 'Retire' : 'Stop'} ${target.instance}?`;
  function close({ restoreFocus = true } = {}) {
    if (!overlay) return;
    life++; ticket++; overlay.remove(); overlay = null; ui = null; prLink = null; target = null; plan = null; planRef = null; applying = false; submission = null; phase = null; shown = null;
    clearInterval(ticker); ticker = null;
    // The opener (or a control with its identity), else the host's fallback (a retired row's successor in the
    // roster), else the generic return (a control near where the opener was), never <body>.
    if (restoreFocus) {
      const back = restore;
      applyFocus(() => {
        if (back?.restoreExact ? back.restoreExact() : back?.restore()) return;
        const fallback = fallbackFocus(); fallback?.focus?.();
        if (!fallback || doc.activeElement !== fallback) back?.restore();
      });
    }
    restore = null;
  }
  const say = text => { ui.statusText.textContent = text; };
  const title = text => { ui.title.textContent = text; };
  const isShown = el => { for (let n = el; n && n !== ui.dialog; n = n.parentElement) if (n.hidden) return false; return !!el?.isConnected; };
  const focusOn = el => applyFocus(() => el.focus());
  /** Show the controls this phase has, and only those. A control that cannot act now names why beside it. */
  function paint() {
    if (!ui) return;
    // What had focus before any control is hidden: Chromium blurs a control the moment it is hidden (jsdom does not).
    const had = ui.dialog.contains(doc.activeElement) ? doc.activeElement : null;
    const before = ['loading', 'review', 'updating'].includes(phase), planned = phase === 'review' || phase === 'updating';
    ui.dialog.dataset.phase = phase;
    ui.happenSection.hidden = !before && phase !== 'running';
    ui.stateSection.hidden = !before;
    for (const region of [ui.happen, ui.facts]) region.setAttribute('aria-busy', String(phase === 'loading' || phase === 'updating'));
    const option = shown && (retire() ? shown.facts.workMode === 'worktree' || choices.discardWorktree : true);
    ui.options.hidden = !(phase === 'loading' || planned && option);
    ui.optionSkeleton.hidden = phase !== 'loading';
    ui.recursive.parentElement.hidden = phase === 'loading' || retire(); ui.discard.parentElement.hidden = phase === 'loading' || !retire();
    ui.observed.hidden = !planned;
    ui.result.hidden = !['done', 'result'].includes(phase); ui.continues.hidden = phase !== 'running';
    ui.spinner.hidden = phase !== 'running';
    ui.status.classList.toggle('lifecycle-sr', phase === 'done');
    ui.status.hidden = !ui.statusText.textContent;
    ui.close.hidden = phase === 'done'; ui.close.textContent = before ? 'Cancel' : 'Close';
    ui.confirm.hidden = !before;
    const applicable = !!plan && lifecycleChoicesApplicable(plan, choices);
    ui.confirm.disabled = phase !== 'review' || !planRef || !applicable;
    if (phase === 'review' && plan && !applicable) say(lifecycleReason('E_OPTION_UNAVAILABLE').message);
    ui.status.hidden = !ui.statusText.textContent;
    if (!ui.confirm.hidden && ui.confirm.disabled) ui.confirm.setAttribute('aria-describedby', ui.status.id); else ui.confirm.removeAttribute('aria-describedby');
    ui.retry.hidden = !(phase === 'result' && submission?.uncertain);
    ui.review.hidden = !(phase === 'result' && !submission?.uncertain);
    ui.done.hidden = phase !== 'done';
    // A control that leaves while it has focus hands focus to the button that stays.
    const active = doc.activeElement;
    if (had && (!isShown(had) || active !== had) && (!active || active === doc.body || !isShown(active))) focusOn(phase === 'done' ? ui.done : ui.close);
  }
  /** A local reason's code and the CLI's own message, re-validated here (main relays the server's reply as it
   * is), or null: a code that may show one (lifecycleDetailCode) and a detail that is already a display line.
   * The headline stays the fixed sentence for the code; the detail is only ever shown, in Details. */
  const localDetail = reason => reason && typeof reason === 'object' && !Object.hasOwn(reason, 'remote')
    && lifecycleDetailCode(reason.code) && cleanLine(reason.detail) ? { code: reason.code, detail: reason.detail } : null;
  /** A reason's code and the kernel's message, behind a Details disclosure (keyboard and screen reader
   * reachable). The code is text; the message is alone in its <bdi> (remote-address.mjs codeLineNodes). */
  function details(parent, reason) {
    if (!reason.detail) return;
    const more = node('details', undefined, 'lifecycle-details'), line = node('p'); line.append(...codeLineNodes(doc, reason));
    more.append(node('summary', 'Details'), line);
    parent.append(more);
  }
  /** A refusal: a remote host's headline, else the fixed sentence for the code; the code and the kernel's
   * message in Details when there is one to show. */
  function refusal(reason) {
    const remote = remoteReason(reason), shownReason = remote || localDetail(reason);
    // The kernel's own busy refusal (it carries the kernel's message; Desktop's own busy does not) for a home
    // a spawn left: its sentence, and the kernel's message, which names the process, shown under it.
    if (!remote && shownReason && reason.code === 'E_LIFECYCLE_BUSY' && retire() && leftover) {
      say(LEFTOVER_BUSY); const p = node('p'); p.append(node('bdi', shownReason.detail)); ui.result.append(p); return;
    }
    say(remote ? remote.message : lifecycleReason(reason?.code).message);
    if (shownReason) details(ui.result, shownReason);
  }
  /** One line of a list, with an optional path as a muted, selectable second line. */
  const line = (text, path, cls) => { const li = node('li', undefined, cls); li.append(node('span', text)); if (path) li.append(node('span', path, 'lifecycle-path')); return li; };
  const list = lines => { const ul = node('ul'); ul.append(...lines.filter(Boolean)); return ul; };
  /** What will happen, in plain words, built from the plan; each line only when it applies. */
  function happening(value, requested) {
    const lines = [];
    if (value.action === 'stop') {
      const t = value.targets;
      lines.push(line(value.recursive && t.length > 1 ? `Stops ${t.length} sessions, children first: ${names(t)}.` : `Stops the session of ${value.instance}.`));
      lines.push(line('Nothing is deleted. Its home, worktree, transcript and launch settings are kept; you can start it again.'));
      lines.push(line('A session that refuses to stop is left running; nothing is forced.', undefined, 'lifecycle-note'));
      for (const x of t.filter(x => x.midTask === true)) lines.push(line(`${x.instance} reports it is in the middle of a task.`, undefined, 'lifecycle-attention'));
      if (value.skipped.length) lines.push(line(`Not stopped: ${names(value.skipped)} (children not included).`, undefined, 'lifecycle-note'));
      return list(lines);
    }
    const f = value.facts, b = branchOf(f);
    if (f.session.established && f.session.present) lines.push(line('Stops its session.'));
    else if (!f.session.established) lines.push(line("Stops its session, if one is running (its state couldn't be checked)."));
    if (f.children.length) {
      const children = line(`Stops its ${plural(f.children.length, 'child instance')} first: ${names(f.children)}. They are kept, with their homes.`);
      children.title = f.children.map(c => c.home).join('\n'); lines.push(children);
    }
    lines.push(line('Saves a recovery copy of any uncommitted work, then deletes its home folder.', value.home));
    if (f.workMode === 'worktree') lines.push(line(requested.discardWorktree ? `Deletes its worktree.${stays(b)}`
      : `Keeps its worktree, moved aside${b ? `, on branch ${b}` : ''}.`));
    // A home a spawn left (rollbackIncomplete): retire finishes its compensation, which deletes the branch
    // the spawn created when it holds no work (the result's spawnCompensation says which).
    lines.push(line(leftover ? 'Branches and pull requests are not changed, except a branch an interrupted spawn left with no work, which is deleted.'
      : 'Branches and pull requests are not changed.'));
    if (f.children.length) lines.push(line("If a child won't stop, nothing is retired.", undefined, 'lifecycle-note'));
    return list(lines);
  }
  /** Current state: a compact two-column list of plain values, then what is not included and why. */
  function current(value) {
    const dl = node('dl'), notes = [];
    const row = (label, value, title = '') => { const dd = node('dd', value); if (title) dd.title = title; dl.append(node('dt', label), dd); };
    if (value.action === 'stop') {
      for (const t of value.targets) row(t.instance, sessionText(t.session));
      for (const v of value.ambiguous) notes.push(node('p', ambiguousText(v), 'lifecycle-note'));
    } else {
      const f = value.facts;
      row('Session', sessionText(f.session));
      // Without a worktree of its own there is no Git work to report: the recovery line under What will happen covers it.
      if (f.work.observed || f.workMode === 'worktree') row('Uncommitted work', workText(f.work), f.work.observed ? '' : f.work.reason);
      if (f.work.observed) row('Branch', f.work.detached ? 'Detached' : f.work.branch);
      if (f.work.observed && f.work.drift) notes.push(node('p', `The worktree is on ${f.work.detached ? 'a detached commit' : f.work.branch}, not the branch it was spawned on${f.recordedBranch ? ` (${f.recordedBranch})` : ''}.`, 'lifecycle-attention'));
      for (const v of f.ambiguous) { const p = node('p', ambiguousText(v), 'lifecycle-note'); p.title = v.home; notes.push(p); }
    }
    return [dl, ...notes];
  }
  /** The warning under a checked "Also delete the worktree": in words, not colour alone. */
  function discardWarning(value) {
    const f = value.facts, n = f.work.observed ? f.work.changed + f.work.untracked : null;
    const including = n === null ? ', including uncommitted changes, if any (a recovery copy is saved first)'
      : n ? `, including ${plural(n, 'uncommitted change')} (a recovery copy is saved first)` : '';
    return `Deletes the worktree folder${including}.${stays(branchOf(f))}`;
  }
  /** Deleting the worktree keeps its branch, except on a leftover row: there the kernel deletes the branch the
   * interrupted spawn created when it holds no work, so the plan's next line is the only word on branches. */
  const stays = b => b && !leftover ? ` Branch ${b} stays in the repository.` : '';
  /** What a PR row is correlated to: the observed revision and branch, and the remote's host and path. Null
   * when the work is not observed (no PR row then). The connection account is held beside it, on the link. */
  const correlation = value => value?.action === 'retire' && value.facts.work.observed
    ? JSON.stringify([value.facts.work.revision, value.facts.work.branch, value.facts.work.remote?.host ?? null, value.facts.work.remote?.path ?? null]) : null;
  /** The PR row's link, or null: { anchor, url, account, key }. Its click reads this record, never the read
   * that drew it, so a link kept across a plan swap stays live exactly while its correlation and account hold. */
  let prLink = null;
  /** Replace the PR row. A focused link that leaves hands focus to the new link, else to Cancel (Close). */
  function setForge(nodes = [], link = null) {
    if (!ui) return;
    const focused = ui.forge.contains(doc.activeElement);
    ui.forge.replaceChildren(...nodes); prLink = link;
    if (focused) focusOn(link?.anchor ?? ui.close);
  }
  /** Swap a plan in, atomically: the previous facts stay on screen until this one replaces them. */
  function renderPlan(value, requested) {
    // The PR row is kept across a swap with the same correlation (and re-read); any other swap drops it.
    if (correlation(shown) === null || correlation(shown) !== correlation(value)) setForge();
    ui.happen.replaceChildren(happening(value, requested)); ui.facts.replaceChildren(...current(value));
    ui.warning.textContent = retire() && requested.discardWorktree ? discardWarning(value) : ''; ui.warning.hidden = !ui.warning.textContent;
    if (!retire()) ui.confirm.textContent = value.targets.length > 1 ? 'Stop sessions' : 'Stop session';
    shown = value; age();
  }
  const age = () => { if (shown && ui) ui.observedText.textContent = `Observed ${observedAgeText(shown.at) ?? 'earlier'}`; };
  function skeletons() {
    const bones = node('div', undefined, 'lifecycle-skeleton'); bones.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 4; i++) bones.append(skeleton(doc, 'line'));
    const facts = bones.cloneNode(false); for (let i = 0; i < 3; i++) facts.append(skeleton(doc, 'line'));
    ui.happen.replaceChildren(bones); ui.facts.replaceChildren(facts); setForge(); shown = null;
  }
  function validTarget(result, ref) {
    return result?.lifecycleApi === 1 && result.target && gitTargetKey(result.target) === gitTargetKey(ref.target);
  }
  async function overlayForge(ref, snapshot) {
    const account = connectionGeneration(), key = correlation(snapshot);
    const current = () => owns(ref) && plan === snapshot && !applying && account === connectionGeneration();
    // What this read cannot confirm is unknown: the row is left out, a row kept from the previous plan too.
    const unknown = () => { if (current()) setForge(); };
    if (!retire() || key === null || !gitRequest || !forgeRequest) { unknown(); return; }
    const row = (...value) => { const dl = node('dl'), dd = node('dd'); dd.append(...value); dl.append(node('dt', 'Pull request'), dd); return dl; };
    try {
      const git = await gitRequest(ref.target.workspace, { action: 'git', selector: selector() });
      if (!current()) return;
      const expected = snapshot.facts.work, observed = git?.data?.observation;
      if (!git.target || gitTargetKey(git.target) !== gitTargetKey(ref.target) || git.status !== 'available' || !planReference(git.observationKey)
        || observed?.revision !== expected.revision || observed.branch !== expected.branch) { unknown(); return; }
      const result = await forgeRequest(ref.target.workspace, { selector: selector(), observationKey: git.observationKey });
      if (!current()) return;
      if (result?.forgeApi !== 1 || !result.target || gitTargetKey(result.target) !== gitTargetKey(ref.target)
        || result.observation?.key !== git.observationKey || result.observation.revision !== expected.revision || result.observation.branch !== expected.branch
        || result.host !== expected.remote?.host || result.repository !== expected.remote?.path) { unknown(); return; }
      const pr = result.status === 'available' ? projectedPullRequest(result.data, { host: result.host, path: result.repository, branch: expected.branch }) : null;
      if (result.status === 'no-pull-request' && result.data === null) setForge([row('None for this branch')]);
      else if (pr) {
        const text = `#${pr.number} · ${pr.title} · ${pr.state}`;
        // The same PR as the link on screen: keep the node, and with it any focus on it.
        if (prLink?.url === pr.url && prLink.key === key && prLink.anchor.textContent === text && prLink.anchor.isConnected) { prLink.account = account; return; }
        const a = node('a', text); a.href = pr.url; a.rel = 'noopener noreferrer';
        const link = { anchor: a, url: pr.url, account, key };
        a.addEventListener('click', event => {
          event.preventDefault();
          if (prLink === link && a.isConnected && alive && overlay === ref.overlay && life === ref.life && generation() === ref.generation && !applying
            && link.account === connectionGeneration() && link.key === correlation(plan ?? shown)) openExternal(link.url);
        });
        setForge([row(a, ' (not changed)')], link);
      } else unknown();
    } catch { unknown(); }
  }
  /** A result: a plain title, the headline in the status line, and one way forward where the contract allows it. */
  function settle(next, heading) {
    phase = next; title(heading); paint();
    focusOn(next === 'done' ? ui.done : ui.close);
  }
  /** Read a plan. With facts on screen they stay there (aria-busy) until the new plan replaces them;
   * otherwise the skeleton holds their place. The reference on screen is revoked at once either way. */
  async function refresh(why = 'option') {
    if (!overlay || applying) return;
    ticket++; const ref = capture(), requested = { ...choices }, keep = !!shown && (phase === 'review' || phase === 'updating');
    plan = null; planRef = null; submission = null; ui.result.replaceChildren();
    if (keep) { phase = 'updating'; say(why === 'check' ? 'Checking again…' : 'Updating for this choice…'); }
    else { phase = 'loading'; skeletons(); title(question()); say(server ? readingFrom(server) : `Checking what ${retire() ? 'retiring' : 'stopping'} ${target.instance} will do…`); }
    paint();
    const failed = reason => { phase = 'result'; skeletons(); ui.result.replaceChildren(); refusal(reason);
      settle('result', `Couldn't check what ${retire() ? 'retiring' : 'stopping'} ${target.instance} will do`); };
    try {
      const result = await request(ref.target.workspace, { action: 'plan', operation, selector: selector(), options: requested });
      if (!owns(ref)) return;
      if (!validTarget(result, ref) || result.status !== 'plan') { failed(validTarget(result, ref) ? result.reason : { code: result?.reason?.code }); return; }
      const value = lifecyclePlan(result.plan, ref.target, operation, requested);
      if (!value || !planReference(result.planRef) || JSON.stringify(lifecycleOptions(operation, result.options)) !== JSON.stringify(requested)) throw new Error('Invalid plan');
      plan = value; planRef = result.planRef; renderPlan(plan, requested); phase = 'review'; say(''); paint(); void overlayForge(ref, plan);
    } catch { if (owns(ref)) failed({ code: 'E_CLI_PROTOCOL' }); }
  }
  function stopped(values) {
    return list(values.map(v => line(`${v.instance}: ${v.ok ? v.alreadyIdle ? 'Was already stopped' : 'Stopped'
      : `Didn't stop${v.stillRunning?.length ? ` (still running: ${v.stillRunning.join(', ')})` : ''}`}`)));
  }
  /** What a retire receipt says happened, each fact on its own line; paths as muted, selectable text. */
  function retired(receipt, snapshot, complete) {
    const r = receipt.retention, children = receipt.childrenStopped;
    return list([complete && snapshot.facts.session.present === true && line('Session stopped.'),
      children.length && line(`${plural(children.length, 'child instance')} stopped and kept.`),
      line(receipt.removedDir ? 'Home folder deleted.' : 'Home folder kept.', receipt.removedDir ? undefined : receipt.retainedHome ?? undefined),
      r?.worktree === 'retained' && line('Worktree kept at', r.movedTo), r?.worktree === 'removed' && line('Worktree deleted.'),
      receipt.recoveryPath && line('Recovery copy saved at', receipt.recoveryPath),
      compensated(receipt.spawnCompensation),
      receipt.incomplete && line("Cleanup didn't finish.")]);
  }
  /** The branch an interrupted spawn left, which this retire deleted or kept (spawnCompensation); else nothing. */
  function compensated(c) {
    const branch = displayLine(c?.branch);
    if (!branch) return null;
    return line(c.branchDeleted ? `Branch ${branch} deleted: an interrupted spawn left it, and it held no work.`
      : `Branch ${branch} kept: ${displayLine(c.reason) ?? 'no reason given'}`);
  }
  async function apply(retry = false) {
    if (!overlay || applying || (retry ? !submission || phase !== 'result' : phase !== 'review' || !plan || !planRef || !lifecycleChoicesApplicable(plan, choices))) return;
    onIntent(); ticket++; const ref = capture(), snapshot = retry ? submission.plan : plan, selectedRef = retry ? submission.reference : planRef;
    submission = { reference: selectedRef, plan: snapshot, uncertain: true };
    const name = target.instance, verb = retire() ? 'Retiring' : 'Stopping';
    applying = true; planRef = null; ui.result.replaceChildren(); phase = 'running'; title(`${verb} ${name}…`);
    say(retire() ? `Retiring ${name}. This can take up to a minute while sessions stop.` : `Stopping ${name}. This can take up to a minute.`);
    paint(); focusOn(ui.close);
    const unconfirmed = 'Result not confirmed', didNot = `${name} wasn't ${retire() ? 'retired' : 'stopped'}`;
    try {
      const result = await request(ref.target.workspace, { action: 'apply', planRef: selectedRef });
      if (!owns(ref)) return;
      if (!validTarget(result, ref)) { say(lifecycleReason('E_OUTCOME_UNKNOWN').message); settle('result', unconfirmed); return; }
      submission.uncertain = ['unknown', 'pending'].includes(result.status);
      if (result.status === 'stale') {
        const fresh = lifecyclePlan(result.plan, ref.target, operation, choices);
        if (!fresh) throw new Error('Invalid fresh plan');
        plan = fresh; planRef = planReference(result.planRef) ? result.planRef : null;
        renderPlan(fresh, choices); say(lifecycleReason('E_PLAN_STALE').message); phase = 'review'; title(question()); paint(); focusOn(ui.close);
        void overlayForge(capture(), fresh);
      } else if (result.receipt) {
        const receipt = publicLifecycleReceipt(result.receipt, snapshot); if (!receipt) throw new Error('Invalid receipt');
        const expectedStatus = receipt.deferred ? 'pending' : (receipt.action === 'stop' ? receipt.ok : receipt.removedDir && !receipt.incomplete) ? 'complete' : 'partial';
        if (result.status !== expectedStatus) throw new Error('Invalid outcome');
        const replay = receipt.replayed || result.repeated ? node('p', 'This is the result already recorded for this confirmation; nothing ran again.', 'lifecycle-note') : null;
        if (receipt.deferred) {
          say('Retirement was accepted and will finish in the background. Check the roster for its result.');
          if (replay) ui.result.append(replay); settle('result', 'Retirement accepted');
        } else if (result.status === 'complete') {
          const stopTitle = receipt.action === 'stop' && receipt.results.length > 1 ? `${receipt.results.length} sessions stopped` : `${name} ${retire() ? 'retired' : 'stopped'}`;
          ui.result.append(receipt.action === 'stop' ? stopped(receipt.results) : retired(receipt, snapshot, true)); if (replay) ui.result.append(replay);
          say(`${stopTitle}.`); ui.mark.replaceChildren(iconElement(doc, 'check', { size: 18 })); ui.mark.dataset.tone = 'ok';
          settle('done', stopTitle);
        } else {
          say(receipt.action === 'stop' ? 'Not every session stopped:' : "Retirement didn't finish. Some steps ran:");
          ui.result.append(receipt.action === 'stop' ? stopped(receipt.results) : retired(receipt, snapshot, false)); if (replay) ui.result.append(replay);
          settle('result', receipt.action === 'stop' ? 'Not every session stopped' : "Retirement didn't finish");
        }
      } else {
        refusal(result.reason?.code ? result.reason : { code: 'E_OUTCOME_UNKNOWN' });
        // Why the outcome is unknown: a remote transport or host cause keeps its headline and Details; a
        // local one says its fixed sentence, with the CLI's own message in Details when it carries one.
        const cause = result.cause && remoteReason(result.cause);
        if (cause) { ui.result.append(node('p', cause.message, 'lifecycle-note')); details(ui.result, cause); }
        else if (result.cause) {
          ui.result.append(node('p', lifecycleReason(result.cause.code).message, 'lifecycle-note'));
          const local = localDetail(result.cause); if (local) details(ui.result, local);
        }
        if (result.childrenStopped) {
          const children = stoppedTargets(result.childrenStopped, snapshot.facts?.children || []); if (!children) throw new Error('Invalid child outcomes');
          ui.result.append(node('p', 'Child instances:', 'lifecycle-note'), stopped(children));
        }
        settle('result', submission.uncertain ? unconfirmed : didNot);
      }
      if (owns(ref) && result.status !== 'stale') {
        try { Promise.resolve(onSettled(result, ref.target)).catch(() => {}); } catch { /* refresh cannot erase a recorded outcome */ }
      }
    } catch {
      if (owns(ref)) { submission.uncertain = true; ui.result.replaceChildren(); say(lifecycleReason('E_OUTCOME_UNKNOWN').message); settle('result', unconfirmed); }
    } finally { if (owns(ref)) { applying = false; paint(); } }
  }
  function open({ operation: next, instance, workspace }) {
    close({ restoreFocus: false }); if (!alive || !['stop', 'retire'].includes(next)) return;
    target = gitTarget({ workspace, instance: instance?.instance, agent: instance?.agent, agentsRoot: instance?.agentsRoot, home: instance?.home, server: instance?.server ?? null });
    if (!target) return;
    server = target.server ? serverLabel(instance) : null; leftover = instance?.rollbackIncomplete === true;
    onIntent(); restore = takePickerFocusReturn(doc); life++; operation = next;
    choices = next === 'stop' ? { recursive: true } : { discardWorktree: false };
    const id = `lifecycle-${++dialogs}`;
    overlay = node('div', undefined, 'palette-overlay lifecycle-overlay');
    const dialog = node('section', undefined, 'lifecycle-dialog'); dialog.dataset.operation = operation;
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', `${id}-title`);
    const heading = node('div', undefined, 'lifecycle-heading'), mark = node('span', undefined, 'lifecycle-mark'); mark.append(iconElement(doc, next === 'stop' ? 'stop' : 'remove', { size: 18 })); mark.setAttribute('aria-hidden', 'true');
    const h2 = node('h2'); h2.id = `${id}-title`;
    const status = node('p', undefined, 'lifecycle-status'), spinner = node('span', undefined, 'spinner'), statusText = node('span');
    status.id = `${id}-status`; status.setAttribute('role', 'status'); spinner.setAttribute('aria-hidden', 'true'); status.append(spinner, statusText);
    const titles = node('div', undefined, 'lifecycle-titles'); titles.append(h2, status); heading.append(mark, titles);
    const section = (label, region) => { const s = node('section', undefined, 'lifecycle-section'), h = node('h3', label); h.id = `${id}-${region.className}`;
      s.setAttribute('aria-labelledby', h.id); s.append(h, region); return s; };
    const happen = node('div', undefined, 'lifecycle-happen'), facts = node('div', undefined, 'lifecycle-facts'), forge = node('div', undefined, 'lifecycle-forge');
    const happenSection = section('What will happen', happen), stateSection = section('Current state', facts); facts.after(forge);
    const options = node('div', undefined, 'lifecycle-options'), optionSkeleton = skeleton(doc, 'line', { width: '55%' });
    function choice(label, checked) { const line = node('label'), input = node('input'); input.type = 'checkbox'; input.checked = checked; line.append(input, node('span', label)); options.append(line); return input; }
    options.append(optionSkeleton);
    const recursive = choice('Include child instances', true), discard = choice('Also delete the worktree', false);
    const warning = node('p', '', 'lifecycle-warning'); warning.hidden = true; options.append(warning);
    const mounted = life, mountedGeneration = generation();
    const current = () => alive && overlay && life === mounted && dialog.isConnected && generation() === mountedGeneration;
    // The checkbox stays enabled while a plan is read: the latest choice wins, and tickets drop older answers.
    const changed = event => {
      if (!current() || !event.target.isConnected || event.target.disabled || applying) return; onIntent();
      if (operation === 'stop') choices = { recursive: recursive.checked };
      else choices = { discardWorktree: discard.checked };
      void refresh('option');
    };
    for (const input of [recursive, discard]) input.addEventListener('change', changed);
    const result = node('div', undefined, 'lifecycle-result'), footer = node('div', undefined, 'lifecycle-footer');
    const continues = node('p', `You can close this window; ${retire() ? 'retirement' : 'stopping'} continues.`, 'lifecycle-note');
    // Close (Cancel before dispatch) and Done close from any generation of this modal; every other control acts only while it owns it.
    const closing = new Set(['lifecycle-close', 'lifecycle-done']);
    const button = (label, action, cls) => { const b = node('button', label, cls); b.type = 'button';
      b.addEventListener('click', () => {
        if (closing.has(cls) && alive && overlay && life === mounted && b.isConnected) { close({ restoreFocus: generation() === mountedGeneration }); return; }
        if (current() && b.isConnected && !b.disabled && isShown(b)) action();
      }); return b; };
    const observed = node('p', undefined, 'lifecycle-observed lifecycle-note'), observedText = node('span');
    const check = button('Check again', () => { onIntent(); void refresh('check'); }, 'lifecycle-check');
    observed.append(observedText, ' ', check);
    const closeButton = button('Cancel', () => close(), 'lifecycle-close'), doneButton = button('Done', () => close(), 'lifecycle-done');
    const confirmButton = button(next === 'stop' ? 'Stop session' : 'Retire instance', () => void apply(), 'lifecycle-confirm');
    const retryButton = button('Check again', () => void apply(true), 'lifecycle-retry');
    const reviewButton = button('Review again', () => { onIntent(); void refresh('review'); }, 'lifecycle-review');
    footer.append(retryButton, reviewButton, closeButton, confirmButton, doneButton);
    dialog.append(heading, happenSection, stateSection, options, observed, result, continues, footer); overlay.append(dialog); doc.body.append(overlay);
    ui = { dialog, title: h2, mark, status, statusText, spinner, happen, happenSection, facts, stateSection, forge, options, optionSkeleton, warning,
      observed, observedText, result, continues, recursive, discard, confirm: confirmButton, close: closeButton, done: doneButton, retry: retryButton, review: reviewButton };
    overlay.addEventListener('keydown', event => {
      if (!current()) return;
      // Esc is the visible way out of each phase (Cancel, Close or Done): it closes, and never cancels a dispatched operation.
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key !== 'Tab') return;
      const all = [...dialog.querySelectorAll('button,input,a,summary')].filter(el => !el.disabled && el.tabIndex >= 0 && isShown(el));
      if (event.shiftKey && doc.activeElement === all[0]) { event.preventDefault(); all.at(-1)?.focus(); }
      else if (!event.shiftKey && doc.activeElement === all.at(-1)) { event.preventDefault(); all[0]?.focus(); }
    });
    // The age line ticks while the modal lives; a Node test host never waits on it (unref).
    ticker = setInterval(() => { if (current()) age(); }, AGE_TICK_MS); ticker?.unref?.();
    phase = 'loading'; applyFocus(() => closeButton.focus()); void refresh('open');
  }
  const off = subscribeWorkspace(() => close({ restoreFocus: false }));
  const offConnections = subscribeConnections(() => {
    if (!overlay || operation !== 'retire') return;
    setForge(); // unknown until the new account answers: the row is left out, also while a plan is read
    if (plan && !applying) void overlayForge(capture(), plan);
  });
  return { open, close, dispose() { close({ restoreFocus: false }); alive = false; off(); offConnections(); } };
}
