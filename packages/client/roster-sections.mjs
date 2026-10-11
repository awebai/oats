/** A view's deployments and its roster, from the panel's facts alone (#482): which deployment
 * deployment-level surfaces read, a deployment's state in words, which rows are held from a stale
 * deployment, and the roster split into one section per deployment when a view has two or more.
 *
 * A deployment is `{ id, machine, path, label, local, reachable, identityFrom, primary, stale?, reason? }`
 * and a row carries `deployment: { id }`. Nothing is derived from a host name or a path beyond the
 * display label. A view with one deployment has one section and no heading. */
import { rosterGroups } from './instance-tree.mjs';
import { machineLabelParts } from './deployment-label.mjs';

const text = (v, max = 4096) => typeof v === 'string' && v.length > 0 && v.length <= max;

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
