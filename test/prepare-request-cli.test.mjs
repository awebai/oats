import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli=fileURLToPath(new URL('../bin/oats.mjs',import.meta.url));
const id=`sha256-${'a'.repeat(64)}`;
function fixture(t){
  const root=realpathSync(mkdtempSync(join(tmpdir(),'oats-request-cli-'))),deployment=join(root,'deployment');mkdirSync(deployment);
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const environment={PATH:process.env.PATH,HOME:root,OATS_HOME_DIR:join(root,'host-state'),GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',
    OATS_DEPLOYMENT:'poison-relative',OATS_RESOLUTION:'poison-id',OATS_INSTANCE:'poison-instance',PI_AGENT_HOME:'/poison-home'};
  const write=(name,body)=>{const path=join(root,name);writeFileSync(path,body);return path;};
  const source={source:'not-a-valid-source',revision:'main',soul:'agents/expert',alias:'expert'};
  const input={deployment,source,standaloneContextKey:null};
  const run=args=>spawnSync(process.execPath,[cli,...args,'--json'],{cwd:root,env:environment,encoding:'utf8',timeout:5000});
  const refusal=(args,code)=>{
    const result=run(args);assert.equal(result.status,1,result.stderr);const envelope=JSON.parse(result.stdout);
    assert.equal(envelope.ok,false);assert.equal(envelope.error.code,code,JSON.stringify(envelope));assert.equal(result.stderr,'');
    assert.equal(result.stdout.trim(),JSON.stringify(envelope));assert.ok(!result.stdout.includes('REQUEST_SECRET'));
    assert.equal(existsSync(join(deployment,'.agents')),false,'transport/shape refusal precedes preparation writes');return envelope;
  };
  return {root,deployment,write,input,run,refusal};
}

test('prepare request is a closed bounded file transport and never strips unknown public fields',t=>{
  const f=fixture(t),request=f.write('request.json',JSON.stringify(f.input)),missing=join(f.root,'missing.json');
  for(const args of [
    ['prepare','--request',missing,'--dir',f.deployment],
    ['prepare','--request',missing,'--source','git:ssh://example.invalid/source.git'],
    ['prepare','--request',missing,'--request',request],
    ['prepare','--request'],['prepare','--request','request.json'],
    ['prepare','--request',`${f.root}/./request.json`],
  ])f.refusal(args,'E_BAD_ARGS');
  f.refusal(['prepare','--request',missing],'E_BAD_ARGS');
  f.refusal(['prepare','--request',f.root],'E_BAD_ARGS');
  const link=join(f.root,'request-link.json');symlinkSync(request,link);f.refusal(['prepare','--request',link],'E_BAD_ARGS');
  for(const [name,body,code] of [
    ['malformed.json','{"secret":"REQUEST_SECRET",','invalid-declaration'],
    ['duplicate.json','{"deployment":"REQUEST_SECRET","deployment":"other"}','invalid-declaration'],
    ['invalid-utf8.json',Buffer.from([0xff]),'invalid-declaration'],
    ['oversize.json','x'.repeat(8*1024*1024+1),'resource-limit'],
    ['wrapper.json',JSON.stringify({status:'ready',preparation:f.input,secret:'REQUEST_SECRET'}),'invalid-declaration'],
    ['private.json',JSON.stringify({...f.input,directory:f.root,workTarget:{home:'REQUEST_SECRET'}}),'invalid-declaration'],
    ['captured.json',JSON.stringify({...f.input,executionBinding:{schemaVersion:1,deployment:f.deployment,resolution:{schemaVersion:1,id}}}),'invalid-declaration'],
  ]){
    const refused=f.refusal(['prepare','--request',f.write(name,body)],code);
    if(['wrapper.json','private.json','captured.json'].includes(name))assert.match(refused.error.message,/unknown field/,'whole input reaches the existing closed validator');
  }
  assert.deepEqual(JSON.parse(readFileSync(request,'utf8')),f.input);
});

test('explicit captured selectors reject prepare before request reads in either command position',t=>{
  const f=fixture(t),missing=join(f.root,'unread-missing.json');
  for(const selector of [
    ['--deployment',f.deployment,'--resolution',id],
    [`--deployment=${f.deployment}`,`--resolution=${id}`],
    ['--deployment',f.deployment,'--artifact-set',id],
  ])for(const argv of [
    [...selector,'prepare','--request',missing],
    ['prepare','--request',missing,...selector],
  ])f.refusal(argv,'E_BAD_ARGS');
  f.refusal(['--deployment',f.deployment,'prepare','--request',missing],'E_BAD_ARGS');
  f.refusal(['prepare','--request',missing,'--resolution',id],'E_BAD_ARGS');
  f.refusal(['--deployment',f.deployment,'--resolution','invalid','prepare','--request',missing],'invalid-declaration');
  const help=f.run(['prepare','--help']);assert.equal(help.status,0);assert.ok(JSON.parse(help.stdout).result.usage.some(line=>line.includes('--request')),'poisoned inherited capture cannot intercept prepare help');
});
