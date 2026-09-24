// bin/oats.mjs — inspect / readiness / operation run on the workspace model (lead decision 4;
// contract answers of 2026-09-24): new integers (operationsApi 2, soulsApi 2, readinessApi 2),
// an instance or soul subject, checks installed | configured | member | providers (trusted is
// gone), no classic scope/chain/team/levels in any payload.
//
// Runs the REAL CLI over the Northwind fixture, whose oats.okf declares two home operations and
// answers its binding check from its settings (the verbatim relay). Never bare
// `oats setup`; HOME, the remote cache and the tmux session are isolated.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildNorthwind } from "./fixtures/northwind/build.mjs";
import { inertRuntimePath } from "./helpers/runtime-stub.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const EXPECTED_MODULES = ["nw-deploy", "nw-house-style", "nw-release-tooling", "oats.core", "oats.okf"];

function oats(args, { cwd, env = {}, base }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env, PATH: inertRuntimePath(base), PI_AGENT_HOME: "", OATS_HOME: "", PI_AGENTS_ROOT: "",
      OATS_REMOTE_CACHE: join(base, "cache"), HOME: join(base, "home"),
      OATS_TMUX_SESSION: `none-${process.pid}`, PI_AGENTS_TMUX_SESSION: `none-${process.pid}`,
      ...env,
    },
  });
}
const ok = (r, what) => { assert.equal(r.status, 0, `${what}\n${r.stdout}\n${r.stderr}`); const d = JSON.parse(r.stdout); assert.equal(d.ok, true, what); return d.result; };
const refused = (r, code, what) => { assert.equal(r.status, 1, `${what}\n${r.stdout}\n${r.stderr}`); const e = JSON.parse(r.stdout).error; assert.equal(e.code, code, `${what}: ${e.message}`); return e; };
const noClassic = (doc, what) => {
  const text = JSON.stringify(doc);
  for (const k of ['"chain"', '"levels"', '"levelKind"', '"currentConfig"', '"trusted"', '"approved"', '"declaredAt"']) assert.ok(!text.includes(k), `${what}: no classic ${k}`);
  assert.equal(doc.scope, undefined, `${what}: no scope block`);
};

