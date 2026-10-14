/* oats desktop — command palette (app.palette: ⌘K on macOS, Ctrl+Shift+P on
   Linux/Windows; the keymap engine owns the chord and its terminal policy).
   One input, two result kinds: instances (default; jump-to-terminal) and
   commands (also matched by name — ">" prefix restricts to commands).
   Instances are listed like the sidebar roster (spec F): the same deployment
   sections, relation groups, order and depth, from the sidebar's own builders
   (packages/client: rosterSections, roster-sections.mjs; rosterGroups, instance-tree.mjs);
   a query keeps tree order, showing each match with its non-matching ancestors
   as disabled context rows. Instances whose terminal was focused lead, most
   recent first, in a flat Recent group (Spec C; the record is
   instance-recency.mjs, the sidebar roster keeps its stable order). While open, the palette's own chord moves the
   active row down (Shift + the chord: up), skipping context rows.
   Overlay chrome + fuzzy machinery live in overlay-picker.mjs (shared with
   Quick Open); this module owns only the palette's row semantics. */
import { runtimeState } from "../../client/instance-presentation.mjs";
import { filterInstanceTree, instanceId } from "../../client/instance-tree.mjs";
import { rosterSections, splitByDeployment, isMultiDeployment } from "../../client/roster-sections.mjs";
import { DESKTOP_TERMS } from "./desktop-terms.mjs";
import { createOverlayPicker, subsequenceScore } from "./overlay-picker.mjs";

/** Commands listed at most (after every instance row; the instance list scrolls). */
export const PALETTE_COMMAND_CAP = 12;

/** The Recent group's key: never a roster group's, so a following group never merges into it. */
const RECENT_GROUP = Object.freeze({ key: "\u0000recent", label: "Recent" });

/** Pure row computation — exported for tests. `roster` is the panel's
 * `{ instances, deployments, recent?, activeId? }` (one snapshot), or just the
 * instances where there is a single deployment; `commands` the static command
 * list, `raw` the input value. `recent` is the workspace's last-focus record
 * (Map<instanceId, time>, instance-recency.mjs) and `activeId` the instanceId of
 * the terminal that is the active tab, if any.
 * Instances whose terminal was focused come first, in one flat Recent group, most
 * recent first; every other instance follows in the sidebar's tree presentation,
 * each instance once. Instance rows carry { depth, group: { key, label }, under? }
 * and, for an ancestor shown only as a match's context, { context: true } and no
 * run. A recent row also carries { recent: true } and, with a parent, shows its
 * "under <parent>" ({ showUnder: true }); the row the palette opens on
 * when it is not the first, { initial: true }. */
