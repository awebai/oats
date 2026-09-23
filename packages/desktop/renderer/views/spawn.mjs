/* OATS Desktop — Workspace discovery (legacy stage id: spawn).
   Souls remain durable definitions; Launch explicitly opens the Spawn modal.
   Capabilities/Sources project only the current CLI inspection contract.
   API2 observations stay read-only; advanced choices enter only server-owned
   confirmed CLI intents, never legacy submission. Resolution stays CLI-owned.
   Contract: mount(el, ctx) / unmount(). Plain ES module + DOM. */
import { createSoulInspector, inspectorCSS } from "../soul-inspector.mjs";
import { createWorkspaceDiscovery, discoveryCSS, workspaceTabs } from "../workspace-discovery.mjs";
import { runtimeState } from "../instance-presentation.mjs";
import { composeSpawnDialog, spawnDialogCSS } from "../spawn-dialog.mjs";
import { createSpawnLaunch } from "../spawn-launch.mjs";
import { createSpawnPreview } from '../spawn-preview-view.mjs';
import { createSpawnApply } from '../spawn-apply-view.mjs';
import { createSoulMark, createRuntimeBadge, identityCSS } from "../identity-marks.mjs";
import {
  escapeHtml, apiJson, postJson, ensureTheme,
  currentWorkspace, setWorkspace, onWorkspaceChange, wsQuery, workspaceGeneration,
} from "./common.mjs";
import { registerAction, getBinding, formatChord, onKeymapChange } from "../keybindings.mjs";
import { resolveViewKey } from "../view-keys.mjs";
import { cliAvailable, cliKnownUnavailable, cliStatus, refreshCli, onCliChange, cliCard, cliRelationsAvailable } from "./cli-status.mjs";
import { distinguishingRootTags } from "../instance-tree.mjs";
import { preselectSchedule } from "./schedules.mjs";
import { wakeScheduleFields } from "../wake-schedule-fields.mjs";

/** Required-version label for the disabled relation note. The floor is the
 * LOCATOR's (RELATIONS_MIN, served as `relationsMin`); restating a number here
 * is the drift class that once had the CLI card advertising a version below
 * the floor it required. A backend that did not send one leaves us genuinely
 * not knowing it, and the note says so rather than naming a guess. */
function relationsMinLabel() {
  const min = cliStatus()?.relationsMin;
  return typeof min === "string" && min ? min : null;
}

/** True while the CLI probe has never SETTLED (no response classified yet).
 * Pending is card-less by design, so disabled buttons must explain
 * themselves — and the poll must keep retrying until a response lands. */
const cliProbePending = () => !cliStatus() && !cliKnownUnavailable();

const CSS = `
.souls { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width:0; background: var(--bg); }
.souls-bar { display:flex; align-items:center; flex-wrap:wrap; gap:4px 8px; margin-left:auto; min-width:0; flex:0 1 180px; }
.souls-bar label { display:flex; min-width:0; width:100%; }
.souls-bar .filter { width:100%; min-width:0; }
.workspace-header .wssel { max-width:100%; min-width:0; flex:0 1 140px; }
.souls-sum { color:var(--muted); font-size:12px; }
.workspace-recovery { flex:none; min-width:0; padding:18px 20px; }
.workspace-recovery[hidden] { display:none; }
/* Counts are already in the Souls tab. Keep the full filter/CLI status for
   assistive tech, without another permanent row above the canvas. */
.workspace-sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
.souls-grid { flex:1; min-height:0; min-width:0; overflow-y:auto; padding:18px 20px; display:grid; gap:12px;
              grid-template-columns:repeat(auto-fill, minmax(min(230px, 100%), 1fr)); align-content:start; }
.soul-card { background: var(--surface); border: 1px solid var(--border); border-radius:10px; min-width:0; overflow-wrap:anywhere;
             padding:16px; cursor:pointer; display: flex; flex-direction: column; gap:10px;
             text-align: left; font: inherit; color: var(--fg); }
.soul-card:hover { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }
.soul-card.attached { border-style: dashed; background: var(--surface-2); }
.soul-card.open { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); }
.soul-card .sname { font-weight:650; font-size:13.5px; display:flex; align-items:flex-start; gap:10px; }
.soul-card .sidentity { display:flex; flex-direction:column; gap:1px; min-width:0; flex:1; }
.soul-card .stitle { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.soul-card .sruntime { flex:none; width:18px; height:18px; border-radius:5px; display:grid; place-items:center; font-size:9px; font-weight:700; }
.soul-card .scontext { color:var(--muted); font:11px var(--mono,monospace); }
.soul-card .sname .glyph { width:36px; height:36px; flex:none; border-radius:9px; display:grid; place-items:center; font-size:15px; }
.oats-view .souls button.spawn-act:not(:disabled), .oats-view .souls button.fspawn:not(:disabled) { background:var(--primary-bg); color:var(--primary-fg); border-color:var(--primary-bg); }
.soul-card .sactivity { display:flex; align-items:center; gap:6px; margin-top:auto; color:var(--muted); font-size:11.5px; font-weight:600; }
.soul-card .sactivity::before { content:""; flex:none; width:6px; height:6px; border-radius:50%; background:var(--muted); }
.soul-card .sactivity.running { color:var(--accent); }
.soul-card .sactivity.running::before { background:var(--accent); }
.souls-grid[hidden] { display:none; }
.soul-card .sdesc { color:var(--muted); font-size:12px; line-height:1.5; text-wrap:pretty; flex:1; }
.soul-form { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; }
.soul-form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
.soul-form .frow { display: flex; gap: 8px; align-items: center; }
.soul-form .fstatus { font-size: 12.5px; color: var(--muted); }
.soul-form .fstatus.err { color: var(--danger); }
.spawn-modal { position: fixed; z-index: 100; inset: 0; display: grid; place-items: center; padding: 24px;
               background: color-mix(in srgb, var(--bg) 60%, transparent); }
.spawn-dialog { width: min(520px, 100%); max-height: min(680px, calc(100vh - 48px)); display: flex;
                flex-direction: column; gap: 10px; overflow-y: auto; background: var(--surface);
                border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow);
                padding: 16px 18px; }
.spawn-dialog-head { display: flex; align-items: flex-start; gap: 8px; }
.spawn-dialog-head h2 { margin: 0; font-size: 16px; line-height: 1.3; flex: 1; }
.spawn-dialog-head .sdesc { color: var(--muted); font-size: 12.5px; }
.spawn-dialog .close-act { margin-left: auto; width: 28px; height: 28px; border: 0; border-radius: 6px;
                           background: none; color: var(--muted); font-size: 16px; cursor: pointer; }
.spawn-dialog .close-act:hover { background: var(--surface-2); color: var(--fg); }
.spawn-dialog .frelnote { font-size: 12px; color: var(--muted); }
.spawn-dialog fieldset.frelgroup { border: 1px solid var(--border); border-radius: 8px; margin: 0;
                                   padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 8px; }
.spawn-dialog fieldset.frelgroup legend { font-size: 12px; color: var(--muted); padding: 0 4px; }
.spawn-dialog .frelrow { display: flex; gap: 8px; align-items: center; }
.spawn-dialog .frelrow .frelation { flex: 0 1 auto; }
.spawn-dialog .frelrow .frelto { flex: 1 1 auto; min-width: 0; }
.spawn-dialog .freldesc { font-size: 12px; color: var(--muted); min-height: 0; }
.spawn-dialog .freldesc:empty { display: none; }
`;

let state = null;

/* Quick Open selects a soul for inspection; launch remains explicit. */
let pendingPreselect = null;
let pendingHome = null;
let pendingWorkspaceTab = null;
// Selection handoffs compete with each other, NOT with the roster request
// that supplies their data. Explicit tabs (including reselecting Souls) win
// over any older soul/home waiting for that roster.
let selectionIntent = 0;
function nextSelectionIntent() {
  // A newer choice in an already-mounted Workspace must also supersede a
  // shell/footer handoff still waiting on its module import. Shell handoffs
  // check their ticket before entering here; never mint a fresh ticket on
  // behalf of an arrival that has already lost foreground ownership.
  if (state?.alive) state.ctx.onSelectionIntent?.();
  return { intent: ++selectionIntent, gen: workspaceGeneration() };
}
function ownsSelection(s, ref) {
  return s.alive && ref.gen === workspaceGeneration() && ref.intent === selectionIntent;
}
/** Shell footer navigation is an inspection intent, never a launch. */
export function preselectWorkspaceTab(name) {
  if (!workspaceTabs.includes(name)) return false;
  pendingWorkspaceTab = { name, ...nextSelectionIntent() };
  if (state?.alive) applyWorkspaceTab(state);
  return true;
}
function applyWorkspaceTab(s) {
  if (!pendingWorkspaceTab) return;
  const intent = pendingWorkspaceTab; pendingWorkspaceTab = null;
  if (ownsSelection(s, intent)) s.discovery?.setTab(intent.name);
}
export function preselectHome(instance) {
  const intent = nextSelectionIntent();
  pendingWorkspaceTab = { name: "souls", ...intent };
  pendingHome = { home: instance.home, server: instance.server, ...intent };
  if (state?.alive) { applyWorkspaceTab(state); applyHome(state); }
}
function applyHome(s) {
  if (!pendingHome) return;
  if (!ownsSelection(s, pendingHome)) { pendingHome = null; return; }
  if (s.rosterGen !== workspaceGeneration()) return;
  const candidates = s.panelInstances.filter(i => i.home === pendingHome.home && (i.server || "") === (pendingHome.server || ""));
  const instance = candidates.length === 1 ? candidates[0] : null;
  pendingHome = null;
  if (instance) s.inspector?.show({ instance, selector: { home: instance.home } });
}
function inspectSoul(s, agent, intent = nextSelectionIntent()) {
  if (!ownsSelection(s, intent)) return;
  s.discovery?.setTab("souls");
  s.inspectRef = { name: agent.name, agentsRoot: agent.agentsRoot, server: agent.server };
  renderGrid(s);
  s.inspector?.show({ agent, selector: { soul: agent.name, agentsRoot: agent.agentsRoot } });
}

