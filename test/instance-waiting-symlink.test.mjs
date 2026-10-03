// awebai/oats#583: one home, two spellings. A deployment reached through a symlink (or whose
// agents root is a symlink) has a LEXICAL home, the path as the operator addressed it, and a
// REAL one, which a session start renders into $OATS_INSTANCE_HOME and writes its boundary
// rows under. Event rows are keyed by the home string, so every writer and reader must agree
// on one spelling (the real path) and on one workspace log (the deployment's own
// .agents/events), whichever spelling the caller passed. That is storage and matching: an
// answer names the home the way the caller did.
//
// Unlike every other test deployment, these are NOT realpath'd: the symlink is the point.
// The CLI finds no deployment whose own agents/ is a symlink (findRoot), so the symlinked
// deployment runs end to end through the CLI, and the symlinked agents root at library level
// and through `oats status` under PI_AGENTS_ROOT.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { liveWaiting, readEvents, recordStartBoundary, setWaiting } from "../lib/instance-events.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const REL = join("dev", "instances", "dev-1");
const LOG = "dev--dev-1.jsonl";

/** One bare home under two spellings, and the deployment it belongs to.
 *   deployment   <base>/sym → <base>/real, and the deployment was spawned into through sym
 *   agents-root  <base>/dep/agents → <base>/store/agents: the real home is outside <base>/dep */
function spellings(t, variant, { recorded } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-symlink-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  let real, sym, deployment, addressed, outside;
  if (variant === "deployment") {
    mkdirSync(join(base, "real", "agents", REL), { recursive: true });
    symlinkSync(join(base, "real"), join(base, "sym"));
    real = join(base, "real", "agents", REL); sym = join(base, "sym", "agents", REL);
    deployment = join(base, "real"); addressed = join(base, "sym"); outside = null;
  } else {
    mkdirSync(join(base, "store", "agents", REL), { recursive: true }); mkdirSync(join(base, "dep"));
    symlinkSync(join(base, "store", "agents"), join(base, "dep", "agents"));
    real = join(base, "store", "agents", REL); sym = join(base, "dep", "agents", REL);
    deployment = join(base, "dep"); addressed = deployment; outside = join(base, "store", ".agents");
  }
  // What a spawn records: the home and the deployment as the operator addressed them.
  writeFileSync(join(real, "instance.json"), JSON.stringify({ agent: "dev", instance: "dev-1", home: sym, createdAt: "2026-10-01T00:00:00.000Z", modules: {}, workspace: { deployment: recorded === undefined ? addressed : recorded(base) } }));
  return { base, real, sym, deployment, outside, workspaceLog: join(deployment, ".agents", "events", LOG) };
}
const rowsOf = (path) => readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const claim = (w) => (w ? { producer: w.producer, reason: w.reason, message: w.message } : null);
const PERMISSION = { producer: "oats.core", reason: "permission", message: null };

