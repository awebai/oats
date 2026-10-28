// `oats server roster` relays a host row's `sessionEnd` and prints a lost row as LOST (#1628).
// rosterGroups relays the key only when the host's status row has one of the contract's values
// (lib/session-resume-contract.mjs SESSION_END), as it relays `retire`; the CLI half runs the real
// kernel through a fake ssh and reads the roster's text and JSON over homes that read lost and stopped.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fakeBin } from "./helpers/fake-ssh.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { rosterGroups, writeServers } from "../lib/servers.mjs";
import { SESSION_END } from "../lib/session-resume-contract.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);

// ---- rosterGroups, against a host that answers with fixture rows ----

const base = mkdtempSync("/tmp/oats-rse-"); // short: the ssh control socket path under OATS_HOME_DIR must fit in 104 bytes
const prevHomeDir = process.env.OATS_HOME_DIR;
process.env.OATS_HOME_DIR = join(base, "oh");
test.after(() => {
  if (prevHomeDir === undefined) delete process.env.OATS_HOME_DIR; else process.env.OATS_HOME_DIR = prevHomeDir;
  rmSync(base, { recursive: true, force: true });
});
const HOME = (name) => `/srv/ws/agents/dev/instances/${name}`;
const hostRow = (name, extra = {}) => ({ instance: name, home: HOME(name), harness: "claude", running: false, tmux: { session: "oats-agents", window: name }, ...extra });

/** The one group rosterGroups builds from a fake host answering `status --json` with `rows`, plus a
 *  saved route (`dev-gone`) the host does not list. */
async function roster(rows, { server = "build" } = {}) {
  writeServers({ [server]: { sshHost: `${server}-host`, workspace: "/srv/ws" } });
  const snapDir = join(process.env.OATS_HOME_DIR, "remote", server);
  mkdirSync(snapDir, { recursive: true });
  writeFileSync(join(snapDir, "dev-gone.json"), JSON.stringify({ serverId: server, instance: "dev-gone", agent: "dev", home: HOME("dev-gone"), agentsRoot: "/srv/ws/agents", target: { sshHost: `${server}-host`, workspace: "/srv/ws", oatsPath: "oats" } }));
  const status = { root: "/srv/ws/agents", agents: [{ name: "dev", harness: "claude", instances: rows }] };
  const exec = async () => JSON.stringify(status);
  try {
    const out = await rosterGroups({ server, io: { execFileAsync: exec, serverId: `${server}-${Math.random()}` } });
    assert.equal(out.groups.length, 1);
    return out.groups[0];
  } finally { rmSync(snapDir, { recursive: true, force: true }); }
}
const rowOf = (group, name) => group.instances.find((r) => r.instance === name);

test("rosterGroups relays sessionEnd as the host's row has it: each of the contract's values, and no key when the host sends none", async () => {
  const g = await roster([
    hostRow("dev-lost", { sessionEnd: SESSION_END.LOST }), hostRow("dev-stopped", { sessionEnd: SESSION_END.STOPPED }),
    hostRow("dev-exited", { sessionEnd: SESSION_END.EXITED }), hostRow("dev-old"), hostRow("dev-run", { running: true }),
  ]);
  assert.equal(rowOf(g, "dev-lost").sessionEnd, "lost");
  assert.equal(rowOf(g, "dev-stopped").sessionEnd, "stopped");
  assert.equal(rowOf(g, "dev-exited").sessionEnd, "exited");
  for (const name of ["dev-old", "dev-run", "dev-gone"]) assert.equal(Object.hasOwn(rowOf(g, name), "sessionEnd"), false, `${name}: absent stays absent`);
  // A row without the key is the row it was: the relay adds one key and nothing else.
  const plain = rowOf(await roster([hostRow("dev-lost")]), "dev-lost");
  const { sessionEnd: _relayed, ...rest } = rowOf(g, "dev-lost");
  assert.deepEqual(rest, plain);
  assert.deepEqual(Object.keys(rest), Object.keys(plain), "and the other keys keep their order");
});

