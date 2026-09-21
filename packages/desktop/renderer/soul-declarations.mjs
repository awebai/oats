/** K4 presentation only: consume negotiated inspect facts, never resolve sources,
 * parse YAML, infer launchability, or turn provenance paths into file authority. */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value ? value : 'Not reported';
const nullableText = value => value === null || typeof value === 'string';
const observed = (value, yes, no) => value === true ? yes : value === false ? no : 'Not reported';

export const declarationsCSS = `
.soul-declarations { min-width:0; font-size:12px; }
.soul-declarations h4 { margin:12px 0 6px; font-size:12px; font-weight:650; }
.soul-declarations .declaration-note { color:var(--muted); line-height:1.5; }
.soul-declarations .declaration-problem { color:var(--danger); }
.soul-declarations pre { margin:0; padding:10px; border:1px solid var(--border); border-radius:7px; background:var(--surface-2); color:var(--fg); }
.soul-requirement { padding:10px 0; border-top:1px solid var(--border); }
`;
export const sourcesCSS = `
.portable-sources { min-width:0; color:var(--fg); }
.portable-sources h2 { margin:0 0 8px; font-size:14px; font-weight:650; }
.portable-sources > p { color:var(--muted); font-size:12px; line-height:1.5; }
.portable-source-list { list-style:none; padding:0; margin:14px 0 0; display:grid; gap:12px; }
.portable-source { min-width:0; padding:16px; border:1px solid var(--border); border-radius:10px; background:var(--surface); font-size:12px; overflow-wrap:anywhere; }
.portable-source h3 { margin:0 0 10px; font-size:12.5px; font-weight:650; }
.portable-source dl { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,2fr); gap:6px 12px; }
.portable-source dt { color:var(--muted); }
.portable-source dd { margin:0; white-space:pre-wrap; }
`;

function builder(parent) {
  const node = (tag, value, cls) => {
    const el = parent.ownerDocument.createElement(tag);
    if (value !== undefined) el.textContent = value;
    if (cls) el.className = cls;
    return el;
  };
  const facts = (host, entries, cls = 'inspector-facts') => {
    const dl = node('dl', undefined, cls);
    for (const [key, value] of entries) dl.append(node('dt', key), node('dd', value));
    host.append(dl);
  };
  return { node, facts };
}

/** Called only after the inspector's request/selection ownership checks. */
export function renderSoulDeclarations(parent, soul) {
  if (soul?.soulsApi !== 1) return false;
  const { node, facts } = builder(parent);
  const section = node('section', undefined, 'soul-declarations');
  section.setAttribute('aria-label', 'Reported soul declarations and provenance');
  parent.append(section);
  section.append(node('h3', 'Recorded provenance'));
  const provenance = soul.provenance;
  if (provenance === null) section.append(node('p', 'Unrecorded', 'declaration-note'));
  else if (!object(provenance)) section.append(node('p', 'Provenance not reported.', 'declaration-note'));
  else {
    facts(section, [
      ['Kind', text(provenance.kind)], ['Source', text(provenance.source)],
      ['Revision', text(provenance.revision)], ['Payload path', text(provenance.path)],
      ['Workspace revision', text(provenance.workspaceRevision)],
    ]);
    if (provenance.source === null) section.append(node('p', 'No portable source address is recorded for this origin.', 'declaration-note'));
  }
  section.append(node('h3', 'Declarations'));
  const problems = soul.declarationProblems;
  const complete = Array.isArray(problems) && problems.length === 0;
  if (!Array.isArray(problems)) section.append(node('p', 'Declaration diagnostics not reported.', 'declaration-note'));
  else for (const problem of problems) section.append(node('p', `${text(problem?.code)}: ${text(problem?.message)}`, 'declaration-problem'));
  const declarations = object(soul.declarations) ? soul.declarations : {};
  for (const [key, label] of [['requires', 'Requires'], ['defaults', 'Defaults'], ['knowledge', 'Knowledge'], ['teams', 'Teams'], ['resources', 'Resources']]) {
    const value = declarations[key];
    section.append(node('h4', label));
    section.append(value === null || value === undefined
      ? node('p', value === null && complete ? 'Not declared' : 'Not reported', 'declaration-note')
      : node('pre', JSON.stringify(value, null, 2)));
  }
  section.append(node('h3', 'Declared-source observations'), node('p',
    'Source installation, executable approval and activation are separate observations. They do not establish launchability, adoption, enrolment or a verified signature.', 'declaration-note'));
  const readiness = object(soul.readiness) ? soul.readiness : {};
  const labels = { undeclared: 'Requirements undeclared', 'sources-installed': 'Declared sources installed', 'sources-missing': 'Declared sources missing', unknown: 'Declared source status unknown' };
  // A read failure cannot establish that the missing sections are undeclared.
  const state = complete && typeof readiness.status === 'string' && Object.hasOwn(labels, readiness.status) ? labels[readiness.status] : null;
  facts(section, [['Reported source state', state || 'Not reported'],
    ['Origin record', readiness.source === 'recorded' ? 'Recorded' : readiness.source === 'unrecorded' ? 'Unrecorded' : 'Not reported']]);
  const requirements = readiness.requirements;
  if (requirements === null) section.append(node('p', complete ? 'No capability requirements declared.' : 'Capability requirements not reported.', 'declaration-note'));
  else if (!Array.isArray(requirements) || requirements.some(row => !object(row) || typeof row.capability !== 'string' || !row.capability)) {
    section.append(node('p', 'Capability requirements not reported.', 'declaration-note'));
  } else if (!requirements.length) section.append(node('p', 'No entries in the declared capability requirements.', 'declaration-note'));
  else for (const requirement of requirements) {
    const row = node('section', undefined, 'soul-requirement');
    row.append(node('h4', requirement.capability));
    facts(row, [['Declared source', text(requirement.source)],
      ['Installation', observed(requirement.installed, 'Installed', 'Not installed')],
      ['Executable approval', observed(requirement.approved, 'Approved', 'Not approved')],
      ['Activation', observed(requirement.active, 'Active', 'Not active')], ['Version', text(requirement.version)]]);
    section.append(row);
  }
  return true;
}

