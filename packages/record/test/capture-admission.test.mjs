import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { RecordStore } from "../lib/store.mjs";
import { DerivedState, fileVersion } from "../lib/derived-state.mjs";
import { withCaptureGroup, captureContext } from "../lib/capture-context.mjs";
import { readCaptureAdmission } from "../lib/capture-admission.mjs";
import { finishTurn } from "../lib/canonical.mjs";

const turn = n => finishTurn({ v: 1, ts: "2026-01-01T00:00:00Z", from: "fixture", kind: "note", body: { text: `turn ${n}` } });
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), "capture-admission-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, store: new RecordStore(root, { owner: "fixture" }) };
}
function selection(store, streams) {
  return { runId: "fixture-run", stage: "capture", next: { stage: "index", after: streams.at(-1) },
    members: streams.map(stream => ({ stream, offset: 0, generation: fileVersion(store.journalPath(stream)) })) };
}
function countTransactions(state, fn) {
  const exec = state.db.exec.bind(state.db), counts = { begins: 0, commits: 0 };
  state.db.exec = sql => {
    if (/^BEGIN IMMEDIATE$/.test(sql)) counts.begins++;
    if (/^COMMIT$/.test(sql)) counts.commits++;
    return exec(sql);
  };
  try { fn(); return counts; } finally { state.db.exec = exec; }
}

for (const size of [1, 4, 129]) test(`${size} streams commit one intent per bounded group, with checkpoints and intent completion together`, t => {
  const { root, store } = fixture(t), state = new DerivedState(root);
  try {
    const streams = Array.from({ length: size }, (_, n) => `fixture~s${String(n).padStart(3, "0")}`);
    const counts = countTransactions(state, () => {
      for (let start = 0; start < streams.length; start += 128) {
        const group = streams.slice(start, start + 128), admission = selection(store, group);
        withCaptureGroup(store, group, () => {
          const active = readCaptureAdmission(state);
          assert.equal(active.id, captureContext(store).admission.id);
          assert.deepEqual(active.members, admission.members);
          for (const stream of group) store.append(stream, turn(stream));
          state.set("fixture-checkpoint", "done", start + group.length);
        }, { state, admission });
      }
    });
    assert.deepEqual(counts, { begins: 2 * Math.ceil(size / 128), commits: 2 * Math.ceil(size / 128) });
    assert.equal(readCaptureAdmission(state), null);
    assert.equal(state.get("fixture-checkpoint", "done"), size);
    assert.deepEqual(state.get("capture-schedule", "position"), { stage: "index", after: streams.at(-1) });
    for (const stream of streams) assert.equal(store.readStream(stream).length, 1);
    const noOp = countTransactions(state, () => withCaptureGroup(store, streams.slice(0, 128), () => {}, { state }));
    assert.deepEqual(noOp, { begins: 1, commits: 1 }, "unadmitted no-op group has no intent transaction");
  } finally { state.close(); }
});

test("failed admission commit cannot call processing or publish queue/checkpoint progress", t => {
  const { root, store } = fixture(t), state = new DerivedState(root), stream = "fixture~s";
  const exec = state.db.exec.bind(state.db); let commits = 0;
  state.db.exec = sql => { if (sql === "COMMIT" && ++commits === 1) throw Error("injected intent commit failure"); return exec(sql); };
  try {
    assert.throws(() => withCaptureGroup(store, [stream], () => assert.fail("must not process"), {
      state, admission: selection(store, [stream]),
    }), /intent commit failure/);
    assert.equal(readCaptureAdmission(state), null); assert.equal(state.get("capture-schedule", "position"), null);
    assert.equal(fs.existsSync(store.journalPath(stream)), false);
    assert.equal(fs.existsSync(join(root, "streams", stream, ".lock")), false);
  } finally { state.db.exec = exec; state.close(); }
});

