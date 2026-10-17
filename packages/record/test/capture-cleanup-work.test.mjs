import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DerivedState } from '../lib/derived-state.mjs';
import { captureCleanupPage } from '../lib/capture-cleanup-work.mjs';
import { superviseCapture } from '../lib/capture-supervisor.mjs';

const stream='fixture~cc.finished', key='finished-source', url=name=>new URL(`../lib/${name}.mjs`,import.meta.url).href;
function fixture(t) {
  const root=fs.mkdtempSync(join(tmpdir(),'cleanup-work-')), workerPath=join(root,'worker.mjs');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(workerPath,`
    import fs from 'node:fs';import {join} from 'node:path';import {syncBuiltinESMExports} from 'node:module';
    import {runCaptureWorker} from ${JSON.stringify(url('capture-worker'))};
    import {RecordStore} from ${JSON.stringify(url('store'))};
    import {DerivedState} from ${JSON.stringify(url('derived-state'))};
    import {withCaptureGroup} from ${JSON.stringify(url('capture-context'))};
    import {createRetainedCaptureScratch,prepareRetainedCaptureCleanup} from ${JSON.stringify(url('capture-retained-scratch'))};
    import {captureCleanupPage,cleanupCaptureRecovery} from ${JSON.stringify(url('capture-cleanup-work'))};
    await runCaptureWorker(start=>{
      const {root,options}=start,state=new DerivedState(root),store=new RecordStore(root,{owner:'fixture'});
      const key=${JSON.stringify(key)},stream=${JSON.stringify(stream)};
      try {
        if(options.create){
          withCaptureGroup(store,[stream],()=>{
            const allocation=createRetainedCaptureScratch(store,stream,key,start);
            try {
              fs.writeFileSync(join(root,'allocation-path'),allocation.path);
              fs.writeSync(allocation.fd,Buffer.from('proof'));fs.fsyncSync(allocation.fd);
              state.set('recovery-stage',key,{allocation:allocation.claim.id});
              state.set('recovery-garbage',allocation.claim.id,true);
              state.set('prefix-proof',key,{stream});
              // Existing committed source state must survive housekeeping.
              state.set('cc',key,{bytes:123,line:7});
              state.db.exec('CREATE TABLE recovery_chunks (allocation TEXT, offset INTEGER, length INTEGER, hash TEXT, PRIMARY KEY(allocation,offset));'+
                'CREATE TABLE transcript_prefix (job TEXT, line INTEGER, hash TEXT, PRIMARY KEY(job,line))');
              for(let n=0;n<7;n++)state.db.prepare('INSERT INTO recovery_chunks VALUES (?,?,1,?)').run(allocation.claim.id,n,'hash');
              for(let n=0;n<5;n++)state.db.prepare('INSERT INTO transcript_prefix VALUES (?,?,?)').run(key,n,'hash');
            }finally{allocation.close();}
            if(!options.active)prepareRetainedCaptureCleanup(store,stream,key,start);
          },{state});
          return {outcome:'complete',reason:null};
        }
        const path=fs.readFileSync(join(root,'allocation-path'),'utf8');
        if(options.crashAfterRemove){
          const remove=fs.rmSync;fs.rmSync=(name,...args)=>{
            const result=remove(name,...args);if(name===path)process.kill(process.pid,'SIGKILL');return result;
          };syncBuiltinESMExports();
        }
        if(options.failFinalize){
          const remove=state.delete.bind(state);state.delete=(kind,...args)=>{
            if(kind==='recovery-allocation')throw Error('injected metadata commit failure');return remove(kind,...args);
          };
        }
        const job=captureCleanupPage(state).jobs[0] ?? {key,stream,allocation:state.get('recovery-allocation',key)?.id};
        if(options.wrongAllocation)job.allocation='0'.repeat(32);
        const result=cleanupCaptureRecovery(store,state,options.invalidWorker?{...start,workerNonce:'invalid'}:start,job,{
          maxRecords:options.maxRecords??2000,
          stopped:()=>start.budget.sample()!==null || options.stopAfterRemove&&!fs.existsSync(path),
        });
        fs.writeFileSync(join(root,'result'),JSON.stringify(result));
        return {outcome:result.complete?'complete':'partial',reason:result.complete?null:'deadline'};
      }catch(error){fs.writeFileSync(join(root,'error'),error.message);throw error;}
      finally{state.close();}
    });
  `);
  return {root,run:options=>superviseCapture(root,options,{workerPath}),
    state(fn){const state=new DerivedState(root);try{return fn(state);}finally{state.close();}},
    path:()=>fs.readFileSync(join(root,'allocation-path'),'utf8'),
    rows(){return this.state(s=>Number(s.db.prepare('SELECT count(*) AS n FROM recovery_chunks').get().n)+
      Number(s.db.prepare('SELECT count(*) AS n FROM transcript_prefix').get().n));},
  };
}
async function complete(f,options){
  const result=await f.run(options);
  assert.equal(result.outcome,'complete',fs.existsSync(join(f.root,'error'))?fs.readFileSync(join(f.root,'error'),'utf8'):JSON.stringify(result));
}

