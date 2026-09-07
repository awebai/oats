/** Instance attachments: bytes a viewer drops or pastes for an agent, kept as
 *  private files INSIDE the instance home so the agent can read them by path.
 *  Upload never touches the terminal; the caller pastes the returned path.
 *  Remote uploads stream through the same ssh transport as every routed
 *  command, into `oats session receive` on the execution host. */
import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, rmSync, statSync, writeSync, realpathSync } from "node:fs";
import { basename, extname, isAbsolute, join, resolve, sep } from "node:path";
import { checkRemote, resolveRoute, runRemote, serverError } from "./servers.mjs";

export const ATTACHMENTS_DIRNAME = ".oats-attachments";
/** Kernel bound per file; a GUI imposes its own stricter interaction bound. */
export const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;
/** The kernel version whose probe first advertises session-upload. */
export const SESSION_UPLOAD_REMOTE_VERSION = "0.22.13";

const err = (code, message, extra) => Object.assign(new Error(message), { code, ...(extra || {}) });

/** A file name as it will exist in the attachments directory: one path
 *  segment, printable, never a dot name, at most 200 bytes. */
export function attachmentName(name) {
  if (typeof name !== "string" || !name.trim()) throw err("E_BAD_ARGS", "attachment name must be a non-empty file name");
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) throw err("E_BAD_ARGS", "attachment name must be a single path segment without slashes or NUL");
  if (/[\x00-\x1f\x7f]/.test(name)) throw err("E_BAD_ARGS", "attachment name must not contain control characters");
  if (name === "." || name === "..") throw err("E_BAD_ARGS", "attachment name may not be a dot name");
  // Deliberate: a name starting with a dash would read as an option on the
  // remote command line; the caller renames the file (screenshots never
  // start with one).
  if (name.startsWith("-")) throw err("E_BAD_ARGS", `attachment name ${JSON.stringify(name)} starts with a dash; rename the file before attaching it`);
  if (Buffer.byteLength(name) > 200) throw err("E_BAD_ARGS", "attachment name is longer than 200 bytes");
  return name;
}

export function sha256Hex(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

/** Read a REGULAR file descriptor to its end, refusing once more than
 *  `maxBytes` arrive. Regular files never answer EAGAIN; pipes must use
 *  readStreamBounded, which waits for data instead of spinning. */
export function readBounded(fd, maxBytes = MAX_ATTACHMENT_BYTES) {
  const chunks = [];
  let total = 0;
  const buf = Buffer.allocUnsafe(1024 * 1024);
  for (;;) {
    const n = readSync(fd, buf, 0, buf.length, null);
    if (n === 0) break;
    total += n;
    if (total > maxBytes) throw err("E_UPLOAD_TOO_LARGE", `attachment exceeds the kernel bound of ${maxBytes} bytes`);
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks, total);
}

/** Collect a readable stream (stdin from ssh) into memory, bounded: the
 *  read is event-driven, so a slow or stalled sender costs no CPU, and the
 *  bound is checked as chunks arrive, before anything is written. The whole
 *  file is buffered on both sides (up to the bound); this is not end-to-end
 *  streaming. */
export async function readStreamBounded(stream, maxBytes = MAX_ATTACHMENT_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += b.length;
    if (total > maxBytes) { stream.destroy?.(); throw err("E_UPLOAD_TOO_LARGE", `attachment exceeds the kernel bound of ${maxBytes} bytes`); }
    chunks.push(b);
  }
  return Buffer.concat(chunks, total);
}

function instanceHomeOf(home) {
  if (typeof home !== "string" || !isAbsolute(home)) throw err("E_BAD_ARGS", "attachments need an absolute instance home");
  if (!existsSync(join(home, "instance.json"))) throw err("E_SESSION_UNKNOWN", `${home} is not an OATS instance home (no instance.json); nothing was written`);
  return realpathSync(home);
}

/** The attachments directory must be a real directory inside the home: a
 *  symlink planted there (or a file) must not turn a receive into a write
 *  somewhere else. Created 0700 when absent. */
function attachmentsDir(realHome) {
  const dir = join(realHome, ATTACHMENTS_DIRNAME);
  let st;
  try { st = lstatSync(dir); }
  catch (e) {
    if (e.code !== "ENOENT") throw e;
    // Two first uploads may both see ENOENT: the loser's mkdir answers
    // EEXIST and it validates what the winner (or a planted entry) put there.
    try { mkdirSync(dir, { mode: 0o700 }); } catch (m) { if (m.code !== "EEXIST") throw m; }
    st = lstatSync(dir);
  }
  if (st.isSymbolicLink() || !st.isDirectory()) throw err("E_UPLOAD_FAILED", `${dir} is not a real directory inside the instance home; nothing was written`);
  const real = realpathSync(dir);
  if (real !== dir && !real.startsWith(realHome + sep)) throw err("E_UPLOAD_FAILED", `${dir} resolves outside the instance home; nothing was written`);
  return dir;
}

