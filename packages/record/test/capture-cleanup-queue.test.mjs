import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DerivedState } from '../lib/derived-state.mjs';
import { RecordStore } from '../lib/store.mjs';
import { CaptureSourceQueue } from '../lib/capture-source-queue.mjs';
import { CaptureCleanupQueue } from '../lib/capture-cleanup-queue.mjs';
import { superviseCapture } from '../lib/capture-supervisor.mjs';
import { superviseCapturePass } from '../lib/capture-pass.mjs';
import { readCaptureStatus } from '../lib/capture-status.mjs';
import { finishTurn } from '../lib/canonical.mjs';

const url = name => new URL(`../lib/${name}.mjs`, import.meta.url).href;
const now = Date.parse('2026-01-01T00:00:00.000Z');
const stream = 'fixture~cc.finished';
function fixture(t, { healthy = false, dependentNative = false } = {}) {
  const base = fs.mkdtempSync(join(tmpdir(), 'capture-cleanup-queue-')), root = join(base, 'record');
  const workerPath = join(base, 'worker.mjs'), env = { HOME: base, TMPDIR: base, XDG_CACHE_HOME: base, PATH: process.env.PATH };
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const store = new RecordStore(root, { owner: 'fixture' }), state = new DerivedState(root);
  const queue = new CaptureSourceQueue(state, { owner: 'fixture', selection: 'fixture' });
  const path = join(base, 'mail.jsonl');
  fs.writeFileSync(path, [1, 2].map(n => JSON.stringify({ ts: '2026-01-01T00:00:00Z', ch: 'mail', dir: 'recv', from: 'peer', body: String(n) }) + '\n').join(''));
  const nativePath = join(base, 'native.jsonl'), nativeStream = 'fixture~cc.native', nativeKey = `${nativeStream}:${nativePath}`;
  fs.writeFileSync(nativePath, JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', text: 'dependent native turn' }) + '\n');
  queue.add([...(dependentNative ? [{ source: 'cc', path: nativePath, stream: nativeStream }] : []),
    ...(healthy ? [{ source: 'aw', path, stream: 'fixture~aw' }] : [])], null, { complete: true });
  state.close();
  fs.writeFileSync(workerPath, `
    import fs from 'node:fs';import {join} from 'node:path';import {syncBuiltinESMExports} from 'node:module';
    import {runCaptureWorker} from ${JSON.stringify(url('capture-worker'))};
    import {RecordStore} from ${JSON.stringify(url('store'))};
    import {DerivedState} from ${JSON.stringify(url('derived-state'))};
    import {withCaptureGroup} from ${JSON.stringify(url('capture-context'))};
    import {createRetainedCaptureScratch,prepareRetainedCaptureCleanup} from ${JSON.stringify(url('capture-retained-scratch'))};
    import {CaptureWorkSession} from ${JSON.stringify(url('capture-work-session'))};
    import {CaptureStop} from ${JSON.stringify(url('capture-budget'))};
    await runCaptureWorker(start=>{
      const {root,options}=start;
      if(options.seed){
        const state=new DerivedState(root),store=new RecordStore(root,{owner:'fixture'});
        const stream=options.dependency?.stream??${JSON.stringify(stream)};
        try{
          withCaptureGroup(store,[stream],()=>{
            state.db.exec('CREATE TABLE recovery_chunks (allocation TEXT, offset INTEGER, length INTEGER, hash TEXT, PRIMARY KEY(allocation,offset));'+
              'CREATE TABLE transcript_prefix (job TEXT, line INTEGER, hash TEXT, PRIMARY KEY(job,line))');
            for(const key of options.seed){
              const allocation=createRetainedCaptureScratch(store,stream,key,start);
              try{
                fs.writeFileSync(join(root,(options.dependency?'a':key)+'-path'),allocation.path);
                // Missing stage identity models derived recovery-state loss.
                // The actual native unit must invalidate the active allocation.
                state.set('recovery-stage',key,{allocation:allocation.claim.id});
                state.set('recovery-garbage',allocation.claim.id,true);state.set('prefix-proof',key,{stream});
                state.set('cc',key,{bytes:123,line:7});
                for(let n=0;n<7;n++)state.db.prepare('INSERT INTO recovery_chunks VALUES (?,?,1,?)').run(allocation.claim.id,n,'hash');
                for(let n=0;n<5;n++)state.db.prepare('INSERT INTO transcript_prefix VALUES (?,?,?)').run(key,n,'hash');
              }finally{allocation.close();}
              if(!options.dependency)prepareRetainedCaptureCleanup(store,stream,key,start);
            }
          },{state});return {outcome:'complete',reason:null};
        }finally{state.close();}
      }
      const session=new CaptureWorkSession(start,{owner:'fixture',selection:'fixture',now:()=>options.now,
        unit:{limit:1,maxRecords:options.records??1}});
      const transaction=session.state.transaction.bind(session.state);let logged=null;
      session.state.transaction=fn=>{
        const result=transaction(fn),admission=session.state.get('capture-admission','active');
        if(admission && admission.id!==logged && !session.state.depth){logged=admission.id;
          fs.appendFileSync(join(root,'admissions'),JSON.stringify(admission)+'\\n');}
        return result;
      };
      let removed=false;
      const remove=fs.rmSync;fs.rmSync=(path,...args)=>{
        const result=remove(path,...args);
        if(path===fs.readFileSync(join(root,'a-path'),'utf8')){
          removed=true;if(options.crashAfterRemove)process.kill(process.pid,'SIGKILL');
        }return result;
      };syncBuiltinESMExports();
      if(options.stopAfterRemove){const sample=start.budget.sample.bind(start.budget);
        start.budget.sample=()=>{if(removed)start.budget.reason='deadline';return sample();};}
      if(options.stopAtLock || options.orphanAtLock)session.store.withStreamLock=()=>{
        start.budget.reason=options.orphanAtLock?'interrupted':'deadline';throw new CaptureStop(start.budget.reason);};
      if(options.failAccounting){const record=session.run.record.bind(session.run);
        session.run.record=(delta,options)=>{record(delta,options);throw Error('injected cleanup accounting failure');};}
      try{
        if(options.single){
          const result=session.cleanup.advance(session.run,start,{now:options.now,retry:options.retry??false,maxRecords:options.records??4});
          fs.appendFileSync(join(root,'units'),JSON.stringify(result)+'\\n');
          if(options.repeat){const again=session.cleanup.advance(session.run,start,{now:options.now,retry:true,maxRecords:options.records??4});
            fs.writeFileSync(join(root,'repeat'),JSON.stringify(again));}
          return session.finish({reason:result.stopped?'deadline':'input'});
        }
        for(let n=0;n<4;n++){
          const result=session.step();
          fs.appendFileSync(join(root,'events'),JSON.stringify({runId:session.run.id,stage:result.stage,
            selected:result.selected??0,cleanup:result.cleanupWork?.selected??0,
            streams:(result.results??result.streams??[]).map(row=>row.stream)})+'\\n');
          if(result.resetRequired)return session.yieldWorker({resetRequired:true});
          if(result.finalize)return session.finish({reason:'deadline'});
          if(result.stopped)return session.yieldWorker();
          if(result.idle)return session.finish();
        }
        return session.yieldWorker();
      }catch(error){fs.writeFileSync(join(root,'error'),error.stack);throw error;}
      finally{session.close();}
    });
  `);
  return { root, store, nativeKey, nativeStream,
    seed: (keys = ['a']) => superviseCapture(root, dependentNative ? { seed: [nativeKey], dependency: { stream: nativeStream } } :
      { seed: keys }, { workerPath, env }),
    run: (options = {}, transport = {}) => superviseCapturePass(root, { now, ...options }, { workerPath, env, ...transport }),
    state(fn) { const state = new DerivedState(root); try { return fn(state); } finally { state.close(); } },
    path: key => fs.readFileSync(join(root, key + '-path'), 'utf8'),
    rows() { return this.state(s => s.db.prepare('SELECT count(*) AS n FROM recovery_chunks').get().n +
      s.db.prepare('SELECT count(*) AS n FROM transcript_prefix').get().n); },
    diagnostic(result) { const path = join(root, 'error'); return JSON.stringify(result) + (fs.existsSync(path) ? '\n' + fs.readFileSync(path, 'utf8') : ''); },
  };
}

test('durable cleanup rotation resumes bounded units across workers and preserves source sentinels', async t => {
  const f = fixture(t); assert.equal((await f.seed(['a', 'b'])).outcome, 'complete');
  let previous = f.rows(); assert.equal(previous, 24);
  for (let n = 0; n < 12 && f.state(s => [...s.entries('recovery-allocation')].length); n++) {
    const result = await f.run({ single: true });
    assert.equal(result.outcome, 'partial', f.diagnostic(result));
    const remaining = f.rows(); assert.ok(previous - remaining >= 0 && previous - remaining <= 4); previous = remaining;
    for (const key of ['a', 'b']) assert.deepEqual(f.state(s => s.get('cc', key)), { bytes: 123, line: 7 });
    assert.equal(f.state(s => s.get('capture-cleanup', 'active')), null);
  }
  assert.equal(f.rows(), 0); assert.equal(f.state(s => [...s.entries('recovery-allocation')].length), 0);
  const units = fs.readFileSync(join(f.root, 'units'), 'utf8').trim().split('\n').map(JSON.parse).filter(row => row.selected);
  assert.deepEqual(units.slice(0, 4).map(row => row.job.key), ['a', 'b', 'a', 'b']);
  for (const kind of ['recovery-stage', 'recovery-garbage', 'prefix-proof', 'capture-cleanup-retry'])
    assert.deepEqual(f.state(s => [...s.entries(kind)]), []);
  for (const key of ['a', 'b']) assert.equal(fs.existsSync(f.path(key)), false);
  const status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.counts.turnsAppended, 0); assert.equal(status.lastRun.counts.turnsIndexed, 0);
  assert.ok(status.lastProgressAt); assert.equal(status.lastSuccess, null); assert.equal(status.backlog.pending, true);
});

