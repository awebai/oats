/** Shared materialization mechanics. Kernel manifest/runtime validators are
 * supplied once by the caller; this module selects no source, lock or approval. */
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { capabilityArtifactIntegrity, copyTreeSafe } from "./artifact-tree.mjs";
import { CAPABILITY_INSTALLATION_FILE } from "./capability-provenance.mjs";
import { executableSurfaceOf } from "./capability-execution.mjs";
import { oatsError } from "./errors.mjs";

/** Provenance format v1 is byte-stable across writer kernels and digest versions:
 * exactly these keys/order, two-space JSON, one LF, mode0644, no writer version. */
function capabilityInstallationRecord(cap, pkg) {
  return {
    schemaVersion: 1,
    capability: cap.id,
    version: cap.manifest.version,
    package: pkg.package,
    packageVersion: pkg.version,
    source: pkg.source,
    commit: pkg.commit,
    packagePath: pkg.path,
    capabilityPath: cap.rel,
  };
}
function assertMaterializationInput(root) {
  if (!lstatSync(root).isDirectory()) throw oatsError("invalid-package-manifest", "a materialized capability root must be a real directory, not a source alias");
  let metadata;
  try { metadata = lstatSync(join(root, CAPABILITY_INSTALLATION_FILE)); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  if (!metadata.isFile() || (metadata.mode & 0o100) !== 0 || !readdirSync(root).includes(CAPABILITY_INSTALLATION_FILE)) {
    throw oatsError("invalid-package-manifest", "source provenance entry must not be a link, executable, directory or filesystem alias");
  }
}
function writeCapabilityInstallation(dest, cap, pkg) {
  assertMaterializationInput(dest);
  const temporary = mkdtempSync(join(dest, ".installation-")), candidate = join(temporary, "record.json");
  let failed = false, primary;
  try {
    writeFileSync(candidate, JSON.stringify(capabilityInstallationRecord(cap, pkg), null, 2) + "\n", { flag: "wx", mode: 0o644 });
    chmodSync(candidate, 0o644);
    // Replace the reserved entry itself, never follow a source-controlled link
    // or mutate another file sharing its inode. Valid v1 serialization is unchanged.
    renameSync(candidate, join(dest, CAPABILITY_INSTALLATION_FILE));
  } catch (error) { failed = true; primary = error; throw error; }
  finally {
    try { rmSync(candidate, { force: true }); rmdirSync(temporary); }
    catch (cleanup) {
      const error = failed ? new AggregateError([primary, cleanup], "provenance write and staging cleanup failed", { cause: primary })
        : new Error("provenance staging cleanup failed", { cause: cleanup });
      error.code = failed ? primary.code : cleanup.code; error.stagingPath = temporary; throw error;
    }
  }
}

export function createCapabilityMaterializer({ materializeCapabilityDeps, assertCapabilitySelfContained, assertMaterializedDepsContained, assertNoNativeBinaries }) {
  for (const validate of [materializeCapabilityDeps, assertCapabilitySelfContained, assertMaterializedDepsContained, assertNoNativeBinaries]) {
    if (typeof validate !== "function") throw new TypeError("materializer requires the kernel's complete validation callbacks");
  }
  /** The returned legacy integrity remains literal compatibility evidence. New
   * preparation computes the explicit new-format integrity over this same tree. */
  return function materializeCapability({ cap, pkg, artifactsDir }) {
    assertMaterializationInput(cap.dir);
    const rep = materializeCapabilityDeps(cap.dir);
    if (rep.error) throw oatsError("invalid-package-manifest", `runtime dependency materialization failed for capability "${cap.id}" of package "${pkg.package}": ${rep.error}`);
    assertCapabilitySelfContained(cap.dir, cap.manifest);
    assertMaterializedDepsContained(cap.dir);
    assertNoNativeBinaries(cap.dir);
    const dest = join(artifactsDir, cap.id);
    mkdirSync(dirname(dest), { recursive: true });
    if (cap.rel === ".") {
      // Published flat packages need their original root for subsequent template
      // reads; copy instead of moving, preserving literal links and real modes.
      copyTreeSafe(cap.dir, dest);
    } else renameSync(cap.dir, dest);
    writeCapabilityInstallation(dest, cap, pkg);
    return {
      capability: cap.id, version: cap.manifest.version, package: pkg.package, path: cap.rel,
      dir: dest, integrity: capabilityArtifactIntegrity(dest),
      layer: cap.manifest.layer ?? null,
      executableSurface: executableSurfaceOf(cap.manifest), manifest: cap.manifest,
    };
  };
}
