// The per-user service that keeps a GLOBAL resident's custody running: a
// launchd agent on macOS, a systemd --user unit on Linux. aw has no install
// verb (`aw custody serve` takes no flags and serves the identity home of its
// working directory), so OATS writes the unit. It runs `aw custody serve` in
// the resident's directory with PATH and HOME only: no key, no identity
// selector. Elsewhere there is no unit, and the operator starts custody by hand.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { custodyPreflight } from "./grant-custody.mjs";

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

/** Whether two paths name the same directory, through symlinks too. */
export function samePath(a, b) {
  if (resolve(a) === resolve(b)) return true;
  try { return realpathSync(a) === realpathSync(b); } catch { return false; }
}

/** The unit's PATH: aw's directory (and its target's, for a linked aw), the
 *  directory of the node an npm-installed aw needs, and the system's. It
 *  depends on where aw is, not on the PATH of the shell that ran the command,
 *  so a rerun from another shell finds the unit unchanged. */
export function unitSearchPath(aw) {
  let target = aw;
  try { target = realpathSync(aw); } catch { /* aw itself is the target */ }
  const dirs = [dirname(aw), dirname(target), dirname(process.execPath), "/usr/local/bin", "/usr/bin", "/bin"];
  return dirs.filter((d, i) => dirs.indexOf(d) === i).join(":");
}

/** ai.aweb.custody.<namespace of the address>.<name> */
export function custodyLabel(address, name) {
  const [namespace, alias, ...rest] = String(address || "").split("/");
  if (!namespace || alias === undefined || rest.length) fail("E_RESIDENT_VERIFY", `address ${address} has no namespace`);
  if (alias !== name) fail("E_RESIDENT_VERIFY", `address ${address} does not end in /${name}`);
  return `ai.aweb.custody.${namespace}.${name}`;
}

export function unitManager(platform) {
  return platform === "darwin" ? "launchd" : platform === "linux" ? "systemd" : null;
}
const unitDir = ({ platform, home, xdgConfigHome }) => platform === "darwin"
  ? join(home, "Library", "LaunchAgents")
  : join(xdgConfigHome || join(home, ".config"), "systemd", "user");
export function unitPath(where, label) {
  return join(unitDir(where), `${label}${where.platform === "darwin" ? ".plist" : ".service"}`);
}

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const unXml = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
/** systemd expands % specifiers in every setting used here. It also expands
 *  $ variables in ExecStart= (written $$ for a literal $), but not in
 *  Environment= values, where $ has no special meaning (systemd.exec(5)). */
