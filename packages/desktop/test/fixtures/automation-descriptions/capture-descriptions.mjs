// Automation descriptions (kernel 0.43, feature automation-descriptions): the REAL kernel on its own
// test helpers (test/helpers/v2-deployment.mjs, package-repo.mjs), the deployment its
// test/automation-descriptions.test.mjs builds (host kb-host, a fake gh logged in as kb-bot, trust "*"):
//   local schedules of every run: a command WITH a description, then a wake, an operation and a spawn
//     without one (the Desktop falls back to the prompt's first line, or "No summary");
//   a local trigger with one (--description=); workspace triggers made `from:` a package template
//     carrying definition.description, with and without a header description, and one whose header
//     breaks the rule (a warning: it runs, description null, the template's shows);
//   a workspace schedule whose header breaks the rule (a warning, description null);
//   the description-only update verbs: set, clear, refused (out of rule, workspace, another flag, unknown);
//   run state, by the kernel's own state files: the command job holding its lock with its attempt
//     (running), the wake job with an attempt that has no recorded result (unknown, exited 1), the
//     spawn job with a pending wake; a command run by the kernel's own runNow whose launch threw (its
//     effects unconfirmed: unknown, and it KEEPS its lock); then `schedule reconcile local/<id>`.
// Writes the documents here, `<base>` → /fixture/base, with provenance.json (argv, exit, sha256).
// Usage: CAPTURE_COMMIT=<oid> node capture-descriptions.mjs <kernel-tree>
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [REPO] = process.argv.slice(2);
if (!REPO?.startsWith("/")) throw new Error("kernel tree required");
const HERE = dirname(fileURLToPath(import.meta.url));
const commit = process.env.CAPTURE_COMMIT || "unknown";
const load = rel => import(pathToFileURL(join(REPO, rel)).href);
const { v2Deployment } = await load("test/helpers/v2-deployment.mjs");
const { packageRepo } = await load("test/helpers/package-repo.mjs");
const S = await load("lib/schedule.mjs");

const REPO_KEY = "github.com/acme/knowledge";
const header = { schemaVersion: 1, runsOn: "kb-host", owner: "github.com/kb-bot" };
const on = { source: "github.pull_request", repo: REPO_KEY, events: ["opened"], labels: ["okf-harvest"], poll: "2m" };
const template = {
  parameters: { repo: { path: "on.repo", required: true } },
  definition: { id: "harvest-review", enabled: true, kind: "trigger", description: "Review each harvest PR (template)",
    on: { ...on, repo: null }, spawn: { soul: "acme.pkg/keeper", purpose: "review-pr-{number}", task: "Review knowledge-base PR {repo}#{number}." } },
};
const pkg = packageRepo({ manifest: { triggers: [{ id: "harvest-review", file: "triggers/harvest-review.json" }] }, files: { "triggers/harvest-review.json": template } });
const fromFile = (extra = {}) => ({ yaml: { kind: "oats-trigger", ...header, from: "acme.pkg:harvest-review", set: { repo: REPO_KEY }, ...extra } });
const schedule = { kind: "oats-schedule", ...header, run: "spawn", cron: "0 7 * * *", tz: "UTC", agent: "reviewer", task: "Write the nightly digest." };
const fx = v2Deployment({ name: "acme", souls: { reviewer: {} }, local: { host: { name: "kb-host" }, automations: { trust: "*" } },
  workspace: { packages: { "acme.pkg": `${pkg.ref}@v1.0.0` } }, files: {
    "oats-triggers/from-template.yaml": fromFile(),
    "oats-triggers/from-header.yaml": fromFile({ description: "The header wins" }),
    "oats-triggers/from-bad-header.yaml": fromFile({ description: "Review\tharvest PRs" }),
    "ops/nightly.oats-schedule.yaml": { yaml: { ...schedule, description: "x".repeat(201) } },
  } });
const gh = join(fx.base, "gh", "bin"); mkdirSync(gh, { recursive: true });
writeFileSync(join(gh, "gh"), `#!/bin/sh\ncase "$*" in\n  "api user"*) echo kb-bot; exit 0 ;;\n  *"/pulls"*) echo "[]"; exit 0 ;;\nesac\necho "unexpected gh $*" >&2; exit 2\n`);
chmodSync(join(gh, "gh"), 0o755);
fx.env.PATH = `${gh}:${fx.env.PATH}`;

