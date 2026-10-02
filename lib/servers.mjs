/**
 * Server registry and remote CLI routing (docs/execution-targets.md).
 *
 * A registered server is another machine that runs its own installed OATS
 * over an OpenSSH host alias. Registrations live in the operator's machine
 * configuration (~/.oats/servers.json, never a repository scope) and hold no
 * key material: SSH owns key selection, host verification and authentication.
 *
 * Routing is deliberately thin: a remote lifecycle call is the remote
 * installed OATS CLI run over ssh with argument-safe quoting and the same
 * JSON envelope as a local call. The remote kernel is the authority over its
 * own homes, receipts and baselines; what the local side keeps is a ROUTE
 * SNAPSHOT per remote instance, taken at spawn, so that inspect and retire
 * work from the snapshot alone and a registry entry edited or deleted later
 * can never orphan a remote home. Nothing here implements SSH itself, and
 * nothing here runs Git against a remote path.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseStrictJson } from "./canonical-json.mjs";
import { noteRuntimeName } from "./deprecation.mjs";
import { withDirLock } from "./dir-lock.mjs";

const OATS_HOME_DIR = () => process.env.OATS_HOME_DIR || join(homedir(), ".oats");
export const SERVERS_FILE = () => join(OATS_HOME_DIR(), "servers.json");
export const REMOTE_SNAPSHOT_DIR = () => join(OATS_HOME_DIR(), "remote");

/** Every ssh invocation is non-interactive: a host that needs a password or a
 *  first-time key confirmation fails fast with ssh's own message, instead of
 *  a lifecycle call hanging on a prompt nobody will answer. Keepalives end a
 *  call (an attached viewer included) whose link died without a reset: three
 *  unanswered 15 s probes, not a hang until TCP gives up. */
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3"];

/** Every routed call to one host shares one per-user control master: the
 *  probe, the command and an attached viewer ride one authenticated
 *  connection, kept 60 s after the last client leaves. Explicit -o wins over
 *  a user's own Control* settings in ~/.ssh/config. */
const SSH_CONTROL_DIR = () => join(OATS_HOME_DIR(), "ssh");
const controlOpts = () => ["-o", "ControlMaster=auto", "-o", `ControlPath=${join(SSH_CONTROL_DIR(), "%C")}`, "-o", "ControlPersist=60"];
// Without the master, sharing is switched off outright: a user's own
// ControlMaster/ControlPath in ~/.ssh/config would otherwise still apply.
const NO_CONTROL_OPTS = ["-o", "ControlPath=none"];
// ssh binds the master at `<ControlPath>.<16 random chars>` in a sun_path of
// 104 bytes (macOS; Linux has 108), NUL included, and a path that does not
// fit is fatal to the call. %C expands to 40 hex characters.
const SOCKET_PATH_LIMIT = 104;
const BIND_SUFFIX = 17;
const controlSocketBytes = () => Buffer.byteLength(join(SSH_CONTROL_DIR(), "x".repeat(40)));
// ssh reads an -o value as configuration syntax (whitespace splits it,
// quotes and # are syntax) and then expands %tokens and ${VAR} in the path:
// only a directory made of characters it takes literally is the path it binds.
const LITERAL_PATH_RE = /^[A-Za-z0-9._\/+,:@=-]+$/;

/** Why the control socket cannot live under the control directory, or null. */
function controlPathProblem() {
  const dir = SSH_CONTROL_DIR();
  if (!LITERAL_PATH_RE.test(dir)) return `the control directory ${dir} has characters ssh reads as syntax (only letters, digits and . _ / + , : @ = - are taken literally); set an OATS_HOME_DIR (or HOME) without them`;
  if (controlSocketBytes() + BIND_SUFFIX >= SOCKET_PATH_LIMIT) return `the control socket path ${join(dir, "%C")} expands to ${controlSocketBytes()} bytes, and ssh needs it to fit in ${SOCKET_PATH_LIMIT - BIND_SUFFIX - 1} (the ${SOCKET_PATH_LIMIT}-byte socket path limit less ssh's ${BIND_SUFFIX}-byte bind suffix); set a shorter OATS_HOME_DIR (or HOME)`;
  return null;
}

/** Whether this call may use the control master: the socket path is
 *  literal to ssh and fits, and the directory exists, private to this user (created 0700; one owned by
 *  someone else or writable by others is never handed to ssh). Otherwise the
 *  call runs with sharing off, with one warning per process per server:
 *  reuse is an optimisation and must never break routing. */
const controlWarned = new Set();
function controlUsable(target, io = {}) {
  let problem = controlPathProblem();
  if (!problem) {
    const dir = SSH_CONTROL_DIR();
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const st = lstatSync(dir);
      if (!st.isDirectory()) problem = `${dir} is not a directory`;
      else if (typeof process.getuid === "function" && st.uid !== process.getuid()) problem = `${dir} is owned by another user`;
      else if (st.mode & 0o022) problem = `${dir} is writable by group or others (mode ${(st.mode & 0o777).toString(8)}); make it private with chmod 700`;
    } catch (e) { problem = `${dir} cannot be created: ${e.message}`; }
  }
  if (!problem) return true;
  const key = io.serverId ?? target.sshHost;
  if (!controlWarned.has(key)) {
    controlWarned.add(key);
    const warn = io.warn || ((m) => process.stderr.write(`oats: warning: ${m}\n`));
    warn(`ssh to ${key} runs without connection reuse: ${problem}`);
  }
  return false;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SSH_HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/; // an OpenSSH alias or host name, never a user@ or option

export function serverError(code, message) {
  return Object.assign(new Error(message), { code });
}

// ---------------------------------------------------------------- registry

export function readServers() {
  const file = SERVERS_FILE();
  if (!existsSync(file)) return {};
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw serverError("E_SERVERS_UNREADABLE", `${file} is not valid JSON: ${e.message}`);
  }
  const servers = doc && typeof doc === "object" && !Array.isArray(doc) ? doc.servers : undefined;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    throw serverError("E_SERVERS_UNREADABLE", `${file} must be { "servers": { <id>: {...} } }`);
  }
  const out = {};
  for (const [id, s] of Object.entries(servers)) { out[id] = withoutHerdrPath(s); validateServer(id, out[id]); }
  return out;
}

export function writeServers(servers) {
  const file = SERVERS_FILE();
  // A registration whose target changes (server add --replace) is probed afresh.
  let prior = {};
  try { prior = readServers(); } catch { prior = {}; }
  for (const [id, s] of Object.entries(prior)) {
    if (!servers[id] || JSON.stringify(targetOf(servers[id])) !== JSON.stringify(targetOf(s))) dropRemoteProbes(id);
  }
  mkdirSync(OATS_HOME_DIR(), { recursive: true });
  writeFileSync(file, JSON.stringify({ servers }, null, 2) + "\n", { mode: 0o600 });
}

/** Every read-modify-write of the registry: under one short lock, over the file as it is NOW (never a
 *  copy read before a network call), written only when `change` altered it. `change(servers)`
 *  mutates its argument and returns what the caller needs. */
export function updateServers(change) {
  const lock = join(OATS_HOME_DIR(), "servers.lock");
  return withDirLock(lock, "the server registry", () => {
    const servers = readServers();
    const before = JSON.stringify(servers);
    const out = change(servers);
    if (JSON.stringify(servers) !== before) writeServers(servers);
    return out;
  }, { retryMs: 5000, busy: (why) => serverError("E_SERVERS_BUSY", `the server registry is locked (${why}); if no oats process is changing it, remove ${lock} and retry; nothing was changed`) });
}

/** Record the workspace key a host reported for registration `id`, only if the registration is still
 *  the one that was asked (same host, workspace, oats path and PATH), so a registration changed or
 *  removed meanwhile is never overwritten or brought back. → "recorded" | "same" | "changed" |
 *  { mismatch: <the recorded key> } (a recorded key is never rewritten). */
export function learnWorkspaceKey(id, asked, reported) {
  return updateServers((servers) => {
    const current = servers[id];
    if (!current || JSON.stringify(targetOf(current)) !== JSON.stringify(targetOf(asked))) return "changed";
    if (current.workspaceKey === reported) return "same";
    if (current.workspaceKey) return { mismatch: current.workspaceKey };
    current.workspaceKey = reported;
    return "recorded";
  });
}

/** A registration or saved route written before 0.31.0 may record `herdrPath` (Herdr was removed
 *  then): it is read and dropped, never written, printed or passed. */
function withoutHerdrPath(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry) || !Object.hasOwn(entry, "herdrPath")) return entry;
  const { herdrPath: _ignored, ...rest } = entry;
  return rest;
}

/** A registration names WHERE and HOW, never WITH WHAT credentials. */
export function validateServer(id, s) {
  if (!ID_RE.test(String(id))) throw serverError("E_SERVER_INVALID", `server id ${JSON.stringify(id)} must be lowercase letters, digits and dashes`);
  if (!s || typeof s !== "object" || Array.isArray(s)) throw serverError("E_SERVER_INVALID", `server ${id}: entry must be an object`);
  if (typeof s.sshHost !== "string" || !SSH_HOST_RE.test(s.sshHost)) throw serverError("E_SERVER_INVALID", `server ${id}: sshHost must be an OpenSSH host alias or host name (no user@, no options)`);
  if (typeof s.workspace !== "string" || !s.workspace.startsWith("/")) throw serverError("E_SERVER_INVALID", `server ${id}: workspace must be an absolute path on the server`);
  for (const k of ["oatsPath", "label", "path"]) {
    if (s[k] !== undefined && s[k] !== null && typeof s[k] !== "string") throw serverError("E_SERVER_INVALID", `server ${id}: ${k} must be a string`);
  }
  if (s.path !== undefined && s.path !== null && !s.path.split(":").every((d) => d.startsWith("/") || d.startsWith("~/"))) throw serverError("E_SERVER_INVALID", `server ${id}: path must be absolute directories on the server, colon-separated`);
  // The canonical key of the workspace the host deployment realizes, as its own `status --json` reported it.
  if (s.workspaceKey !== undefined && (typeof s.workspaceKey !== "string" || !WORKSPACE_KEY_RE.test(s.workspaceKey))) throw serverError("E_SERVER_INVALID", `server ${id}: workspaceKey must be a canonical workspace key (as the host's oats status --json reports it)`);
  for (const k of Object.keys(s)) {
    if (!["label", "sshHost", "workspace", "oatsPath", "path", "workspaceKey"].includes(k)) throw serverError("E_SERVER_INVALID", `server ${id}: unknown field ${JSON.stringify(k)} (a registration holds label, sshHost, workspace, oatsPath, path, workspaceKey and nothing else — never keys or passwords)`);
  }
  return true;
}
const WORKSPACE_KEY_RE = /^[^\s\x00-\x1f\x7f]+$/;

/** The workspace key a host deployment reports for itself (`status --json` → `workspace.key`,
 *  feature workspace-identity): `{ key }`, or `{ key: null, why }` when the host answers none
 *  (no deployment there, a kernel before 0.38, a failed status). ssh failures throw. */
