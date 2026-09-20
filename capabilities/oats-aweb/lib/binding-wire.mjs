import { TextDecoder } from 'node:util';
import { assessCapturedSessionReadiness } from './session-readiness.mjs';
import {
  MESSAGING_CONTRACT,
  MESSAGING_CONTRACT_VERSION,
  bindMessagingDomain,
  normalizeMessagingDeclarations,
  validateAwebBinding,
  validateAwebInvocationContext,
} from './portable-binding.mjs';

export const BINDING_WIRE_LIMITS=Object.freeze({bytes:1024*1024,depth:32,entries:16384});
const CAPABILITY='oats.aweb',SLOT='messaging';
const phases=new Set(['normalize','bind','check']);
const declarationKinds=new Set(['soul','workspace','adoption','operator']);
const errorCodes=new Set(['needs-configuration','requirement-conflict','invalid-binding','authorization-required','host-requirement-missing','provider-unavailable','provider-not-qualified']);
const obj=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const wireError=code=>{throw Object.assign(new Error(code),{wireCode:code});};
const canonical=value=>value===null || typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const same=(a,b)=>canonical(a)===canonical(b);
function keys(value,allowed,required) {
  if(!obj(value)) wireError('invalid-binding');
  for(const key of Object.keys(value)) if(!allowed.includes(key)) wireError('invalid-binding');
  for(const key of required) if(!Object.hasOwn(value,key)) wireError('invalid-binding');
  return value;
}
function pointer(value) {return typeof value==='string' && /^(?:\/(?:[^~]|~[01])*)+$/.test(value);}
function bindingKey(value) {return pointer(value) && value.startsWith('/bindings/messaging/') && value.length>'/bindings/messaging/'.length;}

class StrictJsonParser {
  constructor(text,{depth,entries}) {this.text=text;this.maxDepth=depth;this.maxEntries=entries;this.at=0;this.entries=0;}
  whitespace() {while(/[\u0009\u000a\u000d\u0020]/.test(this.text[this.at] || '')) this.at++;}
  count() {if(++this.entries>this.maxEntries) wireError('invalid-binding');}
  string() {
    if(this.text[this.at]!=='"') wireError('invalid-binding');
    const start=this.at++;
    while(this.at<this.text.length) {
      const code=this.text.charCodeAt(this.at++);
      if(code===0x22) {try{return JSON.parse(this.text.slice(start,this.at));}catch{wireError('invalid-binding');}}
      if(code<0x20) wireError('invalid-binding');
      if(code===0x5c) {
        const escaped=this.text[this.at++];
        if(escaped==='u') {if(!/^[0-9a-fA-F]{4}$/.test(this.text.slice(this.at,this.at+4))) wireError('invalid-binding');this.at+=4;}
        else if(!'"\\/bfnrt'.includes(escaped || '')) wireError('invalid-binding');
      }
    }
    wireError('invalid-binding');
  }
  value(depth=1) {
    this.whitespace();const char=this.text[this.at];
    if(char==='"') return this.string();
    if(char==='{') {
      if(depth>this.maxDepth) wireError('invalid-binding');this.at++;this.whitespace();
      const result=Object.create(null),seen=new Set();if(this.text[this.at]==='}') {this.at++;return result;}
      while(true) {
        this.whitespace();const key=this.string();if(seen.has(key)) wireError('invalid-binding');seen.add(key);this.count();
        this.whitespace();if(this.text[this.at++]!==':') wireError('invalid-binding');result[key]=this.value(depth+1);this.whitespace();
        const next=this.text[this.at++];if(next==='}') return result;if(next!==',') wireError('invalid-binding');
      }
    }
    if(char==='[') {
      if(depth>this.maxDepth) wireError('invalid-binding');this.at++;this.whitespace();
      const result=[];if(this.text[this.at]===']') {this.at++;return result;}
      while(true) {this.count();result.push(this.value(depth+1));this.whitespace();const next=this.text[this.at++];if(next===']') return result;if(next!==',') wireError('invalid-binding');}
    }
    for(const [token,value] of [['true',true],['false',false],['null',null]]) if(this.text.startsWith(token,this.at)) {this.at+=token.length;return value;}
    const match=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(this.text.slice(this.at));
    if(!match) wireError('invalid-binding');this.at+=match[0].length;const number=Number(match[0]);if(!Number.isFinite(number)) wireError('invalid-binding');return number;
  }
  parse() {this.whitespace();const value=this.value();this.whitespace();if(this.at!==this.text.length) wireError('invalid-binding');return value;}
}

