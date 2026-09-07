/** Instance attachments: bytes a viewer drops or pastes for an agent, kept as
 *  private files INSIDE the instance home so the agent can read them by path.
 *  Upload never touches the terminal; the caller pastes the returned path.
 *  Remote uploads stream through the same ssh transport as every routed
 *  command, into `oats session receive` on the execution host. */
import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, statSync, writeFileSync, realpathSync } from "node:fs";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
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
  if (name === "." || name === ".." || name.startsWith("-")) throw err("E_BAD_ARGS", "attachment name may not be a dot name or start with a dash");
  if (Buffer.byteLength(name) > 200) throw err("E_BAD_ARGS", "attachment name is longer than 200 bytes");
  return name;
}

export function sha256Hex(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

/** Read a descriptor to its end, refusing once more than `maxBytes` arrive
 *  (nothing is written before the bound is known to hold). */
export function readBounded(fd, maxBytes = MAX_ATTACHMENT_BYTES) {
  const chunks = [];
  let total = 0;
  const buf = Buffer.allocUnsafe(1024 * 1024);
  for (;;) {
    let n;
    try { n = readSync(fd, buf, 0, buf.length, null); }
    catch (e) { if (e.code === "EAGAIN") continue; if (e.code === "EOF") break; throw e; }
    if (n === 0) break;
    total += n;
    if (total > maxBytes) throw err("E_UPLOAD_TOO_LARGE", `attachment exceeds the kernel bound of ${maxBytes} bytes`);
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks, total);
}

function instanceHomeOf(home) {
  if (typeof home !== "string" || !isAbsolute(home)) throw err("E_BAD_ARGS", "attachments need an absolute instance home");
  if (!existsSync(join(home, "instance.json"))) throw err("E_SESSION_UNKNOWN", `${home} is not an OATS instance home (no instance.json); nothing was written`);
  return realpathSync(home);
}

/** Store `bytes` as a private file under <home>/.oats-attachments/<name>,
 *  choosing name-2, name-3 ... when the name is taken. Directory 0700, file
 *  0600, written to a temporary name and renamed into place. */
export function receiveAttachment(home, name, bytes, { maxBytes = MAX_ATTACHMENT_BYTES } = {}) {
  const realHome = instanceHomeOf(home);
  const safe = attachmentName(name);
  if (!Buffer.isBuffer(bytes)) throw err("E_BAD_ARGS", "attachment bytes must be a Buffer");
  if (bytes.length > maxBytes) throw err("E_UPLOAD_TOO_LARGE", `attachment exceeds the kernel bound of ${maxBytes} bytes`);
  const dir = join(realHome, ATTACHMENTS_DIRNAME);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const ext = extname(safe), stem = safe.slice(0, safe.length - ext.length);
  let path = join(dir, safe);
  for (let i = 2; existsSync(path); i++) path = join(dir, `${stem}-${i}${ext}`);
  const tmp = `${path}.part-${process.pid}`;
  try {
    writeFileSync(tmp, bytes, { mode: 0o600, flag: "wx" });
    renameSync(tmp, path);
  } catch (e) { rmSync(tmp, { force: true }); throw e; }
  return { path, bytes: bytes.length, sha256: sha256Hex(bytes) };
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
  if (!remote.remote.includes("session") || !remote.features.includes("session-upload")) {
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
