import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { admitCapturedInstanceAction, beginCapturedIntent, capturedDirectoryIdentity, readCapturedInstanceIndex, readCapturedInstanceMetadata, readCapturedIntent, registerCapturedInstance, settleCapturedIntent } from '../lib/captured-instance-index.mjs';
import { invocationFixture } from './helpers/captured-invocation.mjs';
import { buildCapturedInvocationContext, validateCapturedInvocationContext } from '../lib/captured-invocation-context.mjs';

// Storage/shape fixture only: not a substitute for real retained-record admission.
function fixture(t) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'oats-admission-'))),deployment=join(root,'deployment'),home=join(root,'expert-1');mkdirSync(deployment);mkdirSync(join(home,'work'),{recursive:true});
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const wire=invocationFixture({deployment,home}),file=join(home,'instance.json');
  const metadata={home,instance:wire.instance.name,agent:wire.instance.agent,kind:'persistent',work:'directory',incarnationId:randomUUID(),executionBinding:wire.executionBinding,responsibleHuman:null,
    captured:{lifecycle:'scaffolded-hooks-pending',custody:{home:capturedDirectoryIdentity(home),work:capturedDirectoryIdentity(join(home,'work'))}},capabilityMeta:{[wire.capability]:{previous:'receipt'}}};
  const save=()=>writeFileSync(file,JSON.stringify(metadata));save();registerCapturedInstance(deployment,home);
  const request={deployment,home,executionBinding:wire.executionBinding,capability:wire.capability,action:wire.action,input:{label:'same-request-data'}};
  const loaded={deployment,resolution:wire.executionBinding.resolution,capability:{id:wire.capability},record:{subject:wire.subject,context:wire.context,messagingChoice:wire.messagingChoice}};
  const instance={home,work:join(home,'work'),name:metadata.instance,agent:metadata.agent};
  return {root,deployment,home,file,metadata,save,request,loaded,instance};
}

test('new requests are distinct; retries retain logical identity/receipt and reject changed input or stale attempts',t=>{
  const f=fixture(t),a=admitCapturedInstanceAction(f.request);
  assert.equal(a.intent.incarnationId,f.metadata.incarnationId);assert.equal(a.intent.attempt,1);assert.deepEqual(structuredClone(a.receipt),{previous:'receipt'});
  assert.equal(readCapturedIntent({...f.request,intent:a.intent}).state,'admitted','intent is durable before any effects');
  assert.throws(()=>admitCapturedInstanceAction(f.request),{code:'selection-changed'});
  beginCapturedIntent({...f.request,intent:a.intent});
  assert.throws(()=>beginCapturedIntent({...f.request,intent:a.intent}),{code:'selection-changed'});
  assert.throws(()=>admitCapturedInstanceAction({...f.request,retryExecutionId:a.intent.executionId}),{code:'selection-changed'});
  settleCapturedIntent({...f.request,intent:a.intent,state:'unconfirmed',receipt:{native:'observed-partial'}});
  assert.throws(()=>admitCapturedInstanceAction(f.request),{code:'selection-changed'});
  assert.throws(()=>admitCapturedInstanceAction({...f.request,input:{label:'different'},retryExecutionId:a.intent.executionId}),{code:'invalid-resolution'});
  const retry=admitCapturedInstanceAction({...f.request,retryExecutionId:a.intent.executionId});
  assert.equal(retry.intent.executionId,a.intent.executionId);assert.equal(retry.intent.attempt,2);assert.deepEqual(structuredClone(retry.receipt),{native:'observed-partial'});
  assert.throws(()=>beginCapturedIntent({...f.request,intent:a.intent}),{code:'invalid-resolution'});
  const invocation=buildCapturedInvocationContext({loaded:f.loaded,action:f.request.action,instance:f.instance,intent:retry.intent,priorReceipt:retry.receipt});
  assert.equal(invocation.instance.incarnationId,f.metadata.incarnationId);assert.deepEqual(invocation.intent,retry.intent);assert.deepEqual(invocation.priorReceipt,structuredClone(retry.receipt));
  assert.throws(()=>buildCapturedInvocationContext({loaded:f.loaded,action:f.request.action,instance:f.instance,intent:retry.intent,priorReceipt:{forged:true}}),{code:'invalid-resolution'});
  assert.throws(()=>validateCapturedInvocationContext({...invocation,intent:{...retry.intent,incarnationId:randomUUID()}}),{code:'invalid-resolution'});
  beginCapturedIntent({...f.request,intent:retry.intent});settleCapturedIntent({...f.request,intent:retry.intent,state:'completed',receipt:{native:'complete'},replayable:true});
  const replay=admitCapturedInstanceAction({...f.request,retryExecutionId:a.intent.executionId});assert.equal(replay.replayed,true);assert.equal(replay.intent.attempt,2);assert.deepEqual(structuredClone(replay.receipt),{native:'complete'});
  const b=admitCapturedInstanceAction(f.request);assert.notEqual(b.intent.executionId,a.intent.executionId);assert.equal(b.intent.incarnationId,a.intent.incarnationId);assert.deepEqual(structuredClone(b.receipt),{native:'complete'});
  assert.equal(readCapturedInstanceIndex(f.deployment).instances[0].intents.length,2);
});

