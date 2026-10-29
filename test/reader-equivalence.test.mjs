// The warm reader answers as the CLI does, request after request (awebai/oats#1630, docs/desktop-cli-api.md "The
// warm reader": warm code, not warm data). ONE long-lived `oats reader --stdio` and fresh `oats ... --json` runs
// (cwd = --dir, the reader's environment) read one fixture deployment, `status` and `workspace status` with
// --max-age none / 0 / 60, and each pair has equal `exit` and `answer`. Between rounds the deployment changes under
// the reader, and each change is asserted to show in the answer, so the equality proves the reader read afresh:
//   - a spawn and a retire by another process;
//   - an edited oats-local.yaml and an edited oats-lock.json;
//   - a launched session killed on the fixture's own tmux server;
//   - a `tmux` appearing in a RELATIVE PATH entry, which resolves against the cwd: the reader's per-request chdir
//     to --dir (lib/reader.mjs) is what makes it the CLI's tmux.
// Only the time-dependent fields test/read-call-equivalence.test.mjs normalises are normalised.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import YAML from "yaml";
import { oatsSocket, waitUntil } from "./helpers/host-fixture.mjs";
import { CLI, v2Deployment } from "./helpers/v2-deployment.mjs";

const HAS_TMUX = (() => { try { execFileSync("tmux", ["-V"], { stdio: "ignore", timeout: 5000 }); return true; } catch { return false; } })();
const NO_TMUX = !HAS_TMUX && "tmux is not installed";
const SHELL = "/bin/sh";
const FRAME_TIMEOUT_MS = 60_000;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** `oats reader --stdio` as a client starts it: stdin and stdout piped, stderr drained with a bound. Frames are
 *  read one line at a time, in order (v1 answers in order). */
function startReader({ cli = CLI, env, cwd }) {
  const child = spawn(process.execPath, [cli, "reader", "--stdio"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d) => { if (stderr.length < 256 * 1024) stderr += d; });
  const frames = [], waiting = [];
  let closed = false;
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const frame = JSON.parse(line); // a line that is no JSON fails the test here
    if (waiting.length) waiting.shift().done(frame); else frames.push(frame);
  });
  // Its stdout ended (it exited): a frame still awaited never comes.
  lines.on("close", () => { closed = true; for (const w of waiting.splice(0)) w.fail(new Error(`the reader's stdout ended with no frame\n${stderr}`)); });
  const exited = new Promise((done) => child.on("exit", (code, signal) => done({ code, signal })));
  const reader = {
    child, exited, stderr: () => stderr,
    next: () => (frames.length ? Promise.resolve(frames.shift()) : closed ? Promise.reject(new Error(`the reader's stdout ended with no frame\n${stderr}`)) : new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`no frame from the reader in ${FRAME_TIMEOUT_MS} ms\n${stderr}`)), FRAME_TIMEOUT_MS);
      waiting.push({ done: (frame) => { clearTimeout(timer); done(frame); }, fail: (e) => { clearTimeout(timer); fail(e); } });
    })),
    send: (...requests) => child.stdin.write(requests.map((r) => `${JSON.stringify(r)}\n`).join("")),
    /** Close its stdin, which ends it, and wait for its exit. */
    end: async () => { child.stdin.end(); return exited; },
  };
  return reader;
}

// As test/read-call-equivalence.test.mjs: time-dependent by contract, and nothing else, kept as they are when both
// sides reused the same stored observation.
function normalise(doc, reused) {
  const copy = structuredClone(doc);
  const at = (holder, key) => {
    if (!holder || !Object.hasOwn(holder, key)) return;
    assert.ok(!Number.isNaN(Date.parse(holder[key])), `${key} is a time: ${holder[key]}`);
    if (!reused) holder[key] = "<observed>";
  };
  at(copy.observation, "observedAt");
  at(copy.result?.observation, "observedAt");
  at(copy.result?.workspace, "observedAt");
  return copy;
}
const observationOf = (doc) => doc?.observation ?? doc?.result?.observation;
const rows = (st) => st.agents.flatMap((a) => a.instances);
const row = (st, name) => rows(st).find((i) => i.instance === name);

