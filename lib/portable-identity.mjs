/** Qualified identity value types, not a proof of hosting/provider ownership.
 * Discovery obtains facts from the authenticated host adapter, never repo YAML. */
import { canonicalJson } from "./portable-values.mjs";
import { jsonIntegrity } from "./portable-digest.mjs";
import { parseLockedSource3, parseRepositorySource, portablePath } from "./source-spec.mjs";
import { invalidShape, objectAt, stringAt } from "./portable-shape.mjs";

export function validateRepositoryIdentity(value) {
  canonicalJson(value, { maxBytes: 64 * 1024, maxDepth: 8, maxEntries: 64 });
  objectAt(value, value?.kind === "provider-repository" ? ["kind", "provider", "host", "id"] : ["kind", "remote"], ["kind"]);
  if (value.kind === "provider-repository") {
    for (const name of ["provider", "host", "id"]) stringAt(value[name], `/${name}`);
    if (!/^[a-z][a-z0-9.-]*$/.test(value.provider) || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value.host)) {
      invalidShape("", "provider and host identity must be canonical");
    }
  } else if (value.kind === "canonical-remote") {
    stringAt(value.remote, "/remote");
    if (parseRepositorySource(value.remote).normalized !== value.remote) invalidShape("/remote", "repository identity remote is not canonical");
  } else invalidShape("/kind", "unsupported repository identity");
  return value;
}
export function validateSoulIdentity(value) {
  canonicalJson(value, { maxBytes: 64 * 1024, maxDepth: 12, maxEntries: 128 });
  objectAt(value, value?.kind === "git-soul" ? ["kind", "repository", "exportPath"] : ["kind", "source", "exportPath"], ["kind", "exportPath"]);
  if (value.kind === "git-soul") validateRepositoryIdentity(value.repository);
  else if (value.kind === "local-soul") {
    if (parseLockedSource3(value.source, ".").kind !== "path") invalidShape("/source", "local soul identity requires an explicit local source");
  } else invalidShape("/kind", "unsupported soul identity");
  portablePath(value.exportPath, { allowRoot: value.kind === "local-soul" });
  return value;
}
export function validateWorkspaceIdentity(value) {
  canonicalJson(value, { maxBytes: 64 * 1024, maxDepth: 12, maxEntries: 128 });
  objectAt(value, ["repository", "path"], ["repository", "path"]);
  validateRepositoryIdentity(value.repository);
  if (value.path !== "oats-workspace.yaml") invalidShape("/path", "workspace identity names oats-workspace.yaml");
  return value;
}
export function sameIdentity(a, b) { return canonicalJson(a) === canonicalJson(b); }
export function soulIdentityKey(value) { validateSoulIdentity(value); return jsonIntegrity(value).value; }
