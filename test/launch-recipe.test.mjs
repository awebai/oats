import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describeLaunchCommand, launchEnvRefs, parseLaunchCommand, planLaunch, redactLaunchCommand, renderLaunchCommand, renderLaunchRecipe, resolveLaunchSelection, validateLaunchConfig } from "../lib/core.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-launch-recipe-")));
test.after(() => rmSync(base, { recursive: true, force: true }));
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
// Fake harness binaries on PATH: spawn resolves them even under --no-launch.
const binDir = join(base, "bin"); mkdirSync(binDir);
for (const n of ["pi", "claude", "codex", "tmux"]) { writeFileSync(join(binDir, n), "#!/bin/sh\nexit 0\n"); chmodSync(join(binDir, n), 0o755); }
// The in-process planner resolves a runtime's default binary on THIS process's PATH (`which`), not on the
// environment handed to spawned CLIs: the fakes go first here too, so a host without the real harnesses
// (the hosted runner) plans exactly like one with them.
process.env.PATH = `${binDir}:${process.env.PATH}`;
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
  // A reference never names its source in the command: the pane receives the value under a kernel-owned alias.
  assert.equal(cmd, `OATS_INSTANCE='n' OATS_INSTANCE_HOME=${shq(home)} PI_AGENT_INSTANCE='n' PI_AGENT_HOME=${shq(home)} AWEB_DELIVERY='session' KEY="$OATS_LAUNCH_REF_KEY" LIT=${shq("v # w")} '/x/claude wrapper' --model 'claude-opus-5' '--settings' ${shq(hostile)} --flag -- "$(cat TASK.md)"`);
  const parsed = parseLaunchCommand(cmd);
  assert.equal(renderLaunchCommand(parsed.tokens), cmd);
  const ref = parsed.tokens.find((t) => t.kind === "envref"); assert.deepEqual([ref.name, ref.source], ["KEY", "OATS_LAUNCH_REF_KEY"]);
  assert.deepEqual(launchEnvRefs(recipe, { SRC: "s3cret" }), [{ name: "OATS_LAUNCH_REF_KEY", value: "s3cret", target: "KEY", source: "SRC" }]);
  // The shell-dependent shadowing the lead reproduced: a literal A beside a reference to A. Under zsh the old
  // NAME="$A" form saw the literal; the alias form cannot, because nothing in the prefix can assign the alias.
  const shadow = { runtime: "claude", executable: "/usr/bin/printenv", args: [], env: { A: "override", B: { fromEnv: "A" } }, model: null, hooks: hooks({}, { A: "hook" }) };
  const prefix = renderLaunchRecipe(shadow, { home, instance: "n" }).split(" '/usr/bin/printenv'")[0];
  // Every shell the host installs is exercised; /bin/sh is required (the pane command runs under it), the others
  // (zsh on macOS, bash on Linux runners) are covered where present rather than assumed.
  const shells = ["/bin/zsh", "/bin/bash", "/bin/sh"].filter((sh) => existsSync(sh));
  assert.ok(shells.includes("/bin/sh"), "/bin/sh is present on every supported host");
  for (const sh of shells) {
    const out = spawnSync(sh, ["-c", `${prefix} /usr/bin/printenv B`], { encoding: "utf8", env: { A: "original", PATH: process.env.PATH, ...Object.fromEntries(launchEnvRefs(shadow, { A: "original" }).map((r) => [r.name, r.value])) } });
    assert.equal(out.error, undefined, `${sh}: ran`);
    assert.equal(out.stdout.trim(), "original", `${sh}: B carries the SOURCE value, not the literal beside it`);
  }
  assert.deepEqual(parsed.tokens.filter((t) => t.kind === "word" && t.value === hostile).length, 1, "the hostile argument is one literal token");
  const d = describeLaunchCommand(cmd);
  assert.equal(d.executable, "/x/claude wrapper");
  assert.deepEqual(d.argv, ["--model", "claude-opus-5", "--settings", hostile, "--flag", "--", '"$(cat TASK.md)"']);
  assert.deepEqual(d.environment, [{ name: "OATS_INSTANCE", redacted: true }, { name: "OATS_INSTANCE_HOME", redacted: true }, { name: "PI_AGENT_INSTANCE", redacted: true }, { name: "PI_AGENT_HOME", redacted: true }, { name: "AWEB_DELIVERY", redacted: true }, { name: "KEY", reference: true }, { name: "LIT", redacted: true }]);
  const redacted = renderLaunchRecipe(recipe, { home, instance: "n", redact: true });
  assert.ok(!redacted.includes("v # w") && !redacted.includes("session") && redacted.includes(`KEY="$OATS_LAUNCH_REF_KEY"`), redacted);
  assert.equal(redactLaunchCommand(cmd), redacted, "the public rendering of a persisted command is the redacted one");
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
  assert.deepEqual([s.config.name, s.runtime, s.model, s.modelSource], ["cl", "claude", "", "native default (runtime differs from the soul's)"], "the soul's default configuration runs another runtime: its pi model preference is not carried");
  s = resolveLaunchSelection({ launchConfigs, agent: { ...agent, runtime: "claude" }, selection: {} });
  assert.deepEqual([s.config.name, s.runtime, s.model, s.modelSource], ["cl", "claude", "claude-opus-5", "soul default"], "same runtime as the soul: the soul model, translated");
  s = resolveLaunchSelection({ launchConfigs, agent, selection: { launchConfig: "none" } });
  assert.deepEqual([s.config, s.runtime, s.model], [null, "pi", "anthropic/claude-opus-5:high"]);
  s = resolveLaunchSelection({ launchConfigs, agent, selection: { launchConfig: "fast" } });
  assert.deepEqual([s.config.name, s.runtime, s.model, s.modelSource, s.configuredYolo], ["fast", "codex", "gpt-5.5", "launch-config fast", true]);
  s = resolveLaunchSelection({ launchConfigs, agent: { runtime: "claude", model: "sonnet" }, selection: { launchConfig: "cl2" === "cl2" ? "fast" : "" } });
  assert.deepEqual([s.runtime, s.model, s.modelSource], ["codex", "gpt-5.5", "launch-config fast"]);
  s = resolveLaunchSelection({ launchConfigs: Object.assign(Object.create(null), { p: { name: "p", runtime: "codex", args: [], env: {}, source: "/s" } }), agent: { runtime: "claude", model: "sonnet" }, selection: { launchConfig: "p" } });
  assert.deepEqual([s.runtime, s.model, s.modelSource], ["codex", "", "native default (runtime differs from the soul's)"], "a soul's bare alias is not passed to another runtime");
  s = resolveLaunchSelection({ launchConfigs, agent: { runtime: "claude", model: "sonnet" }, selection: { runtime: "codex" } });
  assert.deepEqual([s.runtime, s.model], ["codex", ""]);
  assert.throws(() => resolveLaunchSelection({ launchConfigs, agent, selection: { launchConfig: "fast", runtime: "claude" } }), (e) => e.code === "E_LAUNCH_CONFIG_MISMATCH");
  s = resolveLaunchSelection({ launchConfigs, agent, selection: { launchConfig: "fast", runtime: "codex", model: "openai/gpt-5.5-mini" } });
  assert.deepEqual([s.runtime, s.model, s.modelSource], ["codex", "gpt-5.5-mini", "explicit"], "same runtime override is fine; an explicit model wins over the configured one");
  assert.throws(() => resolveLaunchSelection({ launchConfigs, agent, selection: { launchConfig: "nope" } }), (e) => e.code === "E_LAUNCH_CONFIG_UNKNOWN");
  assert.throws(() => resolveLaunchSelection({ launchConfigs, agent, selection: { launchConfig: "fast", model: "anthropic/claude-x" } }), (e) => e.code === "E_MODEL_UNKNOWN", "a model with no codex entry is refused, not passed through");
  // An existing home (frozen recipe): an ordinary start runs what was recorded, even if the scope's definition
  // changed or vanished; only an explicit name applies the current one; --runtime alone leaves it all behind.
  const frozen = { runtime: "codex", launchConfig: "fast", launchConfigSource: "/s", model: "gpt-5.5", executable: "/old/wrapper", executableDeclared: "./old/wrapper", args: ["--old"], env: { K: { fromEnv: "S" } } };
  s = resolveLaunchSelection({ launchConfigs: Object.create(null), agent, frozen, selection: {} });
  assert.deepEqual([s.config.name, s.config.frozen, s.config.executablePath, s.config.args, s.config.env, s.runtime, s.model, s.modelSource], ["fast", true, "/old/wrapper", ["--old"], { K: { fromEnv: "S" } }, "codex", "gpt-5.5", "recorded"], "the recorded configuration, with a scope that no longer declares it");
  s = resolveLaunchSelection({ launchConfigs: Object.create(null), agent, frozen, selection: { model: "openai/gpt-5.5-mini", yolo: false } });
  assert.deepEqual([s.config.frozen, s.model, s.modelSource], [true, "gpt-5.5-mini", "explicit"], "model-only or yolo-only keeps the recorded configuration");
  assert.throws(() => resolveLaunchSelection({ launchConfigs: Object.create(null), agent, frozen, selection: { launchConfig: "fast" } }), (e) => e.code === "E_LAUNCH_CONFIG_UNKNOWN" && /any more/.test(e.message), "an explicit name wants the current definition");
  s = resolveLaunchSelection({ launchConfigs, agent, frozen, selection: { launchConfig: "fast" } });
  assert.deepEqual([s.config.frozen, s.config.executable, s.config.args], [undefined, "/c", ["--a"]], "the current definition applies when named");
  s = resolveLaunchSelection({ launchConfigs, agent, frozen, selection: { runtime: "claude" } });
  assert.deepEqual([s.config, s.runtime, s.model, s.modelSource], [null, "claude", "", "native default (runtime changed)"], "no executable, args or model carried across the runtime change");
  s = resolveLaunchSelection({ launchConfigs, agent, frozen: { runtime: "claude", launchConfig: null, model: "claude-sonnet-5" }, selection: { yolo: true } });
  assert.deepEqual([s.runtime, s.model, s.modelSource], ["claude", "claude-sonnet-5", "recorded"], "same runtime keeps the recorded model");
  assert.deepEqual(resolveLaunchSelection({ launchConfigs, agent, frozen: { runtime: "codex", launchConfig: "gone", executable: "/g" }, selection: {} }).config.name, "gone", "a recorded configuration the scope forgot still starts as recorded");
  for (const [name, entry, why] of [["none", { runtime: "pi" }, /cannot be named none/], ["p", { runtime: "codex", env: { OATS_INSTANCE_HOME: "/wrong" } }, /set by the kernel/], ["p", { runtime: "codex", env: { PI_AGENTS_ROOT: "/x" } }, /set by the kernel/], ["p", { runtime: "codex", env: { OATS_LAUNCH_REF_X: "1" } }, /set by the kernel/], ["p", { runtime: "pi", env: { A: { fromEnv: "OATS_LAUNCH_REF_A" } } }, /alias/]]) {
    assert.throws(() => validateLaunchConfig(name, entry, "f"), (e) => e.code === "E_LAUNCH_CONFIG_INVALID" && why.test(e.message), `${name}: ${why}`);
  }
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
  assert.ok(meta.command.includes(`KEY="$OATS_LAUNCH_REF_KEY"`) && !meta.command.includes("LAUNCH_TEST_SRC") && meta.command.includes(`'--settings' '/abs/settings.json' 'a b'`) && meta.command.includes(shq(wrapper)), meta.command);
  assert.ok(!JSON.stringify(meta).includes("s3cret") && !r.stdout.includes("s3cret"), "the referenced value is nowhere");
  assert.deepEqual(Object.keys(meta.launch.hooks).sort(), ["contributions", "env", "launch"]);
  // The spawn answer and the roster are public: recipe env and command redacted, the file keeps the literal.
  assert.deepEqual(r.json.result.launch?.env, { KEY: { fromEnv: "LAUNCH_TEST_SRC" }, LIT: { redacted: true } }, JSON.stringify(r.json.result).slice(0, 400));
  assert.ok(!JSON.stringify(r.json).includes("'plain'") && !JSON.stringify(r.json).includes('"plain"'), "no literal value in the spawn answer");
  assert.equal(meta.launch.env.LIT, "plain");
  const st = oats(["status", "--dir", repo]);
  const row = st.json.result ? (st.json.result.agents || []).flatMap((a) => a.instances || []).find((i) => i.instance === "dev-p1") : null;
  if (row) { assert.deepEqual(row.launch.env.LIT, { redacted: true }); assert.ok(row.command.includes("LIT='<redacted>'") && !row.command.includes("'plain'"), row.command); }
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
  assert.ok(v.command.includes("'<redacted>'") && !v.command.includes("plain") && v.command.includes(`KEY="$OATS_LAUNCH_REF_KEY"`), v.command);
  assert.ok(v.argv.includes("a b") && !JSON.stringify(v).includes("s3cret"));
  assert.deepEqual(v.environment.find((e) => e.name === "KEY"), { name: "KEY", fromEnv: "LAUNCH_TEST_SRC" });
  // The scope's definition changes underneath: an ordinary start/preview still runs what was recorded; naming it applies the new one.
  write(join(base, "personal2.json"), JSON.stringify({ runtime: "claude", args: ["--changed"], model: "claude-sonnet-5" }));
  assert.equal(oats(["launch-config", "set", "personal", "--file", join(base, "personal2.json"), "--dir", repo]).json.ok, true);
  v = oats(["launch-config", "preview", "--home", h1], { extra: { LAUNCH_TEST_SRC: "s3cret" } }).json.result;
  assert.deepEqual([v.selection.source, v.executable.path, v.argv.includes("a b"), v.argv.includes("--changed"), v.model], ["frozen", wrapper, true, false, "claude-opus-5"], "recorded wrapper, args and model");
  v = oats(["launch-config", "preview", "--home", h1, "--launch-config", "personal"]).json.result;
  assert.deepEqual([v.selection.source, v.executable.path, v.argv.includes("--changed"), v.model], ["config", join(binDir, "claude"), true, "claude-sonnet-5"], "the current definition when named");
  assert.equal(oats(["launch-config", "remove", "personal", "--dir", repo]).json.ok, true);
  v = oats(["launch-config", "preview", "--home", h1], { extra: { LAUNCH_TEST_SRC: "s3cret" } }).json.result;
  assert.deepEqual([v.selection.source, v.launchConfig, v.executable.path, v.ok], ["frozen", "personal", wrapper, true], "still starts as recorded after the scope forgot it");
  assert.equal(oats(["launch-config", "preview", "--home", h1, "--launch-config", "personal"]).json.error?.code, "E_LAUNCH_CONFIG_UNKNOWN");
  assert.equal(oats(["launch-config", "set", "personal", "--file", join(base, "personal.json"), "--dir", repo]).json.ok, true);
  // A configuration may not override environment a capability owns: a home whose hooks set AWEB_DELIVERY.
  const conflictHome = join(instancesDir, "dev-conflict"); mkdirSync(conflictHome, { recursive: true });
  const conflictMeta = { ...meta, instance: "dev-conflict", home: conflictHome, launch: { ...meta.launch, launchConfig: null, launchConfigSource: null, args: [], env: {}, hooks: { launch: {}, env: { AWEB_DELIVERY: "session" }, contributions: [{ capability: "oats.aweb", layer: "messaging", level: repo, settings: {}, trust: { trusted: true, integrity: null }, launch: {}, env: ["AWEB_DELIVERY"] }] } } };
  write(join(conflictHome, "instance.json"), JSON.stringify(conflictMeta));
  write(join(base, "clash.json"), JSON.stringify({ runtime: "claude", env: { AWEB_DELIVERY: "channel" } }));
  assert.equal(oats(["launch-config", "set", "clash", "--file", join(base, "clash.json"), "--dir", repo]).json.ok, true);
  v = oats(["launch-config", "preview", "--home", conflictHome, "--launch-config", "clash"]).json.result;
  assert.equal(v.ok, false); assert.match(v.preflight.find((c) => c.check === "environment").detail, /AWEB_DELIVERY \(set by oats.aweb\) cannot be overridden/);
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
  r = oats(["launch-config", "preview", "--soul", "dev", "--dir", repo, "--launch-config", "none", "--runtime", "codex"]);
  assert.deepEqual([r.json.result.runtime, r.json.result.model, r.json.result.modelSource], ["codex", null, "native default (runtime differs from the soul's)"]);
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
  // Under a selection the same narrow conversion session restart uses: the recorded env is attributed and carried, the runtime switches, nothing is written.
  const legacyBytes = readFileSync(join(legacy, "instance.json"), "utf8");
  r = oats(["launch-config", "preview", "--home", legacy, "--runtime", "codex"]);
  assert.equal(r.json.ok, true, r.stdout);
  v = r.json.result;
  assert.deepEqual([v.selection.source, v.runtime, v.model, v.modelSource, v.launchConfig, v.ok], ["config", "codex", null, "native default (runtime changed)", null, true]);
  assert.ok(v.executable.path.endsWith("/codex") && v.argv.includes("--cd") && !v.argv.includes("--dangerously-skip-permissions"), JSON.stringify(v.argv));
  assert.deepEqual(v.environment.find((e) => e.name === "AWEB_DELIVERY"), { name: "AWEB_DELIVERY", redacted: true }, "the session-delivery environment is carried, redacted");
  assert.ok(v.command.includes("AWEB_DELIVERY='<redacted>'") && !v.command.includes("'session'"), v.command);
  assert.equal(readFileSync(join(legacy, "instance.json"), "utf8"), legacyBytes, "preview writes nothing");
  // A legacy home carrying arguments the kernel cannot attribute: the preview lists the refusal instead of pretending.
  const channel = join(instancesDir, "dev-channel"); mkdirSync(channel, { recursive: true });
  write(join(channel, "instance.json"), JSON.stringify({ agent: "dev", instance: "dev-channel", home: channel, repo, runtime: "claude", launched: false, command: `OATS_INSTANCE='dev-channel' OATS_INSTANCE_HOME=${shq(channel)} '/opt/homebrew/bin/claude' --dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace -- "$(cat TASK.md)"` }));
  r = oats(["launch-config", "preview", "--home", channel, "--runtime", "codex"]);
  assert.equal(r.json.ok, true, r.stdout);
  assert.equal(r.json.result.ok, false);
  assert.match(r.json.result.preflight.find((c) => c.check === "capabilities").detail, /dangerously-load-development-channels.*launch hook/);
});

