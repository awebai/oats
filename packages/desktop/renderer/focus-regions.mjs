// oats desktop — keyboard regions (spec F, Part 4): F6 / Shift+F6 move focus between the
// window's regions, in the sidebar's order top to bottom, then the main area (the sidebar layout,
// 2026-10-23): workspaces → instance roster → sidebar footer → main → instance panel → back.
//
// A region that is hidden (the sidebar while hidden or in focus mode, the panel while closed or when
// there is nothing to show) is skipped. Focus lands on the region's current item, never on <body>:
//   workspaces  the list of workspaces' tab stop (the row last focused, else the current one), else
//               the heading's Add local workspace…
//   roster  the roster's tab stop (the selected row), else the filter
//   footer  the current view's nav item (aria-current), else the first one, else the first tool
//   main    the active tab's content (a terminal's input) through the shell's hook, else the
//           stage's first control
//   panel   its selected tab (or the first control of a stage's content). A closed panel is out
//           of the cycle (Spec B): from a terminal, panel.toggle's chord opens it.
// The tab strip, the split controls and Show sidebar / Show instance panel count as main; the footer's
// tools (after the nav items: Tab) as footer.

import { revealInScrollport } from "./reveal-in-scrollport.mjs";

export const REGIONS = Object.freeze(["workspaces", "roster", "footer", "main", "panel"]);

const TABBABLE = 'button, [href], input, select, textarea, summary, [tabindex]';

/** Rendered and not hidden by an attribute, `display` or `visibility` on it or an ancestor. */
export function isShown(el) {
  if (!el?.isConnected) return false;
  const view = el.ownerDocument.defaultView;
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    if (node.hidden || node.inert) return false;
    const style = view?.getComputedStyle(node);
    if (style?.display === "none" || style?.visibility === "hidden") return false;
  }
  return true;
}

function focusable(el) {
  return !!el && !el.disabled && el.tabIndex >= 0 && el.getAttribute("aria-hidden") !== "true" && isShown(el);
}

/** The first control Tab would reach inside `root`. */
export function firstTabbable(root) {
  return [...(root?.querySelectorAll(TABBABLE) || [])].find(focusable) || null;
}

/**
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {() => boolean} [deps.focusMainContent]  the shell's hook: focus the active tab's
 *        content (or the focused empty split group) and answer whether focus landed; called
 *        only while the tab layer covers the stage
 * @param {() => boolean} [deps.tabLayerVisible]
 */
export function createFocusRegions({ doc, focusMainContent = () => false, tabLayerVisible = () => false }) {
  const app = () => doc.getElementById("app");
  const byId = id => doc.getElementById(id);
  const sidebarShown = () => !app()?.classList.contains("sidebar-hidden") && !app()?.classList.contains("focus-mode") && isShown(byId("sidebar"));
  // The workspaces region: the list and its heading (the heading holds Add local workspace…).
  const inWorkspaces = el => !!el && (!!byId("ws-list")?.contains(el) || !!byId("ws-add-open")?.parentElement?.contains(el));

  function visible(name) {
    if (name === "workspaces") return sidebarShown() && isShown(byId("ws-list"));
    if (name === "footer") return sidebarShown() && isShown(byId("nav-foot"));
    if (name === "roster") return sidebarShown() && isShown(byId("instance-roster"));
    if (name === "main") return isShown(byId("main"));
    if (name === "panel") return isShown(byId("context-panel"));
    return false;
  }

  function currentItem(name) {
    if (name === "workspaces") {
      const stop = [...(byId("ws-options")?.querySelectorAll('[tabindex="0"]') || [])].find(focusable);
      const add = byId("ws-add-open");
      return stop || (focusable(add) ? add : firstTabbable(byId("ws-list")));
    }
    if (name === "footer") {
      const items = [...(byId("nav")?.querySelectorAll("button") || [])].filter(focusable);
      return items.find(b => b.getAttribute("aria-current") === "page") || items[0] || firstTabbable(byId("nav-foot"));
    }
    if (name === "roster") {
      const roster = byId("instance-roster");
      const stop = [...(roster?.querySelectorAll('.ctx-list [tabindex="0"]') || [])].find(focusable);
      const filter = roster?.querySelector(".ctx-filter");
      return stop || (focusable(filter) ? filter : firstTabbable(roster));
    }
    if (name === "panel") {
      const panel = byId("context-panel");
      const tab = [...(panel?.querySelectorAll('[role="tab"][aria-selected="true"]') || [])].find(focusable);
      return tab || firstTabbable(panel);
    }
    if (name === "main") {
      if (tabLayerVisible()) return null; // the shell's hook owns tab content
      return firstTabbable(byId("stagehost"));
    }
    return null;
  }

  const landed = () => !!doc.activeElement && doc.activeElement !== doc.body;

  /** Focus a region's current item. True when focus landed on a control (never <body>). */
  function focusRegion(name) {
    if (!visible(name)) return false;
    if (name === "main" && tabLayerVisible()) {
      if (focusMainContent() && landed() && byId("main").contains(doc.activeElement)) return true;
      // No content to focus (an artifact without controls): its tab in the strip.
      const tab = [...(byId("tabbar")?.querySelectorAll('[role="tab"][aria-selected="true"]') || [])].find(focusable);
      if (!tab) return false;
      tab.focus(); return doc.activeElement === tab;
    }
    const item = currentItem(name);
    if (!item) return false;
    // A roster row is revealed inside its list only (the list shows no scrollbar); elsewhere the
    // focus scroll brings the item into view.
    const list = name === "roster" ? item.closest(".ctx-list") : null;
    item.focus({ preventScroll: !!list });
    if (list) revealInScrollport(list, item.closest(".ctx-tree-row") || item);
    return doc.activeElement === item;
  }

  /** The region holding focus now, or null (body, a dialog…). */
  function regionOfFocus() {
    const active = doc.activeElement;
    if (!active || active === doc.body) return null;
    if (inWorkspaces(active)) return "workspaces";
    if (byId("instance-roster")?.contains(active)) return "roster";
    if (byId("nav-foot")?.contains(active)) return "footer";
    if (byId("sidebar")?.contains(active)) return "workspaces"; // anything else the sidebar holds sits above the roster
    if (byId("main")?.contains(active)) return "main";
    if (byId("context-panel")?.contains(active)) return "panel";
    return null;
  }

  /** Move to the next (delta 1) or previous (-1) visible region that can take focus. */
  function cycle(delta) {
    const order = REGIONS.filter(visible);
    if (!order.length) return false;
    const at = order.indexOf(regionOfFocus());
    for (let i = 1; i <= order.length; i++) {
      const index = at < 0 ? (delta > 0 ? i - 1 : order.length - i) : (at + delta * i + order.length * i) % order.length;
      if (focusRegion(order[index])) return true;
    }
    return false;
  }

  return { visible, currentItem, focusRegion, regionOfFocus, cycle };
}
