/** Inert projection of the local CLI catalog. This is not deployment state,
 * export discovery, executable approval, or an acquisition surface. */
import { postJson, workspaceGeneration } from './views/common.mjs';

export const officialCatalogCSS = `
.official-catalog { min-width:0; margin-top:18px; color:var(--fg); font-size:12px; line-height:1.5; }
.official-catalog [hidden], .official-catalog[hidden] { display:none; }
.official-catalog-header { display:flex; align-items:center; flex-wrap:wrap; gap:8px 14px; }
.official-catalog h2 { margin:0; font-size:14px; font-weight:700; }
.official-catalog-scope { color:var(--muted); font-size:11px; }
.official-catalog h3 { margin:14px 0 6px; font-size:12.5px; }
.official-catalog-filter-label { display:grid; gap:4px; margin-left:auto; color:var(--muted); }
.official-catalog input, .official-catalog button { box-sizing:border-box; min-height:28px; border:1px solid var(--border); border-radius:6px; padding:4px 8px; background:var(--surface); color:var(--fg); font:12px var(--sans,system-ui); }
.official-catalog button { cursor:pointer; }
.official-catalog button:disabled { cursor:default; color:var(--muted); }
.official-catalog input:focus-visible, .official-catalog button:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.official-catalog-note, .official-catalog-status, .official-catalog-copy-status { color:var(--muted); overflow-wrap:anywhere; }
.official-catalog-status:empty, .official-catalog-copy-status:empty { display:none; }
.official-catalog-warning { padding:10px 14px; border:1px solid var(--danger); border-radius:8px; background:var(--surface); color:var(--danger); font-weight:650; }
.official-catalog-facts { display:grid; grid-template-columns:max-content minmax(0,1fr); gap:2px 10px; }
.official-catalog-facts dt { color:var(--muted); }
.official-catalog-facts dd { margin:0; overflow-wrap:anywhere; font-family:var(--mono,monospace); }
.official-catalog-table { width:100%; table-layout:fixed; border-spacing:0; border:1px solid var(--border); border-radius:10px; overflow:hidden; background:var(--surface); font-size:12px; }
.official-catalog-table caption { text-align:left; padding:6px 0; color:var(--muted); }
.official-catalog-table thead tr { height:36px; }
.official-catalog-table th { padding:0 14px; text-align:left; background:var(--surface-2); color:var(--muted); font-size:10.5px; font-weight:650; }
.official-catalog-table td { padding:8px 14px; border-top:1px solid var(--border); vertical-align:top; overflow-wrap:anywhere; }
.official-catalog-table tbody tr { height:56px; }
.official-catalog-table p { margin:0; }
.official-catalog-table strong { font-size:12.5px; font-weight:650; }
.official-catalog .official-catalog-command { display:block; width:100%; margin-bottom:6px; font:11px/1.5 var(--mono,monospace); user-select:text; }
.official-catalog-empty { color:var(--muted); }
@container(max-width:600px) {
 .official-catalog-filter-label { margin-left:0; }
 .official-catalog-table, .official-catalog-table tbody, .official-catalog-table tr, .official-catalog-table td { display:block; width:auto; }
 .official-catalog-table thead { display:none; }
 .official-catalog-table tbody tr { height:auto; border-top:1px solid var(--border); padding:8px 0; }
 .official-catalog-table td { border:0; padding:4px 14px; }
 .official-catalog-table td::before { content:attr(data-label); display:block; color:var(--muted); font-size:10.5px; font-weight:650; }
}
`;

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string';
const nullableText = value => value === null || text(value);
const reported = value => value === null || value === '' ? 'Not reported' : value;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const minimumVersion = '0.24.6';

function installCommand(row) {
  const argv = row.acquire?.argv, id = row.package;
  // Do not construct missing argv or accept arbitrary CLI verbs/options. The
  // only permitted command is the exact three-argument, package-matched tuple.
  // Reject controls (including bidi formatting) before POSIX shell quoting.
  if (!Array.isArray(argv) || argv.length !== 3 || argv[0] !== 'oats' || argv[1] !== 'install' || argv[2] !== id
      || !text(id) || !id.trim() || /^\s*-/.test(id) || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(id)) return null;
  const quote = value => /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
  return argv.map(quote).join(' ');
}

