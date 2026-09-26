/**
 * lib/core.mjs — runtime-neutral OATS library (souls & instances, config cascade,
 * capabilities, lifecycle hooks). No pi imports: consumed by both the standalone
 * `oats` CLI (bin/oats.mjs) and the pi extension adapter (extension/index.ts).
 *
 * An "agents root" is the CLOSEST directory named `agents/` found by walking up
 * from cwd (or $PI_AGENTS_ROOT). The root's parent is the "workspace" (scope);
 * soul `repo` paths resolve relative to it. On the workspace model it is
 * <deployment>/agents/.
 *
 * Layout:
 *   <scope>/agents/<agent>/soul/       canonical body: soul.yaml, AGENTS.md (canonical; CLAUDE.md → AGENTS.md),
 *                                      skills/, knowledge/ (OKF bundle)
 *   <scope>/agents/<agent>/instances/<inst>/  instance HOME: generated AGENTS.md, CLAUDE.md → AGENTS.md,
 *                                      .agents/skills (canonical; .claude/skills → ../.agents/skills); no soul link —
 *                                      instance.json soulDir records the soul directory,
 *                                      work/ (worktree or symlink), TASK.md, STATE.md, log.md, notes/, instance.json
 *   <scope>/agents/<agent>/instances/  a capability-defined agent (its soul is read-only in its
 *                                      module): the dir holds only instances/.
 *   <scope>/local-agents/              OATS 0.25 and earlier: never read, spawned into or retired
 *                                      from; only detected (status/doctor report it as
 *                                      `legacy-local-agents`).
 *
 * soul.yaml (flat key: value):
 *   name, description, kind (persistent|local), type (optional agent-type/family, targeted by config),
 *   repo (path rel. to workspace or absolute),
 *   work (worktree|checkout|attached|workspace|directory), harness (pi|claude|codex), model (pi model pattern, optional)
 *   (attached as soul default is for service agents — spawn must supply workDir)
 */
import { execFileSync, execSync, spawn as spawnProcess, spawnSync } from "node:child_process";
import {
  chmodSync, closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { accessSync, constants as fsConstants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { initializeNativeHistory, prepareNativeStart } from "../packages/record/lib/native-history.mjs";
import { noteRuntimeName } from "./deprecation.mjs";
import { attachSessionTarget } from "./session-viewer.mjs";
import { inspectSessionTarget, inputSessionTarget } from "./session-input.mjs";
import { appendEvent } from "./instance-events.mjs";
import { killGroup } from "./process-group.mjs";
import { ensureHerdr, allocateHerdr, launchHerdr, inspectHerdr, stopHerdr, validHerdrTarget, herdrSnapshot, herdrCommand } from "./herdr.mjs";

import { oatsError } from "./errors.mjs";
async function materializePreparedDefault(prepared, home) { const m = await import("./instance-resolution.mjs"); return m.materializePrepared(prepared, home); }
// Capability rows for a PREPARED spawn (workspace model): the one function that
// turns a Resolution's modules into the row shape hooks/environment/requirements/
// retirement consume. Called twice per spawn — PLANNED before the home exists
// (manifest, settings, origin, trust; no skills/inject since the copies are not
// there yet) and REBUILT after materialize against what actually landed. Static
// import: instance-resolution.mjs does not depend on core.mjs (no cycle).
import { toCapabilityRows } from "./instance-resolution.mjs";
import { loadLocal } from "./workspace.mjs";
import { parseConfigData } from "./config-data.mjs";
import { renderInstructionText } from "./instruction-composition.mjs";
import { APPROVED_HOOKS, PORTABLE_ENV_NAME_RE, CORE_LAUNCH_ENV, PROCESS_BOOTSTRAP_ENV, PROCESS_BOOTSTRAP_PREFIXES, manifestContractProblems } from "./capability-contract.mjs";
import { validateBindingInterface } from "./provider-binding.mjs";
/** Retirement/rollback tree fingerprint (exported for scope tests: kernel-field neutrality is opt-in per instance home). */
export { fingerprintTree };

import { canonicalJson, parseStrictJson } from "./canonical-json.mjs";
import { readPortableBytes } from "./bounded-read.mjs";
import { copyTreeSafe } from "./tree-copy.mjs";
/** The package and capability id grammar (namespaced, lowercase): an id names a
 *  directory (a home's module copy), so no path spelling fits it. */
const PACKAGE_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
// Keep the existing public core surface; internal data helpers are not re-exported.
export { oatsError } from "./errors.mjs";
export { copyTreeSafe } from "./tree-copy.mjs";

export const RESERVED = new Set(["bin"]);
/** The work modes spawn accepts — also the enum a quarantine cleanup descriptor
 * must satisfy, so the retry cannot skip Git cleanup on an unrecognised value. */
export const WORK_MODES = ["worktree", "checkout", "attached", "workspace", "directory"];
/** OATS 0.25 and earlier homed local souls and capability-defined agents at
 *  <scope>/local-agents/ (and <root>/local-agents|tmp-agents). The kernel never reads,
 *  spawns into or retires from them; it only detects them: `legacyLocalAgents` names
 *  what is left there so status/doctor say so. */
const LEGACY_LOCAL_AGENTS_DIR = "local-agents";
/** The agent dirs directly under an agents root that hold no soul: capability-defined
 *  agents (their soul is read-only in a module; the dir holds only instances/). */
function capabilityAgentDirs(root) {
  let entries; try { entries = readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && !RESERVED.has(e.name) && !existsSync(join(root, e.name, "soul", "soul.yaml")))
    .map((e) => ({ name: e.name, dir: join(root, e.name) }));
}
/** What OATS 0.25 left under <scope>/local-agents/ (and the nested <root>/local-agents|
 *  tmp-agents) for the agents root `root`: one `legacy-local-agents` problem naming the
 *  instance homes there, or null. Names only — nothing there is read, spawned into or
 *  retired from. */
export function legacyLocalAgents(root) {
  if (!root) return null;
  const bases = [join(dirname(root), LEGACY_LOCAL_AGENTS_DIR), join(root, LEGACY_LOCAL_AGENTS_DIR), join(root, "tmp-agents")];
  const dirs = [], instances = [];
  const subdirs = (d) => { try { return readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name); } catch { return []; } };
  for (const base of bases) {
    let st; try { st = lstatSync(base); } catch { continue; }
    if (!st.isDirectory()) continue;
    dirs.push(base);
    for (const agent of subdirs(base)) for (const inst of subdirs(join(base, agent, "instances"))) instances.push(inst);
  }
  if (!dirs.length) return null;
  instances.sort();
  return { code: "legacy-local-agents", dirs, instances,
    message: `${instances.length} instance home${instances.length === 1 ? "" : "s"} under local-agents/ ${instances.length === 1 ? "is" : "are"} from OATS 0.25 and ${instances.length === 1 ? "is" : "are"} not managed by this kernel; retire ${instances.length === 1 ? "it" : "them"} with the 0.25 kernel or delete the directory once ${instances.length === 1 ? "it is" : "they are"} stopped${instances.length ? ` (${instances.join(", ")})` : ""}` };
}
/** The captured homes (the 0.24–0.25 captured/portable path, removed in 0.26) under the
 *  agents root `root`: one `legacy-captured-home` problem naming them, or null. They have
 *  no 0.26 runtime (start, inspect and in-home commands refuse them); retire still works. */
export function legacyCapturedHomes(root) {
  if (!root) return null;
  const subdirs = (d) => { try { return readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name); } catch { return []; } };
  const homes = [];
  for (const agent of subdirs(root)) for (const inst of subdirs(join(root, agent, "instances"))) {
    const home = join(root, agent, "instances", inst);
    let meta; try { meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8")); } catch { continue; }
    if (isCapturedHome(meta)) homes.push({ instance: inst, home });
  }
  if (!homes.length) return null;
  homes.sort((a, b) => a.instance.localeCompare(b.instance));
  const one = homes.length === 1;
  return { code: "legacy-captured-home", instances: homes.map((h) => h.instance), homes: homes.map((h) => h.home),
    message: `${homes.length} captured home${one ? "" : "s"} (0.24–0.25; the captured/portable path was removed in 0.26) ${one ? "has" : "have"} no 0.26 runtime: start, inspect and in-home commands refuse ${one ? "it" : "them"}; retire ${one ? "it" : "them"} (\`oats retire\` still works) and re-spawn from the deployment (${homes.map((h) => h.instance).join(", ")})` };
}
export const DEFAULT_TMUX_SESSION = process.env.PI_AGENTS_TMUX_SESSION || "pi-agents";
/** Package root (this file lives in <pkg>/lib/). */
export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const OATS_VERSION = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")).version;
/** Skills shipped with the kernel. Only oats-getting-started is ambient; spawn composes selected skills locally. */
export const PACKAGED_SKILLS_DIR = join(PKG_ROOT, "skills");

// ---------- shell helpers ----------
function sh(cmdline) { return execSync(cmdline, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function shTry(cmdline) { try { return sh(cmdline); } catch { return undefined; } }
/** A native PROBE (a harness binary asked about its catalogue or packages) under
 *  a preview: bounded by what is left of the shared preflight budget, run in its
 *  own process group and group-killed on timeout. Cheap lookups (`command -v`)
 *  are not probes and never draw from the budget. Outside a preview: shTry. */
function probeTry(cmdline) {
  if (!previewPreflightBudget) return shTry(cmdline);
  const left = previewPreflightBudget.deadline - Date.now();
  if (left <= 0) { previewPreflightBudget.exhausted = true; return undefined; }
  const r = spawnSync("/bin/sh", ["-c", cmdline], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: left, killSignal: "SIGKILL", detached: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/bin/false" } });
  if (r.error || r.signal) { killGroup(r); if (r.error?.code === "ETIMEDOUT" || r.signal === "SIGKILL") previewPreflightBudget.exhausted = true; return undefined; }
  return r.status === 0 ? String(r.stdout).trim() : undefined;
}
let previewPreflightBudget = null;
/** execFileSync for a native probe: under a preview budget, the timeout is what
 *  is left of it and the child is group-killed; otherwise the caller's timeout. */
function probeExecFile(file, args, options = {}) {
  if (!previewPreflightBudget) return execFileSync(file, args, options);
  const left = previewPreflightBudget.deadline - Date.now();
  if (left <= 0) { previewPreflightBudget.exhausted = true; throw Object.assign(new Error("preflight budget exhausted"), { code: "E_PREFLIGHT_BUDGET" }); }
  const r = spawnSync(file, args, { ...options, timeout: Math.min(left, options.timeout ?? left), killSignal: "SIGKILL", detached: true });
  if (r.error || r.signal) { killGroup(r); if (r.error?.code === "ETIMEDOUT" || r.signal === "SIGKILL") previewPreflightBudget.exhausted = true; throw r.error || Object.assign(new Error("probe killed"), { code: "E_PREFLIGHT_BUDGET" }); }
  if (r.status !== 0) throw Object.assign(new Error(`probe exited ${r.status}`), { status: r.status, stdout: r.stdout });
  return r.stdout;
}
function shIn(cwd, cmdline, timeout = 45000) {
  return execSync(cmdline, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout }).trim();
}
function shInTry(cwd, cmdline, timeout) { try { return shIn(cwd, cmdline, timeout); } catch { return undefined; } }
function shq(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
export function slug(s) {
  const r = String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return r || "agent";
}
function which(bin) { return shTry(`command -v ${shq(bin)}`); }

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
/** Small dependency-free YAML subset used by oats-config.yaml.
 * Supports nested maps, namespaced/quoted keys, booleans, numbers, and inline arrays/maps. */
function yamlScalar(raw) {
  const trimmed = raw.trim();
  // A double-quoted scalar is read with JSON's escape rules (what the CLI
  // writes for values with spaces, quotes or metacharacters); a single-quoted
  // one with YAML's doubled-quote rule. A trailing comment never cuts a
  // quoted value. Anything the escape rules refuse falls back to the raw text
  // between the quotes, as before.
  if (trimmed.startsWith('"')) {
    let i = 1, esc = false;
    for (; i < trimmed.length; i++) { const c = trimmed[i]; if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') break; }
    if (i < trimmed.length) { const q = trimmed.slice(0, i + 1); try { return JSON.parse(q); } catch { return q.slice(1, -1); } }
  }
  if (trimmed.startsWith("'")) {
    let i = 1, out = "";
    for (; i < trimmed.length; i++) { const c = trimmed[i]; if (c === "'") { if (trimmed[i + 1] === "'") { out += "'"; i++; continue; } break; } out += c; }
    if (i < trimmed.length) return out;
  }
  // Inline collections are split quote- and nesting-aware, so an element
  // may carry commas, "#" or nothing at all; a trailing comment after the
  // closing bracket is dropped, one inside quotes is kept.
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const close = inlineCollectionEnd(trimmed);
    if (close > 0) {
      const inner = trimmed.slice(1, close);
      const parts = splitInline(inner);
      if (trimmed[0] === "[") return parts.map((v) => yamlScalar(v));
      const out = {};
      for (const part of parts) {
        const i = inlineKeyEnd(part);
        if (i < 0) continue;
        const key = yamlKey(part.slice(0, i).trim().replace(/^["']|["']$/g, ""));
        out[key] = yamlScalar(part.slice(i + 1));
      }
      return out;
    }
  }
  const val = trimmed.replace(/\s+#.*$/, "").trim();
  if (/^(true|false)$/i.test(val)) return val.toLowerCase() === "true";
  if (/^(null|~)$/i.test(val)) return null;
  if (/^-?\d+(\.\d+)?$/.test(val)) return Number(val);
  return val.replace(/^["']|["']$/g, "");
}
/** Index of the bracket closing the inline collection that opens `s`, or -1. */
function inlineCollectionEnd(s) {
  let depth = 0, quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === "\\" && quote === '"') { i++; continue; } if (c === quote) { if (quote === "'" && s[i + 1] === "'") { i++; continue; } quote = null; } continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}
/** Top-level comma split of an inline collection body (quotes and nesting respected). */
function splitInline(inner) {
  const parts = []; let depth = 0, quote = null, cur = "", any = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) { cur += c; if (c === "\\" && quote === '"') { cur += inner[i + 1] ?? ""; i++; continue; } if (c === quote) { if (quote === "'" && inner[i + 1] === "'") { cur += "'"; i++; continue; } quote = null; } continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; any = true; continue; }
    if (c === "[" || c === "{") depth++; else if (c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) { parts.push(cur); cur = ""; any = true; continue; }
    if (!/\s/.test(c)) any = true;
    cur += c;
  }
  if (any || cur.trim()) parts.push(cur);
  return parts.filter((p, i) => !(i === parts.length - 1 && !p.trim() && !quoteOnly(p)));
}
const quoteOnly = (p) => /^\s*(""|'')\s*$/.test(p);
/** The first ":" of an inline map entry outside quotes. */
function inlineKeyEnd(part) {
  let quote = null;
  for (let i = 0; i < part.length; i++) {
    const c = part[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === ":") return i;
  }
  return -1;
}
export function parseYamlNested(text) {
  const root = {};
  const stack = [{ indent: -1, node: root }];
  for (const raw of text.split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    // A block sequence item ("- value") belongs to the key that opened the
    // current node; the first item turns that node into an array. Items are
    // scalars only (a "- key: value" item is read as the scalar text).
    const seq = raw.match(/^(\s*)-(?:\s+(.*?))?\s*$/);
    if (seq) {
      const indent = seq[1].length;
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
      const top = stack[stack.length - 1];
      if (!Array.isArray(top.node)) {
        if (!top.parent || Object.keys(top.node).length) continue; // not a list position: ignored, as before
        top.node = []; top.parent[top.key] = top.node;
      }
      if (seq[2] !== undefined && seq[2] !== "") top.node.push(yamlScalar(seq[2]));
      continue;
    }
    const m = raw.match(/^(\s*)((?:["'][^"']+["'])|(?:[^:#][^:]*?)):\s*(.*?)\s*$/);
    if (!m) continue;
    const [, ws, rawKey, rawVal] = m;
    const key = yamlKey(rawKey.trim().replace(/^["']|["']$/g, ""));
    const indent = ws.length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (Array.isArray(parent)) continue; // a key line inside a sequence is not part of this subset
    if (rawVal.replace(/\s+#.*$/, "").trim() === "" || rawVal.trim().startsWith("#")) {
      const child = {};
      parent[key] = child;
      stack.push({ indent, node: child, parent, key });
    } else parent[key] = yamlScalar(rawVal);
  }
  return root;
}

// ---------- root discovery ----------
/** Closest agents/ walking up from `cwd`. A deployment whose agents/ was never
 * created has no root here; ensureRoot names the remedy. */
export function findRoot(cwd = process.cwd()) {
  if (process.env.PI_AGENTS_ROOT) return resolve(process.env.PI_AGENTS_ROOT);
  let d = resolve(cwd);
  while (true) {
    if (basename(d) === "agents" && lstatSync(d).isDirectory()) return d;
    const candidate = join(d, "agents");
    if (existsSync(candidate) && lstatSync(candidate).isDirectory()) return candidate;
    const parent = dirname(d);
    if (parent === d) return undefined;
    d = parent;
  }
}
/** realpath of `p`, or — when `p` does not exist yet — the realpath of its
 * nearest existing ancestor with the remaining segments re-appended. Any path
 * decision about WHERE something will be created has to go through this: a
 * lexical path says nothing about the destination once a symlink sits anywhere
 * along it. */
function realPathOrNearest(p) {
  try { return realpathSync(p); } catch { /* not created yet — resolve what exists */ }
  let d = resolve(p); const tail = [];
  while (!existsSync(d) && dirname(d) !== d) { tail.unshift(basename(d)); d = dirname(d); }
  try { return join(realpathSync(d), ...tail); } catch { return resolve(p); }
}

/** Is there a Git marker (`.git` dir or worktree pointer file) at or above `dir`?
 * Filesystem-only: it answers "does Git own this location" even when the git
 * binary is missing, refuses the repo (dubious ownership), or cannot read its
 * metadata — cases where a probe failure must NOT be read as "not a repo". */
function hasGitMarker(dir) {
  let d = resolve(dir);
  while (true) {
    if (existsSync(join(d, ".git"))) return true;
    const parent = dirname(d);
    if (parent === d) return false;
    d = parent;
  }
}

/** Canonicalize any deployment path that determines where an instance HOME is
 * created — the agents root, and the agent directory derived from it.
 *
 * findRoot() walks up from the INVOCATION directory, so the path can sit inside
 * a LINKED git worktree: a human running `oats spawn` from a worktree, or (far
 * more common) an agent that ran `cd ./work` first. Instance homes must live in
 * the soul-owning repo's PRIMARY checkout — `agents/*​/instances/` is gitignored,
 * so a home created in a linked worktree is invisible in status, and it dies
 * with the tree that hosted it.
 *
 * Canonical identity comes from Git, never from a branch name: the FIRST record
 * of `git worktree list --porcelain` is the main worktree. Probes are argv-based
 * (paths may contain shell metacharacters) and read-only.
 *
 * Returns the path unchanged only when Git does not own the location, when it is
 * already in the main worktree, or when it lies outside the work tree it was
 * discovered from. Throws E_NO_CANONICAL_ROOT whenever Git DOES own the location
 * but the primary checkout cannot be established — including a failed probe,
 * which must never pass as "not a repo" (reviewer-2366d09): guessing recreates
 * the very misplacement this exists to prevent.
 */
export function canonicalDeploymentPath(p) {
  if (!p) return p;
  const abs = resolve(p);
  const probe = (argv) => {
    try { return { ok: true, out: execFileSync(argv[0], argv.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
    catch (e) { return { ok: false, err: String(e.stderr || e.message || "").trim() }; }
  };
  // The scope that owns the path. The directory itself may not exist yet
  // (local-only scopes, an agent dir created on first use), so probe from the
  // nearest existing ancestor.
  let scope = dirname(abs);
  while (!existsSync(scope) && dirname(scope) !== scope) scope = dirname(scope);
  const top = probe(["git", "-C", scope, "rev-parse", "--show-toplevel"]);
  if (!top.ok) {
    // A failed probe is NOT evidence of a non-Git scope. Only the absence of any
    // Git marker is — otherwise an unavailable/erroring git would silently let a
    // linked worktree through, which is exactly the fail-open this prevents.
    if (hasGitMarker(scope)) {
      throw oatsError("E_NO_CANONICAL_ROOT", `${abs} is inside a Git-owned location whose repository could not be read (${top.err || "git rev-parse failed"}) — instance homes must live in the soul-owning repo's primary checkout, and OATS cannot confirm this is it; fix the Git error or pass --dir <primary checkout>`);
    }
    return abs;                                  // genuinely not a Git work tree
  }
  const toplevel = top.out.trim();
  if (!toplevel) return abs;
  // Git reports CANONICAL paths, so every comparison and every relative()
  // below must be realpath-based: on macOS a temp/agents root reached through
  // /var while Git reports /private/var would otherwise look "outside" the
  // work tree and silently skip canonicalization. The agents dir itself may
  // not exist yet (local-only scopes), so resolve the nearest existing
  // ancestor and re-append the remainder.
  const realOf = realPathOrNearest;
  const same = (a, b) => realOf(a) === realOf(b);
  // Linked or main? `--git-dir` equals `--git-common-dir` in the MAIN worktree
  // and points at <common>/worktrees/<name> in a linked one. This settles it
  // without `git worktree list`, so the overwhelmingly common main-checkout
  // path costs one probe and — crucially — cannot be failed by a hiccup in a
  // command it does not need (a forced `worktree list` failure used to reject
  // an ordinary main-checkout spawn).
  const dirs = probe(["git", "-C", scope, "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"]);
  const [gitDir, commonDir] = dirs.ok
    ? dirs.out.trim().split("\n").map((l) => l.trim())
    // Pre-2.31 git has no --path-format: fall back to plain output, whose paths
    // may be relative to the scope.
    : (() => {
      const plain = probe(["git", "-C", scope, "rev-parse", "--git-dir", "--git-common-dir"]);
      if (!plain.ok) return [];
      return plain.out.trim().split("\n").map((l) => resolve(scope, l.trim()));
    })();
  if (!gitDir || !commonDir) {
    throw oatsError("E_NO_CANONICAL_ROOT", `${abs} is inside the Git work tree ${toplevel}, but OATS could not tell a linked worktree from the primary checkout (${dirs.err || "git rev-parse --git-dir/--git-common-dir failed"}) — instance homes must live in the soul-owning repo's primary checkout; fix the Git error or pass --dir <primary checkout>`);
  }
  // Main checkout: the common case, and the one that must stay free — returned
  // untouched, in the caller's own path form.
  if (same(gitDir, commonDir)) return abs;
  // Linked worktree from here on — the primary checkout is REQUIRED, not optional.
  const list = probe(["git", "-C", scope, "worktree", "list", "--porcelain", "-z"]);
  const mainWorktree = list.ok
    ? (list.out.split("\0").find((f) => f.startsWith("worktree ")) || "").slice("worktree ".length)
    : undefined;
  if (!list.ok) throw oatsError("E_NO_CANONICAL_ROOT", `${abs} is inside the linked Git worktree ${toplevel}, and the primary checkout could not be determined (${list.err || "git worktree list failed"}) — instance homes must live in the soul-owning repo's primary checkout; re-run from it or pass --dir <primary checkout>`);
  if (!mainWorktree) throw oatsError("E_NO_CANONICAL_ROOT", `${abs} is inside the linked Git worktree ${toplevel}, but \`git worktree list\` reported no main worktree — instance homes must live in the soul-owning repo's primary checkout; re-run from it or pass --dir <primary checkout>`);
  if (!existsSync(mainWorktree)) throw oatsError("E_NO_CANONICAL_ROOT", `${abs} is inside the linked Git worktree ${toplevel}, whose primary checkout ${mainWorktree} does not exist — instance homes must live in the soul-owning repo's primary checkout; restore it or pass --dir <primary checkout>`);
  // Map the root's position within the linked tree onto the primary checkout.
  // A root OUTSIDE the work tree (sibling agents/ beside the repo) is not a
  // worktree artifact and is left exactly where it is.
  const rel = relative(realOf(toplevel), realOf(abs));
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return abs;
  const canonical = join(realOf(mainWorktree), rel);
  const back = relative(realOf(mainWorktree), canonical);
  if (back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back)) {
    throw oatsError("E_NO_CANONICAL_ROOT", `canonical root for ${abs} would escape the primary checkout ${mainWorktree}`);
  }
  return canonical;
}
/** The canonical deployment root — where instance homes belong. */
export function canonicalAgentsRoot(root) { return canonicalDeploymentPath(root); }
export function ensureRoot(cwd) {
  const root = findRoot(cwd);
  if (!root) {
    const from = resolve(cwd ?? process.cwd());
    // Workspace model: an oats-local.yaml above `from` IS a deployment whose instance
    // root (<deployment>/agents/) was never created — name that remedy, not a v1 verb.
    let localDeployment = null;
    for (let d = from; ; d = dirname(d)) { if (existsSync(join(d, "oats-local.yaml"))) { localDeployment = d; break; } if (dirname(d) === d) break; }
    if (localDeployment) {
      throw oatsError("E_NO_DEPLOYMENT",
        `no instance root walking up from ${from}: ${join(localDeployment, "oats-local.yaml")} names this deployment but ${join(localDeployment, "agents")} does not exist — mkdir ${join(localDeployment, "agents")} (or run \`oats sync --dir ${localDeployment}\`, which creates it)`,
        { from, looked: ["agents/"], deployment: localDeployment, local: join(localDeployment, "oats-local.yaml"), remedy: `mkdir ${join(localDeployment, "agents")} (or run oats sync)` });
    }
    throw oatsError("E_NO_DEPLOYMENT",
      `no deployment found walking up from ${from}: no agents/ directory — run from the deployment (where oats-local.yaml lives; \`oats onboard\` creates one), or set PI_AGENTS_ROOT`,
      { from, looked: ["agents/"] });
  }
  // Deployment root ≠ invocation CWD: homes always land in the primary checkout.
  return canonicalAgentsRoot(root);
}
export function workspaceOf(root) { return dirname(root); }

// ---------- capability slots ----------
export const LAYERS = ["knowledge", "messaging", "tasks"];


// ---------- launch configurations ----------
// A named way to start a harness, independent of any soul: the harness, an
// executable (a wrapper, another binary), literal argv, environment (literal
// values, or references resolved on the execution host at start time), a
// model and yolo. Declared by the host under `launch-configs:` in the
// deployment's oats-local.yaml (lead decision 2: a spawn-time HOST choice,
// never a soul field). Selected at spawn or session start/restart by name.
export const LAUNCH_HARNESSES = ["pi", "claude", "codex"];
export const LAUNCH_CONFIG_KEYS = new Set(["harness", "runtime", "executable", "args", "env", "model", "yolo"]);
/** A launch configuration's harness: `harness`, or `runtime`, its pre-0.27 name (0.26.0
 *  deployments wrote it) — read either (lead call 6). */
export const launchConfigHarness = (entry) => (Object.hasOwn(entry, "harness") ? entry.harness : entry.runtime);
const LAUNCH_CONFIG_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Environment the kernel sets for every launch (identity, home, roots) and
 *  its reference aliases: a configuration may not name them. */
export const RESERVED_LAUNCH_ENV = new Set(["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "OATS_AGENT", "OATS_SOUL", "OATS_SOUL_ID", "OATS_ROOT", "OATS_CONTEXT", "OATS_WORKSPACE", "OATS_EVENT", "OATS_SETTINGS", "OATS_CLI_BIN", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT"]);
export const LAUNCH_REF_PREFIX = "OATS_LAUNCH_REF_";
const reservedLaunchEnv = (n) => RESERVED_LAUNCH_ENV.has(n) || n.startsWith(LAUNCH_REF_PREFIX);
export function validateLaunchConfig(name, entry, where) {
  const bad = (why) => { throw oatsError("E_LAUNCH_CONFIG_INVALID", `launch configuration ${JSON.stringify(name)}${where ? ` in ${where}` : ""} ${why}`); };
  if (typeof name !== "string" || !LAUNCH_CONFIG_NAME.test(name)) bad("has an invalid name (letters, digits, dot, underscore, dash; up to 64 characters)");
  if (name === "none") bad("cannot be named none: that word selects no configuration");
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) bad("must be a map");
  for (const key of Object.keys(entry)) if (!LAUNCH_CONFIG_KEYS.has(key)) bad(`has an unsupported key ${JSON.stringify(key)} (harness, executable, args, env, model, yolo)`);
  if (Object.hasOwn(entry, "harness") && Object.hasOwn(entry, "runtime") && entry.harness !== entry.runtime) bad(`names harness ${JSON.stringify(entry.harness)} and runtime ${JSON.stringify(entry.runtime)}: \`runtime\` is the pre-0.27 name of \`harness\` — keep one`);
  if (!LAUNCH_HARNESSES.includes(launchConfigHarness(entry))) bad(`needs harness: one of ${LAUNCH_HARNESSES.join(", ")}`);
  const text = (v, what) => { if (typeof v !== "string" || !v.trim() || v.includes("\0")) bad(`${what} must be non-empty text`); };
  if (entry.executable !== undefined) text(entry.executable, "executable");
  if (entry.args !== undefined) {
    if (!Array.isArray(entry.args)) bad("args must be a list of strings");
    for (const a of entry.args) if (typeof a !== "string" || a.includes("\0")) bad("args must be a list of strings");
  }
  if (entry.env !== undefined) {
    if (!entry.env || typeof entry.env !== "object" || Array.isArray(entry.env)) bad("env must be a map of NAME to a string or {fromEnv: NAME}");
    for (const [n, v] of Object.entries(entry.env)) {
      if (!ENV_NAME.test(n)) bad(`env name ${JSON.stringify(n)} is not a valid environment variable name`);
      if (reservedLaunchEnv(n)) bad(`env ${n} is set by the kernel for every launch and cannot be overridden`);
      if (typeof v === "string") { if (v.includes("\0")) bad(`env ${n} must be text`); continue; }
      if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length !== 1 || typeof v.fromEnv !== "string" || !ENV_NAME.test(v.fromEnv)) bad(`env ${n} must be a string or {fromEnv: NAME}`);
      if (v && typeof v === "object" && v.fromEnv && v.fromEnv.startsWith(LAUNCH_REF_PREFIX)) bad(`env ${n} may not reference a ${LAUNCH_REF_PREFIX}* alias`);
    }
  }
  if (entry.model !== undefined) text(entry.model, "model");
  if (entry.yolo !== undefined && typeof entry.yolo !== "boolean") bad("yolo must be true or false");
  return entry;
}
function validateLaunchConfigs(map, file) {
  if (map === undefined) return;
  if (!map || typeof map !== "object" || Array.isArray(map)) throw oatsError("E_LAUNCH_CONFIG_INVALID", `launch-configs in ${file} must be a map of name to configuration`);
  for (const [name, entry] of Object.entries(map)) validateLaunchConfig(name, entry, file);
}
/** The launch configurations effective at `dir`: the `launch-configs:` of the
 *  oats-local.yaml found walking up from it (the deployment), validated. None
 *  when no deployment is in reach. `source` is the deployment directory (a
 *  relative `executable` resolves against it); `shadows` stays for the answer's
 *  shape and is always empty — there is one host file, no scope chain. */
export function launchConfigsAt(dir) {
  // Null-prototype: a configuration may legitimately be named constructor or
  // toString, and membership must never be an inherited property.
  const out = Object.create(null);
  let found;
  try { found = loadLocal(dir); } catch (e) { if (e?.code === "E_LOCAL_MISSING") return out; throw e; }
  const map = found.local["launch-configs"];
  validateLaunchConfigs(map, found.path);
  const source = dirname(found.path);
  for (const [name, entry] of Object.entries(map || {})) {
    if (!Object.hasOwn(entry, "harness")) noteRuntimeName(`launch-configs.${name}.runtime in ${found.path}`);
    out[name] = { name, harness: launchConfigHarness(entry), ...(entry.executable !== undefined ? { executable: entry.executable } : {}), args: [...(entry.args || [])], env: { ...(entry.env || {}) }, ...(entry.model !== undefined ? { model: entry.model } : {}), ...(entry.yolo !== undefined ? { yolo: entry.yolo } : {}), source, shadows: [] };
  }
  return out;
}

/** A hook declaration is either a command string, or `{ command, required }`.
 * `required: true` means the capability cannot function if the hook fails — an
 * aweb spawn hook that cannot mint an identity leaves an instance believing it
 * has messaging it does not have — so the spawn fails and is rolled back
 * instead of proceeding with a half-configured capability. */
function hookDeclaration(value) {
  if (typeof value === "string") return { command: value, required: false };
  if (value && typeof value === "object" && typeof value.command === "string") {
    return { command: value.command, required: value.required === true, ...(Object.hasOwn(value, "inputs") ? { inputs: value.inputs } : {}) };
  }
  return undefined;
}
function manifestHookDeclarations(manifest) {
  return Object.fromEntries(Object.entries(manifest?.hooks || {}).flatMap(([event, value]) => {
    const declaration = hookDeclaration(value);
    return APPROVED_HOOKS.has(event) && declaration ? [[event, declaration.command]] : [];
  }));
}
function manifestHookCommands(manifest) {
  const out = {};
  for (const [ev, command] of Object.entries(manifestHookDeclarations(manifest))) {
    const [script, ...args] = command.split(/\s+/);
    const abs = manifestPath(manifest, script);
    if (abs) out[ev] = ["node", shq(abs), ...args].join(" ");
  }
  return out;
}

const PACKAGED_INJECTS_DIR = join(PKG_ROOT, "injects");

function validateCapabilityManifest(m, mf) {
  const id = m.capability;
  if (!id) throw new Error(`capability manifest needs "capability": ${mf}`);
  // Workspace model (contract §2): a capability name is `^[a-z0-9][a-z0-9._-]*$`
  // — a member capability is `nw-deploy`, a package one `oats.okf`. The classic
  // "must be namespaced" rule kept catalog ids unambiguous; the workspace
  // has one flat name space per organisation instead (duplicate → E_CAPABILITY_AMBIGUOUS
  // at resolution), so the grammar is the only requirement.
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw new Error(`capability ID must match ^[a-z0-9][a-z0-9._-]*$: "${id}" (${mf})`);
  if (m.retirement !== undefined) {
    if (!isPlainObject(m.retirement) || !isPlainObject(m.retirement.disposable)) throw new Error(`capability ${id} manifest retirement must contain a disposable map`);
    const unknown = Object.keys(m.retirement).filter((key) => key !== "disposable");
    const scopes = Object.keys(m.retirement.disposable).filter((key) => !["home", "work"].includes(key));
    if (unknown.length || scopes.length) throw new Error(`capability ${id} manifest retirement has unsupported keys: ${[...unknown, ...scopes].join(", ")}`);
    for (const scope of ["home", "work"]) {
      const roots = m.retirement.disposable[scope];
      if (roots !== undefined && (!Array.isArray(roots) || roots.some((root) => typeof root !== "string"))) throw new Error(`capability ${id} manifest retirement.disposable.${scope} must be an array of relative roots`);
    }
  }
  // Launch environment and hooks: the shared manifest contract (lib/capability-contract.mjs).
  const problem = manifestContractProblems(m)[0];
  if (problem) throw new Error(problem.message);
  return id;
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

function loadManifestAt(idir, origin, { strict = false } = {}) {
  const mf = join(idir, "oats.json");
  if (!existsSync(mf)) return undefined;
  let raw;
  try { raw = strict ? parseStrictJson(readPortableBytes(mf)) : JSON.parse(readFileSync(mf, "utf8")); }
  catch (e) { if (strict) throw e; throw new Error(`invalid capability manifest JSON ${mf}: ${e.message}`); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`capability manifest ${mf} must be a JSON object (got ${raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw})`);
  // BEFORE any validation or annotation: the artifact declares capability DATA,
  // never kernel annotations about itself.
  const m = stripInternalAnnotations(raw);
  const id = validateCapabilityManifest(m, mf);
  if (!m.version || !m.description) throw new Error(`capability ${id} manifest needs version and description`);
  const targetFields = ["global", "groups", "souls", "targets"].filter((key) => Object.prototype.hasOwnProperty.call(m, key));
  if (targetFields.length) throw new Error(`capability ${id} manifest cannot declare config-owned targets: ${targetFields.join(", ")}`);
  if (m.layer && !LAYERS.includes(m.layer)) throw new Error(`capability ${id} declares unknown layer "${m.layer}"`);
  if (m.command && !/^[a-z0-9][a-z0-9-]*$/.test(m.command)) throw new Error(`capability ${id} has invalid command namespace "${m.command}"`);
  if (m.agents !== undefined && (!Array.isArray(m.agents) || m.agents.some((a) => typeof a !== "string"))) throw new Error(`capability ${id} "agents" must be an array of package-relative soul directories`);
  validateManifestOperations(m, id);
  validateBindingInterface(m);
  return { ...m, _dir: idir, _origin: origin };
}















/** `operations`: what a capability offers a GUI or scheduler by name, each
 *  delegating to one of its own `commands`. kind "action" runs something;
 *  kind "view" answers { documents: [...] } for presentation (a knowledge
 *  provider's own view of an instance's working knowledge). context "home"
 *  runs in an instance home; "scope" runs in the config scope. */
const OPERATION_NAME_RE = /^[a-z][a-z0-9-]*$/;
function validateManifestOperations(m, id) {
  if (m.operations === undefined) return;
  if (!m.operations || typeof m.operations !== "object" || Array.isArray(m.operations)) throw new Error(`capability ${id} "operations" must be an object map`);
  for (const [name, op] of Object.entries(m.operations)) {
    if (!OPERATION_NAME_RE.test(name)) throw new Error(`capability ${id} operation "${name}": name must match ${OPERATION_NAME_RE.source}`);
    if (!op || typeof op !== "object" || Array.isArray(op)) throw new Error(`capability ${id} operation "${name}" must be an object`);
    if (typeof op.command !== "string" || !Object.prototype.hasOwnProperty.call(m.commands || {}, op.command)) throw new Error(`capability ${id} operation "${name}": "command" must name one of the manifest's commands`);
    if (op.kind !== undefined && !["action", "view"].includes(op.kind)) throw new Error(`capability ${id} operation "${name}": "kind" must be action or view`);
    if (op.context !== undefined && !["home", "scope"].includes(op.context)) throw new Error(`capability ${id} operation "${name}": "context" must be home or scope`);
    if (op.description !== undefined && typeof op.description !== "string") throw new Error(`capability ${id} operation "${name}": "description" must be a string`);
    if (op.args !== undefined) {
      if (!Array.isArray(op.args)) throw new Error(`capability ${id} operation "${name}": "args" must be an array`);
      for (const a of op.args) {
        if (!a || typeof a !== "object" || typeof a.name !== "string" || !OPERATION_NAME_RE.test(a.name)) throw new Error(`capability ${id} operation "${name}": each arg needs a name matching ${OPERATION_NAME_RE.source}`);
        if (a.flag !== undefined && (typeof a.flag !== "string" || !/^--[a-z][a-z0-9-]*$/.test(a.flag))) throw new Error(`capability ${id} operation "${name}" arg "${a.name}": "flag" must look like --name`);
        if (a.required !== undefined && typeof a.required !== "boolean") throw new Error(`capability ${id} operation "${name}" arg "${a.name}": "required" must be a boolean`);
      }
    }
  }
}
/** The normalized operations a manifest declares (empty when none). */
export function manifestOperations(manifest) {
  return Object.entries(manifest?.operations || {}).map(([name, op]) => ({
    name, kind: op.kind || "action", command: op.command, context: op.context || "home",
    description: op.description || null,
    args: (op.args || []).map((a) => ({ name: a.name, flag: a.flag || `--${a.name}`, required: !!a.required, description: a.description || null })),
  }));
}

/** Discover capability manifests. Later sources take precedence: outer scopes < inner scopes; installed < owned within one scope. Duplicates inside one source layer are errors. */
export function capabilityManifests(startDir) {
  // Capability-id keyed — never answer for `constructor`/`toString`: callers
  // index this map with ids read from instance.json and the command line.
  // Only workspace-model copies answer: an instance home's materialized modules,
  // or one entry of the deployment's module store. Anything else has none.
  const out = Object.create(null);
  const layer = new Map(); // capability -> origin of the winning manifest
  const add = (m) => {
    if (!m) return;
    if (out[m.capability] && out[m.capability]._dir !== m._dir && layer.get(m.capability) === m._origin) {
      throw new Error(`duplicate capability ID "${m.capability}" from ${out[m.capability]._dir} and ${m._dir}`);
    }
    out[m.capability] = m; layer.set(m.capability, m._origin);
  };
  // Workspace model: an INSTANCE HOME carries its own materialized modules
  // (<home>/.oats/modules/<cap>/, recorded in instance.json.modules). They are
  // the whole capability set of that instance — nothing from any config chain
  // applies to it — so answer from them and stop. Trust: membership (member
  // modules) or the workspace's packages: declaration (package modules, locked
  // to commit + integrity); the copy is the instance's own.
  // The deployment's module STORE (<deployment>/.oats/modules/<cap>@<commit>/ —
  // where a package capability agent's tree was fetched by the workspace
  // resolver): a store entry answers with its own manifest, trusted like an
  // instance module (the lock pinned the package before the fetch).
  if (startDir && basename(dirname(startDir)) === "modules" && basename(dirname(dirname(startDir))) === ".oats"
      && existsSync(join(dirname(dirname(dirname(startDir))), "oats-local.yaml")) && existsSync(join(startDir, "oats.json"))) {
    const m = loadManifestAt(startDir, `module:${startDir}`);
    if (m) add(m);
    return out;
  }
  const modulesOf = instanceModulesRoot(startDir);
  if (modulesOf) {
    for (const [name, rec] of Object.entries(modulesOf.modules)) {
      if (!PACKAGE_ID_RE.test(name) || name === "__proto__") continue;
      const m = loadManifestAt(join(modulesOf.root, name), `module:${modulesOf.home}`);
      if (m) { m._module = rec; add(m); }
    }
    return out;
  }
  return out;
}
export function capabilityManifest(name, startDir) {
  return capabilityManifests(startDir)[name];
}
/** When `dir` is (or is inside) an instance home materialized under the workspace
 *  model, → { home, root: <home>/.oats/modules, modules: instance.json.modules }; else null.
 *  Walks up from `dir` to the nearest instance.json carrying a `modules` object. */
export function instanceModulesRoot(dir) {
  if (!dir) return null;
  let cur = resolve(dir);
  for (let i = 0; i < 6; i++) {
    const metaFile = join(cur, "instance.json");
    if (existsSync(metaFile)) {
      let meta;
      try { meta = JSON.parse(readFileSync(metaFile, "utf8")); } catch { return null; }
      if (meta && typeof meta === "object" && meta.modules && typeof meta.modules === "object" && !Array.isArray(meta.modules)) {
        const root = join(cur, ".oats", "modules");
        return existsSync(root) ? { home: cur, root, modules: meta.modules } : null;
      }
      return null;
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}


/** Trust of a manifest capabilityManifests answered. A materialized module is
 *  trusted by construction — a member capability by membership (decision 2), a
 *  package capability by its declaration in the workspace's packages: (human
 *  decision 2026-09-24: there is no package approval). The copy is the
 *  instance's own. Nothing else is a capability this kernel runs. */
export function capabilityTrust(manifest) {
  if (!manifest) return { trusted: false, reason: "manifest missing" };
  if (!String(manifest._origin).startsWith("module:")) return { trusted: false, reason: `${manifest.capability} is not a workspace module copy` };
  const from = manifest._module?.from;
  return { trusted: true, module: true, reason: from?.kind === "package" ? `package ${from.package} v${from.version} declared in the workspace` : `workspace member ${from?.repoKey ?? "?"}`, package: from?.kind === "package" ? from.package : undefined };
}

// ---------- distribution packages (docs/design/package-engine-contract.md) ----------

/** Default contained package root inside a Git/catalog source when the source
 * contract does not select one (contract §2). NEVER a hardcoded directory at a
 * use site: every resolver reads the configured path and falls back here. */
export const DEFAULT_PACKAGE_PATH = "oats-package";



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
  if (!existsSync(file)) return empty;
  let doc;
  try { doc = JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { throw oatsError("invalid-source", `broken package catalog ${file}: ${e.message}`); }
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
  // package identity (oats.review is exported by package oats.dev).
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

/** The catalog's legacy-capability → official-package aliases (null-prototype). */
export function officialCapabilityAliases() {
  return readCatalogFile().capabilities;
}
/** The effective official catalog file: `OATS_PACKAGE_CATALOG`, else the bundled one. */
export function officialCatalogFile() {
  return process.env.OATS_PACKAGE_CATALOG || join(PKG_ROOT, "package-catalog.json");
}




















/** Resolve a manifest-relative path inside the capability's own copy (its
 * integrity boundary); undefined when the declared resource is absent. */
function manifestPath(manifest, rel) {
  const local = join(manifest._dir, rel);
  if (!existsSync(local)) return undefined;
  const root = realpathSync(manifest._dir); const target = realpathSync(local); const fromRoot = relative(root, target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`capability ${manifest.capability} path escapes its integrity boundary: ${rel}`);
  }
  return local;
}
/** Resolve an executable declared by a manifest through the same artifact boundary as hooks. */
export function capabilityExecutablePath(manifest, rel) { return manifestPath(manifest, rel); }
function assertCapabilityTreeContained(manifest, tree, resource = "skill") {
  const artifact = realpathSync(manifest._dir);
  const visited = new Set();
  const assertInside = (target, path) => {
    const fromArtifact = relative(artifact, target);
    if (fromArtifact === ".." || fromArtifact.startsWith(`..${sep}`) || isAbsolute(fromArtifact)) {
      throw new Error(`capability ${manifest.capability} ${resource} path escapes its integrity boundary: ${relative(manifest._dir, path)}`);
    }
  };
  const walk = (dir) => {
    const realDir = realpathSync(dir);
    assertInside(realDir, dir);
    if (visited.has(realDir)) return;
    visited.add(realDir);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const target = realpathSync(path); // also rejects broken symlinks
      assertInside(target, path);
      if (entry.isSymbolicLink()) {
        // Recurse through contained directory links: descendants may carry a
        // second symlink that escapes the package boundary.
        if (lstatSync(target).isDirectory()) walk(target);
      } else if (entry.isDirectory()) walk(path);
    }
  };
  walk(tree);
}
/** Packaged default injection for a capability or work mode (undefined if none shipped). */
export function packagedInject(name, startDir) {
  const m = capabilityManifest(name, startDir);
  if (m?.inject) { const p = manifestPath(m, m.inject); if (p) return p; }
  const p = join(PACKAGED_INJECTS_DIR, `${name}.md`);
  return existsSync(p) ? p : undefined;
}

/** Capability rows for a prepared spawn BEFORE its home exists: the same shape
 * `toCapabilityRows` builds (manifest, settings, origin, provenance, trust, hooks,
 * environment) with every home-relative path resolved against a placeholder that
 * cannot exist, so `skills` is [] and `inject` is undefined until materialize has
 * copied the module. `planned: true` marks the row so preflight knows those two
 * fields are deferred (the copies are digest-verified by materialize itself). */
const PLANNED_HOME_PLACEHOLDER = join(sep, "oats-planned-home-does-not-exist", "placeholder");
function plannedCapabilityRows(resolution) {
  return toCapabilityRows(resolution, PLANNED_HOME_PLACEHOLDER).map((row) => ({ ...row, level: undefined, dir: undefined, skills: [], inject: undefined, planned: true,
    // Declared command text only (manifest-relative; never executed from a planned row).
    hooks: Object.fromEntries(Object.entries(row.hooks || {}).filter(([event]) => APPROVED_HOOKS.has(event)).map(([event, h]) => [event, typeof h === "string" ? h : h?.command])) }));
}
/** Turn a materialized row's hook declarations (`{ command, cwd, required }` per
 * event, as `toCapabilityRows` records them) into the SHELL STRINGS the kernel's
 * hook runner and the retire path (via instance.json#capabilityRuntime) execute:
 * `node <abs script> <args>`, exactly as `manifestHookCommands` renders a classic
 * capability. The script must exist inside the module's copy under
 * <home>/.oats/modules/<cap>/ — a path escaping it is a manifest defect. Only
 * the events the kernel approves (soul-scaffold, spawn, retire, launch) are kept. */
function materializedHookCommands(row, home) {
  const out = {};
  const moduleDir = row.dir || join(home, ".oats", "modules", row.id);
  for (const [event, spec] of Object.entries(row.hooks || {})) {
    if (!APPROVED_HOOKS.has(event)) continue;
    const command = typeof spec === "string" ? spec : spec?.command;
    if (typeof command !== "string" || !command.trim()) continue;
    if (/^node\s+'/.test(command)) { out[event] = command; continue; } // already rendered
    const [script, ...args] = command.trim().split(/\s+/);
    const abs = join(moduleDir, script);
    if (!existsSync(abs)) throw oatsError("E_CAPABILITY_RESOURCE_MISSING", `capability ${row.id} declares hook ${event} as ${JSON.stringify(command)}, but ${abs} is not in its materialized copy`);
    const root = realpathSync(moduleDir); const target = realpathSync(abs); const fromRoot = relative(root, target);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) throw oatsError("E_CAPABILITY_BROKEN", `capability ${row.id} hook ${event} path escapes its module copy: ${script}; respawn the instance from a corrected capability`);
    out[event] = ["node", shq(abs), ...args].join(" ");
  }
  return out;
}

/** Compose, but never mutate, an instance instruction view from canonical soul instructions.
 * `kind` tunes composition: "capability" suppresses the knowledge layer's injection (ephemeral service
 * agents — reviewers, harvesters — carry no episodic memory by design). */
export function composeInstanceAgentsMd(soulDir, contextDir, soulName, workMode, kind, prepared = undefined) {
  const agentsMd = join(soulDir, "AGENTS.md");
  if (!existsSync(agentsMd)) throw new Error(`canonical soul instructions missing: ${agentsMd}`);
  // Workspace model only (lead decision c3-1): the capability set is the prepared
  // resolution's modules, materialized into the home by the caller. There is no
  // scope configuration to compose from.
  if (!prepared) throw oatsError("E_LOCAL_MISSING", `composing ${soulName ?? basename(dirname(soulDir))} needs a workspace deployment (oats-local.yaml) — its capabilities are the workspace's resolution; \`oats onboard\` creates one`);
  const resolved = resolvedFromPrepared(prepared, contextDir);
  const wanted = [];
  // Operational knowledge is a capability (oats.core / oats.setup) the resolution
  // carries like any other; the kernel composes no operational block of its own.
  const oatsCoreDeclared = (prepared.resolution?.modules || []).some((m) => m.name === "oats.core" || m.name === "oats.setup");
  // The home/work boundary is runtime-neutral and mode-independent: every
  // instance — including capability service agents in attached mode — needs to
  // know which directory is its brain and which is the repository, and where
  // `aw`/`oats` resolve their scope from. It precedes the mode block, which then
  // adds only that mode's ownership and branch rules.
  const boundaryInject = packagedInject("instance-boundary");
  if (boundaryInject && existsSync(boundaryInject)) wanted.push(["kernel:instance-boundary", boundaryInject]);
  const workModeInject = packagedInject(`work-${workMode || "checkout"}`);
  if (workModeInject && existsSync(workModeInject)) wanted.push([`work-mode:${workMode || "checkout"}`, workModeInject]);
  for (const cap of resolved.capabilities) {
    if (kind === "capability" && cap.layer === "knowledge") continue; // ephemeral: no memory protocol
    if (cap.inject && existsSync(cap.inject)) wanted.push([`capability:${cap.id}`, cap.inject]);
  }
  const blocks = wanted.map(([source, file]) => ({ source, file, content: readFileSync(file, "utf8").trim() }));
  return { text: renderInstructionText(readFileSync(agentsMd, "utf8"), blocks), blocks, resolved, oatsCoreDeclared };
}

/** Per slot `{ capability, from }` (from: "soul" | "workspace" | "team:<label>", the Desktop's
 *  `layers.<layer>.from`), or null for an empty slot. A spawn records these under `workspace.layers`. */
function layerRows(resolution) {
  return Object.fromEntries(Object.entries(resolution?.slots || {}).map(([slot, mod]) => [slot, mod ? { capability: mod, from: resolution.slotsFrom?.[slot] ?? null } : null]));
}

/** The resolved view a prepared spawn composes and records: PLANNED capability rows
 *  (manifest/settings/origin/trust known now; skills and inject paths point into
 *  the home, which does not exist yet, and are rebuilt once materialize has
 *  landed), the workspace, payloads and slots, and the deployment's launch
 *  configurations. `prepared.capabilityRows` is honoured only when non-empty. */
export function resolvedFromPrepared(prepared, contextDir) {
  return {
    capabilities: Array.isArray(prepared.capabilityRows) && prepared.capabilityRows.length ? prepared.capabilityRows : plannedCapabilityRows(prepared.resolution),
    workspace: { key: prepared.discovery?.key ?? null, name: prepared.discovery?.workspace?.name ?? null, deployment: prepared.deployment ?? null, commit: prepared.discovery?.commit ?? null, standalone: prepared.discovery?.standalone === true, revision: prepared.resolution.revision, team: prepared.resolution.soul?.team ?? null, slots: prepared.resolution.slots },
    payloads: prepared.resolution.payloads ?? {},
    teams: prepared.resolution.teams ?? [], teamsSource: "live",
    layers: layerRows(prepared.resolution),
    launchConfigs: launchConfigsAt(contextDir || prepared.deployment),
  };
}

/** The resolved view of an EXISTING home: what it recorded at spawn (its
 *  capability rows, workspace and payloads) and its deployment's launch
 *  configurations. Never re-resolved against the scope. The one live part is
 *  `teams` (teams contract decision 6): a caller that computed the home's live
 *  eligible teams (liveTeams) passes them; otherwise the spawn-time record. */
export function resolvedFromHome(home, meta, { teams, teamsSource } = {}) {
  // The team facts read `workspace.team` and `workspace.slots.messaging` (teamEnv); a home records
  // the soul's primary label under `workspace.soul.team` and its messaging module among its
  // capabilities — shaped here exactly as the in-home command dispatch shapes them.
  const ws = meta?.workspace && typeof meta.workspace === "object" ? meta.workspace : null;
  const messaging = (Array.isArray(meta?.capabilities) ? meta.capabilities : []).find((c) => c?.layer === "messaging")?.id ?? null;
  return {
    capabilities: Array.isArray(meta?.capabilityRuntime) ? meta.capabilityRuntime : [],
    workspace: ws ? { ...ws, team: ws.soul?.team ?? null, slots: { messaging } } : null,
    payloads: meta?.providers ?? {},
    teams: Array.isArray(teams) ? teams : Array.isArray(meta?.teams) ? meta.teams : null,
    teamsSource: Array.isArray(teams) ? (teamsSource === "live" ? "live" : "recorded") : "recorded",
    layers: ws && typeof ws.layers === "object" && ws.layers ? ws.layers : {}, // recorded at spawn; none before layers-from
    launchConfigs: launchConfigsAt(home),
  };
}

/** The skill entries a tree contributes — THE discovery rule, shared by preflight
 * and materialization so the two can never disagree about what a tree provides.
 *
 * Note `e.isDirectory()` is false for a symlinked child (readdir uses lstat
 * semantics), so a skill directory represented by a symlink contributes nothing.
 * That is deliberate and matches what actually gets copied; preflight reporting
 * such a tree as empty is the point, not a gap. */
function skillEntriesIn(tree) {
  if (!tree || !existsSync(tree)) return [];
  if (hasSkillDoc(tree)) return [{ name: basename(tree), src: tree }];
  const out = [];
  for (const e of readdirSync(tree, { withFileTypes: true })) {
    if (e.isDirectory() && hasSkillDoc(join(tree, e.name))) out.push({ name: e.name, src: join(tree, e.name) });
  }
  return out;
}
/** Does this directory hold a READABLE skill document? `existsSync` is true for
 * a DIRECTORY named SKILL.md, which would let a tree pass every check and still
 * launch an instance with no readable skill (reviewer-d70bc8b). The marker must
 * be a regular file. */
function hasSkillDoc(dir) {
  try { return statSync(join(dir, "SKILL.md")).isFile(); } catch { return false; }
}

/** Enumerate every resource the resolved composition PROMISES this instance,
 * and refuse the spawn if any declared resource did not resolve.
 *
 * The kernel used to fail closed on a missing capability MANIFEST but open on a
 * missing capability RESOURCE: `capabilitySkillDirs()` dropped unresolved paths,
 * the materialization loop skipped non-existent sources, and
 * `composeInstanceAgentsMd()` omitted missing injections. A capability could
 * therefore contribute zero skills while its injection still instructed the
 * agent to load them — observed with oats.aweb in a worktree without its
 * dependencies installed.
 *
 * Preflight runs BEFORE the instance home exists, which is the cheapest possible
 * transaction boundary: the most common failure needs no rollback at all.
 * Installed-but-inactive capabilities are absent from `resolved.capabilities`
 * and so contribute nothing here, by construction.
 */
export function planInstanceResources({ resolved, soulDir, agent, contextDir, composition, prepared }) {
  const expected = [];
  const missing = [];
  /** `declares` marks a tree the manifest PROMISED: it must resolve AND yield at
   * least one discoverable skill. A directory that merely happens to exist (a
   * soul's optional skills/) promises nothing, so an empty one is not a defect. */
  const add = (r, { declares = true } = {}) => {
    if (r.type === "skill-tree") r.entries = skillEntriesIn(r.path).map((e) => e.name);
    expected.push(r);
    if (!r.path) missing.push({ ...r, reason: "did not resolve" });
    else if (declares && r.type === "skill-tree" && !r.entries.length) {
      missing.push({ ...r, reason: `resolved to ${r.path} but contains no skill (no SKILL.md, and no child directory with one — a symlinked skill directory does not count)` });
    }
  };

  const soulSkills = soulDir && join(soulDir, "skills");
  // A soul with no skills/ dir declares nothing — nor does an empty one.
  if (soulSkills && existsSync(soulSkills)) add({ type: "skill-tree", source: "soul", declared: soulSkills, path: soulSkills }, { declares: false });

  for (const cap of resolved.capabilities || []) {
    if (cap.planned === true) {
      // Workspace model, before the home exists: the module's declared skills and
      // inject are promised by its manifest and will be copied WHOLE (and digest-
      // verified) by materialize. They are recorded as expected here — with their
      // future home-relative paths — and asserted against the landed copies in
      // spawnBody's EXPECTED == MATERIALIZED check, not against the filesystem now.
      for (const s of cap.skillsDeclared || []) {
        const declared = typeof s === "string" ? s : s?.declared;
        if (typeof declared !== "string" || !declared) continue;
        expected.push({ type: "skill-tree", source: cap.id, declared, path: undefined, entries: [], deferred: "materialize", origin: cap.origin, module: cap.id });
      }
      const intentionallyDroppedPlanned = agent?.kind === "capability" && cap.layer === "knowledge";
      if (cap.injectDeclared && !intentionallyDroppedPlanned) expected.push({ type: "injection", source: cap.id, declared: cap.injectDeclared, path: undefined, deferred: "materialize", origin: cap.origin, module: cap.id });
      continue;
    }
    for (const s of cap.skillsDeclared || []) {
      add({ type: "skill-tree", source: cap.id, declared: s.declared, path: s.path, origin: cap.origin, level: cap.level });
    }
    // Capability agents are ephemeral and deliberately get no memory protocol,
    // so composeInstanceAgentsMd drops knowledge-layer injections for them.
    // The expected set MUST apply the same rule or it reports an intentional
    // omission as an incomplete composition. (Coupled to the matching `continue`
    // in composeInstanceAgentsMd — change both together.)
    const intentionallyDropped = agent?.kind === "capability" && cap.layer === "knowledge";
    if (intentionallyDropped) continue;
    // A capability that declares `inject:` must produce it.
    if (cap.injectDeclared && cap.inject === undefined) {
      add({ type: "injection", source: cap.id, declared: cap.injectDeclared, path: undefined, origin: cap.origin, level: cap.level });
    } else if (cap.inject) {
      add({ type: "injection", source: cap.id, declared: cap.injectDeclared || basename(cap.inject), path: existsSync(cap.inject) ? cap.inject : undefined, origin: cap.origin, level: cap.level });
    }
  }
  if (composition) {
    for (const b of composition.blocks || []) expected.push({ type: "instruction-block", source: b.source, declared: b.file, path: b.file });
  }

  if (missing.length) {
    const detail = missing.map((m) => `  ${m.type} "${m.declared}" declared by ${m.source}${m.origin ? ` (${m.origin})` : ""} ${m.reason}`).join("\n");
    throw oatsError("E_CAPABILITY_RESOURCE_MISSING", `the resolved composition declares ${missing.length} resource(s) that do not exist, so this instance would start without them while its instructions still refer to them:\n${detail}\n\nResources must come from the capability's locked/materialized package content — a path that only exists after an ad-hoc dependency install is a manifest defect. Fix the capability or deselect it for this soul.`);
  }
  return expected;
}

// ---------- harness packages (satisfied by a harness's own package manager) ----------

/** pi's config dir, officially relocatable via PI_CODING_AGENT_DIR (pi
 * docs/usage.md). Hard-coding ~/.pi/agent reports an installed package as
 * missing on a relocated host, and then reports a consented install as failed
 * (reviewer-ee6592c). PI_PACKAGE_DIR is deliberately NOT used: it points at pi's
 * own package assets, not at `pi install` output, so treating it as the user
 * package root sends lookups to the wrong tree (reviewer-ad1b9f0). */
const piAgentDir = (env = process.env) => env.PI_CODING_AGENT_DIR || join(env.HOME || "", ".pi", "agent");

/** Harnesses whose own package manager can satisfy a requirement. A harness
 * package is NOT a command on PATH: it is registered with the harness, so both
 * detection and post-install verification read that harness's package list.
 * Null-prototype: `harness:` comes from a soul or a package manifest, and
 * `HARNESS_PACKAGE_MANAGERS[harness]` must answer for the harnesses declared
 * here and for nothing else — an inherited `constructor` would pass the
 * unknown-harness gate and then be dereferenced as a manager. */
export const HARNESS_PACKAGE_MANAGERS = {
  __proto__: null,
  pi: {
    scope: "user-level (pi packages)",
    identity: (spec) => packageSpecIdentity(spec),
    safeSpec: (spec) => typeof spec === "string" && /^[a-z][a-z0-9+.-]*:(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.^~><=-]+)?$/i.test(spec),
    argv: (spec) => ["pi", "install", spec],
    /** Installed packages as PI reports them. `pi list` is pi's own resolver
     * answer — spec, the resolved install directory, and whether the entry
     * filters the package's resources — so OATS never has to guess at package
     * roots. `--no-approve` keeps a spawn-time probe from trusting
     * project-local files. Falls back to reading settings when pi cannot be
     * run, which yields presence without a verified directory. */
    list: (env = process.env, opts = {}) => {
      try {
        // The SELECTED executable answers (a wrapper or another binary), with
        // pi's own controlled list subcommand only: never a launch argument.
        const out = probeExecFile(opts.bin || "pi", ["list", "--no-approve"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env, timeout: 30000 });
        const rows = [];
        // pi dims the path with chalk; strip any escapes before matching.
        const lines = out.replace(/\u001b\[[0-9;]*m/g, "").split("\n");
        for (let i = 0; i < lines.length; i++) {
          const m = /^ {2}(\S+)(\s+\(filtered\))?\s*$/.exec(lines[i]);
          if (!m) continue;
          // pi prints the install path ONLY when the package is actually
          // installed (`if (pkg.installedPath)` in its list command), so an
          // absent path line is the signal for configured-but-not-installed —
          // not a parsing gap (reviewer-6ad0dde).
          const dir = /^ {4,}(\S.*)$/.exec(lines[i + 1] || "");
          rows.push({ source: m[1], filtered: !!m[2], dir: dir ? dir[1].trim() : undefined });
        }
        return rows;
      } catch {
        // pi could not be run. Settings tell us what was CONFIGURED, never what
        // is installed, so every row is marked unverified and the caller fails
        // closed rather than trusting a config file (reviewer-6ad0dde).
        const file = join(piAgentDir(env), "settings.json");
        if (!existsSync(file)) return [];
        try {
          const cfg = JSON.parse(readFileSync(file, "utf8"));
          return (Array.isArray(cfg.packages) ? cfg.packages : [])
            .map((p) => (typeof p === "string" ? { source: p } : p && typeof p === "object" && typeof p.source === "string" ? { source: p.source } : undefined))
            .filter(Boolean)
            .map((r) => ({ ...r, unverified: "could not run `pi list`" }));
        } catch { return []; } // unreadable settings: "not installed", never a false positive
      }
    },
    /** The entry's explicit `extensions` filter, if any.
     *
     * pi accepts `{ source, extensions: [...] }`, which selects WHICH of the
     * package's extensions load. For a REQUIRED capability package that matters:
     * `[]` loads none, and a non-empty filter may name a wrong or nonexistent
     * path, or simply omit the capability's extension — either way the instance
     * would start claiming wakeable messaging with no channel.
     *
     * OATS must not reimplement pi's glob matcher, which means it CANNOT prove a
     * filtered extension is active. Both cases therefore fail, with different
     * remedies. A filter on other resource kinds (e.g. `skills`) is unrelated
     * and must keep passing — the real oats-aweb entry filters skills only. */
    resourceFilter: (spec, env = process.env) => {
      const file = join(piAgentDir(env), "settings.json");
      if (!existsSync(file)) return undefined;
      try {
        const cfg = JSON.parse(readFileSync(file, "utf8"));
        const want = packageSpecIdentity(spec);
        for (const p of Array.isArray(cfg.packages) ? cfg.packages : []) {
          if (!p || typeof p !== "object" || typeof p.source !== "string") continue;
          if (packageSpecIdentity(p.source) !== want) continue;
          if (!("extensions" in p)) return undefined;
          const list = Array.isArray(p.extensions) ? p.extensions : [];
          return { extensions: list, disabled: list.length === 0 };
        }
      } catch { /* unreadable settings is handled by list() */ }
      return undefined;
    },
  },
  claude: {
    scope: "user-level (Claude Code plugins)",
    /** A plugin id is `name@marketplace`, so "@" separates the SOURCE — stripping
     * it the way a version selector is stripped would collapse plugins from
     * different marketplaces into one identity. */
    identity: (spec) => String(spec || "").trim(),
    safeSpec: (spec) => typeof spec === "string" && /^[a-z0-9][\w.-]*@[a-z0-9][\w.-]*$/i.test(spec),
    /** The executable is CONTEXT-SELECTED (oats-claude-config may name a wrapper
     * such as `claude-personal`). Probing and installing through the literal
     * `claude` would inspect a DIFFERENT account's plugins than the session
     * actually launches with — passing preflight while the real harness lacks
     * the channel, or rejecting one that has it (reviewer-6f1bb9c). */
    bin: (opts) => opts?.bin || "claude",
    argv: (spec, req, opts) => [HARNESS_PACKAGE_MANAGERS.claude.bin(opts), "plugin", "install", String(spec)],
    /** A marketplace must be registered before installing from it, so the plan
     * is a SEQUENCE. Both steps are shown at the consent prompt: agreeing to a
     * plugin also means agreeing to the source it comes from. */
    steps: (spec, req, opts) => {
      const bin = HARNESS_PACKAGE_MANAGERS.claude.bin(opts);
      return [
        ...(req?.marketplace ? [[bin, "plugin", "marketplace", "add", String(req.marketplace)]] : []),
        [bin, "plugin", "install", String(spec)],
      ];
    },
    /** Claude's own structured answer. `--json` carries id, scope, enabled,
     * projectPath and installPath — human output loses scope, and a plugin
     * installed for an UNRELATED project would then satisfy the requirement
     * globally (frontend-design is installed project-scoped for two different
     * projects on this machine). */
    list: (env = process.env, opts = {}) => {
      let out;
      try {
        out = probeExecFile(HARNESS_PACKAGE_MANAGERS.claude.bin(opts), ["plugin", "list", "--json"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60000, env });
      } catch { return []; }
      let rows;
      try { rows = JSON.parse(out); } catch { return []; }
      if (!Array.isArray(rows)) return [];
      const target = opts.context ? realPathOrNearest(opts.context) : undefined;
      return rows
        .filter((r) => r && typeof r.id === "string")
        // A user-scope install applies everywhere. A project/local install
        // applies only inside the project it belongs to.
        .filter((r) => {
          if (r.scope === "user") return true;
          if (!r.projectPath || !target) return false;
          const owner = realPathOrNearest(r.projectPath);
          return target === owner || target.startsWith(owner + sep);
        })
        // verifiedPresent is the "this harness confirms presence without naming a
        // location" override, NOT a blanket exemption: Claude DOES report
        // installPath, and setting it unconditionally meant a stale registration
        // whose install directory had been deleted still satisfied the spawn
        // preflight (reviewer-aggregate2). Claim it only when there is no path
        // to check.
        .map((r) => ({ source: r.id, enabled: r.enabled !== false, scope: r.scope, projectPath: r.projectPath, dir: r.installPath, verifiedPresent: !r.installPath }));
    },
  },
};

/** A package spec without its version selector, so `npm:@awebai/pi@latest`,
 * `npm:@awebai/pi@0.2.1` and `npm:@awebai/pi` are ONE identity. Scoped names
 * keep their leading "@" — the selector separator is the LAST "@", not the first. */
export function packageSpecIdentity(spec) {
  const s = String(spec || "").trim();
  const colon = s.indexOf(":");
  const prefix = colon > 0 ? s.slice(0, colon + 1) : "";
  const rest = colon > 0 ? s.slice(colon + 1) : s;
  if (!rest) return s;
  const scoped = rest.startsWith("@");
  const body = scoped ? rest.slice(1) : rest;
  const at = body.indexOf("@");
  return `${prefix}${scoped ? "@" : ""}${at >= 0 ? body.slice(0, at) : body}`;
}

/** What the harness reports about a required package: is it there, where did it
 * land, and does the user's entry filter its resources? A settings row alone is
 * NOT proof the capability's extension will load (reviewer-8518c49). */
/** The installed version of a harness package: neither pi's nor Claude's
 *  listing reports one, so it is read from the package.json under the
 *  install directory the listing names; undefined when there is none. */
export function installedHarnessPackageVersion(harness, spec, status) {
  const dir = status?.dir;
  if (dir && existsSync(join(dir, "package.json"))) {
    try {
      const v = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
      if (typeof v === "string" && /^\d+\.\d+\.\d+/.test(v)) return v.match(/^\d+\.\d+\.\d+/)[0];
    } catch { /* unreadable manifest: unknowable */ }
  }
  return undefined;
}

export function compareVersionTriples(a, b) {
  const pa = String(a).split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b).split(".").map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

export function harnessPackageStatus(harness, spec, env = process.env, opts = {}) {
  const mgr = HARNESS_PACKAGE_MANAGERS[harness];
  if (!mgr) return { installed: false };
  const want = harnessPackageIdentity(harness, spec);
  const row = mgr.list(env, opts).find((r) => harnessPackageIdentity(harness, r.source) === want);
  if (!row) return { installed: false };
  const filter = mgr.resourceFilter ? mgr.resourceFilter(spec, env) : undefined;
  return {
    installed: true,
    source: row.source,
    dir: row.dir,
    unverified: row.unverified,
    // No resolved directory means the package is configured but NOT installed:
    // pi omits the path line entirely in that case, so treating a missing line
    // as "fine" let a stale row through. A named directory that does not exist
    // is the same condition, reported the same way. A harness that confirms
    // presence without naming a directory (Claude's plugin list) says so via
    // verifiedPresent, so it is not judged by a path it never reports.
    missingFiles: row.verifiedPresent ? false : (!row.dir || !existsSync(row.dir)),
    // Installed but switched off will not load, so it does not satisfy a requirement.
    disabled: row.enabled === false,
    // pi's own "(filtered)" marker covers ANY resource filter (skills included),
    // so it must not be conflated with an extensions filter.
    filtered: row.filtered,
    extensionsFilter: filter ? filter.extensions : undefined,
    extensionsDisabled: !!filter?.disabled,
  };
}
/** The identity of a harness package, per that harness's own naming. */
export function harnessPackageIdentity(harness, spec) {
  const mgr = HARNESS_PACKAGE_MANAGERS[harness];
  return mgr?.identity ? mgr.identity(spec) : packageSpecIdentity(spec);
}

/** Gate: a harness package spec must be a plain source token — no shell syntax,
 * whitespace, path traversal, or option-looking leading dash. Fail closed. */
export function safeHarnessPackageSpec(spec, harness = "pi") {
  const mgr = HARNESS_PACKAGE_MANAGERS[harness];
  return mgr?.safeSpec ? mgr.safeSpec(spec) : false;
}
/** A marketplace/source token a requirement may register before installing.
 * No shell syntax, whitespace, traversal or leading dash — it is passed as argv,
 * but a hostile value would still name an attacker-chosen source. */
export function safeHarnessSourceRef(ref) {
  return typeof ref === "string" && /^[a-z0-9][\w.-]*(\/[a-z0-9][\w.-]*)*$/i.test(ref);
}

// ---------- capability lifecycle hooks ----------
/**
 * Run a lifecycle event's hooks for every active capability. Env contract:
 * OATS_EVENT/OATS_INSTANCE/OATS_HOME/OATS_AGENT/OATS_CONTEXT/OATS_LEVEL/OATS_SETTINGS/OATS_META,
 * plus the team/workspace facts (teamEnv: OATS_TEAM_SCOPE/_ID/_LABEL, OATS_WORKSPACE_NAME/_KEY);
 * cwd = the instance home. A hook may print JSON { meta, brief, warning, launch, env } — meta
 * is persisted per capability in instance.json (and fed back as OATS_META at retire), brief
 * is added to TASK.md, warning surfaces in the spawn result; launch maps harness → extra
 * launch-command arguments (spawn IS session start: the command built here is stored in
 * instance.json and runs in the tmux window; a capability integrating a harness — e.g.
 * aweb's Claude Code channel plugin — contributes its flags this way). A hook the
 * capability declares REQUIRED fails the spawn and rolls it back; every other
 * hook failure is advisory and only warns. `env` contributes string environment
 * values in the capability vendor's namespace to the launched process. Invalid
 * or colliding environment output is a fatal contract failure and enters the
 * same rollback transaction as a required spawn hook.
 */
class HookEnvironmentContractError extends Error {}

function validateHookEnvironment(capabilityID, value, owners, declarations) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HookEnvironmentContractError(`${capabilityID} hook env must be an object of string values`);
  }
  const vendorComponent = capabilityID.match(/^([^.]+)\./)?.[1];
  if (!vendorComponent || !/^[a-z][a-z0-9]*$/.test(vendorComponent)) {
    throw new HookEnvironmentContractError(`${capabilityID} hook env requires a dotted lowercase alphanumeric vendor component; hyphen, @, and / forms cannot claim an environment namespace`);
  }
  const prefix = `${vendorComponent.toUpperCase()}_`;
  // The harness half of the same contract the manifest validator enforces:
  // a hook may set names under its vendor prefix or under a namespace its
  // trusted manifest declared (environmentNamespaces), and only names the
  // manifest listed. Manifest and harness must permit exactly the same set.
  const declared = declarations.get(capabilityID) || { names: new Set(), namespaces: [] };
  const allowed = [prefix, ...(declared.namespaces || [])];
  const accepted = {};
  for (const name of Object.keys(value).sort()) {
    const envValue = value[name];
    if (!PORTABLE_ENV_NAME_RE.test(name)) {
      throw new HookEnvironmentContractError(`${capabilityID} hook env name ${JSON.stringify(name)} is invalid`);
    }
    if (CORE_LAUNCH_ENV.has(name) || name.startsWith("OATS_") || name.startsWith("PI_AGENT_")) {
      throw new HookEnvironmentContractError(`${capabilityID} hook env name ${name} collides with a reserved core variable`);
    }
    if (PROCESS_BOOTSTRAP_ENV.has(name) || PROCESS_BOOTSTRAP_PREFIXES.some((reserved) => name.startsWith(reserved))) {
      throw new HookEnvironmentContractError(`${capabilityID} hook env name ${name} collides with a reserved process bootstrap variable`);
    }
    if (!allowed.some((ns) => name.startsWith(ns))) {
      throw new HookEnvironmentContractError(`${capabilityID} hook env name ${name} is outside its ${allowed.join(", ")} namespace${allowed.length > 1 ? "s" : ""}`);
    }
    if (!declared.names.has(name)) {
      throw new HookEnvironmentContractError(`${capabilityID} hook env name ${name} is not declared in its trusted manifest environment`);
    }
    if (typeof envValue !== "string") {
      throw new HookEnvironmentContractError(`${capabilityID} hook env value for ${name} must be a string`);
    }
    if (envValue.includes("\0")) throw new HookEnvironmentContractError(`${capabilityID} hook env value for ${name} contains NUL`);
    if (envValue.includes("\n") || envValue.includes("\r")) {
      throw new HookEnvironmentContractError(`${capabilityID} hook env value for ${name} contains a newline`);
    }
    if (Buffer.byteLength(envValue, "utf8") > 8192) {
      throw new HookEnvironmentContractError(`${capabilityID} hook env value for ${name} exceeds 8192 bytes`);
    }
    if (owners.has(name)) {
      throw new HookEnvironmentContractError(`${owners.get(name)} and ${capabilityID} both claim hook env name ${name}`);
    }
    owners.set(name, capabilityID);
    accepted[name] = envValue;
  }
  return accepted;
}

/**
 * A soul's STABLE identity for capability hooks (OATS_SOUL_ID): what a provider
 * may key durable state on. Workspace soul: `<repo key>#<soul name>` — it does not
 * change when the member commits (the per-commit soul directory does) or when the
 * copy moves. Classic soul: the realpath of agents/<name>/soul, i.e. today's value,
 * so 0.24 deployments are unchanged. Order: an explicit `soulId` (a prepared spawn),
 * the home's recorded `instance.json.workspace.soul` (retire/launch of a workspace
 * home), else the path.
 */
export function stableSoulId({ soulId, home, soulDir, agentName } = {}) {
  if (typeof soulId === "string" && soulId) return soulId;
  if (home) {
    try {
      const meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
      const s = meta?.workspace?.soul;
      if (typeof s?.id === "string" && s.id) return s.id;
      if (typeof s?.repoKey === "string" && s.repoKey) return `${s.repoKey}#${meta.agent ?? agentName ?? ""}`;
    } catch { /* not a workspace home */ }
  }
  if (soulDir) { try { return realpathSync(soulDir); } catch { return soulDir; } }
  return "";
}
export const workspaceSoulId = (repoKey, name) => `${repoKey}#${name}`;
/** A prepared soul entry's id: `<repoKey>#<name>` for a member or external soul, `package:<id>#<name>`
 *  for a package soul (stable across the package's versions and independent of its repo). */
const preparedSoulIdOf = (entry) => workspaceSoulId(typeof entry.package === "string" ? `package:${entry.package}` : entry.repoKey, entry.name);
/** The soul directory an instance incarnates, as spawn recorded it (instance.json
 *  `soulDir`): a workspace soul's per-commit copy (agents/<soul>/souls/<commit12>) or
 *  the read-only soul inside a capability package. It is what every classic
 *  lifecycle hook and dispatched command sees as OATS_SOUL (captured hooks set
 *  none); instance homes carry no soul link. */
export function instanceSoulDir(home, meta = undefined) {
  if (meta === undefined && home) { try { meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8")); } catch { meta = null; } }
  return typeof meta?.soulDir === "string" && isAbsolute(meta.soulDir) ? meta.soulDir : undefined;
}

/** The team facts a lifecycle hook receives (workspace model only, lead decision
 * c3-7): the team SCOPE is the deployment directory, the team ID is the messaging
 * slot's merged payload `team` (workspace base ⊕ soul ⊕ host ⊕ spawn; no byTeam entry
 * is merged since teams amendment K): the personal team if one is set; empty = the
 * provider's default (for oats.aweb, the root's active team). The provider also gets
 * the soul's primary team LABEL and the workspace's name and canonical key, so it can
 * derive a per-person, per-workspace personal team; each label's mapped payload is in
 * OATS_TEAMS.
 * OATS_TEAM_NAME (the 0.25 `team:` block's name) is always empty, so an ambient
 * value never reaches a hook. Human decision 2026-09-24 (messaging default).
 *
 * Teams contract 2026-09-25 (decision 4): `resolved.teams` is the ELIGIBLE teams,
 * `[{ label, team, mapped, payload }]` in soul order. OATS_TEAM_LABELS is their
 * labels comma-joined and OATS_TEAMS their JSON (`[]` = no label: personal only).
 * Both are empty when the teams are not known (a home spawned before 0.26.0 whose
 * workspace cannot be read now) — empty means "unknown", never "none".
 * OATS_TEAMS_SOURCE says where the list came from: `live` (the workspace read now,
 * or a fresh resolution) or `recorded` (the spawn-time list, when a live read could
 * not answer or was not made); empty with OATS_TEAMS. A provider LEAVES a joined
 * team only on a `live` list — a recorded one lacks teams mapped since the spawn. */
export function teamEnv(resolved) {
  const ws = resolved?.workspace && typeof resolved.workspace === "object" ? resolved.workspace : {};
  const messaging = ws.slots?.messaging;
  const payload = messaging ? resolved.payloads?.[messaging] : null;
  const teamId = payload && typeof payload === "object" && typeof payload.team === "string" ? payload.team : "";
  return {
    OATS_TEAM_NAME: "", OATS_TEAM_ID: teamId, OATS_TEAM_SCOPE: typeof ws.deployment === "string" ? ws.deployment : "",
    OATS_TEAM_LABEL: typeof ws.team === "string" ? ws.team : "",
    OATS_TEAM_LABELS: Array.isArray(resolved?.teams) ? resolved.teams.map((t) => t.label).join(",") : "",
    OATS_TEAMS: Array.isArray(resolved?.teams) ? JSON.stringify(resolved.teams) : "",
    OATS_TEAMS_SOURCE: Array.isArray(resolved?.teams) && (resolved.teamsSource === "live" || resolved.teamsSource === "recorded") ? resolved.teamsSource : "",
    OATS_WORKSPACE_NAME: typeof ws.name === "string" ? ws.name : "", OATS_WORKSPACE_KEY: typeof ws.key === "string" ? ws.key : "",
  };
}
export function runLifecycleHooks(event, { home, instance, agentName, soulDir, soulId, contextDir, workspaceDir, rootDir, resolved, priorMeta = {}, extraEnv = {}, assertRoots }) {
  const results = { meta: {}, briefs: [], warnings: [], order: [], launch: {}, env: {}, failures: [], contributions: [] };
  // OATS_SOUL is set for EVERY hook: a caller that does not name the soul (launch,
  // retire) gets the directory the home's spawn recorded.
  if (!soulDir && home) soulDir = instanceSoulDir(home);
  const envOwners = new Map();
  const envDeclarations = new Map((resolved.capabilities || []).map((cap) => [cap.id, { names: new Set(cap.environment || []), namespaces: [...(cap.environmentNamespaces || [])] }]));
  const caps = [...(resolved.capabilities || [])];
  if (event === "retire") caps.reverse();
  for (const cap of caps) {
    for (const miss of cap.missingRequires || []) {
      results.warnings.push(`${cap.id}${cap.layer ? ` (${cap.layer})` : ""}: required command "${miss.command}" not on PATH — ${miss.why || "needed by this capability"}${miss.install ? ` (install: ${miss.install})` : ""}`);
    }
    if (cap.executable && !cap.trust?.trusted) results.warnings.push(`${cap.id}: executable surface disabled — ${cap.trust?.reason || "not trusted"}`);
    const cmd = cap.hooks?.[event];
    if (!cmd) continue;
    assertRoots?.();
    results.order.push(cap.id);
    try {
      const stdout = execSync(cmd, {
        cwd: home, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000,
        env: {
          ...process.env,
          // OATS_INSTANCE_HOME is the runtime-neutral contract name for the
          // instance home (absolute). OATS_HOME predates it and stays as a
          // compatibility alias: shipped capability hooks read it
          // (the official oats.aweb and oats.okf packages) and are versioned
          // independently of this kernel. Neither is OATS_HOME_DIR, which is
          // the package STORE root — do not conflate them.
          OATS_EVENT: event, OATS_INSTANCE: instance, OATS_INSTANCE_HOME: home, OATS_HOME: home, OATS_AGENT: agentName,
          OATS_CAPABILITY: cap.id, OATS_LAYER: cap.layer || "", OATS_ROOT: rootDir || "",
          OATS_SOUL: soulDir || "", OATS_SOUL_ID: stableSoulId({ soulId, home, soulDir, agentName }), OATS_CONTEXT: contextDir, OATS_WORKSPACE: workspaceDir || "", OATS_LEVEL: cap.level || "",
          ...teamEnv(resolved),
          ...extraEnv,
          // Hooks also run through direct core callers (not only bin/oats).
          // Author this from the running kernel, never PATH, ambient env or
          // a caller's extraEnv: those may point at a different executable.
          OATS_CLI_BIN: realpathSync(join(PKG_ROOT, "bin", "oats.mjs")),
          OATS_SETTINGS: JSON.stringify(cap.settings || {}),
          OATS_META: JSON.stringify(priorMeta[cap.id] || {}),
        },
      }).trim();
      const lastLine = stdout.split("\n").filter(Boolean).pop() || "{}";
      let o = {};
      try { o = JSON.parse(lastLine); } catch { /* non-JSON hook output is fine */ }
      if (o.meta) results.meta[cap.id] = o.meta;
      if (o.brief) results.briefs.push(`- ${o.brief}`);
      if (o.warning) results.warnings.push(o.warning);
      if (o.launch && typeof o.launch === "object") for (const [rt, args] of Object.entries(o.launch)) results.launch[rt] = `${results.launch[rt] ? `${results.launch[rt]} ` : ""}${args}`;
      // Provenance of what this capability contributed to the launch: which
      // harnesses it answered launch args for, and which env names, under
      // which settings and trust. A later start or harness switch reads this.
      // A launch hook's run is recorded even when its answer is empty: an
      // empty answer replaces what the provider contributed before.
      if (event === "launch" || (o.launch && typeof o.launch === "object" && Object.keys(o.launch).length) || (o.env && typeof o.env === "object" && Object.keys(o.env).length)) {
        results.contributions.push({ capability: cap.id, layer: cap.layer || null, level: cap.level || null, settings: { ...(cap.settings || {}) }, trust: { trusted: !!cap.trust?.trusted, integrity: cap.trust?.integrity || null }, launch: o.launch && typeof o.launch === "object" ? { ...o.launch } : {}, env: o.env && typeof o.env === "object" ? Object.keys(o.env).sort() : [] });
      }
      if (o.env !== undefined) {
        if (event !== "spawn" && event !== "launch") throw new HookEnvironmentContractError(`${cap.id} hook env is supported only for spawn and launch, not ${event}`);
        Object.assign(results.env, validateHookEnvironment(cap.id, o.env, envOwners, envDeclarations));
      }
    } catch (e) {
      if (e instanceof HookEnvironmentContractError) {
        const detail = String(e.message || e).slice(0, 200);
        results.warnings.push(`${cap.id} ${event} hook environment contract failed: ${detail}`);
        results.failures.push({ capability: cap.id, event, message: detail, required: true, contract: "environment" });
        // During spawn, stop before any later capability can create more state.
        // During compensation/retirement, keep going in reverse order so one
        // malformed cleanup hook cannot prevent the remaining hooks from
        // attempting their own cleanup.
        if (event === "spawn") return results;
        continue;
      }
      // A failing hook may already have created EXTERNAL state (aweb joins a
      // team before it can report success). Its stdout is the only channel for
      // handing that back, so parse it exactly as the success path does —
      // discarding it strands whatever the hook created, because compensation
      // would call retire with no metadata to act on (reviewer-bb40fa8).
      let reported;
      try {
        const failed = String(e.stdout ?? "").trim().split("\n").filter(Boolean).pop() || "{}";
        const o = JSON.parse(failed);
        if (o && typeof o === "object") {
          if (o.meta) results.meta[cap.id] = o.meta;
          // The hook's OWN diagnosis — "run `oats aweb setup`", "set team.id" —
          // is the actionable part. Without it the caller sees only
          // "Command failed: node …", which tells an operator nothing about
          // what to do (reviewer-5b78764).
          if (typeof o.warning === "string" && o.warning.trim()) reported = o.warning.trim();
        }
      } catch { /* non-JSON output from a failed hook is fine */ }
      const detail = reported || String(e.message || e).slice(0, 200);
      results.warnings.push(`${cap.id} ${event} hook failed (continuing): ${detail}`);
      // Structured failure record — compensation/rollback callers must be able
      // to DETECT hook failures, not just print them (warnings are advisory).
      const required = (cap.requiredHooks || []).includes(event);
      results.failures.push({ capability: cap.id, event, message: detail, required });
    } finally {
      assertRoots?.(); // even a failing hook may have exchanged its cwd
    }
  }
  return results;
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
  soul.name = soul.name || basename(agentDir);
  return soul;
}
export function findAgent(root, name) {
  return readSoul(join(root, name));
}
/** A soul homed at `<root>/<name>` but read from `soulDir` — a spawn preview's soul
 *  copy (previewWorkspaceSoul), never the deployment's `soul` pointer. */
export function findAgentAt(root, name, soulDir) {
  const agent = readSoul(join(root, name), soulDir);
  if (agent) agent._soulDir = soulDir;
  return agent;
}

/** Canonical capability-defined agents: a manifest's `agents: ["agents/reviewer"]`
 * entries are package-relative soul directories (soul.yaml + AGENTS.md directly
 * inside). They resolve when the capability is ACTIVE in the
 * context; the soul stays read-only in the package (fresh identity every spawn —
 * no long-term memory), while instances home under <root>/<name>/instances/ (the
 * agent dir holds only instances/). */
function capabilityAgentMetadata(manifest, rel) {
  const soulDir = manifestPath(manifest, rel);
  const soulFile = manifestPath(manifest, join(rel, "soul.yaml"));
  if (!soulDir || !soulFile) return undefined;
  // Read only contained identity metadata to decide whether this provider owns
  // the requested name. Full tree containment + trust happen after a match.
  const soul = soulHarnessField(stripInternalAnnotations(withConfigFile(soulFile, () => parseYamlFlat(readFileSync(soulFile, "utf8")))), soulFile);
  return { soulDir, soul, name: soul.name || basename(soulDir) };
}
/**
 * Workspace model: a capability-defined agent (a package's `agents:` soul, e.g.
 * OKF's memory-harvest worker) resolves from a MATERIALIZED module — the copy the
 * requesting instance already carries under <home>/.oats/modules/<cap>/. Looks in
 * `anchorHome` first (the --parent / --relative-to instance), then every instance
 * home under `root`; the first module declaring an agent of that name wins.
 * → the same shape findCapabilityAgent returns, plus `_manifestSource` (the home
 * whose modules supplied it) so skill/inject lookups read that copy.
 */
export function findModuleCapabilityAgent(root, name, { anchorHome = null } = {}) {
  if (typeof name !== "string" || !name) return undefined;
  const homes = [];
  if (anchorHome) homes.push(anchorHome);
  if (root && existsSync(root)) {
    for (const a of readdirSync(root, { withFileTypes: true })) {
      if (!a.isDirectory() || a.name.startsWith(".")) continue;
      const inst = join(root, a.name, "instances");
      if (!existsSync(inst)) continue;
      for (const i of readdirSync(inst, { withFileTypes: true })) if (i.isDirectory() && !i.name.startsWith(".")) homes.push(join(inst, i.name));
    }
  }
  const seen = new Set();
  const failures = [];
  for (const home of homes) {
    const real = (() => { try { return realpathSync(home); } catch { return null; } })();
    if (!real || seen.has(real)) continue;
    seen.add(real);
    const modules = instanceModulesRoot(real);
    if (!modules) continue;
    for (const [id, manifest] of Object.entries(capabilityManifests(real))) {
      for (const rel of manifest?.agents || []) {
        let meta;
        try { meta = capabilityAgentMetadata(manifest, rel); } catch { continue; }
        if (!meta || meta.name !== name) continue;
        try {
          assertCapabilityTreeContained(manifest, meta.soulDir, "agent");
          return {
            ...meta.soul, name,
            kind: "capability", capability: id,
            _dir: join(root, name),
            _soulDir: meta.soulDir,
            _manifestSource: real,
            _module: manifest._module,
          };
        } catch (e) { failures.push(e); }
      }
    }
  }
  if (failures.length) throw failures[0];
  return undefined;
}
/**
 * A capability-defined agent from ONE capability directory (a package tree the
 * workspace resolver fetched into the deployment's module store). The manifest is
 * read from `dir`, trusted by construction (the workspace declares the package; the lock pins it), and
 * the agent record points its skill/inject lookups at that store entry.
 */
export function capabilityAgentFromDir(dir, name, root, { module = null } = {}) {
  const manifest = loadManifestAt(dir, `module:${dir}`);
  if (!manifest) return undefined;
  manifest._module = module;
  for (const rel of manifest.agents || []) {
    let meta;
    try { meta = capabilityAgentMetadata(manifest, rel); } catch { continue; }
    if (!meta || meta.name !== name) continue;
    assertCapabilityTreeContained(manifest, meta.soulDir, "agent");
    return { ...meta.soul, name, kind: "capability", capability: manifest.capability, _dir: join(root, name), _soulDir: meta.soulDir, _manifestSource: dir, _manifest: manifest, _module: module };
  }
  return undefined;
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

export function defaultRepo(cwd = process.cwd()) {
  return shTry(`git -C ${shq(resolve(cwd))} rev-parse --show-toplevel`);
}
export function resolveRepo(root, repo) {
  if (!repo) return undefined;
  const abs = isAbsolute(repo) ? repo : join(workspaceOf(root), repo);
  if (!existsSync(abs)) throw new Error(`repo not found: ${abs}`);
  if (!shTry(`git -C ${shq(abs)} rev-parse --git-dir`)) throw new Error(`not a git repo: ${abs}`);
  return abs;
}

/** The repository an attached work tree's OWNER recorded: `<owner home>/work` is the
 *  tree (the owner's own worktree or checkout). Undefined when the tree is not an
 *  instance's work/ (an integration worktree names its repository explicitly). */
function attachedOwnerRepo(workDir) {
  if (typeof workDir !== "string" || !workDir) return undefined;
  let tree;
  try { tree = realpathSync(workDir); } catch { return undefined; }
  for (const home of new Set([dirname(resolve(workDir)), dirname(tree)])) {
    try {
      if (realpathSync(join(home, "work")) !== tree) continue;
      const meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
      if (typeof meta?.repo === "string" && meta.repo) return meta.repo;
    } catch { /* not an instance home */ }
  }
  return undefined;
}
/** Only explicit directory execution relaxes the Git requirement. `repo` is
 * still the config/deployment context, never a directory we take ownership of. */
function resolveExecutionContext(root, target, work) {
  if (work !== "directory") return resolveRepo(root, target);
  if (target !== undefined && (typeof target !== "string" || !target.trim() || target.includes("\0"))) {
    throw oatsError("E_BAD_ARGS", "directory mode repo must name an existing context directory");
  }
  const context = target === undefined ? workspaceOf(root) : resolve(workspaceOf(root), target);
  if (!existsSync(context) || !statSync(context).isDirectory()) throw oatsError("E_BAD_ARGS", `directory mode context is not a directory: ${context}`);
  return resolve(context);
}

// ---------- OKF (Open Knowledge Format) helpers ----------
export function todayISO() { return new Date().toISOString().slice(0, 10); }

/**
 * Append a one-line entry to an OKF log.md (newest-first, date-grouped per spec §7).
 * Creates the file with `# <title>` if missing.
 */
export function appendLogEntry(file, entry, title = "Log") {
  const today = todayISO();
  const text = existsSync(file) ? readFileSync(file, "utf8") : `# ${title}\n`;
  const lines = text.split("\n");
  const todayIdx = lines.findIndex((l) => l.trim() === `## ${today}`);
  if (todayIdx !== -1) {
    lines.splice(todayIdx + 1, 0, `* ${entry}`);
  } else {
    let h = lines.findIndex((l) => l.startsWith("# "));
    if (h === -1) h = 0;
    lines.splice(h + 1, 0, "", `## ${today}`, `* ${entry}`);
  }
  writeFileSync(file, lines.join("\n").replace(/\n{3,}/g, "\n\n"));
}

/** Flat soul YAML uses strings; never treat the string "false" as truthy. */
export function resolveYolo(value) {
  if (value === undefined) return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error("yolo must be true or false");
}

// ---------- instances ----------
/** Every instance home under this deployment's agents root, by name → [home] —
 *  `<root>/<agent>/instances/<name>` read directly (so a home whose soul definition was
 *  removed still counts, and a capability-defined agent's homes count). Instance names are
 *  deployment-wide (human decision 2026-09-24): two souls never hold one name. */
function deploymentInstanceHomes(root) {
  const homes = new Map();
  const collect = (agentDir) => {
    const dir = join(agentDir, "instances");
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || !(e.isDirectory() || e.isSymbolicLink())) continue;
      if (!homes.has(e.name)) homes.set(e.name, []);
      homes.get(e.name).push(join(dir, e.name));
    }
  };
  let entries; try { entries = readdirSync(root, { withFileTypes: true }); } catch { entries = []; }
  for (const e of entries) if (e.isDirectory() && !e.name.startsWith(".")) collect(join(root, e.name));
  return homes;
}

/** Every soul name of this deployment: souls on the agents root and capability
 *  agent dirs there (every agent dir), plus — for a workspace spawn — every soul the
 *  discovery declares (members and external), fetched or not. */
function deploymentSoulNames(root, prepared) {
  const names = new Set(listAgents(root).map((a) => a.name));
  try { for (const e of readdirSync(root, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith(".") && !RESERVED.has(e.name)) names.add(e.name); } catch { /* no root yet */ }
  const discovery = prepared?.discovery;
  for (const m of discovery?.members || []) for (const s of m.souls || []) if (typeof s?.name === "string") names.add(s.name);
  for (const x of discovery?.external || []) if (typeof x?.soul?.name === "string") names.add(x.soul.name);
  return names;
}

/** Instance names are at most 64 characters: the tightest consumer is the
 *  messaging alias (aweb allows 1–64 on both servers). A longer name is refused,
 *  never truncated — a name is never rewritten. */
export const MAX_INSTANCE_NAME = 64;
const nameTooLong = (name, remedy) => oatsError("E_INSTANCE_NAME_INVALID", `instance names are at most ${MAX_INSTANCE_NAME} characters; "${name}" is ${name.length} — ${remedy}`);

/** A derived name (`<soul>-<purpose>`, `<soul>-<n>`), de-duplicated
 *  deployment-wide against every instance and soul name (`-2`, `-3`, …). The
 *  final name, suffix included, is capped at MAX_INSTANCE_NAME. */
function nextInstanceName(root, agent, purpose, prepared) {
  const n = deriveInstanceName(root, agent, purpose, prepared);
  if (n.length > MAX_INSTANCE_NAME) throw nameTooLong(n, purpose ? `shorten the purpose (${JSON.stringify(slug(purpose))})` : `the soul name "${agent.name}" is too long to derive an instance name from; pass a shorter --name`);
  return n;
}
function deriveInstanceName(root, agent, purpose, prepared) {
  const base = purpose ? `${agent.name}-${slug(purpose)}` : undefined;
  const instancesDir = join(agent._dir, "instances");
  const own = existsSync(instancesDir) ? readdirSync(instancesDir) : [];
  const instances = deploymentInstanceHomes(root), souls = deploymentSoulNames(root, prepared);
  const taken = (n) => instances.has(n) || souls.has(n);
  if (base) {
    let n = base, i = 2;
    while (taken(n)) n = `${base}-${i++}`;
    return n;
  }
  let i = own.length + 1, n;
  do { n = `${agent.name}-${i++}`; } while (taken(n));
  return n;
}

/** `--name` (human decision 2026-09-24): the instance name is exactly `name` —
 *  never rewritten, never prefixed. It must already be a slug. (That it is not a
 *  soul name, and not taken, is checked after idempotency-key recovery.) */
export function explicitInstanceName(name) {
  if (typeof name !== "string" || !name || slug(name) !== name) {
    throw oatsError("E_INSTANCE_NAME_INVALID", `instance name ${JSON.stringify(name)} is not a slug (lowercase letters and digits, single dashes between them${typeof name === "string" && name ? `; e.g. ${slug(name)}` : ""}); --name is used exactly as given, never rewritten`);
  }
  if (name.length > MAX_INSTANCE_NAME) throw nameTooLong(name, "pass a shorter --name");
  return name;
}

function tmuxAlive(session) { return !!shTry(`tmux has-session -t ${shq(session)} 2>/dev/null && echo yes`); }
function tmuxSocket(session) {
  let socket;
  try {
    socket = execFileSync("tmux", ["display-message", "-p", "-t", session, "#{socket_path}"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `could not identify the tmux endpoint for session ${session}: ${String(e.stderr ?? e.message ?? "").trim() || "tmux display-message failed"}`);
  }
  if (!socket) throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `tmux returned no endpoint for session ${session}`);
  return resolve(socket);
}
export function tmuxWindows(session = DEFAULT_TMUX_SESSION) {
  if (!tmuxAlive(session)) return [];
  return (shTry(`tmux list-windows -t ${shq(session)} -F '#{window_name}'`) || "").split("\n").filter(Boolean);
}

/**
 * Spawn an instance of `agent` (as returned by findAgent/listAgents).
 * o: { instance?, purpose?, name?, repo?, work?, harness?, model?, task?, taskFile?, branch?, launch?, tmuxSession? }
 */
/** The claude binary for a context: closest `oats-claude-config` (a one-line file
 * naming the binary, e.g. "claude-personal") walking up from contextDir wins; no
 * file → "claude". Local-only by design — a personal machine preference (account
 * selection), never committed config; keep it out of version control. */
export function resolveClaudeBinary(contextDir) {
  let d = resolve(contextDir);
  while (true) {
    const f = join(d, "oats-claude-config");
    if (existsSync(f)) {
      const name = readFileSync(f, "utf8").split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
      if (name) return name;
    }
    const parent = dirname(d);
    if (parent === d) return "claude";
    d = parent;
  }
}

/** Resolve a model preference LIST (comma-separated "provider/id[:thinking]" patterns)
 * to the first entry whose provider/model is actually available to the harness.
 * pi: checked against `pi --list-models <pattern>` (authenticated providers).
 * claude: pi-style patterns are translated (anthropic/<id> → <id>) or dropped —
 * claude takes aliases/bare claude-* ids only; nothing usable → "" (claude default).
 * codex: translate openai/openai-codex entries to native ids, otherwise use its default.
 * Probe failures: first entry wins (pi errors loudly at launch). */
export function resolveModelPreference(model, harness = "pi") {
  const prefs = String(model || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (harness === "codex") {
    for (const pref of prefs) {
      const bare = pref.replace(/:[a-z]+$/i, "");
      if (!bare.includes("/")) return bare;
      const [provider, ...rest] = bare.split("/");
      if (["openai", "openai-codex"].includes(provider) && rest.length) return rest.join("/");
    }
    return ""; // let Codex use its configured model rather than another provider's id
  }
  if (harness === "claude") {
    // Claude accepts its aliases and bare claude-* ids — NOT pi-style
    // "provider/model[:thinking]" patterns. Agents whose soul default is a
    // pi model are routinely harness-overridden to claude; passing the pi
    // pattern through makes claude reject the model at launch (operator
    // report, dev-coordinator-claude-sessions). Translate anthropic-provider
    // entries to the bare id (strip provider + :thinking) and drop other
    // providers' entries; no usable entry ⇒ "" (claude's own default).
    for (const pref of prefs) {
      const bare = pref.replace(/:[a-z]+$/i, "");
      if (!bare.includes("/")) return bare;              // alias or bare claude-* id
      const [provider, ...rest] = bare.split("/");
      if (provider === "anthropic" && rest.length) return rest.join("/");
    }
    return "";
  }
  if (prefs.length <= 1) return prefs[0] || "";
  if (harness !== "pi") return prefs[0];
  for (const pref of prefs) {
    const bare = pref.replace(/:[a-z]+$/i, ""); // strip :<thinking> for the catalog probe
    const [provider, ...rest] = bare.split("/");
    const id = rest.join("/");
    if (!id) return pref; // bare pattern (no provider) — let pi resolve it
    const out = probeTry(`pi --list-models ${shq(id)} 2>/dev/null`) || "";
    const found = out.split("\n").some((line) => {
      const cols = line.trim().split(/\s+/);
      return cols[0] === provider && cols[1] === id;
    });
    if (found) return pref;
  }
  return prefs[0];
}

// Relations a new instance can declare to an existing one at spawn time.
// "unrelated" is the no-link default (normalized away before recording).
export const RELATIONS = ["child", "sibling", "parent", "unrelated"];

/** Verify the harness packages that ACTIVE capabilities require for `harness`.
 *
 * Each comes from a declared harness-package requirement, so the capability has
 * stated the dependency and the user has consented to install it (`oats install`).
 * We verify PRESENCE and record provenance; we deliberately do NOT resolve the
 * extension's entry file. pi owns that resolution — its manifest supports globs
 * and exclusions, packages without a `pi` manifest use conventional directories,
 * and the package root is relocatable — so reimplementing it here would be a
 * second, wrong copy of pi's rules (reviewer-ad1b9f0). Extensions load through
 * pi's own discovery.
 *
 * Absence still fails the spawn: "aweb on pi requires the aweb pi package" is a
 * promise the instance's INSTRUCTIONS rely on, so starting without it would
 * leave the agent believing it can be woken by mail when it cannot. */
/** A harness-package requirement names its harness `harness` (0.27.0) or, as
 *  released manifests do (oats.aweb), `runtime`: read either, exactly one. */
export function requirementHarness(row) {
  if (!row || typeof row !== "object") return undefined;
  return Object.hasOwn(row, "harness") ? row.harness : row.runtime;
}
function verifyHarnessPackages(harness, resolved, contextDir, { bin, env } = {}) {
  const probeEnv = env || process.env;
  const found = [];
  const problems = [];
  // The session launches with the SELECTED executable (a configuration's,
  // or the context-selected one: oats-claude-config may name
  // `claude-personal`), so probing another binary would inspect a different
  // account's packages than the instance will actually use. The probe is the
  // manager's controlled list subcommand; no launch argument is added to it.
  const probeOpts = { context: contextDir, ...(bin ? { bin } : harness === "claude" ? { bin: resolveClaudeBinary(contextDir) } : {}) };
  for (const cap of resolved.capabilities || []) {
    for (const raw of cap.manifest?.requires || []) {
      if (!raw || typeof raw !== "object") continue;
      if (Object.hasOwn(raw, "harness") && Object.hasOwn(raw, "runtime")) { problems.push(`${cap.id}: a requirement declares both \`harness\` and \`runtime\` (its pre-0.27 name); keep one`); continue; }
      if (requirementHarness(raw) !== harness) continue;
      // A requirement may be conditional on the capability's effective
      // settings (`when: { delivery: "channel" }`): rows whose condition does
      // not hold are not requirements of this spawn at all.
      if (raw.when !== undefined && (!raw.when || typeof raw.when !== "object" || Array.isArray(raw.when))) { problems.push(`${cap.id}: a requirement's \`when\` must be an object of setting names to values`); continue; }
      if (raw.when && !Object.entries(raw.when).every(([k, v]) => String(cap.settings?.[k] ?? "") === String(v))) continue;
      const spec = raw.package;
      if (!safeHarnessPackageSpec(spec, harness)) { problems.push(`${cap.id}: ${harness} package spec is not a plain source token (${JSON.stringify(spec)})`); continue; }
      if (raw.marketplace !== undefined && !safeHarnessSourceRef(raw.marketplace)) { problems.push(`${cap.id}: marketplace is not a plain source reference (${JSON.stringify(raw.marketplace)})`); continue; }
      const status = harnessPackageStatus(harness, spec, probeEnv, probeOpts);
      const mgr = HARNESS_PACKAGE_MANAGERS[harness];
      const stepList = mgr?.steps ? mgr.steps(spec, raw, probeOpts) : [mgr?.argv(spec, raw, probeOpts) || []];
      const direct = stepList.filter((a) => a.length).map((a) => a.join(" ")).join(" && ");
      const remedy = `run \`oats install --accept-requirement ${harness}:${harnessPackageIdentity(harness, spec)} --dir ${contextDir}\`${direct ? ` (or \`${direct}\` directly)` : ""}`;
      // `ifInstalled: true`: the row constrains a package that may be absent
      // (an ambient extension must honour a contract IF it is there); absence
      // satisfies it. Without the flag, absence fails as before.
      if (!status.installed) { if (raw.ifInstalled === true) continue; problems.push(`${cap.id} requires the ${harness} package ${spec}, which is not installed — ${remedy}`); continue; }
      // A settings row is not proof the extension loads. Both of these leave the
      // capability silently absent, which is the loss this gate exists to stop.
      if (status.unverified) { problems.push(`${cap.id} requires the ${harness} package ${spec}: it is configured, but OATS could not verify it is installed (${status.unverified}) — a config entry is not an installation; ${remedy}`); continue; }
      if (status.missingFiles) {
        problems.push(status.dir
          ? `${cap.id} requires the ${harness} package ${spec}: ${harness} lists it at ${status.dir}, but nothing is installed there — ${remedy}`
          : `${cap.id} requires the ${harness} package ${spec}: ${harness} has it configured but reports no installed location, so it was never installed — ${remedy}`);
        continue;
      }
      if (status.disabled) { problems.push(`${cap.id} requires the ${harness} package ${spec}, which is installed but DISABLED, so it will not load — enable it (\`${probeOpts.bin || harness} plugin enable ${spec}\` for Claude), or drop the capability for this soul`); continue; }
      if (status.extensionsDisabled) { problems.push(`${cap.id} requires the ${harness} package ${spec}, but your ${harness} settings entry sets "extensions": [], which loads none of them — remove that filter, or drop the capability for this soul`); continue; }
      // A floor on the installed version (`minVersion`), checked once presence
      // and loadability are settled: a package whose manifest states an older
      // version, or none, fails closed with the same remedy, since an old
      // extension that ignores a newer contract (AWEB_DELIVERY) is exactly
      // what the floor guards.
      if (raw.minVersion) {
        const have = installedHarnessPackageVersion(harness, spec, status);
        if (!have) { problems.push(`${cap.id} requires the ${harness} package ${spec} at ${raw.minVersion} or later, but its installed version cannot be established (no package manifest under its install directory) — ${remedy}`); continue; }
        if (compareVersionTriples(have, raw.minVersion) < 0) { problems.push(`${cap.id} requires the ${harness} package ${spec} at ${raw.minVersion} or later; ${have} is installed — ${remedy}`); continue; }
      }
      if (status.extensionsFilter?.length) {
        // Unverifiable, not merely auditable: proving the filter selects this
        // capability's extension means implementing pi's glob semantics, and
        // guessing here is how an instance ends up promising a channel it does
        // not have. A filter on other resource kinds (skills) is unaffected.
        problems.push(`${cap.id} requires the ${harness} package ${spec}, but your ${harness} settings entry filters its extensions (${status.extensionsFilter.map((e) => JSON.stringify(e)).join(", ")}). OATS cannot verify that filter selects the required extension without reimplementing ${harness}'s matcher — remove the "extensions" filter for this package (a skills-only filter is fine), or drop the capability for this soul`);
        continue;
      }
      found.push({ capability: cap.id, harness, package: spec, identity: harnessPackageIdentity(harness, spec), dir: status.dir, filtered: status.filtered });
    }
  }
  if (problems.length) {
    throw oatsError("E_HARNESS_RESOURCE_MISSING", `this instance runs on ${harness}, and its active capabilities require harness packages that are not installed:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  }
  const seen = new Set();
  return found.filter((x) => (seen.has(x.identity) ? false : seen.add(x.identity))).sort((a, b) => a.identity.localeCompare(b.identity));
}

// ---------- launch recipes ----------
// What a harness start is made of, recorded in instance.json (`launch`) so a
// later start or restart can re-render it, select another configuration, or
// switch harness without guessing from the command string. The rendered
// command (`command`) stays beside it, byte-identical to what spawn rendered
// before recipes existed when no configuration is selected. Version 2 (0.27.0)
// names the harness `harness`; version 1 (0.26.0 homes) said `runtime` and is
// read as version 2 (upgradeLaunchRecipe); the next start or restart rewrites it.
export const LAUNCH_RECIPE_VERSION = 2;
/** A recorded recipe as this kernel reads it: version 1 `{runtime}` (0.26.0) is
 *  version 2 `{harness}` (lead call 6: read either, write new). Anything else is
 *  returned as it is, for assertLaunchRecipe to judge. */
export function upgradeLaunchRecipe(recipe) {
  if (!isPlainObject(recipe) || recipe.version !== 1 || Object.hasOwn(recipe, "harness")) return recipe;
  const { runtime, ...rest } = recipe;
  return { ...rest, version: LAUNCH_RECIPE_VERSION, harness: runtime };
}
/** A home's instance.json as this kernel reads it: 0.26.0 recorded `runtime` and a
 *  version-1 recipe; both read as `harness` (lead call 6). Every reader of a home's
 *  harness goes through here; the next start or restart writes the new names. */
export function upgradeHomeMeta(meta, home) {
  if (!isPlainObject(meta)) return meta;
  const old = Object.hasOwn(meta, "runtime") || (isPlainObject(meta.launch) && meta.launch.version === 1 && !Object.hasOwn(meta.launch, "harness"));
  if (!old) return meta;
  noteRuntimeName(`instance.json of ${home || meta.home || meta.instance} (a 0.26.0 home: its next start or restart records harness)`);
  const { runtime, ...rest } = meta;
  return { ...rest, ...(runtime !== undefined || meta.harness !== undefined ? { harness: meta.harness ?? runtime } : {}), ...(meta.launch !== undefined ? { launch: upgradeLaunchRecipe(meta.launch) } : {}) };
}
const LAUNCH_PROMPT = { kind: "task-file", file: "TASK.md" };

/** The executable a launch uses: a configuration's declared one (a bare name
 *  on PATH; a path against the deployment directory when relative) or the
 *  harness's default (claude through oats-claude-config). Never executed. */
export function resolveLaunchExecutable({ harness, declared, declaringDir, contextDir }) {
  if (declared) {
    if (declared.includes("/")) {
      const path = isAbsolute(declared) ? declared : resolve(declaringDir || contextDir, declared);
      return { path, declared, resolvedFrom: isAbsolute(declared) ? "absolute" : `relative to ${declaringDir || contextDir}`, missing: existsSync(path) ? undefined : `${declared} (${path}) does not exist` };
    }
    const found = which(declared);
    return { path: found || null, declared, resolvedFrom: "PATH", missing: found ? undefined : `${declared} binary not found on PATH` };
  }
  const claudeBin = harness === "claude" ? resolveClaudeBinary(contextDir) : undefined;
  const name = harness === "claude" ? claudeBin : harness;
  const found = which(name);
  return { path: found || null, declared: null, resolvedFrom: harness === "claude" && claudeBin !== "claude" ? "oats-claude-config" : "PATH", missing: found ? undefined : `${name} binary not found on PATH${claudeBin && claudeBin !== "claude" ? " (named by oats-claude-config)" : ""}` };
}
/** null when `path` is a regular executable file; otherwise why not. */
export function checkLaunchExecutable(path) {
  try {
    const st = statSync(path);
    if (!st.isFile()) return `${path} is not a regular file`;
    accessSync(path, fsConstants.X_OK);
    return null;
  } catch (e) { return `${path} ${e.code === "ENOENT" ? "does not exist" : e.code === "EACCES" ? "is not executable" : e.message}`; }
}
/** Source names of {fromEnv} references absent from `env`. */
export function missingLaunchEnvRefs(configEnv, env = process.env) {
  return Object.values(configEnv || {}).filter((v) => v && typeof v === "object" && v.fromEnv && env[v.fromEnv] === undefined).map((v) => v.fromEnv).sort();
}
/** The selection a start makes: which configuration (explicit name, "none",
 *  a frozen recipe's, or the soul's default), and from it the harness and
 *  model. A named configuration is a unit: an explicit harness that disagrees
 *  with it is refused. On an existing home, --harness alone leaves the old
 *  configuration behind (its executable and args are not carried), and a
 *  model never crosses harnesses: explicit or configured model, else the
 *  frozen model on the same harness, else the harness's native default. */
/** Sentinel a caller passes as `model` to mean "the harness's own default, not the configured/soul preference". */
export const NATIVE_DEFAULT_MODEL = "@native-default";
export function resolveLaunchSelection({ launchConfigs = {}, agent, frozen, selection = {} }) {
  const bad = (code, msg) => { throw oatsError(code, msg); };
  let wanted = selection.launchConfig;
  let config = null;
  if (wanted === undefined && frozen && !selection.harness) {
    // An ordinary start of an existing home runs what was recorded: its
    // configuration as captured (executable, args, env, references), whether
    // or not the scope still declares it that way. Only an explicit name
    // applies the current definition.
    // Named or not: the recorded executable (a saved wrapper, say), args and
    // env are what runs; later edits of the scope never change it.
    config = { name: frozen.launchConfig || null, harness: frozen.harness, ...(frozen.executableDeclared ? { executable: frozen.executableDeclared } : {}), executablePath: frozen.executable, args: [...(frozen.args || [])], env: { ...(frozen.env || {}) }, ...(frozen.model ? { model: frozen.model } : {}), ...(frozen.yolo !== undefined ? { yolo: frozen.yolo } : {}), source: frozen.launchConfigSource || null, frozen: true };
    wanted = "none";
  }
  if (wanted === undefined) wanted = frozen ? "none" : (agent?.["launch-config"] || "none");
  if (wanted !== "none") {
    if (typeof wanted !== "string" || !Object.hasOwn(launchConfigs, wanted)) bad("E_LAUNCH_CONFIG_UNKNOWN", `no launch configuration ${JSON.stringify(wanted)} is effective here${frozen?.launchConfig === wanted ? " any more (the home was started with it; an unqualified start still runs the recorded one)" : ""}; oats launch-config list shows what is`);
    config = launchConfigs[wanted];
    if (selection.harness && selection.harness !== config.harness) bad("E_LAUNCH_CONFIG_MISMATCH", `launch configuration ${wanted} starts ${config.harness}; --harness ${selection.harness} disagrees with it (select another configuration, or --launch-config none with --harness)`);
  }
  const harness = config?.harness || selection.harness || (frozen ? frozen.harness : agent?.harness || "pi");
  if (!LAUNCH_HARNESSES.includes(harness)) bad("E_UNSUPPORTED_HARNESS", `unknown harness "${harness}" (pi|claude|codex)`);
  let model, modelSource;
  // K6: an EXPLICIT "use the harness's native default" is distinct from an
  // omitted model (which inherits the configuration's or soul's preference).
  const nativeDefault = selection.model === NATIVE_DEFAULT_MODEL || (selection.model && typeof selection.model === "object" && selection.model.kind === "native-default");
  const explicit = !nativeDefault && selection.model !== undefined && selection.model !== null && String(selection.model).trim() !== "";
  if (nativeDefault) {
    model = ""; modelSource = "native default (explicit)";
  } else if (explicit) {
    model = resolveModelPreference(String(selection.model), harness); modelSource = "explicit";
    if (!model) bad("E_MODEL_UNKNOWN", `model preference ${JSON.stringify(selection.model)} has no entry usable by harness ${harness}; give a ${harness} model id`);
  } else if (config?.model) {
    model = config.frozen ? config.model : resolveModelPreference(config.model, harness); modelSource = config.frozen ? "recorded" : `launch-config ${config.name}`;
    if (!model) bad("E_MODEL_UNKNOWN", `launch configuration ${config.name} names model ${JSON.stringify(config.model)}, which has no entry usable by harness ${harness}`);
  } else if (frozen) {
    if (frozen.harness === harness) { model = frozen.model || ""; modelSource = model ? "recorded" : "native default"; }
    else { model = ""; modelSource = "native default (harness changed)"; }
  } else if (harness !== (agent?.harness || "pi")) {
    // A soul's model preference belongs to the soul's harness; a bare alias
    // is no proof it fits another one. Nothing is passed across.
    model = ""; modelSource = "native default (harness differs from the soul's)";
  } else { model = resolveModelPreference(agent?.model || "", harness); modelSource = model ? "soul default" : "native default"; }
  return { config, harness, model, modelSource, configuredYolo: config?.yolo };
}
/** The pane environment carrying each reference's value under a
 *  kernel-owned alias (OATS_LAUNCH_REF_<NAME>), which no configuration can
 *  name: the command says NAME="$OATS_LAUNCH_REF_NAME", so no source
 *  variable is ever named in the command and no assignment in the same
 *  prefix can shadow it (zsh evaluates a prefix's assignments in order).
 *  Rendered as tmux `-e` flags or a shell export prefix. */
export function launchEnvRefs(recipe, env = process.env) {
  const out = [];
  for (const [name, v] of Object.entries(recipe.env || {})) if (v && typeof v === "object" && v.fromEnv && env[v.fromEnv] !== undefined) out.push({ name: `${LAUNCH_REF_PREFIX}${name}`, value: env[v.fromEnv], target: name, source: v.fromEnv });
  return out;
}
export function launchEnvTmuxFlags(recipe, env) { return launchEnvRefs(recipe, env).map((r) => ` -e ${shq(`${r.name}=${r.value}`)}`).join(""); }
export function launchEnvExports(recipe, env) { return launchEnvRefs(recipe, env).map((r) => `export ${r.name}=${shq(r.value)}; `).join(""); }

/** The harness command line of a recipe. With no configuration the bytes
 *  equal what spawn rendered before recipes: env prefix, the executable, the
 *  harness's own arguments, capability launch args, the task prompt. A
 *  configuration's args go after the harness's own options and before
 *  capability args; for claude/codex the `--` separator keeps them from
 *  swallowing the task, for pi they follow the task like capability args.
 *
 *  pi starts NORMALLY (decision 13 of the workspace model): its own skill and
 *  context discovery is left intact — the instance's copied capability skills
 *  under <home>/.agents/skills are found from cwd=home like any repo's — and OATS
 *  contributes only the composed AGENTS.md (--append-system-prompt). The task
 *  positional goes ahead of contributed options because pi has no `--`. claude gets `--` before the prompt so a
 *  greedy contributed flag cannot eat it. codex keeps its native policy;
 *  yolo also trusts this generated home for the launch (projects=...). */
export function renderLaunchRecipe(recipe, { home, instance, redact = false }) {
  const { harness, executable, model, yolo } = recipe;
  const cfgArgs = (recipe.args || []).map(shq).join(" ");
  const hookArgs = recipe.hooks?.launch?.[harness] || "";
  const tail = `${cfgArgs ? ` ${cfgArgs}` : ""}${hookArgs ? ` ${hookArgs}` : ""}`;
  let cmdline;
  if (harness === "claude") {
    cmdline = `${shq(executable)}${yolo ? " --dangerously-skip-permissions" : ""}${model ? ` --model ${shq(model)}` : ""}${tail} -- "$(cat TASK.md)"`;
  } else if (harness === "codex") {
    const codexTrust = `projects={${JSON.stringify(realPathOrNearest(home))}={trust_level="trusted"}}`;
    cmdline = `${shq(executable)} --cd ${shq(home)}${yolo ? ` --yolo -c ${shq(codexTrust)}` : ""}${model ? ` --model ${shq(model)}` : ""}${tail} -- "$(cat TASK.md)"`;
  } else {
    // Decision 13: pi starts NORMALLY — its own skill discovery (~/.pi/agent/skills,
    // .agents/skills up the tree, so the instance's copied capability skills are
    // found from cwd=home) and context files stay ambient. OATS contributes only
    // the composed instructions.
    cmdline = `${shq(executable)} --append-system-prompt ${shq(join(home, "AGENTS.md"))} --approve --name ${shq(instance)}${model ? ` --model ${shq(model)}` : ""} ${shq("@TASK.md")}${tail}`;
  }
  const hookEnv = recipe.hooks?.env || {};
  const envTokens = Object.keys(hookEnv).sort().map((name) => `${name}=${shq(redact ? "<redacted>" : hookEnv[name])}`);
  for (const name of Object.keys(recipe.env || {}).sort()) {
    const v = recipe.env[name];
    envTokens.push(typeof v === "string" ? `${name}=${shq(redact ? "<redacted>" : v)}` : `${name}="$${LAUNCH_REF_PREFIX}${name}"`);
  }
  return `OATS_INSTANCE=${shq(instance)} OATS_INSTANCE_HOME=${shq(home)} PI_AGENT_INSTANCE=${shq(instance)} PI_AGENT_HOME=${shq(home)}${envTokens.length ? ` ${envTokens.join(" ")}` : ""} ${cmdline}`;
}

/** Execution, not preview: mark pending before dispatch, then resolve native
 * storage inside the backend shell under the actual command environment.
 * The original executable/argv is exec'd unchanged after recording succeeds. */
function nativeRecordCommand(command, home, harness) {
  const { tokens, binary } = parseLaunchCommand(command);
  const args = tokens.slice(binary + 1).filter(t => t.kind !== "prompt").map(t => t.value ?? t.text);
  const id = prepareNativeStart(home, harness);
  const recorder = join(PKG_ROOT, "packages", "record", "bin", "record-native-start.mjs");
  const inner = `${shq(process.execPath)} ${shq(recorder)} ${shq(home)} ${shq(id)} ${shq(harness)} ${shq(JSON.stringify(args))} && exec ${tokens.slice(binary).map(t => t.text).join(" ")}`;
  return `${tokens.slice(0, binary).map(t => t.text).join(" ")} /bin/sh -c ${shq(inner)}`;
}


/** A recorded recipe this kernel understands, or a refusal before anything
 *  is observed or stopped. */
export function assertLaunchRecipe(recipe, what) {
  const bad = (why) => { throw oatsError("E_LAUNCH_RECIPE_UNSUPPORTED", `${what} records a launch recipe this kernel cannot start from (${why}); inspect launch in its instance.json`); };
  if (!recipe || typeof recipe !== "object") bad("not an object");
  recipe = upgradeLaunchRecipe(recipe);
  if (recipe.version !== LAUNCH_RECIPE_VERSION) bad(`version ${JSON.stringify(recipe.version)}, expected ${LAUNCH_RECIPE_VERSION}`);
  if (!LAUNCH_HARNESSES.includes(recipe.harness)) bad(`harness ${JSON.stringify(recipe.harness)}`);
  if (typeof recipe.executable !== "string" || !recipe.executable) bad("no executable");
  if (!Array.isArray(recipe.args) || recipe.args.some((a) => typeof a !== "string")) bad("args are not a list of strings");
  if (!recipe.env || typeof recipe.env !== "object" || Array.isArray(recipe.env)) bad("env is not a map");
  for (const [n, v] of Object.entries(recipe.env)) if (!(typeof v === "string" || (v && typeof v === "object" && typeof v.fromEnv === "string"))) bad(`env ${n} is neither a string nor a reference`);
  if (recipe.model !== null && recipe.model !== undefined && typeof recipe.model !== "string") bad("model is not text");
  if (recipe.yolo !== undefined && typeof recipe.yolo !== "boolean") bad("yolo is not a boolean");
  if (!recipe.hooks || typeof recipe.hooks !== "object") bad("no hooks record");
  return recipe;
}
/** The harness-package requirements that apply: declared for this harness
 *  and, for a conditional row, holding under the provider's (captured)
 *  settings. Nothing else is probed or restricted. */
export function applicableRequirements(harness, providers) {
  const holds = (cap, r) => !r.when || (r.when && typeof r.when === "object" && !Array.isArray(r.when) && Object.entries(r.when).every(([k, v]) => String(cap.settings?.[k] ?? "") === String(v)));
  const out = [];
  for (const cap of providers || []) for (const r of cap.manifest?.requires || []) if (r && typeof r === "object" && requirementHarness(r) === harness && holds(cap, r)) out.push({ capability: cap.id, package: r.package });
  return out;
}
function requirementsWithArgsMessage(harness, providers, config) {
  const rows = applicableRequirements(harness, providers);
  return `launch configuration ${config?.name || "(recorded)"} passes arguments (${config.args.map((a) => JSON.stringify(a)).join(", ")}) that the ${harness} package probe cannot carry, so ${rows.map((r) => `${r.capability}'s requirement ${r.package}`).join(", ")} cannot be verified for that launch; native configuration a required package must see belongs in a wrapper executable or the environment (env / fromEnv), not in args`;
}
/** ONE planner for what a start would run, used by preview and by starts of
 *  existing homes alike: the recorded recipe (or, under a selection, the
 *  current scoped configuration) resolved, preflighted, rendered. `preview`
 *  collects every failed check into `preflight` instead of throwing. A home
 *  that records no launch recipe (an earlier kernel spawned it) is not planned:
 *  E_LAUNCH_LEGACY, re-spawn it from the deployment. */
export function planLaunch({ home, instance, meta, contextDir, agentLike, selection = {}, launchConfigs, resolvedCfg, env = process.env, preview = false, assertRoots }) {
  assertRoots?.();
  const problems = [];
  const fail = (check, code, detail) => { if (!preview) throw oatsError(code, detail); problems.push({ check, ok: false, detail, code }); };
  // A recorded recipe is validated before anything is observed. A home without
  // one predates recipes: there is nothing this kernel plans from.
  if (meta && !(meta.launch && typeof meta.launch === "object")) throw oatsError("E_LAUNCH_LEGACY", `${meta.instance || home} records no launch recipe (an earlier kernel spawned it): re-spawn it from the deployment; nothing was changed`);
  const frozen = meta ? assertLaunchRecipe(meta.launch, meta.instance || home) : null;
  // The home's deployment declares the launch configurations (its oats-local.yaml,
  // found walking up from the home) — never the context directory, which may be a
  // member clone outside the deployment.
  const chosen = resolveLaunchSelection({ launchConfigs: launchConfigs || (home ? launchConfigsAt(home) : resolvedCfg?.launchConfigs) || {}, agent: agentLike, frozen, selection });
  const { config, harness, model, modelSource } = chosen;
  const yolo = resolveYolo(selection.yolo ?? chosen.configuredYolo ?? (frozen ? frozen.yolo : agentLike?.yolo ?? resolvedCfg?.yolo));
  const executable = config?.frozen
    ? { path: config.executablePath, declared: frozen.executableDeclared ?? null, resolvedFrom: frozen.executableResolvedFrom || "recorded", missing: existsSync(config.executablePath) ? undefined : `${config.executablePath} (recorded) does not exist` }
    : resolveLaunchExecutable({ harness, declared: config?.executable, declaringDir: config?.source, contextDir });
  const exeProblem = executable.path ? checkLaunchExecutable(executable.path) : executable.missing;
  if (exeProblem) fail("executable", "E_LAUNCH_EXECUTABLE", `launch configuration ${config?.name || "(harness default)"}: ${exeProblem}`); else problems.push({ check: "executable", ok: true, detail: `${executable.path} (${executable.resolvedFrom})` });
  // Capability contributions: recorded at spawn with provenance; a harness
  // switch needs the new harness's launch args from the same capabilities.
  let hooks = { launch: {}, env: {}, contributions: [], pending: true };
  if (frozen) {
    // Recorded contributions, refreshed by capabilities that declare a
    // launch hook; a harness change needs the new harness's arguments from
    // every capability that gave harness-specific ones; recorded arguments
    // of a capability the scope no longer trusts are not reused.
    try {
      hooks = prepareLaunchHooks({ frozen, harness, resolvedCfg, home, meta, contextDir, assertRoots });
      const current = new Map((resolvedCfg?.capabilities || []).map((c) => [c.id, c]));
      const untrusted = hooks.contributions.filter((c) => c.capability && current.has(c.capability) && !current.get(c.capability).trust?.trusted).map((c) => c.capability);
      const inactive = hooks.contributions.filter((c) => c.capability && !current.has(c.capability)).map((c) => c.capability);
      if (untrusted.length) fail("capabilities", "E_LAUNCH_PREPARATION", `${untrusted.join(", ")} contributed to this launch at spawn but is no longer trusted in the scope; respawn the instance; nothing was stopped`);
      else problems.push({ check: "capabilities", ok: true, detail: `${harness !== frozen.harness ? "prepared for the new harness" : "recorded contributions reused"}${hooks.refreshed?.length ? `; refreshed by launch hooks: ${hooks.refreshed.join(", ")}` : ""}${inactive.length ? `; no longer active in the scope, recorded contribution kept: ${inactive.join(", ")}` : ""}` });
    } catch (e) {
      if (e.code !== "E_LAUNCH_PREPARATION") throw e;
      fail("capabilities", e.code, e.message);
      hooks = { launch: { ...(frozen.hooks?.launch || {}) }, env: { ...(frozen.hooks?.env || {}) }, contributions: frozen.hooks?.contributions || [] };
    }
  } else problems.push({ check: "capabilities", ok: true, detail: "decided by the capabilities' spawn hooks" });
  // A configuration may not override environment a capability owns.
  const configEnv = config?.env || {};
  const owned = Object.keys(configEnv).filter((n) => Object.hasOwn(hooks.env, n));
  if (owned.length) {
    const owner = (n) => hooks.contributions.find((c) => (c.env || []).includes(n))?.capability || "a capability";
    fail("environment", "E_LAUNCH_ENV_CONFLICT", `${owned.map((n) => `${n} (set by ${owner(n)})`).join(", ")} cannot be overridden by launch configuration ${config?.name}; change the capability's setting instead`);
  }
  const missing = missingLaunchEnvRefs(configEnv, env);
  if (missing.length) fail("environment", "E_LAUNCH_ENV_MISSING", `launch configuration ${config?.name} references ${missing.join(", ")}, not set on this host; nothing was stopped or started`);
  else if (!owned.length) problems.push({ check: "environment", ok: true, detail: `${Object.keys(configEnv).length} value(s), references resolved on the execution host at start` });
  problems.push({ check: "model", ok: true, detail: model ? `${model} (${modelSource})` : `native default (${modelSource})` });
  // Harness package requirements: the captured providers' (bindings united
  // with contributions, by id, current manifest, captured settings for
  // conditional rows) for an existing home, the scope's for a new instance;
  // probed under the launch's EFFECTIVE environment with the selected
  // executable, only when some requirement is declared for this harness and
  // every reference resolved. Configuration arguments cannot be applied to a
  // package probe (it must never start a conversation), which is stated.
  if (executable.path && !missing.length && !owned.length) {
    const providers = frozen
      ? capturedProviders(meta, frozen).map((p) => { const dir = launchManifestDir(home, meta); const manifest = dir ? capabilityManifest(p.id, dir) : undefined; return manifest ? { id: p.id, manifest, settings: p.settings } : null; }).filter(Boolean)
      : (resolvedCfg?.capabilities || []);
    const declared = applicableRequirements(harness, providers).length > 0;
    if (declared && (config?.args || []).length) {
      // The controlled probe cannot carry configuration arguments, so with
      // an applicable requirement a launch under such arguments cannot be
      // reported verified: refused, truthfully, with the way out.
      fail("harness-packages", "E_LAUNCH_PROBE_UNSUPPORTED", requirementsWithArgsMessage(harness, providers, config));
    } else if (declared) {
      try {
        verifyHarnessPackages(harness, { capabilities: providers }, contextDir, { ...(config?.executable || config?.frozen ? { bin: executable.path } : {}), env: launchEffectiveEnv({ base: env, hooksEnv: hooks.env, configEnv }) });
        problems.push({ check: "harness-packages", ok: true, detail: `verified with ${executable.path}${(config?.args || []).length ? "; configuration arguments are not applied to the probe: native configuration the packages must see belongs in a wrapper or the environment" : ""}` });
      } catch (e) { fail("harness-packages", "E_HARNESS_PACKAGE", e.message); }
    } else problems.push({ check: "harness-packages", ok: true, detail: "no harness package requirement declared for this harness; nothing probed" });
  }
  const recipe = {
    version: LAUNCH_RECIPE_VERSION, harness, launchConfig: config?.name || null, launchConfigSource: config?.source || null,
    executable: executable.path || executable.declared || harness, executableDeclared: executable.declared ?? null, executableResolvedFrom: executable.resolvedFrom,
    args: [...(config?.args || [])], env: { ...configEnv }, model: model || null, ...(yolo !== undefined ? { yolo } : {}),
    hooks: frozen ? { launch: hooks.launch, env: hooks.env, contributions: hooks.contributions } : hooks, prompt: LAUNCH_PROMPT,
    ...(frozen?.legacy ? { legacy: { ...frozen.legacy, ...(hooks.refreshed?.length ? { replacedBy: hooks.refreshed } : {}) } } : {}),
  };
  const inst = instance || meta?.instance || basename(home);
  const command = renderLaunchRecipe(recipe, { home, instance: inst });
  const selectionSource = frozen ? (config?.frozen || (!config && !selection.launchConfig && !selection.harness) ? "frozen" : "config") : "config";
  return { recipe, command, harness, model: model || undefined, modelSource, yolo, config, executable, preflight: problems, ok: problems.every((c) => c.ok), selectionSource, frozen, ...(hooks.meta ? { hookMeta: hooks.meta } : {}) };
}
/** The environment a planned launch runs under: the host's base, the
 *  capabilities' validated env, the configuration's literals and its
 *  references resolved from the BASE (never from the prefix beside them).
 *  Package probes run under exactly this, so a CLAUDE_CONFIG_DIR or a
 *  credential reference selects the same account the launch will. */
export function launchEffectiveEnv({ base = process.env, hooksEnv = {}, configEnv = {} } = {}) {
  const out = { ...base, ...hooksEnv };
  for (const [name, v] of Object.entries(configEnv || {})) {
    if (typeof v === "string") out[name] = v;
    else if (v && typeof v === "object" && v.fromEnv && base[v.fromEnv] !== undefined) out[name] = base[v.fromEnv];
  }
  return out;
}
/** argv (after the executable) and environment names of a rendered command,
 *  from the parser: what a GUI shows, never the TASK body. */
export function describeLaunchCommand(command) {
  const { tokens, binary } = parseLaunchCommand(command);
  const environment = tokens.slice(0, binary).map((t) => t.kind === "envref" ? { name: t.name, reference: true, ...(t.source.startsWith(LAUNCH_REF_PREFIX) ? {} : { fromEnv: t.source }) } : { name: t.name, redacted: true });
  const argv = tokens.slice(binary + 1).map((t) => t.kind === "sep" ? "--" : t.kind === "prompt" ? t.text : t.value);
  return { executable: tokens[binary].value, argv, environment };
}
/** A persisted command with every environment value withheld (references
 *  stay references); a command the parser refuses is withheld whole. */
/** The identity environment every launch carries: public facts (instance
 *  name, home path), shown in public renderings; everything else is withheld. */
export const IDENTITY_LAUNCH_ENV = new Set(["OATS_INSTANCE", "OATS_INSTANCE_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME"]);
export function redactLaunchCommand(command) {
  try { return parseLaunchCommand(command).tokens.map((t) => t.kind === "env" && !IDENTITY_LAUNCH_ENV.has(t.name) ? `${t.name}='<redacted>'` : t.text).join(" "); }
  catch { return "<unparseable launch command withheld>"; }
}
/** The recipe with every environment value withheld. */
export function redactLaunchRecipe(recipe) {
  const env = Object.fromEntries(Object.keys(recipe.env || {}).sort().map((n) => [n, typeof recipe.env[n] === "string" ? { redacted: true } : { fromEnv: recipe.env[n].fromEnv }]));
  const hooks = recipe.hooks ? { ...recipe.hooks, env: Object.fromEntries(Object.keys(recipe.hooks.env || {}).sort().map((n) => [n, { redacted: true }])) } : undefined;
  return { ...recipe, env, ...(hooks ? { hooks } : {}) };
}
/** Spawn. With `o.prepared` (workspace model: a resolution prepared by
 *  instance-resolution.mjs) this is ASYNC — capabilities are fetched and copied
 *  into the home. Without it (classic soul-directory spawn: schedules, tests,
 *  bare agents roots) it stays synchronous and returns the result directly. */
/** A spawn needs a workspace deployment (lead decision c3-1): the prepared
 *  resolution is async (discovery over remotes, materialize), so the one entry
 *  point is spawnInstanceAsync with `o.prepared`. This synchronous name remains
 *  only to refuse, typed, for callers of the 0.25 kernel API. */
export function spawnInstance(root, agent, o = {}) {
  if (o.prepared) throw new Error("spawnInstance: a prepared (workspace) spawn is async — call spawnInstanceAsync");
  throw localMissingForSpawn(agent);
}
function localMissingForSpawn(agent) {
  return oatsError("E_LOCAL_MISSING", `spawning ${agent?.name ?? "an instance"} needs a workspace deployment (oats-local.yaml, found walking up from the deployment): a soul's capabilities are the workspace's resolution, prepared before the spawn — \`oats onboard\` creates the deployment`);
}
export async function spawnInstanceAsync(root, agent, o = {}) {
  const it = spawnBody(root, agent, o);
  let step = it.next();
  while (!step.done) {
    // The single yield hands back a promise-producing thunk; await it and feed the
    // result (or throw the failure) back into the body.
    try { const value = await step.value(); step = it.next(value); }
    catch (e) { step = it.throw(e); }
  }
  return step.value;
}
function* spawnBody(root, agent, o = {}) {
  if (!o.prepared) throw localMissingForSpawn(agent);
  const deliver = (r) => r;
  const work = o.work || agent.work || "checkout";
  if (!WORK_MODES.includes(work)) throw new Error(`unknown work mode "${work}" (${WORK_MODES.join("|")})`);
  if (work === "directory" && (o.workDir !== undefined || o.branch !== undefined)) {
    throw oatsError("E_BAD_ARGS", "directory mode owns only <home>/work; workDir/--work-dir and branch/--branch are not allowed");
  }
  if (work === "attached" && !o.workDir) throw new Error(`attached mode needs workDir — the owning instance's work tree (its <home>/work)`);
  if (o.task !== undefined && typeof o.task !== "string") throw new Error(`task must be a string (got ${typeof o.task}) — a flag parser handing --task's next flag through shows up here`);
  if (o.launchConfig !== undefined && (typeof o.launchConfig !== "string" || !o.launchConfig.trim())) throw oatsError("E_BAD_ARGS", "launchConfig must be a configuration name or none");
  const session = o.tmuxSession || DEFAULT_TMUX_SESSION;
  const backend = o.backend || "tmux";
  if (!["tmux", "herdr"].includes(backend)) throw new Error(`unknown session backend "${backend}" (tmux|herdr)`);
  if (o.herdrSocket !== undefined && (typeof o.herdrSocket !== "string" || !o.herdrSocket)) throw oatsError("E_BAD_ARGS", "herdrSocket must be a socket path");
  const launch = o.launch !== false;
  // Workspace model (`o.prepared`) + work: workspace: ./work is the deployment
  // boundary — the directory holding oats-local.yaml (`prepared.deployment`), which
  // is a plain directory with member clones beside it, not a Git checkout. It is
  // the execution/config context too; no Git identity is required or recorded.
  const preparedDeployment = work === "workspace" && typeof o.prepared.deployment === "string" && o.prepared.deployment ? resolve(o.prepared.deployment) : undefined;
  if (preparedDeployment !== undefined && !(existsSync(preparedDeployment) && statSync(preparedDeployment).isDirectory())) throw oatsError("E_BAD_ARGS", `workspace mode: the deployment directory ${preparedDeployment} (where oats-local.yaml lives) is not a directory`);
  // A soul declares no repository (lead decision c3 Q6): the caller passes one, and an
  // attached instance works in its owner's repository — the one the work tree's
  // owning instance recorded.
  const repoTarget = o.repo !== undefined ? o.repo : work === "attached" ? attachedOwnerRepo(o.workDir) : undefined;
  const repoAbs = preparedDeployment ?? resolveExecutionContext(root, repoTarget, work);
  if (!repoAbs) throw oatsError("E_BAD_ARGS", `${agent.name}: no repository for a ${work} instance — pass --repo${work === "attached" ? " (the work tree's owner records none)" : ""}`);
  // Launch selection: a named configuration (explicit, or the soul's
  // launch-config default), or none; the harness and model follow from it.
  // K6b: a preview's native probes (model catalogue, harness packages) share
  // ONE budget from here to the return; each probe is group-killed on timeout.
  const preflightStarted = Date.now(), preflightBudgetMs = o.preview === true ? (Number(process.env.OATS_PREVIEW_PREFLIGHT_BUDGET_MS) || 20000) : undefined;
  let preflight = { status: "complete", budgetMs: preflightBudgetMs ?? null };
  if (o.preview === true) previewPreflightBudget = { deadline: preflightStarted + preflightBudgetMs };
  let launchSelection;
  try { launchSelection = resolveLaunchSelection({ launchConfigs: launchConfigsAt(root), agent, selection: { launchConfig: o.launchConfig, harness: o.harness, model: o.model } }); }
  catch (e) { previewPreflightBudget = null; throw e; }
  const launchConfig = launchSelection.config;
  const harness = launchSelection.harness;
  const model = launchSelection.model;
  // Instance homes belong in the soul-owning repo's PRIMARY checkout, never in a
  // linked worktree (see canonicalDeploymentPath). The CLI resolves this through
  // ensureRoot, but the kernel is its own validation boundary — the desktop
  // server, the pi adapter and tests call spawnInstance directly — and the check
  // must run in the RAW caller shape, before mkdir or any lifecycle hook.
  //
  // BOTH paths are checked, because the home is `agent._dir/instances/<name>`,
  // NOT `root/...`: a caller can pass a canonical root together with an agent
  // resolved from the linked root (findAgent(linkedRoot, name)) and the home
  // would still land in the worktree with a root-only check (reviewer-2366d09).
  // A capability-defined agent's dir (<root>/<name>/, instances/ only) is
  // agent._dir too, so agent._dir is the authority in every case.
  for (const [label, path] of [["agents root", root], [`agent directory for "${agent.name}"`, agent._dir]]) {
    if (!path) continue;
    const canonical = canonicalDeploymentPath(path);
    if (resolve(canonical) !== resolve(path)) {
      throw oatsError("E_NO_CANONICAL_ROOT", `${label} ${resolve(path)} is inside a linked Git worktree — instance homes must be created in the primary checkout (${canonical}), where they survive the worktree and are visible to the deployment`);
    }
  }

  if (o.name !== undefined && (o.purpose !== undefined || o.instance !== undefined)) throw oatsError("E_BAD_ARGS", "name and purpose are mutually exclusive: --name is the exact instance name, --purpose derives <soul>-<purpose>");
  let instance;
  if (o.name !== undefined) instance = explicitInstanceName(o.name);
  else {
    instance = o.instance || nextInstanceName(root, agent, o.purpose, o.prepared);
    if (!instance.startsWith(agent.name)) instance = `${agent.name}-${slug(instance)}`;
    instance = slug(instance);
    if (instance.length > MAX_INSTANCE_NAME) throw nameTooLong(instance, "pass a shorter instance name");
  }

  // K6e: key recovery FIRST — before any placement, branch, base, preflight or
  // backend work — so a retry of a spawn that already created its explicit
  // branch (or whose base moved) still reaches its own receipt.
  if (o.idempotencyKey !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(o.idempotencyKey))) throw oatsError("E_BAD_ARGS", "--idempotency-key must be 1-128 chars of [A-Za-z0-9._:-]");
  if (o.expectDecision !== undefined && o.idempotencyKey !== undefined) {
    const instancesDir = join(agent._dir, "instances");
    const prior = (existsSync(instancesDir) ? readdirSync(instancesDir) : []).filter((n) => !n.startsWith("."))
      .map((n) => { try { return JSON.parse(readFileSync(join(instancesDir, n, "instance.json"), "utf8")); } catch { return null; } })
      .find((m) => m && m.spawnIdempotencyKey === o.idempotencyKey);
    if (prior) {
      if (prior.decision?.revision !== o.expectDecision) throw Object.assign(oatsError("E_IDEMPOTENCY_CONFLICT", `idempotency key ${o.idempotencyKey} was used for a different decision (${prior.decision?.revision ?? "unrecorded"}); a key binds one confirmed decision`), { instance: prior.instance, home: prior.home });
      // Completion custody: the home exists from the first metadata write, but
      // the launch/lineage/events that make it a finished spawn may not have
      // happened (crash in the interval). Say which, never replay a half-spawn.
      if (prior.spawnCompleted !== true) throw Object.assign(oatsError("E_SPAWN_INCOMPLETE", `${prior.instance} was created for this key but its spawn did not complete (launch or lineage unfinished); inspect it with oats session inspect --home ${prior.home} — do not spawn again`), { instance: prior.instance, home: prior.home, launched: prior.launched === true ? "unknown" : false });
      return { ...prior, replayed: true, launch: undefined, command: undefined, wake: prior.wake ?? { requested: null, saved: null, error: null } };
    }
  }

  // An explicit name may not be a soul name (soul and instance references stay
  // unambiguous) and is taken when any soul of this deployment holds it, or — on
  // the tmux backend, launched or not — a live window of the session carries it:
  // a typed refusal, never a silent `-2` (the operator typed it). Checked after
  // key recovery, so a retried keyed spawn still reaches its own receipt; the
  // placement below re-checks after its reservation (a concurrent spawn of
  // another soul under the same name).
  if (o.name !== undefined) {
    if (deploymentSoulNames(root, o.prepared).has(instance)) throw oatsError("E_INSTANCE_NAME_INVALID", `instance name "${instance}" is a soul name in this deployment; an instance may not share a soul's name`);
    const holder = deploymentInstanceHomes(root).get(instance)?.[0];
    if (holder) throw Object.assign(oatsError("E_INSTANCE_NAME_TAKEN", `instance name "${instance}" is taken in this deployment (${holder}); instance names are unique across every soul — pick another --name`), { instance, home: holder });
    if (backend === "tmux" && tmuxWindows(session).includes(instance)) throw Object.assign(oatsError("E_INSTANCE_NAME_TAKEN", `instance name "${instance}" is taken: a live tmux window of that name exists in session ${session} — pick another --name`), { instance, session });
  }

  // Forward-only lineage: EXPLICIT only. Relations (child|sibling|parent|unrelated)
  // anchor the new instance to an EXISTING instance (o.relativeTo). o.parent
  // (CLI --parent) is sugar for relation=child. Parsed and resolved BEFORE any
  // scaffolding or lifecycle hooks so an invalid relation or missing anchor
  // never leaves a half-created home behind. ATTACHED mode is special by design
  // decision: an attached agent shares its owner's work tree and is ALWAYS the
  // owner's child — relation flags that say anything else are contradictory and
  // rejected. Ambient env
  // (OATS_INSTANCE/PI_AGENT_INSTANCE) is deliberately NOT consulted: any shell
  // opened inside an agent's tmux window inherits those vars, and env inheritance
  // is not evidence of intent — human spawns from such shells were misattributed
  // as instance-origin. Manual spawns land top-level unless a relation is
  // explicitly given (operator directive).
  const legacyParent = typeof o.parent === "string" && o.parent.trim() ? o.parent.trim() : undefined;
  let relation = typeof o.relation === "string" && o.relation.trim() ? o.relation.trim() : undefined;
  let relativeTo = typeof o.relativeTo === "string" && o.relativeTo.trim() ? o.relativeTo.trim() : undefined;
  // Validate the RAW combination BEFORE normalization — the kernel is its own
  // validation boundary (programmatic callers bypass the CLI's checks), and
  // silently normalizing contradictory options into a different spawn shape
  // (e.g. dropping a dangling relativeTo → top-level) hides caller bugs.
  if (relation && !RELATIONS.includes(relation)) throw new Error(`unknown relation "${relation}" (child|sibling|parent|unrelated)`);
  if (legacyParent && (relation || relativeTo)) throw new Error(`parent is sugar for relativeTo + relation "child" — pass one form, not both`);
  if (relativeTo && !relation) throw new Error(`relativeTo "${relativeTo}" needs a relation (child|sibling|parent)`);
  if (relation === "unrelated" && relativeTo) throw new Error(`relation "unrelated" takes no relativeTo`);
  if (relation && relation !== "unrelated" && !relativeTo) throw new Error(`relation "${relation}" needs a relative-to instance`);
  if (typeof o.relativeRoot === "string" && o.relativeRoot.trim() && !relativeTo && !legacyParent) throw new Error(`relativeRoot only qualifies relativeTo/parent`);
  if (!relation && legacyParent) { relation = "child"; relativeTo = legacyParent; }
  if (relation === "unrelated") { relation = undefined; relativeTo = undefined; }

  // Attached = child of the work-tree owner, always (design decision). The
  // owner is CANONICALLY resolved BY PATH: every instance home in the
  // deployment (local root + team scope) is enumerated and matched on
  // realpath(<home>/work) === realpath(workDir) — never by name, since
  // instance names are only unique per agent dir and a same-named local
  // instance must not shadow the tree's true owner. For trees that are no
  // instance's home/work (e.g. a coordinator's integration worktree), the
  // spawner must name the owner explicitly with a child relation — nothing
  // else can attach there.
  let attachedOwner;
  if (work === "attached" && o.workDir) {
    const wd = resolve(o.workDir);
    let wdReal; try { wdReal = realpathSync(wd); } catch { wdReal = undefined; }
    let ownerName;
    if (wdReal) {
      // Every agent dir under the root: souls and capability-defined agents alike.
      const scanInstances = (agentsRoot, cb) => {
        if (!existsSync(agentsRoot)) return;
        for (const ag of readdirSync(agentsRoot, { withFileTypes: true })) {
          if (!ag.isDirectory() || ag.name.startsWith(".")) continue;
          const dir = join(agentsRoot, ag.name, "instances");
          if (!existsSync(dir)) continue;
          for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) cb(join(dir, e.name), e.name);
        }
      };
      const ownerRoots = new Set();
      try { ownerRoots.add(realpathSync(root)); } catch { ownerRoots.add(root); }
      const hits = [];
      // Lexical form of workDir with the HOME part canonicalized — checkout-mode
      // instances have work as a symlink to the shared repo, so realpath alone
      // would collide across every checkout instance; symlinked work trees only
      // match when workDir IS that home's work path.
      let wdLexical; try { wdLexical = join(realpathSync(dirname(wd)), basename(wd)); } catch { wdLexical = wd; }
      for (const r2 of ownerRoots) scanInstances(r2, (instHome, instName) => {
        const wp = join(instHome, "work");
        try {
          let homeReal; try { homeReal = realpathSync(instHome); } catch { return; }
          if (join(homeReal, "work") === wdLexical) { hits.push({ home: instHome, name: instName }); return; }
          if (!lstatSync(wp).isSymbolicLink() && realpathSync(wp) === wdReal) hits.push({ home: instHome, name: instName });
        } catch { /* no work tree */ }
      });
      if (hits.length) {
        ownerName = hits[0].name;
        // The owner must be representable unambiguously from the CHILD's root:
        // the recorded name, resolved like every other lineage edge, must land
        // back on the matched home.
        const check = findInstanceHome(root, ownerName);
        let resolvesBack = false;
        try { resolvesBack = !!check && realpathSync(check.home) === realpathSync(hits[0].home); } catch { /* not resolvable */ }
        if (!resolvesBack) throw new Error(`attached workDir ${wd} belongs to instance "${ownerName}" (${hits[0].home}), but that name resolves to a different instance from this deployment root — the parent link would be ambiguous; retire/rename the shadowing instance or attach to a tree owned here`);
      }
    }
    if (ownerName) {
      attachedOwner = ownerName;
      if (relation && !(relation === "child" && relativeTo === attachedOwner)) {
        throw new Error(`attached agents are always children of the work-tree owner (${attachedOwner}) — drop the relation flags or use --work worktree for a different relation`);
      }
    } else {
      // Path matches NO known instance's work tree: require an explicit,
      // validated child link so the "attached = child" invariant still holds.
      if (!relation) throw new Error(`attached workDir ${wd} is not a known instance's <home>/work — name the owning instance explicitly (--parent <instance>)`);
      if (relation !== "child") throw new Error(`attached agents are always children — only --parent <instance> (child) is valid for a non-instance work tree`);
      attachedOwner = relativeTo;
    }
    if (o.relation === "unrelated") throw new Error(`attached agents are always children of the work-tree owner — "unrelated" contradicts attached mode`);
  }

  // Resolve the anchor's home so sibling and parent relations can read/re-point
  // the anchor's recorded lineage. Bare names are only unique per agent dir, so
  // resolution must be AMBIGUITY-SAFE (same posture as attached ownership):
  //  - enumerate ALL matches under the deployment's agents root;
  //  - multiple matches need o.relativeRoot (CLI --relative-root) to pick one;
  //  - the recorded edge must ROUND-TRIP: the anchor's bare name, resolved from
  //    the NEW instance's root (local-first, like every lineage consumer),
  //    must land on the chosen home — else a same-named shadow would corrupt
  //    lineage. For relation=parent the reverse edge (anchor → new instance,
  //    by the new instance's bare name from the ANCHOR's root) must round-trip
  //    too, since the anchor's instance.json is re-pointed.
  let anchorHome;
  let anchorRoot;
  if (relativeTo) {
    const hits = [];
    for (const h of findInstanceHomes(root, relativeTo)) hits.push({ root, home: h.home });
    if (relation && !hits.length) throw new Error(`relation "${relation}": instance "${relativeTo}" was not found in this deployment`);
    let chosen = hits[0];
    if (hits.length > 1) {
      const wanted = typeof o.relativeRoot === "string" && o.relativeRoot.trim() ? resolve(o.relativeRoot.trim()) : undefined;
      const inRoot = wanted ? hits.filter((h) => resolve(h.root) === wanted) : [];
      // Two agents under ONE root can own the same name (generated-name
      // collisions); --relative-root cannot split those — inherently ambiguous.
      if (inRoot.length > 1) throw Object.assign(
        new Error(`relative-to "${relativeTo}" matches multiple instances under ${o.relativeRoot} (${inRoot.map((h) => h.home).join(", ")}) — inherently ambiguous; retire/rename one`),
        { code: "E_RELATIVE_AMBIGUOUS" });
      chosen = inRoot[0];
      if (!chosen) throw Object.assign(
        new Error(`relative-to "${relativeTo}" is ambiguous — it matches multiple instances (${hits.map((h) => h.home).join(", ")}); pass --relative-root <agents-root> to pick one`),
        { code: "E_RELATIVE_AMBIGUOUS" });
    } else if (chosen && typeof o.relativeRoot === "string" && o.relativeRoot.trim() && resolve(o.relativeRoot.trim()) !== resolve(chosen.root)) {
      throw Object.assign(new Error(`relative-to "${relativeTo}" does not home under --relative-root ${o.relativeRoot} (found at ${chosen.home})`), { code: "E_RELATIVE_AMBIGUOUS" });
    }
    if (chosen) {
      // Round-trip: the bare name recorded on the edge must resolve back to the
      // chosen home from the NEW instance's root, or the edge is a lie.
      const back = findInstanceHome(root, relativeTo);
      let ok = false;
      try { ok = !!back && realpathSync(back.home) === realpathSync(chosen.home); } catch { ok = false; }
      if (!ok) throw Object.assign(
        new Error(`relative-to "${relativeTo}" at ${chosen.home} is shadowed by a same-named instance closer to this deployment root — the lineage edge would resolve to the wrong instance; retire/rename the shadowing instance`),
        { code: "E_RELATIVE_AMBIGUOUS" });
      anchorHome = chosen.home;
      anchorRoot = chosen.root;
      // relation=parent re-points the ANCHOR at the NEW instance by bare name:
      // that reverse edge must round-trip from the ANCHOR's root as well.
      if (relation === "parent") {
        const rev = findInstanceHome(chosen.root, instance);
        // The new instance does not exist yet — a hit here IS a shadow.
        if (rev) throw Object.assign(
          new Error(`relation "parent": an existing instance named "${instance}" (${rev.home}) would shadow the new instance from the anchor's root — the re-pointed edge would resolve to the wrong instance; pick a different --purpose or --name`),
          { code: "E_RELATIVE_AMBIGUOUS" });
      }
    }
  }
  const anchorMetaPath = anchorHome ? join(anchorHome, "instance.json") : undefined;
  const anchorMeta = anchorMetaPath && existsSync(anchorMetaPath) ? JSON.parse(readFileSync(anchorMetaPath, "utf8")) : undefined;
  if ((relation === "sibling" || relation === "parent") && !anchorMeta) {
    throw new Error(`relation "${relation}" needs the anchor's recorded lineage, but instance "${relativeTo}" has no instance.json`);
  }

  let parentInstance;
  let siblingInstance;
  if (relation === "child") {
    parentInstance = relativeTo;
  } else if (relation === "sibling") {
    // Peer at the same level: share the anchor's parent. When the anchor is a
    // root (no parent), record an explicit sibling link so the two still form
    // one cluster (derivable from status --json via parentInstance+siblingInstance edges).
    if (anchorMeta?.parentInstance) parentInstance = anchorMeta.parentInstance;
    else siblingInstance = relativeTo;
  } else if (relation === "parent") {
    // The NEW instance becomes the anchor's parent: it inherits the anchor's old
    // slot in the tree (old parent, if any), and the anchor is re-pointed below.
    parentInstance = anchorMeta?.parentInstance;
    if (anchorMeta?.siblingInstance) siblingInstance = anchorMeta.siblingInstance;
  }
  if (!relation && attachedOwner && attachedOwner !== instance) parentInstance = attachedOwner;
  // K5 §4 — child-spawn permission is ENFORCED here, by the spawn route. The
  // parent's recorded policy (instance.json policy.childSpawns) says whether
  // it may have children; off refuses, attributed to that policy and its
  // origin. Absent policy = allowed (today's behaviour), reported as such.
  // A lifecycle-authority claim, not an OS sandbox.
  const childPolicyOf = (metaOf) => metaOf?.policy?.childSpawns && typeof metaOf.policy.childSpawns === "object"
    ? metaOf.policy.childSpawns : { allowed: true, origin: { kind: "default", detail: "no recorded policy: children allowed" } };
  if (parentInstance && parentInstance !== instance) {
    const parentHome = parentInstance === relativeTo && anchorHome ? anchorHome
      : findInstanceHome(root, parentInstance)?.home;
    const parentMeta = parentHome && existsSync(join(parentHome, "instance.json")) ? JSON.parse(readFileSync(join(parentHome, "instance.json"), "utf8")) : anchorMeta;
    const policy = childPolicyOf(parentMeta);
    if (policy.allowed === false) {
      // A preview touches nothing — not even the parent's event log; the
      // typed refusal IS the preview's answer.
      if (parentHome && o.preview !== true) appendEvent(parentHome, { kind: "child-spawn-refused", data: { child: instance, agent: agent.name, policy } });
      throw Object.assign(oatsError("E_CHILD_SPAWNS_DISABLED", `${parentInstance} does not allow child spawns (policy origin: ${policy.origin?.kind ?? "recorded"}${policy.origin?.detail ? ` — ${policy.origin.detail}` : ""}); nothing was spawned. Spawn without a parent relation, or respawn the parent with --allow-child-spawns.`),
        { parent: parentInstance, policy });
    }
  }
  // This instance's own policy: a spawn option (a soul declares none — lead
  // decision c3 Q6), recorded so the route above and the readiness view can read it.
  const ownChildPolicy = o.allowChildSpawns !== undefined
    ? { allowed: o.allowChildSpawns === true, origin: { kind: "spawn-option", detail: o.allowChildSpawns ? "--allow-child-spawns" : "--no-child-spawns" } }
    : { allowed: true, origin: { kind: "default", detail: "no spawn option: children allowed" } };

  // Inherited edges must round-trip too. Sibling and parent relations copy
  // names from the ANCHOR's instance.json (anchorMeta.parentInstance /
  // .siblingInstance) — names the ANCHOR resolved from ITS root. The NEW
  // instance's root may resolve the same bare name to a different (same-named)
  // instance, silently mislinking. Before scaffolding: resolve each final
  // inherited name from the anchor's root AND from the new root; both must
  // canonicalize to the same home.
  if (relation === "sibling" || relation === "parent") {
    for (const inherited of [parentInstance, siblingInstance]) {
      if (!inherited || inherited === relativeTo || inherited === instance) continue;
      const fromAnchor = findInstanceHome(anchorRoot, inherited);
      const fromNew = findInstanceHome(root, inherited);
      let same = false;
      try { same = !!fromAnchor && !!fromNew && realpathSync(fromAnchor.home) === realpathSync(fromNew.home); } catch { same = false; }
      // A vanished referent (no hit from the anchor root) is a dangling edge —
      // inheriting it is harmless only if the new root ALSO cannot resolve it.
      if (!fromAnchor && !fromNew) continue;
      if (!same) throw Object.assign(
        new Error(`relation "${relation}": inherited lineage "${inherited}" resolves to ${fromAnchor?.home || "nothing"} from the anchor's root but ${fromNew?.home || "nothing"} from this deployment root — the inherited edge would mislink; disambiguate or retire/rename the shadowing instance`),
        { code: "E_RELATIVE_AMBIGUOUS" });
    }
  }

  const home = join(agent._dir, "instances", instance);
  if (existsSync(home)) throw new Error(`instance already exists: ${home}`);
  // AUTHORITATIVE placement check, on the DESTINATION rather than on lexical
  // paths, immediately before the first side effect. The earlier root/agent-dir
  // checks are lexical and can be walked around by a symlink anywhere along the
  // way — `agents/alias -> <linked-worktree>/agents/dev`, or a pre-existing
  // `agent._dir/instances` symlink — which classifies as the primary checkout
  // while the home is really created in the worktree (reviewer-249aa7b).
  // Resolving through the nearest existing ancestor is what closes that.
  const homeReal = realPathOrNearest(home);
  const homeCanonical = canonicalDeploymentPath(homeReal);
  if (resolve(homeCanonical) !== resolve(homeReal)) {
    throw oatsError("E_NO_CANONICAL_ROOT", `instance home ${home} resolves to ${homeReal}, inside a linked Git worktree — homes must be created in the primary checkout (${homeCanonical}); a symlink on the path to the agent directory or its instances/ dir does not change where the home really lands`);
  }
  // CONTAINMENT, which the check above does not give. canonicalDeploymentPath
  // only redirects paths inside a LINKED WORKTREE; an escape to a directory Git
  // does not own at all comes back unchanged and passed (reviewer-aggregate2 —
  // reproduced: a pre-existing `instances/` symlink to a sibling temp dir spawned
  // successfully, reporting a home under the deployment while the real one, with
  // the capability credentials a hook writes into it, was created outside).
  // The home must BE the immediate `instances/` child of the resolved agent
  // directory, and that directory must live in this deployment.
  const withinDir = (child, parent) => {
    const rel = relative(parent, child);
    return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
  };
  const agentDirReal = realPathOrNearest(agent._dir);
  // The only base is the agents root: souls and capability-defined agents alike
  // live directly under it (the 0.25 local-agents/ bases are gone). The root itself
  // may legitimately be a symlink (it is the deployment anchor, and OATS is pointed
  // AT it); the agent dirs OATS derives from it may not lead somewhere else.
  const allowedBases = [realPathOrNearest(root)];
  if (!allowedBases.some((b) => withinDir(agentDirReal, b))) {
    throw oatsError("E_NO_CANONICAL_ROOT", `agent directory for "${agent.name}" resolves to ${agentDirReal}, which is outside this deployment (${allowedBases.join(", ")}) — a symlinked agent directory would place the home, and any capability credentials written into it, outside the deployment entirely`);
  }
  const expectedHome = join(agentDirReal, "instances", instance);
  if (resolve(homeReal) !== resolve(expectedHome)) {
    throw oatsError("E_NO_CANONICAL_ROOT", `instance home ${home} resolves to ${homeReal}, not to ${expectedHome} — a symlinked instances/ directory does not change where the home really lands, and OATS will not create an instance (or the capability credentials that go in it) outside the agent's own directory`);
  }
  // Compose and PREFLIGHT before the home exists. Composition is pure (it only
  // reads the soul, config chain and capability content), so resolving it here
  // lets every "declared but missing" failure happen with zero side effects to
  // roll back — no home, no worktree, no identity, no tmux window.
  // Capability-defined agents carry _soulDir (read-only soul inside the package).
  const soulDir = agent._soulDir || soulOf(agent._dir);
  const composition = composeInstanceAgentsMd(soulDir, repoAbs, agent.name, work, agent.kind, o.prepared);
  const resolvedCfg = composition.resolved;
  const yolo = resolveYolo(o.yolo ?? launchSelection.configuredYolo);
  const expectedResources = planInstanceResources({ resolved: resolvedCfg, soulDir, agent, contextDir: repoAbs, composition, prepared: o.prepared });
  // Harness extensions selected by ACTIVE capabilities for THIS instance's
  // harness. Strict launch disables ambient extension discovery, so each one has
  // to be named by path — and a required harness package that is not installed
  // must fail here, loudly, rather than produce an instance that silently lost
  // its channel. `--harness` can override a soul default long after install-time
  // reconciliation, so this spawn-time check is the authoritative one.

  // Prerequisites must fail before creating a home, worktree, or identity.
  const executable = resolveLaunchExecutable({ harness, declared: launchConfig?.executable, declaringDir: launchConfig?.source, contextDir: repoAbs });
  if (!executable.path) throw new Error(executable.missing);
  { const bad = checkLaunchExecutable(executable.path); if (bad) throw oatsError("E_LAUNCH_EXECUTABLE", `launch configuration ${launchConfig?.name || "(harness default)"}: ${bad}`); }
  const bin = executable.path;
  const missingRefs = missingLaunchEnvRefs(launchConfig?.env || {}, process.env);
  if (missingRefs.length) throw oatsError("E_LAUNCH_ENV_MISSING", `launch configuration ${launchConfig.name} references ${missingRefs.join(", ")}, not set in this environment; nothing was created`);
  // A configuration's executable answers the package probe (without one the
  // context-selected name does, as before: its remedies name that command),
  // under the configuration's environment (literals, references resolved
  // from the base); the capabilities' own env is not known before their
  // spawn hooks run, which happens after the home exists.
  if ((launchConfig?.args || []).length && applicableRequirements(harness, resolvedCfg.capabilities).length) throw oatsError("E_LAUNCH_PROBE_UNSUPPORTED", `${requirementsWithArgsMessage(harness, resolvedCfg.capabilities, launchConfig)}; nothing was created`);
  const harnessPackages = verifyHarnessPackages(harness, resolvedCfg, repoAbs, { ...(launchConfig?.executable ? { bin } : {}), env: launchEffectiveEnv({ base: process.env, configEnv: launchConfig?.env || {} }) });
  // Backend presence/startup (ensureHerdr) happens AFTER the decision fence
  // and the exclusive placement reservation below — a stale or losing apply
  // must not start a daemon. Preview never starts one either.
  let herdrBase;
  if (o.preview === true) { preflight = { status: previewPreflightBudget?.exhausted ? "timeout" : "complete", budgetMs: preflightBudgetMs, elapsedMs: Date.now() - preflightStarted }; previewPreflightBudget = null; }
  const task = o.task ?? (o.taskFile ? readFileSync(o.taskFile, "utf8") : "");

  if (existsSync(directoryRollbackPath(homeReal))) throw oatsError("E_WORK_INSPECTION_FAILED", `directory cleanup is still owed for ${home}; restore and retire the retained home before reusing its name`);
  // K6: everything a spawn decides is decided by here — and nothing has been
  // touched. Branch/base for a worktree are named now (not after mkdir) so the
  // preview and the apply agree on them; `o.baseRef` selects the start point.
  let plannedBranch = null, plannedBase = null;
  if (work === "worktree") {
    plannedBranch = o.branch || `agents/${instance}`;
    // Validity is Git's own rule (check-ref-format), not a stricter charset:
    // every later git call takes the name as an argv element, never through a
    // shell, so a valid-but-hostile name is safe and stays exercisable.
    try { execFileSync("git", ["check-ref-format", "--branch", plannedBranch], { stdio: ["ignore", "pipe", "pipe"] }); }
    catch { throw oatsError("E_BAD_ARGS", `branch ${JSON.stringify(plannedBranch)} is not a valid branch name`); }
    if (shInTry(repoAbs, `git rev-parse --verify --quiet ${shq("refs/heads/" + plannedBranch)}`) !== undefined) throw oatsError("E_BRANCH_EXISTS", `branch ${plannedBranch} already exists in ${repoAbs}; choose another name or reuse it deliberately`);
    const baseRef = o.baseRef || "HEAD";
    const baseOid = shInTry(repoAbs, `git rev-parse --verify --quiet ${shq(baseRef + "^{commit}")}`);
    if (baseOid === undefined) throw oatsError("E_BASE_UNKNOWN", `base ${JSON.stringify(baseRef)} does not resolve to a commit in ${repoAbs}`);
    plannedBase = { ref: baseRef, oid: baseOid };
  }
  // The decision a confirmation binds: placement AND what would actually
  // launch (inherited defaults re-resolved at apply must not drift silently).
  const buildDecision = () => {
    const d = { instance, home, branch: plannedBranch, base: plannedBase,
      effective: { repo: repoAbs, work, harness, model: model || null, launchConfig: launchConfig?.name ?? null, yolo: yolo ?? null, backend, // backend regardless of --no-launch: the decision is what WOULD launch
        childSpawns: ownChildPolicy.allowed, relation: relation ? { kind: relation, anchor: { instance: relativeTo ?? null, agentsRoot: anchorHome ? dirname(dirname(dirname(anchorHome))) : null } } : null } };
    // Workspace model: the decision binds WHAT WILL BE MATERIALIZED — the
    // resolution revision (member commits, package commits, payloads). A member
    // that moved between preview and apply changes it → E_DECISION_STALE.
    {
      d.resolution = o.prepared.resolution.revision;
      // Decision 27 (K1′): the decision also binds the merged per-module payloads the spawn will
      // hand each provider (exactly what reaches OATS_SETTINGS) — so a confirmed apply covers every
      // provider fact (an identity choice, a delivery mode) by value, not only through the
      // resolution revision. Kernel-agnostic: whatever keys the payloads carry.
      d.effective.providers = structuredClone(o.prepared.resolution.payloads ?? {});
    }
    d.revision = createHash("sha256").update(canonicalJson(d)).digest("hex").slice(0, 24);
    return d;
  };
  if (o.preview === true) {
    const decision = buildDecision();
    // Workspace model (M3): the preview reports what APPLY will produce — every
    // module as a capability (name + origin) and every module skill by its
    // directory basename with a `module:<cap>` source — not the classic chain's view.
    const preparedCapabilities = o.prepared.resolution.modules.map((m) => ({ name: m.name, origin: m.from.kind === "package" ? `package:${m.from.package}@${m.from.version}` : `member:${m.from.repoKey}@${m.from.commit}` }));
    const preparedSkills = o.prepared.resolution.modules.flatMap((m) => (m.manifest?.skills || []).filter((s) => typeof s === "string" && s).map((s) => ({ name: basename(s.replace(/\/+$/, "")), source: `module:${m.name}` })));
    // R5 (0.25.2, decision 14): the preview shows the provider payloads the apply
    // will record — `providers` is the --provider map exactly as parsed (what the
    // operator typed; prepareInstance keeps it on prepared.spawn.providers) and
    // `settings.<cap>` is the MERGED payload per module (soul ⊕ workspace byTeam ⊕
    // local.settings ⊕ --provider), i.e. what the provider receives. Reserved and
    // poison keys were refused by resolveSoul before this point (E_WORKSPACE_SCHEMA).
    const preparedProviders = structuredClone(o.prepared.spawn?.providers && typeof o.prepared.spawn.providers === "object" ? o.prepared.spawn.providers : {});
    // Addendum 5: where each leaf of `settings.<cap>` came from (JSON pointer → { kind, at }):
    // manifest-default | workspace | soul | host | spawn, the last layer that set it (no byTeam
    // entry is merged since teams amendment K, so no `workspace-team` origin appears).
    const preparedSettingsOrigins = Object.fromEntries(o.prepared.resolution.modules.map((m) => [m.name, structuredClone(o.prepared.resolution.payloadOrigins?.[m.name] ?? {})]));
    const preparedSettings = Object.fromEntries(o.prepared.resolution.modules.map((m) => [m.name, structuredClone(o.prepared.resolution.payloads?.[m.name] && typeof o.prepared.resolution.payloads[m.name] === "object" ? o.prepared.resolution.payloads[m.name] : {})]));
    return deliver({
      // Teams contract (item 7): the ELIGIBLE teams (one per soul label, primary first) — the choice a
      // Desktop offers before anything is minted; joining is the messaging provider's explicit act.
      ...{ modules: o.prepared.preview ?? null, team: o.prepared.soulEntry?.team ?? null, teams: structuredClone(o.prepared.resolution.teams ?? []), resolution: o.prepared.resolution.revision, declRevision: o.prepared.resolution.declRevision ?? null, payloadRevision: o.prepared.resolution.payloadRevision ?? null, workspace: o.prepared.discovery?.key ?? null, standalone: o.prepared.discovery?.standalone === true, providers: preparedProviders, settings: preparedSettings, settingsOrigins: preparedSettingsOrigins },
      spawnPreviewApi: 2, preview: true, agent: agent.name, kind: agent.kind || "persistent", instance, home, repo: repoAbs, work,
      subject: o.subject ?? { soul: agent.name, agentsRoot: root, context: null },
      decision, preflight,
      backendStatus: launch ? { name: backend, installed: !!which(backend), started: false } : null,
      harness, model: model || null, modelSource: launchSelection.modelSource ?? null, launchConfig: launchConfig?.name ?? null, yolo, backend,
      branch: plannedBranch, base: plannedBase, worktree: work === "worktree" ? join(home, "work") : null,
      relation: relation || null, parentInstance: parentInstance && parentInstance !== instance ? parentInstance : null,
      policy: { childSpawns: ownChildPolicy }, executable: bin, capabilities: preparedCapabilities,
      skills: [...expectedResources.filter((r) => r.type === "skill-tree" && !r.deferred).flatMap((r) => r.entries || []), ...preparedSkills], task: task || null,
    });
  }
  if (o.expectDecision !== undefined) {
    // A confirmed preview binds THIS apply: same name, home, branch and base
    // oid, recomputed here under the same placement path. Any drift is a typed
    // refusal carrying the fresh decision — nothing is created, nothing is
    // auto-suffixed or silently re-based.
    const fresh = buildDecision();
    if (fresh.revision !== o.expectDecision) throw Object.assign(oatsError("E_DECISION_STALE", `the previewed decision changed (${o.expectDecision} → ${fresh.revision}): ${fresh.instance}${plannedBase ? ` from ${plannedBase.ref}@${plannedBase.oid.slice(0, 12)}` : ""}; preview again`), { decision: fresh });
  }
  // Backend PRESENCE is a prerequisite, checked before anything is placed (M1):
  // an absent tmux/herdr binary must fail with nothing created, never after a
  // populated home exists. Backend STARTUP (ensureHerdr) still waits for the
  // bound decision and the exclusive placement below — a stale or losing apply
  // must not start a daemon.
  if (launch && !which(backend)) throw new Error(`${backend} not installed${backend === "tmux" ? " (brew install tmux)" : " (https://herdr.dev)"}; nothing was created`);
  // Exclusive placement reservation: the parent may be created, the home
  // itself never with `recursive` — EEXIST means another spawn (a concurrent
  // apply of the same decision, or anything else) got here first, and this one
  // has touched nothing.
  mkdirSync(dirname(home), { recursive: true });
  try { mkdirSync(home); }
  catch (e) {
    if (e?.code === "EEXIST") throw Object.assign(oatsError("E_PLACEMENT_TAKEN", `${instance} already exists at ${home} (a concurrent spawn won the placement); nothing was created by this call`), { instance, home });
    throw e;
  }
  // Names are deployment-wide, but the reservation above is per soul: a concurrent
  // spawn of ANOTHER soul under the same name reserves its own directory. Re-check
  // now that ours exists — two holders means neither may keep it (at most one
  // winner, possibly none; each loser created nothing that survives).
  if (o.instance === undefined) {
    const holders = deploymentInstanceHomes(root).get(instance) ?? [];
    if (holders.length > 1) {
      try { rmdirSync(home); } catch { /* empty by construction; leave it rather than recurse */ }
      const other = holders.find((h) => resolve(h) !== resolve(home)) ?? null;
      if (o.name !== undefined) throw Object.assign(oatsError("E_INSTANCE_NAME_TAKEN", `instance name "${instance}" was taken by a concurrent spawn in this deployment (${other}); nothing was created by this call — pick another --name`), { instance, home: other });
      throw Object.assign(oatsError("E_PLACEMENT_TAKEN", `${instance} was taken by a concurrent spawn of another soul (${other}); nothing was created by this call — preview again`), { instance, home: other });
    }
  }
  // TOCTOU: the placement checks above ran BEFORE composition and the harness
  // package preflight, both of which shell out — a window in which anything able
  // to write in the agent directory can swap `instances/` for a link elsewhere,
  // and mkdirSync follows it (reviewer-a6aa1c5). Re-assert on the directory that
  // now exists, before a single file is written into it (materialize included)
  // or any hook runs.
  // This narrows the window to the mkdir itself rather than closing it outright:
  // Node has no openat/O_NOFOLLOW-relative API, so a truly hostile filesystem
  // needs OS-level protection on the deployment, not a pathname check.
  const createdReal = realpathSync(home);
  if (resolve(createdReal) !== resolve(expectedHome)) {
    // Remove only what we just made, only if it is still empty, and never
    // recursively — whatever lives at an unexpected destination is not ours.
    try { rmdirSync(createdReal); } catch { /* not empty or not removable: leave it and say so */ }
    throw oatsError("E_NO_CANONICAL_ROOT", `instance home ${home} was created at ${createdReal}, not at ${expectedHome} — the path changed after it was validated (a swapped instances/ link), so nothing has been written into it and the spawn is aborted`);
  }
  // One rollback from here to the first lifecycle hook: the home is ours
  // (placement won) and nothing outside it exists yet, so removing the home
  // WHOLE is the entire compensation. `rmSync` recursive: a prepared home is
  // populated by materialize (modules, skills, AGENTS.md, instance.json) — a
  // non-recursive rmdir would leave it behind and the retry would find its
  // name taken (M1). Nothing of a classic home exists at this point either.
  const rollbackEmptyOrPreparedHome = (e) => {
    try { rmSync(home, { recursive: true, force: true }); }
    catch (x) { e.message += ` — rollback INCOMPLETE, remove ${home} manually: ${x.message}`; }
    return e;
  };
  // Workspace model: copy every resolved capability WHOLE into the new home
  // (.oats/modules/<cap>/ + .agents/skills/<cap>/) and record modules/providers
  // in instance.json. Then REBUILD the capability rows against the copies that
  // landed (H1): until now `resolvedCfg.capabilities` were PLANNED rows (no
  // skills, no inject, no dir) — hooks, environment, requirements, retirement
  // and instance.json all read the rebuilt rows from here on.
  let materializeOutcome = null;
  if (o.prepared) {
    // The kernel's composed text (soul AGENTS.md + kernel/work-mode injects) is
    // the body materialize composes the capability injects onto.
    try {
      materializeOutcome = yield () => (o.materialize ?? materializePreparedDefault)({ ...o.prepared, soulAgentsMd: composition.text, soulDir }, home);
      const rows = (typeof o.prepared.toCapabilityRows === "function" ? o.prepared.toCapabilityRows : toCapabilityRows)(o.prepared.resolution, home);
      if (!Array.isArray(rows)) throw new Error("toCapabilityRows returned no rows");
      // A capability agent runs no provider hook — not even its providing module's
      // (lead decision c3 Q1: a harvester never registers as a knowledge source or
      // gets a messaging identity). Its rows keep everything else.
      for (const row of rows) {
        if (agent.kind === "capability") { row.hooks = {}; row.requiredHooks = []; }
        else row.hooks = materializedHookCommands(row, home);
      }
      resolvedCfg.capabilities = rows;
      // S1: the capability blocks materialize appended are part of the composed
      // instructions. Read the markers back from the AGENTS.md that was WRITTEN
      // (the authority on what the instance sees) and merge them into the
      // composition so meta.instructions / composition.expected and the
      // completeness check below describe the whole file, not only the kernel's
      // half.
      const written = readFileSync(join(home, "AGENTS.md"), "utf8");
      const known = new Set(composition.blocks.map((b) => `${b.source}\u0000${b.file}`));
      const outcomeBlocks = Array.isArray(materializeOutcome?.blocks) ? materializeOutcome.blocks : [];
      for (const m of written.matchAll(/^<!-- oats:(capability:[^\s]+) src=(.+?) -->$/gm)) {
        const source = m[1], file = m[2];
        if (known.has(`${source}\u0000${file}`)) continue;
        const fromOutcome = outcomeBlocks.find((b) => b.source === source && b.file === file);
        const content = fromOutcome?.content ?? (existsSync(file) ? readFileSync(file, "utf8").trim() : "");
        composition.blocks.push({ source, file, content, materialized: true });
        // S1: the appended block is part of what the composition PROMISES the instance.
        expectedResources.push({ type: "instruction-block", source, declared: file, path: file, materialized: true });
        known.add(`${source}\u0000${file}`);
      }
      // The expected resources deferred to materialize (module skills/injects)
      // are now resolvable: fill their paths so the record and the completeness
      // check compare promised against landed.
      for (const r of expectedResources) {
        if (r.deferred !== "materialize") continue;
        const row = rows.find((c) => c.id === r.module);
        if (r.type === "injection") { r.path = row?.inject; continue; }
        if (r.type === "skill-tree") {
          const skillsRoot = join(home, ".agents", "skills", r.module);
          r.path = existsSync(skillsRoot) ? skillsRoot : undefined;
          r.entries = (row?.skills || []).map((p) => basename(p));
        }
      }
    } catch (e) { throw rollbackEmptyOrPreparedHome(e); }
  }
  // Backend startup only now — the decision is bound and the placement is ours.
  try { herdrBase = launch && backend === "herdr" ? ensureHerdr({ binary: which("herdr"), socket: o.herdrSocket }) : undefined; }
  catch (e) { throw rollbackEmptyOrPreparedHome(e); }

  initializeNativeHistory(home);

  // Body: instructions are a generated instance-local view; the home carries no soul
  // link (the composed AGENTS.md already holds the soul's instructions). The soul
  // directory this instance incarnates is RECORDED (instance.json `soulDir`) and handed
  // to every classic lifecycle hook and dispatched command as OATS_SOUL. A workspace soul (o.prepared)
  // lives in the per-commit cache agents/<name>/souls/<commit12>/ and agents/<name>/soul
  // is only the kernel-owned "current" POINTER (swapped by every ensureWorkspaceSoul,
  // including a preview's). The record names ITS commit's directory by realpath — never
  // the pointer — so a later fetch can move "current" without changing what a running
  // instance's hooks see (decision 7); the OKF hook's owner pin stays valid.
  let homeSoulTarget = soulDir;
  if (o.prepared?.soulEntry?.commit) {
    const perCommit = join(agent._dir, "souls", String(o.prepared.soulEntry.commit).slice(0, 12));
    if (existsSync(join(perCommit, "soul.yaml"))) homeSoulTarget = realpathSync(perCommit);
  }
  if (homeSoulTarget === soulDir) {
    // Not prepared (or the cache entry is absent): still never link a swappable pointer —
    // when agents/<name>/soul is the kernel's pointer into souls/, link what it shows now.
    try {
      if (lstatSync(soulDir).isSymbolicLink()) {
        const real = realpathSync(soulDir), soulsReal = realpathSync(join(dirname(soulDir), "souls"));
        const rel = relative(soulsReal, real);
        if (rel && !rel.startsWith("..") && !isAbsolute(rel) && !rel.includes(sep)) homeSoulTarget = real;
      }
    } catch { /* absent souls/ or unreadable link: record the soul dir itself */ }
  }
  if (!existsSync(join(home, "CLAUDE.md"))) symlinkSync("AGENTS.md", join(home, "CLAUDE.md"));

  // Skills: module skills were copied WHOLE into <home>/.agents/skills/<module>/
  // by materialize (decision 7/13); here only the soul's own skills join them, one
  // directory each. There is no override: a soul skill named like a module's
  // directory is a duplicate (decision 16). The harness is launched with its normal
  // discovery — the machine's and the repo's skills are the harness's business.
  const sources = [];
  const soulSkills = join(soulDir, "skills");
  if (existsSync(soulSkills)) sources.push({ id: "soul", path: soulSkills });
  const chosen = new Map();
  const offer = (name, src, source) => {
    if (chosen.has(name) || existsSync(join(home, ".agents", "skills", name))) throw oatsError("E_SKILL_DUPLICATE", `skill "${name}" from ${source} collides with ${chosen.get(name)?.source ?? `module ${name}'s skill directory`}`);
    chosen.set(name, { src, source });
  };
  // Same enumerator preflight used, so "what a tree promises" and "what gets
  // copied" cannot drift apart.
  for (const source of sources) for (const entry of skillEntriesIn(source.path)) offer(entry.name, entry.src, source.id);
  mkdirSync(join(home, ".agents", "skills"), { recursive: true });
  mkdirSync(join(home, ".claude"), { recursive: true });
  for (const [name, selected] of [...chosen].sort(([a], [b]) => a.localeCompare(b))) {
    // Pi's recursive skill scanner does not descend through directory symlinks.
    // Copy each selected tree so the exact instance-local set is real and immutable.
    copyTreeSafe(realpathSync(selected.src), join(home, ".agents", "skills", name));
  }
  if (!existsSync(join(home, ".claude", "skills"))) symlinkSync(join("..", ".agents", "skills"), join(home, ".claude", "skills"));

  // EXPECTED == MATERIALIZED. Preflight proved every declared resource resolves;
  // this proves the copies actually landed, so "the composition is complete" is
  // an asserted fact rather than an inference from no error having been thrown.
  // `.agents/skills` is canonical and `.claude/skills` aliases it, so the alias
  // is verified to resolve exactly onto the canonical tree and nowhere else.
  const materialized = [...chosen].sort(([a], [b]) => a.localeCompare(b)).map(([name, v]) => ({ name, source: v.source, from: v.src }));
  const incomplete = [];
  for (const m of materialized) {
    if (!hasSkillDoc(join(home, ".agents", "skills", m.name))) incomplete.push(`skill "${m.name}" (from ${m.source}) did not materialize as a readable SKILL.md`);
  }
  // Reconcile against what was PROMISED, not only against what was selected:
  // iterating `materialized` alone can never notice a promised skill that never
  // entered the set (reviewer-400c1e6). Matching is by NAME because an explicit
  // skill-override may legitimately satisfy a promised name from another source.
  for (const r of expectedResources) {
    if (r.deferred === "materialize") continue; // module skills: verified against the landed copies just below
    for (const name of r.entries || []) {
      if (!chosen.has(name)) incomplete.push(`skill "${name}", promised by ${r.source} (${r.declared}), is missing from the composed set`);
    }
  }
  // Prepared spawn: every module's declared skill must have been copied under
  // .agents/skills/<module>/<skill>/ by materialize — verify the copies landed
  // as readable skills (the module directory alone proves nothing).
  if (o.prepared) {
    for (const m of o.prepared.resolution.modules) for (const s of m.manifest.skills || []) {
      const sk = join(home, ".agents", "skills", m.name);
      if (!existsSync(sk)) { incomplete.push(`module "${m.name}" declares skills but .agents/skills/${m.name} is absent`); break; }
    }
    for (const r of expectedResources) {
      if (r.deferred !== "materialize" || r.type !== "skill-tree") continue;
      if (!r.path) { incomplete.push(`module "${r.module}" declares skill tree ${r.declared} but .agents/skills/${r.module} is absent`); continue; }
      if (!r.entries.length) incomplete.push(`module "${r.module}" declares skill tree ${r.declared} but no skill was copied under .agents/skills/${r.module}`);
      for (const name of r.entries) if (!hasSkillDoc(join(r.path, name))) incomplete.push(`skill "${name}" (module ${r.module}) did not materialize as a readable SKILL.md`);
    }
  }
  for (const r of expectedResources) {
    if (r.type !== "injection") continue;
    if (r.deferred === "materialize" && !r.path) { incomplete.push(`injection from ${r.source} (${r.declared}) was not materialized into the module copy`); continue; }
    if (!composition.blocks.some((b) => b.file === r.path)) incomplete.push(`injection from ${r.source} (${r.declared}) resolved but is not present in the composed AGENTS.md`);
  }
  const aliasTarget = realPathOrNearest(join(home, ".claude", "skills"));
  if (aliasTarget !== realPathOrNearest(join(home, ".agents", "skills"))) {
    incomplete.push(`.claude/skills resolves to ${aliasTarget}, not the canonical .agents/skills tree`);
  }
  if (incomplete.length) {
    // Nothing outside the home exists yet (no worktree, no hooks, no window), so
    // removing the scaffold is the whole rollback.
    let removal = "";
    try { rmSync(home, { recursive: true, force: true }); } catch (e) { removal = ` — rollback INCOMPLETE, remove ${home} manually: ${e.message}`; }
    throw oatsError("E_COMPOSITION_INCOMPLETE", `the instance composition did not materialize completely:\n${incomplete.map((m) => `  ${m}`).join("\n")}${removal}`);
  }

  // Work tree.
  let branch;
  let worktreeCanonical; // captured immediately after add, before setup/hooks can mutate/remove it
  if (work === "worktree") {
    branch = plannedBranch;
    const wt = join(home, "work");
    let added = false;
    try {
      execFileSync("git", ["-C", repoAbs, "worktree", "add", wt, "-b", branch, plannedBase.oid],
        { stdio: ["ignore", "pipe", "pipe"] });
      added = true;
      // Git registers a canonical path. Retain it now: compensation hooks can
      // remove/make the directory inaccessible before rollback verification.
      worktreeCanonical = realpathSync(wt);
    } catch (e) {
      const original = e.stderr?.toString().trim() || e.message;
      const incomplete = [];
      if (added) {
        // Canonicalization failed AFTER add: cleanup is a transaction too.
        // Capture every failure and verify Git effects; because canonical
        // identity was unavailable, never claim confirmed worktree absence.
        const run = (argv) => {
          try { return { ok: true, out: execFileSync(argv[0], argv.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
          // With encoding:"utf8" a silent command yields stderr === "" — FALSY — so
          // `e2.stderr || e2.message` fell through to "Command failed: …" and made
          // every clean probe look like a failed one. `git rev-parse --verify
          // --quiet` on an absent ref is exactly that case, so a successful branch
          // deletion could never be confirmed and rollback always reported
          // INCOMPLETE. Distinguish "no output" from "no stderr captured".
          catch (e2) { return { ok: false, status: e2.status, err: String(e2.stderr ?? e2.message ?? "").trim() }; }
        };
        const remove = run(["git", "-C", repoAbs, "worktree", "remove", "--force", wt]);
        if (!remove.ok) incomplete.push(`git worktree ${wt}: remove failed (${remove.err || `exit ${remove.status}`})`);
        const prune = run(["git", "-C", repoAbs, "worktree", "prune"]);
        if (!prune.ok) incomplete.push(`git worktree ${wt}: prune failed (${prune.err || `exit ${prune.status}`})`);
        const list = run(["git", "-C", repoAbs, "worktree", "list", "--porcelain", "-z"]);
        if (!list.ok) incomplete.push(`git worktree ${wt}: could not verify removal (${list.err || "worktree list failed"})`);
        else incomplete.push(`git worktree ${wt}: could not verify removal (canonical path unavailable after add)`);
        const del = run(["git", "-C", repoAbs, "branch", "-D", branch]);
        if (!del.ok) incomplete.push(`git branch ${branch}: deletion failed (${del.err || `exit ${del.status}`})`);
        const ref = run(["git", "-C", repoAbs, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
        if (ref.ok) incomplete.push(`git branch ${branch}: still exists`);
        else if (ref.status !== 1 || ref.err) incomplete.push(`git branch ${branch}: could not verify deletion (${ref.err || `exit ${ref.status}`})`);
      }
      try { rmSync(home, { recursive: true, force: true }); } catch (e2) { incomplete.push(`instance home ${home}: ${e2.message}`); }
      const note = incomplete.length ? ` — rollback INCOMPLETE — clean up manually: ${incomplete.join("; ")}` : "";
      throw new Error(`git worktree add/canonicalization failed: ${original}${note}`);
    }
  } else if (work === "directory") {
    // An owned execution directory, not a link to the source or a fake Git repo.
    mkdirSync(join(home, "work"));
  } else if (work === "attached") {
    // Attach to ANOTHER instance's work tree (o.workDir): sibling home, shared tree.
    // The tree belongs to its owner — retire never removes it (work/ is a symlink).
    if (!o.workDir || !existsSync(o.workDir)) { rmSync(home, { recursive: true, force: true }); throw new Error(`attached mode needs workDir (got: ${o.workDir})`); }
    symlinkSync(resolve(o.workDir), join(home, "work"));
    branch = shTry(`git -C ${shq(o.workDir)} rev-parse --abbrev-ref HEAD`);
  } else if (work === "workspace") {
    // Cross-repo coordinator: ./work is the deployment boundary (the directory
    // holding oats-local.yaml, prepared.deployment), not a repo — member repos are
    // read-context; repo edits are routed, not made.
    const wsRoot = preparedDeployment;
    if (!wsRoot) {
      rmSync(home, { recursive: true, force: true });
      throw oatsError("E_LOCAL_MISSING", "workspace mode needs its deployment directory (the one holding oats-local.yaml) so ./work has a root");
    }
    symlinkSync(resolve(wsRoot), join(home, "work"));
    branch = undefined; // no repo identity: the workspace is not a git tree
  } else {
    symlinkSync(repoAbs, join(home, "work"));
    branch = shTry(`git -C ${shq(repoAbs)} rev-parse --abbrev-ref HEAD`);
  }

  const warnings = [];

  // Establish directory ownership while these are still the kernel's own roots.
  // A hook may replace either path; it must never mint authority for that target.
  if (work === "directory") {
    assertDirectoryRoots(home, homeReal);
    writeRetirementBaseline(home, join(home, "work"), work, resolvedCfg.capabilities, { launched: false });
  }

  // Capability lifecycle hooks (spawn) — the knowledge integration scaffolds instance
  // memory (STATE.md/log.md/notes/ are OKF conventions, not kernel ones); the
  // messaging integration mints the comms identity. Kernel stays memory-agnostic.
  const preparedSoulId = o.prepared ? preparedSoulIdOf(o.prepared.soulEntry) : undefined;
  // Hooks read the soul the HOME links (the per-commit directory for a workspace
  // soul), never the swappable agents/<name>/soul pointer: a provider that pins a
  // path must pin this instance's content, and OATS_SOUL_ID is what it keys on.
  const hookRes = runLifecycleHooks("spawn", {
    home, instance, agentName: agent.name, soulDir: homeSoulTarget, soulId: preparedSoulId, contextDir: repoAbs,
    workspaceDir: workspaceOf(root), rootDir: root, resolved: resolvedCfg,
    extraEnv: { OATS_TASK: task, OATS_REPO: repoAbs, OATS_BRANCH: branch || "", OATS_WORK: work, OATS_HARNESS: harness, OATS_RUNTIME: harness, OATS_KIND: agent.kind || "persistent" },
  });
  warnings.push(...hookRes.warnings);
  // Which capability hooks RAN (in order) and how each ended — recorded on the
  // `spawned` event below: the instance's event log is the auditable fact that
  // a capability configured itself, independent of whatever the hook printed.
  const hookReceipt = (res) => { const failedBy = new Map((res.failures || []).map((f) => [f.capability, f])); return (res.order || []).map((id) => ({ capability: id, ok: !failedBy.has(id), ...(failedBy.has(id) ? { required: failedBy.get(id).required === true, contract: failedBy.get(id).contract ?? null } : {}), meta: Object.hasOwn(res.meta || {}, id) })); };
  const requiredFailures = (hookRes.failures || []).filter((f) => f.required);
  let windowMayExist = false;
  let spawnTmux;
  let spawnHerdr;
  const ancillaryCleanup = [];
  // One compensation owner, from the first hook result through launch and
  // the final lineage write. Preserve the original failure and retain any
  // credentials/metadata whose cleanup could not be confirmed.
  const compensateSpawn = () => {
    const failed = requiredFailures.length
      ? requiredFailures.map((f) => ({ capability: f.capability, event: f.event, ...(f.contract ? { contract: f.contract } : {}) }))
      : [{ capability: "oats.kernel", event: "spawn" }];
    const incomplete = [...ancillaryCleanup];
    const probe = (argv) => {
      try { return { ok: true, out: execFileSync(argv[0], argv.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
      // An absent ref exits 1 with empty stderr; preserve that distinction.
      catch (e2) { return { ok: false, status: e2.status, err: String(e2.stderr ?? e2.message ?? "").trim() }; }
    };
    // Retain cleanup owners so a retry must actually discharge their debt.
    const outstandingHooks = new Set();
    const outstandingGit = new Set();
    // A failed new-window command may still have created its window. Verify
    // quiescence before removing credentials or work that harness may be using.
    if (windowMayExist && spawnHerdr) {
      try { stopHerdr(spawnHerdr); }
      catch (e) {
        incomplete.push(`Herdr session: ${e.message}`);
        for (const cap of resolvedCfg.capabilities) if (cap.hooks?.retire) outstandingHooks.add(cap.id);
        if (work === "worktree") { outstandingGit.add("worktree"); if (branch) outstandingGit.add("branch"); }
        return quarantineInstanceHome({ home, instance, agent, soulDir: homeSoulTarget, soulId: preparedSoulId, incomplete, failed, outstandingHooks, outstandingGit,
          repoAbs, work, branch, resolvedCfg, hookMeta: hookRes.meta || {},
          launched: true, sessionTarget: spawnHerdr, directoryHome: homeReal, recordRetirementBaseline: true });
      }
    }
    if (windowMayExist && backend === "herdr" && !spawnHerdr) {
      // Allocation starts only an empty shell; the harness command has not run.
      // A lost receipt cannot authorize closing an unidentified terminal.
      incomplete.push(`Herdr workspace allocation may have completed on ${herdrBase.socket} (label ${instance}, cwd ${home}); inspect and remove any empty workspace manually`);
    }
    if (windowMayExist && backend === "tmux") {
      shTry(`tmux kill-window -t ${shq(`=${session}:=${instance}`)}`);
      const winProbe = probe(["tmux", "list-windows", "-t", session, "-F", "#{window_name}"]);
      const unresolved = !winProbe.ok || winProbe.out.split("\n").includes(instance);
      if (unresolved) {
        incomplete.push(!winProbe.ok
          ? `tmux window ${session}:${instance}: could not verify removal (${winProbe.err || "list-windows failed"})`
          : `tmux window ${session}:${instance} still running`);
        for (const cap of resolvedCfg.capabilities) if (cap.hooks?.retire) outstandingHooks.add(cap.id);
        if (work === "worktree") {
          outstandingGit.add("worktree");
          if (branch) outstandingGit.add("branch");
        }
        return quarantineInstanceHome({
          home, instance, agent, soulDir: homeSoulTarget, soulId: preparedSoulId, incomplete, failed, outstandingHooks, outstandingGit,
          repoAbs, work, branch, resolvedCfg, hookMeta: hookRes.meta || {},
          launched: true, tmux: spawnTmux, directoryHome: homeReal, recordRetirementBaseline: true,
        });
      }
    }
    // Once hooks ran, directory execution may already hold authored results.
    // Preserve before compensation and again afterwards, just like retirement.
    // Failure to copy retains the home, never converts a failed spawn into loss.
    const directoryRecoveries = [];
    let lastDirectoryFingerprint;
    let compensationMeta = {};
    const retainDirectory = (error) => {
      incomplete.push(`directory preservation: ${error.message}`);
      // No successful copy means no destructive cleanup. Even after a partial
      // compensation pass, retry with the ORIGINAL spawn receipt, not its report.
      for (const cap of resolvedCfg.capabilities) {
        if (cap.hooks?.retire || (hookRes.order?.includes(cap.id) && hookRes.meta?.[cap.id])) outstandingHooks.add(cap.id);
      }
      const note = quarantineInstanceHome({
        home, instance, agent, soulDir: homeSoulTarget, soulId: preparedSoulId, incomplete, failed, outstandingHooks, outstandingGit,
        repoAbs, work, branch, resolvedCfg, hookMeta: hookRes.meta || {}, compensationMeta,
        launched: false, directoryPreservation: true, directoryHome: homeReal,
        recordRetirementBaseline: true,
      });
      return `${note}${directoryRecoveries.length ? `; prior work recovery: ${directoryRecoveries.join(", ")}` : ""}`;
    };
    const preserveDirectory = () => {
      if (work !== "directory") return;
      assertDirectoryRoots(home, homeReal);
      const path = join(home, "work");
      if (!readdirSync(path).length) return;
      const directoryFingerprint = fingerprintTree(path);
      if (lastDirectoryFingerprint === directoryFingerprint) return;
      const receipt = preserveRetirementWork({ home, work: path, directory: true, directoryFingerprint, classes: ["directory work bytes"] }, { work, repo: repoAbs }, instance);
      directoryRecoveries.push(receipt.path);
      lastDirectoryFingerprint = directoryFingerprint;
    };
    try { preserveDirectory(); }
    catch (e) { return retainDirectory(e); }
    try {
      const comp = runLifecycleHooks("retire", {
        home, instance, agentName: agent.name, soulDir: homeSoulTarget, soulId: preparedSoulId, contextDir: repoAbs,
        workspaceDir: workspaceOf(root), rootDir: root, resolved: resolvedCfg,
        priorMeta: hookRes.meta || {},
      });
      for (const f of comp.failures || []) { incomplete.push(`retire hook ${f.capability}: ${f.message}`); outstandingHooks.add(f.capability); }
      // A compensation hook may exit 0 yet report that it did not finish. Only
      // an explicit "nothing to undo" counts as complete; anything else means
      // external state (a remote identity) may still exist, and the rollback
      // must not be announced as clean while the local key that could delete it
      // is about to be removed.
      for (const [capId, m] of Object.entries(comp.meta || {})) {
        if (m && typeof m === "object" && m.retired === false && m.reason !== "nothing-to-delete") {
          incomplete.push(`retire hook ${capId}: reported incomplete cleanup${m.reason ? ` (${m.reason})` : ""} — external state may remain`);
          outstandingHooks.add(capId);
        }
      }
      compensationMeta = { ...compensationMeta, ...(comp.meta || {}) };
    } catch (e2) {
      incomplete.push(`retire hooks: ${e2.message}`);
      // The whole pass died, so which hooks ran is unknown: every capability that
      // HAS a retire hook is outstanding until a retry proves otherwise.
      for (const cap of resolvedCfg.capabilities) if (cap.hooks?.retire) outstandingHooks.add(cap.id);
    }
    if (work === "worktree") {
      const wt = join(home, "work");
      probe(["git", "-C", repoAbs, "worktree", "remove", "--force", wt]);
      probe(["git", "-C", repoAbs, "worktree", "prune"]);
      const wtProbe = probe(["git", "-C", repoAbs, "worktree", "list", "--porcelain", "-z"]);
      if (!wtProbe.ok) { incomplete.push(`git worktree ${worktreeCanonical || wt}: could not verify removal (${wtProbe.err || "worktree list failed"})`); outstandingGit.add("worktree"); }
      else {
        const registered = wtProbe.out.split("\0").filter((f) => f.startsWith("worktree ")).map((f) => f.slice("worktree ".length));
        if (worktreeCanonical && registered.includes(worktreeCanonical)) { incomplete.push(`git worktree ${worktreeCanonical}: still registered`); outstandingGit.add("worktree"); }
      }
      if (branch) {
        probe(["git", "-C", repoAbs, "branch", "-D", branch]);
        const brProbe = probe(["git", "-C", repoAbs, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
        if (brProbe.ok) { incomplete.push(`git branch ${branch}: still exists`); outstandingGit.add("branch"); }
        else if (brProbe.status !== 1 || brProbe.err) { incomplete.push(`git branch ${branch}: could not verify deletion (${brProbe.err || `rev-parse exit ${brProbe.status}`})`); outstandingGit.add("branch"); }
      }
    }
    // Any attempted spawn hook may have created state before a later hook (or
    // its own environment output) failed. Metadata is its receipt. If that
    // capability has no retire hook, OATS cannot prove the receipt was undone,
    // even when it was not the hook that ultimately failed.
    const attempted = new Set(hookRes.order || []);
    for (const cap of resolvedCfg.capabilities.filter((c) => attempted.has(c.id))) {
      if (cap?.hooks?.retire) continue;
      if (!hookRes.meta?.[cap.id]) continue;
      incomplete.push(`${cap.id}: its spawn hook reported state it created, but the capability declares no retire hook, so OATS cannot undo it`);
      outstandingHooks.add(cap.id);
    }
    try { preserveDirectory(); }
    catch (e) { return retainDirectory(e); }
    let note;
    if (outstandingHooks.size || outstandingGit.size) {
      // Preserve credentials and the original hook receipt until cleanup
      // succeeds. The harness is stopped; Git cleanup was independently safe.
      note = quarantineInstanceHome({
        home, instance, agent, soulDir: homeSoulTarget, soulId: preparedSoulId, incomplete,
        failed,
        outstandingHooks, outstandingGit, repoAbs, work, branch, resolvedCfg,
        hookMeta: hookRes.meta || {}, compensationMeta, launched: false,
        directoryHome: homeReal, recordRetirementBaseline: true,
      });
    } else {
      try { rmSync(home, { recursive: true, force: true }); } catch (e2) { incomplete.push(`instance home ${home}: ${e2.message}`); }
      if (existsSync(home) && !incomplete.some((m) => m.startsWith("instance home"))) incomplete.push(`instance home ${home}: still present`);
      note = incomplete.length ? ` — rollback INCOMPLETE, clean up manually: ${incomplete.join("; ")}` : " — spawn rolled back";
    }
    return `${note}${directoryRecoveries.length ? `; directory work preserved at ${directoryRecoveries.join(", ")}` : ""}`;
  };

  try {
    if (requiredFailures.length) {
      const detail = requiredFailures.map((f) => `  ${f.capability} ${f.event} ${f.contract === "environment" ? "environment contract" : "hook (declared required)"}: ${f.message}`).join("\n");
      const code = requiredFailures.some((f) => f.contract === "environment") ? "E_HOOK_ENVIRONMENT_CONTRACT" : "E_REQUIRED_HOOK_FAILED";
      throw oatsError(code, `a capability this soul activates could not configure itself:\n${detail}\n\nThe instance would have started with an invalid or missing capability configuration`);
    }
    // Hooks have finished, but no TASK, launch recipe, successful scaffold, or
    // backend operation may be published until the owned roots are revalidated.
    if (work === "directory") assertDirectoryRoots(home, homeReal);
    {
      const owned = Object.keys(launchConfig?.env || {}).filter((n) => Object.hasOwn(hookRes.env, n));
      if (owned.length) {
        const owner = (n) => (hookRes.contributions || []).find((c) => (c.env || []).includes(n))?.capability || "a capability";
        throw oatsError("E_LAUNCH_ENV_CONFLICT", `${owned.map((n) => `${n} (set by ${owner(n)})`).join(", ")} cannot be overridden by launch configuration ${launchConfig.name}; change the capability's setting instead`);
      }
    }
    const briefLines = hookRes.briefs.length ? `\n${hookRes.briefs.join("\n")}` : "";
    const workDesc = work === "worktree"
      ? `a dedicated git worktree of ${repoAbs} on branch "${branch}" — commit freely there`
      : work === "attached"
      ? `ATTACHED to another instance's work tree (${o.workDir}, branch ${branch}) — you share it with that instance; make your changes and commits focused, and never switch branches`
      : work === "directory"
      ? `an instance-owned execution directory — not a Git worktree or a link to ${repoAbs}; that path supplies configuration only`
      : work === "workspace"
      ? `the WHOLE WORKSPACE (${realpathSync(join(home, "work"))}) — every member repo is read-context; you coordinate, you do not edit member repos (see your work-mode briefing)`
      : `a symlink to the ${repoAbs} checkout — you share it; work on the currently checked-out branch (${branch}) and do not switch branches without being asked`;
    writeFileSync(join(home, "TASK.md"), `# Instance briefing: ${instance}

You are instance "${instance}" of agent "${agent.name}".
- Home: ${home}
- Work tree: ./work — ${workDesc}
- Do all repository work inside ./work. Read ./work/AGENTS.md or ./work/CLAUDE.md first if present.${briefLines}${harness === "codex" ? "\n## Harness notification delivery\n\nNative Codex has no built-in messaging channel. Follow the explicit delivery briefing for this instance from your messaging capability, if present; it may arrange notification through this terminal. Shared channel instructions alone do not establish that delivery is configured. Without an instance delivery briefing, check your messaging capability's inbox and pending commands at task boundaries or when the operator asks; do not assume messages will wake this session.\n" : ""}
${task.trim() ? `\n## Task\n\n${task.trim()}\n` : "\nNo task was provided at spawn time — await instructions.\n"}`);

    // Launch command. Spawn IS session start: the recipe is persisted in
    // instance.json beside its rendering, which is executed in the instance's
    // tmux window. Capabilities contributed harness-specific arguments and
    // environment through their spawn hook; both are recorded with provenance.
    const recipe = {
      version: LAUNCH_RECIPE_VERSION, harness,
      launchConfig: launchConfig?.name || null, launchConfigSource: launchConfig?.source || null,
      executable: bin, executableDeclared: executable.declared, executableResolvedFrom: executable.resolvedFrom,
      args: [...(launchConfig?.args || [])], env: { ...(launchConfig?.env || {}) },
      model: model || null, ...(yolo !== undefined ? { yolo } : {}),
      hooks: { launch: { ...hookRes.launch }, env: { ...hookRes.env }, contributions: hookRes.contributions || [] },
      prompt: LAUNCH_PROMPT,
    };
    const cmdline = renderLaunchRecipe(recipe, { home, instance });

    // Module skills as materialize landed them (.agents/skills/<module>/<skill>/),
    // beside the soul's own: per-skill provenance `module:<cap>` (lead decision c3),
    // `from` = the home's module copy the skill was copied from.
    const moduleSkills = (materializeOutcome?.skills || []).map((row) => ({ name: row.name, source: `module:${row.module}`, from: join(home, row.from) }));
    const meta = {
      agent: agent.name, kind: agent.kind || "persistent", instance, home, soulDir: homeSoulTarget,
      repo: repoAbs, work, branch, harness, model: model || undefined,
      ...(yolo !== undefined ? { yolo } : {}),
      parentInstance: parentInstance && parentInstance !== instance ? parentInstance : undefined,
      siblingInstance: siblingInstance && siblingInstance !== instance ? siblingInstance : undefined,
      relation: relation || undefined,
      relativeTo: relation ? relativeTo : undefined,
      spawnOrigin: relation || (parentInstance && parentInstance !== instance) ? "instance" : "operator",
      policy: { childSpawns: ownChildPolicy },
      // K6c: a decision-bound spawn records what bound it, so a retry with the
      // same key replays this receipt instead of spawning again.
      // The FULL bound decision (placement + effective), exactly as the fence
      // compared it — a receipt echoes what it was bound to, not a subset.
      ...(o.expectDecision !== undefined ? { decision: buildDecision() } : {}),
      ...(o.idempotencyKey !== undefined ? { spawnIdempotencyKey: String(o.idempotencyKey), spawnCompleted: false } : {}),
      capabilityMeta: Object.keys(hookRes.meta).length ? hookRes.meta : undefined,
      capabilities: resolvedCfg.capabilities.map((cap) => ({
        id: cap.id, layer: cap.layer, command: cap.command, origin: cap.origin, level: cap.level,
        settings: cap.settings, provenance: cap.provenance, skills: cap.skills || [],
        hooks: Object.keys(cap.hooks || {}), trusted: !!cap.trust?.trusted,
        ...(cap.environment?.length ? { environment: [...cap.environment] } : {}),
        ...(cap.environmentNamespaces?.length ? { environmentNamespaces: [...cap.environmentNamespaces] } : {}),
      })),
      skills: [...[...chosen].sort(([a], [b]) => a.localeCompare(b)).map(([name, v]) => ({ name, source: v.source })), ...moduleSkills.map(({ name, source }) => ({ name, source }))],
      instructions: composition.blocks.map((b) => ({ source: b.source, file: b.file })),
      // The auditable record of the curriculum: what the resolved composition
      // PROMISED, and what actually landed. Both are asserted equal before launch;
      // keeping both makes an instance's surface reviewable after the fact without
      // re-resolving config that may since have changed.
      composition: {
        expected: expectedResources.map((r) => ({ type: r.type, source: r.source, declared: r.declared, resolved: r.path, origin: r.origin, level: r.level, ...(r.deferred ? { deferred: r.deferred } : {}) })),
        materialized: {
          skills: [...materialized.map((m) => ({ name: m.name, source: m.source, from: m.from })), ...moduleSkills],
          instructions: composition.blocks.map((b) => ({ source: b.source, file: b.file })),
          // `filtered` records that the operator's settings entry narrows this
          // package's resources. A non-empty filter is a deliberate choice whose
          // glob semantics belong to the harness, so it is auditable here rather
          // than second-guessed at spawn.
          harnessPackages: harnessPackages.map((x) => ({ capability: x.capability, harness: x.harness, package: x.package, dir: x.dir, filtered: x.filtered, loadedBy: "harness-discovery" })),
          // What this instance ACTUALLY sees beyond the OATS-composed set. Recorded
          // so the deviation from strict composition is auditable instead of
          // implied — the honest contract, not an aspiration.
          harnessPosture: harness === "claude"
            ? {
              oatsComposed: "skills via .claude/skills -> ../.agents/skills; instructions via CLAUDE.md -> AGENTS.md",
              ambient: ["user skills", "project and ancestor skills to the repository root", "user and project plugins", "user and project settings", "user and ancestor CLAUDE.md"],
              why: "founder ruling: Claude Code's own global and per-repo configuration stays enabled — it is powerful, and the operator decides. An all-OATS setup is the way to opt out.",
            }
            : harness === "codex" ? {
              oatsComposed: "skills via .agents/skills; instructions via AGENTS.md; task via initial prompt",
              ambient: ["user and ancestor instructions", "user, project, admin and system skills", "user and project configuration and MCP servers"],
              why: yolo ? "Codex keeps native configuration with approval prompts and sandbox disabled by the OATS yolo setting." : "Codex keeps the operator's native configuration and approval policy, including approval handling for work paths outside the home.",
            } : {
              oatsComposed: "skills via --skill <instance-home>/.agents/skills; instructions via --append-system-prompt",
              curtailed: ["user skills", "project and ancestor skills", "package skills", "ambient AGENTS.md/CLAUDE.md discovery", "ambient prompt templates"],
              ambient: ["globally configured pi extensions, and any resources they contribute"],
              why: "founder ruling: shared cross-agent pi extensions (web search, output formatting) stay available to every instance.",
            },
          canonicalSkillTree: join(home, ".agents", "skills"),
          skillAlias: { path: join(home, ".claude", "skills"), target: join("..", ".agents", "skills") },
        },
      },
      capabilityRuntime: resolvedCfg.capabilities.map((cap) => ({
        id: cap.id, layer: cap.layer, level: cap.level, settings: cap.settings,
        hooks: cap.hooks, requiredHooks: cap.requiredHooks, environment: cap.environment, environmentNamespaces: cap.environmentNamespaces,
        missingRequires: cap.missingRequires, trust: cap.trust,
        executable: cap.executable,
      })),
      ...(backend === "herdr" ? { backend } : { tmux: { session, window: instance } }),
      launch: recipe, command: cmdline, createdAt: new Date().toISOString(),
    };
    // Workspace model: materialize recorded modules/providers (and the module
    // digests) in instance.json before this metadata is assembled — carry them.
    if (o.prepared) {
      try { const prior = JSON.parse(readFileSync(join(home, "instance.json"), "utf8")); if (prior.modules) meta.modules = prior.modules; if (prior.providers) meta.providers = prior.providers; } catch { /* materialize wrote it; absent means nothing to carry */ }
      // M5/3a: the workspace's name and the deployment directory are recorded, so a home
      // answers them (inspect/operation run --home, OATS_WORKSPACE_NAME) without discovery.
      meta.workspace = { key: o.prepared.discovery?.key ?? null, name: o.prepared.discovery?.workspace?.name ?? null, deployment: o.prepared.deployment ?? null, commit: o.prepared.discovery?.commit ?? null, resolution: o.prepared.resolution.revision, standalone: o.prepared.discovery?.standalone === true, soul: { id: preparedSoulIdOf(o.prepared.soulEntry), repoKey: o.prepared.soulEntry.repoKey, commit: o.prepared.soulEntry.commit, team: o.prepared.soulEntry.team ?? null, labels: [...(o.prepared.soulEntry.labels ?? (o.prepared.soulEntry.team ? [o.prepared.soulEntry.team] : []))], ...(typeof o.prepared.soulEntry.package === "string" ? { package: { id: o.prepared.soulEntry.package, version: o.prepared.soulEntry.version, commit: o.prepared.soulEntry.commit, digest: o.prepared.soulEntry.digest, path: o.prepared.soulEntry.path } } : {}) }, layers: layerRows(o.prepared.resolution) };
      // Teams contract (decision 6): the eligible teams at spawn, recorded as EVIDENCE beside
      // `providers` (never inside that capability-keyed map). A home's hooks and operations get
      // the LIVE set (liveTeams); this is what they fall back to when discovery cannot answer.
      meta.teams = structuredClone(o.prepared.resolution.teams ?? []);
    }
    const spawnWarnings = warnings;

    spawnTmux = meta.tmux;
    if (work === "directory") assertDirectoryRoots(home, homeReal);
    const executionCommand = launch ? nativeRecordCommand(cmdline, home, harness) : null;
    if (launch && backend === "herdr") {
      windowMayExist = true;
      spawnHerdr = allocateHerdr(herdrBase, { home, instance });
      meta.sessionTarget = spawnHerdr;
      meta.launched = true;
      writeFileSync(join(home, "instance.json"), JSON.stringify(meta, null, 2) + "\n");
      writeRetirementBaseline(home, join(home, "work"), work, resolvedCfg.capabilities, { launched: true, sessionTarget: spawnHerdr });
      try { launchHerdr(spawnHerdr, `${launchEnvExports(recipe, process.env)}${executionCommand}`); }
      catch (e) { throw oatsError("E_SPAWN_LAUNCH_FAILED", `Herdr could not run the launch command for ${instance} (${e.code === "ENOENT" ? "herdr unavailable" : "pane run failed"}); the command line is withheld from this message`); }
    } else if (launch) {
      if (!tmuxAlive(session)) {
        const hq = existsSync(root) ? root : workspaceOf(root);
        sh(`tmux new-session -d -s ${shq(session)} -n hq -c ${shq(hq)}`);
        shTry(`tmux set-option -t ${shq(session)} -g window-size latest`);
        shTry(`tmux set-option -t ${shq(session)} -g aggressive-resize on`);
      }
      if (tmuxWindows(session).includes(instance)) throw new Error(`tmux window "${instance}" already exists in session ${session}`);
      meta.tmux.socket = tmuxSocket(session);
      meta.launched = true;
      // Commit the final child metadata and its independent byte authority before
      // the managed harness can write. No child-home transition follows launch.
      writeFileSync(join(home, "instance.json"), JSON.stringify(meta, null, 2) + "\n");
      writeRetirementBaseline(home, join(home, "work"), work, resolvedCfg.capabilities, { launched: true, tmux: meta.tmux });
      // Wrap the command so the window drops into an interactive shell when the
      // agent exits (e.g. Ctrl-C) instead of tmux killing the window.
      const windowCmd = `${executionCommand}; exec "\${SHELL:-/bin/zsh}"`;
      windowMayExist = true;
      try { sh(`tmux new-window -t ${shq(session)} -n ${shq(instance)} -c ${shq(home)}${launchEnvTmuxFlags(recipe, process.env)} ${shq(windowCmd)}`); }
      catch (e) { throw oatsError("E_SPAWN_LAUNCH_FAILED", `tmux new-window failed for ${instance} (${e.code === "ENOENT" ? "tmux unavailable" : "the window command was refused"}); the command line and tmux's output are withheld from this message because they can carry reference values; run tmux list-windows on the session to inspect`); }
    } else {
      meta.launched = false;
      writeFileSync(join(home, "instance.json"), JSON.stringify(meta, null, 2) + "\n");
      writeRetirementBaseline(home, join(home, "work"), work, resolvedCfg.capabilities, { launched: false, tmux: meta.tmux });
    }

    // parent relation: re-point the ANCHOR's recorded lineage so its parent is
    // the new instance (e.g. a maintainer reviewing the spawner sits above it).
    // Committed LAST — after every other fallible step incl. launch — so a
    // failed spawn (missing tmux, window collision, new-window error) never
    // leaves the anchor's graph pointing at a zombie. --no-launch reaches here
    // too: the scaffold itself succeeded, which is that path's definition of
    // success. The write ITSELF is fallible (anchor retired concurrently,
    // unwritable file): on failure the spawn is COMPENSATED — kill the launched
    // window and remove the scaffold — so the operation stays all-or-nothing:
    // either agent live + lineage recorded, or neither.
    if (relation === "parent" && anchorMeta && anchorMetaPath) {
      // Atomic anchor update: writeFileSync truncates-then-writes, so a mid-write
      // failure (ENOSPC, I/O) could leave the anchor's instance.json empty.
      // Write a same-directory temp file and rename it over the anchor — rename
      // is atomic on POSIX, so the anchor is always either old or new, never
      // truncated.
      const tmpPath = `${anchorMetaPath}.tmp-${instance}`;
      try {
        anchorMeta.parentInstance = instance;
        delete anchorMeta.siblingInstance; // the new parent carries the old sibling link
        writeFileSync(tmpPath, JSON.stringify(anchorMeta, null, 2) + "\n");
        renameSync(tmpPath, anchorMetaPath);
      } catch (e) {
        try { rmSync(tmpPath, { force: true }); }
        catch (cleanupError) { ancillaryCleanup.push(`temp file ${tmpPath}: ${cleanupError.message}`); }
        throw new Error(`relation "parent": failed to re-point anchor "${relativeTo}" (${e.message})`);
      }
    }

    appendEvent(home, { kind: "spawned", data: { agent: agent.name, work, branch: branch ?? null, harness, model: model || null, parentInstance: meta.parentInstance ?? null, relation: relation ?? null, launched: launch, hooks: hookReceipt(hookRes) } });
    if (launch) appendEvent(home, { kind: "launched", data: { harness, backend, launchConfig: launchConfig?.name ?? null } });
    if (o.idempotencyKey !== undefined) {
      // Only now is the spawn a finished receipt a same-key retry may replay.
      meta.spawnCompleted = true;
      writeFileSync(join(home, "instance.json"), JSON.stringify(meta, null, 2) + "\n"); // a kernel-owned field: the baseline fingerprint ignores it
    }
    return deliver({ ...meta, ...(o.expectDecision !== undefined ? { replayed: false } : {}), launch: redactLaunchRecipe(recipe), command: redactLaunchCommand(cmdline), attach: spawnHerdr ? `HERDR_SOCKET_PATH=${shq(spawnHerdr.socket)} ${shq(spawnHerdr.binary)} terminal attach ${shq(spawnHerdr.terminalId)}` : backend === "herdr" ? "not launched" : `tmux attach -t ${session}`, warnings: spawnWarnings.length ? spawnWarnings : undefined });
  } catch (error) {
    const note = compensateSpawn();
    error.message += note;
    throw error;
  }
}

/** Decision 27 (K2): the principal an instance ACTS AS, as its messaging-layer provider reported
 *  it — a documented layer contract `{ mode: "local"|"global", alias, team, address|null, resident|null,
 *  grant?: { id, expiresAt, scopes } }` under `identity` in the provider's hook meta. The kernel copies it
 *  through and never interprets `grant`. Preference: the capability whose captured layer is "messaging";
 *  else any capability that emitted an `identity` object. Null when none did. */
export function servedIdentityOf(meta) {
  const cm = meta?.capabilityMeta;
  if (!cm || typeof cm !== "object") return null;
  const harness = Array.isArray(meta.capabilityRuntime) ? meta.capabilityRuntime : [];
  const messaging = harness.filter((c) => c && c.layer === "messaging").map((c) => c.id);
  const pick = (ids) => { for (const id of ids) { const v = cm[id]?.identity; if (v && typeof v === "object" && !Array.isArray(v)) return { ...v, provider: id }; } return null; };
  return pick(messaging) ?? pick(Object.keys(cm));
}
/** One line for a roster/inspect: `acts as <address> via grant, expires <t>` or `alias <alias> on <team>`. */
export function servedIdentityLine(identity) {
  if (!identity) return null;
  if (identity.mode === "global" && identity.grant) return `acts as ${identity.address || identity.alias || identity.resident || "?"} via grant${identity.grant.expiresAt ? `, expires ${identity.grant.expiresAt}` : ""}`;
  return `alias ${identity.alias || "?"} on ${identity.team || "?"}`;
}
export function listInstances(root, tmuxSession = DEFAULT_TMUX_SESSION) {
  const windows = tmuxWindows(tmuxSession);
  const readInstancesOf = (agentDir) => {
    const instancesDir = join(agentDir, "instances");
    // An instance name starts with a letter or digit (INSTANCE_NAME_RE); a
    // dot-directory under instances/ is kernel bookkeeping (.oats-retirement
    // holds baselines and recoveries), never a home (oats-5xl).
    return (existsSync(instancesDir) ? readdirSync(instancesDir, { withFileTypes: true }) : [])
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => {
        const metaPath = join(instancesDir, e.name, "instance.json");
        const home = join(instancesDir, e.name);
        const meta = existsSync(metaPath)
          ? upgradeHomeMeta(JSON.parse(readFileSync(metaPath, "utf8")), home)
          : { instance: e.name, home };
        // A home retained by an incomplete rollback is NOT a live instance: it
        // is preserved state awaiting cleanup, and must read that way.
        const fallback = directoryRollbackPath(home);
        const quarantine = existsSync(fallback) ? fallback : join(home, ".oats-rollback-incomplete.json");
        let rollbackIncomplete;
        if (existsSync(quarantine)) {
          try { rollbackIncomplete = JSON.parse(readFileSync(quarantine, "utf8")); }
          catch { rollbackIncomplete = { reason: "rollback incomplete" }; }
        }
        // A self-retire that has been requested but not completed: the home is
        // owed a retirement, not live work. Read-only here — completion is the
        // detached child's or an operator's `oats retire`, never status.
        const pending = retirePendingMarkerPath(home);
        let retirePending;
        if (existsSync(pending)) {
          try { retirePending = JSON.parse(readFileSync(pending, "utf8")); }
          catch { retirePending = { reason: "retire pending" }; }
        }
        let liveness = { running: windows.includes(meta.instance || e.name) };
        if (meta.sessionTarget) {
          try { const state = inspectHerdr({ ...meta.sessionTarget, binary: "herdr" }); liveness = { running: state.present, runtimeState: state.status }; }
          catch (error) { liveness = { running: null, runtimeState: "unreachable", runtimeError: error.message }; }
        }
        const identity = servedIdentityOf(meta);
        // The home IS the directory enumerated here, and the instance its name:
        // a file inside it cannot relocate or rename itself in the roster (every
        // consumer acting on `home` — retire, inspect --home, the Desktop's file
        // roots — would inherit the claim). A disagreeing claim survives only as
        // a diagnostic.
        const claims = {
          ...(meta.home !== undefined && meta.home !== home ? { recordedHome: meta.home } : {}),
          ...(meta.instance !== undefined && meta.instance !== e.name ? { recordedInstance: meta.instance } : {}),
        };
        return { ...meta, ...claims, home, instance: e.name, ...(identity ? { identity } : {}), ...(meta.launch && typeof meta.launch === "object" ? { launch: redactLaunchRecipe(meta.launch) } : {}), ...(typeof meta.command === "string" ? { command: redactLaunchCommand(meta.command) } : {}), ...liveness, ...(rollbackIncomplete ? { rollbackIncomplete } : {}), ...(retirePending ? { retirePending } : {}) };

      });
  };
  // Failed deferred self-retirements leave their outcome beside the home; a
  // successful one is evidence only and is not a problem to surface.
  const readRetireFailuresOf = (agentDir) => {
    const instancesDir = join(agentDir, "instances");
    if (!existsSync(instancesDir)) return [];
    const out = [];
    for (const e of readdirSync(instancesDir, { withFileTypes: true })) {
      const m = e.isFile() && /^\.oats-retired-(.+)\.json$/.exec(e.name);
      if (!m) continue;
      try {
        const r = JSON.parse(readFileSync(join(instancesDir, e.name), "utf8"));
        if (r.ok === false) out.push({ instance: m[1], completedAt: r.completedAt, error: r.error?.message, incomplete: r.result?.rollbackIncomplete, retry: r.retry, resultPath: join(instancesDir, e.name) });
      } catch { out.push({ instance: m[1], error: "unreadable result file", resultPath: join(instancesDir, e.name) }); }
    }
    return out;
  };
  const withFailures = (entry, agentDir) => {
    const retireFailures = readRetireFailuresOf(agentDir);
    return retireFailures.length ? { ...entry, retireFailures } : entry;
  };
  const out = listAgents(root).map((a) => {
    const { _dir, ...soul } = a;
    return withFailures({ ...soul, dir: _dir, instances: readInstancesOf(a._dir) }, a._dir);
  });
  // Capability-defined agents home under <root>/<name>/ WITHOUT a soul there (it
  // lives read-only in the module) — surface their instances too. A soul-less dir
  // none of whose homes is a capability agent's is not one.
  const seen = new Set(out.map((a) => a.name));
  for (const { name, dir } of capabilityAgentDirs(root)) {
    if (seen.has(name)) continue;
    const instances = readInstancesOf(dir);
    const retireFailures = readRetireFailuresOf(dir);
    if (!instances.some((i) => i.kind === "capability") && !retireFailures.length) continue;
    const cap = instances.find((i) => i.capability)?.capability;
    out.push({ name, kind: "capability", capability: cap, description: cap ? `capability agent (${cap})` : "capability agent", dir, instances, ...(retireFailures.length ? { retireFailures } : {}) });
    seen.add(name);
  }
  return out;
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
export function findInstanceHome(root, name) {
  const all = findInstanceHomes(root, name);
  return all.length ? all[0] : undefined;
}

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

/** The quarantine cleanup-descriptor contract version. Bump when the shape the
 * retry consumes changes, so an older/newer marker fails closed instead of
 * driving a retry that cannot do what it claims.
 *
 * The rule applies from the first RELEASE of this shape onward. Markers are only
 * ever written when a `required` spawn hook fails, and required hooks do not
 * exist in any released kernel — so no deployment can hold a marker of an earlier
 * v1 shape, and there is nothing to migrate from. A migration path for a file
 * that has never existed would be dead code claiming to protect real data. */
export const QUARANTINE_CLEANUP_VERSION = 1;
/** The rollback-owned Git steps a quarantine can still owe. */
export const QUARANTINE_GIT_DEBT = ["worktree", "branch"];

// A substituted/missing home cannot hold its own receipt. This sibling fallback
// is independent of both home bytes and the recovery storage that may have failed.
function directoryRollbackPath(home) {
  return join(dirname(home), `.oats-directory-rollback-${basename(home)}.json`);
}

function assertDirectoryHome(home, canonicalHome = realPathOrNearest(home)) {
  let st;
  try { st = lstatSync(home); } catch { /* fail closed below */ }
  if (!st?.isDirectory() || st.isSymbolicLink() || realpathSync(home) !== canonicalHome) {
    throw oatsError("E_WORK_INSPECTION_FAILED", `directory instance home was removed or exchanged: ${home}; restore the owned home before retrying cleanup`);
  }
}

function assertDirectoryRoots(home, canonicalHome) {
  assertDirectoryHome(home, canonicalHome);
  const work = join(home, "work");
  let st;
  try { st = lstatSync(work); } catch { /* fail closed below */ }
  if (!st?.isDirectory() || st.isSymbolicLink()) {
    throw oatsError("E_WORK_INSPECTION_FAILED", `directory work must remain an owned directory, not missing, a link or another filesystem type: ${work}; restore the owned work root before retrying cleanup`);
  }
}

function directoryIdentity(path) {
  const st = lstatSync(path);
  return { dev: st.dev, ino: st.ino };
}

// Read independently of mutable instance bytes, BEFORE realpath(home), hooks,
// lock creation or backend observation. A metadata mode edit cannot disable it.
function sessionDirectoryGuard(home) {
  let baseline;
  try { baseline = JSON.parse(readFileSync(retirementBaselinePath(home), "utf8")); }
  catch (e) { if (e.code === "ENOENT") return () => {}; throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", "independent session receipt is unreadable"); }
  const expected = join(realPathOrNearest(dirname(home)), basename(home));
  const check = () => {
    if (baseline.directoryWork === true) {
      if (baseline.version !== RETIRE_BASELINE_VERSION || baseline.home !== expected) throw oatsError("E_WORK_INSPECTION_FAILED", "invalid independent directory home authority");
      assertDirectoryRoots(home, expected);
      for (const [name, path] of [["home", home], ["work", join(home, "work")]]) {
        const actual = directoryIdentity(path), recorded = baseline.directoryRoots?.[name];
        if (!recorded || actual.dev !== recorded.dev || actual.ino !== recorded.ino) throw oatsError("E_WORK_INSPECTION_FAILED", `directory ${name} was exchanged; restore the owned root before retrying start`);
      }
    }
    let meta;
    try { meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8")); } catch { return; } // ordinary receipt validation reports this
    if ((meta.work === "directory") !== (baseline.directoryWork === true)) throw oatsError("E_WORK_INSPECTION_FAILED", "directory work mode disagrees with independent session authority");
    if (baseline.executionBinding && (meta.incarnationId !== baseline.incarnationId || canonicalJson(meta.executionBinding ?? null) !== canonicalJson(baseline.executionBinding))) throw oatsError("E_RUNTIME_AUTHORITY_MISMATCH", "captured native baseline differs from current incarnation binding");
  };
  check();
  return check;
}

/** Retain the home and its cleanup receipt when spawn compensation or retirement
 * cannot finish. Keeping the original credentials makes cleanup retryable. */
function quarantineInstanceHome({ home, instance, agent, soulDir, soulId, incomplete, failed, outstandingHooks, outstandingGit, repoAbs, work, branch, resolvedCfg, hookMeta, compensationMeta, launched, tmux, sessionTarget, recordRetirementBaseline = false, reason, directoryPreservation = false, directoryHome = realPathOrNearest(home) }) {
  const marker = {
      // `reason` is optional and DEFAULTS to the spawn wording, so every existing
      // caller is byte-identical; only a caller that supplies one differs. The
      // quarantine shape is now reached from two events and a fixed "spawn"
      // string mislabelled the retire one (reviewer nit on 5c8b724).
      instance, agent: agent.name, reason: reason || "spawn rolled back and compensation did not complete",
      // Capability/hook names and cleanup diagnostics only — never hook output.
      failed, incomplete, retainedFor: "credentials/metadata needed to retry cleanup",
      // What the failed compensation reported, kept OUT of the cleanup
      // descriptor so it can never displace the spawn metadata a retry needs.
      ...(compensationMeta && Object.keys(compensationMeta).length ? { compensationReported: compensationMeta } : {}),
      cleanup: {
        version: QUARANTINE_CLEANUP_VERSION,
        repo: repoAbs, work, branch, launched, tmux,
        // The soul the spawn's hooks saw (its per-commit directory and stable id):
        // a retry must hand the retire hook the same soul, and a quarantined home's
        // instance.json may be only the pre-hook stub, which records neither.
        ...(typeof soulDir === "string" && soulDir ? { soulDir } : {}),
        ...(typeof soulId === "string" && soulId ? { soulId } : {}),
        ...(sessionTarget ? { sessionTarget } : {}),
        outstanding: { hooks: [...outstandingHooks], git: [...outstandingGit], ...(directoryPreservation ? { directory: true } : {}) },
        capabilityRuntime: (resolvedCfg.capabilities || []).map((cap) => ({
          id: cap.id, layer: cap.layer, level: cap.level, settings: cap.settings,
          hooks: cap.hooks, requiredHooks: cap.requiredHooks, environment: cap.environment, environmentNamespaces: cap.environmentNamespaces,
          missingRequires: cap.missingRequires,
          trust: cap.trust, executable: cap.executable,
        })),
        capabilityMeta: hookMeta || {},
      },
      createdAt: new Date().toISOString(),
  };
  try {
    const path = join(home, ".oats-rollback-incomplete.json");
    if (work === "directory") {
      assertDirectoryHome(home, directoryHome);
      writeJsonAtomic(path, marker, 0o600);
    } else writeFileSync(path, JSON.stringify(marker, null, 2) + "\n");
  } catch {
    if (work === "directory") {
      // Never write through a substituted home (even its metadata paths).
      // The original parent is outside the disposable home; no recovery copy is
      // needed to retain the frozen hook inputs and the cleanup obligations.
      try {
        const path = directoryRollbackPath(directoryHome);
        if (realpathSync(dirname(path)) !== dirname(path)) throw new Error("directory cleanup parent was redirected; refusing to write through it");
        writeJsonAtomic(path, marker, 0o600);
        incomplete.push(`cleanup descriptor retained at ${path}; restore the home before retrying`);
      } catch (fallbackError) { incomplete.push(`cleanup descriptor could not be stored: ${fallbackError.message}`); }
    }
  }
  if (recordRetirementBaseline) {
    try {
      if (work === "directory") assertDirectoryRoots(home, directoryHome);
      writeRetirementBaseline(home, join(home, "work"), work, resolvedCfg.capabilities || [], { launched: launched === true, tmux, sessionTarget });
    } catch (e) {
      incomplete.push(`independent retirement authority: ${e.message}`);
    }
  }
  return ` — rollback INCOMPLETE. The instance home is RETAINED at ${home} because it holds the state needed to finish cleanup; it is not a live instance. Retry with \`oats retire ${instance}\`, then remove it once cleanup succeeds. Outstanding: ${incomplete.join("; ")}`;
}

/** A cleanup descriptor is usable only if it can DRIVE the retry, so it is checked
 * as the strict contract its one producer writes — the rollback above — and to the
 * depth the retry CONSUMES it. Three rounds of review landed on this: validating
 * the outer shape only moved the failure from "unparseable" to "parseable and
 * useless", and every tolerance ("field optional", "array is enough") turned into
 * a retry that resolved nothing, reported no failures, and CLEARED the quarantine
 * — deleting the credential while the external state it was holding survived.
 *
 * Required, because the producer always writes them and the retry needs each one:
 * `version` (the contract), `repo` (resolves capabilities and reruns hooks),
 * `work` + `branch`-when-worktree (the rollback-owned Git steps; an unrecognised
 * mode silently skips them), `capabilityRuntime` (handed to runLifecycleHooks AS
 * the capability set, so it must BE one and must contain every outstanding hook),
 * and `outstanding.hooks` (what the retry has to prove it reran).
 *
 * Anything else reads as ABSENT — no more retryable than a missing marker — so the
 * home fails closed by default and `--force` can clear it. */
function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
function nonEmptyString(v) { return typeof v === "string" && !!v.trim(); }
function usableCleanupDescriptor(marker) {
  const c = marker?.cleanup;
  if (!isPlainObject(c)) return false;
  if (c.version !== QUARANTINE_CLEANUP_VERSION) return false;
  if (!nonEmptyString(c.repo)) return false;
  if (!WORK_MODES.includes(c.work)) return false;
  if (c.work === "worktree" && !nonEmptyString(c.branch)) return false;
  if (c.branch !== undefined && !nonEmptyString(c.branch)) return false;
  if (c.capabilityMeta !== undefined && !isPlainObject(c.capabilityMeta)) return false;
  const directoryDebt = c.outstanding?.directory === true && c.work === "directory";
  if (c.outstanding?.directory !== undefined && !directoryDebt) return false;
  if (!Array.isArray(c.capabilityRuntime) || (!c.capabilityRuntime.length && !directoryDebt)) return false;
  if (!c.capabilityRuntime.every((cap) => isPlainObject(cap) && nonEmptyString(cap.id))) return false;
  if (!isPlainObject(c.outstanding) || !Array.isArray(c.outstanding.hooks) || !Array.isArray(c.outstanding.git)) return false;
  if (!c.outstanding.hooks.every(nonEmptyString)) return false;
  if (!c.outstanding.git.every((g) => QUARANTINE_GIT_DEBT.includes(g))) return false;
  // Git debt only exists where the rollback owns Git steps, so claiming it in any
  // other work mode describes a quarantine that could not have happened.
  if (c.outstanding.git.length && c.work !== "worktree") return false;
  // The decisive invariant: a quarantine with NOTHING outstanding is a proof
  // obligation of zero. Directory preservation is also real debt: the retry's
  // independent-authority inspection and verified snapshots must succeed even
  // when no capability has a retire hook. It is never a Git/shared-work escape.
  if (!c.outstanding.hooks.length && !c.outstanding.git.length && !directoryDebt) return false;
  // The retry must be ABLE to rerun what it must prove: an outstanding hook whose
  // capability is not in the set could never run, so the quarantine would never
  // clear — and the home would be unremovable without --force.
  const known = new Set(c.capabilityRuntime.map((cap) => cap.id));
  if (!c.outstanding.hooks.every((id) => known.has(id))) return false;
  return true;
}

const RETIRE_BASELINE_VERSION = 2;

function retirementStateRoot(home) {
  // Independent of the bytes it authenticates, but colocated with the agent's
  // already instance-owned storage rather than the source repository or user
  // config home. Retiring <instances>/<name> never removes this sibling.
  return join(dirname(home), ".oats-retirement");
}

function retirementKey(home) {
  return createHash("sha256").update(join(realPathOrNearest(dirname(home)), basename(home))).digest("hex");
}

function retirementBaselinePath(home) {
  return join(retirementStateRoot(home), "baselines", `${retirementKey(home)}.json`);
}

/** git's output for a large tree (status with untracked and ignored files,
 *  the index listing, a large blob) easily exceeds Node's 1 MiB default child
 *  buffer; the spawn then dies with ENOBUFS and retirement reports the
 *  recovery as unverifiable (cjr, ~9500 tracked long paths). Every git call
 *  on the retirement path gets this bound instead. It raises the practical
 *  limit, it does not remove it: a single blob over 512 MiB would still fail,
 *  loudly, and streaming is deliberately not attempted in this change. */
const GIT_MAX_BUFFER = 512 * 1024 * 1024;

/** Kernel-owned receipts the kernel itself appends to a home after the spawn
 *  baseline (events log, stop/restart receipts). They are evidence about the
 *  instance, not the instance's work, so a retirement fingerprint ignores them —
 *  otherwise every stop or event write would read as "changed home bytes". */
const KERNEL_HOME_RECEIPTS = new Set([".oats-events.jsonl", ".oats-stop.json", ".oats-stop-receipt.json", ".oats-restart.json"]);
const KERNEL_HOME_RECEIPT_PATTERNS = [/^\.oats-stop-receipt\..+\.json$/, /^\.oats-agents-md\..+\.previous$/];
function fingerprintTree(root, { excludeRoot = new Set(), excludeGitMetadata = false, instanceHome = false } = {}) {
  const hash = createHash("sha256");
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory()) {
    hash.update(String(rootStat.mode & 0o7777)); hash.update("\0");
    if (rootStat.isSymbolicLink()) { hash.update("link\0"); hash.update(readlinkSync(root)); }
    else if (rootStat.isFile()) { hash.update("file\0"); hash.update(readFileSync(root)); }
    else throw oatsError("E_WORK_INSPECTION_FAILED", `${root} has an unsupported filesystem type`);
    return `sha256:${hash.digest("hex")}`;
  }
  const walk = (dir, rel = "") => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if ((!rel && excludeRoot.has(e.name)) || (instanceHome && !rel && (KERNEL_HOME_RECEIPTS.has(e.name) || KERNEL_HOME_RECEIPT_PATTERNS.some((p) => p.test(e.name)))) || (excludeGitMetadata && e.name === ".git")) continue;
      const childRel = rel ? join(rel, e.name) : e.name;
      const path = join(dir, e.name);
      const st = lstatSync(path);
      hash.update(childRel); hash.update("\0"); hash.update(String(st.mode & 0o7777)); hash.update("\0");
      if (st.isSymbolicLink()) { hash.update("link\0"); hash.update(readlinkSync(path)); hash.update("\0"); }
      else if (st.isFile()) { hash.update("file\0"); hash.update(instanceHome && !rel && e.name === "instance.json" ? kernelNeutralInstanceJson(readFileSync(path)) : readFileSync(path)); /* kernel-field neutrality applies ONLY when the tree IS an instance home; a work tree's instance.json is the agent's bytes */ hash.update("\0"); }
      else if (st.isDirectory()) { hash.update("dir\0"); walk(path, childRel); }
      else throw oatsError("E_WORK_INSPECTION_FAILED", `${path} has an unsupported filesystem type`);
    }
  };
  walk(root);
  return `sha256:${hash.digest("hex")}`;
}

/** The ref a worktree actually has checked out: `{branch, oid}` with
 *  `branch === null` when HEAD is detached. Recovery derives truth from the
 *  object, never from spawn-time metadata. */
function worktreeRef(work) {
  const oid = execFileSync("git", ["-C", work, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_MAX_BUFFER }).trim();
  let branch = null;
  try { branch = execFileSync("git", ["-C", work, "symbolic-ref", "--quiet", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_MAX_BUFFER }).trim() || null; } catch { branch = null; }
  return { branch, oid };
}
function worktreeStatus(repo) {
  try {
    return execFileSync("git", ["-C", repo, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching", "--ignore-submodules=none"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] , maxBuffer: GIT_MAX_BUFFER });
  } catch (e) {
    throw oatsError("E_WORK_INSPECTION_FAILED", `could not inspect instance worktree: ${String(e.stderr ?? e.message ?? "").trim() || "git status failed"}`);
  }
}

/** `git status --porcelain=v1 -z` as Map<path, XY>; a rename/copy row names its source (`R  ← old`). */
function statusRows(z) {
  const rows = new Map(), parts = z.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const row = parts[i];
    if (!row) continue;
    const xy = row.slice(0, 2), path = row.slice(3);
    rows.set(path, xy[0] === "R" || xy[0] === "C" ? `${xy} ← ${parts[++i]}` : xy);
  }
  return rows;
}
const STATUS_DISAGREEMENT_CAP = 10;
/** Where two statuses disagree, by path: { rows: [{ path, source, recovery }] (null = absent; sorted, the
 *  first `cap`), total }. What E_WORK_PRESERVATION_FAILED shows, so an operator sees `!! .scratch/` against
 *  an absent row directly. */
export function statusDisagreement(sourceStatus, recoveredStatus, cap = STATUS_DISAGREEMENT_CAP) {
  const a = statusRows(sourceStatus), b = statusRows(recoveredStatus);
  const paths = [...new Set([...a.keys(), ...b.keys()])].filter((p) => a.get(p) !== b.get(p)).sort();
  return { rows: paths.slice(0, cap).map((path) => ({ path, source: a.get(path) ?? null, recovery: b.get(path) ?? null })), total: paths.length };
}
/** Refuse a recovery whose Git status is not the source's, naming the differing rows (capped). */
function assertStatusAgrees(source, recovered, what, repo) {
  const sourceStatus = worktreeStatus(source), recoveredStatus = worktreeStatus(recovered);
  if (sourceStatus === recoveredStatus) return;
  const diff = statusDisagreement(sourceStatus, recoveredStatus);
  const shown = diff.rows.map((r) => `${r.path} (source ${r.source ?? "absent"}, recovery ${r.recovery ?? "absent"})`).join("; ");
  const more = diff.total > diff.rows.length ? `; and ${diff.total - diff.rows.length} more` : "";
  throw Object.assign(new Error(`${what}${shown ? `: ${shown}${more}` : ""}`), { statusDisagreement: { repo, ...diff } });
}

function generatedWorkFingerprint(work, status, disposableRoots = []) {
  const owned = (path) => disposableRoots.some((root) => path === root || path.startsWith(`${root}${sep}`));
  const paths = status.split("\0").filter(Boolean)
    .filter((row) => row.startsWith("?? ") || row.startsWith("!! "))
    .map((row) => row.slice(3)).filter((path) => !owned(path)).sort();
  const hash = createHash("sha256");
  for (const rel of paths) {
    const path = join(work, rel);
    hash.update(rel); hash.update("\0");
    if (!existsSync(path)) { hash.update("missing\0"); continue; }
    hash.update(fingerprintTree(path)); hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function retirementDisposableRoots(work, capabilities) {
  const receipts = [
    ...capabilities.flatMap((cap) => (cap.retirement?.disposable?.work || []).map((root) => ({ owner: cap.id, root }))),
  ];
  const roots = [];
  for (const receipt of receipts) {
    if (typeof receipt.root !== "string" || !receipt.root || isAbsolute(receipt.root)) throw new Error(`retirement disposable root from ${receipt.owner} must be relative`);
    const normalized = receipt.root.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
    if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new Error(`unsafe retirement disposable root from ${receipt.owner}: ${receipt.root}`);
    const path = join(work, normalized);
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`retirement disposable root from ${receipt.owner} is a symlink: ${normalized}`);
    if (roots.some((r) => normalized === r.root || normalized.startsWith(`${r.root}/`) || r.root.startsWith(`${normalized}/`))) throw new Error(`overlapping retirement disposable roots: ${normalized}`);
    roots.push({ owner: receipt.owner, root: normalized });
  }
  return roots;
}

/** The fields the KERNEL writes into a home's instance.json after the spawn's
 *  retirement baseline was taken (completion marker, wake record). The
 *  baseline fingerprint hashes instance.json with exactly these removed, so a
 *  kernel write does not read as the agent's change — and NOTHING ELSE in the
 *  home is ever re-blessed: an agent's STATE.md written seconds after launch
 *  is still recovered at retire. (Replaces a whole-home re-stamp that could
 *  bless authored bytes written in the launch→completion interval.) */
const KERNEL_POST_SPAWN_FIELDS = ["spawnCompleted", "wake"];
function kernelNeutralInstanceJson(bytes) {
  try {
    const m = JSON.parse(String(bytes));
    if (!m || typeof m !== "object" || Array.isArray(m)) return bytes;
    for (const k of KERNEL_POST_SPAWN_FIELDS) delete m[k];
    return Buffer.from(JSON.stringify(m));
  } catch { return bytes; }
}
function writeRetirementBaseline(home, work, mode, capabilities, runtime, { exclusive = false, incarnationId, executionBinding } = {}) {
  if (mode === "directory") assertDirectoryRoots(home);
  const isWorktree = mode === "worktree";
  const status = isWorktree && existsSync(work) ? worktreeStatus(work) : "";
  const disposableReceipts = isWorktree ? retirementDisposableRoots(work, capabilities) : [];
  const baseline = {
    version: RETIRE_BASELINE_VERSION,
    ...(incarnationId ? { incarnationId, executionBinding } : {}),
    ...(mode === "directory" ? { directoryWork: true, directoryRoots: { home: directoryIdentity(home), work: directoryIdentity(work) } } : {}),
    home: realPathOrNearest(home),
    homeFingerprint: fingerprintTree(home, { excludeRoot: new Set(["work"]), instanceHome: true }),
    disposableReceipts,
    generatedWorkFingerprint: isWorktree ? generatedWorkFingerprint(work, status, disposableReceipts.map((r) => r.root)) : undefined,
    runtime: {
      launched: runtime?.launched === true,
      ...(runtime?.tmux ? { tmux: { session: runtime.tmux.session, window: runtime.tmux.window, ...(runtime.tmux.socket ? { socket: resolve(runtime.tmux.socket) } : {}) } } : {}),
      ...(runtime?.sessionTarget ? { sessionTarget: runtime.sessionTarget } : {}),
    },
  };
  const path = retirementBaselinePath(home);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(baseline, null, 2) + "\n", { mode: 0o600, ...(exclusive ? { flag: "wx" } : {}) });
}

function nestedGitRoots(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.isSymbolicLink?.()) continue;
      const path = join(dir, e.name);
      if (existsSync(join(path, ".git"))) { out.push(path); continue; }
      walk(path);
    }
  };
  walk(root);
  return out;
}

function branchOnlyCommits(repo, branch) {
  if (!repo || !branch) return [];
  const target = `refs/heads/${branch}`;
  try {
    execFileSync("git", ["-C", repo, "rev-parse", "--verify", "--quiet", target], { stdio: ["ignore", "pipe", "pipe"] , maxBuffer: GIT_MAX_BUFFER });
  } catch (e) {
    const detail = String(e.stderr ?? "").trim();
    // A quarantine retry may follow a successful rollback-owned branch removal.
    // Git's quiet exit 1 is authoritative absence, not an inspection failure.
    if (e.status === 1 && !detail) return null;
    throw oatsError("E_WORK_INSPECTION_FAILED", `could not inspect local branch reachability: ${detail || String(e.message ?? "").trim() || "git ref probe failed"}`);
  }
  try {
    const refs = execFileSync("git", ["-C", repo, "for-each-ref", "--format=%(refname)"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] , maxBuffer: GIT_MAX_BUFFER })
      .split("\n").filter((ref) => ref && ref !== target);
    return execFileSync("git", ["-C", repo, "rev-list", target, ...(refs.length ? ["--not", ...refs] : [])], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_MAX_BUFFER }).trim().split("\n").filter(Boolean);
  } catch (e) {
    throw oatsError("E_WORK_INSPECTION_FAILED", `could not inspect local branch reachability: ${String(e.stderr ?? e.message ?? "").trim() || "git ref probe failed"}`);
  }
}

function runtimeAuthorityOf(baseline) {
  const runtime = baseline?.runtime;
  if (!isPlainObject(runtime) || typeof runtime.launched !== "boolean") return undefined;
  if (!runtime.launched) return { launched: false };
  if (runtime.sessionTarget !== undefined) {
    if (runtime.tmux || !validHerdrTarget(runtime.sessionTarget)) return undefined;
    return { launched: true, sessionTarget: runtime.sessionTarget };
  }
  const tmux = runtime.tmux;
  if (!isPlainObject(tmux) || ![tmux.session, tmux.window, tmux.socket].every((v) => typeof v === "string" && v.length > 0)) return undefined;
  return { launched: true, tmux: { session: tmux.session, window: tmux.window, socket: resolve(tmux.socket) } };
}

/** Session control uses the independent endpoint receipt. */
function instanceSessionTarget(home) {
  if (typeof home !== "string" || !isAbsolute(home)) throw oatsError("E_BAD_ARGS", "session needs an absolute instance home");
  home = realPathOrNearest(home);
  let baseline, meta;
  try {
    baseline = JSON.parse(readFileSync(retirementBaselinePath(home), "utf8"));
    meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  } catch (e) { throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `cannot read session receipt for ${home}: ${e.message}`); }
  const authority = baseline.version === RETIRE_BASELINE_VERSION && baseline.home === home && runtimeAuthorityOf(baseline);
  if (!authority) throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `independent session receipt is missing or invalid for ${home}`);
  const endpointAgrees = authority.sessionTarget
    ? !meta.tmux && ["backend", "binary", "socket", "workspaceId", "paneId", "terminalId", "protocol"].every((key) => meta.sessionTarget?.[key] === authority.sessionTarget[key])
    : !meta.sessionTarget && meta.tmux?.session === authority.tmux?.session && meta.tmux?.window === authority.tmux?.window && resolve(meta.tmux?.socket || ".") === authority.tmux?.socket;
  if (meta.launched !== authority.launched || (authority.launched && !endpointAgrees)) throw oatsError("E_RUNTIME_AUTHORITY_MISMATCH", "instance metadata disagrees with independent session receipt");
  return { home, target: authority.launched ? authority.sessionTarget || { backend: "tmux", ...authority.tmux } : undefined };
}

export function inspectInstanceSession(home) {
  if (typeof home === "string" && isAbsolute(home) && !existsSync(home)) return { home: realPathOrNearest(home), backend: null, present: false, state: "stopped" };
  const s = instanceSessionTarget(home);
  if (!s.target) return { home: s.home, backend: null, present: false, state: "not-launched" };
  try { return { home: s.home, ...inspectSessionTarget(s.target) }; }
  catch (e) { throw oatsError("E_SESSION_UNAVAILABLE", `cannot inspect session: ${e.message}`); }
}

/** K3: quiesce one instance's session and RETAIN everything else — home,
 *  worktree, transcript, launch configuration — so `restart` can bring it back.
 *  Exactly restart's stop half under the same independent endpoint authority
 *  (`instanceSessionTarget`), bounded and never escalated: a harness still
 *  there after the grace is reported still running, nothing is killed harder.
 *  A no-launch or already-idle instance is a no-op that says so. */
function tmuxServerLost(e) { return /no server running on |(?:error connecting to|failed to connect to) .*(?:No such file or directory|Connection refused)/i.test(String(e.stderr ?? e.message ?? "")); }
export function stopInstanceSession(home, o = {}) {
  if (typeof home !== "string" || !isAbsolute(home)) throw oatsError("E_BAD_ARGS", "session stop needs an absolute instance home");
  if (o.graceMs !== undefined && (!Number.isSafeInteger(o.graceMs) || o.graceMs < 1 || o.graceMs > 300000)) throw oatsError("E_BAD_ARGS", "stop grace must be 1-300000 ms");
  const realHome = realPathOrNearest(home);
  if (existsSync(retirePendingMarkerPath(realHome))) throw oatsError("E_INSTANCE_RETIRING", `${basename(realHome)} is being retired; nothing was stopped`);
  const s = instanceSessionTarget(realHome);
  if (!s.target) return { home: s.home, backend: null, stopped: false, alreadyIdle: true, state: "not-launched", receipt: null };
  let before;
  try { before = inspectSessionTarget(s.target); }
  catch (e) { if (s.target.backend === "tmux" && tmuxServerLost(e)) before = { present: false, state: "stopped" }; else throw oatsError("E_SESSION_UNAVAILABLE", `cannot establish whether ${basename(realHome)} is running, so nothing was stopped: ${e.message}`); }
  if (!before.present || before.state === "shell" || before.state === "stopped") return { home: s.home, backend: s.target.backend, stopped: false, alreadyIdle: true, state: before.state, receipt: null };
  const receipt = stopHarness(s.target, { graceMs: o.graceMs ?? 20000, kill: o.io?.kill, sleep: o.io?.sleep });
  writeJsonAtomic(join(realHome, ".oats-stop.json"), { instance: basename(realHome), at: new Date().toISOString(), stop: receipt, retained: ["home", "work", "transcript", "launch"] });
  appendEvent(realHome, { kind: receipt.exited ? "stopped" : "stop-refused", data: { signal: receipt.signal, waitedMs: receipt.waitedMs, stillRunning: receipt.stillRunning ?? [], state: receipt.state } });
  if (!receipt.exited) throw Object.assign(oatsError("E_SESSION_STOP_FAILED", `${basename(realHome)} was asked to stop (${receipt.signal} to ${receipt.requested.map((r) => `${r.comm} pid ${r.pid}`).join(", ")}) and is still running after ${receipt.waitedMs} ms; nothing was escalated`), { receipt });
  return { home: s.home, backend: s.target.backend, stopped: true, alreadyIdle: false, state: receipt.state, receipt };
}

export async function attachInstanceSession(home) {
  const s = instanceSessionTarget(home);
  if (!s.target) throw oatsError("E_SESSION_NOT_RUNNING", "instance was not launched");
  return attachSessionTarget(s.target);
}

export function inputInstanceSession(home, text) {
  if (typeof text !== "string" || !text.trim() || text.includes("\0") || Buffer.byteLength(text) > 256 * 1024) throw oatsError("E_BAD_ARGS", "session input must be nonempty text without NUL, at most 256 KiB");
  const s = instanceSessionTarget(home);
  if (!s.target) throw oatsError("E_SESSION_NOT_RUNNING", "instance was not launched");
  try { return { home: s.home, ...inputSessionTarget(s.target, text) }; }
  catch (e) { throw oatsError("E_SESSION_INPUT_FAILED", `cannot submit session input: ${e.message}`); }
}

// ---------------------------------------------------------------- session start

/** The exact prompt token spawn renders for claude and codex launches. */
const LAUNCH_PROMPT_TOKEN = '"$(cat TASK.md)"';

/** Tokenize a persisted OATS launch command. The grammar is exactly what
 *  spawn renders: space-separated tokens that are env assignments NAME='v',
 *  single-quoted words ('...' with '\'' escapes, i.e. shq output), bare words
 *  with no shell metacharacters (flags and capability launch args), the bare
 *  `--` separator, or the exact prompt token "$(cat TASK.md)". Anything else
 *  is refused with its position: the command was not one OATS
 *  generated, and rewriting it would be guessing. Re-rendering joins the
 *  tokens' original text, so untouched tokens are byte-identical. */
export function parseLaunchCommand(command) {
  if (typeof command !== "string" || !command.trim() || command.includes("\0")) throw oatsError("E_LAUNCH_COMMAND_UNSUPPORTED", "instance has no valid persisted launch command to start from");
  const bad = (at, why) => { throw oatsError("E_LAUNCH_COMMAND_UNSUPPORTED", `persisted launch command is not a shape this kernel re-renders (${why} at offset ${at}); inspect the saved command in instance.json before starting this home manually`); };
  const tokens = [];
  const n = command.length;
  let i = 0;
  while (i < n) {
    if (command[i] === " ") { i++; continue; }
    const start = i;
    if (command.startsWith(LAUNCH_PROMPT_TOKEN, i)) {
      i += LAUNCH_PROMPT_TOKEN.length;
      if (i < n && command[i] !== " ") bad(start, "text glued to the prompt token");
      tokens.push({ kind: "prompt", text: LAUNCH_PROMPT_TOKEN });
      continue;
    }
    // NAME="$SOURCE": an environment reference, resolved on the execution
    // host when the command runs; the persisted command carries no value.
    const ref = /^([A-Za-z_][A-Za-z0-9_]*)="\$([A-Za-z_][A-Za-z0-9_]*)"(?= |$)/.exec(command.slice(i));
    if (ref) { tokens.push({ kind: "envref", name: ref[1], source: ref[2], text: ref[0] }); i += ref[0].length; continue; }
    let envName;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)='/.exec(command.slice(i));
    if (m) { envName = m[1]; i += envName.length + 1; }
    if (command[i] === "'") {
      i++;
      let value = "";
      for (;;) {
        if (i >= n) bad(start, "unterminated single quote");
        if (command[i] === "'") {
          if (command.startsWith("'\\''", i)) { value += "'"; i += 4; continue; }
          i++; break;
        }
        value += command[i++];
      }
      if (i < n && command[i] !== " ") bad(start, "text glued to a quoted token");
      const text = command.slice(start, i);
      tokens.push(envName ? { kind: "env", name: envName, value, text } : { kind: "word", value, quoted: true, text });
      continue;
    }
    if (envName) bad(start, "unquoted env value");
    while (i < n && command[i] !== " ") {
      if (/[\s'"$`\\;|&<>(){}*?~#]/.test(command[i])) bad(start, "shell metacharacter outside quotes");
      i++;
    }
    const word = command.slice(start, i);
    tokens.push(word === "--" ? { kind: "sep", text: word } : { kind: "word", value: word, quoted: false, text: word });
  }
  let binary = -1;
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k].kind === "env" || tokens[k].kind === "envref") { if (binary >= 0) bad(0, "env assignment after the binary"); continue; }
    if (binary < 0) { if (tokens[k].kind !== "word" || !tokens[k].quoted) bad(0, "no quoted binary after the env prefix"); binary = k; }
  }
  if (binary < 0) bad(0, "no binary");
  let modelIndex = -1;
  for (let k = binary + 1; k < tokens.length; k++) {
    if (tokens[k].kind === "sep") break;
    if (tokens[k].kind === "word" && !tokens[k].quoted && tokens[k].value === "--model") {
      const v = tokens[k + 1];
      if (!v || v.kind !== "word" || v.value.startsWith("-")) bad(0, "--model without a value");
      if (modelIndex >= 0) bad(0, "duplicate --model options");
      modelIndex = k + 1;
      k++;
    }
  }
  return { tokens, binary, modelIndex };
}

export function renderLaunchCommand(tokens) { return tokens.map((t) => t.text).join(" "); }

/** The persisted command with `model` as its --model value: an existing
 *  --model value is replaced; otherwise the pair is inserted right after the
 *  binary, before any option that could be waiting for a value. Capability
 *  env, flags, launch args and the prompt expression are untouched. */
export function withLaunchModel(command, model) {
  const { tokens, binary, modelIndex } = parseLaunchCommand(command);
  const valueToken = { kind: "word", value: model, quoted: true, text: shq(model) };
  if (modelIndex >= 0) tokens[modelIndex] = valueToken;
  else tokens.splice(binary + 1, 0, { kind: "word", value: "--model", quoted: false, text: "--model" }, valueToken);
  return renderLaunchCommand(tokens);
}

function tmuxOn(socket, args, io) {
  return (io?.exec || execFileSync)("tmux", ["-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

function writeJsonAtomic(path, value, mode) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", mode !== undefined ? { mode } : undefined);
  renameSync(tmp, path);
}

// ---------- stopping a harness, selecting on an existing home ----------
const SHELL_NAMES = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "tcsh", "csh", "login"]);
/** The harness processes under a session target: for tmux EVERY descendant
 *  of the pane's launcher process (the launcher shell itself is left so
 *  that, once its command ends, it becomes the fallback shell the start
 *  path recognizes); a wrapper that does not exec the harness, the harness
 *  and their children are all included, topmost first. For Herdr the
 *  pane's foreground processes. Each row: { pid, ppid, pgid, comm, depth }. */
export function harnessProcesses(target, io) {
  const ps = () => ((io?.exec || execFileSync)("ps", ["-axo", "pid=,ppid=,pgid=,comm="], { encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }))
    .split("\n").map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean)
    .map(([, pid, ppid, pgid, comm]) => ({ pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), comm: basename(comm).replace(/^-/, "") }));
  if (target.backend === "herdr") {
    // Herdr's PaneProcessInfo (installed schema: shell_pid, nullable;
    // foreground_process_group_id; foreground_processes) names the pane's
    // shell. That pid, verified against this host, is the root: OATS launched
    // `exec /bin/sh -c <command>` in it, so the root is the launcher shell
    // and the harness its child, exactly as under tmux; a root whose exec
    // replaced it with a non-shell IS the harness and is included. Without a
    // shell_pid, the verified non-shell foreground processes are the roots.
    // Never a fabricated row: an unverifiable pid refuses before any signal.
    const info = herdrCommand(target, ["pane", "process-info", "--pane", target.paneId], io).process_info;
    if (!info || typeof info !== "object") throw oatsError("E_SESSION_UNKNOWN", "Herdr returned no process information for the pane");
    const rows = ps();
    const byParent = new Map();
    for (const r of rows) { if (!byParent.has(r.ppid)) byParent.set(r.ppid, []); byParent.get(r.ppid).push(r); }
    const out = [];
    const walk = (pid, depth) => { for (const child of byParent.get(pid) || []) { if (!out.some((o) => o.pid === child.pid)) { out.push({ ...child, depth }); walk(child.pid, depth + 1); } } };
    const verified = (pid, what) => {
      if (!Number.isInteger(pid) || pid <= 0) throw oatsError("E_SESSION_UNKNOWN", `Herdr reported ${what} without a verifiable pid; nothing was signalled`);
      const row = rows.find((r) => r.pid === pid);
      if (!row) throw oatsError("E_SESSION_UNKNOWN", `Herdr reports ${what} pid ${pid} but this host has no such process; nothing was signalled`);
      return row;
    };
    if (info.shell_pid !== null && info.shell_pid !== undefined) {
      const root = verified(info.shell_pid, "the pane shell");
      if (!SHELL_NAMES.has(root.comm)) out.push({ ...root, depth: 0 });
      walk(root.pid, 1);
      return out;
    }
    if (!Array.isArray(info.foreground_processes)) throw oatsError("E_SESSION_UNKNOWN", "Herdr returned neither a pane shell pid nor foreground processes");
    for (const p of info.foreground_processes) {
      const row = verified(p.pid, `foreground process ${p.name || "?"}`);
      if (SHELL_NAMES.has(row.comm)) { walk(row.pid, 1); continue; }
      if (!out.some((o) => o.pid === row.pid)) { out.push({ ...row, depth: 0 }); walk(row.pid, 1); }
    }
    return out;
  }
  const row = tmuxOn(target.socket, ["list-panes", "-t", `=${target.session}:=${target.window}`, "-F", "#{pane_pid}"], io).trim().split("\n")[0];
  if (!/^\d+$/.test(row || "")) throw oatsError("E_SESSION_UNKNOWN", "tmux returned no pane process id");
  const panePid = Number(row);
  const rows = ps();
  const byParent = new Map();
  for (const r of rows) { if (!byParent.has(r.ppid)) byParent.set(r.ppid, []); byParent.get(r.ppid).push(r); }
  const out = [];
  const walk = (pid, depth) => { for (const child of byParent.get(pid) || []) { out.push({ ...child, depth }); walk(child.pid, depth + 1); } };
  walk(panePid, 1);
  return out;
}
/** Ask the harness under `target` to end: SIGTERM to every process found
 *  under the pane's launcher, one by one, topmost first (no process-group
 *  signalling: the launcher shell must survive to become the fallback
 *  shell), then a bounded wait for the signalled processes to be gone and
 *  the session to read as stopped or a bare shell. Nothing is escalated: a
 *  harness still there when the wait ends is reported as such, still
 *  running. Elapsed time is never taken as exit. */
export function stopHarness(target, { graceMs = 20000, signal = "SIGTERM", io = {}, kill = process.kill, sleep } = {}) {
  const wait = sleep || ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
  // "Already idle" must be a STABLE reading: the shell-vs-harness decision walks
  // `ps`, which under load can miss a just-forked descendant for one sample.
  // One momentary "shell" must never be taken as exit with nothing signalled.
  const idle = (s) => !s.present || s.state === "shell" || s.state === "stopped";
  let before = inspectSessionTarget(target, io);
  if (idle(before)) { wait(250); const again = inspectSessionTarget(target, io); if (idle(again)) return { requested: [], signal, sentAt: null, observedAt: new Date().toISOString(), exited: true, waitedMs: 0, state: again.state, stillRunning: [] }; before = again; }
  const procs = harnessProcesses(target, io);
  if (!procs.length) throw oatsError("E_SESSION_UNKNOWN", `the session reads as ${before.state} but no harness process was found under its pane; nothing was signalled`);
  const requested = [];
  const sentAt = new Date().toISOString();
  for (const r of procs) {
    try { kill(r.pid, signal); requested.push({ pid: r.pid, pgid: r.pgid, comm: r.comm, signal }); }
    catch (e) { if (e.code !== "ESRCH") throw oatsError("E_SESSION_STOP_FAILED", `could not signal ${r.comm} (pid ${r.pid}): ${e.message}`); requested.push({ pid: r.pid, pgid: r.pgid, comm: r.comm, signal, note: "already gone" }); }
  }
  const started = Date.now();
  const alive = (pid) => { try { kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
  let st = before, idleStreak = 0;
  while (Date.now() - started <= graceMs) {
    wait(250);
    try { st = inspectSessionTarget(target, io); } catch { st = { present: true, state: "unknown" }; }
    const gone = requested.every((r) => !alive(r.pid));
    idleStreak = gone && idle(st) ? idleStreak + 1 : 0;
    // Exit needs two consecutive agreeing samples, not one.
    if (idleStreak >= 2) return { requested, signal, sentAt, observedAt: new Date().toISOString(), exited: true, waitedMs: Date.now() - started, state: st.state };
  }
  return { requested, signal, sentAt, observedAt: null, exited: false, waitedMs: Date.now() - started, state: st.state, stillRunning: requested.filter((r) => alive(r.pid)).map((r) => r.pid) };
}

/** Where a home's launch providers' manifests are read: its own module copies
 *  (a workspace-model home), else nowhere. */
function launchManifestDir(home, meta) {
  return home && isWorkspaceHome(meta) ? home : null;
}
/** The providers captured for a home: every recorded capability binding
 *  (meta.capabilityRuntime) united with every recorded contribution's id,
 *  each with its contribution (if it made one) and its captured settings.
 *  Already-recorded metadata; a provider bound to the scope after the spawn
 *  is not in it. */
export function capturedProviders(meta, frozen) {
  const contributions = (frozen?.hooks?.contributions || []).filter((c) => c.capability);
  const bindings = Array.isArray(meta?.capabilityRuntime) ? meta.capabilityRuntime : [];
  const ids = [...new Set([...bindings.map((b) => b.id), ...contributions.map((c) => c.capability)])].filter(Boolean);
  return ids.map((id) => {
    const contribution = contributions.find((c) => c.capability === id) || null;
    const binding = bindings.find((b) => b.id === id) || null;
    return { id, contribution, binding, settings: contribution?.settings ?? binding?.settings ?? {} };
  });
}
/** Capability contributions for a start of an existing home: the recorded
 *  ones, refreshed by any capability that declares a `launch` hook (asked
 *  for the target harness; side-effect-free by contract; spawn hooks are
 *  never re-run). A harness change needs the new harness's launch arguments
 *  from every capability that contributed harness-specific ones. */
export function prepareLaunchHooks({ frozen, harness, resolvedCfg, home, meta, contextDir, extraEnv = {}, assertRoots }) {
  const contributions = (frozen.hooks?.contributions || []).map((c) => ({ ...c }));
  const env = { ...(frozen.hooks?.env || {}) };
  const refreshed = [];
  // The providers that took part in this home's launch are the CAPTURED ones
  // (its recorded contributions). Each is resolved by id through the scope's
  // current installed manifest and trust, whatever the scope's bindings say
  // now: a captured provider that is no longer installed, or no longer
  // trusted, refuses the start; a provider bound to the scope after the
  // spawn is never adopted. A captured provider that declares a launch hook
  // prepares the target harness under its CAPTURED settings.
  const ctx = launchManifestDir(home, meta);
  const withLaunchHook = [];
  let hookMeta;
  for (const p of capturedProviders(meta, frozen)) {
    const manifest = ctx ? capabilityManifest(p.id, ctx) : undefined;
    if (!manifest) throw oatsError("E_LAUNCH_PREPARATION", `${p.id} was part of this home's launch at spawn but its module copy is missing from ${join(home, ".oats", "modules")}; respawn the instance; nothing was stopped`);
    const trust = capabilityTrust(manifest);
    if (!trust.trusted) throw oatsError("E_LAUNCH_PREPARATION", `${p.id} was part of this home's launch at spawn but is no longer trusted in the scope (${trust.reason || "not trusted"}); respawn the instance; nothing was stopped`);
    const hooks = manifestHookCommands(manifest);
    if (hooks.launch) withLaunchHook.push({ id: p.id, capability: p.id, manifest, layer: p.contribution?.layer ?? p.binding?.layer ?? manifest.layer ?? null, level: p.contribution?.level ?? p.binding?.level ?? null, settings: p.settings, hooks, trust, environment: [...(manifest.environment || [])], environmentNamespaces: [...(manifest.environmentNamespaces || [])], missingRequires: [] });
  }
  if (withLaunchHook.length) {
    const res = runLifecycleHooks("launch", { assertRoots, home, instance: meta.instance, agentName: meta.agent, soulDir: instanceSoulDir(home, meta), contextDir: ctx, rootDir: dirname(dirname(dirname(home))), resolved: { ...(resolvedCfg || {}), capabilities: withLaunchHook }, priorMeta: meta.capabilityMeta || {}, extraEnv: { OATS_HARNESS: harness, OATS_PREVIOUS_HARNESS: frozen.harness || "", OATS_RUNTIME: harness, OATS_PREVIOUS_RUNTIME: frozen.harness || "", ...extraEnv } });
    const failed = (res.failures || []).map((f) => `${f.capability}: ${f.message}`);
    if (failed.length) throw oatsError("E_LAUNCH_PREPARATION", `a capability could not prepare the ${harness} launch:\n  ${failed.join("\n  ")}`);
    // Ownership holds across retained AND refreshed contributions, as the
    // spawn runner holds it across providers: a refreshed provider may
    // replace its own previous keys, never a key another provider retains.
    const refreshedIds = new Set((res.contributions || []).map((c) => c.capability));
    const retainedOwner = new Map();
    for (const c of contributions) if (c.capability && !refreshedIds.has(c.capability)) for (const name of c.env || []) retainedOwner.set(name, c.capability);
    for (const c of res.contributions || []) for (const name of c.env || []) {
      if (retainedOwner.has(name)) throw oatsError("E_LAUNCH_PREPARATION", `${c.capability}'s launch hook set ${name}, which ${retainedOwner.get(name)} contributed at spawn and retains; one provider owns an environment name; nothing was stopped`);
    }
    for (const c of res.contributions || []) {
      const idx = contributions.findIndex((x) => x.capability === c.capability);
      // The provider's previous contribution goes whole, its env names
      // included, before its new (validated) one is merged: an empty answer
      // is a replacement too.
      for (const name of contributions[idx]?.env || []) delete env[name];
      const row = { ...c, source: "launch-hook" };
      if (idx >= 0) contributions[idx] = row; else contributions.push(row);
      refreshed.push(c.capability);
    }
    Object.assign(env, res.env || {});
    // A launch hook's `meta` is part of its documented return (the same shape
    // spawn persists as capabilityMeta). It was collected and then dropped
    // here, so a provider that re-issues a credential at every start — a
    // renewed session grant, for instance — left the ORIGINAL id on record and
    // retire undid the wrong one. Carry it to the caller; the start records it.
    hookMeta = res.meta && Object.keys(res.meta).length ? res.meta : undefined;
  }
  const unprepared = contributions.filter((c) => !refreshed.includes(c.capability) && c.launch && c.launch[frozen.harness] !== undefined && c.launch[harness] === undefined).map((c) => c.capability);
  if (unprepared.length) throw oatsError("E_LAUNCH_PREPARATION", `${unprepared.join(", ")} contributed ${frozen.harness} launch arguments at spawn and none for ${harness}; change that capability's setting (for example its delivery mode), or the provider must declare a launch hook; nothing was stopped`);
  const launch = {};
  for (const c of contributions) { for (const [rt, args] of Object.entries(c.launch || {})) if (args) launch[rt] = `${launch[rt] ? `${launch[rt]} ` : ""}${args}`; }
  return { launch, env, contributions, refreshed, ...(hookMeta ? { meta: hookMeta } : {}) };
}


export function restartInstanceSession(home, o = {}) { return startInstanceSession(home, { ...o, restart: true }); }
/** Does this instance.json describe a workspace-model home (it records its modules)? */
export function isWorkspaceHome(meta) {
  return !!meta && typeof meta.modules === "object" && meta.modules !== null && !Array.isArray(meta.modules);
}
/** Does this instance.json describe a captured home (the 0.24–0.25 captured/portable path,
 *  removed in 0.26)? It records its incarnation instead of modules. */
export function isCapturedHome(meta) {
  return !!meta && typeof meta === "object" && ["executionBinding", "incarnationId", "captured"].some((key) => Object.hasOwn(meta, key));
}
/** The refusal for a captured home: E_UNSUPPORTED_MODE (lead decisions on (e), D1). */
export function capturedHomeRefusal(home, what) {
  return Object.assign(oatsError("E_UNSUPPORTED_MODE", `${home} is a captured home (0.24–0.25; the captured/portable path was removed in 0.26): it has no 0.26 runtime — retire it (\`oats retire\` still works on it) and re-spawn from the deployment; ${what}`), { details: { home, captured: true } });
}
/** The capabilities whose spawn hooks ran in a captured home (its identities, memberships):
 *  retire cannot run their captured retire hooks, so it names them. */
export function capturedHomeCapabilities(meta) {
  const order = Array.isArray(meta?.captured?.hookOrder) ? meta.captured.hookOrder.filter((id) => typeof id === "string") : [];
  const withMeta = meta?.capabilityMeta && typeof meta.capabilityMeta === "object" ? Object.keys(meta.capabilityMeta) : [];
  return [...new Set([...order, ...withMeta])].sort();
}
/** The refusal for a home an earlier (0.25) kernel spawned: E_UNSUPPORTED_MODE. */
export function preWorkspaceHome(home, what) {
  return oatsError("E_UNSUPPORTED_MODE", `${home} is not a workspace-model home (it records no modules): it was spawned by an earlier kernel — re-spawn it from the deployment (\`oats retire\` still works on it); ${what}`);
}
export function startInstanceSession(home, o = {}) {
  if (typeof home !== "string" || !isAbsolute(home)) throw oatsError("E_BAD_ARGS", "session start needs an absolute instance home");
  if (existsSync(directoryRollbackPath(home))) throw oatsError("E_INSTANCE_RETIRING", `${home} has retained directory cleanup; restore and retire it before starting anything there`);
  const directoryGuard = sessionDirectoryGuard(home);
  {
    let metadata; try { metadata = parseStrictJson(readPortableBytes(join(home, "instance.json"))); } catch { /* the receipt checks below report unreadable metadata */ }
    if (isCapturedHome(metadata)) throw capturedHomeRefusal(home, "nothing was started");
  }
  const checkRoots = directoryGuard;
  const realHome = realPathOrNearest(home);
  let originalHomeIdentity;
  try { originalHomeIdentity = directoryIdentity(realHome); } catch { /* missing home reported below */ }
  const rawIo = o.io;
  const guardedExec = (...args) => { checkRoots(); return (rawIo?.exec || execFileSync)(...args); };
  o = { ...o, io: { ...rawIo, exec: guardedExec, kill: (...args) => { checkRoots(); return (rawIo?.kill || process.kill)(...args); } } };
  const metaPath = join(realHome, "instance.json");
  if (!existsSync(metaPath)) throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `${realHome} is not an OATS instance home (no instance.json); nothing was started`);
  const lock = join(realHome, ".oats-start.lock");
  const pendingPath = join(realHome, ".oats-start-pending.json");
  const exitedPath = join(realHome, ".oats-start-exited");
  const readMeta = () => { try { return upgradeHomeMeta(JSON.parse(readFileSync(metaPath, "utf8")), realHome); } catch (e) { throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `cannot read ${metaPath}: ${e.message}`); } };
  // Workspace-model homes only (lead decision c3 Q2): a home an earlier kernel
  // spawned records no modules, and there is no scope configuration left to
  // re-resolve it against. Retire still works on it.
  if (!isWorkspaceHome(readMeta())) throw preWorkspaceHome(realHome, "nothing was started");
  const lostTmuxServer = tmuxServerLost;
  const launchFailure = (backend, error) => {
    // execFileSync errors embed argv (including capability environment) in
    // message; backend stderr can echo it too. Neither belongs in the API.
    const reason = error.code === "ENOENT" ? "backend executable unavailable"
      : error.code === "ETIMEDOUT" || error.signal === "SIGTERM" ? "backend command timed out" : "backend command failed";
    return oatsError("E_SESSION_START_FAILED", `${backend} start of ${basename(realHome)} could not be confirmed (${reason}); inspect the recorded session before retrying. Launch evidence is retained in ${pendingPath}`);
  };
  // The independent receipt first (retire and session consult it), then the
  // mutable metadata; both tmp+rename. A failure between them is what the
  // pending receipt exists for.
  const record = (meta, { id, backend, target, model, command, startedAt, reused, launch, harness: newHarness, yolo: newYolo, stop, nativeRecordId, hookMeta }, clearPending = true) => {
    checkRoots();
    const baselinePath = retirementBaselinePath(realHome);
    let baseline;
    try { baseline = JSON.parse(readFileSync(baselinePath, "utf8")); } catch (e) { throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `independent session receipt is missing or unreadable for ${realHome}: ${e.message}`); }
    if (baseline.version !== RETIRE_BASELINE_VERSION || baseline.home !== realHome || !runtimeAuthorityOf(baseline)) throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `independent session receipt is invalid for ${realHome}`);
    baseline.runtime = backend === "herdr"
      ? { launched: true, sessionTarget: target }
      : { launched: true, tmux: { session: target.session, window: target.window, socket: resolve(target.socket) } };
    writeJsonAtomic(baselinePath, baseline, 0o600);
    if (o.io?.failBeforeMetadataWrite && reused !== "adopted") throw new Error("injected metadata write failure"); // the write after THIS start's allocation
    const recorded = meta.startId === id;
    const restarts = (Array.isArray(meta.restarts) ? meta.restarts : []).slice(recorded ? -20 : -19);
    if (!recorded) restarts.push({ startedAt, model: model ?? null, reused });
    const next = { ...meta, model, command, launched: true, startId: id, restarts, restartCount: (meta.restartCount || 0) + (recorded ? 0 : 1),
      ...(launch ? { launch } : {}), ...(newHarness ? { harness: newHarness } : {}), ...(newYolo !== undefined ? { yolo: newYolo } : {}),
      // Launch-hook meta lands per capability over the spawn's record; a hook
      // that answered without meta keeps its previous entry (retire reads it).
      ...(hookMeta ? { capabilityMeta: { ...(meta.capabilityMeta || {}), ...hookMeta } } : {}) };
    if (backend === "herdr") { next.sessionTarget = target; delete next.tmux; }
    else { next.tmux = { session: target.session, window: target.window, socket: resolve(target.socket) }; delete next.sessionTarget; }
    writeJsonAtomic(metaPath, next);
    if (clearPending) { checkRoots(); rmSync(pendingPath, { force: true }); }
    return { instance: meta.instance, agent: meta.agent, home: realHome, harness: next.harness, backend, model: model ?? null, launchConfig: next.launch?.launchConfig ?? null, yolo: next.yolo ?? null, target, startedAt, restartCount: next.restartCount, reused, ...(nativeRecordId ? { nativeRecordId } : {}), ...(stop ? { stop } : {}) };
  };
  try { mkdirSync(lock); }
  catch (e) {
    if (e.code === "EEXIST") throw oatsError("E_SESSION_START_BUSY", `another start of ${basename(realHome)} is in progress (${lock}); if no start is running, remove that directory and retry`);
    throw e;
  }
  try {
    if (existsSync(join(realHome, ".oats-rollback-incomplete.json"))) throw oatsError("E_INSTANCE_RETIRING", `${realHome} is a quarantined home whose cleanup is incomplete; finish its retirement (oats retire) before starting anything there`);
    // A self-retirement leaves this marker while its detached teardown runs:
    // the home is about to disappear, so nothing is relaunched into it.
    if (existsSync(retirePendingMarkerPath(realHome))) throw oatsError("E_INSTANCE_RETIRING", `${basename(realHome)} is being retired (${retirePendingMarkerPath(realHome)} is present); nothing was started`);
    // 1. Reconcile a pending receipt before the equality gate: it may be the
    //    only record of a session an earlier start allocated.
    if (existsSync(pendingPath)) {
      let pending;
      try { pending = JSON.parse(readFileSync(pendingPath, "utf8")); } catch { pending = undefined; }
      const pt = pending?.target;
      const validTarget = pt?.backend === "herdr" ? validHerdrTarget(pt)
        : pt?.backend === "tmux" && [pt.session, pt.window, pt.socket].every((v) => typeof v === "string" && v.length > 0) && isAbsolute(pt.socket);
      let validCommand = false;
      try { parseLaunchCommand(pending?.command); validCommand = true; } catch { /* preserve invalid receipt below */ }
      let validLaunch = true;
      if (pending?.launch !== undefined) { try { assertLaunchRecipe(pending.launch, "the pending start"); } catch { validLaunch = false; } }
      if (pending?.harness !== undefined && !LAUNCH_HARNESSES.includes(pending.harness)) validLaunch = false;
      if (pending?.yolo !== undefined && typeof pending.yolo !== "boolean") validLaunch = false;
      const validReceipt = validTarget && validCommand && validLaunch
        && typeof pending.id === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(pending.id)
        && (pending.model === null || (typeof pending.model === "string" && !!pending.model.trim() && !pending.model.includes("\0")))
        && typeof pending.startedAt === "string" && Number.isFinite(Date.parse(pending.startedAt));
      if (!validReceipt) throw oatsError("E_SESSION_UNKNOWN", `an earlier start left an unreadable or invalid receipt at ${pendingPath}; inspect it before retrying; nothing was started`);
      const pbackend = pending.target.backend === "herdr" ? "herdr" : "tmux";
      let st;
      checkRoots();
      try { st = inspectSessionTarget(pending.target, o.io); }
      catch (e) {
        if (pbackend === "tmux" && lostTmuxServer(e)) st = { present: false, state: "stopped" };
        else throw oatsError("E_SESSION_UNKNOWN", `an earlier start of ${basename(realHome)} recorded a session (${pbackend === "herdr" ? `Herdr pane ${pending.target.paneId}` : `tmux ${pending.target.session}:${pending.target.window} on ${pending.target.socket}`}) that cannot be observed now: ${String(e.stderr ?? e.message ?? "").trim() || e.message}; the receipt ${pendingPath} is kept and nothing was started`);
      }
      // A launch may still consist entirely of shells (startup files, a
      // shell-script harness). Only its own completion marker proves this
      // is a fallback shell. Never respawn an accepted launch in that gap.
      if (st.present && st.state === "shell") {
        const exited = existsSync(exitedPath) && readFileSync(exitedPath, "utf8").trim() === pending.id;
        if (!exited) throw oatsError("E_SESSION_START_BUSY", `${basename(realHome)} is still starting; refresh its status before retrying`);
      }
      // Reconcile even an exited target: the independent baseline may
      // already name it while metadata still names the old allocation.
      const meta = readMeta();
      const done = record(meta, { ...pending, backend: pbackend, model: pending.model ?? undefined, reused: "adopted" }, !st.present || st.state === "shell");
      if (st.present && st.state !== "shell") {
        if (o.restart) { rmSync(pendingPath, { force: true }); }
        else {
          // The recovered target runs what the receipt says; a choice made
          // now (model, configuration, harness, yolo) was not applied to it.
          if (o.model != null && String(o.model).trim() && resolveModelPreference(String(o.model), done.harness || meta.harness) !== done.model) throw oatsError("E_SESSION_RUNNING", `${meta.instance} is already running with its previously requested model; its target was recovered, but the new model was not applied`);
          if (o.launchConfig !== undefined || o.harness !== undefined || o.yolo !== undefined) throw oatsError("E_SESSION_RUNNING", `${meta.instance} is already running (its pending start was recovered); the requested launch configuration, harness or yolo was not applied; stop it, or use session restart`);
          if (meta.startId === pending.id) throw oatsError("E_SESSION_RUNNING", `${meta.instance} is already running; nothing was started`);
          return done;
        }
      }
    }
    // 2. The ordinary gate and observation, all under the lock.
    const receipt = instanceSessionTarget(realHome);
    const meta = readMeta();
    const harness = meta.harness;
    if (!["pi", "claude", "codex"].includes(harness)) throw oatsError("E_LAUNCH_COMMAND_UNSUPPORTED", `instance ${meta.instance || realHome} records harness ${JSON.stringify(harness)}, which this kernel cannot relaunch`);
    const backend = meta.sessionTarget || meta.backend === "herdr" ? "herdr" : "tmux";
    let command = meta.command;
    let model = meta.model || undefined;
    // What this start launches: the frozen command (optionally with another
    // model, re-rendered in place), or, under a selection, the recipe
    // re-resolved against the home's current scoped configuration. Every
    // preflight happens here, before anything is observed or stopped.
    const selected = o.launchConfig !== undefined || o.harness !== undefined || o.yolo !== undefined;
    const hasRecipe = meta.launch && typeof meta.launch === "object";
    let launchPlan = null;
    if (selected || hasRecipe) {
      // Every start of a home with a recipe (ordinary, model-only, or under a
      // selection) goes through the one planner: recipe shape, the recorded
      // or selected executable, references, capability contributions under
      // the captured settings and current trust. A home without a recipe that
      // is asked for a selection is refused (E_LAUNCH_LEGACY).
      const context = meta.repo && existsSync(meta.repo) ? resolve(meta.repo) : dirname(dirname(dirname(dirname(realHome))));
      // o.teams: the home's LIVE eligible teams, computed by an async caller (liveTeams) — the
      // launch hook re-checks joined memberships against them (teams contract decision 6).
      const resolvedCfg = resolvedFromHome(realHome, meta, { teams: o.teams, teamsSource: o.teamsSource });
      let agent; try { agent = findAgent(dirname(dirname(dirname(realHome))), meta.agent); } catch { agent = undefined; }
      const plan = planLaunch({ home: realHome, instance: meta.instance, meta, contextDir: context, agentLike: agent || { harness: meta.harness, model: meta.model, yolo: meta.yolo }, selection: { launchConfig: o.launchConfig, harness: o.harness, model: o.model, yolo: o.yolo }, resolvedCfg, env: o.env || process.env, assertRoots: checkRoots });
      launchPlan = { recipe: plan.recipe, command: plan.command, harness: plan.harness, model: plan.model, yolo: plan.yolo, ...(plan.hookMeta ? { hookMeta: plan.hookMeta } : {}) };
      command = launchPlan.command; model = launchPlan.model;
    } else if (o.model !== undefined && o.model !== null && String(o.model).trim() !== "") {
      const resolved = resolveModelPreference(String(o.model), harness);
      if (!resolved) throw oatsError("E_MODEL_UNKNOWN", `model preference ${JSON.stringify(o.model)} has no entry usable by harness ${harness}; give a ${harness} model id`);
      command = withLaunchModel(command, resolved);
      model = resolved;
    } else parseLaunchCommand(command);
    // References recorded for this home must resolve on this host on every
    // start path, and the source variables go to the pane, not the command.
    const recipeForEnv = launchPlan?.recipe || (meta.launch && typeof meta.launch === "object" ? meta.launch : null);
    if (recipeForEnv) { const missing = missingLaunchEnvRefs(recipeForEnv.env, o.env || process.env); if (missing.length) throw oatsError("E_LAUNCH_ENV_MISSING", `this home's launch references ${missing.join(", ")}, not set on this host; nothing was started`); }
    const paneEnv = recipeForEnv ? launchEnvRefs(recipeForEnv, o.env || process.env) : [];
    const paneEnvFlags = paneEnv.flatMap((r) => ["-e", `${r.name}=${r.value}`]);
    const paneEnvExports = paneEnv.map((r) => `export ${r.name}=${shq(r.value)}; `).join("");
    checkRoots(); // launch hooks/preparation have run; no backend has been observed
    const planExtra = launchPlan ? { launch: launchPlan.recipe, harness: launchPlan.harness, yolo: launchPlan.yolo,
      ...(launchPlan.hookMeta ? { hookMeta: launchPlan.hookMeta } : {}) } : {};
    let target = receipt.target;
    let state = { present: false, state: "not-launched" };
    let serverGone = false;
    if (target) {
      try { state = inspectSessionTarget(target, o.io); }
      catch (e) {
        if (backend === "tmux" && lostTmuxServer(e)) { serverGone = true; state = { present: false, state: "stopped" }; }
        else throw oatsError("E_SESSION_UNKNOWN", `cannot establish whether ${meta.instance} is running, so nothing was started: ${String(e.stderr ?? e.message ?? "").trim() || e.message}`);
      }
    }
    let stopReceipt = null;
    if (state.present && state.state !== "shell") {
      if (!o.restart) throw oatsError("E_SESSION_RUNNING", `${meta.instance} is running (${state.state}); nothing was started`);
      // Restart: every preflight above passed, so ask the running harness to
      // end and wait, bounded. A harness still there afterwards is reported
      // as running; nothing is escalated and nothing is launched.
      stopReceipt = stopHarness(target, { graceMs: o.stopGraceMs ?? 20000, io: o.io, kill: o.io?.kill, sleep: o.io?.sleep });
      writeJsonAtomic(join(realHome, ".oats-restart.json"), { instance: meta.instance, at: new Date().toISOString(), stop: stopReceipt, next: { harness: launchPlan?.harness || harness, launchConfig: launchPlan?.recipe?.launchConfig ?? meta.launch?.launchConfig ?? null, model: model ?? null } }, 0o600);
      appendEvent(realHome, { kind: stopReceipt.exited ? "restarted" : "stop-refused", data: { phase: "restart-stop", signal: stopReceipt.signal, waitedMs: stopReceipt.waitedMs, stillRunning: stopReceipt.stillRunning ?? [] } });
      if (!stopReceipt.exited) throw oatsError("E_SESSION_STOP_FAILED", `${meta.instance} was asked to stop (${stopReceipt.signal} to ${stopReceipt.requested.map((r) => `${r.comm} pid ${r.pid}`).join(", ")} at ${stopReceipt.sentAt}) and was still running after ${stopReceipt.waitedMs} ms (${stopReceipt.state}); nothing was escalated and nothing was started; stop it yourself, or retry with a longer --stop-grace. Receipt: ${join(realHome, ".oats-restart.json")}`);
      try { state = inspectSessionTarget(target, o.io); } catch (e) { if (backend === "tmux" && lostTmuxServer(e)) { serverGone = true; state = { present: false, state: "stopped" }; } else throw oatsError("E_SESSION_UNKNOWN", `after the stop, cannot establish the state of ${meta.instance}: ${String(e.stderr ?? e.message ?? "").trim() || e.message}`); }
      if (state.present && state.state !== "shell") throw oatsError("E_SESSION_UNKNOWN", `${meta.instance} read as stopped and then as ${state.state} again; nothing was started`);
    }
    const startedAt = new Date().toISOString();
    const id = randomUUID();
    checkRoots();
    const executionCommand = nativeRecordCommand(command, realHome, launchPlan?.harness || harness);
    const completedCommand = `${executionCommand}; oats_start_status=$?; printf '%s\\n' ${shq(id)} > ${shq(exitedPath)}`;
    let reused = "new";
    if (backend === "herdr") {
      if (!target) throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `this never-launched Herdr home has no saved server endpoint; no tmux fallback was started`);
      const base = { backend: "herdr", binary: target.binary, socket: target.socket, protocol: target.protocol };
      if (state.present) { reused = "pane"; }
      else {
        try { herdrSnapshot(base, o.io); }
        catch (e) { throw oatsError("E_SESSION_UNKNOWN", `Herdr server on ${base.socket} is not reachable, so nothing was started: ${e.message}`); }
        target = allocateHerdr(base, { home: realHome, instance: meta.instance }, o.io);
      }
      checkRoots();
      writeJsonAtomic(pendingPath, { id, target, command, model: model ?? null, startedAt, ...planExtra }, 0o600);
      try { launchHerdr(target, `${paneEnvExports}cd ${shq(realHome)} && ${completedCommand}; exit "$oats_start_status"`, o.io); }
      catch (e) { throw launchFailure("Herdr", e); }
    } else {
      const session = target?.session || meta.tmux?.session || DEFAULT_TMUX_SESSION;
      const window = target?.window || meta.tmux?.window || meta.instance;
      let socket = target?.socket || meta.tmux?.socket;
      const windowCmd = `${completedCommand}; exec "\${SHELL:-/bin/zsh}"`;
      // A fallback shell (no harness descendant) or a retained dead pane is
      // the agent's own pane: the command runs there, no other window touched.
      const inPlace = state.paneId && (state.present || state.state === "stopped");
      if (inPlace) {
        checkRoots();
        writeJsonAtomic(pendingPath, { id, target, command, model: model ?? null, startedAt, ...planExtra }, 0o600);
        try { tmuxOn(socket, ["respawn-pane", "-k", "-t", state.paneId, "-c", realHome, ...paneEnvFlags, windowCmd], o.io); }
        catch (e) { throw launchFailure("tmux", e); }
        reused = "pane";
      } else {
        const instancesRoot = dirname(realHome);
        const hq = existsSync(dirname(dirname(instancesRoot))) ? dirname(dirname(instancesRoot)) : realHome;
        checkRoots();
        if (!socket) {
          // Never launched (--no-launch): the default server, as spawn uses.
          const defaultTmux = args => guardedExec("tmux", args, { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
          let alive = false;
          try { defaultTmux(["has-session", "-t", session]); alive = true; } catch (e) { checkRoots(); }
          if (!alive) {
            defaultTmux(["new-session", "-d", "-s", session, "-n", "hq", "-c", hq]);
            for (const option of [["window-size", "latest"], ["aggressive-resize", "on"]]) {
              try { defaultTmux(["set-option", "-t", session, "-g", ...option]); } catch (e) { checkRoots(); }
            }
          }
          socket = defaultTmux(["display-message", "-p", "-t", session, "#{socket_path}"]);
          if (!socket) throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", "tmux did not report its socket");
        } else if (serverGone) {
          // The recorded server is gone (a reboot): the same socket path again.
          mkdirSync(dirname(socket), { recursive: true });
          tmuxOn(socket, ["new-session", "-d", "-s", session, "-n", "hq", "-c", hq], o.io);
          tmuxOn(socket, ["set-option", "-t", session, "-g", "window-size", "latest"], o.io);
          tmuxOn(socket, ["set-option", "-t", session, "-g", "aggressive-resize", "on"], o.io);
        }
        let names = [];
        try { names = tmuxOn(socket, ["list-windows", "-t", `=${session}`, "-F", "#{window_name}"], o.io).split("\n").filter(Boolean); }
        catch (e) {
          if (!/can't find session/i.test(String(e.stderr ?? e.message ?? "")) && !lostTmuxServer(e)) throw oatsError("E_SESSION_UNKNOWN", `cannot list tmux windows on ${socket}: ${String(e.stderr ?? e.message ?? "").trim()}`);
          tmuxOn(socket, ["new-session", "-d", "-s", session, "-n", "hq", "-c", hq], o.io);
        }
        if (names.includes(window)) throw oatsError("E_SESSION_RUNNING", `tmux window ${session}:${window} appeared on ${socket} during the start; nothing was started`);
        target = { backend: "tmux", session, window, socket: resolve(socket) };
        checkRoots();
        writeJsonAtomic(pendingPath, { id, target, command, model: model ?? null, startedAt, ...planExtra }, 0o600);
        try { tmuxOn(socket, ["new-window", "-t", `=${session}:`, "-n", window, "-c", realHome, ...paneEnvFlags, windowCmd], o.io); }
        catch (e) { throw launchFailure("tmux", e); }
      }
      target = { backend: "tmux", session, window, socket: resolve(socket) };
    }
    // Keep launch evidence until the command exits or the target disappears.
    // A transient child (for example cat TASK.md) is not proof that startup
    // has finished. A later start reconciles the receipt without a watcher.
    try { return record(meta, { id, backend, target, model, command, startedAt, reused, ...planExtra, ...(stopReceipt ? { stop: stopReceipt } : {}) }, false); }
    catch (e) {
      if (e.code && String(e.code).startsWith("E_")) throw e;
      throw oatsError("E_SESSION_START_INCOMPLETE", `${meta.instance} was started (${backend === "herdr" ? `Herdr pane ${target.paneId}` : `tmux ${target.session}:${target.window} on ${target.socket}`}) but its metadata could not be recorded: ${e.message}; the actual target is kept in ${pendingPath} and the next start adopts it instead of allocating another`);
    }
  } finally {
    // A hook may have replaced the home itself. Never follow that replacement
    // to remove a target's lock; keep the original retry state with its home.
    try {
      const st = lstatSync(realHome);
      if (st.isDirectory() && !st.isSymbolicLink() && st.dev === originalHomeIdentity?.dev && st.ino === originalHomeIdentity?.ino) rmSync(lock, { recursive: true, force: true });
    } catch { /* retain retry state when its authority is lost */ }
  }
}

function inspectRetirementWork(home, work, isWorktree, { branchDeletion, directory = false } = {}) {
  if (directory) assertDirectoryRoots(home);
  const classes = [];
  let baseline;
  const path = retirementBaselinePath(home);
  try {
    if (existsSync(path)) baseline = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw oatsError("E_WORK_INSPECTION_FAILED", `could not read the independent retirement baseline: ${e.message}`);
  }
  const baselineValid = baseline?.version === RETIRE_BASELINE_VERSION && baseline.home === realPathOrNearest(home);
  if (!baselineValid) {
    classes.push("unknown instance-home provenance");
  } else if (baseline.homeFingerprint !== fingerprintTree(home, { excludeRoot: new Set(["work"]), instanceHome: true })) {
    classes.push("changed instance-home bytes");
  }
  // A mutable mode must not turn owned directory bytes into an excluded shared
  // tree (or authorize Git deletion). Require the independent spawn authority.
  if (directory !== (baselineValid && baseline.directoryWork === true)) {
    throw oatsError("E_WORK_INSPECTION_FAILED", "directory work mode disagrees with independent retirement authority");
  }
  let directoryFingerprint;
  if (directory) {
    directoryFingerprint = fingerprintTree(work);
    // Never stamp hook-created or authored execution bytes as disposable.
    if (readdirSync(work).length) classes.push("directory work bytes");
  }
  const branchCommits = !directory && branchDeletion?.delete ? branchOnlyCommits(branchDeletion.repo, branchDeletion.branch) : undefined;
  if (branchCommits?.length) classes.push("branch-only local commits");
  if (isWorktree && existsSync(work)) {
    const status = worktreeStatus(work);
    const rows = status.split("\0").filter(Boolean);
    if (rows.some((row) => !row.startsWith("?? ") && !row.startsWith("!! "))) classes.push("tracked or index worktree state");
    const disposableRoots = baseline?.disposableReceipts?.map((r) => r.root) || [];
    if (!baseline || baseline.generatedWorkFingerprint !== generatedWorkFingerprint(work, status, disposableRoots)) classes.push("untracked or ignored worktree bytes");
    if (nestedGitRoots(work).length) classes.push("nested repository state");
  }
  const stateFingerprint = createHash("sha256")
    .update(fingerprintTree(home, { excludeRoot: new Set(["work"]), instanceHome: true }))
    .update("\0").update(directory ? (directoryFingerprint || "missing") : isWorktree && existsSync(work) ? worktreeStatus(work) : "")
    .digest("hex");
  return { classes: [...new Set(classes)], home, work, directory, directoryFingerprint, stateFingerprint, branchExists: branchCommits !== null, runtimeAuthority: baselineValid ? runtimeAuthorityOf(baseline) : undefined };
}

function copyRecoveryTree(src, dest, { excludeRoot = new Set() } = {}) {
  mkdirSync(dest, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (excludeRoot.has(e.name)) continue;
    copyTreeSafe(join(src, e.name), join(dest, e.name));
  }
}

const RECOVERABLE_GIT_ADMIN = [
  "MERGE_HEAD", "MERGE_MSG", "AUTO_MERGE", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD",
  "BISECT_LOG", "BISECT_START", "BISECT_NAMES", "rebase-apply", "rebase-merge", "sequencer",
];

/** Object ids among `oids` that `repo` does not have, from one
 *  `cat-file --batch-check` process. */
export function missingGitObjects(repo, oids) {
  if (!oids.length) return [];
  const out = execFileSync("git", ["-C", repo, "cat-file", "--batch-check=%(objectname) %(objecttype)"], { input: oids.join("\n") + "\n", encoding: "utf8", maxBuffer: GIT_MAX_BUFFER });
  const missing = [];
  for (const line of out.split("\n")) {
    if (!line.endsWith(" missing")) continue;
    missing.push(line.slice(0, line.indexOf(" ")));
  }
  return missing;
}

function restoreStandaloneGitState(sourceWork, recoveredRepo) {
  const sourceGit = execFileSync("git", ["-C", sourceWork, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" , maxBuffer: GIT_MAX_BUFFER }).trim();
  const recoveredGit = join(recoveredRepo, ".git");
  const indexRows = execFileSync("git", ["-C", sourceWork, "ls-files", "--stage", "-z"], { maxBuffer: GIT_MAX_BUFFER });
  // The staged blobs the recovered index will point at. The clone already
  // holds every blob reachable from a commit; only content that is staged but
  // never committed is missing, so ask once which objects the recovered
  // repository lacks (one process for the whole index) and copy only those.
  // Copying every row cost two Git processes per index entry: a clean 9,500
  // file tree took ~19,000 launches and looked like a hang. Gitlink rows
  // (mode 160000) name commits of nested repositories, which
  // materializeNestedRepositories restores; they are never blobs here.
  const staged = new Set();
  for (const row of indexRows.toString("utf8").split("\0").filter(Boolean)) {
    const match = row.match(/^(\d+) ([0-9a-f]+) \d+\t/);
    if (!match || match[1] === "160000") continue;
    staged.add(match[2]);
  }
  for (const oid of missingGitObjects(recoveredRepo, [...staged])) {
    const blob = execFileSync("git", ["-C", sourceWork, "cat-file", "blob", oid], { maxBuffer: GIT_MAX_BUFFER });
    const restored = execFileSync("git", ["-C", recoveredRepo, "hash-object", "-w", "--stdin"], { input: blob, encoding: "utf8" , maxBuffer: GIT_MAX_BUFFER }).trim();
    if (restored !== oid) throw new Error(`recovered Git object ${restored} did not match source ${oid}`);
  }
  const stillMissing = missingGitObjects(recoveredRepo, [...staged]);
  if (stillMissing.length) throw new Error(`recovered repository lacks ${stillMissing.length} staged object(s) after restore: ${stillMissing.slice(0, 3).join(", ")}`);
  copyFileSync(join(sourceGit, "index"), join(recoveredGit, "index"));
  for (const name of RECOVERABLE_GIT_ADMIN) {
    const source = join(sourceGit, name);
    if (!existsSync(source)) continue;
    const dest = join(recoveredGit, name);
    rmSync(dest, { recursive: true, force: true });
    copyTreeSafe(source, dest);
  }
}

/** Give a recovery clone the source's effective exclude rules, so the status comparison sees the same
 *  ignored paths. A fresh clone has neither the common dir's info/exclude nor a repository-configured
 *  core.excludesFile, so a path excluded only there is `!!` in the source and `??` in the clone. Both are
 *  written into the clone's own info/exclude (self-contained): core.excludesFile first, then
 *  info/exclude, which keeps Git's precedence (a later pattern wins, and info/exclude outranks
 *  core.excludesFile). → the sources carried, [{ kind, path }]. */
function carryExcludes(sourceWork, recoveredRepo) {
  const git = (...args) => execFileSync("git", ["-C", sourceWork, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_MAX_BUFFER }).trim();
  const carried = [], parts = [];
  // A file with no pattern line (Git's template info/exclude is comments only) changes nothing: not carried.
  const carry = (kind, file) => {
    if (!existsSync(file)) return;
    const text = readFileSync(file, "utf8");
    if (!text.split("\n").some((line) => line.trim() && !line.startsWith("#"))) return;
    parts.push(text); carried.push({ kind, path: file });
  };
  let excludesFile = "";
  try { excludesFile = git("config", "--path", "--get", "core.excludesFile"); } catch { /* unset: Git's default applies to both repositories alike */ }
  if (excludesFile) {
    carry("core.excludesFile", resolve(git("rev-parse", "--show-toplevel"), excludesFile));
  }
  carry("info/exclude", join(git("rev-parse", "--path-format=absolute", "--git-common-dir"), "info", "exclude"));
  if (!carried.length) return carried;
  mkdirSync(join(recoveredRepo, ".git", "info"), { recursive: true });
  writeFileSync(join(recoveredRepo, ".git", "info", "exclude"), parts.map((t) => (t.endsWith("\n") ? t : `${t}\n`)).join(""));
  return carried;
}

/** Repository settings that change what `git status` reports for the same bytes and index. */
const STATUS_CONFIG = ["core.fileMode", "core.ignoreCase", "core.precomposeUnicode", "core.symlinks", "core.autocrlf", "core.eol"];
/** Give a recovery clone the source's status-affecting settings, so the status comparison judges the same
 *  bytes the same way. A fresh clone probes its own core.fileMode/ignoreCase/… and lacks the common dir's
 *  info/attributes, so e.g. core.fileMode=false with a mode-only change is clean in the source and ` M` in
 *  the clone. Each key whose effective value differs is set (or, unset in the source, unset) in the
 *  clone's local config; info/attributes is copied to the clone's (the same precedence). → what was
 *  carried: [{ kind: "config", key, value } | { kind: "info/attributes", path }]. */
function carryStatusConfig(sourceWork, recoveredRepo) {
  const get = (repo, key) => {
    try { return execFileSync("git", ["-C", repo, "config", "--get", key], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_MAX_BUFFER }).replace(/\n$/, ""); }
    catch (e) { if (e.status === 1) return null; throw e; }
  };
  const carried = [];
  for (const key of STATUS_CONFIG) {
    const value = get(sourceWork, key);
    if (value === get(recoveredRepo, key)) continue;
    execFileSync("git", ["-C", recoveredRepo, "config", "--local", ...(value === null ? ["--unset-all", key] : [key, value])], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_MAX_BUFFER });
    carried.push({ kind: "config", key, value });
  }
  const common = execFileSync("git", ["-C", sourceWork, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_MAX_BUFFER }).trim();
  const attributes = join(common, "info", "attributes");
  if (existsSync(attributes)) {
    mkdirSync(join(recoveredRepo, ".git", "info"), { recursive: true });
    copyFileSync(attributes, join(recoveredRepo, ".git", "info", "attributes"));
    carried.push({ kind: "info/attributes", path: attributes });
  }
  return carried;
}

function detachRecoveryClone(source, recovered) {
  let stash;
  try { stash = execFileSync("git", ["-C", source, "rev-parse", "--verify", "--quiet", "refs/stash"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] , maxBuffer: GIT_MAX_BUFFER }).trim(); }
  catch { stash = undefined; }
  if (stash) {
    execFileSync("git", ["-C", recovered, "fetch", "--quiet", source, "refs/stash:refs/stash"], { maxBuffer: GIT_MAX_BUFFER });
    const sourceCommon = execFileSync("git", ["-C", source, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" , maxBuffer: GIT_MAX_BUFFER }).trim();
    const stashLog = join(sourceCommon, "logs", "refs", "stash");
    if (existsSync(stashLog)) {
      const recoveredLog = join(recovered, ".git", "logs", "refs", "stash");
      mkdirSync(dirname(recoveredLog), { recursive: true });
      copyFileSync(stashLog, recoveredLog);
    }
  }
  try { execFileSync("git", ["-C", recovered, "remote", "remove", "origin"], { stdio: "ignore" , maxBuffer: GIT_MAX_BUFFER }); } catch { /* no remote is already independent */ }
}

function materializeNestedRepositories(sourceWork, recoveredRepo) {
  const excludes = [], statusConfig = [];
  for (const source of nestedGitRoots(sourceWork)) {
    const rel = relative(sourceWork, source);
    const dest = join(recoveredRepo, rel);
    const head = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" , maxBuffer: GIT_MAX_BUFFER }).trim();
    rmSync(dest, { recursive: true, force: true });
    execFileSync("git", ["clone", "--no-local", "--quiet", source, dest], { stdio: ["ignore", "pipe", "pipe"] , maxBuffer: GIT_MAX_BUFFER });
    execFileSync("git", ["-C", dest, "checkout", "--quiet", head], { maxBuffer: GIT_MAX_BUFFER });
    detachRecoveryClone(source, dest);
    restoreStandaloneGitState(source, dest);
    for (const c of carryExcludes(source, dest)) excludes.push({ repo: rel, ...c });
    for (const c of carryStatusConfig(source, dest)) statusConfig.push({ repo: rel, ...c });
    for (const e of readdirSync(source, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const target = join(dest, e.name);
      rmSync(target, { recursive: true, force: true });
      copyTreeSafe(join(source, e.name), target);
    }
    if (existsSync(join(dest, ".git", "objects", "info", "alternates"))) throw new Error(`nested recovery ${rel} depends on object alternates`);
    assertStatusAgrees(source, dest, `nested recovery ${rel} Git state disagreed with source`, rel);
  }
  return { excludes, statusConfig };
}

/** Bytes a path holds, never following a symlink (a link counts as its own entry). */
function treeBytes(path) {
  let st; try { st = lstatSync(path); } catch { return 0; }
  if (!st.isDirectory()) return st.size;
  let n = 0;
  for (const e of readdirSync(path)) n += treeBytes(join(path, e));
  return n;
}
/** The outputs a recovery copies beyond committed and tracked state — a worktree's
 *  untracked and ignored paths (its status), or a directory's work entries —
 *  grouped by top-level entry with their bytes, largest first. There is no
 *  disposable declaration on the workspace model, so node_modules/ or build/
 *  outputs are copied too: the retire summary names them and what they cost. */
function preservedOutputs(work, directory) {
  const rows = directory
    ? readdirSync(work)
    : worktreeStatus(work).split("\0").filter((row) => row.startsWith("?? ") || row.startsWith("!! ")).map((row) => row.slice(3));
  const groups = new Map();
  for (const rel of rows) {
    const parts = rel.replace(/\/$/, "").split("/");
    const isDir = parts.length > 1 || rel.endsWith("/") || (directory && lstatSync(join(work, rel)).isDirectory());
    const key = isDir ? `${parts[0]}/` : parts[0];
    groups.set(key, (groups.get(key) || 0) + treeBytes(join(work, rel)));
  }
  const paths = [...groups].map(([path, bytes]) => ({ path, bytes })).sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  return { paths, bytes: paths.reduce((n, p) => n + p.bytes, 0) };
}

function preserveRetirementWork(observation, meta, instance) {
  const recoveryRoot = join(retirementStateRoot(observation.home), "recovery");
  mkdirSync(recoveryRoot, { recursive: true });
  if (observation.directory && realpathSync(recoveryRoot) !== join(realpathSync(dirname(observation.home)), ".oats-retirement", "recovery")) {
    throw oatsError("E_WORK_PRESERVATION_FAILED", "directory recovery storage was redirected; retain the source home rather than copying into an unowned or disposable location");
  }
  const staging = mkdtempSync(join(recoveryRoot, `.${instance}-`));
  const recovery = join(recoveryRoot, basename(staging).slice(1));
  try {
    // A home-only change (notes, harness files, credentials) needs a home
    // snapshot, not another copy of an otherwise disposable clean worktree.
    // In-progress Git operations retain the full standalone recovery even
    // when porcelain status has no changed paths.
    let homeOnly = observation.classes.length === 1 && observation.classes[0] === "changed instance-home bytes"
      && meta.work === "worktree" && existsSync(observation.work);
    if (homeOnly) {
      const gitDir = execFileSync("git", ["-C", observation.work, "rev-parse", "--absolute-git-dir"], { encoding: "utf8", maxBuffer: GIT_MAX_BUFFER }).trim();
      homeOnly = !RECOVERABLE_GIT_ADMIN.some((name) => existsSync(join(gitDir, name)));
    }
    const recoveredHome = join(staging, "home");
    copyRecoveryTree(observation.home, recoveredHome, { excludeRoot: new Set(["work"]) });
    if (fingerprintTree(observation.home, { excludeRoot: new Set(["work"]), instanceHome: true }) !== fingerprintTree(recoveredHome, { instanceHome: true })) {
      throw new Error("home recovery verification disagreed with the source");
    }
    let branchDrift, excludes, statusConfig;
    if (!homeOnly && meta.work === "worktree" && meta.repo && meta.branch && (existsSync(observation.work) || observation.branchExists)) {
      const recoveredRepo = join(staging, "repo");
      // The branch is derived from the worktree while it exists: an instance
      // that legitimately switched branches during its task must still be
      // recoverable, and the recorded spawn-time branch is only the fallback
      // when the worktree is gone. Detached HEADs recover at their exact OID.
      const ref = existsSync(observation.work) ? worktreeRef(observation.work) : { branch: meta.branch, oid: null };
      if (ref.branch !== meta.branch) branchDrift = { recordedBranch: meta.branch, worktreeBranch: ref.branch, detachedAt: ref.branch === null ? ref.oid : null };
      if (ref.branch !== null) execFileSync("git", ["clone", "--no-local", "--quiet", "--branch", ref.branch, meta.repo, recoveredRepo], { stdio: ["ignore", "pipe", "pipe"] , maxBuffer: GIT_MAX_BUFFER });
      else {
        execFileSync("git", ["clone", "--no-local", "--quiet", "--no-checkout", meta.repo, recoveredRepo], { stdio: ["ignore", "pipe", "pipe"] , maxBuffer: GIT_MAX_BUFFER });
        execFileSync("git", ["-C", recoveredRepo, "fetch", "--quiet", observation.work, ref.oid], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_MAX_BUFFER });
        execFileSync("git", ["-C", recoveredRepo, "checkout", "--quiet", "--detach", ref.oid], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_MAX_BUFFER });
      }
      const sourceGitContext = existsSync(observation.work) ? observation.work : meta.repo;
      detachRecoveryClone(sourceGitContext, recoveredRepo);
      if (existsSync(observation.work)) {
        restoreStandaloneGitState(observation.work, recoveredRepo);
        excludes = carryExcludes(observation.work, recoveredRepo).map((c) => ({ repo: ".", ...c }));
        statusConfig = carryStatusConfig(observation.work, recoveredRepo).map((c) => ({ repo: ".", ...c }));
        for (const e of readdirSync(observation.work, { withFileTypes: true })) {
          if (e.name === ".git") continue;
          const dest = join(recoveredRepo, e.name);
          rmSync(dest, { recursive: true, force: true });
          copyTreeSafe(join(observation.work, e.name), dest);
        }
        const nested = materializeNestedRepositories(observation.work, recoveredRepo);
        excludes.push(...nested.excludes); statusConfig.push(...nested.statusConfig);
      }
      if (existsSync(join(recoveredRepo, ".git", "objects", "info", "alternates"))) throw new Error("recovery clone depends on object alternates");
      if (existsSync(observation.work)) {
        if (fingerprintTree(observation.work, { excludeRoot: new Set([".git"]), excludeGitMetadata: true }) !== fingerprintTree(recoveredRepo, { excludeRoot: new Set([".git"]), excludeGitMetadata: true })) throw new Error("worktree recovery verification disagreed with the source");
        assertStatusAgrees(observation.work, recoveredRepo, "recovered Git index/status disagreed with the source", ".");
      }
      const recoveredHead = execFileSync("git", ["-C", recoveredRepo, "rev-parse", "HEAD"], { encoding: "utf8" , maxBuffer: GIT_MAX_BUFFER }).trim();
      const sourceHead = ref.branch === null ? ref.oid
        : execFileSync("git", ["-C", meta.repo, "rev-parse", `refs/heads/${ref.branch}`], { encoding: "utf8" , maxBuffer: GIT_MAX_BUFFER }).trim();
      if (recoveredHead !== sourceHead) throw new Error("recovery clone does not retain the instance branch tip");
    }
    if (observation.directory && observation.directoryFingerprint) {
      const recoveredWork = join(staging, "work");
      copyTreeSafe(observation.work, recoveredWork);
      if (fingerprintTree(observation.work) !== observation.directoryFingerprint || fingerprintTree(recoveredWork) !== observation.directoryFingerprint) {
        throw new Error("directory recovery verification disagreed with the inspected source");
      }
    }
    const repoCopy = homeOnly ? { copied: false, reason: "Only instance-home bytes changed; no work state requires a repository copy", source: meta.repo, branch: meta.branch } : undefined;
    // What the copy cost: the untracked/ignored (or directory) outputs it carries, named.
    const workCopied = observation.directory ? !!observation.directoryFingerprint : !homeOnly && meta.work === "worktree" && existsSync(observation.work);
    const outputs = workCopied ? preservedOutputs(observation.work, observation.directory) : undefined;
    writeFileSync(join(staging, "recovery.json"), JSON.stringify({ version: 1, instance, classes: observation.classes, sourceHome: observation.home, createdAt: new Date().toISOString(), ...(repoCopy ? { repoCopy } : {}), ...(branchDrift ? { branchDrift } : {}), ...(excludes?.length ? { excludes } : {}), ...(statusConfig?.length ? { statusConfig } : {}), ...(outputs ? { outputs } : {}) }, null, 2) + "\n", { mode: 0o600 });
    const bytes = treeBytes(staging);
    mkdirSync(dirname(recovery), { recursive: true });
    renameSync(staging, recovery);
    return { path: recovery, classes: observation.classes, bytes, ...(outputs ? { outputs } : {}), ...(repoCopy ? { repoCopy } : {}) };
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    const details = e.statusDisagreement ? { home: observation.home, statusDisagreement: e.statusDisagreement } : undefined;
    throw Object.assign(oatsError("E_WORK_PRESERVATION_FAILED", `retirement work remains at ${observation.home}; recovery could not be verified: ${e.message}`, details), details ? { details } : {});
  }
}

/** Marker a self-retiring instance leaves BESIDE its home: the retirement is
 *  requested and owed, and a detached completion is on its way. It is not
 *  written into the home, so the caller changes no instance bytes and the
 *  completion's work inspection sees exactly what the instance left. */
export function retirePendingMarkerPath(home) {
  return join(dirname(home), `.oats-retire-pending-${basename(home)}.json`);
}

/** Where a deferred self-retirement writes its explicit outcome: a FILE beside
 *  the (former) home, so it survives the home's removal and never reads as an
 *  instance directory. */
export function deferredRetireResultPath(home) {
  return join(dirname(home), `.oats-retired-${basename(home)}.json`);
}

const DEFERRED_RETIRE_SCRIPT = `import { completeDeferredRetirement } from ${JSON.stringify(import.meta.url)};
process.exitCode = completeDeferredRetirement(JSON.parse(process.env.OATS_RETIRE_INTENT)) ? 0 : 1;`;

/** Self-retire (aweb-abep): persist intent, then hand the retirement to a
 *  detached process that runs it as an ORDINARY external retirement after the
 *  caller's window has died. Nothing destructive happens in the caller: no
 *  inspection, no hooks, no removal — the harness is still alive, and the
 *  quiesce rule stays intact. The child owns its own process group so the
 *  tmux window kill (SIGHUP to the pane's group) cannot take it down, and the
 *  caller's instance env is stripped so the child is an external operator,
 *  not another self-retire. The intent travels to the child in its env; the
 *  marker beside the home is the operator-visible promise and is written only
 *  once a completion process exists (reviewer D2). */
function scheduleDeferredSelfRetirement(root, found, name, o, session) {
  const delaySec = o.selfKillDelaySec ?? 8;
  const marker = retirePendingMarkerPath(found.home);
  const resultPath = deferredRetireResultPath(found.home);
  const logPath = resultPath.replace(/\.json$/, ".log");
  // A second `--self` while the first completion is still on its way must not
  // start a second, racing retirement: report the one already owed.
  if (existsSync(marker) && !existsSync(resultPath)) {
    let prior; try { prior = JSON.parse(readFileSync(marker, "utf8")); } catch { prior = undefined; }
    if (prior?.resultPath) {
      return { retired: name, agent: found.agent.name, deferred: true, alreadyScheduled: true, pendingMarker: marker, resultPath: prior.resultPath, logPath, completesInSec: prior.delaySec ?? delaySec, requestedAt: prior.requestedAt };
    }
  }
  const intent = {
    instance: name, agent: found.agent.name, root: resolve(root),
    requestedAt: new Date().toISOString(), requestedByPid: process.pid, delaySec,
    options: { home: found.home, deleteBranch: !!o.deleteBranch, ...(o.keepDir ? { keepDir: true } : {}), tmuxSession: session }, resultPath,
  };
  const env = { ...process.env, OATS_RETIRE_INTENT: JSON.stringify(intent) };
  for (const k of CORE_LAUNCH_ENV) delete env[k];
  rmSync(resultPath, { force: true });
  const scheduleFailed = (why) => oatsError("E_SELF_RETIRE_SCHEDULE_FAILED", `could not start the deferred retirement of ${name}: ${why}. Nothing was inspected, run, or removed; the instance is still live and can be retired externally with \`oats retire ${name} --home ${found.home}\``);
  let fd, child;
  try {
    fd = openSync(logPath, "w");
    child = spawnProcess(process.execPath, ["--input-type=module", "-e", DEFERRED_RETIRE_SCRIPT], {
      detached: true, stdio: ["ignore", fd, fd], env, cwd: dirname(found.home),
    });
  } catch (e) {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* already closed */ } }
    rmSync(logPath, { force: true });
    throw scheduleFailed(e.message);
  }
  closeSync(fd);
  if (!child.pid) { rmSync(logPath, { force: true }); throw scheduleFailed("no process was created"); }
  // A spawn failure Node reports asynchronously (EAGAIN, EMFILE) would arrive
  // after this returns; record it as a failed outcome so status shows the
  // debt instead of an uncaught exception behind a success message.
  child.on("error", (e) => {
    try {
      writeFileSync(resultPath, JSON.stringify({ instance: name, agent: found.agent.name, requestedAt: intent.requestedAt, completedAt: new Date().toISOString(), ok: false, error: { code: e.code, message: `the deferred retirement could not start: ${e.message}` }, retry: `oats retire ${name} --home ${found.home}` }, null, 2) + "\n");
    } catch { /* the marker alone then shows RETIRING; status names its age */ }
  });
  child.unref();
  writeFileSync(marker, JSON.stringify(intent, null, 2) + "\n");
  return {
    retired: name, agent: found.agent.name, deferred: true, pendingMarker: marker,
    resultPath, logPath, completesInSec: delaySec, completionPid: child.pid,
  };
}

/** Run by the detached child: wait for the caller's window to be gone, then
 *  retire the instance as an ordinary external operator. Returns true only
 *  when the home is actually gone, and then leaves no file behind. A failure
 *  writes an explicit outcome beside the home and leaves the pending marker
 *  (and, after hooks ran, the usual quarantine) in place, so `oats status`
 *  shows the debt and `oats retire <name>` retries and clears it. Accepts the
 *  intent object (the child gets it in its env) or a marker path. */
export function completeDeferredRetirement(intentOrMarkerPath, opts = {}) {
  let intent = intentOrMarkerPath;
  if (typeof intentOrMarkerPath === "string") {
    try { intent = JSON.parse(readFileSync(intentOrMarkerPath, "utf8")); }
    catch (e) { console.error(`deferred retirement: cannot read ${intentOrMarkerPath}: ${e.message}`); return false; }
  }
  if (!isPlainObject(intent) || !intent.instance || !intent.root) { console.error("deferred retirement: intent is not usable"); return false; }
  const record = (payload) => {
    if (!intent.resultPath) return;
    try {
      writeFileSync(intent.resultPath, JSON.stringify({
        instance: intent.instance, agent: intent.agent, requestedAt: intent.requestedAt,
        completedAt: new Date().toISOString(), ...payload,
      }, null, 2) + "\n");
    } catch (e) { console.error(`deferred retirement: cannot write ${intent.resultPath}: ${e.message}`); }
  };
  const delayMs = Math.max(0, Number(opts.delaySec ?? intent.delaySec ?? 8) * 1000);
  if (delayMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
  let result;
  try {
    result = retireInstance(intent.root, intent.instance, {
      home: intent.options?.home, deleteBranch: !!intent.options?.deleteBranch, keepDir: !!intent.options?.keepDir, tmuxSession: intent.options?.tmuxSession,
    });
  } catch (e) {
    record({ ok: false, error: { code: e.code, message: e.message }, retry: `oats retire ${intent.instance}${intent.options?.home ? ` --home ${intent.options.home}` : ""}` });
    console.error(`deferred retirement of ${intent.instance} failed: ${e.message}`);
    return false;
  }
  if (result.rollbackIncomplete) {
    record({ ok: false, result, retry: `oats retire ${intent.instance}${intent.options?.home ? ` --home ${intent.options.home}` : ""}` });
    console.error(`deferred retirement of ${intent.instance} is INCOMPLETE; the home is retained:\n  ${result.rollbackIncomplete.join("\n  ")}`);
    return false;
  }
  if (intent.options?.keepDir) {
    // The kept home is the one the intent names, never a same-named twin.
    const retained = intent.options?.home ? { home: intent.options.home } : findInstanceHome(intent.root, intent.instance);
    if (retained) rmSync(retirePendingMarkerPath(retained.home), { force: true });
  }
  // Success leaves nothing beside the home: the home is gone, the marker went
  // with it, and a kept success record per retired reviewer or harvester would
  // accumulate forever (reviewer D4). Only failures leave files, and they are
  // the ones status surfaces and a retry clears.
  try { rmSync(intent.resultPath.replace(/\.json$/, ".log"), { force: true }); } catch { /* nothing to keep */ }
  return true;
}

export function retireInstance(root, name, o = {}) {
  const session = o.tmuxSession || DEFAULT_TMUX_SESSION;
  // self-retire: the caller IS the instance. Without --keep-dir the whole
  // retirement is deferred to a detached external completion (below); with
  // --keep-dir the old in-process path runs and kills the window LAST.
  const self = o.self === true;
  // Names are unique per agent dir only: two agents can own an instance of
  // the same name (dev --purpose foo-1 and agent dev-foo). Retirement is
  // destructive, so a name that resolves to several homes is refused unless
  // the caller says which home (--home), and a home is accepted only when it
  // is one of that name's homes under this root.
  const matches = findInstanceHomes(root, name);
  if (!matches.length) throw oatsError("E_SESSION_UNKNOWN", `no instance named "${name}"`);
  const sameHome = (a, b) => { try { return realpathSync(a) === realpathSync(b); } catch { return resolve(a) === resolve(b); } };
  let found;
  if (o.home) {
    found = matches.find((m) => sameHome(m.home, o.home));
    if (!found) throw oatsError("E_HOME_MISMATCH", `instance "${name}" has no home at ${o.home} under this agents root (its home${matches.length === 1 ? " is" : "s are"} ${matches.map((m) => m.home).join(", ")})`);
  } else if (matches.length > 1) {
    throw oatsError("E_AMBIGUOUS_INSTANCE", `"${name}" names ${matches.length} instances under this agents root (${matches.map((m) => `${m.agent.name}: ${m.home}`).join("; ")}); retire with --home <path> to say which`);
  } else {
    found = matches[0];
  }
  const metaPath = join(found.home, "instance.json");
  // A QUARANTINED home (spawn failed after a required hook and compensation did
  // not finish) has no instance.json — it never got that far. Its marker carries
  // the cleanup descriptor in the same shape, so retire can rerun compensation
  // instead of silently skipping every hook and deleting the credentials.
  const directoryFallbackPath = directoryRollbackPath(found.home);
  const quarantinePath = existsSync(directoryFallbackPath) ? directoryFallbackPath : join(found.home, ".oats-rollback-incomplete.json");
  let quarantine;
  let markerUnusable = false;
  // A marker means the home is quarantined, WHETHER OR NOT instance.json exists:
  // the post-launch rollback retains a home that already has one, and gating on
  // its absence meant that quarantine was silently ignored — retire took the
  // ordinary path, where hook failures do not retain, and deleted the credential
  // while the external state survived (reviewer-final0130bc8).
  if (existsSync(quarantinePath)) {
    // A marker without a USABLE cleanup descriptor is NOT a quarantine we can
    // retry — it is an unidentified home. Treating an unusable one as retryable
    // made --force unable to ever clear it: the retry could not run, so the home
    // was retained again, forever (reviewer-adff009). "Parses as JSON" is not
    // the bar; "can actually drive the retry" is, so the shape is checked
    // against what the retry below consumes (reviewer-45ff039r2).
    try {
      const parsed = JSON.parse(readFileSync(quarantinePath, "utf8"));
      if (isPlainObject(parsed) && usableCleanupDescriptor(parsed)) quarantine = parsed;
      else markerUnusable = true;
    } catch { markerUnusable = true; }
  }
  const liveMeta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : undefined;
  // A quarantined home may carry an instance.json that is NOT the spawn record:
  // module materialization writes a pre-hook stub ({ modules, providers,
  // resolutionRevision }) before the spawn hooks run, and a required-hook
  // failure retains the home with that stub in place. Trusting it over the
  // cleanup descriptor left meta.repo undefined, so the retry never re-ran the
  // owed retire hook and reported "cleanup descriptor lost its context repo"
  // on every attempt — only --force could clear the home (found by an operator
  // rehearsal on 0.25.3). The descriptor is written FOR this retry; a live
  // record only wins when it is a complete spawn record (repo + work present).
  const liveIsSpawnRecord = !!liveMeta && nonEmptyString(liveMeta.repo) && WORK_MODES.includes(liveMeta.work);
  const meta = liveIsSpawnRecord || !quarantine ? (liveMeta || quarantine?.cleanup || {}) : { ...liveMeta, ...quarantine.cleanup };
  // Compensation metadata is the SPAWN's, from whichever record survived — never
  // a failed retry's report, which says nothing about what still needs undoing.
  if (!liveMeta?.capabilityMeta && quarantine?.cleanup?.capabilityMeta) meta.capabilityMeta = quarantine.cleanup.capabilityMeta;
  if (quarantine && typeof quarantine.cleanup.launched === "boolean") {
    meta.launched = quarantine.cleanup.launched;
    meta.tmux = quarantine.cleanup.tmux;
    meta.sessionTarget = quarantine.cleanup.sessionTarget;
  }
  // A home with NEITHER instance.json NOR a usable cleanup descriptor cannot be
  // retired safely: hooks would be skipped and the directory removed, which is
  // the credential deletion the quarantine exists to prevent — and the spawn
  // path tolerates a failed marker write, so this state is reachable. Fail
  // closed; `force` is the deliberate manual-cleanup escape.
  // A marker that cannot drive a retry is not "ignore me" — it is evidence that
  // cleanup was interrupted and OATS cannot tell what remains. Fail closed even
  // when instance.json is present; `--force` is the deliberate manual escape.
  if (markerUnusable && !o.force) {
    throw oatsError("E_UNIDENTIFIED_INSTANCE_HOME", `${found.home} carries a rollback marker that cannot drive a retry (unreadable, or missing the cleanup descriptor fields the retry consumes), so OATS cannot tell what external state still depends on this home. Inspect it, then re-run with \`--force\` to remove it anyway.`);
  }
  if (!existsSync(metaPath) && !quarantine && !o.force) {
    throw oatsError("E_UNIDENTIFIED_INSTANCE_HOME", `${found.home} has no instance.json and no cleanup descriptor, so OATS cannot tell whether external state (identities, worktrees) still depends on it. Retiring it would delete whatever it holds without running any cleanup. Inspect it, then re-run with \`--force\` to remove it anyway.`);
  }

  const workPath = join(found.home, "work");
  const directory = meta.work === "directory";
  const isWorktree = !directory && (meta.work === "worktree" ||
    (existsSync(workPath) && !lstatSync(workPath).isSymbolicLink()));
  // A live harness cannot establish a stable final work inspection of itself,
  // so self-retire never inspects, runs hooks, or removes anything here. It
  // persists the intent and hands the whole retirement to a detached process
  // that runs it as an ordinary EXTERNAL retirement once the harness is gone
  // (aweb-abep). `--keep-dir` keeps the old in-process path: nothing to inspect.
  if (self && (!o.keepDir || meta.sessionTarget)) {
    return scheduleDeferredSelfRetirement(root, found, name, o, session);
  }
  // First inspection is non-destructive. Only after it succeeds may OATS quiesce
  // the managed harness; recovery copying never races a live managed Pi.
  const branchDeletion = { delete: !!(o.deleteBranch || quarantine), repo: meta.repo, branch: meta.branch };
  const initialObservation = inspectRetirementWork(found.home, workPath, isWorktree, { branchDeletion, directory });
  // Harness identity is destructive authority. The mutable child metadata may
  // describe it for humans, but only the independent baseline can authorize the
  // endpoint that proves quiescence.
  let runtimeAuthority;
  if (liveMeta || quarantine) {
    runtimeAuthority = initialObservation.runtimeAuthority;
    if (!runtimeAuthority) {
      throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `cannot quiesce ${name}: independent runtime endpoint authority is missing or invalid`);
    }
    const endpointAgrees = runtimeAuthority.sessionTarget
      ? !meta.tmux && ["backend", "binary", "socket", "workspaceId", "paneId", "terminalId", "protocol"].every((key) => meta.sessionTarget?.[key] === runtimeAuthority.sessionTarget[key])
      : !meta.sessionTarget && meta.tmux?.session === runtimeAuthority.tmux?.session
        && meta.tmux?.window === runtimeAuthority.tmux?.window
        && resolve(meta.tmux?.socket || ".") === runtimeAuthority.tmux?.socket;
    const metaAgrees = meta.launched === runtimeAuthority.launched && (!runtimeAuthority.launched || endpointAgrees);
    if (!metaAgrees) {
      throw oatsError("E_RUNTIME_AUTHORITY_MISMATCH", `cannot quiesce ${name}: mutable instance metadata disagrees with independent runtime endpoint authority`);
    }
  }
  // `=` forces exact matching: tmux targets otherwise PREFIX-match window names.
  // A no-launch instance is already quiesced. A launched one must have exact
  // window absence established before recovery copying begins.
  if (!self && runtimeAuthority?.launched && runtimeAuthority.sessionTarget) {
    try { stopHerdr(runtimeAuthority.sessionTarget); }
    catch (e) { throw oatsError("E_RUNTIME_QUIESCE_FAILED", `could not establish that Herdr session for ${name} stopped: ${e.message}`); }
  }
  if (!self && runtimeAuthority?.launched && !runtimeAuthority.sessionTarget) {
    const runtimeSession = runtimeAuthority.tmux.session;
    const runtimeWindow = runtimeAuthority.tmux.window;
    const runtimeSocket = runtimeAuthority.tmux.socket;
    const tmux = ["-S", runtimeSocket];
    try { execFileSync("tmux", [...tmux, "kill-window", "-t", `=${runtimeSession}:=${runtimeWindow}`], { stdio: ["ignore", "pipe", "pipe"] }); } catch { /* verify the effect below */ }
    try {
      const windows = execFileSync("tmux", [...tmux, "list-windows", "-t", runtimeSession, "-F", "#{window_name}"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\n").filter(Boolean);
      if (windows.includes(runtimeWindow)) throw new Error(`tmux window ${runtimeSession}:${runtimeWindow} is still running`);
    } catch (e) {
      const detail = String(e.stderr ?? e.message ?? "").trim();
      if (!/no server running|failed to connect|can't find session|no sessions/i.test(detail)) throw oatsError("E_RUNTIME_QUIESCE_FAILED", `could not establish that ${runtimeSession}:${runtimeWindow} stopped on ${runtimeSocket}: ${detail || "tmux inspection failed"}`);
    }
  }
  const stableObservation = inspectRetirementWork(found.home, workPath, isWorktree, { branchDeletion, directory });
  const workRecoveries = [];
  if (stableObservation.classes.length) workRecoveries.push(preserveRetirementWork(stableObservation, meta, name));
  let workRecovery = workRecoveries.at(-1);

  // Capability lifecycle hooks (retire) — run BEFORE the dir (and any package state in it,
  // e.g. aweb signing keys) is removed. The knowledge integration harvests notes/ here;
  // the kernel itself is memory-agnostic.
  let hookResults;
  if (meta.repo) {
    // The hooks this home recorded at spawn. A home an earlier kernel spawned
    // without them still retires (lead decision c3 Q2): no hook runs, and the
    // result says so.
    const resolved = { ...resolvedFromHome(found.home, meta), capabilities: Array.isArray(meta.capabilityRuntime) ? meta.capabilityRuntime : [] };
    // The soul this home was spawned from, as recorded (a workspace home records its
    // per-commit directory; agents/<name>/soul may since point elsewhere) — the same
    // value spawn's hook saw.
    hookResults = runLifecycleHooks("retire", {
      home: found.home, instance: name, agentName: found.agent.name,
      soulDir: instanceSoulDir(found.home, meta) || found.agent._soulDir || join(found.agent._dir, "soul"),
      ...(nonEmptyString(meta.soulId) ? { soulId: meta.soulId } : {}),
      contextDir: meta.repo, workspaceDir: workspaceOf(root), rootDir: root, resolved, priorMeta: meta.capabilityMeta || {},
    });
  }

  // ORDINARY retirement must not delete a home whose cleanup did not finish.
  // The failures were already collected above; until now they were read ONLY on
  // the quarantine-retry path, so a FIRST failure was discarded and the home —
  // with the credential needed to undo surviving external state — was removed
  // anyway. That asymmetry is the bug the comment further down already
  // describes. A hook that reports nothing, or reports retired:true, is
  // unaffected; only an explicit "I did not finish" changes the outcome.
  let ordinaryIncomplete = [];
  // The IN-PROCESS self path (--self --keep-dir only, since aweb-abep) is
  // excluded: that caller is the instance and cannot hold the authority to
  // complete owner cleanup (reviewer-5c8b724). A plain --self never reaches
  // here as `self`: its deferred completion calls retireInstance as an
  // external operator, so a self-retiring reviewer or harvester whose hook
  // reports incomplete cleanup IS quarantined like any other instance.
  if (!quarantine && !self) {
    for (const f of hookResults?.failures || []) ordinaryIncomplete.push(`retire hook ${f.capability}: ${f.message}`);
    // A hook may exit 0 and still report it did not finish. Only an explicit
    // "nothing to undo" counts as complete — same rule the rollback path uses.
    for (const [capId, m] of Object.entries(hookResults?.meta || {})) {
      if (m && typeof m === "object" && m.retired === false && m.reason !== "nothing-to-delete") {
        ordinaryIncomplete.push(`retire hook ${capId}: reported incomplete cleanup${m.reason ? ` (${m.reason})` : ""} — external state may remain`);
      }
    }
  }

  // Hooks are allowed to mutate the inspected tree, so inspect again after
  // them and preserve a separately verified post-hook snapshot when needed.
  const finalObservation = inspectRetirementWork(found.home, workPath, isWorktree, { branchDeletion, directory });
  if (finalObservation.classes.length && finalObservation.stateFingerprint !== stableObservation.stateFingerprint) {
    workRecoveries.push(preserveRetirementWork(finalObservation, meta, name));
    workRecovery = workRecoveries.at(-1);
  }

  // Lineage repair: any instance pointing at the retiree (parentInstance from a
  // child/parent relation, siblingInstance from a root-sibling link) would be
  // left dangling. Splice the retiree out of the graph: orphans inherit the
  // retiree's COMPLETE surviving lineage — both its parent and its sibling link,
  // whichever edge type pointed at it — so a parent-relation reviewer that
  // retires hands its children back to the parent it displaced at spawn AND
  // restores any sibling cluster link it had absorbed; a link-less retiree's
  // orphans become roots. The scan covers the deployment's agents root.
  // Instance names are only unique per agent dir, so a bare name match is NOT
  // identity: an edge is repaired only when the name, resolved from the
  // ORPHAN's agents root exactly as spawn resolves anchors, lands on the
  // retiring home — which is why the splice runs BEFORE the home is removed.
  const retireeHome = (() => { try { return realpathSync(found.home); } catch { return resolve(found.home); } })();
  const relinked = [];
  const inheritedParent = meta.parentInstance && meta.parentInstance !== name ? meta.parentInstance : undefined;
  const inheritedSibling = meta.siblingInstance && meta.siblingInstance !== name ? meta.siblingInstance : undefined;
  const edgeIsRetiree = (orphanRoot, orphanHome) => {
    if (resolve(orphanHome) === resolve(found.home)) return false; // the retiree itself
    const hit = findInstanceHome(orphanRoot, name);
    if (!hit) return false;
    try { return realpathSync(hit.home) === retireeHome; } catch { return false; }
  };
  const repair = (orphanRoot, instHome) => {
    const p = join(instHome, "instance.json");
    if (!existsSync(p)) return;
    let m; try { m = JSON.parse(readFileSync(p, "utf8")); } catch { return; }
    if (m.parentInstance !== name && m.siblingInstance !== name) return;
    if (!edgeIsRetiree(orphanRoot, instHome)) return; // same NAME, different instance — leave it
    // Drop every edge to the retiree, then graft the retiree's own links —
    // whichever edge TYPE referenced it, the orphan inherits the full slot
    // (parent AND sibling) so clusters stay connected across mixed edge types.
    if (m.parentInstance === name) delete m.parentInstance;
    if (m.siblingInstance === name) delete m.siblingInstance;
    if (!m.parentInstance && inheritedParent && inheritedParent !== m.instance) m.parentInstance = inheritedParent;
    if (!m.siblingInstance && inheritedSibling && inheritedSibling !== m.instance) m.siblingInstance = inheritedSibling;
    writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
    relinked.push({ instance: m.instance, parentInstance: m.parentInstance, siblingInstance: m.siblingInstance });
  };
  const scanRoot = (agentsRoot) => {
    for (const a of listAgents(agentsRoot)) {
      const dir = join(a._dir, "instances");
      if (!existsSync(dir)) continue;
      for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) repair(agentsRoot, join(dir, e.name));
    }
    for (const { dir: agentDir } of capabilityAgentDirs(agentsRoot)) {
      const dir = join(agentDir, "instances");
      if (!existsSync(dir)) continue;
      for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) repair(agentsRoot, join(dir, e.name));
    }
  };
  scanRoot((() => { try { return realpathSync(root); } catch { return root; } })());

  // K3b — retention is the default (lifecycle decision §1): the worktree,
  // branch and any PR outlive the home. The worktree cannot stay under
  // <home>/work once the home is removed, so it is RE-HOMED with
  // `git worktree move` to the deployment-level worktrees root and the move is
  // recorded in the receipt. `discardWorktree` restores removal; branch
  // deletion uses the VERIFIED current ref of the worktree, never the
  // spawn-time recorded name. A failed move keeps the home (fail closed).
  let retention = null;
  if (isWorktree && meta.repo) {
    const ref = existsSync(workPath) ? (() => { try { return worktreeRef(workPath); } catch { return { branch: null, oid: null }; } })() : { branch: meta.branch ?? null, oid: null };
    const verifiedBranch = ref.branch;
    // A branch cannot be deleted while a worktree has it checked out, so
    // --delete-branch implies discarding the worktree (which is what every
    // caller of it meant: clean up everything). Plain retire retains.
    if (o.discardWorktree || o.deleteBranch || quarantine) {
      shTry(`git -C ${shq(meta.repo)} worktree remove --force ${shq(workPath)}`);
      shTry(`git -C ${shq(meta.repo)} worktree prune`);
      retention = { worktree: "removed", branch: verifiedBranch, recordedBranch: meta.branch ?? null };
    } else if (existsSync(workPath)) {
      const repoName = basename(realPathOrNearest(meta.repo)).replace(/\.git$/, "") || "repo";
      const leaf = (verifiedBranch ?? `detached-${(ref.oid || "unknown").slice(0, 12)}`).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "work";
      const retainedRoot = join(workspaceOf(root), ".agents", "worktrees", repoName);
      mkdirSync(retainedRoot, { recursive: true });
      let dest = join(retainedRoot, leaf);
      for (let n = 2; existsSync(dest); n++) dest = join(retainedRoot, `${leaf}-${n}`);
      try {
        execFileSync("git", ["-C", meta.repo, "worktree", "move", workPath, dest], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_MAX_BUFFER });
      } catch (e) {
        throw oatsError("E_WORK_PRESERVATION_FAILED", `${name}: the worktree at ${workPath} could not be re-homed to ${dest} (${String(e.stderr ?? e.message ?? "").trim()}); the home is kept so nothing is lost — resolve and retry, or pass --discard-worktree to remove the worktree instead`);
      }
      retention = { worktree: "retained", movedTo: dest, branch: verifiedBranch, detachedAt: verifiedBranch === null ? ref.oid : null, recordedBranch: meta.branch ?? null };
    } else retention = { worktree: "absent", branch: verifiedBranch, recordedBranch: meta.branch ?? null };
    if (o.deleteBranch && verifiedBranch) {
      // A plan-driven caller passes the branch it CONFIRMED. Hooks may mutate
      // the tree during retirement, so the branch is re-verified here, at the
      // moment of deletion; a mismatch deletes nothing and says so.
      if (o.expectedBranch !== undefined && o.expectedBranch !== verifiedBranch) {
        retention.branchDeletionSkipped = { expected: o.expectedBranch, actual: verifiedBranch, reason: "the worktree's branch changed between confirmation and deletion; nothing was deleted" };
      } else {
        shTry(`git -C ${shq(meta.repo)} branch -D ${shq(verifiedBranch)}`);
        retention.branchDeleted = verifiedBranch;
      }
    } else if (o.deleteBranch && !verifiedBranch && o.expectedBranch !== undefined) {
      retention.branchDeletionSkipped = { expected: o.expectedBranch, actual: null, reason: "the worktree was detached or absent at deletion time; nothing was deleted" };
    }
  }
  if (retention) {
    if (retention.worktree === "retained") appendEvent(found.home, { kind: "worktree-retained", data: { movedTo: retention.movedTo, branch: retention.branch, recordedBranch: retention.recordedBranch } }, { workspaceOnly: true });
    else if (retention.worktree === "removed") appendEvent(found.home, { kind: "worktree-removed", data: { branch: retention.branch } }, { workspaceOnly: true });
    if (retention.branchDeleted) appendEvent(found.home, { kind: "branch-deleted", data: { branch: retention.branchDeleted } }, { workspaceOnly: true });
  }
  // `hooks`: which retire hooks ran (in order) and how each ended — the same
  // receipt `spawned` carries, so the workspace log shows both halves of a
  // capability's lifecycle after the home is gone.
  const retireHookReceipt = (() => { const res = hookResults || {}; const failedBy = new Map((res.failures || []).map((f) => [f.capability, f])); return (res.order || []).map((id) => ({ capability: id, ok: !failedBy.has(id), meta: Object.hasOwn(res.meta || {}, id) })); })();
  appendEvent(found.home, { kind: "retired", data: { agent: found.agent.name, keepDir: !!o.keepDir, self, quarantine: !!quarantine, workRecovery: workRecovery?.path ?? null, hooks: retireHookReceipt } }, { workspaceOnly: true });
  // Retrying a quarantine only clears it if compensation ACTUALLY completed.
  // Otherwise the home — and the credentials in it — must survive again, or the
  // retry becomes the deletion the quarantine was preventing.
  let stillIncomplete;
  let quarantineBranchDeleted = false;
  // Ordinary path: quarantine instead of deleting, using the SAME writer the
  // spawn rollback uses. Two copies of this logic is how a previous divergence
  // happened (see quarantineInstanceHome), so there is still exactly one.
  if (!quarantine && !self && ordinaryIncomplete.length) {
    const outstandingHooks = new Set();
    for (const f of hookResults?.failures || []) outstandingHooks.add(f.capability);
    for (const [capId, m] of Object.entries(hookResults?.meta || {})) {
      if (m && typeof m === "object" && m.retired === false && m.reason !== "nothing-to-delete") outstandingHooks.add(capId);
    }
    quarantineInstanceHome({
      home: found.home, instance: name, agent: found.agent,
      soulDir: instanceSoulDir(found.home, meta), soulId: nonEmptyString(meta.soulId) ? meta.soulId : undefined,
      incomplete: ordinaryIncomplete, failed: [...outstandingHooks],
      outstandingHooks, outstandingGit: new Set(),
      repoAbs: meta.repo, work: meta.work, branch: meta.branch,
      resolvedCfg: { capabilities: meta.capabilityRuntime || [] },
      hookMeta: meta.capabilityMeta || {}, compensationMeta: hookResults?.meta || {},
      reason: "retire hook reported incomplete cleanup",
    });
    stillIncomplete = ordinaryIncomplete;
  }
  if (quarantine) {
    const failures = (hookResults?.failures || []).map((f) => `retire hook ${f.capability}: ${f.message}`);
    // The quarantine may exist BECAUSE Git cleanup failed, so a retry has to
    // redo those steps and verify them — not just rerun hooks. The branch is
    // rollback-owned (spawn created it), so it is deleted here without needing
    // the normal-retire --delete-branch flag, and any failure keeps the home.
    if (meta.work === "worktree" && meta.repo) {
      const gitProbe = (argv) => {
        try { return { ok: true, out: execFileSync(argv[0], argv.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
        catch (e2) { return { ok: false, status: e2.status, err: String(e2.stderr ?? e2.message ?? "").trim() }; }
      };
      const wtCanonical = realPathOrNearest(workPath);
      gitProbe(["git", "-C", meta.repo, "worktree", "remove", "--force", workPath]);
      gitProbe(["git", "-C", meta.repo, "worktree", "prune"]);
      const wtProbe = gitProbe(["git", "-C", meta.repo, "worktree", "list", "--porcelain", "-z"]);
      if (!wtProbe.ok) failures.push(`git worktree ${wtCanonical}: could not verify removal (${wtProbe.err || "worktree list failed"})`);
      else {
        const registered = wtProbe.out.split("\0").filter((f) => f.startsWith("worktree ")).map((f) => f.slice("worktree ".length));
        if (registered.includes(wtCanonical)) failures.push(`git worktree ${wtCanonical}: still registered`);
      }
      if (meta.branch) {
        gitProbe(["git", "-C", meta.repo, "branch", "-D", meta.branch]);
        const br = gitProbe(["git", "-C", meta.repo, "rev-parse", "--verify", "--quiet", `refs/heads/${meta.branch}`]);
        if (br.ok) failures.push(`git branch ${meta.branch}: still exists`);
        else if (br.status !== 1 || br.err) failures.push(`git branch ${meta.branch}: could not verify deletion (${br.err || `rev-parse exit ${br.status}`})`);
        // Verified gone: the result must say so, or --json misreports the very
        // cleanup this path just performed.
        else quarantineBranchDeleted = true;
      }
    }
    for (const [capId, m] of Object.entries(hookResults?.meta || {})) {
      if (m && typeof m === "object" && m.retired === false && m.reason !== "nothing-to-delete") {
        failures.push(`retire hook ${capId}: reported incomplete cleanup${m.reason ? ` (${m.reason})` : ""}`);
      }
    }
    // The decisive check: not "did anything fail" but "did the work that was
    // outstanding actually happen". A retry that resolves zero capabilities —
    // because the descriptor named none, or config drifted since the spawn —
    // otherwise reports a clean sweep it never performed, and the home and its
    // credential go with it (reviewer-dd03a98).
    const ran = new Set(hookResults?.order || []);
    // Git debt is proven by the verification block above, which only runs for a
    // worktree in a known repo. If it could not run, the debt stands.
    if (quarantine.cleanup.outstanding?.git?.length && !(meta.work === "worktree" && meta.repo)) {
      failures.push(`git ${quarantine.cleanup.outstanding.git.join(", ")}: not re-verified on this retry, so the cleanup they owed is unverified`);
    }
    for (const capId of quarantine.cleanup.outstanding?.hooks || []) {
      if (ran.has(capId)) continue;
      const cap = (meta.capabilityRuntime || []).find((c) => c.id === capId);
      failures.push(cap && !cap.hooks?.retire
        ? `${capId}: declares no retire hook, so OATS cannot verify or undo what its failed spawn hook may have created — clean up by hand, then remove the home with \`oats retire ${name} --force\``
        : `retire hook ${capId}: did not run on this retry, so the cleanup it owed is unverified`);
    }
    if (!hookResults) failures.push("retire hooks could not be rerun (cleanup descriptor lost its context repo)");
    if (failures.length) {
      stillIncomplete = failures;
      try {
        writeFileSync(quarantinePath, JSON.stringify({ ...quarantine, incomplete: failures, lastRetryAt: new Date().toISOString() }, null, 2) + "\n");
      } catch { /* the quarantine stands regardless */ }
    }
  }
  // Forcing is the operator overriding the fail-closed default with their eyes
  // open: the home goes, and what remains outstanding is reported rather than
  // swallowed. Without this, a quarantine whose cleanup can never succeed (a
  // capability that offers no way to undo its own setup, a permanently
  // unreachable remote) would be unremovable through OATS forever — the same
  // dead end the unusable-marker fixes closed, just reached from a valid one.
  const forced = !!(stillIncomplete && o.force);
  if (!o.keepDir && (!stillIncomplete || forced)) {
    rmSync(found.home, { recursive: true, force: true });
    rmSync(directoryFallbackPath, { force: true });
    // The owed retirement is paid: clear the pending marker, and the failed
    // outcome an earlier deferred attempt may have left beside the home; a
    // deferred completion writes its own outcome after this returns.
    rmSync(retirePendingMarkerPath(found.home), { force: true });
    rmSync(deferredRetireResultPath(found.home), { force: true });
    rmSync(deferredRetireResultPath(found.home).replace(/\.json$/, ".log"), { force: true });
  }

  const result = { retired: name, agent: found.agent.name, workRecovery, workRecoveries: workRecoveries.length > 1 ? workRecoveries : undefined, retention, worktreeRemoved: isWorktree && retention?.worktree !== "retained", branchDeleted: !!(retention?.branchDeleted) || quarantineBranchDeleted, removedDir: !o.keepDir && (!stillIncomplete || forced), rollbackIncomplete: forced ? undefined : stillIncomplete, forcedIncomplete: forced ? stillIncomplete : undefined, retainedHome: stillIncomplete && !forced ? found.home : undefined, relinked: relinked.length ? relinked : undefined, capabilityMeta: hookResults?.meta, warnings: (() => {
    const w = [...(hookResults?.warnings || [])];
    if (isCapturedHome(meta) && !quarantine) {
      // A captured home retires through the workspace path; its captured retire hooks do not
      // run (lead decisions on (e), D1), so each capability whose spawn hook ran is named.
      const caps = capturedHomeCapabilities(meta);
      for (const cap of caps) w.push(`${cap}: its retire hook did NOT run (captured home; the captured/portable path was removed in 0.26) — identities/memberships it created are not revoked; remove them with the provider's own tooling`);
      if (!caps.length) w.push("captured home: no retire hook ran (the captured/portable path was removed in 0.26) — any identities/memberships its capabilities created are not revoked; remove them with the provider's own tooling");
    } else if (!Array.isArray(meta?.capabilityRuntime) && !quarantine) w.push("this home records no capability hooks (an earlier kernel spawned it): no retire hook ran; any external state its capabilities created is the operator's to clean up");
    return w.length ? w : undefined;
  })() };
  if (self) {
    // The caller is the instance: its process lives in the window we are about to
    // kill. Detach the kill so this function can return and the caller can report
    // before dying. The delay is the caller's window to print its last words.
    shTry(`tmux run-shell -b 'sleep ${o.selfKillDelaySec ?? 8}; tmux kill-window -t ${shq(`=${session}:=${name}`)} 2>/dev/null || true'`);
    result.selfKillScheduled = true;
  }
  return result;
}
