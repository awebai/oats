import { isAbsolute, resolve } from 'node:path';
import { fail, relPath } from './io.mjs';
const obj=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const invalid=()=>fail('E_SOURCE','invalid nonsecret qualified source identity');
function exact(value,fields) {if(!obj(value) || Object.keys(value).some(key=>!fields.includes(key)) || fields.some(key=>!Object.hasOwn(value,key))) invalid();}

/** Provider-owned nonsecret locator contract; no I/O, source resolver or secret
 * lookup. Authentication remains in the native credential transport. */
export function validateRepositoryLocator(value) {
  const bad=()=>fail('E_CONFIG','Git repository must not contain credentials, query, fragment or malformed paths');
  if(typeof value!=='string' || /[\s\\\x00-\x1f\x7f?#]/.test(value)) bad();
  const scp=/^(git)@([^/:]+):(.+)$/.exec(value);
  const spelling=scp?`ssh://${scp[1]}@${scp[2]}${scp[3].startsWith('/')?'':'/'}${scp[3]}`:value;
  if(!/^(https|ssh):\/\//.test(spelling)) bad();
  const pathStart=spelling.indexOf('/',spelling.indexOf('://')+3);
  if(pathStart<0) bad();
  for(const part of spelling.slice(pathStart+1).split('/')) {
    let decoded;try{decoded=decodeURIComponent(part);}catch{bad();}
    if(!part || decoded==='.' || decoded==='..' || /[/\\\x00-\x1f\x7f]/.test(decoded)) bad();
  }
  let url;try{url=new URL(spelling);}catch{bad();}
  if(!url.hostname || url.password || url.search || url.hash || (url.protocol==='https:' && url.username)) bad();
  if(scp) {if(value!==`${scp[1]}@${url.hostname}:${scp[3]}`) bad();}
  else if(url.href!==value) bad();
  return value;
}
export function qualifiedSoulIdentity(value) {
  try {
    if(value?.kind==='git-soul') {
      exact(value,['kind','repository','exportPath']);const r=value.repository;
      if(r?.kind==='provider-repository') {
        exact(r,['kind','provider','host','id']);
        if(typeof r.provider!=='string' || !/^[a-z][a-z0-9.-]*$/.test(r.provider) || typeof r.host!=='string' || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(r.host) || typeof r.id!=='string' || !r.id || /[\x00-\x1f\x7f]/.test(r.id)) invalid();
      } else {
        exact(r,['kind','remote']);if(r.kind!=='canonical-remote' || typeof r.remote!=='string' || !r.remote.startsWith('git:')) invalid();
        validateRepositoryLocator(r.remote.slice(4));
      }
    } else if(value?.kind==='local-soul') {
      exact(value,['kind','source','exportPath']);
      if(typeof value.source!=='string' || !value.source.startsWith('path:') || /[\x00-\x1f\x7f]/.test(value.source)) invalid();
      const p=value.source.slice(5);if(!isAbsolute(p) || resolve(p)!==p) invalid();
    } else invalid();
    relPath(value.exportPath,value.kind==='local-soul');
    return JSON.parse(JSON.stringify(value));
  } catch {invalid();}
}