export function reportedWorkspaceKey(target, io = {}) {
  const status = runRemote(target, ["status", "--json", "--dir", target.workspace], { ...io, input: undefined }).envelope;
  return workspaceKeyOfStatus(status);
}
export function workspaceKeyOfStatus(status) {
  if (!status.ok) return { key: null, why: `the host's status failed: ${status.error?.message || status.error?.code || "no reason given"}` };
  const key = status.result?.workspace?.key;
  if (typeof key === "string" && WORKSPACE_KEY_RE.test(key)) return { key };
  return { key: null, why: "the host's oats reports no workspace key (no deployment at that path, or a kernel before 0.38)" };
}

/** A recorded key the host contradicts: never rewritten, the remedy named. */
export function workspaceMismatch(id, server, reported) {
  return Object.assign(serverError("E_SERVER_WORKSPACE_MISMATCH", `server ${id} is registered for workspace ${server.workspaceKey}, but the deployment at ${server.sshHost}:${server.workspace} reports ${reported}; the registration was not changed (register the deployment you mean with oats server add ${id} --replace …)`), { details: { recorded: server.workspaceKey, reported } });
}

export function getServer(id) {
  const servers = readServers();
  const s = servers[id];
  if (!s) throw serverError("E_SERVER_UNKNOWN", `no server registered as ${JSON.stringify(id)} (oats server list)`);
  return { id, ...s };
}

// ------------------------------------------------------------------ quoting

/** POSIX single-quoting for the REMOTE shell: ssh joins its command words
 *  with spaces and hands the string to the login shell, so every argument
 *  must survive that shell untouched. Single quotes are the only construct
 *  in which nothing is special; an embedded quote closes, escapes, reopens. */
export function remoteQuote(arg) {
  const s = String(arg);
  if (s === "") return "''";
  if (/^[A-Za-z0-9._\/=:@%+,-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** The exact snapshot of a registration that a route runs against. */
export function targetOf(server) {
  return {
    sshHost: server.sshHost,
    workspace: server.workspace,
    oatsPath: server.oatsPath || "oats",
    ...(server.path ? { path: server.path } : {}),
  };
}

/** argv for the local ssh process that runs one remote oats command. `--`
 *  ends ssh's own options so a host alias can never be read as one; the
 *  remote command is one quoted string, as ssh requires. */
/** A stable key for a route target: two registrations may name the same
 *  host and workspace, and a registration may change; groups and guards key
 *  on the target, never on the registry id alone. */
export function targetKey(target) {
  // Host and workspace only: the binary path (like --path and --label) is how
  // to reach the same homes, not which homes; each snapshot keeps its own.
  return createHash("sha256").update(`${target.sshHost}\0${target.workspace}`).digest("hex").slice(0, 12);
}

export function sshArgv(target, oatsArgs, { cwd, control = false } = {}) {
  // A non-interactive ssh command runs in the login shell's minimal PATH,
  // which rarely includes user-local tool directories (~/.local/bin, where
  // claude and pi commonly live). A registration may name directories to
  // prepend; `$PATH` stays unquoted so the remote shell expands its own.
  // A leading ~/ means the remote user's home: it becomes an unquoted "$HOME"
  // concatenated with the quoted remainder, so the remote shell expands the
  // one and never touches the other.
  const dirs = target.path ? target.path.split(":").filter(Boolean).map((d) => (d.startsWith("~/") ? `"$HOME"${remoteQuote(d.slice(1))}` : remoteQuote(d))) : [];
  const prefix = dirs.length ? `PATH=${dirs.join(":")}:"$PATH" ` : "";
  // An optional working directory for commands that read their instance
  // from cwd (oats okf harvest): a quoted cd, never a path from the caller.
  // Sharing is on only when the caller checked the control directory
  // (controlUsable); otherwise ControlPath=none.
  const cmd = (cwd ? `cd ${remoteQuote(cwd)} && ` : "") + prefix + [target.oatsPath, ...oatsArgs].map(remoteQuote).join(" ");
  return ["ssh", ...SSH_OPTS, ...(control && !controlPathProblem() ? controlOpts() : NO_CONTROL_OPTS), "--", target.sshHost, cmd];
}

// ------------------------------------------------------------------ running

/** Parse the remote kernel's JSON envelope; anything else on stdout is a
 *  routing failure with the raw text attached, never a guess. */
export function parseRemoteEnvelope(stdout) {
  const text = String(stdout || "").trim();
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw serverError("E_REMOTE_ENVELOPE", `the remote oats did not answer with a JSON envelope: ${text.slice(0, 300) || "(empty stdout)"}`);
  }
  if (!doc || typeof doc !== "object") {
    throw serverError("E_REMOTE_ENVELOPE", `the remote oats answered with an unsupported envelope: ${text.slice(0, 300)}`);
  }
  // `status --json` predates the envelope and answers the bare roster
  // { root, agents } (team form: { team, roots }); normalize it too.
  if (doc.schemaVersion === undefined && (Array.isArray(doc.agents) || Array.isArray(doc.roots))) {
    return { schemaVersion: 1, ok: true, result: doc, bare: true };
  }
  // `retire --json` likewise answers its bare result object (oats-1lb).
  if (doc.schemaVersion === undefined && typeof doc.retired === "string") {
    return { schemaVersion: 1, ok: true, result: doc, bare: true };
  }
  if (doc.schemaVersion !== 1) {
    throw serverError("E_REMOTE_ENVELOPE", `the remote oats answered with an unsupported envelope: ${text.slice(0, 300)}`);
  }
  // `version --json` answers the Desktop API v1 probe payload rather than
  // an ok/result envelope; normalize it so every caller sees one shape.
  if (typeof doc.ok !== "boolean") {
    if (doc.desktopApi === 1 && typeof doc.version === "string") return { schemaVersion: 1, ok: true, result: doc, probe: true };
    throw serverError("E_REMOTE_ENVELOPE", `the remote oats answered with an unsupported envelope: ${text.slice(0, 300)}`);
  }
  return doc;
}

/** Run one remote oats command and return its envelope. A non-zero exit with
 *  a well-formed failure envelope is returned as that envelope (the remote
 *  kernel's own error code and message); ssh's own failures (unreachable,
 *  refused key, unknown host) surface as E_SSH with ssh's stderr. */
export function runRemote(target, oatsArgs, io = {}) {
  const exec = io.execFileSync || execFileSync;
  const [bin, ...argv] = sshArgv(target, oatsArgs, { cwd: io.cwd, control: controlUsable(target, io) });
  let stdout = "";
  let stderr = "";
  let status = 0;
  let started = true;
  let timedOut = false;
  try {
    // `io.input` (a Buffer) streams to the remote command's stdin: the only
    // way bytes reach a host, as a quoted argument never could.
    stdout = exec(bin, argv, { encoding: "utf8", stdio: [io.input === undefined ? "ignore" : "pipe", "pipe", "pipe"], ...(io.input === undefined ? {} : { input: io.input }), maxBuffer: 16 * 1024 * 1024, timeout: io.timeoutMs || 300000 });
  } catch (e) {
    stdout = String(e.stdout || "");
    // The process's own stderr when it ran (possibly empty); the error's
    // message only when there was no process to speak (ssh not found).
    stderr = String(e.stderr ?? e.message ?? "");
    status = typeof e.status === "number" ? e.status : 255;
    // Neither an exit status nor a signal: ssh never started (not installed, not executable).
    started = typeof e.status === "number" || !!e.signal;
    timedOut = e.code === "ETIMEDOUT";
  }
  // The call's own deadline killed ssh: whatever it printed is cut short. Still ssh's failure to the
  // envelope (E_SSH); `timedOut` lets a caller with a budget tell it from a broken link.
  if (timedOut) throw Object.assign(serverError("E_SSH", `ssh to ${target.sshHost} did not finish within ${Math.round((io.timeoutMs || 300000) / 1000)} s`), { timedOut: true });
  if (String(stdout).trim()) {
    const envelope = parseRemoteEnvelope(stdout);
    // A bare `retire --json` answer with cleanup still owed exits 1 on the
    // remote; the normalized envelope must say so too, or a routed retire
    // reports success while the remote home and its external state remain.
    if (envelope.bare && envelope.result?.rollbackIncomplete) {
      return { envelope: { ...envelope, ok: false, error: { code: "E_RETIRE_INCOMPLETE", message: `cleanup on the server is INCOMPLETE; the home ${envelope.result.retainedHome || ""} is retained there: ${envelope.result.rollbackIncomplete.join("; ")}` } }, stderr, status };
    }
    return { envelope, stderr, status };
  }
  // ssh exits 255 for its own failures; the remote command's exit code is
  // relayed otherwise. Either way with no envelope there is nothing to trust.
  // An ssh that never started is still E_SSH to callers, with `details: { sshStarted: false }` (it reaches
  // the --json envelope): there is no link to come back. No details means ssh started.
  const error = serverError(status === 255 ? "E_SSH" : "E_REMOTE_ENVELOPE", `${status === 255 ? `ssh to ${target.sshHost} failed` : `remote oats exited ${status} with no envelope`}: ${stderr.trim().slice(0, 400) || "(no output)"}`);
  if (status === 255 && !started) error.details = { sshStarted: false };
  throw error;
}

/** Version and envelope compatibility, checked BEFORE any mutation. The
 *  remote must answer `version --json` with the Desktop API v1 probe payload
 *  and a kernel the local side knows how to talk to. */
export function checkRemote(target, io = {}) {
  const probes = probesOf(io);
  const key = probeKey(io.serverId, target);
  const remote = probes.get(key) || probeRemote(target, io);
  probes.set(key, remote);
  const min = io.minVersion || MIN_REMOTE_VERSION;
  if (compareSemver(remote.version, min) < 0) {
    throw serverError("E_REMOTE_INCOMPATIBLE", `remote oats ${remote.version} at ${target.sshHost} is older than the minimum ${min} this kernel routes to; upgrade it there`);
  }
  return remote;
}

/** The version probe is asked once per process per server id and target: a
 *  command that probes, resolves and then acts asks the host once. The cache
 *  belongs to the transport (the process's ssh, or a caller's injected one)
 *  and holds successful answers only. */
const probeCaches = new Map();
const probesOf = (io) => {
  const exec = io.execFileSync || execFileSync;
  if (!probeCaches.has(exec)) probeCaches.set(exec, new Map());
  return probeCaches.get(exec);
};
const probeKey = (serverId, target) => JSON.stringify([serverId ?? null, target.sshHost, target.workspace, target.oatsPath, target.path ?? null]);

/** Forget every probe of a server id: its registration changed. */
export function dropRemoteProbes(serverId) {
  for (const probes of probeCaches.values()) for (const key of probes.keys()) if (JSON.parse(key)[0] === serverId) probes.delete(key);
}

function probeRemote(target, io) {
  const { envelope } = runRemote(target, ["version", "--json"], { ...io, timeoutMs: 60000 });
  const probe = envelope.result || {};
  if (probe.desktopApi !== 1 || typeof probe.version !== "string") {
    throw serverError("E_REMOTE_INCOMPATIBLE", `remote oats at ${target.sshHost} answered an unknown version payload: ${JSON.stringify(probe).slice(0, 200)}`);
  }
  // What the remote kernel advertises it can launch. A probe without these
  // fields is a 0.22.1-class kernel: pi and claude only, no session backend
  // choice, no launch options; nothing newer may be requested of it. The
  // harness list is named `harnesses` since 0.27.0; an older kernel names the
  // same list `runtimes`, and is read in its own vocabulary (lead call 6).
  const list = (k, fallback) => (Array.isArray(probe[k]) ? probe[k].map(String) : fallback);
  const harnessKey = Array.isArray(probe.harnesses) ? "harnesses" : "runtimes";
  return {
    version: probe.version, schemaVersion: 1, desktopApi: 1,
    harnesses: list(harnessKey, ["pi", "claude"]),
    sessionBackends: list("sessionBackends", []),
    launchOptions: list("launchOptions", []),
    remote: list("remote", []),
    features: list("features", []),
    operationsApi: [1, 2].includes(probe.operationsApi) ? probe.operationsApi : null,
    scheduleApi: [1, 2].includes(probe.scheduleApi) ? probe.scheduleApi : null,
    ...Object.fromEntries(["readinessApi", "eventsApi", "instanceGitApi", "lifecycleApi"].map((k) => [k, Number.isInteger(probe[k]) ? probe[k] : null])),
    advertised: Array.isArray(probe[harnessKey]),
  };
}

/** Refuse, before any mutation, a spawn that asks the remote kernel for a
 *  harness, session backend or launch option it does not advertise. The
 *  effective harness is the --harness flag or the soul's default from the
 *  remote roster, resolved THERE, since the local roster says nothing about
 *  that host's souls. Desktop's local support check cannot prove remote
 *  support; this is the proof. */
/** The client speaks the host's vocabulary (0.27.0, lead call 6): a host that does not
 *  advertise the harness feature is asked with `--runtime`, the name it reads. */
export function hostHarnessArgs(remote, args) {
  if ((remote?.features || []).includes("harness")) return args;
  return args.map((a) => (a === "--harness" ? "--runtime" : a.startsWith("--harness=") ? `--runtime=${a.slice("--harness=".length)}` : a));
}
export function checkRemoteSupport(remote, target, oatsArgs, roster) {
  const flagOf = (name) => { const i = oatsArgs.indexOf(name); return i >= 0 && oatsArgs[i + 1] && !oatsArgs[i + 1].startsWith("--") ? oatsArgs[i + 1] : undefined; };
  const agent = oatsArgs.find((a) => !a.startsWith("--"));
  const soul = (roster?.agents || []).find((a) => a.name === agent);
  // The effective harness is the flag, else the soul's default as the remote
  // roster reports it. A soul the roster does not list with a harness (a
  // capability-defined agent, or one with no live instance) has no default
  // this side can establish: the remote kernel validates its own default at
  // spawn, and nothing is asserted here about it.
  const namedConfig = oatsArgs.includes("--launch-config");
  // --runtime is the pre-0.27 name of --harness; a roster row from a host before 0.27 says `runtime`.
  const chosen = flagOf("--harness") || flagOf("--runtime");
  const harness = chosen || (namedConfig ? undefined : soul?.harness ?? soul?.runtime);
  // What the message may claim depends on what was established: an
  // advertising remote said what it supports; a silent one (before 0.22.2)
  // said nothing, and only pi and claude are assumed of it.
  const supports = remote.advertised
    ? `it advertises harnesses ${remote.harnesses.join(", ")}${remote.sessionBackends.length ? `, session backends ${remote.sessionBackends.join(", ")}` : ", no session backend choice"}${remote.launchOptions.length ? `, launch options ${remote.launchOptions.join(", ")}` : ", no launch options"}`
    : `it does not advertise its harnesses (kernels before 0.22.2 do not), so only pi and claude are assumed of it${remote.sessionBackends.length ? `, with session backends ${remote.sessionBackends.join(", ")}` : " on tmux"}${remote.launchOptions.length ? ` and launch options ${remote.launchOptions.join(", ")}` : " with no launch options"}; upgrade it there to use more`;
  const refuse = (what) => { throw serverError("E_REMOTE_INCOMPATIBLE", `remote oats ${remote.version} at ${target.sshHost}: ${what} was not established as supported there (${supports})`); };
  if (namedConfig && !remote.features.includes("launch-config")) refuse("a named launch configuration (the host must advertise launch-config)");
  if (harness && !remote.harnesses.includes(harness)) refuse(`harness ${harness}${chosen ? "" : ` (the default of soul ${agent} there)`}`);
  // A wake schedule at spawn is saved by the host: it must advertise schedules.
  if (["--wake-json", "--wake-every", "--wake-cron"].some((f) => oatsArgs.includes(f)) && !remote.features.includes("schedule")) refuse("a wake schedule at spawn (the host must advertise the schedule feature)");
  const backend = flagOf("--backend");
  if (backend && !remote.sessionBackends.includes(backend)) refuse(`session backend ${backend}`);
  if (oatsArgs.includes("--yolo") && !remote.launchOptions.includes("yolo")) refuse("the yolo launch option");
  return { harness, backend, yolo: oatsArgs.includes("--yolo") };
}

/** The remote kernel version that carries `oats session` (inspect, input,
 *  attach): routed session commands need at least this. */
export const SESSION_REMOTE_VERSION = "0.22.2";

/** The oldest remote kernel this router talks to: 0.22.1 answers the v1
 *  probe and roster and runs the lifecycle over ssh (qualified live on
 *  aweb-agents), but knows nothing of session backends, launch options,
 *  deferred self-retirement or the `oats session` commands (all 0.22.2);
 *  checkRemoteSupport keeps spawn requests within what a given remote
 *  advertises and session routes require SESSION_REMOTE_VERSION. The floor
 *  moves to 0.22.2 with that release. */
export const MIN_REMOTE_VERSION = "0.22.1";

export function compareSemver(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => Number.parseInt(x, 10));
  const pb = String(b).split(/[.-]/).map((x) => Number.parseInt(x, 10));
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// ---------------------------------------------------------------- snapshots

export function snapshotPath(serverId, instance) {
  if (!ID_RE.test(String(serverId))) throw serverError("E_SERVER_INVALID", `bad server id ${JSON.stringify(serverId)}`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(instance))) throw serverError("E_BAD_ARGS", `bad instance name ${JSON.stringify(instance)}`);
  return join(REMOTE_SNAPSHOT_DIR(), serverId, `${instance}.json`);
}

/** The local representation of a remote instance: the route it was spawned
 *  through, frozen. `serverId` is for display; every later operation uses
 *  `target`. Remote state is never copied here — status is pulled. */
export function writeSnapshot(serverId, target, remote, spawnResult) {
  const snap = {
    serverId,
    target,
    remote: { version: remote.version, schemaVersion: remote.schemaVersion },
    instance: spawnResult.instance,
    agent: spawnResult.agent,
    home: spawnResult.home,
    agentsRoot: spawnResult.agentsRoot,
    spawnedAt: new Date().toISOString(),
  };
  const p = snapshotPath(serverId, spawnResult.instance);
  mkdirSync(join(REMOTE_SNAPSHOT_DIR(), serverId), { recursive: true });
  writeFileSync(p, JSON.stringify(snap, null, 2) + "\n");
  return snap;
}

export function readSnapshot(serverId, instance) {
  const p = snapshotPath(serverId, instance);
  if (!existsSync(p)) return undefined;
  let snap;
  try {
    snap = JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    throw serverError("E_SNAPSHOT_UNREADABLE", `${p}: ${e.message}`);
  }
  return savedRoute(snap);
}

/** A saved route as read: its frozen target without any recorded `herdrPath`. */
function savedRoute(snap) {
  return snap && typeof snap === "object" && !Array.isArray(snap) && snap.target ? { ...snap, target: withoutHerdrPath(snap.target) } : snap;
}

export function removeSnapshot(serverId, instance) {
  rmSync(snapshotPath(serverId, instance), { force: true });
}

/** Drop a saved route on purpose: the remote instance is gone (retired on the
 *  host, home removed, host rebuilt) and nothing routed can remove the
 *  snapshot any more. The operator's decision, never automatic. */
export function forgetSnapshot(serverId, instance) {
  const p = snapshotPath(serverId, instance);
  if (!existsSync(p)) throw serverError("E_SNAPSHOT_UNKNOWN", `no saved route for ${instance} through server ${serverId} (oats server roster --json)`);
  const snap = readSnapshot(serverId, instance);
  rmSync(p, { force: true });
  return snap;
}

export function listSnapshots(serverId) {
  const dir = join(REMOTE_SNAPSHOT_DIR(), serverId);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      out.push(savedRoute(JSON.parse(readFileSync(join(dir, f), "utf8"))));
    } catch {
      out.push({ serverId, instance: f.replace(/\.json$/, ""), unreadable: true });
    }
  }
  return out;
}

