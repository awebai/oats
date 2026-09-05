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
import { createHash } from "node:crypto";
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
/** A stable key for a route target: two registrations may name the same
 *  host and workspace, and a registration may change; groups and guards key
 *  on the target, never on the registry id alone. */
export function targetKey(target) {
  // Host and workspace only: the binary path (like --path and --label) is how
  // to reach the same homes, not which homes; each snapshot keeps its own.
  return createHash("sha256").update(`${target.sshHost}\0${target.workspace}`).digest("hex").slice(0, 12);
}

export function sshArgv(target, oatsArgs, { cwd } = {}) {
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
  const cmd = (cwd ? `cd ${remoteQuote(cwd)} && ` : "") + prefix + [target.oatsPath, ...oatsArgs].map(remoteQuote).join(" ");
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
  const [bin, ...argv] = sshArgv(target, oatsArgs, { cwd: io.cwd });
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
  // What the remote kernel advertises it can launch. A probe without these
  // fields is a 0.22.1-class kernel: pi and claude only, no session backend
  // choice, no launch options; nothing newer may be requested of it.
  const list = (k, fallback) => (Array.isArray(probe[k]) ? probe[k].map(String) : fallback);
  return {
    version: probe.version, schemaVersion: 1, desktopApi: 1,
    runtimes: list("runtimes", ["pi", "claude"]),
    sessionBackends: list("sessionBackends", []),
    launchOptions: list("launchOptions", []),
    remote: list("remote", []),
    features: list("features", []),
    advertised: Array.isArray(probe.runtimes),
  };
}

/** Refuse, before any mutation, a spawn that asks the remote kernel for a
 *  runtime, session backend or launch option it does not advertise. The
 *  effective runtime is the --runtime flag or the soul's default from the
 *  remote roster, resolved THERE, since the local roster says nothing about
 *  that host's souls. Desktop's local support check cannot prove remote
 *  support; this is the proof. */
