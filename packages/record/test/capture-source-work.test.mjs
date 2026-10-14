// Actual supervised worker integration for the source queue and run accounting.
// Fixtures explicitly stop at source-stage completion; index/discovery/service
// acceptance belongs to the full command scheduler tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DerivedState } from '../lib/derived-state.mjs';
import { CaptureSourceQueue } from '../lib/capture-source-queue.mjs';
import { RecordStore } from '../lib/store.mjs';
import { readCaptureStatus } from '../lib/capture-status.mjs';
import { CaptureRun } from '../lib/capture-run.mjs';
import { superviseCapturePass } from '../lib/capture-pass.mjs';
const url = name => new URL(`../lib/${name}.mjs`, import.meta.url).href;
const native = n => JSON.stringify({ timestamp:'2026-01-01T00:00:00Z',text:String(n) })+'\n';
const aw = (account,n) => JSON.stringify({ts:'2026-01-01T00:00:00Z',ch:'mail',dir:'recv',from:account,body:`${account} ${n}`})+'\n';

function fixture(t, specs) {
  const base=fs.mkdtempSync(join(tmpdir(),'source-work-')),root=join(base,'record'),workerPath=join(base,'worker.mjs');
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const inputs=specs.map(([source,name,text])=>{
    const path=join(base,name+'.jsonl');fs.writeFileSync(path,text);
    return {source,path,stream:source==='aw'?'fixture~aw':`fixture~${source}.${name}`};
  });
  const state=new DerivedState(root),q=new CaptureSourceQueue(state,{owner:'fixture',selection:'fixture'});
  q.add(inputs,null,{complete:true});state.close();
  fs.writeFileSync(workerPath,`
    import {writeFileSync} from 'node:fs';import {join} from 'node:path';
    import {runCaptureWorker} from ${JSON.stringify(url('capture-worker'))};
    import {RecordStore} from ${JSON.stringify(url('store'))};
    import {DerivedState} from ${JSON.stringify(url('derived-state'))};
    import {CaptureRun} from ${JSON.stringify(url('capture-run'))};
    import {CaptureSourceQueue} from ${JSON.stringify(url('capture-source-queue'))};
    import {captureSourceWork} from ${JSON.stringify(url('capture-source-work'))};
    import {reconcileCaptureInterruption} from ${JSON.stringify(url('capture-retry'))};
    await runCaptureWorker(start=>{
      // No store, admission or status publication exists for this attempt.
      if(start.options.failBeforeReceipt && start.pass.attempt===1)throw Error('injected pre-receipt failure');
      const state=new DerivedState(start.root),store=new RecordStore(start.root,{owner:'fixture'});
      try {
        const failure=reconcileCaptureInterruption(state,{reason:start.pass.previous?.reason??'interrupted',now:start.options.now});
        const run=new CaptureRun(start.root,state,{id:start.pass.runId,previousFailure:failure?.reason??null,
          currentFailure:start.pass.failure?{id:start.pass.runId,reason:start.pass.failure}:null});
        if(start.pass.finalize){const s=run.finish({outcome:'partial',reason:'deadline',pending:true});
          return {outcome:s.lastRun.outcome,reason:s.lastRun.reason,continuation:false};}
        const q=new CaptureSourceQueue(state,{owner:'fixture',selection:'fixture'});
        const append=store.appendUniqueBatch.bind(store);
        store.appendUniqueBatch=(stream,turns)=>{
          const n=append(stream,turns);
          if(stream===start.options.crashStream)process.kill(process.pid,'SIGKILL');
          return n;
        };
        for(let n=0;n<(start.options.units??2);n++){
          const r=captureSourceWork(store,state,q,run,start,{limit:start.options.limit??1,
            maxRecords:start.options.records??2,now:start.options.now});
          if(r.cleanup.length)throw Error('fixture unexpectedly requires retained cleanup');
          if(!r.selected){
            const pending=!!q.ready().next().value;
            const snapshot=run.finish({outcome:pending?'partial':'complete',reason:pending?'input':null,pending});
            return {outcome:snapshot.lastRun.outcome,reason:snapshot.lastRun.reason,continuation:false};
          }
        }
        run.publish({pending:true,peakRssBytes:start.budget.peakRssBytes});
        return {outcome:'partial',reason:'deadline',continuation:true};
      }catch(error){writeFileSync(join(start.root,'worker-error'),error.stack);throw error;}
      finally{state.close();}
    });
  `);
  return {root,inputs,store:new RecordStore(root,{owner:'fixture'}),
    run:options=>superviseCapturePass(root,{now:Date.now(),...options},{workerPath}),
    state(fn){const s=new DerivedState(root);try{return fn(s);}finally{s.close();}},
  };
}

test('source-stage workers rotate inputs, preserve unique visit counts and commit native/AW turns with run facts',async t=>{
  const f=fixture(t,[['aw','a',aw('a',1)+aw('a',2)],['aw','z',aw('z',1)+aw('z',2)],
    ['cc','native',native(1)+native(2)]]);
  const result=await f.run({units:2,records:2});assert.equal(result.outcome,'complete',JSON.stringify(result));
  assert.ok(result.starts>1,'source accounting continues through actual worker restarts');
  const status=readCaptureStatus(f.root);
  assert.equal(status.lastRun.counts.filesVisited,3);
  assert.equal(status.lastRun.counts.turnsAppended,6);
  assert.ok(status.lastProgressAt);assert.ok(status.lastRun.peakRssBytes>0);
  const turns=f.store.readStream('fixture~aw');
  for(const account of ['a','z'])assert.deepEqual(turns.filter(turn=>turn.from===account).map(turn=>turn.body.text),[1,2].map(n=>`${account} ${n}`));
  assert.equal(new Set(turns.map(turn=>turn.id)).size,4);
  assert.equal(f.store.readStream('fixture~cc.native').map(turn=>turn.body.line+'\n').join(''),native(1)+native(2));
  assert.equal(f.state(s=>s.get('capture-admission','active')),null);
});