function catalogResult(value) {
  const malformed = () => { throw new Error('Malformed local CLI catalog response.'); };
  if (!record(value) || value.catalogApi !== 1 || value.scope !== 'local-cli' || value.minimumVersion !== minimumVersion) malformed();
  if (value.status === 'unavailable') {
    if (value.description !== null || !record(value.reason) || !text(value.reason.code) || !text(value.reason.message)) malformed();
    return { failure: `${value.reason.code}: ${value.reason.message}` };
  }
  const d = value.description, catalog = d?.catalog;
  if (value.status !== 'available' || value.reason !== null || !record(d) || d.schemaVersion !== 1 || !record(catalog)
      || !['bundled', 'override'].includes(catalog.origin) || !nullableText(catalog.file) || !nullableText(catalog.kernelVersion)
      || !Array.isArray(d.packages) || !Array.isArray(d.capabilityAliases) || !Array.isArray(d.notes) || !d.notes.every(text)) malformed();
  const packages = [], aliases = [], packageIds = new Set(), capabilityIds = new Set();
  for (const row of d.packages) {
    if (!record(row) || !text(row.package) || !row.package || packageIds.has(row.package)
        || !nullableText(row.url) || !nullableText(row.ref) || !nullableText(row.path)) malformed();
    packageIds.add(row.package);
    // Invalid acquire data withholds only the command, not literal provenance.
    packages.push({ package: row.package, url: row.url, ref: row.ref, path: row.path, command: installCommand(row) });
  }
  for (const row of d.capabilityAliases) {
    if (!record(row) || !text(row.capability) || !row.capability || capabilityIds.has(row.capability)
        || !nullableText(row.package) || !nullableText(row.capabilityInPackage) || !nullableText(row.via)
        || (row.available !== null && typeof row.available !== 'boolean')) malformed();
    capabilityIds.add(row.capability);
    aliases.push({ capability: row.capability, package: row.package, capabilityInPackage: row.capabilityInPackage, via: row.via, available: row.available });
  }
  packages.sort((a, b) => compare(a.package, b.package));
  aliases.sort((a, b) => compare(a.capability, b.capability));
  return { catalog: { origin: catalog.origin, file: catalog.file, kernelVersion: catalog.kernelVersion }, packages, aliases, notes: [...d.notes] };
}

/** identity is opaque and compared with Object.is. The caller must change it
 * when CLI/workspace ownership changes (including A -> B -> A transitions).
 * Same-identity polls never reload or rebuild controls. Hiding retains a read
 * already in flight, but invalidates clipboard feedback and starts no reads. */
