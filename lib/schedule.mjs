/** OATS schedules v1: workspace-scoped definitions, host-owned execution.
 *
 *  A definition lives in <scope>/oats-schedules.json, where the scope is the
 *  team workspace (the config level declaring the team, else the outermost
 *  oats-config.yaml level), and is evaluated by the host that holds that
 *  scope: one host registry, one host lock, one host timer that runs
 *  `oats schedule tick --host` once a minute. The tick is a short-lived
 *  process; there is no daemon, no queue and no retry. Only the current
 *  minute is evaluated, so minutes missed while the machine slept are
 *  skipped, never replayed. Cron expressions (five fields, an explicit IANA
 *  zone) are evaluated by croner; nothing here parses cron.
 *
 *  Three kinds: `spawn` launches one disposable instance per due minute,
 *  `command` runs an oats-only argv in a scope cwd and tracks any instance
 *  the envelope names, `wake` starts an existing home when it is stopped and
 *  delivers a literal message once when it is active. Outcomes say what was
 *  observed (launched, active, ended, stopped, launch-failed, unknown;
 *  delivered, started, skipped for wake) and never claim that a task
 *  succeeded. A launch whose side effects cannot be confirmed stays
 *  `unknown` with its slot held until `reconcile` proves what happened. */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Cron } from "croner";
import { ensureRoot, findAgent, findCapabilityAgent, findInstanceHomes, teamAgentRoots, configChain, spawnInstance, inspectInstanceSession, inputInstanceSession, startInstanceSession, retirePendingMarkerPath } from "./core.mjs";

export const SCHEDULE_FILE = "oats-schedules.json";
export const SCHEDULE_API = 1;
const ID_RE = /^[a-z0-9-]{1,40}$/;
const RUNTIMES = new Set(["pi", "claude", "codex"]);
const BACKENDS = new Set(["tmux", "herdr"]);
const MESSAGE_MAX = 256 * 1024;
const OATS_BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "oats.mjs");
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

export function scheduleError(code, message, extra) { return Object.assign(new Error(message), { code, ...(extra || {}) }); }
/** A stored definition that is not even shaped like one (a hand edit): it
 *  is never observed or executed, and is reported invalid on that job only. */
export function shapeError(def) {
  if (!def || typeof def !== "object" || Array.isArray(def)) return "definition is not an object";
  if (!["spawn", "command", "wake"].includes(def.kind)) return `kind ${JSON.stringify(def.kind)} is not spawn, command or wake`;
  if (typeof def.cron !== "string" || typeof def.tz !== "string") return "cron and tz must be strings";
  if (def.kind === "spawn" && typeof def.agent !== "string") return "agent must be a string";
  if (def.kind === "command" && (typeof def.cwd !== "string" || !Array.isArray(def.argv))) return "cwd and argv are required";
  if (def.kind === "wake" && (typeof def.home !== "string" || typeof def.message !== "string")) return "home and message are required";
  return null;
}

// ---------------------------------------------------------------- scope

/** The one schedule-owning scope for a directory: the config level that
 *  declares the team (the deployment boundary), else the outermost level
 *  carrying oats-config.yaml, else the workspace above the agents root. */
export function scheduleScopeOf(dir) {
  const start = resolve(dir);
  let chain = [];
  try { chain = configChain(start); } catch { chain = []; }
  const team = chain.find((c) => c.team);
  if (team?._level) return resolve(team._level);
  if (chain.length) return resolve(chain[chain.length - 1]._level);
  try { return dirname(ensureRoot(start)); } catch { return start; }
}
/** Every agents root the scope knows: its own, member repositories', and any
 *  root that holds instance homes. */
export function scopeRoots(scope) {
  const roots = new Set();
  try { roots.add(resolve(ensureRoot(scope))); } catch { /* a scope with no agents dir */ }
  try { for (const r of teamAgentRoots(scope)) roots.add(resolve(r)); } catch { /* not a team scope */ }
  return [...roots];
}

// ------------------------------------------------------------- files

export function oatsHomeDir() { return process.env.OATS_HOME_DIR || join(homedir(), ".oats"); }
export function hostScheduleDir() { return join(oatsHomeDir(), "schedules"); }
export function definitionsPath(ws) { return join(ws, SCHEDULE_FILE); }
export function stateDir(ws) { return join(ws, ".agents", "schedules"); }
function statePath(ws) { return join(stateDir(ws), "state.json"); }
function lockDir(ws, id) { return join(stateDir(ws), "locks", id); }

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { throw scheduleError("E_SCHEDULE_INVALID", `${path} is not valid JSON: ${e.message}`, { field: "file" }); }
}
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, path);
}
export function readDefinitions(ws) {
  const doc = readJson(definitionsPath(ws), { version: 1, jobs: {} });
  if (doc.version !== 1 || typeof doc.jobs !== "object" || doc.jobs === null || Array.isArray(doc.jobs)) throw scheduleError("E_SCHEDULE_INVALID", `${definitionsPath(ws)} must be {version: 1, jobs: {}}`, { field: "file" });
  return doc;
}
export function writeDefinitions(ws, doc) { writeJson(definitionsPath(ws), doc); }
export function readState(ws) { const st = readJson(statePath(ws), { jobs: {} }); if (!st.jobs || typeof st.jobs !== "object") st.jobs = {}; return st; }
export function writeState(ws, st) { writeJson(statePath(ws), st); }

// ------------------------------------------------------- host registry

export function readRegistry() {
  const reg = readJson(join(hostScheduleDir(), "registry.json"), { version: 1, maxConcurrent: 1, tickIntervalSec: 60, workspaces: [] });
  if (!Array.isArray(reg.workspaces)) reg.workspaces = [];
  if (!Number.isInteger(reg.maxConcurrent) || reg.maxConcurrent < 1) reg.maxConcurrent = 1;
  if (!Number.isInteger(reg.tickIntervalSec) || reg.tickIntervalSec < 60) reg.tickIntervalSec = 60;
  return reg;
}
export function writeRegistry(reg) { writeJson(join(hostScheduleDir(), "registry.json"), reg); }
export function registerWorkspace(ws) { return withRegistryLock(() => { const reg = readRegistry(); const abs = resolve(ws); if (!reg.workspaces.includes(abs)) { reg.workspaces.push(abs); writeRegistry(reg); } return reg; }); }
export function unregisterWorkspace(ws) { return withRegistryLock(() => { const reg = readRegistry(); reg.workspaces = reg.workspaces.filter((w) => w !== resolve(ws)); writeRegistry(reg); return reg; }); }
export function readHostState() { return readJson(join(hostScheduleDir(), "state.json"), {}); }
export function writeHostState(st) { writeJson(join(hostScheduleDir(), "state.json"), st); }

