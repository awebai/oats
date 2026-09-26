// v1 reclaimed a fixed memory-harvest branch in the source checkout. v2 must
// never use that checkout: independent worker staging publishes immutable,
// run-unique Git proposals. All Git objects below stay in disposable repos;
// only GitHub's PR API is deterministic fake data.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { fixture, write, json, readJSON } from './helpers/okf-v2.mjs';

function github(f) {
  const prs = join(f.base, 'prs.json'), calls = join(f.base, 'gh.jsonl');
  json(prs, []);
  write(join(f.bin, 'gh'), `#!${process.execPath}
import * as fs from 'node:fs';import {execFileSync} from 'node:child_process';
const a=process.argv.slice(2),v=k=>a[a.indexOf(k)+1],p=${JSON.stringify(prs)};
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(a)+'\\n');
if(a[0]==='label') process.exit(0); // okf 4.0.0 ensures the harvest-review label before the PR
if(a[0]!=='pr') process.exit(91);
if(a[1]==='list') console.log(fs.readFileSync(p,'utf8'));
else if(a[1]==='view') {
 if(v('--repo')!=='fixture/knowledge') process.exit(92);
 const row=JSON.parse(fs.readFileSync(p)).find(row=>String(row.number)===a[2] || row.url===a[2]);
 if(!row) process.exit(1);
 console.log(JSON.stringify(row));
}
else if(a[1]==='create') {
 const head=v('--head'),oid=execFileSync('git',['ls-remote','origin','refs/heads/'+head],{encoding:'utf8'}).trim().split(/\\s/)[0];
 const old=JSON.parse(fs.readFileSync(p)),number=old.length+1,url='https://github.com/fixture/knowledge/pull/'+number;
 old.push({number,url,state:'OPEN',headRefName:head,headRefOid:oid,baseRefName:v('--base'),mergedAt:null,mergeCommit:null});fs.writeFileSync(p,JSON.stringify(old));console.log(url);
} else process.exit(91);
`);
  fs.chmodSync(join(f.bin, 'gh'), 0o755);
  return { prs, calls };
}

test('real directory worker delivers a Git PR without modifying accepted head or deleting any old harvest branch', t => {
  const f = fixture(t, { git: true }), gh = github(f);
  const git = (...a) => f.git('-C', f.accepted, ...a);
  const head = git('rev-parse', 'HEAD');
  git('branch', 'memory-harvest/source-probe');
  write(join(f.home, 'notes/decision.md'), 'Human chose explicit custody.\n');
  const run = f.run(); assert.equal(run.status, 'ready');
  assert.equal(fs.lstatSync(join(run.home, 'work')).isSymbolicLink(), false);
  const stage = readJSON(join(run.home, 'work/staging.json')).project.root;
  assert.ok(stage.startsWith(join(run.home, 'work') + '/'));
  assert.notEqual(stage, join(f.accepted, 'knowledge'));
  const result = f.complete(run), receipt = result.receipts.project;
  assert.equal(result.processed, true); assert.equal(receipt.status, 'delivered');
  assert.match(receipt.branch, /^okf\//); assert.match(receipt.pr.url, /fixture\/knowledge\/pull\/1/);
  assert.equal(git('rev-parse', 'HEAD'), head, 'opening a PR is not acceptance');
  assert.equal(git('rev-parse', 'memory-harvest/source-probe'), head, 'v1 branch is never reclaimed');
  assert.equal(git('show', `${receipt.commit}:code.txt`), 'untouched code');
  assert.ok(git('diff', '--name-only', head, receipt.commit).split('\n').every(p => p.startsWith('knowledge/expert/')));
  assert.equal(fs.existsSync(join(f.accepted, 'knowledge/expert/decision.md')), false);
  const reader = f.spawn('before-merge');
  assert.equal(f.consult(reader.home, 'expert/decision.md'), null, 'not accepted before the merge');
  f.retire(reader.instance);
  // Replay reconciles the existing PR; it cannot push a second branch/PR.
  assert.equal(f.complete(run).receipts.project.commit, receipt.commit);
  assert.equal(readJSON(gh.prs).length, 1);
  assert.ok(fs.readFileSync(gh.calls,'utf8').trim().split('\n').map(JSON.parse).some(a=>a[1]==='view' && a[2]==='1' && a.includes('--repo')), 'replay queries the persisted PR identity, not only a mutable branch list');
  git('merge', '--ff-only', receipt.branch);
  const prs = readJSON(gh.prs); Object.assign(prs[0], { state: 'MERGED', mergedAt: '2026-09-13T12:00:00Z', mergeCommit: { oid: receipt.commit } }); json(gh.prs, prs);
  assert.equal(f.complete(run).receipts.project.status, 'accepted');
  const fresh = f.spawn('after-merge');
  // okf 3.0.0 serves the host's clone of the base within consult-max-age: the merge is read with --fresh.
  assert.match(f.consult(fresh.home, 'expert/decision.md', { fresh: true }), /avoids silent fallback/);
  f.retire(fresh.instance); f.retire(run.instance); f.retire(f.source.instance);
});

test('Git custody rejects peer edits and retains worker/input until an explicit corrected judgment', t => {
  const f = fixture(t, { git: true }), gh = github(f);
  write(join(f.home, 'notes/one.md'), 'Pending rationale.\n'); const run = f.run(), judgment = f.judgment(run);
  const stage = readJSON(join(run.home, 'work/staging.json')).project.root;
  const peer = join(stage, 'peer/log.md'), before = fs.readFileSync(peer);
  fs.appendFileSync(peer, 'Unauthorized peer edit.\n');
  const failed = f.raw(['okf', 'complete', '--source', f.sourceFile, '--run', run.run, '--judgment', judgment, '--soul', 'source', '--json']);
  assert.equal(failed.status, 1); assert.equal(JSON.parse(failed.stdout).error.code, 'E_OWNER');
  assert.deepEqual(f.inspect().status.processed, []); assert.equal(readJSON(gh.prs).length, 0);
  assert.equal(fs.existsSync(join(run.home, 'work/input.json')), true);
  fs.writeFileSync(peer, before);
  assert.equal(f.complete(run, judgment).processed, true);
});

test('directory custody rejects accepted-base drift, preserves evidence and rejudges in a new independent worker', t => {
  const f = fixture(t);
  write(join(f.home, 'notes/one.md'), 'Pending rationale.\n'); const run = f.run(), judgment = f.judgment(run);
  fs.appendFileSync(join(f.accepted, 'peer/log.md'), 'Cooperative accepted update.\n');
  const failed = f.raw(['okf', 'complete', '--source', f.sourceFile, '--run', run.run, '--judgment', judgment, '--soul', 'source', '--json']);
  assert.equal(failed.status, 1); assert.equal(JSON.parse(failed.stdout).error.code, 'E_BASELINE');
  assert.deepEqual(f.inspect().status.processed, []);
  const retried = f.cli(['okf', 'retry', '--source', f.sourceFile, '--rejudge', '--soul', 'source', '--json']);
  assert.equal(retried.status, 'abandoned'); assert.equal(fs.existsSync(run.home), true, 'failure evidence is retained');
  const next = f.run(); assert.notEqual(next.run, run.run); assert.notEqual(next.home, run.home);
  assert.deepEqual(readJSON(join(next.home, 'work/input.json')).inputs, readJSON(join(run.home, 'work/input.json')).inputs);
  assert.equal(f.complete(next).receipts.project.status, 'accepted');
  assert.match(fs.readFileSync(join(f.accepted, 'peer/log.md'), 'utf8'), /Cooperative accepted update/);
});