const redact = s => (s || "").split(fx.base).join("/fixture/base").split(REPO).join("/fixture/oats");
const argvText = a => redact(a).replaceAll("/fixture/base", "<base>");
const sha = s => createHash("sha256").update(s).digest("hex");
const files = {};
function run(name, args) {
  const r = fx.cli(args);
  const text = JSON.stringify(JSON.parse(redact(r.stdout).trim().split("\n").pop()), null, 2) + "\n";
  writeFileSync(join(HERE, `${name}.json`), text);
  files[name] = { argv: ["oats", ...args].map(argvText), exit: r.status, sha256: sha(text) };
  console.log(`${r.status === 0 ? "ok  " : "exit"} ${r.status} ${name}`);
  return JSON.parse(text);
}
const file = (name, value) => { const path = join(fx.base, name); writeFileSync(path, JSON.stringify(value)); return path; };
try {
  // A local spawn names a soul this deployment has (as `oats spawn` leaves it); a wake and an
  // operation target an existing instance home inside the scope.
  await fx.prepare("reviewer");
  const home = join(fx.dep, "agents", "reviewer", "instances", "reviewer-1");
  mkdirSync(home, { recursive: true }); writeFileSync(join(home, "instance.json"), JSON.stringify({ instance: "reviewer-1" }));
  run("version", ["version", "--json"]);
  run("sync", ["sync", "--json"]);
  run("schedule-add-command", ["schedule", "add", "status", "--spec-json", JSON.stringify({ kind: "command", cron: "30 8 * * 1-5", tz: "UTC", cwd: fx.dep, argv: ["oats", "status", "--json", "--dir", "a dir/with spaces"] }), "--description=Morning workspace status", "--json"]);
  run("schedule-add-wake", ["schedule", "add", "standup", "--spec-json", JSON.stringify({ kind: "wake", cron: "0 9 * * 1-5", tz: "Europe/Madrid", home, message: "\n  Post the standup summary to the team.\nThen check the release branch." }), "--json"]);
  run("schedule-add-operation", ["schedule", "add", "harvest", "--spec-json", JSON.stringify({ kind: "operation", cron: "0 */6 * * *", tz: "UTC", home, operation: "knowledge:harvest" }), "--json"]);
  run("schedule-add-threw", ["schedule", "add", "threw", "--spec-json", JSON.stringify({ kind: "command", cron: "0 * * * *", tz: "UTC", cwd: fx.dep, argv: ["oats", "status"] }), "--json"]);
  run("schedule-add-spawn", ["schedule", "add", "digest", "--spec-json", JSON.stringify({ kind: "spawn", cron: "0 7 * * *", tz: "UTC", agent: "reviewer", task: "Write the nightly digest.\nKeep it under a page.",
    purpose: "digest", harness: "claude", model: "opus", yolo: false, backend: "tmux", wake: { cron: "0 12 * * *", tz: "UTC", message: "Midday: post progress." } }), "--json"]);
  run("trigger-add-local", ["trigger", "add", "--file", file("t.json", { id: "kb-review", kind: "trigger", on, spawn: { soul: "reviewer", purpose: "{trigger}-{number}", task: "Review {repo}#{number}." } }), "--description=Reviews every harvest PR", "--json"]);
  run("trigger-add-plain", ["trigger", "add", "--file", file("u.json", { id: "kb-triage", kind: "trigger", on, spawn: { soul: "reviewer", purpose: "triage-{number}", task: "\nTriage {repo}#{number} and label it." } }), "--json"]);
  // The description-only updates.
  run("schedule-update-describe", ["schedule", "update", "local/harvest", "--description=Harvest the knowledge base", "--json"]);
  run("schedule-update-clear", ["schedule", "update", "local/harvest", "--description=", "--json"]);
  run("schedule-update-invalid", ["schedule", "update", "local/harvest", "--description=two\nlines", "--json"]);
  run("schedule-update-workspace", ["schedule", "update", "ws/nightly", "--description=x", "--json"]);
  run("trigger-update-describe", ["trigger", "update", "local/kb-triage", "--description=--Triage new harvest PRs", "--json"]);
  run("trigger-update-clear", ["trigger", "update", "local/kb-triage", "--description=", "--json"]);
  run("trigger-update-flag", ["trigger", "update", "local/kb-triage", "--description=x", "--file", join(fx.base, "u.json"), "--json"]);
  run("trigger-update-workspace", ["trigger", "update", "ws/from-template", "--description=x", "--json"]);
  run("trigger-update-unknown", ["trigger", "update", "local/nope", "--description=x", "--json"]);
  // Run state, as the kernel's tick leaves it (lib/schedule.mjs: the attempt it admits, the job lock,
  // the result it records, a wake it defers).
  const state = { jobs: {
    status: { attempt: { scheduledFor: "2026-10-06T08:30:00.000Z", startedAt: "2026-10-06T08:30:04.000Z", wallClock: "2026-10-06T08:30:04.000Z" } },
    standup: { attempt: { scheduledFor: "2026-10-06T07:00:00.000Z", startedAt: "2026-10-06T07:00:03.000Z", wallClock: "2026-10-06T07:00:03.000Z", error: "the wake was not confirmed", exited: true, exitStatus: 1, exitSignal: null } },
    digest: { pendingWake: { scheduledFor: "2026-10-06T12:00:00.000Z" } },
  } };
  mkdirSync(S.stateDir(fx.dep), { recursive: true }); writeFileSync(join(S.stateDir(fx.dep), "state.json"), JSON.stringify(state));
  S.acquireJobLock(fx.dep, "status", { pid: process.pid });
  // The kernel's run-now with a launcher that throws (lib/schedule.mjs: a command that threw is
  // unconfirmed and keeps its slot), as test/schedule.test.mjs drives it.
  await fx.inEnv(async () => S.runNow(fx.dep, "threw", { now: new Date("2026-10-06T09:00:00.000Z"), io: { command() { throw new Error("the command launcher failed"); } } }));
  run("schedule-list", ["schedule", "list", "--json"]);
  run("trigger-list", ["trigger", "list", "--json"]);
  run("schedule-reconcile", ["schedule", "reconcile", "local/standup", "--json"]);
  S.releaseJobLock(fx.dep, "status");
  writeFileSync(join(HERE, "provenance.json"), JSON.stringify({
    capturedBy: "oats-desktop-developer-automation-descriptions: the Desktop's automation summaries on the real kernel",
    kernelTree: `oats branch agents/oats-kernel-developer-automation-descriptions @${commit}`, script: "capture-descriptions.mjs",
    fixture: "test/helpers/v2-deployment.mjs as test/automation-descriptions.test.mjs builds it (kb-host, fake gh kb-bot, trust *), package acme.pkg with trigger template harvest-review",
    redactions: ["<base> (capture scratch) → /fixture/base", "<oats> (kernel tree) → /fixture/oats"], files }, null, 2) + "\n");
} finally { fx.cleanup(); pkg.cleanup(); }
