/** Bounded lifecycle custody in the existing deployment index. No source/config
 * discovery, user database, provider policy or automatic legacy backfill. */
import { closeSync, constants, fsyncSync, lstatSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { readPortableBytes } from "./portable-files.mjs";
import { compareUtf8, canonicalJson, parseStrictJson } from "./portable-values.mjs";
import { jsonIntegrity } from "./portable-digest.mjs";
import { portableScope, portableStateDirectory, withPortableStateWrite, writeGuardedPortableDocument } from "./portable-state.mjs";
import { validateExecutionBinding } from "./schedule-capsule.mjs";
import { validateIncarnationId, validateIntentRef } from "./captured-admission-shape.mjs";
import { validateCapturedAction } from "./captured-action-shape.mjs";
import { isMaterializedCapabilityId } from "./capability-provenance.mjs";
import { objectAt, stringAt } from "./portable-shape.mjs";
import { oatsError } from "./errors.mjs";

const FILE = "instance-references.json";
const STATUSES = new Set(["scaffolded-hooks-pending", "spawn-hooks-running", "spawned-launch-pending", "spawned-cleanup-required", "spawn-failed-cleanup-required", "retire-running", "retire-failed-cleanup-required"]);
const INTENT_STATES = new Set(["admitted", "running", "completed", "unconfirmed", "blocked"]);
const LIMITS = Object.freeze({ maxBytes: 4 * 1024 * 1024, maxDepth: 32, maxEntries: 40_000 });
const RECEIPT_LIMITS = Object.freeze({ maxBytes: 128 * 1024, maxDepth: 24, maxEntries: 8192 });
const same = (a,b) => canonicalJson(a) === canonicalJson(b);

export function capturedDirectoryIdentity(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory()) throw oatsError("integrity-drift", "captured home/work must remain real directories");
  return { dev: stat.dev, ino: stat.ino };
}
function directoryIdentity(value) {
  objectAt(value,["dev","ino"],["dev","ino"]);
  for (const key of ["dev","ino"]) if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw oatsError("invalid-declaration","invalid directory identity witness");
}
function human(value) {
  if (value === null) return;
  objectAt(value,["provider","id"],["provider","id"]);stringAt(value.provider,"/human/provider");stringAt(value.id,"/human/id");
}
function intentRef(row,intent) { return {schemaVersion:1,executionId:intent.executionId,incarnationId:row.incarnationId,attempt:intent.attempt}; }
function validateIntent(intent) {
  objectAt(intent,["executionId","capability","action","inputIntegrity","state","attempt","receipt","replayable"],["executionId","capability","action","inputIntegrity","state","attempt","receipt","replayable"]);
  if(typeof intent.replayable!=="boolean")throw oatsError("invalid-declaration","invalid intent replay evidence");
  if(!isMaterializedCapabilityId(intent.capability)||intent.action?.capability!==undefined&&intent.action.capability!==intent.capability)throw oatsError("invalid-declaration","invalid intent capability owner");
  stringAt(intent.executionId,"/executionId",{pattern:/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/});
  validateCapturedAction(intent.action);
  if (!["command","operation","hook"].includes(intent.action.kind) || !INTENT_STATES.has(intent.state)) throw oatsError("invalid-declaration","invalid admitted action/state");
  if (!Number.isSafeInteger(intent.attempt) || intent.attempt < 1) throw oatsError("invalid-declaration","invalid intent attempt");
  objectAt(intent.inputIntegrity,["format","value"],["format","value"]);
  if (intent.inputIntegrity.format !== "oats.json.v1" || !/^sha256-[a-f0-9]{64}$/.test(intent.inputIntegrity.value)) throw oatsError("invalid-declaration","invalid intent input integrity");
  canonicalJson(intent.receipt,RECEIPT_LIMITS);
}
export function validateCapturedInstanceReference(row) {
  objectAt(row,["home","instance","agent","kind","status","executionBinding","responsibleHuman","incarnationId","custody","intents","custodyFailure"],
    ["home","instance","agent","kind","status","executionBinding","responsibleHuman","incarnationId","custody","intents"]);
  for(const key of ["home","instance","agent"]) stringAt(row[key],`/${key}`);
  if(!isAbsolute(row.home)||resolve(row.home)!==row.home) throw oatsError("invalid-declaration","captured home must be normalized absolute");
  if(!['persistent','helper'].includes(row.kind)||!STATUSES.has(row.status)) throw oatsError("invalid-declaration","invalid captured instance kind/status");
  validateIncarnationId(row.incarnationId);validateExecutionBinding(row.executionBinding);human(row.responsibleHuman);
  if(row.custodyFailure!==undefined){
    objectAt(row.custodyFailure,["code","message"],["code","message"]);
    for(const key of ["code","message"]){stringAt(row.custodyFailure[key],`/custodyFailure/${key}`);if(row.custodyFailure[key].length>200)throw oatsError("resource-limit","custody diagnostic exceeds bound");}
  }
  objectAt(row.custody,["home","work"],["home","work"]);directoryIdentity(row.custody.home);directoryIdentity(row.custody.work);
  if(!Array.isArray(row.intents)||row.intents.length>128) throw oatsError("resource-limit","captured instance intent retention limit reached");
  const ids=new Set();let pending=0;
  for(const intent of row.intents){validateIntent(intent);if(ids.has(intent.executionId))throw oatsError("invalid-declaration","duplicate intent ID");ids.add(intent.executionId);if(intent.state!=="completed")pending++;}
  if(pending>1) throw oatsError("invalid-declaration","multiple unsettled captured intents");
  return row;
}
function validateIndex(value) {
  canonicalJson(value,LIMITS);objectAt(value,["schemaVersion","instances"],["schemaVersion","instances"]);
  if(value.schemaVersion!==2) throw oatsError("migration-required","captured instance index lacks incarnation/admission evidence; no automatic backfill");
  if(!Array.isArray(value.instances)) throw oatsError("invalid-declaration","invalid captured instance index");
  const ids=new Set();let prior;
  for(const row of value.instances){validateCapturedInstanceReference(row);if(ids.has(row.incarnationId)||(prior!==undefined&&compareUtf8(prior,row.home)>=0))throw oatsError("invalid-declaration","duplicate/unordered captured instance references");ids.add(row.incarnationId);prior=row.home;}
  return value;
}
export function readCapturedInstanceIndex(deployment) {
  const root=portableStateDirectory(deployment,false);
  if(!root)return {schemaVersion:2,instances:[]};
  const bytes=readPortableBytes(join(root,FILE),{allowMissing:true});
  return bytes===null?{schemaVersion:2,instances:[]}:validateIndex(parseStrictJson(bytes,LIMITS));
}

