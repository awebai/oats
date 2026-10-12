/** The ONE host timer that runs `oats schedule tick --host` once a minute:
 *  a launchd user agent on macOS, a systemd user timer on Linux. Nothing is
 *  installed unless `oats schedule host install` is run explicitly, and
 *  status reports what the OS says is loaded, never what a file implies. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform, userInfo } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { hostScheduleDir, scheduleError } from "./schedule.mjs";
import { stableNode as stableNodeRule, unitPathEntries } from "./stable-node.mjs";

export const LAUNCHD_LABEL = "ai.oats.schedule-tick";
export const SYSTEMD_UNIT = "oats-schedule-tick";
const OATS_BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "oats.mjs");
/** The usual prefixes every unit PATH ends with, whether or not this host has them. */
const FALLBACK_PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
const REINSTALL = "run `oats schedule host install` again from the operator's shell (not from an instance home)";

function escapeXml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function unescapeXml(s) { return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"); }

export { unitPathEntries };
function realpathOrNull(p) { try { return realpathSync(p); } catch { return null; } }
/** The node a unit runs: the rule of lib/stable-node.mjs, its warning worded
 *  for the timer. */
export function stableNode(o = {}) {
  return stableNodeRule({ ...o, consequence: "the timer stops when it goes away", remedy: "run `oats schedule host install` again" });
}

/** launchd and systemd start units with a short PATH that has no Homebrew
 *  tmux and no installed harness. The unit therefore carries an explicit
 *  PATH: the dir of the node it runs, the installer's own PATH (the
 *  operator's tool environment) without its hazards (unitPathEntries), and the
 *  usual prefixes. */
export function hostPath({ node = process.execPath, envPath = process.env.PATH || "", instanceHome = process.env.OATS_INSTANCE_HOME } = {}) {
  const seen = new Set();
  const out = [];
  for (const p of [dirname(node), ...unitPathEntries(envPath, { instanceHome }), ...FALLBACK_PATH]) {
    if (p && !seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out.join(":");
}
/** What `install` renders from the installer's environment: the stable node,
 *  the unit PATH, and the warnings the install answer carries. */
export function hostUnitPlan({ execPath = process.execPath, envPath = process.env.PATH || "", instanceHome = process.env.OATS_INSTANCE_HOME } = {}) {
  const { node, warning } = stableNode({ execPath, envPath, instanceHome });
  return { node, path: hostPath({ node, envPath, instanceHome }), warnings: warning ? [warning] : [] };
}

/** An empty StartCalendarInterval dict fires at second 0 of every minute.
 *  ProcessType Standard: a Background job's start is throttled, and under
 *  load its node started long after the fire, past its minute. */
export function renderLaunchdPlist({ node, oatsBin = OATS_BIN, logDir = join(hostScheduleDir(), "log"), oatsHomeDir = process.env.OATS_HOME_DIR, path } = {}) {
  if (node === undefined) node = hostUnitPlan().node;
  if (path === undefined) path = hostPath({ node });
  const env = `\n  <key>EnvironmentVariables</key>\n  <dict>\n    <key>PATH</key><string>${escapeXml(path)}</string>${oatsHomeDir ? `\n    <key>OATS_HOME_DIR</key><string>${escapeXml(oatsHomeDir)}</string>` : ""}\n  </dict>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(node)}</string>
    <string>${escapeXml(oatsBin)}</string>
    <string>schedule</string>
    <string>tick</string>
    <string>--host</string>
    <string>--json</string>
  </array>
  <key>StartCalendarInterval</key><dict/>
  <key>RunAtLoad</key><false/>
  <key>ProcessType</key><string>Standard</string>
  <key>StandardOutPath</key><string>${escapeXml(join(logDir, "tick.log"))}</string>
  <key>StandardErrorPath</key><string>${escapeXml(join(logDir, "tick.err"))}</string>${env}
</dict>
</plist>
`;
}
/** systemd unit values: `%` is a specifier escape (`%%`), and a quoted
 *  string protects spaces; backslashes and double quotes are escaped. */
export function systemdQuote(value) {
  return `"${String(value).replace(/%/g, "%%").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
/** A calendar timer at second 0 of every minute; a minute missed while the
 *  machine was off or asleep is not run at wake (Persistent=false). */
export function renderSystemdUnits({ node, oatsBin = OATS_BIN, oatsHomeDir = process.env.OATS_HOME_DIR, path } = {}) {
  if (node === undefined) node = hostUnitPlan().node;
  if (path === undefined) path = hostPath({ node });
  const env = `Environment=${systemdQuote(`PATH=${path}`)}\n${oatsHomeDir ? `Environment=${systemdQuote(`OATS_HOME_DIR=${oatsHomeDir}`)}\n` : ""}`;
  return {
    service: `[Unit]\nDescription=OATS schedule tick\n\n[Service]\nType=oneshot\n${env}ExecStart=${systemdQuote(node)} ${systemdQuote(oatsBin)} schedule tick --host --json\n`,
    timer: `[Unit]\nDescription=OATS schedule tick\n\n[Timer]\nOnCalendar=*-*-* *:*:00\nAccuracySec=1s\nPersistent=false\nUnit=${SYSTEMD_UNIT}.service\n\n[Install]\nWantedBy=timers.target\n`,
  };
}

function systemdUnquote(quoted) {
  return quoted.slice(1, -1).replace(/\\(.)/g, "$1").replace(/%%/g, "%");
}
const SYSTEMD_QUOTED = String.raw`"(?:[^"\\]|\\.)*"`;
/** The values an installed unit records, read from the file alone (never the
 *  caller's environment); null when the file is not in the shape oats renders. */
function recordedUnit(p) {
  if (p.kind === "launchd") {
    const text = readFileSync(p.plist, "utf8");
    const value = (key) => { const m = new RegExp(`<key>${key}</key><string>([^<]*)</string>`).exec(text); return m ? unescapeXml(m[1]) : undefined; };
    const args = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>\s*<string>([^<]*)<\/string>/.exec(text);
    const out = value("StandardOutPath");
    const legacy = /<key>StartInterval<\/key>/.test(text);
    if (!args || value("PATH") === undefined || out === undefined) return { legacy, unit: null };
    // An absent OATS_HOME_DIR is "" (rendered as none), never the caller's.
    const unit = { node: unescapeXml(args[1]), oatsBin: unescapeXml(args[2]), path: value("PATH"), oatsHomeDir: value("OATS_HOME_DIR") ?? "", logDir: dirname(out) };
    return { legacy, unit, same: renderLaunchdPlist(unit) === text };
  }
  const service = readFileSync(p.service, "utf8"), timer = readFileSync(p.timer, "utf8");
  const legacy = /^(OnBootSec|OnUnitActiveSec)=/m.test(timer);
  const exec = new RegExp(`^ExecStart=(${SYSTEMD_QUOTED}) (${SYSTEMD_QUOTED}) `, "m").exec(service);
  const env = (name) => { const m = new RegExp(`^Environment=("${name}=(?:[^"\\\\]|\\\\.)*")$`, "m").exec(service); return m ? systemdUnquote(m[1]).slice(name.length + 1) : undefined; };
  if (!exec || env("PATH") === undefined) return { legacy, unit: null };
  const unit = { node: systemdUnquote(exec[1]), oatsBin: systemdUnquote(exec[2]), path: env("PATH"), oatsHomeDir: env("OATS_HOME_DIR") ?? "" };
  const rendered = renderSystemdUnits(unit);
  return { legacy, unit, same: rendered.service === service && rendered.timer === timer };
}

/** What would stop or mislead the installed timer, as warnings: a recorded
 *  node or oats that is gone, a PATH entry that is gone (the fallback
 *  prefixes are not checked: not every host has them), and a unit that is
 *  not what this kernel renders from those same recorded values. */
function unitProblems(p) {
  let read;
  try { read = recordedUnit(p); } catch (e) { return [{ code: "unit-outdated", message: `the unit cannot be read: ${e.message}`, fix: REINSTALL }]; }
  const problems = [];
  const { unit } = read;
  if (unit) {
    const nodeMissing = !existsSync(unit.node);
    if (nodeMissing) problems.push({ code: "node-missing", message: `the unit runs node at ${unit.node}, which does not exist`, fix: REINSTALL });
    if (!existsSync(unit.oatsBin)) problems.push({ code: "oats-bin-missing", message: `the unit runs oats at ${unit.oatsBin}, which does not exist`, fix: REINSTALL });
    for (const entry of unit.path.split(":")) {
      // A gone node's own directory is node-missing's cause, not a PATH entry to remove.
      if (nodeMissing && entry === dirname(unit.node)) continue;
      if (entry && !FALLBACK_PATH.includes(entry) && !existsSync(entry)) problems.push({ code: "path-entry-missing", message: `the unit's PATH entry ${entry} does not exist`, fix: `restore ${entry}, or remove it from the operator's PATH and ${REINSTALL}` });
    }
  }
  if (read.legacy) problems.push({ code: "unit-outdated", message: "the unit runs the tick on an interval, not at second 0 of every minute", fix: REINSTALL });
  else if (!unit) problems.push({ code: "unit-outdated", message: "the unit is not in the shape oats renders", fix: REINSTALL });
  else if (!read.same) problems.push({ code: "unit-outdated", message: "the unit differs from what this oats renders for it", fix: REINSTALL });
  return problems;
}

/** `unitDir` overrides the OS location (tests never touch a live timer's files). */
export function hostUnitPaths(os = platform(), { unitDir } = {}) {
  if (os === "darwin") return { kind: "launchd", plist: join(unitDir || join(homedir(), "Library", "LaunchAgents"), `${LAUNCHD_LABEL}.plist`) };
  if (os === "linux") { const dir = unitDir || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "systemd", "user"); return { kind: "systemd", service: join(dir, `${SYSTEMD_UNIT}.service`), timer: join(dir, `${SYSTEMD_UNIT}.timer`) }; }
  return { kind: "unsupported" };
}

function run(exec, argv) {
  try { return { ok: true, out: (exec || execFileSync)(argv[0], argv.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000 }) }; }
  catch (e) { return { ok: false, out: String(e.stdout || ""), err: String(e.stderr || e.message || "").trim() }; }
}

