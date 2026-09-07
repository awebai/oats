/** OATS schedules v1: workspace-scoped definitions, host-owned execution.
 *
 *  A definition lives in <workspace>/oats-schedules.json and is evaluated by
 *  the host that holds that workspace: one host registry, one host lock, one
 *  host timer that runs `oats schedule tick --host` once a minute. The tick
 *  is a short-lived process; there is no daemon, no queue and no retry. Only
 *  the current minute is evaluated, so minutes missed while the machine
 *  slept are skipped, never replayed. Cron expressions (five fields, an
 *  explicit IANA zone) are evaluated by croner; nothing here parses cron.
 *
 *  Three kinds: `spawn` launches one disposable instance per due minute,
 *  `command` runs an oats-only argv in a workspace cwd and tracks any
 *  instance the envelope names, `wake` starts an existing home when it is
 *  stopped and delivers a literal message when it is active. Outcomes say
 *  what was observed (launched, active, ended, stopped, launch-failed,
 *  unknown; delivered, started, skipped for wake) and never claim that a
 *  task succeeded. */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Cron } from "croner";
import { ensureRoot, findAgent, findCapabilityAgent, spawnInstance, inspectInstanceSession, inputInstanceSession, startInstanceSession, retirePendingMarkerPath } from "./core.mjs";

export const SCHEDULE_FILE = "oats-schedules.json";
export const SCHEDULE_API = 1;
const ID_RE = /^[a-z0-9-]{1,40}$/;
const RUNTIMES = new Set(["pi", "claude", "codex"]);
const BACKENDS = new Set(["tmux", "herdr"]);
const MESSAGE_MAX = 256 * 1024;
const OATS_BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "oats.mjs");

export function scheduleError(code, message, extra) { return Object.assign(new Error(message), { code, ...(extra || {}) }); }

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
export function registerWorkspace(ws) {
  const reg = readRegistry();
  const abs = resolve(ws);
  if (!reg.workspaces.includes(abs)) { reg.workspaces.push(abs); writeRegistry(reg); }
  return reg;
}
export function unregisterWorkspace(ws) {
  const reg = readRegistry();
  reg.workspaces = reg.workspaces.filter((w) => w !== resolve(ws));
  writeRegistry(reg);
  return reg;
}
export function readHostState() { return readJson(join(hostScheduleDir(), "state.json"), {}); }
export function writeHostState(st) { writeJson(join(hostScheduleDir(), "state.json"), st); }

// ------------------------------------------------------------ validation

function inside(ws, p) {
  const a = resolve(ws) + sep, b = resolve(p) + sep;
  return b.startsWith(a);
}
export function validateCron(cron, tz, field = "cron") {
  if (typeof cron !== "string" || cron.trim().split(/\s+/).length !== 5) throw scheduleError("E_SCHEDULE_INVALID", `${field}: five fields required (minute hour day month weekday)`, { field });
  if (typeof tz !== "string" || !tz.trim()) throw scheduleError("E_SCHEDULE_INVALID", "tz: an explicit IANA time zone is required", { field: "tz" });
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { throw scheduleError("E_SCHEDULE_INVALID", `tz: unknown time zone ${JSON.stringify(tz)}`, { field: "tz" }); }
  try { return new Cron(cron.trim(), { timezone: tz, paused: true }); }
  catch (e) { throw scheduleError("E_SCHEDULE_INVALID", `${field}: ${e.message}`, { field }); }
}

