/** Generic incarnation/admitted-intent identities. Composition references are
 * deliberately not accepted as incarnation or logical-request identities. */
import { canonicalJson } from "./portable-values.mjs";
import { objectAt, stringAt } from "./portable-shape.mjs";
import { oatsError } from "./errors.mjs";

export function validateIncarnationId(value) {
  stringAt(value, "/incarnationId", { pattern: /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/ });
  return value;
}

export function validateIntentRef(value) {
  canonicalJson(value, { maxBytes: 4096, maxDepth: 4, maxEntries: 16 });
  objectAt(value, ["schemaVersion", "executionId", "incarnationId", "attempt"], ["schemaVersion", "executionId", "incarnationId", "attempt"]);
  if (value.schemaVersion !== 1) throw oatsError("unsupported-wire-version", "unsupported captured intent version");
  stringAt(value.executionId, "/executionId", { pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/ });
  validateIncarnationId(value.incarnationId);
  if (!Number.isSafeInteger(value.attempt) || value.attempt < 1) throw oatsError("invalid-declaration", "intent attempt must be a positive integer");
  return value;
}
