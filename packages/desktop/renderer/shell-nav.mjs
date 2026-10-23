/* oats desktop — shell navigation manifest + stage-view loader.
   Extracted from shell.mjs so shell-level tests can exercise the SAME
   name→module wiring the production rail uses. shell.mjs binds these
   one-to-one. */

/** First-class stage destinations on the nav rail. Every entry's `name`
 * must resolve through loadStageView to a mount-exporting view module.
 * There is deliberately NO "instances" stage: the instances context is the
 * shell's permanent sidebar roster (below the rail), not a rail destination
 * (scope correction of PR #29 — the human rejected the extra tab/sidebar). */
export const NAV = [
  // In the nav's order under the list of workspaces, Workspace first (2026-10-23); ⌘1 / Ctrl+1 stays Deployments (bound by id).
  { name: "spawn", label: "Workspace", icon: "workspace", title: "Workspace" },
  // #482 (UI spec): the Active overview became Deployments: the overview trees, split by deployment, one tab each.
  { name: "hierarchy", label: "Deployments", icon: "layers", title: "Deployments" },
];

/** Destinations that are a tab of a NAV page, not a page of their own (2026-10-23): Automations
 * (Schedules | Triggers) is the Workspace page's Automations tab. Its action (`stage.automations`, ⌘3 /
 * Ctrl+3), its palette command and every open of the name land on that page and tab. */
export const NAV_TABS = [
  { name: "automations", label: "Automations", page: "spawn", tab: "automations" },
];

/** The NAV_TABS entry `name` opens, or null for a page of its own (or nothing). */
export function navTab(name) {
  return NAV_TABS.find((entry) => entry.name === name) ?? null;
}

/** Sidebar mode a stage view pairs with (spawn shows the souls context). */
export function stageSidebarMode(name) {
  return name === "spawn" ? "souls" : "overview";
}

/** The exact dynamic import the stage host performs. Kept here so tests can
 * prove every NAV entry loads a real mount-exporting module. */
export function loadStageView(name) {
  return import(new URL(`./views/${name}.mjs`, import.meta.url).href);
}
