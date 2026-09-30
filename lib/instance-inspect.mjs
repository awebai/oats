/** inspect / readiness / operation targets on the workspace model (lead decision 4).
 *
 * A TARGET is what the answer is about, read from the workspace model's own
 * records and never from the classic config chain:
 *   - an instance (`--home`): its instance.json (modules, providers = the merged
 *     payloads, workspace, soulDir, policy) and its materialized module copies;
 *   - a soul (`--soul`): its resolution (prepareInstance → modules, payloads,
 *     slots), the discovery it came from, and its declarations.
 * The integers are the contract: inspect `operationsApi: 2` with `soulsApi: 2`
 * soul rows, readiness `readinessApi: 2`. Payloads carry no scope chain, team
 * block or config levels, and there is no `trusted` check: declaring a package
 * in `packages:` is the trust decision. */
import { spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { capabilityManifests, sessionDefaults, homeLaunchLayers, instanceSoulDir, launchConfigsAt, launchReportFor, manifestOperations, parseYamlNested, servedIdentityOf, teamEnv, upgradeHomeMeta, withConfigFile } from "./core.mjs";
import { agentDirOf, discoverOrStandalone, ensureWorkspaceSoul, findSoulEntry, liveTeams, prepareInstance } from "./instance-resolution.mjs";
import { declaredSettings } from "./capability-contract.mjs";
import { kernelCompatibility } from "./resolve.mjs";
import { recordedTeams, reportRows, soulKeyOf, soulTeams, teamModel, teamProblems } from "./teams.mjs";
import { launchLayers, launchReport } from "./launch-preference.mjs";
import { loadLocal } from "./workspace.mjs";
import { ensureModuleTree } from "./operator-dispatch.mjs";
/** Bounds of a provider check's answer (bytes, nesting, entries), as the released binding wire set them. */
const BINDING_LIMITS = Object.freeze({ maxBytes: 1024 * 1024, maxDepth: 32, maxEntries: 16384 });
import { parseStrictJson } from "./canonical-json.mjs";

export const INSPECT_OPERATIONS_API = 2;
export const SOULS_API = 2;
export const READINESS_API = 2;
const LAYERS = ["knowledge", "messaging", "tasks"];
const CLI_BIN = fileURLToPath(new URL("../bin/oats.mjs", import.meta.url));
const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

/** A resolution refusal that is a readiness FACT (the soul cannot resolve as the
 *  lock stands), not a failure to answer: reported as a failing `installed` item. */
export const RESOLUTION_FACTS = new Set(["E_PACKAGE_MISSING", "E_PACKAGE_INTEGRITY", "E_CAPABILITY_MISSING", "E_LOCK_SCHEMA", "E_REQUIREMENT_INACTIVE", "E_TEAM_UNKNOWN", "E_TEAM_NOT_ELIGIBLE"]);
/** A resolution refusal that readiness reports as a team item (checks.configured), not an install failure. */
const TEAM_FACTS = new Set(["E_TEAM_UNKNOWN", "E_TEAM_NOT_ELIGIBLE"]);

/** Is `name` an executable on PATH? (manifest `requires`, no shell). */
function onPath(name) {
  if (typeof name !== "string" || !name || name.includes("/")) return false;
  for (const dir of String(process.env.PATH || "").split(delimiter)) {
    if (!dir) continue;
    try { accessSync(join(dir, name), fsConstants.X_OK); if (statSync(join(dir, name)).isFile()) return true; } catch { /* next */ }
  }
  return false;
}
const manifestRequires = (manifest) => (Array.isArray(manifest?.requires) ? manifest.requires : [])
  .filter((r) => obj(r) && typeof r.command === "string" && r.command)
  .map((r) => ({ command: r.command, why: r.why || null, install: r.install || null }));
const missingRequires = (manifest) => manifestRequires(manifest).filter((r) => !onPath(r.command));

/** A soul's own declarations, parsed by the kernel (never by a consumer). */
function declarationsOf(definition) {
  const d = obj(definition) ? definition : {};
  const section = (key) => (d[key] === undefined ? null : d[key]);
  return { requires: section("requires"), defaults: section("defaults"), knowledge: section("knowledge"), resources: section("resources"), children: section("children"), capabilities: section("capabilities") };
}
function readSoulYaml(soulDir) {
  const file = soulDir && join(soulDir, "soul.yaml");
  if (!file || !existsSync(file)) return { definition: null, problems: [] };
  try { return { definition: withConfigFile(file, () => parseYamlNested(readFileSync(file, "utf8"))), problems: [] }; }
  catch (e) { return { definition: null, problems: [{ code: "soul-declarations-unreadable", message: e.message }] }; }
}
function readTextCapped(file, cap = 200_000) {
  try { const text = readFileSync(file, "utf8"); return { file, text: text.length > cap ? text.slice(0, cap) : text, truncated: text.length > cap }; }
  catch { return { file, text: null, truncated: false }; }
}

/** The instance target: `home` is absolute and holds instance.json with modules.
 *  `teams` / `defaultTeam` are the home's LIVE teams (team model v2), read from this target's
 *  discovery when it discovers, else by liveTeams; `teamsSource` says which ("live" |
 *  "recorded": the spawn-time record, when the workspace cannot answer now).
 *  `live: false` skips the live read — a caller that never hands the teams to the
 *  messaging provider (a non-messaging operation) gets the record at no remote cost. */
export async function homeTarget(home, meta, { remoteOptions, discover = true, live: readLive = true } = {}) {
  const realHome = real(home);
  meta = upgradeHomeMeta(meta, realHome);
  // Only the home's own module copies: without <home>/.oats/modules the kernel's
  // manifest lookup would fall through to a classic config chain — never here.
  let manifests = {}; const loadProblems = [];
  if (existsSync(join(realHome, ".oats", "modules"))) {
    try { manifests = capabilityManifests(realHome); } catch (e) { loadProblems.push({ code: "module-manifest-invalid", message: e.message }); }
  }
  const modules = obj(meta.modules) ? meta.modules : {};
  const agentsRoot = dirname(dirname(dirname(realHome)));
  const deployment = dirname(agentsRoot);
  const ws = obj(meta.workspace) ? meta.workspace : {};
  const soulDir = instanceSoulDir(realHome, meta) ?? null;
  const { definition, problems } = readSoulYaml(soulDir);
  let discovery = null, discoveryError = null, local = null;
  if (discover) {
    try {
      // The derived deployment exactly — never an oats-local.yaml found further up.
      const found = loadLocal(deployment);
      if (real(dirname(found.path)) !== real(deployment)) throw Object.assign(new Error(`${deployment} has no oats-local.yaml`), { code: "E_HOME_MISMATCH" });
      local = found.local;
      discovery = await discoverOrStandalone(found.local, { deployment, remoteOptions });
    }
    catch (e) { discoveryError = { code: e.code || "E_REMOTE_UNREADABLE", message: e.message }; }
  }
  // External or member soul: spawn records the soul's repoKey, not its kind, so the
  // kind is observed (readiness discovers); null when not observed (inspect --home).
  let external = null;
  if (discovery) {
    try { const e = findSoulEntry(discovery, meta.agent); if (e.repoKey === ws.soul?.repoKey) external = e.external === true; } catch { /* no longer declared */ }
    if (external === null && (discovery.members || []).some((m) => m.key === ws.soul?.repoKey)) external = false;
  }
  const slots = Object.fromEntries(LAYERS.map((l) => [l, Object.keys(modules).find((n) => manifests[n]?.layer === l) ?? null]));
  // The home's soul key (souls.teams / souls.default): its name, or <package>/<soul> for a package soul.
  const teamKey = ws.soul?.package && typeof ws.soul.qualifiedName === "string" ? ws.soul.qualifiedName : meta.agent;
  let live, model = null;
  if (discovery) {
    model = teamModel(discovery.standalone === true ? null : discovery.workspace, local, { workspaceKey: discovery.key ?? null });
    try { const t = soulTeams(model, teamKey); live = { teams: reportRows(t.teams), defaultTeam: t.defaultTeam, source: "live" }; }
    catch (e) { if (!String(e?.code).startsWith("E_TEAM_")) throw e; live = { ...recordedTeams(meta), source: "recorded" }; }
  } else if (readLive) live = await liveTeams(realHome, meta, { remoteOptions });
  else live = { ...recordedTeams(meta), source: "recorded" };
  // Feature launch-preference: the recorded launch (frozen), and what --reselect-launch would choose now —
  // from the home's recorded soul and this deployment's oats-local.yaml (null when it cannot be read).
  const launch = recordedLaunch(meta);
  let launchCurrent = null;
  try { launchCurrent = launchReportFor({ layers: homeLaunchLayers(realHome, meta), launchConfigs: launchConfigsAt(deployment), contextDir: deployment }); }
  catch { launchCurrent = null; }
  return {
    kind: "instance", home: realHome, meta, deployment, agentsRoot, teams: live.teams, defaultTeam: live.defaultTeam ?? null, teamsSource: live.source, launch, launchCurrent, session: newSessionDefaults(deployment),
    recordedDefaultTeam: recordedTeams(meta).defaultTeam, teamModel: model, teamKey,
    subject: { kind: "instance", instance: meta.instance, home, soul: meta.agent },
    soul: { name: meta.agent, repoKey: ws.soul?.repoKey ?? null, commit: ws.soul?.commit ?? null, external, path: null, soulDir, definition, problems: [...problems, ...loadProblems] },
    workspace: { key: ws.key ?? null, name: typeof ws.name === "string" ? ws.name : discovery?.workspace?.name ?? null, deployment, commit: ws.commit ?? null, standalone: ws.standalone === true },
    modules: Object.keys(modules).sort().map((name) => ({ name, from: modules[name]?.from ?? null, manifest: manifests[name] ?? null, dir: join(realHome, ".oats", "modules", name) })),
    payloads: obj(meta.providers) ? meta.providers : {},
    payloadOrigins: Object.fromEntries((Array.isArray(meta.capabilities) ? meta.capabilities : []).filter((c) => c && typeof c.id === "string").map((c) => [c.id, obj(c.settingsOrigins) ? c.settingsOrigins : {}])),
    slots, slotsFrom: Object.fromEntries(LAYERS.map((l) => [l, obj(ws.layers?.[l]) ? ws.layers[l].from ?? null : null])), discovery, discoveryError, resolutionError: null,
    lock: null, prepared: null,
  };
}

/** The soul target, resolved exactly as a spawn of `soul` would be. A resolution
 *  refusal that is a readiness fact is kept as `resolutionError` (callers that
 *  must answer — inspect, operation run — refuse with it). */
export async function soulTarget(contextDir, soul, { remoteOptions } = {}) {
  let prepared = null, resolutionError = null;
  try { prepared = await prepareInstance(contextDir, soul, { remoteOptions }); }
  catch (e) {
    if (!RESOLUTION_FACTS.has(e?.code)) throw e;
    resolutionError = { code: e.code, message: e.message, details: e.details ?? null };
  }
  const found = loadLocal(contextDir);
  const deployment = real(prepared?.deployment ?? (found.path ? dirname(found.path) : resolve(contextDir)));
  let discovery = prepared?.discovery ?? null, soulEntry = prepared?.soulEntry ?? null;
  if (!prepared) {
    // Still name the soul (and its member) when its resolution is refused.
    discovery = await discoverOrStandalone(found.local, { deployment, remoteOptions });
    soulEntry = findSoulEntry(discovery, soul);
  }
  const res = prepared?.resolution;
  // A refused resolution still names the soul's teams when they resolve (a package refusal, …); a
  // refusal of the teams themselves (E_TEAM_UNKNOWN / E_TEAM_NOT_ELIGIBLE) names none.
  const model = teamModel(discovery?.standalone === true ? null : discovery?.workspace ?? null, prepared?.local ?? found.local, { workspaceKey: discovery?.key ?? null });
  const teamKey = soulKeyOf(soulEntry);
  let teams = res?.teams ?? null, defaultTeam = res ? res.defaultTeam ?? null : null;
  if (!res) { try { const t = soulTeams(model, teamKey); teams = reportRows(t.teams); defaultTeam = t.defaultTeam; } catch (e) { if (!String(e?.code).startsWith("E_TEAM_")) throw e; } }
  // The soul being asked about is materialised as a spawn would (ensureWorkspaceSoul: idempotent per
  // commit, never touching a directory an instance links), so its checks always get OATS_SOUL; only a
  // spawn wrote the per-commit copy before, and a provider asked about a soul not yet spawned at this
  // commit answered a false negative. A failure is a readiness fact (soulCopyError), never a silent null.
  // A refused resolution has nothing to materialise: the cached copy, when there is one.
  let soulDir = null, soulCopyError = null;
  if (prepared) {
    try { soulDir = await ensureWorkspaceSoul(prepared, join(deployment, "agents")); }
    catch (e) { soulCopyError = { code: e?.code || "E_SOUL_COPY_FAILED", message: e?.message || String(e) }; }
  } else {
    const cached = soulEntry?.commit ? join(deployment, "agents", agentDirOf(soulEntry), "souls", String(soulEntry.commit).slice(0, 12)) : null;
    soulDir = cached && existsSync(join(cached, "soul.yaml")) ? cached : null;
  }
  // Feature launch-preference: what a spawn with no flags would launch here.
  let launchConfigs = {};
  try { launchConfigs = launchConfigsAt(deployment); } catch { launchConfigs = {}; }
  const launch = launchReportFor({ layers: prepared?.launch ?? launchLayers({ definition: soulEntry.definition, entry: soulEntry, key: teamKey, local: found.local }), launchConfigs, contextDir: deployment });
  return {
    kind: "soul", home: null, meta: null, deployment, agentsRoot: join(deployment, "agents"), teams, defaultTeam, teamsSource: "live", teamModel: model, teamKey, launch, session: newSessionDefaults(deployment),
    subject: { kind: "soul", soul: soulEntry.name, repoKey: soulEntry.repoKey ?? null, commit: soulEntry.commit ?? null },
    soul: { name: soulEntry.name, repoKey: soulEntry.repoKey ?? null, commit: soulEntry.commit ?? null, external: soulEntry.external === true, path: soulEntry.path ?? null,
      soulDir, definition: soulEntry.definition ?? null, problems: [], ...(soulCopyError ? { copyError: soulCopyError } : {}) },
    workspace: { key: discovery?.key ?? null, name: discovery?.workspace?.name ?? null, deployment, commit: discovery?.commit ?? null, standalone: discovery?.standalone === true },
    modules: (res?.modules || []).map((m) => ({ name: m.name, from: m.from ?? null, manifest: m.manifest ?? null, dir: null, module: m })).sort((a, b) => a.name.localeCompare(b.name)),
    payloads: obj(res?.payloads) ? res.payloads : {}, payloadOrigins: obj(res?.payloadOrigins) ? res.payloadOrigins : {}, slots: obj(res?.slots) ? res.slots : Object.fromEntries(LAYERS.map((l) => [l, null])), slotsFrom: obj(res?.slotsFrom) ? res.slotsFrom : {},
    capabilitiesFrom: obj(res?.capabilitiesFrom) ? res.capabilitiesFrom : {}, turnedOff: Array.isArray(res?.turnedOff) ? res.turnedOff : [],
    discovery, discoveryError: null, resolutionError, lock: prepared?.lock ?? null, prepared,
  };
}

/** The tmux session a NEW tmux spawn here would open in ({tmuxSession}, 0.31); null when the
 *  deployment's oats-local.yaml cannot be read. */
function newSessionDefaults(deployment) {
  try { return sessionDefaults(deployment); } catch { return null; }
}

/** Is `dir` a v2 context (an oats-local.yaml in reach)? Only a MISSING file means
 *  "not a workspace"; an unreadable or invalid one is the caller's error to report,
 *  never a silent fallback to the classic chain. */
export function isWorkspaceContext(dir) {
  try { loadLocal(dir); return true; }
  catch (e) { if (e?.code === "E_LOCAL_MISSING") return false; throw e; }
}

/** The module's own kernel range against the running kernel: `{ ok, range, kernel }`; an
 *  unparseable range is not ok. A soul's resolution already refuses an incompatible module, so
 *  `ok: false` shows only for a home whose spawned module no longer admits this kernel. */
function compatibilityRow(name, manifest) {
  try { return kernelCompatibility({ ...manifest, capability: name }); }
  catch (e) { if (e?.code === "E_CAPABILITY_INCOMPATIBLE") return { ok: false, range: e.details?.range ?? null, kernel: e.details?.kernel ?? null }; throw e; }
}
function capabilityRows(t) {
  return t.modules.map(({ name, from, manifest, dir }) => {
    const m = manifest || {};
    const missing = missingRequires(m);
    const operations = manifestOperations(m).map((op) => {
      let reason = null;
      if (missing.length) reason = `${name} requires ${missing.map((x) => `"${x.command}" on PATH${x.why ? ` (${x.why})` : ""}`).join(", ")}`;
      else if (op.context === "home" && !t.home) reason = "needs a running home (--home)";
      return { ...op, argv: [m.command ?? null, op.command], available: !reason, reason };
    });
    // composedFrom (feature desktop-facts): where the soul's composition took it from — "workspace" |
    // "soul" (layers-from vocabulary); null for a home (not recorded at spawn). `from` is the module's origin.
    return { id: name, version: m.version ?? null, layer: m.layer ?? null, command: m.command ?? null, from, composedFrom: t.capabilitiesFrom?.[name] ?? null, dir,
      settings: obj(t.payloads[name]) ? t.payloads[name] : {}, declares: declaredSettings(m), compatibility: compatibilityRow(name, m), missingRequires: missing, operations };
  });
}
function soulRow(t) {
  const s = t.soul, def = obj(s.definition) ? s.definition : {};
  return { soulsApi: SOULS_API, name: s.name, repoKey: s.repoKey, commit: s.commit, kind: s.external === true ? "external" : s.external === false ? "member" : null, path: s.path,
    description: def.description ?? null, work: def.work ?? null, harness: def.harness ?? null, model: def.model ?? null,
    declarations: declarationsOf(s.definition), declarationProblems: s.problems,
    instructions: s.soulDir ? readTextCapped(join(s.soulDir, "AGENTS.md")) : null };
}

/** `oats inspect --json` on the workspace model. */
export function inspectDocument(t, { kernel }) {
  const capabilities = capabilityRows(t);
  // `from` (feature layers-from): where the slot's capability came from; null for an empty slot, and for a
  // home spawned before the kernel recorded it.
  const layers = Object.fromEntries(LAYERS.map((l) => [l, { id: t.slots[l] ?? null, from: t.slots[l] ? t.slotsFrom?.[l] ?? null : null }]));
  const kcap = layers.knowledge.id ? capabilities.find((c) => c.id === layers.knowledge.id) : null;
  const m = t.meta;
  return {
    operationsApi: INSPECT_OPERATIONS_API, kernel, subject: t.subject, workspace: t.workspace,
    souls: [soulRow(t)], layers, capabilities,
    // The capabilities the soul turned off (feature desktop-facts): its `off` over a workspace/team entry
    // (reason "off"), or a `<slot>: none` that dropped a workspace default (reason "slot-none", slot).
    capabilitiesOff: (t.turnedOff || []).map(({ name, reason, slot, overrides }) => ({ id: name, off: true, from: "soul", reason, ...(slot ? { slot } : {}), overrides })),
    // Team model v2 (feature team-model-2): the soul's teams here and its default — live for a home
    // (`teamsSource: "recorded"` when its workspace could not be read now), which also answers the
    // default it was spawned with.
    teams: t.teams ?? null, defaultTeam: t.defaultTeam ?? null, teamsSource: t.teamsSource ?? null,
    ...(t.home ? { recordedDefaultTeam: t.recordedDefaultTeam ?? null } : {}),
    // Feature launch-preference: a soul's launch here; a home's recorded launch and launchCurrent.
    launch: t.launch ?? null,
    ...(t.home ? { launchCurrent: t.launchCurrent ?? null } : {}),
    // What a new tmux spawn here would open in: {tmuxSession} (0.31).
    session: t.session ?? null,
    knowledge: kcap ? { provider: kcap.id, version: kcap.version, operations: kcap.operations.map((o) => ({ name: o.name, kind: o.kind, available: o.available, reason: o.reason })) } : { provider: null, version: null, operations: [] },
    instance: m ? { home: t.home, instance: m.instance, agent: m.agent, harness: m.harness || null, model: m.model ?? null, yolo: m.yolo ?? null,
      launchConfig: m.launch?.launchConfig ?? null, launchConfigDefault: m.launch?.launchConfigDefault === true, launched: !!m.launched, createdAt: m.createdAt || null,
      resolution: m.workspace?.resolution ?? null, soulDir: t.soul.soulDir, instructions: { ...readTextCapped(join(t.home, "AGENTS.md")), sources: m.instructions || [] } } : null,
    ...(m ? { identity: servedIdentityOf(m) } : {}),
    problems: [...t.soul.problems, ...(t.soul.copyError ? [t.soul.copyError] : []), ...(t.discoveryError ? [t.discoveryError] : []),
      ...t.modules.filter((x) => !x.manifest).map((x) => ({ code: "module-missing", message: `${x.name} is recorded but its module copy has no readable oats.json`, capability: x.name })),
      ...capabilities.filter((c) => !c.compatibility.ok).map((c) => ({ code: "capability-incompatible", message: `${c.id} requires oats ${c.compatibility.range}; this kernel is ${c.compatibility.kernel} (re-spawn from the deployment with a release whose range admits it)`, capability: c.id, range: c.compatibility.range, kernel: c.compatibility.kernel }))],
  };
}

// ---------- readiness ----------
/** The soul's team problems as readiness items in `checks.configured` (team model v2; no fifth check:
 *  released Desktops recompute the summary from the four). A failure blocks `ready`; a warning is
 *  `required: false`. A home also compares its spawn-time default with the live one. */
function teamItems(t) {
  if (!t.teamModel) return [];
  const problems = teamProblems(t.teamModel, { key: t.teamKey, messaging: !!t.slots?.messaging });
  const same = (a, b) => (a?.label ?? null) === (b?.label ?? null) && (a?.team ?? null) === (b?.team ?? null);
  if (t.home && t.teamsSource === "live" && t.meta?.defaultTeam !== undefined && !same(t.recordedDefaultTeam, t.defaultTeam)) {
    problems.push({ code: "default-team-changed", severity: "warning", recorded: t.recordedDefaultTeam, current: t.defaultTeam,
      message: `this instance was spawned in ${t.recordedDefaultTeam?.label ?? "no default team"}; the default is now ${t.defaultTeam?.label ?? "none"}`, fix: "respawn" });
  }
  return problems.map(({ code, severity, message, fix, ...rest }) => item(rest.label ? `team ${rest.label}` : "teams", "fail",
    { required: severity === "failure", producer: "team model", code, reason: message, remedy: fix, ...rest }));
}
/** The home's recorded launch as a `Launch` (from instance.json; `from: "recorded"` for a home from before 0.30). */
function recordedLaunch(meta) {
  const recipe = obj(meta?.launch) ? meta.launch : {};
  return launchReport({ declared: obj(meta?.launchDeclared) ? meta.launchDeclared : null, harness: meta?.harness || recipe.harness || null, model: meta?.model || null,
    launchConfig: recipe.launchConfig ?? null, from: typeof meta?.launchFrom === "string" ? meta.launchFrom : "recorded", at: meta?.launchAt ?? null });
}
/** `launch-changed` (feature launch-preference; `--home` only): a home whose launch a LAYER chose (not explicit
 *  flags, not a pre-0.30 record) now reads a different launch from the layers. A warning: the home keeps its
 *  recorded launch until `--reselect-launch` or a respawn. */
function launchItems(t) {
  if (!t.home || !t.launch || !t.launchCurrent || !["local", "local-default", "soul", "host"].includes(t.launch.from)) return [];
  const a = t.launch.effective, b = t.launchCurrent.effective;
  if (a.harness === b.harness && a.model === b.model && a.launchConfig === b.launchConfig) return [];
  const show = (e) => `${e.harness ?? "?"}${e.model ? ` ${e.model}` : ""}${e.launchConfig ? ` (launch configuration ${e.launchConfig})` : ""}`;
  return [item("launch", "fail", { required: false, producer: "launch preference", code: "launch-changed",
    reason: `this instance runs ${show(a)}; its launch preference now says ${show(b)} (${t.launchCurrent.at ?? t.launchCurrent.from})`,
    remedy: "`oats session restart --reselect-launch`, or respawn", recorded: a, current: b, from: t.launchCurrent.from, at: t.launchCurrent.at })];
}
function roll(items) {
  const req = items.filter((i) => i.required !== false);
  if (!items.length) return "not-applicable";
  if (req.some((i) => i.status === "fail")) return "fail";
  if (req.some((i) => i.status === "unknown")) return "unknown";
  return req.length ? "pass" : "not-applicable";
}
const item = (subject, status, { required = true, reason = null, producer = "kernel", evidence = null, remedy = null, ...rest } = {}) => ({ subject, status, required, reason, producer, evidence, remedy, ...rest });

/** The team/workspace facts a provider receives, as hooks get them (teamEnv). */
function providerEnv(t, capability, settings) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(OATS_|OAS_|PI_)/.test(k)));
  Object.assign(env, teamEnv({ workspace: { key: t.workspace.key, name: t.workspace.name, deployment: t.deployment }, teams: t.teams, defaultTeam: t.defaultTeam, teamsSource: t.teamsSource }));
  return Object.assign(env, { OATS_CAPABILITY: capability, OATS_SETTINGS: JSON.stringify(settings), OATS_SETTINGS_ORIGINS: JSON.stringify(t.payloadOrigins?.[capability] ?? {}), OATS_CLI_BIN: CLI_BIN, OATS_WORKSPACE: t.deployment,
    ...(t.home ? { OATS_INSTANCE: t.meta.instance, OATS_INSTANCE_HOME: t.home } : {}), OATS_AGENT: t.soul.name, ...(t.soul.soulDir ? { OATS_SOUL: t.soul.soulDir } : {}) });
}
/** An executable inside a module directory: both sides realpath'd (a symlink out of
 *  the module is an escape, as for the kernel's manifestPath), a regular file. */
