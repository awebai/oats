/** Sole bounded structural decoder for historical lockfileVersion 1 and the
 * capability-materialization lockfileVersion 2.
 *
 * Bytes in, validated null-prototype maps out. No filesystem/config reads,
 * migration, normalization, repair or writes. Retired-capability policy is an
 * injected pure predicate so this leaf does not import the kernel. */
import { byteView, parseStrictJson } from "./portable-values.mjs";
import {
  PACKAGE_ID_RE, TRANSITIONAL_ROW_FIELDS, capabilityIdViolation,
  isMaterializedCapabilityId, validateCapabilityLockEntry, validateLockEntry,
} from "./capability-provenance.mjs";
import { oatsError } from "./errors.mjs";

const LOCK_PACKAGE_KEYS = new Set(["source", "path", "version", "commit", "integrity", "dependencies"]);
const LOCK_CAPABILITY_KEYS = new Set(["version", "package", "path", "integrity", "trusted"]);
const noneRetired = () => undefined;
const nullProtoMap = (raw) => {
  const out = Object.create(null);
  for (const key of Object.keys(raw || {})) out[key] = raw[key];
  return out;
};
const kind = (value) => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

/** Validate one literal v1 capability row. Unknown historical fields remain
 * preserved, matching the existing reader; required fields and known optional
 * field types remain strict. */
export function legacyCapabilityEntryViolation(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "not an object";
  for (const key of ["source", "version", "integrity"]) if (typeof entry[key] !== "string" || !entry[key]) return `missing/invalid ${key}`;
  if (!/^sha256-[0-9a-f]{64}$/.test(entry.integrity)) return `malformed integrity "${entry.integrity}"`;
  if (entry.commit !== undefined && typeof entry.commit !== "string") return "invalid commit";
  if (entry.trustedExecutables !== undefined && typeof entry.trustedExecutables !== "boolean") return "invalid trustedExecutables";
  return null;
}

/** Decode one already-read historical lock. `file` is diagnostic provenance,
 * not a path this codec reads. Strict JSON adds bounded/duplicate-key/UTF-8
 * refusal before the unchanged v1/v2 semantic pass. */
export function decodeLegacyLockBytes(input, { file = "<legacy-lock>", retiredCapabilityReason = noneRetired, limits } = {}) {
  const bytes = byteView(input, "legacy lock bytes");
  if (typeof file !== "string" || !file) throw oatsError("invalid-lock", "legacy lock diagnostic file must be non-empty text");
  if (typeof retiredCapabilityReason !== "function") throw oatsError("invalid-lock", `${file}: retired-capability classifier must be a function`);
  const bad = (message, extra = {}) => oatsError("invalid-lock", `${file}: ${message}`, [{ file, violation: message, ...extra }]);
  let parsed;
  try { parsed = parseStrictJson(bytes, limits); }
  catch (error) { const failure = bad(`malformed JSON — ${error.message}`); failure.cause = error; throw failure; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw bad(`lock root must be a JSON object (got ${kind(parsed)})`);
  const rawVersion = parsed.lockfileVersion;
  if (rawVersion !== undefined && typeof rawVersion !== "number") throw bad(`lockfileVersion must be a number (got ${JSON.stringify(rawVersion)})`);
  if (rawVersion !== undefined && rawVersion !== 1 && rawVersion !== 2) throw bad(`unsupported lockfileVersion ${rawVersion}`);
  const version = rawVersion ?? 1;
  if (parsed.capabilities !== undefined && (!parsed.capabilities || typeof parsed.capabilities !== "object" || Array.isArray(parsed.capabilities))) {
    throw bad(`"capabilities" must be an object map (got ${kind(parsed.capabilities)})`);
  }
  const out = { version, packages: Object.create(null), capabilities: Object.create(null), legacyCapabilities: Object.create(null) };
  if (version === 1) {
    if (parsed.packages !== undefined) throw bad(`lockfileVersion 1 must not carry a "packages" map`);
    for (const id of Object.keys(parsed.capabilities || {})) {
      const entry = parsed.capabilities[id];
      if (!retiredCapabilityReason(id)) {
        const violation = legacyCapabilityEntryViolation(entry);
        if (violation) throw bad(`legacy entry "${id}" is malformed (${violation})`, { package: id });
      }
      out.legacyCapabilities[id] = entry;
    }
    return out;
  }

  const rawPackages = parsed.packages;
  if (!rawPackages || typeof rawPackages !== "object" || Array.isArray(rawPackages)) {
    throw bad(`lockfileVersion 2 requires a "packages" object map (got ${kind(rawPackages)})`);
  }
  const packageKeys = Object.keys(rawPackages), hasCapabilityMap = Object.hasOwn(parsed, "capabilities");
  const stateFree = packageKeys.length === 0 && (!hasCapabilityMap || Object.keys(parsed.capabilities).length === 0);
  const unsupported = (why) => bad(`unsupported transitional package-root lockfileVersion 2 (${why}). This is the superseded package-store lock shape; it is not converted or interpreted. Delete this lock (and any .agents/packages directory) and recreate the scope's state with \`oats install\`.`);
  if (!stateFree) {
    if (!hasCapabilityMap) throw unsupported(`no top-level "capabilities" map`);
    for (const id of packageKeys) {
      const row = rawPackages[id];
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const tells = TRANSITIONAL_ROW_FIELDS.filter((field) => Object.hasOwn(row, field));
      if (tells.length) throw unsupported(`package row "${id}" carries ${tells.join(", ")}`);
    }
  }
  for (const id of packageKeys) {
    if (!PACKAGE_ID_RE.test(id)) throw bad(`packages map has an invalid package key ${JSON.stringify(id)}`, { package: id });
    const entry = rawPackages[id];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw bad(`lock entry for "${id}" is not an object`, { package: id });
    const extra = Object.keys(entry).filter((key) => !LOCK_PACKAGE_KEYS.has(key));
    if (extra.length) throw bad(`lock entry for "${id}" has unknown keys: ${extra.join(", ")}`, { package: id });
    out.packages[id] = entry;
  }
  for (const id of Object.keys(out.packages)) validateLockEntry(id, out.packages[id], out.packages, { file });
  if (hasCapabilityMap) {
    for (const id of Object.keys(parsed.capabilities)) {
      if (!isMaterializedCapabilityId(id)) throw bad(`capabilities map has an invalid capability key: ${capabilityIdViolation(id)}`);
      const entry = parsed.capabilities[id];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw bad(`capability lock entry for "${id}" is not an object`, { package: id });
      const extra = Object.keys(entry).filter((key) => !LOCK_CAPABILITY_KEYS.has(key));
      if (extra.length) throw bad(`capability lock entry for "${id}" has unknown keys: ${extra.join(", ")}`, { package: id });
      out.capabilities[id] = entry;
    }
  }
  for (const id of Object.keys(out.capabilities)) validateCapabilityLockEntry(id, out.capabilities[id], out.packages, { file });
  return out;
}