const systemdValue = (s) => String(s).replace(/%/g, "%%");
const systemdQuoted = (s) => `"${systemdValue(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** The unit file's text. `path` and `home` are the only environment it sets. */
export function renderUnit({ platform, label, aw, root, path, home, address }) {
  for (const [what, value] of Object.entries({ label, aw, root, path, home, address })) {
    if (typeof value !== "string" || !value || /[\x00-\x1f\x7f]/.test(value)) fail("E_RESIDENT_UNIT", `the custody unit's ${what} is empty or contains a control character`);
  }
  const log = join(root, ".oats-resident", "custody.log");
  if (platform === "darwin") return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(aw)}</string>
    <string>custody</string>
    <string>serve</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(path)}</string>
    <key>HOME</key>
    <string>${xml(home)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;
  if (platform === "linux") return `[Unit]
Description=aweb custody for resident ${systemdValue(address)}

[Service]
Type=simple
WorkingDirectory=${systemdValue(root)}
Environment=${systemdQuoted(`PATH=${path}`)} ${systemdQuoted(`HOME=${home}`)}
ExecStart=${systemdQuoted(aw).split("$").join("$$")} custody serve
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
  return fail("E_RESIDENT_UNIT_UNSUPPORTED", `no custody unit for platform ${platform}`);
}

/** The directory a unit file serves, or undefined when it names none. */
function servedRoot(platform, text) {
  if (platform === "darwin") {
    const m = /<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/.exec(text);
    return m ? unXml(m[1]) : undefined;
  }
  const m = /^WorkingDirectory=(.*)$/m.exec(text);
  return m ? m[1].trim().replace(/%%/g, "%") : undefined;
}

/** Every custody unit of resident `name` this user has, whatever its namespace. */
export function residentUnits(where, name) {
  const dir = unitDir(where);
  const suffix = where.platform === "darwin" ? ".plist" : ".service";
  let entries;
  try { entries = readdirSync(dir); } catch { return []; }
  return entries
    .filter((f) => f.startsWith("ai.aweb.custody.") && f.endsWith(`.${name}${suffix}`) && f.length > `ai.aweb.custody..${name}${suffix}`.length)
    .map((f) => {
      const path = join(dir, f);
      let root;
      try { root = servedRoot(where.platform, readFileSync(path, "utf8")); } catch { /* unreadable: serves no known directory */ }
      return { label: f.slice(0, -suffix.length), path, root };
    });
}

export function conflictMessage(unit, root) {
  return `custody unit ${unit.path} already serves ${unit.root ?? "an unreadable directory"}, not ${root}; remove that unit or choose another name`;
}

/** A unit manager command's environment: PATH and HOME, and the variables
 *  systemctl --user and loginctl find the user's manager by. Never anything
 *  else, and none of it goes into the unit. */
const MANAGER_ENV = ["PATH", "HOME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"];
function manage(env, cmd, args) {
  const managerEnv = Object.fromEntries(MANAGER_ENV.filter((k) => typeof env[k] === "string").map((k) => [k, env[k]]));
  try {
    return { ok: true, stdout: execFileSync(cmd, args, { env: managerEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }) };
  } catch (e) {
    return { ok: false, missing: e.code === "ENOENT", status: e.status, stderr: String(e.stderr || "").trim() };
  }
}
function managed(env, cmd, args) {
  const r = manage(env, cmd, args);
  if (r.missing) fail("E_RESIDENT_UNIT_UNSUPPORTED", `${cmd} is not available on this host`);
  if (!r.ok) fail("E_RESIDENT_UNIT", `${cmd} ${args.join(" ")} failed${r.status != null ? ` (exit ${r.status})` : ""}${r.stderr ? `: ${r.stderr}` : ""}`);
  return r;
}

/** Why custody would not survive a logout on Linux, or undefined. Without
 *  systemd's lingering, a user's units stop when their last session ends. */
export function lingerProblem({ platform, user, env }) {
  if (platform !== "linux") return undefined;
  const r = manage(env, "loginctl", ["show-user", user, "--property=Linger"]);
  if (r.missing) return undefined; // no systemd: the custody stage names the hand step
  if (r.ok && /^Linger=yes$/m.test(r.stdout)) return undefined;
  return `systemd lingering is off for ${user}, so the custody unit would stop when ${user} logs out: an administrator runs \`loginctl enable-linger ${user}\`, then rerun`;
}

/** Writes the unit when it is missing or differs, and makes sure it is loaded.
 *  A unit of this label that serves another directory is refused. */
export function ensureCustodyUnit({ platform, label, aw, root, home, address, uid, env, xdgConfigHome }) {
  const manager = unitManager(platform);
  if (!manager) fail("E_RESIDENT_UNIT_UNSUPPORTED", `this host (${platform}) has no supported per-user service manager`);
  const path = unitPath({ platform, home, xdgConfigHome }, label);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  let served = root;
  if (existing !== undefined) {
    served = servedRoot(platform, existing);
    if (!served || !samePath(served, root)) fail("E_RESIDENT_UNIT_CONFLICT", conflictMessage({ path, root: served }, root));
  }
  // A unit serving the same directory under another spelling keeps its own.
  const desired = renderUnit({ platform, label, aw, root: served, path: unitSearchPath(aw), home, address });
  const changed = existing !== desired;
  if (changed) {
    mkdirSync(unitDir({ platform, home, xdgConfigHome }), { recursive: true });
    writeFileSync(path, desired, { mode: 0o644 });
  }
  if (manager === "launchd") {
    const target = `gui/${uid}/${label}`;
    const loaded = manage(env, "launchctl", ["print", target]);
    if (loaded.missing) fail("E_RESIDENT_UNIT_UNSUPPORTED", "launchctl is not available on this host");
    if (changed && loaded.ok) managed(env, "launchctl", ["bootout", target]);
    if (changed || !loaded.ok) managed(env, "launchctl", ["bootstrap", `gui/${uid}`, path]);
  } else {
    // Enabled by its path, the user's manager links the file into its own
    // configuration wherever the file is; by name, it looks only there.
    const service = `${label}.service`;
    if (changed) {
      managed(env, "systemctl", ["--user", "daemon-reload"]);
      managed(env, "systemctl", ["--user", "enable", "--now", path]);
      if (existing !== undefined) managed(env, "systemctl", ["--user", "restart", service]);
    } else if (!manage(env, "systemctl", ["--user", "is-active", service]).ok) {
      managed(env, "systemctl", ["--user", "enable", "--now", path]);
    }
  }
  return { manager, label, path, changed };
}

