/* oats desktop — "Active" overview: reported runtime and relationship
   observations, not an inferred activity feed. Agent clusters — connected
   components of parent/child/sibling links (see clusters.mjs) — are the
   primary visual unit: each multi-member cluster renders as a card with its
   internal tidy tree (parent/child solid elbows; sibling links as
   dotted horizontal edges between peers — never color alone). Unrelated
   single instances collect in a visually quieter "Independent" strip below.
   Layout inside a cluster is a layered tidy tree, deliberately NOT
   force-directed: deterministic, no jitter.
   Node cards show reported runtime state (running = filled orange dot;
   stopped = hollow dot + dashed card; unknown distinct). Activity is NOT
   inferred from task/transcript prose: K7 observations remain unknown. Click
   selects and shows the action popover; double-click / Enter opens the
   terminal; hovering highlights the lineage.
   Canvas: pan by drag, zoom by pinch/⌘-wheel or the −/+/fit controls; the
   graph auto-fits the visible screen on first paint and after workspace
   switches; each agent box can be grabbed and moved freely (drag past the
   click threshold — spawn edges follow live, and offsets persist across the
   4s refresh).
   Keyboard: arrows walk the tree, Enter/t opens the terminal, b Brain,
   s Spawn view, o action popover, +/- zoom, f fits, Escape clears.
   Contract: mount(el, ctx) / unmount(); data from GET /api/panel only. */
import { computeClusters, siblingEdges } from "./clusters.mjs";
import { runtimeState, runtimeCounts } from "../instance-presentation.mjs";
import { instanceId, resolveLinkId } from "../instance-tree.mjs";
import { projectActivePanel, activeSignature, activeTargetLabel, canAddressInstance, BRAIN_UNAVAILABLE } from "../active-observation.mjs";
import {
  apiJson, ensureTheme,
  currentWorkspace, setWorkspace, adoptWorkspace, onWorkspaceChange,
  renderWorkspaceSelect, wsQuery, workspaceGeneration,
} from "./common.mjs";
import { registerAction } from "../keybindings.mjs";
import { resolveViewKey } from "../view-keys.mjs";

export const hierarchyCSS = `
.hier { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg); color: var(--fg);
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.hier * { box-sizing: border-box; }
.hier-bar { display: flex; align-items: center; gap: 10px; height:48px; flex: none; padding:0 12px 0 16px;
            border-bottom: 1px solid var(--border); background: var(--surface); }
.hier-sum { color: var(--muted); font-size: 12.5px; }
.hier-sum b { color: var(--fg); font-weight: 600; }
.hier .spawnbtn { min-height:28px; padding:4px 12px; font-size:12px; }
.hier-notice { flex:none; display:flex; align-items:center; gap:8px; padding:8px 16px; color:var(--muted); background:var(--surface); font-size:12px; overflow-wrap:anywhere; }
.hier-notice-message { flex:1; }
.hier-retry { flex:none; }
.hier-notice[hidden] { display:none; }
.hier-canvas:focus-visible { outline:2px solid var(--accent); outline-offset:-3px; }
.hier :is(button,select):focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.hier-canvas { flex: 1; position: relative; overflow: hidden; min-height: 0; cursor: grab; outline: none; }
.hier-canvas.panning { cursor: grabbing; }
.hier-stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.hier-group { position: absolute; }
.hier-group.hier-cluster { background:var(--surface-2);
                           border: 1px solid var(--border); border-radius: 14px; }
.hier-group.hier-solo .hnode { box-shadow: none; }
.hier-chead { position: absolute; left: 14px; top: 9px; display: flex; align-items: baseline; gap: 8px;
              max-width: calc(100% - 24px); white-space: nowrap; pointer-events: none; }
.hier-chead .cnm { color: var(--muted); font-size: 11px; font-weight: 650; text-transform: uppercase;
                   letter-spacing: .06em; overflow: hidden; text-overflow: ellipsis; }
.hier-chead .cct { color: var(--muted); font-size: 11px; }
.hier-context { position:absolute; left:14px; top:26px; max-width:calc(100% - 28px); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--muted); font-size:11px; }
.hier-zoom { position: absolute; right: 14px; bottom: 14px; z-index: 5; display: flex; gap: 4px;
             background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 3px; box-shadow: var(--shadow); }
.hier-zoom button { background: none; border: none; color: var(--muted); font: 14px/1 inherit; width: 26px; height: 24px;
                    border-radius: 5px; cursor: pointer; }
.hier-zoom button:hover { background: var(--surface-2); color: var(--fg); }
.hier-edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.hier-edges path { stroke: var(--graph-edge); stroke-width: 1.5; fill: none; }
.hier-edges path.sib { stroke-dasharray:2 4; }
.hier-edges path.lit { stroke: var(--accent); stroke-width: 2; }
.hier-ws { position: absolute; color: var(--faint); font-size: 11px; font-weight: 650;
           text-transform: uppercase; letter-spacing: .06em; white-space: nowrap; }
.hnode { position: absolute; width:220px; min-height:60px; background: var(--surface); border: 1px solid var(--border);
         border-radius: 10px; padding:9px 12px; box-shadow: var(--shadow); cursor: pointer; user-select: none; }
.hnode.dragging { cursor: grabbing; }
.hnode:hover { background: var(--surface-2); }
.hnode.idle { border-style: dashed; background: var(--surface-2); }
.hnode.sel { border-color: var(--accent); background: var(--sel); }
.hnode.lit { border-color: var(--accent); }
.hnode .hname { font-weight: 600; font-size: 13px; display: flex; align-items: center; gap:8px; min-width: 0; }
.hnode .hname .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hnode .hmeta { color: var(--muted); font-size: 11.5px; margin-top:3px; padding-left:16px; overflow: hidden;
                text-overflow: ellipsis; white-space: nowrap; }
.hdot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.hdot.on { background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
.hdot.unknown { background: var(--warn); border: 1.5px dashed var(--fg); }
.hdot.off { background: transparent; border: 1.5px solid var(--faint); }
.hier-pop { position: absolute; z-index:4; width:224px; max-width:calc(100% - 16px); background:var(--surface); border:1px solid var(--border);
            border-radius:10px; box-shadow:var(--shadow); padding:11px 12px; font-size:12px; overflow-wrap:anywhere; }
.hier-pop .pname { margin:0 0 8px; font-size:12.5px; font-weight:650; }
.hier-pop .pstate, .hier-pop .pavailability, .hier-pop .pstatus { margin:0 0 8px; color:var(--muted); line-height:1.5; }
.hier-pop .pstatus:empty { display:none; }
.hier-pop .pactions-note { color:var(--muted); font-size:11px; line-height:1.5; margin:8px 0 0; }
.hier-pop .pidentity { color:var(--muted); font:11px/1.5 var(--mono,monospace); margin:0 0 8px; }
.hier-pop .pidentity[hidden] { display:none; }
.hier-pop .pchips { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 9px; }
.hier-pop .pacts { display:flex; gap:6px; flex-wrap:wrap; }
.hier-pop .pacts button { flex: 1; }
.hier-empty-wrap { flex: 1; display: flex; align-items: center; justify-content: center; }
`;

