// Supervised fixture intentions for the private session, not ordinary-command,
// cleanup completion, manager or full-service qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DerivedState } from '../lib/derived-state.mjs';
import { RecordStore } from '../lib/store.mjs';
import { RecordIndex } from '../lib/index-db.mjs';
import { CaptureSourceQueue } from '../lib/capture-source-queue.mjs';
import { CaptureRun } from '../lib/capture-run.mjs';
import { commitCaptureAdmission } from '../lib/capture-admission.mjs';
import { readCaptureStatus } from '../lib/capture-status.mjs';
import { superviseCapturePass } from '../lib/capture-pass.mjs';
import { finishTurn } from '../lib/canonical.mjs';

const url = name => new URL(`../lib/${name}.mjs`, import.meta.url).href;
const now = Date.parse('2026-01-01T00:00:00.000Z');
const native = n => JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', text: String(n) }) + '\n';
const aw = n => JSON.stringify({ ts: '2026-01-01T00:00:00Z', ch: 'mail', dir: 'recv', from: 'peer', body: String(n) }) + '\n';
const turn = n => finishTurn({ v: 1, ts: '2026-01-01T00:00:00Z', from: 'fixture', kind: 'mail',
  body: { text: `extra ${n}` }, provenance: { source: 'aw', fidelity: 'projected' } });

function fixture(t, specs = [], { discover = false } = {}) {
  const base = fs.mkdtempSync(join(tmpdir(), 'capture-work-session-')), root = join(base, 'record'), workerPath = join(base, 'worker.mjs');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const store = new RecordStore(root, { owner: 'fixture' });
  const inputs = specs.map(([source, name, text]) => {
    const directory = discover ? join(base, source) : base; fs.mkdirSync(directory, { recursive: true });
    const path = join(directory, name + '.jsonl'); fs.writeFileSync(path, text);
    return { source, path, stream: source === 'aw' ? 'fixture~aw' : `fixture~${source}.${name}` };
  });
  const state = new DerivedState(root), queue = new CaptureSourceQueue(state, { owner: 'fixture', selection: 'fixture' });
  const roots = discover ? [...new Set(specs.map(([source]) => source))].map(source => ({ source, path: join(base, source) })) : null;
  if (!discover) queue.add(inputs, null, { complete: true }); state.close();
  fs.writeFileSync(workerPath, `
    import fs from 'node:fs';import {join} from 'node:path';
    import {runCaptureWorker} from ${JSON.stringify(url('capture-worker'))};
    import {CaptureWorkSession} from ${JSON.stringify(url('capture-work-session'))};
    await runCaptureWorker(start=>{
      if(start.options.failBeforeReceipt && start.pass.attempt===1)throw Error('injected pre-receipt failure');
      const session=new CaptureWorkSession(start,{owner:'fixture',selection:'fixture',now:()=>start.options.now,roots:start.options.roots??null,
        unit:{limit:1,maxRecords:start.options.records??1,maxBytes:8388608,discoveryLimit:start.options.discoveryLimit??128}});
      const append=session.store.appendUniqueBatch.bind(session.store);
      session.store.appendUniqueBatch=(stream,turns)=>{const n=append(stream,turns);
        if(stream===start.options.crashStream)process.kill(process.pid,'SIGKILL');return n;};
      const exec=session.index.db.exec.bind(session.index.db);
      session.index.db.exec=sql=>{if(sql==='DROP TABLE turn_text')fs.appendFileSync(join(start.root,'resets'),start.workerNonce+'\\n');return exec(sql);};
      const restart=session.inventory.restart.bind(session.inventory);
      session.inventory.restart=id=>{restart(id);if(start.options.crashPublication && start.pass.reset)process.kill(process.pid,'SIGKILL');};
      try {
        for(let n=0;n<(start.options.units??3);n++){
          const result=session.step();
          fs.appendFileSync(join(start.root,'events'),JSON.stringify({runId:session.run.id,attempt:start.pass.attempt,
            nonce:start.workerNonce,stage:result.stage??null,selected:result.selected??0,
            streams:(result.results??result.streams??[]).map(row=>row.stream),reset:result.reset??false,
            recovered:result.recovered??false,resetRequired:result.resetRequired??false,finalize:result.finalize??false,
            sourceDiscovery:result.sourceDiscovery??null})+'\\n');
          if(result.resetRequired)return session.yieldWorker({resetRequired:true});
          if(result.finalize)return session.finish({reason:'deadline'});
          if(result.idle)return session.finish();
          if(result.stopped)return session.yieldWorker();
        }
        return session.yieldWorker();
      } catch(error){fs.writeFileSync(join(start.root,'worker-error'),error.stack);throw error;}
      finally{session.close();}
    });
  `);
  return { root, store, inputs, roots,
    run: (options = {}, transport = {}) => superviseCapturePass(root, { now, roots, ...options }, { workerPath,
      env: { HOME: base, TMPDIR: base, XDG_CACHE_HOME: base, PATH: process.env.PATH }, ...transport }),
    state(fn) { const state = new DerivedState(root); try { return fn(state); } finally { state.close(); } },
    index(fn) { const index = new RecordIndex(store); try { return fn(index); } finally { index.close(); } },
    events() { return fs.readFileSync(join(root, 'events'), 'utf8').trim().split('\n').map(JSON.parse); },
    diagnostic(result) { const path = join(root, 'worker-error'); return JSON.stringify(result) + (fs.existsSync(path) ? '\n' + fs.readFileSync(path, 'utf8') : ''); },
  };
}