test('cleanup death retains backoff while healthy work progresses and a due allocation resumes after indexing', async t => {
  const f = fixture(t, { healthy: true }); assert.equal((await f.seed()).outcome, 'complete');
  const allocation = f.state(s => s.get('recovery-allocation', 'a').id);
  const unrelated = { stream: 'fixture~unrelated', stage: 'prefix', unitId: 'unrelated', attemptedRun: 'older',
    generation: null, offset: 0, nextRetryAt: new Date(now).toISOString() };
  f.state(s => s.transaction(() => s.set('capture-retry', unrelated.stream, unrelated)));
  const failed = await f.run({ crashAfterRemove: true });
  assert.equal(failed.outcome, 'failed', f.diagnostic(failed)); assert.ok(failed.starts > 1);
  let status = readCaptureStatus(f.root); const oldFailure = status.lastFailure;
  assert.equal(status.lastFailure.id, status.lastRun.id); assert.equal(status.lastRun.counts.turnsAppended, 2);
  assert.equal(status.lastRun.counts.turnsIndexed, 2); assert.equal(status.backlog.failedCount, 0);
  assert.equal(f.store.readStream('fixture~aw').length, 2); assert.equal(f.rows(), 12);
  assert.equal(fs.existsSync(f.path('a')), false);
  const retry = f.state(s => s.get('capture-cleanup-retry', allocation));
  assert.equal(retry.attempts, 1); assert.equal(retry.attemptedRun, status.lastRun.id);
  assert.equal(Date.parse(retry.nextRetryAt), now + 30 * 60 * 1000);
  assert.equal(f.state(s => s.get('capture-cleanup', 'active')), null);
  assert.equal((await f.run({ now: now + 1 })).outcome, 'partial');
  assert.deepEqual(f.state(s => s.get('capture-cleanup-retry', allocation)), retry, 'skipping cannot change attempts/date');
  f.store.append('fixture~aw', finishTurn({ v: 1, ts: '2026-01-01T00:00:00Z', from: 'fixture', kind: 'mail',
    body: { text: 'new healthy index work' }, provenance: { source: 'aw', fidelity: 'projected' } }));
  const due = await f.run({ now: Date.parse(retry.nextRetryAt), records: 2000 });
  assert.equal(due.outcome, 'partial', f.diagnostic(due)); assert.equal(due.exitCode, 0);
  status = readCaptureStatus(f.root);
  const events = fs.readFileSync(join(f.root, 'events'), 'utf8').trim().split('\n').map(JSON.parse)
    .filter(row => row.runId === status.lastRun.id && row.selected);
  assert.equal(events[0].stage, 'index'); assert.ok(events.some(row => row.stage === 'cleanup'));
  assert.equal(status.lastRun.counts.turnsAppended, 0); assert.equal(status.lastRun.counts.turnsIndexed, 1);
  assert.deepEqual(status.lastFailure, oldFailure); assert.equal(status.lastSuccess, null);
  assert.equal(f.state(s => s.get('capture-cleanup-retry', allocation)), null);
  assert.equal(f.state(s => s.get('recovery-allocation', 'a')), null); assert.equal(f.rows(), 0);
  assert.deepEqual(f.state(s => s.get('capture-retry', unrelated.stream)), unrelated);
});

