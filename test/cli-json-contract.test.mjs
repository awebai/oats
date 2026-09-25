// Desktop CLI API v1 contract tests — the FIXED JSON shapes the Desktop app
// consumes (see docs/desktop-cli-api.md and the desktop-dist contract).
//
// Invariants under test:
//   * `oats version --json` prints EXACTLY the probe payload, one JSON object:
//     {"schemaVersion":1,"name":"@awebai/oats","version":<pkg>,"desktopApi":1}
//   * `oats spawn ... --json` success prints one envelope object
//     {"schemaVersion":1,"ok":true,"result":{instance,agent,home,work,branch,
//      launched,warnings,tmux,...}} with no progress contamination on stdout.
//   * every `--json` failure prints one envelope object
//     {"schemaVersion":1,"ok":false,"error":{code,message}} on stdout, exits nonzero.
//   * v2 `oats okf harvest --json` reports durable run status and worker identity;
//     scaffold-only execution is a mandatory success path, never launch-or-fail.
import test from "node:test";
import { fixture as okfFixture } from "./helpers/okf-v2.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { inertRuntimePath } from "./helpers/runtime-stub.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const PKG_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
// The shipped oats.okf capability tree, byte-identical to the published
// oats.okf payload the catalog pins (package-catalog.json → oats.okf).

function temp() { return mkdtempSync(join(tmpdir(), "oats-json-contract-")); }
function write(path, content) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
function gitRepo(dir) {
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "Test"]);
  write(join(dir, ".gitignore"), "\n");
  execFileSync("git", ["-C", dir, "add", "."]);
  execFileSync("git", ["-C", dir, "commit", "-qm", "init"]);
}
function fakeRuntimes(base) {
  const bin = join(base, "bin"); mkdirSync(bin, { recursive: true });
  for (const name of ["pi", "claude"]) { write(join(bin, name), "#!/bin/sh\nexit 0\n"); execFileSync("chmod", ["+x", join(bin, name)]); }
  // Contract fixtures must never create real terminal sessions. Launch failure
  // is asserted below; scaffold-only tests do not need a terminal backend.
  write(join(bin, "tmux"), "#!/bin/sh\nexit 1\n");
  execFileSync("chmod", ["+x", join(bin, "tmux")]);
  return `${bin}:${inertRuntimePath(base)}`;
}
function fixtureSoul(base) {
  const repo = join(base, "repo"); gitRepo(repo);
  const root = join(base, "agents");
  write(join(root, "dev", "soul", "soul.yaml"), `name: dev\nkind: persistent\nrepo: ${repo}\nwork: checkout\nruntime: pi\n`);
  write(join(root, "dev", "soul", "AGENTS.md"), "# dev\n");
  mkdirSync(join(root, "dev", "instances"), { recursive: true });
  return { repo, root };
}
/** stdout must be exactly one JSON document — anything else is contamination. */
function parseOnly(stdout) {
  const doc = JSON.parse(stdout);
  assert.equal(stdout.trim(), JSON.stringify(doc), "stdout is exactly one compact JSON object");
  return doc;
}

