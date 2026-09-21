import test from 'node:test';
import assert from 'node:assert/strict';
import { captureHelperInjectionChoices, helperInjectionFact, helperInjectionChoiceKey, verifyHelperInjectionPolicies } from '../lib/helper-injection-policy.mjs';

// Policy-data tests only. Retained file containment, publication and lifecycle
// callers require their own integration tests; this is not runtime authority.
function fixture(mode='inherit') {
  const artifact={kind:'capability',capability:'example.instructions',integrity:{format:'oats.tree.v1',value:`sha256-${'a'.repeat(64)}`}};
  const declaration={capability:artifact.capability,version:'1',inject:'inject.md',...(mode===null?{}:{helperInjection:{version:1,mode,...(mode==='file'?{path:'helper.md'}:{})}})};
  const definition={artifact,bytes:Buffer.from(JSON.stringify(declaration))},plan={requirements:[],candidates:[]};
  const policy=helperInjectionFact(definition),captured=mode===null?{choices:{}}:captureHelperInjectionChoices(plan,[definition]);
  const record={subject:{kind:'helper'},artifacts:{capabilities:{[artifact.capability]:{artifact}}},choices:captured.choices,resources:{},dispatch:{composition:{blocks:[],omissions:[]}}};
  if(policy.fact){
    if(policy.resource){record.resources[policy.resourceKey]=policy.resource;record.dispatch.composition.blocks.push({source:policy.source,resource:policy.resourceKey,choice:policy.fact.key});}
    else record.dispatch.composition.omissions.push({source:policy.source,reason:'helper-policy',choice:policy.fact.key});
  }
  return {artifact,definition,plan,record,policy};
}

test('helper modes retain distinct declared resources and exact hard manifest witnesses',()=>{
  for(const mode of ['inherit','omit','file']){
    const f=fixture(mode);verifyHelperInjectionPolicies(f.record,[f.definition],{publishing:true});
    assert.equal(f.policy.fact.key,helperInjectionChoiceKey(f.artifact.capability));
    assert.equal(f.policy.fact.origin.document.owner,f.artifact);assert.equal(f.policy.fact.origin.pointer,'/helperInjection');
    assert.equal(f.policy.resource?.path,mode==='file'?'helper.md':mode==='inherit'?'inject.md':undefined);
    const primary=structuredClone(f.record);primary.subject.kind='persistent';primary.choices={};primary.dispatch.composition={blocks:[],omissions:[]};
    verifyHelperInjectionPolicies(primary,[f.definition]);
  }
});

test('helper witnesses cannot authorize forged owner/path/origin or another contribution',()=>{
  const f=fixture('file');
  for(const mutate of [
    r=>{r.resources[f.policy.resourceKey].path='other.md';},
    r=>{r.resources[f.policy.resourceKey].owner.integrity.value=`sha256-${'b'.repeat(64)}`;},
    r=>{r.choices[f.policy.fact.key].constraints[0].origin.pointer='/other';},
    r=>{delete r.choices[f.policy.fact.key];},
    r=>{r.choices['/capabilities/other']=structuredClone(r.choices[f.policy.fact.key]);},
    r=>{r.dispatch.composition.blocks.push({source:'config:other',resource:f.policy.resourceKey,choice:f.policy.fact.key});},
    r=>{r.dispatch.composition.blocks[0].choice='/operator/other';},
  ]){const record=structuredClone(f.record);mutate(record);assert.throws(()=>verifyHelperInjectionPolicies(record,[f.definition]));}
  const omitted=fixture('omit'),record=structuredClone(omitted.record);
  record.dispatch.composition.omissions.push({source:'capability:other',reason:'helper-policy',choice:omitted.policy.fact.key});
  assert.throws(()=>verifyHelperInjectionPolicies(record,[omitted.definition]));
  const primary=structuredClone(f.record);primary.subject.kind='persistent';assert.throws(()=>verifyHelperInjectionPolicies(primary,[f.definition]));
});

test('existing resolver rejects explicit incompatible disable/override without changing policy priority',()=>{
  const f=fixture('file'),key=f.policy.fact.key,origin={kind:'operator',document:{kind:'operator',id:'fixture'},pointer:'/choice'};
  for(const value of [null,'instruction:capability:other'])assert.throws(()=>captureHelperInjectionChoices({...f.plan,candidates:[{key,kind:'operator',value,origin}]},[f.definition]),{code:'requirement-conflict'});
  const same=captureHelperInjectionChoices({...f.plan,candidates:[{key,kind:'operator',value:f.policy.fact.value,origin}]},[f.definition]);
  assert.equal(same.choices[key].value,f.policy.fact.value);assert.deepEqual(same.choices[key].selectedBy,origin);
  const old=fixture(null);assert.throws(()=>captureHelperInjectionChoices(old.plan,[old.definition]),{code:'needs-configuration'});
  old.record.dispatch.composition.omissions.push({source:'capability:example.instructions',reason:'helper-knowledge'});
  verifyHelperInjectionPolicies(old.record,[old.definition]);
  assert.throws(()=>verifyHelperInjectionPolicies(old.record,[old.definition],{publishing:true}),{code:'needs-configuration'});
});

test('an inject without a helperInjection policy refuses WITH the offending capability attributed',()=>{
  // Second-operator finding (2026-09-21): the bare refusal made every edition unpublishable with
  // no way to tell which sibling had not adopted the contract.
  const f=fixture(null);
  let error;
  try{captureHelperInjectionChoices(f.plan,[f.definition]);}catch(e){error=e;}
  assert.equal(error?.code,'needs-configuration');
  assert.deepEqual(error.problems,[{code:'needs-configuration',message:'capability ships an inject without a helperInjection policy',capability:'example.instructions'}]);
});
