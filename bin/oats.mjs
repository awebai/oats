#!/usr/bin/env node
/**
 * oats — the OATS command line.
 *
 *   oats doctor [dir] [--json]              show the resolved config with origins
 *   oats onboard [<dir>] --workspace <ref>  realize a workspace here (oats-local.yaml +
 *                                          agents/), then sync
 *   oats sync [--dir <d>] [--json]          discover the workspace, confirm membership,
 *                                          resolve packages, approve, write the lock
 *   oats package add|remove ...            edit `packages:` in the workspace file
 *   oats workspace status                  membership table, packages, approval
 *   oats capabilities | oats souls         every visible item of the workspace
 *
 * Workspace model v2 (docs/design/2026-09-23-workspace-module-contracts.md §6):
 * nothing is installed. `oats-local.yaml` names the workspace, `oats sync`
 * observes it over Git remotes and writes `oats-lock.json` (lockfileVersion 3).
 * `init` / `use` / `install` / `restore` / `list` / `catalog` / `remove` /
 * `migrate` / `trust` / `inject` are gone with the installed-capability tier.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readSync, realpathSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  LAYERS, WORK_MODES, LEGACY_HOME_CAPABILITIES_DIR, OATS_VERSION, OAS_SCOPE_REMEDY, RETIRED_CAPABILITIES, detectOasScopes, retiredCapabilityReason, configChain, configCapabilityEntries, manifestOperations,
  capabilityManifests, capabilityManifest, capabilityMissingRequires, capabilityTrust, capabilityExecutablePath, activateCapturedScaffold, loadCapturedDispatch, inspectPortableOnboarding, prepareCapturedComposition, resolveCapturedHelper, capturedNativeSessionAvailability, scaffoldCapturedInstance, startCapturedInstanceSession, withCapturedBindingFile, withCapturedInvocationContextFile,
  readCapabilityLocks, admitCapturedAction, beginCapturedIntent, settleCapturedIntent, listInstalledPackages, readPackageLocks,
  officialPackageCatalog, describeOfficialCatalog, approveAvailableCapability,
  packageIntegrity, capabilityArtifactIntegrity, verifyCapabilityInstallation, installedCapabilityDir,
  resolveOatsConfig, resolveWorkMode, composeInstanceAgentsMd, parseYamlNested, assertSafeConfigValue, stripInternalAnnotations, withConfigFile, teamAgentRoots,
  findTeamAgent, findTeamInstance, findCapabilityAgent, findInstanceHome, findInstanceHomes, listCapabilityAgents, workspaceOf, stopInstanceSession, recomposeInstanceInstructions,
  ensureRoot, findRoot, findAgent, listAgents, listInstances, listAgentDefs, createAgent as coreCreateAgent,
  spawnInstance, spawnInstanceAsync, findModuleCapabilityAgent, capabilityAgentFromDir, retireInstance, inspectInstanceSession, inputInstanceSession, attachInstanceSession, startInstanceSession, upsertLocalAgent, defaultRepo, RELATIONS, validateLaunchConfig, resolveLaunchSelection, resolveLaunchExecutable, checkLaunchExecutable, missingLaunchEnvRefs, renderLaunchRecipe, describeLaunchCommand, redactLaunchRecipe, LAUNCH_RUNTIMES, LAUNCH_RECIPE_VERSION, parseLaunchCommand, resolveYolo, planLaunch, redactLaunchCommand, restartInstanceSession,
} from "../lib/core.mjs";
import {
  assertNoSymlinkedParents, writeFileAtomic,
  LOCK_FILE, readLock, writeLock, resolvePackages, approve as approvePackage, executablesDigest, readPackageTree,
  classifyPackageValue, manifestExecutables, parsePackageRequest,
} from "../lib/packages.mjs";
import { loadLocal, discoverWorkspace, validateWorkspace } from "../lib/workspace.mjs";
import * as remoteModule from "../lib/remote.mjs";
import { createInterface } from "node:readline/promises";
import YAML from "yaml";
import { attachArgv, checkRemote, forgetSnapshot, getServer, inspectRemote, startRemote, restartRemote, launchConfigRemote, scheduleRemote, listSnapshots, readServers, rosterGroups, routeCommand, targetOf, validateServer, writeServers, SERVERS_FILE } from "../lib/servers.mjs";
import { spawnSync as spawnSyncProc } from "node:child_process";
import { parseEnvelopeText, scheduleScopeOf, listSchedules, describe as describeSchedule, addSchedule, updateSchedule, setEnabled as setScheduleEnabled, removeSchedule, runNow as runScheduleNow, reconcile as reconcileSchedule, tickHost, tickWorkspace, registerWorkspace, unregisterWorkspace, readRegistry, schedulerStatus, saveWakeForHome, removeWakeForHome, wakeFromFlags, withHostLock, scheduleError, SCHEDULE_API } from "../lib/schedule.mjs";
import { hostUnitStatus, installHostUnit, uninstallHostUnit } from "../lib/schedule-host.mjs";
import { receiveAttachment, uploadAttachment, readStreamBounded, MAX_ATTACHMENT_BYTES } from "../lib/attachments.mjs";

import { capturedSelector } from "../lib/captured-selector.mjs";
import { inspectCapturedPiOutcome } from "../lib/captured-pi-host.mjs";
import { readCapturedResolution } from "../lib/captured-resolutions.mjs";
import { oatsError } from "../lib/errors.mjs";
import { canonicalJson } from "../lib/portable-values.mjs";
import { readPortablePreparationRequest } from "../lib/portable-onboarding-request.mjs";
import { portableScope } from "../lib/portable-state.mjs";
import { CAPTURED_OPERATION_TIMEOUT_MS, runCapturedOperationProcess } from "../lib/captured-operation-process.mjs";
import { approveCapturedCapability } from "../lib/artifact-approvals.mjs";
import { observeInstanceGit, diffInstanceFile } from "../lib/instance-git.mjs";
import { planStop, applyStop, planRetire, resolveInstance as resolveInstanceForCli } from "../lib/instance-lifecycle.mjs";
const await_import_lifecycle = () => ({ resolveInstance: resolveInstanceForCli });
import { readinessOf, policyOf } from "../lib/readiness.mjs";
import { readEvents } from "../lib/instance-events.mjs";

const args = process.argv.slice(2);
let cmd = args[0];
const HELP_WORDS = new Set(["help", "--help", "-h"]);
const KERNEL_COMMANDS = new Set(["prepare", "capture", "capabilities", "create", "doctor", "inspect", "instance", "operation", "package", "readiness", "soul", "souls", "launch-config", "experimental", "onboard", "pane", "recall", "retire", "root", "schedule", "server", "session", "setup", "spawn", "status", "sync", "type", "update", "version", "workspace"]);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : undefined;
};
function yoloFlag() {
  if (args.includes("--yolo") && args.includes("--no-yolo")) cmdFail("E_BAD_ARGS", "choose --yolo or --no-yolo, not both");
  return args.includes("--yolo") ? true : args.includes("--no-yolo") ? false : undefined;
}
function valueFlag(name) {
  const value = flag(name);
  if (value === true) cmdFail("E_BAD_ARGS", `--${name} needs a value`);
  return value;
}
const die = (msg) => { console.error(`oats: ${msg}`); process.exit(1); };
const cmdFail = (code, msg) => (JSON_MODE ? jsonFail(code, msg) : die(msg));
/** Resolve the --dir flag with central validation: a value-taking flag given
 * no value (flag() → true) is E_BAD_ARGS inside the JSON boundary, never an
 * uncaught resolve(true) TypeError (reviewer-6f0a3bd). */
