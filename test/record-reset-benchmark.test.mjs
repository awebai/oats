import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { RecordStore } from '../packages/record/lib/store.mjs';
import { RecordIndex } from '../packages/record/lib/index-db.mjs';
import { run as benchmark, reset, startProbe, SCHEMA, TABLES } from '../scripts/benchmark-record-reset.mjs';
import { DatabaseSync } from 'node:sqlite';
const script=resolve(import.meta.dirname,'../scripts/benchmark-record-reset.mjs');
function fixture(t){
 const root=fs.mkdtempSync(join(tmpdir(),'reset-benchmark-PRIVATE-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const index=new RecordIndex(new RecordStore(root,{owner:'PRIVATE OWNER'}));
 index.db.exec(`INSERT INTO turns VALUES ('PRIVATE-ID','2026-01-01','PRIVATE OWNER',NULL,NULL,'note','test','projected','fixture~a',0,0,0);
 INSERT INTO turn_text VALUES ('PRIVATE-ID','body','user','PRIVATE CAPTURED TEXT');
 INSERT INTO meta VALUES ('owner','PRIVATE OWNER');
 INSERT INTO index_state VALUES ('fixture~a',1);INSERT INTO index_bytes VALUES ('fixture~a',100,1,'epoch');`);
 const path=join(root,'index/turns.db');index.close();return {root,path};
}
function run(root,path,mode='optimized',ack=true,entry=script,prepare=false){
 return spawnSync(process.execPath,['--no-warnings',entry,...(ack?['--ack-disposable-scratch']:[]),...(prepare?['--prepare-outgoing-index']:[]),path,mode],{
  env:{HOME:root,TMPDIR:root,XDG_CACHE_HOME:root,PATH:process.env.PATH},encoding:'utf8',timeout:15000,maxBuffer:65536,
 });
}
const schema=db=>db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name').all();
const hash=path=>createHash('sha256').update(fs.readFileSync(path)).digest('hex');

function outgoingFixture(t){
 const root=fs.mkdtempSync(join(tmpdir(),'reset-outgoing-PRIVATE-')),path=join(root,'outgoing.db');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const db=new DatabaseSync(path);
 db.exec(fs.readFileSync(new URL('./fixtures/record-index-v0.54.0.sql',import.meta.url),'utf8'));
 db.exec(`INSERT INTO turns VALUES ('id','2026-01-01','PRIVATE OWNER',NULL,'thread','note','test','projected','fixture~a',0,0,0);
 INSERT INTO turn_text VALUES ('id','body','user','PRIVATE TEXT');
 INSERT INTO tombstones VALUES ('gone','PRIVATE OWNER');
 INSERT INTO tags VALUES ('tag','id','turn','[]',NULL,'PRIVATE NOTE');
 INSERT INTO outfits VALUES ('outfit','task','open','[]');
 INSERT INTO segments VALUES ('segment','thread',1,2,'session','done','[]','[]',NULL,'2026-01-01',0);
 INSERT INTO spawns VALUES ('spawn','thread','outfit',NULL,NULL,NULL,'2026-01-01');
 INSERT INTO index_state VALUES ('fixture~a',1);
 INSERT INTO meta VALUES ('owner','PRIVATE OWNER');`);
 db.close();return {root,path};
}

test('published outgoing schema requires explicit preparation in both modes and discloses the added empty cursor',t=>{
 for(const mode of ['original','optimized']){
  const {root,path}=outgoingFixture(t),originalHash=hash(path);
  const refused=run(root,path,mode);assert.equal(refused.status,1);assert.match(refused.stderr,/E_SCHEMA/);
  assert.equal(refused.stdout,'');assert.equal(refused.stderr.includes('PRIVATE'),false);assert.equal(hash(path),originalHash);
  const result=run(root,path,mode,true,script,true);assert.equal(result.status,0,result.stderr);
  const output=JSON.parse(result.stdout);assert.equal(result.stderr,'');assert.equal(result.stdout.includes('PRIVATE'),false);
  assert.equal(output.input.schemaVariant,'published-v0.53.0-v0.54.0');assert.equal(output.input.indexBytesPresent,false);
  assert.equal(Object.hasOwn(output.input.counts,'index_bytes'),false);
  assert.equal(output.preparation.createdEmptyIndexBytes,true);assert.equal(output.preparation.outsideResetTiming,true);
  assert.ok(output.preparation.wallMs>=0);assert.equal(output.schemaPreserved,false);assert.equal(output.preparedSchemaPreserved,true);
  assert.equal(output.beforeCounts.index_bytes,0);
  for(const name of TABLES.filter(name=>name!=='index_bytes'))assert.equal(output.input.counts[name],1);
  assert.deepEqual(output.beforeCounts,{...output.input.counts,index_bytes:0});assert.ok(Object.values(output.afterCounts).every(n=>n===0));
  const db=new DatabaseSync(path),expected=new DatabaseSync(':memory:');
  try{expected.exec(SCHEMA);assert.deepEqual(schema(db),schema(expected));assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);assert.equal(db.prepare('SELECT value FROM meta').get().value,'PRIVATE OWNER');}finally{db.close();expected.close();}
 }
});

test('outgoing preparation alone adds only the constructor cursor table, outside reset; unknown shapes never mutate',async t=>{
 const {root,path}=outgoingFixture(t),originalExec=DatabaseSync.prototype.exec;
 const before=new DatabaseSync(path),originalSchema=schema(before),originalRows=Object.fromEntries([...TABLES.filter(name=>name!=='index_bytes'),'meta'].map(name=>[name,before.prepare(`SELECT * FROM ${name}`).all()]));before.close();
 DatabaseSync.prototype.exec=function(sql){if(sql==='BEGIN')throw Error('stop before reset');return originalExec.call(this,sql);};
 try{await assert.rejects(()=>benchmark(path,'optimized',{prepareOutgoingIndex:true}),/stop before reset/);}
 finally{DatabaseSync.prototype.exec=originalExec;}
 const prepared=new DatabaseSync(path);
 try{
  for(const [name,rows]of Object.entries(originalRows))assert.deepEqual(prepared.prepare(`SELECT * FROM ${name}`).all(),rows);
  assert.equal(prepared.prepare('SELECT count(*) AS n FROM index_bytes').get().n,0);
  assert.deepEqual(schema(prepared).filter(row=>row.tbl_name!=='index_bytes'),originalSchema);
  assert.equal(prepared.prepare('PRAGMA user_version').get().user_version,1);
 }finally{prepared.close();}
 for(const alteration of ['CREATE TABLE unexpected (private TEXT)','CREATE TABLE index_bytes (stream TEXT PRIMARY KEY)','ALTER TABLE meta ADD COLUMN unexpected TEXT','PRAGMA user_version=2']){
  const unknown=outgoingFixture(t),db=new DatabaseSync(unknown.path);db.exec(alteration);db.close();const original=hash(unknown.path);
  const result=run(unknown.root,unknown.path,'optimized',true,script,true);
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/E_SCHEMA/);assert.equal(result.stderr.includes('PRIVATE'),false);assert.equal(hash(unknown.path),original);
 }
});

