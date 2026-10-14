import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { superviseCapture } from "../lib/capture-supervisor.mjs";
import { RecordStore } from "../lib/store.mjs";
import { DerivedState } from "../lib/derived-state.mjs";
import { captureSessions } from "../lib/capture-cc.mjs";
import { retrySetAside } from "../lib/capture-state.mjs";
const url = name => new URL(`../lib/${name}.mjs`, import.meta.url).href;
const stamp = "2026-01-01T00:00:00Z", stream = "fixture~cc.session";
const native = n => JSON.stringify({ timestamp: stamp, text: String(n) }) + "\n";

function fixture(t, text) {
  const base = fs.mkdtempSync(join(tmpdir(), "native-unit-")), root = join(base, "record"), path = join(base, "session.jsonl"), workerPath = join(base, "worker.mjs");
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.writeFileSync(path, text);
  const store = new RecordStore(root, { owner: "fixture" }), key = `${stream}:${path}`;
  fs.writeFileSync(workerPath, `
    import fs from 'node:fs';import {join} from 'node:path';
    import {runCaptureWorker} from ${JSON.stringify(url("capture-worker"))};
    import {RecordStore} from ${JSON.stringify(url("store"))};
    import {DerivedState} from ${JSON.stringify(url("derived-state"))};
    import {withCaptureGroup} from ${JSON.stringify(url("capture-context"))};
    import {captureNativeUnit} from ${JSON.stringify(url("capture-native-unit"))};
    import {removeRetainedCaptureScratch} from ${JSON.stringify(url("capture-retained-scratch"))};
    import {discardRecoveryChunks} from ${JSON.stringify(url("capture-recovery-snapshot"))};
    import {discardTranscriptPrefix} from ${JSON.stringify(url("transcript-prefix"))};
    await runCaptureWorker(start=>{
      const {root,options}=start,store=new RecordStore(root,{owner:'fixture'}),state=new DerivedState(root);
      const stream=${JSON.stringify(stream)},key=${JSON.stringify(key)},work={journal:{},prefix:{}};
      try{
        const append=store.appendUniqueBatch.bind(store);
        store.appendUniqueBatch=(id,turns)=>{const n=append(id,turns);if(options.crashAppend)process.kill(process.pid,'SIGKILL');return n;};
        let ticks=0;
        const result=withCaptureGroup(store,[stream],()=>captureNativeUnit(store,{owner:'fixture',path:options.path,start,
          maxRecords:options.maxRecords??2,maxBytes:options.maxBytes??8388608,maxRecordBytes:options.maxRecordBytes??8388608,
          stopped:()=>options.stopAfter!==undefined&&++ticks>options.stopAfter,work}),{state});
        if(result.cleanup){
          const claim=state.get('recovery-allocation',key);
          removeRetainedCaptureScratch(root,state,key,start);
          if(options.crashCleanup)process.kill(process.pid,'SIGKILL');
          withCaptureGroup(store,[stream],()=>{
            state.set('recovery-garbage',claim.id,true);discardRecoveryChunks(state,claim.id);
            discardTranscriptPrefix(store,stream,key);
            state.delete('recovery-allocation',key);state.delete('recovery-stage',key);
          },{state});
        }
        fs.writeFileSync(join(root,'result'),JSON.stringify({result,work,job:state.get('native-unit',key),cursor:state.get('cc',key)}));
        return {outcome:result.complete?'complete':'partial',reason:result.complete?null:'deadline'};
      }catch(e){fs.writeFileSync(join(root,'error'),e.stack);throw e;}finally{state.close();}
    });
  `);
  const f = { root, path, store, key,
    state(fn) { const state = new DerivedState(root); try { return fn(state); } finally { state.close(); } },
    turns() { return store.readStream(stream); },
    async step(options = {}) {
      const outcome = await superviseCapture(root, { path, ...options }, { workerPath });
      if ((options.crashAppend || options.crashCleanup) && outcome.outcome === "failed") return { crashed: true };
      assert.notEqual(outcome.outcome, "failed", fs.existsSync(join(root,"error")) ? fs.readFileSync(join(root,"error"),"utf8") : JSON.stringify(outcome));
      return JSON.parse(fs.readFileSync(join(root,"result")));
    },
    async finish(options = {}) {
      const rows = [];
      for (let n = 0; n < 100; n++) {
        const row = await f.step(options); rows.push(row);
        if (row.result.complete || row.result.pending || row.result.setAside) return rows;
      }
      assert.fail("finite native input did not finish over bounded workers");
    },
    assertContent(text) {
      const turns = f.turns();
      assert.equal(turns.map(t => t.body.line + "\n").join(""), text);
      assert.equal(new Set(turns.map(t => t.id)).size, turns.length);
      assert.deepEqual(turns.map(t=>t.provenance.origin.line),turns.map((_,i)=>i+1));
    },
  };
  return f;
}

