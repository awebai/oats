import { fixtureEnv } from "./fixture-env.mjs";
// capture --home and recall --thread --json --after/--until: the seam the
// OKF harvester uses. Boundaries are turn ids in capture sequence.

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync, spawnSync } from "node:child_process";
import { RecordStore } from "../lib/store.mjs";
import { finishTurn } from "../lib/canonical.mjs";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const CAPTURE = new URL("../bin/capture.mjs", import.meta.url).pathname;
const RECALL = new URL("../bin/recall.mjs", import.meta.url).pathname;

function ccLine(cwd, sessionId, role, text, ts) {
  return JSON.stringify({ type: role, cwd, sessionId, timestamp: ts, message: { role, content: [{ type: "text", text }] } }) + "\n";
}

test("capture --home captures only that home's sessions and reports exact turn-id boundaries; recall --json windows by id", (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "turn-record-homecli-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const fakeHome = join(base, "user"); // HOME for the child: session roots live under it
  const home = join(base, "ws", "agents", "dev", "instances", "dev-1");
  const other = join(base, "ws", "agents", "dev", "instances", "dev-2");
  mkdirSync(home, { recursive: true }); mkdirSync(other, { recursive: true });
  const proj = join(fakeHome, ".claude", "projects");
  const mine = join(proj, "-dev-1"); const theirs = join(proj, "-dev-2");
  mkdirSync(mine, { recursive: true }); mkdirSync(theirs, { recursive: true });
  const f = join(mine, "s1.jsonl");
  writeFileSync(f, ccLine(home, "s1", "user", "first", "2026-09-05T10:00:00Z") + ccLine(home, "s1", "assistant", "second", "2026-09-05T10:00:01Z"));
  writeFileSync(join(theirs, "s2.jsonl"), ccLine(other, "s2", "user", "not mine", "2026-09-05T10:00:00Z"));
  const root = join(base, "record");
  const env = { ...fixtureEnv(), HOME: fakeHome, TURN_RECORD_ROOT: root, TURN_RECORD_OWNER: "mac" };
  const run = (bin, args) => execFileSync(process.execPath, [bin, ...args], { encoding: "utf8", env });

  const r1 = JSON.parse(run(CAPTURE, ["--current-roots", "--home", home, "--quiet"]));
  assert.equal(r1.status, "complete");
  assert.equal(r1.complete, true);
  assert.equal(r1.skipped, false);
  assert.equal(r1.held, 0);
  assert.equal(r1.failed, 0);
  assert.equal(r1.sessions.length, 1);
  const s = r1.sessions[0];
  assert.equal(s.thread, "cc:session:s1");
  assert.equal(s.stream, "mac~cc.s1");
  assert.equal(s.turns, 2);
  assert.notEqual(s.firstTurnId, s.lastTurnId);
  assert.equal(r1.appended, 2, "the other home's session was not captured by this call");

  // The session grows: the boundary moves, the earlier ids stay.
  appendFileSync(f, ccLine(home, "s1", "user", "third", "2026-09-05T10:00:02Z"));
  const r2 = JSON.parse(run(CAPTURE, ["--current-roots", "--home", home, "--quiet"])).sessions[0];
  assert.equal(r2.turns, 3);
  assert.equal(r2.firstTurnId, s.firstTurnId);
  assert.notEqual(r2.lastTurnId, s.lastTurnId);

  // Window by ids: after the old boundary, until the new one → exactly the new turn.
  const w = JSON.parse(run(RECALL, ["--thread", "cc:session:s1", "--json", "--after", s.lastTurnId, "--until", r2.lastTurnId]));
  assert.equal(w.total, 3);
  assert.equal(w.turns.length, 1);
  assert.equal(w.turns[0].id, r2.lastTurnId);
  assert.deepEqual(w.turns[0].text, [{ role: "user", text: "third" }]);
  // Sizing a window without materializing text: ids, stamps and byte counts, with the remainder.
  const sized = JSON.parse(run(RECALL, ["--thread", "cc:session:s1", "--json", "--ids-only", "--limit", "2"]));
  assert.deepEqual(sized.turns.map((x) => Object.keys(x).sort()), [["bytes", "id", "kind", "source", "thread", "ts"], ["bytes", "id", "kind", "source", "thread", "ts"]]);
  const emitted = JSON.parse(run(RECALL, ["--thread", "cc:session:s1", "--json", "--limit", "1"])).turns[0];
  assert.equal(sized.turns[0].bytes, Buffer.byteLength(JSON.stringify(emitted, null, 2)) + 8, "bytes is what the turn occupies in the --json answer");
  assert.equal(sized.remaining, 1);
  // Whole thread in sequence when unbounded.
  const all = JSON.parse(run(RECALL, ["--thread", "cc:session:s1", "--json"]));
  assert.deepEqual(all.turns.map((x) => x.text[0].text), ["first", "second", "third"]);
  // An unknown boundary is an error, never a silently empty or widened window.
  assert.throws(() => run(RECALL, ["--thread", "cc:session:s1", "--json", "--after", "nope"]));

  // Redaction: a tombstoned session turn is hidden from the harvester's
  // window and is never reported as a boundary. The tombstone is written by
  // the record owner, the authority that hides any turn.
  const secretId = r2.lastTurnId; // "third" becomes the secret
  const store = new RecordStore(root, { owner: "mac" });
  store.append("mac~notes", finishTurn({ v: 1, ts: "2026-09-05T10:01:00Z", from: "mac", kind: "tombstone", body: { reason: "redacted" }, links: [{ rel: "tombstones", ref: secretId }] }));
  const after = JSON.parse(run(RECALL, ["--thread", "cc:session:s1", "--json"]));
  assert.deepEqual(after.turns.map((x) => x.text[0].text), ["first", "second"], "the redacted line is not emitted");
  const r3 = JSON.parse(run(CAPTURE, ["--current-roots", "--home", home, "--quiet"])).sessions[0];
  assert.equal(r3.turns, 2, "visible turns only");
  assert.equal(r3.lastTurnId, s.lastTurnId, "the boundary is the last VISIBLE turn, so a window bounded by it is never refused");
  // --json with a query and no matches is JSON too.
  assert.equal(run(RECALL, ["--json", "zzzznomatch"]).trim(), "[]");
});


