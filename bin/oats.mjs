#!/usr/bin/env node
/**
 * oats — the OATS command line.
 *
 *   oats doctor [dir] [--soul <s>] [--json] show the deployment; --soul: the instructions an instance of <s> would carry
 *   oats onboard [<dir>] --workspace <ref>  realize a workspace here (oats-local.yaml +
 *                                          agents/), then sync
 *   oats sync [--dir <d>] [--json]          discover the workspace, confirm membership,
 *                                          resolve packages, write the lock
 *   oats package add|remove ...            edit `packages:` in the workspace file
 *   oats workspace status                  membership table, packages
 *   oats capabilities | oats souls         every visible item of the workspace
 *
 * Workspace model v2 (docs/design/2026-09-23-workspace-module-contracts.md §6):
 * nothing is installed. `oats-local.yaml` names the workspace, `oats sync`
 * observes it over Git remotes and writes `oats-lock.json` (lockfileVersion 3).
 * `init` / `use` / `install` / `restore` / `list` / `catalog` / `remove` /
 * `migrate` / `trust` / `inject` are gone with the installed-capability tier.
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readSync, realpathSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeNameWarning, noteRuntimeName } from "../lib/deprecation.mjs";
import {
  LAYERS, OATS_VERSION, manifestOperations, upgradeHomeMeta,
  capabilityManifests, capabilityTrust, capabilityExecutablePath,
  officialPackageCatalog, officialCatalogFile, officialCapabilityAliases, resolvedFromHome, resolvedFromPrepared, teamEnv, isWorkspaceHome, preWorkspaceHome, isCapturedHome, capturedHomeRefusal, composeInstanceAgentsMd, parseYamlNested, withConfigFile,
  findInstanceHome, findInstanceHomes, workspaceOf, stopInstanceSession, ensureRoot, findRoot, findAgent, findAgentAt, legacyLocalAgents, legacyCapturedHomes, listAgents, listInstances, servedIdentityLine, spawnInstanceAsync, instanceSoulDir, launchConfigsAt, explicitInstanceName, findModuleCapabilityAgent, capabilityAgentFromDir, retireInstance, inspectInstanceSession, inputInstanceSession, attachInstanceSession, startInstanceSession, defaultRepo, RELATIONS, validateLaunchConfig, renderLaunchRecipe, describeLaunchCommand, redactLaunchRecipe, LAUNCH_HARNESSES, planLaunch, redactLaunchCommand, restartInstanceSession,
} from "../lib/core.mjs";
import {
  writeFileAtomic, LOCK_FILE, readLock, writeLock, resolvePackages,
  classifyPackageValue, parsePackageRequest } from "../lib/packages.mjs";
import { loadLocal, validateWorkspace, validateLocal, discoverPackageSouls, workspaceWarnings } from "../lib/workspace.mjs";
import { parseConfigData } from "../lib/config-data.mjs";
import * as remoteModule from "../lib/remote.mjs";
import YAML from "yaml";
import { attachArgv, checkRemote, forgetSnapshot, getServer, inspectRemote, startRemote, restartRemote, launchConfigRemote, scheduleRemote, listSnapshots, readServers, rosterGroups, routeCommand, targetOf, validateServer, writeServers, SERVERS_FILE } from "../lib/servers.mjs";
import { spawnSync as spawnSyncProc } from "node:child_process";
import { tickTriggers } from "../lib/triggers.mjs";
import { parseEnvelopeText, scheduleScopeOf, listSchedules, describe as describeSchedule, addSchedule, updateSchedule, setEnabled as setScheduleEnabled, removeSchedule, runNow as runScheduleNow, reconcile as reconcileSchedule, tickHost, tickWorkspace, registerWorkspace, unregisterWorkspace, readRegistry, schedulerStatus, saveWakeForHome, removeWakeForHome, wakeFromFlags, withHostLock, scheduleError, SCHEDULE_API } from "../lib/schedule.mjs";
import { hostUnitStatus, installHostUnit, uninstallHostUnit } from "../lib/schedule-host.mjs";
import { receiveAttachment, uploadAttachment, readStreamBounded, MAX_ATTACHMENT_BYTES } from "../lib/attachments.mjs";

import { observeInstanceGit, diffInstanceFile } from "../lib/instance-git.mjs";
import { planStop, applyStop, planRetire, resolveInstance as resolveInstanceForCli } from "../lib/instance-lifecycle.mjs";
const await_import_lifecycle = () => ({ resolveInstance: resolveInstanceForCli });
import { homeTarget, soulTarget, isWorkspaceContext, inspectDocument, readinessDocument, policyOf, policySoul, manifestMissingRequires, INSPECT_OPERATIONS_API } from "../lib/instance-inspect.mjs";
import { readEvents } from "../lib/instance-events.mjs";

const rawArgs = process.argv.slice(2);
/** The kernel's switches: a value never rides one (`--yolo=false` must not turn yolo on). */
const KERNEL_SWITCHES = new Set(["allow-child-spawns", "apply", "check", "clear", "delete-branch", "discard-worktree", "dry-run", "ephemeral", "force", "help", "host", "json", "keep-dir", "keep-env", "no-child-spawns", "no-launch", "no-recursive", "no-yolo", "plan", "policy", "preview", "print", "replace", "self", "verbose", "yes", "yolo"]);
/** `--flag=value` is `--flag value`: every kernel reader (flag(), valueFlag(), the onboard and
 *  routed-command loops) then applies the spaced form's validation to it. `problem` is an empty
 *  `--flag=` or a switch given a value. */
function expandInlineValues(argv) {
  const out = [];
  let problem;
  for (const a of argv) {
    const eq = a.indexOf("=");
    if (!a.startsWith("--") || eq <= 2) { out.push(a); continue; }
    const name = a.slice(2, eq), value = a.slice(eq + 1);
    problem ??= KERNEL_SWITCHES.has(name) ? `--${name} takes no value (got ${a})` : value === "" ? `--${name}= needs a value` : undefined;
    out.push(`--${name}`, value);
  }
  return { argv: out, problem };
}
const { argv: args, problem: argvProblem } = expandInlineValues(rawArgs);
let cmd = args[0];
const HELP_WORDS = new Set(["help", "--help", "-h"]);
const KERNEL_COMMANDS = new Set(["capture", "capabilities", "doctor", "inspect", "instance", "operation", "package", "readiness", "souls", "launch-config", "experimental", "onboard", "pane", "recall", "retire", "root", "schedule", "server", "session", "setup", "spawn", "status", "sync", "update", "version", "workspace"]);
/** Commands whose argv another parser reads (packages/record and packages/experimental parse process.argv). */
const OWN_ARGV_COMMANDS = new Set(["capture", "recall", "setup", "experimental"]);
/** Commands `--server <id>` runs on a registered server. */
const ROUTED_COMMANDS = new Set(["spawn", "retire", "status", "session", "okf", "schedule", "inspect", "operation", "launch-config"]);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : undefined;
};
function yoloFlag() {
  if (args.includes("--yolo") && args.includes("--no-yolo")) cmdFail("E_BAD_ARGS", "choose --yolo or --no-yolo, not both");
  return args.includes("--yolo") ? true : args.includes("--no-yolo") ? false : undefined;
}
function valueFlag(name) {
  const value = flag(name);
  if (value === true) cmdFail("E_BAD_ARGS", `--${name} needs a value`);
  return value;
}
const die = (msg) => { console.error(`oats: ${msg}`); process.exit(1); };
/** A command's harness: --harness, or --runtime, its pre-0.27 name (the released okf worker and
 *  a 0.26-era Desktop pass it) — read either, with the deprecation warning. Both, disagreeing,
 *  are refused. `get` reads one flag (the command's own reader where it has one). */
function harnessFlag(get = flag) {
  const harness = get("harness"), runtime = get("runtime");
  if (runtime === undefined) return harness;
  if (harness !== undefined && harness !== runtime) cmdFail("E_BAD_ARGS", `--harness ${harness} and --runtime ${runtime} disagree; --runtime is the pre-0.27 name of --harness — give one`);
  noteRuntimeName("the --runtime flag (use --harness)");
  return runtime;
}
const cmdFail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
/** Resolve the --dir flag with central validation: a value-taking flag given
 * no value (flag() → true) is E_BAD_ARGS inside the JSON boundary, never an
 * uncaught resolve(true) TypeError (reviewer-6f0a3bd). */
function dirFlag() {
  const v = flag("dir");
  if (v === undefined) return resolve(process.cwd());
  if (v === true || !String(v).trim()) {
    const msg = "--dir needs a directory path";
    if (JSON_MODE) { console.log(JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_BAD_ARGS", message: msg } })); process.exit(1); }
    die(msg);
  }
  return resolve(String(v));
}
// Desktop CLI API v1 (JSON mode): every `--json` failure is EXACTLY ONE JSON
// object on stdout — { schemaVersion: 1, ok: false, error: { code, message } } —
// with a nonzero exit; progress prose goes to stderr, never stdout.
const JSON_MODE = args.includes("--json");
// Canonical absolute path of this CLI executable — the versioned OATS_CLI_BIN
// env contract for dispatched package commands (never resolved via PATH).
const CLI_BIN = realpathSync(fileURLToPath(import.meta.url));
// The one deprecated-name warning (lib/deprecation.mjs) rides the envelope, only when there is one.
const envelopeWarnings = () => { const w = runtimeNameWarning(); if (w) warningDelivered = true; return w ? { warnings: [w] } : {}; };
let warningDelivered = false;
/** A forwarded envelope keeps the host's warnings; this command's own deprecated-name
 *  note (a `--runtime` given here) joins the host's into the one warning. */
const withLocalWarnings = (envelope) => {
  const mine = runtimeNameWarning();
  if (!mine || !envelope || typeof envelope !== "object") return envelope;
  warningDelivered = true;
  const theirs = Array.isArray(envelope.warnings) ? envelope.warnings : [];
  const same = theirs.find((w) => w?.code === mine.code);
  if (!same) return { ...envelope, warnings: [...theirs, mine] };
  const sources = [...new Set([...(Array.isArray(same.sources) ? same.sources : []), ...mine.sources])];
  return { ...envelope, warnings: theirs.map((w) => (w === same ? { ...mine, sources, message: mine.message.replace(/\(.*\)/, `(${sources.join("; ")})`) } : w)) };
};
const jsonFail = (code, message, details) => { console.log(JSON.stringify({ schemaVersion: 1, ok: false, error: { code, message: String(message), ...(details !== undefined ? { details } : {}) }, ...envelopeWarnings() })); process.exit(1); };
const jsonOk = (result) => { console.log(JSON.stringify({ schemaVersion: 1, ok: true, result, ...envelopeWarnings() })); };
// Text mode (or a JSON answer printed before the read): the warning goes to stderr, never stdout.
process.on("exit", () => { const w = runtimeNameWarning(); if (w && !warningDelivered) process.stderr.write(`oats: warning: ${w.message}\n`); });
const formatBytes = (n) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KiB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MiB` : `${(n / 1024 ** 3).toFixed(1)} GiB`;
/** A retire recovery's copied outputs (untracked/ignored or directory work), named with their size. */
function preservedOutputLines(recovery) {
  const outputs = recovery?.outputs;
  if (!outputs?.paths?.length) return [];
  const shown = outputs.paths.slice(0, 8).map((p) => `${p.path} (${formatBytes(p.bytes)})`);
  const more = outputs.paths.length > 8 ? `, and ${outputs.paths.length - 8} more` : "";
  return [`  copied outputs: ${shown.join(", ")}${more} — ${formatBytes(outputs.bytes)} in total`];
}

function shortPath(p) {
  if (!p) return p;
  const home = homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

/** Shell-safe single-quoting for copyable human commands (paths may contain spaces/metacharacters). */
function shellQuote(s) {
  return /^[A-Za-z0-9._/~-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`;
}


// ---------- doctor ----------
/** Doctor must diagnose, not crash: a stale activation of a retired
 * capability fails config resolution — surface the cleanup instruction
 * cleanly (text or JSON) instead of an uncaught stack trace. */
function operationalKnowledgeNote(composition, soulName) {
  return composition && !composition.oatsCoreDeclared
    ? `soul ${soulName} has no oats.core capability (the workspace default); it gets no OATS operating instructions` : null;
}
/** `doctor --soul`: the instructions an instance of that soul would carry. The soul
 *  is resolved over the workspace remotes exactly as a spawn preview resolves it,
 *  the kernel half composed, and the modules materialized into a scratch home
 *  OUTSIDE the deployment (removed after), so module injects are part of the text.
 *  Nothing in the deployment is written. Block files of module injects are named
 *  home-relative (`.oats/modules/<cap>/<inject>`), where an instance carries them. */
async function doctorComposition(ctx, soulName, ws, bail) {
  if (!soulName) return undefined;
  const { prepareInstance, previewWorkspaceSoul, materializePrepared, discoverOrStandalone, agentDirOf } = await import("../lib/instance-resolution.mjs");
  const deployment = dirname(ws.local.path);
  const root = join(deployment, "agents");
  const remoteOptions = remoteOptionsFromEnv();
  const cleanups = [];
  // A bail exits the process without unwinding: the temporary copies are removed at exit too.
  process.once("exit", () => { for (const c of cleanups) { try { c(); } catch { /* best effort */ } } });
  try {
    const discovery = await discoverOrStandalone(loadLocal(deployment).local, { deployment, remoteOptions });
    const prepared = await prepareInstance(deployment, soulName, { remoteOptions, discovery });
    const pv = await previewWorkspaceSoul(prepared, root);
    cleanups.push(pv.cleanup);
    const agent = findAgentAt(root, agentDirOf(prepared.soulEntry), pv.soulDir);
    if (!agent) bail("E_SOUL_UNKNOWN", `soul "${soulName}" was fetched but is not readable as a soul`);
    const composition = composeInstanceAgentsMd(pv.soulDir, deployment, agent.name, agent.work || "checkout", agent.kind, prepared);
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), "oats-doctor-home-")));
    cleanups.push(() => rmSync(scratch, { recursive: true, force: true }));
    const outcome = await materializePrepared({ ...prepared, soulAgentsMd: composition.text, soulDir: pv.soulDir }, scratch);
    const text = readFileSync(join(scratch, "AGENTS.md"), "utf8");
    const known = new Set(composition.blocks.map((b) => b.source));
    const outcomeBlocks = Array.isArray(outcome?.blocks) ? outcome.blocks : [];
    for (const m of text.matchAll(/^<!-- oats:(capability:[^\s]+) src=(.+?) -->$/gm)) {
      const [, source, file] = m;
      if (known.has(source)) continue;
      known.add(source);
      const content = outcomeBlocks.find((b) => b.source === source && b.file === file)?.content ?? (existsSync(file) ? readFileSync(file, "utf8").trim() : "");
      const rel = file.startsWith(scratch + sep) ? file.slice(scratch.length + 1) : file;
      composition.blocks.push({ source, file: rel, content, materialized: true });
    }
    return { ...composition, text };
  } catch (e) {
    if (e?.code?.startsWith?.("E_")) bail(e.code, e.message, e.details);
    throw e;
  } finally { for (const c of cleanups) { try { c(); } catch { /* best effort: temporary copies only */ } } }
}

/** Workspace-model v2 doctor data, OFFLINE: the deployment declaration found
 * walking up from ctx (oats-local.yaml) and the lock v3 beside it. Doctor never
 * goes to the network for this view (only `--soul`, which resolves the soul like a
 * spawn preview); membership and discovery are `oats sync` / `oats workspace status`. */
function doctorLockData(ctx) {
  const out = { local: null, localError: null, lockFile: null, packages: [], lockError: null };
  let lockDir = ctx;
  try {
    const found = loadLocal(ctx);
    out.local = { path: found.path, workspace: found.local.workspace };
    lockDir = dirname(found.path);
  } catch (e) {
    // An unreadable oats-local.yaml, or a 0.25 oats-config.yaml inside the deployment
    // (E_CONFIG_BROKEN reason legacy-config): doctor answers it as its typed error.
    if (e?.code === "E_WORKSPACE_SCHEMA" || e?.code === "E_CONFIG_BROKEN") out.localError = { code: e.code, message: e.message, details: e.details };
    else if (e?.code !== "E_LOCAL_MISSING") throw e;
  }
  const file = join(lockDir, LOCK_FILE);
  if (!existsSync(file)) return out;
  out.lockFile = file;
  try {
    const lock = readLock(lockDir);
    out.packages = Object.entries(lock.packages).map(([id, p]) => ({ id, version: p.version, source: p.source, path: p.path, commit: p.commit, integrity: p.integrity, capabilities: p.capabilities }));
  } catch (e) {
    if (e?.code !== "E_LOCK_SCHEMA") throw e;
    out.lockError = { code: e.code, message: e.message, file: e.details?.file ?? file };
  }
  return out;
}

// ---------- inspect: one authoritative answer for GUIs ----------
/** Souls, capabilities (installed state and health, separately from
 *  activation), effective layer bindings and declared operations for a
 *  scope, a selected soul, or a running home's snapshot. Read-only; the
 *  integrity scan runs only when asked (a GUI calls this on Refresh, never
 *  from its roster poll). Nothing here is provider-specific: what a
 *  knowledge provider offers is what its manifest declares. */
const INSPECT_TEXT_CAP = 256 * 1024;
/** The agents root a home belongs to, from its path alone:
 *  <root>/<agent>/instances/<instance>. */
function agentsRootOfHome(home) { return dirname(dirname(dirname(home))); }
const SOUL_FIELDS = ["harness", "model", "yolo", "backend", "description", "launch-config"];
const realOrResolved = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
/** Every soul of a scope: the persistent souls of every agents root in
 *  scope, plus packaged souls (read-only). One enumeration for inspect and
 *  operation run, so both address souls the same way. */
function scopeSouls(ctx, { extraRoots = [] } = {}) {
  // A home's own agents root is always in scope for that home: its recorded
  // work repository may be another repository entirely (repo overrides), and
  // the config context resolves there while the soul lives with its owner.
  const roots = [...new Set([findRoot(ctx), ...extraRoots].filter(Boolean).map((p) => realOrResolved(resolve(p))))];
  const souls = [];
  for (const root of roots) {
    for (const a of listInstances(root)) {
      const soul = findAgent(root, a.name) || a;
      const e = soulEntry(soul, root);
      e.instances = (a.instances || []).map((i) => i.instance);
      souls.push(e);
    }
  }
  return { roots, souls, diagnostics: [] };
}
/** The one soul a name (and optional agents root) addresses; throws with a
 *  code when none or several match. */
function selectSoul(souls, name, agentsRoot, ctx) {
  let matches = souls.filter((s) => s.name === name);
  if (agentsRoot) matches = matches.filter((s) => realOrResolved(s.agentsRoot) === realOrResolved(agentsRoot));
  if (!matches.length) throw Object.assign(new Error(`no soul ${JSON.stringify(name)} in the scope of ${ctx}${agentsRoot ? ` under ${agentsRoot}` : ""}`), { code: "E_SOUL_UNKNOWN" });
  // Same-named souls under several member roots: the member the caller
  // addressed with --dir breaks the tie; a team root or an unrelated
  // directory does not, and the answer names --agents-root as the remedy.
  if (matches.length > 1) {
    const here = realOrResolved(ctx);
    const own = matches.filter((s) => s.kind !== "capability" && realOrResolved(dirname(s.agentsRoot)) === here);
    if (own.length === 1) return own[0];
    throw Object.assign(new Error(`soul ${JSON.stringify(name)} exists under ${matches.length} agents roots (${matches.map((m) => m.agentsRoot).join(", ")}); pass --agents-root <abs>`), { code: "E_SOUL_AMBIGUOUS" });
  }
  return matches[0];
}
/** The config context a selected soul belongs to: the workspace of its
 *  agents root (a member repository under a team scope). An explicit --dir
 *  may be that context or a scope enclosing it (the team root); another
 *  member's context contradicts the selection and is refused. */
function memberContextOf(soul, ctx, explicitDir, bail) {
  if (soul.kind === "capability") return realOrResolved(ctx);
  const member = realOrResolved(dirname(soul.agentsRoot));
  const given = realOrResolved(ctx);
  if (member === given) return member;
  if (explicitDir && !member.startsWith(given + sep)) bail("E_SCOPE_MISMATCH", `--dir ${ctx} is not the scope of soul ${soul.name} under ${soul.agentsRoot} (${member}); pass that member's directory, an enclosing team scope, or omit --dir`);
  return member;
}
/** A home's context for --dir validation: its recorded repository, or the
 *  workspace that holds its agents root (what a roster derives). */
function homeContexts(home, meta) {
  const out = [];
  if (meta.repo && existsSync(meta.repo)) out.push(resolve(meta.repo));
  out.push(dirname(agentsRootOfHome(realOrResolved(home))));
  return out;
}
/** A soul's own declared requirements/defaults/provenance, read from its
 *  soul.yaml through the kernel's parser (never guessed, never re-parsed by a
 *  consumer). Absent sections are null: an unrecorded provenance is a fact
 *  about the soul, not a prompt to infer one. */
function soulDeclarations(soulDir) {
  const file = join(soulDir, "soul.yaml");
  const empty = { declarations: { requires: null, defaults: null, knowledge: null, teams: null, resources: null, children: null }, provenance: null, problems: [] };
  if (!existsSync(file)) return empty;
  let parsed;
  try { parsed = withConfigFile(file, () => parseYamlNested(readFileSync(file, "utf8"))); }
  catch (e) { return { ...empty, problems: [{ code: "soul-declarations-unreadable", message: e.message }] }; }
  const section = (key) => (parsed[key] !== undefined && parsed[key] !== null && typeof parsed[key] === "object") ? parsed[key] : (parsed[key] === undefined ? null : parsed[key]);
  const provenance = section("provenance");
  return {
    declarations: { requires: section("requires"), defaults: section("defaults"), knowledge: section("knowledge"), teams: section("teams"), resources: section("resources"), children: section("children") },
    provenance: provenance && typeof provenance === "object" ? {
      kind: provenance.kind ?? null, source: provenance.source ?? null, revision: provenance.revision ?? null,
      path: provenance.path ?? null, workspaceRevision: provenance.workspaceRevision ?? null,
    } : null,
    problems: [],
  };
}
function soulEntry(soul, root, { capability } = {}) {
  const dir = soul._dir || soul.soulDir;
  const soulDir = capability ? soul.soulDir : join(dir, "soul");
  const packaged = !!capability;
  const declared = soulDeclarations(soulDir);
  return {
    soulsApi: 1, declarations: declared.declarations, provenance: declared.provenance,
    declarationProblems: declared.problems,
    name: soul.name, kind: packaged ? "capability" : (soul.kind || "persistent"), capability: capability || null,
    type: soul.type ?? null, description: soul.description ?? null, repo: soul.repo ?? null, work: soul.work || "checkout",
    harness: soul.harness || "pi", model: soul.model ?? null, yolo: soul.yolo === true || soul.yolo === "true" ? true : soul.yolo === false || soul.yolo === "false" ? false : null, launchConfig: soul["launch-config"] ?? null, backend: soul.backend ?? null,
    agentsRoot: root, dir: packaged ? soulDir : dir, soulFile: join(soulDir, "soul.yaml"), instructionsFile: join(soulDir, "AGENTS.md"),
    editable: packaged
      ? { fields: [], instructions: false, reason: `packaged soul from capability ${capability}: edit the package and update it; scoped bindings still apply through oats use` }
      : { fields: [...SOUL_FIELDS], instructions: true, reason: null },
    instances: [],
  };
}
/** These commands address a scope explicitly (--dir, --home, cwd); the
 *  invoking process's ambient agents-root override must not redirect them
 *  to its own deployment. */
function dropAmbientRoot() { delete process.env.PI_AGENTS_ROOT; }
async function inspectCmd() {
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  const t = await workspaceTarget(bail, { command: "inspect" });
  if (t) {
    if (t.resolutionError) return bail(t.resolutionError.code, t.resolutionError.message, t.resolutionError.details ?? undefined);
    const doc = inspectDocument(t, { kernel: OATS_VERSION });
    if (JSON_MODE) { jsonOk(doc); return; }
    printWorkspaceInspect(doc); return;
  }
}
/** The workspace-model target of inspect / readiness / operation run (lead
 *  decision 4): an instance home with materialized modules (`--home`), or a soul
 *  of a workspace deployment (`--soul`, resolved as its spawn would be). Anything
 *  else is a typed refusal: there is no classic scope answer. */
async function workspaceTarget(bail, { command, liveTeams = true }) {
  dropAmbientRoot();
  const homeFlag = flag("home"), soulFlag = flag("soul"), rootFlag = flag("agents-root");
  if (homeFlag === true) return bail("E_BAD_ARGS", "--home needs an absolute instance home");
  if (soulFlag === true) return bail("E_BAD_ARGS", "--soul needs a soul name");
  if (rootFlag === true) return bail("E_BAD_ARGS", "--agents-root needs an absolute agents directory");
  const remoteOptions = remoteOptionsFromEnv();
  if (homeFlag) {
    if (!isAbsolute(homeFlag)) return bail("E_BAD_ARGS", "--home needs an absolute instance home");
    let meta = null;
    try { meta = JSON.parse(readFileSync(join(homeFlag, "instance.json"), "utf8")); } catch (e) { return bail("E_SESSION_UNKNOWN", `${homeFlag} is not an OATS instance home (${e.code === "ENOENT" ? "no instance.json" : e.message})`); }
    if (isCapturedHome(meta)) { const e = capturedHomeRefusal(homeFlag, "nothing was read"); return bail(e.code, e.message, e.details); }
    if (!meta || typeof meta.modules !== "object" || meta.modules === null) return bail("E_UNSUPPORTED_MODE", `${homeFlag} is not a workspace-model home (it records no modules): it was spawned by an earlier kernel — re-spawn it from the deployment`);
    if (soulFlag && soulFlag !== meta.agent) return bail("E_HOME_MISMATCH", `--soul ${soulFlag} is not the soul of ${homeFlag} (${meta.agent})`);
    const deployment = dirname(dirname(dirname(dirname(realOrResolved(homeFlag)))));
    // A v2 home lives at <deployment>/agents/<soul>/instances/<name>: its deployment is
    // derived, so it must hold oats-local.yaml EXACTLY there (never found by walking up).
    if (!existsSync(join(deployment, "oats-local.yaml"))) return bail("E_HOME_MISMATCH", `${homeFlag} is not at <deployment>/agents/<soul>/instances/<name>: ${deployment} has no oats-local.yaml`, { home: homeFlag, expected: join(deployment, "oats-local.yaml") });
    if (flag("dir") !== undefined) { let given = null; try { given = dirname(loadLocal(dirFlag()).path); } catch { given = dirFlag(); } if (realOrResolved(given) !== realOrResolved(deployment)) return bail("E_HOME_MISMATCH", `--dir ${dirFlag()} is not the deployment of ${homeFlag} (${deployment}); omit --dir for a home`); }
    if (rootFlag && realOrResolved(rootFlag) !== realOrResolved(join(deployment, "agents"))) return bail("E_HOME_MISMATCH", `--agents-root ${rootFlag} is not the agents root of ${homeFlag}`);
    return homeTarget(homeFlag, meta, { remoteOptions, discover: command === "readiness", live: liveTeams });
  }
  try { if (!isWorkspaceContext(dirFlag())) return bail("E_LOCAL_MISSING", `${command} reads a workspace deployment, and none is in reach of ${dirFlag()} (no oats-local.yaml walking up; \`oats onboard\` creates one) — or pass --home <abs> of a workspace instance`); }
  catch (e) { return bail(e?.code || "E_WORKSPACE_SCHEMA", e?.message || String(e), e?.details); }
  if (!soulFlag) return bail("E_BAD_ARGS", `${command} on a workspace deployment needs --soul <name> or --home <abs>${command === "inspect" ? " (the deployment's souls and capabilities: oats souls / oats capabilities)" : ""}`);
  const deployment = dirname(loadLocal(dirFlag()).path);
  if (rootFlag && realOrResolved(rootFlag) !== realOrResolved(join(deployment, "agents"))) return bail("E_SOUL_UNKNOWN", `soul "${soulFlag}" is not at agents root ${rootFlag} (this deployment's is ${join(deployment, "agents")})`);
  try { return await soulTarget(dirFlag(), String(soulFlag), { remoteOptions }); }
  catch (e) { if (typeof e?.code === "string" && e.code.startsWith("E_")) return bail(e.code, e.message, e.details); throw e; }
}
function printWorkspaceInspect(doc) {
  const s = doc.subject;
  console.log(`oats inspect — ${s.kind === "instance" ? `instance ${s.instance} (soul ${s.soul}) ${shortPath(s.home)}` : `soul ${s.soul} from ${s.repoKey}`}`);
  if (doc.identity) console.log(`  identity: ${servedIdentityLine(doc.identity)}`);
  for (const l of LAYERS) console.log(`  ${l} capability: ${doc.layers[l].id || "none"}`);
  for (const c of doc.capabilities) console.log(`  ${c.id}@${c.version || "?"} ${c.from?.kind === "package" ? `package ${c.from.package}` : c.from?.kind === "member" ? `member ${c.from.repoKey}` : ""}${c.operations.length ? `  ops: ${c.operations.map((o) => `${o.name}${o.available ? "" : "(unavailable)"}`).join(", ")}` : ""}`);
  for (const p of doc.problems) console.log(`  ! ${p.code}: ${p.message}`);
}

/** `{ teams, teamsSource }` for a session start of a workspace home: its eligible teams read
 *  live (two repository reads), which the launch hook re-checks joined memberships against
 *  (teams contract decision 6) — or the spawn record, marked `recorded`, when the read cannot
 *  answer. Anything that is not a readable workspace home gets nothing here — the start
 *  itself refuses it. */
