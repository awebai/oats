// The TUI's reads through the warm reader (awebai/oats#1630; lib/read.mjs createReader; the rules are
// packages/client warm-reader.mjs's, tested in packages/desktop/test/warm-reader.test.mjs and not again here):
// the background reads of a kernel that lists `warm-reader` go to one `oats reader --stdio` child, started as
// every kernel child of the TUI is (`node <bin> reader --stdio`, in a session of its own); a live read and every
// read before its hello are the CLI's, as today; a reader that exits hands its read in flight to the CLI; stop()
// closes its stdin. And D10: under feature `status-liveness` a cycle starts no collector, and each row is the
// kernel's; without it the collector runs.
// The kernel, its reader and the collector are FAKES (fixtures/fake.mjs) in a temp directory: no real `oats`,
// no tmux, and no test here signals a process (the reader's ends with its stdin; every other child exits).
import test from "node:test";
import assert from "node:assert/strict";
import { spawn as nodeSpawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cliRecord } from "../lib/client.mjs";
import { createReader, leaveInstance } from "../lib/read.mjs";

const FAKE = fileURLToPath(new URL("./fixtures/fake.mjs", import.meta.url));
const VERSION = JSON.parse(readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8")).version;
/** What the shared observer requires, --max-age on a read, and the reader at the API the client speaks. */
const FEATURES = ["workspace-v2", "instance-modules", "served-identity", "packages-no-approval", "observe-max-age", "warm-reader"];
const ROOT = realpathSync(mkdtempSync(path.join(os.tmpdir(), "oats-tui-warm-")));
const CLEAN_ENV = leaveInstance({ ...process.env });
test.after(() => rmSync(ROOT, { recursive: true, force: true }));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(what, check, ms = 20_000) {
  for (const deadline = Date.now() + ms; ;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) assert.fail(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(15);
  }
}

let worlds = 0;
/** A temp directory with a deployment, the fake kernel and collector, and their plan; `more` features on its record. */
function makeWorld({ rows = [], features = [] } = {}) {
  const dir = path.join(ROOT, `world-${++worlds}`), deployment = path.join(dir, "deployment"), log = path.join(dir, "calls.jsonl");
  mkdirSync(deployment, { recursive: true });
  for (const name of ["oats", "collector"]) copyFileSync(FAKE, path.join(dir, `${name}.mjs`));
  const home = (row) => path.join(deployment, "agents", "dev", "instances", row.instance);
  const status = { root: path.join(deployment, "agents"), agents: [{ name: "dev", description: "The developer", dir: path.join(deployment, "agents", "dev"), instances: rows.map((row) => ({ ...row, home: home(row) })) }] };
  const workspace = { schemaVersion: 1, ok: true, result: { workspaceStatusApi: 1, workspace: { name: "fake-workspace", key: "local//fake", local: path.join(deployment, "oats-local.yaml") },
    members: [], packages: [], declaredPackages: [], unsynced: [], stale: [], external: [], problems: [] } };
  const world = {
    dir, deployment, bin: path.join(dir, "oats.mjs"), collector: path.join(dir, "collector.mjs"),
    plan(more = {}) {
      writeFileSync(path.join(dir, "plan.json"), JSON.stringify({ status: { stdout: JSON.stringify(status) }, workspace: { stdout: JSON.stringify(workspace) },
        collector: { stdout: JSON.stringify(rows.map(() => ({ running: false, runtimeState: "shell" }))) }, reader: { version: VERSION }, ...more }));
    },
    calls(action, event) {
      const all = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
      return all.filter((call) => (action === undefined || call.action === action) && (event === undefined || call.event === event));
    },
  };
  world.cli = cliRecord({ version: VERSION, workspaceApi: 2, readerApi: 1, features: [...FEATURES, ...features] }, { bin: world.bin, source: "tui" });
  world.plan();
  return world;
}
/** A reader over `world`'s one deployment: what it emitted, and every process it started. */
function reading(t, world) {
  const entries = [], spawned = [];
  let n = 0;
  const reader = createReader({
    cli: world.cli, env: CLEAN_ENV, collector: world.collector,
    getServed: () => [world.deployment], getEntry: () => null, getRoster: () => ({ remote: { remoteGroups: [], rosterAnswered: false, rosterFailure: null }, memory: new Map(), notes: new Map() }),
    onEntry: (emitted) => entries.push(emitted), onRoster: () => {},
    clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++n)).toISOString(),
    spawn: (file, args, options) => { spawned.push({ file, args, options }); return nodeSpawn(file, args, options); },
  });
  t.after(() => reader.stop());
  return { reader, entries, spawned };
}
/** The kernel's CLI reads of this deployment (one `status`, one `workspace status` a cycle). */
const cliReads = (world) => world.calls("status", "start").length + world.calls("workspace", "start").length;
const readerRequests = (world) => world.calls("reader", "request");
/** A first background cycle: its reads are the CLI's, and it starts the reader; resolved once the reader said hello. */
async function warmUp(world, reader) {
  await reader.start();
  assert.equal(cliReads(world), 2, "the first cycle's reads, before any hello, are the CLI's");
  await waitFor("the reader to start", () => world.calls("reader", "start").length === 1);
  // Its hello is its first line; a read after it is the reader's. Wait until a read is taken by it.
  for (let i = 0; i < 100 && readerRequests(world).length === 0; i++) { await reader.request(); await sleep(20); }
  assert.ok(readerRequests(world).length > 0, "a background read reached the reader");
}

