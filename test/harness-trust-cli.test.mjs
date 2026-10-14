import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const CLI=fileURLToPath(new URL('../bin/oats.mjs',import.meta.url));
function fixture(t){const base=fs.mkdtempSync(join(tmpdir(),'oats-trust-cli-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));const deployment=join(base,'deployment');fs.mkdirSync(deployment);fs.writeFileSync(join(deployment,'oats-local.yaml'),`schemaVersion: 2\nworkspace: ${JSON.stringify(join(base,'workspace'))}\n`);/* `oats harness trust` writes for the file a launch's pane will read: a private TMUX_TMPDIR, where no server runs, so this host's own OATS tmux server is never the one read, and no account of this host is written. */const env={PATH:process.env.PATH,HOME:join(base,'native'),TMUX_TMPDIR:join(base,'tmux')};fs.mkdirSync(join(env.HOME,'.codex'),{recursive:true}); /* the operator has run both harnesses; OATS never creates their directories */return {base,deployment,env,run(args,cwd=deployment){const r=spawnSync(process.execPath,[CLI,...args,'--json'],{cwd,env,encoding:'utf8'});return {status:r.status,value:JSON.parse(r.stdout)};}};}
test('trust CLI plan, bare apply and deployment context from nested directory',t=>{
 const f=fixture(t);const nested=join(f.deployment,'agents/example/instances/one');fs.mkdirSync(nested,{recursive:true});
 const p=f.run(['harness','trust','--harness','claude','--plan'],nested);assert.equal(p.status,0,JSON.stringify(p.value));assert.equal(p.value.result.root,fs.realpathSync(f.deployment));assert.equal(fs.existsSync(join(f.env.HOME,'.claude.json')),false);
 const a=f.run(['harness','trust','--harness','claude']);assert.equal(a.status,0,JSON.stringify(a.value));assert.equal(a.value.result.entries[0].status,'applied');
});
test('trust CLI refuses unknown flags, old apply spelling, unsupported harness and positionals',t=>{
 const f=fixture(t);for(const args of [['--apply'],['--server','x'],['--harness','pi'],['oops'],['--plan=false'],['--harness'],['--plan','--plan']]) {const r=f.run(['harness','trust',...args]);assert.notEqual(r.status,0);assert.equal(r.value.error.code,'E_BAD_ARGS',JSON.stringify(r.value));}
 assert.equal(fs.existsSync(join(f.env.HOME,".claude.json")),false);assert.deepEqual(fs.readdirSync(join(f.env.HOME,".codex")),[]);
 const outside=f.run(['harness','trust','--harness','pi'],f.base);assert.equal(outside.value.error.code,'E_BAD_ARGS');
});
test('trust CLI help documents bare apply and has no effects',t=>{const f=fixture(t);const r=f.run(['harness','trust','--help']);assert.equal(r.status,0);assert.match(r.value.result.usage.join('\n'),/bare command applies/);assert.equal(fs.existsSync(join(f.env.HOME,".claude.json")),false);});

test('human failure shows each outcome and uncertainty without native contents', t => {
 const f=fixture(t);const file=join(f.env.HOME,'.claude.json');fs.writeFileSync(file,'{"privateSentinel":"never-print-this"}');fs.writeFileSync(file+'.oats-trust.lock','other operator');
 const r=spawnSync(process.execPath,[CLI,'harness','trust','--harness','claude'],{cwd:f.deployment,env:f.env,encoding:'utf8'});
 assert.notEqual(r.status,0);assert.match(r.stderr,/claude: not-attempted/);assert.match(r.stderr,/reason: locked; native configuration may have changed: false/);assert.match(r.stderr,/audit: incomplete/);assert.ok(!r.stderr.includes('never-print-this'));
 assert.ok(r.stderr.includes(fs.realpathSync.native(file)+'.oats-trust.lock'),r.stderr);
 const json=f.run(['harness','trust','--harness','claude']);
 assert.equal(json.value.error.code,'E_HARNESS_TRUST_INCOMPLETE');
 assert.equal(json.value.error.details.reason,'locked');
 assert.ok(json.value.error.message.includes(fs.realpathSync.native(file)+'.oats-trust.lock'),JSON.stringify(json.value));
 assert.equal(fs.readFileSync(file+'.oats-trust.lock','utf8'),'other operator');
});

test('explicit deployment alias reports and writes only the native canonical root', t => {
 const f=fixture(t), actual=join(f.base,'DeploymentCase'), typed=join(f.base,'deploymentcase');
 fs.renameSync(f.deployment,actual);
 if(!fs.existsSync(typed))fs.symlinkSync(actual,typed);
 const canonical=fs.realpathSync.native(actual);
 for(const flags of [['--plan'],[]]) {
  const r=f.run(['harness','trust','--dir',typed,'--harness','claude',...flags],f.base);
  assert.equal(r.status,0,JSON.stringify(r.value));
  assert.equal(r.value.result.root,canonical);assert.equal(r.value.result.entries[0].key[1],canonical);
 }
 const projects=JSON.parse(fs.readFileSync(join(f.env.HOME,'.claude.json'),'utf8')).projects;
 assert.deepEqual(Object.keys(projects),[canonical]);
 const rows=fs.readFileSync(join(actual,'.agents/harness-trust.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.ok(rows.every(row=>row.root===canonical));
});

test('trust CLI targets every launch configuration config directory of the deployment and names each problem', t => {
 const f=fixture(t);const work=join(f.base,'claude-work');fs.mkdirSync(work);
 const local=yaml=>fs.writeFileSync(join(f.deployment,'oats-local.yaml'),`schemaVersion: 2\nworkspace: ${JSON.stringify(join(f.base,'workspace'))}\nlaunch-configs:\n${yaml}`);
 local(`  work:\n    harness: claude\n    env:\n      CLAUDE_CONFIG_DIR: ${JSON.stringify(work)}\n`);
 const p=f.run(['harness','trust','--harness','claude','--plan']);assert.equal(p.status,0,JSON.stringify(p.value));
 assert.deepEqual(p.value.result.entries.map(e=>[e.file,e.ambient,e.launchConfigs]),[[join(fs.realpathSync.native(f.env.HOME),'.claude.json'),true,[]],[join(fs.realpathSync.native(work),'.claude.json'),false,['work']]]);
 const human=spawnSync(process.execPath,[CLI,'harness','trust','--harness','claude','--plan'],{cwd:f.deployment,env:f.env,encoding:'utf8'});
 assert.equal(human.status,0,human.stderr);assert.match(human.stdout,/claude: change .*claude-work\/\.claude\.json .* \(launch configuration work\)/);assert.match(human.stdout,/claude: change .*native\/\.claude\.json .* \(ambient\)/);
 const a=f.run(['harness','trust','--harness','claude']);assert.equal(a.status,0,JSON.stringify(a.value));assert.deepEqual(a.value.result.entries.map(e=>e.status),['applied','applied']);
 local(`  gone:\n    harness: claude\n    env:\n      CLAUDE_CONFIG_DIR: ${JSON.stringify(join(f.base,'missing'))}\n`);
 const r=spawnSync(process.execPath,[CLI,'harness','trust','--harness','claude'],{cwd:f.deployment,env:f.env,encoding:'utf8'});
 assert.notEqual(r.status,0);assert.match(r.stderr,/problem: launch configuration gone: CLAUDE_CONFIG_DIR .*missing does not exist/);assert.equal(fs.existsSync(join(f.base,'missing')),false);
});
