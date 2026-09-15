/** Shared materialization mechanics. Kernel manifest/runtime validators are
 * supplied once by the caller; this module selects no source, lock or approval. */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
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
function writeCapabilityInstallation(dest, cap, pkg) {
  writeFileSync(join(dest, CAPABILITY_INSTALLATION_FILE), JSON.stringify(capabilityInstallationRecord(cap, pkg), null, 2) + "\n", { mode: 0o644 });
}

export function createCapabilityMaterializer({ materializeCapabilityDeps, assertCapabilitySelfContained, assertMaterializedDepsContained, assertNoNativeBinaries }) {
  for (const validate of [materializeCapabilityDeps, assertCapabilitySelfContained, assertMaterializedDepsContained, assertNoNativeBinaries]) {
    if (typeof validate !== "function") throw new TypeError("materializer requires the kernel's complete validation callbacks");
  }
  /** The returned legacy integrity remains literal compatibility evidence. New
   * preparation computes the explicit new-format integrity over this same tree. */
  return function materializeCapability({ cap, pkg, artifactsDir }) {
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
