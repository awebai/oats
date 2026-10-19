// Package-owned configuration snapshot. Registration grants discovery only;
// native-history custody and source ignores continue to apply at capture time.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import { CaptureStop } from './capture-budget.mjs';
import { captureSetupSnapshot, prepareCaptureSetupParents, recheckCaptureSetup, writeCaptureSetup } from './capture-setup-write.mjs';
import { acquireCaptureLock, readCaptureLockOwner, shellQuote } from './capture-lock.mjs';

const formats = ['cc', 'pi', 'codex'];
const reasons = ['relative', 'unresolved-reference', 'malformed', 'unreadable'];
const maxEntry = 1024 * 1024, maxTotal = 16 * maxEntry, maxNames = 4096;
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const key = root => `${root.source}\0${root.path}`;
const absolute = value => typeof value === 'string' && !value.includes('\0') && isAbsolute(value) && resolve(value) === value;
const closed = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(name => Object.hasOwn(value, name));
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value);
const identity = stat => ({ dev: String(stat.dev), ino: String(stat.ino) });
const same = (a, b) => ['dev', 'ino', 'mode', 'size', 'mtimeMs', 'ctimeMs'].every(name => a[name] === b[name]);
const rootsValid = roots => Array.isArray(roots) && roots.length <= maxNames && roots.every(root =>
  closed(root, ['source', 'path']) && formats.includes(root.source) && absolute(root.path));
const warningsValid = (rows, roots) => {
  const paths = new Set(roots?.map(root => root.path));
  return Array.isArray(rows) && rows.length <= maxNames && rows.every(row =>
    (closed(row, ['configuration', 'selector', 'reason']) || closed(row, ['configuration', 'selector', 'reason', 'path'])) &&
    label(row.configuration) && label(row.selector) && reasons.includes(row.reason) &&
    (!Object.hasOwn(row, 'path') || row.reason === 'unreadable' && absolute(row.path) && paths.has(row.path)));
};
const sortedRoots = roots => [...new Map(roots.map(root => [key(root), { source: root.source, path: root.path }])).values()]
  .sort((a, b) => order(key(a), key(b)));
const sortedWarnings = rows => [...new Map(rows.map(row => [JSON.stringify(row), row])).values()]
  .sort((a, b) => order(a.configuration, b.configuration) || order(a.selector, b.selector) || order(a.reason, b.reason) || order(a.path ?? '', b.path ?? ''));
const filename = deployment => createHash('sha256').update(deployment, 'utf8').digest('hex') + '.json';
const entryPath = (root, deployment) => join(root, 'capture-roots', filename(deployment));
const invalid = message => Object.assign(new Error(message), { code: 'E_CAPTURE_ROOTS_INVALID' });

