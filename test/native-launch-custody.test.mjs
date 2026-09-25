import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { startInstanceSession, restartInstanceSession } from "../lib/core.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

import { HERDR_PROTOCOL } from "../lib/herdr.mjs";
import { nativeHistoryPath, historicalSessionRoots } from "../packages/record/lib/native-history.mjs";
import { sessionsForHome } from "../packages/record/lib/sessions-for-home.mjs";

const CLI = realpathSync(new URL("../bin/oats.mjs", import.meta.url));
const HOST_PATH = process.env.PATH;
function write(file, body) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, body); }
const hostGit = () => execFileSync("/bin/sh", ["-c", "command -v git"], { env: { PATH: HOST_PATH }, encoding: "utf8" }).trim();
const WORKER = "example.worker";
const workerManifest = (hook, launch = false) => ({ capability: WORKER, version: "1.0.0", description: "Provider-neutral execution fixture.", compatibility: { oats: ">=0.6.2" }, skills: ["skills"], inject: "inject.md",
  ...(hook ? { hooks: { spawn: "spawn.mjs", retire: "retire.mjs", ...(launch ? { launch: "launch.mjs" } : {}) } } : {}) });
/** A workspace deployment (test/helpers/v2-deployment.mjs) whose one soul, `worker` (work: directory), resolves the
 *  member capability example.worker. Spawns go through the real prepare → spawnInstanceAsync path.
 *
 *  KNOWN KERNEL BUG (c3a port, open): session start/restart of a workspace home resolves each recorded provider
 *  (capturedProviders = every capabilityRuntime row) through capabilityManifest(id, meta.repo); meta.repo is the
 *  deployment (or a member clone), never the home's .oats/modules, so every such start answers E_LAUNCH_PREPARATION
 *  ("… no longer installed in the scope"). The tests that start a home past the work-root checks (R1 root authority,
 *  the launch-hook custody cases, the history tests) assert the CORRECT behaviour and fail until it is fixed. */
function fixture(t, { hook = false } = {}) {
  const files = {
    "skills/worker-skill/SKILL.md": "---\nname: worker-skill\ndescription: Generic worker fixture.\n---\n# Worker skill\n",
    "inject.md": "## Generic worker capability\n",
    ...(hook ? {
      "spawn.mjs": `import { writeFileSync } from 'node:fs';
const e = process.env;
writeFileSync(e.OATS_INSTANCE_HOME + '/work/from-hook.txt', 'spawn bytes');
console.log(JSON.stringify({meta: {context: e.OATS_CONTEXT, repo: e.OATS_REPO, root: e.OATS_ROOT, work: e.OATS_WORK, branch: e.OATS_BRANCH, cli: e.OATS_CLI_BIN}}));\n`,
      "retire.mjs": `console.log(JSON.stringify({meta: {retired: true}}));\n`,
    } : {}),
  };
  const fx = v2Deployment({
    souls: { worker: { soul: { work: "directory", capabilities: { [WORKER]: { from: "here" } } }, agents: "# Generic worker\n" } },
    capabilities: { [WORKER]: { manifest: workerManifest(hook), files } },
  });
  const base = fx.base;
  const saved = { ...process.env };
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    fx.cleanup();
  });
  // No host identity, credentials, config, harness, or scheduler can leak into a
  // no-launch probe. Harnesses are inert executables for preflight only; git is
  // the one host tool (the spawn resolves the workspace over its local remote).
  const git = hostGit();
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, { HOME: join(base, "user"), OATS_HOME_DIR: join(base, "store"), PATH: join(base, "bin"), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(base, "gitconfig"), OATS_REMOTE_CACHE: fx.env.OATS_REMOTE_CACHE });
  mkdirSync(process.env.HOME); write(process.env.GIT_CONFIG_GLOBAL, "");
  mkdirSync(process.env.PATH);
  symlinkSync(process.execPath, join(process.env.PATH, "node"));
  symlinkSync(git, join(process.env.PATH, "git"));
  for (const name of ["pi", "claude", "codex"]) {
    write(join(process.env.PATH, name), `#!/bin/sh\necho unexpected-harness-launch >&2\nexit 99\n`);
    chmodSync(join(process.env.PATH, name), 0o755);
  }
  const f = { base, fx, context: fx.dep, root: fx.root, harness: "claude" };
  /** The worker capability gains a launch hook (committed to the member before any spawn). */
  f.launchHook = (script) => fx.commit({ [`capabilities/${WORKER}/oats.json`]: { json: workerManifest(hook, true) }, [`capabilities/${WORKER}/launch.mjs`]: script }, "worker: launch hook");
  /** Launch configurations are the deployment's oats-local.yaml `launch-configs:`. */
  f.launchConfigs = (configs) => writeFileSync(join(fx.dep, "oats-local.yaml"), JSON.stringify({ schemaVersion: 2, workspace: fx.ref, "launch-configs": configs }) + "\n");
  f.spawn = (purpose, options = {}) => fx.spawn("worker", { purpose, harness: f.harness, ...options });
  return f;
}
function readJson(file) { return JSON.parse(readFileSync(file, "utf8")); }



