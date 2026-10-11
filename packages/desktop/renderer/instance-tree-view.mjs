/** The Desktop's own half of the roster tree: the connectors it draws, its terminal tabs' keys, the
 * focus and scroll it keeps across a rebuild, the roster's count line and loading state. The tree
 * itself (identity, relations, groups, order, visibility) is the shared packages/client/instance-tree.mjs. */
import { createDataState, statusLine, skeleton, skeletonBlock, ROSTER_STALE_TITLE } from './loading.mjs';
import { instanceId, resolveLinkId, findRosterInstance } from '../../client/instance-tree.mjs';

/** Agent-group boundary for the instances sidebar (Workspace v4): groups
 * read from spacing alone — a 14px gap, no title — and the boundary is still
 * exposed to assistive technology (role=separator with the group's name and
 * size). The group is the relation cluster (never the repo); unrelated
 * instances share one "independent" group. Importable so the regression
 * exercises the exact builder the shell uses. */
export function clusterSeparator(doc, { label, count } = {}) {
  const gap = doc.createElement("div");
  gap.className = "ctx-group"; gap.setAttribute("role", "separator");
  gap.setAttribute("aria-label", `${label}, ${count} ${count === 1 ? "instance" : "instances"}`);
  gap.dataset.group = label;
  return gap;
}

/** Design connectors for one visible row, drawn from the dots (Redesign v3):
 * solid parent→child elbows (rounded into the child dot), solid pass-through
 * lines for open ancestor branches, and a DOTTED dot-to-dot link joining the
 * depth-0 members of one agent group (sibling relations). Every line sits on
 * a dot's centre column. `items` is the rendered group order. */
export function treeConnectors(items, item, allInstances = items) {
  const at = items.indexOf(item), depth = item.depth || 0;
  const segments = treeGuideSegments(items, item, allInstances);
  const out = [];
  segments.forEach((segment, level) => {
    if (segment === "continue") out.push({ kind: "line", level });
    else if (segment === "branch") out.push({ kind: "elbow", level }, { kind: "down", level });
    else if (segment === "end") out.push({ kind: "elbow", level });
  });
  // The stem: an expanded parent's own line leaves its dot downward to the
  // first child's elbow (the child is the very next rendered item).
  const next = at >= 0 ? items[at + 1] : null;
  if (next && (next.depth || 0) === depth + 1) out.push({ kind: "down", level: depth });
  const rootBefore = at > 0 && items.slice(0, at).some((i) => !(i.depth || 0));
  const rootAfter = at >= 0 && items.slice(at + 1).some((i) => !(i.depth || 0));
  if (!depth) {
    if (rootBefore) out.push({ kind: "link-in", level: 0 });
    if (rootAfter) out.push({ kind: "link-out", level: 0 });
  } else if (rootAfter) {
    if (segments[0] === "none") out.push({ kind: "link-through", level: 0 });
    else if (segments[0] === "end") out.push({ kind: "link-out", level: 0 });
  }
  return out;
}

/** Terminal-tab dedup key for an instance reference: workspace-scoped and
 * IDENTITY-scoped, so two same-named instances from different agents roots
 * are different terminals (review 46f3fdc). Bare-name refs key by name
 * (legacy callers; findRosterInstance already refuses ambiguous names). */
export function terminalKey(workspace, ref) {
  const id = typeof ref === "string" ? ref : instanceId(ref);
  return `term:${workspace}:${id}`;
}

/** Resolve a terminal-open reference and mint its canonical dedup key — in
 * that ORDER (review 7d740f9): the key must derive from the RESOLVED roster
 * instance, never the caller's ref shape, so a bare-name open and a sidebar
 * object open of the same identity share one tab, and a stale bare-name
 * tab can never be activated once the name has become ambiguous (resolution
 * refuses first). Returns { inst, key } or { error: "ambiguous"|"unknown" }.
 * Importable so the ordering regression exercises this exact layer. */
export function resolveTerminalOpen(instances, ref, workspace) {
  const name = typeof ref === "string" ? ref : ref.instance;
  const inst = findRosterInstance(instances, ref);
  if (!inst) {
    const dup = instances.filter((i) => i.instance === name).length > 1;
    return { error: dup ? "ambiguous" : "unknown", name };
  }
  return { inst, key: terminalKey(workspace, inst), name };
}

