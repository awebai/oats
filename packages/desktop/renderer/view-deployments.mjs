/** A workspace view's deployments on screen (#482): which machines and folders the window shows,
 * their state in words, and the roster split by deployment when a view has two or more.
 *
 * The facts come only from `/api/panel`: `deployments` (`{ id, machine, path, label, local, reachable,
 * identityFrom, primary, reason?, short?, fix?, note? }`) and each row's `deployment: { id, machine, path }`. Nothing
 * is derived from a host name or a path beyond the display label. A view with one deployment looks
 * exactly like a window before views: no deployment headings, no "On …" lines.
 *
 * Also a small session store fed by every panel the renderer reads (the shell's roster poll): the
 * last deployments seen per view, for surfaces that do not read the panel themselves (the "On …"
 * line, deployment-scope-line.mjs) and the switcher's labels for views that are not on screen. */
import { visibleClusters } from './instance-tree.mjs';
import { deploymentLabel, shortPath, THIS_MACHINE } from './deployment-label.mjs';

const text = (v, max = 4096) => typeof v === 'string' && v.length > 0 && v.length <= max;

/** The panel's deployments, validated (malformed entries dropped, never guessed). */
export function panelDeployments(panel) {
  const list = Array.isArray(panel?.deployments) ? panel.deployments : [];
  return list.filter(d => d && typeof d === 'object' && text(d.id)).map(d => ({
    id: d.id, machine: text(d.machine, 256) ? d.machine : (d.local === false ? '' : THIS_MACHINE), path: text(d.path) ? d.path : '',
    label: text(d.label, 512) ? d.label : '', local: d.local !== false, reachable: d.reachable === true,
    identityFrom: d.identityFrom === 'reported' || d.identityFrom === 'remembered' ? d.identityFrom : null, primary: d.primary === true,
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
 * live: reached (or, on this computer, observed) now. remembered: not reached, its workspace is the
 * last report. not reached / not observed: with why. */
export function deploymentState(d) {
  if (d?.reachable) return { key: 'live', text: 'live', detail: '' };
  if (d?.identityFrom === 'remembered') {
    return { key: 'remembered', text: 'remembered', detail: ['Last report, not live now.', d.reason].filter(Boolean).join(' ') };
  }
  // This computer's own deployment is not "reached": it is observed or not, the reason says why
  // (still reading, or the kernel's refusal).
  if (d?.local) return { key: 'unobserved', text: 'not observed', detail: d.reason || '' };
  return { key: 'unreached', text: 'not reached', detail: d?.reason || '' };
}

/** Render the view's deployments into `listEl` (the sidebar list under the switcher): one item per
 * deployment, its label, its state in text, "primary" when there are two or more, its reason and note.
 * The list is hidden when the panel names no deployment (an older server, nothing resolved yet). */
export function renderDeploymentList(listEl, deployments, { workspaceName = '' } = {}) {
  if (!listEl) return;
  const doc = listEl.ownerDocument;
  const node = (tag, value, cls) => { const el = doc.createElement(tag); if (value !== undefined) el.textContent = value; if (cls) el.className = cls; return el; };
  const list = Array.isArray(deployments) ? deployments : [];
  listEl.setAttribute('role', 'list'); // list-style:none drops the list role in WebKit
  listEl.setAttribute('aria-label', workspaceName ? `Deployments of ${workspaceName}` : 'Deployments');
  const items = list.map(d => {
    const state = deploymentState(d), item = node('li', undefined, 'ws-deployment');
    item.dataset.deployment = d.id; item.dataset.state = state.key;
    const line = node('span', undefined, 'ws-deployment-line');
    const label = node('span', deploymentLabel(d), 'ws-deployment-label'); label.title = d.path || d.id;
    line.append(label);
    if (isMultiDeployment(list) && d.primary) line.append(node('span', 'primary', 'ws-deployment-tag'));
    line.append(node('span', state.text, 'ws-deployment-state'));
    item.append(line);
    for (const detail of [state.detail, d.note]) if (detail) item.append(node('span', detail, 'ws-deployment-detail'));
    return item;
  });
  listEl.replaceChildren(...items);
  listEl.hidden = !items.length;
}

/** The deployment a row belongs to, by the id the panel tagged it with (null when untagged). */
const rowDeployment = row => (text(row?.deployment?.id) ? row.deployment.id : null);

/** The sidebar roster's sections. One deployment (or none reported): a single section with no
 * heading whose groups are exactly the relation clusters the roster always drew. Two or more: one
 * section per deployment, in the panel's order, each with its own clusters (relations are recorded
 * within one deployment); a row without a known deployment (a pending spawn) joins the primary's.
 * Sections with no visible row are left out. Returns `[{ deployment|null, label|null, groups }]`,
 * a group being `{ key, label, clusters }` as before. */
export function rosterSections(instances, visible, deployments) {
  const groupsOf = (all, shown) => {
    const clusters = visibleClusters(all, shown);
    return [
      ...clusters.filter(c => c.instances.length > 1).map(c => ({ key: `cluster:${c.key}`, label: c.key, clusters: [c] })),
      ...(clusters.some(c => c.instances.length === 1)
        ? [{ key: 'independent', label: 'independent', clusters: clusters.filter(c => c.instances.length === 1) }] : []),
    ];
  };
  if (!isMultiDeployment(deployments)) return [{ deployment: null, label: null, groups: groupsOf(instances, visible) }];
  const sectionOf = splitByDeployment(deployments);
  const all = sectionOf(instances), shown = sectionOf(visible);
  return deployments.map(d => ({ deployment: d, label: deploymentLabel(d), all: all.get(d.id), shown: shown.get(d.id) }))
    .filter(s => s.shown.length)
    .map(s => ({ deployment: s.deployment, label: s.label, groups: groupsOf(s.all, s.shown) }));
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

/** A deployment heading in the sidebar roster: its label in text, "primary" in text, and a heading
 * role so a screen reader can move between deployments. */
export function deploymentHeading(doc, { deployment, label, count }) {
  const head = doc.createElement('div');
  head.className = 'ctx-deployment'; head.setAttribute('role', 'heading'); head.setAttribute('aria-level', '3');
  head.dataset.deployment = deployment.id;
  const name = doc.createElement('span'); name.className = 'ctx-deployment-label'; name.textContent = label; name.title = deployment.path || deployment.id;
  head.append(name);
  if (deployment.primary) { const tag = doc.createElement('span'); tag.className = 'ctx-deployment-tag'; tag.textContent = 'primary'; head.append(tag); }
  const state = deploymentState(deployment);
  if (state.key !== 'live') { const s = doc.createElement('span'); s.className = 'ctx-deployment-state'; s.textContent = state.text; head.append(s); }
  if (Number.isInteger(count)) head.setAttribute('aria-label', `${label}${deployment.primary ? ', primary' : ''}${state.key !== 'live' ? `, ${state.text}` : ''}, ${count} ${count === 1 ? 'instance' : 'instances'}`);
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

/* ── the session store: the last deployments seen per view, and labels by deployment id ── */
const views = new Map();    // view id -> deployments (validated)
const labels = new Map();   // deployment id -> its label, as a panel named it
const listeners = new Set();

/** Record a panel: its view's deployments and their labels. Called for every panel the shell reads. */
export function notePanel(panel) {
  const id = panel?.workspace?.id;
  if (!text(id)) return;
  const deployments = panelDeployments(panel);
  const before = JSON.stringify(views.get(id) ?? null);
  views.set(id, deployments);
  for (const d of deployments) labels.set(d.id, deploymentLabel(d));
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

/** A deployment id as people read it: the label a panel gave it, else what the id itself says (a local
 * path is this computer's folder; a remote group `remote:<server>:<target>` names its server). */
export function deploymentIdLabel(id) {
  if (!text(id)) return '';
  if (labels.has(id)) return labels.get(id);
  if (id.startsWith('/')) return deploymentLabel({ machine: THIS_MACHINE, label: shortPath(id) });
  const remote = /^remote:([^:]+):/.exec(id);
  return remote ? deploymentLabel({ machine: remote[1] }) : id;
}

/** Test seam: forget the store. */
export function resetViewDeployments() { views.clear(); labels.clear(); }
