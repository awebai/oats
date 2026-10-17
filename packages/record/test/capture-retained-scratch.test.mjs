import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { superviseCapture } from "../lib/capture-supervisor.mjs";
import { acquireCaptureLock } from "../lib/capture-lock.mjs";
import { cleanupCaptureScratch } from "../lib/capture-scratch.mjs";
import { DerivedState } from "../lib/derived-state.mjs";
const stream = "fixture~session", key = "fixture-job";
const url = name => new URL(`../lib/${name}.mjs`, import.meta.url).href;

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), "retained-scratch-")), workerPath = join(root, "worker.mjs");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(workerPath, `
    import fs from 'node:fs';import {join} from 'node:path';
    import {runCaptureWorker} from ${JSON.stringify(url("capture-worker"))};
    import {RecordStore} from ${JSON.stringify(url("store"))};
    import {DerivedState} from ${JSON.stringify(url("derived-state"))};
    import {withCaptureGroup} from ${JSON.stringify(url("capture-context"))};
    import {createRetainedCaptureScratch,openRetainedCaptureScratch,removeRetainedCaptureScratch} from ${JSON.stringify(url("capture-retained-scratch"))};
    await runCaptureWorker(start=>{
      const {root,options}=start,store=new RecordStore(root,{owner:'fixture'}),state=new DerivedState(root);
      const key=${JSON.stringify(key)},stream=${JSON.stringify(stream)};
      try {
        const lease=options.invalidWorker?{...start,workerNonce:'invalid'}:start;
        if(options.mode==='remove-again'){
          removeRetainedCaptureScratch(root,state,key,lease);state.transaction(()=>state.delete('recovery-allocation',key));
          return {outcome:'complete',reason:null};
        }
        withCaptureGroup(store,[stream],()=>{
          const allocation=options.mode==='create'?createRetainedCaptureScratch(store,stream,key,lease):
            openRetainedCaptureScratch(store,stream,key,lease,{cleanup:options.mode==='cleanup',
              ...(options.liveness?{liveness:()=>options.liveness}:{})});
          try {
            allocation.verify();
            if(options.mode==='create'){
              fs.writeSync(allocation.fd,Buffer.from('committed'),0,9,0);fs.fsyncSync(allocation.fd);
              state.set('fixture-stage',key,{bytes:9});
            }
            if(options.mode==='adopt-crash'){
              fs.writeSync(allocation.fd,Buffer.from('TAIL'),0,4,9);fs.fsyncSync(allocation.fd);
              state.set('fixture-stage',key,{bytes:13});process.kill(process.pid,'SIGKILL');
            }
            if(options.mode==='adopt'){
              const bytes=state.get('fixture-stage',key).bytes,buf=Buffer.alloc(bytes);
              fs.readSync(allocation.fd,buf,0,bytes,0);
              fs.writeFileSync(join(root,'observed'),JSON.stringify({text:buf.toString(),bytes,size:fs.fstatSync(allocation.fd).size}));
            }
            fs.writeFileSync(join(root,'allocation'),allocation.path);
          } finally {allocation.close();}
        },{state});
        if(options.mode==='cleanup'){
          removeRetainedCaptureScratch(root,state,key,lease);
          if(options.leaveDeletionReference)return {outcome:'partial',reason:'deadline'};
          state.transaction(()=>state.delete('recovery-allocation',key));
        }
        return {outcome:'complete',reason:null};
      } catch(error){fs.writeFileSync(join(root,'error'),error.message);throw error;}
      finally{state.close();}
    });
  `);
  return { root,
    run: options => superviseCapture(root, options, { workerPath }),
    allocation: () => fs.readFileSync(join(root, "allocation"), "utf8"),
    state(fn) { const state = new DerivedState(root); try { return fn(state); } finally { state.close(); } },
    scavenge() { const lock = acquireCaptureLock(root); try { return cleanupCaptureScratch(root, lock); } finally { assert.equal(lock.release().released, true); } },
  };
}
async function success(f, options) { const result = await f.run(options); assert.equal(result.outcome, "complete", fs.existsSync(join(f.root, "error")) ? fs.readFileSync(join(f.root, "error"), "utf8") : JSON.stringify(result)); }

test("retained jobs survive ordinary scavenging and actual worker replacement; committed cleanup is repeatable", async t => {
  const f = fixture(t); await success(f, { mode: "create" });
  const path = f.allocation(), original = f.state(s => s.get("recovery-allocation", key));
  assert.equal(fs.statSync(path).mode & 0o777, 0o700); assert.equal(fs.statSync(join(path, "payload")).mode & 0o777, 0o600);
  assert.equal(f.scavenge(), 0); assert.equal(fs.existsSync(path), true);
  await success(f, { mode: "adopt" });
  const adopted = f.state(s => s.get("recovery-allocation", key));
  assert.equal(adopted.id, original.id); assert.deepEqual(adopted.payload, original.payload); assert.notDeepEqual(adopted.owner, original.owner);
  assert.deepEqual(JSON.parse(fs.readFileSync(join(f.root, "observed"))), { text: "committed", bytes: 9, size: 9 });
  const result = await f.run({ mode: "cleanup", leaveDeletionReference: true });
  assert.equal(result.outcome, "partial"); assert.equal(fs.existsSync(path), false);
  assert.equal(f.state(s => s.get("recovery-allocation", key)).phase, "deleting");
  await success(f, { mode: "remove-again" }); assert.equal(f.state(s => s.get("recovery-allocation", key)), null);
});