/** Validate and normalize one definition. `roster` (optional) is used to
 *  check that a spawn job's agent exists in its scope. */
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
      if (typeof def.agentsRoot !== "string" || !isAbsolute(def.agentsRoot) || !inside(ws, def.agentsRoot) || !existsSync(def.agentsRoot)) throw scheduleError("E_SCHEDULE_INVALID", "agentsRoot: an existing absolute agents root inside the workspace", { field: "agentsRoot" });
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
      validateCron(w.cron, w.tz, "wake.cron");
      validateMessage(w.message, "wake.message");
      out.wake = { cron: w.cron.trim(), tz: w.tz.trim(), message: w.message };
    }
    if (checkAgent) resolveScheduledAgent(ws, out);
  } else if (def.kind === "command") {
    if (typeof def.cwd !== "string" || !isAbsolute(def.cwd) || !inside(ws, def.cwd) || !existsSync(def.cwd)) throw scheduleError("E_SCHEDULE_INVALID", "cwd: an existing absolute directory inside the workspace", { field: "cwd" });
    if (!Array.isArray(def.argv) || !def.argv.length || def.argv.some((a) => typeof a !== "string" || a.includes("\0")) || def.argv[0] !== "oats") throw scheduleError("E_SCHEDULE_INVALID", "argv: oats-only argument list starting with \"oats\"", { field: "argv" });
    out.cwd = def.cwd; out.argv = [...def.argv];
  } else if (def.kind === "wake") {
    if (typeof def.home !== "string" || !isAbsolute(def.home) || !inside(ws, def.home) || !existsSync(join(def.home, "instance.json"))) throw scheduleError("E_SCHEDULE_INVALID", "home: an existing instance home inside the workspace", { field: "home" });
    validateMessage(def.message, "message");
    out.home = resolve(def.home); out.message = def.message;
  } else throw scheduleError("E_SCHEDULE_INVALID", "kind: spawn, command or wake", { field: "kind" });
  return out;
}
function validateMessage(message, field) {
  if (typeof message !== "string" || !message.trim() || message.includes("\0") || Buffer.byteLength(message) > MESSAGE_MAX) throw scheduleError("E_SCHEDULE_INVALID", `${field}: non-empty text without NUL, at most 256 KiB`, { field });
}

/** The soul a spawn job launches: the exact agents root the definition
 *  names (agentsRoot, the Desktop's soul reference, which is what tells
 *  same-named souls in different member repositories apart), else the
 *  workspace's own root; found with the same lookups `oats spawn` uses
 *  (local/persistent souls first, then capability-declared agents). `repo`
 *  is the work repository and never selects a soul. */
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
export function dueAt(def, minute) {
  const n = cronOf(def).nextRun(new Date(minute.getTime() - 1000));
  return !!n && n.getTime() === minute.getTime();
}
export function purposeSuffix(minute) { return minute.toISOString().slice(0, 16).replace(/[-T:]/g, ""); }

// ---------------------------------------------------------------- locks

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

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } }
/** One host lock around a tick or a run-now: a stale lock (dead owner) is reclaimed. */
export function withHostLock(fn) {
  const dir = join(hostScheduleDir(), "host.lock");
  mkdirSync(dirname(dir), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try { mkdirSync(dir); break; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      let owner; try { owner = JSON.parse(readFileSync(join(dir, "owner.json"), "utf8")); } catch { owner = undefined; }
      if (owner?.pid && pidAlive(owner.pid)) throw scheduleError("E_SCHEDULER_BUSY", `another schedule run is in progress on this host (pid ${owner.pid})`);
      rmSync(dir, { recursive: true, force: true });
    }
  }
  writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }) + "\n");
  try { return fn(); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------------------------------------------------------- observation

/** What a run's instance looks like now. Home gone = ended; present but no
 *  running harness = stopped (needs attention, never removed); running =
 *  active; a home that cannot be inspected = unknown. */
export function observeHome(home, io) {
  if (!home) return { outcome: "launched" };
  if (!existsSync(home)) return { outcome: "ended" };
  if (existsSync(retirePendingMarkerPath(home))) return { outcome: "ended", note: "retiring" };
  try {
    const s = (io?.inspect || inspectInstanceSession)(home);
    if (s.present && s.state !== "shell") return { outcome: "active" };
    return { outcome: "stopped" };
  } catch (e) { return { outcome: "unknown", error: e.message }; }
}

function liveLocks(reg, wsList) {
  let n = 0;
  for (const ws of wsList) {
    const dir = join(stateDir(ws), "locks");
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) n++;
  }
  return n;
}

// --------------------------------------------------------------- runner

