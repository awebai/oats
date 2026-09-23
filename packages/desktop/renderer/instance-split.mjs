/** Plan an exact instance's destination without mutating selection/layout.
 * Existing tabs move into an empty group; a second viewer is never created. */
import { requestSplit } from './split-layout.mjs';
export function instanceSplitPlan({ split, activeId, tabs, workspace, visible }) {
  const no = reason => ({ available: false, reason });
  if (!visible) return no('Open a current-workspace terminal group first.');
  const terminals = [...tabs].filter(([, t]) => t.kind === 'terminal' && t.workspace === workspace);
  const source = terminals.some(([id]) => id === activeId);
  const focused = split?.groups.find(g => g.id === split.focusedGroup);
  if (!source && !(focused && !focused.tabs.length)) return no('Select a terminal or an empty terminal group first.');
  if (split?.groups.some(g => g.tabs.some(id => !terminals.some(([tid]) => tid === id)))) return no('Terminal layout no longer belongs to this workspace.');
  if (focused && !focused.tabs.length) return { available: true, split, destination: focused.id, reason: '' };
  if (split?.groups.some(g => !g.tabs.length)) return no('Select an existing empty group first.');
  const planned = requestSplit(split, split?.orientation ?? 'row', terminals.map(([id]) => id), activeId);
  const destination = planned.split?.groups.find(g => g.id === planned.split.focusedGroup && !g.tabs.length);
  if (!planned.changed || !destination) return no('The terminal group limit is reached; select an empty destination.');
  return { available: true, split: planned.split, destination: destination.id, reason: '' };
}
export function instanceSplitIdentity({ split, activeId, tabs, workspace, visible }) {
  return JSON.stringify([workspace, visible, split, activeId, [...tabs].filter(([, t]) => t.kind === 'terminal' && t.workspace === workspace).map(([id, t]) => [id, t.key])]);
}