const NODE_W = 220, NODE_H = 60, GAP_X = 50, GAP_Y = 40, PAD = 40;
const CL_PAD = 18, CL_LEFT = 60, CL_HEAD = 26, CL_GAP = 44, ROW_MAX = 1000, SOLO_GAP_Y = 20;

/* Name index over a roster: name -> instance[] (resolveLinkId's shape). */
function nameIndex(instances) {
  const byName = new Map();
  for (const i of instances) {
    if (!byName.has(i.instance)) byName.set(i.instance, []);
    byName.get(i.instance).push(i);
  }
  return byName;
}

/* Tidy-tree layout for a forest: post-order, children centered under the
   parent; leaves packed left-to-right. Returns nodes with x/y set.
   IDENTITY: nodes key by instanceId, and parent NAMES resolve through the
   shared resolveLinkId — duplicate names across agents roots stay distinct
   nodes. rosterByName is the FULL-roster name index: resolution scope must
   not shrink to the cluster, or a globally-ambiguous name could falsely
   become "unique" post-clustering and reintroduce a dropped edge (review
   3ab2a40). Callers without a wider roster may omit it. */
export function layoutForest(instances, rosterByName) {
  const byId = new Map(instances.map((i) => [instanceId(i), { inst: i, id: instanceId(i), children: [] }]));
  const byName = rosterByName || nameIndex(instances);
  const roots = [];
  const parentOf = new Map();
  for (const n of byId.values()) {
    const pid = n.inst.parentInstance ? resolveLinkId(n.inst, n.inst.parentInstance, byName) : null;
    const p = pid && byId.get(pid);
    if (p && p !== n) { p.children.push(n); parentOf.set(n, p); }
    else roots.push(n);
  }
  const stateRank = instance => instance.running === true ? 0 : instance.running === false ? 1 : 2;
  const rank = (a, b) => stateRank(a.inst) - stateRank(b.inst)
    || String(a.inst.instance).localeCompare(String(b.inst.instance)) || a.id.localeCompare(b.id);

  // A malformed parentInstance cycle has no natural root and used to vanish
  // entirely. Mark normal root-reachable nodes, then promote one deterministic
  // node from every still-unreachable component and sever only its incoming
  // edge. Because every node has at most one parent, that single cut breaks the
  // component's cycle while retaining all nodes and all other valid edges.
  const reachable = new Set();
  const mark = (n) => {
    if (reachable.has(n)) return;
    reachable.add(n);
    n.children.forEach(mark);
  };
  roots.forEach(mark);
  for (const start of [...byId.values()].sort(rank)) {
    if (reachable.has(start)) continue;

    // Follow parent links from this node until the path repeats. `start` may
    // be a valid descendant that merely sorts ahead of its malformed cycle;
    // only nodes in the repeated suffix are eligible for promotion.
    const path = [], pathIndex = new Map();
    let cursorNode = start;
    while (cursorNode && !reachable.has(cursorNode) && !pathIndex.has(cursorNode)) {
      pathIndex.set(cursorNode, path.length);
      path.push(cursorNode);
      cursorNode = parentOf.get(cursorNode);
    }
    const cycle = cursorNode && pathIndex.has(cursorNode)
      ? path.slice(pathIndex.get(cursorNode))
      : [];
    const promoted = cycle.length ? [...cycle].sort(rank)[0] : start;
    const p = parentOf.get(promoted);
    if (p) p.children = p.children.filter((child) => child !== promoted);
    parentOf.delete(promoted);
    roots.push(promoted);
    mark(promoted);
  }

  roots.sort(rank);
  let cursor = 0; // next free leaf x slot
  const place = (n, depth) => {
    n.children.sort(rank);
    n.depth = depth;
    n.y = depth * (NODE_H + GAP_Y);
    if (!n.children.length) {
      n.x = cursor;
      cursor += NODE_W + GAP_X;
      return;
    }
    for (const c of n.children) place(c, depth + 1);
    const first = n.children[0], last = n.children[n.children.length - 1];
    n.x = (first.x + last.x) / 2;
    // parent wider than its subtree span never overlaps a neighbor
    if (n.x + NODE_W + GAP_X > cursor) cursor = n.x + NODE_W + GAP_X;
  };
  for (const r of roots) place(r, 0);
  const all = [];
  const collect = (n) => { all.push(n); n.children.forEach(collect); };
  roots.forEach(collect);
  return { nodes: all, width: Math.max(cursor - GAP_X, NODE_W), height: (Math.max(...all.map((n) => n.y), 0)) + NODE_H };
}

let state = null, viewSequence = 0;

/* Cluster-level placement: multi-member clusters flow left-to-right in
   wrapping rows (deterministic — cluster order comes from computeClusters);
   singletons collect in one quiet "Independent" block below. Every node's
   x/y is made group-LOCAL including the card padding/header, so the
   existing drag/edge/fit machinery works unchanged. Pure — exported for
   tests. */
export function layoutClusters(instances) {
  const clusters = computeClusters(instances);
  // FULL-roster name index: all relation resolution inside clusters (forest
  // parents, sibling edges) must use global scope — see layoutForest's note.
  const rosterByName = nameIndex((instances || []).filter((i) => i && i.instance));
  const multi = clusters.filter((c) => c.size > 1);
  const solo = clusters.filter((c) => c.size === 1);

  const placed = [];
  let cx = 0, cy = 0, rowH = 0;
  for (const c of multi) {
    const lay = layoutForest(c.instances, rosterByName);
    for (const n of lay.nodes) { n.x += CL_LEFT + n.depth * 40; n.y += CL_HEAD + CL_PAD; }
    const w = Math.max(...lay.nodes.map(n => n.x + NODE_W)) + CL_PAD;
    const h = lay.height + CL_HEAD + CL_PAD * 2;
    if (cx > 0 && cx + w > ROW_MAX) { cx = 0; cy += rowH + CL_GAP; rowH = 0; }
    placed.push({ cluster: c, nodes: lay.nodes, x: cx, y: cy, w, h,
                  sibs: siblingEdges(c, rosterByName) });
    cx += w + CL_GAP;
    rowH = Math.max(rowH, h);
  }

  let soloBlock = null;
  if (solo.length) {
    const top = placed.length ? cy + rowH + CL_GAP : 0;
    const perRow = Math.max(1, Math.floor(ROW_MAX / (NODE_W + GAP_X)));
    const nodes = solo.map((c, i) => ({
      inst: c.instances[0], id: instanceId(c.instances[0]), children: [],
      x: (i % perRow) * (NODE_W + GAP_X),
      y: CL_HEAD + Math.floor(i / perRow) * (NODE_H + SOLO_GAP_Y),
    }));
    const rows = Math.ceil(solo.length / perRow);
    soloBlock = {
      nodes, x: 0, y: top,
      w: Math.min(solo.length, perRow) * (NODE_W + GAP_X) - GAP_X,
      h: CL_HEAD + rows * (NODE_H + SOLO_GAP_Y) - SOLO_GAP_Y,
    };
  }

  let width = 0, height = 0;
  for (const p of placed) { width = Math.max(width, p.x + p.w); height = Math.max(height, p.y + p.h); }
  if (soloBlock) { width = Math.max(width, soloBlock.w); height = Math.max(height, soloBlock.y + soloBlock.h); }
  return { placed, soloBlock, clusters, width: Math.max(width, NODE_W), height: Math.max(height, NODE_H) };
}

