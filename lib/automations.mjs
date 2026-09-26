/** What workspace triggers and workspace schedules share (kernel 0.29.0; design
 *  docs/design/2026-09-26-okf-knowledge-operations.md §2.3a). Nothing here knows what a trigger
 *  or a schedule IS: each kind's module (lib/triggers.mjs, lib/schedule.mjs) owns its file body,
 *  its validation and its rows, and hands this module a KIND DESCRIPTOR:
 *
 *    { kind: "trigger" | "schedule", folder, suffix, fileKind, bodyKeys,
 *      parseBody(body) → source | throws { message, field },
 *      expand(entry) → definition | throws (may be async) }
 *
 *  Triggers and schedules are defined at one of two levels:
 *  - the WORKSPACE level: a file committed in a confirmed member repository, shared through Git,
 *    named `<member>/<id>`;
 *  - LOCALLY, in the deployment's oats-schedules.json (`oats trigger add`, `oats schedule add`):
 *    machine-private, named `local/<id>`.
 *
 *  Shared rules:
 *  - WHERE: a kind's canonical folder at the member's root (every *.yaml / *.yml under it) or a
 *    file named `*.<suffix>.yaml` (.yml too) anywhere in the member; never under `oats-package/`,
 *    `.git/` or `node_modules/`. One recursive tree listing per member commit serves both kinds.
 *  - THE HEADER: `kind: <fileKind>` + `schemaVersion: 1` (a wrong or missing kind is
 *    E_AUTOMATION_SCHEMA), `id:` or the filename stem, `runsOn` (a host name), `owner` (a GitHub
 *    account, `<host>/<login>`), `description?`, `enabled?`. A duplicate id within one member and
 *    one kind is E_AUTOMATION_DUPLICATE.
 *  - PLACEMENT: a host runs one ONLY when `runsOn` is its `host.name` (oats-local.yaml) AND its
 *    authenticated `gh` account is `owner`; otherwise it is listed with the reason
 *    (`host-unnamed`, `assigned-elsewhere`, `owner-mismatch`). Each kind's own list in
 *    oats-local.yaml (`triggers.disabled`, `schedules.disabled`) stops a named host from running
 *    one.
 *  - THE SNAPSHOT: discovery reads the remotes (async), the host tick is synchronous; so
 *    discovery writes <deployment>/.agents/automations/snapshot.json (`oats sync`,
 *    `oats automations refresh`, which the tick runs as a child when the snapshot is ten minutes
 *    old), one list per kind, and the tick reads it. The run state stays local. */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { parseConfigData } from "./config-data.mjs";

export const AUTOMATIONS_API = 1;
export const SNAPSHOT_MAX_AGE_MS = 10 * 60_000;
export const PLACEMENT_REASONS = Object.freeze(["host-unnamed", "assigned-elsewhere", "owner-mismatch"]);
/** The kinds, in the order the snapshot keeps them (`triggers`, `schedules`). */
export const KIND_NAMES = Object.freeze(["trigger", "schedule"]);
const NEVER_SCANNED = new Set(["oats-package", ".git", "node_modules"]);
export const AUTOMATION_ID_RE = /^[a-z0-9-]{1,40}$/;
export const HOST_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const OWNER_RE = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))$/;
const HEADER_KEYS = ["kind", "schemaVersion", "id", "description", "runsOn", "owner", "enabled"];
const LOCAL = "local";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export function automationError(code, message, details) { return Object.assign(new Error(message), { code, ...(details ? { details } : {}) }); }

// ------------------------------------------------------------ names

/** `local/<id>` for a machine-private trigger or schedule, `<member>/<id>` for a workspace one. */
export const localId = (id) => `${LOCAL}/${id}`;
/** Split a qualified id; a bare id is a local one. → { scope: "local" | <member>, name } */
export function splitId(text) {
  const s = String(text ?? "");
  const i = s.indexOf("/");
  return i < 0 ? { scope: LOCAL, name: s } : { scope: s.slice(0, i), name: s.slice(i + 1) };
}
/** The qualified form of an id argument (a bare id is a local one). */
export const qualifiedId = (text) => { const { scope, name } = splitId(text); return `${scope}/${name}`; };
/** `<host>/<login>` → { host, login } | null (a login compares case-insensitively). */
export function parseOwner(text) {
  const m = typeof text === "string" ? OWNER_RE.exec(text.trim()) : null;
  return m ? { host: m[1], login: m[2] } : null;
}

