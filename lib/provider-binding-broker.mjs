/** Execute only an approved retained provider command. Preparation does not need
 * a fabricated complete resolution merely to obtain its binding. */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './portable-values.mjs';
import { objectAt } from './portable-shape.mjs';
import { validateArtifactSet } from './resolution-shape.mjs';
import { verifyPortableArtifact } from './portable-artifacts.mjs';
import { verifyRetainedCapability, verifyResolutionInputs } from './captured-resolutions.mjs';
import { buildCapturedInvocationContext } from './captured-invocation-context.mjs';
import { readApprovalLedger, evaluateCapturedApprovals } from './artifact-approvals.mjs';
import { validateBindingInterface } from './provider-binding.mjs';
import { BINDING_LIMITS, validateBindingRequest, decodeBindingResponse } from './provider-binding-wire.mjs';
import { oatsError } from './errors.mjs';
import { providerReasons } from './provider-reasons.mjs';

// Same kernel-owned CLI locator as lifecycle hooks; never caller env or PATH.
const CLI_BIN=fileURLToPath(new URL('../bin/oats.mjs',import.meta.url));

export function invokeProviderBinding(options,codecs) {
  canonicalJson(options);
  objectAt(options,['deployment','artifacts','capability','phase','settings','input','timeoutMs'],['deployment','artifacts','capability','phase','settings','input']);
  const {deployment,artifacts,capability,phase,settings,input,timeoutMs=30000}=options;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw oatsError('invalid-declaration','binding timeout must be between 1 and 30000 milliseconds');
  validateArtifactSet(artifacts);
  if (!Object.hasOwn(artifacts.capabilities,capability)) throw oatsError('capability-not-selected','binding provider is not selected');
  const row=artifacts.capabilities[capability],root=verifyPortableArtifact(deployment,row.artifact).dir;
  const manifest=verifyRetainedCapability(root,artifacts,capability,codecs.manifest(root));
  const binding=validateBindingInterface(manifest);
  if (!binding) throw oatsError('provider-not-qualified','provider has no binding interface');
  const request=validateBindingRequest({schemaVersion:1,phase,slot:manifest.layer,capability,settings,input});
  if (phase === 'check' && input.invocation !== undefined) {
    // Public check callers cannot turn a merely shape-valid projection into
    // authority. Re-derive it from the referenced retained record/current target.
    const verified=verifyResolutionInputs(deployment,input.invocation.executionBinding.resolution),record=verified.record;
    if (record.capture !== 'prepared') throw oatsError('migration-required','captured check cannot use unverified reconstructed authority');
    const actual=buildCapturedInvocationContext({loaded:{...verified,deployment,resolution:input.invocation.executionBinding.resolution,capability:{id:capability}},
      action:input.action,instance:input.invocation.instance === null ? null : Object.fromEntries(['home','work','name','agent'].map(key=>[key,input.invocation.instance[key]])),
      intent:input.invocation.intent,priorReceipt:input.invocation.priorReceipt});
    const effective=Object.fromEntries(Object.entries(record.dispatch.settingsChoices[capability] ?? {}).map(([name,key])=>[name,record.choices[key].value]));
    if (canonicalJson(actual)!==canonicalJson(input.invocation) || canonicalJson(record.artifacts)!==canonicalJson(artifacts)
      || !record.bindings[manifest.layer] || canonicalJson(record.bindings[manifest.layer])!==canonicalJson(input.binding)
      || canonicalJson(effective)!==canonicalJson(settings)) throw oatsError('invalid-resolution','provider check invocation differs from retained authority');
  }
  codecs.settings(manifest,settings);
  const selected={record:{artifacts:{...artifacts,capabilities:{[capability]:row}}},manifests:new Map([[capability,manifest]])};
  const approval=evaluateCapturedApprovals(selected,readApprovalLedger(deployment).ledger)[0];
  if (approval.status !== 'approved') throw oatsError('approval-required','provider codec requires current exact-artifact approval');
  if (codecs.host({manifest}).length) throw oatsError('host-requirement-missing','provider codec has unmet host requirements');
  const spec=manifest.commands[binding[phase]];
  const [script,...args]=spec.trim().split(/\s+/),file=codecs.executable(manifest,script);
  if (!file) throw oatsError('resource-not-found','provider codec executable is unavailable');
  const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>! /^(OATS_|OAS_|PI_)/.test(key)));
  Object.assign(environment,{OATS_CAPABILITY:capability,OATS_CAPABILITY_ROOT:root,OATS_SETTINGS:canonicalJson(settings,BINDING_LIMITS),OATS_CLI_BIN:realpathSync(CLI_BIN)});
  let result;
  try {
    result=spawnSync(process.execPath,[file,...args],{cwd:root,env:environment,input:canonicalJson(request,BINDING_LIMITS),
      timeout:timeoutMs,killSignal:'SIGKILL',maxBuffer:BINDING_LIMITS.maxBytes,stdio:['pipe','pipe','pipe'],shell:false});
  } catch { throw oatsError('provider-unavailable','provider codec could not execute'); }
  if (result.error || result.signal || result.status !== 0) throw oatsError('provider-unavailable','provider codec did not complete successfully');
  const response=decodeBindingResponse(result.stdout,request,{reasons:providerReasons(manifest)});
  if (!response.ok) throw oatsError(response.error.code,response.error.message ?? 'provider binding phase refused');
  return response.result;
}
