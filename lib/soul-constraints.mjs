/** Source-derived hard field constraints, shared by preparation and verification.
 * No defaults are resolved here and no source/artifact is acquired. */
import { invalidShape, pointerKey } from "./portable-shape.mjs";
import { validateRepoAnchor } from "./source-spec.mjs";
import { FUNDAMENTAL_SLOTS } from "./portable-policy.mjs";

export const capabilityChoiceKey = (id) => `/capabilities/${pointerKey(id)}`;
export const settingChoiceKey = (id, name) => `/settings/${pointerKey(id)}/${pointerKey(name)}`;
export const layerChoiceKey = (slot) => `/layers/${slot}`;

/** A repo: relation belongs to the declaring source, not the consumer's cwd or
 * another authority's identically spelled relative path. Operator inputs need
 * an explicit source context because their origin is not a repository document. */
export function sourceSelectionValue(id, parsed, pointer, sourceContext) {
  const source = parsed.sources[`${pointer}/source`];
  if (!source) invalidShape(`${pointer}/source`, "missing normalized selection source");
  if (source.kind !== "repo") return { capability: id, source };
  const anchor = sourceContext ?? parsed.origins[`${pointer}/source`]?.document;
  if (!anchor || typeof anchor.source !== "string") invalidShape(`${pointer}/source`, "repo source needs an explicit declaring repository snapshot", "needs-configuration");
  const snapshot = validateRepoAnchor({ source: anchor.source, revision: anchor.revision });
  return { capability: id, source: { ...source, anchor: snapshot } };
}

export function soulConstraints(parsed) {
  const result = [], source = parsed.declaration.requires ?? {};
  const origin = (pointer) => ({ ...parsed.origins[pointer], kind: "soul-requirement" });
  const selection = (id, item, pointer, key) => {
    result.push({ key, kind: "equals", value: sourceSelectionValue(id, parsed, pointer), origin: origin(pointer) });
    for (const [name, value] of Object.entries(item.settings ?? {})) {
      result.push({ key: settingChoiceKey(id, name), kind: "equals", value, origin: origin(`${pointer}/settings/${pointerKey(name)}`) });
    }
  };
  for (const [id, item] of Object.entries(source.capabilities ?? {})) selection(id, item, `/requires/capabilities/${pointerKey(id)}`, capabilityChoiceKey(id));
  for (const slot of FUNDAMENTAL_SLOTS) {
    if (!Object.hasOwn(source, slot)) continue;
    if (source[slot] === "any") result.push({ key: layerChoiceKey(slot), kind: "required", origin: origin(`/requires/${slot}`) });
    else selection(source[slot].capability, source[slot], `/requires/${slot}`, layerChoiceKey(slot));
  }
  return result;
}