test("direct thread recall works while the search index has an exclusive writer", (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "turn-record-busy-recall-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "record");
  const store = new RecordStore(root, { owner: "mac" });
  const { turn } = store.appendCore("mac~mail", {
    v: 1, ts: "2026-09-05T10:00:00Z", from: "mac", thread: "mail:test",
    kind: "mail", body: { text: "journal remains readable" },
  });
  mkdirSync(join(root, "index"), { recursive: true });
  const writer = new DatabaseSync(join(root, "index", "turns.db"));
  try {
    writer.exec("CREATE TABLE writer_lock (id INTEGER); BEGIN EXCLUSIVE; INSERT INTO writer_lock VALUES (1)");
    for (const extra of [[], ["--ids-only"]]) {
      const result = JSON.parse(execFileSync(process.execPath,
        [RECALL, "--root", root, "--thread", "mail:test", "--json", "--until", turn.id, ...extra],
        { encoding: "utf8", timeout: 5000 }));
      assert.equal(result.turns.length, 1);
      assert.equal(result.turns[0].id, turn.id);
      if (!extra.length) assert.deepEqual(result.turns[0].text, [{ role: "mail", text: "journal remains readable" }]);
      else assert.ok(result.turns[0].bytes > 0);
    }
  } finally {
    writer.exec("ROLLBACK");
    writer.close();
  }
});

function captureFixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "turn-record-outcome-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, "instance"), user = join(base, "user"), root = join(base, "record");
  const project = join(user, ".claude", "projects", "-instance");
  mkdirSync(home); mkdirSync(project, { recursive: true }); mkdirSync(root);
  const file = join(project, "s1.jsonl");
  const env = { ...fixtureEnv(), HOME: user, TURN_RECORD_ROOT: root, TURN_RECORD_OWNER: "tester" };
  // No --quiet: native --home stdout must remain a single JSON document.
  const run = (argv = [CAPTURE], extra = ["--no-index"]) => spawnSync(process.execPath,
    [...argv, "--current-roots", "--home", home, ...extra], { env, cwd: home, encoding: "utf8" });
  return { home, root, file, run };
}

test("capture --home reports held unstamped sessions, then a performed pass and an unchanged complete pass", (t) => {
  const { home, file, run } = captureFixture(t);
  writeFileSync(file, JSON.stringify({ cwd: home, type: "user", message: { content: "awaiting timestamp" } }) + "\n");
  const held = run(); assert.equal(held.status, 0, held.stderr);
  const h = JSON.parse(held.stdout);
  assert.equal(h.status, "held"); assert.equal(h.complete, false); assert.equal(h.held, 1);
  assert.equal(h.skipped, false); assert.equal(h.failed, 0); assert.equal(h.appended, 0);
  assert.deepEqual(h.sessions, []);
  appendFileSync(file, ccLine(home, "s1", "assistant", "timestamp arrived", "2026-09-13T10:00:00Z"));
  const done = run(); assert.equal(done.status, 0, done.stderr);
  const d = JSON.parse(done.stdout);
  assert.equal(d.status, "complete"); assert.equal(d.complete, true); assert.equal(d.held, 0);
  assert.equal(d.appended, 2); assert.equal(d.sessions[0].turns, 2);
  const unchanged = JSON.parse(run().stdout);
  assert.equal(unchanged.status, "complete"); assert.equal(unchanged.complete, true);
  assert.equal(unchanged.appended, 0); assert.deepEqual(unchanged.sessions, d.sessions);
});

