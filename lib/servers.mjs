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

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const OATS_HOME_DIR = () => process.env.OATS_HOME_DIR || join(homedir(), ".oats");
export const SERVERS_FILE = () => join(OATS_HOME_DIR(), "servers.json");
export const REMOTE_SNAPSHOT_DIR = () => join(OATS_HOME_DIR(), "remote");

/** Every ssh invocation is non-interactive: a host that needs a password or a
 *  first-time key confirmation fails fast with ssh's own message, instead of
 *  a lifecycle call hanging on a prompt nobody will answer. */
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15"];

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
  for (const [id, s] of Object.entries(servers)) validateServer(id, s);
  return servers;
}

export function writeServers(servers) {
  const file = SERVERS_FILE();
  mkdirSync(OATS_HOME_DIR(), { recursive: true });
  writeFileSync(file, JSON.stringify({ servers }, null, 2) + "\n", { mode: 0o600 });
}

/** A registration names WHERE and HOW, never WITH WHAT credentials. */
export function validateServer(id, s) {
  if (!ID_RE.test(String(id))) throw serverError("E_SERVER_INVALID", `server id ${JSON.stringify(id)} must be lowercase letters, digits and dashes`);
  if (!s || typeof s !== "object" || Array.isArray(s)) throw serverError("E_SERVER_INVALID", `server ${id}: entry must be an object`);
  if (typeof s.sshHost !== "string" || !SSH_HOST_RE.test(s.sshHost)) throw serverError("E_SERVER_INVALID", `server ${id}: sshHost must be an OpenSSH host alias or host name (no user@, no options)`);
  if (typeof s.workspace !== "string" || !s.workspace.startsWith("/")) throw serverError("E_SERVER_INVALID", `server ${id}: workspace must be an absolute path on the server`);
  for (const k of ["oatsPath", "herdrPath", "label", "path"]) {
    if (s[k] !== undefined && s[k] !== null && typeof s[k] !== "string") throw serverError("E_SERVER_INVALID", `server ${id}: ${k} must be a string`);
  }
  if (s.path !== undefined && s.path !== null && !s.path.split(":").every((d) => d.startsWith("/") || d.startsWith("~/"))) throw serverError("E_SERVER_INVALID", `server ${id}: path must be absolute directories on the server, colon-separated`);
  for (const k of Object.keys(s)) {
    if (!["label", "sshHost", "workspace", "oatsPath", "herdrPath", "path"].includes(k)) throw serverError("E_SERVER_INVALID", `server ${id}: unknown field ${JSON.stringify(k)} (a registration holds label, sshHost, workspace, oatsPath, herdrPath, path and nothing else — never keys or passwords)`);
  }
  return true;
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
    ...(server.herdrPath ? { herdrPath: server.herdrPath } : {}),
    ...(server.path ? { path: server.path } : {}),
  };
}

/** argv for the local ssh process that runs one remote oats command. `--`
 *  ends ssh's own options so a host alias can never be read as one; the
 *  remote command is one quoted string, as ssh requires. */
export function sshArgv(target, oatsArgs) {
  // A non-interactive ssh command runs in the login shell's minimal PATH,
  // which rarely includes user-local tool directories (~/.local/bin, where
  // claude and pi commonly live). A registration may name directories to
  // prepend; `$PATH` stays unquoted so the remote shell expands its own.
  const prefix = target.path ? `PATH=${remoteQuote(target.path.replace(/(^|:)~\//g, "$1$HOME/"))}:"$PATH" ` : "";
  const cmd = prefix + [target.oatsPath, ...oatsArgs].map(remoteQuote).join(" ");
  return ["ssh", ...SSH_OPTS, "--", target.sshHost, cmd];
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
  const [bin, ...argv] = sshArgv(target, oatsArgs);
  let stdout = "";
  let stderr = "";
  let status = 0;
  try {
    stdout = exec(bin, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024, timeout: io.timeoutMs || 300000 });
  } catch (e) {
    stdout = String(e.stdout || "");
    stderr = String(e.stderr || e.message || "");
    status = typeof e.status === "number" ? e.status : 255;
  }
  if (String(stdout).trim()) return { envelope: parseRemoteEnvelope(stdout), stderr, status };
  // ssh exits 255 for its own failures; the remote command's exit code is
  // relayed otherwise. Either way with no envelope there is nothing to trust.
  throw serverError(status === 255 ? "E_SSH" : "E_REMOTE_ENVELOPE", `${status === 255 ? "ssh failed" : `remote oats exited ${status} with no envelope`}: ${stderr.trim().slice(0, 400) || "(no output)"}`);
}

