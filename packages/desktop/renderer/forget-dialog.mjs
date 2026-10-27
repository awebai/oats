/** Forget a remote instance its host no longer lists (#1131): the informed press before `oats server forget`.
 * Offered only on a row whose reason is `missing` (remote-address.mjs `rowReason`: the host was reached and
 * did not list it), from the row's context menu and from the context panel; both open this one dialog.
 *
 * It is the Stop and Retire confirmation's dialog (lifecycle-dialog.mjs): its classes, its status line, its
 * Escape and Tab handling and its focus return, with no plan to read. Opening, Cancel and Escape send
 * nothing. Forget sends exactly one request, `{ server, instance }` of the row it was opened for, through
 * `request`; the backend composes the command (server/server-forget.mjs) and answers once its outcome is known.
 * While it runs the dialog is busy: Escape and Cancel do nothing, focus
 * waits on the status line, and no entry point can send again (`open` refuses a row whose Forget is in
 * flight, wherever it was opened). Busy also holds the whole window: every keydown is taken at the window's
 * capture phase, before the shell's shortcuts (keybindings.mjs `handleKeydown`) or a terminal see it, and
 * focus that lands outside the dialog is put back on the status line, so no shortcut opens anything behind it.
 *
 * The roster is never edited here: after every command the server reads it again (its one owner; nothing here
 * asks for a read), and the row leaves the roster when that read lands. A second Forget of the row before then
 * answers E_SNAPSHOT_UNKNOWN, whose sentence is true. The dialog closes with the answer and says the outcome
 * through `notify`:
 *   forgotten            "Forgot <instance> on <server>."; focus to the roster's next row (`nextFocus`)
 *   E_SNAPSHOT_UNKNOWN   no saved route was there; focus as for forgotten: the row is not this computer's
 *   another refusal      "Couldn't forget <instance>." and the kernel's lines; focus back to the opener
 *   nothing ran          "Couldn't forget <instance>." and the Desktop's own reason; focus back to the opener
 *   unknown              "It is not known whether <instance> was forgotten."; focus back to the opener
 * Before the press, another modal dialog opening over this one closes it, sending nothing. One that opens
 * through takePickerFocusReturn (Connections, the palette, a lifecycle confirmation, the shortcuts editor)
 * inherits this one's opener (joinPickerFocusReturn), so closing it returns focus where Forget would have;
 * any other `aria-modal` taking focus closes it too. The opener of that one need not know this one.
 * An answer that lands after the dialog stopped owning its request (a workspace change, dispose) says and
 * moves nothing. Names enter a sentence through the display filter: the server's
 * label as remote-address.mjs `shownLabel`, the instance by the same rule ("this instance" when withheld). */
import { takePickerFocusReturn, joinPickerFocusReturn } from './overlay-picker.mjs';
import { rowReason, serverLabel, shownLabel } from '../../client/remote-address.mjs';
import { displayLine, DETAIL_WITHHELD } from '../../client/display-text.mjs';
import { kernelLines } from '../../client/kernel-lines.mjs';
import { DESKTOP_TERMS } from './desktop-terms.mjs';
import { iconElement } from './shell-icons.mjs';

/** A row Forget is offered on: a remote row the host was reached for and did not list. */
export const forgettable = row => !!row && typeof row.server === 'string' && row.server.length > 0
  && typeof row.instance === 'string' && row.instance.length > 0 && rowReason(row)?.key === 'missing';

/** An instance's name as a sentence shows it: one display line, else "this instance". */
export const shownInstance = name => {
  const line = displayLine(name);
  return line === null || line === DETAIL_WITHHELD ? 'this instance' : line;
};

/** The dialog's and the outcomes' sentences for one row. */
export function forgetWords(row) {
  const name = shownInstance(row.instance), label = serverLabel(row);
  const on = shownLabel(label), first = shownLabel(label, true);
  return {
    question: `Forget ${name} on ${on}?`,
    effect: `This computer drops its saved route to it and stops listing it. Nothing changes on ${on}.`,
    basis: `${first} did not list it at the last read.`,
    running: `Forgetting ${name}…`,
    forgot: `Forgot ${name} on ${on}.`,
    noRoute: `This computer had no saved route for ${name} on ${on}; nothing was changed.`,
    refused: `Couldn't forget ${name}.`,
    unknown: `It is not known whether ${name} was forgotten.`,
  };
}

