import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleRequest } from '../server/schedules.mjs';

test('the local schedule verbs never read, switch or run (that is /api/automations) or strip captured policy', async () => {
  let calls=0;
  const context={workspace:{scope:'/workspace'},cli:{ok:true,bin:'/oats',scheduleApi:2,features:['schedule']},
    invoke:async()=>{calls++;return {ok:true,result:{schedules:[]}};}};
  for (const operation of ['list', 'show', 'enable', 'disable', 'run']) await assert.rejects(scheduleRequest({operation,id:'j'},context),{code:'E_BAD_ARGS'});
  assert.equal(calls,0);
  assert.deepEqual(await scheduleRequest({operation:'remove',id:'j'},context),{schedules:[]});
  assert.equal(calls,1);
  await assert.rejects(scheduleRequest({operation:'add',id:'captured',spec:{kind:'wake',definitionVersion:2,recurrencePolicy:'capture',
    enabled:true,cron:'* * * * *',tz:'UTC',home:'/workspace/home',message:'wake'}},context),{code:'cli-no-captured-schedule'});
  assert.equal(calls,1,'unsupported editor cannot silently forward downgraded policy');
});
