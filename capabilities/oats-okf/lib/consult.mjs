// okf 3.0.0 consult: souls read their knowledge REMOTELY, at the accepted
// state, with no per-instance copy. The only local bytes are one host-wide bare
// partial clone per Git base (blobs arrive on first read) under the bindings'
// stateDir; directory bases are read in place under their cooperative lock.
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fs, join, dirname, safePath, readJSON, save, digest, tree, withLock, fail, syncDir, identifier } from './io.mjs';
import { noGit, gitTimeoutMs, consultMaxAgeMs, splitRef, resolveNodes } from './config.mjs';
import { git, gitEnv, validateBase, baseLock, journalPath, preflightLocalRepository, requireNotShallow, verifyRemote, unavailable } from './stores.mjs';

const HIT_LIMIT = 50, SNIPPET = 200, FRONTMATTER_BYTES = 8 * 1024, TEXT_BYTES = 64 * 1024 * 1024;
const WALK_FILES = 20000, WALK_BYTES = 256 * 1024 * 1024, DIRECTORY_WAIT_MS = 30000, LOCAL_GIT_MS = 30000;
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------- paths
/** Resolve a user path or OKF link to a canonical path relative to the base
 *  root ('' is the root). `/node/x.md` is base-root absolute, a relative path
 *  resolves against the directory of `from` (itself a base path), and a bare
 *  path without `from` resolves from the root. Nothing may leave the root. */