// ---------------------------------------------------------------- locks

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } }
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** A mkdir lock that is never reclaimed by another process: an existing
 *  lock whose owner is unreadable or dead is refused with the directory to
 *  remove, because the gap between mkdir and owner.json belongs to a live
 *  acquirer and a dead-owner reclaim races every other acquirer. The
 *  holder removes its own lock in finally and on SIGINT/SIGTERM. */
function withDirLock(dir, what, fn, { retryMs = 0 } = {}) {
  mkdirSync(dirname(dir), { recursive: true });
  const deadline = Date.now() + retryMs;
  for (;;) {
    try { mkdirSync(dir); break; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      let owner; try { owner = JSON.parse(readFileSync(join(dir, "owner.json"), "utf8")); } catch { owner = undefined; }
      if (owner?.pid && pidAlive(owner.pid) && Date.now() < deadline) { pause(50); continue; }
      const why = !owner ? "its owner is not readable yet or the file is missing" : pidAlive(owner.pid) ? `pid ${owner.pid} holds it` : `its owner pid ${owner.pid} is gone`;
      throw scheduleError("E_SCHEDULER_BUSY", `${what} is locked (${why}). If no oats schedule process is running, remove ${dir} and retry; nothing was changed.`);
    }
  }
  writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid: process.pid, at: new Date().toISOString(), what }) + "\n");
  const release = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };
  const onSignal = (sig) => { release(); process.exit(sig === "SIGINT" ? 130 : 143); };
  process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
  try { return fn(); }
  finally { process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal); release(); }
}
export function withHostLock(fn, { retryMs = 0 } = {}) { return withDirLock(join(hostScheduleDir(), "host.lock"), "the host scheduler", fn, { retryMs }); }
/** Registry read-modify-write is serialized on its own short lock. */
function withRegistryLock(fn) { return withDirLock(join(hostScheduleDir(), "registry.lock"), "the host schedule registry", fn, { retryMs: 3000 }); }
/** Definitions and state are read-modify-write; CRUD serializes here briefly. */
function withScopeLock(ws, fn) { return withDirLock(join(stateDir(ws), "scope.lock"), `schedules of ${ws}`, fn, { retryMs: 3000 }); }

export function acquireJobLock(ws, id, owner) {
  const dir = lockDir(ws, id);
  mkdirSync(dirname(dir), { recursive: true });
  try { mkdirSync(dir); } catch (e) { if (e.code === "EEXIST") return false; throw e; }
  writeFileSync(join(dir, "owner.json"), JSON.stringify({ ...owner, pid: process.pid, at: new Date().toISOString() }, null, 2) + "\n");
  return true;
}
export function jobLockInfo(ws, id) {
  const dir = lockDir(ws, id);
  if (!existsSync(dir)) return null;
  try { return JSON.parse(readFileSync(join(dir, "owner.json"), "utf8")); } catch { return { unreadable: true }; }
}
export function releaseJobLock(ws, id) { rmSync(lockDir(ws, id), { recursive: true, force: true }); }
function liveLocks(wsList) {
  let n = 0;
  for (const ws of wsList) {
    const dir = join(stateDir(ws), "locks");
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) n++;
  }
  return n;
}

// ------------------------------------------------------------ validation

function inside(ws, p) { return (resolve(p) + sep).startsWith(resolve(ws) + sep); }
export function validateCron(cron, tz, field = "cron") {
  if (typeof cron !== "string" || cron.trim().split(/\s+/).length !== 5) throw scheduleError("E_SCHEDULE_INVALID", `${field}: five fields required (minute hour day month weekday)`, { field });
  if (typeof tz !== "string" || !tz.trim()) throw scheduleError("E_SCHEDULE_INVALID", "tz: an explicit IANA time zone is required", { field: "tz" });
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { throw scheduleError("E_SCHEDULE_INVALID", `tz: unknown time zone ${JSON.stringify(tz)}`, { field: "tz" }); }
  try { return new Cron(cron.trim(), { timezone: tz, paused: true }); }
  catch (e) { throw scheduleError("E_SCHEDULE_INVALID", `${field}: ${e.message}`, { field }); }
}
function validateMessage(message, field) {
  if (typeof message !== "string" || !message.trim() || message.includes("\0") || Buffer.byteLength(message) > MESSAGE_MAX) throw scheduleError("E_SCHEDULE_INVALID", `${field}: non-empty text without NUL, at most 256 KiB`, { field });
}