/** What one answer says, as `{ text, focus }`: `focus` is `next` (the row is no longer this computer's) or `opener`. */
export function forgetOutcome(answer, row) {
  const words = forgetWords(row), reason = answer?.reason;
  if (answer?.status === 'forgotten' && answer.server === row.server && answer.instance === row.instance) return { text: words.forgot, focus: 'next' };
  if (answer?.status === 'refused' && reason?.code === 'E_SNAPSHOT_UNKNOWN') return { text: words.noRoute, focus: 'next' };
  if (answer?.status === 'refused' && typeof reason?.code === 'string') {
    return { text: [words.refused, ...kernelLines(reason.message, undefined, DESKTOP_TERMS)].join('\n'), focus: 'opener' };
  }
  // Nothing ran: the backend's own reason, one of its fixed sentences, shown as a line of the Desktop's.
  if (answer?.status === 'not-run') {
    const line = displayLine(reason?.message);
    return { text: [words.refused, ...(line && line !== DETAIL_WITHHELD ? [line] : [])].join('\n'), focus: 'opener' };
  }
  return { text: words.unknown, focus: 'opener' };
}

let dialogs = 0;

export function createForgetDialog({ doc, request, notify = () => {}, nextFocus = () => null,
  generation = () => 0, subscribeWorkspace = () => () => {}, onIntent = () => {}, applyFocus = fn => fn() } = {}) {
  let alive = true, overlay = null, ui = null, row = null, restore = null, phase = null, life = 0, release = null, yieldTo = null, handoff = null;
  const inFlight = new Set(); // `server\0instance` of every Forget sent and not answered, whichever dialog sent it
  const keyOf = r => `${r.server}\0${r.instance}`;
  const node = (tag, text, cls) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  /** While busy: every keydown is this dialog's, and focus stays in it (the status line). */
  function holdWindow() {
    const win = doc.defaultView;
    const held = () => !!ui && phase === 'running';
    const onKey = event => {
      if (!held()) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (doc.activeElement !== ui.status) ui.status.focus();
    };
    const onFocus = event => { if (held() && !ui.dialog.contains(event.target)) ui.status.focus(); };
    win.addEventListener('keydown', onKey, true); doc.addEventListener('focusin', onFocus, true);
    return () => { win.removeEventListener('keydown', onKey, true); doc.removeEventListener('focusin', onFocus, true); };
  }
  function unhold() { const done = release; release = null; done?.(); }
  function close({ focus = 'opener', next = null } = {}) {
    unhold();
    if (yieldTo) { doc.removeEventListener('focusin', yieldTo, true); yieldTo = null; }
    handoff?.(); handoff = null;
    if (!overlay) return;
    life++; overlay.remove(); overlay = null; ui = null; row = null; phase = null;
    const back = restore; restore = null;
    if (focus === 'none') return;
    applyFocus(() => {
      if (focus === 'next') { const target = next ?? nextFocus(); target?.focus?.(); if (target && doc.activeElement === target) return; }
      if (back?.restoreExact ? back.restoreExact() : back?.restore()) return;
      back?.restore();
    });
  }
  function paint() {
    if (!ui) return;
    const busy = phase === 'running';
    ui.dialog.dataset.phase = phase;
    ui.dialog.setAttribute('aria-busy', String(busy));
    ui.cancel.disabled = busy; ui.confirm.disabled = busy;
    // A disabled control names why: the status line, which says what runs.
    for (const b of [ui.cancel, ui.confirm]) { if (busy) b.setAttribute('aria-describedby', ui.status.id); else b.removeAttribute('aria-describedby'); }
    ui.spinner.hidden = !busy;
    ui.statusText.textContent = busy ? ui.words.running : '';
    ui.status.hidden = !busy;
  }
  async function forget() {
    if (!overlay || phase !== 'review' || inFlight.has(keyOf(row))) return;
    onIntent();
    const sent = row, key = keyOf(sent), mounted = life, mountedGeneration = generation();
    const owns = () => alive && overlay && life === mounted && generation() === mountedGeneration;
    inFlight.add(key); phase = 'running'; paint(); release = holdWindow();
    // Busy, nothing replaces it: a dialog opened now captures its own opener.
    handoff?.(); handoff = null;
    // Focus waits on the status line while the command runs: every control is disabled.
    applyFocus(() => ui.status.focus());
    let answer = null;
    try { answer = await request({ server: sent.server, instance: sent.instance }); } catch { answer = null; }
    finally { inFlight.delete(key); }
    if (!owns()) return;
    const outcome = forgetOutcome(answer, sent);
    // The next row: the first row that followed the forgotten one when the dialog opened and is still shown.
    const next = outcome.focus === 'next' ? nextFocus(sent) : null;
    close({ focus: outcome.focus, next });
    notify(outcome.text);
  }
  function open(instance) {
    if (!alive || !forgettable(instance)) return false;
    // A busy dialog stays: nothing reopens or replaces it while its command runs.
    if (phase === 'running' || inFlight.has(keyOf(instance))) return false;
    close({ focus: 'none' });
    onIntent(); restore = takePickerFocusReturn(doc); life++;
    row = instance; phase = 'review';
    const words = forgetWords(instance), id = `forget-${++dialogs}`, mounted = life, mountedGeneration = generation();
    const current = () => alive && overlay && life === mounted && generation() === mountedGeneration;
    overlay = node('div', undefined, 'palette-overlay lifecycle-overlay');
    const dialog = node('section', undefined, 'lifecycle-dialog'); dialog.dataset.operation = 'forget';
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', `${id}-title`); dialog.setAttribute('aria-describedby', `${id}-effect ${id}-basis`);
    const heading = node('div', undefined, 'lifecycle-heading'), mark = node('span', undefined, 'lifecycle-mark');
    mark.append(iconElement(doc, 'close', { size: 18 })); mark.setAttribute('aria-hidden', 'true');
    const h2 = node('h2', words.question); h2.id = `${id}-title`;
    const status = node('p', undefined, 'lifecycle-status'), spinner = node('span', undefined, 'spinner'), statusText = node('span');
    status.id = `${id}-status`; status.setAttribute('role', 'status'); status.tabIndex = -1; spinner.setAttribute('aria-hidden', 'true');
    status.append(spinner, statusText);
    const titles = node('div', undefined, 'lifecycle-titles'); titles.append(h2, status); heading.append(mark, titles);
    const effect = node('p', words.effect); effect.id = `${id}-effect`;
    const basis = node('p', words.basis, 'lifecycle-note'); basis.id = `${id}-basis`;
    const footer = node('div', undefined, 'lifecycle-footer');
    const button = (label, cls, action) => {
      const b = node('button', label, cls); b.type = 'button';
      b.addEventListener('click', () => { if (current() && b.isConnected && !b.disabled) action(); });
      return b;
    };
    const cancel = button('Cancel', 'lifecycle-close', () => { if (phase === 'review') close(); });
    const confirm = button('Forget', 'lifecycle-confirm', () => { void forget(); });
    footer.append(cancel, confirm);
    dialog.append(heading, effect, basis, footer); overlay.append(dialog); doc.body.append(overlay);
    ui = { dialog, status, statusText, spinner, cancel, confirm, words };
    overlay.addEventListener('keydown', event => {
      if (!current()) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (phase === 'review') close(); return; }
      if (event.key !== 'Tab') return;
      const all = [...dialog.querySelectorAll('button')].filter(el => !el.disabled && !el.hidden);
      // Busy: no control can act, so focus stays on the status line.
      if (!all.length) { event.preventDefault(); status.focus(); return; }
      if (event.shiftKey && doc.activeElement === all[0]) { event.preventDefault(); all.at(-1).focus(); }
      else if (!event.shiftKey && doc.activeElement === all.at(-1)) { event.preventDefault(); all[0].focus(); }
      else if (!dialog.contains(doc.activeElement)) { event.preventDefault(); all[0].focus(); }
    });
    // Before the press, another modal closes this one: through the handoff before it captures its opener,
    // else when it takes focus (busy, holdWindow keeps focus here instead).
    handoff = joinPickerFocusReturn(doc, { opener: restore, dismiss: () => { if (phase === 'review' && current()) close({ focus: 'none' }); } });
    yieldTo = event => {
      if (phase !== 'review' || !current() || dialog.contains(event.target)) return;
      if (event.target?.closest?.('[aria-modal="true"]')) close({ focus: 'none' });
    };
    doc.addEventListener('focusin', yieldTo, true);
    paint();
    applyFocus(() => cancel.focus());
    return true;
  }
  const off = subscribeWorkspace(() => close({ focus: 'none' }));
  return { open, close: () => { if (phase !== 'running') close(); }, busy: () => phase === 'running',
    dispose() { close({ focus: 'none' }); alive = false; off(); } };
}

/** The row to take focus once `order[at]` is forgotten: the first one after it that is still in `rows` (matched
 * by `data-tree-instance`), else null (the caller's roster). Never one before it: the spec's "next row". */
export function forgetSuccessor(rows, order, at) {
  if (!(at >= 0)) return null;
  return order.slice(at + 1).map(id => rows.find(r => r.dataset.treeInstance === id)).find(Boolean) ?? null;
}
