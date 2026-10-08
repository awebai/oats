// 5.0 has no kernel/provider publication worker or completion/retry journal.
// Execute the materialized skill's actual Git/gh command block against local
// repositories (gh is a narrow argv-checking fake). This proves Git isolation
// and the command template, NOT model judgment, real GitHub or owner review.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fixture, write, json, readJSON } from './helpers/okf-v2.mjs';

function github(f) {
  const prs = join(f.base, 'prs.json'), calls = join(f.base, 'gh.jsonl');
  json(prs, []);
  write(join(f.bin, 'gh'), `#!${process.execPath}
import * as fs from 'node:fs';import {execFileSync} from 'node:child_process';
const a=process.argv.slice(2),v=k=>a[a.indexOf(k)+1],p=${JSON.stringify(prs)};
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(a)+'\\n');
if(v('--repo')!=='fixture/knowledge') process.exit(92);
if(a[0]==='label' && a[1]==='create' && a[2]==='okf-harvest' && a.includes('--force')) process.exit(0);
if(a[0]!=='pr' || a[1]!=='create' || v('--base')!=='main' || !a.includes('--head') || v('--title')!=='OKF knowledge proposal' || !fs.statSync(v('--body-file')).isFile()) process.exit(91);
const head=v('--head'),oid=execFileSync('git',['ls-remote',${JSON.stringify(f.accepted)},'refs/heads/'+head],{encoding:'utf8'}).trim().split(/\\s/)[0];
if(!/^[0-9a-f]{40}$/.test(oid)) process.exit(93);
const old=JSON.parse(fs.readFileSync(p)),number=old.length+1,url='https://github.com/fixture/knowledge/pull/'+number;
old.push({number,url,state:'OPEN',headRefName:head,headRefOid:oid,baseRefName:v('--base')});fs.writeFileSync(p,JSON.stringify(old));console.log(url);
`);
  fs.chmodSync(join(f.bin, 'gh'), 0o755);
  return { prs, calls };
}
function stage(f) {
  write(join(f.home, 'notes/lesson.md'), 'A bounded review decision.\n');
  const run = f.propose(), clone = join(run.home, 'work/project');
  f.git('clone', '-q', f.accepted, clone);
  const base = join(clone, 'knowledge');
  write(join(base, 'expert/decision.md'), '---\ntype: Decision\ntitle: File based claims\ndescription: Why claim text is written as data.\n---\n\nClaims are data, never shell commands.\n');
  fs.appendFileSync(join(base, 'expert/index.md'), '* [File based claims](decision.md) - Why claim text is data.\n');
  return { run, clone, base };
}
function publishTemplate(f, staged) {
  const skill = fs.readFileSync(join(staged.run.home, '.agents/skills/knowledge-harvest/SKILL.md'), 'utf8');
  const block = /^```sh\n(branch=[\s\S]*?)\n```$/m.exec(skill)?.[1]; assert.ok(block);
  const message = join(staged.run.home, 'commit.txt'), body = join(staged.run.home, 'pr.md');
  // Native file writes, not shell interpolation of claims.
  write(message, 'okf-harvest: file based claims\n'); write(body, 'Fixture proposal; review is required.\n');
  const command = block.replace('<source instance>', f.source.instance).replace('<YYYYMMDD-HHMM>', '20261008-0000')
    .replaceAll('<alias>', 'project').replace('<owned paths>', "'knowledge/expert'")
    .replace('<absolute commit message file>', message).replace('<absolute PR body file>', body)
    .replaceAll('<owner>/<repo>', 'fixture/knowledge').replaceAll('<acceptedBranch>', 'main');
  assert.doesNotMatch(command, /<[^<>]+>/);
  const env = { ...f.env, PATH: `${f.bin}:${process.env.PATH}` };
  const validator = spawnSync(process.execPath, [join(staged.run.home, '.agents/skills/okf-authoring/scripts/okf-validate.mjs'), staged.base, '--strict'], { cwd: staged.run.home, env, encoding: 'utf8' });
  assert.equal(validator.status, 0, validator.stdout + validator.stderr);
  const published = spawnSync('bash', ['-e', '-c', command], { cwd: staged.run.home, env, encoding: 'utf8' });
  assert.equal(published.status, 0, published.stdout + published.stderr);
  return `okf-harvest/${f.source.instance}-20261008-0000`;
}

