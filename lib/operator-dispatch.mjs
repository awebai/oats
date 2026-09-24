/** Operator-level capability commands — `oats <ns> <cmd>` run from a DEPLOYMENT
 *  directory (one holding `oats-local.yaml`), not from an instance home.
 *
 *  Contract (docs/design/2026-09-23-workspace-module-contracts.md, "Post-0.25.0
 *  clarifications"): resolve exactly as `oats spawn --soul <name>` would —
 *  `prepareInstance(dir, soul)` → the soul's Resolution — find the module whose
 *  manifest `command` is the namespace, fetch that capability into the
 *  deployment's per-commit module store `<deployment>/.oats/modules/<cap>@<commit12>/`
 *  (the same store capability-defined agents use; see
 *  lib/instance-resolution.mjs#resolvePackageCapabilityAgent) and dispatch to that
 *  copy with the soul's merged payload as `OATS_SETTINGS`.
 *
 *  Never "the newest instance's copy" (an instance is not an authority for the
 *  deployment) and never an unlocked cache read: trust is exactly spawn's —
 *  members by membership, packages by their declaration in the workspace's
 *  packages:. A module in the Resolution IS active.
 *
 *  `--soul` is required: without a soul there is no Resolution to answer from
 *  (E_BAD_ARGS naming --soul). Nothing here reads oats-config.yaml. */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { randomBytes } from "node:crypto";
import { oatsError } from "./errors.mjs";
import { loadLocal } from "./workspace.mjs";
import { packageRef, refForKey } from "./resolve.mjs";
import { MODULES_DIR } from "./materialize.mjs";
import * as defaultRemote from "./remote.mjs";
import { prepareInstance } from "./instance-resolution.mjs";

function err(code, message, details) { const e = oatsError(code, message, details); e.details = details; return e; }

/** Is `dir` (or an ancestor) a v2 deployment? → the loadLocal result or null when
 *  no oats-local.yaml is in reach (the caller then falls back to the classic chain).
 *  Any OTHER failure (a malformed oats-local.yaml → E_WORKSPACE_SCHEMA) propagates. */
export function deploymentOf(dir) {
  try { return loadLocal(dir); }
  catch (e) { if (e?.code === "E_LOCAL_MISSING") return null; throw e; }
}

/** The repo ref a module's tree is fetched from, spelled as lib/remote.mjs accepts it:
 *  member → the member repoKey (`local/<abs>` → the abs path, else `git:<key>`);
 *  package → packageRef over the lock entry (catalog url or git source). */
export function moduleRef(module, lock, { catalog = null, remote = defaultRemote } = {}) {
  const from = module?.from;
  if (!from || typeof from !== "object") throw err("E_CAPABILITY_BROKEN", `module ${module?.name ?? "?"}: resolution carries no provenance`, { module: module?.name ?? null });
  if (from.kind === "member") return refForKey(from.repoKey);
  if (from.kind === "package") {
    const entry = lock?.packages?.[from.package];
    if (!entry || typeof entry !== "object") throw err("E_PACKAGE_MISSING", `module ${module.name}: package ${from.package} is not in the deployment's lock`, { module: module.name, id: from.package });
    return packageRef(from.package, entry, catalog, remote);
  }
  throw err("E_CAPABILITY_BROKEN", `module ${module.name}: unknown provenance kind ${JSON.stringify(from.kind)}`, { module: module.name, kind: from.kind ?? null });
}

/** `<deployment>/.oats/modules/<cap>@<commit12>` — the per-commit store path of a module. */
export function moduleStoreDir(deployment, module) {
  return join(deployment, MODULES_DIR, `${module.name}@${String(module.from.commit).slice(0, 12)}`);
}

/** Ensure the module's capability tree is in the deployment store; returns its dir.
 *  Nothing that differs from the locked commit is ever handed out to run:
 *  - a fetch's content digest must match what the fetch read at the commit (and
 *    the resolution's `module.digest` when it pins one), else E_PACKAGE_INTEGRITY;
 *    the verified digest is recorded beside the tree (`.<cap>@<commit12>.digest`,
 *    in the same operator-owned deployment as oats-lock.json);
 *  - a tree already there is reused only while its content still digests to that
 *    record (the commit in the name does not stop a local edit); a drifted tree,
 *    or one with no record, is removed and fetched again.
 *  The fetch lands in a sibling staging dir and is renamed into place, so a failed
 *  or interrupted fetch never leaves a half tree that a later call would trust. */