// ------------------------------------------------------------------- routes

/** Route one lifecycle command to a server. Returns the remote envelope,
 *  having kept the local snapshot store in step with it:
 *  - spawn: compatibility checked first, a snapshot written on success;
 *  - retire: the target comes from the instance's snapshot when one exists
 *    (the registry may have changed since), the snapshot is removed only
 *    when the remote kernel reports the home gone;
 *  - status: pulled from the remote kernel, never cached. */
export function routeCommand(serverId, cmd, oatsArgs, io = {}) {
  io = { ...io, serverId };
  // The host's reads and plans resolve their own route: a saved one needs no registration.
  if (cmd === "readiness" || cmd === "instance" || (cmd === "retire" && oatsArgs.includes("--plan"))) return routeHostSurface(serverId, cmd, oatsArgs, io);
  // A retirement may outlive its registration: the snapshot taken at spawn
  // is the route, and it is consulted before the registry is required.
  const instanceArg = oatsArgs.find((a) => !a.startsWith("--"));
  const snap = ["retire", "harvest"].includes(cmd) && instanceArg ? readSnapshot(serverId, instanceArg) : undefined;
  let server = io.server;
  if (!server) {
    try { server = getServer(serverId); }
    catch (e) { if (!snap?.target) throw e; }
  }
  let target = snap?.target || targetOf(server);
  const withScope = (args) => (args.includes("--dir") ? args : [...args, "--dir", target.workspace]);
  const json = (args) => (args.includes("--json") ? args : [...args, "--json"]);

  if (cmd === "spawn") {
    // A registration edited to another target must not overwrite the saved
    // routes of instances spawned through the old one: the next snapshot for
    // the same name would silently retarget them. Refuse, naming the remedy.
    const priorTargets = listSnapshots(serverId).filter((s) => s.target && targetKey(s.target) !== targetKey(target));
    if (priorTargets.length) {
      const old = priorTargets[0].target;
      throw serverError("E_ROUTE_CHANGED", `server ${serverId} now points at ${target.sshHost}:${target.workspace}, but ${priorTargets.length} saved route${priorTargets.length === 1 ? "" : "s"} for it (${priorTargets.map((s) => s.instance).join(", ")}) target ${old.sshHost}:${old.workspace}; spawning would overwrite them. Keep the old registration and add a new server id for the new target, or retire those instances first`);
    }
    const remote = checkRemote(target, io);
    // A saved route is keyed by name under its server id. An explicit name
    // that already has one here would overwrite that route on success: refuse
    // before the mutation (the roster shows the existing route; forget or
    // retire it first).
    const ii = oatsArgs.indexOf("--instance");
    const explicitName = ii >= 0 && oatsArgs[ii + 1] && !oatsArgs[ii + 1].startsWith("--") ? oatsArgs[ii + 1] : undefined;
    if (explicitName && readSnapshot(serverId, explicitName)) throw serverError("E_ROUTE_EXISTS", `a saved route for ${explicitName} through server ${serverId} already exists (${readSnapshot(serverId, explicitName).home}); retire it (oats retire ${explicitName} --server ${serverId}) or drop it (oats server forget ${serverId} --instance ${explicitName}) before spawning that name again`);
    // The remote roster: the soul's harness default for the support check,
    // and the remote agents root for the snapshot (the kernel's spawn result
    // does not carry it, and guessing it from the workspace would be wrong).
    const status = runRemote(target, json(withScope(["status"])), io).envelope;
    if (!status.ok) return { envelope: status, stderr: "" };
    checkRemoteSupport(remote, target, oatsArgs, status.result);
    const { envelope, stderr } = runRemote(target, json(withScope(["spawn", ...hostHarnessArgs(remote, oatsArgs)])), io);
    if (envelope.ok && envelope.result?.instance) {
      // A generated name can still collide with a saved route of another
      // soul on the same host (dev --purpose foo-1 vs dev-foo --purpose 1).
      // The existing route is never overwritten: the new instance is
      // reported without a saved route, to be retired on the host by --home.
      // An existing route is replaced only by a result that provably names
      // the same home; absent data is never permission to overwrite it.
      const prior = readSnapshot(serverId, envelope.result.instance);
      const sameAsPrior = prior && prior.home && envelope.result.home && resolve(prior.home) === resolve(envelope.result.home);
      if (prior && !sameAsPrior) {
        const warnings = [...(envelope.result.warnings || []), `no saved route: ${envelope.result.instance} already names ${prior.home} through ${serverId}; this instance (${envelope.result.home}) is not managed from here, retire it on the host with oats retire ${envelope.result.instance} --home ${envelope.result.home}`];
        return { envelope: { ...envelope, result: { ...envelope.result, server: serverId, target, snapshot: null, routeConflict: { instance: envelope.result.instance, existingHome: prior.home }, warnings } }, stderr };
      }
      const snapshot = writeSnapshot(serverId, target, remote, { ...envelope.result, agentsRoot: envelope.result.agentsRoot || status.result.root });
      return { envelope: { ...envelope, result: { ...envelope.result, server: serverId, target, snapshot: snapshotPath(serverId, envelope.result.instance) } }, stderr, snapshot };
    }
    return { envelope, stderr };
  }
  if (cmd === "retire") {
    const name = instanceArg;
    const remote = checkRemote(target, io); // a mutation: version and envelope first, like spawn
    // The saved route knows WHICH home was spawned through it; a remote kernel
    // that resolves --home retires that one, never a same-named twin. A
    // caller's explicit --home must be that same home: anything else would
    // retire a sibling and then drop this instance's saved route.
    const hi = oatsArgs.indexOf("--home");
    const explicitHome = hi >= 0 && oatsArgs[hi + 1] && !oatsArgs[hi + 1].startsWith("--") ? oatsArgs[hi + 1] : undefined;
    if (explicitHome && snap?.home && resolve(explicitHome) !== resolve(snap.home)) throw serverError("E_HOME_MISMATCH", `--home ${explicitHome} is not the saved route of ${name} on ${serverId} (${snap.home}); retire the saved one, or retire the other instance on the host by its own name`);
    // A guarded apply carries the revision of a plan: the host must speak the lifecycle contract.
    const guarded = oatsArgs.includes("--plan-revision") || oatsArgs.includes("--idempotency-key");
    if (guarded) requireSurface(remote, target, HOST_SURFACES["retire plan"]);
    const remoteRetiresByHome = Array.isArray(remote?.features) && remote.features.includes("retire-home");
    // No saved route and no --home: the name resolves through the host's
    // roster to its one home, so a same-named twin is never the one retired.
    // A guarded apply whose name the host no longer lists goes as is: the
    // host replays the receipt recorded under its key, or refuses.
    let hostHome;
    if (name && !explicitHome && !snap?.home) {
      try { hostHome = instanceOnHost(serverId, name, { ...io, server }).home; }
      catch (e) { if (!(guarded && e.code === "E_SNAPSHOT_UNKNOWN")) throw e; }
    }
    const wantHome = explicitHome || snap?.home || hostHome;
    if (wantHome && !remoteRetiresByHome) {
      // An older kernel ignores --home and retires by name, first match. It
      // is safe only when the name is unique there and is the saved home;
      // an explicit --home is never sent where it cannot be honoured.
      if (explicitHome) throw serverError("E_REMOTE_INCOMPATIBLE", `remote oats ${remote.version} at ${target.sshHost} cannot retire by home (0.22.3 or later does); upgrade it there, or retire ${name} without --home once it is the only instance of that name`);
      const st = runRemote(target, ["status", "--json", "--dir", target.workspace], io).envelope;
      if (!st.ok) throw serverError(st.error?.code || "E_REMOTE", `cannot check ${name} on ${serverId} before retiring by name: ${st.error?.message || "status failed"}`);
      const twins = (st.result?.agents || []).flatMap((a) => (a.instances || []).filter((i) => i.instance === name).map((i) => ({ agent: a.name, home: i.home })));
      if (twins.length > 1) throw serverError("E_REMOTE_INCOMPATIBLE", `${name} names ${twins.length} instances on ${serverId} (${twins.map((t) => t.agent).join(", ")}) and remote oats ${remote.version} retires by name only; upgrade it to 0.22.3 or later so the saved home is retired and not a twin`);
      if (twins.length === 1 && twins[0].home && resolve(twins[0].home) !== resolve(wantHome)) throw serverError("E_HOME_MISMATCH", `the only ${name} on ${serverId} lives at ${twins[0].home}, not at the saved route ${wantHome}; the saved route is stale (oats server roster --json)`);
    }
    const homeArgs = remoteRetiresByHome && wantHome && !explicitHome ? ["--home", wantHome] : [];
    const { envelope, stderr } = runRemote(target, json(withScope(["retire", ...oatsArgs, ...homeArgs])), io);
    // The snapshot goes only when the remote home is gone: not on incomplete
    // cleanup, and not on a deferred completion still on its way there.
    if (envelope.ok && name && envelope.result?.removedDir !== false && !envelope.result?.rollbackIncomplete && !envelope.result?.deferred) removeSnapshot(serverId, name);
    // The routing context rides on the result whenever there is one, ok or
    // not: an incomplete cleanup is exactly when the operator needs the host.
    return { envelope: envelope.result ? { ...envelope, result: { ...envelope.result, server: serverId, target } } : envelope, stderr };
  }
  if (cmd === "harvest") {
    // `oats okf harvest --json` reads its instance from cwd: run it in the
    // SAVED home of an instance spawned through this route (no path from
    // the caller), relaying the package's own envelope.
    const name = instanceArg;
    if (!snap?.home) throw serverError("E_SNAPSHOT_UNKNOWN", `no remote instance ${JSON.stringify(name || "")} spawned through server ${serverId} from this machine (oats server roster --json)`);
    // A mutation on the host (it spawns a harvester there): version and
    // envelope first. The remote list is a kernel-version proxy (0.22.3
    // introduced this route and the envelope boundary it relies on); an
    // older okf package there would still answer outside the envelope, which
    // then fails as E_REMOTE_ENVELOPE rather than as a bad harvest.
    const remote = checkRemote(target, io);
    if (!Array.isArray(remote.remote) || !remote.remote.includes("harvest")) throw serverError("E_REMOTE_INCOMPATIBLE", `remote oats ${remote.version} at ${target.sshHost} does not route okf harvest (0.22.3 or later does)`);
    const { envelope, stderr } = runRemote(target, ["okf", "harvest", "--json"], { ...io, cwd: snap.home });
    // The package's result names the HARVESTER it spawned (instance, window);
    // the routing context goes under its own keys.
    return { envelope: envelope.result ? { ...envelope, result: { ...envelope.result, server: serverId, sourceInstance: name, sourceHome: snap.home } } : envelope, stderr };
  }
  if (cmd === "status") {
    const { envelope, stderr } = runRemote(target, json(withScope(["status", ...oatsArgs])), io);
    return { envelope: envelope.ok ? { ...envelope, result: { ...envelope.result, server: serverId, target, snapshots: listSnapshots(serverId) } } : envelope, stderr };
  }
  if (OPERATIONS_COMMANDS.has(cmd)) {
    // The operations contract (inspect, operation run): the
    // remote must advertise it before anything is sent. An explicit --dir is
    // the exact member context the caller chose and travels as is; without
    // one, a --home selection is left to the host (the home is its own
    // context) and anything else runs in the registered workspace.
    // An exact remote home (or a saved instance name) resolves through its
    // FROZEN route exactly as session attach does: the snapshot's target,
    // and a home/name disagreement is refused; the registration's target is
    // used only for scope requests, which get its workspace as --dir.
    let args = [...oatsArgs];
    const valueOf = (name) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined; };
    let route;
    if (valueOf("--home") !== undefined || valueOf("--instance") !== undefined) {
      route = resolveRoute(serverId, { instance: valueOf("--instance"), home: valueOf("--home") }, cmd, io);
      target = route.target;
      const ii = args.indexOf("--instance");
      if (ii >= 0) { args.splice(ii, 2); if (valueOf("--home") === undefined) args.push("--home", route.home); }
    }
    const remote = checkRemote(target, io);
    if (!Array.isArray(remote.features) || !remote.features.includes("operations") || ![1, 2].includes(remote.operationsApi)) {
      throw serverError("E_REMOTE_INCOMPATIBLE", `remote oats ${remote.version} at ${target.sshHost} does not advertise the operations contract (kernels from ${OPERATIONS_REMOTE_VERSION} do); upgrade it there; nothing was sent`);
    }
    const scoped = args.includes("--dir") || args.includes("--home") ? args : [...args, "--dir", target.workspace];
    const { envelope, stderr } = runRemote(target, json([cmd, ...scoped]), io);
    return { envelope: envelope.result && typeof envelope.result === "object" ? { ...envelope, result: { ...envelope.result, server: serverId, ...(route ? { route: { home: route.home, instance: route.snapshot?.instance || null, frozen: !!route.snapshot } } : {}) } } : envelope, stderr };
  }
  throw serverError("E_USAGE", `--server routes spawn, retire, status, session, okf harvest, schedule, inspect, operation, readiness and instance only (not ${cmd})`);
}

