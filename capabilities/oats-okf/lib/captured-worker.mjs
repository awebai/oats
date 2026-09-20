// Captured worker PUBLIC consumer. No kernel imports/index reads, legacy source
// discovery, fake admission, auth handling, backend defaults or history repair.
import {fs,join,resolve,safePath,exec,cliPath,hash,fail} from './io.mjs';
import {isAbsolute} from 'node:path';
import {parseBindingJson,BINDING_WIRE_LIMITS} from './binding-wire.mjs';
import {assertOkfSourceContext,requireOkfAdmittedAction} from './invocation-context.mjs';
import {sameInvocationJson as same} from './invocation-shape.mjs';
export const CAPTURED_WORKER_KEY='oats.okf:memory-harvest';
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const abs=v=>typeof v==='string'&&isAbsolute(v)&&resolve(v)===v&&!v.includes('\0');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export const capturedSource=s=>['providerBinding','executionBinding','registration'].some(k=>Object.hasOwn(s,k));
function binding(v){if(!obj(v)||v.schemaVersion!==1||!abs(v.deployment)||v.resolution?.schemaVersion!==1||!/^sha256-[a-f0-9]{64}$/.test(v.resolution.id))fail('E_CAPTURED_HELPER','invalid public execution binding');return v;}
export function workerCallEnvironment(inherited){
  // Preserve native HOME/profile/auth/Git helpers and the active OATS data
  // scope, not invoking instance selectors (including legacy PI_AGENT aliases).
  const env={...inherited};for(const key of Object.keys(env))if(/^(OATS_(?!HOME_DIR$)|OAS_|PI_AGENT_)/.test(key)||key==='PI_AGENTS_ROOT')delete env[key];
  return env;
}
export function publicWorkerCall(source,args){
  let text,status=0;
  const env=workerCallEnvironment(process.env);
  try{text=exec(cliPath(),args,{cwd:source.context,env,timeout:90000});}
  catch(error){text=error.stdout;status=error.status??null;}
  let envelope;try{envelope=parseBindingJson(Buffer.from(text||''),BINDING_WIRE_LIMITS);}catch{fail('E_CAPTURED_HELPER_UNKNOWN','public helper outcome is unknown; retain run/home, never re-scaffold');}
  if(envelope.schemaVersion!==1||typeof envelope.ok!=='boolean')fail('E_CAPTURED_HELPER_UNKNOWN','invalid public helper response');
  if(status!==0||!envelope.ok){const error=Object.assign(new Error('public captured helper action refused or is uncertain; retain custody'),{code:'E_CAPTURED_HELPER_UNKNOWN',publicObservation:{status,envelope}});throw error;}
  if(!obj(envelope.result))fail('E_CAPTURED_HELPER_UNKNOWN','public helper result missing');return envelope.result;
}
export function readWorkerEndpoint(file){
  if(!abs(file))fail('E_CAPTURED_HELPER','captured harvest needs an explicit absolute native-request');safePath(file);let fd;
  try{
    fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const before=fs.fstatSync(fd);if(!before.isFile()||before.size>BINDING_WIRE_LIMITS.bytes)fail('E_CAPTURED_HELPER','invalid bounded native request');
    const buffer=Buffer.alloc(before.size+1);let n=0,k;while(n<buffer.length&&(k=fs.readSync(fd,buffer,n,buffer.length-n,null)))n+=k;
    const after=fs.fstatSync(fd);if(n!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)fail('E_CAPTURED_HELPER','native request changed');
    const value=parseBindingJson(buffer.subarray(0,n),BINDING_WIRE_LIMITS);
    if(!obj(value)||value.schemaVersion!==1||!obj(value.backend)||Object.keys(value).some(k=>!['schemaVersion','backend','stopGraceMs'].includes(k)))fail('E_CAPTURED_HELPER','worker native-request allows backend/stopGraceMs only; provider owns task');
    const b=value.backend,allowed=b.backend==='tmux'?['backend','binary','socket','session']:b.backend==='herdr'?['backend','binary','socket','protocol']:[];
    if(!allowed.length||Object.keys(b).length!==allowed.length||!allowed.every(k=>Object.hasOwn(b,k))||!abs(b.binary)||!abs(b.socket))fail('E_CAPTURED_HELPER','unsupported exact backend request');
    if(b.backend==='tmux'&&(typeof b.session!=='string'||!b.session||/[\r\n\0]/.test(b.session)))fail('E_CAPTURED_HELPER','invalid tmux endpoint');
    if(b.backend==='herdr'&&![20,22].includes(b.protocol))fail('E_CAPTURED_HELPER','unknown Herdr protocol');
    if(value.stopGraceMs!==undefined&&(!Number.isSafeInteger(value.stopGraceMs)||value.stopGraceMs<1||value.stopGraceMs>300000))fail('E_CAPTURED_HELPER','invalid stop grace');
    return JSON.parse(JSON.stringify(value));
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function qualifyCapturedWorker(source,{context,nativeRequest}={},call=publicWorkerCall){
  if(!context||source.registration?.schemaVersion!==1||source.registration.kind!=='captured')fail('E_CAPTURED_HELPER','captured worker needs registered SOURCE and current admitted operation');
  requireOkfAdmittedAction(context);assertOkfSourceContext(source,context,source.providerBinding);
  if(context.action.kind!=='operation'||context.action.slot!=='knowledge'||context.action.name!=='harvest'||context.subject.kind!=='persistent')fail('E_CAPTURED_HELPER','only admitted SOURCE knowledge:harvest may create a captured worker');
  const manifest=JSON.parse(fs.readFileSync(new URL('../oats.json',import.meta.url),'utf8'));
  if((manifest.requires||[]).some(r=>obj(r)&&r.runtime==='pi')||manifest.hooks?.launch)fail('E_CAPTURED_HELPER','required Pi plugin/launch behavior is not qualified by this captured slice');
  const request=readWorkerEndpoint(nativeRequest),sourceBinding=binding(source.executionBinding);
  const inspected=call(source,['inspect','--deployment',sourceBinding.deployment,'--resolution',sourceBinding.resolution.id,'--helper',CAPTURED_WORKER_KEY,'--json']);
  return validateWorkerSelection(source,context,request,inspected);
}
export function validateWorkerSelection(source,context,request,inspected){
  const selected=inspected?.helperSelection;
  if(selected?.schemaVersion!==1||!same(selected.sourceExecutionBinding,source.executionBinding)||selected.workMode!=='directory'||!same(selected.context,context.context)||!same(selected.responsibleHuman,source.responsibleHuman))fail('E_CAPTURED_HELPER','helper SOURCE/context/human/work correspondence is unqualified');
  const h=selected.helper,subject=h?.subject;
  if(h?.key!==CAPTURED_WORKER_KEY||h.name!=='memory-harvest'||subject?.kind!=='helper'||subject.name!==h.name||subject.provider?.kind!=='capability'||subject.provider.capability!=='oats.okf'||!same(subject.provider,subject.definition?.owner))fail('E_CAPTURED_HELPER','wrong qualified helper identity');
  const api={schemaVersion:1,api:{contract:'oats.captured-session',version:2,available:true,backends:['tmux','herdr']},readiness:{status:'not-checked'}};
  if(!same(selected.launch,api)||!same(inspected.nativeSession,api))fail('E_CAPTURED_HELPER','unknown captured native public API');
  // Preserve the exact retained selection. Ordinary Claude/Codex may select
  // null to use their own native model configuration; Pi's strict SDK slice
  // still needs an explicit model and its previously qualified sole-OKF profile.
  // API availability/approval is NOT native readiness. The unchanged public
  // scaffold/start path enforces the entire retained resource/hook closure.
  const launch=selected.launchSelection;
  if(!obj(launch)||launch.runtime!==source.execution.runtime||!['pi','claude','codex'].includes(launch.runtime)
    || !(launch.model===null?launch.runtime!=='pi':typeof launch.model==='string'&&!!launch.model.trim())
    || (source.execution.model!==null&&launch.model!==source.execution.model))fail('E_CAPTURED_HELPER','retained helper launch runtime/model missing or mismatched');
  const capabilities=inspected.capabilities;
  if(!Array.isArray(capabilities)||!capabilities.length||capabilities.some(c=>!obj(c)||typeof c.id!=='string'||!/^(?:@?[a-z0-9][a-z0-9._-]*[./])[a-z0-9][a-z0-9._/-]*$/.test(c.id)||!['approved','not-required'].includes(c.approval))
    || new Set(capabilities.map(c=>c.id)).size!==capabilities.length||!capabilities.some(c=>c.id==='oats.okf'&&c.approval==='approved'))fail('E_CAPTURED_HELPER','complete selected helper capability closure requires current approval');
  if(launch.runtime==='pi'&&capabilities.length!==1)fail('E_CAPTURED_HELPER','enriched strict-Pi helper profile is not qualified; required capabilities were not removed');
  if(binding(selected.executionBinding).deployment!==source.executionBinding.deployment||!same(inspected.resolution,selected.executionBinding.resolution))fail('E_CAPTURED_HELPER','helper inspection resolution/deployment differs');
  return {schemaVersion:1,sourceBinding:JSON.parse(JSON.stringify(source.executionBinding)),helperBinding:JSON.parse(JSON.stringify(selected.executionBinding)),helper:JSON.parse(JSON.stringify(h)),request,requestHash:hash(request),sourceIntent:JSON.parse(JSON.stringify(context.intent)),sourceIncarnationId:context.instance.incarnationId,launchSelection:JSON.parse(JSON.stringify(launch))};
}
export function assertCapturedRun(source,run,plan){
  const prior=run.capturedWorker;
  if(!prior||prior.schemaVersion!==1||!same(prior.sourceBinding,source.executionBinding)||!same(prior.helperBinding,plan.helperBinding)||!same(prior.helper,plan.helper)||prior.sourceIncarnationId!==plan.sourceIncarnationId||prior.requestHash!==plan.requestHash||hash(prior.request)!==prior.requestHash||!same(prior.request,plan.request)||!same(prior.launchSelection,plan.launchSelection))fail('E_CAPTURED_HELPER','existing run authority/endpoint changed; no replacement worker');
  if(['spawn-intent','scaffold-unknown','scaffolded','launch-intent','launch-unknown'].includes(run.status))fail('E_CAPTURED_HELPER_UNKNOWN','existing worker outcome requires explicit custody recovery; no duplicate dispatch');
}
export function capturedScaffold(source,run,home,call=publicWorkerCall){
  const p=run.capturedWorker,b=p.helperBinding;
  const result=call(source,['spawn',p.helper.name,'--deployment',b.deployment,'--resolution',b.resolution.id,'--home',home,'--no-launch','--json']);
  if(result.home!==home||!uuid(result.incarnationId)||!same(result.executionBinding,b)||result.launchPending!==true||result.hooksPending!==false||result.cleanupRequired!==false||result.agent!==p.helper.name||result.work!=='directory'||typeof result.instance!=='string')fail('E_CAPTURED_HELPER_UNKNOWN','scaffold receipt lacks exact completed helper custody');
  return result;
}
function directoryCustody(home){
  const result={};for(const [key,path] of [['home',home],['work',join(home,'work')]]){safePath(path);const s=fs.lstatSync(path);if(!s.isDirectory()||!Number.isSafeInteger(s.dev)||!Number.isSafeInteger(s.ino))fail('E_WORKER','original worker directories unavailable');result[key]={dev:s.dev,ino:s.ino};}return result;
}
export function retainCapturedWorkerCustody(run,meta){
  // Observe the EXISTING kernel home/work proof after the real public scaffold;
  // do not mint a new incarnation or read/modify its private kernel index.
  const actual=directoryCustody(run.worker.home);
  if(!same(meta.captured?.custody,actual)||meta.incarnationId!==run.worker.incarnationId||!same(meta.executionBinding,run.capturedWorker.helperBinding))fail('E_WORKER','scaffold metadata/directory proof mismatch');
  return JSON.parse(JSON.stringify(meta.captured.custody));
}
export function assertCapturedWorkerHome(source,run,meta,home){
  const p=run.capturedWorker;if(!p||home!==run.worker.home||!same(p.sourceBinding,source.executionBinding)||!same(meta.executionBinding,p.helperBinding)||meta.incarnationId!==run.worker.incarnationId||meta.kind!=='helper'||meta.agent!==p.helper.name||!same(meta.captured?.custody,p.workerDirectoryCustody)||!same(directoryCustody(home),p.workerDirectoryCustody))fail('E_WORKER','captured worker incarnation/binding/subject/directory mismatch');
}
export function capturedStart(source,run,requestFile,call=publicWorkerCall){
  const p=run.capturedWorker,b=p.sourceBinding;
  const result=call(source,['session','start','--deployment',b.deployment,'--resolution',b.resolution.id,'--helper',p.helper.key,'--home',run.worker.home,'--request',requestFile,'--json']);
  if(result.home!==run.worker.home||result.incarnationId!==run.worker.incarnationId||!same(result.executionBinding,p.helperBinding)||!same(result.sourceExecutionBinding,b)||!same(result.helper,p.helper)||result.dispatchAccepted!==true||result.intent?.incarnationId!==run.worker.incarnationId||typeof result.intent?.executionId!=='string'||result.runtime!==p.launchSelection.runtime||result.model!==p.launchSelection.model)fail('E_CAPTURED_HELPER_UNKNOWN','native result lacks exact helper dispatch custody');
  return result;
}
