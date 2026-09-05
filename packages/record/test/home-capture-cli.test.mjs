// capture --home and recall --thread --json --after/--until: the seam the
// OKF harvester uses. Boundaries are turn ids in capture sequence.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  const env = { ...process.env, HOME: fakeHome, TURN_RECORD_ROOT: root, TURN_RECORD_OWNER: "mac" };
  const run = (bin, args) => execFileSync(process.execPath, [bin, ...args], { encoding: "utf8", env });

  const r1 = JSON.parse(run(CAPTURE, ["--home", home, "--quiet"]));
  assert.equal(r1.sessions.length, 1);
  const s = r1.sessions[0];
  assert.equal(s.thread, "cc:session:s1");
  assert.equal(s.stream, "mac~cc.s1");
  assert.equal(s.turns, 2);
  assert.notEqual(s.firstTurnId, s.lastTurnId);
  assert.equal(r1.appended, 2, "the other home's session was not captured by this call");

  // The session grows: the boundary moves, the earlier ids stay.
  appendFileSync(f, ccLine(home, "s1", "user", "third", "2026-09-05T10:00:02Z"));
  const r2 = JSON.parse(run(CAPTURE, ["--home", home, "--quiet"])).sessions[0];
  assert.equal(r2.turns, 3);
  assert.equal(r2.firstTurnId, s.firstTurnId);
  assert.notEqual(r2.lastTurnId, s.lastTurnId);

  // Window by ids: after the old boundary, until the new one → exactly the new turn.
  const w = JSON.parse(run(RECALL, ["--thread", "cc:session:s1", "--json", "--after", s.lastTurnId, "--until", r2.lastTurnId]));
  assert.equal(w.total, 3);
  assert.equal(w.turns.length, 1);
  assert.equal(w.turns[0].id, r2.lastTurnId);
  assert.deepEqual(w.turns[0].text, [{ role: "user", text: "third" }]);
  // Whole thread in sequence when unbounded.
  const all = JSON.parse(run(RECALL, ["--thread", "cc:session:s1", "--json"]));
  assert.deepEqual(all.turns.map((x) => x.text[0].text), ["first", "second", "third"]);
  // An unknown boundary is an error, never a silently empty or widened window.
  assert.throws(() => run(RECALL, ["--thread", "cc:session:s1", "--json", "--after", "nope"]));
});