for (const variant of ["deployment", "agents-root"]) {
  test(`#583 ${variant} symlink: a claim set under the real path shows through the symlink spelling, and both spellings read one history`, (t) => {
    const s = spellings(t, variant);
    // The session: $OATS_INSTANCE_HOME is the real path.
    assert.equal(setWaiting(s.real, { producer: "oats.core", waiting: true, reason: "permission" }).changed, true);
    // Status: the home as the operator addressed the deployment.
    assert.deepEqual(claim(liveWaiting(s.sym)), PERMISSION, "status through the symlink shows the session's claim");
    assert.deepEqual(claim(liveWaiting(s.real)), PERMISSION);
    for (const home of [s.sym, s.real]) {
      const ev = readEvents(home);
      assert.equal(ev.home, home, "the answer names the home as the caller spelled it");
      assert.deepEqual(ev.events.map((e) => e.home), [home], "and so does each row, stored under the real path");
      assert.deepEqual(claim(ev.waitingOnYou), PERMISSION);
      assert.equal(ev.integrity.foreignRows, 0, "no spelling's rows are foreign to the other");
      assert.deepEqual(ev.integrity.sources.map((x) => x.status), ["ok", "ok"], "both logs are found from either spelling");
      assert.equal(ev.count, 1, "one row, in both logs");
    }
    // The same set through the other spelling changes nothing: it is the same claim.
    assert.equal(setWaiting(s.sym, { producer: "oats.core", waiting: true, reason: "permission" }).changed, false);
    assert.equal(rowsOf(join(s.real, ".oats-events.jsonl")).length, 1);
  });

  test(`#583 ${variant} symlink: a start boundary recorded under the real path voids a claim set through the symlink spelling`, (t) => {
    const s = spellings(t, variant);
    assert.equal(setWaiting(s.sym, { producer: "agent", waiting: true, reason: "attention", message: "x" }).changed, true);
    assert.equal(claim(liveWaiting(s.sym))?.producer, "agent");
    // A restart: the kernel records the boundary under the real path.
    const b = recordStartBoundary(s.real, { startId: "start-1", startedAt: new Date(Date.now() + 1000).toISOString(), harness: "claude", backend: "tmux", launchConfig: null, phase: "restart" });
    assert.equal(b.ok, true, JSON.stringify(b));
    assert.equal(liveWaiting(s.sym), null, "the restart voids the claim for status through the symlink");
    assert.equal(liveWaiting(s.real), null);
    assert.equal(readEvents(s.sym).waitingOnYou, null);
    // The same receipt, adopted again through the other spelling, finds its row in both logs.
    assert.deepEqual(recordStartBoundary(s.sym, { startId: "start-1", startedAt: new Date().toISOString(), harness: "claude", backend: "tmux", launchConfig: null, phase: "restart" }), { ok: true, existed: true });
  });

  test(`#583 ${variant} symlink: a clear through either spelling clears a claim set through the other`, (t) => {
    const s = spellings(t, variant);
    for (const [setHome, clearHome] of [[s.real, s.sym], [s.sym, s.real]]) {
      assert.equal(setWaiting(setHome, { producer: "agent", waiting: true, reason: "attention" }).changed, true);
      const cleared = setWaiting(clearHome, { producer: "agent", waiting: false });
      assert.equal(cleared.changed, true, "the clear finds the claim");
      assert.equal(cleared.home, clearHome, "the answer echoes the caller's spelling");
      assert.equal(liveWaiting(s.sym), null); assert.equal(liveWaiting(s.real), null);
    }
  });

  test(`#583 ${variant} symlink: every row records the real home, and both spellings write ONE workspace log, the deployment's own`, (t) => {
    const s = spellings(t, variant);
    setWaiting(s.real, { producer: "oats.core", waiting: true, reason: "question" });
    setWaiting(s.sym, { producer: "agent", waiting: true, reason: "attention" });
    recordStartBoundary(s.real, { startId: "start-1", startedAt: new Date(Date.now() + 1000).toISOString(), harness: "claude", backend: "tmux", launchConfig: null, phase: "start" });
    const home = rowsOf(join(s.real, ".oats-events.jsonl")), workspace = rowsOf(s.workspaceLog);
    assert.equal(home.length, 3);
    assert.deepEqual(workspace, home, "the workspace log holds the same rows");
    for (const r of home) assert.equal(r.home, s.real, `${r.kind} by ${r.producer} records the real path`);
    // The answer: every row, whichever spelling wrote it, in the spelling that asked.
    for (const asked of [s.sym, s.real]) {
      const ev = readEvents(asked);
      assert.equal(ev.home, asked); assert.equal(ev.count, 3); assert.equal(ev.integrity.foreignRows, 0);
      assert.deepEqual(ev.events.map((e) => e.home), [asked, asked, asked]);
      assert.deepEqual(ev.events.map((e) => ({ ...e, home: s.real })), home, "nothing else about a row changes");
    }
    assert.deepEqual(readdirSync(dirname(s.workspaceLog)), [LOG]);
    if (s.outside) assert.equal(existsSync(s.outside), false, "nothing is written outside the deployment, beside the real agents root");
  });
}

