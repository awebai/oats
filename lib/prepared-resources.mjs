/** Build retained command/curriculum records from already selected software.
 * Kernel callbacks own existing skill discovery and manifest command semantics. */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { copyTreeSafe } from "./artifact-tree.mjs";
import { treeIntegrity, jsonIntegrity } from "./portable-digest.mjs";
import { retainPortableArtifact, verifyPortableArtifact } from "./portable-artifacts.mjs";
import { commitCapturedResolution, verifyResolutionInputs } from "./captured-resolutions.mjs";
import { readPortableBytes } from "./portable-files.mjs";
import { captureHelperInjectionChoices } from "./helper-injection-policy.mjs";
import { parseConfigData } from "./config-data.mjs";
import { oatsError } from "./errors.mjs";
import { normalizePackagePath } from "./capability-provenance.mjs";
import { compileCapturedLaunchRequest } from "./captured-launch-request.mjs";

export function completePreparedResources({ seed, plan, manifests, mode, deployment, directory, launch, helperLaunches = {} }, kernel) {
  const problems = [];
  for (const [id, manifest] of manifests) {
    if (!Object.hasOwn(seed.artifacts.capabilities, id)) continue;
    if (manifest.layer && seed.bindings?.[manifest.layer]?.capability !== id) problems.push({ code: "provider-not-qualified", message: `provider ${id} needs its binding adapter before complete preparation`, origins: [] });
    const settings = Object.fromEntries(Object.entries(plan.settings[id] ?? {}).map(([name, key]) => [name, plan.choices[key].value]));
    kernel.settings(manifest, settings);
  }
  if (problems.length) return { record: null, problems };
  const snapshot = join(directory, "kernel-resources"); mkdirSync(snapshot); mkdirSync(join(snapshot, "injects"));
  const kernelSkills = ["oats-portable", "oats-soul-setup", "oats-portable-artifacts"];
  const workInjection = (workMode) => workMode === "directory" ? "portable-work-directory.md" : `work-${workMode}.md`;
  const injectionFiles = ["oats-portable.md", "portable-instance-boundary.md", ...kernel.workModes.map(workInjection)];
  // Only known kernel resources, never a sweep of the checkout/node_modules,
  // author directories, deployment config or credentials.
  for (const name of kernelSkills) copyTreeSafe(join(kernel.root, "skills", name), join(snapshot, "skills", name));
  for (const file of injectionFiles) copyTreeSafe(join(kernel.root, "injects", file), join(snapshot, "injects", file));
  const bundle = { kind: "resource", integrity: treeIntegrity(snapshot) };
  retainPortableArtifact(deployment, snapshot, bundle);
  const portable = (root, path) => relative(root, path).split(sep).join("/") || ".";
  const effectiveSettings = Object.fromEntries(Object.entries(plan.settings).map(([id, values]) => [id,
    Object.fromEntries(Object.entries(values).map(([name, key]) => [name, plan.choices[key].value]))]));
  const definitions = Object.values(seed.artifacts.capabilities).map(row => ({ artifact: row.artifact,
    bytes: readPortableBytes(join(verifyPortableArtifact(deployment, row.artifact).dir, "oats.json")) }));
  const build = (subject, workMode, helpers, launchRequest) => {
    const helperPolicy = subject.kind === "helper" ? captureHelperInjectionChoices(plan, definitions) : null;
    const resources = Object.create(null), blocks = [], skills = [], names = new Set(), omissions = [];
    const owner = subject.kind === "persistent" ? subject.soul.sourceArtifact : subject.provider;
    const sourceRoot = verifyPortableArtifact(deployment, owner).dir;
    const definition = subject.kind === "persistent" ? subject.soul.definition : subject.definition.path;
    const soulRoot = join(sourceRoot, dirname(definition));
    resources.body = { owner, path: portable(sourceRoot, join(soulRoot, "AGENTS.md")), kind: "file" };
    const inject = (source, owner, path) => {
      const key = `instruction:${source}`; resources[key] = { owner, path, kind: "file" }; blocks.push({ source, resource: key });
    };
    inject("kernel:oats-portable", bundle, "injects/oats-portable.md");
    inject("kernel:instance-boundary", bundle, "injects/portable-instance-boundary.md");
    inject(`work-mode:${workMode}`, bundle, `injects/${workInjection(workMode)}`);
    const skillTree = (owner, root, tree, label, required = true) => {
      const entries = kernel.skills(tree);
      if (required && !entries.length) throw oatsError("resource-not-found", "a declared skill tree contains no readable skill");
      for (const entry of entries) {
        if (names.has(entry.name)) throw oatsError("needs-configuration", `skill ${entry.name} has multiple sources; an explicit override is required`);
        names.add(entry.name);
        const key = `skill:${label}:${entry.name}`; resources[key] = { owner, path: portable(root, entry.src), kind: "skill" };
        skills.push({ name: entry.name, resource: key });
      }
    };
    const kernelRoot = verifyPortableArtifact(deployment, bundle).dir;
    for (const name of kernelSkills) skillTree(bundle, kernelRoot, join(kernelRoot, "skills", name), "kernel");
    if (existsSync(join(soulRoot, "skills"))) skillTree(owner, sourceRoot, join(soulRoot, "skills"), "soul", false);
    const providerManifests = Object.create(null);
    for (const [id, row] of Object.entries(seed.artifacts.capabilities)) {
      const manifest = manifests.get(id), root = verifyPortableArtifact(deployment, row.artifact).dir;
      const key = `manifest:${id}`; resources[key] = { owner: row.artifact, path: "oats.json", kind: "manifest" }; providerManifests[id] = key;
      for (const path of manifest.skills ?? []) skillTree(row.artifact, root, join(root, path), id);
      if (helperPolicy) {
        const policy = helperPolicy.policies.get(id);
        if (policy.fact) {
          if (policy.resource) {
            resources[policy.resourceKey] = policy.resource;
            blocks.push({ source: policy.source, resource: policy.resourceKey, choice: policy.fact.key });
          } else omissions.push({ source: policy.source, reason: "helper-policy", choice: policy.fact.key });
        }
      } else if (manifest.inject) inject(`capability:${id}`, row.artifact, portable(root, join(root, manifest.inject)));
      for (const [kind, declarations] of [["command", manifest.commands ?? {}], ["hook", kernel.hooks(manifest)]]) {
        for (const [name, value] of Object.entries(declarations)) {
          if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw oatsError("invalid-resolution", "declared executable is not valid text");
          resources[`executable:${id}:${kind}:${name}`] = { owner: row.artifact, path: portable(root, join(root, value.trim().split(/\s+/)[0])), kind: "file" };
        }
      }
    }
    const capturedLaunch = compileCapturedLaunchRequest(launchRequest, { artifacts: seed.artifacts, manifests, settings: effectiveSettings, resources }, kernel);
    return { ...seed, subject, choices: helperPolicy?.choices ?? seed.choices, bindings: seed.bindings ?? {}, messagingChoice: seed.messagingChoice ?? { schemaVersion: 1, enabled: false }, resources, resourceBundles: [bundle], helpers,
      dispatch: { schemaVersion: 1, providerManifests, settingsChoices: plan.settings, launch: capturedLaunch, runtimePackages: [], hostRequirements: [], workTargetInputs: {},
        composition: { schemaVersion: 1, mode: workMode, body: "body", blocks, skills, omissions } } };
  };
  // Preflight EVERY helper before publishing any helper record. Until helpers
  // run their own complete provider/software preparation, inheriting a parent's
  // binding over helper-authored policy would create a usable contradiction.
  const helperPlans = [], helperKeys = new Set();
  for (const [id, row] of Object.entries(seed.artifacts.capabilities)) {
    const root = verifyPortableArtifact(deployment, row.artifact).dir;
    for (const path of manifests.get(id).agents ?? []) {
      const normalized = normalizePackagePath(path);
      if (normalized === undefined) throw oatsError("invalid-declaration", "invalid helper export path");
      const definitionPath = `${normalized === "." ? "" : `${normalized}/`}soul.yaml`;
      const definition = parseConfigData(readFileSync(join(root, definitionPath))).value;
      const authoredPolicy = ["requires", "defaults"].filter((field) => definition[field] && Object.keys(definition[field]).length);
      for (const field of ["knowledge", "teams", "resources"]) if (Object.hasOwn(definition, field)) authoredPolicy.push(field);
      if (authoredPolicy.length) return { record: null, problems: [{ code: "needs-configuration",
        message: `helper has authored ${authoredPolicy.join(", ")} policy requiring dedicated preparation; parent bindings were not inherited`, origins: [] }] };
      const helperMode = definition.work ?? "directory";
      if (!kernel.workModes.includes(helperMode)) throw oatsError("invalid-declaration", "helper work mode is invalid");
      const subject = { kind: "helper", provider: row.artifact, name: definition.name, definition: { owner: row.artifact, path: definitionPath, kind: "file" } };
      const key = `${id}:${definition.name}`;
      if (helperKeys.has(key)) throw oatsError("invalid-declaration", "duplicate helper export name");
      helperKeys.add(key); helperPlans.push({ key, subject, helperMode });
    }
  }
  for (const key of Object.keys(helperLaunches)) if (!helperKeys.has(key)) throw oatsError("helper-not-selected", "helper launch request must name an exact selected helper-map key");
  // Compile EVERY launch request before publishing any helper record. No partial
  // usable helper graph when a later helper's runtime inputs are unsupported.
  const records = helperPlans.map(({ key, subject, helperMode }) => ({ key, record: build(subject, helperMode, {}, helperLaunches[key]) }));
  const record = build(seed.subject, mode, {}, launch), helpers = Object.create(null);
  // Verify every prospective file/owner/witness before publishing ANY member
  // of this graph, including a primary file omitted only for helpers.
  for (const candidate of [...records.map(item => item.record), record]) verifyResolutionInputs(deployment,
    { schemaVersion: 1, id: jsonIntegrity(candidate).value }, { draft: candidate });
  for (const item of records) helpers[item.key] = commitCapturedResolution(deployment, item.record);
  return { record: { ...record, helpers }, problems: [] };
}
