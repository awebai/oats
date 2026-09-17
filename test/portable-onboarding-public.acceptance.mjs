import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRepositoryTransaction } from "../lib/repository-observation.mjs";
import { buildFreshPreparationRequest, inspectPortableOnboarding } from "../lib/portable-onboarding.mjs";
import { compareFreshSourceAcceptance, prepareFreshOnboarding } from "../lib/portable-onboarding-acceptance.mjs";
import { canonicalJson } from "../lib/portable-values.mjs";
import { readPortablePreparationRequest } from "../lib/portable-onboarding-request.mjs";
import { ONBOARDING_SPAWN_REVISION, pinnedOnboardingConsumer } from "./helpers/portable-onboarding-consumer.mjs";

const SOURCE = "git:https://onboarding.invalid/expert.git";
const WORKSPACE = "git:https://onboarding.invalid/adopter.git";
const PUBLISHER = "git:https://onboarding.invalid/publisher-private.git";
const CAPABILITY = "fixture.knowledge";
const origin = { kind: "operator", document: { kind: "operator", id: "onboarding-public-fixture" }, pointer: "/source" };
const same = (actual, expected, message) => assert.equal(canonicalJson(actual), canonicalJson(expected), message);
function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value) + "\n");
}

function fixture(root, { spawnHook = false } = {}) {
  const source = join(root, "expert"), workspace = join(root, "adopter"), home = join(root, "host"), config = join(home, "gitconfig");
  for (const dir of [source, workspace, home]) mkdirSync(dir);
  // Only these native file mappings can be read. An accidental publisher-context
  // lookup or other transport refuses, rather than contacting the network.
  write(config, "[protocol]\n  allow = never\n[protocol \"file\"]\n  allow = always\n[commit]\n  gpgsign = false\n");
  const environment = { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: join(home, "xdg"),
    GIT_CONFIG_GLOBAL: config, GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], {
    env: environment, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  for (const [dir, remote] of [[source, SOURCE], [workspace, WORKSPACE]]) {
    git(dir, "init", "--quiet", "--initial-branch=fixture");
    git(dir, "config", "user.name", "Fixture"); git(dir, "config", "user.email", "fixture@example.invalid");
    git(dir, "config", "uploadpack.allowFilter", "true");
    git(dir, "config", "uploadpack.allowAnySHA1InWant", "true");
    git(dir, "config", "--file", config, `url.${pathToFileURL(dir).href}.insteadOf`, remote.slice(4));
  }
  const phaseLog = join(root, "fixture-codec-phases"), commandMarker = join(root, "forbidden-command");
  write(join(source, "oats.yaml"), { schemaVersion: 1, workspace: { source: PUBLISHER, revision: "private" },
    exports: { souls: [{ path: "agents/expert", definition: "agents/expert/soul.yaml" }] } });
  write(join(source, "agents/expert/soul.yaml"), { schemaVersion: 1, name: "expert", work: "directory",
    requires: { knowledge: { capability: CAPABILITY, source: "repo:oats-package" } },
    knowledge: { contract: "fixture.collection", version: 1, payload: { collection: "unchanged-public-reference" } } });
  write(join(source, "agents/expert/AGENTS.md"), "Unchanged source instructions.\n");
  symlinkSync("AGENTS.md", join(source, "agents/expert/CLAUDE.md"));
  write(join(source, "oats-package/oats-package.json"), { package: "fixture.package", version: "1.0.0", description: "Inert onboarding fixture",
    compatibility: { oats: ">=0.1.0" }, capabilities: ["cap"] });
  write(join(source, "oats-package/cap/oats.json"), { capability: CAPABILITY, version: "1.0.0", description: "Inert collection fixture",
    layer: "knowledge", command: "fixture-knowledge", commands: { binding: "binding.mjs", show: "show.mjs" },
    binding: { version: 1, normalize: "binding", bind: "binding", check: "binding" },
    ...(spawnHook ? { hooks: { spawn: { command: "spawn.mjs", required: true } } } : {}) });
  // No OKF imports, nodes, store schema, credentials, network, harvesting or
  // lifecycle functions. The manifest-owned codec only handles fixture data.
  write(join(source, "oats-package/cap/binding.mjs"), `import { readFileSync, appendFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(0, 'utf8')), key = '/bindings/knowledge/destination';
appendFileSync(${JSON.stringify(phaseLog)}, r.phase + '\\n');
let result;
if (r.phase === 'normalize') {
  const soul = r.input.declarations.find(d => d.kind === 'soul');
  const operator = r.input.declarations.find(d => d.kind === 'operator');
  const destination = operator?.value.bindings?.destination;
  result = { requirements: [{key,kind:'required',origin:soul.origins['/knowledge']}],
    candidates: destination === undefined ? [] : [{key,kind:'operator',value:destination,origin:operator.origins['/bindings/destination']}],
    model: {collection:soul.value.knowledge.payload.collection} };
} else if (r.phase === 'bind') {
  result = {payloadContract:'fixture.collection',payloadVersion:1,
    payload:{...r.input.model,destination:r.input.choices[key].value},credentialRefs:{},provenance:[r.input.choices[key].selectedBy]};
} else {
  if (!r.input.invocation?.subject?.soul?.sourceArtifact) throw Error('missing full retained subject');
  result = {status:'ready',problems:[]};
}
console.log(JSON.stringify({schemaVersion:1,phase:r.phase,slot:r.slot,capability:r.capability,ok:true,result}));\n`);
  write(join(source, "oats-package/cap/show.mjs"), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(commandMarker)}, 'must not execute');\n`);
  if (spawnHook) write(join(source, "oats-package/cap/spawn.mjs"), `import {readFileSync,appendFileSync,statSync} from 'node:fs';
const contextFile=process.env.OATS_INVOCATION_CONTEXT_FILE,bindingFile=process.env.OATS_BINDING_FILE;
const invocation=JSON.parse(readFileSync(contextFile,'utf8')),binding=JSON.parse(readFileSync(bindingFile,'utf8'));
if(invocation.action.kind!=='hook'||invocation.action.name!=='spawn'||!invocation.instance?.incarnationId
  ||invocation.intent?.incarnationId!==invocation.instance.incarnationId) throw Error('no admitted producer incarnation');
appendFileSync(${JSON.stringify(phaseLog)},'spawn-hook\\n');
console.log(JSON.stringify({meta:{marker:'fixture-spawn',invocation,binding:binding.payload,
  snapshots:{contextFile,bindingFile,contextMode:statSync(contextFile).mode&0o777,bindingMode:statSync(bindingFile).mode&0o777}}}));\n`);
  git(source, "add", "."); git(source, "commit", "--quiet", "-m", "unchanged public soul and declared fixture provider");
  const sourceCommit = git(source, "rev-parse", "HEAD");
  write(join(workspace, "oats-workspace.yaml"), { schemaVersion: 1, name: "Adopter", members: [],
    imports: [{ source: SOURCE, soul: "agents/expert", revision: sourceCommit, alias: "organization-expert" }] });
  git(workspace, "add", "."); git(workspace, "commit", "--quiet", "-m", "explicit adopter workspace");
  const workspaceCommit = git(workspace, "rev-parse", "HEAD");
  const reference = alias => ({ source: SOURCE, soul: "agents/expert", revision: sourceCommit, alias });
  const scenarios = [
    { name: "organization", workspace: { source: WORKSPACE, revision: workspaceCommit, origin } },
    { name: "standalone", standaloneContextKey: "context:" + "é".repeat(124) }, // Exactly 256 UTF-8 bytes, not 256 characters.
    { name: "disabled", standaloneContextKey: null },
  ].map(({ name, ...context }) => {
    const deployment = join(root, `deployment-${name}`), workTarget = join(root, `work-${name}`);
    mkdirSync(deployment); mkdirSync(workTarget);
    write(join(workTarget, "existing-project.txt"), "Preserve project data.\n");
    if (name === "organization") git(workTarget, "init", "--quiet", "--initial-branch=work");
    return { name, deployment, workTarget, source: name === "organization" ? "organization-expert" : reference(name), origin, ...context };
  });
  const repositoryOptions = { environment, allowLocalGit: true, accessContextKey: "isolated-fixture" };
  return { source, workspace, sourceCommit, reference, scenarios, repositoryOptions, phaseLog, commandMarker, git };
}

function inspectScenarios(root, f) {
  const scratch = join(root, "inspection-scratch"); mkdirSync(scratch);
  const repositories = createRepositoryTransaction({ ...f.repositoryOptions, directory: scratch });
  try {
    return f.scenarios.map(({ name, ...input }) => ({ name, inspection: inspectPortableOnboarding(input, { repositories }) }));
  } finally {
    repositories.close();
    assert.deepEqual(readdirSync(scratch), [], "inspection scratch lifetime ends before public preparation");
  }
}

// This test has an explicit immutable source-code dependency, not an opt-in skip
// or replacement implementation. If that commit/dependency lock is unavailable,
// the helper fails closed and says so before any preparation.
test("pinned REAL public preparation consumes unchanged onboarding requests in workspace and standalone contexts", async t => {
  const { root, core, revision } = await pinnedOnboardingConsumer(t), f = fixture(root);
  const inspected = inspectScenarios(root, f);
  const comparison = compareFreshSourceAcceptance({ organization: inspected[0].inspection, standalone: inspected[1].inspection });
  assert.equal(comparison.source.commit, f.sourceCommit);
  assert.equal(comparison.standalone.workTarget.git.present, false);
  assert.equal(existsSync(f.phaseLog), false, "inspection never executed the fixture provider");
  const records = [];
  for (const { name, inspection } of inspected) {
    const options = { mode: "directory", allowLocalPaths: false,
      operator: { policy: {}, document: { kind: "operator", id: `explicit-${name}-bindings` }, bindings: { destination: `adopter-${name}-collection` } } };
    const built = buildFreshPreparationRequest(inspection, options), encoded = canonicalJson(built.preparation);
    const deployment = built.preparation.deployment, beforePhases = existsSync(f.phaseLog) ? readFileSync(f.phaseLog, "utf8") : "";
    const expectedKeys = ["deployment", "source", "origin", "operator", "mode", "allowLocalPaths",
      name === "organization" ? "workspace" : "standaloneContextKey"].sort();
    assert.deepEqual(Object.keys(built.preparation).sort(), expectedKeys);
    const requestFile = join(root, `${name}-prepare-request.json`);
    write(requestFile, encoded);
    const transported = readPortablePreparationRequest({ file: requestFile });
    same(transported, built.preparation, "request-file transport preserves the entire public object");
    let firstRequest;
    const first = prepareFreshOnboarding(inspection, options, { prepareCapturedComposition(request) {
      firstRequest = transported;
      same(request, transported, "fresh boundary and file request carry identical explicit authority");
      return core.prepareCapturedComposition(transported, { repositoryOptions: f.repositoryOptions });
    } });
    assert.equal(first.mutationAttempted, true);
    assert.equal(first.resolution, null, "unapproved executable provider cannot complete a binding");
    assert.equal(first.approvalRequests.length, 1, JSON.stringify(first));
    assert.equal(first.approvalRequests[0].capability, CAPABILITY);
    assert.ok(first.problems.some(problem => problem.code === "approval-required"), JSON.stringify(first));
    assert.equal(existsSync(f.phaseLog) ? readFileSync(f.phaseLog, "utf8") : "", beforePhases,
      "even normalize must not run before exact-artifact approval");
    same(first.requestedBindings, options.operator.bindings);

    // Once preparation has written state, it is no longer a fresh setup. Do not
    // delete its state to make the guard pass. Approve the exact returned set,
    // then use ordinary explicit public prepare to continue that deployment.
    assert.throws(() => prepareFreshOnboarding(inspection, options, { prepareCapturedComposition: () => assert.fail("stale fresh authority") }),
      { code: "fresh-deployment-required" });
    const approval = first.approvalRequests[0];
    assert.equal(core.approveAvailableCapability(deployment, approval.artifactSet, approval.capability,
      { kind: "operator", document: { kind: "operator", id: `fixture-only-${name}-approval` }, pointer: "/approve" }).status, "approved");
    const result = core.prepareCapturedComposition(firstRequest, { repositoryOptions: f.repositoryOptions });
    assert.equal(result.status, "prepared", JSON.stringify(result)); assert.ok(result.resolution);
    assert.equal(canonicalJson(built.preparation), encoded, "public preparation did not mutate input");
    const loaded = core.loadCapturedDispatch({ deployment, resolution: result.resolution, action: { kind: "inspect" } });
    const record = loaded.record;
    same(record.subject.soul.identity, inspection.source.identity);
    assert.equal(record.subject.soul.revision.commit, f.sourceCommit);
    assert.equal(record.subject.soul.alias, inspection.source.alias);
    assert.equal(record.bindings.knowledge.payload.collection, "unchanged-public-reference");
    assert.equal(record.bindings.knowledge.payload.destination, options.operator.bindings.destination);
    same(record.messagingChoice, { schemaVersion: 1, enabled: false });
    assert.equal(result.responsibleHuman, null);
    if (name === "organization") same(record.context.identity, inspection.context.identity);
    else {
      assert.equal(Object.hasOwn(firstRequest, "standaloneContextKey"), true);
      if (name === "standalone") assert.equal(Buffer.byteLength(firstRequest.standaloneContextKey, "utf8"), 256);
      same(record.context, { kind: "standalone", key: firstRequest.standaloneContextKey });
    }
    // The pinned full-subject generic check path must receive retained authority.
    // Loading checks the fixture provider but does NOT execute the show command.
    const command = core.loadCapturedDispatch({ deployment, resolution: result.resolution,
      action: { kind: "command", capability: CAPABILITY, name: "show" } });
    same(command.invocation.subject, record.subject);
    same(command.invocation.executionBinding, result.executionBinding);
    assert.equal(command.invocation.instance, null);
    assert.equal(readFileSync(join(inspection.workTarget.path, "existing-project.txt"), "utf8"), "Preserve project data.\n");
    assert.equal(readdirSync(join(deployment, ".agents/portable")).some(entry => entry.startsWith(".prepare-")), false);
    records.push({ deployment, resolution: result.resolution, subject: record.subject });
  }
  same(records[0].subject.soul.sourceArtifact, records[1].subject.soul.sourceArtifact,
    "both deployments retain the same unchanged soul bytes despite adopter-local aliases/bindings");
  assert.equal(f.git(f.source, "rev-parse", "HEAD"), f.sourceCommit);
  assert.equal(f.git(f.source, "status", "--porcelain"), "", "source was never adopted by copying/editing its definition");
  assert.equal(existsSync(f.commandMarker), false, "no command, model, harvester, hook or job was launched");
  // Retained verification is independent from the original repositories.
  rmSync(f.source, { recursive: true }); rmSync(f.workspace, { recursive: true });
  for (const item of records) same(core.loadCapturedDispatch({ deployment: item.deployment, resolution: item.resolution, action: { kind: "inspect" } }).record.subject,
    item.subject, "retained records survive source/workspace removal");
  t.diagnostic(`${revision}: exact public request, three contexts, explicit fixture approval/bindings, retained source verified; no launch/privacy qualification`);
});

test("real public consumer rejects private scratch input and fresh driver preserves a newly appeared legacy lock", async t => {
  const { root, core } = await pinnedOnboardingConsumer(t), f = fixture(root), [{ inspection }] = inspectScenarios(root, f);
  const built = buildFreshPreparationRequest(inspection, { mode: "directory" }), deployment = built.preparation.deployment;
  const file = join(root, "invalid-private-request.json");
  write(file, canonicalJson({ ...built.preparation, directory: join(root, "caller-scratch") }));
  const transported = readPortablePreparationRequest({ file });
  assert.equal(Object.hasOwn(transported, "directory"), true, "transport must not strip unknown/private fields to force core acceptance");
  assert.throws(() => core.prepareCapturedComposition(transported,
    { repositoryOptions: f.repositoryOptions }), { code: "invalid-declaration" });
  assert.deepEqual(readdirSync(deployment), [], "public key rejection precedes scratch/acquisition writes");
  const legacy = '{"lockfileVersion":1,"capabilities":{}}\n';
  write(join(deployment, "oats-lock.json"), legacy);
  let calls = 0;
  assert.throws(() => prepareFreshOnboarding(inspection, {}, { prepareCapturedComposition(request) {
    calls++; return core.prepareCapturedComposition(request, { repositoryOptions: f.repositoryOptions });
  } }), { code: "fresh-deployment-required" });
  assert.equal(calls, 0); assert.equal(readFileSync(join(deployment, "oats-lock.json"), "utf8"), legacy);
  assert.equal(existsSync(join(deployment, ".agents")), false);
  assert.equal(existsSync(f.phaseLog), false);
});

test("pinned public spawn --no-launch produces incarnation/index/intent and preserves occupied homes", async t => {
  const { root, core, cli, revision } = await pinnedOnboardingConsumer(t, { revision: ONBOARDING_SPAWN_REVISION });
  const f = fixture(root, { spawnHook: true }), inspected = inspectScenarios(root, f).slice(0, 2), prepared = [];
  const guard = join(root, "guard-bin"), backendMarker = join(root, "forbidden-backend"), schedulerHome = join(root, "scheduler-home");
  mkdirSync(guard);
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  for (const name of ["tmux", "herdr", "pi", "claude", "codex", "launchctl", "systemctl", "aw"]) {
    const path = join(guard, name);
    write(path, `#!/bin/sh\nprintf 'unexpected ${name}\\n' >> ${quote(backendMarker)}\nexit 97\n`); chmodSync(path, 0o700);
  }
  const environment = { ...f.repositoryOptions.environment, PATH: `${guard}:${f.repositoryOptions.environment.PATH}`,
    OATS_HOME_DIR: schedulerHome, OATS_DEPLOYMENT: "/poison/inherited", OATS_RESOLUTION: `sha256-${"f".repeat(64)}`,
    OATS_INSTANCE_HOME: "/poison/old-home", OATS_INSTANCE: "old-instance", OATS_BINDING_FILE: "/poison/binding",
    OATS_INVOCATION_CONTEXT_FILE: "/poison/invocation", OATS_SOURCE_RECEIPT_FILE: "/poison/source-receipt" };
  const invoke = argv => {
    const child = spawnSync(process.execPath, [cli, ...argv], { cwd: root, env: environment, encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(child.error, undefined); assert.equal(child.signal, null);
    const envelope = JSON.parse(child.stdout);
    return { child, envelope };
  };
  for (const { name, inspection } of inspected) {
    const options = { mode: "directory", allowLocalPaths: false, operator: { policy: {},
      document: { kind: "operator", id: `${name}-spawn-bindings` }, bindings: { destination: `${name}-private-collection` } } };
    const built = buildFreshPreparationRequest(inspection, options), deployment = built.preparation.deployment;
    const first = prepareFreshOnboarding(inspection, options, { prepareCapturedComposition: request =>
      core.prepareCapturedComposition(request, { repositoryOptions: f.repositoryOptions }) });
    assert.equal(first.resolution, null); assert.equal(first.approvalRequests.length, 1);
    const approval = first.approvalRequests[0];
    core.approveAvailableCapability(deployment, approval.artifactSet, approval.capability,
      { kind: "operator", document: { kind: "operator", id: `${name}-explicit-fixture-approval` }, pointer: "/approve" });
    const result = core.prepareCapturedComposition(built.preparation, { repositoryOptions: f.repositoryOptions });
    assert.equal(result.status, "prepared", JSON.stringify(result));
    const record = core.loadCapturedDispatch({ deployment, resolution: result.resolution, action: { kind: "inspect" } }).record;
    prepared.push({ name, inspection, deployment, result, record, destination: options.operator.bindings.destination });
  }
  // Only the retained producer may supply source/instance/binding authority.
  rmSync(f.source, { recursive: true }); rmSync(f.workspace, { recursive: true });
  for (const { name, inspection, deployment, result, record, destination } of prepared) {
    const homes = join(deployment, "homes"); mkdirSync(homes);
    const argvFor = home => ["--deployment", deployment, "--resolution", result.resolution.id,
      "spawn", record.subject.soul.alias, "--home", home, "--no-launch", "--json"];
    const home = join(homes, `${name}-one`), produced = invoke(argvFor(home));
    assert.equal(produced.child.status, 0, produced.child.stdout || produced.child.stderr);
    assert.equal(produced.envelope.ok, true);
    const receipt = produced.envelope.result;
    assert.equal(receipt.launched, false); assert.equal(receipt.launchPending, true); assert.equal(receipt.hooksPending, false);
    assert.deepEqual(receipt.hookOrder, [CAPABILITY]);
    const metadata = core.readCapturedInstanceMetadata(home); // read only; never hand-written fixture metadata
    assert.equal(metadata.incarnationId, receipt.incarnationId);
    assert.equal(metadata.captured.lifecycle, "spawned-launch-pending"); assert.equal(metadata.launched, false);
    same(metadata.executionBinding, result.executionBinding);
    assert.equal(lstatSync(join(home, "work")).isDirectory(), true);
    assert.notEqual(join(home, "work"), inspection.workTarget.path, "owned directory work is not a silent adoption of the inspected project");
    assert.ok(realpathSync(join(home, "soul")).startsWith(join(deployment, ".agents/soul-artifacts")));
    const provider = metadata.capabilityMeta[CAPABILITY], invocation = provider.invocation;
    assert.equal(provider.marker, "fixture-spawn"); assert.equal(provider.binding.destination, destination);
    same(invocation.subject, record.subject); same(invocation.context, record.context);
    same(invocation.executionBinding, result.executionBinding);
    same(invocation.messagingChoice, { schemaVersion: 1, enabled: false }); assert.equal(invocation.responsibleHuman, null);
    assert.equal(invocation.instance.incarnationId, metadata.incarnationId);
    assert.equal(invocation.instance.home, home); assert.equal(invocation.instance.work, join(home, "work"));
    assert.equal(invocation.intent.incarnationId, metadata.incarnationId); assert.equal(invocation.intent.attempt, 1);
    assert.equal(invocation.priorReceipt, null);
    assert.equal(provider.snapshots.contextMode, 0o600); assert.equal(provider.snapshots.bindingMode, 0o600);
    assert.equal(existsSync(provider.snapshots.contextFile), false); assert.equal(existsSync(provider.snapshots.bindingFile), false);
    const index = core.readCapturedInstanceIndex(deployment);
    assert.equal(index.schemaVersion, 2); assert.equal(index.instances.length, 1);
    const entry = index.instances[0];
    assert.equal(entry.home, home); assert.equal(entry.incarnationId, metadata.incarnationId);
    assert.equal(entry.status, "spawned-launch-pending"); same(entry.custody, metadata.captured.custody);
    assert.equal(entry.intents.length, 1); assert.equal(entry.intents[0].executionId, invocation.intent.executionId);
    assert.equal(entry.intents[0].state, "completed"); assert.equal(entry.intents[0].capability, CAPABILITY);
    same(entry.intents[0].action, { kind: "hook", capability: CAPABILITY, name: "spawn" });
    same(metadata.captured.hookIntents[CAPABILITY], invocation.intent);
    const indexFile = join(deployment, ".agents/portable/instance-references.json"), metaFile = join(home, "instance.json");
    const before = { index: readFileSync(indexFile), metadata: readFileSync(metaFile), phases: readFileSync(f.phaseLog) };
    const duplicate = invoke(argvFor(home));
    assert.equal(duplicate.child.status, 1); assert.equal(duplicate.envelope.error.code, "E_INSTANCE_EXISTS");
    const occupied = join(homes, "occupied"); write(join(occupied, "work.txt"), "user work must remain\n");
    const collision = invoke(argvFor(occupied));
    assert.equal(collision.child.status, 1); assert.equal(collision.envelope.error.code, "E_INSTANCE_EXISTS");
    assert.equal(readFileSync(join(occupied, "work.txt"), "utf8"), "user work must remain\n");
    assert.equal(existsSync(join(occupied, "instance.json")), false);
    assert.deepEqual(readFileSync(indexFile), before.index); assert.deepEqual(readFileSync(metaFile), before.metadata);
    assert.deepEqual(readFileSync(f.phaseLog), before.phases, "collisions never dispatch provider hooks or remint intents");
    const secondHome = join(homes, `${name}-two`), second = invoke(argvFor(secondHome));
    assert.equal(second.child.status, 0, second.child.stdout || second.child.stderr);
    assert.equal(second.envelope.result.launchPending, true); assert.equal(second.envelope.result.launched, false);
    const secondMeta = core.readCapturedInstanceMetadata(secondHome), entries = core.readCapturedInstanceIndex(deployment).instances;
    same(secondMeta.executionBinding, metadata.executionBinding);
    assert.notEqual(secondMeta.incarnationId, metadata.incarnationId, "same resolution does not collapse two incarnations");
    assert.equal(entries.length, 2); assert.notEqual(entries[0].intents[0].executionId, entries[1].intents[0].executionId);
    assert.equal(readFileSync(join(inspection.workTarget.path, "existing-project.txt"), "utf8"), "Preserve project data.\n");
    assert.equal(existsSync(join(deployment, "oats-schedules.json")), false);
    assert.equal(existsSync(join(deployment, ".agents/schedules")), false);
  }
  assert.equal(existsSync(backendMarker), false, "no backend/model/client/host timer was invoked");
  assert.equal(existsSync(schedulerHome), false); assert.equal(existsSync(f.commandMarker), false);
  t.diagnostic(`${revision}: real CLI producer minted distinct incarnations and completed hook intents; launchPending=true, launched=false; runtime launch NOT qualified`);
});
