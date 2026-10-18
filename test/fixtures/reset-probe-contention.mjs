// Test-only rollback-lock handshake. The holder cannot release SHARED until a
// different process observes PENDING excluding a fresh autocommit read.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

function mailbox(channel,signal) {
 const messages=new Map(),checks=new Set();let failure;
 const notify=()=>{for(const check of checks)check();};
 channel.on('message',message=>{
  if(message.type==='stop')failure=new Error('contention helper stopped');
  else messages.set(message.type,message);
  notify();
 });
 channel.on('error',error=>{failure=error;notify();});
 for(const event of ['disconnect','close'])channel.on(event,()=>{failure??=new Error(`contention channel ${event}`);notify();});
 signal?.addEventListener('abort',()=>{failure=signal.reason;notify();},{once:true});
 return type=>new Promise((resolve,reject)=>{
  const finish=(error,value)=>{clearTimeout(timer);checks.delete(check);error?reject(error):resolve(value);};
  const check=()=>{
   if(messages.has(type))finish(null,messages.get(type));
   else if(failure)finish(failure);
  };
  const timer=setTimeout(()=>finish(new Error(`contention protocol timeout: ${type}`)),4000);
  checks.add(check);check();
 });
}
const send=(channel,type,extra={})=>new Promise((resolve,reject)=>{
 channel.send({type,...extra},error=>error?reject(error):resolve());
});
function launch(role,path,diagnostic=()=>{},signal) {
 const child=spawn(process.execPath,[fileURLToPath(import.meta.url),role,path],{
  env:{...(process.env.TMPDIR?{TMPDIR:process.env.TMPDIR}:{})},
  stdio:['ignore','ignore','inherit','ipc'],timeout:10000,killSignal:'SIGKILL',
 });
 const wait=mailbox(child,signal);
 const ended=new Promise(resolve=>child.once('close',(code,signal)=>{
  diagnostic(`contention ${role} close: code=${code} signal=${signal}`);resolve({code,signal});
 }));
 return {child,wait,ended,async stop(){
  if(child.connected)child.send({type:'stop'},()=>{});
  const term=setTimeout(()=>child.kill('SIGTERM'),500);
  const kill=setTimeout(()=>child.kill('SIGKILL'),1000);
  try{await ended;}finally{clearTimeout(term);clearTimeout(kill);}
 }};
}

export async function holdSharedUntilPending(path,diagnostic) {
 const holder=launch('holder',path,diagnostic);
 try{await holder.wait('shared-held');diagnostic('contention SHARED-held: BEGIN and SELECT completed');}
 catch(error){await holder.stop();throw error;}
 return {
  async arm(){
   await send(holder.child,'arm');await holder.wait('phase-ack');
   diagnostic('contention phase-ack: witness armed; holder retains SHARED');
  },
  async released(){
   const receipt=await holder.wait('released'),outcome=await holder.ended;
   assert.deepEqual(receipt.witness,{code:0,signal:null});
   assert.deepEqual(outcome,{code:0,signal:null});
   diagnostic('contention witnessed-release: fresh reader SQLITE_BUSY, then holder ROLLBACK; both helpers reaped');
  },
  terminate:()=>holder.stop(),
 };
}

async function childMain(role,path) {
 const controller=new AbortController(),{signal}=controller;
 const stop=()=>controller.abort(Object.assign(new Error('contention helper stopped'),{stopped:true}));
 process.once('disconnect',stop);process.once('SIGTERM',stop);
 process.on('message',message=>{if(message.type==='stop')stop();});
 const wait=mailbox(process,signal),db=new DatabaseSync(path,{readOnly:true});
 let witness,timer;
 // The deadline is a failure path, never evidence that acquisition overlapped.
 const deadline=setTimeout(()=>controller.abort(new Error('contention helper deadline')),8000);
 try{
  db.exec('PRAGMA busy_timeout = 0');
  const read=db.prepare('SELECT id FROM turns LIMIT 1');
  if(role==='holder'){
   db.exec('BEGIN');read.get();
   witness=launch('witness',path,message=>console.error(message),signal);
   await witness.wait('ready');await send(process,'shared-held');
   await wait('arm');await send(witness.child,'arm');await witness.wait('armed');
   // This acknowledgement precedes the writer's synchronous acquisition call.
   await send(process,'phase-ack');
   await witness.wait('busy');
   db.exec('ROLLBACK');
   const outcome=await witness.ended;
   assert.deepEqual(outcome,{code:0,signal:null});
   await send(process,'released',{witness:outcome});
  }else{
   assert.equal(role,'witness');read.get();await send(process,'ready');
   await wait('arm');
   const busy=new Promise((resolve,reject)=>{
    timer=setInterval(()=>{
     try{read.get();}catch(error){
      if((Number(error.errcode)&255)===5)resolve();else reject(error);
     }
    },5);
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
   });
   await send(process,'armed');await busy;clearInterval(timer);
   await send(process,'busy');
  }
 }catch(error){if(!error.stopped)throw error;}
 finally{
  clearTimeout(deadline);clearInterval(timer);
  if(db.isTransaction)db.exec('ROLLBACK');db.close();
  if(witness)await witness.stop();
 }
}
if(process.argv[2]==='holder'||process.argv[2]==='witness'){
 try{await childMain(process.argv[2],process.argv[3]);}
 catch(error){console.error(error);process.exitCode=1;}
 finally{if(process.connected)process.disconnect();}
}