test('worker discovery resumes across formats and workers without promoting enumeration to pass success', async t => {
  const f = fixture(t, [['cc', 'native-a', native(1)], ['cc', 'native-b', native(2)],
    ['aw', 'mail-a', aw(3)], ['aw', 'mail-b', aw(4)]], { discover: true });
  const ccRoot = f.roots.find(root => root.source === 'cc').path;
  for (let n = 0; n < 6; n++) fs.writeFileSync(join(ccRoot, `0${n}.txt`), 'irrelevant');
  let appended = 0, indexed = 0, complete = false;
  for (let pass = 0; pass < 3 && !complete; pass++) {
    const result = await f.run({ units: 2, discoveryLimit: 1, records: 2 });
    assert.equal(result.outcome, 'partial', f.diagnostic(result)); assert.equal(result.exitCode, 0);
    const status = readCaptureStatus(f.root);
    appended += status.lastRun.counts.turnsAppended; indexed += status.lastRun.counts.turnsIndexed;
    assert.equal(status.lastSuccess, null); assert.equal(status.backlog.pending, true);
    complete = indexed === 4 && f.state(state => state.get('source-sweep', 'fixture').discovered &&
      !state.db.prepare("SELECT 1 AS found FROM capture_sources WHERE outcome!='complete' LIMIT 1").get()?.found);
  }
  assert.equal(complete, true); assert.equal(appended, 4); assert.equal(indexed, 4);
  const events = f.events(), pages = events.filter(row => row.sourceDiscovery).map(row => row.sourceDiscovery);
  assert.deepEqual(pages.slice(0, 2).map(page => page.source), ['cc', 'aw']);
  assert.equal(pages.reduce((n, page) => n + page.visited, 0), 10);
  assert.ok(pages.every(page => page.visited <= 1)); assert.ok(new Set(events.map(row => row.nonce)).size > 1);
  const firstCapture = events.find(row => row.stage === 'capture' && row.selected);
  assert.deepEqual(firstCapture.streams, ['fixture~aw'], 'AW capture need not wait for the larger native inventory');
  assert.equal(f.store.readStream('fixture~aw').length, 2);
  for (const name of ['native-a', 'native-b']) assert.equal(f.store.readStream(`fixture~cc.${name}`).length, 1);
  assert.equal(f.state(state => state.get('source-sweep', 'fixture').finished), false, 'discovery cannot retire the sweep');

  const g = fixture(t, [['aw', 'untouched', aw(5)]], { discover: true });
  const final = await g.run({}, { policy: { intervalSeconds: 900, heapMiB: 256, rssBytes: 2147483648, deadlineSeconds: 10, maxRecordBytes: 8388608 } });
  assert.equal(final.outcome, 'partial', g.diagnostic(final));
  assert.equal(g.state(state => state.get('source-sweep', 'fixture').discovery), null);
  assert.equal(g.state(state => state.db.prepare('SELECT count(*) AS n FROM capture_sources').get().n), 0);
  assert.equal(g.store.readStream('fixture~aw').length, 0);
});