test("an UNNAMED frozen recipe starts exactly as recorded: its wrapper, args and references, whatever the scope says now; an unknown recipe shape is refused before anything", () => {
  const home = join(base, "unnamed-home"); mkdirSync(home, { recursive: true });
  const meta = { instance: "u", agent: "dev", home, runtime: "claude", launch: { version: 1, runtime: "claude", launchConfig: null, launchConfigSource: null, executable: "/usr/bin/true", executableDeclared: null, executableResolvedFrom: "oats-claude-config", args: ["--saved"], env: { KEY: { fromEnv: "MISSING_REVIEW_ENV" } }, hooks: { launch: {}, env: {}, contributions: [] }, model: null, yolo: false, prompt: { kind: "task-file", file: "TASK.md" } } };
  const plan = planLaunch({ home, meta, contextDir: base, agentLike: { runtime: "claude" }, selection: {}, launchConfigs: Object.create(null), env: {}, preview: true });
  assert.equal(plan.selectionSource, "frozen");
  assert.deepEqual([plan.recipe.executable, plan.recipe.args, plan.recipe.env, plan.recipe.yolo, plan.executable.resolvedFrom], ["/usr/bin/true", ["--saved"], { KEY: { fromEnv: "MISSING_REVIEW_ENV" } }, false, "oats-claude-config"], "the recorded wrapper, args and references, not the scope's current default");
  assert.equal(plan.preflight.find((c) => c.check === "environment").ok, false, "the recorded reference is checked");
  assert.ok(plan.command.includes("'/usr/bin/true' '--saved'") && plan.command.includes(`KEY="$OATS_LAUNCH_REF_KEY"`), plan.command);
  const yoloOnly = planLaunch({ home, meta, contextDir: base, agentLike: { runtime: "claude" }, selection: { yolo: true }, launchConfigs: Object.create(null), env: { MISSING_REVIEW_ENV: "v" }, preview: true });
  assert.deepEqual([yoloOnly.selectionSource, yoloOnly.recipe.executable, yoloOnly.recipe.yolo, yoloOnly.ok], ["frozen", "/usr/bin/true", true, true], "a yolo-only override keeps everything else recorded");
  const switched = planLaunch({ home, meta, contextDir: base, agentLike: { runtime: "claude" }, selection: { runtime: "codex" }, launchConfigs: Object.create(null), env: {}, preview: true });
  assert.deepEqual([switched.selectionSource, switched.recipe.executable.endsWith("/codex"), switched.recipe.args, switched.recipe.env], ["config", true, [], {}], "--runtime alone deliberately leaves the recorded wrapper behind (the runtime's own binary, resolved in this process's PATH)");
  for (const broken of [{ ...meta.launch, version: 2 }, { ...meta.launch, runtime: "bash" }, { ...meta.launch, args: "x" }, { ...meta.launch, hooks: undefined }]) {
    assert.throws(() => planLaunch({ home, meta: { ...meta, launch: broken }, contextDir: base, agentLike: { runtime: "claude" }, selection: {}, launchConfigs: Object.create(null), env: {}, preview: true }), (e) => e.code === "E_LAUNCH_RECIPE_UNSUPPORTED", JSON.stringify(broken).slice(0, 80));
  }
});
