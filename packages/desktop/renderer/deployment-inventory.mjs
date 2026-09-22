/** Classic acquisition facts from oats list. Never a resolver, activation join,
 * catalog join, captured-resolution fallback, or readiness assessment. */
import { postJson, wsQuery, workspaceGeneration } from './views/common.mjs';
import { createCapabilityMark } from './identity-marks.mjs';

export const inventoryCSS = `
.deployment-inventory { margin:18px 0; min-width:0; font-size:12px; line-height:1.5; }
.deployment-inventory[hidden], .deployment-inventory [hidden] { display:none; }
.inventory-header { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.inventory-header h2 { margin:0; font-size:14px; }
.inventory-header button { margin-left:auto; }
.inventory-note, .inventory-status, .inventory-table small { color:var(--muted); overflow-wrap:anywhere; }
.inventory-status:empty { display:none; }
.deployment-inventory h3 { margin:14px 0 6px; font-size:12.5px; }
.inventory-table { width:100%; table-layout:fixed; border-spacing:0; border:1px solid var(--border); border-radius:10px; background:var(--surface); overflow:hidden; }
.inventory-table caption { text-align:left; padding:6px 0; color:var(--muted); }
.inventory-table th { text-align:left; height:36px; padding:0 16px; font-size:10.5px; color:var(--muted); background:var(--surface-2); }
.inventory-table td { padding:8px 16px; vertical-align:middle; border-top:1px solid var(--border); overflow-wrap:anywhere; }
.inventory-table tbody tr { height:56px; }
.inventory-table p { margin:0; }
.inventory-table strong { font-size:12.5px; }
.inventory-table small { display:block; font:11px/1.5 var(--mono,monospace); }
.inventory-name { display:flex; align-items:center; gap:8px; }
.inventory-name .identity-mark { width:28px; height:28px; border-radius:7px; }
.inventory-table summary { cursor:pointer; }
.inventory-table summary:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.inventory-table dl { margin:6px 0; }
.inventory-table dt { color:var(--muted); }
.inventory-table dd { margin:0 0 5px; overflow-wrap:anywhere; }
@container(max-width:600px) {
 .inventory-table, .inventory-table tbody, .inventory-table tr, .inventory-table td { display:block; width:auto; }
 .inventory-table thead { display:none; }
 .inventory-table tbody tr { height:auto; border-top:1px solid var(--border); padding:8px 0; }
 .inventory-table td { border:0; padding:4px 14px; }
 .inventory-table td::before { content:attr(data-label); display:block; color:var(--muted); font-size:10.5px; }
}
`;

const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value !== '' ? value : 'Not reported';
const yesNo = value => value === true ? 'Yes' : value === false ? 'No' : 'Not reported';
const names = value => Array.isArray(value) && value.every(v => typeof v === 'string')
  ? value.length ? value.join(', ') : 'None reported' : 'Not reported';