test('killed group leaves unknown attribution, same-pass healthy progress, and due members resume singly without duplicates',async t=>{
  const f=fixture(t,[['cc','bad',native(1)],['cc','also',native(2)],['cc','healthy',native(3)]]);
  const result=await f.run({limit:2,records:4,units:4,crashStream:'fixture~cc.bad'});
  assert.equal(result.outcome,'failed');assert.equal(result.starts,2,'terminal failed receipt does not launch idle workers');
  let status=readCaptureStatus(f.root);
  assert.equal(status.lastRun.outcome,'failed');assert.equal(status.lastRun.reason,'interrupted');
  assert.equal(status.lastRun.counts.turnsAppended,1,'only committed healthy-unit counters are confirmed');
  assert.match(status.lastFailure.message,/not all physical journal writes/);
  assert.equal(f.store.readStream('fixture~cc.healthy').length,1,'healthy stream progresses in the same supervisor pass');
  assert.equal(f.store.readStream('fixture~cc.bad').length,1,'fsynced append survives its lost derived transaction');
  assert.equal(status.backlog.failedCount,0,'unknown group does not manufacture member failures');
  const deferred=f.state(s=>[...s.entries('capture-retry')].map(row=>row.value));
  assert.equal(deferred.length,2);assert.ok(deferred.every(row=>row.stage==='capture'));
  const nextDue=Math.max(...deferred.map(row=>Date.parse(row.nextRetryAt)));
  const resumed=await f.run({limit:2,records:4,units:4,now:nextDue+1});
  assert.equal(resumed.outcome,'complete',JSON.stringify(resumed));
  for(const name of ['bad','also','healthy']){
    const turns=f.store.readStream(`fixture~cc.${name}`);
    assert.equal(turns.length,1);assert.equal(new Set(turns.map(turn=>turn.id)).size,1);
  }
  status=readCaptureStatus(f.root);assert.equal(status.lastRun.outcome,'complete');
  assert.equal(status.backlog.pending,false);assert.equal(status.backlog.failedCount,0);
  assert.equal(status.lastRun.counts.turnsAppended,1,'the later run appends only the previously unattempted source, not the recovered existing turn');
  assert.ok(status.lastFailure,'prior run failure remains history after a successful later pass');
  assert.equal(f.state(s=>[...s.entries('capture-retry')].length),0);
});

test('input category/visit facts roll back with a failed processing transaction and resume once per run',t=>{
  const f=fixture(t,[['aw','a',aw('a',1)]]);
  f.state(state=>{
    const q=new CaptureSourceQueue(state,{owner:'fixture',selection:'fixture'});
    assert.throws(()=>state.transaction(()=>{
      assert.deepEqual(q.visit(1,'run',{inputsPending:true}),{filesVisited:1,inputsPending:1});
      throw Error('checkpoint failed');
    }),/checkpoint failed/);
    state.transaction(()=>{
      assert.deepEqual(q.visit(1,'run',{inputsPending:true}),{filesVisited:1,inputsPending:1});
      assert.deepEqual(q.visit(1,'run',{inputsPending:true}),{});
      assert.deepEqual(q.visit(1,'run',{inputsFailed:true}),{inputsFailed:1});
    });
  });
  f.state(state=>{
    const q=new CaptureSourceQueue(state,{owner:'fixture',selection:'fixture'});
    state.transaction(()=>{
      assert.deepEqual(q.visit(1,'run'),{});
      assert.deepEqual(q.visit(1,'new-run'),{filesVisited:1});
    });
  });
});

for(const olderSuccess of [false,true])test(`pre-receipt child failure stays failed after healthy same-pass work (older success: ${olderSuccess})`,async t=>{
  const f=fixture(t,[['cc','healthy',native(1)]]);
  let priorSuccess=null;
  if(olderSuccess)priorSuccess=f.state(state=>new CaptureRun(f.root,state,{id:'older-success'})
    .finish({outcome:'complete'}).lastSuccess);
  const result=await f.run({failBeforeReceipt:true,units:4});
  assert.equal(result.outcome,'failed');assert.equal(result.reason,'io');assert.equal(result.exitCode,1);
  assert.equal(result.starts,2);
  const status=readCaptureStatus(f.root);
  assert.equal(status.lastRun.outcome,'failed');assert.equal(status.lastRun.reason,'io');
  assert.equal(status.lastFailure.id,status.lastRun.id);
  assert.equal(status.lastRun.counts.turnsAppended,1);
  assert.equal(status.lastFailure.counts.turnsAppended,1);
  assert.deepEqual(status.lastSuccess,priorSuccess);
  assert.ok(status.lastProgressAt);
  assert.equal(f.store.readStream('fixture~cc.healthy').length,1);
  assert.equal(status.backlog.failedCount,0,'startup failure is not attributable to a stream');
});
