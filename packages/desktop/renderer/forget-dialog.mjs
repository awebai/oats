/** Forget a remote instance its host no longer lists (#1131): the informed press before `oats server forget`.
 * Offered only on a row whose reason is `missing` (remote-address.mjs `rowReason`: the host was reached and
 * did not list it), from the row's actions menu and from the context panel; both open this one dialog.
 *
 * It is the Stop and Retire confirmation's dialog (lifecycle-dialog.mjs): its classes, its status line, its
 * Escape and Tab handling and its focus return, with no plan to read. Opening, Cancel and Escape send
 * nothing. Forget sends exactly one request, `{ server, instance }` of the row it was opened for, through
 * `request`; the backend composes the command (server/server-forget.mjs). While it runs the dialog is busy:
 * Escape and Cancel do nothing, focus waits on the status line and Tab stays there, and no entry point can
 * send again (`open` refuses a row whose Forget is in flight, wherever it was opened).
 *
 * Every answer, and a request that failed, ends with `reread()` once: the roster is read again, never edited
 * here. Then the dialog closes and the outcome is said through `notify`:
 *   forgotten            "Forgot <instance> on <server>."; focus to the roster's next row (`nextFocus`)
 *   E_SNAPSHOT_UNKNOWN   no saved route was there; focus as for forgotten: the row is not this computer's
 *   another refusal      "Couldn't forget <instance>." and the kernel's lines; focus back to the opener
 *   nothing ran          "Couldn't forget <instance>." and the Desktop's own reason; focus back to the opener
 *   unknown              "It is not known whether <instance> was forgotten."; focus back to the opener
 * An answer that lands after the dialog stopped owning its request (a workspace change, dispose) still
 * re-reads, and says and moves nothing. Names enter a sentence through the display filter: the server's
 * label as remote-address.mjs `shownLabel`, the instance by the same rule ("this instance" when withheld). */
import { takePickerFocusReturn } from './overlay-picker.mjs';
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

export function createForgetDialog({ doc, request, reread = () => {}, notify = () => {}, nextFocus = () => null,
  generation = () => 0, subscribeWorkspace = () => () => {}, onIntent = () => {}, applyFocus = fn => fn() } = {}) {
  let alive = true, overlay = null, ui = null, row = null, restore = null, phase = null, life = 0;
  const inFlight = new Set(); // `server\0instance` of every Forget sent and not answered, whichever dialog sent it
  const keyOf = r => `${r.server}\0${r.instance}`;
  const node = (tag, text, cls) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  function close({ focus = 'opener', next = null } = {}) {
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
    inFlight.add(key); phase = 'running'; paint();
    // Focus waits on the status line while the command runs: every control is disabled.
    applyFocus(() => ui.status.focus());
    let answer = null;
    try { answer = await request({ server: sent.server, instance: sent.instance }); } catch { answer = null; }
    finally { inFlight.delete(key); }
    // The roster is read again after every answer, also one this dialog no longer owns.
    try { Promise.resolve(reread()).catch(() => {}); } catch { /* a re-read cannot erase the outcome */ }
    if (!owns()) return;
    const outcome = forgetOutcome(answer, sent);
    // The next row is the one after the forgotten row as the roster stands now, before the re-read removes it.
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
    paint();
    applyFocus(() => cancel.focus());
    return true;
  }
  const off = subscribeWorkspace(() => close({ focus: 'none' }));
  return { open, close: () => { if (phase !== 'running') close(); }, busy: () => phase === 'running',
    dispose() { close({ focus: 'none' }); alive = false; off(); } };
}
