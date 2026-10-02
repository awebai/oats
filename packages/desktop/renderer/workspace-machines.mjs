/** The Setup tab's Machines box (#517): the registrations whose workspace key is this window's
 * (`/api/servers?ws=<view>`, server/machines.mjs), each with its name, ssh host, folder on the host, the
 * OATS version and reachability its last check reported, and Check and Remove; and "Add a machine to
 * this workspace…" (renderer/add-machine-dialog.mjs).
 *
 * - A machine with no check this run is checked once in the background (`/api/server-check`), at most
 *   two at a time; the facts the server holds (its backfill, an earlier Check) are shown as they are.
 * - Remove asks first, in the row, then runs `oats server remove` (`/api/server-remove`); a refusal is
 *   said in the row in the CLI's words.
 * - Without the gates the route answers today's list: the box is hidden. Without a workspace key the box
 *   says why (the route's reason) and offers nothing.
 * - The box owns its state: the Setup tab mounts it once per workspace and keeps it across re-renders.
 *   Every read carries this box's latest-intent ticket; nothing lands after dispose(). */
import { apiJson, postJson } from './views/common.mjs';
import { box } from './workspace-setup.mjs';
import { openAddMachineDialog } from './add-machine-dialog.mjs';

export const machinesCSS = `
.machines-row { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,.8fr) minmax(0,1.3fr) 92px 104px auto; gap:10px; align-items:center; min-height:42px; padding:0 16px; box-sizing:border-box; border-top:1px solid var(--tag-bg); }
.setup-box-head + .machines-row { border-top:0; }
.machines-row > * { min-width:0; }
.machine-cell { color:var(--fg); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.machine-cell.mono { font-family:var(--mono,monospace); }
.machine-cell.muted { color:var(--muted); }
.machine-cell.name { font-weight:600; }
.machine-state { justify-self:start; display:inline-flex; align-items:center; height:22px; padding:0 8px; border-radius:5px; background:var(--tag-bg); color:var(--muted); font-size:11.5px; font-weight:600; }
.machine-state[data-reachable=false] { background:var(--attn-bg); color:var(--warn); }
.machine-acts { display:flex; gap:12px; justify-self:end; }
.oats-view .setup button.machine-act, .oats-view .setup button.machines-add, .oats-view .setup button.machines-retry { height:auto; min-height:0; padding:2px 0; border:0; background:transparent; color:var(--accent); font:600 12px var(--sans,system-ui); white-space:nowrap; cursor:pointer; }
.oats-view .setup button.machine-act:hover, .oats-view .setup button.machines-add:hover, .oats-view .setup button.machines-retry:hover { text-decoration:underline; }
.oats-view .setup button.machine-act:disabled { color:var(--muted); cursor:default; text-decoration:none; }
.oats-view .setup button.machine-act:focus-visible, .oats-view .setup button.machines-add:focus-visible, .oats-view .setup button.machines-retry:focus-visible { background:var(--sel); border-radius:4px; padding:2px 4px; margin:0 -4px; }
.oats-view .setup .setup-box-head button.machines-add { margin-left:auto; }
.setup-machines .setup-box-head .setup-scope { margin-left:12px; } /* after Add, which takes the free space */
.machine-confirm, .machine-error { grid-column:1 / -1; margin:0 0 10px; }
.machine-confirm { display:flex; flex-direction:column; gap:8px; padding:8px 10px; border:1px solid var(--border); border-radius:7px; background:var(--surface-2); }
.machine-confirm p { margin:0; color:var(--fg); font-size:12px; line-height:1.45; }
.machine-confirm-acts { display:flex; gap:8px; }
.oats-view .setup .machine-confirm button { height:26px; padding:0 12px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--fg); font:600 12px var(--sans,system-ui); cursor:pointer; }
.oats-view .setup .machine-confirm button:focus-visible { background:var(--sel); }
.oats-view .setup .machine-confirm button.machine-confirm-remove { background:var(--danger); color:var(--primary-fg); border-color:var(--danger); }
.machine-error { color:var(--danger); font-size:12px; }
.machines-reason { margin:0; padding:12px 16px; color:var(--muted); font-size:12px; display:flex; gap:12px; align-items:baseline; }
`;

