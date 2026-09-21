/** Explicit portable launch input, not a current launch-config/model resolver.
 * OATS-managed entrypoints are retained; external host tools are explicitly
 * selected/preflighted, not forced into a new capability layer. */
import { isAbsolute, resolve } from 'node:path';
import { canonicalJson } from './portable-values.mjs';
import { objectAt, stringAt } from './portable-shape.mjs';
import { isMaterializedCapabilityId } from './capability-provenance.mjs';
import { oatsError } from './errors.mjs';
import { PI_SDK_HOST, validatePiHostRecipe } from './pi-sdk-host.mjs';

export function validateCapturedLaunchRequest(value, validateConfig) {
  canonicalJson(value,{maxBytes:128*1024,maxDepth:16,maxEntries:4096});
  objectAt(value,['runtime','executable','args','env','model','yolo'],['runtime','executable','args','env','model','yolo']);
  if(typeof value.executable==='string'){
    stringAt(value.executable,'/launch/executable');
    if(!isAbsolute(value.executable)||resolve(value.executable)!==value.executable||value.executable.includes('\0'))throw oatsError('invalid-declaration','host launch executable must be explicit normalized absolute text');
  }else{
    objectAt(value.executable,['capability','command'],['capability','command']);
    if(!isMaterializedCapabilityId(value.executable.capability))throw oatsError('invalid-declaration','managed launch entrypoint must name a selected capability');
    stringAt(value.executable.command,'/launch/executable/command');
  }
  stringAt(value.model,'/launch/model');
  if(typeof value.yolo!=='boolean')throw oatsError('invalid-declaration','captured launch requires explicit yolo');
  validateConfig('captured',{...value,executable:'captured-resource'},'explicit launch request');
  if(value.executable===PI_SDK_HOST || value.args?.includes('--oats-pi-host'))validatePiHostRecipe(value);
  // All kernel/provider invocation aliases remain kernel-owned on this new
  // surface. The legacy launch-config validator has a narrower historical list.
  for(const name of Object.keys(value.env))if(/^(OATS_|PI_AGENT_|OAS_)/.test(name)||name==='PI_AGENTS_ROOT')throw oatsError('invalid-declaration','launch environment cannot override captured authority');
  return value;
}

export function compileCapturedLaunchRequest(request,{artifacts,manifests,settings,resources},kernel) {
  if(request===undefined)return null;
  validateCapturedLaunchRequest(request,kernel.validateLaunchConfig);
  const providers=[...manifests].filter(([id])=>Object.hasOwn(artifacts.capabilities,id)).map(([id,manifest])=>({id,manifest,settings:settings[id]}));
  // `ifInstalled: true` rows constrain a package that may legitimately be absent (a version floor
  // for an ambient extension, if any). Captured preparation retains no ambient packages, so such a
  // row is satisfied by absence — treating it as a hard requirement made a Pi launch with aweb
  // `delivery: session` unpublishable (second-operator finding, 2026-09-21). Hard rows refuse
  // through the preparation problem shape, naming the capability and package; the remedy text is
  // the manifest's own `install` string — declared data, never free text.
  // Resolve each applicable row back to its declaration, honouring the same `when` predicate the
  // kernel's requirement selection uses, so two rows for one package (channel vs session) stay distinct.
  const holds=(provider,row)=>!row.when || Object.entries(row.when).every(([k,v])=>String(provider.settings?.[k] ?? '')===String(v));
  const declarationOf=(row)=>{const provider=providers.find(p=>p.id===row.capability);
    return {provider,declared:provider?.manifest?.requires?.find(r=>r && typeof r==='object' && r.runtime===request.runtime && r.package===row.package && holds(provider,r))};};
  const required=kernel.runtimeRequirements(request.runtime,providers).filter(row=>declarationOf(row).declared?.ifInstalled!==true);
  if(required.length){
    const error=oatsError('needs-configuration','runtime package requirements need retained runtime roots and a qualified loader; no ambient package discovery was used');
    error.problems=required.map(row=>{
      const {provider,declared}=declarationOf(row);
      return {code:'needs-configuration',message:`${request.runtime} launch requires runtime package ${row.package}, which captured preparation has not retained`,capability:row.capability,
        ...(provider?.manifest?.layer?{slot:provider.manifest.layer}:{}),runtime:request.runtime,package:row.package,...(typeof declared?.install==='string'?{install:declared.install}:{})};
    });
    throw error;
  }
  const base={version:1,runtime:request.runtime,args:request.args,env:request.env,model:request.model,yolo:request.yolo,
    hooks:{launch:{},env:{},contributions:[],pending:true},prompt:{kind:'task-file',file:'TASK.md'}};
  if(typeof request.executable==='string')return {...base,executable:request.executable,executableResolvedFrom:'explicit-host'};
  const {capability:id,command}=request.executable,manifest=manifests.get(id);
  if(!Object.hasOwn(artifacts.capabilities,id)||!manifest?.commands||!Object.hasOwn(manifest.commands,command))throw oatsError('capability-not-selected','launch entrypoint is not declared by a selected capability');
  const key=`executable:${id}:command:${command}`;
  if(!Object.hasOwn(resources,key)||resources[key].kind!=='file')throw oatsError('resolution-incomplete','launch entrypoint lacks a retained executable resource');
  const [, ...declaredArgs]=manifest.commands[command].trim().split(/\s+/);
  return {...base,executable:'captured-resource',executableResource:key,entrypoint:{capability:id,command},args:[...declaredArgs,...request.args]};
}
