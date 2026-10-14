import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { NativeCaptureDiscovery } from "../lib/capture-discovery.mjs";
import { SESSION_FORMATS } from "../lib/formats.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), "bounded-discovery-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, put(path) { path = join(root, path); fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, "fixture\n"); return path; } };
}
function collect(format, root, { limit = 2, restart = true } = {}) {
  let cursor = null, reader, work = {}, files = [], steps = 0;
  do {
    reader ??= new NativeCaptureDiscovery(format, root, cursor);
    const result = reader.advance({ limit, work });
    assert.ok(result.visited <= limit); assert.ok(result.files.length <= limit);
    files.push(...result.files); cursor = JSON.parse(JSON.stringify(result.checkpoint));
    assert.ok(cursor.stack.length <= 4);
    if (restart) { reader.close(); reader = null; }
    if (++steps > 2000) assert.fail("finite metadata inventory did not finish");
  } while (!cursor.complete);
  reader?.close();
  return { files, work, steps };
}

for (const format of ["cc", "pi", "codex"]) test(`${format} restarted directory walk preserves public order, selection and stable name ties`, t => {
  const f = fixture(t);
  for (const name of ["z", "A", "a", "é", "e\u0301", "file with spaces", "!", "Å"])
    for (const dir of ["", "project", "project/session", "project/session/subagents", "project/session/else", "year/month/day/further"])
      f.put(join(dir, name + ".jsonl"));
  for (let n = 0; n < 150; n++) f.put(`project/${String(n).padStart(3,"0")}.jsonl`);
  f.put("project/session/subagents/ignored.txt");
  const expected = SESSION_FORMATS[format].listFiles([f.root]);
  for (const restart of [false, true]) {
    const actual = collect(format, f.root, { restart, limit: 3 });
    assert.deepEqual(actual.files, expected); assert.ok(actual.steps > 50);
    assert.equal(new Set(actual.files).size, actual.files.length);
  }
});

test("live walk retains only active arrays and releases them on completion, close and failed use", t => {
  const f = fixture(t); f.put("a/1.jsonl"); f.put("b/2.jsonl");
  const reader = new NativeCaptureDiscovery("cc", f.root), work = {};
  const first = reader.advance({ limit: 1, work });
  assert.equal(first.files.length, 0); assert.equal(reader.frames.length, 2);
  assert.equal(reader.frames.filter(f=>f.entries).length, 1);
  reader.advance({ limit: 1, work }); assert.equal(reader.frames.filter(f=>f.entries).length, 2);
  while (!reader.advance({ limit: 1, work }).complete) {}
  assert.equal(reader.frames.length, 0); assert.equal(work.directoriesRead, 3);
  const closing = new NativeCaptureDiscovery("cc", f.root); closing.advance({ limit: 2 });
  const checkpoint = closing.checkpoint(); closing.close();
  assert.deepEqual(closing.checkpoint(), checkpoint); assert.ok(closing.frames.every(f=>!f.entries));
  assert.throws(()=>closing.advance(),/closed/);
  const broken = new NativeCaptureDiscovery("cc", f.root); broken.advance({ limit: 1 });
  fs.rmSync(join(f.root,"a"),{recursive:true});
  assert.throws(()=>broken.advance(),/ENOENT/);assert.throws(()=>broken.advance(),/failed/);broken.close();
});

test("only a fresh default may be absent; malformed cursor and link/special-file selection do not silently succeed", t => {
  const f = fixture(t), absent = new NativeCaptureDiscovery("cc", join(f.root,"absent"));
  assert.equal(absent.advance().complete, true);
  assert.throws(()=>new NativeCaptureDiscovery("cc",f.root,{format:"cc",root:f.root,complete:false,stack:[{name:null,after:"p"},{name:"..",after:null}]}),/stack/);
  f.put("plain.jsonl"); fs.symlinkSync(join(f.root,"plain.jsonl"),join(f.root,"linked.jsonl"));
  fs.mkdirSync(join(f.root,"directory.jsonl")); fs.symlinkSync(join(f.root,"directory.jsonl"),join(f.root,"dirlink.jsonl"));
  assert.deepEqual(collect("cc",f.root).files,SESSION_FORMATS.cc.listFiles([f.root]));
  assert.deepEqual(collect("pi",f.root).files,SESSION_FORMATS.pi.listFiles([f.root]));
  fs.symlinkSync(join(f.root,"missing"),join(f.root,"broken-link"));
  assert.throws(()=>collect("cc",f.root),/ENOENT/);
});

