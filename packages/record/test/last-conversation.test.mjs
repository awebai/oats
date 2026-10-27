import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { initializeNativeHistory, nativeHistoryPath, prepareNativeStart, recordNativeStart } from "../lib/native-history.mjs";
import { lastConversation } from "../lib/last-conversation.mjs";

const T0 = Date.parse("2020-01-01T00:00:00.000Z"); // before any real recorder startedAt
const at = minutes => new Date(T0 + minutes * 60_000);

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "last-conversation-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, "home"), user = join(base, "user");
  mkdirSync(join(home, "work"), { recursive: true }); mkdirSync(user);
  initializeNativeHistory(home);
  return { base, home, user, env: { HOME: user } };
}
function start(f, runtime, args = []) {
  const id = prepareNativeStart(f.home, runtime);
  recordNativeStart(f.home, id, runtime, args, f.env);
  return id;
}
function receipt(f, row) {
  const id = row.id ?? randomUUID();
  writeFileSync(join(nativeHistoryPath(f.home), `${id}.json`), JSON.stringify({ version: 1, id, home: f.home, ...row }), { mode: 0o600 });
}
function transcript(path, lines, mtime) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.map(l => JSON.stringify(l) + "\n").join(""));
  utimesSync(path, mtime, mtime);
  return path;
}
const ccProject = f => join(f.user, ".claude", "projects", "-home");
const cc = (f, id, cwd, mtime, dir = ccProject(f)) => transcript(join(dir, `${id}.jsonl`), [{ type: "queue-operation" }, { type: "user", cwd, sessionId: id }], mtime);
const piDir = f => join(f.user, ".pi", "agent", "sessions", "--home--");
const pi = (f, id, cwd, mtime, headerId = id) => transcript(join(piDir(f), `${mtime.toISOString().replace(/[:.]/g, "-")}_${id}.jsonl`), [{ type: "session", version: 3, id: headerId, timestamp: mtime.toISOString(), cwd }], mtime);

test("no custody, a captured (v2) home, or no qualifying receipt is no-receipts", t => {
  const f = fixture(t), since = at(0).toISOString();
  const bare = join(f.base, "bare"); mkdirSync(bare);
  assert.deepEqual(lastConversation(bare, { harness: "claude", since }), { none: "no-receipts" });
  assert.deepEqual(lastConversation(f.home, { harness: "claude", since }), { none: "no-receipts" }, "manifest only");
  const locations = [join(f.user, ".claude", "projects")];
  receipt(f, { runtime: "claude", state: "pending" });
  receipt(f, { runtime: "pi", state: "started", startedAt: at(5).toISOString(), locations: [join(f.user, ".pi", "agent", "sessions")] });
  receipt(f, { runtime: "claude", state: "started", startedAt: at(-5).toISOString(), locations });
  receipt(f, { version: 2, runtime: "claude", state: "started", startedAt: at(5).toISOString(), locations });
  writeFileSync(join(nativeHistoryPath(f.home), `${randomUUID()}.json.${randomUUID()}.tmp`), "{");
  cc(f, randomUUID(), f.home, at(10));
  assert.deepEqual(lastConversation(f.home, { harness: "claude", since }), { none: "no-receipts" });
  assert.equal(lastConversation(f.home, { harness: "pi", since }).none, "no-conversation", "the pi receipt qualifies for pi");

  const captured = join(f.base, "captured"); mkdirSync(captured); initializeNativeHistory(captured);
  writeFileSync(join(nativeHistoryPath(captured), "history.json"), JSON.stringify({ version: 2, home: captured, completeHistory: true, capturedPi: {} }));
  receipt({ home: captured }, { runtime: "claude", state: "started", startedAt: at(5).toISOString(), locations });
  assert.deepEqual(lastConversation(captured, { harness: "claude", since }), { none: "no-receipts" });
});

