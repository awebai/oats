/**
 * lib/workspace.mjs — declarations, membership, discovery (module contract §2).
 *
 * Reads the four v2 declaration files (oats-workspace.yaml, oats-membership.yaml,
 * soul.yaml, oats-local.yaml) over Git remotes through lib/remote.mjs, validates
 * them against docs/*.schema.json with a small in-module validator (no ajv at
 * runtime), observes the reciprocal membership handshake in the operator's own
 * access context, and enumerates every member's souls and capabilities.
 *
 * Nothing here shells out. Every remote access goes through the `remote`
 * option (defaults to lib/remote.mjs) so tests can inject an in-memory remote.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseConfigData } from "./config-data.mjs";
import { oatsError } from "./errors.mjs";
import * as defaultRemote from "./remote.mjs";
import { bindRemote, classifyPackageValue } from "./packages.mjs";
import { manifestContractProblems } from "./capability-contract.mjs";

/* ───────────────────────────── errors ─────────────────────────────────── */

/** oatsError with `details` readable as both e.provenance (today) and e.details. */
function fail(code, message, details) {
  const e = oatsError(code, message, details);
  if (details !== undefined) e.details = details;
  return e;
}

/* ───────────────────────────── remote access ──────────────────────────── */

// lib/remote.mjs is the default remote (contract §1); callers may inject `{ remote }` (tests use an
// in-memory fake) and thread `{ remoteOptions }` (cacheDir, exec, …) into every remote call.
function remoteOf(options) {
  const remote = assertRemoteApi(options?.remote ?? defaultRemote);
  return bindRemote(remote, options?.remoteOptions);
}
const REQUIRED_REMOTE_API = ["parseRepoRef", "observeRemote", "readRemoteFile", "listRemoteTree"];
function assertRemoteApi(remote) {
  for (const name of REQUIRED_REMOTE_API) {
    if (typeof remote?.[name] !== "function") throw new TypeError(`remote must provide ${name}() (module contract §1)`);
  }
  return remote;
}

/* ───────────────────────────── schemas ────────────────────────────────── */

const SCHEMA_FILES = {
  workspace: "oats-workspace.schema.json",
  membership: "oats-membership.schema.json",
  soul: "soul.schema.json",
  local: "oats-local.schema.json",
};
const schemaCache = new Map();
function schemaFor(kind) {
  if (!schemaCache.has(kind)) {
    const file = SCHEMA_FILES[kind];
    if (!file) throw new TypeError(`unknown schema kind ${kind}`);
    schemaCache.set(kind, JSON.parse(readFileSync(new URL(`../docs/${file}`, import.meta.url), "utf8")));
  }
  return schemaCache.get(kind);
}