/** Read and verify current owned metadata; old/unwitnessed homes are evidence,
 * never newly minted identities. Recheck roots after the descriptor read. */
export function readCapturedInstanceMetadata(home) {
  if(typeof home!=="string"||!isAbsolute(home))throw oatsError("invalid-declaration","captured home must be explicit and absolute");
  const actual=portableScope(home),homeIdentity=capturedDirectoryIdentity(home),workIdentity=capturedDirectoryIdentity(join(home,"work"));
  const metadata=parseStrictJson(readPortableBytes(join(actual,"instance.json")),LIMITS);
  if(!metadata.incarnationId||!metadata.captured?.custody)throw oatsError("migration-required","captured home lacks incarnation custody; explicit reprovisioning required without deleting prior data");
  validateIncarnationId(metadata.incarnationId);validateExecutionBinding(metadata.executionBinding);
  if(typeof metadata.home!=="string"||portableScope(metadata.home)!==actual||metadata.work!=="directory"
    ||!same(metadata.captured.custody,{home:homeIdentity,work:workIdentity})
    ||!same(capturedDirectoryIdentity(home),homeIdentity)||!same(capturedDirectoryIdentity(join(home,"work")),workIdentity))throw oatsError("integrity-drift","captured home/work ownership changed");
  return metadata;
}
function matchedRow(index,home) {
  const metadata=readCapturedInstanceMetadata(home),actual=portableScope(home),row=index.instances.find(item=>item.home===actual);
  if(!row)throw oatsError("invalid-resolution","captured incarnation is not indexed");
  if(row.incarnationId!==metadata.incarnationId||row.instance!==metadata.instance||row.agent!==metadata.agent||row.kind!==metadata.kind
    ||!same(row.custody,metadata.captured.custody)||!same(row.executionBinding,metadata.executionBinding)||!same(row.responsibleHuman,metadata.responsibleHuman))throw oatsError("invalid-resolution","captured index differs from current incarnation metadata");
  return {row,metadata};
}
export function readCapturedInstanceAuthority(deployment,home) {
  return matchedRow(readCapturedInstanceIndex(deployment),home);
}
const AUTHORITY_FIELDS = ["home","instance","agent","kind","executionBinding","responsibleHuman","incarnationId","custody"];
function sameAuthority(a,b){return AUTHORITY_FIELDS.every(key=>same(a[key],b[key]));}
export function assertCapturedInstanceCustody(original) {
  for(const [key,path] of [["home",original.home],["work",join(original.home,"work")]]){
    if(!same(capturedDirectoryIdentity(path),original.custody[key]))throw oatsError("integrity-drift","captured home/work changed after preflight");
  }
  const {row}=readCapturedInstanceAuthority(original.executionBinding.deployment,original.home);
  if(!sameAuthority(original,row))throw oatsError("integrity-drift","captured instance authority changed after preflight");
  return row;
}

