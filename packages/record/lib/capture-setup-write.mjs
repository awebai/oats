// Checked publication for setup-owned files. Kept separate from service policy
// so other setup callers can share preflight, ancestry and durability guards.
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

const identity = stat => [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
function parents(path) {
  const records = [];
  for (let directory = dirname(path); ; directory = dirname(directory)) {
    let stat;
    try { stat = fs.lstatSync(directory); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (stat) {
      let target = null;
      if (stat.isSymbolicLink()) {
        try { target = fs.statSync(directory); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      // Even a dangling ancestor link has an identity to retain. Its missing
      // target must not turn a later retargeting into ordinary directory creation.
      records.push([directory, `${stat.dev}:${stat.ino}:${stat.mode}`, stat.isSymbolicLink() ? fs.readlinkSync(directory) : null,
        target ? `${target.dev}:${target.ino}:${target.mode}` : null]);
    } else records.push([directory, null, null, null]);
    if (dirname(directory) === directory) return records;
  }
}

export function captureSetupSnapshot(path) {
  const ancestry = parents(path);
  let stat;
  try { stat = fs.lstatSync(path); }
  catch (error) { if (error.code === "ENOENT") return { path, kind: "absent", parents: ancestry }; throw error; }
  const before = identity(stat);
  let bytes, link;
  if (stat.isSymbolicLink()) link = fs.readlinkSync(path);
  else {
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error(`refusing nonregular or oversized setup target ${path}`);
    const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let failure;
    try {
      if (identity(fs.fstatSync(fd)) !== before) throw new Error(`setup target changed while opening ${path}`);
      bytes = fs.readFileSync(fd);
      if (identity(fs.fstatSync(fd)) !== before) throw new Error(`setup target changed while reading ${path}`);
    } catch (error) { failure = error; }
    try { fs.closeSync(fd); }
    catch (error) {
      if (failure) throw new AggregateError([failure, error], `${failure.message}; setup target close failed: ${error.message}`, { cause: failure });
      throw error;
    }
    if (failure) throw failure;
  }
  if (identity(fs.lstatSync(path)) !== before) throw new Error(`setup target changed while reading ${path}`);
  return { path, kind: link === undefined ? "file" : "link", identity: before, bytes, link, parents: ancestry };
}

function recheckParents(snapshot, current, createdParents = new Map()) {
  if (snapshot.parents.some(record => {
    const expected = record[1] === null ? createdParents.get(record[0]) ?? record : record;
    return !current.parents.some(now => JSON.stringify(now) === JSON.stringify(expected));
  }))
    throw new Error(`setup target parent changed since preflight: ${snapshot.path}; re-run setup`);
}
export function recheckCaptureSetup(snapshot, createdParents = new Map()) {
  recheckParents(snapshot, { parents: parents(snapshot.path) }, createdParents);
  const current = captureSetupSnapshot(snapshot.path);
  recheckParents(snapshot, current, createdParents);
  if (current.kind !== snapshot.kind || current.identity !== snapshot.identity || current.link !== snapshot.link ||
      (snapshot.bytes && !snapshot.bytes.equals(current.bytes))) throw new Error(`setup target changed since preflight: ${snapshot.path}; re-run setup`);
}

// Service apply also checks ancestry after its own expected target changes.
export function recheckCaptureSetupParents(snapshot, createdParents = new Map(), current = { parents: parents(snapshot.path) }) {
  recheckParents(snapshot, current, createdParents);
}

const directoryIdentity = stat => `${stat.dev}:${stat.ino}:${stat.mode}`;
// Rename may change ctime. The final path must still name the written inode,
// mode, size and mtime; pre-rename checks retain the complete identity.
const publishedIdentity = stat => [directoryIdentity(stat), stat.size, stat.mtimeMs].join(":");

// The fourth argument is private fs-operation fault injection. Production has
// no switch for it. Snapshots and createdParents retain their caller semantics.
export function writeCaptureSetup(snapshot, contents, createdParents = new Map(), operations = fs) {
  let stage = "preflight recheck", published = false, cause;
  let temporary, temporaryIdentity, temporaryPublishedIdentity, temporaryNode, fileFd = null, directoryFd = null, writing = false;
  const cleanupErrors = [], madeParents = [];
  const recheck = () => recheckCaptureSetup(snapshot, createdParents);
  const recheckAncestry = () => recheckCaptureSetupParents(snapshot, createdParents);
  const changed = path => new Error(`setup publication identity changed: ${path}; re-run setup`);
  // Detach before close: a close error does not authorize retrying a descriptor
  // whose state may be unknown (and whose number might since have been reused).
  const closeFile = () => { const fd = fileFd; fileFd = null; operations.closeSync(fd); };
  const closeDirectory = () => { const fd = directoryFd; directoryFd = null; operations.closeSync(fd); };
  const checkDirectory = path => {
    recheckAncestry();
    const descriptor = operations.fstatSync(directoryFd), current = operations.statSync(path);
    if (!descriptor.isDirectory() || directoryIdentity(descriptor) !== directoryIdentity(current)) throw changed(path);
    recheckAncestry();
  };
  const openDirectory = path => {
    recheckAncestry();
    // Existing approved ancestor links remain allowed: both their link and
    // resolved identities are retained by the ancestry recheck.
    directoryFd = operations.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    checkDirectory(path);
  };
  const checkTemporary = () => {
    recheckAncestry();
    const descriptor = operations.fstatSync(fileFd);
    let current;
    try { current = operations.lstatSync(temporary); }
    catch (error) { if (error.code === "ENOENT") throw changed(temporary); throw error; }
    if (!descriptor.isFile() || (descriptor.mode & 0o777) !== 0o600 ||
        directoryIdentity(descriptor) !== temporaryNode || identity(descriptor) !== identity(current)) throw changed(temporary);
    temporaryIdentity = identity(descriptor);
    temporaryPublishedIdentity = publishedIdentity(descriptor);
    recheckAncestry();
  };
  try {
    recheck();
    // Missing ancestors are evidence, not permission to adopt an intervening
    // mkdir/link. Publish each new directory entry durably before its child.
    for (const record of [...snapshot.parents].reverse()) {
      if (record[1] !== null || createdParents.has(record[0])) continue;
      stage = `create parent ${record[0]}`;
      recheck();
      operations.mkdirSync(record[0]);
      madeParents.push(record[0]);
      const stat = operations.lstatSync(record[0]);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw changed(record[0]);
      createdParents.set(record[0], [record[0], directoryIdentity(stat), null, null]);
      try {
        const parent = dirname(record[0]);
        stage = `created-parent directory open ${parent}`;
        openDirectory(parent);
        stage = `created-parent directory fsync ${parent}`;
        operations.fsyncSync(directoryFd);
        checkDirectory(parent);
        stage = `created-parent directory close ${parent}`;
        closeDirectory();
      } catch (error) {
        // A failed durability step must not silently authorize another caller
        // to reuse this directory through the shared per-apply map.
        createdParents.delete(record[0]);
        throw error;
      }
    }
    recheck();
    temporary = `${snapshot.path}.tmp-${randomUUID()}`;
    stage = "temporary open";
    fileFd = operations.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    const opened = operations.fstatSync(fileFd);
    temporaryNode = directoryIdentity(opened);
    temporaryIdentity = identity(opened);
    checkTemporary();
    recheck();
    stage = "temporary write";
    writing = true;
    operations.writeFileSync(fileFd, contents);
    checkTemporary();
    writing = false;
    stage = "file fsync";
    operations.fsyncSync(fileFd);
    checkTemporary();
    recheck();
    stage = "file close";
    closeFile();
    stage = "publication directory open";
    openDirectory(dirname(snapshot.path));
    stage = "rename recheck";
    recheck();
    if (identity(operations.lstatSync(temporary)) !== temporaryIdentity) throw changed(temporary);
    checkDirectory(dirname(snapshot.path));
    stage = "rename";
    operations.renameSync(temporary, snapshot.path);
    published = true;
    stage = "directory fsync";
    checkDirectory(dirname(snapshot.path));
    if (publishedIdentity(operations.lstatSync(snapshot.path)) !== temporaryPublishedIdentity) throw changed(snapshot.path);
    operations.fsyncSync(directoryFd);
    checkDirectory(dirname(snapshot.path));
    if (publishedIdentity(operations.lstatSync(snapshot.path)) !== temporaryPublishedIdentity) throw changed(snapshot.path);
    stage = "directory close";
    closeDirectory();
  } catch (error) {
    cause = error;
    if (stage === "rename" && !published) {
      // A refused rename normally leaves the saved target intact. If that
      // cannot be re-established, report uncertainty rather than rollback.
      try { recheck(); } catch { published = true; }
    }
  } finally {
    // Capture partial-write identity through the still-owned descriptor before
    // closing, so a write fault can clean its own scratch without adopting a
    // substituted pathname. Do not refresh identity after a completed write.
    if (fileFd !== null) {
      if (writing) {
        try {
          const stat = operations.fstatSync(fileFd);
          if (directoryIdentity(stat) === temporaryNode) temporaryIdentity = identity(stat);
        } catch (error) { cleanupErrors.push(error); }
      }
      try { closeFile(); } catch (error) { cleanupErrors.push(error); }
    }
    if (directoryFd !== null) {
      try { closeDirectory(); } catch (error) { cleanupErrors.push(error); }
    }
    if (!published && temporaryIdentity !== undefined) {
      let safe = false;
      // A refused ancestor replacement revokes pathname cleanup. Never remove
      // the new target after rename, even if a later sync/close/recheck failed.
      try { recheckAncestry(); safe = true; }
      catch (error) { cleanupErrors.push(error); } // cleanup was refused, not silently successful
      if (safe) {
        try {
          if (identity(operations.lstatSync(temporary)) === temporaryIdentity) operations.unlinkSync(temporary);
        } catch (error) { if (error.code !== "ENOENT") cleanupErrors.push(error); }
      }
    }
  }
  if (cause || cleanupErrors.length) {
    const primary = cause ?? cleanupErrors.shift();
    const state = published ? "publication may have occurred; durability was not established" : "target was not published by this write";
    const cleanup = cleanupErrors.length ? `; cleanup failed: ${cleanupErrors.map(error => error.message).join("; ")}` : "";
    const error = new Error(`setup write failed for ${snapshot.path} at ${stage}: ${primary.message}; ${state}${cleanup}`, { cause: primary });
    Object.assign(error, { path: snapshot.path, stage, published, cleanupErrors,
      applied: [...madeParents.map(path => `created setup parent ${path} (write failed at ${stage}; inspect its durability)`),
        ...(published ? [`${snapshot.path}: publication may have occurred at ${stage}; durability was not established`] : [])] });
    throw error;
  }
}
