/** Provider-neutral captured action/lifecycle context. Provider bindings remain in
 * OATS_BINDING_FILE; this companion supplies record/target intent and prior
 * opaque provider receipt without provider-specific kernel fields. */
import { lstatSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { canonicalJson } from "./portable-values.mjs";
import { objectAt, stringAt } from "./portable-shape.mjs";
import { portableScope, portableStateDirectory } from "./portable-state.mjs";
import { validateExecutionBinding } from "./schedule-capsule.mjs";
import { validateSoulIdentity, validateWorkspaceIdentity } from "./portable-identity.mjs";
import { validateMessagingChoice, validateOrigin } from "./resolution-shape.mjs";
import { isMaterializedCapabilityId } from "./capability-provenance.mjs";
import { oatsError } from "./errors.mjs";

export const CAPTURED_INVOCATION_CONTEXT_LIMITS = Object.freeze({ maxBytes: 512 * 1024, maxDepth: 32, maxEntries: 16_384 });
const FIELDS = ["schemaVersion", "executionBinding", "subject", "instance", "context", "responsibleHuman", "messagingChoice", "capability", "action", "priorReceipt"];

function human(value, pointer) {
  if (value === null) return;
  objectAt(value, ["provider", "id"], ["provider", "id"], pointer);
  stringAt(value.provider, `${pointer}/provider`); stringAt(value.id, `${pointer}/id`);
}

export function validateCapturedInvocationContext(value) {
  canonicalJson(value, CAPTURED_INVOCATION_CONTEXT_LIMITS); objectAt(value, FIELDS, FIELDS);
  if (value.schemaVersion !== 1) throw oatsError("unsupported-wire-version", "captured invocation context schemaVersion must be 1");
  validateExecutionBinding(value.executionBinding);
  objectAt(value.subject, ["kind", "identity", "alias"], ["kind", "identity", "alias"], "/subject");
  if (!['persistent','helper'].includes(value.subject.kind)) throw oatsError("invalid-declaration", "captured invocation subject kind is invalid");
  stringAt(value.subject.alias, "/subject/alias");
  if (value.subject.kind === "persistent") validateSoulIdentity(value.subject.identity);
  else if (value.subject.identity !== null) throw oatsError("invalid-declaration", "captured helper invocation cannot claim a persistent identity");
  if (value.instance !== null) {
    objectAt(value.instance, ["home", "work", "name", "agent"], ["home", "work", "name", "agent"], "/instance");
    for (const key of ["home", "work"]) {
      stringAt(value.instance[key], `/instance/${key}`);
      if (!isAbsolute(value.instance[key]) || resolve(value.instance[key]) !== value.instance[key] || value.instance[key].includes("\0")) throw oatsError("invalid-declaration", `captured invocation ${key} must be normalized absolute`);
    }
    stringAt(value.instance.name, "/instance/name"); stringAt(value.instance.agent, "/instance/agent");
    if (value.instance.agent !== value.subject.alias || value.instance.work !== join(value.instance.home, "work")) throw oatsError("invalid-resolution", "captured invocation target differs from its subject/home");
  }
  const workspace = value.context?.kind === "workspace";
  objectAt(value.context, workspace ? ["kind", "identity", "observation"] : ["kind", "key"], workspace ? ["kind", "identity", "observation"] : ["kind", "key"], "/context");
  if (!['workspace','standalone'].includes(value.context.kind)) throw oatsError("invalid-declaration", "captured invocation context kind is invalid");
  if (workspace) { validateWorkspaceIdentity(value.context.identity); validateOrigin(value.context.observation); }
  else if (value.context.key !== null) stringAt(value.context.key, "/context/key");
  human(value.responsibleHuman, "/responsibleHuman");
  // Reuse the existing messaging-choice codec, not another privacy/policy model.
  const messagingProvider = value.messagingChoice?.enabled === true ? value.messagingChoice.privateKey?.provider : undefined;
  if (messagingProvider !== undefined && !isMaterializedCapabilityId(messagingProvider)) throw oatsError("invalid-declaration", "invalid invocation messaging provider");
  validateMessagingChoice(value.messagingChoice, { context: value.context,
    bindings: messagingProvider === undefined ? {} : { messaging: { capability: messagingProvider } } });
  const expectedHuman = value.messagingChoice.enabled ? value.messagingChoice.privateKey.human : null;
  if (canonicalJson(value.responsibleHuman) !== canonicalJson(expectedHuman)) throw oatsError("invalid-resolution", "invocation responsible human differs from captured messaging choice");
  stringAt(value.capability, "/capability"); objectAt(value.action, null, ["kind"], "/action"); stringAt(value.action.kind, "/action/kind");
  return value;
}

export function buildCapturedInvocationContext({ loaded, action, instance = null, priorReceipt = null }) {
  if (!loaded?.record || !loaded?.resolution || !loaded?.capability) throw oatsError("invalid-resolution", "captured invocation context requires one verified action");
  const { record } = loaded, persistent = record.subject.kind === "persistent";
  const subject = { kind: record.subject.kind, identity: persistent ? record.subject.soul.identity : null,
    alias: persistent ? record.subject.soul.alias : record.subject.name };
  if (instance !== null && instance.agent !== subject.alias) throw oatsError("invalid-resolution", "captured invocation target agent differs from retained subject");
  const expectedHuman = record.messagingChoice.enabled ? record.messagingChoice.privateKey.human : null;
  const value = { schemaVersion: 1,
    executionBinding: { schemaVersion: 1, deployment: portableScope(loaded.deployment), resolution: loaded.resolution },
    subject, instance, context: record.context, responsibleHuman: expectedHuman,
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