async function homeLiveTeams(home) {
  let meta;
  try { meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8")); } catch { return {}; }
  if (!isWorkspaceHome(meta)) return {};
  const { liveTeams } = await import("../lib/instance-resolution.mjs");
  const { teams, source } = await liveTeams(home, meta, { remoteOptions: remoteOptionsFromEnv() });
  return Array.isArray(teams) ? { teams, teamsSource: source } : {};
}

// ---------- operation run: generic invoke through the capability engine ----------
/** `oats operation run <layer>:<name>`: resolve the provider that fills
 *  <layer> for a running home (its snapshot) or for a soul in a scope (the
 *  config), require the operation to be declared and the executable surface
 *  trusted, then run the provider's own command exactly as `oats <ns> <cmd>`
 *  would, in the home (context home) or the scope (context scope), and relay
 *  its envelope. A view operation must answer { documents: [...] }. No
 *  provider name appears here. */
const OPERATION_ADDRESS_RE = /^(knowledge|messaging|tasks):([a-z][a-z0-9-]*)$/;
/** The same phrasing the scheduler treats as retained effects. */
const reportsRetainedEffectsText = (message) => /INCOMPLETE|quarantin|retain|could not (?:be )?(?:verif|confirm)/i.test(String(message || ""));
// Comfortably below the scheduler's 5-minute command bound and any GUI
// proxy, so the receipt always reaches the caller before a wrapper gives up.
const OPERATION_TIMEOUT_MS = 4 * 60 * 1000;
function finishOperation({ r, bail, address, provider, op, argFlags, cwd, home, meta, cleanupError, intent, settlement, api }) {
  const stderr = String(r.stderr || "").trim();
  const timedOut = r.error?.code === "ETIMEDOUT" || (r.status === null && ["SIGTERM", "SIGKILL"].includes(r.signal) && (!settlement || !r.error));
  const base = { ...(api ? { operationsApi: api } : {}), operation: address, capability: provider.capability, version: provider.version || null, argv: [provider.command, op.command, ...argFlags], cwd, target: home ? { home, instance: meta.instance } : null };
  // Unconfirmed outcomes (a timeout, no valid receipt, a receipt contradicted
  // by the exit status) carry what WAS observed in error.details, so a
  // scheduler can keep the slot as unknown and reconcile by any name the
  // provider managed to answer; they are never confirmed failures.
  const observed = (envelope) => ({ exit: r.status, signal: r.signal || null, unconfirmed: true, ...(envelope && typeof envelope === "object" ? { envelope } : {}),
    ...(stderr ? { stderr: stderr.slice(0, 2000) } : {}), ...(cleanupError ? { cleanup: { code: cleanupError.code || "E_OPERATION_CLEANUP", message: String(cleanupError.message || cleanupError).slice(0, 1000) } } : {}) });
  if (r.error && !timedOut) bail("E_CAPABILITY_BROKEN", `${address}: ${r.error.message || r.error}`, settlement ? observed(parseEnvelopeText(String(r.stdout || ""))) : undefined);
  if (timedOut) bail("E_OPERATION_TIMEOUT", `${address} (${provider.capability} ${op.command}) did not finish within ${OPERATION_TIMEOUT_MS / 1000} s; its effects are unconfirmed`, observed(parseEnvelopeText(String(r.stdout || ""))));
  // Exactly one JSON-v1 envelope on stdout, nothing else, and an exit status
  // that agrees with it: contaminated output or a success envelope from a
  // process that then failed is not a receipt.
  let envelope;
  try { envelope = JSON.parse(String(r.stdout || "").trim()); } catch { envelope = undefined; }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || envelope.schemaVersion !== 1 || typeof envelope.ok !== "boolean") bail("E_OPERATION_RESULT", `${address} (${provider.capability} ${op.command}) did not answer exactly one JSON-v1 envelope on stdout (exit ${r.status}); its effects are unconfirmed${stderr ? `: ${stderr.slice(0, 400)}` : ""}`, observed(parseEnvelopeText(String(r.stdout || ""))));
  if (cleanupError) bail("E_OPERATION_RESULT", `${address} (${provider.capability} ${op.command}) answered, but private invocation cleanup could not be confirmed; its effects are unconfirmed`, observed(envelope));
  // A provider's own failure is relayed with its code; its WHOLE envelope
  // (a partial receipt such as result.instance of something it launched
  // before failing, and any details it gave) travels in error.details so a
  // scheduler can keep an unconfirmed outcome and reconcile that target.
  if (!envelope.ok) bail(envelope.error?.code || "E_OPERATION_FAILED", `${address}: ${envelope.error?.message || "failed"}`, { exit: r.status, envelope, ...(reportsRetainedEffectsText(envelope.error?.message) ? { unconfirmed: true } : {}) });
  if (r.status !== 0) bail("E_OPERATION_RESULT", `${address} (${provider.capability} ${op.command}) answered ok but exited ${r.status}; the receipt is not trusted and its effects are unconfirmed${stderr ? `: ${stderr.slice(0, 400)}` : ""}`, observed(envelope));
  const result = envelope.result && typeof envelope.result === "object" ? envelope.result : {};
  if (op.kind === "view") {
    const docs = result.documents;
    const bad = !Array.isArray(docs) || docs.some((d) => !d || typeof d !== "object" || typeof d.label !== "string" || !d.label
      || (d.kind !== undefined && !["markdown", "text"].includes(d.kind))
      || (d.path !== undefined && d.path !== null && (typeof d.path !== "string" || !isAbsolute(d.path)))
      || (d.text !== undefined && d.text !== null && typeof d.text !== "string"));
    if (bad) bail("E_OPERATION_RESULT", `${address} is a view operation but ${provider.capability} ${op.command} did not answer { documents: [{label, kind?, path?, text?}] }`);
  }
  // A launch receipt in the delegated result (a harvester the provider
  // spawned) is surfaced as top-level instance/home so the scheduler tracks
  // it exactly as it tracks a command job's launch; the source home itself
  // is `target`, never a launch.
  const receipt = {};
  if (typeof result.instance === "string" && result.instance !== meta?.instance) receipt.instance = result.instance;
  if (typeof result.home === "string" && result.home !== home) receipt.home = result.home;
  const out = { ...base, ...receipt, result, ...(intent ? { intent } : {}), ...(stderr ? { stderr: stderr.slice(0, 2000) } : {}) };
  if (JSON_MODE) { jsonOk(out); return; }
  console.log(`${address} via ${provider.capability}@${provider.version || "?"} (${provider.command} ${op.command}) in ${shortPath(cwd)}: ok`);
  if (op.kind === "view") for (const d of result.documents) console.log(`  - ${d.label}${d.path ? ` (${shortPath(d.path)})` : ""}${d.text ? `: ${String(d.text).split("\n")[0].slice(0, 100)}` : ""}`);
  else console.log(JSON.stringify(result, null, 2));
  if (stderr) console.error(stderr);
}
/** --arg k=v pairs of `oats operation run`. */
function operationArgs(bail) {
  const given = Object.create(null);
  for (let i = 3; i < args.length; i++) {
    if (args[i] !== "--arg") continue;
    const kv = args[i + 1];
    if (!kv || kv.startsWith("--") || !kv.includes("=")) bail("E_BAD_ARGS", "--arg expects name=value");
    const eq = kv.indexOf("=");
    given[kv.slice(0, eq)] = kv.slice(eq + 1);
    i++;
  }
  return given;
}
/** `oats operation run` on the workspace model (operationsApi 2): the provider is
 *  the module filling <layer> — the home's own copy, or the soul's resolved module
 *  fetched into the deployment's module store — with its merged payload as
 *  OATS_SETTINGS and the team facts hooks get. */
async function workspaceOperation(t, { bail, address, layer, opName }) {
  if (t.resolutionError) return bail(t.resolutionError.code, t.resolutionError.message, t.resolutionError.details ?? undefined);
  const name = t.slots[layer];
  const mod = name ? t.modules.find((x) => x.name === name) : null;
  if (!mod?.manifest) return bail("E_OPERATION_UNAVAILABLE", `no ${layer} provider is resolved for ${t.home ? t.home : `soul ${t.soul.name}`}`);
  const provider = { ...mod.manifest, capability: mod.name };
  const op = manifestOperations(provider).find((o) => o.name === opName);
  if (!op) return bail("E_OPERATION_UNKNOWN", `${mod.name} declares no operation ${JSON.stringify(opName)} (declared: ${manifestOperations(provider).map((o) => o.name).join(", ") || "none"})`);
  const missingReq = manifestMissingRequires(provider);
  if (missingReq.length) return bail("E_CAPABILITY_REQUIRES", `${mod.name} requires ${missingReq.map((m) => `"${m.command}" on PATH${m.why ? ` (${m.why})` : ""}${m.install ? ` [install: ${m.install}]` : ""}`).join(", ")}; ${address} was not run`);
  if (op.context === "home" && !t.home) return bail("E_OPERATION_UNAVAILABLE", `${address} runs in an instance home; pass --home <abs>`);
  const given = operationArgs(bail);
  const declared = new Map(op.args.map((a) => [a.name, a]));
  for (const n of Object.keys(given)) if (!declared.has(n)) return bail("E_BAD_ARGS", `${address} takes no arg ${JSON.stringify(n)} (declared: ${[...declared.keys()].join(", ") || "none"})`);
  for (const a of op.args) if (a.required && given[a.name] === undefined) return bail("E_BAD_ARGS", `${address} needs --arg ${a.name}=<value>: ${a.description || "required"}`);
  const argFlags = op.args.flatMap((a) => (given[a.name] === undefined ? [] : [a.flag, given[a.name]]));
  const spec = provider.commands?.[op.command];
  if (typeof spec !== "string" || !spec.trim()) return bail("E_CAPABILITY_BROKEN", `${mod.name}: command ${op.command} is not a non-empty string`);
  let catalog = null; try { catalog = officialPackageCatalog(); } catch { catalog = null; }
  const { layerProvider } = await import("../lib/instance-inspect.mjs");
  let lp;
  try { lp = await layerProvider(t, layer, { catalog, remoteOptions: remoteOptionsFromEnv() }); } catch (e) { return bail(e.code || "E_CAPABILITY_BROKEN", e.message, e.details); }
  const [script, ...rest] = spec.trim().split(/\s+/);
  const abs = lp?.executable(script);
  if (!abs) return bail("E_CAPABILITY_BROKEN", `${mod.name} ${op.command}: script not found (${script})`);
  const settings = lp.settings;
  const cwd = op.context === "home" ? t.home : t.deployment;
  const env = { ...lp.env(mod.name, settings), OATS_OPERATION: address, OATS_CONTEXT: t.deployment, OATS_ROOT: t.agentsRoot, PI_AGENTS_ROOT: t.agentsRoot };
  if (op.context === "home") Object.assign(env, { OATS_INSTANCE: t.meta.instance, OATS_INSTANCE_HOME: t.home, OATS_HOME: t.home, PI_AGENT_INSTANCE: t.meta.instance, PI_AGENT_HOME: t.home });
  else for (const k of ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME"]) delete env[k];
  const r = spawnSync("node", [abs, ...rest, ...argFlags, "--json"], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024, timeout: OPERATION_TIMEOUT_MS, killSignal: "SIGTERM" });
  finishOperation({ r, bail, address, provider, op, argFlags, cwd, home: t.home, meta: t.meta, api: INSPECT_OPERATIONS_API });
}
async function operationCmd() {
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  dropAmbientRoot();
  if (args[1] !== "run") bail("E_USAGE", "usage: oats operation run <layer>:<name> (--home <abs> | --soul <name> [--dir <scope>] [--agents-root <abs>]) [--arg k=v ...] [--json]");
  const address = args[2];
  const m0 = typeof address === "string" ? OPERATION_ADDRESS_RE.exec(address) : null;
  if (!m0) bail("E_BAD_ARGS", `operation address must be <layer>:<name> with layer one of ${LAYERS.join(", ")} (got ${JSON.stringify(address)})`);
  const [, layer, opName] = m0;
  // Only the messaging provider's operations act on the teams: others get the record, no remote read.
  const target = await workspaceTarget(bail, { command: "operation run", liveTeams: layer === "messaging" });
  return workspaceOperation(target, { bail, address, layer, opName });
}


/** Doctor answers on a workspace deployment only (lead decision c3-6): the
 *  deployment found walking up from the given directory (positional or --dir),
 *  else E_LOCAL_MISSING; an unreadable oats-local.yaml is its own error. */
function doctorDeployment(dir) {
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  const ctx = resolve(dir || dirFlag());
  const ws = doctorLockData(ctx);
  if (ws.localError) bail(ws.localError.code, ws.localError.message, ws.localError.details);
  if (!ws.local) bail("E_LOCAL_MISSING", `oats doctor reads a workspace deployment, and none is in reach of ${ctx} (no oats-local.yaml walking up; \`oats onboard\` creates one)`, { dir: ctx });
  return { ctx, ws };
}
async function doctorJson(dir) {
  const { ctx, ws } = doctorDeployment(dir);
  console.log(JSON.stringify(await doctorWorkspaceJson(ctx, flag("soul"), ws), null, 2));
}

/** The v2 doctor payload: the deployment declaration + lock (offline) and, with
 *  --soul, the composed instructions. No v1 keys (chain/layers/acquired/injects…). */
/** The problems doctor and status share for a v2 deployment: what OATS 0.25 left
 *  under local-agents/ (named, never read), and the captured homes under the agents root. */
function legacyLayoutProblems(root) {
  return [legacyLocalAgents(root), legacyCapturedHomes(root)].filter(Boolean);
}
async function doctorWorkspaceJson(ctx, soulName, ws) {
  const composition = await doctorComposition(ctx, soulName, ws, (code, msg, details) => jsonFail(code, msg, details));
  const problems = legacyLayoutProblems(join(dirname(ws.local.path), "agents"));
  return {
    schemaVersion: 1, workspaceApi: 2, context: ctx,
    workspace: { file: ws.local.path, ref: ws.local.workspace },
    workspaceError: ws.localError, lockFile: ws.lockFile, packages: ws.packages, lockError: ws.lockError,
    information: operationalKnowledgeNote(composition, soulName) ? [operationalKnowledgeNote(composition, soulName)] : [],
    composedInstructions: composition?.text, instructionBlocks: composition?.blocks,
    ...(problems.length ? { problems } : {}),
  };
}
/** Kernel/bridge version skew (published in lockstep from one tag). */
function doctorVersionSkew() {
  const piPkgFile = join(homedir(), ".pi", "agent", "npm", "node_modules", "@awebai", "oats-pi", "package.json");
  if (!existsSync(piPkgFile)) return;
  const bridge = JSON.parse(readFileSync(piPkgFile, "utf8")).version;
  if (bridge !== OATS_VERSION) console.log(`WARNING: version skew — kernel ${OATS_VERSION}, pi bridge ${bridge}; run \`oats update\` (they publish in lockstep)\n`);
}
/** The "Workspace (v2, offline view)" + "Locked packages" sections, shared by both doctor shapes. */
function printDoctorWorkspace(ws) {
  console.log("\nWorkspace (v2, offline view):");
  console.log(`  oats-local.yaml  ${shortPath(ws.local.path)}  → workspace ${ws.local.workspace}`);
  console.log("\nLocked packages (oats-lock.json v3):");
  if (ws.lockError) {
    console.log(`  ERROR: ${ws.lockError.message} [${ws.lockError.code}]`);
    if (ws.lockError.file) console.log(`         the lock is never auto-repaired; delete ${shortPath(ws.lockError.file)} and run \`oats sync\``);
  } else if (!ws.packages.length) console.log(ws.lockFile ? "  (none)" : "  (no lock yet — run `oats sync`)");
  for (const p of ws.packages) {
    console.log(`  ${p.id} ${p.version}  ${p.source}  @ ${p.commit.slice(0, 12)}  ${p.integrity}`);
    if (p.capabilities.length) console.log(`             capabilities: ${p.capabilities.join(", ")}`);
  }
  console.log("  membership, discovery and drift need the remotes: `oats workspace status`, `oats sync`.");
}
async function doctor(dir) {
  const { ctx, ws } = doctorDeployment(dir);
  const soulName = flag("soul");
  console.log(`oats doctor — resolved from ${shortPath(ctx)}\n`);
  doctorVersionSkew();
  const composition = await doctorComposition(ctx, soulName, ws, (code, msg) => die(`${msg} [${code}]`));
  printDoctorWorkspace(ws);
  for (const p of legacyLayoutProblems(join(dirname(ws.local.path), "agents"))) console.log(`\n! ${p.code}: ${p.message}`);
  if (soulName) {
    const information = operationalKnowledgeNote(composition, soulName);
    if (information) console.log(`\nINFO: ${information}`);
    console.log(`\nFinal composed AGENTS.md for ${soulName}:\n\n${composition.text}`);
  } else console.log("\nPass --soul <name> to inspect final composed AGENTS.md.");
}

// ---------- config editing (structural: parse → mutate → re-serialize the capabilities block) ----------
/** Replace (or append, or drop with "") the top-level launch-configs block:
 *  the span from its key line (bare, quoted, or the inline `launch-configs: {...}`
 *  form) to the next top-level line is replaced; every byte before and after
 *  that span stays exactly as it was. Two declarations of the key are refused
 *  rather than guessed at. */
function replaceLaunchConfigsBlock(text, serialized) {
  const keyLine = /^(["']?)launch-configs\1:(\s*(?:#.*)?|\s+\S.*)?$/;
  const lines = text.split("\n");
  const starts = lines.map((l, i) => keyLine.test(l) ? i : -1).filter((i) => i >= 0);
  if (starts.length > 1) throw Object.assign(new Error(`oats-local.yaml declares launch-configs ${starts.length} times (lines ${starts.map((i) => i + 1).join(", ")}); keep one`), { code: "E_CONFIG_BROKEN" });
  const block = serialized ? serialized.replace(/\n$/, "").split("\n") : [];
  if (!starts.length) {
    if (!serialized) return text;
    const sep = text === "" ? "" : text.endsWith("\n") ? "\n" : "\n\n"; // always its own blank separator, which removal takes back
    return text + sep + serialized;
  }
  const start = starts[0];
  // The block runs to the next real top-level key (a column-zero line that
  // is not a comment). Blank lines and column-zero comments directly ahead
  // of that key, or at the end of the file, are not part of it and stay
  // where they are; a column-zero comment followed by more indented entries
  // is inside the block (and is regenerated away with it).
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] !== "" && !/^\s/.test(lines[i]) && !lines[i].startsWith("#")) { end = i; break; }
  }
  while (end > start + 1 && (lines[end - 1] === "" || lines[end - 1].startsWith("#"))) end--;
  const tail = lines.slice(end);
  if (!tail.length) tail.push(""); // the block ended the file: the result still ends with a newline
  let prefixEnd = start;
  // Dropping the block drops the one blank line that separated it (before it
  // when it was appended, else after it); replacing it keeps one blank line
  // between the block and what follows.
  if (!block.length) { if (start > 0 && lines[start - 1] === "") prefixEnd = start - 1; else if (tail[0] === "" && tail.length > 1) tail.shift(); }
  const replaced = [...lines.slice(0, prefixEnd), ...block];
  if (block.length && tail[0] !== "") replaced.push("");
  return [...replaced, ...tail].join("\n");
}

// ---------- launch configurations ----------
const yamlQuoted = (v) => JSON.stringify(String(v));
/** The `launch-configs:` block, names sorted, every string double-quoted
 *  with JSON escapes (read back by the same rules), lists as block
 *  sequences: spaces, quotes, commas and metacharacters round-trip exactly. */
function serializeLaunchConfigs(map) {
  const names = Object.keys(map).sort();
  if (!names.length) return "";
  const lines = ["launch-configs:"];
  for (const name of names) {
    const e = map[name];
    lines.push(`  ${name}:`, `    harness: ${e.harness}`);
    if (e.executable !== undefined) lines.push(`    executable: ${yamlQuoted(e.executable)}`);
    if (e.args?.length) { lines.push("    args:"); for (const a of e.args) lines.push(`      - ${yamlQuoted(a)}`); }
    const envNames = Object.keys(e.env || {}).sort();
    if (envNames.length) {
      lines.push("    env:");
      for (const n of envNames) { const v = e.env[n]; if (typeof v === "string") lines.push(`      ${n}: ${yamlQuoted(v)}`); else lines.push(`      ${n}:`, `        fromEnv: ${v.fromEnv}`); }
    }
    if (e.model !== undefined) lines.push(`    model: ${yamlQuoted(e.model)}`);
    if (e.yolo !== undefined) lines.push(`    yolo: ${e.yolo}`);
  }
  return lines.join("\n") + "\n";
}
/** Only the declared keys, in canonical order, from a validated entry. */
/** A configuration as `launch-config set` writes it: `harness` always — a `runtime` (the
 *  pre-0.27 name, read either) is written back under its new name (lead call 6). */
function normalizeLaunchConfig(e) {
  return {
    harness: Object.hasOwn(e, "harness") ? e.harness : e.runtime,
    ...(e.executable !== undefined ? { executable: e.executable } : {}),
    ...(e.args?.length ? { args: [...e.args] } : {}),
    ...(e.env && Object.keys(e.env).length ? { env: Object.fromEntries(Object.keys(e.env).sort().map((n) => [n, typeof e.env[n] === "string" ? e.env[n] : { fromEnv: e.env[n].fromEnv }])) } : {}),
    ...(e.model !== undefined ? { model: e.model } : {}),
    ...(e.yolo !== undefined ? { yolo: e.yolo } : {}),
  };
}
function readLaunchConfigsModel(local) {
  const map = local["launch-configs"] || {};
  for (const [name, entry] of Object.entries(map)) validateLaunchConfig(name, entry, "oats-local.yaml");
  const out = Object.create(null); // a name may be "constructor": membership is own only
  for (const [n, e] of Object.entries(map)) out[n] = normalizeLaunchConfig(e);
  return out;
}
/** What a GUI or an operator sees of one configuration. Environment values
 *  never leave the file: a literal is answered as {redacted: true} (literals
 *  are non-secret by contract, but no value is shown anywhere) and a
 *  reference as {fromEnv: NAME}. An editor keeps a literal it cannot see with
 *  `set --keep-env`. */
function publicLaunchConfig(e, extra = {}) {
  const env = Object.fromEntries(Object.keys(e.env || {}).sort().map((n) => [n, typeof e.env[n] === "string" ? { redacted: true } : { fromEnv: e.env[n].fromEnv }]));
  return { harness: e.harness, executable: e.executable ?? null, args: [...(e.args || [])], env, model: e.model ?? null, yolo: e.yolo ?? null, ...extra };
}
/** The scope a launch-config command reads: --dir (or cwd), a running
 *  home's recorded context (--home), or a soul's own member context
 *  (--soul, with --dir/--agents-root as inspect takes them). */
function launchConfigContext(bail) {
  const homeFlag = flag("home");
  const soulFlag = flag("soul");
  if (homeFlag !== undefined && soulFlag !== undefined) bail("E_BAD_ARGS", "choose --home or --soul, not both");
  if (homeFlag !== undefined) {
    if (homeFlag === true || !isAbsolute(String(homeFlag))) bail("E_BAD_ARGS", "--home needs an absolute instance home");
    const home = realOrResolved(String(homeFlag));
    let meta;
    try { meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8")); } catch (e) { bail("E_HOME_UNKNOWN", `${home} is not an OATS instance home (${e.message})`); }
    const ctx = homeContexts(home, meta)[0];
    return { context: ctx, selected: { home, instance: meta.instance || null } };
  }
  const ctx = dirFlag();
  if (soulFlag !== undefined) {
    if (soulFlag === true) bail("E_BAD_ARGS", "--soul needs a soul name");
    const agentsRootFlag = flag("agents-root");
    if (agentsRootFlag === true) bail("E_BAD_ARGS", "--agents-root needs an absolute agents directory");
    let soul;
    try { soul = selectSoul(scopeSouls(ctx).souls, String(soulFlag), agentsRootFlag, ctx); } catch (e) { bail(e.code || "E_SOUL_UNKNOWN", e.message); }
    return { context: memberContextOf(soul, ctx, flag("dir") !== undefined, bail), selected: { soul: soul.name, agentsRoot: soul.agentsRoot } };
  }
  return { context: ctx, selected: null };
}
/** oats launch-config preview: what a start of a home (or a new instance of
 *  a soul) would run under a selection, resolved against the current scoped
 *  configuration, preflighted, read-only; environment values withheld and
 *  the prompt named, never the TASK body. */
function launchPreview(bail) {
  for (const k of ["launch-config", "harness", "runtime", "model"]) if (flag(k) === true) bail("E_BAD_ARGS", `--${k} needs a value`);
  const sel = { launchConfig: flag("launch-config"), harness: harnessFlag(), model: flag("model"), yolo: yoloFlag() };
  if (sel.harness !== undefined && !LAUNCH_HARNESSES.includes(sel.harness)) bail("E_BAD_ARGS", `--harness must be one of ${LAUNCH_HARNESSES.join(", ")}`);
  const { context, selected } = launchConfigContext(bail);
  if (!selected) bail("E_BAD_ARGS", "preview needs --home <abs> (an existing instance) or --soul <name> [--dir <scope>] (a new instance)");
  const selectionGiven = sel.launchConfig !== undefined || sel.harness !== undefined || sel.model !== undefined || sel.yolo !== undefined;
  let meta = null, agentLike, home, instance;
  if (selected.home) {
    home = selected.home;
    try { meta = upgradeHomeMeta(JSON.parse(readFileSync(join(home, "instance.json"), "utf8")), home); } catch (e) { bail("E_HOME_UNKNOWN", `${home}: ${e.message}`); }
    instance = meta.instance || basename(home);
    if (!(meta.launch && typeof meta.launch === "object") && !selectionGiven) {
      // A home that predates recipes, asked nothing: its frozen command is
      // described as is. Under a selection the planner refuses it
      // (E_LAUNCH_LEGACY: re-spawn it from the deployment).
      let d;
      try { d = describeLaunchCommand(meta.command); } catch (e) { bail(e.code || "E_LAUNCH_COMMAND_UNSUPPORTED", e.message); }
      jsonOk({ context, selected, selection: { source: "frozen-command", launchConfig: null, harness: null, model: null, yolo: null }, harness: meta.harness, model: meta.model || null, modelSource: meta.model ? "recorded" : "native default", yolo: meta.yolo ?? null, launchConfig: null, launchConfigSource: null, executable: { path: d.executable, declared: null, resolvedFrom: "recorded" }, argv: d.argv, environment: d.environment, command: redactLaunchCommand(meta.command), prompt: { kind: "task-file", file: "TASK.md" }, hooks: null, preflight: [{ check: "recipe", ok: true, detail: "frozen command; a selection is refused (E_LAUNCH_LEGACY): re-spawn it" }], ok: true });
      return;
    }
    const agentsRoot = agentsRootOfHome(home);
    const agent = (() => { try { return findAgent(agentsRoot, meta.agent); } catch { return undefined; } })();
    agentLike = agent || { harness: meta.harness, model: meta.model, yolo: meta.yolo };
  } else {
    const soul = scopeSouls(context).souls.find((x) => x.name === selected.soul && x.agentsRoot === selected.agentsRoot);
    agentLike = { harness: soul.harness, model: soul.model };
    instance = `${soul.name}-<purpose>`; home = join(selected.agentsRoot, soul.name, "instances", instance);
  }
  // A home's recorded capabilities; a new instance's are its spawn's resolution,
  // which a preview of a soul does not prepare (spawn --preview does).
  let r;
  try { r = meta ? resolvedFromHome(home, meta) : { capabilities: [], launchConfigs: launchConfigsAt(context) }; } catch (e) { bail(e.code || "E_CONFIG_BROKEN", e.message, e.details); }
  // The same planner a start uses, in preview mode: failed checks are listed, nothing is touched.
  let plan;
  try { plan = planLaunch({ home, instance, meta, contextDir: context, agentLike, selection: sel, resolvedCfg: r, preview: true }); } catch (e) { bail(e.code || "E_BAD_ARGS", e.message); }
  const { recipe } = plan;
  const command = renderLaunchRecipe(recipe, { home, instance, redact: true });
  const d = describeLaunchCommand(command);
  const environment = d.environment.map((e) => e.reference && recipe.env[e.name]?.fromEnv ? { name: e.name, fromEnv: recipe.env[e.name].fromEnv } : e);
  jsonOk({ context, selected, selection: { source: plan.selectionSource, launchConfig: recipe.launchConfig, harness: sel.harness ?? null, model: sel.model ?? null, yolo: sel.yolo ?? null }, harness: plan.harness, model: recipe.model, modelSource: plan.modelSource, yolo: recipe.yolo ?? null, launchConfig: recipe.launchConfig, launchConfigSource: recipe.launchConfigSource, executable: { path: plan.executable.path, declared: plan.executable.declared ?? null, resolvedFrom: plan.executable.resolvedFrom }, argv: d.argv, environment, command, prompt: recipe.prompt, hooks: redactLaunchRecipe(recipe).hooks, preflight: plan.preflight, ok: plan.ok });
}
async function launchConfigCmd() {
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  dropAmbientRoot();
  const sub = args[1];
  const usage = "usage: oats launch-config list [--dir <scope> | --home <abs> | --soul <name> [--dir <scope>] [--agents-root <abs>]] [--json] | set <name> --file <json> [--keep-env] [--dir <scope>] [--json] | remove <name> [--dir <scope>] [--json] | preview (--home <abs> | --soul <name> [--dir <scope>]) [--launch-config <name>|none] [--harness r] [--model m] [--yolo|--no-yolo] --json";
  if (sub === "preview") { launchPreview(bail); return; }
  if (!["list", "set", "remove"].includes(sub)) bail("E_USAGE", usage);
  const { context: dir, selected } = sub === "list" ? launchConfigContext(bail) : { context: dirFlag(), selected: null };
  if (sub !== "list" && (flag("home") !== undefined || flag("soul") !== undefined)) bail("E_BAD_ARGS", `launch-config ${sub} writes the deployment's oats-local.yaml: address it with --dir, not --home or --soul`);
  // Lead decision 2: launch configurations are a HOST choice, declared in the
  // deployment's oats-local.yaml (found walking up; a home's own deployment).
  const at = selected?.home ?? dir;
  // A 0.25 oats-config.yaml in reach is refused by loadLocal (E_CONFIG_BROKEN, naming
  // the move), never read as "no configurations".
  let found = null;
  // No deployment in reach answers the (empty) effective set — unless what is in
  // reach is a 0.25 oats-config.yaml, whose launch-configs nothing reads any more.
  try { found = loadLocal(at); } catch (e) { if (e?.code !== "E_LOCAL_MISSING" || e.details?.legacy) bail(e.code || "E_WORKSPACE_SCHEMA", e.message, e.details); }
  const file = found?.path ?? null, level = file ? dirname(file) : null;
  const effective = () => Object.values(launchConfigsAt(at)).sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ name: e.name, ...publicLaunchConfig(e, { source: e.source, shadows: e.shadows }) }));
  if (sub === "list") {
    let configurations;
    try { configurations = effective(); } catch (e) { bail(e.code || "E_LAUNCH_CONFIG_INVALID", e.message); }
    if (JSON_MODE) { jsonOk({ context: dir, level, file, selected, configurations }); return; }
    if (!configurations.length) { console.log(`No launch configurations are declared${file ? ` in ${shortPath(file)}` : ` (no oats-local.yaml in reach of ${dir})`}`); return; }
    for (const c of configurations) {
      const env = Object.entries(c.env).map(([n, v]) => v.fromEnv ? `${n}=$${v.fromEnv}` : `${n}=<redacted>`).join(" ");
      console.log(`${c.name}: ${c.harness}${c.executable ? ` ${c.executable}` : ""}${c.args.length ? ` ${c.args.map((a) => JSON.stringify(a)).join(" ")}` : ""}${env ? ` [${env}]` : ""}${c.model ? ` model ${c.model}` : ""}${c.yolo !== null ? ` yolo ${c.yolo}` : ""}`);
    }
    return;
  }
  if (!file) bail("E_LOCAL_MISSING", `launch-config ${sub} writes the deployment's oats-local.yaml, and none is in reach of ${dir} — run it from the deployment (\`oats onboard\` creates one)`);
  const name = args[2];
  if (!name || name.startsWith("--")) bail("E_BAD_ARGS", `launch-config ${sub} needs a configuration name`);
  const text = readFileSync(file, "utf8");
  let model;
  try { model = readLaunchConfigsModel(found.local); } catch (e) { bail(e.code || "E_LAUNCH_CONFIG_INVALID", e.message); }
  const declaredHere = Object.hasOwn(model, name);
  const before = declaredHere ? publicLaunchConfig(model[name]) : null;
  if (sub === "remove") {
    if (!declaredHere) bail("E_LAUNCH_CONFIG_UNKNOWN", `${name} is not declared in ${shortPath(file)}`);
    delete model[name];
  } else {
    const f = flag("file");
    if (!f || f === true) bail("E_BAD_ARGS", "launch-config set needs --file <json> (an object with harness and optional executable, args, env, model, yolo)");
    let entry;
    // A parse error is reported without the parser's text: its message can
    // quote the document, and a definition may carry environment literals.
    let raw;
    if (f === "-") {
      // The routed form: the definition's bytes arrive on stdin (the ssh
      // transport); no local file name crosses the wire.
      if (process.stdin.isTTY) bail("E_BAD_ARGS", "--file - reads the definition from stdin");
      try { raw = (await readStreamBounded(process.stdin, INSPECT_TEXT_CAP)).toString("utf8"); } catch (e) { bail(e.code || "E_BAD_ARGS", e.message); }
    } else {
      try { raw = readFileSync(f, "utf8"); } catch (e) { bail("E_BAD_ARGS", `--file ${f}: ${e.code === "ENOENT" ? "no such file" : e.code || "cannot read"}`); }
    }
    try { entry = JSON.parse(raw); } catch { bail("E_BAD_ARGS", `--file ${f} is not valid JSON (one object with harness and optional executable, args, env, model, yolo)`); }
    if (args.includes("--keep-env")) {
      // An editor that saw only redacted values keeps the environment of the
      // declared definition of that name: a one-time copy into the complete
      // replacement entry.
      if (entry && typeof entry === "object" && entry.env !== undefined) bail("E_BAD_ARGS", "--keep-env keeps the environment of the declared definition; omit env from --file");
      const current = declaredHere ? model[name] : undefined;
      if (!current) bail("E_LAUNCH_CONFIG_UNKNOWN", `--keep-env: no launch configuration ${name} is declared in ${shortPath(file)}, so there is no environment to keep; declare it with env`);
      if (entry && typeof entry === "object" && Object.keys(current.env || {}).length) entry.env = { ...current.env };
    }
    try { validateLaunchConfig(name, entry, `--file ${f}`); } catch (e) { bail(e.code || "E_LAUNCH_CONFIG_INVALID", e.message); }
    if (!Object.hasOwn(entry, "harness")) noteRuntimeName(`runtime in the --file definition (written as harness)`);
    model[name] = normalizeLaunchConfig(entry);
  }
  let next;
  try { next = replaceLaunchConfigsBlock(text, serializeLaunchConfigs(model)); } catch (e) { bail(e.code || "E_CONFIG_BROKEN", `${e.message}; nothing was written`); }
  // What is written must read back as exactly what was asked, by the kernel's
  // own reader, before a byte of the file changes.
  let readBack;
  let nextLocal;
  try { nextLocal = parseConfigData(next, { origin: { kind: "local", path: file } }).value; readBack = nextLocal["launch-configs"] || {}; } catch (e) { bail("E_LAUNCH_CONFIG_INVALID", `the rewritten block does not parse: ${e.message}; nothing was written`); }
  const schemaProblems = validateLocal(nextLocal);
  if (schemaProblems.length) bail("E_LAUNCH_CONFIG_INVALID", `the rewritten oats-local.yaml would be invalid (${schemaProblems.map((p) => `${p.path || "/"}: ${p.message}`).join("; ")}); nothing was written`);
  const canonical = (m) => JSON.stringify(Object.keys(m).sort().map((n) => [n, normalizeLaunchConfig(m[n])]));
  const same = canonical(readBack) === canonical(model);
  if (!same) bail("E_LAUNCH_CONFIG_INVALID", `${name} would not read back as written; nothing was written`);
  writeFileAtomic(file, next);
  let eff = null;
  try { eff = effective().find((c) => c.name === name) || null; } catch (e) { eff = { error: e.message }; }
  const receipt = { name, action: sub, level, file, before, after: Object.hasOwn(model, name) ? publicLaunchConfig(model[name]) : null, effective: eff };
  if (JSON_MODE) { jsonOk(receipt); return; }
  console.log(sub === "set" ? `Declared launch configuration ${name} in ${shortPath(file)}` : `Removed launch configuration ${name} from ${shortPath(file)}`);
}