/** installed = the unit file exists; active = the OS reports it loaded/active;
 *  problems = unitProblems, warnings that never change installed or active. */
export function hostUnitStatus({ exec, os = platform(), unitDir } = {}) {
  const p = hostUnitPaths(os, { unitDir });
  if (p.kind === "launchd") {
    const installed = existsSync(p.plist);
    const r = run(exec, ["launchctl", "print", `gui/${userInfo().uid}/${LAUNCHD_LABEL}`]);
    return { kind: p.kind, unit: p.plist, installed, active: r.ok, problems: installed ? unitProblems(p) : [] };
  }
  if (p.kind === "systemd") {
    const installed = existsSync(p.timer) && existsSync(p.service);
    const r = run(exec, ["systemctl", "--user", "is-active", `${SYSTEMD_UNIT}.timer`]);
    return { kind: p.kind, unit: p.timer, installed, active: r.ok && r.out.trim() === "active", problems: installed ? unitProblems(p) : [] };
  }
  return { kind: "unsupported", installed: false, active: false, problems: [] };
}

/** The unit files install writes for `os`, rendered from the installer's
 *  environment (hostUnitPlan): { kind, files: { <path>: <content> }, warnings }.
 *  Renders only: nothing is written and the OS is not asked. */
export function hostUnitFiles({ os = platform(), unitDir, execPath = process.execPath, envPath = process.env.PATH || "", instanceHome = process.env.OATS_INSTANCE_HOME, oatsBin = OATS_BIN } = {}) {
  const p = hostUnitPaths(os, { unitDir });
  const { node, path, warnings } = hostUnitPlan({ execPath, envPath, instanceHome });
  // The unit runs the oats that ran install: one inside an instance home goes away when that instance retires.
  // The home's work counts as resolved too: an attached instance's work is a link into its owner's home.
  if (instanceHome && isAbsolute(instanceHome)) {
    const bin = realpathOrNull(oatsBin) ?? resolve(oatsBin);
    const homes = [realpathOrNull(instanceHome) ?? resolve(instanceHome), realpathOrNull(join(instanceHome, "work"))].filter(Boolean);
    if (homes.some((home) => bin === home || bin.startsWith(home + sep))) warnings.push(`the unit would run ${oatsBin}, inside the instance home ${instanceHome}: the timer stops when that instance retires; run \`oats schedule host install\` with the operator's installed oats, from the operator's own shell`);
  }
  if (p.kind === "launchd") return { kind: p.kind, files: { [p.plist]: renderLaunchdPlist({ node, path, oatsBin }) }, warnings };
  if (p.kind === "systemd") { const units = renderSystemdUnits({ node, path, oatsBin }); return { kind: p.kind, files: { [p.service]: units.service, [p.timer]: units.timer }, warnings }; }
  throw scheduleError("E_SCHEDULE_HOST", `no host timer support on ${os}`);
}