test("first capture timestamps unstamped prefixes backward over restarted bounded units; fresh no-op reads no content", async t => {
  const text = Array.from({length:9},(_,n)=>JSON.stringify({text:n})+'\n').join('')+native('stamp')+'\n'+native('last');
  const f=fixture(t,text),rows=await f.finish();
  assert.ok(rows.filter(r=>r.result.phase==='timestamp').length>=4);
  assert.ok(rows.every(r=>r.result.appended<=2));f.assertContent(text);
  assert.ok(f.turns().every(t=>t.ts===stamp));
  const noop=await f.step();assert.equal(noop.result.unchanged,true);assert.equal(noop.work.sourceBytes??0,0);assert.equal(noop.work.journal.bytes??0,0);
  fs.appendFileSync(f.path,native('growth'));const growth=await f.finish();f.assertContent(text+native('growth'));
  assert.equal(growth.reduce((n,r)=>n+r.result.appended,0),1);
  assert.equal(growth.reduce((n,r)=>n+(r.work.journal.bytes??0),0),0);
});

test("timestamp scan frontier survives pending EOF and later growth without rescanning the unstamped prefix", async t=>{
  const prefix=Array.from({length:20},(_,n)=>JSON.stringify({text:n})+'\n').join(''),f=fixture(t,prefix);
  const initial=await f.finish();assert.equal(initial.at(-1).result.pending,true);assert.equal(f.turns().length,0);
  const noop=await f.step();assert.equal(noop.result.pending,true);assert.equal(noop.work.sourceBytes??0,0);
  fs.appendFileSync(f.path,native('new'));
  const found=await f.step({maxRecords:1});assert.equal(found.job.lastTs,stamp);
  assert.equal(found.work.sourceBytes,Buffer.byteLength(native('new')),'stamp search seeks to the old frontier');
  await f.finish();f.assertContent(prefix+native('new'));
});

test("fixed source end yields before appended growth, with complete reconstruction on the next sweep",async t=>{
  const text=Array.from({length:8},(_,n)=>native(n)).join(''),f=fixture(t,text);
  await f.step();fs.appendFileSync(f.path,native('next sweep'));
  await f.finish();f.assertContent(text);
  await f.finish();f.assertContent(text+native('next sweep'));
});

test("cache-loss recovery compares all captured prefix before bounded new appends and keeps its stage after own appends",async t=>{
  const old=Array.from({length:9},(_,n)=>native(n)).join(''),f=fixture(t,old);
  assert.equal(captureSessions(f.store,{owner:'fixture',files:[f.path]}).appended,9);
  f.state(s=>s.delete('cc',f.key));const added=Array.from({length:7},(_,n)=>native('extra'+n)).join('');fs.appendFileSync(f.path,added);
  const rows=await f.finish({maxBytes:128});assert.ok(rows.length>10);f.assertContent(old+added);
  const firstAppend=rows.findIndex(r=>r.result.appended>0);assert.ok(firstAppend>5);
  assert.equal(rows.reduce((n,r)=>n+(r.work.prefix.journalRecords??0),0),9,'own appends must not restart prefix proof');
  assert.equal(rows.reduce((n,r)=>n+(r.work.prefix.sourceRecords??0),0),9);
  assert.equal(f.state(s=>s.get('recovery-allocation',f.key)),null);
});

test("late rewritten-prefix conflict after many workers forbids suffix; retry never waives conflict; ignore precedes missing source open",async t=>{
  const old=Array.from({length:9},(_,n)=>native(n)).join(''),f=fixture(t,old);captureSessions(f.store,{owner:'fixture',files:[f.path]});
  fs.writeFileSync(f.path,old.replace('"8"','"changed"')+native('new'));
  let rows=await f.finish({maxBytes:128});assert.equal(rows.at(-1).result.setAside.line,9);f.assertContent(old);
  retrySetAside(f.root);
  rows=await f.finish({maxBytes:128});assert.equal(rows.at(-1).result.setAside.line,9);f.assertContent(old);
  fs.writeFileSync(join(f.root,'ignore'),f.path+'\n');fs.unlinkSync(f.path);
  const ignored=await f.step();assert.equal(ignored.result.ignored,true);assert.equal(f.state(s=>s.get('set-aside',f.key)),null);
  fs.writeFileSync(join(f.root,'ignore'),'');fs.writeFileSync(f.path,old.replace('"8"','"changed"'));
  assert.equal((await f.finish({maxBytes:128})).at(-1).result.setAside.line,9);
});

test("durable append followed by killed source checkpoint revalidates and never duplicates physical turns",async t=>{
  const text=Array.from({length:6},(_,n)=>native(n)).join(''),f=fixture(t,text);
  assert.equal((await f.step({crashAppend:true,maxRecords:2})).crashed,true);assert.equal(f.turns().length,1);
  assert.equal(f.state(s=>s.get('cc',f.key)),null);
  await f.finish({maxBytes:128});f.assertContent(text);
});

