// OATS desktop — renderer shell: nav rail + tabbed view host.
//
// View contract (binding, from the desktop-app contract): each view is an ES
// module in ./views/ exporting mount(el, ctx) / unmount(), where
//   ctx = { api(pathname, opts), openFile(path), openTerminal(instance) }
// The shell owns tabs/navigation and provides ctx. The full functionality
// (hierarchy, spawn, brain, markdown) lives in the ported views — the shell
// chrome stays a thin rail so nothing is duplicated.
// (groupInstances is not imported here: the feature branch renders the
// sidebar roster via clusterInstances — lineage clusters with identity keys.)
import { currentWorkspace, workspaceGeneration, adoptWorkspace, staleWorkspaceSelection, onWorkspaceChange, instanceApiPath, postJson, rowDeployment, httpError,
  switchWorkspace, startWindow, windowState, onWindowState, choosingWorkspaces, chooseWorkspace } from "./views/common.mjs";
import { instanceActions, captureInstanceActionMenu } from "./instance-actions.mjs";
import { instanceActionTarget, sameInstanceActionTarget } from "./instance-action-target.mjs";
import { createInstancePrAction } from "./instance-pr-action.mjs";
import { instanceSplitPlan, instanceSplitIdentity } from "./instance-split.mjs";
import { createInstanceStarter } from "./start-instance.mjs";
import { retirementSummary, runtimeState, unsupportedSession } from "./instance-presentation.mjs";
import { deploymentUnavailableText, NOT_SERVED_CODE, NO_ANSWER_CODE, unservedError, createPendingWatch } from "./deployment-header.mjs";
import { panelErrorCause } from "./deployment-contract.mjs";
import {
  initTheme, toggleTheme, setTheme, THEMES, xtermTheme, onThemeChange,
  terminalTypography, setTerminalFontSize, setTerminalFontFamily, resetTerminalTypography, onTerminalTypographyChange,
} from "./theme.mjs";
import { createPalette } from "./palette.mjs";
import { createQuickOpen } from "./quick-open.mjs";
import { takePickerFocusReturn } from "./overlay-picker.mjs";
import { createSurfaceReturn } from "./surface-return.mjs";
import { createFocusRegions, firstTabbable, isShown } from "./focus-regions.mjs";
import { createFileOpener } from "./open-file.mjs";
import {
  registerAction, setActiveContexts, getBinding, onKeymapChange, formatChord, handleKeydown, matchEvent, runAction, keymapConflicts, pickerCycleDirection,
} from "./keybindings.mjs";
import { createKeybindingsEditor } from "./keybindings-editor.mjs";
import { createConnections, connectionsCSS } from "./connections.mjs";
import { createTerminalSettings, settingsTerminalCSS } from "./settings-terminal.mjs";
import { createLifecycleDialog, lifecycleCSS } from './lifecycle-dialog.mjs';
import { rosterKeyAction, moveTarget } from "./roster-keys.mjs";
import { createViewLifecycle } from "./view-lifecycle.mjs";
import { reserveKey, whenKeyFree } from "./tab-keys.mjs";
import { createTerminalTab, terminalOptions, fitTerminal, createGlyphRenderer } from "./terminal-tab.mjs";
import { createTabChrome, tabKeyAction, focusAfterLastTab, tabNameTailStart } from "./tab-a11y.mjs";
import { revealInStrip } from "./reveal-in-scrollport.mjs";
import { createIntentGate, prepareOwnedOpen, runOpenFlow } from "./open-intent.mjs";
import { createSelectionOwnership, wirePaneSelection } from "./selection-ownership.mjs";
import { createWorkspaceSwitcher } from "./workspace-switcher.mjs";
import { NAV, stageSidebarMode, loadStageView } from "./shell-nav.mjs";
import { shellIcon, mountShellIcons, iconElement } from "./shell-icons.mjs";
import { createRuntimeBadge, identityCSS } from "./identity-marks.mjs";
import { createContextPanel, contextPanelCSS } from "./context-panel.mjs";
import { createInstanceTeamsSection, teamsCSS } from "./instance-teams.mjs";
import { createInstanceSoulSection, instanceSoulCSS } from "./instance-soul.mjs";
import { createInstanceGitPanel, instanceGitCSS } from "./instance-git.mjs";
import { canAddressRemote, rowReason } from "./remote-address.mjs";
import { createNotificationCenter, notificationCSS } from "./notifications.mjs";
import { createSpawnJobs } from "./spawn-jobs.mjs";
import { createSpawnFollow, watchOperator } from "./spawn-follow.mjs";
import { registerSpawnDialogKeys } from "./spawn-dialog-keys.mjs";
import { revealInScrollport } from "./reveal-in-scrollport.mjs";
import { createRosterTip, rosterTipFacts, rosterTipCSS } from "./roster-tip.mjs";
import { createRosterPrs, prChip, prText, rosterPrCSS } from "./roster-pr.mjs";
import { createPanelOwner } from "./panel-owner.mjs";
import {
  collapseKey, hasInstanceChildren, instanceRepoLabel, treeConnectors, filterInstanceTree, instanceMatchesFilter, instanceVisibleInTree,
  captureTreeRenderState, rosterResponseOwns, clusterSeparator, renderRosterCount,
  instanceId, rosterParentId, terminalKey, resolveTerminalOpen,
  createRosterLoading, rosterSignature, markStaleControl, staleBlocked, ROSTER_STALE_TITLE,
} from "./instance-tree.mjs";
import {
  tabVisibleInContext, canActivateTab,
  fallbackTabForContext, restoreTerminalTab,
} from "./workspace-tabs.mjs";
import { createWorkspaceTabMemory } from "./workspace-tab-memory.mjs";
import { notePanel, panelDeployments, rosterSections, deploymentHeading, rowStale } from "./view-deployments.mjs";
import { onDeploymentTabRequest } from "./deployment-tabs.mjs";
import { ROSTER_POLL_FOCUSED_MS, rosterPollDue } from "./roster-cadence.mjs";
import { scopedRequest } from "./workspace-routes.mjs";
import { createViewMembership, rehomeMap, rehomeTabs, rehomeActiveTerminals, rehomeCollapsed } from "./workspace-rehome.mjs";
import {
  requestSplit, focusTab, openTabInFocusedGroup, removeSplitTab, isSplitMember, groupOfTab, fillEmptyGroup, resizeSplitGroups,
} from "./split-layout.mjs";
import { splitControlsState } from "./split-controls.mjs";
import { projectSplitDom } from "./split-dom.mjs";

