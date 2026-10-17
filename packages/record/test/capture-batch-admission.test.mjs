import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RecordStore } from '../lib/store.mjs';
import { captureSessions } from '../lib/capture-cc.mjs';
import { captureAwLogs } from '../lib/capture-aw.mjs';
import { withCaptureGroup, captureContext } from '../lib/capture-context.mjs';
const limit=1024;
function fixture(t,kind){
 const root=fs.mkdtempSync(join(tmpdir(),'capture-batch-admission-')),logs=join(root,'logs');fs.mkdirSync(logs);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const path=join(logs,'session.jsonl'),store=new RecordStore(join(root,'record'),{owner:'fixture'});
 const stamp=n=>`2026-01-0${n+1}T00:00:00Z`;
 const native=n=>JSON.stringify({timestamp:stamp(n),type:'user',message:{content:String(n)+'x'.repeat(600)}})+'\n';
 const aw=n=>JSON.stringify({ts:stamp(n),dir:'recv',ch:'mail',msg_id:String(n),from:'alice',to:'fixture',body:String(n)+'x'.repeat(600)})+'\n';
 const lines=[0,1,2].map(kind==='cc'?native:aw);
 fs.writeFileSync(path,lines.join(''));
 const stream=kind==='cc'?'fixture~cc.session':'fixture~aw';
 const capture=()=>kind==='cc'?captureSessions(store,{owner:'fixture',files:[path]}):captureAwLogs(store,{owner:'fixture',commLogDir:logs});
 return {root,path,store,stream,lines,capture};
}
for(const kind of ['cc','aw'])test(`${kind} admits raw bytes before adding the next record and never checkpoints it with the previous batch`,t=>{
 const f=fixture(t,kind),append=f.store.appendUniqueBatch.bind(f.store);let calls=0;
 f.store.appendUniqueBatch=(stream,turns)=>{
  calls++;
  assert.equal(turns.length,1,'two individually processable records must not overflow one batch');
  if(calls===2){
   const prior=captureContext(f.store).state.get(kind,`${stream}:${f.path}`);
   assert.equal(prior.bytes,Buffer.byteLength(f.lines[0]),'cursor excludes the record whose append has not happened');
   if(kind==='cc')assert.equal(prior.lastTs,'2026-01-01T00:00:00Z','prior checkpoint excludes next timestamp');
   throw Error('injected second batch failure');
  }
  return append(stream,turns);
 };
 assert.throws(()=>withCaptureGroup(f.store,[f.stream],f.capture,{batchBytes:limit}),/injected second batch failure/);
 assert.equal(f.store.readStream(f.stream).length,1,'only the durable first batch survives');
 f.store.appendUniqueBatch=append;
 withCaptureGroup(f.store,[f.stream],f.capture,{batchBytes:limit});
 const turns=f.store.readStream(f.stream);assert.equal(turns.length,3);assert.equal(new Set(turns.map(t=>t.id)).size,3);
 if(kind==='cc')assert.equal(turns.map(t=>t.body.line+'\n').join(''),f.lines.join(''));
});

test('AW preflush preserves consumed whitespace while excluding the next record',t=>{
 const f=fixture(t,'aw'),blank='   \n'.repeat(20),append=f.store.appendUniqueBatch.bind(f.store);
 fs.writeFileSync(f.path,f.lines[0]+blank+f.lines[1]);let calls=0;
 f.store.appendUniqueBatch=(stream,turns)=>{
  if(++calls===2){assert.equal(captureContext(f.store).state.get('aw',`${stream}:${f.path}`).bytes,Buffer.byteLength(f.lines[0]+blank));throw Error('stop');}
  return append(stream,turns);
 };
 assert.throws(()=>withCaptureGroup(f.store,[f.stream],f.capture,{batchBytes:limit}),/stop/);
 f.store.appendUniqueBatch=append;withCaptureGroup(f.store,[f.stream],f.capture,{batchBytes:limit});assert.equal(f.store.readStream(f.stream).length,2);
});