function moduleExecutable(dir, script) {
  let root, file;
  try { root = realpathSync(dir); file = realpathSync(resolve(dir, script)); } catch { return null; }
  const rel = relative(root, file);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  try { return statSync(file).isFile() ? file : null; } catch { return null; }
}
/** The four check statuses of the binding wire, and what each means for readiness. */
const PROVIDER_STATUS_ITEM = Object.freeze({ ready: "pass", "needs-configuration": "fail", "authorization-required": "fail", unavailable: "unknown" });
const ENVELOPE_KEYS = ["schemaVersion", "phase", "slot", "capability", "ok"];
function validProblems(p) { return Array.isArray(p) && p.every((x) => obj(x) && typeof x.code === "string" && typeof x.message === "string"); }
const codeMessages = (p) => p.map((x) => ({ code: x.code, message: x.message }));
/** Run one provider's binding check. → { outcome: "result", result: {status, problems,
 *  warnings} } verbatim, or `unknown` with the provider's own refusal (never a kernel
 *  invention). The answer is decoded by the released binding wire's response rules:
 *  exit 0, exactly one strict JSON
 *  document within BINDING_LIMITS, the exact envelope echoing schemaVersion/phase/
 *  slot/capability, one of the four statuses, and no problems on `ready`. Problem codes
 *  are the provider's own (not checked against binding.reasons, which are refusal
 *  sentences); problems and the optional warnings must be {code, message} strings. */
