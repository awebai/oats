/** A group heading in the Workspace view's grammar (design board 3): an icon, the group's name in
 * monospace and a muted qualifier. One helper for the Souls tab's groups (views/spawn.mjs) and the
 * Capabilities tab's repository groups (workspace-catalog.mjs), so a repository reads the same in
 * both. The class names are the Souls tab's, which introduced the grammar. */
import { iconElement } from './shell-icons.mjs';

export const groupHeadingCSS = `
.souls-group-title { display:flex; align-items:center; gap:8px; margin:0; padding:0 2px; color:var(--fg); font-size:13px; font-weight:650; min-width:0; }
.souls-group-title .shell-icon { flex:none; color:var(--muted); }
.souls-group-name { font:650 13px var(--mono,monospace); overflow-wrap:anywhere; }
.souls-group-name.plain { font-family:inherit; }
.souls-group-title.warn .souls-group-name { color:var(--warn); }
.souls-group-title.warn .shell-icon { color:var(--warn); }
.souls-group-note { color:var(--muted); font-size:12px; font-weight:500; overflow-wrap:anywhere; }
`;

/** The heading element: `<h{level}>` with the icon (data-icon names it), the name (`mono: false`
 * for words such as a team label) and the qualifier (always present, possibly empty). */
export function groupHeading(doc, { icon, name, note = '', mono = true, warn = false, level = 2 }) {
  const heading = doc.createElement(`h${level}`); heading.className = `souls-group-title${warn ? ' warn' : ''}`;
  const label = doc.createElement('span'); label.className = 'souls-group-name'; label.textContent = name;
  if (!mono) label.classList.add('plain');
  const mark = iconElement(doc, icon, { size: 15 }); mark.setAttribute('data-icon', icon);
  const qualifier = doc.createElement('span'); qualifier.className = 'souls-group-note'; qualifier.textContent = note;
  heading.append(mark, label, qualifier);
  return heading;
}
