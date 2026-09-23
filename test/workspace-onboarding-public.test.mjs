import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { readCapturedResolution } from "../lib/captured-resolutions.mjs";
import { inspectPortableOnboarding } from "../lib/core.mjs";
import { buildFreshPreparationRequest } from "../lib/portable-onboarding.mjs";
import { readCapturedInstanceIndex } from "../lib/captured-instance-index.mjs";
import { verifyPortableArtifact } from "../lib/portable-artifacts.mjs";

const CLI = fileURLToPath(new URL("../bin/oats.mjs", import.meta.url));
const SOURCE = "git:ssh://workspace.invalid/framework.git";
const origin = { kind: "operator", document: { kind: "operator", id: "workspace-onboarding-test" }, pointer: "/source" };
const opaque = "OPAQUE-PROVIDER-VALUE-MUST-NOT-BE-PRINTED";
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
function write(file, data) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data)); }
function fixture(t, { independentBindings = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oats-workspace-public-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "framework"), user = join(root, "operator"), workTarget = join(root, "project"), bin = join(root, "bin");
  for (const path of [repo, user, workTarget, bin]) mkdirSync(path);
  const gitconfig = join(user, "gitconfig"); write(gitconfig, "[commit]\n  gpgsign = false\n");
  const env = { PATH: bin + ":" + process.env.PATH, HOME: user, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", SHELL: "/usr/bin/true" };
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--quiet", "--initial-branch=pilot"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  git("config", "uploadpack.allowFilter", "true"); git("config", "uploadpack.allowAnySHA1InWant", "true");
  const transportLog = join(root, "transport.log"), phaseLog = join(root, "provider-phases.log"), ready = join(root, "provider-ready");
  write(ready, "explicit fixture readiness\n");
  const ssh = join(bin, "fixture-ssh");
  write(ssh, `#!/bin/sh\nfor last do :; done\ncase "$last" in ${quote("git-upload-pack '/framework.git'")}) printf '%s\\n' "$last" >> ${quote(transportLog)}; exec git-upload-pack ${quote(repo)};; *) exit 91;; esac\n`);
  chmodSync(ssh, 0o700); env.GIT_SSH_COMMAND = ssh; env.GIT_SSH_VARIANT = "ssh";
  write(join(repo, "oats-workspace.yaml"), { schemaVersion: 1, name: "Framework hosted workspace",
    members: [{ source: SOURCE }], defaults: { capabilities: { "fixture.development": { source: "repo:packages/development" } } },
    teams: { private: "per-human", development: { provider: "fixture.messaging", id: "offered-only" } },
    imports: [{ source: SOURCE, revision: "pilot", soul: "souls/pilot", alias: "workspace-pilot", adoption: { bindings: { opaque } } }] });
  write(join(repo, "oats.yaml"), { schemaVersion: 1, workspace: { source: SOURCE }, exports: {
    souls: [{ path: "souls/pilot", definition: "souls/pilot/soul.yaml" }], packages: [{ path: "packages/learning" }, { path: "packages/development" }],
    knowledge: [{ contract: "fixture.unselected", version: 1, payload: { opaque } }],
  } });
  write(join(repo, "souls/pilot/soul.yaml"), { schemaVersion: 1, name: "pilot", work: "directory",
    requires: { knowledge: { capability: "fixture.learning", source: "repo:packages/learning" } },
    knowledge: { contract: "fixture.learning", version: 1, payload: { collection: "intrinsic" } }, resources: ["references/boundary.txt"] });
  write(join(repo, "souls/pilot/AGENTS.md"), "# Intrinsic pilot\nFull retained source, not publisher workspace policy.\n");
  symlinkSync("AGENTS.md", join(repo, "souls/pilot/CLAUDE.md")); write(join(repo, "references/boundary.txt"), "retained extra resource\n");
  for (const name of ["learning", "development"]) {
    const cap = join(repo, "packages", name, "cap");
    write(join(repo, "packages", name, "oats-package.json"), { package: `fixture.${name}`, version: "1.0.0", description: "Inert source fixture", compatibility: { oats: ">=0.24.0" }, capabilities: ["cap"] });
    write(join(cap, "oats.json"), { capability: `fixture.${name}`, version: "1.0.0", description: "Inert required provider or workspace default", inject: "inject.md", skills: ["skills"],
      ...(name === "learning" ? { layer: "knowledge", command: "fixture-learning", commands: { phase: "phase.mjs" }, binding: { version: 1, normalize: "phase", bind: "phase", check: "phase" }, hooks: { spawn: { command: "spawn.mjs", required: true } } } : {}) });
    write(join(cap, "inject.md"), name === "learning" ? "REQUIRED-LEARNING-CONTEXT\n" : "WORKSPACE-ONLY-DEVELOPMENT-CONTEXT\n");
    write(join(cap, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: Inert ${name} procedure.\n---\n# ${name}\n`);
    write(join(cap, "skills", name, "asset.txt"), `${name} skill resource\n`);
  }
  write(join(repo, "packages/learning/cap/phase.mjs"), `import {readFileSync,appendFileSync,existsSync} from 'node:fs';
const r=JSON.parse(readFileSync(0,'utf8')),key='/bindings/knowledge/destination'; appendFileSync(${JSON.stringify(phaseLog)},r.phase+'\\n'); let result;
if(r.phase==='normalize'){const soul=r.input.declarations.find(d=>d.kind==='soul'),op=r.input.declarations.find(d=>d.kind==='operator'),destination=op?.value.bindings?.destination;result={requirements:[{key,kind:'required',origin:soul.origins['/knowledge']}],candidates:destination===undefined?[]:[{key,kind:'operator',value:destination,origin:op.origins['/bindings/destination']}],model:{collection:'intrinsic'}};}
else if(r.phase==='bind')result={payloadContract:'fixture.learning',payloadVersion:1,payload:{destination:r.input.choices[key].value},credentialRefs:{},provenance:[r.input.choices[key].selectedBy]};
else result=existsSync(${JSON.stringify(ready)})?{status:'ready',problems:[]}:{status:'unavailable',problems:[{code:'provider-unavailable',message:'required fixture is not ready'}]};
console.log(JSON.stringify({schemaVersion:1,phase:r.phase,slot:r.slot,capability:r.capability,ok:true,result}));\n`);
  write(join(repo, "packages/learning/cap/spawn.mjs"), `import {readFileSync,appendFileSync} from 'node:fs';const c=JSON.parse(readFileSync(process.env.OATS_INVOCATION_CONTEXT_FILE,'utf8'));if(c.action.kind!=='hook'||c.intent?.incarnationId!==c.instance?.incarnationId)throw Error('missing original admitted hook');appendFileSync(${JSON.stringify(phaseLog)},'spawn\\n');console.log(JSON.stringify({meta:{incarnationId:c.instance.incarnationId,executionId:c.intent.executionId}}));\n`);
  if (independentBindings) {
    // Deliberately inert provider contract: the SOURCE requires a particular
    // root. This is not OKF remote-existence/readiness validation. The recorded
    // locators exercise the shared resolver without any network or native check.
    const soulFile = join(repo, "souls/pilot/soul.yaml"), soul = JSON.parse(readFileSync(soulFile, "utf8"));
    soul.requires.messaging = { capability: "fixture.messaging", source: "repo:packages/messaging" };
    soul.knowledge.payload.root = "knowledge"; write(soulFile, soul);
    const exportsFile = join(repo, "oats.yaml"), exports = JSON.parse(readFileSync(exportsFile, "utf8"));
    exports.exports.packages.push({ path: "packages/messaging" }); write(exportsFile, exports);
    write(join(repo, "packages/messaging/oats-package.json"), { package: "fixture.messaging", version: "1.0.0", description: "No-interface negative fixture", compatibility: { oats: ">=0.24.0" }, capabilities: ["cap"] });
    write(join(repo, "packages/messaging/cap/oats.json"), { capability: "fixture.messaging", version: "1.0.0", description: "No binding interface", layer: "messaging" });
    write(join(repo, "packages/learning/cap/phase.mjs"), `import {readFileSync,appendFileSync} from 'node:fs';
const r=JSON.parse(readFileSync(0,'utf8')),key='/bindings/knowledge/stores/oats/root';appendFileSync(${JSON.stringify(phaseLog)},r.phase+'\\n');let result;
if(r.phase==='normalize'){const soul=r.input.declarations.find(d=>d.kind==='soul'),op=r.input.declarations.find(d=>d.kind==='operator'),root=op?.value.bindings?.['stores.oats']?.root;result={requirements:[{key,kind:'equals',value:soul.value.knowledge.payload.root,origin:soul.origins['/knowledge/payload/root']}],candidates:root===undefined?[]:[{key,kind:'operator',value:root,origin:op.origins['/bindings/stores.oats/root']}],model:{}};}
else if(r.phase==='bind')result={payloadContract:'fixture.learning',payloadVersion:1,payload:{root:r.input.choices[key].value},credentialRefs:{},provenance:[r.input.choices[key].selectedBy]};
else throw Error('No native/provider readiness check is admitted by this fixture');
console.log(JSON.stringify({schemaVersion:1,phase:r.phase,slot:r.slot,capability:r.capability,ok:true,result}));\n`);
  }
  git("add", "."); git("commit", "--quiet", "-m", "same repository workspace, reciprocal member and portable export");
  const commit = git("rev-parse", "HEAD");
  // These legacy settings are neither portable policy nor an implicit adopter workspace.
  write(join(workTarget, "oats-config.yaml"), "capabilities: [intentionally-invalid-ambient-config]\n");
  const inspection = (name, workspace) => ({ deployment: join(root, name), workTarget, source: workspace ? "workspace-pilot" : { source: SOURCE, revision: commit, soul: "souls/pilot", alias: "independent-pilot" }, origin,
    ...(workspace ? { workspace: { source: SOURCE, origin }, member: { source: SOURCE, origin } } : { standaloneContextKey: "independent-context" }) });
  const run = (args, { cwd = workTarget } = {}) => {
    const result = spawnSync(process.execPath, [CLI, ...args, "--json"], { cwd, env, encoding: "utf8", timeout: 30000 });
    assert.equal(result.error, undefined, result.stderr); let envelope;
    try { envelope = JSON.parse(result.stdout); } catch { assert.fail(result.stdout + result.stderr); }
    return { ...result, envelope };
  };
  const request = (name, input) => { const file = join(root, name + ".json"); write(file, input); return file; };
  return { root, repo, user, workTarget, env, bin, git, commit, inspection, run, request, phaseLog, ready, transportLog };
}

const capturedFixture = name => readFileSync(new URL(`./fixtures/second-operator/${name}`, import.meta.url), "utf8");
function secondOperatorRequest(f, name) {
  const input = JSON.parse(capturedFixture(name).replaceAll("/fixture/second-operator", f.root));
  input.source = "workspace-pilot"; input.workspace.source = SOURCE; input.member.source = SOURCE;
  return input;
}

test("inspection accepts the complete preparation request without evaluating or exposing its prepare-only fields", t => {
  const f = fixture(t), input = secondOperatorRequest(f, "prepare-valid-request.json");
  const native = join(f.bin, "never-run"), effect = join(f.root, "forbidden-launch");
  write(native, `#!/bin/sh\nprintf forbidden > ${quote(effect)}\nexit 99\n`); chmodSync(native, 0o700);
  Object.assign(input, { workTarget: f.workTarget, mode: "directory", allowLocalPaths: false,
    launch: { runtime: "claude", executable: native, args: [], env: {}, model: opaque, yolo: false }, helperLaunches: {} });
  input.operator.bindings.destination = opaque;
  mkdirSync(input.deployment);
  const file = f.request("complete-superset", input), exported = join(f.root, "complete-export.json");
  const inspected = f.run(["inspect", "--request", file, "--emit-prepare-request", exported]);
  assert.equal(inspected.status, 0, inspected.stdout + inspected.stderr);
  assert.deepEqual(inspected.envelope.result.ignored, ["operator", "launch", "helperLaunches", "mode", "allowLocalPaths"]);
  assert.deepEqual(inspected.envelope.result.omitted, { providerPayloads: true, adoptionValues: true });
  assert.ok(!inspected.stdout.includes(opaque));
  assert.equal(existsSync(f.phaseLog), false); assert.equal(existsSync(effect), false);
  assert.equal(existsSync(join(input.deployment, ".agents")), false);
  const converted = JSON.parse(readFileSync(exported, "utf8"));
  for (const key of inspected.envelope.result.ignored) assert.deepEqual(converted[key], input[key], `explicit export preserves ${key}, without evaluating it`);
  assert.equal(lstatSync(exported).mode & 0o777, 0o600);
  const pending = f.run(["prepare", "--request", file]);
  assert.equal(pending.status, 1, pending.stdout); assert.ok(pending.envelope.error.details, pending.stdout);
  for (const selection of pending.envelope.error.details.selections) for (const capability of selection.approvalRequired) {
    const approved = f.run(["trust", capability, "--deployment", input.deployment, "--artifact-set", selection.artifactSet]);
    assert.equal(approved.status, 0, approved.stdout + approved.stderr);
  }
  const prepared = f.run(["prepare", "--request", file]);
  assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
  const record = readCapturedResolution(input.deployment, prepared.envelope.result.resolution);
  assert.equal(record.bindings.knowledge.payload.destination, opaque); assert.equal(record.dispatch.launch.model, opaque);
  assert.equal(record.dispatch.launch.yolo, false); assert.equal(existsSync(effect), false);
  const phases = readFileSync(f.phaseLog, "utf8");
  // These are deliberately invalid PREPARATION values; inspection only observes
  // source/deployment/work metadata and reports that it ignored the fields.
  const ignored = { ...input, operator: { unknown: opaque }, launch: opaque, helperLaunches: [opaque], mode: false, allowLocalPaths: opaque };
  const metadata = f.run(["inspect", "--request", f.request("invalid-but-ignored", ignored)]);
  assert.equal(metadata.status, 0, metadata.stdout); assert.ok(!metadata.stdout.includes(opaque));
  assert.deepEqual(metadata.envelope.result.ignored, inspected.envelope.result.ignored);
  assert.equal(readFileSync(f.phaseLog, "utf8"), phases); assert.equal(existsSync(effect), false);
});

function refusingMessaging(f, reasons) {
  // Main now declares this policy. Reproduce the historical omission only in
  // this owned synthetic workspace, never by assuming today's source is broken.
  const workspaceFile = join(f.repo, "oats-workspace.yaml"), workspace = JSON.parse(readFileSync(workspaceFile, "utf8"));
  delete workspace.teams.private; write(workspaceFile, workspace);
  const soulFile = join(f.repo, "souls/pilot/soul.yaml"), soul = JSON.parse(readFileSync(soulFile, "utf8"));
  soul.requires.messaging = { capability: "oats.aweb", source: "repo:packages/messaging" }; write(soulFile, soul);
  const indexFile = join(f.repo, "oats.yaml"), index = JSON.parse(readFileSync(indexFile, "utf8"));
  index.exports.packages.push({ path: "packages/messaging" }); write(indexFile, index);
  write(join(f.repo, "packages/messaging/oats-package.json"), { package: "fixture.messaging", version: "1.0.0", description: "Inert messaging reason fixture, not released aweb", compatibility: { oats: ">=0.24.0" }, capabilities: ["cap"] });
  write(join(f.repo, "packages/messaging/cap/oats.json"), { capability: "oats.aweb", version: "1.11.0", description: "Inert codec only", layer: "messaging",
    commands: { phase: "phase.mjs" }, binding: { version: 1, normalize: "phase", bind: "phase", check: "phase", keys: ["diagnostic"], ...(reasons === undefined ? {} : { reasons }) } });
  write(join(f.repo, "packages/messaging/cap/phase.mjs"), `import {readFileSync,appendFileSync} from 'node:fs';
const r=JSON.parse(readFileSync(0,'utf8'));appendFileSync(${JSON.stringify(f.phaseLog)},'messaging '+r.phase+'\\n');
if(r.input.declarations.find(d=>d.kind==='workspace')?.value.teams?.private==='per-human')throw Error('fixture must reproduce a missing private policy');
const op=r.input.declarations.find(d=>d.kind==='operator'),message=op?.value.bindings?.diagnostic;
if(!Object.hasOwn(op.value.bindings,'stores.oats'))throw Error('0.24.4 validates keys shape only; foreign values remain forwarded and ignored');
console.log(JSON.stringify({schemaVersion:1,phase:r.phase,slot:r.slot,capability:r.capability,ok:false,error:{code:'needs-configuration',...(message===null?{}:{message:message??'messaging workspace must declare private: per-human'})}}));\n`);
  f.git("add", "."); f.git("commit", "--quiet", "-m", "inert provider reason transport");
}

test("approved provider fixed reasons survive broker and CLI; unsafe text stays behind the wire", t => {
  const f = fixture(t), safe = "fixture messaging requires reviewed configuration";
  refusingMessaging(f, [safe]);
  const input = secondOperatorRequest(f, "prepare-valid-request.json");
  input.operator.bindings.diagnostic = safe; mkdirSync(input.deployment);
  const file = f.request("declared-reason", input), pending = f.run(["prepare", "--request", file]);
  assert.equal(pending.status, 1); assert.equal(existsSync(f.phaseLog), false);
  assert.ok(!pending.stdout.includes(safe), "no provider reason before executing an approved codec");
  for (const selection of pending.envelope.error.details.selections) for (const capability of selection.approvalRequired) {
    assert.equal(f.run(["trust", capability, "--deployment", input.deployment, "--artifact-set", selection.artifactSet]).status, 0);
  }
  const result = f.run(["prepare", "--request", file]);
  assert.equal(result.status, 1);
  const problem = result.envelope.error.details.problems.find(p => p.capability === "oats.aweb");
  assert.equal(problem.slot, "messaging"); assert.equal(problem.message, safe); assert.ok(problem.origins.length > 0);
  const prose = spawnSync(process.execPath, [CLI, "prepare", "--request", file], { cwd: f.workTarget, env: f.env, encoding: "utf8", timeout: 30000 });
  assert.equal(prose.status, 1); assert.equal(prose.stdout, ""); assert.ok(prose.stderr.includes(safe));
  for (const message of [opaque, `${f.root}/private-operator-value`, `${safe}: ${opaque}`, "messaging workspace must declare private: per-human", null]) {
    input.operator.bindings.diagnostic = message;
    const bad = f.run(["prepare", "--request", f.request("unlisted-reason", input)]);
    assert.equal(bad.status, 1); assert.equal(bad.envelope.error.details.resolution, null);
    assert.equal(bad.envelope.error.details.problems.find(p => p.capability === "oats.aweb").message, "oats.aweb messaging normalize binding could not be prepared");
    if (message !== null) assert.ok(!bad.stdout.includes(message), "free text, paths, operator values and bundled reasons not declared by this manifest stay hidden");
  }
});

test("recorded second-operator pair surfaces the bundled per-human reason from an approved inert aweb stub", t => {
  assert.equal(capturedFixture("prepare-valid-result.json"), capturedFixture("prepare-bogus-result.json"));
  const f = fixture(t); refusingMessaging(f);
  const requests = ["prepare-valid-request.json", "prepare-bogus-request.json"].map(name => secondOperatorRequest(f, name));
  mkdirSync(requests[0].deployment);
  const pending = f.run(["prepare", "--request", f.request("before-approval", requests[0])]);
  assert.equal(pending.status, 1); assert.equal(existsSync(f.phaseLog), false);
  for (const selection of pending.envelope.error.details.selections) for (const capability of selection.approvalRequired) {
    assert.equal(f.run(["trust", capability, "--deployment", requests[0].deployment, "--artifact-set", selection.artifactSet]).status, 0);
  }
  const problems = requests.map((input, index) => {
    const result = f.run(["prepare", "--request", f.request(`recorded-pair-${index}`, input)]);
    assert.equal(result.status, 1); assert.equal(result.envelope.error.details.resolution, null);
    return result.envelope.error.details.problems.find(p => p.capability === "oats.aweb");
  });
  for (const problem of problems) {
    assert.equal(problem.slot, "messaging"); assert.equal(problem.code, "needs-configuration");
    assert.equal(problem.message, "messaging workspace must declare private: per-human"); assert.ok(problem.origins.length > 0);
  }
  assert.deepEqual(problems[0], problems[1], "same declared reason for both locators; no remote validation or manufactured inequality");
});

test("second-operator before pair stays byte-identical; independent binding diagnostics are attributed without masking other slots", t => {
  assert.equal(capturedFixture("prepare-valid-result.json"), capturedFixture("prepare-bogus-result.json"));
  assert.equal(capturedFixture("wire/prepare-valid-result.json"), capturedFixture("wire/prepare-bogus-result.json"));
  const f = fixture(t, { independentBindings: true });
  const valid = secondOperatorRequest(f, "prepare-valid-request.json"), bogus = secondOperatorRequest(f, "prepare-bogus-request.json");
  mkdirSync(valid.deployment);
  const validFile = f.request("valid-binding", valid), bogusFile = f.request("bogus-binding", bogus);
  const pending = f.run(["prepare", "--request", validFile]);
  assert.equal(pending.status, 1, pending.stdout);
  const incomplete = pending.envelope.error.details;
  assert.ok(incomplete, pending.stdout + pending.stderr);
  assert.ok(incomplete.problems.some(p => p.code === "approval-required" && p.slot === "knowledge" && p.capability === "fixture.learning"));
  assert.equal(existsSync(f.phaseLog), false, "no codec before exact approval even when another slot is unqualified");
  for (const selection of incomplete.selections) for (const capability of selection.approvalRequired) {
    const approved = f.run(["trust", capability, "--deployment", valid.deployment, "--artifact-set", selection.artifactSet]);
    assert.equal(approved.status, 0, approved.stdout + approved.stderr);
  }
  const a = f.run(["prepare", "--request", validFile]), b = f.run(["prepare", "--request", bogusFile]);
  assert.equal(a.status, 1); assert.equal(b.status, 1);
  const good = a.envelope.error.details, bad = b.envelope.error.details;
  assert.equal(good.status, "needs-configuration"); assert.equal(bad.status, "conflict");
  for (const result of [good, bad]) {
    assert.equal(result.resolution, null); assert.equal(result.executionBinding, null);
    assert.ok(result.problems.every(p => ["knowledge", "messaging", "tasks"].includes(p.slot) && p.capability.startsWith("fixture.")));
    const message = result.problems.find(p => p.slot === "messaging");
    assert.equal(message.capability, "fixture.messaging");
    assert.equal(message.code, "provider-not-qualified");
    assert.equal(message.message, "fixture.messaging@1.0.0 declares no binding interface; messaging cannot be prepared");
  }
  assert.equal(good.problems.some(p => p.slot === "knowledge"), false);
  const problem = bad.problems.find(p => p.slot === "knowledge");
  assert.equal(problem.capability, "fixture.learning"); assert.equal(problem.code, "requirement-conflict");
  assert.equal(problem.key, "/bindings/knowledge/stores/oats/root");
  assert.deepEqual(problem.origins.map(o => o.pointer).sort(), ["/bindings/stores.oats/root", "/knowledge/payload/root"]);
  assert.notDeepEqual(good.problems, bad.problems, "source hard-root constraint differs; NOT a real remote-existence claim");
  assert.equal(readFileSync(f.phaseLog, "utf8"), "normalize\nbind\nnormalize\n", "valid knowledge binds despite unsupported messaging; only conflicted slot skips bind");
  const prose = spawnSync(process.execPath, [CLI, "prepare", "--request", bogusFile], { cwd: f.workTarget, env: f.env, encoding: "utf8", timeout: 30000 });
  assert.equal(prose.status, 1); assert.ok(prose.stderr.includes(JSON.stringify(problem.key)), "human diagnostics show the existing choice key beside the message");
});

test("second-operator absent deployment after ready inspection is a typed provisioning hold, not raw ENOENT", t => {
  const f = fixture(t), input = secondOperatorRequest(f, "inspect-request.json"), file = f.request("absent-deployment", input);
  const inspected = f.run(["inspect", "--request", file]);
  assert.equal(inspected.status, 0, inspected.stdout);
  assert.equal(inspected.envelope.result.deployment.status, "ready");
  assert.equal(inspected.envelope.result.deployment.deployment.state, "absent");
  const transport = readFileSync(f.transportLog, "utf8");
  const prepared = f.run(["prepare", "--request", file]);
  assert.equal(prepared.status, 1); assert.equal(prepared.envelope.error.code, "needs-configuration");
  assert.match(prepared.envelope.error.message, /directory is absent; provision.*inspect again/);
  assert.ok(!prepared.stdout.includes("ENOENT") && !prepared.stdout.includes(input.deployment));
  assert.equal(existsSync(input.deployment), false); assert.equal(existsSync(f.phaseLog), false);
  assert.equal(readFileSync(f.transportLog, "utf8"), transport, "provisioning hold precedes new source observation or state writes");
});

test("second-operator inspection request is accepted by prepare and explicit conversion preserves workTarget without choosing execution placement", t => {
  const f = fixture(t), input = secondOperatorRequest(f, "inspect-request.json"), file = f.request("compatible-input", input);
  const unrelated = join(f.root, "unrelated-cwd"); mkdirSync(unrelated);
  mkdirSync(input.deployment); // Explicit operator provisioning, never inferred from inspect.
  const output = join(f.root, "converted-prepare.json");
  const inspected = f.run(["inspect", "--request", file, "--emit-prepare-request", output], { cwd: unrelated });
  assert.equal(inspected.status, 0, inspected.stdout + inspected.stderr);
  const view = inspected.envelope.result;
  assert.equal(view.prepareRequestFile, output); assert.equal(view.effects.requestFileWrite, true);
  assert.equal(view.effects.deploymentWrites, false); assert.equal(Object.hasOwn(view, "prepareRequest"), false);
  assert.ok(!inspected.stdout.includes(opaque));
  const convertedBytes = readFileSync(output, "utf8"), converted = JSON.parse(convertedBytes);
  assert.ok(convertedBytes.includes(opaque), "only explicit private export carries unclassified adoption inputs");
  assert.equal(lstatSync(output).mode & 0o777, 0o600);
  assert.equal(converted.workTarget, input.workTarget); assert.equal(converted.deployment, input.deployment);
  assert.equal(converted.source.source, SOURCE); assert.equal(converted.source.soul, "souls/pilot");
  assert.equal(Object.hasOwn(converted, "directory"), false); assert.equal(existsSync(f.phaseLog), false);
  const priorTransport = readFileSync(f.transportLog, "utf8");
  const alias = join(f.root, "output-link.json"); symlinkSync(output, alias);
  for (const existing of [file, output, alias, "relative.json"]) {
    const bad = f.run(["inspect", "--request", file, "--emit-prepare-request", existing]);
    assert.equal(bad.status, 1); assert.equal(bad.envelope.error.code, "E_BAD_ARGS");
  }
  assert.equal(readFileSync(output, "utf8"), convertedBytes);
  assert.equal(readFileSync(f.transportLog, "utf8"), priorTransport, "existing output refuses before further observations");
  for (const request of [file, output]) {
    const result = f.run(["prepare", "--request", request], { cwd: unrelated });
    assert.equal(result.status, 1); assert.equal(result.envelope.error.code, "needs-configuration", result.stdout);
    const details = result.envelope.error.details;
    assert.ok(details, result.stdout);
    assert.equal(details.workTarget.path, input.workTarget); assert.notEqual(details.workTarget.path, unrelated);
    assert.equal(details.source.soul, "souls/pilot"); assert.equal(details.resolution, null);
    assert.ok(details.problems.some(p => p.code === "approval-required"));
  }
  const transport = readFileSync(f.transportLog, "utf8");
  for (const workTarget of [null, false, "relative", join(f.root, "missing-work")]) {
    const bad = f.run(["prepare", "--request", f.request("bad-target", { ...input, workTarget })]);
    assert.equal(bad.status, 1); assert.ok(["invalid-declaration", "source-unavailable"].includes(bad.envelope.error.code), bad.stdout);
  }
  assert.equal(readFileSync(f.transportLog, "utf8"), transport); assert.equal(existsSync(f.phaseLog), false);
  const heldOutput = join(f.root, "held-output.json");
  const held = f.run(["inspect", "--request", file, "--emit-prepare-request", heldOutput]);
  assert.equal(held.status, 1); assert.equal(held.envelope.error.code, "fresh-deployment-required");
  assert.equal(existsSync(heldOutput), false, "managed-state inspection cannot issue a fresh request export");
});

test("public same-repository source/workspace inspection qualifies reciprocal observations without adopting publisher policy", t => {
  const f = fixture(t);
  for (const workspace of [true, false]) {
    const input = f.inspection(workspace ? "organization" : "independent", workspace);
    const result = f.run(["inspect", "--request", f.request(workspace ? "inspect-workspace" : "inspect-independent", input)]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const view = result.envelope.result;
    assert.equal(view.status, "ready-for-preparation");
    assert.equal(view.source.identity.repository.remote, SOURCE);
    assert.equal(view.source.revision.commit, f.commit);
    assert.equal(view.deployment.deployment.path, input.deployment);
    assert.equal(view.workTarget.path, f.workTarget);
    assert.equal(view.context.kind, workspace ? "workspace" : "standalone");
    assert.equal(view.repositoryMembership.result.status, workspace ? "eligible" : "not-requested");
    if (workspace) {
      assert.equal(view.workspace.source.commit, f.commit);
      assert.equal(view.repositoryMembership.result.member.revision, f.commit);
      assert.equal(view.repositoryMembership.result.workspace.revision, f.commit);
    } else { assert.equal(view.workspace, null); assert.deepEqual(view.teams.declared, {}); }
    assert.equal(view.teams.enrollment, "not-performed");
    assert.equal(existsSync(input.deployment), false, "source inspection never provisions deployment state");
    assert.equal(existsSync(f.phaseLog), false, "source inspection executes no provider or hook");
    assert.ok(!result.stdout.includes(opaque), "unclassified provider/adoption payloads are not public inspection output");
    assert.deepEqual(view.omitted, { providerPayloads: true, adoptionValues: true });
  }
});

test("same-repo membership needs matching reciprocal observations, while import alone makes no membership claim", t => {
  const f = fixture(t), input = f.inspection("fresh", true);
  write(join(f.repo, "later.txt"), "later source observation\n"); f.git("add", "."); f.git("commit", "--quiet", "-m", "advance hosting default branch");
  input.workspace.revision = f.commit;
  const stale = f.run(["inspect", "--request", f.request("stale-observations", input)]);
  assert.equal(stale.status, 0, stale.stdout + stale.stderr);
  assert.equal(stale.envelope.result.status, "needs-configuration");
  assert.equal(stale.envelope.result.repositoryMembership.result.status, "stale");
  assert.equal(stale.envelope.result.problems[0].code, "workspace-observation-mismatch");
  assert.equal(existsSync(input.deployment), false); assert.equal(existsSync(f.phaseLog), false);
  delete input.member; delete input.workspace.revision;
  const imported = f.run(["inspect", "--request", f.request("import-not-membership", input)]);
  assert.equal(imported.status, 0, imported.stdout + imported.stderr);
  assert.equal(imported.envelope.result.repositoryMembership.result.status, "not-requested");
  assert.equal(imported.envelope.result.teams.enrollment, "not-performed");
});

test("public source inspection ignores inherited capture, preserves managed-state holds and cannot become a mutation witness", t => {
  const f = fixture(t), input = f.inspection("existing", false);
  mkdirSync(input.deployment); write(join(input.deployment, "oats-config.yaml"), "preserve this existing deployment\n");
  f.env.OATS_DEPLOYMENT = "/unrelated/old/deployment"; f.env.OATS_RESOLUTION = "sha256-" + "a".repeat(64);
  const result = f.run(["inspect", "--request", f.request("held-existing", input)]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.envelope.result.status, "separate-deployment-required");
  assert.equal(result.envelope.result.deployment.deployment.path, input.deployment);
  assert.equal(readFileSync(join(input.deployment, "oats-config.yaml"), "utf8"), "preserve this existing deployment\n");
  assert.equal(existsSync(join(input.deployment, ".agents")), false);
  const fresh = f.inspection("fresh-api", true);
  const view = inspectPortableOnboarding(fresh, { repositoryOptions: { environment: f.env } });
  assert.equal(view.status, "ready-for-preparation"); assert.equal(Object.hasOwn(view.source, "reference"), false);
  assert.equal(view.workspace.imports[0].adoptionPresent, true);
  assert.equal(view.source.exports.knowledge[0].payloadOmitted, true);
  assert.ok(!JSON.stringify(view).includes(opaque));
  assert.throws(() => buildFreshPreparationRequest(view), { code: "invalid-declaration" }, "metadata view is not an issued mutation witness/request");
});

test("source-inspection request transport rejects mixed/captured/unknown inputs before source or provider effects", t => {
  const f = fixture(t), missing = join(f.root, "not-readable.json"), resolution = "sha256-" + "a".repeat(64);
  for (const args of [
    ["inspect", "--request", missing, "--dir", f.root], ["inspect", "--request", missing, "--home", f.root],
    ["inspect", "--request", missing, "--request", missing], ["inspect", "--request=" + missing],
    ["inspect", "--request", missing, "--deployment", f.root, "--resolution", resolution],
    ["--deployment", f.root, "--resolution", resolution, "inspect", "--request", missing],
  ]) {
    const bad = f.run(args); assert.equal(bad.status, 1); assert.equal(bad.envelope.error.code, "E_BAD_ARGS");
    assert.ok(!bad.envelope.error.message.includes("could not be read"), "argument conflicts refuse before request file access");
  }
  const input = f.inspection("fresh", false); input.directory = f.root;
  const unknown = f.run(["inspect", "--request", f.request("unknown-field", input)]);
  assert.equal(unknown.status, 1); assert.equal(unknown.envelope.error.code, "invalid-declaration");
  assert.equal(existsSync(f.transportLog), false); assert.equal(existsSync(f.phaseLog), false);
  assert.equal(existsSync(input.deployment), false);
});

test("public approval, retained scaffold and inert native boundary preserve same-repo versus independent policy and required readiness", t => {
  const f = fixture(t), native = join(f.bin, "native-fixture.cjs"), backend = join(f.bin, "tmux"), backendLog = join(f.root, "backend.log");
  write(native, `#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync('work/native.json',JSON.stringify({incarnationId:process.env.OATS_INCARNATION_ID,executionId:process.env.OATS_EXECUTION_ID,home:process.env.OATS_INSTANCE_HOME,args:process.argv.slice(2)}));\n`); chmodSync(native, 0o700);
  write(backend, `#!${process.execPath}\nconst fs=require('node:fs'),cp=require('node:child_process'),a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(backendLog)},JSON.stringify(a)+'\\n');
if(a.includes('list-panes')){console.log('%1\\t1\\tfixture-native\\t99999');}
else if(a.includes('new-window')||a.includes('new-session')||a.includes('respawn-pane')){cp.execFileSync('/bin/sh',['-c',a.at(-1)],{cwd:a[a.indexOf('-c')+1],env:process.env,stdio:'pipe'});console.log('%1');}
else if(!a.includes('has-session')&&!a.includes('list-windows')){console.error('unexpected fixture backend command');process.exitCode=99;}\n`); chmodSync(backend, 0o700);
  const launch = { runtime: "claude", executable: native, args: [], env: { CLAUDE_CONFIG_DIR: join(f.root, "native-fixture-history") }, model: "fixture-native", yolo: false };
  const prepared = [];
  for (const workspace of [true, false]) {
    const inspected = f.inspection(workspace ? "organization" : "independent", workspace);
    mkdirSync(inspected.deployment);
    const { workTarget, ...input } = inspected;
    input.launch = launch;
    input.operator = { document: { kind: "operator", id: "explicit-adopter-bindings" }, policy: {}, bindings: { destination: workspace ? "workspace-owned" : "adopter-owned" } };
    const file = f.request(workspace ? "prepare-workspace" : "prepare-independent", input);
    const priorPhases = existsSync(f.phaseLog) ? readFileSync(f.phaseLog, "utf8") : "";
    const pending = f.run(["prepare", "--request", file]);
    assert.equal(pending.status, 1, pending.stdout + pending.stderr);
    const incomplete = pending.envelope.error.details;
    assert.equal(incomplete.status, "needs-configuration", pending.stdout); assert.equal(incomplete.resolution, null);
    assert.equal(incomplete.problems[0].code, "approval-required", "binding code cannot execute before exact artifact approval");
    assert.equal(existsSync(f.phaseLog) ? readFileSync(f.phaseLog, "utf8") : "", priorPhases, "no binding code before this deployment's exact approval");
    for (const selection of incomplete.selections) for (const capability of selection.approvalRequired) {
      const approved = f.run(["trust", capability, "--deployment", input.deployment, "--artifact-set", selection.artifactSet]);
      assert.equal(approved.status, 0, approved.stdout + approved.stderr);
    }
    const complete = f.run(["prepare", "--request", file]);
    assert.equal(complete.status, 0, complete.stdout + complete.stderr);
    const result = complete.envelope.result, record = readCapturedResolution(input.deployment, result.resolution);
    assert.equal(record.subject.soul.identity.repository.remote, SOURCE);
    assert.equal(record.context.kind, workspace ? "workspace" : "standalone");
    assert.equal(record.bindings.knowledge.payload.destination, workspace ? "workspace-owned" : "adopter-owned");
    assert.equal(Object.hasOwn(record.artifacts.capabilities, "fixture.development"), workspace, "publisher's workspace default is not source policy");
    prepared.push({ workspace, input, result, record });
  }
  assert.deepEqual(prepared[0].record.subject.soul.identity, prepared[1].record.subject.soul.identity, "one reusable source identity, not aliases/deployment/work paths");
  rmSync(f.repo, { recursive: true }); // Owned inert source fixture ONLY; retained operation must not fetch it again.
  for (const { workspace, input, result, record } of prepared) {
    const retainedSource = verifyPortableArtifact(input.deployment, record.subject.soul.sourceArtifact).dir;
    assert.equal(readFileSync(join(retainedSource, "references/boundary.txt"), "utf8"), "retained extra resource\n");
    write(join(input.deployment, "oats-config.yaml"), "capabilities: [poison-current-context]\n");
    const selected = ["--deployment", input.deployment, "--resolution", result.resolution.id];
    const retained = f.run(["inspect", ...selected, "--composition"]);
    assert.equal(retained.status, 0, retained.stdout + retained.stderr);
    assert.match(retained.stdout, /Intrinsic pilot/);
    const home = join(f.root, workspace ? "workspace-home" : "independent-home");
    const spawn = f.run(["spawn", workspace ? "workspace-pilot" : "independent-pilot", ...selected, "--home", home, "--no-launch"]);
    assert.equal(spawn.status, 0, spawn.stdout + spawn.stderr);
    assert.equal(spawn.envelope.result.launchPending, true);
    assert.equal(readlinkSync(join(home, "CLAUDE.md")), "AGENTS.md");
    assert.equal(lstatSync(join(home, "work")).isDirectory(), true);
    assert.notEqual(realpathSync(join(home, "work")), f.workTarget, "inspection does not silently select execution placement");
    assert.notEqual(home, input.deployment);
    const instructions = readFileSync(join(home, "AGENTS.md"), "utf8");
    assert.match(instructions, /Intrinsic pilot/); assert.match(instructions, /REQUIRED-LEARNING-CONTEXT/);
    assert.equal(instructions.includes("WORKSPACE-ONLY-DEVELOPMENT-CONTEXT"), workspace);
    assert.equal(readFileSync(join(home, ".agents/skills/learning/asset.txt"), "utf8"), "learning skill resource\n");
    assert.equal(existsSync(join(home, ".agents/skills/development")), workspace);
    const nativeRequest = f.request(workspace ? "start-workspace" : "start-independent", { schemaVersion: 1,
      backend: { backend: "tmux", binary: backend, socket: join(f.root, "owned-fixture.sock"), session: "owned-fixture" }, task: "Run only the inert native fixture." });
    rmSync(f.ready);
    const before = JSON.stringify(readCapturedInstanceIndex(input.deployment)), calls = existsSync(backendLog) ? readFileSync(backendLog, "utf8") : "";
    const blocked = f.run(["session", "start", ...selected, "--home", home, "--request", nativeRequest]);
    assert.equal(blocked.status, 1); assert.equal(blocked.envelope.error.code, "provider-unavailable");
    assert.equal(JSON.stringify(readCapturedInstanceIndex(input.deployment)), before, "unready required provider cannot admit native effects");
    assert.equal(existsSync(backendLog) ? readFileSync(backendLog, "utf8") : "", calls);
    write(f.ready, "ready fixture\n");
    const start = f.run(["session", "start", ...selected, "--home", home, "--request", nativeRequest]);
    assert.equal(start.status, 0, start.stdout + start.stderr); assert.equal(start.envelope.result.dispatchAccepted, true);
    const effect = JSON.parse(readFileSync(join(home, "work/native.json"), "utf8"));
    assert.equal(effect.incarnationId, start.envelope.result.incarnationId); assert.equal(effect.executionId, start.envelope.result.intent.executionId); assert.equal(effect.home, home);
    assert.ok(!effect.args.includes("--dangerously-skip-permissions"));
    // Existing home-receipt observer, not a new captured-input/wake authority.
    const observed = f.run(["session", "inspect", "--home", home]);
    assert.equal(observed.status, 0, observed.stdout + observed.stderr); assert.equal(observed.envelope.result.state, "stopped");
    const unsupported = f.run(["session", "input", ...selected, "--home", home, "--text-file", "/must-not-read"]);
    assert.equal(unsupported.status, 1); assert.equal(unsupported.envelope.error.code, "unsupported-action");
    const retire = f.run(["retire", workspace ? "workspace-home" : "independent-home", ...selected]);
    assert.equal(retire.status, 1); assert.equal(retire.envelope.error.code, "unsupported-action"); assert.equal(existsSync(home), true, "held captured retirement never removes the home");
  }
});
