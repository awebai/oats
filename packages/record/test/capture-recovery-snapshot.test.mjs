import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { superviseCapture } from "../lib/capture-supervisor.mjs";
import { acquireCaptureLock } from "../lib/capture-lock.mjs";
import { cleanupCaptureScratch } from "../lib/capture-scratch.mjs";
import { RecordStore } from "../lib/store.mjs";
import { DerivedState } from "../lib/derived-state.mjs";
import { captureSessions } from "../lib/capture-cc.mjs";
const stream = "fixture~cc.session", key = "fixture-job";
const url = name => new URL(`../lib/${name}.mjs`, import.meta.url).href;
const native = n => JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", text: `${n}:${"x".repeat(80)}` });

function fixture(t, count = 8) {
  const base = fs.mkdtempSync(join(tmpdir(), "recovery-snapshot-")), root = join(base, "record"), source = join(base, "session.jsonl"), workerPath = join(base, "worker.mjs");
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const store = new RecordStore(root, { owner: "fixture" });
  fs.writeFileSync(source, Array.from({ length: count }, (_, n) => native(n)).join("\n") + "\n");
  assert.equal(captureSessions(store, { owner: "fixture", files: [source] }).appended, count);
  fs.writeFileSync(workerPath, `
    import fs from 'node:fs';import {join} from 'node:path';
    import {runCaptureWorker} from ${JSON.stringify(url("capture-worker"))};
    import {RecordStore} from ${JSON.stringify(url("store"))};
    import {DerivedState} from ${JSON.stringify(url("derived-state"))};
    import {withCaptureGroup} from ${JSON.stringify(url("capture-context"))};
    import {advanceRecoverySnapshot,discardRecoveryChunks} from ${JSON.stringify(url("capture-recovery-snapshot"))};
    import {advanceTranscriptPrefix} from ${JSON.stringify(url("transcript-prefix"))};
    import {removeRetainedCaptureScratch} from ${JSON.stringify(url("capture-retained-scratch"))};
    import {bufferLines} from ${JSON.stringify(url("file-lines"))};
    import {finishTurn} from ${JSON.stringify(url("canonical"))};
    import {eventTurnCore} from ${JSON.stringify(url("capture-cc"))};
    await runCaptureWorker(start=>{
      const {root,options}=start,store=new RecordStore(root,{owner:'fixture'}),state=new DerivedState(root);
      const key=${JSON.stringify(key)},stream=${JSON.stringify(stream)},work={};let output;
      try {
        withCaptureGroup(store,[stream],()=>{
          const staged=advanceRecoverySnapshot(store,stream,key,options.source,start,{generation:options.generation??'',maxBytes:options.maxBytes??256,maxRecordBytes:options.maxRecordBytes??8388608,work});
          try {
            output={stageComplete:staged.complete,cleanup:staged.cleanup??false,issue:staged.issue??null,reason:staged.reason??null,work};
            if(staged.complete){
              output.size=staged.snapshot.size;
              const prefixWork={};output.prefixWork=prefixWork;
              const proof=advanceTranscriptPrefix(store,stream,{key,snapshot:staged.snapshot,maxRecords:2,work:prefixWork,
                *lines(from){for(const line of bufferLines(staged.snapshot.chunks(from))){if(line.at(-1)!==10)return;yield {text:line.subarray(0,-1).toString('utf8'),bytes:line.length};}}
              });
              output.proof=proof;staged.verify();
              if(proof.complete){
                let line=proof.line,ts=proof.lastTs;
                for(const raw of bufferLines(staged.snapshot.chunks(proof.bytes))){
                  if(raw.at(-1)!==10)break;const text=raw.subarray(0,-1).toString('utf8');
                  store.appendUniqueBatch(stream,[finishTurn(eventTurnCore({owner:'fixture',source:'cc',sessionId:'session',line:text,lineNo:++line,ts}))]);
                }
              }
            }
          } finally {
            staged.close?.();
            if(staged.close){const sentinel=fs.openSync(join(root,'fd-sentinel'),'w');try{staged.close();fs.writeSync(sentinel,'still open');}finally{fs.closeSync(sentinel);}}
          }
          if(options.crash)process.kill(process.pid,'SIGKILL');
        },{state});
        if(output.cleanup){
          const allocation=state.get('recovery-allocation',key).id;
          removeRetainedCaptureScratch(root,state,key,start);
          state.transaction(()=>{
            state.set('recovery-garbage',allocation,true);discardRecoveryChunks(state,allocation);
            state.delete('recovery-allocation',key);state.delete('recovery-stage',key);
          });
        }
        output.stage=state.get('recovery-stage',key);
        fs.writeFileSync(join(root,'result'),JSON.stringify(output));
        return {outcome:output.proof?.complete?'complete':'partial',reason:output.proof?.complete?null:'deadline'};
      } catch(error){fs.writeFileSync(join(root,'error'),error.message);throw error;}
      finally{state.close();}
    });
  `);
  const f = { root, source, store,
    state(fn) { const state = new DerivedState(root); try { return fn(state); } finally { state.close(); } },
    async step(options = {}) {
      const result = await superviseCapture(root, { source, ...options }, { workerPath });
      if (options.crash) { assert.equal(result.outcome, "failed"); return null; }
      assert.notEqual(result.outcome, "failed", fs.existsSync(join(root, "error")) ? fs.readFileSync(join(root, "error"), "utf8") : JSON.stringify(result));
      const lock = acquireCaptureLock(root); try { assert.equal(cleanupCaptureScratch(root, lock), 0); } finally { assert.equal(lock.release().released, true); }
      return JSON.parse(fs.readFileSync(join(root, "result")));
    },
    async finish(options = {}) {
      const rows = [];
      for (let n = 0; n < 50; n++) {
        const row = await f.step(options); rows.push(row);
        if (row.proof?.complete || row.proof?.conflict || row.issue) return rows;
      }
      assert.fail('finite staged proof did not complete');
    },
  };
  return f;
}