function dirFlag() {
  const v = flag("dir");
  if (v === undefined) return resolve(process.cwd());
  if (v === true || !String(v).trim()) {
    const msg = "--dir needs a directory path";
    if (JSON_MODE) { console.log(JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_BAD_ARGS", message: msg } })); process.exit(1); }
    die(msg);
  }
  return resolve(String(v));
}
// Desktop CLI API v1 (JSON mode): every `--json` failure is EXACTLY ONE JSON
// object on stdout — { schemaVersion: 1, ok: false, error: { code, message } } —
// with a nonzero exit; progress prose goes to stderr, never stdout.
const JSON_MODE = args.includes("--json");
// Canonical absolute path of this CLI executable — the versioned OATS_CLI_BIN
// env contract for dispatched package commands (never resolved via PATH).
const CLI_BIN = realpathSync(fileURLToPath(import.meta.url));
const jsonFail = (code, message, details) => { console.log(JSON.stringify({ schemaVersion: 1, ok: false, error: { code, message: String(message), ...(details !== undefined ? { details } : {}) } })); process.exit(1); };
const jsonOk = (result) => { console.log(JSON.stringify({ schemaVersion: 1, ok: true, result })); };

function inspectOnboardingCmd() {
  const fail = (code, message) => JSON_MODE ? jsonFail(code, message) : die(message);
  const values = new Map();
  for (let index = 1; index < args.length; index++) {
    if (args[index] === "--json") continue;
    const key = args[index];
    if (!["--request", "--emit-prepare-request"].includes(key) || values.has(key) || !args[index + 1] || args[index + 1].startsWith("--")) fail("E_BAD_ARGS", "source inspection accepts one --request <absolute-json>, optional --emit-prepare-request <new-absolute-json>, and --json");
    values.set(key, args[++index]);
  }
  try {
    const output = values.get("--emit-prepare-request");
    let parent;
    const checkOutput = () => {
      if (!isAbsolute(output) || resolve(output) !== output || output.includes("\0")) throw oatsError("E_BAD_ARGS", "prepare-request output needs a normalized absolute path");
      let stat;
      try {
        stat = lstatSync(dirname(output));
        if (!stat.isDirectory() || realpathSync(dirname(output)) !== dirname(output)) throw new Error();
      } catch { throw oatsError("E_BAD_ARGS", "prepare-request output parent must be an existing real directory"); }
      if (parent && (parent.dev !== stat.dev || parent.ino !== stat.ino)) throw oatsError("selection-changed", "prepare-request output parent changed during inspection");
      try { lstatSync(output); }
      catch (error) { if (error.code === "ENOENT") return stat; throw oatsError("E_BAD_ARGS", "prepare-request output could not be checked"); }
      throw oatsError("E_BAD_ARGS", "prepare-request output already exists; choose a new file (nothing overwritten)");
    };
    if (output !== undefined) parent = checkOutput();
    const input = readPortablePreparationRequest({ file: values.get("--request") });
    const { prepareRequest, ...view } = inspectPortableOnboarding(input, { includePrepareRequest: output !== undefined });
    let result = view;
    if (output !== undefined) {
      checkOutput();
      try { writeFileSync(output, canonicalJson(prepareRequest) + "\n", { flag: "wx", mode: 0o600 }); }
      catch { throw oatsError("E_BAD_ARGS", "prepare-request output could not be created exclusively; no existing file was overwritten"); }
      const deployment = view.deployment.deployment.path;
      result = { ...view, prepareRequestFile: output, effects: { ...view.effects, requestFileWrite: true,
        deploymentWrites: output === deployment || output.startsWith(deployment + sep) } };
    }
    if (JSON_MODE) jsonOk(result); else console.log(JSON.stringify(result, null, 2));
  } catch (error) { fail(error.code || "E_INSPECT_FAILED", error.message); }
}

function prepareCmd() {
  const fail = (code, message, details) => JSON_MODE ? jsonFail(code, message, details) : die(message);
  const values = new Map(), allowed = new Set(["request", "dir", "source", "revision", "export", "alias", "workspace", "workspace-revision", "work"]);
  for (let index = 1; index < args.length; index++) {
    if (args[index] === "--json") continue;
    const key = args[index].startsWith("--") ? args[index].slice(2) : "";
    if (!allowed.has(key) || values.has(key) || !args[index + 1] || args[index + 1].startsWith("--")) fail("E_BAD_ARGS", "prepare needs unique named source/context arguments; use prepare --help");
    values.set(key, args[++index]);
  }
  try {
    let input;
    if (values.has("request")) {
      // The shared leaf owns request bytes/exclusivity; this router alone owns
      // argv and has already refused explicit captured selectors.
      input = readPortablePreparationRequest({ file: values.get("request"),
        inputFlags: Object.fromEntries([...values].filter(([key]) => key !== "request")) });
    } else {
      const deployment = values.get("dir"), alias = values.get("alias"), source = values.get("source");
      if (!deployment || !isAbsolute(deployment) || !alias) fail("E_BAD_ARGS", "prepare needs --dir <absolute deployment> and --alias <name>");
      if (source ? !values.get("revision") || !values.get("export") : !values.get("workspace") || values.has("revision") || values.has("export")) fail("E_BAD_ARGS", "choose a complete source/revision/export reference or a workspace-advertised alias");
      if (values.has("workspace-revision") && !values.has("workspace")) fail("E_BAD_ARGS", "--workspace-revision requires --workspace");
      const origin = { kind: "operator", document: { kind: "operator", id: "oats-prepare" }, pointer: "/source" };
      input = { deployment, source: source ? { source, revision: values.get("revision"), soul: values.get("export"), alias } : alias, origin,
        ...(values.has("work") ? { mode: values.get("work") } : {}),
        ...(values.has("workspace") ? { workspace: { source: values.get("workspace"), origin: { ...origin, pointer: "/workspace" },
          ...(values.has("workspace-revision") ? { revision: values.get("workspace-revision") } : {}) } } : {}) };
    }
    // Pass the whole request to the one public validator/resolver. Unknown
    // fields are refused there, never filtered or filled from ambient state.
    const result = prepareCapturedComposition(input);
    if (!result.resolution) {
      const summary = "preparation is incomplete; no executable resolution was published";
      const reasons = (result.problems ?? []).filter(p => p.key !== undefined || (p.slot && p.capability))
        .map(p => `[${p.slot && p.capability ? `${p.capability}/${p.slot}` : p.code}] ${p.key === undefined ? "" : `${JSON.stringify(p.key)}: `}${p.message}`);
      fail("needs-configuration", JSON_MODE ? summary : [summary, ...reasons].join("\n"), result);
    }
    if (JSON_MODE) jsonOk(result); else console.log(JSON.stringify(result, null, 2));
  } catch (error) { fail(error.code || "E_PREPARE_FAILED", error.message); }
}

/** Run one provider operation from immutable captured authority. A home is an
 * explicit target only: its stored binding must name this exact record. */
function capturedOperation(selector, load, bail) {
  if (args[1] !== "run") bail("E_USAGE", "usage: oats operation run <layer>:<name> --deployment <abs> --resolution <id> [--home <abs>] [--arg k=v ...] [--retry-intent <saved-id>] [--json]");
  const address = args[2], match = typeof address === "string" ? OPERATION_ADDRESS_RE.exec(address) : null;
  if (!match) bail("E_BAD_ARGS", `operation address must be <layer>:<name> with layer one of ${LAYERS.join(", ")} (got ${JSON.stringify(address)})`);
  const [, slot, name] = match, given = Object.create(null);
  let home, retryExecutionId;
  for (let index = 3; index < args.length; index++) {
    const token = args[index];
    if (token === "--json") continue;
    if (token === "--home") {
      const value = args[++index];
      if (home !== undefined || !value || value.startsWith("--") || !isAbsolute(value)) bail("E_BAD_ARGS", "--home needs one absolute instance home");
      home = resolve(value); continue;
    }
    if (token === "--retry-intent") {
      const value = args[++index];
      if (retryExecutionId !== undefined || !value || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) bail("E_BAD_ARGS", "--retry-intent requires one saved executionId");
      retryExecutionId = value; continue;
    }
    if (token === "--arg") {
      const value = args[++index], eq = value?.indexOf("=") ?? -1;
      if (eq < 1) bail("E_BAD_ARGS", "--arg expects name=value");
      const key = value.slice(0, eq);
      if (Object.hasOwn(given, key)) bail("E_BAD_ARGS", `duplicate operation arg ${JSON.stringify(key)}`);
      given[key] = value.slice(eq + 1); continue;
    }
    bail("E_BAD_ARGS", `unsupported captured operation argument ${JSON.stringify(token)}`);
  }
  let meta;
  if (home) {
    const metaFile = join(home, "instance.json");
    if (!existsSync(metaFile)) bail("E_SESSION_UNKNOWN", `${home} is not an OATS instance home (no instance.json)`);
    try { meta = JSON.parse(readFileSync(metaFile, "utf8")); } catch (error) { bail("E_SESSION_UNKNOWN", `${metaFile}: ${error.message}`); }
    if (!meta || typeof meta !== "object" || Array.isArray(meta) || typeof meta.instance !== "string" || !meta.instance) bail("E_SESSION_UNKNOWN", `${metaFile}: invalid instance metadata`);
    const binding = meta.executionBinding;
    if (!binding) bail("migration-required", `${home} has no captured executionBinding; current configuration was not used`);
    if (binding.schemaVersion !== 1 || typeof binding.deployment !== "string" || !isAbsolute(binding.deployment)
      || realOrResolved(binding.deployment) !== realOrResolved(selector.deployment)
      || binding.resolution?.schemaVersion !== 1 || binding.resolution.id !== selector.resolution.id) {
      bail("E_HOME_MISMATCH", `${home} is not bound to captured resolution ${selector.resolution.id} in ${selector.deployment}`);
    }
  }
  // Inspect is static: validate target and arguments before the action load runs
  // the provider's mutable readiness check.
  const inspected = load({ kind: "inspect" }), providerId = inspected.record.bindings[slot]?.capability;
  const provider = providerId ? inspected.manifests.get(providerId) : undefined;
  if (!provider) bail("capability-not-selected", `no captured ${slot} provider is selected`);
  const operation = manifestOperations(provider).find((entry) => entry.name === name);
  if (!operation) bail("operation-not-found", "captured provider does not declare this operation");
  if (operation.context === "home" && !meta) bail("E_OPERATION_UNAVAILABLE", `${address} runs in an instance home; pass --home <abs>`);
  if (operation.context === "scope" && meta) bail("E_BAD_ARGS", `${address} is a scope operation and does not accept --home`);
  const declared = new Map(operation.args.map((entry) => [entry.name, entry]));
  for (const key of Object.keys(given)) if (!declared.has(key)) bail("E_BAD_ARGS", `${address} takes no arg ${JSON.stringify(key)} (declared: ${[...declared.keys()].join(", ") || "none"})`);
  for (const entry of operation.args) if (entry.required && given[entry.name] === undefined) bail("E_BAD_ARGS", `${address} needs --arg ${entry.name}=<value>: ${entry.description || "required"}`);
  const action = { kind: "operation", slot, name };
  const argFlags = operation.args.flatMap((entry) => given[entry.name] === undefined ? [] : [entry.flag, given[entry.name]]), cwd = home || selector.deployment;
  if (operation.kind === "action" && !home) bail("admission-required", "scope mutation has no qualified incarnation/admission path; use an instance-scoped operation");
  if (retryExecutionId !== undefined && operation.kind !== "action") bail("E_BAD_ARGS", "read-only operations do not retry mutation intents");
  const admission = operation.kind === "action" ? admitCapturedAction({ deployment: selector.deployment, resolution: selector.resolution, home, action, input: { arguments: argFlags },
    ...(retryExecutionId !== undefined ? { retryExecutionId } : {}) }) : null;
  let settlement;
  const admittedBail = (code, message, details) => bail(code, message, { ...details, ...(admission ? { intent: admission.intent } : {}),
    ...(settlement ? { settlement, unconfirmed: settlement.state === "unconfirmed" } : {}) });
  if (admission?.replayed) {
    settlement = { state: "completed", receipt: admission.receipt };
    if (!admission.replayable) admittedBail("needs-configuration", "completed operation cannot replay its retained outcome");
    finishOperation({ r: { status: 0, stdout: JSON.stringify(admission.receipt) }, bail: admittedBail, address, provider, op: operation, argFlags, cwd, home, meta, intent: admission.intent }); return;
  }
  let loaded;
  try { loaded = load(action, { invocationTarget: meta ? { home, work: join(home, "work"), name: meta.instance, agent: meta.agent } : null,
    ...(admission ? { intent: admission.intent, priorReceipt: admission.receipt } : {}) }); }
  catch (error) {
    if (admission) {
      settleCapturedIntent({ deployment: selector.deployment, home, intent: admission.intent, action, state: "blocked", receipt: admission.receipt });
      settlement = { state: "blocked", receipt: admission.receipt };
    }
    admittedBail(error.code || "provider-unavailable", error.message);
  }
  const { capability, executable } = loaded;
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("OATS_") || key.startsWith("PI_AGENT_") || key === "PI_AGENTS_ROOT") delete env[key];
  Object.assign(env, {
    OATS_DEPLOYMENT: selector.deployment, OATS_RESOLUTION: selector.resolution.id,
    OATS_CAPABILITY: capability.id, OATS_CAPABILITY_ROOT: capability.manifest._dir,
    OATS_SETTINGS: JSON.stringify(capability.settings), OATS_CLI_BIN: CLI_BIN,
    OATS_OPERATION: address, OATS_CONTEXT: selector.deployment, OATS_LEVEL: selector.deployment,
    OATS_WORKSPACE: selector.deployment,
  });
  if (meta) Object.assign(env, { OATS_INSTANCE: meta.instance, OATS_INSTANCE_HOME: home, OATS_HOME: home,
    PI_AGENT_INSTANCE: meta.instance, PI_AGENT_HOME: home, ...(meta.agent ? { OATS_AGENT: meta.agent } : {}) });
  const invocation = loaded.invocation;
  let child, cleanupError, started = false;
  try {
    child = withCapturedInvocationContextFile(invocation, contextEnv => withCapturedBindingFile(loaded, bindingEnv => {
      if (admission) { beginCapturedIntent({ deployment: selector.deployment, home, intent: admission.intent, action }); started = true; }
      return runCapturedOperationProcess({ file: executable.file, args: [...executable.args, ...argFlags, "--json"], cwd, env: { ...env, ...contextEnv, ...bindingEnv } });
    }));
  } catch (error) {
    if (!error?.invocationCompleted) {
      if (admission) {
        settleCapturedIntent({ deployment: selector.deployment, home, intent: admission.intent, action, state: started ? "unconfirmed" : "blocked", receipt: admission.receipt });
        settlement = { state: started ? "unconfirmed" : "blocked", receipt: admission.receipt };
      }
      admittedBail(error.code || "E_OPERATION_RESULT", error.message, { unconfirmed: started });
    }
    child = error.invocationResult; cleanupError = error;
  }
  if (admission) {
    let envelope; try { envelope = JSON.parse(String(child.stdout || "").trim()); } catch { /* unconfirmed below */ }
    const completed = !cleanupError && !child.error && child.status === 0 && envelope?.schemaVersion === 1 && envelope.ok === true;
    const state = completed ? "completed" : "unconfirmed", receipt = envelope ?? parseEnvelopeText(String(child.stdout || "")) ?? admission.receipt;
    try {
      settleCapturedIntent({ deployment: selector.deployment, home, intent: admission.intent, action, state, receipt, replayable: completed });
      settlement = { state, receipt };
    }
    catch (error) { admittedBail("E_OPERATION_RESULT", "operation ran but outcome custody could not be confirmed", { unconfirmed: true, envelope, custody: { code: error.code, message: error.message } }); }
  }
  finishOperation({ r: child, bail: admittedBail, address, provider: capability.manifest, op: operation, argFlags, cwd, home, meta, cleanupError, settlement, ...(admission ? { intent: admission.intent } : {}) });
}

/** Fresh explicit captured scaffold + spawn hooks. Placement is supplied by
 * the operator; launch and non-directory work remain unsupported. */
function capturedSpawn(selector, load, bail) {
  const subject = args[1]; let home; let noLaunch = false;
  if (!subject || subject.startsWith("-")) bail("E_BAD_ARGS", "captured spawn needs the retained subject name");
  for (let index = 2; index < args.length; index++) {
    const token = args[index];
    if (token === "--json") continue;
    if (token === "--no-launch") { if (noLaunch) bail("E_BAD_ARGS", "duplicate --no-launch"); noLaunch = true; continue; }
    if (token === "--home") {
      const value = args[++index];
      if (home !== undefined || !value || value.startsWith("--") || !isAbsolute(value)) bail("E_BAD_ARGS", "--home needs one absolute new instance home");
      home = resolve(value); continue;
    }
    bail("E_BAD_ARGS", `unsupported captured spawn argument ${JSON.stringify(token)}`);
  }
  if (!home || !noLaunch) bail("E_BAD_ARGS", "captured spawn currently requires --home <absolute new home> and --no-launch");
  const inspected = load({ kind: "inspect" }), expected = inspected.record.subject.kind === "persistent" ? inspected.record.subject.soul.alias : inspected.record.subject.name;
  if (subject !== expected) bail("E_HOME_MISMATCH", `captured resolution subject is ${expected}, not ${subject}`);
  const scaffold = scaffoldCapturedInstance({ deployment: selector.deployment, resolution: selector.resolution, home, instance: basename(home) });
  let activated;
  try {
    activated = activateCapturedScaffold({ deployment: selector.deployment, resolution: selector.resolution, home,
      extraEnv: process.env.OATS_HOME_DIR ? { OATS_HOME_DIR: process.env.OATS_HOME_DIR } : {} });
  } catch (error) {
    if (error?.home) bail(error.code || "E_SPAWN_FAILED", error.message, { home: error.home, cleanupRequired: true, failures: error.provenance || [],
      ...(error.capturedCustody ? { unconfirmed: true, custody: error.capturedCustody } : {}) });
    throw error;
  }
  const result = { ...scaffold, hooksPending: activated.hooksPending, cleanupRequired: activated.cleanupRequired, launchPending: true,
    hookIntents: activated.hooks.intents, hookOrder: activated.hooks.order, warnings: activated.hooks.warnings };
  if (JSON_MODE) jsonOk(result); else console.log(`Scaffolded ${result.instance} at ${result.home}; ${result.hooksPending ? "captured hook custody requires retry/reconciliation" : "captured hooks complete"}, launch pending`);
}

/** Native continuation of an already owned captured home. A helper selector is
 * an exact edge from the SOURCE record, not a name/current-config resolver. */
function capturedSession(selector, bail) {
  const inspecting = args[1] === "inspect";
  if (!["start", "restart", "inspect"].includes(args[1])) bail("unsupported-action", "captured session supports start/restart or explicit Pi outcome inspect; no current-context fallback was used");
  const values = new Map(), allowed = new Set(inspecting ? ["home", "helper", "native-record"] : ["home", "helper", "request", "retry-intent"]);
  for (let index = 2; index < args.length; index++) {
    if (args[index] === "--json") continue;
    const key = args[index].startsWith("--") ? args[index].slice(2) : "", value = args[index + 1];
    if (!allowed.has(key) || values.has(key) || !value || value.startsWith("--")) bail("E_BAD_ARGS", "captured session needs unique named home/helper/request/retry arguments");
    values.set(key, value); index++;
  }
  const home = values.get("home"), retry = values.get("retry-intent");
  if (!home || !isAbsolute(home) || resolve(home) !== home || home.includes("\0")) bail("E_BAD_ARGS", "captured session needs a normalized absolute --home");
  if (retry !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(retry)) bail("E_BAD_ARGS", "--retry-intent requires one saved executionId");
  if (inspecting && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(values.get("native-record") ?? "")) bail("E_BAD_ARGS", "captured Pi outcome inspect requires one explicit --native-record UUID");
  const sourceExecutionBinding = { schemaVersion: 1, deployment: portableScope(selector.deployment), resolution: selector.resolution };
  // Pure retained-subject check, before request files, provider or native calls.
  // Dedicated helper IDs remain valid for scaffolding, not edge-less dispatch.
  if (!values.has("helper") && readCapturedResolution(sourceExecutionBinding.deployment, sourceExecutionBinding.resolution).subject.kind === "helper") {
    bail("helper-not-selected", "captured helper session needs SOURCE selectors plus --helper EXACT_SOURCE_HELPER_KEY");
  }
  // Reuse the same bounded strict object-file transport. Preparation and native
  // request schemas remain separate; reject unknown fields before projection.
  let request = {};
  if (values.has("request")) {
    const input = readPortablePreparationRequest({ file: values.get("request") });
    if (input.schemaVersion !== 1 || Object.keys(input).some(key => !["schemaVersion", "backend", "task", "stopGraceMs"].includes(key))) bail("E_BAD_ARGS", "native request must be version1 with only backend/task/stopGraceMs");
    if (Object.hasOwn(input, "backend") && (!input.backend || typeof input.backend !== "object" || Array.isArray(input.backend))) bail("E_BAD_ARGS", "a supplied native backend must be an explicit object, not omission");
    const { schemaVersion, ...fields } = input; request = fields;
  }
  const helperSelection = values.has("helper") ? resolveCapturedHelper({ executionBinding: sourceExecutionBinding, helper: values.get("helper") }) : null;
  const executionBinding = helperSelection?.executionBinding ?? sourceExecutionBinding;
  try {
    if (inspecting) {
      const outcome = inspectCapturedPiOutcome(home, { ...executionBinding, nativeRecordId: values.get("native-record") });
      const result = { outcome, executionBinding, ...(helperSelection ? { sourceExecutionBinding: helperSelection.sourceExecutionBinding, helper: helperSelection.helper } : {}) };
      if (JSON_MODE) jsonOk(result); else console.log(JSON.stringify(result, null, 2));
      return;
    }
    const native = startCapturedInstanceSession(home, { ...request, deployment: executionBinding.deployment, resolution: executionBinding.resolution,
      restart: args[1] === "restart", ...(retry !== undefined ? { retryExecutionId: retry } : {}) });
    const result = { ...native, executionBinding, ...(helperSelection ? { sourceExecutionBinding: helperSelection.sourceExecutionBinding, helper: helperSelection.helper } : {}) };
    if (JSON_MODE) jsonOk(result); else console.log(`${result.replayed ? "Replayed captured dispatch receipt for" : "Dispatched captured native session for"} ${home}`);
  } catch (error) {
    bail(error.code || "E_SESSION_START_FAILED", error.message, { home: error.home ?? home, executionBinding,
      ...(helperSelection ? { sourceExecutionBinding: helperSelection.sourceExecutionBinding, helper: helperSelection.helper } : {}),
      ...(error.capturedCustody ? { custody: error.capturedCustody } : {}),
      ...(error.nativeCustody ? { unconfirmed: true, nativeCustody: error.nativeCustody } : {}) });
  }
}

/** Exact-selector dispatch enters before any current-context resolver. Its
 * child receives the same selector, never an invoking agent's ambient identity. */
function capturedCommand(selector) {
  const fail = (code, message, details) => JSON_MODE ? jsonFail(code, message, details) : die(message);
  try {
    const end = args.indexOf("--"), head = end < 0 ? args : args.slice(0, end);
    const permitsHome = cmd === "operation" || cmd === "spawn" || cmd === "session";
    const forbiddenContext = permitsHome ? ["--dir", "--server", "--soul", "--agents-root"] : ["--dir", "--home", "--server", "--soul", "--agents-root"];
    if (head.some((arg) => forbiddenContext.includes(arg.split("=")[0]))) {
      fail("E_BAD_ARGS", "captured selectors cannot be mixed with current-context selectors");
    }
    if (selector.artifactSet !== undefined) {
      if (cmd !== "trust" || !args[1] || args[1].startsWith("-") || args.slice(2).some((arg) => arg !== "--json")) fail("E_BAD_ARGS", "artifact-set selectors support only explicit trust of one capability");
      const result = approveAvailableCapability(selector.deployment, selector.artifactSet, args[1], {
        kind: "operator", document: { kind: "operator", id: "oats-trust-artifact-set" }, pointer: "/capability",
      });
      if (JSON_MODE) jsonOk(result); else console.log(`${args[1]}: ${result.status}`);
      return;
    }
    const target = { deployment: selector.deployment, resolution: selector.resolution };
    const load = (action, extra = {}) => loadCapturedDispatch({ ...target, action, ...extra });
    if (cmd === "inspect") {
      let helperKey;
      for (let index = 1; index < args.length; index++) {
        if (["--json", "--composition"].includes(args[index])) continue;
        if (args[index] !== "--helper" || helperKey !== undefined || !args[index + 1] || args[index + 1].startsWith("--")) fail("E_BAD_ARGS", "captured inspect accepts --json, --composition and one --helper <exact-map-key>");
        helperKey = args[++index];
      }
      const helperSelection = helperKey === undefined ? null : resolveCapturedHelper({ executionBinding: { schemaVersion: 1, ...target }, helper: helperKey });
      const selected = helperSelection?.executionBinding ?? target;
      const loaded = loadCapturedDispatch({ deployment: selected.deployment, resolution: selected.resolution, action: { kind: args.includes("--composition") ? "compose" : "inspect" } });
      const result = { resolution: loaded.resolution, capture: loaded.record.capture, nativeSession: capturedNativeSessionAvailability(),
        launchSelection: loaded.record.dispatch.launch === null ? null : {
          runtime: loaded.record.dispatch.launch.runtime, model: loaded.record.dispatch.launch.model,
        },
        ...(helperSelection ? { helperSelection } : {}),
        capabilities: [...loaded.capabilities.values()].map(({ id, manifest }) => ({ id, version: manifest.version,
          approval: loaded.approvals.find((entry) => entry.artifact.capability === id).status })),
        helpers: Object.entries(loaded.record.helpers).map(([key, resolution]) => ({ key, resolution })),
        hasComposition: !!loaded.record.dispatch.composition,
        ...(loaded.composition ? { composition: loaded.composition } : {}) };
      if (JSON_MODE) jsonOk(result); else console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (cmd === "trust") {
      if (!args[1] || args[1].startsWith("-") || args.slice(2).some((arg) => arg !== "--json")) fail("E_BAD_ARGS", "captured trust needs one capability ID");
      load({ kind: "inspect" }); // complete manifest validation before approval
      const result = approveCapturedCapability(selector.deployment, selector.resolution, args[1], {
        kind: "operator", document: { kind: "operator", id: "oats-trust" }, pointer: "/capability",
      });
      if (JSON_MODE) jsonOk(result); else console.log(`${args[1]}: ${result.status}`);
      return;
    }
    if (cmd === "operation") { capturedOperation(selector, load, fail); return; }
    if (cmd === "spawn") { capturedSpawn(selector, load, fail); return; }
    if (cmd === "session") { capturedSession(selector, fail); return; }
    if (!cmd || cmd.startsWith("-") || KERNEL_COMMANDS.has(cmd)) fail("unsupported-action", "this kernel command has not yet adopted captured selectors; no current-context fallback was used");
    if (!args[1] || args[1] === "--json" || head.some((arg) => HELP_WORDS.has(arg))) {
      const loaded = load({ kind: "inspect" });
      const matches = [...loaded.manifests.values()].filter((manifest) => manifest.command === cmd);
      if (matches.length !== 1) fail("capability-not-selected", "captured command namespace is absent or ambiguous");
      const result = { capability: matches[0].capability, commands: Object.keys(matches[0].commands || {}), help: "manifest only; no executable ran" };
      if (JSON_MODE) jsonOk(result); else console.log(JSON.stringify(result, null, 2));
      return;
    }
    const loaded = load({ kind: "command", namespace: cmd, name: args[1] });
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("OATS_") || key.startsWith("PI_AGENT_") || key === "PI_AGENTS_ROOT") delete env[key];
    Object.assign(env, { OATS_DEPLOYMENT: selector.deployment, OATS_RESOLUTION: selector.resolution.id,
      OATS_CAPABILITY: loaded.capability.id, OATS_CAPABILITY_ROOT: loaded.capability.manifest._dir,
      OATS_SETTINGS: JSON.stringify(loaded.capability.settings),
      OATS_CLI_BIN: CLI_BIN, OATS_CONTEXT: selector.deployment, OATS_LEVEL: selector.deployment });
    const forwarded = args.slice(2); if (forwarded[0] === "--") forwarded.shift();
    const child = withCapturedInvocationContextFile(loaded.invocation, contextEnv => withCapturedBindingFile(loaded, bindingEnv => spawnSync(process.execPath, [loaded.executable.file, ...loaded.executable.args, ...forwarded], {
      cwd: selector.deployment, env: { ...env, ...contextEnv, ...bindingEnv }, stdio: "inherit",
    })));
    if (child.error) fail("E_CAPABILITY_BROKEN", child.error.message);
    process.exit(child.status ?? 1);
  } catch (error) { fail(error.code || "E_CAPABILITY_BROKEN", error.message); }
}

/** Level of a directory: laptop (home), repo (.git), else workspace. */
function levelOf(dir) {
  const d = resolve(dir);
  if (d === homedir()) return "laptop";
  if (existsSync(join(d, ".git"))) return "repo";
  return "workspace";
}

function shortPath(p) {
  if (!p) return p;
  const home = homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

/** Shell-safe single-quoting for copyable human commands (paths may contain spaces/metacharacters). */
function shellQuote(s) {
  return /^[A-Za-z0-9._/~-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** The scaffolded `name:` value — the target directory's basename — held to the
 * SAME write refusal as every other value this CLI renders into a config line.
 *
 * A basename is filesystem input, not a literal: a directory whose name embeds
 * a newline turned one scaffolded `name:` line into arbitrary top-level config
 * blocks (a live `team:` block smuggled through `oats init`), and a `#`-leading
 * basename wrote a value that reads back as an empty map. Refusing names the
 * offending basename and writes nothing — the operator renames the directory. */
function scaffoldConfigName(dir) {
  return assertSafeConfigValue(basename(dir), `the scaffolded name from the directory basename ${JSON.stringify(basename(dir))}`);
}

// ---------- doctor ----------
/** Doctor must diagnose, not crash: a stale activation of a retired
 * capability fails config resolution — surface the cleanup instruction
 * cleanly (text or JSON) instead of an uncaught stack trace. */
function resolveForDoctor(ctx, soulName, { json } = {}) {
  try { return resolveOatsConfig(ctx, soulName); }
  catch (e) {
    // Doctor is THE diagnosis surface: it alone catches the typed fail-closed
    // invalid-lock error and continues to render actionable state.
    if (e.code === "invalid-lock") {
      const prov = Array.isArray(e.provenance) ? e.provenance[0] : undefined;
      if (json) { console.log(JSON.stringify({ context: ctx, error: { code: "invalid-lock", message: e.message, provenance: e.provenance || null } }, null, 2)); process.exit(1); }
      console.log(`oats doctor — resolved from ${shortPath(ctx)}\n`);
      console.log(`ERROR: ${e.message} [invalid-lock]`);
      if (prov?.file) console.log(`  fix or remove the offending entry in ${shortPath(prov.file)} — the lock is never auto-repaired; all package operations fail closed until it is valid`);
      process.exit(0); // doctor DIAGNOSED successfully; the lock is the problem
    }
    const retiredId = Object.keys(RETIRED_CAPABILITIES).find((id) => String(e.message).includes(`"${id}"`) && String(e.message).includes("retired"));
    if (!retiredId) throw e;
    if (json) { console.log(JSON.stringify({ schemaVersion: 1, context: ctx, error: e.message, retired: [retiredId] }, null, 2)); process.exit(1); }
    die(`${e.message}`);
  }
}
function operationalKnowledgeNote(composition, soulName) {
  return composition && !composition.oatsCoreDeclared
    ? `soul ${soulName} has no oats.core capability; kernel-shipped operational skills are deprecated` : null;
}
function doctorComposition(ctx, soulName) {
  if (!soulName) return undefined;
  const root = findRoot(ctx);
  const agent = root && findAgent(root, soulName);
  if (!agent) throw new Error(`unknown soul "${soulName}" for doctor composition`);
  return composeInstanceAgentsMd(join(agent._dir, "soul"), ctx, agent.name, agent.work || "checkout", agent.kind);
}

/** Workspace-model v2 doctor data, OFFLINE: the deployment declaration found
 * walking up from ctx (oats-local.yaml) and the lock v3 beside it. Doctor never
 * goes to the network; membership and discovery are `oats sync` / `oats workspace status`. */
function doctorLockData(ctx) {
  const out = { local: null, localError: null, lockFile: null, packages: [], lockError: null };
  let lockDir = ctx;
  try {
    const found = loadLocal(ctx);
    out.local = { path: found.path, workspace: found.local.workspace };
    lockDir = dirname(found.path);
  } catch (e) {
    if (e?.code === "E_WORKSPACE_SCHEMA") out.localError = { code: e.code, message: e.message };
    else if (e?.code !== "E_LOCAL_MISSING") throw e;
  }
  const file = join(lockDir, LOCK_FILE);
  if (!existsSync(file)) return out;
  out.lockFile = file;
  try {
    const lock = readLock(lockDir);
    out.packages = Object.entries(lock.packages).map(([id, p]) => ({ id, version: p.version, source: p.source, path: p.path, commit: p.commit, integrity: p.integrity, capabilities: p.capabilities, approved: p.approved }));
  } catch (e) {
    if (e?.code !== "E_LOCK_SCHEMA") throw e;
    out.lockError = { code: e.code, message: e.message, file: e.details?.file ?? file };
  }
  return out;
}

/** The health of ONE materialized capability, against the rows it was projected
 * from. Shared by doctor and list so both name the same states with the same
 * codes — and so the `.oats-installation.json` provenance is checked in BOTH,
 * not only deep inside trust resolution where it surfaces as a bare "untrusted".
 *
 * Order matters: a missing artifact cannot be hashed, drifted bytes make an
 * approval meaningless (so trust is not ALSO reported), and provenance is only
 * worth reading once the bytes are the locked ones. */
/** The lock rows AT one level. Never the merged maps: those resolve each
 * identity independently, so an outer scope's capability can be paired with a
 * nearer scope's package of the same id — a provider that never exported it. */
const levelRows = (locks, level) => locks.levels.find((l) => l.level === level) || { packages: Object.create(null), capabilities: Object.create(null) };

/** A capability has an executable surface when its manifest declares commands,
 *  hooks or launch environment — the things `oats trust` approves. A
 *  data-only capability (skills/injects) has none, and trust is not-applicable. */
function hasExecutableSurface(manifest) {
  return !!(Object.keys(manifest?.commands || {}).length || Object.keys(manifest?.hooks || {}).length || (manifest?.environment?.length || 0));
}
function capabilityHealth(level, cap, capRow, pkgRow) {
  const dir = installedCapabilityDir(level, cap.id);
  if (!cap.installed) return { status: "missing", code: "missing-capability-artifact", dir, detail: `capability ${cap.id} is locked but not materialized — run \`oats sync\` to re-materialize it` };
  let integrity;
  try { integrity = capabilityArtifactIntegrity(dir); }
  catch (e) { return { status: "broken", code: e.code || "invalid-capability-artifact", dir, detail: `capability ${cap.id}: ${e.message}` }; }
  if (integrity !== cap.integrity) {
    return { status: "drifted", code: "integrity-drift", dir, integrity, detail: `capability ${cap.id}: artifact integrity drift — installed ${integrity}, locked ${cap.integrity}; its executable approval is invalid` };
  }
  // The artifact's own provenance and the lock must tell the SAME story before
  // either is believed. Neither silently wins; the disagreement is the finding.
  if (capRow && pkgRow) {
    try { verifyCapabilityInstallation(dir, cap.id, capRow, pkgRow); }
    catch (e) { return { status: "provenance-mismatch", code: e.code || "invalid-lock", dir, integrity, detail: `capability ${cap.id}: ${e.message}` }; }
  }
  const executable = hasExecutableSurface(cap.manifest);
  if (executable && !cap.trusted) return { status: "untrusted", code: "untrusted-surface", dir, integrity, detail: `capability ${cap.id}: executable surface UNTRUSTED — approve it in \`oats sync\`` };
  return { status: "ok", code: null, dir, integrity, detail: null };
}

// ---------- inspect: one authoritative answer for GUIs ----------
/** Souls, capabilities (installed state and health, separately from
 *  activation), effective layer bindings and declared operations for a
 *  scope, a selected soul, or a running home's snapshot. Read-only; the
 *  integrity scan runs only when asked (a GUI calls this on Refresh, never
 *  from its roster poll). Nothing here is provider-specific: what a
 *  knowledge provider offers is what its manifest declares. */
const INSPECT_TEXT_CAP = 256 * 1024;
function readTextCapped(file) {
  let bytes;
  try { bytes = readFileSync(file); }
  catch (e) { return { file, text: null, sha256: null, truncated: false, error: `${e.code || "EIO"}: ${e.message}` }; }
  const truncated = bytes.length > INSPECT_TEXT_CAP;
  // The bound is bytes; a cut inside a multi-byte sequence is dropped, never
  // rendered as a replacement character.
  let text = truncated ? bytes.subarray(0, INSPECT_TEXT_CAP).toString("utf8") : bytes.toString("utf8");
  if (truncated && text.endsWith("\uFFFD")) text = text.slice(0, -1);
  return { file, text, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, truncated, error: null };
}
/** The canonical agents root a home belongs to, from its path alone:
 *  <root>/<agent>/instances/<instance>, or <workspace>/local-agents/<agent>/
 *  instances/<instance> whose canonical root is the sibling agents/. */
function agentsRootOfHome(home) {
  const agentDir = dirname(dirname(home));
  const base = dirname(agentDir);
  return basename(base) === "local-agents" ? join(dirname(base), "agents") : base;
}
const SOUL_FIELDS = ["runtime", "model", "yolo", "backend", "description", "launch-config"];
const realOrResolved = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
/** Every soul of a scope: persistent and local souls of every agents root in
 *  scope, plus packaged souls (read-only). One enumeration for inspect and
 *  operation run, so both address souls the same way. */
function scopeSouls(ctx, r, { extraRoots = [] } = {}) {
  // A home's own agents root is always in scope for that home: its recorded
  // work repository may be another repository entirely (repo overrides), and
  // the config context resolves there while the soul lives with its owner.
  const roots = [...new Set([...(r.team ? teamAgentRoots(r.team.scope) : [findRoot(ctx)]), ...extraRoots].filter(Boolean).map((p) => realOrResolved(resolve(p))))];
  const souls = [];
  for (const root of roots) {
    for (const a of listInstances(root)) {
      const soul = findAgent(root, a.name) || a;
      const e = soulEntry(soul, root);
      e.instances = (a.instances || []).map((i) => i.instance);
      souls.push(e);
    }
  }
  const diagnostics = [];
  try {
    const packaged = listCapabilityAgents(ctx);
    diagnostics.push(...(packaged.diagnostics || []));
    for (const pa of packaged) {
      let soul = {};
      try { soul = stripInternalAnnotations(withConfigFile(join(pa.soulDir, "soul.yaml"), () => parseYamlNested(readFileSync(join(pa.soulDir, "soul.yaml"), "utf8")))); } catch { /* reported by name only */ }
      souls.push(soulEntry({ ...soul, name: pa.name, description: pa.description ?? soul.description, soulDir: pa.soulDir }, roots[0] || ctx, { capability: pa.capability }));
    }
  } catch (e) { diagnostics.push({ code: e.code || "E_CAPABILITY_BROKEN", message: e.message }); }
  return { roots, souls, diagnostics };
}
/** The one soul a name (and optional agents root) addresses; throws with a
 *  code when none or several match. */
function selectSoul(souls, name, agentsRoot, ctx) {
  let matches = souls.filter((s) => s.name === name);
  if (agentsRoot) matches = matches.filter((s) => realOrResolved(s.agentsRoot) === realOrResolved(agentsRoot));
  if (!matches.length) throw Object.assign(new Error(`no soul ${JSON.stringify(name)} in the scope of ${ctx}${agentsRoot ? ` under ${agentsRoot}` : ""}`), { code: "E_SOUL_UNKNOWN" });
  // Same-named souls under several member roots: the member the caller
  // addressed with --dir breaks the tie; a team root or an unrelated
  // directory does not, and the answer names --agents-root as the remedy.
  if (matches.length > 1) {
    const here = realOrResolved(ctx);
    const own = matches.filter((s) => s.kind !== "capability" && realOrResolved(dirname(s.agentsRoot)) === here);
    if (own.length === 1) return own[0];
    throw Object.assign(new Error(`soul ${JSON.stringify(name)} exists under ${matches.length} agents roots (${matches.map((m) => m.agentsRoot).join(", ")}); pass --agents-root <abs>`), { code: "E_SOUL_AMBIGUOUS" });
  }
  return matches[0];
}
/** The config context a selected soul belongs to: the workspace of its
 *  agents root (a member repository under a team scope). An explicit --dir
 *  may be that context or a scope enclosing it (the team root); another
 *  member's context contradicts the selection and is refused. */
function memberContextOf(soul, ctx, explicitDir, bail) {
  if (soul.kind === "capability") return realOrResolved(ctx);
  const member = realOrResolved(dirname(soul.agentsRoot));
  const given = realOrResolved(ctx);
  if (member === given) return member;
  if (explicitDir && !member.startsWith(given + sep)) bail("E_SCOPE_MISMATCH", `--dir ${ctx} is not the scope of soul ${soul.name} under ${soul.agentsRoot} (${member}); pass that member's directory, an enclosing team scope, or omit --dir`);
  return member;
}
/** A home's context for --dir validation: its recorded repository, or the
 *  workspace that holds its agents root (what a roster derives). */
function homeContexts(home, meta) {
  const out = [];
  if (meta.repo && existsSync(meta.repo)) out.push(resolve(meta.repo));
  out.push(dirname(agentsRootOfHome(realOrResolved(home))));
  return out;
}
/** A soul's own declared requirements/defaults/provenance, read from its
 *  soul.yaml through the kernel's parser (never guessed, never re-parsed by a
 *  consumer). Absent sections are null: an unrecorded provenance is a fact
 *  about the soul, not a prompt to infer one. */
function soulDeclarations(soulDir) {
  const file = join(soulDir, "soul.yaml");
  const empty = { declarations: { requires: null, defaults: null, knowledge: null, teams: null, resources: null, children: null }, provenance: null, problems: [] };
  if (!existsSync(file)) return empty;
  let parsed;
  try { parsed = withConfigFile(file, () => parseYamlNested(readFileSync(file, "utf8"))); }
  catch (e) { return { ...empty, problems: [{ code: "soul-declarations-unreadable", message: e.message }] }; }
  const section = (key) => (parsed[key] !== undefined && parsed[key] !== null && typeof parsed[key] === "object") ? parsed[key] : (parsed[key] === undefined ? null : parsed[key]);
  const provenance = section("provenance");
  return {
    declarations: { requires: section("requires"), defaults: section("defaults"), knowledge: section("knowledge"), teams: section("teams"), resources: section("resources"), children: section("children") },
    provenance: provenance && typeof provenance === "object" ? {
      kind: provenance.kind ?? null, source: provenance.source ?? null, revision: provenance.revision ?? null,
      path: provenance.path ?? null, workspaceRevision: provenance.workspaceRevision ?? null,
    } : null,
    problems: [],
  };
}
function soulEntry(soul, root, { capability } = {}) {
  const dir = soul._dir || soul.soulDir;
  const soulDir = capability ? soul.soulDir : join(dir, "soul");
  const packaged = !!capability;
  const declared = soulDeclarations(soulDir);
  return {
    soulsApi: 1, declarations: declared.declarations, provenance: declared.provenance,
    declarationProblems: declared.problems,
    name: soul.name, kind: packaged ? "capability" : (soul.kind || "persistent"), capability: capability || null,
    type: soul.type ?? null, description: soul.description ?? null, repo: soul.repo ?? null, work: soul.work || "checkout",
    runtime: soul.runtime || "pi", model: soul.model ?? null, yolo: soul.yolo === true || soul.yolo === "true" ? true : soul.yolo === false || soul.yolo === "false" ? false : null, launchConfig: soul["launch-config"] ?? null, backend: soul.backend ?? null,
    agentsRoot: root, dir: packaged ? soulDir : dir, soulFile: join(soulDir, "soul.yaml"), instructionsFile: join(soulDir, "AGENTS.md"),
    editable: packaged
      ? { fields: [], instructions: false, reason: `packaged soul from capability ${capability}: edit the package and update it; scoped bindings still apply through oats use` }
      : { fields: [...SOUL_FIELDS], instructions: true, reason: null },
    instances: [],
  };
}
/** These commands address a scope explicitly (--dir, --home, cwd); the
 *  invoking process's ambient agents-root override must not redirect them
 *  to its own deployment. */
function dropAmbientRoot() { delete process.env.PI_AGENTS_ROOT; }
function inspectCmd() { const result = computeInspect(); if (!result) return; if (JSON_MODE) { const { _print, ...data } = result; jsonOk(data); return; } printInspect(result); }
/** The inspect answer as data — shared by `oats inspect` and `oats readiness`
 *  (K5), so the readiness quartet is derived from the SAME capability,
 *  activation, trust and soul facts inspect reports, never a second opinion. */
function computeInspect({ onFail } = {}) {
  const bail = onFail || ((code, msg) => (JSON_MODE ? jsonFail(code, msg) : die(msg)));
  dropAmbientRoot();
  const homeFlag = flag("home");
  const home = homeFlag === true ? bail("E_BAD_ARGS", "--home needs an absolute instance home") : homeFlag;
  let meta;
  if (home) {
    if (!isAbsolute(home)) bail("E_BAD_ARGS", "--home needs an absolute instance home");
    const metaFile = join(home, "instance.json");
    if (!existsSync(metaFile)) bail("E_SESSION_UNKNOWN", `${home} is not an OATS instance home (no instance.json)`);
    try { meta = JSON.parse(readFileSync(metaFile, "utf8")); } catch (e) { bail("E_SESSION_UNKNOWN", `${metaFile}: ${e.message}`); }
  }
  const real = realOrResolved;
  let ctx;
  if (meta) {
    // The home is the identity and its recorded repository is ALWAYS its
    // context (that is what composed it); an explicit --dir is accepted only
    // as an alias naming that repository or the workspace of the home's
    // agents root, and never replaces the context.
    const contexts = homeContexts(home, meta);
    if (flag("dir") !== undefined) { const given = dirFlag(); if (!contexts.some((c) => real(c) === real(given))) bail("E_HOME_MISMATCH", `--dir ${given} is not the context of ${home} (${contexts.join(" or ")}); omit --dir for a home`); }
    ctx = contexts[0];
  } else ctx = dirFlag();
  const soulFlag = flag("soul");
  if (soulFlag === true) bail("E_BAD_ARGS", "--soul needs a soul name");
  if (meta && soulFlag && soulFlag !== meta.agent) bail("E_HOME_MISMATCH", `--soul ${soulFlag} is not the soul of ${home} (${meta.agent})`);
  const soulName = soulFlag || meta?.agent || undefined;
  let agentsRootFlag = flag("agents-root");
  if (agentsRootFlag === true) bail("E_BAD_ARGS", "--agents-root needs an absolute agents directory");
  if (meta) {
    // The soul is the home's own, under the home's own root; same-named souls
    // in other member repositories are ordinary and never ambiguous here.
    const homeRoot = agentsRootOfHome(real(home));
    if (agentsRootFlag && real(agentsRootFlag) !== real(homeRoot)) bail("E_HOME_MISMATCH", `--agents-root ${agentsRootFlag} is not the agents root of ${home} (${homeRoot})`);
    agentsRootFlag = homeRoot;
  }
  let r;
  try { r = resolveOatsConfig(ctx, soulName); } catch (e) { bail(e.code || "E_CONFIG_BROKEN", e.message); }
  let chain = configChain(ctx);
  const enumerated = scopeSouls(ctx, r, { extraRoots: meta ? [agentsRootOfHome(realOrResolved(home))] : [] });
  const roots = enumerated.roots;
  let souls = enumerated.souls;
  const packagedDiagnostics = enumerated.diagnostics;
  let selectedSoul = null;
  const requestedContext = ctx;
  if (soulName) {
    try { selectedSoul = selectSoul(souls, soulName, agentsRootFlag, ctx); } catch (e) { bail(e.code || "E_SOUL_UNKNOWN", e.message); }
    selectedSoul.instructions = readTextCapped(selectedSoul.instructionsFile);
    souls = [selectedSoul];
    // A soul's effective bindings are its own member's: a team root or
    // another member's --dir must not be applied to it. (A home keeps its
    // recorded repository as its context; that is what composed it.)
    if (!meta) {
      const member = memberContextOf(selectedSoul, ctx, flag("dir") !== undefined, bail);
      if (member !== realOrResolved(ctx)) {
        ctx = member;
        try { r = resolveOatsConfig(ctx, soulName); } catch (e) { bail(e.code || "E_CONFIG_BROKEN", e.message); }
        chain = configChain(ctx);
      }
    }
  }

  // Capabilities: installed state and health from the package engine (exactly
  // what `oats list` reports), owned/path manifests beside them, and the
  // ACTIVATION for the selected soul (or global) from the resolver.
  const mans = capabilityManifests(manifestSource(meta, home, ctx));
  let lockError = null;
  const byId = new Map();
  try {
    const pkgs = listInstalledPackages(ctx), locks = readPackageLocks(ctx);
    for (const p of pkgs) {
      const rows = levelRows(locks, p.level);
      for (const c of p.capabilities) {
        const h = capabilityHealth(p.level, c, rows.capabilities[c.id], rows.packages[p.package]);
        byId.set(c.id, {
          id: c.id, package: p.package, version: c.version || null, layer: c.manifest?.layer || null, command: c.manifest?.command || null,
          origin: "installed", level: p.level, source: p.source || null, commit: p.commit ?? rows.packages[p.package]?.commit ?? null, dir: h.dir,
          health: { status: h.status, code: h.code, detail: h.detail, installed: !!c.installed, locked: true, trusted: c.trusted === true, executableSurface: hasExecutableSurface(c.manifest), integrity: c.integrity || null, installedIntegrity: h.integrity ?? null },
        });
      }
    }
  } catch (e) { lockError = { code: e.code || "invalid-lock", message: e.message }; }
  for (const [id, m] of Object.entries(mans)) {
    if (byId.has(id)) continue;
    const trust = capabilityTrust(m, ctx);
    const executable = hasExecutableSurface(m);
    let integrity = trust.integrity || null;
    if (!integrity) { try { integrity = capabilityArtifactIntegrity(m._dir); } catch { integrity = null; } }
    byId.set(id, {
      id, package: m._package || null, version: m.version || null, layer: m.layer || null, command: m.command || null,
      origin: String(m._origin || "").split(":")[0] || "unknown", level: String(m._origin || "").split(":").slice(1).join(":") || null, source: null, dir: m._dir,
      health: { status: executable && !trust.trusted ? "untrusted" : "ok", code: executable && !trust.trusted ? "untrusted-surface" : null, detail: executable && !trust.trusted ? (trust.reason || null) : null, executableSurface: executable, installed: true, locked: !!trust.lock, trusted: !!trust.trusted, integrity, installedIntegrity: integrity },
    });
  }
  // What is EFFECTIVE for the answer: a home's captured bindings and settings
  // (with the currently acquired manifests and current trust); a soul's or
  // scope's current config otherwise. The current config is reported
  // separately for a home so a GUI can show both without confusing them.
  const snapshotCaps = meta ? (meta.capabilities || []) : null;
  const layerIdOf = (rec) => { const m = typeof rec === "string" ? /^([a-z0-9][a-z0-9._-]*)(?:\s|$)/.exec(rec) : null; return m && m[1] !== "none" ? m[1] : null; };
  const effectiveLayers = meta
    ? Object.fromEntries(LAYERS.map((l) => { const id = layerIdOf(meta.layers?.[l]) || snapshotCaps.find((c) => mans[c.id]?.layer === l)?.id || null; const rec = typeof meta.layers?.[l] === "string" ? meta.layers[l] : null; return [l, { id, level: snapshotCaps.find((c) => c.id === id)?.level || null, provenance: rec, disabled: !id && !!rec && rec.startsWith("none") }]; }))
    : Object.fromEntries(LAYERS.map((l) => [l, r.layers[l]
      ? { id: r.layers[l].id, level: r.layers[l].level, provenance: r.provenance[l] || null, disabled: false }
      : { id: null, level: r.layerDisabled?.[l]?.level || null, provenance: r.provenance[l] || null, disabled: !!r.layerDisabled?.[l] }]));
  const effectiveActive = (id) => meta
    ? (() => { const c = snapshotCaps.find((x) => x.id === id); return c ? { id, level: c.level || null, provenance: c.provenance || [], settings: c.settings || {} } : undefined; })()
    : r.capabilities.find((c) => c.id === id);
  const declaredAt = (id) => chain.flatMap((cfg) => configCapabilityEntries(cfg).filter((e) => e.id === id).map((e) => ({ level: cfg._level, slot: e.slot || null, targets: [
    ...(e.spec.global !== undefined ? [`global`] : []),
    ...Object.keys(e.spec["agent-types"] || {}).map((t) => `type:${t}`),
    ...Object.keys(e.spec.souls || {}).map((sn) => `soul:${sn}`),
  ] })));
  const targetOf = (provenance) => [...provenance].map((p) => p.split(" @ ")[0]).sort((a, b) => (b.startsWith("soul:") ? 2 : b.startsWith("type:") ? 1 : 0) - (a.startsWith("soul:") ? 2 : a.startsWith("type:") ? 1 : 0))[0] || (meta ? "snapshot" : "global");
  const capabilities = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)).map((entry) => {
    const active = effectiveActive(entry.id);
    const m = mans[entry.id];
    const missingRequires = (() => { try { return capabilityMissingRequires(entry.id, ctx).map((x) => ({ command: x.command, why: x.why || null, install: x.install || null })); } catch { return []; } })();
    const disabledLayer = entry.layer && (meta ? (effectiveLayers[entry.layer]?.disabled ? { level: null } : null) : r.layerDisabled?.[entry.layer]);
    const declared = declaredAt(entry.id);
    const activation = active
      ? { enabled: true, source: meta ? "snapshot" : "config", target: targetOf(active.provenance || []), level: active.level, provenance: active.provenance || [], settings: active.settings || {}, declaredAt: declared }
      : { enabled: false, source: meta ? "snapshot" : "config", target: declared.length ? "declared" : "none", level: declared[0]?.level || null, provenance: [], settings: {}, declaredAt: declared, ...(disabledLayer ? { reason: `layer ${entry.layer} is disabled${disabledLayer.level ? ` at ${disabledLayer.level}` : " for this home"}` } : {}) };
    const operations = manifestOperations(m).map((op) => {
      let reason = null;
      if (!active) reason = disabledLayer ? `layer ${entry.layer} is disabled${disabledLayer.level ? ` at ${disabledLayer.level}` : " for this home"}` : `${entry.id} is not activated for ${meta ? `home ${basename(home)}` : soulName ? `soul ${soulName}` : "this scope"}`;
      else if (!entry.health.trusted) reason = `${entry.id} executable surface is not trusted (approve it in oats sync)`;
      else if (entry.health.status !== "ok") reason = entry.health.detail || entry.health.status;
      else if (missingRequires.length) reason = `${entry.id} requires ${missingRequires.map((x) => `"${x.command}" on PATH${x.why ? ` (${x.why})` : ""}`).join(", ")}`;
      else if (op.context === "home" && !home) reason = "needs a running home (--home)";
      return { ...op, argv: [entry.command, op.command], available: !reason, reason };
    });
    return { ...entry, missingRequires, activation, operations };
  });
  const layers = effectiveLayers;
  // For a home, the CURRENT config beside the captured bindings, so a GUI can
  // show what future instances would get without mistaking it for the home's.
  const currentConfig = meta ? {
    layers: Object.fromEntries(LAYERS.map((l) => [l, r.layers[l] ? { id: r.layers[l].id, level: r.layers[l].level, provenance: r.provenance[l] || null, disabled: false } : { id: null, level: r.layerDisabled?.[l]?.level || null, provenance: r.provenance[l] || null, disabled: !!r.layerDisabled?.[l] }])),
    activations: r.capabilities.map((c) => ({ id: c.id, target: targetOf(c.provenance), level: c.level, settings: c.settings || {} })),
  } : null;
  const knowledgeCap = layers.knowledge.id ? capabilities.find((c) => c.id === layers.knowledge.id) : null;
  const knowledge = knowledgeCap ? { provider: knowledgeCap.id, version: knowledgeCap.version, operations: knowledgeCap.operations.map((o) => ({ name: o.name, kind: o.kind, available: o.available, reason: o.reason })) } : { provider: null, version: null, operations: [] };

  let snapshot = null;
  if (meta) {
    const runtimeById = new Map((meta.capabilityRuntime || []).map((c) => [c.id, c]));
    const drift = [];
    for (const c of meta.capabilities || []) {
      const now = r.capabilities.find((x) => x.id === c.id);
      if (!now) { drift.push({ id: c.id, field: "activation", snapshot: true, config: false }); continue; }
      if (JSON.stringify(c.settings || {}) !== JSON.stringify(now.settings || {})) drift.push({ id: c.id, field: "settings", snapshot: c.settings || {}, config: now.settings || {} });
      const then = runtimeById.get(c.id)?.trust?.integrity, cur = byId.get(c.id)?.health?.integrity;
      if (then && cur && then !== cur) drift.push({ id: c.id, field: "integrity", snapshot: then, config: cur });
    }
    for (const now of r.capabilities) if (!(meta.capabilities || []).some((c) => c.id === now.id)) drift.push({ id: now.id, field: "activation", snapshot: false, config: true });
    snapshot = {
      home, instance: meta.instance, agent: meta.agent, runtime: meta.runtime || null, model: meta.model ?? null, yolo: meta.yolo ?? null, launched: !!meta.launched, createdAt: meta.createdAt || null,
      layers: meta.layers || {}, capabilities: (meta.capabilities || []).map((c) => ({ id: c.id, level: c.level, settings: c.settings || {}, trusted: runtimeById.get(c.id)?.trust?.trusted ?? null })),
      instructions: { ...readTextCapped(join(home, "AGENTS.md")), sources: meta.instructions || [] }, drift,
    };
  }
  // K4: the deployment's portable source context and each soul's declared
  // requirements joined against the capability inventory in this same payload.
  // Readiness is about the soul's declared sources, kept apart from
  // launchability (spawn) and adoption (prepare); unobservable = null.
  const capabilityById = new Map(capabilities.map((c) => [c.id, c]));
  for (const s of souls) {
    const required = s.declarations?.requires?.capabilities;
    const requirements = required && typeof required === "object" ? Object.entries(required).map(([id, spec]) => {
      const cap = capabilityById.get(id) || null;
      return { capability: id, source: spec && typeof spec === "object" ? spec.source ?? null : null,
        installed: cap ? cap.health?.installed ?? null : false, approved: cap ? cap.health?.trusted ?? null : null,
        active: cap ? !!cap.activation?.enabled : null, version: cap?.version ?? null };
    }) : null;
    s.readiness = { source: s.provenance ? "recorded" : "unrecorded", requirements,
      status: requirements === null ? "undeclared" : requirements.every((q) => q.installed === true) ? "sources-installed" : requirements.some((q) => q.installed === false) ? "sources-missing" : "unknown" };
  }
  const sourceKey = (p) => JSON.stringify([p.source, p.revision, p.path]);
  const sourceItems = [...new Map(souls.filter((s) => s.provenance?.source).map((s) => [sourceKey(s.provenance), { ...s.provenance, souls: [] }])).values()];
  for (const s of souls) if (s.provenance?.source) sourceItems.find((i) => sourceKey(i) === sourceKey(s.provenance)).souls.push(s.name);
  const sources = { soulsApi: 1, kind: sourceItems.length ? "recorded-provenance" : "none-recorded", items: sourceItems,
    note: sourceItems.length ? null : "no soul in this scope records a portable source address" };
  const result = {
    operationsApi: 1, kernel: OATS_VERSION,
    scope: { context: ctx, requestedContext: requestedContext === ctx ? null : requestedContext, workspace: roots.length ? workspaceOf(roots[0]) : ctx, team: r.team || null, chain: chain.map((c) => ({ file: c._file, level: c._level, levelKind: levelOf(c._level) })), agentsRoots: roots },
    selected: { soul: selectedSoul?.name || null, agentsRoot: selectedSoul?.agentsRoot || null, home: home || null, source: meta ? "snapshot" : "config" },
    souls, sources, layers, capabilities, knowledge, snapshot, currentConfig,
    problems: [...(lockError ? [lockError] : []), ...packagedDiagnostics.map((d) => ({ code: d.code, message: d.message, capability: d.capability })),
      ...(meta ? snapshotCaps.filter((c) => !mans[c.id]).map((c) => ({ code: "captured-capability-missing", message: `${c.id} was active when this home was composed but no manifest for it is acquired now`, capability: c.id })) : [])],
  };
  result._print = { ctx, selectedSoul, home };
  return result;
}
function printInspect(result) {
  const { ctx, selectedSoul, home } = result._print; delete result._print;
  const { souls, layers, capabilities } = result;
  console.log(`oats inspect — ${shortPath(ctx)}${selectedSoul ? ` soul ${selectedSoul.name}` : ""}${home ? ` home ${shortPath(home)}` : ""}`);
  for (const s of souls) console.log(`  soul ${s.name} [${s.kind}${s.capability ? ` ${s.capability}` : ""}] runtime ${s.runtime}${s.model ? ` model ${s.model}` : ""} work ${s.work}${s.editable.fields.length ? "" : " (read-only)"}`);
  for (const l of LAYERS) console.log(`  layer ${l}: ${layers[l].id || (layers[l].disabled ? "disabled" : "none")}${layers[l].provenance ? `  (${layers[l].provenance})` : ""}`);
  for (const c of capabilities) console.log(`  ${c.id}@${c.version || "?"} ${c.health.status}${c.activation.enabled ? ` active:${c.activation.target}` : " inactive"}${c.operations.length ? `  ops: ${c.operations.map((o) => `${o.name}${o.available ? "" : "(unavailable)"}`).join(", ")}` : ""}`);
  for (const p of result.problems) console.log(`  ! ${p.code}: ${p.message}`);
}

// ---------- operation run: generic invoke through the capability engine ----------
/** `oats operation run <layer>:<name>`: resolve the provider that fills
 *  <layer> for a running home (its snapshot) or for a soul in a scope (the
 *  config), require the operation to be declared and the executable surface
 *  trusted, then run the provider's own command exactly as `oats <ns> <cmd>`
 *  would, in the home (context home) or the scope (context scope), and relay
 *  its envelope. A view operation must answer { documents: [...] }. No
 *  provider name appears here. */
const OPERATION_ADDRESS_RE = /^(knowledge|messaging|tasks):([a-z][a-z0-9-]*)$/;
/** The same phrasing the scheduler treats as retained effects. */
const reportsRetainedEffectsText = (message) => /INCOMPLETE|quarantin|retain|could not (?:be )?(?:verif|confirm)/i.test(String(message || ""));
// Comfortably below the scheduler's 5-minute command bound and any GUI
// proxy, so the receipt always reaches the caller before a wrapper gives up.
const OPERATION_TIMEOUT_MS = CAPTURED_OPERATION_TIMEOUT_MS;
function finishOperation({ r, bail, address, provider, op, argFlags, cwd, home, meta, cleanupError, intent, settlement }) {
  const stderr = String(r.stderr || "").trim();
  const timedOut = r.error?.code === "ETIMEDOUT" || (r.status === null && ["SIGTERM", "SIGKILL"].includes(r.signal) && (!settlement || !r.error));
  const base = { operation: address, capability: provider.capability, version: provider.version || null, argv: [provider.command, op.command, ...argFlags], cwd, target: home ? { home, instance: meta.instance } : null };
  // Unconfirmed outcomes (a timeout, no valid receipt, a receipt contradicted
  // by the exit status) carry what WAS observed in error.details, so a
  // scheduler can keep the slot as unknown and reconcile by any name the
  // provider managed to answer; they are never confirmed failures.
  const observed = (envelope) => ({ exit: r.status, signal: r.signal || null, unconfirmed: true, ...(envelope && typeof envelope === "object" ? { envelope } : {}),
    ...(stderr ? { stderr: stderr.slice(0, 2000) } : {}), ...(cleanupError ? { cleanup: { code: cleanupError.code || "E_OPERATION_CLEANUP", message: String(cleanupError.message || cleanupError).slice(0, 1000) } } : {}) });
  if (r.error && !timedOut) bail("E_CAPABILITY_BROKEN", `${address}: ${r.error.message || r.error}`, settlement ? observed(parseEnvelopeText(String(r.stdout || ""))) : undefined);
  if (timedOut) bail("E_OPERATION_TIMEOUT", `${address} (${provider.capability} ${op.command}) did not finish within ${OPERATION_TIMEOUT_MS / 1000} s; its effects are unconfirmed`, observed(parseEnvelopeText(String(r.stdout || ""))));
  // Exactly one JSON-v1 envelope on stdout, nothing else, and an exit status
  // that agrees with it: contaminated output or a success envelope from a
  // process that then failed is not a receipt.
  let envelope;
  try { envelope = JSON.parse(String(r.stdout || "").trim()); } catch { envelope = undefined; }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || envelope.schemaVersion !== 1 || typeof envelope.ok !== "boolean") bail("E_OPERATION_RESULT", `${address} (${provider.capability} ${op.command}) did not answer exactly one JSON-v1 envelope on stdout (exit ${r.status}); its effects are unconfirmed${stderr ? `: ${stderr.slice(0, 400)}` : ""}`, observed(parseEnvelopeText(String(r.stdout || ""))));
  if (cleanupError) bail("E_OPERATION_RESULT", `${address} (${provider.capability} ${op.command}) answered, but private invocation cleanup could not be confirmed; its effects are unconfirmed`, observed(envelope));
  // A provider's own failure is relayed with its code; its WHOLE envelope
  // (a partial receipt such as result.instance of something it launched
  // before failing, and any details it gave) travels in error.details so a
  // scheduler can keep an unconfirmed outcome and reconcile that target.
  if (!envelope.ok) bail(envelope.error?.code || "E_OPERATION_FAILED", `${address}: ${envelope.error?.message || "failed"}`, { exit: r.status, envelope, ...(reportsRetainedEffectsText(envelope.error?.message) ? { unconfirmed: true } : {}) });
  if (r.status !== 0) bail("E_OPERATION_RESULT", `${address} (${provider.capability} ${op.command}) answered ok but exited ${r.status}; the receipt is not trusted and its effects are unconfirmed${stderr ? `: ${stderr.slice(0, 400)}` : ""}`, observed(envelope));
  const result = envelope.result && typeof envelope.result === "object" ? envelope.result : {};
  if (op.kind === "view") {
    const docs = result.documents;
    const bad = !Array.isArray(docs) || docs.some((d) => !d || typeof d !== "object" || typeof d.label !== "string" || !d.label
      || (d.kind !== undefined && !["markdown", "text"].includes(d.kind))
      || (d.path !== undefined && d.path !== null && (typeof d.path !== "string" || !isAbsolute(d.path)))
      || (d.text !== undefined && d.text !== null && typeof d.text !== "string"));
    if (bad) bail("E_OPERATION_RESULT", `${address} is a view operation but ${provider.capability} ${op.command} did not answer { documents: [{label, kind?, path?, text?}] }`);
  }
  // A launch receipt in the delegated result (a harvester the provider
  // spawned) is surfaced as top-level instance/home so the scheduler tracks
  // it exactly as it tracks a command job's launch; the source home itself
  // is `target`, never a launch.
  const receipt = {};
  if (typeof result.instance === "string" && result.instance !== meta?.instance) receipt.instance = result.instance;
  if (typeof result.home === "string" && result.home !== home) receipt.home = result.home;
  const out = { ...base, ...receipt, result, ...(intent ? { intent } : {}), ...(stderr ? { stderr: stderr.slice(0, 2000) } : {}) };
  if (JSON_MODE) { jsonOk(out); return; }
  console.log(`${address} via ${provider.capability}@${provider.version || "?"} (${provider.command} ${op.command}) in ${shortPath(cwd)}: ok`);
  if (op.kind === "view") for (const d of result.documents) console.log(`  - ${d.label}${d.path ? ` (${shortPath(d.path)})` : ""}${d.text ? `: ${String(d.text).split("\n")[0].slice(0, 100)}` : ""}`);
  else console.log(JSON.stringify(result, null, 2));
  if (stderr) console.error(stderr);
}
function operationCmd() {
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  dropAmbientRoot();
  if (args[1] !== "run") bail("E_USAGE", "usage: oats operation run <layer>:<name> (--home <abs> | --soul <name> [--dir <scope>] [--agents-root <abs>]) [--arg k=v ...] [--json]");
  const address = args[2];
  const m0 = typeof address === "string" ? OPERATION_ADDRESS_RE.exec(address) : null;
  if (!m0) bail("E_BAD_ARGS", `operation address must be <layer>:<name> with layer one of ${LAYERS.join(", ")} (got ${JSON.stringify(address)})`);
  const [, layer, opName] = m0;
  const homeFlag = flag("home");
  if (homeFlag === true) bail("E_BAD_ARGS", "--home needs an absolute instance home");
  const home = homeFlag ? resolve(homeFlag) : undefined;
  let meta;
  if (home) {
    if (!isAbsolute(homeFlag)) bail("E_BAD_ARGS", "--home needs an absolute instance home");
    const metaFile = join(home, "instance.json");
    if (!existsSync(metaFile)) bail("E_SESSION_UNKNOWN", `${home} is not an OATS instance home (no instance.json)`);
    try { meta = JSON.parse(readFileSync(metaFile, "utf8")); } catch (e) { bail("E_SESSION_UNKNOWN", `${metaFile}: ${e.message}`); }
  }
  // The home is the identity: an explicit --dir must be one of its own
  // contexts, never a different scope's config applied to it.
  let ctx;
  if (meta) {
    // The recorded repository is always a home's context; --dir is only an
    // alias to validate (the repository or the workspace of the home's root).
    const contexts = homeContexts(home, meta);
    if (flag("dir") !== undefined) { const given = dirFlag(); if (!contexts.some((c) => realOrResolved(c) === realOrResolved(given))) bail("E_HOME_MISMATCH", `--dir ${given} is not the context of ${home} (${contexts.join(" or ")}); omit --dir for a home`); }
    ctx = contexts[0];
  } else ctx = dirFlag();
  const soulFlag = flag("soul");
  if (soulFlag === true) bail("E_BAD_ARGS", "--soul needs a soul name");
  if (meta && soulFlag && soulFlag !== meta.agent) bail("E_HOME_MISMATCH", `--soul ${soulFlag} is not the soul of ${home} (${meta.agent})`);
  const soulName = soulFlag || meta?.agent || undefined;
  let agentsRootFlag = flag("agents-root");
  if (agentsRootFlag === true) bail("E_BAD_ARGS", "--agents-root needs an absolute agents directory");
  if (meta) {
    const homeRoot = agentsRootOfHome(realOrResolved(home));
    if (agentsRootFlag && realOrResolved(agentsRootFlag) !== realOrResolved(homeRoot)) bail("E_HOME_MISMATCH", `--agents-root ${agentsRootFlag} is not the agents root of ${home} (${homeRoot})`);
    agentsRootFlag = homeRoot;
  }
  // The same soul selection as inspect: name plus agents root, refused when
  // ambiguous, never silently the first match.
  let selectedSoul;
  if (soulName) {
    let rSel;
    try { rSel = resolveOatsConfig(ctx, meta ? undefined : soulName); } catch (e) { bail(e.code || "E_CONFIG_BROKEN", e.message); }
    try { selectedSoul = selectSoul(scopeSouls(ctx, rSel, { extraRoots: meta ? [agentsRootOfHome(realOrResolved(home))] : [] }).souls, soulName, agentsRootFlag, ctx); } catch (e) { bail(e.code || "E_SOUL_UNKNOWN", e.message); }
    // The provider and its settings are the selected soul's own member's,
    // never a team root's or another member's (a home keeps its recorded
    // repository as its context).
    if (!meta) ctx = memberContextOf(selectedSoul, ctx, flag("dir") !== undefined, bail);
  }
  // --arg k=v pairs, matched against the operation's declared args below.
  const given = Object.create(null);
  for (let i = 3; i < args.length; i++) {
    if (args[i] !== "--arg") continue;
    const kv = args[i + 1];
    if (!kv || kv.startsWith("--") || !kv.includes("=")) bail("E_BAD_ARGS", "--arg expects name=value");
    const eq = kv.indexOf("=");
    given[kv.slice(0, eq)] = kv.slice(eq + 1);
    i++;
  }
  // Provider resolution: the snapshot's active capabilities for a home, the
  // config for a soul/scope.
  const mans = capabilityManifests(manifestSource(meta, home, ctx));
  let provider, settings, team, disabled = null;
  if (meta) {
    const ids = (meta.capabilities || []).map((c) => c.id);
    const id = ids.find((cid) => mans[cid]?.layer === layer);
    provider = id ? mans[id] : undefined;
    settings = (meta.capabilities || []).find((c) => c.id === id)?.settings || {};
    team = meta.team || (() => { try { return resolveOatsConfig(ctx).team; } catch { return undefined; } })();
    if (!provider) { const rec = meta.layers?.[layer]; disabled = typeof rec === "string" && rec.startsWith("none") ? rec : null; }
  } else {
    let r;
    try { r = resolveOatsConfig(ctx, soulName); } catch (e) { bail(e.code || "E_CONFIG_BROKEN", e.message); }
    provider = r.layers[layer] ? mans[r.layers[layer].id] : undefined;
    settings = r.layers[layer]?.settings || {};
    team = r.team;
    if (!provider && r.layerDisabled?.[layer]) disabled = `none @ ${r.layerDisabled[layer].level}`;
  }
  if (!provider) bail("E_OPERATION_UNAVAILABLE", disabled ? `layer ${layer} is explicitly disabled (${disabled}); no provider can run ${address}` : `no ${layer} provider is active for ${meta ? home : soulName ? `soul ${soulName} in ${ctx}` : ctx}`);
  const op = manifestOperations(provider).find((o) => o.name === opName);
  if (!op) bail("E_OPERATION_UNKNOWN", `${provider.capability} declares no operation ${JSON.stringify(opName)} (declared: ${manifestOperations(provider).map((o) => o.name).join(", ") || "none"})`);
  const trust = capabilityTrust(provider, ctx);
  if (!trust.trusted) bail("E_CAPABILITY_BLOCKED", `${provider.capability} executable surface is blocked: ${trust.reason || "not trusted"} (approve it in oats sync)`);
  const missingReq = capabilityMissingRequires(provider.capability, ctx);
  if (missingReq.length) bail("E_CAPABILITY_REQUIRES", `${provider.capability} requires ${missingReq.map((m) => `"${m.command}" on PATH${m.why ? ` (${m.why})` : ""}${m.install ? ` [install: ${m.install}]` : ""}`).join(", ")}; ${address} was not run`);
  if (op.context === "home" && !meta) bail("E_OPERATION_UNAVAILABLE", `${address} runs in an instance home; pass --home <abs>`);
  const declared = new Map(op.args.map((a) => [a.name, a]));
  for (const name of Object.keys(given)) if (!declared.has(name)) bail("E_BAD_ARGS", `${address} takes no arg ${JSON.stringify(name)} (declared: ${[...declared.keys()].join(", ") || "none"})`);
  for (const a of op.args) if (a.required && given[a.name] === undefined) bail("E_BAD_ARGS", `${address} needs --arg ${a.name}=<value>: ${a.description || "required"}`);
  const argFlags = op.args.flatMap((a) => (given[a.name] === undefined ? [] : [a.flag, given[a.name]]));
  const spec = provider.commands[op.command];
  if (typeof spec !== "string" || !spec.trim()) bail("E_CAPABILITY_BROKEN", `${provider.capability}: command ${op.command} is not a non-empty string`);
  const [script, ...rest] = spec.trim().split(/\s+/);
  let abs;
  try { abs = capabilityExecutablePath(provider, script); } catch (e) { bail("E_CAPABILITY_BROKEN", e.message); }
  if (!abs) bail("E_CAPABILITY_BROKEN", `${provider.capability} ${op.command}: script not found (${join(provider._dir, script)})`);
  const cwd = op.context === "home" ? home : ctx;
  // The provider sees exactly the selected target: identity and context
  // variables are SET for it (a home, or a soul in a scope) and every
  // ambient one from the invoking process is removed, so a coordinator
  // running this for another home never steers the provider to its own.
  const env = { ...process.env };
  for (const k of ["OATS_EVENT", "OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "OATS_AGENT", "OATS_SOUL", "OATS_CONTEXT", "OATS_ROOT", "OATS_WORKSPACE", "OATS_LEVEL", "OATS_META", "OATS_KIND", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT"]) delete env[k];
  const targetRoot = meta ? agentsRootOfHome(realOrResolved(home)) : selectedSoul?.agentsRoot;
  const soulDir = meta ? join(dirname(dirname(realOrResolved(home))), "soul") : selectedSoul ? dirname(selectedSoul.soulFile) : undefined;
  Object.assign(env, {
    OATS_CAPABILITY: provider.capability, OATS_SETTINGS: JSON.stringify(settings || {}), OATS_CLI_BIN: CLI_BIN, OATS_OPERATION: address,
    OATS_CONTEXT: ctx, OATS_WORKSPACE: targetRoot ? workspaceOf(targetRoot) : workspaceOf(findRoot(ctx) || ctx),
    OATS_TEAM_NAME: team?.name || "", OATS_TEAM_ID: team?.id || "", OATS_TEAM_SCOPE: team?.scope || "",
    ...(targetRoot ? { OATS_ROOT: targetRoot, PI_AGENTS_ROOT: targetRoot } : {}),
    ...(soulName ? { OATS_AGENT: soulName } : {}), ...(soulDir ? { OATS_SOUL: soulDir } : {}),
  });
  if (op.context === "home") Object.assign(env, { OATS_INSTANCE: meta.instance, OATS_INSTANCE_HOME: home, OATS_HOME: home, PI_AGENT_INSTANCE: meta.instance, PI_AGENT_HOME: home });
  const r = spawnSync("node", [abs, ...rest, ...argFlags, "--json"], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024, timeout: OPERATION_TIMEOUT_MS, killSignal: "SIGTERM" });
  finishOperation({ r, bail, address, provider, op, argFlags, cwd, home, meta });
}

