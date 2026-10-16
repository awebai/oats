#!/usr/bin/env node
// turn-record setup — make this machine capture for real.
//
// Installs, idempotently:
//   1. Stop + SessionEnd capture hooks into every ~/.claude*/settings.json
//      that exists (merged, never clobbered; unparseable files are skipped
//      loudly and left untouched);
//   2. a periodic bounded service — launchd on macOS, systemd user timer on Linux;
//   3. then runs the first capture pass (the expensive one) unless --dry-run.
//
// Everything is derived from the running install: scripts resolved relative
// to this file, so it works from a global npm install, npx, or a repo
// checkout alike. The node written into the hooks and the service is the one
// handed in (OATS_NODE_BIN, which `oats setup` sets to a path that survives
// an upgrade of Node), else process.execPath: see recordedNode().
//
//   --owner <name>   stream owner (default: LocalHostName on macOS, hostname)
//   --root <dir>     explicit record root, also persisted into hooks/services
//   --replace-service  explicitly replace foreign/disabled named capture service
//   --no-hooks       skip step 1
//   --no-service     skip step 2
//   --dry-run        print what would change, change nothing

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { homedir, hostname, platform } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureDefaultRootPlan } from "../lib/capture-default-roots.mjs";
import { captureCommandPass } from "../lib/capture-command-output.mjs";
import { IgnoreError, loadIgnore } from "../lib/ignore.mjs";
import { preflightCaptureService, applyCaptureService, captureSetupSnapshot, recheckCaptureSetup, writeCaptureSetup } from "../lib/capture-service-install.mjs";