// ------------------------------------------------------------ discovery

/** Which kind (of the given descriptors) a tree path would be. → { kind, stem } | null */
export function candidateOf(path, kinds) {
  const segs = String(path).split("/");
  if (segs.some((s) => NEVER_SCANNED.has(s))) return null;
  const base = segs.at(-1);
  for (const k of kinds) {
    const suffix = `.${k.suffix}.`;
    const at = base.lastIndexOf(suffix);
    if (at > 0 && /^ya?ml$/.test(base.slice(at + suffix.length))) return { kind: k.kind, stem: base.slice(0, at) };
  }
  for (const k of kinds) if (segs[0] === k.folder && segs.length > 1 && /\.ya?ml$/.test(base)) return { kind: k.kind, stem: base.replace(/\.ya?ml$/, "") };
  return null;
}

/** Parse one candidate file: the shared header here, the body by the kind's descriptor. The
 *  definition is not expanded yet. Never throws: → { entry } | { problem } */
export function parseAutomationFile(desc, { stem, path, bytes, member, repoKey, commit }) {
  const origin = { kind: "workspace", repoKey, path, commit };
  const problem = (message, field) => ({ problem: { code: "E_AUTOMATION_SCHEMA", kind: desc.kind, repoKey, path: field ? `${path}#/${field}` : path, message } });
  let doc;
  try { doc = parseConfigData(bytes, { origin: { kind: desc.fileKind, repoKey, commit, path } }).value; }
  catch (e) { return problem(`cannot decode: ${e.message}`); }
  if (!isObject(doc)) return problem(`a ${desc.fileKind} file is a mapping with kind: ${desc.fileKind} and schemaVersion: 1`);
  if (doc.kind !== desc.fileKind) return problem(`kind must be ${JSON.stringify(desc.fileKind)} (found ${JSON.stringify(doc.kind ?? null)}): a file ${path.split("/").at(-1).includes(`.${desc.suffix}.`) ? `named *.${desc.suffix}.yaml` : `in ${desc.folder}/`} follows the ${desc.fileKind} contract`, "kind");
  if (doc.schemaVersion !== 1) return problem(`schemaVersion must be 1 (found ${JSON.stringify(doc.schemaVersion ?? null)})`, "schemaVersion");
  const allowed = [...HEADER_KEYS, ...desc.bodyKeys];
  const unknown = Object.keys(doc).filter((k) => !allowed.includes(k));
  if (unknown.length) return problem(`unknown field${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")} (a ${desc.fileKind} carries ${allowed.join(", ")})`, unknown[0]);
  const name = doc.id === undefined ? stem : doc.id;
  if (typeof name !== "string" || !AUTOMATION_ID_RE.test(name)) return problem(`the id (${doc.id === undefined ? "the filename stem" : "id:"} ${JSON.stringify(name)}) must be lowercase letters, digits and dashes, 1 to 40 characters`, "id");
  if (typeof doc.runsOn !== "string" || !HOST_NAME_RE.test(doc.runsOn)) return problem("runsOn: the host name that runs it (oats-local.yaml host.name: lowercase letters, digits and dashes)", "runsOn");
  const owner = parseOwner(doc.owner);
  if (!owner) return problem("owner: the GitHub account it acts as, <host>/<login> (e.g. github.com/acme-kb-bot)", "owner");
  if (doc.description !== undefined && typeof doc.description !== "string") return problem("description: text", "description");
  if (doc.enabled !== undefined && typeof doc.enabled !== "boolean") return problem("enabled: boolean", "enabled");
  let source;
  try { source = desc.parseBody(Object.fromEntries(Object.entries(doc).filter(([k]) => !HEADER_KEYS.includes(k)))); }
  catch (e) { return problem(e.message, e.field); }
  return { entry: { kind: desc.kind, id: `${member}/${name}`, name, member, description: doc.description ?? null, runsOn: doc.runsOn, owner: `${owner.host}/${owner.login}`, enabled: doc.enabled !== false, origin, source } };
}

/** Discover the workspace triggers and schedules of the confirmed members: one tree listing per
 *  member commit serves every kind (a member whose commit did not change reuses the previous
 *  snapshot's listing). Each kind's descriptor parses its body and expands it into a validated
 *  kernel definition; a failure lists the entry as invalid and is reported.
 *  → { byKind: { trigger: [...], schedule: [...] }, problems, members } */
