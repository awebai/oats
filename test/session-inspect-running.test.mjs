// `session inspect`'s `running` (feature session-inspect-running) and the fixed field labels of a
// metadata/receipt disagreement (E_RUNTIME_AUTHORITY_MISMATCH `details.fields`), awebai/oats#1346.
// Every home is a real spawn whose instance.json and independent session receipt are then written
// with the endpoint each case needs; the pane and the process table are the inspector's own seam
// (`io.exec`), so each observation is exact and no process or tmux server is needed. The real-tmux
// walks of the same states are in session-start, lifecycle-session-walk and instance-waiting.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectInstanceSession, listInstances } from "../lib/core.mjs";
import { setWaiting } from "../lib/instance-events.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "oats.mjs");
// A named configuration with yolo, so Codex is covered the way an operator selects it.
const fx = v2Deployment({ local: { "launch-configs": { "codex-yolo": { harness: "codex", yolo: true } } } });
test.after(() => fx.cleanup());

const SESSION = "oats-agents", SOCKET = join(fx.base, "fixture-tmux.sock");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const receiptOf = (home) => join(dirname(home), ".oats-retirement", "baselines", `${createHash("sha256").update(home).digest("hex")}.json`);

/** A spawned home recorded as launched in SESSION:<name> on SOCKET, in instance.json and in its
 *  independent session receipt (or recorded as never launched, in both). */
async function recordedHome(name, spawnOpts, { launched = true } = {}) {
  // Spawned with the fixture's inert claude, pi and codex first on PATH (inertHarnessDir), as
  // session-start's makeHome does: fx.spawn keeps the test's own PATH, which holds no harness.
  const path = process.env.PATH;
  process.env.PATH = fx.env.PATH;
  let spawned;
  try { spawned = await fx.spawn("dev", { name, ...spawnOpts }); } finally { process.env.PATH = path; }
  const { home } = spawned;
  const tmux = { session: SESSION, window: name, socket: SOCKET };
  const meta = { ...readJson(join(home, "instance.json")), launched, ...(launched ? { tmux } : {}) };
  writeFileSync(join(home, "instance.json"), JSON.stringify(meta, null, 2) + "\n");
  const receipt = receiptOf(home);
  assert.ok(existsSync(receipt), "the spawn wrote the independent session receipt");
  writeFileSync(receipt, JSON.stringify({ ...readJson(receipt), runtime: launched ? { launched: true, tmux } : { launched: false } }, null, 2) + "\n", { mode: 0o600 });
  return { home, meta, receipt };
}

/** The inspector's seam: `list-panes` answers `panes` (a string, or an Error to throw), `ps` answers
 *  `ps`. Anything else fails the test. `calls` counts each, to pin status's one process scan. */
function observing({ panes, ps }) {
  const calls = { tmux: 0, ps: 0 };
  const io = { exec: (binary, args) => {
    if (binary === "ps") { calls.ps++; if (ps instanceof Error) throw ps; if (ps === undefined) assert.fail("no process scan is needed here"); return ps; }
    assert.equal(binary, "tmux");
    assert.ok(args.includes("list-panes"), `only inspection is attempted: ${args.join(" ")}`);
    calls.tmux++;
    if (panes instanceof Error) throw panes;
    return panes;
  } };
  return { io, calls };
}
const NOTHING_OBSERVED = { exec: (binary, args) => assert.fail(`refused before any observation, yet ran ${binary} ${args.join(" ")}`) };
const PANE_PID = "4242";
const pane = (command, dead = "0") => `%7\t${dead}\t${command}\t${PANE_PID}\t120\t40\n`;
const tmuxError = (stderr) => Object.assign(new Error("tmux failed"), { stderr });