test("a short deadline checkpoints irrelevant entries and resumes without rewalking processed metadata", t => {
  const f = fixture(t); for(let n=0;n<100;n++)f.put(`${String(n).padStart(3,"0")}.txt`); f.put("z.jsonl");
  let checkpoint = null, visited=0, files=[];
  for(let n=0;n<40;n++){
    const reader=new NativeCaptureDiscovery("cc",f.root,checkpoint),work={};let ticks=0;
    const result=reader.advance({stopped:()=>++ticks>3,work});checkpoint=result.checkpoint;
    visited+=result.visited;files.push(...result.files);reader.close();if(result.complete)break;
  }
  assert.equal(checkpoint.complete,true);assert.equal(visited,101);assert.deepEqual(files,[join(f.root,"z.jsonl")]);
});

test("actual fresh processes resume a deep directory stack with the same public inventory", t => {
  const f=fixture(t);for(let n=0;n<9;n++)f.put(`p/s/subagents/${n}.jsonl`);f.put("q/last.jsonl");
  const worker=join(f.root,"worker.mjs"), checkpoint=join(f.root,"cursor.json");
  fs.writeFileSync(worker,`import fs from 'node:fs';import {NativeCaptureDiscovery} from ${JSON.stringify(new URL('../lib/capture-discovery.mjs',import.meta.url).href)};
    const root=process.argv[2],path=process.argv[3];const prior=fs.existsSync(path)?JSON.parse(fs.readFileSync(path,'utf8')):null;
    const reader=new NativeCaptureDiscovery('cc',root,prior);const result=reader.advance({limit:2});
    fs.writeFileSync(path,JSON.stringify(result.checkpoint));reader.close();console.log(JSON.stringify(result));`);
  const files=[];let complete=false;
  for(let n=0;n<30;n++){
    const child=spawnSync(process.execPath,[worker,f.root,checkpoint],{encoding:'utf8',env:{HOME:f.root,TMPDIR:f.root,PATH:process.env.PATH}});
    assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);files.push(...result.files);
    if(result.complete){complete=true;break;}
  }
  assert.equal(complete,true);assert.deepEqual(files,SESSION_FORMATS.cc.listFiles([f.root]));
});


test("a replaced active directory invalidates its saved position rather than skipping the replacement prefix", t => {
  const f=fixture(t);f.put('p/a.jsonl');f.put('p/b.jsonl');
  const reader=new NativeCaptureDiscovery('cc',f.root);reader.advance({limit:2});
  const checkpoint=reader.checkpoint();reader.close();
  fs.renameSync(join(f.root,'p'),join(f.root,'old'));f.put('p/a.jsonl');f.put('p/c.jsonl');
  const resumed=new NativeCaptureDiscovery('cc',f.root,checkpoint);
  assert.throws(()=>resumed.advance(),/identity changed/);assert.ok(resumed.frames.every(f=>!f.entries));
  assert.deepEqual(collect('cc',f.root).files,SESSION_FORMATS.cc.listFiles([f.root]));
});

test("missing resume anchors replay collation ties conservatively while retaining later entries", t => {
  const f=fixture(t);f.put('a.jsonl');f.put('b.jsonl');f.put('z.jsonl');
  const first=new NativeCaptureDiscovery('cc',f.root).advance({limit:2});
  fs.unlinkSync(join(f.root,'b.jsonl'));
  const second=new NativeCaptureDiscovery('cc',f.root,first.checkpoint).advance();
  assert.equal(second.complete,true);assert.deepEqual(second.files,[join(f.root,'z.jsonl')]);
});