/** `oats instance <git|diff> <instance>` — K1: read-only Git observation of one
 *  instance's work tree. The instance is addressed qualified: an explicit
 *  --home, or a name under the --dir scope (team roots included) that resolves
 *  to exactly one home; several homes refuse with every candidate named. */
function instanceCmd() {
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  const sub = args[1], name = args[2];
  const usage = "usage: oats instance events <instance> [--limit <n>] [--since <iso>] [--home <abs>] [--dir <d>] [--json] | oats instance git <instance> [--home <abs>] [--dir <d>] [--json] | oats instance diff <instance> --file <id> --revision <rev> [--index-revision <rev>] [--home <abs>] [--dir <d>] [--json] | oats instance stop <instance> (--plan | --apply --plan-revision <rev> --idempotency-key <key>) [--no-recursive] [--grace-ms <n>] [--home <abs>] [--dir <d>] [--json]";
  if (!["git", "diff", "stop", "events"].includes(sub) || !name || name.startsWith("--")) return bail("E_BAD_ARGS", usage);
  dropAmbientRoot();
  if (sub === "events") {
    // K7: typed producer events, bounded window; nothing inferred.
    const homeOpt = flag("home"); if (homeOpt === true || (homeOpt !== undefined && !isAbsolute(homeOpt))) return bail("E_BAD_ARGS", "--home needs an absolute instance home");
    let root; try { root = ensureRoot(dirFlag()); } catch (e) { return bail(e.code || "E_NO_ROOT", e.message); }
    const limit = flag("limit"); const since = flag("since");
    if (limit === true || since === true) return bail("E_BAD_ARGS", usage);
    try {
      const { resolveInstance } = await_import_lifecycle();
      // K7b: --home is an ADDRESS claim, checked like K1 — it must be a home of
      // exactly this name under the scope (E_HOME_MISMATCH otherwise).
      const home = resolveInstance(dirFlag(), root, name, homeOpt ? { home: homeOpt } : {}).home;
      const ev = readEvents(home, { ...(limit !== undefined ? { limit: Math.max(1, Math.min(2000, Number(limit) || 200)) } : {}), ...(since ? { since } : {}) });
      if (JSON_MODE) { jsonOk(ev); return; }
      console.log(`${ev.instance}: ${ev.returned} of ${ev.count} event(s)${ev.truncated ? " (window truncated)" : ""}${ev.waitingOnYou ? ` — waiting on you since ${ev.waitingOnYou.since} (${ev.waitingOnYou.producer})` : ""}`);
      for (const e of ev.events) console.log(`  ${e.at ?? "?"}  ${e.kind.padEnd(20)} ${e.producer}${e.data ? `  ${JSON.stringify(e.data).slice(0, 120)}` : ""}`);
      return;
    } catch (e) { return bail(e.code || "E_EVENTS_FAILED", e.message, e.candidates ? { candidates: e.candidates } : undefined); }
  }
  if (sub === "stop") {
    // K3: plan → apply. The plan is what a confirmation shows; apply carries
    // its revision back and refuses if reality moved.
    const homeOpt = flag("home");
    if (homeOpt === true || (homeOpt !== undefined && !isAbsolute(homeOpt))) return bail("E_BAD_ARGS", "--home needs an absolute instance home");
    let root; try { root = ensureRoot(dirFlag()); } catch (e) { return bail(e.code || "E_NO_ROOT", e.message); }
    const recursive = !args.includes("--no-recursive");
    const wantPlan = args.includes("--plan"), wantApply = args.includes("--apply");
    if (wantPlan === wantApply) return bail("E_BAD_ARGS", "stop needs exactly one of --plan or --apply");
    try {
      if (wantPlan) {
        const plan = planStop(dirFlag(), root, name, { home: homeOpt, recursive });
        if (JSON_MODE) { jsonOk(plan); return; }
        console.log(`stop ${name}${recursive ? " (and recorded children)" : ""} — plan ${plan.planRevision}`);
        for (const t of plan.targets) console.log(`  ${"  ".repeat(t.depth)}${t.instance}: session ${t.session.state}${t.work.observed ? `, ${t.work.changed} changed / ${t.work.untracked} untracked on ${t.work.branch ?? "detached"}` : ", work not observed"}${t.midTask === true ? " — mid-task" : t.midTask === "unknown" ? " — activity unknown" : ""}`);
        for (const n of plan.notes) console.log(`  note: ${n}`);
        console.log(`apply with: oats instance stop ${name} --apply --plan-revision ${plan.planRevision} --idempotency-key <key>`);
        return;
      }
      const rev = flag("plan-revision"), key = flag("idempotency-key"), grace = flag("grace-ms");
      if (rev === true || key === true || grace === true) return bail("E_BAD_ARGS", usage);
      const receipt = applyStop(dirFlag(), root, name, { home: homeOpt, recursive, planRevision: rev, idempotencyKey: key, ...(grace !== undefined ? { graceMs: Number(grace) } : {}) });
      if (JSON_MODE) { jsonOk(receipt); return; }
      for (const r of receipt.results) console.log(`  ${r.instance}: ${r.ok ? (r.stopped ? "stopped" : `already ${r.state}`) : `${r.code} — ${r.message}`}`);
      console.log(receipt.ok ? `stopped${receipt.replayed ? " (replayed receipt)" : ""}; home, work, transcript and launch configuration retained — restart with \`oats session restart\`` : "some targets are still running; nothing was escalated");
      if (!receipt.ok) process.exit(1);
      return;
    } catch (e) { return bail(e.code || "E_LIFECYCLE_FAILED", e.message, e.plan ? { plan: e.plan } : e.candidates ? { candidates: e.candidates } : undefined); }
  }
  let home = flag("home");
  if (home === true) return bail("E_BAD_ARGS", "--home needs an absolute instance home");
  if (home !== undefined && !isAbsolute(home)) return bail("E_BAD_ARGS", "--home needs an absolute instance home");
  if (home === undefined) {
    let root;
    try { root = ensureRoot(dirFlag()); } catch (e) { return bail(e.code || "E_NO_ROOT", e.message); }
    const roots = [realOrResolved(root)];
    const candidates = [];
    for (const rt of roots) for (const hit of findInstanceHomes(rt, name)) candidates.push({ root: rt, agent: hit.agent?.name ?? null, home: hit.home });
    if (!candidates.length) return bail("E_SESSION_UNKNOWN", `no instance ${JSON.stringify(name)} under ${roots.join(", ")}`);
    if (candidates.length > 1) return bail("E_AMBIGUOUS_INSTANCE", `instance ${JSON.stringify(name)} has ${candidates.length} homes; pass --home <abs>`, { candidates });
    home = candidates[0].home;
  } else if (basename(home) !== name) return bail("E_HOME_MISMATCH", `--home ${home} is not the home of instance ${JSON.stringify(name)}`);
  try {
    if (sub === "git") {
      const observed = observeInstanceGit(home);
      if (JSON_MODE) { jsonOk(observed); return; }
      const o = observed.observation;
      console.log(`${observed.instance} — ${shortPath(o.worktree)} @ ${o.branch ?? (o.detached ? `detached ${o.revision.slice(0, 12)}` : "unborn")}`);
      console.log(`  upstream: ${observed.upstream.ref ? `${observed.upstream.ref} +${observed.upstream.ahead} -${observed.upstream.behind}` : "none (ahead/behind unknown)"}`);
      console.log(`  base: ${observed.base.ref ? `${observed.base.ref} +${observed.base.ahead} -${observed.base.behind} (merge-base ${observed.base.mergeBase?.slice(0, 12)})` : "unknown"}`);
      console.log(`  files: ${observed.files.length} (${Object.entries(observed.summary).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ") || "clean"})`);
      for (const f of observed.files) console.log(`    ${f.xy} ${f.origPath ? `${f.origPath} -> ` : ""}${f.path}  [${f.id}]`);
      for (const n of observed.notes) console.log(`  note: ${n}`);
      return;
    }
    const fileId = flag("file"), revision = flag("revision"), indexRevision = flag("index-revision");
    if (fileId === true || revision === true || indexRevision === true) return bail("E_BAD_ARGS", usage);
    const d = diffInstanceFile(home, { fileId, revision, indexRevision });
    if (JSON_MODE) { jsonOk(d); return; }
    console.log(`${d.file.origPath ? `${d.file.origPath} -> ` : ""}${d.file.path} (${d.file.kind}, against ${d.against})${d.binary ? " [binary]" : ""}${d.truncated ? ` [truncated at ${d.limit} bytes]` : ""}`);
    if (!d.binary) process.stdout.write(d.patch);
  } catch (e) {
    bail(e.code || "E_GIT_FAILED", e.message, e.observation ? { observation: e.observation } : undefined);
  }
}
/** `oats readiness (--soul <name> [--agents-root <abs>] [--dir <d>] | --home <abs>) [--policy] --json` — readinessApi 2. */
async function readinessCmd() {
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  dropAmbientRoot();
  const homeArg = flag("home");
  // Workspace model (readinessApi 2): an instance or soul subject; checks
  // installed | configured | member | providers. No trusted check.
  if (args.includes("--verify-signatures")) return bail("E_BAD_ARGS", "--verify-signatures was removed with the trusted check (readinessApi 2): declaring a package in packages: is the trust decision, and the lock pins commit + integrity");
  const target = await workspaceTarget(bail, { command: "readiness" });
  {
    const given = (name) => { const v = flag(name); return v && v !== true ? String(v) : null; };
    const selector = homeArg && homeArg !== true ? { kind: "home", home: String(homeArg), soul: given("soul"), agentsRoot: given("agents-root") }
      : { kind: "soul", soul: String(flag("soul")), agentsRoot: given("agents-root"), dir: given("dir") };
    let catalog = null; try { catalog = officialPackageCatalog(); } catch { catalog = null; }
    const doc = await readinessDocument(target, { selector, remoteOptions: remoteOptionsFromEnv(), catalog });
    if (args.includes("--policy")) {
      doc.policy = policyOf({ instanceMeta: target.meta, soul: target.meta ? null : policySoul(target) }).policy;
      doc.notes.push("policy: a lifecycle-authority claim enforced by the spawn route, not an OS sandbox");
    }
    if (JSON_MODE) { jsonOk(doc); return; }
    const s = doc.subject;
    console.log(`readiness — ${s.kind === "instance" ? `instance ${s.instance} (soul ${s.soul})` : `soul ${s.soul}`}: ${doc.summary.ready ? "READY" : `${doc.summary.fail} failing, ${doc.summary.unknown} unknown of ${doc.summary.required} required`}`);
    for (const [name, check] of Object.entries(doc.checks)) {
      console.log(`  ${name}: ${check.status}`);
      for (const i of check.items) console.log(`    ${i.status.padEnd(14)} ${i.subject}${i.required ? "" : " (optional)"}${i.reason ? ` — ${i.reason}` : ""}${i.remedy ? `  → ${i.remedy}` : ""}`);
    }
    if (doc.policy) console.log(`  policy: child spawns ${doc.policy.childSpawns.allowed ? "allowed" : "disabled"} (${doc.policy.childSpawns.origin.kind}${doc.policy.childSpawns.enforced ? ", enforced" : ""}); worktrees ${doc.policy.worktrees.allowed === null ? "unknown" : doc.policy.worktrees.allowed ? "allowed" : "not in this work mode"}`);
    for (const n of doc.notes) console.log(`  note: ${n}`);
    return;
  }
}
// ---------- workspace model v2: sync / package / workspace status / capabilities / souls ----------
// Contract: docs/design/2026-09-23-workspace-module-contracts.md §6. Nothing is
// installed: `oats-local.yaml` names the workspace, discovery runs over the Git
// remotes (lib/workspace.mjs), packages resolve to exact commits (lib/packages.mjs,
// lock v3) and the only persisted state is `oats-lock.json` beside oats-local.yaml.

/** Remote options threaded into every remote call. OATS_REMOTE_CACHE relocates
 * the content-addressed fetch cache (tests never touch ~/.cache). */
function remoteOptionsFromEnv() {
  const cacheDir = process.env.OATS_REMOTE_CACHE;
  return cacheDir ? { cacheDir: resolve(cacheDir) } : {};
}

/** The v2 deployment context at --dir: { dir, localPath, local, deploymentDir, remoteOptions }. */
function workspaceContext(bail) {
  const dir = dirFlag();
  let found;
  try { found = loadLocal(dir); }
  catch (e) { return bail(e.code || "E_LOCAL_MISSING", e.message, e.details); }
  return { dir, localPath: found.path, local: found.local, deploymentDir: dirname(found.path), remoteOptions: remoteOptionsFromEnv() };
}

/** The official catalog's package map (package-catalog.json; OATS_PACKAGE_CATALOG overrides). */
function catalogForSync(bail) {
  try { return officialPackageCatalog(); }
  catch (e) { return bail(e.code || "E_PACKAGE_MISSING", e.message); }
}

/** The package requests of a standalone view: the catalog's own pin of the package
 *  providing oats.core (decision 25) — nothing else, since the version list lives in
 *  the workspace file we cannot read. The request is written as resolvePackages
 *  expects a CATALOG entry: the bare version (`v1.1.3`), never the catalog's raw ref
 *  (`oats-framework/v1.1.3` is a tag PATH the one grammar refuses); parsePackageRequest
 *  recomposes the tag from the catalog's own convention.
 *  → { packages: { <id>: <version> }, problems: [ { code: "E_PACKAGE_MISSING", … } ] } */
function standalonePackages(catalog) {
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
function standaloneCatalogVersion(ref) {
  if (typeof ref !== "string" || !ref.trim()) return null;
  const tail = ref.trim().split("/").filter(Boolean).pop() ?? "";
  return classifyPackageValue(tail).kind === "catalog" ? tail : null;
}

/** Discover the workspace named by oats-local.yaml over the real remote. */
async function discoverForCli(ctx, bail) {
  // The standalone case (decisions 10/25) is a discovery too: the repo's own view
  // plus the kernel's oats.core default — discoverOrStandalone decides.
  try { const { discoverOrStandalone } = await import("../lib/instance-resolution.mjs"); return await discoverOrStandalone(ctx.local, { deployment: ctx.deploymentDir, remoteOptions: ctx.remoteOptions }); }
  catch (e) {
    if (typeof e?.code === "string" && e.code.startsWith("E_")) return bail(e.code, e.message, e.details ?? e.provenance);
    throw e;
  }
}

const short = (oid) => (typeof oid === "string" ? oid.slice(0, 8) : "?");
/** Display name of a discovery: the workspace's name, or the standalone label (decision 10). */
const workspaceName = (discovery) => discovery.workspace?.name ?? `standalone:${memberLabel(discovery.key)}`;
const memberLabel = (key) => String(key).split("/").filter(Boolean).pop()?.replace(/\.git$/, "") || String(key);
const teamLabel = (team) => team ?? "unassigned";
const originOf = (item) => (item.package ? `package ${item.package} v${item.version}` : `member ${item.repoKey} @ ${short(item.commit)}`);

/** Rows of every soul and capability of confirmed members (+ external souls) + locked package
 *  capabilities. Souls have no private mode (0.26.0); a private member capability is listed with
 *  `private: true` — repo-owned: usable only by its own repo's souls (E_CAPABILITY_PRIVATE). */
function workspaceItems(discovery, lock) {
  const souls = [];
  const capabilities = [];
  for (const m of discovery.members) {
    if (!m.confirmed && !(discovery.standalone === true && m.key === discovery.key)) continue;
    for (const s of m.souls) souls.push({ name: s.name, origin: originOf(s), kind: "member", repoKey: s.repoKey, commit: s.commit, team: teamLabel(s.team), labels: [...(s.labels ?? (s.team ? [s.team] : []))], private: s.private, path: s.path, work: s.definition.work ?? null, description: s.definition.description ?? null });
    for (const c of m.capabilities) capabilities.push({ name: c.name, origin: originOf(c), kind: "member", repoKey: c.repoKey, commit: c.commit, team: teamLabel(c.team), private: c.private, path: c.path, layer: c.manifest.layer ?? null, version: c.manifest.version ?? null });
  }
  for (const ext of discovery.external || []) {
    const s = ext.soul;
    souls.push({ name: s.name, origin: `external ${s.repoKey} @ ${short(s.commit)}`, kind: "external", repoKey: s.repoKey, commit: s.commit, team: teamLabel(s.team), labels: [...(s.labels ?? (s.team ? [s.team] : []))], private: s.private, path: s.path, work: s.definition.work ?? null, description: s.definition.description ?? null });
  }
  for (const s of discovery.packageSouls || []) {
    souls.push({ name: s.name, qualifiedName: s.qualifiedName, origin: originOf(s), kind: "package", package: s.package, version: s.version, repoKey: s.repoKey, commit: s.commit, team: teamLabel(s.team), labels: [...(s.labels ?? [])], private: false, path: s.path, work: s.definition.work ?? null, description: s.definition.description ?? null });
  }
  for (const [id, entry] of Object.entries(lock?.packages || {})) {
    for (const name of entry.capabilities) capabilities.push({ name, origin: originOf({ package: id, version: entry.version }), kind: "package", package: id, version: entry.version, commit: entry.commit, team: teamLabel(null), private: false });
  }
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0);
  souls.sort(byName);
  capabilities.sort(byName);
  return { souls, capabilities };
}

/** Membership rows for `sync` / `workspace status`. */
function memberRows(discovery) {
  return discovery.members.map((m) => ({
    key: m.key, name: memberLabel(m.key), commit: m.commit ?? null, confirmed: m.confirmed, status: m.confirmed ? "confirmed" : m.reason, detail: m.detail ?? null, team: m.team ?? null,
    souls: m.souls.map((s) => s.name), capabilities: m.capabilities.map((c) => c.name), publishes: m.publishes ?? null,
  }));
}

/** Package rows for `sync` / `workspace status` from the lock. */
function packageRows(lock) {
  return Object.entries(lock.packages).map(([id, p]) => ({ id, version: p.version, source: p.source, commit: p.commit, integrity: p.integrity, capabilities: p.capabilities, souls: (p.souls ?? []).map((x) => x.name) }));
}

/** Print a padded table: rows are arrays of strings. */
function printTable(header, rows) {
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((r) => String(r[i] ?? "").length)));
  for (const r of all) console.log("  " + r.map((c, i) => String(c ?? "").padEnd(widths[i])).join("  ").trimEnd());
}

/** `--approve` left with package approval (human decision 2026-09-24). */
const APPROVAL_REMOVED = "package approval was removed; declaring a package in packages: is the trust decision";

/** The body of `oats sync` — shared by `sync` and `onboard` (which onboards, then syncs the same
 * way). Given a v2 deployment context: discover over the remotes, confirm membership, resolve
 * `packages:` against the lock (commit + integrity), write the lock. There is no approval step:
 * declaring a package in `packages:` is the trust decision (human decision 2026-09-24).
 * `bail` never returns (it exits the process with the caller's error shape).
 * → { report, lock, discovery, items, lockFile, problems } */
async function performSync(ctx, bail, { onDiscovered } = {}) {
  if (args.includes("--approve")) return bail("E_BAD_ARGS", `--approve: ${APPROVAL_REMOVED}`, { flag: "--approve" });
  const catalog = catalogForSync(bail);
  const discovery = await discoverForCli(ctx, bail);
  onDiscovered?.(discovery);
  let previous;
  try { previous = readLock(ctx.deploymentDir); } catch (e) { return bail(e.code || "E_LOCK_SCHEMA", e.message, e.details); }
  let resolved;
  // Standalone: no workspace file → the only package request is the kernel's
  // default, at the catalog's pinned version (decision 25). A catalog that cannot
  // name it is a PROBLEM of this sync (reported, exit unchanged), not a silent empty lock.
  const standalone = discovery.standalone === true ? standalonePackages(catalog) : null;
  const packageSource = standalone ? { packages: standalone.packages } : discovery.workspace;
  const problems = [...discovery.problems, ...(standalone?.problems ?? [])];
  try { resolved = await resolvePackages(packageSource, { catalog, lock: previous, remoteOptions: ctx.remoteOptions }); }
  catch (e) {
    if (typeof e?.code === "string" && e.code.startsWith("E_")) return bail(e.code, e.message, e.details ?? e.provenance);
    throw e;
  }
  const lock = resolved.lock;
  let lockFile;
  try { lockFile = writeLock(ctx.deploymentDir, lock); } catch (e) { return bail(e.code || "E_LOCK_SCHEMA", e.message, e.details); }
  // Package souls come from the lock: list what THIS sync locked, not what the previous lock held.
  if (discovery.standalone !== true) {
    let pkg;
    try { pkg = await discoverPackageSouls(discovery.workspace, lock, { remoteOptions: ctx.remoteOptions }); }
    catch (e) { if (typeof e?.code === "string" && e.code.startsWith("E_")) return bail(e.code, e.message, e.details ?? e.provenance); throw e; }
    const kept = (list) => list.filter((p) => typeof p.package !== "string");
    discovery.packageSouls = pkg.souls;
    discovery.problems = [...kept(discovery.problems), ...pkg.problems];
    discovery.warnings = workspaceWarnings(discovery.workspace, discovery.members, discovery.external || [], pkg.souls);
    problems.splice(0, problems.length, ...kept(problems), ...pkg.problems);
  }
  // The deployment's instance root: <deployment>/agents/ (findRoot's marker). A hand-written
  // oats-local.yaml + sync is a complete deployment; spawn must not answer E_NO_DEPLOYMENT after it.
  try { mkdirSync(join(ctx.deploymentDir, "agents"), { recursive: true }); } catch { /* reported by spawn's E_NO_DEPLOYMENT remedy if it matters */ }
  const members = memberRows(discovery);
  const packages = packageRows(lock);
  const changes = resolved.changes;
  const items = workspaceItems(discovery, lock);
  const report = { syncApi: 1, standalone: discovery.standalone === true || undefined, workspace: { name: workspaceName(discovery), key: discovery.key, url: discovery.url, commit: discovery.commit, observedAt: discovery.observedAt, local: ctx.localPath, lock: lockFile }, members, packages, changes, problems, warnings: discovery.warnings ?? [] };
  return { report, lock, discovery, items, lockFile, problems };
}

/** The one-line standalone explanation (decision 10). `standaloneReason` says WHY the view is
 *  standalone: asked for (`standalone:` in oats-local.yaml) or forced (the host is unreadable —
 *  then the access failure is named). Never "cannot be read" when nothing was refused. */
function standaloneNote(discovery, { from = "" } = {}) {
  if (discovery?.standalone !== true) return null;
  const who = memberLabel(discovery.key);
  if (discovery.standaloneReason === "explicit") return `standalone view of ${who} (explicit in oats-local.yaml): its own souls + oats.core`;
  const hf = discovery.hostFailure;
  const why = hf ? ` (${hf.code ?? "E_REMOTE_UNREADABLE"}${hf.reason ? `: ${hf.reason}` : ""}${hf.url ? ` — ${hf.url}` : ""})` : "";
  return `standalone — the workspace of ${who} cannot be read${from}${why}; its own souls + oats.core`;
}

/** The human §8 report of a sync (text mode). */
function printSyncReport(ctx, synced) {
  const { report, discovery, items, lockFile } = synced;
  const { members, packages, changes } = report;
  const disabled = new Set(ctx.local.souls?.disabled || []);
  const isDisabled = (s) => disabled.has(s.name) || disabled.has(s.qualifiedName ?? `${memberLabel(s.repoKey)}/${s.name}`);
  console.log(`workspace  ${discovery.workspace?.name ?? `(${standaloneNote(discovery)})`}  (${discovery.key} @ ${short(discovery.commit)})`);
  console.log(`members    ${members.map((m) => m.confirmed ? `${m.name} ✓↔ (@ ${short(m.commit)})` : `${m.name} ✗ (${m.status})`).join("   ") || "(none)"}`);
  console.log(`packages   ${packages.map((p) => `${p.id} ${p.version} ✓ (@ ${short(p.commit)})`).join("   ") || "(none)"}`);
  const changed = changes.filter((c) => c.to !== null && c.from !== c.to).map((c) => `${c.id}  ${c.from ?? "—"} → ${c.to} (@ ${short(c.commit)})`);
  const removed = changes.filter((c) => c.to === null).map((c) => `${c.id}  ${c.from} → removed`);
  console.log(`changed    ${[...changed, ...removed].join("   ") || "(nothing — the lock already described this workspace)"}`);
  const memberSouls = items.souls.filter((s) => s.kind === "member");
  const externalSouls = items.souls.filter((s) => s.kind === "external");
  // Souls have no private mode (0.26.0); the private count is of repo-owned member capabilities.
  const repoOwned = items.capabilities.filter((c) => c.kind === "member" && c.private);
  const packageSouls = items.souls.filter((s) => s.kind === "package");
  const disabledHere = items.souls.filter(isDisabled);
  console.log(`souls      ${items.souls.length} discovered (${memberSouls.length} members, ${externalSouls.length} external, ${packageSouls.length ? `${packageSouls.length} package, ` : ""}${disabledHere.length} disabled here) · ${repoOwned.length} private capabilit${repoOwned.length === 1 ? "y" : "ies"}${repoOwned.length ? ` (${repoOwned.map((c) => `${c.name}, ${memberLabel(c.repoKey)} only`).join("; ")})` : ""}`);
  const teams = new Map();
  for (const s of items.souls) { const t = teams.get(s.team) || { souls: 0, capabilities: 0 }; t.souls++; teams.set(s.team, t); }
  for (const c of items.capabilities.filter((c) => c.kind === "member")) { const t = teams.get(c.team) || { souls: 0, capabilities: 0 }; t.capabilities++; teams.set(c.team, t); }
  console.log(`teams      ${[...teams.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([team, n]) => `${team} ${n.souls} soul${n.souls === 1 ? "" : "s"}${n.capabilities ? `, ${n.capabilities} capabilit${n.capabilities === 1 ? "y" : "ies"}` : ""}`).join(" · ") || "(none)"}`);
  for (const p of synced.problems ?? discovery.problems) console.log(`problem    ${p.code}  ${p.repoKey ? `${memberLabel(p.repoKey)}:` : ""}${p.path}  ${p.message}`);
  for (const w of discovery.warnings ?? []) console.log(`warning    ${w.code}  ${w.message}`);
  console.log(`\nlock       ${shortPath(lockFile)}`);
}

/** `oats sync [--dir] [--json]` — contract §6. */
async function syncCmd() {
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  const ctx = workspaceContext(bail);
  const synced = await performSync(ctx, bail);
  // One envelope (or the §8 report); success is exit 0 (a failure bails with its code).
  if (JSON_MODE) jsonOk(synced.report); else printSyncReport(ctx, synced);
}

