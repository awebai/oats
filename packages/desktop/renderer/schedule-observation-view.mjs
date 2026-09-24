/** Frame08 read presentation and lifetime owner. No timers, mutations, terminal
 * routing, task previews, transcript readers, or client-side run reconstruction. */
import { postJson, currentWorkspace, workspaceGeneration, onWorkspaceChange } from './views/common.mjs';
import { cliStatus, onCliChange } from './views/cli-status.mjs';
import { scheduleReadSupported, scheduleReadFailure, SCHEDULE_TRANSCRIPT_UNAVAILABLE } from './schedule-read-contract.mjs';
import { scheduleReadData, scheduleReadIncomplete, scheduleRecentRuns, scheduleEditReason } from './schedule-read-data.mjs';
import { iconElement } from './shell-icons.mjs';
export const scheduleObservationCSS = `
.schedule-table-wrap { overflow:auto; border:1px solid var(--border); border-radius:10px; background:var(--surface); }
.schedule-table { width:100%; border-collapse:collapse; font-size:12px; }
.schedule-table th { text-align:left; font-size:11px; color:var(--muted); background:var(--surface-2); font-weight:600; }
.schedule-table th, .schedule-table td { padding:8px 12px; border-bottom:1px solid var(--border); vertical-align:middle; }
.schedule-table tbody tr { height:56px; }
.schedule-table td { max-width:260px; overflow-wrap:anywhere; }
.schedule-table .schedule-card { border:0; border-radius:0; padding:0; }
.schedule-table button { min-height:30px; }
.schedule-table small, .schedule-history-note, .schedule-run-time, .schedule-run-facts { color:var(--muted); }
.schedule-table small { display:block; }
.schedule-menu summary { cursor:pointer; padding:6px; color:var(--fg); }
.schedule-menu summary:focus-visible, .schedule-run summary:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.schedule-menu .schedule-actions { min-width:160px; margin:6px 0; }
.schedules-view button.schedule-toggle[aria-checked=true]:not(:disabled) { border-color:var(--accent); color:var(--accent); }
.schedule-history { padding:14px 16px; margin-top:14px; border:1px solid var(--border); border-radius:10px; background:var(--surface); }
.schedule-history h3 { font-size:12px; margin:0 0 8px; }
.schedule-run-list { list-style:none; margin:0; padding:0; max-height:340px; overflow:auto; }
.schedule-run { padding:8px 0; border-bottom:1px solid var(--border); overflow-wrap:anywhere; font-size:12px; }
.schedule-run-title { display:flex; gap:10px; flex-wrap:wrap; }
.schedule-run summary { cursor:pointer; margin-top:4px; }
.schedule-run-facts { white-space:pre-wrap; margin:4px 0; }
.schedule-observation-status { color:var(--muted); }
`;
const labels = { started: 'Started', active: 'Active reported', running: 'Active reported', launched: 'Agent launched', ended: 'Run ended', stopped: 'Stopped', unknown: 'Launch state unknown', 'launch-failed': 'Launch failed', skipped: 'Skipped', delivered: 'Wake message delivered', blocked: 'Blocked', invalid: 'Invalid', failed: 'Failed', refused: 'Refused', completed: 'Completed reported' };
export const scheduleRunLabel = run => !run ? 'Not run yet' : run.corrupt ? 'Corrupt run record' : Object.hasOwn(labels, run.outcome) ? labels[run.outcome] : 'Other reported outcome';
const when = value => value ? new Date(value).toLocaleString() : 'Not reported';
const setText = (el, value) => { if (el.textContent !== value) el.textContent = value; };
const mutationId = v => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(v);
export function createScheduleObservationView(host, ctx, { cli = cliStatus, subscribeCli = onCliChange, onEdit = () => {}, onMutate = () => {}, onControls = () => {}, onInvalidate = () => {} } = {}) {
  const doc = host.ownerDocument, win = doc.defaultView;
  const node = (tag, text, cls) => { const n = doc.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const section = node('section', undefined, 'schedule-observation');
  const status = node('p', '', 'schedule-observation-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const observed = node('p', '', 'schedule-observation-status');
  const tableWrap = node('div', undefined, 'schedule-table-wrap'), table = node('table', undefined, 'schedule-table');
  table.setAttribute('aria-label', 'Workspace schedules'); const head = node('thead'), tr = node('tr');
  for (const label of ['Enabled', 'Schedule', 'Soul / target', 'Cadence', 'Next run', 'Last result', 'Actions']) { const th = node('th', label); th.scope = 'col'; tr.append(th); }
  head.append(tr); const tbody = node('tbody'); table.append(head, tbody); tableWrap.append(table);
  const empty = node('p', 'Schedules unavailable.');
  const history = node('section', undefined, 'schedule-history'), note = node('p', '', 'schedule-history-note'), rows = node('ol', undefined, 'schedule-run-list');
  history.setAttribute('aria-label', 'Recent schedule runs'); history.append(node('h3', 'Recent runs'), note, rows, node('p', SCHEDULE_TRANSCRIPT_UNAVAILABLE, 'schedule-history-note'));
  section.append(status, observed, empty, tableWrap, history); host.append(section);
  let alive = true, epoch = 0, serial = 0, showSerial = 0, revision = 0, observedAt = null, observedLease = null, attempted = false, reading = false, busy = false, stale = false, value = null, message = '', wasVisible = true;
  const tableRows = new Map(), runRows = new Map();
  function visible() {
    if (!section.isConnected || doc.visibilityState === 'hidden') return false;
    for (let n = section; n; n = n.parentElement) if (n.hidden || n.inert || n.hasAttribute('inert') || n.style.display === 'none' || n.style.visibility === 'hidden') return false;
    return true;
  }
  const identity = () => JSON.stringify([epoch, workspaceGeneration(), currentWorkspace(), ctx.connectionGeneration?.() ?? 0, cli()]);
  const lease = () => identity();
  const owns = token => alive && visible() && token === identity();
  const available = () => alive && visible() && !!value && !stale && observedLease === identity();
  const canMutate = () => available() && !reading && cli()?.ok === true && [1, 2].includes(cli()?.scheduleApi) && cli()?.features?.includes('schedule');
  const buttons = new Set();
  function button(label, action, valid = () => true) {
    const b = node('button', label, 'act'); b.type = 'button'; buttons.add({ b, valid });
    b.addEventListener('click', () => { if (canMutate() && !busy && b.isConnected && valid()) { action(); controls(); } }); return b;
  }
  function controls() {
    for (const item of [...buttons]) {
      if (!item.b.isConnected) { buttons.delete(item); continue; }
      item.b.disabled = !canMutate() || busy || !item.valid();
    }
    section.setAttribute('aria-busy', String(reading));
    const reason = scheduleReadSupported(cli()) ? '' : scheduleReadFailure('E_SCHEDULE_READ_UNAVAILABLE').reason.message;
    setText(status, [message, reason].filter(Boolean).join(' '));
    setText(observed, observedAt ? `Desktop observation read at ${when(observedAt)}${stale ? ' · stale — refresh required' : ''}` : '');
    onControls({ available: available(), canMutate: canMutate(), reading, stale, scheduler: value?.scheduler ?? null, data: value, revision });
  }
  function clear() { value = null; observedAt = null; observedLease = null; tableRows.clear(); runRows.clear(); buttons.clear(); tbody.replaceChildren(); rows.replaceChildren(); empty.hidden = false; tableWrap.hidden = true; setText(note, 'No observation loaded.'); }
  function invalidate(clearData = false, text = 'Observation retained — refresh required.') {
    epoch++; serial++; showSerial++; reading = false; busy = false; stale = !!value; attempted = true;
    if (clearData) { clear(); stale = false; attempted = false; }
    message = text; onInvalidate(clearData); controls();
  }
  function render() {
    empty.hidden = !!value.schedules.length; tableWrap.hidden = !value.schedules.length;
    setText(empty, 'No schedules in this workspace.');
    const present = new Set(), token = lease();
    for (const job of value.schedules) {
      present.add(job.id); let r = tableRows.get(job.id);
      if (!r) {
        const row = node('tr', undefined, 'schedule-card'); row.dataset.scheduleId = job.id;
        const cells = Array.from({ length: 7 }, () => node('td')); row.append(...cells);
        r = { row, cells, job, token, confirm: false }; tableRows.set(job.id, r);
        const valid = () => owns(r.token) && tableRows.get(r.job.id) === r && !r.job.unreadable && mutationId(r.job.id);
        r.toggle = button('Pause', () => onMutate(r.job.enabled ? 'disable' : 'enable', r.job.id), valid); r.toggle.classList.add('schedule-toggle'); r.toggle.setAttribute('role', 'switch'); cells[0].append(r.toggle);
        r.name = node('strong'); r.kind = node('small'); cells[1].append(r.name, r.kind);
        r.target = node('span'); cells[2].append(r.target);
        r.cron = node('span'); r.tz = node('small'); cells[3].append(r.cron, r.tz);
        r.next = node('span'); cells[4].append(r.next); r.last = node('span'); cells[5].append(r.last);
        const menu = node('details', undefined, 'schedule-menu'), summary = node('summary'); summary.append(iconElement(doc, 'more')); summary.setAttribute('aria-label', `Actions for ${job.id}`);
        r.editNote = node('p'); const actions = node('div', undefined, 'schedule-actions');
        const edit = button('Edit', () => onEdit(r.job), () => valid() && r.job.editReason === null);
        r.run = button('Run now', () => onMutate('run', r.job.id), () => valid() && r.job.enabled);
        r.check = button('Check run state', () => onMutate('reconcile', r.job.id), valid);
        r.remove = button('Delete', () => { r.confirm = !r.confirm; r.confirmBox.hidden = !r.confirm; }, valid);
        r.confirmBox = node('div'); r.confirmBox.hidden = true;
        const cancel = button('Cancel', () => { r.confirm = false; r.confirmBox.hidden = true; }, valid);
        r.confirmBox.append(button('Confirm deletion', () => { r.confirm = false; r.confirmBox.hidden = true; onMutate('remove', r.job.id); }, () => valid() && r.confirm), cancel);
        actions.append(edit, r.run, r.check, r.remove); menu.append(summary, r.editNote, actions, r.confirmBox); cells[6].append(menu); tbody.append(row);
      }
      r.job = job; r.token = token;
      setText(r.name, job.id); setText(r.kind, job.unreadable ? 'Unreadable definition' : `${job.kind} · ${job.enabled ? 'Enabled' : 'Paused'}`);
      setText(r.target, job.agent || job.home || job.operation || 'Not reported'); setText(r.cron, job.cron || 'Not reported'); setText(r.tz, job.tz || 'Time zone not reported');
      setText(r.next, when(job.nextRun)); setText(r.last, job.unreadable ? job.unreadable.message : scheduleRunLabel(job.lastRun));
      setText(r.toggle, job.enabled ? 'Pause' : 'Enable'); r.toggle.setAttribute('aria-checked', String(job.enabled === true)); r.toggle.setAttribute('aria-label', `${job.enabled ? 'Pause' : 'Enable'} ${job.id}`);
      setText(r.editNote, job.unreadable?.message || scheduleEditReason(job.editReason) || (!mutationId(job.id) ? 'This ID is read-only in the current mutation contract; use CLI.' : ''));
      r.editNote.hidden = !r.editNote.textContent; r.check.hidden = job.lastRun?.outcome !== 'unknown';
    }
    for (const [id, r] of tableRows) if (!present.has(id)) { r.row.remove(); tableRows.delete(id); }
    let tableIndex = 0; for (const id of present) { const row = tableRows.get(id).row; if (tbody.children[tableIndex] !== row) tbody.insertBefore(row, tbody.children[tableIndex] || null); tableIndex++; }
    const recent = scheduleRecentRuns(value), kept = new Set(), occurrences = new Map();
    for (const { id, run, index } of recent) {
      const base = JSON.stringify([id, run.runId ?? ['legacy', index]]), n = occurrences.get(base) || 0; occurrences.set(base, n + 1);
      const key = JSON.stringify([base, n]); kept.add(key); let r = runRows.get(key);
      if (!r) {
        const row = node('li', undefined, 'schedule-run'), line = node('div', undefined, 'schedule-run-title');
        r = { row, title: node('strong'), time: node('time', '', 'schedule-run-time'), result: node('span'), facts: node('p', '', 'schedule-run-facts'), detail: node('details'), provenance: node('p', '', 'schedule-run-facts') };
        line.append(r.time, r.title, r.result); r.detail.append(node('summary', 'Session provenance'), r.provenance); row.append(line, r.facts, r.detail); runRows.set(key, r);
      }
      setText(r.title, id); setText(r.time, when(run.startedAt || run.scheduledFor)); setText(r.result, scheduleRunLabel(run));
      const duration = run.startedAt && run.endedAt && run.endedAt >= run.startedAt ? `${(Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000}s recorded duration` : null;
      setText(r.facts, run.corrupt ? 'This history element is corrupt; no run or session facts are asserted.' : [run.legacy ? 'Legacy record · settlement not reported' : `${run.settled ? 'Settled' : 'Unsettled'} record`, run.transitions?.join(' → '), duration, run.invalidTimes ? 'Some time facts are invalid or unreported.' : null, run.hasError ? 'An error was recorded; raw diagnostics withheld.' : null].filter(Boolean).join(' · '));
      r.detail.hidden = !!run.corrupt;
      if (!run.corrupt) setText(r.provenance, `Delivery: ${run.session.delivery}\nInstance: ${run.session.instance ?? 'not reported'}\nHome: ${run.session.home ?? 'not reported'}\nIncarnation: ${run.session.incarnation ?? 'not reported'}\nServer: ${run.session.server ?? 'not reported'}\n${SCHEDULE_TRANSCRIPT_UNAVAILABLE}`);
    }
    for (const [key, r] of runRows) if (!kept.has(key)) { r.row.remove(); runRows.delete(key); }
    // Move only when order changed; unchanged rows keep focus, range and disclosure.
    let index = 0; for (const key of kept) { const row = runRows.get(key).row; if (rows.children[index] !== row) rows.insertBefore(row, rows.children[index] || null); index++; }
    const total = value.schedules.reduce((n, s) => n + s.recentRuns.length, 0);
    setText(note, `${recent.length} displayed of ${total} returned records${total > 50 ? ' · workspace display limited to 50' : ''}. ${scheduleReadIncomplete(value) ? 'Incomplete observation: truncated, corrupt or unreported facts are present.' : 'Reported history only; ended does not imply task success and delivered does not imply consumption.'} Sources: ${value.integrity.sources.map(s => `${s.path}: ${s.status} (${s.bytes} bytes)`).join(' · ')}.`);
  }
  async function refresh() {
    if (!alive || !visible()) return;
    if (!currentWorkspace() || !scheduleReadSupported(cli())) { message = 'Choose a local workspace and compatible read contract.'; controls(); return; }
    attempted = true;
    const token = lease(), op = ++serial, workspace = currentWorkspace(); reading = true; message = 'Reading schedule observation…'; controls();
    const current = () => owns(token) && op === serial;
    try {
      const response = await postJson(ctx, `/api/workspace-schedules?ws=${encodeURIComponent(workspace)}`, { action: 'list' });
      if (!current()) return;
      if (response?.status === 'unavailable') throw { code: response.reason?.code };
      if (response?.scheduleReadViewApi !== 1 || response.workspace !== workspace) throw { code: 'E_CLI_PROTOCOL' };
      const next = scheduleReadData(response.data, response.scope, { action: 'list' }, { publicView: true });
      if (!next) throw { code: 'E_CLI_PROTOCOL' };
      value = next; revision++; observedAt = new Date().toISOString(); observedLease = token; stale = false; message = `${next.schedules.filter(s => s.enabled).length} enabled · observation loaded. Refresh explicitly for new facts.`; render();
    } catch (error) { if (current()) { stale = !!value; message = scheduleReadFailure(error?.code).reason.message + (value ? ' Last observation retained — refresh required.' : ''); } }
    finally { if (current()) { reading = false; controls(); } }
  }
  async function show(id) {
    if (!canMutate() || busy) return null;
    const token = lease(), op = ++showSerial, listIntent = serial, workspace = currentWorkspace();
    const current = () => owns(token) && op === showSerial && listIntent === serial;
    try {
      const response = await postJson(ctx, `/api/workspace-schedules?ws=${encodeURIComponent(workspace)}`, { action: 'show', id });
      if (!current()) return null;
      if (response?.status === 'unavailable') throw Object.assign(Error(scheduleReadFailure(response.reason?.code).reason.message), { code: response.reason?.code });
      if (response?.scheduleReadViewApi !== 1 || response.workspace !== workspace) throw Error('Invalid schedule observation.');
      const next = scheduleReadData(response.data, response.scope, { action: 'show', id }, { publicView: true });
      if (!next) throw Error('Invalid schedule observation.'); return next;
    } catch (error) { if (!current()) return null; throw error; }
  }
  const offWorkspace = onWorkspaceChange(() => { invalidate(true, 'Workspace changed.'); void refresh(); });
  const offConnection = ctx.subscribeConnections?.(() => { invalidate(true, 'Connection changed. Refresh schedules.'); });
  const offCli = subscribeCli?.(() => { const first = !attempted; invalidate(false, 'CLI changed. Refresh schedules.'); if (first) void refresh(); });
  const syncVisible = () => { const now = visible(); if (!now && wasVisible) invalidate(false, 'Observation retained while hidden — refresh required.'); wasVisible = now; controls(); };
  const observer = new win.MutationObserver(records => {
    const hiddenBefore = records.some(r => ['hidden', 'inert'].includes(r.attributeName) ? r.oldValue !== null : r.attributeName === 'style' && /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(r.oldValue || ''));
    if (hiddenBefore) invalidate(false, 'Observation retained after hiding — refresh required.'); syncVisible();
  });
  for (let n = host; n; n = n.parentElement) observer.observe(n, { attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'inert', 'style', 'class'] });
  doc.addEventListener('visibilitychange', syncVisible);
  clear(); controls();
  return { refresh, show, lease, owns, canMutate, available, revision: () => revision, setBusy(v) { busy = v; controls(); },
    dispose() { alive = false; epoch++; serial++; showSerial++; offWorkspace(); offConnection?.(); offCli?.(); observer.disconnect(); doc.removeEventListener('visibilitychange', syncVisible); clear(); section.remove(); } };
}
