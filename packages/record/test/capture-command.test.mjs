// Private production-entry fixtures; no claim about CLI/manager integration.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureDefaultRootPlan } from "../lib/capture-default-roots.mjs";
import { captureCommandOptions, runCaptureCommand } from "../lib/capture-command.mjs";
import { CaptureIssuePreparation } from "../lib/capture-issue-preparation.mjs";
import { CaptureSourceQueue } from "../lib/capture-source-queue.mjs";
import { DerivedState } from "../lib/derived-state.mjs";
import { RecordStore } from "../lib/store.mjs";
import { readCaptureStatus } from "../lib/capture-status.mjs";
import { superviseCapturePass } from "../lib/capture-pass.mjs";
import { acquireCaptureLock } from "../lib/capture-lock.mjs";
import { captureSessions } from "../lib/capture-cc.mjs";
import { captureCommandPass } from "../lib/capture-command-output.mjs";

const url = name => new URL(`../lib/${name}.mjs`, import.meta.url).href;
const formats = ["cc", "pi", "codex", "aw"];
function fixture(t) {
  const base = fs.mkdtempSync(join(tmpdir(), "capture-command-")), home = join(base, "home"), root = join(base, "record");
  fs.mkdirSync(home);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const options = (extra = {}) => ({ owner: "fixture", plan: captureDefaultRootPlan({ home, cwd: base, env: {} }),
    trigger: "manual", indexEnabled: false, retrySetAside: false, ...extra });
  return { base, home, root, options,
    state(fn) { const state = new DerivedState(root); try { return fn(state); } finally { state.close(); } },
    async run(extra = {}, recordRoot = root) {
      const env = { HOME: home, TMPDIR: base, XDG_CACHE_HOME: base }, old = {};
      for (const [key, value] of Object.entries(env)) { old[key] = process.env[key]; process.env[key] = value; }
      try { return await runCaptureCommand(recordRoot, options(extra)); }
      finally { for (const key of Object.keys(env)) if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; }
    },
    // The foreground command over the same entry, with its stdout and stderr lines.
    async pass(extra = {}) {
      const out = [], err = [];
      const result = await captureCommandPass(root, options(extra), { log: line => out.push(line), error: line => err.push(line),
        run: recordRoot => this.run(extra, recordRoot) });
      return { result, out, err };
    },
  };
}
const native = JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", text: "native" }) + "\n";
const aw = JSON.stringify({ ts: "2026-01-01T00:00:00Z", ch: "mail", dir: "recv", from: "peer", body: "healthy" }) + "\n";
function seedIssues(f, n = 260) {
  return f.state(state => {
    const queue = new CaptureSourceQueue(state, { owner: "fixture", selection: "fixture" });
    const entries = Array.from({ length: n }, (_, i) => {
      const path = join(f.home, "missing", `input${String(i).padStart(4, "0")}.jsonl`);
      return { source: "cc", path, stream: `fixture~cc.input${String(i).padStart(4, "0")}` };
    });
    for (let i = 0; i < entries.length; i += 128) queue.add(entries.slice(i, i + 128), null, { complete: i + 128 >= entries.length });
    state.transaction(() => {
      for (const [i, entry] of entries.entries()) {
        state.set("set-aside", `${entry.stream}:${entry.path}`, { owner: "fixture", source: entry.source,
          path: entry.path, offset: 0, reason: "captured-prefix-changed", retry: false });
        queue.mark(i + 1, "set-aside");
      }
    });
    return entries.map(entry => `${entry.stream}:${entry.path}`);
  });
}

test("fixed entry validates caller options before locking and keeps Node/worker policy out of options", async t => {
  const f = fixture(t);
  for (const extra of [{ workerPath: "/untrusted" }, { policy: {} }, { executable: "/untrusted" },
    { trigger: "quiet" }, { owner: "../owner" }, { indexEnabled: "false" }, { retrySetAside: 1 }])
    await assert.rejects(runCaptureCommand(f.root, f.options(extra)), /invalid private capture command selection/);
  assert.throws(() => captureCommandOptions(f.options({ retrySetAside: true,
    plan: captureDefaultRootPlan({ home: f.home, cwd: f.base, sources: ["aw"] }) })), /all capture sources/);
  assert.equal(fs.existsSync(f.root), false);
  for (const trigger of ["manual", "watch", "hook", "setup", "service"])
    assert.equal(captureCommandOptions(f.options({ trigger })).trigger, trigger);
  const relative = await f.run({}, "record");
  assert.equal(relative.outcome, "partial", JSON.stringify(relative));
  assert.deepEqual(relative.receipt, { appended: 0, pending: true });
  assert.notEqual(readCaptureStatus(f.root).lastRun.pid, process.pid, "the fixed entry executes in its worker");
  assert.equal(fs.existsSync(join(f.root, "index/turns.db")), false);
});

