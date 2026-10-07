/** Explicit operator-only native trust writes. Never called from spawn/start.
 * Native writers do not cooperate with our locks: compare-and-replace narrows,
 * but cannot eliminate, the race immediately before rename. No rollback. */
import * as fs from 'node:fs';
import { join, dirname, basename, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { editClaudeTrust } from './harness-trust-json.mjs';
import { editCodexTrust } from './harness-trust-toml.mjs';
import { claudeTrusts, codexTrustsRoot, codexTrustedDirs } from './harness-trust.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const error = (code, message, details) => Object.assign(new Error(message), { code, details });
const broken = () => error('E_CONFIG_BROKEN', 'Native trust configuration is unreadable, unsafe, invalid, or outside the supported format; inspect the selected file before retrying.');
const identity = s => `${s.dev}:${s.ino}`;
function stat(path) { try { return fs.lstatSync(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
/** GNU ls uses '.' for a security context alone, '+' for an ACL. macOS
 * '@' marks extended attributes. Refuse metadata we cannot preserve; a Linux
 * context is checked on the same-directory candidate before any replacement. */
export function nativeSecurityContext(path, { platform = process.platform, run = execFileSync } = {}) {
  const flags = platform === 'darwin' ? ['-lde', path] : ['-ld', '--', path];
  const mode = run('ls', flags, { encoding: 'utf8' }).split(/\s/, 1)[0];
  if (!/^-[-rwxStTs]{9}$/.test(mode)) {
    if (platform !== 'linux' || !/^-[-rwxStTs]{9}\.$/.test(mode)) throw broken();
    const context = run('ls', ['-Zd', '--', path], { encoding: 'utf8' }).trim().split(/\s/, 1)[0];
    if (!context || context === '?' || context.split(':').length < 3) throw broken();
    return context;
  }
  return null;
}
function regular(path, metadataProbe) {
  const s = stat(path); if (!s) return null;
  if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid?.() || (s.mode & 0o7000)) throw broken();
  s.securityContext = metadataProbe(path);
  return s;
}
function canonicalMissingDirectory(path) {
  let at = resolve(path), tail = [];
  for (;;) {
    const s = stat(at);
    if (s) {
      const real = fs.realpathSync(at); if (!fs.statSync(real).isDirectory()) throw broken();
      return join(real, ...tail.reverse());
    }
    const parent = dirname(at); if (parent === at) throw broken(); tail.push(basename(at)); at = parent;
  }
}
function snapshot(file, metadataProbe) {
  const s = regular(file, metadataProbe); if (!s) return { bytes: null, digest: null, identity: null, mode: null, securityContext: null };
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (identity(fs.fstatSync(fd)) !== identity(s)) throw broken();
    const bytes = fs.readFileSync(fd); if (bytes.length > 8 * 1024 * 1024) throw broken();
    if (identity(fs.lstatSync(file)) !== identity(s)) throw broken();
    return { bytes, digest: digest(bytes), identity: identity(s), mode: s.mode & 0o777, uid: s.uid, gid: s.gid, securityContext: s.securityContext };
  } finally { fs.closeSync(fd); }
}
const same = (a, b) => a.digest === b.digest && a.identity === b.identity && a.mode === b.mode && a.uid === b.uid && a.gid === b.gid && a.securityContext === b.securityContext;
function nativePath(harness, env) {
  const home = env.HOME || homedir(); if (!isAbsolute(home)) throw broken();
  const override = harness === 'claude' ? env.CLAUDE_CONFIG_DIR : env.CODEX_HOME;
  if (override && !isAbsolute(override)) throw broken();
  const dir = override || (harness === 'claude' ? home : join(home, '.codex'));
  return join(canonicalMissingDirectory(dir), harness === 'claude' ? '.claude.json' : 'config.toml');
}
function validAudit(file, metadataProbe) {
  const observed = snapshot(file, metadataProbe);
  if (observed.bytes) {
    const text = observed.bytes.toString('utf8');
    if (text && !text.endsWith('\n')) throw broken();
    for (const line of text.split('\n').slice(0, -1)) {
      let row; try { row = JSON.parse(line); } catch { throw broken(); }
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw broken();
    }
  }
  return observed;
}
function syncDirectory(path) { const fd = fs.openSync(path, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function ensureDirectory(path) {
  if (stat(path)) { if (!fs.lstatSync(path).isDirectory() || fs.realpathSync(path) !== path) throw broken(); return; }
  ensureDirectory(dirname(path)); fs.mkdirSync(path, { mode: 0o700 }); syncDirectory(dirname(path));
}
/** Planning performs reads only, including when native directories do not exist. */
export function planHarnessTrust(root, { harness = 'all', env = process.env, metadataProbe = nativeSecurityContext } = {}) {
  if (!['all', 'claude', 'codex'].includes(harness)) throw error('E_BAD_ARGS', '--harness must be claude, codex, or all');
  root = fs.realpathSync(root);
  const result = { operation: 'harness-trust', mode: 'plan', root, entries: [], audit: null, warnings: [] }, plans = [];
  for (const name of harness === 'all' ? ['claude', 'codex'] : [harness]) {
    const key = ['projects', root, name === 'claude' ? 'hasTrustDialogAccepted' : 'trust_level'];
    const entry = { harness: name, file: null, key, current: null, desired: name === 'claude' ? true : 'trusted', beforeDigest: null, afterDigest: null, status: 'refused' };
    result.entries.push(entry);
    try {
      const file = nativePath(name, env); entry.file = file;
      const before = snapshot(file, metadataProbe); entry.beforeDigest = before.digest;
      const text = before.bytes?.toString('utf8') ?? (name === 'claude' ? '{}' : '');
      if (before.bytes && !Buffer.from(text).equals(before.bytes)) throw broken();
      const edited = (name === 'claude' ? editClaudeTrust : editCodexTrust)(text, root);
      // Preflight the existing reader's supported representation as well as
      // native syntax; never discover a known compatibility gap after writing.
      if (name === 'codex' && !codexTrustedDirs(edited.text).has(root)) throw broken();
      const after = Buffer.from(edited.text);
      entry.current = edited.current; entry.afterDigest = digest(after);
      entry.status = before.bytes?.equals(after) ? 'unchanged' : 'change';
      plans.push({ entry, before, after });
      const overrideKey = name === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME';
      if (env[overrideKey]) result.warnings.push(`${overrideKey} selects ${env[overrideKey]}; effective file ${file}`);
    } catch { /* Per-file refusal; never echo native content or parser exceptions. */ }
  }
  if (result.entries.some(e => e.status === 'refused')) throw error('E_CONFIG_BROKEN', broken().message, result);
  return { result, plans };
}
export function harnessTrust(root, { harness = 'all', plan = false, env = process.env, checkpoint = () => {}, metadataProbe = nativeSecurityContext } = {}) {
  let prepared;
  try { prepared = planHarnessTrust(root, { harness, env, metadataProbe }); }
  catch (e) { if (e.details?.operation === 'harness-trust') e.details.mode = plan ? 'plan' : 'apply'; throw e; }
  const { result, plans } = prepared;
  if (plan) return result;
  result.mode = 'apply'; const operationId = randomUUID(), auditPath = join(result.root, '.agents', 'harness-trust.jsonl');
  const locks = [], temps = new Map(), parents = new Map(); let mayHaveChanged = false, currentMayHaveChanged = false, reason = 'audit', current = null, auditSnapshot, failure;
  result.audit = { path: auditPath, operationId, status: 'incomplete' };
  const checkParent = file => {
    const dir = dirname(file);
    if (fs.realpathSync(dir) !== dir || identity(fs.statSync(dir)) !== parents.get(dir)) throw new Error('parent changed');
  };
  const append = (entry, phase, status) => {
    checkpoint('before-audit', { phase, entry });
    checkParent(auditPath);
    const now = validAudit(auditPath, metadataProbe); if (!same(now, auditSnapshot)) throw new Error('audit changed');
    const row = Buffer.from(JSON.stringify({ version: 1, kind: 'harness-trust', at: new Date().toISOString(), operationId, phase, harness: entry.harness, root: result.root, file: entry.file, beforeDigest: entry.beforeDigest, afterDigest: entry.afterDigest, status }) + '\n');
    const expected = digest(Buffer.concat([now.bytes ?? Buffer.alloc(0), row]));
    const fd = fs.openSync(auditPath, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | (now.identity === null ? fs.constants.O_EXCL : 0), 0o600);
    let writtenIdentity;
    try {
      writtenIdentity = identity(fs.fstatSync(fd));
      if (now.identity !== null && writtenIdentity !== now.identity) throw new Error('audit replaced');
      fs.writeFileSync(fd, row);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    checkParent(auditPath); syncDirectory(dirname(auditPath));
    const after = validAudit(auditPath, metadataProbe);
    if (after.identity !== writtenIdentity || after.digest !== expected) throw new Error('audit changed after append');
    auditSnapshot = after;
  };
  try {
    // Validate the complete existing audit before creating any directories/locks.
    auditSnapshot = validAudit(auditPath, metadataProbe);
    checkpoint('before-locks', { result }); reason = 'locked';
    const lockPaths = [auditPath, ...plans.map(p => p.entry.file)].map(f => `${f}.oats-trust.lock`).sort();
    for (const lock of lockPaths) {
      ensureDirectory(dirname(lock));
      const dir = dirname(lock), observed = identity(fs.statSync(dir));
      if (parents.has(dir) && parents.get(dir) !== observed) throw new Error('parent changed');
      parents.set(dir, observed);
      const fd = fs.openSync(lock, 'wx', 0o600);
      locks.push({ path: lock, identity: identity(fs.fstatSync(fd)) }); fs.closeSync(fd);
    }
    reason = 'changed';
    for (const p of plans) { checkParent(p.entry.file); if (!same(snapshot(p.entry.file, metadataProbe), p.before)) throw new Error('configuration changed'); }
    if (!same(validAudit(auditPath, metadataProbe), auditSnapshot)) { reason = 'audit'; throw new Error('audit changed'); }
    for (const p of plans) {
      current = p; currentMayHaveChanged = false; reason = 'audit';
      if (p.entry.status === 'unchanged') {
        reason = 'verify';
        if (!(p.entry.harness === 'claude' ? claudeTrusts(result.root, { env }) : codexTrustsRoot(result.root, { env }))) throw new Error('verification failed');
        reason = 'audit'; append(p.entry, 'outcome', 'unchanged'); current = null; continue;
      }
      append(p.entry, 'intent', 'planned'); reason = 'write';
      checkParent(p.entry.file);
      const tmp = join(dirname(p.entry.file), `.${basename(p.entry.file)}.oats-${operationId}.tmp`);
      const parentIdentity = identity(fs.statSync(dirname(p.entry.file)));
      const fd = fs.openSync(tmp, 'wx', p.before.mode ?? 0o600); temps.set(tmp, identity(fs.fstatSync(fd)));
      try {
        if (p.before.uid !== undefined) fs.fchownSync(fd, p.before.uid, p.before.gid);
        fs.fchmodSync(fd, p.before.mode ?? 0o600); fs.writeFileSync(fd, p.after); fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      const candidate = snapshot(tmp, metadataProbe);
      if (p.before.identity !== null && candidate.securityContext !== p.before.securityContext) throw new Error('candidate security context differs');
      reason = 'changed'; checkpoint('before-replace', { entry: p.entry });
      if (identity(fs.statSync(dirname(p.entry.file))) !== parentIdentity || fs.realpathSync(dirname(p.entry.file)) !== dirname(p.entry.file) || !same(snapshot(p.entry.file, metadataProbe), p.before)) throw new Error('configuration changed');
      reason = 'write';
      // Once rename is attempted, conservatively report uncertainty on any error.
      mayHaveChanged = true; currentMayHaveChanged = true; fs.renameSync(tmp, p.entry.file); temps.delete(tmp); syncDirectory(dirname(p.entry.file));
      reason = 'verify'; checkpoint('after-replace', { entry: p.entry });
      const observed = snapshot(p.entry.file, metadataProbe);
      const expectedDigest = p.entry.afterDigest; p.entry.afterDigest = observed.digest;
      if (observed.securityContext !== candidate.securityContext || observed.digest !== expectedDigest || !(p.entry.harness === 'claude' ? claudeTrusts(result.root, { env }) : codexTrustsRoot(result.root, { env }))) throw new Error('verification failed');
      p.entry.status = 'applied'; reason = 'audit'; append(p.entry, 'outcome', 'applied'); current = null;
    }
    result.audit.status = 'recorded';
  } catch {
    if (current) {
      current.entry.status = currentMayHaveChanged ? 'incomplete' : 'failed';
      // The intent retains the proposed digest. A failed outcome reports only
      // bytes actually observed, never the proposal as proof of a replacement.
      try { checkParent(current.entry.file); current.entry.afterDigest = snapshot(current.entry.file, metadataProbe).digest; }
      catch { current.entry.afterDigest = null; result.warnings.push(`Final digest unconfirmed for ${current.entry.file}.`); }
      if (reason !== 'audit') { try { append(current.entry, 'outcome', current.entry.status); result.audit.status = 'recorded'; } catch { result.audit.status = 'incomplete'; } }
    }
    for (const p of plans) if (p.entry.status === 'change') p.entry.status = 'not-attempted';
    failure = error('E_HARNESS_TRUST_INCOMPLETE', `Harness trust ${reason} failed; inspect native configuration and ${auditPath} before retrying. No rollback was attempted.`, { ...result, reason, mayHaveChanged });
  } finally {
    // Cleanup is part of the outcome. Do not silently succeed with a lock left
    // behind, and never delete a path another writer replaced.
    for (const [path, owned] of [...temps, ...locks.reverse().map(l => [l.path, l.identity])]) {
      try {
        const observed = stat(path);
        if (!observed) continue;
        if (identity(observed) !== owned) throw new Error('replaced cleanup path');
        fs.unlinkSync(path);
      } catch {
        result.warnings.push(`Cleanup unconfirmed for ${path}; inspect it before retrying.`);
        failure ??= error('E_HARNESS_TRUST_INCOMPLETE', 'Harness trust cleanup failed; native changes and audit are retained. Inspect the reported paths before retrying.', { ...result, reason: 'write', mayHaveChanged });
      }
    }
  }
  if (failure) throw failure;
  return result;
}