/** null means unnegotiated: preserve the older capability-origin projection.
 * Malformed v1 is unavailable, never a healthy zero or a legacy fallback. */
export function portableSources(data) {
  const sources = data?.sources;
  if (sources?.soulsApi !== 1) return null;
  const unavailable = { kind: 'unavailable', items: [], message: 'Portable source context is malformed or incomplete. Refresh inspection to retry.' };
  if (!['recorded-provenance', 'none-recorded'].includes(sources.kind) || !Array.isArray(sources.items)) return unavailable;
  if (sources.kind === 'none-recorded') return sources.items.length ? unavailable : { kind: sources.kind, items: [] };
  if (!sources.items.length || sources.items.some(item => !object(item)
    || typeof item.source !== 'string' || !item.source
    || !['kind', 'revision', 'path', 'workspaceRevision'].every(key => nullableText(item[key]))
    || !Array.isArray(item.souls) || item.souls.some(name => typeof name !== 'string' || !name))) return unavailable;
  return { kind: sources.kind, items: sources.items.map(item => ({
    kind: item.kind, source: item.source, revision: item.revision, path: item.path,
    workspaceRevision: item.workspaceRevision, souls: [...item.souls],
  })) };
}

export function renderPortableSources(parent, sources, query = '') {
  const { node, facts } = builder(parent);
  const section = node('section', undefined, 'portable-sources');
  section.setAttribute('aria-label', 'Recorded portable source context');
  section.append(node('h2', 'Recorded portable sources'));
  parent.append(section);
  if (sources.kind === 'unavailable') { section.append(node('p', sources.message)); return; }
  section.append(node('p', 'Only source addresses recorded by souls in this inspection scope. Revisions and paths are provenance, not installation, approval, launch readiness or permission to open files.'));
  if (sources.kind === 'none-recorded') {
    // The producer's generic note says authored local souls only, but its own
    // packaged-definition fixture also has no source address. Do not infer local.
    section.append(node('p', 'None recorded — no soul in this scope records a portable source address. A soul may still have a recorded origin kind.', 'discovery-empty'));
    return;
  }
  const items = sources.items.filter(item => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
  if (!items.length) { section.append(node('p', 'No recorded sources match the filter.', 'discovery-empty')); return; }
  const list = node('ul', undefined, 'portable-source-list'); section.append(list);
  for (const item of items) {
    const row = node('li', undefined, 'portable-source');
    row.append(node('h3', item.source));
    facts(row, [['Kind', text(item.kind)], ['Revision', text(item.revision)], ['Payload path', text(item.path)],
      ['Workspace revision', text(item.workspaceRevision)], ['Reported soul names', item.souls.length ? item.souls.join(', ') : 'Not reported']], 'portable-source-facts');
    list.append(row);
  }
}