test("fixed entry captures selected sources append-only, then enabled capture catches up with explicit trigger and overlap", async t => {
  const f = fixture(t), cc = join(f.home, ".claude/projects/project"), logs = join(f.home, ".config/aw/logs");
  fs.mkdirSync(cc, { recursive: true }); fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(join(cc, "session.jsonl"), native); fs.writeFileSync(join(logs, "account.jsonl"), aw);
  const store = new RecordStore(f.root, { owner: "fixture" });
  for (const [sources, trigger, stream] of [[["cc", "pi", "codex"], "manual", "fixture~cc.session"], [["aw"], "watch", "fixture~aw"]]) {
    const result = await f.run({ plan: captureDefaultRootPlan({ home: f.home, cwd: f.base, env: {}, sources }), trigger });
    assert.equal(result.outcome, "partial", JSON.stringify(result)); assert.equal(result.exitCode, 0);
    assert.deepEqual(result.receipt, { appended: 1, pending: true });
    assert.equal(store.readStream(stream).length, 1);
    assert.equal(readCaptureStatus(f.root).lastRun.trigger, trigger);
    assert.equal(fs.existsSync(join(f.root, "index/turns.db")), false);
    if (trigger === "manual") assert.equal(store.readStream("fixture~aw").length, 0);
  }
  const result = await f.run({ indexEnabled: true, trigger: "setup" });
  assert.equal(result.outcome, "complete", JSON.stringify(result)); assert.equal(result.exitCode, 0);
  assert.deepEqual(result.receipt, { appended: 0, pending: false });
  const status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.trigger, "setup"); assert.equal(status.lastRun.counts.turnsIndexed, 2);
  assert.equal(status.lastSuccess.id, status.lastRun.id);
  const bytes = fs.readFileSync(join(f.root, "capture-status.json")), lock = acquireCaptureLock(f.root);
  try {
    const overlap = await f.run({ trigger: "service" });
    assert.equal(overlap.outcome, "overlap"); assert.equal(overlap.exitCode, 0); assert.equal(overlap.starts, 0);
    assert.deepEqual(fs.readFileSync(join(f.root, "capture-status.json")), bytes);
  } finally { lock.release(); }
});

test("fixed explicit retry revalidates restored native history without authorizing a conflicting prefix", async t => {
  const f = fixture(t), dir = join(f.home, ".claude/projects/project"), path = join(dir, "session.jsonl");
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path, native);
  const store = new RecordStore(f.root, { owner: "fixture" }), stream = "fixture~cc.session", key = `${stream}:${path}`;
  assert.equal(captureSessions(store, { owner: "fixture", files: [path] }).appended, 1);
  fs.writeFileSync(path, native.replace("native", "conflict"));
  assert.equal(captureSessions(store, { owner: "fixture", files: [path] }).complete, false);
  const refused = await f.run({ retrySetAside: true });
  assert.equal(refused.outcome, "partial", JSON.stringify(refused)); assert.equal(refused.receipt.appended, 0);
  const oldRun = readCaptureStatus(f.root).lastRun.id;
  assert.equal(f.state(state => state.get("source-retry", key)), oldRun);
  assert.equal(f.state(state => state.get("set-aside", key).retry), false);
  fs.writeFileSync(path, native + native.replace("native", "next"));
  const waiting = await f.run();
  assert.equal(waiting.receipt.appended, 0); assert.equal(waiting.outcome, "partial");
  assert.equal(f.state(state => state.get("source-retry", key)), oldRun);
  const retried = await f.run({ retrySetAside: true });
  assert.equal(retried.outcome, "partial", JSON.stringify(retried)); assert.equal(retried.exitCode, 0);
  assert.deepEqual(retried.receipt, { appended: 1, pending: true });
  assert.equal(f.state(state => state.get("set-aside", key)), null);
  assert.notEqual(f.state(state => state.get("source-retry", key)), oldRun);
  assert.equal(store.readStream(stream).length, 2);
  assert.equal(fs.existsSync(join(f.root, "index/turns.db")), false);
});

