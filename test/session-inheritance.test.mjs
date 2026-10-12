// awebai/oats#972: a fixture never inherits the session that runs the suite. One definition
// (test/helpers/host-fixture.mjs SESSION_VARIABLES) says which variables those are, and every
// helper that builds an environment uses it: a variable is left out while it still has the value
// the worker started with, and kept once a test has set it.
//
// What a worker inherited cannot be changed from inside it: each case runs in a child `node` that
// starts with a session of its own, the one scripts/test-session-inheritance.mjs gives the suites
// it runs, so the names here are that run's and the definition's, never a third list.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SESSION_VARIABLES, fixtureBase, inheritedEnv, isSessionVariable, neverInherited } from "./helpers/host-fixture.mjs";
import { SESSION_SUITES, nodeTestArguments, poisonedSession } from "../scripts/test-session-inheritance.mjs";

const HELPERS = new URL("./helpers/", import.meta.url).href;
const SESSION = poisonedSession();
/** The names OATS_ had before, which no session has now: a worker that starts with them all the same. */
const LEGACY = { PI_AGENT_INSTANCE: "a-legacy-instance", PI_AGENT_HOME: "/a/legacy/home", PI_AGENTS_ROOT: "/a/legacy/agents" };
const bases = [];
test.after(() => { for (const b of bases) rmSync(b, { recursive: true, force: true }); });

/** Run `body` (the source of an async function of `{ base, helpers… }`) in a child that starts
 *  with SESSION, plus `extra`, in its environment → what it returns. The child works in a
 *  fixture base, outside any instance home. */