const DRAG_THRESHOLD = 5; // px before a node-drag moves its tree (else it's a click)

export function mount(el, ctx) {
  ensureTheme(el.ownerDocument);
  const s = state = {
    el, ctx, win: el.ownerDocument.defaultView, windowFocused:true, panel: { instances: [] }, sel: null,
    request:0, loading:false, dataGen:null, dataWorkspace:null, stale:true, signature:null, pending:null,
    renderEpoch:0, actionTicket:0, domId:`active-${++viewSequence}`, nodeIds:new Map(), nextNodeId:0,
    tx: PAD, ty: PAD, z: 1, fitted: false,
    nodeOffsets: new Map(),        // instance -> {x,y} user-dragged box offsets
    timers: [], unsubWs: null, alive: true,
    nodeEls: new Map(), lineage: new Set(),
  };
  el.innerHTML = `
    <div class="hier oats-view" style="display:flex">
      <style>${hierarchyCSS}</style>
      <div class="hier-bar">
        <select class="field wssel" aria-label="Workspace" style="display:none"></select>
        <span class="hier-sum"><span class="spinner"></span></span>
        <span style="flex:1"></span>
        <button class="act primary spawnbtn" title="Choose a soul in Workspace to spawn">＋ Spawn</button>
      </div>
      <div class="hier-notice" role="status" aria-live="polite" hidden><span class="hier-notice-message"></span><button class="act hier-retry" type="button">Retry roster</button></div>
      <div class="hier-canvas" tabindex="0" role="tree" aria-label="Active agents by cluster">
        <div class="hier-zoom">
          <button class="zout" title="Zoom out" aria-label="Zoom out">−</button>
          <button class="zin" title="Zoom in" aria-label="Zoom in">+</button>
          <button class="zfit" title="Fit to screen" aria-label="Fit to screen">⤢</button>
        </div>
      </div>
    </div>`;
  s.q = (cls) => el.querySelector("." + cls);
  s.canvas = s.q("hier-canvas");
  s.q('hier-retry').addEventListener('click', () => { if (s.alive) void refresh(s); });
  s.q("wssel").addEventListener("change", (e) => setWorkspace(e.target.value));
  s.q("spawnbtn").addEventListener("click", () => openWorkspace(s));
  if (!ctx.openView) { s.q("spawnbtn").disabled = true; s.q("spawnbtn").title = 'Workspace navigation is unavailable in this host'; }
  s.q("zin").addEventListener("click", () => zoomBy(s, 1.2));
  s.q("zout").addEventListener("click", () => zoomBy(s, 1 / 1.2));
  s.q("zfit").addEventListener("click", () => { if (visibleOwner(s)) fit(s); });

  // canvas pan by drag (ignore drags that start on a node/popover/controls)
  s.pan = null;
  s.canvas.addEventListener("mousedown", (e) => {
    if (!visibleOwner(s) || e.button !== 0 || e.target.closest(".hnode") || e.target.closest(".hier-pop") || e.target.closest(".hier-zoom")) return;
    s.fitted = true; // an explicit camera gesture wins over a later first observation
    s.pan = { x: e.clientX - s.tx, y: e.clientY - s.ty };
    s.canvas.classList.add("panning");
    closePop(s);
  });
  s.win.addEventListener("mousemove", s.onMove = (e) => {
    if (!visibleOwner(s)) { cancelGesture(s); return; }
    if (s.drag) { onNodeDragMove(s, e); return; }
    if (!s.pan) return;
    s.tx = e.clientX - s.pan.x; s.ty = e.clientY - s.pan.y;
    applyTransform(s);
  });
  s.win.addEventListener('blur', s.onBlur = () => { s.windowFocused = false; cancelGesture(s); });
  s.win.addEventListener('focus', s.onFocus = () => { s.windowFocused = true; });
  s.win.addEventListener('resize', s.onResize = () => { if (visibleOwner(s)) { if (!s.fitted) fit(s); positionPop(s); } });
  s.win.addEventListener("mouseup", s.onUp = (e) => {
    if (!visibleOwner(s)) { cancelGesture(s); return; }
    if (s.drag) { onNodeDragEnd(s, e); return; }
    s.pan = null; s.canvas.classList.remove("panning"); applyPending(s);
  });

  // zoom: pinch / ⌘-wheel zooms about the cursor; plain wheel pans
  s.canvas.addEventListener("wheel", (e) => {
    if (!visibleOwner(s) || e.defaultPrevented) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.01);
      zoomBy(s, factor, e.clientX, e.clientY);
    } else {
      s.tx -= e.deltaX; s.ty -= e.deltaY;
      applyTransform(s);
    }
  }, { passive: false });

  // keyboard: walk the tree, Enter opens terminal, f fits, Escape clears
  s.canvas.addEventListener("keydown", (e) => onKey(s, e));

  // Register the canvas keys as actions. Their DEFAULT chords ride the
  // registration (engine addendum 3: defaultChord) so the shortcuts editor
  // shows them honestly and Backspace/reset behave. The context is a VIEW
  // context the shell never activates (review afd2114): these actions are
  // editor-visible and conflict-checked but window-dispatch-INELIGIBLE —
  // matchEvent skips them before selecting/preventDefault, so an outside
  // rail/sidebar keypress is not swallowed and colliding global actions
  // still run. ALL dispatch is view-local (onKey → resolveViewKey against
  // the engine's effective bindings). Disposed on unmount.
  s.viewActions = [
    { id: "hier.fit", defaultChord: "F", label: "Hierarchy: fit to screen", run: () => fit(s) },
    { id: "hier.terminal", defaultChord: "T", label: "Hierarchy: open terminal of selection", run: () => { if (s.sel) openTerm(s, s.sel); } },
    { id: "hier.brain", defaultChord: "B", label: "Hierarchy: open Brain of selection", run: () => openSelBrain(s) },
    { id: "hier.spawn", defaultChord: "S", label: "Hierarchy: open the Spawn view", run: () => openWorkspace(s) },
    { id: "hier.popover", defaultChord: "O", label: "Hierarchy: open the action popover", run: () => { if (s.sel) { openPop(s, s.sel); s.pop?.querySelector('button:not(:disabled)')?.focus(); } } },
    { id: "hier.zoomIn", defaultChord: "=", label: "Hierarchy: zoom in", run: () => zoomBy(s, 1.2) },
    { id: "hier.zoomOut", defaultChord: "-", label: "Hierarchy: zoom out", run: () => zoomBy(s, 1 / 1.2) },
  ];
  s.disposers = s.viewActions.map((a) => registerAction({
    id: a.id, label: a.label, context: "view:hierarchy", run: a.run, defaultChord: a.defaultChord,
  }));

  s.unsubWs = onWorkspaceChange(() => { resetObservation(s); void refresh(s); });
  refresh(s);
  s.timers.push(setInterval(() => { if (!s.loading) void refresh(s); }, 4000));

  return () => teardown(s);
}

