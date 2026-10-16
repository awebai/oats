// `oats status` reads each row's liveness from the tmux socket the row recorded, never from the
// ambient $TMUX server (#347): a caller outside the agents' tmux (ssh, cron, a plain terminal)
// gets the same answer as `oats session inspect`. Real tmux servers on private sockets.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setWaiting } from "../lib/instance-events.mjs";
import { listInstances } from "../lib/core.mjs";
import { waitUntil } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-status-socket-")));
const sockets = { a: join(base, "a.sock"), b: join(base, "b.sock"), ambient: join(base, "ambient.sock") };
const tmux = (socket, ...args) => execFileSync("tmux", ["-f", "/dev/null", "-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const fx = v2Deployment();
test.after(() => {
  for (const socket of Object.values(sockets)) { try { tmux(socket, "kill-server"); } catch { /* gone */ } }
  rmSync(base, { recursive: true, force: true });
  fx.cleanup();
});

/** A spawned home recorded as launched in `session:window` on `socket`, receipt included. */
async function recordedHome(name, socket, session = "oats-agents") {
  const { home } = await fx.spawn("dev", { name });
  const meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  writeFileSync(join(home, "instance.json"), JSON.stringify({ ...meta, launched: true, tmux: { session, window: name, socket } }, null, 2) + "\n");
  const key = createHash("sha256").update(home).digest("hex");
  const baselinePath = join(dirname(home), ".oats-retirement", "baselines", `${key}.json`);
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  writeFileSync(baselinePath, JSON.stringify({ ...baseline, runtime: { launched: true, tmux: { session, window: name, socket } } }, null, 2) + "\n", { mode: 0o600 });
  return home;
}

test("status liveness follows each row's recorded socket, with TMUX unset or pointing at another server, as session inspect does", async () => {
  // Two agent servers, each with one live window, and an unrelated ambient server that has
  // windows of the same names (the ambient one must never answer for them).
  tmux(sockets.a, "new-session", "-d", "-s", "oats-agents", "-n", "on-a", "sleep 600");
  tmux(sockets.b, "new-session", "-d", "-s", "oats-agents", "-n", "on-b", "sleep 600");
  tmux(sockets.ambient, "new-session", "-d", "-s", "oats-agents", "-n", "gone-a", "sleep 600");
  tmux(sockets.ambient, "new-window", "-t", "oats-agents:", "-n", "gone-b", "sleep 600");
  const homes = {
    "on-a": await recordedHome("on-a", sockets.a),
    "on-b": await recordedHome("on-b", sockets.b),
    "gone-a": await recordedHome("gone-a", sockets.a),
    "gone-b": await recordedHome("gone-b", sockets.b),
  };
  const ambientPid = tmux(sockets.ambient, "display-message", "-p", "#{pid}");
  const inspected = Object.fromEntries(Object.entries(homes).map(([name, home]) => {
    const r = fx.cli(["session", "inspect", "--home", home, "--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return [name, r.json().result.present];
  }));
  assert.deepEqual(inspected, { "on-a": true, "on-b": true, "gone-a": false, "gone-b": false });
  // TMUX: undefined drops the variable from the child even when the runner itself runs inside tmux.
  for (const env of [{ TMUX: undefined }, { TMUX: `${sockets.ambient},${ambientPid},0` }]) {
    const r = fx.cli(["status", "--json"], { env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const rows = JSON.parse(r.stdout).agents.flatMap((a) => a.instances).filter((i) => i.instance in homes);
    assert.deepEqual(Object.fromEntries(rows.map((i) => [i.instance, i.running])), inspected, `TMUX=${env.TMUX ?? "(unset)"}`);
  }
});

test("a row whose recorded server is gone reads not running, and status still exits 0", async () => {
  const home = await recordedHome("server-gone", join(base, "never-started.sock"));
  const r = fx.cli(["status", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const row = JSON.parse(r.stdout).agents.flatMap((a) => a.instances).find((i) => i.home === home);
  assert.equal(row.running, false);
});

test("a row whose recorded server cannot be read is unknown, never not-running, and status still exits 0", async () => {
  // A socket path under a regular file fails lookup (ENOTDIR) the same way on Linux and macOS; a
  // regular file as the socket itself reads as "no server running" on Linux. Under a short /tmp
  // directory: the macOS temporary directory would make the path too long for a socket first.
  const short = mkdtempSync("/tmp/oats-ss-");
  test.after(() => rmSync(short, { recursive: true, force: true }));
  const notADirectory = join(short, "not-a-directory");
  writeFileSync(notADirectory, "x");
  const home = await recordedHome("server-unreadable", join(notADirectory, "x.sock"));
  const r = fx.cli(["status", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const row = JSON.parse(r.stdout).agents.flatMap((a) => a.instances).find((i) => i.home === home);
  assert.equal(row.running, null);
  assert.equal(row.runtimeState, "unreachable");
  assert.match(row.runtimeError, /Not a directory/);
  const text = fx.cli(["status"]);
  assert.equal(text.status, 0, text.stdout + text.stderr);
  const line = text.stdout.split("\n").find((l) => l.includes("• server-unreadable"));
  assert.match(line, /• server-unreadable  unknown .*Not a directory/, "the text status says unknown and why, never idle");
});


test("stop leaves a fallback shell: status and session inspect agree, while another harness stays running", async () => {
  const name = "stop-to-shell", session = "stop-test";
  tmux(sockets.a, "new-session", "-d", "-s", session, "-n", name, "sleep 600; exec /bin/sh");
  tmux(sockets.a, "new-window", "-t", `${session}:`, "-n", "still-running", "sleep 600");
  const home = await recordedHome(name, sockets.a, session);
  await recordedHome("still-running", sockets.a, session);
  let plan;
  await waitUntil(() => {
    const r = fx.cli(["instance", "stop", name, "--plan", "--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    plan = r.json().result;
    return plan.targets.every(t => t.session.present && t.session.state !== "shell");
  }, "the stand-in harness to be running");
  const stopped = fx.cli(["instance", "stop", name, "--apply", "--plan-revision", plan.planRevision,
    "--idempotency-key", "status-shell", "--json"]);
  assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
  assert.equal(stopped.json().result.results[0].stopped, true);
  assert.equal(stopped.json().result.results[0].state, "shell");
  const inspected = fx.cli(["session", "inspect", "--home", home, "--json"]);
  assert.equal(inspected.status, 0, inspected.stdout + inspected.stderr);
  assert.equal(inspected.json().result.state, "shell");
  assert.ok(tmux(sockets.a, "list-windows", "-t", session, "-F", "#{window_name}").split("\n").includes(name));
  const status = fx.cli(["status", "--json"]);
  assert.equal(status.status, 0, status.stdout + status.stderr);
  const rows = JSON.parse(status.stdout).agents.flatMap(a => a.instances);
  const row = rows.find(i => i.home === home);
  assert.deepEqual([row.running, row.runtimeState], [false, "shell"]);
  assert.equal(rows.find(i => i.instance === "still-running").running, true);
});

test("status batches pane and process reads across windows, using lifecycle shell classification", async () => {
  const session = "batch-test", names = ["batch-shell", "batch-wrapper", "batch-dead", "batch-split"];
  for (const name of names) {
    const home = await recordedHome(name, sockets.b, session);
    setWaiting(home, { producer: "agent", waiting: true, reason: "attention", message: "Review needed" });
  }
  const calls = [];
  const io = { exec(bin, args, opts) {
    if (bin === "ps" && args.join(" ") === "-axo pid=,ppid=,comm=") {
      calls.push({ bin, args });
      return "101 1 sh\n102 1 zsh\n103 102 /bin/sh\n104 103 /bin/sleep\n";
    }
    if (bin === "tmux" && args.includes(`=${session}`)) {
      calls.push({ bin, args });
      if (args.includes("list-windows")) return names.join("\n") + "\n";
      if (args.includes("list-panes")) return [
        "batch-shell\t%1\t0\tsh\t101", "batch-wrapper\t%2\t0\tzsh\t102",
        "batch-dead\t%3\t1\tsleep\t105", "batch-split\t%4\t0\tsleep\t106",
        "batch-split\t%5\t0\tsh\t107",
      ].join("\n") + "\n";
      assert.fail(`unexpected tmux call ${args}`);
    }
    return execFileSync(bin, args, opts);
  } };
  const rows = (await fx.inEnv(() => listInstances(fx.root, undefined, io))).flatMap(a => a.instances);
  const at = name => rows.find(i => i.instance === name);
  assert.deepEqual([at("batch-shell").running, at("batch-shell").runtimeState], [false, "shell"]);
  assert.equal(at("batch-wrapper").running, true, "a non-shell descendant keeps its wrapper running");
  assert.equal(at("batch-shell").waitingOnYou, null);
  assert.equal(at("batch-wrapper").waitingOnYou.message, "Review needed", "claims reuse the batch without a per-window read");
  assert.equal(at("batch-dead").running, false);
  assert.equal(at("batch-split").running, null, "lifecycle cannot inspect a split agent window");
  assert.equal(at("batch-split").runtimeState, "unreachable");
  assert.match(at("batch-split").runtimeError, /multiple panes/);
  assert.equal(calls.filter(c => c.bin === "tmux" && c.args.includes("list-windows")).length, 1);
  assert.equal(calls.filter(c => c.bin === "tmux" && c.args.includes("list-panes")).length, 1);
  assert.equal(calls.filter(c => c.bin === "ps").length, 1);
});


test("unreadable batched panes and failed process scans stay unknown, with one failed scan for all shells", async () => {
  const session = "read-failure", names = ["unread-shell-a", "unread-shell-b"];
  for (const name of names) await recordedHome(name, sockets.b, session);
  for (const failure of ["panes", "processes"]) {
    let psCalls = 0, paneCalls = 0;
    const io = { exec(bin, args, opts) {
      if (bin === "ps" && args.join(" ") === "-axo pid=,ppid=,comm=") {
        psCalls++;
        throw new Error("process scan unavailable");
      }
      if (bin === "tmux" && args.includes(`=${session}`)) {
        if (args.includes("list-windows")) return names.join("\n") + "\n";
        if (args.includes("list-panes")) {
          paneCalls++;
          if (failure === "panes") throw Object.assign(new Error("tmux failed"), { stderr: "pane read denied" });
          return names.map((name, i) => `${name}\t%${i + 1}\t0\tsh\t${101 + i}`).join("\n") + "\n";
        }
      }
      return execFileSync(bin, args, opts);
    } };
    const rows = (await fx.inEnv(() => listInstances(fx.root, undefined, io))).flatMap(a => a.instances).filter(i => names.includes(i.instance));
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.running, null);
      assert.equal(row.runtimeState, "unreachable");
      assert.equal(row.runtimeError, failure === "panes" ? "pane read denied" : "process scan unavailable");
    }
    assert.equal(paneCalls, 1);
    // Other fixtures may contain fallback shells; even then a failing scan is attempted only once.
    assert.ok(psCalls <= 1);
    if (failure === "processes") assert.equal(psCalls, 1);
  }
});
