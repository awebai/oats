/** Immutable software authority for scheduled execution.
 *
 * A definition stores an execution template without an intent ID. Each
 * admitted attempt receives a fresh opaque `executionId`. Two attempts of
 * identical retained bytes are therefore distinct intents; a canonical digest
 * of the template separately witnesses content identity. This module performs
 * no preparation, approval, launch, or ambient resolution. */
import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { capturedSelector } from "./captured-selector.mjs";
import { jsonIntegrity } from "./portable-digest.mjs";
import { canonicalJson } from "./portable-values.mjs";
import { validateOrigin, validateResolutionRef } from "./resolution-shape.mjs";
import { oatsError } from "./errors.mjs";

export const EXECUTION_CAPSULE_VERSION = 1;
export const SCHEDULE_ATTEMPT_VERSION = 1;
export const SCHEDULE_DEFINITION_VERSION = 2;
export const RECURRENCE_POLICIES = Object.freeze(["capture", "prepare-on-tick"]);
const TEMPLATE_FIELDS = Object.freeze(["schemaVersion", "resolution", "deployment", "action", "target", "inputRefs", "responsibleHuman"]);
const CAPSULE_FIELDS = Object.freeze([...TEMPLATE_FIELDS, "executionId"]);
const COMMAND_TARGET_FIELDS = Object.freeze(["cwd", "argv"]);
const WAKE_TARGET_FIELDS = Object.freeze(["home", "message"]);
const BINDING_FIELDS = Object.freeze(["schemaVersion", "deployment", "resolution"]);
const ACTION_FIELDS = Object.freeze(["kind", "name"]);
const PREPARATION_FIELDS = Object.freeze(["deployment", "source", "origin", "workspace", "member", "operator", "mode", "allowLocalPaths"]);
const SOURCE_FIELDS = Object.freeze(["source", "soul", "revision", "alias"]);
const EXECUTION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

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
  exactObject(target, COMMAND_TARGET_FIELDS, "execution target");
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

export function validatePreparationInput(value) {
  canonicalJson(value, { maxBytes: 1024 * 1024, maxDepth: 64, maxEntries: 20_000 });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw oatsError("invalid-declaration", "preparation must be an object");
  for (const key of Object.keys(value)) if (!PREPARATION_FIELDS.includes(key)) throw oatsError("invalid-declaration", `unsupported preparation field ${key}`);
  if (!Object.hasOwn(value, "deployment") || !Object.hasOwn(value, "source")) throw oatsError("invalid-declaration", "preparation needs deployment and source");
  if (typeof value.deployment !== "string" || !isAbsolute(value.deployment) || resolve(value.deployment) !== value.deployment) throw oatsError("invalid-declaration", "preparation deployment must be a normalized absolute path");
  if (typeof value.source === "string") {
    if (!value.source || !value.workspace) throw oatsError("invalid-declaration", "workspace alias preparation needs a non-empty source alias and workspace request");
  } else {
    exactObject(value.source, SOURCE_FIELDS, "preparation source");
    for (const key of SOURCE_FIELDS) if (typeof value.source[key] !== "string" || !value.source[key]) throw oatsError("invalid-declaration", `preparation source ${key} must be non-empty text`);
  }
  if (value.origin !== undefined) validateOrigin(value.origin);
  if (value.mode !== undefined && typeof value.mode !== "string") throw oatsError("invalid-declaration", "preparation mode must be a string");
  if (value.allowLocalPaths !== undefined && typeof value.allowLocalPaths !== "boolean") throw oatsError("invalid-declaration", "preparation allowLocalPaths must be boolean");
  return copied(value);
}