function scheduleBlock(def, minute, home) {
  return `\n\n## Scheduled run\n\nThis instance was launched by OATS schedule "${def.id}" for ${minute.toISOString()} (cron "${def.cron}" in ${def.tz}). It is disposable: finish the task above, bring your memory files up to date, and end with \`oats retire --self\`${home ? "" : ""}.\n`;
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

/** Run one command job: oats-only argv in the job's cwd, envelope parsed,
 *  any instance/home it names tracked. `io.command({cwd, argv})` overrides. */
function launchCommand(ws, def, io) {
  const argv = def.argv.includes("--json") ? def.argv.slice(1) : [...def.argv.slice(1), "--json"];
  let envelope;
  if (io?.command) envelope = io.command({ cwd: def.cwd, argv });
  else {
    const r = spawnSync(process.execPath, [OATS_BIN, ...argv], { cwd: def.cwd, encoding: "utf8", timeout: 5 * 60 * 1000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, OATS_INSTANCE: undefined, OATS_INSTANCE_HOME: undefined } });
    const text = String(r.stdout || "").trim().split("\n").filter(Boolean).pop() || "";
    try { envelope = JSON.parse(text); } catch { envelope = { ok: false, error: { code: r.status === null ? "E_TIMEOUT" : "E_ENVELOPE", message: (String(r.stderr || "").trim() || `exit ${r.status}`).slice(0, 400) } }; }
  }
  const res = envelope?.result || {};
  const instance = typeof res.instance === "string" ? res.instance : undefined;
  let home = typeof res.home === "string" ? res.home : undefined;
  if (instance && !home) home = findInstanceHomeUnder(ws, instance);
  return { kind: "command", launched: envelope?.ok === true, ...(instance ? { instance } : {}), ...(home ? { home } : {}), ...(envelope?.ok ? {} : { error: envelope?.error?.message || "command failed", errorCode: envelope?.error?.code }) };
}
function findInstanceHomeUnder(ws, instance) {
  for (const rootName of ["agents", "local-agents"]) {
    const root = join(ws, rootName);
    if (!existsSync(root)) continue;
    for (const e of readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const home = join(root, e.name, "instances", instance);
      if (existsSync(join(home, "instance.json"))) return home;
    }
  }
  return undefined;
}

/** One wake: deliver when the session is active; start the home when it is
 *  not running and keep the message as the job's ONE pending delivery,
 *  completed on a later tick as soon as the session is active (any tick,
 *  not the next cron minute). The kernel cannot see busy or idle: it never
 *  interrupts, never sends Ctrl-C, and never inputs into a stopped or
 *  starting shell. */
function performWake(def, io, { startIfStopped = true } = {}) {
  const seen = observeHome(def.home, io);
  if (seen.outcome === "ended") return { kind: "wake", action: "skipped", reason: "home is gone or retiring", pending: false };
  if (seen.outcome === "unknown") return { kind: "wake", action: "skipped", reason: `cannot observe the session: ${seen.error}`, pending: true };
  if (seen.outcome === "stopped") {
    if (!startIfStopped) return { kind: "wake", action: "skipped", reason: "session stopped; it is started again only at the next due minute; delivery pending", pending: true };
    try {
      const r = (io?.start || startInstanceSession)(def.home);
      return { kind: "wake", action: "started", instance: r.instance, target: r.target, reason: "session was stopped; the message is pending until the session is active", pending: true };
    } catch (e) {
      if (e.code === "E_SESSION_START_BUSY") return { kind: "wake", action: "skipped", reason: "session is starting; delivery pending", pending: true };
      return { kind: "wake", action: "skipped", reason: `start refused: ${e.code || ""} ${e.message}`.trim(), error: e.message, pending: true };
    }
  }
  try { (io?.input || inputInstanceSession)(def.home, def.message); return { kind: "wake", action: "delivered", pending: false }; }
  catch (e) { return { kind: "wake", action: "skipped", reason: `input refused: ${e.message}`, pending: true }; }
}

/** Launch or wake `def` now (the caller holds the host lock and has checked
 *  the bound). Returns the run record to store. */
function execute(ws, def, minute, io) {
  if (def.kind === "wake") return performWake(def, io);
  if (def.kind === "command") return launchCommand(ws, def, io);
  return launchSpawn(ws, def, minute, io);
}

// -------------------------------------------------------------- tick

/** Evaluate every enabled job of `ws` for the current minute. Returns the
 *  per-job actions. Caller holds the host lock. */
