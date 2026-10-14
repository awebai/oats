/** Terminals draw again after a GPU process restart (#1190). Chromium replaces
 * its GPU process after sleep or a Space switch: every WebGL context is lost
 * and restored. xterm keeps one glyph atlas per config, shared by every
 * terminal in the window, and the reset wipes its page canvases while its
 * glyph cache still believes they are filled, so every terminal draws blank
 * (backgrounds and the cursor only). A fresh WebGL addon re-joins that stale
 * atlas, and `term.refresh()` redraws from it.
 *
 * The cure is `clearTextureAtlas()` on every live terminal of the window,
 * hidden tabs included, in one synchronous pass once the restores have
 * settled. Never one terminal's own clear from its own restore event: each
 * clear re-lays out the shared atlas under terminals that already uploaded it
 * again, and glyphs garble. So each `webglcontextrestored` (listened for on
 * the document in the capture phase, as it does not bubble) and each
 * `schedule()` restarts one timer, and the pass runs when it fires.
 *
 * `terminals()` is the shell's list of live xterm Terminals, read at pass
 * time: this module keeps no terminal of its own. One clear that throws, or a
 * disposed terminal, does not stop the rest. */
export const ATLAS_RECOVERY_SETTLE_MS = 250;

export function createTerminalAtlasRecovery({ doc, terminals }) {
  let timer = null, disposed = false;
  function pass() {
    timer = null;
    let list = [];
    try { list = [...terminals()]; } catch { return; }
    for (const term of list) { try { term.clearTextureAtlas(); } catch {} }
  }
  function schedule() {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(pass, ATLAS_RECOVERY_SETTLE_MS);
  }
  const onRestored = () => schedule();
  doc.addEventListener('webglcontextrestored', onRestored, true);
  function dispose() {
    disposed = true;
    doc.removeEventListener('webglcontextrestored', onRestored, true);
    clearTimeout(timer); timer = null;
  }
  return { schedule, dispose };
}
