import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareComposition } from '../lib/prepare-composition.mjs';

// Refusal-only codec probe: no Git, source access, filesystem setup or fake
// successful preparation. Valid absent-workspace preparation has native tests.
test('every supplied preparation workspace is validated before repository access',()=>{
  const calls=[];
  const forbidden=name=>(...args)=>{calls.push({name,args});throw new Error('unexpected repository access');};
  const repositories={identify:forbidden('identify'),observe:forbidden('observe'),readFile:forbidden('readFile'),materialize:forbidden('materialize')};
  const input={deployment:'/unused-deployment',directory:'/unused-scratch',
    source:{source:'git:https://example.invalid/unused.git',revision:'main',soul:'agents/expert',alias:'expert'},
    origin:{kind:'operator',document:{kind:'operator',id:'workspace-presence-fixture'},pointer:'/source'}};
  for(const workspace of [null,false,0,''])for(const standalone of [{},{standaloneContextKey:null}]){
    assert.throws(()=>prepareComposition({...input,workspace,...standalone},{repositories,kernel:{},previous:{lock:null,integrity:null}}),{code:'invalid-declaration'});
    assert.deepEqual(calls,[],'an explicit invalid workspace never becomes an absent workspace');
  }
});