// Deliberately project only these public list fields. Unknown future objects,
// credentials/settings, package trust and catalog aliases are not display data.
function project(data, context) {
  if (!object(data) || data.inventoryApi !== 1 || data.scope?.kind !== 'classic' || data.scope.context !== context
    || !['packages', 'capabilities', 'legacy'].every(k => Array.isArray(data[k]) && data[k].every(object))
    || data.packages.some(p => typeof p.package !== 'string' || !p.package)
    || data.capabilities.some(c => typeof c.capability !== 'string' || !c.capability)
    || data.legacy.some(l => typeof l.file !== 'string' || !l.file)) throw new Error('Invalid or mismatched classic inventory response.');
  return {
    capabilities: data.capabilities.map(c => ({ id: c.capability, level: text(c.level), version: text(c.version),
      state: [
        ['Installation', c.installed === true ? 'Installed' : c.installed === false ? 'Not installed' : 'Not reported'],
        ['Executable approval', c.trusted === true ? 'Approved' : c.trusted === false ? 'Not approved' : 'Not reported'],
        ['Health', text(c.status)], ['Readiness', 'Unknown'],
      ], facts: [
        ['Package', text(c.package)], ['Acquisition scope', text(c.level)], ['Layer', text(c.layer)],
        ['Artifact path', text(c.path)], ['Artifact directory', text(c.dir)], ['Recorded integrity', text(c.integrity)],
        ['Installed integrity', text(c.installedIntegrity)], ['Health code', text(c.code)], ['Health detail', text(c.detail)],
        ['Declared commands', names(c.executableSurface?.commands)], ['Declared hooks', names(c.executableSurface?.hooks)],
        ['Declared environment names', names(c.executableSurface?.environment)],
        ['Verified signature', 'Unknown'], ['Enforced policy', 'Unknown'], ['Provider configuration', 'Unknown'], ['Enrolment', 'Unknown'],
      ] })),
    packages: data.packages.map(p => ({ id: p.package, level: text(p.level), version: text(p.version),
      state: [['Locked', yesNo(p.locked)], ['Reported capability exports', names(p.capabilities)]],
      facts: [['Acquisition scope', text(p.level)], ['Source', text(p.source)], ['Payload path', text(p.path)],
        ['Commit', text(p.commit)], ['Recorded integrity', text(p.integrity)], ['Dependencies', names(p.dependencies)]] })),
    legacy: data.legacy.map(l => ({ file: l.file, level: text(l.level), version: Number.isInteger(l.lockfileVersion) ? String(l.lockfileVersion) : 'Not reported', capabilities: names(l.capabilities) })),
  };
}

