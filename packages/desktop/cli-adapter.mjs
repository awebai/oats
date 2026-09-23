// OATS desktop — CLI JSON v1 adapter (the ONLY mutation path).
// Catalog/classic inventory also use this adapter, with strict read exits.
//
// Runs the two Desktop v1 mutations through a discovered absolute `oats`
// binary via execFile/argv — never a shell, never kernel imports:
//
//   1. oats spawn <agent> --dir <workspace> --task-file <0600-temp>
//      [allowlisted purpose/repo/work/runtime/model args] --json
//   2. oats operation run <layer>:<operation> --home <resolved home> --json
//
// JSON mode emits exactly one stdout object (progress goes to stderr):
//   success:  {"schemaVersion":1,"ok":true,"result":{...}}
//   failure:  {"schemaVersion":1,"ok":false,"error":{"code","message"}}
//
// SECURITY:
//   * The task text is user input destined for a file the spawned agent
//     reads. It is written to a mkdtemp-owned file created 0600 (mode set at
//     open, not chmod-after) so no other local user can read a task that may
//     contain secrets; the temp dir is removed after the CLI returns.
//   * Spawn argv is an ALLOWLIST — purpose/repo/work/runtime/model only,
//     values passed as separate argv entries (no interpolation). Anything
//     else the renderer sends is dropped, never forwarded.
//   * Harvest cwd is fixed by the privileged backend to the RESOLVED
//     instance home (server-side lookup), never a caller path.
import { execFile } from "node:child_process";
import { mkdtempSync, openSync, writeSync, closeSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { gitFileId, gitRevision, gitIndexRevision, gitObservation } from './renderer/instance-git-contract.mjs';

const ENVELOPE_TIMEOUT_MS = 60_000;

/** Parse the single-JSON-object stdout contract; null when contaminated. */
export function parseEnvelope(stdout) {
  try {
    const doc = JSON.parse(String(stdout));
    if (!doc || typeof doc !== "object" || doc.schemaVersion !== 1) return null;
    if (doc.ok === true && doc.result && typeof doc.result === "object") return doc;
    if (doc.ok === false && doc.error && typeof doc.error === "object") return doc;
    return null;
  } catch { return null; }
}

/** Allowlisted optional spawn args → argv pairs. Unknown keys are DROPPED.
 * SECURITY (review 53a20c7): values are also SHAPE-VALIDATED — the CLI
 * parser scans raw argv with includes()/indexOf(), so an option-shaped
 * value like purpose="--no-launch" would inject a real non-allowlisted
 * token. Reject any value with a leading '-'; constrain each field to its
 * domain. Rejection THROWS (E_BAD_ARGS shape) so a hostile value can never
 * silently degrade into different spawn behavior. */
const SPAWN_ARG_RULES = {
  purpose: { flag: "--purpose", re: /^[a-z0-9][a-z0-9-]*$/i },              // instance-name slug
  repo:    { flag: "--repo",    re: /^[^-][^\0]*$/ },                       // path — anything not option-shaped
  work:    { flag: "--work",    re: /^(worktree|checkout|attached|workspace|directory)$/ },
  backend: { flag: "--backend", re: /^(tmux|herdr)$/ },
  runtime: { flag: "--runtime", re: /^(pi|claude|codex)$/ },
  launchConfig: { flag: "--launch-config", re: /^[a-z0-9][a-z0-9._-]*$/i },
  server:  { flag: "--server",  re: /^[a-z0-9][a-z0-9-]{0,63}$/ },          // registered server id (remote route)
  model:   { flag: "--model",   re: /^[^-][^\0]*$/ },                       // model pattern — not option-shaped
  // Spawn-time agent relations (feature/agent-relations): the kernel links
  // the new instance to an existing one. "unrelated" is the default and is
  // NEVER forwarded — the CLI treats absence as unrelated.
  relation:   { flag: "--relation",    re: /^(child|sibling|parent)$/ },
  relativeTo: { flag: "--relative-to", re: /^[a-z0-9][a-z0-9._-]*$/i },     // instance-name slug
  // Anchor disambiguation (kernel contract addition): the agents root the
  // anchor homes in. Names shadow across roots, so the desktop ALWAYS sends
  // the pair when it spawns related — path-shaped, never option-shaped.
  relativeRoot: { flag: "--relative-root", re: /^[^-][^\0]*$/ },
};
export function spawnArgv(agent, workspaceDir, taskFile, opts = {}) {
  const agentName = String(agent);
  if (agentName.startsWith("-")) { const e = new Error(`invalid agent name "${agentName}"`); e.code = "E_BAD_ARGS"; throw e; }
  // Relation flags travel as a PAIR: a relation needs a reference instance
  // and a reference instance is meaningless without a relation. "unrelated"
  // normalizes to absence before the pairing check.
  if (opts.relation === "unrelated" || opts.relation === "") opts = { ...opts, relation: undefined };
  const hasRelation = opts.relation !== undefined && opts.relation !== null;
  const hasRef = opts.relativeTo !== undefined && opts.relativeTo !== null && opts.relativeTo !== "";
  if (hasRelation !== hasRef) {
    const e = new Error(hasRelation
      ? "a relation requires --relative-to <instance>"
      : "--relative-to requires a relation (child|sibling|parent)");
    e.code = "E_BAD_ARGS"; throw e;
  }
  // relativeRoot rides along with the pair only — alone it is meaningless
  if (!hasRef && opts.relativeRoot !== undefined && opts.relativeRoot !== null && opts.relativeRoot !== "") {
    const e = new Error("--relative-root requires --relation and --relative-to");
    e.code = "E_BAD_ARGS"; throw e;
  }
  // A remote route takes its workspace from the server registration; the
  // kernel refuses --dir with --server, so it is omitted here.
  const argv = opts.server
    ? ["spawn", agentName, "--task-file", String(taskFile)]
    : ["spawn", agentName, "--dir", String(workspaceDir), "--task-file", String(taskFile)];
  for (const [key, rule] of Object.entries(SPAWN_ARG_RULES)) {
    const v = opts[key];
    if (v === undefined || v === null || v === "") continue;
    const s = String(v);
    if (!rule.re.test(s)) { const e = new Error(`invalid ${key} value`); e.code = "E_BAD_ARGS"; throw e; }
    argv.push(rule.flag, s);
  }
  if (opts.yolo !== undefined) {
    if (typeof opts.yolo !== "boolean") throw Object.assign(new Error("yolo must be a boolean"), { code: "E_BAD_ARGS" });
    argv.push(opts.yolo ? "--yolo" : "--no-yolo");
  }
  argv.push("--json");
  return argv;
}

/** Write task text to a fresh 0600 file inside a private mkdtemp dir.
 * Returns { file, cleanup } — callers MUST call cleanup() when done. */
export function writeTaskFile(taskText, io = {}) {
  const mkdtemp = io.mkdtempSync || mkdtempSync;
  const open = io.openSync || openSync;
  const write = io.writeSync || writeSync;
  const close = io.closeSync || closeSync;
  const rm = io.rmSync || rmSync;
  const dir = mkdtemp(join(io.tmpdir ? io.tmpdir() : tmpdir(), "oats-desktop-task-"));
  const file = join(dir, "TASK.md");
  const cleanup = () => { try { rm(dir, { recursive: true, force: true }); } catch { /* best-effort */ } };
  try {
    const fd = open(file, "wx", 0o600); // create-exclusive, owner-only from birth
    try {
      const text = String(taskText ?? "");
      if (write(fd, text) !== Buffer.byteLength(text)) throw Object.assign(new Error('Could not write the complete private instruction file'), { code: 'E_INPUT_PREPARATION' });
    } finally { close(fd); }
  } catch (error) { cleanup(); throw error; } // construction failure must not orphan private input
  return { file, cleanup };
}

function runJson(bin, argv, { cwd, exec = execFile, timeout = ENVELOPE_TIMEOUT_MS, parse = parseEnvelope, strictExit = false } = {}) {
  return new Promise((resolveP, rejectP) => {
    try {
      exec(bin, argv, { cwd, encoding: "utf8", timeout, maxBuffer: 4 * 1024 * 1024, shell: false },
        (err, stdout) => {
          // New reads require a clean exit for success. Keep the historical
          // envelope-wins policy for existing mutations unless opted in.
          if (strictExit && err?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return resolveP(readError("E_CLI_OUTPUT_LIMIT"));
          if (strictExit && err?.killed) return resolveP(readError("E_CLI_TIMEOUT"));
          const doc = parse(stdout);
          if (strictExit && err && doc?.ok !== false) return resolveP(readError("E_CLI_FAILED"));
          if (doc) return resolveP(doc); // a nonzero exit may still carry ok:false
          if (err && err.killed) {
            return resolveP({ schemaVersion: 1, ok: false, error: { code: "E_CLI_TIMEOUT", message: `oats did not answer within ${timeout / 1000}s` } });
          }
          return resolveP({
            schemaVersion: 1, ok: false,
            error: { code: "E_CLI_PROTOCOL", message: "oats did not print a valid JSON envelope on stdout" },
          });
        });
    } catch (e) {
      if (strictExit) resolveP(readError("E_CLI_FAILED"));
      else rejectP(e);
    }
  });
}

// Only these diagnostics cross the new read boundary. Neither stderr, thrown
// exception text nor free-form CLI error messages are suitable UI diagnostics.
const READ_ERRORS = {
  E_BAD_ARGS: "Invalid CLI read arguments",
  E_CLI_FAILED: "The installed OATS CLI could not complete this read",
  E_CLI_PROTOCOL: "The installed OATS CLI returned an invalid read response",
  E_CLI_TIMEOUT: "The installed OATS CLI read timed out",
  E_CLI_OUTPUT_LIMIT: "The installed OATS CLI read exceeded the output limit",
  E_USAGE: "The installed OATS CLI does not support this read command",
  "invalid-source": "The installed OATS CLI could not read its catalog source",
  "invalid-lock": "The installed OATS CLI refused an invalid or unsupported lock; inventory is unavailable",
  "migration-required": "This scope requires migration; classic inventory is unavailable",
  "unsupported-wire-version": "This scope uses an unsupported lock version; inventory is unavailable",
};
function readError(code) {
  if (!Object.hasOwn(READ_ERRORS, code)) code = "E_CLI_FAILED";
  return { schemaVersion: 1, ok: false, error: { code, message: READ_ERRORS[code] } };
}
const readObject = value => !!value && typeof value === "object" && !Array.isArray(value);
const absoluteReadPath = value => typeof value === "string" && isAbsolute(value) && !value.includes("\0");

async function cliRead(bin, options, io, list) {
  try {
    const keys = list ? ["context", "localCwd"] : ["localCwd"];
    if (!absoluteReadPath(bin) || !readObject(options) || Object.keys(options).some(key => !keys.includes(key))
      || !absoluteReadPath(options.localCwd) || (list && !absoluteReadPath(options.context))) return readError("E_BAD_ARGS");
    const timeout = Number.isFinite(io.timeout) && io.timeout > 0 ? Math.min(io.timeout, 15_000) : 15_000;
    const result = await runJson(bin, list ? ["list", "--dir", options.context, "--json"] : ["catalog", "--json"], {
      cwd: options.localCwd, exec: io.exec, timeout, strictExit: true,
    });
    // A kernel that does not dispatch this verb answers E_UNKNOWN_COMMAND (the
    // workspace model v2 removed `list` and `catalog`; older kernels answered the
    // same for verbs they predate). That is the typed "unsupported read" the
    // boundary already knows as E_USAGE — never the retry-shaped E_CLI_FAILED.
    if (!result.ok && result.error?.code === "E_UNKNOWN_COMMAND") return readError("E_USAGE");
    return result.ok ? result : readError(result.error?.code);
  } catch { return readError("E_CLI_FAILED"); }
}

/** Effective catalog of the accepted LOCAL CLI; no client source/path overrides. */
export function cliCatalog(bin, options = {}, io = {}) {
  return cliRead(bin, options, io, false);
}

/** Classic inventory at a server-admitted context, never a captured/remote read. */
export function cliList(bin, options = {}, io = {}) {
  return cliRead(bin, options, io, true);
}

const GIT_READ_ERRORS = {
  E_BAD_ARGS: 'Invalid instance Git read arguments',
  E_GIT_FAILED: 'The installed OATS CLI could not read this Git worktree',
  E_NO_WORKTREE: 'This instance has no available Git worktree',
  E_SESSION_UNKNOWN: 'The instance is no longer available; refresh the roster',
  E_AMBIGUOUS_INSTANCE: 'The instance is ambiguous; select a uniquely reported instance',
  E_HOME_MISMATCH: 'The selected instance address no longer matches',
  E_STALE_OBSERVATION: 'The worktree observation changed; re-observe before selecting a diff',
  'unsupported-action': 'This CLI does not support Git inspection for this captured target',
};
export function gitReadFailure(code, details) {
  const error = Object.hasOwn(GIT_READ_ERRORS, code) ? { code, message: GIT_READ_ERRORS[code] } : readError(code).error;
  const observation = code === 'E_STALE_OBSERVATION' && gitObservation(details?.observation);
  return { schemaVersion: 1, ok: false, error: { ...error, ...(observation ? { details: { observation } } : {}) } };
}

/** K1 read adapter. Not a roster resolver: only the server boundary may supply
 * the instance/home/context triple. The boundary requires the hardened K1
 * contract. No direct Git command or renderer path arguments. */
export async function cliInstanceGit(bin, options = {}, io = {}) {
  try {
    const base = ['action', 'instance', 'context', 'home'];
    const diff = options?.action === 'diff';
    const allowed = diff ? [...base, 'fileId', 'revision', 'indexRevision'] : base;
    if (!absoluteReadPath(bin) || !readObject(options) || !['git', 'diff'].includes(options.action)
      || Object.keys(options).some(k => !allowed.includes(k))
      || typeof options.instance !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.instance)
      || !absoluteReadPath(options.context) || !absoluteReadPath(options.home)
      || (diff && (!gitFileId(options.fileId) || !gitRevision(options.revision) || !gitIndexRevision(options.indexRevision)))) return gitReadFailure('E_BAD_ARGS');
    const argv = ['instance', options.action, options.instance, '--dir', options.context, '--home', options.home];
    if (diff) argv.push('--file', options.fileId, '--revision', options.revision, '--index-revision', options.indexRevision);
    argv.push('--json');
    const timeout = Number.isFinite(io.timeout) && io.timeout > 0 ? Math.min(io.timeout, 15_000) : 15_000;
    const result = await runJson(bin, argv, { cwd: options.context, exec: io.exec, timeout, strictExit: true });
    return result.ok ? result : gitReadFailure(result.error?.code, result.error?.details);
  } catch { return gitReadFailure('E_CLI_FAILED'); }
}

/**
 * Desktop v1 spawn. `bin` is the discovered absolute CLI; `workspaceDir` the
 * validated workspace context (--dir); `opts` allowlisted extras.
 * Domain results RESOLVE (never reject) with the envelope — stable codes.
 */
export async function cliSpawn(bin, { agent, workspaceDir, task, ...opts }, io = {}) {
  let argv;
  let wake;
  try {
    argv = spawnArgv(agent, workspaceDir, "__TASKFILE__", opts);
    if (opts.wake !== undefined) {
      const value = opts.wake;
      if (!value || typeof value !== "object" || Array.isArray(value)
        || !["cron", "tz", "message"].every(k => typeof value[k] === "string" && value[k].trim() && !value[k].includes("\0"))
        || (value.enabled !== undefined && typeof value.enabled !== "boolean")) {
        throw Object.assign(new Error("Specify the wake cron, time zone, and message"), { code: "E_BAD_ARGS" });
      }
      wake = { cron: value.cron, tz: value.tz, message: value.message, enabled: value.enabled ?? true };
    }
  }
  catch (e) {
    // Validation failures resolve as domain errors (stable codes), never throw
    // — the endpoint maps them like CLI envelope failures.
    return { schemaVersion: 1, ok: false, error: { code: e.code || "E_BAD_ARGS", message: e.message } };
  }
  const { file, cleanup } = writeTaskFile(task ?? "", io);
  // Replace the placeholder POSITIONALLY — the slot after --task-file —
  // never by value search: an agent literally named "__TASKFILE__" would
  // occupy an earlier argv slot and indexOf would clobber the agent name
  // instead (review 0b83988).
  argv[argv.indexOf("--task-file") + 1] = file;
  let wakeFile;
  try {
    if (wake) { wakeFile = writeTaskFile(JSON.stringify(wake), io); argv.push("--wake-file", wakeFile.file); }
    return await runJson(bin, argv, { cwd: workspaceDir, exec: io.exec, timeout: io.timeout });
  } finally { wakeFile?.cleanup(); cleanup(); }
}

/** Registered servers, from the CLI's registry (`oats server list --json`). */
export function cliServers(bin, io = {}) {
  return runJson(bin, ["server", "list", "--json"], { cwd: io.cwd || process.cwd(), exec: io.exec, timeout: io.timeout });
}

/** Schedule definitions travel as private JSON files, never shell text. */
export async function cliSchedule(bin, { operation, id, spec, workspaceDir, server }, io = {}) {
  const actions = new Set(["list", "show", "add", "update", "enable", "disable", "remove", "run", "reconcile", "host-install", "host-uninstall", "host-status"]);
  const writes = operation === "add" || operation === "update";
  const needsId = actions.has(operation) && operation !== "list" && !operation.startsWith("host-");
  if (!actions.has(operation) || (needsId && (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)))
    || (server !== undefined && (typeof server !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(server)))
    || typeof workspaceDir !== "string" || !workspaceDir.startsWith("/") || workspaceDir.includes("\0")
    || (writes && (!spec || typeof spec !== "object" || Array.isArray(spec)))) {
    return { schemaVersion: 1, ok: false, error: { code: "E_BAD_ARGS", message: "Invalid schedule operation or definition" } };
  }
  const argv = ["schedule", ...operation.split("-")];
  if (needsId) argv.push(id);
  const temporary = writes ? writeTaskFile(JSON.stringify({ ...spec, id }), io) : null;
  if (temporary) argv.push("--file", temporary.file);
  argv.push(...(server ? ["--server", server] : ["--dir", workspaceDir]), "--json");
  try { return await runJson(bin, argv, { cwd: workspaceDir, exec: io.exec, timeout: io.timeout }); }
  finally { temporary?.cleanup(); }
}