// ---------- soul set: runtime defaults and instructions of an editable soul ----------
/** Rewrites only the given soul.yaml fields, preserving every other line
 *  (unknown keys, comments, order), and replaces AGENTS.md when asked.
 *  Packaged souls are read-only (their source is the package). */
async function soulCmd() {
  const bail = (code, msg) => (JSON_MODE ? jsonFail(code, msg) : die(msg));
  dropAmbientRoot();
  if (args[1] !== "set") bail("E_USAGE", "usage: oats soul set <name> [--dir <scope>] [--agents-root <abs>] [--runtime pi|claude|codex] [--model <m> | --no-model] [--yolo | --no-yolo] [--backend tmux|herdr] [--description <d> | --no-description] [--instructions-file <path> | --instructions-stdin] [--json]");
  const name = args[2];
  if (!name || name.startsWith("--")) bail("E_BAD_ARGS", "soul set needs a soul name");
  const ctx = dirFlag();
  const agentsRootFlag = flag("agents-root");
  if (agentsRootFlag === true) bail("E_BAD_ARGS", "--agents-root needs an absolute agents directory");
  let r;
  try { r = resolveOatsConfig(ctx); } catch (e) { bail(e.code || "E_CONFIG_BROKEN", e.message); }
  let soul;
  try { soul = selectSoul(scopeSouls(ctx, r).souls, name, agentsRootFlag, ctx); } catch (e) { bail(e.code || "E_SOUL_UNKNOWN", e.message); }
  if (!soul.editable.fields.length) bail("E_SOUL_READONLY", `${name} is a ${soul.kind} soul: ${soul.editable.reason}`);
  // Field changes, validated before anything is written.
  const changes = {};
  const has = (f) => args.includes(`--${f}`);
  const val = (f) => { const v = flag(f); if (v === true) bail("E_BAD_ARGS", `--${f} needs a value`); return v; };
  if (has("runtime")) { const v = val("runtime"); if (!["pi", "claude", "codex"].includes(v)) bail("E_BAD_ARGS", "--runtime must be pi, claude or codex"); changes.runtime = v; }
  if (has("model") && has("no-model")) bail("E_BAD_ARGS", "choose --model <m> or --no-model, not both");
  if (has("model")) { const v = val("model"); if (!v.trim()) bail("E_BAD_ARGS", "--model needs a model id (use --no-model to clear)"); changes.model = assertSafeConfigValue(v, "--model"); }
  if (has("no-model")) changes.model = null;
  if (has("yolo") && has("no-yolo")) bail("E_BAD_ARGS", "choose --yolo or --no-yolo, not both");
  if (has("yolo")) changes.yolo = true;
  if (has("no-yolo")) changes.yolo = false;
  if (has("backend")) { const v = val("backend"); if (!["tmux", "herdr"].includes(v)) bail("E_BAD_ARGS", "--backend must be tmux or herdr"); changes.backend = v; }
  if (has("launch-config") && has("no-launch-config")) bail("E_BAD_ARGS", "choose --launch-config <name> or --no-launch-config, not both");
  if (has("launch-config")) { const v = val("launch-config"); if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v)) bail("E_BAD_ARGS", "--launch-config needs a configuration name (letters, digits, dot, underscore, dash)"); changes["launch-config"] = v; }
  if (has("no-launch-config")) changes["launch-config"] = null;
  if (has("description") && has("no-description")) bail("E_BAD_ARGS", "choose --description <d> or --no-description, not both");
  if (has("description")) changes.description = assertSafeConfigValue(val("description"), "--description");
  if (has("no-description")) changes.description = null;
  let instructions;
  if (has("instructions-file") && has("instructions-stdin")) bail("E_BAD_ARGS", "choose --instructions-file or --instructions-stdin, not both");
  if (has("instructions-file")) {
    const file = val("instructions-file");
    let bytes;
    try { bytes = readFileSync(file); } catch (e) { bail("E_BAD_ARGS", `--instructions-file ${file}: ${e.message}`); }
    if (bytes.includes(0)) bail("E_BAD_ARGS", "--instructions-file must be text without NUL bytes");
    if (bytes.length > INSPECT_TEXT_CAP) bail("E_BAD_ARGS", `--instructions-file is ${bytes.length} bytes; the bound is ${INSPECT_TEXT_CAP} (what inspect can answer whole)`);
    instructions = bytes;
  }
  if (has("instructions-stdin")) {
    // The routed form: bytes arrive on stdin (the ssh transport), bounded
    // while reading, exactly like session receive.
    if (process.stdin.isTTY) bail("E_BAD_ARGS", "--instructions-stdin reads the instructions from stdin");
    let bytes;
    try { bytes = await readStreamBounded(process.stdin, INSPECT_TEXT_CAP); } catch (e) { bail(e.code || "E_BAD_ARGS", e.message); }
    if (bytes.includes(0)) bail("E_BAD_ARGS", "instructions must be text without NUL bytes");
    // An empty completed stream is a deliberate replacement with nothing,
    // exactly like an empty --instructions-file: the option itself states
    // the intent, and a TTY was refused above.
    instructions = bytes;
  }
  if (!Object.keys(changes).length && !instructions) bail("E_BAD_ARGS", "nothing to set: pass at least one of --runtime, --model/--no-model, --yolo/--no-yolo, --backend, --launch-config/--no-launch-config, --description/--no-description, --instructions-file");
  for (const f of Object.keys(changes)) if (!soul.editable.fields.includes(f)) bail("E_BAD_ARGS", `${f} is not an editable field of ${name}`);
  const before = { runtime: soul.runtime, model: soul.model, yolo: soul.yolo, backend: soul.backend, description: soul.description, launchConfig: soul.launchConfig };
  // soul.yaml: replace or append `key: value` lines in place; a cleared
  // field's line is removed; nothing else in the file moves.
  let yamlText = "";
  try { yamlText = readFileSync(soul.soulFile, "utf8"); } catch (e) { bail("E_SOUL_UNKNOWN", `${soul.soulFile}: ${e.message}`); }
  const lines = yamlText.replace(/\n*$/, "").split("\n");
  for (const [key, value] of Object.entries(changes)) {
    const idx = lines.findIndex((l) => new RegExp(`^${key}:\\s`).test(l) || l === `${key}:`);
    if (value === null) { if (idx >= 0) lines.splice(idx, 1); continue; }
    const line = `${key}: ${value}`;
    if (idx >= 0) lines[idx] = line; else lines.push(line);
  }
  const receipt = { soul: name, kind: soul.kind, agentsRoot: soul.agentsRoot, file: soul.soulFile, instructionsFile: soul.instructionsFile, changed: Object.keys(changes), before, instructions: null };
  if (Object.keys(changes).length) writeFileAtomic(soul.soulFile, lines.join("\n") + "\n");
  if (instructions) {
    const prev = (() => { try { return createHash("sha256").update(readFileSync(soul.instructionsFile)).digest("hex"); } catch { return null; } })();
    writeFileAtomic(soul.instructionsFile, instructions);
    receipt.instructions = { before: prev, after: createHash("sha256").update(instructions).digest("hex"), bytes: instructions.length };
  }
  let after;
  try { after = selectSoul(scopeSouls(ctx, r).souls, name, soul.agentsRoot, ctx); } catch { after = soul; }
  receipt.after = { runtime: after.runtime, model: after.model, yolo: after.yolo, backend: after.backend, description: after.description };
  if (JSON_MODE) { jsonOk(receipt); return; }
  console.log(`Updated soul ${name} (${shortPath(soul.soulFile)})${instructions ? ` and its instructions (${shortPath(soul.instructionsFile)})` : ""}: ${Object.keys(changes).map((k) => `${k}=${changes[k] === null ? "(cleared)" : changes[k]}`).join(", ") || "instructions only"}`);
  console.log("Future instances use these defaults; existing homes keep what they were composed with.");
}

function doctorJson(dir) {
  const ctx = resolve(dir || process.cwd());
  const soulName = flag("soul");
  const ws = doctorLockData(ctx);
  // A v2 deployment (oats-local.yaml found walking up) has NO config chain, layers,
  // acquired packages or installed tier: those keys are omitted, not emitted empty.
  if (ws.local) { console.log(JSON.stringify(doctorWorkspaceJson(ctx, soulName, ws), null, 2)); return; }
  const r = resolveForDoctor(ctx, soulName, { json: true });
  const mans = capabilityManifests(ctx);
  const composition = doctorComposition(ctx, soulName);
  const chain = configChain(ctx);
  const oasScopes = detectOasScopes(ctx);
  console.log(JSON.stringify({
    schemaVersion: 1,
    context: ctx,
    team: r.team || null,
    chain: r.chain.map((c) => ({ file: c._file, level: c._level, levelKind: levelOf(c._level) })),
    oasScopes,
    oasRemedy: oasScopes.length ? OAS_SCOPE_REMEDY : null,
    layers: Object.fromEntries(LAYERS.map((l) => [l, r.layers[l] ? {
      integration: r.layers[l].id, level: r.layers[l].level, inject: r.layers[l].inject,
      skills: [...(Array.isArray(r.layers[l].skills) ? r.layers[l].skills : (r.layers[l].skills ? [r.layers[l].skills] : []))],
      hooks: Object.keys(r.layers[l].hooks || {}), missingRequires: r.layers[l].missingRequires,
      provenance: r.provenance[l],
    } : { provenance: r.provenance[l] || null }])),
    kernelInjection: composition?.resolved.kernelInjection ?? r.kernelInjection,
    information: operationalKnowledgeNote(composition, soulName) ? [operationalKnowledgeNote(composition, soulName)] : [],
    injects: r.injects,
    capabilities: r.capabilities.map((c) => ({ id: c.id, layer: c.layer, command: c.command, origin: c.origin, provenance: c.provenance, settings: c.settings, skills: c.skills, inject: c.inject, hooks: Object.keys(c.hooks || {}), trust: c.trust })),
    acquired: Object.fromEntries(Object.entries(mans).map(([n, m]) => [n, { layer: m.layer, command: m.command, version: m.version, dir: m._dir, origin: m._origin, description: m.description }])),
retiredLocks: (() => { try { return Object.entries(readCapabilityLocks(ctx)); } catch { return []; } })()
      .filter(([id]) => retiredCapabilityReason(id))
      .map(([id, lock]) => ({ id, file: lock._file, reason: retiredCapabilityReason(id) })),
    retiredArtifacts: Object.entries(mans)
      .filter(([id]) => retiredCapabilityReason(id))
      .map(([id, m]) => ({ id, dir: m._dir, origin: m._origin, reason: retiredCapabilityReason(id) })),
    // Workspace model v2 (offline view): the lock (v3) and the deployment
    // declaration. Human and JSON doctor derive from ONE computation; a
    // fail-closed lock read is diagnosed via lockError, never consumed as data.
    workspace: ws.local ? { file: ws.local.path, ref: ws.local.workspace } : null,
    workspaceError: ws.localError,
    lockFile: ws.lockFile,
    packages: ws.packages,
    lockError: ws.lockError,
    composedInstructions: composition?.text,
    instructionBlocks: composition?.blocks,
  }, null, 2));
}

/** The v2 doctor payload: the deployment declaration + lock (offline) and, with
 *  --soul, the composed instructions. No v1 keys (chain/layers/acquired/injects…). */
function doctorWorkspaceJson(ctx, soulName, ws) {
  const composition = doctorComposition(ctx, soulName);
  return {
    schemaVersion: 1, workspaceApi: 2, context: ctx,
    workspace: { file: ws.local.path, ref: ws.local.workspace },
    workspaceError: ws.localError, lockFile: ws.lockFile, packages: ws.packages, lockError: ws.lockError,
    information: operationalKnowledgeNote(composition, soulName) ? [operationalKnowledgeNote(composition, soulName)] : [],
    composedInstructions: composition?.text, instructionBlocks: composition?.blocks,
  };
}
/** Kernel/bridge version skew (published in lockstep from one tag). */
function doctorVersionSkew() {
  const piPkgFile = join(homedir(), ".pi", "agent", "npm", "node_modules", "@awebai", "oats-pi", "package.json");
  if (!existsSync(piPkgFile)) return;
  const bridge = JSON.parse(readFileSync(piPkgFile, "utf8")).version;
  if (bridge !== OATS_VERSION) console.log(`WARNING: version skew — kernel ${OATS_VERSION}, pi bridge ${bridge}; run \`oats update\` (they publish in lockstep)\n`);
}
/** The "Workspace (v2, offline view)" + "Locked packages" sections, shared by both doctor shapes. */
function printDoctorWorkspace(ws) {
  console.log("\nWorkspace (v2, offline view):");
  if (ws.local) console.log(`  oats-local.yaml  ${shortPath(ws.local.path)}  → workspace ${ws.local.workspace}`);
  else if (ws.localError) console.log(`  ERROR: ${ws.localError.message} [${ws.localError.code}]`);
  else console.log("  (no oats-local.yaml found walking up — this scope realizes no v2 workspace; run `oats sync` from one that does)");
  console.log("\nLocked packages (oats-lock.json v3):");
  if (ws.lockError) {
    console.log(`  ERROR: ${ws.lockError.message} [${ws.lockError.code}]`);
    if (ws.lockError.file) console.log(`         the lock is never auto-repaired; delete ${shortPath(ws.lockError.file)} and run \`oats sync\``);
  } else if (!ws.packages.length) console.log(ws.lockFile ? "  (none)" : "  (no lock yet — run `oats sync`)");
  for (const p of ws.packages) {
    console.log(`  ${p.id} ${p.version}  ${p.source}  @ ${p.commit.slice(0, 12)}  ${p.approved ? `approved ${p.approved.at}` : "APPROVAL NEEDED (oats sync)"}`);
    if (p.capabilities.length) console.log(`             capabilities: ${p.capabilities.join(", ")}`);
  }
  console.log("  membership, discovery and drift need the remotes: `oats workspace status`, `oats sync`.");
}
function doctor(dir) {
  const ctx = resolve(dir || process.cwd());
  const soulName = flag("soul");
  const ws = doctorLockData(ctx);
  console.log(`oats doctor — resolved from ${shortPath(ctx)}\n`);
  doctorVersionSkew();
  if (ws.local) {
    // A v2 deployment: nothing is installed and there is no config chain — the v1
    // sections (Config chain / Layers / Kernel injection / Acquired packages / lock
    // warnings) would describe a tier this deployment does not have.
    const composition = doctorComposition(ctx, soulName);
    printDoctorWorkspace(ws);
    if (soulName) {
      const information = operationalKnowledgeNote(composition, soulName);
      if (information) console.log(`\nINFO: ${information}`);
      console.log(`\nFinal composed AGENTS.md for ${soulName}:\n\n${composition.text}`);
    } else console.log("\nPass --soul <name> to inspect final composed AGENTS.md.");
    return;
  }
  const chain = configChain(ctx);
  const r = resolveForDoctor(ctx, soulName);
  const composition = doctorComposition(ctx, soulName);

  console.log("Config chain (closest first):");
  if (chain.length === 0) console.log("  (none — no oats-config.yaml found walking up)");
  for (const c of chain) {
    console.log(`  ${shortPath(c._file)}  [${levelOf(c._level)}]`);
  }

  // An empty-looking chain over oas-* files is not an empty scope: it is a
  // pre-rename OAS deployment this kernel cannot read (aweb-abfy.1).
  const oasScopes = detectOasScopes(ctx);
  if (oasScopes.length) {
    console.log("");
    for (const f of oasScopes) console.log(`UN-MIGRATED OAS SCOPE: ${shortPath(f.dir)}  (${f.files.join(", ")})`);
    console.log(`  ${OAS_SCOPE_REMEDY}`);
  }

  if (r.team) console.log(`\nTeam: ${r.team.name}${r.team.id ? `  (id: ${r.team.id})` : ""}  [scope: ${shortPath(r.team.scope)}]`);

  console.log("\nLayers:");
  for (const layer of LAYERS) {
    const l = r.layers[layer];
    const prov = r.provenance[layer];
    if (!prov) { console.log(`  ${layer.padEnd(10)} (unresolved — no declaration in chain)`); continue; }
    if (!l) { console.log(`  ${layer.padEnd(10)} none  [${prov}]`); continue; }
    console.log(`  ${layer.padEnd(10)} ${l.id}  [${prov}]`);
    if (l.inject) console.log(`             inject: ${shortPath(l.inject)}`);
    const skills = Array.isArray(l.skills) ? l.skills : (l.skills ? [l.skills] : []);
    if (skills.length) console.log(`             skills: ${skills.map(shortPath).join(", ")}`);
    const hooks = Object.keys(l.hooks || {});
    if (hooks.length) console.log(`             hooks:  ${hooks.join(", ")}`);
    for (const miss of l.missingRequires || []) {
      console.log(`             MISSING REQUIREMENT: ${miss.command} — ${miss.why || ""}${miss.install ? ` (install: ${miss.install})` : ""}`);
    }
  }

  console.log("\nKernel injection:");
  const kernelInjection = composition?.resolved.kernelInjection ?? r.kernelInjection;
  console.log(`  oats: ${kernelInjection?.inject ? shortPath(kernelInjection.inject) : "none"}  [${kernelInjection?.provenance || "default"}]`);

  console.log("\nUnconditional injections (outermost→innermost):");
  if (r.injects.length === 0) console.log("  (none)");
  for (const inj of r.injects) console.log(`  ${inj.source}: ${shortPath(inj.file)}`);

  for (const mode of WORK_MODES) {
    const wm = resolveWorkMode(ctx, mode);
    console.log(`\nWork mode ${mode}: inject ${wm.inject ? shortPath(wm.inject) : "none"}${wm.setup ? `, setup ${shortPath(wm.setup)}` : ""}`);
  }

  console.log("\nActive capabilities:");
  if (!r.capabilities.length) console.log("  (none)");
  for (const cap of r.capabilities) {
    console.log(`  ${cap.id}${cap.layer ? `  layer: ${cap.layer}` : ""}  [${cap.provenance.join(" + ")}]`);
    console.log(`             trust: ${cap.trust.trusted ? "approved" : `BLOCKED (${cap.trust.reason})`}`);
    if (cap.inject) console.log(`             inject: ${shortPath(cap.inject)}`);
    if (cap.skills.length) console.log(`             skills: ${cap.skills.map(shortPath).join(", ")}`);
  }
  console.log("\nAcquired capability packages:");
  for (const [name, m] of Object.entries(capabilityManifests(ctx))) {
    const missing = capabilityMissingRequires(name, ctx);
    console.log(`  ${name.padEnd(16)} layer: ${(m.layer || "additive").padEnd(10)} origin: ${m._origin}${missing.length ? `  (missing: ${missing.map((x) => x.command).join(", ")})` : ""}`);
    const retiredReason = retiredCapabilityReason(name);
    if (retiredReason) {
      const installed = String(m._origin).startsWith("installed:");
      console.log(`             WARNING: artifact of a retired capability — ${retiredReason}${installed ? `; also delete ${shortPath(m._dir)}` : ` (origin ${m._origin}: remove its declaration; the source tree at ${shortPath(m._dir)} is yours to keep or drop)`}`);
    }
  }
  // readCapabilityLocks fails closed on invalid legacy entries — doctor is the
  // diagnosis surface, so catch the typed error and render it (never using the data).
  let locks = {};
  try { locks = readCapabilityLocks(ctx); }
  catch (e) {
    if (e.code !== "invalid-lock") throw e;
    const prov = Array.isArray(e.provenance) ? e.provenance[0] : undefined;
    console.log(`  ERROR: ${e.message} [invalid-lock]`);
    if (prov?.file) console.log(`         fix or remove the entry in ${shortPath(prov.file)} — never auto-repaired; legacy trust/restore fail closed until it is valid`);
  }
  const mans = capabilityManifests(ctx);
  for (const [id, lock] of Object.entries(locks)) {
    const retiredReason = retiredCapabilityReason(id);
    if (retiredReason) { console.log(`  WARNING: ${id} is locked in ${shortPath(lock._file)} but ${retiredReason}`); continue; }
    if (!mans[id]) console.log(`  WARNING: ${id} is locked in ${shortPath(lock._file)} but not acquired — run \`oats sync\``);
  }
  for (const [id, m] of Object.entries(mans)) {
    if (!String(m._origin).startsWith("installed:")) continue;
    // SCOPE-EXACT on the v2 side. `m._capabilityLock` is the row from the
    // artifact's OWN scope's lock (capabilityManifests annotates it there), and
    // that is the only row that can lock this artifact: the merged chain would
    // let an outer scope's lock — or a lock-only ancestor with no config at all
    // — silence an unlocked inner copy that WINS discovery precedence and
    // activates. The legacy arm stays chain-merged: v1 parity is unchanged.
    if (m._capabilityLock || Object.hasOwn(locks, id)) continue;
    console.log(`  WARNING: ${id} at ${shortPath(m._dir)} is in installed/ but has no lock entry — reacquire it or move it to owned/`);
  }
  if (existsSync(LEGACY_HOME_CAPABILITIES_DIR)) console.log(`  WARNING: legacy ~/.oats/capabilities exists and is no longer discovered — reinstall its packages at a config scope and remove it`);

  // Workspace model v2: nothing is installed. Doctor reports the lock (v3) and
  // the deployment declaration OFFLINE — membership, discovery and package
  // resolution go to the remotes and belong to `oats sync` / `oats workspace status`.
  printDoctorWorkspace(ws);

  if (soulName) {
    const information = operationalKnowledgeNote(composition, soulName);
    if (information) console.log(`\nINFO: ${information}`);
    console.log(`\nFinal composed AGENTS.md for ${soulName}:\n\n${composition.text}`);
  } else console.log("\nPass --soul <name> to inspect final composed AGENTS.md.");
}

// ---------- config editing (structural: parse → mutate → re-serialize the capabilities block) ----------
/** Replace (or append, or drop with "") the top-level launch-configs block:
 *  the span from its key line (bare, quoted, or the inline `launch-configs: {...}`
 *  form) to the next top-level line is replaced; every byte before and after
 *  that span stays exactly as it was. Two declarations of the key are refused
 *  rather than guessed at. */
function replaceLaunchConfigsBlock(text, serialized) {
  const keyLine = /^(["']?)launch-configs\1:(\s*(?:#.*)?|\s+\S.*)?$/;
  const lines = text.split("\n");
  const starts = lines.map((l, i) => keyLine.test(l) ? i : -1).filter((i) => i >= 0);
  if (starts.length > 1) throw Object.assign(new Error(`oats-config.yaml declares launch-configs ${starts.length} times (lines ${starts.map((i) => i + 1).join(", ")}); keep one`), { code: "E_CONFIG_BROKEN" });
  const block = serialized ? serialized.replace(/\n$/, "").split("\n") : [];
  if (!starts.length) {
    if (!serialized) return text;
    const sep = text === "" ? "" : text.endsWith("\n") ? "\n" : "\n\n"; // always its own blank separator, which removal takes back
    return text + sep + serialized;
  }
  const start = starts[0];
  // The block runs to the next real top-level key (a column-zero line that
  // is not a comment). Blank lines and column-zero comments directly ahead
  // of that key, or at the end of the file, are not part of it and stay
  // where they are; a column-zero comment followed by more indented entries
  // is inside the block (and is regenerated away with it).
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] !== "" && !/^\s/.test(lines[i]) && !lines[i].startsWith("#")) { end = i; break; }
  }
  while (end > start + 1 && (lines[end - 1] === "" || lines[end - 1].startsWith("#"))) end--;
  const tail = lines.slice(end);
  if (!tail.length) tail.push(""); // the block ended the file: the result still ends with a newline
  let prefixEnd = start;
  // Dropping the block drops the one blank line that separated it (before it
  // when it was appended, else after it); replacing it keeps one blank line
  // between the block and what follows.
  if (!block.length) { if (start > 0 && lines[start - 1] === "") prefixEnd = start - 1; else if (tail[0] === "" && tail.length > 1) tail.shift(); }
  const replaced = [...lines.slice(0, prefixEnd), ...block];
  if (block.length && tail[0] !== "") replaced.push("");
  return [...replaced, ...tail].join("\n");
}

// ---------- launch configurations ----------
const yamlQuoted = (v) => JSON.stringify(String(v));
/** The `launch-configs:` block, names sorted, every string double-quoted
 *  with JSON escapes (read back by the same rules), lists as block
 *  sequences: spaces, quotes, commas and metacharacters round-trip exactly. */
function serializeLaunchConfigs(map) {
  const names = Object.keys(map).sort();
  if (!names.length) return "";
  const lines = ["launch-configs:"];
  for (const name of names) {
    const e = map[name];
    lines.push(`  ${name}:`, `    runtime: ${e.runtime}`);
    if (e.executable !== undefined) lines.push(`    executable: ${yamlQuoted(e.executable)}`);
    if (e.args?.length) { lines.push("    args:"); for (const a of e.args) lines.push(`      - ${yamlQuoted(a)}`); }
    const envNames = Object.keys(e.env || {}).sort();
    if (envNames.length) {
      lines.push("    env:");
      for (const n of envNames) { const v = e.env[n]; if (typeof v === "string") lines.push(`      ${n}: ${yamlQuoted(v)}`); else lines.push(`      ${n}:`, `        fromEnv: ${v.fromEnv}`); }
    }
    if (e.model !== undefined) lines.push(`    model: ${yamlQuoted(e.model)}`);
    if (e.yolo !== undefined) lines.push(`    yolo: ${e.yolo}`);
  }
  return lines.join("\n") + "\n";
}
/** Only the declared keys, in canonical order, from a validated entry. */
function normalizeLaunchConfig(e) {
  return {
    runtime: e.runtime,
    ...(e.executable !== undefined ? { executable: e.executable } : {}),
    ...(e.args?.length ? { args: [...e.args] } : {}),
    ...(e.env && Object.keys(e.env).length ? { env: Object.fromEntries(Object.keys(e.env).sort().map((n) => [n, typeof e.env[n] === "string" ? e.env[n] : { fromEnv: e.env[n].fromEnv }])) } : {}),
    ...(e.model !== undefined ? { model: e.model } : {}),
    ...(e.yolo !== undefined ? { yolo: e.yolo } : {}),
  };
}
function readLaunchConfigsModel(file) {
  if (!existsSync(file)) return {};
  const cfg = withConfigFile(file, () => parseYamlNested(readFileSync(file, "utf8")));
  const map = cfg["launch-configs"] || {};
  for (const [name, entry] of Object.entries(map)) validateLaunchConfig(name, entry, file);
  const out = Object.create(null); // a name may be "constructor": membership is own only
  for (const [n, e] of Object.entries(map)) out[n] = normalizeLaunchConfig(e);
  return out;
}
/** What a GUI or an operator sees of one configuration. Environment values
 *  never leave the file: a literal is answered as {redacted: true} (literals
 *  are non-secret by contract, but no value is shown anywhere) and a
 *  reference as {fromEnv: NAME}. An editor keeps a literal it cannot see with
 *  `set --keep-env`. */