export function resolveBasePath(input, { from = null, fsRoots = [] } = {}) {
  if (typeof input !== 'string' || !input.trim()) fail('E_USAGE', 'a base path is required, for example /node/index.md');
  const raw = input.trim();
  if (/[\0\\]/.test(raw)) fail('E_PATH', `not a base path: ${JSON.stringify(input)}`);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) || raw.startsWith('//')) fail('E_PATH', `${input} is a URL, not a path in the knowledge base`);
  let decoded;
  try { decoded = decodeURIComponent(raw.replace(/[?#].*$/, '')); } catch { fail('E_PATH', `malformed percent-encoding in ${input}`); }
  if (!decoded || /[\0\\]/.test(decoded)) fail('E_PATH', `not a base path: ${JSON.stringify(input)}`);
  for (const root of fsRoots.filter(Boolean)) if (decoded === root || decoded.startsWith(root + '/')) fail('E_PATH', `${input} is a filesystem path; base paths start at the base root, like /node/concept.md`);
  const segments = decoded.startsWith('/') ? decoded.slice(1).split('/')
    : from !== null ? [...from.split('/').slice(0, -1), ...decoded.split('/')] : decoded.split('/');
  const out = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') { if (!out.length) fail('E_PATH', `${input} escapes the base root`); out.pop(); continue; }
    if (segment.startsWith('.')) fail('E_PATH', `${input}: hidden paths are not knowledge`);
    out.push(segment);
  }
  return out.join('/');
}
const parent = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const shown = p => '/' + p;

// ---------------------------------------------------------------- git cache
const cacheDir = (bindings, base) => join(bindings.stateDir, 'cache', `${identifier(base.id)}.git`);
const cacheLock = (bindings, base) => join(bindings.stateDir, 'cache', `${base.id}.lock`);
const stateFile = cache => join(cache, 'okf-consult.json');
function gitRun(cwd, args, { input, timeout = LOCAL_GIT_MS, maxBuffer = TEXT_BYTES, encoding = 'utf8' } = {}) {
  return spawnSync('git', ['--no-replace-objects', '--literal-pathspecs', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.ext.allow=never', '-C', cwd, ...args],
    { cwd, env: gitEnv(), input, timeout, maxBuffer, encoding });
}
const gitError = r => Object.assign(new Error(`git failed: ${r.error?.message || r.stderr || `exit ${r.status}`}`), { code: r.error?.code === 'ETIMEDOUT' ? 'ETIMEDOUT' : 'E_COMMAND' });
function acceptedCommit(cache, base) {
  const r = gitRun(cache, ['rev-parse', '--verify', '--quiet', `refs/heads/${base.acceptedBranch}^{commit}`]);
  const oid = r.status === 0 ? r.stdout.trim() : '';
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid) ? oid : null;
}
/** The cache's bookkeeping, or null when the cache is absent or belongs to a
 *  different repository/branch (then it is rebuilt, never reinterpreted). */
function usableCache(cache, base) {
  if (!fs.existsSync(cache)) return null;
  safePath(cache);
  let state;
  try { state = readJSON(stateFile(cache)); } catch { return null; }
  if (!obj(state) || state.version !== 1 || state.repository !== base.repository || state.acceptedBranch !== base.acceptedBranch) return null;
  try { verifyRemote(base, cache); } catch { return null; }
  return acceptedCommit(cache, base) ? state : null;
}
function cloneCache(base, alias, dest) {
  preflightLocalRepository(base, alias);
  // --no-local: a local path gets the same filtered transport as a remote
  // (git ignores --filter for local clones and would copy every object).
  const args = ['clone', '--bare', ...(base.repository.startsWith('/') ? ['--no-local'] : []), '--single-branch', '--branch', base.acceptedBranch];
  try { git(dirname(dest), [...args, '--filter=blob:none', '--', base.repository, dest], { timeout: gitTimeoutMs() }); }
  catch (e) {
    fs.rmSync(dest, { recursive: true, force: true });
    if (!(e.code === 'E_COMMAND' && /filter/i.test(e.message))) unavailable(base, alias, 'clone', e);
    try { git(dirname(dest), [...args, '--', base.repository, dest], { timeout: gitTimeoutMs() }); }
    catch (error) { unavailable(base, alias, 'clone', error); }
  }
  try { requireNotShallow(base, alias, dest); } catch (e) { if (e.code === 'E_BASE_SHALLOW') throw e; unavailable(base, alias, 'clone', e); }
  verifyRemote(base, dest);
  if (!acceptedCommit(dest, base)) unavailable(base, alias, 'clone', new Error(`accepted branch ${base.acceptedBranch} not found`));
}
function fetchAccepted(base, alias, cache) {
  // Only the accepted branch, forced to what the remote accepts now.
  try { git(cache, ['fetch', '--no-tags', '--update-head-ok', 'origin', `+refs/heads/${base.acceptedBranch}:refs/heads/${base.acceptedBranch}`], { timeout: gitTimeoutMs() }); }
  catch (e) { unavailable(base, alias, 'fetch', e); }
  try { requireNotShallow(base, alias, cache); } catch (e) { if (e.code === 'E_BASE_SHALLOW') throw e; unavailable(base, alias, 'fetch', e); }
  verifyRemote(base, cache);
}
function gitContext(bindings, alias, base, cache, state) {
  const commit = acceptedCommit(cache, base);
  if (!commit) unavailable(base, alias, 'fetch', new Error('cached accepted branch is missing'));
  const receipt = { base: alias, id: base.id, kind: 'git', commit, fetchedAt: state.fetchedAt, stale: !!state.error };
  if (state.error) receipt.reason = state.error;
  return { alias, base, bindings, kind: 'git', cache, commit, receipt };
}
function resolveGit(bindings, alias, base, { fresh = false } = {}) {
  const cache = cacheDir(bindings, base), lock = cacheLock(bindings, base);
  fs.mkdirSync(dirname(cache), { recursive: true, mode: 0o700 });
  const due = s => fresh || Date.now() - Math.max(Date.parse(s.fetchedAt) || 0, Date.parse(s.attemptedAt) || 0) >= consultMaxAgeMs();
  let state = usableCache(cache, base);
  if (state && !due(state)) return gitContext(bindings, alias, base, cache, state);
  clearDeadCacheLock(lock);
  try {
    return withLock(lock, () => {
      state = usableCache(cache, base);
      if (state && !due(state)) return gitContext(bindings, alias, base, cache, state); // a peer just fetched
      const now = new Date().toISOString();
      if (!state) {
        const temp = join(dirname(cache), `.${base.id}.git.tmp-${randomUUID()}`);
        try {
          cloneCache(base, alias, temp);
          const created = { version: 1, repository: base.repository, acceptedBranch: base.acceptedBranch, fetchedAt: now, attemptedAt: now, error: null };
          save(stateFile(temp), created);
          // Readers only ever see a complete cache: build aside, then rename.
          const old = fs.existsSync(cache) ? `${cache}.old-${randomUUID()}` : null;
          if (old) fs.renameSync(cache, old);
          fs.renameSync(temp, cache); syncDir(dirname(cache));
          if (old) fs.rmSync(old, { recursive: true, force: true });
          return gitContext(bindings, alias, base, cache, created);
        } finally { fs.rmSync(temp, { recursive: true, force: true }); }
      }
      try { fetchAccepted(base, alias, cache); state = { ...state, fetchedAt: now, attemptedAt: now, error: null }; }
      catch (e) {
        if (e.code !== 'E_BASE_UNAVAILABLE') throw e;
        // Serve the last fetched accepted commit, loudly; retry after max-age or --fresh.
        state = { ...state, attemptedAt: now, error: `fetch of the accepted branch failed at ${now} (reason: ${e.reason || 'unknown'}); serving the last fetched accepted commit` };
      }
      save(stateFile(cache), state);
      return gitContext(bindings, alias, base, cache, state);
    }, { waitMs: state ? Math.min(gitTimeoutMs(), 60000) : gitTimeoutMs() }); // a cached commit can be served sooner
  } catch (e) {
    if (e.code === 'E_LOCKED' && state) return gitContext(bindings, alias, base, cache, { ...state, error: `host cache lock is busy (${lock}); serving the last fetched accepted commit` });
    throw e;
  }
}
/** The cache is disposable host state, not accepted custody: a lock whose
 *  owner process on this host is gone is released (an interrupted clone is
 *  built aside and never renamed in; an interrupted fetch leaves refs whole).
 *  A live, foreign-host or unreadable owner is always waited for. */
function clearDeadCacheLock(lock) {
  let owner; try { owner = readJSON(join(lock, 'owner.json')); } catch { return; }
  if (owner?.host !== hostname() || !Number.isInteger(owner.pid)) return;
  try { process.kill(owner.pid, 0); } catch (e) {
    if (e.code !== 'ESRCH') return;
    let current; try { current = readJSON(join(lock, 'owner.json')); } catch { return; }
    if (current?.token === owner.token) fs.rmSync(lock, { recursive: true, force: true }); // still the dead owner's lock
  }
}
const repoPath = (ctx, p) => ctx.base.root === '.' ? p : (p ? `${ctx.base.root}/${p}` : ctx.base.root);
const basePathOf = (ctx, p) => ctx.base.root === '.' ? p : p.slice(ctx.base.root.length + 1);
function lsTree(ctx, p, { recursive = false } = {}) {
  const r = gitRun(ctx.cache, ['ls-tree', '-z', ...(recursive ? ['-r'] : []), `${ctx.commit}:${repoPath(ctx, p)}`]);
  if (r.status !== 0) throw gitError(r);
  return r.stdout.split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t'), [mode, type, oid] = line.slice(0, tab).split(' ');
    return { name: line.slice(tab + 1), mode, type, oid };
  });
}
function gitEntry(ctx, p) {
  if (!p) return { type: 'dir' };
  const r = gitRun(ctx.cache, ['ls-tree', '-z', ctx.commit, '--', repoPath(ctx, p)]);
  if (r.status !== 0) throw gitError(r);
  const line = r.stdout.split('\0').filter(Boolean)[0];
  if (!line) return null;
  const tab = line.indexOf('\t'), [mode, type, oid] = line.slice(0, tab).split(' ');
  if (line.slice(tab + 1) !== repoPath(ctx, p)) return null;
  if (mode === '040000' && type === 'tree') return { type: 'dir', oid };
  if (['100644', '100755'].includes(mode) && type === 'blob') return { type: 'file', oid };
  fail('E_PATH', `${ctx.alias}${shown(p)}: symlink or submodule in knowledge base is not allowed`);
}
/** One batched fetch for the blobs a command is about to read, instead of one
 *  lazy round trip per blob. Best effort: a failure surfaces on the read. */
