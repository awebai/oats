/** lib/workspace-read.mjs — `oats workspace status`, the workspace read (awebai/oats#1630): the
 *  membership table, the locked and declared packages, the automations placed on this host, and the
 *  desktop facts. One implementation behind the CLI (bin/oats.mjs workspaceCmd) and a process that answers
 *  it many times (lib/read-call.mjs, whose header describes the context and the answer).
 *  `workspaceStatusAnswer(ctx)` is the `--json` answer, an envelope; `workspaceStatusView(ctx)` the data
 *  bin's text renderer reads. Beside them, the rows `oats sync` reports too. A leaf a hot read loads
 *  (lib/hot-reads.mjs): never core.mjs. Kernel-private, not exported from `./core`. */
import { dirname, join } from "node:path";
import { scopeAutomations } from "./automation-scope.mjs";
import { ghLoginStarted, staleTrust, trustRemedy } from "./automations.mjs";
import { LAYERS, officialCapabilityAliases, officialCatalogFile, officialPackageCatalog } from "./package-catalog.mjs";
import { classifyPackageValue, LOCK_FILE, readLock } from "./packages.mjs";
import { answerWarnings, refuse, runRead } from "./read-call.mjs";
import { browseUrl } from "./remote.mjs";
import { loadLocal } from "./workspace.mjs";

/** `oats workspace status --json`: → `{ exit, answer, stderr }` (lib/read-call.mjs), `answer` the envelope. */
export function workspaceStatusAnswer(ctx) {
  return runRead(ctx, async (call) => {
    const { result } = await workspaceStatusFacts(call, ctx);
    return { answer: { schemaVersion: 1, ok: true, result: call.withObservation(result), ...answerWarnings() } };
  });
}

/** `oats workspace status` in text mode: → `{ exit, answer, view, stderr }`, `view` `{ result, discovery,
 *  localPath }` when it did not refuse, `answer` the failure envelope when it did. */
export function workspaceStatusView(ctx) {
  return runRead(ctx, async (call) => ({ view: await workspaceStatusFacts(call, ctx) }));
}

/** The facts of `oats workspace status` (contract §6) at the deployment `dir` names. */
async function workspaceStatusFacts(call, { dir }) {
  let found;
  try { found = loadLocal(dir); }
  catch (e) { refuse(e.code || "E_LOCAL_MISSING", e.message, e.details); }
  const ctx = { dir, localPath: found.path, local: found.local, deploymentDir: dirname(found.path), remoteOptions: call.remoteOptions() };
  // SPIKE (read-parallel): the gh logins the automations' placement will ask, started now, so their network wait
  // overlaps the discovery below. A host this plan misses is asked by the placement itself, as before.
  const ghLogins = process.env.SPIKE_NO_GH_PREFETCH ? null : startGhLogins(ctx.deploymentDir);
  // The standalone case (decisions 10/25) is a discovery too: the repo's own view
  // plus the kernel's oats.core default — discoverOrStandalone decides.
  let discovery;
  try { const { discoverOrStandalone } = await import("./member-clone.mjs"); discovery = await discoverOrStandalone(ctx.local, { deployment: ctx.deploymentDir, remoteOptions: ctx.remoteOptions }); }
  catch (e) { if (typeof e?.code === "string" && e.code.startsWith("E_")) refuse(e.code, e.message, e.details ?? e.provenance); throw e; }
  let lock;
  try { lock = readLock(ctx.deploymentDir); } catch (e) { refuse(e.code || "E_LOCK_SCHEMA", e.message, e.details); }
  const members = memberRows(discovery);
  const packages = packageRows(lock);
  // Standalone (decision 10): there is no workspace file — the declared packages are the
  // kernel's own default (decision 25) and there are no teams.
  const standalone = discovery.standalone === true;
  const declared = Object.keys(standalone ? standalonePackages(catalogForStatus()).packages : (discovery.workspace?.packages || {})).sort();
  const locked = new Set(packages.map((p) => p.id));
  const unsynced = declared.filter((id) => !locked.has(id));
  const stale = packages.filter((p) => !declared.includes(p.id)).map((p) => p.id);
  const result = { workspaceStatusApi: 1, standalone: standalone || undefined, workspace: { name: workspaceName(discovery), key: discovery.key, url: discovery.url, commit: discovery.commit, observedAt: discovery.observedAt, local: ctx.localPath, teams: sharedTeamRows(discovery) }, members, packages, declaredPackages: declared, unsynced, stale, external: (discovery.external || []).map((e) => ({ source: e.source, soul: e.soul.name })), problems: discovery.problems, warnings: [...(discovery.warnings ?? [])] };
  // Workspace automations (0.29.0), from the snapshot `oats sync` took, placed on this host.
  const actx = scopeAutomations(ctx.deploymentDir, ghLogins ? { cache: await ghLogins } : {});
  result.automations = { host: actx.host.name, snapshot: actx.snapshot ? { takenAt: actx.snapshot.takenAt, problems: actx.snapshot.problems.length } : null, rows: [...actx.triggers, ...actx.schedules].map((a) => ({ kind: a.kind, id: a.id, runsOn: a.runsOn, owner: a.owner, runsHere: a.placement.runsHere, reason: a.placement.reason, enabledHere: a.placement.enabledHere, origin: a.origin, ...(a.invalid ? { invalid: a.invalid } : {}) })) };
  // Automation trust (0.30): a workspace automation placed here but not trusted, and a trust entry
  // that names none, are warnings the operator acts on in oats-local.yaml.
  for (const a of [...actx.triggers, ...actx.schedules].filter((x) => x.placement.reason === "untrusted")) {
    result.warnings.push({ code: "automation-untrusted", kind: a.kind, id: a.id, message: `${a.kind} ${a.id} is declared for this host (${a.runsOn}, as ${a.owner}) but not trusted here, so it does not run`, remedy: trustRemedy(a.id) });
  }
  for (const entry of staleTrust(actx.host, [...actx.triggers, ...actx.schedules])) {
    result.warnings.push({ code: "automation-trust-stale", entry, message: `oats-local.yaml automations.trust names ${entry}, which is no workspace trigger or schedule${actx.snapshot ? "" : " (no automations snapshot yet: run oats sync)"}; its member may not have synced yet` });
  }
  await desktopFacts(result, discovery, lock, ctx);
  return { result, discovery, localPath: ctx.localPath };
}

