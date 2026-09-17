/** One exact action-loading boundary. No current config, lock or marketplace
 * lookup. Core supplies its complete codecs and native host checks. */
import { canonicalJson } from "./portable-values.mjs";
import { validateCapturedAction } from "./captured-action-shape.mjs";
import { verifyResolutionInputs } from "./captured-resolutions.mjs";
import { readApprovalLedger, evaluateCapturedApprovals } from "./artifact-approvals.mjs";
import { composeCapturedInstructions } from "./instruction-composition.mjs";
import { oatsError } from "./errors.mjs";

export function loadCapturedAction({ deployment, resolution, action }, codecs) {
  validateCapturedAction(action);
  const verified = verifyResolutionInputs(deployment, resolution), { record } = verified;
  if (record.capture !== "prepared") throw oatsError("migration-required", "reconstructed dispatch requires the dedicated migration evidence verifier");
  const manifests = new Map(), capabilities = new Map();
  for (const [id, row] of Object.entries(record.artifacts.capabilities)) {
    const root = verified.roots.get(canonicalJson(row.artifact));
    const manifest = codecs.manifest(root);
    if (!manifest || manifest.capability !== id || manifest.version !== row.version) throw oatsError("invalid-resolution", "compiled manifest differs from captured identity/version");
    const settings = Object.fromEntries(Object.entries(record.dispatch.settingsChoices[id] ?? {}).map(([name, key]) => [name, record.choices[key].value]));
    codecs.settings(manifest, settings);
    manifests.set(id, manifest); capabilities.set(id, { id, manifest, settings });
  }
  // Complete static validation applies even to inspection; neither inspection
  // nor input verification is an excuse to accept an unsafe launch recipe.
  if (record.dispatch.launch !== null) codecs.launch(record.dispatch.launch);
  const approvals = evaluateCapturedApprovals({ ...verified, manifests }, readApprovalLedger(deployment).ledger);
  const base = { ...verified, manifests, capabilities, approvals, resolution, deployment };
  if (action.kind === "inspect") return base;
  if (action.kind === "compose") return { ...base, composition: composeCapturedInstructions(verified) };
  let id = action.capability;
  if (action.kind === "operation") id = record.bindings[action.slot]?.capability;
  if (action.namespace !== undefined) {
    const matches = [...manifests].filter(([, manifest]) => manifest.command === action.namespace);
    if (matches.length > 1) throw oatsError("duplicate-namespace", "captured command namespace is ambiguous");
    id = matches[0]?.[0];
  }
  if (typeof id !== "string" || !capabilities.has(id)) throw oatsError("capability-not-selected", "action capability is not selected by this resolution");
  const capability = capabilities.get(id), manifest = capability.manifest;
  let name = action.name, operation;
  if (action.kind === "operation") {
    operation = codecs.operations(manifest).find((entry) => entry.name === name);
    if (!operation) throw oatsError("operation-not-found", "captured provider does not declare this operation");
    name = operation.command;
  }
  const declarations = action.kind === "hook" ? codecs.hooks(manifest) : manifest.commands;
  if (!declarations || !Object.hasOwn(declarations, name)) throw oatsError("command-not-found", "captured capability does not declare this action");
  const approval = approvals.find((entry) => entry.artifact.capability === id);
  if (approval.status !== "approved") throw oatsError("approval-required", "action needs current approval for its exact capability artifact");
  // Provider-owned payload/credential/member qualification is a separate ABI.
  // Until its adapter is supplied, report the missing gate rather than execute
  // using an ambient binding file or treating captured choices as enrollment.
  const invocation = typeof codecs.invocation === "function" ? codecs.invocation(base, action, capability) : undefined;
  const bindings = Object.entries(record.bindings).filter(([, binding]) => binding.capability === id);
  if (bindings.length) {
    if (typeof codecs.bindings !== "function") throw oatsError("provider-not-qualified", "captured provider binding qualification is unavailable");
    codecs.bindings(bindings, capability, record, invocation);
  }
  const missing = codecs.host(capability);
  if (missing.length) throw oatsError("host-requirement-missing", "captured action has unmet host command requirements", missing);
  const spec = declarations[name];
  if (typeof spec !== "string" || !spec.trim() || spec.includes("\0")) throw oatsError("invalid-resolution", "captured executable declaration is not valid text");
  const [script, ...args] = spec.trim().split(/\s+/), file = codecs.executable(manifest, script);
  if (!file) throw oatsError("resource-not-found", "captured executable is absent");
  if (![...verified.resources.values()].includes(file)) throw oatsError("resolution-incomplete", "captured executable is absent from the resource inventory");
  return { ...base, action, capability, operation, executable: { file, args }, ...(invocation ? { invocation } : {}) };
}