/** Walk up from dir for oats-workspace.yaml INSIDE a Git checkout → { file, root } | null. */
function workspaceCheckoutFrom(dir) {
  let current = resolve(dir);
  for (;;) {
    const candidate = join(current, "oats-workspace.yaml");
    if (existsSync(candidate)) {
      // The file is edited in place only when it is TRACKED by the checkout it sits in (an untracked
      // copy inside some repository is not the shared workspace file).
      let inCheckout = false;
      for (let d = current; ; d = dirname(d)) { if (existsSync(join(d, ".git"))) { inCheckout = true; break; } if (dirname(d) === d) break; }
      if (!inCheckout) return null;
      const tracked = spawnSync("git", ["-C", current, "ls-files", "--error-unmatch", "--", "oats-workspace.yaml"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000 });
      return tracked.status === 0 ? { file: candidate, root: current } : null;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** `oats package add <id> <version|git:<repo>@<ref>> | remove <id> [--dir]` — contract §6. */
async function packageCmd() {
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  const sub = args[1];
  const id = args[2];
  const value = sub === "add" && typeof args[3] === "string" && !args[3].startsWith("--") ? args[3] : undefined;
  const usage = "usage: oats package add <id> <version|git:<repo>@<ref>> [--dir <d>] | oats package remove <id> [--dir <d>]";
  if (!["add", "remove"].includes(sub) || !id || id.startsWith("--")) return bail("E_USAGE", usage);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) return bail("E_WORKSPACE_SCHEMA", `package id ${JSON.stringify(id)} must match ^[a-z0-9][a-z0-9._-]*$`, { id });
  if (sub === "add") {
    if (!value || value.startsWith("--")) return bail("E_USAGE", usage);
    const c = classifyPackageValue(value);
    if (c.problem) return bail("E_WORKSPACE_SCHEMA", `packages.${id}: ${c.problem} (a package is a bare version like v2.1.3 or git:<repo>@<ref>)`, { id, value });
    if (c.kind === "git") { try { remoteModule.parseRepoRef(c.repo); } catch (e) { return bail(e.code || "E_REPO_REF", e.message, e.details ?? e.provenance); } }
  }
  const line = sub === "add" ? `  ${id}: ${YAML.stringify(value).trim()}` : null;
  const checkout = workspaceCheckoutFrom(dirFlag());
  if (!checkout) {
    // Untracked branch (the workspace file is shared through Git, not edited here). A `remove`
    // still checks the id against the DISCOVERED workspace when this directory realizes one
    // (oats-local.yaml): removing what is not declared is E_PACKAGE_MISSING, as in the tracked branch.
    if (sub === "remove") {
      let ctx = null; try { const found = loadLocal(dirFlag()); ctx = { dir: dirFlag(), localPath: found.path, local: found.local, deploymentDir: dirname(found.path), remoteOptions: remoteOptionsFromEnv() }; }
      catch (e) { if (e?.code !== "E_LOCAL_MISSING") return bail(e.code || "E_WORKSPACE_SCHEMA", e.message, e.details); }
      if (ctx) {
        const discovery = await discoverForCli(ctx, bail);
        const declared = discovery.standalone === true ? standalonePackages(catalogForSync(bail)).packages : (discovery.workspace?.packages || {});
        if (!Object.hasOwn(declared, id)) return bail("E_PACKAGE_MISSING", `packages.${id} is not declared by workspace ${workspaceName(discovery)} (${discovery.key} @ ${short(discovery.commit)})${discovery.standalone === true ? " — standalone: only the kernel's default package is requested" : ""}`, { id, workspace: discovery.key, declared: Object.keys(declared).sort() });
      }
    }
    if (JSON_MODE) { jsonOk({ action: sub, id, value: value ?? null, edited: false, file: null, line: sub === "add" ? `packages:\n${line}` : null, hint: "oats-workspace.yaml is not in this checkout; commit the change in the workspace repo, then `oats sync`" }); return; }
    if (sub === "add") console.log(`oats-workspace.yaml is not in this checkout. Add under packages: in the workspace repo, then \`oats sync\`:\n\npackages:\n${line}`);
    else console.log(`oats-workspace.yaml is not in this checkout. Remove \`${id}\` from packages: in the workspace repo, then \`oats sync\`.`);
    return;
  }
  const text = readFileSync(checkout.file, "utf8");
  let doc;
  try { doc = YAML.parseDocument(text, { keepSourceTokens: true }); } catch (e) { return bail("E_WORKSPACE_SCHEMA", `${checkout.file}: ${e.message}`, { path: checkout.file }); }
  if (doc.errors?.length) return bail("E_WORKSPACE_SCHEMA", `${checkout.file}: ${doc.errors.map((e) => e.message).join("; ")}`, { path: checkout.file });
  const root = doc.contents;
  if (!YAML.isMap(root)) return bail("E_WORKSPACE_SCHEMA", `${checkout.file}: top level must be a mapping`, { path: checkout.file, problems: [{ path: "", message: "top level must be a mapping" }] });
  const packagesNode = root.get("packages", true);
  if (packagesNode !== undefined && packagesNode !== null && !(YAML.isScalar(packagesNode) && packagesNode.value === null) && !YAML.isMap(packagesNode)) {
    return bail("E_WORKSPACE_SCHEMA", `${shortPath(checkout.file)}: packages: must be a mapping of <package-id>: <version>, found ${YAML.isSeq(packagesNode) ? "a sequence" : JSON.stringify(packagesNode.toJSON?.() ?? String(packagesNode))}`, { path: checkout.file, problems: [{ path: "/packages", message: "must be an object" }] });
  }
  const previous = YAML.isMap(packagesNode) ? packagesNode.toJSON() : null;
  const had = previous && Object.hasOwn(previous, id) ? previous[id] : undefined;
  if (sub === "add") {
    if (!YAML.isMap(packagesNode)) root.set("packages", doc.createNode({ [id]: value }));
    else packagesNode.set(id, value);
  } else {
    if (had === undefined) return bail("E_PACKAGE_MISSING", `packages.${id} is not in ${shortPath(checkout.file)}`, { id, path: checkout.file });
    root.get("packages").delete(id);
    if (root.get("packages")?.items?.length === 0) root.delete("packages");
  }
  const next = doc.toString();
  const problems = validateWorkspace(YAML.parse(next), { remote: remoteModule });
  if (problems.length) return bail("E_WORKSPACE_SCHEMA", `${shortPath(checkout.file)} would be invalid: ${problems.map((p) => `${p.path || "/"}: ${p.message}`).join("; ")}`, { path: checkout.file, problems });
  writeFileAtomic(checkout.file, next);
  const receipt = { action: sub, id, value: value ?? null, previous: had ?? null, edited: true, file: checkout.file };
  if (JSON_MODE) { jsonOk(receipt); return; }
  console.log(sub === "add"
    ? `${had === undefined ? "Added" : `Changed (${had} →)`} packages.${id}: ${value} in ${shortPath(checkout.file)}. Commit it, then \`oats sync\` (the lock resolves the version to a commit).`
    : `Removed packages.${id} (${had}) from ${shortPath(checkout.file)}. Commit it, then \`oats sync\`.`);
}

/** `oats workspace status [--dir] [--json]` — contract §6. */
async function workspaceCmd() {
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  if (args[1] !== "status") return bail("E_USAGE", "usage: oats workspace status [--dir <d>] [--json]");
  const ctx = workspaceContext(bail);
  const discovery = await discoverForCli(ctx, bail);
  let lock;
  try { lock = readLock(ctx.deploymentDir); } catch (e) { return bail(e.code || "E_LOCK_SCHEMA", e.message, e.details); }
  const members = memberRows(discovery);
  const packages = packageRows(lock);
  // Standalone (decision 10): there is no workspace file — the declared packages are the
  // kernel's own default (decision 25) and there are no teams.
  const standalone = discovery.standalone === true;
  const declared = Object.keys(standalone ? standalonePackages(catalogForSync(bail)).packages : (discovery.workspace?.packages || {})).sort();
  const locked = new Set(packages.map((p) => p.id));
  const unsynced = declared.filter((id) => !locked.has(id));
  const stale = packages.filter((p) => !declared.includes(p.id)).map((p) => p.id);
  const result = { workspaceStatusApi: 1, standalone: standalone || undefined, workspace: { name: workspaceName(discovery), key: discovery.key, url: discovery.url, commit: discovery.commit, observedAt: discovery.observedAt, local: ctx.localPath, teams: Object.keys(discovery.workspace?.teams || {}) }, members, packages, declaredPackages: declared, unsynced, stale, external: (discovery.external || []).map((e) => ({ source: e.source, soul: e.soul.name, team: teamLabel(e.soul.team) })), problems: discovery.problems, warnings: discovery.warnings ?? [] };
  if (JSON_MODE) { jsonOk(result); return; }
  console.log(`workspace ${workspaceName(discovery)}  (${discovery.key} @ ${short(discovery.commit)})  local ${shortPath(ctx.localPath)}\n`);
  if (standalone) console.log(`  (${standaloneNote(discovery)})\n`);
  console.log("Members:");
  printTable(["member", "status", "commit", "team", "souls", "capabilities", "publishes"], members.map((m) => [m.name, m.status, short(m.commit), m.team ?? "—", m.souls.join(",") || "—", m.capabilities.join(",") || "—", m.publishes ? `${m.publishes.package} v${m.publishes.version ?? "?"}` : "—"]));
  for (const m of members.filter((m) => !m.confirmed)) console.log(`    ${m.name}: ${m.detail}`);
  console.log("\nPackages:");
  if (!packages.length) console.log(unsynced.length ? `  (none locked yet — \`oats sync\` resolves ${unsynced.join(", ")})` : "  (none)");
  else printTable(["package", "version", "source", "commit", "capabilities", "souls"], packages.map((p) => [p.id, p.version, p.source, short(p.commit), p.capabilities.join(","), p.souls.join(",") || "—"]));
  if (packages.length && unsynced.length) console.log(`  declared but not locked (run \`oats sync\`): ${unsynced.join(", ")}`);
  if (stale.length) console.log(`  locked but no longer declared (run \`oats sync\`): ${stale.join(", ")}`);
  if (result.external.length) console.log(`\nExternal: ${result.external.map((e) => `${e.soul} (${e.source.replace(/@([0-9a-f]{40})$/, (_, o) => `@${short(o)}`)}, ${e.team})`).join("   ")}`);
  if (discovery.problems.length) { console.log("\nProblems:"); for (const p of discovery.problems) console.log(`  ${p.code}  ${p.repoKey ? `${memberLabel(p.repoKey)}:` : ""}${p.path}  ${p.message}`); }
  if (discovery.warnings?.length) { console.log("\nWarnings:"); for (const w of discovery.warnings) console.log(`  ${w.code}  ${w.message}`); }
}

/** `oats capabilities` / `oats souls` [--dir] [--json] — contract §6. */
async function itemsCmd(kind) {
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  const ctx = workspaceContext(bail);
  const discovery = await discoverForCli(ctx, bail);
  let lock;
  try { lock = readLock(ctx.deploymentDir); } catch (e) { return bail(e.code || "E_LOCK_SCHEMA", e.message, e.details); }
  const items = workspaceItems(discovery, lock)[kind];
  const standalone = discovery.standalone === true;
  if (JSON_MODE) { jsonOk({ [`${kind}Api`]: 1, standalone: standalone || undefined, workspace: { name: workspaceName(discovery), key: discovery.key, commit: discovery.commit }, [kind]: items, problems: discovery.problems }); return; }
  console.log(`${kind} of workspace ${workspaceName(discovery)} (${discovery.key} @ ${short(discovery.commit)})${standalone ? `  — ${standaloneNote(discovery)}` : ""}\n`);
  if (!items.length) console.log("  (none)");
  else if (kind === "souls") printTable(["name", "origin", "team", "work"], items.map((s) => [s.name, s.origin, s.labels?.length > 1 ? s.labels.join(",") : s.team, s.work ?? "—"]));
  else printTable(["name", "origin", "team", "layer"], items.map((c) => [c.private ? `${c.name} (repo-owned)` : c.name, c.origin, c.team, c.layer ?? "—"]));
  const unsynced = Object.keys(discovery.workspace?.packages || {}).filter((id) => !lock.packages[id]);
  if (kind === "capabilities" && unsynced.length) console.log(`\n  package capabilities of ${unsynced.join(", ")} appear after \`oats sync\``);
}

// ---------- roster: status / spawn / retire / create ----------
/** Workspace drift for `oats status` (decision 17: shown, not prevented). ONE discovery over
 *  the remotes serves every instance; `driftOf` compares each instance's recorded modules to
 *  the members' current state (and package modules to the lock), `soulDriftOf` the instance's
 *  recorded SOUL SOURCE (instance.json.workspace.soul) to its member's current commit. Offline →
 *  { unreachable }. Returns null when the deployment is not a workspace deployment (no
 *  oats-local.yaml). `souls` maps each workspace soul NAME (agents/<name>/.oats-soul-source.json
 *  present) to its stamp — the roster's `repo:` column for a workspace soul. */
async function statusDrift(data) {
  let ctx;
  try { ctx = loadLocal(dirFlag()); }
  catch (e) {
    if (e?.code === "E_LOCAL_MISSING") return null;
    // A 0.25 oats-config.yaml inside the deployment: the typed migration error, never a stack.
    if (e?.code === "E_CONFIG_BROKEN") { if (JSON_MODE) jsonFail(e.code, e.message, e.details); die(e.message); }
    throw e;
  }
  const hasModules = (i) => i.modules && typeof i.modules === "object" && Object.keys(i.modules).length > 0;
  const hasSoul = (i) => i.workspace && typeof i.workspace === "object" && i.workspace.soul && typeof i.workspace.soul === "object" && typeof i.workspace.soul.repoKey === "string";
  // Workspace souls of this roster: the stamp ensureWorkspaceSoul leaves beside the soul pointer.
  const souls = new Map();
  for (const a of data) {
    if (!a.dir) continue;
    try { const stamp = JSON.parse(readFileSync(join(a.dir, ".oats-soul-source.json"), "utf8")); if (stamp && typeof stamp.repoKey === "string") souls.set(a.name, { repoKey: stamp.repoKey, commit: typeof stamp.commit === "string" ? stamp.commit : null, path: stamp.path ?? null, ...(typeof stamp.package === "string" ? { package: stamp.package, version: stamp.version ?? null } : {}) }); }
    catch { /* not a workspace soul (classic, capability agent, or unreadable stamp) */ }
  }
  const anything = data.some((a) => (a.instances || []).some((i) => hasModules(i) || hasSoul(i)));
  if (!anything) return { drift: new Map(), soul: new Map(), souls, unreachable: null };
  const deploymentDir = dirname(ctx.path);
  let lock = null;
  try { if (existsSync(join(deploymentDir, LOCK_FILE))) lock = readLock(deploymentDir); } catch { lock = null; }
  let discovery;
  // The standalone view (decisions 10/25) is a discovery too: drift of a standalone
  // instance is computed against its member's current state, not reported "unreachable".
  try { const { discoverOrStandalone } = await import("../lib/instance-resolution.mjs"); discovery = await discoverOrStandalone(ctx.local, { lock, remoteOptions: remoteOptionsFromEnv() }); }
  catch (e) {
    const reason = e?.details?.reason ? `${e.code}: ${e.details.reason}` : (e?.code || e?.message || "unknown");
    return { drift: new Map(), soul: new Map(), souls, unreachable: { code: e?.code ?? null, reason, message: e?.message ?? String(e) } };
  }
  const { driftOf, soulDriftOf } = await import("../lib/materialize.mjs");
  const drift = new Map();
  const soul = new Map();
  for (const a of data) for (const i of a.instances || []) {
    const key = i.home ?? `${a.name}/${i.instance}`;
    if (hasModules(i)) { try { drift.set(key, driftOf(i, discovery, { lock })); } catch { /* an unreadable module record shows as no drift rows */ } }
    if (hasSoul(i)) { try { const row = soulDriftOf(i, discovery); if (row) soul.set(key, row); } catch { /* an unreadable soul record shows as no soul row */ } }
  }
  // The roster's soul row reflects the CURRENT member commit too (the pointer may lag a moved member).
  for (const [, stamp] of souls) {
    if (typeof stamp.package === "string") { const now = (discovery.packageSouls || []).find((p) => p.package === stamp.package && p.path === stamp.path); if (now) stamp.current = now.commit; continue; }
    const member = discovery.members.find((m) => m && m.key === stamp.repoKey);
    if (member && typeof member.commit === "string" && (member.confirmed || (discovery.standalone === true && member.key === discovery.key))) stamp.current = member.commit;
  }
  return { drift, soul, souls, unreachable: null };
}
/** One `modules:` line per module. */
function driftLine(row) {
  const from = row.from || {};
  const origin = from.kind === "package" ? `package ${from.package} v${from.version}` : memberLabel(row.recorded?.repoKey ?? from.repoKey ?? "?");
  const base = `modules: ${row.module} from ${origin} @ ${short7(row.recorded?.commit)}`;
  if (row.status === "moved") return `${base}  [${from.kind === "package" ? "package" : "member"} moved since (now @ ${short7(row.current?.commit)})]`;
  if (row.status === "missing") return `${base}  [${row.reason === "capability-absent" ? "capability no longer present" : row.reason === "package-absent" ? "package no longer locked" : `member ${row.reason || "unconfirmed"}`}]`;
  return base;
}
/** The `soul:` line of an instance — decision 17 for the soul source. */
function soulDriftLine(row, agentName) {
  if (row.package) {
    const base = `soul: ${row.name ?? agentName} from package ${row.package} v${row.version} @ ${short7(row.commit)}`;
    if (row.status === "moved") return `${base}  [package moved since (now v${row.current?.version} @ ${short7(row.current?.commit)})]`;
    if (row.status === "missing") return `${base}  [${row.reason === "soul-absent" ? "soul no longer shipped by the package" : "package no longer locked"}]`;
    return base;
  }
  const base = `soul: ${row.name ?? agentName} from ${memberLabel(row.repoKey)} @ ${short7(row.commit)}`;
  if (row.status === "moved") return `${base}  [member moved since (now @ ${short7(row.current?.commit)})]`;
  if (row.status === "missing") return `${base}  [${row.reason === "soul-absent" ? "soul no longer present" : `member ${row.reason || "unconfirmed"}`}]`;
  return base;
}
/** The roster's `[work: …, repo: …]` for a soul: a workspace soul names its member and commit. */
function soulRepoLabel(a, ws) {
  const stamp = ws?.souls?.get(a.name);
  if (!stamp) return a.repo || "?";
  if (typeof stamp.package === "string") return `package ${stamp.package} v${stamp.version} @ ${short7(stamp.commit)}`;
  const moved = stamp.current && stamp.commit && stamp.current !== stamp.commit ? ` (member now @ ${short7(stamp.current)})` : "";
  return `${memberLabel(stamp.repoKey)} @ ${short7(stamp.commit)}${moved}`;
}
const short7 = (oid) => (typeof oid === "string" ? oid.slice(0, 7) : "?");

async function status() {
  if (args.includes("--team")) { const msg = "status --team was removed with the classic team scope: `oats status` in the deployment lists every instance, and `oats workspace status` shows the members"; if (JSON_MODE) jsonFail("E_BAD_ARGS", msg); die(msg); }
  let root;
  try { root = ensureRoot(dirFlag()); }
  catch (e) { if (e?.code === "E_NO_DEPLOYMENT") { if (JSON_MODE) jsonFail("E_NO_DEPLOYMENT", e.message, e.details ?? e.provenance); die(e.message); } throw e; }
  const data = listInstances(root);
  const ws = await statusDrift(data);
  const verbose = args.includes("--verbose");
  const problems = legacyLayoutProblems(root);
  if (args.includes("--json")) {
    if (ws) for (const a of data) {
      const stamp = ws.souls.get(a.name);
      if (stamp) a.soulSource = { repoKey: stamp.repoKey, commit: stamp.commit, path: stamp.path, ...(stamp.current ? { current: stamp.current, status: stamp.current === stamp.commit ? "current" : "moved" } : {}) };
      for (const i of a.instances || []) {
        const key = i.home ?? `${a.name}/${i.instance}`;
        const rows = ws.drift.get(key);
        if (rows) i.modules = rows.map((r) => ({ name: r.module, from: r.from, commit: r.recorded?.commit ?? null, current: r.current, status: r.status, ...(r.reason ? { reason: r.reason } : {}) }));
        const s = ws.soul.get(key);
        if (s) i.soul = { repoKey: s.repoKey, commit: s.commit, current: s.current?.commit ?? null, status: s.status, ...(s.reason ? { reason: s.reason } : {}), ...(s.package ? { package: s.package, version: s.version, currentVersion: s.current?.version ?? null } : {}) };
      }
    }
    console.log(JSON.stringify({ root, agents: data, ...(ws ? { workspace: ws.unreachable ? { reachable: false, ...ws.unreachable } : { reachable: true } } : {}), ...(problems.length ? { problems } : {}), ...envelopeWarnings() }, null, 2)); return;
  }
  console.log(`oats status — agents root ${shortPath(root)}\n`);
  if (ws?.unreachable) console.log(`  workspace: unreachable (${ws.unreachable.reason}) — drift unknown\n`);
  for (const p of problems) console.log(`  ! ${p.code}: ${p.message}\n`);
  if (data.length === 0) { console.log("  (no agents — a soul is a member repository's souls/<name>; `oats souls` lists the workspace's)"); return; }
  for (const a of data) {
    console.log(`  ${a.name}  [work: ${a.work || "checkout"}, repo: ${soulRepoLabel(a, ws)}]`);
    if (a.description) console.log(`      ${a.description}`);
    for (const i of a.instances) {
      console.log(`      • ${i.instance}  ${i.retirePending ? "RETIRING" : i.running ? "RUNNING" : "idle"}  (branch ${i.branch || "?"}, ${i.work || "?"})`);
      const key = i.home ?? `${a.name}/${i.instance}`;
      if (i.identity) console.log(`          identity: ${servedIdentityLine(i.identity)}`);
      const s = ws?.soul.get(key);
      if (s && (verbose || s.status !== "current")) console.log(`          ${soulDriftLine(s, a.name)}`);
      const rows = ws?.drift.get(key) || [];
      for (const r of rows) if (verbose || r.status !== "current") console.log(`          ${driftLine(r)}`);
    }
    for (const f of a.retireFailures || []) {
      console.log(`      ! deferred retirement of ${f.instance} FAILED${f.completedAt ? ` at ${f.completedAt}` : ""}: ${f.error || (f.incomplete || []).join("; ") || "see result file"} — retry with \`oats retire ${f.instance}\``);
    }
  }
}

async function spawnCmd() {
  // JSON mode: contract envelope, stable error codes, stderr-only progress.
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  const note = (msg) => (JSON_MODE ? console.error(msg) : console.log(msg));
  const yolo = yoloFlag();
  const backend = valueFlag("backend"), herdrSocket = valueFlag("herdr-socket");
  if (backend !== undefined && !["tmux", "herdr"].includes(backend)) bail("E_BAD_ARGS", "--backend must be tmux or herdr");
  const requestedWork = valueFlag("work");
  const workDir = valueFlag("work-dir"), branch = valueFlag("branch"), repo = valueFlag("repo");
  const checkDirectoryOptions = (work) => {
    if (work === "directory" && (workDir !== undefined || branch !== undefined)) bail("E_BAD_ARGS", "--work directory owns only <home>/work; --work-dir and --branch are not allowed");
  };
  checkDirectoryOptions(requestedWork); // before anything is resolved or written
  const name = args[1];
  if (!name || name.startsWith("--")) bail("E_USAGE", "usage: oats spawn <agent> [--task <text>|--task-file <f>] [--purpose <slug>|--name <slug>] [--preview] [--base <ref>] [--model <id>|@native-default] [--allow-child-spawns|--no-child-spawns] [--relation child|sibling|parent|unrelated --relative-to <instance> [--relative-root <agents-root>]] [--parent <instance>] [--repo <r>] [--work worktree|checkout|attached|workspace|directory] [--work-dir <owner-work>] [--harness pi|claude|codex] [--backend tmux|herdr] [--herdr-socket <path>] [--yolo|--no-yolo] [--model <m>] [--branch <b>] [--no-launch] [--json]");
  // Retired boundary flags (maintainer transport ruling): fail LOUDLY before
  // ANY side effect, including root discovery.
  // Local souls (local-agents/) are gone with the workspace model: a soul is a member
  // repository's souls/<name>, so spawn never writes one.
  for (const removed of ["instructions-file", "def-file"]) if (flag(removed) !== undefined) bail("E_BAD_ARGS", `--${removed} created a local soul under local-agents/, which the workspace model removed — author souls/<name>/soul.yaml + AGENTS.md in a member repository, then \`oats sync\``);
  if (args.includes("--instance")) bail("E_BAD_ARGS", "--instance was removed by the runtime-boundary ruling — use --purpose <slug> (deterministic <agent>-<purpose> naming) or --name <slug> (the exact instance name)");
  // --name <slug>: the exact, unprefixed instance name (human decision 2026-09-24).
  const nameFlag = flag("name");
  if (nameFlag === true) bail("E_BAD_ARGS", "--name needs an instance name (a slug: lowercase letters and digits, single dashes between them)");
  if (nameFlag !== undefined && flag("purpose") !== undefined) bail("E_BAD_ARGS", "--name and --purpose are mutually exclusive: --name is the exact instance name, --purpose derives <agent>-<purpose>");
  // The slug rule is checked here too, before any side effect (soul fetch).
  if (nameFlag !== undefined) { try { explicitInstanceName(String(nameFlag)); } catch (e) { bail(e.code, e.message); throw e; } }
  if (args.includes("--ephemeral")) bail("E_BAD_ARGS", "--ephemeral was removed by the runtime-boundary ruling — declare the agent in a capability manifest (agents:) for automatic ephemeral semantics");
  let root;
  // A spawn needs a workspace deployment (lead decision c3-1): no oats-local.yaml
  // in reach is E_LOCAL_MISSING, before anything else is read. The agents root is
  // then <deployment>/agents; an ambient root (the invoking agent's own
  // PI_AGENTS_ROOT / OATS_ROOT) never redirects it — a home outside
  // <deployment>/agents would have no derivable deployment.
  try { loadLocal(dirFlag()); } catch (e) { if (e?.code === "E_LOCAL_MISSING") bail("E_LOCAL_MISSING", `${e.message}: a spawn needs a workspace deployment — \`oats onboard\` creates one`, e.details); else bail(e.code || "E_WORKSPACE_SCHEMA", e.message, e.details); }
  delete process.env.PI_AGENTS_ROOT; delete process.env.OATS_ROOT;
  // A deployment without its agents/ root is E_NO_DEPLOYMENT, naming the remedy.
  try { root = ensureRoot(dirFlag()); }
  catch (e) { bail("E_NO_DEPLOYMENT", e.message || e); throw e; }
  const isPreview = args.includes("--preview");
  // --agents-root <abs>: the exact root the soul must live in (as inspect and
  // readiness take it) — the deployment's one agents root, or E_SOUL_UNKNOWN.
  const agentsRootFlag = flag("agents-root");
  if (agentsRootFlag !== undefined && (agentsRootFlag === true || !isAbsolute(String(agentsRootFlag)))) bail("E_BAD_ARGS", "--agents-root needs an absolute agents root");
  if (agentsRootFlag !== undefined && realOrResolved(String(agentsRootFlag)) !== realOrResolved(root)) bail("E_SOUL_UNKNOWN", `soul "${name}" is not at agents root ${String(agentsRootFlag)} (this scope's root is ${shortPath(root)})`);
  let agent = findAgent(root, name);
  // Workspace model: with an oats-local.yaml the soul is ALWAYS discovered over the
  // remotes and resolved (member = latest state, package = locked) — never
  // "whatever <agents-root>/<name>/soul/ happens to hold": that copy is a per-commit
  // cache (ensureWorkspaceSoul refreshes it when the member moved), so a second
  // spawn sees the member's CURRENT soul, not the first spawn's. A preview runs the
  // same read-only discovery+resolution and writes nothing: it reads the soul from
  // the per-commit cache, or fetches it to a temporary copy (reported as soulFetched).
  const providerPairs = [];
  for (let i = 0; i < args.length; i++) if (args[i] === "--provider") { if (!args[i + 1] || !args[i + 2]) bail("E_BAD_ARGS", "--provider needs <capability> <key>=<value>"); providerPairs.push([args[i + 1], args[i + 2]]); i += 2; }
  let wsPrepared, soulFetched = false, wsSoulUnknown = null, wsDiscovery;
  {
    let discovery = null;
    try {
      const { prepareInstance, ensureWorkspaceSoul, previewWorkspaceSoul, parseProviderFlags, discoverOrStandalone, agentDirOf } = await import("../lib/instance-resolution.mjs");
      const remoteOptions = remoteOptionsFromEnv();
      const { local, path: localPath } = loadLocal(dirFlag());
      discovery = wsDiscovery = await discoverOrStandalone(local, { deployment: dirname(localPath), remoteOptions });
      wsPrepared = await prepareInstance(dirFlag(), name, { spawn: { providers: parseProviderFlags(providerPairs) }, remoteOptions, discovery });
      const soulName = agentDirOf(wsPrepared.soulEntry);
      let soulDir;
      if (isPreview) {
        // A preview writes nothing in the deployment: the soul comes from the
        // per-commit cache when complete, else from a temporary fetch removed at exit.
        const pv = await previewWorkspaceSoul(wsPrepared, root);
        process.once("exit", pv.cleanup);
        soulDir = pv.soulDir; soulFetched = pv.fetched;
        agent = findAgentAt(root, soulName, soulDir);
      } else {
        const stampFile = join(root, soulName, ".oats-soul-source.json");
        const stampBefore = (() => { try { return JSON.parse(readFileSync(stampFile, "utf8")); } catch { return null; } })();
        soulDir = await ensureWorkspaceSoul(wsPrepared, root);
        soulFetched = !stampBefore || stampBefore.commit !== wsPrepared.soulEntry.commit || stampBefore.repoKey !== wsPrepared.soulEntry.repoKey;
        if (!agent || soulFetched || agent._dir !== dirname(soulDir)) agent = findAgent(root, soulName);
      }
      if (!agent) bail("E_SOUL_UNKNOWN", `soul "${name}" was fetched to ${shortPath(soulDir)} but is not readable as a soul there`);
      note(`(workspace soul: "${name}" from ${wsPrepared.soulEntry.repoKey} @ ${String(wsPrepared.soulEntry.commit).slice(0, 12)}${wsPrepared.soulEntry.team ? `, team ${wsPrepared.soulEntry.team}` : ""}${soulFetched ? "; soul source fetched" : ""})`);
    } catch (e) {
      // Standalone (decisions 10/25): the ONLY package request is the kernel's own
      // default; when the catalog cannot name it, say so instead of "add it to packages:"
      // (there is no workspace file to add it to).
      if (e?.code === "E_PACKAGE_MISSING" && discovery?.standalone === true) {
        const file = officialCatalogFile();
        bail(e.code, `${e.details?.capability ?? "oats.core"}: the catalog has no package providing oats.core (OATS_PACKAGE_CATALOG=${file}) — standalone spawns resolve only the kernel's default package from the catalog`, { ...(e.details ?? {}), standalone: true, reason: "no-catalog", catalog: file });
      }
      // Not a workspace soul: a capability-defined agent (a module's `agents:`
      // soul, resolved below from a materialized copy) may still answer to this name.
      if (e?.code === "E_SOUL_UNKNOWN" && !isPreview) { wsSoulUnknown = e; }
      else if (e?.code?.startsWith?.("E_")) bail(e.code, e.message, e.details);
      else throw e;
    }
  }
  if (agentsRootFlag !== undefined && !agent) bail("E_SOUL_UNKNOWN", `soul "${name}" is not at agents root ${String(agentsRootFlag)}`);
  if (isPreview && !agent) bail("E_SOUL_UNKNOWN", `soul "${name}" is not in ${shortPath(root)}; a preview never creates or imports a soul (known: ${listAgents(root).map((a) => a.name).join(", ") || "none"})`);
  // Capability agent (lead decision c3 Q1): a prepared spawn of its providing module only.
  let capabilityPrepared, capabilityPkg = null;
  if (!agent) {
    // Workspace model: the agent is declared by a capability some INSTANCE already
    // materialized (the --parent home first, then any home under this root) —
    // OKF's memory-harvest worker spawned by a knowledge source, for example.
    const anchorName = flag("parent") || flag("relative-to");
    const anchorHome = anchorName ? (findInstanceHome(root, String(anchorName)) ?? null) : null;
    let modAgent;
    try { modAgent = findModuleCapabilityAgent(root, name, { anchorHome }); }
    catch (e) { bail(e.code || "E_CAPABILITY_BROKEN", e.message, e.details); }
    if (modAgent) {
      agent = modAgent;
      note(`(capability agent: "${name}" from ${modAgent.capability}, materialized in ${shortPath(modAgent._manifestSource)} — fresh soul, instances home under ${shortPath(join(root, name, "instances"))})`);
    } else {
      // No instance carries it: resolve from the deployment's LOCK — a locked
      // package whose capability declares agents/<name> is fetched into the
      // deployment's module store and read from there.
      try {
        const { resolvePackageCapabilityAgent } = await import("../lib/instance-resolution.mjs");
        const hit = await resolvePackageCapabilityAgent(dirFlag(), name, { remoteOptions: remoteOptionsFromEnv(), discovery: wsDiscovery, catalog: (() => { try { return officialPackageCatalog(); } catch { return null; } })() });
        if (hit) {
          agent = capabilityAgentFromDir(hit.dir, name, root, { module: { from: { kind: "package", package: hit.package, version: hit.version, commit: hit.commit } } });
          if (agent) { capabilityPkg = hit; note(`(capability agent: "${name}" from ${hit.capability} — package ${hit.package} v${hit.version}, fetched to ${shortPath(hit.dir)} — fresh soul, instances home under ${shortPath(join(root, name, "instances"))})`); }
        }
      } catch (e) { if (e?.code?.startsWith?.("E_")) bail(e.code, e.message, e.details); throw e; }
    }
    if (agent) {
      try {
        const { prepareCapabilityAgent } = await import("../lib/instance-resolution.mjs");
        capabilityPrepared = await prepareCapabilityAgent(dirFlag(), agent, { discovery: wsDiscovery, pkg: capabilityPkg, remoteOptions: remoteOptionsFromEnv(), catalog: (() => { try { return officialPackageCatalog(); } catch { return null; } })() });
      } catch (e) { if (e?.code?.startsWith?.("E_")) bail(e.code, e.message, e.details); throw e; }
    }
  }
  if (!agent && wsSoulUnknown) bail(wsSoulUnknown.code, wsSoulUnknown.message, wsSoulUnknown.details);
  checkDirectoryOptions(requestedWork || agent?.work);
  if (!agent) bail("E_UNKNOWN_AGENT", `unknown agent "${name}" (known: ${listAgents(root).map((a) => a.name).join(", ") || "none"}) — a soul is a member repository's souls/<name>; add it there and run \`oats sync\``);
  for (const information of agent.notes || []) note(`[${information.code}] ${information.message}`);
  // Lineage is explicit: --relation child|sibling|parent|unrelated anchors the new
  // instance to --relative-to <instance>. --parent X is sugar for
  // --relative-to X --relation child (agents spawning sub-agents pass their own
  // name, e.g. --parent "$OATS_INSTANCE"). Without a relation, the spawn is
  // operator-origin and lands top-level — ambient env vars in the shell are
  // never treated as parentage.
  const parent = flag("parent");
  if (parent !== undefined && (parent === true || !String(parent).trim())) bail("E_BAD_ARGS", "--parent needs an instance name");
  let relation = flag("relation");
  if (relation !== undefined && (relation === true || !String(relation).trim())) bail("E_BAD_ARGS", "--relation needs a value: child|sibling|parent|unrelated");
  if (relation && !RELATIONS.includes(relation)) bail("E_BAD_ARGS", `unknown --relation "${relation}" (child|sibling|parent|unrelated)`);
  let relativeTo = flag("relative-to");
  if (relativeTo !== undefined && (relativeTo === true || !String(relativeTo).trim())) bail("E_BAD_ARGS", "--relative-to needs an instance name");
  if (relation && relation !== "unrelated" && !relativeTo) bail("E_BAD_ARGS", `--relation ${relation} requires --relative-to <instance>`);
  if (relativeTo && !relation) bail("E_BAD_ARGS", "--relative-to requires --relation child|sibling|parent");
  if (relation === "unrelated" && relativeTo) bail("E_BAD_ARGS", "--relation unrelated takes no --relative-to");
  if (parent && (relation || relativeTo)) bail("E_BAD_ARGS", "--parent is sugar for --relative-to <instance> --relation child — use one form, not both");
  if (parent) { relation = "child"; relativeTo = parent; }
  // Attached agents are ALWAYS children (design decision): the only relation
  // flags allowed are the child form — required when the workDir is not an
  // instance's own <home>/work (integration worktrees). The kernel verifies
  // ownership canonically (including soul-default attached mode).
  if ((flag("work") === "attached") && relation && relation !== "child") bail("E_BAD_ARGS", "attached agents are always children of the work-tree owner — only --parent <instance> (or --relation child) is valid with --work attached");
  // NOTE: explicit "unrelated" is passed through to the kernel.
  if (relativeTo && relation !== "unrelated") {
    // findInstanceHome also sees capability-defined agents' instance homes
    // (<root>/<name>/ without a soul) — e.g. a reviewer passing
    // --parent "$OATS_INSTANCE" from a capability agent.
    if (!findInstanceHome(root, relativeTo)) bail(parent ? "E_PARENT_NOT_FOUND" : "E_RELATIVE_NOT_FOUND", `${parent ? "--parent" : "--relative-to"} "${relativeTo}" does not match any known instance`);
  }
  const taskText = flag("task");
  if (taskText === true) bail("E_BAD_ARGS", "--task needs a value (use --task-file for long tasks)");
  const taskFileFlag = flag("task-file");
  if (taskFileFlag === true) bail("E_BAD_ARGS", "--task-file needs a path");
  if (taskFileFlag && !existsSync(taskFileFlag)) bail("E_BAD_ARGS", `--task-file not found: ${taskFileFlag}`);
  // --trigger-event <file>: the event a trigger spawns this instance for (lib/triggers.mjs). It is
  // copied to <home>/.oats/trigger-event.json (OATS_TRIGGER_EVENT_FILE) and recorded as instance.json.trigger.
  let triggerEvent;
  { const f = flag("trigger-event");
    if (f === true) bail("E_BAD_ARGS", "--trigger-event needs a path");
    if (f !== undefined) {
      if (!existsSync(f)) bail("E_BAD_ARGS", `--trigger-event not found: ${f}`);
      try { triggerEvent = JSON.parse(readFileSync(f, "utf8")); } catch (e) { bail("E_BAD_ARGS", `--trigger-event is not valid JSON: ${e.message}`); }
      const ok = triggerEvent && typeof triggerEvent === "object" && !Array.isArray(triggerEvent) && typeof triggerEvent.trigger === "string" && typeof triggerEvent.source === "string" && typeof triggerEvent.repo === "string" && Number.isInteger(triggerEvent.number) && typeof triggerEvent.event === "string";
      if (!ok) bail("E_BAD_ARGS", "--trigger-event must hold { trigger, source, repo, number, url, event, headSha, labels, observedAt }");
    } }
  const relativeRoot = flag("relative-root");
  if (relativeRoot !== undefined && (relativeRoot === true || !String(relativeRoot).trim())) bail("E_BAD_ARGS", "--relative-root needs an agents-root path");
  if (relativeRoot && !relativeTo) bail("E_BAD_ARGS", "--relative-root only qualifies --relative-to/--parent");
  // Wake at launch: --wake-file <private JSON {cron, tz, message, enabled}>
  // is the backend bridge; --wake-every/--wake-cron/--wake-tz/--wake-message
  // (or --wake-message-file) are the human sugar for the same object. The
  // wake job is saved AFTER a successful spawn, bound to the returned home.
  let wake;
  try {
    const wakeFile = flag("wake-file");
    if (wakeFile === true) bail("E_BAD_ARGS", "--wake-file needs a path");
    const wakeJson = flag("wake-json");
    if (wakeJson === true) bail("E_BAD_ARGS", "--wake-json needs the wake object as JSON text");
    if (wakeJson) {
      let doc; try { doc = JSON.parse(wakeJson); } catch (e) { bail("E_SCHEDULE_INVALID", `--wake-json is not valid JSON: ${e.message}`); }
      if (!doc || typeof doc !== "object") bail("E_SCHEDULE_INVALID", "--wake-json must hold {cron, tz, message, enabled}");
      wake = { cron: doc.cron, tz: doc.tz, message: doc.message, enabled: doc.enabled === undefined ? true : doc.enabled };
    } else if (wakeFile) {
      if (!existsSync(wakeFile)) bail("E_BAD_ARGS", `--wake-file not found: ${wakeFile}`);
      let doc; try { doc = JSON.parse(readFileSync(wakeFile, "utf8")); } catch (e) { bail("E_SCHEDULE_INVALID", `--wake-file is not valid JSON: ${e.message}`); }
      if (!doc || typeof doc !== "object") bail("E_SCHEDULE_INVALID", "--wake-file must hold {cron, tz, message, enabled}");
      wake = { cron: doc.cron, tz: doc.tz, message: doc.message, enabled: doc.enabled === undefined ? true : doc.enabled };
    } else if (flag("wake-every") !== undefined || flag("wake-cron") !== undefined) {
      const mf = flag("wake-message-file");
      if (mf === true) bail("E_BAD_ARGS", "--wake-message-file needs a path");
      if (mf && !existsSync(mf)) bail("E_BAD_ARGS", `--wake-message-file not found: ${mf}`);
      const message = mf ? readFileSync(mf, "utf8") : flag("wake-message") === true ? undefined : flag("wake-message");
      wake = wakeFromFlags({ every: flag("wake-every") === true ? undefined : flag("wake-every"), cron: flag("wake-cron") === true ? undefined : flag("wake-cron"), tz: flag("wake-tz") === true ? undefined : flag("wake-tz"), message });
    }
    if (wake && (typeof wake.message !== "string" || !wake.message.trim())) bail("E_SCHEDULE_INVALID", "wake message: non-empty text is required");
  } catch (e) { if (e?.code?.startsWith?.("E_")) bail(e.code, e.message); throw e; }
  // Workspace model: when this deployment has an oats-local.yaml, the soul's
  // capabilities are resolved over the workspace's remotes (member = latest,
  // package = locked) and copied whole into the new home. Without one
  // (a bare agents root, tests) the classic soul-directory spawn proceeds.
  let prepared;
  // Workspace model: a `work: worktree|checkout` soul works IN its member's clone on
  // this machine (design doc §4): --repo, else oats-local.yaml `clones:`, else the
  // convention <deployment>/<member name>. Never an ambient Git checkout around the
  // deployment. Resolved once here so a preview sees exactly what the apply would.
  let preparedRepo;
  if (wsPrepared || capabilityPrepared) {
    try {
      const { toCapabilityRows, modulesPreview, requireMemberClone } = await import("../lib/instance-resolution.mjs");
      prepared = wsPrepared ?? capabilityPrepared;
      prepared.capabilityRows = []; // filled after materialization (paths live in the home); preview uses modulesPreview
      prepared.preview = modulesPreview(prepared.resolution, root, agent.name);
      prepared.toCapabilityRows = toCapabilityRows;
      const effectiveWork = requestedWork || agent.work || "checkout";
      if (effectiveWork === "worktree" || effectiveWork === "checkout") preparedRepo = requireMemberClone(prepared, { explicit: repo });
    } catch (e) { if (e?.code?.startsWith?.("E_")) bail(e.code, e.message, e.details); throw e; }
  }
  let r;
  try {
    if (args.includes("--allow-child-spawns") && args.includes("--no-child-spawns")) bail("E_BAD_ARGS", "--allow-child-spawns and --no-child-spawns contradict");
    if (flag("base") === true) bail("E_BAD_ARGS", "--base needs a ref");
    { const spawnOpts = {
      prepared,
      purpose: flag("purpose"), ...(nameFlag !== undefined ? { name: String(nameFlag) } : {}), task: taskText, taskFile: taskFileFlag, relation, relativeTo, relativeRoot,
      ...(args.includes("--allow-child-spawns") ? { allowChildSpawns: true } : args.includes("--no-child-spawns") ? { allowChildSpawns: false } : {}),
      // Directory execution uses deployment configuration, not an ambient Git
      // checkout (especially when invoked via --dir from a source instance).
      // An attached instance's repository is its work tree owner's (derived by the kernel).
      repo: preparedRepo !== undefined ? preparedRepo : ["directory", "attached"].includes(requestedWork || agent.work)
        ? repo : repo || defaultRepo(workspaceOf(root)) || defaultRepo(process.cwd()),
      work: requestedWork, workDir, harness: harnessFlag(), backend, herdrSocket, yolo, model: flag("model"), branch,
      launchConfig: valueFlag("launch-config"),
      launch: !args.includes("--no-launch"),
      ...(triggerEvent ? { triggerEvent } : {}),
      // K6: --preview decides everything and touches nothing; --base <ref>
      // selects a worktree's start point; --model @native-default is the
      // explicit "harness's own default" (distinct from omitting --model).
      ...(args.includes("--preview") ? { preview: true, subject: { soul: name, agentsRoot: agentsRootFlag !== undefined ? String(agentsRootFlag) : null, dir: flag("dir") !== undefined && flag("dir") !== true ? String(flag("dir")) : null } } : {}),
      ...(flag("base") !== undefined && flag("base") !== true ? { baseRef: flag("base") } : {}),
      // A confirmed preview binds this apply (K6b): drift → E_DECISION_STALE, nothing created.
      ...(flag("expect-decision") !== undefined && flag("expect-decision") !== true ? { expectDecision: String(flag("expect-decision")) } : {}),
      // K6c: with --idempotency-key, a retry of the SAME confirmed decision replays the recorded home instead of spawning twice.
      ...(flag("idempotency-key") !== undefined && flag("idempotency-key") !== true ? { idempotencyKey: String(flag("idempotency-key")) } : {}),
    };
      r = await spawnInstanceAsync(root, agent, spawnOpts); }
    if (args.includes("--preview")) {
      // A workspace preview may have fetched the soul's SOURCE to a temporary copy
      // (the deployment's cache had no entry for its commit): the result says so.
      if (prepared) r.soulFetched = soulFetched;
      if (JSON_MODE) { jsonOk(r); return; }
      console.log(`preview ${r.agent} → ${r.instance} (${r.work}${r.branch ? `, branch ${r.branch} from ${r.base.ref}@${r.base.oid.slice(0, 12)}` : ""}) harness ${r.harness}${r.model ? ` model ${r.model}` : ` (${r.modelSource})`}; nothing was created${soulFetched ? " (the soul source was fetched to a temporary copy, not kept)" : ""}`);
      return;
    }
  } catch (e) {
    // A typed CLI failure keeps ITS OWN code: re-badging an unsafe-config-key
    // (raised by the readers spawn walks) as E_SPAWN_FAILED tells an agent
    // consumer the spawn mechanism broke, when the fixable fact is a poisoned
    // document the message already names. The shared boundary renders it.
    if (TYPED_CLI_FAILURES.has(e?.code)) throw e;
    // A launch refusal (configuration, executable, environment reference,
    // model, harness) is a fact about the selection, not a spawn-mechanism
    // failure: it keeps its own code so a GUI can act on it.
    if (typeof e?.code === "string" && /^E_LAUNCH_|^E_MODEL_UNKNOWN$|^E_UNSUPPORTED_HARNESS$/.test(e.code)) { bail(e.code, e.message); throw e; }
    // An unmet declared requirement is a fact about the soul's configuration
    // (with a remedy), not a spawn-mechanism failure: keep its code and details.
    if (e?.code === "E_REQUIREMENT_INACTIVE") { bail(e.code, e.message, { soul: e.soul, capabilities: e.capabilities, context: e.context, remedy: e.remedy }); throw e; }
    if (e?.code === "E_CHILD_SPAWNS_DISABLED") { bail(e.code, e.message, { parent: e.parent, policy: e.policy }); throw e; }
    if (["E_BRANCH_EXISTS", "E_BASE_UNKNOWN"].includes(e?.code)) { bail(e.code, e.message); throw e; }
    // K6b: the confirmed decision drifted — the fresh decision travels with the refusal so a GUI re-previews.
    if (e?.code === "E_DECISION_STALE") { bail(e.code, e.message, { decision: e.decision }); throw e; }
    if (e?.code === "E_IDEMPOTENCY_CONFLICT") { bail(e.code, e.message, { instance: e.instance, home: e.home }); throw e; }
    if (e?.code === "E_PLACEMENT_TAKEN") { bail(e.code, e.message, { instance: e.instance, home: e.home }); throw e; }
    if (e?.code === "E_INSTANCE_NAME_TAKEN") { bail(e.code, e.message, { instance: e.instance, home: e.home ?? null, ...(e.session ? { session: e.session } : {}) }); throw e; }
    if (e?.code === "E_INSTANCE_NAME_INVALID") { bail(e.code, e.message); throw e; }
    if (e?.code === "E_SPAWN_INCOMPLETE") { bail(e.code, e.message, { instance: e.instance, home: e.home, launched: e.launched }); throw e; }
    bail(["E_BAD_ARGS", "E_RELATIVE_AMBIGUOUS"].includes(e.code) ? e.code : "E_SPAWN_FAILED", e.message || e); throw e;
  }
  // The instance exists from here on: a failed wake save is reported beside
  // the full receipt, never hidden, and never causes a second spawn.
  let wakeSchedule, wakeScheduleError;
  if (wake && r.replayed !== true) { // a replayed receipt re-saves nothing
    try { wakeSchedule = saveWakeForHome(scheduleScopeOf(workspaceOf(root)), { instance: r.instance, home: r.home, wake }); }
    catch (e) { wakeScheduleError = { code: e.code || "E_SCHEDULE_FAILED", message: e.message }; r.warnings = [...(r.warnings || []), `wake schedule NOT saved: ${e.message}`]; }
    // K6e: record the wake outcome in the home so a same-key replay can report
    // it instead of leaving "saved or not?" to inference.
    if (r.spawnIdempotencyKey) {
      try { const f = join(r.home, "instance.json"); const m = JSON.parse(readFileSync(f, "utf8")); m.wake = { requested: true, saved: !wakeScheduleError, error: wakeScheduleError ?? null }; writeFileSync(f, JSON.stringify(m, null, 2) + "\n"); r.wake = m.wake; } catch { /* the receipt still says it */ }
    }
  } else if (r.spawnIdempotencyKey && r.replayed !== true) {
    try { const f = join(r.home, "instance.json"); const m = JSON.parse(readFileSync(f, "utf8")); m.wake = { requested: false, saved: null, error: null }; writeFileSync(f, JSON.stringify(m, null, 2) + "\n"); r.wake = m.wake; } catch { /* nothing to record */ }
  }
  if (JSON_MODE) {
    // Desktop CLI API v1 spawn result — a FIXED shape (see docs/desktop-cli-api.md).
    jsonOk({
      instance: r.instance, agent: r.agent, home: r.home, work: r.work,
      branch: r.branch || null, launched: r.launched, warnings: r.warnings || [],
      ...(wakeSchedule ? { wakeSchedule } : {}), ...(wakeScheduleError ? { wakeScheduleError } : {}),
      tmux: r.tmux || null, repo: r.repo || null, harness: r.harness || null,
      model: r.model || null, parent: r.parentInstance || null,
      sibling: r.siblingInstance || null, relation: r.relation || null,
      spawnOrigin: r.spawnOrigin, attach: r.attach,
      ...(r.sessionTarget ? { sessionTarget: r.sessionTarget } : {}),
      ...(r.yolo !== undefined ? { yolo: r.yolo } : {}),
      // K6b/K6c: what bound this spawn, and whether this receipt is a replay of an earlier one.
      ...(r.decision ? { decision: r.decision } : {}), ...(r.replayed !== undefined ? { replayed: r.replayed } : {}),
      ...(r.wake !== undefined ? { wake: r.wake } : {}), // {requested, saved|null, error}: saved:null = outcome not recorded
      launchConfig: r.launch?.launchConfig ?? null, launch: r.launch || null, // already redacted by the kernel
    });
    return;
  }
  console.log(`Spawned ${r.instance} (${r.work}${r.branch ? `, branch ${r.branch}` : ""})${r.launched ? r.sessionTarget ? ` — Herdr pane "${r.sessionTarget.paneId}"` : ` — tmux window "${r.tmux.window}"` : " — not launched"}`);
  console.log(`  home:   ${shortPath(r.home)}`);
  if (wakeSchedule) console.log(`  wake:   schedule ${wakeSchedule.id} (${wakeSchedule.cron} ${wakeSchedule.tz}), next ${wakeSchedule.nextRun || "disabled"}`);
  if (wakeScheduleError) console.error(`  wake:   NOT saved — ${wakeScheduleError.message} (the instance is created and launched; add the wake by hand with oats schedule add)`);
  if (!r.launched) console.log(`  launch: oats session start --home ${shellQuote(r.home)}`);
  for (const w of r.warnings || []) console.log(`  WARNING: ${w}`);
  console.log(`  attach: ${r.attach}`);
}

function retireCmd() {
  const name = args[1];
  if (!name || name.startsWith("--")) die("usage: oats retire <instance> [--plan] [--plan-revision <rev> --idempotency-key <key>] [--home <path>] [--self] [--discard-worktree] [--delete-branch] [--keep-dir] [--force] [--json]");
  let homeFlag = flag("home");
  if (homeFlag === true) die("--home needs the instance home path");
  if (args.includes("--plan")) {
    // K3: what retirement would touch, with the design's defaults — read-only.
    dropAmbientRoot();
    let root; try { root = ensureRoot(dirFlag()); } catch (e) { return args.includes("--json") ? jsonFail(e.code || "E_NO_ROOT", e.message) : die(e.message); }
    try {
      const plan = planRetire(dirFlag(), root, name, { home: homeFlag });
      if (args.includes("--json")) { jsonOk(plan); return; }
      console.log(`retire ${name} — plan ${plan.planRevision}`);
      console.log(`  session ${plan.facts.session.state}; work ${plan.facts.work.observed ? `${plan.facts.work.changed} changed / ${plan.facts.work.untracked} untracked on ${plan.facts.work.branch ?? "detached"}` : `not observed (${plan.facts.work.reason})`}; children ${plan.facts.children.length}; pull request ${plan.facts.pullRequest}`);
      console.log(`  defaults: retain worktree ${plan.defaults.retainWorktree}, delete branch ${plan.defaults.deleteBranch}, stop children ${plan.defaults.stopChildren}`);
      for (const n of plan.notes) console.log(`  note: ${n}`);
      return;
    } catch (e) { return args.includes("--json") ? jsonFail(e.code || "E_LIFECYCLE_FAILED", e.message, e.candidates ? { ...e.details, candidates: e.candidates } : e.details) : die(e.message); }
  }
  // The calling instance knows its own home: self-retire never needs to
  // disambiguate a same-named twin by hand.
  if (homeFlag === undefined && process.env.OATS_INSTANCE_HOME && (process.env.PI_AGENT_INSTANCE === name || process.env.OATS_INSTANCE === name)) homeFlag = process.env.OATS_INSTANCE_HOME;
  const isSelf = process.env.PI_AGENT_INSTANCE === name || process.env.OATS_INSTANCE === name;
  if (isSelf && !args.includes("--self")) die(`"${name}" is the calling instance — self-retire is irreversible; if your task is complete and you were told to retire, re-run with --self (finish your memory files FIRST; your session dies ~8s after)`);
  if (!isSelf && args.includes("--self")) die(`--self given but "${name}" is not the calling instance`);
  const root = ensureRoot(dirFlag());
  const retiringHome = homeFlag || findInstanceHome(root, name);
  // K3: a GUI-driven Remove carries the plan revision it showed and an
  // idempotency key. The revision is revalidated against a fresh plan
  // (E_PLAN_STALE with that plan attached — re-confirm, never act on the old
  // one); a retried key replays the recorded receipt instead of retiring twice.
  const planRev = flag("plan-revision"), idemKey = flag("idempotency-key");
  if (planRev === true || idemKey === true) die("--plan-revision and --idempotency-key need values");
  if ((planRev !== undefined) !== (idemKey !== undefined)) die("--plan-revision and --idempotency-key go together");
  let replayPath = null, childrenStopped = null, expectedBranch;
  if (planRev !== undefined) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(idemKey)) die("--idempotency-key: 1-128 chars of [A-Za-z0-9._:-]");
    // Replay first: after a successful retire the home is gone, so the receipt
    // (beside the instances dir, keyed by the idempotency key) is the answer.
    const replay = (dir) => { const p = join(dir, `.oats-retire-receipt.${idemKey}.json`); if (!existsSync(p)) return false; try { const prior = JSON.parse(readFileSync(p, "utf8")); if (prior.retired !== name) return false; if (args.includes("--json")) jsonOk({ ...prior, replayed: true }); else console.log(`retire ${name}: replayed receipt for key ${idemKey}`); return true; } catch { return false; } };
    for (const a of listAgents(root)) if (replay(join(a._dir, "instances"))) return;
    let fresh;
    try { fresh = planRetire(dirFlag(), root, name, { home: homeFlag }); } catch (e) { return args.includes("--json") ? jsonFail(e.code || "E_LIFECYCLE_FAILED", e.message, e.details) : die(e.message); }
    replayPath = join(dirname(fresh.home), `.oats-retire-receipt.${idemKey}.json`);
    if (fresh.planRevision !== planRev) return args.includes("--json") ? jsonFail("E_PLAN_STALE", `the retire plan changed since it was shown (${planRev} → ${fresh.planRevision}); review the fresh plan`, { plan: fresh }) : die(`the retire plan changed since it was shown; re-run oats retire ${name} --plan`);
    // The plan promised: recorded children are STOPPED first (bounded, never
    // escalated) and retained. A child still running after the grace refuses
    // the retirement — nothing is retired, the receipt names the pid.
    childrenStopped = [];
    for (const kid of fresh.facts.children) {
      try { const s = stopInstanceSession(kid.home, {}); childrenStopped.push({ instance: kid.instance, home: kid.home, ok: true, stopped: s.stopped, alreadyIdle: s.alreadyIdle }); }
      catch (e) { childrenStopped.push({ instance: kid.instance, home: kid.home, ok: false, code: e.code || "E_SESSION_STOP_FAILED", message: e.message, stillRunning: e.receipt?.stillRunning ?? null }); }
    }
    const running = childrenStopped.filter((k) => !k.ok);
    if (running.length) return args.includes("--json") ? jsonFail("E_CHILDREN_RUNNING", `${running.map((k) => k.instance).join(", ")} ${running.length === 1 ? "is" : "are"} still running after a bounded stop; nothing was retired and nothing was escalated`, { childrenStopped, plan: fresh }) : die(`children still running: ${running.map((k) => k.instance).join(", ")}; nothing retired`);
    expectedBranch = fresh.facts.work.observed ? fresh.facts.work.branch : undefined;
  }
  let r;
  try { r = retireInstance(root, name, { home: homeFlag, self: isSelf, deleteBranch: args.includes("--delete-branch"), discardWorktree: args.includes("--discard-worktree"), keepDir: args.includes("--keep-dir"), force: args.includes("--force"), ...(expectedBranch !== undefined ? { expectedBranch } : {}) }); }
  catch (e) { if (!e?.code) throw e; return args.includes("--json") ? jsonFail(e.code, e.message, e.candidates ? { ...e.details, candidates: e.candidates } : e.details) : die(e.message); }
  if (childrenStopped) r.childrenStopped = childrenStopped;
  if (replayPath) { r.planRevision = planRev; r.idempotencyKey = idemKey; r.replayed = false; try { writeFileAtomic(replayPath, JSON.stringify(r, null, 2)); } catch { /* receipt is evidence, not authority */ } }
  // A retired home's wake jobs are forgotten (definitions only; nothing is
  // stopped by this); a deferred self-retire keeps them until the home is gone.
  if (retiringHome && r.removedDir !== false && !r.deferred) { try { const gone = removeWakeForHome(scheduleScopeOf(workspaceOf(root)), retiringHome); if (gone.length) r.wakeSchedulesRemoved = gone; } catch (e) { r.warnings = [...(r.warnings || []), `wake schedules not cleaned: ${e.message}`]; } }
  // Deferred self-retire: nothing has been inspected, run, or removed yet. The
  // caller's window dies first; a detached process then retires the instance
  // as an external operator and writes its outcome beside the home.
  if (r.deferred) {
    if (args.includes("--json")) { console.log(JSON.stringify(r, null, 2)); return; }
    console.log(`Retirement of ${r.retired} (agent ${r.agent}) is ${r.alreadyScheduled ? "already " : ""}scheduled — say any goodbyes now.`);
    console.log(`  in ~${r.completesInSec}s a detached completion quiesces this harness (that is what ends this window), preserves work, runs retire hooks and removes the home`);
    console.log(`  if the completion fails, this window stays, the failure shows in \`oats status\` and at ${shortPath(r.resultPath)}, and \`oats retire ${r.retired}\` retries it`);
    return;
  }
  // Forced removal past an incomplete cleanup: the home is gone because the
  // operator said so, but the external state it owed is still out there and
  // nobody else will mention it again.
  if (r.forcedIncomplete) {
    console.error(`Removed ${r.retired} under --force with cleanup INCOMPLETE — this external state was NOT cleaned up and is now yours to remove by hand:`);
    for (const f of r.forcedIncomplete) console.error(`  ${f}`);
  }
  if (args.includes("--json")) { console.log(JSON.stringify(r, null, 2)); if (r.rollbackIncomplete) process.exit(1); return; }
  // An unsuccessful cleanup retry must NOT read as a completed retirement: the
  // home and its external state are still there, and a zero exit would tell
  // both a human and any script that the work is done.
  if (r.rollbackIncomplete) {
    console.error(`Cleanup for ${r.retired} is INCOMPLETE — the instance home is retained at ${r.retainedHome} because external state may still exist:`);
    for (const f of r.rollbackIncomplete) console.error(`  ${f}`);
    console.error(`Fix the cause and re-run \`oats retire ${r.retired}\`; the home holds the state that cleanup needs.`);
    process.exit(1);
  }
  console.log(`Retired ${r.retired} (agent ${r.agent})${r.worktreeRemoved ? ", worktree removed" : ""}${r.branchDeleted ? ", branch deleted" : ""}`);
  // Preserving work and not saying so leaves the operator believing it is gone,
  // which is most of the harm of deleting it. Name the classes and the path.
  for (const recovery of r.workRecoveries || (r.workRecovery ? [r.workRecovery] : [])) {
    console.log(`Work that was not committed has been preserved: ${recovery.classes.join(", ")}`);
    console.log(`  ${recovery.path}${typeof recovery.bytes === "number" ? ` (${formatBytes(recovery.bytes)})` : ""}`);
    for (const line of preservedOutputLines(recovery)) console.log(line);
  }
  for (const w of r.warnings || []) console.log(`  WARNING: ${w}`);
  if (isSelf) console.log("This window dies in ~8s — say any goodbyes now.");
}

