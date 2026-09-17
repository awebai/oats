/** Provider-neutral captured action/lifecycle context. Provider bindings remain in
 * OATS_BINDING_FILE; this companion supplies record/target intent and prior
 * opaque provider receipt without provider-specific kernel fields. */
import { lstatSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readCapturedInstanceAuthority, readCapturedIntent } from "./captured-instance-index.mjs";
import { validateIncarnationId, validateIntentRef } from "./captured-admission-shape.mjs";
import { isAbsolute, join, resolve } from "node:path";
import { canonicalJson } from "./portable-values.mjs";
import { objectAt, stringAt } from "./portable-shape.mjs";
import { portableScope, portableStateDirectory } from "./portable-state.mjs";
import { validateExecutionBinding } from "./schedule-capsule.mjs";
import { validateCapturedSubject, validateCapturedContext, validateMessagingChoice } from "./resolution-shape.mjs";
import { validateCapturedAction } from "./captured-action-shape.mjs";
import { isMaterializedCapabilityId } from "./capability-provenance.mjs";
import { oatsError } from "./errors.mjs";

export const CAPTURED_INVOCATION_CONTEXT_LIMITS = Object.freeze({ maxBytes: 512 * 1024, maxDepth: 32, maxEntries: 16_384 });
export const CAPTURED_PRIOR_RECEIPT_LIMITS = Object.freeze({ maxBytes: 128 * 1024, maxDepth: 24, maxEntries: 8192 });
const FIELDS = ["schemaVersion", "executionBinding", "subject", "instance", "context", "responsibleHuman", "messagingChoice", "capability", "action", "priorReceipt", "intent"];

function human(value, pointer) {
  if (value === null) return;
  objectAt(value, ["provider", "id"], ["provider", "id"], pointer);
  stringAt(value.provider, `${pointer}/provider`); stringAt(value.id, `${pointer}/id`);
}

export function validateCapturedInvocationContext(value) {
  canonicalJson(value, CAPTURED_INVOCATION_CONTEXT_LIMITS); objectAt(value, FIELDS, FIELDS);
  if (value.schemaVersion !== 1) throw oatsError("unsupported-wire-version", "captured invocation context schemaVersion must be 1");
  validateExecutionBinding(value.executionBinding);
  validateCapturedSubject(value.subject);
  const subjectName = value.subject.kind === "persistent" ? value.subject.soul.alias : value.subject.name;
  if (value.instance !== null) {
    objectAt(value.instance, ["home", "work", "name", "agent", "incarnationId"], ["home", "work", "name", "agent", "incarnationId"], "/instance");
    validateIncarnationId(value.instance.incarnationId);
    for (const key of ["home", "work"]) {
      stringAt(value.instance[key], `/instance/${key}`);
      if (!isAbsolute(value.instance[key]) || resolve(value.instance[key]) !== value.instance[key] || value.instance[key].includes("\0")) throw oatsError("invalid-declaration", `captured invocation ${key} must be normalized absolute`);
    }
    stringAt(value.instance.name, "/instance/name"); stringAt(value.instance.agent, "/instance/agent");
    if (value.instance.agent !== subjectName || value.instance.work !== join(value.instance.home, "work")) throw oatsError("invalid-resolution", "captured invocation target differs from its subject/home");
  }
  validateCapturedContext(value.context);
  human(value.responsibleHuman, "/responsibleHuman");
  // Reuse the existing messaging-choice codec, not another privacy/policy model.
  const messagingProvider = value.messagingChoice?.enabled === true ? value.messagingChoice.privateKey?.provider : undefined;
  if (messagingProvider !== undefined && !isMaterializedCapabilityId(messagingProvider)) throw oatsError("invalid-declaration", "invalid invocation messaging provider");
  validateMessagingChoice(value.messagingChoice, { context: value.context,
    bindings: messagingProvider === undefined ? {} : { messaging: { capability: messagingProvider } } });
  const expectedHuman = value.messagingChoice.enabled ? value.messagingChoice.privateKey.human : null;
  if (canonicalJson(value.responsibleHuman) !== canonicalJson(expectedHuman)) throw oatsError("invalid-resolution", "invocation responsible human differs from captured messaging choice");
  if (!isMaterializedCapabilityId(value.capability)) throw oatsError("invalid-declaration", "invalid invocation capability");
  validateCapturedAction(value.action);
  if (value.action.capability !== undefined && value.action.capability !== value.capability) throw oatsError("invalid-resolution", "invocation action capability differs from its owner");
  if (value.action.kind === "hook" && value.instance === null) throw oatsError("invalid-resolution", "captured instance hook requires instance facts");
  if (value.intent !== null) {
    validateIntentRef(value.intent);
    if (value.instance === null || value.intent.incarnationId !== value.instance.incarnationId) throw oatsError("invalid-resolution", "intent belongs to a different incarnation");
  }
  canonicalJson(value.priorReceipt, CAPTURED_PRIOR_RECEIPT_LIMITS);
  return value;
}