test('mixed source/index units alternate across worker continuation without claiming all-stage completion', async t => {
  const f = fixture(t, [['aw', 'mail-a', aw(1) + aw(2)], ['aw', 'mail-b', aw(3) + aw(4)]]);
  const result = await f.run({ units: 2 });
  assert.equal(result.outcome, 'partial', f.diagnostic(result)); assert.equal(result.exitCode, 0);
  assert.ok(result.starts > 1);
  const events = f.events().filter(row => row.selected);
  assert.deepEqual(events.slice(0, 4).map(row => row.stage), ['capture', 'index', 'capture', 'index']);
  const status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.counts.turnsAppended, 4); assert.equal(status.lastRun.counts.turnsIndexed, 4);
  assert.equal(status.lastRun.counts.filesVisited, 2);
  assert.equal(f.index(index => index.db.prepare('SELECT count(*) AS n FROM turns').get().n), 4);
  assert.equal(status.lastRun.outcome, 'partial'); assert.equal(status.backlog.pending, true);
  assert.equal(status.lastSuccess, null, 'an idle mixed session is not final completion proof');
  assert.equal(f.state(state => state.get('capture-admission', 'active')), null);
});

test('ended source failure preserves confirmed healthy work and due capture waits for healthy index work', async t => {
  const f = fixture(t, [['cc', 'bad', native(1)], ['cc', 'healthy', native(2)]]);
  const failed = await f.run({ crashStream: 'fixture~cc.bad', units: 4, records: 4 });
  assert.equal(failed.outcome, 'failed', f.diagnostic(failed));
  let status = readCaptureStatus(f.root); const oldFailure = status.lastFailure, oldRun = status.lastRun.id;
  assert.equal(status.lastRun.counts.turnsAppended, 1);
  assert.equal(f.store.readStream('fixture~cc.bad').length, 1, 'fsynced bytes outlive failed accounting');
  assert.equal(f.store.readStream('fixture~cc.healthy').length, 1);
  assert.equal(status.backlog.failedCount, 1);
  const due = f.state(state => Date.parse(state.get('capture-retry', 'fixture~cc.bad').nextRetryAt));
  const outside = ['fixture~a-missing', 'fixture~a-prefix'].map((stream, i) => ({ stream,
    stage: i ? 'prefix' : 'capture', unitId: stream, attemptedRun: 'older-unrelated-pass',
    generation: null, offset: 0, nextRetryAt: new Date(due).toISOString() }));
  f.state(state => state.transaction(() => { for (const row of outside) state.set('capture-retry', row.stream, row); }));
  f.store.append('fixture~cc.healthy', turn(30));
  const resumed = await f.run({ now: due + 1, units: 4, records: 4 });
  assert.equal(resumed.outcome, 'partial', f.diagnostic(resumed)); assert.equal(resumed.exitCode, 0);
  status = readCaptureStatus(f.root);
  const events = f.events().filter(row => row.runId === status.lastRun.id && row.selected);
  assert.notEqual(status.lastRun.id, oldRun);
  assert.equal(events[0].stage, 'index'); assert.deepEqual(events[0].streams, ['fixture~cc.healthy']);
  const retried = events.find(row => row.stage === 'capture');
  assert.deepEqual(retried.streams, ['fixture~cc.bad']); assert.equal(retried.selected, 1);
  assert.equal(status.lastRun.counts.turnsAppended, 0, 'retry does not recount the earlier surviving append');
  assert.equal(status.lastRun.counts.turnsIndexed, 2);
  assert.deepEqual(status.lastFailure, oldFailure); assert.equal(status.lastSuccess, null);
  assert.equal(f.state(state => state.get('capture-retry', 'fixture~cc.bad')), null);
  assert.equal(f.state(state => state.get('capture-failed', 'fixture~cc.bad')), null);
  for (const row of outside) assert.deepEqual(f.state(state => state.get('capture-retry', row.stream)), row);
  assert.equal(f.store.readStream('fixture~cc.bad').length, 1);
  assert.equal(status.backlog.pending, true, 'retained cleanup and final all-stage audit remain required');
});