/** Failure reporting deliberately does NOT read/resolve the home: it may now
 * belong to someone else. Match the original indexed authority and attempt,
 * preserve receipts there, and never use this path to certify success. */
export function recordCapturedCustodyFailure(original,{meta={},intents={},code="integrity-drift",message="captured home/work custody changed"}={}) {
  validateCapturedInstanceReference(original);objectAt(meta,null,[]);objectAt(intents,null,[]);
  return withPortableStateWrite(original.executionBinding.deployment,context=>{
    const index=readCapturedInstanceIndex(context.deployment),row=index.instances.find(item=>item.incarnationId===original.incarnationId);
    if(!row||!sameAuthority(original,row))throw oatsError("selection-changed","original indexed custody no longer matches failure report");
    for(const [capability,ref] of Object.entries(intents)){
      const intent=matchedIntent(row,ref);
      if(intent.capability!==capability)throw oatsError("invalid-resolution","observed receipt owner differs from admitted capability");
      if(Object.hasOwn(meta,capability)){canonicalJson(meta[capability],RECEIPT_LIMITS);intent.receipt=meta[capability];}
      if(intent.state==="running"||intent.state==="admitted"){intent.state="unconfirmed";intent.replayable=false;}
    }
    for(const capability of Object.keys(meta))if(!Object.hasOwn(intents,capability))throw oatsError("invalid-resolution","observed receipt lacks its admitted intent");
    row.status="spawn-failed-cleanup-required";
    row.custodyFailure={code:String(code).slice(0,200)||"integrity-drift",message:String(message).slice(0,200)||"custody failure"};
    save(context,index);return {home:row.home,incarnationId:row.incarnationId,executionBinding:row.executionBinding,custodyFailure:row.custodyFailure};
  });
}
/** Sync only already-owned metadata paths. If synchronization fails after
 * publication, callers retain custody rather than claim admission completed. */
export function syncCapturedMetadata(path) {
  const stat=lstatSync(path);
  if(!stat.isFile()&&!stat.isDirectory())throw oatsError("integrity-drift","captured metadata sync target changed");
  const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{fsyncSync(fd);}finally{closeSync(fd);}
}
function save(context,index){
  validateIndex(index);const file=join(context.root,FILE);
  writeGuardedPortableDocument(context,file,index);
  for(const path of [file,context.root,dirname(context.root),context.deployment])syncCapturedMetadata(path);
}
export function registerCapturedInstance(deployment,home) {
  return withPortableStateWrite(deployment,context=>{
    const index=readCapturedInstanceIndex(context.deployment),metadata=readCapturedInstanceMetadata(home),actual=portableScope(home);
    if(index.instances.some(row=>row.home===actual))throw oatsError("selection-changed","captured home has retained lifecycle obligations; no replacement/backfill");
    if(portableScope(metadata.executionBinding.deployment)!==context.deployment)throw oatsError("invalid-resolution","incarnation deployment mismatch");
    const row={home:actual,instance:metadata.instance,agent:metadata.agent,kind:metadata.kind,status:"scaffolded-hooks-pending",executionBinding:metadata.executionBinding,
      responsibleHuman:metadata.responsibleHuman,incarnationId:metadata.incarnationId,custody:metadata.captured.custody,intents:[]};
    validateCapturedInstanceReference(row);index.instances.push(row);index.instances.sort((a,b)=>compareUtf8(a.home,b.home));save(context,index);return row;
  });
}
export function setCapturedInstanceStatus(deployment,home,status,{expectedStatus}={}) {
  if(!STATUSES.has(status))throw oatsError("invalid-declaration","invalid captured lifecycle status");
  return withPortableStateWrite(deployment,context=>{
    const index=readCapturedInstanceIndex(context.deployment),{row}=matchedRow(index,home);
    if(expectedStatus!==undefined&&row.status!==expectedStatus)throw oatsError("selection-changed","captured lifecycle status changed");
    row.status=status;save(context,index);return row;
  });
}

