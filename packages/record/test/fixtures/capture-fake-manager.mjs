// Test-only model, never a real manager. Callers provide isolated HOME and
// intercept spawnSync before setup can resolve launchctl/systemctl on PATH.
import fs from "node:fs";
import { join } from "node:path";

const service = "turn-record-capture.service", timer = "turn-record-capture.timer", label = "ai.aweb.turn-record-capture";
const decode = text => text.replace(/&#13;/g, "\r").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
export function fakeCaptureManager(home, command, args, callsPath = join(home, ".manager-calls")) {
  if (!home || !["launchctl", "systemctl"].includes(command)) throw new Error("invalid fixture manager invocation");
  fs.appendFileSync(callsPath, `${command} ${args.join(" ")}\n`);
  args = args.filter(argument => argument !== "--runtime");
  const statePath = join(home, ".manager-state.json");
  const configPath = join(home, ".manager-config.json");
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath)) : {};
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath)) : {};
  const operation = command === "systemctl" ? args[1] : args[0];
  if (config.fail === operation) return { status: config.code ?? 5, signal: config.signal ?? null,
    error: config.missing ? Object.assign(new Error("fixture manager missing"), { code: "ENOENT" }) : undefined, stdout: "", stderr: "fixture manager refusal" };
  const ok = stdout => ({ status: 0, signal: null, stdout: stdout ?? "", stderr: "" });
  const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
  if (command === "launchctl") {
    const path = join(home, "Library", "LaunchAgents", `${label}.plist`);
    const read = () => {
      const text = fs.readFileSync(path, "utf8"), body = /<key>ProgramArguments<\/key>\s*<array>([^]*?)<\/array>/.exec(text)?.[1] ?? "";
      return { registered: true, path, argv: [...body.matchAll(/<string>([^]*?)<\/string>/g)].map(([, value]) => decode(value)),
        interval: text.includes("<key>StartInterval</key>") ? 900 : null, disabled: false, active: true };
    };
    state.mac ??= fs.existsSync(path) ? read() : { registered: false, disabled: false };
    if (config.mac) Object.assign(state.mac, config.mac);
    if (operation === "print-disabled") return ok(`disabled services = {\n "${label}" => ${state.mac.disabled ? "true" : "false"}\n}\n`);
    if (operation === "print") return state.mac.registered ? ok(`${label} = {\n path = ${state.mac.path}\n arguments = {\n${state.mac.argv.map(arg => `  ${arg}`).join("\n")}\n }\n${state.mac.interval ? ` run interval = ${state.mac.interval} seconds\n` : ""}}\n`) :
      { status: 113, signal: null, stdout: "", stderr: "Could not find service in domain" };
    if (operation === "bootout") state.mac.registered = state.mac.active = false;
    else if (operation === "enable") state.mac.disabled = false;
    else if (operation === "bootstrap") state.mac = read();
    else throw new Error(`unexpected fake launchctl ${operation}`);
    save(); return ok();
  }
  const path = unit => join(home, ".config", "systemd", "user", unit);
  const read = unit => {
    const present = fs.existsSync(path(unit)), text = present ? fs.readFileSync(path(unit), "utf8") : "";
    const masked = (() => { try { return fs.readlinkSync(path(unit)) === "/dev/null"; } catch { return false; } })();
    return { LoadState: masked ? "masked" : present ? "loaded" : "not-found", UnitFileState: masked ? "masked" : !present ? "" :
      unit === service && text.includes("Type=exec") ? "static" : unit === timer ? "disabled" : "enabled", ActiveState: present && text.includes("--watch") ? "active" : "inactive",
      SubState: unit === timer ? "waiting" : "dead", FragmentPath: present || masked ? path(unit) : "", DropInPaths: "", NeedDaemonReload: "no" };
  };
  state.units ??= {};
  for (const unit of [service, timer]) state.units[unit] ??= read(unit);
  if (config.units) for (const [unit, values] of Object.entries(config.units)) Object.assign(state.units[unit], values);
  if (operation === "show") return ok(Object.entries(state.units[args[2]]).map(([key, value]) => `${key}=${value}`).join("\n") + "\n");
  if (operation === "stop") state.units[args[2]].ActiveState = "inactive";
  else if (operation === "disable") state.units[args[2]].UnitFileState = "disabled";
  else if (operation === "unmask") for (const unit of args.slice(2)) {
    try { if (fs.readlinkSync(path(unit)) === "/dev/null") fs.unlinkSync(path(unit)); } catch (error) { if (!["EINVAL", "ENOENT"].includes(error.code)) throw error; }
    state.units[unit] = read(unit);
  }
  else if (operation === "daemon-reload") for (const unit of [service, timer]) {
    const previous = state.units[unit], next = read(unit);
    if (unit === timer && previous.UnitFileState === "disabled") next.UnitFileState = "disabled";
    next.ActiveState = previous.ActiveState; state.units[unit] = next;
  }
  else if (operation === "enable" && args[2] === "--now" && args[3] === timer) {
    state.units[timer].UnitFileState = "enabled"; state.units[timer].ActiveState = "active";
  } else throw new Error(`unexpected fake systemctl ${operation}`);
  save(); return ok();
}