/** `oats schedule ...`: workspace-scoped definitions, host-owned execution
 *  (lib/schedule.mjs). Every subcommand answers the envelope; nothing here
 *  launches unless a job is due or run-now is asked. */
function scheduleCmd() {
  const sub = args[1];
  const id = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
  // One schedule-owning scope for a directory: its deployment (the directory
  // holding oats-local.yaml), resolved when a subcommand needs it — inside the
  // try, so no deployment in reach is a typed refusal (E_LOCAL_MISSING).
  let scope;
  const ws = () => (scope ??= scheduleScopeOf(dirFlag()));
  const io = { hostStatus: () => hostUnitStatus() };
  const out = (result) => { if (JSON_MODE) jsonOk(result); else console.log(JSON.stringify(result, null, 2)); };
  const readSpec = () => {
    const inline = flag("spec-json");
    if (inline && inline !== true) { try { return JSON.parse(inline); } catch (e) { throw scheduleError("E_SCHEDULE_INVALID", `--spec-json is not valid JSON: ${e.message}`, { field: "file" }); } }
    const f = flag("file");
    if (!f || f === true) throw scheduleError("E_BAD_ARGS", "--file <spec.json> is required (a private JSON file with the definition)");
    if (!existsSync(f)) throw scheduleError("E_BAD_ARGS", `spec file not found: ${f}`);
    try { return JSON.parse(readFileSync(f, "utf8")); } catch (e) { throw scheduleError("E_SCHEDULE_INVALID", `${f} is not valid JSON: ${e.message}`, { field: "file" }); }
  };
  const needId = () => { if (!id) throw scheduleError("E_BAD_ARGS", `oats schedule ${sub} <id>`); return id; };
  try {
    switch (sub) {
      case "list": return out(listSchedules(ws(), io));
      case "show": return out({ schedule: describeSchedule(ws(), needId(), io) });
      case "add": { const spec = readSpec(); if (id && spec.id === undefined) spec.id = id; if (id && spec.id !== id) throw scheduleError("E_SCHEDULE_INVALID", `id ${JSON.stringify(spec.id)} in the file does not match ${JSON.stringify(id)}`, { field: "id" }); return out({ schedule: addSchedule(ws(), spec, io) }); }
      case "update": return out({ schedule: updateSchedule(ws(), needId(), readSpec(), io) });
      case "enable": return out({ schedule: setScheduleEnabled(ws(), needId(), true, io) });
      case "disable": return out({ schedule: setScheduleEnabled(ws(), needId(), false, io) });
      case "run": return out(runScheduleNow(ws(), needId(), { io, force: args.includes("--force") }));
      case "remove": return out(removeSchedule(ws(), needId(), { force: args.includes("--force") }));
      case "reconcile": return out(reconcileSchedule(ws(), needId(), { io, clear: args.includes("--clear") }));
      case "tick": {
        const dryRun = args.includes("--dry-run");
        if (args.includes("--host")) return out(tickHost({ io, dryRun }));
        const reg = readRegistry();
        const considered = withHostLock(() => [...tickWorkspace(ws(), { io, reg, wsList: reg.workspaces.includes(ws()) ? reg.workspaces : [...reg.workspaces, ws()], dryRun }), ...tickTriggers(ws(), { io, dryRun })]);
        return out({ tickedAt: new Date().toISOString(), considered, scheduler: schedulerStatus(ws(), io) });
      }
      case "host": {
        const op = args[2];
        if (op === "install") { registerWorkspace(ws()); installHostUnit(); return out({ scheduler: schedulerStatus(ws(), io) }); }
        if (op === "uninstall") { unregisterWorkspace(ws()); if (!readRegistry().workspaces.length) uninstallHostUnit(); return out({ scheduler: schedulerStatus(ws(), io) }); }
        if (op === "status") return out({ scheduler: schedulerStatus(ws(), io) });
        throw scheduleError("E_BAD_ARGS", "oats schedule host install|uninstall|status");
      }
      default: throw scheduleError("E_BAD_ARGS", "usage: oats schedule list|show <id>|add <id> --file <spec.json>|update <id> --file <spec.json>|enable <id>|disable <id>|run <id> [--force]|remove <id> [--force]|reconcile <id> [--clear]|tick [--dry-run] [--host]|host install|uninstall|status [--dir <workspace>|--server <id>] [--json]");
    }
  } catch (e) {
    // K8b: typed refusal details travel (identity mismatch: key/declared; a refused file: its integrity source).
    const details = { ...(e.details && typeof e.details === "object" ? e.details : {}), ...Object.fromEntries(["key", "declared", "source", "field"].filter((k) => e[k] !== undefined).map((k) => [k, e[k]])) };
    if (JSON_MODE) jsonFail(e.code || "E_SCHEDULE_FAILED", e.message, Object.keys(details).length ? details : undefined); else die(e.message);
  }
}

