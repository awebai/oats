// Package souls under team model v2 (kernel main, features package-souls + team-model-2): the
// kernel's own test helpers (test/helpers/v2-deployment.mjs + package-repo.mjs) build a real
// deployment whose package ships a soul. Captures what the Desktop reads for it: oats souls
// (kind package, qualifiedName), workspace status, oats soul teams by the qualified name (the
// Desktop's exact argv), a preview + spawn by qualifiedName, and status (the agent directory name).
// Isolated by the helpers (HOME, cache, git config). No runtime, tmux or network.
// Usage: OUT=out-pkg node capture-package-souls.mjs <kernel-tree>
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [REPO] = process.argv.slice(2);
if (!REPO?.startsWith("/")) throw new Error("kernel tree required");
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, process.env.OUT || "out-pkg"); rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const { v2Deployment } = await import(pathToFileURL(join(REPO, "test/helpers/v2-deployment.mjs")).href);
const { packageRepo } = await import(pathToFileURL(join(REPO, "test/helpers/package-repo.mjs")).href);
const commit = process.env.CAPTURE_COMMIT || "unknown";

const pkg = packageRepo({ souls: { keeper: {} } });
const fx = v2Deployment({ name: "acme", souls: { dev: {} }, workspace: { packages: { "acme.pkg": `${pkg.ref}@v1.0.0` }, teams: { global: { description: "Fixture team" } } } });
const redact = s => (s || "").split(fx.base).join("<base>").split(pkg.base).join("<pkg>").split(REPO).join("<oats>");
const prov = [];
function run(name, args, { expect = 0 } = {}) {
  const r = fx.cli(args);
  prov.push({ name, argv: ["oats", ...args].map(redact), exit: r.status, commit });
  const ok = expect === "any" || (expect === null ? r.status !== 0 : r.status === expect);
  console.log(`${ok ? "ok  " : "FAIL"} ${name} exit=${r.status}`);
  writeFileSync(join(OUT, `${name}.json`), redact(r.stdout));
  if (!ok) console.log(redact(r.stdout).slice(0, 1500), redact(r.stderr).slice(0, 600));
  return r;
}
try {
  const d = ["--dir", fx.dep, "--json"];
  run("sync", ["sync", "--json"]);
  run("souls", ["souls", ...d]);
  run("workspace-status", ["workspace", "status", ...d]);
  run("soul-teams-package-add", ["soul", "teams", "acme.pkg/keeper", "--add=global", ...d]);
  run("soul-teams-package-default", ["soul", "teams", "acme.pkg/keeper", "--default=global", ...d]);
  run("soul-teams-package-show", ["soul", "teams", "acme.pkg/keeper", ...d]);
  run("soul-teams-bare-show", ["soul", "teams", "keeper", ...d], { expect: "any" });
  run("souls-after", ["souls", ...d]);
  const preview = run("preview", ["spawn", "acme.pkg/keeper", "--dir", fx.dep, "--purpose", "q", "--preview", "--json"]);
  const decision = JSON.parse(preview.stdout).result.decision.revision;
  const applied = run("apply", ["spawn", "acme.pkg/keeper", "--dir", fx.dep, "--purpose", "q", "--expect-decision", decision, "--idempotency-key", "d".repeat(64), "--no-launch", "--json"]);
  run("status", ["status", "--dir", fx.dep, "--json"]);
  run("inspect-home", ["inspect", "--home", JSON.parse(applied.stdout).result.home, "--json"]);
  writeFileSync(join(OUT, "provenance.json"), JSON.stringify({ capturedBy: "oats-desktop-engineer: package souls under team model v2 (the roster's soul key)",
    kernelTree: `oats main @${commit}`, fixture: "the kernel's test/helpers/v2-deployment.mjs + package-repo.mjs: member soul dev, package acme.pkg v1.0.0 shipping soul keeper, shared team global",
    script: "capture-package-souls.mjs", documents: prov }, null, 2) + "\n");
} finally { fx.cleanup(); pkg.cleanup(); }
