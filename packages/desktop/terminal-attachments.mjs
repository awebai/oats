// File transfer is separate from terminal input: never submit the user's draft.
import { stat, mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { remoteTargetKey } from "./remote-target.mjs";
const exec = promisify(execFile);
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const imageExtensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export async function prepareTerminalAttachments(items, { directory, remote, cli, run = exec }) {
  if (!Array.isArray(items) || !items.length || items.length > 16) throw new Error("Choose between 1 and 16 files.");
  if (remote) {
    remoteTargetKey(remote);
    if (!cli?.ok || !cli.bin || !cli.remote?.includes("session-upload")) throw new Error("Update OATS on both computers to attach files to remote agents.");
  }
  let total = 0;
  const sources = [];
  // Validate the complete batch before creating files or transferring anything.
  for (const item of items) {
    if (typeof item?.path === "string" && isAbsolute(item.path) && !/[\x00-\x1f\x7f]/.test(item.path)) {
      const info = await stat(item.path);
      if (!info.isFile()) throw new Error("Only files can be attached.");
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
    let path = source.path;
    if (!path) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      path = join(directory, `image-${randomUUID()}.${source.ext}`);
      await writeFile(path, source.bytes, { mode: 0o600, flag: "wx" });
    }
    if (remote) {
      const { stdout } = await run(cli.bin, ["session", "upload", "--server", remote.serverId, "--instance", remote.instance,
        ...(remote.home ? ["--home", remote.home] : []), "--file", path, "--json"], { encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024 });
      const result = JSON.parse(stdout);
      if (result.schemaVersion !== 1 || result.ok !== true || typeof result.result?.path !== "string"
        || !result.result.path.startsWith("/") || /[\x00-\x1f\x7f]/.test(result.result.path)) throw new Error(result.error?.message || "Remote file transfer failed.");
      path = result.result.path;
    }
    paths.push(path);
  }
  return paths;
}