export async function discoverAutomations(discovery, { remote, memberName, kinds, previous = null } = {}) {
  const byKind = Object.fromEntries(kinds.map((k) => [k.kind, []]));
  const problems = [], members = {};
  const names = new Map();
  for (const m of (discovery?.members || []).filter((x) => x.confirmed && x.commit)) {
    const name = memberName(m.key);
    if (names.has(name)) { problems.push({ code: "E_AUTOMATION_DUPLICATE", repoKey: m.key, path: "", message: `member name ${JSON.stringify(name)} is also ${names.get(name)}'s: triggers and schedules are named <member>/<id>, so ${m.key}'s are not listed` }); continue; }
    names.set(name, m.key);
    let candidates;
    const cached = previous?.members?.[m.key];
    if (cached && cached.commit === m.commit && Array.isArray(cached.candidates)) candidates = cached.candidates;
    else {
      let tree;
      try { tree = await remote.listRemoteTree(m.ref ?? m.key, m.commit, "", { depth: 64 }); }
      catch (e) { problems.push({ code: e?.code || "E_REMOTE_UNREADABLE", repoKey: m.key, path: "", message: `triggers and schedules cannot be listed: ${e.message}` }); continue; }
      candidates = tree.filter((e) => e.type === "blob" && candidateOf(e.path, kinds)).map((e) => e.path);
    }
    members[m.key] = { name, commit: m.commit, candidates };
    const seen = Object.fromEntries(kinds.map((k) => [k.kind, new Map()]));
    for (const path of [...candidates].sort()) {
      const c = candidateOf(path, kinds);
      if (!c) continue;
      const desc = kinds.find((k) => k.kind === c.kind);
      let bytes;
      try { ({ bytes } = await remote.readRemoteFile(m.ref ?? m.key, m.commit, path)); }
      catch (e) { problems.push({ code: e?.code || "E_REMOTE_UNREADABLE", kind: c.kind, repoKey: m.key, path, message: e.message }); continue; }
      const parsed = parseAutomationFile(desc, { stem: c.stem, path, bytes, member: name, repoKey: m.key, commit: m.commit });
      if (parsed.problem) { problems.push(parsed.problem); continue; }
      const a = parsed.entry;
      const first = seen[a.kind].get(a.name);
      if (first) { problems.push({ code: "E_AUTOMATION_DUPLICATE", kind: a.kind, repoKey: m.key, path, message: `${a.kind} id ${JSON.stringify(a.name)} is declared by both ${first} and ${path}; ${path} is not listed` }); continue; }
      seen[a.kind].set(a.name, path);
      try { a.definition = await desc.expand(a); }
      catch (e) {
        a.definition = null;
        a.invalid = { code: e.code || "E_AUTOMATION_SCHEMA", message: e.message, ...(e.field ? { field: e.field } : e.details?.field ? { field: e.details.field } : {}) };
        problems.push({ code: a.invalid.code, kind: a.kind, repoKey: m.key, path, message: `${a.kind} ${a.id}: ${e.message}` });
      }
      byKind[a.kind].push(a);
    }
  }
  for (const list of Object.values(byKind)) list.sort((x, y) => x.id.localeCompare(y.id));
  return { byKind, problems, members };
}

/** The soul index a snapshot keeps, so list rows can say where a soul comes from. */
export function soulIndexOf(discovery, memberName) {
  const byName = {}, byQualified = {};
  const add = (name, qualified, origin) => { (byName[name] ||= []).push(origin); byQualified[qualified] = origin; };
  for (const m of discovery?.members || []) for (const s of m.souls || []) add(s.name, `${memberName(m.key)}/${s.name}`, { kind: "member", repoKey: m.key, member: memberName(m.key) });
  for (const s of discovery?.packageSouls || []) add(s.name, s.qualifiedName, { kind: "package", package: s.package, version: s.version });
  for (const e of discovery?.external || []) add(e.soul.name, `${memberName(e.key)}/${e.soul.name}`, { kind: "external", repoKey: e.key, source: e.source });
  return { byName, byQualified };
}
/** Where a soul named by a trigger or schedule comes from, per the snapshot. → origin | null */
export function soulOriginOf(index, soul) {
  if (!index || typeof soul !== "string") return null;
  if (soul.includes("/")) return index.byQualified?.[soul] ?? null;
  const hits = index.byName?.[soul] ?? [];
  if (hits.length === 1) return hits[0];
  return hits.length ? { kind: "ambiguous", candidates: hits.length } : null;
}

