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
import { homedir } from "node:os";
import { accessSync, constants as fsConstants } from "node:fs";
import { recordLocalInput } from "./local-inputs.mjs";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { initializeNativeHistory, prepareNativeStart } from "../packages/record/lib/native-history.mjs";
import { noteRuntimeName } from "./deprecation.mjs";
import { attachSessionTarget } from "./session-viewer.mjs";
import { inspectSessionTarget, inputSessionTarget } from "./session-input.mjs";
import { appendEvent, liveWaiting, recordStartBoundary } from "./instance-events.mjs";
import { killGroup } from "./process-group.mjs";
import { captureLoginEnvironment } from "./login-environment.mjs";

import { oatsError, herdrInstanceBusy, herdrInstanceRemoved, herdrSettingRemoved, HERDR_REMOVED } from "./errors.mjs";
import { envRows, recordedTeams, teamsEnv } from "./teams.mjs";
import { PANE_PATH_FIX, harnessNotOnPanePath, harnessUnavailable, launchConfigUnknown, launchLayers, launchReport, selectionFrom } from "./launch-preference.mjs";
import { claudeTrusts, codexTrustsRoot, harnessTrustWarning } from "./harness-trust.mjs";
async function materializePreparedDefault(prepared, home) { const m = await import("./instance-resolution.mjs"); return m.materializePrepared(prepared, home); }
// Capability rows for a PREPARED spawn (workspace model): the one function that
// turns a Resolution's modules into the row shape hooks/environment/requirements/
// retirement consume. Called twice per spawn — PLANNED before the home exists
// (manifest, settings, origin, trust; no skills/inject since the copies are not
// there yet) and REBUILT after materialize against what actually landed. Static
// import: instance-resolution.mjs does not depend on core.mjs (no cycle).
import { cloneRemoteFor, toCapabilityRows } from "./instance-resolution.mjs";
import { GIT_FETCH_TIMEOUT_MS, GIT_TIMEOUT_MS, gitEnv } from "./remote.mjs";
import { loadLocal } from "./workspace.mjs";
import { parseConfigData } from "./config-data.mjs";
import { renderInstructionText } from "./instruction-composition.mjs";
import { APPROVED_HOOKS, PORTABLE_ENV_NAME_RE, CORE_LAUNCH_ENV, PROCESS_BOOTSTRAP_ENV, PROCESS_BOOTSTRAP_PREFIXES, manifestContractProblems, disposableHomeRootProblem, disposableHomeRootMatches } from "./capability-contract.mjs";
import { validateBindingInterface } from "./provider-binding.mjs";
/** Retirement/rollback tree fingerprint (exported for scope tests: kernel-field neutrality is opt-in per instance home),
 *  the exact digest a copied path is compared with (exported so a test holds it to the copier),
 *  and the receipts the stored digest passes over in a home (exported so a test holds the manifest grammar to refusing each of them). */
export { exactTreeDigest, fingerprintTree, KERNEL_HOME_RECEIPTS };

import { canonicalJson, lineAt, parseStrictJson } from "./canonical-json.mjs";
import { readPortableBytes } from "./bounded-read.mjs";
import { copyTreeSafe } from "./tree-copy.mjs";
import { assertSameWorktreeHead, gitRead, gitRepoRead, gitRepoRun, headName, worktreeCommitUnreached, worktreeHead } from "./instance-git.mjs";
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
/** The names of the non-hidden directories in `d` ([] when it cannot be read). */
function subdirs(d) {
  try { return readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name); } catch { return []; }
}
/** What OATS 0.25 left under <scope>/local-agents/ (and the nested <root>/local-agents|
 *  tmp-agents) for the agents root `root`: one `legacy-local-agents` problem naming the
 *  instance homes there, or null. Names only — nothing there is read, spawned into or
 *  retired from. */
export function legacyLocalAgents(root) {
  if (!root) return null;
  const bases = [join(dirname(root), LEGACY_LOCAL_AGENTS_DIR), join(root, LEGACY_LOCAL_AGENTS_DIR), join(root, "tmp-agents")];
  const dirs = [], instances = [];
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
/** The instance homes under the agents root `root` (a directory <root>/<agent>/instances/<name>
 *  whose instance.json records that name) that other users on the machine can read or enter (any
 *  group or other permission bit): one `home-readable` problem naming them, with the exact chmod,
 *  or null. A home holds identity keys, TASK.md and transcripts; spawn creates it 0700. Only
 *  reported: the operator decides. */
export function readableInstanceHomes(root) {
  if (!root) return null;
  const homes = [];
  for (const agent of subdirs(root)) for (const name of subdirs(join(root, agent, "instances"))) {
    const home = join(root, agent, "instances", name);
    try {
      if (JSON.parse(readFileSync(join(home, "instance.json"), "utf8"))?.instance !== name) continue;
      if (lstatSync(home).mode & 0o077) homes.push(home);
    } catch { /* no readable instance.json, or gone meanwhile: not a home */ }
  }
  if (!homes.length) return null;
  homes.sort();
  const fix = `chmod 700 ${homes.map(shq).join(" ")}`;
  return { code: "home-readable", homes, fix,
    message: `${homes.length} instance home${homes.length === 1 ? " can" : "s can"} be read by other users on this machine (${homes.length === 1 ? "it holds" : "they hold"} identity keys, TASK.md and transcripts); fix: ${fix}` };
}
/** The captured homes (the 0.24–0.25 captured/portable path, removed in 0.26) under the
 *  agents root `root`: one `legacy-captured-home` problem naming them, or null. They have
 *  no 0.26 runtime (start, inspect and in-home commands refuse them); retire still works. */
export function legacyCapturedHomes(root) {
  if (!root) return null;
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
// The tmux session a new tmux instance opens its window in, when oats-local.yaml session.tmuxSession
// names none (0.31). PI_AGENTS_TMUX_SESSION is the pre-0.31 variable, still honoured. The Desktop keeps
// the same default in packages/desktop/server/tmux-status.mjs (it does not import lib/): change both.
export const DEFAULT_TMUX_SESSION = process.env.OATS_TMUX_SESSION || process.env.PI_AGENTS_TMUX_SESSION || "oats-agents";
/**
 * The tmux session a NEW tmux launch opens its window in (0.31): the caller's, else the deployment's
 * oats-local.yaml `session.tmuxSession`, else OATS_TMUX_SESSION, else PI_AGENTS_TMUX_SESSION, else
 * oats-agents, read from `env` at call time. A launched home keeps the session it recorded: session
 * start/restart never read this.
 */
export function sessionDefaults(dir, { tmuxSession } = {}, env = process.env) {
  let local = null;
  try { local = loadLocal(dir); } catch (e) { if (e?.code !== "E_LOCAL_MISSING") throw e; }
  const declared = local?.local?.session ?? {};
  return { tmuxSession: tmuxSession || declared.tmuxSession || env.OATS_TMUX_SESSION || env.PI_AGENTS_TMUX_SESSION || "oats-agents" };
}
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
export function shq(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
/** One word of a command line that a person or an agent pastes into a shell: as it is when it holds
 *  only letters, digits and `_./:-`, single-quoted otherwise (an empty string too). The safe set is
 *  deliberately small: no `~` (an unquoted leading one expands), no `=` (zsh expands a leading
 *  `=word`). */
export function shellWord(s) { const word = String(s); return /^[A-Za-z0-9_.\/:-]+$/.test(word) ? word : shq(word); }
export function slug(s) {
  const r = String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return r || "agent";
}
/** `command -v <bin>`, once per (bin, PATH) in this process: the answer only changes with PATH. */
const whichMemo = new Map();
function which(bin) {
  const key = `${bin}\0${process.env.PATH ?? ""}`;
  if (!whichMemo.has(key)) whichMemo.set(key, shTry(`command -v ${shq(bin)}`));
  return whichMemo.get(key);
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
export const LAUNCH_CONFIG_KEYS = new Set(["harness", "runtime", "executable", "args", "env", "model", "yolo", "default"]);
/** A launch configuration's harness: `harness`, or `runtime`, its pre-0.27 name (0.26.0
 *  deployments wrote it) — read either (lead call 6). */
export const launchConfigHarness = (entry) => (Object.hasOwn(entry, "harness") ? entry.harness : entry.runtime);
const LAUNCH_CONFIG_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Environment the kernel sets for every launch (identity, home, roots) and
 *  its reference aliases: a configuration may not name them. */
export const RESERVED_LAUNCH_ENV = new Set(["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "OATS_AGENT", "OATS_SOUL", "OATS_SOUL_ID", "OATS_ROOT", "OATS_CONTEXT", "OATS_WORKSPACE", "OATS_EVENT", "OATS_SETTINGS", "OATS_SETTINGS_ORIGINS", "OATS_CLI_BIN", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT",
  // The test seam that replaces the login shell (lib/login-environment.mjs): never a launch's to set.
  "OATS_TEST_LOGIN_SHELL"]);
export const LAUNCH_REF_PREFIX = "OATS_LAUNCH_REF_";
const reservedLaunchEnv = (n) => RESERVED_LAUNCH_ENV.has(n) || n.startsWith(LAUNCH_REF_PREFIX);
export function validateLaunchConfig(name, entry, where) {
  const bad = (why) => { throw oatsError("E_LAUNCH_CONFIG_INVALID", `launch configuration ${JSON.stringify(name)}${where ? ` in ${where}` : ""} ${why}`); };
  if (typeof name !== "string" || !LAUNCH_CONFIG_NAME.test(name)) bad("has an invalid name (letters, digits, dot, underscore, dash; up to 64 characters)");
  if (name === "none") bad("cannot be named none: that word selects no configuration");
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) bad("must be a map");
  for (const key of Object.keys(entry)) if (!LAUNCH_CONFIG_KEYS.has(key)) bad(`has an unsupported key ${JSON.stringify(key)} (harness, executable, args, env, model, yolo, default)`);
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
  if (entry.default !== undefined && typeof entry.default !== "boolean") bad("default must be true or false");
  return entry;
}
/** At most one `default: true` per harness (0.32, feature launch-config-default): the host's baseline for
 *  that harness has one source. `map` is name → entry; entries are validated first. */
export function validateLaunchConfigDefaults(map, where) {
  const byHarness = new Map();
  for (const [name, entry] of Object.entries(map || {})) {
    if (entry?.default !== true) continue;
    const harness = launchConfigHarness(entry);
    if (byHarness.has(harness)) throw Object.assign(oatsError("E_LAUNCH_CONFIG_INVALID", `launch configurations ${JSON.stringify(byHarness.get(harness))} and ${JSON.stringify(name)}${where ? ` in ${where}` : ""} are both default: true for ${harness}; keep one default per harness`), { details: { harness, configurations: [byHarness.get(harness), name] } });
    byHarness.set(harness, name);
  }
}
function validateLaunchConfigs(map, file) {
  if (map === undefined) return;
  if (!map || typeof map !== "object" || Array.isArray(map)) throw oatsError("E_LAUNCH_CONFIG_INVALID", `launch-configs in ${file} must be a map of name to configuration`);
  for (const [name, entry] of Object.entries(map)) validateLaunchConfig(name, entry, file);
  validateLaunchConfigDefaults(map, file);
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
    out[name] = { name, harness: launchConfigHarness(entry), ...(entry.executable !== undefined ? { executable: entry.executable } : {}), args: [...(entry.args || [])], env: { ...(entry.env || {}) }, ...(entry.model !== undefined ? { model: entry.model } : {}), ...(entry.yolo !== undefined ? { yolo: entry.yolo } : {}), ...(entry.default === true ? { default: true } : {}), source, shadows: [] };
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
  // Launch environment, hooks and retirement: the shared manifest contract
  // (lib/capability-contract.mjs). The error carries the problem's JSON pointer.
  const problem = manifestContractProblems(m)[0];
  if (problem) throw Object.assign(new Error(problem.message), { pointer: problem.pointer });
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
  // `agents:` (capability-defined agents) was removed in 0.29.0: resolution refuses a module that
  // declares it (E_CAPABILITY_AGENTS_REMOVED). A copy already recorded in a home still loads here,
  // so that home launches and retires; nothing reads the key.
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
  // An OATS_PACKAGE_CATALOG override is local configuration (observation.localRevision); the bundled
  // catalog belongs to the kernel install.
  const override = !!process.env.OATS_PACKAGE_CATALOG;
  if (!existsSync(file)) { if (override) recordLocalInput(file, null); return empty; }
  const text = readFileSync(file, "utf8");
  if (override) recordLocalInput(file, text);
  return parsePackageCatalog(text, file);
}
/** A package catalog's text, parsed and checked as the kernel reads it (named `file` in errors):
 *  { packages, capabilities, file }, both maps null-prototype; invalid-source when it is broken. */
export function parsePackageCatalog(text, file) {
  let doc;
  try { doc = JSON.parse(text); }
  catch (e) {
    // JSON.parse does not say where; the kernel's strict reader (same grammar) locates the error.
    let line;
    try { parseStrictJson(text, { maxBytes: 64 * 1024 * 1024 }); } catch (s) { if (Number.isInteger(s.provenance?.offset)) line = lineAt(text, s.provenance.offset); }
    throw oatsError("invalid-source", `broken package catalog ${file}${line ? ` (line ${line})` : ""}: ${e.message}`);
  }
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
  // package identity (oats.developer is exported by package oats.engineering).
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
    workspace: { key: prepared.discovery?.key ?? null, name: prepared.discovery?.workspace?.name ?? null, deployment: prepared.deployment ?? null, commit: prepared.discovery?.commit ?? null, standalone: prepared.discovery?.standalone === true, revision: prepared.resolution.revision, slots: prepared.resolution.slots },
    payloads: prepared.resolution.payloads ?? {},
    teams: prepared.resolution.teams ?? [], defaultTeam: prepared.resolution.defaultTeam ?? null, teamsSource: "live",
    layers: layerRows(prepared.resolution),
    launchConfigs: launchConfigsAt(contextDir || prepared.deployment),
  };
}

/** The resolved view of an EXISTING home: what it recorded at spawn (its
 *  capability rows, workspace and payloads) and its deployment's launch
 *  configurations. Never re-resolved against the scope. The one live part is
 *  the teams (team model v2): a caller that computed the home's live teams
 *  (liveTeams) passes them; otherwise the spawn-time record. */
export function resolvedFromHome(home, meta, { teams, defaultTeam, teamsSource } = {}) {
  const ws = meta?.workspace && typeof meta.workspace === "object" ? meta.workspace : null;
  const messaging = (Array.isArray(meta?.capabilities) ? meta.capabilities : []).find((c) => c?.layer === "messaging")?.id ?? null;
  const t = Array.isArray(teams) ? { teams, defaultTeam: defaultTeam ?? null, teamsSource: teamsSource === "live" ? "live" : "recorded" } : { ...recordedTeams(meta), teamsSource: "recorded" };
  return {
    capabilities: Array.isArray(meta?.capabilityRuntime) ? meta.capabilityRuntime : [],
    workspace: ws ? { ...ws, slots: { messaging } } : null,
    payloads: meta?.providers ?? {},
    ...t,
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
      if (cap.injectDeclared) expected.push({ type: "injection", source: cap.id, declared: cap.injectDeclared, path: undefined, deferred: "materialize", origin: cap.origin, module: cap.id });
      continue;
    }
    for (const s of cap.skillsDeclared || []) {
      add({ type: "skill-tree", source: cap.id, declared: s.declared, path: s.path, origin: cap.origin, level: cap.level });
    }
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
    /** The executable is SELECTED by the launch (a configuration may name a wrapper
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
 * plus the team/workspace facts (teamEnv: OATS_TEAM_SCOPE, OATS_DEFAULT_TEAM*, OATS_TEAMS, OATS_WORKSPACE_NAME/_KEY);
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
/** A triggered instance's event, inside its home's .oats/ (lib/triggers.mjs). */
export const TRIGGER_EVENT_FILE = "trigger-event.json";
/** A prepared soul entry's id: `<repoKey>#<name>` for a member or external soul, `package:<id>#<name>`
 *  for a package soul (stable across the package's versions and independent of its repo). */
export const preparedSoulIdOf = (entry) => workspaceSoulId(typeof entry.package === "string" ? `package:${entry.package}` : entry.repoKey, entry.name);
/** The soul directory an instance incarnates, as spawn recorded it (instance.json
 *  `soulDir`): a workspace soul's per-commit copy (agents/<soul>/souls/<commit12>) or
 *  the read-only soul inside a capability package. It is what every classic
 *  lifecycle hook and dispatched command sees as OATS_SOUL (captured hooks set
 *  none); instance homes carry no soul link. */
export function instanceSoulDir(home, meta = undefined) {
  if (meta === undefined && home) { try { meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8")); } catch { meta = null; } }
  return typeof meta?.soulDir === "string" && isAbsolute(meta.soulDir) ? meta.soulDir : undefined;
}

/** The team and workspace facts a lifecycle hook, command or provider check receives (workspace
 * model only, lead decision c3-7): OATS_TEAM_SCOPE is the deployment directory; OATS_WORKSPACE_NAME /
 * _KEY the workspace's name and canonical key; OATS_TEAM_NAME (the 0.25 `team:` block's name) is always
 * empty, so an ambient value never reaches a hook.
 *
 * Team model v2 (docs/desktop-cli-api.md, The provider environment): `resolved.teams` are the soul's
 * TeamRows here and `resolved.defaultTeam` its DefaultTeam; teamsEnv sets OATS_DEFAULT_TEAM(_ID,_FROM),
 * OATS_TEAMS (mapped rows only) and OATS_TEAMS_SOURCE (`live`: the workspace + oats-local.yaml read now,
 * or a fresh resolution; `recorded`: the spawn-time record). A provider LEAVES a joined team only on a
 * `live` list. Teams not known (`resolved.teams` not an array): every team name unset. */
export function teamEnv(resolved) {
  const ws = resolved?.workspace && typeof resolved.workspace === "object" ? resolved.workspace : {};
  const known = Array.isArray(resolved?.teams);
  return {
    OATS_TEAM_NAME: "", OATS_TEAM_SCOPE: typeof ws.deployment === "string" ? ws.deployment : "",
    ...teamsEnv(known ? { teams: resolved.teams, defaultTeam: resolved.defaultTeam ?? null, source: resolved.teamsSource } : null),
    OATS_WORKSPACE_NAME: typeof ws.name === "string" ? ws.name : "", OATS_WORKSPACE_KEY: typeof ws.key === "string" ? ws.key : "",
  };
}
function withoutAmbientLaunchPreview(env) {
  const { OATS_LAUNCH_PREVIEW: _ambient, ...rest } = env;
  return rest;
}
export function runLifecycleHooks(event, { home, instance, agentName, soulDir, soulId, contextDir, workspaceDir, rootDir, resolved, priorMeta = {}, extraEnv = {}, assertRoots }) {
  const results = { meta: {}, briefs: [], warnings: [], order: [], launch: {}, env: {}, failures: [], contributions: [], volatileEnv: {} };
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
          // OATS_LAUNCH_PREVIEW is the kernel's to give (prepareLaunchHooks), never
          // inherited: a real start's hook must not read an ambient one as a preview.
          ...withoutAmbientLaunchPreview(process.env),
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
          OATS_CLI_BIN: kernelBin(),
          OATS_SETTINGS: JSON.stringify(cap.settings || {}),
          // Where each leaf of OATS_SETTINGS came from (JSON pointer → { kind, at }; kind is
          // manifest-default | workspace | soul | host | spawn | anchor), so a provider can tell a
          // soul-set value from a host-set one. {} when the home recorded none (spawned before 0.29).
          OATS_SETTINGS_ORIGINS: JSON.stringify(cap.settingsOrigins || {}),
          OATS_META: JSON.stringify(priorMeta[cap.id] || {}),
        },
      }).trim();
      const lastLine = stdout.split("\n").filter(Boolean).pop() || "{}";
      let o = {};
      try { o = JSON.parse(lastLine); } catch { /* non-JSON hook output is fine */ }
      if (o.meta) results.meta[cap.id] = o.meta;
      // A launch hook's answer as given; prepareLaunchHooks validates it.
      if (event === "launch" && o.volatileEnv !== undefined) results.volatileEnv[cap.id] = o.volatileEnv;
      if (o.brief) results.briefs.push(`- ${o.brief}`);
      if (o.warning) results.warnings.push(o.warning);
      if (o.launch && typeof o.launch === "object") for (const [rt, args] of Object.entries(o.launch)) results.launch[rt] = `${results.launch[rt] ? `${results.launch[rt]} ` : ""}${args}`;
      // Provenance of what this capability contributed to the launch: which
      // harnesses it answered launch args for, and which env names, under
      // which settings and trust. A later start or harness switch reads this.
      // A launch hook's run is recorded even when its answer is empty: an
      // empty answer replaces what the provider contributed before.
      if (event === "launch" || (o.launch && typeof o.launch === "object" && Object.keys(o.launch).length) || (o.env && typeof o.env === "object" && Object.keys(o.env).length)) {
        results.contributions.push({ capability: cap.id, layer: cap.layer || null, level: cap.level || null, settings: { ...(cap.settings || {}) }, settingsOrigins: { ...(cap.settingsOrigins || {}) }, trust: { trusted: !!cap.trust?.trusted, integrity: cap.trust?.integrity || null }, launch: o.launch && typeof o.launch === "object" ? { ...o.launch } : {}, env: o.env && typeof o.env === "object" ? Object.keys(o.env).sort() : [] });
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
  // A package soul homes at <package>--<soul> (lib/workspace.mjs packageSoulAgentName): that
  // directory, not the soul.yaml name, is its agent name, so its instances never share a
  // member soul's name or roster row.
  soul.name = basename(agentDir).includes("--") ? basename(agentDir) : (soul.name || basename(agentDir));
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
  if (n.length <= MAX_INSTANCE_NAME) return n;
  if (!purpose) throw nameTooLong(n, `the soul name "${agent.name}" is too long to derive an instance name from; pass a shorter --name`);
  // Say the budget: the name is <agent name>-<purpose>[-<n>], and a package soul's agent name
  // carries its package id (oats-okf-knowledge-maintainer-…), so its purposes are short.
  const p = slug(purpose), prefix = `${slug(agent.name)}-`, suffix = n.length - prefix.length - p.length;
  const budget = Math.max(0, MAX_INSTANCE_NAME - prefix.length - suffix);
  throw Object.assign(nameTooLong(n, `the purpose ${JSON.stringify(p)} is ${p.length} characters; ${agent.name}'s instances are named ${prefix}<purpose>${suffix > 0 ? "-<n>" : ""}, which leaves at most ${budget} for the purpose — shorten it, or pass --name`), { details: { prefix, purpose: p, maxPurpose: budget } });
}
// The stem is the agent name AS A SLUG: a package soul's agent name holds `--`
// (acme-pkg--keeper) and its instances are acme-pkg-keeper-<purpose>, so the name
// that is length-checked and de-duplicated here is the one the home gets.
function deriveInstanceName(root, agent, purpose, prepared) {
  const stem = slug(agent.name);
  const base = purpose ? `${stem}-${slug(purpose)}` : undefined;
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
  do { n = `${stem}-${i++}`; } while (taken(n));
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
/** The window names of `session` on the user's DEFAULT tmux server: only for a home that records no
 *  socket (listInstances). OATS creates nothing there: new sessions live on the OATS server below. */
export function tmuxWindows(session = DEFAULT_TMUX_SESSION) {
  if (!tmuxAlive(session)) return [];
  return (shTry(`tmux list-windows -t ${shq(session)} -F '#{window_name}'`) || "").split("\n").filter(Boolean);
}

// ---------- the OATS tmux server ----------
/** The tmux server OATS creates its sessions on, selected by name (`tmux -L oats`): one per host user,
 *  in tmux's own per-user socket directory, with the user's tmux configuration loaded (no `-f`). A
 *  tool that restyles the default server does not reach it. Not configurable. The name selects the
 *  server only while a session is ensured (ensureOatsTmuxSession); every later step, and every record,
 *  uses the absolute socket that step returned, through tmuxOn. docs/execution-targets.md owns the rule. */
const OATS_TMUX_SERVER = "oats";
/** What OATS sets, always at WINDOW scope and by window id, on a window it created: nothing is ever
 *  set server-global or on a session, on any server. Sizing goes on every window OATS creates (the
 *  session's `hq` window and each agent window): viewers attach at their own size and depend on both
 *  options, and a viewer links the window itself, so the window's options travel with it. A sizing
 *  command that tmux refuses is ignored, as it always was (tmux 3.0 has no `window-size latest`).
 *  Colours go on the agent window only: it shows the viewer's colours whatever the server's global
 *  styles are, and a refused colour command fails the launch. */
const OATS_WINDOW_SIZING = [["window-size", "latest"], ["aggressive-resize", "on"]];
const OATS_WINDOW_COLOURS = [["window-style", "default"], ["window-active-style", "default"]];
function tmuxOatsServer(args, io, options = {}) {
  return (io?.exec || execFileSync)("tmux", ["-u", "-L", OATS_TMUX_SERVER, ...args], { encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...options });
}
const tmuxFailure = (e, fallback) => String(e?.stderr ?? e?.message ?? "").trim() || fallback;
/** An error OATS raised itself (a root guard under an injected exec), never one a tolerant read may absorb. */
const oatsCoded = (e) => typeof e?.code === "string" && e.code.startsWith("E_");
/** A failed call that ran to its own exit: it has a status, no signal ended it, and Node reports no
 *  failure of its own. A timeout and an output overflow carry a code and keep what the call had
 *  printed until then, so that text is not the call's answer. Anything else is not a completed call. */
const exitedByItself = (e) => Number.isInteger(e?.status) && e.signal == null && e.code == null;
/** What the OATS server holds, as `list-sessions` answers: whether it runs, its socket (any session
 *  names it), and whether a session named exactly `session` is there. No server and no such session
 *  are the only answers that mean absent, and "no server" is read only from a call that exited by
 *  itself: a line a cut-off call left behind is not tmux's answer. Any other failure is not absence. */
function oatsTmuxSessionSocket(session, io) {
  let listed;
  try { listed = tmuxOatsServer(["list-sessions", "-F", "#{session_name}\t#{socket_path}"], io); }
  catch (e) {
    if (oatsCoded(e)) throw e;
    // A tmux that could not be run at all is the one failure a person can act on: say so.
    if (e?.code === "ENOENT") throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `could not read the OATS tmux server for session ${session}: tmux was not found through this process's PATH. Run this command with a PATH that holds tmux`);
    if (!exitedByItself(e)) throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `could not read the OATS tmux server for session ${session}: tmux list-sessions did not exit by itself (${typeof e?.code === "string" ? e.code : e?.signal || "no exit status"})`);
    if (tmuxServerLost(e)) return { server: null, present: false };
    throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `could not read the OATS tmux server for session ${session}: ${tmuxFailure(e, "tmux list-sessions failed")}`);
  }
  let server = null, present = false;
  for (const line of listed.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    server ??= line.slice(tab + 1).trim() || null;
    if (line.slice(0, tab) === session) { server = line.slice(tab + 1).trim() || null; present = true; break; }
  }
  return { server, present };
}
/** The names that mark a process as an OATS instance: the launch identity, and what older kernels
 *  called it. One of them in the environment, even empty, is evidence of an instance. */
const INSTANCE_IDENTITY_ENV = ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME"];
/** Every name the kernel itself generates into a launch or a hook environment, and the three that
 *  tie a process to its own terminal. None of them is part of an environment OATS starts a tmux
 *  server, a session or a window with. Not the whole OATS_ prefix: operators export configuration
 *  under it (OATS_HOME_DIR, OATS_TMUX_SESSION). The inventory: RESERVED_LAUNCH_ENV; what
 *  runLifecycleHooks adds for a hook (capability, layer, level, meta, the spawn and launch facts in
 *  its extraEnv, the team and workspace names of teamEnv); what operator dispatch, retire and a
 *  trigger add. Launch references (OATS_LAUNCH_REF_<NAME>, and the NAME each stands for) are
 *  removed by prefix in withoutKernelEnvironment. No harness's name is here. */
const KERNEL_ENV_NAMES = new Set([...RESERVED_LAUNCH_ENV, "COLORFGBG", "TMUX", "TMUX_PANE",
  "OATS_CAPABILITY", "OATS_LAYER", "OATS_LEVEL", "OATS_META", "OATS_DEPLOYMENT", "OATS_RESOLUTION", "OATS_OPERATION",
  "OATS_REPO", "OATS_BRANCH", "OATS_WORK", "OATS_KIND", "OATS_TASK", "OATS_HARNESS", "OATS_PREVIOUS_HARNESS", "OATS_RUNTIME", "OATS_PREVIOUS_RUNTIME",
  "OATS_LAUNCH_PREVIEW", "OATS_RETIRE_INTENT", "OATS_TRIGGER_EVENT_FILE",
  "OATS_TEAM_NAME", "OATS_TEAM_SCOPE", "OATS_TEAM_ID", "OATS_TEAM_LABEL", "OATS_TEAM_LABELS", "OATS_TEAMS", "OATS_TEAMS_SOURCE",
  "OATS_DEFAULT_TEAM", "OATS_DEFAULT_TEAM_ID", "OATS_DEFAULT_TEAM_FROM", "OATS_WORKSPACE_NAME", "OATS_WORKSPACE_KEY"]);
function withoutKernelEnvironment(source) {
  const env = { ...source };
  for (const name of Object.keys(env)) {
    if (name.startsWith(LAUNCH_REF_PREFIX)) { delete env[name]; delete env[name.slice(LAUNCH_REF_PREFIX.length)]; }
  }
  for (const name of KERNEL_ENV_NAMES) delete env[name];
  return env;
}
/**
 * What `tmux show-environment -g -s` printed, as bytes, read strictly and never executed: the whole
 * text or nothing. tmux (cmd-show-environment.c) prints one entry per variable, each ending in a
 * line feed: `NAME="VALUE"; export NAME;` with `"`, `$`, a backtick and `\` in VALUE each preceded
 * by a backslash, or `unset NAME;` for a removed one. VALUE is read to its closing unescaped quote
 * (a backslash escapes the character after it), so a line feed inside a value stays inside it.
 *
 * Not every value can be known the same way on every tmux. tmux 3.4 and 3.5 write each printed
 * line through vis(3) (server-client.c server_client_print): a control character or a byte that is
 * not UTF-8 arrives as `\a`, `\b`, `\f`, `\r`, `\v` or three octal digits, and tmux 3.4 puts one
 * more backslash before a `$` that a letter, `_` or `{` follows (utf8.c utf8_strvis). Neither
 * changes where a value ends. So nothing is decoded: a variable is left out whole when its VALUE
 * holds a line feed, a `$` (escaped or bare, on every version), or a vis-encoded sequence. A
 * backtick, a quote and a backslash are written the same by every version read, and are carried.
 *
 * Kept: an entry whose NAME is a plain identifier and whose VALUE is none of the above; an `unset`
 * entry carries nothing, and its name is added to `cleared` when the caller passes one (tmux keeps
 * such an entry, and it masks the variable: a session's `unset PATH;` gives its panes no PATH). An
 * entry is left out only once it is framed whole (its name, its value to the closing quote, the
 * exact `; export NAME;` tail); its name is added to `omitted` when the caller passes one. So a
 * name is in the result, in `cleared`, in `omitted`, or absent from the text. null for bytes that
 * are not valid UTF-8 or that this grammar does not consume to the end: a caller refuses, it never
 * uses a partial result.
 */
export function parseTmuxShellEnvironment(bytes, omitted, cleared) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return null; }
  const env = {};
  let i = 0;
  const take = (word) => { if (!text.startsWith(word, i)) return false; i += word.length; return true; };
  while (i < text.length) {
    if (take("unset ")) {
      const end = text.indexOf(";", i);
      if (end <= i || /[\s"=]/.test(text.slice(i, end))) return null;
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(text.slice(i, end))) cleared?.push(text.slice(i, end));
      i = end + 1;
    } else {
      const assign = text.indexOf("=\"", i);
      if (assign <= i) return null;
      const name = text.slice(i, assign);
      i = assign + 2;
      let value = "", closed = false, carried = true;
      while (i < text.length) {
        const c = text[i++];
        if (c === "\"") { closed = true; break; }
        if (c === "$") { carried = false; continue; }
        if (c === "`") return null; // tmux never writes a bare backtick
        if (c !== "\\") { value += c; continue; }
        const next = text[i];
        if (next === "$") { carried = false; i += 1; }
        else if (next !== undefined && "\"`\\".includes(next)) { value += next; i += 1; }
        else if (/^(?:[abfrv]|[0-7]{3})/.test(text.slice(i, i + 3))) { carried = false; i += /[0-7]/.test(next) ? 3 : 1; }
        else return null;
      }
      if (!closed || !take(`; export ${name};`)) return null;
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        if (carried && !value.includes("\n")) env[name] = value; else omitted?.push(name);
      }
    }
    if (!take("\n")) return null;
  }
  return env;
}
/** Whether this process runs inside an OATS instance, as the CLI resolves an in-home command:
 *  `{ home }` for the home OATS_INSTANCE_HOME names when it is one, else the instance home enclosing
 *  the working directory (a harness may strip the session environment). `{ evidence }` when neither
 *  gives a home and yet the environment carries an instance identity name: an instance's environment
 *  without an identified home is not "outside an instance". undefined otherwise. */
function callerInstance() {
  const named = process.env.OATS_INSTANCE_HOME;
  if (named && isAbsolute(named)) {
    try { if (isPlainObject(JSON.parse(readFileSync(join(named, "instance.json"), "utf8")))) return { home: named }; }
    catch { /* names no home */ }
  }
  const enclosing = enclosingInstanceHome(logicalCwd());
  if (enclosing) return { home: enclosing };
  const evidence = INSTANCE_IDENTITY_ENV.find((name) => process.env[name] !== undefined);
  return evidence ? { evidence } : undefined;
}
/** `tmux` as this process's own PATH finds it, always absolute: the creator chooses the tmux that
 *  runs, whatever environment the server it starts is given. A bare name is never run: an exec
 *  looks one up in the PATH of the environment it is passed, which here is the selected one.
 *  Entries in PATH order; a relative entry, and an empty one (an empty PATH is one empty entry),
 *  are this process's working directory, as an exec of `tmux` reads them. With no PATH, or none
 *  that holds a tmux, the creation of `session` is refused, for every creator: no default search
 *  path is assumed. Of the two, only "no PATH" is met in a run: the lookup before this runs the
 *  bare name with this process's own environment, so a PATH that holds no tmux is refused there
 *  first (oatsTmuxSessionSocket), session or no session. The no-match refusal here is the guard
 *  that the creation never runs a bare name, whatever the lookup did. */
