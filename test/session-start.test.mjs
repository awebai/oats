import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLaunchCommand, renderLaunchCommand, withLaunchModel, startInstanceSession, inspectInstanceSession } from "../lib/core.mjs";
import { startRemote } from "../lib/servers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "..", "bin", "oats.mjs");
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// The shapes spawn renders today (lib/core.mjs launch command), verbatim in structure.
const claudeCmd = (home, model) => `OATS_INSTANCE='n' OATS_INSTANCE_HOME=${shq(home)} PI_AGENT_INSTANCE='n' PI_AGENT_HOME=${shq(home)} AWEB_DELIVERY='session' '/opt/homebrew/bin/claude' --dangerously-skip-permissions${model ? ` --model ${shq(model)}` : ""} --dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace -- "$(cat TASK.md)"`;
const codexCmd = (home) => `OATS_INSTANCE='n' OATS_INSTANCE_HOME=${shq(home)} PI_AGENT_INSTANCE='n' PI_AGENT_HOME=${shq(home)} '/opt/homebrew/bin/codex' --cd ${shq(home)} --yolo -c ${shq(`projects={${JSON.stringify(home)}={trust_level="trusted"}}`)} -- "$(cat TASK.md)"`;
const piCmd = (home) => `OATS_INSTANCE='n' OATS_INSTANCE_HOME=${shq(home)} PI_AGENT_INSTANCE='n' PI_AGENT_HOME=${shq(home)} '/opt/homebrew/bin/pi' --no-skills --skill ${shq(join(home, ".agents", "skills"))} --no-context-files --no-prompt-templates --append-system-prompt ${shq(join(home, "AGENTS.md"))} --approve --name 'n' '@TASK.md'`;

test("persisted launch commands re-render with a model and keep everything else byte-identical", () => {
  const home = "/tmp/it's home";
  for (const [cmd, runtime] of [[claudeCmd(home), "claude"], [codexCmd(home), "codex"], [piCmd(home), "pi"]]) {
    const parsed = parseLaunchCommand(cmd);
    assert.equal(renderLaunchCommand(parsed.tokens), cmd, `${runtime} round-trips`);
    assert.equal(parsed.modelIndex, -1);
    const withModel = withLaunchModel(cmd, "m-1");
    const p2 = parseLaunchCommand(withModel);
    assert.equal(p2.tokens[p2.modelIndex].value, "m-1");
    assert.equal(p2.tokens[p2.modelIndex - 1].value, "--model");
    assert.equal(p2.modelIndex, p2.binary + 2, "inserted right after the binary");
    // Every original token survives in order; only the two model tokens are new.
    const orig = parsed.tokens.map((t) => t.text);
    const now = p2.tokens.map((t) => t.text).filter((t, i) => i !== p2.modelIndex && i !== p2.modelIndex - 1);
    assert.deepEqual(now, orig);
    assert.equal(withLaunchModel(withModel, "m-2"), withModel.replace("'m-1'", "'m-2'"), "an existing value is replaced in place");
  }
  const existing = claudeCmd(home, "claude-x");
  assert.equal(withLaunchModel(existing, "claude-y"), existing.replace("'claude-x'", "'claude-y'"));
  assert.equal(parseLaunchCommand(existing).tokens.filter((t) => t.kind === "env").length, 5);
});

test("commands OATS did not render are refused, never rewritten by substring", () => {
  for (const cmd of [
    "claude --model x -- \"$(cat TASK.md)\"", // unquoted binary
    "'claude' --model 'x' -- \"$(cat OTHER.md)\"", // a different prompt expression
    "'claude' `whoami` -- \"$(cat TASK.md)\"",
    "'claude' --model 'x'; rm -rf /",
    "'claude' --model 'x $(id)'x -- \"$(cat TASK.md)\"",
    "'claude' --model",
    "'claude' --mo\\del 'x'",
    "'claude' --model --yolo",
    "'claude' --model 'first' --model 'last'",
    "FOO=bar 'claude'",
    "",
  ]) {
    assert.throws(() => parseLaunchCommand(cmd), (e) => e.code === "E_LAUNCH_COMMAND_UNSUPPORTED", cmd);
  }
});