/** The Desktop's per-instance reads and lifecycle plans, as the host's kernel
 *  answers them: the feature and API number the host must advertise first. */
const HOST_SURFACES = {
  readiness: { feature: "readiness", api: "readinessApi", version: 2 },
  "instance events": { feature: "instance-events-2", api: "eventsApi", version: 2 },
  "instance git": { feature: "instance-git", api: "instanceGitApi", version: 1 },
  "instance diff": { feature: "instance-git", api: "instanceGitApi", version: 1 },
  "instance stop": { feature: "lifecycle-plans", api: "lifecycleApi", version: 1 },
  "retire plan": { feature: "lifecycle-plans", api: "lifecycleApi", version: 1 },
};

function requireSurface(remote, target, surface) {
  if (!remote.features.includes(surface.feature) || remote[surface.api] !== surface.version) {
    throw serverError("E_REMOTE_INCOMPATIBLE", `remote oats ${remote.version} at ${target.sshHost} does not advertise ${surface.feature} (${surface.api} ${surface.version}); upgrade it there; nothing was sent`);
  }
}

/** `readiness`, `instance events|git|diff|stop` and `retire --plan` on the
 *  host: the instance is addressed as every routed session command addresses
 *  it (its name through a saved route or the host's roster, or an exact
 *  --home), the scope is an explicit --dir on the host or the registered
 *  workspace (readiness of a home is its own context), and the host's
 *  envelope is relayed unchanged. */