function creatorTmux(session) {
  const refuse = (why) => oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `cannot create tmux session ${session} on the OATS tmux server: ${why}, and the tmux that creates a session is the one this process's own PATH finds; the session was not created. Run this command with a PATH that holds tmux`);
  if (process.env.PATH === undefined) throw refuse("PATH is not set in this process");
  const found = lookupOnPath("tmux", process.env.PATH);
  if (found) return found;
  throw refuse("no tmux was found on this process's PATH");
}
/** `name` as an exec looks it up on `path`: the first entry, in order, that holds a regular
 *  executable file of that name, as an absolute path; null when none does. A relative entry, and
 *  an empty one (an empty PATH is one empty entry), are `cwd`. Nothing is run. */
function lookupOnPath(name, path, cwd = process.cwd()) {
  for (const dir of path.split(":")) {
    const candidate = resolve(cwd, dir || ".", name);
    try { accessSync(candidate, fsConstants.X_OK); if (statSync(candidate).isFile()) return candidate; } catch { /* not here */ }
  }
  return null;
}
/**
 * The environment a `new-session` on the OATS server runs with: the only tmux call that can start
 * a server, so every one of them gets this, whether or not a server was seen a moment earlier. A
 * tmux server keeps the environment of the client that started it as its global environment, which
 * every pane created on it later inherits, and a new session takes the client's variables that
 * `update-environment` names.
 *
 * When no server answered the lookup (`startsServer`), so that this new-session starts it, the
 * environment is the user's login environment (lib/login-environment.mjs), for every creator: what
 * the login shell from the password database sets up, from a seed that holds nothing of the creator
 * but its locale and, when it is no instance, its session variables (an instance's come from the
 * server its home records, then from the platform's user session). The kernel's names and the
 * instance-identity names are removed from what it answers, and the operator's OATS configuration
 * (OATS_ and PI_AGENTS_ names that are not the kernel's) is the creator's (an instance's: its recorded
 * server's). When it cannot be read (a creator whose HOME is not the user's home directory, a
 * timeout, a non-zero exit, a partial or malformed answer, no HOME or PATH, a shell that is not bash,
 * zsh or fish), one line on stderr says so and names the fallback, never a value, and the creator falls
 * back to what follows. That fallback is degraded: neither a login environment nor a working agent
 * socket is assured.
 *
 * Otherwise (the server runs, or the login environment could not be read): a process inside an OATS
 * instance never passes its own environment (its harness's variables, its credentials, its
 * identity). It passes the global environment of the tmux server its home records: an existing
 * baseline, chosen because a window that instance opened on that server got exactly it; not proof
 * that it holds nothing old. The home's receipt is checked against instance.json first, as every
 * session verb checks its endpoint, and the text is read with the strict reader above, which can
 * leave values out. When any of that fails, or no home is identified, the session is not created:
 * no fallback to the caller's environment, to another server or to a built-in list. Any other
 * creator (an operator's shell, a schedule runner, the Desktop) passes its own environment. In
 * every case the kernel's names are removed from the final set.
 *
 * Environment and endpoint are chosen separately: which server is reached depends only on the
 * creator (its TMUX_TMPDIR, kept or absent as the creator has it, whatever the selected environment
 * says; its tmux); what the server process gets (HOME and so its configuration file, PATH,
 * everything else) comes from the selected environment, with no ambient value filling in. Values
 * travel only as the environment of that tmux process: never in an argument, a message, an event or
 * a file. docs/execution-targets.md owns the rule.
 */
const TMUX_SERVER_START_ENV = ["HOME", "XDG_CONFIG_HOME", "PATH", "SHELL"];
/** The operator's configuration names, carried into a server started with the login environment
 *  (the kernel's own names among them are removed first). */
const OPERATOR_CONFIG_ENV = /^(OATS_|PI_AGENTS_)/;
function oatsSessionEnvironment(session, io, { startsServer = false } = {}) {
  const caller = callerInstance();
  let recorded;
  const recordedServer = () => (recorded ??= recordedServerEnvironment(caller, session, io));
  const creatorsTmpdir = (env) => { if (process.env.TMUX_TMPDIR === undefined) delete env.TMUX_TMPDIR; else env.TMUX_TMPDIR = process.env.TMUX_TMPDIR; return env; };
  if (startsServer) {
    const login = captureLoginEnvironment({ creatorEnv: process.env, instance: !!caller, recorded: caller ? recordedServer().read : null, shell: process.env.OATS_TEST_LOGIN_SHELL || undefined });
    if (login.env) {
      for (const note of login.notes) process.stderr.write(`oats: warning: ${note}\n`);
      const env = withoutKernelEnvironment(login.env);
      for (const name of INSTANCE_IDENTITY_ENV) delete env[name];
      // The operator's own OATS configuration (OATS_HOME_DIR, OATS_TMUX_SESSION, OATS_PACKAGE_CATALOG,
      // any other OATS_ or PI_AGENTS_ name that is not the kernel's) stays the creator's, over what
      // the login shell set: a creator outside every instance gives its own; an instance, what the
      // server its home records has, never its own.
      const configured = caller ? recordedServer().read : process.env;
      for (const [name, value] of Object.entries(withoutKernelEnvironment(configured ?? {}))) if (OPERATOR_CONFIG_ENV.test(name)) env[name] = value;
      return creatorsTmpdir(env);
    }
    const fallback = !caller ? "this process's own environment" : recordedServer().error ? null : "a copy of the environment of the tmux server this instance's home records";
    process.stderr.write(`oats: warning: could not read your login environment (${login.failure}); ${fallback ? `the OATS tmux server is started with ${fallback} instead: a fallback, neither a login environment nor a working agent socket is assured` : "and there is no fallback from inside an instance"}\n`);
  }
  if (!caller) return withoutKernelEnvironment(process.env);
  const { env, error } = recordedServer();
  if (error) throw error;
  return creatorsTmpdir(env);
}
/** The global environment of the tmux server an instance's home records, read strictly: `read` (what
 *  the reader kept, or null), and `env` (a copy without the kernel's names) or `error` (the refusal
 *  a creation from inside an instance gets when it cannot use it). */
function recordedServerEnvironment(caller, session, io) {
  const refuse = (why) => oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `cannot create tmux session ${session} on the OATS tmux server from inside an OATS instance: ${why}. A tmux server and its sessions keep the environment of the process that creates them, and an instance's own environment must not become theirs; the session was not created. Create it from your own shell, outside every instance home (tmux -L ${OATS_TMUX_SERVER} new-session -d -s ${shellWord(session)} -n hq), or run this command there. tmux resolves -L ${OATS_TMUX_SERVER} with TMUX_TMPDIR: use the same TMUX_TMPDIR as this process, if it has one`);
  if (!caller.home) return { read: null, error: refuse(`this process carries an instance's identity (${caller.evidence}) and neither OATS_INSTANCE_HOME nor the working directory names its home`) };
  let target;
  try { target = instanceSessionTarget(caller.home).target; }
  catch (e) { if (!oatsCoded(e)) throw e; return { read: null, error: refuse(`the session receipt of ${basename(caller.home)} could not be used (${e.code})`) }; }
  if (!target?.socket) return { read: null, error: refuse(`the home of ${basename(caller.home)} records no tmux server`) };
  // Bytes, not text; and nothing of a failed read (tmux's output, its error) goes into the refusal.
  let read = null;
  const omitted = [];
  try {
    const printed = (io?.exec || execFileSync)("tmux", ["-u", "-S", target.socket, "show-environment", "-g", "-s"], { timeout: 10000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    read = parseTmuxShellEnvironment(Buffer.isBuffer(printed) ? printed : Buffer.from(String(printed)), omitted);
  } catch (e) { if (oatsCoded(e)) throw e; }
  if (read === null) return { read, error: refuse(`the environment of the tmux server that ${basename(caller.home)} is recorded on (${target.socket}) could not be read`) };
  // A variable the reader left out is never filled in from this process, and a server is never
  // started when the one left out decides which configuration it loads or which programs it runs.
  // (A recorded server that simply has none of them is copied as it is.)
  const undecided = TMUX_SERVER_START_ENV.find((name) => omitted.includes(name));
  if (undecided) return { read, error: refuse(`the tmux server that ${basename(caller.home)} is recorded on has a ${undecided} that cannot be carried over (its value holds a $, a line break or a character tmux prints encoded), and a tmux server's configuration and programs are chosen by it`) };
  return { read, env: withoutKernelEnvironment(read) };
}
/** The environment a `new-window` client runs with, and the `respawn-pane` client of a restart in
 *  place, for every creator (an instance, the Desktop, an operator's shell): the three names tmux's
 *  client reads its locale from, and nothing else. tmux's client does not start without a UTF-8
 *  locale, and on a host that has neither en_US.UTF-8 nor C.UTF-8 only these name one; tmux gives
 *  the pane none of them. A pane's environment is its session's over the server's global one
 *  (spawn.c environ_for_session), PATH included: tmux puts the client's PATH in its place only when
 *  the client has one, and this client has none. So a PATH and the state that interprets it (a
 *  version manager's bookkeeping, `__MISE_DIFF`, nvm's) come from one environment, the server's or
 *  the session's; OATS no longer overlays a creator's PATH onto it. That does not make an existing
 *  or external server's environment, a session override or a launch configuration's PATH coherent:
 *  OATS uses them as they are. The client is run by an absolute tmux (tmuxOn), since it has no PATH
 *  to look one up with. docs/execution-targets.md owns the rule. */
const TMUX_CLIENT_LOCALE_ENV = ["LANG", "LC_ALL", "LC_CTYPE"];
function oatsWindowEnvironment() {
  const env = {};
  for (const name of TMUX_CLIENT_LOCALE_ENV) if (process.env[name] !== undefined) env[name] = process.env[name];
  return env;
}
/**
 * What a spawn or a start knows, BEFORE it creates, stops or writes anything, about the session it
 * will open a window in: `{ server, present }` from the lookup and, when `session` is not on the
 * OATS server and this is no preview, `env`: the environment its creation needs, read now, so that a
 * caller that cannot create it is refused with nothing left behind; the answer goes to
 * ensureOatsTmuxSession. It is also where the harness is first looked up (expectedPanePath). Not the
 * guarantee: ensureOatsTmuxSession decides by what it finds when it creates, and the harness is
 * looked up again on the session it returns; and an environment read for a running server is read
 * again there when that server has gone. undefined when this process has no tmux to run: the
 * caller's backend check refuses that.
 */
function planOatsTmuxSession(session, io, { preview = false } = {}) {
  if (!io?.exec && !which("tmux")) return undefined;
  let server, present;
  try { ({ server, present } = oatsTmuxSessionSocket(session, io)); }
  catch (e) { if (preview) return undefined; throw e; } // a preview reports, it does not refuse on a read
  if (present || preview) return { server, present };
  return { server, present, env: oatsSessionEnvironment(session, io, { startsServer: !server }), startsServer: !server };
}
/**
 * The PATH a pane created in `session` on `socket` starts with, read as tmux decides it (spawn.c,
 * environ.c), never computed from this process: the session's own entry when it has one, otherwise
 * the server's global PATH. `session` null reads the global one only (a session about to be created
 * on a running server). Both are read with the strict reader, as bytes.
 * → `{ path, source }`, or `{ source, problem }` when the pane's PATH cannot be established: the
 * session entry is an explicit clear (`unset PATH;`: the pane has no PATH at all; never substituted
 * by the global one or this process's), a value the strict reader leaves out (unknown), a read that
 * failed, or a server with no PATH (tmux would fall back to a compiled-in default, which OATS does not
 * assume). `source` names where the PATH comes from; no value is ever in it or in `problem`.
 */
function panePath(socket, session, io, cwd) {
  const read = (scope) => {
    const omitted = [], cleared = [];
    let env = null;
    try {
      const printed = (io?.exec || execFileSync)("tmux", ["-u", "-S", socket, "show-environment", ...scope, "-s"], { timeout: 10000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
      env = parseTmuxShellEnvironment(Buffer.isBuffer(printed) ? printed : Buffer.from(String(printed)), omitted, cleared);
    } catch (e) { if (oatsCoded(e)) throw e; }
    return { env, omitted, cleared };
  };
  const decide = ({ env, omitted, cleared }, source, unset) => {
    if (env === null) return { source, problem: `${source} could not be read` };
    if (Object.hasOwn(env, "PATH")) return { path: env.PATH, source, cwd };
    if (cleared.includes("PATH")) return { source, problem: unset };
    if (omitted.includes("PATH")) return { source, problem: `${source} cannot be read as data (its value holds a $, a line break or a character tmux prints encoded)` };
    return null;
  };
  if (session) {
    const own = decide(read(["-t", `=${session}`]), `the PATH of tmux session ${session}`, `tmux session ${session} clears PATH (unset PATH), so its panes start with no PATH at all`);
    if (own) return own;
  }
  const source = `the global PATH of the OATS tmux server (${socket})`;
  return decide(read(["-g"]), source, `the OATS tmux server (${socket}) clears PATH (unset PATH), so its panes start with no PATH at all`)
    ?? { source, problem: `the OATS tmux server (${socket}) has no PATH, and tmux then gives a pane a compiled-in default that OATS does not assume` };
}
/** Where a launch's pane is expected to look its harness up, from a plan (planOatsTmuxSession): the
 *  session's or the server's PATH when a server runs, else the PATH of the environment the server
 *  will be created with. undefined when that is not known (no plan, or a preview with no server: a
 *  preview reads no creation environment); the lookup then uses this process's PATH, and the launch
 *  looks again on the session it actually gets. */
function expectedPanePath(plan, session, io, cwd) {
  if (!plan) return undefined;
  if (plan.server) return panePath(plan.server, plan.present ? session : null, io, cwd);
  if (!plan.env) return undefined;
  const source = "the PATH the OATS tmux server is created with";
  return plan.env.PATH === undefined ? { source, problem: `${source} is not set, and tmux then gives a pane a compiled-in default that OATS does not assume` } : { path: plan.env.PATH, source, cwd };
}
/** The PATH a launch's harness is looked up on, by precedence: a PATH set in the launch
 *  configuration (a literal, or a reference resolved from `env`) is what the pane's command line
 *  applies, so the lookup uses it; otherwise the pane's own PATH (`pane`, from panePath or
 *  expectedPanePath; a function is called only when it is needed). A declared absolute or relative
 *  executable is never looked up (resolveLaunchExecutable). undefined: look up on this process's PATH. */
function launchLookup(configEnv, env, pane, configName, cwd) {
  const own = configEnv?.PATH;
  if (typeof own === "string") return { path: own, source: `the PATH of launch configuration ${configName}`, cwd };
  if (own && typeof own === "object" && own.fromEnv) return env[own.fromEnv] === undefined ? undefined : { path: env[own.fromEnv], source: `the PATH of launch configuration ${configName} (from ${own.fromEnv})`, cwd };
  return typeof pane === "function" ? pane() : pane;
}
/**
 * Make sure `session` exists on the OATS server and return that server's absolute socket: the one
 * endpoint the caller then creates its window on, records and compensates on. `hq` is the directory
 * of the session's first window; `io.exec` replaces execFileSync (session start guards its roots there).
 * This `new-session`, the one that creates an agents' session, runs with oatsSessionEnvironment
 * (`plan`, when planOatsTmuxSession read it earlier), by the creator's own tmux, on the socket the
 * lookup named when the server runs. (The viewer's temporary session, lib/session-viewer.mjs, is
 * created with the attaching process's environment: awebai/oats#623.)
 * Two creators racing both succeed on one socket: the loser's `duplicate session` is answered by a
 * second lookup. tmux starts a server once: the first successful creator determines its initial
 * environment, and nothing here changes a running server's. E_RUNTIME_ENDPOINT_UNKNOWN when the
 * server cannot be read or names no socket, when this caller may not create the session, or when
 * its own PATH names no tmux to create it with (creatorTmux).
 */
export function ensureOatsTmuxSession(session, hq, io, plan) {
  let { server: socket, present } = oatsTmuxSessionSocket(session, io);
  if (!present) {
    // The executable is chosen here, where the creation is about to run, and nowhere earlier: a
    // session that exists needs none, so nothing is refused for it.
    const tmux = creatorTmux(session);
    // The plan's environment, unless it was read for a running server that has gone since: a server
    // this call starts gets what a server start gets.
    const env = plan?.env && (plan.startsServer || socket) ? plan.env : oatsSessionEnvironment(session, io, { startsServer: !socket });
    const address = socket ? ["-S", socket] : ["-L", OATS_TMUX_SERVER];
    let created;
    try { created = (io?.exec || execFileSync)(tmux, ["-u", ...address, "new-session", "-d", "-s", session, "-n", "hq", "-c", hq, "-P", "-F", "#{socket_path}\t#{window_id}"], { encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], env }).trim(); }
    catch (e) {
      if (oatsCoded(e)) throw e;
      const again = oatsTmuxSessionSocket(session, io);
      if (!again.present) throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `could not create tmux session ${session} on the OATS tmux server: ${tmuxFailure(e, "tmux new-session failed")}`);
      socket = again.server;
    }
    if (created !== undefined) {
      const [path, hqWindow] = created.split("\t");
      if (!path) throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `tmux returned no endpoint for session ${session}`);
      socket = path;
      // The session's first window, which this call created: sized like every window OATS creates.
      // A dead server shows in the caller's next step on this socket.
      sizeWindow(socket, hqWindow, io);
    }
  }
  if (!socket) throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `tmux returned no endpoint for session ${session}`);
  return resolve(socket);
}
/** The window names of `session` on the OATS server, creating neither a server nor a session: none is
 *  an empty list. An early read only (an explicit name's refusal); the collision check that counts
 *  lists the socket ensureOatsTmuxSession returned. */
function oatsTmuxWindows(session) {
  try { return tmuxOatsServer(["list-windows", "-t", `=${session}`, "-F", "#{window_name}"]).split("\n").filter(Boolean); }
  catch { return []; }
}
/** The harness's window command: no COLORFGBG in the pane, whatever the server's global environment
 *  holds. tmux runs the command with the server's `default-shell -c` (the user's shell: sh, bash and
 *  zsh all take `unset NAME;`), and the fallback shell it execs inherits the result. */
const paneCommand = (command) => `unset COLORFGBG; ${command}; exec "\${SHELL:-/bin/zsh}"`;
/** The sizing options on one window, each best effort: this command's failure is ignored, nothing is
 *  retried elsewhere and nothing global is written. */
function sizeWindow(socket, windowId, io) {
  if (!/^@\d+$/.test(windowId || "")) return;
  for (const [option, value] of OATS_WINDOW_SIZING) {
    try { tmuxOn(socket, ["set-option", "-w", "-t", windowId, option, value], io); } catch (e) { if (oatsCoded(e)) throw e; }
  }
}
/** The agent window OATS just created, by the id new-window returned: showing the viewer's colours and
 *  sized for its viewers. Never a global option, another window or another server. The colour
 *  commands come first and are strict, so a lost server, a permission or a transport failure surfaces
 *  there and the tolerant sizing after them cannot mask it. The palette (`pane-colours`) is left
 *  alone: a local reset did not neutralise inherited entries. */
function prepareAgentWindow(socket, windowId, io) {
  if (!/^@\d+$/.test(windowId || "")) throw new Error("tmux new-window returned no window id");
  for (const [option, value] of OATS_WINDOW_COLOURS) tmuxOn(socket, ["set-option", "-w", "-t", windowId, option, value], io);
  // cursor-colour exists from tmux 3.3: -q makes an unknown option exit 0. -q also hides a missing
  // target, so only this command has it, and only after the two above succeeded on the same window.
  tmuxOn(socket, ["set-option", "-q", "-w", "-t", windowId, "cursor-colour", "default"], io);
  sizeWindow(socket, windowId, io);
}
/** One line for a start that opened its window on another server than the home recorded. */
const sessionMovedWarning = (instance, from, to) => `${instance} was recorded on the tmux server ${JSON.stringify(from)}; its window had to be created again, and new windows open on the OATS tmux server: it now runs on ${JSON.stringify(to)}, and that socket is recorded`;

/**
 * Spawn an instance of `agent` (as returned by findAgent/listAgents).
 * o: { instance?, purpose?, name?, repo?, work?, harness?, model?, task?, taskFile?, branch?, launch?, tmuxSession? }
 */
/** `oats-claude-config` (a one-line file naming the claude binary, found walking up from the context) is no
 *  longer read (0.32): a host names its claude executable in a default launch configuration. A file still in
 *  reach of a new claude launch refuses it, naming the file and the configuration to declare instead. */