test("a background read goes to one `oats reader --stdio` the TUI started as `node <bin> reader --stdio`, in a session of its own", async (t) => {
  const world = makeWorld({ rows: [{ instance: "dev-a", running: true, runtimeState: "running", tmux: { session: "oats", window: "dev-a", socket: null } }] });
  const { reader, entries, spawned } = reading(t, world);
  await warmUp(world, reader);
  const started = spawned.filter((s) => s.args.includes("reader"));
  assert.equal(started.length, 1, "one reader");
  assert.equal(started[0].file, process.execPath);
  assert.deepEqual(started[0].args, [world.bin, "reader", "--stdio"]);
  assert.equal(started[0].options.detached, true);
  assert.deepEqual(started[0].options.stdio, ["pipe", "pipe", "ignore"], "the module's stdio");
  const [{ pid, sid }] = world.calls("reader", "start");
  if (sid !== null) assert.equal(sid, pid, "it leads a session of its own");
  // Once warm, a background cycle is the reader's alone: both reads, no CLI run, and the entry is observed.
  const before = cliReads(world), asked = readerRequests(world).length;
  await reader.request();
  assert.equal(cliReads(world), before, "no CLI read");
  assert.equal(readerRequests(world).length, asked + 2, "status and workspace status, through the reader");
  assert.deepEqual(readerRequests(world).slice(-2).map((r) => r.argv.slice(0, r.argv[0] === "workspace" ? 2 : 1).join(" ")).sort(), ["status", "workspace status"]);
  for (const r of readerRequests(world)) assert.ok(r.argv.includes("--max-age") && r.argv[r.argv.indexOf("--max-age") + 1] !== "0", "a background read");
  assert.equal(entries.at(-1).entry.deployment.status, "observed");
});

test("a live read is the CLI's, never queued behind the reader", async (t) => {
  const world = makeWorld();
  const { reader } = reading(t, world);
  await warmUp(world, reader);
  const before = cliReads(world), asked = readerRequests(world).length;
  await reader.request({ live: true });
  assert.equal(cliReads(world), before + 2, "both reads of the live cycle by the CLI");
  assert.equal(readerRequests(world).length, asked, "none by the reader");
});

test("a reader that exits with a read in flight hands it to the CLI, and the cycle is observed", async (t) => {
  const world = makeWorld();
  const { reader, entries } = reading(t, world);
  // It exits at its first request, without answering.
  world.plan({ reader: { version: VERSION, exitOn: 1 } });
  await reader.start();
  await waitFor("the reader to start", () => world.calls("reader", "start").length === 1);
  for (let i = 0; i < 100 && readerRequests(world).length === 0; i++) { await reader.request(); await sleep(20); }
  assert.equal(readerRequests(world).length, 1, "the reader took a read and exited");
  const last = entries.at(-1);
  assert.equal(last.entry.deployment.status, "observed", "the read it took was answered by the CLI");
  // That cycle's two reads: the one the reader dropped and its sibling were answered by the CLI after it went.
  const cliAfter = world.calls(undefined, "start").filter((c) => c.action === "status" || c.action === "workspace");
  assert.ok(cliAfter.length >= 4, `the CLI answered the cycles, the dropped read included (${cliAfter.length} CLI reads)`);
});

test("stop() closes the reader's stdin, and it ends", async (t) => {
  const world = makeWorld();
  const { reader } = reading(t, world);
  await warmUp(world, reader);
  assert.equal(world.calls("reader", "stdin-end").length, 0);
  reader.stop();
  await waitFor("the reader to see its stdin end", () => world.calls("reader", "stdin-end").length === 1);
});

const killed = { instance: "dev-a", running: false, runtimeState: "unreachable", runtimeError: "no server running on the socket", tmux: { session: "oats", window: "dev-a", socket: "/nonexistent/oats" } };

test("under status-liveness a cycle starts no collector, and each row keeps the kernel's running, runtimeState, runtimeError and tmux", async (t) => {
  const world = makeWorld({ rows: [killed], features: ["status-liveness"] });
  const { reader, entries } = reading(t, world);
  await reader.start();
  await reader.request({ live: true });
  assert.equal(world.calls("collector", "start").length, 0, "no collector child");
  const [row] = entries.at(-1).entry.instances;
  for (const key of ["running", "runtimeState", "runtimeError"]) assert.equal(row[key], killed[key], key);
  assert.deepEqual(row.tmux, killed.tmux);
});

test("without status-liveness the collector runs over the rows, as today", async (t) => {
  const world = makeWorld({ rows: [killed] });
  const { reader, entries } = reading(t, world);
  await reader.start();
  assert.equal(world.calls("collector", "start").length, 1, "the collector ran for the cycle");
  assert.equal(entries.at(-1).entry.instances[0].runtimeState, "shell", "the collector's answer");
});
