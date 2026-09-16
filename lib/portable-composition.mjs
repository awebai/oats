/** Source-aware software choice planning. Consumes validated parser results;
 * qualifies no hosting identity and performs no acquisition, approval or enrollment.
 * All precedence/conflicts still go through the single resolveChoices engine. */
import { canonicalJson, compareUtf8 } from "./portable-values.mjs";
import { invalidShape, objectAt, pointerKey } from "./portable-shape.mjs";
import { validateOrigin } from "./resolution-shape.mjs";
import { sameIdentity, validateSoulIdentity } from "./portable-identity.mjs";
import { FUNDAMENTAL_SLOTS, validatePolicyChoices } from "./portable-policy.mjs";
import { capabilityChoiceKey, layerChoiceKey, settingChoiceKey, soulConstraints, sourceSelectionValue } from "./soul-constraints.mjs";
import { resolveChoices } from "./portable-choices.mjs";
import { validateRepoAnchor, validateSelectionSource } from "./source-spec.mjs";
import { isMaterializedCapabilityId } from "./capability-provenance.mjs";

function originAt(parsed, pointer, kind) {
  const locator = parsed.origins[pointer];
  if (!locator) invalidShape(pointer, "planning requires the original declaration origin");
  const origin = { ...locator, kind };
  validateOrigin(origin);
  return origin;
}

