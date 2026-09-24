/** Sync and package approval for a workspace-v2 deployment. The kernel owns
 * the decision: `oats sync` writes the lock and lists what needs approval;
 * the operator approves exactly the rows it listed (id, version, executables
 * digest), which the server binds to its latest report. Every refusal is
 * shown as the kernel's code and message, verbatim. */
import { postJson, wsQuery, workspaceGeneration } from './views/common.mjs';
import { iconElement } from './shell-icons.mjs';

export const syncCSS = `
.ws-sync { display:flex; align-items:center; gap:10px; margin-left:auto; min-width:0; flex:none; }
.ws-sync-state { color:var(--muted); font-size:12px; font-weight:600; white-space:nowrap; }
.ws-sync-state.warn { color:var(--warn); }
.ws-sync-state:empty { display:none; }
.oats-view .ws-sync button.primary { display:inline-flex; align-items:center; gap:6px; min-height:30px; padding:0 12px; border-radius:7px; font-size:12px; font-weight:650; white-space:nowrap; }
.oats-view .ws-sync button.primary:not(:disabled) { background:var(--primary-bg); color:var(--primary-fg); border-color:var(--primary-bg); }
.ws-sync-sheet { position:fixed; inset:0; z-index:40; display:grid; place-items:center; padding:24px; background:var(--scrim); }
.ws-sync-sheet[hidden] { display:none; }
.ws-sync-dialog { width:min(680px,100%); max-height:88vh; display:flex; flex-direction:column; border:1px solid var(--border); border-radius:12px; background:var(--surface); color:var(--fg); box-shadow:var(--shadow-modal); }
.ws-sync-head { display:flex; align-items:center; gap:10px; min-height:52px; padding:0 16px 0 20px; border-bottom:1px solid var(--border); }
.ws-sync-head h2 { flex:1; margin:0; font-size:15px; font-weight:700; }
.ws-sync-body { overflow:auto; padding:16px 20px; display:grid; gap:12px; }
.ws-sync-body > p { margin:0; color:var(--muted); font-size:12.5px; line-height:1.55; }
.ws-sync-status { margin:0; font-size:12.5px; line-height:1.5; overflow-wrap:anywhere; }
.ws-sync-status:empty { display:none; }
.ws-sync-status.error { color:var(--danger); }
.ws-approval { display:grid; grid-template-columns:auto minmax(0,1fr); gap:4px 10px; padding:12px 14px; border:1px solid var(--border); border-radius:10px; }
.ws-approval input { margin:3px 0 0; accent-color:var(--accent); }
.ws-approval label { font-size:13px; font-weight:650; overflow-wrap:anywhere; cursor:pointer; }
.ws-approval-fact { grid-column:2; margin:0; color:var(--muted); font:11.5px/1.5 var(--mono,monospace); overflow-wrap:anywhere; }
.ws-approval ul { grid-column:2; margin:4px 0 0; padding-left:16px; color:var(--fg); font:11.5px/1.6 var(--mono,monospace); overflow-wrap:anywhere; }
.ws-sync-foot { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:12px 20px; border-top:1px solid var(--border); }
.ws-sync-foot .spacer { flex:1; }
.oats-view .ws-sync-foot button.primary:not(:disabled) { background:var(--primary-bg); color:var(--primary-fg); border-color:var(--primary-bg); }
.ws-sync-head .icon-button { display:grid; place-items:center; width:28px; height:28px; padding:0; border:0; border-radius:7px; background:none; color:var(--muted); cursor:pointer; }
.ws-sync-head .icon-button:hover { background:var(--surface-2); color:var(--fg); }
`;

let sheets = 0; // unique dialog ids per mount
const list = value => Array.isArray(value) ? value : [];
const short = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) ? value.slice(0, 7) : value;
export const reasonText = reason => reason ? [reason.code, reason.message].filter(v => typeof v === 'string' && v).join(': ') : '';

/** Header state from workspace status (the observed ID arrays): approvals
 * pending, lock out of date, or current. */
