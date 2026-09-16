import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateCapturedInvocationContext, withCapturedInvocationContextFile } from "../lib/captured-invocation-context.mjs";
import { invocationFixture } from "./helpers/captured-invocation.mjs";
import { validateWire } from "./helpers/portable-schema-check.mjs";

function fixture(t) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'oats-invocation-context-'))),deployment=join(root,'deployment'),home=join(root,'home');mkdirSync(deployment);mkdirSync(join(home,'work'),{recursive:true});
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  return {root,context:invocationFixture({deployment,home})};
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
  const helper=invocationFixture({deployment:f.context.executionBinding.deployment,home:f.context.instance.home,helper:true});
  assert.doesNotThrow(()=>validateCapturedInvocationContext(helper));
  validateWire('CapturedInvocationContext',f.context);validateWire('CapturedInvocationContext',helper);
  assert.equal(helper.subject.provider.capability,'example.provider');assert.equal(helper.subject.definition.path,'agents/worker/soul.yaml');
  assert.throws(()=>validateCapturedInvocationContext({...helper,subject:{kind:'helper',identity:null,alias:'worker'}}));
  assert.throws(()=>validateCapturedInvocationContext({...helper,subject:{...helper.subject,provider:{...helper.subject.provider,capability:'example.other'}}}));
  for (const context of [
    {...f.context,instance:{...f.context.instance,work:join(f.root,'other-work')}},
    {...f.context,instance:{...f.context.instance,agent:'other-agent'}},
    {...f.context,responsibleHuman:{provider:'example.messaging',id:'unwitnessed'}},
    {...f.context,messagingChoice:{schemaVersion:2,enabled:false}},
    {...f.context,context:{kind:'workspace',identity:{},observation:{}}},
    {...f.context,action:{...f.context.action,capability:'example.other'}},
    {...f.context,instance:null},
    {...f.context,priorReceipt:{oversized:'x'.repeat(128*1024)}},
  ]) assert.throws(()=>validateCapturedInvocationContext(context));
});
