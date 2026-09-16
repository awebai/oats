import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateCapturedInvocationContext, withCapturedInvocationContextFile } from "../lib/captured-invocation-context.mjs";

const RID=`sha256-${'a'.repeat(64)}`;
function fixture(t) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'oats-invocation-context-'))),deployment=join(root,'deployment'),home=join(root,'home');mkdirSync(deployment);mkdirSync(join(home,'work'),{recursive:true});
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  return {root,context:{schemaVersion:1,executionBinding:{schemaVersion:1,deployment,resolution:{schemaVersion:1,id:RID}},
    subject:{kind:'persistent',identity:{kind:'local-soul',source:`path:${join(root,'source')}`,exportPath:'.'},alias:'expert'},
    instance:{home,work:join(home,'work'),name:'expert-1',agent:'expert'},context:{kind:'standalone',key:'opaque-context'},responsibleHuman:null,
    messagingChoice:{schemaVersion:1,enabled:false},capability:'example.provider',action:{kind:'hook',name:'spawn'},priorReceipt:null}};
}

test('captured invocation context is one private transient generic snapshot',t=>{
  const f=fixture(t);let path;
  const result=withCapturedInvocationContextFile(f.context,env=>{path=env.OATS_INVOCATION_CONTEXT_FILE;assert.equal(statSync(path).mode&0o777,0o600);assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),f.context);return 'done';});
  assert.equal(result,'done');assert.equal(existsSync(path),false);
  let cleanupFailure;
  try { withCapturedInvocationContextFile(f.context,env=>{rmSync(dirname(env.OATS_INVOCATION_CONTEXT_FILE),{recursive:true});return {observed:true};}); }
  catch(error) { cleanupFailure=error; }
  assert.equal(cleanupFailure.invocationCompleted,true);assert.deepEqual(cleanupFailure.invocationResult,{observed:true});
});

test('captured invocation context refuses unknown fields and helper identity claims',t=>{
  const f=fixture(t);assert.equal(validateCapturedInvocationContext(f.context),f.context);
  assert.throws(()=>validateCapturedInvocationContext({...f.context,secret:'value'}),{code:'invalid-declaration'});
  assert.throws(()=>validateCapturedInvocationContext({...f.context,subject:{...f.context.subject,kind:'helper'}}),{code:'invalid-declaration'});
  assert.doesNotThrow(()=>validateCapturedInvocationContext({...f.context,subject:{kind:'helper',identity:null,alias:'worker'}}));
});
