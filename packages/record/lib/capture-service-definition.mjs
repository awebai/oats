// Private finite-service request and pure manager definitions. Rendering grants
// no ownership, replacement or activation authority; setup must preflight those
// independently before it writes any definition or invokes a manager.
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureCommandOptions } from "./capture-command.mjs";

export const captureServiceLabel = "ai.aweb.turn-record-capture";
export const captureServiceUnit = "turn-record-capture.service";
export const captureServiceTimer = "turn-record-capture.timer";
// Setup's private record, under the record root, that it started activating
// the service and has not verified it: a rerun tells its own unfinished step
// from an operator's disable, and health reports the unverified schedule.
export const capturePendingActivationName = "capture-service-pending.json";
const marker = "oats-turn-record-service:1";
const entry = fileURLToPath(new URL("./capture-service-runner.mjs", import.meta.url));

export function captureServiceRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !["root", "owner", "plan"].includes(key)) ||
      typeof value.root !== "string" || !value.root || value.root.includes("\0"))
    throw new Error("invalid private capture service request");
  const options = captureCommandOptions({ owner: value.owner, plan: value.plan,
    trigger: "service", indexEnabled: true, retrySetAside: false });
  if (options.plan.sources.length !== 4) throw new Error("capture service requires all sources");
  return { root: resolve(options.plan.cwd, value.root), owner: options.owner, plan: options.plan };
}

function xml(value) {
  // XML 1.0 forbids these characters even as numeric references. Refuse rather
  // than persist a definition whose parsed arguments differ from the request.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value) ||
      /[\ud800-\udfff]/u.test(value)) throw new Error("unrepresentable capture service XML value");
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\r/g, "&#13;");
}

function systemd(value, executable = false) {
  if (/[\u0000-\u001f\u007f]/u.test(value) || (executable && /['"\\]/u.test(value)))
    throw new Error("unrepresentable capture service systemd value");
  // Specifiers apply to every word; environment substitution applies to argv,
  // not the executable. Always quote: JSON is one argument, never shell input.
  let escaped = value.replace(/%/g, "%%").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (!executable) escaped = escaped.replace(/\$/g, "$$$$");
  return `"${escaped}"`;
}

export function captureServiceDefinition({ platform, node, request } = {}) {
  if (!["darwin", "linux"].includes(platform) || typeof node !== "string" ||
      !isAbsolute(node) || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(node))
    throw new Error("invalid capture service definition selection");
  const selected = captureServiceRequest(request);
  const argv = [node, entry, JSON.stringify(selected)];
  if (platform === "darwin") {
    const log = join(selected.plan.home, "Library", "Logs", "turn-record-capture.log");
    const contents = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${marker} -->
<plist version="1.0"><dict>
  <key>Label</key><string>${captureServiceLabel}</string>
  <key>ProgramArguments</key><array>${argv.map(arg => `<string>${xml(arg)}</string>`).join("")}</array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>900</integer>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`;
    return { argv, files: [{ path: join(selected.plan.home, "Library", "LaunchAgents", `${captureServiceLabel}.plist`), contents }] };
  }
  const directory = join(selected.plan.home, ".config", "systemd", "user");
  const service = `# ${marker}
[Unit]
Description=turn-record bounded capture pass

[Service]
Type=exec
ExecStart=${argv.map((arg, index) => systemd(arg, index === 0)).join(" ")}
MemoryMax=2G
RuntimeMaxSec=300
`;
  const timer = `# ${marker}
[Unit]
Description=turn-record periodic capture

[Timer]
OnBootSec=1min
OnUnitActiveSec=15min
Unit=${captureServiceUnit}

[Install]
WantedBy=timers.target
`;
  return { argv, files: [{ path: join(directory, captureServiceUnit), contents: service },
    { path: join(directory, captureServiceTimer), contents: timer }] };
}
