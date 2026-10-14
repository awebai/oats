import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { RecordStore } from '../lib/store.mjs';
import { DerivedState } from '../lib/derived-state.mjs';
import { captureSessions } from '../lib/capture-cc.mjs';
import { withCaptureGroup } from '../lib/capture-context.mjs';
import { finishTurn } from '../lib/canonical.mjs';
const require=createRequire(import.meta.url);
const line=n=>JSON.stringify({timestamp:'2026-01-01T00:00:00Z',type:'user',message:{content:`entry ${n}`}})+'\n';
const turn=finishTurn({v:1,ts:'2026-01-01T00:00:00Z',from:'fixture',kind:'note',body:{text:'public writer'}});
function fixture(t){const root=fs.mkdtempSync(join(tmpdir(),'capture-transactions-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,store:new RecordStore(root,{owner:'fixture',lockTimeoutMs:1000})};}
function countSql(fn){const sqlite=require('node:sqlite'),Original=sqlite.DatabaseSync;const counts={opens:0,begins:0,commits:0};sqlite.DatabaseSync=class extends Original{constructor(...args){super(...args);counts.opens++;const exec=this.exec.bind(this);this.exec=sql=>{for(const s of sql.split(';')){if(/^\s*BEGIN IMMEDIATE/.test(s))counts.begins++;if(/^\s*COMMIT/.test(s))counts.commits++;}return exec(sql);};}};try{fn();return counts;}finally{sqlite.DatabaseSync=Original;}}

test('one capture group amortizes source/ID/validation commits across inputs and reopening remains truthful',t=>{
 const {root,store}=fixture(t),files=Array.from({length:4},(_,i)=>join(root,`s${i}.jsonl`)),streams=files.map((_,i)=>`fixture~cc.s${i}`);
 for(const [i,file]of files.entries())fs.writeFileSync(file,line(i));
 const counts=countSql(()=>withCaptureGroup(store,streams,()=>assert.equal(captureSessions(store,{owner:'fixture',files}).appended,4)));
 assert.deepEqual(counts,{opens:1,begins:2,commits:2},'one schema initialization and one group commit, independent of four inputs');
 const reopened=new RecordStore(root,{owner:'fixture'});
 assert.deepEqual(countSql(()=>withCaptureGroup(reopened,streams,()=>assert.equal(captureSessions(reopened,{owner:'fixture',files}).appended,0))),{opens:1,begins:1,commits:1});
 for(const stream of streams)assert.equal(reopened.readStream(stream).length,1);
});

test('group rollback after fsynced appends is recovered from journal truth without duplicate turns',t=>{
 const {root,store}=fixture(t),file=join(root,'s.jsonl');fs.writeFileSync(file,line(1));
 assert.throws(()=>withCaptureGroup(store,['fixture~cc.s'],()=>{assert.equal(captureSessions(store,{owner:'fixture',files:[file]}).appended,1);throw Error('stop after append before group commit');}),/stop after append/);
 assert.equal(store.readStream('fixture~cc.s').length,1);
 const state=new DerivedState(root);try{assert.equal(state.get('cc',`fixture~cc.s:${file}`),null);}finally{state.close();}
 assert.equal(captureSessions(new RecordStore(root,{owner:'fixture'}),{owner:'fixture',files:[file]}).appended,0);
 assert.equal(store.readStream('fixture~cc.s').length,1);
});

test('partial acquisition/stop and out-of-group access cannot leak locks or invert database order',t=>{
 const {root,store}=fixture(t);let calls=0;
 assert.throws(()=>withCaptureGroup(store,['fixture~a','fixture~b'],()=>assert.fail('not acquired'),{check(){if(++calls===4)throw Error('deadline');}}),/deadline/);
 assert.equal(fs.existsSync(join(root,'streams/fixture~a/.lock')),false);
 assert.throws(()=>withCaptureGroup(store,['fixture~a'],()=>store.append('fixture~b',turn)),/outside capture work group/);
 assert.equal(fs.existsSync(join(root,'streams/fixture~a/.lock')),false);
 const state=new DerivedState(root);try{state.transaction(()=>assert.throws(()=>withCaptureGroup(store,['fixture~a'],()=>{}, {state}),/inside a transaction/));}finally{state.close();}
 assert.throws(()=>withCaptureGroup(store,Array.from({length:129},(_,i)=>`fixture~s${i}`),()=>{}),/128 streams/);
});

test('a concurrent public writer can commit while a group waits for its stream, before the group starts its DB transaction',async t=>{
 const {root,store}=fixture(t),ready=join(root,'ready'),lib=resolve(import.meta.dirname,'../lib/store.mjs');
 const child=spawn(process.execPath,['--input-type=module','-e',`
 import fs from 'node:fs';import {RecordStore} from ${JSON.stringify(lib)};
 const store=new RecordStore(${JSON.stringify(root)},{owner:'fixture'}),lock=store.withStreamLock.bind(store);
 store.withStreamLock=(stream,fn)=>lock(stream,()=>{fs.writeFileSync(${JSON.stringify(ready)},'ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);return fn();});
 store.append('fixture~b',${JSON.stringify(turn)});
 `],{env:{HOME:root,TMPDIR:root,PATH:process.env.PATH},stdio:['ignore','ignore','pipe'],timeout:5000});
 const ended=once(child,'exit');let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
 try {
 const end=Date.now()+5000;while(!fs.existsSync(ready)){assert.ok(Date.now()<end,'public writer startup timed out');await new Promise(r=>setTimeout(r,5));}
 withCaptureGroup(store,['fixture~b','fixture~a'],()=>store.append('fixture~a',turn));
 assert.deepEqual(await ended,[0,null],stderr);
 assert.equal(store.readStream('fixture~a').length,1);assert.equal(store.readStream('fixture~b').length,1);
 } finally { if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await ended;} }
});
