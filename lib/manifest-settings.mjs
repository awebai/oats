/** Manifest-owned setting defaults are intrinsic field fallbacks, not another
 * workspace/repository policy authority. Capture them before record publication. */
import { canonicalJson, parseStrictJson } from "./portable-values.mjs";
import { bytesIntegrity } from "./portable-digest.mjs";
import { objectAt, pointerKey } from "./portable-shape.mjs";
import { validateArtifactRef, validateOrigin } from "./resolution-shape.mjs";
import { settingChoiceKey } from "./soul-constraints.mjs";
import { resolveChoices } from "./portable-choices.mjs";
import { oatsError } from "./errors.mjs";

export function manifestSettingDefaults(artifact, bytes) {
  validateArtifactRef(artifact);
  if (artifact.kind !== "capability") throw oatsError("invalid-declaration", "manifest defaults need a capability artifact owner");
  const manifest = parseStrictJson(bytes);
  objectAt(manifest, null, ["capability", "version"]);
  if (manifest.capability !== artifact.capability) throw oatsError("invalid-resolution", "manifest default owner differs from its artifact");
  const defaults = Object.create(null);
  if (manifest.settings !== undefined) objectAt(manifest.settings, null, [], "/settings");
  const document = { kind: "artifact", owner: artifact, path: "oats.json", integrity: bytesIntegrity(bytes) };
  for (const [name, declaration] of Object.entries(manifest.settings ?? {})) {
    if (!declaration || typeof declaration !== "object" || Array.isArray(declaration) || !Object.hasOwn(declaration, "default")) continue;
    const origin = { kind: "manifest-default", document, pointer: `/settings/${pointerKey(name)}/default` };
    validateOrigin(origin);
    defaults[name] = { key: settingChoiceKey(artifact.capability, name), kind: "manifest-default", value: declaration.default, origin };
  }
  return { manifest, defaults };
}

/** Definitions are the selected, verified manifest byte snapshots. No provider
 * payload code runs here, and no source/lock/approval lookup is performed. */
export function captureManifestSettings(plan, definitions) {
  canonicalJson(plan);
  if (plan.status === "conflict") throw oatsError("requirement-conflict", "cannot capture defaults for a conflicting software plan");
  if (!Array.isArray(definitions)) throw oatsError("invalid-declaration", "selected manifest definitions must be an array");
  const candidates = [...plan.candidates], settings = Object.create(null), seen = new Set();
  for (const id of Object.keys(plan.capabilities)) settings[id] = Object.assign(Object.create(null), plan.settings[id] ?? {});
  for (const { artifact, bytes } of definitions) {
    const { defaults } = manifestSettingDefaults(artifact, bytes), id = artifact.capability;
    if (!Object.hasOwn(plan.capabilities, id) || seen.has(id)) throw oatsError("invalid-resolution", "manifest defaults do not match the selected capability set");
    seen.add(id);
    for (const [name, candidate] of Object.entries(defaults)) {
      candidates.push(candidate); settings[id][name] = candidate.key;
    }
  }
  if (seen.size !== Object.keys(plan.capabilities).length) throw oatsError("resolution-incomplete", "selected manifest defaults were not fully captured");
  const resolved = resolveChoices({ requirements: plan.requirements, candidates });
  return { ...plan, ...resolved, candidates, settings };
}

/** Loaded records must carry the exact default witness, even when overridden.
 * Missing defaults are an incomplete capture, never filled during dispatch. */
export function verifyManifestSettings(record, artifact, bytes) {
  const { manifest, defaults } = manifestSettingDefaults(artifact, bytes), id = artifact.capability;
  const originKey = ({ kind, document, pointer }) => canonicalJson({ kind, document, pointer });
  for (const [name, candidate] of Object.entries(defaults)) {
    const key = record.dispatch.settingsChoices[id]?.[name], choice = record.choices[candidate.key];
    if (key !== candidate.key || !choice || !choice.considered.some((entry) => entry.kind === "manifest-default"
        && canonicalJson(entry.value) === canonicalJson(candidate.value) && originKey(entry.origin) === originKey(candidate.origin))) {
      throw oatsError("resolution-incomplete", "captured setting omits its exact manifest default or provenance");
    }
  }
  return manifest;
}
