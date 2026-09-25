import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBindingInterface } from '../lib/provider-binding.mjs';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

test('binding phases name owned commands and introduce no implicit provider', () => {
  assert.equal(validateBindingInterface({capability:'example.tools'}), null);
  const manifest={capability:'example.provider',layer:'tasks',commands:{binding:'binding.mjs'},binding:{version:1,normalize:'binding',bind:'binding',check:'binding'}};
  assert.equal(validateBindingInterface(manifest),manifest.binding);
});
test('binding reason declarations enforce the pinned count, length and literal bounds in schema and harness', () => {
  const base={capability:'oats.aweb',version:'1.11.0',description:'Inert manifest',layer:'messaging',commands:{binding:'binding.mjs'},binding:{version:1,normalize:'binding',bind:'binding',check:'binding'}};
  const validate=new Ajv2020({strict:false,allowUnionTypes:true}).compile(JSON.parse(readFileSync(new URL('../docs/capability-manifest.schema.json',import.meta.url),'utf8')));
  for(const reasons of [['fixed safe reason'],['fixed reason','another fixed reason'],['x'.repeat(200)],Array.from({length:64},(_,i)=>`fixed reason ${i}`)]) {
    const manifest={...base,binding:{...base.binding,reasons}};
    assert.equal(validate(manifest),true,JSON.stringify(validate.errors));
    assert.equal(validateBindingInterface(manifest),manifest.binding);
  }
  for(const reasons of [null,'not an array',[],[1],[''],['duplicate','duplicate'],['line\nbreak'],['trailing\n'],['control\u001bescape'],['non-ASCII café'],['x'.repeat(201)],['{fixed}'],['${operator}'],Array.from({length:65},(_,i)=>`fixed reason ${i}`)]) {
    const manifest={...base,binding:{...base.binding,reasons}};
    assert.equal(validate(manifest),false,JSON.stringify(reasons));
    assert.throws(()=>validateBindingInterface(manifest),{code:'invalid-declaration'});
  }
});

test('binding.keys accepts unique exact or trailing-dot declarations but does not enable routing enforcement',()=>{
  const base={capability:'example.provider',version:'1.0.0',description:'Inert provider',layer:'knowledge',commands:{binding:'binding.mjs'},binding:{version:1,normalize:'binding',bind:'binding',check:'binding'}};
  const validate=new Ajv2020({strict:false,allowUnionTypes:true}).compile(JSON.parse(readFileSync(new URL('../docs/capability-manifest.schema.json',import.meta.url),'utf8')));
  for(const keys of [[],['wider'],['stores.','write.','responsibleHuman']]) {
    const manifest={...base,binding:{...base.binding,keys}};
    assert.equal(validate(manifest),true,JSON.stringify(validate.errors)); assert.equal(validateBindingInterface(manifest),manifest.binding);
  }
  for(const keys of [null,'wider',[1],[''],['wider','wider'],['stores.*'],['stores..'],['stores.oats'],['.'],['wide r'],['wider\n']]) {
    const manifest={...base,binding:{...base.binding,keys}};
    assert.equal(validate(manifest),false,JSON.stringify(keys)); assert.throws(()=>validateBindingInterface(manifest),{code:'invalid-declaration'});
  }
});

test('binding declarations refuse missing commands, wrong owner slot, unknown fields and versions', () => {
  const base={layer:'knowledge',commands:{binding:'binding.mjs'},binding:{version:1,normalize:'binding',bind:'binding',check:'binding'}};
  assert.throws(()=>validateBindingInterface({...base,layer:undefined}),{code:'invalid-binding-interface'});
  assert.throws(()=>validateBindingInterface({...base,commands:{}}),{code:'invalid-binding-interface'});
  assert.throws(()=>validateBindingInterface({...base,binding:{...base.binding,version:2}}));
  assert.throws(()=>validateBindingInterface({...base,binding:{...base.binding,script:'unowned.mjs'}}),{code:'invalid-declaration'});
});
