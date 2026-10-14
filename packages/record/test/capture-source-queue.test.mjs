// Small deterministic command-inventory tests. These exercise the queue with
// real capture units; final supervisor/deadline qualification is separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { DerivedState, fileVersion } from '../lib/derived-state.mjs';
import { CaptureSourceQueue } from '../lib/capture-source-queue.mjs';
import { RecordStore } from '../lib/store.mjs';
import { captureAwUnit } from '../lib/capture-aw-unit.mjs';
import { withCaptureGroup } from '../lib/capture-context.mjs';
import { reconcileCaptureInterruption } from '../lib/capture-retry.mjs';
const url=name=>new URL(`../lib/${name}.mjs`,import.meta.url).href;
const line=(account,n)=>JSON.stringify({ts:'2026-01-01T00:00:00Z',ch:'mail',dir:'recv',from:account,body:`${account} ${n}`})+'\n';
function fixture(t){
 const root=fs.mkdtempSync(join(tmpdir(),'source-queue-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 return root;
}
const input=(root,n,{source='cc',stream=`fixture~cc.s${n}`}={})=>({source,path:join(root,`s${n}.jsonl`),stream});
const queue=state=>new CaptureSourceQueue(state,{owner:'fixture',selection:'fixture-selection'});

function ingest(state,q,inputs){
 for(let n=0;n<inputs.length;n+=128)q.add(inputs.slice(n,n+128),{after:n+128},{complete:n+128>=inputs.length});
}

test('discovery pages/checkpoints are atomic, replay does not renumber, and reopened queue retains progress',t=>{
 const root=fixture(t);let state=new DerivedState(root),q=queue(state);
 const items=[input(root,1),input(root,2)];
 q.add(items,{after:'two'});
 const id=q.sweep.id;
 assert.throws(()=>state.transaction(()=>{q.add([input(root,3)],{after:'three'});throw Error('crash before commit');}),/crash/);
 assert.equal(state.get('source-sweep','fixture').next,3);
 state.close();state=new DerivedState(root);q=queue(state);
 try{
  assert.equal(q.sweep.id,id);assert.deepEqual(q.current().discovery,{after:'two'});
  q.add(items,{after:'replay'});q.add([input(root,3)],{after:'three'},{complete:true});
  assert.deepEqual([...q.ready()].map(r=>r.position),[1,2,3]);
  state.transaction(()=>q.mark(1,'complete'));
  assert.deepEqual([...q.ready()].map(r=>r.position),[2,3]);
  assert.throws(()=>q.mark(2,'complete'),/processing transaction/);
  assert.equal(state.transaction(()=>q.finish()),false);
  state.transaction(()=>{q.mark(2,'pending');q.mark(3,'set-aside');assert.equal(q.finish(),true);});
  const next=queue(state);assert.notEqual(next.sweep.id,id,'finished visits cause a new sweep, not invented full success');
 }finally{state.close();}
});

test('native same-stream sources preserve original precedence while AW sources may rotate',t=>{
 const root=fixture(t),state=new DerivedState(root),q=queue(state);
 try{
  ingest(state,q,[input(root,1,{stream:'fixture~cc.same'}),input(root,2,{stream:'fixture~cc.same'}),
    input(root,3,{source:'aw',stream:'fixture~aw'}),input(root,4,{source:'aw',stream:'fixture~aw'}),input(root,5)]);
  assert.deepEqual([...q.ready()].map(r=>r.position),[1,3,4,5]);
  state.transaction(()=>state.set('capture-schedule','position:capture',{stage:'capture',after:q.cursor(3)}));
  assert.deepEqual([...q.ready()].map(r=>r.position),[4,5,1,3]);
  state.transaction(()=>q.mark(1,'pending'));
  assert.deepEqual([...q.ready()].map(r=>r.position),[4,5,2,3],'a native pending/refusal boundary permits the later original source');
 }finally{state.close();}
});

test('large metadata inventory is read in bounded pages and old-scope cleanup never erases another owner',t=>{
 const root=fixture(t),state=new DerivedState(root),q=queue(state);
 try{
  ingest(state,q,Array.from({length:300},(_,i)=>input(root,i)));
  let stopped=false,visited=0;const work={},iterator=q.ready({stopped:()=>stopped,work});
  for(const row of iterator){visited++;assert.equal(row.position,visited);if(visited===3)stopped=true;}
  assert.equal(visited,3);assert.equal(work.inventoryRows,128);
  const other=new CaptureSourceQueue(state,{owner:'other',selection:'other'});
  other.add([{...input(root,'other'),stream:'other~cc.x'}],null,{complete:true});
  const replacement=new CaptureSourceQueue(state,{owner:'fixture',selection:'changed-selection'});
  const counts=[];for(let n=0;n<4;n++)counts.push(state.transaction(()=>replacement.cleanup()));
  assert.deepEqual(counts,[128,128,44,0]);assert.equal([...other.ready()].length,1);
  assert.equal([...replacement.ready()].length,0);
 }finally{state.close();}
});

test('loss of only the inventory table invalidates discovery, not journal/source state',t=>{
 const root=fixture(t),state=new DerivedState(root);
 try{
  const q=queue(state);q.add([input(root,1)],{after:'all'},{complete:true});
  state.set('cc','preserved',{bytes:123});state.db.exec('DROP TABLE capture_sources');
  const replacement=queue(state);assert.notEqual(replacement.sweep.id,q.sweep.id);
  assert.equal(replacement.current().discovered,false);assert.equal(replacement.current().discovery,null);
  assert.deepEqual(state.get('cc','preserved'),{bytes:123});
 }finally{state.close();}
});

test('fresh one-batch workers rotate shared AW files durably while growth belongs to later work',t=>{
 const root=fixture(t),paths=['a','z'].map(a=>join(root,`${a}.jsonl`));
 for(const [i,path]of paths.entries())fs.writeFileSync(path,[0,1,2].map(n=>line(i?'z':'a',n)).join(''));
 let state=new DerivedState(root);const q=queue(state);q.add(paths.map(path=>({source:'aw',path,stream:'fixture~aw'})),null,{complete:true});state.close();
 const child=join(root,'child.mjs');fs.writeFileSync(child,`
  import {DerivedState,fileVersion} from ${JSON.stringify(url('derived-state'))};
  import {CaptureSourceQueue} from ${JSON.stringify(url('capture-source-queue'))};
  import {RecordStore} from ${JSON.stringify(url('store'))};
  import {withCaptureGroup} from ${JSON.stringify(url('capture-context'))};
  import {captureAwUnit} from ${JSON.stringify(url('capture-aw-unit'))};
  const root=process.argv[2],state=new DerivedState(root),store=new RecordStore(root,{owner:'fixture'});
  try{const q=new CaptureSourceQueue(state,{owner:'fixture',selection:'fixture-selection'}),input=q.ready().next().value;
   if(!input)throw Error('missing ready input');
   const generation=fileVersion(store.journalPath(input.stream));
   const r=withCaptureGroup(store,[input.stream],()=>{
    const r=captureAwUnit(store,{owner:'fixture',path:input.path,maxRecords:1});
    if(r.complete||r.pending)q.mark(input.position,r.complete?'complete':'pending');return r;
   },{state,admission:{runId:'run-'+process.pid,stage:'capture',next:input.next,members:[{stream:input.stream,offset:generation?.size??0,generation}]}});
   // Intervening index-stage admission must not reset capture-stage position.
   state.transaction(()=>state.set('capture-schedule','position',{stage:'index',after:'another-stream'}));
   console.log(JSON.stringify({position:input.position,...r}));
  }finally{state.close();}
 `);
 const rows=[];
 for(let n=0;n<6;n++){
  const r=spawnSync(process.execPath,['--max-old-space-size=256',child,root],{env:process.env,encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
  assert.equal(r.status,0,r.stderr);rows.push(JSON.parse(r.stdout));
  if(n===1)fs.appendFileSync(paths[0],line('a',3));
 }
 assert.deepEqual(rows.map(r=>r.position),[1,2,1,2,1,2],'private queue fixture order; not a public rotation-sequence promise');
 assert.equal(rows.reduce((n,r)=>n+r.appended,0),6);
 const store=new RecordStore(root,{owner:'fixture'}),turns=store.readStream('fixture~aw');
 for(const account of ['a','z'])assert.deepEqual(turns.filter(t=>t.from===account).map(t=>t.body.text),[0,1,2].map(n=>`${account} ${n}`));
 assert.equal(new Set(turns.map(t=>t.id)).size,6);
 state=new DerivedState(root);
 try{const resumed=queue(state);assert.equal([...resumed.ready()].length,0);state.transaction(()=>assert.equal(resumed.finish(),true));}
 finally{state.close();}
});

test('failed append rolls back queue outcomes but durable admission keeps rotation and stream-scoped interruption',t=>{
 const root=fixture(t),store=new RecordStore(root,{owner:'fixture'}),state=new DerivedState(root),q=queue(state);
 const paths=['a','z'].map(a=>join(root,`${a}.jsonl`));for(const path of paths)fs.writeFileSync(path,line('a',0));
 try{
  q.add(paths.map(path=>({source:'aw',path,stream:'fixture~aw'})),null,{complete:true});
  const selected=q.ready().next().value;
  store.appendUniqueBatch=()=>{throw Error('injected append failure');};
  assert.throws(()=>withCaptureGroup(store,['fixture~aw'],()=>{
   q.mark(selected.position,'complete');captureAwUnit(store,{owner:'fixture',path:selected.path,maxRecords:1});
  },{state,admission:{runId:'failed-run',stage:'capture',next:selected.next,members:[{stream:'fixture~aw',offset:0,generation:null}]}}),/injected/);
  assert.deepEqual([...q.ready()].map(r=>r.position),[2,1]);
  const failure=reconcileCaptureInterruption(state,{now:1000});assert.equal(failure.memberCount,1);
  assert.equal(state.get('capture-failed','fixture~aw').offset,0);
  assert.equal([...state.entries('capture-retry')].length,1,'both accounts share one deferred stream, not independent writers');
 }finally{state.close();}
});
