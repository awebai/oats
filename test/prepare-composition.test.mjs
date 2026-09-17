import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { activateCapturedScaffold, admitCapturedAction, prepareCapturedComposition, loadCapturedDispatch, approveAvailableCapability, resolveCapturedHelper, runCapturedProviderBinding, runCapturedLifecycleHooks, scaffoldCapturedInstance, startCapturedInstanceSession, startInstanceSession, restartInstanceSession, withCapturedBindingFile } from '../lib/core.mjs';
import { commitCapturedResolution, readCapturedResolution } from '../lib/captured-resolutions.mjs';
import { readCapturedInstanceIndex } from '../lib/captured-instance-index.mjs';
import { readLock3 } from '../lib/portable-lock.mjs';
import { nativeHistoryPath, historicalSessionRoots } from '../packages/record/lib/native-history.mjs';
import { materializeCapturedDirectoryScaffold } from '../lib/captured-scaffold.mjs';
import { validateWire } from './helpers/portable-schema-check.mjs';
import { addSchedule, readState, tickWorkspace } from '../lib/schedule.mjs';
function fixture(t, provider=false) {
  const root=mkdtempSync(join(tmpdir(),'oats-prepare-composition-')),repo=join(root,'repo'),deployment=join(root,'deployment');
  mkdirSync(deployment);t.after(()=>rmSync(root,{recursive:true,force:true}));
  const write=(path,body)=>{ const target=join(repo,path); mkdirSync(join(target,'..'),{recursive:true});writeFileSync(target,body); };
  const id=provider?'example.knowledge':'example.action';
  write('oats.yaml',JSON.stringify({schemaVersion:1,exports:{souls:[{path:'agents/expert',definition:'agents/expert/soul.yaml'}]}}));
  const selection={source:'repo:packages/action'};
  write('agents/expert/soul.yaml',JSON.stringify({schemaVersion:1,name:'expert',work:'directory',requires:provider?{knowledge:{capability:id,...selection}}:{capabilities:{[id]:selection}}}));
  write('agents/expert/AGENTS.md','Expert instructions\n');symlinkSync('AGENTS.md',join(repo,'agents/expert/CLAUDE.md'));
  write('packages/action/oats-package.json',JSON.stringify({package:'example.package',version:'1.0.0',description:'Fixture',compatibility:{oats:'>=0.1.0'},capabilities:['cap']}));
  write('packages/action/cap/oats.json',JSON.stringify({capability:id,version:'1.0.0',description:'Fixture',command:'example-action',commands:{show:'show.mjs'},hooks:{spawn:{command:'./show.mjs',required:true}},settings:{limit:{default:3}},inject:'inject.md',skills:['skills/procedure'],agents:['agents/worker'],...(provider?{layer:'knowledge'}:{})}));
  write('packages/action/cap/show.mjs','if(process.env.FAIL_CAPTURED_HOOK){console.log(JSON.stringify({meta:{created:true},warning:"fixture hook failed after effect"}));process.exit(1);}console.log("A");\n');write('packages/action/cap/inject.md','Capability instructions\n');
  write('packages/action/cap/skills/procedure/SKILL.md','# Procedure\n');
  write('packages/action/cap/agents/worker/soul.yaml','schemaVersion: 1\nname: worker\nwork: directory\n');
  write('packages/action/cap/agents/worker/AGENTS.md','Worker instructions\n');symlinkSync('AGENTS.md',join(repo,'packages/action/cap/agents/worker/CLAUDE.md'));
  const config=join(root,'gitconfig');writeFileSync(config,'');
  const environment={PATH:process.env.PATH,HOME:root,GIT_CONFIG_GLOBAL:config,GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{env:environment,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const source='git:https://example.invalid/prepare.git';
  git('init','--quiet','--initial-branch=topic');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  git('config','uploadpack.allowFilter','true');git('config','uploadpack.allowAnySHA1InWant','true');
  git('config','--file',config,`url.${pathToFileURL(repo).href}.insteadOf`,source.slice(4));git('add','.');git('commit','--quiet','-m','A');
  return {root,repo,deployment,id,write,git,commit:git('rev-parse','HEAD'),input:{deployment,source:{source,soul:'agents/expert',revision:'topic',alias:'imported-expert'}},options:{repositoryOptions:{environment,allowLocalGit:true}}};
}
function nativeCorrectionFixture(t) {
  const f=fixture(t),root=realpathSync(f.root),home=join(root,'native-correction'),binary=join(root,'native.cjs'),backendBinary=join(root,'backend');
  writeFileSync(binary,`#!${process.execPath}\nrequire('node:fs').appendFileSync('work/effects.jsonl',JSON.stringify({id:process.env.OATS_EXECUTION_ID,attempt:process.env.OATS_EXECUTION_ATTEMPT})+'\\n');`,{mode:0o700});
  writeFileSync(backendBinary,'#!/bin/sh\nexit 99\n',{mode:0o700});
  const launch={runtime:'claude',executable:binary,args:[],env:{CLAUDE_CONFIG_DIR:join(root,'profile')},model:'inert-fixture',yolo:false};
  const prepared=prepareCapturedComposition({...f.input,launch},f.options);
  approveAvailableCapability(f.deployment,prepared.selections[0].artifactSet,f.id,{kind:'operator',document:{kind:'operator',id:'fixture'},pointer:'/approve'});
  scaffoldCapturedInstance({deployment:f.deployment,resolution:prepared.resolution,home,instance:'native-correction'});activateCapturedScaffold({deployment:f.deployment,resolution:prepared.resolution,home});
  rmSync(f.repo,{recursive:true});const calls=[];let present=false;
  const backend={backend:'tmux',binary:backendBinary,socket:join(root,'admitted-A.sock'),session:'admitted-A'},env={PATH:'/usr/bin:/bin',HOME:root,SHELL:'/usr/bin/true'};
  const io={exec:(file,args,options)=>{
    assert.equal(file,backendBinary,'no process inspection/stop outside the admitted backend');calls.push(args);
    if(args.includes('list-panes')){
      if(present)return '%7\t0\tclaude\t4242\n'; // synthetic present non-shell observation; no live model.
      throw Object.assign(new Error("can't find window"),{stderr:"can't find window"});
    }
    if(args.includes('new-window')||args.includes('respawn-pane'))execFileSync('/bin/sh',['-c',args.at(-1)],{cwd:home,env:options.env,encoding:'utf8'});
    return '';
  },kill:()=>assert.fail('same-id adoption must not stop a process')};
  const options={deployment:f.deployment,resolution:prepared.resolution,backend,task:'inert task',env,io};
  return {...f,root,home,backend,calls,options,setPresent:value=>{present=value;},indexFile:join(f.deployment,'.agents/portable/instance-references.json'),metaFile:join(home,'instance.json'),
    effects:()=>readFileSync(join(home,'work/effects.jsonl'),'utf8').trim().split('\n').map(JSON.parse)};
}

test('native state preflight preserves newer lifecycle and holds completed publication debt',t=>{
  const f=nativeCorrectionFixture(t),baseIndex=readFileSync(f.indexFile),baseMeta=readFileSync(f.metaFile);
  for(const [indexed,metadata] of [['retire-running','spawned-launch-pending'],['spawn-failed-cleanup-required','spawned-launch-pending'],['retire-running','retire-running']]){
    const ledger=JSON.parse(baseIndex),meta=JSON.parse(baseMeta);ledger.instances[0].status=indexed;meta.captured.lifecycle=metadata;
    writeFileSync(f.indexFile,JSON.stringify(ledger));writeFileSync(f.metaFile,JSON.stringify(meta));
    const beforeIndex=readFileSync(f.indexFile),beforeMeta=readFileSync(f.metaFile);
    assert.throws(()=>startCapturedInstanceSession(f.home,f.options),error=>error.code==='selection-changed'&&error.capturedCustody.indexedStatus===indexed&&error.home===f.home);
    assert.deepEqual(readFileSync(f.indexFile),beforeIndex);assert.deepEqual(readFileSync(f.metaFile),beforeMeta);assert.equal(f.calls.length,0);assert.equal(existsSync(join(f.home,'TASK.md')),false);
  }
  writeFileSync(f.indexFile,baseIndex);writeFileSync(f.metaFile,baseMeta);
  const started=startCapturedInstanceSession(f.home,f.options),ledger=JSON.parse(readFileSync(f.indexFile)),meta=JSON.parse(readFileSync(f.metaFile));
  ledger.instances[0].status='start-failed-cleanup-required';meta.captured.lifecycle='start-failed-cleanup-required';
  writeFileSync(f.indexFile,JSON.stringify(ledger));writeFileSync(f.metaFile,JSON.stringify(meta));
  const beforeIndex=readFileSync(f.indexFile),beforeMeta=readFileSync(f.metaFile),beforeCalls=f.calls.length;
  for(const retry of [undefined,started.intent.executionId])assert.throws(()=>startCapturedInstanceSession(f.home,{...f.options,...(retry?{retryExecutionId:retry}:{})}),error=>error.code==='selection-changed'&&error.capturedCustody.intent.executionId===started.intent.executionId);
  const request=join(f.root,'held-request.json');writeFileSync(request,JSON.stringify({schemaVersion:1,backend:f.backend,task:'inert task'}));
  const cli=spawnSync(process.execPath,[fileURLToPath(new URL('../bin/oats.mjs',import.meta.url)),'session','start','--deployment',f.deployment,'--resolution',f.options.resolution.id,'--home',f.home,'--request',request,'--json'],{env:f.options.env,encoding:'utf8',timeout:20000});
  assert.equal(cli.status,1);const error=JSON.parse(cli.stdout).error;assert.equal(error.details.custody.intent.executionId,started.intent.executionId);assert.equal(error.details.custody.held,true);
  assert.equal(f.calls.length,beforeCalls);assert.equal(f.effects().length,1);assert.deepEqual(readFileSync(f.indexFile),beforeIndex);assert.deepEqual(readFileSync(f.metaFile),beforeMeta);
});

test('same-id uncertain restart adopts a present target without another stop or dispatch',t=>{
  const f=nativeCorrectionFixture(t);let failure;
  try{startCapturedInstanceSession(f.home,{...f.options,restart:true,io:{...f.options.io,failBeforeMetadataWrite:true}});}catch(error){failure=error;}
  assert.equal(failure?.code,'E_SESSION_START_INCOMPLETE');const id=failure.nativeCustody.intent.executionId;
  assert.equal(f.effects().length,1);const beforeCalls=f.calls.length;
  assert.throws(()=>startCapturedInstanceSession(f.home,{...f.options,restart:true}),{code:'selection-changed'});assert.equal(f.calls.length,beforeCalls,'unconfirmed cleanup cannot become a new request');
  f.setPresent(true);
  const adopted=startCapturedInstanceSession(f.home,{...f.options,restart:true,retryExecutionId:id});
  assert.equal(adopted.reused,'adopted');assert.equal(adopted.intent.executionId,id);assert.equal(adopted.intent.attempt,2);assert.equal(f.effects().length,1);
  assert.deepEqual(f.calls.slice(beforeCalls).map(args=>args.includes('list-panes')),[true],'adoption only observes, never stops/allocates');
  assert.equal(JSON.parse(readFileSync(f.indexFile)).instances[0].intents.at(-1).state,'completed');
  f.setPresent(false);const distinct=startCapturedInstanceSession(f.home,{...f.options,restart:true});
  assert.notEqual(distinct.intent.executionId,id);assert.equal(distinct.incarnationId,adopted.incarnationId);assert.equal(f.effects().length,2,'distinct new restart retains its ordinary dispatch path');
});

test('native first placement refuses residual endpoint B and allocates only admitted A',t=>{
  const f=nativeCorrectionFixture(t),base=readFileSync(f.metaFile),index=readFileSync(f.indexFile);
  for(const poison of [{tmux:{session:'B',window:'foreign-window',socket:join(f.root,'B.sock')}},{sessionTarget:{backend:'herdr'}},{backend:'herdr'}]){
    writeFileSync(f.metaFile,JSON.stringify({...JSON.parse(base),...poison}));const before=readFileSync(f.metaFile);
    assert.throws(()=>startCapturedInstanceSession(f.home,f.options),{code:'E_RUNTIME_AUTHORITY_MISMATCH'});
    assert.equal(f.calls.length,0);assert.deepEqual(readFileSync(f.indexFile),index);assert.deepEqual(readFileSync(f.metaFile),before);assert.equal(existsSync(join(f.home,'TASK.md')),false);
  }
  writeFileSync(f.metaFile,base);const started=startCapturedInstanceSession(f.home,f.options);
  assert.deepEqual(started.target,{backend:'tmux',session:f.backend.session,window:'native-correction',socket:f.backend.socket});
  const allocation=f.calls.find(args=>args.includes('new-window'));
  assert.equal(allocation[allocation.indexOf('-S')+1],f.backend.socket);assert.equal(allocation[allocation.indexOf('-t')+1],`=${f.backend.session}:`);assert.equal(allocation[allocation.indexOf('-n')+1],'native-correction');
  assert.equal(f.effects().length,1);
});

test('native preparation publishes complete source/curriculum/helper records, then executes after source deletion',t=>{
  const f=fixture(t),result=prepareCapturedComposition(f.input,f.options);
  assert.equal(result.status,'approval-required');assert.equal(result.source.revision,f.commit);
  assert.deepEqual(result.executionBinding.resolution,result.resolution); assert.equal(result.executionBinding.schemaVersion,1); assert.equal(result.responsibleHuman,null);
  const record=readCapturedResolution(f.deployment,result.resolution);
  assert.equal(record.choices['/settings/example.action/limit'].value,3);
  assert.ok(record.helpers['example.action:worker']);
  assert.deepEqual(record.dispatch.composition.skills.map(skill=>skill.name).sort(),['oats-portable','oats-portable-artifacts','oats-portable-setup','procedure']);
  assert.equal(record.dispatch.composition.skills.some(skill=>['oats','oats-config','oats-packages'].includes(skill.name)),false);
  assert.equal(record.dispatch.launch,null,'command/curriculum preparation does not invent a launch recipe');
  const scaffoldParent=join(realpathSync(f.root),'scaffolds');mkdirSync(scaffoldParent);const scaffoldHome=join(scaffoldParent,'imported-expert-1');
  assert.throws(()=>scaffoldCapturedInstance({deployment:f.deployment,resolution:result.resolution,home:scaffoldHome,instance:'imported-expert-1'}),{code:'approval-required'});
  assert.equal(existsSync(scaffoldHome),false,'blocked scaffold creates no home');
  rmSync(f.repo,{recursive:true});
  approveAvailableCapability(f.deployment,result.selections[0].artifactSet,f.id,{kind:'operator',document:{kind:'operator',id:'fixture'},pointer:'/approve'});
  const scaffold=scaffoldCapturedInstance({deployment:f.deployment,resolution:result.resolution,home:scaffoldHome,instance:'imported-expert-1'});
  assert.equal(scaffold.hooksPending,true);assert.equal(scaffold.responsibleHuman,null);assert.equal(scaffold.executionBinding.resolution.id,result.resolution.id);
  assert.equal(readFileSync(join(scaffoldHome,'AGENTS.md'),'utf8').startsWith('Expert instructions'),true);assert.equal(existsSync(join(scaffoldHome,'work')),true);
  assert.ok(realpathSync(join(scaffoldHome,'soul')).includes('.agents/soul-artifacts/'),'home soul points to retained custody, not deleted source');
  const scaffoldMeta=JSON.parse(readFileSync(join(scaffoldHome,'instance.json'),'utf8'));assert.equal(scaffoldMeta.captured.lifecycle,'scaffolded-hooks-pending');
  assert.equal(scaffoldMeta.executionBinding.resolution.id,result.resolution.id);assert.equal(existsSync(join(scaffoldHome,'.agents/skills/procedure/SKILL.md')),true);
  assert.throws(()=>scaffoldCapturedInstance({deployment:f.deployment,resolution:result.resolution,home:scaffoldHome,instance:'imported-expert-1'}),{code:'E_INSTANCE_EXISTS'});
  const activated=activateCapturedScaffold({deployment:f.deployment,resolution:result.resolution,home:scaffoldHome});
  assert.equal(activated.launchPending,true);assert.deepEqual(activated.hooks.order,[f.id]);
  assert.equal(JSON.parse(readFileSync(join(scaffoldHome,'instance.json'),'utf8')).captured.lifecycle,'spawned-launch-pending');
  const failedHome=join(scaffoldParent,'imported-expert-2');scaffoldCapturedInstance({deployment:f.deployment,resolution:result.resolution,home:failedHome,instance:'imported-expert-2'});
  assert.throws(()=>activateCapturedScaffold({deployment:f.deployment,resolution:result.resolution,home:failedHome,extraEnv:{FAIL_CAPTURED_HOOK:'1'}}),error=>error.code==='E_REQUIRED_HOOK_FAILED'&&error.home===failedHome);
  const failedMeta=JSON.parse(readFileSync(join(failedHome,'instance.json'),'utf8'));
  assert.equal(failedMeta.captured.lifecycle,'spawn-failed-cleanup-required');assert.equal(failedMeta.capabilityMeta[f.id].created,true);assert.equal(existsSync(failedHome),true);
  const indexed=readCapturedInstanceIndex(f.deployment).instances;
  assert.deepEqual(indexed.map(row=>[row.instance,row.status]),[['imported-expert-1','spawned-launch-pending'],['imported-expert-2','spawn-failed-cleanup-required']]);
  assert.notEqual(scaffoldMeta.incarnationId,failedMeta.incarnationId,'identical composition has independently minted incarnations');
  assert.equal(indexed[0].incarnationId,scaffoldMeta.incarnationId);assert.equal(indexed[1].intents[0].state,'unconfirmed');
  const firstIntent=failedMeta.captured.hookIntents[f.id];
  assert.throws(()=>activateCapturedScaffold({deployment:f.deployment,resolution:result.resolution,home:failedHome}),{code:'invalid-resolution'});
  const retried=activateCapturedScaffold({deployment:f.deployment,resolution:result.resolution,home:failedHome,retryIntents:{[f.id]:firstIntent.executionId}});
  assert.equal(retried.incarnationId,failedMeta.incarnationId);assert.equal(retried.hooks.intents[f.id].executionId,firstIntent.executionId);assert.equal(retried.hooks.intents[f.id].attempt,2);
  assert.equal(readCapturedInstanceIndex(f.deployment).instances[1].intents.length,1,'retry never creates a replacement logical request');
  const action=loadCapturedDispatch({deployment:f.deployment,resolution:result.resolution,action:{kind:'command',namespace:'example-action',name:'show'}});
  assert.equal(execFileSync(process.execPath,[action.executable.file,...action.executable.args],{encoding:'utf8'}).trim(),'A');
  const hook=loadCapturedDispatch({deployment:f.deployment,resolution:result.resolution,action:{kind:'hook',capability:f.id,name:'spawn'},
    invocationTarget:{home:scaffoldHome,work:join(scaffoldHome,'work'),name:'imported-expert-1',agent:'imported-expert'}});
  assert.equal(hook.executable.file,action.executable.file); assert.deepEqual(hook.executable.args,[]);
  const helper=loadCapturedDispatch({deployment:f.deployment,resolution:record.helpers['example.action:worker'],action:{kind:'compose'}});
  assert.ok(helper.composition.text.startsWith('Worker instructions'));
  const helperCommand=loadCapturedDispatch({deployment:f.deployment,resolution:record.helpers['example.action:worker'],action:{kind:'command',capability:f.id,name:'show'}});
  assert.deepEqual(helperCommand.invocation.subject,structuredClone(helper.record.subject),'helper invocation retains exact provider artifact and definition, not an alias-derived identity');
  const capturedComposition=loadCapturedDispatch({deployment:f.deployment,resolution:result.resolution,action:{kind:'compose'}}).composition;
  assert.ok(capturedComposition.text.includes('Capability instructions'));assert.ok(capturedComposition.text.includes('captured OATS composition'));
  assert.ok(capturedComposition.text.includes('Load **oats-portable**'));assert.doesNotMatch(capturedComposition.text,/Load the oats skill before/);
});
test('captured native start executes inert primary/helper processes through the existing backend with durable intent and history',t=>{
  const f=fixture(t),root=realpathSync(f.root),binary=join(root,'native-fixture.cjs'),backendBinary=join(root,'tmux-fixture');
  writeFileSync(binary,`#!${process.execPath}\nconst fs=require('node:fs'),p=require('node:path'),e=process.env;
    const index=JSON.parse(fs.readFileSync(p.join(e.OATS_DEPLOYMENT,'.agents/portable/instance-references.json'),'utf8'));
    const row=index.instances.find(r=>r.incarnationId===e.OATS_INCARNATION_ID),intent=row?.intents.find(r=>r.executionId===e.OATS_EXECUTION_ID);
    if(!intent||intent.state!=='running'||row.status!=='start-running')throw Error('native effect before admission');
    fs.appendFileSync(p.join(process.cwd(),'work/native.jsonl'),JSON.stringify({instance:e.OATS_INSTANCE,incarnationId:e.OATS_INCARNATION_ID,executionId:e.OATS_EXECUTION_ID,args:process.argv.slice(2),keyPresent:!!e.ANTHROPIC_API_KEY})+'\\n');
    fs.mkdirSync(p.join(e.CLAUDE_CONFIG_DIR,'projects'),{recursive:true});`,{mode:0o700});
  writeFileSync(backendBinary,'#!/bin/sh\nexit 99\n',{mode:0o700});
  const launch={runtime:'claude',executable:binary,args:[],env:{CLAUDE_CONFIG_DIR:{fromEnv:'FIXTURE_PROFILE'},ANTHROPIC_API_KEY:{fromEnv:'FIXTURE_KEY'}},model:'fixture-primary',yolo:false};
  const prepared=prepareCapturedComposition({...f.input,launch,helperLaunches:{'example.action:worker':{...launch,model:'fixture-helper'}}},f.options);
  approveAvailableCapability(f.deployment,prepared.selections[0].artifactSet,f.id,{kind:'operator',document:{kind:'operator',id:'fixture'},pointer:'/approve'});
  const record=readCapturedResolution(f.deployment,prepared.resolution);assert.equal(record.dispatch.launch.executable,binary);
  rmSync(f.repo,{recursive:true});writeFileSync(join(f.deployment,'oats-config.yaml'),'poisoned current config');
  const env={PATH:'/usr/bin:/bin',HOME:root,SHELL:'/usr/bin/true',FIXTURE_PROFILE:join(root,'native-profile'),FIXTURE_KEY:'DO_NOT_RECORD_FIXTURE_KEY',OATS_INSTANCE:'foreign',OATS_RESOLUTION:'foreign'};
  const calls=[],io={exec:(selected,args,options)=>{
    assert.equal(selected,backendBinary);calls.push(args);
    if(args.includes('list-panes'))throw Object.assign(new Error("can't find window"),{stderr:"can't find window"});
    if(args.includes('new-window')||args.includes('respawn-pane')){
      const childEnv={...options.env};for(let i=0;i<args.length;i++)if(args[i]==='-e'){const pair=args[++i],at=pair.indexOf('=');childEnv[pair.slice(0,at)]=pair.slice(at+1);}
      execFileSync('/bin/sh',['-c',args.at(-1)],{cwd:args[args.indexOf('-c')+1],env:childEnv,encoding:'utf8'});
    }
    return '';
  }};
  for(const [instance,resolution,model] of [['native-primary',prepared.resolution,'fixture-primary'],['native-helper',record.helpers['example.action:worker'],'fixture-helper']]){
    const home=join(root,instance),backend={backend:'tmux',binary:backendBinary,socket:join(root,`${instance}.sock`),session:'fixture'};
    const scaffold=scaffoldCapturedInstance({deployment:f.deployment,resolution,home,instance});activateCapturedScaffold({deployment:f.deployment,resolution,home});
    const started=startCapturedInstanceSession(home,{deployment:f.deployment,resolution,backend,task:'inert task',env,io});
    assert.equal(started.dispatchAccepted,true);assert.equal(started.incarnationId,scaffold.incarnationId);
    const runs=()=>readFileSync(join(home,'work/native.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(runs().length,1);assert.equal(runs()[0].executionId,started.intent.executionId);assert.equal(runs()[0].incarnationId,scaffold.incarnationId);assert.equal(runs()[0].instance,instance);assert.equal(runs()[0].keyPresent,true);assert.ok(runs()[0].args.includes(model));
    assert.deepEqual(historicalSessionRoots(home).cc,[join(env.FIXTURE_PROFILE,'projects')]);
    const pending=JSON.parse(readFileSync(join(home,'.oats-start-pending.json'),'utf8'));assert.equal(pending.id,started.intent.executionId);assert.equal(pending.capturedIntent.executionId,started.intent.executionId);assert.equal(pending.nativeRecordId,started.nativeRecordId);assert.ok(existsSync(join(nativeHistoryPath(home),`${started.nativeRecordId}.json`)));
    const beforeReplay=calls.length,replayed=startCapturedInstanceSession(home,{env,io,retryExecutionId:started.intent.executionId});
    assert.equal(replayed.replayed,true);assert.equal(calls.length,beforeReplay);assert.equal(runs().length,1);
    const restarted=restartInstanceSession(home,{env,io});assert.notEqual(restarted.intent.executionId,started.intent.executionId);assert.equal(restarted.incarnationId,scaffold.incarnationId);assert.equal(runs().length,2);
    const before=calls.length;fs.renameSync(binary,`${binary}.preserved`);
    assert.throws(()=>startInstanceSession(home,{env,io,model:undefined,runtime:undefined,launchConfig:undefined,yolo:undefined}),{code:'E_LAUNCH_EXECUTABLE'});assert.equal(calls.length,before,'preflight refusal precedes backend observation/stop');fs.renameSync(`${binary}.preserved`,binary);
    const history=fs.readdirSync(nativeHistoryPath(home)).map(name=>readFileSync(join(nativeHistoryPath(home),name),'utf8')).join('');assert.ok(!history.includes(env.FIXTURE_KEY));
    const row=readCapturedInstanceIndex(f.deployment).instances.find(row=>row.home===home);assert.equal(row.status,'start-dispatched');assert.equal(row.intents.filter(intent=>intent.action.kind==='session').length,2);assert.ok(row.intents.every(intent=>intent.state==='completed'));
  }
  const backend={backend:'tmux',binary:backendBinary,socket:join(root,'failure.sock'),session:'fixture'},failedHome=join(root,'native-uncertain');
  scaffoldCapturedInstance({deployment:f.deployment,resolution:prepared.resolution,home:failedHome,instance:'native-uncertain'});activateCapturedScaffold({deployment:f.deployment,resolution:prepared.resolution,home:failedHome});
  let failure;try{startCapturedInstanceSession(failedHome,{backend,task:'uncertain inert task',env,io:{...io,failBeforeMetadataWrite:true}});}catch(error){failure=error;}
  assert.equal(failure?.code,'E_SESSION_START_INCOMPLETE');assert.equal(failure.nativeCustody.unconfirmed,true);assert.ok(existsSync(failure.nativeCustody.pendingPath));assert.ok(failure.nativeCustody.pendingObservation.nativeRecordId);
  const failedRef=failure.nativeCustody.intent,invocations=readFileSync(join(failedHome,'work/native.jsonl'),'utf8');
  assert.throws(()=>startCapturedInstanceSession(failedHome,{env,io,retryExecutionId:failedRef.executionId}),{code:'E_SESSION_UNKNOWN'},'unknown exited dispatch is held, not launched twice under the same intent');
  assert.equal(readFileSync(join(failedHome,'work/native.jsonl'),'utf8'),invocations);
  const unresolved=readCapturedInstanceIndex(f.deployment).instances.find(row=>row.home===failedHome).intents.at(-1);assert.equal(unresolved.executionId,failedRef.executionId);assert.equal(unresolved.attempt,2);assert.equal(unresolved.state,'unconfirmed');
  const oldHome=join(root,'no-native-evidence');
  materializeCapturedDirectoryScaffold({home:oldHome,instance:'no-native-evidence',loaded:loadCapturedDispatch({deployment:f.deployment,resolution:prepared.resolution,action:{kind:'compose'}})});
  const beforeCalls=calls.length;assert.throws(()=>startCapturedInstanceSession(oldHome,{backend,task:'never run',env,io}),{code:'migration-required'});assert.equal(calls.length,beforeCalls);assert.equal(existsSync(nativeHistoryPath(oldHome)),false,'old/unwitnessed native history is never backfilled');
  const historyRoot=join(nativeHistoryPath(failedHome),'..');fs.renameSync(historyRoot,`${historyRoot}.preserved`);mkdirSync(historyRoot);
  const beforeReplacement=calls.length;
  assert.throws(()=>startCapturedInstanceSession(join(root,'native-primary'),{env,io}),{code:'integrity-drift'});assert.equal(calls.length,beforeReplacement,'native sidecar replacement refuses before backend access');
  fs.rmdirSync(historyRoot);fs.renameSync(`${historyRoot}.preserved`,historyRoot);
});

test('public captured session dispatch follows retained helper edges and preserves uncertain execution identity',t=>{
  const f=fixture(t),root=realpathSync(f.root),binary=join(root,'native-cli-fixture.cjs'),backendBinary=join(root,'tmux-cli-fixture.cjs');
  const backendLog=join(root,'backend.jsonl'),uncertainFlag=join(root,'uncertain-backend'),cli=fileURLToPath(new URL('../bin/oats.mjs',import.meta.url));
  writeFileSync(binary,`#!${process.execPath}\nconst fs=require('node:fs'),p=require('node:path'),e=process.env;
    const ledger=JSON.parse(fs.readFileSync(p.join(e.OATS_DEPLOYMENT,'.agents/portable/instance-references.json'),'utf8'));
    const row=ledger.instances.find(row=>row.incarnationId===e.OATS_INCARNATION_ID),intent=row?.intents.find(intent=>intent.executionId===e.OATS_EXECUTION_ID);
    if(row?.status!=='start-running'||intent?.state!=='running')throw Error('public native execution lacks admission');
    fs.appendFileSync(p.join(process.cwd(),'work/public-native.jsonl'),JSON.stringify({home:e.OATS_INSTANCE_HOME,resolution:e.OATS_RESOLUTION,incarnationId:e.OATS_INCARNATION_ID,executionId:e.OATS_EXECUTION_ID,args:process.argv.slice(2)})+'\\n');`,{mode:0o700});
  writeFileSync(backendBinary,`#!${process.execPath}\nconst fs=require('node:fs'),cp=require('node:child_process'),args=process.argv.slice(2);
    fs.appendFileSync(${JSON.stringify(backendLog)},JSON.stringify(args)+'\\n');
    if(args.includes('list-panes')){console.error("can't find window");process.exit(1);}
    if(args.includes('new-window')||args.includes('respawn-pane')){
      const env={...process.env};for(let i=0;i<args.length;i++)if(args[i]==='-e'){const pair=args[++i],at=pair.indexOf('=');env[pair.slice(0,at)]=pair.slice(at+1);}
      cp.execFileSync('/bin/sh',['-c',args.at(-1)],{cwd:args[args.indexOf('-c')+1],env,stdio:'pipe'});
      if(fs.existsSync(${JSON.stringify(uncertainFlag)})){console.error('fixture response lost after native effect');process.exit(1);}
    }`,{mode:0o700});
  const launch={runtime:'claude',executable:binary,args:[],env:{CLAUDE_CONFIG_DIR:join(root,'profile')},model:'public-primary-model',yolo:false};
  const prepared=prepareCapturedComposition({...f.input,launch,helperLaunches:{'example.action:worker':{...launch,model:'public-helper-model'}}},f.options);
  approveAvailableCapability(f.deployment,prepared.selections[0].artifactSet,f.id,{kind:'operator',document:{kind:'operator',id:'fixture'},pointer:'/approve'});
  const record=readCapturedResolution(f.deployment,prepared.resolution),helper=record.helpers['example.action:worker'];
  rmSync(f.repo,{recursive:true});writeFileSync(join(f.deployment,'oats-config.yaml'),'invalid current config');writeFileSync(join(f.deployment,'oats-lock.json'),'invalid current lock');
  const env={PATH:'/usr/bin:/bin',HOME:root,SHELL:'/usr/bin/true',OATS_HOME_DIR:join(root,'isolated-oats'),OATS_DEPLOYMENT:'poison-parent',OATS_RESOLUTION:'poison-parent'};
  const run=argv=>{const result=spawnSync(process.execPath,[cli,...argv,'--json'],{cwd:root,env,encoding:'utf8',timeout:20000});assert.equal(result.error,undefined);return {status:result.status,...JSON.parse(result.stdout.trim())};};
  const sourceFlags=['--deployment',f.deployment,'--resolution',prepared.resolution.id],home=join(root,'public-primary'),helperHome=join(root,'public-helper');
  const request=join(root,'native-request.json'),requestBody={schemaVersion:1,backend:{backend:'tmux',binary:backendBinary,socket:join(root,'fixture.sock'),session:'fixture'},task:'inert public task'};
  writeFileSync(request,JSON.stringify(requestBody));
  const inspected=run(['inspect',...sourceFlags,'--helper','example.action:worker']);assert.equal(inspected.ok,true);assert.equal(inspected.result.helperSelection.executionBinding.resolution.id,helper.id);
  const scaffold=run(['spawn','imported-expert',...sourceFlags,'--home',home,'--no-launch']);assert.equal(scaffold.ok,true);
  const helperScaffold=run(['spawn','worker','--deployment',f.deployment,'--resolution',helper.id,'--home',helperHome,'--no-launch']);assert.equal(helperScaffold.ok,true);
  assert.equal(existsSync(backendLog),false,'scaffold/hooks alone never allocate a native backend');
  const startArgs=['session','start',...sourceFlags,'--home',home,'--request',request];
  for(const bad of [{...requestBody,io:{}},{...requestBody,runtime:'pi'},{...requestBody,schemaVersion:2},{...requestBody,backend:null},{...requestBody,backend:{...requestBody.backend,backend:'unsupported'}},{...requestBody,task:null}]){
    writeFileSync(request,JSON.stringify(bad));const refused=run(startArgs);assert.equal(refused.ok,false);assert.equal(existsSync(backendLog),false);
  }
  writeFileSync(request,JSON.stringify(requestBody));
  const requestLink=join(root,'request-link.json');symlinkSync(request,requestLink);
  assert.equal(run(['session','start',...sourceFlags,'--home',home,'--request',requestLink]).error.code,'E_BAD_ARGS');
  for(const tail of [['--model','ambient'],['--dir',root],['--home',home],['--retry-intent','bad/id']])assert.equal(run([...startArgs,...tail]).ok,false);
  assert.equal(run(['session','start',...sourceFlags,'--helper','missing','--home',helperHome,'--request',request]).error.code,'helper-not-selected');
  assert.equal(run(['session','start',...sourceFlags,'--helper','example.action:worker','--home',home,'--request',request]).error.code,'invalid-resolution');
  assert.equal(existsSync(backendLog),false,'invalid requests/selectors refuse before native backend access');
  const started=run(startArgs);assert.equal(started.ok,true);assert.equal(started.result.dispatchAccepted,true);assert.equal(started.result.incarnationId,scaffold.result.incarnationId);
  const helperArgs=['session','start',...sourceFlags,'--helper','example.action:worker','--home',helperHome,'--request',request];
  const helperStarted=run(helperArgs);assert.equal(helperStarted.ok,true);assert.equal(helperStarted.result.executionBinding.resolution.id,helper.id);assert.equal(helperStarted.result.sourceExecutionBinding.resolution.id,prepared.resolution.id);assert.equal(helperStarted.result.helper.subject.kind,'helper');
  const runs=at=>readFileSync(join(at,'work/public-native.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(runs(home)[0].resolution,prepared.resolution.id);assert.ok(runs(home)[0].args.includes('public-primary-model'));
  assert.equal(runs(helperHome)[0].resolution,helper.id);assert.ok(runs(helperHome)[0].args.includes('public-helper-model'));
  assert.equal(runs(helperHome)[0].executionId,helperStarted.result.intent.executionId);assert.equal(runs(helperHome)[0].incarnationId,helperScaffold.result.incarnationId);
  const backendBeforeReplay=readFileSync(backendLog,'utf8'),replayed=run([...helperArgs,'--retry-intent',helperStarted.result.intent.executionId]);
  assert.equal(replayed.ok,true);assert.equal(replayed.result.replayed,true);assert.equal(readFileSync(backendLog,'utf8'),backendBeforeReplay);assert.equal(runs(helperHome).length,1);
  const restarted=run(['session','restart',...sourceFlags,'--helper','example.action:worker','--home',helperHome]);
  assert.equal(restarted.ok,true);assert.equal(restarted.result.incarnationId,helperScaffold.result.incarnationId);assert.notEqual(restarted.result.intent.executionId,helperStarted.result.intent.executionId);assert.equal(runs(helperHome).length,2);
  const occupiedBefore=readFileSync(join(helperHome,'instance.json'),'utf8');assert.equal(run(['spawn','worker','--deployment',f.deployment,'--resolution',helper.id,'--home',helperHome,'--no-launch']).error.code,'E_INSTANCE_EXISTS');assert.equal(readFileSync(join(helperHome,'instance.json'),'utf8'),occupiedBefore);
  const uncertainHome=join(root,'public-uncertain');assert.equal(run(['spawn','worker','--deployment',f.deployment,'--resolution',helper.id,'--home',uncertainHome,'--no-launch']).ok,true);
  writeFileSync(uncertainFlag,'lose backend response after effect');
  const uncertainArgs=['session','start',...sourceFlags,'--helper','example.action:worker','--home',uncertainHome,'--request',request],failed=run(uncertainArgs);
  assert.equal(failed.ok,false);assert.equal(failed.error.details.unconfirmed,true);assert.equal(failed.error.details.sourceExecutionBinding.resolution.id,prepared.resolution.id);
  const custody=failed.error.details.nativeCustody;assert.equal(runs(uncertainHome).length,1);assert.equal(runs(uncertainHome)[0].executionId,custody.intent.executionId);assert.ok(existsSync(custody.pendingPath));
  rmSync(uncertainFlag);const retried=run([...uncertainArgs,'--retry-intent',custody.intent.executionId]);
  assert.equal(retried.ok,false);assert.equal(retried.error.code,'E_SESSION_UNKNOWN');assert.equal(retried.error.details.nativeCustody.intent.executionId,custody.intent.executionId);assert.equal(retried.error.details.nativeCustody.intent.attempt,2);assert.equal(runs(uncertainHome).length,1,'unknown effect never duplicates native execution');
  const indexed=readCapturedInstanceIndex(f.deployment).instances.find(row=>row.home===uncertainHome),nativeIntents=indexed.intents.filter(intent=>intent.action.kind==='session');
  assert.equal(nativeIntents.length,1);assert.equal(nativeIntents[0].state,'unconfirmed');assert.equal(indexed.incarnationId,custody.intent.incarnationId);
});

test('explicit primary and helper launch inputs retain separate entrypoints and never use current runtime choices',t=>{
  const f=fixture(t),key='example.action:worker';
  f.write('packages/action/cap/show.mjs','#!/usr/bin/env node\nconsole.log("retained runtime A");\n');chmodSync(join(f.repo,'packages/action/cap/show.mjs'),0o755);
  f.git('add','.');f.git('commit','--quiet','-m','explicit runtime entrypoint');
  const launch={runtime:'claude',executable:{capability:f.id,command:'show'},args:['literal-A'],env:{FIXTURE_NATIVE_PROFILE:{fromEnv:'FIXTURE_PROFILE'}},model:'explicit-model-A',yolo:false};
  for(const bad of [{...launch,model:null},{...launch,executable:'ambient'},{...launch,env:{OATS_INVOCATION_CONTEXT_FILE:'/forged'}}]){
    assert.throws(()=>prepareCapturedComposition({...f.input,launch:bad},f.options));
    assert.equal(existsSync(join(f.deployment,'.agents/resolutions')),false,'malformed launch input refuses before publication');
  }
  assert.throws(()=>prepareCapturedComposition({...f.input,helperLaunches:{'example.action:not-selected':launch}},f.options),{code:'helper-not-selected'});
  assert.equal(existsSync(join(f.deployment,'.agents/resolutions')),false);
  const a=prepareCapturedComposition({...f.input,launch,helperLaunches:{[key]:{...launch,args:['helper-A'],model:'helper-model-A'}}},f.options);
  const record=readCapturedResolution(f.deployment,a.resolution),helper=readCapturedResolution(f.deployment,record.helpers[key]);
  assert.equal(record.dispatch.launch.model,'explicit-model-A');assert.equal(helper.dispatch.launch.model,'helper-model-A');
  assert.deepEqual(helper.dispatch.launch.args,['helper-A']);assert.equal(record.dispatch.launch.executable,'captured-resource');
  assert.equal(record.dispatch.launch.executableResource,`executable:${f.id}:command:show`);
  f.write('packages/action/cap/show.mjs','#!/usr/bin/env node\nconsole.log("runtime B");\n');f.git('add','.');f.git('commit','--quiet','-m','runtime B');
  const b=prepareCapturedComposition({...f.input,launch:{...launch,model:'explicit-model-B'}},f.options);
  assert.notEqual(a.resolution.id,b.resolution.id);
  const bRecord=readCapturedResolution(f.deployment,b.resolution);assert.equal(readCapturedResolution(f.deployment,bRecord.helpers[key]).dispatch.launch,null,'helper never inherits the primary runtime request');
  rmSync(f.repo,{recursive:true});writeFileSync(join(f.deployment,'oats-config.yaml'),'poison runtime/model config');
  const retained=loadCapturedDispatch({deployment:f.deployment,resolution:a.resolution,action:{kind:'inspect'}});
  const entry=retained.resources.get(retained.record.dispatch.launch.executableResource);
  assert.match(readFileSync(entry,'utf8'),/retained runtime A/);assert.equal(retained.record.dispatch.launch.model,'explicit-model-A');
  const tampered=structuredClone(record);tampered.dispatch.launch.executableResource='missing-runtime';
  assert.throws(()=>commitCapturedResolution(f.deployment,tampered));
  const g=fixture(t),manifest=JSON.parse(readFileSync(join(g.repo,'packages/action/cap/oats.json'),'utf8'));
  manifest.requires=[{runtime:'claude',package:'fixture@marketplace'}];g.write('packages/action/cap/oats.json',JSON.stringify(manifest));g.git('add','.');g.git('commit','--quiet','-m','unqualified runtime root');
  assert.throws(()=>prepareCapturedComposition({...g.input,launch},g.options),{code:'needs-configuration'});
  assert.equal(existsSync(join(g.deployment,'.agents/resolutions')),false,'required runtime packages are not replaced with ambient discovery or partially published helpers');
});

test('activation never publishes or cleans through home/work replacement during a retained hook',t=>{
  const f=fixture(t),root=realpathSync(f.root);
  f.write('packages/action/cap/show.mjs',`import {readFileSync,renameSync,symlinkSync} from 'node:fs';
    const e=process.env,invocation=JSON.parse(readFileSync(e.OATS_INVOCATION_CONTEXT_FILE,'utf8'));
    const target=e.FA1_MODE.startsWith('work')?e.OATS_INSTANCE_HOME+'/work':e.OATS_INSTANCE_HOME;
    renameSync(target,target+'.preserved');
    if(e.FA1_MODE.endsWith('link'))symlinkSync(e.FA1_FOREIGN,target);else renameSync(e.FA1_FOREIGN,target);
    console.log(JSON.stringify({meta:{observedResource:'resource-before-custody-loss',incarnationId:invocation.instance.incarnationId,executionId:invocation.intent.executionId}}));
    if(e.FA1_EXIT)process.exitCode=1;`);
  f.git('add','.');f.git('commit','--quiet','-m','replacement during retained hook');
  const prepared=prepareCapturedComposition(f.input,f.options);
  approveAvailableCapability(f.deployment,prepared.selections[0].artifactSet,f.id,{kind:'operator',document:{kind:'operator',id:'fixture'},pointer:'/approve'});
  for(const mode of ['home-dir','home-link','work-dir','work-link']){
    const home=join(root,mode),foreign=join(root,`foreign-${mode}`);mkdirSync(foreign);
    const foreignBytes=Buffer.from('foreign metadata, deliberately not JSON\n');writeFileSync(join(foreign,'instance.json'),foreignBytes);
    const scaffold=scaffoldCapturedInstance({deployment:f.deployment,resolution:prepared.resolution,home,instance:mode});
    const originalBytes=readFileSync(join(home,'instance.json'));let failure;
    try{activateCapturedScaffold({deployment:f.deployment,resolution:prepared.resolution,home,extraEnv:{FA1_MODE:mode,FA1_FOREIGN:foreign,...(mode.endsWith('link')?{FA1_EXIT:'1'}:{})}});}catch(error){failure=error;}
    assert.equal(failure?.code,'integrity-drift');assert.equal(failure.home,home);
    const foreignAt=mode.endsWith('link')?foreign:mode.startsWith('home')?home:join(home,'work');
    assert.deepEqual(readFileSync(join(foreignAt,'instance.json')),foreignBytes,'foreign metadata is byte-identical');
    const originalAt=mode.startsWith('home')?`${home}.preserved`:home;
    assert.deepEqual(readFileSync(join(originalAt,'instance.json')),originalBytes,'lost-custody path never publishes even on catch');
    const row=readCapturedInstanceIndex(f.deployment).instances.find(entry=>entry.incarnationId===scaffold.incarnationId);
    assert.equal(row.status,'spawn-failed-cleanup-required');assert.equal(row.intents[0].state,'unconfirmed');
    assert.equal(row.intents[0].receipt.observedResource,'resource-before-custody-loss');assert.equal(row.custodyFailure.code,'integrity-drift');
    assert.equal(failure.capturedCustody.meta[f.id].executionId,row.intents[0].executionId,'independent reporting retains the exact observed provider receipt');
  }
});

test('activation failure reporting cannot overwrite a newer lifecycle row or receipt',t=>{
  const f=fixture(t),root=realpathSync(f.root),indexFile=join(realpathSync(f.deployment),'.agents/portable/instance-references.json');
  const savedIndex=join(root,'newer-index.json'),savedMetadata=join(root,'newer-metadata.json');
  f.write('packages/action/cap/show.mjs',`import {readFileSync,writeFileSync} from 'node:fs';
    const invocation=JSON.parse(readFileSync(process.env.OATS_INVOCATION_CONTEXT_FILE,'utf8'));
    const index=JSON.parse(readFileSync(${JSON.stringify(indexFile)},'utf8')),row=index.instances.find(row=>row.incarnationId===invocation.instance.incarnationId);
    const intent=row.intents.find(item=>item.executionId===invocation.intent.executionId);row.status='retire-running';intent.state='completed';intent.receipt={newer:'must-remain'};intent.replayable=true;
    const bytes=JSON.stringify(index)+'\\n';writeFileSync(${JSON.stringify(indexFile)},bytes);writeFileSync(${JSON.stringify(savedIndex)},bytes);
    const file=process.env.OATS_INSTANCE_HOME+'/instance.json',metadata=JSON.parse(readFileSync(file,'utf8'));metadata.captured.lifecycle='retire-running';
    const meta=JSON.stringify(metadata)+'\\n';writeFileSync(file,meta);writeFileSync(${JSON.stringify(savedMetadata)},meta);
    console.log(JSON.stringify({meta:{observed:'from-earlier-spawn'}}));`);
  f.git('add','.');f.git('commit','--quiet','-m','newer lifecycle during hook');
  const prepared=prepareCapturedComposition(f.input,f.options);approveAvailableCapability(f.deployment,prepared.selections[0].artifactSet,f.id,{kind:'operator',document:{kind:'operator',id:'fixture'},pointer:'/approve'});
  const home=join(root,'newer-state');scaffoldCapturedInstance({deployment:f.deployment,resolution:prepared.resolution,home,instance:'newer-state'});
  let failure;try{activateCapturedScaffold({deployment:f.deployment,resolution:prepared.resolution,home});}catch(error){failure=error;}
  assert.equal(failure?.code,'selection-changed');assert.equal(failure.home,home);
  assert.equal(failure.capturedCustody.reportingFailure.code,'selection-changed');assert.equal(failure.capturedCustody.meta[f.id].observed,'from-earlier-spawn');
  assert.deepEqual(readFileSync(indexFile),readFileSync(savedIndex),'newer row/status/receipt remains byte-identical');
  assert.deepEqual(readFileSync(join(home,'instance.json')),readFileSync(savedMetadata),'publication does not clobber newer owned metadata either');
});

test('post-hook classification read failure preserves observed facts even when independent reporting fails',t=>{
  const f=fixture(t),root=realpathSync(f.root),indexFile=join(realpathSync(f.deployment),'.agents/portable/instance-references.json');
  f.write('packages/action/cap/show.mjs','console.log(JSON.stringify({meta:{observed:"settled-before-index-fault"}}));\n');
  f.git('add','.');f.git('commit','--quiet','-m','observed classification receipt');
  const prepared=prepareCapturedComposition(f.input,f.options);approveAvailableCapability(f.deployment,prepared.selections[0].artifactSet,f.id,{kind:'operator',document:{kind:'operator',id:'fixture'},pointer:'/approve'});
  for(const reportAlsoFails of [false,true]){
    const instance=reportAlsoFails?'classification-report-fails':'classification-only',home=join(root,instance);
    scaffoldCapturedInstance({deployment:f.deployment,resolution:prepared.resolution,home,instance});const before=readFileSync(join(home,'instance.json'));
    let fired=false,failure;const original=fs.lstatSync;
    // Controlled reader-boundary fault, not a claim of a real OS I/O failure.
    fs.lstatSync=(path,...args)=>{
      if(path===indexFile){
        const direct=/at readCapturedInstanceIndex [^\n]*\n\s+at activateCapturedScaffold /.test(new Error().stack);
        if(direct||fired&&reportAlsoFails){fired=true;throw Object.assign(new Error('synthetic post-hook index read failure'),{code:'E_TEST_INDEX_READ'});}
      }
      return original(path,...args);
    };syncBuiltinESMExports();
    try{activateCapturedScaffold({deployment:f.deployment,resolution:prepared.resolution,home});}catch(error){failure=error;}
    finally{fs.lstatSync=original;syncBuiltinESMExports();}
    assert.equal(fired,true,'fault reached the direct post-hook classification boundary');assert.equal(failure?.code,'E_TEST_INDEX_READ');assert.equal(failure.home,home);
    assert.equal(failure.capturedCustody.meta[f.id].observed,'settled-before-index-fault');
    const row=readCapturedInstanceIndex(f.deployment).instances.find(row=>row.home===home);
    assert.equal(failure.capturedCustody.intents[f.id].executionId,row.intents[0].executionId);
    assert.equal(row.intents[0].receipt.observed,'settled-before-index-fault');
    assert.equal(row.status,reportAlsoFails?'spawn-hooks-running':'spawn-failed-cleanup-required');
    if(reportAlsoFails)assert.equal(failure.capturedCustody.reportingFailure.code,'E_TEST_INDEX_READ');else assert.ok(failure.capturedCustody.report);
    assert.deepEqual(readFileSync(join(home,'instance.json')),before,'unavailable classification cannot publish terminal metadata');
  }
});

test('explicit empty activation retry and later preflight failure preserve indexed spawn references',t=>{
  const f=fixture(t),root=realpathSync(f.root),bin=join(root,'host-bin'),host=join(bin,'oats-fa2-fixture-host');mkdirSync(bin);
  const previousPath=process.env.PATH;process.env.PATH=`${bin}:${previousPath}`;t.after(()=>{process.env.PATH=previousPath;});
  const manifest=JSON.parse(readFileSync(join(f.repo,'packages/action/cap/oats.json'),'utf8'));manifest.requires=[{command:'oats-fa2-fixture-host'}];
  f.write('packages/action/cap/oats.json',JSON.stringify(manifest));f.git('add','.');f.git('commit','--quiet','-m','host preflight requirement');
  const prepared=prepareCapturedComposition(f.input,f.options);
  approveAvailableCapability(f.deployment,prepared.selections[0].artifactSet,f.id,{kind:'operator',document:{kind:'operator',id:'fixture'},pointer:'/approve'});
  const makeHost=()=>{writeFileSync(host,'#!/bin/sh\nexit 0\n');chmodSync(host,0o755);};
  const home=join(root,'preflight-empty');scaffoldCapturedInstance({deployment:f.deployment,resolution:prepared.resolution,home,instance:'preflight-empty'});
  const activate=(target,options={})=>activateCapturedScaffold({deployment:f.deployment,resolution:prepared.resolution,home:target,...options});
  assert.throws(()=>activate(home),{code:'E_REQUIRED_HOOK_FAILED'});
  assert.equal(readCapturedInstanceIndex(f.deployment).instances.find(row=>row.home===home).intents.length,0);
  assert.deepEqual(JSON.parse(readFileSync(join(home,'instance.json'),'utf8')).captured.hookIntents,{});
  makeHost();assert.throws(()=>activate(home),{code:'invalid-resolution'});
  const emptyRetry=activate(home,{retryIntents:{}});assert.equal(emptyRetry.hooksPending,false);assert.equal(emptyRetry.hooks.intents[f.id].attempt,1);
  const later=join(root,'preflight-existing');scaffoldCapturedInstance({deployment:f.deployment,resolution:prepared.resolution,home:later,instance:'preflight-existing'});
  assert.throws(()=>activate(later,{extraEnv:{FAIL_CAPTURED_HOOK:'1'}}),{code:'E_REQUIRED_HOOK_FAILED'});
  const readMeta=()=>JSON.parse(readFileSync(join(later,'instance.json'),'utf8'));
  const saved=readMeta().captured.hookIntents[f.id],retryIntents={[f.id]:saved.executionId};
  assert.throws(()=>activate(later,{retryIntents:{}}),{code:'invalid-resolution'},'empty retry cannot remint over an existing obligation');
  rmSync(host);assert.throws(()=>activate(later,{retryIntents}),{code:'E_REQUIRED_HOOK_FAILED'});
  assert.deepEqual(readMeta().captured.hookIntents[f.id],saved,'preflight failure preserves the exact saved ref');
  assert.equal(readMeta().capabilityMeta[f.id].created,true);
  makeHost();const retried=activate(later,{retryIntents});assert.equal(retried.hooks.intents[f.id].executionId,saved.executionId);assert.equal(retried.hooks.intents[f.id].attempt,2);
  assert.equal(readCapturedInstanceIndex(f.deployment).instances.find(row=>row.home===later).intents.length,1);
});

test('optional hook failure reports nonterminal custody and public spawn retains a usable exact retry route',t=>{
  const f=fixture(t),root=realpathSync(f.root),manifest=JSON.parse(readFileSync(join(f.repo,'packages/action/cap/oats.json'),'utf8'));
  manifest.hooks.spawn.required=false;f.write('packages/action/cap/oats.json',JSON.stringify(manifest));
  f.write('packages/action/cap/show.mjs',`import {existsSync,writeFileSync} from 'node:fs';const file=process.env.OATS_INSTANCE_HOME+'/work/attempted';
    const retry=existsSync(file);writeFileSync(file,'owned effect');console.log(JSON.stringify({meta:{observed:true,reconciled:retry}}));if(!retry)process.exitCode=1;`);
  f.git('add','.');f.git('commit','--quiet','-m','optional hook custody');
  const prepared=prepareCapturedComposition(f.input,f.options);approveAvailableCapability(f.deployment,prepared.selections[0].artifactSet,f.id,{kind:'operator',document:{kind:'operator',id:'fixture'},pointer:'/approve'});
  const home=join(root,'optional-only'),cli=fileURLToPath(new URL('../bin/oats.mjs',import.meta.url));
  const spawned=JSON.parse(execFileSync(process.execPath,[cli,'spawn','imported-expert','--deployment',f.deployment,'--resolution',prepared.resolution.id,'--home',home,'--no-launch','--json'],{encoding:'utf8'}));
  assert.equal(spawned.ok,true,'optional functionality does not become a required-hook failure');
  assert.equal(spawned.result.hooksPending,true);assert.equal(spawned.result.cleanupRequired,true);
  const row=readCapturedInstanceIndex(f.deployment).instances.find(row=>row.home===home);assert.equal(row.status,'spawned-cleanup-required');assert.equal(row.intents[0].state,'unconfirmed');
  const metadata=JSON.parse(readFileSync(join(home,'instance.json'),'utf8'));assert.equal(metadata.captured.lifecycle,row.status);assert.equal(metadata.captured.hookFailures[0].required,false);
  const saved=spawned.result.hookIntents[f.id];
  assert.throws(()=>admitCapturedAction({deployment:f.deployment,resolution:prepared.resolution,home,action:{kind:'command',capability:f.id,name:'show'}}),{code:'selection-changed'},'optional semantics do not waive unsettled custody');
  const result=activateCapturedScaffold({deployment:f.deployment,resolution:prepared.resolution,home,retryIntents:{[f.id]:saved.executionId}});
  assert.equal(result.cleanupRequired,false);assert.equal(result.hooksPending,false);assert.equal(result.hooks.meta[f.id].reconciled,true);
  assert.equal(result.hooks.intents[f.id].executionId,saved.executionId);assert.equal(result.hooks.intents[f.id].attempt,2);
  const done=readCapturedInstanceIndex(f.deployment).instances.find(row=>row.home===home);assert.equal(done.status,'spawned-launch-pending');assert.equal(done.intents.length,1);assert.equal(done.intents[0].state,'completed');
});

test('full retained persistent/helper curriculum selects portable boundaries without legacy authority',t=>{
  const f=fixture(t),prepared=prepareCapturedComposition(f.input,f.options),record=readCapturedResolution(f.deployment,prepared.resolution);
  const nonDirectory=prepareCapturedComposition({...f.input,mode:'worktree'},f.options);
  const originalBoundary=readFileSync(new URL('../injects/portable-instance-boundary.md',import.meta.url));
  const originalDirectory=readFileSync(new URL('../injects/portable-work-directory.md',import.meta.url));
  rmSync(f.repo,{recursive:true});writeFileSync(join(f.deployment,'oats-config.yaml'),'poisoned current configuration');
  let retainedBoundary;
  for(const resolution of [prepared.resolution,record.helpers['example.action:worker']]){
    const loaded=loadCapturedDispatch({deployment:f.deployment,resolution,action:{kind:'compose'}}),text=loaded.composition.text;
    validateWire('CapturedResolution',loaded.record);
    const blocks=loaded.record.dispatch.composition.blocks;
    assert.deepEqual(blocks.slice(0,3).map(block=>block.source),['kernel:oats-portable','kernel:instance-boundary','work-mode:directory'],'labels and order stay stable');
    const boundary=blocks.find(block=>block.source==='kernel:instance-boundary').resource,directory=blocks.find(block=>block.source==='work-mode:directory').resource;
    assert.equal(loaded.record.resources[boundary].path,'injects/portable-instance-boundary.md');
    assert.equal(loaded.record.resources[directory].path,'injects/portable-work-directory.md');
    retainedBoundary=loaded.resources.get(boundary);
    assert.deepEqual(readFileSync(retainedBoundary),originalBoundary);assert.deepEqual(readFileSync(loaded.resources.get(directory)),originalDirectory);
    assert.equal(existsSync(join(retainedBoundary,'..','instance-boundary.md')),false,'captured inventory excludes the old boundary');
    assert.equal(existsSync(join(retainedBoundary,'..','work-directory.md')),false,'captured inventory excludes old directory doctrine');
    assert.ok(text.includes(originalBoundary.toString('utf8').trim()));assert.ok(text.includes(originalDirectory.toString('utf8').trim()));
    assert.match(text,/instance\.json\.executionBinding/);assert.match(text,/CLAUDE\.md -> AGENTS\.md/);
    assert.match(text,/read-only retained source link/);assert.match(text,/instance-owned execution directory/);
    assert.match(text,/cwd and a recorded `repo` path never select configuration/);
    assert.match(text,/does not promise\s+implemented captured launch/);assert.match(text,/Missing authority is a hold/);
    assert.doesNotMatch(text,/They resolve their\s+scope from the directory/);
    assert.doesNotMatch(text,/context recorded as `repo` supplies configuration/);
    assert.doesNotMatch(text,/Retirement removes the execution directory only after/);
    assert.doesNotMatch(text,/oats (?:status|doctor|retire|session (?:start|restart))\b/);
  }
  const other=loadCapturedDispatch({deployment:f.deployment,resolution:nonDirectory.resolution,action:{kind:'compose'}});
  const otherBlock=other.record.dispatch.composition.blocks.find(block=>block.source==='work-mode:worktree');
  assert.equal(other.record.resources[otherBlock.resource].path,'injects/work-worktree.md','other modes are not silently remapped to directory');
  approveAvailableCapability(f.deployment,prepared.selections[0].artifactSet,f.id,{kind:'operator',document:{kind:'operator',id:'fixture'},pointer:'/approve'});
  const unsupported=join(realpathSync(f.root),'unsupported-worktree');
  assert.throws(()=>scaffoldCapturedInstance({deployment:f.deployment,resolution:nonDirectory.resolution,home:unsupported,instance:'unsupported-worktree'}),{code:'needs-configuration'});assert.equal(existsSync(unsupported),false);
  rmSync(retainedBoundary);
  assert.throws(()=>loadCapturedDispatch({deployment:f.deployment,resolution:prepared.resolution,action:{kind:'compose'}}),{code:'integrity-drift'},'missing retained boundary cannot fall back to the current package');
});

test('source helper lookup preserves dedicated A/B authority without source or current selection',t=>{
  const f=fixture(t),a=prepareCapturedComposition(f.input,f.options),key='example.action:worker';
  const aRecord=readCapturedResolution(f.deployment,a.resolution),aHelper=aRecord.helpers[key];
  f.write('packages/action/cap/agents/worker/AGENTS.md','Helper B instructions\n');
  f.git('add','.');f.git('commit','--quiet','-m','helper B');
  const b=prepareCapturedComposition(f.input,f.options),bHelper=readCapturedResolution(f.deployment,b.resolution).helpers[key];
  assert.notEqual(aHelper.id,bHelper.id);assert.notEqual(a.resolution.id,aHelper.id);
  rmSync(f.repo,{recursive:true});writeFileSync(join(f.deployment,'oats-config.yaml'),'poisoned config');writeFileSync(join(f.deployment,'oats-lock.json'),'poisoned lock');
  const cli=fileURLToPath(new URL('../bin/oats.mjs',import.meta.url));
  for(const [source,helper,text] of [[a,aHelper,'Worker instructions'],[b,bHelper,'Helper B instructions']]) {
    const resolved=resolveCapturedHelper({executionBinding:source.executionBinding,helper:key,name:'worker'});
    assert.equal(resolved.sourceExecutionBinding.resolution.id,source.resolution.id);assert.equal(resolved.executionBinding.resolution.id,helper.id);
    assert.equal(resolved.helper.subject.kind,'helper');assert.equal(resolved.helper.subject.provider.capability,'example.action');
    assert.equal(resolved.workMode,'directory');assert.equal(resolved.launch.status,'unsupported');assert.equal(resolved.responsibleHuman,null);
    const result=spawnSync(process.execPath,[cli,'inspect','--deployment',f.deployment,'--resolution',source.resolution.id,'--helper',key,'--composition','--json'],{encoding:'utf8'});
    assert.equal(result.status,0,result.stdout||result.stderr);const receipt=JSON.parse(result.stdout).result;
    assert.equal(receipt.resolution.id,helper.id);assert.equal(receipt.helperSelection.sourceExecutionBinding.resolution.id,source.resolution.id);
    assert.ok(receipt.composition.text.startsWith(text));
  }
  for(const helper of ['missing','constructor','__proto__']) assert.throws(()=>resolveCapturedHelper({executionBinding:a.executionBinding,helper}),{code:'helper-not-selected'});
  assert.throws(()=>resolveCapturedHelper({executionBinding:a.executionBinding,helper:key,name:'different'}),{code:'invalid-resolution'});
  const differentContext=structuredClone(readCapturedResolution(f.deployment,aHelper));differentContext.context={kind:'standalone',key:'other-helper-context'};
  const differentRef=commitCapturedResolution(f.deployment,differentContext),sourceWithDifferent=structuredClone(aRecord);sourceWithDifferent.helpers[key]=differentRef;
  const differentSource=commitCapturedResolution(f.deployment,sourceWithDifferent);
  assert.throws(()=>resolveCapturedHelper({executionBinding:{...a.executionBinding,resolution:differentSource},helper:key}),{code:'needs-configuration'},'distinct context is held until explicit helper-request policy, never overwritten');
  assert.equal(existsSync(join(f.deployment,'.agents','portable','instance-references.json')),false,'helper inspection admits no incarnation');
  assert.equal(existsSync(join(f.deployment,'oats-schedules.json')),false,'helper inspection schedules nothing');
  rmSync(join(f.deployment,'.agents','resolutions',`${aHelper.id}.json`));
  assert.throws(()=>resolveCapturedHelper({executionBinding:a.executionBinding,helper:key}));
  assert.equal(resolveCapturedHelper({executionBinding:b.executionBinding,helper:key}).executionBinding.resolution.id,bHelper.id,'missing A cannot reselect B');
});

test('helper-authored provider policy refuses before helper or parent records can inherit the parent binding',t=>{
  const f=fixture(t,true),manifestFile=join(f.repo,'packages/action/cap/oats.json'),soulFile=join(f.repo,'agents/expert/soul.yaml');
  const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
  manifest.commands.binding='binding.mjs';manifest.binding={version:1,normalize:'binding',bind:'binding',check:'binding'};
  writeFileSync(manifestFile,JSON.stringify(manifest));
  const soul=JSON.parse(readFileSync(soulFile,'utf8'));soul.knowledge={contract:'example.locations',version:1,payload:{location:'parent-A'}};
  writeFileSync(soulFile,JSON.stringify(soul));
  f.write('packages/action/cap/agents/worker/soul.yaml',JSON.stringify({schemaVersion:1,name:'worker',work:'directory',knowledge:{contract:'example.locations',version:1,payload:{location:'helper-B'}}}));
  f.write('packages/action/cap/binding.mjs',`import {readFileSync} from 'node:fs';
    const r=JSON.parse(readFileSync(0,'utf8'));let result;
    if(r.phase==='normalize'){const source=r.input.declarations.find(d=>d.kind==='soul');result={requirements:[],candidates:[],model:{location:source.value.knowledge.payload.location}};}
    else if(r.phase==='bind')result={payloadContract:'example.locations',payloadVersion:1,payload:r.input.model,credentialRefs:{},provenance:[]};
    else result={status:'ready',problems:[]};
    console.log(JSON.stringify({schemaVersion:1,phase:r.phase,slot:r.slot,capability:r.capability,ok:true,result}));`);
  f.git('add','.');f.git('commit','--quiet','-m','helper policy conflict');
  const pending=prepareCapturedComposition(f.input,f.options);
  approveAvailableCapability(f.deployment,pending.selections[0].artifactSet,f.id,{kind:'operator',document:{kind:'operator',id:'fixture'},pointer:'/approve'});
  const blocked=prepareCapturedComposition(f.input,f.options);
  assert.equal(blocked.status,'needs-configuration');assert.equal(blocked.resolution,null);
  assert.match(blocked.problems[0].message,/helper.*knowledge.*dedicated preparation/);
  assert.equal(existsSync(join(f.deployment,'.agents','resolutions')),false,'neither a contradictory helper nor a parent record was published');
});

test('standalone context key is explicit, opaque and preserved without workspace inference',t=>{
  const f=fixture(t),key='provider-context:opaque/one';
  const keyed=prepareCapturedComposition({...f.input,standaloneContextKey:key},f.options);
  assert.equal(readCapturedResolution(f.deployment,keyed.resolution).context.key,key);
  const disabled=prepareCapturedComposition({...f.input,standaloneContextKey:null},f.options);
  assert.equal(readCapturedResolution(f.deployment,disabled.resolution).context.key,null);
  assert.throws(()=>prepareCapturedComposition({...f.input,standaloneContextKey:''},f.options),{code:'invalid-declaration'});
  assert.throws(()=>prepareCapturedComposition({...f.input,workspace:{source:f.input.source.source},standaloneContextKey:key},f.options),{code:'invalid-declaration'});
});

test('public prepare CLI uses the native transport and returns the exact immutable binding',t=>{
  const f=fixture(t),ssh=join(f.root,'fixture-ssh');
  // Native SSH transport with a controlled upload-pack endpoint: no network,
  // model, daemon, or production-only test bypass is needed.
  writeFileSync(ssh,`#!/bin/sh\nexec git-upload-pack '${f.repo.replaceAll("'", "'\\''")}'\n`);chmodSync(ssh,0o700);
  const cli=fileURLToPath(new URL('../bin/oats.mjs',import.meta.url));
  const output=execFileSync(process.execPath,[cli,'prepare','--dir',f.deployment,'--source','git:ssh://example.invalid/prepare.git','--revision','topic','--export','agents/expert','--alias','cli-expert','--json'],{
    encoding:'utf8',env:{...f.options.repositoryOptions.environment,GIT_SSH_COMMAND:ssh,GIT_SSH_VARIANT:'ssh'},
  });
  const envelope=JSON.parse(output);assert.equal(envelope.ok,true);
  assert.equal(envelope.result.status,'approval-required');assert.equal(envelope.result.source.alias,'cli-expert');
  assert.equal(envelope.result.executionBinding.resolution.id,envelope.result.resolution.id);
  assert.equal(readCapturedResolution(f.deployment,envelope.result.resolution).subject.soul.alias,'cli-expert');
  f.write('oats-workspace.yaml',JSON.stringify({schemaVersion:1,name:'Fixture',imports:[{source:'git:ssh://example.invalid/prepare.git',revision:'topic',soul:'agents/expert',alias:'workspace-expert'}]}));
  f.git('add','.');f.git('commit','--quiet','-m','workspace flag control');
  const workspace=JSON.parse(execFileSync(process.execPath,[cli,'prepare','--dir',f.deployment,'--workspace','git:ssh://example.invalid/prepare.git','--workspace-revision','topic','--alias','workspace-expert','--work','directory','--json'],{
    encoding:'utf8',env:{...f.options.repositoryOptions.environment,GIT_SSH_COMMAND:ssh,GIT_SSH_VARIANT:'ssh'},
  }));
  assert.equal(workspace.ok,true);assert.equal(readCapturedResolution(f.deployment,workspace.result.resolution).context.kind,'workspace');
});

test('public request-file preparation preserves operator bindings and explicit contexts under poisoned inherited selectors',t=>{
  const f=fixture(t,true),root=realpathSync(f.root),ssh=join(root,'request-ssh'),phaseLog=join(root,'phases');
  const manifest=JSON.parse(readFileSync(join(f.repo,'packages/action/cap/oats.json'),'utf8'));
  manifest.commands.binding='binding.mjs';manifest.binding={version:1,normalize:'binding',bind:'binding',check:'binding'};
  f.write('packages/action/cap/oats.json',JSON.stringify(manifest));
  f.write('packages/action/cap/binding.mjs',`import {readFileSync,appendFileSync} from 'node:fs';
    const r=JSON.parse(readFileSync(0,'utf8')),key='/bindings/knowledge/location';appendFileSync(${JSON.stringify(phaseLog)},r.phase+'\\n');let result;
    if(r.phase==='normalize'){const operator=r.input.declarations.find(entry=>entry.kind==='operator');result={requirements:[],candidates:[{key,kind:'operator',value:operator.value.bindings.location,origin:operator.origins['/bindings/location']}],model:{}};}
    else if(r.phase==='bind')result={payloadContract:'example.locations',payloadVersion:1,payload:{location:r.input.choices[key].value},credentialRefs:{},provenance:[r.input.choices[key].selectedBy]};
    else result={status:'ready',problems:[]};console.log(JSON.stringify({schemaVersion:1,phase:r.phase,slot:r.slot,capability:r.capability,ok:true,result}));`);
  f.git('add','.');f.git('commit','--quiet','-m','request-file provider');const revision=f.git('rev-parse','HEAD');
  writeFileSync(ssh,`#!/bin/sh\nexec git-upload-pack '${f.repo.replaceAll("'", "'\\''")}'\n`);chmodSync(ssh,0o700);
  const cli=fileURLToPath(new URL('../bin/oats.mjs',import.meta.url)),environment={...f.options.repositoryOptions.environment,GIT_SSH_COMMAND:ssh,GIT_SSH_VARIANT:'ssh',
    OATS_DEPLOYMENT:'malformed-inherited-deployment',OATS_RESOLUTION:'malformed-inherited-resolution',OATS_INSTANCE:'foreign-instance',PI_AGENT_HOME:'/foreign-home'};
  for(const [label,key] of [['keyed','κ'.repeat(128)],['null',null]]){
    const deployment=join(root,`request-${label}`);mkdirSync(deployment);
    const request={...f.input,deployment,source:{...f.input.source,source:'git:ssh://example.invalid/prepare.git',alias:'request-expert'},standaloneContextKey:key,
      operator:{policy:{},document:{kind:'operator',id:'request-fixture'},bindings:{location:'explicit-operator-location'}}};
    const file=join(root,`${label}.json`);writeFileSync(file,JSON.stringify(request),{mode:0o600});
    const before=existsSync(phaseLog)?readFileSync(phaseLog,'utf8'):'';
    const pending=spawnSync(process.execPath,[cli,'prepare','--request',file,'--json'],{encoding:'utf8',env:environment});
    assert.equal(pending.status,1,pending.stderr);const incomplete=JSON.parse(pending.stdout).error;
    assert.equal(incomplete.code,'needs-configuration');assert.equal(incomplete.details.problems[0].code,'approval-required');
    assert.equal(existsSync(phaseLog)?readFileSync(phaseLog,'utf8'):'',before,'unapproved provider phases do not run');
    approveAvailableCapability(deployment,incomplete.details.selections[0].artifactSet,f.id,{kind:'operator',document:{kind:'operator',id:'fixture'},pointer:'/approve'});
    const prepared=JSON.parse(execFileSync(process.execPath,[cli,'prepare','--request',file,'--json'],{encoding:'utf8',env:environment}));
    assert.equal(prepared.ok,true);assert.equal(prepared.result.status,'prepared');assert.equal(prepared.result.source.revision,revision);
    const record=readCapturedResolution(deployment,prepared.result.resolution);
    assert.deepEqual(structuredClone(record.context),{kind:'standalone',key});assert.equal(record.subject.soul.alias,'request-expert');
    assert.equal(record.bindings.knowledge.payload.location,'explicit-operator-location');assert.equal(record.choices['/bindings/knowledge/location'].selectedBy.document.id,'request-fixture');
    assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),request,'transport does not rewrite or strip the request');
  }
});

test('prepare-on-tick uses the real core adapter and captured CLI without injected preparation or admission',t=>{
  const f=fixture(t),ssh=join(f.root,'fixture-schedule-ssh');
  f.write('packages/action/cap/show.mjs','console.log(JSON.stringify({schemaVersion:1,ok:true,result:{marker:"A"}}));\n');
  f.git('add','.');f.git('commit','--quiet','-m','JSON command');
  writeFileSync(ssh,`#!/bin/sh\nexec git-upload-pack '${f.repo.replaceAll("'", "'\\''")}'\n`);chmodSync(ssh,0o700);
  const environment={...f.options.repositoryOptions.environment,GIT_SSH_COMMAND:ssh,GIT_SSH_VARIANT:'ssh',OATS_HOME_DIR:join(f.root,'host-state')};
  const input={...f.input,source:{...f.input.source,source:'git:ssh://example.invalid/prepare.git',revision:f.git('rev-parse','HEAD')}};
  const initial=prepareCapturedComposition(input,{repositoryOptions:{environment}});
  approveAvailableCapability(f.deployment,initial.selections[0].artifactSet,f.id,{kind:'operator',document:{kind:'operator',id:'fixture'},pointer:'/approve'});
  const prior=Object.fromEntries(Object.keys(environment).map(key=>[key,process.env[key]]));
  t.after(()=>{for(const [key,value] of Object.entries(prior)) if(value===undefined) delete process.env[key]; else process.env[key]=value;});
  Object.assign(process.env,environment);
  addSchedule(f.deployment,{id:'prepared',definitionVersion:2,recurrencePolicy:'prepare-on-tick',kind:'command',cwd:f.deployment,
    argv:['oats','example-action','show','--','--json'],preparation:input,cron:'* * * * *',tz:'UTC'});
  const result=tickWorkspace(f.deployment,{now:new Date('2026-09-16T12:10:00Z'),reg:{maxConcurrent:1}});
  assert.equal(result[0].action,'launched',JSON.stringify(result));
  const run=readState(f.deployment).jobs.prepared.lastRun;
  assert.equal(run.execution.resolution.id,initial.resolution.id);
  assert.equal(run.execution.responsibleHuman,null);
});

test('provider broker requires exact approval then runs retained phases without source or current config',t=>{
  const f=fixture(t,true),marker=join(f.root,'codec-ran'),manifestPath=join(f.repo,'packages/action/cap/oats.json');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  manifest.commands.binding='binding.mjs';manifest.binding={version:1,normalize:'binding',bind:'binding',check:'binding'};
  writeFileSync(manifestPath,JSON.stringify(manifest));
  f.write('packages/action/cap/binding.mjs',`import {readFileSync,writeFileSync} from 'node:fs';
    const request=JSON.parse(readFileSync(0,'utf8'));
    if(request.settings.timeoutProbe) { process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); }
    if(process.env.OATS_INSTANCE || process.env.OATS_RESOLUTION || process.env.PI_AGENT_HOME) throw Error('ambient identity');
    writeFileSync(${JSON.stringify(marker)},'ran');
    const result=request.phase==='normalize'?{requirements:[],candidates:[],model:{source:'retained-A'}}:
      request.phase==='bind'?{payloadContract:'example.locations',payloadVersion:1,payload:request.input.model,credentialRefs:{},provenance:[]}:
      {status:'ready',problems:[]};
    console.log(JSON.stringify({schemaVersion:1,phase:request.phase,slot:request.slot,capability:request.capability,ok:true,result}));`);
  f.git('add','.');f.git('commit','--quiet','-m','binding codec');
  const initial=prepareCapturedComposition(f.input,f.options),set=initial.selections[0].artifactSet;
  assert.equal(initial.resolution,null);
  const artifacts=readLock3(f.deployment).lock.artifactSets[set],context={kind:'standalone',key:null};
  const options={deployment:f.deployment,artifacts,capability:f.id,phase:'normalize',settings:{limit:3},input:{declarations:[],context}};
  assert.throws(()=>runCapturedProviderBinding(options),{code:'approval-required'});
  assert.equal(existsSync(marker),false,'unapproved code never ran');
  rmSync(f.repo,{recursive:true});
  approveAvailableCapability(f.deployment,set,f.id,{kind:'operator',document:{kind:'operator',id:'fixture'},pointer:'/approve'});
  writeFileSync(join(f.deployment,'oats-config.yaml'),'poison: current config must not be read\n');
  const prior=process.env.OATS_INSTANCE;process.env.OATS_INSTANCE='poison-instance';
  t.after(()=>{if(prior===undefined) delete process.env.OATS_INSTANCE;else process.env.OATS_INSTANCE=prior;});
  const normalized=runCapturedProviderBinding(options);assert.equal(normalized.model.source,'retained-A');
  const bound=runCapturedProviderBinding({...options,phase:'bind',input:{model:normalized.model,choices:{},context}});
  assert.equal(bound.binding.payload.source,'retained-A');
  const checked=runCapturedProviderBinding({...options,phase:'check',input:{binding:bound.binding,context,action:{kind:'command'}}});
  assert.equal(checked.status,'ready','fixture transport result only, not real provider qualification');
  assert.throws(()=>runCapturedProviderBinding({...options,timeoutMs:250,settings:{limit:3,timeoutProbe:true}}),{code:'provider-unavailable'});
  for (const timeoutMs of [0,30001,Infinity]) assert.throws(()=>runCapturedProviderBinding({...options,timeoutMs}));
});

test('preparation resolves approved provider fields in the same engine and never publishes conflicting bindings',t=>{
  const f=fixture(t,true),manifestFile=join(f.repo,'packages/action/cap/oats.json'),soulFile=join(f.repo,'agents/expert/soul.yaml');
  const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
  manifest.commands.binding='binding.mjs';manifest.binding={version:1,normalize:'binding',bind:'binding',check:'binding'};
  manifest.operations={probe:{command:'show',kind:'view',context:'scope',args:[{name:'label',flag:'--label',required:true}]},
    'scope-mutate':{command:'show',kind:'action',context:'scope'},'home-view':{command:'show',kind:'view',context:'home'},
    'home-probe':{command:'show',kind:'action',context:'home',args:[{name:'label',flag:'--label'}]}};
  writeFileSync(manifestFile,JSON.stringify(manifest));
  const soul=JSON.parse(readFileSync(soulFile,'utf8'));soul.knowledge={contract:'example.locations',version:1,payload:{location:'A'}};
  writeFileSync(soulFile,JSON.stringify(soul));const hookMarker=join(f.root,'captured-hook-ran');
  f.write('packages/action/cap/show.mjs',`import {readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';import {dirname} from 'node:path';
    const snapshot=process.env.OATS_BINDING_FILE,binding=JSON.parse(readFileSync(snapshot,'utf8'));
    const sourceSnapshot=process.env.OATS_SOURCE_RECEIPT_FILE??null,sourceReceipt=sourceSnapshot?JSON.parse(readFileSync(sourceSnapshot,'utf8')):null;
    const invocationSnapshot=process.env.OATS_INVOCATION_CONTEXT_FILE??null,invocation=invocationSnapshot?JSON.parse(readFileSync(invocationSnapshot,'utf8')):null;
    const result={documents:[],location:binding.payload.location,snapshot,invocationSnapshot,invocation,mode:statSync(snapshot).mode & 0o777,args:process.argv.slice(2),home:process.env.OATS_INSTANCE_HOME??null,resolution:process.env.OATS_RESOLUTION};
    if(invocation?.intent){const ledger=JSON.parse(readFileSync(invocation.executionBinding.deployment+'/.agents/portable/instance-references.json','utf8'));const row=ledger.instances.find(row=>row.incarnationId===invocation.instance.incarnationId);const intent=row?.intents.find(item=>item.executionId===invocation.intent.executionId);if(!intent||intent.state!=='running'||intent.attempt!==invocation.intent.attempt)throw Error('effect before durable admission');}
    if(process.env.OATS_OPERATION && process.argv.includes('negative-envelope')) {console.log(JSON.stringify({schemaVersion:1,ok:false,error:{code:'E_REMOTE',message:'service unavailable'},result:{id:'observed-resource'}}));process.exit(1);}
    if(process.env.OATS_OPERATION && process.argv.includes('cleanup-failure')) rmSync(dirname(snapshot),{recursive:true});
    if(process.env.OATS_EVENT) {
      writeFileSync(${JSON.stringify(hookMarker)},'ran');
      if(process.env.CLEANUP_CAPTURED_SNAPSHOTS) for(const path of [snapshot,sourceSnapshot,invocationSnapshot]) if(path) rmSync(dirname(path),{recursive:true});
    }
    console.log(JSON.stringify(process.env.OATS_EVENT?{meta:{sourceSnapshot,sourceIdentity:sourceReceipt?.sourceIdentity,executionBinding:sourceReceipt?.executionBinding,invocation}}:process.env.OATS_OPERATION?{schemaVersion:1,ok:true,result}:result));
    if(process.env.OATS_EVENT && process.env.FAIL_CAPTURED_HOOK) process.exitCode=1;`);
  const unavailable=join(f.root,'provider-unavailable'),checkContext=join(f.root,'provider-check-context.json');
  f.write('packages/action/cap/binding.mjs',`import {readFileSync,existsSync,writeFileSync} from 'node:fs';
    const r=JSON.parse(readFileSync(0,'utf8')),key='/bindings/knowledge/location'; let result;
    if(r.phase==='normalize') {
      const source=r.input.declarations.find(d=>d.kind==='soul'),operator=r.input.declarations.find(d=>d.kind==='operator');
      const requirements=[{key,kind:'equals',value:source.value.knowledge.payload.location,origin:source.origins['/knowledge/payload/location']}];
      const candidates=operator?.value.bindings?.location===undefined?[]:[{key,kind:'operator',value:operator.value.bindings.location,origin:operator.origins['/bindings/location']}];
      result={requirements,candidates,model:{}};
    } else if(r.phase==='bind') result={payloadContract:'example.locations',payloadVersion:1,payload:{location:r.input.choices[key].value},credentialRefs:{},provenance:[r.input.choices[key].selectedBy]};
    else {if(process.env.OATS_INVOCATION_CONTEXT_FILE)throw Error('check has a second context authority');if(r.input.invocation)writeFileSync(${JSON.stringify(checkContext)},JSON.stringify(r.input.invocation));result=existsSync(${JSON.stringify(unavailable)})?{status:'unavailable',problems:[{code:'provider-unavailable'}]}:{status:'ready',problems:[]};}
    console.log(JSON.stringify({schemaVersion:1,phase:r.phase,slot:r.slot,capability:r.capability,ok:true,result}));`);
  f.git('add','.');f.git('commit','--quiet','-m','source provider policy');
  const pending=prepareCapturedComposition(f.input,f.options);
  assert.equal(pending.resolution,null);assert.equal(pending.problems[0].code,'approval-required');
  approveAvailableCapability(f.deployment,pending.selections[0].artifactSet,f.id,{kind:'operator',document:{kind:'operator',id:'fixture'},pointer:'/approve'});
  const prepared=prepareCapturedComposition(f.input,f.options);
  assert.equal(prepared.status,'prepared',JSON.stringify(prepared));
  const record=readCapturedResolution(f.deployment,prepared.resolution);
  assert.equal(record.bindings.knowledge.payload.location,'A');assert.equal(record.choices['/bindings/knowledge/location'].value,'A');
  const conflict=prepareCapturedComposition({...f.input,operator:{policy:{},document:{kind:'operator',id:'fixture-conflict'},bindings:{location:'B'}}},f.options);
  assert.equal(conflict.status,'conflict');assert.equal(conflict.resolution,null);assert.equal(conflict.problems[0].code,'requirement-conflict');
  rmSync(f.repo,{recursive:true});
  assert.equal(loadCapturedDispatch({deployment:f.deployment,resolution:prepared.resolution,action:{kind:'inspect'}}).record.bindings.knowledge.payload.location,'A');
  writeFileSync(join(f.deployment,'oats-config.yaml'),'poison: never use this current configuration\n');
  const cli=fileURLToPath(new URL('../bin/oats.mjs',import.meta.url));
  const command=[cli,'--deployment',f.deployment,'--resolution',prepared.resolution.id,'example-action','show','--json'];
  const answer=JSON.parse(execFileSync(process.execPath,command,{encoding:'utf8',env:{...process.env,OATS_BINDING_FILE:'/poison/snapshot'}}));
  assert.equal(answer.location,'A');assert.equal(answer.mode,0o600);assert.equal(existsSync(answer.snapshot),false,'invocation snapshot removed after synchronous command');
  const operation=JSON.parse(execFileSync(process.execPath,[cli,'operation','run','knowledge:probe','--deployment',f.deployment,'--resolution',prepared.resolution.id,'--arg','label=exact','--json'],{encoding:'utf8'}));
  assert.equal(operation.ok,true);assert.equal(operation.result.result.location,'A');assert.deepEqual(operation.result.result.args,['--label','exact','--json']);
  assert.equal(operation.result.result.resolution,prepared.resolution.id);assert.equal(existsSync(operation.result.result.snapshot),false,'operation snapshot is removed before its receipt is rendered');
  assert.deepEqual(operation.result.result.invocation.action,{kind:'operation',slot:'knowledge',name:'probe'});assert.equal(operation.result.result.invocation.capability,f.id);
  assert.equal(operation.result.result.invocation.instance,null);assert.equal(existsSync(operation.result.result.invocationSnapshot),false,'invocation context is also transient');
  assert.deepEqual(JSON.parse(readFileSync(checkContext,'utf8')),operation.result.result.invocation,'check and scope operation receive identical derived authority');
  const cleanup=spawnSync(process.execPath,[cli,'operation','run','knowledge:probe','--deployment',f.deployment,'--resolution',prepared.resolution.id,'--arg','label=cleanup-failure','--json'],{encoding:'utf8'});
  assert.equal(cleanup.status,1);const cleanupFailure=JSON.parse(cleanup.stdout).error;
  assert.equal(cleanupFailure.code,'E_OPERATION_RESULT');assert.equal(cleanupFailure.details.unconfirmed,true);
  assert.equal(cleanupFailure.details.envelope.result.location,'A');assert.equal(cleanupFailure.details.envelope.result.args.includes('cleanup-failure'),true);
  assert.ok(cleanupFailure.details.cleanup.message,'cleanup diagnostic is retained with the observed provider receipt');
  const scopeMutation=spawnSync(process.execPath,[cli,'operation','run','knowledge:scope-mutate','--deployment',f.deployment,'--resolution',prepared.resolution.id,'--json'],{encoding:'utf8'});
  assert.equal(JSON.parse(scopeMutation.stdout).error.code,'admission-required','scope mutation does not invent an incarnation');
  const home=join(realpathSync(f.root),'captured-home');scaffoldCapturedInstance({deployment:f.deployment,resolution:prepared.resolution,home,instance:'captured-home'});
  const homeMetadata=JSON.parse(readFileSync(join(home,'instance.json'),'utf8'));
  writeFileSync(join(home,'instance.json'),JSON.stringify({...homeMetadata,capabilityMeta:{[f.id]:{identity:'prior-receipt'}}}));
  const homeCall=spawnSync(process.execPath,[cli,'operation','run','knowledge:home-probe','--deployment',f.deployment,'--resolution',prepared.resolution.id,'--home',home,'--json'],{encoding:'utf8'});
  assert.equal(homeCall.status,0,homeCall.stdout||homeCall.stderr);const homeOperation=JSON.parse(homeCall.stdout);
  assert.equal(homeOperation.result.result.home,home);assert.deepEqual(homeOperation.result.target,{home,instance:'captured-home'});
  assert.deepEqual(homeOperation.result.result.invocation.priorReceipt,{identity:'prior-receipt'});assert.equal(homeOperation.result.result.invocation.instance.agent,'imported-expert');
  assert.deepEqual(JSON.parse(readFileSync(checkContext,'utf8')),homeOperation.result.result.invocation,'readiness receives target and prior receipt before the home operation');
  const homeIntent=homeOperation.result.intent,homeArgv=[cli,'operation','run','knowledge:home-probe','--deployment',f.deployment,'--resolution',prepared.resolution.id,'--home',home,'--json'];
  const receipt=structuredClone(readCapturedInstanceIndex(f.deployment).instances.find(row=>row.home===home).intents.at(-1).receipt);
  for(const mirror of [{stale:'not-current'},undefined]){
    writeFileSync(join(home,'instance.json'),JSON.stringify({...homeMetadata,...(mirror===undefined?{}:{capabilityMeta:{[f.id]:mirror}})}));
    const before=readFileSync(join(f.deployment,'.agents/portable/instance-references.json'));
    const view=JSON.parse(execFileSync(process.execPath,homeArgv.map(value=>value==='knowledge:home-probe'?'knowledge:home-view':value),{encoding:'utf8'}));
    assert.deepEqual(view.result.result.invocation.priorReceipt,receipt,'home view derives current indexed receipt despite stale/absent mirror');
    assert.deepEqual(JSON.parse(readFileSync(checkContext,'utf8')),view.result.result.invocation,'view check/execution receive identical current authority');
    assert.equal(view.result.result.invocation.intent,null);assert.deepEqual(readFileSync(join(f.deployment,'.agents/portable/instance-references.json')),before,'view admits no action');
  }
  const faultDriver=join(realpathSync(f.root),'inert-runner-fault.mjs');
  writeFileSync(faultDriver,`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {pathToFileURL} from 'node:url';
    const original=cp.spawnSync;cp.spawnSync=(bin,args,options)=>options?.env?.OATS_OPERATION==='knowledge:home-probe'
      ?{status:null,signal:'SIGKILL',error:Object.assign(new Error('inert runner fault'),{code:'EIO'}),stdout:JSON.stringify({schemaVersion:1,ok:false,error:{code:'E_REMOTE',message:'service unavailable'},result:{id:'observed-resource'}}),stderr:''}
      :original(bin,args,options);syncBuiltinESMExports();process.argv[1]=${JSON.stringify(cli)};await import(pathToFileURL(process.argv[1]).href);`);
  for(const kind of ['negative-envelope','runner-fault']){
    const targetHome=join(realpathSync(f.root),kind);scaffoldCapturedInstance({deployment:f.deployment,resolution:prepared.resolution,home:targetHome,instance:kind});
    const argv=homeArgv.map(value=>value===home?targetHome:value);
    if(kind==='negative-envelope')argv.push('--arg','label=negative-envelope');else argv[0]=faultDriver;
    const failure=spawnSync(process.execPath,argv,{encoding:'utf8'});assert.equal(failure.status,1,failure.stderr);
    const error=JSON.parse(failure.stdout).error,row=readCapturedInstanceIndex(f.deployment).instances.find(row=>row.home===targetHome);
    assert.equal(error.code,kind==='negative-envelope'?'E_REMOTE':'E_CAPABILITY_BROKEN');
    assert.equal(error.details.unconfirmed,true);assert.equal(error.details.settlement.state,'unconfirmed');
    assert.deepEqual(error.details.settlement.receipt,structuredClone(row.intents[0].receipt));assert.equal(error.details.envelope.result.id,'observed-resource');
    assert.equal(error.details.intent.executionId,row.intents[0].executionId);assert.equal(row.intents[0].state,'unconfirmed');
    if(kind==='runner-fault')assert.equal(error.details.signal,'SIGKILL','non-timeout runner error retains observation without being relabelled timeout');
  }
  const beforeReplay=readFileSync(checkContext);
  const replayed=JSON.parse(execFileSync(process.execPath,[...homeArgv,'--retry-intent',homeIntent.executionId],{encoding:'utf8'}));
  assert.deepEqual(replayed.result.intent,homeIntent);assert.deepEqual(readFileSync(checkContext),beforeReplay,'completed retry never runs readiness or provider effects');
  const requestHome=join(realpathSync(f.root),'request-home');scaffoldCapturedInstance({deployment:f.deployment,resolution:prepared.resolution,home:requestHome,instance:'request-home'});
  const requestArgv=homeArgv.map(value=>value===home?requestHome:value);
  const newA=JSON.parse(execFileSync(process.execPath,requestArgv,{encoding:'utf8'})),newB=JSON.parse(execFileSync(process.execPath,requestArgv,{encoding:'utf8'}));
  assert.notEqual(newA.result.intent.executionId,newB.result.intent.executionId,'identical public requests do not collapse');
  const failedArgv=[...requestArgv,'--arg','label=cleanup-failure'];
  const failureA=JSON.parse(spawnSync(process.execPath,failedArgv,{encoding:'utf8'}).stdout).error;
  assert.equal(failureA.details.unconfirmed,true);assert.ok(failureA.details.intent.executionId);
  const failedRef=failureA.details.intent;
  const held=JSON.parse(spawnSync(process.execPath,requestArgv,{encoding:'utf8'}).stdout).error;assert.equal(held.code,'selection-changed');
  const failureB=JSON.parse(spawnSync(process.execPath,[...failedArgv,'--retry-intent',failedRef.executionId],{encoding:'utf8'}).stdout).error;
  assert.equal(failureB.details.intent.executionId,failedRef.executionId);assert.equal(failureB.details.intent.attempt,2);
  assert.equal(failureB.details.envelope.result.invocation.priorReceipt.result.invocation.intent.executionId,failedRef.executionId,'explicit retry consumes its own observed receipt');
  const target={home,work:join(home,'work'),name:'captured-home',agent:'imported-expert'};
  const checkBefore=readFileSync(checkContext),homeOptions={deployment:f.deployment,resolution:prepared.resolution,action:{kind:'hook',capability:f.id,name:'spawn'},invocationTarget:target};
  for(const bad of [
    {...homeOptions,invocationTarget:{...target,name:'replacement-instance'}},
    {...homeOptions,invocationTarget:{...target,agent:'replacement-agent'}},
    {...homeOptions,invocationTarget:{...target,work:join(f.root,'wrong-work')}},
    {...homeOptions,priorReceipt:{identity:'forged-prior'}},
    {...homeOptions,invocationTarget:null},
  ]) { assert.throws(()=>loadCapturedDispatch(bad));assert.deepEqual(readFileSync(checkContext),checkBefore,'target/prior contradictions fail before provider check'); }
  writeFileSync(join(home,'instance.json'),JSON.stringify({...homeMetadata,responsibleHuman:{provider:'example.messaging',id:'invented-human'}}));
  assert.throws(()=>loadCapturedDispatch(homeOptions));assert.deepEqual(readFileSync(checkContext),checkBefore);
  writeFileSync(join(home,'instance.json'),JSON.stringify(homeMetadata));
  const sourceReceipt={schemaVersion:1,kind:'persistent',home,work:join(home,'work'),context:prepared.executionBinding.deployment,agent:'imported-expert',instance:'captured-home',
    sourceIdentity:record.subject.soul.identity,role:'Expert instructions\n',executionBinding:prepared.executionBinding,responsibleHuman:null,binding:record.bindings.knowledge};
  assert.ok(existsSync(sourceReceipt.work),'real scaffold supplies witnessed work ownership');
  const forgedReceipts=[
    {...sourceReceipt,role:'ambient replacement'},
    {...sourceReceipt,executionBinding:{...sourceReceipt.executionBinding,resolution:{schemaVersion:1,id:'sha256-'+ '0'.repeat(64)}}},
    {...sourceReceipt,sourceIdentity:{kind:'local-soul',source:`path:${join(f.root,'other-source')}`,exportPath:'.'}},
    {...sourceReceipt,binding:{...sourceReceipt.binding,payload:{...sourceReceipt.binding.payload,location:'forged-B'}}},
    {...sourceReceipt,responsibleHuman:{provider:'example.messaging',id:'other-human'}},
  ];
  for(const forged of forgedReceipts) assert.throws(()=>runCapturedLifecycleHooks('spawn',{deployment:f.deployment,resolution:prepared.resolution,home,instance:'captured-home',agentName:'imported-expert',sourceReceipt:forged}),{code:'invalid-resolution'});
  assert.throws(()=>runCapturedLifecycleHooks('spawn',{deployment:f.deployment,resolution:prepared.resolution,home,instance:'captured-home',agentName:'other-agent',sourceReceipt}),{code:'invalid-resolution'});
  assert.equal(existsSync(hookMarker),false,'forged receipt refuses before provider readiness or hook execution');
  const hooks=runCapturedLifecycleHooks('spawn',{deployment:f.deployment,resolution:prepared.resolution,home,instance:'captured-home',agentName:'imported-expert',sourceReceipt});
  assert.equal(readFileSync(hookMarker,'utf8'),'ran');
  assert.deepEqual(hooks.order,[f.id]);assert.equal(JSON.stringify(hooks.meta[f.id].sourceIdentity),JSON.stringify(record.subject.soul.identity));
  assert.deepEqual(hooks.meta[f.id].executionBinding,prepared.executionBinding);assert.equal(existsSync(hooks.meta[f.id].sourceSnapshot),false,'source receipt snapshot is removed after the synchronous hook');
  assert.equal(hooks.meta[f.id].invocation.action.name,'spawn');assert.equal(hooks.meta[f.id].invocation.priorReceipt.result.home,home,'latest indexed operation receipt survives metadata rewriting');
  assert.equal(hooks.meta[f.id].invocation.instance.home,home);
  let retryIntents={};
  for (const failedChild of [false,true]) {
    const incomplete=runCapturedLifecycleHooks('spawn',{deployment:f.deployment,resolution:prepared.resolution,home,instance:'captured-home',agentName:'imported-expert',sourceReceipt,retryIntents,
      extraEnv:{CLEANUP_CAPTURED_SNAPSHOTS:'1',...(failedChild?{FAIL_CAPTURED_HOOK:'1'}:{})}});
    retryIntents=Object.fromEntries(Object.entries(incomplete.intents).map(([id,ref])=>[id,ref.executionId]));
    assert.equal(incomplete.meta[f.id].executionBinding.resolution.id,prepared.resolution.id,'nested cleanup failures retain the actual provider receipt');
    assert.equal(incomplete.meta[f.id].invocation.instance.home,home);
    assert.equal(incomplete.failures.length,1);assert.equal(incomplete.failures[0].contract,'snapshot-cleanup');
    assert.equal(incomplete.failures[0].required,true);assert.equal(incomplete.failures[0].unconfirmed,true);
    assert.ok(incomplete.failures[0].cleanup.code);
  }
  writeFileSync(join(home,'instance.json'),JSON.stringify({instance:'captured-home',executionBinding:{...prepared.executionBinding,resolution:{schemaVersion:1,id:'sha256-'+ '0'.repeat(64)}}}));
  const mismatch=spawnSync(process.execPath,[cli,'operation','run','knowledge:home-probe','--deployment',f.deployment,'--resolution',prepared.resolution.id,'--home',home,'--json'],{encoding:'utf8'});
  assert.equal(mismatch.status,1);assert.equal(JSON.parse(mismatch.stdout).error.code,'E_HOME_MISMATCH');
  const loaded=loadCapturedDispatch({deployment:f.deployment,resolution:prepared.resolution,action:{kind:'command',capability:f.id,name:'show'}});
  const checkedContext=JSON.parse(readFileSync(checkContext,'utf8'));assert.equal(checkedContext.action.kind,'command');assert.equal(checkedContext.capability,f.id);
  assert.equal(checkedContext.executionBinding.resolution.id,prepared.resolution.id);assert.equal(checkedContext.instance,null);
  assert.deepEqual(checkedContext,JSON.parse(JSON.stringify(loaded.invocation)));
  const capturedCheck={deployment:f.deployment,artifacts:record.artifacts,capability:f.id,phase:'check',settings:loaded.capability.settings,
    input:{binding:record.bindings.knowledge,context:record.context,action:loaded.action,invocation:loaded.invocation}};
  assert.equal(runCapturedProviderBinding(capturedCheck).status,'ready');
  const brokerCheckBefore=readFileSync(checkContext);
  for(const bad of [
    {...capturedCheck,input:{...capturedCheck.input,invocation:{...loaded.invocation,subject:{...loaded.invocation.subject,soul:{...loaded.invocation.subject.soul,alias:'forged'}}}}},
    {...capturedCheck,settings:{limit:99}},
    {...capturedCheck,input:{...capturedCheck.input,binding:{...record.bindings.knowledge,payload:{location:'other-location'}}}},
  ]) { assert.throws(()=>runCapturedProviderBinding(bad),{code:'invalid-resolution'});assert.deepEqual(readFileSync(checkContext),brokerCheckBefore,'public check cannot authorize a forged invocation'); }
  assert.throws(()=>runCapturedProviderBinding({deployment:f.deployment,artifacts:record.artifacts,capability:f.id,phase:'check',settings:{limit:3},
    input:{binding:record.bindings.knowledge,context:record.context,action:{kind:'command',capability:f.id,name:'show'}},invocationContextFile:checkContext}),
    {code:'invalid-declaration'},'prospective binding callers cannot nominate a context-file authority');
  let failedSnapshot;
  assert.throws(()=>withCapturedBindingFile(loaded,env=>{failedSnapshot=env.OATS_BINDING_FILE;throw Error('fixture child failure');}),/fixture child failure/);
  assert.equal(existsSync(failedSnapshot),false,'failure also removes only the owned invocation snapshot');
  writeFileSync(unavailable,'not ready');
  const blockedHome=join(realpathSync(f.root),'before-execution');scaffoldCapturedInstance({deployment:f.deployment,resolution:prepared.resolution,home:blockedHome,instance:'before-execution'});
  const blocked=JSON.parse(spawnSync(process.execPath,homeArgv.map(value=>value===home?blockedHome:value),{encoding:'utf8'}).stdout).error;
  assert.equal(blocked.code,'provider-unavailable');assert.equal(blocked.details.settlement.state,'blocked');assert.equal(blocked.details.unconfirmed,false);
  assert.equal(readCapturedInstanceIndex(f.deployment).instances.find(row=>row.home===blockedHome).intents[0].state,'blocked');
  assert.throws(()=>loadCapturedDispatch({deployment:f.deployment,resolution:prepared.resolution,action:{kind:'command',capability:f.id,name:'show'}}),{code:'provider-unavailable'},'mutable readiness is checked again, not cached as permanent record authority');
});

test('standalone OKF consumer prepares its actual retained binding payload with no kernel-private provider imports', {skip:!process.env.OATS_OKF_CONSUMER_REPO}, async t=>{
  const f=fixture(t,true),provider=process.env.OATS_OKF_CONSUMER_REPO,revision=process.env.OATS_OKF_CONSUMER_REV,cli=fileURLToPath(new URL('../bin/oats.mjs',import.meta.url));
  assert.match(revision ?? '',/^[a-f0-9]{40}$/,'consumer must pin an exact provider commit');
  const archive=execFileSync('git',['-C',provider,'archive',revision,'oats-package'],{maxBuffer:16*1024*1024});
  const destination=join(f.repo,'packages/action');rmSync(destination,{recursive:true});mkdirSync(destination);
  execFileSync('tar',['-x','--strip-components=1','-C',destination],{input:archive});
  const physicalRoot=realpathSync(f.root); // OKF deliberately refuses symlinked custody locators, including platform aliases.
  const settings={'bindings-file':join(physicalRoot,'host','bindings.json'),'state-dir':join(physicalRoot,'state')};
  const soulFile=join(f.repo,'agents/expert/soul.yaml'),soul=JSON.parse(readFileSync(soulFile,'utf8'));
  soul.requires.knowledge={capability:'oats.okf',source:'repo:packages/action',settings};
  soul.knowledge={contract:'oats.okf.locations',version:1,payload:{owner:'expert-owner',stores:{private:{fixed:{id:'private-kb',kind:'directory',path:`path:${join(physicalRoot,'knowledge')}`}}},reads:[],owns:[{node:'expert',destination:'private'}]}};
  writeFileSync(soulFile,JSON.stringify(soul));f.git('add','-A');f.git('commit','--quiet','-m','real OKF consumer');
  const pending=prepareCapturedComposition(f.input,f.options);assert.equal(pending.resolution,null,JSON.stringify(pending));
  approveAvailableCapability(f.deployment,pending.selections[0].artifactSet,'oats.okf',{kind:'operator',document:{kind:'operator',id:'fixture'},pointer:'/approve'});
  const ready=prepareCapturedComposition(f.input,f.options);assert.equal(ready.status,'prepared',JSON.stringify(ready));
  const record=readCapturedResolution(f.deployment,ready.resolution),binding=record.bindings.knowledge;
  assert.equal(binding.payloadContract,'oats.okf.locations');assert.equal(binding.payload.runtime.bindings.stateDir,settings['state-dir']);
  assert.deepEqual(binding.payload.runtime.declaration.owns,['private-kb/expert']);assert.equal(binding.payload.execution.runtime,'pi');
  rmSync(f.repo,{recursive:true});writeFileSync(join(f.deployment,'oats-config.yaml'),'poison: current configuration is not binding authority\n');
  const checked=runCapturedProviderBinding({deployment:f.deployment,artifacts:record.artifacts,capability:'oats.okf',phase:'check',settings:{},input:{binding,context:record.context,action:{kind:'command'}}});
  assert.notEqual(checked.status,'ready','absent accepted base must not be qualified');
  const inspected=loadCapturedDispatch({deployment:f.deployment,resolution:ready.resolution,action:{kind:'inspect'}});
  const root=inspected.manifests.get('oats.okf')._dir;
  const {initBase}=await import(pathToFileURL(join(root,'lib/migration.mjs')));
  const nodes=join(physicalRoot,'fixture-nodes.json');writeFileSync(nodes,JSON.stringify({expert:{path:'expert',owner:'expert-owner'}}));
  mkdirSync(join(settings['bindings-file'],'..'),{recursive:true});
  initBase(binding.payload.runtime.bindings,'private-kb',nodes,undefined,{confirm:true}); // Administrative fixture bootstrap only.
  const capturedHomes=join(physicalRoot,'captured-homes');mkdirSync(capturedHomes);const sourceHome=join(capturedHomes,'imported-expert-1');
  const spawned=spawnSync(process.execPath,[cli,'spawn','imported-expert','--deployment',f.deployment,'--resolution',ready.resolution.id,'--home',sourceHome,'--no-launch','--json'],
    {encoding:'utf8',env:{...process.env,OATS_HOME_DIR:join(physicalRoot,'host-state')}});
  assert.equal(spawned.status,0,spawned.stdout||spawned.stderr);const spawnResult=JSON.parse(spawned.stdout).result;
  assert.equal(spawnResult.home,sourceHome);assert.equal(spawnResult.launchPending,true);assert.deepEqual(spawnResult.hookOrder,['oats.okf']);
  const sourceMeta=JSON.parse(readFileSync(join(sourceHome,'instance.json'),'utf8'));assert.equal(sourceMeta.capabilityMeta['oats.okf'].memory,'okf-v2');
  const descriptor=JSON.parse(readFileSync(sourceMeta.capabilityMeta['oats.okf'].source,'utf8'));
  assert.deepEqual(descriptor.executionBinding,ready.executionBinding);assert.equal(descriptor.responsibleHuman,null);
  assert.equal(JSON.stringify(descriptor.sourceIdentity),JSON.stringify(record.subject.soul.identity));
  const schedules=JSON.parse(readFileSync(join(f.deployment,'oats-schedules.json'),'utf8')),schedule=schedules.jobs[`okf-${descriptor.id}`];
  assert.equal(schedule.definitionVersion,2);assert.equal(schedule.recurrencePolicy,'capture');assert.equal(schedule.execution.responsibleHuman,null);
  assert.equal(schedule.execution.resolution.id,ready.resolution.id);
  const poisonState=join(physicalRoot,'poison-state'),poisonBase=join(physicalRoot,'poison-base'),poisonNodes=join(physicalRoot,'poison-nodes.json');
  writeFileSync(poisonNodes,JSON.stringify({expert:{path:'expert',owner:'expert-owner'}}));mkdirSync(join(settings['bindings-file'],'..'),{recursive:true});
  writeFileSync(settings['bindings-file'],JSON.stringify({version:1,stateDir:poisonState,bases:{'private-kb':{id:'private-kb',kind:'directory',path:poisonBase}}}));
  const poisonBytes=readFileSync(settings['bindings-file']);
  for(const [name,argv] of [['setup',['--source',join(physicalRoot,'missing-source.json')]],['init',['--base','private-kb','--nodes',poisonNodes,'--confirm']],
    ['migrate',['--legacy',join(physicalRoot,'legacy'),'--base','private-kb','--node','expert','--output',join(physicalRoot,'stage')]],
    ['unlock',['--lock',join(physicalRoot,'missing-lock'),'--token','no-token']]]) {
    const call=spawnSync(process.execPath,[cli,'okf',name,'--deployment',f.deployment,'--resolution',ready.resolution.id,'--',...argv,'--json'],{encoding:'utf8'});
    assert.equal(call.status,1,`${name}: ${call.stdout||call.stderr}`);assert.equal(JSON.parse(call.stdout).error.code,'provider-not-qualified',name);
  }
  assert.deepEqual(readFileSync(settings['bindings-file']),poisonBytes);assert.equal(existsSync(poisonState),false);assert.equal(existsSync(poisonBase),false);
  const loaded=loadCapturedDispatch({deployment:f.deployment,resolution:ready.resolution,action:{kind:'command',capability:'oats.okf',name:'binding-check'}});
  const moduleUrl=pathToFileURL(join(root,'lib/binding-wire.mjs')).href;
  let invocation;
  const projected=withCapturedBindingFile(loaded,env=>{
    invocation=env.OATS_BINDING_FILE;
    return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`import {loadInvocationKnowledgeBinding} from ${JSON.stringify(moduleUrl)}; const r=loadInvocationKnowledgeBinding();console.log(JSON.stringify({kind:r.kind,owner:r.binding.payload.owner}));`],{encoding:'utf8',env:{...process.env,...env}}));
  });
  assert.deepEqual(projected,{kind:'captured',owner:'expert-owner'});assert.equal(existsSync(invocation),false);
});

test('standalone aweb consumer accepts exact captured check and snapshot wire without native effects', {skip:!process.env.OATS_AWEB_CONSUMER_REPO}, async t=>{
  const f=fixture(t,true),provider=process.env.OATS_AWEB_CONSUMER_REPO,revision=process.env.OATS_AWEB_CONSUMER_REV;
  assert.match(revision??'',/^[a-f0-9]{40}$/,'consumer must pin an exact provider commit');
  const archive=execFileSync('git',['-C',provider,'archive',revision,'oats-package'],{maxBuffer:16*1024*1024});
  const destination=join(f.repo,'packages/action');rmSync(destination,{recursive:true});mkdirSync(destination);
  execFileSync('tar',['-x','--strip-components=1','-C',destination],{input:archive});
  const physical=realpathSync(f.root),tools=join(physical,'tools'),marker=join(physical,'native-aw-ran');mkdirSync(tools);
  writeFileSync(join(tools,'aw'),`#!${process.execPath}\nimport {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'unexpected');process.exit(99);\n`,{mode:0o700});
  const priorPath=process.env.PATH;process.env.PATH=`${tools}:${priorPath}`;t.after(()=>{process.env.PATH=priorPath;});
  f.write('agents/expert/soul.yaml',JSON.stringify({schemaVersion:1,name:'expert',work:'directory',teams:[],requires:{messaging:{capability:'oats.aweb',source:'repo:packages/action',settings:{delivery:'session'}}}}));
  f.git('add','-A');f.git('commit','--quiet','-m','real aweb wire consumer');
  const human={provider:'oats.aweb',id:'human:fixture'},input={...f.input,standaloneContextKey:'explicit-fixture',operator:{policy:{},document:{kind:'operator',id:'aweb-consumer'},bindings:{responsibleHuman:human,wider:[]}}};
  const pending=prepareCapturedComposition(input,f.options);assert.equal(pending.resolution,null,JSON.stringify(pending));
  approveAvailableCapability(f.deployment,pending.selections[0].artifactSet,'oats.aweb',{kind:'operator',document:{kind:'operator',id:'fixture-approve'},pointer:'/approve'});
  const prepared=prepareCapturedComposition(input,f.options);assert.equal(prepared.status,'prepared',JSON.stringify(prepared));
  const record=readCapturedResolution(f.deployment,prepared.resolution),binding=record.bindings.messaging;
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.responsibleHuman)),human);assert.deepEqual(record.messagingChoice.wider,[]);
  rmSync(f.repo,{recursive:true});writeFileSync(join(f.deployment,'oats-config.yaml'),'poison: never select ambient provider state\n');
  writeFileSync(join(f.deployment,'oats-lock.json'),'poisoned current lock');
  const home=join(physical,'imported-expert-1');scaffoldCapturedInstance({deployment:f.deployment,resolution:prepared.resolution,home,instance:'imported-expert-1'});
  const inspected=loadCapturedDispatch({deployment:f.deployment,resolution:prepared.resolution,action:{kind:'inspect'}}),capability=inspected.capabilities.get('oats.aweb');
  const {buildCapturedInvocationContext,withCapturedInvocationContextFile}=await import('../lib/captured-invocation-context.mjs');
  const action={kind:'hook',capability:'oats.aweb',name:'spawn'},invocation=buildCapturedInvocationContext({loaded:{...inspected,capability},action,
    instance:{home,work:join(home,'work'),name:'imported-expert-1',agent:'imported-expert'}});
  const checked=runCapturedProviderBinding({deployment:f.deployment,artifacts:record.artifacts,capability:'oats.aweb',phase:'check',settings:capability.settings,input:{binding,context:record.context,action,invocation}});
  assert.notEqual(checked.status,'ready','accepted wire is not setup/privacy qualification');
  const loaded={...inspected,capability};let contextFile,bindingFile;
  const consumed=withCapturedInvocationContextFile(invocation,contextEnv=>withCapturedBindingFile(loaded,bindingEnv=>{
    contextFile=contextEnv.OATS_INVOCATION_CONTEXT_FILE;bindingFile=bindingEnv.OATS_BINDING_FILE;
    const module=pathToFileURL(join(capability.manifest._dir,'lib/invocation-context.mjs')).href;
    return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`import {loadCapturedAwebInvocation} from ${JSON.stringify(module)};const r=loadCapturedAwebInvocation();console.log(JSON.stringify({kind:r.kind,subject:r.context.subject}));`],{encoding:'utf8',env:{...process.env,...contextEnv,...bindingEnv}}));
  }));
  assert.equal(consumed.kind,'captured');assert.deepEqual(consumed.subject,JSON.parse(JSON.stringify(record.subject)));
  assert.equal(existsSync(contextFile),false);assert.equal(existsSync(bindingFile),false);
  assert.throws(()=>loadCapturedDispatch({deployment:f.deployment,resolution:prepared.resolution,action:{kind:'command',namespace:'aweb',name:'setup'}}),{code:'authorization-required'});
  const blocked=activateCapturedScaffold.bind(null,{deployment:f.deployment,resolution:prepared.resolution,home});
  assert.throws(blocked,{code:'E_REQUIRED_HOOK_FAILED'});assert.equal(existsSync(join(home,'.aw')),false);assert.equal(existsSync(marker),false,'no native aw was invoked');
});

