import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeTrusts, codexTrustsRoot } from '../lib/harness-trust.mjs';
import { harnessTrust } from '../lib/harness-trust-write.mjs';
import { launchEnvironment } from '../lib/core.mjs';
// The operator has run both harnesses: their ambient configuration directories exist (OATS never creates one).
const fixture = t => { const base=fs.mkdtempSync(join(tmpdir(),'oats-trust-write-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));const root=join(base,'deployment');fs.mkdirSync(root);fs.mkdirSync(join(base,'native','.codex'),{recursive:true});return {base,root,env:{HOME:join(base,'native')}}; };
test('plan creates nothing; apply writes exact leaves and durable audit; repeat is config no-op', t => {
 const {base,root,env}=fixture(t);
 const planned=harnessTrust(root,{plan:true,env});assert.equal(planned.entries.length,2);assert.deepEqual(fs.readdirSync(env.HOME),['.codex']);assert.deepEqual(fs.readdirSync(join(env.HOME,'.codex')),[]);assert.equal(fs.existsSync(join(root,'.agents')),false);
 const applied=harnessTrust(root,{env});assert.deepEqual(applied.entries.map(e=>e.status),['applied','applied']);assert.equal(applied.audit.status,'recorded');
 const before=applied.entries.map(e=>({bytes:fs.readFileSync(e.file),mtime:fs.statSync(e.file).mtimeMs}));
 const again=harnessTrust(root,{env});assert.deepEqual(again.entries.map(e=>e.status),['unchanged','unchanged']);
 again.entries.forEach((e,i)=>{assert.deepEqual(fs.readFileSync(e.file),before[i].bytes);assert.equal(fs.statSync(e.file).mtimeMs,before[i].mtime);});
 assert.equal(fs.readFileSync(applied.audit.path,'utf8').trim().split('\n').length,6);
});
test('all preflights before writes and refuses unsupported second file',t=>{
 const {root,env}=fixture(t);fs.mkdirSync(join(env.HOME,'.codex'),{recursive:true});fs.writeFileSync(join(env.HOME,'.codex/config.toml'),'[[unsupported]]\nx=1\n');
 assert.throws(()=>harnessTrust(root,{env}),e=>e.code==='E_CONFIG_BROKEN'&&e.details.mode==='apply');assert.equal(fs.existsSync(join(env.HOME,'.claude.json')),false);
});
test('audit failure before replacement sends no write; after replacement retains actual change',t=>{
 const {root,env}=fixture(t);
 assert.throws(()=>harnessTrust(root,{env,harness:'claude',checkpoint(name){if(name==='before-audit')throw Error('fail');}}),e=>e.code==='E_HARNESS_TRUST_INCOMPLETE'&&e.details.reason==='audit'&&!e.details.mayHaveChanged);
 assert.equal(fs.existsSync(join(env.HOME,'.claude.json')),false);
 assert.throws(()=>harnessTrust(root,{env,harness:'claude',checkpoint(name,info){if(name==='before-audit'&&info.phase==='outcome')throw Error('fail');}}),e=>e.details.mayHaveChanged&&e.details.entries[0].status==='incomplete');
 assert.equal(JSON.parse(fs.readFileSync(join(env.HOME,'.claude.json'),'utf8')).projects[fs.realpathSync(root)].hasTrustDialogAccepted,true);
});
test('cooperating lock and concurrent bytes refuse without overwriting',t=>{
 const {root,env}=fixture(t);const file=join(env.HOME,'.claude.json');fs.writeFileSync(file,'{}');fs.writeFileSync(file+'.oats-trust.lock','owned elsewhere');
 assert.throws(()=>harnessTrust(root,{env,harness:'claude'}),e=>e.details.reason==='locked');assert.equal(fs.readFileSync(file,'utf8'),'{}');fs.unlinkSync(file+'.oats-trust.lock');
 assert.throws(()=>harnessTrust(root,{env,harness:'claude',checkpoint(name){if(name==='before-replace')fs.writeFileSync(file,'{"operator":true}');}}),e=>e.details.reason==='changed'&&!e.details.mayHaveChanged);
 assert.equal(fs.readFileSync(file,'utf8'),'{"operator":true}');
});
test('partial all apply retains first write and audits second failure without rollback',t=>{
 const {root,env}=fixture(t);
 assert.throws(()=>harnessTrust(root,{env,checkpoint(name,{entry}={}){if(name==='before-replace'&&entry.harness==='codex')throw Error('blocked');}}),e=>{
   assert.equal(e.details.mayHaveChanged,true);assert.equal(e.details.entries[0].status,'applied');assert.equal(e.details.entries[1].status,'failed');assert.equal(e.details.reason,'changed');
   assert.ok(e.message.includes(`failed: ${e.details.entries[1].file}`),e.message);return true;
 });
 assert.equal(fs.existsSync(join(env.HOME,'.claude.json')),true);assert.equal(fs.existsSync(join(env.HOME,'.codex/config.toml')),false);
 const rows=fs.readFileSync(join(root,'.agents/harness-trust.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.deepEqual(rows.map(r=>r.status),['planned','applied','planned','failed']);
 assert.deepEqual(harnessTrust(root,{env}).entries.map(e=>e.status),['unchanged','applied']);
});
test('verification drift reports actual observed digest without rolling back an external edit',t=>{
 const {root,env}=fixture(t);
 assert.throws(()=>harnessTrust(root,{env,harness:'claude',checkpoint(name,{entry}={}){if(name==='after-replace')fs.writeFileSync(entry.file,'{"operator":true}');}}),e=>e.details.reason==='verify'&&e.details.mayHaveChanged&&e.details.entries[0].status==='incomplete');
 assert.equal(fs.readFileSync(join(env.HOME,'.claude.json'),'utf8'),'{"operator":true}');
});
test('refuses symlink/hardlink leaves and malformed audit before native writes',t=>{
 const {root,env,base}=fixture(t);const target=join(base,'target');fs.writeFileSync(target,'{}');const file=join(env.HOME,'.claude.json');fs.symlinkSync(target,file);
 assert.throws(()=>harnessTrust(root,{env,harness:'claude',plan:true}),e=>e.code==='E_CONFIG_BROKEN');fs.unlinkSync(file);fs.linkSync(target,file);
 assert.throws(()=>harnessTrust(root,{env,harness:'claude'}),e=>e.code==='E_CONFIG_BROKEN');fs.unlinkSync(file);
 fs.mkdirSync(join(root,'.agents'));fs.writeFileSync(join(root,'.agents/harness-trust.jsonl'),'{"truncated":');
 assert.throws(()=>harnessTrust(root,{env,harness:'claude'}),e=>e.details.reason==='audit'&&!e.details.mayHaveChanged);assert.equal(fs.existsSync(file),false);
});
test('relative overrides refuse; directory aliases canonicalize without touching the target in plan',t=>{
 const {root,env,base}=fixture(t);assert.throws(()=>harnessTrust(root,{env:{...env,CODEX_HOME:'relative'},plan:true}),e=>e.code==='E_CONFIG_BROKEN');
 const real=join(base,'actual');fs.mkdirSync(real);const alias=join(base,'alias');fs.symlinkSync(real,alias);
 const result=harnessTrust(root,{env:{...env,CLAUDE_CONFIG_DIR:alias},harness:'claude',plan:true});assert.equal(result.entries[0].file,join(fs.realpathSync(real),'.claude.json'));assert.deepEqual(fs.readdirSync(real),[]);
});

test('cleanup refuses replacement locks and reports the retained audit/native result', t => {
 const {root,env}=fixture(t); let replacement;
 assert.throws(()=>harnessTrust(root,{env,harness:'claude',checkpoint(name,{entry}={}){
  if(name==='after-replace'){replacement=entry.file+'.oats-trust.lock';fs.unlinkSync(replacement);fs.mkdirSync(replacement);}
 }}),e=>e.code==='E_HARNESS_TRUST_INCOMPLETE'&&e.details.reason==='write'&&e.details.mayHaveChanged&&e.details.audit.status==='recorded'&&e.details.warnings.some(w=>w.includes(replacement)));
 assert.equal(fs.statSync(replacement).isDirectory(),true);
});

test('native temp write, fsync and rename failures retain checked evidence and clean owned files', async t => {
 const mutableFs = (await import('node:fs')).default;
 const { syncBuiltinESMExports } = await import('node:module');
 for (const stage of ['write', 'fsync', 'rename']) {
  const {root,env}=fixture(t);
  const originalOpen=mutableFs.openSync, originalWrite=mutableFs.writeFileSync, originalSync=mutableFs.fsyncSync, originalRename=mutableFs.renameSync;
  let tempFd, injected=false;
  t.mock.method(mutableFs,'openSync',(...args)=>{const fd=originalOpen(...args);if(String(args[0]).endsWith('.tmp'))tempFd=fd;return fd;});
  const fail=()=>{injected=true;throw Object.assign(new Error('injected I/O failure'),{code:'EIO'});};
  t.mock.method(mutableFs,'writeFileSync',(...args)=>{if(stage==='write'&&args[0]===tempFd&&!injected)fail();return originalWrite(...args);});
  t.mock.method(mutableFs,'fsyncSync',(...args)=>{if(stage==='fsync'&&args[0]===tempFd&&!injected)fail();return originalSync(...args);});
  t.mock.method(mutableFs,'renameSync',(...args)=>{if(stage==='rename'&&String(args[0]).endsWith('.tmp')&&!injected)fail();return originalRename(...args);});
  syncBuiltinESMExports();
  try {
   assert.throws(()=>harnessTrust(root,{env,harness:'claude'}),e=>{
    assert.equal(e.code,'E_HARNESS_TRUST_INCOMPLETE');assert.equal(e.details.reason,'write');assert.equal(e.details.mayHaveChanged,stage==='rename');assert.equal(e.details.audit.status,'recorded');return true;
   });
  } finally {t.mock.restoreAll();syncBuiltinESMExports();}
  assert.equal(injected,true,stage);
  assert.deepEqual(fs.readdirSync(env.HOME),['.codex'],stage);
  const rows=fs.readFileSync(join(root,'.agents/harness-trust.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(r=>r.status),['planned',stage==='rename'?'incomplete':'failed']);
  assert.equal(rows[1].afterDigest,null,'failed replacement did not create the proposed bytes');
  assert.match(rows[0].afterDigest,/^[a-f0-9]{64}$/,'intent retains candidate digest');
  assert.deepEqual(fs.readdirSync(join(root,'.agents')),['harness-trust.jsonl']);
 }
});

test('file modes survive replacement; new directories/audit are private; special modes refuse', t => {
 const {root,env}=fixture(t);fs.chmodSync(env.HOME,0o700);const file=join(env.HOME,'.claude.json');fs.writeFileSync(file,'{}',{mode:0o640});
 const result=harnessTrust(root,{env,harness:'claude'});
 assert.equal(fs.statSync(file).mode&0o777,0o640);assert.equal(fs.statSync(result.audit.path).mode&0o777,0o600);assert.equal(fs.statSync(join(root,'.agents')).mode&0o777,0o700);
 fs.chmodSync(file,0o1640);assert.throws(()=>harnessTrust(root,{env,harness:'claude',plan:true}),e=>e.code==='E_CONFIG_BROKEN');
});

test('quoted Unicode deployment roots round-trip through both native editors and existing readers', t => {
 const {base,env}=fixture(t);const root=join(base,'deployment "quote" \' apostrophe 雪');fs.mkdirSync(root);
 const result=harnessTrust(root,{env});assert.deepEqual(result.entries.map(e=>e.status),['applied','applied']);
 assert.deepEqual(harnessTrust(root,{env}).entries.map(e=>e.status),['unchanged','unchanged']);
});

test('native-valid shapes outside the existing readiness reader refuse during all-file preflight', t => {
 const {root,env}=fixture(t);fs.mkdirSync(join(env.HOME,'.codex'),{recursive:true});
 fs.writeFileSync(join(env.HOME,'.codex/config.toml'),`[projects]\n${JSON.stringify(fs.realpathSync(root))} = { "trust_level" = "untrusted" }\n`);
 assert.throws(()=>harnessTrust(root,{env}),e=>e.code==='E_CONFIG_BROKEN'&&e.details.entries[1].status==='refused');
 assert.equal(fs.existsSync(join(env.HOME,'.claude.json')),false);assert.equal(fs.existsSync(join(root,'.agents')),false);
});

test('same-byte inode replacement is a conflict, never silently rebased', t => {
 const {root,env}=fixture(t);const file=join(env.HOME,'.claude.json');fs.writeFileSync(file,'{}');
 assert.throws(()=>harnessTrust(root,{env,harness:'claude',checkpoint(name){if(name==='before-replace'){fs.writeFileSync(file+'.external','{}');fs.renameSync(file+'.external',file);}}}),e=>e.details.reason==='changed'&&!e.details.mayHaveChanged);
 assert.equal(fs.readFileSync(file,'utf8'),'{}');assert.deepEqual(fs.readdirSync(env.HOME),['.claude.json','.codex']);
});

test('audit replacement after fsync cannot be reported as a checked durable row', async t => {
 const mutableFs=(await import('node:fs')).default;
 const {syncBuiltinESMExports}=await import('node:module');
 for(const targetAppend of [1,2]) {
  const {root,env}=fixture(t);const audit=join(root,'.agents/harness-trust.jsonl');let appends=0;
  const originalSync=mutableFs.fsyncSync;
  t.mock.method(mutableFs,'fsyncSync',fd=>{
   originalSync(fd);
   if(fs.existsSync(audit)&&fs.fstatSync(fd).ino===fs.statSync(audit).ino&&++appends===targetAppend){fs.writeFileSync(audit+'.external','{}\n');fs.renameSync(audit+'.external',audit);}
  });syncBuiltinESMExports();
  try {assert.throws(()=>harnessTrust(root,{env,harness:'claude'}),e=>e.details.reason==='audit'&&e.details.audit.status==='incomplete'&&e.details.mayHaveChanged===(targetAppend===2));}
  finally {t.mock.restoreAll();syncBuiltinESMExports();}
  assert.equal(fs.existsSync(join(env.HOME,'.claude.json')),targetAppend===2);
  assert.equal(fs.readFileSync(audit,'utf8'),'{}\n');
 }
});

// On case-insensitive APFS the spelling resolves without a symlink, whereas
// realpathSync's JS implementation can retain that spelling. Case-sensitive
// systems use a directory alias to exercise the same native-key contract.
test('native canonical spelling is used for root, keys, audit and reader verification', t => {
 const {base,env}=fixture(t);
 const root=join(base,'DeploymentCase'), typed=join(base,'deploymentcase');
 fs.mkdirSync(root);
 if(!fs.existsSync(typed))fs.symlinkSync(root,typed);
 const canonical=fs.realpathSync.native(root);
 assert.equal(fs.realpathSync.native(typed),canonical);
 const planned=harnessTrust(typed,{env,plan:true});
 assert.equal(planned.root,canonical);
 for(const entry of planned.entries)assert.equal(entry.key[1],canonical);
 const applied=harnessTrust(typed,{env});
 assert.equal(applied.root,canonical);
 assert.equal(applied.audit.path,join(canonical,'.agents/harness-trust.jsonl'));
 assert.deepEqual(applied.entries.map(e=>e.status),['applied','applied']);
 for(const entry of applied.entries)assert.equal(entry.key[1],canonical);
 const projects=JSON.parse(fs.readFileSync(applied.entries[0].file,'utf8')).projects;
 assert.deepEqual(Object.keys(projects),[canonical]);
 assert.equal(claudeTrusts(typed,{env}),true);
 assert.equal(codexTrustsRoot(typed,{env}),true);
 // A differently cased key must not make the reader claim native trust.
 fs.writeFileSync(applied.entries[0].file,JSON.stringify({projects:{[typed]:{hasTrustDialogAccepted:true}}}));
 fs.writeFileSync(applied.entries[1].file,`[projects.${JSON.stringify(typed)}]\ntrust_level = "trusted"\n`);
 assert.equal(claudeTrusts(typed,{env}),false);
 assert.equal(codexTrustsRoot(typed,{env}),false);
 const rows=fs.readFileSync(applied.audit.path,'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(rows.length,4);
 for(const row of rows)assert.equal(row.root,canonical);
});

test('each existing destination or audit lock is named and never stolen', t => {
 for(const target of ['claude','codex','audit']) {
  const {root,env}=fixture(t);
  const canonical=fs.realpathSync.native(root);
  const lock=(target==='audit'?join(canonical,'.agents/harness-trust.jsonl'):target==='claude'?join(env.HOME,'.claude.json'):join(env.HOME,'.codex/config.toml'))+'.oats-trust.lock';
  fs.mkdirSync(join(lock,'..'),{recursive:true});
  fs.writeFileSync(lock,'prior owner');
  assert.throws(()=>harnessTrust(root,{env}),e=>{
   assert.equal(e.code,'E_HARNESS_TRUST_INCOMPLETE');assert.equal(e.details.reason,'locked');
   assert.equal(e.details.mayHaveChanged,false);assert.ok(e.message.includes(fs.realpathSync.native(lock)),e.message);return true;
  });
  assert.equal(fs.readFileSync(lock,'utf8'),'prior owner');
  assert.equal(fs.existsSync(join(env.HOME,'.claude.json')),false);
  assert.equal(fs.existsSync(join(env.HOME,'.codex/config.toml')),false);
 }
});

test('native config directory aliases use on-disk spelling even with missing descendants', t => {
 const {root,base}=fixture(t);
 const actual=join(base,'NativeCase'), typed=join(base,'nativecase');fs.mkdirSync(actual);
 if(!fs.existsSync(typed))fs.symlinkSync(actual,typed);
 const native=fs.realpathSync.native(actual);
 const env={HOME:typed,CLAUDE_CONFIG_DIR:join(typed,'claude-new'),CODEX_HOME:join(typed,'codex-new')};
 const expected=[join(native,'claude-new/.claude.json'),join(native,'codex-new/config.toml')];
 const planned=harnessTrust(root,{env,plan:true}).entries;
 assert.deepEqual(planned.map(e=>e.file),expected);
 assert.deepEqual(planned.map(e=>e.status),['skipped','skipped'],'missing configuration directories are skipped, never created');
 assert.deepEqual(fs.readdirSync(actual),[]);
 fs.mkdirSync(join(actual,'claude-new'));fs.mkdirSync(join(actual,'codex-new'));
 const result=harnessTrust(root,{env});
 assert.deepEqual(result.entries.map(e=>e.file),expected);
 assert.deepEqual(result.entries.map(e=>e.status),['applied','applied']);
 assert.equal(claudeTrusts(root,{env}),true);assert.equal(codexTrustsRoot(root,{env}),true);
 assert.deepEqual(harnessTrust(root,{env}).entries.map(e=>e.status),['unchanged','unchanged']);
});

// #886: one target per configuration file a launch reads. The ambient file, plus one for each
// launch configuration whose env moves the harness's configuration directory.
const configs = entries => Object.fromEntries(Object.entries(entries).map(([name, c]) => [name, { name, args: [], ...c }]));
test('launch configurations with their own config directories are targets beside the ambient file; plan lists, apply writes and verifies each', t => {
 const {base,root,env}=fixture(t);
 const a=join(base,'claude-a'), b=join(base,'claude-b'), cx=join(base,'codex-w');for(const d of [a,b,cx])fs.mkdirSync(d);
 const launchConfigs=configs({ work:{harness:'claude',env:{CLAUDE_CONFIG_DIR:a}}, play:{harness:'claude',env:{CLAUDE_CONFIG_DIR:{fromEnv:'PLAY_DIR'}}},
  same:{harness:'claude',env:{CLAUDE_CONFIG_DIR:{fromEnv:'ALIAS_A'}}}, cx:{harness:'codex',env:{CODEX_HOME:cx}}, plain:{harness:'claude',env:{}}, pi:{harness:'pi',env:{CLAUDE_CONFIG_DIR:'relative'}} });
 const host={...env,PLAY_DIR:b,ALIAS_A:a+'/'};
 const planned=harnessTrust(root,{plan:true,env:host,launchConfigs});
 const real=d=>fs.realpathSync.native(d);
 assert.deepEqual(planned.entries.map(e=>[e.harness,e.file,e.ambient,e.launchConfigs,e.status]),[
  ['claude',join(real(env.HOME),'.claude.json'),true,[],'change'],
  ['claude',join(real(b),'.claude.json'),false,['play'],'change'],
  ['claude',join(real(a),'.claude.json'),false,['same','work'],'change'],
  ['codex',join(real(env.HOME),'.codex/config.toml'),true,[],'change'],
  ['codex',join(real(cx),'config.toml'),false,['cx'],'change'],
 ]);
 assert.deepEqual([fs.readdirSync(a),fs.readdirSync(b),fs.readdirSync(cx)],[[],[],[]],'plan writes nothing');
 const applied=harnessTrust(root,{env:host,launchConfigs});
 assert.deepEqual(applied.entries.map(e=>e.status),['applied','applied','applied','applied','applied']);
 for(const dir of [a,b])assert.equal(claudeTrusts(root,{env:{...env,CLAUDE_CONFIG_DIR:dir}}),true,dir);
 assert.equal(codexTrustsRoot(root,{env:{...env,CODEX_HOME:cx}}),true);
 assert.equal(claudeTrusts(root,{env}),true);
 const rows=fs.readFileSync(applied.audit.path,'utf8').trim().split('\n').map(JSON.parse);
 assert.deepEqual(rows.filter(r=>r.phase==='outcome').map(r=>r.file),applied.entries.map(e=>e.file));
 assert.deepEqual(harnessTrust(root,{env:host,launchConfigs}).entries.map(e=>e.status),['unchanged','unchanged','unchanged','unchanged','unchanged']);
 // --harness selects that harness's targets only.
 assert.deepEqual(harnessTrust(root,{plan:true,env:host,launchConfigs,harness:'codex'}).entries.map(e=>e.file),[join(real(env.HOME),'.codex/config.toml'),join(real(cx),'config.toml')]);
});
test('a launch configuration whose config directory is missing, unset or relative is a named problem; nothing is written or created', t => {
 for (const [name,c,host,problem] of [
  ['gone',{harness:'claude',env:{CLAUDE_CONFIG_DIR:'<base>/missing'}},{},'launch configuration gone: CLAUDE_CONFIG_DIR <base>/missing does not exist; OATS never creates a harness configuration directory: create it, or start claude with it once, then rerun'],
  ['unset',{harness:'codex',env:{CODEX_HOME:{fromEnv:'NOT_SET'}}},{},'launch configuration unset: CODEX_HOME references NOT_SET, not set on this host'],
  ['rel',{harness:'claude',env:{CLAUDE_CONFIG_DIR:{fromEnv:'REL'}}},{REL:'some/dir'},'launch configuration rel: CLAUDE_CONFIG_DIR "some/dir" is not an absolute path'],
 ]) {
  const {base,root,env}=fixture(t);
  const fix=v=>typeof v==='string'?v.replaceAll('<base>',base):v;
  const launchConfigs=configs({[name]:{...c,env:Object.fromEntries(Object.entries(c.env).map(([k,v])=>[k,fix(v)]))}});
  for(const plan of [true,false]) assert.throws(()=>harnessTrust(root,{plan,env:{...env,...host},launchConfigs}),e=>{
   assert.equal(e.code,'E_CONFIG_BROKEN');assert.equal(e.details.mode,plan?'plan':'apply');
   const refused=e.details.entries.find(x=>x.problem);assert.equal(refused.problem,fix(problem));assert.equal(refused.status,'refused');assert.deepEqual(refused.launchConfigs,[name]);
   assert.ok(e.message.includes(fix(problem)),e.message);return true;
  });
  assert.deepEqual(fs.readdirSync(env.HOME),['.codex'],name);assert.deepEqual(fs.readdirSync(join(env.HOME,'.codex')),[],name);assert.equal(fs.existsSync(join(base,'missing')),false);assert.equal(fs.existsSync(join(root,'.agents')),false);
 }
});
test('a missing ambient config directory is never created: skipped for that harness under all, a problem when that harness is named', t => {
 const {base,root}=fixture(t);const env={HOME:join(base,'native-bare')};fs.mkdirSync(env.HOME);
 for (const plan of [true,false]) {
   const result=harnessTrust(root,{env,plan});
   const codex=result.entries.find(e=>e.harness==='codex');
   assert.equal(codex.status,'skipped');assert.match(codex.reason,/\.codex does not exist: codex has not run as this user/);assert.equal(codex.problem,undefined);
   assert.equal(result.entries.find(e=>e.harness==='claude').status,plan?'change':'applied');
 }
 assert.equal(fs.existsSync(join(env.HOME,'.codex')),false,'never created');
 assert.throws(()=>harnessTrust(root,{env,harness:'codex'}),e=>e.code==='E_CONFIG_BROKEN'&&/\.codex does not exist/.test(e.message)&&!!e.details.entries[0].problem);
 assert.equal(fs.existsSync(join(env.HOME,'.codex')),false);
 const gone={HOME:join(base,'no-home')};
 assert.throws(()=>harnessTrust(root,{env:gone,harness:'claude'}),e=>e.code==='E_CONFIG_BROKEN'&&/does not exist/.test(e.message));
 assert.equal(fs.existsSync(gone.HOME),false);
});
// A launch whose configuration sets HOME and no selector reads its harness's default file under THAT
// home (core.mjs launchFolderTrust): the writer writes for it, by the same answer.
test('a launch configuration that sets HOME and no selector is a target: the default file under its HOME, literal or referenced, deduplicated with the ambient one', t => {
 const {base,root,env}=fixture(t);
 const own=join(base,'own-home'), ref=join(base,'ref-home');for(const d of [own,ref])fs.mkdirSync(join(d,'.codex'),{recursive:true});
 const launchConfigs=configs({ lit:{harness:'claude',env:{HOME:own}}, refd:{harness:'claude',env:{HOME:{fromEnv:'REF_HOME'}}}, cxlit:{harness:'codex',env:{HOME:own}},
  same:{harness:'claude',env:{HOME:env.HOME+'/'}}, plain:{harness:'claude',env:{PATH:'/usr/bin'}}, pi:{harness:'pi',env:{HOME:ref}} });
 const host={...env,REF_HOME:ref}, real=d=>fs.realpathSync.native(d);
 const planned=harnessTrust(root,{plan:true,env:host,launchConfigs});
 assert.deepEqual(planned.entries.map(e=>[e.harness,e.file,e.ambient,e.launchConfigs,e.status]),[
  ['claude',join(real(env.HOME),'.claude.json'),true,['same'],'change'],
  ['claude',join(real(own),'.claude.json'),false,['lit'],'change'],
  ['claude',join(real(ref),'.claude.json'),false,['refd'],'change'],
  ['codex',join(real(env.HOME),'.codex/config.toml'),true,[],'change'],
  ['codex',join(real(own),'.codex/config.toml'),false,['cxlit'],'change'],
 ]);
 assert.deepEqual(Object.keys(planned.entries[1]).sort(),Object.keys(planned.entries[0]).sort(),'an entry of the same shape as every other');
 assert.deepEqual([fs.readdirSync(own),fs.readdirSync(ref)],[['.codex'],['.codex']],'plan writes nothing');
 const applied=harnessTrust(root,{env:host,launchConfigs});
 assert.deepEqual(applied.entries.map(e=>e.status),['applied','applied','applied','applied','applied']);
 // Each file is the one the reader reads with that HOME and no selector.
 for(const home of [own,ref])assert.equal(claudeTrusts(root,{env:{HOME:home}}),true,home);
 assert.equal(codexTrustsRoot(root,{env:{HOME:own}}),true);
 assert.equal(codexTrustsRoot(root,{env:{HOME:ref}}),false,'no codex configuration sets that HOME');
});
test('a HOME-only launch configuration is no target when its launch has a selector: it reads that one, as a launch with no configuration does', t => {
 const {base,root,env}=fixture(t);
 const own=join(base,'own-home'), selected=join(base,'selected');for(const d of [own,selected])fs.mkdirSync(d);
 // NOT_SET is not resolved: the configuration's HOME names no file here.
 const launchConfigs=configs({ lit:{harness:'claude',env:{HOME:own}}, refd:{harness:'claude',env:{HOME:{fromEnv:'NOT_SET'}}} });
 const planned=harnessTrust(root,{plan:true,harness:'claude',env:{...env,CLAUDE_CONFIG_DIR:selected},launchConfigs});
 assert.deepEqual(planned.entries.map(e=>[e.file,e.ambient,e.launchConfigs]),[[join(fs.realpathSync.native(selected),'.claude.json'),true,[]]]);
 // The same from a pane's selector, whatever this process holds.
 const pane={of:name=>name==='CLAUDE_CONFIG_DIR'?{value:selected,source:'the pane CLAUDE_CONFIG_DIR'}:{value:env.HOME,source:'the pane HOME'}};
 assert.deepEqual(harnessTrust(root,{plan:true,harness:'claude',env,launchConfigs,launch:launchEnvironment({env,pane})}).entries.map(e=>e.file),[join(fs.realpathSync.native(selected),'.claude.json')]);
 assert.deepEqual(fs.readdirSync(own),[]);
});
test('a HOME-only launch configuration whose HOME is unset, relative or without the harness directory is a named problem; nothing is written or created', t => {
 for (const [name,c,host,problem] of [
  ['unset',{harness:'claude',env:{HOME:{fromEnv:'NOT_SET'}}},{},'launch configuration unset: HOME references NOT_SET, not set on this host'],
  ['rel',{harness:'codex',env:{HOME:{fromEnv:'REL'}}},{REL:'some/dir'},'launch configuration rel: HOME "some/dir" is not an absolute path'],
  ['empty',{harness:'claude',env:{HOME:''}},{},'launch configuration empty: the HOME of launch configuration empty is empty'],
  ['gone',{harness:'claude',env:{HOME:'<base>/missing'}},{},"launch configuration gone: <base>/missing (claude's directory under its HOME) does not exist; OATS never creates a harness configuration directory: create it, or start claude with it once, then rerun"],
  ['bare',{harness:'codex',env:{HOME:'<base>/bare'}},{},"launch configuration bare: <base>/bare/.codex (codex's directory under its HOME) does not exist; OATS never creates a harness configuration directory: create it, or start codex with it once, then rerun"],
 ]) {
  const {base,root,env}=fixture(t);fs.mkdirSync(join(base,'bare'));
  const fix=v=>typeof v==='string'?v.replaceAll('<base>',fs.realpathSync.native(base)):v;
  const launchConfigs=configs({[name]:{...c,env:Object.fromEntries(Object.entries(c.env).map(([k,v])=>[k,fix(v)]))}});
  for(const plan of [true,false]) assert.throws(()=>harnessTrust(root,{plan,env:{...env,...host},launchConfigs}),e=>{
   assert.equal(e.code,'E_CONFIG_BROKEN',e.message);assert.equal(e.details.mode,plan?'plan':'apply');
   const refused=e.details.entries.find(x=>x.problem);assert.equal(refused.problem,fix(problem));assert.equal(refused.status,'refused');assert.deepEqual(refused.launchConfigs,[name]);
   return true;
  });
  assert.deepEqual(fs.readdirSync(env.HOME),['.codex'],name);assert.deepEqual(fs.readdirSync(join(env.HOME,'.codex')),[],name);assert.deepEqual(fs.readdirSync(join(base,'bare')),[],name);
  assert.equal(fs.existsSync(join(base,'missing')),false);assert.equal(fs.existsSync(join(root,'.agents')),false);
 }
});
// "No server runs" leaves this process's file as the one to write, and says so. "The server could
// not be asked" does not: it may run under another account.
test('a server that could not be asked whether it runs refuses the ambient target (E_RUNTIME_ENDPOINT_UNKNOWN), plan and apply; a server known not to run does not', t => {
 const {root,env}=fixture(t);
 const unread='could not read the OATS tmux server for session s: permission denied';
 const asked=pane=>launchEnvironment({env,pane});
 for (const plan of [true,false]) assert.throws(()=>harnessTrust(root,{plan,env,launch:asked({unestablished:': this process could not read the OATS tmux server',unread})}),e=>{
  assert.equal(e.code,'E_RUNTIME_ENDPOINT_UNKNOWN',e.message);assert.equal(e.details.operation,'harness-trust');assert.equal(e.details.mode,plan?'plan':'apply');
  assert.deepEqual(e.details.entries.map(x=>[x.harness,x.ambient,x.status,x.file]),[['claude',true,'refused',null],['codex',true,'refused',null]]);
  assert.equal(e.details.entries[0].problem,`the file a claude launch with no launch configuration reads could not be established: ${unread}. A server that could not be asked may run under another account than this process's, so this process's file is not written in its place`);
  return true;
 });
 assert.deepEqual(fs.readdirSync(env.HOME),['.codex']);assert.deepEqual(fs.readdirSync(join(env.HOME,'.codex')),[]);assert.equal(fs.existsSync(join(root,'.agents')),false);
 // Beside a target refused for its configuration, that one's code.
 const launchConfigs=configs({rel:{harness:'claude',env:{CLAUDE_CONFIG_DIR:'some/dir'}}});
 assert.throws(()=>harnessTrust(root,{env,harness:'claude',launchConfigs,launch:asked({unestablished:': x',unread})}),e=>e.code==='E_CONFIG_BROKEN'&&e.message.includes(unread)&&e.message.includes('launch configuration rel:'));
 assert.deepEqual(fs.readdirSync(env.HOME),['.codex']);
 // Known not to run: this process's file, and the plan says whose it is.
 const none=harnessTrust(root,{plan:true,env,harness:'claude',launch:asked({unestablished:' until a spawn starts the OATS tmux server (none runs)'})});
 assert.deepEqual(none.entries.map(e=>[e.file,e.status]),[[join(fs.realpathSync.native(env.HOME),'.claude.json'),'change']]);
 assert.deepEqual(none.warnings,["claude: the pane's environment is not established until a spawn starts the OATS tmux server (none runs); read instead: this process's CLAUDE_CONFIG_DIR (not set), this process's HOME"]);
});

// awebai/oats#1109: a refused file's problem names the check that refused it, in fixed wording,
// never the file's content (SENTINEL) or a parser message, in plan and in apply.
const SENTINEL='never-print-this-sentinel';
const refusal=(root,opts,file,wording)=>{
 for(const plan of [true,false]) assert.throws(()=>harnessTrust(root,{...opts,plan}),e=>{
  assert.equal(e.code,'E_CONFIG_BROKEN');assert.equal(e.details.mode,plan?'plan':'apply');
  const entry=e.details.entries.find(x=>x.file===file);assert.equal(entry.status,'refused');assert.equal(entry.problem,`${file}: ${wording}`);
  assert.ok(e.message.startsWith('Harness trust refused; nothing was written: '),e.message);assert.ok(e.message.includes(entry.problem),e.message);
  assert.ok(!JSON.stringify(e.details).includes(SENTINEL)&&!e.message.includes(SENTINEL),'never echoes file content');return true;
 });
};
test('each check that refuses a configuration file is named in its problem', async t => {
 const mutableFs=(await import('node:fs')).default;const {syncBuiltinESMExports}=await import('node:module');
 const cases=[
  ['a symbolic link',(file,base)=>{fs.writeFileSync(join(base,'target'),SENTINEL);fs.symlinkSync(join(base,'target'),file);},'is not a regular file (a symbolic link, directory or other type)'],
  ['a directory',file=>fs.mkdirSync(file),'is not a regular file (a symbolic link, directory or other type)'],
  ['a hard link',(file,base)=>{fs.writeFileSync(join(base,'target'),SENTINEL);fs.linkSync(join(base,'target'),file);},'has more than one hard link'],
  ['setuid',file=>{fs.writeFileSync(file,`{"x":"${SENTINEL}"}`);fs.chmodSync(file,0o4600);},'has setuid, setgid or sticky bits set'],
  ['sticky',file=>{fs.writeFileSync(file,`{"x":"${SENTINEL}"}`);fs.chmodSync(file,0o1600);},'has setuid, setgid or sticky bits set'],
  ['larger than 8 MiB',file=>fs.writeFileSync(file,`{"x":"${SENTINEL}${' '.repeat(8*1024*1024)}"}`),'is larger than 8 MiB'],
  ['not UTF-8',file=>fs.writeFileSync(file,Buffer.concat([Buffer.from(`{"x":"${SENTINEL}`),Buffer.from([0xff]),Buffer.from('"}')])),'is not valid UTF-8'],
  ['invalid JSON',file=>fs.writeFileSync(file,`{"x":"${SENTINEL}"`),'is not in the supported format (see "Qualified scope and formats" in docs/harness-trust.md)'],
  ['an unsupported trust value',(file,base,root)=>fs.writeFileSync(file,JSON.stringify({x:SENTINEL,projects:{[fs.realpathSync.native(root)]:{hasTrustDialogAccepted:SENTINEL}}})),'is not in the supported format (see "Qualified scope and formats" in docs/harness-trust.md)'],
 ];
 for(const [name,make,wording] of cases){
  const {base,root,env}=fixture(t);const file=join(fs.realpathSync.native(env.HOME),'.claude.json');make(file,base,root);
  await t.test(name,()=>refusal(root,{env,harness:'claude'},file,wording));
 }
 // Codex: unsupported TOML (the editor's own error), and a native-valid shape the reader does not consume.
 for(const [name,text] of [['unsupported TOML',root=>`[[unsupported]]\nx = "${SENTINEL}"\n`],['outside the reader',root=>`# ${SENTINEL}\n[projects]\n${JSON.stringify(root)} = { "trust_level" = "untrusted" }\n`]]){
  const {root,env}=fixture(t);const file=join(fs.realpathSync.native(env.HOME),'.codex/config.toml');fs.writeFileSync(file,text(fs.realpathSync.native(root)));
  await t.test(name,()=>refusal(root,{env,harness:'codex'},file,'is not in the supported format (see "Qualified scope and formats" in docs/harness-trust.md)'));
 }
 // Replaced between the metadata checks and the read (the probe runs in between).
 {
  const {root,env}=fixture(t);const file=join(fs.realpathSync.native(env.HOME),'.claude.json');fs.writeFileSync(file,'{}');
  const metadataProbe=path=>{fs.writeFileSync(path+'.next',`{"x":"${SENTINEL}"}`);fs.renameSync(path+'.next',path);return null;};
  await t.test('changed while it was being read',()=>refusal(root,{env,harness:'claude',metadataProbe},file,'changed while it was being read'));
 }
 // Owned by another user and an unnamed read error, simulated: tests cannot chown, or rely on EACCES under root.
 const original={lstat:mutableFs.lstatSync,open:mutableFs.openSync};
 for(const [name,mock,wording] of [
  ['owned by another user',file=>t.mock.method(mutableFs,'lstatSync',(...a)=>{const s=original.lstat(...a);if(a[0]===file)s.uid+=1;return s;}),'is owned by another user'],
  ['an errno read error',file=>t.mock.method(mutableFs,'openSync',(...a)=>{if(a[0]===file)throw Object.assign(new Error(`EACCES: ${SENTINEL}`),{code:'EACCES'});return original.open(...a);}),'could not be read (EACCES)'],
 ]){
  const {root,env}=fixture(t);const file=join(fs.realpathSync.native(env.HOME),'.claude.json');fs.writeFileSync(file,`{"x":"${SENTINEL}"}`);
  mock(file);syncBuiltinESMExports();
  try{await t.test(name,()=>refusal(root,{env,harness:'claude'},file,wording));}finally{t.mock.restoreAll();syncBuiltinESMExports();}
 }
 // An exception no check names is the generic sentence, never its message.
 {
  const {root,env}=fixture(t);const file=join(fs.realpathSync.native(env.HOME),'.claude.json');fs.writeFileSync(file,'{}');
  const metadataProbe=()=>{throw new Error(SENTINEL);};
  await t.test('an unnamed exception',()=>refusal(root,{env,harness:'claude',metadataProbe},file,'Native trust configuration is unreadable, unsafe, invalid, or outside the supported format; inspect the selected file before retrying.'));
 }
});
// With no pane given, the ambient file is selected by this process's environment (the plan says so in `warnings`).
test('an ambient environment that selects no usable file is a named problem, without its values', t => {
 const {base,root,env}=fixture(t);const notDir=join(base,'a-file');fs.writeFileSync(notDir,SENTINEL);
 const unusable=(harness,what)=>`the file a ${harness} launch with no launch configuration reads could not be established: ${what}`;
 for(const [harness,host,problem] of [
  ['codex',{CODEX_HOME:`relative/${SENTINEL}`},unusable('codex',"this process's CODEX_HOME is not an absolute path")],
  ['claude',{HOME:`relative/${SENTINEL}`},unusable('claude',"this process's HOME is not an absolute path")],
  ['claude',{CLAUDE_CONFIG_DIR:notDir},unusable('claude',"this process's CLAUDE_CONFIG_DIR does not select a usable claude configuration directory")],
 ]) for(const plan of [true,false]) assert.throws(()=>harnessTrust(root,{env:{...env,...host},harness,plan}),e=>{
  assert.equal(e.code,'E_CONFIG_BROKEN');const [entry]=e.details.entries;
  assert.equal(entry.status,'refused');assert.equal(entry.file,null);assert.equal(entry.ambient,true);assert.equal(entry.problem,problem);
  assert.equal(e.message,`Harness trust refused; nothing was written: ${problem}`);assert.ok(!JSON.stringify(e.details).includes(SENTINEL));return true;
 });
});
test('under all, one refused file names its reason and the fine file keeps its plan; nothing is written', t => {
 const {root,env}=fixture(t);const file=join(fs.realpathSync.native(env.HOME),'.claude.json');fs.writeFileSync(file,`{"x":"${SENTINEL}"`);
 assert.throws(()=>harnessTrust(root,{env,plan:true}),e=>{
  const [claude,codex]=e.details.entries;
  assert.equal(claude.status,'refused');assert.equal(claude.problem,`${file}: is not in the supported format (see "Qualified scope and formats" in docs/harness-trust.md)`);
  assert.equal(codex.status,'change');assert.equal(codex.problem,undefined);assert.equal(codex.current,null);assert.match(codex.afterDigest,/^[a-f0-9]{64}$/);
  assert.equal(e.message,`Harness trust refused; nothing was written: ${claude.problem}`);return true;
 });
 assert.deepEqual(fs.readdirSync(join(env.HOME,'.codex')),[]);assert.equal(fs.existsSync(join(root,'.agents')),false);
});
