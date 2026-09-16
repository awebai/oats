/** Execute only an approved retained provider command. Preparation does not need
 * a fabricated complete resolution merely to obtain its binding. */
import { spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { canonicalJson } from './portable-values.mjs';
import { objectAt } from './portable-shape.mjs';
import { validateArtifactSet } from './resolution-shape.mjs';
import { verifyPortableArtifact } from './portable-artifacts.mjs';
import { verifyRetainedCapability } from './captured-resolutions.mjs';
import { readApprovalLedger, evaluateCapturedApprovals } from './artifact-approvals.mjs';
import { validateBindingInterface } from './provider-binding.mjs';
import { BINDING_LIMITS, validateBindingRequest, decodeBindingResponse } from './provider-binding-wire.mjs';
import { oatsError } from './errors.mjs';

export function invokeProviderBinding(options,codecs) {
  canonicalJson(options);
  objectAt(options,['deployment','artifacts','capability','phase','settings','input','timeoutMs'],['deployment','artifacts','capability','phase','settings','input']);
  const {deployment,artifacts,capability,phase,settings,input,timeoutMs=30000}=options;
  // Only core's verified action adapter can supply this private transport input;
  // public prospective phase options cannot nominate an arbitrary context file.
  const {invocationContextFile}=codecs;
  if (invocationContextFile !== undefined && (phase !== 'check' || typeof invocationContextFile !== 'string' || !isAbsolute(invocationContextFile))) throw oatsError('invalid-declaration','only captured checks accept an absolute invocation context file');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw oatsError('invalid-declaration','binding timeout must be between 1 and 30000 milliseconds');
  validateArtifactSet(artifacts);
  if (!Object.hasOwn(artifacts.capabilities,capability)) throw oatsError('capability-not-selected','binding provider is not selected');
  const row=artifacts.capabilities[capability],root=verifyPortableArtifact(deployment,row.artifact).dir;
  const manifest=verifyRetainedCapability(root,artifacts,capability,codecs.manifest(root));
  const binding=validateBindingInterface(manifest);
  if (!binding) throw oatsError('provider-not-qualified','provider has no binding interface');
  const request=validateBindingRequest({schemaVersion:1,phase,slot:manifest.layer,capability,settings,input});
  codecs.settings(manifest,settings);
  const selected={record:{artifacts:{...artifacts,capabilities:{[capability]:row}}},manifests:new Map([[capability,manifest]])};
  const approval=evaluateCapturedApprovals(selected,readApprovalLedger(deployment).ledger)[0];
  if (approval.status !== 'approved') throw oatsError('approval-required','provider codec requires current exact-artifact approval');
  if (codecs.host({manifest}).length) throw oatsError('host-requirement-missing','provider codec has unmet host requirements');
  const spec=manifest.commands[binding[phase]];
  const [script,...args]=spec.trim().split(/\s+/),file=codecs.executable(manifest,script);
  if (!file) throw oatsError('resource-not-found','provider codec executable is unavailable');
  const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>! /^(OATS_|OAS_|PI_)/.test(key)));
  Object.assign(environment,{OATS_CAPABILITY:capability,OATS_CAPABILITY_ROOT:root,OATS_SETTINGS:canonicalJson(settings,BINDING_LIMITS),
    ...(invocationContextFile ? {OATS_INVOCATION_CONTEXT_FILE:invocationContextFile} : {})});
  let result;
  try {
    result=spawnSync(process.execPath,[file,...args],{cwd:root,env:environment,input:canonicalJson(request,BINDING_LIMITS),
      timeout:timeoutMs,killSignal:'SIGKILL',maxBuffer:BINDING_LIMITS.maxBytes,stdio:['pipe','pipe','pipe'],shell:false});
  } catch { throw oatsError('provider-unavailable','provider codec could not execute'); }
  if (result.error || result.signal || result.status !== 0) throw oatsError('provider-unavailable','provider codec did not complete successfully');
  const response=decodeBindingResponse(result.stdout,request);
  if (!response.ok) throw oatsError(response.error.code,'provider binding phase refused');
  return response.result;
}
