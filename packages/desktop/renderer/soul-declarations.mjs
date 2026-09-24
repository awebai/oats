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
    'Source installation and activation are separate observations. They do not establish launchability, adoption, enrolment or a verified signature.', 'declaration-note'));
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
      ['Activation', observed(requirement.active, 'Active', 'Not active')], ['Version', text(requirement.version)]]);
    section.append(row);
  }
  return true;
}