test("claude: newest transcript started in the home itself since createdAt, never a sidechain, a helper or another home", t => {
  const f = fixture(t), since = at(0);
  mkdirSync(join(f.user, ".claude", "projects"), { recursive: true });
  start(f, "claude"); // startedAt is now, after `since`
  const older = randomUUID(), newest = randomUUID();
  cc(f, older, f.home, at(10));
  const expected = cc(f, newest, f.home, at(20));
  cc(f, randomUUID(), join(f.home, "work"), at(30)); // a helper started in work/
  cc(f, randomUUID(), join(f.base, "other"), at(40)); // another home
  cc(f, randomUUID(), f.home, at(-10)); // an earlier incarnation of this name
  // Sidechains, newer than the real session and carrying the home's cwd.
  transcript(join(ccProject(f), newest, "subagents", "agent-x.jsonl"), [{ type: "user", cwd: f.home }], at(50));
  transcript(join(ccProject(f), "agent-x.jsonl"), [{ type: "user", cwd: f.home }], at(50));
  transcript(join(ccProject(f), `${randomUUID()}.jsonl`), [{ type: "queue-operation" }], at(60)); // no cwd
  for (const s of [since, since.toISOString(), since.getTime()]) {
    assert.deepEqual(lastConversation(f.home, { harness: "claude", since: s }), { sessionId: newest, path: expected });
  }
  assert.throws(() => lastConversation(f.home, { harness: "claude" }), /since/);
  assert.throws(() => lastConversation(f.home, { harness: "gemini", since }), /unsupported/);
});

test("claude: equal mtimes break ties by path; nothing newer than since is no-conversation", t => {
  const f = fixture(t), since = at(0);
  start(f, "claude");
  assert.deepEqual(lastConversation(f.home, { harness: "claude", since }), { none: "no-conversation" }, "a recorded root nobody wrote yet");
  cc(f, randomUUID(), f.home, at(-1));
  cc(f, randomUUID(), join(f.home, "work"), at(5));
  assert.deepEqual(lastConversation(f.home, { harness: "claude", since }), { none: "no-conversation" });
  const [a, b] = [randomUUID(), randomUUID()].sort();
  const first = cc(f, a, f.home, at(7)); cc(f, b, f.home, at(7));
  assert.deepEqual(lastConversation(f.home, { harness: "claude", since }), { sessionId: a, path: first });
});

test("a reused name: the earlier incarnation's receipt and transcript predate since", t => {
  const f = fixture(t);
  receipt(f, { runtime: "claude", state: "started", startedAt: at(-60).toISOString(), locations: [join(f.user, ".claude", "projects")] });
  cc(f, randomUUID(), f.home, at(-30));
  assert.deepEqual(lastConversation(f.home, { harness: "claude", since: at(0) }), { none: "no-receipts" });
  // The new incarnation starts; the old transcript sits in the same root and path space.
  start(f, "claude");
  assert.deepEqual(lastConversation(f.home, { harness: "claude", since: at(0) }), { none: "no-conversation" });
  const id = randomUUID(), path = cc(f, id, f.home, at(1));
  assert.deepEqual(lastConversation(f.home, { harness: "claude", since: at(0) }), { sessionId: id, path });
});

test("pi: the session header's id from the recorded session directory, started in the home", t => {
  const f = fixture(t), since = at(0);
  start(f, "pi");
  const old = randomUUID(), id = randomUUID();
  pi(f, old, f.home, at(5));
  const expected = pi(f, id, f.home, at(10));
  pi(f, randomUUID(), join(f.home, "work"), at(20));
  pi(f, randomUUID(), f.home, at(-5));
  assert.deepEqual(lastConversation(f.home, { harness: "pi", since }), { sessionId: id, path: expected });
  // A resumed launch (bare --session id) records the same directory.
  start(f, "pi", ["--session", id]);
  assert.deepEqual(lastConversation(f.home, { harness: "pi", since }), { sessionId: id, path: expected });
  // The header id is what pi's --session matches.
  const header = randomUUID(), renamed = pi(f, randomUUID(), f.home, at(30), header);
  assert.deepEqual(lastConversation(f.home, { harness: "pi", since }), { sessionId: header, path: renamed });
  assert.equal(lastConversation(f.home, { harness: "claude", since }).none, "no-receipts");
});

test("codex: generic format lookup", t => {
  const f = fixture(t), since = at(0);
  start(f, "codex");
  const id = randomUUID(), dir = join(f.user, ".codex", "sessions", "2020", "01", "01");
  const path = transcript(join(dir, `rollout-2020-01-01T00-10-00-${id}.jsonl`), [{ type: "session_meta", payload: { id, cwd: f.home } }], at(10));
  transcript(join(dir, `rollout-2020-01-01T00-20-00-${randomUUID()}.jsonl`), [{ type: "session_meta", payload: { cwd: join(f.home, "work") } }], at(20));
  assert.deepEqual(lastConversation(f.home, { harness: "codex", since }), { sessionId: id, path });
});