const pointerKey = (key) => key.replace(/~/g, "~0").replace(/\//g, "~1");
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
const show = (v) => (v === undefined ? "undefined" : JSON.stringify(v));
const regexCache = new Map();
function regexOf(pattern) {
  if (!regexCache.has(pattern)) regexCache.set(pattern, new RegExp(pattern, "u"));
  return regexCache.get(pattern);
}
function deref(root, ref) {
  if (!ref.startsWith("#/")) throw new TypeError(`only local $ref is supported: ${ref}`);
  let node = root;
  for (const part of ref.slice(2).split("/")) {
    node = node?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    if (node === undefined) throw new TypeError(`unresolvable $ref ${ref}`);
  }
  return node;
}
function typeMatches(value, type) {
  const actual = typeOf(value);
  if (type === "number") return actual === "number" || actual === "integer";
  return actual === type;
}
function describe(schema) {
  if (schema.const !== undefined) return show(schema.const);
  if (schema.enum) return schema.enum.map(show).join(" | ");
  if (schema.$ref) return schema.$ref.replace(/^#\/\$defs\//, "");
  if (schema.type) return Array.isArray(schema.type) ? schema.type.join(" | ") : schema.type;
  return "value";
}

/** Small draft-07 subset validator: returns [{ path, message }] (empty = valid). */
export function validateAgainst(schema, value, { root = schema, path = "" } = {}) {
  const problems = [];
  const push = (p, message) => problems.push({ path: p, message });
  const check = (s, v, p) => {
    if (s.$ref) s = { ...deref(root, s.$ref), ...Object.fromEntries(Object.entries(s).filter(([k]) => k !== "$ref" && k !== "description")) };
    if (s.type !== undefined) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((t) => typeMatches(v, t))) { push(p, `expected ${types.join(" | ")}, got ${typeOf(v)}`); return; }
    }
    if (s.const !== undefined && JSON.stringify(v) !== JSON.stringify(s.const)) { push(p, `expected ${show(s.const)}, got ${show(v)}`); return; }
    if (s.enum && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) { push(p, `expected one of ${s.enum.map(show).join(", ")}, got ${show(v)}`); return; }
    if (s.anyOf || s.oneOf) {
      const branches = s.anyOf || s.oneOf;
      const results = branches.map((b) => validateAgainst(b, v, { root, path: p }));
      const passing = results.filter((r) => r.length === 0).length;
      if (passing === 0) {
        // Prefer the branch whose shape matches the value's type; else summarize.
        const resolved = branches.map((b) => (b.$ref ? deref(root, b.$ref) : b));
        const byType = resolved.findIndex((b) => b.type && typeMatches(v, b.type));
        if (byType >= 0 && results[byType].length) problems.push(...results[byType]);
        else push(p, `expected ${resolved.map(describe).join(" | ")}, got ${show(v)}`);
        return;
      }
      if (s.oneOf && passing > 1) { push(p, `matches ${passing} alternatives, expected exactly one`); return; }
    }
    if (typeof v === "string") {
      if (s.minLength !== undefined && v.length < s.minLength) push(p, `must be at least ${s.minLength} character(s)`);
      if (s.maxLength !== undefined && v.length > s.maxLength) push(p, `must be at most ${s.maxLength} character(s)`);
      if (s.pattern && !regexOf(s.pattern).test(v)) push(p, `${show(v)} does not match ${s.pattern}`);
    } else if (typeof v === "number") {
      if (s.minimum !== undefined && v < s.minimum) push(p, `must be >= ${s.minimum}`);
      if (s.maximum !== undefined && v > s.maximum) push(p, `must be <= ${s.maximum}`);
    } else if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) push(p, `must have at least ${s.minItems} item(s)`);
      if (s.maxItems !== undefined && v.length > s.maxItems) push(p, `must have at most ${s.maxItems} item(s)`);
      if (s.uniqueItems) {
        const seen = new Map();
        v.forEach((item, i) => { const k = JSON.stringify(item); if (seen.has(k)) push(`${p}/${i}`, `duplicates item ${seen.get(k)}`); else seen.set(k, i); });
      }
      if (s.items) v.forEach((item, i) => check(s.items, item, `${p}/${i}`));
    } else if (isObject(v)) {
      const keys = Object.keys(v);
      if (s.minProperties !== undefined && keys.length < s.minProperties) push(p, `must have at least ${s.minProperties} propert${s.minProperties === 1 ? "y" : "ies"}`);
      if (s.maxProperties !== undefined && keys.length > s.maxProperties) push(p, `must have at most ${s.maxProperties} propert${s.maxProperties === 1 ? "y" : "ies"} (got ${keys.join(", ")})`);
      for (const req of s.required || []) if (!Object.hasOwn(v, req)) push(p, `missing required property ${show(req)}`);
      for (const key of keys) {
        const kp = `${p}/${pointerKey(key)}`;
        if (s.propertyNames) {
          for (const pr of validateAgainst(s.propertyNames, key, { root, path: kp })) push(kp, `invalid key ${show(key)}: ${pr.message}`);
        }
        let matched = false;
        if (s.properties && Object.hasOwn(s.properties, key)) { matched = true; check(s.properties[key], v[key], kp); }
        if (s.patternProperties) for (const [pat, sub] of Object.entries(s.patternProperties)) if (regexOf(pat).test(key)) { matched = true; check(sub, v[key], kp); }
        if (!matched) {
          if (s.additionalProperties === false) push(kp, `unknown property ${show(key)}`);
          else if (isObject(s.additionalProperties)) check(s.additionalProperties, v[key], kp);
        }
      }
    }
  };
  check(schema, value, path);
  return problems;
}

/* ───────────────────────────── domain rules ───────────────────────────── */

const ABSOLUTE_PATH = /^(?:\/|\\\\|[A-Za-z]:[\\/])/;
/** The workspace file's REF/PATH fields — the only values the absolute-path refusal applies to (contract §2,
 * Phase B: "absolute paths" means bare filesystem paths as VALUES that stand for a repo or a path inside one;
 * host state belongs in oats-local.yaml). Free text (`teams.*.description`) and the opaque provider payload
 * (`messaging`, incl. `byTeam.*`) are never scanned: a description may mention `/srv`, a provider may
 * legitimately carry a socket path or a URL, and neither is a place the kernel resolves.
 * → [[path, value]] for members[], packages.*, stores.*, external[].source|soul, defaults.<slot|capabilities>.*.from,
 *   defaults.byTeam.*.capabilities.*.from */
function* refFields(value) {
  if (Array.isArray(value.members)) for (let i = 0; i < value.members.length; i++) if (typeof value.members[i] === "string") yield [`/members/${i}`, value.members[i]];
  if (isObject(value.packages)) for (const [id, v] of Object.entries(value.packages)) if (typeof v === "string") yield [`/packages/${pointerKey(id)}`, v];
  if (isObject(value.stores)) for (const [name, v] of Object.entries(value.stores)) if (typeof v === "string") yield [`/stores/${pointerKey(name)}`, v];
  if (Array.isArray(value.external)) for (let i = 0; i < value.external.length; i++) {
    const entry = value.external[i];
    if (!isObject(entry)) continue;
    for (const f of ["source", "soul"]) if (typeof entry[f] === "string") yield [`/external/${i}/${f}`, entry[f]];
  }
  if (isObject(value.defaults)) {
    const d = value.defaults;
    const froms = function* (caps, path) { if (isObject(caps)) for (const [name, choice] of Object.entries(caps)) if (isObject(choice) && typeof choice.from === "string") yield [`${path}/${pointerKey(name)}/from`, choice.from]; };
    for (const slot of ["knowledge", "messaging", "tasks", "capabilities"]) yield* froms(d[slot], `/defaults/${slot}`);
    if (isObject(d.byTeam)) for (const [label, team] of Object.entries(d.byTeam)) yield* froms(team?.capabilities, `/defaults/byTeam/${pointerKey(label)}/capabilities`);
  }
}
function refKey(remote, ref) {
  return remote.parseRepoRef(ref).key;
}
/** Push a problem for a ref that parseRepoRef refuses; returns the key or null. */
function keyOrProblem(remote, ref, path, problems) {
  try { return refKey(remote, ref); }
  catch (e) {
    if (e?.code === "E_REPO_REF") { problems.push({ path, message: `not a repo ref: ${e.message}` }); return null; }
    throw e;
  }
}