/** `oats trigger …` (lib/triggers.mjs): event-driven spawns stored beside the schedules of the
 *  deployment scope and evaluated by the same host tick. Every subcommand answers the envelope. */
async function triggerCmd() {
  const sub = args[1];
  const id = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
  const T = await import("../lib/triggers.mjs");
  let scope;
  const ws = () => (scope ??= scheduleScopeOf(dirFlag()));
  const out = (result, text) => { if (JSON_MODE) jsonOk(result); else console.log(text ? text(result) : JSON.stringify(result, null, 2)); };
  const needId = () => { if (!id) throw T.triggerError("E_BAD_ARGS", `oats trigger ${sub} <id>`); return id; };
  const usage = "usage: oats trigger add (--file <trigger.json> | --from <package>:<template> [--set <name>=<value>]… [--id <id>]) | list | show <id> | enable <id> | disable <id> | remove <id> | test <id> | status [<id>]  [--dir <deployment>] [--json]";
  const line = (t) => `${t.id}  ${t.enabled ? "enabled " : "disabled"}  ${t.on?.source ?? "?"} ${t.on?.repo ?? "?"} [${(t.on?.events || []).join(",")}]${t.on?.labels?.length ? ` labels ${t.on.labels.join(",")}` : ""} every ${t.on?.poll ?? "?"} → spawn ${t.spawn?.soul ?? "?"}${t.spawn?.teams?.length ? ` in ${t.spawn.teams.join(",")}` : ""}${t.invalid ? `  INVALID: ${t.invalid.message}` : ""}`;
  try {
    switch (sub) {
      case "list": return out(T.listTriggers(ws()), (r) => r.triggers.length ? r.triggers.map(line).join("\n") : "(no triggers — oats trigger add --file <trigger.json> | --from <package>:<template>)");
      case "show": return out({ trigger: T.describeTrigger(ws(), needId()) });
      case "enable": return out({ trigger: T.setTriggerEnabled(ws(), needId(), true) }, (r) => line(r.trigger));
      case "disable": return out({ trigger: T.setTriggerEnabled(ws(), needId(), false) }, (r) => line(r.trigger));
      case "remove": return out(T.removeTrigger(ws(), needId()), (r) => `removed trigger ${r.removed}${r.live.length ? ` (its live instances keep running: ${r.live.join(", ")})` : ""}`);
      case "status": return out(T.triggerStatus(ws(), id), (r) => r.triggers.map((t) => `${t.id}  last poll ${t.lastPoll ? `${t.lastPoll.at} ${t.lastPoll.ok ? `ok (${t.lastPoll.matching}/${t.lastPoll.prs} PRs match)` : `FAILED: ${t.lastPoll.error}`}` : "never"}  pending ${t.pending.length}  fired ${t.firedTotal}  live ${t.live.map((l) => l.instance).join(",") || "none"}${t.lastError ? `\n    last error ${t.lastError.at}: ${t.lastError.message}` : ""}`).join("\n") || "(no triggers)");
      case "test": {
        let workspaceTeams = null;
        try {
          const { observeWorkspace } = await import("../lib/workspace.mjs");
          const { local } = loadLocal(ws());
          if (typeof local.workspace === "string") workspaceTeams = Object.keys((await observeWorkspace(local.workspace, { remoteOptions: remoteOptionsFromEnv() })).workspace.teams || {});
        } catch { /* reported as unknown (null) */ }
        return out(T.testTrigger(ws(), needId(), { workspaceTeams }), (r) => [
          `trigger ${r.id}: ${r.ok ? "ready" : "NOT ready"} (nothing was spawned)`,
          `  gh auth    ${r.gh.ok ? "ok" : "FAILED"}${r.gh.detail ? ` — ${r.gh.detail}` : ""}`,
          `  repo       ${r.repo.key} ${r.repo.readable ? `readable; push ${r.repo.permissions.push} maintain ${r.repo.permissions.maintain} admin ${r.repo.permissions.admin}` : `NOT readable: ${r.repo.error}`}`,
          `  soul       ${r.soul.name} ${r.soul.resolves ? `resolves${r.soul.messaging ? ` (messaging ${r.soul.messaging})` : ""}` : `does NOT resolve: ${r.soul.error.code} ${r.soul.error.message}`}`,
          `  teams      ${r.teams.requested.join(", ") || "(none)"}${r.teams.undeclared?.length ? `  undeclared: ${r.teams.undeclared.join(", ")}` : ""}`,
          `  would fire ${r.wouldFire.length ? r.wouldFire.map((w) => `${w.event} #${w.number}${w.held ? ` (held: ${w.held})` : ""}`).join(", ") : "nothing now"}`,
          ...r.problems.map((p) => `  problem    ${p}`),
        ].join("\n"));
      }
      case "add": {
        const file = flag("file"), from = flag("from");
        if ((file === undefined) === (from === undefined)) throw T.triggerError("E_BAD_ARGS", `oats trigger add needs exactly one of --file <trigger.json> or --from <package>:<template>\n${usage}`);
        const sets = {};
        for (let i = 0; i < args.length; i++) if (args[i] === "--set") {
          const kv = args[i + 1];
          if (typeof kv !== "string" || !kv.includes("=")) throw T.triggerError("E_BAD_ARGS", "--set needs <name>=<value>");
          sets[kv.slice(0, kv.indexOf("="))] = kv.slice(kv.indexOf("=") + 1); i++;
        }
        const idFlag = flag("id");
        if (idFlag === true) throw T.triggerError("E_BAD_ARGS", "--id needs a trigger id");
        let spec;
        if (file !== undefined) {
          if (file === true || !existsSync(file)) throw T.triggerError("E_BAD_ARGS", `--file ${file === true ? "needs a path" : `not found: ${file}`}`);
          if (Object.keys(sets).length) throw T.triggerError("E_BAD_ARGS", "--set fills a package template's parameters; with --file, edit the file");
          try { spec = JSON.parse(readFileSync(file, "utf8")); } catch (e) { throw T.triggerError("E_TRIGGER_INVALID", `${file} is not valid JSON: ${e.message}`, { details: { field: "file" } }); }
          if (idFlag !== undefined) spec.id = idFlag;
        } else spec = await triggerFromPackage(T, String(from), sets, idFlag);
        return out({ trigger: T.addTrigger(ws(), spec) }, (r) => `added ${line(r.trigger)}\n(\`oats trigger test ${r.trigger.id}\` checks gh, the repository, the soul and the teams on this host)`);
      }
      default: throw T.triggerError("E_BAD_ARGS", usage);
    }
  } catch (e) {
    const details = { ...(e.details && typeof e.details === "object" ? e.details : {}), ...(e.field !== undefined ? { field: e.field } : {}) };
    if (JSON_MODE) jsonFail(e.code || "E_TRIGGER_FAILED", e.message, Object.keys(details).length ? details : undefined); else die(e.message);
  }
}
/** A package trigger template (`triggers: [{ id, file }]` in the locked package's oats-package.json),
 *  read at the lock's commit and instantiated with the --set parameters. */
async function triggerFromPackage(T, from, sets, idFlag) {
  const m = /^([a-z0-9][a-z0-9._-]*):([a-z0-9][a-z0-9._-]*)$/.exec(from);
  if (!m) throw T.triggerError("E_BAD_ARGS", `--from ${JSON.stringify(from)}: write <package>:<template>, e.g. oats.okf:harvest-review`);
  const [, pkg, template] = m;
  const deployment = scheduleScopeOf(dirFlag());
  const lock = readLock(deployment);
  const entry = lock.packages[pkg];
  if (!entry) throw T.triggerError("E_PACKAGE_MISSING", `package ${pkg} is not in ${LOCK_FILE} — declare it in packages: and run \`oats sync\``, { details: { package: pkg } });
  const { lockedPackageRef, bindRemote } = await import("../lib/packages.mjs");
  const ref = lockedPackageRef(entry);
  const remote = bindRemote(remoteModule, remoteOptionsFromEnv());
  const read = async (rel, what) => {
    let bytes;
    try { ({ bytes } = await remote.readRemoteFile(ref, entry.commit, `${entry.path}/${rel}`)); }
    catch (e) { throw T.triggerError(e?.code === "E_REMOTE_PATH_MISSING" ? "E_PACKAGE_MANIFEST" : (e?.code || "E_REMOTE_UNREADABLE"), `${pkg} v${entry.version}: ${what} ${entry.path}/${rel} cannot be read: ${e.message}`, { details: { package: pkg, path: rel } }); }
    try { return JSON.parse(Buffer.from(bytes).toString("utf8")); } catch (e) { throw T.triggerError("E_PACKAGE_MANIFEST", `${pkg} v${entry.version}: ${what} ${entry.path}/${rel} is not valid JSON: ${e.message}`, { details: { package: pkg, path: rel } }); }
  };
  const manifest = await read("oats-package.json", "the package manifest");
  const listed = Array.isArray(manifest.triggers) ? manifest.triggers : [];
  const row = listed.find((t) => t && t.id === template);
  if (!row || typeof row.file !== "string" || !row.file || row.file.split("/").includes("..") || row.file.startsWith("/")) throw T.triggerError("E_TRIGGER_UNKNOWN", `package ${pkg} v${entry.version} has no trigger template ${JSON.stringify(template)} (templates: ${listed.map((t) => t?.id).filter(Boolean).join(", ") || "none"})`, { details: { package: pkg, template, templates: listed.map((t) => t?.id).filter(Boolean) } });
  const doc = await read(row.file, `trigger template ${template}`);
  return T.instantiateTemplate(doc, sets, { id: idFlag, provenance: { package: pkg, version: entry.version, commit: entry.commit, template } });
}

async function sessionCmd() {
  try {
    if (flag("native-record") !== undefined) throw Object.assign(new Error("--native-record outcome inspection is gone (the captured/portable path was removed in 0.26)"), { code: "E_BAD_ARGS" });
    const home = flag("home");
    let result;
    if (args[1] === "attach") {
      if (JSON_MODE) throw Object.assign(new Error("session attach is interactive; omit --json"), { code: "E_BAD_ARGS" });
      process.exitCode = await attachInstanceSession(home);
      return;
    }
    if (args[1] === "inspect") result = inspectInstanceSession(home);
    else if (args[1] === "recompose") throw Object.assign(new Error('unknown command "session recompose" — removed by the workspace model v2; use a re-spawn: an instance never changes under itself'), { code: "E_UNKNOWN_COMMAND" });
    else if (args[1] === "start" || args[1] === "restart") {
      const bad = (msg) => { throw Object.assign(new Error(msg), { code: "E_BAD_ARGS" }); };
      const model = flag("model");
      if (model === true) bad("--model needs a model id; omit it to keep the recorded model");
      const launchConfig = flag("launch-config");
      if (launchConfig === true) bad("--launch-config needs a configuration name, or none");
      const harness = harnessFlag();
      if (harness === true || (harness !== undefined && !LAUNCH_HARNESSES.includes(harness))) bad(`--harness must be one of ${LAUNCH_HARNESSES.join(", ")}`);
      const opts = { model: model || undefined, launchConfig, harness, yolo: yoloFlag(), env: process.env, ...(await homeLiveTeams(home)) };
      if (args[1] === "restart") {
        const grace = flag("stop-grace");
        if (grace !== undefined) { if (grace === true || !/^\d+$/.test(String(grace)) || Number(grace) < 1 || Number(grace) > 300) bad("--stop-grace needs a number of seconds (1..300) to wait for the harness after SIGTERM"); opts.stopGraceMs = Number(grace) * 1000; }
        result = restartInstanceSession(home, opts);
      } else result = startInstanceSession(home, opts);
    } else if (args[1] === "input") {
      const file = flag("text-file");
      if (file === true) throw Object.assign(new Error("--text-file needs a path"), { code: "E_BAD_ARGS" });
      if (!file && process.stdin.isTTY) throw Object.assign(new Error("provide --text-file or pipe input on stdin"), { code: "E_BAD_ARGS" });
      result = inputInstanceSession(home, readFileSync(file || 0, "utf8"));
    } else if (args[1] === "receive") {
      // Bytes arrive on stdin (the routed upload pipes them through ssh),
      // collected event-driven and bounded before anything is written.
      const name = flag("name");
      if (!name || name === true) throw Object.assign(new Error("session receive needs --name <file name>"), { code: "E_BAD_ARGS" });
      if (!home || home === true) throw Object.assign(new Error("session receive needs --home </absolute/instance>"), { code: "E_BAD_ARGS" });
      if (process.stdin.isTTY) throw Object.assign(new Error("session receive reads the attachment bytes from stdin"), { code: "E_BAD_ARGS" });
      result = receiveAttachment(home, name, await readStreamBounded(process.stdin, MAX_ATTACHMENT_BYTES));
    } else if (args[1] === "upload") {
      const file = flag("file");
      if (!file || file === true) throw Object.assign(new Error("session upload needs --file <local path>"), { code: "E_BAD_ARGS" });
      result = uploadAttachment({ file, home: home === true ? undefined : home });
    } else throw Object.assign(new Error("usage: oats session inspect|input|attach|start|restart|receive|upload --home /absolute/home [--text-file path] [--model id] [--launch-config name|none] [--harness pi|claude|codex] [--yolo|--no-yolo] [--stop-grace seconds] [--name file] [--file path] [--json]"), { code: "E_BAD_ARGS" });
    if (JSON_MODE) jsonOk(result); else console.log(JSON.stringify(result, null, 2));
  } catch (e) { cmdFail(e.code || "E_SESSION_FAILED", e.message, e.details); }
}

async function paneCmd() {
  die("`oats pane` has been retired — the OATS Desktop app (packages/desktop) is the control panel now.");
}

/** `oats onboard [<dir>] --workspace <repo ref> [--json]` — workspace model v2 (decision 9).
 *
 * Realizes a workspace on this machine in the directory the operator chooses (decision 9)
 * (docs/design/2026-09-23-simplified-workspace-model.md §4): writes
 * `<dir>/oats-local.yaml` naming the workspace, creates `<dir>/agents/` (the
 * instance homes), then runs exactly the `oats sync` path — discover over the
 * remotes, confirm membership, resolve `packages:`, write `oats-lock.json`. Nothing is installed, no soul
 * is created, nothing is spawned, no `oats-config.yaml` is written: the member
 * clones and the operator expert are the operator's next steps, printed here. */
async function onboardCmd() {
  const bail = (code, message, details) => (JSON_MODE ? jsonFail(code, message, details) : die(message));
  const usage = "usage: oats onboard [<dir>] --workspace <repo ref> [--json]   (or --dir <dir>)";
  let positional, workspaceRef, dirValue;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") continue;
    if (arg === "--dir" || arg === "--workspace") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) return bail("E_BAD_ARGS", `--${arg.slice(2)} needs a value\n${usage}`);
      if (arg === "--dir") { if (dirValue !== undefined) return bail("E_BAD_ARGS", usage); dirValue = value; }
      else { if (workspaceRef !== undefined) return bail("E_BAD_ARGS", usage); workspaceRef = value; }
      i++; continue;
    }
    if (arg.startsWith("--")) return bail("E_BAD_ARGS", `unknown flag ${arg}\n${usage}`);
    if (positional !== undefined) return bail("E_BAD_ARGS", usage);
    positional = arg;
  }
  if (positional !== undefined && dirValue !== undefined) return bail("E_BAD_ARGS", `give the deployment directory once, as <dir> or --dir\n${usage}`);
  if (!workspaceRef || !workspaceRef.trim()) return bail("E_BAD_ARGS", `--workspace <repo ref> is required (the repository hosting oats-workspace.yaml)\n${usage}`);
  workspaceRef = workspaceRef.trim();
  // The ref must be one lib/remote.mjs understands BEFORE anything is written.
  try { remoteModule.parseRepoRef(workspaceRef); }
  catch (e) { return bail(e.code || "E_REPO_REF", e.message, e.details ?? e.provenance); }

  const dir = resolve(positional ?? dirValue ?? process.cwd());
  const localFile = join(dir, "oats-local.yaml");
  // (1) Refuse to onboard twice: THIS directory's oats-local.yaml is the mark (an enclosing
  // deployment's file does not count — a nested directory is a different deployment).
  let existing = null;
  try { existing = lstatSync(localFile); } catch (e) { if (e.code !== "ENOENT") return bail("E_ONBOARD_FAILED", `cannot inspect ${localFile}: ${e.message}`); }
  if (existing) return bail("E_ALREADY_ONBOARDED", `${shortPath(localFile)} already exists — this directory realizes a workspace; run \`oats sync --dir ${shortPath(dir)}\` to refresh it`, { local: localFile, dir });
  if (existsSync(dir) && !lstatSync(dir).isDirectory()) return bail("E_ONBOARD_FAILED", `${shortPath(dir)} exists and is not a directory`, { dir });

  // (2) The two files/dirs onboarding owns. Written atomically; rolled back if the sync
  // that follows cannot even read the workspace (a typo'd ref must not leave a
  // half-onboarded directory that looks finished).
  const created = [];
  try {
    if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); created.push(dir); }
    const local = { schemaVersion: 2, workspace: workspaceRef };
    writeFileAtomic(localFile, YAML.stringify(local));
    created.push(localFile);
    const agentsDir = join(dir, "agents");
    if (!existsSync(agentsDir)) { mkdirSync(agentsDir); created.push(agentsDir); }
  } catch (e) {
    rollback();
    return bail(e.code && String(e.code).startsWith("E_") ? e.code : "E_ONBOARD_FAILED", `cannot write ${shortPath(dir)}: ${e.message}`, { dir });
  }
  /** Only what THIS onboard created, only while still exactly ours: our local file, an EMPTY
   * agents/, an otherwise-empty <dir> (rmdirSync refuses a non-empty directory — evidence stays). */
  function rollback() {
    for (const p of [...created].reverse()) {
      try { if (p === localFile) rmSync(p, { force: true }); else rmdirSync(p); }
      catch { /* leave evidence rather than erase another writer's work */ }
    }
  }
  const bailRollback = (code, message, details) => { rollback(); return bail(code, message, { ...(details && typeof details === "object" ? details : {}), dir, rolledBack: true }); };

  // (3) Exactly the `oats sync` body over the deployment just written. A failure while
  // DISCOVERING (unreadable remote, not a workspace host) rolls the two files back; once the
  // workspace has been read, the files stay (a lock may already be written).
  let ctx;
  try {
    const found = loadLocal(dir);
    ctx = { dir, localPath: found.path, local: found.local, deploymentDir: dirname(found.path), remoteOptions: remoteOptionsFromEnv() };
  } catch (e) { return bailRollback(e.code || "E_LOCAL_MISSING", e.message, e.details); }
  let discovered = false;
  const syncBail = (code, message, details) => (discovered
    ? bail(code, message, { ...(details && typeof details === "object" ? details : {}), dir, local: localFile })
    : bailRollback(code, message, details));
  const synced = await performSync(ctx, syncBail, { onDiscovered: () => { discovered = true; } });

  // (4) The taught layout as next steps (design doc §4), and the envelope.
  const standalone = synced.discovery.standalone === true;
  const members = synced.report.members;
  // The operator expert is suggested only when THIS workspace lists a soul by that name (a
  // confirmed member's or, standalone, the repo's own); otherwise any listed soul is spawnable.
  const soulNames = synced.items.souls.map((s) => s.name);
  const setupExpert = soulNames.includes("oats-operator-expert");
  const spawnHint = setupExpert ? `oats spawn oats-operator-expert --dir ${shortPath(dir)}` : null;
  const anySoulHint = `spawn any listed soul: oats spawn <soul> --dir ${shortPath(dir)}${soulNames.length ? ` (e.g. ${soulNames.slice(0, 3).join(", ")})` : ""}`;
  // A member's clone goes beside oats-local.yaml under its repo name; `agents/` is the instance
  // homes, so a member called "agents" is cloned as `agents-repo/` (design doc §4). The HOST is
  // listed exactly like any other member when it is one: a clone of it is needed only if someone
  // works IN it — there is no special "workspace clone" (discovery reads the host over the remote).
  const cloneDirOf = (m) => join(dir, m.name === "agents" ? "agents-repo" : m.name);
  const clonePresent = (m, cloneDir) => {
    const declared = ctx.local?.clones && typeof ctx.local.clones === "object" ? ctx.local.clones[m.key] : undefined;
    const candidate = typeof declared === "string" && declared.trim() ? resolve(dir, declared) : cloneDir;
    return existsSync(join(candidate, ".git")) ? candidate : null;
  };
  const clones = members.filter((m) => m.confirmed || (standalone && m.key === synced.discovery.key)).map((m) => {
    const cloneDir = cloneDirOf(m);
    const present = clonePresent(m, cloneDir);
    return { key: m.key, name: m.name, url: memberUrlOf(synced.discovery, m.key), dir: present ?? cloneDir, present: present !== null, host: m.key === synced.discovery.key };
  });
  // Decision 26: the host publishes the member list to whoever can read it. When the host is
  // itself a member (the common `agents` shape) that is fine for an all-private or all-public
  // organisation; a mixed one needs a private host that is NOT a public member. The kernel
  // cannot see forge visibility, so it states the rule rather than judging.
  const hostIsMember = members.some((m) => m.key === synced.discovery.key);
  const hosting = { host: synced.discovery.key, hostIsMember, rule: "If any member is private, host oats-workspace.yaml in a private repo that is not a public member (a dedicated <org>/workspace repo); public contributors then use the standalone case (from: here capabilities + oats.core)." };
  const result = { onboardApi: 2, standalone: standalone || undefined, local: localFile, dir, agents: join(dir, "agents"), lock: synced.lockFile, sync: synced.report, hosting, next: { clone: clones, spawn: spawnHint, souls: soulNames.slice(0, 3) } };
  if (JSON_MODE) { jsonOk(result); return; }

  console.log(`Onboarded ${shortPath(dir)} into workspace ${workspaceName(synced.discovery)} (${synced.discovery.key} @ ${short(synced.discovery.commit)}).${standalone ? `\n  (${standaloneNote(synced.discovery, { from: " from here" })})` : ""}\n`);
  printSyncReport(ctx, synced);
  console.log(`
This directory (${shortPath(dir)}) is your deployment — any layout works; it now holds what the kernel needs:
  ├── oats-local.yaml     which workspace this machine realizes (+ host settings, disabled souls)
  ├── oats-lock.json      exact commit + integrity per package
  └── agents/             instance homes, each self-contained
Member clones live wherever you keep them (here, or anywhere named in oats-local.yaml clones:).

Next:
  1. Members you will work IN need a clone (discovery and resolution run over the remotes; only a
     soul's work target does):${clones.map((c) => c.present ? `\n       ${shortPath(c.dir)}  ✓ already here${c.host ? "  (the host — a member like the others)" : ""}` : `\n       git clone ${c.url ?? c.key} ${shortPath(c.dir)}   (or point oats-local.yaml clones: { ${c.key}: <abs path> } at an existing clone)${c.host ? "\n         ↑ the host is a member like the others: clone it only if someone works IN it — the workspace file is read over the remote" : ""}`).join("") || "\n       (no confirmed members yet — see the membership rows above)"}${!hostIsMember ? `\n       (the host ${synced.discovery.key} is not a member: nothing to clone — the workspace file is read over the remote)` : ""}
  2. Check who may read the host: ${synced.discovery.key}${hostIsMember ? " is itself a member" : " is a dedicated host"}. The workspace file
     names every member, so if any member is private the host must be a private repo that is not
     a public member; public contributors then get the standalone case (from: here + oats.core).
  3. ${setupExpert ? "Spawn the operator expert to guide the rest (souls, teams, provider settings):" : "No soul named oats-operator-expert is listed here —"}
       ${spawnHint ?? anySoulHint}`);
}

/** The clone URL of a member row: what the remote observed (from the workspace's members: refs;
 *  standalone, the one repo oats-local.yaml named). */
function memberUrlOf(discovery, key) {
  for (const ref of discovery.workspace?.members || []) {
    try { const parsed = remoteModule.parseRepoRef(ref); if (parsed.key === key) return parsed.url; } catch { /* schema already validated */ }
  }
  if (discovery.standalone === true && discovery.key === key) return discovery.url ?? null;
  return null;
}

// ---------- capability command dispatch ----------
/**
 * oats <namespace> <command> [args…] — run a command an active capability
 * declares in its manifest (`commands: { name: "script args" }`).
 * Kernel subcommands take precedence over capability namespaces.
 *
 * Three contexts, one contract (OATS_CAPABILITY / OATS_SETTINGS / OATS_CLI_BIN):
 *   - inside an instance home: the home's materialized modules (instance.json.modules);
 *   - from a v2 DEPLOYMENT (oats-local.yaml in reach, no home): operator-level
 *     dispatch — resolve exactly as `oats spawn --soul <x>` would, fetch the
 *     namespace's capability into <deployment>/.oats/modules/<cap>@<commit12>/
 *     and run THAT copy with the soul's merged payload (lib/operator-dispatch.mjs;
 *     contracts doc, "Post-0.25.0 clarifications");
 *   - otherwise no namespace is active (the help fallthrough answers).
 */
