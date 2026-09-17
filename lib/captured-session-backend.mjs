/** Closed inputs for the existing native session adapters. No config lookup,
 * endpoint allocation, backend registry or runtime/provider readiness probe. */
import { isAbsolute, resolve } from 'node:path';
import { canonicalJson } from './portable-values.mjs';
import { objectAt } from './portable-shape.mjs';
import { HERDR_PROTOCOL, validHerdrTarget } from './herdr.mjs';
import { oatsError } from './errors.mjs';

const same = (a,b) => canonicalJson(a) === canonicalJson(b);
const absolute = value => typeof value === 'string' && isAbsolute(value) && resolve(value) === value && !value.includes('\0');
export function validateCapturedSessionBackend(value) {
  canonicalJson(value);
  const fields=value?.backend==='herdr'?['backend','binary','socket','protocol']:['backend','binary','socket','session'];
  objectAt(value,fields,fields);
  if(!['tmux','herdr'].includes(value.backend)||!absolute(value.binary)||!absolute(value.socket))throw oatsError('needs-configuration','captured native backend needs explicit normalized host binary/socket');
  if(value.backend==='herdr'){
    if(value.protocol!==HERDR_PROTOCOL)throw oatsError('needs-configuration',`captured Herdr requires protocol ${HERDR_PROTOCOL}`);
  }else if(typeof value.session!=='string'||!/^[A-Za-z0-9_-]+$/.test(value.session))throw oatsError('needs-configuration','captured tmux needs an explicit supported session name');
  return value;
}

export function validateCapturedSessionTarget(value,backend,instance) {
  validateCapturedSessionBackend(backend);canonicalJson(value);
  if(backend.backend==='tmux'){
    objectAt(value,['backend','session','window','socket'],['backend','session','window','socket']);
    if(!same(value,{backend:'tmux',session:backend.session,window:instance,socket:backend.socket}))throw oatsError('E_RUNTIME_AUTHORITY_MISMATCH','captured tmux target differs from admitted endpoint');
  }else{
    objectAt(value,['backend','binary','socket','protocol','workspaceId','paneId','terminalId'],['backend','binary','socket','protocol','workspaceId','paneId','terminalId']);
    if(!validHerdrTarget(value)||value.binary!==backend.binary||value.socket!==backend.socket||value.protocol!==backend.protocol
      ||[value.workspaceId,value.paneId,value.terminalId].some(id=>id.includes('\0')))throw oatsError('E_RUNTIME_AUTHORITY_MISMATCH','captured Herdr target differs from admitted endpoint/identifier contract');
  }
  return value;
}

/** First placement admits a server endpoint, not caller-chosen Herdr IDs.
 * Subsequent IDs must come from independently retained native observations. */
export function assertCapturedSessionPlacement(metadata,backend,knownTargets=[]) {
  validateCapturedSessionBackend(backend);
  if(typeof metadata.launched!=='boolean')throw oatsError('E_RUNTIME_AUTHORITY_MISMATCH','captured metadata lacks native launch state');
  if(metadata.launched&&!Object.hasOwn(metadata,backend.backend==='herdr'?'sessionTarget':'tmux'))throw oatsError('E_RUNTIME_AUTHORITY_MISMATCH','launched metadata lacks its native target');
  if(Object.hasOwn(metadata,'backend')&&metadata.backend!==backend.backend)throw oatsError('E_RUNTIME_AUTHORITY_MISMATCH','captured metadata selects a different backend');
  if(backend.backend==='tmux'){
    if(Object.hasOwn(metadata,'sessionTarget'))throw oatsError('E_RUNTIME_AUTHORITY_MISMATCH','Herdr target cannot redirect captured tmux');
    if(Object.hasOwn(metadata,'tmux'))validateCapturedSessionTarget({backend:'tmux',...metadata.tmux},backend,metadata.instance);
  }else{
    if(Object.hasOwn(metadata,'tmux'))throw oatsError('E_RUNTIME_AUTHORITY_MISMATCH','tmux metadata cannot redirect captured Herdr');
    if(Object.hasOwn(metadata,'sessionTarget')){
      validateCapturedSessionTarget(metadata.sessionTarget,backend,metadata.instance);
      if(!knownTargets.some(target=>same(target,metadata.sessionTarget)))throw oatsError('E_RUNTIME_AUTHORITY_MISMATCH','Herdr metadata target lacks independent indexed custody');
    }
  }
}
