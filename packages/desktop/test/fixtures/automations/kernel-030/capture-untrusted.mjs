// Real kernel capture for the Desktop (0.30 automations.trust, #300): a workspace trigger and
// schedule placed on this host (runsOn + owner match) that the host does not trust. Usage:
// node capture-untrusted.mjs <oats checkout> <out dir>, then the provenance import in the PR.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const REPO = process.argv[2], OUT = process.argv[3];
const { v2Deployment } = await import(join(REPO, "test/helpers/v2-deployment.mjs"));
const trigger = { kind: "oats-trigger", schemaVersion: 1, description: "Review knowledge PRs", runsOn: "fixture-laptop", owner: "github.com/fixture-bot",
  on: { source: "github.pull_request", repo: "github.com/northwind/knowledge", events: ["opened"], labels: ["okf-harvest"], poll: "5m" },
  spawn: { soul: "reviewer", purpose: "review-pr-{number}", task: "Review {repo}#{number} ({url})." } };
const schedule = { kind: "oats-schedule", schemaVersion: 1, runsOn: "fixture-laptop", owner: "github.com/fixture-bot", run: "spawn", cron: "0 7 * * *", tz: "UTC", agent: "reviewer", task: "Write the nightly digest." };
const fx = v2Deployment({ name: "northwind", souls: { reviewer: {} }, local: { host: { name: "fixture-laptop" } },
  files: { "oats-triggers/okf-review.yaml": { yaml: trigger }, "oats-schedules/nightly.yaml": { yaml: schedule } } });
const bin = join(fx.base, "gh-bin"); mkdirSync(bin, { recursive: true });
writeFileSync(join(bin, "gh"), `#!/bin/sh\ncase "$*" in *"api user"*) echo fixture-bot; exit 0 ;; esac\necho "[]"\n`); chmodSync(join(bin, "gh"), 0o755);
fx.env.PATH = `${bin}:${fx.env.PATH}`;
const docs = { sync: ["sync"], "trigger-list-untrusted": ["trigger", "list"], "schedule-list-untrusted": ["schedule", "list"], "workspace-status-untrusted": ["workspace", "status"] };
const provenance = { capturedBy: "cli-dev-okf-ops for #300 (automations.trust)", kernel: `${JSON.parse(fx.cli(["version", "--json"]).stdout).version} + #300`, documents: [] };
for (const [name, args] of Object.entries(docs)) {
  const r = fx.cli([...args, "--json"]);
  writeFileSync(join(OUT, `${name}.json`), r.stdout.replaceAll(fx.base, "<base>"));
  provenance.documents.push({ name, argv: ["oats", ...args, "--dir", "<base>/deployment", "--json"], exit: r.status, kernel: provenance.kernel });
}
writeFileSync(join(OUT, "provenance.json"), JSON.stringify(provenance, null, 2) + "\n");
fx.cleanup();