/** Schema + domain problems for an oats-workspace.yaml value. Refs are parsed with `remote`
 * (default lib/remote.mjs) so duplicate members and malformed refs are always caught. */
export function validateWorkspace(value, { remote = defaultRemote } = {}) {
  const problems = validateAgainst(schemaFor("workspace"), value);
  if (!isObject(value)) return problems;
  if (value.schemaVersion !== 2) return problems;
  // Absolute-path refusal applies to REF/PATH fields only (L2): never to descriptions or the provider payload.
  for (const [path, s] of refFields(value)) {
    if (ABSOLUTE_PATH.test(s)) problems.push({ path, message: `absolute paths are refused in the workspace file (${show(s)}); host paths belong in oats-local.yaml (a local remote is a repo ref: file:///… or git:/abs/bare.git@<ref>)` });
  }
  // packages: exactly two value forms (contract §2 non-collapse rule) — a catalog version or git:<repo>@<ref>.
  if (isObject(value.packages)) for (const [id, v] of Object.entries(value.packages)) {
    const c = classifyPackageValue(v);
    if (c.problem) { problems.push({ path: `/packages/${pointerKey(id)}`, message: `${c.problem} (a package is a bare version like v2.1.3 or git:<repo>@<ref>)` }); continue; }
    if (c.kind === "git") keyOrProblem(remote, c.repo, `/packages/${pointerKey(id)}`, problems);
  }
  const teams = isObject(value.teams) ? Object.keys(value.teams) : [];
  if (Array.isArray(value.members)) {
    const seen = new Map();
    value.members.forEach((ref, i) => {
      if (typeof ref !== "string") return;
      const key = keyOrProblem(remote, ref, `/members/${i}`, problems);
      if (key === null) return;
      if (seen.has(key)) problems.push({ path: `/members/${i}`, message: `duplicates member ${seen.get(key)} (${key})` });
      else seen.set(key, i);
    });
  }
  if (isObject(value.stores)) for (const [name, ref] of Object.entries(value.stores)) if (typeof ref === "string") keyOrProblem(remote, ref, `/stores/${pointerKey(name)}`, problems);
  // Decision 23: messaging.byTeam addresses provider payload by team label — every label must be declared.
  // `byTeam` is legal HERE only; nested inside a team's payload it would be a second, unmerged byTeam (M9).
  if (isObject(value.messaging) && value.messaging.byTeam !== undefined) {
    if (!isObject(value.messaging.byTeam)) problems.push({ path: "/messaging/byTeam", message: "must be an object of { <team label>: <payload> }" });
    else for (const label of Object.keys(value.messaging.byTeam)) {
      if (!teams.includes(label)) problems.push({ path: `/messaging/byTeam/${pointerKey(label)}`, message: `team ${show(label)} is not declared in teams` });
      if (!isObject(value.messaging.byTeam[label])) problems.push({ path: `/messaging/byTeam/${pointerKey(label)}`, message: "must be an object (the payload for that team)" });
      else reservedKeyProblems(value.messaging.byTeam[label], `/messaging/byTeam/${pointerKey(label)}`, problems);
    }
  }
  if (Array.isArray(value.external)) value.external.forEach((entry, i) => {
    if (!isObject(entry)) return;
    if (typeof entry.source === "string") {
      const at = entry.source.lastIndexOf("@");
      if (at > 0) keyOrProblem(remote, entry.source.slice(0, at), `/external/${i}/source`, problems);
    }
    if (typeof entry.team === "string" && !teams.includes(entry.team)) problems.push({ path: `/external/${i}/team`, message: `team ${show(entry.team)} is not declared in teams` });
  });
  if (isObject(value.defaults)) {
    const d = value.defaults;
    for (const slot of ["knowledge", "messaging", "tasks", "capabilities"]) fromProblems(remote, d[slot], `/defaults/${slot}`, problems, { here: false });
    if (isObject(d.byTeam)) for (const label of Object.keys(d.byTeam)) {
      if (!teams.includes(label)) problems.push({ path: `/defaults/byTeam/${pointerKey(label)}`, message: `team ${show(label)} is not declared in teams` });
      fromProblems(remote, d.byTeam[label]?.capabilities, `/defaults/byTeam/${pointerKey(label)}/capabilities`, problems, { here: false });
    }
  }
  return problems;
}
export function validateMembership(value) { return validateAgainst(schemaFor("membership"), value); }
/** Schema + domain problems for a soul.yaml value: `from:` values must be canonical (see fromProblems);
 * slot payloads may not carry the reserved `byTeam` key (see reservedKeyProblems). */
export function validateSoul(value, { remote = defaultRemote } = {}) {
  const problems = validateAgainst(schemaFor("soul"), value);
  if (isObject(value) && value.schemaVersion === 2) {
    fromProblems(remote, value.capabilities, "/capabilities", problems, { here: true });
    for (const slot of ["knowledge", "messaging", "tasks"]) if (isObject(value[slot])) reservedKeyProblems(value[slot], `/${slot}`, problems);
  }
  return problems;
}