export function preselectSoul(ref) {
  const intent = nextSelectionIntent();
  pendingWorkspaceTab = { name: "souls", ...intent };
  pendingPreselect = ref && ref.name
    ? { name: String(ref.name), agentsRoot: ref.agentsRoot, server: ref.server, ...intent }
    : null;
  // Already mounted with a current roster: apply on the spot, including an
  // empty roster (a no-match is consumed once, never resurrected by polling).
  if (state?.alive) { applyWorkspaceTab(state); applyPreselect(state); }
}

function applyPreselect(s) {
  if (!pendingPreselect) return;
  // A workspace switch OR newer selection supersedes this handoff.
  if (!ownsSelection(s, pendingPreselect)) { pendingPreselect = null; return; }
  // stale roster: s.souls still holds a previous workspace's agents while
  // the current refresh is pending — do NOT consume; the refresh that
  // paints the current workspace's roster calls back here (review 6d5e183)
  if (s.rosterGen !== workspaceGeneration()) return;
  const ref = pendingPreselect;
  pendingPreselect = null; // consumed-once, match or not
  const matches = s.souls.agents.filter((x) => x.name === ref.name
    && (!ref.agentsRoot || x.agentsRoot === ref.agentsRoot) && (!ref.server || x.server === ref.server));
  if (matches.length !== 1) return; // an incomplete identity must not pick a twin
  const a = matches[0];
  inspectSoul(s, a, ref);
  // Degraded / attached souls still select for details; their inspector
  // actions and diagnostic status explain availability. An
  // active filter may exclude the selected soul's card: reveal it by
  // clearing the filter before focusing (review 6d5e183 — a consumed
  // preselect must never be a silent no-op for a soul that exists).
  let card = [...(s.q("souls-grid").querySelectorAll?.("[data-agent]") || [])]
    .find((c) => cardMatches(c, a));
  if (!card && s.filterText) {
    s.filterText = "";
    const filterEl = s.q("filter");
    if (filterEl) filterEl.value = "";
    renderGrid(s);
    card = [...(s.q("souls-grid").querySelectorAll?.("[data-agent]") || [])]
      .find((c) => cardMatches(c, a));
  }
  if (canFocusCard(s, card)) { card.tabIndex = 0; card.focus?.({ preventScroll: true }); }
}

export function mount(el, ctx) {
  ensureTheme(el.ownerDocument);
  const s = state = { el, ctx, souls: { agents: [] }, panelInstances: [], filterText: "", sel: null, timers: [], unsubWs: null, alive: true, spawnOp: 0, rosterReq: 0, rosterGen: null };
  el.innerHTML = `
    <div class="oats-view" style="display:block">
      <style>${CSS}
${inspectorCSS}
${discoveryCSS}
${identityCSS}
${spawnDialogCSS}</style>
      <div class="souls">
        <div class="souls-body">
          <section class="workspace-main" aria-label="Workspace discovery">
            <header class="workspace-header"></header>
            <div class="souls-bar">
              <select class="field wssel" aria-label="Workspace" style="display:none"></select>
              <label><span class="workspace-sr-only">Search souls</span><input class="field filter" type="search" placeholder="Filter souls…" autocomplete="off"></label>
              <span class="souls-sum workspace-sr-only" role="status"></span>
            </div>
            <div class="workspace-recovery" hidden></div>
            <div class="souls-grid"><div class="loading-block"><span class="spinner"></span> Loading souls…</div></div>
            <section class="workspace-discovery" hidden></section>
          </section>
          <aside id="workspace-inspector" class="soul-inspector" aria-label="Soul and capability details" hidden></aside>
        </div>
      </div>
    </div>`;
  s.q = (cls) => el.querySelector("." + cls);
  // Move the actual node, never a copied projection: Workspace still owns all
  // requests, callbacks and unsaved form state. The optional shell host owns
  // presentation only and supplies an .oats-view wrapper for shared styles.
  const inspectorElement = s.q("soul-inspector");
  s.presentation = ctx.rightPanel?.attach(inspectorElement);
  s.presentation?.setPresent(false); // no selected content at mount
  s.inspector = createSoulInspector(inspectorElement, {
    ctx, presentation: s.presentation, launch: agent => { if (cliAvailable()) openSpawnModal(s, agent); },
    canLaunch: agent => canLaunchSoul(s, agent),
    launchReason: () => cliProbePending() ? "Checking for a compatible oats CLI — spawning enables once it is verified" : "Requires a compatible installed OATS CLI and a current standalone soul.",
    available: () => cliAvailable() && cliStatus()?.operationsApi === 1 && cliStatus()?.features?.includes('operations'),
    files: agent => s.ctx.openBrain?.(agent.name),
    canFiles: agent => canOpenFiles(s, agent),
    instances: agent => soulInstances(s, agent), workspace: () => s.workspace,
    schedule: agent => { if (canLaunchSoul(s, agent)) { preselectSchedule(agent); ctx.openView?.("schedules"); } },
    changed: () => refresh(s), closed: ({ restoreFocus } = {}) => {
      const ref = s.inspectRef; s.inspectRef = null;
      if (!s.alive) return;
      renderGrid(s, { restoreFocus: false });
      // The grid is rebuilt by polling; return to composite identity only on
      // explicit standalone close, never during reset or a hidden-stage close.
      const card = restoreFocus && ref && gridCards(s).find(card => cardMatches(card, ref));
      if (canFocusCard(s, card)) { card.tabIndex = 0; card.focus(); }
    },
  });
  s.discovery = createWorkspaceDiscovery(s.q("workspace-header"), s.q("workspace-discovery"), {
    ctx, soulsPanel: s.q("souls-grid"), onIntent: () => nextSelectionIntent(),
    onTab: tab => {
      s.spawnOp++; closeSpawnModal(s); s.inspector.close();
      s.q("souls-bar").hidden = tab !== "souls";
    },
    inspect: selection => selection ? s.inspector.show(selection) : s.inspector.close(),
  });
  // Capture actual tab choices before discovery projects them. Its onTab
  // callback runs only for CHANGES; clicking Souls or pressing Home while
  // already there is still a newer explicit intent. Programmatic projection
  // from an owned preselect must not mint a competing intent of its own.
  const tabs = s.q("workspace-tabs");
  tabs.addEventListener("click", event => {
    if (s.alive && event.target.closest?.('[role="tab"]')) nextSelectionIntent();
  }, true);
  tabs.addEventListener("keydown", event => {
    if (s.alive && event.target.closest?.('[role="tab"]') && ["Home", "End", "ArrowRight", "ArrowLeft"].includes(event.key)) nextSelectionIntent();
  }, true);
  s.q("workspace-header").append(s.q("souls-bar"));
  s.q("workspace-header").append(s.q("wssel")); // standalone switcher stays reachable on every subtab
  applyWorkspaceTab(s);
  s.q("filter").addEventListener("input", (e) => { s.filterText = e.target.value; renderGrid(s); });
  // Keyboard operability (task: keybindings wiring): `/` focuses the filter,
  // arrows rove the card grid, Enter inspects the focused soul,
  // b opens its brain, Esc cancels an open form. spawn.filter/spawn.brain
  // are registered stage:spawn actions; their keys resolve through the
  // engine keymap (view-keys.mjs) so editor rebinds take effect, while
  // dispatch stays view-local and editable-guarded.
  s.q("souls-grid").addEventListener("keydown", (e) => onGridKey(s, e));
  s.viewActions = [
    { id: "spawn.filter", defaultChord: "/", run: () => s.q("filter").focus() },
    { id: "spawn.brain", defaultChord: "B", run: () => brainOfFocusedCard(s) },
  ];
  const viewRoot = el.querySelector(".souls");
  viewRoot.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    // Esc cancels the open spawn form from anywhere inside it (incl. the
    // task textarea — cancel is safe; submit stays click/button-only there).
    if (e.key === "Escape" && s.sel) { e.preventDefault(); s.sel = null; s.selAgent = null; renderGrid(s); return; }
    // view-local keys (never stolen from editable fields), engine-resolved.
    // The MODAL owns all its keys (selects/buttons are interactive controls
    // outside any .soul-card — review 96b037b): '/' from the relation
    // selector must not focus the filter behind the open dialog, and 'B'
    // must not open a card's Brain underneath it.
    const editable = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable;
    if (s.discovery.tab !== "souls" || editable || e.target.closest?.(".soul-inspector") || e.target.closest?.(".soul-card") || e.target.closest?.(".spawn-modal")) return; // card keys are onGridKey's
    const hit = resolveViewKey(e, s.viewActions);
    if (hit) { e.preventDefault(); s.viewActions.find((a) => a.id === hit)?.run(); }
  });
  // Context "view:spawn" is never activated by the shell (review afd2114):
  // editor-visible + conflict-checked, but window-dispatch-ineligible —
  // matchEvent skips these before preventDefault, so outside keypresses
  // are not swallowed and colliding globals still run; dispatch is local.
  s.disposers = [
    registerAction({ id: "spawn.filter", label: "Souls: focus the filter", context: "view:spawn", defaultChord: "/", run: () => s.q("filter").focus() }),
    registerAction({ id: "spawn.brain", label: "Souls: open files of focused card", context: "view:spawn", defaultChord: "B", run: () => brainOfFocusedCard(s) }),
  ];
  // CLI degradation: refresh once on mount and re-render the grid whenever
  // availability flips — spawn buttons disable consistently with the card.
  refreshCli(ctx);
  s.unsubCli = onCliChange(() => {
    if (!s.alive) return;
    renderGrid(s);
    s.discovery.syncCli();
    s.inspector.syncAvailability();
    // an open modal tracks capability live — disabled state + version note
    // resync without touching typed fields (review 5526b70)
    s.syncModalRelations?.();
  });
  s.q("wssel").addEventListener("change", (e) => setWorkspace(e.target.value));
  s.unsubWs = onWorkspaceChange(() => {
    // Workspace switch owns the whole surface: invalidate any A spawn modal
    // immediately, remove its DOM before B loads, and clear A's agentsRoot.
    s.spawnOp++;
    s.rosterReq++; s.rosterGen = null; s.souls = { agents: [] }; s.panelInstances = [];
    s.discovery.reset();
    s.inspector.close();
    closeSpawnModal(s, { repaint: false }); // the switch replaces the grid below
    s.q("souls-grid").innerHTML = '<div class="loading-block"><span class="spinner"></span> Loading agents…</div>';
    // No force flag: if a newer B poll paints a B spawn modal before this
    // request resolves, the late switch refresh must respect that owner.
    refresh(s);
  });
  refresh(s);
  s.timers.push(setInterval(() => {
    refresh(s);
    // A boot-time transport failure leaves the CLI probe UNSETTLED (null
    // state, no card) — without a retry the Spawn buttons stay dead forever
    // with nothing on screen saying why. Keep re-fetching the cheap cached
    // state until a response settles it either way (ok / carded).
    if (cliProbePending()) refreshCli(ctx);
  }, 8000));
}