/** Validate and normalize one definition against its scope. */
export function validateDefinition(ws, def, { checkAgent = true } = {}) {
  if (!def || typeof def !== "object" || Array.isArray(def)) throw scheduleError("E_SCHEDULE_INVALID", "definition must be an object", { field: "definition" });
  const id = def.id;
  if (typeof id !== "string" || !ID_RE.test(id)) throw scheduleError("E_SCHEDULE_INVALID", "id: lowercase letters, digits and dashes, 1 to 40 characters", { field: "id" });
  const enabled = def.enabled === undefined ? true : def.enabled;
  if (typeof enabled !== "boolean") throw scheduleError("E_SCHEDULE_INVALID", "enabled: boolean", { field: "enabled" });
  validateCron(def.cron, def.tz);
  const out = { id, enabled, cron: def.cron.trim(), tz: def.tz.trim(), kind: def.kind };
  if (def.kind === "spawn") {
    if (typeof def.agent !== "string" || !def.agent.trim()) throw scheduleError("E_SCHEDULE_INVALID", "agent: soul name required", { field: "agent" });
    out.agent = def.agent.trim();
    if (def.agentsRoot !== undefined) {
      const known = scopeRoots(ws);
      if (typeof def.agentsRoot !== "string" || !isAbsolute(def.agentsRoot) || !inside(ws, def.agentsRoot) || !known.includes(resolve(def.agentsRoot))) throw scheduleError("E_SCHEDULE_INVALID", `agentsRoot: must be one of this scope's agents roots (${known.join(", ") || "none"})`, { field: "agentsRoot" });
      out.agentsRoot = resolve(def.agentsRoot);
    }
    if (def.repo !== undefined) { if (typeof def.repo !== "string" || !def.repo.trim()) throw scheduleError("E_SCHEDULE_INVALID", "repo: the work repository path, as oats spawn --repo", { field: "repo" }); out.repo = def.repo; }
    if (def.backend !== undefined) { if (!BACKENDS.has(def.backend)) throw scheduleError("E_SCHEDULE_INVALID", "backend: tmux or herdr", { field: "backend" }); out.backend = def.backend; }
    if (def.purpose !== undefined) { if (typeof def.purpose !== "string" || !/^[a-z0-9-]{1,40}$/.test(def.purpose)) throw scheduleError("E_SCHEDULE_INVALID", "purpose: lowercase letters, digits and dashes", { field: "purpose" }); out.purpose = def.purpose; }
    if (typeof def.task !== "string" || !def.task.trim()) throw scheduleError("E_SCHEDULE_INVALID", "task: non-empty text", { field: "task" });
    out.task = def.task;
    if (def.runtime !== undefined) { if (!RUNTIMES.has(def.runtime)) throw scheduleError("E_SCHEDULE_INVALID", "runtime: pi, claude or codex", { field: "runtime" }); out.runtime = def.runtime; }
    if (def.model !== undefined) { if (typeof def.model !== "string") throw scheduleError("E_SCHEDULE_INVALID", "model: string", { field: "model" }); out.model = def.model; }
    if (def.yolo !== undefined) { if (typeof def.yolo !== "boolean") throw scheduleError("E_SCHEDULE_INVALID", "yolo: boolean", { field: "yolo" }); out.yolo = def.yolo; }
    if (def.wake !== undefined) {
      const w = def.wake;
      if (!w || typeof w !== "object") throw scheduleError("E_SCHEDULE_INVALID", "wake: {cron, tz, message}", { field: "wake" });
      validateCron(w.cron, w.tz, "wake.cron"); validateMessage(w.message, "wake.message");
      out.wake = { cron: w.cron.trim(), tz: w.tz.trim(), message: w.message };
    }
    if (checkAgent) resolveScheduledAgent(ws, out);
  } else if (def.kind === "command") {
    if (typeof def.cwd !== "string" || !isAbsolute(def.cwd) || !inside(ws, def.cwd) || !existsSync(def.cwd)) throw scheduleError("E_SCHEDULE_INVALID", "cwd: an existing absolute directory inside the scope", { field: "cwd" });
    if (!Array.isArray(def.argv) || !def.argv.length || def.argv.some((a) => typeof a !== "string" || a.includes("\0")) || def.argv[0] !== "oats") throw scheduleError("E_SCHEDULE_INVALID", "argv: oats-only argument list starting with \"oats\"", { field: "argv" });
    if (def.argv[1] === "schedule") throw scheduleError("E_SCHEDULE_INVALID", "argv: a command job may not run oats schedule (it would wait on the host lock the tick holds)", { field: "argv" });
    out.cwd = resolve(def.cwd); out.argv = [...def.argv];
  } else if (def.kind === "wake") {
    if (typeof def.home !== "string" || !isAbsolute(def.home) || !inside(ws, def.home) || !existsSync(join(def.home, "instance.json"))) throw scheduleError("E_SCHEDULE_INVALID", "home: an existing instance home inside the scope", { field: "home" });
    validateMessage(def.message, "message");
    out.home = resolve(def.home); out.message = def.message;
  } else throw scheduleError("E_SCHEDULE_INVALID", "kind: spawn, command or wake", { field: "kind" });
  return out;
}

/** The soul a spawn job launches: the exact agents root the definition
 *  names (agentsRoot, what tells same-named souls in different member
 *  repositories apart), else the scope's own root; the same lookups `oats
 *  spawn` uses (local and persistent souls, then capability-declared
 *  agents). `repo` is the work repository and never selects a soul. */
export function resolveScheduledAgent(ws, def) {
  let root;
  try { root = def.agentsRoot ? ensureRoot(def.agentsRoot) : ensureRoot(ws); }
  catch (e) { throw scheduleError("E_SCHEDULE_INVALID", `agentsRoot: ${e.message}`, { field: def.agentsRoot ? "agentsRoot" : "agent" }); }
  if (def.agentsRoot && resolve(root) !== resolve(def.agentsRoot)) throw scheduleError("E_SCHEDULE_INVALID", `agentsRoot: ${def.agentsRoot} is not an agents root (resolved to ${root})`, { field: "agentsRoot" });
  let agent = findAgent(root, def.agent);
  if (!agent) { try { agent = findCapabilityAgent(dirname(root), root, def.agent); } catch { agent = undefined; } }
  if (!agent) throw scheduleError("E_SCHEDULE_INVALID", `agent: no soul named ${JSON.stringify(def.agent)} under ${root}`, { field: "agent" });
  return { root, agent };
}

// ----------------------------------------------------------------- time

export function minuteStart(now) { return new Date(Math.floor(now.getTime() / 60000) * 60000); }
export function minuteKey(date) { return date.toISOString().slice(0, 16); }
export function cronOf(def) { return new Cron(def.cron, { timezone: def.tz, paused: true }); }
export function nextRunAfter(def, from) { const n = cronOf(def).nextRun(from); return n ? n.toISOString() : null; }
/** Due exactly at this minute: the first run after (minute - 1 s) is this minute. */
export function dueAt(def, minute) { const n = cronOf(def).nextRun(new Date(minute.getTime() - 1000)); return !!n && n.getTime() === minute.getTime(); }
export function purposeSuffix(minute) { return minute.toISOString().slice(0, 16).replace(/[-T:]/g, ""); }
/** Ordering key for admission: when this job last launched a runtime. */
export function launchOrderKey(js) { return String(js?.lastLaunchedAt || ""); }

// ---------------------------------------------------------- observation

/** What a run's instance looks like now. Home gone = ended; a home that is
 *  retiring is still there (its runtime may be alive pending teardown) and
 *  keeps its slot; present but no running harness = stopped (needs
 *  attention, never removed); running = active; not inspectable = unknown. */
export function observeHome(home, io) {
  if (!home) return { outcome: "launched" };
  if (!existsSync(home)) return { outcome: "ended" };
  const retiring = existsSync(retirePendingMarkerPath(home));
  try {
    const s = (io?.inspect || inspectInstanceSession)(home);
    if (s.present && s.state !== "shell") return { outcome: "active", ...(retiring ? { note: "retiring" } : {}) };
    if (retiring) return { outcome: "active", note: "retiring: home present, teardown pending" };
    // A shell right after `session start` is that launch's startup phase
    // until its wrapper writes the exit marker for the launch id; only then
    // (or with no start receipt at all) is a shell a finished runtime.
    if (s.present && s.state === "shell" && startupInProgress(home)) return { outcome: "starting" };
    return { outcome: "stopped" };
  } catch (e) { return { outcome: "unknown", error: e.message }; }
}
function startupInProgress(home) {
  const pendingPath = join(home, ".oats-start-pending.json");
  if (!existsSync(pendingPath)) return false;
  let pending; try { pending = JSON.parse(readFileSync(pendingPath, "utf8")); } catch { return true; }
  const exitedPath = join(home, ".oats-start-exited");
  if (!existsSync(exitedPath)) return true;
  try { return readFileSync(exitedPath, "utf8").trim() !== String(pending.id); } catch { return true; }
}