export function legacyClaudeConfigRefusal(contextDir) {
  let d = resolve(contextDir);
  while (true) {
    const f = join(d, "oats-claude-config");
    if (existsSync(f)) {
      let name = null;
      try { name = readFileSync(f, "utf8").split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#")) || null; } catch {}
      const exe = name ? `executable: ${name}, ` : "";
      return Object.assign(oatsError("E_CLAUDE_CONFIG_REMOVED", `${f} is no longer read (OATS 0.32): declare this machine's claude default in oats-local.yaml instead — launch-configs: { <name>: { harness: claude, ${exe}default: true } } (oats launch-config set <name> --file <json>) — then delete ${f}`), { details: { file: f, executable: name, fix: `declare a claude default launch configuration (${exe}default: true), then delete ${f}` } });
    }
    const parent = dirname(d);
    if (parent === d) return null;
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
/** instance.json `modelFrom` (feature desktop-facts): where the model a home runs came from — "soul" (the
 *  soul's preference), "spawn" / "start" (an explicit --model then), "launch-config", "harness-default" (the
 *  harness's native model). A recorded model keeps `prior`. From resolveLaunchSelection's `modelSource`. */
export function modelFromOf(modelSource, { at = "spawn", prior = null } = {}) {
  if (typeof modelSource !== "string") return prior ?? null;
  if (modelSource === "explicit") return at;
  if (modelSource === "soul default" || modelSource === "soul preference") return "soul";
  if (modelSource === "local preference") return "local";
  if (modelSource === "local-default preference") return "local-default";
  if (modelSource.startsWith("launch-config ")) return "launch-config";
  if (modelSource === "recorded") return prior ?? null;
  if (modelSource.startsWith("native default")) return "harness-default";
  return prior ?? null;
}

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
 * stated the dependency. Installing it remains the operator's responsibility.
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
  // the host's harness default included), so probing another binary would inspect a different
  // account's packages than the instance will actually use. The probe is the
  // manager's controlled list subcommand; no launch argument is added to it.
  const probeOpts = { context: contextDir, ...(bin ? { bin } : {}) };
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
      // Keep the remedy in the same resource directory and selected wrapper as
      // the probe; quote argv, never turn a path or package selector into shell code.
      // Pi expands ~ against the launch HOME; relative selectors are anchored
      // to the probe cwd before the remedy changes to contextDir.
      const piResourceDir = harness === "pi" ? piAgentDir(probeEnv).replace(/^~(?=$|\/)/, () => probeEnv.HOME || homedir()) : undefined;
      const resourceEnv = harness === "pi" ? `PI_CODING_AGENT_DIR=${shq(resolve(piResourceDir))} `
        : harness === "claude" && probeEnv.CLAUDE_CONFIG_DIR ? `CLAUDE_CONFIG_DIR=${shq(resolve(probeEnv.CLAUDE_CONFIG_DIR))} ` : "";
      const direct = stepList.filter((a) => a.length).map((a) => resourceEnv + [bin || a[0], ...a.slice(1)].map(shq).join(" ")).join(" && ");
      const remedy = direct ? `ask the operator to run \`cd ${shq(contextDir)} && ${direct}\` with the selected harness's environment; OATS does not install packages during spawn or restart`
        : `ask the operator to install it with the selected harness's package manager`;
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
/** The fixed prompt a codex launch starts with: it names the task file, never its text (argv is
 *  readable by every local user). Codex reads the file with a tool. */
export const CODEX_TASK_PROMPT = "Read TASK.md in this directory first: it is your briefing and your task.";
/** The prompt each harness gets, so the task's text never travels in argv: Claude Code inlines an
 *  `@file` mention; codex is pointed at the file. pi takes `@TASK.md` among its own arguments. */
const TASK_PROMPT = Object.freeze({ claude: "@TASK.md", codex: CODEX_TASK_PROMPT });

/** The executable a launch uses: a configuration's declared one (a bare name
 *  on PATH; a path against the deployment directory when relative) or the
 *  harness's name on PATH. Never executed. A new claude launch with a legacy `oats-claude-config` in reach
 *  of its context is refused (E_CLAUDE_CONFIG_REMOVED, 0.32), whatever it declares.
 *  `lookup` (launchLookup: `{ path, source, cwd }` or `{ source, problem }`) is the PATH a bare name is
 *  looked up on, the one the pane runs it with; without one, this process's PATH. A result looked up
 *  there carries `lookup`, so a refusal can name where it looked. */
export function resolveLaunchExecutable({ harness, declared, declaringDir, contextDir, lookup }) {
  if (harness === "claude" && contextDir) { const refused = legacyClaudeConfigRefusal(contextDir); if (refused) throw refused; }
  if (declared?.includes("/")) {
    const path = isAbsolute(declared) ? declared : resolve(declaringDir || contextDir, declared);
    return { path, declared, resolvedFrom: isAbsolute(declared) ? "absolute" : `relative to ${declaringDir || contextDir}`, missing: existsSync(path) ? undefined : `${declared} (${path}) does not exist` };
  }
  const name = declared || harness;
  if (lookup) {
    const found = lookup.problem ? null : lookupOnPath(name, lookup.path, lookup.cwd);
    return { path: found, declared: declared || null, resolvedFrom: "PATH", lookup, missing: found ? undefined : lookup.problem ?? `${name} was not found on ${lookup.source}` };
  }
  const found = which(name);
  return { path: found || null, declared: declared || null, resolvedFrom: "PATH", missing: found ? undefined : `${name} binary not found on PATH` };
}
/** The refusal for an executable a launch looked up where its pane looks it up (`executable.lookup`)
 *  and did not find, or could not look up: E_HARNESS_UNAVAILABLE for the harness's own name,
 *  E_LAUNCH_EXECUTABLE for a configuration's declared name. Names the source and the remedies, never
 *  the PATH's contents. */
function executableNotOnPanePath(executable, { harness, config, from, at }) {
  if (!executable.declared) return harnessNotOnPanePath({ harness, from, at, why: executable.missing });
  return oatsError("E_LAUNCH_EXECUTABLE", `launch configuration ${config?.name}: ${executable.missing}; ${PANE_PATH_FIX}`);
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
export function resolveLaunchSelection({ launchConfigs = {}, agent, frozen, selection = {}, preference = null }) {
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
    config = { name: frozen.launchConfig || null, harness: frozen.harness, ...(frozen.executableDeclared ? { executable: frozen.executableDeclared } : {}), executablePath: frozen.executable, args: [...(frozen.args || [])], env: { ...(frozen.env || {}) }, ...(frozen.model ? { model: frozen.model } : {}), ...(frozen.yolo !== undefined ? { yolo: frozen.yolo } : {}), source: frozen.launchConfigSource || null, ...(frozen.launchConfigDefault === true ? { harnessDefault: true } : {}), frozen: true };
    wanted = "none";
  }
  if (wanted === undefined) wanted = frozen ? "none" : (agent?.["launch-config"] || "none");
  if (wanted !== "none") {
    if (typeof wanted !== "string" || !Object.hasOwn(launchConfigs, wanted)) bad("E_LAUNCH_CONFIG_UNKNOWN", `no launch configuration ${JSON.stringify(wanted)} is effective here${frozen?.launchConfig === wanted ? " any more (the home was started with it; an unqualified start still runs the recorded one)" : ""}; oats launch-config list shows what is`);
    config = launchConfigs[wanted];
    if (selection.harness && selection.harness !== config.harness) bad("E_LAUNCH_CONFIG_MISMATCH", `launch configuration ${wanted} starts ${config.harness}; --harness ${selection.harness} disagrees with it (select another configuration, or --launch-config none with --harness)`);
  }
  // A launch preference (feature launch-preference: an inline or soul {harness, model}) stands where the
  // host default would: below the flags and a selected configuration.
  const harness = config?.harness || selection.harness || (frozen ? frozen.harness : preference?.harness || agent?.harness || "pi");
  if (!LAUNCH_HARNESSES.includes(harness)) bad("E_UNSUPPORTED_HARNESS", `unknown harness "${harness}" (pi|claude|codex)`);
  // 0.32 (feature launch-config-default): a launch that selected no configuration runs this host's default
  // for its harness, if one is declared. An explicit `--launch-config none` asks for the bare harness.
  const harnessDefault = !config && !(selection.launchConfig === "none" && !preference) ? harnessDefaultConfig(launchConfigs, harness) : null;
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
  } else if (preference && preference.harness === harness) {
    // A preference is a unit: its model, or the harness's own — never a lower layer's.
    model = preference.model ? resolveModelPreference(preference.model, harness) : ""; modelSource = model ? `${preference.from} preference` : "native default";
    if (preference.model && !model) bad("E_MODEL_UNKNOWN", `the ${preference.from} launch preference names model ${JSON.stringify(preference.model)}, which has no entry usable by harness ${harness}`);
  } else if (frozen) {
    if (frozen.harness === harness) { model = frozen.model || ""; modelSource = model ? "recorded" : "native default"; }
    else { model = ""; modelSource = "native default (harness changed)"; }
  } else if (harness !== (agent?.harness || "pi")) {
    // A soul's model preference belongs to the soul's harness; a bare alias
    // is no proof it fits another one. Nothing is passed across.
    model = ""; modelSource = "native default (harness differs from the soul's)";
  } else { model = resolveModelPreference(agent?.model || "", harness); modelSource = model ? "soul default" : "native default"; }
  // The harness default's model is the last fallback: below every layer that names one, above the harness's own.
  if (harnessDefault?.model && !model && !nativeDefault) {
    model = resolveModelPreference(harnessDefault.model, harness); modelSource = `launch-config ${harnessDefault.name}`;
    if (!model) bad("E_MODEL_UNKNOWN", `launch configuration ${harnessDefault.name} (the ${harness} default) names model ${JSON.stringify(harnessDefault.model)}, which has no entry usable by harness ${harness}`);
  }
  if (harnessDefault) config = harnessDefault;
  return { config, harness, model, modelSource, configuredYolo: config?.yolo };
}
/** This host's default launch configuration for `harness` (`default: true`), marked `harnessDefault`, or null. */
export function harnessDefaultConfig(launchConfigs, harness) {
  const found = Object.values(launchConfigs || {}).find((c) => c?.default === true && c.harness === harness);
  return found ? { ...found, harnessDefault: true } : null;
}
/** A home's launch layers now (feature launch-preference; --reselect-launch and inspect's launchCurrent): its
 *  RECORDED soul's launch (the soul copy it runs) and its deployment's oats-local.yaml souls.launch. */
export function homeLaunchLayers(realHome, meta) {
  const deployment = dirname(dirname(dirname(dirname(realHome))));
  const found = loadLocal(deployment);
  if (!found.path || resolve(dirname(found.path)) !== resolve(deployment)) throw oatsError("E_LOCAL_MISSING", `${deployment} has no oats-local.yaml: --reselect-launch reads its souls.launch`);
  const soul = isPlainObject(meta?.workspace?.soul) ? meta.workspace.soul : {};
  const soulDir = instanceSoulDir(realHome, meta);
  const file = soulDir ? join(soulDir, "soul.yaml") : null;
  const definition = file && existsSync(file) ? withConfigFile(file, () => parseYamlNested(readFileSync(file, "utf8"))) : null;
  const key = soul.package && typeof soul.qualifiedName === "string" ? soul.qualifiedName : meta.agent;
  return launchLayers({ definition, entry: { repoKey: soul.repoKey ?? null, path: typeof soul.path === "string" ? soul.path : null, package: soul.package?.id ?? null }, key, local: found.local });
}
/** A NEW launch selection (a spawn, or a start/restart that reselects) from the flags and the launch
 *  layers (lib/launch-preference.mjs). → { launchSelection (resolveLaunchSelection's), launchChoice:
 *  { from, at, declared } }. A configuration a layer names but the host lacks is E_LAUNCH_CONFIG_UNKNOWN
 *  naming the layer. Never reads a frozen recipe. */
export function selectNewLaunch({ launchConfigs = {}, agent, flags = {}, layers = null }) {
  const choice = selectionFrom({ flags, layers });
  const named = choice.from !== "flag" && choice.selection.launchConfig !== undefined && choice.selection.launchConfig !== "none" ? choice.selection.launchConfig : null;
  if (named !== null && !Object.hasOwn(launchConfigs, named)) throw launchConfigUnknown({ name: named, from: choice.from, at: choice.at });
  const launchSelection = resolveLaunchSelection({ launchConfigs, agent: layers ? {} : agent, selection: choice.selection, preference: choice.preference });
  return { launchSelection, launchChoice: { from: choice.from, at: choice.at, declared: layers?.declared ?? null } };
}
/** The `Launch` report (feature launch-preference) a spawn with no flags would decide HERE, for listings
 *  (`oats souls`, `inspect --soul`): the same layers as selectNewLaunch, but no model catalogue is probed
 *  (`model` is the configured id) and a spawn's refusal becomes `problem` {code, message, fix}. `contextDir`
 *  is the deployment (where a harness executable resolves). */
export function launchReportFor({ layers, launchConfigs = {}, contextDir }) {
  const choice = selectionFrom({ layers });
  const report = (harness, model, launchConfig, problem = null) => launchReport({ declared: layers?.declared ?? null, harness, model, launchConfig, from: choice.from, at: choice.at, problem });
  let harness = "pi", model = null, config = null;
  if (choice.selection.launchConfig !== undefined && choice.selection.launchConfig !== "none") {
    // An unknown configuration launches nothing (`problem`); `effective` stays a real launch — the host
    // default — so a reader's closed decoder never meets a null harness.
    const name = choice.selection.launchConfig;
    if (!Object.hasOwn(launchConfigs, name)) { const e = launchConfigUnknown({ name, from: choice.from, at: choice.at }); return report("pi", null, null, { code: e.code, message: e.message, fix: `declare launch configuration ${name} (oats launch-config set), or change oats-local.yaml souls.launch` }); }
    config = launchConfigs[name]; harness = config.harness; model = typeof config.model === "string" && config.model ? config.model : null;
  } else if (choice.preference) { harness = choice.preference.harness; model = choice.preference.model ?? null; }
  // As a spawn: a layer naming "none" asks for the bare harness; otherwise no configuration is the harness default.
  if (!config && !(choice.selection.launchConfig === "none" && !choice.preference)) { config = harnessDefaultConfig(launchConfigs, harness); if (config && !model) model = typeof config.model === "string" && config.model ? config.model : null; }
  let exe;
  try { exe = resolveLaunchExecutable({ harness, declared: config?.executable, declaringDir: config?.source, contextDir }); }
  catch (e) { if (e?.code !== "E_CLAUDE_CONFIG_REMOVED") throw e; return report(harness, model, config?.name, { code: e.code, message: e.message, fix: `declare a claude default launch configuration (oats launch-config set), then delete ${e.details.file}` }); }
  if (!exe.path && !config?.executable) { const e = harnessUnavailable({ harness, from: choice.from, at: choice.at, why: exe.missing }); return report(harness, model, config?.name, { code: e.code, message: e.message, fix: e.details.fix }); }
  if (!exe.path) return report(harness, model, config.name, { code: "E_LAUNCH_EXECUTABLE", message: `launch configuration ${config.name}: ${exe.missing}`, fix: `fix the executable of launch configuration ${config.name} (oats launch-config set)` });
  return report(harness, model, config?.name);
}
/** The pane environment carrying each reference's value under a
 *  kernel-owned alias (OATS_LAUNCH_REF_<NAME>), which no configuration can
 *  name: the command says NAME="$OATS_LAUNCH_REF_NAME", so no source
 *  variable is ever named in the command and no assignment in the same
 *  prefix can shadow it (zsh evaluates a prefix's assignments in order).
 *  Each goes to the pane as a tmux `-e NAME=value` argument. */
export function launchEnvRefs(recipe, env = process.env) {
  const out = [];
  for (const [name, v] of Object.entries(recipe.env || {})) if (v && typeof v === "object" && v.fromEnv && env[v.fromEnv] !== undefined) out.push({ name: `${LAUNCH_REF_PREFIX}${name}`, value: env[v.fromEnv], target: name, source: v.fromEnv });
  return out;
}

/** The canonical path of this kernel's CLI: what the home's shim points at, and OATS_CLI_BIN. */
export function kernelBin() { return realpathSync(join(PKG_ROOT, "bin", "oats.mjs")); }
/** Where a home's `oats` lives: first on its harness's PATH, so plain `oats` inside an instance is
 *  the kernel that launched it, whatever other `oats` the host's PATH finds first. */
export const kernelShimDir = (home) => join(home, ".oats", "bin");
/** Write <home>/.oats/bin/oats, a symlink to this kernel's CLI, replacing any shim a previous
 *  launch (perhaps by another kernel) left: built aside, then renamed over. `.oats` and `.oats/bin`
 *  must be directories of the home itself: a link there would carry the write outside the home.
 *  The target, or E_LAUNCH_SHIM naming the path and the cause (a launch never runs with the
 *  wrong `oats`), before anything outside the home is touched. */
export function writeKernelShim(home) {
  const dir = kernelShimDir(home), shim = join(dir, "oats");
  let target, aside;
  try {
    target = kernelBin();
    for (const d of [join(home, ".oats"), dir]) {
      let st;
      try { st = lstatSync(d); }
      catch (e) { if (e.code !== "ENOENT") throw e; mkdirSync(d); st = lstatSync(d); }
      if (!st.isDirectory()) throw new Error(`${d} is ${st.isSymbolicLink() ? "a symbolic link" : "not a directory"}`);
    }
    if (realpathSync(dir) !== join(realpathSync(home), ".oats", "bin")) throw new Error(`${dir} resolves outside the home`);
    aside = join(dir, `.oats-${randomUUID()}`);
    symlinkSync(target, aside);
    renameSync(aside, shim);
    return target;
  } catch (e) {
    if (aside) rmSync(aside, { force: true });
    throw oatsError("E_LAUNCH_SHIM", `cannot write the kernel shim ${shim}${target ? ` (to ${target})` : ""}: ${e.message}; nothing was started`);
  }
}
/** A parsed launch command's environment prefix with the home's shim directory first on PATH: a
 *  configuration's PATH (literal or reference) follows it, else the PATH the command runs under. */
function shimPathPrefix(tokens, binary, home) {
  const dir = shq(kernelShimDir(home));
  const prefix = tokens.slice(0, binary);
  const texts = prefix.map((t) => t.name !== "PATH" ? t.text : t.kind === "env" ? `PATH=${dir}:${shq(t.value)}` : `PATH=${dir}:"$${t.source}"`);
  if (!prefix.some((t) => t.name === "PATH")) texts.push(`PATH=${dir}:"$PATH"`);
  return texts;
}
/** codex runs tool commands with the PATH it is given here, the one the launching shell has (the
 *  shim first): its value is this host's, so only the execution carries it. The user's login shell,
 *  which Codex runs tool commands through, may still put its own profile entries ahead of it. */
const CODEX_TOOL_PATH = `-c "shell_environment_policy.set.PATH=\\"$PATH\\""`;
/** The binary and its arguments as the execution runs them. */
function executionArgv(tokens, binary, harness) {
  const texts = tokens.slice(binary).map((t) => t.text);
  if (harness === "codex") texts.splice(1, 0, CODEX_TOOL_PATH);
  return texts;
}
/** The persisted launch command as a shell runs it: the same command, with the home's kernel shim
 *  first on PATH. The persisted bytes never carry it (they stay a shape parseLaunchCommand reads). */
export function launchShellCommand(command, home, harness) {
  const { tokens, binary } = parseLaunchCommand(command);
  return [...shimPathPrefix(tokens, binary, home), ...executionArgv(tokens, binary, harness)].join(" ");
}

/** The deployment directory a home belongs to: the one its spawn recorded, else the nearest
 *  ancestor holding oats-local.yaml, else the agents root's parent. */
function deploymentOfHome(home, meta) {
  if (typeof meta?.workspace?.deployment === "string" && meta.workspace.deployment) return realPathOrNearest(meta.workspace.deployment);
  for (let d = dirname(resolve(home)); ; d = dirname(d)) {
    if (existsSync(join(d, "oats-local.yaml"))) return realPathOrNearest(d);
    if (dirname(d) === d) return realPathOrNearest(dirname(dirname(dirname(dirname(resolve(home))))));
  }
}
/** Folder trust for a launch in `home` (lib/harness-trust.mjs, read-only): `trustHome` — the
 *  codex launch trusts the home, because the operator trusts its deployment root or an
 *  ancestor — and the warning when the session will stop at its harness's folder-trust prompt. */
export function launchFolderTrust({ harness, home, meta, yolo, env = process.env }) {
  const root = deploymentOfHome(home, meta);
  if (harness === "codex") {
    const trustHome = codexTrustsRoot(root, { env });
    return { trustHome, warning: harnessTrustWarning({ harness, root, covered: trustHome || yolo === true }) };
  }
  if (harness === "claude") return { trustHome: false, warning: harnessTrustWarning({ harness, root, covered: claudeTrusts(home, { env }) }) };
  return { trustHome: false, warning: null };
}

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
 *  greedy contributed flag cannot eat it. codex keeps its native policy; it
 *  never stops at Codex's update prompt, and the generated home is trusted for
 *  the launch (projects=...) under yolo or `trustHome`: the operator trusts the
 *  deployment root or an ancestor in Codex's config (lib/harness-trust.mjs),
 *  which Codex itself does not apply to the homes below it. Codex's own form
 *  of the override is the inline table: a dotted projects."<home>" key is not
 *  honoured (codex-cli 0.157.1). */
export function renderLaunchRecipe(recipe, { home, instance, redact = false, trustHome = false }) {
  const { harness, executable, model, yolo } = recipe;
  const cfgArgs = (recipe.args || []).map(shq).join(" ");
  const hookArgs = recipe.hooks?.launch?.[harness] || "";
  const tail = `${cfgArgs ? ` ${cfgArgs}` : ""}${hookArgs ? ` ${hookArgs}` : ""}`;
  // The launch's environment, in prefix order: the instance, the capabilities' env, the
  // configuration's env (a reference by reference, never by value).
  const hookEnv = recipe.hooks?.env || {};
  const env = [["OATS_INSTANCE", instance], ["OATS_INSTANCE_HOME", home]].map(([name, value]) => ({ name, value }));
  for (const name of Object.keys(hookEnv).sort()) env.push({ name, value: redact ? "<redacted>" : hookEnv[name] });
  for (const name of Object.keys(recipe.env || {}).sort()) {
    const v = recipe.env[name];
    env.push(typeof v === "string" ? { name, value: redact ? "<redacted>" : v } : { name, reference: true });
  }
  let cmdline;
  if (harness === "claude") {
    cmdline = `${shq(executable)}${yolo ? " --dangerously-skip-permissions" : ""}${model ? ` --model ${shq(model)}` : ""}${tail} -- ${shq(TASK_PROMPT.claude)}`;
  } else if (harness === "codex") {
    const codexTrust = `projects={${JSON.stringify(realPathOrNearest(home))}={trust_level="trusted"}}`;
    // Codex may run tool commands outside the session's process (its shared app-server daemon),
    // so the env the prefix below gives the session is also set for them. A reference's value
    // never goes on argv, and PATH is the execution's (CODEX_TOOL_PATH: the shim first).
    const toolEnvArgs = env.filter((e) => !e.reference && e.name !== "PATH")
      .map((e) => ` -c ${shq(`shell_environment_policy.set.${e.name}=${JSON.stringify(e.value)}`)}`).join("");
    cmdline = `${shq(executable)} --cd ${shq(home)} -c check_for_update_on_startup=false${yolo ? " --yolo" : ""}${yolo || trustHome ? ` -c ${shq(codexTrust)}` : ""}${toolEnvArgs}${model ? ` --model ${shq(model)}` : ""}${tail} -- ${shq(TASK_PROMPT.codex)}`;
  } else {
    // Decision 13: pi starts NORMALLY — its own skill discovery (~/.pi/agent/skills,
    // .agents/skills up the tree, so the instance's copied capability skills are
    // found from cwd=home) and context files stay ambient. OATS contributes only
    // the composed instructions.
    cmdline = `${shq(executable)} --append-system-prompt ${shq(join(home, "AGENTS.md"))} --approve --name ${shq(instance)}${model ? ` --model ${shq(model)}` : ""} ${shq("@TASK.md")}${tail}`;
  }
  return `${env.map((e) => e.reference ? `${e.name}="$${LAUNCH_REF_PREFIX}${e.name}"` : `${e.name}=${shq(e.value)}`).join(" ")} ${cmdline}`;
}

/** Execution, not preview: mark pending before dispatch, then resolve native
 * storage inside the backend shell under the actual command environment.
 * The original executable/argv is exec'd unchanged after recording succeeds,
 * with the home's kernel shim first on PATH (every launch runs through here). */
function nativeRecordCommand(command, home, harness) {
  const { tokens, binary } = parseLaunchCommand(command);
  const args = tokens.slice(binary + 1).map(t => t.value ?? t.text);
  const id = prepareNativeStart(home, harness);
  const recorder = join(PKG_ROOT, "packages", "record", "bin", "record-native-start.mjs");
  const inner = `${shq(process.execPath)} ${shq(recorder)} ${shq(home)} ${shq(id)} ${shq(harness)} ${shq(JSON.stringify(args))} && exec ${executionArgv(tokens, binary, harness).join(" ")}`;
  return `${shimPathPrefix(tokens, binary, home).join(" ")} /bin/sh -c ${shq(inner)}`;
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
 *  collects every failed check into `preflight` instead of throwing. Launch
 *  hooks of capabilities declaring `launchPreview` run here only as a preview
 *  (OATS_LAUNCH_PREVIEW=1); the others run here for real when a start plans,
 *  and not at all for a preview. A home
 *  that records no launch recipe (an earlier kernel spawned it) is not planned:
 *  E_LAUNCH_LEGACY, re-spawn it from the deployment. */
export function planLaunch({ home, instance, meta, contextDir, agentLike, selection = {}, launchConfigs, resolvedCfg, env = process.env, preview = false, assertRoots, reselect = null, panePath: expectedPane }) {
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
  const scopeConfigs = launchConfigs || (home ? launchConfigsAt(home) : resolvedCfg?.launchConfigs) || {};
  // A NEW selection (feature launch-preference) — `reselect` (the home's launch layers, --reselect-launch)
  // or explicit --launch-config / --harness — records which layer decided it (`launchChoice`); otherwise
  // the recorded launch stays frozen (launchChoice null).
  let chosen, launchChoice = null;
  if (reselect) ({ launchSelection: chosen, launchChoice } = selectNewLaunch({ launchConfigs: scopeConfigs, agent: {}, flags: { launchConfig: selection.launchConfig, harness: selection.harness, model: selection.model }, layers: reselect }));
  else {
    chosen = resolveLaunchSelection({ launchConfigs: scopeConfigs, agent: agentLike, frozen, selection });
    if (selection.launchConfig !== undefined || selection.harness !== undefined) launchChoice = { from: "flag", at: null, declared: meta?.launchDeclared ?? null };
  }
  const { config, harness, model, modelSource } = chosen;
  // A recorded yolo that came from a harness default belongs to that default: it never carries into a launch
  // the default no longer decides (a bare --launch-config none, another harness).
  const frozenYolo = frozen && !(frozen.launchConfigDefault === true && !config?.frozen) ? frozen.yolo : undefined;
  const yolo = resolveYolo(selection.yolo ?? chosen.configuredYolo ?? (frozen ? frozenYolo : agentLike?.yolo ?? resolvedCfg?.yolo));
  // A frozen recipe keeps its recorded path. Otherwise a bare name is looked up where the pane will
  // look it up (launchLookup: the configuration's PATH, else `expectedPane`, the start's expected
  // session or server PATH; a start looks again on the session it gets).
  const executable = config?.frozen
    ? { path: config.executablePath, declared: frozen.executableDeclared ?? null, resolvedFrom: frozen.executableResolvedFrom || "recorded", missing: existsSync(config.executablePath) ? undefined : `${config.executablePath} (recorded) does not exist` }
    : resolveLaunchExecutable({ harness, declared: config?.executable, declaringDir: config?.source, contextDir, lookup: config?.executable?.includes("/") ? undefined : launchLookup(config?.env, env, expectedPane, config?.name, home) });
  const notOnPane = !executable.path && executable.lookup ? executableNotOnPanePath(executable, { harness, config, from: launchChoice?.from, at: launchChoice?.at }) : null;
  if (notOnPane) {
    if (!preview) throw notOnPane;
    problems.push({ check: "executable", ok: false, detail: notOnPane.message, code: notOnPane.code });
  } else if (!executable.path && !config?.executable && launchChoice) {
    const e = harnessUnavailable({ harness, from: launchChoice.from, at: launchChoice.at, why: executable.missing });
    if (!preview) throw e;
    problems.push({ check: "executable", ok: false, detail: e.message, code: e.code });
  }
  const exeProblem = executable.path ? checkLaunchExecutable(executable.path) : notOnPane || (!config?.executable && launchChoice) ? null : executable.missing;
  if (exeProblem) fail("executable", "E_LAUNCH_EXECUTABLE", `launch configuration ${config?.name || "(harness default)"}: ${exeProblem}`); else if (!notOnPane) problems.push({ check: "executable", ok: true, detail: `${executable.path} (${executable.resolvedFrom})` });
  // Capability contributions: recorded at spawn with provenance; a harness
  // switch needs the new harness's launch args from the same capabilities.
  let hooks = { launch: {}, env: {}, contributions: [], pending: true };
  if (frozen) {
    // Recorded contributions, refreshed by capabilities that declare a
    // launch hook; a harness change needs the new harness's arguments from
    // every capability that gave harness-specific ones; recorded arguments
    // of a capability the scope no longer trusts are not reused. Hooks that
    // declare launchPreview run here under OATS_LAUNCH_PREVIEW=1, for a start
    // too (it runs them for real once its preflight passed); the others run
    // here for real on a start, and not at all for a preview.
    try {
      hooks = prepareLaunchHooks({ frozen, harness, resolvedCfg, home, meta, contextDir, assertRoots, pass: preview ? "preview" : "plan" });
      const current = new Map((resolvedCfg?.capabilities || []).map((c) => [c.id, c]));
      const untrusted = hooks.contributions.filter((c) => c.capability && current.has(c.capability) && !current.get(c.capability).trust?.trusted).map((c) => c.capability);
      const inactive = hooks.contributions.filter((c) => c.capability && !current.has(c.capability)).map((c) => c.capability);
      if (untrusted.length) fail("capabilities", "E_LAUNCH_PREPARATION", `${untrusted.join(", ")} contributed to this launch at spawn but is no longer trusted in the scope; respawn the instance; nothing was stopped`);
      else problems.push({ check: "capabilities", ok: true, detail: `${harness !== frozen.harness ? "prepared for the new harness" : "recorded contributions reused"}${hooks.refreshed?.length ? `; refreshed by launch hooks: ${hooks.refreshed.join(", ")}` : ""}${hooks.notRun?.length ? `; recorded contribution shown, launch hook not run for a preview (not preview-aware): ${hooks.notRun.join(", ")}` : ""}${inactive.length ? `; no longer active in the scope, recorded contribution kept: ${inactive.join(", ")}` : ""}` });
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
    version: LAUNCH_RECIPE_VERSION, harness, launchConfig: config?.name || null, launchConfigSource: config?.source || null, ...(config?.harnessDefault ? { launchConfigDefault: true } : {}),
    executable: executable.path || executable.declared || harness, executableDeclared: executable.declared ?? null, executableResolvedFrom: executable.resolvedFrom,
    args: [...(config?.args || [])], env: { ...configEnv }, model: model || null, ...(yolo !== undefined ? { yolo } : {}),
    hooks: frozen ? { launch: hooks.launch, env: hooks.env, contributions: hooks.contributions } : hooks, prompt: LAUNCH_PROMPT, kernelBin: kernelBin(),
    ...(frozen?.legacy ? { legacy: { ...frozen.legacy, ...(hooks.refreshed?.length ? { replacedBy: hooks.refreshed } : {}) } } : {}),
  };
  const inst = instance || meta?.instance || basename(home);
  const { trustHome } = launchFolderTrust({ harness, home, meta, yolo: recipe.yolo, env });
  const command = renderLaunchRecipe(recipe, { home, instance: inst, trustHome });
  const selectionSource = frozen ? (config?.frozen || (!config && !selection.launchConfig && !selection.harness) ? "frozen" : "config") : "config";
  return { recipe, command, trustHome, harness, model: model || undefined, modelSource, yolo, config, executable, preflight: problems, ok: problems.every((c) => c.ok), selectionSource, frozen, launchChoice, warnings: hooks.warnings || [], previewedHooks: hooks.previewed || [], volatileEnv: hooks.volatileEnv || [], ...(hooks.meta ? { hookMeta: hooks.meta } : {}) };
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
export const IDENTITY_LAUNCH_ENV = new Set(["OATS_INSTANCE", "OATS_INSTANCE_HOME"]);
export function redactLaunchCommand(command) {
  try { return parseLaunchCommand(command).tokens.map((t) => t.kind === "env" && !IDENTITY_LAUNCH_ENV.has(t.name) ? `${t.name}='<redacted>'` : t.text).join(" "); }
  catch { return "<unparseable launch command withheld>"; }
}
/** The recipe as answers carry it: every environment value withheld, and without `kernelBin`
 *  (the home's record keeps it; human `oats status` reads it from there). */
export function redactLaunchRecipe(recipe) {
  const env = Object.fromEntries(Object.keys(recipe.env || {}).sort().map((n) => [n, typeof recipe.env[n] === "string" ? { redacted: true } : { fromEnv: recipe.env[n].fromEnv }]));
  const hooks = recipe.hooks ? { ...recipe.hooks, env: Object.fromEntries(Object.keys(recipe.hooks.env || {}).sort().map((n) => [n, { redacted: true }])) } : undefined;
  const { kernelBin: _recorded, ...answered } = recipe;
  return { ...answered, env, ...(hooks ? { hooks } : {}) };
}
/** The kernel a home's last launch pointed its `oats` at (instance.json launch.kernelBin), or null. */
export function recordedKernelBin(home) {
  try { const bin = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"))?.launch?.kernelBin; return typeof bin === "string" ? bin : null; }
  catch { return null; }
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
/** The producer sets this only when dispatched effects or their compensation
 * cannot be confirmed. A diagnostic's wording or home path is not evidence. */
function unconfirmedSpawn(error) {
  error.details = { ...error.details, unconfirmed: true };
  return error;
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
  const { tmuxSession: session } = sessionDefaults(root, { tmuxSession: o.tmuxSession });
  const backend = o.backend || "tmux";
  if (backend === "herdr") throw herdrSettingRemoved("backend herdr was given");
  if (o.herdrSocket !== undefined) throw herdrSettingRemoved("herdrSocket was given");
  if (backend !== "tmux") throw new Error(`unknown session backend "${backend}" (tmux)`);
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
  // Feature launch-preference: the flags, else the machine's souls.launch, else the soul's own launch,
  // else the host default — `launchChoice` says which layer decided (instance.json launchFrom/launchAt).
  let launchSelection, launchChoice;
  try { ({ launchSelection, launchChoice } = selectNewLaunch({ launchConfigs: launchConfigsAt(root), agent, flags: { launchConfig: o.launchConfig, harness: o.harness, model: o.model }, layers: o.prepared.launch })); }
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
    if (!instance.startsWith(agent.name) && !instance.startsWith(slug(agent.name))) instance = `${agent.name}-${slug(instance)}`;
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
      if (prior.spawnCompleted !== true) throw unconfirmedSpawn(Object.assign(oatsError("E_SPAWN_INCOMPLETE", `${prior.instance} was created for this key but its spawn did not complete (launch or lineage unfinished); inspect it with oats session inspect --home ${prior.home} — do not spawn again`), { instance: prior.instance, home: prior.home, launched: prior.launched === true ? "unknown" : false }));
      return { ...prior, replayed: true, launch: undefined, command: undefined, wake: prior.wake ?? { requested: null, saved: null, error: null } };
    }
  }

  // An explicit name may not be a soul name (soul and instance references stay
  // unambiguous) and is taken when any soul of this deployment holds it, or — launched
  // or not — a live window of the session on the OATS tmux server carries it (an early read that
  // creates no server; the launch below checks again on the socket it resolved):
  // a typed refusal, never a silent `-2` (the operator typed it). Checked after
  // key recovery, so a retried keyed spawn still reaches its own receipt; the
  // placement below re-checks after its reservation (a concurrent spawn of
  // another soul under the same name).
  if (o.name !== undefined) {
    if (deploymentSoulNames(root, o.prepared).has(instance)) throw oatsError("E_INSTANCE_NAME_INVALID", `instance name "${instance}" is a soul name in this deployment; an instance may not share a soul's name`);
    const holder = deploymentInstanceHomes(root).get(instance)?.[0];
    if (holder) throw Object.assign(oatsError("E_INSTANCE_NAME_TAKEN", `instance name "${instance}" is taken in this deployment (${holder}); instance names are unique across every soul — pick another --name`), { instance, home: holder });
    if (oatsTmuxWindows(session).includes(instance)) throw Object.assign(oatsError("E_INSTANCE_NAME_TAKEN", `instance name "${instance}" is taken: a live tmux window of that name exists in session ${session} — pick another --name`), { instance, session });
  }
  // A caller that will have to create the tmux session reads the environment for it here, before
  // any scaffold, work tree, identity or hook, so that an instance that cannot is refused with
  // nothing left behind; the harness is first looked up on the PATH this plan expects (below). A
  // preview reads only what exists.
  const tmuxSessionPlan = launch ? planOatsTmuxSession(session, undefined, { preview: o.preview === true }) : undefined;

  // Forward-only lineage: EXPLICIT only. Relations (child|sibling|parent|unrelated)
  // anchor the new instance to an EXISTING instance (o.relativeTo). o.parent
  // (CLI --parent) is sugar for relation=child. Parsed and resolved BEFORE any
  // scaffolding or lifecycle hooks so an invalid relation or missing anchor
  // never leaves a half-created home behind. ATTACHED mode is special by design
  // decision: an attached agent shares its owner's work tree and is ALWAYS the
  // owner's child — relation flags that say anything else are contradictory and
  // rejected. Ambient env
  // (OATS_INSTANCE) is deliberately NOT consulted: any shell
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
  // A home that exists already is the same refusal as losing the exclusive mkdir below (a
  // concurrent apply that got there first, or anything else): E_PLACEMENT_TAKEN, nothing created.
  if (existsSync(home)) throw Object.assign(oatsError("E_PLACEMENT_TAKEN", `${instance} already exists at ${home}; nothing was created by this call`), { instance, home });
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
  // A workspace soul carries _soulDir (its per-commit soul cache: findAgentAt).
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
  // A launched harness is looked up where its pane will look it up (launchLookup): this is the
  // preflight against the expected PATH; the launch looks again on the session it gets. Without a
  // launch (or a known destination) the lookup is this process's PATH, as before.
  const lookupFor = (pane) => launch && !launchConfig?.executable?.includes("/") ? launchLookup(launchConfig?.env, process.env, pane, launchConfig?.name, home) : undefined;
  const executable = resolveLaunchExecutable({ harness, declared: launchConfig?.executable, declaringDir: launchConfig?.source, contextDir: repoAbs, lookup: lookupFor(() => expectedPanePath(tmuxSessionPlan, session, undefined, home)) });
  if (!executable.path && executable.lookup) { previewPreflightBudget = null; throw executableNotOnPanePath(executable, { harness, config: launchConfig, from: launchChoice.from, at: launchChoice.at }); }
  // No executable for the chosen harness (none declared by a configuration): E_HARNESS_UNAVAILABLE names the
  // layer that chose it and the fix. Never a fallback to another harness.
  if (!executable.path && !launchConfig?.executable) { previewPreflightBudget = null; throw harnessUnavailable({ harness, from: launchChoice.from, at: launchChoice.at, why: executable.missing }); }
  if (!executable.path) throw oatsError("E_LAUNCH_EXECUTABLE", `launch configuration ${launchConfig.name}: ${executable.missing}`);
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
  if (o.preview === true) { preflight = { status: previewPreflightBudget?.exhausted ? "timeout" : "complete", budgetMs: preflightBudgetMs, elapsedMs: Date.now() - preflightStarted }; previewPreflightBudget = null; }
  const task = o.task ?? (o.taskFile ? readFileSync(o.taskFile, "utf8") : "");

  if (existsSync(directoryRollbackPath(homeReal))) throw oatsError("E_WORK_INSPECTION_FAILED", `directory cleanup is still owed for ${home}; restore and retire the retained home before reusing its name`);
  // K6: everything a spawn decides is decided by here — and nothing has been
  // touched. Branch/base for a worktree are named now (not after mkdir) so the
  // preview and the apply agree on them; `o.baseRef` selects the start point.
  let plannedBranch = null, plannedBase = null, observedBase = null;
  if (work === "worktree") {
    plannedBranch = o.branch || `agents/${instance}`;
    // Validity is Git's own rule (check-ref-format), not a stricter charset:
    // every later git call takes the name as an argv element, never through a
    // shell, so a valid-but-hostile name is safe and stays exercisable.
    try { execFileSync("git", ["check-ref-format", "--branch", plannedBranch], { stdio: ["ignore", "pipe", "pipe"] }); }
    catch { throw oatsError("E_BAD_ARGS", `branch ${JSON.stringify(plannedBranch)} is not a valid branch name`); }
    if (shInTry(repoAbs, `git rev-parse --verify --quiet ${shq("refs/heads/" + plannedBranch)}`) !== undefined) throw oatsError("E_BRANCH_EXISTS", `branch ${plannedBranch} already exists in ${repoAbs}; choose another name or reuse it deliberately`);
    // Without --base, a clone of the soul's repository branches from the commit this spawn observed it at
    // (the one the resolution, and so the decision, binds), never from what the clone has checked out: a
    // clone is often a human's checkout or a shared reference, far behind (awebai/oats#445).
    observedBase = o.baseRef ? null : observedSoulBase(o.prepared, repoAbs);
    if (observedBase) plannedBase = { ref: observedBase.key, oid: observedBase.oid };
    else {
      const baseRef = o.baseRef || "HEAD";
      const baseOid = shInTry(repoAbs, `git rev-parse --verify --quiet ${shq(baseRef + "^{commit}")}`);
      if (baseOid === undefined) throw oatsError("E_BASE_UNKNOWN", `base ${JSON.stringify(baseRef)} does not resolve to a commit in ${repoAbs}`);
      plannedBase = { ref: baseRef, oid: baseOid };
    }
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
    // `settings.<cap>` is the MERGED payload per module (workspace ⊕ soul ⊕
    // local.settings ⊕ --provider), i.e. what the provider receives. Reserved and
    // poison keys were refused by resolveSoul before this point (E_WORKSPACE_SCHEMA).
    const preparedProviders = structuredClone(o.prepared.spawn?.providers && typeof o.prepared.spawn.providers === "object" ? o.prepared.spawn.providers : {});
    // Addendum 5: where each leaf of `settings.<cap>` came from (JSON pointer → { kind, at }):
    // manifest-default | workspace | soul | host | spawn, the last layer that set it.
    const preparedSettingsOrigins = Object.fromEntries(o.prepared.resolution.modules.map((m) => [m.name, structuredClone(o.prepared.resolution.payloadOrigins?.[m.name] ?? {})]));
    const preparedSettings = Object.fromEntries(o.prepared.resolution.modules.map((m) => [m.name, structuredClone(o.prepared.resolution.payloads?.[m.name] && typeof o.prepared.resolution.payloads[m.name] === "object" ? o.prepared.resolution.payloads[m.name] : {})]));
    return deliver({
      // Team model v2: the soul's teams here (unmapped rows included) and its default — the choice a
      // Desktop offers before anything is minted; joining any but the default is the provider's explicit act.
      ...{ modules: o.prepared.preview ?? null, teams: structuredClone(o.prepared.resolution.teams ?? []), defaultTeam: structuredClone(o.prepared.resolution.defaultTeam ?? null), resolution: o.prepared.resolution.revision, declRevision: o.prepared.resolution.declRevision ?? null, payloadRevision: o.prepared.resolution.payloadRevision ?? null, workspace: o.prepared.discovery?.key ?? null, standalone: o.prepared.discovery?.standalone === true, providers: preparedProviders, settings: preparedSettings, settingsOrigins: preparedSettingsOrigins },
      spawnPreviewApi: 2, preview: true, agent: agent.name, kind: agent.kind || "persistent", instance, home, repo: repoAbs, work,
      subject: o.subject ?? { soul: agent.name, agentsRoot: root, context: null },
      decision, preflight,
      backendStatus: launch ? { name: backend, installed: !!which(backend), started: false } : null,
      harness, model: model || null, modelSource: launchSelection.modelSource ?? null, launchConfig: launchConfig?.name ?? null, launchConfigDefault: launchConfig?.harnessDefault === true, yolo, backend,
      launch: launchReport({ declared: launchChoice.declared, harness, model, launchConfig: launchConfig?.name, from: launchChoice.from, at: launchChoice.at }),
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
  // The observed base must be in the clone before anything is placed; a commit that cannot be fetched
  // refuses the spawn, never falling back to the clone's own branch.
  if (observedBase) fetchObservedBase(repoAbs, observedBase);
  // Backend PRESENCE is a prerequisite, checked before anything is placed (M1):
  // an absent tmux binary must fail with nothing created, never after a
  // populated home exists.
  if (launch && !which(backend)) throw new Error(`${backend} not installed (brew install tmux); nothing was created`);
  // Exclusive placement reservation: the parent may be created, the home
  // itself never with `recursive` — EEXIST means another spawn (a concurrent
  // apply of the same decision, or anything else) got here first, and this one
  // has touched nothing.
  mkdirSync(dirname(home), { recursive: true });
  // 0700: the home holds the instance's identity keys, TASK.md and transcripts.
  try { mkdirSync(home, { mode: 0o700 }); }
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
    catch (x) { e.message += ` — rollback INCOMPLETE, remove ${home} manually: ${x.message}`; unconfirmedSpawn(e); }
    return e;
  };
  // Workspace model: copy every resolved capability WHOLE into the new home
  // (.oats/modules/<cap>/, its skills flat in .agents/skills/<skill>/) and record modules/providers
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
      for (const row of rows) row.hooks = materializedHookCommands(row, home);
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
          // Module skills land flat in the canonical skills root; the entries are
          // the names materialize placed for this module (what the resolution
          // promised), verified against the root in the completeness check.
          const skillsRoot = join(home, ".agents", "skills");
          r.path = existsSync(skillsRoot) ? skillsRoot : undefined;
          r.entries = Array.isArray(materializeOutcome?.skills)
            ? materializeOutcome.skills.filter((s) => s.module === r.module).map((s) => s.name)
            : (row?.skills || []).map((p) => basename(p));
        }
      }
    } catch (e) { throw rollbackEmptyOrPreparedHome(e); }
  }
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

  // Skills: module skills were copied WHOLE and FLAT into <home>/.agents/skills/<skill>/
  // by materialize (decision 7/13); here only the soul's own skills join them, one
  // directory each, at the same level — the one level every harness discovers. There
  // is no override: a soul skill named like a module's skill is a duplicate (decision 16). The harness is launched with its normal
  // discovery — the machine's and the repo's skills are the harness's business.
  const sources = [];
  const soulSkills = join(soulDir, "skills");
  if (existsSync(soulSkills)) sources.push({ id: "soul", path: soulSkills });
  const chosen = new Map();
  // Names compare case-insensitively: one directory per skill on a case-insensitive
  // filesystem (APFS, NTFS) must not silently merge `Foo` into `foo`.
  const moduleSkillOwner = new Map((materializeOutcome?.skills || []).map((s) => [s.name.toLowerCase(), s.module]));
  const chosenKeys = new Map();
  const offer = (name, src, source) => {
    const key = name.toLowerCase();
    if (chosenKeys.has(key) || moduleSkillOwner.has(key) || existsSync(join(home, ".agents", "skills", name))) {
      const other = chosenKeys.get(key) ?? (moduleSkillOwner.has(key) ? `module ${moduleSkillOwner.get(key)}'s skill` : `the existing .agents/skills/${name}`);
      throw oatsError("E_SKILL_DUPLICATE", `skill "${name}" from ${source} collides with ${other}`);
    }
    chosen.set(name, { src, source });
    chosenKeys.set(key, source);
  };
  // A refusal here comes after materialize populated the home: remove it whole,
  // like every other failure between materialize and the completeness check.
  try {
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
  } catch (e) { throw rollbackEmptyOrPreparedHome(e); }

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
  // Prepared spawn: every module's declared skill must have been copied to
  // .agents/skills/<skill>/ by materialize — verify the copies landed as
  // readable skills, one level deep, where the harnesses discover them.
  if (o.prepared) {
    for (const r of expectedResources) {
      if (r.deferred !== "materialize" || r.type !== "skill-tree") continue;
      if (!r.path) { incomplete.push(`module "${r.module}" declares skill tree ${r.declared} but .agents/skills is absent`); continue; }
      if (!r.entries.length) incomplete.push(`module "${r.module}" declares skill tree ${r.declared} but none of its skills was copied into .agents/skills`);
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
    let removal = "", removalFailed = false;
    try { rmSync(home, { recursive: true, force: true }); } catch (e) { removalFailed = true; removal = ` — rollback INCOMPLETE, remove ${home} manually: ${e.message}`; }
    const error = oatsError("E_COMPOSITION_INCOMPLETE", `the instance composition did not materialize completely:\n${incomplete.map((m) => `  ${m}`).join("\n")}${removal}`);
    throw removalFailed ? unconfirmedSpawn(error) : error;
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
        incomplete.push(...deleteBranchAsCreated(run, repoAbs, branch, plannedBase.oid));
      }
      try { rmSync(home, { recursive: true, force: true }); } catch (e2) { incomplete.push(`instance home ${home}: ${e2.message}`); }
      const note = incomplete.length ? ` — rollback INCOMPLETE — clean up manually: ${incomplete.join("; ")}` : "";
      const error = new Error(`git worktree add/canonicalization failed: ${original}${note}`);
      throw incomplete.length ? unconfirmedSpawn(error) : error;
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
  // A trigger's event (lib/triggers.mjs): a private copy in the home, named to hooks and the harness
  // as OATS_TRIGGER_EVENT_FILE. Its PR title/body are never in the task: the soul reads them from here.
  let triggerEventFile = null;
  if (o.triggerEvent && typeof o.triggerEvent === "object") {
    triggerEventFile = join(home, ".oats", TRIGGER_EVENT_FILE);
    mkdirSync(dirname(triggerEventFile), { recursive: true });
    writeFileSync(triggerEventFile, JSON.stringify(o.triggerEvent, null, 2) + "\n", { mode: 0o600 });
  }
  // Hooks read the soul the HOME links (the per-commit directory for a workspace
  // soul), never the swappable agents/<name>/soul pointer: a provider that pins a
  // path must pin this instance's content, and OATS_SOUL_ID is what it keys on.
  const hookRes = runLifecycleHooks("spawn", {
    home, instance, agentName: agent.name, soulDir: homeSoulTarget, soulId: preparedSoulId, contextDir: repoAbs,
    workspaceDir: workspaceOf(root), rootDir: root, resolved: resolvedCfg,
    extraEnv: { OATS_TASK: task, OATS_REPO: repoAbs, OATS_BRANCH: branch || "", OATS_WORK: work, OATS_HARNESS: harness, OATS_RUNTIME: harness, OATS_KIND: agent.kind || "persistent", ...(triggerEventFile ? { OATS_TRIGGER_EVENT_FILE: triggerEventFile } : {}) },
  });
  warnings.push(...hookRes.warnings);
  // Which capability hooks RAN (in order) and how each ended — recorded on the
  // `spawned` event below: the instance's event log is the auditable fact that
  // a capability configured itself, independent of whatever the hook printed.
  const hookReceipt = (res) => { const failedBy = new Map((res.failures || []).map((f) => [f.capability, f])); return (res.order || []).map((id) => ({ capability: id, ok: !failedBy.has(id), ...(failedBy.has(id) ? { required: failedBy.get(id).required === true, contract: failedBy.get(id).contract ?? null } : {}), meta: Object.hasOwn(res.meta || {}, id) })); };
  const requiredFailures = (hookRes.failures || []).filter((f) => f.required);
  let windowMayExist = false;
  let spawnTmux;
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
    // On the socket recorded for this spawn: windowMayExist is only set once it is.
    if (windowMayExist) {
      const socket = spawnTmux.socket;
      try { tmuxOn(socket, ["kill-window", "-t", `=${session}:=${instance}`]); } catch { /* verify the effect below */ }
      const winProbe = probe(["tmux", "-u", "-S", socket, "list-windows", "-t", `=${session}`, "-F", "#{window_name}"]);
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
        return { unconfirmed: true, note: quarantineInstanceHome({
          home, instance, agent, soulDir: homeSoulTarget, soulId: preparedSoulId, incomplete, failed, outstandingHooks, outstandingGit,
          repoAbs, work, branch, resolvedCfg, hookMeta: hookRes.meta || {},
          launched: true, tmux: spawnTmux, directoryHome: homeReal, recordRetirementBaseline: true,
        }) };
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
      return { unconfirmed: true, note: `${note}${directoryRecoveries.length ? `; prior work recovery: ${directoryRecoveries.join(", ")}` : ""}` };
    };
    const preserveDirectory = () => {
      if (work !== "directory") return;
      assertDirectoryRoots(home, homeReal);
      const path = join(home, "work");
      if (!readdirSync(path).length) return;
      const directoryFingerprint = directoryBytes(path);
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
        const branchDebt = deleteBranchAsCreated(probe, repoAbs, branch, plannedBase.oid);
        if (branchDebt.length) { incomplete.push(...branchDebt); outstandingGit.add("branch"); }
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
    return { unconfirmed: incomplete.length > 0, note: `${note}${directoryRecoveries.length ? `; directory work preserved at ${directoryRecoveries.join(", ")}` : ""}` };
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
${task.trim() ? `\n## Task\n\n${task.trim()}\n` : "\nNo task was provided at spawn time — await instructions.\n"}`, { mode: 0o600 }); // human text: the owner's only

    // Launch command. Spawn IS session start: the recipe is persisted in
    // instance.json beside its rendering, which is executed in the instance's
    // tmux window. Capabilities contributed harness-specific arguments and
    // environment through their spawn hook; both are recorded with provenance.
    // The home's `oats` is this kernel, launched now or later (--no-launch).
    const shimTarget = writeKernelShim(home);
    const recipe = {
      version: LAUNCH_RECIPE_VERSION, harness,
      launchConfig: launchConfig?.name || null, launchConfigSource: launchConfig?.source || null, ...(launchConfig?.harnessDefault ? { launchConfigDefault: true } : {}),
      executable: bin, executableDeclared: executable.declared, executableResolvedFrom: executable.resolvedFrom,
      args: [...(launchConfig?.args || [])], env: { ...(launchConfig?.env || {}) },
      model: model || null, ...(yolo !== undefined ? { yolo } : {}),
      hooks: { launch: { ...hookRes.launch }, env: { ...hookRes.env }, contributions: hookRes.contributions || [] },
      prompt: LAUNCH_PROMPT, kernelBin: shimTarget,
    };
    if (triggerEventFile) recipe.env.OATS_TRIGGER_EVENT_FILE = triggerEventFile;
    const folderTrust = launchFolderTrust({ harness, home, meta: { workspace: { deployment: o.prepared?.deployment } }, yolo });
    if (folderTrust.warning) warnings.push(folderTrust.warning);
    let cmdline = renderLaunchRecipe(recipe, { home, instance, trustHome: folderTrust.trustHome });

    // Module skills as materialize landed them (flat, .agents/skills/<skill>/),
    // beside the soul's own: per-skill provenance `module:<cap>` (lead decision c3),
    // `from` = the home's module copy the skill was copied from.
    const moduleSkills = (materializeOutcome?.skills || []).map((row) => ({ name: row.name, source: `module:${row.module}`, from: join(home, row.from) }));
    const meta = {
      agent: agent.name, kind: agent.kind || "persistent", instance, home, soulDir: homeSoulTarget,
      repo: repoAbs, work, branch, ...(plannedBase ? { base: plannedBase } : {}), harness, model: model || undefined, modelFrom: modelFromOf(launchSelection.modelSource, { at: "spawn" }) ?? undefined,
      // Feature launch-preference: the layer that decided this launch, and the soul's own preference then.
      launchFrom: launchChoice.from, launchAt: launchChoice.at, launchDeclared: launchChoice.declared,
      ...(yolo !== undefined ? { yolo } : {}),
      parentInstance: parentInstance && parentInstance !== instance ? parentInstance : undefined,
      siblingInstance: siblingInstance && siblingInstance !== instance ? siblingInstance : undefined,
      relation: relation || undefined,
      relativeTo: relation ? relativeTo : undefined,
      spawnOrigin: relation || (parentInstance && parentInstance !== instance) ? "instance" : "operator",
      policy: { childSpawns: ownChildPolicy },
      ...(triggerEventFile ? { trigger: { id: o.triggerEvent.trigger, key: o.triggerEvent.key ?? null, source: o.triggerEvent.source, repo: o.triggerEvent.repo, number: o.triggerEvent.number, url: o.triggerEvent.url ?? null, event: o.triggerEvent.event, headSha: o.triggerEvent.headSha ?? null, observedAt: o.triggerEvent.observedAt ?? null, eventFile: triggerEventFile } } : {}),
      // K6c: a decision-bound spawn records what bound it, so a retry with the
      // same key replays this receipt instead of spawning again.
      // The FULL bound decision (placement + effective), exactly as the fence
      // compared it — a receipt echoes what it was bound to, not a subset.
      ...(o.expectDecision !== undefined ? { decision: buildDecision() } : {}),
      ...(o.idempotencyKey !== undefined ? { spawnIdempotencyKey: String(o.idempotencyKey), spawnCompleted: false } : {}),
      capabilityMeta: Object.keys(hookRes.meta).length ? hookRes.meta : undefined,
      capabilities: resolvedCfg.capabilities.map((cap) => ({
        id: cap.id, layer: cap.layer, command: cap.command, origin: cap.origin, level: cap.level,
        settings: cap.settings, settingsOrigins: cap.settingsOrigins ?? {}, provenance: cap.provenance, skills: cap.skills || [],
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
        id: cap.id, layer: cap.layer, level: cap.level, settings: cap.settings, settingsOrigins: cap.settingsOrigins ?? {},
        hooks: cap.hooks, requiredHooks: cap.requiredHooks, environment: cap.environment, environmentNamespaces: cap.environmentNamespaces,
        missingRequires: cap.missingRequires, trust: cap.trust,
        executable: cap.executable,
      })),
      tmux: { session, window: instance },
      launch: recipe, command: cmdline, createdAt: new Date().toISOString(),
    };
    // Workspace model: materialize recorded modules/providers (and the module
    // digests) in instance.json before this metadata is assembled — carry them.
    if (o.prepared) {
      try { const prior = JSON.parse(readFileSync(join(home, "instance.json"), "utf8")); if (prior.modules) meta.modules = prior.modules; if (prior.providers) meta.providers = prior.providers; } catch { /* materialize wrote it; absent means nothing to carry */ }
      // M5/3a: the workspace's name and the deployment directory are recorded, so a home
      // answers them (inspect/operation run --home, OATS_WORKSPACE_NAME) without discovery.
      meta.workspace = { key: o.prepared.discovery?.key ?? null, name: o.prepared.discovery?.workspace?.name ?? null, deployment: o.prepared.deployment ?? null, commit: o.prepared.discovery?.commit ?? null, resolution: o.prepared.resolution.revision, standalone: o.prepared.discovery?.standalone === true, soul: { id: preparedSoulIdOf(o.prepared.soulEntry), repoKey: o.prepared.soulEntry.repoKey, commit: o.prepared.soulEntry.commit, ...(typeof o.prepared.soulEntry.package === "string" ? { name: o.prepared.soulEntry.name, qualifiedName: o.prepared.soulEntry.qualifiedName, package: { id: o.prepared.soulEntry.package, version: o.prepared.soulEntry.version, commit: o.prepared.soulEntry.commit, digest: o.prepared.soulEntry.digest, path: o.prepared.soulEntry.path } } : {}) }, layers: layerRows(o.prepared.resolution) };
      // Team model v2: the teams at spawn, exactly as the providers received them (OATS_TEAMS: mapped
      // rows only) and the default, recorded as EVIDENCE beside `providers` (never inside that
      // capability-keyed map). A home's hooks and operations get the LIVE set (liveTeams); this is
      // what they fall back to when the workspace cannot answer.
      meta.teams = envRows(o.prepared.resolution.teams ?? []);
      meta.defaultTeam = structuredClone(o.prepared.resolution.defaultTeam ?? null);
    }
    const spawnWarnings = warnings;

    spawnTmux = meta.tmux;
    if (work === "directory") assertDirectoryRoots(home, homeReal);
    let executionCommand = launch ? nativeRecordCommand(cmdline, home, harness) : null;
    if (launch) {
      // The session on the OATS server, then everything on the one socket that answered: the collision
      // check, the records, the window and (in compensateSpawn) its removal.
      const socket = ensureOatsTmuxSession(session, existsSync(root) ? root : workspaceOf(root), undefined, tmuxSessionPlan);
      // The harness looked up again on the PATH this window's pane will actually start with, whoever
      // created the session and with whatever environment (a race lost to another creator, a session
      // that overrides PATH). Not there: refused, and the spawn is compensated. Found elsewhere than
      // the preflight found it: the launch runs that one.
      if (executable.lookup) {
        const actual = resolveLaunchExecutable({ harness, declared: launchConfig?.executable, declaringDir: launchConfig?.source, lookup: lookupFor(() => panePath(socket, session, undefined, home)) });
        if (!actual.path) throw executableNotOnPanePath(actual, { harness, config: launchConfig, from: launchChoice.from, at: launchChoice.at });
        const bad = checkLaunchExecutable(actual.path);
        if (bad) throw oatsError("E_LAUNCH_EXECUTABLE", `launch configuration ${launchConfig?.name || "(harness default)"}: ${bad}`);
        if (actual.path !== recipe.executable) {
          recipe.executable = actual.path;
          meta.command = cmdline = renderLaunchRecipe(recipe, { home, instance, trustHome: folderTrust.trustHome });
          executionCommand = nativeRecordCommand(cmdline, home, harness);
        }
      }
      let present;
      try { present = tmuxOn(socket, ["list-windows", "-t", `=${session}`, "-F", "#{window_name}"]).split("\n").filter(Boolean); }
      catch (e) { throw new Error(`could not list the windows of tmux session ${session} on ${socket}: ${tmuxFailure(e, "tmux list-windows failed")}`); }
      if (present.includes(instance)) throw new Error(`tmux window "${instance}" already exists in session ${session}`);
      meta.tmux.socket = socket;
      meta.launched = true;
      // Commit the final child metadata and its independent byte authority before
      // the managed harness can write. No child-home transition follows launch.
      writeFileSync(join(home, "instance.json"), JSON.stringify(meta, null, 2) + "\n");
      writeRetirementBaseline(home, join(home, "work"), work, resolvedCfg.capabilities, { launched: true, tmux: meta.tmux });
      // Wrap the command so the window drops into an interactive shell when the
      // agent exits (e.g. Ctrl-C) instead of tmux killing the window.
      const windowCmd = paneCommand(executionCommand);
      const paneEnvFlags = launchEnvRefs(recipe, process.env).flatMap((r) => ["-e", `${r.name}=${r.value}`]);
      const launchFailed = (step, refused, e) => oatsError("E_SPAWN_LAUNCH_FAILED", `tmux ${step} failed for ${instance} (${e.code === "ENOENT" ? "tmux unavailable" : refused}); the command line and tmux's output are withheld from this message because they can carry reference values; run tmux -S ${shellWord(socket)} list-windows -t ${shellWord(session)} to inspect`);
      windowMayExist = true;
      let windowId;
      try { windowId = tmuxOn(socket, ["new-window", "-P", "-F", "#{window_id}", "-t", `=${session}:`, "-n", instance, "-c", home, ...paneEnvFlags, windowCmd], undefined, oatsWindowEnvironment()).trim(); }
      catch (e) { throw launchFailed("new-window", "the window command was refused", e); }
      try { prepareAgentWindow(socket, windowId); }
      catch (e) { throw launchFailed("set-option", "the new window's options were refused", e); }
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
    return deliver({ ...meta, ...(o.expectDecision !== undefined ? { replayed: false } : {}), launch: redactLaunchRecipe(recipe), command: redactLaunchCommand(cmdline), attach: launch ? `tmux -S ${shellWord(meta.tmux.socket)} attach -t ${shellWord(session)}` : `oats session attach --home ${shellWord(home)}`, warnings: spawnWarnings.length ? spawnWarnings : undefined });
  } catch (error) {
    try {
      const compensation = compensateSpawn();
      error.message += compensation.note;
      if (compensation.unconfirmed) unconfirmedSpawn(error);
    } catch (cleanupError) {
      // An interrupted compensation pass cannot establish that effects ended.
      error.message += ` — rollback INCOMPLETE: cleanup could not be completed: ${cleanupError.message}`;
      unconfirmedSpawn(error);
    }
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
/** The window names of `session` on the tmux server at `socket`: `{ windows }`, empty when the server
 *  or the session is gone; `{ error }` when the server could not be read. */
function recordedTmuxWindows(socket, session) {
  try { return { windows: tmuxOn(socket, ["list-windows", "-t", `=${session}`, "-F", "#{window_name}"]).split("\n").filter(Boolean) }; }
  catch (e) {
    if (tmuxServerLost(e) || /can't find session/i.test(String(e.stderr ?? ""))) return { windows: [] };
    return { error: String(e.stderr ?? e.message ?? "").trim() || "tmux list-windows failed" };
  }
}
/** A status row's liveness from its session's windows: unknown (not false) when the server could not be read. */
function tmuxLiveness({ windows, error }, window) {
  return error ? { running: null, runtimeState: "unreachable", runtimeError: error } : { running: windows.includes(window) };
}
export function listInstances(root, tmuxSession = DEFAULT_TMUX_SESSION) {
  // Liveness reads each home's RECORDED endpoint (a pre-0.31 home records pi-agents): the recorded
  // socket, never the ambient $TMUX server, once per socket and session per call, so status costs no
  // more child processes as homes grow. A home without a recorded socket reads the default server.
  const tmuxByEndpoint = new Map();
  const windowsOf = (session, socket) => {
    const key = JSON.stringify([socket ?? null, session]);
    if (!tmuxByEndpoint.has(key)) tmuxByEndpoint.set(key, socket ? recordedTmuxWindows(socket, session) : { windows: tmuxWindows(session) });
    return tmuxByEndpoint.get(key);
  };
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
        // A home opened in Herdr (removed in 0.31.0) is listed, never observed: its row says so.
        const liveness = recordsHerdr(meta, readJsonOrUndefined(retirementBaselinePath(home)))
          ? { running: null, runtimeState: "unsupported", runtimeError: `E_HERDR_REMOVED: ${herdrInstanceRemoved(e.name).message}` }
          : tmuxLiveness(windowsOf(meta.tmux?.session || tmuxSession, meta.tmux?.socket), meta.tmux?.window || meta.instance || e.name);
        const identity = servedIdentityOf(meta);
        // Feature desktop-facts: `startedAt` — the last session start or restart (the receipt's restarts[]),
        // else the spawn's own launch (createdAt), else null (never launched); `identityAddress` — the
        // messaging identity's address (or alias) its capability recorded, null otherwise; `modelFrom` — null
        // for a home spawned before it was recorded.
        const lastStart = Array.isArray(meta.restarts) && meta.restarts.length ? meta.restarts[meta.restarts.length - 1]?.startedAt ?? null : null;
        const facts = { startedAt: lastStart ?? (meta.launched ? meta.createdAt ?? null : null), identityAddress: identity ? identity.address ?? identity.alias ?? null : null, modelFrom: meta.modelFrom ?? null };
        // The home IS the directory enumerated here, and the instance its name:
        // a file inside it cannot relocate or rename itself in the roster (every
        // consumer acting on `home` — retire, inspect --home, the Desktop's file
        // roots — would inherit the claim). A disagreeing claim survives only as
        // a diagnostic.
        const claims = {
          ...(meta.home !== undefined && meta.home !== home ? { recordedHome: meta.home } : {}),
          ...(meta.instance !== undefined && meta.instance !== e.name ? { recordedInstance: meta.instance } : {}),
        };
        // Feature waiting-on-you: a producer's live claim that the instance is
        // blocked on a human, read only for a running row (one bounded read of
        // its home log); null otherwise, and null means unknown. `running` is
        // the window's presence, which a crashed harness's fallback shell or a
        // retained dead pane keeps: a row with a claim is shown only when its
        // session is observed running a harness, as session inspect reports it.
        let waitingOnYou = liveness.running === true ? liveWaiting(home) : null;
        if (waitingOnYou) {
          try { const s = instanceSessionTarget(home); if (!s.target || !harnessRunning(inspectSessionTarget(s.target))) waitingOnYou = null; }
          catch { waitingOnYou = null; }
        }
        return { ...meta, ...claims, home, instance: e.name, ...facts, ...(identity ? { identity } : {}), ...(meta.launch && typeof meta.launch === "object" ? { launch: redactLaunchRecipe(meta.launch) } : {}), ...(typeof meta.command === "string" ? { command: redactLaunchCommand(meta.command) } : {}), ...liveness, waitingOnYou, ...(rollbackIncomplete ? { rollbackIncomplete } : {}), ...(retirePending ? { retirePending } : {}) };

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

/** The commit a worktree spawn of a workspace soul observed its repository at, when `repoAbs` is a clone of
 *  that repository: { key, oid, remote } (the clone's remote that names it), else null (a package soul, or a
 *  --repo that is not a clone of the soul's repository: the clone's HEAD stays the base). */
function observedSoulBase(prepared, repoAbs) {
  const entry = prepared?.soulEntry;
  if (!entry || typeof entry.package === "string" || typeof entry.repoKey !== "string") return null;
  const oid = entry.memberCommit ?? entry.commit;
  if (typeof oid !== "string" || !/^[0-9a-f]{40,64}$/.test(oid)) return null;
  const remote = cloneRemoteFor(repoAbs, entry.repoKey);
  return remote ? { key: entry.repoKey, oid, remote } : null;
}

/** Make the observed base present in the clone: fetched by id from the remote that names the soul's
 *  repository, never prompting (remote.mjs's git environment), and touching no branch, remote-tracking ref,
 *  FETCH_HEAD or work tree of the clone. */
function fetchObservedBase(repoAbs, { key, oid, remote }) {
  const env = gitEnv();
  const present = () => spawnSync("git", ["-C", repoAbs, "cat-file", "-e", `${oid}^{commit}`], { stdio: "ignore", env, timeout: GIT_TIMEOUT_MS }).status === 0;
  if (present()) return;
  const r = spawnSync("git", ["-C", repoAbs, "fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "--no-recurse-submodules", "--end-of-options", remote, oid],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env, timeout: GIT_FETCH_TIMEOUT_MS });
  if (r.status === 0 && present()) return;
  const lines = String(r.stderr || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const why = r.error?.code === "ETIMEDOUT" ? "timeout" : (lines.find((l) => /^(fatal|error):/.test(l)) ?? lines[0] ?? `git fetch exited ${r.status ?? r.signal}`);
  // A server that only serves advertised refs (protocol v0 without allowAnySHA1InWant) refuses a commit its
  // branches have moved past, and the fetch by hand fails the same way: --base is then the way on.
  throw Object.assign(oatsError("E_REMOTE_UNREADABLE", `cannot fetch commit ${oid.slice(0, 12)} of ${key} into the clone ${repoAbs} from its remote ${remote} (${why}); the instance branch starts at the commit this spawn observed, never at the clone's own branch — fetch it (git -C ${shq(repoAbs)} fetch --end-of-options ${shq(remote)} ${oid}) or name a start point with --base; nothing was created`),
    { details: { repo: repoAbs, repoKey: key, commit: oid, remote } });
}

/** A failed spawn's compare-and-delete of the branch it created at `oid`: `git update-ref -d` refuses
 *  atomically if the tip moved (something was committed there), and the branch is then kept. `run`
 *  answers { ok, out, status, err }. → what is still owed, as messages ([] when the branch is gone). */
function deleteBranchAsCreated(run, repoAbs, branch, oid) {
  const del = run(["git", "-C", repoAbs, "update-ref", "-d", `refs/heads/${branch}`, oid]);
  const ref = run(["git", "-C", repoAbs, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (ref.ok && ref.out.trim() !== oid) return [`git branch ${branch}: kept; its tip moved from ${oid.slice(0, 12)}, where this spawn created it`];
  if (ref.ok) return [`git branch ${branch}: still exists${del.ok ? "" : ` (deletion failed: ${del.err || `exit ${del.status}`})`}`];
  if (ref.status !== 1 || ref.err) return [`git branch ${branch}: could not verify deletion (${ref.err || `exit ${ref.status}`})`];
  return [];
}
/** Retain the home and its cleanup receipt when spawn compensation or retirement
 * cannot finish. Keeping the original credentials makes cleanup retryable. */
function quarantineInstanceHome({ home, instance, agent, soulDir, soulId, incomplete, failed, outstandingHooks, outstandingGit, repoAbs, work, branch, resolvedCfg, hookMeta, compensationMeta, launched, tmux, recordRetirementBaseline = false, reason, directoryPreservation = false, orphanedWork = false, directoryHome = realPathOrNearest(home) }) {
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
        outstanding: { hooks: [...outstandingHooks], git: [...outstandingGit], ...(directoryPreservation ? { directory: true } : {}), ...(orphanedWork ? { orphanedWork: true } : {}) },
        capabilityRuntime: (resolvedCfg.capabilities || []).map((cap) => ({
          id: cap.id, layer: cap.layer, level: cap.level, settings: cap.settings, settingsOrigins: cap.settingsOrigins ?? {},
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
      writeRetirementBaseline(home, join(home, "work"), work, resolvedCfg.capabilities || [], { launched: launched === true, tmux });
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
  // A worktree directory whose git admin entry is gone (awebai/oats#444) is debt too: the retry proves it
  // cleared when the directory is no longer there or has its admin entry back.
  const orphanDebt = c.outstanding?.orphanedWork === true && c.work === "worktree";
  if (c.outstanding?.orphanedWork !== undefined && !orphanDebt) return false;
  if (!Array.isArray(c.capabilityRuntime) || (!c.capabilityRuntime.length && !directoryDebt && !orphanDebt)) return false;
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
  if (!c.outstanding.hooks.length && !c.outstanding.git.length && !directoryDebt && !orphanDebt) return false;
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
 *  instance, not the instance's work, so the stored digest a spawn baseline is
 *  compared with passes over them — otherwise every stop or event write would
 *  read as "changed home bytes". The home copy carries them, so the exact
 *  digest, which says whether the retire hooks moved the home, holds them.
 *  A new kernel-written top-level home entry, whether or not it belongs here,
 *  MUST be added in the same change to the names a capability may not declare
 *  as its own (`retirement.disposable.home`: KERNEL_HOME_NAMES and
 *  KERNEL_HOME_NAME_PREFIXES in lib/capability-contract.mjs, and the schema). */
const KERNEL_HOME_RECEIPTS = new Set([".oats-events.jsonl", ".oats-stop.json", ".oats-stop-receipt.json", ".oats-restart.json"]);
const KERNEL_HOME_RECEIPT_PATTERNS = [/^\.oats-stop-receipt\..+\.json$/, /^\.oats-agents-md\..+\.previous$/];
/** Harness project settings in the home are configuration, not work: the
 *  home's `.claude/` is harness layout the kernel already shapes (the skills
 *  alias), and capabilities keep their own entries current in its
 *  settings.json at every launch. The stored digest passes over exactly that
 *  path, home-relative; the exact digest holds it, as the home copy does. */
const HARNESS_HOME_SETTINGS = new Set([join(".claude", "settings.json")]);
/** The refusal for an entry that is not a file, a directory or a symbolic link
 *  (a socket, a FIFO, a device): it has no bytes to read or to copy. One
 *  sentence for every caller of fingerprintTree, at spawn and at retire, so it
 *  names neither. It does not say "remove": the entry may be a live endpoint. */
const unsupportedEntry = (path) => oatsError("E_WORK_INSPECTION_FAILED", `${path} has an unsupported filesystem type: it is not a file, a directory or a symbolic link, so it cannot be read or copied. Safely stop the process or resource that owns it, or move the entry elsewhere, before retrying`);
const PATH_SEPARATOR_BYTES = Buffer.from(sep);
/** The digests of a tree, from one walk that reads each file once → { stored,
 *  exact }; each only when asked for (`stored` by default).
 *
 *  Both hash, for each entry in order, its path under the root, its
 *  permission bits, its kind, and a file's bytes or a link's target. Entry
 *  names and link targets are read and hashed as bytes, never as decoded
 *  text: two trees that differ only in bytes that are not UTF-8 have two
 *  digests, and an entry with such a name is read, not missed. This is about
 *  what a digest tells apart. It does not make such a tree copyable:
 *  copyTreeSafe reads entry names as text and cannot carry a file name that
 *  is not UTF-8.
 *
 *  A name's text (its bytes decoded as UTF-8, the way readdirSync decodes
 *  them: replacement characters for bytes that are not UTF-8, a byte order
 *  mark kept) is used only to order the entries and to test membership: the
 *  names a digest passes over and `instance.json`, as they have always been
 *  tested. Both digests pass over what a copy does not carry: `excludeRoot`
 *  and, with `excludeGitMetadata`, `.git`. Only the stored digest also passes
 *  over the kernel's receipts and the harness settings of a home.
 *
 *  `stored` is the digest a spawn baseline holds, written by this kernel or
 *  by an older one, so it never changes: its framing (each field followed by
 *  NUL, no lengths), its order, and a home's `instance.json` without the
 *  fields the kernel writes after spawn (kernelNeutralInstanceJson). For a
 *  tree whose names and link targets are all valid UTF-8 it is what it was
 *  when they were read as text: hashing a text hashes its UTF-8, which is
 *  those bytes. It is what is compared with a baseline. Without lengths it
 *  reads alike a file whose bytes spell the entry that follows it and those
 *  two entries, and the neutral form reads alike two `instance.json` files
 *  that parse to the same value.
 *
 *  `exact` is for every comparison of a tree with itself later, or with its
 *  copy: whether the retire hooks left it as it was. It is kept nowhere. It
 *  holds every entry the copy carries: of a home, the kernel's receipts and
 *  the harness settings too, which the copy carries and a retire hook can
 *  write. Two different trees cannot give it the same stream: an entry is its
 *  path, its mode, its kind and its content, where the path and the content
 *  carry their length and the mode and the kind end in NUL, so the stream can
 *  be read back into its entries in one way only, and a tree is the set of
 *  its entries. A home's `instance.json` goes in as the bytes it has.
 *
 *  The root's own permission bits, which are no entry of the walk, are in
 *  the exact digest: a path the recovery copier copies is compared with its
 *  own bits, because copyTreeSafe ends with a chmod of what it made.
 *  `children` is for a root the copier creates itself (a home, a worktree):
 *  its copy is made inside a directory the copier creates, so the root's bits
 *  are no part of what it carries, and the root is compared through its
 *  children alone. The stored digest never holds the root's bits. */
function fingerprintTrees(root, { excludeRoot = new Set(), excludeGitMetadata = false, instanceHome = false, stored = true, exact = false, children = false } = {}) {
  const s = stored ? createHash("sha256") : null, x = exact ? createHash("sha256") : null;
  const digests = () => ({ stored: s ? `sha256:${s.digest("hex")}` : undefined, exact: x ? `sha256:${x.digest("hex")}` : undefined });
  /** A field of the exact digest whose length is not fixed: its length, NUL, its bytes. */
  const sized = (bytes) => { x.update(String(bytes.length)); x.update("\0"); x.update(bytes); };
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory()) {
    const mode = String(rootStat.mode & 0o7777);
    s?.update(mode); s?.update("\0");
    x?.update("entry\0"); x?.update(mode); x?.update("\0");
    if (rootStat.isSymbolicLink()) { const target = readlinkSync(root, "buffer"); s?.update("link\0"); s?.update(target); if (x) { x.update("link\0"); sized(target); } }
    else if (rootStat.isFile()) { const bytes = readFileSync(root); s?.update("file\0"); s?.update(bytes); if (x) { x.update("file\0"); sized(bytes); } }
    else throw unsupportedEntry(root);
    return digests();
  }
  x?.update(children ? "tree\0" : `tree with its mode\0${rootStat.mode & 0o7777}\0`);
  // `dir` and `rel` are bytes: the directory, and its path under the root
  // (empty at the root). `relText` is `rel` as text, for the name tests.
  // `outer` is the stored hash, or null inside an entry it passes over.
  const walk = (dir, rel, relText, outer) => {
    // The order is the one it has always been: the names as text, compared
    // by localeCompare, on the listing as readdirSync returns it. The sort is
    // stable and the listing is the same whether its names come as text or
    // as bytes, so a tree whose names are all valid UTF-8 is walked in the
    // order it always was. Names that decode alike (two that are not UTF-8,
    // or one and a name that really holds the replacement character) keep
    // the listing's order. Where that order is not fixed, two reads of one
    // directory can differ, which adds a copy attempt; two different trees
    // cannot read alike for it, because the bytes of every name are hashed.
    const entries = readdirSync(dir, { encoding: "buffer" }).map((bytes) => ({ bytes, name: bytes.toString("utf8") }));
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const { bytes: nameBytes, name } of entries) {
      if ((!relText && excludeRoot.has(name)) || (excludeGitMetadata && name === ".git")) continue;
      const childRelText = relText ? join(relText, name) : name;
      const storedPassesOver = instanceHome && ((!relText && (KERNEL_HOME_RECEIPTS.has(name) || KERNEL_HOME_RECEIPT_PATTERNS.some((p) => p.test(name)))) || HARNESS_HOME_SETTINGS.has(childRelText));
      if (storedPassesOver && !x) continue;
      const s = storedPassesOver ? null : outer;
      const childRel = rel.length ? Buffer.concat([rel, PATH_SEPARATOR_BYTES, nameBytes]) : nameBytes;
      const path = Buffer.concat([dir, PATH_SEPARATOR_BYTES, nameBytes]);
      const st = lstatSync(path);
      const mode = String(st.mode & 0o7777);
      s?.update(childRel); s?.update("\0"); s?.update(mode); s?.update("\0");
      if (x) { sized(childRel); x.update(mode); x.update("\0"); }
      if (st.isSymbolicLink()) {
        const target = readlinkSync(path, "buffer");
        s?.update("link\0"); s?.update(target); s?.update("\0");
        if (x) { x.update("link\0"); sized(target); }
      } else if (st.isFile()) {
        const bytes = readFileSync(path);
        // Kernel-field neutrality applies ONLY when the tree IS an instance home, and only to the
        // stored digest; a work tree's instance.json is the agent's bytes.
        s?.update("file\0"); s?.update(instanceHome && !relText && name === "instance.json" ? kernelNeutralInstanceJson(bytes) : bytes); s?.update("\0");
        if (x) { x.update("file\0"); sized(bytes); }
      } else if (st.isDirectory()) { s?.update("dir\0"); x?.update("dir\0"); walk(path, childRel, childRelText, s); }
      else throw unsupportedEntry(join(root, childRelText));
    }
  };
  walk(Buffer.from(root), Buffer.alloc(0), "", s);
  return digests();
}
/** The stored digest of a tree (fingerprintTrees): what a spawn baseline holds and is compared with. */
function fingerprintTree(root, options = {}) {
  return fingerprintTrees(root, { ...options, stored: true, exact: false }).stored;
}
/** The exact digest of a tree (fingerprintTrees): what a tree is compared with itself later, or with its copy. */
function exactTreeDigest(root, options = {}) {
  return fingerprintTrees(root, { ...options, stored: false, exact: true }).exact;
}
/** The bytes of a directory instance's work/, as their exact digest, with the
 *  permission bits of work/ itself: what a copy of it carries. Kept nowhere. */
const directoryBytes = (work) => exactTreeDigest(work);

/** A worktree directory whose git admin entry is gone: no `.git`, an unreadable one, or a gitfile naming an
 *  admin directory that no longer exists. Read from the gitfile, not asked of git, which would walk up into
 *  whatever repository encloses the home. A `.git` directory is a repository of its own, not this case. */
function worktreeAdminMissing(work) {
  const dotGit = join(work, ".git");
  let stat;
  try { stat = lstatSync(dotGit); } catch { return true; }
  if (stat.isDirectory()) return false;
  if (!stat.isFile()) return true;
  let text;
  try { text = readFileSync(dotGit, "utf8"); } catch { return true; }
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(text);
  if (!m) return true;
  return !existsSync(join(resolve(work, m[1]), "HEAD"));
}
/** A repository's status as Git printed it, as bytes. A path that is not
 *  UTF-8 is in there as it is: the work state compares these bytes
 *  (repositoryGitState). Output that does not decode is not a failure; only
 *  a `git status` that fails is. */
function worktreeStatusBytes(repo) {
  try {
    return execFileSync("git", ["-C", repo, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching", "--ignore-submodules=none"], { stdio: ["ignore", "pipe", "pipe"] , maxBuffer: GIT_MAX_BUFFER });
  } catch (e) {
    throw oatsError("E_WORK_INSPECTION_FAILED", `could not inspect instance worktree: ${String(e.stderr ?? e.message ?? "").trim() || "git status failed"}`);
  }
}
/** The same status as text, for what reads its rows: the classes, the rows a
 *  spawn baseline was taken from, the comparison of a copy with its source.
 *  Bytes that are not UTF-8 read as replacement characters here, so this
 *  text is never what proves a worktree unchanged. */
function worktreeStatus(repo) {
  return worktreeStatusBytes(repo).toString("utf8");
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
    // Bytes that are not UTF-8 would each read as the replacement character,
    // and two such files would then read alike: a file that does not decode
    // and encode back to the same bytes is hashed as it is, like one that is
    // not JSON.
    const text = String(bytes);
    if (!Buffer.from(text).equals(bytes)) return bytes;
    const m = JSON.parse(text);
    if (!m || typeof m !== "object" || Array.isArray(m)) return bytes;
    for (const k of KERNEL_POST_SPAWN_FIELDS) delete m[k];
    return Buffer.from(JSON.stringify(m));
  } catch { return bytes; }
}
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** The provider-owned home entries the active capabilities declare
 *  (`retirement.disposable.home`, lib/capability-contract.mjs) → [{ owner, root }],
 *  sorted by owner then root. Recorded in the spawn baseline: retirement reads
 *  them from there and from nowhere else. */
function retirementDisposableHome(capabilities) {
  const rows = new Map();
  for (const cap of capabilities || []) {
    for (const root of cap?.retirement?.disposable?.home || []) {
      if (disposableHomeRootProblem(root)) throw new Error(`retirement disposable home entry from ${cap.id} is not declarable: ${JSON.stringify(root)}`);
      rows.set(`${cap.id}\0${root}`, { owner: cap.id, root });
    }
  }
  return [...rows.values()].sort((a, b) => byCodeUnit(a.owner, b.owner) || byCodeUnit(a.root, b.root));
}
/** A baseline's `disposableHome`, or no exclusions at all: it must be an array
 *  of { owner, root } whose every root passes the manifest grammar. Anything
 *  else (absent, an older baseline, a malformed or widened row) excludes
 *  nothing, so the home is copied whole. Never the manifest in the home's
 *  module copy, the capability as it is today, or instance.json. */
function baselineDisposableHome(baseline) {
  const rows = baseline?.disposableHome;
  if (!Array.isArray(rows) || !rows.every((r) => isPlainObject(r) && nonEmptyString(r.owner) && !disposableHomeRootProblem(r.root))) return [];
  return rows.map((r) => ({ owner: r.owner, root: r.root })).sort((a, b) => byCodeUnit(a.owner, b.owner) || byCodeUnit(a.root, b.root));
}
/** One pass's resolved exclusion set: the home's top-level entries that
 *  `disposableHome` rows cover, matched by name (a symlink is its name; it is
 *  never followed). The fingerprint, the copy and the copy's verification of
 *  that pass all use this one set. → { excludeRoot: Set (work/ and the covered
 *  names), notCopied: [{ scope: "home", path, owner }] sorted by path }: names
 *  and owners only. Two owners of one entry: the first in owner order. */
function resolveHomeExclusions(home, disposableHome = [], extraTrees = []) {
  const excludeRoot = new Set(["work"]);
  const notCopied = [];
  const extra = new Set(extraTrees.map((t) => t.name));
  if (!disposableHome.length && !extra.size) return { excludeRoot, notCopied };
  for (const name of readdirSync(home).sort(byCodeUnit)) {
    const owner = extra.has(name) ? EXTRA_WORKTREE_OWNER : name === "work" ? undefined : disposableHome.find((r) => disposableHomeRootMatches(r.root, name))?.owner;
    if (!owner) continue;
    excludeRoot.add(name);
    notCopied.push({ scope: "home", path: name, owner });
  }
  return { excludeRoot, notCopied };
}

/** The `notCopied` owner of a verified extra tree: the retire's extra-tree
 *  step handles it, not the home recovery. */
const EXTRA_WORKTREE_OWNER = "kernel:extra-worktree";
/** `git worktree list --porcelain -z` → [{ worktree, locked }]: `locked` is
 *  the lock's reason ("" when it gives none), undefined when not locked. */
function parseWorktreeList(out) {
  const records = [];
  for (const field of out.split("\0")) {
    if (field.startsWith("worktree ")) records.push({ worktree: field.slice("worktree ".length) });
    else if (records.length && (field === "locked" || field.startsWith("locked "))) records.at(-1).locked = field.slice("locked ".length);
  }
  return records;
}
/** The home's extra trees (awebai/oats#674), in every work mode: top-level
 *  entries named `.work-*` that are real directories (not symlinks), whose
 *  `.git` is a regular file, and that Git confirms are registered linked
 *  worktrees of a repository outside the home: the git dir differs from the
 *  common dir, the toplevel is the entry, and the repository's worktree list
 *  names it. The repository is that list's first entry (its main worktree, or
 *  the bare dir), as for the primary checkout (canonicalDeploymentPath).
 *  Anything else named `.work-*` is ordinary home bytes. Read-only probes
 *  (gitRead). → [{ name, path, repo, gitDir, commonDir, locked }] sorted by
 *  name: `commonDir` is the repository's Git directory, which the step and
 *  the reachability read name it by (bare or not). */
function extraWorktreesOf(home) {
  const trees = [];
  let names;
  try { names = readdirSync(home); } catch { return trees; }
  const realHome = realPathOrNearest(home);
  const inHome = (p) => { const rel = relative(realHome, realPathOrNearest(p)); return rel === "" || !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)); };
  for (const name of names.sort(byCodeUnit)) {
    if (!name.startsWith(".work-")) continue;
    const path = join(home, name);
    try {
      if (!lstatSync(path).isDirectory() || !lstatSync(join(path, ".git")).isFile()) continue;
    } catch { continue; }
    const dirs = gitRead(path, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir", "--show-toplevel"]);
    if (!dirs.ok) continue;
    const [gitDir, commonDir, toplevel] = dirs.out.split("\n");
    if (!gitDir || !commonDir || !toplevel || realPathOrNearest(gitDir) === realPathOrNearest(commonDir)) continue;
    const real = realPathOrNearest(path);
    // A repository inside the home goes with the home: its trees are home bytes.
    if (realPathOrNearest(toplevel) !== real || inHome(commonDir)) continue;
    const list = gitRead(path, ["worktree", "list", "--porcelain", "-z"]);
    if (!list.ok) continue;
    const records = parseWorktreeList(list.out);
    const self = records.find((r) => realPathOrNearest(r.worktree) === real);
    if (!records.length || !self) continue;
    trees.push({ name, path, repo: records[0].worktree, gitDir, commonDir: realPathOrNearest(commonDir), locked: self.locked });
  }
  return trees;
}
/** Where a retired worktree is re-homed: `<workspace>/.agents/worktrees/<repoName>/<leaf>`,
 *  the leaf being the branch, else `detached-<commit>`; when that exists (or
 *  `taken` holds it), `<leaf>-2`, `-3`, … The one naming rule of work/ and of
 *  the extra trees. Creates nothing. */
function retainedWorktreeDest(workspace, repo, branch, commit, taken = new Set()) {
  const repoName = basename(realPathOrNearest(repo)).replace(/\.git$/, "") || "repo";
  const leaf = (branch ?? `detached-${(commit || "unknown").slice(0, 12)}`).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "work";
  const retainedRoot = join(workspace, ".agents", "worktrees", repoName);
  let dest = join(retainedRoot, leaf);
  for (let n = 2; existsSync(dest) || taken.has(dest); n++) dest = join(retainedRoot, `${leaf}-${n}`);
  taken.add(dest);
  return dest;
}
/** What retirement does with each extra tree (`trees`: extraWorktreesOf) →
 *  [{ path, repo, branch, detachedAt, disposition, movedTo, reason }], one row
 *  per tree in order: the retire plan's `extraWorktrees` and the binding the
 *  retire checks before it acts. `remove` when the tree is clean: an empty
 *  status (ignored and untracked files count), no operation in progress, and
 *  a HEAD commit some ref of the repository reaches: its shared refs, never
 *  the tree's own HEAD, reflog or refs/worktree/, which go with its admin
 *  entry when it is removed. `retain` (to `movedTo`) otherwise, with why
 *  in `reason`; a HEAD that cannot be read is not clean. `refuse` for a locked
 *  tree, which Git will neither move nor remove. Read-only. */
function extraWorktreeRows(trees, root) {
  const taken = new Set();
  return trees.map((tree) => {
    let name = null, commit = null;
    try { name = headName(tree.path); } catch { /* not clean, below */ }
    try { commit = worktreeHead(tree.path).commit; } catch { /* not clean, below */ }
    const row = { path: tree.path, repo: tree.repo, branch: name?.branch ?? null, detachedAt: name?.detached ? commit : null, disposition: "remove", movedTo: null, reason: null };
    if (tree.locked !== undefined) return { ...row, disposition: "refuse", reason: `it is locked${tree.locked ? ` (${tree.locked})` : ""}; unlock it with \`git worktree unlock\`, or move it out of the home, then retire again` };
    const why = [];
    if (!name || !commit) why.push("its HEAD could not be read");
    const status = gitRead(tree.path, ["status", "--porcelain", "-z", "--ignored", "--untracked-files=all", "--ignore-submodules=none"]);
    if (!status.ok) why.push(`its status could not be read (${status.err})`);
    else if (status.out.length) why.push("it holds uncommitted, untracked or ignored files");
    if (RECOVERABLE_GIT_ADMIN.some((n) => existsSync(join(tree.gitDir, n)))) why.push("an operation is in progress in it");
    if (commit) {
      const reach = gitRepoRead(tree.commonDir, ["for-each-ref", "--contains", commit, "--count=1", "--format=%(objectname)"]);
      if (!reach.ok) why.push(`which refs reach its HEAD commit could not be read (${reach.err})`);
      else if (!reach.out.length) why.push("its HEAD commit is reached by no ref");
    }
    if (!why.length) return row;
    return { ...row, disposition: "retain", movedTo: retainedWorktreeDest(workspaceOf(root), tree.repo, row.branch, commit, taken), reason: why.join("; ") };
  });
}
/** The retire plan's view of a home's extra trees: extraWorktreeRows of what
 *  is there now. */
export function extraWorktreePlan(home, root) {
  return extraWorktreeRows(extraWorktreesOf(home), root);
}
function unionNotCopied(...lists) {
  const byPath = new Map();
  for (const row of lists.flatMap((list) => list || [])) if (!byPath.has(row.path)) byPath.set(row.path, row);
  return [...byPath.values()].sort((a, b) => byCodeUnit(a.path, b.path));
}
function retirementBaselineValid(baseline, home) {
  return baseline?.version === RETIRE_BASELINE_VERSION && baseline.home === realPathOrNearest(home);
}
/** What a retire plan may say about recovery without hashing anything: where a
 *  recovery would be written, and the home entries the spawn baseline declares
 *  as not copied (none without a valid baseline). */
export function retirementRecoveryFacts(home) {
  const baseline = readJsonOrUndefined(retirementBaselinePath(home));
  return { recoveryRoot: join(retirementStateRoot(home), "recovery"), disposableHome: retirementBaselineValid(baseline, home) ? baselineDisposableHome(baseline) : [] };
}
function writeRetirementBaseline(home, work, mode, capabilities, runtime, { exclusive = false, incarnationId, executionBinding } = {}) {
  if (mode === "directory") assertDirectoryRoots(home);
  const isWorktree = mode === "worktree";
  const status = isWorktree && existsSync(work) ? worktreeStatus(work) : "";
  const disposableReceipts = isWorktree ? retirementDisposableRoots(work, capabilities) : [];
  const disposableHome = retirementDisposableHome(capabilities);
  const baseline = {
    version: RETIRE_BASELINE_VERSION,
    ...(incarnationId ? { incarnationId, executionBinding } : {}),
    ...(mode === "directory" ? { directoryWork: true, directoryRoots: { home: directoryIdentity(home), work: directoryIdentity(work) } } : {}),
    home: realPathOrNearest(home),
    homeFingerprint: fingerprintTree(home, { excludeRoot: resolveHomeExclusions(home, disposableHome).excludeRoot, instanceHome: true }),
    disposableReceipts,
    disposableHome,
    generatedWorkFingerprint: isWorktree ? generatedWorkFingerprint(work, status, disposableReceipts.map((r) => r.root)) : undefined,
    runtime: {
      launched: runtime?.launched === true,
      ...(runtime?.tmux ? { tmux: { session: runtime.tmux.session, window: runtime.tmux.window, ...(runtime.tmux.socket ? { socket: resolve(runtime.tmux.socket) } : {}) } } : {}),
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

/** Whether the recovery can copy the branch recorded at spawn: only when Git
 *  shows it (exit 0). Asked by a quarantine retry for a worktree that is gone:
 *  a failed spawn's rollback may have deleted the branch. A branch Git cannot
 *  show (absent, or a damaged ref) is not copied; no retire deletes it, so it
 *  stays in the repository, and the quarantine's own check of the branch says
 *  whether it could be shown gone. */
function recordedBranchExists(repo, branch) {
  if (!repo || !branch) return true;
  const r = spawnSync("git", ["-C", repo, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_MAX_BUFFER });
  return !r.error && r.status === 0;
}

/** Herdr (removed in 0.31.0) is recognised in a home only to refuse: its instance.json records a
 *  Herdr session target or `backend: "herdr"`, or its independent receipt records a session target
 *  (a tmux receipt never does). Either source is enough. */
function recordsHerdr(meta, baseline) {
  return (isPlainObject(meta) && (meta.sessionTarget !== undefined || meta.backend === "herdr"))
    || (isPlainObject(baseline?.runtime) && baseline.runtime.sessionTarget !== undefined);
}
function readJsonOrUndefined(path) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; } }
/** Refuse any session operation on a home opened in Herdr, from its files as they are (either may be
 *  missing or unreadable): before any receipt validation, so the refusal is never an endpoint error. */
function refuseHerdrHome(home) {
  if (recordsHerdr(readJsonOrUndefined(join(home, "instance.json")), readJsonOrUndefined(retirementBaselinePath(home)))) throw herdrInstanceRemoved(basename(home));
}

function runtimeAuthorityOf(baseline) {
  const runtime = baseline?.runtime;
  if (!isPlainObject(runtime) || typeof runtime.launched !== "boolean") return undefined;
  if (!runtime.launched) return { launched: false };
  if (runtime.sessionTarget !== undefined) return undefined;
  const tmux = runtime.tmux;
  if (!isPlainObject(tmux) || ![tmux.session, tmux.window, tmux.socket].every((v) => typeof v === "string" && v.length > 0)) return undefined;
  return { launched: true, tmux: { session: tmux.session, window: tmux.window, socket: resolve(tmux.socket) } };
}

/** instance.json's tmux endpoint is the one the independent receipt authorises. */
function tmuxEndpointAgrees(meta, authority) {
  return meta.tmux?.session === authority.tmux?.session && meta.tmux?.window === authority.tmux?.window && resolve(meta.tmux?.socket || ".") === authority.tmux?.socket;
}

/** Session control uses the independent endpoint receipt. */
function instanceSessionTarget(home) {
  if (typeof home !== "string" || !isAbsolute(home)) throw oatsError("E_BAD_ARGS", "session needs an absolute instance home");
  home = realPathOrNearest(home);
  refuseHerdrHome(home);
  let baseline, meta;
  try {
    baseline = JSON.parse(readFileSync(retirementBaselinePath(home), "utf8"));
    meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  } catch (e) { throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `cannot read session receipt for ${home}: ${e.message}`); }
  const authority = baseline.version === RETIRE_BASELINE_VERSION && baseline.home === home && runtimeAuthorityOf(baseline);
  if (!authority) throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `independent session receipt is missing or invalid for ${home}`);
  if (meta.launched !== authority.launched || (authority.launched && !tmuxEndpointAgrees(meta, authority))) throw oatsError("E_RUNTIME_AUTHORITY_MISMATCH", "instance metadata disagrees with independent session receipt");
  return { home, target: authority.launched ? { backend: "tmux", ...authority.tmux } : undefined };
}

export function inspectInstanceSession(home) {
  if (typeof home === "string" && isAbsolute(home) && !existsSync(home)) return { home: realPathOrNearest(home), backend: null, present: false, state: "stopped", waitingOnYou: null };
  const s = instanceSessionTarget(home);
  if (!s.target) return { home: s.home, backend: null, present: false, state: "not-launched", waitingOnYou: null };
  let observed;
  try { observed = inspectSessionTarget(s.target); }
  catch (e) { throw oatsError("E_SESSION_UNAVAILABLE", `cannot inspect session: ${e.message}`); }
  // Feature waiting-on-you: beside `state`, whose enum is unchanged.
  return { home: s.home, ...observed, waitingOnYou: harnessRunning(observed) ? liveWaiting(s.home) : null };
}
/** Whether an observed session runs a harness: present, and neither a
 *  fallback shell nor a dead pane. Only such a session can be waiting on a human. */
function harnessRunning(observed) { return observed?.present === true && observed.state !== "shell" && observed.state !== "stopped"; }

/** K3: quiesce one instance's session and RETAIN everything else — home,
 *  worktree, transcript, launch configuration — so `restart` can bring it back.
 *  Exactly restart's stop half under the same independent endpoint authority
 *  (`instanceSessionTarget`), bounded and never escalated: a harness still
 *  there after the grace is reported still running, nothing is killed harder.
 *  A no-launch or already-idle instance is a no-op that says so. */
function tmuxServerLost(e) { return /no server running on |(?:error connecting to|failed to connect to) .*(?:No such file or directory|Connection refused)/i.test(String(e.stderr ?? e.message ?? "")); }
/**
 * The live processes (other than this one and its children) whose working
 * directory is inside `home`: `lsof -a -d cwd` over the host, one call.
 * → { ok: true, processes: [{pid, command}] } | { ok: false, error } (the scan
 * could not run, did not complete or listed no process: a caller must treat
 * that as unknown, never as none).
 */
export function processesInHome(home, io) {
  let out;
  try { out = (io?.exec || execFileSync)("lsof", ["-a", "-d", "cwd", "-F", "pRcn", "-w"], { encoding: "utf8", timeout: 20000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) {
    // lsof exits 1 with a full listing when some process could not be read. That is the one failure
    // whose output is a scan: lsof ended by itself with status 1 (no signal, and no error code, which
    // Node sets when the capture itself failed: a timeout, too much output). A scan that was cut off
    // is a failed scan whatever it printed first. The error says what happened, never a line of the
    // listing.
    const completed = e?.status === 1 && e.signal == null && e.code === undefined;
    if (completed && typeof e.stdout === "string") out = e.stdout;
    else return { ok: false, error: e?.code === "ENOENT" ? "lsof is not on PATH"
      : e?.code === "ETIMEDOUT" ? "lsof timed out"
      : e?.code === "ENOBUFS" ? "lsof printed more output than the scan reads"
      : e?.signal ? `lsof was ended by ${e.signal}`
      : String(e?.stderr || e?.message || "lsof failed").trim().split("\n")[0] };
  }
  // A listing holds at least one process (lsof and its caller are always in it), whichever exit it came with.
  if (!/^p\d+$/m.test(String(out))) return { ok: false, error: "lsof listed no process" };
  const realHome = realPathOrNearest(home);
  const processes = [];
  let cur = {};
  for (const line of String(out).split("\n")) {
    const tag = line[0], value = line.slice(1);
    if (tag === "p") cur = { pid: Number(value) };
    else if (tag === "R") cur.ppid = Number(value);
    else if (tag === "c") cur.command = value;
    else if (tag === "n" && cur.pid && cur.pid !== process.pid && cur.ppid !== process.pid) {
      const cwd = realPathOrNearest(value);
      if (cwd === realHome || cwd.startsWith(`${realHome}/`)) processes.push({ pid: cur.pid, command: cur.command ?? "?" });
    }
  }
  return { ok: true, processes };
}

/**
 * A home without a valid independent session receipt (spawned before 0.25.9)
 * has no endpoint OATS may quiesce. It can still be observed ABSENT, which is
 * all a retirement needs: `{ absent: true, backend, note }` only when
 * instance.json records no launch, or the recorded tmux server is gone, or it
 * no longer has the recorded window and no pane on it works in this home —
 * AND no live process on the host works in the home (a harness started by
 * hand on another server is invisible to the recorded endpoint).
 * Anything else (the window is there, a pane or a process works in the home,
 * the process scan cannot run, a launch without an endpoint,
 * tmux failing otherwise) is `{ absent: false, note }`: live or ambiguous,
 * never killed on mutable metadata.
 */
export function observeSessionWithoutReceipt(home, meta, io) {
  const recorded = recordedSessionAbsence(home, meta, io);
  if (!recorded.absent) return recorded;
  const scan = processesInHome(home, io);
  if (!scan.ok) return { absent: false, backend: recorded.backend, note: `could not scan for a process working in this home (${scan.error})` };
  if (scan.processes.length) return { absent: false, backend: recorded.backend, note: `a process works in this home (${scan.processes.slice(0, 5).map((p) => `pid ${p.pid} ${p.command}`).join(", ")}${scan.processes.length > 5 ? `, and ${scan.processes.length - 5} more` : ""}); stop it, then retire` };
  return recorded;
}
function recordedSessionAbsence(home, meta, io) {
  const tmux = meta?.tmux;
  // A --no-launch home keeps its planned tmux names with `launched: false`: nothing was started there.
  if (meta?.launched !== true) return { absent: true, backend: null, note: "no session receipt (a home from before 0.25.9); instance.json records no launch" };
  if (!tmux) return { absent: false, backend: null, note: "instance.json records a launch but no session endpoint" };
  if (![tmux.session, tmux.window, tmux.socket].every((v) => typeof v === "string" && v.length > 0)) return { absent: false, backend: "tmux", note: "instance.json records an incomplete tmux endpoint" };
  const where = `${tmux.session}:${tmux.window} on ${tmux.socket}`;
  let rows;
  try { rows = tmuxOn(tmux.socket, ["list-panes", "-a", "-F", "#{session_name}\t#{window_name}\t#{pane_current_path}"], io).split("\n").filter(Boolean).map((l) => l.split("\t")); }
  catch (e) {
    if (tmuxServerLost(e)) return { absent: true, backend: "tmux", note: `no session receipt (a home from before 0.25.9); the recorded tmux server ${tmux.socket} is not running` };
    return { absent: false, backend: "tmux", note: `tmux could not list ${tmux.socket}: ${String(e.stderr ?? e.message ?? "").trim() || "tmux failed"}` };
  }
  if (rows.some(([s, w]) => s === tmux.session && w === tmux.window)) return { absent: false, backend: "tmux", note: `the recorded window ${where} is still present` };
  const realHome = realPathOrNearest(home);
  const inHome = rows.find(([, , cwd]) => { const p = cwd ? realPathOrNearest(cwd) : ""; return p === realHome || p.startsWith(`${realHome}/`); });
  if (inHome) return { absent: false, backend: "tmux", note: `a tmux pane (${inHome[0]}:${inHome[1]}) on ${tmux.socket} works in this home` };
  return { absent: true, backend: "tmux", note: `no session receipt (a home from before 0.25.9); the recorded window ${where} is gone` };
}
export function stopInstanceSession(home, o = {}) {
  if (typeof home !== "string" || !isAbsolute(home)) throw oatsError("E_BAD_ARGS", "session stop needs an absolute instance home");
  if (o.graceMs !== undefined && (!Number.isSafeInteger(o.graceMs) || o.graceMs < 1 || o.graceMs > 300000)) throw oatsError("E_BAD_ARGS", "stop grace must be 1-300000 ms");
  const realHome = realPathOrNearest(home);
  if (existsSync(retirePendingMarkerPath(realHome))) throw oatsError("E_INSTANCE_RETIRING", `${basename(realHome)} is being retired; nothing was stopped`);
  const s = instanceSessionTarget(realHome);
  if (!s.target) return { home: s.home, backend: null, stopped: false, alreadyIdle: true, state: "not-launched", receipt: null };
  let before;
  try { before = inspectSessionTarget(s.target); }
  catch (e) { if (tmuxServerLost(e)) before = { present: false, state: "stopped" }; else throw oatsError("E_SESSION_UNAVAILABLE", `cannot establish whether ${basename(realHome)} is running, so nothing was stopped: ${e.message}`); }
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

/** The prompt token of a recorded claude or codex command that hands the harness the task's own
 *  text in argv, where any local user can read it: `"$(cat TASK.md)"`. It is parsed, and replaced
 *  when the home starts (withSafeTaskPrompt). */
const LAUNCH_PROMPT_TOKEN = '"$(cat TASK.md)"';
/** A recorded command with its harness's safe task prompt: a `"$(cat TASK.md)"` token becomes
 *  TASK_PROMPT[harness]. Applied when a home starts from its recorded command, which is saved so. */
export function withSafeTaskPrompt(command, harness) {
  const { tokens } = parseLaunchCommand(command);
  if (!tokens.some((t) => t.kind === "prompt")) return command;
  if (!Object.hasOwn(TASK_PROMPT, harness)) throw oatsError("E_LAUNCH_COMMAND_UNSUPPORTED", `a ${harness} command never carried the task as "$(cat TASK.md)"; inspect the saved command in instance.json`);
  return renderLaunchCommand(tokens.map((t) => t.kind === "prompt" ? { kind: "word", value: TASK_PROMPT[harness], quoted: true, text: shq(TASK_PROMPT[harness]) } : t));
}

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

/** One tmux command on `socket`. With `env` (a window client: oatsWindowEnvironment, which has no
 *  PATH) the tmux is the absolute one this process's own PATH finds, so its lookup never depends on
 *  the environment it is passed; none found is reported as tmux being unavailable (ENOENT). */
function tmuxOn(socket, args, io, env) {
  let tmux = "tmux";
  if (env) {
    tmux = process.env.PATH === undefined ? null : lookupOnPath("tmux", process.env.PATH);
    if (!tmux) throw Object.assign(new Error("no tmux was found on this process's PATH"), { code: "ENOENT" });
  }
  return (io?.exec || execFileSync)(tmux, ["-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...(env ? { env } : {}) });
}

function writeJsonAtomic(path, value, mode) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", mode !== undefined ? { mode } : undefined);
  renameSync(tmp, path);
}

// ---------- stopping a harness, selecting on an existing home ----------
/** The harness processes under a tmux session target: EVERY descendant
 *  of the pane's launcher process (the launcher shell itself is left so
 *  that, once its command ends, it becomes the fallback shell the start
 *  path recognizes); a wrapper that does not exec the harness, the harness
 *  and their children are all included, topmost first. Each row:
 *  { pid, ppid, pgid, comm, depth }. */
export function harnessProcesses(target, io) {
  const ps = () => ((io?.exec || execFileSync)("ps", ["-axo", "pid=,ppid=,pgid=,comm="], { encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }))
    .split("\n").map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean)
    .map(([, pid, ppid, pgid, comm]) => ({ pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), comm: basename(comm).replace(/^-/, "") }));
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
    // The origins travel with the settings they describe (the contribution's, else the binding's).
    const settingsOrigins = (contribution?.settings ? contribution.settingsOrigins : binding?.settingsOrigins) ?? {};
    return { id, contribution, binding, settings: contribution?.settings ?? binding?.settings ?? {}, settingsOrigins };
  });
}
/** Capability contributions for a start of an existing home: the recorded
 *  ones, refreshed by any capability that declares a `launch` hook (asked
 *  for the target harness; spawn hooks are never re-run). A harness change
 *  needs the new harness's launch arguments from every capability that
 *  contributed harness-specific ones.
 *  The hook contract: a launch hook may do idempotent provider registration
 *  on a real start. A capability whose manifest (the home's module copy)
 *  declares `launchPreview: true` promises that its hook changes nothing
 *  under OATS_LAUNCH_PREVIEW=1 and returns the same contribution (launch
 *  arguments and env) either way, except for the env names its preview
 *  answer lists in `volatileEnv`, whose values only the real run knows.
 *  `pass` says which hooks run, and how:
 *  - "preview" (a launch preview): declaring hooks under the flag; the others
 *    do not run, and their recorded contributions stand (`notRun`);
 *  - "plan" (a start's preflight): declaring hooks under the flag, the others
 *    once, for real;
 *  - "real" (a start after its preflight passed): declaring hooks for real,
 *    over `frozen.hooks` = the planned contributions; startInstanceSession
 *    refuses a contribution that differs from the preview's. */
export function prepareLaunchHooks({ frozen, harness, resolvedCfg, home, meta, contextDir, extraEnv = {}, assertRoots, pass = "plan" }) {
  const contributions = (frozen.hooks?.contributions || []).map((c) => ({ ...c }));
  const env = { ...(frozen.hooks?.env || {}) };
  const refreshed = [];
  let warnings = [];
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
    if (hooks.launch) withLaunchHook.push({ id: p.id, capability: p.id, manifest, layer: p.contribution?.layer ?? p.binding?.layer ?? manifest.layer ?? null, level: p.contribution?.level ?? p.binding?.level ?? null, settings: p.settings, settingsOrigins: p.settingsOrigins, hooks, trust, environment: [...(manifest.environment || [])], environmentNamespaces: [...(manifest.environmentNamespaces || [])], missingRequires: [] });
  }
  const aware = withLaunchHook.filter((c) => c.manifest.launchPreview === true);
  const unaware = withLaunchHook.filter((c) => c.manifest.launchPreview !== true);
  const runs = (pass === "real" ? [[aware, false]] : pass === "preview" ? [[aware, true]] : [[unaware, false], [aware, true]]).filter(([caps]) => caps.length);
  const notRun = pass === "preview" ? unaware.map((c) => c.id) : [];
  const previewed = runs.filter(([, asPreview]) => asPreview).flatMap(([caps]) => caps.map((c) => c.id));
  const volatileEnv = [];
  if (runs.length) {
    const results = runs.map(([caps, asPreview]) => ({ asPreview, res: runLifecycleHooks("launch", { assertRoots, home, instance: meta.instance, agentName: meta.agent, soulDir: instanceSoulDir(home, meta), contextDir: ctx, rootDir: dirname(dirname(dirname(home))), resolved: { ...(resolvedCfg || {}), capabilities: caps }, priorMeta: meta.capabilityMeta || {}, extraEnv: { OATS_HARNESS: harness, OATS_PREVIOUS_HARNESS: frozen.harness || "", OATS_RUNTIME: harness, OATS_PREVIOUS_RUNTIME: frozen.harness || "", ...(asPreview ? { OATS_LAUNCH_PREVIEW: "1" } : {}), ...extraEnv } }) }));
    const failed = results.flatMap(({ res }) => res.failures || []).map((f) => `${f.capability}: ${f.message}`);
    if (failed.length) throw oatsError("E_LAUNCH_PREPARATION", `a capability could not prepare the ${harness} launch:\n  ${failed.join("\n  ")}`);
    const fresh = results.flatMap(({ res }) => res.contributions || []);
    // Ownership holds across retained AND refreshed contributions, as the
    // spawn runner holds it across providers: a refreshed provider may
    // replace its own previous keys, never a key another provider retains,
    // nor one another provider's hook set in this pass.
    const refreshedIds = new Set(fresh.map((c) => c.capability));
    const retainedOwner = new Map();
    for (const c of contributions) if (c.capability && !refreshedIds.has(c.capability)) for (const name of c.env || []) retainedOwner.set(name, c.capability);
    const freshOwner = new Map();
    for (const c of fresh) for (const name of c.env || []) {
      if (retainedOwner.has(name)) throw oatsError("E_LAUNCH_PREPARATION", `${c.capability}'s launch hook set ${name}, which ${retainedOwner.get(name)} contributed at spawn and retains; one provider owns an environment name; nothing was stopped`);
      if (freshOwner.has(name) && freshOwner.get(name) !== c.capability) throw oatsError("E_LAUNCH_PREPARATION", `${c.capability}'s launch hook set ${name}, which ${freshOwner.get(name)}'s launch hook also set; one provider owns an environment name; nothing was stopped`);
      freshOwner.set(name, c.capability);
    }
    // A preview answer may name env whose values only the real run knows
    // (a credential minted at start). Each is a name the same hook returned,
    // and never a harness's configuration selector: the package probe reads
    // that under the preview's value before the real run.
    for (const { asPreview, res } of results) if (asPreview) for (const [id, names] of Object.entries(res.volatileEnv || {})) {
      if (!Array.isArray(names) || names.some((n) => typeof n !== "string")) throw oatsError("E_LAUNCH_PREPARATION", `${id}'s launch hook answered volatileEnv that is not an array of environment names; nothing was stopped`);
      const returned = (res.contributions || []).find((c) => c.capability === id)?.env || [];
      for (const name of names) {
        if (!returned.includes(name)) throw oatsError("E_LAUNCH_PREPARATION", `${id}'s launch hook declared ${name} volatile but did not return it in env; nothing was stopped`);
        if (HARNESS_CONFIG_SELECTORS.has(name)) throw oatsError("E_LAUNCH_PREPARATION", `${id}'s launch hook declared ${name} volatile, but ${name} selects a harness's configuration, which the start's package probe reads before the real run; a volatile value must not affect harness package resolution; nothing was stopped`);
        volatileEnv.push(name);
      }
    }
    for (const c of fresh) {
      const idx = contributions.findIndex((x) => x.capability === c.capability);
      // The provider's previous contribution goes whole, its env names
      // included, before its new (validated) one is merged: an empty answer
      // is a replacement too.
      for (const name of contributions[idx]?.env || []) delete env[name];
      const row = { ...c, source: "launch-hook" };
      if (idx >= 0) contributions[idx] = row; else contributions.push(row);
      refreshed.push(c.capability);
    }
    for (const { res } of results) Object.assign(env, res.env || {});
    // What the caller records comes from real runs only; a launch preview
    // answers its own runs' warnings.
    const recorded = results.filter(({ asPreview }) => asPreview === (pass === "preview")).map(({ res }) => res);
    // A launch hook's `meta` is part of its documented return (the same shape
    // spawn persists as capabilityMeta). It was collected and then dropped
    // here, so a provider that re-issues a credential at every start — a
    // renewed session grant, for instance — left the ORIGINAL id on record and
    // retire undid the wrong one. Carry it to the caller; the start records it.
    const metaOf = Object.assign({}, ...recorded.map((res) => res.meta || {}));
    hookMeta = Object.keys(metaOf).length ? metaOf : undefined;
    // The hooks' advisory warnings go to the start's answer and events, as
    // spawn's do; they were dropped here before 0.30.
    warnings = recorded.flatMap((res) => res.warnings || []);
  }
  // A hook not run for a preview keeps its recorded contribution: whether it
  // has arguments for the target harness is its own run's answer, at start.
  const unprepared = contributions.filter((c) => !refreshed.includes(c.capability) && !notRun.includes(c.capability) && c.launch && c.launch[frozen.harness] !== undefined && c.launch[harness] === undefined).map((c) => c.capability);
  if (unprepared.length) throw oatsError("E_LAUNCH_PREPARATION", `${unprepared.join(", ")} contributed ${frozen.harness} launch arguments at spawn and none for ${harness}; change that capability's setting (for example its delivery mode), or the provider must declare a launch hook; nothing was stopped`);
  const launch = {};
  for (const c of contributions) { for (const [rt, args] of Object.entries(c.launch || {})) if (args) launch[rt] = `${launch[rt] ? `${launch[rt]} ` : ""}${args}`; }
  return { launch, env, contributions, refreshed, notRun, previewed, volatileEnv, warnings, ...(hookMeta ? { meta: hookMeta } : {}) };
}
/** Environment that selects which configuration (account, packages) a
 *  harness reads, under which the package probe inspects its packages. */
const HARNESS_CONFIG_SELECTORS = new Set(["CLAUDE_CONFIG_DIR", "CODEX_HOME", "PI_CODING_AGENT_DIR"]);


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
  // A home opened in Herdr, or an earlier start that allocated a Herdr pane, is refused before any
  // guard or receipt reads it.
  refuseHerdrHome(realPathOrNearest(home));
  if (readJsonOrUndefined(join(realPathOrNearest(home), ".oats-start-pending.json"))?.target?.backend === "herdr") throw herdrInstanceRemoved(basename(realPathOrNearest(home)));
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
  const launchFailure = (error) => {
    // execFileSync errors embed argv (including capability environment) in
    // message; backend stderr can echo it too. Neither belongs in the API.
    const reason = error.code === "ENOENT" ? "backend executable unavailable"
      : error.code === "ETIMEDOUT" || error.signal === "SIGTERM" ? "backend command timed out" : "backend command failed";
    return oatsError("E_SESSION_START_FAILED", `tmux start of ${basename(realHome)} could not be confirmed (${reason}); inspect the recorded session before retrying. Launch evidence is retained in ${pendingPath}`);
  };
  // The independent receipt first (retire and session consult it), then the
  // mutable metadata; both tmp+rename. A failure between them is what the
  // pending receipt exists for.
  const record = (meta, { id, target, model, command, startedAt, reused, launch, harness: newHarness, yolo: newYolo, stop, nativeRecordId, hookMeta, modelFrom, launchFrom, launchAt, launchDeclared }, clearPending = true) => {
    checkRoots();
    const baselinePath = retirementBaselinePath(realHome);
    let baseline;
    try { baseline = JSON.parse(readFileSync(baselinePath, "utf8")); } catch (e) { throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `independent session receipt is missing or unreadable for ${realHome}: ${e.message}`); }
    if (baseline.version !== RETIRE_BASELINE_VERSION || baseline.home !== realHome || !runtimeAuthorityOf(baseline)) throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `independent session receipt is invalid for ${realHome}`);
    baseline.runtime = { launched: true, tmux: { session: target.session, window: target.window, socket: resolve(target.socket) } };
    writeJsonAtomic(baselinePath, baseline, 0o600);
    if (o.io?.failBeforeMetadataWrite && reused !== "adopted") throw new Error("injected metadata write failure"); // the write after THIS start's allocation
    const recorded = meta.startId === id;
    const restarts = (Array.isArray(meta.restarts) ? meta.restarts : []).slice(recorded ? -20 : -19);
    if (!recorded) restarts.push({ startedAt, model: model ?? null, reused });
    const next = { ...meta, model, command, launched: true, startId: id, restarts, restartCount: (meta.restartCount || 0) + (recorded ? 0 : 1), ...(modelFrom ? { modelFrom } : {}),
      ...(launch ? { launch } : {}), ...(newHarness ? { harness: newHarness } : {}), ...(newYolo !== undefined ? { yolo: newYolo } : {}),
      ...(launchFrom ? { launchFrom, launchAt: launchAt ?? null, launchDeclared: launchDeclared ?? null } : {}),
      // Launch-hook meta lands per capability over the spawn's record; a hook
      // that answered without meta keeps its previous entry (retire reads it).
      ...(hookMeta ? { capabilityMeta: { ...(meta.capabilityMeta || {}), ...hookMeta } } : {}) };
    next.tmux = { session: target.session, window: target.window, socket: resolve(target.socket) };
    writeJsonAtomic(metaPath, next);
    if (clearPending) { checkRoots(); rmSync(pendingPath, { force: true }); }
    return { instance: meta.instance, agent: meta.agent, home: realHome, harness: next.harness, backend: "tmux", model: model ?? null, launchConfig: next.launch?.launchConfig ?? null, yolo: next.yolo ?? null, target, startedAt, restartCount: next.restartCount, reused, warnings: [], ...(nativeRecordId ? { nativeRecordId } : {}), ...(stop ? { stop } : {}) };
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
    // A start that leaves the server the home recorded says so: one line per move (see the docs'
    // "Existing instances"), in the answer and as a launch-warning event.
    const movedWarnings = [];
    // 1. Reconcile a pending receipt before the equality gate: it may be the
    //    only record of a session an earlier start allocated.
    if (existsSync(pendingPath)) {
      let pending;
      try { pending = JSON.parse(readFileSync(pendingPath, "utf8")); } catch { pending = undefined; }
      const pt = pending?.target;
      const validTarget = pt?.backend === "tmux" && [pt.session, pt.window, pt.socket].every((v) => typeof v === "string" && v.length > 0) && isAbsolute(pt.socket);
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
      let st;
      checkRoots();
      try { st = inspectSessionTarget(pending.target, o.io); }
      catch (e) {
        if (lostTmuxServer(e)) st = { present: false, state: "stopped" };
        else throw oatsError("E_SESSION_UNKNOWN", `an earlier start of ${basename(realHome)} recorded a session (tmux ${pending.target.session}:${pending.target.window} on ${pending.target.socket}) that cannot be observed now: ${String(e.stderr ?? e.message ?? "").trim() || e.message}; the receipt ${pendingPath} is kept and nothing was started`);
      }
      // A launch may still consist entirely of shells (startup files, a
      // shell-script harness). Only its own completion marker proves this
      // is a fallback shell. Never respawn an accepted launch in that gap.
      if (st.present && st.state === "shell") {
        const exited = existsSync(exitedPath) && readFileSync(exitedPath, "utf8").trim() === pending.id;
        if (!exited) throw oatsError("E_SESSION_START_BUSY", `${basename(realHome)} is still starting; refresh its status before retrying`);
      }
      const meta = readMeta();
      // A completed start (#691): its receipt names the start instance.json already records, on the
      // target it records. The receipt is history then, never authority: nothing of it is recorded
      // again, so a newer launch recipe or provider metadata stays as it is.
      const rt = meta.tmux;
      const sameTarget = rt && rt.session === pt.session && rt.window === pt.window && typeof rt.socket === "string" && !!rt.socket && resolve(rt.socket) === resolve(pt.socket);
      const running = st.present && st.state !== "shell";
      // The same start on another target is ambiguous while that other target runs; a restart once it
      // no longer runs is the way out (the recorded target is instance.json's, the ordinary path's).
      if (meta.startId === pending.id && !sameTarget && (!o.restart || running)) {
        throw oatsError("E_SESSION_UNKNOWN", `the start ${pending.id} of ${meta.instance} is recorded on tmux ${rt?.session ?? "?"}:${rt?.window ?? "?"} on ${rt?.socket ?? "?"} (\`oats session inspect --home ${realHome}\` shows it), but its receipt ${pendingPath} names tmux ${pt.session}:${pt.window} on ${pt.socket}; the receipt is kept and nothing was started. If that other target is not this instance's session, stop it (\`tmux -S ${pt.socket} kill-window -t ${pt.session}:${pt.window}\`), then run \`oats session restart --home ${realHome}\``);
      }
      if (meta.startId === pending.id) {
        if (running && !o.restart) {
          const asked = (o.model != null && String(o.model).trim() && resolveModelPreference(String(o.model), meta.harness) !== meta.model) || o.launchConfig !== undefined || o.harness !== undefined || o.yolo !== undefined || o.reselectLaunch === true;
          throw oatsError("E_SESSION_RUNNING", `${meta.instance} is already running; nothing was started${asked ? "; the requested model, launch configuration, harness or yolo was not applied: use session restart" : ""}`);
        }
        // A restart, or a target that is gone or a harness that exited: the ordinary start below
        // reads instance.json as it is, and its own receipt replaces this one when it launches. A
        // start refused before that leaves this receipt as it was. The completed start recorded its
        // own session boundary; it is not recorded again.
      } else {
        // Reconcile even an exited target: the independent baseline may
        // already name it while metadata still names the old allocation.
        // The adopted start's session boundary, at its launch time, completed
        // in whichever log the interrupted start did not record it.
        recordStartBoundary(realHome, { startId: pending.id, startedAt: pending.startedAt, harness: pending.harness ?? meta.harness ?? null, backend: "tmux", launchConfig: pending.launch?.launchConfig ?? meta.launch?.launchConfig ?? null, phase: "recovered" });
        const done = record(meta, { ...pending, model: pending.model ?? undefined, reused: "adopted" }, !st.present || st.state === "shell");
        // The adopted target is on another server than the home recorded (the start that allocated it
        // could not record it): this adoption records it, and says so once, here.
        const recordedSocket = typeof meta.tmux?.socket === "string" && meta.tmux.socket ? resolve(meta.tmux.socket) : null;
        if (recordedSocket && recordedSocket !== resolve(pending.target.socket)) {
          const message = sessionMovedWarning(meta.instance, recordedSocket, resolve(pending.target.socket));
          appendEvent(realHome, { kind: "launch-warning", data: { message } });
          movedWarnings.push(message);
        }
        if (st.present && st.state !== "shell") {
          if (o.restart) { rmSync(pendingPath, { force: true }); }
          else {
            // The recovered target runs what the receipt says; a choice made
            // now (model, configuration, harness, yolo) was not applied to it.
            if (o.model != null && String(o.model).trim() && resolveModelPreference(String(o.model), done.harness || meta.harness) !== done.model) throw oatsError("E_SESSION_RUNNING", `${meta.instance} is already running with its previously requested model; its target was recovered, but the new model was not applied`);
            if (o.launchConfig !== undefined || o.harness !== undefined || o.yolo !== undefined) throw oatsError("E_SESSION_RUNNING", `${meta.instance} is already running (its pending start was recovered); the requested launch configuration, harness or yolo was not applied; stop it, or use session restart`);
            return { ...done, warnings: [...done.warnings, ...movedWarnings] };
          }
        }
      }
    }
    // 2. The ordinary gate and observation, all under the lock.
    const receipt = instanceSessionTarget(realHome);
    const meta = readMeta();
    const harness = meta.harness;
    if (!["pi", "claude", "codex"].includes(harness)) throw oatsError("E_LAUNCH_COMMAND_UNSUPPORTED", `instance ${meta.instance || realHome} records harness ${JSON.stringify(harness)}, which this kernel cannot relaunch`);
    let command = meta.command;
    let model = meta.model || undefined;
    // What this start launches: the frozen command (optionally with another
    // model, re-rendered in place), or, under a selection, the recipe
    // re-resolved against the home's current scoped configuration. Every
    // preflight happens here, before anything is observed or stopped.
    // --reselect-launch (feature launch-preference): apply the home's launch layers now (souls.launch,
    // the recorded soul's launch, the host default) instead of the frozen recipe.
    const reselect = o.reselectLaunch === true ? homeLaunchLayers(realHome, meta) : null;
    // The session this start opens its window in when it has to create one, and what its creation
    // needs (planOatsTmuxSession), read at most once: by the plan's lookup or by the creation's preflight.
    const planSession = receipt.target?.session || meta.tmux?.session || DEFAULT_TMUX_SESSION;
    let sessionPlanRead;
    const sessionPlan = () => {
      if (!sessionPlanRead) { try { sessionPlanRead = { plan: planOatsTmuxSession(planSession, o.io) }; } catch (e) { sessionPlanRead = { error: e }; } }
      if (sessionPlanRead.error) throw sessionPlanRead.error;
      return sessionPlanRead.plan;
    };
    // The recorded target, observed once: by the plan's lookup, which must know whether the pane will
    // be reused before it chooses where to look, or by the gate below. A lost server is a stopped one;
    // any other failure is the gate's refusal (E_SESSION_UNKNOWN), and the lookup does not decide it.
    let recordedRead;
    const recordedState = () => {
      if (!recordedRead) {
        try { recordedRead = { state: receipt.target ? inspectSessionTarget(receipt.target, o.io) : { present: false, state: "not-launched" } }; }
        catch (e) { recordedRead = lostTmuxServer(e) ? { state: { present: false, state: "stopped" } } : { error: e }; }
      }
      return recordedRead;
    };
    // A pane the start reuses where it is: one the recorded target shows, running or left as a shell.
    const reusable = (state) => !!(state?.paneId && (state.present || state.state === "stopped"));
    const selected = reselect !== null || o.launchConfig !== undefined || o.harness !== undefined || o.yolo !== undefined;
    const hasRecipe = meta.launch && typeof meta.launch === "object";
    let launchPlan = null, launchHooksPass = null, hookMeta, explicitModelFrom = null, warnings = [];
    if (selected || hasRecipe) {
      // Every start of a home with a recipe (ordinary, model-only, or under a
      // selection) goes through the one planner: recipe shape, the recorded
      // or selected executable, references, capability contributions under
      // the captured settings and current trust. A home without a recipe that
      // is asked for a selection is refused (E_LAUNCH_LEGACY).
      const context = meta.repo && existsSync(meta.repo) ? resolve(meta.repo) : dirname(dirname(dirname(dirname(realHome))));
      // o.teams / o.defaultTeam: the home's LIVE teams, computed by an async caller (liveTeams) —
      // the launch hook re-checks joined memberships against them.
      const resolvedCfg = resolvedFromHome(realHome, meta, { teams: o.teams, defaultTeam: o.defaultTeam, teamsSource: o.teamsSource });
      let agent; try { agent = findAgent(dirname(dirname(dirname(realHome))), meta.agent); } catch { agent = undefined; }
      // Where the plan looks a harness up by name: a pane the start will reuse, on its own recorded
      // session, whatever the OATS server holds; otherwise the session's or the server's PATH when a
      // server runs; when none does, the PATH of the environment this start will create the server
      // with (read once, here, for the plan and for the creation below). For a creator that may not
      // create the server the plan looks on this process's PATH, and its refusal comes at the
      // creation's own place, after the start's other preflights.
      const pane = () => {
        const recorded = recordedState();
        if (reusable(recorded.state)) return panePath(receipt.target.socket, receipt.target.session, o.io, realHome);
        if (recorded.error) return undefined; // the gate refuses below; the lookup does not decide it
        const preview = planOatsTmuxSession(planSession, o.io, { preview: true });
        if (!preview || preview.server) return expectedPanePath(preview, planSession, o.io, realHome);
        try { return expectedPanePath(sessionPlan(), planSession, o.io, realHome); } catch (e) { if (oatsCoded(e)) return undefined; throw e; }
      };
      const plan = planLaunch({ home: realHome, instance: meta.instance, meta, contextDir: context, agentLike: agent || { harness: meta.harness, model: meta.model, yolo: meta.yolo }, selection: { launchConfig: o.launchConfig, harness: o.harness, model: o.model, yolo: o.yolo }, reselect, resolvedCfg, env: o.env || process.env, assertRoots: checkRoots,
        panePath: pane });
      launchPlan = { recipe: plan.recipe, command: plan.command, harness: plan.harness, model: plan.model, yolo: plan.yolo, executable: plan.executable, config: plan.config, launchChoice: plan.launchChoice, trustHome: plan.trustHome, modelFrom: modelFromOf(plan.modelSource, { at: "start", prior: meta.modelFrom ?? null }),
        ...(plan.launchChoice ? { launchFrom: plan.launchChoice.from, launchAt: plan.launchChoice.at, launchDeclared: plan.launchChoice.declared } : {}) };
      // The plan ran preview-aware launch hooks as a preview: their real run, over the planned
      // contributions, waits for the rest of preflight.
      if (plan.previewedHooks.length) launchHooksPass = { frozen: { ...plan.frozen, hooks: plan.recipe.hooks }, harness: plan.harness, resolvedCfg, contextDir: context, previewed: plan.recipe.hooks, volatileEnv: plan.volatileEnv, trustHome: plan.trustHome };
      command = launchPlan.command; model = launchPlan.model;
      // The other launch hooks ran for real in the plan: their warnings are
      // events now, whatever the start does next, and the answer carries them.
      hookMeta = plan.hookMeta;
      warnings = plan.warnings;
      for (const message of warnings) appendEvent(realHome, { kind: "launch-warning", data: { message } });
    } else if (o.model !== undefined && o.model !== null && String(o.model).trim() !== "") {
      const resolved = resolveModelPreference(String(o.model), harness);
      if (!resolved) throw oatsError("E_MODEL_UNKNOWN", `model preference ${JSON.stringify(o.model)} has no entry usable by harness ${harness}; give a ${harness} model id`);
      command = withLaunchModel(command, resolved);
      model = resolved; explicitModelFrom = "start";
    } else parseLaunchCommand(command);
    // A recorded command starts, and is saved, with its harness's safe task prompt.
    if (!launchPlan) command = withSafeTaskPrompt(command, harness);
    // References recorded for this home must resolve on this host on every
    // start path, and the source variables go to the pane, not the command.
    const recipeForEnv = launchPlan?.recipe || (meta.launch && typeof meta.launch === "object" ? meta.launch : null);
    if (recipeForEnv) { const missing = missingLaunchEnvRefs(recipeForEnv.env, o.env || process.env); if (missing.length) throw oatsError("E_LAUNCH_ENV_MISSING", `this home's launch references ${missing.join(", ")}, not set on this host; nothing was started`); }
    const paneEnv = recipeForEnv ? launchEnvRefs(recipeForEnv, o.env || process.env) : [];
    const paneEnvFlags = paneEnv.flatMap((r) => ["-e", `${r.name}=${r.value}`]);
    checkRoots(); // preparation has run; no backend has been changed
    let target = receipt.target;
    const recorded = recordedState();
    if (recorded.error) { const e = recorded.error; throw oatsError("E_SESSION_UNKNOWN", `cannot establish whether ${meta.instance} is running, so nothing was started: ${String(e.stderr ?? e.message ?? "").trim() || e.message}`); }
    let state = recorded.state;
    if (state.present && state.state !== "shell" && !o.restart) throw oatsError("E_SESSION_RUNNING", `${meta.instance} is running (${state.state}); nothing was started`);
    // A caller that will have to create the tmux session reads the environment for it here, unless
    // the plan's lookup read it already with no server running (an instance that cannot is refused
    // here either way): after the start's preflights and its planning,
    // so each of their refusals still answers first, and before the real run of preview-aware
    // launch hooks, a stop and any write of the home's launch state (record, receipt, pending
    // start). A launch hook that does not declare launchPreview has already run and its warnings
    // are already events (above), as before any other late refusal of a start (E_SESSION_RUNNING,
    // E_LAUNCH_ENV_MISSING); nothing undoes what it did, and the hook contract (above
    // prepareLaunchHooks) allows such a hook idempotent provider registration, which the next
    // start repeats. Only when this start will have to create a window: a retained pane is reused
    // where it is. A restart whose window goes away during its stop is decided at the creation.
    const retained = reusable(state);
    const tmuxSessionPlan = retained ? undefined : sessionPlan();
    // A harness the plan looked up by name is looked up again where its pane will look it up, before
    // anything is stopped: the retained pane's own session, or the session this start will create
    // its window in (as planned). Once more on the session ensureOatsTmuxSession returns (below).
    // Not there: refused. Found elsewhere: the launch runs that one, and records it. Every executable
    // named bare (the harness's name, a declared name) is looked up again, also one the plan could only
    // look up on this process's PATH; a recorded (frozen) or a declared path never is.
    const lookAgain = (pane) => {
      if (!launchPlan || launchPlan.config?.frozen || launchPlan.config?.executable?.includes("/")) return false;
      const { config, launchChoice } = launchPlan;
      const actual = resolveLaunchExecutable({ harness: launchPlan.harness, declared: config?.executable, declaringDir: config?.source, lookup: launchLookup(config?.env, o.env || process.env, pane, config?.name, realHome) });
      if (!actual.path) throw executableNotOnPanePath(actual, { harness: launchPlan.harness, config, from: launchChoice?.from, at: launchChoice?.at });
      const bad = checkLaunchExecutable(actual.path);
      if (bad) throw oatsError("E_LAUNCH_EXECUTABLE", `launch configuration ${config?.name || "(harness default)"}: ${bad}; nothing was started`);
      if (actual.path === launchPlan.recipe.executable) return false;
      launchPlan.recipe = { ...launchPlan.recipe, executable: actual.path };
      command = launchPlan.command = renderLaunchRecipe(launchPlan.recipe, { home: realHome, instance: meta.instance, trustHome: launchPlan.trustHome });
      return true;
    };
    lookAgain(retained ? () => panePath(target.socket, target.session, o.io, realHome) : () => expectedPanePath(tmuxSessionPlan, planSession, o.io, realHome));
    // Every preflight has passed: the preview-aware launch hooks run for real
    // (they may register the home with their provider), before a restart's
    // stop, and must contribute exactly what they contributed as a preview,
    // which is what the command was rendered and preflighted from, except the
    // values of the env their preview declared volatile: those come from this
    // run, and the command is rendered again with them.
    if (launchHooksPass) {
      const { previewed, volatileEnv, trustHome, ...pass } = launchHooksPass;
      const real = prepareLaunchHooks({ ...pass, home: realHome, meta, assertRoots: checkRoots, pass: "real" });
      const canon = (v) => canonicalJson(JSON.parse(JSON.stringify(v ?? null)));
      const stable = (h) => Object.fromEntries(Object.entries(h.env).filter(([n]) => !volatileEnv.includes(n)));
      if (canon({ launch: real.launch, env: stable(real), contributions: real.contributions }) !== canon({ launch: previewed.launch, env: stable(previewed), contributions: previewed.contributions })) {
        // A provider's row names its env; the values are in the merged env.
        const rowOf = (h, id) => { const row = h.contributions.find((c) => c.capability === id); return canon({ row, values: (row?.env || []).map((n) => volatileEnv.includes(n) ? null : h.env[n]) }); };
        const differing = [...new Set([...real.contributions, ...previewed.contributions].map((c) => c.capability))].filter((id) => rowOf(real, id) !== rowOf(previewed, id));
        throw oatsError("E_LAUNCH_PREPARATION", `the launch hook of ${differing.join(", ") || "a capability"} returned a contribution that differs from its preview contribution (a launch hook returns the same contribution under OATS_LAUNCH_PREVIEW, apart from the values of its volatileEnv); nothing was stopped or started`);
      }
      launchPlan.recipe = { ...launchPlan.recipe, hooks: { launch: real.launch, env: real.env, contributions: real.contributions } };
      command = launchPlan.command = renderLaunchRecipe(launchPlan.recipe, { home: realHome, instance: meta.instance, trustHome });
      if (real.meta) hookMeta = { ...(hookMeta || {}), ...real.meta };
      // The real run's warnings are events now, whatever the start does next,
      // and the answer carries them.
      warnings = [...warnings, ...real.warnings];
      for (const message of real.warnings) appendEvent(realHome, { kind: "launch-warning", data: { message } });
      checkRoots();
    }
    const planExtra = launchPlan ? { launch: launchPlan.recipe, harness: launchPlan.harness, yolo: launchPlan.yolo, ...(launchPlan.modelFrom ? { modelFrom: launchPlan.modelFrom } : {}),
      ...(launchPlan.launchFrom ? { launchFrom: launchPlan.launchFrom, launchAt: launchPlan.launchAt, launchDeclared: launchPlan.launchDeclared } : {}),
      ...(hookMeta ? { hookMeta } : {}) } : (explicitModelFrom ? { modelFrom: explicitModelFrom } : {});
    let stopReceipt = null;
    if (state.present && state.state !== "shell") {
      // Restart: every preflight above passed, so ask the running harness to
      // end and wait, bounded. A harness still there afterwards is reported
      // as running; nothing is escalated and nothing is launched.
      stopReceipt = stopHarness(target, { graceMs: o.stopGraceMs ?? 20000, io: o.io, kill: o.io?.kill, sleep: o.io?.sleep });
      writeJsonAtomic(join(realHome, ".oats-restart.json"), { instance: meta.instance, at: new Date().toISOString(), stop: stopReceipt, next: { harness: launchPlan?.harness || harness, launchConfig: launchPlan?.recipe?.launchConfig ?? meta.launch?.launchConfig ?? null, model: model ?? null } }, 0o600);
      appendEvent(realHome, { kind: stopReceipt.exited ? "restarted" : "stop-refused", data: { phase: "restart-stop", signal: stopReceipt.signal, waitedMs: stopReceipt.waitedMs, stillRunning: stopReceipt.stillRunning ?? [] } });
      if (!stopReceipt.exited) throw oatsError("E_SESSION_STOP_FAILED", `${meta.instance} was asked to stop (${stopReceipt.signal} to ${stopReceipt.requested.map((r) => `${r.comm} pid ${r.pid}`).join(", ")} at ${stopReceipt.sentAt}) and was still running after ${stopReceipt.waitedMs} ms (${stopReceipt.state}); nothing was escalated and nothing was started; stop it yourself, or retry with a longer --stop-grace. Receipt: ${join(realHome, ".oats-restart.json")}`);
      try { state = inspectSessionTarget(target, o.io); } catch (e) { if (lostTmuxServer(e)) state = { present: false, state: "stopped" }; else throw oatsError("E_SESSION_UNKNOWN", `after the stop, cannot establish the state of ${meta.instance}: ${String(e.stderr ?? e.message ?? "").trim() || e.message}`); }
      if (state.present && state.state !== "shell") throw oatsError("E_SESSION_UNKNOWN", `${meta.instance} read as stopped and then as ${state.state} again; nothing was started`);
    }
    // The kernel that launches the harness is the one the agent's plain `oats` runs.
    checkRoots();
    writeKernelShim(realHome);
    const startedAt = new Date().toISOString();
    const id = randomUUID();
    checkRoots();
    const windowCommand = () => paneCommand(`${nativeRecordCommand(command, realHome, launchPlan?.harness || harness)}; oats_start_status=$?; printf '%s\\n' ${shq(id)} > ${shq(exitedPath)}`);
    let reused = "new";
    const session = target?.session || meta.tmux?.session || DEFAULT_TMUX_SESSION;
    const window = target?.window || meta.tmux?.window || meta.instance;
    let socket = target?.socket || meta.tmux?.socket;
    let windowCmd = windowCommand();
    let moved = null;
    // A fallback shell (no harness descendant) or a retained dead pane is
    // the agent's own pane: the command runs there, on the server the home
    // recorded, no other window touched and no option set.
    const inPlace = state.paneId && (state.present || state.state === "stopped");
    if (inPlace) {
      checkRoots();
      writeJsonAtomic(pendingPath, { id, target, command, model: model ?? null, startedAt, ...planExtra }, 0o600);
      try { tmuxOn(socket, ["respawn-pane", "-k", "-t", state.paneId, "-c", realHome, ...paneEnvFlags, windowCmd], o.io, oatsWindowEnvironment()); }
      catch (e) { throw launchFailure(e); }
      reused = "pane";
    } else {
      const instancesRoot = dirname(realHome);
      const hq = existsSync(dirname(dirname(instancesRoot))) ? dirname(dirname(instancesRoot)) : realHome;
      checkRoots();
      // A replacement window (never launched, recorded window gone, recorded server gone) is created
      // on the OATS server, wherever the home was recorded: one socket from here to the record.
      const recordedSocket = socket ? resolve(socket) : null;
      socket = ensureOatsTmuxSession(session, hq, o.io, tmuxSessionPlan);
      if (lookAgain(() => panePath(socket, session, o.io, realHome))) { planExtra.launch = launchPlan.recipe; windowCmd = windowCommand(); }
      let names;
      try { names = tmuxOn(socket, ["list-windows", "-t", `=${session}`, "-F", "#{window_name}"], o.io).split("\n").filter(Boolean); }
      catch (e) {
        if (oatsCoded(e)) throw e;
        throw oatsError("E_SESSION_UNKNOWN", `cannot list tmux windows on ${socket}: ${tmuxFailure(e, "tmux list-windows failed")}`);
      }
      if (names.includes(window)) throw oatsError("E_SESSION_RUNNING", `tmux window ${session}:${window} appeared on ${socket} during the start; nothing was started`);
      target = { backend: "tmux", session, window, socket };
      checkRoots();
      writeJsonAtomic(pendingPath, { id, target, command, model: model ?? null, startedAt, ...planExtra }, 0o600);
      try { prepareAgentWindow(socket, tmuxOn(socket, ["new-window", "-P", "-F", "#{window_id}", "-t", `=${session}:`, "-n", window, "-c", realHome, ...paneEnvFlags, windowCmd], o.io, oatsWindowEnvironment()).trim(), o.io); }
      catch (e) { throw launchFailure(e); }
      if (recordedSocket && recordedSocket !== socket) moved = sessionMovedWarning(meta.instance, recordedSocket, socket);
    }
    target = { backend: "tmux", session, window, socket: resolve(socket) };
    // The session exists: its boundary (lib/instance-events.mjs) is recorded
    // now, before the metadata, so a start whose metadata write fails still
    // voids the claims of the session it replaced; its adoption only completes a log it missed.
    recordStartBoundary(realHome, { startId: id, startedAt, harness: launchPlan?.harness || harness, backend: "tmux", launchConfig: launchPlan?.recipe?.launchConfig ?? meta.launch?.launchConfig ?? null, phase: o.restart ? "restart" : "start" });
    // Keep launch evidence until the command exits or the target disappears.
    // A transient child (for example the native-start recorder) is not proof that startup
    // has finished. A later start reconciles the receipt without a watcher.
    let done;
    try { done = record(meta, { id, target, model, command, startedAt, reused, ...planExtra, ...(stopReceipt ? { stop: stopReceipt } : {}) }, false); }
    catch (e) {
      if (e.code && String(e.code).startsWith("E_")) throw e;
      throw oatsError("E_SESSION_START_INCOMPLETE", `${meta.instance} was started (tmux ${target.session}:${target.window} on ${target.socket}) but its metadata could not be recorded: ${e.message}; the actual target is kept in ${pendingPath} and the next start adopts it instead of allocating another`);
    }
    // Said once the new socket is recorded: a start that could not record leaves it to the adoption.
    if (moved) { appendEvent(realHome, { kind: "launch-warning", data: { message: moved } }); movedWarnings.push(moved); }
    return { ...done, warnings: [...warnings, ...movedWarnings] };
  } finally {
    // A hook may have replaced the home itself. Never follow that replacement
    // to remove a target's lock; keep the original retry state with its home.
    try {
      const st = lstatSync(realHome);
      if (st.isDirectory() && !st.isSymbolicLink() && st.dev === originalHomeIdentity?.dev && st.ino === originalHomeIdentity?.ino) rmSync(lock, { recursive: true, force: true });
    } catch { /* retain retry state when its authority is lost */ }
  }
}

/** One Git call of a retirement inspection → its stdout, as bytes: a text
 *  with one code unit per byte (latin1), so that no byte is replaced. Git
 *  prints ref names and paths as the bytes they are, and decoded as UTF-8 two
 *  names that differ only in bytes that are not UTF-8 would read alike: a
 *  state a hook changed would compare equal, and a copy would be skipped.
 *  What is compared is this text, never a decoded one. A value that is also
 *  used as a path is decoded where it is used (repositoryGitState).
 *  With `absent`, Git's quiet exit 1 ("no such ref", nothing on stderr)
 *  gives null. Any other failure throws E_WORK_INSPECTION_FAILED: a state
 *  that could not be read is never taken for an unchanged one. What a failed
 *  read of the state means for the retire is inspectRetirementWork's
 *  decision: not provable. */
function inspectGit(repo, args, { absent = false, env } = {}) {
  try {
    return execFileSync("git", ["-C", repo, ...args], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_MAX_BUFFER, ...(env ? { env: { ...process.env, ...env } } : {}) }).toString("latin1");
  } catch (e) {
    const detail = String(e.stderr ?? "").trim();
    if (absent && e.status === 1 && !detail) return null;
    throw oatsError("E_WORK_INSPECTION_FAILED", `could not inspect the Git state of ${repo}: ${detail || String(e.message ?? "").trim() || `git ${args[0]} failed`}`);
  }
}
/** Whether an entry is there, for a read of the Git state. Only "not there"
 *  is absence: a test that fails for any other reason (no permission on a
 *  directory above it, for example) throws, so an entry the kernel cannot see
 *  is never taken for one that does not exist. A link is followed, as
 *  existsSync follows it. */
function inspectedEntryExists(path) {
  try { statSync(path); return true; }
  catch (e) {
    if (e.code === "ENOENT") return false;
    throw oatsError("E_WORK_INSPECTION_FAILED", `could not inspect ${path}: ${e.message}`);
  }
}
/** How the recovery copier resolves what it reads from a repository, read by
 *  the copier and by the comparison alike (repositoryGitState), so that the
 *  comparison holds the files the copy carries, found where the copy finds
 *  them. Git's answer decoded as UTF-8 and trimmed of white space at both
 *  ends: a path that ends in white space is read without it, which Git itself
 *  does not do. That is the copier's own reading, kept as it is; a copy of
 *  the file Git reads would be a change to the copier.
 *  A worktree whose `core.worktree` (per-worktree configuration) names a
 *  directory other than `<home>/work` is outside what the retire is
 *  specified for: Git's status then describes that other directory while
 *  the retire reads, copies and removes `<home>/work`. copierExcludesFile
 *  resolves the excludes base the copier's way for it all the same; no test
 *  pins it. */
const copierGitText = (repo, args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_MAX_BUFFER }).trim();
/** The Git directory the copier copies the index and the operation entries from. */
const copierGitDir = (repo) => copierGitText(repo, ["rev-parse", "--absolute-git-dir"]);
/** The common directory the copier reads info/exclude, info/attributes and the stash's log from. */
const copierCommonDir = (repo) => copierGitText(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
/** The file the copier reads for core.excludesFile; null when it reads none:
 *  the value is unset, cannot be read, or is only white space. */
function copierExcludesFile(repo) {
  let value = "";
  try { value = copierGitText(repo, ["config", "--path", "--get", "core.excludesFile"]); } catch { /* unset: Git's default applies to both repositories alike */ }
  return value ? resolve(copierGitText(repo, ["rev-parse", "--show-toplevel"]), value) : null;
}
/** What a recovery's work copy holds of the worktree's repository beside the
 *  bytes of its files: everything copyRecoveryWork carries or restores, read
 *  the way it reads it, without reading the files. The rule: the work is
 *  unchanged only if everything its copy would carry is byte-for-byte equal,
 *  and anything that cannot be compared exactly counts as changed.
 *   - its status text (the copy is verified against it);
 *   - its HEAD as the copier reads it (headName): the whole ref, as its
 *     bytes, which decides whether the copy is cloned on a branch or
 *     detached; and the commit;
 *   - the index the copier copies, by what it holds and not by its bytes:
 *     its entries as `git ls-files -s -v` lists them (mode, object, stage and path, with the
 *     skip-worktree and assume-unchanged marks), its resolve-undo records
 *     (`git ls-files --resolve-undo`: resolving a conflict can add them while
 *     every entry, status row and byte ends up as it was), and the file's
 *     mode, which copyFileSync gives the copy. Its bytes also hold a stat
 *     cache that a read-only Git command rewrites, and extensions derived
 *     from the entries: those are a deliberate semantic exception, never
 *     compared;
 *   - each path the copier copies from the Git directories (COPIED_GIT_PATHS:
 *     an operation in progress, info/attributes, the stash's log), by what its
 *     copy carries, the permission bits included (copiedGitPathDigest);
 *   - its tags: a clone brings them, and removing the remote leaves them;
 *   - the stash ref (detachRecoveryClone fetches it);
 *   - its exclude rules as carryExcludes reads them: the core.excludesFile
 *     value, the file carryExcludes reads for it (copierExcludesFile), and
 *     info/exclude. They are written into the copy as new text, so their
 *     bytes are what it carries;
 *   - its status settings as carryStatusConfig reads them: the effective
 *     value of each STATUS_CONFIG key. The keys, not the configuration file:
 *     Git rewrites that file for an upstream or a remote, which no copy
 *     carries;
 *   - `cloneHead`, for a worktree whose HEAD the copier copies detached (no
 *     branch, a ref that is not a branch, a name that is not UTF-8): that copy
 *     is cloned without --branch, so it keeps a local branch for the HEAD of
 *     the repository it is cloned from, and none when that HEAD is not on a
 *     branch. That HEAD is read as its whole ref.
 *  The repository's other branches are not here: they outlive the worktree,
 *  and the copy does not hold them. Its tags, stash, rules and settings are
 *  the shared repository's: one made there by anyone while the retire hooks
 *  run adds a copy attempt. The repository's objects and the settings a clone
 *  of it is served under (its shallow boundary, grafts, hidden refs) stay in
 *  it and are not compared: a custody boundary, which holds because no
 *  retire removes that repository or deletes a branch.
 *  Every read is inspectGit's, a file read or an existence test
 *  (inspectedEntryExists): only Git's quiet "not set" and an entry that is
 *  not there are absence; any other failure throws, and the worktree is then
 *  not provable (inspectRetirementWork).
 *  Everything in the list is compared as its bytes; nothing of it goes
 *  through a decoding that replaces a byte. Git's output is inspectGit's
 *  text of bytes, the status is the status bytes as such a text, a file is
 *  the digest of its bytes, and a copied path is its exact digest
 *  (fingerprintTrees), which reads names and link targets as bytes. The
 *  three `rev-parse` paths and the `core.excludesFile` value are in the state
 *  as Git printed them (`paths`, and the first of `excludesFile`), compared
 *  as their bytes; a `rev-parse` path that does not decode to an existing one
 *  throws below, and the worktree is not provable. Every file and directory
 *  the state reads is found where the copier finds it, by the copier's own
 *  functions (copierGitDir, copierCommonDir, copierExcludesFile, headName):
 *  the state is what the copy carries, read the way the copy reads it. A
 *  file the copier does not reach is not there for the state either.
 *  `status`: the repository's worktreeStatusBytes, when the caller has it.
 *  `cloneSource`: the repository the copy is cloned from (meta.repo). */
function repositoryGitState(repo, { status, cloneSource } = {}) {
  /** One of the copier's reads; any failure makes the worktree not provable. */
  const asCopier = (read) => {
    try { return read(repo); }
    catch (e) {
      if (e?.code === "E_WORK_INSPECTION_FAILED") throw e;
      throw oatsError("E_WORK_INSPECTION_FAILED", `could not inspect the Git state of ${repo}: ${String(e?.stderr ?? "").trim() || String(e?.message ?? "").trim()}`);
    }
  };
  // Three paths, one per line. A path with a line feed in it prints more
  // lines, and taken apart wrongly every test below would read "not there",
  // before the hooks and after them alike. So: exactly three, absolute, there.
  /** A value Git printed, as the path the kernel's text paths name with it. */
  const pathOf = (value) => Buffer.from(value, "latin1").toString("utf8");
  const printed = inspectGit(repo, ["rev-parse", "--path-format=absolute", "--absolute-git-dir", "--git-common-dir", "--show-toplevel"]).split("\n");
  if (printed.at(-1) === "") printed.pop();
  const paths = printed.map(pathOf);
  if (paths.length !== 3 || !paths.every((path) => isAbsolute(path) && inspectedEntryExists(path))) {
    throw oatsError("E_WORK_INSPECTION_FAILED", `could not inspect the Git state of ${repo}: git rev-parse did not give its Git directory, its common directory and its top level as three existing absolute paths`);
  }
  const [gitDir, commonDir] = paths;
  const bytesOf = (path) => {
    try { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
    catch (e) {
      if (e.code === "ENOENT") return null;
      throw oatsError("E_WORK_INSPECTION_FAILED", `could not read ${path}: ${e.message}`);
    }
  };
  /** The permission bits a copyFileSync gives the copy of `path`; null when it is not there. */
  const modeOf = (path) => {
    try { return statSync(path).mode & 0o7777; }
    catch (e) {
      if (e.code === "ENOENT") return null;
      throw oatsError("E_WORK_INSPECTION_FAILED", `could not read ${path}: ${e.message}`);
    }
  };
  /** One value Git may not have: null when it is not set. */
  const valueOf = (...args) => inspectGit(repo, args, { absent: true })?.replace(/\n$/, "") ?? null;
  const sourceValueOf = (...args) => inspectGit(cloneSource, args, { absent: true })?.replace(/\n$/, "") ?? null;
  const head = asCopier(headName);
  const copierGit = asCopier(copierGitDir), copierCommon = asCopier(copierCommonDir);
  const excludesFile = valueOf("config", "--path", "--get", "core.excludesFile");
  const excludesRead = asCopier(copierExcludesFile);
  return {
    paths: printed,
    status: (status ?? worktreeStatusBytes(repo)).toString("latin1"),
    head: head.ref === null ? null : head.ref.toString("latin1"),
    commit: valueOf("rev-parse", "--verify", "--quiet", "HEAD"),
    // The index the copier copies (copierGitDir), read as an index: Git's
    // own, at a path that differs from it only in white space, is not what
    // the copy carries. One that is not there lists nothing.
    index: inspectGit(repo, ["ls-files", "-s", "-v", "-z"], { env: { GIT_INDEX_FILE: join(copierGit, "index") } }),
    resolveUndo: inspectGit(repo, ["ls-files", "--resolve-undo", "-z"], { env: { GIT_INDEX_FILE: join(copierGit, "index") } }),
    indexMode: modeOf(join(copierGit, "index")),
    copied: COPIED_GIT_PATHS.map((entry) => copiedGitPathDigest(entry, copiedGitPath(entry, copierGit, copierCommon))),
    tags: inspectGit(repo, ["for-each-ref", "--format=%(objectname) %(refname)", "refs/tags"]),
    stash: valueOf("rev-parse", "--verify", "--quiet", "refs/stash"),
    excludesFile: excludesFile === null && excludesRead === null ? null : [excludesFile, excludesRead, excludesRead && bytesOf(excludesRead)],
    exclude: bytesOf(join(copierCommon, "info", "exclude")),
    statusConfig: STATUS_CONFIG.map((key) => valueOf("config", "--get", key)),
    // The copy is cloned from the repository the instance was spawned from
    // (`cloneSource`, meta.repo), which can be a linked worktree of it: that
    // repository's HEAD is read there, as its whole ref, not the common
    // directory's.
    cloneHead: head.branch === null && gitDir !== commonDir && cloneSource
      ? [sourceValueOf("symbolic-ref", "--quiet", "HEAD"), sourceValueOf("rev-parse", "--verify", "--quiet", "HEAD")]
      : null,
  };
}
/** Every repository under a worktree, at any depth → [{ path, inner }]:
 *  nestedGitRoots, and (`inner`) the repositories inside those. A recovery
 *  rebuilds a nested repository from a clone; one inside it comes along as
 *  plain files, its Git directory included, which the copy's verification
 *  leaves out and which no read-only Git command can describe whole.
 *  A directory whose `.git` cannot be tested (inspectedEntryExists throws),
 *  or is a dangling symbolic link (a link `stat` cannot follow, which the
 *  copy carries as a link and the digests pass over by its name), is listed
 *  as { path, unknown: true }: it is not taken for a directory without a
 *  repository, and not for a repository either. So every directory with a
 *  `.git` entry of any kind is listed: a directory, a file, a link to
 *  anything, a dangling link, and a `.git` that cannot be tested. */
function repositoriesUnder(work) {
  const out = [];
  // Asked only where `stat` found no `.git`: whether there is an entry all the same.
  const entryIsThere = (path) => {
    try { lstatSync(path); return true; }
    catch (e) {
      if (e.code === "ENOENT") return false;
      throw oatsError("E_WORK_INSPECTION_FAILED", `could not inspect ${path}: ${e.message}`);
    }
  };
  const walk = (dir, inner) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.isSymbolicLink?.() || e.name === ".git") continue;
      const path = join(dir, e.name);
      let repository = false;
      try {
        repository = inspectedEntryExists(join(path, ".git"));
        if (!repository && entryIsThere(join(path, ".git"))) out.push({ path, unknown: true });
      } catch (e) {
        if (e?.code !== "E_WORK_INSPECTION_FAILED") throw e;
        out.push({ path, unknown: true });
      }
      if (repository) out.push({ path, inner });
      walk(path, inner || repository);
    }
  };
  walk(work, false);
  return out;
}
/** The work state of a worktree instance, without the bytes of its files: the
 *  worktree's Git state (repositoryGitState), as one text. Two inspections of
 *  an untouched tree give the same text. The bytes are the other part, read
 *  only when needed: observedWorkBytes. A repository under the worktree is not
 *  part of it: such a worktree is not provable (inspectRetirementWork). */
function worktreeGitState(work, status, cloneSource) { // `status`: the worktree's status bytes
  return JSON.stringify({ worktree: repositoryGitState(work, { status, cloneSource }) });
}
/** The bytes of a worktree, Git metadata left out, as their exact digest: what a work copy is verified
 *  with, and what proves that the hooks left the files as they were. One full read. Kept nowhere. */
const worktreeBytes = (work) => exactTreeDigest(work, { excludeRoot: new Set([".git"]), excludeGitMetadata: true, children: true });
/** The byte part of an observed worktree's work state, read at most once per
 *  observation and kept on it; undefined where the observation saw no
 *  worktree. An inspection never reads it. The retire reads it before it
 *  writes the pre-hook recovery, the copy's verification uses it (so a pass
 *  that copies the work costs no extra read), and so does the proof that the
 *  retire hooks left the work as it was (movedByHooks). */
function observedWorkBytes(observation) {
  if (observation.worktree && observation.workBytes === undefined) {
    // A read that fails is an inspection that failed, with its code: where the
    // retire reads before it writes, nothing else gives the failure one.
    try { observation.workBytes = worktreeBytes(observation.work); }
    catch (e) {
      if (e?.code === "E_WORK_INSPECTION_FAILED") throw e;
      throw oatsError("E_WORK_INSPECTION_FAILED", `could not read the worktree at ${observation.work}: ${e.message}`);
    }
  }
  return observation.workBytes;
}
/** What the retire hooks moved, between the observation before them and the
 *  one after → { home, work }. Nothing when the later observation has nothing
 *  to preserve. The home moved when its exact digest did: that is its bytes,
 *  `instance.json` as it is. (The stored digest, which a baseline is compared
 *  with, leaves the kernel's own fields of that file out and frames entries
 *  without lengths; it reads alike some homes that differ.)
 *  The work moved unless it is proven unchanged: a directory by its bytes
 *  (its exact digest); a worktree by its Git state and, only when that is
 *  equal, by its bytes. A status text or a class list alone proves nothing: a
 *  hook can rewrite a file that was already modified. `before` must hold its
 *  bytes already (the retire reads them before it writes the pre-hook
 *  recovery); without them the work counts as moved. So does a worktree that
 *  cannot be proven unchanged at all (`workProvable` false: a worktree that
 *  holds a repository, or a read of the Git state that failed). */
function movedByHooks(before, after) {
  if (!after.classes.length) return { home: false, work: false };
  const home = after.homeBytes !== before.homeBytes;
  let work = after.workFingerprint !== before.workFingerprint;
  if (!work && after.worktree) work = !before.workProvable || !after.workProvable || before.workBytes === undefined || observedWorkBytes(after) !== before.workBytes;
  return { home, work };
}

function inspectRetirementWork(home, work, isWorktree, { recordedBranch, worktreeRemoval, directory = false, orphanedWork = false } = {}) {
  if (directory) assertDirectoryRoots(home);
  const classes = [];
  let baseline;
  const path = retirementBaselinePath(home);
  try {
    if (existsSync(path)) baseline = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw oatsError("E_WORK_INSPECTION_FAILED", `could not read the independent retirement baseline: ${e.message}`);
  }
  const baselineValid = retirementBaselineValid(baseline, home);
  // This pass's one resolved exclusion set: provider-owned entries the spawn
  // baseline declared, and the home's verified extra trees (whatever the
  // baseline), which the retire's extra-tree step handles from this same set.
  // Every home fingerprint here and the copy made from this observation use it.
  const extraTrees = extraWorktreesOf(home);
  const homeExclusions = resolveHomeExclusions(home, baselineValid ? baselineDisposableHome(baseline) : [], extraTrees);
  // One walk of the home, two digests: the stored one for the comparison with
  // the baseline, which must not see the kernel's own fields of instance.json,
  // and the exact one for the comparison after the hooks, which must see
  // every byte.
  let homeDigests;
  const fingerprintHome = () => (homeDigests ??= fingerprintTrees(home, { excludeRoot: homeExclusions.excludeRoot, instanceHome: true, exact: true, children: true })).stored;
  if (!baselineValid) {
    classes.push("unknown instance-home provenance");
  } else if (baseline.homeFingerprint !== fingerprintHome()) {
    classes.push("changed instance-home bytes");
  }
  // A mutable mode must not turn owned directory bytes into an excluded shared
  // tree (or authorize Git deletion). Require the independent spawn authority.
  if (directory !== (baselineValid && baseline.directoryWork === true)) {
    throw oatsError("E_WORK_INSPECTION_FAILED", "directory work mode disagrees with independent retirement authority");
  }
  let directoryFingerprint;
  if (directory) {
    directoryFingerprint = directoryBytes(work);
    // Never stamp hook-created or authored execution bytes as disposable.
    if (readdirSync(work).length) classes.push("directory work bytes");
  }
  // For a quarantine retry whose worktree is gone, whether the recorded branch
  // is still there to copy. Every other retire takes it to be there.
  const branchExists = !directory && recordedBranch && !existsSync(work) ? recordedBranchExists(recordedBranch.repo, recordedBranch.branch) : true;
  // A retire that will remove the worktree asks whether a ref that outlives it
  // reaches its commit. `head` is kept for the check before the removal.
  const unreached = worktreeRemoval?.removes && worktreeRemoval.repo && !directory && isWorktree && existsSync(work) ? worktreeCommitUnreached(worktreeRemoval.repo, work) : undefined;
  if (unreached?.unreached) classes.push("worktree commits no ref reaches");
  const worktree = isWorktree && existsSync(work);
  let gitState = "", workProvable = true;
  if (worktree) {
    // Read once, as bytes. The bytes go into the Git state; the rows, the
    // classes and the comparison with the spawn baseline read them as text.
    const statusBytes = worktreeStatusBytes(work);
    const status = statusBytes.toString("utf8");
    const rows = status.split("\0").filter(Boolean);
    if (rows.some((row) => !row.startsWith("?? ") && !row.startsWith("!! "))) classes.push("tracked or index worktree state");
    const disposableRoots = baseline?.disposableReceipts?.map((r) => r.root) || [];
    if (!baseline || baseline.generatedWorkFingerprint !== generatedWorkFingerprint(work, status, disposableRoots)) classes.push("untracked or ignored worktree bytes");
    const found = repositoriesUnder(work);
    if (found.some((r) => !r.unknown)) classes.push("nested repository state");
    // The one place where a read of the Git state that fails is decided. It
    // is never taken for "not set" or for "unchanged", and it does not refuse
    // either: main's inspection read none of this and let such a retire go
    // on. The worktree is then not provable, and the copy decides, as it did
    // on main: nothing to preserve retires, anything else is copied before
    // the hooks (homeOnlyRecovery) and again after them (movedByHooks).
    // `git status` is not part of this: it failed the inspection on main too.
    try { gitState = worktreeGitState(work, statusBytes, worktreeRemoval?.repo); }
    catch (e) {
      if (!e?.code) throw e;
      workProvable = false;
    }
    // A worktree that holds a repository is not provable either: a directory
    // under it with a `.git` entry of any kind (repositoriesUnder, the
    // predicate the class reads): a directory, a file, a link to anything, a
    // dangling link, and a `.git` that cannot be tested. Only a repository
    // the predicate can see adds the class; the last two make the work
    // unprovable without it, and so never home-only (homeOnlyRecovery): a
    // change to the home alone can then cause a work-copy attempt before
    // the hooks that main did not make, and any failure of that attempt can
    // refuse the retirement. The retire hooks run between the two copies and
    // can change such a repository in ways no read of its state covers (its
    // configuration, its objects, what a clone of it is shown), so its work
    // is copied again after them, whatever they did. What stays in the repository the
    // worktree belongs to needs no copy: no retire removes it or deletes a
    // branch, and a worktree commit no ref reaches is preserved (the class
    // above, `unreached`).
    if (found.length) workProvable = false;
  }
  // Two values, so the post-hook pass can tell which part a hook moved: the
  // home's bytes (its exact digest), and the work state's fingerprint. A
  // directory's work state is its bytes (`directoryFingerprint`, an exact
  // digest too). A worktree's is its Git state here, and its bytes, which an
  // inspection does not read (observedWorkBytes). `workProvable`: whether
  // that state could be read and covers everything a copy of the work would
  // carry. None of these is kept in a baseline, a receipt or recovery.json.
  // When the worktree will be removed, its HEAD (the commit and the ref's
  // bytes) and whether a ref reaches that commit are part of the work state: a
  // hook that deletes the ref that reached the commit changes nothing else
  // the state holds, and the commit must still be preserved again after it.
  fingerprintHome();
  const workFingerprint = createHash("sha256").update(directory ? (directoryFingerprint || "missing") : gitState)
    .update("\0").update(unreached ? `${unreached.head.commit}\0${unreached.unreached ? "unreached" : "reached"}\0` : "")
    .update(unreached?.head.ref ?? "")
    .digest("hex");
  return { classes: [...new Set(classes)], home, work, directory, orphanedWork, worktree, workProvable, directoryFingerprint, homeBytes: homeDigests.exact, workFingerprint, homeExclude: homeExclusions.excludeRoot, notCopied: homeExclusions.notCopied, extraTrees, branchExists, head: unreached?.head, runtimeAuthority: baselineValid ? runtimeAuthorityOf(baseline) : undefined };
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

/** The paths of a repository's Git directories that a recovery's work copy
 *  takes by copying them, beside the clone, the files and the index: one
 *  selection, read by the copier (restoreStandaloneGitState,
 *  carryStatusConfig, detachRecoveryClone) and by the comparison
 *  (repositoryGitState), so that each copied path is compared by what its
 *  copy carries (copiedGitPathDigest). `dir`: the repository's own Git
 *  directory ("git") or its common directory ("common"). `copy`: copyTreeSafe
 *  ("tree") or copyFileSync ("file").
 *  The index is copied whole and is not in the selection: it is compared by
 *  its entries, its resolve-undo records and its mode, never by its bytes,
 *  which hold a cache that a read-only Git command rewrites. That is a
 *  deliberate semantic exception (repositoryGitState). */
const COPIED_GIT_PATHS = [
  ...RECOVERABLE_GIT_ADMIN.map((name) => ({ dir: "git", path: [name], copy: "tree" })),
  { dir: "common", path: ["info", "attributes"], copy: "file" },
  { dir: "common", path: ["logs", "refs", "stash"], copy: "file" },
];
const [GIT_ATTRIBUTES, GIT_STASH_LOG] = COPIED_GIT_PATHS.slice(-2);
const copiedGitPath = ({ dir, path }, gitDir, commonDir) => join(dir === "git" ? gitDir : commonDir, ...path);
/** What the copy of one selected path carries, as a digest; null when the
 *  path is not there. copyTreeSafe gives a copy the entry's kind, bytes or
 *  target, and the bits of the entry and of everything under it: its exact
 *  digest. copyFileSync follows a link and gives the copy the bytes and the
 *  mode of what it reaches: those. Any failure but "not there" throws, as a
 *  read of the Git state does, and so does a file path that is not a file. */
function copiedGitPathDigest(entry, at) {
  if (!inspectedEntryExists(at)) return null;
  try {
    if (entry.copy === "tree") return exactTreeDigest(at);
    const st = statSync(at);
    if (!st.isFile()) throw new Error("it is not a file");
    return createHash("sha256").update(`${st.mode & 0o7777}\0`).update(readFileSync(at)).digest("hex");
  } catch (e) {
    if (e?.code === "E_WORK_INSPECTION_FAILED") throw e;
    throw oatsError("E_WORK_INSPECTION_FAILED", `could not read ${at}: ${e.message}`);
  }
}

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
  const sourceGit = copierGitDir(sourceWork);
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
  // The index is the selection's one exception (COPIED_GIT_PATHS): copied
  // whole, compared by its entries, resolve-undo records and mode.
  copyFileSync(join(sourceGit, "index"), join(recoveredGit, "index"));
  for (const entry of COPIED_GIT_PATHS.filter((e) => e.dir === "git")) {
    const source = copiedGitPath(entry, sourceGit);
    if (!existsSync(source)) continue;
    const dest = copiedGitPath(entry, recoveredGit);
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
  const carried = [], parts = [];
  // A file with no pattern line (Git's template info/exclude is comments only) changes nothing: not carried.
  const carry = (kind, file) => {
    if (!existsSync(file)) return;
    const text = readFileSync(file, "utf8");
    if (!text.split("\n").some((line) => line.trim() && !line.startsWith("#"))) return;
    parts.push(text); carried.push({ kind, path: file });
  };
  const excludesFile = copierExcludesFile(sourceWork);
  if (excludesFile) carry("core.excludesFile", excludesFile);
  carry("info/exclude", join(copierCommonDir(sourceWork), "info", "exclude"));
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
  const common = copierCommonDir(sourceWork);
  const attributes = copiedGitPath(GIT_ATTRIBUTES, null, common);
  if (existsSync(attributes)) {
    const dest = copiedGitPath(GIT_ATTRIBUTES, null, join(recoveredRepo, ".git"));
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(attributes, dest);
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
    const sourceCommon = copierCommonDir(source);
    const stashLog = copiedGitPath(GIT_STASH_LOG, null, sourceCommon);
    if (existsSync(stashLog)) {
      const recoveredLog = copiedGitPath(GIT_STASH_LOG, null, join(recovered, ".git"));
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

/** The home part of a recovery at `dest`: everything but work/ and this pass's
 *  excluded provider-owned entries (observation.homeExclude), verified against
 *  the source with that same set. The copy is hashed whole, so an excluded
 *  entry that reached it fails the verification. The stored digest is what
 *  is compared: it leaves the kernel's own fields of instance.json out, so a
 *  kernel write there between the copy and this check is not a disagreement.
 *  That is an inherited limit, and this is not an exact verification of the
 *  whole home: the stored digest also passes over the kernel's receipts and
 *  the harness settings, reads instance.json through a parse, and frames its
 *  entries without lengths. */
function copyRecoveryHome(observation, dest) {
  const excludeRoot = observation.homeExclude || new Set(["work"]);
  copyRecoveryTree(observation.home, dest, { excludeRoot });
  if (fingerprintTree(observation.home, { excludeRoot, instanceHome: true }) !== fingerprintTree(dest, { instanceHome: true })) {
    throw new Error("home recovery verification disagreed with the source");
  }
}

/** The work part of a recovery under `parent`, copied and verified: `repo/`, a
 *  standalone clone of a worktree instance's repository carrying its
 *  uncommitted state, or `work/`, a directory instance's bytes. A worktree's
 *  source bytes are the observation's (observedWorkBytes), so the verified
 *  value is also its byte state. → { copied, branchDrift?, excludes?,
 *  statusConfig? }; `copied` is false where neither applies (another work
 *  mode, or a worktree home with no recorded repo or branch). A HEAD that
 *  cannot be read is an inspection failure, not a failed copy: its error is
 *  put in `unreadableHeads`, and the callers throw it as it is. */
const unreadableHeads = new WeakSet();
function copyRecoveryWork(observation, meta, parent) {
  let branchDrift, excludes, statusConfig, copied = false;
  if (meta.work === "worktree" && meta.repo && meta.branch && (existsSync(observation.work) || observation.branchExists)) {
    const recoveredRepo = join(parent, "repo");
    // The branch is derived from the worktree while it exists: an instance
    // that legitimately switched branches during its task must still be
    // recoverable, and the recorded spawn-time branch is only the fallback
    // when the worktree is gone. A HEAD that is detached, or on a ref OATS
    // carries no name for, recovers detached at its exact commit.
    let ref;
    try { ref = existsSync(observation.work) ? worktreeHead(observation.work) : { branch: meta.branch, commit: null }; }
    catch (e) { unreadableHeads.add(e); throw e; }
    if (ref.branch !== meta.branch) branchDrift = { recordedBranch: meta.branch, worktreeBranch: ref.branch, detachedAt: ref.branch === null ? ref.commit : null };
    if (ref.branch !== null) execFileSync("git", ["clone", "--no-local", "--quiet", "--branch", ref.branch, meta.repo, recoveredRepo], { stdio: ["ignore", "pipe", "pipe"] , maxBuffer: GIT_MAX_BUFFER });
    else {
      execFileSync("git", ["clone", "--no-local", "--quiet", "--no-checkout", meta.repo, recoveredRepo], { stdio: ["ignore", "pipe", "pipe"] , maxBuffer: GIT_MAX_BUFFER });
      execFileSync("git", ["-C", recoveredRepo, "fetch", "--quiet", observation.work, ref.commit], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_MAX_BUFFER });
      execFileSync("git", ["-C", recoveredRepo, "checkout", "--quiet", "--detach", ref.commit], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_MAX_BUFFER });
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
      // The source's bytes as this observation holds them: read before the
      // pre-hook recovery was written, or by the proof that the hooks moved
      // nothing, or else here. Either way they are kept as the observation's
      // byte state.
      if ((observation.worktree ? observedWorkBytes(observation) : worktreeBytes(observation.work)) !== worktreeBytes(recoveredRepo)) throw new Error("worktree recovery verification disagreed with the source");
      assertStatusAgrees(observation.work, recoveredRepo, "recovered Git index/status disagreed with the source", ".");
    }
    // The proof of the copy: its HEAD is the commit the worktree has checked
    // out. A branch of the repository can be at another commit with the
    // same files, so the branch's tip there proves nothing about the copy.
    // With the worktree gone there is no such commit to read, and the copy
    // is the recorded branch as the repository has it.
    const recoveredHead = execFileSync("git", ["-C", recoveredRepo, "rev-parse", "HEAD"], { encoding: "utf8" , maxBuffer: GIT_MAX_BUFFER }).trim();
    const sourceHead = ref.commit
      ?? execFileSync("git", ["-C", meta.repo, "rev-parse", `refs/heads/${ref.branch}`], { encoding: "utf8" , maxBuffer: GIT_MAX_BUFFER }).trim();
    if (recoveredHead !== sourceHead) throw new Error(ref.commit ? "recovery clone is not at the commit the worktree has checked out" : "recovery clone does not retain the instance branch tip");
    copied = true;
  }
  if (observation.directory && observation.directoryFingerprint) {
    const recoveredWork = join(parent, "work");
    copyTreeSafe(observation.work, recoveredWork);
    if (directoryBytes(observation.work) !== observation.directoryFingerprint || directoryBytes(recoveredWork) !== observation.directoryFingerprint) {
      throw new Error("directory recovery verification disagreed with the inspected source");
    }
    copied = true;
  }
  return { copied, branchDrift, excludes, statusConfig };
}

/** The top-level entries of a recovery's home snapshot with their bytes,
 *  largest first; a directory ends in `/`. What the retire summary names as
 *  copied from the home. */
function preservedHome(recoveredHome) {
  const paths = readdirSync(recoveredHome, { withFileTypes: true })
    .map((e) => ({ path: e.isDirectory() ? `${e.name}/` : e.name, bytes: treeBytes(join(recoveredHome, e.name)) }))
    .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  return { paths, bytes: paths.reduce((n, p) => n + p.bytes, 0) };
}

/** Whether a recovery of this observation holds the home only. A home-only
 *  change (notes, harness files, credentials) needs a home snapshot, not
 *  another copy of an otherwise disposable clean worktree. In-progress Git
 *  operations retain the full standalone recovery even when porcelain status
 *  has no changed paths. An orphaned work directory (no git admin entry) stays
 *  where it is, never moved or removed, and git cannot read it: only the home
 *  is snapshotted. A worktree that cannot be proven unchanged (workProvable
 *  false) is never home-only: after the hooks it could be neither proven nor
 *  taken as copied, so its work goes into the snapshot before them. */
function homeOnlyRecovery(observation, meta) {
  if (observation.orphanedWork === true) return true;
  if (observation.workProvable === false) return false;
  if (!(observation.classes.length === 1 && observation.classes[0] === "changed instance-home bytes" && meta.work === "worktree" && existsSync(observation.work))) return false;
  const gitDir = copierGitDir(observation.work);
  return !RECOVERABLE_GIT_ADMIN.some((name) => existsSync(join(gitDir, name)));
}

/** Write one verified recovery of an observed home and work: staged beside its
 *  final name and renamed into place. `phase` goes into recovery.json:
 *  "before-hooks" for the snapshot a retirement takes before its retire hooks
 *  (completeRetirementRecovery concludes it), "complete" for a recovery nothing
 *  will add to. → { receipt, manifest }: the receipt retire reports, and
 *  recovery.json as written. */
function writeRetirementRecovery(observation, meta, instance, phase) {
  const recoveryRoot = join(retirementStateRoot(observation.home), "recovery");
  mkdirSync(recoveryRoot, { recursive: true });
  if (observation.directory && realpathSync(recoveryRoot) !== join(realpathSync(dirname(observation.home)), ".oats-retirement", "recovery")) {
    throw oatsError("E_WORK_PRESERVATION_FAILED", "directory recovery storage was redirected; retain the source home rather than copying into an unowned or disposable location");
  }
  const staging = mkdtempSync(join(recoveryRoot, `.${instance}-`));
  const recovery = join(recoveryRoot, basename(staging).slice(1));
  try {
    const homeOnly = homeOnlyRecovery(observation, meta);
    const recoveredHome = join(staging, "home");
    copyRecoveryHome(observation, recoveredHome);
    const { branchDrift, excludes, statusConfig } = homeOnly ? {} : copyRecoveryWork(observation, meta, staging);
    const repoCopy = homeOnly ? { copied: false, reason: "Only instance-home bytes changed; no work state requires a repository copy", source: meta.repo, branch: meta.branch } : undefined;
    // What the copy cost: the home entries it carries and the untracked/ignored (or directory) outputs, named.
    const home = preservedHome(recoveredHome);
    const workCopied = observation.directory ? !!observation.directoryFingerprint : !homeOnly && meta.work === "worktree" && existsSync(observation.work);
    const outputs = workCopied ? preservedOutputs(observation.work, observation.directory) : undefined;
    const notCopied = observation.notCopied?.length ? observation.notCopied : undefined;
    const manifest = { version: 1, phase, instance, classes: observation.classes, sourceHome: observation.home, createdAt: new Date().toISOString(), ...(repoCopy ? { repoCopy } : {}), ...(branchDrift ? { branchDrift } : {}), ...(excludes?.length ? { excludes } : {}), ...(statusConfig?.length ? { statusConfig } : {}), home, ...(outputs ? { outputs } : {}), ...(notCopied ? { notCopied } : {}) };
    writeFileSync(join(staging, "recovery.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
    const bytes = treeBytes(staging);
    mkdirSync(dirname(recovery), { recursive: true });
    renameSync(staging, recovery);
    return { receipt: { path: recovery, classes: observation.classes, bytes, home, ...(outputs ? { outputs } : {}), ...(repoCopy ? { repoCopy } : {}), ...(notCopied ? { notCopied } : {}) }, manifest };
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    if (unreadableHeads.has(e)) throw e;
    const details = e.statusDisagreement ? { home: observation.home, statusDisagreement: e.statusDisagreement } : undefined;
    throw Object.assign(oatsError("E_WORK_PRESERVATION_FAILED", `retirement work remains at ${observation.home}; recovery could not be verified: ${e.message}`, details), details ? { details } : {});
  }
}

/** One complete recovery, for a caller with no retire hooks still to run
 *  between the snapshot and the removal. → its receipt. */
function preserveRetirementWork(observation, meta, instance) {
  return writeRetirementRecovery(observation, meta, instance, "complete").receipt;
}

/** The post-hook check on the recovery a retirement wrote before its retire
 *  hooks. Each part a hook moved (movedByHooks: the home by its bytes, the work
 *  unless it is proven unchanged) is copied again, whole and verified, under
 *  `after-hooks/`; nothing under the pre-hook `home/`, `repo/` or `work/` is
 *  written, moved or removed. The home is not copied again merely because the
 *  work is: a home whose every byte the hooks left as it was (its exact
 *  digest) is in the pre-hook snapshot as it still is.
 *  `after-hooks/` is staged inside the recovery under a dot-name and renamed
 *  into place; an `after-hooks` entry that already exists is a failure, never
 *  replaced. Then ONE atomic rewrite of recovery.json records `afterHooks` and
 *  moves `phase` to "complete" (the same rewrite, without `afterHooks`, when
 *  the hooks changed nothing). Until that rewrite the manifest says
 *  "before-hooks", so an interrupted pass under-reports and can never read as
 *  complete. A failure removes the staging, leaves the pre-hook snapshot and
 *  its manifest as they were, and refuses: the caller keeps the home.
 *  Directory mode: the retire hooks ran since the pre-hook pass verified that
 *  the recovery sits in the owned storage beside the home, so that is verified
 *  again before anything is written through its path.
 *  → the receipt, updated: `classes` and `notCopied` are the union of both
 *  passes, `bytes` covers the whole directory. */
function completeRetirementRecovery({ receipt, manifest }, before, after, meta) {
  const recovery = receipt.path;
  const moved = movedByHooks(before, after);
  const wantHome = moved.home;
  const final = join(recovery, "after-hooks");
  const manifestPath = join(recovery, "recovery.json");
  const manifestTmp = join(recovery, `.recovery.json.${process.pid}.tmp`);
  const occupied = () => { try { lstatSync(final); return true; } catch { return false; } };
  const assertOwnedStorage = () => {
    if (!after.directory) return;
    let owned = false;
    try { owned = realpathSync(recovery) === join(realpathSync(dirname(after.home)), ".oats-retirement", "recovery", basename(recovery)); } catch { /* gone: not the owned storage */ }
    if (!owned) throw new Error("directory recovery storage was redirected");
  };
  let staging, manifestStarted = false;
  try {
    assertOwnedStorage();
    // Work that is not proven unchanged is copied. So is work this recovery does
    // not hold yet: a pre-hook snapshot that was home-only stands for no work,
    // so "unchanged" proves nothing about it. When the observation after the
    // hooks is not home-only by that pass's own rule, the work is copied, moved
    // or not: a class can appear from outside the work state (the baseline is
    // gone). That rule only ever adds a copy attempt here; it never skips one.
    // It asks Git, so it is decided in here: a failure refuses like any other
    // in this pass.
    const firstWorkCopy = receipt.repoCopy?.copied === false && after.classes.length > 0 && !homeOnlyRecovery(after, meta);
    const wantWork = !after.orphanedWork && (moved.work || firstWorkCopy);
    let afterHooks;
    if (wantHome || wantWork) {
      if (occupied()) throw new Error(`${final} already exists`);
      staging = mkdtempSync(join(recovery, ".after-hooks-"));
      if (wantHome) copyRecoveryHome(after, join(staging, "home"));
      const workCopied = wantWork && copyRecoveryWork(after, meta, staging).copied;
      if (wantHome || workCopied) {
        if (occupied()) throw new Error(`${final} already exists`);
        renameSync(staging, final);
        afterHooks = { home: wantHome, work: workCopied };
      } else rmSync(staging, { recursive: true, force: true });
      staging = undefined;
    }
    const classes = [...new Set([...receipt.classes, ...after.classes])];
    const notCopied = unionNotCopied(receipt.notCopied, after.notCopied);
    const { notCopied: _before, ...rest } = manifest;
    assertOwnedStorage();
    manifestStarted = true;
    writeFileSync(manifestTmp, JSON.stringify({ ...rest, phase: "complete", classes, ...(notCopied.length ? { notCopied } : {}), ...(afterHooks ? { afterHooks } : {}) }, null, 2) + "\n", { mode: 0o600 });
    renameSync(manifestTmp, manifestPath);
    const { notCopied: _was, ...kept } = receipt;
    return { ...kept, classes, bytes: treeBytes(recovery), ...(notCopied.length ? { notCopied } : {}), ...(afterHooks ? { afterHooks } : {}) };
  } catch (e) {
    if (staging) rmSync(staging, { recursive: true, force: true });
    if (manifestStarted) rmSync(manifestTmp, { force: true });
    if (unreadableHeads.has(e)) throw e;
    const details = e.statusDisagreement ? { home: after.home, statusDisagreement: e.statusDisagreement } : undefined;
    throw Object.assign(oatsError("E_WORK_PRESERVATION_FAILED", `retirement work remains at ${after.home}; recovery could not be verified: ${e.message}`, details), details ? { details } : {});
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
    // A confirmed plan's extra trees go with the intent, so the completion is bound by them as well.
    options: { home: found.home, ...(o.keepDir ? { keepDir: true } : {}), tmuxSession: session, ...(Array.isArray(o.plannedExtraWorktrees) ? { plannedExtraWorktrees: o.plannedExtraWorktrees } : {}) }, resultPath,
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
/** The item a quarantine retry reports while the branch its failed spawn created is still there. It
 *  names no branch: the name is the receipt's `retention.recordedBranch`, or the retained home's
 *  instance.json `branch`. */
export const FAILED_SPAWN_BRANCH_LEFT = "the branch the failed spawn created is left: OATS does not delete it. Inspect it and delete it with Git if it is not wanted, then retry";
const OBSOLETE_DELETE_BRANCH_SENTENCE = "this self-retire was requested with --delete-branch by an older OATS; retirement no longer deletes branches, so the branch and the worktree were left";
/** The one internal option that says the retirement completes such an intent.
 *  A symbol, so no caller can set it from parsed arguments or JSON. */
const OBSOLETE_DELETE_BRANCH = Symbol("an older self-retire intent with --delete-branch");
export const RETIRE_DELETE_BRANCH_REFUSED = "oats retire no longer deletes branches: --delete-branch is not accepted. Retire without it; the branch is left in the repository. Inspect it there and delete it with Git if it is no longer wanted.";

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
  // An intent an older OATS recorded for `--self --delete-branch`. The
  // retirement it owes is completed; the obsolete option authorizes nothing:
  // the branch and the worktree are left, and the retire says so.
  const obsoleteDeleteBranch = intent.options?.deleteBranch === true;
  const delayMs = Math.max(0, Number(opts.delaySec ?? intent.delaySec ?? 8) * 1000);
  if (delayMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
  let result;
  try {
    result = retireInstance(intent.root, intent.instance, {
      home: intent.options?.home, keepDir: !!intent.options?.keepDir, tmuxSession: intent.options?.tmuxSession,
      ...(Array.isArray(intent.options?.plannedExtraWorktrees) ? { plannedExtraWorktrees: intent.options.plannedExtraWorktrees } : {}),
      ...(obsoleteDeleteBranch ? { [OBSOLETE_DELETE_BRANCH]: true } : {}),
    });
  } catch (e) {
    record({ ok: false, error: { code: e.code, message: e.message }, ...(obsoleteDeleteBranch ? { warnings: [OBSOLETE_DELETE_BRANCH_SENTENCE] } : {}), retry: `oats retire ${intent.instance}${intent.options?.home ? ` --home ${intent.options.home}` : ""}` });
    console.error(`deferred retirement of ${intent.instance} failed: ${e.message}`);
    return false;
  }
  if (obsoleteDeleteBranch) console.log(OBSOLETE_DELETE_BRANCH_SENTENCE);
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
  if (o.deleteBranch) throw oatsError("E_BAD_ARGS", RETIRE_DELETE_BRANCH_REFUSED);
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
  // A home opened in Herdr (removed in 0.31.0) has no endpoint OATS can quiesce in-process. A
  // quarantined home's cleanup descriptor overrides the live record's endpoint: either may name it.
  const herdrHome = recordsHerdr(meta, readJsonOrUndefined(retirementBaselinePath(found.home))) || recordsHerdr(liveMeta);
  if (self && (!o.keepDir || herdrHome)) {
    return scheduleDeferredSelfRetirement(root, found, name, o, session);
  }
  // A worktree directory whose git admin entry is gone cannot be inspected, moved or removed through git, and
  // what it holds may exist nowhere else: it is never removed. Without --force the hooks still run and it is
  // an incomplete item; --force (which removes the home it sits in) refuses before anything runs.
  const orphanedWork = meta.work === "worktree" && existsSync(workPath) && worktreeAdminMissing(workPath);
  if (orphanedWork && o.force) {
    throw oatsError("E_WORK_PRESERVATION_FAILED", `${name}: the work directory ${workPath} has no git admin entry in ${meta.repo ?? "its repository"}, so retiring the home would delete it with whatever it holds; move it out or delete it by hand, then retire again; nothing was run or removed`);
  }
  const orphanItem = orphanedWork ? `git worktree ${workPath}: its admin entry is missing; the directory is kept — move it out or delete it by hand, then retire again` : null;
  const inspectableWorktree = isWorktree && !orphanedWork;
  // First inspection is non-destructive. Only after it succeeds may OATS quiesce
  // the managed harness; recovery copying never races a live managed Pi.
  const owesWorktree = !!quarantine && (quarantine.cleanup.outstanding?.git || []).includes("worktree");
  const recordedBranch = quarantine ? { repo: meta.repo, branch: meta.branch } : undefined;
  // Whether this retire removes the worktree, when it gets to that step.
  const worktreeRemoval = { removes: !!(o.discardWorktree || owesWorktree), repo: meta.repo };
  const initialObservation = inspectRetirementWork(found.home, workPath, inspectableWorktree, { recordedBranch, worktreeRemoval, directory, orphanedWork });
  // A locked extra tree is known from the home as it is now: Git will neither move nor remove it, so a retire that
  // would remove the home refuses here, before the session is stopped and before any retire hook runs (the hooks
  // revoke identities a kept home would still need). The extra-tree step keeps its own check, for a lock that appears
  // during the hooks. --force does not bypass it: it covers hook debt, not local work.
  if (!o.keepDir) {
    const locked = initialObservation.extraTrees.filter((t) => t.locked !== undefined);
    if (locked.length) {
      throw oatsError("E_WORK_PRESERVATION_FAILED", `${name}: ${locked.map((t) => `the extra worktree ${t.path} is locked${t.locked ? ` (${t.locked})` : ""}`).join("; ")}; Git will neither move nor remove a locked worktree. Unlock it with \`git worktree unlock\`, or move it out of the home, then retire again; nothing was run or removed`);
    }
  }
  // Harness identity is destructive authority. The mutable child metadata may
  // describe it for humans, but only the independent baseline can authorize the
  // endpoint that proves quiescence.
  let runtimeAuthority;
  if (herdrHome) {
    // Nothing to quiesce without Herdr: the retirement goes on only when no process works in the
    // home, exactly as for a session observed absent.
    const scan = processesInHome(found.home);
    if (!scan.ok) throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `cannot retire ${name}: it was opened in Herdr (${HERDR_REMOVED}), and whether a process still works in its home could not be established (${scan.error}); nothing was removed`);
    if (scan.processes.length) throw herdrInstanceBusy(name, scan.processes.map((p) => p.pid));
  } else if (liveMeta || quarantine) {
    runtimeAuthority = initialObservation.runtimeAuthority;
    // A home without its receipt (spawned before 0.25.9) has nothing OATS may
    // quiesce; when its session is observably absent, quiescing is vacuous and
    // the retirement goes on (hooks, work preservation). Live or ambiguous
    // still refuses, --force included: a harness is never left running under
    // a removed home.
    const unowned = runtimeAuthority ? null : observeSessionWithoutReceipt(found.home, meta);
    if (unowned && !unowned.absent) {
      throw oatsError("E_RUNTIME_ENDPOINT_UNKNOWN", `cannot quiesce ${name}: independent runtime endpoint authority is missing or invalid, and its session is not observably absent (${unowned.note}); stop that session yourself, then retire again`);
    }
  }
  if (runtimeAuthority) {
    const metaAgrees = meta.launched === runtimeAuthority.launched && (!runtimeAuthority.launched || tmuxEndpointAgrees(meta, runtimeAuthority));
    if (!metaAgrees) {
      throw oatsError("E_RUNTIME_AUTHORITY_MISMATCH", `cannot quiesce ${name}: mutable instance metadata disagrees with independent runtime endpoint authority`);
    }
  }
  // `=` forces exact matching: tmux targets otherwise PREFIX-match window names.
  // A no-launch instance is already quiesced. A launched one must have exact
  // window absence established before recovery copying begins.
  let sessionStopped = false;
  if (!self && runtimeAuthority?.launched) {
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
      const unestablished = (why) => oatsError("E_RUNTIME_QUIESCE_FAILED", `could not establish that ${runtimeSession}:${runtimeWindow} stopped on ${runtimeSocket}: ${why}`);
      if (!/no server running|failed to connect|can't find session|no sessions/i.test(detail)) {
        if (!tmuxServerLost(e)) throw unestablished(detail || "tmux inspection failed");
        // A server that cannot be reached, typically because its socket file is missing (a reboot clears
        // tmux's socket directory). A server outlives its socket file, so that alone does not say the
        // window is gone: it is taken as gone only when no process works in the home, as for a home
        // without its receipt.
        const scan = processesInHome(found.home);
        if (!scan.ok) throw unestablished(`${detail}; whether a process still works in this home could not be established (${scan.error})`);
        if (scan.processes.length) throw unestablished(`${detail}; a process still works in this home (${scan.processes.slice(0, 5).map((p) => `pid ${p.pid} ${p.command}`).join(", ")}${scan.processes.length > 5 ? `, and ${scan.processes.length - 5} more` : ""})`);
      }
    }
    sessionStopped = true;
  }
  const stableObservation = inspectRetirementWork(found.home, workPath, inspectableWorktree, { recordedBranch, worktreeRemoval, directory, orphanedWork });
  // The bytes of the worktree as they are before the hooks: after the hooks,
  // "the work did not move" is then proven, never taken from a status text.
  // Read before the recovery is written, so that a worktree that cannot be
  // read (an entry that is not a file, a directory or a symbolic link)
  // refuses here and leaves no recovery behind, however often it is retried.
  // The refusal says what this retire has and has not done by now: a launched
  // instance's session was stopped above. A pre-hook copy of the work
  // verifies itself against this same read. A worktree that cannot be proven
  // unchanged is copied again in any case, and with nothing to preserve
  // before the hooks there is nothing to prove: any class after them is
  // preserved.
  // What a refusal before the hooks tells the operator about the retire so far.
  const soFar = (kept) => `${name} is not retired and ${kept}; ${sessionStopped ? "its session has been stopped" : "this retire stopped no session"}`;
  if (stableObservation.classes.length && stableObservation.workProvable) {
    try { observedWorkBytes(stableObservation); }
    catch (e) {
      throw oatsError(e.code, `${e.message}. No recovery was written and nothing was deleted: ${soFar("its home is kept")}`);
    }
  }
  // One recovery per retirement. The snapshot taken here, before the retire
  // hooks, is the gate: it is verified before any hook runs and is never
  // rewritten. What the hooks change is added to it afterwards. A copy that
  // cannot be made or verified refuses here, with the same disclosure.
  let preHookRecovery;
  if (stableObservation.classes.length) {
    try { preHookRecovery = writeRetirementRecovery(stableObservation, meta, name, "before-hooks"); }
    catch (e) {
      if (e?.code !== "E_WORK_PRESERVATION_FAILED") throw e;
      throw Object.assign(oatsError(e.code, `${e.message}. No retire hook has run, no recovery was written and nothing was deleted: ${soFar("its home and work are kept")}`, e.provenance), e.details ? { details: e.details } : {});
    }
  }
  let workRecovery = preHookRecovery?.receipt;

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
    if (orphanItem) ordinaryIncomplete.push(orphanItem);
  }
  // A quarantine retry's outcome apart from Git: what the hooks it reran left undone, and what they owed and
  // did not run. Known before the worktree step, which waits for it.
  const retryFailures = [];
  if (quarantine) {
    for (const f of hookResults?.failures || []) retryFailures.push(`retire hook ${f.capability}: ${f.message}`);
    for (const [capId, m] of Object.entries(hookResults?.meta || {})) {
      if (m && typeof m === "object" && m.retired === false && m.reason !== "nothing-to-delete") {
        retryFailures.push(`retire hook ${capId}: reported incomplete cleanup${m.reason ? ` (${m.reason})` : ""}`);
      }
    }
    // The decisive check: not "did anything fail" but "did the work that was
    // outstanding actually happen". A retry that resolves zero capabilities —
    // because the descriptor named none, or config drifted since the spawn —
    // otherwise reports a clean sweep it never performed, and the home and its
    // credential go with it (reviewer-dd03a98).
    const ran = new Set(hookResults?.order || []);
    for (const capId of quarantine.cleanup.outstanding?.hooks || []) {
      if (ran.has(capId)) continue;
      const cap = (meta.capabilityRuntime || []).find((c) => c.id === capId);
      retryFailures.push(cap && !cap.hooks?.retire
        ? `${capId}: declares no retire hook, so OATS cannot verify or undo what its failed spawn hook may have created — clean up by hand, then remove the home with \`oats retire ${name} --force\``
        : `retire hook ${capId}: did not run on this retry, so the cleanup it owed is unverified`);
    }
    if (!hookResults) retryFailures.push("retire hooks could not be rerun (cleanup descriptor lost its context repo)");
    if (orphanItem) retryFailures.push(orphanItem);
  }

  // Hooks are allowed to mutate the inspected tree, so inspect again after
  // them. A recovery written before the hooks gains a separately verified
  // snapshot of each part they moved, under its after-hooks/, and its manifest
  // is concluded; a home that only now has something to preserve gets its one
  // recovery here. Nothing was preserved before the hooks only when there was
  // no class then, so a class now is something new to preserve, whether it
  // came from the home, from the work or from outside both (another ref, the
  // baseline): it does not have to be a move of the observed state. Either
  // way this finishes, or refuses and keeps the home, before the worktree
  // step and before the home is removed.
  const finalObservation = inspectRetirementWork(found.home, workPath, inspectableWorktree, { recordedBranch, worktreeRemoval, directory, orphanedWork });
  if (preHookRecovery) workRecovery = completeRetirementRecovery(preHookRecovery, stableObservation, finalObservation, meta);
  else if (finalObservation.classes.length) {
    workRecovery = preserveRetirementWork({ ...finalObservation, notCopied: unionNotCopied(stableObservation.notCopied, finalObservation.notCopied) }, meta, name);
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
  // recorded in the receipt. `discardWorktree` restores removal. No retire
  // deletes a branch. A failed move keeps the home (fail closed).
  // The worktree step runs only once nothing else is outstanding (awebai/oats#444): a hook that did not finish
  // may need the worktree, and its retry needs the home, the worktree and its admin entry exactly as they
  // were. --force removes the home regardless, so the step runs first and no admin entry is left dangling.
  // A failed spawn's quarantine that owes the worktree removes it; any other retire retains it unless
  // --discard-worktree. An orphaned work directory is never touched.
  const outstandingBeforeWorktree = quarantine ? retryFailures : ordinaryIncomplete;
  // The home's extra trees (awebai/oats#674), in every work mode, before the
  // work/ step so that a refusal here leaves work/ as it is. Only when the
  // home is going to be removed: not under --keep-dir, and not when it is
  // kept for a retry (the work/ step's condition). The trees are the final
  // inspection's verified set, the one its recovery left out of the home's
  // bytes. A clean tree is removed (its branch stays in its repository); any
  // other is re-homed like work/; a locked one, or one Git will not move or
  // remove, refuses and keeps the home, --force included: it covers hook
  // debt, not local work. --discard-worktree does not apply. An applied plan
  // (`plannedExtraWorktrees`) binds what is done: trees that no longer read
  // as planned refuse as stale before any of them is touched.
  let extraWorktrees;
  if (!o.keepDir && !(outstandingBeforeWorktree.length > 0 && !o.force)) {
    const rows = extraWorktreeRows(finalObservation.extraTrees, root);
    if (o.plannedExtraWorktrees && JSON.stringify(rows) !== JSON.stringify(o.plannedExtraWorktrees)) {
      throw oatsError("E_PLAN_STALE", `${name}: the home's extra worktrees changed since the retire plan was shown, so none of them was moved or removed. The retire hooks have run; the home and its work are kept. Review the fresh plan (\`oats retire ${name} --plan\`) and apply it again.`);
    }
    const refused = rows.filter((r) => r.disposition === "refuse");
    if (refused.length) {
      throw oatsError("E_WORK_PRESERVATION_FAILED", `${name}: ${refused.map((r) => `the extra worktree ${r.path}: ${r.reason}`).join("; ")}. No extra worktree was moved or removed and work/ is untouched; the retire hooks have run and the home is kept so nothing is lost.`);
    }
    extraWorktrees = [];
    const done = () => extraWorktrees.length ? ` Already done in this retire: ${extraWorktrees.map((r) => r.outcome === "removed" ? `${r.path} removed` : `${r.path} re-homed to ${r.movedTo}`).join(", ")}.` : "";
    // Each row's repository, by its Git directory: the commands run helper-free (gitRepoRun).
    const gitDirOf = new Map(finalObservation.extraTrees.map((tree) => [tree.path, tree.commonDir]));
    const git = (row, argv) => gitRepoRun(gitDirOf.get(row.path), argv);
    const failed = (row, what, e) => oatsError("E_WORK_PRESERVATION_FAILED", `${name}: the extra worktree ${row.path} ${what} (${String(e?.stderr ?? e?.message ?? e ?? "").trim()}).${done()} work/ is untouched; the retire hooks have run and the home is kept so nothing is lost — resolve and retry.`);
    for (const row of rows) {
      if (row.disposition === "remove") {
        try {
          git(row, ["worktree", "remove", row.path]);
          git(row, ["worktree", "prune"]);
          const real = realPathOrNearest(row.path);
          if (existsSync(row.path) || parseWorktreeList(git(row, ["worktree", "list", "--porcelain", "-z"])).some((r) => realPathOrNearest(r.worktree) === real)) throw new Error("it is still there after `git worktree remove`");
        } catch (e) { throw failed(row, "could not be removed, or its removal could not be verified", e); }
        extraWorktrees.push({ ...row, outcome: "removed" });
        appendEvent(found.home, { kind: "worktree-removed", data: { branch: row.branch, extra: true, path: row.path } }, { workspaceOnly: true });
      } else {
        try {
          mkdirSync(dirname(row.movedTo), { recursive: true });
          git(row, ["worktree", "move", row.path, row.movedTo]);
        } catch (e) { throw failed(row, `could not be re-homed to ${row.movedTo}`, e); }
        extraWorktrees.push({ ...row, outcome: "retained" });
        appendEvent(found.home, { kind: "worktree-retained", data: { movedTo: row.movedTo, branch: row.branch, recordedBranch: null, extra: true, path: row.path } }, { workspaceOnly: true });
      }
    }
    if (!extraWorktrees.length) extraWorktrees = undefined;
  }
  const worktreeStep = isWorktree && !!meta.repo && !orphanedWork;
  const worktreeDeferred = worktreeStep && existsSync(workPath) && outstandingBeforeWorktree.length > 0 && !o.force;
  const keptForRetry = worktreeDeferred ? `git worktree ${workPath}: kept for the retry; outstanding: ${outstandingBeforeWorktree.join("; ")}` : null;
  let retention = null;
  if (worktreeStep && !worktreeDeferred) {
    // A HEAD that cannot be read here is recorded as no branch and no commit, and the worktree is retained.
    const ref = existsSync(workPath) ? (() => { try { return worktreeHead(workPath); } catch { return { branch: null, commit: null }; } })() : { branch: meta.branch ?? null, commit: null };
    const verifiedBranch = ref.branch;
    // --discard-worktree, or a quarantine that owes the worktree, removes it. Plain retire retains.
    if (worktreeRemoval.removes) {
      // HEAD as it is now against HEAD as the final inspection read it: a
      // worktree whose HEAD moved since is not removed, and nothing else is
      // done. Whatever moved it may have made a commit only it reaches.
      if (existsSync(workPath)) {
        let now;
        try { now = worktreeHead(workPath); }
        catch (e) { throw oatsError("E_WORK_INSPECTION_FAILED", `${e.message}. The worktree was not removed. The home and the worktree are kept, and so is any recovery the retire wrote; retry the retire.`); }
        assertSameWorktreeHead(finalObservation.head, now);
      }
      shTry(`git -C ${shq(meta.repo)} worktree remove --force ${shq(workPath)}`);
      shTry(`git -C ${shq(meta.repo)} worktree prune`);
      retention = { worktree: "removed", branch: verifiedBranch, recordedBranch: meta.branch ?? null };
    } else if (existsSync(workPath)) {
      const dest = retainedWorktreeDest(workspaceOf(root), meta.repo, verifiedBranch, ref.commit);
      mkdirSync(dirname(dest), { recursive: true });
      try {
        execFileSync("git", ["-C", meta.repo, "worktree", "move", workPath, dest], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_MAX_BUFFER });
      } catch (e) {
        throw oatsError("E_WORK_PRESERVATION_FAILED", `${name}: the worktree at ${workPath} could not be re-homed to ${dest} (${String(e.stderr ?? e.message ?? "").trim()}); the home is kept so nothing is lost — resolve and retry, or pass --discard-worktree to remove the worktree instead`);
      }
      retention = { worktree: "retained", movedTo: dest, branch: verifiedBranch, detachedAt: verifiedBranch === null ? ref.commit : null, recordedBranch: meta.branch ?? null };
    } else retention = { worktree: "absent", branch: verifiedBranch, recordedBranch: meta.branch ?? null };
  }
  if (retention) {
    if (retention.worktree === "retained") appendEvent(found.home, { kind: "worktree-retained", data: { movedTo: retention.movedTo, branch: retention.branch, recordedBranch: retention.recordedBranch } }, { workspaceOnly: true });
    else if (retention.worktree === "removed") appendEvent(found.home, { kind: "worktree-removed", data: { branch: retention.branch } }, { workspaceOnly: true });
  }
  // `hooks`: which retire hooks ran (in order) and how each ended — the same
  // receipt `spawned` carries, so the workspace log shows both halves of a
  // capability's lifecycle after the home is gone.
  const retireHookReceipt = (() => { const res = hookResults || {}; const failedBy = new Map((res.failures || []).map((f) => [f.capability, f])); return (res.order || []).map((id) => ({ capability: id, ok: !failedBy.has(id), meta: Object.hasOwn(res.meta || {}, id) })); })();
  appendEvent(found.home, { kind: "retired", data: { agent: found.agent.name, keepDir: !!o.keepDir, self, quarantine: !!quarantine, workRecovery: workRecovery?.path ?? null, hooks: retireHookReceipt, ...(o[OBSOLETE_DELETE_BRANCH] ? { reason: OBSOLETE_DELETE_BRANCH_SENTENCE } : {}) } }, { workspaceOnly: true });
  // Retrying a quarantine only clears it if compensation ACTUALLY completed.
  // Otherwise the home — and the credentials in it — must survive again, or the
  // retry becomes the deletion the quarantine was preventing.
  let stillIncomplete;
  // Ordinary path: quarantine instead of deleting, using the SAME writer the
  // spawn rollback uses. Two copies of this logic is how a previous divergence
  // happened (see quarantineInstanceHome), so there is still exactly one.
  if (!quarantine && !self && ordinaryIncomplete.length) {
    if (keptForRetry) ordinaryIncomplete.push(keptForRetry);
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
      orphanedWork: !!orphanedWork,
      reason: outstandingHooks.size ? "retire hook reported incomplete cleanup" : "the work directory has no git admin entry",
    });
    stillIncomplete = ordinaryIncomplete;
  }
  if (quarantine) {
    const failures = [...retryFailures];
    if (keptForRetry) failures.push(keptForRetry);
    // The quarantine may exist BECAUSE Git cleanup failed, so a retry has to
    // redo those steps and verify them — not just rerun hooks. No retire deletes a branch.
    if (meta.work === "worktree" && meta.repo) {
      const gitProbe = (argv) => {
        try { return { ok: true, out: execFileSync(argv[0], argv.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
        catch (e2) { return { ok: false, status: e2.status, err: String(e2.stderr ?? e2.message ?? "").trim() }; }
      };
      // A worktree this retry removed (the step above ran) must be verified gone; one it retained or kept for
      // the next retry stays registered by design. The removal is not attempted a second time here: only the
      // worktree step removes, after its check of HEAD, so a worktree it failed to remove is still registered
      // and the next retry goes through that step again.
      if (retention?.worktree === "removed") {
        const wtCanonical = realPathOrNearest(workPath);
        gitProbe(["git", "-C", meta.repo, "worktree", "prune"]);
        const wtProbe = gitProbe(["git", "-C", meta.repo, "worktree", "list", "--porcelain", "-z"]);
        if (!wtProbe.ok) failures.push(`git worktree ${wtCanonical}: could not verify removal (${wtProbe.err || "worktree list failed"})`);
        else {
          const registered = wtProbe.out.split("\0").filter((f) => f.startsWith("worktree ")).map((f) => f.slice("worktree ".length));
          if (registered.includes(wtCanonical)) failures.push(`git worktree ${wtCanonical}: still registered`);
        }
      }
      // The branch is a debt only when the failed spawn's rollback still owes its deletion. A retry never
      // deletes it: the debt is cleared only when the branch is shown to be gone. Git's quiet exit 1 is
      // "gone"; any other answer, or any text on standard error (a damaged ref file warns there), is
      // "could not verify", and the debt stays. The text is never matched: this read can only err
      // toward keeping the debt.
      const owesBranch = (quarantine.cleanup.outstanding?.git || []).includes("branch");
      if (owesBranch && meta.branch) {
        const br = spawnSync("git", ["-C", meta.repo, "rev-parse", "--verify", "--quiet", `refs/heads/${meta.branch}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        if (!br.error && br.status === 0) failures.push(FAILED_SPAWN_BRANCH_LEFT);
        else if (br.error || br.status !== 1 || br.stderr.length) failures.push(`git branch ${meta.branch}: could not verify whether it still exists (${String(br.stderr ?? "").trim() || br.error?.message || `rev-parse exit ${br.status}`})`);
      }
    }
    // Git debt is proven by the verification block above, which only runs for a
    // worktree in a known repo. If it could not run, the debt stands.
    if (quarantine.cleanup.outstanding?.git?.length && !(meta.work === "worktree" && meta.repo)) {
      failures.push(`git ${quarantine.cleanup.outstanding.git.join(", ")}: not re-verified on this retry, so the cleanup they owed is unverified`);
    }
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

  const result = { retired: name, agent: found.agent.name, workRecovery, retention, extraWorktrees, worktreeRemoved: isWorktree && !!retention && retention.worktree !== "retained", branchDeleted: false, removedDir: !o.keepDir && (!stillIncomplete || forced), rollbackIncomplete: forced ? undefined : stillIncomplete, forcedIncomplete: forced ? stillIncomplete : undefined, retainedHome: stillIncomplete && !forced ? found.home : undefined, relinked: relinked.length ? relinked : undefined, capabilityMeta: hookResults?.meta, warnings: (() => {
    const w = [...(hookResults?.warnings || [])];
    if (o[OBSOLETE_DELETE_BRANCH]) w.push(OBSOLETE_DELETE_BRANCH_SENTENCE);
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
    // The window the home RECORDED (a pre-0.31 home lives in pi-agents), never the default for new ones.
    const killSession = runtimeAuthority?.tmux?.session || meta?.tmux?.session || session;
    const killWindow = runtimeAuthority?.tmux?.window || meta?.tmux?.window || name;
    // On the socket the receipt (else instance.json) records, both the scheduling and the kill; a home
    // that records none keeps the ambient server. run-shell expands its command as a format: a
    // literal # in the socket path is written ##.
    const killSocket = runtimeAuthority?.tmux?.socket || meta?.tmux?.socket;
    const killTarget = shq(`=${killSession}:=${killWindow}`);
    if (typeof killSocket === "string" && killSocket) {
      const kill = `sleep ${o.selfKillDelaySec ?? 8}; tmux -u -S ${shq(killSocket)} kill-window -t ${killTarget} 2>/dev/null || true`;
      shTry(`tmux -u -S ${shq(killSocket)} run-shell -b ${shq(kill.replace(/#/g, "##"))}`);
    } else shTry(`tmux run-shell -b 'sleep ${o.selfKillDelaySec ?? 8}; tmux kill-window -t ${killTarget} 2>/dev/null || true'`);
    result.selfKillScheduled = true;
  }
  return result;
}
