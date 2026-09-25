// v2 keeps captured evidence independently of a source or worker. Only native
// record responses are faked here; scheduling and worker scaffolding cross the
// real public kernel CLI. No source-worktree attachment or fabricated spawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fixture, write, json, readJSON, CLI } from './helpers/okf-v2.mjs';
// Until the lead's Q1 (capability agents spawn prepared on a workspace deployment): these
// two drive a harvest worker whose source home is gone, which only the classic scope resolves.

function recordBoundary(f, { native = false } = {}) {
  const wrapper = join(f.base, "record ' boundary.mjs"), calls = join(f.base, 'calls.jsonl');
  write(wrapper, `#!${process.execPath}
import * as fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const a=process.argv.slice(2),root=${JSON.stringify(f.base)},val=k=>a[a.indexOf(k)+1];
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({a,cwd:process.cwd(),identity:process.env.OATS_HOME||null})+'\\n');
const native=${native};
if (!native && a[0]==='capture') process.stdout.write(fs.readFileSync(root+'/capture.json'));
else if (!native && a[0]==='recall') {
  const all=JSON.parse(fs.readFileSync(root+'/turns.json')).filter(t=>t.thread===val('--thread'));
  if(a.includes('--after') && !all.some(t=>t.id===val('--after'))) {console.error('--after: no turn '+val('--after'));process.exit(1);}
  const from=a.includes('--after')?all.findIndex(t=>t.id===val('--after'))+1:0;
  const end=all.findIndex(t=>t.id===val('--until'))+1;
  const turns=all.slice(from,Math.min(end,from+Number(val('--limit'))));
  if(!a.includes('--ids-only') && fs.existsSync(root+'/recall-fail') && turns.some(t=>t.id===fs.readFileSync(root+'/recall-fail','utf8'))) {console.error('fixture unread window');process.exit(47);}
  const selected=a.includes('--ids-only')?turns.map(({text,...t})=>({...t,bytes:Buffer.byteLength(JSON.stringify({...t,text},null,2))+8})):turns;
  console.log(JSON.stringify({turns:selected,remaining:end-from-turns.length}));
} else {
  if(a[0]==='session' || (a[0]==='schedule' && a.includes('install'))) {console.error('fixture forbids model or timer launch');process.exit(98);}
  const r=spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(CLI)},...a,...(native && a[0]==='capture'?['--current-roots']:[])],{stdio:'inherit'});process.exitCode=r.status??1;
}
`);
  fs.chmodSync(wrapper, 0o755);
  return {
    run: (args, opts = {}) => f.direct(args, { ...opts, environment: { OATS_CLI_BIN: wrapper, ...opts.environment } }),
    calls: () => fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) : [],
  };
}
function records(f, groups) {
  const turns = groups.flatMap(([thread, count, bytes = 100]) => Array.from({ length: count }, (_, i) => ({ id: `${thread}-${i + 1}`, thread, kind: 'session', source: 'pi', ts: '2026-09-13T12:00:00Z', text: [{ role: 'assistant', text: 'x'.repeat(bytes) }] })));
  json(join(f.base, 'turns.json'), turns);
  json(join(f.base, 'capture.json'), { status: 'complete', complete: true, sessions: groups.map(([thread, count]) => ({ thread, lastTurnId: `${thread}-${count}` })) });
  return turns;
}
const status = f => readJSON(join(dirname(f.sourceFile), 'status.json'));
const runResult = r => { assert.equal(r.out.ok, true, r.stdout); return r.out.result; };

test('notes AND bounded record backlog enter durable custody; actual independent worker completes after source deletion', t => {
  const f = fixture(t), boundary = recordBoundary(f);
  const turns = records(f, [['thread', 145]]);
  write(join(f.home, 'notes/decision.md'), 'Accepted rationale from the source.\n');
  const retired = boundary.run(['retire']); assert.equal(retired.out.meta.retired, true);
  const captured = status(f); assert.equal(captured.captured.inputs.length, 4); assert.equal(captured.captured.threads.thread, 'thread-145');
  assert.deepEqual(captured.processed, [], 'capture is not judgment');
  fs.rmSync(f.home, { recursive: true }); fs.rmSync(join(f.base, 'turns.json')); fs.rmSync(join(f.base, 'capture.json'));
  const run = runResult(boundary.run(['run-source', '--source', f.sourceFile, '--manual', '--no-launch']));
  assert.equal(run.status, 'ready'); assert.equal(fs.lstatSync(join(run.home, 'work')).isSymbolicLink(), false);
  assert.equal(readJSON(join(run.home, 'instance.json')).work, 'directory');
  assert.equal(fs.existsSync(join(run.home, '.okf-source.json')), false, 'service workers do not recursively capture');
  const evidence = readJSON(join(run.home, 'work/input.json'));
  assert.deepEqual(evidence.inputs.filter(i => i.kind === 'record').flatMap(i => i.turns), turns);
  assert.equal(evidence.inputs.filter(i => i.kind === 'note').length, 1);
  const spawned = boundary.calls().find(c => c.a[0] === 'spawn');
  for (const flag of ['--parent', '--work-dir', '--branch']) assert.equal(spawned.a.includes(flag), false);
  assert.equal(spawned.identity, null); assert.equal(spawned.a[spawned.a.indexOf('--work') + 1], 'directory');
  const done = f.complete(run); assert.equal(done.processed, true); assert.equal(done.receipts.project.status, 'accepted');
  assert.equal(status(f).processed.length, 4); assert.equal(f.complete(run).processed, true, 'completion replay is idempotent');
  f.retire(run.instance);
  const reader = f.spawn('reader'); assert.match(fs.readFileSync(join(reader.home, 'knowledge/bases/project/expert/decision.md'), 'utf8'), /avoids silent fallback/);
  f.retire(reader.instance);
});