test("oats version --json emits the exact Desktop API v1 probe payload", () => {
  const r = spawnSync(process.execPath, [CLI, "version", "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const doc = parseOnly(r.stdout);
  assert.deepEqual(doc, { schemaVersion: 1, name: "@awebai/oats", version: PKG_VERSION, desktopApi: 1, runtimes: ["pi", "claude", "codex"], sessionBackends: ["tmux", "herdr"], launchOptions: ["yolo"], remote: ["spawn", "retire", "status", "session", "session-start", "session-restart", "launch-config", "roster", "harvest", "schedule", "session-upload", "operations"], features: ["retire-home", "session-start", "session-restart", "launch-config", "schedule", "session-upload", "operations", "instance-git", "instance-git-remote", "souls-declarations", "lifecycle-plans", "retire-retention", "readiness", "spawn-preview", "instance-events", "instance-events-2", "schedule-history", "schedule-read-2", "spawn-preview-2","spawn-idempotency","spawn-idempotency-2","spawn-apply-2","workspace-v2","instance-modules","spawn-provider-payload", "served-identity", "packages-no-approval", "spawn-name", "settings-origins"], workspaceApi: 2, instanceGitApi: 1, spawnApplyApi: 1, soulsApi: 2, lifecycleApi: 1, readinessApi: 2, spawnPreviewApi: 2, eventsApi: 2, scheduleHistoryApi: 3, scheduleApi: 2, operationsApi: 2, capturedDispatchApi: 1, capturedDispatchActions: ["inspect", "compose", "command", "operation", "spawn", "trust"] });
  // key order is part of the published fixture — Desktop probes with string compare fallback
  assert.equal(r.stdout.trim(), `{"schemaVersion":1,"name":"@awebai/oats","version":"${PKG_VERSION}","desktopApi":1,"runtimes":["pi","claude","codex"],"sessionBackends":["tmux","herdr"],"launchOptions":["yolo"],"remote":["spawn","retire","status","session","session-start","session-restart","launch-config","roster","harvest","schedule","session-upload","operations"],"features":["retire-home","session-start","session-restart","launch-config","schedule","session-upload","operations","instance-git","instance-git-remote","souls-declarations","lifecycle-plans","retire-retention","readiness","spawn-preview","instance-events","instance-events-2","schedule-history","schedule-read-2","spawn-preview-2","spawn-idempotency","spawn-idempotency-2","spawn-apply-2","workspace-v2","instance-modules","spawn-provider-payload","served-identity","packages-no-approval","spawn-name","settings-origins"],"workspaceApi":2,"instanceGitApi":1,"spawnApplyApi":1,"soulsApi":2,"lifecycleApi":1,"readinessApi":2,"spawnPreviewApi":2,"eventsApi":2,"scheduleHistoryApi":3,"scheduleApi":2,"operationsApi":2,"capturedDispatchApi":1,"capturedDispatchActions":["inspect","compose","command","operation","spawn","trust"]}`);
});

test("oats version human output stays ergonomic and mentions the version", () => {
  const r = spawnSync(process.execPath, [CLI, "version"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(PKG_VERSION.replace(/\./g, "\\.")));
});

test("oats spawn --json success is one envelope with the contract result fields", (t) => {
  const fx = v2Deployment({ souls: { dev: { soul: { work: "checkout" } } } }); t.after(() => fx.cleanup());
  const r = fx.cli(["spawn", "dev", "--task", "contract check", "--purpose", "ctr", "--no-launch", "--json"], { env: { PI_AGENTS_TMUX_SESSION: "oats-test-nosuch" } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const doc = parseOnly(r.stdout);
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.ok, true);
  const res = doc.result;
  for (const key of ["instance", "agent", "home", "work", "branch", "launched", "warnings", "tmux"]) {
    assert.ok(key in res, `result.${key} present`);
  }
  assert.equal(res.agent, "dev");
  assert.match(res.instance, /^dev-ctr/);
  assert.equal(res.work, "checkout");
  assert.equal(res.launched, false);
  assert.ok(Array.isArray(res.warnings), "warnings is always an array");
  assert.equal(typeof res.tmux.window, "string");
});

test("oats spawn --json failures are one stdout envelope, stable codes, nonzero exit", () => {
  const base = temp(); const { repo } = fixtureSoul(base);
  const env = { ...process.env, PATH: fakeRuntimes(base), PI_AGENTS_TMUX_SESSION: "oats-test-nosuch" };
  delete env.PI_AGENTS_ROOT;
  const cases = [
    { args: ["spawn", "--json"], code: "E_USAGE" },
    { args: ["spawn", "no-such-agent", "--json"], code: "E_UNKNOWN_AGENT" },
    { args: ["spawn", "dev", "--parent", "ghost-1", "--json"], code: "E_PARENT_NOT_FOUND" },
    { args: ["spawn", "dev", "--task", "--json"], code: "E_BAD_ARGS" }, // --task without value
    { args: ["spawn", "dev", "--task-file", join(base, "missing.md"), "--json"], code: "E_BAD_ARGS" },
  ];
  for (const c of cases) {
    const r = spawnSync(process.execPath, [CLI, ...c.args, "--no-launch"], { cwd: repo, env, encoding: "utf8" });
    assert.notEqual(r.status, 0, `${c.args.join(" ")} exits nonzero`);
    const doc = parseOnly(r.stdout);
    assert.equal(doc.schemaVersion, 1);
    assert.equal(doc.ok, false);
    assert.equal(doc.error.code, c.code, `${c.args.join(" ")} → ${c.code} (got ${doc.error.code}: ${doc.error.message})`);
    assert.equal(typeof doc.error.message, "string");
  }
  // No deployment at all → E_NO_DEPLOYMENT.
  const bare = temp();
  const r = spawnSync(process.execPath, [CLI, "spawn", "dev", "--json", "--dir", bare, "--no-launch"], { cwd: bare, env, encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.equal(parseOnly(r.stdout).error.code, "E_NO_DEPLOYMENT");
});

test("okf harvest --json: no unprocessed input reports an empty durable queue", t => {
  const f = okfFixture(t);
  const r = f.direct(["harvest", "--no-launch"]);
  assert.deepEqual(parseOnly(r.stdout), { schemaVersion: 1, ok: true, result: { status: "empty", processed: true } });
});

test("okf harvest --json: actual directory worker identity through the public CLI boundary", t => {
  const f = okfFixture(t);
  write(join(f.home, "notes/a-note.md"), "---\ntype: Lesson\n---\n\nA durable observation.\n");
  const r = f.raw(["okf", "harvest", "--home", f.home, "--no-launch", "--soul", "source", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const doc = parseOnly(r.stdout);
  assert.equal(doc.ok, true); assert.equal(doc.result.status, "ready");
  assert.match(doc.result.instance, /^memory-harvest-/); assert.ok(doc.result.run);
  const meta = JSON.parse(readFileSync(join(doc.result.home, "instance.json"), "utf8"));
  assert.equal(meta.work, "directory"); assert.equal(meta.launched, false);
  assert.ok(existsSync(join(doc.result.home, "work/input.json")));
  assert.ok(existsSync(join(doc.result.home, "work/staging.json")));
  f.complete(doc.result, f.judgment(doc.result, { drop: true }));
  f.retire(doc.result.instance); f.retire(f.source.instance);
});

test("okf refuses a missing absolute OATS_CLI_BIN without private imports or PATH fallback", t => {
  const f = okfFixture(t);
  write(join(f.home, "notes/a-note.md"), "Preserve the source note.\n");
  const r = f.direct(["harvest", "--no-launch"], { environment: { OATS_CLI_BIN: undefined }, status: 1 });
  const doc = parseOnly(r.stdout);
  assert.equal(doc.ok, false); assert.equal(doc.error.code, "E_RUNTIME");
  assert.match(doc.error.message, /absolute OATS_CLI_BIN/);
  assert.ok(existsSync(join(f.home, "notes/a-note.md")));
});

// ---- end-to-end capability dispatch: `oats <ns> <cmd> --json` boundary ----
// The generic dispatcher itself must honor the envelope: inactive namespace,
// unknown subcommand, unknown namespace, and malformed instance metadata all
// print exactly one envelope object on stdout with a stable code.

function opsCapability(repo, { commands = { ping: "ping.mjs" } } = {}) {
  const dir = join(repo, ".agents", "capabilities", "owned", "ops");
  write(join(dir, "oats.json"), JSON.stringify({ capability: "acme.ops", command: "ops", version: "1.0.0", compatibility: { oats: ">=0.6.2" }, description: "Ops.", commands }));
  write(join(dir, "ping.mjs"), "console.log(JSON.stringify({schemaVersion:1,ok:true,result:{pong:true}}))\n");
  return dir;
}

test("--help never executes: kernel builtins print usage, capability commands answer from the manifest", () => {
  const base = temp(); const { repo } = fixtureSoul(base);
  const envNoHome = { ...process.env, PI_AGENT_HOME: "", OATS_HOME: "" };
  // A builtin with side effects (sync goes to the remotes and writes the lock): --help prints usage and touches nothing.
  let r = spawnSync(process.execPath, [CLI, "sync", "--help", "--dir", repo], { cwd: repo, encoding: "utf8", env: envNoHome });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^Usage:\n  oats sync/); assert.doesNotMatch(r.stdout, /no oats-local\.yaml/);
  assert.equal(existsSync(join(repo, "oats-lock.json")), false, "sync --help wrote no lock");
  r = spawnSync(process.execPath, [CLI, "spawn", "-h"], { cwd: repo, encoding: "utf8", env: envNoHome });
  assert.equal(r.status, 0); assert.match(r.stdout, /oats spawn <agent>/);
  r = spawnSync(process.execPath, [CLI, "update", "--help", "--json"], { cwd: repo, encoding: "utf8", env: envNoHome });
  assert.equal(r.status, 0); const helpDoc = parseOnly(r.stdout); assert.equal(helpDoc.result.command, "update"); assert.ok(helpDoc.result.usage.some((l) => /oats update \[--check\]/.test(l)));
  // A capability command: the executable must not run for --help.
  const dir = opsCapability(repo);
  const marker = join(base, "ping-ran");
  write(join(dir, "ping.mjs"), `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "ran"); console.log(JSON.stringify({schemaVersion:1,ok:true,result:{pong:true}}))\n`);
  write(join(repo, "oats-config.yaml"), "capabilities:\n  additive:\n    acme.ops:\n      souls:\n        dev: true\n");
  const home = join(base, "instance"); mkdirSync(home);
  write(join(home, "instance.json"), JSON.stringify({ repo, capabilities: [{ id: "acme.ops" }] }));
  const envHome = { ...process.env, PI_AGENT_HOME: home, OATS_HOME: home };
  for (const argv of [["ops", "ping", "--help"], ["ops", "ping", "-h"], ["ops", "--help"], ["ops", "ping", "--json", "--help"]]) {
    r = spawnSync(process.execPath, [CLI, ...argv], { cwd: repo, encoding: "utf8", env: envHome });
    assert.equal(r.status, 0, `${argv.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.equal(existsSync(marker), false, `${argv.join(" ")} ran the executable`);
    if (argv.includes("--json")) { const d = parseOnly(r.stdout); assert.equal(d.result.capability, "acme.ops"); assert.deepEqual(d.result.commands, ["ping"]); }
    else assert.match(r.stdout, /acme\.ops.*\n\s+commands: ping/);
  }
  // Without --help the executable still runs.
  r = spawnSync(process.execPath, [CLI, "ops", "ping"], { cwd: repo, encoding: "utf8", env: envHome });
  assert.equal(r.status, 0, r.stderr); assert.equal(existsSync(marker), true);
});

test("capability dispatch --json failures are one stdout envelope with stable codes", () => {
  const base = temp(); const { repo } = fixtureSoul(base);
  opsCapability(repo);
  write(join(repo, "oats-config.yaml"), "capabilities:\n  additive:\n    acme.ops:\n      souls:\n        dev: true\n");
  const envNoHome = { ...process.env, PI_AGENT_HOME: "", OATS_HOME: "" };
  // inactive namespace (not active in this context) → E_CAPABILITY_INACTIVE
  let r = spawnSync(process.execPath, [CLI, "ops", "ping", "--json"], { cwd: repo, encoding: "utf8", env: envNoHome });
  assert.notEqual(r.status, 0);
  assert.equal(parseOnly(r.stdout).error.code, "E_CAPABILITY_INACTIVE");
  // active via instance metadata: unknown subcommand → E_UNKNOWN_COMMAND
  const home = join(base, "instance"); mkdirSync(home);
  write(join(home, "instance.json"), JSON.stringify({ repo, capabilities: [{ id: "acme.ops" }] }));
  const envHome = { ...process.env, PI_AGENT_HOME: home };
  r = spawnSync(process.execPath, [CLI, "ops", "nope", "--json"], { cwd: home, encoding: "utf8", env: envHome });
  assert.notEqual(r.status, 0);
  assert.equal(parseOnly(r.stdout).error.code, "E_UNKNOWN_COMMAND");
  // success passes the child's envelope through untouched
  r = spawnSync(process.execPath, [CLI, "ops", "ping", "--json"], { cwd: home, encoding: "utf8", env: envHome });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(parseOnly(r.stdout).result, { pong: true });
  // unknown namespace entirely → E_UNKNOWN_COMMAND (help must not hit stdout)
  r = spawnSync(process.execPath, [CLI, "nosuchns", "x", "--json"], { cwd: repo, encoding: "utf8", env: envNoHome });
  assert.notEqual(r.status, 0);
  assert.equal(parseOnly(r.stdout).error.code, "E_UNKNOWN_COMMAND");
  // malformed instance.json → E_CONFIG_BROKEN
  const badHome = join(base, "bad-instance"); mkdirSync(badHome);
  write(join(badHome, "instance.json"), "{not json");
  r = spawnSync(process.execPath, [CLI, "ops", "ping", "--json"], { cwd: badHome, encoding: "utf8", env: { ...process.env, PI_AGENT_HOME: badHome } });
  assert.notEqual(r.status, 0);
  assert.equal(parseOnly(r.stdout).error.code, "E_CONFIG_BROKEN");
});

test("capability dispatch --json: broken manifests and malformed command values still emit one envelope", () => {
  // Reviewer repro 1: an instance whose metadata carries a team snapshot plus
  // a malformed capability oats.json in the context — manifest discovery throws
  // AFTER the metadata try, which previously escaped with empty stdout.
  const base = temp(); const { repo } = fixtureSoul(base);
  opsCapability(repo);
  write(join(repo, "oats-config.yaml"), "name: fixture\n"); // config level so .agents/capabilities is discovered
  write(join(repo, ".agents", "capabilities", "owned", "broken", "oats.json"), "{malformed");
  const home = join(base, "instance"); mkdirSync(home);
  write(join(home, "instance.json"), JSON.stringify({
    repo, capabilities: [{ id: "acme.ops" }],
    team: { name: "t", id: "t1", scope: base }, // team snapshot: metadata parse succeeds
  }));
  const env = { ...process.env, PI_AGENT_HOME: home };
  let r = spawnSync(process.execPath, [CLI, "ops", "ping", "--json"], { cwd: home, encoding: "utf8", env });
  assert.notEqual(r.status, 0);
  const doc1 = parseOnly(r.stdout); // throws if stdout is empty or contaminated
  assert.equal(doc1.ok, false);
  // Manifest discovery failures are deliberately classified E_CAPABILITY_BROKEN
  // — assert the exact code so a classification regression cannot pass.
  assert.equal(doc1.error.code, "E_CAPABILITY_BROKEN");

  // Reviewer repro 2: manifest command values that are declared but invalid —
  // non-string (42), empty string, and falsy non-strings (0/false/null) must
  // all be E_CAPABILITY_BROKEN, never E_UNKNOWN_COMMAND (the key IS declared).
  const base2 = temp(); const { repo: repo2 } = fixtureSoul(base2);
  const dir = join(repo2, ".agents", "capabilities", "owned", "ops");
  write(join(repo2, "oats-config.yaml"), "name: fixture\n");
  const home2 = join(base2, "instance"); mkdirSync(home2);
  write(join(home2, "instance.json"), JSON.stringify({ repo: repo2, capabilities: [{ id: "acme.ops" }] }));
  for (const bad of [42, "", 0, false, null]) {
    write(join(dir, "oats.json"), JSON.stringify({ capability: "acme.ops", command: "ops", version: "1.0.0", compatibility: { oats: ">=0.6.2" }, description: "Ops.", commands: { ping: bad } }));
    r = spawnSync(process.execPath, [CLI, "ops", "ping", "--json"], { cwd: home2, encoding: "utf8", env: { ...process.env, PI_AGENT_HOME: home2 } });
    assert.notEqual(r.status, 0, `commands.ping=${JSON.stringify(bad)} exits nonzero`);
    const doc2 = parseOnly(r.stdout);
    assert.equal(doc2.error.code, "E_CAPABILITY_BROKEN", `commands.ping=${JSON.stringify(bad)} → E_CAPABILITY_BROKEN (got ${doc2.error.code})`);
    assert.match(doc2.error.message, /non-empty string/);
  }
  // …while a genuinely undeclared subcommand stays E_UNKNOWN_COMMAND.
  r = spawnSync(process.execPath, [CLI, "ops", "undeclared", "--json"], { cwd: home2, encoding: "utf8", env: { ...process.env, PI_AGENT_HOME: home2 } });
  assert.notEqual(r.status, 0);
  assert.equal(parseOnly(r.stdout).error.code, "E_UNKNOWN_COMMAND");
});

test("oats okf harvest --json end-to-end dispatch and explicit invalid settings", t => {
  const f = okfFixture(t);
  const r = f.raw(["okf", "harvest", "--home", f.home, "--no-launch", "--soul", "source", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(parseOnly(r.stdout), { schemaVersion: 1, ok: true, result: { status: "empty", processed: true } });
  // init reads settings even for an already registered source (harvest resumes
  // frozen bindings by design, rather than trusting a changed environment).
  const malformed = f.direct(["init", "--base", "project"], { environment: { OATS_SETTINGS: "{broken" }, status: 1 });
  assert.equal(parseOnly(malformed.stdout).ok, false);
  const unsupported = f.direct(["init", "--base", "project"], { environment: { OATS_SETTINGS: JSON.stringify({ "bindings-file": f.bindings, "harvest-runtime": "unsupported" }) }, status: 1 });
  const diagnostic = parseOnly(unsupported.stdout).error;
  assert.equal(diagnostic.code, "E_CONFIG");
  assert.match(diagnostic.message, /invalid harvest-runtime/);
});