/** All homes for an instance name across the scope's roster (every known
 *  agents root and its local-agents sibling). */
export function findHomesInScope(ws, instance) {
  const homes = new Set();
  for (const root of scopeRoots(ws)) {
    try { for (const h of findInstanceHomes(root, instance)) homes.add(resolve(h.home || h)); } catch { /* unreadable root */ }
    const local = join(dirname(root), "local-agents");
    if (existsSync(local)) for (const e of readdirSync(local, { withFileTypes: true })) { if (!e.isDirectory()) continue; const h = join(local, e.name, "instances", instance); if (existsSync(join(h, "instance.json"))) homes.add(resolve(h)); }
  }
  return [...homes];
}
// --------------------------------------------------------------- runner

function scheduleBlock(def, minute) {
  return `\n\n## Scheduled run\n\nThis instance was launched by OATS schedule "${def.id}" for ${minute.toISOString()} (cron "${def.cron}" in ${def.tz}). It is disposable: finish the task above, bring your memory files up to date, and end with \`oats retire --self\`.\n`;
}
/** Launch one spawn job. `io.spawn(root, agent, opts)` overrides spawnInstance for tests. */
function launchSpawn(ws, def, minute, io) {
  const { root, agent } = resolveScheduledAgent(ws, def);
  const purpose = `${def.purpose || def.id}-${purposeSuffix(minute)}`;
  const opts = { task: def.task.trimEnd() + scheduleBlock(def, minute), purpose, runtime: def.runtime, model: def.model, yolo: def.yolo, backend: def.backend, repo: def.repo, launch: true };
  const r = (io?.spawn || spawnInstance)(root, agent, opts);
  const run = { instance: r.instance, home: r.home, launched: !!r.instance, kind: "spawn" };
  if (def.wake && r.home) {
    try { run.wakeSchedule = saveWakeForHome(ws, { instance: r.instance, home: r.home, wake: def.wake }); }
    catch (e) { run.wakeScheduleError = { code: e.code || "E_SCHEDULE_INVALID", message: e.message }; }
  }
  return run;
}
/** Parse a command's stdout as one JSON document (remote output can be
 *  multi-line); fall back to the last {...} block; null when nothing parses. */
export function parseEnvelopeText(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { /* fall through */ }
  const i = s.lastIndexOf("\n{");
  if (i >= 0) { try { return JSON.parse(s.slice(i + 1)); } catch { /* fall through */ } }
  const j = s.indexOf("{");
  if (j >= 0) { try { return JSON.parse(s.slice(j)); } catch { /* give up */ } }
  return null;
}
/** Run one command job: oats-only argv in the job's cwd. A timeout or an
 *  unparseable answer means the side effects are unconfirmed: `unknown`,
 *  never `launch-failed`. `io.oatsBin` and `io.commandTimeoutMs` are test seams. */
function launchCommand(ws, def, io) {
  const argv = def.argv.includes("--json") ? def.argv.slice(1) : [...def.argv.slice(1), "--json"];
  let envelope, timedOut = false, raw = "";
  if (io?.command) envelope = io.command({ cwd: def.cwd, argv });
  else {
    const env = { ...process.env }; delete env.OATS_INSTANCE; delete env.OATS_INSTANCE_HOME; delete env.PI_AGENT_INSTANCE; delete env.PI_AGENT_HOME;
    const r = spawnSync(process.execPath, [io?.oatsBin || OATS_BIN, ...argv], { cwd: def.cwd, encoding: "utf8", timeout: io?.commandTimeoutMs || COMMAND_TIMEOUT_MS, killSignal: "SIGTERM", maxBuffer: 16 * 1024 * 1024, env });
    timedOut = r.error?.code === "ETIMEDOUT" || (r.status === null && r.signal === "SIGTERM");
    raw = String(r.stdout || "");
    envelope = parseEnvelopeText(raw);
  }
  // No envelope, a malformed one, or a timeout: the process may still have
  // created a home. That is unconfirmed, never a confirmed failure.
  if (timedOut || !envelope || typeof envelope !== "object" || typeof envelope.ok !== "boolean") return { kind: "command", launched: false, unconfirmed: true, error: timedOut ? "command timed out; its side effects are unconfirmed" : "command answered no valid envelope; its side effects are unconfirmed" };
  const res = envelope?.result || {};
  const instance = typeof res.instance === "string" ? res.instance : undefined;
  let home = typeof res.home === "string" ? res.home : undefined;
  if (instance && !home) { const found = findHomesInScope(ws, instance); if (found.length === 1) home = found[0]; }
  if (envelope.ok && instance && !home) return { kind: "command", launched: true, instance, unconfirmed: true, error: `the envelope names instance ${instance} but no home for it is in this scope's roster; run oats schedule reconcile once it appears` };
  // A valid ok:false answer that reports an incomplete rollback (a harvest
  // spawn whose compensation could not stop or remove everything) is not a
  // confirmed failure either.
  if (!envelope.ok && reportsRetainedEffects(envelope.error?.message)) return { kind: "command", launched: false, unconfirmed: true, ...(instance ? { instance } : {}), error: `command failed with retained effects: ${envelope.error?.message}`, errorCode: envelope.error?.code };
  return { kind: "command", launched: envelope.ok === true, ...(instance ? { instance } : {}), ...(home ? { home } : {}), ...(envelope.ok ? {} : { error: envelope.error?.message || "command failed", errorCode: envelope.error?.code }) };
}
/** One wake. `startIfStopped` false between due minutes (a harness that
 *  keeps exiting is not restarted every minute); `canStart` false when the
 *  host bound is reached (a new runtime takes a slot; a delivery does not). */
/** A failure message that reports effects the kernel could not undo or
 *  confirm (spawn compensation's "rollback INCOMPLETE", a quarantined or
 *  retained home): the launch's effects are unconfirmed, never a confirmed
 *  failure. Shared by caught spawn errors and ok:false command envelopes. */
