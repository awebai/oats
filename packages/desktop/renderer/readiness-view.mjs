/** Owned offline readiness presentation (readinessApi 2: a soul or an instance;
 * installed · configured · member · providers). No background polling or
 * remediation; a provider's own binding check is shown as it answered. */
import { postJson, workspaceGeneration } from './views/common.mjs';
import { CHECKS, readinessSelector, readinessSupported, readinessTarget, readinessData, readinessFailure } from './readiness-contract.mjs';
import { originText } from './inspect-contract.mjs';
import { iconElement } from './shell-icons.mjs';
export const readinessCSS = `
.readiness-view { color:var(--fg); min-width:0; margin:18px 0; font-size:12px; line-height:1.5; }
.readiness-view[hidden], .readiness-view [hidden] { display:none; }
.readiness-view h2 { font-size:14px; margin:0; }
.readiness-context, .readiness-note, .readiness-status, .readiness-item dt { color:var(--muted); overflow-wrap:anywhere; }
.readiness-view p { margin:4px 0; }
.readiness-status { min-height:1.5em; }
.readiness-checks { border:1px solid var(--border); border-radius:12px; background:var(--surface); overflow:hidden; }
.readiness-check { padding:16px 18px; border-top:1px solid var(--border); }
.readiness-check:first-child { border-top:0; }
.readiness-check-head { display:flex; align-items:center; gap:14px; }
.readiness-check-head h3 { flex:1; margin:0; font-size:13.5px; }
.readiness-badge { display:grid; place-items:center; flex:none; width:28px; height:28px; border-radius:50%; background:var(--surface-2); color:var(--muted); font-weight:700; }
.readiness-badge[data-state=pass] { color:var(--ok); }
.readiness-badge[data-state=fail] { color:var(--danger); }
.readiness-badge[data-state=unknown] { color:var(--warn); }
.readiness-item { margin:10px 0; overflow-wrap:anywhere; }
.readiness-item p, .readiness-item dd { margin:2px 0; }
.readiness-item dt { font-size:11px; }
.readiness-view details { margin-top:8px; }
.readiness-view summary { cursor:pointer; }
.readiness-view summary:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.readiness-view button { min-height:34px; }
.readiness-actions { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
.soul-inspector .readiness-view { margin-top:16px; }
.soul-inspector .readiness-check { padding:12px 8px; }
`;
const label = v => v[0].toUpperCase() + v.slice(1);
export function createReadinessView(host, { ctx } = {}) {
  const doc = host.ownerDocument;
  const node = (tag, value, cls) => { const el = doc.createElement(tag); if (value !== undefined) el.textContent = value; if (cls) el.className = cls; return el; };
  let alive = true, active = false, serial = 0, identity = null, gen = null, state = {}, attempted = false, busy = false, value = null, blocked = '', query = '';
  const section = node('section', undefined, 'readiness-view'); section.hidden = true; section.setAttribute('aria-label', 'Effective readiness');
  const title = node('h2', 'Readiness'), context = node('p', '', 'readiness-context');
  const status = node('p', '', 'readiness-status'); status.setAttribute('role', 'status');
  const body = node('div'), actions = node('div', undefined, 'readiness-actions');
  const refresh = node('button', 'Refresh readiness', 'act readiness-refresh'); refresh.type = 'button';
  actions.append(refresh);
  section.append(title, context, node('p', 'Independent kernel observations, not launch permission. Unknown is not granted; an empty required set is not Ready.', 'readiness-note'), status, body, actions);
  host.append(section);
  const current = () => alive && active && gen === workspaceGeneration();
  const owns = ticket => current() && serial === ticket;
  function visible() {
    if (!section.isConnected) return false;
    for (let el = section; el; el = el.parentElement) if (el.hidden || el.inert || el.style.display === 'none' || el.style.visibility === 'hidden') return false;
    return true;
  }
  refresh.addEventListener('click', () => { if (current() && visible() && !refresh.disabled) void load(); });
  function availability(next) {
    // The panel's workspace is {id, name} (v2); the server admits the read against its own registry.
    if (!next.workspace?.id || !readinessSelector(next.selector)) return 'Waiting for a qualified workspace selection…';
    if (next.workspace.remote || next.workspace.server || next.selector.server) return readinessFailure('unsupported-remote-operation').reason.message;
    if (!readinessSupported(next.cli)) return readinessFailure(next.cli?.ok ? 'cli-no-readiness' : 'cli-unavailable').reason.message;
    return '';
  }
  function render() {
    body.replaceChildren();
    if (!value) return;
    const data = value.data, checks = node('div', undefined, 'readiness-checks');
    status.textContent = data.summary.ready ? 'Ready — every required check passes or is not applicable.'
      : data.summary.required === 0 ? 'Readiness not established — no required checks reported.' : `${data.summary.fail} failing · ${data.summary.unknown} unknown · ${data.summary.required} required checks`;
    body.append(node('p', `Observed: ${data.at}. Target: ${value.target.observedAs}. This is not an atomic snapshot or a permission lease.`, 'readiness-note'), checks);
    for (const key of CHECKS) {
      const c = data.checks[key], row = node('section', undefined, 'readiness-check'), head = node('div', undefined, 'readiness-check-head');
      const mark = node('span', c.status === 'pass' || c.status === 'fail' ? undefined : c.status === 'not-applicable' ? '—' : '?', 'readiness-badge'); if (c.status === 'pass' || c.status === 'fail') mark.append(iconElement(mark.ownerDocument, c.status === 'pass' ? 'check' : 'alert', { size: 12 })); mark.dataset.state = c.status; mark.setAttribute('aria-hidden', 'true');
      head.append(mark, node('h3', label(key)), node('span', c.status)); row.append(head);
      for (const i of c.items) {
        if (query && !JSON.stringify(i).toLowerCase().includes(query)) continue;
        const item = node('details', undefined, 'readiness-item');
        const warned = i.result?.warnings?.length || 0;
        item.append(node('summary', `${i.subject} · ${i.status} · ${i.required ? 'required' : 'optional'}${warned ? ` · ${warned} warning${warned === 1 ? '' : 's'}` : ''}`));
        const facts = node('dl'); item.append(facts);
        const evidence = Object.entries(i.evidence).map(([k, v]) => k === 'from' ? ['Origin', originText(v)] : [k, v]);
        for (const [name, content] of [['Producer', i.producer], ['Reason', i.reason], ...(i.code ? [['Code', i.code]] : []), ...evidence, ['Remedy (display only)', i.remedy]]) {
          if (content !== null && content !== undefined) facts.append(node('dt', name), node('dd', content));
        }
        // providers: the provider's own answer, verbatim; "unknown" stays unknown.
        if (i.result) item.append(node('p', `The provider says: ${i.result.status === 'ready' ? 'ready' : 'needs configuration'}.`));
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
    const policy = node('details', undefined, 'readiness-policy'); policy.append(node('summary', 'View policy'), node('p', 'Lifecycle authority, not an OS sandbox.', 'readiness-note'));
    for (const [key, p] of Object.entries(data.policy)) policy.append(node('p', `${key === 'childSpawns' ? 'Child spawns' : 'Worktrees'}: ${p.allowed === null ? 'unknown' : p.allowed ? 'allowed' : 'not allowed'} · ${p.enforced ? 'enforced' : 'advisory, not enforced'} · ${p.origin.kind}${p.origin.detail ? `: ${p.origin.detail}` : ''}${p.mode ? ` · mode ${p.mode}` : ''}`));
    body.append(policy);
    for (const note of data.notes) body.append(node('p', note, 'readiness-note'));
  }
  async function load() {
    if (!current() || blocked) return;
    const ticket = ++serial, selection = state.selector, workspace = state.workspace.id;
    attempted = true; busy = true; value = null; render(); status.textContent = 'Reading effective readiness…'; refresh.disabled = true;
    try {
      const response = await postJson(ctx, `/api/workspace-readiness?ws=${encodeURIComponent(workspace)}`, { action: 'read', selector: selection });
      if (!owns(ticket)) return;
      if (response?.readinessViewApi !== 1) throw Object.assign(Error(), { code: 'E_CLI_PROTOCOL' });
      if (response.status !== 'available') throw Object.assign(Error(), { code: response.reason?.code });
      const target = readinessTarget(response.target), data = readinessData(response.data, target);
      if (!data || target.workspace !== workspace || JSON.stringify(target.selector) !== JSON.stringify(selection)) throw Object.assign(Error(), { code: 'E_CLI_PROTOCOL' });
      value = { target, data }; render();
    } catch (error) {
      if (!owns(ticket)) return;
      value = null; render(); status.textContent = readinessFailure(error?.code).reason.message;
    } finally { if (owns(ticket)) { busy = false; refresh.disabled = false; } }
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
        status.textContent = blocked; refresh.disabled = !!blocked; render();
      }
      if (active && !next.active) { serial++; if (busy) { busy = false; attempted = false; } }
      active = next.active === true; section.hidden = !active;
      if (active && !blocked && !attempted) return load();
    },
    refresh: load,
    setQuery(next) { const q = typeof next === 'string' ? next.toLowerCase() : ''; if (q !== query && alive) { query = q; render(); } },
    dispose() { alive = false; serial++; section.remove(); },
  };
}