function publicLaunchConfig(e, extra = {}) {
  const env = Object.fromEntries(Object.keys(e.env || {}).sort().map((n) => [n, typeof e.env[n] === "string" ? { redacted: true } : { fromEnv: e.env[n].fromEnv }]));
  return { runtime: e.runtime, executable: e.executable ?? null, args: [...(e.args || [])], env, model: e.model ?? null, yolo: e.yolo ?? null, ...extra };
}
/** The scope a launch-config command reads: --dir (or cwd), a running
 *  home's recorded context (--home), or a soul's own member context
 *  (--soul, with --dir/--agents-root as inspect takes them). */
function launchConfigContext(bail) {
  const homeFlag = flag("home");
  const soulFlag = flag("soul");
  if (homeFlag !== undefined && soulFlag !== undefined) bail("E_BAD_ARGS", "choose --home or --soul, not both");
  if (homeFlag !== undefined) {
    if (homeFlag === true || !isAbsolute(String(homeFlag))) bail("E_BAD_ARGS", "--home needs an absolute instance home");
    const home = realOrResolved(String(homeFlag));
    let meta;
    try { meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8")); } catch (e) { bail("E_HOME_UNKNOWN", `${home} is not an OATS instance home (${e.message})`); }
    const ctx = homeContexts(home, meta)[0];
    return { context: ctx, selected: { home, instance: meta.instance || null } };
  }
  const ctx = dirFlag();
  if (soulFlag !== undefined) {
    if (soulFlag === true) bail("E_BAD_ARGS", "--soul needs a soul name");
    const agentsRootFlag = flag("agents-root");
    if (agentsRootFlag === true) bail("E_BAD_ARGS", "--agents-root needs an absolute agents directory");
    let r;
    try { r = resolveOatsConfig(ctx); } catch (e) { bail(e.code || "E_CONFIG_BROKEN", e.message); }
    let soul;
    try { soul = selectSoul(scopeSouls(ctx, r).souls, String(soulFlag), agentsRootFlag, ctx); } catch (e) { bail(e.code || "E_SOUL_UNKNOWN", e.message); }
    return { context: memberContextOf(soul, ctx, flag("dir") !== undefined, bail), selected: { soul: soul.name, agentsRoot: soul.agentsRoot } };
  }
  return { context: ctx, selected: null };
}
/** oats launch-config preview: what a start of a home (or a new instance of
 *  a soul) would run under a selection, resolved against the current scoped
 *  configuration, preflighted, read-only; environment values withheld and
 *  the prompt named, never the TASK body. */
function launchPreview(bail) {
  const sel = { launchConfig: flag("launch-config"), runtime: flag("runtime"), model: flag("model"), yolo: yoloFlag() };
  for (const k of ["launch-config", "runtime", "model"]) if (flag(k) === true) bail("E_BAD_ARGS", `--${k} needs a value`);
  if (sel.runtime !== undefined && !LAUNCH_RUNTIMES.includes(sel.runtime)) bail("E_BAD_ARGS", `--runtime must be one of ${LAUNCH_RUNTIMES.join(", ")}`);
  const { context, selected } = launchConfigContext(bail);
  if (!selected) bail("E_BAD_ARGS", "preview needs --home <abs> (an existing instance) or --soul <name> [--dir <scope>] (a new instance)");
  const selectionGiven = sel.launchConfig !== undefined || sel.runtime !== undefined || sel.model !== undefined || sel.yolo !== undefined;
  let meta = null, agentLike, home, instance;
  if (selected.home) {
    home = selected.home;
    try { meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8")); } catch (e) { bail("E_HOME_UNKNOWN", `${home}: ${e.message}`); }
    instance = meta.instance || basename(home);
    if (!(meta.launch && typeof meta.launch === "object") && !selectionGiven) {
      // A home that predates recipes, asked nothing: its frozen command is
      // described as is. Under a selection it goes through the planner,
      // whose narrow conversion is the one session restart uses.
      let d;
      try { d = describeLaunchCommand(meta.command); } catch (e) { bail(e.code || "E_LAUNCH_COMMAND_UNSUPPORTED", e.message); }
      jsonOk({ context, selected, selection: { source: "frozen-command", launchConfig: null, runtime: null, model: null, yolo: null }, runtime: meta.runtime, model: meta.model || null, modelSource: meta.model ? "recorded" : "native default", yolo: meta.yolo ?? null, launchConfig: null, launchConfigSource: null, executable: { path: d.executable, declared: null, resolvedFrom: "recorded" }, argv: d.argv, environment: d.environment, command: redactLaunchCommand(meta.command), prompt: { kind: "task-file", file: "TASK.md" }, hooks: null, preflight: [{ check: "recipe", ok: true, detail: "frozen command; conversion on restart" }], ok: true });
      return;
    }
    const agentsRoot = agentsRootOfHome(home);
    const agent = (() => { try { return findAgent(agentsRoot, meta.agent); } catch { return undefined; } })();
    agentLike = agent || { runtime: meta.runtime, model: meta.model, yolo: meta.yolo };
  } else {
    let r0;
    try { r0 = resolveOatsConfig(context); } catch (e) { bail(e.code || "E_CONFIG_BROKEN", e.message); }
    const soul = scopeSouls(context, r0).souls.find((x) => x.name === selected.soul && x.agentsRoot === selected.agentsRoot);
    agentLike = { runtime: soul.runtime, model: soul.model, yolo: soul.yolo, "launch-config": soul.launchConfig };
    instance = `${soul.name}-<purpose>`; home = join(selected.agentsRoot, soul.name, "instances", instance);
  }
  let r;
  try { r = resolveOatsConfig(context, selected.soul || meta?.agent); } catch (e) { bail(e.code || "E_CONFIG_BROKEN", e.message); }
  // The same planner a start uses, in preview mode: failed checks are listed, nothing is touched.
  let plan;
  try { plan = planLaunch({ home, instance, meta, contextDir: context, agentLike, selection: sel, resolvedCfg: r, preview: true }); } catch (e) { bail(e.code || "E_BAD_ARGS", e.message); }
  const { recipe } = plan;
  const command = renderLaunchRecipe(recipe, { home, instance, redact: true });
  const d = describeLaunchCommand(command);
  const environment = d.environment.map((e) => e.reference && recipe.env[e.name]?.fromEnv ? { name: e.name, fromEnv: recipe.env[e.name].fromEnv } : e);
  jsonOk({ context, selected, selection: { source: plan.selectionSource, launchConfig: recipe.launchConfig, runtime: sel.runtime ?? null, model: sel.model ?? null, yolo: sel.yolo ?? null }, runtime: plan.runtime, model: recipe.model, modelSource: plan.modelSource, yolo: recipe.yolo ?? null, launchConfig: recipe.launchConfig, launchConfigSource: recipe.launchConfigSource, executable: { path: plan.executable.path, declared: plan.executable.declared ?? null, resolvedFrom: plan.executable.resolvedFrom }, argv: d.argv, environment, command, prompt: recipe.prompt, hooks: redactLaunchRecipe(recipe).hooks, preflight: plan.preflight, ok: plan.ok });
}
async function launchConfigCmd() {
  const bail = (code, msg) => (JSON_MODE ? jsonFail(code, msg) : die(msg));
  dropAmbientRoot();
  const sub = args[1];
  const usage = "usage: oats launch-config list [--dir <scope> | --home <abs> | --soul <name> [--dir <scope>] [--agents-root <abs>]] [--json] | set <name> --file <json> [--keep-env] [--dir <scope>] [--json] | remove <name> [--dir <scope>] [--json] | preview (--home <abs> | --soul <name> [--dir <scope>]) [--launch-config <name>|none] [--runtime r] [--model m] [--yolo|--no-yolo] --json";
  if (sub === "preview") { launchPreview(bail); return; }
  if (!["list", "set", "remove"].includes(sub)) bail("E_USAGE", usage);
  const { context: dir, selected } = sub === "list" ? launchConfigContext(bail) : { context: dirFlag(), selected: null };
  if (sub !== "list" && (flag("home") !== undefined || flag("soul") !== undefined)) bail("E_BAD_ARGS", `launch-config ${sub} writes one scope's oats-config.yaml: address it with --dir, not --home or --soul`);
  const level = levelOf(dir);
  const file = join(dir, "oats-config.yaml");
  const effective = () => {
    const r = resolveOatsConfig(dir);
    return Object.values(r.launchConfigs || {}).sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ name: e.name, ...publicLaunchConfig(e, { source: e.source, shadows: e.shadows }) }));
  };
  if (sub === "list") {
    let configurations;
    try { configurations = effective(); } catch (e) { bail(e.code || "E_CONFIG_BROKEN", e.message); }
    if (JSON_MODE) { jsonOk({ context: dir, level, file: existsSync(file) ? file : null, selected, configurations }); return; }
    if (!configurations.length) { console.log(`No launch configurations are effective at ${dir}`); return; }
    for (const c of configurations) {
      const env = Object.entries(c.env).map(([n, v]) => v.fromEnv ? `${n}=$${v.fromEnv}` : `${n}=<redacted>`).join(" ");
      console.log(`${c.name}: ${c.runtime}${c.executable ? ` ${c.executable}` : ""}${c.args.length ? ` ${c.args.map((a) => JSON.stringify(a)).join(" ")}` : ""}${env ? ` [${env}]` : ""}${c.model ? ` model ${c.model}` : ""}${c.yolo !== null ? ` yolo ${c.yolo}` : ""}  (${c.source}${c.shadows.length ? `; shadows ${c.shadows.join(", ")}` : ""})`);
    }
    return;
  }
  const name = args[2];
  if (!name || name.startsWith("--")) bail("E_BAD_ARGS", `launch-config ${sub} needs a configuration name`);
  const text = existsSync(file) ? readFileSync(file, "utf8") : `name: ${scaffoldConfigName(dir)}\n`;
  let model;
  try { model = readLaunchConfigsModel(file); } catch (e) { bail(e.code || "E_CONFIG_BROKEN", e.message); }
  const declaredHere = Object.hasOwn(model, name);
  const before = declaredHere ? publicLaunchConfig(model[name]) : null;
  if (sub === "remove") {
    if (!declaredHere) bail("E_LAUNCH_CONFIG_UNKNOWN", `${name} is not declared at ${level} level (${shortPath(file)}); an inherited configuration is removed at the scope that declares it`);
    delete model[name];
  } else {
    const f = flag("file");
    if (!f || f === true) bail("E_BAD_ARGS", "launch-config set needs --file <json> (an object with runtime and optional executable, args, env, model, yolo)");
    let entry;
    // A parse error is reported without the parser's text: its message can
    // quote the document, and a definition may carry environment literals.
    let raw;
    if (f === "-") {
      // The routed form: the definition's bytes arrive on stdin (the ssh
      // transport); no local file name crosses the wire.
      if (process.stdin.isTTY) bail("E_BAD_ARGS", "--file - reads the definition from stdin");
      try { raw = (await readStreamBounded(process.stdin, INSPECT_TEXT_CAP)).toString("utf8"); } catch (e) { bail(e.code || "E_BAD_ARGS", e.message); }
    } else {
      try { raw = readFileSync(f, "utf8"); } catch (e) { bail("E_BAD_ARGS", `--file ${f}: ${e.code === "ENOENT" ? "no such file" : e.code || "cannot read"}`); }
    }
    try { entry = JSON.parse(raw); } catch { bail("E_BAD_ARGS", `--file ${f} is not valid JSON (one object with runtime and optional executable, args, env, model, yolo)`); }
    if (args.includes("--keep-env")) {
      // An editor that saw only redacted values keeps the environment of the
      // definition EFFECTIVE at this scope for that name (this scope's own, or
      // the inherited one it is overriding): a one-time copy into the complete
      // replacement entry, not inheritance; whole-entry shadowing stays.
      if (entry && typeof entry === "object" && entry.env !== undefined) bail("E_BAD_ARGS", "--keep-env keeps the environment of the effective definition; omit env from --file");
      let current;
      try { const all = resolveOatsConfig(dir).launchConfigs || {}; current = Object.hasOwn(all, name) ? all[name] : undefined; } catch (e) { bail(e.code || "E_CONFIG_BROKEN", e.message); }
      if (!current) bail("E_LAUNCH_CONFIG_UNKNOWN", `--keep-env: no launch configuration ${name} is effective at ${dir}, so there is no environment to keep; declare it with env`);
      if (entry && typeof entry === "object" && Object.keys(current.env || {}).length) entry.env = { ...current.env };
    }
    try { validateLaunchConfig(name, entry, `--file ${f}`); } catch (e) { bail(e.code || "E_LAUNCH_CONFIG_INVALID", e.message); }
    model[name] = normalizeLaunchConfig(entry);
  }
  let next;
  try { next = replaceLaunchConfigsBlock(text, serializeLaunchConfigs(model)); } catch (e) { bail(e.code || "E_CONFIG_BROKEN", `${e.message}; nothing was written`); }
  // What is written must read back as exactly what was asked, by the kernel's
  // own reader, before a byte of the file changes.
  let readBack;
  try { readBack = parseYamlNested(next)["launch-configs"] || {}; } catch (e) { bail("E_LAUNCH_CONFIG_INVALID", `the rewritten block does not parse: ${e.message}; nothing was written`); }
  const canonical = (m) => JSON.stringify(Object.keys(m).sort().map((n) => [n, normalizeLaunchConfig(m[n])]));
  const same = canonical(readBack) === canonical(model);
  if (!same) bail("E_LAUNCH_CONFIG_INVALID", `${name} would not read back as written; nothing was written`);
  writeFileAtomic(file, next);
  let eff = null;
  try { eff = effective().find((c) => c.name === name) || null; } catch (e) { eff = { error: e.message }; }
  const receipt = { name, action: sub, level, file, before, after: Object.hasOwn(model, name) ? publicLaunchConfig(model[name]) : null, effective: eff };
  if (JSON_MODE) { jsonOk(receipt); return; }
  console.log(sub === "set" ? `Declared launch configuration ${name} at ${level} level (${shortPath(file)})` : `Removed launch configuration ${name} from ${level} level (${shortPath(file)})${eff ? `; ${eff.source} now provides it` : ""}`);
}


/** `oats instance <git|diff> <instance>` — K1: read-only Git observation of one
 *  instance's work tree. The instance is addressed qualified: an explicit
 *  --home, or a name under the --dir scope (team roots included) that resolves
 *  to exactly one home; several homes refuse with every candidate named. */
function instanceCmd() {
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  const sub = args[1], name = args[2];
  const usage = "usage: oats instance events <instance> [--limit <n>] [--since <iso>] [--home <abs>] [--dir <d>] [--json] | oats instance git <instance> [--home <abs>] [--dir <d>] [--json] | oats instance diff <instance> --file <id> --revision <rev> [--index-revision <rev>] [--home <abs>] [--dir <d>] [--json] | oats instance stop <instance> (--plan | --apply --plan-revision <rev> --idempotency-key <key>) [--no-recursive] [--grace-ms <n>] [--home <abs>] [--dir <d>] [--json]";
  if (!["git", "diff", "stop", "events"].includes(sub) || !name || name.startsWith("--")) return bail("E_BAD_ARGS", usage);
  dropAmbientRoot();
  if (sub === "events") {
    // K7: typed producer events, bounded window; nothing inferred.
    const homeOpt = flag("home"); if (homeOpt === true || (homeOpt !== undefined && !isAbsolute(homeOpt))) return bail("E_BAD_ARGS", "--home needs an absolute instance home");
    let root; try { root = ensureRoot(dirFlag()); } catch (e) { return bail(e.code || "E_NO_ROOT", e.message); }
    const limit = flag("limit"); const since = flag("since");
    if (limit === true || since === true) return bail("E_BAD_ARGS", usage);
    try {
      const { resolveInstance } = await_import_lifecycle();
      // K7b: --home is an ADDRESS claim, checked like K1 — it must be a home of
      // exactly this name under the scope (E_HOME_MISMATCH otherwise).
      const home = resolveInstance(dirFlag(), root, name, homeOpt ? { home: homeOpt } : {}).home;
      const ev = readEvents(home, { ...(limit !== undefined ? { limit: Math.max(1, Math.min(2000, Number(limit) || 200)) } : {}), ...(since ? { since } : {}) });
      if (JSON_MODE) { jsonOk(ev); return; }
      console.log(`${ev.instance}: ${ev.returned} of ${ev.count} event(s)${ev.truncated ? " (window truncated)" : ""}${ev.waitingOnYou ? ` — waiting on you since ${ev.waitingOnYou.since} (${ev.waitingOnYou.producer})` : ""}`);
      for (const e of ev.events) console.log(`  ${e.at ?? "?"}  ${e.kind.padEnd(20)} ${e.producer}${e.data ? `  ${JSON.stringify(e.data).slice(0, 120)}` : ""}`);
      return;
    } catch (e) { return bail(e.code || "E_EVENTS_FAILED", e.message, e.candidates ? { candidates: e.candidates } : undefined); }
  }
  if (sub === "stop") {
    // K3: plan → apply. The plan is what a confirmation shows; apply carries
    // its revision back and refuses if reality moved.
    const homeOpt = flag("home");
    if (homeOpt === true || (homeOpt !== undefined && !isAbsolute(homeOpt))) return bail("E_BAD_ARGS", "--home needs an absolute instance home");
    let root; try { root = ensureRoot(dirFlag()); } catch (e) { return bail(e.code || "E_NO_ROOT", e.message); }
    const recursive = !args.includes("--no-recursive");
    const wantPlan = args.includes("--plan"), wantApply = args.includes("--apply");
    if (wantPlan === wantApply) return bail("E_BAD_ARGS", "stop needs exactly one of --plan or --apply");
    try {
      if (wantPlan) {
        const plan = planStop(dirFlag(), root, name, { home: homeOpt, recursive });
        if (JSON_MODE) { jsonOk(plan); return; }
        console.log(`stop ${name}${recursive ? " (and recorded children)" : ""} — plan ${plan.planRevision}`);
        for (const t of plan.targets) console.log(`  ${"  ".repeat(t.depth)}${t.instance}: session ${t.session.state}${t.work.observed ? `, ${t.work.changed} changed / ${t.work.untracked} untracked on ${t.work.branch ?? "detached"}` : ", work not observed"}${t.midTask === true ? " — mid-task" : t.midTask === "unknown" ? " — activity unknown" : ""}`);
        for (const n of plan.notes) console.log(`  note: ${n}`);
        console.log(`apply with: oats instance stop ${name} --apply --plan-revision ${plan.planRevision} --idempotency-key <key>`);
        return;
      }
      const rev = flag("plan-revision"), key = flag("idempotency-key"), grace = flag("grace-ms");
      if (rev === true || key === true || grace === true) return bail("E_BAD_ARGS", usage);
      const receipt = applyStop(dirFlag(), root, name, { home: homeOpt, recursive, planRevision: rev, idempotencyKey: key, ...(grace !== undefined ? { graceMs: Number(grace) } : {}) });
      if (JSON_MODE) { jsonOk(receipt); return; }
      for (const r of receipt.results) console.log(`  ${r.instance}: ${r.ok ? (r.stopped ? "stopped" : `already ${r.state}`) : `${r.code} — ${r.message}`}`);
      console.log(receipt.ok ? `stopped${receipt.replayed ? " (replayed receipt)" : ""}; home, work, transcript and launch configuration retained — restart with \`oats session restart\`` : "some targets are still running; nothing was escalated");
      if (!receipt.ok) process.exit(1);
      return;
    } catch (e) { return bail(e.code || "E_LIFECYCLE_FAILED", e.message, e.plan ? { plan: e.plan } : e.candidates ? { candidates: e.candidates } : undefined); }
  }
  let home = flag("home");
  if (home === true) return bail("E_BAD_ARGS", "--home needs an absolute instance home");
  if (home !== undefined && !isAbsolute(home)) return bail("E_BAD_ARGS", "--home needs an absolute instance home");
  if (home === undefined) {
    let root;
    try { root = ensureRoot(dirFlag()); } catch (e) { return bail(e.code || "E_NO_ROOT", e.message); }
    let r; try { r = resolveOatsConfig(dirFlag()); } catch (e) { return bail(e.code || "E_CONFIG_BROKEN", e.message); }
    const roots = [...new Set([root, ...(r.team ? teamAgentRoots(r.team.scope) : [])].map((p) => realOrResolved(p)))];
    const candidates = [];
    for (const rt of roots) for (const hit of findInstanceHomes(rt, name)) candidates.push({ root: rt, agent: hit.agent?.name ?? null, home: hit.home });
    if (!candidates.length) return bail("E_SESSION_UNKNOWN", `no instance ${JSON.stringify(name)} under ${roots.join(", ")}`);
    if (candidates.length > 1) return bail("E_AMBIGUOUS_INSTANCE", `instance ${JSON.stringify(name)} has ${candidates.length} homes; pass --home <abs>`, { candidates });
    home = candidates[0].home;
  } else if (basename(home) !== name) return bail("E_HOME_MISMATCH", `--home ${home} is not the home of instance ${JSON.stringify(name)}`);
  try {
    if (sub === "git") {
      const observed = observeInstanceGit(home);
      if (JSON_MODE) { jsonOk(observed); return; }
      const o = observed.observation;
      console.log(`${observed.instance} — ${shortPath(o.worktree)} @ ${o.branch ?? (o.detached ? `detached ${o.revision.slice(0, 12)}` : "unborn")}`);
      console.log(`  upstream: ${observed.upstream.ref ? `${observed.upstream.ref} +${observed.upstream.ahead} -${observed.upstream.behind}` : "none (ahead/behind unknown)"}`);
      console.log(`  base: ${observed.base.ref ? `${observed.base.ref} +${observed.base.ahead} -${observed.base.behind} (merge-base ${observed.base.mergeBase?.slice(0, 12)})` : "unknown"}`);
      console.log(`  files: ${observed.files.length} (${Object.entries(observed.summary).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ") || "clean"})`);
      for (const f of observed.files) console.log(`    ${f.xy} ${f.origPath ? `${f.origPath} -> ` : ""}${f.path}  [${f.id}]`);
      for (const n of observed.notes) console.log(`  note: ${n}`);
      return;
    }
    const fileId = flag("file"), revision = flag("revision"), indexRevision = flag("index-revision");
    if (fileId === true || revision === true || indexRevision === true) return bail("E_BAD_ARGS", usage);
    const d = diffInstanceFile(home, { fileId, revision, indexRevision });
    if (JSON_MODE) { jsonOk(d); return; }
    console.log(`${d.file.origPath ? `${d.file.origPath} -> ` : ""}${d.file.path} (${d.file.kind}, against ${d.against})${d.binary ? " [binary]" : ""}${d.truncated ? ` [truncated at ${d.limit} bytes]` : ""}`);
    if (!d.binary) process.stdout.write(d.patch);
  } catch (e) {
    bail(e.code || "E_GIT_FAILED", e.message, e.observation ? { observation: e.observation } : undefined);
  }
}
/** `oats readiness [--soul <name> [--agents-root <abs>]] [--home <abs>] [--verify-signatures] [--policy] [--dir <d>] --json` — K5. */
function readinessCmd() {
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  dropAmbientRoot();
  // A captured incarnation's readiness comes from its retained resolution, not
  // from the current configuration this command reads; refuse before inspecting.
  const homeArg = flag("home");
  if (homeArg && homeArg !== true) {
    let capturedMeta = null; try { capturedMeta = JSON.parse(readFileSync(join(String(homeArg), "instance.json"), "utf8")); } catch { /* computeInspect reports the unreadable home */ }
    if (capturedMeta?.executionBinding || capturedMeta?.captured) return bail("E_UNSUPPORTED_MODE", `${basename(String(homeArg))} is a captured incarnation: its readiness is the retained resolution's, not the current configuration's (inspect it with oats operation --deployment/--resolution)`, { home: String(homeArg), captured: true });
  }
  const inspect = computeInspect({ onFail: bail });
  if (!inspect) return;
  const soul = flag("soul") === true ? null : flag("soul") || inspect.selected?.soul || null;
  const verify = args.includes("--verify-signatures");
  let catalog = null; try { catalog = describeOfficialCatalog(); catalog = { packages: Object.fromEntries(catalog.packages.map((p) => [p.package, p])) }; } catch { catalog = null; }
  const deploymentDir = inspect.scope?.context ?? null;
  // Echo the exact selector this read was made with, so a consumer can bind the
  // result to its own admitted target without inventing a revision.
  // Every field is the argument AS GIVEN (no realpath): a consumer compares it
  // byte-exact with what it sent. The canonical scope is subject.context.
  const given = (name) => { const v = flag(name); return v && v !== true ? String(v) : null; };
  const agentsRootArg = given("agents-root"), dirArg = given("dir");
  const selector = homeArg && homeArg !== true ? { kind: "home", home: String(homeArg), soul, agentsRoot: agentsRootArg }
    : soul ? { kind: "soul", soul, agentsRoot: agentsRootArg, dir: dirArg }
    : { kind: "scope", dir: dirArg };
  const readiness = readinessOf(inspect, { soul, verifySignatures: verify, catalog, deploymentDir, selector });
  if (args.includes("--policy")) {
    const homeOpt = flag("home");
    let meta = null;
    if (homeOpt && homeOpt !== true) { try { meta = JSON.parse(readFileSync(join(homeOpt, "instance.json"), "utf8")); } catch (e) { return bail("E_SESSION_UNKNOWN", `${homeOpt}: ${e.message}`); } }
    readiness.policy = policyOf({ instanceMeta: meta, soul: soul ? inspect.souls.find((s) => s.name === soul) : null }).policy;
    readiness.notes.push("policy: a lifecycle-authority claim enforced by the spawn route, not an OS sandbox");
  }
  if (JSON_MODE) { jsonOk(readiness); return; }
  console.log(`readiness — ${readiness.subject.kind === "soul" ? `soul ${readiness.subject.name}` : shortPath(readiness.subject.context)}: ${readiness.summary.ready ? "READY" : `${readiness.summary.fail} failing, ${readiness.summary.unknown} unknown of ${readiness.summary.required} required`}`);
  for (const [name, check] of Object.entries(readiness.checks)) {
    console.log(`  ${name}: ${check.status}`);
    for (const i of check.items) console.log(`    ${i.status.padEnd(14)} ${i.subject}${i.required ? "" : " (optional)"}${i.reason ? ` — ${i.reason}` : ""}${i.signature ? ` · signature ${i.signature.status}${i.signature.signer?.label ? ` by ${i.signature.signer.label}` : ""}` : ""}${i.remedy ? `  → ${i.remedy}` : ""}`);
  }
  if (readiness.policy) console.log(`  policy: child spawns ${readiness.policy.childSpawns.allowed ? "allowed" : "disabled"} (${readiness.policy.childSpawns.origin.kind}${readiness.policy.childSpawns.enforced ? ", enforced" : ""}); worktrees ${readiness.policy.worktrees.allowed === null ? "unknown" : readiness.policy.worktrees.allowed ? "allowed" : "not in this work mode"}`);
  for (const n of readiness.notes) console.log(`  note: ${n}`);
}
// ---------- workspace model v2: sync / package / workspace status / capabilities / souls ----------
// Contract: docs/design/2026-09-23-workspace-module-contracts.md §6. Nothing is
// installed: `oats-local.yaml` names the workspace, discovery runs over the Git
// remotes (lib/workspace.mjs), packages resolve to exact commits (lib/packages.mjs,
// lock v3) and the only persisted state is `oats-lock.json` beside oats-local.yaml.

/** Remote options threaded into every remote call. OATS_REMOTE_CACHE relocates
 * the content-addressed fetch cache (tests never touch ~/.cache). */
function remoteOptionsFromEnv() {
  const cacheDir = process.env.OATS_REMOTE_CACHE;
  return cacheDir ? { cacheDir: resolve(cacheDir) } : {};
}

/** The v2 deployment context at --dir: { dir, localPath, local, deploymentDir, remoteOptions }. */
function workspaceContext(bail) {
  const dir = dirFlag();
  let found;
  try { found = loadLocal(dir); }
  catch (e) { return bail(e.code || "E_LOCAL_MISSING", e.message, e.details); }
  return { dir, localPath: found.path, local: found.local, deploymentDir: dirname(found.path), remoteOptions: remoteOptionsFromEnv() };
}

/** The official catalog's package map (package-catalog.json; OATS_PACKAGE_CATALOG overrides). */
function catalogForSync(bail) {
  try { return officialPackageCatalog(); }
  catch (e) { return bail(e.code || "E_PACKAGE_MISSING", e.message); }
}

/** The package requests of a standalone view: the catalog's own pin of the package
 *  providing oats.core (decision 25) — nothing else, since the version list lives in
 *  the workspace file we cannot read. The request is written as resolvePackages
 *  expects a CATALOG entry: the bare version (`v1.1.3`), never the catalog's raw ref
 *  (`oats-framework/v1.1.3` is a tag PATH the one grammar refuses); parsePackageRequest
 *  recomposes the tag from the catalog's own convention.
 *  → { packages: { <id>: <version> }, problems: [ { code: "E_PACKAGE_MISSING", … } ] } */
function standalonePackages(catalog) {
  let id = "oats.framework", file = process.env.OATS_PACKAGE_CATALOG || null;
  try { const d = describeOfficialCatalog(); file = d.catalog.file; id = d.capabilityAliases.find((a) => a.capability === "oats.core")?.package ?? id; } catch { /* the catalog is diagnosed below */ }
  const version = standaloneCatalogVersion(catalog?.[id]?.ref);
  if (version) return { packages: { [id]: version }, problems: [] };
  const why = catalog?.[id] ? `its ref ${JSON.stringify(catalog[id].ref)} carries no version` : `it has no entry ${JSON.stringify(id)}`;
  return { packages: {}, problems: [{ code: "E_PACKAGE_MISSING", id, reason: "no-catalog", catalog: file, path: `/packages/${id}`, message: `the catalog has no package providing oats.core (OATS_PACKAGE_CATALOG=${file ?? "<bundled>"}): ${why}; standalone spawns will be refused until it does` }] };
}
/** The bare version of a catalog ref: its LAST path segment when that is a version
 *  (`v1.1.3` → `v1.1.3`; `oats-framework/v1.1.3` → `v1.1.3`; `main` → null). */
function standaloneCatalogVersion(ref) {
  if (typeof ref !== "string" || !ref.trim()) return null;
  const tail = ref.trim().split("/").filter(Boolean).pop() ?? "";
  return classifyPackageValue(tail).kind === "catalog" ? tail : null;
}

/** Discover the workspace named by oats-local.yaml over the real remote. */
async function discoverForCli(ctx, bail) {
  // The standalone case (decisions 10/25) is a discovery too: the repo's own view
  // plus the kernel's oats.core default — discoverOrStandalone decides.
  try { const { discoverOrStandalone } = await import("../lib/instance-resolution.mjs"); return await discoverOrStandalone(ctx.local, { remoteOptions: ctx.remoteOptions }); }
  catch (e) {
    if (typeof e?.code === "string" && e.code.startsWith("E_")) return bail(e.code, e.message, e.details ?? e.provenance);
    throw e;
  }
}

const short = (oid) => (typeof oid === "string" ? oid.slice(0, 8) : "?");
/** Where a reader takes capability manifests from: the instance home's own
 *  materialized modules when the home has them (workspace model), else the
 *  context directory (classic chain). */
const manifestSource = (meta, home, ctx) => (meta && meta.modules && typeof meta.modules === "object" && home ? realOrResolved(home) : ctx);
/** Display name of a discovery: the workspace's name, or the standalone label (decision 10). */
const workspaceName = (discovery) => discovery.workspace?.name ?? `standalone:${memberLabel(discovery.key)}`;
const memberLabel = (key) => String(key).split("/").filter(Boolean).pop()?.replace(/\.git$/, "") || String(key);
const teamLabel = (team) => team ?? "unassigned";
const originOf = (item) => (item.package ? `package ${item.package} v${item.version}` : `member ${item.repoKey} @ ${short(item.commit)}`);

/** Rows of every non-private soul/capability of confirmed members + locked package capabilities. */
function workspaceItems(discovery, lock, { includePrivate = false } = {}) {
  const souls = [];
  const capabilities = [];
  for (const m of discovery.members) {
    if (!m.confirmed && !(discovery.standalone === true && m.key === discovery.key)) continue;
    for (const s of m.souls) if (includePrivate || !s.private) souls.push({ name: s.name, origin: originOf(s), kind: "member", repoKey: s.repoKey, commit: s.commit, team: teamLabel(s.team), private: s.private, path: s.path, work: s.definition.work ?? null, description: s.definition.description ?? null });
    for (const c of m.capabilities) if (includePrivate || !c.private) capabilities.push({ name: c.name, origin: originOf(c), kind: "member", repoKey: c.repoKey, commit: c.commit, team: teamLabel(c.team), private: c.private, path: c.path, layer: c.manifest.layer ?? null, version: c.manifest.version ?? null });
  }
  for (const ext of discovery.external || []) {
    const s = ext.soul;
    if (includePrivate || !s.private) souls.push({ name: s.name, origin: `external ${s.repoKey} @ ${short(s.commit)}`, kind: "external", repoKey: s.repoKey, commit: s.commit, team: teamLabel(s.team), private: s.private, path: s.path, work: s.definition.work ?? null, description: s.definition.description ?? null });
  }
  for (const [id, entry] of Object.entries(lock?.packages || {})) {
    for (const name of entry.capabilities) capabilities.push({ name, origin: originOf({ package: id, version: entry.version }), kind: "package", package: id, version: entry.version, commit: entry.commit, team: teamLabel(null), private: false, approved: !!entry.approved });
  }
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0);
  souls.sort(byName);
  capabilities.sort(byName);
  return { souls, capabilities };
}

/** Membership rows for `sync` / `workspace status`. */
function memberRows(discovery) {
  return discovery.members.map((m) => ({
    key: m.key, name: memberLabel(m.key), commit: m.commit ?? null, confirmed: m.confirmed, status: m.confirmed ? "confirmed" : m.reason, detail: m.detail ?? null, team: m.team ?? null,
    souls: m.souls.map((s) => s.name), capabilities: m.capabilities.map((c) => c.name), publishes: m.publishes ?? null,
  }));
}

/** Package rows for `sync` / `workspace status` from the lock. */
function packageRows(lock) {
  return Object.entries(lock.packages).map(([id, p]) => ({ id, version: p.version, source: p.source, commit: p.commit, integrity: p.integrity, capabilities: p.capabilities, approved: p.approved }));
}

/** Print a padded table: rows are arrays of strings. */
function printTable(header, rows) {
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((r) => String(r[i] ?? "").length)));
  for (const r of all) console.log("  " + r.map((c, i) => String(c ?? "").padEnd(widths[i])).join("  ").trimEnd());
}

/** Executables digest of a locked package, read over the remote at its locked commit. */
async function lockedExecutablesDigest(id, entry, workspace, catalog, remoteOptions) {
  const req = parsePackageRequest(id, workspace.packages[id], catalog);
  const tree = await readPackageTree(remoteModule, req.remoteRef, entry.commit, entry.path, { remoteOptions });
  const targets = tree.manifests.flatMap((m) => manifestExecutables(m.manifest).map((x) => `${m.name}: ${x.kind} ${x.name} → ${x.target}`));
  return { digest: executablesDigest(tree), targets };
}

/** One yes/no question on the terminal (TTY only; the caller checks). */
async function askYesNo(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally { rl.close(); }
}

/** The body of `oats sync` — shared by `sync` and `onboard` (which onboards, then syncs the same
 * way). Given a v2 deployment context: discover over the remotes, confirm membership, resolve
 * `packages:` against the lock, approve (TTY) or list what needs approval, write the lock.
 * `bail` never returns (it exits the process with the caller's error shape).
 * → { report, lock, discovery, approvalNeeded, interactive, items, lockFile } */
