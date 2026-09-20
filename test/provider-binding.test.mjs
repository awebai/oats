import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBindingInterface } from '../lib/provider-binding.mjs';
import { hasExecutableSurface } from '../lib/capability-execution.mjs';
import { providerReasons } from '../lib/provider-reasons.mjs';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

test('binding phases reuse owned executable commands and introduce no implicit provider', () => {
  assert.equal(validateBindingInterface({capability:'example.tools'}), null);
  const manifest={capability:'example.provider',layer:'tasks',commands:{binding:'binding.mjs'},binding:{version:1,normalize:'binding',bind:'binding',check:'binding'}};
  assert.equal(validateBindingInterface(manifest),manifest.binding);
  assert.equal(hasExecutableSurface(manifest),true);
});
test('binding reason declarations agree with the published schema and explicit empty overrides compatibility reasons', () => {
  const base={capability:'oats.aweb',version:'1.11.0',description:'Inert manifest',layer:'messaging',commands:{binding:'binding.mjs'},binding:{version:1,normalize:'binding',bind:'binding',check:'binding'}};
  const validate=new Ajv2020({strict:false,allowUnionTypes:true}).compile(JSON.parse(readFileSync(new URL('../docs/capability-manifest.schema.json',import.meta.url),'utf8')));
  for(const reasons of [[],['fixed safe reason'],['fixed café reason','another fixed reason']]) {
    const manifest={...base,binding:{...base.binding,reasons}};
    assert.equal(validate(manifest),true,JSON.stringify(validate.errors));
    assert.equal(validateBindingInterface(manifest),manifest.binding);
    assert.deepEqual(providerReasons(manifest),reasons);
  }
  for(const reasons of [null,'not an array',[1],[''],['duplicate','duplicate'],['line\nbreak'],['control\u001bescape']]) {
    const manifest={...base,binding:{...base.binding,reasons}};
    assert.equal(validate(manifest),false,JSON.stringify(reasons));
    assert.throws(()=>validateBindingInterface(manifest),{code:'invalid-declaration'});
  }
  assert.deepEqual(providerReasons({capability:'unknown.provider'}),[]);
  assert.deepEqual(providerReasons({capability:'__proto__'}),[]);
});

test('binding declarations refuse missing commands, wrong owner slot, unknown fields and versions', () => {
  const base={layer:'knowledge',commands:{binding:'binding.mjs'},binding:{version:1,normalize:'binding',bind:'binding',check:'binding'}};
  assert.throws(()=>validateBindingInterface({...base,layer:undefined}),{code:'invalid-binding-interface'});
  assert.throws(()=>validateBindingInterface({...base,commands:{}}),{code:'invalid-binding-interface'});
  assert.throws(()=>validateBindingInterface({...base,binding:{...base.binding,version:2}}));
  assert.throws(()=>validateBindingInterface({...base,binding:{...base.binding,script:'unowned.mjs'}}),{code:'invalid-declaration'});
});