// Distinguish proven absence from a dangling ancestor, permission error or a
// non-directory. A descendant ENOENT alone is insufficient proof of absence.
export function captureRootDirectory(path, { readable = false, check = () => {} } = {}) {
  if (!absolute(path)) throw invalid('invalid absolute capture root');
  const prefix = parse(path).root, parts = path.slice(prefix.length).split(sep).filter(Boolean);
  if (parts.length > 256) throw invalid('capture root exceeds the component limit');
  const witness = [], node = stat => [String(stat.dev), String(stat.ino), String(stat.mode)].join(':');
  let current = prefix, stat = fs.statSync(prefix, { bigint: true });
  for (const part of parts) {
    check(); current = join(current, part);
    let link;
    try { link = fs.lstatSync(current, { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const target = link.isSymbolicLink() ? fs.statSync(current, { bigint: true }) : link;
    if (!target.isDirectory()) throw invalid(`capture root is not a directory: ${current}`);
    witness.push({ path: current, node: node(link), link: link.isSymbolicLink() ? fs.readlinkSync(current) : null, target: node(target) });
    stat = target;
  }
  const recheck = () => {
    for (const record of witness) {
      check(); const link = fs.lstatSync(record.path, { bigint: true });
      if (node(link) !== record.node || (link.isSymbolicLink() ? fs.readlinkSync(record.path) : null) !== record.link ||
          node(link.isSymbolicLink() ? fs.statSync(record.path, { bigint: true }) : link) !== record.target)
        throw invalid(`capture root ancestry changed: ${record.path}`);
    }
  };
  if (readable) {
    // Follow only the witnessed native directory aliases. The descriptor's
    // final component is opened no-follow and checked against that witness.
    const fd = fs.openSync(fs.realpathSync(path), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_DIRECTORY | fs.constants.O_NONBLOCK);
    try {
      recheck();
      if (node(stat) !== node(fs.fstatSync(fd, { bigint: true })) || node(stat) !== node(fs.statSync(path, { bigint: true })))
        throw invalid(`capture root changed while opening: ${path}`);
      recheck();
    } finally { fs.closeSync(fd); }
  } else recheck();
  return stat;
}

function validateRequest(value) {
  if (!closed(value, ['schemaVersion', 'deployment', 'roots', 'unavailable']) || value.schemaVersion !== 1 ||
      !absolute(value.deployment) || !rootsValid(value.roots) || !warningsValid(value.unavailable, value.roots)) throw invalid('invalid capture root request');
  if (!captureRootDirectory(value.deployment) || fs.realpathSync(value.deployment) !== value.deployment)
    throw invalid(`capture root deployment must be a canonical existing directory: ${value.deployment}`);
}
function validateEntry(value, name) {
  if (!closed(value, ['schemaVersion', 'deployment', 'deploymentIdentity', 'roots', 'retiredRoots', 'unavailable']) ||
      value.schemaVersion !== 1 || !absolute(value.deployment) || filename(value.deployment) !== name ||
      !closed(value.deploymentIdentity, ['dev', 'ino']) ||
      !['dev', 'ino'].every(k => typeof value.deploymentIdentity[k] === 'string' && /^\d+$/.test(value.deploymentIdentity[k])) ||
      !rootsValid(value.roots) || !rootsValid(value.retiredRoots) || !warningsValid(value.unavailable, value.roots) ||
      JSON.stringify(value.roots) !== JSON.stringify(sortedRoots(value.roots)) ||
      JSON.stringify(value.retiredRoots) !== JSON.stringify(sortedRoots(value.retiredRoots)) ||
      value.roots.some(root => value.retiredRoots.some(retired => key(root) === key(retired))))
    throw invalid(`invalid, future or mismatched capture root entry: ${name}; inspect it and run setup in its deployment`);
  return value;
}
function registryDirectory(root) {
  const path = join(root, 'capture-roots');
  // The inventory directory itself is private and must never be redirected.
  let stat;
  try { stat = fs.lstatSync(path); }
  catch (error) {
    if (error.code === 'ENOENT' && captureRootDirectory(root) === null) return null;
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw invalid(`unsafe capture roots directory: ${path}`);
  return { path, stat };
}
function checkedEntry(path, check) {
  const before = fs.lstatSync(path);
  if (!before.isFile() || before.size > maxEntry) throw invalid(`capture root entry is nonregular or exceeds 1 MiB: ${path}`);
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    if (!same(before, fs.fstatSync(fd))) throw invalid(`capture root entry changed: ${path}`);
    const bytes = Buffer.alloc(before.size + 1); let size = 0;
    while (size < bytes.length) { check(); const n = fs.readSync(fd, bytes, size, bytes.length - size, size); if (!n) break; size += n; }
    if (size !== before.size || !same(before, fs.fstatSync(fd)) || !same(before, fs.lstatSync(path))) throw invalid(`capture root entry changed: ${path}`);
    return { value: validateEntry(JSON.parse(bytes.toString('utf8', 0, size)), path.slice(path.lastIndexOf(sep) + 1)), size };
  } finally { fs.closeSync(fd); }
}
export function captureRootsWarning(row) {
  const remedy = row.reason === 'relative' ? 'Use an absolute transcript location, then run oats setup in this deployment.' :
    row.reason === 'unresolved-reference' ? 'Set the referenced location variable in the person-run setup environment, then run oats setup.' :
    row.reason === 'malformed' ? 'Use a supported absolute transcript-directory selector (no explicit pi --session file), then run oats setup.' :
    'Restore readable configuration/root access, then run oats setup in this deployment.';
  return { ...row, remedy };
}
function rootWarning(deployment, selected, retired, root) {
  const forget = `turn-record capture --forget-retired-root ${shellQuote(selected.path)} --deployment ${shellQuote(deployment)} --source ${selected.source} --root ${shellQuote(root)}`;
  return { code: 'capture-roots-unavailable', message: `${deployment}: ${selected.source} transcript root ${selected.path} is unavailable. ` +
    (retired ? `Restore access or forget this retired reference with: ${forget}. This deletes no history.` : 'Restore directory access or change its launch location and run oats setup in this deployment.') };
}

// Offline metadata only; discovery consumes the same inventory under its held
// root lock. A bad entry never turns into a successful truncated inventory.
export function readCaptureRoots(root, { check = () => {}, inspectRoots = true, sources = formats } = {}) {
  root = resolve(root);
  const entries = [], rows = [], roots = new Map(); let names = 0, bytes = 0, installed = false, diagnostics = 0;
  const push = row => { diagnostics++; if (rows.length < 100) rows.push(row); };
  try {
    const directory = registryDirectory(root);
    if (!directory) return { entries, roots: [], rows, installed: false, fingerprint: 'absent' };
    installed = true;
    const handle = fs.opendirSync(directory.path), selected = [];
    try {
      for (let ent; (ent = handle.readSync()) !== null;) {
        check(); if (++names > maxNames) throw invalid('capture roots inventory exceeds 4096 entry names; inspect registrations');
        if (!/^[a-f0-9]{64}\.json$/.test(ent.name)) throw invalid(`unexpected capture roots inventory entry: ${ent.name}`);
        selected.push(ent.name);
      }
    } finally { handle.closeSync(); }
    for (const name of selected.sort()) {
      check();
      const path = join(directory.path, name), size = fs.lstatSync(path).size;
      if (bytes + size > maxTotal) throw invalid('capture roots inventory exceeds 16 MiB; inspect registrations');
      bytes += size;
      try { const read = checkedEntry(path, check); entries.push(read.value); }
      catch (error) { push({ code: 'capture-roots-invalid', message: `${path}: ${error.message}. Inspect this entry and run setup in its deployment.` }); }
    }
    if (!same(directory.stat, fs.lstatSync(directory.path))) throw invalid('capture roots inventory changed during read; retry after the current setup/forget pass');
  } catch (error) { push({ code: 'capture-roots-invalid', message: `${join(root, 'capture-roots')}: ${error.message}. Inspect registrations and run setup in the affected deployment.` }); }
  // Keep independent valid entries available even when coverage is incomplete.
  // No caller may interpret rows as successful exhaustive discovery.
  for (const entry of entries) {
    check(); let active = false;
    try {
      const stat = captureRootDirectory(entry.deployment, { check });
      if (stat) {
        active = JSON.stringify(identity(stat)) === JSON.stringify(entry.deploymentIdentity);
        if (!active) push({ code: 'capture-roots-refresh-required', message: `${entry.deployment}: deployment directory identity changed; run oats setup there to refresh registration. Old roots remain retired for discovery.` });
      }
    } catch { push({ code: 'capture-roots-unavailable', message: `${entry.deployment}: deployment identity is unreadable; restore access and run oats setup there.` }); }
    if (active) for (const unavailable of entry.unavailable) {
      if (unavailable.path !== undefined) {
        if (!entry.roots.some(root => root.path === unavailable.path && sources.includes(root.source))) continue;
        try { captureRootDirectory(unavailable.path, { readable: true, check }); continue; }
        catch (error) { if (error instanceof CaptureStop) throw error; }
      }
      const warning = captureRootsWarning(unavailable);
      push({ code: 'capture-roots-unavailable', message: `${entry.deployment}: configuration ${warning.configuration}, selector ${warning.selector}: ${warning.reason}. ${warning.remedy}` });
    }
    for (const [values, retired] of [[entry.roots, !active], [entry.retiredRoots, true]]) for (const selected of values.filter(root => sources.includes(root.source))) {
      const existing = roots.get(key(selected));
      roots.set(key(selected), { ...selected, current: !retired || existing?.current === true });
      if (inspectRoots) try { captureRootDirectory(selected.path, { readable: true, check }); }
      catch { push(rootWarning(entry.deployment, selected, retired, root)); }
    }
  }
  const total = diagnostics;
  const bounded = rows.slice(0, 100);
  if (total > 100) bounded.push({ code: 'capture-roots-unavailable', message: `${total - 100} additional root diagnostics omitted; inspect the capture-roots entries and repair or refresh their deployments.` });
  const selected = sortedRoots([...roots.values()]);
  const fingerprint = createHash('sha256').update(JSON.stringify({ entries, rows: bounded, selected })).digest('hex');
  return { entries, roots: selected, rows: bounded, installed, fingerprint };
}

export function preflightCaptureRoots(root, request) {
  root = resolve(root);
  validateRequest(request);
  try {
  const directory = registryDirectory(root), path = entryPath(root, request.deployment);
  const snapshot = captureSetupSnapshot(path);
  if (!['file', 'absent'].includes(snapshot.kind)) throw invalid(`unsafe capture root entry: ${path}`);
  const prior = snapshot.kind === 'file' ? validateEntry(JSON.parse(snapshot.bytes), filename(request.deployment)) : null;
  const current = sortedRoots(request.roots), currentKeys = new Set(current.map(key));
  const retiredRoots = sortedRoots([...(prior?.retiredRoots ?? []), ...(prior?.roots ?? [])].filter(selected => !currentKeys.has(key(selected))));
  const unavailable = [...request.unavailable];
  for (const selected of current) try { captureRootDirectory(selected.path, { readable: true }); }
  catch { unavailable.push({ configuration: `(root:${selected.source})`, selector: 'transcript-root', reason: 'unreadable', path: selected.path }); }
  const value = { schemaVersion: 1, deployment: request.deployment, deploymentIdentity: identity(fs.statSync(request.deployment, { bigint: true })),
    roots: current, retiredRoots, unavailable: sortedWarnings(unavailable) };
  const contents = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(contents) > maxEntry) throw invalid('capture root registration exceeds 1 MiB');
  return { root, snapshot, value, contents, directory, changed: !snapshot.bytes?.equals(Buffer.from(contents)),
    warnings: value.unavailable.map(captureRootsWarning), retiredRoots };
  } catch (error) {
    error.rootWarnings = request.unavailable.map(captureRootsWarning);
    throw error;
  }
}

function underLock(root, command, entry, fn, { acquire = acquireCaptureLock, ensureRoot } = {}) {
  const lock = acquire(root, { ensureRoot, command, caller: { ...(entry ? { entry } : {}), trigger: command === 'setup-roots' ? 'setup' : 'manual' } });
  if (lock.held) {
    const owner = readCaptureLockOwner(root);
    const attribution = owner?.pid === lock.held.pid && owner?.startedAt === lock.held.startedAt && ['pass', 'home', 'file', 'reset-cursors', 'retry', 'setup-roots', 'forget-retired-root'].includes(owner?.command) ? owner.command : 'unknown';
    throw Object.assign(new Error(`root registration refused: ${lock.held.recovery}; owning pass ${attribution}. Retry after the current pass finishes (automatic passes are bounded to 300s).`), { code: 'E_CAPTURE_ROOTS_BUSY' });
  }
  let result, failure;
  try { lock.checkOwned?.(); result = fn(lock); }
  catch (error) { failure = error; }
  try {
    const released = lock.release();
    if (!released.released) throw invalid(`capture roots lock release failed: ${released.reason}; inspect ${lock.path}`);
  } catch (error) {
    if (failure) {
      failure.message += `; ${error.message}`;
      failure.releaseError = error;
    } else failure = error;
  }
  if (failure) throw failure;
  return result;
}
function publish(plan, createdParents = new Map(), operations) {
  recheckCaptureSetup(plan.snapshot, createdParents);
  if (!plan.changed) return { changed: false, roots: plan.value.roots, retiredRoots: plan.value.retiredRoots, warnings: plan.warnings ?? [] };
  if (!plan.directory) {
    // Shared publisher creates parents durably. A private umask ensures the
    // inventory directory is private from its first observable instant.
    const mask = process.umask(0o077);
    try { writeCaptureSetup(plan.snapshot, plan.contents, createdParents, operations); }
    finally { process.umask(mask); }
  } else writeCaptureSetup(plan.snapshot, plan.contents, createdParents, operations);
  return { changed: true, roots: plan.value.roots, retiredRoots: plan.value.retiredRoots, warnings: plan.warnings ?? [] };
}
export function applyCaptureRoots(plan, { entry, createdParents = new Map(), operations, acquire } = {}) {
  let initialization = [];
  try {
    // Normal umask/owner: only capture-roots itself is forced private later.
    // The helper records exclusive creation and sync; later stats never grant it.
    const preparation = prepareCaptureSetupParents(plan.snapshot, createdParents, { through: plan.root, operations });
    initialization = preparation.applied;
    const ensureRoot = () => {
      recheckCaptureSetup(plan.snapshot, createdParents);
      if (!captureRootDirectory(plan.root)) throw invalid('prepared record root disappeared; run a new setup preflight');
    };
    return underLock(plan.root, 'setup-roots', entry, lock => {
      ensureRoot(); lock.checkOwned();
      const stat = captureRootDirectory(plan.value.deployment);
      if (!stat || JSON.stringify(identity(stat)) !== JSON.stringify(plan.value.deploymentIdentity)) throw invalid('deployment changed since roots preflight; run setup again');
      return publish(plan, createdParents, operations);
    }, { acquire, ensureRoot });
  } catch (error) {
    error.applied = [...initialization, ...(error.applied ?? [])];
    throw error;
  }
}

export function forgetRetiredRoot(root, selected, { entry } = {}) {
  root = resolve(root);
  if (!closed(selected, ['deployment', 'source', 'path']) || !absolute(selected.deployment) || !absolute(selected.path) || !formats.includes(selected.source))
    throw invalid('forget-retired-root requires absolute --deployment, --forget-retired-root and --source cc|pi|codex');
  return underLock(root, 'forget-retired-root', entry, () => {
    const directory = registryDirectory(root);
    const snapshot = captureSetupSnapshot(entryPath(root, selected.deployment));
    if (snapshot.kind === 'absent') return { changed: false };
    if (snapshot.kind !== 'file') throw invalid('unsafe capture root entry');
    const value = validateEntry(JSON.parse(snapshot.bytes), filename(selected.deployment));
    const target = key(selected);
    if (value.roots.some(root => key(root) === target)) throw invalid('cannot forget a current root; change configuration and run setup to retire it first');
    const retiredRoots = value.retiredRoots.filter(root => key(root) !== target);
    if (retiredRoots.length === value.retiredRoots.length) return { changed: false };
    value.retiredRoots = retiredRoots;
    return publish({ root, snapshot, value, contents: JSON.stringify(value, null, 2) + '\n', changed: true, directory });
  });
}
