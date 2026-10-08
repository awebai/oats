/** Owned offline readiness presentation (readinessApi 2: a soul or an instance;
 * installed · configured · member · providers). No background polling or
 * remediation; a provider's own binding check is shown as it answered.
 *
 * Loading states (desktop/loading-states) come from the shared controller in
 * loading.mjs: the first read of a subject is pending (status "Loading
 * readiness…", a detail-section skeleton in the body after 150ms), a Refresh
 * with a value present keeps the checks in place and shows "Refreshing…"
 * beside the title after 400ms, a failure with a value keeps it and paints the
 * stale line ("Couldn't refresh readiness · observed <age>" + Retry) under the
 * status, and a failure without a value paints the failed block (cause,
 * Details, Retry) where the skeleton stood. The visible `.readiness-status` is
 * the controller's status line; the summary (Ready / failing counts) has its
 * own `.readiness-summary` line so an announcement never overwrites it. */
import { postJson, workspaceGeneration } from './views/common.mjs';
import { createDataState, skeletonBlock, captureFocusState } from './loading.mjs';
import { CHECKS, readinessSelector, readinessSupported, readinessTarget, readinessData, readinessFailure } from './readiness-contract.mjs';
import { originText } from './inspect-contract.mjs';
import { iconElement } from './shell-icons.mjs';
import { readingFrom, remoteReason } from './remote-address.mjs';
import { createWarningsList, capabilityWarningsCSS, WARNINGS_COPY } from './capability-warnings.mjs';
export const readinessCSS = `
${capabilityWarningsCSS}
.readiness-view { color:var(--fg); min-width:0; margin:18px 0; font-size:12px; line-height:1.5; }
.readiness-view[hidden], .readiness-view [hidden] { display:none; }
.readiness-view h2 { font-size:14px; margin:0; }
.readiness-more > summary { cursor:pointer; font-size:12px; color:var(--muted); margin:4px 0; }
.readiness-more[open] > summary { margin-bottom:10px; }
.readiness-context, .readiness-note, .readiness-status, .readiness-summary, .readiness-item dt { color:var(--muted); overflow-wrap:anywhere; }
.readiness-view p { margin:4px 0; }
/* The status line keeps its height while it speaks and collapses when silent (mirrors loading.css
   .loading-status); the summary reserves its line from the first read, so data landing shifts nothing. */
.readiness-status, .readiness-summary { min-height:1.5em; }
.readiness-status:empty { min-height:0; }
.readiness-head { display:flex; flex-wrap:wrap; align-items:baseline; gap:10px; }
.readiness-head h2 { flex:none; }
.readiness-indicator:empty, .readiness-notice:empty { display:none; }
.readiness-notice { margin:6px 0; }
.readiness-content:empty { display:none; }
.readiness-checks { border:1px solid var(--border); border-radius:12px; background:var(--surface); overflow:hidden; }
.readiness-check { padding:16px 18px; border-top:1px solid var(--border); }
.readiness-check:first-child { border-top:0; }
.readiness-check-head { display:flex; align-items:center; gap:14px; }
.readiness-check-head h3 { flex:1; margin:0; font-size:13.5px; }
.readiness-badge { display:grid; place-items:center; flex:none; width:28px; height:28px; border-radius:50%; background:var(--surface-2); color:var(--muted); font-weight:700; }
.readiness-badge[data-state=pass] { color:var(--ok); }
.readiness-badge[data-state=fail] { color:var(--danger); }
.readiness-badge[data-state=unknown], .readiness-badge[data-state=sign-in] { color:var(--warn); }
.readiness-item { margin:10px 0; overflow-wrap:anywhere; }
.readiness-item p, .readiness-item dd { margin:2px 0; }
.readiness-item dt { font-size:11px; }
.readiness-view details { margin-top:8px; }
.readiness-view summary { cursor:pointer; }
.readiness-view button { min-height:34px; }
.readiness-actions { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
.soul-inspector .readiness-view { margin-top:16px; }
.soul-inspector .readiness-check { padding:12px 8px; }
/* Capability warnings (0.49.0) after the checks: the list's own spacing, not the view's p and details margins. */
.readiness-warnings { margin-top:14px; }
.readiness-warnings h3 { margin:0 0 8px; font-size:13.5px; }
.readiness-view .cap-warning p { margin:0; }
.readiness-view .cap-warning-details { margin-top:0; }
.readiness-view .readiness-warnings .cap-warnings-more { margin:8px 0 0; }
`;
const label = v => v[0].toUpperCase() + v.slice(1);
/** A kernel `at` in words: `[<repoKey>:]<file>#/<json pointer>` → "oats-workspace.yaml ›
 * teams › engineering, in <repoKey>"; a file with no repo is this computer's; `package:<id>:` is
 * that package's. Pointer segments are unescaped (`~1` is `/`, `~0` is `~`). Unrecognised: as sent. */
