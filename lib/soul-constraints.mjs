/** Source-derived hard field constraints, shared by preparation and verification.
 * No defaults are resolved here and no source/artifact is acquired. */
import { pointerKey } from "./portable-shape.mjs";
import { FUNDAMENTAL_SLOTS } from "./portable-policy.mjs";

export const capabilityChoiceKey = (id) => `/capabilities/${pointerKey(id)}`;
export const settingChoiceKey = (id, name) => `/settings/${pointerKey(id)}/${pointerKey(name)}`;
export const layerChoiceKey = (slot) => `/layers/${slot}`;

export function soulConstraints(parsed) {
  const result = [], source = parsed.declaration.requires ?? {};
  const origin = (pointer) => ({ ...parsed.origins[pointer], kind: "soul-requirement" });
  const selection = (id, item, pointer, key) => {
    result.push({ key, kind: "equals", value: { capability: id, source: parsed.sources[`${pointer}/source`] }, origin: origin(pointer) });
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
