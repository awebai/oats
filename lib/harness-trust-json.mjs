/** Lossless JSON span edits for the one native Claude trust leaf. The parser
 * rejects duplicate keys and never converts unrelated numeric tokens to Number. */
const bad = () => { throw new Error('unsupported or invalid native JSON configuration'); };
export function jsonDocument(text) {
  let i = 0;
  const space = () => { while (/\s/.test(text[i] ?? '') && i < text.length) { if (!' \r\n\t'.includes(text[i])) bad(); i++; } };
  const string = () => {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i++] === '"') { try { return { start, end: i, value: JSON.parse(text.slice(start, i)) }; } catch { bad(); } }
    }
    bad();
  };
  const value = (depth = 0) => {
    if (depth > 128) bad();
    space(); const start = i;
    if (text[i] === '{') {
      i++; space(); const fields = new Map();
      if (text[i] !== '}') for (;;) {
        if (text[i] !== '"') bad();
        const key = string(); if (fields.has(key.value)) bad();
        space(); if (text[i++] !== ':') bad();
        fields.set(key.value, value(depth + 1)); space();
        if (text[i] !== ',') break;
        i++; space();
      }
      if (text[i++] !== '}') bad();
      return { kind: 'object', start, end: i, fields };
    }
    if (text[i] === '[') {
      i++; space(); const items = [];
      if (text[i] !== ']') for (;;) {
        items.push(value(depth + 1)); space();
        if (text[i] !== ',') break;
        i++; space();
      }
      if (text[i++] !== ']') bad();
      return { kind: 'array', start, end: i, items };
    }
    if (text[i] === '"') return { kind: 'string', ...string() };
    const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(i));
    if (!match) bad();
    i += match[0].length;
    return { kind: 'scalar', start, end: i, token: match[0] };
  };
  const node = value(); space(); if (i !== text.length) bad(); return node;
}
const fingerprint = (n) => n.kind === 'object' ? ['object', [...n.fields].map(([k, v]) => [k, fingerprint(v)])]
  : n.kind === 'array' ? ['array', n.items.map(fingerprint)] : [n.kind, n.value ?? n.token];
/** Return the exact candidate bytes; no configuration I/O or host defaults. */
export function editClaudeTrust(text, root) {
  const document = jsonDocument(text);
  const path = ['projects', root, 'hasTrustDialogAccepted'];
  let parent = document;
  for (let at = 0; at < path.length; at++) {
    if (parent.kind !== 'object') bad();
    const key = path[at], child = parent.fields.get(key);
    if (!child) {
      let inserted = true;
      for (let n = path.length - 1; n > at; n--) inserted = { [path[n]]: inserted };
      const insertion = `${parent.fields.size ? ',' : ''}${JSON.stringify(key)}:${JSON.stringify(inserted)}`;
      const candidate = text.slice(0, parent.end - 1) + insertion + text.slice(parent.end - 1);
      const after = jsonDocument(candidate);
      // Independently derive the expected tree: only the missing suffix may appear.
      parent.fields.set(key, jsonDocument(JSON.stringify(inserted)));
      if (JSON.stringify(fingerprint(document)) !== JSON.stringify(fingerprint(after))) bad();
      return { text: candidate, current: null };
    }
    if (at === path.length - 1) {
      if (child.kind !== 'scalar' || !['true', 'false'].includes(child.token)) bad();
      if (child.token === 'true') return { text, current: true };
      const candidate = text.slice(0, child.start) + 'true' + text.slice(child.end);
      child.token = 'true';
      if (JSON.stringify(fingerprint(document)) !== JSON.stringify(fingerprint(jsonDocument(candidate)))) bad();
      return { text: candidate, current: false };
    }
    parent = child;
  }
  bad();
}
