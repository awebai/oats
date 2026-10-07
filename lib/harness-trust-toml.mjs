/** Bounded, lossless native TOML editor. Unknown syntax is refused rather than
 * interpreted by the deliberately permissive readiness reader. No dependencies. */
const bad = () => { throw new Error('unsupported or invalid native TOML configuration'); };
const object = (style = 'implicit') => ({ kind: 'object', style, fields: new Map() });
function scanner(text, offset = 0) {
  let i = 0;
  const space = () => { while (text[i] === ' ' || text[i] === '\t') i++; };
  const quoted = () => {
    const start = i, quote = text[i++];
    if (text.slice(i, i + 2) === quote + quote) bad();
    while (i < text.length) {
      if (quote === '"' && text[i] === '\\') {
        const point = text[i + 1] === 'u' ? Number.parseInt(text.slice(i + 2, i + 6), 16) : -1;
        if (point >= 0xD800 && point <= 0xDFFF) bad();
        i += 2; continue;
      }
      if (text[i++] === quote) {
        const raw = text.slice(start, i);
        let value;
        try { value = quote === '"' ? JSON.parse(raw) : raw.slice(1, -1); } catch { bad(); }
        if (/[\x00-\x08\x0a-\x1f\x7f]/.test(raw.slice(1, -1))) bad();
        // JSON accepts escaped slash and lone surrogates; TOML does not.
        if (quote === '"' && (/\\\//.test(raw) || /[\uD800-\uDFFF]/u.test(value))) bad();
        return { kind: 'string', value, start: offset + start, end: offset + i };
      }
    }
    bad();
  };
  const key = () => {
    space(); const parts = [];
    for (;;) {
      if (text[i] === '"' || text[i] === "'") parts.push(quoted().value);
      else { const m = /^[A-Za-z0-9_-]+/.exec(text.slice(i)); if (!m) bad(); parts.push(m[0]); i += m[0].length; }
      space(); if (text[i] !== '.') break; i++; space();
    }
    return parts;
  };
  const put = (node, path, value) => {
    for (const k of path.slice(0, -1)) {
      if (!node.fields.has(k)) node.fields.set(k, object('dotted'));
      node = node.fields.get(k); if (node.kind !== 'object' || ['inline', 'table'].includes(node.style)) bad();
    }
    const k = path.at(-1); if (node.fields.has(k)) bad(); node.fields.set(k, value);
  };
  const value = (depth = 0) => {
    if (depth > 64) bad(); space(); const start = i;
    if (text[i] === '"' || text[i] === "'") return quoted();
    if (text[i] === '[') {
      i++; space(); const items = [];
      while (text[i] !== ']') {
        items.push(value(depth + 1)); space();
        if (text[i] !== ',') break; i++; space();
      }
      if (text[i++] !== ']') bad();
      return { kind: 'array', items, start: offset + start, end: offset + i };
    }
    if (text[i] === '{') {
      const node = object('inline'); node.start = offset + i++; space();
      if (text[i] !== '}') for (;;) {
        const path = key(); if (text[i++] !== '=') bad(); put(node, path, value(depth + 1)); space();
        if (text[i] !== ',') break; i++; space(); if (text[i] === '}') bad();
      }
      if (text[i++] !== '}') bad(); node.end = offset + i; return node;
    }
    const token = /^[^\s,#\]}]+/.exec(text.slice(i))?.[0];
    if (!token || !/^(?:true|false|[+-]?(?:0|[1-9](?:_?[0-9])*)(?:\.[0-9](?:_?[0-9])*)?(?:[eE][+-]?[0-9](?:_?[0-9])*)?)$/.test(token)) bad();
    // TOML integers are signed 64-bit, unlike JSON's unrestricted numeric syntax.
    if (/^[+-]?[0-9_]+$/.test(token)) { const n = BigInt(token.replaceAll('_', '')); if (n < -(2n ** 63n) || n > 2n ** 63n - 1n) bad(); }
    // Reject integer forms TOML excludes (e.g. -01); preserve all numeric bytes.
    i += token.length; return { kind: 'scalar', token, start: offset + start, end: offset + i };
  };
  return { key, value, space, get at() { return i; }, get char() { return text[i]; }, advance() { i++; }, put };
}
export function tomlDocument(text) {
  const root = object(), tables = []; let table = root, offset = 0;
  for (const raw of text.split(/(?<=\n)/)) {
    const line = raw.replace(/\r?\n$/, '');
    if (/[\x00-\x08\x0b-\x1f\x7f]/.test(line)) bad();
    const scan = scanner(line, offset); scan.space();
    if (scan.char !== undefined && scan.char !== '#') {
      if (scan.char === '[') {
        if (tables.length) tables.at(-1).end = offset;
        scan.advance(); const path = scan.key(); if (scan.char !== ']') bad(); scan.advance();
        table = root;
        for (const k of path) {
          if (!table.fields.has(k)) table.fields.set(k, object());
          table = table.fields.get(k); if (table.kind !== 'object' || ['inline', 'dotted'].includes(table.style)) bad();
        }
        if (table.style === 'table') bad(); table.style = 'table'; table.path = path;
        table.bodyStart = offset + raw.length; table.end = text.length; tables.push(table);
      } else {
        const path = scan.key(); if (scan.char !== '=') bad(); scan.advance(); const value = scan.value();
        scan.put(table, path, value);
      }
      scan.space(); if (scan.char !== undefined && scan.char !== '#') bad();
    }
    offset += raw.length;
  }
  return { root, tables };
}
const semantic = (n) => n.kind === 'object' ? ['object', [...n.fields].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, semantic(v)])]
  : n.kind === 'array' ? ['array', n.items.map(semantic)] : [n.kind, n.value ?? n.token];
export function editCodexTrust(text, rootPath) {
  const { root, tables } = tomlDocument(text), projects = root.fields.get('projects');
  if (projects && (projects.kind !== 'object' || projects.style === 'inline')) bad();
  const project = projects?.fields.get(rootPath);
  if (project && project.kind !== 'object') bad();
  if (project?.style === 'inline' && [...project.fields.keys()].some(k => k !== 'trust_level')) bad();
  const leaf = project?.fields.get('trust_level');
  if (leaf && (leaf.kind !== 'string' || !['trusted', 'untrusted'].includes(leaf.value))) bad();
  if (leaf?.value === 'trusted') return { text, current: 'trusted' };
  let candidate;
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const append = (at, line) => text.slice(0, at) + (at && text[at - 1] !== '\n' ? nl : '') + line + nl + text.slice(at);
  if (leaf) candidate = text.slice(0, leaf.start) + '"trusted"' + text.slice(leaf.end);
  else if (project?.style === 'inline') {
    candidate = text.slice(0, project.end - 1) + (project.fields.size ? ', ' : '') + 'trust_level = "trusted"' + text.slice(project.end - 1);
  } else if (project?.style === 'table') candidate = append(project.end, 'trust_level = "trusted"');
  else if (!project && projects?.style !== 'dotted') candidate = append(text.length, `[projects.${JSON.stringify(rootPath)}]${nl}trust_level = "trusted"`);
  else {
    // Dotted-key tables cannot be reopened as headers. Add another dotted leaf
    // in the nearest explicit enclosing table, or the document's root region.
    const container = projects?.style === 'table' ? projects : null;
    const at = container ? container.end : text.length;
    const line = `${container ? '' : 'projects.'}${JSON.stringify(rootPath)}.trust_level = "trusted"`;
    if (!container && tables.length) {
      // The first header offset is derived from its body, not a bracket in a
      // preceding string/comment.
      const header = text.lastIndexOf('\n', tables[0].bodyStart - 2) + 1;
      candidate = append(header, line);
    } else candidate = append(at, line);
  }
  const expectedProjects = projects ?? object(); if (!projects) root.fields.set('projects', expectedProjects);
  const expectedProject = project ?? object(); if (!project) expectedProjects.fields.set(rootPath, expectedProject);
  expectedProject.fields.set('trust_level', { kind: 'string', value: 'trusted' });
  if (JSON.stringify(semantic(root)) !== JSON.stringify(semantic(tomlDocument(candidate).root))) bad();
  return { text: candidate, current: leaf ? 'untrusted' : null };
}
