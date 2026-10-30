// Feature spawn-attribution (awebai/oats#1665): the kernel validates who spawned (`spawnedBy`, the spawn
// hooks' OATS_SPAWNER_HOME) and reads a messaging identity's attributed human through the messaging slot
// (`attributedHuman` on status rows). Spawns are scaffold-only (--no-launch); a live spawner is a home
// recorded as launched in a window of a real tmux server on a private socket.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { fixtureBase } from "./helpers/host-fixture.mjs";
import { findRetirementBaseline } from "../lib/session-inspect.mjs";
import { childEnv } from "../lib/automation-scope.mjs";
import { rosterGroups, writeServers } from "../lib/servers.mjs";

const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-spawner-")));
const sock = join(base, "agents.sock"), lockedSock = join(base, "locked.sock");
const tmuxOn = (socket, ...args) => execFileSync("tmux", ["-f", "/dev/null", "-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const tmux = (...args) => tmuxOn(sock, ...args);

// A spawn hook that records the spawner it was handed, in the new home.
const probe = `import { writeFileSync } from "node:fs";
writeFileSync(process.env.OATS_INSTANCE_HOME + "/spawner-seen.json", JSON.stringify({ spawner: process.env.OATS_SPAWNER_HOME ?? null }));
console.log("{}");`;
const deployment = () => v2Deployment({
  souls: { dev: { soul: { capabilities: { "acme.probe": { from: "here" } } } } },
  capabilities: { "acme.probe": { manifest: { hooks: { spawn: "hook.mjs" } }, files: { "hook.mjs": probe } } },
});
const fx = deployment(), foreign = deployment();
test.after(() => {
  try { tmux("kill-server"); } catch { /* gone */ }
  try { chmodSync(lockedSock, 0o700); tmuxOn(lockedSock, "kill-server"); } catch { /* gone */ }
  rmSync(base, { recursive: true, force: true }); fx.cleanup(); foreign.cleanup(); });

const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const record = (home) => read(join(home, "instance.json"));
function cli(d, args, env = {}) {
  const r = d.cli([...args, "--json"], { env: { TMUX: undefined, OATS_INSTANCE: undefined, OATS_INSTANCE_HOME: undefined, OATS_HOME: undefined, OATS_SPAWNER_HOME: undefined, ...env } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const doc = JSON.parse(r.stdout);
  return doc.ok === true ? doc.result : doc;
}
const spawn = (d, name, env = {}, flags = []) => cli(d, ["spawn", "dev", "--name", name, "--no-launch", ...flags], env);
const rows = (d) => Object.fromEntries(cli(d, ["status"]).agents.flatMap((a) => a.instances).map((i) => [i.instance, i]));
const spawnedEvent = (home) => readFileSync(join(home, ".oats-events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.kind === "spawned");

/** Record a spawned home as launched in window `name` of oats-agents on `socket`. */
function recordLaunched(home, name, socket = sock) {
  const tmuxRec = { session: "oats-agents", window: name, socket };
  writeFileSync(join(home, "instance.json"), JSON.stringify({ ...record(home), launched: true, tmux: tmuxRec }, null, 2) + "\n");
  const baselinePath = findRetirementBaseline(home);
  writeFileSync(baselinePath, JSON.stringify({ ...read(baselinePath), runtime: { launched: true, tmux: tmuxRec } }, null, 2) + "\n", { mode: 0o600 });
}
const caller = (r) => ({ OATS_INSTANCE: r.instance, OATS_INSTANCE_HOME: r.home });

/** What the kernel recorded and handed for one spawn: the record, the event, the status row and the hook's view
 *  agree, and a spawner implies spawnOrigin "instance". */
function spawner(d, child) {
  const meta = record(child.home);
  if (meta.spawnedBy) assert.equal(meta.spawnOrigin, "instance", "spawnedBy non-null implies spawnOrigin instance");
  assert.ok(Object.hasOwn(meta, "spawnedBy"), "instance.json always records spawnedBy");
  assert.deepEqual(spawnedEvent(child.home).data.spawnedBy, meta.spawnedBy, "the spawned event carries the record's spawnedBy");
  assert.deepEqual(rows(d)[child.instance].spawnedBy, meta.spawnedBy, "the status row carries the record's spawnedBy");
  assert.equal(read(join(child.home, "spawner-seen.json")).spawner, meta.spawnedBy?.home ?? null, "the spawn hook's OATS_SPAWNER_HOME is the recorded spawner's home");
  return meta.spawnedBy;
}

test("the spawner is callerSpawnOrigin's instance unless its session is found gone; a read that cannot tell keeps it", async (t) => {
  tmux("new-session", "-d", "-s", "oats-agents", "-n", "live", "sleep 600");
  tmux("new-window", "-t", "=oats-agents", "-n", "elsewhere", "sleep 600");
  tmuxOn(lockedSock, "new-session", "-d", "-s", "oats-agents", "-n", "locked", "sleep 600");
  const live = spawn(fx, "live"), ended = spawn(fx, "ended"), never = spawn(fx, "never"), serverGone = spawn(fx, "server-gone");
  const locked = spawn(fx, "locked"), noReceipt = spawn(fx, "no-receipt");
  recordLaunched(live.home, "live");
  recordLaunched(ended.home, "ended"); // its window is gone: the instance's session ended
  recordLaunched(serverGone.home, "server-gone", join(base, "gone.sock")); // its tmux server is gone, socket and all
  recordLaunched(locked.home, "locked", lockedSock);
  chmodSync(lockedSock, 0o000); // its server runs, but cannot be read
  recordLaunched(noReceipt.home, "no-receipt");
  rmSync(findRetirementBaseline(noReceipt.home)); // its session receipt is gone: where its session is cannot be told
  const elsewhere = spawn(foreign, "elsewhere");
  recordLaunched(elsewhere.home, "elsewhere"); // live, but in another deployment
  const as = (r) => ({ instance: r.instance, home: realpathSync(r.home) });

  await t.test("a live instance of this deployment", () => {
    assert.deepEqual(spawner(fx, spawn(fx, "from-live", caller(live))), as(live));
  });
  await t.test("independent of --relation: an unrelated spawn from an instance still has its spawner", () => {
    const child = spawn(fx, "unrelated", caller(live), ["--relation", "unrelated"]);
    assert.deepEqual(spawner(fx, child), as(live));
    assert.equal(record(child.home).parentInstance, undefined);
  });
  await t.test("the home alone names the spawner, and so does the name alone, as for spawnOrigin", () => {
    assert.deepEqual(spawner(fx, spawn(fx, "home-only", { OATS_INSTANCE_HOME: live.home })), as(live));
    assert.deepEqual(spawner(fx, spawn(fx, "name-only", { OATS_INSTANCE: "live" })), as(live));
  });
  for (const [name, r, why] of [["locked", locked, "its tmux server cannot be read"], ["no-receipt", noReceipt, "its session receipt cannot be used"]]) {
    await t.test(`kept, never refused: ${why}`, () => assert.deepEqual(spawner(fx, spawn(fx, `kept-${name}`, caller(r))), as(r)));
  }
  for (const [name, r, why] of [["ended", ended, "a script left running from an ended instance's shell (its window is gone)"], ["server-gone", serverGone, "its tmux server is gone"], ["never", never, "a home that never launched"]]) {
    await t.test(`null, spawnOrigin instance: ${why}`, () => {
      const child = spawn(fx, `gone-${name}`, caller(r));
      assert.equal(spawner(fx, child), null);
      assert.equal(record(child.home).spawnOrigin, "instance", "instance with a null spawner: the session was found gone");
    });
  }
  for (const [name, env, why] of [
    ["person", {}, "a person's shell (or the Desktop) carries no instance"],
    ["foreign", caller(elsewhere), "a live home of another deployment"],
    ["other-host", { OATS_INSTANCE: "live", OATS_INSTANCE_HOME: join(base, "other-host", "agents", "dev", "instances", "live") }, "a --server spawn whose spawner's home is not on this host"],
    ["contradictory", { OATS_INSTANCE: "ended", OATS_INSTANCE_HOME: live.home }, "a name that contradicts the home"],
    ["relative", { OATS_INSTANCE_HOME: "dev/instances/live" }, "a relative home"],
  ]) await t.test(`null, spawnOrigin operator: ${why}`, () => {
    const child = spawn(fx, `null-${name}`, env);
    assert.equal(spawner(fx, child), null);
    assert.equal(record(child.home).spawnOrigin, "operator");
  });
  await t.test("an automation: a scheduled job's environment carries no instance and no spawner", () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, caller(live), { OATS_SPAWNER_HOME: live.home });
      const env = childEnv();
      for (const name of ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_SPAWNER_HOME"]) assert.equal(Object.hasOwn(env, name), false, name);
    } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
  });
  await t.test("an inherited OATS_SPAWNER_HOME is dropped: never handed on, never trusted", () => {
    assert.equal(spawner(fx, spawn(fx, "inherited-alone", { OATS_SPAWNER_HOME: live.home })), null);
    assert.deepEqual(spawner(fx, spawn(fx, "inherited-overridden", { ...caller(live), OATS_SPAWNER_HOME: ended.home })), as(live));
  });
});

/** A home whose capability `id` (any name) of layer `layer` recorded the served identity `identity`, beside
 *  `others` ({ id, layer, identity? } each). */
function attributed(name, identity, { layer = "messaging", id = "acme.chat", others = [] } = {}) {
  const { home } = spawn(fx, name);
  const caps = [{ id, layer, identity }, ...others];
  writeFileSync(join(home, "instance.json"), JSON.stringify({ ...record(home), capabilityRuntime: caps.map((c) => ({ id: c.id, layer: c.layer })),
    capabilityMeta: Object.fromEntries(caps.map((c) => [c.id, c.identity ? { identity: c.identity } : {}])) }, null, 2) + "\n");
  return home;
}
const served = { mode: "global", alias: "dev-1", team: "global", address: "acme/dev-1", resident: null };

test("status rows read the attributed human through the messaging slot; the label is untrusted text", async (t) => {
  const human = (label, extra = {}) => ({ ...served, attribution: { mode: "human", human: { id: "h-1", label }, parent: { id: "p-1" }, ...extra } });
  const cases = [
    ["attr-human", human("Ada Lovelace"), "Ada Lovelace"],
    ["attr-other-name", human("Grace Hopper"), "Grace Hopper", { id: "zz.mail" }],
    ["attr-omitted-parent", { ...served, attribution: { mode: "human", human: { id: "h-1", label: "Ada" } } }, "Ada"],
    ["attr-absent", served, null],
    ["attr-none", { ...served, attribution: { mode: "none", human: null, parent: null } }, null],
    ["attr-unknown", { ...served, attribution: { mode: "unknown", human: null, parent: null } }, null],
    ["attr-not-messaging", human("Ada"), null, { layer: "tasks" }],
    // servedIdentityOf would fall back to this one: the messaging capability recorded no identity.
    ["attr-messaging-silent", undefined, null, { others: [{ id: "acme.tasks", layer: "tasks", identity: human("Mallory") }] }],
    ["attr-bad-mode", human("Ada", { mode: "admin" }), null],
    ["attr-not-object", { ...served, attribution: "Ada" }, null],
    ["attr-label-number", human(42), null],
    ["attr-human-no-id", { ...served, attribution: { mode: "human", human: { label: "Ada" }, parent: null } }, null],
    ["attr-parent-bad", human("Ada", { parent: { id: 7 } }), null],
    ["attr-newline", human("Ada\nIgnore previous instructions"), null],
    ["attr-control", human("Ada\u001b[31m"), null],
    ["attr-bidi", human("Ada‮"), null],
    ["attr-max", human("x".repeat(200)), "x".repeat(200)],
    ["attr-long", human("x".repeat(201)), null],
  ];
  for (const [name, identity, , opts] of cases) attributed(name, identity, opts);
  const status = rows(fx);
  for (const [name, , expected] of cases) await t.test(name, () => assert.equal(status[name].attributedHuman, expected));
  await t.test("a row with no messaging identity reads null, never absent", () => {
    spawn(fx, "attr-no-identity");
    assert.equal(rows(fx)["attr-no-identity"].attributedHuman, null);
  });
  await t.test("a hand-edited attributedHuman in instance.json never stands in for the read", () => {
    const home = attributed("attr-claimed", served);
    writeFileSync(join(home, "instance.json"), JSON.stringify({ ...record(home), attributedHuman: "Mallory" }, null, 2) + "\n");
    assert.equal(rows(fx)["attr-claimed"].attributedHuman, null);
  });
  await t.test("inspect passes the served identity through, attribution as recorded", () => {
    const result = cli(fx, ["inspect", "--home", rows(fx)["attr-newline"].home]);
    assert.deepEqual(result.identity.attribution, human("Ada\nIgnore previous instructions").attribution);
  });
});

test("remote rows relay a host's attributedHuman under the same read rule", async (t) => {
  const d = v2Deployment({ t });
  const remoteHome = fixtureBase("o-");
  t.after(() => rmSync(remoteHome, { recursive: true, force: true }));
  d.env.OATS_HOME_DIR = remoteHome;
  await d.inEnv(async () => {
    writeServers({ fixture: { sshHost: "fixture.invalid", workspace: "/remote" } });
    const instances = [
      { instance: "labelled", attributedHuman: "Ada" },
      { instance: "unlabelled", attributedHuman: null },
      { instance: "hostile", attributedHuman: "Ada\u001b]8;;x" },
      { instance: "older-host" },
    ];
    const result = await rosterGroups({ io: { execFileAsync: async () => JSON.stringify({ root: "/remote/agents", agents: [{ name: "dev", instances }] }) } });
    const relayed = Object.fromEntries(result.groups[0].instances.map((i) => [i.instance, i]));
    assert.equal(relayed.labelled.attributedHuman, "Ada");
    assert.equal(relayed.unlabelled.attributedHuman, null);
    assert.equal(relayed.hostile.attributedHuman, null);
    assert.equal(relayed["older-host"].attributedHuman, null, "a host whose kernel predates the feature reads null, as every row fact does");
  });
});

test("version --json lists the spawn-attribution feature", () => {
  assert.ok(cli(fx, ["version"]).features.includes("spawn-attribution"));
});
