/** Versioned soul declarations: parsing and origins, not composition or execution.
 * Requirements constrain the later single resolver; defaults never erase them. */
import { parseConfigData } from "./config-data.mjs";
import { isMaterializedCapabilityId } from "./capability-provenance.mjs";
import { parsePortableSource, portablePath } from "./source-spec.mjs";
import { invalidShape, objectAt, pointerKey, stringAt, stringSetAt, versionAt } from "./portable-shape.mjs";

export const FUNDAMENTAL_SLOTS = Object.freeze(["knowledge", "messaging", "tasks"]);
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALIAS = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const ROOT_FIELDS = ["schemaVersion", "name", "description", "requires", "defaults", "knowledge", "teams", "resources", "work", "runtime", "model", "yolo"];

export function parsePortableSoul(input, { origin = null, localBase, allowLocalPaths = false, limits } = {}) {
  const parsed = parseConfigData(input, { origin, limits });
  const value = objectAt(parsed.value, ROOT_FIELDS, ["schemaVersion", "name"]);
  versionAt(value.schemaVersion);
  stringAt(value.name, "/name", { pattern: NAME });
  if (Object.hasOwn(value, "description")) stringAt(value.description, "/description", { empty: true });
  const sources = Object.create(null);
  const sourceAt = (source, pointer) => {
    stringAt(source, pointer);
    try { sources[pointer] = parsePortableSource(source, { localBase, allowLocalPaths }); }
    catch (error) {
      error.provenance = [parsed.origins[pointer] ?? { document: origin, pointer }];
      throw error;
    }
  };
  const capabilityAt = (capability, pointer) => {
    if (!isMaterializedCapabilityId(capability)) invalidShape(pointer, "invalid capability identity");
  };
  const selection = (item, pointer, capability) => {
    objectAt(item, capability === undefined ? ["capability", "source", "settings"] : ["source", "settings"],
      capability === undefined ? ["capability", "source"] : ["source"], pointer);
    capabilityAt(capability ?? item.capability, capability === undefined ? `${pointer}/capability` : pointer);
    sourceAt(item.source, `${pointer}/source`);
    if (Object.hasOwn(item, "settings")) objectAt(item.settings, null, [], `${pointer}/settings`);
  };
  for (const section of ["requires", "defaults"]) {
    if (!Object.hasOwn(value, section)) continue;
    const rules = objectAt(value[section], ["capabilities", ...FUNDAMENTAL_SLOTS], [], `/${section}`);
    if (Object.hasOwn(rules, "capabilities")) {
      objectAt(rules.capabilities, null, [], `/${section}/capabilities`);
      for (const [capability, item] of Object.entries(rules.capabilities)) {
        const pointer = `/${section}/capabilities/${pointerKey(capability)}`;
        capabilityAt(capability, pointer);
        if (section === "defaults" && item === false) continue;
        selection(item, pointer, capability);
      }
    }
    for (const slot of FUNDAMENTAL_SLOTS) {
      if (!Object.hasOwn(rules, slot)) continue;
      const item = rules[slot], pointer = `/${section}/${slot}`;
      if ((section === "requires" && item === "any") || (section === "defaults" && item === "none")) continue;
      selection(item, pointer);
    }
  }
  if (Object.hasOwn(value, "knowledge")) {
    const envelope = objectAt(value.knowledge, ["contract", "version", "payload"], ["contract", "version", "payload"], "/knowledge");
    stringAt(envelope.contract, "/knowledge/contract", { pattern: ALIAS });
    if (!Number.isSafeInteger(envelope.version) || envelope.version < 1) invalidShape("/knowledge/version", "invalid provider contract version");
    // Payload semantics belong to the selected provider, not this kernel codec.
  }
  if (Object.hasOwn(value, "teams")) stringSetAt(value.teams, "/teams", (item, pointer) => stringAt(item, pointer, { pattern: ALIAS }));
  if (Object.hasOwn(value, "resources")) stringSetAt(value.resources, "/resources", (item) => portablePath(item, { allowRoot: true }));
  if (Object.hasOwn(value, "work") && !["worktree", "checkout", "attached", "workspace", "directory"].includes(value.work)) invalidShape("/work", "unsupported work mode");
  if (Object.hasOwn(value, "runtime") && !["pi", "claude", "codex"].includes(value.runtime)) invalidShape("/runtime", "unsupported runtime");
  if (Object.hasOwn(value, "model")) stringAt(value.model, "/model");
  if (Object.hasOwn(value, "yolo") && typeof value.yolo !== "boolean") invalidShape("/yolo", "expected boolean");
  return { declaration: value, sources, origins: parsed.origins, integrity: parsed.integrity };
}
