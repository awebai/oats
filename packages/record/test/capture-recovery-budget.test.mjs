import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { syncBuiltinESMExports } from 'node:module';
import { RecordStore } from '../lib/store.mjs';
import { finishTurn } from '../lib/canonical.mjs';
import { withCaptureGroup } from '../lib/capture-context.mjs';
import { bufferLines, RecordSizeError } from '../lib/file-lines.mjs';
const stream='fixture~aw';
const turn=n=>finishTurn({v:1,ts:'2026-01-01T00:00:00Z',from:'fixture',kind:'note',body:{text:`record ${n}`}});
function fixture(t){const root=fs.mkdtempSync(join(tmpdir(),'capture-recovery-budget-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,store:new RecordStore(root,{owner:'fixture'})};}
function watchReads(path,start,fn){
 const open=fs.openSync,close=fs.closeSync,read=fs.readSync,tracked=new Set();
 fs.openSync=(p,...a)=>{const fd=open(p,...a);if(p===path)tracked.add(fd);return fd;};
 fs.closeSync=fd=>{tracked.delete(fd);return close(fd);};
 fs.readSync=(fd,...a)=>{if(tracked.has(fd))assert.ok(a[3]>=start,`read resumed before ${start}: ${a[3]}`);return read(fd,...a);};syncBuiltinESMExports();
 try{return fn();}finally{fs.openSync=open;fs.closeSync=close;fs.readSync=read;syncBuiltinESMExports();}
}
function step(root,options){const store=new RecordStore(root,{owner:'fixture'});return withCaptureGroup(store,[stream],()=>store.withDerived(state=>store.validateJournal(stream,state,options)));}

test('lost validation cache makes durable progress across fresh groups without rereading completed prefixes',t=>{
 const {root,store}=fixture(t);store.appendBatch(stream,Array.from({length:30},(_,i)=>turn(i)));
 const journal=fs.readFileSync(store.journalPath(stream));fs.rmSync(join(root,'index/capture.db'));
 let previous=0,passes=0,checkpoint;
 do {checkpoint=watchReads(store.journalPath(stream),checkpoint?.bytes??0,()=>step(root,{maxRecords:7,maxBytes:2048}));assert.ok(checkpoint.count>=previous);assert.ok(checkpoint.count-previous<=7);previous=checkpoint.count;assert.ok(++passes<15);}while(!checkpoint.complete);
 assert.equal(checkpoint.count,30);assert.equal(checkpoint.bytes,journal.length);assert.ok(passes>1);
 assert.deepEqual(fs.readFileSync(store.journalPath(stream)),journal);
 assert.equal(store.appendUniqueBatch(stream,[turn(0)]),0);
});

test('obsolete ID deletion and changed-journal validation both resume; a mid-recovery change revokes progress',t=>{
 const {root,store}=fixture(t);store.appendBatch(stream,Array.from({length:25},(_,i)=>turn(i)));
 fs.writeFileSync(store.journalPath(stream),Array.from({length:9},(_,i)=>JSON.stringify(turn(100+i))+'\n').join(''));
 const first=step(root,{maxRecords:4});assert.equal(first.resetting,true);assert.equal(first.complete,false);assert.equal(first.bytes,0);
 let checkpoint,passes=0;do{checkpoint=step(root,{maxRecords:4});assert.ok(++passes<20);}while(checkpoint.count===0);
 assert.equal(checkpoint.complete,false);const epoch=checkpoint.epoch;
 fs.writeFileSync(store.journalPath(stream),JSON.stringify(turn(200))+'\n');
 checkpoint=step(root,{maxRecords:2});assert.notEqual(checkpoint.epoch,epoch);assert.equal(checkpoint.complete,false);
 for(let n=0;!checkpoint.complete;n++){assert.ok(n<20);checkpoint=step(root,{maxRecords:2});}
 assert.equal(checkpoint.count,1);assert.equal(store.appendUniqueBatch(stream,[turn(200)]),0);
 assert.equal(store.appendUniqueBatch(stream,[turn(100)]),1,'removed historical IDs must not suppress legitimate new appends');
});

test('a cooperative stop commits completed validation records; late corruption never becomes append authority',t=>{
 const {root,store}=fixture(t);store.appendBatch(stream,Array.from({length:15},(_,i)=>turn(i)));fs.rmSync(join(root,'index/capture.db'));
 let samples=0;const partial=step(root,{stopped:()=>++samples>8});assert.equal(partial.complete,false);assert.ok(partial.count>0);assert.ok(partial.count<15);
 const resumed=step(root,{maxRecords:1});assert.equal(resumed.count,partial.count+1);
 fs.appendFileSync(store.journalPath(stream),'corrupt complete line\n');
 let caught=false;for(let n=0;n<50&&!caught;n++){try{assert.equal(step(root,{maxRecords:3}).complete,false);}catch(e){assert.match(e.message,/corrupt interior/);caught=true;}}
 assert.equal(caught,true);const before=fs.readFileSync(store.journalPath(stream));assert.throws(()=>store.appendUniqueBatch(stream,[turn(99)]),/corrupt interior/);assert.deepEqual(fs.readFileSync(store.journalPath(stream)),before);
});

test('record framing refuses an oversized terminated or unfinished record before a whole-record join',()=>{
 for(const terminated of [false,true]){
  let yielded=0;function* source(){yield Buffer.from('ok\n');for(let i=0;i<100;i++){yielded++;const chunk=Buffer.alloc(65536,120);if(terminated&&i===1)chunk[chunk.length-1]=10;yield chunk;}if(terminated)yield Buffer.from('\n');}
  const lines=bufferLines(source(),{maxBytes:70000});assert.equal(lines.next().value.toString(),'ok\n');
  assert.throws(()=>lines.next(),e=>e instanceof RecordSizeError&&e.offset===3&&e.limit===70000);assert.equal(yielded,2,'must stop early, before reading or allocating the whole source record');
 }
 assert.deepEqual([...bufferLines([Buffer.from('abc\ndef')],{maxBytes:4})].map(b=>b.toString()),['abc\n','def']);
 assert.equal([...bufferLines([Buffer.alloc(100000,120)])][0].length,100000,'public framing default retains existing record-size semantics');
});

test('cooperative budget reserves drain time, records process RSS and retains the first observed stop',async()=>{
 const {CaptureBudget,CaptureStop,CAPTURE_POLICY}=await import('../lib/capture-budget.mjs');
 let now=0,rss=10,alive=true;const budget=new CaptureBudget({policy:{...CAPTURE_POLICY,deadlineSeconds:10,rssBytes:100},drainSeconds:2,clock:()=>now,rss:()=>rss,supervisorAlive:()=>alive});
 now=7999;assert.equal(budget.sample(),null);rss=90;assert.equal(budget.sample(),null);assert.equal(budget.peakRssBytes,90);
 now=8000;assert.throws(()=>budget.check(),e=>e instanceof CaptureStop&&e.reason==='deadline');
 rss=110;assert.equal(budget.sample(),'deadline');assert.equal(budget.peakRssBytes,110);
 const orphan=new CaptureBudget({clock:()=>0,rss:()=>10,supervisorAlive:()=>alive});alive=false;assert.throws(()=>orphan.check(),e=>e.reason==='interrupted');
 const pressure=new CaptureBudget({policy:{...CAPTURE_POLICY,rssBytes:100},clock:()=>0,rss:()=>101});assert.throws(()=>pressure.check(),e=>e.reason==='rss');
});
