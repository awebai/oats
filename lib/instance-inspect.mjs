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
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { capabilityManifests, instanceSoulDir, manifestOperations, parseYamlNested, servedIdentityOf, teamEnv, withConfigFile } from "./core.mjs";
import { discoverOrStandalone, prepareInstance } from "./instance-resolution.mjs";
import { loadLocal } from "./workspace.mjs";
import { ensureModuleTree } from "./operator-dispatch.mjs";

export const INSPECT_OPERATIONS_API = 2;
export const SOULS_API = 2;
export const READINESS_API = 2;
const LAYERS = ["knowledge", "messaging", "tasks"];
const CLI_BIN = fileURLToPath(new URL("../bin/oats.mjs", import.meta.url));
const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

/** A resolution refusal that is a readiness FACT (the soul cannot resolve as the
 *  lock stands), not a failure to answer: reported as a failing `installed` item. */
export const RESOLUTION_FACTS = new Set(["E_PACKAGE_MISSING", "E_PACKAGE_INTEGRITY", "E_CAPABILITY_MISSING", "E_LOCK_SCHEMA", "E_REQUIREMENT_INACTIVE"]);

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
  return { requires: section("requires"), defaults: section("defaults"), knowledge: section("knowledge"), teams: section("teams"), resources: section("resources"), children: section("children"), capabilities: section("capabilities") };
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

/** The instance target: `home` is absolute and holds instance.json with modules. */
export async function homeTarget(home, meta, { remoteOptions, discover = true } = {}) {
  const realHome = real(home);
  const manifests = capabilityManifests(realHome);
  const modules = obj(meta.modules) ? meta.modules : {};
  const agentsRoot = dirname(dirname(dirname(realHome)));
  const deployment = dirname(agentsRoot);
  const ws = obj(meta.workspace) ? meta.workspace : {};
  const soulDir = instanceSoulDir(realHome, meta) ?? null;
  const { definition, problems } = readSoulYaml(soulDir);
  let discovery = null, discoveryError = null;
  if (discover) {
    try { const { local } = loadLocal(deployment); discovery = await discoverOrStandalone(local, { remoteOptions }); }
    catch (e) { discoveryError = { code: e.code || "E_REMOTE_UNREADABLE", message: e.message }; }
  }
  const slots = Object.fromEntries(LAYERS.map((l) => [l, Object.keys(modules).find((n) => manifests[n]?.layer === l) ?? null]));
  return {
    kind: "instance", home: realHome, meta, deployment, agentsRoot,
    subject: { kind: "instance", instance: meta.instance, home, soul: meta.agent },
    soul: { name: meta.agent, repoKey: ws.soul?.repoKey ?? null, commit: ws.soul?.commit ?? null, team: ws.soul?.team ?? null, external: null, path: null, soulDir, definition, problems },
    workspace: { key: ws.key ?? null, name: discovery?.workspace?.name ?? null, deployment, commit: ws.commit ?? null, standalone: ws.standalone === true },
    modules: Object.keys(modules).sort().map((name) => ({ name, from: modules[name]?.from ?? null, manifest: manifests[name] ?? null, dir: join(realHome, ".oats", "modules", name) })),
    payloads: obj(meta.providers) ? meta.providers : {}, slots, discovery, discoveryError, resolutionError: null,
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
    const { findSoulEntry } = await import("./instance-resolution.mjs");
    discovery = await discoverOrStandalone(found.local, { remoteOptions });
    soulEntry = findSoulEntry(discovery, soul);
  }
  const res = prepared?.resolution;
  const cached = soulEntry?.commit ? join(deployment, "agents", soulEntry.name, "souls", String(soulEntry.commit).slice(0, 12)) : null;
  return {
    kind: "soul", home: null, meta: null, deployment, agentsRoot: join(deployment, "agents"),
    subject: { kind: "soul", soul: soulEntry.name, repoKey: soulEntry.repoKey ?? null, commit: soulEntry.commit ?? null, team: soulEntry.team ?? null },
    soul: { name: soulEntry.name, repoKey: soulEntry.repoKey ?? null, commit: soulEntry.commit ?? null, team: soulEntry.team ?? null, external: soulEntry.external === true, path: soulEntry.path ?? null,
      soulDir: cached && existsSync(join(cached, "soul.yaml")) ? cached : null, definition: soulEntry.definition ?? null, problems: [] },
    workspace: { key: discovery?.key ?? null, name: discovery?.workspace?.name ?? null, deployment, commit: discovery?.commit ?? null, standalone: discovery?.standalone === true },
    modules: (res?.modules || []).map((m) => ({ name: m.name, from: m.from ?? null, manifest: m.manifest ?? null, dir: null, module: m })).sort((a, b) => a.name.localeCompare(b.name)),
    payloads: obj(res?.payloads) ? res.payloads : {}, slots: obj(res?.slots) ? res.slots : Object.fromEntries(LAYERS.map((l) => [l, null])),
    discovery, discoveryError: null, resolutionError, lock: prepared?.lock ?? null, prepared,
  };
}