for (const sourceRetry of [false, true])
test(`a ready native cleanup dependency cannot suppress due cleanup or independent work (source retry: ${sourceRetry})`, async t => {
  const f = fixture(t, { healthy: true, dependentNative: true });
  assert.equal((await f.seed()).outcome, 'complete');
  const allocation = f.state(s => s.get('recovery-allocation', f.nativeKey).id);
  assert.equal(f.state(s => s.get('recovery-allocation', f.nativeKey).phase), 'active');
  const admissions = runId => fs.readFileSync(join(f.root, 'admissions'), 'utf8').trim().split('\n').map(JSON.parse)
    .filter(row => row.runId === runId && row.stage === 'capture' && row.members.some(member => member.stream === f.nativeStream));
  const outcome = () => f.state(s => s.db.prepare('SELECT outcome FROM capture_sources WHERE source=? AND stream=?').get('cc', f.nativeStream).outcome);
  const failed = await f.run({ crashAfterRemove: true });
  assert.equal(failed.outcome, 'failed', f.diagnostic(failed));
  let status = readCaptureStatus(f.root); const oldFailure = status.lastFailure;
  assert.equal(admissions(status.lastRun.id).length, 1, 'only the invalidating source admission, never cleanup-only repeats');
  assert.equal(status.lastRun.counts.turnsAppended, 2); assert.equal(status.lastRun.counts.turnsIndexed, 2);
  assert.equal(f.state(s => s.get('recovery-stage', f.nativeKey).reason), 'recovery-state-lost');
  assert.equal(f.state(s => s.get('recovery-allocation', f.nativeKey).phase), 'deleting');
  assert.equal(outcome(), 'ready'); assert.equal(fs.existsSync(f.path('a')), false); assert.equal(f.rows(), 12);
  assert.equal(f.store.readStream(f.nativeStream).length, 0);
  const retry = f.state(s => s.get('capture-cleanup-retry', allocation));
  assert.equal(retry.attemptedRun, status.lastRun.id); assert.equal(retry.attempts, 1);
  assert.equal(Date.parse(retry.nextRetryAt), now + 30 * 60 * 1000);
  const streamRetry = { stream: f.nativeStream, stage: 'capture', unitId: 'earlier-source-attempt', attemptedRun: 'older',
    generation: null, offset: 0, nextRetryAt: new Date(now).toISOString() };
  const unrelated = { ...streamRetry, stream: 'fixture~unrelated', stage: 'prefix' };
  f.state(s => s.transaction(() => {
    s.set('capture-retry', unrelated.stream, unrelated);
    if (sourceRetry) s.set('capture-retry', f.nativeStream, streamRetry);
  }));
  f.store.append('fixture~aw', finishTurn({ v: 1, ts: '2026-01-01T00:00:00Z', from: 'fixture', kind: 'mail',
    body: { text: 'independent before-due index progress' }, provenance: { source: 'aw', fidelity: 'projected' } }));
  const beforeDue = await f.run({ now: now + 1, records: 2000 });
  assert.equal(beforeDue.outcome, 'partial', f.diagnostic(beforeDue));
  status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.counts.turnsIndexed, 1); assert.equal(status.lastRun.counts.turnsAppended, 0);
  assert.equal(admissions(status.lastRun.id).length, 0, 'waiting dependency is neither healthy nor eligible source retry');
  assert.equal(outcome(), 'ready'); assert.equal(f.rows(), 12);
  assert.deepEqual(f.state(s => s.get('capture-cleanup-retry', allocation)), retry);
  assert.deepEqual(f.state(s => s.get('capture-retry', f.nativeStream)), sourceRetry ? streamRetry : null);
  assert.deepEqual(status.lastFailure, oldFailure);
  const due = await f.run({ now: Date.parse(retry.nextRetryAt), records: 2000 });
  assert.equal(due.outcome, 'partial', f.diagnostic(due)); assert.equal(due.exitCode, 0);
  status = readCaptureStatus(f.root);
  const events = fs.readFileSync(join(f.root, 'events'), 'utf8').trim().split('\n').map(JSON.parse)
    .filter(row => row.runId === status.lastRun.id);
  const cleaned = events.findIndex(row => row.stage === 'cleanup' && row.selected === 1);
  const resumed = events.findIndex(row => row.stage === 'capture' && row.streams.includes(f.nativeStream));
  assert.ok(cleaned >= 0 && resumed > cleaned, 'due cleanup must retire the dependency before source admission resumes');
  assert.equal(admissions(status.lastRun.id).length, 1); assert.equal(outcome(), 'complete');
  assert.equal(status.lastRun.counts.turnsAppended, 1); assert.equal(status.lastRun.counts.turnsIndexed, 1);
  assert.equal(f.store.readStream(f.nativeStream).length, 1);
  assert.equal(f.state(s => s.get('recovery-allocation', f.nativeKey)), null);
  assert.equal(f.state(s => s.get('capture-cleanup-retry', allocation)), null); assert.equal(f.rows(), 0);
  assert.equal(f.state(s => s.get('capture-retry', f.nativeStream)), null);
  assert.deepEqual(f.state(s => s.get('capture-retry', unrelated.stream)), unrelated);
  assert.deepEqual(status.lastFailure, oldFailure); assert.equal(status.lastSuccess, null); assert.equal(status.backlog.pending, true);
});