test("1381: inspect and status resolve missing command labels from the same pane facts", async (t) => {
  const name = "missing-command";
  const { home } = await recordedHome(name, { launchConfig: "codex-yolo" });
  for (const facts of [
    { label: "unset bare shell", command: "unset", ps: `${PANE_PID} 1 zsh\n`, state: "shell", running: false },
    { label: "empty bare shell", command: "", ps: `${PANE_PID} 1 /bin/-bash\n`, state: "shell", running: false },
    { label: "unset non-shell", command: "unset", ps: `${PANE_PID} 1 /opt/custom-worker\n`, state: "unknown", running: true },
    { label: "empty live descendant", command: "", ps: `${PANE_PID} 1 zsh\n4300 ${PANE_PID} /opt/custom-worker\n`, state: "unknown", running: true },
    { label: "unset live descendant", command: "unset", ps: `${PANE_PID} 1 zsh\n4300 ${PANE_PID} /opt/custom-worker\n`, state: "unknown", running: true },
    { label: "unset missing own PID", command: "unset", ps: "9999 1 zsh\n", state: "unknown", running: true },
    { label: "empty denied process scan", command: "", ps: new Error("ps denied"), state: "unknown", running: true },
  ]) {
    await t.test(facts.label, async () => {
      const seen = observing({ panes: pane(facts.command), ps: facts.ps });
      const inspected = await fx.inEnv(() => inspectInstanceSession(home, { io: seen.io }));
      assert.equal(inspected.present, true);
      assert.equal(inspected.state, facts.state);
      assert.equal(inspected.running, facts.running);
      assert.deepEqual(seen.calls, { tmux: 1, ps: 1 });

      const calls = { windows: 0, panes: 0, ps: 0 };
      const io = { exec(binary, args) {
        if (binary === "ps") { calls.ps++; if (facts.ps instanceof Error) throw facts.ps; return facts.ps; }
        assert.equal(binary, "tmux");
        assert.deepEqual(args.slice(0, 3), ["-u", "-S", SOCKET]);
        if (args.includes("list-windows")) { calls.windows++; return `${name}\n`; }
        assert.ok(args.includes("list-panes"), "status only reads windows and panes");
        calls.panes++;
        return `${name}\t%7\t0\t${facts.command}\t${PANE_PID}\n`;
      } };
      const rows = await fx.inEnv(() => listInstances(fx.root, SESSION, io));
      const row = rows.flatMap((soul) => soul.instances).find((r) => r.home === home);
      assert.ok(row, "the actual status listing includes the spawned home");
      assert.equal(row.running, facts.running);
      assert.equal(row.runtimeState, facts.state === "shell" ? "shell" : undefined);
      assert.deepEqual(calls, { windows: 1, panes: 1, ps: 1 });
    });
  }
});

// The three harnesses, each with the command name its pane shows when it is the pane's own process.
const HARNESSES = [
  { harness: "claude", spawn: { harness: "claude" }, command: "claude" },
  { harness: "pi", spawn: { harness: "pi" }, command: "node" },
  { harness: "codex", spawn: { launchConfig: "codex-yolo" }, command: "codex" },
];

