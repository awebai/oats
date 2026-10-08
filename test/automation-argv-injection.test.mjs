// Re-review B #1 (security): an automation's `model` reached the spawn child as `--model <value>`,
// and the child expands `--x=y` with the first flag winning — so `model: "--task-file=<secret>"`
// made that file the TASK.md, and `--work=checkout` / `--allow-child-spawns` slipped past the
// schema. Two layers, each tested on its own:
//   (a) validation: `model` is a model id (MODEL_RE); a schedule's agent/repo are never options;
//   (b) argv: every value travels as ONE `--flag=value` token, and the CLI refuses an inline
//       value that is itself an option — so (b) holds even when (a) is bypassed.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const T = await import("../lib/triggers.mjs");
const S = await import("../lib/schedule.mjs");

const REAL_MODELS = ["github-copilot/gpt-5.6-sol:high", "anthropic/claude-opus-5:high", "anthropic/claude-sonnet-4-5:thinking", "openai/gpt-5.5-mini", "claude-opus-5", "claude-opus-5[1m]", "gpt-5.5", "@native-default"];
const HOSTILE_MODELS = ["--task-file=/Users/v/.ssh/id_ed25519", "--work=checkout", "--allow-child-spawns", "--yolo", "-x", "a b", "m\n--yolo", "", " ", "@x", "x".repeat(129)];

const trigger = (spawn = {}) => ({
  id: "kb-review", enabled: true, kind: "trigger",
  on: { source: "github.pull_request", repo: "github.com/acme/knowledge", events: ["opened"], labels: ["okf-harvest"], base: "main", poll: "2m" },
  spawn: { soul: "reviewer", purpose: "review-pr-{number}", task: "Review {repo}#{number}.", ...spawn },
});
const schedule = (extra = {}) => ({ id: "digest", kind: "spawn", cron: "0 7 * * *", tz: "UTC", agent: "reviewer", task: "Digest.", ...extra });

test("(a) a trigger's spawn.model is a model id: every model in use passes; an option-shaped or malformed value is E_TRIGGER_INVALID", () => {
  for (const model of REAL_MODELS) assert.equal(T.validateTrigger(trigger({ model })).spawn.model, model, model);
  for (const model of HOSTILE_MODELS) {
    assert.throws(() => T.validateTrigger(trigger({ model })), (e) => e.code === "E_TRIGGER_INVALID" && e.field === "spawn.model", JSON.stringify(model));
  }
});

test("(a) a schedule's model is a model id, and its agent and repo are never options: E_SCHEDULE_INVALID", (t) => {
  const fx = v2Deployment({ name: "acme" }); t.after(fx.cleanup);
  for (const model of REAL_MODELS) assert.equal(S.validateDefinition(fx.dep, schedule({ model }), { checkAgent: false }).model, model, model);
  for (const model of HOSTILE_MODELS) {
    assert.throws(() => S.validateDefinition(fx.dep, schedule({ model }), { checkAgent: false }), (e) => e.code === "E_SCHEDULE_INVALID" && e.field === "model", JSON.stringify(model));
  }
  assert.throws(() => S.validateDefinition(fx.dep, schedule({ agent: "--allow-child-spawns" }), { checkAgent: false }), (e) => e.code === "E_SCHEDULE_INVALID" && e.field === "agent");
  assert.throws(() => S.validateDefinition(fx.dep, schedule({ repo: "--work=checkout" }), { checkAgent: false }), (e) => e.code === "E_SCHEDULE_INVALID" && e.field === "repo");
});

test("(b) the CLI refuses an inline value that is itself an option (`--model=--task-file=…`, `--model=--yolo`) with E_BAD_ARGS, and creates nothing", (t) => {
  const fx = v2Deployment({ name: "acme" }); t.after(fx.cleanup);
  const secret = join(fx.base, "id_ed25519"); writeFileSync(secret, "PRIVATE KEY MATERIAL\n");
  for (const inline of [`--model=--task-file=${secret}`, "--model=--yolo", "--purpose=--allow-child-spawns"]) {
    const r = fx.cli(["spawn", "dev", `--dir=${fx.dep}`, inline, "--no-launch", "--json"]);
    const j = r.json();
    assert.equal(j.ok, false, `${inline}: ${r.stdout}${r.stderr}`);
    assert.equal(j.error.code, "E_BAD_ARGS", inline);
    assert.match(j.error.message, /takes a value, not an option/, inline);
  }
  assert.equal(existsSync(join(fx.root, "dev", "instances")) && readdirSync(join(fx.root, "dev", "instances")).length > 0, false, "no instance was created");
});