/** `byTeam` is RESERVED (decision 23): it addresses a per-team payload and is legal only at the top level
 * of workspace.messaging, where resolve merges base ⊕ byTeam[soul.team] and strips it. Anywhere else — a
 * soul's slot payload, oats-local.yaml settings[cap], a spawn provider, or nested inside a team's own
 * payload — it would reach the provider verbatim (or shadow the real one); refused as a schema problem
 * with `reason: "reserved-key"`. Only the payload's TOP level is checked: deeper keys are the provider's. */
const RESERVED_PAYLOAD_KEY = "byTeam";
function reservedKeyProblems(payload, path, problems) {
  if (!isObject(payload)) return;
  if (Object.hasOwn(payload, RESERVED_PAYLOAD_KEY)) problems.push({ path: `${path}/${RESERVED_PAYLOAD_KEY}`, reason: "reserved-key", message: `${show(RESERVED_PAYLOAD_KEY)} is reserved: it is legal only at the top level of the workspace file's messaging: payload (decision 23)` });
}

/** `from:` must be exactly what the resolver compares against — "package", "here" (souls only) or a CANONICAL
 * repo key (`parseRepoRef(ref).key`: lowercase host, no scheme, no `git:`, no `.git`, or `local/<abs>`).
 * A key spelled otherwise (git:…, https://…, uppercase host) would pass the schema and fail at spawn with a
 * confusing E_NOT_A_MEMBER; it is a schema problem here instead. */
function fromProblems(remote, capabilities, path, problems, { here }) {
  if (!isObject(capabilities)) return;
  for (const [name, choice] of Object.entries(capabilities)) {
    if (!isObject(choice) || typeof choice.from !== "string") continue;
    const from = choice.from, at = `${path}/${pointerKey(name)}/from`;
    if (from === "package") continue;
    if (from === "here") { if (!here) problems.push({ path: at, message: `"here" is only meaningful in a soul; a workspace default names a repo key or package` }); continue; }
    let key = null;
    try { key = remote.parseRepoRef(from.startsWith("local/") ? from.slice("local/".length) : `git:${from}`).key; } catch {}
    if (key !== from) problems.push({ path: at, message: `${show(from)} is not a canonical repo key (expected <host>/<path> as parseRepoRef(...).key${key ? `, e.g. ${show(key)}` : ""}); \`here\`, \`package\` or a key are the only forms` });
  }
}
/** Schema + domain problems for an oats-local.yaml value: settings[<cap>] may not carry the reserved `byTeam` key. */
export function validateLocal(value) {
  const problems = validateAgainst(schemaFor("local"), value);
  if (isObject(value) && isObject(value.settings)) for (const [cap, payload] of Object.entries(value.settings)) reservedKeyProblems(payload, `/settings/${pointerKey(cap)}`, problems);
  return problems;
}

/* ───────────────────────────── file decoding ──────────────────────────── */

const FILE_KINDS = {
  workspace: { file: "oats-workspace.yaml", validate: validateWorkspace },
  membership: { file: "oats-membership.yaml", validate: validateMembership },
  soul: { file: "soul.yaml", validate: validateSoul },
  local: { file: "oats-local.yaml", validate: validateLocal },
};

/** Decode YAML/JSON bytes into plain data; syntax errors become one problem at "". */
function decodeDocument(bytes, origin) {
  try { return { value: parseConfigData(bytes, { origin }) .value }; }
  catch (e) { return { problems: [{ path: "", message: `cannot decode ${origin.path}: ${e.message}` }] }; }
}
function schemaHint(kind, value) {
  if (isObject(value) && value.schemaVersion !== 2) {
    return ` (this kernel reads ${FILE_KINDS[kind].file} schemaVersion 2 only; found ${show(value.schemaVersion)})`;
  }
  return "";
}
/** Parse + validate a declaration file → { value } | { problems }. Never throws. */
function readDeclaration(kind, bytes, origin, validateOptions) {
  const decoded = decodeDocument(bytes, origin);
  if (decoded.problems) return decoded;
  const problems = FILE_KINDS[kind].validate(decoded.value, validateOptions);
  if (problems.length) return { problems, value: decoded.value };
  return { value: decoded.value };
}
function schemaError(kind, origin, problems, value) {
  const where = origin.repoKey ? `${origin.repoKey}@${(origin.commit || "").slice(0, 12)}:${origin.path}` : origin.path;
  // A single-cause refusal (reserved-key, …) surfaces its reason on details for callers that branch on it.
  const reasons = new Set(problems.map((p) => p.reason).filter(Boolean));
  return fail("E_WORKSPACE_SCHEMA", `${FILE_KINDS[kind].file} at ${where} is invalid${schemaHint(kind, value)}: ${problems.map((p) => `${p.path || "/"}: ${p.message}`).join("; ")}`, {
    path: origin.path, repoKey: origin.repoKey, commit: origin.commit, problems, ...(reasons.size === 1 ? { reason: [...reasons][0] } : {}),
  });
}

/* ───────────────────────────── public API ─────────────────────────────── */

