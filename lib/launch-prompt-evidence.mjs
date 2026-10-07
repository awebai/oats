/** Private, bounded evidence from an already compared launch frame. No terminal
 * operations or public raw-text diagnostics. A receipt is published last; a
 * partial directory is retained on failure, never presented as a complete save. */
import * as fs from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;
const fail = () => { throw new Error('private launch evidence unavailable'); };
const uid = () => process.getuid?.();
const identity = s => ({ dev: s.dev, ino: s.ino });

/** Decode only the private receipt's recognition tag. This is not evidence
 * verification: collection must still bind bytes/identities and checked public
 * outcome. Historical receipts remain unchanged on disk. */
export function launchPromptEvidenceRecognition(receipt) {
  if (receipt?.version === 1 && receipt.kind === 'launch-prompt-unmatched'
    && !Object.hasOwn(receipt, 'outcome') && !Object.hasOwn(receipt, 'recognition')) {
    return { outcome: 'blocked', recognition: 'unmatched' };
  }
  if (receipt?.version === 2 && receipt.kind === 'launch-prompt-frame'
    && ((receipt.outcome === 'blocked' && receipt.recognition === 'unmatched')
      || (receipt.outcome === 'completed' && receipt.recognition === 'structural'))) {
    return { outcome: receipt.outcome, recognition: receipt.recognition };
  }
  return null;
}

// Mode bits alone do not rule out an inherited macOS ACL (including one
// hidden behind the '@' xattr indicator). Never write private bytes first and
// then discover that another principal can read the candidate.
function privateAccess(path) {
  const mac = process.platform === 'darwin';
  const output = execFileSync('/bin/ls', mac ? ['-lde', path] : ['-ld', '--', path],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 1000, maxBuffer: 16384, env: { ...process.env, LC_ALL: 'C' } });
  const mode = output.split(/\s/, 1)[0];
  if (mac) {
    if (!/^[d-][-rwxStTs]{9}@?$/.test(mode) || output.trimEnd().split('\n').length !== 1) fail();
  } else if (!/^[d-][-rwxStTs]{9}\.?$/.test(mode)) fail();
}

export function retainLaunchPromptFrame({ home, homeIdentity, startId, target, screen,
  outcome = 'blocked', recognition = 'unmatched' }) {
  const directories = new Map(), temps = new Map();
  let ok = false;
  function directory(path, privateMode = false) {
    const s = fs.lstatSync(path);
    if (!s.isDirectory() || s.uid !== uid() || (s.mode & 0o7022)
      || (privateMode && (s.mode & 0o777) !== 0o700)
      || fs.realpathSync.native(path) !== path) fail();
    return s;
  }
  function check() {
    if (!same(directory(home), homeIdentity)) fail();
    for (const [path, saved] of directories) if (!same(directory(path, saved.privateMode), saved)) fail();
  }
  function ensure(path, privateMode) {
    check();
    try { fs.mkdirSync(path, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const s = directory(path, privateMode);
    if (privateMode) privateAccess(path);
    directories.set(path, { ...identity(s), privateMode });
    check();
    syncDirectory(dirname(path));
  }
  function syncDirectory(path) {
    check();
    const fd = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    try {
      if (!same(fs.fstatSync(fd), directories.get(path))) fail();
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    check();
  }
  function verify(path, saved, bytes) {
    check();
    privateAccess(path);
    const fd = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    try {
      const s = fs.fstatSync(fd);
      if (!s.isFile() || !same(s, saved) || s.nlink !== 1 || s.uid !== uid() || (s.mode & 0o7777) !== 0o600 || s.size !== bytes.length) fail();
      // Read at most the expected bytes plus one: concurrent growth must not
      // turn verification of a bounded frame into an unbounded file read.
      const observed = Buffer.alloc(bytes.length + 1);
      let length = 0;
      while (length < observed.length) {
        const count = fs.readSync(fd, observed, length, observed.length - length, length);
        if (!count) break;
        length += count;
      }
      if (length !== bytes.length || !observed.subarray(0, length).equals(bytes)) fail();
      const after = fs.lstatSync(path);
      if (!after.isFile() || !same(after, saved) || after.nlink !== 1 || after.uid !== uid()
        || (after.mode & 0o7777) !== 0o600 || after.size !== bytes.length) fail();
    } finally { fs.closeSync(fd); }
    check();
  }
  function publish(dir, name, bytes) {
    check();
    const temp = join(dir, `.${randomUUID()}.tmp`), path = join(dir, name);
    const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    let saved;
    try {
      saved = identity(fs.fstatSync(fd)); temps.set(temp, saved);
      privateAccess(temp);
      check();
      if (!same(fs.lstatSync(temp), saved)) fail();
      fs.writeFileSync(fd, bytes); fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    check();
    // link is atomic and refuses ANY existing destination. Unlike rename it
    // cannot overwrite a competing receipt or file between checks.
    fs.linkSync(temp, path);
    if (!same(fs.lstatSync(temp), saved)) fail();
    fs.unlinkSync(temp); temps.delete(temp);
    syncDirectory(dir);
    verify(path, saved, bytes);
    return saved;
  }
  try {
    // This private receipt records the recognition being saved, not the final
    // public launch result: a subsequent audit/cleanup failure can be incomplete.
    if (!launchPromptEvidenceRecognition({ version: 2, kind: 'launch-prompt-frame', outcome, recognition })) fail();
    if (typeof home !== 'string' || !isAbsolute(home) || !homeIdentity
      || typeof startId !== 'string' || !startId.length || startId.length > 256 || startId.includes('\0')
      || !target || !isAbsolute(target.socket || '') || !/^@\d+$/.test(target.windowId) || !/^%\d+$/.test(target.paneId) || !/^[1-9]\d*$/.test(String(target.pid))
      || screen?.width !== 110 || screen?.height !== 35 || typeof screen.text !== 'string'
      || !screen.text.endsWith('\n') || screen.text.split('\n').length !== 36) fail();
    const bytes = Buffer.from(screen.text, 'utf8');
    if (bytes.length > 64 * 1024) fail();
    check();
    directories.set(home, { ...identity(homeIdentity), privateMode: false });
    const oats = join(home, '.oats'), root = join(oats, 'launch-prompt-evidence');
    ensure(oats, false); ensure(root, true);
    const dir = join(root, sha256(startId));
    check(); fs.mkdirSync(dir, { mode: 0o700 }); // no overwrite/retry of an invocation
    directories.set(dir, { ...identity(directory(dir, true)), privateMode: true });
    privateAccess(dir);
    syncDirectory(root);
    const frameIdentity = publish(dir, 'frame.txt', bytes);
    const receipt = Buffer.from(JSON.stringify({ version: 2, kind: 'launch-prompt-frame', outcome, recognition, home, homeIdentity: identity(homeIdentity), startId,
      target: { socket: target.socket, windowId: target.windowId, paneId: target.paneId, pid: String(target.pid) },
      width: 110, height: 35, bytes: bytes.length, signatureDigest: sha256(bytes), frame: 'frame.txt', frameIdentity,
      source: 'controller-compared-frame', captureTime: null, retainedAt: new Date().toISOString() }) + '\n');
    publish(dir, 'receipt.json', receipt);
    verify(join(dir, 'frame.txt'), frameIdentity, bytes);
    ok = true;
  } catch { /* Do not expose raw text, OS errors, or a fabricated saved receipt. */ }
  finally {
    for (const [path, saved] of temps) {
      try { check(); if (!same(fs.lstatSync(path), saved)) fail(); fs.unlinkSync(path); }
      catch { ok = false; }
    }
  }
  return { ok };
}