// ---- real tmux on a private socket ------------------------------------------------
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-session-start-")));
const socket = join(base, "tmux.sock");
const session = "t";
const tmux = (...args) => execFileSync("tmux", ["-u", "-S", socket, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const windows = () => { try { return tmux("list-windows", "-t", session, "-F", "#{window_name}").split("\n").filter(Boolean); } catch { return []; } };
test.after(() => { try { tmux("kill-server"); } catch { /* gone */ } rmSync(base, { recursive: true, force: true }); });

function makeHome(name, { launched = true, withSocket = true } = {}) {
  const home = join(base, "agents", "dev", "instances", name);
  mkdirSync(home, { recursive: true });
  const harness = join(base, "fakeharness");
  if (!existsSync(harness)) { writeFileSync(harness, "#!/bin/sh\nsleep 2\n"); chmodSync(harness, 0o755); }
  writeFileSync(join(home, "TASK.md"), "task\n");
  const command = `OATS_INSTANCE=${shq(name)} OATS_INSTANCE_HOME=${shq(home)} ${shq(harness)} --dangerously-skip-permissions -- "$(cat TASK.md)"`;
  const tmuxMeta = { session, window: name, ...(withSocket ? { socket } : {}) };
  const meta = { agent: "dev", kind: "persistent", instance: name, home, repo: base, work: "worktree", branch: `agents/${name}`, runtime: "claude", tmux: tmuxMeta, command, launched, createdAt: new Date().toISOString() };
  writeFileSync(join(home, "instance.json"), JSON.stringify(meta, null, 2) + "\n");
  const key = createHash("sha256").update(home).digest("hex");
  const baselinePath = join(dirname(home), ".oats-retirement", "baselines", `${key}.json`);
  mkdirSync(dirname(baselinePath), { recursive: true });
  const baseline = { version: 2, home, homeFingerprint: { files: 3, digest: "fp-home" }, disposableReceipts: [], generatedWorkFingerprint: { digest: "fp-work" }, runtime: launched ? { launched: true, tmux: { session, window: name, socket } } : { launched: false } };
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n", { mode: 0o600 });
  return { home, meta, baselinePath, command };
}
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
async function waitUntil(predicate, description) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${description}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
const pendingFor = (f, target, fields = {}) => ({ id: `test-${f.meta.instance}`, target, command: f.command, model: null, startedAt: "2026-09-06T00:00:00.000Z", ...fields });

test("refusals happen before any mutation", () => {
  assert.throws(() => startInstanceSession("relative/home"), (e) => e.code === "E_BAD_ARGS");
  assert.throws(() => startInstanceSession(join(base, "nowhere")), (e) => e.code === "E_RUNTIME_ENDPOINT_UNKNOWN");
  const f = makeHome("refuse");
  const noBaseline = makeHome("nobaseline"); rmSync(noBaseline.baselinePath);
  assert.throws(() => startInstanceSession(noBaseline.home), (e) => e.code === "E_RUNTIME_ENDPOINT_UNKNOWN");
  const mismatch = makeHome("mismatch");
  writeFileSync(join(mismatch.home, "instance.json"), JSON.stringify({ ...mismatch.meta, tmux: { ...mismatch.meta.tmux, window: "other" } }) + "\n");
  assert.throws(() => startInstanceSession(mismatch.home), (e) => e.code === "E_RUNTIME_AUTHORITY_MISMATCH");
  writeFileSync(join(f.home, ".oats-rollback-incomplete.json"), "{}\n");
  assert.throws(() => startInstanceSession(f.home), (e) => e.code === "E_INSTANCE_RETIRING");
  rmSync(join(f.home, ".oats-rollback-incomplete.json"));
  // A self-retirement's marker beside the home (its detached teardown is running).
  writeFileSync(join(dirname(f.home), ".oats-retire-pending-refuse.json"), "{}\n");
  assert.throws(() => startInstanceSession(f.home), (e) => e.code === "E_INSTANCE_RETIRING" && /retire-pending/.test(e.message));
  rmSync(join(dirname(f.home), ".oats-retire-pending-refuse.json"));
  mkdirSync(join(f.home, ".oats-start.lock"));
  assert.throws(() => startInstanceSession(f.home), (e) => e.code === "E_SESSION_START_BUSY");
  rmSync(join(f.home, ".oats-start.lock"), { recursive: true });
  assert.throws(() => startInstanceSession(f.home, { model: "openai/gpt-x" }), (e) => e.code === "E_MODEL_UNKNOWN", "a preference claude cannot use is an error, not a silent default");
  const unsupported = makeHome("unsupported");
  writeFileSync(join(unsupported.home, "instance.json"), JSON.stringify({ ...unsupported.meta, command: "claude `id`" }) + "\n");
  assert.throws(() => startInstanceSession(unsupported.home, { model: "claude-x" }), (e) => e.code === "E_LAUNCH_COMMAND_UNSUPPORTED");
  assert.equal(readJson(f.baselinePath).runtime.launched, true);
  assert.deepEqual(readJson(join(f.home, "instance.json")), f.meta, "metadata untouched by every refusal");
  assert.equal(existsSync(join(f.home, ".oats-start.lock")), false);
});

test("a live harness is refused; a stopped instance starts in its recorded session on its recorded socket", async () => {
  tmux("new-session", "-d", "-s", session, "-n", "hq", "-c", base);
  const f = makeHome("live");
  tmux("new-window", "-t", session, "-n", "live", "-c", f.home, "sleep 30");
  assert.throws(() => startInstanceSession(f.home), (e) => e.code === "E_SESSION_RUNNING");
  tmux("kill-window", "-t", `=${session}:=live`);
  assert.equal(inspectInstanceSession(f.home).present, false);
  const before = readJson(f.baselinePath);
  const r = startInstanceSession(f.home, { model: "claude-x" });
  assert.equal(r.reused, "new");
  assert.equal(r.model, "claude-x");
  assert.deepEqual(r.target, { backend: "tmux", session, window: "live", socket: resolve(socket) });
  assert.deepEqual(windows().filter((w) => w === "live"), ["live"], "exactly one window with the instance name");
  const meta = readJson(join(f.home, "instance.json"));
  assert.equal(meta.launched, true);
  assert.equal(meta.model, "claude-x");
  assert.equal(meta.command, withLaunchModel(f.command, "claude-x"));
  assert.equal(meta.restartCount, 1);
  assert.equal(meta.restarts.length, 1);
  const after = readJson(f.baselinePath);
  assert.deepEqual(after.runtime, { launched: true, tmux: { session, window: "live", socket: resolve(socket) } });
  assert.deepEqual({ ...after, runtime: undefined }, { ...before, runtime: undefined }, "fingerprints and receipts untouched");
  assert.equal(existsSync(join(f.home, ".oats-start-pending.json")), true, "launch evidence survives until the startup shell can be distinguished");
  assert.equal(existsSync(join(f.home, ".oats-start.lock")), false);
  // The receipts the broker and retire read resolve the new target (the
  // harness needs a moment to exec its first non-shell process).
  await waitUntil(() => inspectInstanceSession(f.home).state === "unknown", "fake harness to run");
  const live = inspectInstanceSession(f.home);
  assert.equal(live.present, true);
  assert.equal(live.state, "unknown", "a running non-shell process is a harness");
  // The fake harness exits after 2s; the window drops to a fallback shell,
  // which is a stopped instance that restarts IN PLACE, never a second window.
  await waitUntil(() => existsSync(join(f.home, ".oats-start-exited")) && inspectInstanceSession(f.home).state === "shell", "harness exit");
  assert.equal(inspectInstanceSession(f.home).state, "shell");
  tmux("send-keys", "-t", `=${session}:=live`, `cd ${shq(base)}`, "Enter");
  await new Promise((r2) => setTimeout(r2, 100));
  const again = startInstanceSession(f.home);
  assert.equal(again.reused, "pane");
  assert.equal(again.model, "claude-x", "omitted model keeps the recorded one");
  assert.deepEqual(windows().filter((w) => w === "live"), ["live"]);
  assert.equal(readJson(join(f.home, "instance.json")).restartCount, 2);
  assert.equal(inspectInstanceSession(f.home).present, true);
  assert.equal(tmux("display-message", "-p", "-t", `=${session}:=live`, "#{pane_current_path}"), f.home, "restart restores the instance cwd after shell navigation");
});

test("a lost tmux server on the recorded socket is a stopped instance: the session comes back on that socket", () => {
  const f = makeHome("reboot");
  tmux("kill-server");
  assert.throws(() => inspectInstanceSession(f.home), (e) => e.code === "E_SESSION_UNAVAILABLE", "inspect alone cannot call a lost socket absent");
  const r = startInstanceSession(f.home);
  assert.equal(r.reused, "new");
  assert.equal(r.target.socket, resolve(socket));
  assert.ok(windows().includes("reboot"));
  assert.equal(readJson(f.baselinePath).runtime.tmux.socket, resolve(socket));
});

test("a start that allocated but could not record is adopted by the next start, never duplicated", async () => {
  const f = makeHome("pending");
  tmux("new-window", "-t", session, "-n", "pending", "-c", f.home, "sleep 30");
  await new Promise((r) => setTimeout(r, 100));
  // Simulate the partial failure: the actual target is in the pending receipt, metadata still says stopped.
  writeFileSync(join(f.home, ".oats-start-pending.json"), JSON.stringify(pendingFor(f, { backend: "tmux", session, window: "pending", socket })));
  const r = startInstanceSession(f.home);
  assert.equal(r.reused, "adopted");
  assert.deepEqual(windows().filter((w) => w === "pending"), ["pending"]);
  assert.equal(existsSync(join(f.home, ".oats-start-pending.json")), true, "the launch receipt is retained until command exit or target disappearance");
  assert.equal(readJson(join(f.home, "instance.json")).restartCount, 1);
  // A stale receipt whose target is provably gone is dropped and the start proceeds normally.
  tmux("kill-window", "-t", `=${session}:=pending`);
  writeFileSync(join(f.home, ".oats-start-pending.json"), JSON.stringify(pendingFor(f, { backend: "tmux", session, window: "pending", socket }, { id: "stale-target" })));
  assert.equal(startInstanceSession(f.home).reused, "new");
  assert.deepEqual(windows().filter((w) => w === "pending"), ["pending"]);
});

test("an injected metadata write failure after allocation is recovered by the next start through the receipt", async () => {
  const f = makeHome("crash");
  const before = readJson(f.baselinePath);
  let injected;
  try { injected = startInstanceSession(f.home, { io: { failBeforeMetadataWrite: true } }); } catch (e) { injected = e; }
  assert.ok(injected instanceof Error && injected.code === "E_SESSION_START_INCOMPLETE" && /\.oats-start-pending\.json/.test(injected.message), "injected write failure surfaces as E_SESSION_START_INCOMPLETE naming the receipt");
  // The receipt was updated, the metadata was not.
  assert.deepEqual(readJson(f.baselinePath).runtime, { launched: true, tmux: { session, window: "crash", socket: resolve(socket) } });
  assert.deepEqual({ ...readJson(f.baselinePath), runtime: undefined }, { ...before, runtime: undefined }, "fingerprints untouched by the failed start");
  assert.deepEqual(readJson(join(f.home, "instance.json")), f.meta);
  assert.equal(existsSync(join(f.home, ".oats-start-pending.json")), true);
  assert.equal(existsSync(join(f.home, ".oats-start.lock")), false, "the guard is released even when recording fails");
  await waitUntil(() => inspectInstanceSession(f.home).state === "unknown", "fake harness to run");
  const r = startInstanceSession(f.home);
  assert.equal(r.reused, "adopted", "the running session is recorded, not duplicated");
  assert.deepEqual(windows().filter((w) => w === "crash"), ["crash"]);
  assert.equal(existsSync(join(f.home, ".oats-start-pending.json")), true, "the launch receipt is retained until command exit or target disappearance");
  assert.equal(readJson(join(f.home, "instance.json")).restartCount, 1);
  assert.equal(inspectInstanceSession(f.home).present, true);
});

test("a recorded pending target that differs from the metadata is reconciled before the equality gate", async () => {
  // The shape a Herdr reallocation (new pane) leaves after a metadata write failure:
  // receipt and pending name the new target, metadata still names the old one.
  const f = makeHome("diverged");
  tmux("new-window", "-t", session, "-n", "diverged-2", "-c", f.home, "sleep 30");
  await new Promise((r) => setTimeout(r, 100));
  const target = { backend: "tmux", session, window: "diverged-2", socket };
  const baseline = readJson(f.baselinePath);
  writeFileSync(f.baselinePath, JSON.stringify({ ...baseline, runtime: { launched: true, tmux: { session, window: "diverged-2", socket: resolve(socket) } } }));
  writeFileSync(join(f.home, ".oats-start-pending.json"), JSON.stringify(pendingFor(f, target)));
  assert.throws(() => inspectInstanceSession(f.home), (e) => e.code === "E_RUNTIME_AUTHORITY_MISMATCH", "the ordinary gate refuses this home");
  const r = startInstanceSession(f.home);
  assert.equal(r.reused, "adopted");
  assert.deepEqual(r.target, { ...target, socket: resolve(socket) });
  assert.equal(readJson(join(f.home, "instance.json")).tmux.window, "diverged-2");
  assert.equal(existsSync(join(f.home, ".oats-start-pending.json")), true, "the launch receipt is retained until command exit or target disappearance");
  assert.equal(inspectInstanceSession(f.home).present, true, "receipts agree again");
  assert.deepEqual(windows().filter((w) => w.startsWith("diverged")), ["diverged-2"], "no second allocation");
  tmux("kill-window", "-t", `=${session}:=diverged-2`);
});

test("a pending target that cannot be observed is kept and the start refuses; a dead pane restarts in place", async () => {
  const f = makeHome("unobservable");
  // A Herdr target with an unreachable server: not absence, no allocation, receipt kept.
  writeFileSync(join(f.home, ".oats-start-pending.json"), JSON.stringify(pendingFor(f, { backend: "herdr", binary: join(base, "no-such-herdr"), socket: join(base, "no.sock"), protocol: 20, workspaceId: "w", paneId: "p", terminalId: "t" })));
  assert.throws(() => startInstanceSession(f.home), (e) => e.code === "E_SESSION_UNKNOWN" && /receipt .* is kept/.test(e.message));
  assert.equal(existsSync(join(f.home, ".oats-start-pending.json")), true);
  assert.deepEqual(windows().filter((w) => w === "unobservable"), []);
  rmSync(join(f.home, ".oats-start-pending.json"));
  // Dead pane: the harness exited and tmux retained the pane (remain-on-exit).
  const d = makeHome("deadpane");
  tmux("new-window", "-t", session, "-n", "deadpane", "-c", d.home, "sleep 1");
  tmux("set-option", "-w", "-t", `=${session}:=deadpane`, "remain-on-exit", "on");
  await waitUntil(() => inspectInstanceSession(d.home).state === "stopped", "retained dead pane");
  const st = inspectInstanceSession(d.home);
  assert.equal(st.present, false);
  assert.equal(st.state, "stopped");
  const r = startInstanceSession(d.home, { model: "claude-z" });
  assert.equal(r.reused, "pane");
  assert.deepEqual(windows().filter((w) => w === "deadpane"), ["deadpane"], "restarted in the retained pane, no second window");
  await waitUntil(() => inspectInstanceSession(d.home).state === "unknown", "dead pane relaunch");
  assert.equal(inspectInstanceSession(d.home).present, true);
  assert.equal(readJson(join(d.home, "instance.json")).model, "claude-z");
});

test("the CLI advertises session-start and routes it only to a remote that advertises it", () => {
  const probe = JSON.parse(execFileSync(process.execPath, [bin, "version", "--json"], { encoding: "utf8" }));
  assert.ok(probe.features.includes("session-start"));
  assert.ok(probe.remote.includes("session-start"));
  const oatsHome = join(base, "oats-home");
  mkdirSync(oatsHome, { recursive: true });
  writeFileSync(join(oatsHome, "servers.json"), JSON.stringify({ servers: { s: { sshHost: "h", workspace: "/w" } } }));
  const prev = process.env.OATS_HOME_DIR;
  process.env.OATS_HOME_DIR = oatsHome;
  try {
    const calls = [];
    const io = (features) => ({ execFileSync: (b, argv) => {
      const args = argv.join(" ");
      calls.push(args);
      if (args.includes("version --json")) return JSON.stringify({ schemaVersion: 1, ok: true, result: { desktopApi: 1, version: "0.22.8", remote: ["session"], features } });
      return JSON.stringify({ schemaVersion: 1, ok: true, result: { instance: "r", home: "/remote/home", backend: "tmux", reused: "new" } });
    } });
    assert.throws(() => startRemote("s", { home: "/remote/home", model: "m" }, io(["retire-home"])), (e) => e.code === "E_REMOTE_INCOMPATIBLE" && /session-start/.test(e.message));
    assert.equal(calls.filter((c) => c.includes("session start")).length, 0, "refused before any remote mutation");
    const out = startRemote("s", { home: "/remote/home", model: "m" }, io(["retire-home", "session-start"]));
    assert.equal(out.envelope.ok, true);
    assert.equal(out.envelope.result.server, "s");
    assert.equal(out.envelope.result.instance, "r", "explicit-home routes preserve the remote instance name");
    const sent = calls.find((c) => c.includes("session start"));
    assert.match(sent, /session start --home \/remote\/home --model m --json/);
  } finally {
    if (prev === undefined) delete process.env.OATS_HOME_DIR; else process.env.OATS_HOME_DIR = prev;
  }
});

test("recovery preserves the actual model and reconciles even an exited allocation", async () => {
  const f = makeHome("model-recovery");
  const target = { backend: "tmux", session, window: "model-recovery-new", socket };
  const pending = pendingFor(f, target, { command: withLaunchModel(f.command, "claude-old"), model: "claude-old" });
  const receipt = join(f.home, ".oats-start-pending.json");
  tmux("new-window", "-t", session, "-n", target.window, "sleep 30");
  await new Promise((r) => setTimeout(r, 100)); // the fixture shell execs sleep
  writeFileSync(receipt, JSON.stringify(pending));
  assert.throws(() => startInstanceSession(f.home, { model: "claude-new" }), (e) => e.code === "E_SESSION_RUNNING" && /not applied/.test(e.message));
  assert.equal(readJson(join(f.home, "instance.json")).model, "claude-old");
  assert.equal(inspectInstanceSession(f.home).present, true);
  tmux("kill-window", "-t", `=${session}:=${target.window}`);
  // Crash between baseline and metadata writes, followed by target exit.
  writeFileSync(join(f.home, "instance.json"), JSON.stringify(f.meta));
  writeFileSync(receipt, JSON.stringify(pending));
  assert.throws(() => inspectInstanceSession(f.home), (e) => e.code === "E_RUNTIME_AUTHORITY_MISMATCH");
  const r = startInstanceSession(f.home, { model: "claude-new" });
  assert.equal(r.model, "claude-new");
  assert.equal(r.target.window, target.window);
  assert.equal(existsSync(receipt), true, "the new launch keeps its own startup receipt");
});

test("invalid recovery receipts and tmux permission errors preserve evidence and never launch", () => {
  const f = makeHome("bad-recovery");
  const receipt = join(f.home, ".oats-start-pending.json");
  for (const bytes of ["{", '{}', '{"target":{"backend":"something"}}']) {
    writeFileSync(receipt, bytes);
    assert.throws(() => startInstanceSession(f.home), (e) => e.code === "E_SESSION_UNKNOWN");
    assert.equal(readFileSync(receipt, "utf8"), bytes);
  }
  rmSync(receipt);
  const io = { exec: (_bin, args) => {
    assert.ok(args.includes("list-panes"), "only inspection is attempted");
    throw Object.assign(new Error("socket failed"), { stderr: `error connecting to ${socket} (Permission denied)` });
  } };
  assert.throws(() => startInstanceSession(f.home, { io }), (e) => e.code === "E_SESSION_UNKNOWN");
  assert.deepEqual(readJson(join(f.home, "instance.json")), f.meta);
});

test("Herdr restarts in the saved server, writes recovery before launching, and restores cwd", () => {
  const f = makeHome("herdr-restart");
  const old = { backend: "herdr", binary: "/fake/herdr", socket: join(base, "herdr.sock"), protocol: 20, workspaceId: "w0", paneId: "p0", terminalId: "t0" };
  const meta = { ...f.meta, backend: "herdr", sessionTarget: old };
  delete meta.tmux;
  writeFileSync(join(f.home, "instance.json"), JSON.stringify(meta));
  writeFileSync(f.baselinePath, JSON.stringify({ ...readJson(f.baselinePath), runtime: { launched: true, sessionTarget: old } }));
  let panes = [], agent = false, allocations = 0, runs = 0;
  const io = { exec: (binary, args, options) => {
    assert.equal(binary, old.binary);
    assert.equal(options.env.HERDR_SOCKET_PATH, old.socket);
    let result;
    if (args.join(" ") === "api snapshot") result = { snapshot: { protocol: 20, panes, agents: agent ? [{ terminal_id: "t1", agent_status: "working" }] : [] } };
    else if (args[0] === "workspace") {
      allocations++;
      assert.ok(args.includes(f.home));
      panes = [{ pane_id: "p1", terminal_id: "t1", workspace_id: "w1" }];
      result = { root_pane: panes[0] };
    } else if (args[1] === "process-info") result = { process_info: { foreground_processes: [{ name: "zsh" }] } };
    else if (args[1] === "run") {
      runs++;
      const pending = readJson(join(f.home, ".oats-start-pending.json"));
      assert.equal(pending.target.paneId, "p1");
      assert.ok(args[3].includes("cd "));
      assert.ok(args[3].includes(f.home));
      agent = true;
      result = {};
    } else assert.fail(`unexpected Herdr call: ${args}`);
    return JSON.stringify({ result });
  } };
  assert.throws(() => startInstanceSession(f.home, { model: "claude-herdr", io: { ...io, failBeforeMetadataWrite: true } }), (e) => e.code === "E_SESSION_START_INCOMPLETE");
  const recovered = startInstanceSession(f.home, { io });
  assert.equal(recovered.reused, "adopted");
  assert.equal(recovered.model, "claude-herdr");
  assert.equal(allocations, 1);
  assert.equal(runs, 1);
  writeFileSync(join(f.home, ".oats-start-exited"), readJson(join(f.home, "instance.json")).startId);
  agent = false; // an idle fallback shell after the command completed
  assert.equal(startInstanceSession(f.home, { model: "claude-next", io }).reused, "pane");
  assert.equal(allocations, 1);
  assert.equal(runs, 2);
  assert.equal(readJson(f.baselinePath).runtime.sessionTarget.terminalId, "t1");
});

test("simultaneous CLI starts produce one launch and preserve a never-launched home's saved socket", async () => {
  const f = makeHome("concurrent", { launched: false });
  const invoke = () => new Promise((resolveRun, reject) => {
    execFile(process.execPath, [bin, "session", "start", "--home", f.home, "--model", "claude-x", "--json"], { timeout: 15000 }, (error, stdout, stderr) => {
      try { resolveRun(JSON.parse(stdout)); } catch { reject(new Error(`${error?.message}: ${stderr}`)); }
    });
  });
  const results = await Promise.all([invoke(), invoke()]);
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  assert.ok(results.some((r) => ["E_SESSION_START_BUSY", "E_SESSION_RUNNING"].includes(r.error?.code)), JSON.stringify(results));
  assert.deepEqual(windows().filter((w) => w === "concurrent"), ["concurrent"]);
  assert.equal(readJson(join(f.home, "instance.json")).restartCount, 1);
  assert.equal(readJson(join(f.home, "instance.json")).tmux.socket, socket);
});

test("a never-launched Herdr home without an endpoint cannot silently switch to tmux", () => {
  const f = makeHome("herdr-no-launch", { launched: false });
  const meta = { ...f.meta, backend: "herdr" };
  delete meta.tmux;
  writeFileSync(join(f.home, "instance.json"), JSON.stringify(meta));
  assert.throws(() => startInstanceSession(f.home), (e) => e.code === "E_RUNTIME_ENDPOINT_UNKNOWN");
  assert.deepEqual(readJson(join(f.home, "instance.json")), meta);
});

test("a live startup shell is protected until its command actually exits", async () => {
  const f = makeHome("slow-shell");
  const harness = join(base, "slow-shell-wrapper");
  // Builtins only: the runtime inspector correctly sees shells throughout
  // startup. The reviewer reproduced duplicate starts during this phase.
  writeFileSync(harness, '#!/bin/bash\nSECONDS=0\nwhile (( SECONDS < 2 )); do :; done\nexit 0\n');
  chmodSync(harness, 0o755);
  writeFileSync(join(f.home, "instance.json"), JSON.stringify({ ...f.meta, command: shq(harness) }));
  const first = startInstanceSession(f.home);
  const pane = tmux("display-message", "-p", "-t", `=${session}:=slow-shell`, "#{pane_id}");
  assert.equal(first.reused, "new");
  assert.throws(() => startInstanceSession(f.home), (e) => e.code === "E_SESSION_START_BUSY");
  assert.equal(tmux("display-message", "-p", "-t", `=${session}:=slow-shell`, "#{pane_id}"), pane);
  assert.equal(readJson(join(f.home, "instance.json")).restartCount, 1);
  await waitUntil(() => existsSync(join(f.home, ".oats-start-exited")) && inspectInstanceSession(f.home).state === "shell", "slow shell completion marker");
  assert.equal(inspectInstanceSession(f.home).state, "shell");
  assert.equal(startInstanceSession(f.home).reused, "pane", "the matching exit marker permits a real restart");
  assert.equal(readJson(join(f.home, "instance.json")).restartCount, 2, "reconciling a recorded attempt does not count it twice");
});

test("every malformed pending field is rejected before metadata or authority changes", () => {
  const f = makeHome("malformed-fields");
  const target = { backend: "tmux", session, window: "malformed-fields", socket };
  const receipt = join(f.home, ".oats-start-pending.json");
  const beforeMeta = readFileSync(join(f.home, "instance.json"), "utf8");
  const beforeBaseline = readFileSync(f.baselinePath, "utf8");
  const io = { exec: () => assert.fail("malformed receipt must refuse before inspection") };
  for (const fields of [{ command: { invalid: "not a command" } }, { command: "'claude' `id`" }, { model: {} }, { model: "bad\0model" }, { startedAt: "never" }, { startedAt: 123 }, { id: null }]) {
    const bytes = JSON.stringify(pendingFor(f, target, fields));
    writeFileSync(receipt, bytes);
    assert.throws(() => startInstanceSession(f.home, { io }), (e) => e.code === "E_SESSION_UNKNOWN");
    assert.equal(readFileSync(receipt, "utf8"), bytes);
    assert.equal(readFileSync(join(f.home, "instance.json"), "utf8"), beforeMeta);
    assert.equal(readFileSync(f.baselinePath, "utf8"), beforeBaseline);
  }
});

test("a transient startup child does not discard the startup guard", () => {
  const f = makeHome("transient-child");
  let launched = false, command = "cat", launches = 0;
  const io = { exec: (binary, args) => {
    if (binary === "ps") return "100 1 /bin/zsh\n";
    if (args.includes("list-panes")) {
      if (!launched) throw Object.assign(new Error("absent"), { stderr: "can't find window: transient-child" });
      return `%1\t0\t${command}\t100\n`;
    }
    if (args.includes("list-windows")) return "hq\n";
    if (args.includes("new-window") || args.includes("respawn-pane")) { launched = true; launches++; return ""; }
    assert.fail(`unexpected ${args}`);
  } };
  startInstanceSession(f.home, { io });
  assert.throws(() => startInstanceSession(f.home, { io }), (e) => e.code === "E_SESSION_RUNNING");
  command = "zsh"; // cat exited; the harness has not exec'd yet
  assert.throws(() => startInstanceSession(f.home, { io }), (e) => e.code === "E_SESSION_START_BUSY");
  assert.equal(launches, 1);
  assert.equal(readJson(join(f.home, "instance.json")).restartCount, 1);
});

test("launch errors never expose saved commands through tmux or Herdr diagnostics", () => {
  const secret = "SYNTHETIC_START_SECRET";
  for (const backend of ["respawn", "new-window", "herdr"]) {
    for (const failure of [{ stderr: secret }, { stderr: "" }, { code: "ENOENT" }, { code: "ETIMEDOUT" }, { signal: "SIGTERM" }]) {
      const f = makeHome(`redact-${backend}-${Object.keys(failure)[0]}-${String(failure.stderr ?? failure.code ?? failure.signal).length}`);
      let meta = { ...f.meta, command: `REVIEW_TOKEN=${shq(secret)} ${f.command}` };
      const target = { backend: "herdr", binary: "/fake/herdr", socket: join(base, "h.sock"), protocol: 20, workspaceId: "w", paneId: "p", terminalId: "t" };
      if (backend === "herdr") {
        meta = { ...meta, backend: "herdr", sessionTarget: target };
        delete meta.tmux;
        writeFileSync(f.baselinePath, JSON.stringify({ ...readJson(f.baselinePath), runtime: { launched: true, sessionTarget: target } }));
      }
      writeFileSync(join(f.home, "instance.json"), JSON.stringify(meta));
      const baseline = readFileSync(f.baselinePath, "utf8");
      const io = { exec: (binary, args) => {
        if (binary === "ps") return "100 1 /bin/zsh\n";
        if (args.includes("list-panes")) {
          if (backend === "new-window") throw Object.assign(new Error("absent"), { stderr: "can't find window: agent" });
          return "%1\t0\tzsh\t100\n";
        }
        if (args.includes("list-windows")) return "hq\n";
        if (args.join(" ") === "api snapshot") return JSON.stringify({ result: { snapshot: { protocol: 20, panes: [{ pane_id: "p", terminal_id: "t" }] } } });
        if (args[1] === "process-info") return JSON.stringify({ result: { process_info: { foreground_processes: [{ name: "zsh" }] } } });
        assert.ok(args.includes("respawn-pane") || args.includes("new-window") || args[1] === "run");
        throw Object.assign(new Error(`Command failed: ${binary} ${args.join(" ")}`), failure);
      } };
      assert.throws(() => startInstanceSession(f.home, { io }), (e) => e.code === "E_SESSION_START_FAILED" && !e.message.includes(secret) && /evidence is retained/.test(e.message));
      assert.ok(readJson(join(f.home, ".oats-start-pending.json")).command.includes(secret));
      assert.deepEqual(readJson(join(f.home, "instance.json")), meta);
      assert.equal(readFileSync(f.baselinePath, "utf8"), baseline);
    }
  }
});

test("successful launch responses omit the private launch command too", () => {
  const f = makeHome("private-result");
  const secret = "SYNTHETIC_RESPONSE_SECRET";
  writeFileSync(join(f.home, "instance.json"), JSON.stringify({ ...f.meta, command: `REVIEW_TOKEN=${shq(secret)} ${f.command}` }));
  const io = { exec: (binary, args) => {
    if (args.includes("list-panes")) throw Object.assign(new Error("absent"), { stderr: "can't find window: private-result" });
    if (args.includes("list-windows")) return "hq\n";
    assert.ok(args.includes("new-window"));
    return "";
  } };
  const result = startInstanceSession(f.home, { io });
  assert.equal("command" in result, false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.ok(readJson(join(f.home, "instance.json")).command.includes(secret));
});
