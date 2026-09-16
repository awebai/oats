import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleRequest } from '../server/schedules.mjs';

test('Desktop reads schedule API 2 but never strips captured policy into a legacy mutation', async () => {
  let calls=0;
  const context={workspace:{scope:'/workspace'},cli:{ok:true,bin:'/oats',scheduleApi:2,features:['schedule']},
    invoke:async()=>{calls++;return {ok:true,result:{schedules:[]}};}};
  assert.deepEqual(await scheduleRequest({operation:'list'},context),{schedules:[]});
  assert.equal(calls,1);
  await assert.rejects(scheduleRequest({operation:'add',id:'captured',spec:{kind:'wake',definitionVersion:2,recurrencePolicy:'capture',
    enabled:true,cron:'* * * * *',tz:'UTC',home:'/workspace/home',message:'wake'}},context),{code:'cli-no-captured-schedule'});
  assert.equal(calls,1,'unsupported editor cannot silently forward downgraded policy');
});
