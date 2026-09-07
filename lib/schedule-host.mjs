/** The ONE host timer that runs `oats schedule tick --host` once a minute:
 *  a launchd user agent on macOS, a systemd user timer on Linux. Nothing is
 *  installed unless `oats schedule host install` is run explicitly, and
 *  status reports what the OS says is loaded, never what a file implies. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostScheduleDir, scheduleError } from "./schedule.mjs";

export const LAUNCHD_LABEL = "ai.oats.schedule-tick";
export const SYSTEMD_UNIT = "oats-schedule-tick";
const OATS_BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "oats.mjs");

function escapeXml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

/** launchd and systemd start units with a short PATH that has no Homebrew
 *  tmux and no installed harness. The unit therefore carries an explicit
 *  PATH: the installer's own PATH (the operator's tool environment) plus
 *  the node running the installer and the usual prefixes. */
export function hostPath({ node = process.execPath, envPath = process.env.PATH || "" } = {}) {
  const seen = new Set();
  const out = [];
  for (const p of [dirname(node), ...envPath.split(":"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]) {
    if (p && !seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out.join(":");
}

export function renderLaunchdPlist({ node = process.execPath, oatsBin = OATS_BIN, logDir = join(hostScheduleDir(), "log"), intervalSec = 60, oatsHomeDir = process.env.OATS_HOME_DIR, path = hostPath({ node }) } = {}) {
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
  <key>StartInterval</key><integer>${intervalSec}</integer>
  <key>RunAtLoad</key><false/>
  <key>ProcessType</key><string>Background</string>
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
export function renderSystemdUnits({ node = process.execPath, oatsBin = OATS_BIN, intervalSec = 60, oatsHomeDir = process.env.OATS_HOME_DIR, path = hostPath({ node }) } = {}) {
  const env = `Environment=${systemdQuote(`PATH=${path}`)}\n${oatsHomeDir ? `Environment=${systemdQuote(`OATS_HOME_DIR=${oatsHomeDir}`)}\n` : ""}`;
  return {
    service: `[Unit]\nDescription=OATS schedule tick\n\n[Service]\nType=oneshot\n${env}ExecStart=${systemdQuote(node)} ${systemdQuote(oatsBin)} schedule tick --host --json\n`,
    timer: `[Unit]\nDescription=OATS schedule tick every ${intervalSec}s\n\n[Timer]\nOnBootSec=${intervalSec}\nOnUnitActiveSec=${intervalSec}\nAccuracySec=5\nUnit=${SYSTEMD_UNIT}.service\n\n[Install]\nWantedBy=timers.target\n`,
  };
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

/** installed = the unit file exists; active = the OS reports it loaded/active. */
export function hostUnitStatus({ exec, os = platform(), unitDir } = {}) {
  const p = hostUnitPaths(os, { unitDir });
  if (p.kind === "launchd") {
    const installed = existsSync(p.plist);
    const r = run(exec, ["launchctl", "print", `gui/${userInfo().uid}/${LAUNCHD_LABEL}`]);
    return { kind: p.kind, unit: p.plist, installed, active: r.ok };
  }
  if (p.kind === "systemd") {
    const installed = existsSync(p.timer) && existsSync(p.service);
    const r = run(exec, ["systemctl", "--user", "is-active", `${SYSTEMD_UNIT}.timer`]);
    return { kind: p.kind, unit: p.timer, installed, active: r.ok && r.out.trim() === "active" };
  }
  return { kind: "unsupported", installed: false, active: false };
}

export function installHostUnit({ exec, os = platform(), intervalSec = 60, unitDir } = {}) {
  const p = hostUnitPaths(os, { unitDir });
  mkdirSync(join(hostScheduleDir(), "log"), { recursive: true });
  if (p.kind === "launchd") {
    mkdirSync(dirname(p.plist), { recursive: true });
    const status = hostUnitStatus({ exec, os, unitDir });
    const rendered = renderLaunchdPlist({ intervalSec });
    // Idempotent: registering another scope while the same timer is active
    // must not unload an in-flight tick just to rewrite identical bytes.
    if (status.active && existsSync(p.plist) && readFileSync(p.plist, "utf8") === rendered) return status;
    if (status.active) { const r = run(exec, ["launchctl", "bootout", `gui/${userInfo().uid}/${LAUNCHD_LABEL}`]); if (!r.ok) throw scheduleError("E_SCHEDULE_HOST", `launchctl bootout failed before reinstall: ${r.err}`); }
    writeFileSync(p.plist, rendered);
    const r = run(exec, ["launchctl", "bootstrap", `gui/${userInfo().uid}`, p.plist]);
    if (!r.ok) throw scheduleError("E_SCHEDULE_HOST", `launchctl bootstrap failed: ${r.err}`);
    return hostUnitStatus({ exec, os, unitDir });
  }
  if (p.kind === "systemd") {
    mkdirSync(dirname(p.timer), { recursive: true });
    const units = renderSystemdUnits({ intervalSec });
    const status = hostUnitStatus({ exec, os, unitDir });
    if (status.active && existsSync(p.service) && existsSync(p.timer) && readFileSync(p.service, "utf8") === units.service && readFileSync(p.timer, "utf8") === units.timer) return status;
    writeFileSync(p.service, units.service); writeFileSync(p.timer, units.timer);
    for (const argv of [["systemctl", "--user", "daemon-reload"], ["systemctl", "--user", "enable", "--now", `${SYSTEMD_UNIT}.timer`]]) { const r = run(exec, argv); if (!r.ok) throw scheduleError("E_SCHEDULE_HOST", `${argv.join(" ")} failed: ${r.err}`); }
    return hostUnitStatus({ exec, os, unitDir });
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