// A logging-only backend which optionally executes only fixture native
// binaries. /bin/true is the fallback shell; no tmux, model, host config.
function installBackend(f, { execute = false } = {}) {
  const log = join(f.base, 'backend.jsonl');
  process.env.SHELL = '/usr/bin/true';
  write(join(f.base, 'bin/tmux'), `#!${process.execPath}
const fs=require('node:fs'),cp=require('node:child_process');const a=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+String.fromCharCode(10));
if(a.includes('display-message')) console.log(${JSON.stringify(join(f.base,'fake.sock'))});
if(a.includes('list-panes')) { console.error("can't find window");process.exit(1); }
if(${execute} && (a.includes('new-window') || a.includes('respawn-pane'))) {
 const env={...process.env}; for(let i=0;i<a.length;i++) if(a[i]==='-e'){const pair=a[++i],k=pair.indexOf('=');env[pair.slice(0,k)]=pair.slice(k+1);}
 const r=cp.spawnSync('/bin/sh',['-c',a.at(-1)],{cwd:a[a.indexOf('-c')+1],env,encoding:'utf8'});
 if(r.status!==0) {console.error(r.stderr);process.exit(r.status||1);}
}
`);
  chmodSync(join(f.base, 'bin/tmux'), 0o755);
  return log;
}