async function performSync(ctx, bail, { onDiscovered } = {}) {
  const catalog = catalogForSync(bail);
  const discovery = await discoverForCli(ctx, bail);
  onDiscovered?.(discovery);
  let previous;
  try { previous = readLock(ctx.deploymentDir); } catch (e) { return bail(e.code || "E_LOCK_SCHEMA", e.message, e.details); }
  let resolved;
  // Standalone: no workspace file → the only package request is the kernel's
  // default, at the catalog's pinned version (decision 25). A catalog that cannot
  // name it is a PROBLEM of this sync (reported, exit unchanged), not a silent empty lock.
  const standalone = discovery.standalone === true ? standalonePackages(catalog) : null;
  const packageSource = standalone ? { packages: standalone.packages } : discovery.workspace;
  const problems = [...discovery.problems, ...(standalone?.problems ?? [])];
  try { resolved = await resolvePackages(packageSource, { catalog, lock: previous, remoteOptions: ctx.remoteOptions }); }
  catch (e) {
    if (typeof e?.code === "string" && e.code.startsWith("E_")) return bail(e.code, e.message, e.details ?? e.provenance);
    throw e;
  }
  let lock = resolved.lock;
  const approvalNeeded = [];
  const interactive = !JSON_MODE && process.stdin.isTTY && process.stdout.isTTY;
  for (const id of Object.keys(lock.packages)) {
    const entry = lock.packages[id];
    if (entry.approved) continue;
    let digest, targets;
    try { ({ digest, targets } = await lockedExecutablesDigest(id, entry, packageSource, catalog, ctx.remoteOptions)); }
    catch (e) {
      if (typeof e?.code === "string" && e.code.startsWith("E_")) return bail(e.code, e.message, e.details ?? e.provenance);
      throw e;
    }
    if (interactive) {
      console.error(`\n${id} ${entry.version} @ ${short(entry.commit)} needs executable approval (${targets.length} executable${targets.length === 1 ? "" : "s"}, digest ${digest}):`);
      for (const t of targets) console.error(`  ${t}`);
      if (targets.length === 0) console.error("  (no commands or hooks — nothing runs unattended)");
      if (await askYesNo(`approve ${id} ${entry.version}? [y/N] `)) { lock = approvePackage(lock, id, digest); continue; }
    }
    approvalNeeded.push({ id, version: entry.version, commit: entry.commit, executables: digest, targets });
  }
  let lockFile;
  try { lockFile = writeLock(ctx.deploymentDir, lock); } catch (e) { return bail(e.code || "E_LOCK_SCHEMA", e.message, e.details); }
  const members = memberRows(discovery);
  const packages = packageRows(lock);
  const changes = resolved.changes;
  const items = workspaceItems(discovery, lock, { includePrivate: true });
  const report = { syncApi: 1, standalone: discovery.standalone === true || undefined, workspace: { name: workspaceName(discovery), key: discovery.key, url: discovery.url, commit: discovery.commit, observedAt: discovery.observedAt, local: ctx.localPath, lock: lockFile }, members, packages, changes, approvalNeeded, problems };
  return { report, lock, discovery, approvalNeeded, interactive, items, lockFile, problems };
}

/** The human §8 report of a sync (text mode). */
function printSyncReport(ctx, synced) {
  const { report, discovery, approvalNeeded, interactive, items, lockFile } = synced;
  const { members, packages, changes } = report;
  const disabled = new Set(ctx.local.souls?.disabled || []);
  console.log(`workspace  ${discovery.workspace?.name ?? `(standalone — the workspace of ${memberLabel(discovery.key)} cannot be read; its own souls + oats.core)`}  (${discovery.key} @ ${short(discovery.commit)})`);
  console.log(`members    ${members.map((m) => m.confirmed ? `${m.name} ✓↔ (@ ${short(m.commit)})` : `${m.name} ✗ (${m.status})`).join("   ") || "(none)"}`);
  console.log(`packages   ${packages.map((p) => {
    const need = approvalNeeded.find((a) => a.id === p.id);
    return `${p.id} ${p.version} ✓ (${p.approved ? "approved" : need ? "approval needed" : "unapproved"})`;
  }).join("   ") || "(none)"}`);
  const changed = changes.filter((c) => c.to !== null && c.from !== c.to).map((c) => `${c.id}  ${c.from ?? "—"} → ${c.to} (@ ${short(c.commit)})`);
  const removed = changes.filter((c) => c.to === null).map((c) => `${c.id}  ${c.from} → removed`);
  console.log(`changed    ${[...changed, ...removed].join("   ") || "(nothing — the lock already described this workspace)"}`);
  const memberSouls = items.souls.filter((s) => s.kind === "member");
  const externalSouls = items.souls.filter((s) => s.kind === "external");
  const privateSouls = memberSouls.filter((s) => s.private);
  const disabledHere = items.souls.filter((s) => disabled.has(s.name));
  console.log(`souls      ${items.souls.length} discovered (${memberSouls.length} members, ${externalSouls.length} external, ${disabledHere.length} disabled here) · ${privateSouls.length} private${privateSouls.length ? ` (${privateSouls.map((s) => `${s.name}, ${memberLabel(s.repoKey)} only`).join("; ")})` : ""}`);
  const teams = new Map();
  for (const s of items.souls) { const t = teams.get(s.team) || { souls: 0, capabilities: 0 }; t.souls++; teams.set(s.team, t); }
  for (const c of items.capabilities.filter((c) => c.kind === "member")) { const t = teams.get(c.team) || { souls: 0, capabilities: 0 }; t.capabilities++; teams.set(c.team, t); }
  console.log(`teams      ${[...teams.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([team, n]) => `${team} ${n.souls} soul${n.souls === 1 ? "" : "s"}${n.capabilities ? `, ${n.capabilities} capabilit${n.capabilities === 1 ? "y" : "ies"}` : ""}`).join(" · ") || "(none)"}`);
  for (const p of synced.problems ?? discovery.problems) console.log(`problem    ${p.code}  ${p.repoKey ? `${memberLabel(p.repoKey)}:` : ""}${p.path}  ${p.message}`);
  if (approvalNeeded.length) {
    console.log(`\nApproval needed for ${approvalNeeded.map((a) => `${a.id} ${a.version}`).join(", ")} — ${interactive ? "declined; " : "not a terminal; "}the lock records them unapproved. Run \`oats sync\` in a terminal to approve their executables (spawns of souls using them are refused until then).`);
  } else console.log(`\nlock       ${shortPath(lockFile)}`);
}

/** `oats sync [--dir] [--json]` — contract §6. */
async function syncCmd() {
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  const ctx = workspaceContext(bail);
  const synced = await performSync(ctx, bail);
  // One envelope (or the §8 report), then the exit status: 2 = the lock is written but approvals
  // are pending. exitCode (not process.exit) lets stdout drain when it is a pipe.
  if (JSON_MODE) jsonOk(synced.report); else printSyncReport(ctx, synced);
  process.exitCode = synced.approvalNeeded.length ? 2 : 0;
}

/** Walk up from dir for oats-workspace.yaml INSIDE a Git checkout → { file, root } | null. */
function workspaceCheckoutFrom(dir) {
  let current = resolve(dir);
  for (;;) {
    const candidate = join(current, "oats-workspace.yaml");
    if (existsSync(candidate)) {
      // The file is edited in place only when it is TRACKED by the checkout it sits in (an untracked
      // copy inside some repository is not the shared workspace file).
      let inCheckout = false;
      for (let d = current; ; d = dirname(d)) { if (existsSync(join(d, ".git"))) { inCheckout = true; break; } if (dirname(d) === d) break; }
      if (!inCheckout) return null;
      const tracked = spawnSync("git", ["-C", current, "ls-files", "--error-unmatch", "--", "oats-workspace.yaml"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000 });
      return tracked.status === 0 ? { file: candidate, root: current } : null;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** `oats package add <id> <version|git:<repo>@<ref>> | remove <id> [--dir]` — contract §6. */
async function packageCmd() {
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  const sub = args[1];
  const id = args[2];
  const value = sub === "add" && typeof args[3] === "string" && !args[3].startsWith("--") ? args[3] : undefined;
  const usage = "usage: oats package add <id> <version|git:<repo>@<ref>> [--dir <d>] | oats package remove <id> [--dir <d>]";
  if (!["add", "remove"].includes(sub) || !id || id.startsWith("--")) return bail("E_USAGE", usage);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) return bail("E_WORKSPACE_SCHEMA", `package id ${JSON.stringify(id)} must match ^[a-z0-9][a-z0-9._-]*$`, { id });
  if (sub === "add") {
    if (!value || value.startsWith("--")) return bail("E_USAGE", usage);
    const c = classifyPackageValue(value);
    if (c.problem) return bail("E_WORKSPACE_SCHEMA", `packages.${id}: ${c.problem} (a package is a bare version like v2.1.3 or git:<repo>@<ref>)`, { id, value });
    if (c.kind === "git") { try { remoteModule.parseRepoRef(c.repo); } catch (e) { return bail(e.code || "E_REPO_REF", e.message, e.details ?? e.provenance); } }
  }
  const line = sub === "add" ? `  ${id}: ${YAML.stringify(value).trim()}` : null;
  const checkout = workspaceCheckoutFrom(dirFlag());
  if (!checkout) {
    // Untracked branch (the workspace file is shared through Git, not edited here). A `remove`
    // still checks the id against the DISCOVERED workspace when this directory realizes one
    // (oats-local.yaml): removing what is not declared is E_PACKAGE_MISSING, as in the tracked branch.
    if (sub === "remove") {
      let ctx = null; try { const found = loadLocal(dirFlag()); ctx = { dir: dirFlag(), localPath: found.path, local: found.local, deploymentDir: dirname(found.path), remoteOptions: remoteOptionsFromEnv() }; }
      catch (e) { if (e?.code !== "E_LOCAL_MISSING") return bail(e.code || "E_WORKSPACE_SCHEMA", e.message, e.details); }
      if (ctx) {
        const discovery = await discoverForCli(ctx, bail);
        const declared = discovery.standalone === true ? standalonePackages(catalogForSync(bail)).packages : (discovery.workspace?.packages || {});
        if (!Object.hasOwn(declared, id)) return bail("E_PACKAGE_MISSING", `packages.${id} is not declared by workspace ${workspaceName(discovery)} (${discovery.key} @ ${short(discovery.commit)})${discovery.standalone === true ? " — standalone: only the kernel's default package is requested" : ""}`, { id, workspace: discovery.key, declared: Object.keys(declared).sort() });
      }
    }
    if (JSON_MODE) { jsonOk({ action: sub, id, value: value ?? null, edited: false, file: null, line: sub === "add" ? `packages:\n${line}` : null, hint: "oats-workspace.yaml is not in this checkout; commit the change in the workspace repo, then `oats sync`" }); return; }
    if (sub === "add") console.log(`oats-workspace.yaml is not in this checkout. Add under packages: in the workspace repo, then \`oats sync\`:\n\npackages:\n${line}`);
    else console.log(`oats-workspace.yaml is not in this checkout. Remove \`${id}\` from packages: in the workspace repo, then \`oats sync\`.`);
    return;
  }
  const text = readFileSync(checkout.file, "utf8");
  let doc;
  try { doc = YAML.parseDocument(text, { keepSourceTokens: true }); } catch (e) { return bail("E_WORKSPACE_SCHEMA", `${checkout.file}: ${e.message}`, { path: checkout.file }); }
  if (doc.errors?.length) return bail("E_WORKSPACE_SCHEMA", `${checkout.file}: ${doc.errors.map((e) => e.message).join("; ")}`, { path: checkout.file });
  const root = doc.contents;
  if (!YAML.isMap(root)) return bail("E_WORKSPACE_SCHEMA", `${checkout.file}: top level must be a mapping`, { path: checkout.file, problems: [{ path: "", message: "top level must be a mapping" }] });
  const packagesNode = root.get("packages", true);
  if (packagesNode !== undefined && packagesNode !== null && !(YAML.isScalar(packagesNode) && packagesNode.value === null) && !YAML.isMap(packagesNode)) {
    return bail("E_WORKSPACE_SCHEMA", `${shortPath(checkout.file)}: packages: must be a mapping of <package-id>: <version>, found ${YAML.isSeq(packagesNode) ? "a sequence" : JSON.stringify(packagesNode.toJSON?.() ?? String(packagesNode))}`, { path: checkout.file, problems: [{ path: "/packages", message: "must be an object" }] });
  }
  const previous = YAML.isMap(packagesNode) ? packagesNode.toJSON() : null;
  const had = previous && Object.hasOwn(previous, id) ? previous[id] : undefined;
  if (sub === "add") {
    if (!YAML.isMap(packagesNode)) root.set("packages", doc.createNode({ [id]: value }));
    else packagesNode.set(id, value);
  } else {
    if (had === undefined) return bail("E_PACKAGE_MISSING", `packages.${id} is not in ${shortPath(checkout.file)}`, { id, path: checkout.file });
    root.get("packages").delete(id);
    if (root.get("packages")?.items?.length === 0) root.delete("packages");
  }
  const next = doc.toString();
  const problems = validateWorkspace(YAML.parse(next), { remote: remoteModule });
  if (problems.length) return bail("E_WORKSPACE_SCHEMA", `${shortPath(checkout.file)} would be invalid: ${problems.map((p) => `${p.path || "/"}: ${p.message}`).join("; ")}`, { path: checkout.file, problems });
  writeFileAtomic(checkout.file, next);
  const receipt = { action: sub, id, value: value ?? null, previous: had ?? null, edited: true, file: checkout.file };
  if (JSON_MODE) { jsonOk(receipt); return; }
  console.log(sub === "add"
    ? `${had === undefined ? "Added" : `Changed (${had} →)`} packages.${id}: ${value} in ${shortPath(checkout.file)}. Commit it, then \`oats sync\` (the lock resolves the version to a commit and asks approval once).`
    : `Removed packages.${id} (${had}) from ${shortPath(checkout.file)}. Commit it, then \`oats sync\`.`);
}

/** `oats workspace status [--dir] [--json]` — contract §6. */
async function workspaceCmd() {
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  if (args[1] !== "status") return bail("E_USAGE", "usage: oats workspace status [--dir <d>] [--json]");
  const ctx = workspaceContext(bail);
  const discovery = await discoverForCli(ctx, bail);
  let lock;
  try { lock = readLock(ctx.deploymentDir); } catch (e) { return bail(e.code || "E_LOCK_SCHEMA", e.message, e.details); }
  const members = memberRows(discovery);
  const packages = packageRows(lock);
  // Standalone (decision 10): there is no workspace file — the declared packages are the
  // kernel's own default (decision 25) and there are no teams.
  const standalone = discovery.standalone === true;
  const declared = Object.keys(standalone ? standalonePackages(catalogForSync(bail)).packages : (discovery.workspace?.packages || {})).sort();
  const locked = new Set(packages.map((p) => p.id));
  const unsynced = declared.filter((id) => !locked.has(id));
  const stale = packages.filter((p) => !declared.includes(p.id)).map((p) => p.id);
  const approval = { approved: packages.filter((p) => p.approved).map((p) => p.id), needed: packages.filter((p) => !p.approved).map((p) => p.id) };
  const result = { workspaceStatusApi: 1, standalone: standalone || undefined, workspace: { name: workspaceName(discovery), key: discovery.key, url: discovery.url, commit: discovery.commit, observedAt: discovery.observedAt, local: ctx.localPath, teams: Object.keys(discovery.workspace?.teams || {}) }, members, packages, declaredPackages: declared, unsynced, stale, approval, external: (discovery.external || []).map((e) => ({ source: e.source, soul: e.soul.name, team: teamLabel(e.soul.team) })), problems: discovery.problems };
  if (JSON_MODE) { jsonOk(result); return; }
  console.log(`workspace ${workspaceName(discovery)}  (${discovery.key} @ ${short(discovery.commit)})  local ${shortPath(ctx.localPath)}\n`);
  if (standalone) console.log(`  (standalone — the workspace of ${memberLabel(discovery.key)} cannot be read; its own souls + oats.core)\n`);
  console.log("Members:");
  printTable(["member", "status", "commit", "team", "souls", "capabilities", "publishes"], members.map((m) => [m.name, m.status, short(m.commit), m.team ?? "—", m.souls.join(",") || "—", m.capabilities.join(",") || "—", m.publishes ? `${m.publishes.package} v${m.publishes.version ?? "?"}` : "—"]));
  for (const m of members.filter((m) => !m.confirmed)) console.log(`    ${m.name}: ${m.detail}`);
  console.log("\nPackages:");
  if (!packages.length) console.log(unsynced.length ? `  (none locked yet — \`oats sync\` resolves ${unsynced.join(", ")})` : "  (none)");
  else printTable(["package", "version", "source", "commit", "approval", "capabilities"], packages.map((p) => [p.id, p.version, p.source, short(p.commit), p.approved ? `approved ${p.approved.at.slice(0, 10)}` : "NEEDED", p.capabilities.join(",")]));
  if (packages.length && unsynced.length) console.log(`  declared but not locked (run \`oats sync\`): ${unsynced.join(", ")}`);
  if (stale.length) console.log(`  locked but no longer declared (run \`oats sync\`): ${stale.join(", ")}`);
  if (result.external.length) console.log(`\nExternal: ${result.external.map((e) => `${e.soul} (${e.source.replace(/@([0-9a-f]{40})$/, (_, o) => `@${short(o)}`)}, ${e.team})`).join("   ")}`);
  if (discovery.problems.length) { console.log("\nProblems:"); for (const p of discovery.problems) console.log(`  ${p.code}  ${p.repoKey ? `${memberLabel(p.repoKey)}:` : ""}${p.path}  ${p.message}`); }
}

/** `oats capabilities` / `oats souls` [--dir] [--json] — contract §6. */
async function itemsCmd(kind) {
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  const ctx = workspaceContext(bail);
  const discovery = await discoverForCli(ctx, bail);
  let lock;
  try { lock = readLock(ctx.deploymentDir); } catch (e) { return bail(e.code || "E_LOCK_SCHEMA", e.message, e.details); }
  const items = workspaceItems(discovery, lock)[kind];
  const standalone = discovery.standalone === true;
  if (JSON_MODE) { jsonOk({ [`${kind}Api`]: 1, standalone: standalone || undefined, workspace: { name: workspaceName(discovery), key: discovery.key, commit: discovery.commit }, [kind]: items, problems: discovery.problems }); return; }
  console.log(`${kind} of workspace ${workspaceName(discovery)} (${discovery.key} @ ${short(discovery.commit)})${standalone ? `  — standalone: the workspace of ${memberLabel(discovery.key)} cannot be read` : ""}\n`);
  if (!items.length) console.log("  (none)");
  else if (kind === "souls") printTable(["name", "origin", "team", "work"], items.map((s) => [s.name, s.origin, s.team, s.work ?? "—"]));
  else printTable(["name", "origin", "team", "layer"], items.map((c) => [c.name, c.origin, c.team, c.layer ?? "—"]));
  const unsynced = Object.keys(discovery.workspace?.packages || {}).filter((id) => !lock.packages[id]);
  if (kind === "capabilities" && unsynced.length) console.log(`\n  package capabilities of ${unsynced.join(", ")} appear after \`oats sync\``);
}

// ---------- roster: status / spawn / retire / create ----------
/** Workspace drift for `oats status` (decision 17: shown, not prevented). ONE discovery over
 *  the remotes serves every instance; `driftOf` compares each instance's recorded modules to
 *  the members' current state (and package modules to the lock). Offline → { unreachable }.
 *  Returns null when the deployment is not a workspace deployment (no oats-local.yaml). */
async function statusDrift(data) {
  let ctx;
  try { ctx = loadLocal(dirFlag()); } catch (e) { if (e?.code === "E_LOCAL_MISSING") return null; throw e; }
  const hasModules = data.some((a) => (a.instances || []).some((i) => i.modules && typeof i.modules === "object" && Object.keys(i.modules).length));
  if (!hasModules) return { drift: new Map(), unreachable: null };
  const deploymentDir = dirname(ctx.path);
  let lock = null;
  try { if (existsSync(join(deploymentDir, LOCK_FILE))) lock = readLock(deploymentDir); } catch { lock = null; }
  let discovery;
  // The standalone view (decisions 10/25) is a discovery too: drift of a standalone
  // instance is computed against its member's current state, not reported "unreachable".
  try { const { discoverOrStandalone } = await import("../lib/instance-resolution.mjs"); discovery = await discoverOrStandalone(ctx.local, { remoteOptions: remoteOptionsFromEnv() }); }
  catch (e) {
    const reason = e?.details?.reason ? `${e.code}: ${e.details.reason}` : (e?.code || e?.message || "unknown");
    return { drift: new Map(), unreachable: { code: e?.code ?? null, reason, message: e?.message ?? String(e) } };
  }
  const { driftOf } = await import("../lib/materialize.mjs");
  const drift = new Map();
  for (const a of data) for (const i of a.instances || []) {
    if (!i.modules || typeof i.modules !== "object" || !Object.keys(i.modules).length) continue;
    try { drift.set(i.home ?? `${a.name}/${i.instance}`, driftOf(i, discovery, { lock })); } catch { /* an unreadable module record shows as no drift rows */ }
  }
  return { drift, unreachable: null };
}
/** One `modules:` line per module. */
function driftLine(row) {
  const from = row.from || {};
  const origin = from.kind === "package" ? `package ${from.package} v${from.version}` : memberLabel(row.recorded?.repoKey ?? from.repoKey ?? "?");
  const base = `modules: ${row.module} from ${origin} @ ${short7(row.recorded?.commit)}`;
  if (row.status === "moved") return `${base}  [${from.kind === "package" ? "package" : "member"} moved since (now @ ${short7(row.current?.commit)})]`;
  if (row.status === "missing") return `${base}  [${row.reason === "capability-absent" ? "capability no longer present" : row.reason === "package-absent" ? "package no longer locked" : `member ${row.reason || "unconfirmed"}`}]`;
  return base;
}
const short7 = (oid) => (typeof oid === "string" ? oid.slice(0, 7) : "?");

async function status() {
  if (args.includes("--team")) return statusTeam();
  let root;
  try { root = ensureRoot(dirFlag()); }
  catch (e) { if (e?.code === "E_NO_DEPLOYMENT") { if (JSON_MODE) jsonFail("E_NO_DEPLOYMENT", e.message, e.details ?? e.provenance); die(e.message); } throw e; }
  const data = listInstances(root);
  const ws = await statusDrift(data);
  const verbose = args.includes("--verbose");
  if (args.includes("--json")) {
    if (ws) for (const a of data) for (const i of a.instances || []) { const rows = ws.drift.get(i.home ?? `${a.name}/${i.instance}`); if (rows) i.modules = rows.map((r) => ({ name: r.module, from: r.from, commit: r.recorded?.commit ?? null, current: r.current, status: r.status, ...(r.reason ? { reason: r.reason } : {}) })); }
    console.log(JSON.stringify({ root, agents: data, ...(ws ? { workspace: ws.unreachable ? { reachable: false, ...ws.unreachable } : { reachable: true } } : {}) }, null, 2)); return;
  }
  console.log(`oats status — agents root ${shortPath(root)}\n`);
  if (ws?.unreachable) console.log(`  workspace: unreachable (${ws.unreachable.reason}) — drift unknown\n`);
  if (data.length === 0) { console.log("  (no agents — create one with `oats create <name>`)"); return; }
  for (const a of data) {
    console.log(`  ${a.name}${a.kind === "local" ? " (local)" : ""}  [work: ${a.work || "checkout"}, repo: ${a.repo || "?"}]`);
    if (a.description) console.log(`      ${a.description}`);
    for (const i of a.instances) {
      console.log(`      • ${i.instance}  ${i.retirePending ? "RETIRING" : i.running ? "RUNNING" : "idle"}  (branch ${i.branch || "?"}, ${i.work || "?"})`);
      const rows = ws?.drift.get(i.home ?? `${a.name}/${i.instance}`) || [];
      for (const r of rows) if (verbose || r.status !== "current") console.log(`          ${driftLine(r)}`);
    }
    for (const f of a.retireFailures || []) {
      console.log(`      ! deferred retirement of ${f.instance} FAILED${f.completedAt ? ` at ${f.completedAt}` : ""}: ${f.error || (f.incomplete || []).join("; ") || "see result file"} — retry with \`oats retire ${f.instance}\``);
    }
  }
  const defs = listAgentDefs(process.cwd());
  if (defs.length) console.log(`\n  importable defs: ${defs.map((d) => d.name).join(", ")}`);
}

function statusTeam() {
  const ctx = dirFlag();
  const r = resolveOatsConfig(ctx);
  if (!r.team) die(`no team declared in the config chain from ${shortPath(ctx)} — add a "team:" block (name, optional id) at the deployment scope`);
  const roots = teamAgentRoots(r.team.scope);
  const payload = { team: r.team, roots: [] };
  for (const root of roots) payload.roots.push({ root, agents: listInstances(root) });
  if (args.includes("--json")) { console.log(JSON.stringify(payload, null, 2)); return; }
  console.log(`oats status — team ${r.team.name}${r.team.id ? ` (${r.team.id})` : ""}  [scope: ${shortPath(r.team.scope)}]\n`);
  if (!roots.length) { console.log("  (no agents/ directories in the team scope)"); return; }
  for (const { root, agents } of payload.roots) {
    console.log(`  ${shortPath(root)}`);
    if (!agents.length) { console.log("    (no agents)"); continue; }
    for (const a of agents) {
      console.log(`    ${a.name}${a.kind === "local" ? " (local)" : ""}${a.description ? `  — ${a.description}` : ""}`);
      for (const i of a.instances) console.log(`      • ${i.instance}  ${i.retirePending ? "RETIRING" : i.running ? "RUNNING" : "idle"}`);
      for (const f of a.retireFailures || []) console.log(`      ! deferred retirement of ${f.instance} FAILED: ${f.error || (f.incomplete || []).join("; ") || "see result file"} — retry with \`oats retire ${f.instance}\``);
    }
  }
}

async function spawnCmd() {
  // JSON mode: contract envelope, stable error codes, stderr-only progress.
  const bail = (code, msg, details) => (JSON_MODE ? jsonFail(code, msg, details) : die(msg));
  const note = (msg) => (JSON_MODE ? console.error(msg) : console.log(msg));
  const yolo = yoloFlag();
  const backend = valueFlag("backend"), herdrSocket = valueFlag("herdr-socket");
  if (backend !== undefined && !["tmux", "herdr"].includes(backend)) bail("E_BAD_ARGS", "--backend must be tmux or herdr");
  const requestedWork = valueFlag("work");
  const workDir = valueFlag("work-dir"), branch = valueFlag("branch"), repo = valueFlag("repo");
  const checkDirectoryOptions = (work) => {
    if (work === "directory" && (workDir !== undefined || branch !== undefined)) bail("E_BAD_ARGS", "--work directory owns only <home>/work; --work-dir and --branch are not allowed");
  };
  checkDirectoryOptions(requestedWork); // before a local soul could be upserted
  const name = args[1];
  if (!name || name.startsWith("--")) bail("E_USAGE", "usage: oats spawn <agent> [--task <text>|--task-file <f>] [--purpose <slug>] [--preview] [--base <ref>] [--model <id>|@native-default] [--allow-child-spawns|--no-child-spawns] [--relation child|sibling|parent|unrelated --relative-to <instance> [--relative-root <agents-root>]] [--parent <instance>] [--repo <r>] [--work worktree|checkout|attached|workspace|directory] [--work-dir <owner-work>] [--runtime pi|claude|codex] [--backend tmux|herdr] [--herdr-socket <path>] [--yolo|--no-yolo] [--model <m>] [--branch <b>] [--instructions-file <f>|--def-file <f>] [--no-launch] [--json]");
  // Retired boundary flags (maintainer transport ruling): fail LOUDLY before
  // ANY side effect — including root discovery and local-agent upsert (an
  // --instructions-file spawn must not scaffold/overwrite a local soul before
  // this rejection; reviewer-b671de0).
  if (args.includes("--instance")) bail("E_BAD_ARGS", "--instance was removed by the runtime-boundary ruling — use --purpose <slug> (deterministic <agent>-<purpose> naming)");
  if (args.includes("--ephemeral")) bail("E_BAD_ARGS", "--ephemeral was removed by the runtime-boundary ruling — declare the agent in a capability manifest (agents:) for automatic ephemeral semantics");
  let root;
  try { root = ensureRoot(dirFlag()); }
  catch (e) { bail("E_NO_DEPLOYMENT", e.message || e); throw e; }
  const isPreview = args.includes("--preview");
  // --agents-root <abs>: the exact root the soul must live in (as inspect and
  // readiness take it). With it, no team-soul / capability-agent / importable-
  // def fallback: the soul is there or the spawn refuses E_SOUL_UNKNOWN.
  const agentsRootFlag = flag("agents-root");
  if (agentsRootFlag !== undefined && (agentsRootFlag === true || !isAbsolute(String(agentsRootFlag)))) bail("E_BAD_ARGS", "--agents-root needs an absolute agents root");
  if (agentsRootFlag !== undefined && realOrResolved(String(agentsRootFlag)) !== realOrResolved(root)) {
    const teamHit = findTeamAgent(dirFlag(), name), hit = (teamHit?.matches || []).find((m) => realOrResolved(m.root) === realOrResolved(String(agentsRootFlag)));
    if (!hit) bail("E_SOUL_UNKNOWN", `soul "${name}" is not at agents root ${String(agentsRootFlag)} (this scope's root is ${shortPath(root)})`);
    root = hit.root;
  }
  let agent = findAgent(root, name);
  // Workspace model: with an oats-local.yaml the soul is ALWAYS discovered over the
  // remotes and resolved (member = latest state, package = locked+approved) — never
  // "whatever <agents-root>/<name>/soul/ happens to hold": that copy is a per-commit
  // cache (ensureWorkspaceSoul refreshes it when the member moved), so a second
  // spawn sees the member's CURRENT soul, not the first spawn's. A preview runs the
  // same read-only discovery+resolution; the fetched soul copy it may leave under
  // <agents-root>/<name>/soul/ is not an instance (reported as soulFetched).
  const providerPairs = [];
  for (let i = 0; i < args.length; i++) if (args[i] === "--provider") { if (!args[i + 1] || !args[i + 2]) bail("E_BAD_ARGS", "--provider needs <capability> <key>=<value>"); providerPairs.push([args[i + 1], args[i + 2]]); i += 2; }
  let wsPrepared, soulFetched = false, wsSoulUnknown = null;
  let hasLocal = true;
  {
    try { loadLocal(dirFlag()); } catch (e) { if (e?.code === "E_LOCAL_MISSING") hasLocal = false; else bail(e.code || "E_WORKSPACE_SCHEMA", e.message, e.details); }
    if (hasLocal) {
      let discovery = null;
      try {
        const { prepareInstance, ensureWorkspaceSoul, parseProviderFlags, discoverOrStandalone } = await import("../lib/instance-resolution.mjs");
        const remoteOptions = remoteOptionsFromEnv();
        const { local } = loadLocal(dirFlag());
        discovery = await discoverOrStandalone(local, { remoteOptions });
        wsPrepared = await prepareInstance(dirFlag(), name, { spawn: { providers: parseProviderFlags(providerPairs) }, remoteOptions, discovery });
        const soulName = wsPrepared.soulEntry.name;
        const stampFile = join(root, soulName, ".oats-soul-source.json");
        const stampBefore = (() => { try { return JSON.parse(readFileSync(stampFile, "utf8")); } catch { return null; } })();
        const soulDir = await ensureWorkspaceSoul(wsPrepared, root);
        soulFetched = !stampBefore || stampBefore.commit !== wsPrepared.soulEntry.commit || stampBefore.repoKey !== wsPrepared.soulEntry.repoKey;
        if (!agent || soulFetched || agent._dir !== dirname(soulDir)) agent = findAgent(root, soulName);
        if (!agent) bail("E_SOUL_UNKNOWN", `soul "${name}" was fetched to ${shortPath(soulDir)} but is not readable as a soul there`);
        note(`(workspace soul: "${name}" from ${wsPrepared.soulEntry.repoKey} @ ${String(wsPrepared.soulEntry.commit).slice(0, 12)}${wsPrepared.soulEntry.team ? `, team ${wsPrepared.soulEntry.team}` : ""}${soulFetched ? "; soul source fetched" : ""})`);
      } catch (e) {
        // Standalone (decisions 10/25): the ONLY package request is the kernel's own
        // default; when the catalog cannot name it, say so instead of "add it to packages:"
        // (there is no workspace file to add it to).
        if (e?.code === "E_PACKAGE_MISSING" && discovery?.standalone === true) {
          let file = process.env.OATS_PACKAGE_CATALOG || null; try { file = describeOfficialCatalog().catalog.file; } catch { /* keep the env value */ }
          bail(e.code, `${e.details?.capability ?? "oats.core"}: the catalog has no package providing oats.core (OATS_PACKAGE_CATALOG=${file ?? "<bundled>"}) — standalone spawns resolve only the kernel's default package from the catalog`, { ...(e.details ?? {}), standalone: true, reason: "no-catalog", catalog: file });
        }
        // Not a workspace soul: a capability-defined agent (a module's `agents:`
        // soul, resolved below from a materialized copy) or a local-only soul
        // (--instructions-file/--def-file) may still answer to this name.
        if (e?.code === "E_SOUL_UNKNOWN" && !isPreview) { wsSoulUnknown = e; }
        else if (e?.code?.startsWith?.("E_")) bail(e.code, e.message, e.details);
        else throw e;
      }
    } else if (providerPairs.length) bail("E_BAD_ARGS", "--provider needs a workspace deployment (oats-local.yaml); this directory has none");
  }
  if (agentsRootFlag !== undefined && !agent) bail("E_SOUL_UNKNOWN", `soul "${name}" is not at agents root ${String(agentsRootFlag)}`);
  if (isPreview && !agent) bail("E_SOUL_UNKNOWN", `soul "${name}" is not in ${shortPath(root)}; a preview never creates or imports a soul (known: ${listAgents(root).map((a) => a.name).join(", ") || "none"})`);
  if (isPreview && (flag("instructions-file") !== undefined || flag("def-file") !== undefined)) bail("E_BAD_ARGS", "--preview does not take --instructions-file/--def-file: a preview never writes a soul");
  const instrFile = flag("instructions-file");
  const defFile = flag("def-file");
  if (!agent && !instrFile && !defFile) {
    // Capability-defined agent: a package's `agents:` soul, active in this context.
    const capAgent = findCapabilityAgent(dirFlag(), root, name);
    if (capAgent) {
      agent = capAgent;
      note(`(capability agent: "${name}" from ${capAgent.capability} — fresh soul, instances home locally)`);
    }
  }
  if (!agent && !instrFile && !defFile && hasLocal) {
    // Workspace model: the agent is declared by a capability some INSTANCE already
    // materialized (the --parent home first, then any home under this root) —
    // OKF's memory-harvest worker spawned by a knowledge source, for example.
    const anchorName = flag("parent") || flag("relative-to");
    const anchorHome = anchorName ? (findInstanceHome(root, String(anchorName)) ?? null) : null;
    let modAgent;
    try { modAgent = findModuleCapabilityAgent(root, name, { anchorHome }); }
    catch (e) { bail(e.code || "E_CAPABILITY_BROKEN", e.message, e.details); }
    if (modAgent) {
      agent = modAgent;
      note(`(capability agent: "${name}" from ${modAgent.capability}, materialized in ${shortPath(modAgent._manifestSource)} — fresh soul, instances home locally)`);
    } else {
      // No instance carries it: resolve from the deployment's LOCK — an approved
      // package whose capability declares agents/<name> is fetched into the
      // deployment's module store and read from there.
      try {
        const { resolvePackageCapabilityAgent } = await import("../lib/instance-resolution.mjs");
        const hit = await resolvePackageCapabilityAgent(dirFlag(), name, { remoteOptions: remoteOptionsFromEnv(), catalog: (() => { try { return officialPackageCatalog(); } catch { return null; } })() });
        if (hit) {
          agent = capabilityAgentFromDir(hit.dir, name, root, { module: { from: { kind: "package", package: hit.package, version: hit.version, commit: hit.commit } } });
          if (agent) note(`(capability agent: "${name}" from ${hit.capability} — package ${hit.package} v${hit.version}, fetched to ${shortPath(hit.dir)} — fresh soul, instances home locally)`);
        }
      } catch (e) { if (e?.code?.startsWith?.("E_")) bail(e.code, e.message, e.details); throw e; }
    }
  }
  if (!agent && wsSoulUnknown && !instrFile && !defFile) bail(wsSoulUnknown.code, wsSoulUnknown.message, wsSoulUnknown.details);
  if (!agent && !instrFile && !defFile) {
    // Cross-repo lookup: the soul may live in a sibling repo of the team scope.
    // Unique match wins; the instance homes with its owning repo's agents root.
    const teamHit = findTeamAgent(dirFlag(), name);
    const remote = (teamHit?.matches || []).filter((m) => resolve(m.root) !== resolve(root));
    if (remote.length > 1) bail("E_AMBIGUOUS_SOUL", `soul "${name}" found in multiple team repos: ${remote.map((m) => shortPath(m.root)).join(", ")} — re-run with --dir <that repo>`);
    if (remote.length === 1) {
      root = remote[0].root;
      agent = remote[0].agent;
      note(`(cross-repo: soul "${name}" found at ${shortPath(root)} — instance homes there)`);
    }
  }
  checkDirectoryOptions(requestedWork || agent?.work);
  // local agents: create/update from raw instructions or a single-file def
  if (instrFile || defFile || !agent) {
    if (!agent && !instrFile && !defFile) {
      const def = listAgentDefs(process.cwd()).find((d) => d.name === name);
      if (!def) bail("E_UNKNOWN_AGENT", `unknown agent "${name}" (known: ${listAgents(root).map((a) => a.name).join(", ") || "none"}; importable defs: ${listAgentDefs(process.cwd()).map((d) => d.name).join(", ") || "none"}) — pass --instructions-file or --def-file to create a local agent`);
      agent = upsertLocalAgent(root, { name: def.name, file: def.path, repo: flag("repo"), work: flag("work"), runtime: flag("runtime"), model: flag("model"), oatsCore: !args.includes("--no-oats-core") });
    } else if (!agent || agent.kind === "local") {
      agent = upsertLocalAgent(root, {
        name, file: defFile, instructions: instrFile ? readFileSync(instrFile, "utf8") : undefined, oatsCore: !args.includes("--no-oats-core"),
        repo: flag("repo"), work: flag("work"), runtime: flag("runtime"), model: flag("model"), yolo: yoloFlag(),
      });
    } else {
      bail("E_BAD_ARGS", `"${name}" is a persistent agent — spawn it without --instructions-file/--def-file`);
    }
  }
  for (const information of agent.notes || []) note(`[${information.code}] ${information.message}`);
  // Lineage is explicit: --relation child|sibling|parent|unrelated anchors the new
  // instance to --relative-to <instance>. --parent X is sugar for
  // --relative-to X --relation child (agents spawning sub-agents pass their own
  // name, e.g. --parent "$OATS_INSTANCE"). Without a relation, the spawn is
  // operator-origin and lands top-level — ambient env vars in the shell are
  // never treated as parentage.
  const parent = flag("parent");
  if (parent !== undefined && (parent === true || !String(parent).trim())) bail("E_BAD_ARGS", "--parent needs an instance name");
  let relation = flag("relation");
  if (relation !== undefined && (relation === true || !String(relation).trim())) bail("E_BAD_ARGS", "--relation needs a value: child|sibling|parent|unrelated");
  if (relation && !RELATIONS.includes(relation)) bail("E_BAD_ARGS", `unknown --relation "${relation}" (child|sibling|parent|unrelated)`);
  let relativeTo = flag("relative-to");
  if (relativeTo !== undefined && (relativeTo === true || !String(relativeTo).trim())) bail("E_BAD_ARGS", "--relative-to needs an instance name");
  if (relation && relation !== "unrelated" && !relativeTo) bail("E_BAD_ARGS", `--relation ${relation} requires --relative-to <instance>`);
  if (relativeTo && !relation) bail("E_BAD_ARGS", "--relative-to requires --relation child|sibling|parent");
  if (relation === "unrelated" && relativeTo) bail("E_BAD_ARGS", "--relation unrelated takes no --relative-to");
  if (parent && (relation || relativeTo)) bail("E_BAD_ARGS", "--parent is sugar for --relative-to <instance> --relation child — use one form, not both");
  if (parent) { relation = "child"; relativeTo = parent; }
  // Attached agents are ALWAYS children (design decision): the only relation
  // flags allowed are the child form — required when the workDir is not an
  // instance's own <home>/work (integration worktrees). The kernel verifies
  // ownership canonically (including soul-default attached mode).
  if ((flag("work") === "attached") && relation && relation !== "child") bail("E_BAD_ARGS", "attached agents are always children of the work-tree owner — only --parent <instance> (or --relation child) is valid with --work attached");
  // NOTE: explicit "unrelated" is passed through to the kernel.
  if (relativeTo && relation !== "unrelated") {
    // findInstanceHome also sees capability-defined agents' instance homes
    // (local-agents/<name>/ without a local soul) — e.g. a reviewer passing
    // --parent "$OATS_INSTANCE" from a capability agent.
    if (!findInstanceHome(root, relativeTo) && !findTeamInstance(dirFlag(), relativeTo)) bail(parent ? "E_PARENT_NOT_FOUND" : "E_RELATIVE_NOT_FOUND", `${parent ? "--parent" : "--relative-to"} "${relativeTo}" does not match any known instance`);
  }
  const taskText = flag("task");
  if (taskText === true) bail("E_BAD_ARGS", "--task needs a value (use --task-file for long tasks)");
  const taskFileFlag = flag("task-file");
  if (taskFileFlag === true) bail("E_BAD_ARGS", "--task-file needs a path");
  if (taskFileFlag && !existsSync(taskFileFlag)) bail("E_BAD_ARGS", `--task-file not found: ${taskFileFlag}`);
  const relativeRoot = flag("relative-root");
  if (relativeRoot !== undefined && (relativeRoot === true || !String(relativeRoot).trim())) bail("E_BAD_ARGS", "--relative-root needs an agents-root path");
  if (relativeRoot && !relativeTo) bail("E_BAD_ARGS", "--relative-root only qualifies --relative-to/--parent");
  // Wake at launch: --wake-file <private JSON {cron, tz, message, enabled}>
  // is the backend bridge; --wake-every/--wake-cron/--wake-tz/--wake-message
  // (or --wake-message-file) are the human sugar for the same object. The
  // wake job is saved AFTER a successful spawn, bound to the returned home.
  let wake;
  try {
    const wakeFile = flag("wake-file");
    if (wakeFile === true) bail("E_BAD_ARGS", "--wake-file needs a path");
    const wakeJson = flag("wake-json");
    if (wakeJson === true) bail("E_BAD_ARGS", "--wake-json needs the wake object as JSON text");
    if (wakeJson) {
      let doc; try { doc = JSON.parse(wakeJson); } catch (e) { bail("E_SCHEDULE_INVALID", `--wake-json is not valid JSON: ${e.message}`); }
      if (!doc || typeof doc !== "object") bail("E_SCHEDULE_INVALID", "--wake-json must hold {cron, tz, message, enabled}");
      wake = { cron: doc.cron, tz: doc.tz, message: doc.message, enabled: doc.enabled === undefined ? true : doc.enabled };
    } else if (wakeFile) {
      if (!existsSync(wakeFile)) bail("E_BAD_ARGS", `--wake-file not found: ${wakeFile}`);
      let doc; try { doc = JSON.parse(readFileSync(wakeFile, "utf8")); } catch (e) { bail("E_SCHEDULE_INVALID", `--wake-file is not valid JSON: ${e.message}`); }
      if (!doc || typeof doc !== "object") bail("E_SCHEDULE_INVALID", "--wake-file must hold {cron, tz, message, enabled}");
      wake = { cron: doc.cron, tz: doc.tz, message: doc.message, enabled: doc.enabled === undefined ? true : doc.enabled };
    } else if (flag("wake-every") !== undefined || flag("wake-cron") !== undefined) {
      const mf = flag("wake-message-file");
      if (mf === true) bail("E_BAD_ARGS", "--wake-message-file needs a path");
      if (mf && !existsSync(mf)) bail("E_BAD_ARGS", `--wake-message-file not found: ${mf}`);
      const message = mf ? readFileSync(mf, "utf8") : flag("wake-message") === true ? undefined : flag("wake-message");
      wake = wakeFromFlags({ every: flag("wake-every") === true ? undefined : flag("wake-every"), cron: flag("wake-cron") === true ? undefined : flag("wake-cron"), tz: flag("wake-tz") === true ? undefined : flag("wake-tz"), message });
    }
    if (wake && (typeof wake.message !== "string" || !wake.message.trim())) bail("E_SCHEDULE_INVALID", "wake message: non-empty text is required");
  } catch (e) { if (e?.code?.startsWith?.("E_")) bail(e.code, e.message); throw e; }
  // Workspace model: when this deployment has an oats-local.yaml, the soul's
  // capabilities are resolved over the workspace's remotes (member = latest,
  // package = locked+approved) and copied whole into the new home. Without one
  // (a bare agents root, tests) the classic soul-directory spawn proceeds.
  let prepared;
  if (wsPrepared) {
    try {
      const { toCapabilityRows, modulesPreview } = await import("../lib/instance-resolution.mjs");
      prepared = wsPrepared;
      prepared.capabilityRows = []; // filled after materialization (paths live in the home); preview uses modulesPreview
      prepared.preview = modulesPreview(prepared.resolution, root, agent.name);
      prepared.toCapabilityRows = toCapabilityRows;
    } catch (e) { if (e?.code?.startsWith?.("E_")) bail(e.code, e.message, e.details); throw e; }
  }
  let r;
  try {
    if (args.includes("--allow-child-spawns") && args.includes("--no-child-spawns")) bail("E_BAD_ARGS", "--allow-child-spawns and --no-child-spawns contradict");
    if (flag("base") === true) bail("E_BAD_ARGS", "--base needs a ref");
    { const spawnOpts = {
      prepared,
      purpose: flag("purpose"), task: taskText, taskFile: taskFileFlag, relation, relativeTo, relativeRoot,
      ...(args.includes("--allow-child-spawns") ? { allowChildSpawns: true } : args.includes("--no-child-spawns") ? { allowChildSpawns: false } : {}),
      // Directory execution uses deployment configuration, not an ambient Git
      // checkout (especially when invoked via --dir from a source instance).
      repo: (requestedWork || agent.work) === "directory"
        ? (repo ?? agent.repo) : repo || agent.repo || defaultRepo(workspaceOf(root)) || defaultRepo(process.cwd()),
      work: requestedWork, workDir, runtime: flag("runtime"), backend, herdrSocket, yolo, model: flag("model"), branch,
      launchConfig: valueFlag("launch-config"),
      launch: !args.includes("--no-launch"),
      // K6: --preview decides everything and touches nothing; --base <ref>
      // selects a worktree's start point; --model @native-default is the
      // explicit "runtime's own default" (distinct from omitting --model).
      ...(args.includes("--preview") ? { preview: true, subject: { soul: name, agentsRoot: agentsRootFlag !== undefined ? String(agentsRootFlag) : null, dir: flag("dir") !== undefined && flag("dir") !== true ? String(flag("dir")) : null } } : {}),
      ...(flag("base") !== undefined && flag("base") !== true ? { baseRef: flag("base") } : {}),
      // A confirmed preview binds this apply (K6b): drift → E_DECISION_STALE, nothing created.
      ...(flag("expect-decision") !== undefined && flag("expect-decision") !== true ? { expectDecision: String(flag("expect-decision")) } : {}),
      // K6c: with --idempotency-key, a retry of the SAME confirmed decision replays the recorded home instead of spawning twice.
      ...(flag("idempotency-key") !== undefined && flag("idempotency-key") !== true ? { idempotencyKey: String(flag("idempotency-key")) } : {}),
    };
      r = prepared ? await spawnInstanceAsync(root, agent, spawnOpts) : spawnInstance(root, agent, spawnOpts); }
    if (args.includes("--preview")) {
      // A workspace preview may have fetched the soul's SOURCE under <agents-root>/<name>/soul/
      // (a per-commit cache, not an instance): the result says so.
      if (prepared) r.soulFetched = soulFetched;
      if (JSON_MODE) { jsonOk(r); return; }
      console.log(`preview ${r.agent} → ${r.instance} (${r.work}${r.branch ? `, branch ${r.branch} from ${r.base.ref}@${r.base.oid.slice(0, 12)}` : ""}) runtime ${r.runtime}${r.model ? ` model ${r.model}` : ` (${r.modelSource})`}; nothing was created${soulFetched ? ` (the soul source was fetched to ${shortPath(join(root, r.agent, "soul"))} — a per-commit copy, not an instance)` : ""}`);
      return;
    }
  } catch (e) {
    // A typed CLI failure keeps ITS OWN code: re-badging an unsafe-config-key
    // (raised by the readers spawn walks) as E_SPAWN_FAILED tells an agent
    // consumer the spawn mechanism broke, when the fixable fact is a poisoned
    // document the message already names. The shared boundary renders it.
    if (TYPED_CLI_FAILURES.has(e?.code)) throw e;
    // A launch refusal (configuration, executable, environment reference,
    // model, runtime) is a fact about the selection, not a spawn-mechanism
    // failure: it keeps its own code so a GUI can act on it.
    if (typeof e?.code === "string" && /^E_LAUNCH_|^E_MODEL_UNKNOWN$|^E_UNSUPPORTED_RUNTIME$/.test(e.code)) { bail(e.code, e.message); throw e; }
    // An unmet declared requirement is a fact about the soul's configuration
    // (with a remedy), not a spawn-mechanism failure: keep its code and details.
    if (e?.code === "E_REQUIREMENT_INACTIVE") { bail(e.code, e.message, { soul: e.soul, capabilities: e.capabilities, context: e.context, remedy: e.remedy }); throw e; }
    if (e?.code === "E_CHILD_SPAWNS_DISABLED") { bail(e.code, e.message, { parent: e.parent, policy: e.policy }); throw e; }
    if (["E_BRANCH_EXISTS", "E_BASE_UNKNOWN"].includes(e?.code)) { bail(e.code, e.message); throw e; }
    // K6b: the confirmed decision drifted — the fresh decision travels with the refusal so a GUI re-previews.
    if (e?.code === "E_DECISION_STALE") { bail(e.code, e.message, { decision: e.decision }); throw e; }
    if (e?.code === "E_IDEMPOTENCY_CONFLICT") { bail(e.code, e.message, { instance: e.instance, home: e.home }); throw e; }
    if (e?.code === "E_PLACEMENT_TAKEN") { bail(e.code, e.message, { instance: e.instance, home: e.home }); throw e; }
    if (e?.code === "E_SPAWN_INCOMPLETE") { bail(e.code, e.message, { instance: e.instance, home: e.home, launched: e.launched }); throw e; }
    bail(["E_BAD_ARGS", "E_RELATIVE_AMBIGUOUS"].includes(e.code) ? e.code : "E_SPAWN_FAILED", e.message || e); throw e;
  }
  // The instance exists from here on: a failed wake save is reported beside
  // the full receipt, never hidden, and never causes a second spawn.
  let wakeSchedule, wakeScheduleError;
  if (wake && r.replayed !== true) { // a replayed receipt re-saves nothing
    try { wakeSchedule = saveWakeForHome(scheduleScopeOf(workspaceOf(root)), { instance: r.instance, home: r.home, wake }); }
    catch (e) { wakeScheduleError = { code: e.code || "E_SCHEDULE_FAILED", message: e.message }; r.warnings = [...(r.warnings || []), `wake schedule NOT saved: ${e.message}`]; }
    // K6e: record the wake outcome in the home so a same-key replay can report
    // it instead of leaving "saved or not?" to inference.
    if (r.spawnIdempotencyKey) {
      try { const f = join(r.home, "instance.json"); const m = JSON.parse(readFileSync(f, "utf8")); m.wake = { requested: true, saved: !wakeScheduleError, error: wakeScheduleError ?? null }; writeFileSync(f, JSON.stringify(m, null, 2) + "\n"); r.wake = m.wake; } catch { /* the receipt still says it */ }
    }
  } else if (r.spawnIdempotencyKey && r.replayed !== true) {
    try { const f = join(r.home, "instance.json"); const m = JSON.parse(readFileSync(f, "utf8")); m.wake = { requested: false, saved: null, error: null }; writeFileSync(f, JSON.stringify(m, null, 2) + "\n"); r.wake = m.wake; } catch { /* nothing to record */ }
  }
  if (JSON_MODE) {
    // Desktop CLI API v1 spawn result — a FIXED shape (see docs/desktop-cli-api.md).
    jsonOk({
      instance: r.instance, agent: r.agent, home: r.home, work: r.work,
      branch: r.branch || null, launched: r.launched, warnings: r.warnings || [],
      ...(wakeSchedule ? { wakeSchedule } : {}), ...(wakeScheduleError ? { wakeScheduleError } : {}),
      tmux: r.tmux || null, repo: r.repo || null, runtime: r.runtime || null,
      model: r.model || null, parent: r.parentInstance || null,
      sibling: r.siblingInstance || null, relation: r.relation || null,
      spawnOrigin: r.spawnOrigin, attach: r.attach,
      ...(r.sessionTarget ? { sessionTarget: r.sessionTarget } : {}),
      ...(r.yolo !== undefined ? { yolo: r.yolo } : {}),
      // K6b/K6c: what bound this spawn, and whether this receipt is a replay of an earlier one.
      ...(r.decision ? { decision: r.decision } : {}), ...(r.replayed !== undefined ? { replayed: r.replayed } : {}),
      ...(r.wake !== undefined ? { wake: r.wake } : {}), // {requested, saved|null, error}: saved:null = outcome not recorded
      launchConfig: r.launch?.launchConfig ?? null, launch: r.launch || null, // already redacted by the kernel
    });
    return;
  }
  console.log(`Spawned ${r.instance} (${r.work}${r.branch ? `, branch ${r.branch}` : ""})${r.launched ? r.sessionTarget ? ` — Herdr pane "${r.sessionTarget.paneId}"` : ` — tmux window "${r.tmux.window}"` : " — not launched"}`);
  console.log(`  home:   ${shortPath(r.home)}`);
  if (wakeSchedule) console.log(`  wake:   schedule ${wakeSchedule.id} (${wakeSchedule.cron} ${wakeSchedule.tz}), next ${wakeSchedule.nextRun || "disabled"}`);
  if (wakeScheduleError) console.error(`  wake:   NOT saved — ${wakeScheduleError.message} (the instance is created and launched; add the wake by hand with oats schedule add)`);
  if (!r.launched) console.log(`  launch: oats session start --home ${shellQuote(r.home)}`);
  for (const w of r.warnings || []) console.log(`  WARNING: ${w}`);
  console.log(`  attach: ${r.attach}`);
}

function retireCmd() {
  const name = args[1];
  if (!name || name.startsWith("--")) die("usage: oats retire <instance> [--plan] [--plan-revision <rev> --idempotency-key <key>] [--home <path>] [--self] [--discard-worktree] [--delete-branch] [--keep-dir] [--force] [--json]");
  let homeFlag = flag("home");
  if (homeFlag === true) die("--home needs the instance home path");
  if (args.includes("--plan")) {
    // K3: what retirement would touch, with the design's defaults — read-only.
    dropAmbientRoot();
    let root; try { root = ensureRoot(dirFlag()); } catch (e) { return args.includes("--json") ? jsonFail(e.code || "E_NO_ROOT", e.message) : die(e.message); }
    try {
      const plan = planRetire(dirFlag(), root, name, { home: homeFlag });
      if (args.includes("--json")) { jsonOk(plan); return; }
      console.log(`retire ${name} — plan ${plan.planRevision}`);
      console.log(`  session ${plan.facts.session.state}; work ${plan.facts.work.observed ? `${plan.facts.work.changed} changed / ${plan.facts.work.untracked} untracked on ${plan.facts.work.branch ?? "detached"}` : `not observed (${plan.facts.work.reason})`}; children ${plan.facts.children.length}; pull request ${plan.facts.pullRequest}`);
      console.log(`  defaults: retain worktree ${plan.defaults.retainWorktree}, delete branch ${plan.defaults.deleteBranch}, stop children ${plan.defaults.stopChildren}`);
      for (const n of plan.notes) console.log(`  note: ${n}`);
      return;
    } catch (e) { return args.includes("--json") ? jsonFail(e.code || "E_LIFECYCLE_FAILED", e.message, e.candidates ? { candidates: e.candidates } : undefined) : die(e.message); }
  }
  // The calling instance knows its own home: self-retire never needs to
  // disambiguate a same-named twin by hand.
  if (homeFlag === undefined && process.env.OATS_INSTANCE_HOME && (process.env.PI_AGENT_INSTANCE === name || process.env.OATS_INSTANCE === name)) homeFlag = process.env.OATS_INSTANCE_HOME;
  const isSelf = process.env.PI_AGENT_INSTANCE === name || process.env.OATS_INSTANCE === name;
  if (isSelf && !args.includes("--self")) die(`"${name}" is the calling instance — self-retire is irreversible; if your task is complete and you were told to retire, re-run with --self (finish your memory files FIRST; your session dies ~8s after)`);
  if (!isSelf && args.includes("--self")) die(`--self given but "${name}" is not the calling instance`);
  let root = ensureRoot(dirFlag());
  // Cross-repo: the instance may home in a sibling repo of the team scope.
  if (!listAgents(root).some((a) => existsSync(join(a._dir, "instances", name)))) {
    const hit = findTeamInstance(dirFlag(), name);
    // Stdout carries only the envelope in JSON mode (the Desktop parses it).
    if (hit && resolve(hit.root) !== resolve(root)) { root = hit.root; (args.includes("--json") ? console.error : console.log)(`(cross-repo: instance homes at ${shortPath(root)})`); }
  }
  const retiringHome = homeFlag || findInstanceHome(root, name);
  // K3: a GUI-driven Remove carries the plan revision it showed and an
  // idempotency key. The revision is revalidated against a fresh plan
  // (E_PLAN_STALE with that plan attached — re-confirm, never act on the old
  // one); a retried key replays the recorded receipt instead of retiring twice.
  const planRev = flag("plan-revision"), idemKey = flag("idempotency-key");
  if (planRev === true || idemKey === true) die("--plan-revision and --idempotency-key need values");
  if ((planRev !== undefined) !== (idemKey !== undefined)) die("--plan-revision and --idempotency-key go together");
  let replayPath = null, childrenStopped = null, expectedBranch;
  if (planRev !== undefined) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(idemKey)) die("--idempotency-key: 1-128 chars of [A-Za-z0-9._:-]");
    // Replay first: after a successful retire the home is gone, so the receipt
    // (beside the instances dir, keyed by the idempotency key) is the answer.
    const replay = (dir) => { const p = join(dir, `.oats-retire-receipt.${idemKey}.json`); if (!existsSync(p)) return false; try { const prior = JSON.parse(readFileSync(p, "utf8")); if (prior.retired !== name) return false; if (args.includes("--json")) jsonOk({ ...prior, replayed: true }); else console.log(`retire ${name}: replayed receipt for key ${idemKey}`); return true; } catch { return false; } };
    for (const a of listAgents(root)) if (replay(join(a._dir, "instances"))) return;
    let fresh;
    try { fresh = planRetire(dirFlag(), root, name, { home: homeFlag }); } catch (e) { return args.includes("--json") ? jsonFail(e.code || "E_LIFECYCLE_FAILED", e.message) : die(e.message); }
    replayPath = join(dirname(fresh.home), `.oats-retire-receipt.${idemKey}.json`);
    if (fresh.planRevision !== planRev) return args.includes("--json") ? jsonFail("E_PLAN_STALE", `the retire plan changed since it was shown (${planRev} → ${fresh.planRevision}); review the fresh plan`, { plan: fresh }) : die(`the retire plan changed since it was shown; re-run oats retire ${name} --plan`);
    // The plan promised: recorded children are STOPPED first (bounded, never
    // escalated) and retained. A child still running after the grace refuses
    // the retirement — nothing is retired, the receipt names the pid.
    childrenStopped = [];
    for (const kid of fresh.facts.children) {
      try { const s = stopInstanceSession(kid.home, {}); childrenStopped.push({ instance: kid.instance, home: kid.home, ok: true, stopped: s.stopped, alreadyIdle: s.alreadyIdle }); }
      catch (e) { childrenStopped.push({ instance: kid.instance, home: kid.home, ok: false, code: e.code || "E_SESSION_STOP_FAILED", message: e.message, stillRunning: e.receipt?.stillRunning ?? null }); }
    }
    const running = childrenStopped.filter((k) => !k.ok);
    if (running.length) return args.includes("--json") ? jsonFail("E_CHILDREN_RUNNING", `${running.map((k) => k.instance).join(", ")} ${running.length === 1 ? "is" : "are"} still running after a bounded stop; nothing was retired and nothing was escalated`, { childrenStopped, plan: fresh }) : die(`children still running: ${running.map((k) => k.instance).join(", ")}; nothing retired`);
    expectedBranch = fresh.facts.work.observed ? fresh.facts.work.branch : undefined;
  }
  const r = retireInstance(root, name, { home: homeFlag, self: isSelf, deleteBranch: args.includes("--delete-branch"), discardWorktree: args.includes("--discard-worktree"), keepDir: args.includes("--keep-dir"), force: args.includes("--force"), ...(expectedBranch !== undefined ? { expectedBranch } : {}) });
  if (childrenStopped) r.childrenStopped = childrenStopped;
  if (replayPath) { r.planRevision = planRev; r.idempotencyKey = idemKey; r.replayed = false; try { writeFileAtomic(replayPath, JSON.stringify(r, null, 2)); } catch { /* receipt is evidence, not authority */ } }
  // A retired home's wake jobs are forgotten (definitions only; nothing is
  // stopped by this); a deferred self-retire keeps them until the home is gone.
  if (retiringHome && r.removedDir !== false && !r.deferred) { try { const gone = removeWakeForHome(scheduleScopeOf(workspaceOf(root)), retiringHome); if (gone.length) r.wakeSchedulesRemoved = gone; } catch (e) { r.warnings = [...(r.warnings || []), `wake schedules not cleaned: ${e.message}`]; } }
  // Deferred self-retire: nothing has been inspected, run, or removed yet. The
  // caller's window dies first; a detached process then retires the instance
  // as an external operator and writes its outcome beside the home.
  if (r.deferred) {
    if (args.includes("--json")) { console.log(JSON.stringify(r, null, 2)); return; }
    console.log(`Retirement of ${r.retired} (agent ${r.agent}) is ${r.alreadyScheduled ? "already " : ""}scheduled — say any goodbyes now.`);
    console.log(`  in ~${r.completesInSec}s a detached completion quiesces this runtime (that is what ends this window), preserves work, runs retire hooks and removes the home`);
    console.log(`  if the completion fails, this window stays, the failure shows in \`oats status\` and at ${shortPath(r.resultPath)}, and \`oats retire ${r.retired}\` retries it`);
    return;
  }
  // Forced removal past an incomplete cleanup: the home is gone because the
  // operator said so, but the external state it owed is still out there and
  // nobody else will mention it again.
  if (r.forcedIncomplete) {
    console.error(`Removed ${r.retired} under --force with cleanup INCOMPLETE — this external state was NOT cleaned up and is now yours to remove by hand:`);
    for (const f of r.forcedIncomplete) console.error(`  ${f}`);
  }
  if (args.includes("--json")) { console.log(JSON.stringify(r, null, 2)); if (r.rollbackIncomplete) process.exit(1); return; }
  // An unsuccessful cleanup retry must NOT read as a completed retirement: the
  // home and its external state are still there, and a zero exit would tell
  // both a human and any script that the work is done.
  if (r.rollbackIncomplete) {
    console.error(`Cleanup for ${r.retired} is INCOMPLETE — the instance home is retained at ${r.retainedHome} because external state may still exist:`);
    for (const f of r.rollbackIncomplete) console.error(`  ${f}`);
    console.error(`Fix the cause and re-run \`oats retire ${r.retired}\`; the home holds the state that cleanup needs.`);
    process.exit(1);
  }
  console.log(`Retired ${r.retired} (agent ${r.agent})${r.worktreeRemoved ? ", worktree removed" : ""}${r.branchDeleted ? ", branch deleted" : ""}`);
  // Preserving work and not saying so leaves the operator believing it is gone,
  // which is most of the harm of deleting it. Name the classes and the path.
  for (const recovery of r.workRecoveries || (r.workRecovery ? [r.workRecovery] : [])) {
    console.log(`Work that was not committed has been preserved: ${recovery.classes.join(", ")}`);
    console.log(`  ${recovery.path}`);
  }
  if (isSelf) console.log("This window dies in ~8s — say any goodbyes now.");
}