test('cleanup accounting rollback retains metadata/admission evidence and only a later due commit records progress', async t => {
  const f = fixture(t); assert.equal((await f.seed()).outcome, 'complete');
  const allocation = f.state(s => s.get('recovery-allocation', 'a').id);
  const failed = await f.run({ single: true, failAccounting: true, records: 2000 });
  assert.equal(failed.outcome, 'failed', f.diagnostic(failed));
  let status = readCaptureStatus(f.root); const failure = status.lastFailure;
  assert.equal(status.lastProgressAt, null); assert.equal(f.rows(), 12);
  assert.equal(f.state(s => s.get('recovery-allocation', 'a').id), allocation);
  assert.equal(fs.existsSync(f.path('a')), false);
  const retry = f.state(s => s.get('capture-cleanup-retry', allocation));
  assert.equal(retry.attempts, 1); assert.equal(f.state(s => s.get('capture-cleanup', 'active')), null);
  const partial = await f.run({ single: true, retry: true, repeat: true, now: Date.parse(retry.nextRetryAt), records: 4 });
  assert.equal(partial.outcome, 'partial', f.diagnostic(partial)); assert.equal(f.rows(), 8);
  assert.equal(JSON.parse(fs.readFileSync(join(f.root, 'repeat'), 'utf8')).selected, 0);
  const retained = f.state(s => s.get('capture-cleanup-retry', allocation));
  assert.equal(retained.attempts, 1); assert.equal(retained.nextRetryAt, retry.nextRetryAt);
  assert.equal(retained.attemptedRun, readCaptureStatus(f.root).lastRun.id);
  const resumed = await f.run({ single: true, retry: true, now: Date.parse(retry.nextRetryAt) + 1, records: 2000 });
  assert.equal(resumed.outcome, 'partial', f.diagnostic(resumed));
  status = readCaptureStatus(f.root); assert.ok(status.lastProgressAt); assert.deepEqual(status.lastFailure, failure);
  assert.equal(status.lastRun.counts.turnsAppended, 0); assert.equal(status.lastRun.counts.turnsIndexed, 0);
  assert.equal(f.rows(), 0); assert.equal(f.state(s => s.get('capture-cleanup-retry', allocation)), null);
});

