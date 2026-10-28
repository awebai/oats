/** The souls under an agents root and the homes of an instance name among them: listAgents reads each
 *  soul.yaml (the flat reader, and the YAML parser for a workspace-model soul), findInstanceHomes finds
 *  the homes contained in them. A leaf (awebai/oats#1630): `oats instance events` and `instance waiting`
 *  resolve a home without loading core.mjs, which re-exports these. */
import { existsSync, realpathSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname, basename, resolve, isAbsolute } from "node:path";
import { oatsError } from "./errors.mjs";
import { parseConfigData } from "./config-data.mjs";

export const RESERVED = new Set(["bin"]);

/** The agent dirs directly under an agents root that hold no soul: capability-defined
 *  agents (their soul is read-only in a module; the dir holds only instances/). */
function capabilityAgentDirs(root) {
  let entries; try { entries = readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && !RESERVED.has(e.name) && !existsSync(join(root, e.name, "soul", "soul.yaml")))
    .map((e) => ({ name: e.name, dir: join(root, e.name) }));
}

// ---------- yaml-ish ----------
/** `__proto__` is never data in a plain-object mapping: assigning it REWRITES
 * the parsed object's prototype, so the entry vanishes from `Object.keys` —
 * past every key validator — while still answering property reads (a document
 * could smuggle an unvalidated `name:` or `capabilities:` that way). No OATS
 * document has a use for the key, so the readers refuse it rather than parse
 * it: fail closed, never silently drop.
 *
 * THE single refusal, shared by the readers and by every WRITER that assigns an
 * operator-supplied key into a config map — a write path that let the inherited
 * setter swallow the entry and then reported success would be the same defect
 * with a friendlier face. The readers parse strings and cannot name the
 * document, so `where` is filled in by whoever holds the file
 * (`withConfigFile`); the raw message therefore says "mapping key", not
 * "oats-config key" — soul.yaml and skill frontmatter go through here too. */
export function assertSafeConfigKey(key, where) {
  if (key === "__proto__") {
    throw oatsError("unsafe-config-key", `unsupported mapping key "__proto__"${where ? ` in ${where}` : ""} — "__proto__" cannot be a mapping key in an OATS document (it rewrites the parsed object's prototype instead of becoming data)`, where ? [{ file: where }] : undefined);
  }
  return key;
}
/** Run a reader that may raise the typed key refusal and re-raise it naming the
 * FILE. Every caller with a path in hand wraps its read — the readers parse
 * strings and cannot name a document — so the CLI boundary can print one line
 * the operator can act on.
 *
 * The insertion uses a REPLACER FUNCTION, never a replacement string: `$&`,
 * `$'`, `` $` `` and `$1` are substitution syntax in `String.replace`, so a
 * config path containing one of them (`/tmp/$&/oats-config.yaml` — legal on every
 * POSIX filesystem) was expanded against the match and the reported filename
 * came out corrupted. A function receives the path as data. */
export function withConfigFile(file, read) {
  try { return read(); }
  catch (e) {
    if (e?.code !== "unsafe-config-key" || e.provenance) throw e;
    throw oatsError(e.code, e.message.replace(" — ", () => ` in ${file} — `), [{ file }]);
  }
}