/** One bounded aggregate read; the CLI owns registry and saved-route resolution. */
export function cliRemoteRoster(bin, io = {}) {
  return runJson(bin, ["server", "roster", "--json"], { cwd: io.cwd || process.cwd(), exec: io.exec, timeout: io.timeout || 60_000 });
}

/** Local retire predates the envelope; preserve its incomplete-cleanup result. */
export function parseRetireEnvelope(stdout) {
  const envelope = parseEnvelope(stdout);
  if (envelope && (!envelope.ok || !envelope.result?.rollbackIncomplete?.length)) return envelope;
  try {
    const result = envelope?.result || JSON.parse(String(stdout));
    if (typeof result?.retired !== "string") return null;
    const incomplete = !!result.rollbackIncomplete?.length;
    return { schemaVersion: 1, ok: !incomplete, result,
      ...(incomplete ? { error: { code: "E_RETIRE_INCOMPLETE", message: "Retirement cleanup is incomplete; the instance is retained for retry" } } : {}) };
  } catch { return null; }
}

export function cliRetire(bin, { instance, home, workspaceDir, server }, io = {}) {
  return runJson(bin, ["retire", instance, "--home", home, ...(server ? ["--server", server] : ["--dir", workspaceDir]), "--json"], {
    cwd: workspaceDir, exec: io.exec, timeout: io.timeout || 600_000, parse: parseRetireEnvelope,
  });
}