// The node written into what outlives this process: the hooks and the
// service. `oats setup` hands in the kernel's answer for a node that survives
// an upgrade of Node, as OATS_NODE_BIN; this package has no such rule of its
// own, so run alone it records the node it runs under. What runs at once (the
// first capture pass) runs under process.execPath whatever is recorded.
function recordedNode(env = process.env) {
  const handed = env.OATS_NODE_BIN;
  return typeof handed === "string" && isAbsolute(handed) ? handed : process.execPath;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const NODE = recordedNode();
const CAPTURE = join(HERE, "capture.mjs");

// Hooks use POSIX shell words. The separate definition builder owns the
// manager-specific XML/systemd representations.
const SHELL_PLAIN = /^[A-Za-z0-9_./:@%+,-]+$/;

// A shell word: POSIX single quotes, a quote itself as '\''.
function shellWord(value) {
  return SHELL_PLAIN.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

// The words of a command as /bin/sh reads them, for what setup writes: plain
// characters, single-quoted runs and \' for a quote, adjacent pieces joined
// into one word, words apart by spaces or tabs. null when the command holds
// anything else outside quotes (an expansion, an operator, a redirection, a
// double quote, a newline, which ends a command) or a quote left open: the
// shell would do more with it than run those words, so it is not read.
//
// Any character above U+007F is part of a word too, as an earlier setup
// wrote it bare in a path (shellWord now quotes it). bash, dash and zsh end
// a word only at a space, a tab, a newline or an operator, all ASCII, so a
// command of such words carries nothing a rewrite would lose. POSIX lets a
// shell end a word at any blank of its locale (U+3000, say): such a shell
// would see one more argument of the same command, which a rewrite does not
// lose either, so no character above U+007F is refused.
function shellWords(command) {
  const words = [];
  let word = null;
  for (let i = 0; i < command.length; ) {
    const c = command[i];
    if (c === " " || c === "\t") {
      if (word !== null) words.push(word);
      word = null;
      i++;
    } else if (c === "'") {
      const end = command.indexOf("'", i + 1);
      if (end < 0) return null;
      word = (word ?? "") + command.slice(i + 1, end);
      i = end + 1;
    } else if (c === "\\" && command[i + 1] === "'") {
      word = (word ?? "") + "'";
      i += 2;
    } else if (SHELL_PLAIN.test(c) || c > "\x7F") {
      word = (word ?? "") + c;
      i++;
    } else return null;
  }
  if (word !== null) words.push(word);
  return words;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--owner" || a === "--root") {
      const value = argv[++i];
      if (!value || value.startsWith("--") || value.includes("\0")) { console.error(`${a} requires a value`); process.exit(2); }
      args[a.slice(2)] = value;
    }
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
const root = resolve(args.root ?? process.env.TURN_RECORD_ROOT ?? join(homedir(), ".turn-record"));

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

const hookCommand = `${shellWord(NODE)} ${shellWord(CAPTURE)} --owner ${owner} --quiet --hook --root ${shellWord(root)}`;
// The harness waits only for OS launch acknowledgement. Capture itself is
// detached and owns no harness pipes; these are launcher, not worker limits.
const HOOK = { type: "command", command: hookCommand, async: false, timeout: 10 };

console.log(`owner: ${owner}`);
console.log(`node:  ${NODE}`);

// ------------------------------------------------------------------- hooks

function settingsFiles() {
  const home = homedir();
  const files = [];
  for (const entry of readdirSync(home, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (!entry.name.startsWith(".claude") || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
    const path = join(home, entry.name, "settings.json");
    if (captureSetupSnapshot(path).kind !== "absent") files.push(path);
  }
  return files;
}

function prepareHooks() {
  const edits = [];
  for (const path of settingsFiles()) {
    const snapshot = captureSetupSnapshot(path);
    if (snapshot.kind !== "file") throw new Error(`cannot safely read hook settings ${path}; preserve it and use --no-hooks`);
    let settings;
    try {
      settings = JSON.parse(snapshot.bytes.toString("utf8"));
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
    //
    // The tokens are the command's words as the shell reads them
    // (shellWords), and only a command that reads whole that way can be
    // ours: one that also carries a second command, an operator or a
    // redirection would lose it when rewritten. It reads the quoted form and
    // every command written before paths were quoted, except one with `=`,
    // `~` or another ASCII character outside the plain set left bare in a
    // path, or with a space in one, which was split.
    const ours = (h) => {
      if (h?.type !== "command") return false;
      const tokens = shellWords(String(h.command));
      return (
        tokens !== null &&
        tokens.length >= 2 &&
        tokens[1].endsWith("/capture.mjs") &&
        tokens.includes("--owner") &&
        tokens.includes("--quiet")
      );
    };
    for (const event of ["Stop", "SessionEnd"]) {
      const groups = (settings.hooks[event] = settings.hooks[event] ?? []);
      let found = false;
      // Every hook that is ours gets the current command/scheduling fields; none is removed,
      // two in one event included: the shape is not proof of ownership.
      for (const group of groups) {
        for (const hook of group.hooks ?? []) {
          if (!ours(hook)) continue;
          found = true;
          if (hook.command !== hookCommand || hook.async !== HOOK.async || hook.timeout !== HOOK.timeout) {
            hook.command = hookCommand;
            hook.async = HOOK.async;
            hook.timeout = HOOK.timeout;
            changed = true;
          }
        }
      }
      if (!found) {
        groups.push({ hooks: [{ ...HOOK }] });
        changed = true;
      }
    }
    edits.push({ snapshot, contents: changed ? JSON.stringify(settings, null, 2) + "\n" : null });
  }
  return edits;
}

// --------------------------------------------------------------------- run
let captureStarted = false;
try {
  const hooks = args["no-hooks"] ? [] : prepareHooks();
  const plan = captureDefaultRootPlan({ home: homedir(), cwd: process.cwd(), env: process.env });
  // Every target and applicable manager is inspected before hook/service or
  // capture mutations. --no-service never even reads named service files.
  let service = null;
  if (!args["no-service"]) {
    if (["darwin", "linux"].includes(platform())) service = preflightCaptureService({ platform: platform(), node: NODE,
      request: { root, owner, plan }, setupPath: fileURLToPath(import.meta.url), dry, replace: Boolean(args["replace-service"]), noHooks: Boolean(args["no-hooks"]) });
    else console.log(`service: no service template for ${platform()}; run this in the background yourself:\n` +
      `  ${shellWord(NODE)} ${shellWord(CAPTURE)} --watch --owner ${owner} --root ${shellWord(root)}`);
  }
  if (!dry) loadIgnore(root);
  const createdParents = new Map();
  for (const hook of hooks) recheckCaptureSetup(hook.snapshot, createdParents);
  if (service) applyCaptureService(service, createdParents);
  for (const { snapshot, contents } of hooks) {
    if (!contents) console.log(`hooks: ${snapshot.path} already installed`);
    else if (dry) console.log(`hooks: would install Stop+SessionEnd capture in ${snapshot.path}`);
    else { writeCaptureSetup(snapshot, contents, createdParents); console.log(`hooks: installed Stop+SessionEnd capture in ${snapshot.path}`); }
  }
  if (dry) console.log("dry run: no first capture pass");
  else {
    console.log("running first capture pass (the initial one can take minutes)...");
    captureStarted = true;
    await captureCommandPass(root, { owner,
      plan, indexEnabled: true, trigger: "setup", retrySetAside: false });
  }
} catch (error) {
  console.error(error instanceof IgnoreError ? error.message : `${captureStarted ? "capture pass" : "setup"} failed: ${error.message}`);
  if (!captureStarted && !(error instanceof IgnoreError) && !error.code?.startsWith("E_CAPTURE_SERVICE_"))
    console.error(`setup recovery: inspect the reported files/manager state, then retry ${shellWord(NODE)} ${shellWord(fileURLToPath(import.meta.url))} --owner ${shellWord(owner)} --root ${shellWord(root)}${args["no-hooks"] ? " --no-hooks" : ""}${args["replace-service"] ? " --replace-service" : ""}; use --no-service to preserve the existing manager service`);
  process.exitCode = 1;
}
