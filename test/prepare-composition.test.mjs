import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { prepareCapturedComposition, loadCapturedDispatch, approveAvailableCapability, runCapturedProviderBinding } from '../lib/core.mjs';
import { readCapturedResolution } from '../lib/captured-resolutions.mjs';
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
  write('packages/action/cap/show.mjs','console.log("A");\n');write('packages/action/cap/inject.md','Capability instructions\n');
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
  assert.equal(record.dispatch.composition.skills.length,4);
  assert.equal(record.dispatch.launch,null,'command/curriculum preparation does not invent a launch recipe');
  rmSync(f.repo,{recursive:true});
  approveAvailableCapability(f.deployment,result.selections[0].artifactSet,f.id,{kind:'operator',document:{kind:'operator',id:'fixture'},pointer:'/approve'});
  const action=loadCapturedDispatch({deployment:f.deployment,resolution:result.resolution,action:{kind:'command',namespace:'example-action',name:'show'}});
  assert.equal(execFileSync(process.execPath,[action.executable.file,...action.executable.args],{encoding:'utf8'}).trim(),'A');
  const hook=loadCapturedDispatch({deployment:f.deployment,resolution:result.resolution,action:{kind:'hook',capability:f.id,name:'spawn'}});
  assert.equal(hook.executable.file,action.executable.file); assert.deepEqual(hook.executable.args,[]);
  const helper=loadCapturedDispatch({deployment:f.deployment,resolution:record.helpers['example.action:worker'],action:{kind:'compose'}});
  assert.ok(helper.composition.text.startsWith('Worker instructions'));
  assert.ok(loadCapturedDispatch({deployment:f.deployment,resolution:result.resolution,action:{kind:'compose'}}).composition.text.includes('Capability instructions'));
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