export async function ensureModuleTree(deployment, module, lock, { catalog = null, remote = defaultRemote, remoteOptions, fetch = defaultRemote.fetchRemoteTree } = {}) {
  const store = join(deployment, MODULES_DIR);
  const dir = moduleStoreDir(deployment, module);
  const record = join(store, `.${basename(dir)}.digest`);
  const digestOf = (tree) => { try { return (remote.contentDigest ?? defaultRemote.contentDigest)(tree, { allowSymlinks: defaultRemote.OATS_ALIAS_SYMLINK }); } catch { return null; } };
  const expected = () => { if (module.digest) return module.digest; try { return readFileSync(record, "utf8").trim() || null; } catch { return null; } };
  const verified = (tree) => { const want = expected(); return !!want && digestOf(tree) === want; };
  if (existsSync(join(dir, "oats.json"))) {
    if (verified(dir)) return dir;
    rmSync(dir, { recursive: true, force: true }); // drifted or unrecorded: re-materialize, never run it
  }
  const ref = moduleRef(module, lock, { catalog, remote });
  if (typeof module.dir !== "string" || !module.dir) throw err("E_CAPABILITY_BROKEN", `module ${module.name}: resolution records no capability directory`, { module: module.name });
  mkdirSync(store, { recursive: true });
  const staging = join(store, `.staging-${module.name}-${process.pid}-${randomBytes(4).toString("hex")}`);
  try {
    const fetched = await fetch(ref, module.from.commit, module.dir, staging, { ...(remoteOptions || {}), allowSymlinks: defaultRemote.OATS_ALIAS_SYMLINK });
    if (!existsSync(join(staging, "oats.json"))) throw err("E_CAPABILITY_BROKEN", `module ${module.name}: ${module.dir} at ${String(module.from.commit).slice(0, 12)} has no oats.json`, { module: module.name, dir: module.dir, commit: module.from.commit });
    const digest = digestOf(staging);
    const reported = fetched && typeof fetched.digest === "string" ? fetched.digest : null;
    if (!digest || (reported && reported !== digest) || (module.digest && module.digest !== digest)) {
      throw err("E_PACKAGE_INTEGRITY", `module ${module.name}: ${module.dir} at ${String(module.from.commit).slice(0, 12)} digests ${digest ?? "unreadably"}, not ${module.digest ?? reported}`,
        { module: module.name, commit: module.from.commit, expected: module.digest ?? reported, actual: digest, why: "module-store" });
    }
    // A concurrent call may have won; its tree is the same commit — keep it if it matches.
    if (existsSync(join(dir, "oats.json")) && digestOf(dir) === digest) { rmSync(staging, { recursive: true, force: true }); writeFileSync(record, `${digest}\n`); return dir; }
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); // a half tree from an interrupted direct write
    renameSync(staging, dir);
    writeFileSync(record, `${digest}\n`);
    return dir;
  } catch (x) { try { rmSync(staging, { recursive: true, force: true }); } catch { /* nothing */ } throw x; }
}

/**
 * Resolve an operator-level command namespace from a deployment directory.
 *
 *   contextDir  — where the operator stands (oats-local.yaml is found walking up)
 *   namespace   — the `<ns>` the operator typed (`okf`)
 *   soulName    — the value of --soul; REQUIRED (undefined/true/"" → E_BAD_ARGS)
 *
 * → { deployment, soul: { name, repoKey, commit, team }, module, manifest, commands,
 *     settings: <resolution.payloads[cap] or {}>, resolution, prepared,
 *     ensureTree(): Promise<dir> }   — or null when no module of the soul's
 *     resolution claims the namespace (the caller answers E_UNKNOWN_COMMAND).
 * Two modules claiming one namespace → E_DUPLICATE_NAMESPACE. Everything
 * prepareInstance can throw (E_SOUL_UNKNOWN,
 * E_REMOTE_UNREADABLE, …) propagates untouched.
 */
export async function resolveOperatorDispatch(contextDir, namespace, soulName, { remoteOptions, remote, catalog = null, fetch, prepare = prepareInstance } = {}) {
  if (typeof namespace !== "string" || !namespace) throw err("E_BAD_ARGS", "a command namespace is required");
  if (typeof soulName !== "string" || !soulName.trim()) {
    throw err("E_BAD_ARGS", `oats ${namespace}: outside an instance home a capability command resolves as a spawn would — pass --soul <name> (the soul whose resolution provides the "${namespace}" namespace)`, { namespace, flag: "--soul" });
  }
  const prepared = await prepare(resolvePath(contextDir), soulName, { remoteOptions, remote });
  const { resolution, lock } = prepared;
  const deployment = prepared.deployment ?? dirname(loadLocal(contextDir).path);
  const claimants = (resolution.modules || []).filter((m) => m?.manifest && m.manifest.command === namespace && m.manifest.commands && typeof m.manifest.commands === "object");
  if (!claimants.length) return null;
  if (claimants.length > 1) throw err("E_DUPLICATE_NAMESPACE", `duplicate operational command namespace "${namespace}": ${claimants.map((m) => m.name).join(", ")}`, { namespace, modules: claimants.map((m) => m.name) });
  const module = claimants[0];
  const payload = resolution.payloads?.[module.name];
  const settings = payload && typeof payload === "object" ? { ...payload } : {};
  return {
    deployment, soul: resolution.soul, module, manifest: module.manifest, commands: module.manifest.commands, settings, resolution, prepared,
    ensureTree: () => ensureModuleTree(deployment, module, lock, { catalog, remote, remoteOptions: remoteOptions ?? prepared.remoteOptions, fetch }),
  };
}