/** VS Code-style guide segments for one row in a flattened parent-first tree.
 * `continue` is an ancestor/sibling vertical; `branch` has a later sibling and
 * an elbow; `end` is the final sibling, stopping at its elbow; `none` suppresses
 * an exhausted ancestor line through deeper descendants.
 * Pass the full roster as allInstances when items is a cluster/filtered subset:
 * resolve parent names there first, using the same identity rules as clustering.
 * Then walk only visible ancestry and count only visible siblings — a hidden
 * parent stops the path, never falling back to a visible same-named twin. */
export function treeGuideSegments(items, item, allInstances = items) {
  const byName = new Map();
  for (const candidate of allInstances) {
    if (!byName.has(candidate.instance)) byName.set(candidate.instance, []);
    byName.get(candidate.instance).push(candidate);
  }
  const parentIdOf = new Map();
  for (const candidate of allInstances) {
    const id = instanceId(candidate);
    const pid = candidate.parentInstance ? resolveLinkId(candidate, candidate.parentInstance, byName) : null;
    if (pid && pid !== id) parentIdOf.set(id, pid);
  }
  const positions = new Map(items.map((candidate, index) => [instanceId(candidate), index]));
  const chain = [];
  const seen = new Set();
  let cursor = instanceId(item);
  while (positions.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    const pid = parentIdOf.get(cursor);
    if (!pid || !positions.has(pid)) break;
    chain.unshift(cursor);
    cursor = pid;
  }
  return chain.map((branch, index) => {
    const at = positions.get(branch);
    const hasLaterSibling = items.slice(at + 1)
      .some((candidate) => parentIdOf.get(instanceId(candidate)) === parentIdOf.get(branch));
    const current = index === chain.length - 1;
    if (!current) return hasLaterSibling ? "continue" : "none";
    return hasLaterSibling ? "branch" : "end";
  });
}

/** Capture focus identity + scroll before a keyed rebuild and return a restore
 * callback. Both disclosure and terminal buttons carry these data attributes. */
export function captureTreeRenderState(listEl) {
  const active = listEl.ownerDocument.activeElement;
  const inside = active && listEl.contains(active);
  const identity = inside ? {
    instance: active.dataset.treeInstance,
    control: active.dataset.treeControl,
  } : null;
  const scrollTop = listEl.scrollTop;
  return () => {
    if (!identity?.instance || !identity?.control) {
      listEl.scrollTop = scrollTop;
      return false;
    }
    const replacement = [...listEl.querySelectorAll("[data-tree-instance][data-tree-control]")]
      .find((element) => element.dataset.treeInstance === identity.instance
        && element.dataset.treeControl === identity.control
        && !element.disabled);
    // Chromium normally scrolls focused controls into view. preventScroll is
    // the primary guard; restoring afterward is a fallback for older engines
    // and ensures row reordering cannot overwrite the user's saved position.
    replacement?.focus({ preventScroll: true });
    listEl.scrollTop = scrollTop;
    return listEl.ownerDocument.activeElement === replacement;
  };
}

/** A first-launch request dispatched with ws="" may complete before or after
 * another view silently adopts the same server-resolved workspace. Both are
 * owned; a real generation/workspace change is not. A STALE dispatch (a
 * persisted selection the served list no longer contains, see
 * staleWorkspaceSelection) is resolved the same way and owned under the same
 * rule: the selection may still be current, or the other path may already
 * have adopted the served workspace. */
export function rosterResponseOwns({ dispatchWorkspace, responseWorkspace, currentWorkspace,
  dispatchGeneration, currentGeneration, staleDispatch = false }) {
  if (dispatchGeneration !== currentGeneration) return false;
  return currentWorkspace === dispatchWorkspace
    || ((!dispatchWorkspace || staleDispatch) && currentWorkspace === responseWorkspace);
}

/** Roster count line, "● 4 running · 2 stopped" (Redesign v3); unknown
 * liveness is named, never folded into either bucket.
 * `pending`: no read of this subject has succeeded yet, so the count is a
 * skeleton pill (reserving its width), never "0 running" (desktop/loading-states).
 * `failed`: the read failed with no data: the reserved box, empty and still.
 * `stale`: the last read failed and the count is the last observation. */
