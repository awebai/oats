/** Explicit new digest domains. Existing v1 package/artifact functions remain
 * literal in their owning modules; this module never reinterprets legacy hashes. */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { oatsError } from "./errors.mjs";
import { canonicalJson, compareUtf8, dataLimits, decodeUtf8 } from "./portable-values.mjs";

export const TREE_FORMAT = "oats.tree-exec.v1";
export const PACKAGE_FORMAT = "oats.package-payload-exec.v1";
export const JSON_FORMAT = "oats.json.v1";
export const BYTES_FORMAT = "oats.bytes.v1";
const digest = (format, data) => ({ format, value: `sha256-${createHash("sha256").update(data).digest("hex")}` });

export function jsonIntegrity(value, options) { return digest(JSON_FORMAT, canonicalJson(value, options)); }
export function bytesIntegrity(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw oatsError("invalid-declaration", "raw-byte integrity requires bytes");
  }
  return digest(BYTES_FORMAT, value);
}
export function validateIntegrity(value, formats = [TREE_FORMAT, PACKAGE_FORMAT, JSON_FORMAT, BYTES_FORMAT]) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== 2 || !Object.hasOwn(value, "format") || !Object.hasOwn(value, "value")
      || !formats.includes(value.format) || typeof value.value !== "string" || !/^sha256-[a-f0-9]{64}$/.test(value.value)) {
    throw oatsError("invalid-artifact-reference", "expected explicit supported digest format and full SHA-256");
  }
  return value;
}

const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size
  && a.mode === b.mode && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

/** Domain NUL; then UTF-8-path-sorted records:
 * F || uint64(path bytes) || path || owner-exec byte || uint64(content bytes) || content
 * S || uint64(path bytes) || path || uint64(target bytes) || literal target
 * Length framing prevents the legacy binary record-boundary ambiguity.
 * Empty directories and non-owner-execute mode bits do not enter identity.
 * Containment remains the retention caller's responsibility; links aren't followed. */
export function treeIntegrity(root, { format = TREE_FORMAT, ...options } = {}) {
  if (![TREE_FORMAT, PACKAGE_FORMAT].includes(format)) {
    throw oatsError("unsupported-wire-version", "unsupported portable tree digest format");
  }
  const limits = dataLimits({ maxBytes: 256 * 1024 * 1024, ...options });
  const entries = [], hash = createHash("sha256");
  let visited = 0, bytes = 0;
  const account = (length) => {
    bytes += length;
    if (bytes > limits.maxBytes) throw oatsError("resource-limit", "artifact digest byte limit exceeded");
  };
  const length = (size) => {
    const value = Buffer.alloc(8);
    value.writeBigUInt64BE(BigInt(size));
    return value;
  };
  const field = (data) => { account(8 + data.length); hash.update(length(data.length)); hash.update(data); };
  const walk = (dir, parts) => {
    if (parts.length > limits.maxDepth) throw oatsError("resource-limit", "artifact tree depth limit exceeded");
    const names = readdirSync(dir, { encoding: "buffer" });
    for (const raw of names) {
      if (++visited > limits.maxEntries) throw oatsError("resource-limit", "artifact tree entry limit exceeded");
      const name = decodeUtf8(raw, "artifact filename");
      if (format === PACKAGE_FORMAT && (name === "node_modules" || (!parts.length && name === "oats-lock.json"))) continue;
      const path = join(dir, name), relative = [...parts, name].join("/");
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) entries.push({ path, relative, stat, kind: "S" });
      else if (stat.isDirectory()) walk(path, [...parts, name]);
      else if (stat.isFile()) entries.push({ path, relative, stat, kind: "F" });
      else throw oatsError("invalid-artifact", "unsupported artifact tree entry");
    }
  };
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory()) throw oatsError("invalid-artifact", "artifact digest root must be a real directory");
  walk(root, []);
  hash.update(`${format}\0`);
  for (const entry of entries.sort((a, b) => compareUtf8(a.relative, b.relative))) {
    account(1); hash.update(entry.kind); field(Buffer.from(entry.relative, "utf8"));
    if (entry.kind === "S") {
      const target = readlinkSync(entry.path, { encoding: "buffer" });
      decodeUtf8(target, "artifact symlink target");
      field(target);
      continue;
    }
    const fd = openSync(entry.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = fstatSync(fd);
      if (!before.isFile() || !sameFile(entry.stat, before)) {
        throw oatsError("integrity-drift", "artifact input changed during digest");
      }
      account(1 + 8 + before.size);
      hash.update(Buffer.from([(before.mode & 0o100) !== 0 ? 1 : 0]));
      hash.update(length(before.size));
      const content = readFileSync(fd);
      if (content.length !== before.size || !sameFile(before, fstatSync(fd))) {
        throw oatsError("integrity-drift", "artifact input changed during digest");
      }
      hash.update(content);
    } finally { closeSync(fd); }
  }
  return { format, value: `sha256-${hash.digest("hex")}` };
}