/** New intent or EXPLICIT retry; input commits only bounded nonsecret request
 * data, never runtime environment or credential values. */
export function admitCapturedInstanceAction({deployment,home,executionBinding,capability,action,input={},retryExecutionId}) {
  validateExecutionBinding(executionBinding);
  if(!isMaterializedCapabilityId(capability))throw oatsError("invalid-declaration","admission requires exact capability owner");
  validateCapturedAction(action);canonicalJson(input,{maxBytes:128*1024,maxDepth:24,maxEntries:8192});
  const inputIntegrity=jsonIntegrity(input);
  return withPortableStateWrite(deployment,context=>{
    const index=readCapturedInstanceIndex(context.deployment),{row,metadata}=matchedRow(index,home);
    if(!same(row.executionBinding,executionBinding))throw oatsError("invalid-resolution","admission selection differs from current indexed incarnation");
    let intent;
    if(retryExecutionId!==undefined){
      intent=row.intents.find(item=>item.executionId===retryExecutionId);
      if(!intent||intent.capability!==capability||!same(intent.action,action)||!same(intent.inputIntegrity,inputIntegrity))throw oatsError("invalid-resolution","retry does not match the admitted action/input");
      if(intent.state==="completed")return {intent:intentRef(row,intent),replayed:true,replayable:intent.replayable,receipt:intent.receipt};
      if(!["unconfirmed","blocked"].includes(intent.state))throw oatsError("selection-changed","intent is admitted/running; explicit reconciliation is required before retry");
      intent.attempt++;intent.state="admitted";
    }else{
      if(row.intents.some(item=>item.state!=="completed"))throw oatsError("selection-changed","an unsettled captured intent must be reconciled/retried, not replaced");
      if(row.intents.length>=128)throw oatsError("resource-limit","captured intent history is full; no automatic pruning");
      const previous=row.intents.findLast(item=>item.capability===capability);
      const receipt=previous?previous.receipt:metadata.capabilityMeta&&Object.hasOwn(metadata.capabilityMeta,capability)?metadata.capabilityMeta[capability]:null;
      canonicalJson(receipt,RECEIPT_LIMITS);
      intent={executionId:randomUUID(),capability,action,inputIntegrity,state:"admitted",attempt:1,receipt,replayable:false};row.intents.push(intent);
    }
    save(context,index);return {intent:intentRef(row,intent),replayed:false,receipt:intent.receipt};
  });
}
function matchedIntent(row,ref,action) {
  validateIntentRef(ref);const intent=row.intents.find(item=>item.executionId===ref.executionId);
  if(row.incarnationId!==ref.incarnationId||!intent||intent.attempt!==ref.attempt||(action&&!same(intent.action,action)))throw oatsError("invalid-resolution","intent reference differs from indexed incarnation/action/attempt");
  return intent;
}
export function readCapturedIntent({deployment,home,intent:ref,action}) {
  const {row}=matchedRow(readCapturedInstanceIndex(deployment),home),intent=matchedIntent(row,ref,action);
  return {...intent,incarnationId:row.incarnationId};
}
export function beginCapturedIntent({deployment,home,intent:ref,action}) {
  return withPortableStateWrite(deployment,context=>{
    const index=readCapturedInstanceIndex(context.deployment),{row}=matchedRow(index,home),intent=matchedIntent(row,ref,action);
    if(intent.state!=="admitted")throw oatsError("selection-changed","captured intent has already begun or settled");
    intent.state="running";save(context,index);return intentRef(row,intent);
  });
}
export function settleCapturedIntent({deployment,home,intent:ref,action,state,receipt,replayable=false}) {
  if(typeof replayable!=="boolean")throw oatsError("invalid-declaration","invalid intent replay evidence");
  if(!["completed","unconfirmed","blocked"].includes(state))throw oatsError("invalid-declaration","invalid captured intent outcome");
  canonicalJson(receipt,RECEIPT_LIMITS);
  return withPortableStateWrite(deployment,context=>{
    const index=readCapturedInstanceIndex(context.deployment),{row}=matchedRow(index,home),intent=matchedIntent(row,ref,action);
    if((state==="blocked"&&intent.state!=="admitted")||(state!=="blocked"&&intent.state!=="running"))throw oatsError("selection-changed","intent outcome does not match its admitted/running attempt");
    intent.state=state;intent.receipt=receipt;intent.replayable=state==="completed"&&replayable;save(context,index);return intentRef(row,intent);
  });
}
