/** Immutable software authority for one admitted scheduled execution.
 *
 * A capsule is data only. It does not prepare, approve, launch, or infer a
 * resolution from cwd/current configuration. The scheduler validates it again
 * at every admission boundary and the selected public CLI validates the same
 * explicit selector again at dispatch. */
import { isAbsolute, resolve } from "node:path";
import { capturedSelector } from "./captured-selector.mjs";
import { jsonIntegrity } from "./portable-digest.mjs";
import { canonicalJson } from "./portable-values.mjs";
import { validateResolutionRef } from "./resolution-shape.mjs";
import { oatsError } from "./errors.mjs";

export const EXECUTION_CAPSULE_VERSION = 1;
export const SCHEDULE_ATTEMPT_VERSION = 1;
export const SCHEDULE_DEFINITION_VERSION = 2;
export const RECURRENCE_POLICIES = Object.freeze(["capture", "prepare-on-tick"]);
const CAPSULE_FIELDS = Object.freeze(["schemaVersion", "executionId", "resolution", "deployment", "action", "target", "inputRefs", "responsibleHuman"]);
const TARGET_FIELDS = Object.freeze(["cwd", "argv"]);
const ACTION_FIELDS = Object.freeze(["kind", "name"]);

function exactObject(value, fields, where) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw oatsError("invalid-declaration", `${where} must be an object`);
  const keys = Object.keys(value).sort(), expected = [...fields].sort();
  if (keys.length !== expected.length || keys.some((key, i) => key !== expected[i])) {
    throw oatsError("invalid-declaration", `${where} has unexpected or missing fields`);
  }
  return value;
}
function same(a, b) { return canonicalJson(a) === canonicalJson(b); }
function copied(value) { return JSON.parse(canonicalJson(value)); }

/** Parse only the already-public captured capability-command form. Selectors
 * after `--` are child data and cannot become scheduler authority. */
export function capturedCommandTarget(target) {
  canonicalJson(target, { maxBytes: 1024 * 1024, maxDepth: 32, maxEntries: 20_000 });
  exactObject(target, TARGET_FIELDS, "execution target");
  if (typeof target.cwd !== "string" || !isAbsolute(target.cwd)) throw oatsError("invalid-declaration", "execution target cwd must be absolute");
  if (!Array.isArray(target.argv) || target.argv.length < 3 || target.argv[0] !== "oats"
      || target.argv.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw oatsError("invalid-declaration", "execution target argv must be an oats command without NUL values");
  }
  if (!target.argv.includes("--json")) {
    throw oatsError("invalid-declaration", "captured schedule argv must save --json explicitly; admission cannot mutate the capsule target");
  }
  const selector = capturedSelector(target.argv.slice(1), {});
  if (!selector?.explicit || selector.artifactSet !== undefined) {
    throw oatsError("invalid-declaration", "captured schedule command needs explicit --deployment and --resolution selectors in saved argv");
  }
  if (resolve(selector.deployment) !== selector.deployment) throw oatsError("invalid-declaration", "captured schedule deployment selector must be a normalized absolute path");
  const end = selector.args.indexOf("--"), head = end < 0 ? selector.args : selector.args.slice(0, end);
  const [namespace, command] = head;
  if (typeof namespace !== "string" || !namespace || namespace.startsWith("-")
      || typeof command !== "string" || !command || command.startsWith("-")) {
    throw oatsError("invalid-declaration", "captured schedule command needs a capability namespace and command");
  }
  return {
    deployment: resolve(selector.deployment),
    resolution: copied(selector.resolution),
    action: { kind: "command", name: `${namespace}:${command}` },
    dispatchAction: { kind: "command", namespace, name: command },
  };
}

function capsulePayload(capsule) {
  return {
    schemaVersion: capsule.schemaVersion,
    resolution: capsule.resolution,
    deployment: capsule.deployment,
    action: capsule.action,
    target: capsule.target,
    inputRefs: capsule.inputRefs,
    responsibleHuman: capsule.responsibleHuman,
  };
}
function executionId(payload) { return jsonIntegrity(payload).value; }

export function buildCommandExecutionCapsule({ cwd, argv, inputRefs = {}, responsibleHuman = null }) {
  canonicalJson({ cwd, argv }, { maxBytes: 1024 * 1024, maxDepth: 32, maxEntries: 20_000 });
  if (typeof cwd !== "string" || !isAbsolute(cwd) || !Array.isArray(argv)) throw oatsError("invalid-declaration", "captured command needs an absolute cwd and argv array");
  const target = copied({ cwd: resolve(cwd), argv });
  const parsed = capturedCommandTarget(target);
  if (!inputRefs || typeof inputRefs !== "object" || Array.isArray(inputRefs)) throw oatsError("invalid-declaration", "execution inputRefs must be an object");
  if (responsibleHuman !== null && (!responsibleHuman || typeof responsibleHuman !== "object" || Array.isArray(responsibleHuman))) {
    throw oatsError("invalid-declaration", "execution responsibleHuman must be an object or null");
  }
  const payload = copied({
    schemaVersion: EXECUTION_CAPSULE_VERSION,
    resolution: parsed.resolution,
    deployment: parsed.deployment,
    action: parsed.action,
    target,
    inputRefs,
    responsibleHuman,
  });
  return { ...payload, executionId: executionId(payload) };
}

export function validateExecutionCapsule(value) {
  canonicalJson(value, { maxBytes: 1024 * 1024, maxDepth: 64, maxEntries: 20_000 });
  exactObject(value, CAPSULE_FIELDS, "execution capsule");
  if (value.schemaVersion !== EXECUTION_CAPSULE_VERSION) throw oatsError("unsupported-wire-version", "unsupported execution capsule version");
  if (typeof value.executionId !== "string" || !/^sha256-[a-f0-9]{64}$/.test(value.executionId)) throw oatsError("invalid-declaration", "execution capsule ID must be a full SHA-256 value");
  validateResolutionRef(value.resolution);
  if (typeof value.deployment !== "string" || !isAbsolute(value.deployment) || resolve(value.deployment) !== value.deployment) throw oatsError("invalid-declaration", "execution deployment must be a normalized absolute path");
  exactObject(value.action, ACTION_FIELDS, "execution action");
  if (value.action.kind !== "command" || typeof value.action.name !== "string" || !/^[^:\s]+:[^:\s]+$/.test(value.action.name)) {
    throw oatsError("invalid-declaration", "this scheduler supports captured command capsules only");
  }
  if (!value.inputRefs || typeof value.inputRefs !== "object" || Array.isArray(value.inputRefs)) throw oatsError("invalid-declaration", "execution inputRefs must be an object");
  if (value.responsibleHuman !== null && (!value.responsibleHuman || typeof value.responsibleHuman !== "object" || Array.isArray(value.responsibleHuman))) {
    throw oatsError("invalid-declaration", "execution responsibleHuman must be an object or null");
  }
  const parsed = capturedCommandTarget(value.target);
  if (parsed.deployment !== value.deployment || !same(parsed.resolution, value.resolution)
      || !same(parsed.action, value.action)) throw oatsError("invalid-declaration", "execution capsule disagrees with its saved command selectors");
  if (executionId(capsulePayload(value)) !== value.executionId) throw oatsError("invalid-declaration", "execution capsule ID does not match its immutable contents");
  return value;
}

export function capturedDispatchAction(capsule) {
  validateExecutionCapsule(capsule);
  return capturedCommandTarget(capsule.target).dispatchAction;
}
