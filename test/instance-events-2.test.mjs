// K7b — `instance-events-2`: the event read is bounded, addressed, incarnation-aware, and its integrity is reported independently of the window.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, symlinkSync, rmSync, openSync, writeSync, closeSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readEvents, appendEvent, EVENTS_API } from "../lib/instance-events.mjs";

const CLI = fileURLToPath(new URL("../bin/oats.mjs", import.meta.url));
function ws(t) {
  const base = mkdtempSync(join(tmpdir(), "k7b-")); t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "agents"); const home = join(root, "dev", "instances", "dev-1");
  mkdirSync(join(root, "dev", "soul"), { recursive: true }); writeFileSync(join(root, "dev", "soul", "soul.yaml"), "name: dev\n");
  const incarnate = (createdAt) => { mkdirSync(home, { recursive: true }); writeFileSync(join(home, "instance.json"), JSON.stringify({ agent: "dev", instance: "dev-1", createdAt })); };
  return { base, root, home, incarnate, wsLog: join(base, ".agents", "events", "dev--dev-1.jsonl") };
}

test("A — the byte limit is an I/O bound: a source is lstat'ed first, a non-regular file is REFUSED unopened, an oversize file is read as a 4 MiB TAIL and reported", (t) => {
  const w = ws(t); w.incarnate("2026-01-01T00:00:00.000Z");
  // symlink source → refused, never followed
  writeFileSync(join(w.base, "elsewhere.jsonl"), JSON.stringify({ eventsApi: 2, at: "2026-01-01T00:00:01.000Z", instance: "dev-1", home: w.home, kind: "launched", producer: "kernel" }) + "\n");
  symlinkSync(join(w.base, "elsewhere.jsonl"), join(w.home, ".oats-events.jsonl"));
  let r = readEvents(w.home);
  assert.equal(r.events.length, 0); assert.deepEqual(r.integrity.sources[0], { path: "home", status: "refused", bytes: 0 }); assert.equal(r.integrity.sources[1].status, "absent");
  rmSync(join(w.home, ".oats-events.jsonl"));
  // oversize regular file → tail only
  const fd = openSync(join(w.home, ".oats-events.jsonl"), "w");
  // distinct rows (dedup is by facts): ~5 MiB of them, so only the last 4 MiB is read
  let written = 0, i = 0;
  while (written < 5 * 1024 * 1024) { const line = JSON.stringify({ eventsApi: 2, at: `2026-01-01T00:00:00.${String(i++ % 1000).padStart(3, "0")}Z`, instance: "dev-1", home: w.home, kind: "spawned", producer: "kernel", data: { i, pad: "x".repeat(200) } }) + "\n"; writeSync(fd, line); written += Buffer.byteLength(line); }
  writeSync(fd, JSON.stringify({ eventsApi: 2, at: "2026-01-01T00:00:02.000Z", instance: "dev-1", home: w.home, kind: "stopped", producer: "kernel" }) + "\n"); closeSync(fd);
  r = readEvents(w.home, { limit: 5 });
  assert.equal(r.integrity.sources[0].status, "tail"); assert.ok(r.integrity.sources[0].bytes > 4 * 1024 * 1024); assert.equal(r.truncated, true);
  assert.equal(r.lastEvent.kind, "stopped", "the newest row (at the end of the tail) is present"); assert.equal(r.integrity.unreadableRows, 0, "the partial first line of a tail is dropped, not counted as torn");
  assert.equal(r.returned, 5);
});

test("B — address history: foreign rows are dropped and counted; --home must be a home of THIS name (E_HOME_MISMATCH); a recreated same-address instance sees earlier rows tagged with their incarnation", (t) => {
  const w = ws(t); w.incarnate("2026-01-01T00:00:00.000Z");
  appendEvent(w.home, { kind: "spawned", data: { agent: "dev" } });
  appendFileSync(join(w.home, ".oats-events.jsonl"), JSON.stringify({ eventsApi: 2, at: "2026-01-01T00:00:05.000Z", instance: "dev-2", home: join(w.root, "dev", "instances", "dev-2"), kind: "launched", producer: "kernel" }) + "\n");
  let r = readEvents(w.home);
  assert.equal(r.integrity.foreignRows, 1); assert.deepEqual(r.events.map((e) => e.kind), ["spawned"]); assert.equal(r.incarnation, "2026-01-01T00:00:00.000Z"); assert.equal(r.events[0].incarnation, "2026-01-01T00:00:00.000Z");
  // reincarnation at the same address
  rmSync(w.home, { recursive: true }); w.incarnate("2026-02-01T00:00:00.000Z");
  appendEvent(w.home, { kind: "spawned", data: { agent: "dev" } });
  r = readEvents(w.home);
  assert.equal(r.incarnation, "2026-02-01T00:00:00.000Z");
  const incs = r.events.map((e) => e.incarnation); assert.ok(incs.includes("2026-01-01T00:00:00.000Z") && incs.includes("2026-02-01T00:00:00.000Z"), JSON.stringify(incs));
  assert.equal(r.events.filter((e) => e.incarnation !== r.incarnation).length, 1, "the earlier incarnation's row is visible AS earlier");
  // CLI: --home is checked against the name
  const bad = spawnSync(process.execPath, [CLI, "instance", "events", "dev-1", "--dir", w.base, "--agents-root", w.root, "--home", join(w.root, "dev", "instances", "dev-2"), "--json"], { encoding: "utf8", env: { ...process.env, OATS_TMUX_SESSION: "none" } });
  assert.equal(JSON.parse(bad.stdout.trim().split("\n").pop()).error.code, "E_HOME_MISMATCH", bad.stdout + bad.stderr);
  const ok = spawnSync(process.execPath, [CLI, "instance", "events", "dev-1", "--dir", w.base, "--agents-root", w.root, "--home", w.home, "--json"], { encoding: "utf8", env: { ...process.env, OATS_TMUX_SESSION: "none" } });
  const doc = JSON.parse(ok.stdout.trim().split("\n").pop()); assert.equal(doc.ok, true, ok.stdout + ok.stderr); assert.equal(doc.result.eventsApi, EVENTS_API); assert.equal(doc.result.home, w.home);
});

