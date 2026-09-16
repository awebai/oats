/** The existing captured loader action wire, shared with provider invocation
 * validation. This is a data codec, not a dispatch table or provider policy. */
import { canonicalJson } from "./portable-values.mjs";
import { objectAt, stringAt } from "./portable-shape.mjs";
import { oatsError } from "./errors.mjs";

export function validateCapturedAction(action) {
  canonicalJson(action);
  if (!["inspect", "compose", "command", "operation", "hook"].includes(action?.kind)) throw oatsError("unsupported-action", "captured action is not supported by this loader");
  if (["inspect", "compose"].includes(action.kind)) objectAt(action, ["kind"], ["kind"]);
  else if (action.kind === "command") {
    objectAt(action, ["kind", "capability", "namespace", "name"], ["kind", "name"]);
    if ((action.capability === undefined) === (action.namespace === undefined)) throw oatsError("invalid-declaration", "command needs exactly one capability or namespace");
  } else {
    const fields = action.kind === "hook" ? ["kind", "capability", "name"] : ["kind", "slot", "name"];
    objectAt(action, fields, fields);
  }
  for (const key of ["name", "namespace", "capability", "slot"]) if (action[key] !== undefined) stringAt(action[key], `/action/${key}`);
  if (action.kind === "operation" && !["knowledge", "messaging", "tasks"].includes(action.slot)) throw oatsError("invalid-declaration", "captured operation slot is invalid");
  return action;
}
