/** Private captured-source registration input. This is a synchronous hook
 * snapshot, never durable worker authority or an ambient configuration file. */
import { lstatSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { validateSoulIdentity } from "./portable-identity.mjs";
import { canonicalJson } from "./portable-values.mjs";
import { objectAt, stringAt } from "./portable-shape.mjs";
import { portableStateDirectory } from "./portable-state.mjs";
import { validateProviderBinding } from "./resolution-shape.mjs";
import { validateExecutionBinding } from "./schedule-capsule.mjs";
import { oatsError } from "./errors.mjs";

export const CAPTURED_SOURCE_RECEIPT_LIMITS = Object.freeze({ maxBytes: 256 * 1024, maxDepth: 32, maxEntries: 16_384 });
const RECEIPT_FIELDS = ["schemaVersion", "kind", "home", "work", "context", "agent", "instance", "sourceIdentity", "role", "executionBinding", "responsibleHuman", "binding"];

function absolutePath(value, pointer) {
  stringAt(value, pointer);
  if (!isAbsolute(value) || resolve(value) !== value || value.includes("\0")) throw oatsError("invalid-declaration", `${pointer} must be a normalized absolute path`);
}

function human(value) {
  if (value === null) return;
  objectAt(value, ["provider", "id"], ["provider", "id"], "/responsibleHuman");
  stringAt(value.provider, "/responsibleHuman/provider");
  stringAt(value.id, "/responsibleHuman/id");
}

export function validateCapturedSourceReceipt(value) {
  canonicalJson(value, CAPTURED_SOURCE_RECEIPT_LIMITS);
  objectAt(value, RECEIPT_FIELDS, RECEIPT_FIELDS);
  if (value.schemaVersion !== 1) throw oatsError("unsupported-wire-version", "captured source receipt schemaVersion must be 1");
  if (!["persistent", "helper"].includes(value.kind)) throw oatsError("invalid-declaration", "captured source receipt kind must be persistent or helper");
  for (const [key, field] of [["home", value.home], ["work", value.work], ["context", value.context]]) absolutePath(field, `/${key}`);
  if (value.context !== value.executionBinding?.deployment) throw oatsError("invalid-declaration", "captured source receipt context must equal its execution deployment");
  stringAt(value.agent, "/agent"); stringAt(value.instance, "/instance"); stringAt(value.role, "/role");
  for (const [pointer, text] of [["/agent", value.agent], ["/instance", value.instance], ["/role", value.role]]) if (text.includes("\0")) throw oatsError("invalid-declaration", `${pointer} contains NUL`);
  if (!value.agent || !value.instance || Buffer.byteLength(value.role, "utf8") > 128 * 1024) throw oatsError("invalid-declaration", "captured source receipt identity/role is empty or exceeds its bound");
  if (value.kind === "persistent") {
    if (value.sourceIdentity === null) throw oatsError("invalid-declaration", "persistent captured source receipt needs a qualified soul identity");
    validateSoulIdentity(value.sourceIdentity);
  } else if (value.sourceIdentity !== null) throw oatsError("invalid-declaration", "helper captured source receipt must not claim a persistent soul identity");
  validateExecutionBinding(value.executionBinding); human(value.responsibleHuman); validateProviderBinding(value.binding);
  return value;
}

export function withCapturedSourceReceiptFile(home, receipt, run) {
  validateCapturedSourceReceipt(receipt);
  if (typeof run !== "function") throw oatsError("invalid-declaration", "captured source receipt consumer must be a function");
  if (resolve(home) !== receipt.home) throw oatsError("invalid-declaration", "captured source receipt home differs from its invocation home");
  const directory = mkdtempSync(join(portableStateDirectory(receipt.executionBinding.deployment, true), ".source-receipt-"));
  const owned = lstatSync(directory), file = join(directory, "receipt.json"); let primary, result, completed = false;
  try {
    writeFileSync(file, canonicalJson(receipt, CAPTURED_SOURCE_RECEIPT_LIMITS), { flag: "wx", mode: 0o600 });
    result = run({ OATS_SOURCE_RECEIPT_FILE: file }); completed = true; return result;
  } catch (error) { primary = error; throw error; }
  finally {
    try {
      const current = lstatSync(directory);
      if (!current.isDirectory() || current.dev !== owned.dev || current.ino !== owned.ino) throw oatsError("integrity-drift", "source receipt invocation directory ownership changed");
      rmSync(directory, { recursive: true });
    } catch (cleanup) {
      if (!primary) {
        const error = new AggregateError([cleanup], "captured source receipt cleanup failed after invocation", { cause: cleanup });
        error.code = cleanup.code; error.invocationCompleted = completed; error.invocationResult = result; throw error;
      }
      const error = new AggregateError([primary, cleanup], "captured source receipt invocation and cleanup failed", { cause: primary });
      error.code = primary.code; throw error;
    }
  }
}
