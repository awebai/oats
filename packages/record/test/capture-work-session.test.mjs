// Supervised fixture intentions for the private session, not ordinary-command,
// manager or full-service qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DerivedState } from '../lib/derived-state.mjs';
import { RecordStore } from '../lib/store.mjs';
import { RecordIndex } from '../lib/index-db.mjs';
import { CaptureSourceQueue } from '../lib/capture-source-queue.mjs';
import { CaptureSourceDiscovery } from '../lib/capture-source-discovery.mjs';
import { captureDefaultRootPlan } from '../lib/capture-default-roots.mjs';
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
    import {NativeCaptureDiscovery} from ${JSON.stringify(url('capture-discovery'))};
    import {DerivedState} from ${JSON.stringify(url('derived-state'))};
    await runCaptureWorker(start=>{
      if(start.options.failBeforeReceipt && start.pass.attempt===1)throw Error('injected pre-receipt failure');
      if(start.options.killDiscovery||start.options.killRootResolution){
        const state=new DerivedState(start.root);
        try{const active=state.get('capture-discovery-attempt','fixture');
          if(active)fs.appendFileSync(join(start.root,'discovery-replacements'),JSON.stringify({active,workerNonce:start.workerNonce})+'\\n');}
        finally{state.close();}
      }
      const session=new CaptureWorkSession(start,{owner:'fixture',selection:'fixture',now:()=>start.options.now,roots:start.options.roots??null,
        unit:{limit:1,maxRecords:start.options.records??1,maxBytes:8388608,discoveryLimit:start.options.discoveryLimit??128}});
      if(start.options.audit){
        fs.appendFileSync(join(start.root,'audit-workers'),JSON.stringify({runId:session.run.id,scope:session.queue.current().id,
          counts:session.run.current().run.counts,retirement:session.state.get('capture-sweep-retirement','fixture')})+'\\n');
        const finish=session.run.finish.bind(session.run);
        session.run.finish=options=>{
          if(start.options.killBeforeReceipt && !fs.existsSync(join(start.root,'audit-death')) &&
              session.state.get('capture-sweep-retirement','fixture')){
            fs.writeFileSync(join(start.root,'audit-death'),JSON.stringify({scope:session.queue.current().id,
              runId:session.run.id,counts:session.run.current().run.counts}));
            process.kill(process.pid,'SIGKILL');
          }
          return finish(options);
        };
        if(start.options.killAudit){
          const audit=session.outcomes.audit.bind(session.outcomes);
          session.outcomes.audit=options=>{
            const result=audit(options);
            fs.appendFileSync(join(start.root,'audit-pages'),JSON.stringify({nonce:start.workerNonce,after:options.after,
              retirement:session.state.get('capture-sweep-retirement','fixture')})+'\\n');
            if(result.checked && !fs.existsSync(join(start.root,'audit-scan-death'))){
              fs.writeFileSync(join(start.root,'audit-scan-death'),session.run.id);
              process.kill(process.pid,'SIGKILL');
            }
            return result;
          };
        }
      }
      const append=session.store.appendUniqueBatch.bind(session.store);
      session.store.appendUniqueBatch=(stream,turns)=>{const n=append(stream,turns);
        if(stream===start.options.crashStream)process.kill(process.pid,'SIGKILL');return n;};
      const exec=session.index.db.exec.bind(session.index.db);
      session.index.db.exec=sql=>{if(sql==='DROP TABLE turn_text')fs.appendFileSync(join(start.root,'resets'),start.workerNonce+'\\n');return exec(sql);};
      const restart=session.inventory.restart.bind(session.inventory);
      session.inventory.restart=id=>{restart(id);if(start.options.crashPublication && start.pass.reset)process.kill(process.pid,'SIGKILL');};
      if(start.options.killDiscovery){
        const advance=NativeCaptureDiscovery.prototype.advance;
        NativeCaptureDiscovery.prototype.advance=function(options){
          const result=advance.call(this,options);
          if(this.format==='cc'){
            const active=session.state.get('capture-discovery-attempt','fixture');
            if(!active)throw Error('discovery reader has no committed admission');
            fs.appendFileSync(join(start.root,'discovery-deaths'),JSON.stringify({active,depth:session.state.depth,
              discovery:session.queue.current().discovery,runId:session.run.id})+'\\n');
            // This independent journal growth must be indexed AFTER replacement.
            session.store.appendBatch('fixture~existing',[start.options.deathTurn]);
            process.kill(process.pid,'SIGKILL');
          }
          return result;
        };
      }
      if(start.options.killRootResolution){
        const resolve=session.sourceDiscovery.resolveRoots.bind(session.sourceDiscovery);
        session.sourceDiscovery.resolveRoots=source=>{
          const active=session.state.get('capture-discovery-attempt','fixture');
          if(!active||active.phase!=='roots'||session.state.depth!==0)throw Error('root selector has no committed admission');
          const roots=resolve(source);
          if(source==='cc'){
            fs.appendFileSync(join(start.root,'root-resolution-deaths'),JSON.stringify({active,depth:session.state.depth,
              discovery:session.queue.current().discovery,runId:session.run.id})+'\\n');
            session.store.appendBatch('fixture~existing',[start.options.deathTurn]);
            process.kill(process.pid,'SIGKILL');
          }
          return roots;
        };
      }
      try {
        for(let n=0;n<(start.options.units??3);n++){
          const result=session.step();
          // Only admitted capture/index stages return per-stream rows. The
          // inventory-cleanup stage returns numeric metadata deletion counts.
          const streamRows=result.stage==='capture'?(result.results??(result.selected?null:[])):
            result.stage==='index'?(result.streams??(result.selected?null:[])):[];
          if(!Array.isArray(streamRows) || streamRows.some(row=>typeof row?.stream!=='string'))
            throw Error('invalid fixture processing result');
          const inventoryCleanup=result.stage==='inventory-cleanup'?{sources:result.sources,streams:result.streams}:null;
          if(inventoryCleanup && !Object.values(inventoryCleanup).every(n=>Number.isSafeInteger(n)&&n>=0))
            throw Error('invalid fixture inventory cleanup counts');
          fs.appendFileSync(join(start.root,'events'),JSON.stringify({runId:session.run.id,attempt:start.pass.attempt,
            nonce:start.workerNonce,stage:result.stage??null,selected:result.selected??0,
            streams:streamRows.map(row=>row.stream),inventoryCleanup,reset:result.reset??false,
            recovered:result.recovered??false,resetRequired:result.resetRequired??false,finalize:result.finalize??false,
            sourceDiscovery:result.sourceDiscovery??null})+'\\n');
          if(result.resetRequired)return session.yieldWorker({resetRequired:true});
          if(result.finalize)return start.options.audit?session.complete():session.finish({reason:'deadline'});
          if(result.idle)return start.options.audit?session.complete({limit:start.options.auditLimit??128}):session.finish();
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

test('fresh all-stage audit completes empty sweeps and renews both inventories on the next pass', async t => {
  const f = fixture(t, [], { discover: true });
  const first = await f.run({ audit: true, units: 20 });
  assert.equal(first.outcome, 'complete', f.diagnostic(first)); assert.equal(first.exitCode, 0);
  const a = readCaptureStatus(f.root), before = f.state(state => ({ source: state.get('source-sweep', 'fixture').id,
    index: state.get('index-inventory', 'current').id }));
  assert.equal(a.lastSuccess.id, a.lastRun.id); assert.equal(a.backlog.pending, false);
  assert.equal(a.lastRun.counts.turnsAppended, 0); assert.equal(a.lastRun.counts.turnsIndexed, 0);
  assert.equal(a.lastProgressAt, null);
  const second = await f.run({ audit: true, units: 20 });
  assert.equal(second.outcome, 'complete', f.diagnostic(second));
  const b = readCaptureStatus(f.root);
  assert.notEqual(b.lastRun.id, a.lastRun.id); assert.equal(b.lastSuccess.id, b.lastRun.id);
  assert.equal(b.lastProgressAt, null, 'obsolete inventory cleanup is not capture/index progress');
  const cleanup = f.events().filter(event => event.runId === b.lastRun.id && event.stage === 'inventory-cleanup');
  assert.ok(cleanup.length > 0, 'renewal visits obsolete inventory even when it contains no rows');
  for (const event of cleanup) {
    assert.deepEqual(event.inventoryCleanup, { sources: 0, streams: 0 });
    assert.deepEqual(event.streams, []); assert.equal(event.selected, 0);
  }
  f.state(state => {
    assert.notEqual(state.get('source-sweep', 'fixture').id, before.source);
    assert.notEqual(state.get('index-inventory', 'current').id, before.index);
    for (const kind of ['source-queue-garbage', 'index-inventory-garbage'])
      assert.notEqual(state.db.prepare('SELECT 1 AS found FROM state WHERE kind=? LIMIT 1').get(kind)?.found, 1);
  });
});

test('complete receipt follows mixed processing and next-sweep growth without duplicate appends', async t => {
  const f = fixture(t, [['cc', 'native', native(1)], ['aw', 'mail', aw(2) + aw(3)]], { discover: true });
  const first = await f.run({ audit: true, units: 2, records: 2 });
  assert.equal(first.outcome, 'complete', f.diagnostic(first)); assert.ok(first.starts > 1);
  let status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.counts.filesVisited, 2); assert.equal(status.lastRun.counts.turnsAppended, 3);
  assert.equal(status.lastRun.counts.turnsIndexed, 3); assert.equal(status.backlog.pending, false);
  assert.equal(status.lastSuccess.id, status.lastRun.id); assert.equal(status.lastFailure, null);
  fs.appendFileSync(f.inputs.find(input => input.source === 'aw').path, aw(4));
  f.store.append('fixture~new-journal', turn(5));
  const second = await f.run({ audit: true, units: 20, records: 4 });
  assert.equal(second.outcome, 'complete', f.diagnostic(second)); status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.counts.turnsAppended, 1); assert.equal(status.lastRun.counts.turnsIndexed, 2);
  assert.equal(status.lastRun.counts.filesVisited, 2); assert.equal(status.backlog.pending, false);
  assert.equal(f.store.readStream('fixture~aw').length, 3);
  assert.equal(f.store.readStream('fixture~cc.native').length, 1);
  assert.equal(f.index(index => index.db.prepare('SELECT count(*) AS n FROM turns').get().n), 5);
  const cleanup = f.events().filter(event => event.runId === status.lastRun.id && event.stage === 'inventory-cleanup');
  assert.equal(cleanup.reduce((n, event) => n + event.inventoryCleanup.sources, 0), 2);
  assert.equal(cleanup.reduce((n, event) => n + event.inventoryCleanup.streams, 0), 2);
  for (const event of cleanup) { assert.deepEqual(event.streams, []); assert.equal(event.selected, 0); }
});

test('finalization-only allowance cannot initiate a completion audit even for an empty root plan', async t => {
  const f = fixture(t, [], { discover: true });
  const result = await f.run({ audit: true }, { policy: { intervalSeconds: 900, heapMiB: 256,
    rssBytes: 2147483648, deadlineSeconds: 10, maxRecordBytes: 8388608 } });
  assert.equal(result.outcome, 'partial', f.diagnostic(result)); assert.equal(result.starts, 1);
  assert.equal(readCaptureStatus(f.root).lastSuccess, null);
  assert.equal(f.state(state => state.get('capture-sweep-retirement', 'fixture')), null);
  assert.equal(f.state(state => state.get('source-sweep', 'fixture').discovered), false);
});

test('terminal incomplete input stays partial and is revisited by a new sweep after its line completes', async t => {
  const f = fixture(t, [['aw', 'mail', aw(1).slice(0, -2)]], { discover: true });
  const first = await f.run({ audit: true, units: 20 });
  assert.equal(first.outcome, 'partial', f.diagnostic(first)); assert.equal(first.exitCode, 0);
  const pending = readCaptureStatus(f.root);
  assert.equal(pending.backlog.pending, true); assert.equal(pending.lastSuccess, null);
  assert.equal(pending.lastRun.counts.inputsPending, 1); assert.equal(pending.lastRun.counts.turnsAppended, 0);
  const scope = f.state(state => state.get('source-sweep', 'fixture').id);
  fs.appendFileSync(f.inputs[0].path, '}\n');
  const second = await f.run({ audit: true, units: 20 });
  assert.equal(second.outcome, 'complete', f.diagnostic(second));
  const done = readCaptureStatus(f.root);
  assert.equal(done.lastRun.counts.inputsPending, 0); assert.equal(done.lastRun.counts.turnsAppended, 1);
  assert.equal(done.lastRun.counts.turnsIndexed, 1); assert.equal(done.backlog.pending, false);
  assert.notEqual(f.state(state => state.get('source-sweep', 'fixture').id), scope);
});

test('death after final audit before receipt retains the same sweep and counts, then a later pass may succeed', async t => {
  const f = fixture(t, [['aw', 'mail', aw(1) + aw(2)]], { discover: true });
  const failed = await f.run({ audit: true, killBeforeReceipt: true, units: 20, records: 4 });
  assert.equal(failed.outcome, 'failed', f.diagnostic(failed)); assert.equal(failed.exitCode, 1);
  assert.ok(failed.starts > 1);
  const status = readCaptureStatus(f.root), death = JSON.parse(fs.readFileSync(join(f.root, 'audit-death'), 'utf8'));
  const workers = fs.readFileSync(join(f.root, 'audit-workers'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(status.lastRun.id, death.runId); assert.equal(status.lastFailure.id, death.runId);
  assert.equal(status.lastSuccess, null); assert.deepEqual(status.lastRun.counts, death.counts);
  assert.equal(status.lastRun.counts.filesVisited, 1); assert.equal(status.lastRun.counts.turnsAppended, 2);
  assert.equal(status.lastRun.counts.turnsIndexed, 2);
  const replacement = workers.find(row => row.retirement?.runId === death.runId);
  assert.ok(replacement); assert.equal(replacement.scope, death.scope); assert.deepEqual(replacement.counts, death.counts);
  assert.ok(workers.every(row => row.scope === death.scope));
  const next = await f.run({ audit: true, units: 20, records: 4 });
  assert.equal(next.outcome, 'complete', f.diagnostic(next));
  const recovered = readCaptureStatus(f.root);
  assert.deepEqual(recovered.lastFailure, status.lastFailure); assert.equal(recovered.lastSuccess.id, recovered.lastRun.id);
  assert.equal(recovered.lastRun.counts.turnsAppended, 0); assert.equal(recovered.lastRun.counts.turnsIndexed, 0);
  assert.equal(recovered.lastRun.counts.filesVisited, 1); assert.equal(f.store.readStream('fixture~aw').length, 2);
});

test('actual death during final metadata audit discards partial proof and retains current-pass failure', async t => {
  const f = fixture(t, [], { discover: true });
  for (const [n, name] of ['a', 'b'].entries()) f.store.append(`fixture~${name}`, turn(n));
  const result = await f.run({ audit: true, killAudit: true, auditLimit: 1, units: 20 });
  assert.equal(result.outcome, 'failed', f.diagnostic(result)); assert.ok(result.starts > 1);
  const status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.counts.turnsIndexed, 2); assert.equal(status.lastRun.counts.turnsAppended, 0);
  assert.equal(status.lastFailure.id, status.lastRun.id); assert.equal(status.lastSuccess, null);
  const pages = fs.readFileSync(join(f.root, 'audit-pages'), 'utf8').trim().split('\n').map(JSON.parse);
  const starts = pages.filter(row => row.after === '');
  assert.equal(starts.length, 2); assert.notEqual(starts[0].nonce, starts[1].nonce);
  assert.equal(starts[0].retirement, null); assert.equal(starts[1].retirement, null);
  assert.equal(f.index(index => index.db.prepare('SELECT count(*) AS n FROM turns').get().n), 2);
});

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

test('persistent discovery refusal survives replacement while independent capture and indexing commit in the same pass', async t => {
  const f = fixture(t, [['cc', 'blocked', native(1)], ['aw', 'a', aw(2)], ['aw', 'b', aw(3)]], { discover: true });
  const ccRoot = f.roots.find(root => root.source === 'cc').path;
  fs.writeFileSync(join(ccRoot, '0.txt'), 'irrelevant');
  // Retain a selected native-directory identity and one queued healthy account;
  // the other AW account still requires discovery by the owning worker.
  const before = f.state(state => {
    const queue = new CaptureSourceQueue(state, { owner: 'fixture', selection: 'fixture' });
    const discovery = new CaptureSourceDiscovery(queue, f.roots);
    try { discovery.advance({ limit: 1 }); discovery.advance({ limit: 1 }); return queue.current().discovery; }
    finally { discovery.close(); }
  });
  fs.renameSync(ccRoot, ccRoot + '.saved'); fs.mkdirSync(ccRoot);
  fs.writeFileSync(join(ccRoot, 'replacement.jsonl'), native(99));
  f.store.appendBatch('fixture~existing', [turn(4)]);

  const first = await f.run({ units: 2 });
  assert.equal(first.outcome, 'failed', f.diagnostic(first)); assert.equal(first.reason, 'io'); assert.equal(first.exitCode, 1);
  const status = readCaptureStatus(f.root), sweep = f.state(state => state.get('source-sweep', 'fixture'));
  assert.equal(status.lastRun.counts.turnsAppended, 2); assert.equal(status.lastRun.counts.turnsIndexed, 3);
  assert.equal(status.lastRun.counts.filesVisited, 2); assert.equal(status.lastSuccess, null);
  assert.equal(status.lastFailure.id, status.lastRun.id); assert.equal(status.lastFailure.reason, 'io');
  assert.equal(status.backlog.pending, true); assert.equal(sweep.discovered, false); assert.equal(sweep.finished, false);
  const refused = sweep.discovery.groups[0];
  assert.equal(refused.root, before.groups[0].root); assert.equal(refused.complete, false);
  assert.deepEqual(refused.checkpoint, before.groups[0].checkpoint);
  assert.equal(refused.failure.attempts, 1); assert.equal(refused.failure.runId, status.lastRun.id);
  assert.equal(refused.failure.nextRetryAt, new Date(now + 30 * 60_000).toISOString());
  assert.equal(sweep.discovery.groups[3].complete, true, 'safe format discovery finishes after the refused root');
  assert.equal(f.store.readStream('fixture~aw').length, 2);
  assert.equal(f.store.readStream('fixture~cc.replacement').length, 0);
  const events = f.events();
  assert.ok(events.every(event => event.attempt > 1), 'the initial discovery failure precedes all committed healthy work');
  assert.ok(new Set(events.map(event => event.nonce)).size > 1, 'healthy work continues across replacement workers');
  assert.equal(f.state(state => [...state.entries('capture-failed')].length), 0, 'root refusal invents no stream attribution');
  assert.deepEqual(f.state(state => state.get('capture-discovery-failure', 'last')),
    { runId: status.lastRun.id, reason: 'io', scope: sweep.id, source: 'cc', path: ccRoot });

  f.store.appendBatch('fixture~existing', [turn(5)]);
  const waiting = await f.run({ units: 2, now: now + 60_000 });
  assert.equal(waiting.outcome, 'partial', f.diagnostic(waiting)); assert.equal(waiting.exitCode, 0);
  const waited = readCaptureStatus(f.root);
  assert.equal(waited.lastRun.counts.turnsAppended, 0); assert.equal(waited.lastRun.counts.turnsIndexed, 1);
  assert.deepEqual(waited.lastFailure, status.lastFailure); assert.equal(waited.lastSuccess, null);
  assert.deepEqual(f.state(state => state.get('source-sweep', 'fixture').discovery.groups[0]), refused);

  f.store.appendBatch('fixture~existing', [turn(6)]);
  const dueAt = now + 30 * 60_000, due = await f.run({ units: 2, now: dueAt });
  assert.equal(due.outcome, 'failed', f.diagnostic(due)); assert.equal(due.reason, 'io');
  const retried = readCaptureStatus(f.root), failedAgain = f.state(state => state.get('source-sweep', 'fixture').discovery.groups[0]);
  assert.equal(retried.lastRun.counts.turnsIndexed, 1); assert.equal(retried.lastRun.counts.turnsAppended, 0);
  assert.equal(retried.lastFailure.id, retried.lastRun.id); assert.notEqual(retried.lastRun.id, status.lastRun.id);
  assert.equal(failedAgain.failure.attempts, 2);
  assert.equal(failedAgain.failure.nextRetryAt, new Date(dueAt + 60 * 60_000).toISOString());
  assert.deepEqual(failedAgain.checkpoint, before.groups[0].checkpoint);

  // Only restoration of the selected directory permits resuming its checkpoint.
  fs.rmSync(ccRoot, { recursive: true }); fs.renameSync(ccRoot + '.saved', ccRoot);
  const restored = await f.run({ units: 2, now: dueAt + 60 * 60_000 });
  assert.equal(restored.outcome, 'partial', f.diagnostic(restored));
  const recovered = readCaptureStatus(f.root), finished = f.state(state => state.get('source-sweep', 'fixture'));
  assert.equal(recovered.lastRun.counts.turnsAppended, 1); assert.equal(recovered.lastRun.counts.turnsIndexed, 1);
  assert.deepEqual(recovered.lastFailure, retried.lastFailure); assert.equal(recovered.lastSuccess, null);
  assert.equal(recovered.backlog.pending, true); assert.equal(finished.discovered, true); assert.equal(finished.finished, false);
  assert.equal(finished.discovery.groups[0].failure, undefined);
  assert.equal(f.store.readStream('fixture~cc.blocked').length, 1);
});

for (const retry of [false, true])
test(`discovery death before publication preserves admission and healthy replacement work (due retry: ${retry})`, async t => {
  const f = fixture(t, [['cc', 'blocked', native(1)], ['aw', 'a', aw(2)], ['aw', 'b', aw(3)]], { discover: true });
  const ccRoot = f.roots.find(root => root.source === 'cc').path;
  fs.writeFileSync(join(ccRoot, '0.txt'), 'irrelevant');
  f.state(state => {
    const queue = new CaptureSourceQueue(state, { owner: 'fixture', selection: 'fixture' });
    const discovery = new CaptureSourceDiscovery(queue, f.roots);
    try {
      if (retry) { discovery.advance({ limit: 1 }); discovery.advance({ limit: 1 }); }
      else queue.add([f.inputs.find(input => input.source === 'aw')], null);
    } finally { discovery.close(); }
  });
  f.store.appendBatch('fixture~existing', [turn(4)]);
  let at = now;
  if (retry) {
    fs.renameSync(ccRoot, ccRoot + '.saved'); fs.mkdirSync(ccRoot);
    const seed = await f.run({ units: 2, records: 4 });
    assert.equal(seed.outcome, 'failed', f.diagnostic(seed)); assert.equal(seed.reason, 'io');
    at = Date.parse(f.state(state => state.get('source-sweep', 'fixture').discovery.groups[0].failure.nextRetryAt));
    fs.rmdirSync(ccRoot); fs.renameSync(ccRoot + '.saved', ccRoot);
  }
  const before = f.state(state => state.get('source-sweep', 'fixture'));
  const plan = f.state(state => {
    const discovery = new CaptureSourceDiscovery(new CaptureSourceQueue(state, { owner: 'fixture', selection: 'fixture' }), f.roots);
    try { return discovery.current(); } finally { discovery.close(); }
  });
  const result = await f.run({ units: 2, records: 4, now: at, killDiscovery: true, deathTurn: turn(5) });
  assert.equal(result.outcome, 'failed', f.diagnostic(result)); assert.equal(result.reason, 'interrupted'); assert.equal(result.exitCode, 1);
  const status = readCaptureStatus(f.root), after = f.state(state => state.get('source-sweep', 'fixture'));
  const deaths = fs.readFileSync(join(f.root, 'discovery-deaths'), 'utf8').trim().split('\n').map(JSON.parse);
  const replacements = fs.readFileSync(join(f.root, 'discovery-replacements'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(deaths.length, 1, 'the admitted root is never readmitted in this pass');
  assert.equal(replacements.length, 1, 'exact unfinished admission survives actual worker death');
  assert.equal(deaths[0].depth, 0, 'reader work is outside the admission transaction');
  assert.equal(deaths[0].active.runId, status.lastRun.id); assert.equal(deaths[0].active.scope, before.id);
  assert.equal(deaths[0].active.plan, plan.plan); assert.equal(deaths[0].active.source, 'cc');
  assert.equal(deaths[0].active.path, ccRoot); assert.deepEqual(deaths[0].active.group, plan.groups[0]);
  assert.deepEqual(deaths[0].discovery, before.discovery, 'admission is not enumeration progress');
  assert.deepEqual(replacements[0].active, deaths[0].active);
  assert.notEqual(replacements[0].workerNonce, deaths[0].active.workerNonce);
  const pending = after.discovery.groups[0];
  assert.deepEqual(pending.checkpoint, plan.groups[0].checkpoint); assert.equal(pending.root, 0);
  assert.equal(pending.complete, false); assert.equal(after.discovered, false); assert.equal(after.finished, false);
  assert.equal(pending.failure.runId, status.lastRun.id); assert.equal(pending.failure.attemptedRun, status.lastRun.id);
  assert.equal(pending.failure.reason, 'interrupted'); assert.equal(pending.failure.attempts, retry ? 2 : 1);
  assert.equal(pending.failure.nextRetryAt, new Date(at + (retry ? 60 : 30) * 60_000).toISOString());
  assert.equal(f.state(state => state.get('capture-discovery-attempt', 'fixture')), null);
  assert.equal(status.lastRun.counts.turnsAppended, retry ? 0 : 2);
  assert.equal(status.lastRun.counts.turnsIndexed, retry ? 1 : 4);
  assert.equal(status.lastFailure.id, status.lastRun.id); assert.equal(status.lastFailure.reason, 'interrupted');
  assert.equal(status.lastSuccess, null); assert.equal(status.backlog.pending, true);
  assert.equal(f.store.readStream('fixture~cc.blocked').length, 0, 'unpublished discovered inputs never reach capture');
  assert.equal(f.state(state => [...state.entries('capture-failed')].length), 0);
  assert.ok(f.events().some(event => event.runId === status.lastRun.id && event.nonce === replacements[0].workerNonce &&
    event.stage === 'index' && event.selected), 'replacement indexes independent growth after discovery death');
  assert.deepEqual(f.state(state => state.get('capture-discovery-failure', 'last')),
    { runId: status.lastRun.id, reason: 'interrupted', scope: before.id, source: 'cc', path: ccRoot });

  f.store.appendBatch('fixture~existing', [turn(6)]);
  const waiting = await f.run({ units: 2, records: 4, now: at + 60_000, killDiscovery: true, deathTurn: turn(7) });
  assert.equal(waiting.outcome, 'partial', f.diagnostic(waiting)); assert.equal(waiting.exitCode, 0);
  const waited = readCaptureStatus(f.root);
  assert.deepEqual(waited.lastFailure, status.lastFailure); assert.equal(waited.lastRun.counts.turnsIndexed, 1);
  assert.equal(waited.lastRun.counts.turnsAppended, 0); assert.equal(waited.backlog.pending, true);
  assert.deepEqual(f.state(state => state.get('source-sweep', 'fixture').discovery.groups[0]), pending);
  assert.equal(fs.readFileSync(join(f.root, 'discovery-deaths'), 'utf8').trim().split('\n').length, 1);
});

for (const retry of [false, true])
test(`default-root resolution death retains selection admission and permits independent work (due retry: ${retry})`, async t => {
  const f = fixture(t, [['aw', 'queued', aw(1)]], { discover: true }), home = join(f.root, '..');
  const config = join(home, 'cc-config'), awRoot = join(home, '.config/aw/logs');
  fs.mkdirSync(awRoot, { recursive: true }); fs.writeFileSync(join(awRoot, 'account.jsonl'), aw(2));
  const plan = captureDefaultRootPlan({ home, cwd: home, env: { CLAUDE_CONFIG_DIR: './cc-config' }, sources: ['cc', 'aw'] });
  f.state(state => new CaptureSourceQueue(state, { owner: 'fixture', selection: 'fixture' }).add(f.inputs, null));
  f.store.appendBatch('fixture~existing', [turn(3)]);
  let at = now, prior = null;
  if (retry) {
    const seed = await f.run({ roots: plan, units: 4, records: 4 });
    assert.equal(seed.outcome, 'failed', f.diagnostic(seed)); assert.equal(seed.reason, 'io');
    prior = readCaptureStatus(f.root);
    assert.equal(prior.lastRun.counts.turnsAppended, 2); assert.equal(prior.lastRun.counts.turnsIndexed, 3);
    at = Date.parse(f.state(state => state.get('source-sweep', 'fixture').discovery.groups[0].failure.nextRetryAt));
  }
  fs.mkdirSync(join(config, 'projects'), { recursive: true }); fs.writeFileSync(join(config, 'projects/blocked.jsonl'), native(5));
  const before = f.state(state => state.get('source-sweep', 'fixture'));
  const original = f.state(state => {
    const discovery = new CaptureSourceDiscovery(new CaptureSourceQueue(state, { owner: 'fixture', selection: 'fixture' }), plan);
    try { return discovery.current(); } finally { discovery.close(); }
  });
  const result = await f.run({ roots: plan, units: 4, records: 4, now: at, killRootResolution: true, deathTurn: turn(4) });
  assert.equal(result.outcome, 'failed', f.diagnostic(result)); assert.equal(result.reason, 'interrupted'); assert.equal(result.exitCode, 1);
  const status = readCaptureStatus(f.root), sweep = f.state(state => state.get('source-sweep', 'fixture'));
  const deaths = fs.readFileSync(join(f.root, 'root-resolution-deaths'), 'utf8').trim().split('\n').map(JSON.parse);
  const replacements = fs.readFileSync(join(f.root, 'discovery-replacements'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(deaths.length, 1); assert.equal(replacements.length, 1);
  assert.equal(deaths[0].depth, 0); assert.equal(deaths[0].active.phase, 'roots');
  assert.equal(deaths[0].active.runId, status.lastRun.id); assert.equal(deaths[0].active.scope, before.id);
  assert.equal(deaths[0].active.plan, original.plan); assert.equal(deaths[0].active.path, home);
  assert.deepEqual(deaths[0].active.group, original.groups[0]); assert.deepEqual(deaths[0].discovery, before.discovery);
  assert.deepEqual(replacements[0].active, deaths[0].active);
  assert.notEqual(replacements[0].workerNonce, deaths[0].active.workerNonce);
  const pending = sweep.discovery.groups[0];
  assert.equal(pending.roots, null); assert.equal(pending.root, 0); assert.equal(pending.checkpoint, null);
  assert.equal(pending.complete, false); assert.equal(sweep.discovered, false); assert.equal(sweep.finished, false);
  assert.equal(pending.failure.runId, status.lastRun.id); assert.equal(pending.failure.attemptedRun, status.lastRun.id);
  assert.equal(pending.failure.attempts, retry ? 2 : 1); assert.equal(pending.failure.reason, 'interrupted');
  assert.equal(pending.failure.nextRetryAt, new Date(at + (retry ? 60 : 30) * 60_000).toISOString());
  assert.equal(f.state(state => state.get('capture-discovery-attempt', 'fixture')), null);
  assert.equal(sweep.discovery.groups[3].complete, true);
  assert.equal(status.lastRun.counts.turnsAppended, retry ? 0 : 2);
  assert.equal(status.lastRun.counts.turnsIndexed, retry ? 1 : 4);
  assert.equal(status.lastFailure.id, status.lastRun.id); assert.equal(status.lastSuccess, null);
  assert.equal(status.backlog.pending, true); assert.equal(f.store.readStream('fixture~aw').length, 2);
  assert.equal(f.store.readStream('fixture~cc.blocked').length, 0);
  assert.ok(f.events().some(event => event.runId === status.lastRun.id && event.nonce === replacements[0].workerNonce &&
    event.stage === 'index' && event.selected), 'replacement indexes growth committed just before selector death');
  if (prior) assert.notEqual(status.lastFailure.id, prior.lastFailure.id);
  f.store.appendBatch('fixture~existing', [turn(6)]);
  const waiting = await f.run({ roots: plan, units: 4, records: 4, now: at + 60_000, killRootResolution: true, deathTurn: turn(7) });
  assert.equal(waiting.outcome, 'partial', f.diagnostic(waiting)); assert.equal(waiting.exitCode, 0);
  const waited = readCaptureStatus(f.root);
  assert.equal(waited.lastRun.counts.turnsIndexed, 1); assert.equal(waited.lastRun.counts.turnsAppended, 0);
  assert.deepEqual(waited.lastFailure, status.lastFailure);
  assert.deepEqual(f.state(state => state.get('source-sweep', 'fixture').discovery.groups[0]), pending);
  assert.equal(fs.readFileSync(join(f.root, 'root-resolution-deaths'), 'utf8').trim().split('\n').length, 1);
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