test('workspace adoption conflicts follow qualified soul identity across aliases before package acquisition',t=>{
  const f=fixture(t),source=f.input.source.source,reference=f.input.source;
  f.write('oats-workspace.yaml',JSON.stringify({schemaVersion:1,name:'Fixture',imports:[
    {...reference,alias:'alpha',adoption:{providers:{tasks:'none'}}},
    {...reference,alias:'beta',adoption:{providers:{tasks:{capability:f.id,source:'repo:packages/action'}}}},
  ]}));
  f.git('add','.');f.git('commit','--quiet','-m','Workspace imports');
  const origin={kind:'operator',document:{kind:'operator',id:'fixture'},pointer:'/workspace'};
  const result=prepareCapturedComposition({...f.input,source:'alpha',workspace:{source,revision:'topic',origin}},f.options);
  assert.equal(result.status,'conflict');assert.equal(result.resolution,null);
  assert.equal(existsSync(join(f.deployment,'oats-lock.json')),false);
});

test('provider qualification gaps expose prospective software without a fake complete record; legacy state refuses before fetch',t=>{
  const f=fixture(t,true),result=prepareCapturedComposition(f.input,f.options);
  assert.equal(result.status,'needs-configuration');assert.equal(result.resolution,null);
  assert.equal(result.problems[0].code,'provider-not-qualified');assert.equal(existsSync(join(f.deployment,'.agents/resolutions')),false);
  assert.ok(readLock3(f.deployment).lock.artifactSets[result.selections[0].artifactSet]);
  const other=join(f.root,'legacy');mkdirSync(other);writeFileSync(join(other,'oats-lock.json'),'{"lockfileVersion":2}');
  let observed=0;
  assert.throws(()=>prepareCapturedComposition({...f.input,deployment:other},{repositoryOptions:{identityReader(){ observed++;throw new Error('must not observe'); }}}),{code:'migration-required'});
  assert.equal(observed,0);assert.equal(existsSync(join(other,'.agents')),false);
});