export function createDeploymentInventory(host, { ctx }) {
  const doc = host.ownerDocument;
  const node = (tag, content, cls) => { const el = doc.createElement(tag); if (content !== undefined) el.textContent = content; if (cls) el.className = cls; return el; };
  let alive = true, active = false, hasIdentity = false, identity, serial = 0, attempted = false;
  let state = {}, result = null, query = '', blocked = '';
  const section = node('section', undefined, 'deployment-inventory'); section.hidden = true; section.setAttribute('aria-label', 'Classic deployment inventory');
  const header = node('div', undefined, 'inventory-header'), retry = node('button', 'Refresh inventory', 'act inventory-refresh'); retry.type = 'button';
  retry.addEventListener('click', () => { void refresh(); });
  header.append(node('h2', 'Deployment inventory'), retry);
  const status = node('p', '', 'inventory-status'); status.setAttribute('role', 'status');
  const scope = node('p', '', 'inventory-note');
  const note = node('p', 'Classic acquisition inventory only. Scope-qualified rows are not joined to catalog mappings or activation by name. Captured D/R inventory is not reported by this read; inspect an explicitly selected home separately. Packages are transport, not executable approval. Inventory and inspection are independent reads, not an atomic snapshot.', 'inventory-note');
  const readiness = node('p', 'Readiness: Unknown for these classic acquisition rows. See the separate scope-bound effective-readiness section. Independent inventory and readiness observations are not joined by capability name; byte installation and executable approval below are not a quartet result.', 'inventory-note');
  const body = node('div', undefined, 'inventory-body'); section.append(header, scope, status, note, readiness, body); host.append(section);
  const owns = (ticket, gen) => alive && serial === ticket && workspaceGeneration() === gen;
  function reason(next) {
    if (next.workspace?.remote || next.workspace?.server) return 'Classic inventory unavailable for remote workspaces; no local substitution.';
    if (!object(next.selector) || Object.keys(next.selector).some(k => k !== 'context')) return 'Classic inventory accepts only a configuration scope, not a soul, home or captured resolution.';
    if (!next.workspace || typeof next.context !== 'string' || !next.context) return 'Waiting for the current workspace configuration scope…';
    if (next.cli?.ok !== true) return 'Classic inventory requires a compatible installed OATS CLI.';
    return '';
  }
  function renderRows(label, rows, kind) {
    const table = node('table', undefined, `inventory-table inventory-${kind}`); table.append(node('caption', label));
    const headings = [kind === 'capabilities' ? 'Capability / scope' : 'Package / scope', 'Reported facts', 'Provenance'];
    const head = node('thead'), hr = node('tr');
    for (const title of headings) { const th = node('th', title); th.scope = 'col'; hr.append(th); }
    head.append(hr); table.append(head);
    const tbody = node('tbody'); table.append(tbody);
    const filtered = rows.filter(row => [row.id, row.level, row.version, ...row.state.flat(), ...row.facts.flat()]
      .join('\n').toLowerCase().includes(query.toLowerCase()));
    for (const row of filtered) {
      const tr = node('tr'), cells = headings.map(title => { const td = node('td'); td.dataset.label = title; tr.append(td); return td; });
      const name = node('div', undefined, 'inventory-name'), copy = node('div');
      copy.append(node('strong', row.id), node('small', `Version: ${row.version}`), node('small', `Scope: ${row.level}`));
      if (kind === 'capabilities') name.append(createCapabilityMark(doc, { id: row.id }, { root: row.level }));
      name.append(copy); cells[0].append(name);
      for (const [key, value] of row.state) cells[1].append(node('p', `${key}: ${value}`));
      const details = node('details'), facts = node('dl'); details.append(node('summary', 'Reported details'), facts);
      for (const [key, value] of row.facts) facts.append(node('dt', key), node('dd', value));
      cells[2].append(details); tbody.append(tr);
    }
    if (!filtered.length) {
      const tr = node('tr'), td = node('td', rows.length ? 'Nothing matches the filter.' : `No ${kind} reported by this classic inventory read.`); td.colSpan = 3; tr.append(td); tbody.append(tr);
    }
    return table;
  }
  function render() {
    body.replaceChildren();
    if (!result) return;
    body.append(renderRows('Acquired capability facts — activation is reported separately by inspection', result.capabilities, 'capabilities'),
      node('h3', 'Package transport'), renderRows('Package provenance and reported exports — not package-level trust', result.packages, 'packages'));
    if (result.legacy.length) {
      body.append(node('h3', 'Legacy lock reports'));
      for (const l of result.legacy) {
        const p = node('p', `File: ${l.file} · Scope: ${l.level} · Lock version: ${l.version} · Capabilities: ${l.capabilities}`, 'inventory-note');
        if (p.textContent.toLowerCase().includes(query.toLowerCase())) body.append(p);
      }
      body.append(node('p', 'Legacy lock reports are not acquired capability rows. Migration is an explicit CLI operation; nothing is migrated here.', 'inventory-note'));
    }
  }
  async function refresh() {
    if (!alive || !active || blocked) return;
    const ticket = ++serial, gen = workspaceGeneration(), context = state.context;
    const selector = { ...state.selector }, path = `/api/capabilities${wsQuery()}`;
    attempted = true; result = null; render(); retry.disabled = true; status.textContent = 'Loading classic inventory…';
    try {
      const data = await postJson(ctx, path, { action: 'list', selector });
      if (!owns(ticket, gen)) return;
      result = project(data, context); render(); status.textContent = '';
    } catch (error) {
      if (!owns(ticket, gen)) return;
      result = null; render(); status.textContent = `Classic inventory unavailable${typeof error?.code === 'string' ? ` (${error.code})` : ''}: ${error?.message || 'Read failed. Retry when available.'}`;
    }
    if (!owns(ticket, gen)) return;
    retry.disabled = false;
  }
  return {
    update(next) {
      if (!alive) return;
      const nextBlocked = reason(next);
      if (!hasIdentity || !Object.is(next.identity, identity) || blocked !== nextBlocked) {
        serial++; hasIdentity = true; identity = next.identity; attempted = false; result = null;
        state = { ...next, selector: { ...next.selector } }; blocked = nextBlocked;
        scope.textContent = `Classic read context: ${text(next.context)}`; status.textContent = blocked; retry.disabled = !!blocked; render();
      }
      active = next.active === true; section.hidden = !active;
      if (active && !blocked && !attempted) return refresh();
    },
    setQuery(value) { const next = typeof value === 'string' ? value : ''; if (!alive || query === next) return; query = next; render(); },
    refresh,
    dispose() { if (!alive) return; alive = false; serial++; section.remove(); },
  };
}