export function tickWorkspace(ws, { now = new Date(), io, reg, wsList, dryRun = false, only } = {}) {
  const minute = minuteStart(now);
  const key = minuteKey(minute);
  const defs = readDefinitions(ws);
  const st = readState(ws);
  const considered = [];
  const stateOf = (id) => (st.jobs[id] ||= {});
  for (const [id, def] of Object.entries(defs.jobs)) {
    if (only && id !== only) continue;
    const js = stateOf(id);
    // Observe the previous run first: a finished run releases its lock.
    if (js.lastRun?.home && ["launched", "active", "stopped", "unknown"].includes(js.lastRun.outcome) && js.lastRun.kind !== "wake") {
      const seen = observeHome(js.lastRun.home, io);
      js.lastRun = { ...js.lastRun, outcome: seen.outcome, ...(seen.error ? { error: seen.error } : {}), ...(seen.outcome === "ended" ? { endedAt: now.toISOString() } : {}) };
      if (seen.outcome === "ended") releaseJobLock(ws, id);
    }
    if (js.lastRun?.kind === "wake") releaseJobLock(ws, id);
    const record = (action, extra = {}) => considered.push({ workspace: ws, id, minute: key, action, ...extra });
    // A pending wake delivery completes on any tick, as soon as the session
    // is active. It is one attempted wake being finished, never a queue: a
    // due minute while one is pending adds nothing.
    if (def.kind === "wake" && js.pendingWake && def.enabled && !dryRun && !only) {
      // Between due minutes a pending delivery only waits for the session
      // to be active; starting the home again happens at due minutes only,
      // so a harness that keeps exiting is not restarted every minute.
      const dueNow = dueAt(def, minute) && js.lastAttemptedMinute !== key;
      const run = performWake(def, io, { startIfStopped: dueNow });
      js.lastRun = { ...js.lastRun, ...run, outcome: run.action, completedPending: run.action === "delivered", pendingSince: js.pendingWake.scheduledFor };
      if (!run.pending) delete js.pendingWake;
      record(run.action, { ...(run.reason ? { reason: run.reason } : {}), pending: !!run.pending });
      if (dueNow) js.lastAttemptedMinute = key;
      continue; // this minute's due wake, if any, is the pending one, already handled
    }
    if (!def.enabled && !only) { continue; }
    if (js.lastAttemptedMinute === key && !only) continue;
    const due = only ? true : dueAt(def, minute);
    if (!due) continue;
    if (!only) js.lastAttemptedMinute = key;
    if (js.attempt) { record("skipped", { reason: "an earlier launch has no recorded result; run oats schedule reconcile" }); js.lastRun = { ...(js.lastRun || {}), outcome: "unknown", error: "launch attempt without a recorded result", scheduledFor: js.attempt.scheduledFor }; continue; }
    if (jobLockInfo(ws, id)) { record("skipped", { reason: "still running" }); continue; }
    if (liveLocks(reg, wsList || [ws]) >= (reg?.maxConcurrent || 1)) { record("skipped", { reason: "host busy" }); continue; }
    if (dryRun) { record("due"); continue; }
    if (!acquireJobLock(ws, id, { scheduledFor: minute.toISOString() })) { record("skipped", { reason: "still running" }); continue; }
    js.attempt = { scheduledFor: minute.toISOString(), startedAt: now.toISOString() };
    if (!dryRun) writeState(ws, st);
    let run;
    try { run = execute(ws, def, minute, io); }
    catch (e) { run = { kind: def.kind, launched: false, error: e.message, errorCode: e.code }; }
    delete js.attempt;
    const outcome = def.kind === "wake" ? run.action : run.launched ? "launched" : "launch-failed";
    if (def.kind === "wake") { if (run.pending) js.pendingWake = { scheduledFor: minute.toISOString() }; else delete js.pendingWake; }
    js.lastRun = { scheduledFor: minute.toISOString(), startedAt: now.toISOString(), ...run, outcome };
    if (def.kind === "wake" || !run.launched || !run.home) releaseJobLock(ws, id);
    record(def.kind === "wake" ? run.action : run.launched ? "launched" : "launch-failed", { ...(run.reason ? { reason: run.reason } : {}), ...(run.error ? { error: run.error } : {}), ...(run.instance ? { instance: run.instance } : {}), ...(def.kind === "wake" ? { pending: !!run.pending } : {}) });
  }
  if (!dryRun) writeState(ws, st);
  return considered;
}

/** The host tick: every registered workspace under the host lock. */
export function tickHost({ now = new Date(), io, dryRun = false } = {}) {
  const reg = readRegistry();
  const wsList = reg.workspaces.filter((w) => existsSync(w));
  return withHostLock(() => {
    const considered = [];
    for (const ws of wsList) considered.push(...tickWorkspace(ws, { now, io, reg, wsList, dryRun }));
    if (!dryRun) writeHostState({ ...readHostState(), lastTick: now.toISOString(), minute: minuteKey(minuteStart(now)) });
    return { tickedAt: now.toISOString(), minute: minuteKey(minuteStart(now)), considered, scheduler: schedulerStatus(undefined, io) };
  });
}