export function unmount() { if (state) teardown(state); }

function teardown(s) {
  if (!s.alive) return;
  s.alive = false; s.request++; s.actionTicket++; s.pending = null; s.pan = null; s.drag = null;
  s.win.clearTimeout(s.clickResetTimer);
  s.timers.forEach(clearInterval);
  (s.disposers || []).forEach((off) => { try { off(); } catch {} });
  if (s.unsubWs) s.unsubWs();
  s.win.removeEventListener("mousemove", s.onMove);
  s.win.removeEventListener("mouseup", s.onUp);
  s.win.removeEventListener('resize', s.onResize);
  s.win.removeEventListener('blur', s.onBlur); s.win.removeEventListener('focus', s.onFocus);
  s.el.innerHTML = "";
  if (state === s) state = null;
}

const docOf = s => s.el?.ownerDocument || document;
function node(s, tag, text, cls) {
  const el = docOf(s).createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function visibleOwner(s, element = s.canvas) {
  if (!s.alive || s.windowFocused === false || !element?.isConnected) return false;
  for (let parent = element; parent; parent = parent.parentElement) {
    if (parent.hidden || parent.inert || parent.style?.display === 'none' || parent.style?.visibility === 'hidden') return false;
  }
  return true;
}
function dataCurrent(s) {
  return s.alive && s.dataGen === workspaceGeneration() && s.dataWorkspace === currentWorkspace();
}
function actionsCurrent(s) { return dataCurrent(s) && !s.stale && !s.pending; }
function notice(s, message) {
  const el = s.q('hier-notice'); if (!el) return;
  const text = el.querySelector?.('.hier-notice-message');
  if (text) text.textContent = message; else el.textContent = message;
  el.hidden = !message;
}
function clearCanvas(s) {
  const controls = s.canvas.querySelector('.hier-zoom');
  s.canvas.innerHTML = ''; if (controls) s.canvas.append(controls);
  s.nodeEls.clear(); s.dragConsumedClick = null; s.canvas.removeAttribute?.('aria-activedescendant');
}
function cancelGesture(s) {
  if (!s.alive) return;
  s.drag?.node.classList.remove('dragging'); s.drag = null; s.pan = null; s.dragConsumedClick = null;
  s.canvas.classList.remove('panning'); if (s.alive) applyPending(s);
}
function resetObservation(s) {
  s.request = (s.request || 0) + 1; s.actionTicket = (s.actionTicket || 0) + 1;
  closePop(s); s.sel = null; s.fitted = false; s.nodeOffsets.clear(); s.nodeIds?.clear();
  s.drag?.node.classList.remove('dragging'); s.drag = null; s.dragConsumedClick = null; s.pan = null;
  s.canvas.classList.remove('panning'); s.pending = null; s.signature = null; s.bounds = null;
  s.panel = { instances: [] }; s.loading = false; s.dataGen = null; s.dataWorkspace = null; s.stale = true;
  clearCanvas(s); s.q('hier-sum').textContent = 'Loading reported roster…'; notice(s, '');
}
function acceptObservation(s, panel, gen) {
  const signature = activeSignature(panel);
  const ids = new Set(panel.instances.map(instanceId));
  for (const key of s.nodeOffsets.keys()) if (!ids.has(key)) s.nodeOffsets.delete(key);
  for (const key of s.nodeIds?.keys() || []) if (!ids.has(key)) s.nodeIds.delete(key);
  s.panel = panel; s.dataGen = gen; s.dataWorkspace = currentWorkspace(); s.stale = !!panel.error; s.pending = null;
  if (s.ctx.hasWorkspaceSwitcher) s.q('wssel').style.display = 'none';
  else renderWorkspaceSelect(s.q('wssel'), panel.workspaces, panel.workspace?.id || '');
  notice(s, panel.error ? `Roster unavailable: ${panel.error.slice(0, 300)}. Showing a reported observation, not current state; actions disabled.` : '');
  if (signature !== s.signature) { s.signature = signature; render(s); }
  else { if (!s.fitted) fit(s); updatePop(s); }
}
function applyPending(s) {
  const pending = s.pending; s.pending = null;
  if (!pending || !s.alive || pending.gen !== workspaceGeneration() || pending.request !== s.request) return;
  acceptObservation(s, pending.panel, pending.gen);
}

/* Every request owns BOTH outcomes, even within the same workspace. */
export async function refresh(s) {
  if (!s.alive) return;
  const myGen = workspaceGeneration(), requestedWorkspace = currentWorkspace();
  const request = s.request = (s.request || 0) + 1;
  const owns = () => s.alive && request === s.request && myGen === workspaceGeneration();
  s.loading = true;
  try {
    const data = await apiJson(s.ctx, `/api/panel${wsQuery()}`);
    if (!owns()) return;
    const panel = projectActivePanel(data);
    if (panel.error && !panel.instances.length) throw Error(panel.error); // failed absence is not an observed empty roster
    if (requestedWorkspace && panel.workspace?.id && panel.workspace.id !== requestedWorkspace) throw Error('The roster reply belongs to a different workspace. Choose the workspace again.');
    if (!requestedWorkspace && panel.workspace?.id) adoptWorkspace(panel.workspace.id);
    if ((s.drag || s.pan) && activeSignature(panel) !== s.signature) {
      s.pending = { panel, gen: myGen, request }; updatePop(s);
      notice(s, 'Roster changed during this gesture; the latest observation will apply on release.');
      return;
    }
    acceptObservation(s, panel, myGen);
  } catch (error) {
    if (!owns()) return;
    s.pending = null; s.stale = true; s.actionTicket = (s.actionTicket || 0) + 1;
    if (s.dataGen == null) s.q('hier-sum').textContent = 'Roster unknown';
    notice(s, `Roster unavailable: ${String(error?.message || 'read failed').slice(0, 300)}. ${s.dataGen == null ? 'No current observation.' : 'Showing the last observation, not current state; actions disabled.'}`);
    updatePop(s);
  } finally { if (owns()) s.loading = false; }
}

function render(s) {
  const canvas = s.canvas;
  const prevPop = s.popFor, preservedPop = s.pop, focused = docOf(s).activeElement;
  const preserveFocus = preservedPop?.contains(focused);
  s.renderEpoch = (s.renderEpoch || 0) + 1;
  clearCanvas(s);
  const list = s.panel.instances || [];
  const { running, stopped, unknown } = runtimeCounts(list);
  const status = `<b>${running}</b> running · <b>${stopped}</b> stopped${unknown ? ` · <b>${unknown}</b> unknown` : ""}`;
  s.q("hier-sum").innerHTML =
    status;
  if (!list.length) {
    s.q('hier-sum').innerHTML = `${status} · <b>0</b> groups`;
    s.sel = null; closePop(s);
    const w = document.createElement("div");
    w.className = "hier-empty-wrap";
    w.style.height = "100%";
    w.innerHTML = `<div class="empty"><span class="big">◎</span>` +
      `No instances reported in this observation.<br>Choose a soul in Workspace or use <code>oats spawn &lt;agent&gt;</code>.</div>`;
    canvas.append(w);
    return;
  }

  // Clusters — connected components over the FULL roster's parent/child +
  // sibling links — are computed before any visual decoration, so a valid
  // relation crossing agent/workspace roots never turns a child into an
  // orphan. Node metadata still identifies its repo/root.
  const { placed, soloBlock, width, height } = layoutClusters(list);
  const nGroups = placed.length, nIndependent = soloBlock?.nodes.length || 0;
  s.q("hier-sum").innerHTML = `${status} · <b>${nGroups}</b> group${nGroups === 1 ? '' : 's'}${nIndependent ? ` · <b>${nIndependent}</b> independent` : ''}`;
  const stage = document.createElement("div");
  stage.className = "hier-stage";

  s.edgesByNode = new Map(); // instance -> [path els touching it]
  s.bounds = { w: width, h: height };

  const BLEED = 2000; // edge svg overdraw so dragged boxes keep their edges
  const groupFor = (block, key, ariaLabel, cls) => {
    const group = document.createElement("div");
    group.className = "hier-group" + (cls ? " " + cls : "");
    group.dataset.ws = key;
    group.style.left = `${block.x}px`;
    group.style.top = `${block.y}px`;
    group.style.width = `${block.w}px`;
    group.style.height = `${block.h}px`;
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", ariaLabel);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("hier-edges");
    svg.setAttribute("width", block.w + BLEED * 2);
    svg.setAttribute("height", block.h + NODE_H + BLEED * 2);
    svg.setAttribute("viewBox", `${-BLEED} ${-BLEED} ${block.w + BLEED * 2} ${block.h + NODE_H + BLEED * 2}`);
    svg.style.left = `${-BLEED}px`; svg.style.top = `${-BLEED}px`;
    group.append(svg);
    // final position = tidy layout + any user drag offset
    for (const n of block.nodes) {
      const off = s.nodeOffsets.get(n.id) || { x: 0, y: 0 };
      n.fx = n.x + off.x; n.fy = n.y + off.y;
      group.append(nodeEl(s, n, key));
    }
    const addEdge = (p, a, b) => {
      svg.append(p);
      for (const nm of [a, b]) {
        if (!s.edgesByNode.has(nm)) s.edgesByNode.set(nm, []);
        s.edgesByNode.get(nm).push(p);
      }
    };
    for (const n of block.nodes) {
      for (const c of n.children) {
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.dataset.child = c.id;
        p.dataset.parent = n.id;
        drawEdge(p, n, c);
        addEdge(p, n.id, c.id);
      }
    }
    // sibling links: dashed peer edges, distinct by STYLE (never color alone)
    const byId = new Map(block.nodes.map((n) => [n.id, n]));
    for (const { a, b } of block.sibs || []) {
      const na = byId.get(a), nb = byId.get(b);
      if (!na || !nb) continue;
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.classList.add("sib");
      p.dataset.parent = a; p.dataset.child = b; // endpoint names for redraw on drag
      drawSiblingEdge(p, na, nb);
      addEdge(p, a, b);
    }
    return group;
  };

  // Cluster cards are ANONYMOUS by design (human decision): the header
  // carries only counts/status — no derived name. c.name remains an
  // internal, deterministic grouping/ordering key only, never shown.
  // Cluster naming may return later tied to a task-layer integration.
  for (const pc of placed) {
    const c = pc.cluster;
    const aria = `Cluster of ${c.size} agents, ${c.running} running${c.unknown ? `, ${c.unknown} unknown` : ""}`;
    const group = groupFor(pc, c.name, aria, "hier-cluster");
    const head = document.createElement("div");
    head.className = "hier-chead";
    head.append(node(s, 'span', `${c.running}/${c.size} running${c.unknown ? ` · ${c.unknown} unknown` : ''}`, 'cct'));
    group.prepend(head);
    const contexts = [...new Set(c.instances.map(i => i.repoName).filter(Boolean))];
    if (contexts.length) { const metadata = node(s, 'div', `Reported context: ${contexts.join(' · ')}`, 'hier-context'); metadata.title = metadata.textContent; group.append(metadata); }
    stage.append(group);
  }
  if (soloBlock) {
    const group = groupFor({ ...soloBlock, sibs: [] }, "Independent",
      `Independent agents: ${soloBlock.nodes.length}`, "hier-solo");
    const head = document.createElement("div");
    head.className = "hier-chead solo";
    head.innerHTML = `<span class="cnm">Independent</span>` +
      `<span class="cct">${soloBlock.nodes.length}</span>`;
    group.prepend(head);
    stage.append(group);
  }
  canvas.append(stage);
  // first paint (or workspace switch): fit the forest to the visible screen
  if (!s.fitted) fit(s); else applyTransform(s);
  if (s.sel && !list.some((i) => instanceId(i) === s.sel)) s.sel = null;
  paintSelection(s);
  // keep the popover across the 4s refresh if its instance still exists
  if (prevPop && list.some((i) => instanceId(i) === prevPop)) {
    openPop(s, prevPop, preservedPop);
    // Retain the actual focused control, but never reclaim focus moved by a
    // synchronous blur handler elsewhere. No request completion selects a node.
    if (preserveFocus && visibleOwner(s, focused) && docOf(s).activeElement === docOf(s).body) focused.focus({ preventScroll: true });
  } else { s.pop = null; s.popFor = null; }
}

function nodeEl(s, n, wsName) {
  const i = n.inst, id = n.id ?? instanceId(i), status = runtimeState(i);
  const d = node(s, 'div', undefined, 'hnode' + (status === 'stopped' ? ' idle' : status === 'unknown' ? ' unknown' : ''));
  s.nodeIds ||= new Map();
  if (!s.nodeIds.has(id)) s.nodeIds.set(id, `${s.domId || 'active'}-node-${s.nextNodeId = (s.nextNodeId || 0) + 1}`);
  d.id = s.nodeIds.get(id);
  d.style.left = `${n.fx}px`; d.style.top = `${n.fy}px`;
  d.setAttribute('role', 'treeitem'); d.setAttribute('aria-level', String((n.depth || 0) + 1));
  const target = activeTargetLabel(i, s.panel.instances);
  d.setAttribute('aria-label', `${i.instance}, ${status}${target ? `, ${target}` : ''}`);
  d.dataset.name = i.instance; d.dataset.id = id;
  const name = node(s, 'div', undefined, 'hname');
  const dot = node(s, 'span', undefined, `hdot ${status === 'running' ? 'on' : status === 'stopped' ? 'off' : 'unknown'}`); dot.setAttribute('aria-hidden', 'true');
  name.append(dot, node(s, 'span', i.instance, 'nm'));
  const metadata = [target, i.repoName || 'Context not reported', i.runtime || 'Runtime not reported', i.branch ? `Branch: ${i.branch}` : '', status === 'unknown' ? 'state unknown' : ''].filter(Boolean).join(' · ');
  d.append(name, node(s, 'div', metadata, 'hmeta'));
  d.title = `${i.instance}\n${metadata}\nHome: ${i.home || 'not reported'}\nRoot: ${i.agentsRoot || 'not reported'}`;
  const current = () => dataCurrent(s) && visibleOwner(s, d) && !s.pending && s.nodeEls.get(id)?.el === d;
  d.addEventListener('mousedown', e => {
    if (!current() || e.button !== 0) return;
    s.fitted = true;
    e.stopPropagation();
    const off = s.nodeOffsets.get(id) || { x: 0, y: 0 };
    s.drag = { name: id, node: d, n, startX: e.clientX, startY: e.clientY, off: { ...off }, moved: false };
  });
  d.addEventListener('click', e => {
    e.stopPropagation();
    if (!current()) return;
    if (s.dragConsumedClick?.node === d) { s.dragConsumedClick = null; return; }
    select(s, id); s.canvas.focus?.({ preventScroll: true });
  });
  d.addEventListener('dblclick', e => { e.stopPropagation(); if (current()) openTerm(s, id); });
  d.addEventListener('mouseenter', () => { if (current()) litLineage(s, id, true); });
  d.addEventListener('mouseleave', () => { if (current()) litLineage(s, id, false); });
  s.nodeEls.set(id, { el: d, node: n, ws: wsName });
  return d;
}

function openWorkspace(s, owner = () => true) {
  if (!visibleOwner(s) || !owner() || !s.ctx.openView) return;
  const gen = workspaceGeneration(), ticket = s.actionTicket = (s.actionTicket || 0) + 1, pop = s.pop;
  const failed = error => {
    if (!visibleOwner(s) || !owner() || gen !== workspaceGeneration() || ticket !== s.actionTicket || s.pop !== pop) return;
    const message = `Workspace unavailable: ${String(error?.message || 'navigation failed').slice(0, 300)}`;
    const status = pop?.querySelector('.pstatus');
    if (status) setText(status, message); else { try { s.ctx.notify?.(message); } catch { /* optional host feedback */ } }
  };
  try { Promise.resolve(s.ctx.openView('spawn')).catch(failed); } catch (error) { failed(error); }
}

function selectedInstance(s, id) {
  if (!dataCurrent(s)) return null;
  const matches = (s.panel.instances || []).filter(i => instanceId(i) === id);
  return matches.length === 1 ? matches[0] : null;
}
function invokeInstance(s, id, action) {
  const i = selectedInstance(s, id);
  if (!actionsCurrent(s) || !visibleOwner(s) || !canAddressInstance(i)) return;
  const call = action === 'terminal' && i.running === true && s.ctx.openTerminal ? () => s.ctx.openTerminal({
    instance: i.instance, home: i.home || undefined, agentsRoot: i.agentsRoot || undefined, ...(i.server ? { server: i.server } : {}),
  }) : action === 'start' && i.running === false && s.ctx.startInstance ? () => s.ctx.startInstance(i)
    : action === 'restart' && i.running === true && s.ctx.restartInstance ? () => s.ctx.restartInstance(i) : null;
  if (!call) return;
  const ticket = s.actionTicket = (s.actionTicket || 0) + 1, gen = workspaceGeneration(), epoch = s.renderEpoch, pop = s.pop;
  const failed = error => {
    if (!actionsCurrent(s) || !visibleOwner(s) || gen !== workspaceGeneration() || ticket !== s.actionTicket || epoch !== s.renderEpoch || s.pop !== pop || s.popFor !== id) return;
    const status = pop?.querySelector('.pstatus'); if (status) status.textContent = `Action unavailable: ${String(error?.message || 'request failed').slice(0, 300)}`;
  };
  try { Promise.resolve(call()).catch(failed); } catch (error) { failed(error); }
}
/* Terminal and Start handoffs use the exact current home/root/server, never a
 * captured instance object or a bare name. Unknown state does not mean stopped. */
function openTerm(s, id) {
  const i = selectedInstance(s, id);
  if (i) invokeInstance(s, id, i.running === false ? 'start' : 'terminal');
}

/* Edge between a parent and child node, from their FINAL (fx/fy) positions. */
function drawEdge(p, parent, child) {
  const x1 = parent.fx + 20, y1 = parent.fy + NODE_H;
  const x2 = child.fx, y2 = child.fy + NODE_H / 2;
  const middle = (y1 + child.fy) / 2, trunk = Math.min(x1, x2 - 20);
  p.setAttribute('d', `M ${x1} ${y1} V ${middle} H ${trunk} V ${y2} H ${x2}`);
}

/* Sibling peer edge: a dotted connection between two boxes' vertical
   midpoints — distinguishable from parent edges by STYLE (dotted peer line),
   not color alone. */
function drawSiblingEdge(p, a, b) {
  const [l, r] = a.fx <= b.fx ? [a, b] : [b, a];
  const x1 = l.fx + NODE_W, y1 = l.fy + NODE_H / 2;
  const x2 = r.fx, y2 = r.fy + NODE_H / 2;
  const mx = (x1 + x2) / 2;
  p.setAttribute('d', `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`);
}

/* Redraw one edge path from its endpoints' final positions. */
function redrawEdge(s, p) {
  const a = s.nodeEls.get(p.dataset.parent)?.node;
  const b = s.nodeEls.get(p.dataset.child)?.node;
  if (!a || !b) return;
  if (p.classList.contains("sib")) drawSiblingEdge(p, a, b);
  else drawEdge(p, a, b);
}

function onNodeDragMove(s, e) {
  const dr = s.drag;
  const dx = (e.clientX - dr.startX) / s.z, dy = (e.clientY - dr.startY) / s.z;
  if (!dr.moved && Math.hypot(e.clientX - dr.startX, e.clientY - dr.startY) < DRAG_THRESHOLD) return;
  if (!dr.moved) { dr.moved = true; dr.node.classList.add("dragging"); closePop(s); }
  const nx = dr.off.x + dx, ny = dr.off.y + dy;
  s.nodeOffsets.set(dr.name, { x: nx, y: ny });
  dr.n.fx = dr.n.x + nx; dr.n.fy = dr.n.y + ny;
  dr.node.style.left = `${dr.n.fx}px`;
  dr.node.style.top = `${dr.n.fy}px`;
  // redraw only the edges touching this box
  for (const p of s.edgesByNode?.get(dr.name) || []) redrawEdge(s, p);
}

function onNodeDragEnd(s) {
  const dr = s.drag;
  s.drag = null;
  dr.node.classList.remove("dragging");
  if (dr.moved) {
    // Suppress only this gesture's native click. If mouseup happened elsewhere,
    // do not swallow a future intentional click on the same node.
    const suppression = s.dragConsumedClick = { node: dr.node };
    s.win.clearTimeout(s.clickResetTimer);
    s.clickResetTimer = s.win.setTimeout(() => {
      if (s.alive && s.dragConsumedClick === suppression) s.dragConsumedClick = null;
    }, 0);
  }
  applyPending(s);
}

function applyTransform(s) {
  const stage = s.canvas.querySelector(".hier-stage");
  if (stage) stage.style.transform = `translate(${s.tx}px, ${s.ty}px) scale(${s.z})`;
  positionPop(s);
}

const Z_MIN = 0.25, Z_MAX = 2;
function zoomBy(s, factor, cx, cy) {
  if (!visibleOwner(s)) return;
  s.fitted = true;
  const rect = s.canvas.getBoundingClientRect();
  const px = cx != null ? cx - rect.left : rect.width / 2;   // zoom about cursor (or center)
  const py = cy != null ? cy - rect.top : rect.height / 2;
  const nz = Math.min(Z_MAX, Math.max(Z_MIN, s.z * factor));
  const k = nz / s.z;
  s.tx = px - (px - s.tx) * k;
  s.ty = py - (py - s.ty) * k;
  s.z = nz;
  applyTransform(s);
}

/* Fit the whole forest (incl. dragged offsets) inside the visible canvas. */
function fit(s) {
  if (!s.alive) return;
  if (typeof s.canvas.getBoundingClientRect !== "function") return; // non-DOM host (tests)
  const rect = s.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height || !s.bounds || !s.bounds.w) { s.tx = PAD; s.ty = PAD; s.z = 1; applyTransform(s); return; }
  s.fitted = true;
  // actual extent: every node's FINAL (layout + drag) position
  let minX = 0, minY = 0, maxX = s.bounds.w, maxY = s.bounds.h + NODE_H;
  for (const { el, node } of s.nodeEls.values()) {
    const gx = Number(el.parentElement?.style.left?.replace("px", "") || 0);
    const gy = Number(el.parentElement?.style.top?.replace("px", "") || 0);
    const fx = gx + (node.fx ?? node.x), fy = gy + (node.fy ?? node.y);
    minX = Math.min(minX, fx); minY = Math.min(minY, fy);
    maxX = Math.max(maxX, fx + NODE_W); maxY = Math.max(maxY, fy + NODE_H);
  }
  const w = maxX - minX, h = maxY - minY;
  const z = Math.min(Z_MAX, Math.max(Z_MIN, Math.min((rect.width - PAD * 2) / w, (rect.height - PAD * 2) / h, 1)));
  s.z = z;
  s.tx = (rect.width - w * z) / 2 - minX * z;
  s.ty = Math.max(PAD, (rect.height - h * z) / 2 - minY * z);
  applyTransform(s);
}

