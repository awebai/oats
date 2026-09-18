// Controlled record-library fixtures only. No kernel admission, SDK, model,
// backend or native auth operation; supplied admission tuples are unit inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { CAPTURED_PI_RECORD_VERSION, initializeNativeHistory, nativeHistoryPath, inspectCapturedPiRoot, prepareCapturedPiStart, recordNativeStart, assertCapturedPiStart, historicalSessionRoots, prepareNativeStart } from '../lib/native-history.mjs';
import { sessionsForHome, sessionAttribution } from '../lib/sessions-for-home.mjs';
import { captureSessions } from '../lib/capture-cc.mjs';
import { SESSION_FORMATS } from '../lib/formats.mjs';
import { RecordStore } from '../lib/store.mjs';
const inc='11111111-1111-4111-8111-111111111111', ts='2026-09-18T10:00:00.000Z';
function fixture(t){
 const base=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'captured-pi-record-')));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const home=join(base,'home');fs.mkdirSync(home);initializeNativeHistory(home);
 const history=nativeHistoryPath(home),sessionDir=join(dirname(history),basename(history)+'.pi');
 const intent={schemaVersion:1,incarnationId:inc,executionId:'original-dispatch',attempt:1};
 const inspect={incarnationId:inc,sessionDir},authority={...inspect,intent,assertAuthority:()=>{}};
 const file=join(sessionDir,'actual.jsonl'),store=new RecordStore(join(base,'journal'),{owner:'fixture'});
 const row=id=>JSON.parse(fs.readFileSync(join(history,id+'.json'),'utf8'));
 const env=ref=>({HOME:base,OATS_INSTANCE_HOME:home,OATS_INCARNATION_ID:inc,OATS_EXECUTION_ID:ref.executionId,OATS_EXECUTION_ATTEMPT:String(ref.attempt)});
 const start=(a=authority)=>{const id=prepareCapturedPiStart(home,a);recordNativeStart(home,id,'pi',['--session-dir',sessionDir],env(a.intent));return id;};
 const transcript=()=>{fs.writeFileSync(file,JSON.stringify({type:'session',id:'actual',cwd:home,timestamp:ts})+'\n'+JSON.stringify({type:'message',timestamp:ts,message:{role:'assistant',content:'controlled record fixture'}})+'\n');};
 const replace=(link=false)=>{const old=join(base,'preserved-root');fs.renameSync(sessionDir,old);if(link)fs.symlinkSync(old,sessionDir);else fs.mkdirSync(sessionDir);return old;};
 return {base,home,history,sessionDir,inspect,authority,intent,file,store,row,env,start,transcript,replace};
}
function patchFs(name,fn,body){const original=fs[name];fs[name]=fn(original);syncBuiltinESMExports();try{return body();}finally{fs[name]=original;syncBuiltinESMExports();}}