function prefetch(ctx, p, only = null) {
  const r = gitRun(ctx.cache, ['rev-list', '--objects', '--missing=print', `${ctx.commit}:${repoPath(ctx, p)}`]);
  if (r.status !== 0) return;
  const missing = r.stdout.split('\n').filter(l => l.startsWith('?')).map(l => l.slice(1).trim()).filter(oid => !only || only.has(oid));
  if (!missing.length) return;
  try {
    withLock(cacheLock(ctx.bindings, ctx.base), () => gitRun(ctx.cache, ['-c', 'fetch.negotiationAlgorithm=noop', 'fetch', '--no-tags', '--no-write-fetch-head', '--recurse-submodules=no', '--filter=blob:none', 'origin', '--stdin'],
      { input: missing.join('\n') + '\n', timeout: gitTimeoutMs() }), { waitMs: gitTimeoutMs() });
  } catch { /* lazy reads remain authoritative */ }
}
function gitBlob(ctx, oid, p, { limit } = {}) {
  const r = gitRun(ctx.cache, ['cat-file', 'blob', oid], { timeout: gitTimeoutMs(), maxBuffer: limit ?? TEXT_BYTES });
  if (r.error?.code === 'ENOBUFS') { if (limit) return r.stdout; fail('E_TOO_LARGE', `${ctx.alias}${shown(p)} exceeds ${TEXT_BYTES} bytes`); }
  if (r.error || r.status !== 0) unavailable(ctx.base, ctx.alias, 'read', gitError(r));
  return r.stdout;
}