/** Shared explicit launch choices; every value remains one argv entry. */
export function launchChoiceArgv({ launchConfig, runtime, model, yolo } = {}) {
  const argv = [];
  for (const [key, v] of Object.entries({ launchConfig, runtime, model })) {
    if (v === undefined || v === "") continue;
    const rule = SPAWN_ARG_RULES[key];
    if (typeof v !== "string" || !rule.re.test(v)) throw Object.assign(new Error(`Invalid ${key}`), { code: "E_BAD_ARGS" });
    argv.push(rule.flag, v);
  }
  if (yolo !== undefined) {
    if (typeof yolo !== "boolean") throw Object.assign(new Error("Invalid permission setting"), { code: "E_BAD_ARGS" });
    argv.push(yolo ? "--yolo" : "--no-yolo");
  }
  return argv;
}

/** Start/restart is owned by the kernel, never a GUI stop-then-spawn pair. */
export function cliStart(bin, { home, workspaceDir, server, restart = false, ...choices }, io = {}) {
  if (typeof home !== "string" || !home.startsWith("/") || home.includes("\0")
    || (server !== undefined && (typeof server !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(server)))
    || typeof restart !== "boolean") {
    return Promise.resolve({ schemaVersion: 1, ok: false, error: { code: "E_BAD_ARGS", message: "Invalid start home, server or action" } });
  }
  let options;
  try { options = launchChoiceArgv(choices); }
  catch (e) { return Promise.resolve({ schemaVersion: 1, ok: false, error: { code: e.code, message: e.message } }); }
  return runJson(bin, ["session", restart ? "restart" : "start", "--home", home,
    ...(server ? ["--server", server] : []), ...options, "--json"], {
    cwd: workspaceDir, exec: io.exec, timeout: io.timeout,
  });
}

