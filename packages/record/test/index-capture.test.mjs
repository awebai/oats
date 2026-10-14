import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { RecordStore } from '../lib/store.mjs';
import { RecordIndex } from '../lib/index-db.mjs';
import { withCaptureGroup } from '../lib/capture-context.mjs';
import { indexCaptureGroup } from '../lib/index-capture.mjs';
import { finishTurn } from '../lib/canonical.mjs';
const require=createRequire(import.meta.url);
const turn=n=>finishTurn({v:1,ts:'2026-01-01T00:00:00Z',from:'fixture',kind:'mail',body:{text:`message ${n}`},provenance:{source:'aw',fidelity:'projected'}});
function fixture(t){const root=fs.mkdtempSync(join(tmpdir(),'index-capture-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function unit(root,names,options={}) {
 const store=new RecordStore(root,{owner:'fixture'}),index=new RecordIndex(store);
 try{return withCaptureGroup(store,names,()=>indexCaptureGroup(index,names,{allowReset:true,...options}));}finally{index.close();}
}
function countSql(fn){
 const sqlite=require('node:sqlite'),Original=sqlite.DatabaseSync,counts={};
 sqlite.DatabaseSync=class extends Original {constructor(path,...args){super(path,...args);
  const key=String(path).endsWith('capture.db')?'capture':'index',c=counts[key]??={opens:0,begins:0,commits:0};c.opens++;
  const exec=this.exec.bind(this);this.exec=sql=>{for(const s of sql.split(';')){if(/^\s*BEGIN\b/.test(s))c.begins++;if(/^\s*COMMIT\b/.test(s))c.commits++;}return exec(sql);};
 }};
 try{fn();return counts;}finally{sqlite.DatabaseSync=Original;}
}

test('index groups amortize commits over streams and fresh no-op needs no index transaction',t=>{
 const root=fixture(t),store=new RecordStore(root,{owner:'fixture'}),names=Array.from({length:8},(_,i)=>`fixture~s${i}`);
 for(const [i,name]of names.entries())store.appendBatch(name,[turn(i*2),turn(i*2+1)]);
 const counts=countSql(()=>{const r=unit(root,names);assert.equal(r.turnsIndexed,16);assert.equal(r.validation.records,0);assert.ok(r.streams.every(s=>s.phase==='complete'));});
 assert.deepEqual(counts,{index:{opens:1,begins:1,commits:1},capture:{opens:1,begins:1,commits:1}});
 assert.deepEqual(countSql(()=>{const r=unit(root,names);assert.equal(r.turnsIndexed,0);assert.equal(r.bytesIndexed,0);assert.equal(r.validation.bytes,0);}),
  {index:{opens:1,begins:0,commits:0},capture:{opens:1,begins:1,commits:1}});
 const index=new RecordIndex(store);try{assert.equal(index.db.prepare("SELECT value FROM meta WHERE key='owner'").get().value,'fixture');assert.equal(index.db.prepare('SELECT count(*) AS n FROM turns').get().n,16);}finally{index.close();}
});

test('short units resume from committed byte cursors after reopening and distribute work across streams',t=>{
 const root=fixture(t),store=new RecordStore(root,{owner:'fixture'}),names=['fixture~a','fixture~b'];
 for(const [i,name]of names.entries())store.appendBatch(name,Array.from({length:12},(_,n)=>turn(i*100+n)));
 for(let pass=1;pass<=3;pass++){
  const r=unit(root,names,{maxRecords:8});assert.equal(r.turnsIndexed,8);assert.equal(r.reset,false);
  const index=new RecordIndex(store);try{assert.deepEqual(index.db.prepare('SELECT indexed_count FROM index_state ORDER BY stream').all().map(r=>r.indexed_count),[4*pass,4*pass]);}finally{index.close();}
 }
 assert.ok(unit(root,names,{maxRecords:8}).streams.every(s=>s.phase==='complete'));
});

test('cache loss validates in bounded units, resets the union atomically, and does not starve a small stream',t=>{
 const root=fixture(t),store=new RecordStore(root,{owner:'fixture'}),names=['fixture~a','fixture~b'];
 store.appendBatch(names[0],Array.from({length:17},(_,n)=>turn(n)));store.appendBatch(names[1],[turn(100),turn(101)]);
 unit(root,names);fs.unlinkSync(join(root,'index','capture.db'));
 let r=unit(root,names,{maxRecords:8});assert.equal(r.reset,true);assert.ok(r.validation.records<=8);
 assert.equal(r.streams[1].phase,'complete','small stream makes progress alongside long validation');
 let passes=1;
 while(r.streams.some(s=>s.phase!=='complete')){assert.ok(++passes<15);r=unit(root,names,{maxRecords:8});assert.ok(r.validation.records<=8);assert.ok(r.turnsIndexed<=8);}
 const index=new RecordIndex(store);try{assert.equal(index.db.prepare('SELECT count(*) AS n FROM turns').get().n,19);assert.equal(index.db.prepare('SELECT sum(indexed_count) AS n FROM index_state').get().n,19);}finally{index.close();}
});

test('index failure rolls back all group rows/cursors, committed prior units survive, and retry deduplicates',t=>{
 const root=fixture(t),store=new RecordStore(root,{owner:'fixture'}),names=['fixture~a','fixture~b'];
 for(const [i,name]of names.entries())store.appendBatch(name,Array.from({length:8},(_,n)=>turn(i*100+n)));
 unit(root,names,{maxRecords:4});
 const index=new RecordIndex(store),add=index.addTurn.bind(index);let calls=0;
 index.addTurn=(...args)=>{if(++calls===3)throw Error('index write fault');return add(...args);};
 try{
  assert.throws(()=>withCaptureGroup(store,names,()=>indexCaptureGroup(index,names,{maxRecords:4})),/index write fault/);
  assert.equal(index.db.prepare('SELECT count(*) AS n FROM turns').get().n,4);
  assert.deepEqual(index.db.prepare('SELECT indexed_count FROM index_state ORDER BY stream').all().map(r=>r.indexed_count),[2,2]);
 }finally{index.close();}
 for(let pass=0;pass<3;pass++)unit(root,names,{maxRecords:4});
 const resumed=new RecordIndex(store);try{assert.equal(resumed.db.prepare('SELECT count(*) AS n FROM turns').get().n,16);}finally{resumed.close();}
});

test('downgrade count writes, journal replacement and deleted-stream tombstones invalidate the whole derived union',t=>{
 const root=fixture(t),store=new RecordStore(root,{owner:'fixture'}),names=['fixture~a','fixture~b'],target=turn(1);
 store.append(names[0],target);
 store.append(names[1],finishTurn({v:1,ts:'2026-01-02T00:00:00Z',from:'fixture',kind:'tombstone',links:[{rel:'tombstones',ref:target.id}],body:{text:'hide'}}));
 unit(root,names);
 let index=new RecordIndex(store);assert.equal(index.db.prepare('SELECT hidden FROM turns WHERE id=?').get(target.id).hidden,1);
 index.db.exec('DELETE FROM index_bytes');index.close();
 assert.equal(unit(root,names).reset,true);
 fs.unlinkSync(store.journalPath(names[1]));assert.equal(unit(root,names).reset,true);
 index=new RecordIndex(store);assert.equal(index.db.prepare('SELECT hidden FROM turns WHERE id=?').get(target.id).hidden,0);index.close();
 fs.writeFileSync(store.journalPath(names[0]),JSON.stringify(turn(2))+'\n');assert.equal(unit(root,names).reset,true);
 index=new RecordIndex(store);try{assert.deepEqual(index.db.prepare('SELECT id FROM turns').all().map(r=>r.id),[turn(2).id]);}finally{index.close();}
});

test('stop commits completed rows and lock-order misuse is refused before work',t=>{
 const root=fixture(t),store=new RecordStore(root,{owner:'fixture'}),names=['fixture~a'];store.appendBatch(names[0],[turn(1),turn(2),turn(3)]);
 const index=new RecordIndex(store),add=index.addTurn.bind(index);let added=0;
 index.addTurn=(...args)=>{const out=add(...args);added++;return out;};
 try{
  assert.throws(()=>indexCaptureGroup(index,names),/active capture work group/);
  const r=withCaptureGroup(store,names,()=>indexCaptureGroup(index,names,{stopped:()=>added===1}));
  assert.equal(r.turnsIndexed,1);assert.equal(r.streams[0].phase,'index');assert.equal(index.db.prepare('SELECT indexed_count FROM index_state').get().indexed_count,1);
  assert.throws(()=>withCaptureGroup(store,names,()=>indexCaptureGroup(index,['fixture~other'])),/must belong/);
 }finally{index.close();}
 assert.equal(unit(root,names).turnsIndexed,2);
});


test('reset detection defaults to deferral without any index mutation, even after validation progress',t=>{
 const root=fixture(t),store=new RecordStore(root,{owner:'fixture'}),names=['fixture~a','fixture~b'];
 store.appendBatch(names[0],[turn(1),turn(2)]);store.append(names[1],turn(3));unit(root,names);
 const index=new RecordIndex(store);
 try{
  index.db.exec('DELETE FROM index_bytes');
  fs.unlinkSync(join(root,'index','capture.db'));
  const before=index.db.prepare('SELECT * FROM turns ORDER BY id').all();
  let resets=0;const reset=index.reset.bind(index);index.reset=()=>{resets++;return reset();};
  const count=countSql(()=>{
   const result=withCaptureGroup(store,names,()=>indexCaptureGroup(index,names,{maxRecords:2}));
   assert.equal(result.validation.records,2);
   assert.equal(result.resetRequired,true);assert.equal(result.reset,false);assert.equal(result.turnsIndexed,0);
   assert.ok(result.streams.every(s=>s.phase==='reset'));
  });
  assert.equal(resets,0);assert.equal(count.index,undefined,'detection reuses the open index, without a second connection');
  assert.deepEqual(index.db.prepare('SELECT * FROM turns ORDER BY id').all(),before);
  assert.equal(index.db.prepare('SELECT count(*) AS n FROM index_bytes').get().n,0);
  // The owning atomic reset runs separately, after the scheduler has admitted
  // its full allowance. Its commit preserves the ordinary old/empty view.
  reset();assert.equal(index.db.prepare('SELECT count(*) AS n FROM turns').get().n,0);
  const resumed=withCaptureGroup(store,names,()=>indexCaptureGroup(index,names));
  assert.equal(resumed.turnsIndexed,3);assert.ok(resumed.streams.every(s=>s.phase==='complete'));
 }finally{index.close();}
});