export function syncStateText(status) {
  const needed = list(status?.approval?.needed).length;
  if (needed) return { text: `${needed} package${needed === 1 ? '' : 's'} need${needed === 1 ? 's' : ''} approval`, warn: true, needed };
  if (list(status?.unsynced).length || list(status?.stale).length) return { text: 'Lock out of date', warn: true, needed: 0 };
  if (status) return { text: 'Lock current', warn: false, needed: 0 };
  return { text: '', warn: false, needed: 0 };
}

export function createWorkspaceSync(host, { ctx, onSynced }) {
  const doc = host.ownerDocument;
  const node = (tag, value, cls) => { const el = doc.createElement(tag); if (value !== undefined && value !== null) el.textContent = value; if (cls) el.className = cls; return el; };
  let alive = true, serial = 0, busy = false, status = null, available = false, report = null, reviewing = false;
  host.className = 'ws-sync';
  const state = node('span', '', 'ws-sync-state'); state.setAttribute('role', 'status');
  const review = node('button', 'Review approvals', 'act'); review.type = 'button'; review.hidden = true;
  const sync = node('button', null, 'primary'); sync.type = 'button';
  sync.append(iconElement(doc, 'refresh', { size: 13 }), doc.createTextNode('Sync'));
  sync.title = 'Run oats sync: read the workspace, resolve packages and write the lock';
  host.append(state, review, sync);

  // The approval sheet lives beside the view, not inside the header strip.
  const sheet = node('div', null, 'ws-sync-sheet'); sheet.hidden = true;
  const dialog = node('section', null, 'ws-sync-dialog'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
  const titleId = `ws-sync-title-${++sheets}`;
  dialog.setAttribute('aria-labelledby', titleId);
  const head = node('header', null, 'ws-sync-head'); const heading = node('h2', 'Approve packages'); heading.id = titleId;
  const close = node('button', null, 'icon-button'); close.type = 'button'; close.setAttribute('aria-label', 'Close approvals'); close.append(iconElement(doc, 'close', { size: 14 }));
  head.append(heading, close);
  const body = node('div', null, 'ws-sync-body');
  const foot = node('footer', null, 'ws-sync-foot');
  const sheetStatus = node('p', '', 'ws-sync-status'); sheetStatus.setAttribute('role', 'status');
  const cancel = node('button', 'Cancel', 'act'); cancel.type = 'button';
  const approve = node('button', 'Approve selected', 'act primary'); approve.type = 'button'; approve.disabled = true;
  foot.append(node('span', null, 'spacer'), cancel, approve);
  dialog.append(head, body, foot); sheet.append(dialog);
  (host.closest('.oats-view') || doc.body).append(sheet);

  const owns = (id, gen) => alive && id === serial && gen === workspaceGeneration();
  function paint() {
    const view = syncStateText(status);
    state.textContent = view.text; state.classList.toggle('warn', view.warn);
    review.hidden = !view.needed; review.disabled = busy || !available;
    sync.disabled = busy || !available;
    sync.lastChild.textContent = busy ? 'Syncing…' : 'Sync';
  }
  function closeSheet(restore = true) {
    if (busy) return;
    reviewing = false; sheet.hidden = true; body.replaceChildren(); sheetStatus.textContent = '';
    if (restore) (review.hidden ? sync : review).focus({ preventScroll: true });
  }
  function selected() { return [...body.querySelectorAll('.ws-approval input:checked')].map(input => report.approvalNeeded.find(row => row.id === input.value)).filter(Boolean); }
  function renderSheet(message = '', error = false) {
    body.replaceChildren();
    const rows = list(report?.approvalNeeded);
    body.append(node('p', rows.length
      ? 'These packages run executables. Approving records the digest of their executable set in the lock; a package whose executables change needs approval again.'
      : 'Every locked package is approved.'));
    for (const change of list(report?.changes)) body.append(node('p', `${change.id}: ${change.from ?? 'new'} → ${change.to ?? 'dropped'}${change.commit ? ` @ ${short(change.commit)}` : ''}`));
    for (const problem of list(report?.problems)) body.append(node('p', reasonText(problem)));
    for (const row of rows) {
      const item = node('div', null, 'ws-approval');
      const box = node('input'); box.type = 'checkbox'; box.value = row.id; box.id = `${titleId}-${row.id}`;
      const label = node('label', `${row.id} ${row.version}`); label.htmlFor = box.id;
      item.append(box, label, node('p', `commit ${row.commit}`, 'ws-approval-fact'), node('p', `executables ${row.executables}`, 'ws-approval-fact'));
      const targets = list(row.targets);
      if (targets.length) { const ul = node('ul'); for (const target of targets) ul.append(node('li', target)); item.append(ul); }
      else item.append(node('p', 'No executable targets.', 'ws-approval-fact'));
      box.addEventListener('change', () => { approve.disabled = busy || !selected().length; approve.textContent = selected().length ? `Approve ${selected().length}` : 'Approve selected'; });
      body.append(item);
    }
    sheetStatus.textContent = message; sheetStatus.classList.toggle('error', error); body.append(sheetStatus);
    approve.hidden = !rows.length; approve.disabled = true; approve.textContent = 'Approve selected';
    cancel.textContent = rows.length ? 'Cancel' : 'Close';
  }
  function openSheet(message = '', error = false) {
    reviewing = true; sheet.hidden = false; renderSheet(message, error);
    (body.querySelector('.ws-approval input') || cancel).focus({ preventScroll: true });
  }
  function setBusy(value) { busy = value; dialog.setAttribute('aria-busy', String(value)); for (const control of [cancel, close]) control.disabled = value; paint(); }
  async function request(body) {
    const id = ++serial, gen = workspaceGeneration();
    setBusy(true);
    let result;
    try { result = await postJson(ctx, `/api/workspace-sync${wsQuery()}`, body); }
    catch (error) { result = { status: 'unavailable', reason: { code: 'E_CLI_FAILED', message: error?.message || 'The sync request failed.' } }; }
    if (!owns(id, gen)) return null;
    setBusy(false);
    return result;
  }
  async function runSync({ openOnPending = true } = {}) {
    if (busy || !available) return;
    state.textContent = 'Syncing…'; state.classList.remove('warn');
    const result = await request({ action: 'sync' });
    if (!result) return;
    if (['ok', 'pending'].includes(result.status)) {
      report = result.report; onSynced?.(result);
      if (result.status === 'pending' && openOnPending) openSheet();
      else if (reviewing) renderSheet('Synced. Every locked package is approved.');
      paint(); return;
    }
    report = null; paint();
    // A refusal is the kernel's own words (e.g. E_PACKAGE_INTEGRITY).
    openSheet(reasonText(result.reason) || 'Sync failed.', true);
    approve.hidden = true; cancel.textContent = 'Close';
  }
  async function runApprove() {
    const rows = selected();
    if (busy || !rows.length) return;
    sheetStatus.textContent = 'Approving…'; sheetStatus.classList.remove('error');
    const result = await request({ action: 'approve', approvals: rows.map(({ id, version, executables }) => ({ id, version, executables })) });
    if (!result) return;
    if (['ok', 'pending'].includes(result.status)) {
      report = result.report; onSynced?.(result);
      renderSheet(result.status === 'ok' ? 'Approved. Every locked package is approved.' : `Approved ${rows.map(row => row.id).join(', ')}.`);
      (body.querySelector('.ws-approval input') || cancel).focus({ preventScroll: true });
      return;
    }
    const stale = result.reason?.code === 'E_APPROVAL_STALE';
    renderSheet(reasonText(result.reason) || 'Approval failed.', true);
    if (stale) { report = null; approve.hidden = true; }
  }
  sync.addEventListener('click', () => void runSync());
  // Approval rows exist only in a sync report this server holds: review
  // always starts from a fresh sync, never from the header's ID list.
  review.addEventListener('click', () => void runSync());
  approve.addEventListener('click', () => void runApprove());
  cancel.addEventListener('click', () => closeSheet());
  close.addEventListener('click', () => closeSheet());
  sheet.addEventListener('mousedown', event => { if (event.target === sheet) closeSheet(); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeSheet(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled])')].filter(el => !el.hidden);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  paint();
  return {
    /** status: the observed workspace status (or null); canSync: v2 CLI + local deployment. */
    update({ status: next = null, canSync = false } = {}) { status = next; available = !!canSync; paint(); },
    reset() { serial++; busy = false; report = null; status = null; available = false; closeSheet(false); paint(); },
    get busy() { return busy; },
    dispose() { alive = false; serial++; sheet.remove(); },
  };
}
