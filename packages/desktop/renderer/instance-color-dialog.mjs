/** An instance's name and colour (#1421 §2): a small dialog that shows the instance's name (read-only until
 * names can change) and sets its colour, through `oats instance color` (server/instance-color.mjs, feature
 * `instance-color`). It opens from the palette ("Instance: name and colour…") and from its chord
 * (`instance.edit`, CHORDS `edit-instance`), for the leader's target (shell.mjs leaderTargetId); no row menu.
 *
 * It is the Stop and Retire confirmation's dialog (lifecycle-dialog.mjs): its classes, its status line, its
 * Escape and Tab handling and its focus return, as Forget's (forget-dialog.mjs) is. The colour is a group of
 * seven toggle buttons, "None" and the palette (soul-colors.mjs SOUL_COLORS), each a circle and its name; the
 * current one is pressed (`aria-pressed`). The arrows, Home and End move focus among them (one tab stop, the
 * pressed one) and apply nothing; Enter, Space or a click applies at once. The dialog stays open until Close
 * or Escape, and focus goes back where it was when it opened.
 *
 * Opening asks the server whether the colour can be set here (`check: true`; nothing runs). Until it answers,
 * and when it cannot, the swatches are disabled (`aria-disabled`, so they keep focus) and a note says why:
 *   this computer's OATS lacks the feature   "Setting a colour needs OATS 0.67.0 or later."
 *   the instance's host lacks it             "<server>'s OATS can't set colours yet."
 *   the home is held (spawning, retiring)    the row's own held line (speaker-line.mjs heldLine)
 *   nothing ran for another reason           the server's own sentence
 *
 * One request per instance at a time. A press while one runs is the latest intent: it is sent when the one in
 * flight answers, and only the last answer paints. The answer's `color` is the pressed swatch; the roster's
 * next read (the server reads it again after a change) draws the dots. The status line says "Saving…", then
 * "Saved.", the kernel's refusal under its name (kernel-lines.mjs: E_INSTANCE_RETIRING, E_LIFECYCLE_BUSY, …),
 * the server's own reason when nothing ran, or that the outcome is not known. An answer that lands after the
 * dialog stopped owning its request (closed, a workspace change, dispose) paints and moves nothing. */
import { takePickerFocusReturn, joinPickerFocusReturn } from './overlay-picker.mjs';
import { serverLabel, shownLabel } from '../../client/remote-address.mjs';
import { displayLine, DETAIL_WITHHELD } from '../../client/display-text.mjs';
import { kernelLines } from '../../client/kernel-lines.mjs';
import { instanceColor } from '../../client/instance-presentation.mjs';
import { SOUL_COLORS } from '../../client/soul-colors.mjs';
import { DESKTOP_TERMS } from './desktop-terms.mjs';
import { shownInstance } from './forget-dialog.mjs';

/** The choices, in the order the group shows them: none, then the palette. */
export const COLOR_CHOICES = Object.freeze([null, ...SOUL_COLORS]);
/** A choice's name, as its swatch says it. */
export const colorLabel = color => (color === null ? 'None' : `${color[0].toUpperCase()}${color.slice(1)}`);

/* The swatches. The circle's colour is the dot's (shell.css `[data-instance-color]` → --instance-color, the
 * theme's --soul-<colour>-fg), proven against the dialog's surfaces by test/theme-contrast.test.mjs; "None" is a
 * ring. Pressed is said by shape as well as by colour: a heavier edge and bold name. */
export const instanceColorCSS = `
.instance-color-swatches { display:flex; flex-wrap:wrap; gap:6px; }
.lifecycle-dialog .instance-color-swatch { display:inline-flex; align-items:center; gap:7px; height:30px; padding:0 11px 0 9px; border-radius:15px; font-weight:500; }
.lifecycle-dialog .instance-color-swatch[aria-pressed=true] { padding:0 10px 0 8px; border:2px solid var(--fg); font-weight:700; }
.lifecycle-dialog .instance-color-swatch[aria-disabled=true] { color:var(--faint); background:var(--surface-2); cursor:default; }
.instance-color-chip { flex:none; width:12px; height:12px; box-sizing:border-box; border:1.5px solid var(--muted); border-radius:50%; }
.instance-color-chip[data-instance-color] { border-color:var(--instance-color); background:var(--instance-color); }
.lifecycle-mark .instance-color-chip { width:16px; height:16px; }
`;

