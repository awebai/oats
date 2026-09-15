/** The single bounded choice resolver: equality/presence constraints plus
 * fallback values. No expressions, source fetching, provider internals or trust.
 * Field codecs represent a disabled/unbound selection as null; false/[] may be
 * legitimate DATA values. This engine does not guess meaning from strings. */
import { canonicalJson, compareUtf8 } from "./portable-values.mjs";
import { invalidShape, objectAt, stringAt } from "./portable-shape.mjs";

const PRIORITY = Object.freeze({ "manifest-default": -1, "workspace-default": 0, "soul-default": 1, "import-adoption": 2, operator: 3 });
export const CHOICE_KINDS = Object.freeze(Object.keys(PRIORITY));
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const originOrder = (a, b) => compareUtf8(canonicalJson(a.origin), canonicalJson(b.origin))
  || compareUtf8(canonicalJson(a), canonicalJson(b));

export function resolveChoices({ requirements = [], candidates = [] } = {}) {
  canonicalJson({ requirements, candidates });
  if (!Array.isArray(requirements) || !Array.isArray(candidates)) invalidShape("", "choice inputs must be arrays");
  const groups = new Map(), choices = Object.create(null), problems = [];
  const group = (key) => {
    stringAt(key, "/key");
    if (!key.startsWith("/")) invalidShape("/key", "choice keys are absolute JSON pointers");
    if (!groups.has(key)) groups.set(key, { requirements: [], candidates: [] });
    return groups.get(key);
  };
  for (const [index, requirement] of requirements.entries()) {
    const at = `/requirements/${index}`;
    objectAt(requirement, ["key", "kind", "value", "origin"], ["key", "kind", "origin"], at);
    if (!["equals", "required"].includes(requirement.kind)) invalidShape(`${at}/kind`, "unsupported constraint kind");
    if ((requirement.kind === "equals") !== Object.hasOwn(requirement, "value")) invalidShape(at, "constraint value does not match its kind");
    objectAt(requirement.origin, null, [], `${at}/origin`);
    group(requirement.key).requirements.push(requirement);
  }
  for (const [index, candidate] of candidates.entries()) {
    const at = `/candidates/${index}`;
    objectAt(candidate, ["key", "kind", "value", "origin"], ["key", "kind", "value", "origin"], at);
    if (!Object.hasOwn(PRIORITY, candidate.kind)) invalidShape(`${at}/kind`, "unsupported choice origin kind");
    objectAt(candidate.origin, null, [], `${at}/origin`);
    group(candidate.key).candidates.push(candidate);
  }
  const conflict = (key, a, b, message) => {
    problems.push({ code: "requirement-conflict", key, message, origins: [a.origin, b.origin] });
  };
  for (const key of [...groups.keys()].sort(compareUtf8)) {
    const input = groups.get(key);
    input.requirements.sort(originOrder);
    input.candidates.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || originOrder(a, b));
    const fixed = input.requirements.filter((item) => item.kind === "equals");
    const presence = input.requirements.find((item) => item.kind === "required");
    const seed = fixed[0];
    let value = seed ? seed.value : null, selectedBy = seed ? seed.origin : null;
    for (const other of fixed.slice(1)) if (!equal(seed.value, other.value)) conflict(key, seed, other, "hard requirements disagree");
    if (seed && presence && seed.value === null) conflict(key, presence, seed, "required value is explicitly absent");
    const considered = [];
    let previous;
    for (const candidate of input.candidates) {
      if (previous && PRIORITY[candidate.kind] === PRIORITY[previous.kind] && !equal(candidate.value, previous.value)) {
        conflict(key, previous, candidate, "equal-authority choices disagree");
      }
      previous = candidate;
      const incompatible = (seed && !equal(candidate.value, seed.value)) || (presence && candidate.value === null);
      if (incompatible) {
        if (PRIORITY[candidate.kind] >= PRIORITY["import-adoption"]) {
          conflict(key, seed ?? presence, candidate, "explicit choice cannot erase a hard requirement");
        }
        considered.push({ kind: candidate.kind, value: candidate.value, origin: candidate.origin, disposition: "overridden" });
        continue;
      }
      if (!seed || PRIORITY[candidate.kind] >= PRIORITY["import-adoption"]) {
        value = candidate.value; selectedBy = candidate.origin;
      }
      considered.push({ kind: candidate.kind, value: candidate.value, origin: candidate.origin, disposition: "overridden" });
    }
    for (const entry of considered) {
      if (selectedBy && equal(entry.origin, selectedBy) && equal(entry.value, value)) entry.disposition = "selected";
    }
    if (presence && value === null && !problems.some((item) => item.key === key)) {
      problems.push({ code: "needs-configuration", key, message: "required value has no concrete binding", origins: [presence.origin] });
    }
    choices[key] = { value, selectedBy, constraints: input.requirements.map(({ key: _, ...constraint }) => constraint), considered };
  }
  return { contractVersion: 1, status: problems.some((item) => item.code === "requirement-conflict")
    ? "conflict" : problems.length ? "needs-configuration" : "resolved", choices, problems };
}