function routeHostSurface(serverId, cmd, oatsArgs, io) {
  const key = cmd === "instance" ? `instance ${oatsArgs[0]}` : cmd === "retire" ? "retire plan" : cmd;
  const surface = HOST_SURFACES[key];
  if (!surface) throw serverError("E_USAGE", `--server routes instance events, git, diff and stop only (not ${key})`);
  const args = [...oatsArgs];
  const valueOf = (flag) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : undefined; };
  const name = cmd === "readiness" ? undefined : args[cmd === "instance" ? 1 : 0];
  if (cmd !== "readiness" && (!name || name.startsWith("--"))) throw serverError("E_BAD_ARGS", `${key} --server needs the instance name`);
  const home = valueOf("--home");
  if (args.includes("--home") && home === undefined) throw serverError("E_BAD_ARGS", "--home needs an absolute instance home");
  let target;
  if (name !== undefined || home !== undefined) {
    const route = resolveRoute(serverId, { instance: name, home }, key, io);
    target = route.target;
    if (home === undefined) args.push("--home", route.home);
  } else target = targetOf(io.server || getServer(serverId));
  requireSurface(checkRemote(target, io), target, surface);
  if (!args.includes("--dir") && !(cmd === "readiness" && home !== undefined)) args.push("--dir", target.workspace);
  const { envelope, stderr } = runRemote(target, [cmd, ...args, "--json"], io);
  return { envelope, stderr };
}

// ------------------------------------------------------------------- roster

// The roster answers within a budget the Desktop can wait for (its adapter
// allows 60 s): each target gets the smaller of its own allowance and what is
// left, and targets the budget cannot reach are reported as such, never
// dropped and never allowed to sink the healthy groups.
export const ROSTER_BUDGET_MS = 45000;
export const ROSTER_PER_TARGET_TIMEOUT_MS = 20000;

function listSnapshotServers() {
  const dir = REMOTE_SNAPSHOT_DIR();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && ID_RE.test(e.name)).map((e) => e.name);
}

/** The remote roster, grouped by server id and saved route target: one
 *  bounded status pull per group, registrations unioned with saved routes so
 *  a removed or changed registration keeps its group (registrationPresent
 *  false) and its instances from the snapshots (running null when the probe
 *  fails). Remote state is pulled, never cached; the saved route stays the
 *  action authority. */
/** The facts a remote row relays from the host's `status --json` row, as the
 *  host reported them; a fact the host does not supply is null, never
 *  derived here. */
export const REMOTE_ROW_FACTS = ["identity", "identityAddress", "teams", "startedAt", "createdAt", "model", "runtimeState", "parentInstance", "siblingInstance", "relation", "relativeTo", "spawnOrigin"];
const rowFacts = (i = {}) => Object.fromEntries(REMOTE_ROW_FACTS.map((k) => [k, i[k] ?? null]));

export function rosterGroups({ server, io = {} } = {}) {
  const started = Date.now();
  if (server && !ID_RE.test(server)) throw serverError("E_BAD_ARGS", `server id ${JSON.stringify(server)} is not a valid id`);
  if (server && !readServers()[server] && !existsSync(join(REMOTE_SNAPSHOT_DIR(), server))) throw serverError("E_SERVER_UNKNOWN", `no server registered as ${JSON.stringify(server)} and no saved routes for it (oats server list)`);
  const perTargetTimeoutMs = io.perTargetTimeoutMs || ROSTER_PER_TARGET_TIMEOUT_MS;
  const budgetMs = io.budgetMs || ROSTER_BUDGET_MS;
  let skipped = 0;
  const servers = readServers();
  const groups = new Map();
  const add = (serverId, target, registrationPresent, label) => {
    const key = `${serverId}:${targetKey(target)}`;
    if (!groups.has(key)) groups.set(key, { id: key, server: serverId, label: label || serverId, registrationPresent, target, probe: null, agentsRoot: undefined, workspace: null, souls: [], instances: [], retireFailures: [], _snapshots: [] });
    const g = groups.get(key);
    if (registrationPresent) g.registrationPresent = true;
    return g;
  };
  for (const [id, s] of Object.entries(servers)) { if (server && id !== server) continue; add(id, targetOf({ id, ...s }), true, s.label); }
  for (const serverId of listSnapshotServers()) {
    if (server && serverId !== server) continue;
    for (const snap of listSnapshots(serverId)) { if (!snap.target) continue; add(serverId, snap.target, false, servers[serverId]?.label)._snapshots.push(snap); }
  }
  for (const g of groups.values()) {
    let status;
    const remaining = budgetMs - (Date.now() - started);
    if (remaining < 1000) {
      skipped++;
      g.probe = { ok: false, error: { code: "E_ROSTER_BUDGET", message: `not probed: the ${budgetMs} ms roster budget was used up by earlier targets` } };
    } else {
      try { status = runRemote(g.target, ["status", "--json", "--dir", g.target.workspace], { ...io, serverId: g.server, timeoutMs: Math.min(perTargetTimeoutMs, remaining) }).envelope; }
      catch (e) { g.probe = { ok: false, error: { code: e.code || "E_SSH", message: e.message } }; }
    }
    if (status && !status.ok) g.probe = { ok: false, error: status.error || { code: "E_REMOTE", message: "status failed" } };
    // A saved route matches a remote row by name AND home: a same-named
    // twin under another soul on the host is observed only, never given the
    // route (the route's own row is appended as stale if the host no longer
    // lists that home).
    const bySnapshot = new Map(g._snapshots.map((s) => [s.instance, s]));
    const routeOf = (i) => { const s = bySnapshot.get(i.instance); return s && s.home && i.home && resolve(s.home) === resolve(i.home) ? s : undefined; };
    if (status?.ok) {
      g.probe = { ok: true };
      g.agentsRoot = status.result.root;
      // The host's own workspace identity (feature workspace-identity), relayed as it answered it: never
      // derived here, null when the host reports none.
      g.workspace = status.result.workspace ?? null;
      for (const a of status.result.agents || []) {
        g.souls.push({ name: a.name, harness: a.harness ?? a.runtime, work: a.work, backend: a.backend, description: a.description, agentsRoot: status.result.root });
        // A failed deferred self-retirement needs an operator: it rides with
        // the group, named by agent and instance, as `oats status` prints it.
        for (const f of a.retireFailures || []) g.retireFailures.push({ agent: a.name, ...f });
        for (const i of a.instances || []) {
          const snap = routeOf(i);
          g.instances.push({
            server: g.server, instance: i.instance, agent: a.name, home: i.home || snap?.home, agentsRoot: status.result.root,
            harness: i.harness || i.runtime || null, backend: i.tmux ? "tmux" : null,
            ...(i.sessionTarget ? { sessionTarget: i.sessionTarget } : {}), ...(i.tmux ? { tmux: i.tmux } : {}),
            running: typeof i.running === "boolean" ? i.running : null, ...(i.runtimeError ? { runtimeError: i.runtimeError } : {}),
            ...rowFacts(i),
            // Every row the host reports is addressed by its home, saved
            // route or not; savedRoute says only that it was spawned from here.
            retirePending: !!i.retirePending, rollbackIncomplete: !!i.rollbackIncomplete, savedRoute: !!snap, addressable: true, missingRemotely: false,
          });
          if (snap) bySnapshot.delete(i.instance);
        }
      }
    }
    // Saved routes the remote did not list: with a good probe that means the
    // instance is gone there (retired, or its home removed) and the route is
    // stale; with a failed probe nothing is known. Same keys as remote rows.
    for (const snap of bySnapshot.values()) {
      // Addressable through its saved route unless the host said it is gone.
      g.instances.push({ server: g.server, instance: snap.instance, agent: snap.agent, home: snap.home, agentsRoot: snap.agentsRoot, harness: snap.harness || snap.runtime || null, backend: null, running: null, ...rowFacts(), retirePending: false, rollbackIncomplete: false, savedRoute: true, addressable: g.probe?.ok !== true, missingRemotely: g.probe?.ok === true });
    }
    delete g._snapshots;
  }
  return { groups: [...groups.values()], bounds: { budgetMs, perTargetTimeoutMs, elapsedMs: Date.now() - started, skipped } };
}

/** argv for an INTERACTIVE remote command (a viewer attach): ssh with a PTY,
 *  stdio inherited by the caller. The home is resolved from the instance's
 *  snapshot when only an instance name is given, so the route is the saved
 *  one and nothing about the remote binary or path comes from the caller. */
/** The saved route for a remote instance: the snapshot's target and home
 *  when an instance name is given (spawned from here), else the registry's
 *  target with a caller-supplied absolute remote home. Nothing about the
 *  remote binary or path ever comes from the caller. */
export function resolveRoute(serverId, { instance, home } = {}, what = "session", io = {}) {
  // The home is the identity (same-named twins on one host are different
  // instances). A name resolves through its saved route, else through the
  // host's own roster. With a home, the saved route that owns it supplies the
  // target (a registration edited later never re-routes a viewer); a home no
  // saved route owns is addressed through the registration. A name AND a home
  // must agree.
  let snap = instance ? readSnapshot(serverId, instance) : undefined;
  if (home && snap?.home && resolve(snap.home) !== resolve(home)) throw serverError("E_HOME_MISMATCH", `--home ${home} is not the saved route of ${instance} on ${serverId} (${snap.home})`);
  if (home && !snap) snap = listSnapshots(serverId).find((s) => s.home && resolve(s.home) === resolve(home));
  if (instance && snap && snap.instance !== instance) throw serverError("E_HOME_MISMATCH", `--home ${home} is the saved route of ${snap.instance} on ${serverId}, not of ${instance}`);
  if (instance && !snap && home && basename(home) !== instance) throw serverError("E_HOME_MISMATCH", `--home ${home} is not the home of instance ${instance}`);
  const remoteHome = home || snap?.home || (instance ? instanceOnHost(serverId, instance, io).home : undefined);
  const target = snap?.target || targetOf(io.server || getServer(serverId));
  if (!remoteHome || !String(remoteHome).startsWith("/")) throw serverError("E_BAD_ARGS", `${what} --server needs --instance <name> or --home </absolute/remote/home>`);
  return { target, home: remoteHome, snapshot: snap };
}

