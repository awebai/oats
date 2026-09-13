// Session-local UI memory, keyed by the resolved workspace identity. Stores
// layout/selection only: live tabs and terminal attachments remain shell-owned.
import { canActivateTab, fallbackTabForContext } from "./workspace-tabs.mjs";
import { removeSplitTab } from "./split-layout.mjs";

function copySplit(split) {
  return split ? { ...split, groups: split.groups.map(g => ({ ...g, tabs: [...g.tabs] })) } : null;
}

export function createWorkspaceTabMemory() {
  const states = new Map();
  return {
    remember(workspace, { split, activeTab, sidebarMode, tabLayerVisible }) {
      states.set(workspace, { split: copySplit(split), activeTab, sidebarMode, tabLayerVisible });
    },
    recall(workspace, entries) {
      const saved = states.get(workspace);
      if (!saved) return { split: null, activeTab: null, sidebarMode: "overview", tabLayerVisible: false };
      const tabs = new Map(entries);
      let split = copySplit(saved.split);
      // Closed/foreign tabs must not be resurrected by stale layout memory.
      for (const id of saved.split?.groups.flatMap(g => g.tabs) || []) {
        const tab = tabs.get(id);
        if (tab?.kind !== "terminal" || !canActivateTab(tab, workspace)) split = removeSplitTab(split, id).split;
      }
      const activeTab = canActivateTab(tabs.get(saved.activeTab), workspace) ? saved.activeTab
        : saved.tabLayerVisible ? fallbackTabForContext(tabs, saved.sidebarMode, workspace)?.[0] ?? null : null;
      return { ...saved, split, activeTab, tabLayerVisible: saved.tabLayerVisible && activeTab != null };
    },
  };
}