test("(b) holds when validation is bypassed: the trigger's spawn child gets `--model=<value>` as ONE token, and the real CLI refuses it — the secret never becomes a TASK.md", async (t) => {
  const fx = v2Deployment({ name: "acme", souls: { reviewer: {} } }); t.after(fx.cleanup);
  const secret = join(fx.base, "id_ed25519"); writeFileSync(secret, "PRIVATE KEY MATERIAL\n");
  const bypassed = { ...T.validateTrigger(trigger()), spawn: { ...T.validateTrigger(trigger()).spawn, model: `--task-file=${secret}`, harness: "pi" } };
  const ev = { repo: "github.com/acme/knowledge", number: 7, url: "https://github.com/acme/knowledge/pull/7", event: "opened", headSha: "a".repeat(40), labels: ["okf-harvest"], key: "k" };

  // The argv the tick hands the child, captured by a stand-in CLI.
  const capture = join(fx.base, "fake-oats.mjs"), log = join(fx.base, "argv.json");
  writeFileSync(capture, `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));\nconsole.log(JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_CAPTURED", message: "captured" } }));\n`);
  chmodSync(capture, 0o755);
  // The tick previews the soul with the real CLI (its stem and messaging capability) and hands that to the spawn.
  const pv = await fx.inEnv(() => T.previewSoul(fx.dep, bypassed, {}));
  assert.equal(pv.ok, true, JSON.stringify(pv));
  await assert.rejects(fx.inEnv(() => T.spawnForEvent(fx.dep, bypassed, ev, { oatsBin: capture, noLaunch: true }, pv)), (e) => e.code === "E_CAPTURED");
  const argv = JSON.parse(readFileSync(log, "utf8"));
  assert.ok(argv.includes(`--model=--task-file=${secret}`), `one token: ${JSON.stringify(argv)}`);
  assert.equal(argv.includes("--model"), false, "never a separate --model followed by the value");
  const taskFiles = argv.filter((a) => a.startsWith("--task-file"));
  assert.equal(taskFiles.length, 1, "the value never stands as a --task-file of its own");
  assert.match(taskFiles[0], /^--task-file=.*\/\.agents\/schedules\/tasks\/trigger-kb-review-/, "the only --task-file is the trigger's private task file");
  assert.ok(argv.includes(`--dir=${fx.dep}`) && argv.includes("--purpose=review-pr-7") && argv.includes("--harness=pi"), JSON.stringify(argv));

  // The real CLI, the same argv: refused before anything is created.
  await assert.rejects(fx.inEnv(() => T.spawnForEvent(fx.dep, bypassed, ev, { noLaunch: true })), (e) => e.code === "E_BAD_ARGS" && /not an option/.test(e.message));
  const instances = join(fx.root, "reviewer", "instances");
  assert.equal(existsSync(instances) && readdirSync(instances).length > 0, false, "no instance, so no TASK.md with the secret");
});

test("a hostile PR label or branch never reaches the spawn argv: the PR spawns with the soul's own work mode and default child-spawn policy", async (t) => {
  const fx = v2Deployment({ name: "acme", souls: { reviewer: { soul: { work: "directory" } } } }); t.after(fx.cleanup);
  const def = T.validateTrigger(trigger());
  // The labels are hostile; the branch is not an event field at all (never templated, never carried).
  const ev = { trigger: "local/kb-review", source: "github.pull_request", repo: "github.com/acme/knowledge", number: 8, url: "https://github.com/acme/knowledge/pull/8", event: "opened", headSha: "b".repeat(40),
    labels: ["okf-harvest", "--allow-child-spawns", "--work=checkout", "--task-file=/etc/passwd"], observedAt: "2026-09-27T10:00:00Z", key: "k8" };
  const spawned = await fx.inEnv(() => T.spawnForEvent(fx.dep, def, ev, { noLaunch: true }));
  const meta = JSON.parse(readFileSync(join(spawned.home, "instance.json"), "utf8"));
  assert.equal(meta.work, "directory", "the soul's work mode, not --work=checkout");
  assert.notEqual(meta.policy?.childSpawns?.origin?.detail, "--allow-child-spawns");
  assert.match(readFileSync(join(spawned.home, "TASK.md"), "utf8"), /Review github\.com\/acme\/knowledge#8\./);
  assert.doesNotMatch(readFileSync(join(spawned.home, "TASK.md"), "utf8"), /passwd/);
});
