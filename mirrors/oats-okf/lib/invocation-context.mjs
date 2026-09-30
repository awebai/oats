// Execution-only consumer of the kernel-owned generic snapshot. This module
// never reads a kernel index, mints identity, discovers source/config, or grants
// native authority from structural validation alone. Check remains stdin-only.
import fs from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { BINDING_WIRE_LIMITS, parseBindingJson, sourceRuntimeFromKnowledgeBinding } from './binding-wire.mjs';
import { INVOCATION_LIMITS, validateInvocationShape, sameInvocationJson } from './invocation-shape.mjs';
import { validateCapturedReceipt } from './sources.mjs';

const CAPABILITY='oats.okf';
export const INVOCATION_CONTEXT_LIMITS=INVOCATION_LIMITS;
const SOURCE_RECEIPT_LIMITS=Object.freeze({bytes:256*1024,depth:32,entries:16384});
const invalid=()=>{throw Object.assign(new Error('invalid captured OKF invocation context'),{code:'E_INVOCATION'});};
function absolute(value) {return typeof value==='string' && !value.includes('\0') && isAbsolute(value) && resolve(value)===value;}
function noLinks(file) {
  for(let path=file;;path=dirname(path)) {
    const stat=fs.lstatSync(path);
    if(stat.isSymbolicLink() || (path!==file && !stat.isDirectory())) invalid();
    if(dirname(path)===path) return;
  }
}
function readPrivateJson(file,limits) {
  if(!absolute(file)) invalid();let fd;
  try {
    noLinks(file);
    const uid=typeof process.getuid==='function'?process.getuid():null;
    const privateFile=stat=>stat.isFile() && stat.nlink===1n && stat.size<=BigInt(limits.bytes) && (stat.mode&0o7777n)===0o600n && (uid===null || stat.uid===BigInt(uid));
    const before=fs.lstatSync(file,{bigint:true});
    const same=stat=>privateFile(stat) && ['dev','ino','size','mtimeNs','ctimeNs'].every(key=>stat[key]===before[key]);
    if(!privateFile(before) || typeof fs.constants.O_NOFOLLOW!=='number' || typeof fs.constants.O_NONBLOCK!=='number') invalid();
    fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    noLinks(file);
    if(!same(fs.fstatSync(fd,{bigint:true})) || !same(fs.lstatSync(file,{bigint:true}))) invalid();
    const bytes=Buffer.alloc(Number(before.size));
    for(let offset=0;offset<bytes.length;) {
      const count=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);
      if(!count) invalid();offset+=count;
    }
    noLinks(file);
    if(!same(fs.fstatSync(fd,{bigint:true})) || !same(fs.lstatSync(file,{bigint:true}))) invalid();
    return parseBindingJson(bytes,limits);
  } catch {invalid();}
  finally {if(fd!==undefined) fs.closeSync(fd);}
}
export function validateOkfInvocationContext(value,binding) {
  try {
    sourceRuntimeFromKnowledgeBinding(binding);
    return validateInvocationShape(value,{capability:CAPABILITY});
  } catch {invalid();}
}
export function loadCapturedOkfInvocation(env=process.env) {
  const hasContext=Object.hasOwn(env,'OATS_INVOCATION_CONTEXT_FILE'),hasBinding=Object.hasOwn(env,'OATS_BINDING_FILE');
  if(!hasContext && !hasBinding && !Object.hasOwn(env,'OATS_SOURCE_RECEIPT_FILE')) return {kind:'legacy'};
  if(!hasContext || !hasBinding || env.OATS_INVOCATION_CONTEXT_FILE===env.OATS_BINDING_FILE) invalid();
  if(Object.hasOwn(env,'OATS_SOURCE_RECEIPT_FILE') && [env.OATS_INVOCATION_CONTEXT_FILE,env.OATS_BINDING_FILE].includes(env.OATS_SOURCE_RECEIPT_FILE)) invalid();
  const binding=readPrivateJson(env.OATS_BINDING_FILE,BINDING_WIRE_LIMITS);
  const context=validateOkfInvocationContext(readPrivateJson(env.OATS_INVOCATION_CONTEXT_FILE,INVOCATION_CONTEXT_LIMITS),binding);
  return {kind:'captured',file:env.OATS_INVOCATION_CONTEXT_FILE,bindingFile:env.OATS_BINDING_FILE,binding,context};
}
export function loadOkfSourceReceiptInput(loaded,env=process.env) {
  if(!Object.hasOwn(env,'OATS_SOURCE_RECEIPT_FILE')) return {mode:'absent'};
  if([loaded.file,loaded.bindingFile].includes(env.OATS_SOURCE_RECEIPT_FILE)) invalid();
  const receipt=readPrivateJson(env.OATS_SOURCE_RECEIPT_FILE,SOURCE_RECEIPT_LIMITS);
  assertOkfSourceReceiptContext(receipt,loaded.context,loaded.binding);
  return {mode:'captured',receipt};
}
// Explicit compatibility for a source already validated/loaded from durable
// storage. This cannot construct a source or supply generic admission authority.
export function assertOkfRegisteredSourceReplay(source,binding) {
  try {sourceRuntimeFromKnowledgeBinding(binding);} catch {invalid();}
  if(!source?.file || source.registration?.schemaVersion!==1 || source.registration.kind!=='captured' || !sameInvocationJson(source.providerBinding,binding)) invalid();
}
export function assertOkfInvocationAction(context,event,manifest) {
  try {validateInvocationShape(context,{capability:CAPABILITY});} catch {invalid();}
  const action=context.action;
  if(manifest?.capability!==CAPABILITY) invalid();
  if(action.kind==='hook') {
    if(action.capability!==CAPABILITY || action.name!==event || !Object.hasOwn(manifest.hooks||{},event)) invalid();
  } else if(action.kind==='command') {
    if(action.name!==event || !Object.hasOwn(manifest.commands||{},event) || (action.capability!==CAPABILITY && action.namespace!==manifest.command)) invalid();
  } else if(action.kind==='operation') {
    if(action.slot!==manifest.layer || !Object.hasOwn(manifest.operations||{},action.name) || manifest.operations[action.name].command!==event) invalid();
  } else invalid();
}
export function requireOkfAdmittedAction(context) {
  try {validateInvocationShape(context,{capability:CAPABILITY});} catch {invalid();}
  if(!context.instance || !context.intent) throw Object.assign(new Error('captured action requires an admitted instance intent'),{code:'E_ADMISSION'});
  // The shared shape enforces incarnation equality; the kernel, not this
  // provider, proves that the supplied attempt is currently admitted/running.
}
export function assertOkfSourceReceiptContext(receipt,context,binding) {
  validateOkfInvocationContext(context,binding);
  try {validateCapturedReceipt(context.instance?.home,receipt);} catch {invalid();}
  const instance=context.instance;
  if(!instance || context.action.kind!=='hook' || !['spawn','retire'].includes(context.action.name)
    || receipt.kind!==context.subject.kind || receipt.home!==instance.home || receipt.work!==instance.work
    || receipt.agent!==instance.agent || receipt.instance!==instance.name || receipt.context!==context.executionBinding.deployment
    || !sameInvocationJson(receipt.executionBinding,context.executionBinding) || !sameInvocationJson(receipt.responsibleHuman,context.responsibleHuman)
    || !sameInvocationJson(receipt.binding,binding)) invalid();
  const identity=context.subject.kind==='persistent'?context.subject.soul.identity:null;
  if(!sameInvocationJson(receipt.sourceIdentity,identity)) invalid();
}
export function assertOkfSourceContext(source,context,binding) {
  validateOkfInvocationContext(context,binding);
  if(!source) invalid();
  if(context.subject.kind!=='persistent' || source.agent!==context.subject.soul.alias
    || !sameInvocationJson(source.sourceIdentity,context.subject.soul.identity) || !sameInvocationJson(source.providerBinding,binding)
    || !sameInvocationJson(source.executionBinding,context.executionBinding) || source.context!==context.executionBinding.deployment
    || !sameInvocationJson(source.responsibleHuman,context.responsibleHuman)) invalid();
  if(context.instance && (source.home!==context.instance.home || source.work!==context.instance.work || source.instance!==context.instance.name || source.agent!==context.instance.agent)) invalid();
}
