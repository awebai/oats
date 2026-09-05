// sessionsForHome: an instance's own sessions are the files whose recorded
// cwd is the home or below it, on canonical paths; nothing else is swept in.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { sessionCwd, sessionsForHome } from "../lib/sessions-for-home.mjs";
import { CODEX_LINES, CODEX_UUID, PI_LINES, PI_UUID, jsonl } from "./format-fixtures.mjs";

function setup(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "turn-record-home-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return base;
}

function ccLines(cwd, sessionId) {
  return jsonl([
    { type: "file-history-snapshot", messageId: "m0", snapshot: { x: "y".repeat(100) } },
    { type: "user", cwd, sessionId, timestamp: "2026-09-05T10:00:00Z", message: { role: "user", content: [{ type: "text", text: "hello from " + cwd }] } },
    { type: "assistant", cwd, sessionId, timestamp: "2026-09-05T10:00:05Z", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
  ]);
}

function withCwd(lines, mutate) {
  return lines.map((l) => { const c = JSON.parse(JSON.stringify(l)); mutate(c); return c; });
}

test("sessionsForHome: exact and descendant cwd match; parent, sibling and unrelated do not", (t) => {
  const base = setup(t);
  const workspace = join(base, "ws");
  const home = join(workspace, "agents", "dev", "instances", "dev-1");
  const sibling = join(workspace, "agents", "dev", "instances", "dev-10"); // shares the prefix, not a descendant
  for (const d of [join(home, "work"), sibling]) mkdirSync(d, { recursive: true });
  const roots = { cc: [join(base, "cc")], pi: [join(base, "pi")], codex: [join(base, "codex")] };
  for (const r of Object.values(roots)) mkdirSync(r[0], { recursive: true });
  const cc = (name, cwd, id) => { const d = join(roots.cc[0], name); mkdirSync(d); writeFileSync(join(d, `${id}.jsonl`), ccLines(cwd, id)); };
  cc("-home", home, "cc-home");
  cc("-home-work", join(home, "work"), "cc-work");
  cc("-ws", workspace, "cc-parent");
  cc("-dev-10", sibling, "cc-sibling");
  cc("-elsewhere", join(base, "elsewhere"), "cc-other");
  const pi = (dir, cwd, id) => { const d = join(roots.pi[0], dir); mkdirSync(d); writeFileSync(join(d, `2026-09-05T10-00-00-000Z_${id}.jsonl`), jsonl(withCwd(PI_LINES, (c) => { if (c.type === "session") { c.cwd = cwd; c.id = id; } }))); };
  pi("a", home, PI_UUID);
  pi("b", workspace, "11111111-2222-4333-8444-555555555555");
  const codexDir = join(roots.codex[0], "2026", "09", "05"); mkdirSync(codexDir, { recursive: true });
  writeFileSync(join(codexDir, `rollout-2026-09-05T10-00-00-${CODEX_UUID}.jsonl`), jsonl(withCwd(CODEX_LINES, (c) => { if (c.type === "session_meta") c.payload.cwd = home; })));
  writeFileSync(join(codexDir, `rollout-2026-09-05T11-00-00-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jsonl`), jsonl(withCwd(CODEX_LINES, (c) => { if (c.type === "session_meta") { c.payload.cwd = sibling; c.payload.id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"; } })));

  const found = sessionsForHome(home, { roots });
  assert.deepEqual(found.map((s) => s.thread).sort(), [
    "cc:session:cc-home", "cc:session:cc-work", `codex:session:${CODEX_UUID}`, `pi:session:${PI_UUID}`,
  ]);
  for (const s of found) assert.equal(s.cwd === home || s.cwd.startsWith(home + "/"), true, s.cwd);
});

test("sessionsForHome: the home is compared canonically, so a symlinked home path finds sessions recorded under the real one", (t) => {
  const base = setup(t);
  const real = join(base, "real-home"); mkdirSync(real);
  const link = join(base, "linked-home"); symlinkSync(real, link);
  const roots = { cc: [join(base, "cc")], pi: [join(base, "nope")], codex: [join(base, "nope")] };
  const d = join(roots.cc[0], "-real-home"); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "s.jsonl"), ccLines(real, "s"));
  assert.deepEqual(sessionsForHome(link, { roots }).map((s) => s.sessionId), ["s"]);
  assert.deepEqual(sessionsForHome(real, { roots }).map((s) => s.sessionId), ["s"]);
});

test("sessionCwd: a first line larger than 64 KB and a cwd past 100 KB of bookkeeping are both found; the scan bound is respected", (t) => {
  const base = setup(t);
  const home = join(base, "home");
  const big = join(base, "big.jsonl");
  const huge = JSON.stringify({ type: "queue-operation", payload: "x".repeat(95_000) });
  writeFileSync(big, huge + "\n" + ccLines(home, "big"));
  assert.equal(sessionCwd("cc", big), home, "a 95 KB first line does not hide the cwd behind it");
  const late = join(base, "late.jsonl");
  const bookkeeping = Array.from({ length: 30 }, (_, i) => JSON.stringify({ type: "file-history-snapshot", i, snapshot: "y".repeat(4_000) })).join("\n");
  writeFileSync(late, bookkeeping + "\n" + ccLines(home, "late"));
  assert.equal(sessionCwd("cc", late), home, "the first cwd-bearing line at ~120 KB is found");
  assert.equal(sessionCwd("cc", late, { bound: 64 * 1024 }), undefined, "and a tighter bound reports it as unattributed rather than guessing");
  // A multi-byte character straddling a chunk boundary does not corrupt the line that carries the cwd.
  const straddle = join(base, "straddle.jsonl");
  const pad = JSON.stringify({ type: "note", text: "é".repeat(32_770) }); // 2-byte chars across the 64 KB edge
  writeFileSync(straddle, pad + "\n" + ccLines(home, "straddle"));
  assert.equal(sessionCwd("cc", straddle), home);
  // The unattributed hook fires for a file with no cwd within the bound.
  const roots = { cc: [join(base, "cc")], pi: [join(base, "nope")], codex: [join(base, "nope")] };
  const d = join(roots.cc[0], "-x"); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "nocwd.jsonl"), JSON.stringify({ type: "summary" }) + "\n");
  writeFileSync(join(d, "ok.jsonl"), ccLines(home, "ok"));
  const seen = [];
  const found = sessionsForHome(home, { roots, onUnattributed: (source, path) => seen.push(`${source}:${path.split("/").pop()}`) });
  assert.deepEqual(found.map((s) => s.sessionId), ["ok"]);
  assert.deepEqual(seen, ["cc:nocwd.jsonl"]);
});

test("sessionCwd: a file whose head carries no cwd is not attributed to anyone", (t) => {
  const base = setup(t);
  const p = join(base, "x.jsonl");
  writeFileSync(p, "not json at all\n" + JSON.stringify({ type: "summary" }) + "\n");
  assert.equal(sessionCwd("cc", p), undefined);
  assert.equal(sessionCwd("pi", p), undefined);
  assert.equal(sessionCwd("codex", p), undefined);
});