test("restart after adoption publication before checkpoint retains old progress and excludes uncommitted payload suffix", async t => {
  const f = fixture(t); await success(f, { mode: "create" });
  const before = f.state(s => s.get("recovery-allocation", key));
  const failed = await f.run({ mode: "adopt-crash" }); assert.equal(failed.outcome, "failed"); assert.equal(failed.reason, "interrupted");
  assert.deepEqual(f.state(s => s.get("recovery-allocation", key)), before);
  assert.equal(f.state(s => s.get("fixture-stage", key)).bytes, 9);
  assert.equal(fs.statSync(join(f.allocation(), "payload")).size, 13);
  assert.equal(f.scavenge(), 0);
  await success(f, { mode: "adopt" });
  assert.deepEqual(JSON.parse(fs.readFileSync(join(f.root, "observed"))), { text: "committed", bytes: 9, size: 13 });
});

test("copied/replaced owner and payload identities never authorize adoption or cleanup", async t => {
  const f = fixture(t); await success(f, { mode: "create" }); const path = f.allocation();
  for (const name of ["owner.json", "payload"]) {
    const target = join(path, name), preserved = join(path, `${name}.original`);
    fs.renameSync(target, preserved); fs.copyFileSync(preserved, target); fs.chmodSync(target, 0o600);
    const before = fs.readFileSync(target);
    assert.equal((await f.run({ mode: "adopt" })).outcome, "failed");
    assert.equal((await f.run({ mode: "cleanup" })).outcome, "failed");
    assert.deepEqual(fs.readFileSync(target), before); assert.equal(fs.existsSync(preserved), true);
    fs.unlinkSync(target); fs.renameSync(preserved, target);
  }
  await success(f, { mode: "adopt" });
});

test("uncertain/live owner and wrong registered worker preserve allocation and reference", async t => {
  const f = fixture(t); await success(f, { mode: "create" }); const path = f.allocation();
  const before = f.state(s => s.get("recovery-allocation", key)), marker = fs.readFileSync(join(path, "owner.json"));
  for (const options of [{ liveness: "alive" }, { liveness: "unknown" }, { invalidWorker: true }]) {
    assert.equal((await f.run({ mode: "adopt", ...options })).outcome, "failed");
    assert.deepEqual(f.state(s => s.get("recovery-allocation", key)), before);
    assert.deepEqual(fs.readFileSync(join(path, "owner.json")), marker);
  }
});

test("lost derived reference cannot adopt surviving scratch by path or scavenge an unpublished allocation", async t => {
  const f = fixture(t); await success(f, { mode: "create" }); const path = f.allocation();
  f.state(s => s.delete("recovery-allocation", key));
  assert.equal((await f.run({ mode: "adopt" })).outcome, "failed"); assert.equal(fs.existsSync(path), true);
  const unpublished = fs.mkdtempSync(join(f.root, ".capture-tmp/recovery-")); fs.writeFileSync(join(unpublished, "payload"), "unpublished");
  assert.equal(f.scavenge(), 0); assert.equal(fs.existsSync(unpublished), true);
  await success(f, { mode: "create" }); assert.notEqual(f.allocation(), path); assert.equal(fs.existsSync(path), true);
});

test("symlink/special markers and stale allocation references remain untouched", async t => {
  const f = fixture(t); await success(f, { mode: "create" }); const path = f.allocation();
  const target = join(path, "owner.json"), original = join(path, "owner.original");
  fs.renameSync(target, original); fs.symlinkSync(original, target);
  assert.equal((await f.run({ mode: "adopt" })).outcome, "failed"); assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
  fs.unlinkSync(target);
  const fifo = spawnSync("/usr/bin/mkfifo", [target], { encoding: "utf8", env: { HOME: f.root, PATH: process.env.PATH }, timeout: 5000 });
  assert.equal(fifo.status, 0, fifo.stderr);
  assert.equal((await f.run({ mode: "cleanup" })).outcome, "failed"); assert.equal(fs.lstatSync(target).isFIFO(), true);
  fs.unlinkSync(target); fs.renameSync(original, target);
  const before = f.state(s => s.get("recovery-allocation", key));
  f.state(s => s.set("recovery-allocation", key, { ...before, id: "0".repeat(32) }));
  assert.equal((await f.run({ mode: "adopt" })).outcome, "failed"); assert.equal(fs.existsSync(join(path, "payload")), true);
});
