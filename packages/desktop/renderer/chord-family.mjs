/* oats desktop — the chord family in the page (renderer side of chord-family.mjs).

   Main reads keys.json and answers the family the shared chords bind on Linux/Windows: Ctrl+Alt,
   the default, or Ctrl+Shift (packages/client/keymap.mjs CHORD_FAMILIES). This module asks main for
   it as the window starts, takes every change main pushes (another window's choice, a hand edit
   seen at app focus), and sets the Shortcuts page's choice through main, which writes the file.
   Each state taken is applied at once (`apply`: the engine's setChordFamily), so the keymap, its
   hints and the editor follow without a restart (docs/desktop-keyboard.md, "Switch to Ctrl+Shift").

   The shell awaits `start()` before it listens to its first key, so no key is read in the default
   family while main's answer is on its way. Without the bridge, or when main does not answer, the
   family is the default. What main sends is checked again here: an unknown family is the default,
   and the note is a short line or nothing. The page never imports keys-file.mjs (it names a Node
   builtin, and the page is a browser page). */
import { CHORD_FAMILIES, DEFAULT_CHORD_FAMILY } from "../../client/keymap.mjs";

/** The longest note the page shows; chordFamilyNote's lines are far shorter. */
const NOTE_LIMIT = 200;

/** The state in use when main has said nothing: the default family, and nothing to say. */
export const DEFAULT_CHORD_STATE = Object.freeze({ family: DEFAULT_CHORD_FAMILY, note: null });

/** What main sent, as the page takes it: frozen `{ family, note }`, the default family for anything
 * that names none of CHORD_FAMILIES, and `note` the line to show (chordFamilyNote) or null. */
export function chordFamilyState(value) {
  const family = CHORD_FAMILIES.includes(value?.family) ? value.family : DEFAULT_CHORD_FAMILY;
  const note = typeof value?.note === "string" && value.note.trim() && value.note.length <= NOTE_LIMIT ? value.note : null;
  return Object.freeze({ family, note });
}

/** The page's chord family. `desk` is the preload bridge (window.oatsDesktop), `apply(family)` what
 * binds a family (keybindings.mjs setChordFamily).
 *
 *   start()       -> asks main once and follows its pushes; resolves (never rejects) to the state
 *   current()     -> the state in use, { family, note }
 *   set(family)   -> asks main to write it; resolves to the state main then read, rejects when the
 *                    write failed or there is no bridge (the state in use is unchanged then)
 *   onChange(fn)  -> fn(state) on every change of family or note; returns the unsubscribe
 *   dispose()     -> stops following main's pushes */
export function createChordFamily({ desk, apply = () => {} } = {}) {
  let state = DEFAULT_CHORD_STATE, off = null, started = null;
  const listeners = new Set();
  function take(value) {
    const next = chordFamilyState(value);
    if (next.family === state.family && next.note === state.note) return state;
    state = next;
    try { apply(state.family); } catch { /* the keymap keeps the family it has */ }
    for (const fn of [...listeners]) { try { fn(state); } catch { /* isolate a listener */ } }
    return state;
  }
  return {
    start() {
      if (started) return started;
      started = (async () => {
        // Follow first, then ask: a push sent before the answer is no older than it.
        try { off = desk?.onChordFamilyChanged?.((value) => { take(value); }) ?? null; } catch { off = null; }
        if (typeof desk?.chordFamily !== "function") return state;
        try { take(await desk.chordFamily()); } catch { /* the default family */ }
        return state;
      })();
      return started;
    },
    current: () => state,
    async set(family) {
      if (typeof desk?.setChordFamily !== "function") throw new Error("This window cannot write keys.json.");
      return take(await desk.setChordFamily(family));
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() { const stop = off; off = null; try { stop?.(); } catch { /* the window is going */ } },
  };
}