/** An instance with no saved route here, by name, through the host's own
 *  roster (one `status --json` in the registered workspace): the one home of
 *  that name there, or E_AMBIGUOUS naming every home, or E_SNAPSHOT_UNKNOWN. */
export function instanceOnHost(serverId, name, io = {}) {
  const target = targetOf(io.server || getServer(serverId));
  const status = runRemote(target, ["status", "--json", "--dir", target.workspace], { ...io, serverId, input: undefined }).envelope;
  if (!status.ok) throw serverError(status.error?.code || "E_REMOTE", `cannot resolve ${name} on server ${serverId}: ${status.error?.message || "status failed"}`);
  const candidates = (status.result?.agents || []).flatMap((a) => (a.instances || []).filter((i) => i.instance === name).map((i) => ({ agent: a.name, home: i.home })));
  if (!candidates.length) throw serverError("E_SNAPSHOT_UNKNOWN", `no instance ${JSON.stringify(name)} on server ${serverId}: neither a saved route here nor its roster names one (oats server roster --server ${serverId})`);
  if (candidates.length > 1) throw Object.assign(serverError("E_AMBIGUOUS", `instance ${JSON.stringify(name)} names ${candidates.length} homes on server ${serverId}: ${candidates.map((c) => `${c.home} (${c.agent})`).join(", ")}; pass --home <one of them>`), { details: { candidates } });
  return { target, home: candidates[0].home };
}

/** `session inspect` on the execution host for a remote instance: the same
 *  route resolution as attach, the standard envelope relayed as is (ok or
 *  not), never an ACK of anything. */
/** A version is a proxy; the probe's `remote` list states the capability
 *  directly: a kernel that routes session itself also serves it. A silent
 *  probe (before 0.22.2) or one without session in the list is refused
 *  before any session command is sent. */
function requireSessionRemote(target, io, home) {
  const remote = checkRemote(target, io);
  if (!remote.remote.includes("session")) {
    throw serverError("E_REMOTE_INCOMPATIBLE", `remote oats ${remote.version} at ${target.sshHost} does not advertise the \`oats session\` commands (kernels from ${SESSION_REMOTE_VERSION} do); upgrade it there, or attach with ssh -t ${target.sshHost} tmux attach -t ${recordedTmuxTarget(target, io, home)}`);
  }
  return remote;
}

/** Where a kernel without `oats session` put the instance's window: the tmux
 *  session and window its roster records for that home, else its default
 *  session (pi-agents, the default of every kernel before 0.31). */
const OLD_KERNEL_TMUX_SESSION = "pi-agents";
function recordedTmuxTarget(target, io, home) {
  try {
    const status = runRemote(target, ["status", "--json", "--dir", target.workspace], { ...io, input: undefined }).envelope;
    const row = (status.ok ? status.result?.agents || [] : []).flatMap((a) => a.instances || []).find((i) => i.home && home && resolve(i.home) === resolve(home));
    if (row?.tmux?.session) return row.tmux.window ? `${row.tmux.session}:${row.tmux.window}` : row.tmux.session;
  } catch { /* the hint falls back to the default session */ }
  return OLD_KERNEL_TMUX_SESSION;
}

export function inspectRemote(serverId, { instance, home } = {}, io = {}) {
  io = { ...io, serverId };
  const route = resolveRoute(serverId, { instance, home }, "session inspect", io);
  requireSessionRemote(route.target, io, route.home);
  const { envelope, stderr } = runRemote(route.target, ["session", "inspect", "--home", route.home, "--json"], io);
  return { envelope: envelope.ok ? { ...envelope, result: { ...envelope.result, server: serverId, instance: instance || route.snapshot?.instance, home: route.home } } : envelope, stderr, route };
}

/** The kernel version whose probe first advertises the `session-start`
 *  feature; the probe's features list is the actual check. */
export const SESSION_START_REMOTE_VERSION = "0.22.9";
/** The kernel version whose probe first advertises the operations contract. */
export const OPERATIONS_REMOTE_VERSION = "0.22.16";
const OPERATIONS_COMMANDS = new Set(["inspect", "operation"]);

/** `session start` on the execution host for a remote instance: the same
 *  route resolution as inspect, refused before any mutation when the remote
 *  kernel does not advertise session-start, the envelope relayed as is. */
export function startRemote(serverId, choices = {}, io = {}) {
  return launchRemoteSession(serverId, "start", choices, io);
}

export function restartRemote(serverId, choices = {}, io = {}) {
  return launchRemoteSession(serverId, "restart", choices, io);
}

function remoteLaunchArgs({ launchConfig, harness, model, yolo } = {}) {
  const args = [];
  if (launchConfig !== undefined) {
    if (typeof launchConfig !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(launchConfig)) throw serverError("E_BAD_ARGS", "invalid launch configuration name");
    args.push("--launch-config", launchConfig);
  }
  if (harness !== undefined) {
    if (!["pi", "claude", "codex"].includes(harness)) throw serverError("E_BAD_ARGS", "harness must be pi, claude or codex");
    args.push("--harness", harness);
  }
  if (model !== undefined && model !== null && model !== "") {
    if (typeof model !== "string" || model.startsWith("-") || model.includes("\0")) throw serverError("E_BAD_ARGS", "invalid model name");
    args.push("--model", model);
  }
  if (yolo !== undefined) {
    if (typeof yolo !== "boolean") throw serverError("E_BAD_ARGS", "yolo must be true or false");
    args.push(yolo ? "--yolo" : "--no-yolo");
  }
  return args;
}

function requireRemoteFeature(remote, target, feature) {
  if (!remote.features.includes(feature)) throw serverError("E_REMOTE_INCOMPATIBLE", `remote oats ${remote.version} at ${target.sshHost} does not advertise ${feature}; upgrade it there; nothing was sent`);
}

function launchRemoteSession(serverId, action, choices, io) {
  io = { ...io, serverId };
  const { instance, home, launchConfig, harness, yolo } = choices;
  const choiceArgs = remoteLaunchArgs(choices);
  const route = resolveRoute(serverId, { instance, home }, `session ${action}`, io);
  const remote = requireSessionRemote(route.target, io, route.home);
  if (!remote.features.includes("session-start")) {
    throw serverError("E_REMOTE_INCOMPATIBLE", `remote oats ${remote.version} at ${route.target.sshHost} does not advertise session-start (kernels from ${SESSION_START_REMOTE_VERSION} do); upgrade it there, or start the instance on that host`);
  }
  if (action === "restart") requireRemoteFeature(remote, route.target, "session-restart");
  if (launchConfig !== undefined || harness !== undefined || yolo !== undefined) requireRemoteFeature(remote, route.target, "launch-config");
  const args = ["session", action, "--home", route.home, ...hostHarnessArgs(remote, choiceArgs), "--json"];
  const { envelope, stderr } = runRemote(route.target, args, io);
  return { envelope: envelope.ok ? { ...envelope, result: { ...envelope.result, server: serverId, instance: instance || route.snapshot?.instance || envelope.result.instance } } : envelope, stderr, route };
}

/** Scope operations follow the registration; existing-home operations follow
 * its saved route. Definitions travel on stdin, never as remote file paths or
 * shell arguments. The host resolves environment references and validates the
 * definition; this client never substitutes its own environment. */
/** A launch definition in the host's vocabulary: `harness` for a host with the harness feature,
 *  `runtime` for one before 0.27.0. Either spelling is read here; both, disagreeing, are refused. */
function hostLaunchDefinition(remote, definition) {
  // `default` (0.32) never reaches a host without the feature: `true` is refused, `false` (the absence) dropped.
  if (definition && Object.hasOwn(definition, "default") && !(remote?.features || []).includes("launch-config-default")) {
    if (definition.default === true) throw serverError("E_REMOTE_INCOMPATIBLE", "the server's OATS does not support a default launch configuration (feature launch-config-default, OATS 0.32+); upgrade it, or set the configuration without default");
    if (definition.default !== false) throw serverError("E_LAUNCH_CONFIG_INVALID", "default must be true or false");
    const { default: _absent, ...without } = definition;
    definition = without;
  }
  const { harness, runtime, ...rest } = definition; // a disagreeing pair was refused before the probe
  if (runtime !== undefined) noteRuntimeName("runtime in the launch configuration definition (sent as the host's harness key)");
  const value = harness ?? runtime;
  if (value === undefined) return rest;
  return (remote?.features || []).includes("harness") ? { ...rest, harness: value } : { ...rest, runtime: value };
}
export function launchConfigRemote(serverId, options = {}, io = {}) {
  io = { ...io, serverId };
  const { action, name, context, instance, home, soul, agentsRoot, definition, keepEnv } = options;
  if (!["list", "set", "remove", "preview"].includes(action)) throw serverError("E_BAD_ARGS", "unknown launch configuration action");
  const write = action === "set" || action === "remove";
  const homeSelected = home !== undefined || instance !== undefined;
  if (homeSelected && (context !== undefined || soul !== undefined || agentsRoot !== undefined)) throw serverError("E_BAD_ARGS", "select one home or configuration scope");
  if (write && (homeSelected || soul !== undefined || agentsRoot !== undefined)) throw serverError("E_BAD_ARGS", "edit a launch configuration with --dir, not a home or soul");
  if (action === "preview" && !homeSelected && !soul) throw serverError("E_BAD_ARGS", "select a home or soul to preview");
  const args = ["launch-config", action];
  if (write) {
    if (typeof name !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name)) throw serverError("E_BAD_ARGS", "invalid launch configuration name");
    args.push(name);
  }
  let input;
  if (action === "set") {
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw serverError("E_BAD_ARGS", "specify a launch configuration object");
    if (keepEnv !== undefined && typeof keepEnv !== "boolean") throw serverError("E_BAD_ARGS", "keepEnv must be true or false");
    if (keepEnv && Object.hasOwn(definition, "env")) throw serverError("E_BAD_ARGS", "omit env when preserving the saved environment");
    if (definition.harness !== undefined && definition.runtime !== undefined && definition.harness !== definition.runtime) throw serverError("E_BAD_ARGS", "the definition names harness and runtime (its pre-0.27 name) with different values; nothing was sent");
    input = Buffer.from(JSON.stringify(definition));
    args.push("--file", "-");
    if (keepEnv) args.push("--keep-env");
  }
  const add = (flag, value, absolute = false) => {
    if (typeof value !== "string" || !value || value.startsWith("-") || value.includes("\0") || (absolute && !value.startsWith("/"))) throw serverError("E_BAD_ARGS", `invalid ${flag}`);
    args.push(flag, value);
  };
  // Validate explicit selectors before even probing the host.
  if (context !== undefined) add("--dir", context, true);
  if (soul !== undefined) add("--soul", soul);
  if (agentsRoot !== undefined) add("--agents-root", agentsRoot, true);
  if (action === "preview") args.push(...remoteLaunchArgs(options));
  const route = homeSelected ? resolveRoute(serverId, { instance, home }, "launch-config", { ...io, input: undefined }) : undefined;
  const target = route?.target || targetOf(io.server || getServer(serverId));
  if (route) add("--home", route.home, true);
  else if (context === undefined) args.push("--dir", target.workspace);
  // stdin belongs only to the set operation, never its preceding version probe.
  const remote = checkRemote(target, { ...io, input: undefined });
  requireRemoteFeature(remote, target, "launch-config");
  // The host's vocabulary: its harness flag, and the definition's key (read either here).
  if (input !== undefined) input = Buffer.from(JSON.stringify(hostLaunchDefinition(remote, definition)));
  const { envelope, stderr } = runRemote(target, [...hostHarnessArgs(remote, args), "--json"], { ...io, input });
  return { envelope, stderr, target, ...(route ? { route } : {}) };
}