const yamlKey = (key) => assertSafeConfigKey(key);
export function parseYamlFlat(text) {
  const o = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*(#.*)?$/);
    if (m) o[yamlKey(m[1])] = m[2].replace(/^["']|["']$/g, "");
  }
  return o;
}

/** The `_`-prefixed namespace on a parsed document belongs to the KERNEL: `_dir`,
 * `_origin`, `_package`, `_capabilityLock`, `_soulDir` … are the
 * kernel's own statements ABOUT an artifact — where it was found, which lock row
 * governs it, whether it is trusted. They are internal annotations, so they must
 * be unforgeable: an artifact that can write them into its own on-disk document
 * asserts its own provenance. That was reachable — a capability whose `oats.json`
 * declared `"_capabilityLock": {...}` spread straight through `{ ...m }` and
 * silenced doctor's "in installed/ but has no lock entry" warning for an
 * artifact nothing locks.
 *
 * So every parsed document that later RECEIVES annotations is stripped first.
 * Stripping (rather than refusing) keeps the reader tolerant of documents that
 * merely carry an unknown underscore key, while making the namespace
 * unreachable from disk.
 *
 * `__proto__` starts with `_`, so a JSON document's own `__proto__` key is
 * dropped here too rather than re-assigned through the inherited setter. */
/** A flat soul.yaml names its harness `harness:` (0.27.0) or, as released
 *  souls and capability-defined agents do (oats.aweb 1.13.1), `runtime:` —
 *  set both, read either until no released package writes `runtime`. Both,
 *  disagreeing, is refused. Returns the soul with `harness` only. */
export function soulHarnessField(soul, file) {
  if (!soul || !Object.hasOwn(soul, "runtime")) return soul;
  const { runtime, ...rest } = soul;
  if (Object.hasOwn(soul, "harness") && soul.harness !== runtime) {
    throw oatsError("E_BAD_MANIFEST", `${file} declares harness: ${soul.harness} and runtime: ${runtime}; \`runtime\` is the pre-0.27 name of \`harness\` — keep one`, { file, harness: soul.harness, runtime });
  }
  return { ...rest, harness: Object.hasOwn(soul, "harness") ? soul.harness : runtime };
}
export function stripInternalAnnotations(parsed) {
  const out = {};
  for (const key of Object.keys(parsed)) if (!key.startsWith("_")) out[key] = parsed[key];
  return out;
}

// ---------- agents ----------
function soulOf(agentDir) { return join(agentDir, "soul"); }
function readSoul(agentDir, soulDir = soulOf(agentDir)) {
  const p = join(soulDir, "soul.yaml");
  if (!existsSync(p)) return undefined;
  // Stripped before annotation: `_soulDir` is consumed as "the read-only soul
  // inside a package" (spawn, roster) and `_dir` as the agent home, so a
  // soul.yaml that could declare either would be describing itself to the
  // kernel. See stripInternalAnnotations.
  const text = readFileSync(p, "utf8");
  const flat = withConfigFile(p, () => parseYamlFlat(text));
  // A workspace-model soul.yaml (schemaVersion 2) nests maps (capabilities,
  // knowledge …): the flat reader would turn them into "" and the version into a
  // string. It is read with the real parser; a classic soul keeps the flat reader.
  let parsed = flat;
  if (flat.schemaVersion === "2") {
    try { const v = parseConfigData(text, { format: "yaml" }).value; if (v && typeof v === "object" && !Array.isArray(v)) parsed = v; }
    catch { /* unreadable as YAML: the flat view is what the classic readers saw */ }
  }
  const soul = soulHarnessField(stripInternalAnnotations(parsed), p);
  soul._dir = agentDir;
  // A package soul homes at <package>--<soul> (lib/workspace.mjs packageSoulAgentName): that
  // directory, not the soul.yaml name, is its agent name, so its instances never share a
  // member soul's name or roster row.
  soul.name = basename(agentDir).includes("--") ? basename(agentDir) : (soul.name || basename(agentDir));
  return soul;
}

export function listAgents(root) {
  const agents = [];
  const scan = (base, kind) => {
    if (!existsSync(base)) return;
    for (const e of readdirSync(base, { withFileTypes: true })) {
      if (!e.isDirectory() || (kind === "persistent" && RESERVED.has(e.name))) continue;
      const soul = readSoul(join(base, e.name));
      if (soul) { soul.kind = soul.kind || kind; agents.push(soul); }
    }
  };
  scan(root, "persistent");
  return agents;
}

// Locate an instance home under an agents root, including capability-defined
// agents homing under <root>/<name>/ WITHOUT a soul there (listAgents cannot
// see those). Shared by retireInstance and `oats spawn --parent`.
// SECURITY: `name` is caller-controlled (CLI args, API bodies). It must be a
// plain instance name — reject path separators/dots up front, and verify the
// hit resolves to an IMMEDIATE child of an instances/ dir (realpath
// containment), or `oats retire ../../dev/soul` would existence-match and
// recursively delete a canonical soul.
const INSTANCE_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/** ALL homes matching an instance name under one agents root. Spawn keeps names
 * unique across the deployment since 0.26.0, but homes from earlier kernels (a
 * generated-name collision like `dev --purpose foo-1` vs agent `dev-foo`) and
 * direct kernel callers passing `instance` can still share one.
 * Ambiguity-sensitive callers must use this, not first-match. Same
 * containment/charset guarantees as findInstanceHome. */
export function findInstanceHomes(root, name) {
  if (typeof name !== "string" || !INSTANCE_NAME_RE.test(name)) return [];
  const contained = (agentDir) => {
    const home = join(agentDir, "instances", name);
    if (!existsSync(home)) return undefined;
    try {
      const real = realpathSync(home);
      if (dirname(real) !== realpathSync(join(agentDir, "instances")) || basename(real) !== name) return undefined;
    } catch { return undefined; }
    return home;
  };
  const out = [];
  const seen = new Set();
  const push = (agent, home) => {
    // Dedupe by canonical home so all-matches callers never see double hits.
    let key; try { key = realpathSync(home); } catch { key = resolve(home); }
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ agent, home });
  };
  for (const a of listAgents(root)) {
    const home = contained(a._dir);
    if (home) push(a, home);
  }
  for (const { name: agentName, dir } of capabilityAgentDirs(root)) {
    const home = contained(dir);
    if (home) push({ name: agentName, kind: "capability", _dir: dir }, home);
  }
  return out;
}

/** The working directory as the shell names it: $PWD when it is the process's own directory, else
 *  the physical cwd. A path through a symlink (an attached instance's work/, which links into its
 *  owner's tree) then still belongs to the instance it was entered from. */
export function logicalCwd() {
  const cwd = process.cwd(), pwd = process.env.PWD;
  try { if (pwd && isAbsolute(pwd) && realpathSync(pwd) === realpathSync(cwd)) return pwd; } catch { /* a stale PWD */ }
  return cwd;
}
/** The instance home enclosing `dir` (itself or its nearest such ancestor): a directory laid out
 *  as <agents-root>/<agent>/instances/<name> whose instance.json records `instance: <name>`.
 *  For a process whose harness strips the session env (Codex's shared app-server daemon runs
 *  tool commands outside the session); the caller validates the home as it does one named by
 *  OATS_INSTANCE_HOME. undefined when no such directory encloses `dir`. */
export function enclosingInstanceHome(dir) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (basename(dirname(d)) === "instances" && INSTANCE_NAME_RE.test(basename(d))) {
      try { if (JSON.parse(readFileSync(join(d, "instance.json"), "utf8"))?.instance === basename(d)) return d; }
      catch { /* no readable instance.json: not a home */ }
    }
    if (dirname(d) === d) return undefined;
  }
}

export { INSTANCE_NAME_RE, capabilityAgentDirs, readSoul, soulOf, yamlKey };
