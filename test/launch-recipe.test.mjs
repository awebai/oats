import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describeLaunchCommand, parseLaunchCommand, renderLaunchCommand, renderLaunchRecipe, resolveLaunchSelection } from "../lib/core.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-launch-recipe-")));
test.after(() => rmSync(base, { recursive: true, force: true }));
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
// Fake harness binaries on PATH: spawn resolves them even under --no-launch.
const binDir = join(base, "bin"); mkdirSync(binDir);
for (const n of ["pi", "claude", "codex", "tmux"]) { writeFileSync(join(binDir, n), "#!/bin/sh\nexit 0\n"); chmodSync(join(binDir, n), 0o755); }
const env = (extra = {}) => { const e = { ...process.env, PATH: `${binDir}:${process.env.PATH}`, OATS_HOME_DIR: join(base, "oats-home"), PI_AGENTS_TMUX_SESSION: "oats-launch-recipe-test", ...extra }; for (const k of ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT"]) delete e[k]; return e; };
function oats(args, { cwd = base, extra = {} } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--json"], { encoding: "utf8", env: env(extra), cwd });
  let json; try { json = JSON.parse(r.stdout.trim()); } catch { throw new Error(`no JSON envelope: ${r.stdout}\n${r.stderr}`); }
  return { ...r, json };
}
const home = "/tmp/it's home";
const hooks = (launch, envMap) => ({ launch, env: envMap, contributions: [] });

test("the recipe renderer reproduces the pre-recipe command bytes for every runtime, with and without capability contributions", () => {
  const claude = renderLaunchRecipe({ runtime: "claude", executable: "/opt/homebrew/bin/claude", args: [], env: {}, model: null, yolo: true, hooks: hooks({ claude: "--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace" }, { AWEB_DELIVERY: "session" }) }, { home, instance: "n" });
  assert.equal(claude, `OATS_INSTANCE='n' OATS_INSTANCE_HOME=${shq(home)} PI_AGENT_INSTANCE='n' PI_AGENT_HOME=${shq(home)} AWEB_DELIVERY='session' '/opt/homebrew/bin/claude' --dangerously-skip-permissions --dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace -- "$(cat TASK.md)"`);
  const codex = renderLaunchRecipe({ runtime: "codex", executable: "/opt/homebrew/bin/codex", args: [], env: {}, model: null, yolo: true, hooks: hooks({}, {}) }, { home, instance: "n" });
  // The trust entry names the REAL path of the home (as spawn always did): on macOS /tmp is a link.
  const realHome = join(realpathSync("/tmp"), "it's home");
  assert.equal(codex, `OATS_INSTANCE='n' OATS_INSTANCE_HOME=${shq(home)} PI_AGENT_INSTANCE='n' PI_AGENT_HOME=${shq(home)} '/opt/homebrew/bin/codex' --cd ${shq(home)} --yolo -c ${shq(`projects={${JSON.stringify(realHome)}={trust_level="trusted"}}`)} -- "$(cat TASK.md)"`);
  const pi = renderLaunchRecipe({ runtime: "pi", executable: "/opt/homebrew/bin/pi", args: [], env: {}, model: "m-1", hooks: hooks({}, {}) }, { home, instance: "n" });
  assert.equal(pi, `OATS_INSTANCE='n' OATS_INSTANCE_HOME=${shq(home)} PI_AGENT_INSTANCE='n' PI_AGENT_HOME=${shq(home)} '/opt/homebrew/bin/pi' --no-skills --skill ${shq(join(home, ".agents", "skills"))} --no-context-files --no-prompt-templates --append-system-prompt ${shq(join(home, "AGENTS.md"))} --approve --name 'n' --model 'm-1' '@TASK.md'`);
  for (const c of [claude, codex, pi]) assert.equal(renderLaunchCommand(parseLaunchCommand(c).tokens), c, "still a shape the kernel re-renders");
});

test("configuration args and environment render literally, references by reference; the parser and the description read them back", () => {
  const hostile = `a b, c "q" 'sq' $HOME \`id\` # x`;
  const recipe = { runtime: "claude", executable: "/x/claude wrapper", args: ["--settings", hostile], env: { LIT: "v # w", KEY: { fromEnv: "SRC" } }, model: "claude-opus-5", yolo: false, hooks: hooks({ claude: "--flag" }, { AWEB_DELIVERY: "session" }) };
  const cmd = renderLaunchRecipe(recipe, { home, instance: "n" });
  assert.equal(cmd, `OATS_INSTANCE='n' OATS_INSTANCE_HOME=${shq(home)} PI_AGENT_INSTANCE='n' PI_AGENT_HOME=${shq(home)} AWEB_DELIVERY='session' KEY="$SRC" LIT=${shq("v # w")} '/x/claude wrapper' --model 'claude-opus-5' '--settings' ${shq(hostile)} --flag -- "$(cat TASK.md)"`);
  const parsed = parseLaunchCommand(cmd);
  assert.equal(renderLaunchCommand(parsed.tokens), cmd);
  const ref = parsed.tokens.find((t) => t.kind === "envref"); assert.deepEqual([ref.name, ref.source], ["KEY", "SRC"]);
  assert.deepEqual(parsed.tokens.filter((t) => t.kind === "word" && t.value === hostile).length, 1, "the hostile argument is one literal token");
  const d = describeLaunchCommand(cmd);
  assert.equal(d.executable, "/x/claude wrapper");
  assert.deepEqual(d.argv, ["--model", "claude-opus-5", "--settings", hostile, "--flag", "--", '"$(cat TASK.md)"']);
  assert.deepEqual(d.environment, [{ name: "OATS_INSTANCE", redacted: true }, { name: "OATS_INSTANCE_HOME", redacted: true }, { name: "PI_AGENT_INSTANCE", redacted: true }, { name: "PI_AGENT_HOME", redacted: true }, { name: "AWEB_DELIVERY", redacted: true }, { name: "KEY", fromEnv: "SRC" }, { name: "LIT", redacted: true }]);
  const redacted = renderLaunchRecipe(recipe, { home, instance: "n", redact: true });
  assert.ok(!redacted.includes("v # w") && !redacted.includes("session") && redacted.includes(`KEY="$SRC"`), redacted);
  // pi: configuration args follow the task, like capability args.
  const pi = renderLaunchRecipe({ runtime: "pi", executable: "/p", args: ["--x", "1"], env: {}, model: null, hooks: hooks({ pi: "--hook" }, {}) }, { home, instance: "n" });
  assert.ok(pi.endsWith(`'@TASK.md' '--x' '1' --hook`), pi);
  assert.throws(() => parseLaunchCommand(`KEY="$SRC"x 'claude'`), (e) => e.code === "E_LAUNCH_COMMAND_UNSUPPORTED");
  assert.throws(() => parseLaunchCommand(`KEY="$(id)" 'claude'`), (e) => e.code === "E_LAUNCH_COMMAND_UNSUPPORTED", "only a plain variable reference is a reference");
});

test("selection rules: a named configuration is a unit; models never cross runtimes; frozen recipes keep or drop their configuration as asked", () => {
  const launchConfigs = Object.assign(Object.create(null), {
    fast: { name: "fast", runtime: "codex", executable: "/c", args: ["--a"], env: {}, model: "gpt-5.5", yolo: true, source: "/s" },
    cl: { name: "cl", runtime: "claude", args: [], env: {}, source: "/s" },
  });
  const agent = { runtime: "pi", model: "anthropic/claude-opus-5:high", yolo: false, "launch-config": "cl" };
  let s = resolveLaunchSelection({ launchConfigs, agent, selection: {} });
  assert.deepEqual([s.config.name, s.runtime, s.model, s.modelSource], ["cl", "claude", "claude-opus-5", "soul default"], "the soul's default configuration, the soul model translated for its runtime");
  s = resolveLaunchSelection({ launchConfigs, agent, selection: { launchConfig: "none" } });
  assert.deepEqual([s.config, s.runtime, s.model], [null, "pi", "anthropic/claude-opus-5:high"]);
  s = resolveLaunchSelection({ launchConfigs, agent, selection: { launchConfig: "fast" } });
  assert.deepEqual([s.config.name, s.runtime, s.model, s.modelSource, s.configuredYolo], ["fast", "codex", "gpt-5.5", "launch-config fast", true]);
  assert.throws(() => resolveLaunchSelection({ launchConfigs, agent, selection: { launchConfig: "fast", runtime: "claude" } }), (e) => e.code === "E_LAUNCH_CONFIG_MISMATCH");
  s = resolveLaunchSelection({ launchConfigs, agent, selection: { launchConfig: "fast", runtime: "codex", model: "openai/gpt-5.5-mini" } });
  assert.deepEqual([s.runtime, s.model, s.modelSource], ["codex", "gpt-5.5-mini", "explicit"], "same runtime override is fine; an explicit model wins over the configured one");
  assert.throws(() => resolveLaunchSelection({ launchConfigs, agent, selection: { launchConfig: "nope" } }), (e) => e.code === "E_LAUNCH_CONFIG_UNKNOWN");
  assert.throws(() => resolveLaunchSelection({ launchConfigs, agent, selection: { launchConfig: "fast", model: "anthropic/claude-x" } }), (e) => e.code === "E_MODEL_UNKNOWN", "a model with no codex entry is refused, not passed through");
  // An existing home (frozen recipe): keep as recorded; --runtime alone leaves the configuration and the old model behind.
  const frozen = { runtime: "codex", launchConfig: "fast", model: "gpt-5.5", executable: "/c", args: ["--a"] };
  s = resolveLaunchSelection({ launchConfigs, agent, frozen, selection: {} });
  assert.deepEqual([s.config.name, s.runtime, s.model, s.modelSource], ["fast", "codex", "gpt-5.5", "launch-config fast"]);
  s = resolveLaunchSelection({ launchConfigs, agent, frozen, selection: { runtime: "claude" } });
  assert.deepEqual([s.config, s.runtime, s.model, s.modelSource], [null, "claude", "", "native default (runtime changed)"], "no executable, args or model carried across the runtime change");
  s = resolveLaunchSelection({ launchConfigs, agent, frozen: { runtime: "claude", launchConfig: null, model: "claude-sonnet-5" }, selection: { yolo: true } });
  assert.deepEqual([s.runtime, s.model, s.modelSource], ["claude", "claude-sonnet-5", "recorded"], "same runtime keeps the recorded model");
  assert.throws(() => resolveLaunchSelection({ launchConfigs, agent, frozen: { runtime: "codex", launchConfig: "gone" }, selection: {} }), (e) => e.code === "E_LAUNCH_CONFIG_UNKNOWN" && /any more/.test(e.message));
});

test("spawn records the recipe: a configuration's executable, args and references land in instance.json and the command; missing references, unknown or mismatched configurations refuse before a home exists", () => {
  const repo = join(base, "repo"); mkdirSync(join(repo, "agents", "dev", "soul"), { recursive: true });
  spawnSync("git", ["init", "-q", repo]); spawnSync("git", ["-C", repo, "commit", "-q", "--allow-empty", "-m", "init"], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e.invalid" } });
  write(join(repo, "agents", "dev", "soul", "soul.yaml"), "name: dev\nrepo: .\nwork: checkout\nruntime: pi\nmodel: anthropic/claude-opus-5\n");
  write(join(repo, "agents", "dev", "soul", "AGENTS.md"), "# dev\n");
  const wrapper = join(repo, "tools", "claude-wrapper.sh"); write(wrapper, "#!/bin/sh\nexit 0\n"); chmodSync(wrapper, 0o755);
  write(join(repo, "oats-config.yaml"), "name: r\ncapabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n");
  write(join(base, "personal.json"), JSON.stringify({ runtime: "claude", executable: "./tools/claude-wrapper.sh", args: ["--settings", "/abs/settings.json", "a b"], env: { LIT: "plain", KEY: { fromEnv: "LAUNCH_TEST_SRC" } }, model: "claude-opus-5", yolo: true }));
  let r = oats(["launch-config", "set", "personal", "--file", join(base, "personal.json"), "--dir", repo]);
  assert.equal(r.json.ok, true, r.stdout);
  const instancesDir = join(repo, "agents", "dev", "instances");
  // Refusals happen before a home exists.
  r = oats(["spawn", "dev", "--purpose", "p1", "--launch-config", "personal", "--no-launch", "--dir", repo]);
  assert.equal(r.json.error?.code, "E_LAUNCH_ENV_MISSING", r.stdout); assert.equal(existsSync(join(instancesDir, "dev-p1")), false);
  r = oats(["spawn", "dev", "--purpose", "p1", "--launch-config", "nope", "--no-launch", "--dir", repo]);
  assert.equal(r.json.error?.code, "E_LAUNCH_CONFIG_UNKNOWN", r.stdout);
  r = oats(["spawn", "dev", "--purpose", "p1", "--launch-config", "personal", "--runtime", "codex", "--no-launch", "--dir", repo], { extra: { LAUNCH_TEST_SRC: "s3cret" } });
  assert.equal(r.json.error?.code, "E_LAUNCH_CONFIG_MISMATCH", r.stdout); assert.equal(existsSync(join(instancesDir, "dev-p1")), false);
  // The spawn: recipe recorded, command carries the args literally and the reference by reference, never the value.
  r = oats(["spawn", "dev", "--purpose", "p1", "--launch-config", "personal", "--no-launch", "--dir", repo], { extra: { LAUNCH_TEST_SRC: "s3cret" } });
  assert.equal(r.json.ok, true, r.stdout);
  const meta = JSON.parse(readFileSync(join(instancesDir, "dev-p1", "instance.json"), "utf8"));
  assert.equal(meta.runtime, "claude"); assert.equal(meta.model, "claude-opus-5"); assert.equal(meta.yolo, true);
  assert.deepEqual([meta.launch.version, meta.launch.launchConfig, meta.launch.launchConfigSource, meta.launch.executable, meta.launch.executableDeclared, meta.launch.args, meta.launch.env, meta.launch.model, meta.launch.yolo, meta.launch.prompt], [1, "personal", repo, wrapper, "./tools/claude-wrapper.sh", ["--settings", "/abs/settings.json", "a b"], { KEY: { fromEnv: "LAUNCH_TEST_SRC" }, LIT: "plain" }, "claude-opus-5", true, { kind: "task-file", file: "TASK.md" }]);
  assert.ok(meta.command.includes(`KEY="$LAUNCH_TEST_SRC"`) && meta.command.includes(`'--settings' '/abs/settings.json' 'a b'`) && meta.command.includes(shq(wrapper)), meta.command);
  assert.ok(!JSON.stringify(meta).includes("s3cret") && !r.stdout.includes("s3cret"), "the referenced value is nowhere");
  assert.deepEqual(Object.keys(meta.launch.hooks).sort(), ["contributions", "env", "launch"]);
  // Without a configuration: the soul's runtime and model, no configuration fields, same command shape as before recipes.
  r = oats(["spawn", "dev", "--purpose", "p2", "--no-launch", "--dir", repo]);
  assert.equal(r.json.ok, true, r.stdout);
  const plain = JSON.parse(readFileSync(join(instancesDir, "dev-p2", "instance.json"), "utf8"));
  assert.deepEqual([plain.launch.runtime, plain.launch.launchConfig, plain.launch.args, plain.launch.env, plain.launch.model], ["pi", null, [], {}, "anthropic/claude-opus-5"]);
  assert.ok(plain.command.endsWith(`--approve --name 'dev-p2' --model 'anthropic/claude-opus-5' '@TASK.md'`), plain.command);
  // Preview of the existing home: frozen as recorded; a switch to codex renders codex defaults with no wrapper or args; a disagreeing --runtime is refused.
  const h1 = join(instancesDir, "dev-p1");
  r = oats(["launch-config", "preview", "--home", h1], { extra: { LAUNCH_TEST_SRC: "s3cret" } });
  assert.equal(r.json.ok, true, r.stdout);
  let v = r.json.result;
  assert.deepEqual([v.selection.source, v.runtime, v.launchConfig, v.executable.path, v.model, v.yolo, v.ok], ["frozen", "claude", "personal", wrapper, "claude-opus-5", true, true]);
  assert.ok(v.command.includes("'<redacted>'") && !v.command.includes("plain") && v.command.includes(`KEY="$LAUNCH_TEST_SRC"`), v.command);
  assert.ok(v.argv.includes("a b") && !JSON.stringify(v).includes("s3cret"));
  r = oats(["launch-config", "preview", "--home", h1, "--runtime", "codex"]);
  v = r.json.result;
  assert.deepEqual([v.selection.source, v.runtime, v.launchConfig, v.executable.path, v.model, v.modelSource, v.argv.includes("a b")], ["config", "codex", null, join(binDir, "codex"), null, "native default (runtime changed)", false]);
  assert.equal(v.preflight.find((c) => c.check === "environment").ok, true, "no references left once the configuration is dropped");
  r = oats(["launch-config", "preview", "--home", h1, "--launch-config", "personal", "--runtime", "codex"]);
  assert.equal(r.json.error?.code, "E_LAUNCH_CONFIG_MISMATCH");
  r = oats(["launch-config", "preview", "--home", h1]);
  assert.equal(r.json.result.ok, false); assert.match(r.json.result.preflight.find((c) => c.check === "environment").detail, /LAUNCH_TEST_SRC/, "a missing reference is a failed preflight on this host");
  // Preview for a soul (a new instance), and the soul default set through soul set.
  r = oats(["soul", "set", "dev", "--launch-config", "personal", "--dir", repo]);
  assert.equal(r.json.ok, true, r.stdout); assert.equal(r.json.result.before.launchConfig, null);
  assert.match(readFileSync(join(repo, "agents", "dev", "soul", "soul.yaml"), "utf8"), /^launch-config: personal$/m);
  r = oats(["launch-config", "preview", "--soul", "dev", "--dir", repo], { extra: { LAUNCH_TEST_SRC: "s3cret" } });
  v = r.json.result;
  assert.deepEqual([v.selection.source, v.runtime, v.launchConfig, v.executable.path, v.ok, v.hooks.pending], ["config", "claude", "personal", wrapper, true, true]);
  r = oats(["launch-config", "preview", "--soul", "dev", "--dir", repo, "--launch-config", "none"]);
  assert.deepEqual([r.json.result.runtime, r.json.result.launchConfig, r.json.result.model], ["pi", null, "anthropic/claude-opus-5"]);
  r = oats(["spawn", "dev", "--purpose", "p3", "--no-launch", "--dir", repo], { extra: { LAUNCH_TEST_SRC: "s3cret" } });
  assert.equal(r.json.ok, true, r.stdout); assert.equal(JSON.parse(readFileSync(join(instancesDir, "dev-p3", "instance.json"), "utf8")).launch.launchConfig, "personal", "the soul default applies to new instances");
  r = oats(["soul", "set", "dev", "--no-launch-config", "--dir", repo]);
  assert.equal(r.json.ok, true); assert.doesNotMatch(readFileSync(join(repo, "agents", "dev", "soul", "soul.yaml"), "utf8"), /launch-config/);
  // A legacy home (no recipe): described as is; a selection is refused until conversion.
  const legacy = join(instancesDir, "dev-legacy"); mkdirSync(legacy, { recursive: true });
  write(join(legacy, "instance.json"), JSON.stringify({ agent: "dev", instance: "dev-legacy", home: legacy, repo, runtime: "claude", model: "claude-x", launched: false, command: `OATS_INSTANCE='dev-legacy' OATS_INSTANCE_HOME=${shq(legacy)} AWEB_DELIVERY='session' '/opt/homebrew/bin/claude' --model 'claude-x' -- "$(cat TASK.md)"` }));
  r = oats(["launch-config", "preview", "--home", legacy]);
  v = r.json.result; assert.deepEqual([v.selection.source, v.executable.path, v.model, v.argv], ["frozen-command", "/opt/homebrew/bin/claude", "claude-x", ["--model", "claude-x", "--", '"$(cat TASK.md)"']]);
  assert.ok(v.command.includes("AWEB_DELIVERY='<redacted>'") && !v.command.includes("'session'"));
  r = oats(["launch-config", "preview", "--home", legacy, "--runtime", "codex"]);
  assert.equal(r.json.error?.code, "E_LAUNCH_LEGACY");
});
