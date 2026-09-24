// File transfer is separate from terminal input: never submit the user's draft.
import { stat, mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { remoteTargetKey } from "./remote-target.mjs";
import { runTerminalCommand } from './terminal-exec.mjs';
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const imageExtensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export function copyTerminalAttachments(items) {
  if (!Array.isArray(items) || !items.length || items.length > 16) throw new Error('Choose between 1 and 16 files.');
  let bytes = 0;
  return items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid attachment');
    if (Object.keys(item).length === 1 && typeof item.path === 'string' && item.path.length <= 4096
      && isAbsolute(item.path) && !/[\x00-\x1f\x7f]/.test(item.path)) return Object.freeze({ path: item.path });
    if (Object.keys(item).length !== 2 || !Object.hasOwn(imageExtensions, item.type)
      || !(item.bytes instanceof Uint8Array) || !item.bytes.length) throw new Error('Invalid attachment');
    bytes += item.bytes.byteLength;
    if (bytes > MAX_ATTACHMENT_BYTES) throw new Error('Attachments must total 25 MB or less.');
    return Object.freeze({ type: item.type, bytes: new Uint8Array(item.bytes) });
  });
}

export async function prepareTerminalAttachments(items, { directory, remote, cli, run = runTerminalCommand,
  signal, current = () => true, fs = { stat, mkdir, writeFile } }) {
  const check = () => { if (signal?.aborted || !current()) throw Object.assign(new Error('Attachment interrupted'), { code: 'E_TERM_ATTACHMENT_INTERRUPTED' }); };
  check();
  items = copyTerminalAttachments(items);
  if (remote) {
    remoteTargetKey(remote);
    if (!cli?.ok || !cli.bin || !cli.remote?.includes("session-upload")) throw new Error("Update OATS on both computers to attach files to remote agents.");
  }
  let total = 0;
  const sources = [];
  // Validate the complete batch before creating files or transferring anything.
  for (const item of items) {
    if (typeof item?.path === "string" && isAbsolute(item.path) && !/[\x00-\x1f\x7f]/.test(item.path)) {
      check();
      const info = await fs.stat(item.path);
      check();
      if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size < 0) throw new Error("Only files can be attached.");
      total += info.size; sources.push({ path: item.path });
    } else {
      const ext = imageExtensions[item?.type];
      if (!ext || !(item?.bytes instanceof Uint8Array) || !item.bytes.length) throw new Error("This attachment is not a supported image or local file.");
      total += item.bytes.byteLength; sources.push({ bytes: item.bytes, ext });
    }
    if (total > MAX_ATTACHMENT_BYTES) throw new Error("Attachments must total 25 MB or less.");
  }
  const paths = [];
  for (const source of sources) {
    check();
    let path = source.path;
    if (!path) {
      check();
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      check();
      path = join(directory, `image-${randomUUID()}.${source.ext}`);
      await fs.writeFile(path, source.bytes, { mode: 0o600, flag: "wx", ...(signal ? { signal } : {}) });
      check(); // an interrupted write may already have created bytes; never claim undo
    }
    if (remote) {
      check();
      const { stdout } = await run(cli.bin, ["session", "upload", "--server", remote.serverId, "--instance", remote.instance,
        ...(remote.home ? ["--home", remote.home] : []), "--file", path, "--json"], { encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024, shell: false, ...(signal ? { signal } : {}) });
      check();
      const result = JSON.parse(stdout);
      if (result.schemaVersion !== 1 || result.ok !== true || typeof result.result?.path !== "string"
        || !result.result.path.startsWith("/") || /[\x00-\x1f\x7f]/.test(result.result.path)) throw new Error(result.error?.message || "Remote file transfer failed.");
      path = result.result.path;
    }
    check(); paths.push(path);
  }
  check(); return paths;
}
