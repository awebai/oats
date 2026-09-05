// oats okf harvest with no pending notes: the record path (aweb-abfz).
// The kernel is a fake OATS_CLI_BIN that answers `capture --home` with a
// canned session report and records what `spawn` was asked to do, so the
// test pins the package's own logic: when to skip, what the briefing names,
// and that the watermark suppresses a second harvest of the same window.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const OKF_BIN = resolve(new URL("../capabilities/oats-okf/bin/oats-okf.mjs", import.meta.url).pathname);

function write(path, content) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }

function deployment(base, { sessions, spawnLog }) {
  const repo = join(base, "repo"); mkdirSync(repo, { recursive: true });
  const root = join(repo, "agents");
  const home = join(root, "dev", "instances", "dev-1");
  mkdirSync(join(home, "work"), { recursive: true });
  mkdirSync(join(home, "notes"), { recursive: true });
  write(join(root, "dev", "soul", "AGENTS.md"), "soul\n");
  write(join(home, "instance.json"), JSON.stringify({ instance: "dev-1", agent: "dev", repo, work: "worktree" }));
  const fake = join(base, "fake-oats.mjs");
  write(fake, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "capture") {
  process.stdout.write(readFileSync(${JSON.stringify(join(base, "capture.json"))}, "utf8"));
} else if (cmd === "recall") {
  // ids-only window sizing: turns t1..tN for the thread, each with a byte size
  const thread = rest[rest.indexOf("--thread") + 1];
  const limit = Number(rest[rest.indexOf("--limit") + 1] || 1e9);
  const after = rest.includes("--after") ? rest[rest.indexOf("--after") + 1] : null;
  const sessions = JSON.parse(readFileSync(${JSON.stringify(join(base, "capture.json"))}, "utf8")).sessions;
  const total = sessions.find((s) => s.thread === thread).turns;
  const bytesOf = (i) => (thread.startsWith("codex") ? 900_000 : 1000);
  const all = Array.from({ length: total }, (_, i) => ({ id: "t" + (i + 1), ts: "", bytes: bytesOf(i) }));
  const start = after ? all.findIndex((t) => t.id === after) + 1 : 0;
  if (after && start === 0) { process.stderr.write("--after: no turn " + after); process.exit(1); }
  const turns = all.slice(start, start + limit);
  process.stdout.write(JSON.stringify({ thread, total, from: start, to: start + turns.length, remaining: all.length - start - turns.length, turns }));
} else if (cmd === "spawn") {
  const i = rest.indexOf("--task-file");
  writeFileSync(${JSON.stringify(spawnLog)}, JSON.stringify({ args: rest, task: readFileSync(rest[i + 1], "utf8") }));
  process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: true, result: { instance: "memory-harvest-dev-1", tmux: { window: "memory-harvest-dev-1" } } }));
} else { process.stderr.write("unexpected " + cmd); process.exit(2); }
`);
  chmodSync(fake, 0o755);
  write(join(base, "capture.json"), JSON.stringify({ home, owner: "mac", appended: 0, sessions }));
  return { repo, root, home, fake, soul: join(root, "dev", "soul") };
}

function harvest(d, extra = []) {
  const r = spawnSync(process.execPath, [OKF_BIN, "harvest", "--json", ...extra], {
    cwd: d.home, encoding: "utf8",
    env: { ...process.env, OATS_HOME: d.home, OATS_INSTANCE: "dev-1", OATS_AGENT: "dev", OATS_SOUL: d.soul, OATS_CONTEXT: d.repo, OATS_ROOT: d.root, OATS_CLI_BIN: d.fake, OATS_SETTINGS: JSON.stringify({ "harvest-model": "test/model" }) },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return JSON.parse(r.stdout.trim());
}

test("okf harvest: no notes but new record turns → the harvester is briefed with exact id windows and the watermark to write on delivery; the watermark then suppresses a repeat", () => {
  const base = mkdtempSync(join(tmpdir(), "okf-record-"));
  const spawnLog = join(base, "spawn.json");
  const sessions = [
    { thread: "cc:session:s1", source: "cc", sessionId: "s1", stream: "mac~cc.s1", turns: 12, firstTurnId: "t1", lastTurnId: "t12", lastTs: "2026-09-05T10:00:00Z" },
  ];
  const d = deployment(base, { sessions, spawnLog });
  try {
    const first = harvest(d);
    assert.equal(first.result.harvest, "spawned", JSON.stringify(first));
    assert.deepEqual(first.result.record, { threads: ["cc:session:s1"] });
    const log = JSON.parse(readFileSync(spawnLog, "utf8"));
    assert.equal(log.args[0], "memory-harvest");
    assert.match(log.task, /Source notes: none pending/);
    assert.match(log.task, /RECORD-FED CANDIDATES/);
    assert.match(log.task, new RegExp(`${d.fake} recall --thread cc:session:s1 --json --until t12`), "first harvest has no --after: the whole (small) thread is the window");
    const wmPath = join(d.home, ".okf-harvest-record.json");
    const nextPath = join(d.home, ".okf-harvest-record.next.json");
    assert.ok(log.task.includes(`mv ${nextPath} ${wmPath}`), "delivery advances the watermark by one rename, nothing retyped");
    const wm = JSON.parse(readFileSync(nextPath, "utf8"));
    assert.equal(wm.threads["cc:session:s1"].untilTurnId, "t12");
    assert.equal(wm.threads["cc:session:s1"].turns, 12);
    assert.equal(existsSync(wmPath), false, "the package never writes the watermark itself; the harvester renames the prepared one");
    assert.match(log.task, /whether or not anything was promoted/, "a completed judgement that promotes nothing still advances the watermark");
    assert.match(log.task, /could not read completely is a failed harvest/, "an unread window never advances it");
    assert.match(log.task, /rejected .*run it again without --after/, "a pruned boundary has a stated fallback");
    assert.match(log.task, /Then run `oats retire memory-harvest-dev-1 --self`|Commit if you changed anything .*then run `oats retire memory-harvest-dev-1 --self`/);

    // The harvester delivered and renamed the watermark: the same window is not harvested again.
    writeFileSync(wmPath, JSON.stringify(wm)); rmSync(nextPath);
    rmSync(spawnLog, { force: true });
    const second = harvest(d);
    assert.deepEqual(second.result, { harvest: "skipped", reason: "no pending notes" });
    assert.equal(existsSync(spawnLog), false, "nothing was spawned");

    // A harvester already running for this instance: no capture pass is run,
    // so calling the harvest "too often" stays cheap and safe.
    rmSync(spawnLog, { force: true });
    const captureLog = join(base, "capture-calls.log");
    writeFileSync(join(base, "fake-oats.mjs"), readFileSync(join(base, "fake-oats.mjs"), "utf8").replace('if (cmd === "capture") {', `if (cmd === "capture") { require("node:fs").appendFileSync(${JSON.stringify(captureLog)}, "capture\\n");`).replace("#!/usr/bin/env node", "#!/usr/bin/env node\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"));
    const running = join(d.root, "local-agents", "memory-harvest", "instances", "memory-harvest-dev-1");
    mkdirSync(running, { recursive: true });
    rmSync(wmPath); // there IS something new, but the debounce comes first
    const busy = harvest(d);
    assert.deepEqual(busy.result, { harvest: "skipped", reason: "harvester already running for this instance" });
    assert.equal(existsSync(captureLog), false, "no capture pass behind a skip");
    rmSync(running, { recursive: true, force: true });
    writeFileSync(wmPath, JSON.stringify(wm));

    // The session grew: only the new tail is the window, bounded on both ends.
    sessions[0].turns = 15; sessions[0].lastTurnId = "t15";
    writeFileSync(join(base, "capture.json"), JSON.stringify({ home: d.home, owner: "mac", appended: 3, sessions }));
    const third = harvest(d);
    assert.equal(third.result.harvest, "spawned");
    const log3 = JSON.parse(readFileSync(spawnLog, "utf8"));
    assert.match(log3.task, /recall --thread cc:session:s1 --json --after t12 --until t15/);
    assert.match(log3.task, /cc:session:s1 \(3 turns, ~3 KB\)/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("okf harvest: notes take precedence and the record is not consulted unless --from-record; an unavailable record with no notes is a plain skip", () => {
  const base = mkdtempSync(join(tmpdir(), "okf-record-"));
  const spawnLog = join(base, "spawn.json");
  const d = deployment(base, { sessions: [{ thread: "pi:session:p1", source: "pi", sessionId: "p1", stream: "mac~pi.p1", turns: 4, firstTurnId: "a", lastTurnId: "d", lastTs: "" }], spawnLog });
  try {
    write(join(d.home, "notes", "one.md"), "# a note\n");
    const withNotes = harvest(d);
    assert.equal(withNotes.result.harvest, "spawned");
    assert.equal(withNotes.result.record, undefined, "notes alone: no record block");
    const log = JSON.parse(readFileSync(spawnLog, "utf8"));
    assert.doesNotMatch(log.task, /RECORD-FED/);
    assert.match(log.task, /Source notes: .*one\.md/);

    const both = harvest(d, ["--from-record"]);
    assert.deepEqual(both.result.record, { threads: ["pi:session:p1"] });
    const log2 = JSON.parse(readFileSync(spawnLog, "utf8"));
    assert.match(log2.task, /Source notes: .*one\.md/);
    assert.match(log2.task, /recall --thread pi:session:p1 --json --until t4`/);

    // Record unavailable (the fake refuses), no notes: the old answer, unchanged.
    rmSync(join(d.home, "notes", "one.md"));
    rmSync(join(base, "capture.json"));
    const r = harvest(d);
    assert.deepEqual(r.result, { harvest: "skipped", reason: "no pending notes" });
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("okf harvest: a long backlog is drained in bounded windows, by turns and by bytes, each with a truthful watermark", () => {
  const base = mkdtempSync(join(tmpdir(), "okf-record-"));
  const spawnLog = join(base, "spawn.json");
  const sessions = [
    { thread: "cc:session:long", source: "cc", sessionId: "long", stream: "mac~cc.long", turns: 1000, firstTurnId: "t1", lastTurnId: "t1000", lastTs: "" },
    { thread: "codex:session:fat", source: "codex", sessionId: "fat", stream: "mac~codex.fat", turns: 5, firstTurnId: "t1", lastTurnId: "t5", lastTs: "" },
  ];
  const d = deployment(base, { sessions, spawnLog });
  try {
    const first = harvest(d);
    assert.equal(first.result.harvest, "spawned");
    const log = JSON.parse(readFileSync(spawnLog, "utf8"));
    // turn cap: 300 of 1000, the rest announced for later harvests
    assert.match(log.task, /recall --thread cc:session:long --json --until t300`/);
    assert.match(log.task, /cc:session:long \(300 turns, ~293 KB, 700 more wait for the next harvest\)/);
    // byte cap: 900 KB per turn, 1.5 MB window → one turn only
    assert.match(log.task, /recall --thread codex:session:fat --json --until t1`/);
    const next = JSON.parse(readFileSync(join(d.home, ".okf-harvest-record.next.json"), "utf8"));
    assert.equal(next.threads["cc:session:long"].untilTurnId, "t300");
    assert.equal(next.threads["cc:session:long"].turns, 300);
    assert.equal(next.threads["codex:session:fat"].untilTurnId, "t1");
    // the harvester delivers: rename; the next harvest continues exactly after the boundary
    writeFileSync(join(d.home, ".okf-harvest-record.json"), JSON.stringify(next));
    const second = harvest(d);
    assert.equal(second.result.harvest, "spawned");
    const log2 = JSON.parse(readFileSync(spawnLog, "utf8"));
    assert.match(log2.task, /recall --thread cc:session:long --json --after t300 --until t600`/);
    assert.match(log2.task, /recall --thread codex:session:fat --json --after t1 --until t2`/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