test("preparation pages resume after rollback/reopen without repeating retry generations or changing failed-stream evidence", t => {
  const f = fixture(t), keys = seedIssues(f);
  const scope = f.state(state => state.get("source-sweep", "fixture").id);
  const deferred = { stream: "fixture~later", stage: "index", preserved: true };
  f.state(state => {
    const queue = new CaptureSourceQueue(state, { owner: "fixture", selection: "fixture" });
    const prep = new CaptureIssuePreparation(state, queue, { runId: "run", sources: formats, retry: true });
    state.transaction(() => state.set("capture-retry", deferred.stream, deferred));
    const set = state.set.bind(state);
    state.set = (kind, key, value) => { set(kind, key, value); if (kind === "capture-issue-preparation") throw Error("page publication rollback"); };
    assert.throws(() => prep.advance(f.root), /page publication rollback/);
    assert.equal(prep.current(), null); assert.equal(state.get("source-retry", keys[0]), null);
    assert.equal(state.get("set-aside", keys[0]).retry, false);
    assert.equal([...queue.ready()].length, 0);
    state.set = set;
    assert.equal(prep.advance(f.root, { finalize: true }).checked, 0); assert.equal(prep.current(), null);
    assert.equal(prep.advance(f.root, { stopped: () => true }).checked, 0); assert.equal(prep.current(), null);
    assert.equal(prep.advance(f.root).checked, 128); assert.equal(prep.complete(), false);
    assert.equal(state.get("source-retry", keys[0]), "run"); assert.equal([...queue.ready()].length, 128);
  });
  f.state(state => {
    const queue = new CaptureSourceQueue(state, { owner: "fixture", selection: "fixture" });
    const prep = new CaptureIssuePreparation(state, queue, { runId: "run", sources: formats, retry: true });
    assert.equal(prep.current().scope, scope);
    state.transaction(() => state.set("set-aside", keys[0], { ...state.get("set-aside", keys[0]), retry: false }));
    const writes = [], set = state.set.bind(state);
    state.set = (kind, key, value) => { if (kind === "source-retry") writes.push(key); return set(kind, key, value); };
    assert.equal(prep.advance(f.root).checked, 128); assert.equal(prep.advance(f.root).checked, 4);
    assert.equal(prep.complete(), true); assert.equal(prep.advance(f.root).checked, 0);
    assert.equal(writes.length, 132); assert.equal(writes.includes(keys[0]), false);
    assert.equal(state.get("set-aside", keys[0]).retry, false, "a repeated refusal is not retried again in this pass");
    assert.deepEqual(state.get("capture-retry", deferred.stream), deferred);
    const changed = new CaptureIssuePreparation(state, queue, { runId: "run", sources: ["aw"], retry: false });
    assert.throws(() => changed.current(), /selection changed/);
    const later = new CaptureIssuePreparation(state, queue, { runId: "later", sources: formats, retry: true });
    later.advance(f.root); assert.equal(state.get("source-retry", keys[0]), "later");
  });
});

test("finalization-only command cannot begin explicit retry preparation", async t => {
  const f = fixture(t), keys = seedIssues(f, 1);
  const result = await superviseCapturePass(f.root, f.options({ retrySetAside: true }), {
    workerPath: new URL("../lib/capture-command-worker.mjs", import.meta.url).pathname,
    env: { HOME: f.home, TMPDIR: f.base, XDG_CACHE_HOME: f.base, PATH: process.env.PATH },
    policy: { intervalSeconds: 900, heapMiB: 256, rssBytes: 2147483648, deadlineSeconds: 10, maxRecordBytes: 8388608 },
  });
  assert.equal(result.outcome, "partial", JSON.stringify(result)); assert.equal(result.starts, 1);
  f.state(state => {
    assert.equal(state.get("capture-issue-preparation", "fixture"), null);
    assert.equal(state.get("source-retry", keys[0]), null);
    assert.equal(state.get("set-aside", keys[0]).retry, false);
  });
  assert.equal(readCaptureStatus(f.root).lastSuccess, null);
  assert.equal(fs.existsSync(join(f.root, "index/turns.db")), false);
});

