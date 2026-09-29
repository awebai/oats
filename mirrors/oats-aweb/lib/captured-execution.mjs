// Execution-only consumption of the kernel's selected private snapshots.
// This establishes correspondence/custody, NOT native human/team authority.
// No kernel index, source checkout, ambient team/root, or credential is read.
import fs from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import {parseBindingJson,BINDING_WIRE_LIMITS} from './binding-wire.mjs';
import {INVOCATION_LIMITS,sameInvocationJson as same} from './invocation-shape.mjs';
import {validateAwebBinding,validateAwebInvocationContext} from './portable-binding.mjs';
const CAPABILITY='oats.aweb';
const RECEIPT_LIMITS={bytes:256*1024,depth:32,entries:16384};
const markers=['OATS_BINDING_FILE','OATS_INVOCATION_CONTEXT_FILE','OATS_SOURCE_RECEIPT_FILE'];
const invalid=()=>{throw Object.assign(new Error('invalid captured aweb execution input'),{code:'invalid-binding'});};
const absentAuthority=()=>{throw Object.assign(new Error('captured aweb action requires an admitted instance intent'),{code:'authorization-required'});};
const absolute=p=>typeof p==='string'&&!p.includes('\0')&&isAbsolute(p)&&resolve(p)===p;
const keys=(value,names)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(k=>Object.hasOwn(value,k));
const statKey=s=>['dev','ino','size','mtimeNs','ctimeNs'].map(k=>String(s[k])).join(':');
function physical(file){
  if(!absolute(file))invalid();
  for(let p=file;;p=dirname(p)){
    const s=fs.lstatSync(p,{bigint:true});
    if(s.isSymbolicLink()||(p!==file&&!s.isDirectory()))invalid();
    if(dirname(p)===p)return s;
  }
}
/** Pin the physical named file to its open descriptor BEFORE every bounded
 * read, including when an ancestor was redirected only during open(). */
