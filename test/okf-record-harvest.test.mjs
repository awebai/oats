// oats okf harvest with no pending notes: the record path (aweb-abfz).
// The kernel is a fake OATS_CLI_BIN that answers `capture --home` with a
// canned session report and records what `spawn` was asked to do, so the
// test pins the package's own logic: when to skip, what the briefing names,
// and that the watermark suppresses a second harvest of the same window.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const OKF_BIN = resolve(new URL("../capabilities/oats-okf/bin/oats-okf.mjs", import.meta.url).pathname);

function write(path, content) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }

function deployment(base, { sessions, spawnLog, work = "worktree", gitRepo = false }) {
  const repo = join(base, "repo"); mkdirSync(repo, { recursive: true });
  const root = join(repo, "agents");
  const home = join(root, "dev", "instances", "dev-1");
  mkdirSync(join(home, "work"), { recursive: true });
  mkdirSync(join(home, "notes"), { recursive: true });
  write(join(root, "dev", "soul", "AGENTS.md"), "soul\n");
  if (gitRepo) { execFileSync("git", ["init", "-q", repo]); execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "add", "-A"]); execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "init"]); }
  write(join(home, "instance.json"), JSON.stringify({ instance: "dev-1", agent: "dev", repo, work }));
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
  const bytesOf = (i) => (thread.startsWith("codex") ? 60_000 : 1000);
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