export function runProviderCheck(t, mod, dir, { timeoutMs = 30000 } = {}) {
  const m = mod.manifest, check = m?.binding?.check, spec = check ? m.commands?.[check] : null;
  const unavailable = (code, message) => ({ outcome: "unknown", problems: [{ code, message }] });
  if (typeof spec !== "string" || !spec.trim()) return unavailable("provider-not-qualified", `${mod.name} declares binding.check but no command ${JSON.stringify(check)}`);
  const [script, ...args] = spec.trim().split(/\s+/);
  const file = dir ? moduleExecutable(dir, script) : null;
  if (!file) return unavailable("resource-not-found", `${mod.name}: the check executable ${script} is unavailable`);
  const settings = obj(t.payloads[mod.name]) ? t.payloads[mod.name] : {};
  // The released binding wire, key for key: providers decode it strictly (oats.aweb 1.13.1
  // refuses any other key). The teams reach the check through its environment
  // (OATS_DEFAULT_TEAM* / OATS_TEAMS / OATS_TEAMS_SOURCE, providerEnv), never on stdin.
  const request = { schemaVersion: 1, phase: "check", slot: m.layer ?? null, capability: mod.name, settings,
    input: { context: { kind: "workspace", workspace: t.workspace.key, deployment: t.deployment, soul: t.soul.name, instance: t.meta?.instance ?? null, home: t.home }, action: { kind: "readiness" } } };
  // The environment is providerEnv's: ambient OATS_/OAS_/PI_ identity removed, the rest
  // inherited.
  const r = spawnSync(process.execPath, [file, ...args], { cwd: dir, env: providerEnv(t, mod.name, settings), input: JSON.stringify(request), encoding: "utf8", timeout: Math.max(1, timeoutMs), killSignal: "SIGKILL", maxBuffer: BINDING_LIMITS.maxBytes, stdio: ["pipe", "pipe", "pipe"] });
  if (r.error || r.signal) return unavailable("provider-unavailable", `${mod.name} check did not complete${r.error?.code === "ETIMEDOUT" || r.signal ? " in time" : ""}`);
  if (r.status !== 0) return unavailable("provider-unavailable", `${mod.name} check exited ${r.status}`);
  const invalid = () => unavailable("provider-unavailable", `${mod.name} check answered invalid binding data`);
  let doc;
  try {
    doc = parseStrictJson(r.stdout || "", BINDING_LIMITS);
    if (!obj(doc)) return invalid();
    const allowed = [...ENVELOPE_KEYS, doc.ok === true ? "result" : "error"];
    if (Object.keys(doc).some((k) => !allowed.includes(k)) || allowed.some((k) => !Object.hasOwn(doc, k))) return invalid();
    for (const key of ["schemaVersion", "phase", "slot", "capability"]) if (doc[key] !== request[key]) return invalid();
  } catch { return invalid(); }
  if (doc.ok === false) {
    const e = doc.error;
    if (!obj(e) || typeof e.code !== "string" || (e.message !== undefined && typeof e.message !== "string")) return invalid();
    return unavailable(e.code, e.message ?? `${mod.name} refused the check`);
  }
  const res = doc.result;
  if (doc.ok !== true || !obj(res) || Object.keys(res).some((k) => !["status", "problems", "warnings"].includes(k))
    || !Object.hasOwn(PROVIDER_STATUS_ITEM, res.status) || !validProblems(res.problems)
    // `warnings` is optional (absent → []), validated as strictly as problems, and never
    // changes the status (e.g. a ready binding with end-to-end encryption disabled).
    || (res.warnings !== undefined && !validProblems(res.warnings))
    || (res.status === "ready" && res.problems.length)) return invalid();
  return { outcome: "result", result: { status: res.status, problems: codeMessages(res.problems), warnings: codeMessages(res.warnings ?? []) } };
}
/** The total time the providers check may take in one readiness read. */
export const PROVIDER_CHECK_BUDGET_MS = 60_000;

