/** A workspace view's deployments on screen (#482): their state in words, and the roster split by
 * deployment when a view has two or more.
 *
 * The facts come only from `/api/panel`: `deployments` (`{ id, machine, path, label, local, reachable,
 * identityFrom, primary, stale?, reason?, short?, fix?, note? }`) and each row's `deployment: { id, machine, path }`. Nothing
 * is derived from a host name or a path beyond the display label. A view with one deployment looks
 * exactly like a window before views: no deployment headings, no "On …" lines.
 *
 * Also a small session store fed by every panel the renderer reads (the shell's roster poll): the
 * last deployments seen per view, for surfaces that do not read the panel themselves (the "On …"
 * line, deployment-scope-line.mjs). */
import { rosterGroups } from './instance-tree.mjs';
import { machineLabelParts, THIS_MACHINE } from '../../client/deployment-label.mjs';
import { iconElement } from './shell-icons.mjs';

const text = (v, max = 4096) => typeof v === 'string' && v.length > 0 && v.length <= max;

/** The panel's deployments, validated (malformed entries dropped, never guessed). */
export function panelDeployments(panel) {
  const list = Array.isArray(panel?.deployments) ? panel.deployments : [];
  return list.filter(d => d && typeof d === 'object' && text(d.id)).map(d => ({
    id: d.id, machine: text(d.machine, 256) ? d.machine : (d.local === false ? '' : THIS_MACHINE), path: text(d.path) ? d.path : '',
    label: text(d.label, 512) ? d.label : '', local: d.local !== false, reachable: d.reachable === true,
    identityFrom: d.identityFrom === 'reported' || d.identityFrom === 'remembered' ? d.identityFrom : null, primary: d.primary === true,
    ...(d.stale === true ? { stale: true } : {}),
    ...(text(d.reason) ? { reason: d.reason } : {}), ...(text(d.short, 256) ? { short: d.short } : {}),
    ...(Array.isArray(d.fix) && d.fix.every(step => text(step)) && d.fix.length ? { fix: d.fix.slice(0, 8) } : {}),
    ...(text(d.note) ? { note: d.note } : {}),
  }));
}

/** Grouping and "On …" lines apply only to a view of two or more deployments. */
export const isMultiDeployment = deployments => Array.isArray(deployments) && deployments.length >= 2;

/** The deployment deployment-level surfaces read and act on: the one marked primary, else the first. */
export const primaryDeployment = deployments => (Array.isArray(deployments) && (deployments.find(d => d?.primary) || deployments[0])) || null;

/** A deployment's state, in words (never colour alone): `{ key, text, detail }`.
 * live: reached (or, on this computer, observed) now. stale: this computer's deployment whose last
 * re-read failed (its rows are the last observation). remembered: not reached, its workspace is the
 * last report. not reached / not observed: with why. */
export function deploymentState(d) {
  // This computer's deployment whose last re-read failed: its rows are the last observation.
  if (d?.stale) return { key: 'stale', text: 'stale', detail: d.reason || '' };
  if (d?.reachable) return { key: 'live', text: 'live', detail: '' };
  if (d?.identityFrom === 'remembered') {
    return { key: 'remembered', text: 'remembered', detail: ['Last report, not live now.', d.reason].filter(Boolean).join(' ') };
  }
  // This computer's own deployment is not "reached": it is observed or not, the reason says why
  // (still reading, or the kernel's refusal).
  if (d?.local) return { key: 'unobserved', text: 'not observed', detail: d.reason || '' };
  return { key: 'unreached', text: 'not reached', detail: d?.reason || '' };
}

/** The deployment a row belongs to, by the id the panel tagged it with (null when untagged). */
const rowDeployment = row => (text(row?.deployment?.id) ? row.deployment.id : null);

/** Whether a row is held from its deployment's last observation (the deployment is stale): its
 * Start and actions wait for a current read, as for a stale roster. */
export const rowStale = (row, deployments) => {
  const id = rowDeployment(row);
  return !!id && Array.isArray(deployments) && deployments.some(d => d?.id === id && d.stale);
};

/** The sidebar roster's sections. One deployment (or none reported): a single section with no
 * heading whose groups are exactly the relation clusters the roster always drew. Two or more: one
 * section per deployment, in the panel's order, each with its own clusters (relations are recorded
 * within one deployment); a row without a known deployment (a pending spawn) joins the primary's.
 * Sections with no visible row are left out. Each is labelled by its machine, with the path tail
 * only when one machine holds two (deployment-label.mjs machineLabels). Returns
 * `[{ deployment|null, label|null, groups }]`, a group being `{ key, label, clusters }` as before. */
