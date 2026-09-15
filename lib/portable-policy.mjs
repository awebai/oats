/** Shared authored selection shapes for the two policy authorities. Validation
 * only: no precedence, provider selection, acquisition, enrollment or execution. */
import { isMaterializedCapabilityId } from "./capability-provenance.mjs";
import { parsePortableSource } from "./source-spec.mjs";
import { invalidShape, objectAt, pointerKey, stringAt } from "./portable-shape.mjs";

export const FUNDAMENTAL_SLOTS = Object.freeze(["knowledge", "messaging", "tasks"]);
export function validatePolicyChoices(value, { pointer, required = false, origins = {}, origin = null, localBase, allowLocalPaths = false }) {
  const rules = objectAt(value, ["capabilities", ...FUNDAMENTAL_SLOTS], [], pointer);
  const sources = Object.create(null);
  const capabilityAt = (id, at) => { if (!isMaterializedCapabilityId(id)) invalidShape(at, "invalid capability identity"); };
  const selection = (item, at, capability) => {
    objectAt(item, capability === undefined ? ["capability", "source", "settings"] : ["source", "settings"],
      capability === undefined ? ["capability", "source"] : ["source"], at);
    capabilityAt(capability ?? item.capability, capability === undefined ? `${at}/capability` : at);
    stringAt(item.source, `${at}/source`);
    try { sources[`${at}/source`] = parsePortableSource(item.source, { localBase, allowLocalPaths }); }
    catch (error) { error.provenance = [origins[`${at}/source`] ?? { document: origin, pointer: `${at}/source` }]; throw error; }
    if (Object.hasOwn(item, "settings")) objectAt(item.settings, null, [], `${at}/settings`);
  };
  if (Object.hasOwn(rules, "capabilities")) {
    objectAt(rules.capabilities, null, [], `${pointer}/capabilities`);
    for (const [id, item] of Object.entries(rules.capabilities)) {
      const at = `${pointer}/capabilities/${pointerKey(id)}`;
      capabilityAt(id, at);
      if (!required && item === false) continue;
      selection(item, at, id);
    }
  }
  for (const slot of FUNDAMENTAL_SLOTS) {
    if (!Object.hasOwn(rules, slot)) continue;
    const item = rules[slot], at = `${pointer}/${slot}`;
    if ((required && item === "any") || (!required && item === "none")) continue;
    selection(item, at);
  }
  return sources;
}

export function validateProviderDeclaration(value, pointer) {
  const envelope = objectAt(value, ["contract", "version", "payload"], ["contract", "version", "payload"], pointer);
  stringAt(envelope.contract, `${pointer}/contract`, { pattern: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/ });
  if (!Number.isSafeInteger(envelope.version) || envelope.version < 1) invalidShape(`${pointer}/version`, "invalid provider contract version");
  return envelope;
}