export function unmount() {
  if (!state) return;
  // A deferred preselect (Quick Open handoff waiting for the current
  // workspace's roster paint) dies with the view: leaving it pending would
  // let a remount minutes later pop a modal the user no longer expects
  // (review 04584f9 — the consumed-once/stale-intent contract).
  pendingPreselect = null;
  pendingHome = null;
  pendingWorkspaceTab = null;
  selectionIntent++;
  state.alive = false;
  state.inspector.dispose();
  state.presentation?.dispose();
  state.discovery.dispose();
  state.timers.forEach(clearInterval);
  (state.disposers || []).forEach((off) => { try { off(); } catch {} });
  if (state.unsubWs) state.unsubWs();
  if (state.unsubCli) state.unsubCli();
  if (state.cliCardHandle) { state.cliCardHandle.dispose(); state.cliCardHandle = null; }
  closeSpawnModal(state);
  state.el.innerHTML = "";
  state = null;
}

/* Exported for the deferred cross-workspace regression. */
export async function refresh(s) {
  const myGen = workspaceGeneration();       // capture at dispatch
  const myReq = s.rosterReq = (s.rosterReq || 0) + 1;
  const intent = { intent: selectionIntent, gen: myGen };
  const current = () => s.alive && myGen === workspaceGeneration() && myReq === s.rosterReq;
  let souls, panel;
  try {
    [souls, panel] = await Promise.all([
      apiJson(s.ctx, `/api/agents${wsQuery()}`),
      apiJson(s.ctx, `/api/panel${wsQuery()}`),
    ]);
  } catch (error) {
    if (!current() || !ownsSelection(s, intent)) return;
    const summary = s.q("souls-sum");
    if (summary) { summary.classList?.remove("workspace-sr-only"); summary.textContent = `Unable to refresh souls: ${error.message || "unavailable"}. Retrying…`; }
    return; // keep only this workspace's last good list
  }
  // discard deferred responses from a previous workspace — they'd paint A's
  // agent list over B's after a switch
  if (!current()) return;
  if (!Array.isArray(souls?.agents)) return;
  s.souls = souls;
  s.rosterGen = myGen; // this roster belongs to the current workspace generation
  s.panelInstances = panel.instances || []; // reference-instance picker source
  s.workspace = panel.workspace || null; // reported context, never derived from a display label
  s.syncModalFacts?.();
  const select = s.q("wssel");
  if (select && typeof select.replaceChildren === "function") {
    // The real shell owns workspace selection. Standalone harnesses keep
    // their selector, safely constructed even for quotes in workspace ids.
    const workspaces = Array.isArray(panel.workspaces) ? panel.workspaces : [];
    select.style.display = s.ctx.hasWorkspaceSwitcher || workspaces.length <= 1 ? "none" : "";
    select.replaceChildren();
    for (const workspace of workspaces) {
      const option = select.ownerDocument.createElement("option");
      option.value = workspace.id; option.textContent = workspace.name || workspace.id;
      select.append(option);
    }
    select.value = panel.workspace?.id || "";
  }
  s.discovery?.updateRoster(souls.agents, panel);
  s.inspector?.syncAvailability();
  renderGrid(s);
  applyPreselect(s); // Quick Open handoff — after the roster is painted
  applyHome(s);
}

function matches(s, a) {
  if (!s.filterText) return true;
  const t = s.filterText.toLowerCase();
  return [a.name, a.description, a.repoName].some((v) => String(v || "").toLowerCase().includes(t));
}

