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

export function renderLaunchdPlist({ node = process.execPath, oatsBin = OATS_BIN, logDir = join(hostScheduleDir(), "log"), intervalSec = 60, oatsHomeDir = process.env.OATS_HOME_DIR } = {}) {
  const env = oatsHomeDir ? `\n  <key>EnvironmentVariables</key>\n  <dict><key>OATS_HOME_DIR</key><string>${escapeXml(oatsHomeDir)}</string></dict>` : "";
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
export function renderSystemdUnits({ node = process.execPath, oatsBin = OATS_BIN, intervalSec = 60, oatsHomeDir = process.env.OATS_HOME_DIR } = {}) {
  const env = oatsHomeDir ? `Environment=OATS_HOME_DIR=${oatsHomeDir}\n` : "";
  return {
    service: `[Unit]\nDescription=OATS schedule tick\n\n[Service]\nType=oneshot\n${env}ExecStart=${node} ${oatsBin} schedule tick --host --json\n`,
    timer: `[Unit]\nDescription=OATS schedule tick every ${intervalSec}s\n\n[Timer]\nOnBootSec=${intervalSec}\nOnUnitActiveSec=${intervalSec}\nAccuracySec=5\nUnit=${SYSTEMD_UNIT}.service\n\n[Install]\nWantedBy=timers.target\n`,
  };
}

export function hostUnitPaths(os = platform()) {
  if (os === "darwin") return { kind: "launchd", plist: join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`) };
  if (os === "linux") { const dir = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "systemd", "user"); return { kind: "systemd", service: join(dir, `${SYSTEMD_UNIT}.service`), timer: join(dir, `${SYSTEMD_UNIT}.timer`) }; }
  return { kind: "unsupported" };
}

function run(exec, argv) {
  try { return { ok: true, out: (exec || execFileSync)(argv[0], argv.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000 }) }; }
  catch (e) { return { ok: false, out: String(e.stdout || ""), err: String(e.stderr || e.message || "").trim() }; }
}

/** installed = the unit file exists; active = the OS reports it loaded/active. */
export function hostUnitStatus({ exec, os = platform() } = {}) {
  const p = hostUnitPaths(os);
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

export function installHostUnit({ exec, os = platform(), intervalSec = 60 } = {}) {
  const p = hostUnitPaths(os);
  mkdirSync(join(hostScheduleDir(), "log"), { recursive: true });
  if (p.kind === "launchd") {
    mkdirSync(dirname(p.plist), { recursive: true });
    const status = hostUnitStatus({ exec, os });
    if (status.active) run(exec, ["launchctl", "bootout", `gui/${userInfo().uid}/${LAUNCHD_LABEL}`]);
    writeFileSync(p.plist, renderLaunchdPlist({ intervalSec }));
    const r = run(exec, ["launchctl", "bootstrap", `gui/${userInfo().uid}`, p.plist]);
    if (!r.ok) throw scheduleError("E_SCHEDULE_HOST", `launchctl bootstrap failed: ${r.err}`);
    return hostUnitStatus({ exec, os });
  }
  if (p.kind === "systemd") {
    mkdirSync(dirname(p.timer), { recursive: true });
    const units = renderSystemdUnits({ intervalSec });
    writeFileSync(p.service, units.service); writeFileSync(p.timer, units.timer);
    for (const argv of [["systemctl", "--user", "daemon-reload"], ["systemctl", "--user", "enable", "--now", `${SYSTEMD_UNIT}.timer`]]) { const r = run(exec, argv); if (!r.ok) throw scheduleError("E_SCHEDULE_HOST", `${argv.join(" ")} failed: ${r.err}`); }
    return hostUnitStatus({ exec, os });
  }
  throw scheduleError("E_SCHEDULE_HOST", `no host timer support on ${os}`);
}

export function uninstallHostUnit({ exec, os = platform() } = {}) {
  const p = hostUnitPaths(os);
  if (p.kind === "launchd") {
    run(exec, ["launchctl", "bootout", `gui/${userInfo().uid}/${LAUNCHD_LABEL}`]);
    rmSync(p.plist, { force: true });
    return hostUnitStatus({ exec, os });
  }
  if (p.kind === "systemd") {
    run(exec, ["systemctl", "--user", "disable", "--now", `${SYSTEMD_UNIT}.timer`]);
    rmSync(p.timer, { force: true }); rmSync(p.service, { force: true });
    run(exec, ["systemctl", "--user", "daemon-reload"]);
    return hostUnitStatus({ exec, os });
  }
  throw scheduleError("E_SCHEDULE_HOST", `no host timer support on ${os}`);
}
