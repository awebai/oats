/* oats desktop — the leader's hint (docs/desktop-keyboard.md, "The leader").

   A quiet panel at the bottom of the main area. While the leader waits it lists the keys that
   apply now (leader-keys.mjs), one per line, key then label; after a key whose act cannot run, or
   a sidebar key's, it shows one line saying why. It is `role="status"`: the wait is announced
   once ("Leader: press a key, Esc for the instances list"), the keys themselves are drawn for the
   eye only (the editor lists them for everyone), and a line saying why is announced as it shows.
   It never takes focus and holds nothing focusable. Its surface is opaque (--surface-2, a raised
   surface with --fg and --muted text, inventoried pairs): it shows everything it says itself.
   The region is always in the document, empty and out of sight while idle, so assistive
   technology hears what is put into it.

   The shell decides when it closes: a line stays until the next keydown, click or focus change. */

import { keyIdCaps } from "./leader-keys.mjs";

export const LEADER_ANNOUNCEMENT = "Leader: press a key, Esc for the instances list";

/** @param {{ doc: Document, host: Element, before?: Element | null }} o  host: the main area (#main);
 *  before: the child it goes in front of (Show instance panel stays the main area's last child). */
export function createLeaderHint({ doc, host, before = null }) {
  const el = doc.createElement("div");
  el.className = "leader-hint";
  el.id = "leader-hint";
  el.setAttribute("role", "status");
  host.insertBefore(el, before && before.parentNode === host ? before : null);
  let mode = null; // null | "keys" | "line"

  const clear = () => { el.replaceChildren(); };

  return {
    element: el,
    /** Show the keys: `rows` [{ keys, label }] in order, drawn with this platform's caps. */
    showKeys(rows, { isMac } = {}) {
      clear();
      const said = doc.createElement("p");
      said.className = "sr-only";
      said.textContent = LEADER_ANNOUNCEMENT;
      const list = doc.createElement("ul");
      list.className = "leader-hint-keys";
      list.setAttribute("aria-hidden", "true");
      for (const row of rows) {
        const item = doc.createElement("li");
        const keys = doc.createElement("span");
        keys.className = "leader-hint-key";
        row.keys.forEach((key, i) => {
          if (i) keys.append(doc.createTextNode(" "));
          const kbd = doc.createElement("kbd");
          kbd.textContent = keyIdCaps(key, isMac).join(isMac ? "" : "+");
          keys.append(kbd);
        });
        const label = doc.createElement("span");
        label.className = "leader-hint-label";
        label.textContent = row.label;
        item.append(keys, label);
        list.append(item);
      }
      el.append(said, list);
      el.dataset.mode = mode = "keys";
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
    isShown: () => mode !== null,
  };
}