function renderGrid(s, { restoreFocus = true } = {}) {
  const grid = s.q("souls-grid");
  // The spawn form lives in a MODAL outside the grid (human change request on
  // the integrated feature branch), so periodic polls may rebuild the roster
  // freely without wiping typed-but-unsubmitted task/purpose text — the
  // modal DOM is untouched by grid repaints. The one transition that must
  // still reach INTO the modal is CLI degradation (review d7becaf): a modal
  // opened while the CLI state was unknown must not leave a live submit
  // behind a missing degradation card when the probe lands ok:false. Close
  // it; the rebuild shows the card and disabled buttons; doSpawn
  // independently re-checks at submit time.
  const noCli = !cliAvailable(); // frozen contract: unknown does NOT render capable
  // repaint:false — this very renderGrid call is already painting the grid;
  // a nested repaint from the close would render twice for nothing.
  if (noCli && s.sel) closeSpawnModal(s, { repaint: false });
  // (main's in-card soul-form early-return does not apply: the spawn form
  // lives in the modal on this branch, so grid repaints never touch it)
  // capture the focused card's identity before the rebuild wipes the DOM
  const active = s.el?.ownerDocument?.activeElement;
  const focused = grid.contains?.(active) ? active?.closest?.(".soul-card") : null;
  const focusedRef = focused ? { name: focused.dataset.agent, agentsRoot: focused.dataset.root, server: focused.dataset.server } : null;
  // Recovery is shared by every Workspace section, not hidden inside the
  // Souls tab. Its action/focus owner survives routine roster repaints.
  const recovery = s.q("workspace-recovery");
  if (s.cliCardHandle && !cliKnownUnavailable()) {
    s.cliCardHandle.dispose(); s.cliCardHandle.el.remove(); s.cliCardHandle = null;
  }
  if (recovery) recovery.hidden = !cliKnownUnavailable();
  grid.innerHTML = "";
  const list = s.souls.agents.filter((a) => matches(s, a));
  s.q("souls-sum").classList?.add("workspace-sr-only");
  s.q("souls-sum").textContent = `${list.length} of ${s.souls.agents.length} souls${cliProbePending() ? " · Checking CLI…" : ""}`;
  if (typeof grid.append !== "function") return; // non-DOM host (tests observe s.souls)
  // One consistent degradation card ABOVE the roster when the CLI is KNOWN
  // unavailable — reads (the soul cards, brain) stay fully usable below it.
  // Unknown state (pre-probe) disables buttons WITHOUT the card: mutations
  // require a verified compatible CLI (frozen contract), but flashing the
  // card during the milliseconds before the launch probe resolves would be
  // noise.
  if (state && s === state && cliKnownUnavailable() && recovery) {
    if (!s.cliCardHandle) s.cliCardHandle = cliCard(grid.ownerDocument, s.ctx);
    if (s.cliCardHandle.el.parentNode !== recovery) recovery.append(s.cliCardHandle.el);
  }
  if (!list.length) {
    const empty = grid.ownerDocument.createElement("div");
    empty.className = "empty"; empty.style.gridColumn = "1/-1";
    empty.textContent = s.souls.agents.length ? "Nothing matches the filter." : "No agents defined in this workspace.";
    grid.append(empty);
    return;
  }
  // Source/name ordering remains stable; source is on each card, not an
  // extra repo-heading row that offsets the reference canvas baseline.
  const label = (a) => a.repoName || (a.repo ? String(a.repo).split("/").filter(Boolean).at(-1) : "") || "workspace";
  const sorted = [...list].sort((a, b) =>
    label(a).localeCompare(label(b)) || String(a.name).localeCompare(String(b.name)));
  for (const a of sorted) grid.append(soulCard(s, a));
  // Roving tabindex across the rebuilt grid: keep the previously focused
  // card's identity tabbable (and focused) when it survives the repaint,
  // else the first card enters the tab order.
  const rebuilt = [...grid.querySelectorAll(".soul-card")];
  if (rebuilt.length) {
    const restored = focusedRef && rebuilt.find((c) => cardMatches(c, focusedRef));
    (restored || rebuilt[0]).tabIndex = 0;
    if (restoreFocus && canFocusCard(s, restored)) restored.focus({ preventScroll: true });
  }
}

/* ── grid keyboard: roving focus over cards ──────────────────────── */
function cardMatches(card, ref) {
  return card.dataset.agent === ref.name && (card.dataset.root || "") === (ref.agentsRoot || "") && (card.dataset.server || "") === (ref.server || "");
}
function gridCards(s) { return [...s.q("souls-grid").querySelectorAll(".soul-card")]; }

function canFocusCard(s, card) {
  if (!s.alive || s.rosterGen !== workspaceGeneration() || s.discovery?.tab !== "souls"
    || !card?.isConnected || !s.el.contains(card)) return false;
  // Retained stages can be hidden while their requests/polls settle. Don't
  // restore focus through a hidden/inert stage or a just-hidden Souls subtab.
  for (let el = card; el; el = el.parentElement) {
    if (el.hidden || el.inert || el.style.display === "none" || el.style.visibility === "hidden") return false;
  }
  return true;
}

function focusedCard(s) {
  const active = s.el.ownerDocument.activeElement;
  return active?.closest?.(".soul-card") || null;
}

function soulInstances(s, agent) {
  return (s.panelInstances || []).filter(i => i.agent === agent.name && i.agentsRoot === agent.agentsRoot && (i.server || "") === (agent.server || ""));
}
function canOpenFiles(s, agent) {
  // The existing read-only Brain route accepts a name, not an agentsRoot.
  // Do not pretend it can safely address a shadowed soul, or redirect an
  // inspector's captured A selector to a unique same-named replacement B.
  if (!s.alive || s.rosterGen !== workspaceGeneration() || agent.remote || typeof s.ctx.openBrain !== "function") return false;
  const candidates = s.souls.agents.filter(a => a.name === agent.name);
  return candidates.length === 1 && !candidates[0].remote
    && (candidates[0].agentsRoot || "") === (agent.agentsRoot || "")
    && (candidates[0].server || "") === (agent.server || "");
}
function brainOfFocusedCard(s) {
  const card = focusedCard(s);
  const a = card && s.souls.agents.find((x) => cardMatches(card, x));
  if (a && canOpenFiles(s, a)) s.ctx.openBrain?.(a.name);
}

function onGridKey(s, e) {
  // Keys inside the open form belong to the form (Esc handled above).
  if (e.target.closest?.(".soul-form")) return;
  const cards = gridCards(s);
  if (!cards.length) return;
  const cur = focusedCard(s);
  const at = cur ? cards.indexOf(cur) : -1;
  if (["ArrowRight", "ArrowDown"].includes(e.key)) {
    e.preventDefault();
    focusCard(s, cards, Math.min(cards.length - 1, at + 1));
  } else if (["ArrowLeft", "ArrowUp"].includes(e.key)) {
    e.preventDefault();
    focusCard(s, cards, Math.max(0, at - 1));
  } else if (["Enter", " "].includes(e.key) && cur && e.target === cur) {
    e.preventDefault();
    cur.click();
  } else if (cur && e.target === cur) {
    // ALL view actions resolve from a focused card — the primary
    // non-editable surface (review 93ff03d: '/' must reach the filter
    // from the roving card, not just 'b').
    const hit = resolveViewKey(e, s.viewActions);
    if (hit === "spawn.brain") {
      e.preventDefault();
      brainOfFocusedCard(s);
    } else if (hit) {
      e.preventDefault();
      s.viewActions.find((a) => a.id === hit)?.run();
    }
  }
}

/* Roving tabindex: exactly one card in the tab order — the focused one. */
function focusCard(s, cards, index) {
  const target = cards[index];
  if (!target) return;
  for (const c of cards) c.tabIndex = c === target ? 0 : -1;
  target.focus();
}

function canLaunchSoul(s, agent) {
  return s.alive && s.rosterGen === workspaceGeneration() && cliAvailable() && !!agent?.agentsRoot
    && s.souls.agents.filter(current => current.name === agent.name
      && current.agentsRoot === agent.agentsRoot && (current.server || "") === (agent.server || "")).length === 1
    && s.souls.agents.find(current => current.name === agent.name
      && current.agentsRoot === agent.agentsRoot && (current.server || "") === (agent.server || "")).work !== "attached";
}

function soulCard(s, a) {
  const attached = a.work === "attached";
  const card = s.el.ownerDocument.createElement("button");
  card.type = "button";
  card.className = "soul-card inspect-act" + (attached ? " attached" : "") + (((s.selAgent?.name === a.name && s.selAgent?.agentsRoot === a.agentsRoot && s.selAgent?.server === a.server) || (s.inspectRef?.name === a.name && s.inspectRef?.agentsRoot === a.agentsRoot && s.inspectRef?.server === a.server)) ? " open" : "");
  card.dataset.agent = a.name; card.dataset.root = a.agentsRoot || ""; card.dataset.server = a.server || "";
  card.tabIndex = -1; // roving tabindex — renderGrid elects the tabbable card
  card.setAttribute("aria-label", `Inspect ${a.name}`);
  card.setAttribute("aria-controls", "workspace-inspector");
  // A hosted selection survives panel collapse/cover. It is not an expanded
  // disclosure: aria-pressed describes selection without claiming visibility.
  if (s.presentation) card.setAttribute("aria-pressed", String(cardMatches(card, s.inspectRef || {})));
  card.title = attached ? "Attached only — select for details and files" : `Inspect ${a.name} — Launch, Files, Schedule and reported defaults`;
  card.addEventListener("click", () => inspectSoul(s, a));
  const doc = s.el.ownerDocument;
  const name = doc.createElement("span"); name.className = "sname";
  const avatar = createSoulMark(doc, a); avatar.classList.add("glyph");
  const identity = doc.createElement("span"); identity.className = "sidentity";
  const title = doc.createElement("span"); title.className = "stitle"; title.textContent = a.name;
  const context = doc.createElement("span"); context.className = "scontext"; context.textContent = a.repoName || a.workspace || "Workspace soul";
  identity.append(title, context);
  const runtime = createRuntimeBadge(doc, a.runtime); runtime.classList.add("sruntime");
  name.append(avatar, identity, runtime);
  const description = doc.createElement("span"); description.className = "sdesc"; description.textContent = a.description || "";
  card.append(name, description);
  const instances = soulInstances(s, a);
  const running = instances.filter(i => i.running === true).length;
  const activity = s.el.ownerDocument.createElement("span"); activity.className = "sactivity" + (running ? " running" : "");
  activity.textContent = `${running} running · ${instances.length} ${instances.length === 1 ? "instance" : "instances"}`;
  card.append(activity);
  return card;
}

