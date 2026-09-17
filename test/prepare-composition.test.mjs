import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { activateCapturedScaffold, prepareCapturedComposition, loadCapturedDispatch, approveAvailableCapability, resolveCapturedHelper, runCapturedProviderBinding, runCapturedLifecycleHooks, scaffoldCapturedInstance, withCapturedBindingFile } from '../lib/core.mjs';
import { commitCapturedResolution, readCapturedResolution } from '../lib/captured-resolutions.mjs';
import { readCapturedInstanceIndex } from '../lib/captured-instance-index.mjs';
import { readLock3 } from '../lib/portable-lock.mjs';
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
    'scope-mutate':{command:'show',kind:'action',context:'scope'},'home-probe':{command:'show',kind:'action',context:'home',args:[{name:'label',flag:'--label'}]}};
  writeFileSync(manifestFile,JSON.stringify(manifest));
  const soul=JSON.parse(readFileSync(soulFile,'utf8'));soul.knowledge={contract:'example.locations',version:1,payload:{location:'A'}};
  writeFileSync(soulFile,JSON.stringify(soul));const hookMarker=join(f.root,'captured-hook-ran');
  f.write('packages/action/cap/show.mjs',`import {readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';import {dirname} from 'node:path';
    const snapshot=process.env.OATS_BINDING_FILE,binding=JSON.parse(readFileSync(snapshot,'utf8'));
    const sourceSnapshot=process.env.OATS_SOURCE_RECEIPT_FILE??null,sourceReceipt=sourceSnapshot?JSON.parse(readFileSync(sourceSnapshot,'utf8')):null;
    const invocationSnapshot=process.env.OATS_INVOCATION_CONTEXT_FILE??null,invocation=invocationSnapshot?JSON.parse(readFileSync(invocationSnapshot,'utf8')):null;
    const result={documents:[],location:binding.payload.location,snapshot,invocationSnapshot,invocation,mode:statSync(snapshot).mode & 0o777,args:process.argv.slice(2),home:process.env.OATS_INSTANCE_HOME??null,resolution:process.env.OATS_RESOLUTION};
    if(invocation?.intent){const ledger=JSON.parse(readFileSync(invocation.executionBinding.deployment+'/.agents/portable/instance-references.json','utf8'));const row=ledger.instances.find(row=>row.incarnationId===invocation.instance.incarnationId);const intent=row?.intents.find(item=>item.executionId===invocation.intent.executionId);if(!intent||intent.state!=='running'||intent.attempt!==invocation.intent.attempt)throw Error('effect before durable admission');}
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