/** `oats schedule ...`: workspace-scoped definitions, host-owned execution
 *  (lib/schedule.mjs). Every subcommand answers the envelope; nothing here
 *  launches unless a job is due or run-now is asked. */
function scheduleCmd() {
  const sub = args[1];
  const id = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
  // One schedule-owning scope for a directory: the team workspace (the
  // config level declaring the team), else the outermost config level.
  const ws = scheduleScopeOf(dirFlag());
  const io = { hostStatus: () => hostUnitStatus() };
  const out = (result) => { if (JSON_MODE) jsonOk(result); else console.log(JSON.stringify(result, null, 2)); };
  const readSpec = () => {
    const inline = flag("spec-json");
    if (inline && inline !== true) { try { return JSON.parse(inline); } catch (e) { throw scheduleError("E_SCHEDULE_INVALID", `--spec-json is not valid JSON: ${e.message}`, { field: "file" }); } }
    const f = flag("file");
    if (!f || f === true) throw scheduleError("E_BAD_ARGS", "--file <spec.json> is required (a private JSON file with the definition)");
    if (!existsSync(f)) throw scheduleError("E_BAD_ARGS", `spec file not found: ${f}`);
    try { return JSON.parse(readFileSync(f, "utf8")); } catch (e) { throw scheduleError("E_SCHEDULE_INVALID", `${f} is not valid JSON: ${e.message}`, { field: "file" }); }
  };
  const needId = () => { if (!id) throw scheduleError("E_BAD_ARGS", `oats schedule ${sub} <id>`); return id; };
  try {
    switch (sub) {
      case "list": return out(listSchedules(ws, io));
      case "show": return out({ schedule: describeSchedule(ws, needId(), io) });
      case "add": { const spec = readSpec(); if (id && spec.id === undefined) spec.id = id; if (id && spec.id !== id) throw scheduleError("E_SCHEDULE_INVALID", `id ${JSON.stringify(spec.id)} in the file does not match ${JSON.stringify(id)}`, { field: "id" }); return out({ schedule: addSchedule(ws, spec, io) }); }
      case "update": return out({ schedule: updateSchedule(ws, needId(), readSpec(), io) });
      case "enable": return out({ schedule: setScheduleEnabled(ws, needId(), true, io) });
      case "disable": return out({ schedule: setScheduleEnabled(ws, needId(), false, io) });
      case "run": return out(runScheduleNow(ws, needId(), { io, force: args.includes("--force") }));
      case "remove": return out(removeSchedule(ws, needId(), { force: args.includes("--force") }));
      case "reconcile": return out(reconcileSchedule(ws, needId(), { io, clear: args.includes("--clear") }));
      case "tick": {
        const dryRun = args.includes("--dry-run");
        if (args.includes("--host")) return out(tickHost({ io, dryRun }));
        const reg = readRegistry();
        const considered = withHostLock(() => tickWorkspace(ws, { io, reg, wsList: reg.workspaces.includes(ws) ? reg.workspaces : [...reg.workspaces, ws], dryRun }));
        return out({ tickedAt: new Date().toISOString(), considered, scheduler: schedulerStatus(ws, io) });
      }
      case "host": {
        const op = args[2];
        if (op === "install") { registerWorkspace(ws); installHostUnit(); return out({ scheduler: schedulerStatus(ws, io) }); }
        if (op === "uninstall") { unregisterWorkspace(ws); if (!readRegistry().workspaces.length) uninstallHostUnit(); return out({ scheduler: schedulerStatus(ws, io) }); }
        if (op === "status") return out({ scheduler: schedulerStatus(ws, io) });
        throw scheduleError("E_BAD_ARGS", "oats schedule host install|uninstall|status");
      }
      default: throw scheduleError("E_BAD_ARGS", "usage: oats schedule list|show <id>|add <id> --file <spec.json>|update <id> --file <spec.json>|enable <id>|disable <id>|run <id> [--force]|remove <id> [--force]|reconcile <id> [--clear]|tick [--dry-run] [--host]|host install|uninstall|status [--dir <workspace>|--server <id>] [--json]");
    }
  } catch (e) {
    // K8b: typed refusal details travel (identity mismatch: key/declared; a refused file: its integrity source).
    const details = Object.fromEntries(["key", "declared", "source", "field"].filter((k) => e[k] !== undefined).map((k) => [k, e[k]]));
    if (JSON_MODE) jsonFail(e.code || "E_SCHEDULE_FAILED", e.message, Object.keys(details).length ? details : undefined); else die(e.message);
  }
}

async function sessionCmd() {
  try {
    if (flag("native-record") !== undefined) throw Object.assign(new Error("--native-record outcome inspection requires exact captured deployment/resolution selectors"), { code: "E_BAD_ARGS" });
    const home = flag("home");
    let result;
    if (args[1] === "attach") {
      if (JSON_MODE) throw Object.assign(new Error("session attach is interactive; omit --json"), { code: "E_BAD_ARGS" });
      process.exitCode = await attachInstanceSession(home);
      return;
    }
    if (args[1] === "inspect") result = inspectInstanceSession(home);
    else if (args[1] === "recompose") result = recomposeInstanceInstructions(home, { dryRun: args.includes("--dry-run") });
    else if (args[1] === "start" || args[1] === "restart") {
      const bad = (msg) => { throw Object.assign(new Error(msg), { code: "E_BAD_ARGS" }); };
      const model = flag("model");
      if (model === true) bad("--model needs a model id; omit it to keep the recorded model");
      const launchConfig = flag("launch-config");
      if (launchConfig === true) bad("--launch-config needs a configuration name, or none");
      const runtime = flag("runtime");
      if (runtime === true || (runtime !== undefined && !LAUNCH_RUNTIMES.includes(runtime))) bad(`--runtime must be one of ${LAUNCH_RUNTIMES.join(", ")}`);
      const opts = { model: model || undefined, launchConfig, runtime, yolo: yoloFlag(), env: process.env };
      if (args[1] === "restart") {
        const grace = flag("stop-grace");
        if (grace !== undefined) { if (grace === true || !/^\d+$/.test(String(grace)) || Number(grace) < 1 || Number(grace) > 300) bad("--stop-grace needs a number of seconds (1..300) to wait for the harness after SIGTERM"); opts.stopGraceMs = Number(grace) * 1000; }
        result = restartInstanceSession(home, opts);
      } else result = startInstanceSession(home, opts);
    } else if (args[1] === "input") {
      const file = flag("text-file");
      if (file === true) throw Object.assign(new Error("--text-file needs a path"), { code: "E_BAD_ARGS" });
      if (!file && process.stdin.isTTY) throw Object.assign(new Error("provide --text-file or pipe input on stdin"), { code: "E_BAD_ARGS" });
      result = inputInstanceSession(home, readFileSync(file || 0, "utf8"));
    } else if (args[1] === "receive") {
      // Bytes arrive on stdin (the routed upload pipes them through ssh),
      // collected event-driven and bounded before anything is written.
      const name = flag("name");
      if (!name || name === true) throw Object.assign(new Error("session receive needs --name <file name>"), { code: "E_BAD_ARGS" });
      if (!home || home === true) throw Object.assign(new Error("session receive needs --home </absolute/instance>"), { code: "E_BAD_ARGS" });
      if (process.stdin.isTTY) throw Object.assign(new Error("session receive reads the attachment bytes from stdin"), { code: "E_BAD_ARGS" });
      result = receiveAttachment(home, name, await readStreamBounded(process.stdin, MAX_ATTACHMENT_BYTES));
    } else if (args[1] === "upload") {
      const file = flag("file");
      if (!file || file === true) throw Object.assign(new Error("session upload needs --file <local path>"), { code: "E_BAD_ARGS" });
      result = uploadAttachment({ file, home: home === true ? undefined : home });
    } else throw Object.assign(new Error("usage: oats session inspect|input|attach|start|restart|receive|upload --home /absolute/home [--text-file path] [--model id] [--launch-config name|none] [--runtime pi|claude|codex] [--yolo|--no-yolo] [--stop-grace seconds] [--name file] [--file path] [--json]"), { code: "E_BAD_ARGS" });
    if (JSON_MODE) jsonOk(result); else console.log(JSON.stringify(result, null, 2));
  } catch (e) { cmdFail(e.code || "E_SESSION_FAILED", e.message); }
}

async function paneCmd() {
  die("`oats pane` has been retired — the OATS Desktop app (packages/desktop) is the control panel now.");
}

/** `oats onboard [<dir>] --workspace <repo ref> [--json]` — workspace model v2 (decision 9).
 *
 * Realizes a workspace on this machine in the taught `<name>-workspace/` layout
 * (docs/design/2026-09-23-simplified-workspace-model.md §4): writes
 * `<dir>/oats-local.yaml` naming the workspace, creates `<dir>/agents/` (the
 * instance homes), then runs exactly the `oats sync` path — discover over the
 * remotes, confirm membership, resolve `packages:`, approve (TTY) or list what
 * needs approval (exit 2), write `oats-lock.json`. Nothing is installed, no soul
 * is created, nothing is spawned, no `oats-config.yaml` is written: the member
 * clones and the setup expert are the operator's next steps, printed here. */