test('materialized 5.0 publishing commands create a Git proposal without changing accepted HEAD or reclaiming old branches', t => {
  const f = fixture(t, { git: true }), gh = github(f), git = (...a) => f.git('-C', f.accepted, ...a);
  const head = git('rev-parse', 'HEAD'); git('branch', 'memory-harvest/source-probe');
  const staged = stage(f), branch = publishTemplate(f, staged), commit = git('rev-parse', branch);
  assert.equal(git('rev-parse', 'HEAD'), head, 'a proposed branch is not acceptance');
  assert.equal(git('rev-parse', 'memory-harvest/source-probe'), head, 'old branch never reclaimed');
  assert.equal(git('show', `${commit}:code.txt`), 'untouched code');
  assert.ok(git('diff', '--name-only', head, commit).split('\n').every(p => p.startsWith('knowledge/expert/')));
  assert.equal(fs.existsSync(join(f.accepted, 'knowledge/expert/decision.md')), false);
  assert.equal(f.consult(f.home, 'expert/decision.md'), null, 'proposal is not accepted knowledge');
  assert.equal(readJSON(gh.prs).length, 1); assert.equal(readJSON(gh.prs)[0].headRefOid, commit);
  const beforeCalls = fs.readFileSync(gh.calls, 'utf8');
  const removed = f.raw(['okf', 'complete', '--soul', 'source', '--json']);
  assert.equal(removed.status, 1); assert.equal(JSON.parse(removed.stdout).error.code, 'E_REMOVED');
  assert.equal(fs.readFileSync(gh.calls, 'utf8'), beforeCalls, 'removed completion cannot replay a PR');
  assert.equal(git('rev-parse', branch), commit);
  // Explicit fixture-operator acceptance, NOT a kernel/harvester completion.
  git('merge', '--ff-only', branch);
  const fresh = f.spawn('after-merge');
  assert.match(f.consult(fresh.home, 'expert/decision.md', { fresh: true }), /Claims are data/);
  f.retire(fresh.instance); f.retire(staged.run.instance); f.retire(f.source.instance);
});

test('the publishing command stages only owned paths, never a peer edit; semantic ownership review is not a kernel publisher', t => {
  const f = fixture(t, { git: true }); github(f);
  const staged = stage(f), peer = join(staged.base, 'peer/log.md'), before = fs.readFileSync(peer, 'utf8');
  fs.appendFileSync(peer, 'Unowned fixture edit.\n');
  const branch = publishTemplate(f, staged);
  assert.equal(f.git('-C', f.accepted, 'show', `${branch}:knowledge/peer/log.md`), before.trimEnd(), 'peer bytes not committed');
  assert.match(f.git('-C', staged.clone, 'status', '--porcelain'), /knowledge\/peer\/log.md/, 'unowned edit remains outside the commit');
  assert.equal(fs.existsSync(join(staged.run.home, 'work/input.json')), false);
  f.retire(staged.run.instance); f.retire(f.source.instance);
});

test('directory-base changes cannot enter a removed completion/retry engine or silently publish over accepted drift', t => {
  const f = fixture(t), staged = f.propose(), peer = join(f.accepted, 'peer/log.md');
  fs.appendFileSync(peer, 'Cooperative accepted update.\n');
  const before = fs.readFileSync(peer, 'utf8');
  for (const command of ['complete', 'retry', 'run-source']) {
    const r = f.raw(['okf', command, '--soul', 'source', '--json']);
    assert.equal(r.status, 1); assert.equal(JSON.parse(r.stdout).error.code, 'E_REMOVED');
  }
  assert.equal(fs.readFileSync(peer, 'utf8'), before);
  assert.equal(fs.existsSync(join(staged.home, 'work/staging.json')), false);
  assert.equal(fs.existsSync(join(f.accepted, 'expert/decision.md')), false);
  const skill = fs.readFileSync(join(staged.home, '.agents/skills/knowledge-harvest/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(skill, /directory base <alias> is unsupported for harvest in oats\.okf 5\.0/);
  f.retire(staged.instance); f.retire(f.source.instance);
});