export function paletteRows(roster, commands, raw, { openTerminal } = {}) {
  const instances = (Array.isArray(roster) ? roster : roster?.instances) || [];
  const deployments = (Array.isArray(roster) ? null : roster?.deployments) || [];
  const recent = !Array.isArray(roster) && roster?.recent instanceof Map ? roster.recent : new Map();
  const activeId = (Array.isArray(roster) ? null : roster?.activeId) ?? null;
  const cmdMode = raw.startsWith(">");
  const q = (cmdMode ? raw.slice(1) : raw).trim();
  const rows = [];
  if (!cmdMode) {
    // The house fuzzy matcher decides what matches; the tree path around a
    // match is the sidebar's (identity-aware filterInstanceTree).
    const matches = (inst) => !q || subsequenceScore(`${inst.instance} ${inst.agent || ""} ${inst.repoName || ""}`, q) != null;
    const isRecent = (inst) => recent.has(instanceId(inst));
    const instanceRow = (inst, depth, group, parent) => ({
      label: inst.instance,
      detail: [inst.server, inst.agent, inst.branch, runtimeState(inst)].filter(Boolean).join(" · "),
      dot: inst.running === true ? true : inst.running === false ? false : null,
      depth,
      group,
      // Depth reaches assistive technology as words (aria-level is not an option's).
      ...(parent ? { under: `under ${parent}` } : {}),
    });
    const opens = (inst) => () => openTerminal({ instance: inst.instance, home: inst.home, agentsRoot: inst.agentsRoot, ...(inst.server ? { server: inst.server } : {}) });
    // The sidebar's tree over the instances `keep` leaves of each deployment's
    // roster: its relation groups, order and depth. Relations and a match's
    // context rows stay inside its deployment, as in the sidebar (#482).
    const treeOf = (keep) => {
      const visible = isMultiDeployment(deployments)
        ? [...splitByDeployment(deployments)(instances).values()].flatMap(keep)
        : keep(instances);
      const out = [];
      for (const section of rosterSections(instances, visible, deployments, DESKTOP_TERMS)) for (const each of section.groups) {
        // A group is named, and kept apart, by its deployment where there are several.
        const group = section.deployment
          ? { key: `${section.deployment.id}|${each.key}`, label: `${section.label} · ${each.label}` }
          : { key: each.key, label: each.label };
        for (const cluster of each.clusters) for (const inst of cluster.instances) {
          const depth = inst.depth || 0;
          out.push({ inst, depth, group, parent: depth > 0 && inst.parentInstance ? inst.parentInstance : null });
        }
      }
      return out;
    };
    // Recent: the matching instances with a recorded focus, most recent first,
    // flat, each keeping its relation context from the full tree. An entry for an
    // instance no longer in the roster has no row.
    const recentRows = [];
    if (recent.size) {
      const time = (inst) => recent.get(instanceId(inst));
      const listed = treeOf((own) => own).filter(({ inst }) => isRecent(inst) && matches(inst));
      for (const { inst, parent } of listed.sort((a, b) => time(b.inst) - time(a.inst))) {
        recentRows.push({ ...instanceRow(inst, 0, RECENT_GROUP, parent), recent: true, ...(parent ? { showUnder: true } : {}), run: opens(inst) });
      }
      // ⌘K, Enter goes back to the previous instance: when the most recent is the
      // terminal in front, the palette opens on the second recent row.
      if (!q && recentRows.length > 1 && activeId != null && instanceId(listed[0].inst) === activeId) recentRows[1].initial = true;
    }
    rows.push(...recentRows);
    // Then the rest in the tree presentation. With a query the tree holds the
    // non-recent matches and their ancestors, shown as context rows.
    const rest = q
      ? (own) => filterInstanceTree(own, q, (inst) => matches(inst) && !isRecent(inst))
      : (own) => own.filter((inst) => !isRecent(inst));
    for (const { inst, depth, group, parent } of treeOf(rest)) {
      const row = instanceRow(inst, depth, group, parent);
      if (q && (!matches(inst) || isRecent(inst))) row.context = true;
      else row.run = opens(inst);
      rows.push(row);
    }
  }
  const commandRows = [];
  for (const c of commands) {
    const sc = q ? subsequenceScore(c.label, q) : 0;
    if (sc == null) continue;
    // detail may be a function so chord labels stay live against the
    // current keymap (rebinding in the editor updates the next render).
    const detail = typeof c.detail === "function" ? c.detail() : (c.detail || "");
    commandRows.push({ sc, label: c.label, detail, dot: null, run: c.run });
  }
  commandRows.sort((a, b) => a.sc - b.sc);
  return [...rows, ...commandRows.slice(0, PALETTE_COMMAND_CAP).map(({ sc, ...row }) => row)];
}

/**
 * @param {object} deps
 * @param {(e: KeyboardEvent) => (1|-1|0)} [deps.cycleKey] while open: 1 when
 *        the event is the palette's own chord (move down), -1 for Shift + it
 *        (move up), 0 otherwise. The shell derives it from the live keymap.
 */
export function createPalette({ loadInstances, openTerminal, commands = [], cycleKey, doc }) {
  return createOverlayPicker({
    placeholder: 'Jump to an instance… (">" for commands)',
    ariaLabel: "Command palette",
    loadItems: async () => { try { return await loadInstances(); } catch { return []; } },
    computeRows: (roster, raw) => paletteRows(roster || [], commands, raw, { openTerminal }),
    cycleKey,
    doc, // undefined: the picker's own default (the global document)
  });
}
