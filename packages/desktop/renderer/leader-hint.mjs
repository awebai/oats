/* oats desktop — the leader's hint (docs/desktop-keyboard.md, "The leader").

   A live region at the bottom of the main area. While the leader waits it shows nothing: the wait is
   announced once to a screen reader ("Leader: press a key, Esc for the instances list"), and the keys
   are listed in the shortcuts editor (the leader's `?`). After a key whose act cannot run, or a
   sidebar key's, it shows one quiet line saying why, announced as it shows (`role="status"`). It
   never takes focus and holds nothing focusable. Shown, its surface is opaque (--surface-2, a raised
   surface with --fg text, an inventoried pair). The region is always in the document, out of sight
   unless it shows a line, so assistive technology hears what is put into it.

   The shell decides when it closes: a line stays until the next keydown, click or focus change. */

export const LEADER_ANNOUNCEMENT = "Leader: press a key, Esc for the instances list";

/** @param {{ doc: Document, host: Element, before?: Element | null }} o  host: the main area (#main);
 *  before: the child it goes in front of (Show instance panel stays the main area's last child). */
export function createLeaderHint({ doc, host, before = null }) {
  const el = doc.createElement("div");
  el.className = "leader-hint";
  el.id = "leader-hint";
  el.setAttribute("role", "status");
  host.insertBefore(el, before && before.parentNode === host ? before : null);
  let mode = null; // null | "wait" | "line"

  const clear = () => { el.replaceChildren(); };

  return {
    element: el,
    /** The leader waits: announced, for a screen reader only. Nothing is drawn. */
    announce() {
      clear();
      const said = doc.createElement("p");
      said.className = "sr-only";
      said.textContent = LEADER_ANNOUNCEMENT;
      el.append(said);
      el.dataset.mode = mode = "wait";
    },
    /** One line saying why nothing ran. */
    say(line) {
      clear();
      const p = doc.createElement("p");
      p.className = "leader-hint-line";
      p.textContent = String(line);
      el.append(p);
      el.dataset.mode = mode = "line";
    },
    hide() {
      if (!mode) return;
      clear();
      delete el.dataset.mode;
      mode = null;
    },
    mode: () => mode,
    /** Something is drawn: a line (the wait draws nothing). */
    isShown: () => mode === "line",
  };
}