export function commandArgvWithExecutionBinding(argv, binding) {
  validateExecutionBinding(binding);
  canonicalJson(argv, { maxBytes: 1024 * 1024, maxDepth: 8, maxEntries: 20_000 });
  if (!Array.isArray(argv) || argv.length < 3 || argv[0] !== "oats" || argv.some((arg) => typeof arg !== "string" || arg.includes("\0"))) throw oatsError("invalid-declaration", "prepare-on-tick argv must be an oats command without NUL values");
  let selected;
  try { selected = capturedSelector(argv.slice(1), {}); } catch (error) { throw oatsError("invalid-declaration", `prepare-on-tick argv has invalid selectors: ${error.message}`); }
  if (selected) throw oatsError("invalid-declaration", "prepare-on-tick argv cannot contain a captured selector before preparation");
  if (!argv.includes("--json")) throw oatsError("invalid-declaration", "prepare-on-tick argv must save --json explicitly");
  const end = argv.indexOf("--"), insertAt = end < 0 ? argv.length : end;
  return [...argv.slice(0, insertAt), "--deployment", binding.deployment, "--resolution", binding.resolution.id, ...argv.slice(insertAt)];
}

export function validateExecutionBinding(value) {
  canonicalJson(value, { maxBytes: 64 * 1024, maxDepth: 8, maxEntries: 32 });
  exactObject(value, BINDING_FIELDS, "execution binding");
  if (value.schemaVersion !== 1) throw oatsError("unsupported-wire-version", "unsupported execution binding version");
  if (typeof value.deployment !== "string" || !isAbsolute(value.deployment) || resolve(value.deployment) !== value.deployment) throw oatsError("invalid-declaration", "execution binding deployment must be a normalized absolute path");
  validateResolutionRef(value.resolution);
  return value;
}

function templateOf(value) {
  return {
    schemaVersion: value.schemaVersion,
    resolution: value.resolution,
    deployment: value.deployment,
    action: value.action,
    target: value.target,
    inputRefs: value.inputRefs,
    responsibleHuman: value.responsibleHuman,
  };
}

export function executionContentIntegrity(value) { return jsonIntegrity(templateOf(value)); }

export function buildCommandExecutionTemplate({ cwd, argv, inputRefs = {}, responsibleHuman = null }) {
  canonicalJson({ cwd, argv }, { maxBytes: 1024 * 1024, maxDepth: 32, maxEntries: 20_000 });
  if (typeof cwd !== "string" || !isAbsolute(cwd) || !Array.isArray(argv)) throw oatsError("invalid-declaration", "captured command needs an absolute cwd and argv array");
  const target = copied({ cwd: resolve(cwd), argv });
  const parsed = capturedCommandTarget(target);
  if (!inputRefs || typeof inputRefs !== "object" || Array.isArray(inputRefs)) throw oatsError("invalid-declaration", "execution inputRefs must be an object");
  if (responsibleHuman !== null && (!responsibleHuman || typeof responsibleHuman !== "object" || Array.isArray(responsibleHuman))) {
    throw oatsError("invalid-declaration", "execution responsibleHuman must be an object or null");
  }
  return copied({
    schemaVersion: EXECUTION_CAPSULE_VERSION,
    resolution: parsed.resolution,
    deployment: parsed.deployment,
    action: parsed.action,
    target,
    inputRefs,
    responsibleHuman,
  });
}

export function buildWakeExecutionTemplate({ home, message, executionBinding, inputRefs = {}, responsibleHuman }) {
  validateExecutionBinding(executionBinding);
  canonicalJson({ home, message, inputRefs, responsibleHuman }, { maxBytes: 1024 * 1024, maxDepth: 32, maxEntries: 20_000 });
  if (typeof home !== "string" || !isAbsolute(home) || resolve(home) !== home) throw oatsError("invalid-declaration", "captured wake home must be a normalized absolute path");
  if (typeof message !== "string" || !message || message.includes("\0")) throw oatsError("invalid-declaration", "captured wake message must be non-empty text without NUL");
  if (!inputRefs || typeof inputRefs !== "object" || Array.isArray(inputRefs)) throw oatsError("invalid-declaration", "execution inputRefs must be an object");
  if (responsibleHuman === undefined || (responsibleHuman !== null && (!responsibleHuman || typeof responsibleHuman !== "object" || Array.isArray(responsibleHuman)))) {
    throw oatsError("invalid-declaration", "captured wake responsibleHuman must be an explicit object or null");
  }
  return copied({ schemaVersion: EXECUTION_CAPSULE_VERSION, resolution: executionBinding.resolution,
    deployment: executionBinding.deployment, action: { kind: "wake", name: "session" },
    target: { home, message }, inputRefs, responsibleHuman });
}