/** Is `dir` a v2 context (an oats-local.yaml in reach)? */
export function isWorkspaceContext(dir) { try { loadLocal(dir); return true; } catch { return false; } }

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
    return { id: name, version: m.version ?? null, layer: m.layer ?? null, command: m.command ?? null, from, dir,
      settings: obj(t.payloads[name]) ? t.payloads[name] : {}, missingRequires: missing, operations };
  });
}
function soulRow(t) {
  const s = t.soul, def = obj(s.definition) ? s.definition : {};
  return { soulsApi: SOULS_API, name: s.name, repoKey: s.repoKey, commit: s.commit, team: s.team, kind: s.external ? "external" : "member", path: s.path,
    description: def.description ?? null, work: def.work ?? null, runtime: def.runtime ?? null, model: def.model ?? null,
    declarations: declarationsOf(s.definition), declarationProblems: s.problems,
    instructions: s.soulDir ? readTextCapped(join(s.soulDir, "AGENTS.md")) : null };
}

/** `oats inspect --json` on the workspace model. */
export function inspectDocument(t, { kernel }) {
  const capabilities = capabilityRows(t);
  const layers = Object.fromEntries(LAYERS.map((l) => [l, { id: t.slots[l] ?? null }]));
  const kcap = layers.knowledge.id ? capabilities.find((c) => c.id === layers.knowledge.id) : null;
  const m = t.meta;
  return {
    operationsApi: INSPECT_OPERATIONS_API, kernel, subject: t.subject, workspace: t.workspace,
    souls: [soulRow(t)], layers, capabilities,
    knowledge: kcap ? { provider: kcap.id, version: kcap.version, operations: kcap.operations.map((o) => ({ name: o.name, kind: o.kind, available: o.available, reason: o.reason })) } : { provider: null, version: null, operations: [] },
    instance: m ? { home: t.home, instance: m.instance, agent: m.agent, runtime: m.runtime || null, model: m.model ?? null, yolo: m.yolo ?? null, launched: !!m.launched, createdAt: m.createdAt || null,
      resolution: m.workspace?.resolution ?? null, soulDir: t.soul.soulDir, instructions: { ...readTextCapped(join(t.home, "AGENTS.md")), sources: m.instructions || [] } } : null,
    ...(m ? { identity: servedIdentityOf(m) } : {}),
    problems: [...t.soul.problems, ...(t.discoveryError ? [t.discoveryError] : []),
      ...t.modules.filter((x) => !x.manifest).map((x) => ({ code: "module-missing", message: `${x.name} is recorded but its module copy has no readable oats.json`, capability: x.name }))],
  };
}

// ---------- readiness ----------
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
  Object.assign(env, teamEnv({ workspace: { key: t.workspace.key, name: t.workspace.name, deployment: t.deployment, team: t.soul.team, slots: t.slots }, payloads: t.payloads }));
  return Object.assign(env, { OATS_CAPABILITY: capability, OATS_SETTINGS: JSON.stringify(settings), OATS_CLI_BIN: CLI_BIN, OATS_WORKSPACE: t.deployment,
    ...(t.home ? { OATS_INSTANCE: t.meta.instance, OATS_INSTANCE_HOME: t.home } : {}), OATS_AGENT: t.soul.name, ...(t.soul.soulDir ? { OATS_SOUL: t.soul.soulDir } : {}) });
}
/** An executable inside a module directory (no escape, must exist). */
function moduleExecutable(dir, script) {
  const file = resolve(dir, script);
  const rel = relative(dir, file);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || !existsSync(file)) return null;
  return file;
}
const PROVIDER_STATUSES = new Set(["ready", "needs-configuration"]);
function validProblems(p) { return Array.isArray(p) && p.every((x) => obj(x) && typeof x.code === "string" && typeof x.message === "string"); }
/** Run one provider's binding check. → { status, problems } verbatim, or an
 *  `unknown` with the provider's own refusal (never a kernel invention). */
