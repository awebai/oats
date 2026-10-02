// Semantic tab chrome and keyboard policy, isolated so ARIA relationships and
// roving-navigation behavior are covered without booting the whole shell.
import { iconElement } from "./shell-icons.mjs";
import { getBinding, formatChord } from "./keybindings.mjs";
import { revealInStrip } from "./reveal-in-scrollport.mjs";
/** Decorative icon by tab kind (the accessible name is the bare title). */
const KIND_ICONS = Object.freeze({ file: "file", brain: "brain" });
/** How many characters a shrunk tab keeps from the end of its name. */
export const TAB_TAIL_CHARS = 8;
/** Where a terminal tab's name splits into a head that ellipsizes and a tail
 * that always shows (spec F return: shrunk tabs stay distinguishable). Names
 * share long prefixes (the soul), so end truncation would leave every shrunk
 * tab reading "oats-…": the tail keeps the last TAB_TAIL_CHARS characters, or
 * the part after the soul's own prefix when that is shorter, without a leading
 * separator. null when there is nothing worth splitting. */
export function tabNameTailStart(name, soul = "") {
  name = String(name ?? ""); soul = typeof soul === "string" ? soul : "";
  let start = Math.max(0, name.length - TAB_TAIL_CHARS);
  if (soul && name.startsWith(`${soul}-`)) start = Math.max(start, soul.length + 1);
  while (start < name.length && /[-_.\s]/.test(name[start])) start++;
  return start > 0 && start < name.length ? start : null;
}

/** decor (all decorative; the accessible name stays the bare title):
 *  { kind } or { icon } an app icon for artifact tabs; { dot, detail } a
 *  live-state dot and the instance branch for terminal tabs (Redesign v3);
 *  { tailAt, tailEnd } splits the title: a head that ellipsizes, the tail
 *  [tailAt, tailEnd) that never shrinks (tabNameTailStart), then any rest of
 *  the title (a remote tab's " · host"), which gives way before the head. */
export function createTabChrome(document, id, title, isMac = false, decor = {}) {
  const tabEl = document.createElement("div");
  tabEl.className = "tab";
  tabEl.setAttribute("role", "presentation");

  const triggerEl = document.createElement("button");
  triggerEl.type = "button";
  triggerEl.className = "tab-trigger";
  triggerEl.id = `tab-${id}`;
  triggerEl.setAttribute("role", "tab");
  triggerEl.setAttribute("aria-selected", "false");
  triggerEl.setAttribute("aria-controls", `tabpanel-${id}`);
  triggerEl.tabIndex = -1;
  const { dot = null, detail = null } = decor || {};
  const icon = decor?.icon ?? KIND_ICONS[decor?.kind] ?? null;
  if (dot) { const mark = document.createElement("span"); mark.className = `tab-dot ${dot === "on" ? "on" : "off"}`; mark.setAttribute("aria-hidden", "true"); triggerEl.append(mark); }
  else if (icon) { const mark = document.createElement("span"); mark.className = "tab-icon"; mark.setAttribute("aria-hidden", "true"); mark.append(iconElement(document, icon, { size: 14 })); triggerEl.append(mark); }
  const label = document.createElement("span"); label.className = "tab-label"; triggerEl.append(label);
  const tailAt = decor?.tailAt;
  const tailEnd = Number.isInteger(decor?.tailEnd) ? Math.min(decor.tailEnd, title.length) : title.length;
  if (Number.isInteger(tailAt) && tailAt > 0 && tailAt < tailEnd) {
    // The head ellipsizes, the tail keeps its width: "oats-…palette". Only the
    // name's own tail is protected; whatever follows it (" · host") is metadata
    // that shrinks first. The trigger's aria-label is the whole title, so the
    // split is never read.
    const span = (className, text) => { const el = document.createElement("span"); el.className = className; el.textContent = text; return el; };
    label.classList.add("split");
    label.append(span("tab-head", title.slice(0, tailAt)), span("tab-tail", title.slice(tailAt, tailEnd)));
    if (tailEnd < title.length) label.append(span("tab-rest", title.slice(tailEnd)));
  } else label.textContent = title;
  if (typeof detail === "string" && detail) {
    const extra = document.createElement("span"); extra.className = "tab-detail"; extra.setAttribute("aria-hidden", "true");
    extra.textContent = detail; triggerEl.append(extra);
  }
  triggerEl.title = title;
  triggerEl.setAttribute("aria-label", title);

  const closeEl = document.createElement("button");
  closeEl.type = "button";
  closeEl.className = "close";
  closeEl.append(iconElement(document, "close", { size: 13 }));
  closeEl.setAttribute("aria-label", `Close ${title}`);
  // The chord half is the keymap's tabs.close on this platform (⌘W / Ctrl+Shift+W), or none when unbound.
  const chord = getBinding("tabs.close", isMac);
  closeEl.title = `Close ${title} (${chord ? `Delete or ${formatChord(chord, isMac)}` : "Delete"})`;
  tabEl.append(triggerEl, closeEl);
  // Arrow/Home/End navigation focuses the trigger; Tab can focus Close. Reveal
  // the focused control in its strip (flat or group: the tab's parent at focus
  // time) without focusing content; only the strip scrolls, never an ancestor.
  // Reveal the control, not the wrapper, which may be wider than a narrow group.
  for (const control of [triggerEl, closeEl]) {
    control.addEventListener("focus", () => revealInStrip(tabEl.parentElement, control));
  }

  const paneEl = document.createElement("div");
  paneEl.className = "tab-pane";
  paneEl.id = `tabpanel-${id}`;
  paneEl.setAttribute("role", "tabpanel");
  paneEl.setAttribute("aria-labelledby", triggerEl.id);
  paneEl.hidden = true;
  return { tabEl, triggerEl, closeEl, paneEl };
}

export function tabKeyAction(event, index, count) {
  const key = event.key;
  // Delete closes the focused tab. The close chord (⌘W / Ctrl+Shift+W) is the keymap's
  // tabs.close, never hard-coded here: a rebind or unbind must hold on the strip too (spec F).
  if (key === "Delete" && !event.metaKey && !event.ctrlKey && !event.altKey) return { type: "close" };
  if (!count || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.defaultPrevented) return null;
  if (key === "ArrowRight") return { type: "move", index: (index + 1) % count };
  if (key === "ArrowLeft") return { type: "move", index: (index - 1 + count) % count };
  if (key === "Home") return { type: "move", index: 0 };
  if (key === "End") return { type: "move", index: count - 1 };
  return null;
}

/** Restore focus after the focused final tab is removed. The shell chooses the
 * logical destination (Instances filter for terminals, active nav for an
 * artifact's restored stage); this function performs the testable DOM move. */
export function focusAfterLastTab(kind, { instancesEntry, stageEntry }) {
  const target = kind === "terminal" ? instancesEntry : stageEntry;
  if (!target || typeof target.focus !== "function") return false;
  target.focus();
  return target.ownerDocument?.activeElement === target;
}
