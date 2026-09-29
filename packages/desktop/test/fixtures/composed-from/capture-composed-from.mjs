// Why each preview module is there (kernel #328, feature preview-composed-from, OATS 0.30.2): the
// kernel's own test helpers (test/helpers/v2-deployment.mjs + package-repo.mjs) build the deployment
// the kernel's desktop-facts test calls `origins`: soul dev declares acme.own and acme-tool itself,
// the workspace gives the messaging slot (chat) and defaults.capabilities (acme.ws), and a package
// default acme-tool the soul overrides. Captures `oats version` and the preview with the Desktop's
// exact argv (spawn-preview-cli.mjs). Isolated by the helpers (HOME, cache, git config). No runtime,
// tmux or network. Usage: OUT=out CAPTURE_COMMIT=<sha> node capture-composed-from.mjs <kernel-tree>
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [REPO] = process.argv.slice(2);
if (!REPO?.startsWith("/")) throw new Error("kernel tree required");
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, process.env.OUT || "out"); rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const { v2Deployment } = await import(pathToFileURL(join(REPO, "test/helpers/v2-deployment.mjs")).href);
const { packageRepo } = await import(pathToFileURL(join(REPO, "test/helpers/package-repo.mjs")).href);
const commit = process.env.CAPTURE_COMMIT || "unknown";

const pkg = packageRepo();
const fx = v2Deployment({
  souls: { dev: { soul: { capabilities: { "acme.own": { from: "here" }, "acme-tool": { from: "here" } } } } },
  capabilities: { "acme.own": { manifest: {} }, "acme.ws": { manifest: {} }, "acme-tool": { manifest: {} }, chat: { manifest: { layer: "messaging" } } },
});
const redact = s => (s || "").split(fx.base).join("<base>").split(pkg.base).join("<pkg>").split(REPO).join("<oats>");
const prov = [];
function run(name, args) {
  const r = fx.cli(args);
  prov.push({ name, argv: ["oats", ...args].map(redact), exit: r.status, commit });
  console.log(`${r.status === 0 ? "ok  " : "FAIL"} ${name} exit=${r.status}`);
  writeFileSync(join(OUT, `${name}.json`), redact(r.stdout));
  if (r.status !== 0) console.log(redact(r.stdout).slice(0, 1500), redact(r.stderr).slice(0, 600));
  return r;
}
try {
  fx.commit({ "oats-workspace.yaml": { yaml: { schemaVersion: 2, name: "fixture", members: [fx.ref], teams: { global: { description: "Fixture team" } },
    packages: { "acme.pkg": `${pkg.ref}@v1.0.0` },
    defaults: { knowledge: "none", messaging: { chat: { from: fx.key } }, tasks: "none",
      capabilities: { "acme.ws": { from: fx.key }, "acme-tool": { from: "package" } } } } } }, "origins");
  run("sync", ["sync", "--json"]);
  run("version", ["version", "--json"]);
  run("preview", ["spawn", "dev", "--dir", fx.dep, "--agents-root", fx.root, "--preview", "--json"]);
  writeFileSync(join(OUT, "provenance.json"), JSON.stringify({ capturedBy: "oats-desktop-developer: the spawn preview's reason tags (modules[].composedFrom)",
    kernelTree: `oats main @${commit}`, fixture: "the kernel's test/helpers/v2-deployment.mjs + package-repo.mjs, as test/desktop-facts.test.mjs `origins`: soul dev (acme.own, acme-tool from: here), workspace defaults messaging chat and capabilities acme.ws, package acme.pkg's acme-tool overridden by the soul",
    script: "capture-composed-from.mjs", documents: prov }, null, 2) + "\n");
} finally { fx.cleanup(); pkg.cleanup(); }