function snapshot(file,limits){
  let fd;
  try{
    physical(file);
    const uid=typeof process.getuid==='function'?BigInt(process.getuid()):null;
    const privateFile=s=>s.isFile()&&s.nlink===1n&&s.size<=BigInt(limits.bytes)&&(s.mode&0o7777n)===0o600n&&(uid===null||s.uid===uid);
    const before=fs.lstatSync(file,{bigint:true});
    if(!privateFile(before)||typeof fs.constants.O_NOFOLLOW!=='number'||typeof fs.constants.O_NONBLOCK!=='number')invalid();
    fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const check=()=>{
      physical(file);const named=fs.lstatSync(file,{bigint:true}),opened=fs.fstatSync(fd,{bigint:true});
      if(!privateFile(named)||!privateFile(opened)||statKey(named)!==statKey(before)||statKey(opened)!==statKey(named))invalid();
    };
    check();const bytes=Buffer.alloc(Number(before.size));
    for(let n=0;n<bytes.length;){check();const count=fs.readSync(fd,bytes,n,Math.min(32768,bytes.length-n),n);if(!count)invalid();n+=count;}
    check();return {value:parseBindingJson(bytes,limits),identity:statKey(before)};
  }catch{invalid();}finally{if(fd!==undefined)fs.closeSync(fd);}
}
function freeze(value){if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
function validateSourceReceipt(receipt,context,binding){
  if(!keys(receipt,['schemaVersion','kind','home','work','context','agent','instance','sourceIdentity','role','executionBinding','responsibleHuman','binding']))invalid();
  const i=context.instance;
  if(!i||receipt.schemaVersion!==1||receipt.kind!==context.subject.kind||receipt.home!==i.home||receipt.work!==i.work||receipt.context!==context.executionBinding.deployment||receipt.agent!==i.agent||receipt.instance!==i.name||typeof receipt.role!=='string'||!receipt.role.trim()||!same(receipt.executionBinding,context.executionBinding)||!same(receipt.responsibleHuman,context.responsibleHuman)||!same(receipt.binding,binding))invalid();
  if(context.action.kind!=='hook'||!['spawn','retire'].includes(context.action.name)||!same(receipt.sourceIdentity,context.subject.kind==='persistent'?context.subject.soul.identity:null))invalid();
}
/** Absence is explicitly legacy. Any supplied input requires the full selected
 * binding+invocation pair; invalid-present can never select legacy behavior.
 * assertCurrent is for every native boundary, not a new admission mechanism. */
export function loadCapturedAwebExecution(env=process.env){
  if(!markers.some(k=>Object.hasOwn(env,k)))return {kind:'legacy'};
  if(!Object.hasOwn(env,markers[0])||!Object.hasOwn(env,markers[1]))invalid();
  const files=markers.filter(k=>Object.hasOwn(env,k)).map(k=>env[k]);if(new Set(files).size!==files.length)invalid();
  const inputs=files.map((p,i)=>snapshot(p,[BINDING_WIRE_LIMITS,INVOCATION_LIMITS,RECEIPT_LIMITS][i]));
  let binding,context;
  try{binding=validateAwebBinding(inputs[0].value);context=validateAwebInvocationContext(inputs[1].value,binding);}catch{invalid();}
  if(inputs[2])validateSourceReceipt(inputs[2].value,context,binding);
  const assertCurrent=()=>{
    files.forEach((p,i)=>{const current=snapshot(p,[BINDING_WIRE_LIMITS,INVOCATION_LIMITS,RECEIPT_LIMITS][i]);if(current.identity!==inputs[i].identity||!same(current.value,inputs[i].value))invalid();});
  };
  assertCurrent();
  return {kind:'captured',binding:freeze(binding),context:freeze(context),sourceReceipt:inputs[2]?freeze(inputs[2].value):null,assertCurrent};
}
/** Exact entrypoint and retained instance, not OATS_META/current config, choose
 * the actor's target. The kernel still owns admission and replay. */
export function requireCapturedAwebAction(loaded,event,manifest,{env=process.env,cwd=process.cwd()}={}){
  if(loaded.kind!=='captured'||manifest.capability!==CAPABILITY)invalid();
  const {context}=loaded,a=context.action,i=context.instance;
  if(a.kind==='hook'){
    if(a.capability!==CAPABILITY||a.name!==event||!Object.hasOwn(manifest.hooks||{},event))invalid();
  }else if(a.kind==='command'){
    if(a.name!==event||!Object.hasOwn(manifest.commands||{},event)||(a.capability!==CAPABILITY&&a.namespace!==manifest.command))invalid();
  }else invalid();
  if(!i||!context.intent)absentAuthority();
  if(cwd!==i.home)invalid();
  for(const [key,value] of Object.entries({OATS_HOME:i.home,OATS_INSTANCE_HOME:i.home,OATS_INSTANCE:i.name,OATS_AGENT:i.agent,OATS_CONTEXT:context.executionBinding.deployment,OATS_DEPLOYMENT:context.executionBinding.deployment,OATS_RESOLUTION:context.executionBinding.resolution.id,OATS_CAPABILITY:CAPABILITY}))if(Object.hasOwn(env,key)&&env[key]!==value)invalid();
  if(a.kind==='hook'&&Object.hasOwn(env,'OATS_EVENT')&&env.OATS_EVENT!==event)invalid();
  const directories=[i.home,i.work,context.executionBinding.deployment].map(p=>{
    try{physical(p);const s=fs.lstatSync(p,{bigint:true});if(!s.isDirectory())invalid();return {path:p,dev:s.dev,ino:s.ino};}catch{invalid();}
  });
  const assertCurrent=()=>{
    loaded.assertCurrent();
    for(const d of directories){try{physical(d.path);const s=fs.lstatSync(d.path,{bigint:true});if(!s.isDirectory()||s.dev!==d.dev||s.ino!==d.ino)invalid();}catch{invalid();}}
  };
  assertCurrent();return {binding:loaded.binding,context,sourceReceipt:loaded.sourceReceipt,assertCurrent};
}
