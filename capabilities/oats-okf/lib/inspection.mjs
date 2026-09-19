import { fs, join, dirname, safePath, fail, oats } from './io.mjs';
import { markerPath, loadStatus } from './sources.mjs';
import { qualifiedSoulIdentity } from './source-contract.mjs';

// Keep the v1 labeled-document contract, including its explicit per-document
// preview cap. The JSON envelope itself must drain in full through stdout.
const DOCUMENT_BYTES = 256 * 1024;
const missing = e => e.code === 'ENOENT' || e.code === 'ENOTDIR';
function regular(file, limit) {
  safePath(file);
  let stat;try { stat=fs.lstatSync(file); } catch(e) { if(missing(e)) return null;throw e; }
  if(!stat.isFile() || stat.nlink!==1) fail('E_PATH',`inspection requires a single-link regular file: ${file}`);
  const fd=fs.openSync(file,fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened=fs.fstatSync(fd);
    if(!opened.isFile() || opened.nlink!==1 || opened.dev!==stat.dev || opened.ino!==stat.ino) fail('E_PATH',`inspection file changed: ${file}`);
    if(limit===undefined) return {text:fs.readFileSync(fd,'utf8')};
    const bytes=Buffer.alloc(Math.min(opened.size,limit));let length=0;
    while(length<bytes.length) { const n=fs.readSync(fd,bytes,length,bytes.length-length,null);if(!n) break;length+=n; }
    const truncated=opened.size>limit;
    let text=bytes.subarray(0,length).toString('utf8');
    if(truncated && text.endsWith('\uFFFD')) text=text.slice(0,-1);
    return {text,...(truncated?{truncated:true,bytes:opened.size}:{})};
  } finally {fs.closeSync(fd);}
}
function identityJSON(text,label) {
  // JSON.parse diagnostics may include raw input from a replacement home.
  // Report the failed verification, never those untrusted bytes.
  try {return JSON.parse(text);} catch {fail('E_SOURCE',`invalid ${label} JSON in source home`);}
}
function liveHome(source,status) {
  if(status.retired) return {available:false,reason:'retired'};
  try {
    safePath(source.home);
    const stat=fs.lstatSync(source.home);
    if(!stat.isDirectory()) return {available:false,reason:'identity-mismatch'};
    const marker=regular(markerPath(source.home));
    if(!marker) return {available:false,reason:'missing-marker'};
    const m=identityJSON(marker.text,'source marker');
    // Never load a replacement descriptor or trust the invoking home/env when
    // inspecting an explicitly selected durable source.
    if(m?.version!==1 || m.id!==source.id || m.source!==source.file) return {available:false,reason:'identity-mismatch'};
    const metadata=regular(join(source.home,'instance.json'));
    if(metadata) {
      const meta=identityJSON(metadata.text,'instance metadata');
      if(meta?.instance!==source.instance || meta.agent!==source.agent) return {available:false,reason:'identity-mismatch'};
    }
    return {available:true,reason:'live',dev:stat.dev,ino:stat.ino};
  } catch(e) {
    if(missing(e)) return {available:false,reason:'missing-home'};
    // Unsafe/unreadable identity is not proof of a live source. Durable state
    // remains inspectable, but no document from that home may be returned.
    return {available:false,reason:'unverified-home',error:{code:e.code || 'E_SOURCE',message:e.message}};
  }
}
export function workingDocuments(source,status=loadStatus(source)) {
  const before=liveHome(source,status),observedAt=new Date().toISOString();
  const unavailable=state=>({liveMemory:{available:false,reason:state.reason,observedAt,...(state.error?{error:state.error}:{})},documents:[]});
  if(!before.available) return unavailable(before);
  const documents=[];
  const doc=(label,file)=>{
    const content=regular(file,DOCUMENT_BYTES);
    if(content) documents.push({label,kind:'markdown',path:file,...content});
  };
  let error;
  try {
    doc('Working state (STATE.md)',join(source.home,'STATE.md'));
    doc('Log (log.md)',join(source.home,'log.md'));
    const notes=safePath(join(source.home,'notes'));
    function walk(dir,prefix='') {
      let entries;try {entries=fs.readdirSync(dir,{withFileTypes:true});} catch(e) {if(e.code==='ENOENT') return;throw e;}
      for(const entry of entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)) {
        const name=prefix+entry.name,file=join(dir,entry.name);
        // No symlink traversal, including directories or non-Markdown aliases.
        safePath(file);
        if(entry.isDirectory()) walk(file,name+'/');
        else if(entry.name.endsWith('.md')) doc(`Pending note: ${name}`,file);
      }
    }
    walk(notes);
  } catch(e) {error=e;}
  const after=liveHome(source,loadStatus(source));
  if(!after.available) return unavailable(after);
  if(before.dev!==after.dev || before.ino!==after.ino) return unavailable({reason:'home-changed'});
  if(error) fail(error.code==='E_PATH'?'E_PATH':'E_INSPECT_FAILED',error.message);
  return {liveMemory:{available:true,reason:'live',observedAt},documents};
}
export function capturedAuthority(source) {
  const fields=['registration','providerBinding','sourceIdentity','executionBinding','responsibleHuman'],present=fields.filter(key=>Object.hasOwn(source,key));
  const base={schemaVersion:1};
  if(!present.length) return {...base,registration:'legacy',capture:'unknown',migrationRequired:true,responsibleHuman:{status:'unknown'}};
  const binding=source.executionBinding,identity=source.sourceIdentity,complete=source.registration?.schemaVersion===1 && source.registration.kind==='captured'
    && source.providerBinding && typeof source.providerBinding==='object' && identity && typeof identity==='object' && !Array.isArray(identity)
    && binding?.schemaVersion===1 && typeof binding.deployment==='string' && binding.resolution?.schemaVersion===1 && typeof binding.resolution.id==='string'
    && Object.hasOwn(source,'responsibleHuman');
  const invalid={...base,registration:'invalid',capture:'invalid',migrationRequired:true,responsibleHuman:{status:'unknown'}};
  if(!complete) return invalid;
  try {if(Buffer.byteLength(JSON.stringify({identity,binding}))>64*1024) return invalid;qualifiedSoulIdentity(identity);} catch {return invalid;}
  return {...base,registration:'captured',capture:'recorded',migrationRequired:false,sourceIdentity:JSON.parse(JSON.stringify(identity)),executionBinding:JSON.parse(JSON.stringify(binding)),
    responsibleHuman:{status:source.responsibleHuman===null?'disabled':'specified'}};
}
export function inspect(source) {
  const status=loadStatus(source),working=workingDocuments(source,status);
  let health;try {health=oats(['schedule','list','--dir',source.context,'--json'],source.context).scheduler;} catch(e) {health={active:false,error:e.message};}
  const documents=[...working.documents,{label:'Durable processing receipts',kind:'text',path:join(dirname(source.file),'status.json'),text:JSON.stringify(status,null,2)}];
  return {
    summary:`OKF ${source.id}: ${status.captured.inputs.length-status.processed.length} unprocessed inputs; ${status.retired?'source retired':'source not retired'}; ${working.liveMemory.available?`${working.documents.length} working-memory documents`:`live memory unavailable (${working.liveMemory.reason})`}`,
    source:source.file,owns:source.decl.owns,reads:source.decl.reads,bases:source.bindings.bases,authority:capturedAuthority(source),
    acceptedView:source.acceptedView,status,scheduler:health,liveMemory:working.liveMemory,documents
  };
}