test("native ignored issues reconcile without missing-source access and excluded owners/formats remain", async t => {
  const f = fixture(t), keys = seedIssues(f, 1);
  fs.writeFileSync(join(f.root, "ignore"), "*\n");
  f.state(state => state.transaction(() => {
    const issue = state.get("set-aside", keys[0]);
    state.set("set-aside", "other-owner", { ...issue, owner: "other" });
    state.set("set-aside", "other-format", { ...issue, source: "pi" });
  }));
  const result = await f.run({ plan: captureDefaultRootPlan({ home: f.home, cwd: f.base, sources: ["cc"] }) });
  assert.equal(result.outcome, "partial", JSON.stringify(result));
  f.state(state => {
    assert.equal(state.get("set-aside", keys[0]), null);
    assert.equal(state.get("set-aside", "other-owner").owner, "other");
    assert.equal(state.get("set-aside", "other-format").source, "pi");
    assert.equal([...state.entries("source-retry")].length, 0);
  });
  assert.equal(fs.existsSync(join(f.home, "missing")), false);
  assert.equal(fs.existsSync(join(f.root, "index/turns.db")), false);
});

for (const boundary of ["before", "after"]) test(`actual issue-page death ${boundary} commit preserves replacement progress and current-pass failure`, async t => {
  const f = fixture(t), keys = seedIssues(f);
  const logs = join(f.home, ".config/aw/logs"); fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(join(logs, "account.jsonl"), aw);
  const workerPath = join(f.base, "worker.mjs");
  fs.writeFileSync(workerPath, `
    import fs from 'node:fs';import {join} from 'node:path';
    import {runCaptureWorker} from ${JSON.stringify(url("capture-worker"))};
    import {captureCommandOperation} from ${JSON.stringify(url("capture-command-operation"))};
    import {CaptureIssuePreparation} from ${JSON.stringify(url("capture-issue-preparation"))};
    import {DerivedState} from ${JSON.stringify(url("derived-state"))};
    await runCaptureWorker(start=>{
      const marker=join(start.root,'death'), state=new DerivedState(start.root);
      try{if(fs.existsSync(marker))fs.appendFileSync(join(start.root,'replacements'),JSON.stringify({
        checkpoint:state.get('capture-issue-preparation','fixture'),generation:state.get('source-retry',${JSON.stringify(keys[0])})})+'\\n');}
      finally{state.close();}
      const set=DerivedState.prototype.set;
      DerivedState.prototype.set=function(kind,key,value){
        const result=set.call(this,kind,key,value);
        if(kind==='source-retry')fs.appendFileSync(join(start.root,'generations'),JSON.stringify({key,value})+'\\n');
        if(${JSON.stringify(boundary)}==='before' && kind==='capture-issue-preparation' && !fs.existsSync(marker)){
          fs.writeFileSync(marker,JSON.stringify({depth:this.depth,runId:start.pass.runId}));process.kill(process.pid,'SIGKILL');
        }return result;
      };
      const advance=CaptureIssuePreparation.prototype.advance;
      CaptureIssuePreparation.prototype.advance=function(...args){
        const result=advance.apply(this,args);
        if(${JSON.stringify(boundary)}==='after' && result.checked && !fs.existsSync(marker)){
          fs.writeFileSync(marker,JSON.stringify({depth:this.state.depth,runId:start.pass.runId}));process.kill(process.pid,'SIGKILL');
        }return result;
      };
      return captureCommandOperation(start);
    });
  `);
  const result = await superviseCapturePass(f.root, f.options({ retrySetAside: true }), { workerPath,
    env: { HOME: f.home, TMPDIR: f.base, XDG_CACHE_HOME: f.base, PATH: process.env.PATH } });
  assert.equal(result.outcome, "failed", JSON.stringify(result)); assert.equal(result.exitCode, 1); assert.ok(result.starts > 1);
  const death = JSON.parse(fs.readFileSync(join(f.root, "death"), "utf8"));
  assert.equal(death.depth, boundary === "before" ? 1 : 0);
  const replacement = JSON.parse(fs.readFileSync(join(f.root, "replacements"), "utf8").trim().split("\n")[0]);
  assert.equal(replacement.generation, boundary === "before" ? null : death.runId);
  if (boundary === "before") assert.equal(replacement.checkpoint, null);
  else { assert.equal(replacement.checkpoint.after, keys[127]); assert.equal(replacement.checkpoint.complete, false); }
  const writes = fs.readFileSync(join(f.root, "generations"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(writes.filter(row => row.key === keys[0]).length, boundary === "before" ? 2 : 1);
  const status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.id, death.runId); assert.equal(status.lastFailure.id, death.runId); assert.equal(status.lastSuccess, null);
  assert.equal(status.lastRun.counts.turnsAppended, 1); assert.equal(status.lastRun.counts.turnsIndexed, 0);
  assert.equal(status.backlog.setAsideCount, 260); assert.equal(status.backlog.pending, true);
  f.state(state => { assert.equal(state.get("capture-issue-preparation", "fixture").complete, true);
    for (const key of keys) assert.equal(state.get("source-retry", key), death.runId); });
  assert.equal(new RecordStore(f.root, { owner: "fixture" }).readStream("fixture~aw").length, 1);
  assert.equal(fs.existsSync(join(f.root, "index/turns.db")), false);
});

// An unreadable or future-dated status gives no evidence and must not block
// every later pass: it is moved aside, one copy kept, and the pass starts a
// new status with no history.
const STATUS = "capture-status.json";
const asides = f => fs.readdirSync(f.root).filter(name => name.startsWith(`${STATUS}.invalid-`));
async function invalidStatusRecovers(t, corrupt) {
  const f = fixture(t), logs = join(f.home, ".config", "aw", "logs");
  // One captured comm log gives the first pass progress, the history to lose.
  fs.mkdirSync(logs, { recursive: true }); fs.writeFileSync(join(logs, "account.jsonl"), aw);
  await f.pass({ indexEnabled: true });
  const before = readCaptureStatus(f.root);
  assert.ok(before.lastRun && before.lastProgressAt, "the first pass left history to lose");
  const bytes = corrupt(fs.readFileSync(join(f.root, STATUS), "utf8"));
  fs.writeFileSync(join(f.root, STATUS), bytes);
  assert.throws(() => readCaptureStatus(f.root));
  // The pass ends in a defined state instead of failing: captureCommandPass
  // throws on a failed worker.
  const { result, err } = await f.pass({ indexEnabled: true });
  assert.equal(typeof result.appended, "number");
  const status = readCaptureStatus(f.root);
  assert.notEqual(status.lastRun.id, before.lastRun.id);
  assert.equal(status.lastFailure, null);
  assert.ok(status.lastSuccess === null || status.lastSuccess.id === status.lastRun.id, "no history survives the unreadable status");
  const kept = asides(f);
  assert.equal(kept.length, 1);
  assert.equal(fs.readFileSync(join(f.root, kept[0]), "utf8"), bytes, "the moved-aside copy holds the original bytes");
  assert.ok(err.some(line => line.includes(join(f.root, kept[0]))), `stderr names the moved-aside file: ${JSON.stringify(err)}`);
  return f;
}

test("a future-dated capture status is moved aside and the pass writes a new status", async t => {
  await invalidStatusRecovers(t, text => {
    const status = JSON.parse(text);
    status.lastProgressAt = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    return JSON.stringify(status) + "\n";
  });
});

test("a malformed capture status is moved aside and the pass writes a new status", async t => {
  await invalidStatusRecovers(t, () => "{ not json");
});

test("a newer moved-aside status replaces an older one", async t => {
  const f = await invalidStatusRecovers(t, () => "{ first");
  const older = asides(f)[0];
  fs.writeFileSync(join(f.root, STATUS), "{ second");
  const { err } = await f.pass({ indexEnabled: true });
  const kept = asides(f);
  assert.equal(kept.length, 1, JSON.stringify(kept));
  assert.equal(fs.readFileSync(join(f.root, kept[0]), "utf8"), "{ second");
  if (kept[0] === older) assert.ok(err.some(line => line.includes(kept[0])));
  else assert.equal(fs.existsSync(join(f.root, older)), false);
});
