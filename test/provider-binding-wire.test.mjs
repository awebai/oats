import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeBindingResponse, validateBindingRequest } from '../lib/provider-binding-wire.mjs';
import { invocationFixture } from './helpers/captured-invocation.mjs';
import { validateWire } from './helpers/portable-schema-check.mjs';
const origin={kind:'soul-requirement',document:{kind:'operator',id:'fixture-source'},pointer:'/knowledge'};
const request={schemaVersion:1,phase:'normalize',slot:'knowledge',capability:'example.knowledge',settings:{},
  input:{context:{kind:'standalone',key:null},declarations:[{kind:'soul',value:{knowledge:{}},origin,origins:{'/knowledge':origin}}]}};
const result={requirements:[{key:'/bindings/knowledge/store',kind:'required',origin}],candidates:[],model:{}};
const response=value=>JSON.stringify({schemaVersion:1,phase:request.phase,slot:request.slot,capability:request.capability,ok:true,result:value});

test('binding normalization validates owned fields and original authority before the common resolver',()=>{
  assert.equal(decodeBindingResponse(response(result),request).ok,true);
  for (const changed of [
    {...result,requirements:[{...result.requirements[0],key:'/layers/messaging'}]},
    {...result,requirements:[{...result.requirements[0],origin:{...origin,pointer:'/invented'}}]},
    {...result,requirements:[],candidates:[{key:'/bindings/knowledge/store',kind:'operator',value:1,origin:{...origin,kind:'operator'}}]},
    {...result,requirements:[],candidates:[{key:'/bindings/knowledge/store',kind:'operator',value:1,origin:{...origin,kind:'soul-default'}}]},
  ]) assert.throws(()=>decodeBindingResponse(response(changed),request),{code:'invalid-binding-output'});
});
test('binding wire rejects malformed, duplicate, oversized and cross-provider output without leaking raw content',()=>{
  for (const bytes of [Buffer.from([0xff]),'{"secret-do-not-echo":',response(result)+'{}',response(result).replace('"ok":true','"ok":true,"ok":true'),
    response(result).replace('example.knowledge','example.other'),' '.repeat(1024*1024+1)]) {
    assert.throws(()=>decodeBindingResponse(bytes,request),error=>error.code==='invalid-binding-output' && !error.message.includes('secret-do-not-echo'));
  }
  const error=JSON.stringify({schemaVersion:1,phase:'normalize',slot:'knowledge',capability:'example.knowledge',ok:false,error:{code:'needs-configuration',message:'secret-do-not-echo'}});
  assert.deepEqual(decodeBindingResponse(error,request),{ok:false,error:{code:'needs-configuration'}});
});
test('check invocation is optional and matches the existing action, context and capability wire',()=>{
  const invocation=invocationFixture({capability:request.capability});
  const check={...request,phase:'check',input:{binding:{schemaVersion:1,capability:request.capability,payloadContract:'example.locations',payloadVersion:1,payload:{},credentialRefs:{},provenance:[]},
    context:invocation.context,action:invocation.action}};
  validateBindingRequest(check);validateWire('ProviderCheckInput',check.input);
  const captured={...check,input:{...check.input,invocation}};
  validateBindingRequest(captured);validateWire('ProviderCheckInput',captured.input);
  for(const changed of [
    null,{...invocation,context:{kind:'standalone',key:'other-context'}},
    {...invocation,action:{...invocation.action,name:'other-action'}},
    {...invocation,capability:'example.other'},
    {...invocation,subject:{kind:'helper',identity:null,alias:'fake-identity'}},
    {...invocation,priorReceipt:'x'.repeat(128*1024+1)},
  ]) assert.throws(()=>validateBindingRequest({...captured,input:{...captured.input,invocation:changed}}));
  assert.throws(()=>validateBindingRequest({...request,input:{...request.input,invocation}}),'normalize accepts no invocation field');
});

test('binding checks preserve non-ready status and cannot return ready with problems',()=>{
  const check={...request,phase:'check',input:{context:request.input.context,action:{kind:'command'},binding:{schemaVersion:1,capability:request.capability,
    payloadContract:'example.locations',payloadVersion:1,payload:{},credentialRefs:{token:{kind:'env',name:'EXAMPLE_TOKEN'}},provenance:[]}}};
  validateBindingRequest(check);
  const encode=result=>JSON.stringify({schemaVersion:1,phase:'check',slot:'knowledge',capability:request.capability,ok:true,result});
  assert.deepEqual(decodeBindingResponse(encode({status:'unavailable',problems:[{code:'provider-unavailable',message:'do not echo'}]}),check),
    {ok:true,result:{status:'unavailable',problems:[{code:'provider-unavailable'}]}});
  assert.throws(()=>decodeBindingResponse(encode({status:'ready',problems:[{code:'provider-unavailable'}]}),check),{code:'invalid-binding-output'});
  assert.throws(()=>validateBindingRequest({...check,input:{...check.input,binding:{...check.input.binding,credentialRefs:{token:{kind:'env',name:'TOKEN',value:'secret'}}}}}));
});