export function rosterSections(instances, visible, deployments) {
  const groupsOf = (all, shown) => rosterGroups(all, shown); // the relation groups the palette lists too
  if (!isMultiDeployment(deployments)) return [{ deployment: null, label: null, groups: groupsOf(instances, visible) }];
  const sectionOf = splitByDeployment(deployments);
  const all = sectionOf(instances), shown = sectionOf(visible), labels = machineLabelParts(deployments);
  const label = ({ machine, tail }) => (tail ? `${machine} · ${tail}` : machine);
  return deployments.map(d => ({ deployment: d, parts: labels.get(d.id), all: all.get(d.id), shown: shown.get(d.id) }))
    .filter(s => s.shown.length)
    .map(s => ({ deployment: s.deployment, label: label(s.parts), machine: s.parts.machine, tail: s.parts.tail, groups: groupsOf(s.all, s.shown) }));
}

/** `rows → Map<deployment id, rows>` over the given deployments; an unknown or missing deployment
 * id goes to the primary deployment. */
export function splitByDeployment(deployments) {
  const primary = primaryDeployment(deployments)?.id;
  const ids = new Set(deployments.map(d => d.id));
  return rows => {
    const out = new Map(deployments.map(d => [d.id, []]));
    for (const row of rows || []) {
      const id = rowDeployment(row);
      out.get(id && ids.has(id) ? id : primary)?.push(row);
    }
    return out;
  };
}

/** A status mark (UI spec, #482): the warning shape (never colour alone) and its words for assistive
 * tech and as a tooltip ("not reached", "1 deployment not live"). */
export function deploymentMark(doc, words) {
  const mark = doc.createElement('span');
  mark.className = 'deployment-mark'; mark.setAttribute('role', 'img'); mark.setAttribute('aria-label', words); mark.title = words;
  mark.append(iconElement(doc, 'warning', { size: 12 }));
  return mark;
}

/** A deployment heading in the sidebar roster, in the roster's group-label style: its machine label
 * (the full path only as the tooltip), a status mark when it is not live, and a heading role so a
 * screen reader can move between deployments. */
export function deploymentHeading(doc, { deployment, label, machine, tail, count }) {
  const head = doc.createElement('div');
  head.className = 'ctx-deployment'; head.setAttribute('role', 'heading'); head.setAttribute('aria-level', '3');
  head.dataset.deployment = deployment.id;
  // The machine in the group-label type (uppercase); a path tail beside it keeps its case.
  const name = doc.createElement('span'); name.className = 'ctx-deployment-label';
  if (machine && tail) {
    const path = doc.createElement('span'); path.className = 'ctx-deployment-path'; path.textContent = tail;
    name.append(doc.createTextNode(`${machine} · `), path);
  } else name.textContent = label;
  if (deployment.path) name.title = deployment.path;
  head.append(name);
  const state = deploymentState(deployment);
  if (state.key !== 'live') head.append(deploymentMark(doc, state.text));
  if (Number.isInteger(count)) head.setAttribute('aria-label', `${label}${state.key !== 'live' ? `, ${state.text}` : ''}, ${count} ${count === 1 ? 'instance' : 'instances'}`);
  return head;
}

/** Copy the raw panel's view deployments and each row's deployment onto a projected panel
 * (active-observation.mjs keeps only the fields it validates), matching rows by identity. */
export function attachDeployments(projected, raw, idOf) {
  projected.deployments = panelDeployments(raw);
  const byId = new Map();
  for (const row of Array.isArray(raw?.instances) ? raw.instances : []) {
    if (row && typeof row === 'object' && text(row.deployment?.id)) byId.set(idOf(row), { id: row.deployment.id,
      ...(text(row.deployment.machine, 256) ? { machine: row.deployment.machine } : {}), ...(text(row.deployment.path) ? { path: row.deployment.path } : {}) });
  }
  for (const row of projected.instances || []) { const d = byId.get(idOf(row)); if (d) row.deployment = d; }
  return projected;
}

/* ── the session store: the last deployments seen per view ── */
const views = new Map();    // view id -> deployments (validated)
const listeners = new Set();

/** Record a panel: its view's deployments. Called for every panel the shell reads. */
export function notePanel(panel) {
  const id = panel?.workspace?.id;
  if (!text(id)) return;
  const deployments = panelDeployments(panel);
  const before = JSON.stringify(views.get(id) ?? null);
  views.set(id, deployments);
  if (JSON.stringify(deployments) !== before) for (const fn of [...listeners]) { try { fn(id); } catch { /* one listener must not break another */ } }
}

/** The deployments last seen for a view id, or for the view holding a deployment id; null when unknown. */
export function viewDeployments(id) {
  if (!text(id)) return null;
  if (views.has(id)) return views.get(id);
  for (const list of views.values()) if (list.some(d => d.id === id)) return list;
  return null;
}

/** Listen to a view's deployments changing; returns the unsubscribe. */
export function onViewDeployments(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Test seam: forget the store. */
export function resetViewDeployments() { views.clear(); }
