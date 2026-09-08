import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { launchConfigsOf, parseYamlNested, validateLaunchConfig } from "../lib/core.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-launch-config-")));
test.after(() => rmSync(base, { recursive: true, force: true }));
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
const env = () => { const e = { ...process.env, OATS_HOME_DIR: join(base, "oats-home") }; for (const k of ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT"]) delete e[k]; return e; };
function oats(args, cwd = base) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--json"], { encoding: "utf8", env: env(), cwd });
  let json; try { json = JSON.parse(r.stdout.trim()); } catch { throw new Error(`no JSON envelope: ${r.stdout}\n${r.stderr}`); }
  return { ...r, json };
}
// A hostile argument: spaces, a comma, quotes, expansions, a comment marker.
const HOSTILE = "a b, c \"q\" 'sq' $HOME `id` # not a comment \\ end";

test("the YAML subset reads block sequences and quoted scalars with their escapes; a comment never cuts a quoted value", () => {
  const cfg = parseYamlNested(`name: x\nlaunch-configs:\n  fast:\n    runtime: claude\n    executable: "/opt/x/claude wrapper"\n    args:\n      - "--flag"\n      - ${JSON.stringify(HOSTILE)}\n      -\n    env:\n      A: "lit # x"\n      B:\n        fromEnv: SRC\n    model: 'it''s'\n    yolo: true\n  plain:\n    runtime: pi\ncapabilities:\n  layers:\n    knowledge: none\n`);
  assert.deepEqual(cfg["launch-configs"].fast, { runtime: "claude", executable: "/opt/x/claude wrapper", args: ["--flag", HOSTILE], env: { A: "lit # x", B: { fromEnv: "SRC" } }, model: "it's", yolo: true });
  assert.deepEqual(cfg["launch-configs"].plain, { runtime: "pi" });
  assert.deepEqual(cfg.capabilities, { layers: { knowledge: "none" } }, "the rest of the document is unaffected");
  assert.deepEqual(parseYamlNested("a: [x, y]\nb: {k: v}\nc: plain # comment\n"), { a: ["x", "y"], b: { k: "v" }, c: "plain" }, "inline forms and trailing comments as before");
});

test("validation names the fault; the chain merge takes the closest whole entry and records what it shadows", () => {
  const ok = { runtime: "pi", args: ["x"], env: { A: "1", B: { fromEnv: "S" } } };
  assert.equal(validateLaunchConfig("n1", ok), ok);
  for (const [name, entry, why] of [
    ["bad name!", { runtime: "pi" }, /invalid name/],
    ["n", { runtime: "bash" }, /needs runtime/],
    ["n", { runtime: "pi", extra: 1 }, /unsupported key "extra"/],
    ["n", { runtime: "pi", args: "x" }, /args must be a list/],
    ["n", { runtime: "pi", env: { "1A": "x" } }, /not a valid environment variable name/],
    ["n", { runtime: "pi", env: { A: { fromEnv: "bad-name" } } }, /string or \{fromEnv: NAME\}/],
    ["n", { runtime: "pi", env: { A: { fromEnv: "S", extra: 1 } } }, /string or \{fromEnv: NAME\}/],
    ["n", { runtime: "pi", yolo: "yes" }, /yolo must be true or false/],
    ["n", { runtime: "pi", executable: "" }, /executable must be non-empty/],
  ]) assert.throws(() => validateLaunchConfig(name, entry, "f"), (e) => e.code === "E_LAUNCH_CONFIG_INVALID" && why.test(e.message), `${name}: ${why}`);
  const chain = [
    { _level: "/team/member", "launch-configs": { fast: { runtime: "claude", model: "m-member" } } },
    { _level: "/team", "launch-configs": { fast: { runtime: "pi", args: ["--x"], env: { A: "1" } }, slow: { runtime: "codex" } } },
    { _level: "/", "launch-configs": { fast: { runtime: "codex" } } },
  ];
  const merged = launchConfigsOf(chain);
  assert.deepEqual(merged.fast, { name: "fast", runtime: "claude", args: [], env: {}, model: "m-member", source: "/team/member", shadows: ["/team", "/"] }, "the closest entry is taken whole: no args or env leak up from /team");
  assert.deepEqual(merged.slow, { name: "slow", runtime: "codex", args: [], env: {}, source: "/team", shadows: [] });
});

test("launch-config set/list/remove rewrite only the launch-configs block, round-trip hostile values, redact literals, and keep env on request", () => {
  const scope = join(base, "scope"); mkdirSync(join(scope, "agents"), { recursive: true });
  const original = "name: t\n# a comment that must survive\ncapabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\nyolo: true\n";
  write(join(scope, "oats-config.yaml"), original);
  const def = { runtime: "claude", executable: "./bin/claude wrapper.sh", args: ["--flag", HOSTILE], env: { KEY: { fromEnv: "SRC" }, FOO: "lit # val" }, model: "claude-opus-5", yolo: false };
  write(join(base, "fast.json"), JSON.stringify(def));
  let r = oats(["launch-config", "set", "fast", "--file", join(base, "fast.json"), "--dir", scope]);
  assert.equal(r.json.ok, true, r.stdout);
  assert.equal(r.json.result.before, null);
  assert.deepEqual(r.json.result.after, { runtime: "claude", executable: "./bin/claude wrapper.sh", args: ["--flag", HOSTILE], env: { FOO: { redacted: true }, KEY: { fromEnv: "SRC" } }, model: "claude-opus-5", yolo: null === undefined ? null : false });
  assert.equal(r.json.result.effective.source, scope);
  const text = readFileSync(join(scope, "oats-config.yaml"), "utf8");
  assert.ok(text.startsWith(original.trimEnd() + "\n"), "every original byte is still there, in place");
  assert.ok(!text.includes("redacted"), "no placeholder is ever persisted");
  assert.deepEqual(parseYamlNested(text)["launch-configs"].fast, { runtime: "claude", executable: "./bin/claude wrapper.sh", args: ["--flag", HOSTILE], env: { FOO: "lit # val", KEY: { fromEnv: "SRC" } }, model: "claude-opus-5", yolo: false }, "the kernel reads back exactly what was set");
  // list: literals redacted, references shown, source named.
  r = oats(["launch-config", "list", "--dir", scope]);
  assert.equal(r.json.ok, true, r.stdout);
  assert.equal(r.json.result.context, scope);
  assert.deepEqual(r.json.result.configurations.map((c) => [c.name, c.runtime, c.env, c.source, c.shadows]), [["fast", "claude", { FOO: { redacted: true }, KEY: { fromEnv: "SRC" } }, scope, []]]);
  assert.ok(!JSON.stringify(r.json).includes("lit # val"), "the literal value is not in the answer");
  // An editor that saw redactions keeps the local env: env omitted + --keep-env.
  write(join(base, "fast2.json"), JSON.stringify({ runtime: "claude", args: ["--other"], model: "claude-sonnet-5" }));
  r = oats(["launch-config", "set", "fast", "--file", join(base, "fast2.json"), "--keep-env", "--dir", scope]);
  assert.equal(r.json.ok, true, r.stdout);
  assert.deepEqual(parseYamlNested(readFileSync(join(scope, "oats-config.yaml"), "utf8"))["launch-configs"].fast, { runtime: "claude", args: ["--other"], env: { FOO: "lit # val", KEY: { fromEnv: "SRC" } }, model: "claude-sonnet-5" });
  assert.deepEqual(r.json.result.before.args, ["--flag", HOSTILE]);
  // --keep-env with env in the definition, or for a name not declared here, is refused.
  write(join(base, "fast3.json"), JSON.stringify({ runtime: "pi", env: { X: "1" } }));
  r = oats(["launch-config", "set", "fast", "--file", join(base, "fast3.json"), "--keep-env", "--dir", scope]);
  assert.equal(r.json.error?.code, "E_BAD_ARGS", r.stdout);
  write(join(base, "n.json"), JSON.stringify({ runtime: "pi" }));
  r = oats(["launch-config", "set", "nothere", "--file", join(base, "n.json"), "--keep-env", "--dir", scope]);
  assert.equal(r.json.error?.code, "E_LAUNCH_CONFIG_UNKNOWN", r.stdout);
  // Invalid definitions never touch the file.
  const beforeBad = readFileSync(join(scope, "oats-config.yaml"), "utf8");
  write(join(base, "bad.json"), JSON.stringify({ runtime: "bash" }));
  r = oats(["launch-config", "set", "bad", "--file", join(base, "bad.json"), "--dir", scope]);
  assert.equal(r.json.error?.code, "E_LAUNCH_CONFIG_INVALID", r.stdout);
  assert.equal(readFileSync(join(scope, "oats-config.yaml"), "utf8"), beforeBad);
  // Shadowing from a member scope, and the selectors --soul and --home.
  const member = join(scope, "member"); mkdirSync(join(member, "agents", "dev", "soul"), { recursive: true });
  write(join(member, "oats-config.yaml"), "name: member\n");
  write(join(member, "agents", "dev", "soul", "soul.yaml"), "name: dev\nrepo: .\nwork: checkout\nruntime: pi\n");
  write(join(base, "member-fast.json"), JSON.stringify({ runtime: "pi", args: ["--member"] }));
  r = oats(["launch-config", "set", "fast", "--file", join(base, "member-fast.json"), "--dir", member]);
  assert.equal(r.json.ok, true, r.stdout);
  r = oats(["launch-config", "list", "--dir", member]);
  assert.deepEqual(r.json.result.configurations.map((c) => [c.name, c.runtime, c.args, c.source, c.shadows]), [["fast", "pi", ["--member"], member, [scope]]]);
  // Overriding an INHERITED entry with --keep-env: the effective (scope's) env is copied once into the member's complete entry.
  const member2 = join(scope, "member2"); mkdirSync(join(member2, "agents"), { recursive: true });
  write(join(member2, "oats-config.yaml"), "name: member2\n");
  write(join(base, "override.json"), JSON.stringify({ runtime: "codex", args: ["--o"] }));
  r = oats(["launch-config", "set", "fast", "--file", join(base, "override.json"), "--keep-env", "--dir", member2]);
  assert.equal(r.json.ok, true, r.stdout); assert.equal(r.json.result.before, null, "nothing was declared locally before");
  assert.deepEqual(parseYamlNested(readFileSync(join(member2, "oats-config.yaml"), "utf8"))["launch-configs"].fast, { runtime: "codex", args: ["--o"], env: { FOO: "lit # val", KEY: { fromEnv: "SRC" } } });
  assert.deepEqual(r.json.result.effective.env, { FOO: { redacted: true }, KEY: { fromEnv: "SRC" } });
  r = oats(["launch-config", "list", "--soul", "dev", "--dir", member]);
  assert.equal(r.json.result.context, member); assert.deepEqual(r.json.result.selected, { soul: "dev", agentsRoot: join(member, "agents") });
  const home = join(member, "agents", "dev", "instances", "dev-one");
  write(join(home, "instance.json"), JSON.stringify({ agent: "dev", instance: "dev-one", home, repo: member, launched: false }));
  r = oats(["launch-config", "list", "--home", home]);
  assert.equal(r.json.ok, true, r.stdout);
  assert.equal(r.json.result.context, member, "a home's recorded repository is its context");
  assert.equal(r.json.result.configurations[0].args[0], "--member");
  r = oats(["launch-config", "set", "x", "--file", join(base, "n.json"), "--home", home]);
  assert.equal(r.json.error?.code, "E_BAD_ARGS", "writes address a scope with --dir only");
  // remove at the member: the scope's entry becomes effective again; removing an inherited name is refused.
  r = oats(["launch-config", "remove", "fast", "--dir", member]);
  assert.equal(r.json.ok, true, r.stdout); assert.equal(r.json.result.effective.source, scope);
  assert.equal(readFileSync(join(member, "oats-config.yaml"), "utf8"), "name: member\n", "an empty block is dropped, nothing else remains");
  r = oats(["launch-config", "remove", "fast", "--dir", member]);
  assert.equal(r.json.error?.code, "E_LAUNCH_CONFIG_UNKNOWN");
  // A scope whose config declares a broken entry is refused by the reader too.
  write(join(base, "broken", "oats-config.yaml"), "name: b\nlaunch-configs:\n  x:\n    runtime: bash\n");
  r = oats(["launch-config", "list", "--dir", join(base, "broken")]);
  assert.equal(r.json.ok, false); assert.match(r.json.error.message, /needs runtime/);
});

test("inline collections keep commas, empty strings and # inside elements; a comment after the bracket is dropped", () => {
  assert.deepEqual(parseYamlNested('a: ["--arg", "a,b", "", "x # y"] # c\nb: {k: "v, w", "q k": 2}\nc: []\nd: [x, y]\ne: [""]\nf: {}\n'), { a: ["--arg", "a,b", "", "x # y"], b: { k: "v, w", "q k": 2 }, c: [], d: ["x", "y"], e: [""], f: {} });
  assert.deepEqual(parseYamlNested("launch-configs:\n  x:\n    runtime: pi\n    args: [\"a # b\", \"c\"]\n")["launch-configs"].x, { runtime: "pi", args: ["a # b", "c"] });
});

test("configuration names that are Object.prototype properties work everywhere: merge, set, list, keep-env, remove", () => {
  const scope = join(base, "proto"); mkdirSync(join(scope, "agents"), { recursive: true });
  write(join(scope, "oats-config.yaml"), "name: p\n");
  for (const name of ["constructor", "toString", "__proto__".replace("__proto__", "hasOwnProperty")]) {
    write(join(base, `${name}.json`), JSON.stringify({ runtime: "pi", env: { A: "1" } }));
    let r = oats(["launch-config", "set", name, "--file", join(base, `${name}.json`), "--dir", scope]);
    assert.equal(r.json.ok, true, `${name}: ${r.stdout}`); assert.equal(r.json.result.before, null);
    r = oats(["launch-config", "list", "--dir", scope]);
    assert.ok(r.json.result.configurations.some((c) => c.name === name && c.source === scope), `${name} listed`);
    write(join(base, `${name}2.json`), JSON.stringify({ runtime: "codex" }));
    r = oats(["launch-config", "set", name, "--file", join(base, `${name}2.json`), "--keep-env", "--dir", scope]);
    assert.equal(r.json.ok, true, `${name} keep-env: ${r.stdout}`); assert.deepEqual(r.json.result.after.env, { A: { redacted: true } });
    r = oats(["launch-config", "remove", name, "--dir", scope]);
    assert.equal(r.json.ok, true, `${name} remove: ${r.stdout}`);
  }
  assert.equal(readFileSync(join(scope, "oats-config.yaml"), "utf8"), "name: p\n");
  const merged = launchConfigsOf([{ _level: "/t", "launch-configs": { constructor: { runtime: "pi" } } }, { _level: "/", "launch-configs": { constructor: { runtime: "claude" } } }]);
  assert.deepEqual([merged.constructor.source, merged.constructor.shadows], ["/t", ["/"]]);
  assert.equal(Object.getPrototypeOf(merged), null);
});

test("the launch-configs block replacement leaves every other byte alone and handles inline and quoted key forms", () => {
  const scope = join(base, "bytes"); mkdirSync(join(scope, "agents"), { recursive: true });
  const original = "name: b\n\n\n# three blank-ish lines above stay\ncapabilities:\n  layers:\n    knowledge: none\n\n\n\nyolo: true\n# trailing comment\n\n\n";
  write(join(scope, "oats-config.yaml"), original);
  write(join(base, "b.json"), JSON.stringify({ runtime: "pi" }));
  let r = oats(["launch-config", "set", "b", "--file", join(base, "b.json"), "--dir", scope]);
  assert.equal(r.json.ok, true, r.stdout);
  let text = readFileSync(join(scope, "oats-config.yaml"), "utf8");
  assert.ok(text.startsWith(original), "the whole original file, blank lines and trailing bytes included, is a prefix of the result");
  assert.equal(text.slice(original.length), "\nlaunch-configs:\n  b:\n    runtime: pi\n", "appended after its own blank separator");
  r = oats(["launch-config", "remove", "b", "--dir", scope]);
  assert.equal(readFileSync(join(scope, "oats-config.yaml"), "utf8"), original, "removing the only entry restores the original bytes");
  // An inline declaration and a quoted key are the same block, replaced in place, never duplicated.
  for (const form of ["launch-configs: {}\n", "launch-configs: {x: {runtime: codex}}\n", "\"launch-configs\":\n  x:\n    runtime: codex\n"]) {
    const doc = `name: b\n${form}yolo: false\n`;
    write(join(scope, "oats-config.yaml"), doc);
    r = oats(["launch-config", "set", "b", "--file", join(base, "b.json"), "--dir", scope]);
    assert.equal(r.json.ok, true, `${JSON.stringify(form)}: ${r.stdout}`);
    text = readFileSync(join(scope, "oats-config.yaml"), "utf8");
    assert.equal((text.match(/launch-configs/g) || []).length, 1, `one declaration: ${text}`);
    assert.ok(text.startsWith("name: b\n") && text.endsWith("yolo: false\n"), text);
    const back = parseYamlNested(text)["launch-configs"];
    assert.deepEqual(back.b, { runtime: "pi" }); if (form.includes("x")) assert.deepEqual(back.x, { runtime: "codex" });
  }
  write(join(scope, "oats-config.yaml"), "name: b\nlaunch-configs:\n  a:\n    runtime: pi\nyolo: true\nlaunch-configs:\n  c:\n    runtime: pi\n");
  r = oats(["launch-config", "set", "b", "--file", join(base, "b.json"), "--dir", scope]);
  assert.equal(r.json.ok, false); assert.match(r.json.error.message, /declares launch-configs 2 times/);
});

test("an unrouted --server never reads or writes a local scope; a bad --file is refused without echoing its text", () => {
  const scope = join(base, "guard"); mkdirSync(join(scope, "agents"), { recursive: true });
  write(join(scope, "oats-config.yaml"), "name: g\n");
  write(join(base, "g.json"), JSON.stringify({ runtime: "pi" }));
  // --server routes (the lead's remote library): an unregistered server is refused there; the local scope is never read or written.
  for (const sub of [["list"], ["set", "g", "--file", join(base, "g.json")], ["remove", "g"]]) {
    const r = oats(["launch-config", ...sub, "--server", "somewhere", "--dir", scope]);
    assert.equal(r.json.ok, false, `${sub[0]}: ${r.stdout}`);
    assert.equal(r.json.error?.code, "E_SERVER_UNKNOWN", `${sub[0]}: ${r.stdout}`);
  }
  assert.equal(readFileSync(join(scope, "oats-config.yaml"), "utf8"), "name: g\n", "nothing was written");
  const secret = "SECRET-LITERAL-0xC0FFEE";
  write(join(base, "bad.json"), `{"runtime": "pi", "env": {"K": "${secret}"} trailing`);
  let r = oats(["launch-config", "set", "g", "--file", join(base, "bad.json"), "--dir", scope]);
  assert.equal(r.json.error?.code, "E_BAD_ARGS"); assert.ok(!JSON.stringify(r.json).includes(secret), "the parser's quote of the document is not relayed");
  assert.match(r.json.error.message, /not valid JSON/);
  r = oats(["launch-config", "set", "g", "--file", join(base, "missing.json"), "--dir", scope]);
  assert.equal(r.json.error?.code, "E_BAD_ARGS"); assert.match(r.json.error.message, /no such file/);
});

test("a top-level comment after the launch-configs block is not part of it: set and remove leave it where it is", () => {
  const scope = join(base, "comments"); mkdirSync(join(scope, "agents"), { recursive: true });
  const doc = "name: c\nlaunch-configs:\n  a:\n    runtime: pi\n# trailing top-level comment\n\n# another one at the end\n";
  write(join(scope, "oats-config.yaml"), doc);
  write(join(base, "c-b.json"), JSON.stringify({ runtime: "codex" }));
  assert.equal(oats(["launch-config", "set", "b", "--file", join(base, "c-b.json"), "--dir", scope]).json.ok, true);
  let text = readFileSync(join(scope, "oats-config.yaml"), "utf8");
  assert.ok(text.endsWith("\n# trailing top-level comment\n\n# another one at the end\n"), text);
  assert.deepEqual(Object.keys(parseYamlNested(text)["launch-configs"]).sort(), ["a", "b"]);
  assert.equal(oats(["launch-config", "remove", "a", "--dir", scope]).json.ok, true);
  assert.equal(oats(["launch-config", "remove", "b", "--dir", scope]).json.ok, true);
  assert.equal(readFileSync(join(scope, "oats-config.yaml"), "utf8"), "name: c\n# trailing top-level comment\n\n# another one at the end\n");
});