/** Store `bytes` as a private file under <home>/.oats-attachments/<name>,
 *  taking name-2, name-3 ... when the name is taken. The destination is
 *  allocated exclusively (O_CREAT|O_EXCL, 0600): two simultaneous uploads
 *  of the same name get two files and neither clobbers the other, and a
 *  symlink planted under a candidate name is skipped, never followed. The
 *  path is reported only after the bytes are written and synced. */
export function receiveAttachment(home, name, bytes, { maxBytes = MAX_ATTACHMENT_BYTES } = {}) {
  const realHome = instanceHomeOf(home);
  const safe = attachmentName(name);
  if (!Buffer.isBuffer(bytes)) throw err("E_BAD_ARGS", "attachment bytes must be a Buffer");
  if (bytes.length > maxBytes) throw err("E_UPLOAD_TOO_LARGE", `attachment exceeds the kernel bound of ${maxBytes} bytes`);
  const dir = attachmentsDir(realHome);
  const ext = extname(safe), stem = safe.slice(0, safe.length - ext.length);
  for (let i = 1; i <= 10000; i++) {
    const path = i === 1 ? join(dir, safe) : join(dir, `${stem}-${i}${ext}`);
    let fd;
    try { fd = openSync(path, "wx", 0o600); }
    catch (e) { if (e.code === "EEXIST") continue; throw e; }
    try {
      let off = 0;
      while (off < bytes.length) off += writeSync(fd, bytes, off, bytes.length - off);
      fsyncSync(fd);
    } catch (e) { closeSync(fd); rmSync(path, { force: true }); throw e; }
    closeSync(fd);
    return { path, bytes: bytes.length, sha256: sha256Hex(bytes) };
  }
  throw err("E_UPLOAD_FAILED", `no free name for ${safe} under ${dir}`);
}

function readLocalFile(file, maxBytes) {
  if (typeof file !== "string" || !file) throw err("E_BAD_ARGS", "--file needs a path");
  const abs = resolve(file);
  let st;
  try { st = statSync(abs); } catch { throw err("E_BAD_ARGS", `no such file: ${abs}`); }
  if (!st.isFile()) throw err("E_BAD_ARGS", `${abs} is not a regular file`);
  if (st.size > maxBytes) throw err("E_UPLOAD_TOO_LARGE", `${abs} is ${st.size} bytes; the kernel bound is ${maxBytes}`);
  const fd = openSync(abs, "r");
  try { if (fstatSync(fd).size !== st.size) throw err("E_UPLOAD_FAILED", `${abs} changed while being read`); return { abs, bytes: readBounded(fd, maxBytes) }; }
  finally { closeSync(fd); }
}

/** Upload a local file into an instance's attachments: locally by home, or
 *  on the execution host of a registered server through its saved route
 *  (the same resolution as session attach). The remote answer's sha256 and
 *  size must equal the local file's before the path is reported. */
export function uploadAttachment({ file, home, server, instance }, io = {}) {
  const maxBytes = io.maxBytes || MAX_ATTACHMENT_BYTES;
  const { abs, bytes } = readLocalFile(file, maxBytes);
  const name = basename(abs);
  const sha256 = sha256Hex(bytes);
  if (!server) {
    if (!home) throw err("E_BAD_ARGS", "session upload needs --home </absolute/instance> or --server <id> with --instance <name> or --home");
    return { ...receiveAttachment(home, name, bytes, { maxBytes }), name, home: realpathSync(home), source: abs };
  }
  const route = resolveRoute(server, { instance, home }, "session upload");
  const remote = checkRemote(route.target, io);
  // Both lists must carry the token; a probe without the arrays is an old kernel.
  const advertises = (list) => Array.isArray(list) && list.includes("session-upload");
  if (!advertises(remote.remote) || !advertises(remote.features)) {
    throw serverError("E_REMOTE_INCOMPATIBLE", `remote oats ${remote.version} at ${route.target.sshHost} does not advertise session-upload (kernels from ${SESSION_UPLOAD_REMOTE_VERSION} do); upgrade it there; nothing was sent`);
  }
  const { envelope, stderr } = runRemote(route.target, ["session", "receive", "--home", route.home, "--name", name, "--json"], { ...io, input: bytes, timeoutMs: io.timeoutMs || 600000 });
  if (!envelope.ok) throw serverError(envelope.error?.code || "E_UPLOAD_FAILED", `${server}: ${envelope.error?.message || "receive failed"}`);
  const r = envelope.result || {};
  if (r.sha256 !== sha256 || r.bytes !== bytes.length || typeof r.path !== "string" || !r.path.startsWith("/")) {
    throw serverError("E_UPLOAD_FAILED", `${server} stored ${r.bytes ?? "?"} bytes with sha256 ${r.sha256 ?? "?"} at ${r.path || "?"}, but the local file is ${bytes.length} bytes with sha256 ${sha256}; the remote file is left for inspection`);
  }
  return { path: r.path, bytes: r.bytes, sha256: r.sha256, name, home: route.home, server, instance: instance || route.snapshot?.instance, source: abs, ...(stderr?.trim() ? { stderr: stderr.trim() } : {}) };
}