export function runProviderCheck(t, mod, dir, { timeoutMs = 30000 } = {}) {
  const m = mod.manifest, check = m?.binding?.check, spec = check ? m.commands?.[check] : null;
  if (typeof spec !== "string" || !spec.trim()) return { outcome: "unknown", problems: [{ code: "provider-not-qualified", message: `${mod.name} declares binding.check but no command ${JSON.stringify(check)}` }] };
  const [script, ...args] = spec.trim().split(/\s+/);
  const file = dir ? moduleExecutable(dir, script) : null;
  if (!file) return { outcome: "unknown", problems: [{ code: "resource-not-found", message: `${mod.name}: the check executable ${script} is unavailable` }] };
  const settings = obj(t.payloads[mod.name]) ? t.payloads[mod.name] : {};
  const request = { schemaVersion: 1, phase: "check", slot: m.layer ?? null, capability: mod.name, settings,
    input: { context: { kind: "workspace", workspace: t.workspace.key, deployment: t.deployment, soul: t.soul.name, team: t.soul.team, instance: t.meta?.instance ?? null, home: t.home }, action: { kind: "readiness" } } };
  const r = spawnSync(process.execPath, [file, ...args], { cwd: dir, env: providerEnv(t, mod.name, settings), input: JSON.stringify(request), encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
  if (r.error || r.signal) return { outcome: "unknown", problems: [{ code: "provider-unavailable", message: `${mod.name} check did not complete${r.error?.code === "ETIMEDOUT" || r.signal ? " in time" : ""}` }] };
  let doc; try { doc = JSON.parse(String(r.stdout || "").trim().split("\n").pop()); } catch { doc = null; }
  if (!obj(doc)) return { outcome: "unknown", problems: [{ code: "provider-unavailable", message: `${mod.name} check answered no JSON (exit ${r.status})` }] };
  if (doc.ok === false) return { outcome: "unknown", problems: [{ code: typeof doc.error?.code === "string" ? doc.error.code : "provider-refused", message: typeof doc.error?.message === "string" ? doc.error.message : `${mod.name} refused the check` }] };
  const res = doc.result;
  if (doc.ok !== true || !obj(res) || !PROVIDER_STATUSES.has(res.status) || !validProblems(res.problems)) return { outcome: "unknown", problems: [{ code: "provider-unavailable", message: `${mod.name} check answered an unrecognised result` }] };
  return { outcome: "result", result: { status: res.status, problems: res.problems.map((p) => ({ code: p.code, message: p.message })) } };
}

/** `oats readiness --json` on the workspace model. */
export async function readinessDocument(t, { selector = null, remoteOptions, catalog = null } = {}) {
  const installed = [], configured = [], member = [], providers = [];
  const cap = (id) => ({ capability: { id } });
  if (t.resolutionError) {
    installed.push(item(t.soul.name, "fail", { producer: "workspace resolution", code: t.resolutionError.code, reason: t.resolutionError.message, evidence: t.resolutionError.details, remedy: "oats sync (the lock must provide every package capability the soul resolves)" }));
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
  // providers — each bound provider's own binding check, verbatim.
  for (const mod of t.modules) {
    if (!obj(mod.manifest?.binding)) continue;
    let dir = t.home ? mod.dir : null, pre = null;
    if (!dir && mod.module && t.lock) { try { dir = await ensureModuleTree(t.deployment, mod.module, t.lock, { catalog, remoteOptions }); } catch (e) { pre = { code: e.code || "provider-unavailable", message: e.message }; } }
    if (!dir && !pre && mod.module?.from?.kind === "member") pre = { code: "resource-not-found", message: `${mod.name}: a member module runs from a spawned home; inspect an instance (--home) for its check` };
    const out = pre ? { outcome: "unknown", problems: [pre] } : runProviderCheck(t, mod, dir);
    if (out.outcome === "result") providers.push(item(mod.name, out.result.status === "ready" ? "pass" : "fail", { producer: "provider binding check", result: out.result, reason: out.result.problems[0]?.message ?? null, ...cap(mod.name) }));
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
