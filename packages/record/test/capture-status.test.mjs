import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { CAPTURE_POLICY } from '../lib/capture-budget.mjs';
import { emptyCaptureCounts, emptyCaptureStatus, validCaptureStatus, readCaptureStatus, persistCaptureStatus } from '../lib/capture-status.mjs';
import { writeCaptureStatus, captureHealth } from '../lib/capture-state.mjs';
const at='2026-01-01T00:00:00.000Z',finish='2026-01-01T00:01:00.000Z',now=Date.parse('2026-01-02T00:00:00.000Z');
const backlog=()=>({pending:false,setAsideCount:0,setAside:[],truncated:false,failedCount:0,failed:[],failedTruncated:false});
const summary=()=>({id:'fixture-run',trigger:'manual',pid:123,startedAt:at,finishedAt:finish,counts:emptyCaptureCounts(),peakRssBytes:1024});
const fixtureStatus=()=>({...emptyCaptureStatus(backlog()),policy:{...CAPTURE_POLICY},lastRun:{...summary(),outcome:'complete',reason:null,reclaimedLock:null},lastSuccess:summary(),lastProgressAt:finish});
function fixture(t){const root=fs.mkdtempSync(join(tmpdir(),'capture-status-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}

test('algorithm null evidence and service run/history shapes remain distinct',()=>{
 assert.ok(validCaptureStatus(emptyCaptureStatus(backlog()),{now}));
 const s=fixtureStatus();assert.ok(validCaptureStatus(s,{now}));
 for(const mutate of [x=>x.policy=null,x=>x.policy.heapMiB=512,x=>x.lastRun.pid=0,
  x=>x.lastRun.counts.turnsAppended=-1,x=>x.lastRun.counts.unknown=0,x=>x.lastRun.counts.filesVisited=1.5,
  x=>x.lastRun.finishedAt=null,x=>x.lastRun.reason='heap',x=>x.lastSuccess.finishedAt=at.replace('2026','2025'),
  x=>x.lastProgressAt='2027-01-01T00:00:00.000Z',x=>x.lastRun.startedAt='not-a-date',
  x=>x.lastRun.reclaimedLock={pid:-1,startedAt:at},x=>x.lastFailure={...summary(),reason:null,message:'failure'}]){
  const copy=structuredClone(s);mutate(copy);assert.equal(validCaptureStatus(copy,{now}),false);
 }
 const running=structuredClone(s);running.lastRun={...summary(),finishedAt:null,outcome:'running',reason:null,reclaimedLock:{pid:456,startedAt:at}};
 assert.ok(validCaptureStatus(running,{now}));
 running.lastRun.reason='deadline';assert.equal(validCaptureStatus(running,{now}),false);
});

test('atomic private publication preserves old bytes on write/fsync/rename failure and cleans owned temp',t=>{
 const root=fixture(t),path=join(root,'capture-status.json'),before=emptyCaptureStatus(backlog());
 persistCaptureStatus(root,before,{now});const bytes=fs.readFileSync(path);
 assert.equal(fs.statSync(path).mode&0o777,0o600);
 for(const method of ['writeFileSync','fsyncSync','renameSync']){
  const original=fs[method];fs[method]=()=>{throw Error(`injected ${method}`);};syncBuiltinESMExports();
  try{assert.throws(()=>persistCaptureStatus(root,fixtureStatus(),{now}),/injected/);}finally{fs[method]=original;syncBuiltinESMExports();}
  assert.deepEqual(fs.readFileSync(path),bytes);assert.deepEqual(fs.readdirSync(root),['capture-status.json']);
 }
 persistCaptureStatus(root,fixtureStatus(),{now});assert.deepEqual(readCaptureStatus(root,{now}),fixtureStatus());
});

test('receipt backlog refresh retains historical service facts without claiming a new run',async t=>{
 const root=fixture(t),status=fixtureStatus();persistCaptureStatus(root,status);
 const result=writeCaptureStatus(root,{pending:true});
 for(const key of ['policy','lastRun','lastSuccess','lastFailure','lastProgressAt'])assert.deepEqual(result[key],status[key]);
 assert.equal(result.backlog.pending,true);assert.deepEqual(readCaptureStatus(root),result);
 // The published bytes conform to the shared schema (date-time strings are
 // checked by validCaptureStatus itself), including its fixed policy consts.
 const {default:Ajv2020}=await import('ajv/dist/2020.js');
 const validate=new Ajv2020({strict:false,allowUnionTypes:true,validateFormats:false})
  .compile(JSON.parse(fs.readFileSync(new URL('../docs/capture-status.schema.json',import.meta.url),'utf8')));
 const published=JSON.parse(fs.readFileSync(join(root,'capture-status.json'),'utf8'));
 assert.equal(validate(published),true,JSON.stringify(validate.errors));
 assert.equal(validate({...published,policy:{...published.policy,rssBytes:1}}),false);
 const health=captureHealth(root, { home: root });assert.deepEqual(health.lastRun,status.lastRun);assert.deepEqual(health.lastSuccess,status.lastSuccess);
 assert.ok(!health.rows.some(row=>row.code==='capture-status-invalid'),'accepted history must survive the read-only health projection');
});

test('bounded read rejects malformed, oversized and future status without creating absent state',t=>{
 const root=fixture(t),absent=join(root,'absent');assert.equal(readCaptureStatus(absent),null);assert.equal(fs.existsSync(absent),false);
 const path=join(root,'capture-status.json');
 for(const content of ['{bad',JSON.stringify({...fixtureStatus(),schemaVersion:2}),'x'.repeat(1024*1024+1),
  JSON.stringify({...fixtureStatus(),lastProgressAt:'9999-01-01T00:00:00.000Z'})]){
  fs.writeFileSync(path,content);assert.throws(()=>readCaptureStatus(root));
  assert.equal(captureHealth(root, { home: root }).rows[0].code,'capture-status-invalid');
  assert.equal(fs.readFileSync(path,'utf8'),content);
 }
});
