// Provider-side consumption checks for the kernel-owned CapturedInvocationContext1.
// Decoded JSON only: no source/config parsing, artifact lookup or authorization.
// The kernel must verify retained authority before invoking provider code.
import { isAbsolute, join, resolve } from 'node:path';
export const INVOCATION_LIMITS=Object.freeze({bytes:512*1024,depth:32,entries:16384});
export const PRIOR_RECEIPT_LIMITS=Object.freeze({bytes:128*1024,depth:24,entries:8192});
const fail=()=>{throw Object.assign(new Error('invalid captured invocation'),{code:'invalid-binding'});};
const obj=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const canonical=value=>value===null || typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
export const sameInvocationJson=(a,b)=>canonical(a)===canonical(b);
const same=sameInvocationJson;
function keys(value,allowed,required=allowed) {if(!obj(value)) fail();for(const key of Object.keys(value)) if(!allowed.includes(key)) fail();for(const key of required) if(!Object.hasOwn(value,key)) fail();}
function text(value,empty=false) {if(typeof value!=='string' || (!empty && !value.length) || value.includes('\0')) fail();}
function list(value) {if(!Array.isArray(value)) fail();return value;}
function absolute(value) {text(value);if(!isAbsolute(value) || resolve(value)!==value) fail();}
function path(value,root=false) {text(value);if(root && value==='.') return;if(value.startsWith('/') || value.includes('\\') || value.split('/').some(part=>!part || part==='.' || part==='..')) fail();}
function hash(value) {if(typeof value!=='string' || !/^sha256-[a-f0-9]{64}$/.test(value)) fail();}
function integrity(value,format) {keys(value,['format','value']);if(value.format!==format) fail();hash(value.value);}
function capability(value) {text(value);if(!/^(?:@?[a-z0-9][a-z0-9._-]*[./])[a-z0-9][a-z0-9._/-]*$/.test(value)) fail();}
function repository(value) {
  if(value?.kind==='canonical-remote') {keys(value,['kind','remote']);text(value.remote);}
  else if(value?.kind==='provider-repository') {keys(value,['kind','provider','host','id']);text(value.provider);text(value.host);text(value.id);}
  else fail();
}
function soulIdentity(value) {
  if(value?.kind==='git-soul') {keys(value,['kind','repository','exportPath']);repository(value.repository);path(value.exportPath);}
  else if(value?.kind==='local-soul') {keys(value,['kind','source','exportPath']);text(value.source);if(!value.source.startsWith('path:')) fail();path(value.exportPath,true);}
  else fail();
}
function artifact(value) {
  if(value?.kind==='soul') {keys(value,['kind','identity','integrity']);soulIdentity(value.identity);}
  else if(value?.kind==='capability') {keys(value,['kind','capability','integrity']);capability(value.capability);}
  else if(value?.kind==='resource') keys(value,['kind','integrity']);
  else fail();
  integrity(value.integrity,'oats.tree-exec.v1');
}
function resolution(value) {keys(value,['schemaVersion','id']);if(value.schemaVersion!==1) fail();hash(value.id);}
function incarnation(value) {if(typeof value!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) fail();}
function intent(value,instance) {
  if(value===null) return;
  keys(value,['schemaVersion','executionId','incarnationId','attempt']);incarnation(value.incarnationId);
  if(value.schemaVersion!==1 || typeof value.executionId!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.executionId) || !Number.isSafeInteger(value.attempt) || value.attempt<1) fail();
  if(instance===null || value.incarnationId!==instance.incarnationId) fail();
}
function origin(value) {
  keys(value,['kind','document','pointer','span'],['kind','document','pointer']);
  if(!['soul-requirement','soul-default','workspace-default','import-adoption','operator','package-dependency','work-target','migration-evidence','provider-binding','workspace-admission','member-backlink','source-export','manifest-default'].includes(value.kind)) fail();
  text(value.pointer,true);if(!/^(?:\/(?:[^~]|~[01])*)*$/.test(value.pointer)) fail();
  const doc=value.document;
  if(doc?.kind==='source') {keys(doc,['kind','source','revision','path','integrity']);text(doc.source);text(doc.revision);path(doc.path);integrity(doc.integrity,'oats.bytes.v1');}
  else if(doc?.kind==='deployment') {keys(doc,['kind','path','integrity']);path(doc.path);integrity(doc.integrity,'oats.bytes.v1');}
  else if(doc?.kind==='operator') {keys(doc,['kind','id']);text(doc.id);}
  else if(doc?.kind==='record') {keys(doc,['kind','ref']);resolution(doc.ref);}
  else if(doc?.kind==='artifact') {keys(doc,['kind','owner','path','integrity']);artifact(doc.owner);path(doc.path);integrity(doc.integrity,'oats.bytes.v1');}
  else fail();
  if(Object.hasOwn(value,'span')) {keys(value.span,['start','end']);if(!Number.isSafeInteger(value.span.start) || !Number.isSafeInteger(value.span.end) || value.span.start<0 || value.span.end<value.span.start) fail();}
}
function origins(value) {list(value).forEach(origin);}
function subject(value) {
  if(value?.kind==='helper') {
    keys(value,['kind','provider','definition','name']);artifact(value.provider);
    keys(value.definition,['owner','path','kind']);artifact(value.definition.owner);path(value.definition.path,true);
    if(value.provider.kind!=='capability' || !same(value.provider,value.definition.owner) || !['file','directory','manifest','skill','runtime-package'].includes(value.definition.kind)) fail();
    if(typeof value.name!=='string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.name)) fail();return value.name;
  }
  if(value?.kind!=='persistent') fail();keys(value,['kind','soul']);const s=value.soul;
  keys(s,['identity','revision','alias','sourceArtifact','definition','projection']);soulIdentity(s.identity);artifact(s.sourceArtifact);
  if(s.sourceArtifact.kind!=='soul' || !same(s.identity,s.sourceArtifact.identity)) fail();
  if(typeof s.alias!=='string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.alias)) fail();path(s.definition);
  keys(s.projection,['roots']);list(s.projection.roots).forEach(value=>path(value,true));
  if(!s.projection.roots.length || !s.projection.roots.some(root=>root==='.' || s.definition===root || s.definition.startsWith(`${root}/`))) fail();
  for(let i=1;i<s.projection.roots.length;i++) if(Buffer.compare(Buffer.from(s.projection.roots[i-1]),Buffer.from(s.projection.roots[i]))>=0) fail();
  if(s.identity.exportPath!=='.' && !s.definition.startsWith(`${s.identity.exportPath}/`)) fail();
  const r=s.revision;
  if(r?.kind==='local') {
    keys(r,['kind','source','integrity','provenance','repository'],['kind','source','integrity','provenance']);text(r.source);if(!r.source.startsWith('path:')) fail();integrity(r.integrity,'oats.tree-exec.v1');
    if(!same(r.integrity,s.sourceArtifact.integrity)) fail();
    if(s.identity.kind==='local-soul') {if(r.source!==s.identity.source || Object.hasOwn(r,'repository')) fail();}
    else {repository(r.repository);if(!same(r.repository,s.identity.repository)) fail();}
  } else {
    keys(r,['identity','remote','selector','commit','provenance']);repository(r.identity);text(r.remote);text(r.selector);
    if(s.identity.kind!=='git-soul' || !same(r.identity,s.identity.repository) || !/^[a-f0-9]{40}$/.test(r.commit)) fail();
    if(r.identity.kind==='canonical-remote' && r.identity.remote!==r.remote) fail();
  }
  origins(r.provenance);if(!r.provenance.length) fail();return s.alias;
}
function context(value) {
  if(value?.kind==='workspace') {keys(value,['kind','identity','observation']);keys(value.identity,['repository','path']);repository(value.identity.repository);if(value.identity.path!=='oats-workspace.yaml') fail();origin(value.observation);return {kind:'workspace',identity:value.identity};}
  if(value?.kind==='standalone') {keys(value,['kind','key']);if(value.key!==null) text(value.key);return value;}
  fail();
}
function human(value) {if(value===null) return;keys(value,['provider','id']);text(value.provider);text(value.id);}
function messaging(value,selectedContext,responsibleHuman) {
  if(value?.enabled===false) {keys(value,['schemaVersion','enabled']);if(responsibleHuman!==null) fail();}
  else {
    keys(value,['schemaVersion','enabled','privateKey','wider','provenance']);if(value.enabled!==true) fail();
    keys(value.privateKey,['provider','human','context']);capability(value.privateKey.provider);human(value.privateKey.human);
    if(value.privateKey.human===null || !same(value.privateKey.human,responsibleHuman) || !same(value.privateKey.context,selectedContext) || (selectedContext.kind==='standalone' && selectedContext.key===null)) fail();
    list(value.wider).forEach(row=>{keys(row,['provider','id']);text(row.id);if(row.provider!==value.privateKey.provider) fail();});
    for(let i=1;i<value.wider.length;i++) if(Buffer.compare(Buffer.from(canonical(value.wider[i-1])),Buffer.from(canonical(value.wider[i])))>=0) fail();
    origins(value.provenance);
  }
  if(value.schemaVersion!==1) fail();
}
function action(value) {
  if(!obj(value)) fail();
  if(value.kind==='command') {keys(value,['kind','capability','namespace','name'],['kind','name']);if(Object.hasOwn(value,'capability')===Object.hasOwn(value,'namespace')) fail();if(value.capability!==undefined) capability(value.capability);else text(value.namespace);text(value.name);}
  else if(value.kind==='hook') {keys(value,['kind','capability','name']);capability(value.capability);text(value.name);}
  else if(value.kind==='operation') {keys(value,['kind','slot','name']);if(!['knowledge','messaging','tasks'].includes(value.slot)) fail();text(value.name);}
  else if(['inspect','compose'].includes(value.kind)) keys(value,['kind']);
  else fail();
}
export function assertInvocationBounds(value,limits=INVOCATION_LIMITS) {
  let entries=0;const active=new Set();
  const visit=(v,depth)=>{
    if(v===null || typeof v==='string' || typeof v==='boolean') return;
    if(typeof v==='number') {if(!Number.isFinite(v)) fail();return;}
    if(typeof v!=='object' || depth>limits.depth || active.has(v)) fail();
    if(!Array.isArray(v) && Object.getPrototypeOf(v)!==Object.prototype && Object.getPrototypeOf(v)!==null) fail();
    active.add(v);for(const child of Object.values(v)) {if(++entries>limits.entries) fail();visit(child,depth+1);}active.delete(v);
  };
  visit(value,1);if(Buffer.byteLength(JSON.stringify(value),'utf8')>limits.bytes) fail();
}
export function validateInvocationShape(value,expected={}) {
  assertInvocationBounds(value);keys(value,['schemaVersion','executionBinding','subject','instance','intent','context','responsibleHuman','messagingChoice','capability','action','priorReceipt']);
  if(value.schemaVersion!==1) fail();keys(value.executionBinding,['schemaVersion','deployment','resolution']);if(value.executionBinding.schemaVersion!==1) fail();absolute(value.executionBinding.deployment);resolution(value.executionBinding.resolution);
  const alias=subject(value.subject);
  if(value.instance!==null) {keys(value.instance,['home','work','name','agent','incarnationId']);incarnation(value.instance.incarnationId);absolute(value.instance.home);absolute(value.instance.work);text(value.instance.name);text(value.instance.agent);if(value.instance.agent!==alias || value.instance.work!==join(value.instance.home,'work')) fail();}
  intent(value.intent,value.instance);
  const selectedContext=context(value.context);human(value.responsibleHuman);messaging(value.messagingChoice,selectedContext,value.responsibleHuman);capability(value.capability);action(value.action);assertInvocationBounds(value.priorReceipt,PRIOR_RECEIPT_LIMITS);
  if(value.action.capability!==undefined && value.action.capability!==value.capability) fail();
  if(value.action.kind==='hook' && value.instance===null) fail();
  for(const field of ['capability','context','action']) if(Object.hasOwn(expected,field) && !same(value[field],expected[field])) fail();
  return value;
}
