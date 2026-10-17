// Reader compatibility for command batches interleaved across AW accounts.
// This qualifies readers, not the final supervisor's scheduling/fairness policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { RecordStore } from '../lib/store.mjs';
import { RecordIndex, resolveTurn } from '../lib/index-db.mjs';
import { withCaptureGroup } from '../lib/capture-context.mjs';
import { captureAwUnit } from '../lib/capture-aw-unit.mjs';
import { captureAwLogs } from '../lib/capture-aw.mjs';
import { projectCommLogEntry } from '../lib/project-aweb.mjs';
import { captureHealth } from '../lib/capture-state.mjs';
import { finishTurn } from '../lib/canonical.mjs';
import { writeCurrentHook } from './fixtures/capture-hook-settings.mjs';
const stream='fixture~aw', thread='aweb:conv:shared';
const entry=(account,n)=>({ts:`2026-01-01T00:00:0${n}Z`,ch:'mail',dir:'recv',from:account,
  conversation_id:'shared',msg_id:`${account}-${n}`,body:`needle ${account} ${n}`});
const projected=(account,n)=>projectCommLogEntry(entry(account,n),{selfName:account});
function fixture(t){
 const base=fs.mkdtempSync(join(tmpdir(),'aw-readers-')),root=join(base,'record'),logs=join(base,'logs');
 fs.mkdirSync(logs);t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 for(const a of ['a','z'])fs.writeFileSync(join(logs,`${a}.jsonl`),[0,1,2].map(n=>JSON.stringify(entry(a,n))+'\n').join(''));
 const store=new RecordStore(root,{owner:'fixture'});
 const unit=a=>withCaptureGroup(store,[stream],()=>captureAwUnit(store,{owner:'fixture',path:join(logs,`${a}.jsonl`),maxRecords:1}));
 const cli=(bin,args)=>{
  const result=spawnSync(process.execPath,[join(import.meta.dirname,'../bin',`${bin}.mjs`),'--root',root,...args],
   {env:process.env,encoding:'utf8',timeout:15000,maxBuffer:1024*1024});
  assert.equal(result.status,0,result.stderr);return result.stdout;
 };
 return {base,root,logs,store,unit,cli,recall:(...args)=>JSON.parse(cli('recall',['--thread',thread,'--json',...args]))};
}

test('interleaved accounts retain exact projected IDs, per-account order, index membership and aggregate status',t=>{
 const f=fixture(t),order=['a','z','z','a','z','a'];
 for(const account of order)assert.equal(f.unit(account).appended,1);
 const turns=f.store.readStream(stream),ids=turns.map(t=>t.id);
 assert.equal(new Set(ids).size,6);
 for(const account of ['a','z'])assert.deepEqual(turns.filter(t=>t.from===account),[0,1,2].map(n=>projected(account,n)));
 const publicRoot=join(f.base,'public'),publicStore=new RecordStore(publicRoot,{owner:'fixture'});
 const results=captureAwLogs(publicStore,{owner:'fixture',commLogDir:f.logs});
 assert.deepEqual(results.map(r=>r.account),['a','z']);
 assert.deepEqual(publicStore.readStream(stream).map(t=>t.id),['a','z'].flatMap(a=>[0,1,2].map(n=>projected(a,n).id)));
 assert.notDeepEqual(ids,publicStore.readStream(stream).map(t=>t.id),'fixture must actually differ from whole-account order');
 const index=new RecordIndex(f.store);
 try{
  index.update();assert.equal(index.counts().turns,6);
  assert.deepEqual(index.search('needle',{limit:20}).map(t=>t.id).sort(),[...ids].sort());
  for(const turn of turns)assert.deepEqual(resolveTurn(f.store,index,turn.id),turn);
 }finally{index.close();}
 assert.match(f.cli('capture',['--status','--owner','fixture']),/fixture~aw: 6 turns/);
 // Diagnosed as an installed host: a record root alone is not one.
 writeCurrentHook(f.base);
 const health=captureHealth(f.root, { home: f.base });assert.deepEqual(health.rows.map(row=>row.code),['capture-status-missing','capture-success-stale']);assert.equal(health.backlog.setAsideCount,0);
});

test('JSON recall exposes the durable sequence; mixed-account ID windows survive later appends and fresh readers',t=>{
 const f=fixture(t);
 for(const account of ['a','z','a','z'])f.unit(account);
 const prefix=f.store.readStream(stream),ids=prefix.map(t=>t.id),windowArgs=['--after',ids[0],'--until',ids[3]];
 const all=f.recall();assert.deepEqual(all.turns.map(t=>t.id),ids);
 const window=f.recall(...windowArgs),sized=f.recall(...windowArgs,'--ids-only');
 assert.deepEqual(window.turns.map(t=>t.id),ids.slice(1,4),'after exclusive / until inclusive');
 assert.deepEqual(window.turns.map(t=>t.text[0].text),['needle z 0','needle a 1','needle z 1']);
 assert.deepEqual(sized.turns.map(t=>t.id),window.turns.map(t=>t.id));
 assert.ok(sized.turns.every(t=>Number.isSafeInteger(t.bytes)&&t.bytes>0&&!('text' in t)));
 const bytes=fs.readFileSync(f.store.journalPath(stream));
 for(const account of ['z','a'])f.unit(account);
 assert.deepEqual(fs.readFileSync(f.store.journalPath(stream)).subarray(0,bytes.length),bytes,'later appends do not rewrite prior sequence');
 // Every recall launches a fresh process. Total grows, but the bounded turn
 // window (and its size projection) stays byte-for-byte equal.
 assert.equal(f.recall().total,6);
 assert.deepEqual(f.recall(...windowArgs).turns,window.turns);
 assert.deepEqual(f.recall(...windowArgs,'--ids-only').turns,sized.turns);
});

test('tombstone authority is preserved with interleaved accounts and before/after indexing',t=>{
 for(const before of [true,false]){
  const f=fixture(t);for(const a of ['z','a','z','a'])f.unit(a);
  const target=projected('z',0),unauthorized=projected('a',0),index=new RecordIndex(f.store);
  try{
   if(before)index.update();
   f.store.append('fixture~claims',finishTurn({v:1,ts:'2026-01-02T00:00:00Z',from:'z',kind:'tombstone',body:{text:'hide'},links:[{rel:'tombstones',ref:target.id}]}));
   new RecordStore(f.root,{owner:'other'}).append('other~claims',finishTurn({v:1,ts:'2026-01-02T00:00:00Z',from:'other',kind:'tombstone',body:{text:'invalid authority'},links:[{rel:'tombstones',ref:unauthorized.id}]}));
   index.update();
   const visible=f.recall().turns.map(t=>t.id);
   assert.ok(!visible.includes(target.id));assert.ok(visible.includes(unauthorized.id));
   assert.deepEqual(index.search('needle',{limit:20}).map(t=>t.id).sort(),[...visible].sort());
  }finally{index.close();}
 }
});