/** Close (if open) the spawn modal and clear the selection. Safe to call
 * when no modal exists. Closing ends the form's operation ownership; an
 * in-flight completion cannot act after cancellation or a subtab change.
 * repaint (default true when a modal existed) re-renders the grid so the
 * card's .open highlight clears immediately — not on the next poll.
 * restoreFocus targets the current inspector Launch action for the same
 * composite soul, falling back to its current card if the inspector closed.
 * Grid polling replaces cards: never focus a captured detached opener or
 * a same-named twin (review 41059e0). */
function closeSpawnModal(s, { restoreFocus = false, repaint = true } = {}) {
  const hadModal = !!s.modalEl;
  const agentRef = s.selAgent;
  if (hadModal) s.spawnOp++; // closing ends the form operation ownership
  s.sel = null; s.selAgent = null;
  s.modalCleanup?.(); s.modalCleanup = null;
  s.modalEl?.remove(); s.modalEl = null;
  s.syncModalRelations = null; s.syncModalFacts = null;
  if (!hadModal || !repaint || s.alive === false) return;
  renderGrid(s); // clear the .open card highlight NOW
  if (!restoreFocus || !agentRef) return;
  if (s.inspector?.focusLaunch(agentRef)) return;
  const card = gridCards(s).find(card => cardMatches(card, agentRef));
  if (canFocusCard(s, card)) card.focus();
}

/** Spawn modal (human change request on the integrated feature branch):
 * ALL spawn options in one dialog — purpose, task, and the agent-relation
 * options (relation + reference instance) directly visible, following the
 * app's ws-dialog pattern: role=dialog + aria-modal, labelled controls,
 * Tab focus trap, Esc/backdrop/× close, focus restored to the opener. */
