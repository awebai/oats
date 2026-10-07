// Operator coverage (awebai/oats#671, #709): readiness and doctor warn when no soul the workspace offers
// composes oats.setup, for the workspace (`operator-soul-missing`) and for a team
// (`operator-team-uncovered`), and say `operator-coverage-unknown` when they cannot tell. Composition
// only, never a soul's name; disabled and unresolvable souls do not cover; warnings only (required:
// false): nothing refuses, spawns or writes. Doctor stays offline: it reads this machine's cache.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { git, v2Deployment } from "./helpers/v2-deployment.mjs";
import { packageRepo } from "./helpers/package-repo.mjs";

const SETUP = { "oats.setup": { from: "here" } };
const operatorItems = (doc) => doc.checks.configured.items.filter((i) => i.producer === "operator coverage");
const operatorProblems = (doc) => (doc.problems || []).filter((p) => p.code.startsWith("operator-"));
function ok(r, what) { assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`); const d = JSON.parse(r.stdout); assert.notEqual(d.ok, false, r.stdout); return d.result ?? d; }
const readiness = (fx, soul) => ok(fx.cli(["readiness", "--soul", soul, "--json"]), `readiness --soul ${soul}`);
const doctor = (fx) => ok(fx.cli(["doctor", "--json"]), "doctor");
function fixture(t, opts) { const fx = v2Deployment(opts); t.after(fx.cleanup); return fx; }
const synced = (fx) => { ok(fx.cli(["sync", "--json"]), "sync"); return fx; };

test("a member soul composing oats.setup covers the workspace and the teams it may join; a team none may join is uncovered, as a warning", (t) => {
  const fx = fixture(t, {
    souls: { dev: {}, bee: {}, ops: { soul: { capabilities: SETUP } } }, capabilities: { "oats.setup": { manifest: {} } },
    workspace: { teams: { global: { description: "g" }, a: { description: "a" }, b: { description: "b" } }, defaultTeam: "global",
      souls: { "ws/ops": { teams: ["a"] }, "ws/bee": { teams: ["b"] } } },
  });
  synced(fx);
  assert.deepEqual(operatorItems(readiness(fx, "dev")), [], "dev's only team (global) is covered by ops");
  assert.deepEqual(operatorItems(readiness(fx, "ops")), [], "the operator's own teams are covered");
  const bee = readiness(fx, "bee");
  const items = operatorItems(bee);
  assert.deepEqual(items.map((i) => [i.subject, i.code, i.status, i.required, i.label]), [["team b", "operator-team-uncovered", "fail", false, "b"]], "only bee's team b, which ops may not join");
  assert.match(items[0].reason, /oats\.setup/); assert.match(items[0].reason, /not a launched seat/);
  assert.match(items[0].remedy, /oats spawn <soul> --preview/);
  assert.ok(!bee.summary.subjectBlockers.some((b) => b.subject.startsWith("team b")), "a warning never blocks readiness");
  // Doctor reports every declared team, offline.
  assert.deepEqual(operatorProblems(doctor(fx)).map((p) => [p.code, p.label]), [["operator-team-uncovered", "b"]]);
});

test("no soul composes oats.setup: operator-soul-missing names the declared-but-unusable ones (disabled, unresolvable, an emptied slot); a soul's name never counts; no teams, no team items; nothing written", (t) => {
  const fx = fixture(t, {
    souls: {
      dev: {}, "oats-operator-expert": {},
      off: { soul: { capabilities: SETUP } },
      broken: { soul: { capabilities: { ...SETUP, nope: { from: "here" } } } },
      mute: { soul: { knowledge: "none", capabilities: SETUP } },
    },
    capabilities: { "oats.setup": { manifest: {} }, notes: { manifest: { layer: "knowledge" } } },
    local: { souls: { disabled: ["off"] } },
  });
  fx.commit({ "oats-workspace.yaml": { yaml: { schemaVersion: 2, name: "fixture", members: [fx.ref], teams: {},
    defaults: { knowledge: { notes: { from: fx.key } }, messaging: "none", tasks: "none" } } } }, "no teams; knowledge for every soul");
  synced(fx);
  for (const soul of ["dev", "oats-operator-expert"]) {
    const items = operatorItems(readiness(fx, soul));
    assert.deepEqual(items.map((i) => [i.subject, i.code, i.status, i.required]), [["operator", "operator-soul-missing", "fail", false]], `${soul}: the workspace item only (no teams)`);
    assert.deepEqual(items[0].evidence.excluded.map((x) => [x.soul, x.code]).sort(), [["ws/broken", "E_CAPABILITY_MISSING"], ["ws/mute", "slot-none"], ["ws/off", "E_SOUL_DISABLED"]]);
    assert.deepEqual(items[0].evidence.excluded.find((x) => x.soul === "ws/mute").slots, ["knowledge"]);
    assert.match(items[0].reason, /no soul workspace fixture offers composes oats\.setup/);
  }
  const before = readdirSync(fx.root).sort();
  assert.deepEqual(operatorProblems(doctor(fx)).map((p) => p.code), ["operator-soul-missing"]);
  assert.deepEqual(readdirSync(fx.root).sort(), before, "doctor writes nothing");
  assert.ok(before.every((d) => !existsSync(join(fx.root, d, "instances"))), "no instance was spawned");
});

test("a package soul composing oats.setup covers the workspace", (t) => {
  const pkg = packageRepo({ manifest: { capabilities: ["capabilities/acme-tool", "capabilities/oats.setup"] },
    files: { "capabilities/oats.setup/oats.json": { capability: "oats.setup", version: "1.0.0", description: "setup", compatibility: { oats: ">=0.24.0" } } },
    souls: { keeper: { soul: { capabilities: { "acme-tool": { from: "here" }, ...SETUP } } } } });
  t.after(pkg.cleanup);
  const fx = synced(fixture(t, { workspace: { defaultTeam: "global", packages: { "acme.pkg": `${pkg.ref}@v1.0.0` } } }));
  assert.deepEqual(operatorItems(readiness(fx, "dev")), []);
  assert.deepEqual(operatorProblems(doctor(fx)), [], "doctor resolves the package soul from the cache");
});

test("an external soul composing oats.setup covers the workspace", (t) => {
  const fx = fixture(t, { capabilities: { "oats.setup": { manifest: {} } } });
  // The external soul's repository: one soul that takes oats.setup from the workspace's member.
  const bare = join(fx.base, "remotes", "experts.git"), seed = join(fx.base, "experts-seed");
  git(fx.base, "init", "-q", "--bare", bare); git(fx.base, "clone", "-q", bare, seed);
  mkdirSync(join(seed, "souls", "ext"), { recursive: true });
  writeFileSync(join(seed, "souls", "ext", "soul.yaml"), YAML.stringify({ schemaVersion: 2, name: "ext", description: "external operator.", work: "directory", capabilities: { "oats.setup": { from: fx.key } } }));
  writeFileSync(join(seed, "souls", "ext", "AGENTS.md"), "# ext\n");
  git(seed, "add", "-A"); git(seed, "commit", "-qm", "ext"); git(seed, "push", "-q", "origin", "HEAD:main");
  const commit = git(seed, "rev-parse", "HEAD");
  fx.commit({ "oats-workspace.yaml": { yaml: { schemaVersion: 2, name: "fixture", members: [fx.ref], teams: { global: { description: "g" } }, defaultTeam: "global",
    defaults: { knowledge: "none", messaging: "none", tasks: "none" }, external: [{ source: `${pathToFileURL(bare).href}@${commit}`, soul: "souls/ext" }] } } }, "external operator");
  synced(fx);
  assert.deepEqual(operatorItems(readiness(fx, "dev")), []);
  assert.deepEqual(operatorProblems(doctor(fx)), []);
});

test("coverage that cannot be read is unknown, never missing: doctor without a cache, readiness with the workspace unreadable", (t) => {
  const fx = fixture(t, {});
  assert.deepEqual(operatorProblems(doctor(fx)), [], "never synced: nothing cached");
  assert.ok(doctor(fx).information.some((l) => /^operator-coverage-unknown: .*oats sync/.test(l)), "doctor says unknown and names the fix");
  synced(fx);
  // The fixture declares team global with no default team: no soul may join it, operator or not.
  assert.deepEqual(operatorProblems(doctor(fx)).map((p) => [p.code, p.label]), [["operator-soul-missing", undefined], ["operator-team-uncovered", "global"]], "with the cache: known, and missing");
  const home = ok(fx.cli(["spawn", "dev", "--purpose", "p", "--no-launch", "--json"]), "spawn").home;
  rmSync(join(fx.base, "cache"), { recursive: true, force: true });
  const offline = doctor(fx);
  assert.deepEqual(operatorProblems(offline), [], "no cache: no absence asserted");
  assert.ok(offline.information.some((l) => l.startsWith("operator-coverage-unknown:")));
  renameSync(join(fx.base, "remotes", "ws.git"), join(fx.base, "remotes", "gone.git"));
  const doc = ok(fx.cli(["readiness", "--home", home, "--json"], { cwd: home, env: { OATS_INSTANCE_HOME: home } }), "readiness --home");
  assert.deepEqual(operatorItems(doc).map((i) => [i.subject, i.code, i.status, i.required]), [["operator", "operator-coverage-unknown", "unknown", false]]);
  assert.match(operatorItems(doc)[0].reason, /the workspace could not be read/);
  assert.match(operatorItems(doc)[0].remedy, /oats workspace status/);
});