test('actual death after reset commit reconciles the current failure and recovers publication without repeating reset', async t => {
  const f = fixture(t); f.store.append('fixture~old', turn(1));
  f.index(index => { index.update(); index.db.exec("UPDATE index_state SET indexed_count=99 WHERE stream='fixture~old'"); });
  const result = await f.run({ crashPublication: true, units: 3 });
  assert.equal(result.outcome, 'failed', f.diagnostic(result)); assert.ok(result.starts >= 3);
  const events = f.events(), detection = events.find(row => row.resetRequired), recovery = events.find(row => row.recovered);
  assert.ok(detection); assert.ok(recovery); assert.notEqual(detection.nonce, recovery.nonce);
  const resets = fs.readFileSync(join(f.root, 'resets'), 'utf8').trim().split('\n');
  assert.equal(resets.length, 1); assert.notEqual(resets[0], detection.nonce);
  assert.equal(f.state(state => state.get('capture-index-reset', 'current')), null);
  const status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.outcome, 'failed'); assert.equal(status.lastFailure.id, status.lastRun.id);
  assert.equal(status.lastRun.counts.turnsIndexed, 1);
  assert.equal(status.backlog.failedCount, 0, 'union-reset failure has no invented failed stream');
  assert.equal(status.lastSuccess, null); assert.equal(status.backlog.pending, true);
  assert.equal(f.index(index => index.db.prepare('SELECT count(*) AS n FROM turns').get().n), 1);
});

test('pre-receipt failure remains current while a finalization-only worker never captures input', async t => {
  const f = fixture(t, [['aw', 'mail', aw(1)]]);
  const priorSuccess = f.state(state => new CaptureRun(f.root, state, { id: 'older-success' }).finish({ outcome: 'complete' }).lastSuccess);
  const failed = await f.run({ failBeforeReceipt: true, units: 4 });
  assert.equal(failed.outcome, 'failed', f.diagnostic(failed));
  let status = readCaptureStatus(f.root);
  assert.equal(status.lastFailure.id, status.lastRun.id); assert.equal(status.lastRun.reason, 'io');
  assert.equal(status.lastRun.counts.turnsAppended, 1); assert.deepEqual(status.lastSuccess, priorSuccess);
  const g = fixture(t, [['aw', 'untouched', aw(2)]]);
  const final = await g.run({}, { policy: { intervalSeconds: 900, heapMiB: 256, rssBytes: 2147483648, deadlineSeconds: 10, maxRecordBytes: 8388608 } });
  assert.equal(final.starts, 1); assert.equal(final.outcome, 'partial', g.diagnostic(final));
  assert.deepEqual(g.events().map(row => row.finalize), [true]);
  status = readCaptureStatus(g.root);
  assert.equal(status.lastRun.counts.turnsAppended, 0); assert.equal(status.lastRun.counts.filesVisited, 0);
  assert.equal(status.lastSuccess, null); assert.equal(status.backlog.pending, true);
  assert.equal(g.store.readStream('fixture~aw').length, 0);
});

test('a new pre-receipt failure cannot diagnose an older unreconciled admission', async t => {
  const f = fixture(t, [['aw', 'healthy', aw(1)]]);
  f.state(state => {
    new CaptureRun(f.root, state, { id: 'older-unfinished' }).publish({ pending: true });
    commitCaptureAdmission(state, { runId: 'older-unfinished', stage: 'index',
      next: { stage: 'index', after: 'fixture~lost' },
      members: [{ stream: 'fixture~lost', generation: null, offset: 0 }] }, new Set(['fixture~lost']), { now });
  });
  const result = await f.run({ failBeforeReceipt: true, units: 4 });
  assert.equal(result.outcome, 'failed', f.diagnostic(result)); assert.equal(result.reason, 'io');
  const old = f.state(state => state.get('capture-run-failure', 'last'));
  assert.equal(old.runId, 'older-unfinished'); assert.equal(old.reason, 'interrupted');
  assert.equal(f.state(state => state.get('capture-failed', 'fixture~lost').reason), 'interrupted');
  const status = readCaptureStatus(f.root);
  assert.notEqual(status.lastRun.id, old.runId); assert.equal(status.lastFailure.id, status.lastRun.id);
  assert.equal(status.lastFailure.reason, 'io'); assert.equal(status.lastRun.counts.turnsAppended, 1);
  assert.equal(status.lastSuccess, null);
});