test("actual workers/scavenging finish staged comparison and append only after complete prefix proof", async t => {
  const f = fixture(t); fs.appendFileSync(f.source, native(8) + "\n");
  const rows = await f.finish(); assert.ok(rows.length > 8);
  assert.equal(rows.at(-1).proof.complete, true);
  assert.equal(rows.reduce((n,r)=>n+(r.prefixWork?.journalRecords??0),0), 8);
  assert.equal(rows.reduce((n,r)=>n+(r.prefixWork?.sourceRecords??0),0), 8);
  assert.equal(rows.reduce((n,r)=>n+(r.work.sourceBytes??0),0), fs.statSync(f.source).size);
  const turns = f.store.readStream(stream); assert.equal(turns.length, 9); assert.equal(new Set(turns.map(t=>t.id)).size, 9);
  assert.equal(turns.map(t=>t.body.line+'\n').join(''), fs.readFileSync(f.source,'utf8'));
});

test("late conflict after resumed staging/comparison workers appends no suffix", async t => {
  const f = fixture(t), lines = Array.from({ length: 8 }, (_, n) => native(n)); lines[7] = native('changed');
  fs.writeFileSync(f.source, lines.join('\n')+'\n'+native('new')+'\n');
  const rows = await f.finish(); assert.ok(rows.length > 8);
  assert.equal(rows.at(-1).proof.conflict.line, 8); assert.equal(f.store.readStream(stream).length, 8);
});

test("killed staging commit discards suffix and validates committed chunks over workers before continuing", async t => {
  const f = fixture(t); const first = await f.step(); assert.equal(first.stage.copied, 256);
  await f.step({ crash: true });
  const allocation = f.state(s=>s.get('recovery-allocation',key));
  const payload = join(f.root,'.capture-tmp',allocation.name,'payload'); assert.equal(fs.statSync(payload).size, 512);
  const validated = await f.step({ maxBytes: 128 });
  assert.equal(validated.stage.copied, 256); assert.equal(validated.work.sourceBytes??0, 0);
  assert.equal(validated.work.stagedReadBytes, 256); assert.equal(fs.statSync(payload).size, 256);
  const rows = await f.finish(); assert.equal(rows.at(-1).proof.complete, true); assert.equal(f.store.readStream(stream).length, 8);
});

