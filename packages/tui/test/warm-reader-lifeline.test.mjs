// #1630 (option C, PR D): the TUI's warm reader dies with the TUI that started it, also on SIGKILL. The TUI
// starts it as every kernel child, in a session of its own (lib/read.mjs createReader), so no signal to the
// TUI's process group or terminal reaches it: what ends it is its stdin. The TUI holds the only write end
// (packages/client/warm-reader.mjs), the reader exits on its EOF, and a SIGKILLed TUI (no cleanup code runs)
// closes it. A long-lived child the TUI started after the reader holds no copy of it.
// Proven with the REAL createReader in a stand-in TUI process (fixtures/lifeline-tui.mjs), over the fake
// kernel and its reader (fixtures/fake.mjs, which writes down its stdin's end). No real `oats` and no tmux.
// Every process started here is reaped by exact pid, also on failure. It kills a process: run it in CI, not
// on a shared host.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FAKE = fileURLToPath(new URL("./fixtures/fake.mjs", import.meta.url));
const TUI = fileURLToPath(new URL("./fixtures/lifeline-tui.mjs", import.meta.url));
const VERSION = JSON.parse(readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8")).version;
const FEATURES = ["workspace-v2", "instance-modules", "served-identity", "packages-no-approval", "observe-max-age", "warm-reader"];

/** A pid that is running: signal 0 reaches it and (on Linux) it is not a zombie awaiting its reaper. */
function alive(pid) {
  try { process.kill(pid, 0); } catch { return false; }
  try { return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8")); } catch { return true; }
}
async function until(probe, ms) {
  for (const end = Date.now() + ms; ;) {
    if (await probe()) return true;
    if (Date.now() > end) return false;
    await new Promise((ok) => setTimeout(ok, 50));
  }
}

test("the TUI's warm reader, in a session of its own, exits when the TUI holding its stdin is SIGKILLed", async (t) => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "oats-tui-lifeline-")));
  const deployment = path.join(dir, "deployment"), log = path.join(dir, "calls.jsonl");
  mkdirSync(deployment);
  for (const name of ["oats", "collector"]) copyFileSync(FAKE, path.join(dir, `${name}.mjs`));
  const status = { root: path.join(deployment, "agents"), agents: [] };
  const workspace = { schemaVersion: 1, ok: true, result: { workspaceStatusApi: 1, workspace: { name: "fake-workspace", key: "local//fake", local: path.join(deployment, "oats-local.yaml") },
    members: [], packages: [], declaredPackages: [], unsynced: [], stale: [], external: [], problems: [] } };
  writeFileSync(path.join(dir, "plan.json"), JSON.stringify({ status: { stdout: JSON.stringify(status) }, workspace: { stdout: JSON.stringify(workspace) },
    collector: { stdout: "[]" }, reader: { version: VERSION } }));
  const calls = (action, event) => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [])
    .filter((call) => call.action === action && call.event === event);
  const pids = new Set();
  t.after(() => {
    for (const { pid } of calls("reader", "start")) pids.add(pid);
    for (const pid of pids) if (Number.isInteger(pid) && alive(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
    rmSync(dir, { recursive: true, force: true });
  });

  const setup = { bin: path.join(dir, "oats.mjs"), collector: path.join(dir, "collector.mjs"), deployment, version: VERSION, features: FEATURES, log };
  const tui = spawn(process.execPath, [TUI, JSON.stringify(setup)], { stdio: ["ignore", "pipe", "inherit"] });
  pids.add(tui.pid);
  let line = "";
  for await (const chunk of tui.stdout) { line += chunk; if (line.includes("\n")) break; }
  const started = JSON.parse(line);
  pids.add(started.plain);
  assert.equal(started.warm, true, "a background read reached the reader");
  const [reader] = calls("reader", "start");
  assert.ok(reader, "the TUI started one reader");
  pids.add(reader.pid);
  // The fake reads its session from /proc: where there is none (macOS) it writes null, and only its group is checked.
  if (reader.sid !== null) assert.equal(reader.sid, reader.pid, "the reader leads a session of its own: no signal to the TUI's group reaches it");
  assert.equal(reader.pgid, reader.pid, "the reader leads a process group of its own");
  assert.equal(alive(reader.pid), true, "the reader runs");

  process.kill(tui.pid, "SIGKILL");
  await once(tui, "exit");
  assert.equal(await until(() => !alive(reader.pid), 5000), true, "the reader is gone within 5 s of the TUI's SIGKILL");
  assert.equal(calls("reader", "stdin-end").length, 1, "it ended on its stdin's end");
  assert.equal(alive(started.plain), true, "the plain child still runs: it held no copy of the reader's stdin");
});
