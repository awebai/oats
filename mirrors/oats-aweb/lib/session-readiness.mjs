// Capability-owned operational readiness for the existing HOME delivery route.
// This is not human-account delegation, private-grant proof or model completion.
import {execFileSync} from 'node:child_process';
import {isAbsolute,resolve} from 'node:path';
import {BINDING_WIRE_LIMITS,parseBindingJson} from './binding-wire.mjs';
import {sameInvocationJson as same} from './invocation-shape.mjs';
import {validateAwebBinding,validateAwebInvocationContext} from './portable-binding.mjs';
// 0.24.1 supplies HOME custody; 0.24.2 also ships the required public projection
// and same-kernel codec CLI locator. Source presence is not a released version.
export const HOME_ROUTE_KERNEL_FLOOR='0.24.2';
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const missing=message=>({status:'needs-configuration',problems:[{code:'needs-configuration',message}]});
const error=()=>{throw Object.assign(new Error('selected kernel observation unavailable'),{code:'provider-unavailable'});};
/** Preserve native HOME/profile/auth/Git; remove only the invoking instance's
 * OATS selectors so a read-only query cannot accidentally target its parent. */
export function kernelQueryEnvironment(inherited){
  const env={...inherited};
  for(const key of Object.keys(env))if(/^(OATS_(?!HOME_DIR$)|OAS_|PI_AGENT_)/.test(key)||key==='PI_AGENTS_ROOT')delete env[key];
  return env;
}
export function kernelMeetsHomeRouteFloor(version){
  if(typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version))return false;
  const parts=version.split('.').map(Number),floor=HOME_ROUTE_KERNEL_FLOOR.split('.').map(Number);if(!parts.every(Number.isSafeInteger))return false;
  for(let i=0;i<3;i++)if(parts[i]!==floor[i])return parts[i]>floor[i];
  return true;
}
/** Use the caller-owned CLI location, never search PATH or import private kernel
 * indexes. Binding execution must receive the same OATS_CLI_BIN as hooks. */
export function querySelectedKernel(args,{env=process.env}={}){
  const cli=env.OATS_CLI_BIN;
  if(typeof cli!=='string'||!isAbsolute(cli)||resolve(cli)!==cli||cli.includes('\0'))error();
  let bytes;
  try{bytes=execFileSync(process.execPath,[cli,...args],{env:kernelQueryEnvironment(env),timeout:10000,maxBuffer:BINDING_WIRE_LIMITS.bytes,stdio:['ignore','pipe','pipe']});}catch{error();}
  try{return parseBindingJson(bytes,BINDING_WIRE_LIMITS);}catch{error();}
}
/** Reads only public version/retained selection. A missing profile projection
 * stays explicit; no source default, mutable home label or runtime guess. */
export function assessCapturedSessionReadiness({binding,invocation,settings},{query=querySelectedKernel,env=process.env}={}){
  if(!binding||!invocation)return missing('selected binding and inline captured invocation are required');
  validateAwebBinding(binding);validateAwebInvocationContext(invocation,binding);
  if(!invocation.instance)return missing('an explicit captured instance home is required');
  if(binding.payload.privateTeam===null)return missing('an explicit private-team binding is required');
  if(settings.delivery!=='session')return missing('captured messaging requires explicit delivery: session');
  if(binding.payload.wider.length)return missing('selected wider memberships need their explicitly qualified native setup; they were not omitted');
  let version,observed;
  try{version=query(['--version','--json'],{env});}catch{return missing('caller-owned OATS_CLI_BIN and readable kernel version are required');}
  if(version?.schemaVersion!==1||version?.name!=='@awebai/oats'||!kernelMeetsHomeRouteFloor(version.version))return missing('oats >=0.24.2 is required for captured HOME custody and retained runtime inspection');
  const b=invocation.executionBinding;
  try{observed=query(['inspect','--deployment',b.deployment,'--resolution',b.resolution.id,'--json'],{env});}catch{return missing('the exact retained runtime profile must be readable');}
  if(observed?.schemaVersion!==1||observed?.ok!==true||!same(observed.result?.resolution,b.resolution))return missing('the kernel must report the exact retained resolution');
  const launch=observed.result.launchSelection;
  if(!obj(launch)||Object.keys(launch).some(k=>!['runtime','model'].includes(k))||!Object.hasOwn(launch,'model')||(launch.model!==null&&(typeof launch.model!=='string'||!launch.model.trim())))return missing('a retained launchSelection runtime/model observation is required');
  if(launch.runtime==='pi')return missing('Pi strict print does not support session input; retain messaging and configure an input-capable profile');
  if(!['claude','codex'].includes(launch.runtime))return missing('a supported input-capable ordinary Claude/Codex profile is required');
  return {status:'ready',problems:[]};
}
