/** Presentation only: the soul's own declarations as `oats inspect` reports
 * them (soul rows at `soulsApi: 2`). Never parse YAML, resolve sources or infer
 * launchability; the kernel's declaration problems are shown verbatim. */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value ? value : 'Not reported';

export const declarationsCSS = `
.soul-declarations { min-width:0; font-size:12px; }
.soul-declarations h4 { margin:12px 0 6px; font-size:12px; font-weight:650; }
.soul-declarations .declaration-note { color:var(--muted); line-height:1.5; }
.soul-declarations .declaration-problem { color:var(--danger); }
.soul-declarations pre { margin:0; padding:10px; border:1px solid var(--border); border-radius:7px; background:var(--surface-2); color:var(--fg); }
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
  if (soul?.soulsApi !== 2) return false;
  const { node } = builder(parent);
  const section = node('section', undefined, 'soul-declarations');
  section.setAttribute('aria-label', 'Soul declarations');
  parent.append(section);
  section.append(node('h3', 'Declarations'));
  const problems = soul.declarationProblems;
  const complete = Array.isArray(problems) && problems.length === 0;
  if (!Array.isArray(problems)) section.append(node('p', 'Declaration diagnostics not reported.', 'declaration-note'));
  else for (const problem of problems) section.append(node('p', `${text(problem?.message)} (${text(problem?.code)})`, 'declaration-problem'));
  const declarations = object(soul.declarations) ? soul.declarations : {};
  for (const [key, label] of [['capabilities', 'Capabilities'], ['requires', 'Requires'], ['defaults', 'Defaults'], ['knowledge', 'Knowledge'],
    ['teams', 'Teams'], ['resources', 'Resources'], ['children', 'Children']]) {
    const value = declarations[key];
    section.append(node('h4', label));
    section.append(value === null || value === undefined
      ? node('p', value === null && complete ? 'Not declared' : 'Not reported', 'declaration-note')
      : node('pre', JSON.stringify(value, null, 2)));
  }
  return true;
}
