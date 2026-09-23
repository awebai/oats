import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bytesIntegrity } from "../lib/portable-digest.mjs";
import { buildFreshPreparationRequest, inspectPortableOnboarding, preflightFreshDeployment } from "../lib/portable-onboarding.mjs";
import { oatsError } from "../lib/errors.mjs";

const W = "git:https://example.invalid/workspace.git", S = "git:https://example.invalid/source.git", C = "git:https://example.invalid/catalog.git";
const origin = { kind: "operator", document: { kind: "operator", id: "fresh-onboarding" }, pointer: "/source" };
function write(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value) + "\n"); }
function repositoryFixture() {
  const identity = (id) => ({ kind: "provider-repository", provider: "fixture", host: "example.invalid", id });
  const repos = new Map([
    [W, { identity: identity("workspace"), commit: "a".repeat(40), files: { "oats-workspace.yaml": {
      schemaVersion: 1, name: "Explicit workspace", members: [{ source: S, revision: "main" }],
      teams: { private: "per-human", wider: { provider: "example.messaging", id: "wider" } },
      catalogs: [{ source: C, revision: "main", path: "catalog.json" }],
      imports: [{ source: S, soul: "agents/expert", revision: "main", alias: "expert" }],
    } } }],
    [S, { identity: identity("source"), commit: "b".repeat(40), files: { "oats.yaml": {
      schemaVersion: 1, workspace: { source: W, revision: "main" },
      exports: { souls: [{ path: "agents/expert", definition: "agents/expert/soul.yaml" }], packages: [{ path: "oats-package" }] },
    }, "agents/expert/soul.yaml": { schemaVersion: 1, name: "expert", work: "directory" } } }],
    [C, { identity: identity("catalog"), commit: "c".repeat(40), files: { "catalog.json": { schemaVersion: 1, entries: [] } } }],
  ]);
  const calls = [], handles = new WeakMap();
  const repo = (source) => { const value = repos.get(source); if (!value) throw oatsError("source-unavailable", "fixture source absent"); return value; };
  const repositories = {
    identify(source) { calls.push({ kind: "identify", source }); return { source, identity: repo(source).identity, accessContextKey: "fresh-fixture" }; },
    observe(source, options) { const found = repo(source); calls.push({ kind: "observe", source, revision: options.revision ?? null });
      const value = { schemaVersion: 1, source: { identity: found.identity, remote: source, selector: options.revision ?? "main",
        commit: found.commit, provenance: [options.origin] }, accessContextKey: "fresh-fixture" }; handles.set(value, found); return value; },
    readFile(observation, path, { optional = false } = {}) { const found = handles.get(observation); calls.push({ kind: "read", source: observation.source.remote, path });
      if (!found || !Object.hasOwn(found.files, path)) { if (optional) return null; throw oatsError("export-not-found", "fixture document absent"); }
      const bytes = Buffer.from(JSON.stringify(found.files[path]));
      return { bytes, origin: { kind: "source", source: observation.source.remote, revision: observation.source.commit, path, integrity: bytesIntegrity(bytes) } }; },
  };
  return { repositories, calls };
}

test("fresh preflight allows ordinary project content but refuses known managed state without writes", (t) => {
  const raw = mkdtempSync(join(tmpdir(), "oats-fresh-preflight-")), deployment = realpathSync(raw);
  t.after(() => rmSync(deployment, { recursive: true, force: true }));
  mkdirSync(join(deployment, ".git")); write(join(deployment, "src/index.mjs"), "export default true;\n");
  write(join(deployment, "agents/expert/soul/soul.yaml"), "schemaVersion: 1\nname: expert\n");
  let result = preflightFreshDeployment({ deployment });
  assert.equal(result.status, "ready"); assert.deepEqual(result.managedState, []);
  assert.deepEqual(result.effects, { writes: false, deletes: false, installs: false, enrollment: false });
  write(join(deployment, "agents/other/soul/soul.yaml"), "schemaVersion: 1\nname: other\n");
  assert.throws(() => preflightFreshDeployment({ deployment, maxEntries: 1 }), { code: "resource-limit" });

  write(join(deployment, "oats-lock.json"), { lockfileVersion: 3, artifactSets: {}, selections: {} });
  mkdirSync(join(deployment, "agents/expert/instances/old"), { recursive: true });
  result = preflightFreshDeployment({ deployment });
  assert.equal(result.status, "separate-deployment-required");
  assert.ok(result.managedState.some((entry) => entry.kind === "selection-lock"));
  assert.ok(result.managedState.some((entry) => entry.kind === "instance-homes"));
  assert.match(result.advice[0], /separate fresh deployment path/);
  assert.equal(existsSync(join(deployment, "src/index.mjs")), true, "preflight never cleans existing project content");
});