/** Walk up from dir to find oats-local.yaml → { path, local } | E_LOCAL_MISSING. */
export function loadLocal(dir) {
  let current = resolve(dir);
  const visited = [];
  for (;;) {
    const candidate = join(current, "oats-local.yaml");
    visited.push(candidate);
    if (existsSync(candidate)) {
      const origin = { kind: "local", path: candidate };
      const read = readDeclaration("local", readFileSync(candidate), origin);
      if (read.problems) throw schemaError("local", origin, read.problems, read.value);
      return { path: candidate, local: read.value };
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw fail("E_LOCAL_MISSING", `no oats-local.yaml found walking up from ${resolve(dir)}`, { dir: resolve(dir), searched: visited });
}

/** Observe the workspace host: → { key, url, commit, workspace, observedAt }. */
export async function observeWorkspace(ref, { at, remote: injected, remoteOptions } = {}) {
  const remote = remoteOf({ remote: injected, remoteOptions });
  const obs = await remote.observeRemote(ref, { at });
  const path = "oats-workspace.yaml";
  const origin = { kind: "workspace", repoKey: obs.key, commit: obs.commit, path };
  let bytes;
  try { ({ bytes } = await remote.readRemoteFile(ref, obs.commit, path)); }
  catch (e) {
    // Contract: observeWorkspace throws E_REMOTE_UNREADABLE | E_WORKSPACE_SCHEMA. A repo without the
    // file is not a workspace (the usual mistake: a member handed in as the workspace).
    if (e?.code === "E_REMOTE_PATH_MISSING") throw fail("E_WORKSPACE_SCHEMA", `${obs.key}@${obs.commit.slice(0, 12)} has no ${path}: it is not a workspace host`, { path, notAHost: true, repoKey: obs.key, commit: obs.commit, problems: [{ path: "", message: `${path} is missing` }], cause: e.code });
    throw e;
  }
  const read = readDeclaration("workspace", bytes, origin, { remote });
  if (read.problems) throw schemaError("workspace", origin, read.problems, read.value);
  return { key: obs.key, url: obs.url, ref, commit: obs.commit, workspace: read.value, observedAt: obs.observedAt };
}

const unconfirmed = (key, reason, detail, extra = {}) => ({ key, confirmed: false, reason, detail, ...extra });

/**
 * Read the member's oats-membership.yaml at its default branch in the same access context.
 * → { key, commit, confirmed: true, team } | { key, confirmed: false, reason, detail }
 */
export async function confirmMembership(workspaceObs, memberRef, { remote: injected, remoteOptions } = {}) {
  const remote = remoteOf({ remote: injected, remoteOptions });
  const workspace = workspaceObs.workspace;
  const wsProblems = validateWorkspace(workspace, { remote });
  if (wsProblems.length) throw schemaError("workspace", { kind: "workspace", repoKey: workspaceObs.key, commit: workspaceObs.commit, path: "oats-workspace.yaml" }, wsProblems, workspace);
  let key;
  try { key = refKey(remote, memberRef); }
  catch (e) {
    if (e?.code === "E_REPO_REF") return unconfirmed(typeof memberRef === "string" ? memberRef : String(memberRef), "not-listed", `${show(memberRef)} is not a repo ref: ${e.message}`);
    throw e;
  }
  const listed = (workspace.members || []).some((m) => refKey(remote, m) === key);
  if (!listed) return unconfirmed(key, "not-listed", `${key} is not in members of workspace ${workspaceObs.key}`);
  const cannotRead = (e) => unconfirmed(key, "cannot-read", `cannot read ${e.details?.url ?? e.provenance?.url ?? memberRef}${e.details?.reason ? ` (${e.details.reason})` : ""}`, { url: e.details?.url ?? e.provenance?.url ?? null });
  let obs;
  try { obs = await remote.observeRemote(memberRef); }
  catch (e) {
    if (e?.code === "E_REMOTE_UNREADABLE") return cannotRead(e);
    throw e;
  }
  let bytes;
  try { ({ bytes } = await remote.readRemoteFile(memberRef, obs.commit, "oats-membership.yaml")); }
  catch (e) {
    if (e?.code === "E_REMOTE_PATH_MISSING") return unconfirmed(key, "no-backlink", `${key}@${obs.commit.slice(0, 12)} has no oats-membership.yaml`, { commit: obs.commit });
    if (e?.code === "E_REMOTE_UNREADABLE") return cannotRead(e);
    // Contract: NEVER throws for an unconfirmed member. Anything else the remote refuses about the
    // member's file (oversize, symlink, unsafe tree) means the repo has not completed the handshake.
    if (typeof e?.code === "string" && e.code.startsWith("E_REMOTE_")) return unconfirmed(key, "no-backlink", `${key}@${obs.commit.slice(0, 12)} oats-membership.yaml cannot be used: ${e.message}`, { commit: obs.commit, cause: e.code });
    throw e;
  }
  const read = readDeclaration("membership", bytes, { kind: "membership", repoKey: key, commit: obs.commit, path: "oats-membership.yaml" });
  if (read.problems) return unconfirmed(key, "no-backlink", `${key}@${obs.commit.slice(0, 12)} oats-membership.yaml is invalid: ${read.problems.map((p) => `${p.path || "/"}: ${p.message}`).join("; ")}`, { commit: obs.commit, problems: read.problems });
  let backlinkKey;
  try { backlinkKey = refKey(remote, read.value.workspace); }
  catch (e) {
    if (e?.code === "E_REPO_REF") return unconfirmed(key, "no-backlink", `${key}@${obs.commit.slice(0, 12)} oats-membership.yaml names an unparseable workspace ${show(read.value.workspace)}`, { commit: obs.commit });
    throw e;
  }
  if (backlinkKey !== workspaceObs.key) {
    const caseOnly = backlinkKey.toLowerCase() === workspaceObs.key.toLowerCase();
    return unconfirmed(key, "backlink-elsewhere", `${key}@${obs.commit.slice(0, 12)} names workspace ${backlinkKey}, not ${workspaceObs.key}${caseOnly ? " (the keys differ only by letter case: repo paths are case-sensitive identities; spell the workspace ref exactly as the workspace lists itself)" : ""}`, { commit: obs.commit, backlink: backlinkKey, ...(caseOnly ? { caseOnly: true } : {}) });
  }
  return { key, commit: obs.commit, confirmed: true, team: read.value.team ?? null };
}

/* ───────────────────────────── enumeration ────────────────────────────── */

const SOUL_FILE = /^([^/]+)\/soul\.yaml$/;
const CAP_FILE = /^([^/]+)\/oats\.json$/;
const teamOf = (item, fallback) => (typeof item?.team === "string" ? item.team : fallback ?? null);

/**
 * Enumerate souls/*\/soul.yaml and capabilities/*\/oats.json of one repo at one commit.
 * Validates each item; collects problems instead of aborting.
 * → { souls: [SoulEntry], capabilities: [CapEntry], problems: [{ code, path, message, repoKey }] }
 */
async function enumerateRepo(remote, ref, key, commit, { defaultTeam = null, teams = null } = {}) {
  const souls = [];
  const capabilities = [];
  const problems = [];
  const problem = (code, path, message) => problems.push({ code, repoKey: key, path, message });
  const checkTeam = (team, path) => {
    if (team !== null && teams && !teams.includes(team)) problem("E_TEAM_UNKNOWN", path, `team ${show(team)} is not declared in the workspace's teams (${teams.join(", ") || "none"})`);
  };
  // A listing failure on one directory is a problem of THIS repo, never an abort of the whole picture.
  const list = async (dir) => {
    try { return await remote.listRemoteTree(ref, commit, dir, { depth: 2 }); }
    catch (e) {
      if (typeof e?.code === "string" && e.code.startsWith("E_REMOTE_")) { problem(e.code, dir, e.message); return []; }
      throw e;
    }
  };
  const soulNames = new Map();
  for (const entry of await list("souls")) {
    const m = entry.type === "blob" && SOUL_FILE.exec(entry.path);
    if (!m) continue;
    const path = `souls/${m[1]}`;
    const file = `${path}/soul.yaml`;
    let bytes;
    try { ({ bytes } = await remote.readRemoteFile(ref, commit, file)); }
    catch (e) { problem(e?.code || "E_REMOTE_UNREADABLE", file, e.message); continue; }
    const read = readDeclaration("soul", bytes, { kind: "soul", repoKey: key, commit, path: file });
    if (read.problems) { for (const p of read.problems) problem("E_WORKSPACE_SCHEMA", `${file}#${p.path}`, `${p.message}${schemaHint("soul", read.value)}`); continue; }
    const definition = read.value;
    if (definition.name !== m[1]) problem("E_WORKSPACE_SCHEMA", `${file}#/name`, `soul name ${show(definition.name)} does not match its directory ${show(m[1])}`);
    if (soulNames.has(definition.name)) { problem("E_WORKSPACE_SCHEMA", `${file}#/name`, `soul name ${show(definition.name)} is already declared by ${soulNames.get(definition.name)}; the second declaration is not listed`); continue; }
    soulNames.set(definition.name, file);
    const team = teamOf(definition, defaultTeam);
    checkTeam(team, `${file}#/team`);
    souls.push({ name: definition.name, path, repoKey: key, commit, team, private: definition.private === true, definition });
  }
  const capNames = new Map();
  for (const entry of await list("capabilities")) {
    const m = entry.type === "blob" && CAP_FILE.exec(entry.path);
    if (!m) continue;
    const path = `capabilities/${m[1]}`;
    const file = `${path}/oats.json`;
    let bytes;
    try { ({ bytes } = await remote.readRemoteFile(ref, commit, file)); }
    catch (e) { problem(e?.code || "E_REMOTE_UNREADABLE", file, e.message); continue; }
    const decoded = decodeDocument(bytes, { kind: "capability", repoKey: key, commit, path: file });
    if (decoded.problems) { for (const p of decoded.problems) problem("E_WORKSPACE_SCHEMA", `${file}#${p.path}`, p.message); continue; }
    const manifest = decoded.value;
    // The fields discovery relies on. `capability` uses the SAME grammar as every `capabilities:` key
    // in soul.yaml / oats-workspace.yaml (capabilityName): a name that cannot be referenced is not
    // discoverable, and a name with `/` or `..` never becomes a module directory.
    const shape = validateAgainst({
      type: "object", required: ["capability", "version"],
      properties: {
        capability: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]*$" },
        version: { type: "string", minLength: 1 },
        private: { type: "boolean" },
        team: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]*$" },
        layer: { enum: ["knowledge", "messaging", "tasks"] },
      },
    }, manifest);
    if (shape.length) { for (const p of shape) problem("E_WORKSPACE_SCHEMA", `${file}#${p.path}`, p.message); continue; }
    // The kernel contract (launch environment, hooks): a manifest the kernel could not run is not listed.
    const contract = manifestContractProblems(manifest);
    if (contract.length) { for (const p of contract) problem("E_WORKSPACE_SCHEMA", `${file}#${p.pointer}`, p.message); continue; }
    if (capNames.has(manifest.capability)) { problem("E_WORKSPACE_SCHEMA", `${file}#/capability`, `capability ${show(manifest.capability)} is already declared by ${capNames.get(manifest.capability)}; the second declaration is not listed`); continue; }
    capNames.set(manifest.capability, file);
    const team = teamOf(manifest, defaultTeam);
    checkTeam(team, `${file}#/team`);
    capabilities.push({ name: manifest.capability, path, repoKey: key, commit, team, private: manifest.private === true, manifest });
  }
  // Non-collapse rule: a member's oats-package/ is REPORTED (publishes), never enumerated as member capabilities.
  let publishes = null;
  try {
    const { bytes } = await remote.readRemoteFile(ref, commit, "oats-package/oats-package.json");
    const decoded = decodeDocument(bytes, { kind: "package", repoKey: key, commit, path: "oats-package/oats-package.json" });
    if (decoded.problems) for (const p of decoded.problems) problem("E_WORKSPACE_SCHEMA", `oats-package/oats-package.json#${p.path}`, p.message);
    else if (isObject(decoded.value) && typeof decoded.value.package === "string") publishes = { package: decoded.value.package, version: typeof decoded.value.version === "string" ? decoded.value.version : null };
    else problem("E_WORKSPACE_SCHEMA", "oats-package/oats-package.json#/package", "package manifest must declare \"package\"");
  } catch (e) {
    if (e?.code !== "E_REMOTE_PATH_MISSING") {
      if (typeof e?.code === "string" && e.code.startsWith("E_REMOTE_")) problem(e.code, "oats-package/oats-package.json", e.message);
      else throw e;
    }
  }
  return { souls, capabilities, publishes, problems };
}

