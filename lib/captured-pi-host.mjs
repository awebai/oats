/** Execution-side authority for the explicitly selected native SDK host.
 * Reuses the kernel's actual retained loader and original indexed admission;
 * it never selects a current config, creates an incarnation or admits an action. */
import { createHash } from "node:crypto";
import { lstatSync, readlinkSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { nativeHistoryPath } from "../packages/record/lib/native-history.mjs";
import { validateCapturedSessionTarget } from "./captured-session-backend.mjs";
import { loadCapturedDispatch, applicableRequirements } from "./core.mjs";
import { readCapturedInstanceAuthority, assertCapturedInstanceCustody, capturedDirectoryIdentity } from "./captured-instance-index.mjs";
import { validateIntentRef } from "./captured-admission-shape.mjs";
import { canonicalJson, parseStrictJson } from "./portable-values.mjs";
import { readPortableBytes } from "./portable-files.mjs";
import { jsonIntegrity, treeIntegrity } from "./portable-digest.mjs";
import { assertCapturedPiStart, capturedPiSessionDirectory } from "./captured-pi-custody.mjs";
import { PI_SDK_HOST, parsePiHostRecipeArgs, parsePiHostArgv, piHostArgv, readPiHostTask, runPiSdkHost, validatePiHostRecipe } from "./pi-sdk-host.mjs";
import { readPiOutcome, summarizePiOutcome, writePiExitMarker, writePiOutcome } from "./captured-pi-outcome.mjs";
import { oatsError } from "./errors.mjs";

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const refuse = message => { throw oatsError("E_PI_HOST_CUSTODY", message); };

/** Relate the ORIGINAL process ref to the same logical admission. A retry may
 * advance the index counter without redispatching that process. The exact
 * pending ref remains the anchor; the caller MUST also validate its started-v2
 * record/root, input, target, launch and curriculum before any SDK effect. */
export function verifyPiDispatchRef(row, intent, pending, model) {
  validateIntentRef(intent);
  const admitted = row.intents.find(value => value.executionId === intent.executionId);
  const priorLiveAttempt = admitted && admitted.attempt > intent.attempt;
  if (row.incarnationId !== intent.incarnationId || !admitted || !Number.isSafeInteger(admitted.attempt)
    || admitted.attempt < intent.attempt || admitted.capability !== null || admitted.action.kind !== "session"
    || !["start", "restart"].includes(admitted.action.name)
    || !(["running", "completed", "unconfirmed"].includes(admitted.state) || (priorLiveAttempt && admitted.state === "admitted"))) {
    refuse("Pi host execution is not an admitted native action");
  }
  if (!pending || pending.id !== intent.executionId || !pending.capturedIntent || !same(pending.capturedIntent, intent)
    || typeof pending.nativeRecordId !== "string" || !/^[a-f0-9-]{36}$/.test(pending.nativeRecordId)
    || pending.runtime !== "pi" || pending.model !== model) refuse("Pi host lacks the original native dispatch receipt");
  // Reconciliation may retain a partial observation or the completed adoption
  // result. Neither may contradict the original pending dispatch. Absence is
  // not root authority: the mandatory started-v2 check still supplies that.
  if (priorLiveAttempt) {
    const observed = admitted.receipt;
    if ((observed?.id !== undefined && observed.id !== pending.id)
      || (observed?.nativeRecordId !== undefined && observed.nativeRecordId !== pending.nativeRecordId)
      || (observed?.target !== undefined && !same(observed.target, pending.target))) {
      refuse("Pi reconciliation observation differs from the original dispatch");
    }
  }
  return admitted;
}

export function verifyCapturedPiHost(options, env = process.env) {
  if (!env.OATS_DEPLOYMENT || !env.OATS_INCARNATION_ID || !env.OATS_EXECUTION_ID || !/^[1-9][0-9]*$/.test(env.OATS_EXECUTION_ATTEMPT ?? "")
    || env.OATS_INSTANCE_HOME !== options.home) refuse("Pi host has no original admitted execution context");
  const intent = { schemaVersion: 1, incarnationId: env.OATS_INCARNATION_ID, executionId: env.OATS_EXECUTION_ID, attempt: Number(env.OATS_EXECUTION_ATTEMPT) };
  return verifyCapturedPiContext(options, intent, { deployment: env.OATS_DEPLOYMENT, resolutionId: env.OATS_RESOLUTION, instance: env.OATS_INSTANCE });
}

// Shared read-only verification, NOT an invocation/env constructor. Inspecting
// observed facts does not impersonate a process or admit another action.
function verifyCapturedPiContext(options, intent, selector) {
  const { home, sessionDir } = options;
  validateIntentRef(intent);
  const { row, metadata } = readCapturedInstanceAuthority(selector.deployment, home);
  if (row.incarnationId !== intent.incarnationId || row.executionBinding.resolution.id !== selector.resolutionId
    || selector.instance !== row.instance) refuse("Pi host invocation differs from original captured custody");
  const pending = parseStrictJson(readPortableBytes(join(home, ".oats-start-pending.json")));
  const admitted = verifyPiDispatchRef(row, intent, pending, options.model);
  validateCapturedSessionTarget(pending.target, metadata.captured.nativeBackend, row.instance);
  if (pending.target.backend === "herdr" && !same(admitted.receipt?.target, pending.target)) refuse("Pi Herdr target lacks indexed observation");
  if (!row.nativeScaffold || !same(row.nativeScaffold, metadata.captured.nativeScaffold)) refuse("Pi native scaffold authority changed");
  const history = nativeHistoryPath(home);
  for (const [key, path] of Object.entries({ historyRoot: dirname(history), history })) {
    if (!same(capturedDirectoryIdentity(path), row.nativeScaffold.directories[key])) refuse("Pi native record custody directory changed");
  }
  if (sessionDir !== capturedPiSessionDirectory(home)) refuse("Pi session directory differs from the kernel-selected root");
  assertCapturedPiStart(home, pending.nativeRecordId, { incarnationId: row.incarnationId, intent, sessionDir });
  const loaded = loadCapturedDispatch({ deployment: row.executionBinding.deployment, resolution: row.executionBinding.resolution, action: { kind: "compose" } });
  const launch = loaded.record.dispatch.launch;
  const profile = validatePiHostRecipe(launch);
  if (launch.executable !== PI_SDK_HOST || !same({ ...launch, hooks: { launch: {}, env: {}, contributions: [] } }, pending.launch) || launch.model !== options.model
    || !same(profile, parsePiHostRecipeArgs(["--oats-pi-host", options.hostVersion, "--mode", options.mode, "--thinking", options.thinkingLevel, "--sdk-root", options.sdkRoot, "--sdk-version", options.sdkVersion]))) refuse("Pi host differs from the exact retained launch selection");
  if (loaded.record.dispatch.composition?.mode !== "directory" || loaded.record.dispatch.runtimePackages.length
    || applicableRequirements("pi", [...loaded.capabilities.values()]).length
    || [...loaded.capabilities.values()].some(cap => cap.manifest.hooks?.launch)
    || row.intents.some(value => value.action.kind === "hook" && value.action.name === "spawn" && !value.replayable)
    || loaded.approvals.some(value => !["approved", "not-required"].includes(value.status))) refuse("retained source is not eligible for the zero-plugin host");
  const { bytes } = readPiHostTask(options.taskFile);
  const input = { backend: metadata.captured.nativeBackend, taskIntegrity: { format: "oats.bytes.v1", value: `sha256-${createHash("sha256").update(bytes).digest("hex")}` } };
  if (!same(jsonIntegrity(input), admitted.inputIntegrity)) refuse("Pi task/backend differs from the admitted input");
  const agentsPath = join(home, "AGENTS.md");
  if (readPortableBytes(agentsPath).toString("utf8") !== loaded.composition.text
    || !lstatSync(join(home, "CLAUDE.md")).isSymbolicLink() || readlinkSync(join(home, "CLAUDE.md")) !== "AGENTS.md") refuse("Pi home curriculum differs from retained composition");
  if (!same(readdirSync(join(home, ".agents/skills")).sort(), loaded.composition.skills.map(skill => skill.name).sort())) refuse("Pi projected skill inventory changed");
  for (const skill of loaded.composition.skills) {
    if (!same(treeIntegrity(join(home, ".agents/skills", skill.name)), treeIntegrity(skill.path))) refuse("Pi projected skill bytes changed");
  }
  const current = assertCapturedInstanceCustody(row);
  const currentPending = parseStrictJson(readPortableBytes(join(home, ".oats-start-pending.json")));
  const currentIntent = verifyPiDispatchRef(current, intent, currentPending, options.model);
  if (!same(currentPending, pending) || !same(currentIntent.inputIntegrity, admitted.inputIntegrity)) refuse("Pi dispatch evidence changed during verification");
  // Keep the process's ORIGINAL ref, never the advanced reconciliation counter.
  assertCapturedPiStart(home, pending.nativeRecordId, { incarnationId: row.incarnationId, intent, sessionDir });
  return { cwd: home, agentsPath, text: loaded.composition.text,
    skills: loaded.composition.skills.map(skill => ({ name: skill.name, path: join(skill.path, "SKILL.md") })),
    outcomeAuthority: { home, sessionDir, incarnationId: row.incarnationId, intent,
      nativeRecordId: pending.nativeRecordId, executionBinding: row.executionBinding,
      target: pending.target, inputIntegrity: admitted.inputIntegrity,
      selected: { runtime: "pi", ...options.modelSelection, sdkVersion: options.sdkVersion } } };
}

export function runCapturedPiSdkHost(argv) {
  return runPiSdkHost(argv, { verifyContext: options => verifyCapturedPiHost(options),
    onOutcome: (options, observed, verified) => writePiOutcome("sdk", verified.outcomeAuthority, observed,
      () => { if (!same(verifyCapturedPiHost(options).outcomeAuthority, verified.outcomeAuthority)) refuse("Pi outcome custody changed"); }) });
}

function outcomeOptions(home, nativeRecordId) {
  const pending = parseStrictJson(readPortableBytes(join(home, ".oats-start-pending.json")));
  if (pending.nativeRecordId !== nativeRecordId) refuse("Pi outcome is not the original current dispatch; historical re-selection is unsupported");
  return { pending, options: parsePiHostArgv(piHostArgv(pending.launch, { home, sessionDir: capturedPiSessionDirectory(home) })) };
}

/** PRIVATE launcher entry, not part of the accepted launch recipe grammar.
 * exitCode is the enclosing launcher's saved `$?`, not runPrintMode's return. */
export function parsePiExitArgv(argv) {
  const keys = ["--oats-pi-record-exit", "--home", "--native-record", "--exit-status"];
  if (!Array.isArray(argv) || argv.length !== 8 || keys.some((key, i) => argv[i * 2] !== key)
    || argv[1] !== "1" || typeof argv[3] !== "string" || !isAbsolute(argv[3]) || resolve(argv[3]) !== argv[3] || argv[3].includes("\0")
    || typeof argv[5] !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(argv[5])
    || typeof argv[7] !== "string" || !/^(0|[1-9][0-9]{0,2})$/.test(argv[7]) || Number(argv[7]) > 255) {
    throw oatsError("E_PI_HOST_ARGS", "invalid private Pi process observation arguments");
  }
  return { home: argv[3], nativeRecordId: argv[5], exitCode: Number(argv[7]) };
}

export function recordCapturedPiExit(argv, env = process.env) {
  const { home, nativeRecordId, exitCode } = parsePiExitArgv(argv);
  if (env.OATS_INSTANCE_HOME !== home || !env.OATS_DEPLOYMENT) refuse("Pi exit observer has no original home context");
  readCapturedInstanceAuthority(env.OATS_DEPLOYMENT, home); // before reading pending paths
  const { options } = outcomeOptions(home, nativeRecordId);
  const authority = verifyCapturedPiHost(options, env).outcomeAuthority;
  const check = () => { if (!same(verifyCapturedPiHost(options, env).outcomeAuthority, authority)) refuse("Pi process observation custody changed"); };
  writePiOutcome("process", authority, { exitCode, source: "launcher-wait-status" }, check);
  writePiExitMarker(authority, check);
  return 0; // observer status ONLY; enclosing shell retains the native status
}

/** Explicit public read-only query for the current ORIGINAL pending dispatch.
 * No backend/model call, process-env impersonation, admission or provisioning. */
export function inspectCapturedPiOutcome(home, { deployment, resolution, nativeRecordId }) {
  const { row } = readCapturedInstanceAuthority(deployment, home);
  if (!same(row.executionBinding.resolution, resolution)) refuse("Pi outcome selector differs from original captured home");
  const { options, pending } = outcomeOptions(home, nativeRecordId);
  const selector = { deployment, resolutionId: resolution.id, instance: row.instance };
  // Strict JSON decoding uses null-prototype maps. Reify the SAME validated wire
  // ref as ordinary data for the record API; never advance its attempt or mint it.
  validateIntentRef(pending.capturedIntent);
  const intent = { ...pending.capturedIntent };
  const authority = verifyCapturedPiContext(options, intent, selector).outcomeAuthority;
  const check = () => { if (!same(verifyCapturedPiContext(options, intent, selector).outcomeAuthority, authority)) refuse("Pi outcome inspection custody changed"); };
  const sdk = readPiOutcome("sdk", authority, check), process = readPiOutcome("process", authority, check);
  return summarizePiOutcome(authority, sdk, process, check);
}