test('standalone execution through a symlinked parent produces a result and resets; refusal is safe and nonzero',t=>{
 for(const mode of ['original','optimized']){
  const {root,path}=fixture(t),directory=join(root,'actual'),alias=join(root,'alias');fs.mkdirSync(directory);fs.symlinkSync(directory,alias);
  fs.copyFileSync(script,join(directory,'standalone.mjs'));
  const result=run(root,path,mode,true,join(alias,'standalone.mjs'));
  assert.equal(result.status,0,result.stderr);assert.ok(result.stdout.trim(),'direct execution must emit a result');
  assert.equal(JSON.parse(result.stdout).success,true);
  const db=new DatabaseSync(path);try{assert.equal(db.prepare('SELECT count(*) AS n FROM turns').get().n,0);}finally{db.close();}
  const refused=run(root,join(root,'PRIVATE-MISSING'),mode,true,join(alias,'standalone.mjs'));
  assert.equal(refused.status,1);assert.equal(refused.stdout,'');assert.equal(JSON.parse(refused.stderr).success,false);assert.equal(refused.stderr.includes('PRIVATE'),false);
 }
});

test('failed direct-execution canonicalization reports a safe failure instead of silent success',t=>{
 const {root}=fixture(t);
 const result=spawnSync(process.execPath,['--no-warnings','--input-type=module','-e',`process.argv[1]=${JSON.stringify(join(root,'PRIVATE-MISSING'))};await import(${JSON.stringify(new URL('../scripts/benchmark-record-reset.mjs',import.meta.url).href)});`],{
  env:{HOME:root,TMPDIR:root,PATH:process.env.PATH},encoding:'utf8',timeout:5000,
 });
 assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/E_EXECUTION_IDENTITY/);assert.equal(result.stderr.includes('PRIVATE'),false);
});