async function capabilityCommand() {
  // JSON-aware boundary: in --json mode every dispatch failure — inactive or
  // untrusted capability, duplicate namespace, unknown subcommand, broken
  // metadata/manifests, malformed command values — must still emit exactly
  // one envelope object on stdout. The WHOLE dispatcher runs inside the
  // boundary; only "no namespace matched" escapes (returns false to the help
  // fallthrough).
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  const NOT_DISPATCHED = Symbol("not-dispatched");
  let outcome;
  try { outcome = await dispatch(); }
  catch (e) {
    // Unexpected throw from discovery/trust/decoding: keep the envelope contract.
    bail("E_CAPABILITY_BROKEN", e.message || e);
    throw e;
  }
  return outcome !== NOT_DISPATCHED;

  /** Operator-level dispatch from a deployment directory (no instance home). */
  async function operatorDispatch() {
    let hit;
    try {
      const { resolveOperatorDispatch } = await import("../lib/operator-dispatch.mjs");
      let catalog = null; try { catalog = officialPackageCatalog(); } catch { /* the lock carries url for catalog packages */ }
      hit = await resolveOperatorDispatch(process.cwd(), cmd, flag("soul"), { remoteOptions: remoteOptionsFromEnv(), catalog });
    } catch (e) {
      if (typeof e?.code === "string" && e.code.startsWith("E_")) bail(e.code, e.message, e.details);
      throw e;
    }
    if (!hit) return NOT_DISPATCHED;
    // The same team/workspace facts a spawn hook receives (lead decision c3-7).
    const teamCtx = teamEnv(resolvedFromPrepared(hit.prepared, hit.deployment));
    // No home, so no recorded soul: the soul's per-commit copy is OATS_SOUL when a spawn
    // already fetched exactly this commit; otherwise the command gets none (never ambient).
    const cachedSoul = hit.soul?.commit ? join(hit.deployment, "agents", hit.soul.name, "souls", String(hit.soul.commit).slice(0, 12)) : null;
    return runManifestCommand({ capability: hit.module.name, ...hit.manifest }, hit.settings, teamCtx, hit.ensureTree, cachedSoul && existsSync(join(cachedSoul, "soul.yaml")) ? realpathSync(cachedSoul) : undefined);
  }

  async function dispatch() {
    let activeIds;
    let context = process.cwd();
    let teamCtx, homeMeta, homeTeamCtx;
    // OATS_INSTANCE_HOME is the canonical identity; the older names still count.
    const instanceHome = process.env.OATS_INSTANCE_HOME || process.env.PI_AGENT_HOME || process.env.OATS_HOME;
    const metaFile = instanceHome && join(instanceHome, "instance.json");
    // Capability-id keyed — never answer for `constructor`/`toString`. Belt and
    // braces: the ids come from instance.json, which spawn wrote from resolved
    // manifests. Null-prototype because the dispatcher indexes it with the
    // namespace the operator typed on the command line.
    let capSettings = Object.create(null);
    let deployment = null;
    let soulDir;
    try {
      if (metaFile && existsSync(metaFile)) {
        const meta = JSON.parse(readFileSync(metaFile, "utf8"));
        activeIds = (meta.capabilities || []).map((c) => c.id);
        for (const c of meta.capabilities || []) capSettings[c.id] = c.settings || {};
        // Workspace-model homes only (lead decision c3 Q2).
        if (isCapturedHome(meta)) { const e = capturedHomeRefusal(instanceHome, "nothing was dispatched"); bail(e.code, e.message, e.details); }
        if (!isWorkspaceHome(meta)) { const e = preWorkspaceHome(instanceHome, "nothing was dispatched"); bail(e.code, e.message); }
        context = meta.repo || context;
        soulDir = instanceSoulDir(instanceHome, meta);
        // The team/workspace facts the home recorded at spawn, as its hooks got them, with the
        // recorded eligible teams (OATS_TEAMS_SOURCE=recorded). Only the home's MESSAGING module
        // gets them live (below): its team verbs (join/leave/teams) must see what the workspace
        // allows now, and no other command pays a remote read for them.
        const ws = meta.workspace && typeof meta.workspace === "object" ? meta.workspace : {};
        const messaging = (meta.capabilities || []).find((c) => c.layer === "messaging")?.id;
        homeMeta = { meta, messaging };
        homeTeamCtx = (teams, teamsSource) => teamEnv({ workspace: { key: ws.key, name: ws.name, deployment: ws.deployment, team: ws.soul?.team, slots: { messaging } }, payloads: meta.providers, teams, teamsSource });
        teamCtx = homeTeamCtx(meta.teams, "recorded");
      } else {
        // Not inside a home: a v2 deployment (oats-local.yaml in reach) resolves
        // through the workspace, exactly as a spawn of --soul would (below).
        try { const { deploymentOf } = await import("../lib/operator-dispatch.mjs"); deployment = deploymentOf(context); }
        catch (e) { if (typeof e?.code === "string" && e.code.startsWith("E_")) bail(e.code, e.message, e.details); throw e; }
        // No home and no deployment in reach: no capability namespace is active.
        if (!deployment) return NOT_DISPATCHED;
      }
    } catch (e) { bail("E_CONFIG_BROKEN", e.message || e); throw e; }
    if (deployment) return operatorDispatch();
    // Workspace model: an instance's own materialized modules are the command
    // namespaces available to it (instance.json.modules → <home>/.oats/modules).
    const mans = Object.values(capabilityManifests(instanceHome)).filter((m) => m.command === cmd && m.commands);
    if (!mans.length) return NOT_DISPATCHED;
    if (mans.length > 1) bail("E_DUPLICATE_NAMESPACE", `duplicate operational command namespace "${cmd}": ${mans.map((m) => m.capability).join(", ")}`);
    const m = mans[0];
    if (!activeIds.includes(m.capability)) bail("E_CAPABILITY_INACTIVE", `${m.capability} command namespace is not active in the current context/instance`);
    const trust = capabilityTrust(m);
    if (!trust.trusted) bail("E_CAPABILITY_BLOCKED", `${m.capability} executable command is blocked: ${trust.reason}`);
    if (homeMeta && m.capability === homeMeta.messaging) {
      const { liveTeams } = await import("../lib/instance-resolution.mjs");
      const live = await liveTeams(instanceHome, homeMeta.meta, { remoteOptions: remoteOptionsFromEnv() });
      teamCtx = homeTeamCtx(live.teams, live.source);
    }
    return runManifestCommand(m, capSettings[m.capability] || {}, teamCtx, () => m._dir, soulDir);
  }

  /** Help / unknown-command / spec validation / exec — shared by every context.
   *  `m` is the manifest (with `capability`; `_dir` may be absent until `ensureDir`
   *  resolves the directory holding the executable — the operator branch fetches
   *  the module tree only when a command is actually going to run). */
  async function runManifestCommand(m, settings, teamCtx, ensureDir, soulDir) {
    const sub = args[1];
    const cmds = Object.keys(m.commands);
    // `oats <ns> --help` and `oats <ns> <cmd> --help` answer from the manifest
    // and never run the executable: the command's own help, if it has one,
    // is not worth a side effect (harvest --help once spawned a harvester).
    if (HELP_WORDS.has(sub) || args.slice(2).some((a) => a === "--help" || a === "-h")) {
      const known = sub && !HELP_WORDS.has(sub) && Object.prototype.hasOwnProperty.call(m.commands, sub);
      if (JSON_MODE) { jsonOk({ capability: m.capability, namespace: cmd, command: known ? sub : null, commands: cmds, description: m.description || null, help: "printed from the manifest; the executable was not run" }); return; }
      console.log(`oats ${cmd}${known ? ` ${sub}` : ""} — ${m.capability}${m.description ? `: ${m.description}` : ""}`);
      console.log(`  commands: ${cmds.join(", ") || "(none)"}`);
      console.log(`  (help printed from the manifest; the executable was not run)`);
      process.exit(0);
    }
    // Distinguish an ABSENT key from a declared-but-invalid value: a manifest
    // entry of "" / 0 / false / null is a broken capability, not an unknown
    // command (it is listed in cmds).
    if (!sub || !Object.prototype.hasOwnProperty.call(m.commands, sub)) {
      if (JSON_MODE) jsonFail("E_UNKNOWN_COMMAND", `oats ${cmd}: ${sub ? `unknown command "${sub}"` : "missing command"} — commands: ${cmds.join(", ") || "(none)"}`);
      console.error(`oats ${cmd} — commands: ${cmds.join(", ") || "(none)"}`);
      process.exit(sub ? 1 : 0);
    }
    // Command values come from third-party manifests — validate before decoding.
    const spec = m.commands[sub];
    if (typeof spec !== "string" || !spec.trim()) bail("E_CAPABILITY_BROKEN", `oats ${cmd} ${sub}: manifest command must be a non-empty string (got ${JSON.stringify(spec)})`);
    const [script, ...rest] = spec.trim().split(/\s+/);
    let dir;
    try { dir = await ensureDir(); }
    catch (e) { if (typeof e?.code === "string" && e.code.startsWith("E_")) bail(e.code, e.message, e.details); throw e; }
    const withDir = { ...m, _dir: dir };
    let abs;
    try { abs = capabilityExecutablePath(withDir, script); }
    catch (e) { bail("E_CAPABILITY_BROKEN", e.message); }
    if (!abs) bail("E_CAPABILITY_BROKEN", `${cmd} ${sub}: script not found (${join(dir, script)})`);
    // OATS_SOUL is the recorded soul or nothing: an ambient value inherited from the
    // invoking process names some other soul (a coordinator's own), never this one.
    const { OATS_SOUL: _ambientSoul, ...inherited } = process.env;
    const r = spawnSync("node", [abs, ...rest, ...rawArgs.slice(2)], { stdio: "inherit", env: {
      ...inherited, OATS_CAPABILITY: m.capability,
      // Package-runtime boundary: dispatched commands receive the active
      // capability's EFFECTIVE settings (instance snapshot, resolved context, or
      // the soul's merged payload on operator-level dispatch), same contract as
      // lifecycle hooks — capabilities read their settings here instead of
      // importing the kernel resolver.
      OATS_SETTINGS: JSON.stringify(settings || {}),
      // PATH is not a trusted runtime boundary (maintainer finding 1): pass the
      // canonical absolute executable of THIS CLI; official consumers execFile
      // it directly and never resolve `oats` from PATH or a shell.
      OATS_CLI_BIN: CLI_BIN,
      ...teamEnv(null), ...(teamCtx || {}),
      // The soul the command acts for (an instance home's recorded soul directory):
      // homes carry no soul link, so providers read it here.
      ...(soulDir ? { OATS_SOUL: soulDir } : {}),
    } });
    // Child never ran (spawn error): nothing reached stdout — keep the envelope contract.
    if (r.error) bail("E_CAPABILITY_BROKEN", `oats ${cmd} ${sub}: ${r.error.message || r.error}`);
    process.exit(r.status ?? 1);
  }
}


// ---------- update ----------
function updateCmd() {
  const checkOnly = args.includes("--check");
  let latest;
  try { latest = execFileSync("npm", ["view", "@awebai/oats", "version"], { encoding: "utf8", timeout: 30000 }).trim(); }
  catch (e) { die(`cannot check npm for the latest version: ${e.message}`); }
  console.log(`@awebai/oats  installed: ${OATS_VERSION}  latest: ${latest}`);
  // pi bridge, if a pi installation carries it.
  let piBridge;
  const piPkg = join(homedir(), ".pi", "agent", "npm", "node_modules", "@awebai", "oats-pi", "package.json");
  if (existsSync(piPkg)) piBridge = JSON.parse(readFileSync(piPkg, "utf8")).version;
  if (piBridge) console.log(`@awebai/oats-pi   installed: ${piBridge}  latest: ${latest} (published in lockstep)`);
  if (latest === OATS_VERSION && (!piBridge || piBridge === latest)) { console.log("Up to date."); return; }
  const steps = [];
  if (latest !== OATS_VERSION) steps.push(`npm install -g @awebai/oats@${latest}`);
  if (piBridge && piBridge !== latest) steps.push(`pi uninstall npm:@awebai/oats-pi@${piBridge}`, `pi install npm:@awebai/oats-pi@${latest}`);
  console.log("\nUpdate steps:");
  for (const s of steps) console.log(`  ${s}`);
  if (checkOnly) { console.log("\n(--check: not executing)"); return; }
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  if (interactive) {
    process.stdout.write("\nRun these now? [y/N] ");
    const buf = Buffer.alloc(16);
    let answer = "";
    try { answer = buf.toString("utf8", 0, readSync(0, buf, 0, 16)).trim().toLowerCase(); } catch { /* no input */ }
    if (answer !== "y" && answer !== "yes") { console.log("Not updating."); return; }
  } else if (!args.includes("--yes")) {
    console.log("\nNon-interactive: pass --yes to execute, or run the steps yourself.");
    return;
  }
  for (const s of steps) {
    console.log(`\n$ ${s}`);
    const [bin, ...rest] = s.split(/\s+/);
    const r = spawnSync(bin, rest, { stdio: "inherit" });
    if (r.status !== 0) die(`step failed: ${s}`);
  }
  console.log(`\nUpdated to ${latest}. Now verify each deployment: run \`oats doctor\` at your workspace/repo scopes — it reports config spellings this version rejects, version skew, and missing requirements. Restart running pi sessions to pick up the new bridge.`);
}

// ---------- version (Desktop CLI API v1 probe) ----------
function versionCmd() {
  if (JSON_MODE) {
    // EXACT Desktop API v1 probe payload — one JSON object, nothing else on
    // stdout. Desktop accepts desktopApi === 1 and a compatible semver range.
    // `remote`: this kernel's remote-side surface: the commands it routes to
    // a registered server with --server, plus `roster` (the local command
    // over registrations and saved routes); a Desktop gates its remote path
    // on it (an older CLI without the surface must fail closed with a
    // reason, not an argument error). `features`: kernel abilities a peer
    // must see before relying on them (retire-home: retire --home).
    // Phase B: `instance-modules` and `spawn-provider-payload` are advertised only once spawn
    // runs on resolve/materialize (contract §6); a feature the binary does not implement is
    // never listed.
    console.log(JSON.stringify({ schemaVersion: 1, name: "@awebai/oats", version: OATS_VERSION, desktopApi: 1, harnesses: ["pi", "claude", "codex"], sessionBackends: ["tmux", "herdr"], launchOptions: ["yolo"], remote: ["spawn", "retire", "status", "session", "session-start", "session-restart", "launch-config", "roster", "harvest", "schedule", "session-upload", "operations"], features: ["retire-home", "session-start", "session-restart", "launch-config", "schedule", "session-upload", "operations", "instance-git", "instance-git-remote", "souls-declarations", "lifecycle-plans", "retire-retention", "readiness", "spawn-preview", "instance-events", "instance-events-2", "schedule-history", "schedule-read-2", "spawn-preview-2", "spawn-idempotency", "spawn-idempotency-2", "spawn-apply-2", "workspace-v2", "instance-modules", "spawn-provider-payload", "served-identity", "packages-no-approval", "spawn-name", "settings-origins", "teams", "settings-declared", "capabilities-private", "layers-from", "harness", "package-souls", "triggers"], workspaceApi: 2, instanceGitApi: 1, spawnApplyApi: 1, soulsApi: 2, lifecycleApi: 1, readinessApi: 2, spawnPreviewApi: 2, eventsApi: 2, scheduleHistoryApi: 3, scheduleApi: SCHEDULE_API, operationsApi: 2 }));
    return;
  }
  console.log(`@awebai/oats ${OATS_VERSION} (desktop API v1)`);
}

// ---------- the record (core) and experimental tools over it ----------
// The turn record is the core: capture, recall, setup are kernel-level
// subcommands, dispatched to packages/record (shipped inside this package —
// see "files" in package.json). The record bins parse process.argv.slice(2)
// themselves, so the consumed subcommand words are spliced out first.
// Everything that selects or synthesizes over the record (dress, spawn,
// segments, mind) is EXPERIMENTAL and ships only in the oats repo checkout,
// under packages/experimental — absent from the published tarball on
// purpose, so its presence is exactly its status.
const EXPERIMENTAL_CMDS = new Set(["dress", "spawn", "segments", "mind"]);
async function recordCmd(sub) {
  process.argv.splice(2, 1);
  await import(new URL(`../packages/record/bin/${sub}.mjs`, import.meta.url));
}
async function experimentalCmd() {
  const sub = args[1];
  if (!sub || !EXPERIMENTAL_CMDS.has(sub)) {
    console.error(
      "usage: oats experimental <dress|spawn|segments|mind> [options]\n" +
        "EXPERIMENTAL tools over the turn record — unproven by design; see packages/experimental/README.md",
    );
    process.exit(sub === undefined ? 0 : 2);
  }
  const url = new URL(`../packages/experimental/bin/${sub}.mjs`, import.meta.url);
  if (!existsSync(url)) {
    die(
      `experimental tools ship only in the oats repo checkout, not in the published package — clone github.com/awebai/oats and run \`oats experimental ${sub}\` from it`,
    );
  }
  process.argv.splice(2, 2);
  await import(url);
}

// ---------- servers: registry and remote routing (docs/execution-targets.md) ----------
/** `oats server add|list|remove|check`. A registration is where and how:
 *  an OpenSSH host alias, the remote workspace, the remote oats path. Keys
 *  and passwords never enter it; ssh owns those. */
function serverCmd() {
  const bail = (code, msg) => (JSON_MODE ? jsonFail(code, msg) : die(msg));
  const sub = args[1];
  const usage = "usage: oats server add <id> --ssh <host-alias> --workspace </abs/path> [--oats <path>] [--herdr <path>] [--path <dir:dir>] [--label <text>] [--replace] | list | remove <id> | check <id> | roster [--server <id>] | forget <id> --instance <name>  [--json]";
  if (!["add", "list", "remove", "check", "roster", "forget"].includes(sub)) bail("E_USAGE", usage);
  if (sub === "forget") {
    // A saved route whose remote instance is gone can be dropped only by
    // the operator: nothing routed can do it, and the changed-registration
    // guard counts it until then.
    const id = args[2];
    const inst = flag("instance");
    if (!id || id.startsWith("--") || !inst || inst === true) bail("E_USAGE", "usage: oats server forget <id> --instance <name> [--json]");
    let snap;
    try { snap = forgetSnapshot(id, inst); } catch (e) { bail(e.code || "E_SNAPSHOT_UNKNOWN", e.message); }
    if (JSON_MODE) { jsonOk({ server: id, instance: inst, home: snap.home, target: snap.target, forgotten: true }); return; }
    console.log(`Forgot the saved route of ${inst} through ${id} (${snap.target?.sshHost}:${snap.home}).`);
    console.log(`  if that home still exists on the host it is no longer managed from here: retire it there with oats retire ${inst} --home ${snap.home}`);
    return;
  }
  if (sub === "roster") {
    // The remote roster for the Desktop and operators: grouped by saved route
    // target, one bounded status pull per target, saved routes as the action
    // authority. --server narrows to one registry id.
    const only = flag("server") === true ? bail("E_BAD_ARGS", "--server needs a registered server id") : flag("server");
    const ms = (name) => { const v = flag(name); if (v === undefined) return undefined; const n = Number(v); if (!Number.isInteger(n) || n < 1000) bail("E_BAD_ARGS", `--${name} takes whole milliseconds, at least 1000`); return n; };
    let out;
    try { out = rosterGroups({ server: only, io: { budgetMs: ms("budget"), perTargetTimeoutMs: ms("per-target") } }); } catch (e) { bail(e.code || "E_SERVERS_UNREADABLE", e.message); }
    if (JSON_MODE) { jsonOk(out); return; }
    if (!out.groups.length) { console.log("no remote groups: no registrations and no saved routes"); return; }
    for (const g of out.groups) {
      console.log(`  ${g.server}${g.label && g.label !== g.server ? `  ${g.label}` : ""}  [${g.id}]  ssh ${g.target.sshHost}  workspace ${g.target.workspace}${g.registrationPresent ? "" : "  (registration removed or changed; saved routes only)"}`);
      console.log(g.probe?.ok ? `      reachable, ${g.souls.length} soul(s)` : `      UNREACHABLE: ${g.probe?.error?.message || "?"}`);
      for (const i of g.instances) console.log(`      • ${i.instance}  ${i.missingRemotely ? "GONE on the host (saved route is stale: oats server forget)" : i.running === true ? "RUNNING" : i.running === false ? "idle" : "unknown"}${i.retirePending ? " RETIRING" : ""}${i.rollbackIncomplete ? " QUARANTINED" : ""}${i.savedRoute ? "" : "  (observed only, no saved route)"}${i.runtimeError ? `  ${i.runtimeError}` : ""}`);
      for (const f of g.retireFailures || []) console.log(`      ! deferred retirement of ${f.instance} (${f.agent}) FAILED there${f.error?.message ? `: ${f.error.message}` : ""}${f.retry ? ` — retry on the host: ${f.retry}` : ""}`);
    }
    console.log(`  bounds: ${out.bounds.perTargetTimeoutMs} ms per target within ${out.bounds.budgetMs} ms, ${out.bounds.elapsedMs} ms used${out.bounds.skipped ? `, ${out.bounds.skipped} target(s) not reached` : ""}`);
    return;
  }
  let servers;
  try { servers = readServers(); } catch (e) { bail(e.code || "E_SERVERS_UNREADABLE", e.message); }
  if (sub === "list") {
    const rows = Object.entries(servers).map(([id, s]) => ({ id, ...s, target: targetOf({ id, ...s }), snapshots: listSnapshots(id).length }));
    if (JSON_MODE) { jsonOk({ file: SERVERS_FILE(), servers: rows }); return; }
    if (!rows.length) { console.log(`no servers registered (${shortPath(SERVERS_FILE())}) — add one with \`oats server add <id> --ssh <alias> --workspace </path>\``); return; }
    for (const r of rows) console.log(`  ${r.id}${r.label ? `  ${r.label}` : ""}\n      ssh ${r.sshHost}  workspace ${r.workspace}  oats ${r.target.oatsPath}${r.target.herdrPath ? `  herdr ${r.target.herdrPath}` : ""}${r.snapshots ? `  (${r.snapshots} remote instance${r.snapshots === 1 ? "" : "s"} spawned from here)` : ""}`);
    return;
  }
  const id = args[2];
  if (!id || id.startsWith("--")) bail("E_USAGE", usage);
  if (sub === "add") {
    const val = (name) => { const v = flag(name); return v === true ? bail("E_BAD_ARGS", `--${name} needs a value`) : v; };
    const entry = { sshHost: val("ssh"), workspace: val("workspace") };
    for (const [k, f] of [["oatsPath", "oats"], ["herdrPath", "herdr"], ["path", "path"], ["label", "label"]]) { const v = val(f); if (v !== undefined) entry[k] = v; }
    if (!entry.sshHost || !entry.workspace) bail("E_USAGE", usage);
    try { validateServer(id, entry); } catch (e) { bail(e.code, e.message); }
    if (servers[id] && !args.includes("--replace")) bail("E_SERVER_EXISTS", `server ${id} is already registered (pass --replace to overwrite; existing remote instances keep the route they were spawned with)`);
    servers[id] = entry;
    writeServers(servers);
    if (JSON_MODE) { jsonOk({ id, ...entry, file: SERVERS_FILE() }); return; }
    console.log(`Registered server ${id} → ssh ${entry.sshHost}, workspace ${entry.workspace} (${shortPath(SERVERS_FILE())}). Verify it with \`oats server check ${id}\`.`);
    return;
  }
  if (sub === "remove") {
    if (!servers[id]) bail("E_SERVER_UNKNOWN", `no server registered as ${id}`);
    const snaps = listSnapshots(id);
    delete servers[id];
    writeServers(servers);
    if (JSON_MODE) { jsonOk({ removed: id, remoteInstancesStillTracked: snaps.map((s) => s.instance) }); return; }
    console.log(`Removed server ${id}${snaps.length ? ` — ${snaps.length} remote instance(s) spawned from it keep their snapshots and can still be retired with --server ${id}` : ""}`);
    return;
  }
  // check: reachability and compatibility, no mutation
  let server; try { server = getServer(id); } catch (e) { bail(e.code, e.message); }
  const target = targetOf(server);
  try {
    const remote = checkRemote(target);
    const status = routeCommand(id, "status", [], { server });
    const agents = status.envelope.ok ? (status.envelope.result.agents || []).length : undefined;
    if (JSON_MODE) { jsonOk({ id, target, remote, workspaceReachable: !!status.envelope.ok, agents, error: status.envelope.ok ? undefined : status.envelope.error }); return; }
    console.log(`${id}: ssh ${target.sshHost} ok, remote oats ${remote.version} (envelope v${remote.schemaVersion})`);
    console.log(status.envelope.ok ? `  workspace ${target.workspace}: ${agents} agent(s)` : `  workspace ${target.workspace}: ${status.envelope.error?.message || "not usable"}`);
    if (!status.envelope.ok) process.exit(1);
  } catch (e) { bail(e.code || "E_SSH", e.message); }
}

/** `oats <spawn|retire|status> --server <id> ...`: run the command on the
 *  registered server's installed oats, same arguments, same envelope. The
 *  local side only routes and keeps the route snapshot per remote instance. */