// ------------------------------------------------------------ snapshot

export const snapshotPath = (dep) => join(dep, ".agents", "automations", "snapshot.json");
export function readSnapshot(dep) {
  try {
    const doc = JSON.parse(readFileSync(snapshotPath(dep), "utf8"));
    return isObject(doc) && KIND_NAMES.every((k) => Array.isArray(doc[`${k}s`])) ? doc : null;
  } catch { return null; }
}
export function writeSnapshot(dep, snap) {
  const file = snapshotPath(dep);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(snap, null, 2) + "\n");
  renameSync(tmp, file);
  return file;
}
/** The snapshot document of one discovery: one list per kind (`triggers`, `schedules`). */
export function snapshotOf(discovery, found, { souls = null, now = new Date() } = {}) {
  return {
    automationsApi: AUTOMATIONS_API, takenAt: now.toISOString(),
    workspace: discovery?.standalone === true ? null : { key: discovery?.key ?? null, commit: discovery?.commit ?? null },
    members: found.members,
    ...Object.fromEntries(KIND_NAMES.map((k) => [`${k}s`, found.byKind[k] ?? []])),
    problems: found.problems, souls,
  };
}
const attemptPath = (dep) => join(dirname(snapshotPath(dep)), "last-refresh-attempt");
function sinceAttempt(dep, now) { try { return now.getTime() - Date.parse(readFileSync(attemptPath(dep), "utf8").trim()); } catch { return Infinity; } }
const snapshotAge = (snap, now) => (snap?.takenAt ? now.getTime() - Date.parse(snap.takenAt) : Infinity);

// ------------------------------------------------------------ this host

/** The host's own facts from oats-local.yaml (never in Git): its name and, per kind, the
 *  workspace ids it does not run (`triggers.disabled`, `schedules.disabled`). */
export function hostOf(local) {
  const name = isObject(local?.host) && typeof local.host.name === "string" ? local.host.name : null;
  const disabled = Object.fromEntries(KIND_NAMES.map((k) => [k, new Set(Array.isArray(local?.[`${k}s`]?.disabled) ? local[`${k}s`].disabled : [])]));
  return { name, disabled };
}
/** The account the host's `gh` is logged in as on one GitHub host (`gh api user`), memoized in
 *  `cache` (one per tick). `io.gh(args)` is the seam. → { ok, login } | { ok: false, error } */
export function ghLogin(ghHost, { io, cache } = {}) {
  if (cache?.has(ghHost)) return cache.get(ghHost);
  const argv = ["api", "user", "--jq", ".login", ...(ghHost === "github.com" ? [] : ["--hostname", ghHost])];
  let r;
  if (io?.gh) r = io.gh(argv);
  else {
    const p = spawnSync("gh", argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, env: { ...process.env, GH_PROMPT_DISABLED: "1" } });
    r = p.error ? { status: 127, stdout: "", stderr: p.error.code === "ENOENT" ? "gh is not installed on this host" : p.error.message } : p;
  }
  const login = String(r.stdout || "").trim();
  const out = r.status === 0 && login ? { ok: true, login } : { ok: false, error: String(r.stderr || r.stdout).split("\n").map((l) => l.trim()).find(Boolean) || `gh exited ${r.status}` };
  cache?.set(ghHost, out);
  return out;
}
/** Where a workspace trigger or schedule runs, from this host's point of view.
 *  → { runsHere, reason: null | host-unnamed | assigned-elsewhere | owner-mismatch, detail?, enabledHere } */