/** Named configuration data travels in private JSON files, not shell text. */
export async function cliLaunchConfig(bin, { action, name, definition, keepEnv, context, server, home, soul, agentsRoot, choices, localCwd }, io = {}) {
  let temporary;
  const bad = message => { throw Object.assign(new Error(message), { code: "E_BAD_ARGS" }); };
  const value = (v, label) => {
    if (typeof v !== "string" || !v || v.startsWith("-") || v.includes("\0")) bad(`Invalid ${label}`);
    return v;
  };
  try {
    if (!["list", "set", "remove", "preview"].includes(action)) bad("Unknown launch configuration action");
    const argv = ["launch-config", action];
    if (["set", "remove"].includes(action)) {
      if (typeof name !== "string" || !SPAWN_ARG_RULES.launchConfig.re.test(name)) bad("Invalid configuration name");
      argv.push(name);
    }
    if (action === "set") {
      if (!definition || typeof definition !== "object" || Array.isArray(definition)) bad("Specify a launch configuration object");
      temporary = writeTaskFile(JSON.stringify(definition), io); argv.push("--file", temporary.file);
      if (keepEnv !== undefined && typeof keepEnv !== "boolean") bad("Invalid environment preservation setting");
      if (keepEnv) argv.push("--keep-env");
    }
    if (context) argv.push("--dir", value(context, "scope"));
    if (server) argv.push("--server", value(server, "server"));
    if (home) argv.push("--home", value(home, "home"));
    if (soul) argv.push("--soul", value(soul, "soul"));
    if (agentsRoot) argv.push("--agents-root", value(agentsRoot, "agents root"));
    if (action === "preview") argv.push(...launchChoiceArgv(choices));
    return await runJson(bin, [...argv, "--json"], { cwd: localCwd, exec: io.exec, timeout: io.timeout });
  } catch (e) { return { schemaVersion: 1, ok: false, error: { code: e.code || "E_BAD_ARGS", message: e.message } }; }
  finally { temporary?.cleanup(); }
}

