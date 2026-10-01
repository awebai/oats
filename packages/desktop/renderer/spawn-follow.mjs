/** After a press (Spec E): the spawn dialog closes at once and the background store runs the spawn
 * (spawn-jobs.mjs). When the created instance is running in the roster, the operator is taken to it:
 * its terminal tab opens and its roster row is the selected one, as clicking the row does.
 *
 * No toast for a success (addendum 2): arriving there is the confirmation. When the operator is not
 * taken there, the real row (which replaced the pending one in place) wears a quiet "New" mark until it
 * or its tab is first opened. Either way one polite announcement, "<name> spawned", tells assistive tech.
 * A partial spawn (its wake schedule was not saved) is followed the same way but says nothing here: its
 * own notification already says what did not finish.
 *
 * Never a yank: the operator is busy only if they ACTED since the press. Where focus merely rests (the
 * dialog returns it to where it was opened from, often a terminal) does not count. The operator is NOT
 * taken there when, at that moment, any of these holds:
 * - a modal or an overlay is open (a dialog, the palette, Quick Open, a confirmation, the shortcuts
 *   editor, an open popover menu);
 * - they produced input since the press: a keydown other than a lone modifier, `input`, `paste` or
 *   `compositionstart`, anywhere in the window (watchOperator: an input generation, captured at the
 *   document, operator-generated events only; terminal output is not input);
 * - they moved focus since the press: it is no longer where the dialog returned it, after a pointer
 *   press of theirs (Tab is a keydown already). Focus the app moves itself (the dialog's return landing on
 *   another stage, a terminal's readiness) is not theirs;
 * - they navigated since the press: opened or activated another tab or view, used the sidebar, switched
 *   workspace (the shell's selection-ownership ticket, taken at the press without cancelling anything
 *   pending, `watch()`), or the connection changed since the press.
 * The open itself is asynchronous; the same holds through every step of it, and it stops (the row says
 * New instead) as soon as one does not. Once it has selected the terminal, the operator was there: leaving
 * it while it attaches is not New. Only a spawn pressed in this window is followed: a recovered one (after a
 * reload) is only marked. */

// Keys that alone produce nothing: pressing one is not input.
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'Super', 'Hyper', 'Fn', 'FnLock',
  'CapsLock', 'NumLock', 'ScrollLock', 'Symbol', 'SymbolLock']);

/** Whether `e` is operator input (a lone modifier is not). */
export function operatorInput(e) {
  if (!e) return false;
  if (e.type === 'keydown') return !MODIFIER_KEYS.has(e.key);
  return e.type === 'input' || e.type === 'paste' || e.type === 'compositionstart';
}

/** What the operator does in the window, as generations that only grow: `input()` (operatorInput) and
 * `pointer()` (pointer presses). Listens at `target` (the document) in the capture phase, so nothing in
 * the page (xterm included) hides an event from it. Only operator-generated events count (`trusted`). */
export function watchOperator(target, { trusted = e => e.isTrusted === true } = {}) {
  let input = 0, pointer = 0;
  const onInput = e => { if (trusted(e) && operatorInput(e)) input++; };
  const onPointer = e => { if (trusted(e)) pointer++; };
  const inputs = ['keydown', 'input', 'paste', 'compositionstart'], pointers = ['pointerdown', 'mousedown'];
  for (const type of inputs) target.addEventListener(type, onInput, true);
  for (const type of pointers) target.addEventListener(type, onPointer, true);
  return {
    input: () => input,
    pointer: () => pointer,
    dispose() {
      for (const type of inputs) target.removeEventListener(type, onInput, true);
      for (const type of pointers) target.removeEventListener(type, onPointer, true);
    },
  };
}

/**
 * @param watch()  a ticket true while nothing explicit happened since it was taken
 * @param operator  watchOperator(document): { input(), pointer() }
 * @param overlayOpen()  a modal or overlay is open
 * @param activeElement()  where focus is now
 * @param currentWorkspace(), connection()  the workspace on screen and the connection generation
 * @param open(row, workspace, valid)  open the row's terminal tab, asynchronously; every step of it (and its
 *   readiness focus) is gated by valid(). Resolves true when the open selected that terminal, even if the
 *   operator has moved on from it since (it was opened, so it is not New).
 * @param markNew(row, workspace)  the row wears "New" until it or its tab is first opened
 * @param announce(text)  the roster's polite live region
 */
export function createSpawnFollow({ watch, operator = { input: () => 0, pointer: () => 0 }, overlayOpen = () => false,
  activeElement = () => null, currentWorkspace = () => '', connection = () => 0, open, markNew = () => {}, announce = () => {} }) {
  const follows = new Map(); // job id → the press: its ticket, connection, operator generations and focus
  // Whether the operator has not acted since `press`. A guard that cannot answer is a busy operator.
  const quiet = press => {
    try {
      if (overlayOpen() || operator.input() !== press.input) return false;
      return operator.pointer() === press.pointer || activeElement() === press.focus;
    } catch { return false; }
  };
  const followed = press => !!press && !!press.owns() && press.connection === connection();
  return {
    /** The press of job `id` just closed the dialog (after its focus return): follow it, unless the operator
     * acts first. */
    follow(id) {
      if (!id) return;
      let focus = null;
      try { focus = activeElement(); } catch { /* compared by identity: nothing matches it */ }
      follows.set(id, { owns: watch(), connection: connection(), input: operator.input(), pointer: operator.pointer(), focus });
    },
    /** Whether job `id` is followed (nothing explicit happened and the connection held since its press). */
    following: id => followed(follows.get(id)),
    /** The created instance of job `id` is running in the roster. `complete` false: a partial spawn, whose
     * own notification already spoke. Resolves 'opened' (the operator was taken there), 'marked' (its row
     * says New) or 'quiet' (a partial spawn not followed: nothing more to say). */
    async arrived(row, workspace, epoch, { id = null, complete = true } = {}) {
      const press = id ? follows.get(id) : null;
      if (id) follows.delete(id);
      let opened = false;
      if (followed(press) && epoch === press.connection && workspace === currentWorkspace() && quiet(press)) {
        // The open is asynchronous (the roster read, the key, the terminal's readiness): each step goes on only
        // while the operator still has not acted, on the same connection and workspace. Navigating supersedes
        // the open's own ticket.
        const valid = () => connection() === press.connection && currentWorkspace() === workspace && quiet(press);
        try { opened = (await open(row, workspace, valid)) === true; } catch { opened = false; }
      }
      if (!complete) return opened ? 'opened' : 'quiet';
      if (!opened) markNew(row, workspace);
      announce(`${row.instance} spawned`);
      return opened ? 'opened' : 'marked';
    },
    /** Drop the follows of jobs the store no longer holds. */
    prune(held) { for (const id of [...follows.keys()]) if (!held(id)) follows.delete(id); },
    size: () => follows.size,
  };
}
