// Launch preferences (feature launch-preference, kernel main with #290): the kernel's own test helper
// (test/helpers/v2-deployment.mjs) builds a real deployment with every `from` layer:
//   dev      soul.yaml launch {claude, claude-opus-5-5}      -> from soul
//   reviewer soul.yaml launch {codex}, local souls.launch pi  -> from local
//   plain    no launch                                        -> from host
// Captures souls, inspect --soul, preview (and --harness, a flag), a spawn and inspect --home; then a
// changed local preference (readiness launch-changed, launchCurrent); then codex uninstalled
// (E_HARNESS_UNAVAILABLE as a report problem and as a preview refusal). PATH is hermetic: the
// helper's inert harness stubs + node + /usr/bin:/bin (no host harness leaks in).
// Usage: OUT=out-launch CAPTURE_COMMIT=<oid> node capture-launch.mjs <kernel-tree>
import { mkdirSync, writeFileSync, rmSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [REPO] = process.argv.slice(2);
if (!REPO?.startsWith("/")) throw new Error("kernel tree required");
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, process.env.OUT || "out-launch"); rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const { v2Deployment } = await import(pathToFileURL(join(REPO, "test/helpers/v2-deployment.mjs")).href);
const YAML = (await import(pathToFileURL(join(REPO, "node_modules/yaml/dist/index.js")).href)).default;
const commit = process.env.CAPTURE_COMMIT || "unknown";

const fx = v2Deployment({ name: "acme",
  souls: { dev: { soul: { launch: { harness: "claude", model: "claude-opus-5-5" } } }, reviewer: { soul: { launch: { harness: "codex" } } }, plain: {} },
  local: { souls: { launch: { reviewer: { harness: "pi" } } } } });
const stubs = join(fx.base, "runtime-stub");
const PATH = `${stubs}:${dirname(process.execPath)}:/usr/bin:/bin`;
const redact = s => (s || "").split(fx.base).join("<base>").split(REPO).join("<oats>");
const prov = [];
function run(name, args, { expect = 0 } = {}) {
  const r = fx.cli(args, { env: { PATH } });
  prov.push({ name, argv: ["oats", ...args].map(redact), exit: r.status, commit });
  const ok = expect === "any" || (expect === null ? r.status !== 0 : r.status === expect);
  console.log(`${ok ? "ok  " : "FAIL"} ${name} exit=${r.status}`);
  writeFileSync(join(OUT, `${name}.json`), redact(r.stdout));
  if (!ok) console.log(redact(r.stdout).slice(0, 1500), redact(r.stderr).slice(0, 600));
  return r;
}
const localFile = join(fx.dep, "oats-local.yaml");
const setLocalLaunch = launch => { const l = YAML.parse(readFileSync(localFile, "utf8")); l.souls = { ...(l.souls || {}), launch }; writeFileSync(localFile, YAML.stringify(l, { lineWidth: 0 })); };
try {
  const d = ["--dir", fx.dep, "--json"];
  run("version", ["version", "--json"]);
  run("sync", ["sync", "--json"]);
  run("souls", ["souls", ...d]);
  run("inspect-soul-dev", ["inspect", "--dir", fx.dep, "--soul", "dev", "--agents-root", fx.root, "--json"]);
  run("inspect-soul-reviewer", ["inspect", "--dir", fx.dep, "--soul", "reviewer", "--agents-root", fx.root, "--json"]);
  const spawn = extra => ["spawn", "dev", "--dir", fx.dep, "--agents-root", fx.root, "--purpose", "q", ...extra];
  const preview = run("preview-dev", [...spawn([]), "--preview", "--json"]);
  run("preview-dev-flag", [...spawn(["--harness", "pi"]), "--preview", "--json"]);
  const decision = JSON.parse(preview.stdout).result.decision.revision;
  const applied = run("apply-dev", [...spawn(["--expect-decision", decision, "--idempotency-key", "c".repeat(64), "--no-launch"]), "--json"]);
  const home = JSON.parse(applied.stdout).result.home;
  run("inspect-home", ["inspect", "--home", home, "--json"]);
  // The machine now prefers codex for dev: the home's recorded claude launch drifts.
  setLocalLaunch({ reviewer: { harness: "pi" }, dev: { harness: "codex" } });
  run("inspect-home-drift", ["inspect", "--home", home, "--json"]);
  run("readiness-home-drift", ["readiness", "--home", home, "--soul", "dev", "--agents-root", fx.root, "--policy", "--json"], { expect: "any" });
  run("status", ["status", "--dir", fx.dep, "--json"]);
  // codex is uninstalled on this machine: a report lists the problem; a preview refuses.
  unlinkSync(join(stubs, "codex"));
  run("souls-unavailable", ["souls", ...d]);
  run("preview-dev-unavailable", [...spawn([]), "--preview", "--json"], { expect: null });
  writeFileSync(join(OUT, "provenance.json"), JSON.stringify({ capturedBy: "oats-desktop-engineer: launch preferences on the real kernel (0.30, feature launch-preference)",
    kernelTree: `oats main @${commit} (kernel #290 merged)`, fixture: "the kernel's test/helpers/v2-deployment.mjs: souls dev (soul claude/claude-opus-5-5), reviewer (soul codex, local pi), plain (host); later local dev codex; later codex uninstalled; hermetic PATH (inert stubs)",
    script: "capture-launch.mjs", documents: prov }, null, 2) + "\n");
} finally { fx.cleanup(); }