/* lineage highlight: ancestors + descendants of the hovered node (by id;
   parent names resolve through the shared resolver) */
function litLineage(s, id, on) {
  const list = s.panel.instances || [];
  const byId = new Map(list.map((i) => [instanceId(i), i]));
  const byName = new Map();
  for (const i of list) {
    if (!byName.has(i.instance)) byName.set(i.instance, []);
    byName.get(i.instance).push(i);
  }
  const parentIdOf = (i) => (i.parentInstance ? resolveLinkId(i, i.parentInstance, byName) : null);
  const kin = new Set([id]);
  let cur = byId.get(id);
  while (cur) {
    const pid = parentIdOf(cur);
    if (!pid || kin.has(pid) || !byId.has(pid)) break;
    kin.add(pid); cur = byId.get(pid);
  }
  const grow = (nid) => {
    for (const i of list) {
      const iid = instanceId(i);
      if (parentIdOf(i) === nid && !kin.has(iid)) { kin.add(iid); grow(iid); }
    }
  };
  grow(id);
  for (const [nm, { el }] of s.nodeEls) el.classList.toggle("lit", on && kin.has(nm) && nm !== s.sel);
  for (const paths of (s.edgesByNode || new Map()).values()) {
    for (const p of paths) {
      const lit = on && kin.has(p.dataset.child) && kin.has(p.dataset.parent);
      p.classList.toggle("lit", lit);
    }
  }
}