const desk = window.oatsDesktop;
// One window per workspace (#481): settle this window's workspace (its hash, or the shared default
// when no other window has it) before anything reads one. A window left choosing reads nothing.
const windowStart = await startWindow();
initTheme();
mountShellIcons(document);
const identityStyle = document.createElement("style");
identityStyle.textContent = identityCSS + contextPanelCSS + teamsCSS + instanceSoulCSS + instanceGitCSS + notificationCSS + connectionsCSS + settingsTerminalCSS + lifecycleCSS + rosterTipCSS + rosterPrCSS; document.head.append(identityStyle);
const rosterTip = createRosterTip(document);
// The PR of each local instance's branch (forge-roster), re-read at most once a minute.
const rosterPrs = createRosterPrs({
  request: (ws) => api(`/api/forge-roster?ws=${encodeURIComponent(ws)}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
  onChange: () => renderContextRoster(contextInstances),
});
let connectionGeneration = 0;
const connectionListeners = new Set();
const subscribeConnections = fn => { connectionListeners.add(fn); return () => connectionListeners.delete(fn); };
const offForgeChanges = desk.onForgeChanged?.(() => {
  connectionGeneration++;
  for (const fn of [...connectionListeners]) fn();
});
window.addEventListener('pagehide', () => offForgeChanges?.(), { once: true });
const notifications = createNotificationCenter({ document, generation: workspaceGeneration, subscribe: onWorkspaceChange,
  workspace: currentWorkspace, connectionGeneration: () => connectionGeneration, subscribeConnections,
  onIntent: () => { if (!tabOpenIntents.isApplyingFocus()) tabOpenIntents.invalidate(); },
  applyFocus: callback => tabOpenIntents.applyFocus(callback),
  fallbackFocus: () => stableFocusTarget(),
});
window.addEventListener('pagehide', () => notifications.dispose(), { once: true });

// ── ctx (shared by all views) ─────────────────────────────────────────────
async function api(pathname, opts) {
  // A window with no workspace sends no workspace-scoped request (#481): Quick Open, a view refreshing
  // on its way out, anything. Main refuses them too; this keeps them from being sent at all.
  if (windowState() === "choosing" && scopedRequest(pathname)) throw Object.assign(new Error("This window has no workspace yet."), { code: "E_NO_WORKSPACE" });
  const r = await desk.api(pathname, opts);
  if (!r.ok) throw httpError(r, pathname);
  return r.body;
}

const ctx = {
  api,
  // Re-add a deployment the server stopped serving, through the normal (main-validated) add (#461).
  reAddWorkspace: typeof window.oatsDesktop?.workspaceAdd === "function" ? (path) => window.oatsDesktop.workspaceAdd(path) : null,
  // Existing broker invalidation covers backend replacement as well as forge
  // account changes. Read views may revoke observations; no new IPC authority.
  connectionGeneration: () => connectionGeneration,
  subscribeConnections,
  hasWorkspaceSwitcher: true,
  // Workspace selections compete with pending shell chooser/tab opens too.
  onSelectionIntent: () => tabOpenIntents.invalidate(),
  notify: notifications.notify,
  notifySpawn: (instance, workspace, epoch) => {
    const target = instanceActionTarget(workspace, instance, { requireBirth: true });
    if (!target || workspace !== currentWorkspace() || epoch !== connectionGeneration) return;
    notifications.notify(`${target.instance} spawned`, {
      descriptor: { kind: 'open-instance', target, connectionEpoch: epoch },
      activate: (descriptor, owns) => openTerminalTab(descriptor.target, { expected: descriptor.target, valid: owns,
        onError: message => { throw new Error(message); } }),
    });
  },
  openFile: (path) => openViewTab("markdown", String(path).split("/").pop(), { path }, `file:${path}`),
  openTerminal: (instance, opts) => openTerminalTab(instance, opts),
  showInRoster: (instance) => showInRoster(instance),
  startInstance: (instance) => openInstanceStart(instance),
  restartInstance: (instance) => openInstanceStart(instance, { restart: true }),
  openBrain: (agent) => openBrainTab(agent),
  // CLI degradation affordances (cli-status.mjs feature-detects both):
  // native binary picker (privileged; main persists the choice) and external
  // link opening (window.open is denied by the shell's window-open handler
  // except for http(s), which routes to the OS browser).
  chooseCliBinary: () => desk.cliPickBinary(),
  openExternal: (url) => window.open(url, "_blank", "noreferrer"),
  // additive shell affordance (views feature-detect it): switch the STAGE
  // to a named sidebar view (stage views are not tabs — see below).
  openView: (name) => showStage(name),
};
const openInstanceStart = createInstanceStarter(document, ctx);

// Background spawns (Spec C): a confirmed press in the spawn dialog is handed here and the dialog
// closes; the store runs the transaction, owns the roster's pending rows and the outcome
// notifications, and keeps the draft for Reopen spawn. Repaints are coalesced into one per task.
let spawnRepaint = false;
const spawnJobs = createSpawnJobs({
  post: (ws, body) => postJson(ctx, `/api/spawn?ws=${encodeURIComponent(ws)}`, body),
  notify: notifications.notify,
  notifySpawned: (row, ws, epoch, arrival) => spawnFollow.arrived(row, ws, epoch, arrival),
  reopen: async (job) => {
    const owns = tabOpenIntents.begin();
    let mod;
    try { mod = await import("./views/spawn.mjs"); }
    catch (e) { if (owns()) ctx.notify(`Could not reopen spawn: ${e.message || e}`); return; }
    if (!owns() || currentWorkspace() !== job.workspace) return;
    mod.preselectSpawn({ name: job.soul?.name, agentsRoot: job.soul?.agentsRoot, server: job.soul?.server, draft: job.draft });
    showStage("spawn");
  },
  viewSchedules: async () => {
    const mod = await import("./views/automations.mjs");
    mod.preselectAutomationsTab("schedule");
    await showStage("automations");
  },
  currentWorkspace,
  connection: () => connectionGeneration,
  // Spec D (#383): submitted jobs whose outcome is unknown survive a window reload (no task text, no key).
  storage: (() => { try { return window.sessionStorage; } catch { return null; } })(),
  onChange: () => {
    if (spawnRepaint) return;
    spawnRepaint = true;
    queueMicrotask(() => { spawnRepaint = false; spawnFollow.prune(id => !!spawnJobs.get(id)); if (contextRosterEl && rosterState?.hasData) renderContextRoster(contextInstances); followSpawns(); });
  },
});
// Spec E: a pressed spawn takes the operator to its instance once it runs, unless they acted since the
// press (input, a focus move, a navigation) or an overlay is open; then its row says New until it or its
// tab is first opened. No toast for a success; one polite announcement either way (spawn-follow.mjs).
const spawnFollow = createSpawnFollow({
  watch: () => tabOpenIntents.watch(),
  operator: watchOperator(document),
  overlayOpen: () => modalOpen() || (() => { try { return !!document.querySelector("[popover]:popover-open"); } catch { return false; } })(),
  activeElement: () => document.activeElement,
  currentWorkspace, connection: () => connectionGeneration,
  // Every step of the open, and its terminal's readiness focus, is gated by `valid`. True when the operator
  // was taken there: its terminal is the selected tab, or this open made its tab (addTab selects it at once,
  // before the terminal attaches) and they have moved on since. A refused or superseded open made nothing
  // and selected nothing: the row says New instead.
  open: async (row, workspace, valid) => {
    const target = instanceActionTarget(workspace, row, { requireBirth: true });
    if (!target) return false;
    const key = terminalKey(workspace, target);
    const tabOf = () => { for (const [id, t] of tabs) if (t.kind === "terminal" && t.key === key) return id; return null; };
    const before = tabOf();
    await openTerminalTab(target, { quiet: true, expected: target, valid });
    const after = tabOf();
    return after !== null && (after === activeTab || after !== before);
  },
  markNew: (row, workspace) => spawnJobs.markNew(workspace, row), // its change repaints the roster
  announce: text => { if (contextRosterEl) announceSpawn(text); },
});
// A created instance is awaited at the dialog's former pace (700 ms), not the roster's 4 s poll.
let spawnFollowTimer = 0;
function followSpawns() {
  if (spawnFollowTimer || !spawnJobs.settling(currentWorkspace())) return;
  spawnFollowTimer = setTimeout(async () => {
    try { await refreshContextRoster(); } finally { spawnFollowTimer = 0; followSpawns(); }
  }, 700);
}
ctx.spawnJobs = spawnJobs;
ctx.showPendingSpawn = (id) => showPendingSpawn(id);
// Spec E: the press closed the dialog; reveal its pending row (no focus taken) and follow it to its instance.
ctx.followSpawn = (id) => { spawnFollow.follow(id); revealPendingSpawn(id); };
// The spawn dialog's own keys (Mod+Enter, Mod+1–7): listed and rebindable in the editor from the start;
// only the open dialog dispatches them (spawn-dialog-keys.mjs).
registerSpawnDialogKeys();
spawnJobs.recover();
window.addEventListener('pagehide', () => spawnJobs.dispose(), { once: true });

// ── stage: the sidebar-driven main surface ──────────────────────────
// Sidebar items switch the stage view in place; they never create tabs.
// The tab strip is reserved for OPENED ARTIFACTS (terminals, files): things
// you accumulate and close, not places you navigate. Selecting a nav item
// hides the tab layer; activating a tab covers the stage.
const stageHost = document.getElementById("stagehost");
let stage = null;           // { name, life, el }
let stageOp = 0;            // switch generation — a slow mount must not paint over a newer switch

/** Unmount the stage on screen. Resolves to this switch's generation, or null when a newer switch
 * superseded it meanwhile. */
async function closeStage() {
  const myOp = ++stageOp;
  const prev = stage;
  stage = null;
  syncContextPanel(); // hide the old owner before awaiting its unmount
  if (prev) {
    try { await prev.life.close(); } catch (e) { console.error(e); }
    prev.panelOwner?.dispose(); prev.el.remove();
  }
  return myOp === stageOp ? myOp : null;
}

async function showStage(name) {
  // A window with no workspace shows only its choice (#481): no view may read with no workspace.
  if (windowState() === "choosing") { void showChooser(); return; }
  tabOpenIntents.invalidate(); // navigating away supersedes pending tab selections
  const v = NAV.find((x) => x.name === name);
  setSidebarMode(stageSidebarMode(name));
  setNavActive(name);
  showTabLayer(false);
  if (stage && stage.name === name) return;   // already on this surface
  const myOp = await closeStage();
  if (myOp === null) return;                  // superseded by a faster switch
  let mod;
  try { mod = await loadStageView(name); }
  catch (e) {
    if (myOp !== stageOp) return;
    const notice = document.createElement("div"); notice.className = "placeholder";
    notice.textContent = `${name}: view module failed to load: ${e.message}`;
    stageHost.replaceChildren(notice);
    return;
  }
  if (myOp !== stageOp) return;
  const life = createViewLifecycle(mod, (e) => console.error(e));
  const el = document.createElement("div");
  el.style.height = "100%";
  stageHost.innerHTML = "";
  stageHost.append(el);
  const mounted = stage = { name, life, el };
  mounted.panelOwner = createPanelOwner(contextPanel, mounted, workspaceGeneration);
  syncContextPanel();
  // Re-derive contexts from the CURRENT layer state: the user may have
  // activated a tab while this stage was loading — a late mount completion
  // must not replace the live "tabs" context with a hidden stage context.
  updateActiveContexts();
  try { await life.mounted(el, { ...ctx, rightPanel: mounted.panelOwner }); }
  catch (e) {
    if (myOp !== stageOp || stage !== mounted) return;
    mounted.panelOwner.dispose();
    const notice = document.createElement("div"); notice.className = "placeholder";
    notice.textContent = `${v?.title || name}: mount failed: ${e.message}`;
    el.replaceChildren(notice);
  }
}

/** One window per workspace (#481): a window with no workspace (a New Window, or one whose view moved
 * to a workspace another window has) shows the switcher over an empty state, and reads nothing. Its
 * tabs stay, hidden, until it has a workspace again. */
async function showChooser() {
  tabOpenIntents.invalidate();
  showTabLayer(false);
  if (contextRosterEl) contextRosterEl.hidden = true;
  if (await closeStage() === null || windowState() !== "choosing") return;
  const el = document.createElement("div");
  el.className = "placeholder window-chooser";
  const heading = document.createElement("h2");
  heading.textContent = "Choose a workspace";
  const text = document.createElement("p");
  text.textContent = "This window has no workspace yet.";
  const choose = document.createElement("button");
  choose.type = "button"; choose.className = "primary"; choose.textContent = "Choose a workspace…";
  choose.addEventListener("click", () => workspaceLabel.openMenu());
  el.append(heading, text, choose);
  stageHost.replaceChildren(el);
  workspaceLabel.choose(choosingWorkspaces());
  workspaceLabel.openMenu();
}
onWindowState((state) => {
  if (state === "choosing") { void showChooser(); return; }
  // Bound again (a choice, or an adoption): leaving the choice shows the home surface.
  if (!contextRosterEl?.hidden) return;
  contextRosterEl.hidden = false;
  void showStage("hierarchy");
});

/** A stage switch from the keyboard (a chord, the palette, a nav button) keeps focus on a
 * control: where it was when that is still shown (the nav button), else the stage's first
 * control — never <body> after the terminal it was in is hidden (spec F audit). */
async function showStageFocused(name) {
  const op = stageOp;
  await showStage(name);
  if (stage?.name !== name || tabLayerVisible || (stageOp !== op && stageOp !== op + 1)) return;
  const active = document.activeElement;
  if (!active || active === document.body || !isShown(active)) focusRegions.focusRegion("main");
}

// A request to open one deployment's tab of the Deployments page (the switcher's "Not matched" entries,
// deployment-tabs.mjs) shows that stage; the page itself reads the requested tab.
onDeploymentTabRequest(() => { void showStageFocused("hierarchy"); });

function setNavActive(name) {
  for (const b of navEl.querySelectorAll(".nav-item")) {
    const active = b.dataset.view === name;
    b.classList.toggle("active", active);
    if (active) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
}

function showTabLayer(on) {
  document.getElementById("tabhost").style.display = on ? "" : "none";
  document.getElementById("tabstrip").style.display = on ? "" : "none";
  updateActiveContexts(on);
  if (!on) {
    stageHost.style.display = "";
    activeTab = null;
    updateSplitControls();
    for (const t of tabs.values()) {
      t.tabEl.classList.remove("active");
      t.triggerEl.setAttribute("aria-selected", "false");
      t.triggerEl.tabIndex = -1;
      t.paneEl.classList.remove("active");
      t.paneEl.hidden = true;
    }
  } else {
    stageHost.style.display = "none";
    updateContextTabs();
  }
  syncContextPanel();
}

function updateContextTabs() {
  for (const t of tabs.values()) {
    const visible = tabVisibleInContext(t, sidebarMode, currentWorkspace());
    t.tabEl.hidden = !visible;
  }
}

// ── one contextual sidebar: nav + recursive instance roster ─────────────
let sidebarMode = "overview";
let contextRosterGen = 0;
let contextRosterEl = null;
let contextFilter = "";
let contextInstances = [];
let contextWorkspace = "";
// The roster's loading state (desktop/loading-states): the controller owns the
// pending skeleton, "Refreshing…", the stale line and Retry; shell owns the
// latest-intent tokens (contextRosterGen / owns()) and calls it only for a
// read it still owns. rosterStale: the last owned read failed with data on
// screen, so Start… and the row actions menu are disabled until one succeeds.
// rosterSignaturePainted: what the list last painted; an identical poll skips the rebuild.
let rosterState = null;
let rosterStale = false;
let rosterSignaturePainted = null;
// The deployment note ("Reading the deployment…", a kernel refusal): its own truthful state above the rows.
let contextDeploymentNote = null;
// The shown view's deployments (#482, panel.deployments): two or more group the roster by deployment.
let contextDeployments = [];
// Which deployments each served view held, so state under a view id that stops being served can follow
// its deployments to the view that holds them now (workspace-rehome.mjs).
const viewMembership = createViewMembership();
let activeInstanceMenu = null;
const splitOpenState = () => ({ split, activeId: activeTab, tabs, workspace: currentWorkspace(), visible: tabLayerVisible });
const ownsInstanceTarget = target => target?.workspace === currentWorkspace() && contextWorkspace === currentWorkspace()
  && contextInstances.filter(row => sameInstanceActionTarget(target, row, currentWorkspace())).length === 1;
function menuState(value, element) {
  if (value) activeInstanceMenu = value;
  else if (activeInstanceMenu?.element === element) activeInstanceMenu = null;
  updateActiveContexts();
}
const collapsedInstances = new Set();
// Collapsed agent groups (sidebar group headers), keyed like instances.
const desktopBridge = window.oatsDesktop;
const unavailableWorkspaceService = () => Promise.reject(new Error("Workspace discovery is not available in this desktop service yet."));
const workspaceLabel = createWorkspaceSwitcher({
  document,
  // Main binds a switch first; a workspace another window has is focused there instead (#481).
  selectWorkspace: (id) => { void switchWorkspace(id); },
  openInNewWindow: typeof desktopBridge.windowOpenWorkspace === "function" ? (id) => { void desktopBridge.windowOpenWorkspace(id); } : null,
  mac: navigator.platform.includes("Mac"),
  // Feature-detected while tui-dev lands the approved privileged contract.
  // The final adapter names are intentionally isolated to these three lines.
  discoverSuggestions: desktopBridge.workspaceSuggestions || unavailableWorkspaceService,
  addWorkspace: desktopBridge.workspaceAdd || unavailableWorkspaceService,
  pickWorkspace: desktopBridge.workspacePick || unavailableWorkspaceService,
  onboardWorkspace: desktopBridge.workspaceOnboard || null,
  // After the kernel onboarded and the add selected the new deployment: land
  // on its Workspace view.
  onboarded: () => {
    notifications.notify("Workspace onboarded. The lock is written.");
    void showStage("spawn");
  },
});

// ── keybinding contexts ──────────────────────────────────────────────────────────
// The engine dispatches an action only when its context is active. "tabs"
// is live while the tab layer covers the stage; "stage:<name>" while that
// stage is the visible surface. Views register their own view-local actions
// (context stage:<name>) in mount and dispose them in unmount.
let tabLayerVisible = false;
function updateActiveContexts(tabLayerOn = tabLayerVisible) {
  tabLayerVisible = tabLayerOn;
  const set = new Set();
  if (tabLayerOn) set.add("tabs");
  else if (stage) set.add(`stage:${stage.name}`);
  if (activeInstanceMenu?.element.isConnected && activeInstanceMenu.element.dataset.instanceMenuOpen === 'true' && activeInstanceMenu.element.contains(document.activeElement) && activeInstanceMenu.owns()) set.add('instance-menu');
  setActiveContexts(set);
}

function initContextRoster() {
  contextRosterEl = document.getElementById("instance-roster");
  const input = contextRosterEl.querySelector(".ctx-filter");
  rosterState = createRosterLoading(document, contextRosterEl, { onRetry: () => { void refreshContextRoster({ user: true }); } });
  renderRosterCount(contextRosterEl.querySelector(".ctx-count"), [], { pending: true });
  // Native pointer/keyboard entry is a newer UI intent, even if no command
  // ran (or the filter already had focus). Retained attachments stay alive.
  const sidebar = document.getElementById("sidebar");
  sidebar.addEventListener("pointerdown", () => tabOpenIntents.invalidate());
  sidebar.addEventListener("focusin", () => {
    if (!tabOpenIntents.isApplyingFocus()) tabOpenIntents.invalidate();
  });
  // ArrowDown from the filter enters the rows (spec F): while filtering, at the first row that
  // matches (never an ancestor shown only for context); otherwise at the rows' tab stop.
  input.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
    const row = (contextFilter && contextRosterEl.querySelector('.ctx-list .ctx-inst:not([data-filter-context])'))
      || contextRosterEl.querySelector('.ctx-list .ctx-inst[tabindex="0"]');
    if (!row) return;
    e.preventDefault(); tabOpenIntents.invalidate(); setRovingRow(contextRosterEl.querySelector(".ctx-list"), row);
  });
  input.addEventListener("input", (e) => {
    contextFilter = e.target.value.toLowerCase();
    renderContextRoster(contextInstances);
  });
  refreshContextRoster();
}

function setSidebarMode(mode) {
  sidebarMode = mode;
  if (typeof tabs !== "undefined") updateContextTabs();
}

// How long the shown deployment, on this connection, has been without an observation: past
// PENDING_LIMIT_MS the roster says it got no answer instead of waiting silently (#461). The deadline is
// its own timer, so it fires even while a read that never answers holds the single-flight poll.
const rosterPendingWatch = createPendingWatch({ onOverdue: (subject) => rosterOverdue(subject) });

/** The bounded wait ran out for the subject still shown: said now, whatever read is in flight. A later
 * observation of it still lands (the read in flight, or the next poll's). */
function rosterOverdue(subject) {
  const ws = currentWorkspace();
  if (!contextRosterEl || subject !== `${connectionGeneration}\n${ws}`) return;
  failRosterUnserved(NO_ANSWER_CODE, ws);
}

/** A deployment the server does not serve, or keeps answering "pending" for (#461): the failed
 * state names it, with Retry, and Re-add workspace when it is not served. No row of another
 * read stays: the server's answer is not about this deployment. */
function failRosterUnserved(code, ws) {
  if (code === NO_ANSWER_CODE && rosterState?.hasData) {
    // The rows on screen are this deployment's last observation: kept, stale, with the reason.
    rosterState.fail(unservedError(code, ws));
    if (!rosterStale) { rosterStale = true; renderContextRoster(contextInstances); }
    return;
  }
  if (rosterState?.hasData) rosterState.reset();
  contextInstances = []; contextDeploymentNote = null; rosterStale = false; rosterSignaturePainted = null;
  refreshPanelInstance([], ws);
  const action = code === NOT_SERVED_CODE && ws?.startsWith("/") && typeof desktopBridge?.workspaceAdd === "function"
    ? { label: "Re-add workspace", onActivate: () => { void reAddRosterWorkspace(ws); } } : null;
  rosterState?.fail(unservedError(code, ws), { action });
  renderContextRoster([]);
}

/** Re-add through the normal add path (main validates it and restarts the server with the whole set).
 * Latest intent: only the newest Re-add, in the same workspace selection, acts on its outcome, and a
 * failure never replaces an observation that landed meanwhile (the add itself restarts the server). */
let rosterReAddLease = 0;
async function reAddRosterWorkspace(ws) {
  const lease = ++rosterReAddLease, generation = workspaceGeneration();
  rosterState?.begin({ user: true });
  let result;
  try { result = await desktopBridge?.workspaceAdd?.(ws); } catch (error) { result = { ok: false, reason: error?.message }; }
  if (lease !== rosterReAddLease || generation !== workspaceGeneration() || currentWorkspace() !== ws) return;
  if (result?.ok) { rosterPendingWatch.reset(); void refreshContextRoster({ user: true }); return; }
  if (rosterState?.hasData) return; // a newer observation of this deployment stands
  const error = new Error(`Couldn't re-add ${ws}: ${result?.reason || "the add failed"}`); error.code = NOT_SERVED_CODE;
  contextInstances = []; rosterStale = false; rosterSignaturePainted = null;
  rosterState?.fail(error, { action: { label: "Re-add workspace", onActivate: () => { void reAddRosterWorkspace(ws); } } });
  renderContextRoster([]);
}

/** A view that moved under this window (#482) is followed through main without focusing anything; one
 * another window has leaves this window choosing, its tabs kept (#481). */
async function followView(id) {
  const result = await switchWorkspace(id, { focus: false });
  if (!result.ok && result.code === "open-elsewhere") await chooseWorkspace(result.workspaces);
}

async function refreshContextRoster({ user = false } = {}) {
  if (!contextRosterEl || windowState() === "choosing") return; // no workspace: nothing to read
  // A Retry restarts the bounded wait for an answer.
  if (user) rosterPendingWatch.reset();
  const myGen = ++contextRosterGen;
  const commitWorkspaceLabel = workspaceLabel.begin();
  const ws = currentWorkspace();
  // A stale dispatch selection (persisted, not among the served choices) is
  // owned like an empty one: the hierarchy may have adopted the served
  // workspace while this request was in flight, and this reply resolves the
  // same selection. A real switch still bumps contextRosterGen and loses.
  const owns = (responseWs = ws, staleDispatch = false) => rosterResponseOwns({
    dispatchWorkspace: ws,
    responseWorkspace: responseWs,
    currentWorkspace: currentWorkspace(),
    dispatchGeneration: myGen,
    currentGeneration: contextRosterGen,
    staleDispatch,
  });
  const listEl = contextRosterEl.querySelector(".ctx-list");
  // The bounded wait (#461) runs from the first read of this deployment, on this connection, that brought
  // no observation: answered "pending", or not answered at all. Any other answer from the server ends it.
  const subject = `${connectionGeneration}\n${ws}`;
  if (rosterPendingWatch.observe(subject, true)) failRosterUnserved(NO_ANSWER_CODE, ws);
  // pending (skeleton after 150ms) without data, refreshing (content stays) with it. A background re-read of
  // a failed roster is not announced again; a Retry, or a changed outcome, is.
  else if (user || rosterState?.state !== "failed") rosterState?.begin({ user });
  let panel;
  try {
    panel = await api(`/api/panel${ws ? `?ws=${encodeURIComponent(ws)}` : ""}`);
  } catch (e) {
    if (owns() && e?.code === NOT_SERVED_CODE) {
      rosterPendingWatch.observe(null, false); // an answer: not served
      failRosterUnserved(NOT_SERVED_CODE, ws);
      // The switcher still offers what the server does serve, with this deployment named as the
      // current choice, so the window is never left without a way to another workspace. A bound
      // window's refusal carries those choices (#481); a window with no workspace yet reads them.
      let served = Array.isArray(e.workspaces) ? { workspaces: e.workspaces } : null;
      if (!served) try { served = await api("/api/panel"); } catch { /* the choices stay as they were */ }
      // A view id no longer served whose deployments another view holds now (a remote that reports
      // another workspace, #482): the window and its state follow them there.
      const moved = served && owns() ? rehomeMap(served.workspaces, viewMembership).get(ws) : null;
      if (moved) { rehomeWorkspaceState(served.workspaces); void followView(moved); return; }
      const current = { id: ws, name: viewMembership.name(ws) || (ws.startsWith("ws:") ? "Workspace" : ws.split("/").filter(Boolean).at(-1) || ws), team: null };
      if (served && owns()) commitWorkspaceLabel(current, Array.isArray(served.workspaces) ? served.workspaces : []);
      return;
    }
    // No answer past the bound (the proxy timed the read out, the bridge is down): said by name.
    if (owns() && rosterPendingWatch.observe(subject, true)) { failRosterUnserved(NO_ANSWER_CODE, ws); return; }
    if (owns()) {
      // With data: stale — the list is kept, its actions disabled, the
      // controller paints "Couldn't refresh instances · observed <age>" + Retry.
      // Without: the controller paints the failed block where the skeleton stood.
      rosterState?.fail(e);
      // The rows are rebuilt once, to disable their actions; a repeat failure keeps them. Without
      // data, the count's pill stops (nothing is loading): the reserved box, empty and still.
      if (rosterState?.hasData && !rosterStale) { rosterStale = true; renderContextRoster(contextInstances); }
      else if (rosterState && !rosterState.hasData) renderRosterCount(contextRosterEl.querySelector(".ctx-count"), [], { failed: true });
      refreshPanelInstance([], ws);
    }
    return;
  }
  const resolvedWs = panel.workspace?.id || ws;
  const stale = staleWorkspaceSelection(ws, panel);
  if (!owns(resolvedWs, stale)) return;
  if ((!currentWorkspace() || stale) && resolvedWs) {
    adoptWorkspace(resolvedWs);
    tabWorkspace = resolvedWs;
  }
  // Views (#482): state under a deployment id (a selection saved before views, an unattached
  // deployment that matched since) moves to the view that holds it now; the "On …" lines learn the
  // view's deployments, and the roster groups by them.
  rehomeWorkspaceState(panel.workspaces);
  notePanel(panel);
  contextDeployments = panelDeployments(panel);
  commitWorkspaceLabel(panel.workspace, panel.workspaces);
  contextWorkspace = resolvedWs;
  // A failed read with no instances keeps the rows already shown for this workspace (stale), so the
  // previous list survives that reply; every other reply replaces it.
  const previousInstances = contextInstances;
  // "Still reading" is not an empty roster, with or without rows on screen; past the bound it is no answer.
  const pendingRead = panel.deployment?.status === "pending" && !panel.workspace?.remote && !(panel.instances || []).length;
  if (!pendingRead) rosterPendingWatch.observe(null, false); // the server answered
  else if (rosterPendingWatch.observe(subject, true)) { failRosterUnserved(NO_ANSWER_CODE, resolvedWs); return; }
  else if (rosterState?.hasData) { rosterState.cancel(); return; } // the rows stay, as they were
  // The read's failure, if any: the kernel's message with its bounded cause (Spec D). A remote the kernel
  // could not read keeps the last observation (panel.error + errorCause); a cache problem with nothing
  // observed yet is a failed read with that message, never an empty roster.
  const unreadable = !panel.workspace?.remote && panel.deployment?.status === "unavailable" && panel.deployment.reason?.code === "E_REMOTE_UNREADABLE"
    ? panelErrorCause({ code: "E_REMOTE_UNREADABLE", ...(panel.deployment.reason.cause || {}) }) : null;
  const failure = typeof panel.error === "string" && panel.error
    ? { message: panel.error, ...(panelErrorCause(panel.errorCause) ? { code: panel.errorCause.code, cause: panelErrorCause(panel.errorCause) } : {}) }
    : unreadable?.reason === "cache" && typeof panel.deployment.reason.message === "string"
      ? { message: panel.deployment.reason.message, code: unreadable.code, cause: unreadable } : null;
  if (!(failure && !(panel.instances || []).length && rosterState?.hasData)) contextInstances = panel.instances || [];
  // A deployment the kernel could not observe is not an empty one: name the
  // missing feature or keep the kernel's refusal (never an optimistic read).
  // It is its own truthful state, painted above the rows by renderContextRoster
  // on every path (module state, so a filter edit or a collapse keeps it).
  contextDeploymentNote = panel.deployment && panel.deployment.status !== "observed" && !panel.workspace?.remote && !failure
    ? deploymentUnavailableText(panel.deployment) : null;
  const signature = rosterSignature(contextInstances, {
    workspace: resolvedWs, error: failure, deploymentNote: contextDeploymentNote, deployments: contextDeployments,
    activeKey: tabs.get(activeTab)?.key ?? null, connection: connectionGeneration,
  });
  // A panel that reports an error is the kernel's failed read, not an observed
  // roster: with instances beside it (a remote server the kernel could not
  // reach, its last roster) the list is kept and goes stale; with none, it is a
  // failed read — the failed block with Retry where the skeleton stood, or the
  // previous rows of this workspace kept and marked stale. Never "No instances.".
  if (failure && !contextInstances.length) {
    refreshPanelInstance([], resolvedWs);
    rosterState?.fail(failure);
    if (rosterState?.hasData && !rosterStale) { rosterStale = true; renderContextRoster(previousInstances); }
    else if (rosterState && !rosterState.hasData) renderRosterCount(contextRosterEl.querySelector(".ctx-count"), [], { failed: true });
    return;
  }
  const reportedFailure = !!failure;
  // Before the server's first observation the panel says deployment "pending"
  // with no instances: that is not an observed empty roster. The note is the
  // whole content (its existing copy, no skeleton), the count keeps its pill,
  // and the controller stays without data until an observation lands.
  if (panel.deployment?.status === "pending" && !panel.workspace?.remote && !contextInstances.length && !rosterState?.hasData) {
    rosterState?.defer();
    refreshPanelInstance(contextInstances, resolvedWs);
    if (signature !== rosterSignaturePainted) { rosterSignaturePainted = signature; renderContextRoster(contextInstances); }
    return;
  }
  const unchanged = !!rosterState?.hasData && signature === rosterSignaturePainted && rosterStale === reportedFailure;
  // The controller learns of the data before the paint (hasData gates the
  // empty copy). A reported failure with data already present skips
  // succeed(): its stale line then updates in place instead of being
  // announced anew on every poll.
  if (rosterState && (!reportedFailure || !rosterState.hasData)) {
    rosterState.succeed({ observedAt: typeof panel.observedAt === "string" ? panel.observedAt : null, empty: !contextInstances.length });
  }
  rosterStale = reportedFailure;
  // Background spawns: a created instance the roster now reports becomes its real row; outcomes held
  // for this workspace are posted. Only an observed roster counts (never a failed read's last rows).
  if (!reportedFailure && !panel.workspace?.remote) spawnJobs.observe(resolvedWs, contextInstances);
  void rosterPrs.refresh(panel.workspace?.remote ? null : resolvedWs);
  refreshPanelInstance(contextInstances, resolvedWs);
  if (!unchanged) {
    rosterSignaturePainted = signature;
    renderContextRoster(contextInstances);
  }
  if (reportedFailure) rosterState?.fail(failure);
}

function renderContextRoster(instances) {
  const listEl = contextRosterEl.querySelector(".ctx-list");
  const restoreTreeState = captureTreeRenderState(listEl);
  const restoreActionMenu = captureInstanceActionMenu(listEl);
  // No read of this subject has succeeded yet (desktop/loading-states): the
  // skeleton or the failed block own the list and the count is a skeleton
  // pill. Rows of the previous subject go; the empty copy is never painted.
  const pending = !!rosterState && !rosterState.hasData, failed = pending && rosterState.state === "failed";
  renderRosterCount(contextRosterEl.querySelector(".ctx-count"), instances, { pending: pending && !failed, failed, stale: rosterStale });
  // The deployment note is painted on every path (poll, filter, collapse, PR change), first in the list.
  const paintNote = () => {
    if (contextDeploymentNote === null) return;
    const note = document.createElement("div"); note.className = "ctx-empty ctx-deployment-note"; note.setAttribute("role", "status");
    note.textContent = contextDeploymentNote;
    listEl.prepend(note);
  };
  if (pending) {
    for (const el of listEl.querySelectorAll(":scope > .ctx-tree-row, :scope > .ctx-group, :scope > .ctx-empty")) el.remove();
    paintNote();
    tabOpenIntents.applyFocus(restoreTreeState);
    return;
  }
  listEl.innerHTML = "";
  const ws = contextWorkspace || currentWorkspace();
  // Background spawns (Spec C): this workspace's pending rows join the layout where the real row will
  // stand (its relation), so the real row replaces them in place. A row the roster already reports is
  // the real one. The count above stays the kernel's observation only.
  const reported = new Set(instances.map(instanceId));
  const spawning = ws && ws === currentWorkspace() ? spawnJobs.rows(ws)
    // Only what the kernel decided (name, home, soul, relation): never a guessed runtime state.
    .map((p) => ({ instance: p.instance, agent: p.agent, agentsRoot: p.agentsRoot, home: p.home,
      ...(p.parentInstance ? { parentInstance: p.parentInstance } : {}), ...(p.siblingInstance ? { siblingInstance: p.siblingInstance } : {}),
      ...(p.deployment ? { deployment: p.deployment } : {}), pendingSpawn: p }))
    .filter((p) => !reported.has(instanceId(p))) : [];
  if (spawning.length) instances = [...instances, ...spawning];
  const matching = filterInstanceTree(instances, contextFilter);
  const rosterGeneration = workspaceGeneration();
  const filtering = !!contextFilter.trim();
  const visible = matching.filter((i) => instanceVisibleInTree(
    i, instances, collapsedInstances, ws, filtering,
  ));
  if (!visible.length) {
    listEl.innerHTML = `<div class="ctx-empty">${instances.length ? "Nothing matches." : "No instances."}</div>`;
    paintNote();
    tabOpenIntents.applyFocus(restoreTreeState);
    return;
  }
  // Sidebar groups by agent CLUSTER (connected relations), not per repo:
  // the repo is the small label under each instance. Clusters read purely
  // from SPACING/STRUCTURE (human re-test: no visible glyph) — multi-member
  // clusters get an invisible separator that still exposes the group
  // boundary to AT (role=separator + aria-label); single-node clusters get
  // nothing. Clusters are computed on the FULL roster then projected to
  // visible members — clustering a filtered subset could forge edges from
  // globally ambiguous names (merged-state review @3e76616).
  // Agent groups (Redesign v3): each multi-member relation cluster under its
  // deterministic name, then every unrelated instance under "independent"
  // (rosterGroups, shared with the command palette).
  // Clusters are computed on the FULL roster then projected to visible
  // members — clustering a filtered subset could forge edges from globally
  // ambiguous names (merged-state review @3e76616).
  // Views (#482): with two or more deployments, each deployment's agent groups sit under its heading
  // (rosterSections); with one, the groups are exactly these clusters and no heading is drawn.
  const groups = rosterSections(instances, visible, contextDeployments)
    .flatMap((section) => section.groups.map((group, at) => ({ ...group, heading: at === 0 && section.deployment ? section : null })));
  for (const group of groups) {
    if (group.heading) {
      const { deployment, label, machine, tail, groups: own } = group.heading;
      listEl.append(deploymentHeading(document, { deployment, label, machine, tail, count: own.reduce((n, g) => n + g.clusters.reduce((m, c) => m + c.instances.length, 0), 0) }));
    }
    listEl.append(clusterSeparator(document, { label: group.label, count: group.clusters.reduce((n, c) => n + c.instances.length, 0) }));
    for (const cluster of group.clusters) {
      const items = cluster.instances;
      for (const i of items) {
        if (i.pendingSpawn) { listEl.append(pendingSpawnRow(i, items, instances)); continue; }
        const rowWrap = document.createElement("div");
        rowWrap.className = "ctx-tree-row";
        rowWrap.style.setProperty("--depth", String(i.depth || 0));
        const activeKey = tabs.get(activeTab)?.key;
        const isActive = activeKey === terminalKey(ws, i);
        // Collapse and focus state key by IDENTITY, not bare name: two
        // same-named instances from different agents roots collapse and
        // focus independently (review 46f3fdc).
        const key = collapseKey(ws, instanceId(i));
        const hasChildren = hasInstanceChildren(instances, i);
        const collapsed = collapsedInstances.has(key);

        // Design connectors drawn from the dots: rounded solid elbows into
        // children, solid stems/pass-throughs, dotted sibling links.
        const guides = document.createElement("span");
        guides.className = "ctx-guides";
        guides.setAttribute("aria-hidden", "true");
        for (const { kind, level } of treeConnectors(items, i, instances)) {
          const guide = document.createElement("span");
          guide.className = `ctx-guide ${kind}`;
          guide.style.setProperty("--guide-level", String(level));
          guides.append(guide);
        }

        const row = document.createElement("button");
        row.type = "button";
        row.dataset.treeInstance = instanceId(i);
        row.dataset.treeControl = "terminal";
        // An ancestor kept only for a filter match's tree path: shown, but not where the keyboard lands.
        if (!instanceMatchesFilter(i, contextFilter)) row.dataset.filterContext = "true";
        const state = runtimeState(i);
        row.className = "ctx-inst" + (state === "stopped" ? " idle" : "") + (isActive ? " active" : "");
        rowWrap.classList.toggle("active", isActive);
        if (hasChildren) row.setAttribute("aria-expanded", String(filtering || !collapsed));
        // A row that can't open (unknown state, a remote row the kernel does not report addressable) stays
        // focusable (aria-disabled, spec F): its row tools — the actions menu's Inspect/Stop/Remove — must
        // stay reachable from the keyboard. Its activation does nothing and says why.
        const unavailable = i.running == null || !canAddressRemote(i);
        if (unavailable) { row.setAttribute("aria-disabled", "true"); row.classList.add("unavailable"); }
        // Why it can't open: a short label on the meta line, the full sentence as its title and description.
        const reason = rowReason(i);
        const why = reason?.sentence || i.runtimeError || (i.running ? `Open ${i.instance} terminal` : `Start ${i.instance}`);
        // Workspace v4: an enabled row explains itself in the hover/focus card; an unavailable one keeps its reason as a title.
        const pr = i.server || i.remote ? null : rosterPrs.get(i.home);
        if (unavailable) { row.title = why; row.setAttribute("aria-description", why); } else rosterTip.bind(row, () => rosterTipFacts(i, why, pr));
        const dot = document.createElement("span");
        dot.className = `ctx-dot ${state === "running" ? "on" : state === "stopped" ? "off" : "unknown"}`;
        const copy = document.createElement("span");
        copy.className = "ctx-copy";
        const name = document.createElement("span");
        name.className = "ctx-name";
        name.textContent = i.instance;
        const meta = document.createElement("span");
        meta.className = "ctx-meta ctx-repo-label";
        meta.textContent = [instanceRepoLabel(i), i.branch, reason?.label].filter(Boolean).join(" · ");
        meta.title = `Repository: ${instanceRepoLabel(i)}${i.branch ? `\nBranch: ${i.branch}` : ""}`;
        if (pr) {
          // Its pull request on the meta line, before the branch: "repo · #317 branch" (the name line
          // holds only the name). The link itself sits in the row tools (a button holds no link).
          const lead = document.createElement("span"); lead.className = "ctx-meta-lead"; lead.textContent = `${instanceRepoLabel(i)} ·`;
          const rest = [i.branch, reason?.label].filter(Boolean).join(" · ");
          meta.textContent = ""; meta.classList.add("ctx-meta-pr"); meta.append(lead, prChip(document, pr));
          if (rest) { const tail = document.createElement("span"); tail.className = "ctx-meta-tail"; tail.textContent = rest; meta.append(tail); }
        }
        // Spec E: a spawn the operator was not taken to says New (text and a dot, never colour alone)
        // until its row is opened, or its tab is (the first paint where it is the active row).
        if (isActive) spawnJobs.seen?.(ws, i);
        if (spawnJobs.isNew?.(ws, i)) {
          const line = document.createElement("span"); line.className = "ctx-name-line";
          const mark = document.createElement("span"); mark.className = "ctx-new";
          const markDot = document.createElement("span"); markDot.className = "ctx-new-dot"; markDot.setAttribute("aria-hidden", "true");
          mark.append(markDot, "New"); line.append(name, mark); copy.append(line, meta);
        } else copy.append(name, meta);
        row.append(dot, copy);
        if (typeof i.harness === "string" && i.harness) {
          const runtime = createRuntimeBadge(document, i.harness);
          runtime.classList.add("ctx-runtime");
          row.append(runtime);
        }
        // pass the FULL reference: same-named instances in other agents
        // roots must open THEIR tmux session, not the first name match
        // A stale roster (the last read failed) may say running:false for an instance that is running by now:
        // the row's activation (click, Enter) then starts nothing and says why; opening a running row's
        // terminal stays allowed (the maintainer's return on #322).
        // A row of a stale deployment (#482: its last re-read failed) is held the same way.
        const heldStale = rosterStale || rowStale(i, contextDeployments);
        const staleStart = heldStale && !i.running;
        if (staleStart) { row.title = ROSTER_STALE_TITLE; row.setAttribute("aria-description", ROSTER_STALE_TITLE); }
        row.addEventListener("click", () => { if (staleStart || unavailable) return; spawnJobs.seen?.(ws, i); i.running ? openTerminalTab(i) : openInstanceStart(i); });
        // full keyboard tree operability (roving tabindex; policy in
        // roster-keys.mjs). Enter is the button's native activation.
        row.dataset.rosterChildren = hasChildren ? "1" : "0";
        row.dataset.rosterCollapsed = collapsed ? "1" : "0";
        row.tabIndex = -1;
        row.addEventListener("keydown", onRosterRowKey);
        rowWrap.append(guides, row);
        // Row tools (Start…, actions) overlay the row end on hover/focus only.
        const tools = document.createElement("span");
        tools.className = "ctx-row-tools";
        if (pr?.url) {
          const open = document.createElement("button"); open.type = "button"; open.className = "act ctx-pr-open"; open.dataset.verb = "pr";
          open.append(iconElement(document, "external", { size: 13 })); open.title = `Open pull request ${prText(pr)} on GitHub`;
          open.setAttribute("aria-label", `Open ${i.instance}'s pull request ${prText(pr)} on GitHub`);
          open.addEventListener("click", () => ctx.openExternal(pr.url));
          tools.append(open);
        }
        if (i.running === false) {
          const start = document.createElement("button"); start.className = "act ctx-start";
          start.textContent = "Start…"; start.setAttribute("aria-label", `Start ${i.instance}`);
          start.disabled = !canAddressRemote(i);
          if (heldStale) markStaleControl(start);
          start.addEventListener("click", () => { if (!staleBlocked(start)) openInstanceStart(i); });
          tools.append(start);
        }
        const actionTarget = instanceActionTarget(ws, i), menuConnection = connectionGeneration;
        const menuOwner = () => currentWorkspace() === ws && workspaceGeneration() === rosterGeneration && connectionGeneration === menuConnection
          && (!actionTarget || ownsInstanceTarget(actionTarget));
        tools.append(instanceActions(document, i, {
          scope: ws, owner: menuOwner, onMenuState: menuState, onFocusChange: () => updateActiveContexts(), dispatch: runAction,
          shortcut: id => { const chord = getBinding(id, isMac); return chord ? formatChord(chord, isMac) : ''; },
          extra: [
            { action: 'open-split', actionId: 'instance.openSplit', label: 'Open in split', reason: () => !actionTarget ? 'Instance identity is not fully reported.'
              : unsupportedSession(i) || (i.running !== true ? 'No live terminal is reported.' : instanceSplitPlan(splitOpenState()).reason) },
            { action: 'open-pr', actionId: 'instance.openPullRequest', label: 'Open pull request…', reason: !actionTarget ? 'Instance identity is not fully reported.'
              : i.server || i.remote ? 'Remote PR inspection is unavailable; no local fallback.' : '' },
          ],
          invoke: async (action, instance) => {
            if (currentWorkspace() !== ws || workspaceGeneration() !== rosterGeneration) throw new Error("Workspace changed; select the instance again");
            if (action === 'open-split') return openTerminalTab(instance, { inSplit: true, expected: actionTarget, valid: menuOwner });
            if (action === 'open-pr') return instancePrAction.open(actionTarget);
            if (action === "start" || action === "restart") { openInstanceStart(instance, { restart: action === "restart" }); return; }
            if (action === "inspect") {
              const owns = tabOpenIntents.begin();
              let mod;
              try { mod = await import("./views/spawn.mjs"); }
              catch (error) { if (!owns()) return; throw error; }
              if (!owns()) return;
              mod.preselectHome(instance); await showStage("spawn"); return;
            }
            return api(instanceApiPath(action, instance), { method: "POST" });
          },
          openLifecycle: (operation, instance) => {
            if (currentWorkspace() !== ws || workspaceGeneration() !== rosterGeneration) return;
            openLifecycleDialog(operation, instance, ws);
          },
          done: () => {},
          report: (message, result) => {
            if (currentWorkspace() !== ws || workspaceGeneration() !== rosterGeneration) return;
            alert([message, retirementSummary(result)].filter(Boolean).join("\n"));
          },
        }));
        // Stale roster: actions that need current state wait for a refresh;
        // opening an existing terminal (the row itself) stays available.
        if (heldStale) {
          const trigger = tools.querySelector(".ctx-instance-actions");
          if (trigger) markStaleControl(trigger);
        }
        rowWrap.append(tools);
        listEl.append(rowWrap);
      }
    }
  }
  paintNote();
  // Polling restores the same logical focus; it must not cancel a pending
  // terminal open from that row as if the user had re-entered the sidebar.
  tabOpenIntents.applyFocus(() => {
    restoreTreeState();
    restoreActionMenu();
  });
  rosterTip.sync(listEl);
  // roving tabindex: exactly one row enters the tab order — the focused row
  // when it survived the rebuild, else the selected one (its terminal is the
  // active tab), else the first that matches the filter (not an ancestor kept for context)
  applyChordTitles(); updateActiveContexts();
  const rowsAfter = [...listEl.querySelectorAll(".ctx-inst")];
  const focusedRow = rowsAfter.find((r) => r === listEl.ownerDocument.activeElement);
  const tabbable = focusedRow || rowsAfter.find((r) => r.classList.contains("active"))
    || rowsAfter.find((r) => !r.dataset.filterContext) || rowsAfter[0];
  if (tabbable) tabbable.tabIndex = 0;
}

/* A pending spawn's row (Spec C): "Spawning…" text and a spinner (never colour alone), announced once;
   it opens nothing and has no instance actions until the real row replaces it. It keeps the real row's
   identity (data-tree-instance), so a focused pending row stays focused across the replacement. An
   unknown outcome reads "Outcome unknown" with a visible Check result (the existing result action). */
function pendingSpawnRow(i, items, instances) {
  const p = i.pendingSpawn, unknown = p.pending !== "spawning", checking = p.pending === "checking";
  const rowWrap = document.createElement("div");
  rowWrap.className = "ctx-tree-row ctx-spawn-row" + (unknown ? " ctx-spawn-unknown" : "") + (p.revealed ? " ctx-spawn-revealed" : "");
  rowWrap.style.setProperty("--depth", String(i.depth || 0));
  const guides = document.createElement("span");
  guides.className = "ctx-guides";
  guides.setAttribute("aria-hidden", "true");
  for (const { kind, level } of treeConnectors(items, i, instances)) {
    const guide = document.createElement("span");
    guide.className = `ctx-guide ${kind}`;
    guide.style.setProperty("--guide-level", String(level));
    guides.append(guide);
  }
  const row = document.createElement("button");
  row.type = "button";
  row.className = "ctx-inst pending";
  row.dataset.treeInstance = instanceId(i);
  row.dataset.treeControl = "terminal";
  row.dataset.rosterChildren = "0";
  row.dataset.rosterCollapsed = "0";
  if (!instanceMatchesFilter(i, contextFilter)) row.dataset.filterContext = "true";
  row.setAttribute("aria-disabled", "true");
  const why = unknown ? `The outcome of spawning ${i.instance} is not known yet. Check result asks again.`
    : `${i.instance} is being spawned. It opens once the roster reports it.`;
  row.title = why; row.setAttribute("aria-description", why);
  const mark = document.createElement("span");
  mark.setAttribute("aria-hidden", "true");
  mark.className = unknown && !checking ? "ctx-dot unknown" : "ctx-spawn-spinner";
  const copy = document.createElement("span");
  copy.className = "ctx-copy";
  const name = document.createElement("span");
  name.className = "ctx-name";
  name.textContent = i.instance;
  const meta = document.createElement("span");
  meta.className = "ctx-meta ctx-spawn-state";
  meta.textContent = checking ? "Checking result…" : unknown ? "Outcome unknown" : "Spawning…";
  copy.append(name, meta);
  row.append(mark, copy);
  row.tabIndex = -1;
  row.addEventListener("keydown", onRosterRowKey);
  rowWrap.append(guides, row);
  if (unknown) {
    const tools = document.createElement("span");
    tools.className = "ctx-row-tools ctx-spawn-tools";
    const check = document.createElement("button");
    check.type = "button"; check.className = "act ctx-start ctx-spawn-check";
    check.textContent = "Check result"; check.setAttribute("aria-label", `Check result for ${i.instance}`);
    check.dataset.treeInstance = instanceId(i); check.dataset.treeControl = "check-result";
    // aria-disabled while checking, not disabled: focus stays on it across the repaint.
    if (checking) check.setAttribute("aria-disabled", "true");
    check.addEventListener("click", () => { if (!checking) void spawnJobs.check(p.id); });
    tools.append(check);
    rowWrap.append(tools);
  }
  if (spawnJobs.announce(p.id)) announceSpawn(`Spawning ${i.instance}…`);
  return rowWrap;
}

/* The roster's polite live region for pending spawns (outside the rebuilt list). */
function announceSpawn(text) {
  let region = contextRosterEl.querySelector(":scope > .ctx-spawn-live");
  if (!region) {
    region = document.createElement("div");
    region.className = "loading-sr ctx-spawn-live";
    region.setAttribute("aria-live", "polite");
    contextRosterEl.append(region);
  }
  region.textContent = text;
}

/* Keyboard walk over the rendered roster rows. Every row takes focus, an
   unavailable one included (aria-disabled: its tools stay reachable);
   expanding/collapsing re-renders and the focused instance is restored by
   captureTreeRenderState. */
function onRosterRowKey(e) {
  const btn = e.currentTarget;
  const action = rosterKeyAction(e, {
    hasChildren: btn.dataset.rosterChildren === "1",
    collapsed: btn.dataset.rosterCollapsed === "1",
  });
  if (!action) return;
  tabOpenIntents.invalidate(); // keyboard tree navigation is explicit, not a polling restoration
  e.preventDefault();
  const listEl = contextRosterEl.querySelector(".ctx-list");
  const rows = [...listEl.querySelectorAll(".ctx-inst")];
  const at = rows.indexOf(btn);
  const id = btn.dataset.treeInstance; // instanceId(i) — composite identity
  const ws = contextWorkspace || currentWorkspace();
  const focusInstance = (targetId) => {
    const target = [...listEl.querySelectorAll(".ctx-inst")]
      .find((r) => r.dataset.treeInstance === targetId && !r.disabled);
    if (target) setRovingRow(listEl, target);
    return !!target;
  };
  if (action.type === "expand" || action.type === "collapse") {
    const key = collapseKey(ws, id);
    if (action.type === "expand") collapsedInstances.delete(key); else collapsedInstances.add(key);
    renderContextRoster(contextInstances);
    focusInstance(id);
    return;
  }
  if (action.type === "parent") {
    // rows carry instanceId, so resolve the CURRENT item and its parent by
    // IDENTITY — a bare-name lookup never matches identity-bearing rows
    // (ArrowLeft dead) and is unsafe for duplicate names (review 96b037b)
    const pid = rosterParentId(contextInstances, id);
    if (pid) focusInstance(pid);
    return;
  }
  const to = moveTarget(action, at, rows.length);
  if (to < 0 || to === at) return;
  // Every row takes focus (an unavailable one is aria-disabled, never disabled).
  setRovingRow(listEl, rows[to]);
}

/* Move focus AND the single tab-order slot to `row` (roving tabindex). */
function setRovingRow(listEl, row) {
  for (const r of listEl.querySelectorAll('.ctx-inst[tabindex="0"]')) r.tabIndex = -1;
  row.tabIndex = 0;
  row.focus();
}

/** Select a roster row of this workspace (by server and home) and move keyboard focus to it: through a
 * filter that hides it and any collapsed ancestor. False when the roster does not list it (yet). */
async function showInRoster(instance) {
  const ws = currentWorkspace();
  const find = () => contextWorkspace === ws ? contextInstances.find(i => (i.server || null) === (instance?.server || null) && i.home === instance?.home) : null;
  if (!find()) await refreshContextRoster();
  const row = find();
  if (!row || ws !== currentWorkspace() || !contextRosterEl) return false;
  if (contextFilter && !instanceMatchesFilter(row, contextFilter)) {
    contextFilter = "";
    const input = contextRosterEl.querySelector(".ctx-filter"); if (input) input.value = "";
  }
  for (let id = rosterParentId(contextInstances, instanceId(row)), seen = new Set(); id && !seen.has(id); id = rosterParentId(contextInstances, id)) {
    seen.add(id); collapsedInstances.delete(collapseKey(ws, id));
  }
  renderContextRoster(contextInstances);
  const listEl = contextRosterEl.querySelector(".ctx-list");
  const target = listEl && [...listEl.querySelectorAll(".ctx-inst")].find(r => r.dataset.treeInstance === instanceId(row));
  if (!target) return false;
  tabOpenIntents.invalidate(); // an explicit navigation, not a polling restoration
  setRovingRow(listEl, target);
  return true;
}

/* "Show its row" (Spec D): focus a background spawn's pending row, revealing it like showInRoster. */
function showPendingSpawn(id) {
  const target = revealPendingSpawn(id, { clearFilter: true });
  if (!target) return false;
  tabOpenIntents.invalidate(); // an explicit navigation, not a polling restoration
  setRovingRow(target.closest(".ctx-list"), target);
  return true;
}

/* Spec E: after a press, the pending row is revealed and highlighted (its ancestors expanded, scrolled
   into view) without taking focus or cancelling anything pending; an operator's filter that hides it
   stays (clearFilter is "Show its row"'s explicit request). Returns the row, or null. */
function revealPendingSpawn(id, { clearFilter = false } = {}) {
  const ws = currentWorkspace();
  const pending = spawnJobs.rows(ws).find(p => p.id === id);
  if (!pending || !contextRosterEl) return null;
  const all = [...contextInstances, { instance: pending.instance, agent: pending.agent, agentsRoot: pending.agentsRoot, home: pending.home,
    ...(pending.parentInstance ? { parentInstance: pending.parentInstance } : {}), ...(pending.siblingInstance ? { siblingInstance: pending.siblingInstance } : {}) }];
  const self = all.at(-1);
  if (clearFilter && contextFilter && !instanceMatchesFilter(self, contextFilter)) {
    contextFilter = "";
    const input = contextRosterEl.querySelector(".ctx-filter"); if (input) input.value = "";
  }
  for (let pid = rosterParentId(all, instanceId(self)), seen = new Set(); pid && !seen.has(pid); pid = rosterParentId(all, pid)) {
    seen.add(pid); collapsedInstances.delete(collapseKey(ws, pid));
  }
  spawnJobs.reveal(id);
  renderContextRoster(contextInstances);
  const listEl = contextRosterEl.querySelector(".ctx-list");
  const target = listEl && [...listEl.querySelectorAll(".ctx-inst")].find(r => r.dataset.treeInstance === instanceId(self));
  if (!target) return null;
  revealInScrollport(listEl, target.closest(".ctx-tree-row") || target);
  return target;
}

function showTerminalContext() {
  setSidebarMode("instances");
  refreshContextRoster();
  // Per-workspace active-tab memory: switching back to a workspace restores
  // the terminal that was active there (stale/foreign keys fall back to the
  // most recently opened terminal of the workspace).
  if (split) {
    const focused = split.groups.find(g => g.id === split.focusedGroup);
    if (activateTab(focused?.activeTab ?? null, { keepGroupFocus: true })) return;
  }
  const ws = currentWorkspace();
  const restored = restoreTerminalTab(tabs, ws, wsActiveTerminal.get(ws));
  if (restored) { activateTab(restored[0]); return; }
  // With the tree permanently visible, closing/switching away from the last
  // terminal restores the prior stage surface.
  setSidebarMode(stageSidebarMode(stage?.name));
  showTabLayer(false);
  setNavActive(stage?.name || "hierarchy");
}

// ── tabs ──────────────────────────────────────────────────────────────────
const tabbar = document.getElementById("tabbar");
const tabhost = document.getElementById("tabhost");
const tabs = new Map(); // id -> { tabEl, triggerEl, closeEl, paneEl, title, key, onClose, onShow }
let nextTabId = 1;
let activeTab = null;
const wsActiveTerminal = new Map(); // workspace id -> last-active terminal tab key
const brainIntents = createIntentGate();
// Terminal and artifact opens compete for the same foreground selection.
const tabOpenIntents = createSelectionOwnership({ currentWorkspace, workspaceGeneration });
const instancePrAction = createInstancePrAction({ ctx, beginIntent: () => tabOpenIntents.begin(), currentTarget: ownsInstanceTarget,
  generation: workspaceGeneration, connectionGeneration: () => connectionGeneration, report: message => ctx.notify(message), openExternal: ctx.openExternal });
window.addEventListener('pagehide', () => instancePrAction.dispose(), { once: true });
const contextPanel = createContextPanel({
  document, connectionGeneration: () => connectionGeneration, subscribeConnections,
  createGitPanel: (parent, focus) => createInstanceGitPanel(parent, { ...focus,
    generation: workspaceGeneration,
    connectionGeneration: () => connectionGeneration, subscribeConnections,
    connect: choice => openConnections(choice), openExternal: ctx.openExternal,
    requestForge: (workspace, body) => api(`/api/instance-forge?ws=${encodeURIComponent(workspace)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
    // W6 item 4 (#248): preview / send a PR's review threads to this instance's terminal (the server composes the text).
    requestThreads: (workspace, body) => api(`/api/instance-review-threads?ws=${encodeURIComponent(workspace)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
    request: (workspace, body) => api(`/api/instance-git?ws=${encodeURIComponent(workspace)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }),
  }),
  // Teams (teams contract): the instance's own teams through its messaging provider's operations.
  createTeamsSection: (host, options) => createInstanceTeamsSection(host, { ...options, generation: workspaceGeneration,
    request: (workspace, body) => api(`/api/capabilities?ws=${encodeURIComponent(workspace)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
  }),
  // Soul tab (W6): the soul as the instance was spawned — its own `oats inspect --home` read.
  createSoulSection: (host, { onPresence }) => createInstanceSoulSection(host, { onPresence, generation: workspaceGeneration,
    request: (workspace, body) => api(`/api/capabilities?ws=${encodeURIComponent(workspace)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
  }),
  // W6 footer: the roster menu's own lifecycle dialogs (plan-backed Stop/Retire, Start/Restart with…).
  lifecycle: {
    start: (instance, workspace) => { if (workspace === currentWorkspace()) openInstanceStart(instance); },
    restart: (instance, workspace) => { if (workspace === currentWorkspace()) openInstanceStart(instance, { restart: true }); },
    stop: (instance, workspace) => { if (workspace === currentWorkspace()) openLifecycleDialog('stop', instance, workspace); },
    retire: (instance, workspace) => { if (workspace === currentWorkspace()) openLifecycleDialog('retire', instance, workspace); },
  },
  // Soul tab → the soul in the Workspace view (same hand-off as Quick Open).
  openSoul: async ({ workspace, name, agentsRoot, server }) => {
    const owns = tabOpenIntents.begin();
    let mod;
    try { mod = await import("./views/spawn.mjs"); }
    catch (e) { if (owns()) ctx.notify(`Could not open soul: ${e.message || e}`); return; }
    if (!owns() || workspace !== currentWorkspace()) return;
    // The hand-off is intent-guarded by the view (a newer selection drops it); a miss says why nothing opened.
    const gen = workspaceGeneration();
    mod.preselectSoul({ name, agentsRoot, server, onMiss: count => { if (workspaceGeneration() === gen) ctx.notify(count ? `Several souls are named ${name}; pick it in the Workspace view.` : `${name} is not in this workspace's souls.`); } });
    showStage("spawn");
  },
  onIntent: () => { if (!tabOpenIntents.isApplyingFocus()) tabOpenIntents.invalidate(); },
  applyFocus: callback => tabOpenIntents.applyFocus(callback),
  onFocusModeChange: () => updateSidebarControls(),
  // Focus mode hides the sidebar: focus that was there lands on the active tab, else a stable visible control.
  fallbackFocus: () => stableFocusTarget(),
});
window.addEventListener("pagehide", () => contextPanel.dispose(), { once: true });

/** Projection only: foreground comes from the committed active tab/stage. */
function syncContextPanel() {
  const tab = tabLayerVisible ? tabs.get(activeTab) : null;
  const terminal = tab?.kind === "terminal" && canActivateTab(tab, currentWorkspace());
  contextPanel.setContext({ workspace: currentWorkspace(), owner: tabLayerVisible ? null : stage,
    instance: terminal ? tab.instanceRef : null, key: terminal && tab.instanceRef ? tab.key : null });
}
function activeTabTrigger() { return activeTab != null ? tabs.get(activeTab)?.triggerEl ?? null : null; }
/** Where focus goes when the control holding it disappears: the active tab's trigger when it is shown, else a
 * stable visible control (the sidebar toggle, or the restore edge that focus mode and a
 * hidden sidebar show), never <body>. */
function stableFocusTarget() {
  const shown = el => {
    if (!el?.isConnected || el.disabled) return false;
    for (let node = el; node; node = node.parentElement) {
      if (node.hidden || node.inert || document.defaultView.getComputedStyle(node).display === "none") return false;
    }
    return true;
  };
  return [activeTabTrigger(), ...["sidebar-toggle", "sidebar-restore"].map(id => document.getElementById(id))].find(shown) ?? null;
}
function refreshPanelInstance(instances, workspace) {
  const tab = tabs.get(activeTab);
  if (!tabLayerVisible || tab?.kind !== "terminal" || tab.workspace !== workspace) return;
  const matches = instances.filter(instance => terminalKey(workspace, instance) === tab.key);
  // Preserve identity, but do not present a retained Running observation as
  // current when the latest roster cannot identify the selected home uniquely.
  if (matches.length === 1) tab.instanceRef = matches[0];
  else if (tab.instanceRef) tab.instanceRef = { ...tab.instanceRef, running: null };
  syncContextPanel();
}
const workspaceTabMemory = createWorkspaceTabMemory();
let tabWorkspace = currentWorkspace();
let nextPickedFileId = 0;
const fileOpener = createFileOpener({
  document,
  beginIntent: () => tabOpenIntents.begin(),
  report: message => alert(message),
  openFile: (pickedFile, owns) => openViewTab("markdown", pickedFile.name,
    { pickedFile }, `picked-file:${++nextPickedFileId}`, "file", undefined, owns),
});

// ── editor groups: a split of the tab LAYER into persistent groups ─────
// Pure transitions live in split-layout.mjs; the shell owns the DOM through
// projectSplitDom (split-dom.mjs): each group renders its own tab strip and
// pane cell inside #tabhost, the top #tabstrip hides while the split is
// visible, and the flat restore is byte-identical to the non-split shell.
// VS Code semantics: the layout persists across tab switches; new terminal
// tabs open into the FOCUSED group; group focus follows the active tab.
// Terminal FitAddon refit is automatic: each tab's ResizeObserver fires
// when its pane is resized by the layout.
let split = null; // editor-group model (split-layout.mjs) | null
function renderSplit(splitVisible) {
  const generation = workspaceGeneration();
  let cells;
  // Reprojection may restore a moved trigger/input/placeholder's DOM focus.
  // That focusin is not a second selection (including side-effect restores).
  tabOpenIntents.applyFocus(() => projectSplitDom({
    tabhost, tabstrip: document.getElementById("tabstrip"), tabbar,
    actionsEl: tabActionsEl, actionsHome: document.getElementById("tabbar-row"),
    isApplyingFocus: tabOpenIntents.isApplyingFocus,
    onSelectEmpty: (groupId, cell) => {
      if (generation !== workspaceGeneration() || !tabLayerVisible || !splitVisible
          || cell.parentNode !== tabhost) return;
      selectEmptyGroup(groupId); // validates LIVE model membership/emptiness
    },
    onResize: sizes => {
      if (generation === workspaceGeneration() && tabLayerVisible && splitVisible && cells?.length
          && cells.every(cell => cell.parentNode === tabhost
          && split?.groups.some(g => String(g.id) === cell.dataset.group))) split = resizeSplitGroups(split, sizes);
    },
  }, split, splitVisible, [...tabs]));
  cells = [...tabhost.querySelectorAll(":scope > .group-cell")];
  observeTabStrips();
}

// ── the selected tab stays visible (spec F) ──────────────────────────────
// Whenever a tab becomes active, a tab closes, or a strip resizes (window,
// sidebar, panel, split), each strip scrolls its active tab fully into view.
// Only the strip's scrollLeft moves (revealInStrip): never another ancestor.
function tabStrips() {
  return [tabbar, ...tabhost.querySelectorAll(":scope > .group-cell > .group-tabbar")];
}
function revealActiveTabs() {
  for (const strip of tabStrips()) {
    const active = strip.querySelector(":scope > .tab.active:not([hidden])");
    if (active) revealInStrip(strip, active);
  }
}
const tabStripResize = typeof ResizeObserver === "function" ? new ResizeObserver(() => revealActiveTabs()) : null;
/** Group strips come and go with the split: observe exactly the current ones. */
function observeTabStrips() {
  if (!tabStripResize) return;
  tabStripResize.disconnect();
  for (const strip of tabStrips()) tabStripResize.observe(strip);
}
observeTabStrips();

/** Explicit empty-destination selection. Never leave terminal commands aimed
 * at the previously active tab; projection and native focus are separate. */
function selectEmptyGroup(groupId) {
  if (!tabLayerVisible || !split?.groups.some(g => g.id === groupId && !g.tabs.length)) return false;
  tabOpenIntents.invalidate();
  split = { ...split, focusedGroup: groupId };
  return activateTab(null, { keepGroupFocus: true });
}

// ── tab-strip split controls: clickable twins of the split.* actions ──
// The buttons run the SAME registered actions (runAction is context-gated
// exactly like chord dispatch); enablement dry-runs the same model
// transition the actions perform — no duplicated gating logic.
const tabActionsEl = document.getElementById("tab-actions");
for (const [btnId, actionId] of [
  ["split-right", "split.vertical"], ["split-down", "split.horizontal"],
]) {
  document.getElementById(btnId).addEventListener("click", () => runAction(actionId));
}
function updateSplitControls() {
  const t = activeTab != null ? tabs.get(activeTab) : null;
  const s = splitControlsState(split, activeTab, t?.kind ?? null, tabLayerVisible);
  tabActionsEl.hidden = !s.visible;
  document.getElementById("split-right").disabled = !s.splitRow;
  document.getElementById("split-down").disabled = !s.splitCol;
}

function splitPane(orientation) {
  const t = tabs.get(activeTab);
  const controls = splitControlsState(split, activeTab, t?.kind ?? null, tabLayerVisible);
  if (!(orientation === "row" ? controls.splitRow : controls.splitCol)) return; // terminal layer only
  // The first split seeds group 1 with ALL of the layer's current terminal
  // tabs (they stay together — human requirement) and creates a focused
  // empty group; further splits add a group after the focused one.
  const seed = [...tabs]
    .filter(([, tab]) => tab.kind === "terminal" && tab.workspace === currentWorkspace())
    .map(([id]) => id);
  const r = requestSplit(split, orientation, seed, activeTab);
  split = r.split;
  if (!r.changed) return;
  tabOpenIntents.invalidate();
  // A newly focused empty group has no active terminal. Reproject without
  // re-selecting the source tab and silently stealing the destination back.
  const focused = split.groups.find(g => g.id === split.focusedGroup);
  activateTab(focused.activeTab, { keepGroupFocus: true });
  // an empty focused group is filled by picking an instance — take the user there
  if (!focused.tabs.length) focusRoster();
}

function closeSplit() {
  tabOpenIntents.invalidate();
  if (!split) return;
  split = null;
  renderSplit(false); // also clears cells/controls when activeTab is null
  if (!tabLayerVisible) { updateSplitControls(); return; }
  if (activeTab != null) activateTab(activeTab);
  else {
    showTerminalContext(); // join surviving terminals, or return to the stage
    if (activeTab != null) tabs.get(activeTab)?.triggerEl.focus();
    else focusAfterLastTab("terminal", { instancesEntry: contextRosterEl?.querySelector(".ctx-filter") });
  }
  updateSplitControls();
}

/** Return from a stage/file without opening an instance just to recover empty
 * destinations. Explicit, palette-discoverable; no new default shortcut. */
function restoreTerminalGroups() {
  if (!split) return;
  tabOpenIntents.invalidate();
  showTerminalContext();
  if (activeTab == null) tabOpenIntents.applyFocus(() => {
    tabhost.querySelector(".focused-group > .split-empty")?.focus();
  });
}

/** key: optional dedup key — activating an existing tab instead of opening a
 * twin. View modules keep module-level state (they are singletons by design),
 * so one tab per view/file is also a correctness requirement. Callers of a
 * KEYED open must `await whenKeyFree(key)` first: a reopen during a closed
 * tab's deferred cleanup queues behind it instead of being dropped or torn
 * down by the stale lifecycle. */
function onTabKeydown(e, id) {
  // Per-group keyboard navigation: while the split renders, arrows/Home/End
  // walk the CLOSED SET of the tab's own group strip (each .group-tabbar is
  // its own tablist); the flat strip walks all context-visible tabs.
  const group = tabLayerVisible && (activeTab == null || tabs.get(activeTab)?.kind === "terminal")
    ? groupOfTab(split, id) : null;
  const visible = group
    ? group.tabs.map((tid) => [tid, tabs.get(tid)]).filter(([, t]) => t)
    : [...tabs].filter(([, t]) => !t.tabEl.hidden);
  const at = visible.findIndex(([tid]) => tid === id);
  if (at < 0) return;
  const action = tabKeyAction(e, at, visible.length);
  if (!action) return;
  e.preventDefault();
  if (action.type === "close") { closeTab(id, true); return; }
  const [nextId, tab] = visible[action.index];
  if (selectTab(nextId)) tab.triggerEl.focus();
}

function addTab({ decor = null, title, key, kind = "artifact", workspace = currentWorkspace(), instanceRef = null, onClose, confirmClose = null, onShow, focusContent = null, focusOnActivate = false, intent = null }) {
  if (key) {
    for (const [tid, t] of tabs) if (t.key === key) {
      if (instanceRef && (!intent || intent())) t.instanceRef = instanceRef;
      if (intent) selectTab(tid, { intent, focusContent: focusOnActivate });
      else activateTab(tid);
      return null;
    }
  }
  const id = nextTabId++;
  const { tabEl, triggerEl, closeEl, paneEl } = createTabChrome(
    document, id, title, navigator.platform.includes("Mac"), decor ?? { kind },
  );
  tabbar.append(tabEl);
  tabhost.append(paneEl);
  triggerEl.addEventListener("click", () => selectTab(id));
  triggerEl.addEventListener("keydown", (e) => onTabKeydown(e, id));
  closeEl.addEventListener("click", (e) => { e.stopPropagation(); closeTab(id, true); });
  // Pane interaction supersedes pending opens, including an already-active
  // pane. Selection does not force focus: xterm owns native pointer focus.
  wirePaneSelection(paneEl, {
    isVisible: () => tabLayerVisible && !paneEl.hidden && canActivateTab(tabs.get(id), currentWorkspace()),
    isApplyingFocus: () => tabOpenIntents.isApplyingFocus(),
    select: () => selectTab(id),
  });
  tabs.set(id, { tabEl, triggerEl, closeEl, paneEl, title, key, kind, workspace, instanceRef, onClose, confirmClose, onShow, focusContent });
  if (intent) selectTab(id, { intent, focusContent: focusOnActivate });
  else activateTab(id);
  return { id, paneEl };
}

/** Explicit selection seam for tab/group commands. Omit intent for a new
 * user action; async opens pass their dispatch ticket (never mint on arrival).
 * focusContent opts into input focus, including a terminal still attaching.
 * Strip/pane navigation leaves DOM focus to its caller/native event. */
function selectTab(id, { focusContent = false, intent = tabOpenIntents.begin() } = {}) {
  if (!intent() || !canActivateTab(tabs.get(id), currentWorkspace())) return false;
  if (focusContent) tabOpenIntents.focus(id, intent);
  // Projection can restore DOM focus after moving a retained pane. Like
  // term.focus(), that synchronous focusin is not a second user selection.
  return tabOpenIntents.applyFocus(() => {
    if (!activateTab(id)) return false;
    if (focusContent) tabs.get(id)?.focusContent?.();
    return true;
  });
}

/** Projection/restoration only — does not create explicit selection or focus
 * intent. keepGroupFocus preserves the destination chosen by a model transition
 * (e.g. the new empty group after splitting). User commands use selectTab. */
function activateTab(id, { keepGroupFocus = false } = {}) {
  const current = tabs.get(id);
  // Hidden is not security: reject every cross-workspace artifact activation at
  // the mutation boundary before its pane can become active/receive input.
  const emptyFocused = id == null && !!split?.groups.some(g => g.id === split.focusedGroup && !g.tabs.length);
  if (!emptyFocused && !canActivateTab(current, currentWorkspace())) return false;
  activeTab = id;
  if (current?.kind === "terminal" && split && !keepGroupFocus) {
    // Editor-group semantics: an existing member activation moves its
    // group's active tab + group focus; a NEW terminal tab (any open path
    // — roster, palette, quick-open) joins the FOCUSED group. Either way
    // the split persists — switching tabs never dismantles it.
    split = isSplitMember(split, id)
      ? focusTab(split, id).split
      : openTabInFocusedGroup(split, id).split;
  }
  if (current?.kind === "terminal" && current.workspace) {
    wsActiveTerminal.set(current.workspace, current.key);
  }
  if (current?.kind === "terminal" || emptyFocused) {
    setSidebarMode("instances");
    setNavActive(null);
    refreshContextRoster();
  } else if (current?.kind === "brain") {
    setSidebarMode("souls");
    setNavActive("spawn");
  } else if (current?.kind === "file") {
    if (sidebarMode !== "instances" && sidebarMode !== "souls") setSidebarMode("instances");
    // Workspace restoration sets the remembered context BEFORE activation.
    // Project its nav even when the mode already fits, rather than retaining
    // the stage highlight left by the workspace we just departed.
    setNavActive(sidebarMode === "souls" ? "spawn" : null);
  }
  showTabLayer(true);
  // The split renders for a terminal OR its empty focused destination;
  // activating a non-terminal tab (file/brain)
  // COVERS it without destroying the group state — the split re-materializes
  // when the user returns to a terminal tab.
  const splitVisible = !!split && (current?.kind === "terminal" || emptyFocused);
  for (const [tid, t] of tabs) {
    const selected = tid === id;
    // Per-group a11y: while the split renders, each .group-tabbar is its
    // own tablist — single selection and the roving tabindex hold PER
    // GROUP (the group's active tab is selected/tabbable in its strip).
    // Flat state keeps the classic single-selection strip.
    const groupActive = splitVisible && groupOfTab(split, tid)?.activeTab === tid;
    const on = canActivateTab(t, currentWorkspace()) && (splitVisible ? groupActive : selected);
    t.tabEl.classList.toggle("active", on);
    t.triggerEl.setAttribute("aria-selected", String(on));
    t.triggerEl.tabIndex = on ? 0 : -1;
    t.paneEl.classList.toggle("active", on);
    t.paneEl.classList.toggle("split-cell", splitVisible && on);
    t.paneEl.hidden = !on;
  }
  renderSplit(splitVisible);
  updateSplitControls();
  revealActiveTabs();
  tabs.get(id)?.onShow?.();
  return true;
}

function closeTab(id, restoreFocus = false, { explicit = true, confirmed = false, passive = false } = {}) {
  // All public close paths supersede foreground work, even for inactive tabs.
  // Internal replacement (brain open) is part of its enclosing open intent.
  if (explicit) tabOpenIntents.invalidate();
  const t = tabs.get(id);
  if (!t) return;
  if (t.confirmClose && !confirmed) {
    t.closeIntent = { owns: tabOpenIntents.begin(), restoreFocus };
    if (t.closeFlight) return t.closeFlight;
    let work;
    try { work = t.confirmClose(); } catch { return; }
    const flight = Promise.resolve(work).then(result => {
      if (tabs.get(id) !== t || t.closeFlight !== flight) return;
      const latest = t.closeIntent.owns();
      if (result?.terminalApi === 2 && result.ok && result.status === 'closed') {
        closeTab(id, t.closeIntent.restoreFocus && latest, { explicit: false, confirmed: true, passive: !latest });
      }
      // Pending/failure retains the exact tab, its literal state and key.
    }, () => { /* failure does not repaint, navigate, focus or remove the tab */ })
      .finally(() => { if (tabs.get(id) === t && t.closeFlight === flight) t.closeFlight = null; });
    t.closeFlight = flight;
    if (t.key) reserveKey(t.key, flight);
    return flight;
  }
  // onClose may return a promise (deferred cleanup while a mount is pending);
  // reserve the key until it resolves — reopen requests queue behind it via
  // whenKeyFree() instead of mounting under the stale lifecycle.
  try {
    const r = t.onClose?.();
    if (r && typeof r.then === "function" && t.key) reserveKey(t.key, r);
  } catch (e) { console.error(e); }
  t.tabEl.remove();
  t.paneEl.remove();
  tabs.delete(id);
  revealActiveTabs(); // the remaining tabs widen: the active one may have moved out of view
  const wasSplitMember = isSplitMember(split, id);
  // Closing a tab never closes a destination. If the terminal layer is
  // visible, stay in its focused group even when it (or every group) is empty.
  const removed = removeSplitTab(split, id);
  const splitSuccessor = activeTab === id ? removed.successor : null;
  split = removed.split;
  // Delayed cleanup never reopens a covered terminal layer/other workspace.
  if (passive && (!tabLayerVisible || t.workspace !== currentWorkspace())) {
    if (activeTab === id) activeTab = null;
    return;
  }
  if (wasSplitMember && tabLayerVisible
      && (activeTab == null || activeTab === id || tabs.get(activeTab)?.kind === "terminal")) {
    const next = activeTab === id ? splitSuccessor : activeTab;
    activateTab(next, { keepGroupFocus: true });
    if (restoreFocus) tabOpenIntents.applyFocus(() => {
      if (next != null) tabs.get(next)?.triggerEl.focus();
      else tabhost.querySelector(".focused-group > .split-empty")?.focus();
    });
    return;
  }
  if (activeTab === id) {
    const fallback = fallbackTabForContext(tabs, sidebarMode, currentWorkspace());
    if (fallback) {
      activateTab(fallback[0]);
      if (restoreFocus) fallback[1].triggerEl.focus();
    } else if (t.kind === "terminal") {
      showTerminalContext();
      if (restoreFocus) focusAfterLastTab("terminal", {
        instancesEntry: contextRosterEl?.querySelector(".ctx-filter"),
      });
    } else {
      activeTab = null;
      showTabLayer(false);
      if (stage) setNavActive(stage.name);
      if (restoreFocus) focusAfterLastTab("artifact", {
        stageEntry: navEl.querySelector(".nav-item.active") || navEl.querySelector(".nav-item"),
      });
    }
  } else if (restoreFocus) {
    tabs.get(activeTab)?.triggerEl.focus();
  }
  // a member closed while another member stayed active: re-render the layout
  if (wasSplitMember && activeTab != null && activeTab !== id) activateTab(activeTab, { keepGroupFocus: true });
}

// ── view host: load ./views/<name>.mjs, mount into a tab ─────────────────
async function openBrainTab(agent) {
  // One brain tab per workspace; other workspaces keep their own mounted
  // selection. Supersede earlier opens before deferred cleanup/module loading.
  const owns = brainIntents.begin();
  for (const [id, t] of tabs) if (t.kind === "brain" && t.workspace === currentWorkspace()) closeTab(id, false, { explicit: false });
  return openViewTab("brain", agent, { agent }, "view:brain", "brain", owns);
}

async function openViewTab(name, title, extra = {}, key = `view:${name}`,
  kind = name === "markdown" ? "file" : "artifact", parentOwns = () => true, selectionOwns = null) {
  const workspace = currentWorkspace();
  const latest = selectionOwns ?? tabOpenIntents.begin();
  const owns = () => parentOwns() && latest();
  if (!owns()) return;
  key = JSON.stringify([workspace, key]);
  let mod;
  try {
    mod = await prepareOwnedOpen({
      owns,
      waitForKey: () => whenKeyFree(key),
      load: () => import(`./views/${name}.mjs`),
    });
    if (!mod) return;
  } catch (e) {
    if (!owns()) return;
    const made = addTab({ title: `${title} (missing)`, key, kind, workspace, intent: owns });
    if (made) made.paneEl.innerHTML = `<div class="placeholder"><h2>${name}</h2><div>view module failed to load: ${e.message}</div></div>`;
    return;
  }
  const life = createViewLifecycle(mod, (e) => console.error(e));
  const made = addTab({
    title,
    key,
    kind,
    workspace,
    intent: owns,
    // Close is safe at any time — including while the async mount is still
    // pending: the lifecycle defers cleanup until mount settles and then
    // runs THAT mount's disposer (never the module-wide unmount mid-flight,
    // which would clear every open mount of the module).
    onClose: () => life.close(),
  });
  if (!made) return; // existing tab activated
  const el = document.createElement("div");
  el.style.height = "100%";
  made.paneEl.append(el);
  try {
    // Retained artifacts never change identity with the global workspace bus.
    // Late events from a hidden/closed artifact cannot open work in another scope.
    const visibleOwner = () => tabs.has(made.id) && currentWorkspace() === workspace;
    await life.mounted(el, {
      ...ctx, ...extra, workspace,
      // Once created, an immutable file belongs to its tab, not foreground
      // selection. Hidden reads may finish without activating/focusing it;
      // returning to the tab must not leave a permanently stale Loading state.
      owns: () => tabs.has(made.id),
      openFile: path => visibleOwner() && ctx.openFile(path),
      openBrain: agent => visibleOwner() && ctx.openBrain(agent),
      openTerminal: (instance, opts) => visibleOwner() && ctx.openTerminal(instance, opts),
    });
    if (!owns()) return;
  }
  catch (e) {
    if (owns()) el.innerHTML = `<div class="placeholder"><h2>${name}</h2><div>mount failed: ${e.message}</div></div>`;
  }
}

// ── integrated terminal tab (the shell's own flagship view) ──────────────
const pendingTerms = new Set(); // keys with a tab CREATION in flight (post-resolution — dedup for concurrent opens of one resolved identity)
/** ref: either a bare instance name (views, palette — resolved only when
 * unambiguous) or { instance, home?, agentsRoot? } (sidebar rows — exact).
 * opts.quiet (post-spawn auto-open): failures report via console.warn
 * instead of a blocking alert() — an automated handoff must never park a
 * modal dialog over the app; the user recovers from the sidebar roster.
 * ORDER MATTERS (review 7d740f9): the reference is resolved against the
 * roster FIRST and the dedup key derives from the RESOLVED instance, so a
 * bare-name open and a sidebar open of the same identity share one tab —
 * and an existing tab can never be activated for a name that has since
 * become ambiguous (resolution refuses before dedup can activate). */
async function openTerminalTab(ref, { quiet = false, inSplit = false, expected = null, valid = () => true, onError } = {}) {
  const notify = onError || (quiet ? (msg) => console.warn(`[terminal open] ${msg}`) : (msg) => alert(msg));
  // Quiet opens must NEVER reject either (review ff70e1c nit): the refusal
  // messages route through notify, but transport failures (the panel fetch,
  // the tab mount) would still escape as an unhandled rejection from an
  // automated caller that does not await. runOpenFlow catches every quiet
  // rejection into notify; interactive opens keep throwing.
  return runOpenFlow(() => openTerminalTabFlow(ref, notify, { inSplit, expected, valid }), { quiet, notify });
}

async function openTerminalTabFlow(ref, notify, options = {}) {
  if (options.valid && !options.valid()) return;
  const planned = options.inSplit ? instanceSplitPlan(splitOpenState()) : null;
  const layoutIdentity = planned ? instanceSplitIdentity(splitOpenState()) : null;
  if (planned && !planned.available) return notify(planned.reason);
  // A sidebar-tree selection opens its terminal directly — the persistent
  // sidebar roster IS the instances surface (there is no Instances stage;
  // scope correction of PR #29).
  setSidebarMode("instances");
  setNavActive(null);
  refreshContextRoster();
  // Honor the views' workspace bus: an instance selected in a secondary
  // (server-advertised) workspace must resolve against THAT roster, and a
  // same-named instance in another workspace — or another agents root
  // (review 46f3fdc) — is a different terminal.
  const ws = currentWorkspace();
  const selected = tabOpenIntents.begin(), connection = connectionGeneration;
  const owns = () => selected() && connection === connectionGeneration && (!options.valid || options.valid());
  const commitDestination = () => {
    if (!planned) return true;
    if (!owns() || instanceSplitIdentity(splitOpenState()) !== layoutIdentity) return false;
    split = planned.split; return true;
  };
  let panel;
  try {
    panel = await api(`/api/panel${ws ? `?ws=${encodeURIComponent(ws)}` : ""}`);
  } catch (e) {
    if (!owns()) return; // stale rejection belongs to the old workspace
    throw e;
  }
  if (!owns()) return;
  // Identity-aware resolution BEFORE any key/tab decision (resolveTerminalOpen
  // encodes the ordering; review 7d740f9): an exact home/agentsRoot reference
  // finds ITS instance; a bare name resolves only when unambiguous — the
  // first same-named match could be another agents root's tmux session.
  const r = resolveTerminalOpen(panel.instances, ref, ws);
  if (r.error) {
    return notify(r.error === "ambiguous"
      ? `several instances are named "${r.name}" — open it from the sidebar tree, which addresses the exact one`
      : `unknown instance "${r.name}"`);
  }
  const { inst, key } = r;
  if (options.expected && !sameInstanceActionTarget(options.expected, inst, ws)) return notify('The selected instance identity changed. Use the current roster.');
  try { await whenKeyFree(key); }
  catch (e) { if (!owns()) return; throw e; }
  if (!owns()) return;
  // Every jump path through here is user-initiated (palette, roster row,
  // quick-open, post-spawn open) — activating an existing tab focuses its
  // terminal input so the user can type into tmux immediately.
  for (const [tid, t] of tabs) if (t.key === key) {
    if (!commitDestination()) return notify('The terminal destination changed. Select the instance again.');
    t.instanceRef = inst;
    split = fillEmptyGroup(split, tid);
    selectTab(tid, { intent: owns, focusContent: true }); return;
  }
  if (pendingTerms.has(key)) return; // an open for this key is already in flight
  pendingTerms.add(key);
  try {
    await openTerminalTabInner(inst, ws, key, owns, notify, commitDestination);
  } finally {
    pendingTerms.delete(key);
  }
}

async function openTerminalTabInner(inst, ws, key, owns, notify = (msg) => alert(msg), commitDestination = () => true) {
  // inst is the RESOLVED roster instance (openTerminalTab resolves + keys
  // before dedup; review 7d740f9). Re-check ownership here — whenKeyFree
  // may have waited across a workspace switch.
  if (!owns()) return;
  const name = inst.instance;
  if (!canAddressRemote(inst)) return notify(rowReason(inst).sentence);
  if (!inst.running || (!inst.server && !inst.tmux?.session)) return notify(inst.runtimeError || `"${name}" has no live terminal session`);

  if (!commitDestination()) return notify('The terminal destination changed. Select the instance again.');
  const wrap = document.createElement("div");
  wrap.className = "term-wrap";

  const type = terminalTypography();
  const term = new Terminal(terminalOptions({
    fontSize: type.fontSize,
    fontFamily: type.fontFamily,
    theme: xtermTheme(),
  }));
  // live terminals follow app theme + persisted typography preferences
  const offTheme = onThemeChange(() => { term.options.theme = xtermTheme(); });
  const offTypography = onTerminalTypographyChange((next) => {
    term.options.fontFamily = next.fontFamily;
    term.options.fontSize = next.fontSize;
    requestAnimationFrame(() => { try { fitTerminal(term, fit); } catch {} });
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  // Box drawing and blocks as a native terminal draws them (WebGL, DOM fallback).
  const glyphs = createGlyphRenderer({ term, Addon: globalThis.WebglAddon?.WebglAddon,
    onChange: () => requestAnimationFrame(() => { try { fitTerminal(term, fit); } catch {} }) });

  // Composition (setup-inside-onReady, teardown symmetry) lives in
  // terminal-tab.mjs so its ordering is unit-testable (review termlc2).
  const tab = createTerminalTab({
    desk,
    term,
    tmux: inst.tmux,
    remote: inst.server ? { serverId: inst.server, instance: inst.instance, home: inst.home } : undefined,
    // A remote row's repoName is its server's registered label, else the server id.
    serverLabel: inst.server ? inst.repoName || inst.server : undefined,
    wrap,
    isActive: () => made.paneEl.classList.contains("active"),
    // Visibility is a fit concern, not permission to focus. Consult the
    // CURRENT explicit intent so re-focusing a pending retained tab works.
    ownsFocus: () => tabLayerVisible && activeTab === made.id
      && canActivateTab(tabs.get(made.id), currentWorkspace())
      && tabOpenIntents.ownsFocus(made.id),
    focusInput: () => tabOpenIntents.applyFocus(() => term.focus()),
    fit: () => fitTerminal(term, fit),
    // Terminal-allowlisted shortcuts (engine policy: app.palette, tabs.next/
    // prev/close, split.*, focus.leaveTerminal) must be intercepted BEFORE xterm
    // writes to the pty — its handler consumes e.g. Ctrl+Shift+P or ⌘⇧F6 and
    // stops propagation, so the bubble-phase window listener
    // never sees it. matchEvent applies the allowlist (insideTerminal);
    // the action runs once on keydown, and every phase of a matched chord
    // is claimed so no control byte leaks to the attached program.
    interceptKey: (ev) => {
      if (!matchEvent(ev, { insideTerminal: true })) return false;
      if (ev.type === "keydown") handleKeydown(ev, { insideTerminal: true });
      return true;
    },
  });

  const made = addTab({
    title: `${name}${inst.server ? ` · ${inst.server}` : ""}`,
    // Workspace v4 (W6): a terminal tab carries only its name and status; the branch lives in the bottom bar.
    // A shrunk tab keeps its name's end ("oats-…palette"); a host suffix gives way first.
    decor: { dot: inst.running ? "on" : "off", tailAt: tabNameTailStart(name, inst.agent), tailEnd: name.length },
    key,
    kind: "terminal",
    workspace: ws,
    instanceRef: inst,
    intent: owns,
    // Keep the pane/key while cleanup is pending or unconfirmed. Theme hooks
    // belong to the retained view and are removed only on confirmed disposal.
    confirmClose: () => tab.close(),
    onClose: () => { offTheme(); offTypography(); },
    onShow: () => { requestAnimationFrame(() => { try { glyphs.ensure(); fitTerminal(term, fit); } catch {} }); },
    // user-initiated activation → keyboard lands in the xterm textarea
    focusContent: () => tab.focus(),
    focusOnActivate: true, // addTab's own dedup here is a user jump too
  });
  if (!made) { offTheme(); offTypography(); term.dispose(); return; } // lost a race to an identical tab
  made.paneEl.append(wrap);
  term.open(wrap);
  glyphs.ensure();
  fitTerminal(term, fit);

  await tab.start();
}

// ── nav rail ──────────────────────────────────────────────────────────────
// First-class stage destinations come from shell-nav.mjs (NAV) so tests can
// prove every entry resolves to a real mount-exporting view. The permanent
// instance tree in the sidebar is the instances surface itself — selecting
// an instance opens its terminal; there is no separate Instances stage.
const navEl = document.getElementById("nav");
for (const v of NAV) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "nav-item";
  b.title = v.title;
  b.dataset.view = v.name;
  b.dataset.action = `stage.${v.name}`;
  b.innerHTML = `<span class="icon"></span><span class="label"></span>`;
  b.querySelector(".icon").innerHTML = shellIcon(v.icon);
  b.querySelector(".label").textContent = v.label;
  b.addEventListener("click", () => runAction(`stage.${v.name}`));
  navEl.append(b);
}

// Persistent footer controls use exactly the same registry as keyboard actions.
for (const button of document.querySelectorAll("#nav-foot [data-action]")) {
  button.addEventListener("click", () => runAction(button.dataset.action));
}

// This is a chooser entry, not a launch or an inspection preselection. Capture
// workspace visit + selection before import, and contain stale rejections too.
async function openWorkspaceSouls() {
  const selectionOwns = tabOpenIntents.begin();
  const owns = () => selectionOwns() && ![...document.querySelectorAll('[aria-modal="true"]')]
    .some(dialog => !dialog.closest("[hidden]"));
  let mod;
  try { mod = await import("./views/spawn.mjs"); }
  catch (e) {
    if (!owns()) return;
    ctx.notify(`Could not open Workspace Souls: ${e.message || e}`);
    return;
  }
  if (!owns()) return;
  mod.preselectWorkspaceTab("souls");
  showStage("spawn");
}

// ── command palette (⌘K): jump to an instance or run a command ─────────
const isMac = navigator.platform.includes("Mac");
const chordDetail = (id) => () => {
  const b = getBinding(id, isMac);
  return b ? formatChord(b, isMac) : "";
};
const palette = createPalette({
  loadInstances: async () => {
    if (windowState() === "choosing") return { instances: [], deployments: [] }; // no workspace: nothing to read (#481)
    const ws = currentWorkspace();
    const p = await api(`/api/panel${ws ? `?ws=${encodeURIComponent(ws)}` : ""}`);
    // One snapshot: the palette sections and clusters by these deployments, as the sidebar does.
    return { instances: p.instances || [], deployments: panelDeployments(p) };
  },
  openTerminal: (name) => openTerminalTab(name),
  // While open, ⌘K / Ctrl+Shift+P moves down and Shift + it up (live keymap); Esc closes, Enter opens.
  cycleKey: (e) => pickerCycleDirection(e, "app.palette", isMac),
  commands: [
    // View commands derive from the nav manifest so a new rail destination
    // can never be palette-invisible (review 8441961 nit).
    ...NAV.map((v) => ({ label: `View: ${v.label}`, detail: chordDetail(`stage.${v.name}`), run: () => showStageFocused(v.name) })),
    { label: "Spawn instance: choose a soul in Workspace…", detail: chordDetail("app.chooseSoul"), run: () => runAction("app.chooseSoul") },
    { label: "Souls: quick open…", detail: chordDetail("app.quickOpenSouls"), run: () => runAction("app.quickOpenSouls") },
    { label: "File: open read-only…", detail: chordDetail("app.openFile"), run: () => runAction("app.openFile") },
    { label: "Theme: cycle White / Solarized / Dark", detail: chordDetail("app.themeToggle"), run: () => toggleTheme() },
    ...THEMES.map(({ id, label }) => ({ label: `Theme: ${label}`, detail: chordDetail(`app.theme.${id}`), run: () => runAction(`app.theme.${id}`) })),
    { label: "Shortcuts: edit keyboard shortcuts…", detail: chordDetail("app.shortcuts"), run: () => openShortcutsEditor() },
    { label: "Settings: Connections…", detail: "GitHub CLI accounts on this machine", run: () => openConnections() },
    { label: "Workspace: switch…", detail: chordDetail("app.workspaces"), run: () => workspaceLabel.openMenu() },
    // One window per workspace (#481): on macOS also File → New Window ⌘⇧N; elsewhere no default chord.
    ...(typeof desktopBridge.windowOpenWorkspace === "function" ? [{ label: "Window: new window",
      detail: () => chordDetail("app.newWindow")() || (isMac ? formatChord("Mod+Shift+N", true) : ""), run: () => runAction("app.newWindow") }] : []),
    { label: "Instances: focus the sidebar roster", detail: chordDetail("sidebar.focusFilter"), run: () => focusRoster() },
    { label: "Sidebar: toggle (hide/show)", detail: chordDetail("sidebar.toggle"), run: () => toggleSidebar() },
    { label: "Instance panel: show / hide", detail: chordDetail("panel.toggle"), run: () => runAction("panel.toggle") },
    { label: "Focus mode: toggle", detail: chordDetail("app.focusMode"), run: () => runAction("app.focusMode") },
    { label: "Split: terminal right (side by side)", detail: chordDetail("split.vertical"), run: () => splitPane("row") },
    { label: "Split: terminal down (stacked)", detail: chordDetail("split.horizontal"), run: () => splitPane("col") },
    { label: "Split: return to terminal groups", detail: chordDetail("split.restore"), run: () => restoreTerminalGroups() },
    { label: "Split: close (back to single pane)", detail: chordDetail("split.close"), run: () => closeSplit() },
    { label: "Terminal: focus the active terminal input", detail: chordDetail("terminal.focusActive"), run: () => focusActiveTerminal() },
    { label: "Terminal: increase font size", detail: chordDetail("terminal.fontBigger"), run: () => setTerminalFontSize(terminalTypography().fontSize + 1) },
    { label: "Terminal: decrease font size", detail: chordDetail("terminal.fontSmaller"), run: () => setTerminalFontSize(terminalTypography().fontSize - 1) },
    { label: "Terminal: set font family…", run: () => {
      const current = terminalTypography().fontFamily;
      const next = window.prompt("Terminal font family (CSS font-family value)", current);
      if (next !== null) setTerminalFontFamily(next);
    } },
    { label: "Terminal: reset typography", detail: chordDetail("terminal.fontReset"), run: () => resetTerminalTypography() },
  ],
});

// ── Quick Open for souls (Mod+P): find a soul, open its spawn dialog ──
// Selection hands off to Workspace (preselectSpawn — consumed by the view's
// next roster paint): the spawn dialog scoped to that soul, exactly as its
// card's Spawn opens it. A soul that can't be spawned here (attached only,
// refused, no verified CLI) opens its page instead, which says why.
// Dismissing the dialog returns to where the operator was before Quick Open
// (surface-return.mjs). Terminal policy (documented): app.quickOpenSouls is
// NOT terminal-allowlisted — ⌘P fires inside xterm on macOS by the ⌘-chord
// policy, but Ctrl+P inside xterm on Linux/Windows belongs to the shell's history.
const quickOpen = createQuickOpen({
  loadSouls: async () => {
    const ws = currentWorkspace();
    return api(`/api/agents${ws ? `?ws=${encodeURIComponent(ws)}` : ""}`);
  },
  onPick: async (soul) => {
    // Capture before module loading: a new tab/stage/sidebar intent or an
    // A→B→A workspace visit must not turn this old callback into a new pick.
    const owns = tabOpenIntents.begin();
    // Where the operator was (the picker kept the control they opened it from).
    const origin = surfaceReturn.capture(takePickerFocusReturn(document));
    let mod;
    try { mod = await import("./views/spawn.mjs"); }
    catch (e) {
      if (!owns()) return;
      ctx.notify(`Could not open soul: ${e.message || e}`);
      return;
    }
    if (!owns()) return;
    mod.preselectSpawn({ ...soul, onDismiss: () => surfaceReturn.restore(origin) });
    showStage("spawn");
  },
});
// Both pickers contain workspace-scoped references. Close synchronously on
// every workspace visit; their own lifetimes discard late lists and row clicks.
onWorkspaceChange(() => {
  quickOpen.close();
  palette.close();
});

// ── shortcuts editor (rail-footer button + palette + Mod+,) ────────────
const shortcutsEditor = createKeybindingsEditor({ doc: document, isMac });
// Stored rebinds vs the effective keymap (spec F review): a clash is never resolved silently;
// the footer button carries a warn dot and a description until the operator rebinds or resets.
function markShortcutClashes() {
  const button = document.getElementById("sidebar-shortcuts");
  if (!button) return;
  const clashes = keymapConflicts(isMac).length;
  button.classList.toggle("has-clash", clashes > 0);
  if (clashes) button.setAttribute("aria-description", `${clashes === 1 ? "1 shortcut you set clashes" : `${clashes} shortcuts you set clash`} with another: open to review`);
  else button.removeAttribute("aria-description");
}
let clashCheckQueued = false;
onKeymapChange(() => {
  if (clashCheckQueued) return;
  clashCheckQueued = true;
  queueMicrotask(() => { clashCheckQueued = false; markShortcutClashes(); });
});
function openShortcutsEditor() { tabOpenIntents.invalidate(); lifecycleDialog.close(); connections.close(); shortcutsEditor.open(); }
const connections = createConnections({ doc: document, desk,
  request: body => api('/api/forge-connections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  subscribe: subscribeConnections, generation: () => connectionGeneration, openShortcuts: openShortcutsEditor,
  onIntent: () => tabOpenIntents.invalidate(), applyFocus: fn => tabOpenIntents.applyFocus(fn), captureFocus: () => tabOpenIntents.begin(),
  // Settings → Terminal: the font size stepper, on the keys' and the palette's own store.
  sections: [() => createTerminalSettings({ doc: document, chords: {
    bigger: chordDetail("terminal.fontBigger")(), smaller: chordDetail("terminal.fontSmaller")(), reset: chordDetail("terminal.fontReset")() } })],
  terminalFactory: mount => {
    const term = new Terminal({ ...terminalOptions({ ...terminalTypography(), theme: xtermTheme() }), scrollback: 200, allowProposedApi: false });
    const fit = new FitAddon.FitAddon(); term.loadAddon(fit); term.open(mount);
    const offTheme = onThemeChange(() => { term.options.theme = xtermTheme(); });
    const offType = onTerminalTypographyChange(value => { term.options.fontSize = value.fontSize; term.options.fontFamily = value.fontFamily; });
    const observers = new Set();
    return {
      get cols() { return term.cols; }, get rows() { return term.rows; },
      write: value => term.write(value), focus: () => term.focus(), fit: () => fit.fit(),
      onData: fn => term.onData(fn), setKeyHandler: fn => term.attachCustomKeyEventHandler(fn),
      onResize: fn => { const observer = new ResizeObserver(fn); observers.add(observer); observer.observe(mount);
        return { dispose: () => { observer.disconnect(); observers.delete(observer); } }; },
      dispose: () => { for (const observer of observers) observer.disconnect(); offTheme(); offType(); term.dispose(); },
    };
  },
});
function openConnections(choice = {}) { tabOpenIntents.invalidate(); lifecycleDialog.close(); shortcutsEditor.close(); connections.open(choice); }
window.addEventListener('pagehide', () => connections.dispose(), { once: true });
const lifecycleDialog = createLifecycleDialog({ doc: document,
  request: async (workspace, body) => {
    const response = await desk.api(`/api/instance-lifecycle?ws=${encodeURIComponent(workspace)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return response.body; // retain typed unknown outcomes even on proxy transport failures
  },
  gitRequest: (workspace, body) => api(`/api/instance-git?ws=${encodeURIComponent(workspace)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }),
  forgeRequest: (workspace, body) => api(`/api/instance-forge?ws=${encodeURIComponent(workspace)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }),
  generation: workspaceGeneration, subscribeWorkspace: onWorkspaceChange,
  subscribeConnections, connectionGeneration: () => connectionGeneration,
  onIntent: () => tabOpenIntents.invalidate(), applyFocus: fn => tabOpenIntents.applyFocus(fn),
  onSettled: () => { void refreshContextRoster(); }, openExternal: ctx.openExternal,
});
function openLifecycleDialog(operation, instance, workspace) {
  connections.close(); shortcutsEditor.close();
  // The callers check the workspace on screen (`workspace`); the plan and apply are addressed to the
  // row's own deployment (#482), which the server's echoed target names too.
  void workspace;
  lifecycleDialog.open({ operation, instance, workspace: rowDeployment(instance) });
}
window.addEventListener('pagehide', () => lifecycleDialog.dispose(), { once: true });

function focusRoster() {
  tabOpenIntents.invalidate(); // also when the filter already has DOM focus
  contextPanel.setFocusMode(false);
  setSidebarHidden(false); // a filter shortcut must not focus display:none content
  contextRosterEl?.querySelector(".ctx-filter")?.focus({ preventScroll: true });
}

// ── hideable sidebar: full-width terminals on demand ───────────────────
// Class-driven (display:flex on #sidebar beats the hidden attribute) and
// persisted like the other shell prefs. Terminal refits ride each tab's
// ResizeObserver — the panes change width when the sidebar goes away.
const SIDEBAR_HIDDEN_KEY = "oats-desktop-sidebar-hidden";
function sidebarHidden() {
  return document.getElementById("app").classList.contains("sidebar-hidden");
}
function updateSidebarControls() {
  const visible = !sidebarHidden() && !contextPanel.isFocusMode();
  for (const id of ["sidebar-toggle", "sidebar-restore"]) {
    document.getElementById(id).setAttribute("aria-expanded", String(visible));
  }
}
function setSidebarHidden(on) {
  document.getElementById("app").classList.toggle("sidebar-hidden", on);
  updateSidebarControls();
  // Hiding by mouse or keyboard must not strand focus in display:none.
  if (on && document.getElementById("sidebar").contains(document.activeElement)) {
    document.getElementById("sidebar-restore").focus();
  } else if (!on && document.activeElement === document.getElementById("sidebar-restore")) {
    document.getElementById("sidebar-toggle").focus();
  }
  try {
    if (on) localStorage.setItem(SIDEBAR_HIDDEN_KEY, "1");
    else localStorage.removeItem(SIDEBAR_HIDDEN_KEY);
  } catch { /* storage-less */ }
}
function toggleSidebar() {
  if (contextPanel.isFocusMode()) { contextPanel.setFocusMode(false); setSidebarHidden(false); }
  else setSidebarHidden(!sidebarHidden());
}
// Restore-by-mouse must exist while the sidebar is hidden: a thin edge
// button (CSS shows it only under #app.sidebar-hidden) runs the SAME
// sidebar.toggle action as the chord/palette/rail-footer button.
document.getElementById("sidebar-restore").addEventListener("click", () => runAction("sidebar.toggle"));
try { if (localStorage.getItem(SIDEBAR_HIDDEN_KEY) === "1") setSidebarHidden(true); } catch { /* storage-less */ }

/** Focus the ACTIVE terminal tab's xterm input from anywhere in the shell
 * (explicit action — rebindable, editor-visible). No default chord: every
 * safe candidate is taken or terminal-hostile (any Ctrl chord belongs to
 * the pty on Linux/Windows; plain keys are guarded off editables) — users
 * who want one bind it in the shortcuts editor. */
function focusActiveTerminal() {
  const t = activeTab != null ? tabs.get(activeTab) : null;
  if (t?.kind === "terminal") selectTab(activeTab, { focusContent: true });
}

function visibleTabEntries() {
  return [...tabs].filter(([, t]) => !t.tabEl.hidden);
}

/** A keyboard tab switch keeps focus where the operator works: in the content (a terminal's
 * input) when it was in a tab's content or nowhere, on the new tab when it was on the strip. */
function switchTab(id) {
  const active = document.activeElement;
  const inContent = tabhost.contains(active) || !active || active === document.body;
  if (!selectTab(id, { focusContent: inContent })) return;
  if (!inContent && tabbar.contains(active)) tabs.get(id)?.triggerEl.focus();
}

function cycleTab(delta) {
  const vis = visibleTabEntries();
  if (!vis.length) return;
  const at = Math.max(0, vis.findIndex(([tid]) => tid === activeTab));
  const [nextId] = vis[(at + delta + vis.length) % vis.length];
  switchTab(nextId);
}

/** Go to tab n (1-based) of the visible strip; 9 is the last tab, as in browsers. */
function gotoTab(n) {
  const vis = visibleTabEntries();
  if (!vis.length) return;
  const [id] = n >= 9 ? vis.at(-1) : vis[n - 1] ?? [];
  if (id != null) switchTab(id);
}

// ── keyboard regions (F6 / Shift+F6) and "back to where you were" ──────
// focus-regions.mjs owns the order and each region's current item; the
// shell supplies the active tab's content (a terminal focuses through its
// selection intent, like every explicit terminal focus).
function focusMainContent() {
  if (activeTab == null) {
    const empty = tabhost.querySelector(".focused-group > .split-empty");
    if (empty) tabOpenIntents.applyFocus(() => empty.focus());
    return !!empty && document.activeElement === empty;
  }
  const t = tabs.get(activeTab);
  if (!t) return false;
  if (t.focusContent) { selectTab(activeTab, { focusContent: true }); return t.paneEl.contains(document.activeElement); }
  const first = firstTabbable(t.paneEl);
  if (first) tabOpenIntents.applyFocus(() => first.focus());
  return !!first && document.activeElement === first;
}
const focusRegions = createFocusRegions({ doc: document, tabLayerVisible: () => tabLayerVisible, focusMainContent });
/** A modal (a dialog, the palette) keeps focus inside itself: regions don't cycle out of it. */
const modalOpen = () => [...document.querySelectorAll('[aria-modal="true"]')].some(dialog => isShown(dialog));
function cycleRegion(delta) {
  if (modalOpen()) return;
  tabOpenIntents.invalidate();
  focusRegions.cycle(delta);
}
const surfaceReturn = createSurfaceReturn({ doc: document, currentWorkspace, workspaceGeneration,
  surface: () => ({ stage: stage?.name ?? null, tab: activeTab, tabLayerVisible }),
  tabPane: id => { const t = tabs.get(id); return t && canActivateTab(t, currentWorkspace()) ? t.paneEl : null; },
  showStage, selectTab: (id, opts) => selectTab(id, opts), focusRegion: name => focusRegions.focusRegion(name), host: "spawn" });

// ── action registry: every mouse affordance, one keyboard action ────────
// Default chords live in the engine's DEFAULT_KEYMAP (keybindings.mjs);
// user overrides persist in localStorage via the shortcuts editor.
for (const [id, action, label] of [['instance.openSplit', 'open-split', 'Instance menu: Open in split'], ['instance.openPullRequest', 'open-pr', 'Instance menu: Open pull request']]) {
  registerAction({ id, label, context: 'instance-menu', run: () => {
    const menu = activeInstanceMenu;
    if (menu?.owns() && menu.element.isConnected && menu.element.dataset.instanceMenuOpen === 'true' && menu.element.contains(document.activeElement)) void menu.run(action);
  } }); // no new default chord, especially no terminal Ctrl interception
}
registerAction({ id: "app.palette", label: "Open the command palette", context: "global", run: () => { tabOpenIntents.invalidate(); palette.toggle(); } });
registerAction({ id: "app.quickOpenSouls", label: "Quick open a soul to spawn", context: "global", run: () => { tabOpenIntents.invalidate(); quickOpen.toggle(); } });
registerAction({ id: "app.chooseSoul", label: "Spawn instance: choose a soul in Workspace", context: "global", run: () => openWorkspaceSouls() });
registerAction({ id: "app.shortcuts", label: "Edit keyboard shortcuts", context: "global", run: () => openShortcutsEditor() });
registerAction({ id: "app.connections", label: "Settings: Connections", context: "global", run: () => openConnections() });
// A window with no workspace, showing the switcher (#481). No default chord: Ctrl+Shift+N stays Choose soul.
if (typeof desktopBridge.windowOpenWorkspace === "function") {
  registerAction({ id: "app.newWindow", label: "Window: new window", context: "global", run: () => { void desktopBridge.windowOpenWorkspace(null); } });
}
const unregisterOpenFile = registerAction({ id: "app.openFile", label: "File: open read-only…", context: "global", defaultChord: "Mod+O", run: () => fileOpener.choose() });
window.addEventListener("pagehide", () => { tabOpenIntents.invalidate(); unregisterOpenFile(); fileOpener.dispose(); }, { once: true });
// stage-switch actions derive from the nav manifest (same rule as the
// palette): a new rail destination can never be shortcut-invisible.
NAV.forEach((v) => registerAction({
  id: `stage.${v.name}`, label: `View: ${v.label}`, context: "global",
  run: () => showStageFocused(v.name),
}));
registerAction({ id: "app.themeToggle", label: "Cycle White / Solarized / Dark theme", context: "global", run: () => toggleTheme() });
// Explicit theme choices are rebindable, but add no default keyboard chords.
THEMES.forEach(({ id, label }) => registerAction({
  id: `app.theme.${id}`, label: `Theme: ${label}`, context: "global", run: () => setTheme(id),
}));
registerAction({ id: "app.workspaces", label: "Open the workspace switcher", context: "global", run: () => workspaceLabel.openMenu() });
registerAction({ id: "sidebar.focusFilter", label: "Focus the instance roster filter", context: "global", run: () => focusRoster() });
registerAction({ id: "sidebar.toggle", label: "Toggle the sidebar", context: "global", run: () => toggleSidebar() });
registerAction({ id: "panel.toggle", label: "Show or hide the instance panel", context: "global", run: () => { tabOpenIntents.invalidate(); contextPanel.toggle(); } });
// Focus mode lives on the keyboard (rebindable, no default chord) and the palette.
registerAction({ id: "app.focusMode", label: "Toggle focus mode (sidebar and instance panel)", context: "global", run: () => { tabOpenIntents.invalidate(); contextPanel.toggleFocusMode(); } });
// splits live on the tab layer (they arrange terminal tabs); the actions
// are terminal-allowlisted so the chords work inside xterm too.
registerAction({ id: "split.vertical", label: "Split terminal right (side by side)", context: "tabs", run: () => splitPane("row") });
registerAction({ id: "split.horizontal", label: "Split terminal down (stacked)", context: "tabs", run: () => splitPane("col") });
registerAction({ id: "split.close", label: "Close the split (single pane)", context: "tabs", run: () => closeSplit() });
// Recovery must also work from the stage. No new default keyboard binding.
registerAction({ id: "split.restore", label: "Return to terminal groups", context: "global", run: () => restoreTerminalGroups() });
// No defaultChord (documented): safe candidates are exhausted — rebindable in the editor.
registerAction({ id: "terminal.focusActive", label: "Focus the active terminal input", context: "global", run: () => focusActiveTerminal() });
registerAction({ id: "terminal.fontBigger", label: "Terminal: increase font size", context: "global", run: () => setTerminalFontSize(terminalTypography().fontSize + 1) });
registerAction({ id: "terminal.fontSmaller", label: "Terminal: decrease font size", context: "global", run: () => setTerminalFontSize(terminalTypography().fontSize - 1) });
registerAction({ id: "terminal.fontReset", label: "Terminal: reset typography", context: "global", run: () => resetTerminalTypography() });
// tabs: cycle + close work whether or not a tab trigger has focus (the
// tab-a11y roving arrows stay as focus keys on the strip itself). Tab switching
// never happens under an open modal (the palette, a sheet, a dialog), as F6 doesn't.
const unlessModal = (fn) => () => { if (!modalOpen()) fn(); };
registerAction({ id: "tabs.next", label: "Next tab", context: "tabs", run: unlessModal(() => cycleTab(1)) });
registerAction({ id: "tabs.prev", label: "Previous tab", context: "tabs", run: unlessModal(() => cycleTab(-1)) });
registerAction({ id: "tabs.close", label: "Close the active tab", context: "tabs", run: () => { if (activeTab != null) closeTab(activeTab, true); } });
// Second chords for tab cycling (Ctrl+PgDn / Ctrl+PgUp on Linux and Windows): their own ids,
// so each stays rebindable and unbindable on its own. Neither fires inside a terminal.
registerAction({ id: "tabs.nextPage", label: "Next tab (second shortcut)", context: "tabs", run: unlessModal(() => cycleTab(1)) });
registerAction({ id: "tabs.prevPage", label: "Previous tab (second shortcut)", context: "tabs", run: unlessModal(() => cycleTab(-1)) });
for (let n = 1; n <= 9; n++) {
  registerAction({ id: `tabs.goto${n}`, label: n === 9 ? "Go to the last tab" : `Go to tab ${n}`, context: "tabs", run: unlessModal(() => gotoTab(n)) });
}
// Regions: sidebar nav → instance roster → main → instance panel (focus-regions.mjs).
registerAction({ id: "focus.nextRegion", label: "Focus the next region (sidebar, instances, main, panel)", context: "global", run: () => cycleRegion(1) });
registerAction({ id: "focus.prevRegion", label: "Focus the previous region", context: "global", run: () => cycleRegion(-1) });
// F6 stays the program's inside a terminal (mc, htop, nano): this terminal-allowlisted chord
// leaves it for the next region, same order as F6; from there plain F6 works.
registerAction({ id: "focus.leaveTerminal", label: "Leave the terminal (focus the next region)", context: "global", run: () => cycleRegion(1) });

// THE one window keydown listener. The engine owns the terminal policy
// (⌘ chords on mac; the action-id allowlist on Linux/Windows, where the
// allowlisted defaults are Ctrl+Shift+key so plain Ctrl+letter stays the
// program's). View-local handlers (hierarchy canvas,
// roster rows, palette input) preventDefault the keys they consume; the
// engine must not double-dispatch them.
// The engine skips already-consumed (defaultPrevented) events itself.
window.addEventListener("keydown", (e) => handleKeydown(e));

// Chord-suffixed tooltips, live against the keymap: any control that
// declares data-action gets “ … (chord)” appended to its base title.
const baseTitles = new WeakMap();
function applyChordTitles() {
  const themeButton = document.getElementById("sidebar-theme");
  if (themeButton) {
    const label = "Cycle White / Solarized / Dark theme";
    baseTitles.set(themeButton, label); themeButton.setAttribute("aria-label", label);
  }
  for (const el of document.querySelectorAll("[data-action]")) {
    if (!baseTitles.has(el)) baseTitles.set(el, el.title || "");
    const chord = getBinding(el.dataset.action, isMac);
    const base = baseTitles.get(el);
    el.title = chord ? `${base} (${formatChord(chord, isMac)})` : base;
  }
  for (const el of document.querySelectorAll("[data-shortcut]")) {
    const chord = getBinding(el.dataset.shortcut, isMac);
    el.textContent = chord ? formatChord(chord, isMac) : "";
    el.hidden = !chord;
  }
}
onKeymapChange(() => applyChordTitles());
applyChordTitles();

// Persistent recursive instance tree: always available below the three nav
// surfaces, with no second/contextual sidebar and no width jump.
initContextRoster();
onWorkspaceChange(restoreWorkspaceTabs);
function restoreWorkspaceTabs() {
  contextRosterGen++;
  brainIntents.invalidate();
  tabOpenIntents.invalidate();
  workspaceLabel.reset();
  workspaceTabMemory.remember(tabWorkspace, { split, activeTab, sidebarMode, tabLayerVisible });
  // Hide synchronously and park ALL nodes before replacing group identities.
  // Workspace-local group ids can overlap; deleting old cells first would
  // otherwise orphan their retained tabs/panes (and live terminals).
  showTabLayer(false);
  renderSplit(false);
  tabWorkspace = currentWorkspace();
  const restored = workspaceTabMemory.recall(tabWorkspace, tabs);
  split = restored.split;
  contextInstances = [];
  contextWorkspace = tabWorkspace;
  // A new subject: forget the data, the stale mark and the painted signature.
  // The list clears into pending (a skeleton pill for the count); the rows of
  // the new workspace arrive with the refresh below, never "No instances".
  rosterState?.reset();
  rosterStale = false; rosterSignaturePainted = null; contextDeploymentNote = null; contextDeployments = [];
  renderContextRoster([]);
  if (restored.tabLayerVisible) {
    setSidebarMode(restored.sidebarMode);
    activateTab(restored.activeTab, { keepGroupFocus: true });
  } else {
    setSidebarMode(stageSidebarMode(stage?.name));
    setNavActive(stage?.name || "hierarchy");
  }
  updateContextTabs();
  refreshContextRoster();
}
/** Workspace views (#482): per-workspace state saved under a deployment id — a selection from before
 * views, an unattached deployment that has matched a workspace since — or under a view id the server
 * no longer serves moves to the view that holds that deployment now, and an open terminal follows its
 * instance's deployment (a remote that reports another workspace). Open tabs (workspace and key), the
 * active-terminal and layout memories, collapsed rows and spawn jobs move together; nothing is
 * dropped (workspace-rehome.mjs). Runs for every served list a roster read brings. */
function rehomeWorkspaceState(workspaces) {
  if (!Array.isArray(workspaces) || !workspaces.length) return;
  const map = rehomeMap(workspaces, viewMembership);
  viewMembership.note(workspaces);
  const moves = rehomeTabs(tabs, map, workspaces);
  if (!map.size && !moves.length) return;
  rehomeActiveTerminals(wsActiveTerminal, map, moves);
  workspaceTabMemory.rehome(map);
  rehomeCollapsed(collapsedInstances, map);
  spawnJobs.rehome(map);
  if (map.has(tabWorkspace)) tabWorkspace = map.get(tabWorkspace);
  if (map.has(contextWorkspace)) contextWorkspace = map.get(contextWorkspace);
  if (!moves.length) return;
  // A terminal whose deployment moved to another view leaves this window's layout (it opens there).
  const shown = currentWorkspace(), leaving = moves.filter((m) => m.from === shown && m.to !== shown);
  for (const { id } of leaving) split = removeSplitTab(split, id).split;
  updateContextTabs();
  if (!leaving.length || !tabLayerVisible) return;
  if (leaving.some((m) => m.id === activeTab)) showTerminalContext();
  else if (activeTab != null) activateTab(activeTab, { keepGroupFocus: true });
}
// One background read at a time: a slow or unanswered read is not superseded every 4 s, so its outcome
// is always someone's to show; the bounded wait has its own timer (rosterPendingWatch). A switch or a
// Retry reads at once, as before. A new connection replaces the poll's read at once: the old read's
// outcome is revoked (contextRosterGen) and the new subject's deadline is armed at its dispatch, so
// neither waits for the old read to settle; only the newest poll clears the slot.
// An unfocused window polls at the server's blurred cadence (roster-cadence.mjs, #481); focus reads at once.
let rosterPoll = null, rosterPolledAt = 0;
function pollContextRoster() {
  rosterPolledAt = Date.now();
  const poll = rosterPoll = refreshContextRoster().finally(() => { if (rosterPoll === poll) rosterPoll = null; });
}
setInterval(() => {
  if (!rosterPoll && rosterPollDue({ focused: document.hasFocus(), last: rosterPolledAt, now: Date.now() })) pollContextRoster();
}, ROSTER_POLL_FOCUSED_MS);
window.addEventListener("focus", () => { if (!rosterPoll) pollContextRoster(); });
subscribeConnections(() => { if (contextRosterEl) pollContextRoster(); });

// Contract re-probe triggers: launch (initial refresh) and app focus. The
// cli-status module owns the shared state; the Spawn view (and any future
// mutation surface) subscribes for consistent enable/disable.
import("./views/cli-status.mjs").then(({ refreshCli, reprobeCli }) => {
  refreshCli(ctx);
  desk.onAppFocus?.(() => reprobeCli(ctx));
});

// Home surface: the agent hierarchy — running instances and how they relate.
showStage("hierarchy");