/**
 * Enumerate one readable repo without a workspace view (the standalone input):
 * → { key, commit, membership: <parsed or null>, souls, capabilities, problems }
 */
export async function discoverRepo(ref, { at, remote: injected, remoteOptions } = {}) {
  const remote = remoteOf({ remote: injected, remoteOptions });
  const obs = await remote.observeRemote(ref, { at });
  let membership = null;
  const problems = [];
  try {
    const { bytes } = await remote.readRemoteFile(ref, obs.commit, "oats-membership.yaml");
    const read = readDeclaration("membership", bytes, { kind: "membership", repoKey: obs.key, commit: obs.commit, path: "oats-membership.yaml" });
    if (read.problems) for (const p of read.problems) problems.push({ code: "E_WORKSPACE_SCHEMA", repoKey: obs.key, path: `oats-membership.yaml#${p.path}`, message: p.message });
    else membership = read.value;
  } catch (e) {
    if (e?.code !== "E_REMOTE_PATH_MISSING") throw e;
  }
  const items = await enumerateRepo(remote, ref, obs.key, obs.commit, { defaultTeam: membership?.team ?? null, teams: null });
  return { key: obs.key, commit: obs.commit, membership, ...items, problems: [...problems, ...items.problems] };
}

/**
 * The whole picture in one access context.
 * → { workspace, members: [{ key, commit, confirmed, reason?, team, souls, capabilities, publishes }], external: [...],
 *     problems: [{ code, path, message, repoKey? }] }
 * `publishes` = { package, version } when the member carries oats-package/oats-package.json (informational:
 * the package's capabilities are NOT member capabilities — non-collapse rule), else null.
 */
