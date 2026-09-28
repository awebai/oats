// Automation trust (0.30, docs/design/2026-09-28-automations-trust.md; kernel PR #300): the REAL kernel
// on its own test helper (test/helpers/v2-deployment.mjs) with the deployment its test/automations.test.mjs
// builds: a workspace trigger (ws/kb-review) and schedule (ws/nightly) placed on host kb-host as
// github.com/kb-bot, a fake `gh` logged in as kb-bot. Captured twice:
//   untrusted-*  oats-local.yaml has no automations.trust: both rows are reason `untrusted`, and
//                workspace status warns automation-untrusted (with the line to add as `remedy`);
//   partial-*    automations.trust: [ws/kb-review, ws/gone]: the trigger runs here, the schedule is
//                still untrusted, and ws/gone is a stale entry (automation-trust-stale).
// Usage: OUT=<relative dir> CAPTURE_COMMIT=<oid> node capture-trust.mjs <kernel-tree>
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [REPO] = process.argv.slice(2);
if (!REPO?.startsWith("/")) throw new Error("kernel tree required");
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, process.env.OUT || "out-trust"); rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const { v2Deployment } = await import(pathToFileURL(join(REPO, "test/helpers/v2-deployment.mjs")).href);
const YAML = (await import(pathToFileURL(join(REPO, "node_modules/yaml/dist/index.js")).href)).default;
const commit = process.env.CAPTURE_COMMIT || "unknown";

const REPO_KEY = "github.com/acme/knowledge";
const trigger = { kind: "oats-trigger", schemaVersion: 1, description: "Review harvest PRs", runsOn: "kb-host", owner: "github.com/kb-bot",
  on: { source: "github.pull_request", repo: REPO_KEY, events: ["opened"], labels: ["okf-harvest"], poll: "2m" },
  spawn: { soul: "reviewer", purpose: "review-pr-{number}", task: "Review {repo}#{number} ({url})." } };
const schedule = { kind: "oats-schedule", schemaVersion: 1, runsOn: "kb-host", owner: "github.com/kb-bot", run: "spawn", cron: "0 7 * * *", tz: "UTC", agent: "reviewer", task: "Write the nightly digest." };
const fx = v2Deployment({ name: "acme", souls: { reviewer: {} }, local: { host: { name: "kb-host" } },
  files: { "oats-triggers/kb-review.yaml": { yaml: trigger }, "ops/nightly.oats-schedule.yaml": { yaml: schedule } } });
// The kernel test's fake gh: `api user` answers kb-bot; the PR poll answers [].
const gh = join(fx.base, "gh"), bin = join(gh, "bin"); mkdirSync(bin, { recursive: true });
writeFileSync(join(bin, "gh"), `#!/bin/sh\ncase "$*" in\n  "api user"*) echo kb-bot; exit 0 ;;\n  *"/pulls"*) echo "[]"; exit 0 ;;\nesac\necho "unexpected gh $*" >&2; exit 2\n`);
chmodSync(join(bin, "gh"), 0o755);
const PATH = `${bin}:${join(fx.base, "runtime-stub")}:${dirname(process.execPath)}:/usr/bin:/bin`;
const setLocal = extra => writeFileSync(join(fx.dep, "oats-local.yaml"), YAML.stringify({ schemaVersion: 2, workspace: fx.ref, ...extra }));
const redact = s => (s || "").split(fx.base).join("<base>").split(REPO).join("<oats>");
const prov = [];
function run(name, args) {
  const r = fx.cli(args, { env: { PATH } });
  prov.push({ name, argv: ["oats", ...args].map(redact), exit: r.status, commit });
  console.log(`${r.status === 0 ? "ok  " : "FAIL"} ${name} exit=${r.status}`);
  writeFileSync(join(OUT, `${name}.json`), redact(r.stdout));
  if (r.status !== 0) console.log(redact(r.stdout).slice(0, 1500), redact(r.stderr).slice(0, 600));
  return r;
}
try {
  run("version", ["version", "--json"]);
  run("sync", ["sync", "--json"]);
  run("untrusted-trigger-list", ["trigger", "list", "--json"]);
  run("untrusted-schedule-list", ["schedule", "list", "--json"]);
  run("untrusted-workspace-status", ["workspace", "status", "--json"]);
  setLocal({ host: { name: "kb-host" }, automations: { trust: ["ws/kb-review", "ws/gone"] } });
  run("partial-trigger-list", ["trigger", "list", "--json"]);
  run("partial-schedule-list", ["schedule", "list", "--json"]);
  run("partial-workspace-status", ["workspace", "status", "--json"]);
  writeFileSync(join(OUT, "provenance.json"), JSON.stringify({ capturedBy: "ux-designer: automation trust on the real kernel (0.30, PR #300)",
    kernelTree: `oats PR #300 @${commit}`, fixture: "the kernel's test/helpers/v2-deployment.mjs as test/automations.test.mjs builds it: trigger ws/kb-review + schedule ws/nightly on kb-host as github.com/kb-bot; fake gh (kb-bot); untrusted, then trust [ws/kb-review, ws/gone]",
    script: "capture-trust.mjs", documents: prov }, null, 2) + "\n");
} finally { fx.cleanup(); }
