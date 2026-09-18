/** Exact capability-local helper instruction facts. This is a caller of the
 * existing resolver, never a second authority/order or provider-policy engine. */
import { canonicalJson, parseStrictJson } from './portable-values.mjs';
import { bytesIntegrity } from './portable-digest.mjs';
import { pointerKey } from './portable-shape.mjs';
import { normalizePackagePath } from './capability-provenance.mjs';
import { resolveChoices } from './portable-choices.mjs';
import { validateCapabilityInputDeclarations } from './capability-inputs.mjs';
import { oatsError } from './errors.mjs';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const prefix = '/helpers/injections/';
export const helperInjectionChoiceKey = id => `${prefix}${pointerKey(id)}`;

/** artifact/bytes are exact selected manifest inputs, not annotated objects. */
export function helperInjectionFact({ artifact, bytes }) {
  const manifest = validateCapabilityInputDeclarations(parseStrictJson(bytes));
  if (artifact.kind !== 'capability' || manifest.capability !== artifact.capability) throw oatsError('invalid-resolution', 'helper policy manifest owner differs from selected artifact');
  if (!Object.hasOwn(manifest, 'helperInjection')) return { manifest, fact: null, resource: null };
  const policy = manifest.helperInjection, source = `capability:${artifact.capability}`, key = helperInjectionChoiceKey(artifact.capability);
  let path = null;
  if (policy.mode === 'inherit') {
    path = normalizePackagePath(manifest.inject);
    if (typeof manifest.inject !== 'string' || path === undefined || path === '.') throw oatsError('needs-configuration', 'helper inherit needs its own declared injection file');
  } else if (policy.mode === 'file') path = policy.path;
  const resourceKey = `instruction:${source}`;
  const origin = { kind: 'source-export', document: { kind: 'artifact', owner: artifact, path: 'oats.json', integrity: bytesIntegrity(bytes) }, pointer: '/helperInjection' };
  return { manifest, source, resourceKey, resource: path === null ? null : { owner: artifact, path, kind: 'file' },
    fact: { key, kind: 'equals', value: path === null ? null : resourceKey, origin } };
}

export function captureHelperInjectionChoices(plan, definitions) {
  const policies = new Map(), requirements = [...plan.requirements];
  for (const definition of definitions) {
    const policy = helperInjectionFact(definition), id = definition.artifact.capability;
    if (policies.has(id)) throw oatsError('invalid-resolution', 'duplicate helper policy owner');
    policies.set(id, policy);
    if (!policy.fact && policy.manifest.inject) throw oatsError('needs-configuration', 'new helper injection requires an explicit capability policy');
    if (policy.fact) requirements.push(policy.fact);
  }
  const resolved = resolveChoices({ requirements, candidates: plan.candidates });
  if (resolved.status !== 'resolved') throw oatsError(resolved.status === 'conflict' ? 'requirement-conflict' : 'needs-configuration', 'helper policy conflicts with captured instruction choices', resolved.problems);
  return { choices: resolved.choices, policies };
}

/** Verify BOTH directions. Read-only verification permits literal legacy
 * evidence; publication must explicitly disallow new legacy/missing-policy mint.
 * Existing resource verification still proves physical containment/kind. */
export function verifyHelperInjectionPolicies(record, definitions, { publishing = false } = {}) {
  const helper = record.subject.kind === 'helper', composition = record.dispatch.composition;
  const expected = new Map(), selected = new Set();
  for (const definition of definitions) {
    const policy = helperInjectionFact(definition), id = definition.artifact.capability;
    if (selected.has(id) || !record.artifacts.capabilities[id] || !same(record.artifacts.capabilities[id].artifact, definition.artifact)) throw oatsError('invalid-resolution', 'helper policy inputs differ from selected artifacts');
    selected.add(id);
    if (!helper) continue;
    if (publishing && !policy.fact && policy.manifest.inject) throw oatsError('needs-configuration', 'new helper record lacks an explicit injection policy');
    if (!policy.fact) continue;
    const { fact, source, resource, resourceKey } = policy, choice = record.choices[fact.key];
    expected.set(fact.key, fact);
    if (!choice || !same(choice.value, fact.value) || !choice.constraints.some(entry => entry.kind === fact.kind && same(entry.value, fact.value) && same(entry.origin, fact.origin))) throw oatsError('resolution-incomplete', 'helper injection lacks its exact retained manifest witness');
    const block = composition?.blocks.find(entry => entry.source === source), omission = composition?.omissions.find(entry => entry.source === source);
    if (resource) {
      if (omission || !block || block.choice !== fact.key || block.resource !== resourceKey || !record.resources[resourceKey] || !same(record.resources[resourceKey], resource)) throw oatsError('invalid-resolution', 'helper instruction block differs from declared owner/file');
    } else if (block || !omission || omission.reason !== 'helper-policy' || omission.choice !== fact.key) throw oatsError('invalid-resolution', 'helper omission differs from explicit capability policy');
  }
  if (selected.size !== Object.keys(record.artifacts.capabilities).length) throw oatsError('resolution-incomplete', 'helper policy manifest inputs are incomplete');
  const isPolicyOrigin = origin => origin?.kind === 'source-export' && (origin.pointer === '/helperInjection' || origin.pointer?.startsWith('/helperInjection/'));
  for (const [key, choice] of Object.entries(record.choices)) {
    if (key.startsWith(prefix) && !expected.has(key)) throw oatsError('invalid-resolution', 'helper policy choice lacks an applicable declaration');
    for (const entry of [...choice.constraints, ...choice.considered]) if (isPolicyOrigin(entry.origin)) {
      const fact = expected.get(key);
      if (!fact || entry.kind !== 'equals' || !same(entry.value, fact.value) || !same(entry.origin, fact.origin)) throw oatsError('invalid-resolution', 'helper manifest witness cannot justify another choice or owner');
    }
    if (isPolicyOrigin(choice.selectedBy) && (!expected.has(key) || !same(choice.selectedBy, expected.get(key).origin))) throw oatsError('invalid-resolution', 'helper selected origin differs from its declaration');
  }
  const ownSource = fact => `capability:${fact.origin.document.owner.capability}`;
  for (const block of composition?.blocks ?? []) if (block.choice?.startsWith(prefix)) {
    const fact = expected.get(block.choice);
    if (!fact || fact.value === null || block.source !== ownSource(fact) || block.resource !== fact.value) throw oatsError('invalid-resolution', 'helper instruction witness cannot control another contribution');
  }
  for (const omission of composition?.omissions ?? []) {
    if (publishing && omission.reason === 'helper-knowledge') throw oatsError('needs-configuration', 'new publication cannot mint legacy slot-based helper omissions');
    if (omission.reason === 'helper-policy') {
      const fact = expected.get(omission.choice);
      if (!helper || !fact || fact.value !== null || omission.source !== ownSource(fact)) throw oatsError('invalid-resolution', 'helper omission lacks its declared own policy');
    }
  }
  // A missing/non-policy choice is not a way around capability ownership.
  // Above we prove each declared contribution's exact file/omission; here every
  // new capability contribution must point back to that owner's proved fact.
  // Literal historical read/reuse and primary composition stay unchanged.
  if (helper && publishing) for (const entry of [...(composition?.blocks ?? []), ...(composition?.omissions ?? [])]) {
    if (!entry.source.startsWith('capability:')) continue;
    const fact = expected.get(helperInjectionChoiceKey(entry.source.slice('capability:'.length)));
    if (!fact || entry.choice !== fact.key) throw oatsError('invalid-resolution', 'new helper capability contribution lacks its declared own policy');
  }
}