async function onboardCmd() {
  const bail = (code, message, details) => (JSON_MODE ? jsonFail(code, message, details) : die(message));
  const usage = "usage: oats onboard [<dir>] --workspace <repo ref> [--json]   (or --dir <dir>)";
  let positional, workspaceRef, dirValue;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") continue;
    if (arg === "--dir" || arg === "--workspace") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) return bail("E_BAD_ARGS", `--${arg.slice(2)} needs a value\n${usage}`);
      if (arg === "--dir") { if (dirValue !== undefined) return bail("E_BAD_ARGS", usage); dirValue = value; }
      else { if (workspaceRef !== undefined) return bail("E_BAD_ARGS", usage); workspaceRef = value; }
      i++; continue;
    }
    if (arg.startsWith("--")) return bail("E_BAD_ARGS", `unknown flag ${arg}\n${usage}`);
    if (positional !== undefined) return bail("E_BAD_ARGS", usage);
    positional = arg;
  }
  if (positional !== undefined && dirValue !== undefined) return bail("E_BAD_ARGS", `give the deployment directory once, as <dir> or --dir\n${usage}`);
  if (!workspaceRef || !workspaceRef.trim()) return bail("E_BAD_ARGS", `--workspace <repo ref> is required (the repository hosting oats-workspace.yaml)\n${usage}`);
  workspaceRef = workspaceRef.trim();
  // The ref must be one lib/remote.mjs understands BEFORE anything is written.
  try { remoteModule.parseRepoRef(workspaceRef); }
  catch (e) { return bail(e.code || "E_REPO_REF", e.message, e.details ?? e.provenance); }

  const dir = resolve(positional ?? dirValue ?? process.cwd());
  const localFile = join(dir, "oats-local.yaml");
  // (1) Refuse to onboard twice: THIS directory's oats-local.yaml is the mark (an enclosing
  // deployment's file does not count — a nested directory is a different deployment).
  let existing = null;
  try { existing = lstatSync(localFile); } catch (e) { if (e.code !== "ENOENT") return bail("E_ONBOARD_FAILED", `cannot inspect ${localFile}: ${e.message}`); }
  if (existing) return bail("E_ALREADY_ONBOARDED", `${shortPath(localFile)} already exists — this directory realizes a workspace; run \`oats sync --dir ${shortPath(dir)}\` to refresh it`, { local: localFile, dir });
  if (existsSync(dir) && !lstatSync(dir).isDirectory()) return bail("E_ONBOARD_FAILED", `${shortPath(dir)} exists and is not a directory`, { dir });

  // (2) The two files/dirs onboarding owns. Written atomically; rolled back if the sync
  // that follows cannot even read the workspace (a typo'd ref must not leave a
  // half-onboarded directory that looks finished).
  const created = [];
  try {
    if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); created.push(dir); }
    const local = { schemaVersion: 2, workspace: workspaceRef };
    writeFileAtomic(localFile, YAML.stringify(local));
    created.push(localFile);
    const agentsDir = join(dir, "agents");
    if (!existsSync(agentsDir)) { mkdirSync(agentsDir); created.push(agentsDir); }
  } catch (e) {
    rollback();
    return bail(e.code && String(e.code).startsWith("E_") ? e.code : "E_ONBOARD_FAILED", `cannot write ${shortPath(dir)}: ${e.message}`, { dir });
  }
  /** Only what THIS onboard created, only while still exactly ours: our local file, an EMPTY
   * agents/, an otherwise-empty <dir> (rmdirSync refuses a non-empty directory — evidence stays). */
  function rollback() {
    for (const p of [...created].reverse()) {
      try { if (p === localFile) rmSync(p, { force: true }); else rmdirSync(p); }
      catch { /* leave evidence rather than erase another writer's work */ }
    }
  }
  const bailRollback = (code, message, details) => { rollback(); return bail(code, message, { ...(details && typeof details === "object" ? details : {}), dir, rolledBack: true }); };

  // (3) Exactly the `oats sync` body over the deployment just written. A failure while
  // DISCOVERING (unreadable remote, not a workspace host) rolls the two files back; once the
  // workspace has been read, the files stay (a lock may already be written).
  let ctx;
  try {
    const found = loadLocal(dir);
    ctx = { dir, localPath: found.path, local: found.local, deploymentDir: dirname(found.path), remoteOptions: remoteOptionsFromEnv() };
  } catch (e) { return bailRollback(e.code || "E_LOCAL_MISSING", e.message, e.details); }
  let discovered = false;
  const syncBail = (code, message, details) => (discovered
    ? bail(code, message, { ...(details && typeof details === "object" ? details : {}), dir, local: localFile })
    : bailRollback(code, message, details));
  const synced = await performSync(ctx, syncBail, { onDiscovered: () => { discovered = true; } });

  // (4) The taught layout as next steps (design doc §4), and the envelope.
  const standalone = synced.discovery.standalone === true;
  const members = synced.report.members;
  // The setup expert is suggested only when THIS workspace lists a soul by that name (a
  // confirmed member's or, standalone, the repo's own); otherwise any listed soul is spawnable.
  const soulNames = synced.items.souls.map((s) => s.name);
  const setupExpert = soulNames.includes("oats-setup-expert");
  const spawnHint = setupExpert ? `oats spawn oats-setup-expert --dir ${shortPath(dir)}` : null;
  const anySoulHint = `spawn any listed soul: oats spawn <soul> --dir ${shortPath(dir)}${soulNames.length ? ` (e.g. ${soulNames.slice(0, 3).join(", ")})` : ""}`;
  // A member's clone goes beside oats-local.yaml under its repo name; `agents/` is the instance
  // homes, so a member called "agents" is cloned as `agents-repo/` (design doc §4).
  const cloneDirOf = (m) => join(dir, m.name === "agents" ? "agents-repo" : m.name);
  const clones = members.filter((m) => m.confirmed || (standalone && m.key === synced.discovery.key)).map((m) => ({ key: m.key, name: m.name, url: memberUrlOf(synced.discovery, m.key), dir: cloneDirOf(m) }));
  // Decision 26: the host publishes the member list to whoever can read it. When the host is
  // itself a member (the common `agents` shape) that is fine for an all-private or all-public
  // organisation; a mixed one needs a private host that is NOT a public member. The kernel
  // cannot see forge visibility, so it states the rule rather than judging.
  const hostIsMember = members.some((m) => m.key === synced.discovery.key);
  const hosting = { host: synced.discovery.key, hostIsMember, rule: "If any member is private, host oats-workspace.yaml in a private repo that is not a public member (a dedicated <org>/workspace repo); public contributors then use the standalone case (from: here capabilities + oats.core)." };
  const result = { onboardApi: 2, standalone: standalone || undefined, local: localFile, dir, agents: join(dir, "agents"), lock: synced.lockFile, sync: synced.report, hosting, next: { clone: clones, spawn: spawnHint, souls: soulNames.slice(0, 3) } };
  if (JSON_MODE) { jsonOk(result); process.exitCode = synced.approvalNeeded.length ? 2 : 0; return; }

  console.log(`Onboarded ${shortPath(dir)} into workspace ${workspaceName(synced.discovery)} (${synced.discovery.key} @ ${short(synced.discovery.commit)}).${standalone ? `\n  (standalone — the workspace of ${memberLabel(synced.discovery.key)} cannot be read from here; you get its own souls + oats.core)` : ""}\n`);
  printSyncReport(ctx, synced);
  console.log(`
Layout (the taught convention — the kernel finds clones through oats-local.yaml, so any layout works):
  ${shortPath(dir)}/
  ├── oats-local.yaml     which workspace this machine realizes (+ host settings, disabled souls)
  ├── oats-lock.json      exact commit + integrity + per-version executable approval per package
  ├── agents/             instance homes, each self-contained
  └── <member>/           clones of the members you will work IN (only those)

Next:
  1. Clone the members you will work IN beside oats-local.yaml (discovery and resolution run over the
     remotes; only a soul's work target needs a clone):${clones.map((c) => `\n       git clone ${c.url ?? c.key} ${shortPath(c.dir)}`).join("") || "\n       (no confirmed members yet — see the membership rows above)"}
     A clone elsewhere is fine: point at it in oats-local.yaml under clones: { <repo key>: <abs path> }.
  2. Check who may read the host: ${synced.discovery.key}${hostIsMember ? " is itself a member" : " is a dedicated host"}. The workspace file
     names every member, so if any member is private the host must be a private repo that is not
     a public member; public contributors then get the standalone case (from: here + oats.core).
  3. ${setupExpert ? "Spawn the setup expert to guide the rest (souls, teams, provider settings, approvals):" : "No soul named oats-setup-expert is listed here —"}
       ${spawnHint ?? anySoulHint}${synced.approvalNeeded.length ? `\n  (first: \`oats sync --dir ${shortPath(dir)}\` in a terminal to approve ${synced.approvalNeeded.map((a) => `${a.id} ${a.version}`).join(", ")})` : ""}`);
  process.exitCode = synced.approvalNeeded.length ? 2 : 0;
}

/** The clone URL of a member row: what the remote observed (from the workspace's members: refs;
 *  standalone, the one repo oats-local.yaml named). */
function memberUrlOf(discovery, key) {
  for (const ref of discovery.workspace?.members || []) {
    try { const parsed = remoteModule.parseRepoRef(ref); if (parsed.key === key) return parsed.url; } catch { /* schema already validated */ }
  }
  if (discovery.standalone === true && discovery.key === key) return discovery.url ?? null;
  return null;
}

function createCmd() {
  const yolo = yoloFlag();
  const name = args[1];
  if (!name || name.startsWith("--")) die("usage: oats create <name> [--local] [--no-oats-core] [--description <d>] [--type <agent-type>] [--repo <r>] [--work worktree|checkout|attached|workspace|directory] [--runtime pi|claude|codex] [--model <m>] [--yolo|--no-yolo] [--instructions-file <f>]");
  const local = args.includes("--local");
  const startDir = dirFlag();
  // `create` BOOTSTRAPS a deployment: with no agents/ or local-agents/ yet,
  // anchor at the enclosing git repo (else the start dir). It is the command
  // that populates the roster root, so it must not demand that the root
  // already exist — that demand was the first thing a new user hit after
  // `oats init` (a raw stack trace from ensureRoot). Local and committed souls
  // anchor the same way; writeSoul creates the directories.
  let root = findRoot(startDir);
  // A configured package-only scope may resolve its future agents root before
  // that directory exists. Preserve create's bootstrap receipt/message.
  let bootstrapped = !!root && !existsSync(root) && !existsSync(join(dirname(root), "local-agents"));
  if (!root) {
    root = join(defaultRepo(startDir) || resolve(startDir), "agents");
    bootstrapped = true;
  }
  const instrFile = flag("instructions-file");
  const r = coreCreateAgent(root, {
    name, local, oatsCore: !args.includes("--no-oats-core"), description: flag("description"), type: flag("type"), repo: flag("repo") || (flag("work") === "directory" ? undefined : defaultRepo(process.cwd())),
    work: flag("work"), runtime: flag("runtime"), model: flag("model"), yolo,
    instructions: instrFile ? readFileSync(instrFile, "utf8") : undefined,
  });
  // A declared oats.core is a requirement spawn will enforce: say the next
  // step here, not only at the refusal.
  const declared = r.declaredCapabilities || [];
  const inactive = declared.filter((id) => !(resolveOatsConfig(workspaceOf(root), name).capabilities || []).some((c) => c.id === id));
  const next = inactive.length ? [{ code: "next-step", message: `${name} declares ${inactive.join(", ")}; before spawning, pin their packages in oats-workspace.yaml packages: and declare them in soul.yaml capabilities: { <cap>: { from } } (workspace model v2)` }] : [];
  const notes = [...(r.notes || []), ...next];
  if (args.includes("--json")) { console.log(JSON.stringify({ ...r, ...(notes.length ? { notes } : {}), ...(bootstrapped ? { agentsRoot: root } : {}) }, null, 2)); return; }
  for (const information of notes) console.error(`[${information.code}] ${information.message}`);
  if (bootstrapped) console.log(`Created deployment root ${shortPath(root)} (this scope had no agents/ yet)`);
  console.log(`Created ${r.kind === "local" ? "LOCAL agent (uncommitted — soul lives in local-agents/, gitignored)" : "agent"} "${r.agent}" — soul at ${shortPath(r.soul)}`);
  console.log(`Edit ${shortPath(join(r.soul, "AGENTS.md"))} to define its role, then${inactive.length ? ` activate ${inactive.join(", ")} (above) and` : ":"} oats spawn ${r.agent} --task "..."`);
}

// ---------- capability command dispatch ----------
/**
 * oats <namespace> <command> [args…] — run a command an active capability
 * declares in its manifest (`commands: { name: "script args" }`).
 * Kernel subcommands take precedence over capability namespaces.
 */
function capabilityCommand() {
  // JSON-aware boundary: in --json mode every dispatch failure — inactive or
  // untrusted capability, duplicate namespace, unknown subcommand, broken
  // metadata/manifests, malformed command values — must still emit exactly
  // one envelope object on stdout. The WHOLE dispatcher runs inside the
  // boundary; only "no namespace matched" escapes (returns false to the help
  // fallthrough).
  const bail = (code, msg) => (JSON_MODE ? jsonFail(code, msg) : die(msg));
  const NOT_DISPATCHED = Symbol("not-dispatched");
  let outcome;
  try { outcome = dispatch(); }
  catch (e) {
    // Unexpected throw from discovery/trust/decoding: keep the envelope contract.
    bail("E_CAPABILITY_BROKEN", e.message || e);
    throw e;
  }
  return outcome !== NOT_DISPATCHED;

  function dispatch() {
    let activeIds;
    let context = process.cwd();
    let teamCtx;
    const instanceHome = process.env.PI_AGENT_HOME || process.env.OATS_HOME;
    const metaFile = instanceHome && join(instanceHome, "instance.json");
    // Capability-id keyed — never answer for `constructor`/`toString`. Belt and
    // braces: the ids come from instance.json, which spawn wrote from resolved
    // manifests. Null-prototype because the dispatcher indexes it with the
    // namespace the operator typed on the command line.
    let capSettings = Object.create(null);
    let instanceModules = false;
    try {
      if (metaFile && existsSync(metaFile)) {
        const meta = JSON.parse(readFileSync(metaFile, "utf8"));
        instanceModules = !!(meta.modules && typeof meta.modules === "object");
        activeIds = (meta.capabilities || []).map((c) => c.id);
        for (const c of meta.capabilities || []) capSettings[c.id] = c.settings || {};
        context = meta.repo || context;
        // Team: the spawn-time snapshot, but fall back to live config — instances
        // spawned before a team: block was declared have no snapshot.
        teamCtx = meta.team || resolveOatsConfig(context).team;
      } else {
        const resolved = resolveOatsConfig(context, flag("soul"));
        activeIds = resolved.capabilities.map((c) => c.id);
        for (const c of resolved.capabilities) capSettings[c.id] = c.settings || {};
        teamCtx = resolved.team;
      }
    } catch (e) { bail("E_CONFIG_BROKEN", e.message || e); throw e; }
    // Workspace model: an instance's own materialized modules are the command
    // namespaces available to it (instance.json.modules → <home>/.oats/modules).
    const mans = Object.values(capabilityManifests(instanceModules ? instanceHome : context)).filter((m) => m.command === cmd && m.commands);
    if (!mans.length) return NOT_DISPATCHED;
    if (mans.length > 1) bail("E_DUPLICATE_NAMESPACE", `duplicate operational command namespace "${cmd}": ${mans.map((m) => m.capability).join(", ")}`);
    const m = mans[0];
    if (!activeIds.includes(m.capability)) bail("E_CAPABILITY_INACTIVE", `${m.capability} command namespace is not active in the current context/instance`);
    const trust = capabilityTrust(m, context);
    if (!trust.trusted) bail("E_CAPABILITY_BLOCKED", `${m.capability} executable command is blocked: ${trust.reason}`);
    const sub = args[1];
    const cmds = Object.keys(m.commands);
    // `oats <ns> --help` and `oats <ns> <cmd> --help` answer from the manifest
    // and never run the executable: the command's own help, if it has one,
    // is not worth a side effect (harvest --help once spawned a harvester).
    if (HELP_WORDS.has(sub) || args.slice(2).some((a) => a === "--help" || a === "-h")) {
      const known = sub && !HELP_WORDS.has(sub) && Object.prototype.hasOwnProperty.call(m.commands, sub);
      if (JSON_MODE) { jsonOk({ capability: m.capability, namespace: cmd, command: known ? sub : null, commands: cmds, description: m.description || null, help: "printed from the manifest; the executable was not run" }); return; }
      console.log(`oats ${cmd}${known ? ` ${sub}` : ""} — ${m.capability}${m.description ? `: ${m.description}` : ""}`);
      console.log(`  commands: ${cmds.join(", ") || "(none)"}`);
      console.log(`  (help printed from the manifest; the executable was not run)`);
      process.exit(0);
    }
    // Distinguish an ABSENT key from a declared-but-invalid value: a manifest
    // entry of "" / 0 / false / null is a broken capability, not an unknown
    // command (it is listed in cmds).
    if (!sub || !Object.prototype.hasOwnProperty.call(m.commands, sub)) {
      if (JSON_MODE) jsonFail("E_UNKNOWN_COMMAND", `oats ${cmd}: ${sub ? `unknown command "${sub}"` : "missing command"} — commands: ${cmds.join(", ") || "(none)"}`);
      console.error(`oats ${cmd} — commands: ${cmds.join(", ") || "(none)"}`);
      process.exit(sub ? 1 : 0);
    }
    // Command values come from third-party manifests — validate before decoding.
    const spec = m.commands[sub];
    if (typeof spec !== "string" || !spec.trim()) bail("E_CAPABILITY_BROKEN", `oats ${cmd} ${sub}: manifest command must be a non-empty string (got ${JSON.stringify(spec)})`);
    const [script, ...rest] = spec.trim().split(/\s+/);
    let abs;
    try { abs = capabilityExecutablePath(m, script); }
    catch (e) { bail("E_CAPABILITY_BROKEN", e.message); }
    if (!abs) bail("E_CAPABILITY_BROKEN", `${cmd} ${sub}: script not found (${join(m._dir, script)})`);
    const r = spawnSync("node", [abs, ...rest, ...args.slice(2)], { stdio: "inherit", env: {
      ...process.env, OATS_CAPABILITY: m.capability,
      // Package-runtime boundary: dispatched commands receive the active
      // capability's EFFECTIVE settings (instance snapshot or resolved context),
      // same contract as lifecycle hooks — capabilities read their settings
      // here instead of importing the kernel resolver.
      OATS_SETTINGS: JSON.stringify(capSettings[m.capability] || {}),
      // PATH is not a trusted runtime boundary (maintainer finding 1): pass the
      // canonical absolute executable of THIS CLI; official consumers execFile
      // it directly and never resolve `oats` from PATH or a shell.
      OATS_CLI_BIN: CLI_BIN,
      OATS_TEAM_NAME: teamCtx?.name || "", OATS_TEAM_ID: teamCtx?.id || "", OATS_TEAM_SCOPE: teamCtx?.scope || "",
    } });
    // Child never ran (spawn error): nothing reached stdout — keep the envelope contract.
    if (r.error) bail("E_CAPABILITY_BROKEN", `oats ${cmd} ${sub}: ${r.error.message || r.error}`);
    process.exit(r.status ?? 1);
  }
}

// ---------- agent types ----------
function typeCmd() {
  const sub = args[1];
  const dir = dirFlag();
  const file = join(dir, "oats-config.yaml");
  if (sub === "list") {
    const seen = new Map();
    for (const cfg of configChain(dir)) for (const [name, spec] of Object.entries(cfg["agent-types"] || {})) if (!seen.has(name)) seen.set(name, { desc: spec?.description, level: cfg._level });
    if (!seen.size) { console.log("No agent types declared in the config chain."); return; }
    for (const [name, { desc, level }] of seen) console.log(`${name}  ${desc ? `— ${desc}  ` : ""}[${shortPath(level)}]`);
    return;
  }
  if (sub !== "add" || !args[2] || args[2].startsWith("--")) die("usage: oats type add <name> [--description <d>] [--dir <dir>] | oats type list [--dir <dir>]");
  const name = args[2];
  if (!/^[a-z][a-z0-9-]*$/.test(name)) die(`agent type "${name}" must be lowercase alphanumeric/hyphens`);
  const description = flag("description");
  let text = existsSync(file) ? readFileSync(file, "utf8") : `name: ${scaffoldConfigName(dir)}\n`;
  const cfg = existsSync(file) ? withConfigFile(file, () => parseYamlNested(text)) : {};
  // Own-property: `constructor` is a legal agent-type name, and a plain lookup
  // would report it as already declared in a config that never mentions it.
  const declaredTypes = cfg["agent-types"];
  if (declaredTypes && typeof declaredTypes === "object" && Object.hasOwn(declaredTypes, name)) die(`agent type "${name}" already declared in ${shortPath(file)}`);
  // The NAME is already held to a strict grammar above; the DESCRIPTION was
  // written verbatim onto its own line, so it could inject document the same
  // way a `--settings` value could.
  const block = [`  ${name}:`, ...(description ? [`    description: ${assertSafeConfigValue(description, "--description")}`] : [])];
  const lines = text.replace(/\n*$/, "\n").split("\n");
  // Drop the scaffold comment block once a real agent-types block exists.
  const scaffold = lines.findIndex((l) => /^# ── Agent types/.test(l));
  if (scaffold >= 0) {
    let e = scaffold;
    while (e < lines.length && (/^#/.test(lines[e]) || lines[e] === "")) { if (lines[e] === "" && !/^#/.test(lines[e + 1] || "x")) break; e++; }
    lines.splice(scaffold, e - scaffold);
  }
  const start = lines.findIndex((l) => /^agent-types:\s*(#.*)?$/.test(l));
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && (/^\s/.test(lines[end]) || lines[end] === "")) { if (lines[end] === "" && !/^\s/.test(lines[end + 1] || "x")) break; end++; }
    lines.splice(end, 0, ...block);
  } else {
    lines.splice(1, 0, "", "agent-types:", ...block);
  }
  writeFileSync(file, lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n*$/, "\n"));
  console.log(`Declared agent type "${name}" at ${levelOf(dir)} level (${shortPath(file)})`);
  console.log(`Souls join it with: oats create <agent> --type ${name} (or type: ${name} in soul.yaml)`);
}

// ---------- update ----------
function updateCmd() {
  const checkOnly = args.includes("--check");
  let latest;
  try { latest = execFileSync("npm", ["view", "@awebai/oats", "version"], { encoding: "utf8", timeout: 30000 }).trim(); }
  catch (e) { die(`cannot check npm for the latest version: ${e.message}`); }
  console.log(`@awebai/oats  installed: ${OATS_VERSION}  latest: ${latest}`);
  // pi bridge, if a pi installation carries it.
  let piBridge;
  const piPkg = join(homedir(), ".pi", "agent", "npm", "node_modules", "@awebai", "oats-pi", "package.json");
  if (existsSync(piPkg)) piBridge = JSON.parse(readFileSync(piPkg, "utf8")).version;
  if (piBridge) console.log(`@awebai/oats-pi   installed: ${piBridge}  latest: ${latest} (published in lockstep)`);
  if (latest === OATS_VERSION && (!piBridge || piBridge === latest)) { console.log("Up to date."); return; }
  const steps = [];
  if (latest !== OATS_VERSION) steps.push(`npm install -g @awebai/oats@${latest}`);
  if (piBridge && piBridge !== latest) steps.push(`pi uninstall npm:@awebai/oats-pi@${piBridge}`, `pi install npm:@awebai/oats-pi@${latest}`);
  console.log("\nUpdate steps:");
  for (const s of steps) console.log(`  ${s}`);
  if (checkOnly) { console.log("\n(--check: not executing)"); return; }
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  if (interactive) {
    process.stdout.write("\nRun these now? [y/N] ");
    const buf = Buffer.alloc(16);
    let answer = "";
    try { answer = buf.toString("utf8", 0, readSync(0, buf, 0, 16)).trim().toLowerCase(); } catch { /* no input */ }
    if (answer !== "y" && answer !== "yes") { console.log("Not updating."); return; }
  } else if (!args.includes("--yes")) {
    console.log("\nNon-interactive: pass --yes to execute, or run the steps yourself.");
    return;
  }
  for (const s of steps) {
    console.log(`\n$ ${s}`);
    const [bin, ...rest] = s.split(/\s+/);
    const r = spawnSync(bin, rest, { stdio: "inherit" });
    if (r.status !== 0) die(`step failed: ${s}`);
  }
  console.log(`\nUpdated to ${latest}. Now verify each deployment: run \`oats doctor\` at your workspace/repo scopes — it reports config spellings this version rejects, version skew, and missing requirements. Restart running pi sessions to pick up the new bridge.`);
}

// ---------- version (Desktop CLI API v1 probe) ----------
function versionCmd() {
  if (JSON_MODE) {
    // EXACT Desktop API v1 probe payload — one JSON object, nothing else on
    // stdout. Desktop accepts desktopApi === 1 and a compatible semver range.
    // `remote`: this kernel's remote-side surface: the commands it routes to
    // a registered server with --server, plus `roster` (the local command
    // over registrations and saved routes); a Desktop gates its remote path
    // on it (an older CLI without the surface must fail closed with a
    // reason, not an argument error). `features`: kernel abilities a peer
    // must see before relying on them (retire-home: retire --home).
    // Phase B: `instance-modules` and `spawn-provider-payload` are advertised only once spawn
    // runs on resolve/materialize (contract §6); a feature the binary does not implement is
    // never listed.
    console.log(JSON.stringify({ schemaVersion: 1, name: "@awebai/oats", version: OATS_VERSION, desktopApi: 1, runtimes: ["pi", "claude", "codex"], sessionBackends: ["tmux", "herdr"], launchOptions: ["yolo"], remote: ["spawn", "retire", "status", "session", "session-start", "session-restart", "launch-config", "roster", "harvest", "schedule", "session-upload", "operations"], features: ["retire-home", "session-start", "session-restart", "launch-config", "schedule", "session-upload", "operations", "instance-git", "instance-git-remote", "souls-declarations", "lifecycle-plans", "retire-retention", "readiness", "spawn-preview", "instance-events", "instance-events-2", "schedule-history", "schedule-read-2", "session-recompose", "readiness-verify", "spawn-preview-2", "spawn-idempotency", "spawn-idempotency-2", "spawn-apply-2", "workspace-v2", "instance-modules", "spawn-provider-payload"], workspaceApi: 2, instanceGitApi: 1, spawnApplyApi: 1, soulsApi: 1, lifecycleApi: 1, readinessApi: 1, spawnPreviewApi: 2, eventsApi: 2, scheduleHistoryApi: 3, scheduleApi: SCHEDULE_API, operationsApi: 1, capturedDispatchApi: 1, capturedDispatchActions: ["inspect", "compose", "command", "operation", "spawn", "trust"] }));
    return;
  }
  console.log(`@awebai/oats ${OATS_VERSION} (desktop API v1)`);
}

// ---------- the record (core) and experimental tools over it ----------
// The turn record is the core: capture, recall, setup are kernel-level
// subcommands, dispatched to packages/record (shipped inside this package —
// see "files" in package.json). The record bins parse process.argv.slice(2)
// themselves, so the consumed subcommand words are spliced out first.
// Everything that selects or synthesizes over the record (dress, spawn,
// segments, mind) is EXPERIMENTAL and ships only in the oats repo checkout,
// under packages/experimental — absent from the published tarball on
// purpose, so its presence is exactly its status.
const EXPERIMENTAL_CMDS = new Set(["dress", "spawn", "segments", "mind"]);
async function recordCmd(sub) {
  process.argv.splice(2, 1);
  await import(new URL(`../packages/record/bin/${sub}.mjs`, import.meta.url));
}
async function experimentalCmd() {
  const sub = args[1];
  if (!sub || !EXPERIMENTAL_CMDS.has(sub)) {
    console.error(
      "usage: oats experimental <dress|spawn|segments|mind> [options]\n" +
        "EXPERIMENTAL tools over the turn record — unproven by design; see packages/experimental/README.md",
    );
    process.exit(sub === undefined ? 0 : 2);
  }
  const url = new URL(`../packages/experimental/bin/${sub}.mjs`, import.meta.url);
  if (!existsSync(url)) {
    die(
      `experimental tools ship only in the oats repo checkout, not in the published package — clone github.com/awebai/oats and run \`oats experimental ${sub}\` from it`,
    );
  }
  process.argv.splice(2, 2);
  await import(url);
}

// ---------- servers: registry and remote routing (docs/execution-targets.md) ----------
/** `oats server add|list|remove|check`. A registration is where and how:
 *  an OpenSSH host alias, the remote workspace, the remote oats path. Keys
 *  and passwords never enter it; ssh owns those. */
function serverCmd() {
  const bail = (code, msg) => (JSON_MODE ? jsonFail(code, msg) : die(msg));
  const sub = args[1];
  const usage = "usage: oats server add <id> --ssh <host-alias> --workspace </abs/path> [--oats <path>] [--herdr <path>] [--path <dir:dir>] [--label <text>] [--replace] | list | remove <id> | check <id> | roster [--server <id>] | forget <id> --instance <name>  [--json]";
  if (!["add", "list", "remove", "check", "roster", "forget"].includes(sub)) bail("E_USAGE", usage);
  if (sub === "forget") {
    // A saved route whose remote instance is gone can be dropped only by
    // the operator: nothing routed can do it, and the changed-registration
    // guard counts it until then.
    const id = args[2];
    const inst = flag("instance");
    if (!id || id.startsWith("--") || !inst || inst === true) bail("E_USAGE", "usage: oats server forget <id> --instance <name> [--json]");
    let snap;
    try { snap = forgetSnapshot(id, inst); } catch (e) { bail(e.code || "E_SNAPSHOT_UNKNOWN", e.message); }
    if (JSON_MODE) { jsonOk({ server: id, instance: inst, home: snap.home, target: snap.target, forgotten: true }); return; }
    console.log(`Forgot the saved route of ${inst} through ${id} (${snap.target?.sshHost}:${snap.home}).`);
    console.log(`  if that home still exists on the host it is no longer managed from here: retire it there with oats retire ${inst} --home ${snap.home}`);
    return;
  }
  if (sub === "roster") {
    // The remote roster for the Desktop and operators: grouped by saved route
    // target, one bounded status pull per target, saved routes as the action
    // authority. --server narrows to one registry id.
    const only = flag("server") === true ? bail("E_BAD_ARGS", "--server needs a registered server id") : flag("server");
    const ms = (name) => { const v = flag(name); if (v === undefined) return undefined; const n = Number(v); if (!Number.isInteger(n) || n < 1000) bail("E_BAD_ARGS", `--${name} takes whole milliseconds, at least 1000`); return n; };
    let out;
    try { out = rosterGroups({ server: only, io: { budgetMs: ms("budget"), perTargetTimeoutMs: ms("per-target") } }); } catch (e) { bail(e.code || "E_SERVERS_UNREADABLE", e.message); }
    if (JSON_MODE) { jsonOk(out); return; }
    if (!out.groups.length) { console.log("no remote groups: no registrations and no saved routes"); return; }
    for (const g of out.groups) {
      console.log(`  ${g.server}${g.label && g.label !== g.server ? `  ${g.label}` : ""}  [${g.id}]  ssh ${g.target.sshHost}  workspace ${g.target.workspace}${g.registrationPresent ? "" : "  (registration removed or changed; saved routes only)"}`);
      console.log(g.probe?.ok ? `      reachable, ${g.souls.length} soul(s)` : `      UNREACHABLE: ${g.probe?.error?.message || "?"}`);
      for (const i of g.instances) console.log(`      • ${i.instance}  ${i.missingRemotely ? "GONE on the host (saved route is stale: oats server forget)" : i.running === true ? "RUNNING" : i.running === false ? "idle" : "unknown"}${i.retirePending ? " RETIRING" : ""}${i.rollbackIncomplete ? " QUARANTINED" : ""}${i.savedRoute ? "" : "  (observed only, no saved route)"}${i.runtimeError ? `  ${i.runtimeError}` : ""}`);
      for (const f of g.retireFailures || []) console.log(`      ! deferred retirement of ${f.instance} (${f.agent}) FAILED there${f.error?.message ? `: ${f.error.message}` : ""}${f.retry ? ` — retry on the host: ${f.retry}` : ""}`);
    }
    console.log(`  bounds: ${out.bounds.perTargetTimeoutMs} ms per target within ${out.bounds.budgetMs} ms, ${out.bounds.elapsedMs} ms used${out.bounds.skipped ? `, ${out.bounds.skipped} target(s) not reached` : ""}`);
    return;
  }
  let servers;
  try { servers = readServers(); } catch (e) { bail(e.code || "E_SERVERS_UNREADABLE", e.message); }
  if (sub === "list") {
    const rows = Object.entries(servers).map(([id, s]) => ({ id, ...s, target: targetOf({ id, ...s }), snapshots: listSnapshots(id).length }));
    if (JSON_MODE) { jsonOk({ file: SERVERS_FILE(), servers: rows }); return; }
    if (!rows.length) { console.log(`no servers registered (${shortPath(SERVERS_FILE())}) — add one with \`oats server add <id> --ssh <alias> --workspace </path>\``); return; }
    for (const r of rows) console.log(`  ${r.id}${r.label ? `  ${r.label}` : ""}\n      ssh ${r.sshHost}  workspace ${r.workspace}  oats ${r.target.oatsPath}${r.target.herdrPath ? `  herdr ${r.target.herdrPath}` : ""}${r.snapshots ? `  (${r.snapshots} remote instance${r.snapshots === 1 ? "" : "s"} spawned from here)` : ""}`);
    return;
  }
  const id = args[2];
  if (!id || id.startsWith("--")) bail("E_USAGE", usage);
  if (sub === "add") {
    const val = (name) => { const v = flag(name); return v === true ? bail("E_BAD_ARGS", `--${name} needs a value`) : v; };
    const entry = { sshHost: val("ssh"), workspace: val("workspace") };
    for (const [k, f] of [["oatsPath", "oats"], ["herdrPath", "herdr"], ["path", "path"], ["label", "label"]]) { const v = val(f); if (v !== undefined) entry[k] = v; }
    if (!entry.sshHost || !entry.workspace) bail("E_USAGE", usage);
    try { validateServer(id, entry); } catch (e) { bail(e.code, e.message); }
    if (servers[id] && !args.includes("--replace")) bail("E_SERVER_EXISTS", `server ${id} is already registered (pass --replace to overwrite; existing remote instances keep the route they were spawned with)`);
    servers[id] = entry;
    writeServers(servers);
    if (JSON_MODE) { jsonOk({ id, ...entry, file: SERVERS_FILE() }); return; }
    console.log(`Registered server ${id} → ssh ${entry.sshHost}, workspace ${entry.workspace} (${shortPath(SERVERS_FILE())}). Verify it with \`oats server check ${id}\`.`);
    return;
  }
  if (sub === "remove") {
    if (!servers[id]) bail("E_SERVER_UNKNOWN", `no server registered as ${id}`);
    const snaps = listSnapshots(id);
    delete servers[id];
    writeServers(servers);
    if (JSON_MODE) { jsonOk({ removed: id, remoteInstancesStillTracked: snaps.map((s) => s.instance) }); return; }
    console.log(`Removed server ${id}${snaps.length ? ` — ${snaps.length} remote instance(s) spawned from it keep their snapshots and can still be retired with --server ${id}` : ""}`);
    return;
  }
  // check: reachability and compatibility, no mutation
  let server; try { server = getServer(id); } catch (e) { bail(e.code, e.message); }
  const target = targetOf(server);
  try {
    const remote = checkRemote(target);
    const status = routeCommand(id, "status", [], { server });
    const agents = status.envelope.ok ? (status.envelope.result.agents || []).length : undefined;
    if (JSON_MODE) { jsonOk({ id, target, remote, workspaceReachable: !!status.envelope.ok, agents, error: status.envelope.ok ? undefined : status.envelope.error }); return; }
    console.log(`${id}: ssh ${target.sshHost} ok, remote oats ${remote.version} (envelope v${remote.schemaVersion})`);
    console.log(status.envelope.ok ? `  workspace ${target.workspace}: ${agents} agent(s)` : `  workspace ${target.workspace}: ${status.envelope.error?.message || "not usable"}`);
    if (!status.envelope.ok) process.exit(1);
  } catch (e) { bail(e.code || "E_SSH", e.message); }
}

/** `oats <spawn|retire|status> --server <id> ...`: run the command on the
 *  registered server's installed oats, same arguments, same envelope. The
 *  local side only routes and keeps the route snapshot per remote instance. */