// ---------------------------------------------------------------- stores
function dirEntry(ctx, p) {
  const file = safePath(join(ctx.base.path, p));
  let stat; try { stat = fs.lstatSync(file); } catch (e) { if (['ENOENT', 'ENOTDIR'].includes(e.code)) return null; throw e; }
  if (stat.isDirectory()) return { type: 'dir', file };
  if (stat.isFile()) { if (stat.nlink !== 1) fail('E_PATH', `${ctx.alias}${shown(p)}: hardlink not allowed`); return { type: 'file', file }; }
  fail('E_PATH', `${ctx.alias}${shown(p)}: unsupported entry in knowledge base`);
}
function readBounded(file, limit) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const size = fs.fstatSync(fd).size;
    if (!limit && size > TEXT_BYTES) fail('E_TOO_LARGE', `${file} exceeds ${TEXT_BYTES} bytes`);
    const bytes = Buffer.alloc(Math.min(size, limit ?? size)); let length = 0;
    while (length < bytes.length) { const n = fs.readSync(fd, bytes, length, bytes.length - length, null); if (!n) break; length += n; }
    return bytes.subarray(0, length).toString('utf8');
  } finally { fs.closeSync(fd); }
}
const entry = (ctx, p) => ctx.kind === 'git' ? gitEntry(ctx, p) : dirEntry(ctx, p);
function read(ctx, p, e = entry(ctx, p), opts) { return ctx.kind === 'git' ? gitBlob(ctx, e.oid, p, opts) : readBounded(e.file, opts?.limit); }
function children(ctx, p) {
  const rows = ctx.kind === 'git'
    ? lsTree(ctx, p).map(r => ({ name: r.name, oid: r.oid, type: r.mode === '040000' ? 'dir' : ['100644', '100755'].includes(r.mode) ? 'file' : 'unsupported' }))
    : fs.readdirSync(safePath(join(ctx.base.path, p)), { withFileTypes: true }).map(d => ({ name: d.name, file: join(ctx.base.path, p, d.name), type: d.isDirectory() ? 'dir' : d.isFile() ? 'file' : 'unsupported' }));
  return rows.filter(r => !r.name.startsWith('.')).sort((a, b) => (a.type === 'dir') !== (b.type === 'dir') ? (a.type === 'dir' ? -1 : 1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
function notFound(ctx, p) {
  let dir = parent(p);
  while (dir && entry(ctx, dir)?.type !== 'dir') dir = parent(dir);
  const rows = children(ctx, dir), names = rows.slice(0, 20).map(r => r.type === 'dir' ? `${r.name}/` : r.name);
  fail('E_NOT_FOUND', `${ctx.alias}${shown(p)} does not exist at ${short(ctx.receipt)}; \`oats okf ls --base ${ctx.alias} ${shown(dir)}\` lists: ${names.join(', ') || '(empty)'}${rows.length > 20 ? `, and ${rows.length - 20} more` : ''}`);
}
function requireFile(ctx, p) {
  if (!p.endsWith('.md')) fail('E_NOT_MARKDOWN', `${ctx.alias}${shown(p)} is not a Markdown file; cat reads only .md concepts (use ls for directories)`);
  const e = entry(ctx, p);
  if (!e) notFound(ctx, p);
  if (e.type !== 'file') fail('E_NOT_MARKDOWN', `${ctx.alias}${shown(p)} is a directory; use ls`);
  return e;
}

/** Run fn against one base at its accepted state. Git: the host cache (fetched
 *  per freshness rules). Directory: in place, under the base lock, refusing a
 *  pending publication exactly as staging does. */
export function withBase(bindings, alias, { fresh = false } = {}, fn) {
  if (typeof alias !== 'string' || !Object.hasOwn(bindings.bases, alias)) fail('E_BASE_UNKNOWN', `unknown base ${JSON.stringify(alias ?? null)}; bound bases: ${Object.keys(bindings.bases).join(', ')}`);
  const base = bindings.bases[alias];
  if (base.kind === 'git') return fn(resolveGit(bindings, alias, base, { fresh }));
  noGit(base.path);
  return withLock(baseLock(base), () => {
    if (fs.existsSync(journalPath(base))) fail('E_RECOVERY', `publication pending: ${journalPath(base)}; retry its recorded run before reading`);
    if (!fs.existsSync(safePath(base.path))) fail('E_BASE_UNAVAILABLE', `directory base "${alias}" is missing at ${base.path}`);
    const ctx = { alias, base, bindings, kind: 'directory' };
    ctx.receipt = { base: alias, id: base.id, kind: 'directory', digest: digest(tree(base.path)), fetchedAt: new Date().toISOString(), stale: false };
    return fn(ctx);
  }, { waitMs: DIRECTORY_WAIT_MS });
}

// ---------------------------------------------------------------- validation
const VALIDATION_CODES = new Set(['E_VALIDATION', 'E_BASE', 'E_PATH', 'E_ID', 'E_CONFIG']);
/** Whether the accepted state is a valid OKF base. Git verdicts are cached per
 *  commit inside the host cache; computing one materializes the base root into
 *  a transient host scratch that is removed before returning. */
export function verdict(ctx) {
  const judge = run => {
    try { const v = run(); return { version: 1, ok: true, digest: v.digest, nodes: v.meta.nodes }; }
    catch (e) { if (!VALIDATION_CODES.has(e.code)) throw e; return { version: 1, ok: false, error: { code: e.code, message: e.message } }; }
  };
  if (ctx.kind === 'directory') return judge(() => validateBase(ctx.base.path, ctx.base));
  const file = join(ctx.cache, 'okf-validation', `${ctx.commit}.json`);
  if (fs.existsSync(file)) { const cached = readJSON(file); if (cached?.version === 1) return cached; }
  const scratch = fs.mkdtempSync(join(dirname(ctx.cache), '.validate-'));
  try {
    const result = judge(() => {
      const rows = lsTree(ctx, '', { recursive: true });
      for (const r of rows) if (!['100644', '100755'].includes(r.mode) || r.type !== 'blob') fail('E_PATH', 'symlink or submodule in knowledge base is not allowed');
      prefetch(ctx, '');
      for (const r of rows) {
        const target = safePath(join(scratch, r.name)); fs.mkdirSync(dirname(target), { recursive: true });
        const fd = fs.openSync(target, 'wx', 0o600);
        let w; try { w = spawnSync('git', ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', '-C', ctx.cache, 'cat-file', 'blob', r.oid], { env: gitEnv(), timeout: gitTimeoutMs(), stdio: ['ignore', fd, 'pipe'] }); } finally { fs.closeSync(fd); }
        if (w.error || w.status !== 0) unavailable(ctx.base, ctx.alias, 'read', gitError(w));
      }
      return validateBase(scratch, ctx.base);
    });
    save(file, { ...result, commit: ctx.commit, at: new Date().toISOString() });
    return result;
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
/** Registration's accepted resolution: per base, the accepted commit/digest and
 *  its nodes, validated, and the soul's declaration resolved against them. No
 *  files are materialized for the instance. */
export function acceptedResolution(bindings, decl) {
  const view = {}, accepted = {};
  for (const alias of Object.keys(bindings.bases)) withBase(bindings, alias, {}, ctx => {
    const v = verdict(ctx);
    if (!v.ok) fail(v.error.code, `base "${alias}" at ${short(ctx.receipt)}: ${v.error.message}`);
    accepted[alias] = { nodes: v.nodes };
    view[alias] = { ...ctx.receipt, digest: v.digest, nodes: v.nodes };
  });
  resolveNodes(decl, bindings, accepted);
  return view;
}

// ---------------------------------------------------------------- helpers
function nodesOf(ctx) {
  let m;
  const e = entry(ctx, 'okf-base.json');
  try { m = JSON.parse(e ? read(ctx, 'okf-base.json', e) : ''); } catch { fail('E_BASE', `base "${ctx.alias}" has no valid okf-base.json at ${short(ctx.receipt)}`); }
  if (!obj(m?.nodes)) fail('E_BASE', `base "${ctx.alias}" okf-base.json has no nodes`);
  return m.nodes;
}
function nodePath(ctx, node) {
  const nodes = nodesOf(ctx);
  if (!Object.hasOwn(nodes, node) || typeof nodes[node]?.path !== 'string') fail('E_NOT_FOUND', `base "${ctx.alias}" has no node "${node}"; nodes: ${Object.keys(nodes).join(', ')}`);
  return resolveBasePath(nodes[node].path);
}
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?(?:\n|$)/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(type|title|description):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2').slice(0, 300);
  }
  return out;
}
export function markdownLinks(text) {
  const clean = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
  const links = [], seen = new Set();
  const add = (label, target) => { if (!target || seen.has(target)) return; seen.add(target); links.push({ text: label, target }); };
  for (const m of clean.matchAll(/!?\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)) add(m[1], m[2]);
  for (const m of clean.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s+.*)?$/gm)) add(m[1], m[2]);
  return links;
}
function age(iso) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 5 ? 'just now' : s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 172800 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
}
export const short = r => `${r.base}@${r.kind === 'git' ? r.commit.slice(0, 12) : `dir:${r.digest.slice(0, 12)}`}`;
export const footer = receipts => receipts.map(r => `— ${short(r)} (fetched ${age(r.fetchedAt)}${r.stale ? `; STALE: ${r.reason}` : ''})`).join('\n');
const fsRoots = (source, ctx) => [source.home, source.work, source.bindings.stateDir, dirname(source.bindings.file), ctx.kind === 'directory' ? ctx.base.path : null];
const refsOf = decl => [...decl.owns.map(ref => [ref, 'owns']), ...decl.reads.filter(ref => !decl.owns.includes(ref)).map(ref => [ref, 'reads'])];
function needBase(source, flags) {
  if (!flags.base) fail('E_USAGE', `--base ALIAS is required; bound bases: ${Object.keys(source.bindings.bases).join(', ')}`);
  return flags.base;
}
function onePath(positionals, label) {
  if (positionals.length !== 1) fail('E_USAGE', `expected one ${label}`);
  return positionals[0];
}

// ---------------------------------------------------------------- commands
export function bases(source, flags) {
  const rows = [], receipts = [];
  for (const [alias, base] of Object.entries(source.bindings.bases)) withBase(source.bindings, alias, { fresh: !!flags.fresh }, ctx => {
    const v = verdict(ctx), mine = relation => source.decl[relation].filter(ref => splitRef(ref)[0] === alias).map(ref => splitRef(ref)[1]);
    rows.push({ alias, id: base.id, kind: base.kind, ...(base.kind === 'git' ? { repository: base.repository, acceptedBranch: base.acceptedBranch, root: base.root, commit: ctx.commit } : { path: base.path, digest: ctx.receipt.digest }),
      fetchedAt: ctx.receipt.fetchedAt, stale: ctx.receipt.stale, ...(ctx.receipt.reason ? { reason: ctx.receipt.reason } : {}),
      validated: v.ok ? { ok: true } : { ok: false, error: v.error }, nodes: v.ok ? Object.keys(v.nodes) : null, owns: mine('owns'), reads: mine('reads'), receipt: ctx.receipt });
    receipts.push(ctx.receipt);
  });
  const text = rows.map(r => `${r.alias} (${r.kind}) ${r.kind === 'git' ? `${r.repository} ${r.acceptedBranch} root=${r.root}` : r.path}\n  accepted ${short(r.receipt)} fetched ${age(r.fetchedAt)}${r.stale ? ` STALE: ${r.reason}` : ''}; ${r.validated.ok ? 'valid OKF base' : `INVALID: ${r.validated.error.message}`}\n  owns: ${r.owns.join(', ') || '-'}; reads: ${r.reads.join(', ') || '-'}${r.nodes ? `; nodes: ${r.nodes.join(', ')}` : ''}`).join('\n');
  return { result: { bases: rows }, text: `${text}\n${footer(receipts)}` };
}
export function index(source, flags, positionals) {
  if (positionals.length > 1) fail('E_USAGE', 'index takes at most one node');
  let targets;
  const relation = (alias, node) => refsOf(source.decl).find(([ref]) => ref === `${alias}/${node}`)?.[1] ?? null;
  if (positionals.length) {
    let alias = flags.base, node = positionals[0];
    if (node.includes('/')) { const [a, n] = splitRef(node); if (alias && alias !== a) fail('E_USAGE', `--base ${alias} disagrees with ${node}`); alias = a; node = n; }
    else if (!alias) {
      const matches = refsOf(source.decl).filter(([ref]) => splitRef(ref)[1] === node);
      if (matches.length !== 1) fail('E_USAGE', matches.length ? `node "${node}" is in several bases (${matches.map(([r]) => r).join(', ')}); pass --base ALIAS` : `node "${node}" is not one of your nodes (${refsOf(source.decl).map(([r]) => r).join(', ') || 'none'}); pass --base ALIAS`);
      alias = splitRef(matches[0][0])[0];
    }
    targets = [{ alias, node }];
  } else if (flags.base) targets = [{ alias: flags.base, node: null }];
  else targets = refsOf(source.decl).map(([ref]) => { const [alias, node] = splitRef(ref); return { alias, node }; });
  if (!targets.length) fail('E_USAGE', 'this soul owns and reads no nodes; pass --base ALIAS [node]');
  const indexes = [], receipts = [];
  for (const alias of [...new Set(targets.map(t => t.alias))]) withBase(source.bindings, alias, { fresh: !!flags.fresh }, ctx => {
    receipts.push(ctx.receipt);
    for (const t of targets.filter(t => t.alias === alias)) {
      const path = t.node ? `${nodePath(ctx, t.node)}/index.md` : 'index.md', e = requireFile(ctx, path);
      indexes.push({ base: alias, node: t.node, relation: t.node ? relation(alias, t.node) : null, path, text: read(ctx, path, e), receipt: ctx.receipt });
    }
  });
  const order = new Map(targets.map((t, i) => [`${t.alias}/${t.node}`, i]));
  indexes.sort((a, b) => order.get(`${a.base}/${a.node}`) - order.get(`${b.base}/${b.node}`));
  const text = indexes.map(x => `## ${x.node ? `${x.base}/${x.node}` : x.base}${x.relation ? ` (${x.relation})` : ''}\n\n${x.text.trimEnd()}\n`).join('\n');
  return { result: { indexes }, text: `${text}\n${footer(receipts)}` };
}
export function cat(source, flags, positionals) {
  const input = onePath(positionals, 'path');
  return withBase(source.bindings, needBase(source, flags), { fresh: !!flags.fresh }, ctx => {
    const roots = fsRoots(source, ctx);
    const from = flags.from === undefined ? null : resolveBasePath(flags.from, { fsRoots: roots });
    const path = resolveBasePath(input, { from, fsRoots: roots }), e = requireFile(ctx, path);
    const text = read(ctx, path, e);
    return { result: { path, text, receipt: ctx.receipt }, text: `${text.trimEnd()}\n${footer([ctx.receipt])}` };
  });
}
export function ls(source, flags, positionals) {
  if (positionals.length > 1) fail('E_USAGE', 'ls takes at most one directory');
  return withBase(source.bindings, needBase(source, flags), { fresh: !!flags.fresh }, ctx => {
    const path = positionals.length ? resolveBasePath(positionals[0], { fsRoots: fsRoots(source, ctx) }) : '';
    const e = entry(ctx, path);
    if (!e) notFound(ctx, path);
    if (e.type !== 'dir') fail('E_USAGE', `${ctx.alias}${shown(path)} is a file; use cat`);
    const rows = children(ctx, path);
    if (ctx.kind === 'git') prefetch(ctx, path, new Set(rows.filter(r => r.type === 'file' && r.name.endsWith('.md')).map(r => r.oid)));
    const entries = rows.map(r => {
      const p = path ? `${path}/${r.name}` : r.name, out = { name: r.name, path: p, kind: r.type };
      if (r.type === 'file' && r.name.endsWith('.md')) {
        const fm = frontmatter(ctx.kind === 'git' ? gitBlob(ctx, r.oid, p, { limit: FRONTMATTER_BYTES }) : readBounded(safePath(r.file), FRONTMATTER_BYTES));
        if (fm) Object.assign(out, fm);
      }
      return out;
    });
    const text = entries.map(x => {
      if (x.kind === 'dir') return `${x.name}/`;
      if (x.kind === 'unsupported') return `${x.name}  (unsupported entry, refused)`;
      const meta = [x.type ? `[${x.type}]` : '', x.title, x.description ? `— ${x.description}` : ''].filter(Boolean).join(' ');
      return meta ? `${x.name}  ${meta}` : x.name;
    }).join('\n');
    return { result: { path, entries, receipt: ctx.receipt }, text: `${shown(path)}\n${text || '(empty)'}\n${footer([ctx.receipt])}` };
  });
}
export function links(source, flags, positionals) {
  const input = onePath(positionals, 'path');
  return withBase(source.bindings, needBase(source, flags), { fresh: !!flags.fresh }, ctx => {
    const roots = fsRoots(source, ctx), path = resolveBasePath(input, { fsRoots: roots }), e = requireFile(ctx, path);
    const rows = markdownLinks(read(ctx, path, e)).filter(l => !l.target.startsWith('#')).map(l => {
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(l.target) || l.target.startsWith('//')) return { ...l, external: true };
      try {
        const p = resolveBasePath(l.target, { from: path, fsRoots: roots }), found = p ? entry(ctx, p) : { type: 'dir' };
        return { ...l, path: p, exists: !!found, ...(found?.type === 'dir' ? { directory: true } : {}) };
      } catch (err) { if (!['E_PATH', 'E_USAGE'].includes(err.code)) throw err; return { ...l, exists: false, refused: err.message }; }
    });
    const text = rows.map(r => r.external ? `external  ${r.target}` : r.refused ? `REFUSED   ${r.target} (${r.refused})` : `${r.exists ? 'ok       ' : 'MISSING  '} ${shown(r.path)}${r.target !== shown(r.path) ? `  (${r.target})` : ''}`).join('\n');
    return { result: { path, links: rows, receipt: ctx.receipt }, text: `${shown(path)} links:\n${text || '(none)'}\n${footer([ctx.receipt])}` };
  });
}
function matcher(query, { regex, caseSensitive }) {
  if (regex) { let re; try { re = new RegExp(query, caseSensitive ? '' : 'i'); } catch (e) { fail('E_USAGE', `invalid --regex: ${e.message}`); } return line => { const m = re.exec(line); return m ? m.index : -1; }; }
  const needle = caseSensitive ? query : query.toLowerCase();
  return line => (caseSensitive ? line : line.toLowerCase()).indexOf(needle);
}
function snippet(line, at) {
  const text = line.trim(), offset = Math.max(0, (at ?? 0) - (line.length - line.trimStart().length) - 60);
  const cut = text.length <= SNIPPET ? text : text.slice(offset, offset + SNIPPET);
  return `${offset > 0 && text.length > SNIPPET ? '…' : ''}${cut}${offset + SNIPPET < text.length ? '…' : ''}`;
}
function searchBase(ctx, prefix, query, opts, hits) {
  const find = matcher(query, opts);
  if (ctx.kind === 'git') {
    prefetch(ctx, prefix);
    const r = gitRun(ctx.cache, ['grep', '-z', '-n', '-I', '--no-color', ...(opts.regex ? ['-E'] : ['-F']), ...(opts.caseSensitive ? [] : ['-i']), '-e', query, ctx.commit, '--', repoPath(ctx, prefix) || '.'], { timeout: gitTimeoutMs() });
    if (r.error?.code === 'ENOBUFS') fail('E_TOO_LARGE', 'search output is too large; narrow it with --node or a longer query');
    if (r.status === 1 && !r.stderr.trim()) return;
    if (r.error || r.status !== 0) unavailable(ctx.base, ctx.alias, 'search', gitError(r));
    for (const line of r.stdout.split('\n').filter(Boolean)) {
      const [where, number, ...rest] = line.split('\0'), repo = where.slice(ctx.commit.length + 1), text = rest.join('\0');
      if (!repo.endsWith('.md') || (ctx.base.root !== '.' && !repo.startsWith(ctx.base.root + '/'))) continue;
      const p = basePathOf(ctx, repo);
      if (p.split('/').some(s => s.startsWith('.'))) continue;
      hits.push({ base: ctx.alias, path: p, line: Number(number), snippet: snippet(text, find(text)) });
    }
    return;
  }
  let files = 0, bytes = 0;
  const walk = dir => {
    for (const r of children(ctx, dir)) {
      const p = dir ? `${dir}/${r.name}` : r.name;
      if (r.type === 'dir') { walk(p); continue; }
      if (r.type !== 'file' || !r.name.endsWith('.md')) continue;
      const e = dirEntry(ctx, p);
      if (++files > WALK_FILES || (bytes += fs.statSync(e.file).size) > WALK_BYTES) fail('E_TOO_LARGE', `directory search is bounded to ${WALK_FILES} files / ${WALK_BYTES} bytes; narrow it with --node`);
      readBounded(e.file).split(/\r?\n/).forEach((text, i) => { const at = find(text); if (at >= 0) hits.push({ base: ctx.alias, path: p, line: i + 1, snippet: snippet(text, at) }); });
    }
  };
  walk(prefix);
}
export function search(source, flags, positionals) {
  if (!positionals.length) fail('E_USAGE', 'search needs the text to look for');
  const query = positionals.join(' ');
  if (flags.all && flags.base) fail('E_USAGE', 'choose --base ALIAS or --all');
  let node = flags.node ?? null, only = flags.base ?? null;
  if (node && node.includes('/')) { const [a, n] = splitRef(node); if (only && only !== a) fail('E_USAGE', `--base ${only} disagrees with --node ${node}`); only = a; node = n; }
  const mine = [...new Set(refsOf(source.decl).map(([ref]) => splitRef(ref)[0]))];
  const scope = only ? [only] : flags.all || !mine.length ? Object.keys(source.bindings.bases) : mine;
  if (node && scope.length !== 1) fail('E_USAGE', '--node needs one base: pass --base ALIAS or --node ALIAS/NODE');
  const hits = [], receipts = [];
  for (const alias of scope) withBase(source.bindings, alias, { fresh: !!flags.fresh }, ctx => {
    receipts.push(ctx.receipt);
    searchBase(ctx, node ? nodePath(ctx, node) : '', query, { regex: !!flags.regex, caseSensitive: !!flags['case-sensitive'] }, hits);
  });
  const shownHits = hits.slice(0, HIT_LIMIT), more = hits.length - shownHits.length;
  const text = shownHits.map(h => `${h.base}${shown(h.path)}:${h.line}: ${h.snippet}`).join('\n');
  return { result: { query, regex: !!flags.regex, bases: scope, node, hits: shownHits, total: hits.length, more, receipts: Object.fromEntries(receipts.map(r => [r.base, r])) },
    text: `${text || `no matches for ${JSON.stringify(query)}`}${more ? `\n… and ${more} more (narrow with --node or a longer query)` : ''}\n${footer(receipts)}` };
}
/** okf 2.x compatibility: read --base A [--path P] is cat of P (default the base index). */
export function readCompat(source, flags) {
  return cat(source, { base: flags.base, fresh: flags.fresh }, [flags.path ?? 'index.md']);
}
export const CONSULT = { bases, index, cat, ls, links, search, read: readCompat };