test("processing rollback preserves admission/fairness but not volatile checkpoints or guessed member failures", t => {
  const { root, store } = fixture(t), state = new DerivedState(root), streams = ["fixture~a", "fixture~b"];
  try {
    const admission = selection(store, streams);
    assert.throws(() => withCaptureGroup(store, streams, () => {
      store.append(streams[0], turn(0)); state.set("fixture-checkpoint", "done", 1); throw Error("interrupted group");
    }, { state, admission }), /interrupted group/);
    assert.deepEqual(readCaptureAdmission(state).members, admission.members);
    assert.deepEqual(state.get("capture-schedule", "position"), admission.next);
    assert.equal(state.get("fixture-checkpoint", "done"), null);
    assert.deepEqual([...state.entries("capture-failed")], []);
    assert.equal(store.readStream(streams[0]).length, 1);
    assert.throws(() => withCaptureGroup(store, streams, () => assert.fail("must reconcile first"), {
      state, admission: selection(store, streams),
    }), /unreconciled capture admission/);
    assert.equal(store.readStream(streams[0]).length, 1);
  } finally { state.close(); }
});

test("actual killed worker leaves durable admission and fsynced journal while processing cursor rolls back", t => {
  const { root, store } = fixture(t), stream = "fixture~s";
  const storeUrl = new URL("../lib/store.mjs", import.meta.url).href;
  const contextUrl = new URL("../lib/capture-context.mjs", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import {RecordStore} from ${JSON.stringify(storeUrl)};
    import {withCaptureGroup,captureContext} from ${JSON.stringify(contextUrl)};
    const store=new RecordStore(${JSON.stringify(root)},{owner:'fixture'});
    withCaptureGroup(store,[${JSON.stringify(stream)}],()=>{
      store.append(${JSON.stringify(stream)},${JSON.stringify(turn(0))});
      captureContext(store).state.set('fixture-checkpoint','done',1);
      process.kill(process.pid,'SIGKILL');
    },{admission:${JSON.stringify(selection(store, [stream]))}});
  `], { encoding: "utf8", env: { HOME: root, TMPDIR: root, PATH: process.env.PATH }, timeout: 5000 });
  assert.equal(child.signal, "SIGKILL", child.stderr);
  const state = new DerivedState(root);
  try {
    const active = readCaptureAdmission(state);
    assert.equal(active.members.length, 1); assert.equal(active.members[0].offset, 0);
    assert.deepEqual(state.get("capture-schedule", "position"), active.next);
    assert.equal(state.get("fixture-checkpoint", "done"), null);
    assert.deepEqual([...state.entries("capture-failed")], [], "death alone does not invent a reason or exact frame");
    assert.equal(store.appendUniqueBatch(stream, [turn(0)]), 0, "journal recovery dedupes the durable append");
    assert.equal(store.readStream(stream).length, 1);
    assert.equal(readCaptureAdmission(state).id, active.id, "public writers cannot erase unfinished command evidence");
  } finally { state.close(); }
});

test("stale journal generation, out-of-range cursor and unheld members refuse before admission", t => {
  const { root, store } = fixture(t), stream = "fixture~s", state = new DerivedState(root);
  try {
    const before = selection(store, [stream]); store.append(stream, turn(0));
    assert.throws(() => withCaptureGroup(store, [stream], () => assert.fail(), { state, admission: before }), /changed before locking/);
    const badOffset = selection(store, [stream]); badOffset.members[0].offset = badOffset.members[0].generation.size + 1;
    assert.throws(() => withCaptureGroup(store, [stream], () => assert.fail(), { state, admission: badOffset }), /invalid capture admission/);
    assert.throws(() => withCaptureGroup(store, [stream], () => assert.fail(), { state, admission: selection(store, ["fixture~other"]) }), /changed before locking/);
    assert.equal(readCaptureAdmission(state), null); assert.equal(state.get("capture-schedule", "position"), null);
  } finally { state.close(); }
});


test("stage fairness positions survive alternating admissions without an extra transaction", t => {
  const { root, store } = fixture(t), state = new DerivedState(root), stream = "fixture~aw";
  try {
    const first = { ...selection(store, [stream]), next: { stage: "index", after: "source-scope:17" } };
    const counts = countTransactions(state, () => {
      withCaptureGroup(store, [stream], () => {}, { state, admission: first });
      const second = { ...selection(store, [stream]), stage: "index", next: { stage: "capture", after: "index-position" } };
      withCaptureGroup(store, [stream], () => {}, { state, admission: second });
    });
    assert.deepEqual(counts, { begins: 4, commits: 4 });
    assert.deepEqual(state.get("capture-schedule", "position:capture"), { stage: "capture", after: "source-scope:17" });
    assert.deepEqual(state.get("capture-schedule", "position:index"), { stage: "index", after: "index-position" });
  } finally { state.close(); }
});
