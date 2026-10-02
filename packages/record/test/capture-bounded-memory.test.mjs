import { fixtureEnv } from "./fixture-env.mjs";
// A capture pass runs in bounded memory, whatever the record's size (awebai/oats#456). On a host with a
// 2.6 GB record, every pass under --max-old-space-size=256 died within seconds: the first append to a stream
// parsed its whole journal, the aw dedupe read the whole aw journal, and each changed comm log was read whole.
// Here a record several times the heap is captured, then a comm log and a session each grow by one
// line, and every pass, the first capture of all of it included, must succeed under a small heap.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, createWriteStream, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const CAPTURE = new URL("../bin/capture.mjs", import.meta.url).pathname;
const HEAP_MB = 64;
const PAD = "x".repeat(1800);

async function writeLines(path, count, line) {
  const out = createWriteStream(path);
  for (let i = 0; i < count; i++) if (!out.write(line(i) + "\n")) await once(out, "drain");
  out.end();
  await once(out, "finish");
}
const awEntry = (i, tag = "") => JSON.stringify({ ts: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(), dir: i % 2 ? "recv" : "send", ch: "mail",
  msg_id: `m${tag}${i}`, conversation_id: `c${i % 997}`, from: "acme/alpha", to: "acme/beta", subject: `s${i}`, body: `${i} ${PAD}` });
const ccLine = (i) => JSON.stringify({ type: i % 2 ? "assistant" : "user", cwd: "/w", sessionId: "big", timestamp: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
  message: { role: i % 2 ? "assistant" : "user", content: [{ type: "text", text: `${i} ${PAD}` }] } });

test(`a pass over a record several times the heap captures a grown comm log and session under --max-old-space-size=${HEAP_MB}`, async (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "turn-record-bounded-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, "home"), logs = join(home, ".config", "aw", "logs"), proj = join(home, ".claude", "projects", "-w");
  mkdirSync(logs, { recursive: true }); mkdirSync(proj, { recursive: true });
  // About 150 MB of aw log over two accounts and a 100 MB session.
  await writeLines(join(logs, "acme-a.jsonl"), 40000, (i) => awEntry(i, "a"));
  await writeLines(join(logs, "acme-b.jsonl"), 40000, (i) => awEntry(i, "b"));
  await writeLines(join(proj, "big.jsonl"), 50000, ccLine);
  const root = join(base, "record");
  const env = { ...fixtureEnv(), HOME: home, TURN_RECORD_ROOT: root, TURN_RECORD_OWNER: "host" };
  const run = (heap) => spawnSync(process.execPath, [`--max-old-space-size=${heap}`, CAPTURE, "--quiet"], { encoding: "utf8", env, maxBuffer: 16 * 1024 * 1024 });
  // The first capture of all of it (a host whose job was off) is itself under the small heap.
  const built = run(HEAP_MB);
  assert.equal(built.status, 0, built.stderr);
  const journal = (stream) => statSync(join(root, "streams", stream, "journal.jsonl")).size;
  assert.ok(journal("host~aw") + journal("host~cc.big") > 4 * HEAP_MB * 1024 * 1024, "the record is several times the heap");

  // The host's periodic pass: one new message in one log, one new line in the session.
  appendFileSync(join(logs, "acme-a.jsonl"), awEntry(0, "new") + "\n");
  appendFileSync(join(proj, "big.jsonl"), ccLine(50000) + "\n");
  const before = { aw: journal("host~aw"), cc: journal("host~cc.big") };
  const pass = run(HEAP_MB);
  assert.equal(pass.status, 0, `the pass died: ${pass.signal ?? ""} ${pass.stderr.slice(-600)}`);
  assert.ok(journal("host~aw") > before.aw, "the new message was captured");
  assert.ok(journal("host~cc.big") > before.cc, "the new session line was captured");

  // And it deduplicates as before: the same pass again appends nothing.
  const after = { aw: journal("host~aw"), cc: journal("host~cc.big") };
  appendFileSync(join(logs, "acme-b.jsonl"), "\n"); // a changed file whose entries are all known
  const again = run(HEAP_MB);
  assert.equal(again.status, 0, again.stderr.slice(-600));
  assert.equal(journal("host~aw"), after.aw, "nothing known was appended twice");
  assert.equal(journal("host~cc.big"), after.cc);

  // The session offsets are derived state: lost, the pass rebuilds them from the journal, also in bounded memory.
  rmSync(join(root, "index", "capture-offsets.json"), { force: true });
  appendFileSync(join(proj, "big.jsonl"), ccLine(50001) + "\n");
  const rebuilt = run(HEAP_MB);
  assert.equal(rebuilt.status, 0, `the pass died: ${rebuilt.signal ?? ""} ${rebuilt.stderr.slice(-600)}`);
  assert.ok(journal("host~cc.big") > after.cc, "the line after the rebuilt offset was captured");

  // A session first seen after a long gap (the host job was off for weeks): its whole backlog in one pass.
  const late = join(home, ".claude", "projects", "-late");
  mkdirSync(late, { recursive: true });
  await writeLines(join(late, "late.jsonl"), 50000, ccLine);
  const backlog = run(HEAP_MB);
  assert.equal(backlog.status, 0, `the pass died: ${backlog.signal ?? ""} ${backlog.stderr.slice(-600)}`);
  assert.ok(journal("host~cc.late") > HEAP_MB * 1024 * 1024, "the late session's backlog was captured");
});