/** Machines already checked in the background this run (a Check press always runs). */
const checkedThisRun = new Set();
/** Forget them (tests). */
export function resetMachineChecks() { checkedThisRun.clear(); }
const BACKGROUND_CHECKS = 2;
const text = value => typeof value === 'string' && value.length > 0;

export function createWorkspaceMachines(doc, { ctx, ws }) {
  const el = (tag, value, cls) => { const n = doc.createElement(tag); if (value !== undefined && value !== null) n.textContent = value; if (cls) n.className = cls; return n; };
  const query = () => `?ws=${encodeURIComponent(ws)}`;
  const element = box(doc, 'Machines', 'that run this workspace', 'Not shared', { local: true, icon: 'computer' });
  element.classList.add('setup-machines'); element.hidden = true;
  const head = element.querySelector('.setup-box-head');
  const body = el('div', undefined, 'machines-body'); element.append(body);
  let alive = true, ticket = 0, answer = null, failure = null, confirming = null;
  const checking = new Set(), rowErrors = new Map(), dialog = { current: null };
  const owns = t => alive && t === ticket;

  let add = null;
  function addButton() {
    if (add) return add;
    add = el('button', 'Add a machine to this workspace…', 'machines-add'); add.type = 'button';
    add.addEventListener('click', () => {
      if (!alive || !answer?.deployment) return;
      dialog.current = openAddMachineDialog(doc, { ctx, ws, deployment: answer.deployment, aweb: answer.aweb === true,
        onAdded: () => { dialog.current = null; void load({ focus: 'add' }); }, onClose: () => { dialog.current = null; } });
    });
    return add;
  }

  function stateText(m) {
    if (checking.has(m.id)) return { text: 'checking…', reachable: null, title: '' };
    if (!m.check) return { text: 'not checked', reachable: null, title: '' };
    return { text: m.check.reachable ? 'reachable' : 'not reachable', reachable: m.check.reachable, title: m.check.error || '' };
  }
  function render() {
    const focusedId = doc.activeElement?.closest?.('[data-machine]')?.dataset.machine;
    const focusedClass = doc.activeElement?.className;
    body.replaceChildren();
    if (!answer && !failure) return;
    if (failure) {
      const line = el('p', 'The machines of this workspace could not be read.', 'machines-reason');
      const retry = el('button', 'Retry', 'machines-retry'); retry.type = 'button'; retry.addEventListener('click', () => void load({ focus: 'retry' }));
      line.append(retry); body.append(line); return;
    }
    if (!answer.deployment) { add?.remove(); body.append(el('p', answer.reason || '', 'machines-reason')); return; }
    if (!add?.isConnected) head.querySelector('.setup-scope').before(addButton());
    if (!answer.servers.length) { body.append(el('p', 'No machine runs this workspace yet.', 'setup-empty')); return; }
    for (const m of answer.servers) {
      const row = el('div', undefined, 'machines-row'); row.dataset.machine = m.id;
      const state = stateText(m), badge = el('span', state.text, 'machine-cell machine-state');
      if (state.reachable !== null) badge.dataset.reachable = String(state.reachable);
      if (state.title) badge.title = state.title;
      const name = el('span', m.id, 'machine-cell name'); name.title = m.label && m.label !== m.id ? `${m.id} · ${m.label}` : m.id;
      const folder = el('span', m.workspace, 'machine-cell mono muted'); folder.title = m.workspace;
      row.append(name, el('span', m.sshHost, 'machine-cell mono'), folder,
        el('span', text(m.check?.version) ? `oats ${m.check.version}` : '', 'machine-cell muted'), badge);
      const acts = el('span', undefined, 'machine-acts');
      const check = el('button', 'Check', 'machine-act machine-check'); check.type = 'button'; check.setAttribute('aria-label', `Check ${m.id}`);
      check.disabled = checking.has(m.id);
      check.addEventListener('click', () => void runCheck(m.id, { focus: true }));
      const remove = el('button', 'Remove', 'machine-act machine-remove'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${m.id}`);
      remove.addEventListener('click', () => { confirming = m.id; rowErrors.delete(m.id); render(); body.querySelector(`[data-machine="${m.id}"] .machine-confirm-cancel`)?.focus(); });
      acts.append(check, remove); row.append(acts);
      if (confirming === m.id) {
        const confirm = el('div', undefined, 'machine-confirm');
        confirm.append(el('p', `Remove ${m.id}? Instances spawned there keep running and can still be retired from here.`));
        const buttons = el('div', undefined, 'machine-confirm-acts');
        const yes = el('button', 'Remove', 'machine-confirm-remove'); yes.type = 'button'; yes.addEventListener('click', () => void runRemove(m.id));
        const no = el('button', 'Cancel', 'machine-confirm-cancel'); no.type = 'button';
        no.addEventListener('click', () => { confirming = null; render(); body.querySelector(`[data-machine="${m.id}"] .machine-remove`)?.focus(); });
        buttons.append(yes, no); confirm.append(buttons); row.append(confirm);
      }
      if (rowErrors.has(m.id)) { const error = el('p', rowErrors.get(m.id), 'machine-error'); error.setAttribute('role', 'alert'); row.append(error); }
      body.append(row);
    }
    // A repaint keeps focus on the same control of the same machine.
    if (focusedId && focusedClass) body.querySelector(`[data-machine="${focusedId}"] .${String(focusedClass).split(' ').pop()}`)?.focus();
  }

  async function load({ focus = null } = {}) {
    const t = ++ticket;
    try {
      const d = await apiJson(ctx, `/api/servers${query()}`);
      if (!owns(t)) return;
      failure = null;
      if (d?.filtered !== true || !Array.isArray(d.servers)) { answer = null; element.hidden = true; return; }
      answer = d; element.hidden = false;
      if (confirming && !d.servers.some(m => m.id === confirming)) confirming = null;
    } catch {
      if (!owns(t)) return;
      failure = true; element.hidden = false;
    }
    render();
    if (focus === 'add') add?.focus();
    if (focus === 'retry') (body.querySelector('.machines-retry') || add || body.querySelector('button'))?.focus();
    backgroundChecks();
  }
  function backgroundChecks() {
    const due = (answer?.servers || []).filter(m => !m.check && !checkedThisRun.has(m.id));
    for (const m of due) { checkedThisRun.add(m.id); checking.add(m.id); }
    if (!due.length) return;
    render();
    let next = 0;
    const worker = async () => { while (alive && next < due.length) await runCheck(due[next++].id); };
    for (let i = 0; i < Math.min(BACKGROUND_CHECKS, due.length); i++) void worker();
  }
  async function runCheck(id, { focus = false } = {}) {
    if (!alive) return;
    checkedThisRun.add(id); checking.add(id); rowErrors.delete(id); render();
    let result = null, error = null;
    try { result = await postJson(ctx, `/api/server-check${query()}`, { id }); } catch (e) { error = e?.message || 'The check could not run.'; }
    if (!alive) return;
    checking.delete(id);
    const m = answer?.servers.find(row => row.id === id);
    if (m && result?.id === id) m.check = result.check ?? null;
    if (error) rowErrors.set(id, error);
    render();
    if (focus) body.querySelector(`[data-machine="${id}"] .machine-check`)?.focus();
  }
  async function runRemove(id) {
    if (!alive) return;
    let envelope = null, error = null;
    try { envelope = await postJson(ctx, `/api/server-remove${query()}`, { id }); } catch (e) { error = e?.message || 'The machine could not be removed.'; }
    if (!alive) return;
    confirming = null;
    if (envelope?.ok) { rowErrors.delete(id); await load({ focus: 'add' }); return; }
    rowErrors.set(id, error || `${envelope?.error?.message || 'The machine could not be removed.'}${envelope?.error?.code ? ` (${envelope.error.code})` : ''}`);
    render();
    body.querySelector(`[data-machine="${id}"] .machine-remove`)?.focus();
  }

  void load();
  return {
    element,
    /** Read the list again (a machine added or removed elsewhere). */
    refresh() { if (alive) void load(); },
    dispose() { alive = false; ticket++; dialog.current?.close({ restoreFocus: false }); element.remove(); },
  };
}