/** Writes hostUnitFiles and loads them; the answer is the status plus their warnings. */
export function installHostUnit({ exec, os = platform(), unitDir, execPath = process.execPath, envPath = process.env.PATH || "", instanceHome = process.env.OATS_INSTANCE_HOME } = {}) {
  const p = hostUnitPaths(os, { unitDir });
  const { files, warnings } = hostUnitFiles({ os, unitDir, execPath, envPath, instanceHome });
  mkdirSync(join(hostScheduleDir(), "log"), { recursive: true });
  if (p.kind === "launchd") {
    mkdirSync(dirname(p.plist), { recursive: true });
    const status = hostUnitStatus({ exec, os, unitDir });
    const rendered = files[p.plist];
    // Idempotent: registering another scope while the same timer is active
    // must not unload an in-flight tick just to rewrite identical bytes.
    if (status.active && existsSync(p.plist) && readFileSync(p.plist, "utf8") === rendered) return { ...status, warnings };
    if (status.active) { const r = run(exec, ["launchctl", "bootout", `gui/${userInfo().uid}/${LAUNCHD_LABEL}`]); if (!r.ok) throw scheduleError("E_SCHEDULE_HOST", `launchctl bootout failed before reinstall: ${r.err}`); }
    writeFileSync(p.plist, rendered);
    const r = run(exec, ["launchctl", "bootstrap", `gui/${userInfo().uid}`, p.plist]);
    if (!r.ok) throw scheduleError("E_SCHEDULE_HOST", `launchctl bootstrap failed: ${r.err}`);
    return { ...hostUnitStatus({ exec, os, unitDir }), warnings };
  }
  if (p.kind === "systemd") {
    mkdirSync(dirname(p.timer), { recursive: true });
    const units = { service: files[p.service], timer: files[p.timer] };
    const status = hostUnitStatus({ exec, os, unitDir });
    if (status.active && existsSync(p.service) && existsSync(p.timer) && readFileSync(p.service, "utf8") === units.service && readFileSync(p.timer, "utf8") === units.timer) return { ...status, warnings };
    writeFileSync(p.service, units.service); writeFileSync(p.timer, units.timer);
    for (const argv of [["systemctl", "--user", "daemon-reload"], ["systemctl", "--user", "enable", "--now", `${SYSTEMD_UNIT}.timer`]]) { const r = run(exec, argv); if (!r.ok) throw scheduleError("E_SCHEDULE_HOST", `${argv.join(" ")} failed: ${r.err}`); }
    return { ...hostUnitStatus({ exec, os, unitDir }), warnings };
  }
  throw scheduleError("E_SCHEDULE_HOST", `no host timer support on ${os}`);
}

