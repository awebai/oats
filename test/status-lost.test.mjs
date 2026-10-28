// `oats status` text prints a lost session as LOST (#1617): the word of each row (lib/status-words.mjs)
// from fixture rows, and the line under a LOST row that names the way back, local and `--server`; then
// the real CLI over homes that read lost, stopped, exited and never launched, here and through a fake
// ssh. The JSON is not this module's: the status rows' `sessionEnd` is lib/session-end.mjs's.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fakeBin } from "./helpers/fake-ssh.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { livenessWord, lostLine, statusWord } from "../lib/status-words.mjs";
import { SESSION_END } from "../lib/session-resume-contract.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const HOME = "/srv/agents/dev/instances/dev-1";
const LOCAL_LINE = `lost: oats session start --resume --home ${HOME} brings it back; so does the next oats session resume (run when OATS Desktop or oats tui opens) if it can vouch for the loss`;
const REMOTE_LINE = `lost: on build-host, run oats session start --resume --home ${HOME} there, or its next oats session resume`;

test("the word and the way back, from fixture rows", () => {
  const rows = [
    ["lost", { running: false, sessionEnd: SESSION_END.LOST }, "LOST", true],
    ["stopped", { running: false, sessionEnd: SESSION_END.STOPPED }, "idle", false],
    ["exited", { running: false, sessionEnd: SESSION_END.EXITED }, "idle", false],
    ["no sessionEnd (never launched, or a host's older kernel)", { running: false }, "idle", false],
    ["a sessionEnd that is not one of the three", { running: false, sessionEnd: "LOST" }, "idle", false],
    ["running", { running: true }, "RUNNING", false],
    ["running, with a stale lost", { running: true, sessionEnd: SESSION_END.LOST }, "RUNNING", false],
    ["running null", { running: null }, "unknown", false],
    ["running null, with lost", { running: null, sessionEnd: SESSION_END.LOST }, "unknown", false],
    ["running absent", {}, "unknown", false],
    ["retirePending wins over lost", { running: false, sessionEnd: SESSION_END.LOST, retirePending: true }, "RETIRING", false],
    ["retirePending wins over running", { running: true, retirePending: true }, "RETIRING", false],
    ["retirePending wins over unknown", { running: null, retirePending: true }, "RETIRING", false],
    ["a background row reads the same", { running: false, sessionEnd: SESSION_END.LOST, background: true }, "LOST", true],
  ];
  for (const [what, fields, word, lost] of rows) {
    const row = { instance: "dev-1", home: HOME, ...fields };
    assert.equal(statusWord(row), word, what);
    if (!row.retirePending) assert.equal(livenessWord(row), word, what);
    assert.equal(lostLine(row), lost ? LOCAL_LINE : null, `${what}: local`);
    assert.equal(lostLine(row, { host: "build-host" }), lost ? REMOTE_LINE : null, `${what}: --server`);
  }
});

test("the way back: a home that needs quoting, a row without a home, text the kernel did not write", () => {
  const lost = { running: false, sessionEnd: SESSION_END.LOST };
  assert.equal(lostLine({ ...lost, home: "/srv/my agents/it's" }), `lost: oats session start --resume --home '/srv/my agents/it'\\''s' brings it back; so does the next oats session resume (run when OATS Desktop or oats tui opens) if it can vouch for the loss`);
  assert.equal(lostLine(lost), "lost: the next oats session resume (run when OATS Desktop or oats tui opens) brings it back if it can vouch for the loss", "no home: only the sweep");
  assert.equal(lostLine(lost, { host: "h" }), "lost: on h, run oats session resume there");
  const line = lostLine({ ...lost, home: "/srv/a\u001b[2Jb" }, { host: "h\nx" });
  assert.doesNotMatch(line, /[\u001b\n]/, "a host's path or a registered host name cannot write to the terminal");
});

// ---- the CLI ----

/** A spawned home made to read as launched and not running: its recorded tmux socket has no server.
 *  `ends` writes what makes it read stopped or exited; nothing is lost. */
function launched(home, socket, ends) {
  const path = join(home, "instance.json");
  const meta = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...meta, launched: true, startId: "s-1", tmux: { session: "oats-agents", window: meta.instance ?? "w", socket } }, null, 2) + "\n");
  if (ends === "stopped") writeFileSync(join(home, ".oats-stop.json"), JSON.stringify({ instance: "x", at: new Date().toISOString(), stop: {}, retained: [], startId: "s-1" }));
  if (ends === "exited") writeFileSync(join(home, ".oats-start-exited"), '{"startId":"s-1","status":0}\n');
}
const rowLine = (stdout, name) => stdout.split("\n").find((l) => l.startsWith(`      • ${name} `) || l.startsWith(`      • ${name}  `));
const lineAfter = (stdout, name) => { const lines = stdout.split("\n"); return lines[lines.findIndex((l) => l === rowLine(stdout, name)) + 1]; };

