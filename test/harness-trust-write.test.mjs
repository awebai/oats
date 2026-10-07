import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harnessTrust } from '../lib/harness-trust-write.mjs';
const fixture = t => { const base=fs.mkdtempSync(join(tmpdir(),'oats-trust-write-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));const root=join(base,'deployment');fs.mkdirSync(root);return {base,root,env:{HOME:join(base,'native')}}; };
test('plan creates nothing; apply writes exact leaves and durable audit; repeat is config no-op', t => {
 const {base,root,env}=fixture(t);
 const planned=harnessTrust(root,{plan:true,env});assert.equal(planned.entries.length,2);assert.equal(fs.existsSync(env.HOME),false);assert.equal(fs.existsSync(join(root,'.agents')),false);
 const applied=harnessTrust(root,{env});assert.deepEqual(applied.entries.map(e=>e.status),['applied','applied']);assert.equal(applied.audit.status,'recorded');
 const before=applied.entries.map(e=>({bytes:fs.readFileSync(e.file),mtime:fs.statSync(e.file).mtimeMs}));
 const again=harnessTrust(root,{env});assert.deepEqual(again.entries.map(e=>e.status),['unchanged','unchanged']);
 again.entries.forEach((e,i)=>{assert.deepEqual(fs.readFileSync(e.file),before[i].bytes);assert.equal(fs.statSync(e.file).mtimeMs,before[i].mtime);});
 assert.equal(fs.readFileSync(applied.audit.path,'utf8').trim().split('\n').length,6);
});
test('all preflights before writes and refuses unsupported second file',t=>{
 const {root,env}=fixture(t);fs.mkdirSync(join(env.HOME,'.codex'),{recursive:true});fs.writeFileSync(join(env.HOME,'.codex/config.toml'),'[[unsupported]]\nx=1\n');
 assert.throws(()=>harnessTrust(root,{env}),e=>e.code==='E_CONFIG_BROKEN');assert.equal(fs.existsSync(join(env.HOME,'.claude.json')),false);
});
test('audit failure before replacement sends no write; after replacement retains actual change',t=>{
 const {root,env}=fixture(t);
 assert.throws(()=>harnessTrust(root,{env,harness:'claude',checkpoint(name){if(name==='before-audit')throw Error('fail');}}),e=>e.code==='E_HARNESS_TRUST_INCOMPLETE'&&e.details.reason==='audit'&&!e.details.mayHaveChanged);
 assert.equal(fs.existsSync(join(env.HOME,'.claude.json')),false);
 assert.throws(()=>harnessTrust(root,{env,harness:'claude',checkpoint(name,info){if(name==='before-audit'&&info.phase==='outcome')throw Error('fail');}}),e=>e.details.mayHaveChanged&&e.details.entries[0].status==='incomplete');
 assert.equal(JSON.parse(fs.readFileSync(join(env.HOME,'.claude.json'),'utf8')).projects[fs.realpathSync(root)].hasTrustDialogAccepted,true);
});
test('cooperating lock and concurrent bytes refuse without overwriting',t=>{
 const {root,env}=fixture(t);fs.mkdirSync(env.HOME);const file=join(env.HOME,'.claude.json');fs.writeFileSync(file,'{}');fs.writeFileSync(file+'.oats-trust.lock','owned elsewhere');
 assert.throws(()=>harnessTrust(root,{env,harness:'claude'}),e=>e.details.reason==='locked');assert.equal(fs.readFileSync(file,'utf8'),'{}');fs.unlinkSync(file+'.oats-trust.lock');
 assert.throws(()=>harnessTrust(root,{env,harness:'claude',checkpoint(name){if(name==='before-replace')fs.writeFileSync(file,'{"operator":true}');}}),e=>e.details.reason==='changed'&&!e.details.mayHaveChanged);
 assert.equal(fs.readFileSync(file,'utf8'),'{"operator":true}');
});
test('partial all apply retains first write and audits second failure without rollback',t=>{
 const {root,env}=fixture(t);
 assert.throws(()=>harnessTrust(root,{env,checkpoint(name,{entry}={}){if(name==='before-replace'&&entry.harness==='codex')throw Error('blocked');}}),e=>{
   assert.equal(e.details.mayHaveChanged,true);assert.equal(e.details.entries[0].status,'applied');assert.equal(e.details.entries[1].status,'failed');assert.equal(e.details.reason,'changed');return true;
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
 const {root,env,base}=fixture(t);fs.mkdirSync(env.HOME);const target=join(base,'target');fs.writeFileSync(target,'{}');const file=join(env.HOME,'.claude.json');fs.symlinkSync(target,file);
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
  assert.deepEqual(fs.readdirSync(env.HOME),[],stage);
  const rows=fs.readFileSync(join(root,'.agents/harness-trust.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(r=>r.status),['planned',stage==='rename'?'incomplete':'failed']);
  assert.equal(rows[1].afterDigest,null,'failed replacement did not create the proposed bytes');
  assert.match(rows[0].afterDigest,/^[a-f0-9]{64}$/,'intent retains candidate digest');
  assert.deepEqual(fs.readdirSync(join(root,'.agents')),['harness-trust.jsonl']);
 }
});

test('file modes survive replacement; new directories/audit are private; special modes refuse', t => {
 const {root,env}=fixture(t);fs.mkdirSync(env.HOME,{mode:0o700});const file=join(env.HOME,'.claude.json');fs.writeFileSync(file,'{}',{mode:0o640});
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
 const {root,env}=fixture(t);fs.mkdirSync(env.HOME);const file=join(env.HOME,'.claude.json');fs.writeFileSync(file,'{}');
 assert.throws(()=>harnessTrust(root,{env,harness:'claude',checkpoint(name){if(name==='before-replace'){fs.writeFileSync(file+'.external','{}');fs.renameSync(file+'.external',file);}}}),e=>e.details.reason==='changed'&&!e.details.mayHaveChanged);
 assert.equal(fs.readFileSync(file,'utf8'),'{}');assert.deepEqual(fs.readdirSync(env.HOME),['.claude.json']);
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
