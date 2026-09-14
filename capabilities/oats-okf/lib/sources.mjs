import { randomUUID } from 'node:crypto';
import { fs, join, dirname, resolve, safePath, readJSON, save, atomic, materialize, hash, withLock, oats, fail, tree, overlaps, syncDir } from './io.mjs';
import { loadBindings, declaration, metadata, resolveNodes, bindingFingerprint, settings, validateBindings } from './config.mjs';
import { stageBase } from './stores.mjs';
export const markerPath = home => join(home,'.okf-source.json');
export const statusPath = source => join(dirname(source.file),'status.json');
export const saveStatus = (source,status) => save(statusPath(source),status);
export function updateStatus(source, mutate) {
  return withLock(join(dirname(source.file),'status.lock'),()=>{
    const status=loadStatus(source);mutate(status);saveStatus(source,status);return status;
  });
}
function saveCapture(source, status) {
  updateStatus(source,current=>{
    current.captured=status.captured;
    if(status.launchObserved!==undefined) current.launchObserved=status.launchObserved;
    if(status.lastCapture) current.lastCapture=status.lastCapture;
    if(status.retired) {current.retired=true;current.retiredAt=status.retiredAt;current.auto=current.auto && status.auto;}
  });
}
export const loadStatus = source => readJSON(statusPath(source));
export function loadSource(file) {
  safePath(file); const s=readJSON(file);
  if(s.version!==1 || !/^[0-9a-f-]{36}$/.test(s.id) || resolve(file)!==join(s.bindings.stateDir,'sources',s.id,'source.json')) fail('E_SOURCE','invalid source descriptor path/identity');
  const {file:bindingsFile,...bindingsDoc}=s.bindings;
  const checked=validateBindings(bindingsDoc,bindingsFile,{sourceHome:s.home,sourceWork:s.work});
  if(bindingFingerprint(checked)!==s.bindingFingerprint) fail('E_SOURCE','frozen bindings fingerprint mismatch');
  return {...s,file};
}
export function homeSource(home) { const m=readJSON(markerPath(home)); const s=loadSource(m.source); if(s.id!==m.id || s.home!==home) fail('E_SOURCE','home identity does not match durable source');return s; }
export function service(home) {
  if(fs.existsSync(join(home,'instance.json'))) return readJSON(join(home,'instance.json')).kind==='capability';
  return process.env.OATS_KIND==='capability';
}
// Control files live at the view root; arbitrary legal aliases live ONLY in
// bases/. Receipts use paths relative to the view so moving a prepared view
// into its final location cannot invalidate its navigation.
export function views(bindings, decl, target) {
  target=safePath(target); if(fs.existsSync(target)) fail('E_VIEW','view exists; use a new immutable view destination');
  const all={}; const receipts={};
  fs.mkdirSync(dirname(target),{recursive:true});
  const pending=fs.mkdtempSync(join(dirname(target),'.okf-view-'));
  try {
    for(const [alias,base] of Object.entries(bindings.bases)) {
      const scratch=fs.mkdtempSync(join(bindings.stateDir,'read-'));
      try {
        const staged=stageBase(base,join(scratch,'base'));
        all[alias]=staged.meta;
        const path=`bases/${alias}`;
        materialize(join(pending,path),staged.files);
        receipts[alias]={path,id:base.id,digest:staged.digest,head:staged.head || null,nodes:staged.meta.nodes};
      } finally { fs.rmSync(scratch,{recursive:true,force:true}); }
    }
    resolveNodes(decl,bindings,all);
    save(join(pending,'view.json'),{version:1,at:new Date().toISOString(),bases:receipts,owns:decl.owns,reads:decl.reads});
    // Never expose a partial view or remove/replace a caller's existing view.
    if(fs.existsSync(target)) fail('E_VIEW','view exists; use a new immutable view destination');
    fs.renameSync(pending,target);syncDir(dirname(target));
    return receipts;
  } finally { fs.rmSync(pending,{recursive:true,force:true}); }
}
const registrationView = source => join(source.home,`.okf-view-${source.id}`);
function finishRegistration(source) {
  const pending=safePath(registrationView(source)),target=safePath(join(source.home,'knowledge'));
  if(fs.existsSync(pending)) {
    if(fs.existsSync(target)) fail('E_VIEW','knowledge already exists; refusing to replace it with the registered view');
    fs.renameSync(pending,target);syncDir(source.home);
  }
  // A durable home pointer precedes publication. Failures after it was saved
  // resume this same source/view; they never reset captured evidence or IDs.
  const receipt=readJSON(join(target,'view.json'));
  if(source.acceptedView && JSON.stringify(receipt.bases)!==JSON.stringify(source.acceptedView)) fail('E_VIEW','registered accepted view receipt differs; preserve it and inspect');
  for(const [p,text] of [['STATE.md','# Working state\n\n# Task\n\n# Next\n'],['log.md','# Instance log\n']]) if(!fs.existsSync(join(source.home,p))) atomic(join(source.home,p),text);
  fs.mkdirSync(join(source.home,'notes'),{recursive:true});
  scheduleSource(source);return source;
}
export function register(home) {
  home=safePath(home);
  if(service(home)) return {skipped:'service'};
  if(fs.existsSync(markerPath(home))) return finishRegistration(homeSource(home));
  safePath(join(home,'knowledge'));
  if(fs.existsSync(join(home,'knowledge'))) fail('E_VIEW','unregistered knowledge view exists; preserve it and inspect before registering');
  if(['.okf-harvest-record.json','.okf-harvest-record.next.json'].some(p=>fs.existsSync(join(home,p))) && !fs.existsSync(join(home,'.okf-v1-migration.json'))) fail('E_MIGRATION','legacy source watermarks require explicit oats okf migrate --source-home PATH before v2 registration; no cursor is silently trusted');
  const meta=fs.existsSync(join(home,'instance.json'))?readJSON(join(home,'instance.json')):{};
  const soul=fs.realpathSync(process.env.OATS_SOUL || join(home,'soul'));
  const work=fs.existsSync(join(home,'work'))?fs.realpathSync(join(home,'work')):join(home,'work');
  const decl=declaration(soul);
  const bindings=loadBindings(undefined,{sourceHome:home,sourceWork:work});
  const context=fs.realpathSync(process.env.OATS_CONTEXT || meta.repo || fail('E_CONFIG','source requires durable config context'));
  if(overlaps(home,context) && context.startsWith(home)) fail('E_PATH','config context cannot be in disposable home');
  const agent=process.env.OATS_AGENT || meta.agent;
  const instance=process.env.OATS_INSTANCE || meta.instance;
  if(!agent || !instance) fail('E_SOURCE','source instance/agent required');
  fs.mkdirSync(bindings.stateDir,{recursive:true,mode:0o700});
  const ownersFile=join(bindings.stateDir,'owners.json');
  withLock(join(bindings.stateDir,'owners.lock'),()=>{
    const owners=fs.existsSync(ownersFile)?readJSON(ownersFile):{};
    if(Object.hasOwn(owners,decl.owner) && owners[decl.owner]!==soul) fail('E_OWNER','stable owner ID already identifies a different soul in this state namespace');
    owners[decl.owner]=soul;save(ownersFile,owners);
  });
  const id=randomUUID(); const dir=join(bindings.stateDir,'sources',id);
  // Copy only the role document, never instance.json wholesale, launch recipes,
  // environment, credentials, source worktree, or third-party message stores.
  const roleFile=safePath(join(soul,'AGENTS.md'));
  const role=fs.existsSync(roleFile)?fs.readFileSync(roleFile,'utf8'):'';
  if(Buffer.byteLength(role)>128*1024) fail('E_SOURCE','role document exceeds 128KiB; provide a concise role before registering');
  const source={version:1,id,home,work,context,agent,instance,owner:decl.owner,decl,role,bindings,bindingFingerprint:bindingFingerprint(bindings),execution:{runtime:settings()['harvest-runtime']||'pi',model:settings()['harvest-model']||null},created:new Date().toISOString()};
  const file=join(dir,'source.json');
  const pending=registrationView(source);
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  try {
    source.acceptedView=views(bindings,decl,pending);
    source.acceptedNodes=Object.fromEntries(Object.entries(source.acceptedView).map(([alias,r])=>[alias,r.nodes]));
    save(file,source);
    save(join(dir,'status.json'),{version:1,captured:{notes:[],threads:{},inputs:[]},processed:[],delivered:{},accepted:{},retired:false,auto:true,activeRun:null});
    save(markerPath(home),{version:1,id,source:file});
  } catch(e) {
    // Until the pointer is durable no capture or schedule can reference these
    // files. Leave an installed pointer's state intact even if fsync failed.
    if(!fs.existsSync(markerPath(home))) {
      fs.rmSync(pending,{recursive:true,force:true});
      fs.rmSync(dir,{recursive:true,force:true});
    }
    throw e;
  }
  return finishRegistration({...source,file});
}
function enqueue(source,status,payload) {
  const id=hash(payload);const path=join(dirname(source.file),'inputs',`${id}.json`);
  if(!fs.existsSync(path)) save(path,payload);
  if(!status.captured.inputs.includes(id)) status.captured.inputs.push(id);
  return id;
}
export function input(source,id) {
  if(!/^[0-9a-f]{64}$/.test(id)) fail('E_INPUT','bad input identity');
  const value=readJSON(join(dirname(source.file),'inputs',`${id}.json`));
  if(hash(value)!==id) fail('E_INPUT','durable evidence hash mismatch');return value;
}
export function capture(source,{final=false,deadlineMs=85000}={}) {
  return withLock(join(dirname(source.file),'capture.lock'),()=>{
    const status=loadStatus(source);
    if(status.retired) return {status:'complete',complete:true,retired:true};
    if(!fs.existsSync(markerPath(source.home))) fail('E_SOURCE','source home gone without final capture; existing evidence is retained');
    if(homeSource(source.home).id!==source.id) fail('E_SOURCE','source name reused');
    const start=Date.now(); const meta=fs.existsSync(join(source.home,'instance.json'))?readJSON(join(source.home,'instance.json')):{};
    const noLaunch=meta.launched!==true;status.launchObserved=!noLaunch;
    // Notes AND record, every pass. Note content versions remain captured even
    // when the live file is rewritten while a worker is judging a prior version.
    const notes=join(source.home,'notes');
    if(fs.existsSync(notes)) for(const [name,b64] of Object.entries(tree(notes))) {
      if(!name.endsWith('.md')) continue;
      const text=Buffer.from(b64,'base64').toString('utf8');const key=hash({name,text});
      if(status.captured.notes.includes(key)) continue;
      enqueue(source,status,{version:1,kind:'note',name,contentHash:hash(text),text});
      status.captured.notes.push(key);saveCapture(source,status);
    }
    let report;
    try {
      report=oats(['capture','--home',source.home,'--quiet'],source.context,{native:true,timeout:Math.min(deadlineMs,60000)});
      if(!Array.isArray(report.sessions)) fail('E_CAPTURE','capture response has no sessions');
      for(const session of report.sessions) {
        if(!session.thread || !session.lastTurnId) continue;
        let after=status.captured.threads[session.thread] || null;
        while(after!==session.lastTurnId) {
          if(Date.now()-start>deadlineMs) fail('E_CAPTURE','capture deadline: backlog preserved; retire must retry');
          const args=['recall','--thread',session.thread,'--until',session.lastTurnId,'--limit','60','--json','--ids-only'];
          if(after) args.push('--after',after);
          const remainingTime=()=>{
            const remaining=deadlineMs-(Date.now()-start);
            if(remaining<=0) fail('E_CAPTURE','capture deadline: backlog preserved; retire must retry');
            return Math.max(1000,remaining);
          };
          let plan;
          try { plan=oats(args,source.context,{native:true,timeout:remainingTime()}); }
          catch(e) { if(after && /--after: no turn/.test(e.message)) {after=null;continue;} throw e; }
          if(!Array.isArray(plan.turns) || !plan.turns.length || plan.turns.length>60) fail('E_CAPTURE','capture/recall boundaries disagree');
          // Plan BEFORE requesting text. Native bytes describe each turn in
          // pretty JSON. Nested response indentation adds bytes: reserve 3x
          // that estimate plus envelope space, always below the 16MiB pipe.
          // The 96k target is soft only for one individually legal turn.
          let offset=0;
          while(offset<plan.turns.length) {
            const window=[];let bytes=0;
            for(const t of plan.turns.slice(offset)) {
              if(typeof t.id!=='string' || !t.id || t.thread!==session.thread || t.kind!=='session' || !Number.isSafeInteger(t.bytes) || t.bytes<=0) fail('E_CAPTURE','invalid ids-only record metadata');
              if(window.length && bytes+t.bytes>96000) break;
              if(3*(bytes+t.bytes)+4096>16*1024*1024) fail('E_CAPTURE','single captured turn exceeds bounded transport; input retained at source, manual intervention required');
              window.push(t);bytes+=t.bytes;
            }
            const until=window.at(-1).id;
            const read=['recall','--thread',session.thread,'--until',until,'--limit',String(window.length),'--json'];
            if(after) read.push('--after',after);
            const full=oats(read,source.context,{native:true,timeout:remainingTime()});
            if(!Array.isArray(full.turns) || full.turns.length!==window.length || full.remaining!==0) fail('E_CAPTURE','planned record window changed; retain source and retry');
            const turns=full.turns.map((t,i)=>{
              const turn={id:t.id,ts:t.ts,thread:t.thread,kind:t.kind,source:t.source,text:t.text};
              if(['id','ts','thread','kind','source'].some(k=>turn[k]!==window[i][k]) || !Array.isArray(turn.text) || turn.text.some(p=>typeof p.role!=='string' || typeof p.text!=='string')) fail('E_CAPTURE','unsupported or changed captured session record');
              if(Buffer.byteLength(JSON.stringify(turn))>1024*1024) fail('E_CAPTURE','single captured turn exceeds 1MiB; input retained at source, manual intervention required');
              return turn;
            });
            // Commit evidence before its cursor; failures retain earlier windows.
            enqueue(source,status,{version:1,kind:'record',thread:session.thread,after,until,turns});
            after=until;status.captured.threads[session.thread]=after;saveCapture(source,status);
            offset+=window.length;
          }
          if(plan.remaining===0 && after!==session.lastTurnId) fail('E_CAPTURE','final record boundary missing');
        }
      }
      status.lastCapture={status:report.status,complete:report.complete===true,ignored:report.ignored||0,at:new Date().toISOString()};
      if(report.complete!==true) fail('E_CAPTURE',`capture ${report.status || 'uncertified'}: retain source and retry`);
      if(final) {status.retired=true;status.auto=status.auto && !noLaunch;status.retiredAt=new Date().toISOString();}
      saveCapture(source,status);return {...status.lastCapture,inputs:status.captured.inputs.length};
    } catch(e) {
      status.lastCapture={status:'incomplete',complete:false,error:e.message,at:new Date().toISOString()}; saveCapture(source,status);throw e;
    }
  });
}
export function scheduleSource(source) {
  const spec={id:`okf-${source.id}`,kind:'command',enabled:loadStatus(source).auto,cron:source.bindings.cron,tz:source.bindings.tz,cwd:source.context,argv:['oats','okf','run-source','--source',source.file,'--soul',source.agent,'--json']};
  const file=join(dirname(source.file),'schedule.json');
  try {
    save(file,spec);
    let result;
    try {result=oats(['schedule','add',spec.id,'--file',file,'--dir',source.context,'--json'],source.context);}
    catch(e) {
      // Never overwrite a colliding job or re-enable an operator-disabled job.
      // Retry after an uncertain add must verify the actual definition, not a
      // local receipt. A deleted definition is recreated by the add above.
      if(e.code!=='E_SCHEDULE_EXISTS') throw e;
      result=oats(['schedule','show',spec.id,'--dir',source.context,'--json'],source.context);
    }
    const actual=result?.schedule;
    if(!actual || typeof actual.enabled!=='boolean' || ['id','kind','cron','tz','cwd','argv'].some(k=>JSON.stringify(actual[k])!==JSON.stringify(spec[k]))) fail('E_SCHEDULE','source schedule definition differs; inspect and repair explicitly');
    updateStatus(source,status=>{status.schedule={id:spec.id,status:'ready',result};});return result;
  } catch(e) {
    updateStatus(source,status=>{status.schedule={...(status.schedule || {}),id:spec.id,status:'failed',error:e.message};});throw e;
  }
}