for (const h of HARNESSES) {
  test(`${h.harness}: running is status's liveness over the same observation, beside an unchanged state, present, paneId, size and waitingOnYou`, async () => {
    const { home, meta } = await recordedHome(`run-${h.harness}`, h.spawn);
    if (h.harness === "codex") assert.deepEqual([meta.launch?.harness, meta.launch?.launchConfig, meta.launch?.yolo], ["codex", "codex-yolo", true], "the named configuration selected Codex with yolo");
    setWaiting(home, { producer: "agent", waiting: true, reason: "attention", message: "a live claim" });
    const live = (state, { ps } = {}) => {
      const seen = observing({ panes: pane(state.command), ps });
      return { result: inspectInstanceSession(home, { io: seen.io }), calls: seen.calls };
    };
    const liveShape = (result, state) => ({ home, backend: "tmux", present: true, state, paneId: "%7", size: { cols: 120, rows: 40 }, running: state === "unknown", waitingOnYou: result.waitingOnYou });

    // The harness is the pane's own process: no process scan.
    let { result, calls } = live({ command: h.command });
    assert.deepEqual(result, liveShape(result, "unknown"));
    assert.equal(result.waitingOnYou?.message, "a live claim", "a running harness keeps its claim");
    assert.deepEqual(calls, { tmux: 1, ps: 0 });

    // A wrapper shell whose child is the harness (macOS tmux reports the shell): still running, one scan.
    ({ result, calls } = live({ command: "zsh" }, { ps: `1 0 launchd\n${PANE_PID} 1 zsh\n4300 ${PANE_PID} ${h.command}\n4301 4300 rg\n` }));
    assert.deepEqual(result, liveShape(result, "unknown"));
    assert.equal(result.running, true);
    assert.deepEqual(calls, { tmux: 1, ps: 1 });

    // A login wrapper shell (`-zsh`) running a shell child that runs the harness: running.
    ({ result } = live({ command: "zsh" }, { ps: `${PANE_PID} 1 -zsh\n4300 ${PANE_PID} sh\n4301 4300 ${h.command}\n` }));
    assert.equal(result.state, "unknown"); assert.equal(result.running, true);

    // The fallback shell: only shells below it. Present, not running, and no claim.
    ({ result, calls } = live({ command: "zsh" }, { ps: `${PANE_PID} 1 zsh\n4300 ${PANE_PID} -zsh\n4301 4300 sh\n9999 1 ${h.command}\n` }));
    assert.deepEqual(result, { ...liveShape(result, "shell"), waitingOnYou: null });
    assert.equal(result.running, false, "a harness elsewhere on the machine is not this pane's");
    assert.deepEqual(calls, { tmux: 1, ps: 1 });

    // A retained dead pane: stopped, not present, no size.
    const dead = observing({ panes: pane(h.command, "1") });
    assert.deepEqual(inspectInstanceSession(home, { io: dead.io }), { home, backend: "tmux", present: false, state: "stopped", paneId: "%7", running: false, waitingOnYou: null });
    // The window is gone from a reachable server: stopped.
    const absent = observing({ panes: tmuxError(`can't find window: run-${h.harness}`) });
    assert.deepEqual(inspectInstanceSession(home, { io: absent.io }), { home, backend: "tmux", present: false, state: "stopped", running: false, waitingOnYou: null });
  });
}

test("an observation that cannot be made is an error, never running: false", async () => {
  const { home } = await recordedHome("unobservable", { launchConfig: "codex-yolo" });
  const unavailable = (seen, why) => assert.throws(() => inspectInstanceSession(home, { io: seen.io }),
    (e) => e.code === "E_SESSION_UNAVAILABLE" && e.message.startsWith("cannot inspect session: ") && e.message.includes(why), why);
  // The process table cannot be read for a wrapper shell: whether the harness runs is unknown.
  unavailable(observing({ panes: pane("zsh"), ps: Object.assign(new Error("ps: operation not permitted"), { code: "EPERM" }) }), "ps: operation not permitted");
  // The backend cannot be read: a lost socket is not absence.
  unavailable(observing({ panes: tmuxError(`error connecting to ${SOCKET} (Permission denied)`) }), "tmux failed");
  unavailable(observing({ panes: tmuxError(`no server running on ${SOCKET}`) }), "tmux failed");
  // Malformed answers and a split window.
  unavailable(observing({ panes: "garbage\n" }), "invalid tmux pane response");
  unavailable(observing({ panes: `%7\t0\tcodex\t${PANE_PID}\twide\t40\n` }), "invalid tmux pane response");
  unavailable(observing({ panes: `%7\t0\tzsh\tnot-a-pid\t120\t40\n` }), "tmux returned no pane process id");
  unavailable(observing({ panes: pane("codex") + pane("zsh").replace("%7", "%8") }), "session window has multiple panes");
});