test("C — waitingOnYou is a producer STATE for the current incarnation: an explicit false clears, a later row without the field does not, an earlier incarnation's positive never counts, and it is computed over the full read (a window cannot hide a clear)", (t) => {
  const w = ws(t); w.incarnate("2026-01-01T00:00:00.000Z");
  appendEvent(w.home, { kind: "launched", producer: "provider.a", data: { waitingOnYou: true, reason: "review requested" } });
  let r = readEvents(w.home); assert.equal(r.waitingOnYou.producer, "provider.a"); assert.equal(r.waitingOnYou.reason, "review requested");
  appendEvent(w.home, { kind: "recomposed", producer: "provider.a", data: {} });
  r = readEvents(w.home); assert.ok(r.waitingOnYou, "a row without the field does not clear");
  appendEvent(w.home, { kind: "launched", producer: "provider.b", data: { waitingOnYou: true, reason: "b wants you" } });
  r = readEvents(w.home); assert.equal(r.waitingOnYou.producer, "provider.b", "newest positive across producers"); assert.equal(r.waitingClaims.length, 2);
  appendEvent(w.home, { kind: "launched", producer: "provider.b", data: { waitingOnYou: false } });
  r = readEvents(w.home); assert.equal(r.waitingOnYou.producer, "provider.a", "b cleared; a's claim stands"); assert.deepEqual(r.waitingClaims.find((c) => c.producer === "provider.b").waiting, false);
  appendEvent(w.home, { kind: "launched", producer: "provider.a", data: { waitingOnYou: false } });
  for (let i = 0; i < 3; i++) appendEvent(w.home, { kind: "recomposed", producer: "kernel", data: {} });
  r = readEvents(w.home, { limit: 2 }); assert.equal(r.waitingOnYou, null, "cleared — and the clear is honoured even though the window does not include it");
  // an earlier incarnation's positive does not survive reincarnation
  appendEvent(w.home, { kind: "launched", producer: "provider.a", data: { waitingOnYou: true } });
  rmSync(w.home, { recursive: true }); w.incarnate("2026-02-01T00:00:00.000Z");
  r = readEvents(w.home); assert.equal(r.waitingOnYou, null); assert.deepEqual(r.waitingClaims, []);
  assert.ok(r.events.some((e) => e.data?.waitingOnYou === true && e.incarnation === "2026-01-01T00:00:00.000Z"), "…but the row is still visible as history of the address");
});

test("D — provenance and corruption never disappear: same facts from two producers are two rows; torn lines are counted regardless of --since or the window; count/returned/truncated are consistent", (t) => {
  const w = ws(t); w.incarnate("2026-01-01T00:00:00.000Z");
  const at = "2026-01-01T00:00:01.000Z";
  for (const p of ["provider.a", "provider.b"]) appendFileSync(join(w.home, ".oats-events.jsonl"), JSON.stringify({ eventsApi: 2, at, instance: "dev-1", home: w.home, incarnation: "2026-01-01T00:00:00.000Z", producer: p, kind: "launched", data: { x: 1 } }) + "\n");
  appendFileSync(join(w.home, ".oats-events.jsonl"), '{"eventsApi":2,"at":"2026-01-01T00:00:00.100Z","instance":"dev-1","kind":"spa\n'); // torn
  appendFileSync(join(w.home, ".oats-events.jsonl"), JSON.stringify({ eventsApi: 2, instance: "dev-1", home: w.home, kind: "stopped" }) + "\n"); // no `at` → unreadable, not silently sorted first
  let r = readEvents(w.home);
  assert.equal(r.events.length, 2, "two producers, two rows"); assert.equal(r.integrity.unreadableRows, 2); assert.equal(r.count, 2); assert.equal(r.returned, 2); assert.equal(r.truncated, false);
  r = readEvents(w.home, { since: "2026-01-01T00:00:02.000Z" });
  assert.equal(r.count, 0); assert.equal(r.returned, 0); assert.equal(r.integrity.unreadableRows, 2, "corruption is reported even when since filters every row"); assert.equal(r.lastEvent, null);
  r = readEvents(w.home, { limit: 1 }); assert.equal(r.returned, 1); assert.equal(r.count, 2); assert.equal(r.truncated, true);
  // Observed-empty is distinguishable from absent sources.
  const e = ws(t); e.incarnate("2026-01-01T00:00:00.000Z"); const empty = readEvents(e.home);
  assert.deepEqual(empty.integrity, { unreadableRows: 0, foreignRows: 0, sources: [{ path: "home", status: "absent", bytes: 0 }, { path: "workspace", status: "absent", bytes: 0 }] }); assert.equal(empty.count, 0);
});