function select(s, name) {
  if (!dataCurrent(s) || !visibleOwner(s) || s.pending || !s.nodeEls.has(name)) return;
  s.actionTicket = (s.actionTicket || 0) + 1;
  s.sel = name; paintSelection(s); openPop(s, name);
}

function paintSelection(s) {
  for (const [id, { el }] of s.nodeEls) {
    el.classList.toggle('sel', id === s.sel); el.setAttribute('aria-selected', String(id === s.sel));
  }
  const selected = s.sel && s.nodeEls.get(s.sel)?.el;
  if (selected) s.canvas.setAttribute?.('aria-activedescendant', selected.id);
  else s.canvas.removeAttribute?.('aria-activedescendant');
}

function closePop(s) {
  s.pop?.remove(); s.pop = null; s.popFor = null;
  s.actionTicket = (s.actionTicket || 0) + 1;
}
const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };

function openPop(s, id, retained = null) {
  const entry = s.nodeEls.get(id), i = selectedInstance(s, id);
  if (!entry || !i) return;
  let pop = retained;
  if (!pop) {
    closePop(s);
    pop = node(s, 'section', undefined, 'hier-pop'); pop.setAttribute('aria-label', 'Selected instance actions');
    pop.append(node(s, 'h2', '', 'pname'), node(s, 'p', '', 'pidentity'), node(s, 'p', '', 'pstate'),
      node(s, 'p', 'Activity: unknown · Waiting on you: unknown', 'pavailability'));
    const chips = node(s, 'div', undefined, 'pchips'); chips.append(node(s, 'span', '', 'chip rt'), node(s, 'span', '', 'chip pbranch')); pop.append(chips);
    const actions = node(s, 'div', undefined, 'pacts');
    const button = (label, cls) => { const el = node(s, 'button', label, `act ${cls}`); el.type = 'button'; actions.append(el); return el; };
    const terminal = button('Terminal', 'pterm'), git = button('Git', 'pgit');
    git.disabled = true; git.title = 'Available after K1/P1';
    const restart = s.ctx.restartInstance ? button('Restart with…', 'prestart') : null;
    const brain = button('Brain', 'pbrain'); brain.disabled = true; brain.title = BRAIN_UNAVAILABLE;
    const workspace = s.ctx.openView ? button('Workspace', 'pworkspace') : null;
    const owns = () => dataCurrent(s) && visibleOwner(s, pop) && s.pop === pop && s.popFor === id;
    terminal.addEventListener('click', () => { if (owns()) openTerm(s, id); });
    restart?.addEventListener('click', () => { if (owns()) invokeInstance(s, id, 'restart'); });
    workspace?.addEventListener('click', () => openWorkspace(s, owns));
    const status = node(s, 'p', '', 'pstatus'); status.setAttribute('role', 'status');
    pop.append(actions, node(s, 'p', 'Activity/waiting: available after K7. Git: available after K1/P1.', 'pactions-note'),
      node(s, 'p', 'Brain: choose the exact soul in Workspace.', 'pactions-note'), status);
  }
  s.pop = pop; s.popFor = id;
  // Keep action text screen-sized: camera zoom transforms nodes, not the popup.
  s.canvas.append(pop);
  updatePop(s);
}