async function serverRouteCmd() {
  const bail = (code, msg) => (JSON_MODE ? jsonFail(code, msg) : die(msg));
  const id = flag("server");
  if (id === true || !id) bail("E_BAD_ARGS", "--server needs a registered server id (oats server list)");
  // The operations contract addresses an exact member context on the host,
  // so its explicit --dir travels; every other routed command takes its
  // scope from the registration.
  const explicitScopeOk = ["inspect", "operation", "soul", "launch-config"].includes(cmd);
  if (!explicitScopeOk && (flag("dir") !== undefined || args.some((a) => a.startsWith("--dir=")))) bail("E_BAD_ARGS", "--dir cannot be combined with --server: the remote workspace comes from the server registration");
  if (cmd === "launch-config") {
    const action = args[1];
    const value = (name) => { const v = flag(name); if (v === true) bail("E_BAD_ARGS", `--${name} needs a value`); return v; };
    if (!["list", "set", "remove", "preview"].includes(action)) bail("E_BAD_ARGS", "launch-config --server supports list, set, remove and preview");
    const options = { action, name: args[2], context: value("dir"), home: value("home"), instance: value("instance"), soul: value("soul"), agentsRoot: value("agents-root") };
    if (action === "preview") Object.assign(options, { launchConfig: value("launch-config"), runtime: value("runtime"), model: value("model"), yolo: yoloFlag() });
    if (action === "set") {
      const file = value("file");
      if (!file) bail("E_BAD_ARGS", "launch-config set needs --file <local JSON file> (or - for stdin)");
      let raw;
      try {
        if (file === "-") {
          if (process.stdin.isTTY) bail("E_BAD_ARGS", "--file - reads the definition from stdin");
          raw = await readStreamBounded(process.stdin, INSPECT_TEXT_CAP);
        } else raw = readFileSync(file);
      } catch (e) { bail("E_BAD_ARGS", `cannot read launch configuration file (${e.code || "read failed"})`); }
      if (raw.length > INSPECT_TEXT_CAP) bail("E_BAD_ARGS", "launch configuration file exceeds the input limit");
      try { options.definition = JSON.parse(raw.toString("utf8")); }
      catch { bail("E_BAD_ARGS", "launch configuration file is not valid JSON"); }
      options.keepEnv = args.includes("--keep-env");
    }
    let out;
    try { out = launchConfigRemote(id, options); } catch (e) { bail(e.code || "E_SSH", e.message); }
    if (out.stderr?.trim()) process.stderr.write(out.stderr.endsWith("\n") ? out.stderr : out.stderr + "\n");
    if (JSON_MODE) { console.log(JSON.stringify(out.envelope, null, 2)); if (!out.envelope.ok) process.exit(1); return; }
    if (!out.envelope.ok) die(`${id}: ${out.envelope.error?.message || "launch configuration request failed"} (${out.envelope.error?.code || "E_REMOTE"})`);
    console.log(JSON.stringify(out.envelope.result, null, 2));
    return;
  }
  // Interactive viewer: `oats session attach --server <id> --instance <name>`
  // (or --home </abs/remote/home>) runs the execution host's own attach
  // through an ssh PTY with this terminal's stdio; nothing is captured.
  if (cmd === "okf") {
    // `oats okf harvest --server <id> --instance <name>`: the package's
    // harvest command run in the instance's SAVED home on the host.
    if (args[1] !== "harvest") bail("E_USAGE", "--server routes `okf harvest` only among the okf commands");
    const inst = flag("instance");
    if (!inst || inst === true) bail("E_BAD_ARGS", "okf harvest --server needs --instance <name> (spawned from here)");
    let routed;
    try { routed = routeCommand(id, "harvest", [inst]); } catch (e) { bail(e.code || "E_SSH", e.message); }
    if (routed.stderr?.trim()) process.stderr.write(routed.stderr.endsWith("\n") ? routed.stderr : routed.stderr + "\n");
    if (JSON_MODE) { console.log(JSON.stringify(routed.envelope, null, 2)); if (!routed.envelope.ok) process.exit(1); return; }
    if (!routed.envelope.ok) die(`${id}: ${routed.envelope.error?.message || "harvest failed"} (${routed.envelope.error?.code || "E_REMOTE"})`);
    const hr = routed.envelope.result;
    console.log(`Harvest on ${id} for ${inst}: ${hr.harvest}${hr.reason ? ` (${hr.reason})` : ""}${hr.instance && hr.harvest === "spawned" ? ` — harvester ${hr.instance}` : ""}`);
    if (hr.instance && hr.instance !== inst) console.log(`  the harvester ${hr.instance} runs on ${id}; retire it there when it is done, or let it self-retire`);
    return;
  }
  if (cmd === "schedule") {
    // Host-owned: the subcommand runs in the server's registered workspace.
    // A local --file spec is read here and travels inline; the remote
    // cannot read this machine's files.
    const rest = [];
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (a === "--server") { i++; continue; }
      if (a === "--json") continue;
      if (a === "--file") {
        const f = args[++i];
        if (!f || f.startsWith("--")) bail("E_BAD_ARGS", "--file needs a path");
        if (!existsSync(f)) bail("E_BAD_ARGS", `spec file not found: ${f}`);
        rest.push("--spec-json", readFileSync(f, "utf8"));
        continue;
      }
      rest.push(a);
    }
    let out;
    try { out = scheduleRemote(id, rest); } catch (e) { bail(e.code || "E_SSH", e.message); }
    if (out.stderr?.trim()) process.stderr.write(out.stderr.endsWith("\n") ? out.stderr : out.stderr + "\n");
    if (JSON_MODE) { console.log(JSON.stringify(out.envelope, null, 2)); if (!out.envelope.ok) process.exit(1); return; }
    if (!out.envelope.ok) die(`${id}: ${out.envelope.error?.message || "schedule command failed"} (${out.envelope.error?.code || "E_REMOTE"})`);
    console.log(JSON.stringify(out.envelope.result, null, 2));
    return;
  }
  if (cmd === "session") {
    const addr = { instance: flag("instance") === true ? undefined : flag("instance"), home: flag("home") === true ? undefined : flag("home") };
    if (args[1] === "inspect") {
      // Desktop preflight before a remote attach: the execution host's own
      // inspect, relayed as its envelope; a failure is a failure, nonzero.
      let out;
      try { out = inspectRemote(id, addr); } catch (e) { bail(e.code || "E_SSH", e.message); }
      if (out.stderr?.trim()) process.stderr.write(out.stderr.endsWith("\n") ? out.stderr : out.stderr + "\n");
      if (JSON_MODE) { console.log(JSON.stringify(out.envelope, null, 2)); if (!out.envelope.ok) process.exit(1); return; }
      if (!out.envelope.ok) die(`${id}: ${out.envelope.error?.message || "inspect failed"} (${out.envelope.error?.code || "E_REMOTE"})`);
      const r = out.envelope.result;
      console.log(`${r.instance || r.home} on ${id}: ${r.present ? `present, ${r.state || "unknown"}` : "not present"}${r.backend ? ` (${r.backend})` : ""}`);
      return;
    }
    if (args[1] === "start" || args[1] === "restart") {
      const value = (name) => { const v = flag(name); if (v === true) bail("E_BAD_ARGS", `--${name} needs a value`); return v; };
      const choices = { ...addr, model: value("model"), launchConfig: value("launch-config"), runtime: value("runtime"), yolo: yoloFlag() };
      if (flag("stop-grace") !== undefined) bail("E_BAD_ARGS", "--stop-grace is currently supported on the execution host; omit it to use the remote restart's default wait");
      let out;
      try { out = (args[1] === "restart" ? restartRemote : startRemote)(id, choices); } catch (e) { bail(e.code || "E_SSH", e.message); }
      if (out.stderr?.trim()) process.stderr.write(out.stderr.endsWith("\n") ? out.stderr : out.stderr + "\n");
      if (JSON_MODE) { console.log(JSON.stringify(out.envelope, null, 2)); if (!out.envelope.ok) process.exit(1); return; }
      if (!out.envelope.ok) die(`${id}: ${out.envelope.error?.message || "start failed"} (${out.envelope.error?.code || "E_REMOTE"})`);
      const r = out.envelope.result;
      console.log(`Started ${r.instance || r.home} on ${id} (${r.backend}${r.model ? `, model ${r.model}` : ""}, ${r.reused === "pane" ? "in its existing pane" : r.reused === "adopted" ? "adopted the pending session" : "new window"})`);
      return;
    }
    if (args[1] === "upload") {
      // Bytes stream to `session receive` on the execution host over the
      // same route as attach; the answer's checksum is verified here.
      const file = flag("file");
      if (!file || file === true) bail("E_BAD_ARGS", "session upload needs --file <local path>");
      let r;
      try { r = uploadAttachment({ file, server: id, ...addr }); } catch (e) { bail(e.code || "E_UPLOAD_FAILED", e.message); }
      if (r.stderr) process.stderr.write(r.stderr + "\n");
      if (JSON_MODE) { jsonOk(r); return; }
      console.log(`Uploaded ${r.name} (${r.bytes} bytes) to ${r.instance || r.home} on ${id}: ${r.path}`);
      return;
    }
    if (args[1] !== "attach") bail("E_USAGE", "--server routes `session inspect`, `session start`, `session restart`, `session upload` and `session attach`; input runs on the execution host (the wake broker calls it there)");
    let route;
    try { route = attachArgv(id, addr, { skipVersionCheck: args.includes("--print") }); }
    catch (e) { bail(e.code || "E_BAD_ARGS", e.message); }
    if (args.includes("--print")) { console.log(route.argv.map(shellQuote).join(" ")); return; }
    const r = spawnSyncProc(route.argv[0], route.argv.slice(1), { stdio: "inherit" });
    process.exit(r.status ?? 1);
  }
  // Everything after the command word travels, minus the routing flags; a
  // local --task-file is read here and travels as --task text, since the
  // remote cannot read this machine's files.
  const rest = [];
  let routedInput;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--server") { i++; continue; }
    if (a === "--json") continue;
    if (a === "--task-file") {
      const f = args[++i];
      if (!f || f.startsWith("--")) bail("E_BAD_ARGS", "--task-file needs a path");
      if (!existsSync(f)) bail("E_BAD_ARGS", `task file not found: ${f}`);
      rest.push("--task", readFileSync(f, "utf8"));
      continue;
    }
    // A wake spec for a routed spawn travels as validated JSON text; the
    // host saves it in its own scope. Local files never travel as paths.
    if (a === "--wake-file") {
      const f = args[++i];
      if (!f || f.startsWith("--")) bail("E_BAD_ARGS", "--wake-file needs a path");
      if (!existsSync(f)) bail("E_BAD_ARGS", `wake file not found: ${f}`);
      let doc; try { doc = JSON.parse(readFileSync(f, "utf8")); } catch (e) { bail("E_SCHEDULE_INVALID", `--wake-file is not valid JSON: ${e.message}`); }
      if (!doc || typeof doc !== "object" || !["cron", "tz", "message"].every((k) => typeof doc[k] === "string" && doc[k].trim())) bail("E_SCHEDULE_INVALID", "--wake-file must hold {cron, tz, message, enabled}");
      rest.push("--wake-json", JSON.stringify({ cron: doc.cron, tz: doc.tz, message: doc.message, enabled: doc.enabled === undefined ? true : doc.enabled }));
      continue;
    }
    if (a === "--wake-message-file") {
      const f = args[++i];
      if (!f || f.startsWith("--")) bail("E_BAD_ARGS", "--wake-message-file needs a path");
      if (!existsSync(f)) bail("E_BAD_ARGS", `wake message file not found: ${f}`);
      rest.push("--wake-message", readFileSync(f, "utf8"));
      continue;
    }
    // Soul instructions travel as BYTES on the ssh stdin (the same transport
    // as session upload), never as a path the host cannot read nor as a
    // command-line argument.
    if (a === "--instructions-file") {
      const f = args[++i];
      if (!f || f.startsWith("--")) bail("E_BAD_ARGS", "--instructions-file needs a path");
      let bytes; try { bytes = readFileSync(f); } catch (e) { bail("E_BAD_ARGS", `instructions file not readable: ${f}: ${e.message}`); }
      if (bytes.includes(0)) bail("E_BAD_ARGS", "--instructions-file must be text without NUL bytes");
      if (bytes.length > INSPECT_TEXT_CAP) bail("E_BAD_ARGS", `--instructions-file is ${bytes.length} bytes; the bound is ${INSPECT_TEXT_CAP}`);
      routedInput = bytes;
      rest.push("--instructions-stdin");
      continue;
    }
    rest.push(a);
  }
  let routed;
  try { routed = routeCommand(id, cmd, rest, routedInput === undefined ? {} : { input: routedInput }); }
  catch (e) { bail(e.code || "E_SSH", e.message); }
  const { envelope, stderr } = routed;
  if (stderr && stderr.trim()) process.stderr.write(stderr.endsWith("\n") ? stderr : stderr + "\n");
  if (JSON_MODE) { console.log(JSON.stringify(envelope, null, 2)); if (!envelope.ok || envelope.result?.rollbackIncomplete) process.exit(1); return; }
  if (!envelope.ok && !(cmd === "retire" && envelope.result)) die(`${id}: ${envelope.error?.message || "remote command failed"} (${envelope.error?.code || "E_REMOTE"})`);
  const r = envelope.result;
  const target = r.target || {};
  if (cmd === "spawn") {
    console.log(`Spawned ${r.instance} on ${id} (${r.work}${r.branch ? `, branch ${r.branch}` : ""})${r.launched ? ` — tmux window "${r.tmux?.window}" on ${r.target.sshHost}` : " — not launched"}`);
    console.log(`  remote home: ${r.home}`);
    console.log(`  route snapshot: ${r.snapshot ? shortPath(r.snapshot) : "none (see the warning)"}`);
    for (const w of r.warnings || []) console.log(`  WARNING: ${w}`);
    console.log(`  attach: ssh -t ${r.target.sshHost} tmux attach -t ${r.tmux?.session || "oats"}`);
  } else if (cmd === "retire") {
    // Everything the local retireCmd tells the operator, for a remote home
    // they cannot see: forced-incomplete state now theirs to remove by hand
    // there, work preserved there and where, and incomplete cleanup.
    if (r.forcedIncomplete) {
      console.error(`Removed ${r.retired} on ${id} under --force with cleanup INCOMPLETE — this external state was NOT cleaned up and is now yours to remove by hand on ${target.sshHost}:`);
      for (const f of r.forcedIncomplete) console.error(`  ${f}`);
    }
    console.log(`Retired ${r.retired} on ${id}${r.deferred ? " (deferred completion scheduled there)" : ""}${r.rollbackIncomplete ? " — cleanup INCOMPLETE on the server, home retained there" : ""}`);
    for (const recovery of r.workRecoveries || (r.workRecovery ? [r.workRecovery] : [])) {
      console.log(`Work that was not committed has been preserved on ${target.sshHost}: ${(recovery.classes || []).join(", ")}`);
      console.log(`  ${recovery.path}`);
    }
    if (r.rollbackIncomplete) { for (const f of r.rollbackIncomplete) console.error(`  ${f}`); console.error(`Fix the cause there and re-run \`oats retire ${r.retired} --server ${id}\`.`); process.exit(1); }
  } else {
    console.log(`oats status — server ${id} (ssh ${r.target.sshHost}, workspace ${r.target.workspace})\n`);
    for (const a of r.agents || []) {
      console.log(`  ${a.name}  [work: ${a.work || "checkout"}, repo: ${a.repo || "?"}]`);
      for (const i of a.instances || []) console.log(`      • ${i.instance}  ${i.retirePending ? "RETIRING" : i.running ? "RUNNING" : "idle"}`);
    }
    const snaps = r.snapshots || [];
    if (snaps.length) console.log(`\n  spawned from this machine: ${snaps.map((s) => s.instance).join(", ")}`);
  }
}

// ---------- main ----------
// Typed config-shape failures are DEPLOYMENT state the operator can fix, not
// kernel bugs: an unsafe mapping key anywhere in the visible config chain is
// raised by the readers, which every command walks before it can do anything.
// Without this boundary `oats doctor`, `oats use` and every --json mode printed a
// raw Node stack with empty stdout — no code, no envelope, nothing to act on.
// Deliberately narrow: only codes with a defined rendering are caught here;
// anything else still crashes loudly.
//
// The dispatch chain below is deliberately NOT re-indented into this try block:
// keeping it at column 0 makes the whole command table one reviewable diff of
// added lines rather than ~150 lines of pure whitespace churn, and keeps `git
// blame` pointing at the commit that last changed each command.
const TYPED_CLI_FAILURES = new Set(["unsafe-config-key", "unsafe-config-value"]);
/** Removed 0.24 verbs → their v2 replacement (workspace model v2, decision 5). Checked before capability dispatch. */
const REMOVED_VERBS = { install: "oats sync", restore: "oats sync", init: "oats-local.yaml + oats sync", use: "soul.yaml capabilities: { <cap>: { from } } + workspace defaults", trust: "oats sync (approval is asked once per package version)", list: "oats workspace status | oats capabilities", catalog: "oats package add <id> <version> (bare versions resolve through package-catalog.json)", remove: "oats package remove <id>", migrate: "a rebuild (no migration: docs/design/2026-09-23-workspace-module-contracts.md)", config: "oats-local.yaml (host settings) and oats-workspace.yaml (shared)", inject: "injection overrides are not part of the workspace model yet; edit the capability inject in its member repo" };
try {
// Inspect explicit selectors with the existing parser before new-work routing,
// including selectors before the command. Inherited captures are not prepare inputs.
let captured;
try { captured = capturedSelector(args, {}); }
catch (error) {
  if (JSON_MODE) jsonFail(error.code || "E_BAD_ARGS", error.message);
  die(error.message);
}
const sourceInspection = (cmd === "inspect" || captured?.args[0] === "inspect")
  && args.some(arg => arg === "--request" || arg.startsWith("--request="));
if (sourceInspection) {
  if (captured) {
    if (JSON_MODE) jsonFail("E_BAD_ARGS", "source inspection is explicit new work and cannot use captured selectors");
    die("source inspection is explicit new work and cannot use captured selectors");
  }
  if (args.includes("--help") || args.includes("-h")) { if (JSON_MODE) jsonOk({ command: cmd, usage: usageLinesFor(cmd) }); else usageFor(cmd); process.exit(0); }
  inspectOnboardingCmd(); process.exit(0);
}
if (cmd === "prepare" || captured?.args[0] === "prepare") {
  if (captured) {
    if (JSON_MODE) jsonFail("E_BAD_ARGS", "prepare is explicit new work and cannot use captured selectors");
    die("prepare is explicit new work and cannot use captured selectors");
  }
  if (args.includes("--help") || args.includes("-h")) { if (JSON_MODE) jsonOk({ command: cmd, usage: usageLinesFor(cmd) }); else usageFor(cmd); process.exit(0); }
  prepareCmd(); process.exit(0);
}
if (cmd === "onboard" || captured?.args[0] === "onboard") {
  if (captured) {
    if (JSON_MODE) jsonFail("E_BAD_ARGS", "onboard is explicit workspace bootstrap and cannot use captured selectors");
    die("onboard is explicit workspace bootstrap and cannot use captured selectors");
  }
  if (args.includes("--help") || args.includes("-h")) { if (JSON_MODE) jsonOk({ command: cmd, usage: usageLinesFor(cmd) }); else usageFor(cmd); process.exit(0); }
  await onboardCmd();
}
else {
// Other commands retain their existing explicit/inherited selection rules.
try { captured ??= capturedSelector(args); }
catch (error) {
  if (JSON_MODE) jsonFail(error.code || "E_BAD_ARGS", error.message);
  die(error.message);
}
if (captured) {
  args.splice(0, args.length, ...captured.args); cmd = args[0];
  // Host protocol negotiation describes this executable, not a mutable
  // configuration. An inherited capture must not break `oats version` probes.
  if (captured.explicit || cmd !== "version") { capturedCommand(captured); process.exit(0); }
}
// `--help`/`-h` anywhere after a kernel command prints that command's usage
// and exits 0 BEFORE any dispatch: a fresh operator inspects --help before
// using a command, and `install --help` once ran the bare restore while
// `okf harvest --help` spawned a harvester (BeadHub, 2026-09-05).
const wantsHelp = args.slice(1).some((a) => a === "--help" || a === "-h");
if (cmd && KERNEL_COMMANDS.has(cmd) && wantsHelp) { if (JSON_MODE) { jsonOk({ command: cmd, usage: usageLinesFor(cmd) }); process.exit(0); } usageFor(cmd); process.exit(0); }
if (flag("server") !== undefined && ["spawn", "retire", "status", "session", "okf", "schedule", "inspect", "operation", "soul", "launch-config"].includes(cmd)) await serverRouteCmd();
else if (cmd === "server") serverCmd();
else if (cmd === "inspect") inspectCmd();
else if (cmd === "operation") operationCmd();
else if (cmd === "soul") await soulCmd();
else if (cmd === "launch-config") await launchConfigCmd();
else if (cmd === "doctor") {
  const doctorDir = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
  args.includes("--json") ? doctorJson(doctorDir) : doctor(doctorDir);
}
else if (cmd === "update") {
  // `oats update <package>` left with the installed tier (packages are pinned in
  // the workspace file: `oats package add`); only the kernel self-update remains.
  const t = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
  if (t || flag("to") !== undefined) { cmdFail("E_BAD_ARGS", "oats update takes no package: pin package versions in oats-workspace.yaml (`oats package add <id> <version>`), then `oats sync`; bare `oats update [--check] [--yes]` updates the kernel"); process.exit(1); }
  updateCmd();
}
else if (cmd === "type") typeCmd();
else if (cmd === "readiness") readinessCmd();
else if (cmd === "instance") instanceCmd();
else if (cmd === "root") console.log(resolve(new URL("..", import.meta.url).pathname));
else if (cmd === "sync") await syncCmd();
else if (cmd === "package") await packageCmd();
else if (cmd === "workspace") await workspaceCmd();
else if (cmd === "capabilities" || cmd === "souls") await itemsCmd(cmd);
else if (cmd === "status") await status();
else if (cmd === "pane") await paneCmd();
else if (cmd === "version" || cmd === "--version" || cmd === "-v") versionCmd();
// Same rule as the inner catch: a typed CLI failure surfaces with its own code
// through the shared boundary, never re-badged as a spawn-mechanism failure.
else if (cmd === "session") await sessionCmd();
else if (cmd === "schedule") scheduleCmd();
else if (cmd === "spawn") { try { await spawnCmd(); } catch (e) { if (TYPED_CLI_FAILURES.has(e?.code)) throw e; if (JSON_MODE) jsonFail("E_SPAWN_FAILED", e.message || e); throw e; } }
else if (cmd === "retire") retireCmd();
else if (cmd === "create") createCmd();
else if (cmd === "capture" || cmd === "recall" || cmd === "setup") await recordCmd(cmd);
else if (cmd === "experimental") await experimentalCmd();
// `!HELP_WORDS.has(cmd)`: usage NEVER depends on deployment state. `help` is a
// word, so without this it reaches the capability dispatch, which resolves the
// config chain and reads every lock in it — and a scope whose lock the kernel
// refuses could then not print its own usage, which is exactly when you need it.
// A removed 0.24 verb names its v2 replacement in BOTH modes, before any capability namespace could shadow it.
else if (cmd && Object.hasOwn(REMOVED_VERBS, cmd)) {
  const message = `unknown command "${cmd}" — removed by the workspace model v2; use ${REMOVED_VERBS[cmd]}`;
  if (JSON_MODE) jsonFail("E_UNKNOWN_COMMAND", message, { removed: cmd, replacement: REMOVED_VERBS[cmd] });
  console.error(`oats: ${message}\n`);
  console.log(usageText());
  process.exit(1);
}
else if (cmd && !cmd.startsWith("--") && !HELP_WORDS.has(cmd) && capabilityCommand()) { /* dispatched */ }
// No matching kernel command or capability namespace: in --json mode the help
// text must NOT contaminate stdout — still one envelope object, nonzero exit.
else if (cmd && !cmd.startsWith("--") && !HELP_WORDS.has(cmd) && JSON_MODE) jsonFail("E_UNKNOWN_COMMAND", `unknown command "${cmd}" — no kernel subcommand or active capability namespace matches`);
else {
  if (cmd && !HELP_WORDS.has(cmd) && !cmd.startsWith("--")) console.error(`oats: unknown command "${cmd}" — no kernel subcommand or active capability namespace matches\n`);
  console.log(usageText());
  process.exit(cmd && !HELP_WORDS.has(cmd) ? 1 : 0);
}
} // end: every command but onboard

/** The usage lines for one kernel command (its `oats <cmd> ...` lines and
 *  their indented continuations), or the whole usage when none match. */
function usageLinesFor(name) {
  const out = [];
  let inside = false;
  for (const line of usageText().split("\n")) {
    if (new RegExp(`^  oats ${name}(\\s|$)`).test(line)) { out.push(line); inside = true; continue; }
    if (inside && /^ {6}/.test(line) && !/^  oats /.test(line)) { out.push(line); continue; }
    inside = false;
  }
  return out;
}
function usageFor(name) {
  const out = usageLinesFor(name);
  console.log(out.length ? `Usage:\n${out.join("\n")}` : usageText());
}

function usageText() {
  return `oats — Open Agent Team Specification

Usage:
  oats version [--json]                      kernel version; --json emits the
                                            Desktop CLI API v1 probe payload
  oats status [--json]                       agents, souls, running instances
  oats status --team [--json]                whole-team roster across the team scope's repos
  oats server add <id> --ssh <alias>         register another machine's OATS (OpenSSH alias,
      --workspace </abs/path> [--oats <p>]   remote workspace, remote oats path; no keys stored;
      [--path <dir:dir>]                    --path = dirs prepended to the remote PATH, e.g. ~/.local/bin)
  oats server list|remove <id>|check <id>    registry; check = reachability + version, no mutation
  oats spawn|retire|status ... --server <id> run that command on the server's installed oats
                                            (same flags, same envelope; the saved route per
                                            remote instance lives under ~/.oats/remote/)
  oats server roster [--server <id>]         remote roster grouped by server and saved route
      [--budget <ms>] [--per-target <ms>]   target: one status pull per group within a total
      [--json]                              budget (45 s, 20 s per target); saved routes are
                                            the authority for actions
  oats server forget <id> --instance <name>  drop a saved route whose remote instance is gone
                                            (the roster shows it as missingRemotely)
  oats retire <instance> --home <path>       retire exactly that home when two agents own an
                                            instance of the same name (else refused)
  oats okf harvest --server <id>             run the knowledge harvest in a remote instance's
      --instance <name> [--json]            saved home on its host
  oats session inspect|attach --server <id>  inspect (envelope) or attach a viewer (ssh PTY) for a
      --instance <name> | --home <abs>       remote instance over its saved route (--print shows
                                            attach); the server needs oats 0.22.2 or later
  oats session start --server <id>           start a stopped remote instance in its existing home
      --instance <name> | --home <abs>       over its saved route; the server must advertise
      [--model <m>] [--json]                 session-start (oats 0.22.9 or later)
  oats inspect|operation|soul --server <id>   the same commands on a registered server over its
      ... [--dir <remote member>] [--home <abs>]  saved route (an explicit --dir travels as is; a --home
                                            is its own context; else the registered workspace);
                                            soul set --instructions-file streams the bytes; the
                                            server must advertise operations (oats 0.22.16 or later)
  oats session upload --server <id>          copy a local file into a remote instance's private
      --instance <name> | --home <abs>       attachments over its saved route (bytes stream on
      --file <path> [--json]                 ssh stdin; sha256 verified); the server must
                                            advertise session-upload (oats 0.22.13 or later)
  oats onboard [<dir>] --workspace <repo ref> realize a workspace here: writes <dir>/oats-local.yaml
      [--json]                               and agents/, then runs the oats sync path (lock v3;
                                            exit 2 while approvals are pending) and prints the
                                            next steps (clone members you work IN, spawn
                                            oats-setup-expert); creates no soul, spawns nothing
  oats create <name> [--local] [--no-oats-core] create an agent soul; --local = full
      [--description <d>] [--repo <r>]      soul under local-agents/ (uncommitted,
      [--work <mode>] [--runtime pi|claude|codex] gitignored; same memory + lifecycle)
      [--model <m>] [--yolo|--no-yolo] [--instructions-file <f>]
  oats session inspect|input|attach --home <absolute-home> [--text-file <path>] [--json]
  oats schedule list|show <id>|add <id> --file <spec.json>|update <id> --file <spec.json>
      enable|disable|run|remove|reconcile <id>   workspace-scoped, host-owned schedules (spawn,
      tick [--dry-run] [--host]                  command or wake jobs on a five-field cron with an
      host install|uninstall|status              explicit IANA tz; see docs/schedules.md); --server
                                                routes to that host's workspace
  oats spawn ... --wake-file <json> | --wake-every <N> --wake-message <text>  save a wake schedule
                                                bound to the new instance's home (docs/schedules.md)
  oats session upload --file <path>          store a copy of a local file as a private attachment
      --home <absolute-home> [--json]         in the instance home (.oats-attachments/); answers
                                            {path, bytes, sha256}; never types into the session
  oats session receive --home <abs> --name   store attachment bytes read from stdin (the routed
      <file> [--json]                       upload's remote half)
  oats session start --home <absolute-home>  start a STOPPED instance again in its existing home
      [--model m] [--launch-config n|none]  (recorded recipe as is; a selection re-resolves it
      [--runtime r] [--yolo|--no-yolo]      against the scope; a named configuration is a unit)
  oats session restart --home <abs-home>     stop the running harness (SIGTERM, bounded wait,
      [same flags] [--stop-grace <s>]        never escalated) and start it again in place under
                                            the same lock; a stop that is not observed is
                                            reported and nothing is launched
      [--model <m>] [--json]                 (same identity, worktree, notes and launch env; no
                                            spawn hooks); --model replaces the recorded model
                                            for this and later starts; a live harness is refused
  oats spawn <agent> [--task <text>]         spawn an instance (tmux/Herdr; --no-launch
      [--purpose <slug>] [--repo <r>]       = scaffold only); --instructions-file/
      [--parent <instance>]                 --def-file creates a local agent;
      [--no-oats-core]                      omit the default only on NEW local souls;
      [--relation child|sibling|parent|unrelated]    --relation + --relative-to anchor the
      [--relative-to <instance>]            new instance to an existing one; --parent X
      [--relative-root <agents-root>]       disambiguates same-named team anchors
      [--work worktree|checkout|attached|workspace|directory]  = sugar for --relative-to X --relation
      [--work-dir <owner-work>] [--runtime pi|claude|codex] [--backend tmux|herdr] [--herdr-socket <path>] [--yolo|--no-yolo] [--model <m>] [--branch <b>]  child (default: unrelated, top-level)
      [--instructions-file <f>|--def-file <f>] [--no-launch] [--json]
                                            with team: declared, unknown local souls
                                            resolve across the team scope's repos
                                            directory: owned home/work, config context may
                                            be non-Git; rejects --work-dir and --branch
  oats retire <instance> [--force]           retire an instance (window, hooks,
      [--self] [--delete-branch]            worktree, home); --self = retire the
      [--keep-dir] [--json]                 CALLING instance: the window dies, then
                                            a detached external retirement runs
  oats inspect [--dir <scope>] [--soul <name>   one authoritative JSON answer for a GUI: souls
      [--agents-root <abs>]] [--home <abs>]   (runtime defaults, editability, instructions),
      [--json]                              installed capabilities with health, effective
                                            layer bindings and activation, declared
                                            operations with availability; --home answers the
                                            running home's captured bindings and their drift
                                            from the current config
  oats operation run <layer>:<name>          run an operation the effective provider of that
      (--home <abs> | --soul <name> [--dir <d>])  layer declares (knowledge:harvest, knowledge:
      [--arg k=v ...] [--json]              inspect ...): resolved from the home's captured
                                            bindings or the scope's config, trust checked, the provider's
                                            own command run in the home or scope, envelope
                                            relayed; a view answers {documents: [...]}
  oats soul set <name> [--dir <scope>]       change an editable soul's launch defaults and/or
      [--agents-root <abs>] [--runtime r]    instructions in place (soul.yaml lines replaced,
      [--model m | --no-model]              everything else kept; AGENTS.md replaced from
      [--yolo | --no-yolo] [--backend b]     --instructions-file); packaged souls are refused;
      [--description d | --no-description]  the receipt carries before/after and sha256s
      [--instructions-file <path>] [--json]
  oats launch-config list [--dir <scope>     named launch configurations effective at a scope,
      | --home <abs> | --soul <name>]       a home's recorded context or a soul's own scope:
      [--agents-root <abs>] [--json]        runtime, executable, args, env (values redacted,
                                            references shown), model, yolo; the closest
                                            declaring scope provides the whole entry
  oats launch-config set <name> --file <j>   declare or replace one at this scope from a JSON
      [--keep-env] [--dir <scope>] [--json] file (only the launch-configs block is rewritten;
                                            --keep-env copies the effective definition's env)
  oats launch-config remove <name>           remove this scope's declaration; an ancestor's,
      [--dir <scope>] [--json]              if any, becomes effective again
  oats launch-config preview                 what a start would run: resolved runtime, model,
      (--home <abs> | --soul <name>)        yolo, executable, argv, environment (redacted),
      [--launch-config <name>|none]         command and preflight; read-only, nothing
      [--runtime r] [--model m]             started; a named configuration is a unit, so
      [--yolo | --no-yolo] --json           a disagreeing --runtime is refused
  oats doctor [dir] [--soul <name>] [--json] resolved targets, trust, requirements;
                                            --soul shows final composed AGENTS.md
  oats update [--check] [--yes]              check npm for a newer kernel+pi bridge and
                                            optionally run the update; then run oats doctor
  oats sync [--dir <d>] [--json]             workspace model v2: observe the workspace named by
                                            oats-local.yaml over its Git remote, confirm every
                                            member (reciprocal oats-membership.yaml), resolve
                                            packages: to exact commits, ask executable approval
                                            once per package version (TTY; otherwise list what
                                            needs it and exit 2), write oats-lock.json (v3) and
                                            report the diff
  oats package add <id> <version|git:<repo>@<ref>>  edit packages: in oats-workspace.yaml when the
      | remove <id>  [--dir <d>]            workspace repo is the current checkout; otherwise
                                            print the line to add (the file travels through Git)
  oats workspace status [--dir <d>] [--json] membership table (confirmed / no-backlink /
                                            cannot-read / backlink-elsewhere), packages, approval
  oats capabilities [--dir <d>] [--json]     every non-private capability of every confirmed
  oats souls [--dir <d>] [--json]            member + the locked packages, with origin
                                            (member <key> @ <commit> | package <id> v<ver>) and team
  oats instance git <instance> [--home <abs>] [--dir <d>] [--json]
                                             read-only Git observation of the instance's work
                                             tree: branch, status (renames kept), ahead/behind
                                             vs upstream AND vs default-branch merge-base
  oats instance diff <instance> --file <id> --revision <rev> [--index-revision <rev>] [--home <abs>] [--dir <d>] [--json]
                                             bounded diff of one observed file; refuses when
                                             the tree moved since the observation
  oats session recompose --home <abs> [--dry-run] [--json]
                                             refresh a LIVE home's AGENTS.md from its current
                                             canonical soul + context (same composer as spawn);
                                             previous text retained; nothing restarted
  oats instance events <instance> [--limit <n>] [--since <iso>] [--json]
                                             typed lifecycle events (spawned, launched, stopped,
                                             restarted, retired, worktree-retained…) written by
                                             the action that made them true; nothing inferred
  oats instance stop <instance> --plan [--no-recursive] [--json]
                                             what Stop would touch: session state, recorded
                                             children, dirty work; a planRevision to apply
  oats instance stop <instance> --apply --plan-revision <rev> --idempotency-key <key>
                                             quiesce (SIGTERM, bounded, never escalated),
                                             children first; home/work/launch retained
  oats readiness [--soul <n> [--agents-root <abs>]] [--home <abs>] [--verify-signatures] [--policy] [--json]
                                             quartet installed|trusted|configured|enrolled for a scope,
                                             a soul, or an instance home (captured homes refuse:
                                             their readiness is the retained resolution's)
                                             installed | trusted | configured | enrolled, each
                                             pass|fail|unknown|not-applicable with items and
                                             remedies; signature status per artifact; enforced
                                             child-spawn / worktree policy with origins
  oats retire <instance> --plan [--json]     what Remove would touch, with retention defaults
  oats retire <instance> [--plan-revision <rev> --idempotency-key <key>] [--discard-worktree] [--delete-branch]
                                             with a plan revision: refuses E_PLAN_STALE (fresh plan
                                             attached) if facts moved; a repeated key replays
                                             retire; a worktree is RETAINED (re-homed under
                                             <workspace>/.agents/worktrees/<repo>/<branch>)
                                             unless discarded; --delete-branch deletes the
                                             worktree's verified branch and implies discard
  oats type add <name> [--description <d>]   declare an agent type (family) in config;
  oats type list                             souls join via create --type / soul.yaml
  oats root                                  print this package's install root
                                            (adapters resolve the kernel from it)

The turn record (core — every conversation captured, searchable, replicated):
  oats capture [--watch|--status]            land Claude Code/pi/codex sessions and aw
      [--owner <name>] [--root <dir>]       client logs in the record; reconciliation
                                            is the capture
  oats recall [--kind k] [--thread t]        search the whole record — mail, chat,
      [--from f] [--show id] <query>        sessions — with exact turn provenance
  oats setup [--owner <name>] [--dry-run]    install capture hooks + background watcher
      [--no-service] [--no-hooks]           (launchd/systemd), then run the first pass

  oats experimental <dress|spawn|segments|mind>   EXPERIMENTAL tools over the record —
                                            selection and agent synthesis; unproven by
                                            design, repo checkout only; see
                                            packages/experimental/README.md

  oats inspect --request <absolute-json-file> [--json]
      [--emit-prepare-request <new-absolute-json-file>]
                                            fresh source/workspace/member metadata; optional private
                                            request export uses the existing fresh-request builder;
                                            no provider execution or preparation authority
  oats prepare --request <absolute-json-file> [--json]
                                            complete public preparation input; no mixed flags,
                                            inherited binding, implicit setup or launch authority
  oats prepare --dir <abs> --source <git repo> --revision <ref> --export <path>
      --alias <name> [--work <mode>] [--json]  prepare retained commands and curriculum,
                                            no launch; provider gaps report incomplete
  oats prepare --dir <abs> --workspace <git repo> --alias <advertised alias>
      [--workspace-revision <ref>] [--work <mode>] [--json]
                                            same preparation through workspace imports
  oats inspect --deployment <abs> --resolution <id> [--composition] [--json]
      [--helper <exact-map-key>]             inspect retained source/helper inputs, not today's configuration
  oats trust <capability> --deployment <abs> --artifact-set <sha256-…> [--json]
                                            approve one exact prepared artifact; use each
                                            selections[].artifactSet for capability ids
                                            in prepare's approvalRequired[] at that selection
  oats trust <capability> --deployment <abs> --resolution <id> [--json]
                                            explicitly approve that exact captured artifact
  oats <namespace> <command> --deployment <abs> --resolution <id> -- [args…]
                                            run the approved retained command; no ambient fallback
  oats operation run <layer>:<name> --deployment <abs> --resolution <id>
      [--home <abs>] [--arg k=v ...] [--retry-intent <saved-id>] [--json]
                                            home actions admit distinct requests; explicit retry reuses intent
                                            scope views stay read-only; scope mutation is not yet qualified
  oats spawn <captured subject> --deployment <abs> --resolution <id>
      --home <abs> --no-launch [--json]      create a fresh directory scaffold and run captured hooks
  oats session inspect --deployment <abs> --resolution <id> --home <abs> --native-record <UUID> [--helper <exact-key>] --json
                                           read-only Pi completion observation; not admission or readiness
  oats session start|restart --deployment <abs> --resolution <id> --home <abs>
      [--helper <exact-source-map-key>] [--request <abs-json>] [--retry-intent <saved-id>] [--json]
                                            dispatch the owned captured home via existing native custody;
                                            version1 request: backend/task/stopGraceMs, no model override

  oats <namespace> <command> [args…]         run an operational command only when its
                                            capability is active (e.g. oats okf harvest)

Layers: ${LAYERS.join(", ")}. Workspace model v2: docs/design/2026-09-23-workspace-module-contracts.md.`;
}
} catch (e) {
  if (!TYPED_CLI_FAILURES.has(e?.code)) throw e;
  // Same two renderings as every other typed failure: one envelope on stdout in
  // --json mode, one `oats: <message>` line on stderr otherwise. The message
  // already names the offending file — the readers re-raise it with one.
  if (JSON_MODE) jsonFail(e.code, e.message);
  die(e.message);
}