test("inspect / readiness / operation run over the workspace model: instance and soul subjects, new integers, member + providers checks, no classic payload", { timeout: 600_000 }, async () => {
  const base = mkdtempSync(join(tmpdir(), "oats-inspect-v2-"));
  try {
    const fx = await buildNorthwind(join(base, "fx"));
    // The fixture's oats.okf declares two home operations (status view, reindex action) and answers
    // the binding-check wire from its settings — what the Desktop captures from Northwind.
    const catalogFile = join(base, "catalog.json");
    writeFileSync(catalogFile, JSON.stringify({ packages: fx.catalog }, null, 2));
    const env = { OATS_PACKAGE_CATALOG: catalogFile };
    mkdirSync(join(base, "home"));
    const dep = join(base, "northwind-workspace");
    const agentsRoot = join(dep, "agents");
    mkdirSync(agentsRoot, { recursive: true });
    writeFileSync(join(dep, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${fx.refs.agents}\n`);
    const run = (...args) => oats([...args, "--json"], { cwd: dep, env, base });
    ok(run("sync", "--dir", dep), "sync");
    const home = ok(run("spawn", "release-manager", "--dir", dep, "--agents-root", agentsRoot, "--purpose", "x", "--work", "directory", "--no-launch", "--provider", "oats.okf", "state-dir=/tmp/x"), "spawn").home;

    // ---- inspect --home: the instance, from instance.json + its modules ----
    let doc = ok(run("inspect", "--home", home), "inspect --home");
    noClassic(doc, "inspect --home");
    assert.equal(doc.operationsApi, 2);
    assert.deepEqual(doc.subject, { kind: "instance", instance: "release-manager-x", home, soul: "release-manager" });
    assert.equal(doc.workspace.key, fx.keys.agents);
    assert.deepEqual(doc.capabilities.map((c) => c.id), EXPECTED_MODULES);
    const okf = doc.capabilities.find((c) => c.id === "oats.okf");
    assert.equal(okf.layer, "knowledge"); assert.equal(okf.from.kind, "package"); assert.equal(okf.from.package, "oats.okf");
    assert.equal(okf.settings["state-dir"], "/tmp/x", "the recorded merged payload");
    assert.deepEqual(okf.operations.map((o) => [o.name, o.kind, o.available]), [["status", "view", true], ["reindex", "action", true]]);
    assert.deepEqual(okf.operations[1].args.map((a) => [a.name, a.flag, a.required]), [["scope", "--scope", false]]);
    assert.deepEqual(doc.knowledge.operations.map((o) => o.name), ["status", "reindex"]);
    assert.equal(doc.layers.knowledge.id, "oats.okf");
    assert.equal(doc.souls.length, 1); assert.equal(doc.souls[0].soulsApi, 2); assert.equal(doc.souls[0].name, "release-manager");
    assert.ok(doc.instance.soulDir.includes("/souls/"), "the recorded per-commit soul directory");
    assert.match(doc.instance.instructions.text, /release/i);

    // ---- inspect --soul: the soul, from its resolution ----
    doc = ok(run("inspect", "--soul", "release-manager", "--dir", dep), "inspect --soul");
    noClassic(doc, "inspect --soul");
    assert.equal(doc.operationsApi, 2);
    assert.equal(doc.subject.kind, "soul"); assert.equal(doc.subject.soul, "release-manager"); assert.equal(doc.subject.repoKey, fx.keys.agents);
    assert.deepEqual(doc.capabilities.map((c) => c.id), EXPECTED_MODULES);
    assert.equal(doc.instance, null);
    assert.deepEqual(doc.capabilities.find((c) => c.id === "oats.okf").operations.map((o) => [o.name, o.available, o.reason]),
      [["status", false, "needs a running home (--home)"], ["reindex", false, "needs a running home (--home)"]], "a home operation needs a home");

    // ---- readiness --home ----
    let rd = ok(run("readiness", "--home", home), "readiness --home");
    noClassic(rd, "readiness --home");
    assert.equal(rd.readinessApi, 2);
    assert.deepEqual(rd.subject, { kind: "instance", instance: "release-manager-x", home, soul: "release-manager" });
    assert.deepEqual(Object.keys(rd.checks), ["installed", "configured", "member", "providers"]);
    assert.equal(rd.checks.installed.status, "pass");
    assert.deepEqual(rd.checks.installed.items.map((i) => i.subject).sort(), EXPECTED_MODULES);
    assert.equal(rd.checks.member.status, "pass", JSON.stringify(rd.checks.member));
    const prov = rd.checks.providers.items.find((i) => i.subject === "oats.okf");
    assert.deepEqual(prov.result, { status: "ready", problems: [], warnings: [] }, "the provider's check result, verbatim");
    assert.equal(prov.status, "pass");
    assert.equal(rd.summary.ready, true, JSON.stringify(rd.summary));

    // ---- readiness --soul: no --provider → the provider says needs-configuration, verbatim ----
    rd = ok(run("readiness", "--soul", "release-manager", "--dir", dep), "readiness --soul");
    noClassic(rd, "readiness --soul");
    assert.equal(rd.subject.kind, "soul"); assert.equal(rd.subject.soul, "release-manager");
    const p2 = rd.checks.providers.items.find((i) => i.subject === "oats.okf");
    assert.deepEqual(p2.result, { status: "needs-configuration", problems: [{ code: "needs-configuration", message: "setting state-dir is required (absolute host path)" }], warnings: [] });
    assert.equal(p2.status, "fail"); assert.equal(rd.summary.ready, false);

    // ---- --policy is kept; no subject → refused ----
    rd = ok(run("readiness", "--home", home, "--policy"), "readiness --policy");
    assert.equal(rd.policy.childSpawns.enforced, true);
    refused(run("readiness", "--dir", dep), "E_BAD_ARGS", "readiness without --soul/--home");

    // ---- a soul whose packages are not locked: installed fails with the typed refusal ----
    const lock = readFileSync(join(dep, "oats-lock.json"), "utf8");
    rmSync(join(dep, "oats-lock.json"));
    rd = ok(run("readiness", "--soul", "release-manager", "--dir", dep), "readiness without a lock");
    assert.equal(rd.checks.installed.status, "fail");
    assert.equal(rd.checks.installed.items[0].code, "E_PACKAGE_MISSING"); assert.match(rd.checks.installed.items[0].remedy, /oats sync/);
    writeFileSync(join(dep, "oats-lock.json"), lock);

    // ---- operation run on the workspace model: the home's module, operationsApi 2 ----
    let op = ok(run("operation", "run", "knowledge:status", "--home", home), "operation run status --home");
    assert.equal(op.operationsApi, 2); assert.equal(op.capability, "oats.okf"); assert.deepEqual(op.argv, ["okf", "status"]);
    assert.deepEqual(op.result.documents.map((d) => d.label), ["Status"]);
    assert.match(op.result.documents[0].text, /Instance: release-manager-x/);
    op = ok(run("operation", "run", "knowledge:reindex", "--home", home, "--arg", "scope=releases"), "operation run reindex --home");
    assert.equal(op.operationsApi, 2); assert.deepEqual(op.result, { status: "reindexed", scope: "releases" });
    refused(run("operation", "run", "knowledge:reindex", "--home", home, "--arg", "depth=2"), "E_BAD_ARGS", "an undeclared arg");
    refused(run("operation", "run", "knowledge:status", "--soul", "release-manager", "--dir", dep), "E_OPERATION_UNAVAILABLE", "a home operation for a soul");
    refused(run("operation", "run", "knowledge:nope", "--home", home), "E_OPERATION_UNKNOWN", "undeclared operation");

    // ---- an explicit standalone view (decision 10) is an allowed mode: member is not-applicable, not a required unknown ----
    const sa = join(base, "standalone-dep");
    mkdirSync(join(sa, "agents"), { recursive: true });
    writeFileSync(join(sa, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${fx.refs.data}\nstandalone: ${fx.refs.data}\n`);
    ok(oats(["sync", "--dir", sa, "--json"], { cwd: sa, env, base }), "sync standalone");
    rd = ok(oats(["readiness", "--soul", "data-analyst", "--dir", sa, "--json"], { cwd: sa, env, base }), "readiness --soul (standalone)");
    assert.equal(rd.checks.member.status, "not-applicable", JSON.stringify(rd.checks.member));
    const sm = rd.checks.member.items[0];
    assert.equal(sm.status, "not-applicable"); assert.equal(sm.required, false);
    assert.match(sm.reason, /^standalone view \(explicit\)/); assert.equal(sm.evidence.standaloneReason, "explicit");
    assert.equal(rd.checks.installed.status, "pass", JSON.stringify(rd.checks.installed));
    assert.equal(rd.summary.ready, true, JSON.stringify(rd.summary));
    assert.deepEqual(rd.summary.subjectBlockers, []);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