export function renderRosterCount(el, instances, { pending = false, stale = false, failed = false } = {}) {
  if (!el) return;
  const doc = el.ownerDocument;
  // Failed with no data: nothing is loading, so no shimmering pill — the box stays reserved, empty and still.
  if (failed) {
    if (el.dataset.rosterCount !== "failed") { const reserve = doc.createElement("span"); reserve.className = "ctx-count-reserve"; reserve.setAttribute("aria-hidden", "true"); el.replaceChildren(reserve); }
    el.dataset.rosterCount = "failed"; el.removeAttribute("title"); delete el.dataset.stale;
    return;
  }
  if (pending) {
    if (el.dataset.rosterCount !== "pending") el.replaceChildren(skeleton(doc, "pill"));
    el.dataset.rosterCount = "pending"; el.removeAttribute("title"); delete el.dataset.stale;
    return;
  }
  // Same tri-state as runtimeState(): only reported booleans count.
  const running = instances.filter((i) => i.running === true).length;
  const stopped = instances.filter((i) => i.running === false).length;
  const unknown = instances.length - running - stopped;
  const dot = doc.createElement("span"); dot.className = "ctx-count-dot"; dot.setAttribute("aria-hidden", "true");
  // The head says how many are running (human, 2026-09-26); the full breakdown stays in its title.
  // Stale: the count is the last observation, said to AT (a hidden span), shown muted (shell.css
  // reads data-stale) and titled; the visible number stays, because it is what was last observed.
  const last = doc.createElement("span"); last.className = "loading-sr ctx-count-stale"; last.textContent = "Last observation: ";
  el.replaceChildren(...(stale ? [last] : []), ...(running ? [dot] : []), doc.createTextNode(`${running} running`));
  el.dataset.rosterCount = "ready";
  const breakdown = [`${running} running`, `${stopped} stopped`, ...(unknown ? [`${unknown} unknown`] : [])].join(" · ");
  el.title = stale ? `Last observation — ${breakdown}` : breakdown;
  if (stale) el.dataset.stale = "1"; else delete el.dataset.stale;
}

/* ── the roster's loading state (desktop/loading-states) ─────────────────── */
/** Why Start… and the row actions menu are disabled while the roster is stale: the reason a
 * disabled control carries for the pointer (title) and for assistive tech (aria-description),
 * since a greyed look alone says nothing. */
export { ROSTER_STALE_TITLE };
export function markStaleControl(control) {
  // aria-disabled, never `disabled`: Chromium blurs a focused control that becomes disabled, and the roster
  // repaints under focus. Every handler on a stale-marked control checks `staleBlocked()` first.
  control.setAttribute("aria-disabled", "true"); control.title = ROSTER_STALE_TITLE; control.setAttribute("aria-description", ROSTER_STALE_TITLE);
}
/** True when `markStaleControl` marked this control: its activation must do nothing. */
export const staleBlocked = control => control?.getAttribute?.("aria-disabled") === "true";
/** The pending skeleton: five roster rows, the height of the real ones. */
export const ROSTER_SKELETON_ROWS = 5;

/** The sidebar roster's data-state controller (renderer/loading.mjs), wired
 * to the shipped chrome of `#instance-roster`:
 *   region / skeletonHost   .ctx-list  (aria-busy while pending; the skeleton or the failed block live here)
 *   indicatorHost           .ctx-head  ("Refreshing…" after the count)
 *   noticeHost              .ctx-status, created between the filter field and the list (the stale line + Retry)
 *   status                  a visually hidden role="status" line appended to the roster (the sidebar shows none)
 *   focusFallback           the filter input, when a focused Retry has to go
 * Test DOMs may lack the head or the filter field: the controller then has
 * no indicator host and the status host sits right before the list.
 * `now` / `setTimeout` / `clearTimeout` are the primitive's injectable clock. */
export function createRosterLoading(doc, rosterEl, { onRetry = null, now, setTimeout, clearTimeout } = {}) {
  const listEl = rosterEl.querySelector(".ctx-list");
  const status = statusLine(doc, { visuallyHidden: true });
  status.classList.add("ctx-loading-status");
  rosterEl.append(status);
  let noticeHost = rosterEl.querySelector(".ctx-status");
  if (!noticeHost) {
    noticeHost = doc.createElement("div"); noticeHost.className = "ctx-status";
    listEl.before(noticeHost);
  }
  // createDataState's defaults apply on undefined, so the clock passes straight through.
  return createDataState({
    doc, noun: "instances", region: listEl, skeletonHost: listEl,
    skeleton: () => skeletonBlock(doc, "roster-row", { count: ROSTER_SKELETON_ROWS }),
    status, indicatorHost: rosterEl.querySelector(".ctx-head"), noticeHost, onRetry,
    focusFallback: () => rosterEl.querySelector(".ctx-filter"),
    now, setTimeout, clearTimeout,
  });
}

/** What one roster paint depends on, as a string: a poll whose signature
 * equals the last painted one rebuilds nothing. `facts` carries whatever the
 * paint reads besides the instances (workspace, panel error, deployment
 * note, the active terminal key…). */
export function rosterSignature(instances, facts = {}) {
  return JSON.stringify([facts, instances]);
}