test("a home that never launched, and a home that is gone, are not running and are never observed", async () => {
  const { home } = await recordedHome("never", { harness: "claude" }, { launched: false });
  assert.deepEqual(inspectInstanceSession(home, { io: NOTHING_OBSERVED }), { home, backend: null, present: false, state: "not-launched", running: false, waitingOnYou: null });
  const gone = join(fx.base, "no-such-home");
  assert.deepEqual(inspectInstanceSession(gone, { io: NOTHING_OBSERVED }), { home: gone, backend: null, present: false, state: "stopped", running: false, waitingOnYou: null });
});

// ---- E_RUNTIME_AUTHORITY_MISMATCH details.fields -------------------------------------------------

const MISMATCH = "instance metadata disagrees with independent session receipt";
/** instance.json rewritten as `change(meta)`; the refusal comes before any observation, with exactly
 *  `fields` and nothing else in its details. A live pane is offered and never looked at. */
function refusesWith(f, change, fields, label) {
  writeFileSync(join(f.home, "instance.json"), JSON.stringify(change(structuredClone(f.meta)), null, 2) + "\n");
  assert.throws(() => inspectInstanceSession(f.home, { io: NOTHING_OBSERVED }), (e) => {
    assert.equal(e.code, "E_RUNTIME_AUTHORITY_MISMATCH", label);
    assert.equal(e.message, MISMATCH, `${label}: the message is unchanged`);
    assert.deepEqual(e.details, { fields }, label);
    return true;
  }, label);
}
/** instance.json rewritten as `change(meta)` is allowed: the live pane is observed and runs. */
function allows(f, change, label) {
  writeFileSync(join(f.home, "instance.json"), JSON.stringify(change(structuredClone(f.meta)), null, 2) + "\n");
  const seen = observing({ panes: pane("codex") });
  const result = inspectInstanceSession(f.home, { io: seen.io });
  assert.equal(result.running, true, label); assert.equal(result.state, "unknown", label);
  assert.equal(seen.calls.tmux, 1, label);
}
const tmuxWith = (fields) => (m) => ({ ...m, tmux: { ...m.tmux, ...fields } });

test("a disagreement names exactly the fields that differ, from the fixed vocabulary, in a fixed order, with no values", async () => {
  const f = await recordedHome("fields", { launchConfig: "codex-yolo" });
  allows(f, (m) => m, "metadata that agrees");
  refusesWith(f, tmuxWith({ session: "other-session" }), ["tmux.session"], "session");
  refusesWith(f, tmuxWith({ window: "other-window" }), ["tmux.window"], "window");
  refusesWith(f, tmuxWith({ socket: join(fx.base, "other.sock") }), ["tmux.socket"], "socket");
  refusesWith(f, (m) => ({ ...m, launched: false }), ["launched"], "launched: false without a retained prompt");
  refusesWith(f, (m) => { delete m.launched; return m; }, ["launched"], "launched missing");
  refusesWith(f, (m) => ({ ...m, launched: "yes" }), ["launched"], "launched not a boolean");
  refusesWith(f, (m) => ({ ...m, launched: false, tmux: { session: "s2", window: "w2", socket: join(fx.base, "s2.sock") } }),
    ["launched", "tmux.session", "tmux.window", "tmux.socket"], "everything differs");
  refusesWith(f, tmuxWith({ socket: join(fx.base, "other.sock"), session: "s2" }), ["tmux.session", "tmux.socket"], "two endpoint fields");
  // Missing and empty endpoint fields differ from the receipt's.
  refusesWith(f, (m) => { delete m.tmux; return m; }, ["tmux.session", "tmux.window", "tmux.socket"], "no tmux record");
  refusesWith(f, tmuxWith({ session: "", window: "", socket: "" }), ["tmux.session", "tmux.window", "tmux.socket"], "empty endpoint fields");
  refusesWith(f, (m) => { delete m.tmux.window; return m; }, ["tmux.window"], "the window missing");
  // A relative or unnormalised spelling of the same socket is the same socket, as the gate resolves it.
  allows(f, tmuxWith({ socket: relative(process.cwd(), SOCKET) }), "a relative socket spelling");
  allows(f, tmuxWith({ socket: `${dirname(SOCKET)}/./x/../fixture-tmux.sock` }), "an unnormalised socket spelling");
});