/** The definition keys of a captured (versioned) schedule, removed in 0.26 (as lib/schedule.mjs refuses them). */
const CAPTURED_SCHEDULE_KEYS = ["definitionVersion", "recurrencePolicy", "execution", "preparation"];
/** `oats schedule ...` on the execution host: schedules are host-owned, so
 *  every subcommand runs in the server's registered workspace; refused
 *  before any remote mutation when the remote kernel does not advertise
 *  the schedule feature. The envelope is relayed as is. */
export function scheduleRemote(serverId, oatsArgs, io = {}) {
  io = { ...io, serverId };
  const server = io.server || getServer(serverId);
  const target = targetOf(server);
  const remote = checkRemote(target, io);
  if (!remote.features.includes("schedule")) throw serverError("E_REMOTE_INCOMPATIBLE", `remote oats ${remote.version} at ${target.sshHost} does not advertise schedules; upgrade it there`);
  if (["add", "update"].includes(oatsArgs[0])) {
    const indexes = oatsArgs.flatMap((arg, index) => arg === "--spec-json" ? [index] : []);
    if (indexes.length > 1) throw serverError("E_BAD_ARGS", "remote schedule spec must be unambiguous");
    if (indexes.length) {
      const spec = parseStrictJson(oatsArgs[indexes[0] + 1]);
      if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw serverError("E_BAD_ARGS", "remote schedule spec must be an object");
      // Captured (versioned) schedules were removed in 0.26: refused here, as a local add
      // refuses them, never forwarded to a remote kernel that might still accept one.
      const captured = CAPTURED_SCHEDULE_KEYS.filter((key) => Object.hasOwn(spec, key));
      if (captured.length) throw serverError("E_SCHEDULE_INVALID", `${captured.join(", ")}: captured schedules are refused (the captured/portable path was removed in 0.26); no request was forwarded`);
      // The host's vocabulary for the spawn job's harness (read either here).
      if (Object.hasOwn(spec, "harness") || Object.hasOwn(spec, "runtime")) {
        const { harness, runtime, ...rest } = spec;
        if (harness !== undefined && runtime !== undefined && harness !== runtime) throw serverError("E_SCHEDULE_INVALID", "the schedule names harness and runtime (its pre-0.27 name) with different values; no request was forwarded");
        const value = harness ?? runtime;
        if (runtime !== undefined) noteRuntimeName("runtime in the schedule spec (sent as the host's harness key)");
        oatsArgs = oatsArgs.map((a, i) => (i === indexes[0] + 1 ? JSON.stringify((remote.features || []).includes("harness") ? { ...rest, harness: value } : { ...rest, runtime: value }) : a));
      }
    }
  }
  const args = ["schedule", ...oatsArgs.filter((a) => a !== "--json"), "--dir", target.workspace, "--json"];
  const { envelope, stderr } = runRemote(target, args, io);
  return { envelope: envelope.ok ? { ...envelope, result: { ...envelope.result, server: serverId } } : envelope, stderr, target };
}

export function attachArgv(serverId, { instance, home } = {}, io = {}) {
  io = { ...io, serverId };
  const { target, home: remoteHome } = resolveRoute(serverId, { instance, home }, "session attach", io);
  if (!io.skipVersionCheck) requireSessionRemote(target, io, remoteHome);
  const [bin, ...rest] = sshArgv(target, ["session", "attach", "--home", remoteHome], { control: controlUsable(target, io) });
  // -t: allocate a PTY; placed before `--` with the other ssh options.
  return { argv: [bin, "-t", ...rest], target, home: remoteHome };
}

// ------------------------------------------------------------------ connect

/** `oats server connect` (docs/servers.md): this workspace's deployment on a host, registered, in
 *  one idempotent run of six steps, each re-checking its state before doing anything:
 *  ssh → oats → git → deployment → register → readiness. A step answers ok (already so), done
 *  (this run did it), needs-human (with the exact remedy: later steps are skipped, waiting for
 *  it) or failed (the run ends: the error carries the steps so far). Nothing here touches
 *  credentials: what git on the host cannot read is a human step. */
export const CONNECT_STEPS = ["ssh", "oats", "git", "deployment", "register", "readiness"];
/** The readiness step's whole allowance (all souls, one control connection). */
export const CONNECT_READINESS_BUDGET_MS = 60000;
const INSTALL_TIMEOUT_MS = 600000;

/** One host command that is not the oats CLI (`true`, `npm`): its exit status and output, never an
 *  envelope. The registration's --path applies as for oats; stdin is closed. */
function runHostCommand(target, argv, io = {}) {
  const exec = io.execFileSync || execFileSync;
  const [bin, ...rest] = sshArgv({ ...target, oatsPath: argv[0] }, argv.slice(1), { control: controlUsable(target, io) });
  try {
    return { status: 0, stdout: String(exec(bin, rest, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024, timeout: io.timeoutMs || 300000 }) ?? ""), stderr: "" };
  } catch (e) {
    return { status: typeof e.status === "number" ? e.status : 255, stdout: String(e.stdout || ""), stderr: String(e.stderr ?? e.message ?? "") };
  }
}
const tail = (text) => String(text || "").trim().slice(-400) || "(no output)";
const sshFailed = (target, r) => serverError("E_SSH", `ssh to ${target.sshHost} failed: ${tail(r.stderr)}`);

/** The oats a host answers at the target's binary: `{ version }`, or `{ missing: true }` when its
 *  shell finds nothing there to run (exit 126/127). */
function probeHostOats(target, io) {
  const r = runHostCommand(target, [target.oatsPath, "version", "--json"], { ...io, timeoutMs: 60000 });
  if (r.status === 255) throw sshFailed(target, r);
  if (r.status === 126 || r.status === 127) return { missing: true };
  const probe = parseRemoteEnvelope(r.stdout).result || {};
  if (probe.desktopApi !== 1 || typeof probe.version !== "string") throw serverError("E_REMOTE_INCOMPATIBLE", `${target.oatsPath} at ${target.sshHost} answered an unknown version payload: ${JSON.stringify(probe).slice(0, 200)}`);
  return { version: probe.version };
}

/** A host's failure envelope as a thrown error with its own code, message and details. */
function relayedFailure(envelope, what) {
  const e = serverError(envelope.error?.code || "E_REMOTE", envelope.error?.message || `${what} failed on the host`);
  if (envelope.error?.details) e.details = envelope.error.details;
  return e;
}

/**
 * options: { id, sshHost, workspaceRef, dir (absolute, or ~/… resolved by the host), oatsPath?, path?,
 *            label?, installOats?, replace?, localVersion (this kernel's: the version installed) }
 * io: { execFileSync, now, readinessBudgetMs } (the transport and clock; tests inject them).
 * → { id, ready, registration, steps, human }; a failed step throws its code with
 *   details { ...the step's details, steps }.
 */