export function buildCapturedInvocationContext(input) {
  const { loaded, action, instance = null } = input;
  if (!loaded?.record || !loaded?.resolution || !loaded?.capability) throw oatsError("invalid-resolution", "captured invocation context requires one verified action");
  const { record } = loaded, subject = record.subject;
  const subjectName = subject.kind === "persistent" ? subject.soul.alias : subject.name;
  if (instance !== null && instance.agent !== subjectName) throw oatsError("invalid-resolution", "captured invocation target agent differs from retained subject");
  const expectedHuman = record.messagingChoice.enabled ? record.messagingChoice.privateKey.human : null;
  let priorReceipt = null, target = null;
  const intent = input.intent ?? null;
  if (instance !== null) {
    canonicalJson(instance);
    objectAt(instance, ["home", "work", "name", "agent"], ["home", "work", "name", "agent"]);
    if (typeof instance.home !== "string" || !isAbsolute(instance.home) || instance.work !== join(instance.home, "work")) throw oatsError("invalid-resolution", "captured invocation needs an explicit home/work target");
    const home = portableScope(instance.home);
    if (!lstatSync(instance.home).isDirectory()) throw oatsError("invalid-resolution", "captured invocation home must not be a symlink");
    const { metadata, row } = readCapturedInstanceAuthority(loaded.deployment, home);
    target = { ...instance, incarnationId: metadata.incarnationId };
    validateExecutionBinding(metadata.executionBinding);
    if (typeof metadata.home !== "string" || portableScope(metadata.home) !== home || metadata.instance !== instance.name
      || metadata.agent !== instance.agent || metadata.kind !== subject.kind
      || portableScope(metadata.executionBinding.deployment) !== portableScope(loaded.deployment)
      || canonicalJson(metadata.executionBinding.resolution) !== canonicalJson(loaded.resolution)
      || canonicalJson(metadata.responsibleHuman) !== canonicalJson(expectedHuman)) throw oatsError("invalid-resolution", "invocation target differs from captured instance metadata/record");
    if (metadata.capabilityMeta !== undefined) objectAt(metadata.capabilityMeta, null, []);
    const previous = row.intents.findLast(entry => entry.capability === loaded.capability.id);
    priorReceipt = previous ? previous.receipt : metadata.capabilityMeta && Object.hasOwn(metadata.capabilityMeta, loaded.capability.id) ? metadata.capabilityMeta[loaded.capability.id] : null;
  }
  if (intent !== null) {
    if (!target) throw oatsError("invalid-resolution", "admitted action requires an owned instance");
    const admitted = readCapturedIntent({ deployment: loaded.deployment, home: instance.home, intent, action });
    if (admitted.capability !== loaded.capability.id || !["admitted", "running"].includes(admitted.state)) throw oatsError("invalid-resolution", "invocation does not match an active admitted capability action");
    priorReceipt = admitted.receipt;
  }
  if (Object.hasOwn(input, "priorReceipt") && canonicalJson(input.priorReceipt) !== canonicalJson(priorReceipt)) throw oatsError("invalid-resolution", "invocation prior receipt differs from stored provider receipt");
  const value = { schemaVersion: 1,
    executionBinding: { schemaVersion: 1, deployment: portableScope(loaded.deployment), resolution: loaded.resolution },
    subject, instance: target, intent, context: record.context, responsibleHuman: expectedHuman,
    messagingChoice: record.messagingChoice, capability: loaded.capability.id, action, priorReceipt };
  return validateCapturedInvocationContext(structuredClone(value));
}

export function withCapturedInvocationContextFile(invocation, run) {
  validateCapturedInvocationContext(invocation);
  if (typeof run !== "function") throw oatsError("invalid-declaration", "captured invocation context consumer must be a function");
  const directory = mkdtempSync(join(portableStateDirectory(invocation.executionBinding.deployment, true), ".invocation-context-"));
  const owned = lstatSync(directory), file = join(directory, "context.json"); let primary, result, completed = false;
  try {
    writeFileSync(file, canonicalJson(invocation, CAPTURED_INVOCATION_CONTEXT_LIMITS), { flag: "wx", mode: 0o600 });
    result = run({ OATS_INVOCATION_CONTEXT_FILE: file }); completed = true; return result;
  } catch (error) { primary = error; throw error; }
  finally {
    try {
      const current = lstatSync(directory);
      if (!current.isDirectory() || current.dev !== owned.dev || current.ino !== owned.ino) throw oatsError("integrity-drift", "invocation context directory ownership changed");
      rmSync(directory, { recursive: true });
    } catch (cleanup) {
      if (!primary) {
        const error = new AggregateError([cleanup], "captured invocation context cleanup failed after invocation", { cause: cleanup });
        error.code = cleanup.code; error.invocationCompleted = completed; error.invocationResult = result; throw error;
      }
      const error = new AggregateError([primary, cleanup], "captured invocation context and cleanup failed", { cause: primary });
      error.code = primary.code;
      if (primary.invocationCompleted) { error.invocationCompleted = true; error.invocationResult = primary.invocationResult; }
      throw error;
    }
  }
}
