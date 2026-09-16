/** Build retained command/curriculum records from already selected software.
 * Kernel callbacks own existing skill discovery and manifest command semantics. */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { copyTreeSafe } from "./artifact-tree.mjs";
import { treeIntegrity } from "./portable-digest.mjs";
import { retainPortableArtifact, verifyPortableArtifact } from "./portable-artifacts.mjs";
import { commitCapturedResolution } from "./captured-resolutions.mjs";
import { parseConfigData } from "./config-data.mjs";
import { oatsError } from "./errors.mjs";
import { normalizePackagePath } from "./capability-provenance.mjs";

export function completePreparedResources({ seed, plan, manifests, mode, deployment, directory }, kernel) {
  const problems = [];
  for (const [id, manifest] of manifests) {
    if (!Object.hasOwn(seed.artifacts.capabilities, id)) continue;
    if (manifest.layer && seed.bindings?.[manifest.layer]?.capability !== id) problems.push({ code: "provider-not-qualified", message: `provider ${id} needs its binding adapter before complete preparation`, origins: [] });
    const settings = Object.fromEntries(Object.entries(plan.settings[id] ?? {}).map(([name, key]) => [name, plan.choices[key].value]));
    kernel.settings(manifest, settings);
  }
  if (problems.length) return { record: null, problems };
  const snapshot = join(directory, "kernel-resources"); mkdirSync(snapshot); mkdirSync(join(snapshot, "injects"));
  const kernelSkills = ["oats", "oats-config", "oats-packages"];
  const injectionFiles = ["oats.md", "instance-boundary.md", ...kernel.workModes.map((item) => `work-${item}.md`)];
  // Only known kernel resources, never a sweep of the checkout/node_modules,
  // author directories, deployment config or credentials.
  for (const name of kernelSkills) copyTreeSafe(join(kernel.root, "skills", name), join(snapshot, "skills", name));
  for (const file of injectionFiles) copyTreeSafe(join(kernel.root, "injects", file), join(snapshot, "injects", file));
  const bundle = { kind: "resource", integrity: treeIntegrity(snapshot) };
  retainPortableArtifact(deployment, snapshot, bundle);
  const portable = (root, path) => relative(root, path).split(sep).join("/") || ".";
  const build = (subject, workMode, helpers) => {
    const resources = Object.create(null), blocks = [], skills = [], names = new Set(), omissions = [];
    const owner = subject.kind === "persistent" ? subject.soul.sourceArtifact : subject.provider;
    const sourceRoot = verifyPortableArtifact(deployment, owner).dir;
    const definition = subject.kind === "persistent" ? subject.soul.definition : subject.definition.path;
    const soulRoot = join(sourceRoot, dirname(definition));
    resources.body = { owner, path: portable(sourceRoot, join(soulRoot, "AGENTS.md")), kind: "file" };
    const inject = (source, owner, path) => {
      const key = `instruction:${source}`; resources[key] = { owner, path, kind: "file" }; blocks.push({ source, resource: key });
    };
    inject("kernel:oats", bundle, "injects/oats.md");
    inject("kernel:instance-boundary", bundle, "injects/instance-boundary.md");
    inject(`work-mode:${workMode}`, bundle, `injects/work-${workMode}.md`);
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
      if (manifest.inject) {
        if (subject.kind === "helper" && manifest.layer === "knowledge") omissions.push({ source: `capability:${id}`, reason: "helper-knowledge" });
        else inject(`capability:${id}`, row.artifact, portable(root, join(root, manifest.inject)));
      }
      for (const [kind, declarations] of [["command", manifest.commands ?? {}], ["hook", kernel.hooks(manifest)]]) {
        for (const [name, value] of Object.entries(declarations)) {
          if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw oatsError("invalid-resolution", "declared executable is not valid text");
          resources[`executable:${id}:${kind}:${name}`] = { owner: row.artifact, path: portable(root, join(root, value.trim().split(/\s+/)[0])), kind: "file" };
        }
      }
    }
    return { ...seed, subject, bindings: seed.bindings ?? {}, messagingChoice: seed.messagingChoice ?? { schemaVersion: 1, enabled: false }, resources, resourceBundles: [bundle], helpers,
      dispatch: { schemaVersion: 1, providerManifests, settingsChoices: plan.settings, launch: null, runtimePackages: [], hostRequirements: [], workTargetInputs: {},
        composition: { schemaVersion: 1, mode: workMode, body: "body", blocks, skills, omissions } } };
  };
  const helpers = Object.create(null);
  for (const [id, row] of Object.entries(seed.artifacts.capabilities)) {
    const root = verifyPortableArtifact(deployment, row.artifact).dir;
    for (const path of manifests.get(id).agents ?? []) {
      const normalized = normalizePackagePath(path);
      if (normalized === undefined) throw oatsError("invalid-declaration", "invalid helper export path");
      const definitionPath = `${normalized === "." ? "" : `${normalized}/`}soul.yaml`;
      const definition = parseConfigData(readFileSync(join(root, definitionPath))).value;
      // Never inherit the parent's choices over a helper's distinct authored
      // policy. Its own planner integration must satisfy those declarations.
      if ((definition.requires && Object.keys(definition.requires).length) || (definition.defaults && Object.keys(definition.defaults).length)) {
        return { record: null, problems: [{ code: "needs-configuration", message: "helper has its own software policy requiring dedicated preparation", origins: [] }] };
      }
      const helperMode = definition.work ?? "directory";
      if (!kernel.workModes.includes(helperMode)) throw oatsError("invalid-declaration", "helper work mode is invalid");
      const subject = { kind: "helper", provider: row.artifact, name: definition.name, definition: { owner: row.artifact, path: definitionPath, kind: "file" } };
      const key = `${id}:${definition.name}`;
      if (Object.hasOwn(helpers, key)) throw oatsError("invalid-declaration", "duplicate helper export name");
      helpers[key] = commitCapturedResolution(deployment, build(subject, helperMode, {}));
    }
  }
  return { record: build(seed.subject, mode, helpers), problems: [] };
}
