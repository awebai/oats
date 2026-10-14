import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { superviseCapturePass } from "../lib/capture-pass.mjs";
import { acquireCaptureLock, captureLockPath, holderLiveness, readCaptureLockOwner } from "../lib/capture-lock.mjs";
import { CAPTURE_POLICY } from "../lib/capture-budget.mjs";
const workerUrl = new URL("../lib/capture-worker.mjs", import.meta.url).href;
const lockUrl = new URL("../lib/capture-lock.mjs", import.meta.url).href;
function fixture(t, body) {
  const root = fs.mkdtempSync(join(tmpdir(), "capture-pass-")), workerPath = join(root, "worker.mjs");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(workerPath, `import fs from 'node:fs';import {join} from 'node:path';
    import {runCaptureWorker} from ${JSON.stringify(workerUrl)};
    import {readCaptureLockOwner} from ${JSON.stringify(lockUrl)};
    ${body}`);
  return { root, workerPath };
}
const allowances = { workMs: 1000, finalizeMs: 1500, hardMs: 2000, finalReserveMs: 1000, finalDrainMs: 750, maxStarts: 8 };
const seams = { policy: { ...CAPTURE_POLICY, deadlineSeconds: 30 }, allowances, drainSeconds: 0.1 };

// These exercise the process/lock boundary. The fixture callback stands in for
// the future scheduler; it does not prove native recovery or status integration.
test("eight-start ceiling includes finalization, all children share the original deadline and retained root lock", async t => {
  const f = fixture(t, `await runCaptureWorker(({root,pass,drainAt,finalizeAt,hardAt})=>{
    fs.appendFileSync(join(root,'attempts'),JSON.stringify({pass,drainAt,finalizeAt,hardAt,pid:process.pid,owner:readCaptureLockOwner(root)})+'\\n');
    return {outcome:'partial',reason:'deadline',continuation:!pass.finalize};
  });`);
  const result = await superviseCapturePass(f.root, {}, { ...seams, workerPath: f.workerPath });
  assert.equal(result.outcome, "partial"); assert.equal(result.exitCode, 0); assert.equal(result.starts, 8);
  const rows = fs.readFileSync(join(f.root, "attempts"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(rows.length, 8); assert.deepEqual(rows.map(row => row.pass.attempt), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(rows.map(row => row.pass.finalize), [false, false, false, false, false, false, false, true]);
  assert.equal(new Set(rows.map(row => row.pass.deadline)).size, 1);
  assert.equal(new Set(rows.map(row => row.pass.started)).size, 1);
  assert.equal(new Set(rows.map(row => row.pass.runId)).size, 1);
  assert.equal(new Set(rows.map(row => row.owner.nonce)).size, 1);
  for (const row of rows) {
    assert.equal(row.owner.worker.pid, row.pid); assert.equal(holderLiveness(row.pid), "dead");
    assert.ok(row.drainAt <= row.finalizeAt && row.finalizeAt <= row.hardAt && row.hardAt <= row.pass.deadline);
  }
  for (const row of rows.slice(0, 7)) assert.equal(row.hardAt - row.drainAt, 1000);
  assert.equal(fs.existsSync(captureLockPath(f.root)), false);
  assert.equal(fs.existsSync(join(f.root, "capture-status.json")), false, "parent must not invent run facts");
});

test("an unresponsive first child is reaped and independent work progresses in the same pass", async t => {
  const f = fixture(t, `await runCaptureWorker(({root,pass,budget})=>{
    fs.appendFileSync(join(root,'pids'),String(process.pid)+'\\n');
    if(pass.attempt===1)while(true){}
    budget.check();
    if(pass.attempt===2){
      fs.writeFileSync(join(root,'independent-progress'),JSON.stringify(pass.previous));
      return {outcome:'partial',reason:'deadline',continuation:true};
    }
    fs.writeFileSync(join(root,'earlier-failure'),String(pass.failure));
    return {outcome:'complete',reason:null};
  });`);
  const small = { ...allowances, workMs: 200, finalizeMs: 300, hardMs: 400 };
  const result = await superviseCapturePass(f.root, {}, { ...seams, allowances: small, workerPath: f.workerPath });
  assert.deepEqual(result, { outcome: "failed", reason: "deadline", exitCode: 1, starts: 3 });
  assert.deepEqual(JSON.parse(fs.readFileSync(join(f.root, "independent-progress"))), { outcome: "failed", reason: "deadline" });
  assert.equal(fs.readFileSync(join(f.root, "earlier-failure"), "utf8"), "deadline", "a healthy intermediate child cannot erase earlier failure evidence");
  for (const pid of fs.readFileSync(join(f.root, "pids"), "utf8").trim().split("\n").map(Number)) assert.equal(holderLiveness(pid), "dead");
  assert.equal(fs.existsSync(captureLockPath(f.root)), false);
});

test("insufficient remaining time admits only finalization, never a shortened normal/reset allowance", async t => {
  const f = fixture(t, `await runCaptureWorker(({root,pass})=>{
    fs.writeFileSync(join(root,'observed'),JSON.stringify(pass));return {outcome:'partial',reason:'deadline'};
  });`);
  const result = await superviseCapturePass(f.root, {}, { ...seams, policy: { ...CAPTURE_POLICY, deadlineSeconds: 1 }, workerPath: f.workerPath });
  assert.equal(result.starts, 1); assert.equal(result.outcome, "partial");
  assert.equal(JSON.parse(fs.readFileSync(join(f.root, "observed"))).finalize, true);
});

test("continued startup and failed finalization cannot renew the absolute deadline or fabricate success", async t => {
  const f = fixture(t, `await new Promise(resolve=>setTimeout(resolve,150));
    await runCaptureWorker(({root,pass})=>{
      fs.appendFileSync(join(root,'attempts'),JSON.stringify(pass)+'\\n');while(true){}
    });`);
  const started = performance.now();
  const result = await superviseCapturePass(f.root, {}, { workerPath: f.workerPath, policy: { ...CAPTURE_POLICY, deadlineSeconds: 1.5 }, drainSeconds: 0.1,
    allowances: { workMs: 200, finalizeMs: 300, hardMs: 400, finalReserveMs: 300, finalDrainMs: 200, maxStarts: 8 } });
  assert.equal(result.outcome, "failed"); assert.ok(result.starts <= 4);
  assert.ok(performance.now() - started < 2500, "supporting elapsed bound; child windows also assert the shared absolute deadline");
  const rows = fs.readFileSync(join(f.root, "attempts"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(new Set(rows.map(row => row.deadline)).size, 1);
  assert.equal(fs.existsSync(join(f.root, "capture-status.json")), false);
  assert.equal(fs.existsSync(captureLockPath(f.root)), false);
});

test("overlap starts no worker and never releases another owner; spawn failures consume the start budget", async t => {
  const f = fixture(t, ""), lock = acquireCaptureLock(f.root); let starts = 0;
  try {
    const result = await superviseCapturePass(f.root, {}, { workerPath: f.workerPath, spawnChild: () => { starts++; throw Error("unexpected"); } });
    assert.equal(result.outcome, "overlap"); assert.equal(result.starts, 0); assert.equal(starts, 0);
    assert.equal(readCaptureLockOwner(f.root).nonce, lock.nonce);
  } finally { assert.equal(lock.release().released, true); }
  const result = await superviseCapturePass(f.root, {}, { ...seams, workerPath: f.workerPath, spawnChild: () => { starts++; throw Error("spawn failed"); } });
  assert.equal(result.outcome, "failed"); assert.equal(result.starts, 8); assert.equal(starts, 8);
  assert.equal(fs.existsSync(captureLockPath(f.root)), false);
});

test("external interruption stops continuation and reaps the current owned worker", async t => {
  const f = fixture(t, `await runCaptureWorker(({root})=>{
    fs.writeFileSync(join(root,'pid'),String(process.pid));
    process.kill(process.ppid,'SIGTERM');while(true){}
  });`);
  const result = await superviseCapturePass(f.root, {}, { ...seams, workerPath: f.workerPath });
  assert.deepEqual(result, { outcome: "failed", reason: "interrupted", exitCode: 1, starts: 1 });
  assert.equal(holderLiveness(Number(fs.readFileSync(join(f.root, "pid")))), "dead");
  assert.equal(fs.existsSync(captureLockPath(f.root)), false);
});