/** The pid of a unit's running process, or undefined when it is not running.
 *  Loaded is not running: a KeepAlive or Restart= unit that keeps exiting is
 *  loaded (launchd "spawn scheduled", systemd activating/auto-restart). */
function runningPid(manager, env, uid, label) {
  if (manager === "launchd") {
    const r = manage(env, "launchctl", ["print", `gui/${uid}/${label}`]);
    // The job's own state and pid are its top-level (one-tab) lines.
    if (!r.ok || !/^\tstate = running$/m.test(r.stdout)) return undefined;
    return Number(/^\tpid = (\d+)$/m.exec(r.stdout)?.[1]) || undefined;
  }
  const r = manage(env, "systemctl", ["--user", "show", "-p", "ActiveState,SubState,MainPID", `${label}.service`]);
  if (!r.ok) return undefined;
  const value = (key) => new RegExp(`^${key}=(.*)$`, "m").exec(r.stdout)?.[1];
  if (value("ActiveState") !== "active" || value("SubState") !== "running") return undefined;
  return Number(value("MainPID")) || undefined;
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/** Whether this command's own unit is what serves R: its file at the
 *  expected path for the label, serving R, and its process the server.
 *  {serves, via} or {serves: false, why}.
 *
 *  aw refuses a second custody server on a socket that answers, before it
 *  listens (aw 1.36.33, cmd/aw/custody.go:235-238), so while another custody
 *  answers, our unit's process cannot be listening. Where lsof exists, the
 *  process must own the custody socket (via "lsof"). Where it does not, the
 *  same pid must still be running `settleMs` later (via "steady-pid"): a
 *  crash-looping aw exits within milliseconds, while launchd and systemd wait
 *  seconds before restarting it. */
export async function ownUnitServes({ platform, label, root, home, xdgConfigHome, uid, env, socketPath, settleMs = 1000 }) {
  const manager = unitManager(platform);
  if (!manager) return { serves: false, why: "no unit of this command on this platform" };
  const path = unitPath({ platform, home, xdgConfigHome }, label);
  let served;
  try { served = servedRoot(platform, readFileSync(path, "utf8")); } catch { return { serves: false, why: "no unit of this command serves it" }; }
  if (!served || !samePath(served, root)) return { serves: false, why: "no unit of this command serves it" };
  const pid = runningPid(manager, env, uid, label);
  if (!pid) return { serves: false, why: "its process is not running" };
  const owners = manage(env, "lsof", ["-t", socketPath]);
  if (!owners.missing) {
    const pids = owners.ok ? owners.stdout.split(/\s+/).filter(Boolean).map(Number) : [];
    if (pids.includes(pid)) return { serves: true, via: "lsof" };
    return { serves: false, why: pids.length ? `another process (${pids.join(", ")}) owns the custody socket` : "no process was found owning the custody socket" };
  }
  await pause(settleMs);
  return runningPid(manager, env, uid, label) === pid ? { serves: true, via: "steady-pid" } : { serves: false, why: "its process did not stay running" };
}

/** What an operator runs where OATS writes no unit. */
export function handStep(root, name) {
  return `start custody yourself: run \`aw custody serve\` in ${root} under a supervisor that keeps it running (working directory ${root}, environment PATH and HOME only), then rerun \`oats aweb resident create ${name}\` to verify`;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
/** Waits until the running custody is ready for grant seats: running, the team
 *  ready, signing and E2EE keys ready, and the floor ops listed; with `owner`,
 *  also served by the process it asks about (`owner(status)` answers a problem,
 *  or nothing when that process is the server). Throws the last answer when it
 *  is not ready in time: E_RESIDENT_CUSTODY_RUNNING when another process
 *  answers, E_RESIDENT_CUSTODY otherwise. */
export async function waitForCustody({ status, resident, team, owner, timeoutMs = 30000, intervalMs = 500 }) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    let last;
    try {
      const ready = custodyPreflight({ custody: "", resident, team, e2eeRequired: true, ttl: "never", fatalOnError: false, runAw: () => status() }).status;
      const problem = owner ? await owner(ready) : undefined;
      if (!problem) return ready;
      last = { code: "E_RESIDENT_CUSTODY_RUNNING", message: problem };
    } catch (e) {
      last = { code: "E_RESIDENT_CUSTODY", message: String(e.message || e) };
    }
    if (Date.now() >= until) fail(last.code, last.message);
    await sleep(intervalMs);
  }
}