/** Inspection, scoped activation and provider operations share one CLI boundary. */
export async function cliCapability(bin, { action, context, server, soul, agentsRoot, home, binding, fields, operation, localCwd }, io = {}) {
  const bad = message => { throw Object.assign(new Error(message), { code: 'E_BAD_ARGS' }); };
  const value = (v, label) => {
    if (typeof v !== 'string' || !v || v.startsWith('-') || v.includes('\0')) bad(`Invalid ${label}`);
    return v;
  };
  const target = [];
  if (context) target.push('--dir', value(context, 'scope'));
  if (server) target.push('--server', value(server, 'server'));
  if (home) target.push('--home', value(home, 'home'));
  if (soul && action !== 'set') target.push('--soul', value(soul, 'soul'));
  if (agentsRoot && action !== 'use') target.push('--agents-root', value(agentsRoot, 'agents root'));
  let argv, temporary;
  try {
    if (action === 'inspect') argv = ['inspect'];
    else if (action === 'run') {
      if (typeof operation !== 'string' || !/^(knowledge|messaging|tasks):[a-zA-Z0-9._-]+$/.test(operation)) bad('Select a declared provider operation');
      argv = ['operation', 'run', operation];
    } else if (action === 'use') {
      if (soul && (binding?.action === 'none' || binding?.capability === 'none')) bad('Layer-wide defaults cannot target one soul');
      if (!binding || !['enable', 'disable', 'inherit', 'none'].includes(binding.action)) bad('Choose enable, disable, inherit, or none');
      argv = ['use', binding.action === 'none' ? 'none' : value(binding.capability, 'capability')];
      if (!soul) argv.push('--global');
      if (binding.layer !== undefined) {
        if (!['knowledge', 'messaging', 'tasks'].includes(binding.layer)) bad('Unknown capability layer');
        argv.push('--layer', binding.layer);
      }
      if (binding.action === 'none' && !binding.layer) bad('Choose a layer to disable');
      if (binding.action === 'disable') argv.push('--disable');
      if (binding.action === 'inherit') argv.push('--inherit');
    } else if (action === 'set') {
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || !Object.keys(fields).length) bad('Specify the defaults to update');
      argv = ['soul', 'set', value(soul, 'soul')];
      for (const [key, v] of Object.entries(fields)) {
        if (key === 'instructions') {
          if (typeof v !== 'string' || Buffer.byteLength(v) > 256 * 1024) bad('Instructions must be text up to 256 KiB');
          temporary = writeTaskFile(v, io); argv.push('--instructions-file', temporary.file);
        } else if (key === 'yolo') {
          if (typeof v !== 'boolean') bad('Invalid permission setting');
          argv.push(v ? '--yolo' : '--no-yolo');
        } else if (key === 'model' && v === '') argv.push('--no-model');
        else if (key === 'description' && v === '') argv.push('--no-description');
        else if (key === 'launch-config' && v === '') argv.push('--no-launch-config');
        else if (['runtime', 'backend', 'model', 'description', 'launch-config'].includes(key)) {
          const allowed = key === 'runtime' ? ['pi', 'claude', 'codex'] : key === 'backend' ? ['tmux', 'herdr'] : null;
          if (allowed && !allowed.includes(v)) bad(`Invalid ${key}`);
          argv.push(`--${key}`, value(v, key));
        } else bad(`Unsupported soul field: ${key}`);
      }
    } else bad('Unknown capability action');
    return await runJson(bin, [...argv, ...target, '--json'], {
      cwd: localCwd, exec: io.exec, timeout: io.timeout ?? (action === 'run' ? 300_000 : ENVELOPE_TIMEOUT_MS),
    });
  } finally { temporary?.cleanup(); }
}