async function serverRouteCmd() {
  const bail = (code, msg) => (JSON_MODE ? jsonFail(code, msg) : die(msg));
  const id = flag("server");
  if (id === true || !id) bail("E_BAD_ARGS", "--server needs a registered server id (oats server list)");
  // The operations contract addresses an exact member context on the host,
  // so its explicit --dir travels; every other routed command takes its
  // scope from the registration.
  const explicitScopeOk = ["inspect", "operation", "launch-config"].includes(cmd);
  if (!explicitScopeOk && flag("dir") !== undefined) bail("E_BAD_ARGS", "--dir cannot be combined with --server: the remote workspace comes from the server registration");
  if (cmd === "launch-config") {
    const action = args[1];
    const value = (name) => { const v = flag(name); if (v === true) bail("E_BAD_ARGS", `--${name} needs a value`); return v; };
    if (!["list", "set", "remove", "preview"].includes(action)) bail("E_BAD_ARGS", "launch-config --server supports list, set, remove and preview");
    const options = { action, name: args[2], context: value("dir"), home: value("home"), instance: value("instance"), soul: value("soul"), agentsRoot: value("agents-root") };
    if (action === "preview") Object.assign(options, { launchConfig: value("launch-config"), harness: harnessFlag(value), model: value("model"), yolo: yoloFlag() });
    if (action === "set") {
      const file = value("file");
      if (!file) bail("E_BAD_ARGS", "launch-config set needs --file <local JSON file> (or - for stdin)");
      let raw;
      try {
        if (file === "-") {
          if (process.stdin.isTTY) bail("E_BAD_ARGS", "--file - reads the definition from stdin");
          raw = await readStreamBounded(process.stdin, INSPECT_TEXT_CAP);
        } else raw = readFileSync(file);
      } catch (e) { bail("E_BAD_ARGS", `cannot read launch configuration file (${e.code || "read failed"})`); }
      if (raw.length > INSPECT_TEXT_CAP) bail("E_BAD_ARGS", "launch configuration file exceeds the input limit");
      try { options.definition = JSON.parse(raw.toString("utf8")); }
      catch { bail("E_BAD_ARGS", "launch configuration file is not valid JSON"); }
      options.keepEnv = args.includes("--keep-env");
    }
    let out;
    try { out = launchConfigRemote(id, options); } catch (e) { bail(e.code || "E_SSH", e.message); }
    if (out.stderr?.trim()) process.stderr.write(out.stderr.endsWith("\n") ? out.stderr : out.stderr + "\n");
    if (JSON_MODE) { console.log(JSON.stringify(withLocalWarnings(out.envelope), null, 2)); if (!out.envelope.ok) process.exit(1); return; }
    if (!out.envelope.ok) die(`${id}: ${out.envelope.error?.message || "launch configuration request failed"} (${out.envelope.error?.code || "E_REMOTE"})`);
    console.log(JSON.stringify(out.envelope.result, null, 2));
    return;
  }
  // Interactive viewer: `oats session attach --server <id> --instance <name>`
  // (or --home </abs/remote/home>) runs the execution host's own attach
  // through an ssh PTY with this terminal's stdio; nothing is captured.
  if (cmd === "okf") {
    // `oats okf harvest --server <id> --instance <name>`: the package's
    // harvest command run in the instance's SAVED home on the host.
    if (args[1] !== "harvest") bail("E_USAGE", "--server routes `okf harvest` only among the okf commands");
    const inst = flag("instance");
    if (!inst || inst === true) bail("E_BAD_ARGS", "okf harvest --server needs --instance <name> (spawned from here)");
    let routed;
    try { routed = routeCommand(id, "harvest", [inst]); } catch (e) { bail(e.code || "E_SSH", e.message); }
    if (routed.stderr?.trim()) process.stderr.write(routed.stderr.endsWith("\n") ? routed.stderr : routed.stderr + "\n");
    if (JSON_MODE) { console.log(JSON.stringify(withLocalWarnings(routed.envelope), null, 2)); if (!routed.envelope.ok) process.exit(1); return; }
    if (!routed.envelope.ok) die(`${id}: ${routed.envelope.error?.message || "harvest failed"} (${routed.envelope.error?.code || "E_REMOTE"})`);
    const hr = routed.envelope.result;
    console.log(`Harvest on ${id} for ${inst}: ${hr.harvest}${hr.reason ? ` (${hr.reason})` : ""}${hr.instance && hr.harvest === "spawned" ? ` — harvester ${hr.instance}` : ""}`);
    if (hr.instance && hr.instance !== inst) console.log(`  the harvester ${hr.instance} runs on ${id}; retire it there when it is done, or let it self-retire`);
    return;
  }
  if (cmd === "schedule") {
    // Host-owned: the subcommand runs in the server's registered workspace.
    // A local --file spec is read here and travels inline; the remote
    // cannot read this machine's files.
    const rest = [];
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (a === "--server") { i++; continue; }
      if (a === "--json") continue;
      if (a === "--file") {
        const f = args[++i];
        if (!f || f.startsWith("--")) bail("E_BAD_ARGS", "--file needs a path");
        if (!existsSync(f)) bail("E_BAD_ARGS", `spec file not found: ${f}`);
        rest.push("--spec-json", readFileSync(f, "utf8"));
        continue;
      }
      rest.push(a);
    }
    let out;
    try { out = scheduleRemote(id, rest); } catch (e) { bail(e.code || "E_SSH", e.message); }
    if (out.stderr?.trim()) process.stderr.write(out.stderr.endsWith("\n") ? out.stderr : out.stderr + "\n");
    if (JSON_MODE) { console.log(JSON.stringify(withLocalWarnings(out.envelope), null, 2)); if (!out.envelope.ok) process.exit(1); return; }
    if (!out.envelope.ok) die(`${id}: ${out.envelope.error?.message || "schedule command failed"} (${out.envelope.error?.code || "E_REMOTE"})`);
    console.log(JSON.stringify(out.envelope.result, null, 2));
    return;
  }
  if (cmd === "session") {
    const addr = { instance: flag("instance") === true ? undefined : flag("instance"), home: flag("home") === true ? undefined : flag("home") };
    if (args[1] === "inspect") {
      // Desktop preflight before a remote attach: the execution host's own
      // inspect, relayed as its envelope; a failure is a failure, nonzero.
      let out;
      try { out = inspectRemote(id, addr); } catch (e) { bail(e.code || "E_SSH", e.message); }
      if (out.stderr?.trim()) process.stderr.write(out.stderr.endsWith("\n") ? out.stderr : out.stderr + "\n");
      if (JSON_MODE) { console.log(JSON.stringify(withLocalWarnings(out.envelope), null, 2)); if (!out.envelope.ok) process.exit(1); return; }
      if (!out.envelope.ok) die(`${id}: ${out.envelope.error?.message || "inspect failed"} (${out.envelope.error?.code || "E_REMOTE"})`);
      const r = out.envelope.result;
      console.log(`${r.instance || r.home} on ${id}: ${r.present ? `present, ${r.state || "unknown"}` : "not present"}${r.backend ? ` (${r.backend})` : ""}`);
      return;
    }
    if (args[1] === "start" || args[1] === "restart") {
      const value = (name) => { const v = flag(name); if (v === true) bail("E_BAD_ARGS", `--${name} needs a value`); return v; };
      const choices = { ...addr, model: value("model"), launchConfig: value("launch-config"), harness: harnessFlag(value), yolo: yoloFlag() };
      if (flag("stop-grace") !== undefined) bail("E_BAD_ARGS", "--stop-grace is currently supported on the execution host; omit it to use the remote restart's default wait");
      let out;
      try { out = (args[1] === "restart" ? restartRemote : startRemote)(id, choices); } catch (e) { bail(e.code || "E_SSH", e.message); }
      if (out.stderr?.trim()) process.stderr.write(out.stderr.endsWith("\n") ? out.stderr : out.stderr + "\n");
      if (JSON_MODE) { console.log(JSON.stringify(withLocalWarnings(out.envelope), null, 2)); if (!out.envelope.ok) process.exit(1); return; }
      if (!out.envelope.ok) die(`${id}: ${out.envelope.error?.message || "start failed"} (${out.envelope.error?.code || "E_REMOTE"})`);
      const r = out.envelope.result;
      console.log(`Started ${r.instance || r.home} on ${id} (${r.backend}${r.model ? `, model ${r.model}` : ""}, ${r.reused === "pane" ? "in its existing pane" : r.reused === "adopted" ? "adopted the pending session" : "new window"})`);
      return;
    }
    if (args[1] === "upload") {
      // Bytes stream to `session receive` on the execution host over the
      // same route as attach; the answer's checksum is verified here.
      const file = flag("file");
      if (!file || file === true) bail("E_BAD_ARGS", "session upload needs --file <local path>");
      let r;
      try { r = uploadAttachment({ file, server: id, ...addr }); } catch (e) { bail(e.code || "E_UPLOAD_FAILED", e.message); }
      if (r.stderr) process.stderr.write(r.stderr + "\n");
      if (JSON_MODE) { jsonOk(r); return; }
      console.log(`Uploaded ${r.name} (${r.bytes} bytes) to ${r.instance || r.home} on ${id}: ${r.path}`);
      return;
    }
    if (args[1] !== "attach") bail("E_USAGE", "--server routes `session inspect`, `session start`, `session restart`, `session upload` and `session attach`; input runs on the execution host (the wake broker calls it there)");
    let route;
    try { route = attachArgv(id, addr, { skipVersionCheck: args.includes("--print") }); }
    catch (e) { bail(e.code || "E_BAD_ARGS", e.message); }
    if (args.includes("--print")) { console.log(route.argv.map(shellQuote).join(" ")); return; }
    const r = spawnSyncProc(route.argv[0], route.argv.slice(1), { stdio: "inherit" });
    process.exit(r.status ?? 1);
  }
  // Everything after the command word travels, minus the routing flags; a
  // local --task-file is read here and travels as --task text, since the
  // remote cannot read this machine's files.
  const rest = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--server") { i++; continue; }
    if (a === "--json") continue;
    if (a === "--task-file") {
      const f = args[++i];
      if (!f || f.startsWith("--")) bail("E_BAD_ARGS", "--task-file needs a path");
      if (!existsSync(f)) bail("E_BAD_ARGS", `task file not found: ${f}`);
      rest.push("--task", readFileSync(f, "utf8"));
      continue;
    }
    // A wake spec for a routed spawn travels as validated JSON text; the
    // host saves it in its own scope. Local files never travel as paths.
    if (a === "--wake-file") {
      const f = args[++i];
      if (!f || f.startsWith("--")) bail("E_BAD_ARGS", "--wake-file needs a path");
      if (!existsSync(f)) bail("E_BAD_ARGS", `wake file not found: ${f}`);
      let doc; try { doc = JSON.parse(readFileSync(f, "utf8")); } catch (e) { bail("E_SCHEDULE_INVALID", `--wake-file is not valid JSON: ${e.message}`); }
      if (!doc || typeof doc !== "object" || !["cron", "tz", "message"].every((k) => typeof doc[k] === "string" && doc[k].trim())) bail("E_SCHEDULE_INVALID", "--wake-file must hold {cron, tz, message, enabled}");
      rest.push("--wake-json", JSON.stringify({ cron: doc.cron, tz: doc.tz, message: doc.message, enabled: doc.enabled === undefined ? true : doc.enabled }));
      continue;
    }
    if (a === "--wake-message-file") {
      const f = args[++i];
      if (!f || f.startsWith("--")) bail("E_BAD_ARGS", "--wake-message-file needs a path");
      if (!existsSync(f)) bail("E_BAD_ARGS", `wake message file not found: ${f}`);
      rest.push("--wake-message", readFileSync(f, "utf8"));
      continue;
    }
    rest.push(a);
  }
  let routed;
  try { routed = routeCommand(id, cmd, rest); }
  catch (e) { bail(e.code || "E_SSH", e.message); }
  const { envelope, stderr } = routed;
  if (stderr && stderr.trim()) process.stderr.write(stderr.endsWith("\n") ? stderr : stderr + "\n");
  if (JSON_MODE) { console.log(JSON.stringify(withLocalWarnings(envelope), null, 2)); if (!envelope.ok || envelope.result?.rollbackIncomplete) process.exit(1); return; }
  if (!envelope.ok && !(cmd === "retire" && envelope.result)) die(`${id}: ${envelope.error?.message || "remote command failed"} (${envelope.error?.code || "E_REMOTE"})`);
  const r = envelope.result;
  const target = r.target || {};
  if (cmd === "spawn") {
    console.log(`Spawned ${r.instance} on ${id} (${r.work}${r.branch ? `, branch ${r.branch}` : ""})${r.launched ? ` — tmux window "${r.tmux?.window}" on ${r.target.sshHost}` : " — not launched"}`);
    console.log(`  remote home: ${r.home}`);
    console.log(`  route snapshot: ${r.snapshot ? shortPath(r.snapshot) : "none (see the warning)"}`);
    for (const w of r.warnings || []) console.log(`  WARNING: ${w}`);
    console.log(`  attach: ssh -t ${r.target.sshHost} tmux attach -t ${r.tmux?.session || "oats"}`);
  } else if (cmd === "retire") {
    // Everything the local retireCmd tells the operator, for a remote home
    // they cannot see: forced-incomplete state now theirs to remove by hand
    // there, work preserved there and where, and incomplete cleanup.
    if (r.forcedIncomplete) {
      console.error(`Removed ${r.retired} on ${id} under --force with cleanup INCOMPLETE — this external state was NOT cleaned up and is now yours to remove by hand on ${target.sshHost}:`);
      for (const f of r.forcedIncomplete) console.error(`  ${f}`);
    }
    console.log(`Retired ${r.retired} on ${id}${r.deferred ? " (deferred completion scheduled there)" : ""}${r.rollbackIncomplete ? " — cleanup INCOMPLETE on the server, home retained there" : ""}`);
    for (const recovery of r.workRecoveries || (r.workRecovery ? [r.workRecovery] : [])) {
      console.log(`Work that was not committed has been preserved on ${target.sshHost}: ${(recovery.classes || []).join(", ")}`);
      console.log(`  ${recovery.path}${typeof recovery.bytes === "number" ? ` (${formatBytes(recovery.bytes)})` : ""}`);
      for (const line of preservedOutputLines(recovery)) console.log(line);
    }
    if (r.rollbackIncomplete) { for (const f of r.rollbackIncomplete) console.error(`  ${f}`); console.error(`Fix the cause there and re-run \`oats retire ${r.retired} --server ${id}\`.`); process.exit(1); }
  } else {
    console.log(`oats status — server ${id} (ssh ${r.target.sshHost}, workspace ${r.target.workspace})\n`);
    for (const a of r.agents || []) {
      console.log(`  ${a.name}  [work: ${a.work || "checkout"}, repo: ${a.repo || "?"}]`);
      for (const i of a.instances || []) console.log(`      • ${i.instance}  ${i.retirePending ? "RETIRING" : i.running ? "RUNNING" : "idle"}`);
    }
    const snaps = r.snapshots || [];
    if (snaps.length) console.log(`\n  spawned from this machine: ${snaps.map((s) => s.instance).join(", ")}`);
  }
}

// ---------- main ----------
// Typed config-shape failures are DEPLOYMENT state the operator can fix, not
// kernel bugs: an unsafe mapping key anywhere in the visible config chain is
// raised by the readers, which every command walks before it can do anything.
// Without this boundary `oats doctor`, `oats use` and every --json mode printed a
// raw Node stack with empty stdout — no code, no envelope, nothing to act on.
// Deliberately narrow: only codes with a defined rendering are caught here;
// anything else still crashes loudly.
//
// The dispatch chain below is deliberately NOT re-indented into this try block:
// keeping it at column 0 makes the whole command table one reviewable diff of
// added lines rather than ~150 lines of pure whitespace churn, and keeps `git
// blame` pointing at the commit that last changed each command.
const TYPED_CLI_FAILURES = new Set(["unsafe-config-key", "unsafe-config-value"]);
/** Removed 0.24 verbs → their v2 replacement (workspace model v2, decision 5). Checked before capability dispatch. */
const REMOVED_VERBS = { prepare: "`oats onboard` / `oats sync` to set up a workspace, and `oats spawn <soul> --preview` to see what a spawn would resolve (the captured/portable path was removed in 0.26)", create: "author souls/<name>/soul.yaml + AGENTS.md in a member repository, then `oats sync`", type: "the soul's own soul.yaml in its member repository (agent types were a classic config block)", soul: "the soul's soul.yaml / AGENTS.md in its member repository, then `oats sync` (per-spawn choices: spawn flags or a launch configuration)", install: "oats sync", restore: "oats sync", init: "oats-local.yaml + oats sync", use: "soul.yaml capabilities: { <cap>: { from } } + workspace defaults", trust: "declaring the package in packages: (package approval was removed; oats sync locks commit + integrity)", list: "oats workspace status | oats capabilities", catalog: "oats package add <id> <version> (bare versions resolve through package-catalog.json)", remove: "oats package remove <id>", migrate: "a rebuild (no migration: docs/design/2026-09-23-workspace-module-contracts.md)", config: "oats-local.yaml (host settings) and oats-workspace.yaml (shared)", inject: "injection overrides are not part of the workspace model yet; edit the capability inject in its member repo" };
try {
// The captured/portable path was removed in 0.26 (lead decisions on (e), D2/D3):
// its selectors and an inherited captured context are refused, never quietly
// resolved against the current context instead. `version` answers regardless:
// host protocol negotiation describes this executable.
{
  // The kernel's own argv only: a capability command's flags are its provider's to parse.
  const kernelArgv = (KERNEL_COMMANDS.has(cmd) && !OWN_ARGV_COMMANDS.has(cmd)) || (ROUTED_COMMANDS.has(cmd) && flag("server") !== undefined);
  if (argvProblem && kernelArgv) cmdFail("E_BAD_ARGS", argvProblem);
  const end = args.indexOf("--"), head = end < 0 ? args : args.slice(0, end);
  const selector = head.find((a) => /^--(deployment|resolution|artifact-set)$/.test(a));
  const refuse = (message, details) => { if (JSON_MODE) jsonFail("E_UNSUPPORTED_MODE", message, details); die(message); };
  if (selector) refuse(`${selector}: a captured selector is refused (the captured/portable path was removed in 0.26); run the command in its workspace deployment or instance home instead`, { selector });
  const inherited = ["OATS_RESOLUTION", "OATS_DEPLOYMENT"].filter((k) => process.env[k]);
  if (inherited.length && cmd !== "version") refuse(`this environment carries a captured context (${inherited.join(", ")}): the captured/portable path was removed in 0.26, and nothing is run against the current context in its place — retire the captured home and re-spawn it from the deployment`, { inherited });
  if (cmd === "inspect" && head.includes("--request")) {
    const message = "oats inspect --request (portable onboarding inspection) is gone (the captured/portable path was removed in 0.26); use `oats onboard` / `oats sync` to set up a workspace and `oats spawn <soul> --preview` to see what a spawn would resolve";
    if (JSON_MODE) jsonFail("E_UNKNOWN_COMMAND", message, { removed: "inspect --request", replacement: "oats onboard / oats sync; oats spawn --preview" });
    die(message);
  }
}
if (cmd === "onboard") {
  if (args.includes("--help") || args.includes("-h")) { if (JSON_MODE) jsonOk({ command: cmd, usage: usageLinesFor(cmd) }); else usageFor(cmd); process.exit(0); }
  await onboardCmd();
}
else {
// `--help`/`-h` anywhere after a kernel command prints that command's usage
// and exits 0 BEFORE any dispatch: a fresh operator inspects --help before
// using a command, and `install --help` once ran the bare restore while
// `okf harvest --help` spawned a harvester (BeadHub, 2026-09-05).
const wantsHelp = args.slice(1).some((a) => a === "--help" || a === "-h");
if (cmd && KERNEL_COMMANDS.has(cmd) && wantsHelp) { if (JSON_MODE) { jsonOk({ command: cmd, usage: usageLinesFor(cmd) }); process.exit(0); } usageFor(cmd); process.exit(0); }
if (flag("server") !== undefined && ROUTED_COMMANDS.has(cmd)) await serverRouteCmd();
else if (cmd === "server") serverCmd();
else if (cmd === "inspect") await inspectCmd();
else if (cmd === "operation") await operationCmd();
else if (cmd === "launch-config") await launchConfigCmd();
else if (cmd === "doctor") {
  const doctorDir = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
  await (args.includes("--json") ? doctorJson(doctorDir) : doctor(doctorDir));
}
else if (cmd === "update") {
  // `oats update <package>` left with the installed tier (packages are pinned in
  // the workspace file: `oats package add`); only the kernel self-update remains.
  const t = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
  if (t || flag("to") !== undefined) { cmdFail("E_BAD_ARGS", "oats update takes no package: pin package versions in oats-workspace.yaml (`oats package add <id> <version>`), then `oats sync`; bare `oats update [--check] [--yes]` updates the kernel"); process.exit(1); }
  updateCmd();
}
else if (cmd === "readiness") await readinessCmd();
else if (cmd === "instance") instanceCmd();
else if (cmd === "root") console.log(resolve(new URL("..", import.meta.url).pathname));
else if (cmd === "sync") await syncCmd();
else if (cmd === "package") await packageCmd();
else if (cmd === "workspace") await workspaceCmd();
else if (cmd === "capabilities" || cmd === "souls") await itemsCmd(cmd);
else if (cmd === "status") await status();
else if (cmd === "pane") await paneCmd();
else if (cmd === "version" || cmd === "--version" || cmd === "-v") versionCmd();
// Same rule as the inner catch: a typed CLI failure surfaces with its own code
// through the shared boundary, never re-badged as a spawn-mechanism failure.
else if (cmd === "session") await sessionCmd();
else if (cmd === "schedule") scheduleCmd();
else if (cmd === "trigger") await triggerCmd();
else if (cmd === "spawn") { try { await spawnCmd(); } catch (e) { if (TYPED_CLI_FAILURES.has(e?.code)) throw e; if (JSON_MODE) jsonFail("E_SPAWN_FAILED", e.message || e); throw e; } }
else if (cmd === "retire") retireCmd();
else if (cmd === "capture" || cmd === "recall" || cmd === "setup") await recordCmd(cmd);
else if (cmd === "experimental") await experimentalCmd();
// `!HELP_WORDS.has(cmd)`: usage NEVER depends on deployment state. `help` is a
// word, so without this it reaches the capability dispatch, which resolves the
// config chain and reads every lock in it — and a scope whose lock the kernel
// refuses could then not print its own usage, which is exactly when you need it.
// A removed 0.24 verb names its v2 replacement in BOTH modes, before any capability namespace could shadow it.
else if (cmd && Object.hasOwn(REMOVED_VERBS, cmd)) {
  const message = `unknown command "${cmd}" — removed by the workspace model v2; use ${REMOVED_VERBS[cmd]}`;
  if (JSON_MODE) jsonFail("E_UNKNOWN_COMMAND", message, { removed: cmd, replacement: REMOVED_VERBS[cmd] });
  console.error(`oats: ${message}\n`);
  console.log(usageText());
  process.exit(1);
}
else if (cmd && !cmd.startsWith("--") && !HELP_WORDS.has(cmd) && await capabilityCommand()) { /* dispatched */ }
// No matching kernel command or capability namespace: in --json mode the help
// text must NOT contaminate stdout — still one envelope object, nonzero exit.
else if (cmd && !cmd.startsWith("--") && !HELP_WORDS.has(cmd) && JSON_MODE) jsonFail("E_UNKNOWN_COMMAND", `unknown command "${cmd}" — no kernel subcommand or active capability namespace matches`);
else {
  if (cmd && !HELP_WORDS.has(cmd) && !cmd.startsWith("--")) console.error(`oats: unknown command "${cmd}" — no kernel subcommand or active capability namespace matches\n`);
  console.log(usageText());
  process.exit(cmd && !HELP_WORDS.has(cmd) ? 1 : 0);
}
} // end: every command but onboard

/** The usage lines for one kernel command (its `oats <cmd> ...` lines and
 *  their indented continuations), or the whole usage when none match. */
function usageLinesFor(name) {
  const out = [];
  let inside = false;
  for (const line of usageText().split("\n")) {
    if (new RegExp(`^  oats ${name}(\\s|$)`).test(line)) { out.push(line); inside = true; continue; }
    if (inside && /^ {6}/.test(line) && !/^  oats /.test(line)) { out.push(line); continue; }
    inside = false;
  }
  return out;
}
function usageFor(name) {
  const out = usageLinesFor(name);
  console.log(out.length ? `Usage:\n${out.join("\n")}` : usageText());
}

function usageText() {
  return `oats — Open Agent Team Specification

Usage:
  oats version [--json]                      kernel version; --json emits the
                                            Desktop CLI API v1 probe payload
  oats status [--json]                       agents, souls, running instances
  oats server add <id> --ssh <alias>         register another machine's OATS (OpenSSH alias,
      --workspace </abs/path> [--oats <p>]   remote workspace, remote oats path; no keys stored;
      [--path <dir:dir>]                    --path = dirs prepended to the remote PATH, e.g. ~/.local/bin)
  oats server list|remove <id>|check <id>    registry; check = reachability + version, no mutation
  oats spawn|retire|status ... --server <id> run that command on the server's installed oats
                                            (same flags, same envelope; the saved route per
                                            remote instance lives under ~/.oats/remote/)
  oats server roster [--server <id>]         remote roster grouped by server and saved route
      [--budget <ms>] [--per-target <ms>]   target: one status pull per group within a total
      [--json]                              budget (45 s, 20 s per target); saved routes are
                                            the authority for actions
  oats server forget <id> --instance <name>  drop a saved route whose remote instance is gone
                                            (the roster shows it as missingRemotely)
  oats retire <instance> --home <path>       retire exactly that home when two agents own an
                                            instance of the same name (else refused)
  oats okf harvest --server <id>             run the knowledge harvest in a remote instance's
      --instance <name> [--json]            saved home on its host
  oats session inspect|attach --server <id>  inspect (envelope) or attach a viewer (ssh PTY) for a
      --instance <name> | --home <abs>       remote instance over its saved route (--print shows
                                            attach); the server needs oats 0.22.2 or later
  oats session start --server <id>           start a stopped remote instance in its existing home
      --instance <name> | --home <abs>       over its saved route; the server must advertise
      [--model <m>] [--json]                 session-start (oats 0.22.9 or later)
  oats inspect|operation --server <id>        the same commands on a registered server over its
      ... [--dir <remote member>] [--home <abs>]  saved route (an explicit --dir travels as is; a --home
                                            is its own context; else the registered workspace);
                                            the server must advertise operations (oats 0.22.16 or later)
  oats session upload --server <id>          copy a local file into a remote instance's private
      --instance <name> | --home <abs>       attachments over its saved route (bytes stream on
      --file <path> [--json]                 ssh stdin; sha256 verified); the server must
                                            advertise session-upload (oats 0.22.13 or later)
  oats onboard [<dir>] --workspace <repo ref> realize a workspace here: writes <dir>/oats-local.yaml
      [--json]                               and agents/, then runs the oats sync path (lock v3)
                                            and prints the
                                            next steps (clone members you work IN, spawn
                                            oats-operator-expert); creates no soul, spawns nothing
  oats session inspect|input|attach --home <absolute-home> [--text-file <path>] [--json]
  oats schedule list|show <id>|add <id> --file <spec.json>|update <id> --file <spec.json>
      enable|disable|run|remove|reconcile <id>   workspace-scoped, host-owned schedules (spawn,
      tick [--dry-run] [--host]                  command or wake jobs on a five-field cron with an
      host install|uninstall|status              explicit IANA tz; see docs/schedules.md); --server
                                                routes to that host's workspace
  oats trigger add (--file <json> | --from <package>:<template> [--set k=v]) | list | show | enable
      | disable | remove <id> | test <id> | status [<id>]   event-driven spawns (github.pull_request
                                                polled with the host's gh by the schedule tick;
                                                see docs/schedules.md#triggers)
  oats spawn ... --wake-file <json> | --wake-every <N> --wake-message <text>  save a wake schedule
                                                bound to the new instance's home (docs/schedules.md)
  oats session upload --file <path>          store a copy of a local file as a private attachment
      --home <absolute-home> [--json]         in the instance home (.oats-attachments/); answers
                                            {path, bytes, sha256}; never types into the session
  oats session receive --home <abs> --name   store attachment bytes read from stdin (the routed
      <file> [--json]                       upload's remote half)
  oats session start --home <absolute-home>  start a STOPPED instance again in its existing home
      [--model m] [--launch-config n|none]  (recorded recipe as is; a selection re-resolves it
      [--harness r] [--yolo|--no-yolo]      against the scope; a named configuration is a unit)
  oats session restart --home <abs-home>     stop the running harness (SIGTERM, bounded wait,
      [same flags] [--stop-grace <s>]        never escalated) and start it again in place under
                                            the same lock; a stop that is not observed is
                                            reported and nothing is launched
      [--model <m>] [--json]                 (same identity, worktree, notes and launch env; no
                                            spawn hooks); --model replaces the recorded model
                                            for this and later starts; a live harness is refused
  oats spawn <agent> [--task <text>]         spawn an instance (tmux/Herdr; --no-launch
      [--purpose <slug>] [--repo <r>]       = scaffold only); the agent is a workspace
      [--parent <instance>]                 soul or a capability-defined agent
      [--relation child|sibling|parent|unrelated]    --relation + --relative-to anchor the
      [--relative-to <instance>]            new instance to an existing one; --parent X
      [--relative-root <agents-root>]       disambiguates same-named team anchors
      [--work worktree|checkout|attached|workspace|directory]  = sugar for --relative-to X --relation
      [--work-dir <owner-work>] [--harness pi|claude|codex] [--backend tmux|herdr] [--herdr-socket <path>] [--yolo|--no-yolo] [--model <m>] [--branch <b>]  child (default: unrelated, top-level)
      [--no-launch] [--json]
                                            with team: declared, unknown souls
                                            resolve across the team scope's repos
                                            directory: owned home/work, config context may
                                            be non-Git; rejects --work-dir and --branch
      [--name <slug>]                        the exact instance name (no <agent>- prefix;
                                            not with --purpose); must be a slug, not a
                                            soul name, and unused in the deployment
  oats retire <instance> [--force]           retire an instance (window, hooks,
      [--self] [--delete-branch]            worktree, home); --self = retire the
      [--keep-dir] [--json]                 CALLING instance: the window dies, then
                                            a detached external retirement runs
  oats inspect [--dir <scope>] [--soul <name>   one authoritative JSON answer for a GUI: souls
      [--agents-root <abs>]] [--home <abs>]   (harness defaults, editability, instructions),
      [--json]                              installed capabilities with health, effective
                                            layer bindings and activation, declared
                                            operations with availability; --home answers the
                                            running home's recorded modules and their drift
                                            from the deployment
  oats operation run <layer>:<name>          run an operation the soul's core capability for that
      (--home <abs> | --soul <name> [--dir <d>])  layer declares (knowledge:harvest, knowledge:
      [--arg k=v ...] [--json]              inspect ...): resolved from the home's recorded
                                            modules or the deployment's soul, trust checked, the provider's
                                            own command run in the home or scope, envelope
                                            relayed; a view answers {documents: [...]}
  oats launch-config list [--dir <scope>     named launch configurations effective at a scope,
      | --home <abs> | --soul <name>]       a home's recorded context or a soul's own scope:
      [--agents-root <abs>] [--json]        harness, executable, args, env (values redacted,
                                            references shown), model, yolo; the closest
                                            declaring scope provides the whole entry
  oats launch-config set <name> --file <j>   declare or replace one at this scope from a JSON
      [--keep-env] [--dir <scope>] [--json] file (only the launch-configs block is rewritten;
                                            --keep-env copies the effective definition's env)
  oats launch-config remove <name>           remove this scope's declaration; an ancestor's,
      [--dir <scope>] [--json]              if any, becomes effective again
  oats launch-config preview                 what a start would run: resolved harness, model,
      (--home <abs> | --soul <name>)        yolo, executable, argv, environment (redacted),
      [--launch-config <name>|none]         command and preflight; read-only, nothing
      [--harness r] [--model m]             started; a named configuration is a unit, so
      [--yolo | --no-yolo] --json           a disagreeing --harness is refused
  oats doctor [dir] [--soul <name>] [--json] resolved targets, trust, requirements;
                                            --soul shows final composed AGENTS.md
  oats update [--check] [--yes]              check npm for a newer kernel+pi bridge and
                                            optionally run the update; then run oats doctor
  oats sync [--dir <d>] [--json]             workspace model v2: observe the workspace named by
                                            oats-local.yaml over its Git remote, confirm every
                                            member (reciprocal oats-membership.yaml), resolve
                                            packages: to exact commits + integrity, write
                                            oats-lock.json (v3) and report the diff. No approval
                                            step: declaring a package in packages: is the trust
                                            decision (--approve is E_BAD_ARGS)
  oats package add <id> <version|git:<repo>@<ref>>  edit packages: in oats-workspace.yaml when the
      | remove <id>  [--dir <d>]            workspace repo is the current checkout; otherwise
                                            print the line to add (the file travels through Git)
  oats workspace status [--dir <d>] [--json] membership table (confirmed / no-backlink /
                                            cannot-read / backlink-elsewhere), locked packages
  oats capabilities [--dir <d>] [--json]     every capability of every confirmed member (a
                                            private one is listed as repo-owned: usable only by
                                            its own repo's souls) + the locked packages
  oats souls [--dir <d>] [--json]            every soul of every confirmed member + external souls
                                            (souls have no private mode), with origin
                                            (member <key> @ <commit> | package <id> v<ver>) and team
  oats instance git <instance> [--home <abs>] [--dir <d>] [--json]
                                             read-only Git observation of the instance's work
                                             tree: branch, status (renames kept), ahead/behind
                                             vs upstream AND vs default-branch merge-base
  oats instance diff <instance> --file <id> --revision <rev> [--index-revision <rev>] [--home <abs>] [--dir <d>] [--json]
                                             bounded diff of one observed file; refuses when
                                             the tree moved since the observation
  oats instance events <instance> [--limit <n>] [--since <iso>] [--json]
                                             typed lifecycle events (spawned, launched, stopped,
                                             restarted, retired, worktree-retained…) written by
                                             the action that made them true; nothing inferred
  oats instance stop <instance> --plan [--no-recursive] [--json]
                                             what Stop would touch: session state, recorded
                                             children, dirty work; a planRevision to apply
  oats instance stop <instance> --apply --plan-revision <rev> --idempotency-key <key>
                                             quiesce (SIGTERM, bounded, never escalated),
                                             children first; home/work/launch retained
  oats readiness (--soul <n> | --home <abs>) [--policy] [--json]
                                             readinessApi 2 for a soul or an instance home:
                                             installed | configured | member | providers, each
                                             pass|fail|unknown|not-applicable with items and
                                             remedies; providers relays each bound provider's
                                             own check ({status, problems, warnings});
                                             --policy: enforced child-spawn / worktree policy
                                             with origins (captured homes refuse: the
                                             captured/portable path was removed in 0.26)
  oats retire <instance> --plan [--json]     what Remove would touch, with retention defaults
  oats retire <instance> [--plan-revision <rev> --idempotency-key <key>] [--discard-worktree] [--delete-branch]
                                             with a plan revision: refuses E_PLAN_STALE (fresh plan
                                             attached) if facts moved; a repeated key replays
                                             retire; a worktree is RETAINED (re-homed under
                                             <workspace>/.agents/worktrees/<repo>/<branch>)
                                             unless discarded; --delete-branch deletes the
                                             worktree's verified branch and implies discard
  oats root                                  print this package's install root
                                            (adapters resolve the kernel from it)

The turn record (core — every conversation captured, searchable, replicated):
  oats capture [--watch|--status]            land Claude Code/pi/codex sessions and aw
      [--owner <name>] [--root <dir>]       client logs in the record; reconciliation
                                            is the capture
  oats recall [--kind k] [--thread t]        search the whole record — mail, chat,
      [--from f] [--show id] <query>        sessions — with exact turn provenance
  oats setup [--owner <name>] [--dry-run]    install capture hooks + background watcher
      [--no-service] [--no-hooks]           (launchd/systemd), then run the first pass

  oats experimental <dress|spawn|segments|mind>   EXPERIMENTAL tools over the record —
                                            selection and agent synthesis; unproven by
                                            design, repo checkout only; see
                                            packages/experimental/README.md

  oats <namespace> <command> [args…]         run an operational command only when its
                                            capability is active (e.g. oats okf harvest)

Layers: ${LAYERS.join(", ")}. Workspace model v2: docs/design/2026-09-23-workspace-module-contracts.md.`;
}
} catch (e) {
  if (!TYPED_CLI_FAILURES.has(e?.code)) throw e;
  // Same two renderings as every other typed failure: one envelope on stdout in
  // --json mode, one `oats: <message>` line on stderr otherwise. The message
  // already names the offending file — the readers re-raise it with one.
  if (JSON_MODE) jsonFail(e.code, e.message);
  die(e.message);
}