export function reportsRetainedEffects(message) { return /INCOMPLETE|quarantin|retain|could not (?:be )?(?:verif|confirm)/i.test(String(message || "")); }
function performWake(def, io, { startIfStopped = true, canStart = true, reserve } = {}) {
  const seen = observeHome(def.home, io);
  if (seen.outcome === "ended") return { kind: "wake", action: "skipped", reason: "home is gone", pending: false };
  if (seen.outcome === "unknown") return { kind: "wake", action: "skipped", reason: `cannot observe the session: ${seen.error}`, pending: true };
  if (seen.outcome === "starting") return { kind: "wake", action: "skipped", reason: "session is starting; delivery pending", pending: true };
  if (seen.outcome === "stopped") {
    if (!startIfStopped) return { kind: "wake", action: "skipped", reason: "session stopped; it is started again only at the next due minute; delivery pending", pending: true };
    if (!canStart) return { kind: "wake", action: "skipped", reason: "host busy: starting this session needs a launch slot; delivery pending", pending: true };
    // The slot is persisted BEFORE the start call and kept on ANY start
    // exception: an error code does not prove nothing was allocated (core
    // can refuse while recording, after the session exists). The next
    // observation releases it once the runtime is proven stopped or absent;
    // at worst a refused start occupies a slot for one tick.
    if (reserve && !reserve()) return { kind: "wake", action: "skipped", reason: "the job's slot is held by another process; delivery pending", pending: true };
    try {
      const r = (io?.start || startInstanceSession)(def.home);
      return { kind: "wake", action: "started", instance: r.instance, target: r.target, reason: "session was stopped; the message is pending until the session is active", pending: true, startedRuntime: true };
    } catch (e) {
      return { kind: "wake", action: "skipped", reason: `start did not complete (${e.code || "error"}): ${e.message}; the slot is kept until the session is observed stopped or absent`, error: e.message, errorCode: e.code, pending: true, startedRuntime: "unconfirmed" };
    }
  }
  try { (io?.input || inputInstanceSession)(def.home, def.message); return { kind: "wake", action: "delivered", pending: false }; }
  catch (e) { return { kind: "wake", action: "skipped", reason: `input refused: ${e.message}`, pending: true }; }
}

// -------------------------------------------------------------- tick

/** Observe the previous run of one job. The tracked identity is what was
 *  launched (the lock's or lastRun's home), never the current definition,
 *  so an edit cannot make a slot forget its runtime. A wake slot is held
 *  while its started runtime is active, starting, unknown or retiring and
 *  released when that runtime is proven stopped (the start receipt's exit
 *  marker) or its home is gone: a persistent home outliving its process
 *  does not keep a slot. */
function observePrevious(ws, id, def, js, io, now, { mutate }) {
  if (shapeError(def)) return;
  const lr = js.lastRun;
  const lock = jobLockInfo(ws, id);
  const home = def.kind === "wake" ? (lock?.home || lr?.home || def.home) : (lock?.home || lr?.home);
  const tracked = def.kind === "wake" ? !!lock : !!home && ["launched", "active", "starting", "stopped", "unknown"].includes(lr?.outcome);
  if (!tracked || !home) return;
  const seen = observeHome(home, io);
  if (!mutate) return;
  if (def.kind === "wake") {
    if (seen.outcome === "ended" || seen.outcome === "stopped") {
      releaseJobLock(ws, id);
      if (seen.outcome === "ended") delete js.pendingWake;
      if (lr) js.lastRun = { ...lr, ...(seen.outcome === "ended" ? { endedAt: now.toISOString() } : { stoppedAt: now.toISOString() }), note: seen.outcome === "ended" ? "started runtime ended" : "started runtime stopped; slot released" };
    }
    return;
  }
  js.lastRun = { ...lr, outcome: seen.outcome === "starting" ? "active" : seen.outcome, ...(seen.error ? { error: seen.error } : {}), ...(seen.outcome === "ended" ? { endedAt: now.toISOString() } : {}) };
  if (seen.outcome === "ended") releaseJobLock(ws, id);
}

/** Evaluate every enabled job of `ws` for the current minute (or, with
 *  `only`, run that one job now). Caller holds the host lock. `dryRun`
 *  reads only: no lock, state or definition is touched. Due jobs are
 *  visited least-recently-launched first so one job cannot monopolize the
 *  slot. An invalid definition is recorded on that job and the rest continue. */