test("#583: a recorded deployment that does not hold the home is ignored, and the workspace log falls back to the home as the caller spelled it", (t) => {
  // Another directory, a relative path, not a string: none is the deployment of this home.
  for (const recorded of [(base) => join(base, "elsewhere"), () => "elsewhere", () => 7, () => null]) {
    const s = spellings(t, "deployment", { recorded });
    mkdirSync(join(s.base, "elsewhere", "agents", REL), { recursive: true }); // it exists, and holds ANOTHER home of that name
    assert.equal(setWaiting(s.sym, { producer: "oats.core", waiting: true, reason: "question" }).changed, true);
    assert.equal(setWaiting(s.real, { producer: "agent", waiting: true, reason: "attention" }).changed, true);
    assert.equal(rowsOf(s.workspaceLog).length, 2, "both spellings reach the deployment's log");
    assert.equal(existsSync(join(s.base, "elsewhere", ".agents")), false, "nothing is written under the recorded directory");
    assert.equal(readEvents(s.sym).count, 2);
  }
  // The limit: with no usable record, a symlinked agents root's home named by its REAL path
  // derives the directory beside the real agents root; named lexically, the deployment's.
  const s = spellings(t, "agents-root", { recorded: () => null });
  setWaiting(s.sym, { producer: "oats.core", waiting: true, reason: "question" });
  assert.equal(rowsOf(s.workspaceLog).length, 1);
  assert.equal(existsSync(s.outside), false);
  setWaiting(s.real, { producer: "agent", waiting: true, reason: "attention" });
  assert.equal(rowsOf(join(s.outside, "events", LOG)).length, 1, "the documented limit");
  assert.equal(rowsOf(s.workspaceLog).length, 1);
  // The home log, which status reads, is one file whatever the spelling.
  assert.equal(claim(liveWaiting(s.sym))?.producer, "agent");
});

// The CLI over a real deployment: a session that carries the real path, and `oats status`
// addressing the deployment through a symlink.
//   deployment   <base>/sym → the deployment; spawned and read with --dir <base>/sym
//   agents-root  <base>/agents-link → the deployment's agents/; read under PI_AGENTS_ROOT
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-symlink-cli-")));
const sock = join(base, "agents.sock");
const tmux = (...args) => execFileSync("tmux", ["-f", "/dev/null", "-u", "-S", sock, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const fixtures = [];
test.after(() => { try { tmux("kill-server"); } catch { /* gone */ } rmSync(base, { recursive: true, force: true }); for (const fx of fixtures) fx.cleanup(); });

/** Record the spawned home as launched in oats-agents:<name> on the private socket. */
function recordLaunched(real, name) {
  const meta = JSON.parse(readFileSync(join(real, "instance.json"), "utf8"));
  const tmuxRec = { session: "oats-agents", window: name, socket: sock };
  writeFileSync(join(real, "instance.json"), JSON.stringify({ ...meta, launched: true, tmux: tmuxRec }, null, 2) + "\n");
  const path = join(dirname(real), ".oats-retirement", "baselines", `${createHash("sha256").update(real).digest("hex")}.json`);
  const baseline = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...baseline, runtime: { launched: true, tmux: tmuxRec } }, null, 2) + "\n", { mode: 0o600 });
}

