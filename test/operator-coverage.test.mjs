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
// Doctor reads only this machine's cache: `oats souls` resolves every soul and keeps what doctor reads.
const resolvedHere = (fx) => { ok(fx.cli(["souls", "--json"]), "souls"); return fx; };
const unknownLines = (doc) => (doc.information || []).filter((l) => l.startsWith("operator-coverage-unknown:"));

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
  const fx = resolvedHere(synced(fixture(t, { workspace: { defaultTeam: "global", packages: { "acme.pkg": `${pkg.ref}@v1.0.0` } } })));
  const doc = doctor(fx); // before any readiness: what `oats souls` kept is enough
  assert.deepEqual([operatorProblems(doc), unknownLines(doc)], [[], []], "doctor resolves the package soul from the cache: known, and covered");
  assert.deepEqual(operatorItems(readiness(fx, "dev")), []);
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
  resolvedHere(synced(fx));
  const doc = doctor(fx);
  assert.deepEqual([operatorProblems(doc), unknownLines(doc)], [[], []], "known, and covered by the external soul");
  assert.deepEqual(operatorItems(readiness(fx, "dev")), []);
});

test("coverage that cannot be read is unknown, never missing: doctor without a cache, readiness with the workspace unreadable", (t) => {
  const fx = fixture(t, {});
  assert.deepEqual(operatorProblems(doctor(fx)), [], "never synced: nothing cached");
  assert.ok(unknownLines(doctor(fx)).some((l) => /oats sync, then oats souls/.test(l)), "doctor says unknown and names the fix");
  resolvedHere(synced(fx));
  // The fixture declares team global with no default team: no soul may join it, operator or not.
  assert.deepEqual(operatorProblems(doctor(fx)).map((p) => [p.code, p.label]), [["operator-soul-missing", undefined], ["operator-team-uncovered", "global"]], "with the cache: known, and missing");
  const home = ok(fx.cli(["spawn", "dev", "--purpose", "p", "--no-launch", "--json"]), "spawn").home;
  rmSync(join(fx.base, "cache"), { recursive: true, force: true });
  const offline = doctor(fx);
  assert.deepEqual(operatorProblems(offline), [], "no cache: no absence asserted");
  assert.equal(unknownLines(offline).length, 1);
  renameSync(join(fx.base, "remotes", "ws.git"), join(fx.base, "remotes", "gone.git"));
  const doc = ok(fx.cli(["readiness", "--home", home, "--json"], { cwd: home, env: { OATS_INSTANCE_HOME: home } }), "readiness --home");
  assert.deepEqual(operatorItems(doc).map((i) => [i.subject, i.code, i.status, i.required]), [["operator", "operator-coverage-unknown", "unknown", false]]);
  assert.match(operatorItems(doc)[0].reason, /the workspace could not be read/);
  assert.match(operatorItems(doc)[0].remedy, /oats workspace status/);
});

test("a source discovery could not read makes absence unknown, never missing; a covering soul found is still reported", async (t) => {
  const { discoverOrStandalone } = await import("../lib/instance-resolution.mjs");
  const { operatorCoverage, operatorProblems: problemsOf } = await import("../lib/operator-coverage.mjs");
  const { loadLocal } = await import("../lib/workspace.mjs");
  const { createReadSession } = await import("../lib/remote.mjs");
  // Discovery drops a member it cannot read (and records a soul file it cannot read as a problem) and carries on.
  const lost = { key: "local//nowhere/lost.git", ref: "file:///nowhere/lost.git", commit: null, confirmed: false, reason: "cannot-read", detail: "cannot read file:///nowhere/lost.git", souls: [], capabilities: [], publishes: null };
  const unreadableSoul = { code: "E_REMOTE_UNREADABLE", path: "souls/x/soul.yaml", message: "cannot read souls/x/soul.yaml" };
  const coverage = (fx, add) => fx.inEnv(async () => {
    const { local } = loadLocal(fx.dep);
    const remoteOptions = { cacheDir: fx.remoteOptions.cacheDir, session: createReadSession({}) };
    const d = await discoverOrStandalone(local, { deployment: fx.dep, remoteOptions });
    return operatorCoverage({ discovery: { ...d, ...add(d) }, local, teams: ["global"], remoteOptions });
  });
  const none = synced(fixture(t, { workspace: { defaultTeam: "global" } }));
  assert.equal((await coverage(none, () => ({}))).workspace.covered, false, "every source read: known absence");
  for (const add of [(d) => ({ members: [...d.members, lost] }), (d) => ({ problems: [...(d.problems || []), unreadableSoul] })]) {
    const c = await coverage(none, add);
    assert.equal(c.known, false, JSON.stringify(c));
    assert.match(c.reason, /cannot read/);
    assert.deepEqual(problemsOf(c).map((p) => p.code), ["operator-coverage-unknown"]);
  }
  const covered = synced(fixture(t, { souls: { dev: {}, ops: { soul: { capabilities: SETUP } } }, capabilities: { "oats.setup": { manifest: {} } }, workspace: { defaultTeam: "global" } }));
  const c = await coverage(covered, (d) => ({ members: [...d.members, lost] }));
  assert.deepEqual([c.known, c.workspace.covered, c.teams], [true, true, [{ label: "global", covered: true, by: "ws/ops" }]], "what was found covers, whatever else was unreadable");
});

test("every reason and remedy stays within the Desktop's 1024-character item text, however large its inputs", async () => {
  const { operatorCoverage, operatorProblems: problemsOf } = await import("../lib/operator-coverage.mjs");
  const huge = (c) => c.repeat(5000);
  // Unknown: many unreadable members and soul files, each with an oversized message.
  const discovery = { key: "local//w", workspace: { name: huge("w") }, members: Array.from({ length: 40 }, (_, i) =>
    ({ key: `local//m${i}`, confirmed: false, reason: "cannot-read", detail: huge("d"), souls: [], capabilities: [] })),
    problems: Array.from({ length: 40 }, () => ({ code: "E_REMOTE_UNREADABLE", path: huge("p"), message: huge("m") })) };
  const unknown = await operatorCoverage({ discovery, teams: ["global"] });
  assert.equal(unknown.known, false);
  // Known and missing: many excluded souls with oversized names, an oversized team label and workspace name.
  const missing = { known: true, workspace: { covered: false, by: null }, teams: [{ label: huge("t"), covered: false, by: null }],
    excluded: Array.from({ length: 40 }, (_, i) => ({ soul: `${huge("s")}${i}`, code: "E_CAPABILITY_MISSING" })) };
  const found = [...problemsOf(unknown, { unknownRemedy: huge("r") }), ...problemsOf(missing, { workspace: huge("w") })];
  assert.deepEqual(found.map((p) => p.code), ["operator-coverage-unknown", "operator-soul-missing", "operator-team-uncovered"]);
  for (const p of found) {
    assert.ok(p.message.length <= 1024, `${p.code} reason: ${p.message.length}`);
    assert.ok(p.remedy.length <= 1024, `${p.code} remedy: ${p.remedy.length}`);
  }
  assert.match(found[0].message, /and 77 more/, "a list shows three and a count");
  assert.match(found[1].message, /and 37 more/);
});