/** `oats readiness --json` on the workspace model. */
export async function readinessDocument(t, { selector = null, remoteOptions, catalog = null, budgetMs = PROVIDER_CHECK_BUDGET_MS } = {}) {
  const installed = [], configured = [], member = [], providers = [];
  const cap = (id) => ({ capability: { id } });
  if (t.resolutionError && !TEAM_FACTS.has(t.resolutionError.code)) {
    installed.push(item(t.soul.name, "fail", { producer: "workspace resolution", code: t.resolutionError.code, reason: t.resolutionError.message, evidence: t.resolutionError.details, remedy: "oats sync (the lock must provide every package capability the soul resolves)" }));
  }
  if (t.soul.copyError) {
    installed.push(item(`soul ${t.soul.name}`, "fail", { producer: "soul copy", code: t.soul.copyError.code, reason: `the soul could not be copied into ${join(t.agentsRoot, "…", "souls")}: ${t.soul.copyError.message}`,
      evidence: { repoKey: t.soul.repoKey, commit: t.soul.commit }, remedy: "check access to the soul's repository at the locked commit (oats sync), then retry" }));
  }
  for (const mod of t.modules) {
    const present = t.home ? existsSync(join(mod.dir, "oats.json")) && !!mod.manifest : !!mod.manifest;
    installed.push(item(mod.name, present ? "pass" : "fail", { producer: t.home ? "instance modules" : "workspace resolution", evidence: { from: mod.from },
      reason: present ? null : "the module copy is missing from the home", remedy: present ? null : "spawn a new instance of this soul", ...cap(mod.name) }));
    for (const req of manifestRequires(mod.manifest)) {
      const found = onPath(req.command);
      configured.push(item(`${mod.name} requires ${req.command}`, found ? "pass" : "fail", { producer: "capability manifest", reason: found ? null : req.why || "required command not on PATH",
        evidence: { command: req.command }, remedy: found ? null : req.install, ...cap(mod.name) }));
    }
  }
  configured.push(...teamItems(t), ...launchItems(t));
  // member — the soul's member repository is a confirmed member of the workspace
  // (oats-membership.yaml backlink observed over the remotes).
  const d = t.discovery;
  if (t.soul.external) member.push(item(`soul ${t.soul.name}`, "not-applicable", { required: false, producer: "workspace discovery", reason: "an external soul is declared by the workspace; it has no member repository", evidence: { repoKey: t.soul.repoKey } }));
  else if (!d) member.push(item(`member ${t.soul.repoKey ?? "?"}`, "unknown", { producer: "workspace discovery", reason: t.discoveryError ? `the workspace could not be read: ${t.discoveryError.message}` : "no workspace observation", evidence: { repoKey: t.soul.repoKey } }));
  // A standalone view is an allowed mode (decision 10): membership cannot be confirmed
  // there by definition, so it is not a readiness requirement (as for an external soul).
  else if (d.standalone === true) member.push(item(`member ${t.soul.repoKey}`, "not-applicable", { required: false, producer: "workspace discovery", reason: `standalone view (${d.standaloneReason ?? "explicit"}): the workspace this repository declares is not read, so its membership is declared, not confirmed`, evidence: { repoKey: t.soul.repoKey, workspace: d.key, standaloneReason: d.standaloneReason ?? null } }));
  else {
    const row = (d.members || []).find((x) => x.key === t.soul.repoKey);
    member.push(item(`member ${t.soul.repoKey}`, row?.confirmed ? "pass" : "fail", { producer: "workspace discovery",
      reason: row?.confirmed ? null : row ? `not confirmed: ${row.reason ?? "unconfirmed"}${row.detail ? ` (${row.detail})` : ""}` : "not a member of the workspace",
      evidence: { repoKey: t.soul.repoKey, workspace: d.key, commit: row?.commit ?? null },
      remedy: row?.confirmed ? null : "the member repository must carry oats-membership.yaml naming this workspace, and the workspace must list it in members:" }));
  }
  // providers — each bound provider's own binding check, verbatim, within one total budget.
  const deadline = Date.now() + budgetMs;
  for (const mod of t.modules) {
    if (!obj(mod.manifest?.binding)) continue;
    let dir = t.home ? mod.dir : null, pre = null;
    if (Date.now() >= deadline) pre = { code: "time-budget-exhausted", message: `time budget exhausted: the providers check stops after ${Math.round(budgetMs / 1000)} s per readiness read` };
    if (!pre && !dir && mod.module && t.lock) { try { dir = await ensureModuleTree(t.deployment, mod.module, t.lock, { catalog, remoteOptions }); } catch (e) { pre = { code: e.code || "provider-unavailable", message: e.message }; } }
    if (!dir && !pre && mod.module?.from?.kind === "member") pre = { code: "resource-not-found", message: `${mod.name}: a member module runs from a spawned home; inspect an instance (--home) for its check` };
    const out = pre ? { outcome: "unknown", problems: [pre] } : runProviderCheck(t, mod, dir, { timeoutMs: Math.min(30_000, deadline - Date.now()) });
    if (out.outcome === "result") {
      const status = PROVIDER_STATUS_ITEM[out.result.status];
      providers.push(item(mod.name, status, { producer: "provider binding check", result: out.result,
        reason: status === "pass" ? null : out.result.problems[0]?.message ?? `the provider reports ${out.result.status}`, ...cap(mod.name) }));
    }
    else providers.push(item(mod.name, "unknown", { producer: "provider binding check", result: null, problems: out.problems, reason: out.problems[0]?.message ?? null, ...cap(mod.name) }));
  }
  const checks = { installed: { status: roll(installed), items: installed }, configured: { status: roll(configured), items: configured }, member: { status: roll(member), items: member }, providers: { status: roll(providers), items: providers } };
  const requiredStatuses = Object.values(checks).flatMap((c) => c.items.filter((i) => i.required).map((i) => i.status));
  const byCapability = [...new Set(Object.values(checks).flatMap((c) => c.items.map((i) => i.capability?.id).filter(Boolean)))].sort().map((id) => {
    const of = (name) => checks[name].items.filter((i) => i.capability?.id === id);
    const statuses = Object.keys(checks).flatMap((name) => of(name).filter((i) => i.required).map((i) => i.status));
    return { capability: { id }, checks: Object.fromEntries(Object.keys(checks).map((name) => [name, of(name).length ? roll(of(name)) : "not-applicable"])),
      ownReady: statuses.length > 0 && statuses.every((s) => s === "pass" || s === "not-applicable") };
  });
  const subjectBlockers = Object.entries(checks).flatMap(([name, c]) => c.items.filter((i) => i.required && !i.capability && i.status !== "pass" && i.status !== "not-applicable").map((i) => ({ check: name, subject: i.subject, status: i.status })));
  for (const g of byCapability) g.ready = g.ownReady && subjectBlockers.length === 0;
  return { readinessApi: READINESS_API, subject: t.subject, selector, at: new Date().toISOString(), checks,
    summary: { ready: requiredStatuses.length > 0 && requiredStatuses.every((s) => s === "pass" || s === "not-applicable"), required: requiredStatuses.length,
      pass: requiredStatuses.filter((s) => s === "pass").length, fail: requiredStatuses.filter((s) => s === "fail").length, unknown: requiredStatuses.filter((s) => s === "unknown").length, byCapability, subjectBlockers },
    notes: ["ready means every REQUIRED check passes; it is never inferred from an empty set",
      "member is the soul's member repository confirmed in the workspace (oats-membership.yaml), never login or team registration",
      "providers relays each provider's own binding check verbatim; the spawn's fail-closed hooks are unchanged"] };
}

