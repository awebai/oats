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