for (const variant of ["deployment", "agents-root"]) {
  test(`#583 ${variant} symlink, CLI: the session's attention shows on status through the symlink, a restart boundary voids it, and a clear from the session clears a claim set lexically`, () => {
    const fx = v2Deployment(); fixtures.push(fx);
    const name = variant === "deployment" ? "w-dep" : "w-root";
    const cli = (args, env = {}) => { const r = fx.cli(args, { cwd: fx.base, env: { TMUX: undefined, OATS_INSTANCE_HOME: undefined, OATS_HOME: undefined, ...env } }); return { ...r, doc: (() => { try { return JSON.parse(r.stdout.trim().split("\n").pop()); } catch { return null; } })() }; };
    // How the operator addresses the deployment, and the lexical home that gives.
    let dir, statusEnv, lexical;
    if (variant === "deployment") { dir = join(fx.base, "sym"); symlinkSync(fx.dep, dir); statusEnv = {}; lexical = join(dir, "agents", "dev", "instances", name); }
    else { const link = join(fx.base, "agents-link"); symlinkSync(fx.root, link); dir = fx.dep; statusEnv = { PI_AGENTS_ROOT: link }; lexical = join(link, "dev", "instances", name); }
    const spawned = cli(["spawn", "dev", "--name", name, "--no-launch", "--dir", dir, "--json"]);
    assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
    const real = realpathSync(lexical);
    assert.equal(real, join(fx.root, "dev", "instances", name)); assert.notEqual(lexical, real, "the fixture has two spellings");
    try { tmux("has-session", "-t", "oats-agents"); tmux("new-window", "-d", "-t", "oats-agents", "-n", name, "sleep 600"); }
    catch { tmux("new-session", "-d", "-s", "oats-agents", "-n", name, "sleep 600"); }
    recordLaunched(real, name);
    const row = () => { const r = cli(["status", "--dir", dir, "--json"], statusEnv); assert.equal(r.status, 0, r.stdout + r.stderr); return JSON.parse(r.stdout).agents.flatMap((a) => a.instances).find((i) => i.instance === name); };
    assert.equal(row().running, true);
    assert.equal(row().home, lexical, "status addresses the home lexically");

    // The agent, in its session: $OATS_INSTANCE_HOME is the real path.
    const att = cli(["instance", "attention", "--message", "x", "--json"], { OATS_INSTANCE_HOME: real });
    assert.equal(att.status, 0, att.stdout + att.stderr);
    assert.equal(att.doc.result.changed, true);
    assert.deepEqual(claim(row().waitingOnYou), { producer: "agent", reason: "attention", message: "x" }, "status through the symlink shows it");
    assert.deepEqual(claim(cli(["session", "inspect", "--home", lexical, "--json"]).doc.result.waitingOnYou), { producer: "agent", reason: "attention", message: "x" });
    // Events answer in the spelling they were asked in: the home under --dir (events drops
    // PI_AGENTS_ROOT), or an explicit --home.
    const underDir = join(dir, "agents", "dev", "instances", name);
    const events = cli(["instance", "events", name, "--dir", dir, "--json"]).doc.result;
    assert.equal(events.home, underDir); assert.equal(events.integrity.foreignRows, 0);
    assert.ok(events.events.length >= 2 && events.events.every((e) => e.home === underDir), "the spawn's rows and the session's are one history");
    if (variant === "deployment") assert.equal(underDir, row().home, "the same string the status row carries");
    assert.ok(readFileSync(join(real, ".oats-events.jsonl"), "utf8").trim().split("\n").every((l) => JSON.parse(l).home === real), "stored under the real path");
    assert.equal(att.doc.result.home, real, "attention answers $OATS_INSTANCE_HOME as given");

    // A restart's boundary, as the kernel records it: under the real path.
    assert.equal(recordStartBoundary(real, { startId: "start-1", startedAt: new Date().toISOString(), harness: "claude", backend: "tmux", launchConfig: null, phase: "restart" }).ok, true);
    assert.equal(row().waitingOnYou, null, "the restart voids the claim");

    // A new claim, set through the lexical home (an operator's --home), cleared from the session.
    const set = cli(["instance", "waiting", "set", "--producer", "oats.core", "--reason", "question", "--home", lexical, "--json"]);
    assert.equal(set.status, 0, set.stdout + set.stderr);
    assert.equal(set.doc.result.home, lexical);
    assert.equal(claim(row().waitingOnYou)?.producer, "oats.core");
    const clr = cli(["instance", "waiting", "clear", "--producer", "oats.core", "--json"], { OATS_INSTANCE_HOME: real });
    assert.equal(clr.status, 0, clr.stdout + clr.stderr);
    assert.equal(clr.doc.result.changed, true, "the session's clear finds the claim");
    assert.equal(row().waitingOnYou, null);
    // One workspace log, the deployment's.
    assert.deepEqual(readdirSync(join(fx.dep, ".agents", "events")).filter((f) => f.endsWith(`--${name}.jsonl`)), [`dev--${name}.jsonl`]);
    assert.equal(existsSync(join(fx.base, ".agents")), false, "no log beside the link");
  });
}
