// A deployment whose member capability declares a trigger source (#669 PR 2b): a real source
// script on disk (bin/source.mjs) that the kernel runs as it runs any capability command. The
// script is told what to answer through $HOME/tsf/control.json (HOME is the fixture's, and reaches
// the source through providerEnv), and leaves a trace there: runs.log (one line per run: the
// request, argv, cwd and the script's version) and env.json (its whole environment).
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v2Deployment } from "./v2-deployment.mjs";

/** The source script; `version` lets a test see which commit of it ran. */
export const sourceScript = (version = 1) => `import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const VERSION = ${version};
const dir = join(process.env.HOME, "tsf");
mkdirSync(dir, { recursive: true });
const req = JSON.parse(readFileSync(0, "utf8"));
appendFileSync(join(dir, "runs.log"), JSON.stringify({ at: Date.now(), version: VERSION, argv: process.argv.slice(2), cwd: process.cwd(), request: req }) + "\\n");
writeFileSync(join(dir, "env.json"), JSON.stringify(process.env));
const control = existsSync(join(dir, "control.json")) ? JSON.parse(readFileSync(join(dir, "control.json"), "utf8")) : {};
const echo = { schemaVersion: req.schemaVersion, phase: req.phase, capability: req.capability, source: req.source };
if (control.sleepMs) await new Promise((r) => setTimeout(r, control.sleepMs));
const mode = control.mode ?? "ok";
if (mode === "exit") process.exit(3);
if (mode === "raw") process.stdout.write(control.raw);
else if (mode === "refuse") process.stdout.write(JSON.stringify({ ...echo, ok: false, error: control.error }) + "\\n");
else process.stdout.write(JSON.stringify({ ...echo, ...(control.echo ?? {}), ok: true, result: control.result ?? { events: [] } }) + "\\n");
`;

/** The source the default capability declares. */
export const HARVEST = Object.freeze({
  command: "review-source", description: "Ready harvest branches, one event per judged head",
  events: ["opened", "updated"],
  parameters: { prefix: { default: "harvest/", pattern: "^[A-Za-z0-9._/-]{1,80}$" }, graph: { required: false } },
  fields: { graph: { pattern: "^[a-z0-9-]{1,40}$" }, branch: { pattern: "^[A-Za-z0-9._/-]{1,200}$" } },
  urlHosts: ["graph.example.org"],
});
export const capabilityManifest = (triggerSources = { "harvest-branches": HARVEST }) => ({ commands: { "review-source": "bin/source.mjs review-source" }, triggerSources });

/** A fake `gh`: logged in (keyring) as kb-bot; `api user` answers that login. */
function fakeGh(dir) {
  const bin = join(dir, "bin"); mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gh"), `#!/bin/sh
case "$1 $2" in
  "auth status") printf '%s\\n' "github.com" "  ✓ Logged in to github.com account kb-bot (keyring)" "  - Active account: true"; exit 0 ;;
  "api user") echo kb-bot; exit 0 ;;
esac
case "$*" in
  *"/pulls"*) echo "[]"; exit 0 ;;
esac
echo "unexpected gh $*" >&2; exit 2
`);
  chmodSync(join(bin, "gh"), 0o755);
  return bin;
}

/** The deployment: soul `reviewer` composes the member capability `acme.graph` (the source above),
 *  soul `plain` composes nothing. Options pass through to v2Deployment (workspace, local, files);
 *  `capabilities` adds or replaces capabilities. */
export function sourceDeployment(t, { manifest = capabilityManifest(), capabilities = {}, souls = {}, ...opts } = {}) {
  const fx = v2Deployment({
    name: "acme",
    souls: { reviewer: { soul: { capabilities: { "acme.graph": { from: "here" } } } }, plain: {}, ...souls },
    capabilities: { "acme.graph": { manifest, files: { "bin/source.mjs": sourceScript() } }, ...capabilities },
    ...opts,
  });
  t.after(fx.cleanup);
  fx.env.PATH = `${fakeGh(join(fx.base, "gh"))}:${fx.env.PATH}`;
  fx.tsf = join(fx.env.HOME, "tsf");
  mkdirSync(fx.tsf, { recursive: true });
  /** What the source answers next. */
  fx.control = (c) => writeFileSync(join(fx.tsf, "control.json"), JSON.stringify(c));
  /** Every run of the source so far. */
  fx.runs = () => (existsSync(join(fx.tsf, "runs.log")) ? readFileSync(join(fx.tsf, "runs.log"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  fx.clearRuns = () => rmSync(join(fx.tsf, "runs.log"), { force: true });
  fx.sourceEnv = () => JSON.parse(readFileSync(join(fx.tsf, "env.json"), "utf8"));
  return fx;
}

const IDENTITY = ["TMUX", "TMUX_PANE", "OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "OATS_AGENT", "OATS_SOUL", "OATS_SOUL_ID", "OATS_ROOT", "OATS_CONTEXT", "OATS_WORKSPACE",
  "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT"];
/** Run `fn` synchronously with the fixture's environment (its isolation and PATH, no ambient
 *  instance identity), plus `extra`: the in-process tick's children see exactly that. */
export function inFixture(fx, fn, extra = {}) {
  const saved = process.env;
  const next = { ...saved };
  for (const k of IDENTITY) delete next[k];
  for (const k of ["HOME", "OATS_HOME_DIR", "OATS_REMOTE_CACHE", "OATS_TMUX_SESSION", "PI_AGENTS_TMUX_SESSION", "TMUX_TMPDIR", "OATS_TEST_LOGIN_SHELL", "PATH"]) if (fx.env[k] !== undefined) next[k] = fx.env[k];
  Object.assign(next, extra);
  process.env = next;
  try { return fn(); } finally { process.env = saved; }
}
