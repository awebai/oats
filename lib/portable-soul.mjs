/** Versioned soul declarations: parsing and origins, not composition or execution.
 * Requirements constrain the later single resolver; defaults never erase them. */
import { parseConfigData } from "./config-data.mjs";
import { portablePath } from "./source-spec.mjs";
import { invalidShape, objectAt, stringAt, stringSetAt, versionAt } from "./portable-shape.mjs";
import { validatePolicyChoices, validateProviderDeclaration } from "./portable-policy.mjs";

export { FUNDAMENTAL_SLOTS } from "./portable-policy.mjs";
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALIAS = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const LAUNCH_CONFIG_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ROOT_FIELDS = ["schemaVersion", "name", "description", "requires", "defaults", "knowledge", "teams", "resources", "work", "runtime", "model", "yolo", "launch-config", "backend", "children"];

export function parsePortableSoul(input, { origin = null, localBase, allowLocalPaths = false, limits } = {}) {
  const parsed = parseConfigData(input, { origin, limits });
  const value = objectAt(parsed.value, ROOT_FIELDS, ["schemaVersion", "name"]);
  versionAt(value.schemaVersion);
  stringAt(value.name, "/name", { pattern: NAME });
  if (Object.hasOwn(value, "description")) stringAt(value.description, "/description", { empty: true });
  const sources = Object.create(null);
  for (const section of ["requires", "defaults"]) {
    if (!Object.hasOwn(value, section)) continue;
    Object.assign(sources, validatePolicyChoices(value[section], {
      pointer: `/${section}`, required: section === "requires", origins: parsed.origins,
      origin, localBase, allowLocalPaths,
    }));
  }
  if (Object.hasOwn(value, "knowledge")) validateProviderDeclaration(value.knowledge, "/knowledge");
  if (Object.hasOwn(value, "teams")) stringSetAt(value.teams, "/teams", (item, pointer) => stringAt(item, pointer, { pattern: ALIAS }));
  if (Object.hasOwn(value, "resources")) stringSetAt(value.resources, "/resources", (item) => portablePath(item, { allowRoot: true }));
  if (Object.hasOwn(value, "work") && !["worktree", "checkout", "attached", "workspace", "directory"].includes(value.work)) invalidShape("/work", "unsupported work mode");
  if (Object.hasOwn(value, "runtime") && !["pi", "claude", "codex"].includes(value.runtime)) invalidShape("/runtime", "unsupported runtime");
  if (Object.hasOwn(value, "model")) stringAt(value.model, "/model");
  if (Object.hasOwn(value, "launch-config")) stringAt(value["launch-config"], "/launch-config", { pattern: LAUNCH_CONFIG_NAME });
  if (Object.hasOwn(value, "backend") && !["tmux", "herdr"].includes(value.backend)) invalidShape("/backend", "unsupported session backend");
  if (Object.hasOwn(value, "yolo") && typeof value.yolo !== "boolean") invalidShape("/yolo", "expected boolean");
  if (Object.hasOwn(value, "children")) {
    const children = objectAt(value.children, ["spawn"], [], "/children");
    if (Object.hasOwn(children, "spawn") && typeof children.spawn !== "boolean") invalidShape("/children/spawn", "expected boolean");
  }
  return { declaration: value, sources, origins: parsed.origins, integrity: parsed.integrity };
}