test('retained cleanup resumes bounded hash deletion across actual workers without source re-selection',async t=>{
  const f=fixture(t);await complete(f,{create:true});
  const before=f.state(s=>s.get('cc',key));
  let previous=f.rows(),finished=false;
  assert.equal(previous,12);
  for(let n=0;n<8;n++){
    const result=await f.run({maxRecords:4});
    assert.notEqual(result.outcome,'failed');
    const remaining=f.rows();assert.ok(previous-remaining<=4,'both tables share one row allowance');
    assert.ok(remaining<previous || remaining===0,'each bounded unit advances or finalizes');
    assert.equal(fs.existsSync(f.path()),false);
    assert.deepEqual(f.state(s=>s.get('cc',key)),before);
    if(result.outcome==='complete'){finished=true;break;}
    assert.equal(f.state(s=>s.get('recovery-allocation',key)).phase,'deleting');
    assert.equal(f.state(s=>captureCleanupPage(s).jobs.length),1,'a completed source is not needed to rediscover cleanup');
    previous=remaining;
  }
  assert.equal(finished,true);assert.equal(f.rows(),0);
  for(const kind of ['recovery-allocation','recovery-stage','recovery-garbage','prefix-proof'])
    assert.equal(f.state(s=>[...s.entries(kind)].length),0);
  assert.deepEqual(f.state(s=>captureCleanupPage(s).jobs),[]);
});

for(const failure of ['crashAfterRemove','stopAfterRemove','failFinalize'])
  test(`retained cleanup preserves its reference across ${failure}`,async t=>{
    const f=fixture(t);await complete(f,{create:true});
    const id=f.state(s=>s.get('recovery-allocation',key).id);
    const result=await f.run({[failure]:true});
    assert.equal(result.outcome,failure==='stopAfterRemove'?'partial':'failed');
    assert.equal(fs.existsSync(f.path()),false);
    assert.equal(f.rows(),12,'uncommitted hash deletion cannot become progress');
    assert.equal(f.state(s=>s.get('recovery-allocation',key)).id,id);
    await complete(f,{});
    assert.equal(f.state(s=>s.get('recovery-allocation',key)),null);assert.equal(f.rows(),0);
    assert.deepEqual(f.state(s=>s.get('cc',key)),{bytes:123,line:7});
  });

test('cleanup refuses active, stale, wrong-worker and replaced allocations without removing them',async t=>{
  const active=fixture(t);await complete(active,{create:true,active:true});
  assert.equal((await active.run({})).outcome,'failed');assert.equal(fs.existsSync(active.path()),true);
  assert.equal(active.state(s=>s.get('recovery-allocation',key)).phase,'active');
  const f=fixture(t);await complete(f,{create:true});
  for(const options of [{wrongAllocation:true},{invalidWorker:true}]){
    assert.equal((await f.run(options)).outcome,'failed');assert.equal(fs.existsSync(f.path()),true);assert.equal(f.rows(),12);
  }
  fs.renameSync(f.path(),f.path()+'.preserved');fs.mkdirSync(f.path(),{mode:0o700});
  fs.writeFileSync(join(f.path(),'unknown'),'preserve');
  assert.equal((await f.run({})).outcome,'failed');
  assert.equal(fs.readFileSync(join(f.path(),'unknown'),'utf8'),'preserve');
  assert.equal(fs.existsSync(f.path()+'.preserved'),true);assert.equal(f.rows(),12);
});

test('cleanup inventory pages are bounded through active jobs and resume from a saved key',t=>{
  const root=fs.mkdtempSync(join(tmpdir(),'cleanup-page-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const open=fn=>{const state=new DerivedState(root);try{return fn(state);}finally{state.close();}};
  open(state=>state.transaction(()=>{
    for(let n=0;n<260;n++)state.set('recovery-allocation',String(n).padStart(4,'0'),{
      id:n.toString(16).padStart(32,'0'),stream:'fixture~cc.finished',phase:n===259?'deleting':'active',
    });
  }));
  for(const count of [128,128,4])open(state=>{
    const page=captureCleanupPage(state,{after:state.get('fixture','after')??''});
    assert.equal(page.scanned,count);assert.equal(page.complete,count===4);
    assert.equal(page.jobs.length,count===4?1:0);
    state.transaction(()=>state.set('fixture','after',page.after));
  });
  open(state=>{
    assert.throws(()=>captureCleanupPage(state,{limit:129}),/invalid capture cleanup page/);
    assert.equal(captureCleanupPage(state,{after:'0259'}).complete,true);
  });
});
