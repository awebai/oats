// Selected-input adapter over EXISTING native aw commands. No account/grant
// protocol, credential copying, private kernel index or second admission store.
import fs from 'node:fs';
import {join} from 'node:path';
import {parseBindingJson,BINDING_WIRE_LIMITS} from './binding-wire.mjs';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
function identityDirectory(home,{required=true}={}){
 const path=join(home,'.aw');
 try{const s=fs.lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||fs.realpathSync(path)!==path)fail('needs-configuration','native identity directory must be physical and local to its selected home');return path;}
 catch(e){if(e.code==='ENOENT'&&!required)return null;if(e.code==='needs-configuration')throw e;fail('needs-configuration','the selected home needs an initialized native aw identity');}
}
/** `run` is the same bounded, argv-only, redacting native runner used by legacy
 * hooks. The execution consumer and each call retain the original snapshots.
 * This function is not callable as a substitute for kernel admission. */
export function runCapturedNative({selected,event,settings,run,env=process.env}){
 const {context,binding,assertCurrent}=selected,{home,name}=context.instance,team=binding.payload.privateTeam?.id;
 let meta=context.priorReceipt===null?null:JSON.parse(JSON.stringify(context.priorReceipt)),invitationToken=null;
 const roots=new Map();
 const nativeIdentity=(dir,options)=>{
  const path=identityDirectory(dir,options);
  if(!path){if(roots.has(join(dir,'.aw')))fail('invalid-binding','native identity directory disappeared during the captured action');return null;}
  const s=fs.lstatSync(path),stamp=`${s.dev}:${s.ino}`,prior=roots.get(path);
  if(prior!==undefined&&prior!==stamp)fail('invalid-binding','native identity directory changed during the captured action');
  roots.set(path,stamp);return path;
 };
 const refusal=(code,message)=>({exitCode:1,output:{...(meta?{meta}:{}),status:'needs-configuration',problems:[{code,message}],warning:`oats-aweb: ${message}; retain the home and any recorded partial effects`}});
 try{
  assertCurrent();
  if(!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(name)||!team)fail('needs-configuration','exact native alias and private-team selection are required');
  if(settings.delivery!=='session')fail('needs-configuration','captured delivery must be session');
  if(binding.payload.wider.length)fail('needs-configuration','selected wider memberships need their explicitly qualified native setup; they were not omitted');
  // A global override may select a different actor even with an exact cwd.
  // Do not clear/replace it or borrow that identity to make setup pass.
  if(env.AWEB_IDENTITY_HOME)fail('needs-configuration','captured setup requires native per-directory identity context, not an external AWEB_IDENTITY_HOME override');
  const call=(args,cwd=home,{secret=false,allowNativeRemoval=false}={})=>{
   assertCurrent();nativeIdentity(cwd,{required:false});
   const out=run(['aw',...args],cwd,45000,{secretSafe:true});
   assertCurrent();
   if(allowNativeRemoval){
    try{fs.lstatSync(join(cwd,'.aw'));nativeIdentity(cwd,{required:false});}catch(e){if(e.code!=='ENOENT')throw e;}
   }else nativeIdentity(cwd,{required:false});
   try{return parseBindingJson(Buffer.from(out),BINDING_WIRE_LIMITS);}catch{if(secret)fail('provider-unavailable','native invitation response is unavailable');fail('provider-unavailable','native command returned no bounded JSON observation');}
  };
  const plain=(args)=>{assertCurrent();nativeIdentity(home);run(['aw',...args],home,60000,{secretSafe:true});assertCurrent();nativeIdentity(home);};
  const observe=()=>{
   nativeIdentity(home);
   const who=call(['--team',team,'whoami','--json']);
   const status=call(['--team',team,'workspace','status','--json']),ws=status.workspace;
   if(who.alias!==name||typeof who.did!=='string'||!/^did:key:[A-Za-z0-9]+$/.test(who.did)||status.selected_team!==team||!ws||ws.alias!==name||ws.workspace_path!==home)fail('needs-configuration','native alias, team and workspace must match the selected instance home');
   if(invitationToken&&who.did.includes(invitationToken))fail('provider-unavailable','native identity response cannot be safely recorded');
   if(meta?.did!==undefined&&meta.did!==who.did)fail('needs-configuration','native identity changed from the recorded setup; explicit reconciliation is required');
   return who.did;
  };
  if(event==='setup'){
   if(!nativeIdentity(home,{required:false}))return{exitCode:0,output:{status:'needs-configuration',problems:[{code:'needs-configuration',message:'use explicit captured spawn with existing native authority in the selected deployment; setup does not provision accounts or teams'}]}};
   observe();return{exitCode:0,output:{status:'ready',problems:[],scope:'native home association only; no account or private-grant attestation'}};
  }
  if(event==='roster'){
   observe();const result=call(['id','team','members','--team-id',team,'--json']);return{exitCode:0,output:result};
  }
  if(event==='spawn'){
   if(meta!==null||nativeIdentity(home,{required:false}))fail('needs-configuration','existing or uncertain native setup requires explicit reconciliation; no duplicate enrollment');
   // Deployment is an explicit retained context, never an ambient root search.
   // Native aw itself decides whether its existing identity may issue an invite.
   const authority=context.executionBinding.deployment;nativeIdentity(authority);
   meta={team,delivery:'session',pending:'invite'};
   const invitation=call(['team','invite','--team-id',team,'--json'],authority,{secret:true});
   if(typeof invitation?.token!=='string'||!invitation.token)fail('provider-unavailable','native invitation returned no token');
   invitationToken=invitation.token;
   meta.pending='join';
   // Native aw mints the child's own identity; OATS never reads/copies a key.
   const joined=call(['team','join',invitation.token,'--name',name,'--json'],home,{secret:true});
   // Never echo server strings or a token disguised as an alias into metadata.
   if(joined?.alias!==name||joined?.team_id!==team)fail('provider-unavailable','native join did not confirm the exact requested alias and team');
   meta={team,alias:name,delivery:'session',pending:'connect'};
   plain(['--team',team,'init','--do-not-touch-agents-md']);
   const did=observe();meta={team,alias:name,delivery:'session',did,pending:'wake-register'};
   plain(['wake','register','--home',home,'--identity-home',join(home,'.aw'),'--delivery','session']);
   meta={team,alias:name,delivery:'session',did};
   return{exitCode:0,output:{meta,env:{AWEB_DELIVERY:'session'},brief:`Comms: your own native aweb identity is ${name} on ${team}. Notification delivery: external (session); registration is durable, not proof of broker delivery or model consumption. Use aw mail/aw chat from this instance home.`}};
  }
  if(event==='retire'){
   if(!meta||meta.alias!==name||meta.team!==team||meta.delivery!=='session'||typeof meta.did!=='string')fail('needs-configuration','recorded owned native identity is required for cleanup; absence is not proof of no effects');
   observe();plain(['wake','deregister','--home',home]);
   const result=call(['--team',team,'workspace','delete',name,'--json'],home,{allowNativeRemoval:true});
   if(result?.alias!==name||typeof result.deleted_at!=='string')fail('provider-unavailable','native self-delete outcome is unconfirmed');
   return{exitCode:0,output:{meta:{...meta,retired:true,aliasReusable:result.alias_released===true},...(result.alias_released===true?{}:{warning:'oats-aweb: workspace deleted; alias release was not confirmed'})}};
  }
  fail('needs-configuration','this captured native entrypoint is unsupported');
 }catch(e){return refusal(['needs-configuration','invalid-binding','authorization-required'].includes(e?.code)?e.code:'provider-unavailable',['needs-configuration','invalid-binding','authorization-required'].includes(e?.code)?e.message:'native action failed or is uncertain');}
}