/** Run one job now, ignoring its cron, under the same lock and bound. */
export function runNow(ws, id, { now = new Date(), io, force = false } = {}) {
  const defs = readDefinitions(ws);
  const def = defs.jobs[id];
  if (!def) throw scheduleError("E_SCHEDULE_UNKNOWN", `no schedule ${JSON.stringify(id)} in ${ws}`);
  if (!def.enabled && !force) throw scheduleError("E_SCHEDULE_DISABLED", `schedule ${id} is disabled; enable it or pass --force`);
  const st = readState(ws);
  if (st.jobs[id]?.attempt) throw scheduleError("E_SCHEDULE_UNRESOLVED", `schedule ${id} has a launch attempt without a recorded result; run oats schedule reconcile ${id} first`);
  if (jobLockInfo(ws, id)) throw scheduleError("E_SCHEDULE_RUNNING", `schedule ${id} is still running`);
  const reg = readRegistry();
  const wsList = reg.workspaces.includes(resolve(ws)) ? reg.workspaces : [...reg.workspaces, resolve(ws)];
  return withHostLock(() => {
    if (liveLocks(reg, wsList) >= reg.maxConcurrent) throw scheduleError("E_SCHEDULER_BUSY", `host concurrency ${reg.maxConcurrent} reached`);
    const considered = tickWorkspace(ws, { now, io, reg, wsList, only: id });
    return { schedule: describe(ws, id, io), run: readState(ws).jobs[id]?.lastRun || null, considered };
  });
}

/** Resolve an attempt whose result was never recorded: adopt the instance
 *  the roster shows for it, or clear it as launch-failed. */
export function reconcile(ws, id, { io } = {}) {
  const defs = readDefinitions(ws);
  const def = defs.jobs[id];
  if (!def) throw scheduleError("E_SCHEDULE_UNKNOWN", `no schedule ${JSON.stringify(id)} in ${ws}`);
  const st = readState(ws);
  const js = st.jobs[id] || (st.jobs[id] = {});
  const attempt = js.attempt || (js.lastRun?.outcome === "unknown" ? { scheduledFor: js.lastRun.scheduledFor } : undefined);
  if (!attempt) return { schedule: describe(ws, id, io), reconciled: "nothing to reconcile" };
  let adopted;
  if (def.kind === "spawn" && attempt.scheduledFor) {
    const purpose = `${def.purpose || def.id}-${purposeSuffix(new Date(attempt.scheduledFor))}`;
    let root; try { root = resolveScheduledAgent(ws, def).root; } catch { root = undefined; }
    const home = root ? join(root, def.agent, "instances", `${def.agent}-${purpose}`) : undefined;
    if (home && existsSync(join(home, "instance.json"))) adopted = { instance: `${def.agent}-${purpose}`, home };
  }
  delete js.attempt;
  if (adopted) {
    const seen = observeHome(adopted.home, io);
    js.lastRun = { scheduledFor: attempt.scheduledFor, startedAt: js.lastRun?.startedAt || attempt.startedAt, kind: def.kind, launched: true, ...adopted, outcome: seen.outcome, ...(seen.error ? { error: seen.error } : {}) };
    if (seen.outcome !== "ended") acquireJobLock(ws, id, { scheduledFor: attempt.scheduledFor, reconciled: true }); else releaseJobLock(ws, id);
  } else {
    js.lastRun = { scheduledFor: attempt.scheduledFor, startedAt: js.lastRun?.startedAt || attempt.startedAt, kind: def.kind, launched: false, outcome: "launch-failed", error: "no instance found for the unrecorded attempt" };
    releaseJobLock(ws, id);
  }
  writeState(ws, st);
  return { schedule: describe(ws, id, io), reconciled: adopted ? "adopted" : "cleared" };
}

// -------------------------------------------------------- definitions CRUD