export function checkRemoteSupport(remote, target, oatsArgs, roster) {
  const flagOf = (name) => { const i = oatsArgs.indexOf(name); return i >= 0 && oatsArgs[i + 1] && !oatsArgs[i + 1].startsWith("--") ? oatsArgs[i + 1] : undefined; };
  const agent = oatsArgs.find((a) => !a.startsWith("--"));
  const soul = (roster?.agents || []).find((a) => a.name === agent);
  // The effective runtime is the flag, else the soul's default as the remote
  // roster reports it. A soul the roster does not list with a runtime (a
  // capability-defined agent, or one with no live instance) has no default
  // this side can establish: the remote kernel validates its own default at
  // spawn, and nothing is asserted here about it.
  const runtime = flagOf("--runtime") || soul?.runtime;
  // What the message may claim depends on what was established: an
  // advertising remote said what it supports; a silent one (before 0.22.2)
  // said nothing, and only pi and claude are assumed of it.
  const supports = remote.advertised
    ? `it advertises runtimes ${remote.runtimes.join(", ")}${remote.sessionBackends.length ? `, session backends ${remote.sessionBackends.join(", ")}` : ", no session backend choice"}${remote.launchOptions.length ? `, launch options ${remote.launchOptions.join(", ")}` : ", no launch options"}`
    : `it does not advertise what it supports (kernels before 0.22.2 do not), so only pi and claude on tmux with no launch options are assumed of it; upgrade it there to use more`;
  const refuse = (what) => { throw serverError("E_REMOTE_INCOMPATIBLE", `remote oats ${remote.version} at ${target.sshHost}: ${what} was not established as supported there (${supports})`); };
  if (runtime && !remote.runtimes.includes(runtime)) refuse(`runtime ${runtime}${flagOf("--runtime") ? "" : ` (the default of soul ${agent} there)`}`);
  const backend = flagOf("--backend");
  if (backend && !remote.sessionBackends.includes(backend)) refuse(`session backend ${backend}`);
  if (oatsArgs.includes("--yolo") && !remote.launchOptions.includes("yolo")) refuse("the yolo launch option");
  return { runtime, backend, yolo: oatsArgs.includes("--yolo") };
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
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    throw serverError("E_SNAPSHOT_UNREADABLE", `${p}: ${e.message}`);
  }
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
    // The remote roster: the soul's runtime default for the support check,
    // and the remote agents root for the snapshot (the kernel's spawn result
    // does not carry it, and guessing it from the workspace would be wrong
    // for local souls).
    const status = runRemote(target, json(withScope(["status"])), io).envelope;
    if (!status.ok) return { envelope: status, stderr: "" };
    checkRemoteSupport(remote, target, oatsArgs, status.result);
    const { envelope, stderr } = runRemote(target, json(withScope(["spawn", ...oatsArgs])), io);
    if (envelope.ok && envelope.result?.instance) {
      // A generated name can still collide with a saved route of another
      // soul on the same host (dev --purpose foo-1 vs dev-foo --purpose 1).
      // The existing route is never overwritten: the new instance is
      // reported without a saved route, to be retired on the host by --home.
      const prior = readSnapshot(serverId, envelope.result.instance);
      if (prior && prior.home && envelope.result.home && resolve(prior.home) !== resolve(envelope.result.home)) {
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
    const remoteRetiresByHome = Array.isArray(remote?.features) && remote.features.includes("retire-home");
    const wantHome = explicitHome || snap?.home;
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
  throw serverError("E_USAGE", `--server routes spawn, retire, status, session and okf harvest only (not ${cmd})`);
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
    if (!groups.has(key)) groups.set(key, { id: key, server: serverId, label: label || serverId, registrationPresent, target, probe: null, agentsRoot: undefined, souls: [], instances: [], retireFailures: [], _snapshots: [] });
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
      try { status = runRemote(g.target, ["status", "--json", "--dir", g.target.workspace], { ...io, timeoutMs: Math.min(perTargetTimeoutMs, remaining) }).envelope; }
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
      for (const a of status.result.agents || []) {
        g.souls.push({ name: a.name, runtime: a.runtime, work: a.work, backend: a.backend, description: a.description, agentsRoot: status.result.root });
        // A failed deferred self-retirement needs an operator: it rides with
        // the group, named by agent and instance, as `oats status` prints it.
        for (const f of a.retireFailures || []) g.retireFailures.push({ agent: a.name, ...f });
        for (const i of a.instances || []) {
          const snap = routeOf(i);
          g.instances.push({
            server: g.server, instance: i.instance, agent: a.name, home: i.home || snap?.home, agentsRoot: status.result.root,
            runtime: i.runtime || null, backend: i.sessionTarget?.backend || (i.tmux ? "tmux" : null),
            ...(i.sessionTarget ? { sessionTarget: i.sessionTarget } : {}), ...(i.tmux ? { tmux: i.tmux } : {}),
            running: typeof i.running === "boolean" ? i.running : null, ...(i.runtimeError ? { runtimeError: i.runtimeError } : {}),
            retirePending: !!i.retirePending, rollbackIncomplete: !!i.rollbackIncomplete, savedRoute: !!snap, missingRemotely: false,
          });
          if (snap) bySnapshot.delete(i.instance);
        }
      }
    }
    // Saved routes the remote did not list: with a good probe that means the
    // instance is gone there (retired, or its home removed) and the route is
    // stale; with a failed probe nothing is known. Same keys as remote rows.
    for (const snap of bySnapshot.values()) {
      g.instances.push({ server: g.server, instance: snap.instance, agent: snap.agent, home: snap.home, agentsRoot: snap.agentsRoot, runtime: snap.runtime || null, backend: null, running: null, retirePending: false, rollbackIncomplete: false, savedRoute: true, missingRemotely: g.probe?.ok === true });
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
export function resolveRoute(serverId, { instance, home } = {}, what = "session") {
  const snap = instance ? readSnapshot(serverId, instance) : undefined;
  if (instance && !snap) throw serverError("E_SNAPSHOT_UNKNOWN", `no remote instance ${JSON.stringify(instance)} spawned through server ${serverId} from this machine (oats status --server ${serverId})`);
  const target = snap?.target || targetOf(getServer(serverId));
  const remoteHome = home || snap?.home;
  if (!remoteHome || !String(remoteHome).startsWith("/")) throw serverError("E_BAD_ARGS", `${what} --server needs --instance <name> (spawned from here) or --home </absolute/remote/home>`);
  return { target, home: remoteHome, snapshot: snap };
}

/** `session inspect` on the execution host for a remote instance: the same
 *  route resolution as attach, the standard envelope relayed as is (ok or
 *  not), never an ACK of anything. */
/** A version is a proxy; the probe's `remote` list states the capability
 *  directly: a kernel that routes session itself also serves it. A silent
 *  probe (before 0.22.2) or one without session in the list is refused
 *  before any session command is sent. */
function requireSessionRemote(target, io) {
  const remote = checkRemote(target, io);
  if (!remote.remote.includes("session")) {
    throw serverError("E_REMOTE_INCOMPATIBLE", `remote oats ${remote.version} at ${target.sshHost} does not advertise the \`oats session\` commands (kernels from ${SESSION_REMOTE_VERSION} do); upgrade it there, or attach with ssh -t ${target.sshHost} tmux attach -t oats`);
  }
  return remote;
}

export function inspectRemote(serverId, { instance, home } = {}, io = {}) {
  const route = resolveRoute(serverId, { instance, home }, "session inspect");
  requireSessionRemote(route.target, io);
  const { envelope, stderr } = runRemote(route.target, ["session", "inspect", "--home", route.home, "--json"], io);
  return { envelope: envelope.ok ? { ...envelope, result: { ...envelope.result, server: serverId, instance: instance || route.snapshot?.instance, home: route.home } } : envelope, stderr, route };
}

export function attachArgv(serverId, { instance, home } = {}, io = {}) {
  const { target, home: remoteHome } = resolveRoute(serverId, { instance, home }, "session attach");
  if (!io.skipVersionCheck) requireSessionRemote(target, io);
  const [bin, ...rest] = sshArgv(target, ["session", "attach", "--home", remoteHome]);
  // -t: allocate a PTY; placed before `--` with the other ssh options.
  return { argv: [bin, "-t", ...rest], target, home: remoteHome };
}
