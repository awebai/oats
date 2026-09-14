/** Browser-only Open File entry. Statically import this module: choose() must
 * reach input.click() synchronously inside the original user gesture.
 *
 * beginIntent() returns an owns() predicate capturing the shell's selection
 * AND workspace generation at invocation (including A→B→A). openFile receives
 * the selected File and that predicate, extended by this opener's lifetime.
 * It must retain the predicate across module loading and tab creation; it
 * must NOT mint a replacement selection intent when the file arrives. Once
 * created, the immutable read belongs to that tab's lifetime, not selection.
 *
 * No path discovery, basename deduplication, reading, uploads or terminal
 * handoff happens here. Each pick is a new supporting read-only artifact.
 * report receives only fixed, user-readable diagnostics, never a File, its
 * contents, a native path or a browser/host exception containing credentials.
 */
import { takePickerFocusReturn } from "./overlay-picker.mjs";

export function createFileOpener({ document, beginIntent, openFile, report = () => {} }) {
  let generation = 0;
  let disposed = false;
  let dismissChooser = null;

  function choose() {
    if (disposed) return;
    const ticket = ++generation;
    dismissChooser?.();
    const returnFocus = takePickerFocusReturn(document);
    const parentOwns = beginIntent(); // before click, never at change/read completion
    let cancelled = false;
    const owns = () => !disposed && !cancelled && ticket === generation && parentOwns();
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = false;
    input.hidden = true;
    input.setAttribute("aria-label", "Open a read-only file");
    let settled = false;
    const cleanup = () => {
      settled = true;
      input.removeEventListener("change", changed);
      input.removeEventListener("cancel", cancel);
      input.remove();
      input.value = ""; // release the FileList; the selected File has its own owner
      if (dismissChooser === cleanup) dismissChooser = null;
    };
    const cancel = () => {
      if (settled) return;
      // Only an owned cancellation returns to the logical opener. Stale
      // native events cannot steal newer focus or resurrect a palette trap.
      const restore = owns();
      cancelled = true;
      cleanup();
      if (restore) returnFocus.restore();
    };
    const failed = () => {
      if (owns()) report("Could not open the selected file. Please choose it again.");
    };
    const changed = () => {
      if (settled) return;
      const file = input.files?.[0];
      if (!file) { cancel(); return; }
      cleanup();
      if (!owns()) return;
      try {
        // Invoke synchronously too; contain both throws and async rejections.
        Promise.resolve(openFile(file, owns)).catch(failed);
      } catch { failed(); }
    };
    dismissChooser = cleanup;
    input.addEventListener("change", changed);
    input.addEventListener("cancel", cancel);
    try {
      document.body.append(input);
      input.click(); // NO await/dynamic import before this user-activation boundary
    } catch {
      cleanup();
      if (owns()) {
        report("Could not open the file chooser. Please try again.");
        returnFocus.restore();
      }
      cancelled = true;
    }
  }

  function dispose() {
    disposed = true;
    ++generation;
    dismissChooser?.();
  }
  return { choose, dispose };
}