test('expected native source state is checked inside admission before mint or retry mutation',t=>{
  const f=fixture(t),file=join(f.deployment,'.agents/portable/instance-references.json'),before=readFileSync(file);
  assert.throws(()=>admitCapturedInstanceAction({...f.request,expectedStatus:'spawned-launch-pending'}),{code:'selection-changed'});
  assert.deepEqual(readFileSync(file),before);
  const admitted=admitCapturedInstanceAction({...f.request,expectedStatus:'scaffolded-hooks-pending'});
  beginCapturedIntent({...f.request,intent:admitted.intent});settleCapturedIntent({...f.request,intent:admitted.intent,state:'unconfirmed',receipt:{observed:true}});
  const retained=readFileSync(file);f.metadata.captured.lifecycle='retire-running';f.save();
  assert.throws(()=>admitCapturedInstanceAction({...f.request,expectedStatus:'scaffolded-hooks-pending',retryExecutionId:admitted.intent.executionId}),{code:'selection-changed'});
  assert.deepEqual(readFileSync(file),retained,'a stale metadata/index relationship cannot increment the retry attempt');
});

test('recreated home or replaced work never inherits prior incarnation custody, even with copied metadata',t=>{
  const f=fixture(t),a=admitCapturedInstanceAction(f.request);beginCapturedIntent({...f.request,intent:a.intent});
  renameSync(f.home,join(f.root,'preserved-old-home'));mkdirSync(join(f.home,'work'),{recursive:true});f.save();
  assert.throws(()=>readCapturedInstanceMetadata(f.home),{code:'integrity-drift'});
  f.metadata.incarnationId=randomUUID();f.metadata.captured.custody={home:capturedDirectoryIdentity(f.home),work:capturedDirectoryIdentity(join(f.home,'work'))};f.save();
  assert.throws(()=>admitCapturedInstanceAction({...f.request,retryExecutionId:a.intent.executionId}),{code:'invalid-resolution'});
  assert.throws(()=>registerCapturedInstance(f.deployment,f.home),{code:'selection-changed'});
  assert.equal(readCapturedInstanceIndex(f.deployment).instances[0].incarnationId,a.intent.incarnationId);
  assert.ok(existsSync(join(f.root,'preserved-old-home','instance.json')),'old home/data remains preserved');
  const g=fixture(t);renameSync(join(g.home,'work'),join(g.home,'preserved-work'));mkdirSync(join(g.home,'work'));
  assert.throws(()=>admitCapturedInstanceAction(g.request),{code:'integrity-drift'});
});

test('legacy identity uncertainty is never backfilled and read-only projection never admits an action',t=>{
  const f=fixture(t),before=readFileSync(join(f.deployment,'.agents/portable/instance-references.json'));
  const view=buildCapturedInvocationContext({loaded:f.loaded,action:f.request.action,instance:f.instance});assert.equal(view.intent,null);
  assert.deepEqual(readFileSync(join(f.deployment,'.agents/portable/instance-references.json')),before);
  delete f.metadata.incarnationId;f.save();const bytes=readFileSync(f.file);
  assert.throws(()=>admitCapturedInstanceAction(f.request),{code:'migration-required'});assert.deepEqual(readFileSync(f.file),bytes);
  writeFileSync(join(f.deployment,'.agents/portable/instance-references.json'),JSON.stringify({schemaVersion:1,instances:[]}));
  assert.throws(()=>readCapturedInstanceIndex(f.deployment),{code:'migration-required'});
});
