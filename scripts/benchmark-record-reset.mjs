#!/usr/bin/env node
// OPERATOR ONLY: destroys index rows in ONE explicitly acknowledged disposable
// SQLite backup. Never point this at a live record. The operator supplies and
// disposes of the copy; this script never discovers roots or creates a backup.
// Self-contained correspondence: packages/record/lib/index-db.mjs SCHEMA and
// RecordIndex.reset at this commit. Original reset is the aaf23012 reset body.
// Tests pin both SQL sequences and the full production schema, including FTS.
// Reader probes are samples, NOT an exact measurement of EXCLUSIVE-lock time.
// https://www.sqlite.org/lang_transaction.html
// https://www.sqlite.org/lockingv3.html
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const TEXT_SCHEMA = `CREATE VIRTUAL TABLE IF NOT EXISTS turn_text USING fts5(
  turn_id UNINDEXED, loc UNINDEXED, role UNINDEXED, text
);`;
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  from_name TEXT NOT NULL,
  to_name TEXT,
  thread TEXT,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  fidelity TEXT NOT NULL,
  stream TEXT NOT NULL,
  events INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  superseded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS turns_thread ON turns(thread);
CREATE INDEX IF NOT EXISTS turns_ts ON turns(ts);
CREATE TABLE IF NOT EXISTS tombstones (
  ref TEXT NOT NULL,
  from_name TEXT NOT NULL,
  PRIMARY KEY (ref, from_name)
);
CREATE TABLE IF NOT EXISTS index_state (
  stream TEXT PRIMARY KEY,
  indexed_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS index_bytes (
  stream TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL,
  indexed_count INTEGER NOT NULL,
  epoch TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tags (
  tag_id TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  about TEXT NOT NULL,
  acts TEXT NOT NULL,
  case_slug TEXT,
  note TEXT NOT NULL,
  PRIMARY KEY (tag_id)
);
CREATE INDEX IF NOT EXISTS tags_target ON tags(target_ref);
CREATE INDEX IF NOT EXISTS tags_case ON tags(case_slug);
CREATE TABLE IF NOT EXISTS outfits (
  outfit_id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  status TEXT NOT NULL,
  members TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS segments (
  note_id TEXT PRIMARY KEY,
  thread TEXT NOT NULL,
  start_n INTEGER NOT NULL,
  end_n INTEGER,
  type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  about TEXT NOT NULL,
  established TEXT NOT NULL,
  lesson TEXT,
  ts TEXT NOT NULL,
  ts_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS segments_thread ON segments(thread, start_n);
CREATE TABLE IF NOT EXISTS spawns (
  note_id TEXT PRIMARY KEY,
  agent_thread TEXT NOT NULL,
  outfit_id TEXT NOT NULL,
  task TEXT,
  harness TEXT,
  grant_ref TEXT,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS spawns_agent ON spawns(agent_thread);
CREATE VIRTUAL TABLE IF NOT EXISTS turn_text USING fts5(
  turn_id UNINDEXED, loc UNINDEXED, role UNINDEXED, text
);
`;
export const TABLES = ['turns', 'turn_text', 'tombstones', 'tags', 'outfits', 'segments', 'spawns', 'index_state', 'index_bytes'];
export const CONNECTION_SETTINGS = 'PRAGMA busy_timeout = 60000; PRAGMA cache_size = -2048; PRAGMA temp_store = FILE';
export function reset(db, mode) {
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM turns');
    if (mode === 'original') db.exec('DELETE FROM turn_text');
    else { db.exec('DROP TABLE turn_text'); db.exec(TEXT_SCHEMA); }
    for (const table of TABLES.slice(2)) db.exec(`DELETE FROM ${table}`);
    if (mode === 'optimized') db.exec('PRAGMA user_version = 1');
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* original failure wins */ }
    throw err;
  }
}
const now = () => process.hrtime.bigint();
const ms = ns => Number(ns) / 1e6;
const fail = code => { const error = new Error(code); error.safeCode = code; throw error; };
const runtimeSupported = () => {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 23 || (major === 23 && minor >= 2) || (major === 22 && minor >= 13);
};
function sizes(path) {
  return Object.fromEntries(['', '-journal', '-wal', '-shm'].map(suffix => {
    try {
      const st = fs.lstatSync(path + suffix);
      if (!st.isFile() || st.isSymbolicLink()) fail('E_INPUT_TYPE');
      return [suffix || 'database', st.size];
    } catch (err) { if (err.code === 'ENOENT' && suffix) return [suffix, 0]; throw err; }
  }));
}
function preflight(path) {
  const before = fs.lstatSync(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size < 100n) fail('E_INPUT_TYPE');
  for (const suffix of ['-journal', '-wal', '-shm']) {
    try { fs.lstatSync(path + suffix); fail('E_INPUT_SIDECAR'); }
    catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  // Finish/close this raw descriptor BEFORE opening SQLite in this process.
  // Closing any raw DB descriptor alongside a SQLite writer can drop POSIX locks.
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd, { bigint: true }), header = Buffer.alloc(100);
    if (st.dev !== before.dev || st.ino !== before.ino || st.size !== before.size) fail('E_INPUT_CHANGED');
    if (fs.readSync(fd, header, 0, header.length, 0) !== 100 || header.subarray(0,16).toString() !== 'SQLite format 3\0') fail('E_INPUT_HEADER');
    if (header[18] !== 1 || header[19] !== 1) fail('E_JOURNAL_MODE');
  } finally { fs.closeSync(fd); }
  return before;
}
const schemaRows = db => db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name').all();
const canonicalSchema = rows => rows.map(row => [row.type,row.name,row.tbl_name,row.sql?.replace(/\s+/g,' ').trim().replace(/;$/,'')]);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function metadataDigest(db) {
  const hash = createHash('sha256'); let key = null, count = 0;
  const first = db.prepare('SELECT key,value FROM meta ORDER BY key LIMIT 1');
  const next = db.prepare('SELECT key,value FROM meta WHERE key > ? ORDER BY key LIMIT 1');
  for (;;) {
    const row = key === null ? first.get() : next.get(key);
    if (!row) break;
    if (typeof row.key !== 'string') fail('E_SCHEMA');
    hash.update(JSON.stringify([row.key,row.value])); hash.update('\n'); key=row.key; count++;
  }
  return { hash: hash.digest('hex'), count };
}
const counts = db => Object.fromEntries(TABLES.map(table => [table, db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
const settings = db => Object.fromEntries(['journal_mode','synchronous','page_size','page_count','freelist_count','cache_size','cache_spill','temp_store','busy_timeout','user_version','auto_vacuum','secure_delete','locking_mode'].map(name => [name, Object.values(db.prepare(`PRAGMA ${name}`).get())[0]]));

async function probeChild(path) {
  if (typeof process.send !== 'function' || !runtimeSupported()) fail('E_PROBE_MODE');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 0; PRAGMA cache_size = -2048');
  const read = db.prepare('SELECT id FROM turns LIMIT 1');
  const sample = { attempts:0, readable:0, busy:0, firstBusyNs:null, lastBusyNs:null, longestObservedBusySpanMs:0, maxSampleGapMs:0, maxQueryMs:0, sampledSizes:{database:0,'-journal':0,'-wal':0,'-shm':0} };
  let previous=null, busyStart=null, timer, deadline, stopped=false;
  const take = () => {
    const start=now();
    if(previous!==null)sample.maxSampleGapMs=Math.max(sample.maxSampleGapMs,ms(start-previous));
    previous=start; sample.attempts++;
    try { read.get(); sample.readable++; busyStart=null; }
    catch(err) {
      if((Number(err.errcode)&255)!==5 && (Number(err.errcode)&255)!==6) throw err;
      sample.busy++;sample.firstBusyNs??=String(start);sample.lastBusyNs=String(start);busyStart??=start;
      sample.longestObservedBusySpanMs=Math.max(sample.longestObservedBusySpanMs,ms(start-busyStart));
    }
    sample.maxQueryMs=Math.max(sample.maxQueryMs,ms(now()-start));
    const measured=sizes(path);
    for(const name of Object.keys(measured))sample.sampledSizes[name]=Math.max(sample.sampledSizes[name],measured[name]);
  };
  const finish = reason => {
    if(stopped)return;stopped=true;clearInterval(timer);clearTimeout(deadline);
    db.close();process.send({type:'result',reason,sample},()=>{process.disconnect();});
  };
  take();
  if(sample.readable!==1)fail('E_PROBE_INITIAL_READ');
  process.send({type:'ready'});
  timer=setInterval(()=>{try{take();}catch{finish('read-failed');}},10);
  deadline=setTimeout(()=>finish('deadline'),600000);
  process.on('message',message=>{if(message?.type==='stop')finish('stopped');});
  process.on('disconnect',()=>{if(!stopped){stopped=true;clearInterval(timer);clearTimeout(deadline);db.close();}});
}
export async function startProbe(path) {
  const child=spawn(process.execPath,['--no-warnings',fileURLToPath(import.meta.url),'--private-read-probe',path],{
    env:{...(process.env.TMPDIR?{TMPDIR:process.env.TMPDIR}:{})},stdio:['ignore','ignore','ignore','ipc'],timeout:605000,killSignal:'SIGKILL',
  });
  let result=null, spawnFailed=false, readyResolve, readyReject, readyTimer;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const ended=new Promise(resolve=>{
    child.once('error',()=>{spawnFailed=true;readyReject(Object.assign(new Error(),{safeCode:'E_PROBE_SPAWN'}));});
    child.once('close',(code,signal)=>{clearTimeout(readyTimer);readyReject(Object.assign(new Error(),{safeCode:'E_PROBE_EXIT'}));resolve({code,signal});});
  });
  child.on('message',message=>{
    if(message?.type==='ready'){clearTimeout(readyTimer);readyResolve();}
    else if(message?.type==='result')result=message;
  });
  const terminate=async()=>{if(child.exitCode===null&&child.signalCode===null&&!spawnFailed)child.kill('SIGKILL');await ended;};
  readyTimer=setTimeout(()=>readyReject(Object.assign(new Error(),{safeCode:'E_PROBE_START_TIMEOUT'})),5000);
  try{await ready;}catch(err){clearTimeout(readyTimer);await terminate();throw err;}
  return {
    async stop(){
      if(child.connected)child.send({type:'stop'},()=>{});
      const kill=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},5000);
      const outcome=await ended;clearTimeout(kill);
      if(outcome.code!==0||outcome.signal||!['stopped','deadline'].includes(result?.reason)||!Number.isSafeInteger(result?.sample?.attempts))fail('E_PROBE_FAILED');
      return {...result.sample, coverageEnded:result.reason};
    },terminate,
  };
}
export async function run(path, mode) {
  if(!['original','optimized'].includes(mode))fail('E_MODE');
  if(!runtimeSupported())fail('E_RUNTIME');
  const identity=preflight(path);
  const { DatabaseSync } = await import('node:sqlite');
  let db,probe;
  try {
    // The disposable copy must remain exclusively operator-owned. SQLite's
    // pathname API cannot protect against an external replacement race.
    db=new DatabaseSync(path);
    const named=fs.lstatSync(path,{bigint:true});
    if(named.dev!==identity.dev||named.ino!==identity.ino)fail('E_INPUT_CHANGED');
    db.exec(CONNECTION_SETTINGS);
    const effective=settings(db);
    if(effective.user_version!==1||effective.journal_mode!=='delete')fail('E_SCHEMA');
    const expected=new DatabaseSync(':memory:');let expectedSchema;
    try{expected.exec(SCHEMA);expectedSchema=digest(canonicalSchema(schemaRows(expected)));}finally{expected.close();}
    const beforeSchema=digest(canonicalSchema(schemaRows(db)));
    if(beforeSchema!==expectedSchema)fail('E_SCHEMA');
    const beforeCounts=counts(db),beforeMetadata=metadataDigest(db),beforeSizes=sizes(path);
    const storage=fs.statfsSync(path,{bigint:true});
    probe=await startProbe(path);
    const exec=db.exec.bind(db);let beginStart,beginEnd,firstWriteStart,firstWriteEnd,commitStart,commitEnd;
    db.exec=sql=>{
      if(sql==='BEGIN')beginStart=now();
      if(sql==='DELETE FROM turns')firstWriteStart=now();
      if(sql==='COMMIT')commitStart=now();
      const result=exec(sql);
      if(sql==='BEGIN')beginEnd=now();
      if(sql==='DELETE FROM turns')firstWriteEnd=now();
      if(sql==='COMMIT')commitEnd=now();
      return result;
    };
    const wallStart=now();reset(db,mode);const wallEnd=now();
    const readProbe=await probe.stop();probe=null;
    const afterCounts=counts(db),afterMetadata=metadataDigest(db),after=settings(db);
    const integrity=db.prepare('PRAGMA quick_check(1)').get();
    if(Object.values(afterCounts).some(n=>n!==0)||after.user_version!==effective.user_version||
       digest(canonicalSchema(schemaRows(db)))!==beforeSchema||afterMetadata.hash!==beforeMetadata.hash||
       Object.values(integrity)[0]!=='ok')fail('E_POSTCHECK');
    const busyWithinReset=readProbe.firstBusyNs===null?null:{
      firstBusyAfterResetStartMs:ms(BigInt(readProbe.firstBusyNs)-wallStart),
      lastBusyAfterResetStartMs:ms(BigInt(readProbe.lastBusyNs)-wallStart),
    };
    delete readProbe.firstBusyNs;delete readProbe.lastBusyNs;
    return {
      success:true,mode,runtime:{node:process.version,sqlite:db.prepare('SELECT sqlite_version() AS version').get().version,platform:process.platform,arch:process.arch},
      settings:effective,afterSettings:after,filesystem:{type:String(storage.type),availableBytes:String(storage.bavail*storage.bsize)},
      beforeCounts,afterCounts,metadataRows:beforeMetadata.count,schemaPreserved:true,metadataPreserved:true,integrity:'quick_check(1): ok',
      beforeSizes,afterSizes:sizes(path),resetWallMs:ms(wallEnd-wallStart),transactionIntervalMs:ms(commitEnd-beginEnd),
      beginCallThroughCommitMs:ms(commitEnd-beginStart),commitCallMs:ms(commitEnd-commitStart),
      writeTransactionBoundsMs:{lower:Math.max(0,ms(commitStart-firstWriteEnd)),upper:ms(commitEnd-firstWriteStart)},
      readProbe:{...readProbe,...busyWithinReset,intervalTargetMs:10,deadlineMs:600000},
      qualification:{
        transaction:'BEGIN is deferred in BOTH modes. Transaction interval ends after COMMIT returns; it is not reader-exclusion time. First-write/commit call boundaries bound the write transaction, including acquisition uncertainty.',
        readerBlocking:'Separate read-only process samples SELECT id FROM turns LIMIT 1 with busy_timeout=0 every nominal 10ms. BUSY/LOCKED observations are not continuous EXCLUSIVE-lock measurements. PENDING can also exclude readers. Unobserved gaps/spikes and scheduler delays remain; probes can delay commit and add I/O/cache contention.',
        inspection:'Schema, metadata and table counts before reset warm caches and are excluded from timing. Post-counts/schema/metadata/quick_check are excluded too. Sampled sidecar peaks are lower bounds, not reserved-space estimates.',
        settings:'Connection settings match RecordIndex: busy_timeout=60000, cache_size=-2048, temp_store=FILE. No synchronous/journal-mode/transaction-mode changes; no VACUUM. Operator must budget rollback-journal and temp space.',
        scope:'Destructive disposable-copy measurement only. Sequential backups can differ; compare reported counts. Isolated reset time does not establish remaining budget in a 300-second service pass or Linux storage acceptance.',
      },
    };
  }finally{if(probe)await probe.terminate();if(db)db.close();}
}
const USAGE='DESTRUCTIVE SCRATCH-ONLY benchmark. Operator must supply a disposable SQLite .backup, never a live index. Usage: node scripts/benchmark-record-reset.mjs --ack-disposable-scratch <database-path> original|optimized. No backup is created; operator disposes of the supplied database. Requires Node 22.13+ (22.x), 23.2+ (23.x), or newer with node:sqlite.';
async function main(){
  const args=process.argv.slice(2);
  if(args[0]==='--private-read-probe'&&args.length===2){await probeChild(args[1]);return;}
  if(args.length!==3||args[0]!=='--ack-disposable-scratch'||!['original','optimized'].includes(args[2])){
    process.stderr.write(USAGE+'\n');fail('E_USAGE');
  }
  process.stdout.write(JSON.stringify(await run(args[1],args[2]))+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(err=>{process.stderr.write(JSON.stringify({success:false,code:err.safeCode??'E_BENCHMARK',message:'Benchmark refused or failed. No raw diagnostic is emitted; inspect only the disposable scratch database locally.'})+'\n');process.exitCode=1;});
}