/** The dialog's sentences for one row. */
export function colorWords(row) {
  const name = shownInstance(row.instance);
  return {
    title: 'Name and colour',
    saving: 'Saving…',
    saved: 'Saved.',
    refused: `Couldn't set ${name}'s colour.`,
    unknown: `It is not known whether ${name}'s colour was saved.`,
    unavailableLocal: 'Setting a colour needs OATS 0.67.0 or later.',
    unavailableServer: `${shownLabel(serverLabel(row), true)}'s OATS can't set colours yet.`,
    uncheckable: "Couldn't find out whether this colour can be set.",
  };
}

/** The server's own sentence for a request that ran nothing, as one display line; null for none. */
const ownLine = reason => {
  const line = displayLine(reason?.message);
  return line && line !== DETAIL_WITHHELD ? line : null;
};

/** What the check on opening says: null (the colour can be set), else the note that says why not. */
export function checkNote(answer, row) {
  const words = colorWords(row);
  if (answer?.status === 'ok' && answer.check === true && answer.instance === row.instance) return null;
  if (answer?.status === 'not-run' && answer.reason?.code === 'E_INSTANCE_COLOR_UNAVAILABLE') {
    return answer.reason.details?.where === 'server' ? words.unavailableServer : words.unavailableLocal;
  }
  if (answer?.status === 'not-run') return ownLine(answer.reason) ?? words.uncheckable;
  return words.uncheckable;
}

/** What one write's answer says, as `{ color?, text, note? }`: `color` the pressed swatch when the kernel
 * answered it, `note` when the colour can no longer be set here. */
export function saveOutcome(answer, row) {
  const words = colorWords(row), reason = answer?.reason;
  if (answer?.status === 'ok' && answer.instance === row.instance && (answer.color === null || SOUL_COLORS.includes(answer.color))) {
    return { color: answer.color, text: words.saved };
  }
  if (answer?.status === 'refused' && typeof reason?.code === 'string') {
    return { text: [words.refused, ...kernelLines(reason.message, undefined, DESKTOP_TERMS)].join('\n') };
  }
  if (answer?.status === 'not-run') {
    const note = reason?.code === 'E_INSTANCE_COLOR_UNAVAILABLE' ? checkNote(answer, row) : null;
    const line = note ?? ownLine(reason);
    return { text: [words.refused, ...(line ? [line] : [])].join('\n'), ...(note ? { note } : {}) };
  }
  return { text: words.unknown };
}

let dialogs = 0;

/**
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {(row, body) => Promise<object>} deps.request  POST /api/instance-color for the row's deployment → its answer
 * @param {() => number} [deps.generation]  the window's workspace generation (views/common.mjs workspaceGeneration)
 * @param {(fn) => () => void} [deps.subscribeWorkspace]  a workspace change closes the dialog
 * @param {() => void} [deps.onIntent]  a press is the user's latest intent (tab-open intents yield to it)
 * @param {(fn) => void} [deps.applyFocus]
 */
