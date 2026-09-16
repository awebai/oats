/** Bounded provider wire data. No provider model, precedence or native execution. */
import { canonicalJson, parseStrictJson } from './portable-values.mjs';
import { objectAt, stringAt, versionAt } from './portable-shape.mjs';
import { validateOrigin, validateProviderBinding, validateMessagingChoice, validateCapturedChoices } from './resolution-shape.mjs';
import { FUNDAMENTAL_SLOTS } from './portable-policy.mjs';
import { isMaterializedCapabilityId } from './capability-provenance.mjs';
import { BINDING_PHASES } from './provider-binding.mjs';
import { validateWorkspaceIdentity } from './portable-identity.mjs';
import { resolveChoices } from './portable-choices.mjs';
import { oatsError } from './errors.mjs';

export const BINDING_LIMITS = Object.freeze({maxBytes:1024*1024,maxDepth:32,maxEntries:16384});
export const BINDING_PROBLEMS = Object.freeze(['needs-configuration','requirement-conflict','invalid-binding','authorization-required','host-requirement-missing','provider-unavailable','provider-not-qualified']);
const fail = () => { throw oatsError('invalid-binding-output','provider returned invalid binding data'); };
const same = (a,b) => canonicalJson(a) === canonicalJson(b);
const roleKinds = {soul:['soul-requirement','soul-default'],workspace:['workspace-default'],adoption:['import-adoption'],operator:['operator']};
const pointer = key => typeof key === 'string' && /^(?:\/(?:[^~]|~[01])*)+$/.test(key);
export const bindingField = (key,slot) => pointer(key) && key.startsWith(`/bindings/${slot}/`) && key.length > `/bindings/${slot}/`.length;
function problem(value) {
  objectAt(value,['code','message'],['code']);
  if (!BINDING_PROBLEMS.includes(value.code)) fail();
  if (value.message !== undefined) stringAt(value.message,'/message',{empty:true});
  return {code:value.code}; // Free text never leaves the provider boundary.
}
function context(value) {
  objectAt(value,value?.kind === 'workspace' ? ['kind','identity','observation'] : ['kind','key'],value?.kind === 'workspace' ? ['kind','identity','observation'] : ['kind','key']);
  if (value.kind === 'workspace') { validateWorkspaceIdentity(value.identity); validateOrigin(value.observation); }
  else if (value.kind === 'standalone') { if (value.key !== null) stringAt(value.key,'/context/key'); }
  else fail();
}
export function validateBindingRequest(request) {
  canonicalJson(request,BINDING_LIMITS);
  objectAt(request,['schemaVersion','phase','slot','capability','settings','input'],['schemaVersion','phase','slot','capability','settings','input']);
  versionAt(request.schemaVersion);
  if (!BINDING_PHASES.includes(request.phase) || !FUNDAMENTAL_SLOTS.includes(request.slot) || !isMaterializedCapabilityId(request.capability)) fail();
  objectAt(request.settings,null,[]); const input=request.input;
  if (request.phase === 'normalize') {
    objectAt(input,['declarations','context'],['declarations','context']);
    if (!Array.isArray(input.declarations)) fail();
    for (const declaration of input.declarations) {
      objectAt(declaration,['kind','value','origin','origins'],['kind','value','origin','origins']);
      if (!Object.hasOwn(roleKinds,declaration.kind)) fail();
      validateOrigin(declaration.origin); objectAt(declaration.origins,null,[]);
      if (!roleKinds[declaration.kind].includes(declaration.origin.kind)) fail();
      for (const [key,origin] of Object.entries(declaration.origins)) {
        if (key !== '' && !pointer(key)) fail();
        validateOrigin(origin);
        if (!roleKinds[declaration.kind].includes(origin.kind) || !same(origin.document,declaration.origin.document)) fail();
      }
    }
  } else if (request.phase === 'bind') {
    objectAt(input,['model','choices','context'],['model','choices','context']);
    validateCapturedChoices(input.choices);
    for (const key of Object.keys(input.choices)) if (!bindingField(key,request.slot)) fail();
  } else {
    objectAt(input,['binding','context','action'],['binding','context','action']);
    validateProviderBinding(input.binding); objectAt(input.action,null,['kind']);
    if (input.binding.capability !== request.capability) fail();
  }
  context(input.context);
  return request;
}
function witnessed(origin,declarations) {
  validateOrigin(origin);
  return declarations.some(declaration => roleKinds[declaration.kind].includes(origin.kind)
    && [declaration.origin,...Object.values(declaration.origins)].some(candidate => {
      const {kind:_,...a}=origin, {kind:__,...b}=candidate;
      return same(a,b);
    }));
}
export function decodeBindingResponse(bytes,request) {
  let response;
  try {
    validateBindingRequest(request);
    response=parseStrictJson(bytes,BINDING_LIMITS);
    objectAt(response,response?.ok === true ? ['schemaVersion','phase','slot','capability','ok','result'] : ['schemaVersion','phase','slot','capability','ok','error'],
      response?.ok === true ? ['schemaVersion','phase','slot','capability','ok','result'] : ['schemaVersion','phase','slot','capability','ok','error']);
    for (const key of ['schemaVersion','phase','slot','capability']) if (response[key] !== request[key]) fail();
    if (response.ok === false) return {ok:false,error:problem(response.error)};
    if (response.ok !== true) fail();
    const result=response.result;
    if (request.phase === 'normalize') {
      objectAt(result,['requirements','candidates','model'],['requirements','candidates','model']);
      if (!Array.isArray(result.requirements) || !Array.isArray(result.candidates)) fail();
      for (const entry of [...result.requirements,...result.candidates]) {
        if (!bindingField(entry.key,request.slot) || !witnessed(entry.origin,request.input.declarations)) fail();
      }
      for (const requirement of result.requirements) if (requirement.origin.kind !== 'soul-requirement') fail();
      for (const candidate of result.candidates) if (candidate.kind !== candidate.origin.kind) fail();
      // Reuse the sole entry codec/solver; conflicts are data for the combined plan.
      resolveChoices(result);
      return {ok:true,result};
    }
    if (request.phase === 'bind') {
      const keys=['payloadContract','payloadVersion','payload','credentialRefs','provenance'];
      objectAt(result,request.slot === 'messaging' ? [...keys,'messagingChoice'] : keys,request.slot === 'messaging' ? [...keys,'messagingChoice'] : keys);
      const {messagingChoice,...fields}=result;
      const binding=validateProviderBinding({schemaVersion:1,capability:request.capability,...fields});
      // Source read/ownership provenance may live in the opaque normalized model;
      // preparation validates that additional provenance against its original input.
      if (request.slot === 'messaging') validateMessagingChoice(messagingChoice,{bindings:{messaging:binding},context:request.input.context});
      return {ok:true,result:{binding,...(request.slot === 'messaging' ? {messagingChoice} : {})}};
    }
    objectAt(result,['status','problems'],['status','problems']);
    if (!['ready','needs-configuration','authorization-required','unavailable'].includes(result.status) || !Array.isArray(result.problems)) fail();
    const problems=result.problems.map(problem);
    if (result.status === 'ready' && problems.length) fail();
    return {ok:true,result:{status:result.status,problems}};
  } catch { fail(); }
}
export function bindingOriginWitnessed(origin,declarations) { return witnessed(origin,declarations); }