function openSpawnModal(s, a, draft = {}) {
  if (!canLaunchSoul(s, a)) return;
  nextSelectionIntent();
  closeSpawnModal(s); // one modal at a time; a new open supersedes the old
  s.sel = a.name; s.selAgent = a;
  renderGrid(s); // highlight the selected card under the backdrop

  const doc = s.el.ownerDocument;
  const modalGen = workspaceGeneration();
  const modal = doc.createElement("div");
  modal.className = "spawn-modal";
  const titleId = "spawn-dialog-title";
  // Picker options carry BOTH halves of the anchor identity: the visible
  // value is the instance name (what the user reads), dataset.root is the
  // agents root it homes in — always sent as --relative-root so cross-root
  // name shadowing can never make the spawn ambiguous (kernel contract:
  // E_RELATIVE_AMBIGUOUS). Duplicate names get a SHORTEST-UNIQUE root tag
  // (naive one-segment tags collide: /a/project/agents vs /b/project/agents;
  // review cbd5bb3). Options are built with createElement/textContent/
  // dataset — roots are workspace paths and must never travel through
  // innerHTML attribute interpolation (injection surface; review cbd5bb3).
  const nameCounts = new Map();
  for (const i of s.panelInstances || []) nameCounts.set(i.instance, (nameCounts.get(i.instance) || 0) + 1);
  const dupRoots = (s.panelInstances || [])
    .filter((i) => (nameCounts.get(i.instance) || 0) > 1)
    .map((i) => i.agentsRoot);
  const rootTags = distinguishingRootTags(dupRoots);
  const buildRefOptions = (select) => {
    for (const i of s.panelInstances || []) {
      const opt = doc.createElement("option");
      opt.value = i.instance;
      opt.dataset.root = i.agentsRoot || "";
      const dup = (nameCounts.get(i.instance) || 0) > 1 && i.agentsRoot;
      const tag = dup ? ` [${rootTags.get(String(i.agentsRoot)) || i.agentsRoot}]` : "";
      opt.textContent = `${i.instance}${tag}${i.running === true ? "" : ` (${runtimeState(i)})`}`;
      select.append(opt);
    }
  };
  // ALL options are ALWAYS VISIBLE (human requirement): purpose, task,
  // relation + reference instance, runtime and model overrides. The CLI
  // capability gate never HIDES the relation controls — on a pre-relations
  // CLI the related choices (child/sibling/parent) and the reference picker
  // gate disabled with the required version named, while the select itself
  // and "unrelated" stay usable. The server still fails closed
  // (cli-no-relations) — render state is UX, not the
  // guard. Capability is NOT snapshotted: app focus re-probes the CLI, so
  // an open modal resyncs on every CLI change (review 5526b70) via
  // syncRelationControls below — typed fields are never touched.
  modal.innerHTML = `
    <section class="spawn-dialog" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="spawn-dialog-head">
        <div>
          <h2 id="${titleId}">Spawn ${escapeHtml(a.name)}</h2>
          ${a.description ? `<div class="sdesc">${escapeHtml(a.description)}</div>` : ""}
          <div class="schips" style="margin-top:6px">
            <span class="chip">${escapeHtml(a.work)}</span>
            ${a.repo ? `<span class="chip">${escapeHtml(a.repoName)}</span>` : ""}
          </div>
        </div>
        <button class="close-act fcancel-x" type="button" aria-label="Close spawn dialog">×</button>
      </div>
      <div class="soul-form">
        <label>Purpose (optional — becomes part of the instance name)
          <input class="field fpurpose" placeholder="e.g. pr42" autocomplete="off"></label>
        <label>Task (optional — empty spawns an instance awaiting your instructions)
          <textarea class="field ftask" rows="4" placeholder="What should this instance do?"></textarea></label>
        <fieldset class="frelgroup">
          <legend>Relation to other agents</legend>
          <div class="frelrow">
            <select class="field frelation" aria-label="Relation">
              <option value="unrelated" selected>Unrelated</option>
              <option value="child">Child of…</option>
              <option value="sibling">Sibling of…</option>
              <option value="parent">Parent of…</option>
            </select>
            <select class="field frelto" disabled aria-label="Which instance">
              <option value="">— which instance? —</option>
            </select>
          </div>
          <div class="freldesc" aria-live="polite"></div>
          <div class="frelnote" hidden></div>
        </fieldset>
        <label>Runtime (optional — uses soul defaults)
          <select class="field fruntime">
            <option value="" selected>Use soul defaults</option>
            <option value="pi">pi</option>
            <option value="claude">claude</option>
            <option value="codex">codex</option>
          </select></label>
        <label>Session backend
          <select class="field fbackend">
            <option value="" selected>Use resolved defaults</option>
            <option value="tmux">tmux</option>
            <option value="herdr">Herdr</option>
          </select></label>
        <label>Permissions
          <select class="field fyolo">
            <option value="">Use soul / scope setting</option>
            <option value="true">YOLO — skip permission prompts</option>
            <option value="false">Use native permission policy</option>
          </select></label>
        <label>Model (optional — uses soul defaults; suggestions require an explicit runtime)
          <input class="field fmodel" autocomplete="off" list="spawn-model-options" placeholder="Use soul defaults"></label>
        <datalist id="spawn-model-options"></datalist>
        <label>Run on
          <select class="field fserver" aria-label="Execution server">
            <option value="" selected>this machine</option>
          </select></label>
        <div class="fserverdesc" hidden>Runs in the selected server's workspace.</div>
        <div class="frow">
          <button class="act fspawn primary">Spawn</button>
          <button class="act fcancel">Cancel</button>
          <span class="fstatus" aria-live="polite"></span>
        </div>
      </div>
    </section>`;
  const dialog = modal.querySelector(".spawn-dialog");
  let submitting = false, composing = false, legacyCreated = false, guardedApply = null;
  const ownsModal = () => s.alive && modalGen === workspaceGeneration() && s.modalEl === modal;
  const layout = composeSpawnDialog(modal, { soul: a, agents: s.souls.agents, workspace: s.workspace, query: draft.query || '',
    canChoose: candidate => canLaunchSoul(s, candidate),
    choose: (candidate, query) => {
      if (!ownsModal() || submitting || !canLaunchSoul(s, candidate)) return;
      const fresh = s.souls.agents.find(current => current.name === candidate.name && current.agentsRoot === candidate.agentsRoot && (current.server || '') === (candidate.server || ''));
      openSpawnModal(s, fresh, { query, task: modal.querySelector('.ftask').value, purpose: modal.querySelector('.fpurpose').value });
    },
  });
  const wakeFields = wakeScheduleFields(doc);
  layout.moreBody.append(wakeFields.el);
  buildRefOptions(modal.querySelector(".frelto")); // safe DOM construction (never innerHTML)
  // A remote soul belongs to its host even when server listing is unavailable.
  const serverSelect = modal.querySelector(".fserver");
  if (a.server) {
    serverSelect.replaceChildren();
    const option = document.createElement("option"); option.value = a.server; option.textContent = a.repoName || a.server;
    serverSelect.append(option); serverSelect.value = a.server; serverSelect.disabled = true;
    modal.querySelector(".fserverdesc").hidden = false;
  }
  // Local souls may also launch in a registered server's workspace.
  if (!a.server) (async () => {
    try {
      const d = await apiJson(s.ctx, "/api/servers");
      const sel = modal.querySelector(".fserver");
      if (!sel || !s.alive || modalGen !== workspaceGeneration() || s.modalEl !== modal) return;
      if (!d?.servers?.length) return;
      for (const srv of d.servers) {
        const o = document.createElement("option");
        o.value = srv.id; o.textContent = `${srv.label} (ssh ${srv.sshHost})`;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => { modal.querySelector(".fserverdesc").hidden = !sel.value; });
    } catch { /* local only */ }
  })();
  const f = modal; // field lookups span the whole modal
  // Model dropdown (datalist): advisory options only for an explicitly
  // chosen runtime. The raw roster runtime/model do not resolve inherited
  // soul launch configurations; defaults must remain the CLI's decision.
  // POST, not GET: the endpoint runs a child process on cache miss and must
  // sit behind the server's Origin guard (review 9b1e3ff).
  // Free text stays valid — comma-separated preference lists and unknown
  // models are the user's call; the list only shows what the runtime can
  // actually run (pi: authenticated provider/model catalog; claude:
  // anthropic aliases + claude-* ids). Options are built with
  // createElement/textContent — catalog ids never travel through innerHTML
  // (same injection posture as the reference picker). A PER-REQUEST
  // generation guards the async fill: runtime flips inside one open modal
  // race each other (review 9b1e3ff — a slow pi response must not overwrite
  // a later claude list), and a response landing after close/reopen must
  // not touch a list it no longer owns.
  let modelReq = 0;
  const fillModelOptions = async () => {
    if (!ownsModal()) return;
    const myReq = ++modelReq;
    const dl = f.querySelector("#spawn-model-options");
    if (!dl) return;
    dl.textContent = "";
    layout.refreshChoices();
    const runtime = f.querySelector(".fruntime").value;
    if (!canLaunchSoul(s, a) || serverSelect.value || !runtime || f.querySelector('.fruntime').selectedOptions[0]?.disabled) return; // No catalog for stale souls, remote, unsupported or unresolved defaults.
    try {
      const d = await postJson(s.ctx, "/api/models", { runtime });
      if (!s.alive || modalGen !== workspaceGeneration() || myReq !== modelReq || s.modalEl !== modal) return; // superseded or modal replaced
      for (const m of d.models || []) {
        const opt = doc.createElement("option");
        opt.value = m.id;
        if (m.label && m.label !== m.id) opt.label = m.label;
        dl.append(opt);
      }
      layout.refreshChoices();
    } catch { /* advisory only — no suggestions reported; custom text still works */ }
  };
  fillModelOptions();
  f.querySelector(".fruntime").addEventListener("change", fillModelOptions);
  serverSelect.addEventListener("change", fillModelOptions);

  // One source of truth for the relation controls' render state, applied at
  // open AND on every CLI change while the modal is open (review 5526b70):
  // capability can flip under an open dialog (app-focus re-probe after a
  // CLI up/downgrade). Only disabled/note state changes — typed and chosen
  // values are preserved (a selected relation stays visible after a
  // downgrade; an upgrade re-enables everything with values intact).
  // The SELECT itself stays enabled on an incapable CLI with only the
  // RELATED options disabled (review 8b26317): "unrelated" must remain a
  // reachable recovery so the typed task can still spawn on the old CLI.
  const syncRelationControls = () => {
    const relations = cliRelationsAvailable();
    const rel = f.querySelector(".frelation"), ref = f.querySelector(".frelto");
    const note = f.querySelector(".frelnote"), desc = f.querySelector(".freldesc");
    rel.disabled = false; // the select stays usable — gating is per-OPTION
    for (const opt of rel.querySelectorAll("option")) {
      if (opt.value !== "unrelated") opt.disabled = !relations;
    }
    const related = rel.value !== "unrelated";
    ref.disabled = !relations || !related;
    // one coherent choice: the picker's accessible name follows the chosen
    // relation ("Child of which instance?"), and a plain-language phrase
    // spells the outcome once both halves are picked
    ref.setAttribute("aria-label", related
      ? `${rel.value[0].toUpperCase()}${rel.value.slice(1)} of which instance?` : "Which instance");
    const phrase = { child: "child of", sibling: "sibling of", parent: "parent of" };
    // The outcome sentence must never promise what submit will reject
    // (review e9a9281): on a relations-incapable CLI the preserved related
    // choice renders, but the phrase yields to an unavailable-state message
    // consistent with the version note below it.
    desc.textContent = !related ? ""
      : !relations ? `Related spawn unavailable on the installed CLI — this would be a ${phrase[rel.value]} ${ref.value || "…"}.`
      : ref.value ? `This instance will spawn as a ${phrase[rel.value]} ${ref.value}.`
      : `Pick the instance this one is a ${phrase[rel.value]}.`;
    note.hidden = relations;
    const min = relationsMinLabel();
    note.textContent = relations ? "" : `${min ? `Relations require oats >= ${min}` : "Relations require a newer oats than the one installed"} — the installed CLI spawns unrelated instances only. Set the relation to "Unrelated" to spawn now.`;
  };
  s.syncModalRelations = syncRelationControls;
  syncRelationControls();

  // both halves of the grouped choice re-derive the state and phrase
  f.querySelector(".frelto").addEventListener("change", syncRelationControls);

  // reference picker enables only when a real relation is chosen — kept
  // VISIBLE (disabled) so the hierarchy options are always in sight
  f.querySelector(".frelation").addEventListener("change", syncRelationControls);

  const close = () => closeSpawnModal(s, { restoreFocus: true });
  f.querySelector(".fcancel").addEventListener("click", close);
  f.querySelector(".fcancel-x").addEventListener("click", close);
  modal.addEventListener("mousedown", (e) => { if (e.target === modal) close(); }); // backdrop
  dialog.addEventListener('compositionstart', () => { composing = true; });
  dialog.addEventListener('compositionend', () => { composing = false; });
  dialog.addEventListener("keydown", (e) => {
    if (!ownsModal()) return;
    if (e.defaultPrevented || composing || e.isComposing || e.keyCode === 229 || e.repeat) {
      // A button's native Enter click must not bypass the launch-key guard.
      // Do not prevent the textarea's IME commit/newline.
      if (e.key === 'Enter' && e.target.closest?.('.fspawn')) e.preventDefault();
      if (composing || e.isComposing || e.keyCode === 229) e.stopPropagation();
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey; // Shift alone is still text input
    const editable = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;
    const hit = (plain && (editable || e.key === 'Enter')) ? null
      : resolveViewKey(e, [{ id: 'spawn.submit' }], { isMac: /mac/i.test(doc.defaultView?.navigator?.platform || '') });
    if (hit) { e.preventDefault(); e.stopPropagation(); if (!submitting) f.querySelector('.fspawn').click(); return; }
    if (e.key === 'Enter' && e.target.closest?.('.fspawn')) { e.preventDefault(); return; }
    if (e.key !== "Tab") return; // focus trap includes disclosure controls
    const focusable = [...dialog.querySelectorAll("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary")]
      .filter((el) => !el.hidden && !el.closest("[hidden]") && el.tabIndex >= 0
        && ![...dialog.querySelectorAll('details:not([open])')].some(details => details.contains(el) && el !== details.querySelector('summary')));
    if (!focusable.length) return;
    const first = focusable[0], last = focusable.at(-1);
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  const previewRead = createSpawnPreview(modal, { ctx: s.ctx, soul: a, workspace: () => s.workspace, cli: cliStatus,
    instances: () => s.panelInstances, owns: () => ownsModal() && canLaunchSoul(s, a), submitting: () => submitting, layout,
    guarded: () => guardedApply?.active() ?? false, draftChanged: () => guardedApply?.invalidate(), draftReset: () => guardedApply?.reset(),
    needsReset: () => guardedApply?.needsReset() ?? false });
  const launch = createSpawnLaunch(modal, { ctx: s.ctx, soul: a, workspace: () => s.workspace, cli: cliStatus,
    owns: () => ownsModal() && canLaunchSoul(s, a), layout, previewRead });
  guardedApply = createSpawnApply(modal, { ctx: s.ctx, soul: a, workspace: () => s.workspace, cli: cliStatus,
    instances: () => s.panelInstances, owns: () => ownsModal() && canLaunchSoul(s, a) && !legacyCreated,
    previewRead, task: () => f.querySelector('.ftask').value, wake: () => wakeFields.read(), canSubmit: () => launch.canSubmit(),
    busy: () => submitting, setBusy: value => { submitting = value; },
    onCreated: async (view, isCurrent) => {
      if (!isCurrent()) return;
      const receipt = view.receipt, status = f.querySelector('.fstatus');
      if (view.status === 'partial') {
        if (!f.querySelector('.guarded-schedules')) {
          const manage = doc.createElement('button'); manage.className = 'act guarded-schedules'; manage.type = 'button'; manage.textContent = 'View schedules';
          manage.addEventListener('click', () => { if (!ownsModal()) return; closeSpawnModal(s); s.ctx.openView?.('schedules'); });
          f.querySelector('.frow').append(manage);
        }
        return; // creation succeeded; never retry spawn to repair a wake
      }
      if (!receipt.launched) { status.textContent = `Created ${receipt.instance} — not launched. Inspect its session from the roster.`; return; }
      const ref = { instance: receipt.instance, home: receipt.home, agentsRoot: receipt.agentsRoot };
      status.textContent = `Created ${receipt.instance}. Waiting for its exact roster entry…`;
      const connection = s.ctx.connectionGeneration?.() ?? 0, workspace = s.workspace?.id; let admitted;
      const visible = await waitForInstanceInPanel(s, { ...ref, agent: receipt.agent }, isCurrent,
        { ...s.waitOpts, strict: true, onAdmitted: row => { admitted = row; } });
      if (!isCurrent()) return;
      if (!visible) { status.textContent = `Created ${receipt.instance} — not yet visible as a running session. Open it from the roster when available.`; return; }
      if (admitted) s.ctx.notifySpawn?.(admitted, workspace, connection);
      closeSpawnModal(s); s.ctx.openTerminal(ref, { quiet: true });
    },
  });
  f.querySelector(".fspawn").addEventListener("click", async () => {
    if (!ownsModal() || submitting || legacyCreated || f.querySelector('.fspawn').disabled) return;
    if (guardedApply.handles()) { await guardedApply.run(); return; }
    const reason = !canLaunchSoul(s, a) ? 'This exact soul is no longer available in the current roster.' : launch.canSubmit();
    if (reason) { f.querySelector('.fstatus').textContent = reason; return; }
    submitting = true;
    try { await doSpawn(s, {
    btn: f.querySelector(".fspawn"),
    status: f.querySelector(".fstatus"),
    purpose: () => f.querySelector(".fpurpose").value,
    task: () => f.querySelector(".ftask").value,
    relation: () => f.querySelector(".frelation").value,
    relativeTo: () => f.querySelector(".frelto").value,
    relativeRoot: () => f.querySelector(".frelto").selectedOptions?.[0]?.dataset?.root || "",
    yolo: () => { const value = f.querySelector(".fyolo").value; return value === "" ? undefined : value === "true"; },
    backend: () => f.querySelector(".fbackend").value,
    runtime: () => f.querySelector(".fruntime").value,
    model: () => f.querySelector(".fmodel").value,
    launchConfig: () => launch.value(),
    server: () => f.querySelector(".fserver")?.value || "",
    wake: () => wakeFields.read(),
    partial: (result) => {
      legacyCreated = true;
      const manage = doc.createElement("button"); manage.className = "act"; manage.type = "button";
      manage.textContent = "View schedules";
      manage.addEventListener("click", () => {
        closeSpawnModal(s);
        if (result.workspaceId) setWorkspace(result.workspaceId);
        s.ctx.openView?.("schedules");
      });
      f.querySelector(".frow").append(manage);
    },
    clear: () => {
      f.querySelector(".fpurpose").value = ""; f.querySelector(".ftask").value = "";
      f.querySelector(".frelation").value = "unrelated";
      f.querySelector(".frelto").value = "";
      syncRelationControls(); // re-disable the picker for "unrelated"
      f.querySelector(".fruntime").value = "";
      f.querySelector(".fbackend").value = "";
      f.querySelector(".fmodel").value = "";
      launch.clear(); layout.syncRuntime();
      void fillModelOptions(); // restoring defaults also cancels any explicit-runtime catalog
    },
    }); } finally { submitting = false; previewRead.sync(); guardedApply.sync(); }
  });

  s.modalEl = modal;
  s.el.querySelector(".souls").append(modal);
  f.querySelector('.ftask').value = draft.task || '';
  f.querySelector('.fpurpose').value = draft.purpose || '';
  const releaseSubmit = registerAction({ id: 'spawn.submit', label: 'Spawn selected soul', context: 'spawn-dialog-local', defaultChord: 'Mod+Enter', run: () => {} });
  const updateHint = () => {
    const mac = /mac/i.test(doc.defaultView?.navigator?.platform || '');
    const label = formatChord(getBinding('spawn.submit'), mac) || '';
    f.querySelector('.fspawn').dataset.shortcut = mac ? label.replace(/Enter$/, '↵') : label;
  };
  const releaseHint = onKeymapChange(updateHint); updateHint();
  s.modalCleanup = () => { guardedApply.dispose(); launch.dispose(); previewRead.dispose(); layout.dispose(); releaseHint(); releaseSubmit(); modelReq++; };
  s.syncModalFacts = () => { if (!ownsModal()) return; if (launch.sync()) void fillModelOptions(); previewRead.sync(); guardedApply.sync(); };
  s.syncModalRelations = () => { if (!ownsModal()) return; syncRelationControls(); s.syncModalFacts(); };
  s.syncModalRelations();
  if (ownsModal()) layout.search.focus({ preventScroll: true });
  return modal;
}

/* Exported for the in-flight-spawn regressions.

   Two invalidation tokens gate ALL post-await mutation:
   - workspace generation: a spawn begun in workspace A that completes after a
     switch to B must NOT auto-open the terminal (openTerminal resolves names
     in the CURRENT workspace — a same-named B instance would receive input
     meant for the new A one);
   - a per-spawn operation token (s.spawnOp): the form is per-card but shared
     against re-renders — after a switch the user may already be spawning
     another agent, and a late completion must not touch a form it no longer
     owns. Only the currently active operation may mutate UI — success,
     error, and finally paths alike. */
/* After a spawn, the roster SNAPSHOT lags: /api/panel is refreshed by a
   background collector only every ~3s, so the new instance is usually not
   in it yet — and the shell's openTerminal resolves instances from that
   same endpoint, so opening immediately yields "unknown instance". Poll the
   selected workspace's panel until the instance appears AND is terminal-
   ready (ownership- and generation-gated), then hand off. Presence alone is
   NOT enough: the snapshot lists a freshly spawned instance from its
   instance.json before its tmux window registers, so an open dispatched at
   first sight hits the shell's "no live tmux session" refusal — the tmux
   session typically follows a couple of seconds later. Exported for the
   stale-snapshot regression. delayMs is injectable so tests run without
   real waits. */
export async function waitForInstanceInPanel(s, ref, isCurrent, { tries = 20, delayMs = 700, sleep, strict = false, onAdmitted } = {}) {
  const wait = sleep || ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  // ref: { instance, home?, agentsRoot? }. Match the COMPOSITE identity when
  // the spawn result provides it — with a same-named twin already in the
  // roster, a bare-name wait would succeed early and the follow-up open then
  // refuse the ambiguous name (merged-state review @7dd1e7b) — and require
  // the readiness the shell's open path checks (running + tmux session), so
  // the auto-open can never race the tmux registration.
  const matches = (x) => x.instance === ref.instance
    && (x.server || "") === (ref.server || "")
    && (strict ? !!ref.home && x.home === ref.home : !ref.home || !x.home || x.home === ref.home)
    && (strict ? !!ref.agentsRoot && x.agentsRoot === ref.agentsRoot : !ref.agentsRoot || !x.agentsRoot || x.agentsRoot === ref.agentsRoot)
    && (!strict || !ref.agent || x.agent === ref.agent)
    && !!x.running && (!!x.tmux?.session || !!x.sessionTarget || (!!x.server && x.savedRoute));
  for (let i = 0; i < tries; i++) {
    if (!isCurrent()) return false;          // ws switched / superseded: stop
    try {
      const panel = await apiJson(s.ctx, `/api/panel${wsQuery()}`);
      if (!isCurrent()) return false;
      const matched = (panel.instances || []).filter(matches);
      if (strict ? matched.length === 1 : matched.length > 0) {
        if (matched.length === 1) onAdmitted?.({ ...matched[0] });
        return true;
      }
    } catch { /* transient — keep polling */ }
    await wait(delayMs);
  }
  return false;                              // snapshot never caught up: no auto-open
}

export async function doSpawn(s, ui) {
  if (ui?.spawned) return;
  const a = s.selAgent;
  if (!a) return;
  // CLI gate at SUBMIT time (review d7becaf): a modal opened before a state
  // flip must not dispatch — the render-time disable alone cannot cover a
  // dialog that was already open. Mutations require a VERIFIED compatible CLI.
  if (!cliAvailable()) {
    closeSpawnModal(s); // also repaints the degradation card + disabled buttons
    return;
  }
  // Legacy field interface (shared regression tests + old callers): adapt
  // s.q("ftask"|"fpurpose"|"fspawn"|"fstatus") into the ui seam.
  if (!ui) {
    const btn = s.q("fspawn"), status = s.q("fstatus");
    const taskEl = s.q("ftask"), purposeEl = s.q("fpurpose");
    ui = {
      btn, status,
      task: () => taskEl.value,
      purpose: () => purposeEl.value,
      clear: () => { taskEl.value = ""; purposeEl.value = ""; },
    };
  }
  const myGen = workspaceGeneration();       // capture at dispatch
  const connection = s.ctx.connectionGeneration?.() ?? 0;
  const myOp = ++s.spawnOp;                  // this spawn owns the form until superseded
  const owns = () => myOp === s.spawnOp && s.alive !== false && myGen === workspaceGeneration() && connection === (s.ctx.connectionGeneration?.() ?? 0);
  const relation = ui.relation ? String(ui.relation() || "unrelated") : "unrelated";
  const relativeTo = ui.relativeTo ? String(ui.relativeTo() || "") : "";
  if (relation !== "unrelated" && ui.server?.() && !a.server) {
    ui.status.classList?.add("err");
    ui.status.textContent = "Select the server workspace to choose a related remote agent, or spawn unrelated.";
    return;
  }
  // Submit-time capability guard FIRST (reviews f35c1dc + 8b26317): a
  // downgrade while the modal was open preserves the chosen relation, and
  // doSpawn reads values programmatically — without this check the retained
  // related spawn would dispatch into the server's cli-no-relations
  // rejection. Capability precedes pairing so a no-reference downgrade
  // never advises picking a DISABLED reference. Recovery is real: the
  // relation select keeps "unrelated" enabled (related options disabled),
  // so the typed task can still spawn on the old CLI.
  if (relation !== "unrelated" && !cliRelationsAvailable()) {
    ui.status.classList?.add("err");
    ui.status.textContent = `Spawn failed: the installed oats CLI cannot spawn related instances — set the relation to "unrelated" to spawn now, or upgrade the CLI.`;
    return;
  }
  // Relation pairing is validated BEFORE dispatch: a chosen relation needs a
  // reference instance (the server would 409 anyway — fail it in the form).
  if (relation !== "unrelated" && !relativeTo) {
    ui.status.classList?.add("err");
    ui.status.textContent = `Spawn failed: the "${relation}" relation needs a reference instance.`;
    return;
  }
  ui.btn.disabled = true; ui.btn.textContent = "Spawning…";
  ui.status.classList?.remove("err"); ui.status.textContent = "";
  try {
    const d = await postJson(s.ctx, "/api/spawn", {
      agent: a.name,
      agentsRoot: a.agentsRoot,
      task: ui.task(),                       // "" = awaiting instructions (panel default)
      purpose: ui.purpose() || undefined,
      serverId: a.server || ui.server?.() || undefined,
      relation: relation !== "unrelated" ? relation : undefined,
      relativeTo: relation !== "unrelated" ? relativeTo : undefined,
      // anchor root: ALWAYS sent with a related spawn when the picker knows
      // it — disambiguates cross-root name shadowing (E_RELATIVE_AMBIGUOUS)
      relativeRoot: relation !== "unrelated" ? ((ui.relativeRoot ? ui.relativeRoot() : "") || undefined) : undefined,
      yolo: ui.yolo?.(),
      backend: (ui.backend ? ui.backend() : "") || undefined,
      runtime: (ui.runtime ? ui.runtime() : "") || undefined,
      model: (ui.model ? ui.model() : "") || undefined,
      launchConfig: ui.launchConfig?.() || undefined,
      wake: ui.wake?.(),
    });
    if (myGen !== workspaceGeneration()) {
      // Workspace switched while the spawn was in flight: never auto-open.
      if (owns()) ui.status.textContent = `Spawned ${d.instance} in the previous workspace — switch back to open its terminal.`;
      return;
    }
    if (!owns()) return;                     // superseded — leave the form alone
    ui.clear();
    if (d.wakeScheduleError) {
      ui.spawned = d;
      ui.status.classList?.add("err");
      ui.status.textContent = `Created ${d.instance}, but its wake schedule was not saved: ${d.wakeScheduleError.message}. The agent is available in the sidebar. Add its wake schedule from Schedules.`;
      ui.btn.textContent = "Agent created";
      ui.partial?.(d);
      return;
    }
    if (d.wakeSchedule) s.ctx.notify?.(`Wake schedule saved for ${d.instance}. Check Schedules to verify its host scheduler is enabled.`);
    if (d.routeConflict) {
      ui.status.textContent = `Spawned ${d.instance} on ${d.server}, but its name already has a saved route. Manage the new home ${d.home} from the execution host. ${(d.warnings || []).join(" ")}`;
      return;
    }
    ui.status.textContent = `Spawned ${d.instance}${d.launched ? " — session running" : ""}. Waiting for the roster…`;
    // The panel snapshot lags spawns by up to a collector cycle; opening the
    // terminal before the instance is in /api/panel makes the shell resolve
    // "unknown instance". Wait for it, still gated by ownership + workspace.
    if (d.server && d.workspaceId && d.workspaceId !== currentWorkspace()) {
      const ref = { instance: d.instance, home: d.home, server: d.server };
      closeSpawnModal(s);
      setWorkspace(d.workspaceId);
      const remoteGen = workspaceGeneration();
      const stillThere = () => remoteGen === workspaceGeneration() && currentWorkspace() === d.workspaceId && connection === (s.ctx.connectionGeneration?.() ?? 0);
      let admitted;
      const visible = await waitForInstanceInPanel(s, ref, stillThere, { ...s.waitOpts, onAdmitted: row => { admitted = row; } });
      if (visible && stillThere()) {
        if (typeof d.home === 'string' && admitted?.home === d.home && admitted.agent === a.name) s.ctx.notifySpawn?.(admitted, d.workspaceId, connection);
        s.ctx.openTerminal(ref, { quiet: true });
      }
      else if (stillThere()) s.ctx.notify?.(`Spawned ${d.instance} on ${d.server}; its runtime is not visible yet. Check the server roster to open it.`);
      return;
    }
    // Older CLIs can spawn remotely but do not yet expose a remote roster.
    if (d.server && !d.workspaceId) {
      if (!owns()) return;
      ui.btn.disabled = false; ui.btn.textContent = "Spawn";
      ui.status.classList?.remove("err");
      ui.status.textContent = `Spawned ${d.instance} on ${d.server}. Attach with: oats session attach --server ${d.server} --instance ${d.instance}`;
      return;
    }
    const current = () => owns() && myGen === workspaceGeneration();
    // Poll and open by COMPOSITE identity — the spawn result's home plus the
    // selected agent's root disambiguate a same-named twin (review @7dd1e7b).
    const spawnedRef = { instance: d.instance, ...(d.home ? { home: d.home } : {}), ...(a.agentsRoot ? { agentsRoot: a.agentsRoot } : {}), ...(d.server ? { server: d.server } : {}) };
    let admitted;
    const visible = await waitForInstanceInPanel(s, spawnedRef, current, { ...s.waitOpts, onAdmitted: row => { admitted = row; } });
    if (!current()) return;
    if (!visible) { ui.status.textContent = `Spawned ${d.instance} — roster is catching up; open it from the sidebar instance roster.`; return; }
    // Success is a HANDOFF, not a status line: close the modal (the spawn
    // form's job is done — leaving it up with "Opening terminal…" reads as
    // stuck) and land the user in the new instance's terminal. quiet: the
    // auto-open must never block with an alert() — if the instance vanished
    // between the readiness poll and the open, the sidebar roster is the
    // recovery path, same as the timeout degradation above.
    if (typeof d.home === 'string' && admitted?.home === d.home && admitted.agent === a.name && admitted.agentsRoot === a.agentsRoot) {
      s.ctx.notifySpawn?.(admitted, currentWorkspace(), connection);
    }
    closeSpawnModal(s);
    s.ctx.openTerminal(spawnedRef, { quiet: true });
  } catch (e) {
    if (owns()) {
      ui.status.classList?.add("err");
      // Ambiguous relation identity (kernel E_RELATIVE_AMBIGUOUS). The
      // picker ALWAYS sends the anchor's root, so this rarely means "pick
      // better": the kernel also fires it when an already-qualified target
      // cannot round-trip under shadowing, when a parent relation's
      // generated name is shadowed, and on INHERITED bare-name edges copied
      // from the anchor (case d) — names this form never sent. The kernel
      // message names the conflicting instance and homes: surface it
      // verbatim with the general remedy (reviews cbd5bb3 + f1e3211).
      ui.status.textContent = e.code === "E_RELATIVE_AMBIGUOUS"
        ? `Spawn failed: ${e.message} — instance names collide across agent roots; rename or retire the shadowing instance (or pick a different purpose) and retry.`
        : `Spawn failed: ${e.message || e}`;
    }
  } finally {
    if (owns() && !ui.spawned) { ui.btn.disabled = false; ui.btn.textContent = "Spawn"; }
  }
}