test('v2 fresh inspection is read-only; pending is durable before exclusive root establishment',t=>{
 const f=fixture(t),before=fs.readdirSync(f.history);assert.equal(CAPTURED_PI_RECORD_VERSION,2);
 assert.equal(inspectCapturedPiRoot(f.home,f.inspect),undefined);assert.deepEqual(fs.readdirSync(f.history),before);assert.equal(fs.existsSync(f.sessionDir),false);
 let sawPending=false;
 const id=prepareCapturedPiStart(f.home,{...f.authority,assertAuthority:()=>{
  for(const name of fs.readdirSync(f.history).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n))){const r=f.row(name.slice(0,-5));if(r.state==='pending'&&!fs.existsSync(f.sessionDir)){assert.equal(r.rootWitness,null);sawPending=true;}}
 }});
 assert.ok(sawPending);const row=f.row(id);assert.equal(row.state,'root-established');assert.equal(row.rootWitness.establishedBy.nativeRecordId,id);assert.deepEqual(row.rootWitness.establishedBy.intent,f.intent);assert.equal(row.startedAt,undefined);assert.equal(row.locations,undefined);
 const stat=fs.lstatSync(f.sessionDir);assert.deepEqual(row.rootWitness.identity,{dev:stat.dev,ino:stat.ino});
 assert.throws(()=>inspectCapturedPiRoot(f.home,f.inspect));assert.throws(()=>assertCapturedPiStart(f.home,id,{...f.inspect,intent:f.intent}));
 recordNativeStart(f.home,id,'pi',['--session-dir',f.sessionDir],f.env(f.intent));assertCapturedPiStart(f.home,id,{...f.inspect,intent:f.intent});
 assert.equal(f.row(id).state,'started');assert.deepEqual(f.row(id).locations,[f.sessionDir]);
});
test('existing unwitnessed root or caller-injected inode never authorizes adoption',t=>{
 const f=fixture(t);assert.throws(()=>prepareCapturedPiStart(f.home,{...f.authority,identity:{dev:1,ino:2}}));assert.deepEqual(fs.readdirSync(f.history),['history.json']);
 fs.mkdirSync(f.sessionDir);assert.throws(()=>inspectCapturedPiRoot(f.home,f.inspect));assert.throws(()=>prepareCapturedPiStart(f.home,f.authority));assert.deepEqual(fs.readdirSync(f.history),['history.json']);
});
test('interrupted pending and mkdir-before-witness remain held without recreation or cleanup',t=>{
 for(const afterMkdir of [false,true]){
  const f=fixture(t);
  assert.throws(()=>prepareCapturedPiStart(f.home,{...f.authority,assertAuthority:()=>{
   const pending=fs.readdirSync(f.history).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n));
   if(pending.length&&(afterMkdir?fs.existsSync(f.sessionDir):!fs.existsSync(f.sessionDir)))throw new Error('injected lost authority');
  }}),/lost authority/);
  const names=fs.readdirSync(f.history);assert.ok(names.some(n=>/^[a-f0-9-]{36}\.json$/.test(n)));assert.equal(fs.existsSync(f.sessionDir),afterMkdir);
  assert.throws(()=>inspectCapturedPiRoot(f.home,f.inspect));assert.throws(()=>prepareCapturedPiStart(f.home,f.authority));assert.deepEqual(fs.readdirSync(f.history),names);
 }
});
test('failed witness publication preserves pending and uncertain root; no repair or adoption',t=>{
 const f=fixture(t);
 patchFs('renameSync',original=>(from,to)=>{
  if(String(from).endsWith('.tmp')&&JSON.parse(fs.readFileSync(from,'utf8')).state==='root-established')throw new Error('injected publication failure');
  return original(from,to);
 },()=>assert.throws(()=>prepareCapturedPiStart(f.home,f.authority),/publication failure/));
 assert.ok(fs.existsSync(f.sessionDir));assert.ok(fs.readdirSync(f.history).some(n=>n.endsWith('.tmp')));
 assert.throws(()=>inspectCapturedPiRoot(f.home,f.inspect));assert.throws(()=>prepareCapturedPiStart(f.home,f.authority));
});
test('unchanged recorder bin consumes established v2 with actual argv and execution environment',t=>{
 const f=fixture(t),id=prepareCapturedPiStart(f.home,f.authority),bin=new URL('../bin/record-native-start.mjs',import.meta.url).pathname;
 const run=args=>spawnSync(process.execPath,[bin,f.home,id,'pi',JSON.stringify(args)],{env:{...process.env,...f.env(f.intent)},encoding:'utf8',timeout:10000});
 const bad=run(['--session-dir',join(f.base,'wrong')]);assert.equal(bad.status,1);assert.equal(f.row(id).state,'root-established');
 const good=run(['--session-dir',f.sessionDir]);assert.equal(good.status,0,good.stderr);assertCapturedPiStart(f.home,id,{...f.inspect,intent:f.intent});
});
test('execution recorder rejects foreign/duplicate native session directory and wrong original intent',t=>{
 const f=fixture(t),id=prepareCapturedPiStart(f.home,f.authority),before=fs.readFileSync(join(f.history,id+'.json'));
 for(const args of [[],['--session-dir',join(f.base,'foreign')],['--session-dir',f.sessionDir,'--session-dir',f.sessionDir],['--session',f.file]])assert.throws(()=>recordNativeStart(f.home,id,'pi',args,f.env(f.intent)));
 assert.throws(()=>recordNativeStart(f.home,id,'pi',['--session-dir',f.sessionDir],{...f.env(f.intent),OATS_EXECUTION_ATTEMPT:'2'}));assert.deepEqual(fs.readFileSync(join(f.history,id+'.json')),before);
 recordNativeStart(f.home,id,'pi',['--session-dir',f.sessionDir],f.env(f.intent));assert.throws(()=>recordNativeStart(f.home,id,'pi',['--session-dir',f.sessionDir],f.env(f.intent)));
});
test('known same-incarnation restart preserves establishing witness; replay cannot create another native ID',t=>{
 const f=fixture(t),first=f.start(),original=f.row(first),before=fs.readdirSync(f.history);
 assertCapturedPiStart(f.home,first,{...f.inspect,intent:f.intent});assert.throws(()=>prepareCapturedPiStart(f.home,f.authority));assert.deepEqual(fs.readdirSync(f.history),before);
 const next={...f.authority,intent:{...f.intent,executionId:'distinct-restart'}};const second=f.start(next);
 assert.notEqual(second,first);assert.deepEqual(f.row(second).rootWitness,original.rootWitness);assert.deepEqual(f.row(first),original);
 assert.throws(()=>inspectCapturedPiRoot(f.home,{...f.inspect,incarnationId:'22222222-2222-4222-8222-222222222222'}));
 fs.renameSync(join(f.history,first+'.json'),join(f.base,'preserved-establishing.json'));
 assert.throws(()=>assertCapturedPiStart(f.home,second,{...f.inspect,intent:next.intent}));assert.throws(()=>sessionsForHome(f.home));
});
test('loss of both established receipt and root cannot be mistaken for genuinely fresh absence',t=>{
 const f=fixture(t),id=f.start();fs.renameSync(join(f.history,id+'.json'),join(f.base,'preserved-receipt.json'));fs.renameSync(f.sessionDir,join(f.base,'preserved-root'));
 assert.throws(()=>inspectCapturedPiRoot(f.home,f.inspect));
 assert.throws(()=>prepareCapturedPiStart(f.home,{...f.authority,intent:{...f.intent,executionId:'must-not-recreate'}}));
});
test('durable expected-ID claim survives crash before pending publication without repair',t=>{
 const f=fixture(t),file=join(f.history,'history.json');
 assert.throws(()=>prepareCapturedPiStart(f.home,{...f.authority,assertAuthority:()=>{
  const h=JSON.parse(fs.readFileSync(file));if(h.version===2)throw new Error('injected after inventory extension');
 }}),/inventory extension/);
 const header=JSON.parse(fs.readFileSync(file));assert.equal(header.version,2);assert.equal(header.capturedPi.nativeRecordIds.length,1);assert.deepEqual(fs.readdirSync(f.history),['history.json']);assert.equal(fs.existsSync(f.sessionDir),false);
 assert.throws(()=>inspectCapturedPiRoot(f.home,f.inspect));assert.throws(()=>prepareCapturedPiStart(f.home,f.authority));assert.throws(()=>sessionsForHome(f.home));assert.deepEqual(JSON.parse(fs.readFileSync(file)),header);
});
test('loss of a later pending row remains incomplete with the original witness still present',t=>{
 const f=fixture(t),first=f.start();f.transcript();const files=sessionsForHome(f.home);
 assert.throws(()=>prepareCapturedPiStart(f.home,{...f.authority,intent:{...f.intent,executionId:'later-uncertain'},assertAuthority:()=>{
  for(const name of fs.readdirSync(f.history).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)))if(f.row(name.slice(0,-5)).state==='pending')throw new Error('injected later pending');
 }}),/later pending/);
 const header=JSON.parse(fs.readFileSync(join(f.history,'history.json'))),later=header.capturedPi.nativeRecordIds.find(id=>id!==first);assert.ok(later);
 fs.renameSync(join(f.history,later+'.json'),join(f.base,'preserved-later-receipt.json'));
 assert.throws(()=>sessionsForHome(f.home));assert.throws(()=>captureSessions(f.store,{owner:'fixture',files,format:'pi',final:true}));assert.deepEqual(f.store.listStreams(),[]);assert.equal(f.row(first).state,'started');
});
test('missing manifest cannot be reinitialized by captured or legacy paths',t=>{
 for(const started of [false,true]){
  const f=fixture(t);if(started)f.start();fs.renameSync(join(f.history,'history.json'),join(f.base,'preserved-manifest.json'));const before=fs.readdirSync(f.history);
  for(const call of [()=>inspectCapturedPiRoot(f.home,f.inspect),()=>prepareCapturedPiStart(f.home,f.authority),()=>historicalSessionRoots(f.home,{withProof:true}),()=>initializeNativeHistory(f.home),()=>prepareNativeStart(f.home,'pi')])assert.throws(call);
  assert.deepEqual(fs.readdirSync(f.history),before);assert.equal(fs.existsSync(join(f.history,'history.json')),false);
 }
});
test('manifest rejects duplicate/invalid/missing IDs, foreign incarnation and unlisted v2 rows',t=>{
 for(const change of [h=>({...h,extra:true}),h=>({...h,completeHistory:false}),h=>({...h,capturedPi:{...h.capturedPi,nativeRecordIds:[]}}),h=>({...h,capturedPi:{...h.capturedPi,nativeRecordIds:[...h.capturedPi.nativeRecordIds,...h.capturedPi.nativeRecordIds]}}),h=>({...h,capturedPi:{...h.capturedPi,nativeRecordIds:['invalid']}}),h=>({...h,capturedPi:{...h.capturedPi,incarnationId:'22222222-2222-4222-8222-222222222222'}})]){
  const f=fixture(t);f.start();const path=join(f.history,'history.json'),header=JSON.parse(fs.readFileSync(path));fs.writeFileSync(path,JSON.stringify(change(header)));assert.throws(()=>inspectCapturedPiRoot(f.home,f.inspect));assert.throws(()=>sessionsForHome(f.home));
 }
 const f=fixture(t),id=f.start(),extra='33333333-3333-4333-8333-333333333333';fs.writeFileSync(join(f.history,extra+'.json'),JSON.stringify({...f.row(id),id:extra}),{mode:0o600});assert.throws(()=>sessionsForHome(f.home));
});
test('captured forward transition refuses incomplete or previously used v1 history literally',t=>{
 for(const used of [false,true]){
  const f=fixture(t),file=join(f.history,'history.json');
  if(used){const id=prepareNativeStart(f.home,'claude');recordNativeStart(f.home,id,'claude',[],{HOME:f.base});}
  else fs.writeFileSync(file,JSON.stringify({version:1,home:f.home,completeHistory:false}));
  const before=fs.readFileSync(file),names=fs.readdirSync(f.history);assert.throws(()=>inspectCapturedPiRoot(f.home,f.inspect));assert.throws(()=>prepareCapturedPiStart(f.home,f.authority));assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readdirSync(f.history),names);
 }
 const f=fixture(t);f.start();assert.throws(()=>prepareNativeStart(f.home,'pi'));assert.equal(JSON.parse(fs.readFileSync(join(f.history,'history.json'))).version,2,'old version1 readers cannot accept the new manifest');
});
test('closed v2 codec rejects extra fields, cyclic proof and unsupported version without fallback',t=>{
 for(const mutate of [r=>({...r,extra:true}),r=>({...r,version:3}),r=>({...r,rootWitness:{...r.rootWitness,extra:true}}),r=>({...r,rootWitness:{...r.rootWitness,establishedBy:{...r.rootWitness.establishedBy,nativeRecordId:'33333333-3333-4333-8333-333333333333'}}})]){
  const f=fixture(t),id=f.start();fs.writeFileSync(join(f.history,id+'.json'),JSON.stringify(mutate(f.row(id))));assert.throws(()=>sessionsForHome(f.home));assert.throws(()=>inspectCapturedPiRoot(f.home,f.inspect));
 }
});
for(const link of [false,true])test(`replaced ${link?'symlink':'real directory'} refuses fresh discovery and retained capture without append`,t=>{
 const f=fixture(t);f.start();f.transcript();const files=sessionsForHome(f.home);assert.equal(files.length,1);f.replace(link);
 assert.throws(()=>sessionsForHome(f.home));assert.throws(()=>captureSessions(f.store,{owner:'fixture',files,format:'pi',final:true}));assert.deepEqual(f.store.listStreams(),[]);
});
test('proof survives home removal; literal v1 remains path-only and v2 path-only downgrade refuses',t=>{
 const f=fixture(t),id=f.start();f.transcript();assert.throws(()=>historicalSessionRoots(f.home),/proof-bearing/);
 const files=sessionsForHome(f.home);assert.deepEqual(files[0].capturedPi,{home:f.home,nativeRecordId:id});assert.deepEqual(files[0].snapshot.capturedPi,files[0].capturedPi);
 assert.throws(()=>sessionAttribution('pi',f.file));assert.throws(()=>captureSessions(f.store,{owner:'fixture',files:[f.file],format:'pi'}));
 assert.throws(()=>SESSION_FORMATS.pi.listFiles([f.sessionDir]));assert.throws(()=>captureSessions(f.store,{owner:'fixture',files,format:'codex'}));
 fs.rmdirSync(f.home);const retired=sessionsForHome(f.home);assert.equal(retired.length,1);assert.equal(captureSessions(f.store,{owner:'fixture',files:retired,format:'pi',final:true}).complete,true);
 const legacy=fixture(t),v1=prepareNativeStart(legacy.home,'pi'),root=join(legacy.base,'legacy-pi');fs.mkdirSync(root);recordNativeStart(legacy.home,v1,'pi',['--session-dir',root],{HOME:legacy.base});assert.deepEqual(historicalSessionRoots(legacy.home).pi,[root]);assert.equal(legacy.row(v1).version,1);assert.equal(legacy.row(v1).rootWitness,undefined);
});
test('protected traversal refuses child directory/file symlinks before external reads',t=>{
 for(const leaf of ['child','outside.jsonl']){
  const f=fixture(t);f.start();const outside=join(f.base,'outside');fs.mkdirSync(outside);fs.writeFileSync(join(outside,'foreign.jsonl'),'private fixture');fs.symlinkSync(leaf==='child'?outside:join(outside,'foreign.jsonl'),join(f.sessionDir,leaf));
  patchFs('readdirSync',original=>(path,...args)=>{assert.notEqual(path,outside,'outside directory must not be enumerated');return original(path,...args);},()=>assert.throws(()=>sessionsForHome(f.home)));
 }
});
test('root replaced between native open and first read is held before reading the descriptor',t=>{
 const f=fixture(t);f.start();f.transcript();let nativeFd,reads=0;
 patchFs('openSync',original=>(path,...args)=>{const fd=original(path,...args);if(path===f.file){nativeFd=fd;f.replace();}return fd;},()=>
  patchFs('readSync',original=>(fd,...args)=>{if(fd===nativeFd)reads++;return original(fd,...args);},()=>assert.throws(()=>sessionsForHome(f.home))));
 assert.equal(reads,0);assert.deepEqual(f.store.listStreams(),[]);
});
test('contained-path validation rechecks the original root after checking the leaf',t=>{
 const f=fixture(t);f.start();f.transcript();let changed=false;
 patchFs('lstatSync',original=>(path,...args)=>{
  const stat=original(path,...args);if(!changed&&path===f.file){changed=true;f.replace();}return stat;
 },()=>assert.throws(()=>sessionsForHome(f.home)));
 assert.ok(changed);assert.deepEqual(f.store.listStreams(),[]);
});
test('unchanged capture and empty discovery inventory still validate original root',t=>{
 const f=fixture(t);f.start();const empty=sessionsForHome(f.home);assert.equal(empty.length,0);f.transcript();const files=sessionsForHome(f.home);
 captureSessions(f.store,{owner:'fixture',files,format:'pi',final:true});const size=fs.statSync(f.store.journalPath('fixture~pi.actual')).size;
 f.replace();assert.throws(()=>[...empty]);assert.throws(()=>captureSessions(f.store,{owner:'fixture',files,format:'pi',final:true}));assert.equal(fs.statSync(f.store.journalPath('fixture~pi.actual')).size,size);
});
test('each append batch revalidates root; prior committed batch survives a later refusal',t=>{
 const f=fixture(t);f.start();f.transcript();
 const big=JSON.stringify({type:'message',timestamp:ts,message:{role:'assistant',content:'x'.repeat(1024*1024)}})+'\n';
 for(let i=0;i<64;i++)fs.appendFileSync(f.file,big);fs.appendFileSync(f.file,JSON.stringify({timestamp:ts,type:'message',message:{role:'assistant',content:'last batch'}})+'\n');
 const files=sessionsForHome(f.home);let batches=0;const append=f.store.appendBatch.bind(f.store);
 f.store.appendBatch=(...args)=>{batches++;const value=append(...args);if(batches===1)f.replace();return value;};
 assert.throws(()=>captureSessions(f.store,{owner:'fixture',files,format:'pi',final:true}));assert.equal(batches,1);assert.ok(fs.statSync(f.store.journalPath('fixture~pi.actual')).size>64*1024*1024,'actual earlier journal append was not rolled back');
});
test('empty protected CLI inventory revalidates after acquiring the capture lock',t=>{
 const f=fixture(t);f.start();const cli=new URL('../bin/capture.mjs',import.meta.url).pathname,preload=join(f.base,'controlled-fault.mjs');
 fs.writeFileSync(preload,`import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
 const mkdir=fs.mkdirSync; let changed=false;
 fs.mkdirSync=(path,...args)=>{ if(!changed&&String(path).endsWith('/.capture.lock')){changed=true;fs.renameSync(${JSON.stringify(f.sessionDir)},${JSON.stringify(join(f.base,'preserved-empty-root'))});mkdir(${JSON.stringify(f.sessionDir)});}return mkdir(path,...args);};syncBuiltinESMExports();`);
 const result=spawnSync(process.execPath,['--import',preload,cli,'--home',f.home,'--root',f.store.root,'--owner','fixture','--no-index'],{env:{...process.env,HOME:f.base},encoding:'utf8',timeout:15000});
 assert.equal(result.status,1,result.stdout+result.stderr);assert.equal(JSON.parse(result.stdout).complete,false);assert.deepEqual(f.store.listStreams(),[]);
});
test('unchanged capture CLI consumes proof-bearing discovery and rejects replaced roots',t=>{
 const f=fixture(t);f.start();f.transcript();const cli=new URL('../bin/capture.mjs',import.meta.url).pathname;
 const run=()=>spawnSync(process.execPath,[cli,'--home',f.home,'--root',f.store.root,'--owner','fixture','--no-index'],{env:{...process.env,HOME:f.base},encoding:'utf8',timeout:15000});
 const first=run();assert.equal(first.status,0,first.stderr);assert.equal(JSON.parse(first.stdout).complete,true);
 f.replace();const second=run();assert.equal(second.status,1);assert.equal(JSON.parse(second.stdout).complete,false);
});