export function placementOf(a, { host, io, cache }) {
  const enabledHere = a.enabled !== false && !host.disabled[a.kind]?.has(a.id);
  let reason = null, detail;
  if (!host.name) { reason = "host-unnamed"; detail = "this host has no host.name in oats-local.yaml"; }
  else if (a.runsOn !== host.name) { reason = "assigned-elsewhere"; detail = `runs on ${a.runsOn}; this host is ${host.name}`; }
  else {
    const owner = parseOwner(a.owner);
    const who = owner ? ghLogin(owner.host, { io, cache }) : { ok: false, error: "owner is not <host>/<login>" };
    if (!who.ok) { reason = "owner-mismatch"; detail = `acts as ${a.owner}, but this host's gh is not logged in on ${owner?.host ?? "?"}: ${who.error}`; }
    else if (who.login.toLowerCase() !== owner.login.toLowerCase()) { reason = "owner-mismatch"; detail = `acts as ${a.owner}; this host's gh is logged in as ${owner.host}/${who.login}`; }
  }
  return { runsHere: reason === null && enabledHere && !a.invalid && !!a.definition, reason, ...(detail ? { detail } : {}), enabledHere };
}
/** A local trigger or schedule as a context entry: this host, implicitly; no runsOn/owner. */
export function localEntry(kind, def, { invalid = null, dep = null } = {}) {
  const enabled = def.enabled !== false;
  return { kind, id: localId(def.id), name: def.id, member: LOCAL, description: null, runsOn: null, owner: null, enabled, origin: { kind: "local", path: "oats-schedules.json", url: null, localPath: dep ? join(dep, "oats-schedules.json") : null }, definition: def, ...(invalid ? { invalid } : {}), placement: { runsHere: enabled && !invalid, reason: null, enabledHere: enabled } };
}

/** One deployment's context for a tick or a listing: the snapshot (refreshed first when `refresh`
 *  and it is ten minutes old — at most one attempt per interval) and each workspace trigger and
 *  schedule placed on this host, kept per kind.
 *  → { snapshot, host, triggers: [entry + placement], schedules: [...], refresh: null | { ok, error? } } */
export function automationContext(dep, { local, io, now = new Date(), refresh = false, cache = new Map(), clonePathOf = null } = {}) {
  let snapshot = readSnapshot(dep);
  let refreshed = null;
  const realizesWorkspace = typeof local?.workspace === "string" && local?.standalone === undefined;
  if (refresh && realizesWorkspace && snapshotAge(snapshot, now) >= SNAPSHOT_MAX_AGE_MS && sinceAttempt(dep, now) >= SNAPSHOT_MAX_AGE_MS) {
    // One attempt per interval, whether it works or not: a remote that is down is not asked
    // again every minute (the last good snapshot keeps serving).
    try { mkdirSync(dirname(snapshotPath(dep)), { recursive: true }); writeFileSync(attemptPath(dep), now.toISOString() + "\n"); } catch { /* the refresh itself reports */ }
    refreshed = refreshViaCli(dep, io);
    if (refreshed.ok) snapshot = readSnapshot(dep);
  }
  const host = hostOf(local);
  const place = (list) => (list || []).map((a) => ({ ...a, origin: { ...a.origin, ...originLinks(a.origin, clonePathOf) }, placement: placementOf(a, { host, io, cache }) }));
  const ctx = { snapshot, host, ...Object.fromEntries(KIND_NAMES.map((k) => [`${k}s`, place(snapshot?.[`${k}s`])])), refresh: refreshed };
  /** The login this host's gh is authenticated as on each GitHub host the listed items (and
   *  `extraHosts`) name: { <host>: <login> | null }. Asked once per host (the tick's cache). */
  ctx.ghUsers = (extraHosts = []) => {
    const hosts = new Set(extraHosts);
    for (const k of KIND_NAMES) for (const a of ctx[`${k}s`]) { const o = parseOwner(a.owner); if (o) hosts.add(o.host); }
    return Object.fromEntries([...hosts].sort().map((h) => { const who = ghLogin(h, { io, cache }); return [h, who.ok ? who.login : null]; }));
  };
  return ctx;
}
/** Where a workspace file can be opened: its web URL at the commit (GitHub-style, for a
 *  github.com repository; null otherwise) and its path in this machine's clone of the member
 *  (null when the member is not cloned here). → { url, localPath } */