export function tickWorkspace(ws, { now = new Date(), io, reg, wsList, dryRun = false, only, observeOnly = false, candidates } = {}) {
  const minute = minuteStart(now);
  const key = minuteKey(minute);
  const registry = reg || readRegistry();
  const bound = registry.maxConcurrent || 1;
  const wsAll = wsList || [ws];
  const defs = readDefinitions(ws);
  const st = readState(ws);
  const considered = [];
  const stateOf = (id) => (st.jobs[id] ||= {});
  const record = (id, action, extra = {}) => considered.push({ workspace: ws, id, minute: key, action, ...extra });
  // First observe every job's previous run (freeing the slots of homes that
  // are gone), then decide launches: a job ordered earlier must not see a
  // slot still held by a home that has already ended.
  // `candidates` (the host tick) means the host already observed every scope.
  if (!candidates) for (const [id, def] of Object.entries(defs.jobs)) observePrevious(ws, id, def, stateOf(id), io, now, { mutate: !dryRun });
  if (observeOnly) { if (!dryRun) writeState(ws, st); return considered; }
  // Least recently LAUNCHED first: only an actual runtime launch counts, a
  // skipped or pending job keeps its place at the front of the line.
  const order = (candidates || Object.keys(defs.jobs)).filter((id) => Object.prototype.hasOwnProperty.call(defs.jobs, id) && (!only || id === only)).sort((a, b) => launchOrderKey(st.jobs[a]).localeCompare(launchOrderKey(st.jobs[b])) || a.localeCompare(b));
  for (const id of order) {
    const def = defs.jobs[id];
    const js = stateOf(id);
    let due, cronError;
    const shape = shapeError(def);
    if (shape) { cronError = shape; due = false; }
    else { try { due = only ? true : dueAt(def, minute); } catch (e) { cronError = e.message; due = false; } }
    if (cronError) { if (!dryRun) js.lastRun = { ...(js.lastRun || {}), outcome: "invalid", error: `definition cannot be evaluated: ${cronError}` }; record(id, "invalid", { error: cronError }); continue; }
    if (def.kind === "wake" && js.pendingWake && def.enabled && !dryRun && !only) {
      const dueNow = due && js.lastAttemptedMinute !== key;
      const held = !!jobLockInfo(ws, id);
      const canStart = held || liveLocks(wsAll) < bound;
      const run = performWake(def, io, { startIfStopped: dueNow, canStart, reserve: () => held || acquireJobLock(ws, id, { scheduledFor: js.pendingWake.scheduledFor, wake: true, home: def.home }) });
      if (run.startedRuntime) js.lastLaunchedAt = now.toISOString();
      if (!existsSync(def.home)) releaseJobLock(ws, id);
      js.lastRun = { ...(js.lastRun || {}), ...run, outcome: run.action, completedPending: run.action === "delivered", pendingSince: js.pendingWake.scheduledFor, startedAt: js.lastRun?.startedAt || now.toISOString() };
      if (!run.pending) delete js.pendingWake;
      if (dueNow) js.lastAttemptedMinute = key;
      record(id, run.action, { ...(run.reason ? { reason: run.reason } : {}), pending: !!run.pending });
      continue;
    }
    if (!def.enabled && !only) continue;
    if (js.lastAttemptedMinute === key && !only) continue;
    if (!due) continue;
    if (dryRun) {
      const reason = js.attempt ? "an earlier launch has no recorded result; run oats schedule reconcile" : jobLockInfo(ws, id) && def.kind !== "wake" ? "still running" : liveLocks(wsAll) >= bound && def.kind !== "wake" ? "host busy" : undefined;
      record(id, reason ? "skipped" : "due", reason ? { reason } : {});
      continue;
    }
    js.lastAttemptedMinute = key;
    if (js.attempt) { record(id, "skipped", { reason: "an earlier launch has no recorded result; run oats schedule reconcile" }); js.lastRun = { ...(js.lastRun || {}), outcome: "unknown", error: "launch attempt without a recorded result", scheduledFor: js.attempt.scheduledFor }; continue; }
    if (def.kind === "wake") {
      // A delivery to a running session takes no slot; starting a stopped
      // one does, and the slot is held (the job lock) until that home ends.
      const holdsSlot = !!jobLockInfo(ws, id);
      const run = performWake(def, io, { startIfStopped: true, canStart: holdsSlot || liveLocks(wsAll) < bound, reserve: () => holdsSlot || acquireJobLock(ws, id, { scheduledFor: minute.toISOString(), wake: true, home: def.home }) });
      if (run.startedRuntime) js.lastLaunchedAt = now.toISOString();
      if (!existsSync(def.home)) releaseJobLock(ws, id);
      if (run.pending) js.pendingWake = { scheduledFor: minute.toISOString() }; else delete js.pendingWake;
      js.lastRun = { scheduledFor: minute.toISOString(), startedAt: now.toISOString(), home: def.home, ...run, outcome: run.action };
      record(id, run.action, { ...(run.reason ? { reason: run.reason } : {}), pending: !!run.pending });
      continue;
    }
    if (jobLockInfo(ws, id)) { record(id, "skipped", { reason: "still running" }); continue; }
    if (liveLocks(wsAll) >= bound) { record(id, "skipped", { reason: "host busy" }); continue; }
    if (!acquireJobLock(ws, id, { scheduledFor: minute.toISOString() })) { record(id, "skipped", { reason: "still running" }); continue; }
    js.attempt = { scheduledFor: minute.toISOString(), startedAt: now.toISOString(), wallClock: new Date().toISOString() };
    js.lastLaunchedAt = now.toISOString();
    writeState(ws, st);
    let run;
    try { run = def.kind === "command" ? launchCommand(ws, def, io) : launchSpawn(ws, def, minute, io); }
    catch (e) {
      // spawnInstance compensates its own failures, but its rollback can be
      // INCOMPLETE (a pane it could not stop, a quarantined home it kept):
      // then the effects are unconfirmed. A command that threw is
      // unconfirmed as well.
      run = { kind: def.kind, launched: false, error: e.message, errorCode: e.code, unconfirmed: def.kind !== "spawn" || reportsRetainedEffects(e.message) };
    }
    if (run.unconfirmed) {
      // Side effects unconfirmed: keep the attempt and the slot; reconcile decides.
      js.lastRun = { scheduledFor: minute.toISOString(), startedAt: now.toISOString(), ...run, outcome: "unknown" };
      record(id, "unknown", { error: run.error });
      continue;
    }
    delete js.attempt;
    const outcome = run.launched ? "launched" : "launch-failed";
    js.lastRun = { scheduledFor: minute.toISOString(), startedAt: now.toISOString(), ...run, outcome };
    if (!run.launched || !run.home) releaseJobLock(ws, id);
    record(id, outcome, { ...(run.error ? { error: run.error } : {}), ...(run.instance ? { instance: run.instance } : {}) });
  }
  if (!dryRun) writeState(ws, st);
  return considered;
}

/** The host tick: every registered scope under the host lock. */
export function tickHost({ now = new Date(), io, dryRun = false } = {}) {
  const reg = readRegistry();
  const wsList = reg.workspaces.filter((w) => existsSync(w));
  const body = () => {
    const considered = [];
    // Observe every registered scope first, then admit in one host-wide
    // order (least recently launched first, then scope, then id), so an
    // every-minute job in the first registered scope cannot monopolize the
    // bound. An unreadable scope is recorded and the rest continue.
    const jobs = [];
    for (const ws of wsList) {
      try {
        considered.push(...tickWorkspace(ws, { now, io, reg, wsList, dryRun, observeOnly: true }));
        const defs = readDefinitions(ws), st = readState(ws);
        for (const id of Object.keys(defs.jobs)) jobs.push({ ws, id, key: launchOrderKey(st.jobs[id]) });
      } catch (e) { considered.push({ workspace: ws, action: "error", error: e.message }); }
    }
    jobs.sort((a, b) => a.key.localeCompare(b.key) || a.ws.localeCompare(b.ws) || a.id.localeCompare(b.id));
    for (const j of jobs) {
      try { considered.push(...tickWorkspace(j.ws, { now, io, reg, wsList, dryRun, candidates: [j.id] })); }
      catch (e) { considered.push({ workspace: j.ws, id: j.id, action: "error", error: e.message }); }
    }
    if (!dryRun) writeHostState({ ...readHostState(), lastTick: now.toISOString(), minute: minuteKey(minuteStart(now)) });
    return { tickedAt: now.toISOString(), minute: minuteKey(minuteStart(now)), considered, scheduler: schedulerStatus(undefined, io) };
  };
  return dryRun ? body() : withHostLock(body);
}

/** Run one job now, ignoring its cron, under the same lock and bound; the
 *  previous run is observed under the host lock before any lock is judged. */