test('record capture drains turn and byte windows, completion alone suppresses reprocessing and later tails remain eligible', t => {
  const f = fixture(t), boundary = recordBoundary(f);
  records(f, [['long', 145], ['fat', 5, 60000]]);
  const first = runResult(boundary.run(['harvest', '--no-launch']));
  const all = f.inputs(), windows = all.filter(i => i.kind === 'record');
  assert.deepEqual(windows.filter(i => i.thread === 'long').map(i => i.turns.length), [60, 60, 25]);
  assert.deepEqual(windows.filter(i => i.thread === 'fat').map(i => i.turns.length), [1, 1, 1, 1, 1]);
  assert.deepEqual(status(f).processed, []);
  const repeat = runResult(boundary.run(['harvest', '--no-launch'])); assert.equal(repeat.run, first.run, 'one active worker per source');
  assert.equal(boundary.calls().filter(c => c.a[0] === 'spawn').length, 1);
  let current = first, runs = 0;
  while (current.status !== 'empty') {
    const input = readJSON(join(current.home, 'work/input.json'));
    assert.ok(Buffer.byteLength(JSON.stringify(input.inputs)) < 200000, 'worker payload is independently bounded');
    const done = f.complete(current, f.judgment(current, { drop: true }));
    assert.equal(done.receipts.project.status, 'no-change'); assert.equal(done.receipts.project.pr, undefined);
    f.retire(current.instance); runs++;
    current = runResult(boundary.run(['harvest', '--no-launch']));
  }
  assert.ok(runs > 1, 'large backlog drains over several independent judgments');
  assert.equal(status(f).processed.length, all.length);
  records(f, [['long', 148], ['fat', 5, 60000]]);
  const tail = runResult(boundary.run(['harvest', '--no-launch']));
  const newInput = readJSON(join(tail.home, 'work/input.json')).inputs;
  assert.equal(newInput.length, 1); assert.equal(newInput[0].after, 'long-145'); assert.equal(newInput[0].until, 'long-148');
});

for (const captureStatus of ['incomplete', 'held', 'skipped', 'failed', 'uncertified']) test(`final ${captureStatus} capture refuses retirement and preserves source notes`, t => {
  const f = fixture(t), boundary = recordBoundary(f); records(f, []);
  write(join(f.home, 'notes/one.md'), 'Preserve this evidence.\n');
  json(join(f.base, 'capture.json'), { status: captureStatus, complete: false, sessions: [] });
  const failed = boundary.run(['retire'], { status: 1 }); assert.equal(failed.out.meta.retired, false);
  assert.equal(fs.existsSync(f.home), true); assert.equal(status(f).retired, false);
  assert.equal(status(f).captured.inputs.length, 1); assert.deepEqual(status(f).processed, []);
});

test('an unread record window preserves earlier input/cursor; explicit retry captures only the remaining tail', t => {
  const f = fixture(t), boundary = recordBoundary(f); records(f, [['thread', 145]]);
  write(join(f.base, 'recall-fail'), 'thread-61');
  boundary.run(['retire'], { status: 1 });
  assert.equal(status(f).captured.threads.thread, 'thread-60'); assert.equal(status(f).captured.inputs.length, 1);
  assert.equal(status(f).retired, false); assert.equal(fs.existsSync(f.home), true);
  fs.rmSync(join(f.base, 'recall-fail')); boundary.run(['retire']);
  assert.equal(status(f).captured.inputs.length, 3); assert.equal(status(f).captured.threads.thread, 'thread-145');
  assert.equal(status(f).retired, true);
});

test('a pruned capture boundary replans from the surviving records without losing already durable evidence', t => {
  const f = fixture(t), boundary = recordBoundary(f); records(f, [['thread', 3]]);
  const first = runResult(boundary.run(['harvest', '--no-launch'])); f.complete(first, f.judgment(first, { drop: true }));
  records(f, [['thread', 5]]);
  json(join(f.base, 'turns.json'), readJSON(join(f.base, 'turns.json')).filter(t => t.id !== 'thread-3'));
  const second = runResult(boundary.run(['harvest', '--no-launch']));
  const input = readJSON(join(second.home, 'work/input.json')).inputs[0];
  assert.equal(input.after, null); assert.equal(input.until, 'thread-5');
  assert.equal(f.inputs()[0].until, 'thread-3', 'old evidence remains independent of redaction');
});