/** Enforced policy for an instance (from its recorded metadata) or a soul
 *  (its declaration + default), with origins. Advisory/unknown stays unknown. */
export function policyOf({ instanceMeta = null, soul = null } = {}) {
  const child = instanceMeta?.policy?.childSpawns
    ? { allowed: instanceMeta.policy.childSpawns.allowed === true, enforced: true, origin: instanceMeta.policy.childSpawns.origin ?? { kind: "recorded" } }
    : instanceMeta ? { allowed: true, enforced: true, origin: { kind: "default", detail: "no recorded policy: children allowed (pre-0.24.8 instance)" } }
    : soul?.declarations?.children && typeof soul.declarations.children.spawn === "boolean"
      ? { allowed: soul.declarations.children.spawn, enforced: false, origin: { kind: "soul", detail: "children.spawn in soul.yaml; enforced once an instance records it" } }
      : { allowed: true, enforced: false, origin: { kind: "default", detail: "no declaration: children allowed" } };
  const worktree = instanceMeta ? { allowed: instanceMeta.work === "worktree" || instanceMeta.work === "checkout", mode: instanceMeta.work ?? null, enforced: true, origin: { kind: "work-mode", detail: `work: ${instanceMeta.work}` } }
    : soul ? { allowed: ["worktree", "checkout"].includes(soul.work), mode: soul.work ?? null, enforced: false, origin: { kind: "soul", detail: `work: ${soul.work}` } } : { allowed: null, mode: null, enforced: false, origin: { kind: "unknown" } };
  return { policy: { childSpawns: child, worktrees: worktree } };
}
/** The soul facts `policyOf` reads (children.spawn, work). */
export const policySoul = (t) => ({ declarations: declarationsOf(t.soul.definition), work: obj(t.soul.definition) ? t.soul.definition.work : undefined });
/** The provider module filling `layer` for a target, with its directory (fetched
 *  into the deployment's module store for a soul). */
export async function layerProvider(t, layer, { catalog = null, remoteOptions } = {}) {
  const name = t.slots[layer];
  const mod = name ? t.modules.find((x) => x.name === name) : null;
  if (!mod?.manifest) return null;
  let dir = mod.dir;
  if (!dir && mod.module && t.lock) dir = await ensureModuleTree(t.deployment, mod.module, t.lock, { catalog, remoteOptions });
  return { mod, dir, settings: obj(t.payloads[name]) ? t.payloads[name] : {}, env: (cap, settings) => providerEnv(t, cap, settings), executable: (script) => (dir ? moduleExecutable(dir, script) : null) };
}
export { missingRequires as manifestMissingRequires };