export function runNow(ws, id, { now = new Date(), io, force = false } = {}) {
  const defs = readDefinitions(ws);
  const def = defs.jobs[id];
  if (!def) throw scheduleError("E_SCHEDULE_UNKNOWN", `no schedule ${JSON.stringify(id)} in ${ws}`);
  if (!def.enabled && !force) throw scheduleError("E_SCHEDULE_DISABLED", `schedule ${id} is disabled; enable it or pass --force`);
  const reg = readRegistry();
  const wsList = reg.workspaces.includes(resolve(ws)) ? reg.workspaces : [...reg.workspaces, resolve(ws)];
  return withHostLock(() => {
    const st = readState(ws);
    const js = st.jobs[id] || (st.jobs[id] = {});
    observePrevious(ws, id, def, js, io, now, { mutate: true });
    writeState(ws, st);
    if (js.attempt) throw scheduleError("E_SCHEDULE_UNRESOLVED", `schedule ${id} has a launch attempt without a recorded result; run oats schedule reconcile ${id} first`);
    if (def.kind !== "wake" && jobLockInfo(ws, id)) throw scheduleError("E_SCHEDULE_RUNNING", `schedule ${id} is still running`);
    if (def.kind !== "wake" && liveLocks(wsList) >= reg.maxConcurrent) throw scheduleError("E_SCHEDULER_BUSY", `host concurrency ${reg.maxConcurrent} reached`);
    const considered = tickWorkspace(ws, { now, io, reg, wsList, only: id });
    const after = readState(ws);
    if (after.jobs[id]) { after.jobs[id].lastAttemptedMinute = minuteKey(minuteStart(now)); writeState(ws, after); }
    return { schedule: describe(ws, id, io), run: after.jobs[id]?.lastRun || null, considered };
  });
}

/** Resolve an attempt whose result was never recorded, under the host lock:
 *  a spawn attempt adopts the instance named for its minute (deterministic
 *  identity), a command attempt only the instance its answer NAMED. Nothing
 *  is inferred from file times. An unnamed command effect stays unknown
 *  until the operator has checked by hand and passes `clear`. */
export function reconcile(ws, id, { io, now = new Date(), clear = false } = {}) {
  const defs = readDefinitions(ws);
  const def = defs.jobs[id];
  if (!def) throw scheduleError("E_SCHEDULE_UNKNOWN", `no schedule ${JSON.stringify(id)} in ${ws}`);
  return withHostLock(() => {
    const st = readState(ws);
    const js = st.jobs[id] || (st.jobs[id] = {});
    const attempt = js.attempt || (js.lastRun?.outcome === "unknown" ? { scheduledFor: js.lastRun.scheduledFor, startedAt: js.lastRun.startedAt } : undefined);
    if (!attempt) return { schedule: describe(ws, id, io), reconciled: "nothing to reconcile" };
    let adopted, ambiguous;
    if (def.kind === "spawn" && attempt.scheduledFor) {
      const purpose = `${def.purpose || def.id}-${purposeSuffix(new Date(attempt.scheduledFor))}`;
      const homes = findHomesInScope(ws, `${def.agent}-${purpose}`);
      if (homes.length === 1) adopted = { instance: `${def.agent}-${purpose}`, home: homes[0] };
      else if (homes.length > 1) ambiguous = `${homes.length} homes named ${def.agent}-${purpose}: ${homes.join(", ")}`;
    } else if (def.kind === "command") {
      const named = js.lastRun?.instance ? findHomesInScope(ws, js.lastRun.instance).map((home) => ({ instance: js.lastRun.instance, home })) : [];
      if (named.length === 1) adopted = named[0];
      else if (named.length > 1) ambiguous = `${named.length} homes named ${js.lastRun.instance}: ${named.map((c) => c.home).join(", ")}`;
      else if (!clear) return { schedule: describe(ws, id, io), reconciled: "unknown", remedy: `the command's effects cannot be proven absent from here (its answer named no instance); check the roster and the host by hand, then run oats schedule reconcile ${id} --clear to record launch-failed and free the slot, or oats schedule remove --force ${id}` };
    }
    if (ambiguous && !clear) return { schedule: describe(ws, id, io), reconciled: "unknown", remedy: `${ambiguous}; retire or adopt by hand, then run oats schedule reconcile ${id} --clear or oats schedule remove --force ${id}` };
    if (ambiguous) adopted = undefined;
    delete js.attempt;
    if (adopted) {
      const seen = observeHome(adopted.home, io);
      js.lastRun = { scheduledFor: attempt.scheduledFor, startedAt: js.lastRun?.startedAt || attempt.startedAt, kind: def.kind, launched: true, ...adopted, outcome: seen.outcome, ...(seen.error ? { error: seen.error } : {}) };
      if (seen.outcome !== "ended") { if (!jobLockInfo(ws, id)) acquireJobLock(ws, id, { scheduledFor: attempt.scheduledFor, reconciled: true }); } else releaseJobLock(ws, id);
    } else {
      js.lastRun = { scheduledFor: attempt.scheduledFor, startedAt: js.lastRun?.startedAt || attempt.startedAt, kind: def.kind, launched: false, outcome: "launch-failed", error: clear ? "cleared by the operator after checking by hand" : "no instance found in the scope's roster for the unrecorded attempt" };
      releaseJobLock(ws, id);
    }
    writeState(ws, st);
    return { schedule: describe(ws, id, io), reconciled: adopted ? "adopted" : "cleared" };
  });
}

// -------------------------------------------------------- definitions CRUD

export function describe(ws, id, io, { defs, st, now = new Date() } = {}) {
  defs ||= readDefinitions(ws); st ||= readState(ws);
  const def = defs.jobs[id];
  if (!def) throw scheduleError("E_SCHEDULE_UNKNOWN", `no schedule ${JSON.stringify(id)} in ${ws}`);
  const js = st.jobs[id] || {};
  let nextRun = null; try { nextRun = def.enabled ? nextRunAfter(def, now) : null; } catch { nextRun = null; }
  return { ...def, nextRun, lastRun: js.lastRun || null, running: !!jobLockInfo(ws, id), ...(js.attempt ? { attempt: js.attempt } : {}), ...(js.pendingWake ? { pendingWake: js.pendingWake } : {}) };
}
export function listSchedules(ws, io, { now = new Date() } = {}) {
  const defs = readDefinitions(ws), st = readState(ws);
  return { schedules: Object.keys(defs.jobs).sort().map((id) => describe(ws, id, io, { defs, st, now })), scheduler: schedulerStatus(ws, io) };
}
export function addSchedule(ws, spec, io) {
  const def = validateDefinition(ws, spec);
  return withScopeLock(ws, () => {
    const defs = readDefinitions(ws);
    if (defs.jobs[def.id]) throw scheduleError("E_SCHEDULE_EXISTS", `schedule ${def.id} already exists in ${ws}`);
    const now = new Date().toISOString();
    defs.jobs[def.id] = { ...def, createdAt: now, updatedAt: now };
    writeDefinitions(ws, defs);
    return describe(ws, def.id, io);
  });
}
/** Update under the host lock (so the busy check cannot race a tick's
 *  admission) and the scope lock. What a run is tracked or reconciled by
 *  (kind, agent, agentsRoot, repo, purpose, home, cwd, argv) cannot change
 *  while the job holds a slot or has an unresolved attempt; timing and text can. */