export async function discoverWorkspace(ref, { at, local, remote: injected, remoteOptions } = {}) {
  const remote = remoteOf({ remote: injected, remoteOptions });
  const wsObs = await observeWorkspace(ref, { at, remote });
  const workspace = wsObs.workspace;
  const teams = isObject(workspace.teams) ? Object.keys(workspace.teams) : [];
  const problems = [];
  const members = [];
  for (const memberRef of workspace.members || []) {
    const confirmation = await confirmMembership(wsObs, memberRef, { remote });
    const row = { key: confirmation.key, commit: confirmation.commit ?? null, confirmed: confirmation.confirmed, team: confirmation.team ?? null, souls: [], capabilities: [], publishes: null };
    if (!confirmation.confirmed) {
      // Contract: an unconfirmed member contributes nothing but its row.
      row.reason = confirmation.reason;
      row.detail = confirmation.detail;
      members.push(row);
      continue;
    }
    if (row.team !== null && !teams.includes(row.team)) problems.push({ code: "E_TEAM_UNKNOWN", repoKey: row.key, path: "oats-membership.yaml#/team", message: `team ${show(row.team)} is not declared in the workspace's teams (${teams.join(", ") || "none"})` });
    const items = await enumerateRepo(remote, memberRef, row.key, row.commit, { defaultTeam: row.team, teams });
    row.souls = items.souls;
    row.capabilities = items.capabilities;
    row.publishes = items.publishes;
    problems.push(...items.problems);
    members.push(row);
  }
  const externalRows = [];
  for (const [index, entry] of (workspace.external || []).entries()) {
    const pin = entry.source.lastIndexOf("@");
    const sourceRef = entry.source.slice(0, pin);
    const commit = entry.source.slice(pin + 1);
    const file = `${entry.soul.replace(/\/+$/, "")}/soul.yaml`;
    const pushProblem = (code, path, message) => problems.push({ code, repoKey: null, path: `external/${index}:${path}`, message, source: entry.source });
    let key;
    try { key = refKey(remote, sourceRef); }
    catch (e) { if (e?.code === "E_REPO_REF") { pushProblem("E_REPO_REF", "source", e.message); continue; } throw e; }
    let bytes;
    try {
      // Pinned: read at the declared OID only; the remote's default branch is never consulted.
      ({ bytes } = await remote.readRemoteFile(sourceRef, commit, file));
    } catch (e) {
      if (e?.code === "E_REMOTE_UNREADABLE" || e?.code === "E_REMOTE_PATH_MISSING") { pushProblem(e.code, file, e.message); continue; }
      throw e;
    }
    const read = readDeclaration("soul", bytes, { kind: "soul", repoKey: key, commit, path: file });
    if (read.problems) { for (const p of read.problems) pushProblem("E_WORKSPACE_SCHEMA", `${file}#${p.path}`, `${p.message}${schemaHint("soul", read.value)}`); continue; }
    const team = teamOf(entry, null) ?? teamOf(read.value, null);
    if (team !== null && !teams.includes(team)) pushProblem("E_TEAM_UNKNOWN", `${file}#/team`, `team ${show(team)} is not declared in the workspace's teams`);
    externalRows.push({ source: entry.source, key, commit, soul: { name: read.value.name, path: entry.soul, repoKey: key, commit, team, private: read.value.private === true, definition: read.value } });
  }
  return { workspace, key: wsObs.key, url: wsObs.url, commit: wsObs.commit, observedAt: wsObs.observedAt, local: local ?? null, members, external: externalRows, problems };
}