test("torn and invalid UTF-8 suffixes stay pending; oversize is set aside before append and can be retried after restoration",async t=>{
  const text=native(0),f=fixture(t,text+'{"unfinished":');
  let rows=await f.finish();assert.equal(rows.at(-1).result.pending,true);f.assertContent(text);
  fs.appendFileSync(f.path,'true}\n');await f.finish();f.assertContent(text+'{"unfinished":true}\n');
  fs.appendFileSync(f.path,Buffer.from([255,10]));rows=await f.finish();assert.equal(rows.at(-1).result.reason,'invalid-utf8');
  fs.writeFileSync(f.path,text+'x'.repeat(300)+'\n');rows=await f.finish({maxRecordBytes:200});
  assert.equal(rows.at(-1).result.setAside.reason,'record-too-large');
  const restored=text+'{"unfinished":true}\n';fs.writeFileSync(f.path,restored);
  retrySetAside(f.root);
  await f.finish();f.assertContent(restored);assert.equal(f.state(s=>s.get('set-aside',f.key)),null);
});

test("worker restart after allocation removal completes only its committed cleanup and preserves captured cursor",async t=>{
  const text=native(0)+native(1),f=fixture(t,text);captureSessions(f.store,{owner:'fixture',files:[f.path]});
  f.state(s=>s.delete('cc',f.key));
  let crashed=false;
  for(let n=0;n<30;n++){if((await f.step({maxBytes:64,crashCleanup:true})).crashed){crashed=true;break;}}
  assert.equal(crashed,true);
  const claim=f.state(s=>s.get('recovery-allocation',f.key));assert.equal(claim.phase,'deleting');
  assert.equal(fs.existsSync(join(f.root,'.capture-tmp',claim.name)),false);
  assert.equal((await f.step()).result.cleanup,true);await f.finish();f.assertContent(text);
  assert.equal(f.state(s=>s.get('recovery-allocation',f.key)),null);
});

test("successful explicit retry keeps its generation after clearing the issue and finishes staged new suffix without repeating proof",async t=>{
  const old=Array.from({length:5},(_,n)=>native(n)).join(''),f=fixture(t,old);
  captureSessions(f.store,{owner:'fixture',files:[f.path]});
  fs.writeFileSync(f.path,old.replace('"4"','"changed"'));assert.ok((await f.finish({maxBytes:128})).at(-1).result.setAside);
  const added=Array.from({length:9},(_,n)=>native('extra'+n)).join('');fs.writeFileSync(f.path,old+added);retrySetAside(f.root);
  const generation=f.state(s=>s.get('source-retry',f.key));assert.equal(typeof generation,'string');
  const rows=await f.finish({maxBytes:128});f.assertContent(old+added);
  assert.equal(rows.reduce((n,r)=>n+(r.work.prefix.journalRecords??0),0),5);
  assert.equal(rows.reduce((n,r)=>n+(r.work.prefix.sourceRecords??0),0),5);
  assert.equal(f.state(s=>s.get('source-retry',f.key)),generation);
  assert.equal(f.state(s=>s.get('set-aside',f.key)),null);
});

test("killed staged append invalidates its journal generation, then revalidates rather than trusting the old ready proof",async t=>{
  const old=native(0)+native(1),f=fixture(t,old);captureSessions(f.store,{owner:'fixture',files:[f.path]});
  f.state(s=>s.delete('cc',f.key));const added=native(2)+native(3)+native(4);fs.appendFileSync(f.path,added);
  let crashed=false;
  for(let n=0;n<30;n++){if((await f.step({maxBytes:128,crashAppend:true})).crashed){crashed=true;break;}}
  assert.equal(crashed,true);assert.equal(f.turns().length,4);
  const after=await f.step({maxBytes:128});
  // Validation can precede retirement, but the old stage must never append
  // against the now-different exact journal generation.
  assert.equal(after.result.appended,0);
  await f.finish({maxBytes:128});f.assertContent(old+added);
});

test("retiring a changed payload revokes its private capture job before rebuilding or resuming a qualified cursor",async t=>{
  const old=native(0)+native(1),f=fixture(t,old);captureSessions(f.store,{owner:'fixture',files:[f.path]});
  f.state(s=>s.delete('cc',f.key));const added=Array.from({length:6},(_,n)=>native('extra'+n)).join('');fs.appendFileSync(f.path,added);
  let row;
  for(let n=0;n<30;n++){row=await f.step({maxBytes:128});if(row.result.appended)break;}
  assert.ok(row.job.snapshot);assert.ok(row.result.appended);
  const claim=f.state(s=>s.get('recovery-allocation',f.key)),payload=join(f.root,'.capture-tmp',claim.name,'payload');
  const fd=fs.openSync(payload,'r+');fs.writeSync(fd,Buffer.from('?'),0,1,0);fs.closeSync(fd);
  const retired=await f.step({maxBytes:128});assert.equal(retired.result.cleanup,true);
  assert.equal(f.state(s=>s.get('native-unit',f.key)),null);
  await f.finish({maxBytes:128});f.assertContent(old+added);
});