export function updateSchedule(ws, id, spec, io) {
  const def = validateDefinition(ws, { ...spec, id });
  return withHostLock(() => withScopeLock(ws, () => {
    const defs = readDefinitions(ws);
    if (!defs.jobs[id]) throw scheduleError("E_SCHEDULE_UNKNOWN", `no schedule ${JSON.stringify(id)} in ${ws}`);
    const identity = (d) => JSON.stringify([d.kind, d.agent, d.agentsRoot, d.repo, d.purpose, d.home, d.cwd, d.argv]);
    const busy = !!jobLockInfo(ws, id) || !!readState(ws).jobs[id]?.attempt;
    if (busy && identity(defs.jobs[id]) !== identity(def)) throw scheduleError("E_SCHEDULE_RUNNING", `schedule ${id} is running or has an unresolved attempt; its kind, agent, agentsRoot, repo, purpose, home, cwd and argv cannot change until it ends (cron, tz, task, message, runtime, model and enabled can)`);
    defs.jobs[id] = { ...def, createdAt: defs.jobs[id].createdAt, updatedAt: new Date().toISOString() };
    writeDefinitions(ws, defs);
    return describe(ws, id, io);
  }), { retryMs: 3000 });
}
export function setEnabled(ws, id, enabled, io) {
  return withScopeLock(ws, () => {
    const defs = readDefinitions(ws);
    if (!defs.jobs[id]) throw scheduleError("E_SCHEDULE_UNKNOWN", `no schedule ${JSON.stringify(id)} in ${ws}`);
    defs.jobs[id] = { ...defs.jobs[id], enabled, updatedAt: new Date().toISOString() };
    writeDefinitions(ws, defs);
    return describe(ws, id, io);
  });
}
/** Remove under the host lock (state changes under a live tick are refused
 *  by the lock, not raced). */
export function removeSchedule(ws, id, { force = false } = {}) {
  return withHostLock(() => withScopeLock(ws, () => {
    const defs = readDefinitions(ws);
    if (!defs.jobs[id]) throw scheduleError("E_SCHEDULE_UNKNOWN", `no schedule ${JSON.stringify(id)} in ${ws}`);
    if (jobLockInfo(ws, id) && !force) throw scheduleError("E_SCHEDULE_RUNNING", `schedule ${id} is still running; wait for it to end, or --force forgets the job without stopping anything`);
    delete defs.jobs[id];
    writeDefinitions(ws, defs);
    const st = readState(ws); delete st.jobs[id]; writeState(ws, st);
    releaseJobLock(ws, id);
    return { removed: id };
  }));
}
/** Save the wake job for a freshly spawned instance (id wake-<instance>). */
export function saveWakeForHome(ws, { instance, home, wake }) {
  const id = `wake-${instance}`.slice(0, 40).replace(/-+$/, "");
  const spec = { id, enabled: wake.enabled === undefined ? true : wake.enabled, cron: wake.cron, tz: wake.tz, kind: "wake", home, message: wake.message };
  const def = validateDefinition(ws, spec);
  return withScopeLock(ws, () => {
    const defs = readDefinitions(ws);
    if (defs.jobs[id]) throw scheduleError("E_SCHEDULE_EXISTS", `schedule ${id} already exists in ${ws}`);
    const now = new Date().toISOString();
    defs.jobs[id] = { ...def, createdAt: now, updatedAt: now };
    writeDefinitions(ws, defs);
    return describe(ws, id);
  });
}
/** Retirement hook: wake definitions bound to this home are removed (nothing is stopped). */
export function removeWakeForHome(ws, home) {
  if (!existsSync(definitionsPath(ws))) return [];
  // A retirement waits briefly for a running tick rather than failing.
  return withHostLock(() => withScopeLock(ws, () => {
    const defs = readDefinitions(ws);
    const gone = [];
    for (const [id, def] of Object.entries(defs.jobs)) if (def.kind === "wake" && resolve(def.home) === resolve(home)) { delete defs.jobs[id]; gone.push(id); releaseJobLock(ws, id); }
    if (gone.length) { writeDefinitions(ws, defs); const st = readState(ws); for (const id of gone) delete st.jobs[id]; writeState(ws, st); }
    return gone;
  }), { retryMs: 10000 });
}
/** Translate the human spawn flags into the wake object. */
export function wakeFromFlags({ every, cron, tz, message }) {
  if (every === undefined && cron === undefined) return undefined;
  if (every !== undefined && cron !== undefined) throw scheduleError("E_SCHEDULE_INVALID", "use --wake-every or --wake-cron, not both", { field: "cron" });
  let expr = cron;
  if (every !== undefined) {
    const n = Number(every);
    if (!Number.isInteger(n) || n < 1 || n > 59) throw scheduleError("E_SCHEDULE_INVALID", "--wake-every: whole minutes from 1 to 59 (cadence is cron: */N fires at :00 and every N minutes after)", { field: "cron" });
    expr = `*/${n} * * * *`;
  }
  const zone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (message === undefined) throw scheduleError("E_SCHEDULE_INVALID", "a wake schedule needs --wake-message or --wake-message-file", { field: "message" });
  return { cron: expr, tz: zone, message, enabled: true };
}
export function schedulerStatus(ws, io) {
  const reg = readRegistry();
  const host = readHostState();
  let unit = { installed: false, active: false };
  try { unit = (io?.hostStatus || (() => ({ installed: false, active: false, unavailable: true })))(); } catch (e) { unit = { installed: false, active: false, error: e.message }; }
  return { installed: !!unit.installed, active: !!unit.active, ...(unit.unit ? { unit: unit.unit } : {}), ...(unit.error ? { error: unit.error } : {}), lastTick: host.lastTick || null, maxConcurrent: reg.maxConcurrent, tickIntervalSec: reg.tickIntervalSec, ...(ws ? { workspace: resolve(ws), registered: reg.workspaces.includes(resolve(ws)) } : {}), workspaces: reg.workspaces, live: liveLocks(reg.workspaces.filter((w) => existsSync(w))) };
}