test("CLI: oats status prints LOST and the way back for a lost home only", async (t) => {
  const fx = v2Deployment();
  t.after(() => fx.cleanup());
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "oats-status-lost-"))); t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const socket = join(scratch, "no-server.sock");
  const homes = {};
  for (const [name, ends] of [["s-lost", "lost"], ["s-stopped", "stopped"], ["s-exited", "exited"], ["s-never", null]]) {
    homes[name] = (await fx.spawn("dev", { name })).home;
    if (ends) launched(homes[name], socket, ends);
  }
  const json = fx.cli(["status", "--json"]);
  assert.equal(json.status, 0, json.stderr);
  const rows = Object.fromEntries(JSON.parse(json.stdout).agents.flatMap((a) => a.instances).map((i) => [i.instance, i]));
  assert.deepEqual(Object.fromEntries(Object.entries(rows).map(([k, i]) => [k, [i.running, i.sessionEnd]])),
    { "s-lost": [false, "lost"], "s-stopped": [false, "stopped"], "s-exited": [false, "exited"], "s-never": [false, undefined] }, "the fixture's homes read as meant");

  const text = fx.cli(["status"]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(rowLine(text.stdout, "s-lost"), /^ {6}• s-lost {2}LOST {2}\(branch /, text.stdout);
  assert.equal(lineAfter(text.stdout, "s-lost"), `          lost: oats session start --resume --home ${homes["s-lost"]} brings it back; so does the next oats session resume (run when OATS Desktop or oats tui opens) if it can vouch for the loss`);
  for (const name of ["s-stopped", "s-exited", "s-never"]) assert.match(rowLine(text.stdout, name), new RegExp(`^ {6}• ${name} {2}idle {2}\\(branch `), name);
  assert.equal(text.stdout.split("\n").filter((l) => l.includes("lost:")).length, 1, "the way back once, under the lost row only");
});

test("CLI: oats status --server prints LOST and names the host to run the way back on", async (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-status-lost-server-"))); t.after(() => rmSync(base, { recursive: true, force: true }));
  const { bin, tools } = fakeBin(base);
  // The host's tmux has no server: a launched home there reads not running.
  writeFileSync(join(bin, "tmux"), "#!/bin/sh\ncase \"$1\" in -V) echo 'tmux 3.4'; exit 0;; esac\necho 'no server running on /tmp/none' >&2\nexit 1\n"); chmodSync(join(bin, "tmux"), 0o755);
  const fx = v2Deployment({ souls: { dev: { soul: { work: "checkout" }, agents: "You are dev.\n" } } });
  t.after(() => fx.cleanup());
  const env = { ...process.env, PATH: bin, OATS_HOME_DIR: join(base, "oats-home"), HOME: join(base, "home") };
  for (const k of Object.keys(env)) if (/^(OATS_INSTANCE|PI_AGENT|TMUX$)/.test(k)) delete env[k];
  const oats = (args) => { const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env, cwd: base }); if (r.error) throw r.error; return r; };
  let r = oats(["server", "add", "build", "--ssh", "build-host", "--workspace", fx.dep, "--oats", CLI, "--path", tools, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const home = {};
  for (const name of ["r-lost", "r-stopped"]) {
    r = oats(["spawn", "dev", "--server", "build", "--name", name, "--no-launch", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    home[name] = JSON.parse(r.stdout).result.home;
  }
  launched(home["r-lost"], join(base, "no-server.sock"), "lost");
  launched(home["r-stopped"], join(base, "no-server.sock"), "stopped");
  r = oats(["status", "--server", "build", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const rows = Object.fromEntries(JSON.parse(r.stdout).result.agents.flatMap((a) => a.instances).map((i) => [i.instance, i]));
  assert.deepEqual([rows["r-lost"].running, rows["r-lost"].sessionEnd, rows["r-stopped"].running, rows["r-stopped"].sessionEnd], [false, "lost", false, "stopped"], "the host's rows read as meant");

  r = oats(["status", "--server", "build"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(rowLine(r.stdout, "r-lost"), "      • r-lost  LOST", r.stdout);
  assert.equal(lineAfter(r.stdout, "r-lost"), `          lost: on build-host, run oats session start --resume --home ${home["r-lost"]} there, or its next oats session resume`);
  assert.equal(rowLine(r.stdout, "r-stopped"), "      • r-stopped  idle", r.stdout);
  assert.equal(r.stdout.split("\n").filter((l) => l.includes("lost:")).length, 1, "the way back once, under the lost row only");
});
