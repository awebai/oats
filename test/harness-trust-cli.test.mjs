import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const CLI=resolve('bin/oats.mjs');
function fixture(t){const base=fs.mkdtempSync(join(tmpdir(),'oats-trust-cli-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));const deployment=join(base,'deployment');fs.mkdirSync(deployment);fs.writeFileSync(join(deployment,'oats-local.yaml'),`schemaVersion: 2\nworkspace: ${JSON.stringify(join(base,'workspace'))}\n`);const env={PATH:process.env.PATH,HOME:join(base,'native')};return {base,deployment,env,run(args,cwd=deployment){const r=spawnSync(process.execPath,[CLI,...args,'--json'],{cwd,env,encoding:'utf8'});return {status:r.status,value:JSON.parse(r.stdout)};}};}
test('trust CLI plan, bare apply and deployment context from nested directory',t=>{
 const f=fixture(t);const nested=join(f.deployment,'agents/example/instances/one');fs.mkdirSync(nested,{recursive:true});
 const p=f.run(['harness','trust','--harness','claude','--plan'],nested);assert.equal(p.status,0,JSON.stringify(p.value));assert.equal(p.value.result.root,fs.realpathSync(f.deployment));assert.equal(fs.existsSync(f.env.HOME),false);
 const a=f.run(['harness','trust','--harness','claude']);assert.equal(a.status,0,JSON.stringify(a.value));assert.equal(a.value.result.entries[0].status,'applied');
});
test('trust CLI refuses unknown flags, old apply spelling, unsupported harness and positionals',t=>{
 const f=fixture(t);for(const args of [['--apply'],['--server','x'],['--harness','pi'],['oops'],['--plan=false'],['--harness'],['--plan','--plan']]) {const r=f.run(['harness','trust',...args]);assert.notEqual(r.status,0);assert.equal(r.value.error.code,'E_BAD_ARGS',JSON.stringify(r.value));}
 assert.equal(fs.existsSync(f.env.HOME),false);
});
test('trust CLI help documents bare apply and has no effects',t=>{const f=fixture(t);const r=f.run(['harness','trust','--help']);assert.equal(r.status,0);assert.match(r.value.result.usage.join('\n'),/bare command applies/);assert.equal(fs.existsSync(f.env.HOME),false);});