test('cooperative stop retires admission without backoff and finalization does not delete', async t => {
  for (const stop of ['stopAfterRemove', 'stopAtLock']) {
    const f = fixture(t); assert.equal((await f.seed()).outcome, 'complete');
    const stopped = await f.run({ single: true, [stop]: true });
    assert.equal(stopped.outcome, 'partial', f.diagnostic(stopped)); assert.equal(stopped.exitCode, 0);
    assert.equal(f.rows(), 12); assert.equal(f.state(s => s.get('capture-cleanup', 'active')), null);
    assert.deepEqual(f.state(s => [...s.entries('capture-cleanup-retry')]), []);
    assert.equal(readCaptureStatus(f.root).lastFailure, null);
    assert.equal(fs.existsSync(f.path('a')), stop === 'stopAtLock');
  }
  const g = fixture(t); assert.equal((await g.seed()).outcome, 'complete');
  const final = await g.run({ single: true }, { policy: { intervalSeconds: 900, heapMiB: 256, rssBytes: 2147483648,
    deadlineSeconds: 10, maxRecordBytes: 8388608 } });
  assert.equal(final.outcome, 'partial', g.diagnostic(final)); assert.equal(final.starts, 1);
  assert.equal(fs.existsSync(g.path('a')), true); assert.equal(g.rows(), 12);
  assert.equal(g.state(s => s.get('capture-cleanup', 'active')), null);
  const orphan = fixture(t); assert.equal((await orphan.seed()).outcome, 'complete');
  const interrupted = await orphan.run({ single: true, orphanAtLock: true });
  assert.equal(interrupted.outcome, 'failed', orphan.diagnostic(interrupted));
  assert.equal(readCaptureStatus(orphan.root).lastFailure.reason, 'interrupted');
  assert.equal(orphan.rows(), 12); assert.equal(fs.existsSync(orphan.path('a')), true);
  assert.equal(orphan.state(s => [...s.entries('capture-cleanup-retry')][0].value.attempts), 1);
});

test('cleanup cursor bounds active-allocation scans and wraps durably without progress or success', t => {
  const f = fixture(t);
  f.state(state => state.transaction(() => {
    for (let n = 0; n < 260; n++) state.set('recovery-allocation', String(n).padStart(4, '0'), {
      id: n.toString(16).padStart(32, '0'), stream, phase: 'active',
    });
  }));
  const start = { workerNonce: 'fixture-worker', pass: { runId: 'fixture-run', finalize: false },
    budget: { check() {}, sample: () => null } };
  for (const count of [128, 128, 4, 128]) f.state(state => {
    const queue = new CaptureCleanupQueue(f.store, state);
    const result = queue.advance({ state, id: 'fixture-run', record() { assert.fail('enumeration is not processing progress'); } }, start, { now });
    assert.equal(result.scanned, count); assert.equal(result.selected, 0); assert.equal(result.complete, count === 4);
    assert.equal(queue.active(), null);
  });
});