test("capture --home keeps privacy exclusions distinct from a skipped pass", (t) => {
  const { home, root, file, run } = captureFixture(t);
  writeFileSync(file, ccLine(home, "s1", "user", "private", "2026-09-13T10:00:00Z"));
  writeFileSync(join(root, "ignore"), "s1\n");
  const r = run(); assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.complete, true); assert.equal(out.skipped, false); assert.equal(out.ignored, 1);
  assert.equal(out.appended, 0); assert.deepEqual(out.sessions, []);
});

test("capture --home failures answer JSON with unknown appended count, never a false complete result", (t) => {
  const { home, root, file, run } = captureFixture(t);
  writeFileSync(file, ccLine(home, "s1", "user", "cannot save offsets", "2026-09-13T10:00:00Z"));
  // A real I/O failure, after capture can have appended turns.
  writeFileSync(join(root, "index"), "not a directory");
  let r = run(); assert.equal(r.status, 1);
  let out = JSON.parse(r.stdout);
  assert.equal(out.complete, false); assert.equal(out.status, "failed");
  assert.equal(out.failed, 1); assert.equal(out.appended, null); assert.equal(out.skipped, false);
  assert.ok(out.error); assert.doesNotMatch(r.stderr, /\n\s+at /);
  rmSync(join(root, "index"));
  // The privacy loader also fails closed with a structured --home answer.
  mkdirSync(join(root, "ignore"));
  r = run(); assert.equal(r.status, 1);
  out = JSON.parse(r.stdout); assert.equal(out.failed, 1); assert.equal(out.complete, false);
  assert.match(out.error, /ignore/); assert.doesNotMatch(r.stderr, /\n\s+at /);
});

for (const [name, bin] of [["oats", "../../../bin/oats.mjs"], ["turn-record", "../bin/turn-record.mjs"]]) {
  test(`${name} capture exposes the native --home outcome, not a schema-v1 envelope`, (t) => {
    const { home, file, run } = captureFixture(t);
    writeFileSync(file, ccLine(home, "s1", "user", "native command", "2026-09-13T10:00:00Z"));
    const argv = [new URL(bin, import.meta.url).pathname, "capture"];
    const r = run(argv); assert.equal(r.status, 0, r.stderr + r.stdout);
    const out = JSON.parse(r.stdout);
    assert.equal(out.schemaVersion, undefined); assert.equal(out.status, "complete");
    assert.equal(out.complete, true); assert.equal(out.sessions[0].turns, 1);
    assert.equal(out.home, home);
  });
}


test("real oats recall drains a >21 MB native JSON window through piped stdout", { timeout: 30000 }, (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "turn-record-large-pipe-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, "instance"), user = join(base, "user"), root = join(base, "record");
  const project = join(user, ".claude", "projects", "fixture");
  mkdirSync(home); mkdirSync(project, { recursive: true });
  const texts = Array.from({ length: 60 }, (_, i) => `${i}:` + "x".repeat(350000) + ":complete");
  writeFileSync(join(project, "large.jsonl"), texts.map(text => ccLine(home, "large", "assistant", text, "2026-09-13T10:00:00Z")).join(""));
  const env = { ...fixtureEnv(), HOME: user, TURN_RECORD_ROOT: root, TURN_RECORD_OWNER: "fixture" };
  const oats = new URL("../../../bin/oats.mjs", import.meta.url).pathname;
  const run = args => spawnSync(process.execPath, [oats, ...args], { cwd: home, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 20000 });
  const capture = run(["capture", "--current-roots", "--home", home]);
  assert.equal(capture.status, 0, capture.stderr);
  const receipt = JSON.parse(capture.stdout); assert.equal(receipt.complete, true);
  const session = receipt.sessions[0]; assert.equal(session.turns, 60);
  // spawnSync's default stdout is a real pipe, NOT an output file or TTY.
  // Its maxBuffer exceeds the answer, separating consumer limits from the
  // producer's prior process.exit(0) truncation at the OS pipe buffer size.
  const recall = run(["recall", "--thread", session.thread, "--until", session.lastTurnId, "--limit", "60", "--json"]);
  assert.equal(recall.status, 0, recall.stderr); assert.equal(recall.error, undefined);
  assert.ok(Buffer.byteLength(recall.stdout) > 21_000_000);
  const result = JSON.parse(recall.stdout);
  assert.equal(result.remaining, 0); assert.equal(result.turns.length, 60);
  assert.equal(result.turns.at(-1).id, session.lastTurnId);
  assert.deepEqual(result.turns.map(t => t.text[0].text), texts);
  // --show used another immediate-exit branch; a single large turn must
  // drain too, and the finally path must close its derived index normally.
  const show = run(["recall", "--show", session.lastTurnId]);
  assert.equal(show.status, 0, show.stderr);
  assert.ok(Buffer.byteLength(show.stdout) > 350000);
  assert.equal(JSON.parse(JSON.parse(show.stdout).body.line).message.content[0].text, texts.at(-1));
});