/** Uninstall reports the OS's answer: a unit that stays loaded after the
 *  OS refused to unload it is an error, not a removed file. */
export function uninstallHostUnit({ exec, os = platform(), unitDir } = {}) {
  const p = hostUnitPaths(os, { unitDir });
  if (p.kind === "launchd") {
    const before = hostUnitStatus({ exec, os, unitDir });
    if (before.active) {
      const r = run(exec, ["launchctl", "bootout", `gui/${userInfo().uid}/${LAUNCHD_LABEL}`]);
      if (!r.ok || hostUnitStatus({ exec, os, unitDir }).active) throw scheduleError("E_SCHEDULE_HOST", `launchctl bootout did not unload ${LAUNCHD_LABEL}: ${r.err || "still loaded"}; the unit file is kept`);
    }
    rmSync(p.plist, { force: true });
    return hostUnitStatus({ exec, os, unitDir });
  }
  if (p.kind === "systemd") {
    const before = hostUnitStatus({ exec, os, unitDir });
    if (before.active) {
      const r = run(exec, ["systemctl", "--user", "disable", "--now", `${SYSTEMD_UNIT}.timer`]);
      if (!r.ok || hostUnitStatus({ exec, os, unitDir }).active) throw scheduleError("E_SCHEDULE_HOST", `systemctl --user disable --now ${SYSTEMD_UNIT}.timer failed: ${r.err || "still active"}; the unit files are kept`);
    }
    rmSync(p.timer, { force: true }); rmSync(p.service, { force: true });
    const r = run(exec, ["systemctl", "--user", "daemon-reload"]);
    if (!r.ok) throw scheduleError("E_SCHEDULE_HOST", `systemctl --user daemon-reload failed: ${r.err}`);
    return hostUnitStatus({ exec, os, unitDir });
  }
  throw scheduleError("E_SCHEDULE_HOST", `no host timer support on ${os}`);
}
