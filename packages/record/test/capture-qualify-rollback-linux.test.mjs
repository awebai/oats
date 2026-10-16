// Rollback qualification (#1108 checkpoint Q3): old -> new -> old -> new with
// the released 0.61.0 CLI (installed from npm with its integrity checked) and
// this head over one synthetic home and one record root, with growth appended
// before every step. Runs only in a dispatched "Linux tests" workflow
// (realManagerSkip("linux")); anywhere else it skips, which is not evidence.
// No service is installed here (the real-manager files own that): an old
// binary's `capture --watch` runs beside this head's capture in both orders,
// which is the coexistence the release order and downgrade docs describe.
// What an old binary does with new artifacts is reported, an incompatibility
// as `finding: true`; assertions cover journals staying valid and free of
// duplicates whichever version wrote last, and this head reading old output.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { DerivedState } from "../lib/derived-state.mjs";
import { captureLockPath, readCaptureLockOwner } from "../lib/capture-lock.mjs";
import { readCaptureStatus } from "../lib/capture-status.mjs";
import { RecordStore } from "../lib/store.mjs";
import { OWNER, appendSessions, cliCapture, headCli, installRelease, realManagerSkip, report, runnerFacts, scratch, syntheticHome, table, until } from "./fixtures/qualify.mjs";

const skip = realManagerSkip("linux") ?? false, STREAMS = 200, GROWTH = 50, OLD = "0.61.0";
const tail = text => String(text ?? "").trim().slice(-400);
const json = text => { try { return JSON.parse(text); } catch { return undefined; } };
// A refusal is truthful when it exits nonzero with its own message rather than an uncaught stack.
const truthfulRefusal = r => r.status !== 0 && r.stderr.trim() !== "" && !/\n\s+at /.test(r.stderr);

function command(f, cli, args) {
  const began = performance.now();
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: f.base, env: f.env, encoding: "utf8", timeout: 10 * 60_000, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, signal: r.signal, stdout: r.stdout ?? "", stderr: r.stderr ?? "", wallMs: Math.round(performance.now() - began) };
}
function lastRun(root) {
  try { return readCaptureStatus(root)?.lastRun ?? null; } catch (error) { return { unreadable: error.message }; }
}
function lockState(root) {
  const owner = readCaptureLockOwner(root);
  return owner ? { pid: owner.pid, worker: owner.worker?.pid ?? null } : fs.existsSync(captureLockPath(root)) ? "owner-less" : null;
}

/** Every journal read by this head: readStream (interior corruption throws),
 *  validateJournal into a throwaway derived state outside the root (so the
 *  check leaves the root's caches as the versions left them), unique turn
 *  ids, and verbatim session lines 1..n contiguous in journal order. */