export function parseBindingJson(bytes,limits=BINDING_WIRE_LIMITS) {
  if(!Buffer.isBuffer(bytes)) bytes=Buffer.from(bytes);
  if(bytes.length>limits.bytes) wireError('invalid-binding');
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{wireError('invalid-binding');}
  return new StrictJsonParser(text,limits).parse();
}
function settings(value) {
  if(!obj(value)) wireError('invalid-binding');
  if(Object.hasOwn(value,'identity')) wireError('provider-not-qualified');
  keys(value,['delivery'],[]);
  if(value.delivery!==undefined && !['channel','session'].includes(value.delivery)) wireError('needs-configuration');
  return value;
}
function request(value,phase) {
  keys(value,['schemaVersion','phase','slot','capability','settings','input'],['schemaVersion','phase','slot','capability','settings','input']);
  if(value.schemaVersion!==1 || value.phase!==phase || value.slot!==SLOT || value.capability!==CAPABILITY) wireError('invalid-binding');
  settings(value.settings);return value;
}
function declaration(value) {
  keys(value,['kind','value','origin','origins'],['kind','value','origin','origins']);
  if(!declarationKinds.has(value.kind) || !obj(value.value) || !obj(value.origin) || !obj(value.origins)) wireError('invalid-binding');
  return value;
}
function context(value,{request=false}={}) {
  if(value?.kind==='workspace') {
    keys(value,request?['kind','identity','observation']:['kind','identity'],request?['kind','identity','observation']:['kind','identity']);
    if(!obj(value.identity) || (request && !obj(value.observation))) wireError('invalid-binding');
    return {kind:'workspace',identity:value.identity};
  }
  if(value?.kind==='standalone') {
    keys(value,['kind','key'],['kind','key']);
    if(value.key!==null && (typeof value.key!=='string' || !value.key.trim())) wireError('invalid-binding');
    return {kind:'standalone',key:value.key};
  }
  wireError('invalid-binding');
}
function normalizePhase(req) {
  keys(req.input,['declarations','context'],['declarations','context']);
  if(!Array.isArray(req.input.declarations)) wireError('invalid-binding');
  const declarations=req.input.declarations.map(declaration);context(req.input.context,{request:true});
  return normalizeMessagingDeclarations({declarations,context:req.input.context});
}
function choiceMap(value,model) {
  if(!obj(value)) wireError('invalid-binding');
  const allowed=new Set(['/bindings/messaging/responsibleHuman','/bindings/messaging/privateTeam','/bindings/messaging/wider',...Object.values(model.teams)]);
  for(const [key,choice] of Object.entries(value)) {
    if(!bindingKey(key) || !allowed.has(key)) wireError('invalid-binding');
    keys(choice,['value','selectedBy','constraints','considered'],['value','selectedBy','constraints','considered']);
    if(!Array.isArray(choice.constraints) || !Array.isArray(choice.considered) || (choice.selectedBy!==null && !obj(choice.selectedBy))) wireError('invalid-binding');
  }
  return value;
}
function model(value) {
  keys(value,['contract','version','context','contextOrigin','requested','requestedOrigins','aliases','aliasOrigins','teams','privatePolicy','privatePolicyOrigin'],['contract','version','context','contextOrigin','requested','requestedOrigins','aliases','aliasOrigins','teams','privatePolicy','privatePolicyOrigin']);
  if(value.contract!==MESSAGING_CONTRACT || value.version!==MESSAGING_CONTRACT_VERSION || !Array.isArray(value.requested) || !obj(value.requestedOrigins) || !obj(value.aliases) || !obj(value.aliasOrigins) || !obj(value.teams) || typeof value.privatePolicy!=='boolean') wireError('invalid-binding');
  context(value.context);if(value.contextOrigin!==null && !obj(value.contextOrigin)) wireError('invalid-binding');if(value.privatePolicyOrigin!==null && !obj(value.privatePolicyOrigin)) wireError('invalid-binding');
  for(const key of Object.values(value.teams)) if(!bindingKey(key)) wireError('invalid-binding');
  return value;
}
function bindPhase(req) {
  keys(req.input,['model','choices','context'],['model','choices','context']);
  const normalized=model(req.input.model),selectedContext=context(req.input.context,{request:true});
  if(!same(selectedContext,normalized.context) || (selectedContext.kind==='workspace' && !same(req.input.context.observation,normalized.contextOrigin))) wireError('invalid-binding');
  return bindMessagingDomain({model:normalized,choices:choiceMap(req.input.choices,normalized)});
}
function binding(value) {
  keys(value,['schemaVersion','capability','payloadContract','payloadVersion','payload','credentialRefs','provenance'],['schemaVersion','capability','payloadContract','payloadVersion','payload','credentialRefs','provenance']);
  if(value.schemaVersion!==1 || value.capability!==CAPABILITY || value.payloadContract!==MESSAGING_CONTRACT || value.payloadVersion!==MESSAGING_CONTRACT_VERSION || !obj(value.payload) || !obj(value.credentialRefs) || Object.keys(value.credentialRefs).length || !Array.isArray(value.provenance)) wireError('invalid-binding');
  for(const origin of value.provenance) if(!obj(origin)) wireError('invalid-binding');
  return value;
}
function checkResult(message) {return {status:'needs-configuration',problems:[{code:'needs-configuration',message}]};}
function checkPhase(req) {
  keys(req.input,['binding','context','action','invocation'],['binding','context','action']);
  if(!obj(req.input.action) || typeof req.input.action.kind!=='string') wireError('invalid-binding');
  const current=validateAwebBinding(binding(req.input.binding)),selectedContext=context(req.input.context,{request:true});
  if(!same(selectedContext,current.payload.context)) wireError('invalid-binding');
  const invocation=Object.hasOwn(req.input,'invocation')?validateAwebInvocationContext(req.input.invocation,current,{context:req.input.context,action:req.input.action}):null;
  if(['command','hook','operation'].includes(req.input.action.kind) && (!invocation || invocation.instance===null || invocation.intent===null)) return checkResult('an admitted captured instance intent is required for execution');
  if(current.payload.privateTeam===null) return checkResult('an explicit private-team binding is required');
  // Read-only public kernel observations, not an account/grant attestation.
  // Native setup is performed only by the separately admitted execution path.
  return assessCapturedSessionReadiness({binding:current,invocation,settings:req.settings});
}