test("explicit onboarding inspection separates source, deployment, work target, membership, teams and catalogs", (t) => {
  const raw = mkdtempSync(join(tmpdir(), "oats-fresh-inspect-")), root = realpathSync(raw), workTarget = join(root, "project"), deployment = join(root, "fresh-deployment");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(workTarget); mkdirSync(join(workTarget, ".git"));
  const f = repositoryFixture(), workspace = { source: W, revision: "main", origin }, member = { source: S, origin };
  const result = inspectPortableOnboarding({ deployment, workTarget, source: "expert", origin, workspace, member, catalogIndexes: [0] }, { repositories: f.repositories });
  assert.equal(result.status, "ready-for-preparation"); assert.equal(result.deployment.status, "ready");
  assert.equal(result.deployment.deployment.path, deployment); assert.equal(result.deployment.deployment.state, "absent");
  assert.equal(result.workTarget.path, workTarget); assert.equal(result.workTarget.git.present, true);
  assert.equal(result.source.location, S); assert.equal(result.source.identity.repository.id, "source");
  assert.equal(result.source.exportPath, "agents/expert"); assert.equal(result.workspace.identity.repository.id, "workspace");
  assert.equal(result.repositoryMembership.result.status, "eligible");
  assert.equal(result.context.kind, "workspace"); assert.equal(result.context.identity.repository.id, "workspace");
  assert.equal(result.teams.enrollment, "not-performed"); assert.equal(result.teams.privateTeamQualification, "not-evaluated");
  assert.equal(result.catalogs[0].source.identity.id, "catalog"); assert.equal(result.catalogs[0].document.path, "catalog.json");
  assert.deepEqual(result.effects, { deploymentWrites: false, repositoryReads: true, repositoryScratch: "caller-owned",
    installs: false, activation: false, credentials: false, teams: false, jobs: false });
  assert.equal(existsSync(deployment), false, "inspection does not create the deployment");

  const prepared = buildFreshPreparationRequest(result, { mode: "directory" });
  assert.equal(prepared.persisted, false); assert.equal(prepared.preparation.deployment, deployment);
  assert.deepEqual(prepared.preparation.source, result.source.reference);
  assert.deepEqual(prepared.preparation.workspace, workspace); assert.deepEqual(prepared.preparation.member, member);
  assert.deepEqual(Object.keys(prepared.preparation).sort(), ["allowLocalPaths", "deployment", "member", "mode", "origin", "source", "workTarget", "workspace"], "handoff is the exact public prepare input, with no private scratch directory");
  assert.equal(Object.hasOwn(prepared.preparation, "directory"), false);
  assert.equal(prepared.workTarget.path, workTarget); assert.equal(existsSync(deployment), false);
  assert.throws(() => buildFreshPreparationRequest(result, { directory: join(root, "private-scratch") }), { code: "invalid-declaration" });
});

test("supplied false-like workspace values cannot bypass explicit standalone context", t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oats-onboarding-workspace-presence-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = repositoryFixture(), input = { deployment: join(root, "fresh"), workTarget: root, origin,
    source: { source: S, soul: "agents/expert", revision: "main", alias: "standalone" } };
  for (const workspace of [null, false, 0, ""]) {
    assert.throws(() => inspectPortableOnboarding({ ...input, workspace }, { repositories: f.repositories }),
      { code: "invalid-declaration" });
    assert.throws(() => inspectPortableOnboarding({ ...input, workspace, standaloneContextKey: null }, { repositories: f.repositories }),
      { code: "invalid-declaration" });
  }
  assert.deepEqual(f.calls, [], "invalid workspace must fail schema validation before any source observation");
  const standalone = inspectPortableOnboarding({ ...input, standaloneContextKey: null }, { repositories: f.repositories });
  assert.equal(standalone.status, "ready-for-preparation");
  assert.deepEqual(standalone.context, { kind: "standalone", key: null });
  const built = buildFreshPreparationRequest(standalone);
  assert.equal(Object.hasOwn(built.preparation, "workspace"), false);
  assert.equal(Object.hasOwn(built.preparation, "standaloneContextKey"), true);
  assert.equal(built.preparation.standaloneContextKey, null);
  assert.equal(existsSync(join(root, "fresh")), false);
});