function journals(f, label) {
  const store = new RecordStore(f.root, { owner: OWNER }), dir = join(f.base, `validate-${label}`), state = new DerivedState(dir);
  const out = { streams: 0, sessionStreams: 0, sessionTurns: 0, otherTurns: 0, counts: {}, smallest: null, problems: [] };
  try {
    for (const id of store.listStreams()) {
      let turns;
      try { turns = store.readStream(id); } catch (error) { out.problems.push(`${id}: readStream: ${error.message}`); continue; }
      out.streams++; out.counts[id] = turns.length;
      try {
        const checkpoint = store.validateJournal(id, state);
        if (!checkpoint.complete || checkpoint.count !== turns.length) out.problems.push(`${id}: validateJournal counted ${checkpoint.count} (complete ${checkpoint.complete}), readStream ${turns.length}`);
      } catch (error) { out.problems.push(`${id}: validateJournal: ${error.message}`); }
      if (new Set(turns.map(turn => turn.id)).size !== turns.length) out.problems.push(`${id}: duplicate turn ids`);
      const lines = turns.filter(turn => turn.provenance?.fidelity === "verbatim").map(turn => turn.provenance.origin?.line);
      if (!lines.length) { out.otherTurns += turns.length; continue; }
      if (lines.length !== turns.length) out.problems.push(`${id}: ${turns.length - lines.length} non-verbatim turns in a session stream`);
      out.sessionStreams++; out.sessionTurns += lines.length;
      const gap = lines.findIndex((line, i) => line !== i + 1);
      if (gap >= 0) out.problems.push(`${id}: line ${lines[gap]} at position ${gap + 1} (want 1..${lines.length} contiguous)`);
      if (!out.smallest || turns.length < out.smallest.turns) out.smallest = { stream: id, thread: turns[0].thread, turns: turns.length };
    }
  } finally { state.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  return out;
}

/** One version's readers over the root: `capture --status` (reads every
 *  journal), recall's index query, recall's journal-order thread read, and
 *  `capture --health --json` (reads status). Compared with this head's
 *  journal reading `j`. */
function readers(f, cli, j) {
  const status = command(f, cli, ["capture", "--status", "--owner", OWNER, "--root", f.root]);
  const listed = Object.fromEntries([...status.stdout.matchAll(/^ {2}(\S+): (\d+) turns$/gm)].map(([, id, n]) => [id, Number(n)]));
  const mismatched = [...new Set([...Object.keys(listed), ...Object.keys(j.counts)])].filter(id => listed[id] !== j.counts[id]);
  const query = command(f, cli, ["recall", "--root", f.root, "--json", "--limit", "5", "turn"]), rows = json(query.stdout);
  const thread = j.smallest ? command(f, cli, ["recall", "--root", f.root, "--thread", j.smallest.thread, "--json"]) : null, window = json(thread?.stdout);
  const health = command(f, cli, ["capture", "--health", "--json", "--root", f.root]), diagnosis = json(health.stdout);
  return {
    status: { exit: status.status, streams: Object.keys(listed).length, mismatched: mismatched.length, example: mismatched[0] ?? null, stderr: tail(status.stderr) },
    query: { exit: query.status, rows: Array.isArray(rows) ? rows.length : null, readable: query.status === 0 && Array.isArray(rows), truthful: truthfulRefusal(query), stderr: tail(query.stderr) },
    thread: thread && { exit: thread.status, total: window?.total ?? null, want: j.smallest.turns, stderr: tail(thread.stderr) },
    health: { exit: health.status, status: diagnosis?.status ?? null, rows: diagnosis?.rows?.map(row => row.code) ?? null,
      readable: health.status === 0 && diagnosis !== undefined, truthful: truthfulRefusal(health), stderr: tail(health.stderr) },
  };
}
/** The incompatibilities an old binary's readers show; each is a finding. */
function oldFindings(r) {
  const out = [];
  if (r.status.exit !== 0 || r.status.mismatched) out.push(`capture --status: exit ${r.status.exit}, ${r.status.mismatched} streams disagree with the journals (e.g. ${r.status.example})`);
  if (!r.query.readable) out.push(`recall query: exit ${r.query.exit}, ${r.query.truthful ? "a truthful refusal" : "not a truthful refusal"}: ${r.query.stderr}`);
  if (r.thread && (r.thread.exit !== 0 || r.thread.total !== r.thread.want)) out.push(`recall --thread: exit ${r.thread.exit}, total ${r.thread.total}, journal holds ${r.thread.want}`);
  if (!r.health.readable || r.health.rows?.includes("capture-status-invalid")) out.push(`capture --health: exit ${r.health.exit}, rows ${JSON.stringify(r.health.rows)}: ${r.health.stderr}`);
  return out;
}
function assertHeadReaders(r, label) {
  assert.equal(r.status.exit, 0, `${label}: head capture --status: ${r.status.stderr}`);
  assert.equal(r.status.mismatched, 0, `${label}: head capture --status disagrees with the journals (e.g. ${r.status.example})`);
  assert.ok(r.query.readable || r.query.truthful, `${label}: head recall query neither read the index nor refused truthfully: ${r.query.stderr}`);
  if (r.thread) { assert.equal(r.thread.exit, 0, `${label}: head recall --thread: ${r.thread.stderr}`); assert.equal(r.thread.total, r.thread.want); }
  assert.ok(r.health.readable || r.health.truthful, `${label}: head capture --health neither read the status nor refused truthfully: ${r.health.stderr}`);
}

/** Capture with one version, then read the root with both and check every journal. */
function step(t, f, label, version) {
  const cli = version === "head" ? headCli : f.old.cli, captures = [];
  // A head command pass is bounded; a second or third finishes a deadline-partial first.
  for (let i = 0; i < (version === "head" ? 3 : 1); i++) {
    captures.push(cliCapture(cli, f.root, f.home));
    if (captures.at(-1).status !== 0 || lastRun(f.root)?.outcome === "complete") break;
  }
  const run = lastRun(f.root), j = journals(f, label);
  const expected = { sessionStreams: f.synthetic.sessions.length, sessionTurns: f.synthetic.sessions.reduce((sum, s) => sum + s.lines, 0) };
  const old = readers(f, f.old.cli, j), head = readers(f, headCli, j), again = journals(f, `${label}-after-readers`);
  const findings = oldFindings(old);
  if (version !== "head" && captures.at(-1).status !== 0) findings.push(`${OLD} capture exited ${captures.at(-1).status}: ${tail(captures.at(-1).stderr)}`);
  if (j.sessionStreams !== expected.sessionStreams || j.sessionTurns !== expected.sessionTurns)
    findings.push(`after ${version}'s capture the journals hold ${j.sessionTurns} session turns in ${j.sessionStreams} streams; the home has ${expected.sessionTurns} lines in ${expected.sessionStreams} sessions`);
  report(t, "rollback-step", { step: label, version, captures: captures.map(c => ({ exit: c.status, signal: c.signal, wallMs: c.wallMs, stderr: tail(c.stderr) })),
    lastRun: run && (run.unreadable ? run : { trigger: run.trigger, outcome: run.outcome, reason: run.reason }), lock: lockState(f.root),
    journals: { streams: j.streams, sessionStreams: j.sessionStreams, sessionTurns: j.sessionTurns, otherTurns: j.otherTurns, problems: j.problems.slice(0, 20) },
    expected, readers: { [OLD]: old, head }, afterReaders: { problems: again.problems.slice(0, 20) } });
  for (const what of findings) report(t, "rollback-finding", { finding: true, step: label, version, what });
  f.rows.push({ step: label, version, exit: captures.map(c => c.status).join("/"), wallMs: captures.reduce((sum, c) => sum + c.wallMs, 0),
    outcome: run?.outcome ?? run?.unreadable ?? "none", streams: j.streams, sessionTurns: `${j.sessionTurns}/${expected.sessionTurns}`, problems: j.problems.length,
    oldStatus: old.status.exit, oldQuery: old.query.readable ? "read" : old.query.truthful ? "refused" : "broken", oldHealth: old.health.rows?.join(",") || old.health.exit,
    headQuery: head.query.readable ? "read" : head.query.truthful ? "refused" : "broken", findings: findings.length });
  assert.deepEqual(j.problems, [], `${label}: journals after ${version}'s capture`);
  assert.deepEqual(again.problems, [], `${label}: journals after both versions' readers`);
  assert.deepEqual(again.counts, j.counts, `${label}: readers changed the journals`);
  if (version === "head") {
    assert.equal(captures.at(-1).status, 0, `${label}: head capture over the old release's output: ${captures.at(-1).stderr}`);
    assert.equal(run?.outcome, "complete", `${label}: head capture did not complete: ${JSON.stringify(run)}`);
  }
  assertHeadReaders(head, label);
}

/** A long-running CLI child this file owns: output collected, close awaited. */
function start(f, cli, args) {
  const child = spawn(process.execPath, [cli, ...args], { cwd: f.base, env: f.env, stdio: ["ignore", "pipe", "pipe"] });
  const w = { child, stdout: "", stderr: "", done: false };
  child.stdout.on("data", bytes => { w.stdout += bytes; }); child.stderr.on("data", bytes => { w.stderr += bytes; });
  w.exited = new Promise(resolve => {
    child.once("error", error => { w.done = true; resolve({ code: null, signal: null, error: error.message }); });
    child.once("close", (code, signal) => { w.done = true; resolve({ code, signal }); });
  });
  f.started.push(w);
  return w;
}
async function stop(w, ms = 15_000) {
  if (!w.done) w.child.kill("SIGTERM");
  const timer = setTimeout(() => { if (!w.done) w.child.kill("SIGKILL"); }, ms);
  try { return await w.exited; } finally { clearTimeout(timer); }
}
// The old watcher logs "watching <dir>" (or "cannot watch") after its first pass, run or skipped.
const watching = w => /^watching /m.test(w.stdout) || /cannot watch/.test(w.stderr) || w.done;
const skipped = text => /another pass holds/.test(text);

test(`rollback: ${OLD} -> head -> ${OLD} -> head over one home, with an old --watch beside a head capture`, { skip, timeout: 19 * 60_000 }, async t => {
  const base = scratch(t, "qualify-rollback-"), root = join(base, "record"); fs.mkdirSync(root);
  runnerFacts(t, { root, scratch: base });
  const old = installRelease(base, OLD); report(t, "outgoing-release", old);
  const synthetic = syntheticHome(base, { streams: STREAMS });
  const f = { base, root, home: synthetic.home, synthetic, old, env: { ...process.env, HOME: synthetic.home, TURN_RECORD_ROOT: root }, rows: [], started: [] };
  report(t, "rollback-home", { streams: STREAMS, sessions: synthetic.sessions.length, bytes: synthetic.bytes, growthStreams: GROWTH });
  try {
    step(t, f, "1-old", OLD);
    appendSessions(synthetic, GROWTH); step(t, f, "2-new", "head");
    appendSessions(synthetic, GROWTH); step(t, f, "3-old", OLD);
    appendSessions(synthetic, GROWTH); step(t, f, "4-new", "head");

    // Old watcher first: its initial pass holds the lock while this head's capture starts.
    appendSessions(synthetic, synthetic.sessions.length, 20);
    const first = start(f, old.cli, ["capture", "--watch", "--owner", OWNER, "--root", root]);
    await until(() => readCaptureLockOwner(root)?.pid === first.child.pid || watching(first), 120_000, "the old watcher's first pass");
    const oldHeld = readCaptureLockOwner(root)?.pid === first.child.pid, runBefore = lastRun(root)?.id;
    const head = cliCapture(headCli, root, synthetic.home), headSkipped = skipped(head.stdout + head.stderr), runAfter = lastRun(root)?.id;
    await until(() => watching(first), 5 * 60_000, "the old watcher to finish its first pass");
    const firstExit = await stop(first);
    const watchFirst = { oldHeldLockAtHeadStart: oldHeld, head: { exit: head.status, wallMs: head.wallMs, skipped: headSkipped, published: runAfter !== runBefore, stdout: tail(head.stdout), stderr: tail(head.stderr) },
      old: { exit: firstExit, stdout: tail(first.stdout), stderr: tail(first.stderr) }, lockAfter: lockState(root), journals: journals(f, "watch-first").problems.slice(0, 20) };
    report(t, "rollback-watch-old-first", watchFirst);
    if (!oldHeld) report(t, "rollback-watch-old-first", { note: "the old watcher's first pass ended before it could be observed holding the lock; no overlap was exercised in this order" });
    if (watchFirst.lockAfter) report(t, "rollback-finding", { finding: true, step: "watch-old-first", what: `lock left after SIGTERM of an idle old watcher: ${JSON.stringify(watchFirst.lockAfter)}` });
    if (/capture pass failed/.test(first.stderr)) report(t, "rollback-finding", { finding: true, step: "watch-old-first", what: `old watcher pass failed: ${tail(first.stderr)}` });
    assert.deepEqual(watchFirst.journals, [], "journals after an old watcher beside a head capture");
    assert.equal(head.status, 0, `head capture beside the old watcher: ${head.stderr}`);
    if (headSkipped) assert.equal(runAfter, runBefore, "a head capture that found the old lock published no run");

    // Head first: an old watcher started while this head's pass holds the lock.
    appendSessions(synthetic, synthetic.sessions.length, 20);
    const pass = start(f, headCli, ["capture", "--owner", OWNER, "--root", root]);
    await until(() => readCaptureLockOwner(root)?.pid === pass.child.pid || pass.done, 120_000, "this head's pass to take the lock");
    const headHeld = readCaptureLockOwner(root)?.pid === pass.child.pid;
    const second = start(f, old.cli, ["capture", "--watch", "--owner", OWNER, "--root", root]);
    await until(() => watching(second), 5 * 60_000, "the old watcher's first pass");
    const oldSkipped = skipped(second.stdout + second.stderr), headStillHeld = readCaptureLockOwner(root)?.pid === pass.child.pid;
    const passExit = await pass.exited, secondExit = await stop(second);
    const watchSecond = { headHeldLockAtOldStart: headHeld, headStillHeldAfterOldPass: headStillHeld, old: { skipped: oldSkipped, exit: secondExit, stdout: tail(second.stdout), stderr: tail(second.stderr) },
      head: { exit: passExit, stdout: tail(pass.stdout), stderr: tail(pass.stderr) }, lockAfter: lockState(root), journals: journals(f, "watch-second").problems.slice(0, 20) };
    report(t, "rollback-watch-head-first", watchSecond);
    if (headHeld && headStillHeld && !oldSkipped) report(t, "rollback-finding", { finding: true, step: "watch-head-first", what: "the old watcher's first pass did not report the head's lock while the head held it throughout" });
    if (watchSecond.lockAfter) report(t, "rollback-finding", { finding: true, step: "watch-head-first", what: `lock left after both exited: ${JSON.stringify(watchSecond.lockAfter)}` });
    if (/capture pass failed/.test(second.stderr)) report(t, "rollback-finding", { finding: true, step: "watch-head-first", what: `old watcher pass failed: ${tail(second.stderr)}` });
    assert.deepEqual(watchSecond.journals, [], "journals after a head capture beside an old watcher");
    assert.equal(passExit.code, 0, `head capture beside the old watcher: ${pass.stderr}`);

    step(t, f, "5-new-after-watch", "head");
  } finally {
    for (const w of f.started) await stop(w);
    table(t, `rollback ${OLD} <-> head (${STREAMS} streams)`, f.rows);
  }
});