/**
 * For a readable MEMBER whose workspace cannot be read (decision 10): its souls with from:here
 * capabilities only. `discovery` is the repo's own enumeration (discoverRepo(...) or a
 * discoverWorkspace(...) result containing the repo); workspace defaults do not apply and are
 * not known here. Membership itself (oats-membership.yaml present) is the CALLER's gate —
 * discoverOrStandalone refuses a repo with no backlink (E_MEMBERSHIP_UNCONFIRMED no-backlink)
 * before ever building this view.
 */
/** The capability every standalone spawn gets by default (decision 25). */
export const STANDALONE_DEFAULT_CAPABILITY = "oats.core";
export function standaloneRepo(ref, commit, discovery, { remote: injected } = {}) {
  const remote = remoteOf({ remote: injected });
  const key = refKey(remote, ref);
  if (!discovery) throw fail("E_MEMBERSHIP_UNCONFIRMED", `standaloneRepo needs the repo's enumeration (discoverRepo) for ${key}`, { key, commit, reason: "cannot-read" });
  const source = Array.isArray(discovery.members) ? discovery.members.find((m) => m.key === key) : discovery;
  if (!source || (source.key && source.key !== key)) throw fail("E_MEMBERSHIP_UNCONFIRMED", `discovery does not describe ${key}`, { key, commit, reason: "cannot-read" });
  if (source.commit && commit && source.commit !== commit) throw fail("E_MEMBERSHIP_UNCONFIRMED", `discovery of ${key} is at ${source.commit}, not ${commit}`, { key, commit, observed: source.commit, reason: "cannot-read" });
  const problems = [];
  const capabilities = (source.capabilities || []).filter((c) => c.repoKey === key);
  const capNames = new Set(capabilities.map((c) => c.name));
  const souls = (source.souls || []).filter((s) => s.repoKey === key).map((soul) => {
    // Decision 25: the framework's own operational package is the kernel's default
    // even when the workspace (and its defaults) cannot be read. ANY mention of
    // oats.core in the soul — `{ from: package }`, `{ from: here }`, `{ from: <repo> }`
    // or `off` — suppresses the kernel default: the soul's own choice is then judged
    // by the loop below exactly like every other capability (S4).
    const kept = {};
    const declaredCaps = soul.definition.capabilities || {};
    if (!Object.hasOwn(declaredCaps, STANDALONE_DEFAULT_CAPABILITY)) kept[STANDALONE_DEFAULT_CAPABILITY] = { from: "package" };
    for (const [name, choice] of Object.entries(declaredCaps)) {
      const from = isObject(choice) ? choice.from : null;
      if (choice === "off") continue;
      if (from === "here" || from === key) {
        if (!capNames.has(name)) problems.push({ code: "E_CAPABILITY_MISSING", repoKey: key, path: `${soul.path}/soul.yaml#/capabilities/${pointerKey(name)}`, message: `${key} has no capabilities/*/oats.json declaring ${show(name)}` });
        else kept[name] = { from: "here" };
      } else if (from === "package") {
        // The operator's lock (oats sync against a catalog) is where package
        // capabilities resolve; standalone, only the kernel default is honoured.
        if (name === STANDALONE_DEFAULT_CAPABILITY) { kept[name] = { from: "package" }; continue; }
        problems.push({ code: "E_PACKAGE_MISSING", repoKey: key, path: `${soul.path}/soul.yaml#/capabilities/${pointerKey(name)}`, message: `${show(name)} comes from a package, but the workspace's packages cannot be read standalone` });
      } else {
        problems.push({ code: "E_NOT_A_MEMBER", repoKey: key, path: `${soul.path}/soul.yaml#/capabilities/${pointerKey(name)}`, message: `${show(name)} comes from ${show(from)}, which cannot be confirmed as a member without the workspace` });
      }
    }
    return { ...soul, capabilities: kept };
  });
  return {
    standalone: true, key, commit: source.commit ?? commit ?? null, workspace: null,
    members: [{ key, commit: source.commit ?? commit ?? null, confirmed: false, reason: "cannot-read", detail: `workspace of ${key} cannot be read; standalone view`, team: source.team ?? source.membership?.team ?? null, souls, capabilities, publishes: source.publishes ?? null }],
    external: [], problems,
  };
}