export function declaredIn(at) {
  const m = /^(?:(.+):)?([^:#/][^:#]*)#\/(.+)$/.exec(at);
  if (!m) return at;
  const where = `${m[2]} › ${m[3].split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~')).join(' › ')}`;
  const pkg = /^package:(.+)$/.exec(m[1] ?? '');
  return pkg ? `${where}, in the ${pkg[1]} package` : m[1] ? `${where}, in ${m[1]}` : `${where}, on this computer`;
}
const PROVIDER_SAYS = {
  ready: 'The provider says: ready.', 'needs-configuration': 'The provider says: needs configuration.',
  'authorization-required': 'Sign in needed: the provider is set up but is not signed in.', unavailable: 'The provider says: unavailable right now.',
};
const signIn = i => i.result?.status === 'authorization-required';
/** @param {object} [options.clock] `{ now, setTimeout, clearTimeout }` for the loading controller's delays (tests).
 * @param {(name: string) => boolean} [options.canOpenCapability] whether a capability warning's Open capability resolves (the host's inspection)
 * @param {(name: string) => void} [options.openCapability] opens it; absent, no warning shows the action */
export function createReadinessView(host, { ctx, compact = false, clock = {}, canOpenCapability = () => false, openCapability = null } = {}) {
  const doc = host.ownerDocument;
  const node = (tag, value, cls) => { const el = doc.createElement(tag); if (value !== undefined) el.textContent = value; if (cls) el.className = cls; return el; };
  let alive = true, active = false, serial = 0, identity = null, gen = null, state = {}, attempted = false, busy = false, value = null, blocked = '', query = '', painted = null;
  const section = node('section', undefined, 'readiness-view'); section.hidden = true; section.setAttribute('aria-label', 'Effective readiness');
  const heading = node('div', undefined, 'readiness-head'), title = node('h2', 'Readiness'), indicator = node('span', undefined, 'readiness-indicator');
  heading.append(title, indicator);
  const context = node('p', '', 'readiness-context');
  // The controller's line: "Loading readiness…", "Readiness updated", the failure. The summary has its own line below it.
  const status = node('p', '', 'readiness-status'); status.setAttribute('role', 'status');
  const summary = node('p', '', 'readiness-summary'), notice = node('div', undefined, 'readiness-notice');
  // body = the painted content, then the controller's skeleton or failed block beside it (never inside it).
  const body = node('div'), content = node('div', undefined, 'readiness-content'), actions = node('div', undefined, 'readiness-actions');
  body.append(content);
  const refresh = node('button', 'Refresh readiness', 'act readiness-refresh'); refresh.type = 'button';
  actions.append(refresh);
  const note = node('p', 'Independent kernel observations, not launch permission. Unknown is not granted; an empty required set is not Ready.', 'readiness-note');
  if (compact) {
    // Compact (the inspector): the status and summary lines up front; the checks, their context and the policy behind a disclosure.
    const more = node('details', undefined, 'readiness-more'); more.append(node('summary', 'Checks and policy'), context, note, body);
    section.append(heading, status, summary, notice, more, actions);
  } else section.append(heading, context, note, status, summary, notice, body, actions);
  host.append(section);
  const current = () => alive && active && gen === workspaceGeneration();
  const owns = ticket => current() && serial === ticket;
  function visible() {
    if (!section.isConnected) return false;
    for (let el = section; el; el = el.parentElement) if (el.hidden || el.inert || el.style.display === 'none' || el.style.visibility === 'hidden') return false;
    return true;
  }
  // One detail-section skeleton roughly the height of the observed note plus the checks card.
  const skeleton = () => { const el = skeletonBlock(doc, 'detail-section', { count: 1 }); el.style.setProperty('--skeleton-block-h', compact ? '220px' : '320px'); return el; };
  const loading = createDataState({ doc, noun: 'readiness', region: section, skeletonHost: body, skeleton, status, indicatorHost: indicator, noticeHost: notice,
    onRetry: () => { if (current() && visible()) void load({ user: true }); }, focusFallback: refresh, ...clock });
  // Refresh: aria-disabled while a read is in flight (bindRefresh), never `disabled`, so a focused button keeps focus.
  loading.bindRefresh(refresh, () => { if (current() && visible()) void load({ user: true }); });
  function availability(next) {
    // The panel's workspace is {id, name} (v2); the server admits the read against its own registry.
    if (!next.workspace?.id || !readinessSelector(next.selector)) return 'Waiting for a qualified workspace selection…';
    if (!readinessSupported(next.cli)) return readinessFailure(next.cli?.ok ? 'cli-no-readiness' : 'cli-unavailable').reason.message;
    return '';
  }
  /** Open disclosures by their summary text, so a repaint from refreshed data keeps what the person opened. */
  // A warning's Details by its focus key: every warning's summary says "Details".
  const disclosureKey = d => { const summary = d.querySelector('summary'); return summary?.dataset.focusKey || summary?.textContent; };
  const openDisclosures = () => new Set([...content.querySelectorAll('details')].filter(d => d.open).map(disclosureKey));
  function render() {
    if (!value) { content.replaceChildren(); summary.textContent = ''; painted = null; return; }
    const data = value.data;
    summary.textContent = data.summary.ready ? 'Ready — every required check passes or is not applicable.'
      : data.summary.required === 0 ? 'Readiness not established — no required checks reported.' : `${data.summary.fail} failing · ${data.summary.unknown} unknown · ${data.summary.required} required checks`;
    const observed = `Observed: ${data.at}. Target: ${value.target.observedAs}. This is not an atomic snapshot or a permission lease.`;
    // Unchanged facts (the observation time aside) are not repainted: the open disclosures and any focus inside stay untouched.
    // Capability warnings (0.49.0): this read's, filtered like the items; whether each opens is the host's, so it is painted too.
    const warnings = data.warnings.filter(w => !query || JSON.stringify(w).toLowerCase().includes(query));
    const openable = typeof openCapability === 'function' ? warnings.map(w => !!w.capability && canOpenCapability(w.capability)) : [];
    const signature = JSON.stringify([value.target.observedAs, query, { ...data, at: null }, openable]);
    if (signature === painted) { content.querySelector('.readiness-observed').textContent = observed; return; }
    painted = signature;
    const restoreFocus = captureFocusState(content), open = openDisclosures();
    content.replaceChildren();
    const checks = node('div', undefined, 'readiness-checks');
    content.append(node('p', observed, 'readiness-note readiness-observed'), checks);
    for (const key of CHECKS) {
      const c = data.checks[key], row = node('section', undefined, 'readiness-check'), head = node('div', undefined, 'readiness-check-head');
      // A check failing only because providers need a sign-in is its own state, not broken.
      const failing = c.items.filter(i => i.status === 'fail'), state = c.status === 'fail' && failing.length && failing.every(signIn) ? 'sign-in' : c.status;
      const mark = node('span', ['pass', 'fail', 'sign-in'].includes(state) ? undefined : state === 'not-applicable' ? '—' : '?', 'readiness-badge');
      if (['pass', 'fail', 'sign-in'].includes(state)) mark.append(iconElement(mark.ownerDocument, state === 'pass' ? 'check' : state === 'sign-in' ? 'info' : 'alert', { size: 12 }));
      mark.dataset.state = state; mark.setAttribute('aria-hidden', 'true');
      head.append(mark, node('h3', label(key)), node('span', state === 'sign-in' ? 'sign in needed' : c.status)); row.append(head);
      for (const i of c.items) {
        if (query && !JSON.stringify(i).toLowerCase().includes(query)) continue;
        const item = node('details', undefined, 'readiness-item');
        const warned = i.result?.warnings?.length || 0;
        item.append(node('summary', `${i.subject} · ${signIn(i) ? 'sign in needed' : i.status} · ${i.required ? 'required' : 'optional'}${warned ? ` · ${warned} warning${warned === 1 ? '' : 's'}` : ''}`));
        const facts = node('dl'); item.append(facts);
        const evidence = Object.entries(i.evidence).map(([k, v]) => k === 'from' ? ['Origin', originText(v)] : [k, v]);
        // Team model v2: where the team is declared (the kernel's `at`), the place to fix it.
        const declared = typeof i.at === 'string' && i.at ? [['Declared in', declaredIn(i.at)]] : [];
        for (const [name, content] of [['Producer', i.producer], ['Reason', i.reason], ...(i.code ? [['Code', i.code]] : []), ...declared, ...evidence, ['Remedy (display only)', i.remedy]]) {
          if (content !== null && content !== undefined) facts.append(node('dt', name), node('dd', content));
        }
        // providers: the provider's own answer, verbatim; "unknown" stays unknown.
        if (i.result) item.append(node('p', Object.hasOwn(PROVIDER_SAYS, i.result.status) ? PROVIDER_SAYS[i.result.status] : `The provider answered: ${i.result.status}.`));
        // Warnings never change the status and do not count in the summary; shown as reported.
        for (const w of i.result?.warnings || []) item.append(node('p', `Warning: ${w.message} (${w.code})`, 'readiness-warning'));
        // The kernel's reason is the first problem's message: say it once, with its code.
        for (const p of [...(i.result?.problems || []), ...(i.problems || [])]) {
          if (p.message === i.reason) facts.append(node('dt', 'Problem code'), node('dd', p.code));
          else item.append(node('p', `${p.message} (${p.code})`, 'readiness-problem'));
        }
        row.append(item);
      }
      if (!c.items.length) row.append(node('p', 'No items reported for this check.', 'readiness-note'));
      checks.append(row);
    }
    // After the four checks, apart from a provider's own warnings above: they never change the summary, a status or a count.
    const list = createWarningsList(doc, warnings, { showCapability: true, focusKey: 'readiness-warning', canOpen: name => canOpenCapability(name),
      open: typeof openCapability === 'function' ? name => { if (alive) openCapability(name); } : null });
    if (list) { const box = node('section', undefined, 'readiness-warnings'); box.append(node('h3', WARNINGS_COPY.title), list); content.append(box); }
    const policy = node('details', undefined, 'readiness-policy'); policy.append(node('summary', 'View policy'), node('p', 'Lifecycle authority, not an OS sandbox.', 'readiness-note'));
    for (const [key, p] of Object.entries(data.policy)) policy.append(node('p', `${key === 'childSpawns' ? 'Child spawns' : 'Worktrees'}: ${p.allowed === null ? 'unknown' : p.allowed ? 'allowed' : 'not allowed'} · ${p.enforced ? 'enforced' : 'advisory, not enforced'} · ${p.origin.kind}${p.origin.detail ? `: ${p.origin.detail}` : ''}${p.mode ? ` · mode ${p.mode}` : ''}`));
    content.append(policy);
    for (const note of data.notes) content.append(node('p', note, 'readiness-note'));
    for (const d of content.querySelectorAll('details')) if (open.has(disclosureKey(d))) d.open = true;
    restoreFocus();
  }
  /** One read. `user`: a Refresh/Retry the person asked for (its completion is announced). The previous
   * value stays painted until the reply: pending only when the subject has none yet. The readiness
   * endpoint admits `{action, selector}` only, so no `refresh: true` hint travels with a user refresh. */
  async function load({ user = false } = {}) {
    if (!current() || blocked) return;
    const ticket = ++serial, selection = state.selector, workspace = state.workspace.id;
    // A remote instance's readiness is read on its own machine: say so while it is in flight.
    const server = selection.kind === 'instance' && selection.server ? state.workspace.name || selection.server : null;
    attempted = true; busy = true; loading.begin({ user, message: server ? readingFrom(server) : null });
    try {
      const response = await postJson(ctx, `/api/workspace-readiness?ws=${encodeURIComponent(workspace)}`, { action: 'read', selector: selection });
      if (!owns(ticket)) return;
      if (response?.readinessViewApi !== 1) throw Object.assign(Error(), { code: 'E_CLI_PROTOCOL' });
      if (response.status !== 'available') throw Object.assign(Error(), { code: response.reason?.code, reason: remoteReason(response.reason) });
      const target = readinessTarget(response.target), data = readinessData(response.data, target);
      if (!data || target.workspace !== workspace || JSON.stringify(target.selector) !== JSON.stringify(selection)) throw Object.assign(Error(), { code: 'E_CLI_PROTOCOL' });
      value = { target, data };
      // The kernel's observation time labels the data's age; a server `observedAt` (spec 02) wins when present.
      loading.succeed({ observedAt: typeof response.observedAt === 'string' ? response.observedAt : data.at ?? null });
      render();
    } catch (error) {
      if (!owns(ticket)) return;
      // Stale (value kept) or failed (no value): the contract's plain-language message is the cause, its code the Details.
      // A remote read's reason (the host's headline, its code and message) is shown as relayed.
      const { code, message, detail = null } = error?.reason || readinessFailure(error?.code).reason;
      loading.fail(Object.assign(Error(message), { code, detail }));
    } finally { if (owns(ticket)) busy = false; }
  }
  return {
    update(next) {
      if (!alive) return;
      const selector = readinessSelector(next.selector), nextGen = workspaceGeneration(), reason = availability(next);
      const key = JSON.stringify([nextGen, next.workspace?.id, next.workspace?.scope, next.workspace?.server, next.workspace?.remote,
        selector, next.cli?.ok, next.cli?.bin, next.cli?.version, next.cli?.readinessApi, next.cli?.features, next.identity]);
      if (identity !== key || blocked !== reason) {
        serial++; identity = key; gen = nextGen; attempted = false; busy = false; value = null;
        state = { workspace: { ...next.workspace }, selector }; blocked = reason;
        context.textContent = selector?.kind === 'soul' ? `Soul: ${selector.soul} · ${selector.agentsRoot}` : selector ? `Instance: ${selector.instance} · ${selector.agentsRoot}` : '';
        title.textContent = selector?.kind === 'instance' ? 'Instance readiness' : selector?.kind === 'soul' ? 'Soul readiness' : 'Readiness';
        // A new subject: the controller forgets the old one (skeleton, lines, announcement) and the content goes.
        loading.reset(); render();
        // Blocked (no CLI, remote, no qualified selection) is its own truthful state, not a skeleton: the reason
        // sits in the status line and nothing can be in flight, so `disabled` is right here — a busy read is
        // never what disables this button (that is bindRefresh's aria-disabled).
        status.textContent = blocked; summary.hidden = !!blocked; refresh.disabled = !!blocked;
      }
      // Hidden while a read is in flight: the reply is dropped (serial), so the controller's busy visuals go too.
      if (active && !next.active) { serial++; if (busy) { busy = false; attempted = false; loading.cancel(); } }
      active = next.active === true; section.hidden = !active;
      if (active && !blocked && !attempted) return load();
      // The host's inspection may land after this read: whether a warning opens follows it (signature-gated, focus kept).
      if (value) render();
    },
    /** The host's explicit refresh: a person asked, so its completion is announced. */
    refresh: () => load({ user: true }),
    setQuery(next) { const q = typeof next === 'string' ? next.toLowerCase() : ''; if (q !== query && alive) { query = q; render(); } },
    dispose() { alive = false; serial++; loading.dispose(); section.remove(); },
  };
}