/** Version and envelope compatibility, checked BEFORE any mutation. The
 *  remote must answer `version --json` with the Desktop API v1 probe payload
 *  and a kernel the local side knows how to talk to. */
export function checkRemote(target, io = {}) {
  const { envelope } = runRemote(target, ["version", "--json"], { ...io, timeoutMs: 60000 });
  const probe = envelope.result || {};
  if (probe.desktopApi !== 1 || typeof probe.version !== "string") {
    throw serverError("E_REMOTE_INCOMPATIBLE", `remote oats at ${target.sshHost} answered an unknown version payload: ${JSON.stringify(probe).slice(0, 200)}`);
  }
  const min = io.minVersion || MIN_REMOTE_VERSION;
  if (compareSemver(probe.version, min) < 0) {
    throw serverError("E_REMOTE_INCOMPATIBLE", `remote oats ${probe.version} at ${target.sshHost} is older than the minimum ${min} this kernel routes to; upgrade it there`);
  }
  return { version: probe.version, schemaVersion: 1, desktopApi: 1 };
}

/** The oldest remote kernel whose spawn/retire/status envelopes this router
 *  understands: the release that shipped the deferred retirement fields. */
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
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    throw serverError("E_SNAPSHOT_UNREADABLE", `${p}: ${e.message}`);
  }
}

export function removeSnapshot(serverId, instance) {
  rmSync(snapshotPath(serverId, instance), { force: true });
}

export function listSnapshots(serverId) {
  const dir = join(REMOTE_SNAPSHOT_DIR(), serverId);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, f), "utf8")));
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
  // A retirement may outlive its registration: the snapshot taken at spawn
  // is the route, and it is consulted before the registry is required.
  const instanceArg = oatsArgs.find((a) => !a.startsWith("--"));
  const snap = cmd === "retire" && instanceArg ? readSnapshot(serverId, instanceArg) : undefined;
  let server = io.server;
  if (!server) {
    try { server = getServer(serverId); }
    catch (e) { if (!snap?.target) throw e; }
  }
  let target = snap?.target || targetOf(server);
  const withScope = (args) => (args.includes("--dir") ? args : [...args, "--dir", target.workspace]);
  const json = (args) => (args.includes("--json") ? args : [...args, "--json"]);

  if (cmd === "spawn") {
    const remote = checkRemote(target, io);
    const { envelope, stderr } = runRemote(target, json(withScope(["spawn", ...oatsArgs])), io);
    if (envelope.ok && envelope.result?.instance) {
      const snapshot = writeSnapshot(serverId, target, remote, envelope.result);
      return { envelope: { ...envelope, result: { ...envelope.result, server: serverId, target, snapshot: snapshotPath(serverId, envelope.result.instance) } }, stderr, snapshot };
    }
    return { envelope, stderr };
  }
  if (cmd === "retire") {
    const name = instanceArg;
    const { envelope, stderr } = runRemote(target, json(withScope(["retire", ...oatsArgs])), io);
    if (envelope.ok && name && envelope.result?.removedDir !== false && !envelope.result?.rollbackIncomplete) removeSnapshot(serverId, name);
    return { envelope: envelope.ok ? { ...envelope, result: { ...envelope.result, server: serverId, target } } : envelope, stderr };
  }
  if (cmd === "status") {
    const { envelope, stderr } = runRemote(target, json(withScope(["status", ...oatsArgs])), io);
    return { envelope: envelope.ok ? { ...envelope, result: { ...envelope.result, server: serverId, target, snapshots: listSnapshots(serverId) } } : envelope, stderr };
  }
  throw serverError("E_USAGE", `--server routes spawn, retire and status only (not ${cmd})`);
}