export function validateExecutionTemplate(value) {
  canonicalJson(value, { maxBytes: 1024 * 1024, maxDepth: 64, maxEntries: 20_000 });
  exactObject(value, TEMPLATE_FIELDS, "execution template");
  if (value.schemaVersion !== EXECUTION_CAPSULE_VERSION) throw oatsError("unsupported-wire-version", "unsupported execution template version");
  validateResolutionRef(value.resolution);
  if (typeof value.deployment !== "string" || !isAbsolute(value.deployment) || resolve(value.deployment) !== value.deployment) throw oatsError("invalid-declaration", "execution deployment must be a normalized absolute path");
  exactObject(value.action, ACTION_FIELDS, "execution action");
  if (value.action.kind === "command") {
    if (typeof value.action.name !== "string" || !/^[^:\s]+:[^:\s]+$/.test(value.action.name)) throw oatsError("invalid-declaration", "captured command action name must be namespace:command");
  } else if (value.action.kind === "wake") {
    if (value.action.name !== "session") throw oatsError("invalid-declaration", "captured wake action must name session");
  } else throw oatsError("invalid-declaration", "unsupported scheduled execution action");
  if (!value.inputRefs || typeof value.inputRefs !== "object" || Array.isArray(value.inputRefs)) throw oatsError("invalid-declaration", "execution inputRefs must be an object");
  if (value.responsibleHuman !== null && (!value.responsibleHuman || typeof value.responsibleHuman !== "object" || Array.isArray(value.responsibleHuman))) {
    throw oatsError("invalid-declaration", "execution responsibleHuman must be an object or null");
  }
  if (value.action.kind === "command") {
    const parsed = capturedCommandTarget(value.target);
    if (parsed.deployment !== value.deployment || !same(parsed.resolution, value.resolution)
        || !same(parsed.action, value.action)) throw oatsError("invalid-declaration", "execution template disagrees with its saved command selectors");
  } else {
    exactObject(value.target, WAKE_TARGET_FIELDS, "wake target");
    if (typeof value.target.home !== "string" || !isAbsolute(value.target.home) || resolve(value.target.home) !== value.target.home) throw oatsError("invalid-declaration", "captured wake home must be a normalized absolute path");
    if (typeof value.target.message !== "string" || !value.target.message || value.target.message.includes("\0")) throw oatsError("invalid-declaration", "captured wake message must be non-empty text without NUL");
  }
  return value;
}

export function admitExecutionTemplate(template, { executionId = randomUUID() } = {}) {
  validateExecutionTemplate(template);
  if (typeof executionId !== "string" || !EXECUTION_ID_RE.test(executionId)) throw oatsError("invalid-declaration", "executionId must be a non-empty opaque identifier");
  return validateExecutionCapsule({ ...copied(template), executionId });
}

export function validateExecutionCapsule(value) {
  canonicalJson(value, { maxBytes: 1024 * 1024, maxDepth: 64, maxEntries: 20_000 });
  exactObject(value, CAPSULE_FIELDS, "execution capsule");
  if (typeof value.executionId !== "string" || !EXECUTION_ID_RE.test(value.executionId)) throw oatsError("invalid-declaration", "executionId must be a non-empty opaque identifier");
  const { executionId: _executionId, ...template } = value;
  validateExecutionTemplate(template);
  return value;
}

export function capturedDispatchAction(value) {
  const template = Object.hasOwn(value, "executionId") ? (() => { validateExecutionCapsule(value); const { executionId: _executionId, ...rest } = value; return rest; })() : validateExecutionTemplate(value);
  return template.action.kind === "command" ? capturedCommandTarget(template.target).dispatchAction : template.action;
}
