/** The official package catalog (package-catalog.json, or the file OATS_PACKAGE_CATALOG names) and the slot names a
 *  soul's capabilities fill (LAYERS). A leaf (awebai/oats#1630): `oats workspace status` reads them
 *  without loading core.mjs, which imports what it still uses and re-exports what it exported. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { recordLocalInput } from "./local-inputs.mjs";
import { oatsError } from "./errors.mjs";
import { parseStrictJson, lineAt } from "./canonical-json.mjs";
import { PKG_ROOT } from "./version.mjs";

/** The package and capability id grammar (namespaced, lowercase): an id names a
 *  directory (a home's module copy), so no path spelling fits it. */
const PACKAGE_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

// ---------- capability slots ----------
export const LAYERS = ["knowledge", "messaging", "tasks"];

/** Official package catalog: identity + discovery ONLY — resolving through it
 * never advances a lock and never grants executable trust (contract §1).
 * Workstream 3 seeds the kernel-bundled catalog; OATS_PACKAGE_CATALOG points
 * tests/deployments at an alternate catalog JSON ({ packages: { <id>: { url, ref? } } }). */
export function officialPackageCatalog() {
  return readCatalogFile().packages;
}
/** Parse the catalog file once: { packages: { <id>: { url, ref?, path? } },
 * capabilities?: { <legacy capability id>: <package id> } }. Both maps are
 * returned with a null prototype so inherited Object.prototype names can never
 * impersonate a catalog entry. */
function readCatalogFile() {
  const file = officialCatalogFile();
  const empty = { packages: Object.create(null), capabilities: Object.create(null), file };
  // An OATS_PACKAGE_CATALOG override is local configuration (observation.localRevision); the bundled
  // catalog belongs to the kernel install.
  const override = !!process.env.OATS_PACKAGE_CATALOG;
  if (!existsSync(file)) { if (override) recordLocalInput(file, null); return empty; }
  const text = readFileSync(file, "utf8");
  if (override) recordLocalInput(file, text);
  return parsePackageCatalog(text, file);
}
/** A package catalog's text, parsed and checked as the kernel reads it (named `file` in errors):
 *  { packages, capabilities, file }, both maps null-prototype; invalid-source when it is broken. */
export function parsePackageCatalog(text, file) {
  let doc;
  try { doc = JSON.parse(text); }
  catch (e) {
    // JSON.parse does not say where; the kernel's strict reader (same grammar) locates the error.
    let line;
    try { parseStrictJson(text, { maxBytes: 64 * 1024 * 1024 }); } catch (s) { if (Number.isInteger(s.provenance?.offset)) line = lineAt(text, s.provenance.offset); }
    throw oatsError("invalid-source", `broken package catalog ${file}${line ? ` (line ${line})` : ""}: ${e.message}`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw oatsError("invalid-source", `broken package catalog ${file}: root must be a JSON object`);
  const out = { packages: Object.create(null), capabilities: Object.create(null), file };
  const packages = doc.packages;
  if (packages !== undefined) {
    if (packages === null || typeof packages !== "object" || Array.isArray(packages)) throw oatsError("invalid-source", `broken package catalog ${file}: "packages" must be an object map`);
    for (const [id, entry] of Object.entries(packages)) out.packages[id] = entry;
  }
  // Capability aliases (0.19.1 migration contract): legacy capability id →
  // official package id. Identity mappings (package id == capability id) need
  // no entry; an alias exists for capabilities a package exports under another
  // package identity (oats.developer is exported by package oats.engineering).
  //
  // The object form may also carry "capability": the id the package exports
  // TODAY in place of the legacy id (a RENAMING alias, the oas.* → oats.*
  // migration contract). A plain alias promises the package exports the legacy
  // id itself; a renaming alias promises it exports the successor instead.
  const aliases = doc.capabilities;
  if (aliases !== undefined) {
    if (aliases === null || typeof aliases !== "object" || Array.isArray(aliases)) throw oatsError("invalid-source", `broken package catalog ${file}: "capabilities" must be a map of capability id → package id`);
    for (const [capId, target] of Object.entries(aliases)) {
      const obj = typeof target === "string" ? { package: target } : (target && typeof target === "object" && !Array.isArray(target) ? target : undefined);
      const pkgId = obj?.package;
      if (typeof pkgId !== "string" || !PACKAGE_ID_RE.test(pkgId)) throw oatsError("invalid-source", `broken package catalog ${file}: capability alias "${capId}" must name a package id (string, or { "package": "<id>" })`);
      if (!PACKAGE_ID_RE.test(capId)) throw oatsError("invalid-source", `broken package catalog ${file}: capability alias key "${capId}" is not a valid capability id`);
      const renamed = obj.capability;
      if (renamed !== undefined && (typeof renamed !== "string" || !PACKAGE_ID_RE.test(renamed))) throw oatsError("invalid-source", `broken package catalog ${file}: capability alias "${capId}" has an invalid "capability" rename target`);
      out.capabilities[capId] = renamed && renamed !== capId ? { package: pkgId, capability: renamed } : pkgId;
    }
  }
  return out;
}

/** The effective official catalog file: `OATS_PACKAGE_CATALOG`, else the bundled one. */
export function officialCatalogFile() {
  return process.env.OATS_PACKAGE_CATALOG || join(PKG_ROOT, "package-catalog.json");
}

export { PACKAGE_ID_RE, readCatalogFile };
