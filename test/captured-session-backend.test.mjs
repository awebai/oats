import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWire } from './helpers/portable-schema-check.mjs';
import { validateCapturedSessionBackend,validateCapturedSessionTarget,assertCapturedSessionPlacement } from '../lib/captured-session-backend.mjs';

test('captured Herdr22 schema and runtime boundaries preserve exact selected protocol',()=>{
  for(const protocol of [20,22]){
    const backend={backend:'herdr',binary:'/bin/herdr',socket:'/tmp/herdr.sock',protocol};
    const target={...backend,workspaceId:'w',paneId:'p',terminalId:'t'};
    validateCapturedSessionBackend(backend);validateCapturedSessionTarget(target,backend,'i');
    validateWire('CapturedSessionRequest',{schemaVersion:1,backend,task:'explicit'});validateWire('CapturedSessionTarget',target);
    assert.throws(()=>validateCapturedSessionTarget({...target,protocol:protocol===20?22:20},backend,'i'),{code:'E_RUNTIME_AUTHORITY_MISMATCH'});
    assert.throws(()=>assertCapturedSessionPlacement({instance:'i',launched:true,sessionTarget:target},backend,[]),{code:'E_RUNTIME_AUTHORITY_MISMATCH'});
    assertCapturedSessionPlacement({instance:'i',launched:true,sessionTarget:target},backend,[target]);
  }
  for(const protocol of [21,23,'22',null]){
    const backend={backend:'herdr',binary:'/bin/herdr',socket:'/tmp/herdr.sock',protocol};
    assert.throws(()=>validateCapturedSessionBackend(backend));assert.throws(()=>validateWire('CapturedSessionRequest',{schemaVersion:1,backend}));
  }
});

test('captured native backend inputs are closed tagged endpoint shapes, not caller-created Herdr identities',()=>{
  const tmux={backend:'tmux',binary:'/bin/tmux',socket:'/tmp/tmux.sock',session:'fixture'},herdr={backend:'herdr',binary:'/bin/herdr',socket:'/tmp/herdr.sock',protocol:20};
  assert.equal(validateCapturedSessionBackend(tmux),tmux);assert.equal(validateCapturedSessionBackend(herdr),herdr);
  for(const backend of [tmux,herdr])validateWire('CapturedSessionRequest',{schemaVersion:1,backend,task:'explicit task'});
  assert.throws(()=>validateWire('CapturedSessionRequest',{schemaVersion:1,backend:{...herdr,session:'wrong-shape'}}));
  for(const value of [{...herdr,session:'fake'},{...tmux,protocol:20},{...herdr,protocol:19},{...herdr,paneId:'p1'},{...herdr,binary:'herdr'},{...herdr,socket:'/tmp/../other'}])assert.throws(()=>validateCapturedSessionBackend(value));
  const target={...herdr,workspaceId:'w1',paneId:'w1:p1',terminalId:'term_native'};
  assert.equal(validateCapturedSessionTarget(target,herdr,'instance'),target);validateWire('CapturedSessionTarget',target);
  assert.throws(()=>assertCapturedSessionPlacement({instance:'instance',sessionTarget:target},herdr,[]),{code:'E_RUNTIME_AUTHORITY_MISMATCH'});
  assertCapturedSessionPlacement({instance:'instance',launched:true,sessionTarget:target},herdr,[target]);
  assert.throws(()=>assertCapturedSessionPlacement({instance:'instance',tmux:{session:'foreign'}},herdr,[target]),{code:'E_RUNTIME_AUTHORITY_MISMATCH'});
  assert.throws(()=>validateCapturedSessionTarget({...target,socket:'/tmp/other.sock'},herdr,'instance'),{code:'E_RUNTIME_AUTHORITY_MISMATCH'});
});
