/* oats desktop — command palette (app.palette: ⌘K on macOS, Ctrl+Shift+P on
   Linux/Windows; the keymap engine owns the chord and its terminal policy).
   One input, two result kinds: instances (default; jump-to-terminal) and
   commands (also matched by name — ">" prefix restricts to commands).
   Instances are listed like the sidebar roster (spec F): the same relation
   groups, order and depth, from the sidebar's own builders (instance-tree.mjs);
   a query keeps tree order, showing each match with its non-matching ancestors
   as disabled context rows. While open, the palette's own chord moves the
   active row down (Shift + the chord: up), skipping context rows.
   Overlay chrome + fuzzy machinery live in overlay-picker.mjs (shared with
   Quick Open); this module owns only the palette's row semantics. */
import { runtimeState } from "./instance-presentation.mjs";
import { filterInstanceTree, rosterGroups } from "./instance-tree.mjs";
import { createOverlayPicker, subsequenceScore } from "./overlay-picker.mjs";

/** Commands listed at most (after every instance row; the instance list scrolls). */
export const PALETTE_COMMAND_CAP = 12;

/** Pure row computation — exported for tests. `instances` is the roster,
 * `commands` the static command list, `raw` the input value. Instance rows
 * carry { depth, group: { key, label }, under? } and, for an ancestor shown
 * only as a match's context, { context: true } and no run. */
export function paletteRows(instances, commands, raw, { openTerminal } = {}) {
  const cmdMode = raw.startsWith(">");
  const q = (cmdMode ? raw.slice(1) : raw).trim();
  const rows = [];
  if (!cmdMode) {
    // The house fuzzy matcher decides what matches; the tree path around a
    // match is the sidebar's (identity-aware filterInstanceTree).
    const matches = (inst) => !q || subsequenceScore(`${inst.instance} ${inst.agent || ""} ${inst.repoName || ""}`, q) != null;
    const visible = filterInstanceTree(instances, q, matches);
    for (const group of rosterGroups(instances, visible)) {
      for (const cluster of group.clusters) {
        for (const inst of cluster.instances) {
          const depth = inst.depth || 0;
          const row = {
            label: inst.instance,
            detail: [inst.server, inst.agent, inst.branch, runtimeState(inst)].filter(Boolean).join(" · "),
            dot: inst.running === true ? true : inst.running === false ? false : null,
            depth,
            group: { key: group.key, label: group.label },
            // Depth reaches assistive technology as words (aria-level is not an option's).
            ...(depth > 0 && inst.parentInstance ? { under: `under ${inst.parentInstance}` } : {}),
          };
          if (!matches(inst)) row.context = true;
          else row.run = () => openTerminal({ instance: inst.instance, home: inst.home, agentsRoot: inst.agentsRoot, ...(inst.server ? { server: inst.server } : {}) });
          rows.push(row);
        }
      }
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
    computeRows: (instances, raw) => paletteRows(instances || [], commands, raw, { openTerminal }),
    cycleKey,
    doc, // undefined: the picker's own default (the global document)
  });
}