function inSession(body, extra = {}) {
  const base = fixtureBase("oats-si-");
  bases.push(base);
  const file = join(base, "child.mjs");
  writeFileSync(file, `import * as host from ${JSON.stringify(`${HELPERS}host-fixture.mjs`)};
import { v2Deployment } from ${JSON.stringify(`${HELPERS}v2-deployment.mjs`)};
import { inFixture } from ${JSON.stringify(`${HELPERS}trigger-source-fixture.mjs`)};
import * as recorded from ${JSON.stringify(`${HELPERS}recorded-tmux-server.mjs`)};
const base = ${JSON.stringify(base)};
const result = await (${body})({ base, host, v2Deployment, inFixture, recorded });
process.stdout.write("\\n" + JSON.stringify(result) + "\\n");
`);
  // This worker's own session never reaches the child: only SESSION does.
  const r = spawnSync(process.execPath, [file], { cwd: base, env: { ...inheritedEnv(), ...SESSION, ...extra }, encoding: "utf8", timeout: 120000 });
  assert.equal(r.status, 0, `the child failed\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout.trim().split("\n").pop());
}
/** The names of SESSION that `env` holds with the session's value. */
const inherited = (env) => Object.keys(SESSION).filter((name) => env[name] === SESSION[name]);

test("the definition: the harness configuration selectors, the display, the tmux client and every OATS, aweb and legacy pi-agent variable", () => {
  assert.deepEqual(SESSION_VARIABLES.names, ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "PI_CODING_AGENT_DIR", "DISPLAY", "TMUX", "TMUX_PANE"]);
  assert.deepEqual(SESSION_VARIABLES.prefixes, ["OATS_", "AWEB_"]);
  assert.deepEqual(SESSION_VARIABLES.legacyPrefixes, ["PI_AGENT"], "the names OATS_ had before stay dropped");
  for (const name of [...SESSION_VARIABLES.names, "OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "OATS_ANYTHING", "AWEB_IDENTITY_HOME", "AWEB_DELIVERY", "AWEB_ANYTHING", "PI_AGENT_HOME", "PI_AGENTS_ROOT"]) {
    assert.equal(isSessionVariable(name), true, name);
  }
  // Not the session's: the fixtures leave these as they find them.
  for (const name of ["PATH", "HOME", "LANG", "PI_CODING_AGENT", "WAYLAND_DISPLAY", "SSH_AUTH_SOCK", "XDG_RUNTIME_DIR", "TMUX_TMPDIR", "CLAUDE_CONFIG", "OATS", "AWEB"]) {
    assert.equal(isSessionVariable(name), false, name);
  }
  assert.throws(() => { SESSION_VARIABLES.names.push("X"); }, TypeError, "the definition is not changed by a test");
});

test("npm run test:session: node --test always gets an explicit list of files, and a flag's value is never taken for one", () => {
  const SCRIPT = new URL("../scripts/test-session-inheritance.mjs", import.meta.url).pathname;
  assert.deepEqual(nodeTestArguments([]), ["--test", ...SESSION_SUITES]);
  assert.deepEqual(nodeTestArguments(["test/login-environment.test.mjs"]), ["--test", "test/login-environment.test.mjs"]);
  // Flags go before the files; with none given the suites are still named.
  assert.deepEqual(nodeTestArguments(["--test-name-pattern=the rule", "--test-concurrency=1"]), ["--test", "--test-name-pattern=the rule", "--test-concurrency=1", ...SESSION_SUITES]);
  assert.deepEqual(nodeTestArguments(["test/login-environment.test.mjs", "--test-reporter=tap"]), ["--test", "--test-reporter=tap", "test/login-environment.test.mjs"]);
  // A value given apart from its flag would be node's value and this run's only "file": node would
  // then be given no file, and discover every suite of the repository.
  assert.throws(() => nodeTestArguments(["--test-name-pattern", "definition"]), /"definition" is not a test file.*--flag=value/);
  assert.throws(() => nodeTestArguments(["--test-name-pattern", "definition", "--test-reporter", "tap", "test/session-inheritance.test.mjs"]), /"definition" is not a test file/);
  // Nor a directory, a file that is not there, or one that is no module.
  for (const not of ["test", "test/no-such.test.mjs", "package.json"]) assert.throws(() => nodeTestArguments([not]), /is not a test file/, not);
  for (const args of [[], ["--test-reporter=tap"], ["test/login-environment.test.mjs"]]) assert.ok(nodeTestArguments(args).some((a) => a.endsWith(".test.mjs")), `no file for ${JSON.stringify(args)}`);
  // The command itself refuses, and starts no test run: it exits before it prints what it sets.
  const r = spawnSync(process.execPath, [SCRIPT, "--test-name-pattern", "definition"], { encoding: "utf8", env: inheritedEnv(), timeout: 60000 });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /^session inheritance: "definition" is not a test file/);
  assert.equal(r.stdout, "", "no run was started");
});

test("the rule: a session variable is left out while it has the value the worker started with, and kept once a test set it", () => {
  const seen = inSession(`async ({ host }) => {
    const answers = {};
    const names = ["DISPLAY", "CLAUDE_CONFIG_DIR", "OATS_INSTANCE", "AWEB_NOTHING_KNOWS_THIS", "PI_AGENT_HOME", "HTTPS_PROXY", "CLAUDECODE", "PATH", "KEPT_BY_ALL"];
    for (const name of names) answers[name] = { started: host.neverInherited(name, process.env[name]), other: host.neverInherited(name, "a value a test set"), absent: host.neverInherited(name, undefined) };
    return answers;
  }`, { ...LEGACY, HTTPS_PROXY: "http://proxy.invalid", CLAUDECODE: "1", KEPT_BY_ALL: "kept" });
  for (const name of ["DISPLAY", "CLAUDE_CONFIG_DIR", "OATS_INSTANCE", "AWEB_NOTHING_KNOWS_THIS", "PI_AGENT_HOME"]) {
    assert.deepEqual(seen[name], { started: true, other: false, absent: false }, name);
  }
  // What a fixture never inherits whoever set it (proxies, the harness marker) is not the session's rule.
  for (const name of ["HTTPS_PROXY", "CLAUDECODE"]) assert.deepEqual(seen[name], { started: true, other: true, absent: true }, name);
  for (const name of ["PATH", "KEPT_BY_ALL"]) assert.deepEqual(seen[name], { started: false, other: false, absent: false }, name);
  // In this worker a variable it did not start with is never the session's to drop.
  assert.equal(neverInherited("OATS_SESSION_INHERITANCE_TEST_ONLY", "x"), false);
});

test("fixtureEnv: no variable the worker inherited from the session; the ones the test set, in process.env or as extra, and the fixture's own", () => {
  const seen = inSession(`async ({ base, host }) => {
    process.env.DISPLAY = ":9";                       // the test's own display
    process.env.OATS_SET_BY_THE_TEST = "switch";      // a switch the test sets
    process.env.AWEB_IDENTITY_HOME = "/the/test/identity";
    return { env: host.fixtureEnv(base, { extra: { CODEX_HOME: "/the/test/codex", OATS_EXTRA: "1" } }), inherited: host.inheritedEnv() };
  }`, LEGACY);
  assert.deepEqual(inherited(seen.env), [], "nothing of the session reaches a child");
  assert.deepEqual(inherited(seen.inherited), []);
  for (const env of [seen.env, seen.inherited]) {
    assert.equal(env.DISPLAY, ":9");
    assert.equal(env.OATS_SET_BY_THE_TEST, "switch");
    assert.equal(env.AWEB_IDENTITY_HOME, "/the/test/identity");
  }
  assert.equal(seen.env.CODEX_HOME, "/the/test/codex", "extra is the test's");
  assert.equal(seen.env.OATS_EXTRA, "1");
  assert.match(seen.env.OATS_TEST_CGROUP, /\.scope\n$/, "the fixture's own");
  // Every name of the session that the test did not set is gone, the unknown ones and the legacy ones too.
  for (const name of [...Object.keys(SESSION), ...Object.keys(LEGACY)].filter((n) => !["DISPLAY", "AWEB_IDENTITY_HOME", "CODEX_HOME"].includes(n))) assert.equal(name in seen.env, false, name);
});

test("v2Deployment: fx.env and fx.inEnv hold nothing of the session; what the test set before the call reaches the kernel", () => {
  const seen = inSession(`async ({ v2Deployment }) => {
    const fx = v2Deployment();
    try {
      const before = await fx.inEnv(() => ({ ...process.env }));
      process.env.OATS_INSTANCE = "the-test-instance";   // an identity the test is testing
      process.env.TMUX_PANE = "%7";
      process.env.OATS_TEST_LOGIN_SHELL = "/the/test/bash";
      const after = await fx.inEnv(() => ({ ...process.env }));
      return { env: fx.env, before, after, base: fx.base, outside: { ...process.env } };
    } finally { fx.cleanup(); }
  }`, { ...LEGACY, OATS_TEST_LOGIN_SHELL: "/the/session/bash" });
  for (const [what, env] of [["fx.env", seen.env], ["fx.inEnv", seen.before]]) {
    assert.deepEqual(inherited(env), [], what);
    for (const name of [...Object.keys(SESSION), ...Object.keys(LEGACY)]) assert.equal(name in env, false, `${what}: ${name}`);
    assert.equal(env.OATS_HOME_DIR, join(seen.base, "oats-home"), `${what}: the fixture's own`);
    assert.equal(env.OATS_TEST_LOGIN_SHELL, join(seen.base, "no-login-shell", "bash"), `${what}: never a login shell the session names`);
  }
  assert.deepEqual(inherited(seen.after), []);
  assert.equal(seen.after.OATS_INSTANCE, "the-test-instance");
  assert.equal(seen.after.TMUX_PANE, "%7");
  assert.equal(seen.after.OATS_TEST_LOGIN_SHELL, "/the/test/bash", "a login shell the test set is the fixture's");
  // The worker's own environment is not touched outside the call.
  assert.equal(seen.outside.CLAUDE_CONFIG_DIR, SESSION.CLAUDE_CONFIG_DIR);
});

