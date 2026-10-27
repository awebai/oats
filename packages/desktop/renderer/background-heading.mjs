/* oats desktop — the sidebar roster's Background heading (#1579).

   The rows the Background section holds (instance-tree.mjs backgroundPlacement: a row whose own `background`
   is true, or one under such an ancestor) are drawn after the main tree, under ONE heading at the very end of
   the list. The heading is the machine heading's type (view-deployments.mjs deploymentHeading, `.ctx-deployment`)
   with a disclosure in it: a chevron, the word, and the count of rows in the section. The disclosure is a real
   button (`aria-expanded`) inside the heading (the accordion pattern), and a stop of the roster's roving tab
   order: the shell's tree keys reach it (Up/Down), open it (Right) and close it (Left), as a collapsible row.

   While any row in the section waits on the operator, open or closed, the heading carries the roll-up's
   needs-input mark (the `attention` icon in the `.ctx-attn` pill, as a collapsed row's "N below") with the
   fixed words "Needs input": no time, and nothing reorders. Attention is text and an icon, never colour alone
   (decision needs-input-preserves-liveness-and-recognition). The button's name says it too ("Background,
   4 instances, needs input"), since its aria-label replaces its content's text. */

import { iconElement } from "./shell-icons.mjs";

/** The heading's accessible name: the word, the count, and the wait. */
export function backgroundHeadingLabel({ count, waiting = false }) {
  return `Background, ${count} ${count === 1 ? "instance" : "instances"}${waiting ? ", needs input" : ""}`;
}

/** The heading (`div.ctx-deployment.ctx-background`, role heading, level 3, like the machine headings) holding
 * its disclosure (`button.ctx-background-toggle`), out of the tab order until the shell's roving tabindex gives
 * it the stop. `count`: the rows in the section; `open`: drawn open; `waiting`: a row in it waits. The shell
 * binds the button's click and keys (shell.mjs renderContextRoster, onRosterRowKey). */
export function backgroundHeading(doc, { count, open = false, waiting = false }) {
  const head = doc.createElement("div");
  head.className = "ctx-deployment ctx-background";
  head.setAttribute("role", "heading"); head.setAttribute("aria-level", "3");
  const toggle = doc.createElement("button");
  toggle.type = "button"; toggle.className = "ctx-background-toggle"; toggle.tabIndex = -1;
  toggle.setAttribute("aria-expanded", String(!!open));
  toggle.setAttribute("aria-label", backgroundHeadingLabel({ count, waiting }));
  // The tree keys read a row's disclosure from these (roster-keys.mjs rosterKeyAction): it always has rows.
  toggle.dataset.rosterBackground = "1";
  toggle.dataset.rosterChildren = "1";
  toggle.dataset.rosterCollapsed = open ? "0" : "1";
  const label = doc.createElement("span"); label.className = "ctx-deployment-label"; label.textContent = "Background";
  const number = doc.createElement("span"); number.className = "ctx-background-count"; number.textContent = String(count);
  toggle.append(iconElement(doc, "chevronRight", { size: 12, className: "shell-icon ctx-background-chevron" }), label, number);
  if (waiting) {
    const mark = doc.createElement("span"); mark.className = "ctx-attn ctx-background-attn";
    mark.append(iconElement(doc, "attention", { size: 10, className: "shell-icon attn-mark" }), "Needs input");
    toggle.append(mark);
  }
  head.append(toggle);
  return head;
}