test('standalone modes clear the same tables, preserve private metadata/schema and report aggregate timings',t=>{
 for(const mode of ['original','optimized']){
  const {root,path}=fixture(t),copy=join(root,'standalone.mjs');fs.copyFileSync(script,copy);
  const before=new DatabaseSync(path);const definitions=schema(before);before.close();
  const result=run(root,path,mode,true,copy);assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);
  assert.equal(result.stderr,'');assert.equal(result.stdout.includes('PRIVATE'),false);
  assert.equal(result.stdout.includes(path),false);
  const output=JSON.parse(result.stdout);assert.equal(output.success,true);assert.equal(output.mode,mode);
  assert.equal(output.beforeCounts.turn_text,1);assert.equal(output.beforeCounts.turns,1);
  assert.ok(Object.values(output.afterCounts).every(n=>n===0));
  assert.ok(output.resetWallMs>=output.transactionIntervalMs);assert.ok(output.commitCallMs>=0);
  assert.ok(output.writeTransactionBoundsMs.upper>=output.writeTransactionBoundsMs.lower);
  assert.ok(output.readProbe.attempts>=1);assert.equal(output.readProbe.intervalTargetMs,10);
  assert.equal(output.settings.journal_mode,'delete');assert.equal(output.settings.synchronous,2);
  assert.equal(output.schemaPreserved,true);assert.equal(output.metadataPreserved,true);
  const after=new DatabaseSync(path);
  try{assert.deepEqual(schema(after),definitions);assert.equal(after.prepare("SELECT value FROM meta WHERE key='owner'").get().value,'PRIVATE OWNER');}finally{after.close();}
  assert.ok(fs.existsSync(path),'operator owns disposal');
 }
});

test('no acknowledgement, invalid mode, absent/symlink/nonregular/sidecar inputs refuse without content or path disclosure',t=>{
 const {root,path}=fixture(t),before=hash(path),link=join(root,'PRIVATE-LINK'),absent=join(root,'PRIVATE-MISSING');fs.symlinkSync(path,link);
 for(const [input,mode,ack]of [[path,'optimized',false],[path,'bad',true],[absent,'original',true],[link,'optimized',true],[root,'original',true]]){
  const result=run(root,input,mode,ack);assert.equal(result.status,1);assert.equal(result.stdout,'');
  assert.equal(result.stderr.includes('PRIVATE'),false);assert.equal(result.stderr.includes(root),false);
  assert.equal(hash(path),before);assert.equal(fs.existsSync(absent),false);
 }
 fs.writeFileSync(path+'-journal','PRIVATE SIDECAR');
 const refusal=run(root,path);assert.equal(refusal.status,1);assert.equal(refusal.stdout,'');assert.match(refusal.stderr,/E_INPUT_SIDECAR/);
 assert.equal(fs.readFileSync(path+'-journal','utf8'),'PRIVATE SIDECAR');assert.equal(hash(path),before);
});