export function connectServer(options, io = {}) {
  const { id, sshHost, workspaceRef, dir, oatsPath, path, label, installOats = false, replace = false, localVersion } = options;
  const now = io.now || Date.now;
  validateServer(id, { sshHost, workspace: "/", ...(oatsPath ? { oatsPath } : {}), ...(path ? { path } : {}), ...(label ? { label } : {}) });
  if (typeof dir !== "string" || !(dir === "~" || dir.startsWith("~/") || dir.startsWith("/"))) throw serverError("E_BAD_ARGS", `--dir must be an absolute path or ~/… on the host (got ${JSON.stringify(dir)})`);
  io = { ...io, serverId: id, input: undefined };
  const target = { sshHost, workspace: dir, oatsPath: oatsPath || "oats", ...(path ? { path } : {}) };
  const steps = [], human = [];
  let blockedBy = null, check = null, reportedKey = null, registration = null, registeredAs = id;

  const run = (name, fn) => {
    if (blockedBy) { steps.push({ step: name, status: "skipped", detail: `waits for ${blockedBy}` }); return; }
    let out;
    try { out = fn(); }
    catch (e) { out = { status: "failed", code: e.code || "E_CONNECT", detail: e.message, ...(e.details ? { details: e.details } : {}) }; }
    const { lines, ...step } = { step: name, ...out };
    steps.push(step);
    if (step.status === "needs-human") { human.push(...(lines || [step.remedy])); blockedBy = name; }
    if (step.status === "failed") throw Object.assign(serverError(step.code, step.detail), { details: { ...(step.details || {}), steps } });
  };

  run("ssh", () => {
    const r = runHostCommand(target, ["true"], { ...io, timeoutMs: 60000 });
    if (r.status !== 0) throw sshFailed(target, r);
    return { status: "ok" };
  });

  run("oats", () => {
    const found = probeHostOats(target, io);
    if (found.version && compareSemver(found.version, localVersion) >= 0) return { status: "ok", detail: `oats ${found.version}${found.version === localVersion ? "" : ` (this kernel ${localVersion})`}` };
    const npm = runHostCommand(target, ["npm", "--version"], { ...io, timeoutMs: 60000 });
    if (npm.status === 255) throw sshFailed(target, npm);
    const what = found.version ? `oats ${found.version} at ${target.oatsPath} is older than this kernel (${localVersion})` : `no oats at ${target.oatsPath} on ${sshHost}`;
    if (npm.status !== 0) return { status: "needs-human", detail: `${what}, and no npm on its PATH`, remedy: `install Node.js 22+ (npm) on ${sshHost}, or pass --path <the directory holding npm>` };
    const install = ["npm", "install", "-g", `@awebai/oats@${localVersion}`];
    if (!installOats) return { status: "needs-human", detail: what, remedy: `on ${sshHost}: \`${install.join(" ")}\` (or pass --install-oats)` };
    const r = runHostCommand(target, install, { ...io, timeoutMs: INSTALL_TIMEOUT_MS });
    if (r.status === 255) throw sshFailed(target, r);
    if (r.status !== 0) throw serverError("E_REMOTE_INSTALL", `${install.join(" ")} failed on ${sshHost} (exit ${r.status}): ${tail(r.stderr || r.stdout)}`);
    const after = probeHostOats(target, io);
    if (!after.version || compareSemver(after.version, localVersion) < 0) {
      throw serverError("E_REMOTE_INSTALL", `npm installed @awebai/oats@${localVersion} on ${sshHost}, but ${target.oatsPath} there ${after.version ? `still answers ${after.version}` : "is still not found"}; pass --oats <the installed oats> or --path <npm's global bin directory>`);
    }
    return { status: "done", detail: `installed @awebai/oats ${localVersion} (${found.version ? `was ${found.version}` : "was missing"})` };
  });

  // The host's own answer about the directory and the workspace remote (onboard --check, read-only).
  run("git", () => {
    const { envelope } = runRemote(target, ["onboard", dir, "--workspace", workspaceRef, "--check", "--json"], io);
    if (!envelope.ok) throw relayedFailure(envelope, "onboard --check");
    check = envelope.result;
    if (check.remote.readable) return { status: "ok", detail: `${check.workspace.key} readable at ${String(check.remote.commit).slice(0, 12)}` };
    const err = check.remote.error || {};
    // Every runnable command in backticks (the Desktop's copy buttons find them).
    const remedy = err.remedy || `make ${check.workspace.ref} readable by git there (check the reference; give git there credentials or an SSH key for it), then confirm with \`git ls-remote ${check.workspace.url}\``;
    return { status: "needs-human", code: err.code || "E_REMOTE_UNREADABLE", detail: err.message, remedy: `on ${sshHost}: ${remedy}`, ...(err.hint ? { hint: err.hint } : {}) };
  });

  run("deployment", () => {
    const abs = check.dir, want = check.workspace.key;
    const keyAt = () => reportedWorkspaceKey({ ...target, workspace: abs }, io).key;
    if (check.state === "deployment") {
      const key = keyAt();
      if (key !== want) throw Object.assign(serverError("E_SERVER_WORKSPACE_MISMATCH", `${abs} on ${sshHost} is a deployment of ${key ?? "a workspace it does not report"}, not of ${want}; nothing was changed (choose another --dir)`), { details: { expected: want, reported: key ?? null, dir: abs } });
      reportedKey = key;
      return { status: "ok", detail: `${abs} realizes ${key}` };
    }
    if (check.state === "not-empty" || check.state === "not-a-directory") {
      throw Object.assign(serverError("E_DIR_NOT_EMPTY", `${abs} on ${sshHost} ${check.state === "not-empty" ? "is not empty and holds no oats-local.yaml" : "exists and is not a directory"}; nothing was written there (choose another --dir)`), { details: { dir: abs, state: check.state } });
    }
    // The only place onboard runs on a host.
    const { envelope } = runRemote(target, ["onboard", abs, "--workspace", workspaceRef, "--json"], { ...io, timeoutMs: INSTALL_TIMEOUT_MS });
    if (!envelope.ok) throw relayedFailure(envelope, "onboard");
    reportedKey = keyAt();
    if (reportedKey !== want) throw Object.assign(serverError("E_SERVER_WORKSPACE_MISMATCH", `onboarded ${abs} on ${sshHost}, but it reports ${reportedKey ?? "no workspace key"}, not ${want}`), { details: { expected: want, reported: reportedKey ?? null, dir: abs } });
    return { status: "done", detail: `onboarded ${abs} into ${reportedKey}` };
  });

  // One guarded update of the registry as it is now. The requested id comes first: an id registered for
  // another target is refused (or replaced), never quietly answered by a twin that serves this target.
  run("register", () => updateServers((servers) => {
    const abs = check.dir;
    const entry = { sshHost, workspace: abs, ...(oatsPath ? { oatsPath } : {}), ...(path ? { path } : {}), ...(label ? { label } : {}), workspaceKey: reportedKey };
    const sameTarget = (s) => s.sshHost === sshHost && s.workspace === abs;
    /** A registration of this very target: its key confirmed, or recorded; never contradicted. */
    const keep = (regId, detail) => {
      const existing = servers[regId];
      if (existing.workspaceKey && existing.workspaceKey !== reportedKey) throw workspaceMismatch(regId, existing, reportedKey);
      registeredAs = regId;
      registration = existing;
      if (existing.workspaceKey) return { status: "ok", ...(detail ? { detail } : {}) };
      existing.workspaceKey = reportedKey;
      return { status: "done", detail: [detail, `recorded workspace ${reportedKey}`].filter(Boolean).join("; ") };
    };
    const mine = servers[id];
    if (mine && sameTarget(mine)) {
      const differ = ["oatsPath", "path", "label"].filter((k) => entry[k] !== undefined && entry[k] !== mine[k]);
      if (!differ.length || !replace) return keep(id, differ.length ? `${differ.join(", ")} differ from the registration and were not changed (--replace rewrites it)` : undefined);
      if (mine.workspaceKey && mine.workspaceKey !== reportedKey) throw workspaceMismatch(id, mine, reportedKey);
      servers[id] = entry; registration = entry;
      return { status: "done", detail: `updated ${differ.join(", ")}` };
    }
    if (mine && !replace) throw Object.assign(serverError("E_SERVER_EXISTS", `server ${id} is already registered for ${mine.sshHost}:${mine.workspace} (pass --replace to point it at ${sshHost}:${abs}; instances spawned through it keep their saved routes)`), { details: { registered: { sshHost: mine.sshHost, workspace: mine.workspace } } });
    const twin = Object.keys(servers).find((other) => other !== id && sameTarget(servers[other]));
    if (twin && !mine) return keep(twin, `${sshHost}:${abs} is already registered as ${twin}; not registered again`);
    validateServer(id, entry);
    servers[id] = entry; registration = entry;
    return { status: "done", detail: [mine ? `replaced ${mine.sshHost}:${mine.workspace}` : `registered ${id}`, twin ? `${sshHost}:${abs} is also registered as ${twin}` : null].filter(Boolean).join("; ") };
  }));

  // Every soul the host deployment lists (disabled ones skipped), one routed readiness each, within one
  // budget; each failing or unknown required item is a human line, said once for the souls sharing it.
  run("readiness", () => {
    const regTarget = targetOf(registration);
    const budget = io.readinessBudgetMs || CONNECT_READINESS_BUDGET_MS;
    const started = now();
    const left = () => budget - (now() - started);
    const later = `run \`oats readiness --soul <s> --server ${registeredAs}\``;
    // The budget's deadline cut the call short: a fact about time, not a failure. A broken link fails.
    const withinBudget = (args) => {
      try { return runRemote(regTarget, args, { ...io, timeoutMs: Math.max(1000, left()) }).envelope; }
      catch (e) { if (e.timedOut) return null; throw e; }
    };
    const listed = withinBudget(["souls", "--json", "--dir", regTarget.workspace]);
    if (!listed) return { status: "needs-human", detail: "readiness not checked", remedy: `readiness not checked: the host did not list its souls within ${Math.round(budget / 1000)} s; ${later} for each soul` };
    if (!listed.ok) return { status: "needs-human", detail: "the host could not list its souls", remedy: `on ${sshHost}: \`oats souls --dir ${regTarget.workspace}\` fails: ${listed.error?.message || listed.error?.code}` };
    const souls = (listed.result?.souls || []).filter((s) => s.problem?.code !== "E_SOUL_DISABLED").map((s) => s.qualifiedName || s.name);
    const problems = new Map(), unchecked = [];
    const add = (text, soul) => { if (!problems.has(text)) problems.set(text, []); if (!problems.get(text).includes(soul)) problems.get(text).push(soul); };
    for (const soul of souls) {
      if (unchecked.length || left() < 1000) { unchecked.push(soul); continue; }
      const envelope = withinBudget(["readiness", "--soul", soul, "--dir", regTarget.workspace, "--json"]);
      if (!envelope) { unchecked.push(soul); continue; }
      if (!envelope.ok) { add(`readiness failed: ${envelope.error?.message || envelope.error?.code}`, soul); continue; }
      for (const check of Object.values(envelope.result?.checks || {})) {
        for (const item of check.items || []) {
          if (item.required && (item.status === "fail" || item.status === "unknown")) add(`${item.subject}: ${item.reason ?? item.status}${item.remedy ? ` → ${item.remedy}` : ""}`, soul);
        }
      }
    }
    const lines = [...problems].map(([text, by]) => `${by.join(", ")}: ${text}`);
    if (unchecked.length) lines.push(`readiness not checked for ${unchecked.length} soul${unchecked.length === 1 ? "" : "s"}: ${later} for ${unchecked.join(", ")}`);
    if (!lines.length) return { status: "ok", detail: souls.length ? `${souls.length} soul${souls.length === 1 ? "" : "s"} ready` : "no souls listed" };
    return { status: "needs-human", detail: `${lines.length} readiness problem${lines.length === 1 ? "" : "s"}`, remedy: lines.join("\n"), lines };
  });

  // `registeredAs`: the id that serves the target (another id's registration when it was already there).
  return { id, ready: !steps.some((s) => s.status === "needs-human" || s.status === "failed"), registration, steps, human, registeredAs };
}

// ------------------------------------------------------- capability routing

/** The routing flag of a capability command: the first `--server <id>` or `--server=<id>` before any
 *  `--` (after it, the argv is the provider's), taken out → `{ id, argv }`, or null when there is none.
 *  `id` is true when the flag has no value. */
export function serverFlagOf(argv) {
  const end = argv.indexOf("--");
  const head = end < 0 ? argv.length : end;
  for (let i = 0; i < head; i++) {
    if (argv[i] === "--server") {
      const value = i + 1 < head && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
      return { id: value, argv: [...argv.slice(0, i), ...argv.slice(i + (value === true ? 1 : 2))] };
    }
    if (argv[i].startsWith("--server=")) return { id: argv[i].slice("--server=".length) || true, argv: [...argv.slice(0, i), ...argv.slice(i + 1)] };
  }
  return null;
}

/** An argv safe to print: every `--invite <v>` / `--invite=<v>` value replaced. */
export function redactArgv(argv) {
  return argv.map((a, i) => (argv[i - 1] === "--invite" ? "<redacted>" : a.startsWith("--invite=") ? "--invite=<redacted>" : a));
}

/** `oats <namespace> <command> … --server <id>` on the host: the same argv (the routing flag already
 *  taken out) run in the registration's workspace, where the host's capability dispatch finds its
 *  deployment. Stdin goes to the host as it is, never read here, unless it is a terminal: then nothing
 *  is forwarded and the host's stdin is closed. stdout is relayed by the caller under --json (held, to
 *  relay the host's envelope verbatim) and inherited otherwise; stderr is always inherited.
 *  → { status, stdout } (stdout only under json). */
export function routeCapability(serverId, argv, { server, spawnSync: spawn = spawnSync, stdinIsTTY = process.stdin.isTTY, json = false } = {}) {
  const target = targetOf(server);
  const [bin, ...rest] = sshArgv(target, argv, { cwd: target.workspace, control: controlUsable(target, { serverId }) });
  const r = spawn(bin, rest, { stdio: [stdinIsTTY ? "ignore" : "inherit", json ? "pipe" : "inherit", "inherit"], maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw serverError("E_SSH", `cannot run ssh to ${target.sshHost} for \`oats ${redactArgv(argv).join(" ")}\` on server ${serverId}: ${r.error.message}`);
  return { status: typeof r.status === "number" ? r.status : 255, ...(json ? { stdout: r.stdout } : {}) };
}