export function handleBindingRequest(phase,value) {
  if(!phases.has(phase)) wireError('invalid-binding');
  const req=request(value,phase);
  if(phase==='normalize') return normalizePhase(req);
  if(phase==='bind') return bindPhase(req);
  return checkPhase(req);
}
function response(phase,body) {return {schemaVersion:1,phase,slot:SLOT,capability:CAPABILITY,...body};}
function errorCode(error) {if(errorCodes.has(error?.wireCode)) return error.wireCode;if(errorCodes.has(error?.code)) return error.code;return 'invalid-binding';}
// Only these literal domain diagnostics may cross the wire. Never reflect a
// caught exception's dynamic alias/key/path, native stderr or credential text.
const safeReasons=new Map([
  ['needs-configuration',[
    'messaging-enabled standalone preparation needs an explicit context key',
    'messaging binding needs one soul declaration',
    'messaging workspace must declare private: per-human',
    'an explicit responsible-human binding is required',
    'an explicit wider-membership consent list is required',
    'a selected wider-team binding is required',
    'a selected wider alias needs an explicit workspace team mapping',
  ]],
  ['requirement-conflict',['multiple soul messaging declarations','adoption team aliases have conflicting mappings']],
]);
const fallbackReasons=Object.freeze({
  'needs-configuration':'messaging settings and explicit binding selections are required',
  'requirement-conflict':'messaging declarations contain incompatible requirements',
  'invalid-binding':'messaging input must match the supported binding contract',
  'authorization-required':'explicit native messaging authorization is required',
  'host-requirement-missing':'a required native messaging host resource is unavailable',
  'provider-unavailable':'the selected messaging provider is unavailable',
  'provider-not-qualified':'the requested messaging configuration is not qualified',
});
function errorProblem(error) {
  const code=errorCode(error),message=safeReasons.get(code)?.find(literal=>literal===error?.message)??fallbackReasons[code];
  return {code,message};
}
function enforceOutputLimits(value,depth=1,state={entries:0}) {
  if(depth>BINDING_WIRE_LIMITS.depth) wireError('provider-not-qualified');
  if(value===null || typeof value!=='object') return;
  for(const child of Array.isArray(value)?value:Object.values(value)) {
    if(++state.entries>BINDING_WIRE_LIMITS.entries) wireError('provider-not-qualified');
    enforceOutputLimits(child,depth+1,state);
  }
}
export async function runBindingWire(phase,input=process.stdin,output=process.stdout) {
  let answer;
  try {
    const chunks=[];let length=0;
    for await(const chunk of input) {const bytes=Buffer.from(chunk);length+=bytes.length;if(length>BINDING_WIRE_LIMITS.bytes) wireError('invalid-binding');chunks.push(bytes);}
    const result=handleBindingRequest(phase,parseBindingJson(Buffer.concat(chunks,length)));
    answer=response(phase,{ok:true,result});
  } catch(error) {answer=response(phases.has(phase)?phase:'check',{ok:false,error:errorProblem(error)});}
  let bytes;
  try {enforceOutputLimits(answer);bytes=Buffer.from(JSON.stringify(answer)+'\n');if(bytes.length>BINDING_WIRE_LIMITS.bytes) wireError('provider-not-qualified');}
  catch {bytes=Buffer.from(JSON.stringify(response(phases.has(phase)?phase:'check',{ok:false,error:{code:'provider-not-qualified',message:'messaging response exceeds the supported wire limits'}}))+'\n');}
  output.write(bytes);return answer.ok;
}