export function createInstanceColorDialog({ doc, request, generation = () => 0, subscribeWorkspace = () => () => {},
  onIntent = () => {}, applyFocus = fn => fn() } = {}) {
  let alive = true, overlay = null, ui = null, restore = null, life = 0, yieldTo = null, handoff = null;
  const node = (tag, text, cls) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  function close({ focus = 'opener' } = {}) {
    if (yieldTo) { doc.removeEventListener('focusin', yieldTo, true); yieldTo = null; }
    handoff?.(); handoff = null;
    if (!overlay) return;
    life++; overlay.remove(); overlay = null; ui = null;
    const back = restore; restore = null;
    if (focus === 'none') return;
    applyFocus(() => { if (back?.restoreExact ? back.restoreExact() : back?.restore()) return; back?.restore(); });
  }
  /** Draws the state: which swatch is pressed, whether they can act, the note and the status line. */
  function paint() {
    if (!ui) return;
    const { state } = ui, usable = state.note === null && state.checked;
    for (const b of ui.swatches) {
      const color = b.dataset.color === 'none' ? null : b.dataset.color;
      b.setAttribute('aria-pressed', String(color === state.color));
      if (usable) { b.removeAttribute('aria-disabled'); b.removeAttribute('aria-describedby'); }
      else { b.setAttribute('aria-disabled', 'true'); if (state.note) b.setAttribute('aria-describedby', ui.note.id); }
    }
    if (state.color) ui.markChip.dataset.instanceColor = state.color; else delete ui.markChip.dataset.instanceColor;
    ui.note.textContent = state.note ?? '';
    ui.note.hidden = !state.note;
    const busy = state.sending;
    ui.dialog.setAttribute('aria-busy', String(busy));
    ui.spinner.hidden = !busy;
    ui.status.hidden = !state.said;
    const lines = (state.said || '').split('\n');
    ui.statusText.replaceChildren(...lines.map((line, i) => (i ? [node('br'), line] : [line])).flat());
  }
  /** One tab stop in the group: the pressed swatch, else the first. */
  function roving(focused = null) {
    if (!ui) return;
    const at = focused ?? ui.swatches.find(b => b.getAttribute('aria-pressed') === 'true') ?? ui.swatches[0];
    for (const b of ui.swatches) b.tabIndex = b === at ? 0 : -1;
  }
  /** Sends the latest intent, one request at a time; only the last answer paints. */
  async function pump(mounted, owns) {
    const { state } = ui;
    if (state.sending) return;
    state.sending = true;
    while (owns() && state.pending !== undefined) {
      const color = state.pending, row = ui.row;
      state.pending = undefined; state.said = colorWords(row).saving; paint();
      let answer = null;
      try { answer = await request(row, { instance: row.instance, home: row.home, color }); } catch { answer = null; }
      if (!owns() || life !== mounted) return;
      if (state.pending !== undefined) continue; // a newer press: this answer is not the last
      const outcome = saveOutcome(answer, row);
      if (outcome.color !== undefined) state.color = outcome.color;
      if (outcome.note) state.note = outcome.note;
      state.said = outcome.text;
    }
    if (!owns() || life !== mounted) return;
    state.sending = false; paint(); roving(doc.activeElement && ui.swatches.includes(doc.activeElement) ? doc.activeElement : null);
  }
  /**
   * Opens the dialog for `row` (a roster row: { instance, home, server?, color?, deployment? }). `held` is the
   * row's held line when its home is held, else null. Answers whether it opened.
   */
  function open(row, { held = null } = {}) {
    if (!alive || !row || typeof row.instance !== 'string' || typeof row.home !== 'string') return false;
    close({ focus: 'none' });
    onIntent(); restore = takePickerFocusReturn(doc); life++;
    const words = colorWords(row), id = `instance-color-${++dialogs}`, mounted = life, mountedGeneration = generation();
    const owns = () => alive && !!overlay && life === mounted && generation() === mountedGeneration;
    overlay = node('div', undefined, 'palette-overlay lifecycle-overlay');
    const dialog = node('section', undefined, 'lifecycle-dialog'); dialog.dataset.operation = 'instance-color';
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    const heading = node('div', undefined, 'lifecycle-heading'), mark = node('span', undefined, 'lifecycle-mark');
    const markChip = node('span', undefined, 'instance-color-chip'); mark.append(markChip); mark.setAttribute('aria-hidden', 'true');
    const h2 = node('h2', words.title); h2.id = `${id}-title`;
    const status = node('p', undefined, 'lifecycle-status'), spinner = node('span', undefined, 'spinner'), statusText = node('span');
    status.id = `${id}-status`; status.setAttribute('role', 'status'); spinner.setAttribute('aria-hidden', 'true');
    status.append(spinner, statusText);
    const titles = node('div', undefined, 'lifecycle-titles'); titles.append(h2, status); heading.append(mark, titles);
    // The name: plain text under its label (read-only until names can change).
    const nameSection = node('div', undefined, 'lifecycle-section');
    const nameLabel = node('h3', 'Name'); nameLabel.id = `${id}-name-label`;
    const name = node('p', shownInstance(row.instance), 'instance-color-name'); name.setAttribute('aria-labelledby', `${id}-name-label`);
    nameSection.append(nameLabel, name);
    // The colour: one labelled group of toggle buttons.
    const colorSection = node('div', undefined, 'lifecycle-section');
    const colorHeading = node('h3', 'Colour'); colorHeading.id = `${id}-color-label`;
    const group = node('div', undefined, 'instance-color-swatches');
    group.setAttribute('role', 'group'); group.setAttribute('aria-labelledby', `${id}-color-label`);
    const swatches = COLOR_CHOICES.map(color => {
      const b = node('button', undefined, 'instance-color-swatch'); b.type = 'button';
      b.dataset.color = color ?? 'none';
      const chip = node('span', undefined, 'instance-color-chip'); chip.setAttribute('aria-hidden', 'true');
      if (color) chip.dataset.instanceColor = color;
      b.append(chip, node('span', colorLabel(color)));
      b.addEventListener('click', () => {
        if (!owns() || !ui || b.getAttribute('aria-disabled') === 'true') return;
        onIntent(); roving(b);
        ui.state.pending = color; void pump(mounted, owns);
      });
      return b;
    });
    group.append(...swatches);
    const note = node('p', undefined, 'lifecycle-note'); note.id = `${id}-note`; note.hidden = true;
    colorSection.append(colorHeading, group, note);
    const footer = node('div', undefined, 'lifecycle-footer');
    const closeButton = node('button', 'Close', 'lifecycle-close'); closeButton.type = 'button';
    closeButton.addEventListener('click', () => { if (owns()) close(); });
    footer.append(closeButton);
    dialog.append(heading, nameSection, colorSection, footer); overlay.append(dialog); doc.body.append(overlay);
    const state = { color: instanceColor(row), note: held || null, checked: false, sending: false, pending: undefined, said: '' };
    ui = { dialog, status, statusText, spinner, note, markChip, swatches, row, state };
    overlay.addEventListener('keydown', event => {
      if (!owns()) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      const at = swatches.indexOf(doc.activeElement);
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (at >= 0 && (step || event.key === 'Home' || event.key === 'End')) {
        event.preventDefault();
        const next = step ? (at + step + swatches.length) % swatches.length : event.key === 'Home' ? 0 : swatches.length - 1;
        roving(swatches[next]); swatches[next].focus();
        return;
      }
      if (event.key !== 'Tab') return;
      // Two stops: the group (its roving swatch) and Close.
      const stops = [swatches.find(b => b.tabIndex === 0) ?? swatches[0], closeButton];
      if (event.shiftKey && doc.activeElement === stops[0]) { event.preventDefault(); closeButton.focus(); }
      else if (!event.shiftKey && doc.activeElement === closeButton) { event.preventDefault(); stops[0].focus(); }
      else if (!dialog.contains(doc.activeElement)) { event.preventDefault(); stops[0].focus(); }
    });
    // Another modal closes this one: through the handoff before it captures its opener, else when it takes focus.
    handoff = joinPickerFocusReturn(doc, { opener: restore, dismiss: () => { if (owns()) close({ focus: 'none' }); } });
    yieldTo = event => {
      if (!owns() || dialog.contains(event.target)) return;
      if (event.target?.closest?.('[aria-modal="true"]')) close({ focus: 'none' });
    };
    doc.addEventListener('focusin', yieldTo, true);
    paint(); roving();
    applyFocus(() => swatches.find(b => b.tabIndex === 0)?.focus());
    // Whether the colour can be set here: nothing runs. A held home asks nothing; its line stands.
    if (!held) {
      void (async () => {
        let answer = null;
        try { answer = await request(row, { instance: row.instance, home: row.home, check: true }); } catch { answer = null; }
        if (!owns() || !ui) return;
        state.note = checkNote(answer, row); state.checked = true; paint();
      })();
    }
    return true;
  }
  const off = subscribeWorkspace(() => close({ focus: 'none' }));
  return { open, close: () => close(), isOpen: () => !!overlay,
    dispose() { close({ focus: 'none' }); alive = false; off(); } };
}