test("a receipt that records no launch refuses metadata claiming one, naming launched alone", async () => {
  const f = await recordedHome("receipt-unlaunched", { harness: "pi" }, { launched: false });
  refusesWith(f, (m) => ({ ...m, launched: true, tmux: { session: SESSION, window: "receipt-unlaunched", socket: SOCKET } }), ["launched"], "metadata launched, receipt not");
  refusesWith(f, (m) => ({ ...m, launched: true }), ["launched"], "metadata launched without an endpoint");
});

test("a retained blocked or incomplete launch prompt keeps its exception; an endpoint that differs is named without launched", async () => {
  const f = await recordedHome("prompt", { harness: "claude" });
  for (const status of ["blocked", "incomplete"]) {
    const retained = (m) => ({ ...m, launched: false, launchPrompts: { ...m.launchPrompts, status } });
    allows(f, retained, `${status}: the exception still applies to a live retained prompt`);
    refusesWith(f, (m) => tmuxWith({ window: "elsewhere" })(retained(m)), ["tmux.window"], `${status}: the window keeps the exception from applying`);
    refusesWith(f, (m) => tmuxWith({ socket: join(fx.base, "elsewhere.sock"), session: "s2" })(retained(m)), ["tmux.session", "tmux.socket"], `${status}: two endpoint fields`);
  }
  for (const status of ["completed", "flag-ignored", undefined]) {
    refusesWith(f, (m) => ({ ...m, launched: false, launchPrompts: status === undefined ? undefined : { status } }), ["launched"], `prompt ${status}: no exception`);
  }
});

test("missing or invalid receipts and malformed metadata keep their own refusal, with no fields, before any observation", async () => {
  const f = await recordedHome("evidence", { harness: "claude" });
  const unknown = (label) => assert.throws(() => inspectInstanceSession(f.home, { io: NOTHING_OBSERVED }), (e) => {
    assert.equal(e.code, "E_RUNTIME_ENDPOINT_UNKNOWN", label);
    assert.equal(e.details, undefined, `${label}: no disagreement fields`);
    return true;
  }, label);
  const receiptBytes = readFileSync(f.receipt, "utf8");
  for (const runtime of [{ launched: true, tmux: { session: SESSION, window: "evidence", socket: "" } }, { launched: true }, { launched: "yes" }, undefined]) {
    writeFileSync(f.receipt, JSON.stringify({ ...JSON.parse(receiptBytes), runtime }));
    unknown(`receipt runtime ${JSON.stringify(runtime)}`);
  }
  rmSync(f.receipt);
  unknown("no receipt");
  writeFileSync(f.receipt, receiptBytes, { mode: 0o600 });
  for (const bytes of ["[1]\n", "\"text\"\n", "{not json\n"]) {
    writeFileSync(join(f.home, "instance.json"), bytes);
    unknown(`instance.json ${JSON.stringify(bytes)}`);
  }
});

test("the CLI answers the fields in error.details and advertises session-inspect-running", async () => {
  const f = await recordedHome("cli", { launchConfig: "codex-yolo" });
  writeFileSync(join(f.home, "instance.json"), JSON.stringify(tmuxWith({ window: "moved", socket: join(fx.base, "moved.sock") })(f.meta), null, 2) + "\n");
  const r = fx.cli(["session", "inspect", "--home", f.home, "--json"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(r.json().error, { code: "E_RUNTIME_AUTHORITY_MISMATCH", message: MISMATCH, details: { fields: ["tmux.window", "tmux.socket"] } });
  assert.ok(!r.stdout.includes("moved"), "no value reaches the answer");
  const probe = JSON.parse(spawnSync(process.execPath, [CLI, "version", "--json"], { encoding: "utf8" }).stdout);
  assert.ok(probe.features.includes("session-inspect-running"));
});