export function describe(ws, id, io, { defs, st, now = new Date() } = {}) {
  defs ||= readDefinitions(ws); st ||= readState(ws);
  const def = defs.jobs[id];
  if (!def) throw scheduleError("E_SCHEDULE_UNKNOWN", `no schedule ${JSON.stringify(id)} in ${ws}`);
  const js = st.jobs[id] || {};
  return { ...def, nextRun: def.enabled ? nextRunAfter(def, now) : null, lastRun: js.lastRun || null, running: !!jobLockInfo(ws, id), ...(js.attempt ? { attempt: js.attempt } : {}), ...(js.pendingWake ? { pendingWake: js.pendingWake } : {}) };
}
export function listSchedules(ws, io, { now = new Date() } = {}) {
  const defs = readDefinitions(ws), st = readState(ws);
  return { schedules: Object.keys(defs.jobs).sort().map((id) => describe(ws, id, io, { defs, st, now })), scheduler: schedulerStatus(ws, io) };
}
export function addSchedule(ws, spec, io) {
  const def = validateDefinition(ws, spec);
  const defs = readDefinitions(ws);
  if (defs.jobs[def.id]) throw scheduleError("E_SCHEDULE_EXISTS", `schedule ${def.id} already exists in ${ws}`);
  const now = new Date().toISOString();
  defs.jobs[def.id] = { ...def, createdAt: now, updatedAt: now };
  writeDefinitions(ws, defs);
  return describe(ws, def.id, io);
}
export function updateSchedule(ws, id, spec, io) {
  const defs = readDefinitions(ws);
  if (!defs.jobs[id]) throw scheduleError("E_SCHEDULE_UNKNOWN", `no schedule ${JSON.stringify(id)} in ${ws}`);
  const def = validateDefinition(ws, { ...spec, id });
  defs.jobs[id] = { ...def, createdAt: defs.jobs[id].createdAt, updatedAt: new Date().toISOString() };
  writeDefinitions(ws, defs);
  return describe(ws, id, io);
}
export function setEnabled(ws, id, enabled, io) {
  const defs = readDefinitions(ws);
  if (!defs.jobs[id]) throw scheduleError("E_SCHEDULE_UNKNOWN", `no schedule ${JSON.stringify(id)} in ${ws}`);
  defs.jobs[id] = { ...defs.jobs[id], enabled, updatedAt: new Date().toISOString() };
  writeDefinitions(ws, defs);
  return describe(ws, id, io);
}
export function removeSchedule(ws, id, { force = false } = {}) {
  const defs = readDefinitions(ws);
  if (!defs.jobs[id]) throw scheduleError("E_SCHEDULE_UNKNOWN", `no schedule ${JSON.stringify(id)} in ${ws}`);
  if (jobLockInfo(ws, id) && !force) throw scheduleError("E_SCHEDULE_RUNNING", `schedule ${id} is still running; wait for it to end, or --force forgets the job without stopping anything`);
  delete defs.jobs[id];
  writeDefinitions(ws, defs);
  const st = readState(ws); delete st.jobs[id]; writeState(ws, st);
  releaseJobLock(ws, id);
  return { removed: id };
}

/** Save the wake job for a freshly spawned instance (id wake-<instance>). */
export function saveWakeForHome(ws, { instance, home, wake }) {
  const id = `wake-${instance}`.slice(0, 40);
  const spec = { id, enabled: wake.enabled === undefined ? true : wake.enabled, cron: wake.cron, tz: wake.tz, kind: "wake", home, message: wake.message };
  const defs = readDefinitions(ws);
  if (defs.jobs[id]) throw scheduleError("E_SCHEDULE_EXISTS", `schedule ${id} already exists in ${ws}`);
  const def = validateDefinition(ws, spec);
  const now = new Date().toISOString();
  defs.jobs[id] = { ...def, createdAt: now, updatedAt: now };
  writeDefinitions(ws, defs);
  return describe(ws, id);
}
/** Retirement hook: forget wake jobs bound to this home (nothing is stopped). */
export function removeWakeForHome(ws, home) {
  if (!existsSync(definitionsPath(ws))) return [];
  const defs = readDefinitions(ws);
  const gone = [];
  for (const [id, def] of Object.entries(defs.jobs)) if (def.kind === "wake" && resolve(def.home) === resolve(home)) { delete defs.jobs[id]; gone.push(id); releaseJobLock(ws, id); }
  if (gone.length) writeDefinitions(ws, defs);
  return gone;
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
  return { installed: !!unit.installed, active: !!unit.active, ...(unit.unit ? { unit: unit.unit } : {}), lastTick: host.lastTick || null, maxConcurrent: reg.maxConcurrent, tickIntervalSec: reg.tickIntervalSec, ...(ws ? { workspace: resolve(ws), registered: reg.workspaces.includes(resolve(ws)) } : {}), workspaces: reg.workspaces, live: liveLocks(reg, reg.workspaces.filter((w) => existsSync(w))) };
}
