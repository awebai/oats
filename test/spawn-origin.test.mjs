// Caller attribution is independent of lineage. Every launch is scaffold-only;
// the deployment helper supplies private HOME/cache/tmux paths and inert harnesses.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { rosterGroups, writeServers } from "../lib/servers.mjs";

const record = (r) => JSON.parse(readFileSync(join(r.home, "instance.json"), "utf8"));
const identity = (r) => ({ OATS_INSTANCE: r.instance, OATS_INSTANCE_HOME: r.home });
function cli(fx, args, env = {}) {
  const r = fx.cli([...args, "--json"], { env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const doc = JSON.parse(r.stdout);
  return doc.ok === true ? doc.result : doc;
}
const spawn = (fx, name, flags = [], env = {}) => cli(fx, ["spawn", "dev", "--name", name, "--no-launch", ...flags], env);
const rows = (fx, env = {}) => cli(fx, ["status"], env).agents.flatMap((a) => a.instances);
function check(fx, r, origin, lineage = {}) {
  const meta = record(r), row = rows(fx).find((i) => i.instance === r.instance);
  // CLI result uses parent/sibling; metadata and status retain the instance keys.
  for (const [key, resultKey] of [["parentInstance", "parent"], ["siblingInstance", "sibling"], ["relation", "relation"]]) {
    assert.equal(r[resultKey] ?? null, lineage[key] ?? null, `result ${key}`);
    assert.equal(meta[key] ?? null, lineage[key] ?? null, `metadata ${key}`);
    assert.equal(row[key] ?? null, lineage[key] ?? null, `status ${key}`);
  }
  assert.equal(meta.relativeTo ?? null, lineage.relativeTo ?? null);
  assert.equal(row.relativeTo ?? null, lineage.relativeTo ?? null);
  for (const [label, value] of [["result", r], ["metadata", meta], ["status", row]]) {
    assert.equal(value.spawnOrigin, origin, `${label} caller attribution`);
  }
}

test("caller and explicit lineage vary independently in result, metadata and status", { timeout: 120_000 }, async (t) => {
  const fx = v2Deployment({ t });
  const anchor = spawn(fx, "anchor");
  for (const [name, flags, env, origin, lineage] of [
    ["operator-child", ["--parent", "anchor"], {}, "operator", { parentInstance: "anchor", relation: "child", relativeTo: "anchor" }],
    ["instance-child", ["--parent", "anchor"], identity(anchor), "instance", { parentInstance: "anchor", relation: "child", relativeTo: "anchor" }],
    ["instance-top", [], identity(anchor), "instance", {}],
    ["operator-sibling", ["--relation", "sibling", "--relative-to", "anchor"], {}, "operator", { siblingInstance: "anchor", relation: "sibling", relativeTo: "anchor" }],
    ["instance-unrelated", ["--relation", "unrelated"], identity(anchor), "instance", {}],
    ["operator-parent", ["--relation", "parent", "--relative-to", "anchor"], {}, "operator", { relation: "parent", relativeTo: "anchor" }],
  ]) await t.test(name, () => check(fx, spawn(fx, name, flags, env), origin, lineage));
  assert.equal(record(anchor).parentInstance, "operator-parent", "parent relation still repoints its anchor");
  // Attached ownership supplies lineage, not the caller.
  const owner = spawn(fx, "owner", ["--work", "worktree"]);
  check(fx, spawn(fx, "attached", ["--work", "attached", "--work-dir", join(owner.home, "work")]), "operator", { parentInstance: "owner" });
});

test("only consistent extant same-deployment caller evidence qualifies", { timeout: 120_000 }, async (t) => {
  const fx = v2Deployment({ t }), foreign = v2Deployment({ t });
  const local = spawn(fx, "caller"), other = spawn(fx, "other");
  const elsewhere = spawn(foreign, "caller"); // same name, different deployment
  const invalidHome = join(fx.root, "dev", "instances", "invalid");
  mkdirSync(invalidHome);
  writeFileSync(join(invalidHome, "instance.json"), "{broken");
  const wrongNameHome = join(fx.root, "dev", "instances", "wrong-name");
  mkdirSync(wrongNameHome);
  writeFileSync(join(wrongNameHome, "instance.json"), JSON.stringify({ instance: "caller" }));
  // A foreign home aliased inside the local instances directory must not count.
  symlinkSync(elsewhere.home, join(fx.root, "dev", "instances", "escape"));
  for (const [name, env, origin] of [
    ["home-only", { OATS_INSTANCE_HOME: local.home }, "instance"],
    ["name-only", { OATS_INSTANCE: local.instance }, "instance"],
    ["arbitrary-name", { OATS_INSTANCE: "missing" }, "operator"],
    ["stale-home", { OATS_INSTANCE_HOME: join(fx.root, "dev", "instances", "gone") }, "operator"],
    ["foreign-home", identity(elsewhere), "operator"],
    ["contradictory", { OATS_INSTANCE: "other", OATS_INSTANCE_HOME: local.home }, "operator"],
    ["stale-with-name", { OATS_INSTANCE: "caller", OATS_INSTANCE_HOME: join(fx.base, "gone") }, "operator"],
    ["invalid-record", { OATS_INSTANCE_HOME: invalidHome }, "operator"],
    ["wrong-record-name", { OATS_INSTANCE_HOME: wrongNameHome }, "operator"],
    ["relative-home", { OATS_INSTANCE: "caller", OATS_INSTANCE_HOME: "agents/dev/instances/caller" }, "operator"],
    ["escaped-home", { OATS_INSTANCE_HOME: join(fx.root, "dev", "instances", "escape") }, "operator"],
    ["legacy-env", { OATS_HOME: local.home, PI_AGENT_HOME: local.home, PI_AGENT_INSTANCE: "caller" }, "operator"],
  ]) await t.test(name, () => check(fx, spawn(fx, name, [], env), origin));
  // Historical duplicate names are ambiguous without an explicit home.
  const duplicate = join(fx.root, "historical", "instances", "caller");
  mkdirSync(duplicate, { recursive: true });
  writeFileSync(join(duplicate, "instance.json"), JSON.stringify({ instance: "caller" }));
  await t.test("ambiguous-name", () => check(fx, spawn(fx, "ambiguous-name", [], { OATS_INSTANCE: "caller" }), "operator"));
  await t.test("home-disambiguates", () => check(fx, spawn(fx, "home-disambiguates", [], identity(local)), "instance"));
  // Merely running in an instance home supplies no env evidence.
  const fromHome = fx.cli(["spawn", "dev", "--name", "cwd-only", "--no-launch", "--json"], { cwd: other.home });
  assert.equal(fromHome.status, 0, fromHome.stdout + fromHome.stderr);
  assert.equal(fromHome.json().result.spawnOrigin, "operator");
});

test("recorded origins survive later observations and keyed replay; parent policy stays independent", { timeout: 120_000 }, () => {
  const fx = v2Deployment();
  try {
    const anchor = spawn(fx, "anchor");
    const preview = cli(fx, ["spawn", "dev", "--name", "historical", "--no-launch", "--preview"]);
    const flags = ["--expect-decision", preview.decision.revision, "--idempotency-key", "origin-replay"];
    const historical = spawn(fx, "historical", flags);
    const meta = record(historical);
    meta.spawnOrigin = "instance"; // preserved historical meaning, despite its operator caller
    writeFileSync(join(historical.home, "instance.json"), JSON.stringify(meta));
    const absent = spawn(fx, "absent");
    const old = record(absent); delete old.spawnOrigin;
    writeFileSync(join(absent.home, "instance.json"), JSON.stringify(old));
    const before = readFileSync(join(historical.home, "instance.json"), "utf8");
    const replay = spawn(fx, "historical", flags);
    assert.equal(replay.replayed, true);
    assert.equal(replay.spawnOrigin, "instance");
    for (const env of [{}, identity(anchor)]) {
      const current = rows(fx, env);
      assert.equal(current.find((i) => i.instance === "historical").spawnOrigin, "instance");
      assert.equal(current.find((i) => i.instance === "absent").spawnOrigin, undefined);
    }
    assert.equal(readFileSync(join(historical.home, "instance.json"), "utf8"), before);
    assert.equal(Object.hasOwn(record(absent), "spawnOrigin"), false);
    const blocked = spawn(fx, "blocked", ["--no-child-spawns"]);
    for (const env of [{}, identity(anchor)]) {
      const r = fx.cli(["spawn", "dev", "--name", "refused", "--no-launch", "--parent", "blocked", "--json"], { env });
      assert.notEqual(r.status, 0);
      assert.equal(r.json().error.code, "E_CHILD_SPAWNS_DISABLED");
    }
    check(fx, spawn(fx, "allowed-top", [], identity(blocked)), "instance");
  } finally { fx.cleanup(); }
});

test("remote rows relay host origins including historical and absent values", async (t) => {
  const fx = v2Deployment({ t });
  await fx.inEnv(async () => {
    writeServers({ fixture: { sshHost: "fixture.invalid", workspace: "/remote" } });
    const instances = [
      { instance: "operator-child", spawnOrigin: "operator", parentInstance: "anchor", relation: "child" },
      { instance: "instance-top", spawnOrigin: "instance" },
      { instance: "historical-child", spawnOrigin: "instance", parentInstance: "anchor", relation: "child" },
      { instance: "absent", parentInstance: "anchor", relation: "child" },
    ];
    const result = await rosterGroups({ io: { execFileAsync: async () => JSON.stringify({ root: "/remote/agents", agents: [{ name: "dev", instances }] }) } });
    assert.equal(result.groups[0].probe.ok, true);
    for (const host of instances) {
      const row = result.groups[0].instances.find((i) => i.instance === host.instance);
      assert.equal(row.spawnOrigin, host.spawnOrigin ?? null);
      assert.equal(row.parentInstance, host.parentInstance ?? null);
      assert.equal(row.relation, host.relation ?? null);
    }
  });
});
