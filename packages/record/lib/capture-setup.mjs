import { isCaptureHook } from "./capture-hook-ownership.mjs";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { homedir, hostname, platform } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureDefaultRootPlan } from "./capture-default-roots.mjs";
import { captureCommandPass } from "./capture-command-output.mjs";
import { captureCommandEntry } from "./capture-command.mjs";
import { IgnoreError, loadIgnore } from "./ignore.mjs";
import { preflightCaptureService, applyCaptureService } from "./capture-service-install.mjs";
import { captureSetupSnapshot, recheckCaptureSetup, writeCaptureSetup } from "./capture-setup-write.mjs";
import { preflightCaptureRoots, applyCaptureRoots } from "./capture-roots.mjs";
import { captureRemedyCommand } from "./capture-health.mjs";

// One typed setup entry for the kernel and standalone bin. Location authority
// crosses here as a closed package request, never argv, env or a transport file.
export async function captureSetup({ argv = [], deploymentRequest, node, output = console.log, errorOutput = console.error } = {}) {
const json = argv.includes('--json');
const log = json ? () => {} : output;
const warn = json ? () => {} : errorOutput;
let exitCode = 0;
// The node written into what outlives this process: the hooks and the
// service. `oats setup` hands in the kernel's answer for a node that survives
// an upgrade of Node, as OATS_NODE_BIN; this package has no such rule of its
// own, so run alone it records the node it runs under. What runs at once (the
// first capture pass) runs under process.execPath whatever is recorded.
function handedNode(env = process.env) {
  const handed = env.OATS_NODE_BIN;
  return typeof handed === "string" && isAbsolute(handed) ? handed : null;
}
function recordedNode(env = process.env) { return handedNode(env) ?? process.execPath; }

const HERE = fileURLToPath(new URL("../bin/", import.meta.url));
const NODE = node ?? recordedNode();
// Recoveries name the command a person runs, never this file: only a rerun
// through `oats setup` selects its stable node again. Health's wording function
// decides the words; setup's input to it is whether a node was handed in
// (OATS_NODE_BIN), which `oats setup` always does and instance shells also
// carry, so either printed command records that same node.
const SETUP_COMMAND = `${captureRemedyCommand(Boolean(node ?? handedNode()))} setup`;
const CAPTURE = join(HERE, "capture.mjs");
// The hooks run their own entry, which a rolled-back install lacks: see it.
const CAPTURE_HOOK = join(HERE, "capture-hook.mjs");

// Hooks use POSIX shell words. The separate definition builder owns the
// manager-specific XML/systemd representations.
const SHELL_PLAIN = /^[A-Za-z0-9_./:@%+,-]+$/;

// A shell word: POSIX single quotes, a quote itself as '\''.
function shellWord(value) {
  return SHELL_PLAIN.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--owner" || a === "--root") {
      const value = argv[++i];
      if (!value || value.startsWith("--") || value.includes("\0")) { warn(`${a} requires a value`); throw Object.assign(new Error("invalid setup arguments"), { code: "E_USAGE" }); }
      args[a.slice(2)] = value;
    }
    else if (["--no-hooks", "--no-service", "--dry-run", "--replace-service", "--json"].includes(a)) args[a.slice(2)] = true;
    else {
      warn(`unknown setup argument ${a}`);
      throw Object.assign(new Error(`unknown setup argument ${a}`), { code: "E_USAGE" });
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

const args = parseArgs(argv);
const owner = args.owner ?? defaultOwner();
const dry = Boolean(args["dry-run"]);
const root = resolve(args.root ?? process.env.TURN_RECORD_ROOT ?? join(homedir(), ".turn-record"));

// The owner is interpolated into a persisted shell command, a launchd
// plist, and a systemd unit. Restricting it to the stream-id character
// class (which the store requires anyway) makes it shell-, XML-, and
// INI-safe in one check, BEFORE anything is written.
if (!/^[A-Za-z0-9._-]+$/.test(owner)) {
  warn(
    `invalid --owner ${JSON.stringify(owner)}: letters, digits, dot, underscore, hyphen only`,
  );
  throw Object.assign(new Error("invalid setup arguments"), { code: "E_USAGE" });
}

const hookCommand = `${shellWord(NODE)} ${shellWord(CAPTURE_HOOK)} --owner ${owner} --quiet --root ${shellWord(root)}`;
// The harness waits only for OS launch acknowledgement. Capture itself is
// detached and owns no harness pipes; these are launcher, not worker limits.
const HOOK = { type: "command", command: hookCommand, async: false, timeout: 10 };

log(`owner: ${owner}`);
log(`node:  ${NODE}`);

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
      warn(`SKIP ${path}: not valid JSON (${err.message}) — fix it and re-run setup`);
      continue;
    }
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
      warn(`SKIP ${path}: not a JSON object`);
      continue;
    }
    let changed = false;
    settings.hooks = settings.hooks ?? {};
    // Ours = a command whose STRUCTURE matches what setup generates:
    // "<node> <...>/capture.mjs ... --owner ... --quiet ...", or the hook
    // entry capture-hook.mjs in place of capture.mjs. Matching by
    // shape rather than this install's absolute path means a moved install
    // (npm upgrade, checkout -> global) updates the old hook in place
    // instead of stacking a second one. The structural requirements (script
    // is the second token and ends in /capture.mjs or /capture-hook.mjs; both flags present as
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
    for (const event of ["Stop", "SessionEnd"]) {
      const groups = (settings.hooks[event] = settings.hooks[event] ?? []);
      let found = false;
      // Every hook that is ours gets the current command/scheduling fields; none is removed,
      // two in one event included: the shape is not proof of ownership.
      for (const group of groups) {
        for (const hook of group.hooks ?? []) {
          if (!isCaptureHook(hook)) continue;
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
// Once setup starts changing things it ends with one setup summary: fixed
// labels, one item per line, the same order on every run, so a nonzero exit
// never reads as "nothing happened". It is held as one value.
const oneLine = text => String(text).replace(/\s*[\r\n]+\s*/g, " ");
const rerun = `${SETUP_COMMAND} --owner ${shellWord(owner)} --root ${shellWord(root)}${args["no-hooks"] ? " --no-hooks" : ""}${args["replace-service"] ? " --replace-service" : ""}`;
const summary = { rootRegistration: deploymentRequest === undefined ? "not requested" : "not changed", rootChanges: null, warnings: [], hooks: [], firstPass: "not run", service: "not changed", serviceChanges: [], remedy: "none" };
function printSummary(failed) {
  log(["setup summary:", `  status: ${failed ? "incomplete (exit 1)" : "complete"}`,
    ...(deploymentRequest !== undefined ? [`  root registration: ${summary.rootRegistration}`] : []),
    ...summary.warnings.map(w => `  root warning: ${w.configuration}, ${w.selector}: ${w.reason}. ${w.remedy}`),
    ...(summary.hooks.length ? summary.hooks : ["none"]).map(path => `  hooks written: ${path}`),
    `  first capture pass: ${summary.firstPass}`, `  service: ${summary.service}`,
    // What a failed service apply had already changed, in order.
    ...summary.serviceChanges.map(change => `  service changed: ${oneLine(change)}`), `  remedy: ${summary.remedy}`].join("\n"));
}
let captureStarted = false, changing = false, serviceFailure = null, failure = null;
try {
  const registration = deploymentRequest === undefined ? null : preflightCaptureRoots(root, deploymentRequest);
  if (registration) summary.warnings = registration.warnings;
  const hooks = args["no-hooks"] ? [] : prepareHooks();
  const plan = captureDefaultRootPlan({ home: homedir(), cwd: process.cwd(), env: process.env });
  // Every target and applicable manager is inspected before hook/service or
  // capture mutations. --no-service never even reads named service files.
  let service = null;
  if (!args["no-service"]) {
    if (["darwin", "linux"].includes(platform())) service = preflightCaptureService({ platform: platform(), node: NODE,
      request: { root, owner, plan }, setupCommand: SETUP_COMMAND, dry, replace: Boolean(args["replace-service"]), noHooks: Boolean(args["no-hooks"]) });
    else {
      log(`service: no service template for ${platform()}; run this in the background yourself:\n` +
        `  ${shellWord(NODE)} ${shellWord(CAPTURE)} --watch --owner ${owner} --root ${shellWord(root)}`);
      summary.service = `no service template for ${platform()}`;
    }
  } else summary.service = "skipped (--no-service)";
  if (!dry) loadIgnore(root);
  const createdParents = new Map();
  for (const hook of hooks) recheckCaptureSetup(hook.snapshot, createdParents);
  // Every target has passed preflight. A busy registry lock refuses before
  // independent hook/service/capture mutation; publication precedes all three.
  if (registration) {
    if (dry) {
      summary.rootRegistration = registration.changed ? "would refresh" : "unchanged";
      summary.rootChanges = { changed: registration.changed, roots: registration.value.roots, retiredRoots: registration.retiredRoots };
    } else {
      changing = true;
      try {
        summary.rootChanges = applyCaptureRoots(registration, { entry: captureCommandEntry(), createdParents });
        summary.rootRegistration = summary.rootChanges.changed ? "refreshed" : "unchanged";
      } catch (err) {
        summary.rootRegistration = err.published ? "publication may have occurred; durability not established" : "refused";
        if (err.applied?.length) summary.rootRegistration += `; partial initialization: ${err.applied.map(oneLine).join('; ')}`;
        throw err;
      }
    }
  }
  changing = !dry;
  // A service failure after preflight leaves hooks and the bounded first pass
  // to run: capture is never skipped for it, and the exit still reports it.
  if (service) {
    try { applyCaptureService(service, createdParents); summary.service = "scheduled"; }
    catch (error) {
      if (dry) throw error;
      serviceFailure = error; summary.service = `failed: ${oneLine(error.message)}`; summary.serviceChanges = error.applied ?? [];
      warn(`setup: service failed: ${error.message}`);
    }
  }
  for (const { snapshot, contents } of hooks) {
    if (!contents) log(`hooks: ${snapshot.path} already installed`);
    else if (dry) log(`hooks: would install Stop+SessionEnd capture in ${snapshot.path}`);
    else {
      try { writeCaptureSetup(snapshot, contents, createdParents); }
      catch (error) {
        if (error.published) summary.hooks.push(`${snapshot.path} (publication may have occurred at ${oneLine(error.stage)}; durability was not established)`);
        throw error;
      }
      summary.hooks.push(snapshot.path); log(`hooks: installed Stop+SessionEnd capture in ${snapshot.path}`);
    }
  }
  if (dry) log("dry run: no first capture pass");
  else {
    log("running first capture pass (the initial one can take minutes)...");
    captureStarted = true;
    try {
      const pass = await captureCommandPass(root, { owner, plan, indexEnabled: true, trigger: "setup", retrySetAside: false }, { entry: captureCommandEntry(), log, error: warn });
      summary.firstPass = pass.skipped ? "skipped: another pass holds the record root" : `appended ${pass.appended}, pending ${pass.pending ? "yes" : "no"}`;
    } catch (err) {
      if (err.code !== 'E_CAPTURE_ROOTS_COVERAGE') { summary.firstPass = `failed: ${oneLine(err.message)}`; throw err; }
      summary.firstPass = 'root coverage incomplete; healthy independent work processed';
      if (!summary.warnings.length) summary.warnings.push({ configuration: '(deployment)', selector: 'capture-roots', reason: 'unreadable',
        remedy: 'Inspect capture --health --json; restore root access or refresh the affected deployment with oats setup.' });
    }
  }
  if (serviceFailure) { summary.remedy = `rerun ${rerun}`; exitCode = 1; }
} catch (err) {
  failure = err;
  if (summary.rootRegistration === "not changed") summary.rootRegistration = "refused during preflight";
  if (err.rootWarnings) summary.warnings = err.rootWarnings;
  warn(err instanceof IgnoreError ? err.message : `${captureStarted ? "capture pass" : "setup"} failed: ${err.message}`);
  if (changing) summary.remedy = captureStarted && !serviceFailure ? `inspect ${captureRemedyCommand(Boolean(node ?? handedNode()))} capture --health --json, then rerun ${rerun}` : `rerun ${rerun}`;
  else if (!captureStarted && !(err instanceof IgnoreError) && !err.code?.startsWith("E_CAPTURE_SERVICE_"))
    warn(`setup recovery: inspect the reported files/manager state, then retry ${rerun}; use --no-service to preserve the existing manager service`);
  exitCode = 1;
}
if (changing || deploymentRequest !== undefined) printSummary(Boolean(exitCode));
if (serviceFailure && !failure) failure = serviceFailure;
return { schemaVersion: 1, ok: exitCode === 0, exitCode, summary, warnings: summary.warnings,
  ...(failure ? { error: { code: failure.code ?? 'E_CAPTURE_SETUP_FAILED', message: failure.message } } : {}) };
}