// Exact original native recall reproduction, lifted out of the OKF lifecycle
// script so it loads only the reviewed framework. Producer expectations fixed.
function native(f,count,size) {
  process.env.TURN_RECORD_ROOT=join(f.base,'record');process.env.TURN_RECORD_OWNER='fixture';
  const home=join(f.base,'native-source');mkdirSync(home);
  const transcript=join(process.env.HOME,'.claude','projects','-fixture','fixture-session.jsonl');
  write(transcript,Array.from({length:count},(_,i)=>JSON.stringify({type:'assistant',cwd:home,sessionId:'fixture-session',timestamp:'2026-09-13T12:00:00Z',message:{role:'assistant',content:[{type:'text',text:String(i)+' '+('x'.repeat(size))}]}})).join('\n')+'\n');
  return home;
}
test('original native recall now drains successful >21MB JSON',t=>{
 const f=fixture(t),home=native(f,60,350000);
 const cap=spawnSync(process.execPath,[CLI,'capture','--current-roots','--home',home,'--quiet'],{env:process.env,encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(cap.status,0,cap.stderr);const report=JSON.parse(cap.stdout);
 const r=spawnSync(process.execPath,[CLI,'recall','--thread',report.sessions[0].thread,'--until',report.sessions[0].lastTurnId,'--limit','60','--json'],{env:process.env,encoding:'utf8',maxBuffer:32*1024*1024});
 assert.equal(r.status,0);const out=JSON.parse(r.stdout);assert.equal(out.turns.length,60);assert.equal(out.remaining,0);
 assert.ok(Buffer.byteLength(r.stdout)>21_000_000);
 assert.equal(out.turns.at(-1).text[0].text, '59 '+('x'.repeat(350000)));
 console.log('ORIGINAL NATIVE RECALL: exit '+r.status+', output '+Buffer.byteLength(r.stdout)+' bytes, all 60 records intact');
});

// Observer environment changes after an inert native executable has emitted
// evidence. The executable does no model/network work and uses only the
// source recipe's real shell/environment transport.
for(const [harness,variable,suffix,source] of [['claude','CLAUDE_CONFIG_DIR','projects/p','cc'],['pi','PI_CODING_AGENT_DIR','sessions/p','pi'],['codex','CODEX_HOME','sessions/2026/09/13','codex']]) {
 for(const kind of ['inherited-disappeared','fromEnv-retargeted']) {
  test(`R1 root authority ${harness}: ${kind} cannot certify empty observer storage`,async t=>{
   const f=fixture(t);
   f.harness=harness; // v2 souls declare no harness: the spawn selects it
   const actual=join(f.base,'native-root-at-launch'),observer=join(f.base,'empty-observer-root');
   mkdirSync(join(observer,suffix),{recursive:true});
   process.env[variable]=actual;process.env.FIXTURE_NATIVE_LOCATION=actual;process.env.ANTHROPIC_API_KEY='FIXTURE_SECRET_VALUE';
   if(kind==='fromEnv-retargeted') {
    // Launch configurations live in the deployment's oats-local.yaml.
    f.launchConfigs({custom:{harness,env:{[variable]:{fromEnv:'FIXTURE_NATIVE_LOCATION'}}}});
   }
   write(join(f.base,'bin',harness),`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const dir=path.join(process.env[${JSON.stringify(variable)}],${JSON.stringify(suffix)});
fs.mkdirSync(dir,{recursive:true});const cwd=process.cwd(),timestamp='2026-09-13T10:00:00Z';
const header=${JSON.stringify(harness)}==='claude'?{cwd,type:'user',timestamp,message:{content:'source evidence'}}:${JSON.stringify(harness)}==='pi'?{cwd,type:'session',timestamp,id:'s1',text:'source evidence'}:{type:'session_meta',timestamp,payload:{cwd,id:'s1',text:'source evidence'}};
fs.writeFileSync(path.join(dir,'s1.jsonl'),JSON.stringify(header)+String.fromCharCode(10));
`);
   chmodSync(join(f.base,'bin',harness),0o755);
   symlinkSync('/bin/cat',join(f.base,'bin/cat'));
   const result=await f.spawn('root-history',kind==='fromEnv-retargeted'?{launchConfig:'custom',harness:undefined}:{});
   const meta=readJson(join(result.home,'instance.json'));
   installBackend(f, { execute: true });
   startInstanceSession(result.home);
   assert.ok(existsSync(join(actual,suffix,'s1.jsonl')));
   const control=sessionsForHome(result.home);assert.equal(control.length,1);assert.equal(control[0].source,source);
   assert.ok(control[0].path.startsWith(actual));
   // Defaults contain no evidence; a changed fromEnv reference points to a real
   // but empty directory, so neither missing-root nor unresolved-ref tests fire.
   delete process.env[variable];process.env.FIXTURE_NATIVE_LOCATION=observer;
   process.env.TURN_RECORD_ROOT=join(f.base,'record');process.env.TURN_RECORD_OWNER='fixture';
   const r=spawnSync(process.execPath,[CLI,'capture','--home',result.home,'--no-index'],{env:process.env,encoding:'utf8'});
   const out=JSON.parse(r.stdout);
   console.log(JSON.stringify({case:'root-history',harness,kind,exit:r.status,actualSourceExists:existsSync(join(actual,suffix,'s1.jsonl')),recipeEnv:meta.launch.env,complete:out.complete,appended:out.appended,sessions:out.sessions.length}));
   assert.equal(r.status, 0, r.stderr); assert.equal(out.complete, true); assert.equal(out.sessions.length, 1); assert.equal(out.sessions[0].source, source); assert.ok(out.sessions[0].path.startsWith(actual));
   assert.equal(historicalSessionRoots(result.home)[source].length, 1);
   const history = readdirSync(nativeHistoryPath(result.home)).map(n => readFileSync(join(nativeHistoryPath(result.home), n), 'utf8')).join('');
   assert.ok(!history.includes('FIXTURE_SECRET_VALUE')); assert.ok(!history.includes('FIXTURE_NATIVE_LOCATION')); 
  });
 }
}

for(const kind of ['preexisting-symlink','launch-hook-symlink']) {
 test(`directory session start: ${kind} cannot reach backend`,async t=>{
  const f=fixture(t,{hook:true});
  if(kind==='launch-hook-symlink') {
   f.launchHook(`import {renameSync,symlinkSync} from 'node:fs';
const home=process.env.OATS_INSTANCE_HOME;
renameSync(home+'/work',home+'/owned-work');symlinkSync(process.env.OATS_CONTEXT,home+'/work');
console.log(JSON.stringify({env:{}}));`);
  }
  const faked=join(f.base,'backend.jsonl');
  write(join(f.base,'bin/tmux'),`#!${process.execPath}
const fs=require('node:fs');const a=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(faked)},JSON.stringify(a)+String.fromCharCode(10));
if(a.includes('display-message')) console.log(${JSON.stringify(join(f.base,'fake.sock'))});
`);chmodSync(join(f.base,'bin/tmux'),0o755);
  const result=await f.spawn('session-substitution');
  if(kind==='preexisting-symlink') {rmSync(join(result.home,'work'),{recursive:true});symlinkSync(f.context,join(result.home,'work'));}
  let error,started;
  try {started=startInstanceSession(result.home);} catch(e) {error={code:e.code,message:e.message};}
  const calls=existsSync(faked)?readFileSync(faked,'utf8'):'';
  console.log(JSON.stringify({case:'session-root',kind,error,started:!!started,workReal:realpathSync(join(result.home,'work')),context:f.context,backendCalled:calls.includes('new-window')}));
  assert.equal(calls.includes('new-window'),false,'directory authority must be rechecked before the backend launch');
  assert.equal(error?.code,'E_WORK_INSPECTION_FAILED');
 });
}

// Both entry points, every backend route, and both places a root can change.
for (const restart of [false, true]) for (const backend of ['new-tmux', 'saved-tmux', 'herdr', 'pending']) {
  for (const attack of ['missing', 'file', 'directory', 'home-link', 'mode-edit', 'hook-work-link', 'hook-home-link']) {
    if (backend === 'pending' && attack.startsWith('hook-')) continue; // adoption observes the earlier launch, it does not prepare a new one
    test(`${restart ? 'restart' : 'start'} custody: ${backend} ${attack}`, async t => {
      const f = fixture(t, { hook: true });
      const logs = installBackend(f);
      const hook = attack.startsWith('hook-');
      if (hook) {
        const statements = attack === 'hook-home-link'
          ? "renameSync(home,home+'.owned');symlinkSync(process.env.OATS_CONTEXT,home);"
          : "renameSync(home+'/work',home+'/owned-work');symlinkSync(process.env.OATS_CONTEXT,home+'/work');";
        f.launchHook(`import {renameSync,symlinkSync} from 'node:fs';const home=process.env.OATS_INSTANCE_HOME;${statements}console.log(JSON.stringify({env:{}}));`);
      }
      const r = await f.spawn('guard');
      const metaPath = join(r.home, 'instance.json');
      const meta = readJson(metaPath);
      const baseDir = join(dirname(r.home), '.oats-retirement', 'baselines');
      const baselinePath = join(baseDir, readdirSync(baseDir)[0]);
      const baseline = readJson(baselinePath);
      const target = backend === 'herdr'
        ? { backend:'herdr', binary:'/inert/herdr', socket:join(f.base,'herdr.sock'), protocol:HERDR_PROTOCOL, workspaceId:'w', paneId:'p', terminalId:'t' }
        : { backend:'tmux', session:'fixture', window:meta.instance, socket:join(f.base,'tmux.sock') };
      if (backend !== 'new-tmux') {
        meta.launched = true;
        if (backend === 'herdr') { delete meta.tmux; meta.sessionTarget=target; baseline.runtime={launched:true,sessionTarget:target}; }
        else { const {backend:_,...tmux}=target;meta.tmux=tmux;baseline.runtime={launched:true,tmux}; }
        write(metaPath, JSON.stringify(meta)); write(baselinePath, JSON.stringify(baseline));
      }
      if (backend === 'pending') write(join(r.home,'.oats-start-pending.json'),JSON.stringify({id:'earlier-start',target,command:meta.command,model:null,startedAt:'2026-09-13T00:00:00Z'}));
      const before = readFileSync(metaPath, 'utf8'), authority = readFileSync(baselinePath, 'utf8');
      write(join(f.context, 'keep.txt'), 'do not follow or delete');
      write(join(f.context, '.oats-start.lock', 'keep.txt'), 'target lock');
      if (attack === 'home-link') { renameSync(r.home,r.home+'.owned');symlinkSync(f.context,r.home); }
      else if (!hook && attack !== 'mode-edit') {
        renameSync(join(r.home,'work'),join(r.home,'owned-work'));
        if (attack === 'file') write(join(r.home,'work'),'not a directory');
        if (attack === 'directory') mkdirSync(join(r.home,'work'));
      } else if (attack === 'mode-edit') write(metaPath,JSON.stringify({...meta,work:'checkout'}));
      // No backend call (including observation/stop) is permitted.
      const io = { exec: () => { throw new Error('UNEXPECTED BACKEND CALL'); }, kill: () => { throw new Error('UNEXPECTED KILL'); } };
      assert.throws(() => (restart ? restartInstanceSession : startInstanceSession)(r.home, {io}), e => e.code === 'E_WORK_INSPECTION_FAILED');
      assert.equal(existsSync(logs), false);
      assert.equal(readFileSync(baselinePath,'utf8'),authority);
      assert.equal(readFileSync(join(f.context,'keep.txt'),'utf8'),'do not follow or delete');
      assert.equal(readFileSync(join(f.context,'.oats-start.lock','keep.txt'),'utf8'),'target lock');
      const owned = ['home-link','hook-home-link'].includes(attack) ? r.home+'.owned' : r.home;
      if (attack !== 'mode-edit') assert.equal(readFileSync(join(owned,'instance.json'),'utf8'),before);
      if (backend === 'pending') assert.equal(readJson(join(owned,'.oats-start-pending.json')).id,'earlier-start');
    });
  }
}

function emitter(f, harness) {
  write(join(f.base,'bin',harness),`#!${process.execPath}
const fs=require('node:fs'),p=require('node:path');const rt=${JSON.stringify(harness)},home=process.cwd(),timestamp='2026-09-13T10:00:00Z';
const root=rt==='claude'?p.join(process.env.CLAUDE_CONFIG_DIR||p.join(process.env.HOME,'.claude'),'projects','p'):rt==='pi'?p.join(process.env.PI_CODING_AGENT_DIR||p.join(process.env.HOME,'.pi/agent'),'sessions','p'):p.join(process.env.CODEX_HOME||p.join(process.env.HOME,'.codex'),'sessions');
fs.mkdirSync(root,{recursive:true}); const row=rt==='claude'?{cwd:home,type:'user',timestamp,message:{content:'evidence'}}:rt==='pi'?{cwd:home,type:'session',timestamp}:{type:'session_meta',timestamp,payload:{cwd:home}};
fs.writeFileSync(p.join(root,rt+'.jsonl'),JSON.stringify(row)+'\\n');`);
  chmodSync(join(f.base,'bin',harness),0o755);
}

test('actual spawn, resumed start and harness switch retain every execution root, not recipes or current HOME', async t => {
  const f=fixture(t);installBackend(f,{execute:true});symlinkSync('/bin/cat',join(f.base,'bin/cat'));
  for(const rt of ['claude','pi','codex']) emitter(f,rt);
  process.env.CLAUDE_CONFIG_DIR=join(f.base,'first');
  const r=await f.spawn('history',{launch:true}); // actual spawn dispatch, not a scaffold template replay
  assert.equal(sessionsForHome(r.home).length,1);
  process.env.CLAUDE_CONFIG_DIR=join(f.base,'second');
  startInstanceSession(r.home);
  process.env.PI_CODING_AGENT_DIR=join(f.base,'third');
  restartInstanceSession(r.home,{harness:'pi'});
  process.env.CODEX_HOME=join(f.base,'fourth');
  restartInstanceSession(r.home,{harness:'codex'});
  const roots=historicalSessionRoots(r.home);
  assert.deepEqual(roots.cc.sort(),[join(f.base,'first/projects'),join(f.base,'second/projects')].sort());
  assert.deepEqual(roots.pi,[join(f.base,'third/sessions')]);assert.deepEqual(roots.codex,[join(f.base,'fourth/sessions')]);
  const meta=readJson(join(r.home,'instance.json')); assert.equal(meta.harness,'codex');
  for(const name of ['CLAUDE_CONFIG_DIR','PI_CODING_AGENT_DIR','CODEX_HOME']) delete process.env[name];
  process.env.HOME=join(f.base,'observer');mkdirSync(process.env.HOME);
  assert.equal(sessionsForHome(r.home).length,4,'all roots survive both harness and HOME drift');
  rmSync(join(f.base,'first'),{recursive:true});
  assert.throws(()=>sessionsForHome(r.home),/ENOENT/,'a removed historical root is not an empty successful scan');
});

test('unexecuted dispatch stays pending; legacy recipes cannot certify historical roots', async t => {
  const f=fixture(t);installBackend(f);
  const r=await f.spawn('pending-history');
  startInstanceSession(r.home);
  assert.throws(()=>sessionsForHome(r.home),/pending/);
  rmSync(nativeHistoryPath(r.home),{recursive:true});
  assert.throws(()=>sessionsForHome(r.home),/ENOENT/);
  // Legacy restart may record a new location, but must never erase the gap.
  startInstanceSession(r.home);
  assert.throws(()=>sessionsForHome(r.home),/earlier launches are unknown/);
});

test('Herdr execution records roots in its actual launch environment and keeps metadata recovery separate', async t => {
  const f=fixture(t);emitter(f,'claude');symlinkSync('/bin/cat',join(f.base,'bin/cat'));
  const r=await f.spawn('herdr-history');
  const target={backend:'herdr',binary:'/inert/herdr',socket:join(f.base,'herdr.sock'),protocol:HERDR_PROTOCOL,workspaceId:'w0',paneId:'p0',terminalId:'t0'};
  const metaPath=join(r.home,'instance.json'),meta=readJson(metaPath);delete meta.tmux;
  write(metaPath,JSON.stringify({...meta,launched:true,backend:'herdr',sessionTarget:target}));
  const baselines=join(dirname(r.home),'.oats-retirement/baselines'),baselinePath=join(baselines,readdirSync(baselines)[0]);
  write(baselinePath,JSON.stringify({...readJson(baselinePath),runtime:{launched:true,sessionTarget:target}}));
  const nativeRoot=join(f.base,'backend-native');
  process.env.CLAUDE_CONFIG_DIR=join(f.base,'observer-empty');mkdirSync(join(process.env.CLAUDE_CONFIG_DIR,'projects'),{recursive:true});
  let panes=[];
  const io={exec:(bin,args,options)=>{
    assert.equal(bin,target.binary);
    let result;
    if(args.join(' ')==='api snapshot') result={snapshot:{protocol:HERDR_PROTOCOL,panes,agents:[]}};
    else if(args[0]==='workspace') {panes=[{pane_id:'p1',terminal_id:'t1',workspace_id:'w1'}];result={root_pane:panes[0]};}
    else if(args[1]==='run') {
      // Backend startup changed the inherited location. The observer and even
      // the planner never saw it; the execution-side recorder must do so.
      const run=spawnSync('/bin/sh',['-c',args[3]],{cwd:r.home,env:{...options.env,CLAUDE_CONFIG_DIR:nativeRoot},encoding:'utf8'});
      assert.equal(run.status,0,run.stderr); result={};
    } else assert.fail(args.join(' '));
    return JSON.stringify({result});
  }};
  assert.throws(()=>startInstanceSession(r.home,{io:{...io,failBeforeMetadataWrite:true}}),e=>e.code==='E_SESSION_START_INCOMPLETE');
  const sources=sessionsForHome(r.home);assert.equal(sources.length,1);assert.ok(sources[0].path.startsWith(nativeRoot));
  assert.equal(readJson(metaPath).sessionTarget.paneId,'p0','metadata failure does not erase independent native custody');
});