test("isolateSessionEnvironment: the worker holds nothing of the session until it is restored; what the test set before it stays", () => {
  const seen = inSession(`async ({ base, host }) => {
    process.env.OATS_SET_BEFORE = "kept";
    process.env.DISPLAY = ":9";
    const restore = host.isolateSessionEnvironment(base);
    const isolated = { ...process.env };
    restore();
    return { isolated, restored: { ...process.env } };
  }`, { ENV: "/the/session/shrc", BASH_ENV: "/the/session/bashrc", CLAUDECODE: "1" });
  assert.deepEqual(inherited(seen.isolated), []);
  for (const name of Object.keys(SESSION).filter((n) => n !== "DISPLAY")) assert.equal(name in seen.isolated, false, name);
  for (const name of ["ENV", "BASH_ENV", "CLAUDECODE"]) assert.equal(name in seen.isolated, false, name);
  assert.equal(seen.isolated.OATS_SET_BEFORE, "kept");
  assert.equal(seen.isolated.DISPLAY, ":9");
  assert.match(seen.isolated.OATS_TEST_LOGIN_SHELL, /no-login-shell\/bash$/, "the fixture's own");
  assert.deepEqual(inherited(seen.restored).sort(), Object.keys(SESSION).filter((n) => n !== "DISPLAY").sort(), "restored as it was");
});

test("inFixture and a recorded tmux server: the in-process tick and the server get the fixture's environment, not the runner's", () => {
  const seen = inSession(`async ({ base, host, v2Deployment, inFixture, recorded }) => {
    const fx = v2Deployment();
    const socket = base + "/recorded/tmux.sock";
    try {
      process.env.OATS_SET_BY_THE_TEST = "switch";
      const tick = inFixture(fx, () => ({ ...process.env }), { AWEB_DELIVERY: "the-test-delivery" });
      recorded.startServer(socket, "an-instance");
      const server = recorded.tmuxOn(socket, "show-environment", "-g").split("\\n");
      return { tick, server };
    } finally { recorded.endServers(); fx.cleanup(); }
  }`);
  assert.deepEqual(inherited(seen.tick), []);
  assert.equal(seen.tick.OATS_SET_BY_THE_TEST, "switch");
  assert.equal(seen.tick.AWEB_DELIVERY, "the-test-delivery", "extra is the test's");
  const server = Object.fromEntries(seen.server.filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  assert.deepEqual(inherited(server), [], "the server a home records holds nothing of the runner's session");
  assert.equal(server.OATS_SET_BY_THE_TEST, "switch", "and what the test set");
});