function updatePop(s) {
  const pop = s.pop, i = selectedInstance(s, s.popFor);
  if (!pop || !i) return;
  setText(pop.querySelector('.pname'), i.instance);
  const identity = pop.querySelector('.pidentity'); identity.hidden = !activeTargetLabel(i, s.panel.instances);
  setText(identity, `Host: ${i.server || (i.remote ? 'not reported' : 'local')} · Root: ${i.agentsRoot || 'not reported'} · Home: ${i.home || 'not reported'}`);
  setText(pop.querySelector('.pstate'), `Reported runtime: ${runtimeState(i)}${s.stale ? ' (last observation)' : ''}`);
  setText(pop.querySelector('.rt'), i.runtime || 'Runtime not reported');
  setText(pop.querySelector('.pbranch'), i.branch ? `Reported branch: ${i.branch}` : 'Branch not reported');
  const allowed = actionsCurrent(s) && canAddressInstance(i);
  const terminal = pop.querySelector('.pterm');
  setText(terminal, i.running === false ? 'Start…' : 'Terminal');
  terminal.disabled = !allowed || (i.running === true ? !s.ctx.openTerminal : i.running === false ? !s.ctx.startInstance : true);
  terminal.title = terminal.disabled ? 'Requires a current, addressed instance with known runtime state and an available route.' : i.running === false ? 'Open the existing Start dialog' : 'Open this exact instance terminal';
  const restart = pop.querySelector('.prestart'); if (restart) restart.disabled = !allowed || i.running !== true;
  positionPop(s);
}