test("rosterGroups drops a sessionEnd that is not one of the contract's values", async () => {
  const bad = { "upper case": "LOST", "an unknown end": "crashed", "empty": "", "null": null, "a number": 1, "true": true, "an object": { end: "lost" }, "an array": ["lost"] };
  const g = await roster(Object.entries(bad).map(([what, sessionEnd], n) => hostRow(`dev-${n}`, { sessionEnd, note: what })));
  Object.keys(bad).forEach((what, n) => assert.equal(Object.hasOwn(rowOf(g, `dev-${n}`), "sessionEnd"), false, what));
});

// ---- the CLI, through a fake ssh ----

/** A spawned home made to read as launched and not running; `stopped` writes the stop record of its start. */
function launched(home, socket, stopped) {
  const path = join(home, "instance.json");
  const meta = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...meta, launched: true, startId: "s-1", tmux: { session: "oats-agents", window: meta.instance ?? "w", socket } }, null, 2) + "\n");
  if (stopped) writeFileSync(join(home, ".oats-stop.json"), JSON.stringify({ instance: "x", at: new Date().toISOString(), stop: {}, retained: [], startId: "s-1" }));
}
const rowLine = (stdout, name) => stdout.split("\n").find((l) => l.startsWith(`      • ${name} `));
const lineAfter = (stdout, name) => { const lines = stdout.split("\n"); return lines[lines.indexOf(rowLine(stdout, name)) + 1]; };

test("CLI: oats server roster carries sessionEnd in --json and prints LOST with the way back on the host", async (t) => {
  // Short: the ssh control socket path under OATS_HOME_DIR must fit in 104 bytes.
  const dir = realpathSync(mkdtempSync("/tmp/oats-rsec-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { bin, tools } = fakeBin(dir);
  // The host's tmux has no server: a launched home there reads not running.
  writeFileSync(join(bin, "tmux"), "#!/bin/sh\ncase \"$1\" in -V) echo 'tmux 3.4'; exit 0;; esac\necho 'no server running on /tmp/none' >&2\nexit 1\n"); chmodSync(join(bin, "tmux"), 0o755);
  const fx = v2Deployment({ souls: { dev: { soul: { work: "checkout" }, agents: "You are dev.\n" } } });
  t.after(() => fx.cleanup());
  const env = { ...process.env, PATH: bin, OATS_HOME_DIR: join(dir, "oats-home"), HOME: join(dir, "home") };
  for (const k of Object.keys(env)) if (/^(OATS_INSTANCE|PI_AGENT|TMUX$)/.test(k)) delete env[k];
  const oats = (args) => { const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env, cwd: dir }); if (r.error) throw r.error; return r; };
  let r = oats(["server", "add", "build", "--ssh", "build-host", "--workspace", fx.dep, "--oats", CLI, "--path", tools, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const home = {};
  for (const name of ["r-lost", "r-stopped", "r-never"]) {
    r = oats(["spawn", "dev", "--server", "build", "--name", name, "--no-launch", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    home[name] = JSON.parse(r.stdout).result.home;
  }
  launched(home["r-lost"], join(dir, "no-server.sock"), false);
  launched(home["r-stopped"], join(dir, "no-server.sock"), true);

  r = oats(["server", "roster", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const rows = Object.fromEntries(JSON.parse(r.stdout).result.groups[0].instances.map((i) => [i.instance, i]));
  assert.deepEqual([rows["r-lost"].running, rows["r-lost"].sessionEnd], [false, "lost"]);
  assert.deepEqual([rows["r-stopped"].running, rows["r-stopped"].sessionEnd], [false, "stopped"]);
  assert.equal(Object.hasOwn(rows["r-never"], "sessionEnd"), false, "a home never launched has none");

  r = oats(["server", "roster"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(rowLine(r.stdout, "r-lost"), "      • r-lost  LOST", r.stdout);
  assert.equal(lineAfter(r.stdout, "r-lost"), `          lost: on build-host, run oats session start --resume --home ${home["r-lost"]} there, or its next oats session resume`);
  assert.equal(rowLine(r.stdout, "r-stopped"), "      • r-stopped  idle", r.stdout);
  assert.equal(rowLine(r.stdout, "r-never"), "      • r-never  idle", r.stdout);
  assert.equal(r.stdout.split("\n").filter((l) => l.includes("lost:")).length, 1, "the way back once, under the lost row only");
});
