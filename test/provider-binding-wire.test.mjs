import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeBindingResponse, validateBindingRequest } from '../lib/provider-binding-wire.mjs';
import { providerReasons } from '../lib/provider-reasons.mjs';
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
test('only exact trusted reason literals cross error and check responses; output cannot declare its own whitelist',()=>{
  const reason='fixed configuration reason',reasons=[reason];
  const failure=message=>JSON.stringify({schemaVersion:1,phase:request.phase,slot:request.slot,capability:request.capability,ok:false,error:{code:'needs-configuration',message}});
  assert.deepEqual(decodeBindingResponse(failure(reason),request,{reasons}),{ok:false,error:{code:'needs-configuration',message:reason}});
  for(const message of ['private-operator-value','/private/operator/store',reason+' ',reason+' /private/path',reason.replace('fixed','ﬁxed'),'fixed café']) {
    assert.deepEqual(decodeBindingResponse(failure(message),request,{reasons}),{ok:false,error:{code:'needs-configuration'}});
  }
  assert.deepEqual(decodeBindingResponse(failure(reason),request,{reasons:[]}),{ok:false,error:{code:'needs-configuration'}});
  const forged=JSON.parse(failure(reason));forged.error.reasons=[reason];
  assert.throws(()=>decodeBindingResponse(JSON.stringify(forged),request),{code:'invalid-binding-output'});
  const cross=JSON.parse(failure(reason));cross.capability='example.other';
  assert.throws(()=>decodeBindingResponse(JSON.stringify(cross),request,{reasons}),{code:'invalid-binding-output'});
  const check={...request,phase:'check',input:{context:request.input.context,action:{kind:'inspect'},binding:{schemaVersion:1,capability:request.capability,payloadContract:'example.locations',payloadVersion:1,payload:{},credentialRefs:{},provenance:[]}}};
  const answer=JSON.stringify({schemaVersion:1,phase:'check',slot:check.slot,capability:check.capability,ok:true,result:{status:'needs-configuration',problems:[{code:'needs-configuration',message:reason},{code:'needs-configuration',message:'/private/operator/store'}]}});
  assert.deepEqual(decodeBindingResponse(answer,check,{reasons}).result,{status:'needs-configuration',problems:[{code:'needs-configuration',message:reason},{code:'needs-configuration'}]});
});

test('complete bundled reasons are capability-scoped, explicit declarations override them and code-only stays code-only',()=>{
  for(const [capability,slot,count,example] of [
    ['oats.aweb','messaging',30,'messaging workspace must declare private: per-human'],
    ['oats.okf','knowledge',7,'setting bindings-file is required (absolute host path)'],
  ]) {
    const selected={...request,capability,slot},reasons=providerReasons({capability});
    assert.equal(reasons.length,count); assert.ok(reasons.includes(example)); assert.ok(Object.isFrozen(reasons));
    const encode=message=>JSON.stringify({schemaVersion:1,phase:selected.phase,slot,capability,ok:false,error:{code:'needs-configuration',...(message===undefined?{}:{message})}});
    for(const message of reasons) {
      assert.deepEqual(decodeBindingResponse(encode(message),selected),{ok:false,error:{code:'needs-configuration',message}});
      assert.deepEqual(decodeBindingResponse(encode(message+' '),selected),{ok:false,error:{code:'needs-configuration'}});
    }
    for(const declared of [['different fixed reason']]) {
      const manifest={capability,binding:{reasons:declared}};
      assert.deepEqual(decodeBindingResponse(encode(example),selected,{reasons:providerReasons(manifest)}),{ok:false,error:{code:'needs-configuration'}});
    }
    assert.throws(()=>providerReasons({capability,binding:{reasons:[]}}),{code:'invalid-declaration'}, 'present invalid declarations never fall back');
    assert.deepEqual(decodeBindingResponse(encode(undefined),selected),{ok:false,error:{code:'needs-configuration'}},'no missing-item inference for released code-only providers');
  }
  const foreign={...request,capability:'example.other'};
  const message=providerReasons({capability:'oats.aweb'})[0];
  const error=JSON.stringify({schemaVersion:1,phase:foreign.phase,slot:foreign.slot,capability:foreign.capability,ok:false,error:{code:'needs-configuration',message}});
  assert.deepEqual(decodeBindingResponse(error,foreign),{ok:false,error:{code:'needs-configuration'}});
});

test('non-ready successful check envelopes retain only whitelisted private-team reasons without changing shape',()=>{
  const capability='oats.aweb',slot='messaging',message='an explicit private-team binding is required';
  const check={...request,capability,slot,phase:'check',input:{context:request.input.context,action:{kind:'inspect'},binding:{schemaVersion:1,capability,payloadContract:'fixture.messaging',payloadVersion:1,payload:{},credentialRefs:{},provenance:[]}}};
  const encode=value=>JSON.stringify({schemaVersion:1,phase:'check',capability,slot,ok:true,result:{status:'needs-configuration',problems:[{code:'needs-configuration',message:value}]}});
  assert.deepEqual(decodeBindingResponse(encode(message),check),{ok:true,result:{status:'needs-configuration',problems:[{code:'needs-configuration',message}]}});
  assert.deepEqual(decodeBindingResponse(encode(message+' /private/path'),check),{ok:true,result:{status:'needs-configuration',problems:[{code:'needs-configuration'}]}});
  assert.deepEqual(decodeBindingResponse(encode(message),check,{reasons:['another fixed reason']}),{ok:true,result:{status:'needs-configuration',problems:[{code:'needs-configuration'}]}});
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