test("one warm reader answers status and workspace status as fresh CLI runs, while the deployment changes under it", { timeout: 600_000 }, async (t) => {
  const fx = v2Deployment({ t, name: "reader-ws", souls: { dev: {}, spare: {} } });
  const ok = (r) => { assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`); return r.json(); };
  // The environment of every read, the reader's and the CLI's: a relative PATH entry first, which names no
  // directory until the PATH case makes <deployment>/relbin.
  const env = { ...fx.env, PATH: `relbin:${fx.env.PATH}` };
  ok(fx.cli(["sync", "--json"], { env }));
  ok(fx.cli(["spawn", "dev", "--purpose", "a", "--work", "directory", "--no-launch", "--json"], { env }));

  // A stand-in harness that idles until it is signalled, for the launched session: no harness of the host runs.
  const idleBin = join(fx.base, "idle-bin");
  mkdirSync(idleBin);
  writeFileSync(join(idleBin, "pi"), `#!/bin/sh\necho $$ > "$OATS_INSTANCE_HOME/harness.pid"\nexec sleep 600\n`, { mode: 0o755 });
  const socket = oatsSocket(fx.env.TMUX_TMPDIR);
  // The fixture's own server only, always by its socket, never by name.
  const tmux = (...args) => execFileSync("tmux", ["-f", "/dev/null", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] });
  const harnesses = [];
  let reader = null;
  fx.beforeCleanup(() => {
    if (reader && reader.child.exitCode === null && reader.child.signalCode === null) reader.child.kill("SIGKILL");
    for (const pid of harnesses) if (alive(pid)) process.kill(pid, "SIGKILL");
    if (HAS_TMUX && existsSync(socket)) { try { tmux("kill-server"); } catch { /* no server runs */ } }
  });

  reader = startReader({ env, cwd: fx.base });
  const hello = await reader.next();
  assert.deepEqual(hello.reads, ["status", "workspace status"], JSON.stringify(hello));
  assert.equal(hello.readerApi, 1);

  let id = 0;
  /** One request through the reader, then the same argv through the CLI at once; exit and answer compared. */
  async function compare(verb, maxAge) {
    const argv = [...(verb === "status" ? ["status"] : ["workspace", "status"]), "--dir", fx.dep, ...(maxAge === null ? [] : ["--max-age", String(maxAge)]), "--json"];
    const label = `oats ${argv.join(" ")}`;
    const request = { id: ++id, argv };
    reader.send(request);
    const frame = await reader.next();
    assert.equal(frame.id, request.id, `${label}: answers in order\n${JSON.stringify(frame)}`);
    // E_READER_STALE here means this install's files changed while the test ran (an edit of lib/ during the run).
    assert.equal(frame.refused, undefined, `${label}: answered, not refused\n${JSON.stringify(frame)}`);
    const r = spawnSync(process.execPath, [CLI, ...argv], { cwd: fx.dep, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    assert.equal(frame.exit, r.status, `${label}: exit\n${r.stdout}\n${r.stderr}`);
    const doc = JSON.parse(r.stdout);
    const reused = observationOf(doc)?.reused === true && observationOf(frame.answer)?.reused === true;
    assert.deepEqual(normalise(frame.answer, reused), normalise(doc, reused), label);
    return frame.answer;
  }
  /** A round of every form. Each --max-age 60 read follows a --max-age 0 round within its window, so both sides
   *  reuse the one stored observation. → the answers without --max-age. */
  async function round(label) {
    const out = {};
    for (const maxAge of [null, 0, 60]) {
      const st = await compare("status", maxAge);
      const ws = await compare("workspace", maxAge);
      if (maxAge === null) Object.assign(out, { status: st, workspace: ws });
      if (maxAge === 60) {
        assert.equal(st.observation.reused, true, `${label}: status reuses at --max-age 60`);
        assert.equal(ws.result.observation.reused, true, `${label}: workspace status reuses at --max-age 60`);
      }
    }
    assert.equal(out.workspace.ok, true, `${label}: ${JSON.stringify(out.workspace.error)}`);
    return out;
  }

  let now = await round("start");
  assert.deepEqual(rows(now.status).map((i) => i.instance), ["dev-a"]);

  await t.test("a spawn and a retire by another process", async () => {
    ok(fx.cli(["spawn", "dev", "--purpose", "b", "--work", "directory", "--no-launch", "--json"], { env }));
    now = await round("spawned");
    assert.deepEqual(rows(now.status).map((i) => i.instance).sort(), ["dev-a", "dev-b"], "the reader sees the spawn");
    const retired = fx.cli(["retire", "dev-b", "--json"], { env });
    assert.equal(retired.status, 0, retired.stdout + retired.stderr);
    now = await round("retired");
    assert.deepEqual(rows(now.status).map((i) => i.instance), ["dev-a"], "the reader sees the retire");
  });

  await t.test("an edited oats-local.yaml and an edited lock", async () => {
    const localFile = join(fx.dep, "oats-local.yaml");
    const local = YAML.parse(readFileSync(localFile, "utf8"));
    assert.deepEqual(now.workspace.result.disabledSouls, []);
    writeFileSync(localFile, YAML.stringify({ ...local, souls: { disabled: ["spare"] } }));
    now = await round("local edited");
    assert.deepEqual(now.workspace.result.disabledSouls, ["spare"], "the reader sees the edited oats-local.yaml");

    const lockFile = join(fx.dep, "oats-lock.json");
    const lock = JSON.parse(readFileSync(lockFile, "utf8"));
    assert.deepEqual(now.workspace.result.packages, []);
    lock.packages["acme.tools"] = { source: "git:local/acme@v1.0.0", path: "oats-package", version: "1.0.0", commit: "a".repeat(40), integrity: `sha256-${"0".repeat(64)}`, capabilities: [] };
    writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
    now = await round("lock edited");
    assert.deepEqual(now.workspace.result.packages.map((p) => p.id), ["acme.tools"], "the reader sees the edited lock");
    assert.deepEqual(now.workspace.result.stale, ["acme.tools"]);
  });

  await t.test("a launched session killed on the fixture's own tmux server", { skip: NO_TMUX }, async () => {
    const launched = ok(fx.cli(["spawn", "dev", "--purpose", "live", "--work", "directory", "--json"], { env: { ...env, PATH: `${idleBin}:${env.PATH}`, SHELL } })).result;
    assert.equal(launched.launched, true);
    assert.equal(launched.tmux.socket, socket, "fixture premise: the session is on the fixture's own server");
    const pidFile = join(launched.home, "harness.pid");
    const harness = () => { try { const n = Number(readFileSync(pidFile, "utf8").trim()); return n > 1 ? n : null; } catch { return null; } };
    await waitUntil(() => harness() !== null && alive(harness()), "the stand-in harness to run");
    harnesses.push(harness());
    now = await round("launched");
    assert.equal(row(now.status, "dev-live").running, true, "the reader sees the running session");

    tmux("kill-window", "-t", `=${launched.tmux.session}:=${launched.tmux.window}`);
    await waitUntil(() => !tmux("list-windows", "-a", "-F", "#{window_name}").split("\n").includes(launched.tmux.window), "the window to be gone");
    now = await round("killed");
    const lost = row(now.status, "dev-live");
    assert.deepEqual([lost.running, lost.sessionEnd], [false, "lost"], "the reader sees the killed session");
  });

  await t.test("a tmux added to a relative PATH entry", async () => {
    // A tmux whose version answer flips the host's viewer fact, and that answers nothing else.
    const before = now.status.sessionViewer.prefixScroll;
    mkdirSync(join(fx.dep, "relbin"));
    writeFileSync(join(fx.dep, "relbin", "tmux"), `#!/bin/sh\nif [ "$1" = -V ]; then echo 'tmux ${before ? "3.2" : "3.3"}'; exit 0; fi\nexit 1\n`, { mode: 0o755 });
    now = await round("tmux on PATH");
    assert.equal(now.status.sessionViewer.prefixScroll, !before, "the reader runs the tmux the CLI finds from --dir");
    const live = row(now.status, "dev-live");
    if (live) assert.deepEqual([live.running, live.runtimeState], [null, "unreachable"], "the session read goes to the stand-in tmux too");
  });

  const end = await reader.end();
  assert.deepEqual(end, { code: 0, signal: null }, `the reader exits 0 on stdin EOF\n${reader.stderr()}`);
});
