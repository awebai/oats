import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateHelperInjection, validateHookInputs, validateCapabilityInputDeclarations } from '../lib/capability-inputs.mjs';

test('helper instruction declarations are closed explicit own-field version1 values', () => {
  for (const value of [{version:1,mode:'inherit'},{version:1,mode:'omit'},{version:1,mode:'file',path:'injects/helper.md'}]) assert.equal(validateHelperInjection(value),value);
  for (const value of [null,false,{},[],{version:2,mode:'omit'},{version:1,mode:'other'},{version:1,mode:'file'},
    {version:1,mode:'inherit',path:'helper.md'},{version:1,mode:'omit',capability:'other'},Object.create({version:1,mode:'omit'})]) assert.throws(()=>validateHelperInjection(value));
  for (const path of ['','/absolute','../escape','a/../escape','a//b','a/./b','C:/absolute','a\\b','a\0b','.']) assert.throws(()=>validateHelperInjection({version:1,mode:'file',path}));
});

test('published manifest schema agrees with explicit helper policies and existing hook input forms', () => {
  const schema=JSON.parse(readFileSync(new URL('../docs/capability-manifest.schema.json',import.meta.url),'utf8'));
  const validate=new Ajv2020({strict:false}).compile(schema),base={capability:'example.instructions',version:'1.0.0',description:'Fixture'};
  for(const helperInjection of [{version:1,mode:'inherit'},{version:1,mode:'omit'},{version:1,mode:'file',path:'injects/helper.md'}]) {
    assert.equal(validate({...base,helperInjection}),true,JSON.stringify(validate.errors));
  }
  for(const event of ['spawn','retire','launch','soul-scaffold'])assert.equal(validate({...base,hooks:{[event]:{command:'hook.mjs',inputs:{sourceReceipt:{version:1}},...(event==='spawn'?{required:true}:{})}}}),true,JSON.stringify(validate.errors));
  for(const bad of [{helperInjection:{version:1,mode:'file',path:'../escape'}},{helperInjection:{version:2,mode:'omit'}},
    {hooks:{retire:{command:'retire.mjs',required:true}}},{hooks:{spawn:{command:'spawn.mjs',inputs:{sourceReceipt:{version:1,other:true}}}}}])assert.equal(validate({...base,...bad}),false);
});

test('source receipt opt-in is versioned closed data, never inferred from absence or provider slot', () => {
  const empty={},selected={sourceReceipt:{version:1}};
  assert.equal(validateHookInputs(empty),empty);assert.equal(validateHookInputs(selected),selected);
  for (const value of [null,false,[],{sourceReceipt:null},{sourceReceipt:false},{sourceReceipt:{}},{sourceReceipt:{version:2}},
    {sourceReceipt:{version:1,path:'/nominated'}},{anotherContract:{version:1}},Object.create({sourceReceipt:{version:1}})]) assert.throws(()=>validateHookInputs(value));
  const absent={layer:'knowledge',hooks:{spawn:{command:'spawn.mjs',required:true},retire:'retire.mjs'}};
  assert.equal(validateCapabilityInputDeclarations(absent),absent);assert.equal(Object.hasOwn(absent.hooks.spawn,'inputs'),false);
  const declared={helperInjection:{version:1,mode:'omit'},hooks:{spawn:{command:'spawn.mjs',required:true,inputs:selected},retire:{command:'retire.mjs',inputs:{}}}};
  assert.equal(validateCapabilityInputDeclarations(declared),declared);assert.equal(declared.hooks.spawn.required,true);assert.equal(Object.hasOwn(declared.hooks.retire,'required'),false);
  assert.throws(()=>validateCapabilityInputDeclarations({hooks:{spawn:{command:'spawn.mjs',inputs:null}}}));
  assert.throws(()=>validateCapabilityInputDeclarations({helperInjection:null}));
});