test("source growth preserves fixed staged end; observed replacement safely retires and rebuilds", async t => {
  const f = fixture(t), size = fs.statSync(f.source).size; await f.step();
  fs.appendFileSync(f.source,native(8)+'\n');
  const grown = await f.finish(); assert.equal(grown.at(-1).size,size); assert.equal(f.store.readStream(stream).length,8);
  const text=fs.readFileSync(f.source);fs.unlinkSync(f.source);fs.writeFileSync(f.source,text);
  const changed=await f.step();assert.equal(changed.cleanup,true);assert.equal(changed.reason,'recovery-source-changed');
  const rebuilt=await f.finish();assert.equal(rebuilt.at(-1).proof.complete,true);assert.equal(f.store.readStream(stream).length,9);
});

test("lost chunk cache and modified payload cannot qualify prior stage; bounded rebuild restores equality", async t => {
  const f = fixture(t);await f.step();
  f.state(s=>s.db.exec('DROP TABLE recovery_chunks'));
  assert.equal((await f.step()).cleanup,true);await f.step();
  const allocation=f.state(s=>s.get('recovery-allocation',key)),payload=join(f.root,'.capture-tmp',allocation.name,'payload');
  const fd=fs.openSync(payload,'r+');fs.writeSync(fd,Buffer.from('?'),0,1,0);fs.closeSync(fd);
  const changed=await f.step();assert.equal(changed.cleanup,true);assert.equal(changed.reason,'recovery-payload-changed');
  assert.equal((await f.finish()).at(-1).proof.complete,true);assert.equal(f.store.readStream(stream).length,8);
});

test("oversized raw record is identified during chunk copying before whole-record allocation or append", async t => {
  const f = fixture(t), offset=fs.statSync(f.source).size;fs.appendFileSync(f.source,'x'.repeat(8192)+'\n');
  const rows=await f.finish({maxBytes:128,maxRecordBytes:200}), last=rows.at(-1);
  assert.deepEqual(last.issue,{offset,line:9,reason:'record-too-large',limit:200});
  assert.ok(rows.reduce((n,r)=>n+(r.work.sourceBytes??0),0)<offset+8192);
  assert.equal(f.store.readStream(stream).length,8);assert.equal(f.state(s=>s.get('recovery-allocation',key)),null);
});

test("reset generation rejects a prior partial snapshot and reveals a rewrite outside its growth witness", async t => {
  const f=fixture(t,48);assert.equal((await f.step({maxBytes:5000})).stage.copied,5000);
  const original=fs.readFileSync(f.source,'utf8');
  fs.writeFileSync(f.source,original.replace('"text":"0:','"text":"Y:')+native('later')+'\n');
  const reset=await f.step({generation:'reset-one',maxBytes:5000});
  assert.equal(reset.cleanup,true);assert.equal(reset.reason,'recovery-generation-changed');
  const rows=await f.finish({generation:'reset-one',maxBytes:5000});
  assert.equal(rows.at(-1).proof.conflict.line,1);assert.equal(f.store.readStream(stream).length,48);
});

test("a public writer between workers invalidates the old staged end before comparing its longer journal", async t => {
  const f=fixture(t);await f.step();fs.appendFileSync(f.source,native(8)+'\n');
  assert.equal(captureSessions(f.store,{owner:'fixture',files:[f.source]}).appended,1);
  const changed=await f.step();assert.equal(changed.cleanup,true);assert.equal(changed.reason,'recovery-journal-changed');
  const rows=await f.finish();assert.equal(rows.at(-1).proof.complete,true);
  assert.equal(f.store.readStream(stream).length,9);assert.equal(rows.at(-1).proof.line,9);
});