test('runtime/model choices cross the real worker scaffold boundary without launching any provider', t => {
  // Each source freezes execution settings at registration, not at a later harvest.
  for (const [runtime, model] of [['pi', 'openai/gpt-5'], ['claude', 'sonnet'], ['codex', 'gpt-5']]) {
    const f = fixture(t, { settings: { 'harvest-runtime': runtime, 'harvest-model': model } });
    write(join(f.home, 'notes/one.md'), 'Durable observation.\n');
    const run = f.run(), meta = readJSON(join(run.home, 'instance.json'));
    assert.equal(meta.harness, runtime); assert.equal(meta.model, model); assert.equal(meta.launched, false);
    assert.equal(meta.work, 'directory'); assert.equal(meta.parentInstance, f.source.instance);
    assert.equal(fs.lstatSync(join(run.home, 'work')).isSymbolicLink(), false);
  }
});

test('actual native capture/recall transports sixty large Claude turns through pipes into durable inputs', t => {
  const f = fixture(t), boundary = recordBoundary(f, { native: true });
  f.env.TURN_RECORD_ROOT = join(f.base, 'record'); f.env.TURN_RECORD_OWNER = 'fixture';
  const transcript = join(f.user, '.claude/projects/-fixture/session.jsonl');
  write(transcript, Array.from({ length: 60 }, (_, i) => JSON.stringify({ type: 'assistant', cwd: f.home, sessionId: 'fixture-session', timestamp: '2026-09-13T12:00:00Z', message: { role: 'assistant', content: [{ type: 'text', text: `${i}:` + 'x'.repeat(350000) }] } })).join('\n') + '\n');
  assert.equal(boundary.run(['retire']).out.meta.retired, true);
  const inputs = f.inputs().filter(i => i.kind === 'record');
  assert.equal(inputs.length, 60); assert.equal(inputs.flatMap(i => i.turns).length, 60);
  assert.ok(inputs.every(i => i.turns[0].text[0].text.length > 350000));
  fs.rmSync(f.home, { recursive: true }); fs.rmSync(transcript);
  const run = f.run(), evidence = readJSON(join(run.home, 'work/input.json'));
  assert.ok(evidence.inputs[0].turns[0].text[0].text.startsWith('0:'));
  assert.equal(f.complete(run, f.judgment(run, { drop: true })).processed, true);
  assert.equal(status(f).captured.inputs.length, 60);
});

test('live note revisions are independently captured while an earlier worker judges; completion cannot delete or overwrite them', t => {
  const f = fixture(t), boundary = recordBoundary(f); records(f, []);
  const note = join(f.home, 'notes/one.md'); write(note, 'First observed rationale.\n');
  const first = runResult(boundary.run(['harvest', '--no-launch']));
  const frozen = fs.readFileSync(join(first.home, 'work/input.json'), 'utf8');
  write(note, 'Revised rationale while judgment is pending.\n');
  assert.equal(runResult(boundary.run(['harvest', '--no-launch'])).run, first.run);
  assert.equal(f.inputs().length, 2); assert.equal(fs.readFileSync(join(first.home, 'work/input.json'), 'utf8'), frozen);
  assert.equal(f.complete(first, f.judgment(first, { drop: true })).processed, true);
  assert.equal(fs.readFileSync(note, 'utf8'), 'Revised rationale while judgment is pending.\n');
  const second = runResult(boundary.run(['harvest', '--no-launch']));
  assert.notEqual(second.run, first.run);
  assert.equal(readJSON(join(second.home, 'work/input.json')).inputs[0].text, 'Revised rationale while judgment is pending.\n');
  assert.equal(f.inputs().length, 2, 'unchanged capture is idempotent');
});

test('v2 registration rejects implicit/relative bindings and a missing owner declaration without bootstrapping soul knowledge', t => {
  const f = fixture(t, { register: false });
  // The host settings are the deployment's oats-local.yaml; the soul's okf.json lives in its member.
  const config = f.localFile, before = fs.readFileSync(config, 'utf8');
  assert.ok(before.includes(f.bindings)); write(config, before.replace(f.bindings, 'bindings.json'));
  let r = f.raw(['spawn', 'source', '--purpose', 'relative', '--no-launch', '--json']);
  assert.equal(r.status, 1); assert.equal(JSON.parse(r.stdout).error.code, 'E_SPAWN_FAILED');
  assert.match(JSON.parse(r.stdout).error.message, /absolute bindings-file/);
  write(config, before); f.fx.commit({ 'souls/source/okf.json': null }, 'drop the owner declaration');
  r = f.raw(['spawn', 'source', '--purpose', 'ownerless', '--no-launch', '--json']);
  assert.equal(r.status, 1); assert.match(JSON.parse(r.stdout).error.message, /okf.json/);
  assert.equal(fs.existsSync(join(f.soul, 'knowledge')), false);
  for (const name of ['source-relative', 'source-ownerless']) assert.equal(fs.existsSync(join(f.context, 'agents/source/instances', name)), false);
});
