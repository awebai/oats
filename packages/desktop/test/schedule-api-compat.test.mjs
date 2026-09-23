import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleRequest } from '../server/schedules.mjs';

test('mutation API2 never enables legacy reads or strips captured policy into a legacy mutation', async () => {
  let calls=0;
  const context={workspace:{scope:'/workspace'},cli:{ok:true,bin:'/oats',scheduleApi:2,features:['schedule']},
    invoke:async()=>{calls++;return {ok:true,result:{schedules:[]}};}};
  for (const operation of ['list', 'show']) await assert.rejects(scheduleRequest({operation,id:'j'},context),{code:'E_SCHEDULE_READ_UNAVAILABLE'});
  assert.equal(calls,0);
  assert.deepEqual(await scheduleRequest({operation:'disable',id:'j'},context),{schedules:[]});
  assert.equal(calls,1);
  await assert.rejects(scheduleRequest({operation:'add',id:'captured',spec:{kind:'wake',definitionVersion:2,recurrencePolicy:'capture',
    enabled:true,cron:'* * * * *',tz:'UTC',home:'/workspace/home',message:'wake'}},context),{code:'cli-no-captured-schedule'});
  assert.equal(calls,1,'unsupported editor cannot silently forward downgraded policy');
});