function harvest(d, extra = [], { work, settings = { "harvest-model": "test/model" }, status = 0 } = {}) {
  const r = spawnSync(process.execPath, [OKF_BIN, "harvest", "--json", ...extra], {
    cwd: d.home, encoding: "utf8",
    env: { ...process.env, OATS_HOME: d.home, OATS_INSTANCE: "dev-1", OATS_AGENT: "dev", OATS_SOUL: d.soul, OATS_CONTEXT: d.repo, OATS_ROOT: d.root, OATS_CLI_BIN: d.fake, OATS_SETTINGS: JSON.stringify(settings), ...(work ? { OATS_WORK: work } : {}) },
  });
  assert.equal(r.status, status, r.stderr + r.stdout);
  const doc = JSON.parse(r.stdout.trim());
  doc.stderr = r.stderr;
  return doc;
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
    assert.match(log.task, new RegExp(`${d.fake} recall --thread 'cc:session:s1' --json --until 't12'`), "first harvest has no --after: the whole (small) thread is the window");
    const wmPath = join(d.home, ".okf-harvest-record.json");
    const nextPath = join(d.home, ".okf-harvest-record.next.json");
    assert.ok(log.task.includes(`mv '${nextPath}' '${wmPath}'`), "delivery advances the watermark by one rename, nothing retyped");
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
    assert.match(log3.task, /recall --thread 'cc:session:s1' --json --after 't12' --until 't15'/);
    assert.match(log3.task, /cc:session:s1 \(3 turns, ~3 KB of JSON\)/);
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
    assert.match(log2.task, /recall --thread 'pi:session:p1' --json --until 't4'`/);

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
    // turn cap: 60 of 1000, the rest announced for later harvests
    assert.match(log.task, /recall --thread 'cc:session:long' --json --until 't60'`/);
    assert.match(log.task, /cc:session:long \(60 turns, ~59 KB of JSON, 940 more wait for the next harvest\)/);
    // byte cap: 60 KB per turn, 96 KB window → one turn only
    assert.match(log.task, /recall --thread 'codex:session:fat' --json --until 't1'`/);
    assert.match(log.task, /redirect the command's output to a file/);
    const next = JSON.parse(readFileSync(join(d.home, ".okf-harvest-record.next.json"), "utf8"));
    assert.equal(next.threads["cc:session:long"].untilTurnId, "t60");
    assert.equal(next.threads["cc:session:long"].turns, 60);
    assert.equal(next.threads["codex:session:fat"].untilTurnId, "t1");
    // the harvester delivers: rename; the next harvest continues exactly after the boundary
    writeFileSync(join(d.home, ".okf-harvest-record.json"), JSON.stringify(next));
    const second = harvest(d);
    assert.equal(second.result.harvest, "spawned");
    const log2 = JSON.parse(readFileSync(spawnLog, "utf8"));
    assert.match(log2.task, /recall --thread 'cc:session:long' --json --after 't60' --until 't120'`/);
    assert.match(log2.task, /recall --thread 'codex:session:fat' --json --after 't1' --until 't2'`/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("okf harvest: a watermark whose boundary turn left the thread replans from the start, audibly, instead of stranding the thread", () => {
  const base = mkdtempSync(join(tmpdir(), "okf-record-"));
  const spawnLog = join(base, "spawn.json");
  const sessions = [{ thread: "cc:session:s1", source: "cc", sessionId: "s1", stream: "mac~cc.s1", turns: 20, firstTurnId: "t1", lastTurnId: "t20", lastTs: "" }];
  const d = deployment(base, { sessions, spawnLog });
  try {
    // The recorded boundary was redacted since: recall no longer knows it.
    writeFileSync(join(d.home, ".okf-harvest-record.json"), JSON.stringify({ threads: { "cc:session:s1": { untilTurnId: "gone", turns: 12 } } }));
    const r = harvest(d);
    assert.equal(r.result.harvest, "spawned", "the thread is not dropped");
    assert.deepEqual(r.result.record.threads, ["cc:session:s1"]);
    assert.match(r.result.record.problems.join("\n"), /boundary gone is no longer in the thread/);
    assert.match(r.stderr, /oats-okf: record: cc:session:s1: the harvested boundary gone is no longer in the thread/, "one stderr line in every mode, not only in the envelope");
    const log = JSON.parse(readFileSync(spawnLog, "utf8"));
    assert.match(log.task, /recall --thread 'cc:session:s1' --json --until 't20'`/, "read from the start again, no --after");
    const next = JSON.parse(readFileSync(join(d.home, ".okf-harvest-record.next.json"), "utf8"));
    assert.equal(next.threads["cc:session:s1"].untilTurnId, "t20");
    assert.equal(next.threads["cc:session:s1"].turns, 20, "the count restarts with the read");
    assert.match(log.task, /--until id is rejected, this harvest has failed/);
    assert.match(log.task, /mv '.*\.okf-harvest-record\.next\.json' '.*\.okf-harvest-record\.json'/, "the rename is quoted");
    // Redaction inside the harvested prefix lowers the count but not the boundary: nothing new is claimed and nothing is re-read.
    writeFileSync(join(d.home, ".okf-harvest-record.json"), JSON.stringify(next)); rmSync(join(d.home, ".okf-harvest-record.next.json"));
    sessions[0].turns = 18; // two old turns hidden, same tail
    writeFileSync(join(base, "capture.json"), JSON.stringify({ home: d.home, owner: "mac", appended: 0, sessions }));
    assert.deepEqual(harvest(d).result, { harvest: "skipped", reason: "no pending notes" });
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("okf harvest: the workspace-mode briefing makes commit, push and PR conditional and puts the record windows before delivery", () => {
  const base = mkdtempSync(join(tmpdir(), "okf-record-"));
  const spawnLog = join(base, "spawn.json");
  const sessions = [{ thread: "pi:session:w", source: "pi", sessionId: "w", stream: "mac~pi.w", turns: 3, firstTurnId: "t1", lastTurnId: "t3", lastTs: "" }];
  const d = deployment(base, { sessions, spawnLog, work: "workspace", gitRepo: true });
  try {
    const r = harvest(d, [], { work: "workspace" });
    assert.equal(r.result.harvest, "spawned", JSON.stringify(r));
    const log = JSON.parse(readFileSync(spawnLog, "utf8"));
    assert.match(log.task, /WORKSPACE-MODE/);
    assert.match(log.task, /commit once \(prefixed "memory-harvest:"\) if anything changed/);
    assert.match(log.task, /If you changed anything: push the branch and open a PR/);
    assert.match(log.task, /promoted nothing has nothing to commit, push or open; that is a completed harvest, not a failed one/);
    assert.ok(log.task.indexOf("RECORD-FED CANDIDATES") < log.task.indexOf("If you changed anything: push"), "windows are read before delivery is described");
    assert.match(log.task, /Finally run `oats retire memory-harvest-dev-1 --self`/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("okf harvest: runtime and model selection reach the spawn boundary in every work mode", () => {
  const base = mkdtempSync(join(tmpdir(), "okf-runtime-"));
  const cases = [
    { kind: "repo", settings: {}, runtime: "pi", model: "github-copilot/gpt-5.5" },
    { kind: "repo", settings: { "harvest-runtime": "pi", "harvest-model": "openai-codex/gpt-5.5" }, runtime: "pi", model: "openai-codex/gpt-5.5" },
    { kind: "local", settings: { "harvest-runtime": "claude" }, runtime: "claude" },
    { kind: "workspace", settings: { "harvest-runtime": "codex" }, runtime: "codex" },
    { kind: "repo", settings: { "harvest-runtime": "claude", "harvest-model": "sonnet" }, runtime: "claude", model: "sonnet" },
    { kind: "repo", settings: { "harvest-runtime": "codex", "harvest-model": "gpt-5.5" }, runtime: "codex", model: "gpt-5.5" },
  ];
  try {
    for (const [i, c] of cases.entries()) {
      const dir = join(base, String(i));
      const spawnLog = join(dir, "spawn.json");
      const work = c.kind === "workspace" ? "workspace" : "worktree";
      const d = deployment(dir, { sessions: [], spawnLog, work, gitRepo: c.kind === "workspace" });
      const metaPath = join(d.home, "instance.json");
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      writeFileSync(metaPath, JSON.stringify({ ...meta, kind: c.kind }));
      write(join(d.home, "notes", "lesson.md"), "# Durable lesson\n");
      assert.equal(harvest(d, [], { settings: c.settings, work }).result.harvest, "spawned");
      const log = JSON.parse(readFileSync(spawnLog, "utf8"));
      assert.equal(log.args[log.args.indexOf("--runtime") + 1], c.runtime);
      if (c.model) assert.equal(log.args[log.args.indexOf("--model") + 1], c.model);
      else assert.equal(log.args.includes("--model"), false, "native harness chooses its own default");
      if (c.kind === "local") assert.match(log.task, /LOCAL-SOUL/);
      if (c.kind === "workspace") assert.match(log.task, /WORKSPACE-MODE/);
    }
    const spawnLog = join(base, "bad-spawn.json");
    const d = deployment(join(base, "bad"), { sessions: [], spawnLog });
    write(join(d.home, "notes", "lesson.md"), "# Durable lesson\n");
    for (const settings of [
      { "harvest-runtime": "unsupported" },
      { "harvest-runtime": "claude", "harvest-model": "github-copilot/gpt-5.5" },
      { "harvest-runtime": "codex", "harvest-model": 123 },
    ]) {
      const result = harvest(d, [], { settings, status: 1 });
      assert.equal(result.error.code, "E_HARVEST_SETTINGS");
      assert.equal(existsSync(spawnLog), false);
      assert.equal(existsSync(join(d.home, "notes", "lesson.md")), true);
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("okf harvest: an unchanged plan after a spawn warns and preserves evidence until an explicit retry", () => {
  const base = mkdtempSync(join(tmpdir(), "okf-stalled-"));
  const spawnLog = join(base, "spawn.json");
  const sessions = [{ thread: "cc:session:stalled", source: "cc", turns: 3, lastTurnId: "t3" }];
  const d = deployment(base, { sessions, spawnLog });
  try {
    assert.equal(harvest(d).result.harvest, "spawned");
    const nextPath = join(d.home, ".okf-harvest-record.next.json");
    const planned = readFileSync(nextPath, "utf8");
    rmSync(spawnLog);
    const stalled = harvest(d);
    assert.equal(stalled.result.harvest, "skipped");
    assert.match(stalled.result.warnings[0], /memory-harvest-dev-1.*cc:session:stalled \(start -> t3\)/);
    assert.match(stalled.stderr, /did not advance the watermark/);
    assert.equal(existsSync(spawnLog), false);
    assert.equal(readFileSync(nextPath, "utf8"), planned);
    assert.equal(existsSync(join(d.home, ".okf-harvest-record.json")), false);
    const retry = harvest(d, ["--force"]);
    assert.equal(retry.result.harvest, "spawned");
    assert.equal(retry.result.warnings.length, 1);
    assert.equal(existsSync(spawnLog), true);

    // Planning alone is not a spawned harvester and must not block a retry.
    const unstamped = JSON.parse(planned);
    delete unstamped.pendingHarvest;
    writeFileSync(nextPath, JSON.stringify(unstamped));
    assert.equal(harvest(d).result.harvest, "spawned");

    // Delivery consumes the prepared file; subsequent new turns are eligible.
    writeFileSync(join(d.home, ".okf-harvest-record.json"), readFileSync(nextPath));
    rmSync(nextPath);
    sessions[0].turns = 4; sessions[0].lastTurnId = "t4";
    writeFileSync(join(base, "capture.json"), JSON.stringify({ sessions }));
    assert.equal(harvest(d).result.harvest, "spawned");
    const task = JSON.parse(readFileSync(spawnLog, "utf8")).task;
    assert.match(task, /--after 't3' --until 't4'/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