export function createOfficialCatalog(host, { ctx, copyText } = {}) {
  const doc = host.ownerDocument;
  const node = (tag, content, cls) => {
    const el = doc.createElement(tag);
    if (content !== undefined) el.textContent = content;
    if (cls) el.className = cls;
    return el;
  };
  const button = (label, run) => {
    const el = node('button', label); el.type = 'button'; el.addEventListener('click', run); return el;
  };
  const setText = (el, content) => { if (el.textContent !== content) el.textContent = content; };
  let alive = true, active = false, hasIdentity = false, identity, epoch = 0, readSerial = 0, copySerial = 0;
  let attempted = false, loading = false, result = null, query = '', notesSignature = '';
  const packageRows = new Map(), aliasRows = new Map();
  const section = node('section', undefined, 'official-catalog'); section.hidden = true; section.setAttribute('aria-label', 'Local CLI catalog');
  const header = node('div', undefined, 'official-catalog-header'), heading = node('h2', 'Local CLI catalog');
  const filterLabel = node('label', 'Filter local CLI catalog', 'official-catalog-filter-label');
  const filter = node('input', undefined, 'official-catalog-filter'); filter.type = 'search'; filter.autocomplete = 'off'; filterLabel.append(filter);
  filter.addEventListener('input', () => setQuery(filter.value));
  const retry = button('Refresh catalog', () => { void refresh(); }); retry.className = 'official-catalog-refresh';
  // Scope stays explicit even when a remote workspace is selected. Bundled is
  // an official snapshot of THIS local CLI, not the remote deployment catalog.
  const scopeLabel = node('span', 'Local CLI catalog', 'official-catalog-scope'); scopeLabel.hidden = true;
  header.append(heading, scopeLabel, filterLabel, retry);
  const status = node('p', '', 'official-catalog-status'); status.setAttribute('role', 'status');
  const warning = node('p', 'Catalog override — not verified as the reviewed official list.', 'official-catalog-warning'); warning.hidden = true;
  const note = node('p', 'Local CLI catalog only, not deployment state. Catalog identity grants no executable trust; acquisition verifies bytes and approval is a separate explicit step. A bundled catalog is a snapshot at the kernel release and may lag later package releases. Review or copy commands only; nothing is executed here. Commands do not select a workspace; run them only in your intended CLI context.', 'official-catalog-note');
  const content = node('div'); content.hidden = true;
  const facts = node('dl', undefined, 'official-catalog-facts');
  const factValues = ['Origin', 'File', 'Kernel version'].map(label => { const dd = node('dd'); facts.append(node('dt', label), dd); return dd; });
  const notes = node('ul', undefined, 'official-catalog-note');
  function table(caption, headings) {
    const el = node('table', undefined, 'official-catalog-table'); el.append(node('caption', caption));
    const head = node('thead'), row = node('tr');
    for (const label of headings) { const th = node('th', label); th.scope = 'col'; row.append(th); }
    head.append(row); const body = node('tbody'); el.append(head, body);
    return { el, body, headings };
  }
  const packages = table('Package provenance reported by the local CLI', ['Package', 'Source provenance', 'Review / copy only']);
  const mappings = table('Catalog mappings — NOT export inventory', ['Capability mapping', 'Package target', 'Catalog resolution only']);
  const emptyPackages = node('p', '', 'official-catalog-empty'), emptyMappings = node('p', '', 'official-catalog-empty');
  content.append(facts, notes, node('h3', 'Packages'), packages.el, emptyPackages,
    node('h3', 'Catalog mappings — not exports'), node('p', 'Declared mappings are not a complete or verified export inventory. Catalog resolution does not report installation or readiness.', 'official-catalog-note'), mappings.el, emptyMappings);
  section.append(header, status, warning, note, content); host.append(section);

  function ownsRead(owner, ticket, gen) { return alive && epoch === owner && readSerial === ticket && workspaceGeneration() === gen; }
  function resetCopies() {
    copySerial++;
    for (const entry of packageRows.values()) {
      if (!entry.copy) continue;
      entry.copy.disabled = loading;
      setText(entry.feedback, '');
    }
  }
  function clearResult() {
    result = null; content.hidden = true; warning.hidden = true; scopeLabel.hidden = true;
    setText(heading, 'Local CLI catalog'); section.setAttribute('aria-label', 'Local CLI catalog');
    packageRows.clear(); aliasRows.clear(); packages.body.replaceChildren(); mappings.body.replaceChildren();
    for (const dd of factValues) setText(dd, '');
    notes.replaceChildren(); notesSignature = '';
  }
  function cells(row, headings) {
    return headings.map(label => { const td = node('td'); td.dataset.label = label; row.append(td); return td; });
  }
  function packageEntry(item) {
    const row = node('tr'), [name, source, review] = cells(row, packages.headings);
    name.append(node('strong', item.package), node('p', 'Package version: Not reported'), node('p', 'Export inventory: Not reported'));
    source.append(node('p', `Source URL: ${reported(item.url)}`), node('p', `Ref: ${reported(item.ref)}`), node('p', `Payload path: ${reported(item.path)}`));
    const entry = { row, item, search: JSON.stringify(item).toLowerCase(), signature: JSON.stringify(item) };
    if (item.command === null) review.append(node('p', 'Install command unavailable: expected a safe, exact oats install package argv.'));
    else {
      const command = node('input', undefined, 'official-catalog-command'); command.type = 'text'; command.readOnly = true; command.value = item.command;
      command.setAttribute('aria-label', `Install command for ${item.package}`); command.spellcheck = false;
      entry.feedback = node('p', '', 'official-catalog-copy-status'); entry.feedback.setAttribute('role', 'status');
      entry.copy = button('Copy command', () => { void copy(entry); }); entry.copy.setAttribute('aria-label', `Copy install command for ${item.package}`);
      review.append(command, entry.copy, entry.feedback);
    }
    return entry;
  }
  function aliasEntry(item) {
    const row = node('tr'), [name, target, resolution] = cells(row, mappings.headings);
    name.append(node('strong', item.capability));
    target.append(node('p', `Package: ${reported(item.package)}`), node('p', `Mapped capability: ${reported(item.capabilityInPackage)}`));
    resolution.append(node('p', `Via: ${reported(item.via)}`), node('p', `Resolvable in this catalog: ${item.available === true ? 'Yes' : item.available === false ? 'No' : 'Not reported'}`));
    return { row, item, search: JSON.stringify(item).toLowerCase(), signature: JSON.stringify(item) };
  }
  function reconcile(table, entries, items, key, make) {
    const keep = new Set(items.map(item => item[key]));
    for (const [id, entry] of entries) if (!keep.has(id)) { entry.row.remove(); entries.delete(id); }
    for (const [index, item] of items.entries()) {
      const id = item[key], signature = JSON.stringify(item);
      let entry = entries.get(id);
      if (!entry || entry.signature !== signature) {
        const previous = entry; entry = make(item); entries.set(id, entry);
        previous?.row.replaceWith(entry.row);
      }
      if (table.body.children[index] !== entry.row) table.body.insertBefore(entry.row, table.body.children[index] || null);
    }
  }
  function applyFilter() {
    const needle = query.toLowerCase();
    for (const [entries, empty, noun] of [[packageRows, emptyPackages, 'packages'], [aliasRows, emptyMappings, 'catalog mappings']]) {
      let visible = 0;
      for (const entry of entries.values()) { entry.row.hidden = !entry.search.includes(needle); if (!entry.row.hidden) visible++; }
      empty.hidden = visible > 0;
      setText(empty, entries.size ? `No ${noun} match the filter.` : `No ${noun} reported.`);
    }
  }
  function renderResult() {
    content.hidden = false;
    const { catalog } = result;
    const title = catalog.origin === 'bundled' ? 'Official catalog' : 'Local CLI catalog';
    setText(heading, title); scopeLabel.hidden = catalog.origin !== 'bundled';
    section.setAttribute('aria-label', catalog.origin === 'bundled' ? `${title} — Local CLI catalog` : title);
    warning.hidden = catalog.origin !== 'override';
    [catalog.origin, catalog.file, catalog.kernelVersion].forEach((value, i) => setText(factValues[i], reported(value)));
    const signature = JSON.stringify(result.notes);
    if (notesSignature !== signature) { notes.replaceChildren(...result.notes.map(value => node('li', value))); notesSignature = signature; }
    reconcile(packages, packageRows, result.packages, 'package', packageEntry);
    reconcile(mappings, aliasRows, result.aliases, 'capability', aliasEntry);
    applyFilter();
  }
  async function copy(entry) {
    if (!alive || !active || loading || packageRows.get(entry.item.package) !== entry || entry.row.hidden || !section.isConnected) return;
    const owner = epoch, read = readSerial, ticket = ++copySerial, gen = workspaceGeneration();
    resetCopyFeedback(entry);
    const owns = () => alive && active && epoch === owner && readSerial === read && copySerial === ticket
      && workspaceGeneration() === gen && packageRows.get(entry.item.package) === entry && section.isConnected;
    entry.copy.disabled = true; setText(entry.feedback, 'Copying…');
    try {
      let copied;
      if (copyText) copied = await copyText(entry.item.command);
      else {
        const clipboard = doc.defaultView?.navigator?.clipboard;
        if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
        copied = await clipboard.writeText(entry.item.command);
      }
      if (!owns()) return;
      setText(entry.feedback, copied === false ? 'Copy unavailable. Select the command and copy it manually.' : 'Copied command. Nothing was executed.');
    } catch {
      if (!owns()) return;
      setText(entry.feedback, 'Copy unavailable. Select the command and copy it manually.');
    }
    if (!owns()) return;
    entry.copy.disabled = false;
  }
  function resetCopyFeedback(current) {
    // A newer explicit copy owns the shared clipboard feedback, even if a
    // previous row's browser permission prompt resolves later.
    for (const entry of packageRows.values()) if (entry !== current && entry.copy) {
      entry.copy.disabled = false; setText(entry.feedback, '');
    }
  }
  async function refresh() {
    if (!alive || !active) return;
    const owner = epoch, ticket = ++readSerial, gen = workspaceGeneration();
    attempted = true; loading = true; resetCopies(); retry.disabled = true;
    setText(status, result ? 'Refreshing local CLI catalog…' : 'Loading local CLI catalog…');
    try {
      const value = await postJson(ctx, '/api/catalog', {});
      if (!ownsRead(owner, ticket, gen)) return;
      const next = catalogResult(value);
      if (next.failure !== undefined) { clearResult(); setText(status, `Catalog unavailable. ${next.failure} Requires OATS ${minimumVersion} or newer with catalog support. Retry when available.`); }
      else { result = next; renderResult(); setText(status, ''); }
    } catch (error) {
      if (!ownsRead(owner, ticket, gen)) return;
      clearResult();
      setText(status, `Catalog unavailable. ${text(error?.message) ? error.message : 'Could not read the local CLI catalog.'} Requires OATS ${minimumVersion} or newer with catalog support. Retry when available.`);
    }
    if (!ownsRead(owner, ticket, gen)) return;
    loading = false; resetCopies(); retry.disabled = false; setText(retry, result ? 'Refresh catalog' : 'Retry catalog');
  }
  function setQuery(value) {
    if (!alive) return;
    const next = typeof value === 'string' ? value : '';
    if (filter.value !== next) filter.value = next;
    if (query === next) return;
    query = next; applyFilter();
  }
  return {
    update(next) {
      if (!alive) return;
      if (!hasIdentity || !Object.is(identity, next.identity)) {
        hasIdentity = true; identity = next.identity; epoch++; readSerial++; attempted = false; loading = false;
        resetCopies(); clearResult(); setText(status, ''); retry.disabled = false; setText(retry, 'Refresh catalog');
      }
      const nextActive = next.active === true;
      if (active && !nextActive) resetCopies();
      active = nextActive; section.hidden = !active;
      if (active && !attempted) return refresh();
    },
    refresh, setQuery,
    dispose() {
      if (!alive) return;
      alive = false; epoch++; readSerial++; copySerial++; section.remove(); packageRows.clear(); aliasRows.clear();
    },
  };
}