function positionPop(s) {
  const pop = s.pop, entry = s.nodeEls.get(s.popFor);
  if (!pop || !entry) return;
  const rect = s.canvas.getBoundingClientRect?.(), group = entry.el.parentElement;
  const gx = parseFloat(group?.style.left) || 0, gy = parseFloat(group?.style.top) || 0;
  const nx = s.tx + (gx + (entry.node.fx ?? entry.node.x)) * s.z;
  let x = nx + NODE_W * s.z + 10, y = s.ty + (gy + (entry.node.fy ?? entry.node.y)) * s.z;
  if (rect?.width && rect.height) {
    const width = Math.min(224, Math.max(40, rect.width - 16));
    pop.style.maxHeight = `${Math.max(40, rect.height - 16)}px`; pop.style.overflow = 'auto';
    if (x + width > rect.width - 8) x = nx - width - 10;
    x = Math.max(8, Math.min(x, rect.width - width - 8));
    y = Math.max(8, Math.min(y, rect.height - 8 - (pop.offsetHeight || Math.min(280, rect.height - 16))));
  }
  pop.style.left = `${x}px`; pop.style.top = `${y}px`;
}

/* /api/panel enumerates INSTANCES, not every soul definition. Even one local
 * instance cannot prove that a bare agent name identifies a unique Brain.
 * Keep the shortcut visible but fail closed; Workspace has the soul roster. */
function openSelBrain(s) {
  if (!visibleOwner(s) || !selectedInstance(s, s.sel)) return;
  if (!s.pop) openPop(s, s.sel);
  setText(s.pop?.querySelector('.pstatus'), BRAIN_UNAVAILABLE);
}

/* keyboard tree-walk over the laid-out nodes. Escape/Enter/arrows are the
   tree's structural keys (not rebindable); everything else resolves through
   the engine keymap so shortcut-editor rebinds take effect here. */
function onKey(s, e) {
  if (!dataCurrent(s) || !visibleOwner(s) || s.pending || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
  const list = s.panel.instances || [];
  if (!list.length) return;
  if (e.key === 'Escape') { e.preventDefault(); s.sel = null; paintSelection(s); closePop(s); s.canvas.focus?.({ preventScroll: true }); return; }
  // Native popup buttons own Enter/Space; tree commands must not also open a
  // terminal when the focused button's intent is Start, Restart or Workspace.
  if (e.target.closest?.('button,input,select,textarea,[contenteditable=true]')) return;
  if (e.repeat && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  // [ / ] hop between clusters (selects the hopped-to cluster's first node)
  // — structural like the arrows; fit moved to the rebindable hier.fit action
  if (e.key === "[" || e.key === "]") {
    e.preventDefault();
    const groups = [];
    for (const { node, ws } of s.nodeEls.values()) {
      let g = groups.find((x) => x.ws === ws);
      if (!g) { g = { ws, first: node }; groups.push(g); }
      else if (node.y < g.first.y || (node.y === g.first.y && node.x < g.first.x)) g.first = node;
    }
    if (!groups.length) return;
    const curWs = s.sel ? s.nodeEls.get(s.sel)?.ws : null;
    const at = groups.findIndex((g) => g.ws === curWs);
    const next = groups[(at + (e.key === "]" ? 1 : -1) + groups.length) % groups.length]
      || groups[0];
    select(s, next.first.id);
    return;
  }
  // Enter opens with FULL identity (openTerm), never the bare selection id
  if (e.key === "Enter" && s.sel) { e.preventDefault(); openTerm(s, s.sel); return; }
  const hit = resolveViewKey(e, s.viewActions);
  if (hit) {
    e.preventDefault();
    s.viewActions.find((a) => a.id === hit)?.run();
    return;
  }
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
  e.preventDefault();
  if (!s.sel) { select(s, instanceId(list[0])); return; }
  const cur = s.nodeEls.get(s.sel);
  if (!cur) return;
  const byId = new Map(list.map((i) => [instanceId(i), i]));
  const byName = new Map();
  for (const i of list) {
    if (!byName.has(i.instance)) byName.set(i.instance, []);
    byName.get(i.instance).push(i);
  }
  if (e.key === "ArrowUp") {
    const me = byId.get(s.sel);
    const pid = me?.parentInstance ? resolveLinkId(me, me.parentInstance, byName) : null;
    if (pid && s.nodeEls.has(pid)) select(s, pid);
  } else if (e.key === "ArrowDown") {
    const kid = cur.node.children[0];
    if (kid) select(s, kid.id);
  } else {
    // peers: same row (y) within the SAME cluster group, ordered by x
    const sibs = [...s.nodeEls.values()].filter((x) => x.node.y === cur.node.y && x.ws === cur.ws).sort((a, b) => a.node.x - b.node.x);
    const at = sibs.findIndex((x) => x.node.id === s.sel);
    const next = sibs[at + (e.key === "ArrowRight" ? 1 : -1)];
    if (next) select(s, next.node.id);
  }
}