test('unsupported schema and invalid header refuse safely without creating tables or resetting rows',t=>{
 const {root,path}=fixture(t),db=new DatabaseSync(path);db.exec('CREATE TABLE unexpected (secret TEXT)');db.close();
 const before=hash(path),result=run(root,path);assert.equal(result.status,1);assert.match(result.stderr,/E_SCHEMA/);assert.equal(result.stdout,'');assert.equal(hash(path),before);
 const bad=join(root,'PRIVATE-BAD');fs.writeFileSync(bad,'PRIVATE CONTENT'.repeat(20));const badHash=hash(bad);
 const invalid=run(root,bad);assert.equal(invalid.status,1);assert.match(invalid.stderr,/E_INPUT_HEADER/);assert.equal(invalid.stderr.includes('PRIVATE'),false);assert.equal(hash(bad),badHash);
});

test('benchmark schema and optimized SQL correspond exactly to owning production reset; original retains deferred BEGIN',t=>{
 const {root,path}=fixture(t),store=new RecordStore(root),index=new RecordIndex(store),memory=new DatabaseSync(':memory:');
 try{
  memory.exec(SCHEMA);assert.deepEqual(schema(memory),schema(index.db));
  const actual=[],exec=index.db.exec.bind(index.db);index.db.exec=sql=>{actual.push(sql);return exec(sql);};index.reset();
  const optimized=[];reset({exec:sql=>optimized.push(sql)},'optimized');assert.deepEqual(optimized,actual);
  const original=[];reset({exec:sql=>original.push(sql)},'original');
  assert.deepEqual(original,['BEGIN',...TABLES.map(name=>`DELETE FROM ${name}`),'COMMIT']);
  assert.equal(fs.existsSync(path),true);
 }finally{memory.close();index.close();}
});

test('benchmark reset rolls back every target and schema on injected failure after FTS recreation',t=>{
 const {root}=fixture(t),index=new RecordIndex(new RecordStore(root)),before=schema(index.db),exec=index.db.exec.bind(index.db);
 try{
  index.db.exec=sql=>{const result=exec(sql);if(sql.startsWith('CREATE VIRTUAL'))throw Error('fault');return result;};
  assert.throws(()=>reset(index.db,'optimized'),/fault/);
  assert.deepEqual(schema(index.db),before);assert.equal(index.db.prepare('SELECT count(*) AS n FROM turn_text').get().n,1);
 }finally{index.close();}
});

test('reset failure terminates and reaps the owned read probe before rejecting',async t=>{
 const {path}=fixture(t),originalSpawn=childProcess.spawn,originalExec=DatabaseSync.prototype.exec,children=[];
 childProcess.spawn=(...args)=>{const child=originalSpawn(...args);children.push(child);return child;};syncBuiltinESMExports();
 DatabaseSync.prototype.exec=function(sql){const result=originalExec.call(this,sql);if(sql==='DROP TABLE turn_text')throw Error('injected write failure');return result;};
 try{
  await assert.rejects(()=>benchmark(path,'optimized'),/injected write failure/);
  assert.equal(children.length,1);assert.ok(children.every(child=>child.exitCode!==null||child.signalCode!==null));
  const db=new DatabaseSync(path);try{assert.equal(db.prepare('SELECT count(*) AS n FROM turn_text').get().n,1);}finally{db.close();}
 }finally{DatabaseSync.prototype.exec=originalExec;childProcess.spawn=originalSpawn;syncBuiltinESMExports();}
});

test('separate-process read probes distinguish a reader-permitting reservation from observed reader exclusion',async t=>{
 const {path}=fixture(t),db=new DatabaseSync(path),probe=await startProbe(path);
 try{
  db.exec('BEGIN IMMEDIATE');
  await new Promise(resolve=>setTimeout(resolve,80));
  db.exec('ROLLBACK');
  // EXCLUSIVE is only a controlled test stimulus, never benchmark reset SQL.
  db.exec('BEGIN EXCLUSIVE');
  await new Promise(resolve=>setTimeout(resolve,80));
  db.exec('ROLLBACK');
  const result=await probe.stop();
  assert.ok(result.readable>1);assert.ok(result.busy>1);assert.ok(result.longestObservedBusySpanMs>0);
 }finally{if(db.isTransaction)db.exec('ROLLBACK');await probe.terminate();db.close();}
});