export function originLinks(origin, clonePathOf) {
  if (origin?.kind !== "workspace") return {};
  const m = /^github\.com\/([^/]+)\/([^/]+)$/.exec(String(origin.repoKey));
  const url = m && origin.commit ? `https://github.com/${m[1]}/${m[2].replace(/\.git$/, "")}/blob/${origin.commit}/${origin.path}` : null;
  let clone = null;
  try { clone = clonePathOf ? clonePathOf(origin.repoKey) : null; } catch { clone = null; }
  return { url, localPath: clone ? join(clone, origin.path) : null };
}
/** `oats automations refresh --json` as a child (the tick is synchronous; discovery is not). */
function refreshViaCli(dep, io) {
  if (io?.refresh) return io.refresh(dep);
  const bin = io?.oatsBin || new URL("../bin/oats.mjs", import.meta.url).pathname;
  const r = spawnSync(process.execPath, [bin, "automations", "refresh", "--dir", dep, "--json"], { cwd: dep, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: io?.refreshTimeoutMs || 180_000, env: io?.childEnv ? io.childEnv() : process.env });
  let env = null;
  try { env = JSON.parse(String(r.stdout || "").trim().split("\n").pop()); } catch { env = null; }
  if (env?.ok === true) return { ok: true };
  return { ok: false, error: env?.error?.message || (r.error ? r.error.message : `automations refresh exited ${r.status}`) };
}

// ------------------------------------------------------------ opting out here

/** Add or remove `<member>/<id>` in oats-local.yaml `<kind>s.disabled` (`triggers.disabled` or
 *  `schedules.disabled`), keeping the rest of the file (comments included) as written.
 *  `validate(value)` → problems, checked before any write. */
export function setDisabledHere(localPath, kind, qid, disabled, { validate } = {}) {
  const section = `${kind}s`;
  const text = readFileSync(localPath, "utf8");
  const doc = YAML.parseDocument(text, { keepSourceTokens: true });
  if (doc.errors?.length) throw automationError("E_WORKSPACE_SCHEMA", `${localPath}: ${doc.errors[0].message}`);
  const current = doc.getIn([section, "disabled"]);
  const list = current && typeof current.toJSON === "function" ? current.toJSON() : Array.isArray(current) ? current : [];
  const next = disabled ? [...new Set([...list, qid])].sort() : list.filter((x) => x !== qid);
  if (JSON.stringify(next) === JSON.stringify(list)) return { changed: false, disabled: list };
  if (next.length) doc.setIn([section, "disabled"], next);
  else if (doc.hasIn([section, "disabled"])) {
    doc.deleteIn([section, "disabled"]);
    const rest = doc.get(section);
    if (rest && typeof rest.toJSON === "function" && !Object.keys(rest.toJSON() || {}).length) doc.delete(section);
  }
  const out = doc.toString();
  const value = parseConfigData(out, { origin: { kind: "local", path: localPath } }).value;
  const problems = validate ? validate(value) : [];
  if (problems.length) throw automationError("E_WORKSPACE_SCHEMA", `the rewritten ${localPath} would be invalid (${problems.map((p) => `${p.path || "/"}: ${p.message}`).join("; ")}); nothing was written`);
  writeFileSync(localPath, out);
  return { changed: true, disabled: next };
}

// ------------------------------------------------------------ writing a workspace file

/** The YAML text of a workspace trigger or schedule file: the shared header, then the kind's body. */
export function automationFileText(desc, { id, description, runsOn, owner, body }) {
  return YAML.stringify({ kind: desc.fileKind, schemaVersion: 1, id, ...(description ? { description } : {}), runsOn, owner, ...body }, { lineWidth: 0 });
}
/** Where `oats trigger|schedule add --workspace <member>` writes: the git checkout containing
 *  `dir` when its origin remote IS that member's repository (`sameRepo(url)` decides), else null
 *  (the caller prints the file instead). → { root, file, rel } | null */
export function memberCheckoutFor(dir, desc, id, { sameRepo }) {
  const top = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 });
  if (top.status !== 0) return null;
  const root = top.stdout.trim();
  const url = spawnSync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 });
  if (url.status !== 0 || !sameRepo(url.stdout.trim())) return null;
  const rel = `${desc.folder}/${id}.yaml`;
  return { root, file: join(root, rel), rel };
}

// ------------------------------------------------------------ list rows

/** The fields every trigger row and every schedule row share (docs/desktop-cli-api.md): identity,
 *  origin, who and where. Each kind's module adds its own (`kind`, the soul, the task, the event
 *  or the cron, the last and next run). */
export function baseRow(a) {
  return {
    id: a.id, name: a.name, origin: a.origin, description: a.description ?? null,
    owner: a.owner ?? null, runsOn: a.runsOn ?? null,
    runsHere: a.placement.runsHere, reason: a.placement.reason, ...(a.placement.detail ? { reasonDetail: a.placement.detail } : {}),
    enabledHere: a.placement.enabledHere,
    ...(a.invalid ? { invalid: a.invalid } : {}),
  };
}
