#!/usr/bin/env node
// turn-record setup — make this machine capture for real.
//
// Installs, idempotently:
//   1. Stop + SessionEnd capture hooks into every ~/.claude*/settings.json
//      that exists (merged, never clobbered; unparseable files are skipped
//      loudly and left untouched);
//   2. a background watcher service — launchd agent on macOS, systemd user
//      unit on Linux (printed instructions elsewhere);
//   3. then runs the first capture pass (the expensive one) unless --dry-run.
//
// Everything is derived from the running install: node = process.execPath,
// scripts resolved relative to this file, so it works from a global npm
// install, npx, or a repo checkout alike.
//
//   --owner <name>   stream owner (default: LocalHostName on macOS, hostname)
//   --no-hooks       skip step 1
//   --no-service     skip step 2
//   --dry-run        print what would change, change nothing

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Config files deserve the same crash safety as the store's objects:
// write-then-rename, never a partial write in place.
function writeFileAtomic(path, content) {
  const tmp = path + ".tmp-" + process.pid;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const CAPTURE = join(HERE, "capture.mjs");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--owner") args.owner = argv[++i];
    else if (a.startsWith("--")) args[a.slice(2)] = true;
    else {
      console.error(`unknown argument ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function defaultOwner() {
  if (platform() === "darwin") {
    try {
      const name = execFileSync("scutil", ["--get", "LocalHostName"]).toString().trim();
      if (name) return name;
    } catch {
      /* fall through to hostname */
    }
  }
  return hostname().split(".")[0];
}

const args = parseArgs(process.argv.slice(2));
const owner = args.owner ?? defaultOwner();
const dry = Boolean(args["dry-run"]);

// The owner is interpolated into a persisted shell command, a launchd
// plist, and a systemd unit. Restricting it to the stream-id character
// class (which the store requires anyway) makes it shell-, XML-, and
// INI-safe in one check, BEFORE anything is written.
if (!/^[A-Za-z0-9._-]+$/.test(owner)) {
  console.error(
    `invalid --owner ${JSON.stringify(owner)}: letters, digits, dot, underscore, hyphen only`,
  );
  process.exit(2);
}

const hookCommand = `${NODE} ${CAPTURE} --owner ${owner} --quiet`;
const HOOK = { type: "command", command: hookCommand, async: true, timeout: 120 };

console.log(`owner: ${owner}`);
console.log(`node:  ${NODE}`);

// ------------------------------------------------------------------- hooks

function settingsFiles() {
  const home = homedir();
  const files = [];
  for (const name of readdirSync(home).sort()) {
    if (!name.startsWith(".claude")) continue;
    const path = join(home, name, "settings.json");
    if (existsSync(path)) files.push(path);
  }
  return files;
}

function installHooks() {
  for (const path of settingsFiles()) {
    let settings;
    try {
      settings = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      console.error(`SKIP ${path}: not valid JSON (${err.message}) — fix it and re-run setup`);
      continue;
    }
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
      console.error(`SKIP ${path}: not a JSON object`);
      continue;
    }
    let changed = false;
    settings.hooks = settings.hooks ?? {};
    // Ours = a command whose STRUCTURE matches what setup generates:
    // "<node> <...>/capture.mjs ... --owner ... --quiet ...". Matching by
    // shape rather than this install's absolute path means a moved install
    // (npm upgrade, checkout -> global) updates the old hook in place
    // instead of stacking a second one. The structural requirements (script
    // is the second token and ends in /capture.mjs; both flags present as
    // whole tokens) keep it from firing on unrelated hooks that merely
    // mention similar words; when in doubt it errs toward appending a new
    // group, never toward overwriting someone else's command.
    const ours = (h) => {
      if (h?.type !== "command") return false;
      const tokens = String(h.command).trim().split(/\s+/);
      return (
        tokens.length >= 2 &&
        tokens[1].endsWith("/capture.mjs") &&
        tokens.includes("--owner") &&
        tokens.includes("--quiet")
      );
    };
    for (const event of ["Stop", "SessionEnd"]) {
      const groups = (settings.hooks[event] = settings.hooks[event] ?? []);
      let found = false;
      for (const group of groups) {
        for (const hook of group.hooks ?? []) {
          if (!ours(hook)) continue;
          found = true;
          if (hook.command !== hookCommand) {
            hook.command = hookCommand;
            changed = true;
          }
        }
      }
      if (!found) {
        groups.push({ hooks: [{ ...HOOK }] });
        changed = true;
      }
    }
    if (!changed) {
      console.log(`hooks: ${path} already installed`);
    } else if (dry) {
      console.log(`hooks: would install Stop+SessionEnd capture in ${path}`);
    } else {
      writeFileAtomic(path, JSON.stringify(settings, null, 2) + "\n");
      console.log(`hooks: installed Stop+SessionEnd capture in ${path}`);
    }
  }
}

// ----------------------------------------------------------------- service

function installServiceDarwin() {
  const label = "ai.aweb.turn-record-capture";
  const path = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
  const logPath = join(homedir(), "Library", "Logs", "turn-record-capture.log");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${CAPTURE}</string>
    <string>--watch</string>
    <string>--owner</string>
    <string>${owner}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>60</integer>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === plist) {
    console.log(`service: ${path} already installed`);
    return;
  }
  if (dry) {
    console.log(`service: would ${current ? "update" : "install"} launchd agent at ${path}`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, plist);
  const uid = process.getuid();
  spawnSync("launchctl", ["bootout", `gui/${uid}/${label}`], { stdio: "ignore" });
  const boot = spawnSync("launchctl", ["bootstrap", `gui/${uid}`, path], { encoding: "utf8" });
  if (boot.status === 0) {
    console.log(`service: launchd agent ${label} running (log: ${logPath})`);
  } else {
    console.error(
      `service: wrote ${path} but launchctl bootstrap failed (${(boot.stderr || "").trim()}); ` +
        `load it manually: launchctl bootstrap gui/${uid} ${path}`,
    );
  }
}

function installServiceLinux() {
  const path = join(homedir(), ".config", "systemd", "user", "turn-record-capture.service");
  const unit = `[Unit]
Description=turn-record capture watcher

[Service]
ExecStart=${NODE} ${CAPTURE} --watch --owner ${owner}
Restart=always
RestartSec=60

[Install]
WantedBy=default.target
`;
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === unit) {
    console.log(`service: ${path} already installed`);
    return;
  }
  if (dry) {
    console.log(`service: would ${current ? "update" : "install"} systemd user unit at ${path}`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, unit);
  const enable = spawnSync(
    "systemctl",
    ["--user", "enable", "--now", "turn-record-capture.service"],
    { encoding: "utf8" },
  );
  if (enable.status === 0) {
    console.log("service: systemd user unit turn-record-capture running");
  } else {
    console.error(
      `service: wrote ${path} but systemctl enable failed (${(enable.stderr || "").trim()}); ` +
        "enable it manually: systemctl --user enable --now turn-record-capture.service",
    );
  }
}

function installService() {
  const os = platform();
  if (os === "darwin") installServiceDarwin();
  else if (os === "linux") installServiceLinux();
  else {
    console.log(
      `service: no service template for ${os}; run this in the background yourself:\n` +
        `  ${NODE} ${CAPTURE} --watch --owner ${owner}`,
    );
  }
}

// --------------------------------------------------------------------- run

if (!args["no-hooks"]) installHooks();
if (!args["no-service"]) installService();

if (dry) {
  console.log("dry run: no first capture pass");
} else {
  console.log("running first capture pass (the initial one can take minutes)...");
  const pass = spawnSync(NODE, [CAPTURE, "--owner", owner], { stdio: "inherit" });
  process.exit(pass.status ?? 1);
}