test("standalone context uses the public UTF-8 byte bound without truncation or early source access", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oats-onboarding-key-bound-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = repositoryFixture(), input = { deployment: join(root, "fresh"), workTarget: root, origin,
    source: { source: S, soul: "agents/expert", revision: "main", alias: "standalone" } };
  for (const standaloneContextKey of ["x".repeat(257), "é".repeat(129)]) {
    assert.throws(() => inspectPortableOnboarding({ ...input, standaloneContextKey }, { repositories: f.repositories }),
      error => error.code === "invalid-declaration" && /256 UTF-8 bytes/.test(error.message));
  }
  assert.deepEqual(f.calls, [], "oversized keys refuse before repository observations");
  for (const standaloneContextKey of ["x".repeat(256), "é".repeat(128)]) {
    assert.equal(Buffer.byteLength(standaloneContextKey, "utf8"), 256);
    const inspection = inspectPortableOnboarding({ ...input, standaloneContextKey }, { repositories: f.repositories });
    assert.equal(inspection.context.key, standaloneContextKey);
    assert.equal(buildFreshPreparationRequest(inspection).preparation.standaloneContextKey, standaloneContextKey);
  }
  assert.equal(existsSync(join(root, "fresh")), false, "validation/inspection does not provision deployment state");
});

test("standalone source inspection never follows publisher workspace or invents membership/team enrollment", (t) => {
  const raw = mkdtempSync(join(tmpdir(), "oats-fresh-standalone-")), root = realpathSync(raw), workTarget = join(root, "project"), deployment = join(root, "fresh");
  t.after(() => rmSync(root, { recursive: true, force: true })); mkdirSync(workTarget);
  const f = repositoryFixture();
  const reference = { source: S, soul: "agents/expert", revision: "main", alias: "standalone" };
  assert.throws(() => inspectPortableOnboarding({ deployment, workTarget, source: reference, origin }, { repositories: f.repositories }), { code: "needs-configuration" });
  const disabled = inspectPortableOnboarding({ deployment, workTarget, source: reference, origin, standaloneContextKey: null }, { repositories: f.repositories });
  assert.deepEqual(disabled.context, { kind: "standalone", key: null }, "null is explicit and never inferred");
  const result = inspectPortableOnboarding({ deployment, workTarget, source: reference, origin, standaloneContextKey: "operator-context-1" }, { repositories: f.repositories });
  assert.equal(result.status, "ready-for-preparation"); assert.equal(result.workspace, null);
  assert.equal(result.repositoryMembership.result.status, "not-requested"); assert.deepEqual(result.teams.declared, {});
  assert.deepEqual(result.context, { kind: "standalone", key: "operator-context-1" });
  assert.equal(result.teams.enrollment, "not-performed");
  assert.equal(f.calls.some((call) => call.source === W), false, "publisher backlink is parsed but never followed without explicit workspace input");
  const prepared = buildFreshPreparationRequest(result);
  assert.equal(prepared.preparation.standaloneContextKey, "operator-context-1");
  assert.deepEqual(Object.keys(prepared.preparation).sort(), ["allowLocalPaths", "deployment", "origin", "source", "standaloneContextKey", "workTarget"]);
  assert.equal(Object.hasOwn(prepared.preparation, "directory"), false);
  assert.throws(() => inspectPortableOnboarding({ deployment, workTarget, source: reference, origin, workspace: { source: W, origin }, standaloneContextKey: "ambiguous" }, { repositories: f.repositories }), { code: "invalid-declaration" });
});
