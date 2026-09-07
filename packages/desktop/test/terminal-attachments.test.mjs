import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { prepareTerminalAttachments } from '../terminal-attachments.mjs';
import { wireTerminalAttachments, attachmentText } from '../renderer/terminal-attachments.mjs';

test('local paths and clipboard image bytes survive; private image file persists for agent reading', async () => {
 const dir=await mkdtemp(join(tmpdir(),'oats-attachments-'));
 try {
  const path=join(dir,"a 'quoted' $(touch NOT-RUN).png");await writeFile(path,'image');
  const bytes=new Uint8Array([137,80,78,71]);
  const out=await prepareTerminalAttachments([{path},{type:'image/png',bytes}],{directory:join(dir,'images')});
  assert.equal(out[0],path);assert.deepEqual(new Uint8Array(await readFile(out[1])),bytes);
  assert.equal((await stat(out[1])).mode&0o777,0o600);
  assert.ok(!attachmentText(out).includes('\n'));assert.ok(attachmentText(out).includes("'\\''"));
  await assert.rejects(prepareTerminalAttachments([{path:dir}],{directory:dir}),/Only files/);
  await assert.rejects(prepareTerminalAttachments([{type:'image/png',bytes:new Uint8Array(26*1024*1024)}],{directory:dir}),/25 MB/);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('remote uploads use installed CLI and exact home; unsupported/failed uploads never return local paths',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'oats-upload-'));
 try {
  const path=join(dir,'image.png');await writeFile(path,'image');
  const remote={serverId:'build',instance:'dev',home:'/srv/team/agents/dev'};
  const cli={ok:true,bin:'/installed/oats',remote:['session-upload']};let args;
  const paths=await prepareTerminalAttachments([{path}],{directory:dir,remote,cli,run:async(bin,a)=>{assert.equal(bin,cli.bin);args=a;return{stdout:JSON.stringify({schemaVersion:1,ok:true,result:{path:'/remote/image.png'}})};}});
  assert.deepEqual(paths,['/remote/image.png']);assert.deepEqual(args,['session','upload','--server','build','--instance','dev','--home',remote.home,'--file',path,'--json']);
  await assert.rejects(prepareTerminalAttachments([{path}],{directory:dir,remote,cli:{...cli,remote:[]}}),/Update OATS/);
  await assert.rejects(prepareTerminalAttachments([{path}],{directory:dir,remote,cli,run:async()=>({stdout:'{"schemaVersion":1,"ok":false,"error":{"message":"transfer failed"}}'})}),/transfer failed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('drop targets its pane, never submits; pending close discards transfer result; text paste is untouched',async()=>{
 const dom=new JSDOM('<div id="pane"></div>'),wrap=dom.window.document.querySelector('#pane');
 const file=new dom.window.File(['image'],'screen.png',{type:'image/png'});let id=7,resolve,calls=0;const pasted=[];
 const off=wireTerminalAttachments({wrap,desk:{termAttachFiles:async(target,files)=>{calls++;assert.equal(target,7);assert.equal(files[0],file);return new Promise(r=>resolve=r);}},term:{paste:s=>pasted.push(s),focus(){}},ptyId:()=>id});
 const drop=()=>{const e=new dom.window.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(e,'dataTransfer',{value:{files:[file]}});wrap.dispatchEvent(e);assert.equal(e.defaultPrevented,true);};
 const text=new dom.window.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(text,'clipboardData',{value:{files:[]}});wrap.dispatchEvent(text);assert.equal(text.defaultPrevented,false);
 drop();drop();assert.equal(calls,1);resolve(['/tmp/screen.png']);await new Promise(r=>setImmediate(r));assert.deepEqual(pasted,["'/tmp/screen.png' "]);
 drop();id=null;off();resolve(['/tmp/late.png']);await new Promise(r=>setImmediate(r));assert.equal(pasted.length,1);assert.equal(wrap.querySelector('[role=status]'),null);dom.window.close();
});
