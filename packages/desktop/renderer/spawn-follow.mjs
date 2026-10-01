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
 * Never a yank. The operator is NOT taken there when, at that moment, any of these holds:
 * - they did something explicit since the press: opened or activated another tab or view, used the
 *   sidebar, switched workspace (the shell's selection-ownership ticket, taken at the press without
 *   cancelling anything pending, `watch()`), or the connection changed;
 * - focus is where they type: a text field, a textarea, contentEditable, or a terminal;
 * - a modal or an overlay is open (a dialog, the palette, Quick Open, a confirmation, the shortcuts
 *   editor, an open popover menu).
 * Only a spawn pressed in this window is followed: a recovered one (after a reload) is only marked. */

// <input> types that take no typing: focus on one of them is not "in the middle of typing".
const NOT_TYPED = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden']);

/** Whether focus on `el` means the operator may be typing. */
export function typingTarget(el) {
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return !NOT_TYPED.has(String(el.type || 'text').toLowerCase());
  return el.isContentEditable === true;
}

/**
 * @param watch()  a ticket true while nothing explicit happened since it was taken
 * @param overlayOpen()  a modal or overlay is open
 * @param activeElement()  where focus is now
 * @param inTerminal(el)  `el` is a terminal (its input or its pane)
 * @param currentWorkspace(), connection()  the workspace on screen and the connection generation
 * @param open(row, workspace)  open the row's terminal tab; false when it cannot be addressed
 * @param markNew(row, workspace)  the row wears "New" until it or its tab is first opened
 * @param announce(text)  the roster's polite live region
 */
export function createSpawnFollow({ watch, overlayOpen = () => false, activeElement = () => null, inTerminal = () => false,
  currentWorkspace = () => '', connection = () => 0, open, markNew = () => {}, announce = () => {} }) {
  const follows = new Map(); // job id → its press's ticket
  /** Whether the operator is busy right now (typing, in a terminal, an overlay open). */
  const busy = () => {
    let el = null;
    try { el = activeElement(); } catch { return true; }
    try { if (overlayOpen()) return true; } catch { return true; }
    return typingTarget(el) || !!inTerminal(el);
  };
  return {
    /** The press of job `id` just closed the dialog: follow it, unless something newer happens. */
    follow(id) { if (id) follows.set(id, watch()); },
    /** Whether job `id` is followed (and nothing explicit happened since its press). */
    following: id => !!follows.get(id)?.(),
    /** The created instance of job `id` is running in the roster. `complete` false: a partial spawn, whose
     * own notification already spoke. Returns 'opened' (the operator was taken there), 'marked' (its row
     * says New) or 'quiet' (a partial spawn not followed: nothing more to say). */
    arrived(row, workspace, epoch, { id = null, complete = true } = {}) {
      const owns = id ? follows.get(id) : null;
      if (id) follows.delete(id);
      const go = !!owns?.() && workspace === currentWorkspace() && epoch === connection() && !busy();
      const opened = go && open(row, workspace) === true;
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