/** SPIKE (read-parallel): the GitHub hosts scopeAutomations' placement would ask `gh` about (a dry pass whose gh
 *  answers nothing), each asked now without blocking. → a promise of the `cache` Map ghLogin reads. */
function startGhLogins(dep) {
  const hosts = new Set();
  scopeAutomations(dep, { io: { gh: (argv) => { const i = argv.indexOf("--hostname"); hosts.add(i < 0 ? "github.com" : argv[i + 1]); return { status: 1, stdout: "", stderr: "planned" }; } } });
  const started = [...hosts].map((h) => ghLoginStarted(h).then((who) => [h, who]));
  return Promise.all(started).then((pairs) => new Map(pairs));
}

/** The official catalog's package map (package-catalog.json; OATS_PACKAGE_CATALOG overrides). */
function catalogForStatus() {
  try { return officialPackageCatalog(); }
  catch (e) { refuse(e.code || "E_PACKAGE_MISSING", e.message); }
}

/** The committed (shared) teams as `workspace status` reports them: rows in label order (team model v2). */
function sharedTeamRows(discovery) {
  const teams = discovery.standalone === true ? {} : discovery.workspace?.teams || {};
  return Object.keys(teams).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((label) => ({ label, team: typeof teams[label]?.team === "string" ? teams[label].team : null, description: typeof teams[label]?.description === "string" ? teams[label].description : null }));
}

/** `oats workspace status` facts (feature desktop-facts): the workspace defaults as rows; this
 *  computer (member clones and the rule that found each, disabled souls, the lock); file locations with
 *  browsable urls; each catalog package's newer version, when the official catalog has one. */