export function planSoftwareChoices(input) {
  canonicalJson(input);
  objectAt(input, ["identity", "soul", "workspace", "adoptions", "operator", "providerRequirements"], ["identity", "soul"]);
  const { identity, soul, workspace = null, adoptions = [], operator = null, providerRequirements = [] } = input;
  validateSoulIdentity(identity);
  const requirements = soulConstraints(soul), candidates = [], settingsCandidates = [];
  if (!Array.isArray(adoptions) || !Array.isArray(providerRequirements)) invalidShape("", "adoptions and provider constraints must be arrays");
  const add = (parsed, key, value, pointer, kind) => candidates.push({ key, value, kind, origin: originAt(parsed, pointer, kind) });
  const collect = (parsed, policy, pointer, kind, sourceContext) => {
    const selection = (id, item, at, key) => {
      const selectedSource = item === false || item === "none" ? null : sourceSelectionValue(id, parsed, at, sourceContext);
      add(parsed, key, selectedSource, at, kind);
      if (item && typeof item === "object") for (const [name, value] of Object.entries(item.settings ?? {})) {
        settingsCandidates.push({ owner: { key, value: selectedSource }, candidate: { key: settingChoiceKey(id, name), value, kind,
          origin: originAt(parsed, `${at}/settings/${pointerKey(name)}`, kind) } });
      }
    };
    for (const [id, item] of Object.entries(policy.capabilities ?? {})) selection(id, item, `${pointer}/capabilities/${pointerKey(id)}`, capabilityChoiceKey(id));
    for (const slot of FUNDAMENTAL_SLOTS) if (Object.hasOwn(policy, slot)) {
      const item = policy[slot]; selection(item === "none" ? null : item.capability, item, `${pointer}/${slot}`, layerChoiceKey(slot));
    }
  };
  if (workspace?.declaration.defaults) collect(workspace, workspace.declaration.defaults, "/defaults", "workspace-default");
  if (soul.declaration.defaults) collect(soul, soul.declaration.defaults, "/defaults", "soul-default");

  // Discovery supplies qualified identity. An alias never performs this lookup.
  // Several aliases may contribute compatible fields; conflicting equal-authority
  // fields are reported by resolveChoices with both original document pointers.
  for (const adoption of adoptions) {
    objectAt(adoption, ["identity", "parsed", "origins", "pointer"], ["identity", "parsed", "origins", "pointer"]);
    validateSoulIdentity(adoption.identity);
    if (!sameIdentity(adoption.identity, identity)) continue;
    const imported = adoption.parsed.reference;
    if (identity.kind !== "git-soul" || imported.soul !== identity.exportPath) invalidShape("/adoptions", "qualified adoption does not match its exported source path");
    if (identity.repository.kind === "canonical-remote" && imported.source !== identity.repository.remote) invalidShape("/adoptions", "import source contradicts its qualified canonical identity");
    const parsed = { sources: adoption.parsed.sources, origins: adoption.origins };
    const root = `${adoption.pointer}/adoption`, value = imported.adoption ?? {};
    if (value.providers) collect(parsed, value.providers, `${root}/providers`, "import-adoption");
    for (const field of ["bindings", "teamAliases"]) for (const [key, item] of Object.entries(value[field] ?? {})) {
      add(parsed, `/adoption/${field}/${pointerKey(key)}`, item, `${root}/${field}/${pointerKey(key)}`, "import-adoption");
    }
  }
  if (operator) {
    objectAt(operator, ["policy", "document", "localBase", "allowLocalPaths", "sourceContext", "bindings"], ["policy", "document"]);
    if (operator.bindings !== undefined) objectAt(operator.bindings, null, [], "/operator/bindings");
    if (operator.sourceContext !== undefined) validateRepoAnchor(operator.sourceContext);
    if (operator.allowLocalPaths !== undefined && typeof operator.allowLocalPaths !== "boolean") invalidShape("/operator/allowLocalPaths", "expected explicit boolean local-source authorization");
    validateOrigin({ kind: "operator", document: operator.document, pointer: "/policy" });
    if (operator.document.kind !== "operator") invalidShape("/operator/document", "operator choices need an operator input locator");
    const origins = Object.create(null);
    const mark = (value, pointer) => {
      origins[pointer] = { document: operator.document, pointer };
      if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) mark(child, `${pointer}/${pointerKey(key)}`);
    };
    mark(operator.policy, "/policy");
    const sources = validatePolicyChoices(operator.policy, { pointer: "/policy", origins,
      localBase: operator.localBase, allowLocalPaths: operator.allowLocalPaths === true });
    collect({ sources, origins }, operator.policy, "/policy", "operator", operator.sourceContext);
  }
  for (const requirement of [...requirements, ...providerRequirements]) validateOrigin(requirement.origin);
  // Provider-owned fixed fields join the SAME constraint pipeline. This function
  // neither interprets a payload nor executes a provider to obtain these inputs.
  const allRequirements = [...requirements, ...providerRequirements];
  // Eligibility follows the selected owning field AND source. Reuse the same
  // engine for this deterministic source pass, then final field resolution;
  // nothing is fetched/re-observed and no second precedence policy is introduced.
  const sourceChoices = resolveChoices({ requirements: allRequirements, candidates }).choices;
  const excludedSettings = [];
  for (const { owner, candidate } of settingsCandidates) {
    if (sameIdentity(sourceChoices[owner.key]?.value ?? null, owner.value)) candidates.push(candidate);
    else excludedSettings.push({ ...candidate, owner, reason: "owning-source-overridden" });
  }
  const result = resolveChoices({ requirements: allRequirements, candidates });
  const capabilities = Object.create(null), providers = Object.create(null), settings = Object.create(null);
  const problems = [...result.problems];
  const select = (key) => {
    const choice = result.choices[key];
    if (!choice || choice.value === null) return null;
    objectAt(choice.value, ["capability", "source"], ["capability", "source"], key);
    const { capability, source } = choice.value;
    if (!isMaterializedCapabilityId(capability)) invalidShape(key, "invalid selected capability identity");
    if (key.startsWith("/capabilities/") && key !== capabilityChoiceKey(capability)) invalidShape(key, "capability choice key differs from its selected identity");
    validateSelectionSource(source);
    if (Object.hasOwn(capabilities, capability)) {
      const prior = capabilities[capability];
      if (!sameIdentity(prior.source, source)) problems.push({ code: "requirement-conflict", key,
        message: "one capability identity has incompatible selected sources", origins: [result.choices[prior.choiceKeys[0]].selectedBy, choice.selectedBy] });
      prior.choiceKeys.push(key);
    } else capabilities[capability] = { source, choiceKeys: [key] };
    return capability;
  };
  for (const key of Object.keys(result.choices).sort(compareUtf8)) if (key.startsWith("/capabilities/")) select(key);
  for (const slot of FUNDAMENTAL_SLOTS) {
    const key = layerChoiceKey(slot);
    if (Object.hasOwn(result.choices, key)) providers[slot] = select(key);
  }
  // Only selected software receives settings; alternative/default history remains
  // in choices for explanation, not an ambient configuration to execute later.
  for (const id of Object.keys(capabilities)) settings[id] = Object.create(null);
  const unescape = (part) => part.replace(/~1/g, "/").replace(/~0/g, "~");
  for (const key of Object.keys(result.choices)) {
    if (key.startsWith("/layers/") && !FUNDAMENTAL_SLOTS.some((slot) => key === layerChoiceKey(slot))) invalidShape(key, "unknown fundamental slot choice");
    if (!key.startsWith("/settings/")) continue;
    const separator = key.indexOf("/", "/settings/".length);
    if (separator < 0) invalidShape(key, "setting choice must name a capability and setting");
    const id = unescape(key.slice("/settings/".length, separator)), name = unescape(key.slice(separator + 1));
    if (!isMaterializedCapabilityId(id) || settingChoiceKey(id, name) !== key) invalidShape(key, "noncanonical setting choice key");
    if (Object.hasOwn(settings, id)) settings[id][name] = key;
  }
  return { ...result, status: problems.some((problem) => problem.code === "requirement-conflict") ? "conflict" : result.status,
    requirements: allRequirements, candidates, capabilities, providers, settings, excludedSettings, problems,
    providerInputs: { knowledge: soul.declaration.knowledge ?? null, stores: workspace?.declaration.knowledge?.stores ?? [] },
    // Advertisements/adoption aliases are data, never wider-team consent.
    advertisedTeams: soul.declaration.teams ?? [] };
}