async function desktopFacts(result, discovery, lock, ctx) {
  const { memberCloneOf } = await import("./member-clone.mjs");
  const defaults = discovery.standalone === true ? {} : (discovery.workspace?.defaults ?? {});
  const rows = (entries) => Object.entries(entries && typeof entries === "object" ? entries : {}).map(([name, v]) => ({ name, from: v === "off" ? null : v?.from ?? null, off: v === "off" })).sort((a, b) => (a.name < b.name ? -1 : 1));
  const slot = (d) => (d && typeof d === "object" ? Object.entries(d).map(([name, v]) => ({ name, from: v?.from ?? null }))[0] ?? null : d ?? null);
  result.defaults = {
    slots: Object.fromEntries(LAYERS.map((l) => [l, slot(defaults[l])])),
    capabilities: rows(defaults.capabilities),
  };
  result.workspace.file = discovery.standalone === true ? null : { path: "oats-workspace.yaml", url: browseUrl(discovery.key, discovery.commit, "oats-workspace.yaml") };
  for (const m of result.members) Object.assign(m, { url: browseUrl(m.key, m.commit), membershipFile: { path: "oats-membership.yaml", url: browseUrl(m.key, m.commit, "oats-membership.yaml") } });
  result.clones = result.members.map((m) => {
    try { return { key: m.key, name: m.name, ...memberCloneOf(ctx.deploymentDir, ctx.local, m.key) }; }
    catch (e) { if (e?.code === "E_CLONE_MISMATCH") return { key: m.key, name: m.name, path: null, rule: null, problem: { code: e.code, message: e.message } }; throw e; }
  });
  result.disabledSouls = [...(Array.isArray(ctx.local?.souls?.disabled) ? ctx.local.souls.disabled : [])];
  result.lock = { path: join(ctx.deploymentDir, LOCK_FILE), lockfileVersion: lock.lockfileVersion ?? null };
  const { compareSemver } = await import("./semver.mjs");
  let catalog = null; try { catalog = officialPackageCatalog(); } catch { catalog = null; }
  const cat = catalog && typeof catalog === "object" ? (catalog.packages && typeof catalog.packages === "object" && !("url" in catalog.packages) ? catalog.packages : catalog) : {};
  for (const p of result.packages) {
    const ref = p.source === `catalog:${p.id}` ? cat[p.id]?.ref : undefined;
    const tag = standaloneCatalogVersion(ref);
    const version = tag ? tag.replace(/^v/, "") : null;
    p.latest = version && typeof p.version === "string" && compareSemver(version, p.version) > 0 ? { version, ref } : null;
  }
}

/** The package requests of a standalone view: the catalog's own pin of the package
 *  providing oats.core (decision 25) — nothing else, since the version list lives in
 *  the workspace file we cannot read. The request is written as resolvePackages
 *  expects a CATALOG entry: the bare version (`v1.1.3`), never the catalog's raw ref
 *  (`oats-framework/v1.1.3` is a tag PATH the one grammar refuses); parsePackageRequest
 *  recomposes the tag from the catalog's own convention.
 *  → { packages: { <id>: <version> }, problems: [ { code: "E_PACKAGE_MISSING", … } ] } */
export function standalonePackages(catalog) {
  let id = "oats.framework";
  const file = officialCatalogFile();
  try { const alias = officialCapabilityAliases()["oats.core"]; id = (typeof alias === "string" ? alias : alias?.package) ?? id; } catch { /* the catalog is diagnosed below */ }
  const version = standaloneCatalogVersion(catalog?.[id]?.ref);
  if (version) return { packages: { [id]: version }, problems: [] };
  const why = catalog?.[id] ? `its ref ${JSON.stringify(catalog[id].ref)} carries no version` : `it has no entry ${JSON.stringify(id)}`;
  return { packages: {}, problems: [{ code: "E_PACKAGE_MISSING", id, reason: "no-catalog", catalog: file, path: `/packages/${id}`, message: `the catalog has no package providing oats.core (OATS_PACKAGE_CATALOG=${file}): ${why}; standalone spawns will be refused until it does` }] };
}
/** The bare version of a catalog ref: its LAST path segment when that is a version
 *  (`v1.1.3` → `v1.1.3`; `oats-framework/v1.1.3` → `v1.1.3`; `main` → null). */
export function standaloneCatalogVersion(ref) {
  if (typeof ref !== "string" || !ref.trim()) return null;
  const tail = ref.trim().split("/").filter(Boolean).pop() ?? "";
  return classifyPackageValue(tail).kind === "catalog" ? tail : null;
}

/** Display name of a discovery: the workspace's name, or the standalone label (decision 10). */
export const workspaceName = (discovery) => discovery.workspace?.name ?? `standalone:${memberLabel(discovery.key)}`;
export const memberLabel = (key) => String(key).split("/").filter(Boolean).pop()?.replace(/\.git$/, "") || String(key);

/** Membership rows for `sync` / `workspace status`. */
export function memberRows(discovery) {
  return discovery.members.map((m) => ({
    key: m.key, name: memberLabel(m.key), commit: m.commit ?? null, confirmed: m.confirmed, status: m.confirmed ? "confirmed" : m.reason, detail: m.detail ?? null,
    souls: m.souls.map((s) => s.name), capabilities: m.capabilities.map((c) => c.name), publishes: m.publishes ?? null,
  }));
}

/** Package rows for `sync` / `workspace status` from the lock. */
export function packageRows(lock) {
  return Object.entries(lock.packages).map(([id, p]) => ({ id, version: p.version, source: p.source, commit: p.commit, integrity: p.integrity, capabilities: p.capabilities, souls: (p.souls ?? []).map((x) => x.name) }));
}
