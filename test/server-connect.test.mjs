// `oats server connect` (awebai/oats#517, feature server-connect): put this
// workspace on a machine and register it, in one idempotent run of six steps
// (ssh, oats, git, deployment, register, readiness), each re-checked every run.
// The host is this kernel behind the fake ssh (helpers/fake-ssh.mjs); a fake
// npm "installs" OATS by putting this CLI on the host's PATH.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync as execFileSyncReal, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fakeBin } from "./helpers/fake-ssh.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { connectServer } from "../lib/servers.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const STEPS = ["ssh", "oats", "git", "deployment", "register", "readiness"];

/** A soul set whose readiness fails the same way for two souls (a capability needing a command
 *  the host lacks), plus a third, disabled on the host, that would fail the same way. */
const ACME = { "acme.tool": { manifest: { requires: [{ command: "acme-cli", why: "the acme CLI", install: "brew install acme" }] } } };
const acmeSoul = { soul: { capabilities: { "acme.tool": { from: "here" } } } };

function setup(opts = {}) {
  const base = mkdtempSync("/tmp/oats-sc-"); // short: the control socket path must fit in 104 bytes
  const { bin, log } = fakeBin(base);
  const fx = v2Deployment(opts);
  const npmDir = join(base, "npm-bin"); mkdirSync(npmDir);
  const npmLog = join(base, "npm.log");
  writeFileSync(join(npmDir, "npm"), `#!/bin/sh
printf '%s\\n' "$@" >> ${JSON.stringify(npmLog)}
printf -- '--\\n' >> ${JSON.stringify(npmLog)}
case "$1" in
  --version) echo 10.9.0 ;;
  install)
    if [ -e ${JSON.stringify(join(base, "npm-fails"))} ]; then echo "npm error 404 Not Found - GET https://registry.npmjs.org/@awebai%2foats" >&2; exit 1; fi
    printf '#!/bin/sh\\nexec %s %s "$@"\\n' ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} > ${JSON.stringify(join(npmDir, "oats"))}
    /bin/chmod 755 ${JSON.stringify(join(npmDir, "oats"))}
    echo "added 1 package" ;;
esac
`);
  chmodSync(join(npmDir, "npm"), 0o755);
  const env = { ...process.env, PATH: bin, OATS_HOME_DIR: join(base, "oats-home"), HOME: join(base, "home"), OATS_REMOTE_CACHE: join(base, "cache") };
  mkdirSync(env.HOME, { recursive: true }); mkdirSync(env.OATS_HOME_DIR, { recursive: true });
  for (const k of Object.keys(env)) if (/^(OATS_INSTANCE|OATS_HOME$|PI_AGENT|SSH_CONNECTION)/.test(k)) delete env[k];
  const oats = (args, { cwd = fx.dep } = {}) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env, cwd });
    return { ...r, json: () => { try { return JSON.parse(r.stdout.trim()); } catch { throw new Error(`no JSON on stdout: ${r.stdout}\n${r.stderr}`); } } };
  };
  const serversFile = join(env.OATS_HOME_DIR, "servers.json");
  const servers = () => (existsSync(serversFile) ? JSON.parse(readFileSync(serversFile, "utf8")).servers : {});
  const npmCalls = () => (existsSync(npmLog) ? readFileSync(npmLog, "utf8").split("--\n").filter(Boolean).map((c) => c.trim().split("\n")) : []);
  const cleanup = () => { fx.cleanup(); rmSync(base, { recursive: true, force: true }); };
  return { base, bin, log, fx, env, npmDir, oats, servers, serversFile, npmCalls, cleanup, defaultDir: join(env.HOME, "Agents", "deployment") };
}
const statuses = (res) => res.steps.map((s) => s.status);
const stepOf = (res, name) => res.steps.find((s) => s.step === name);

test("a fresh host: no npm, then no oats, then installed, onboarded, registered and ready; a re-run does nothing", () => {
  const s = setup();
  try {
    // No npm on the host's PATH: the human installs Node or names where it lives.
    let r = s.oats(["server", "connect", "box", "--ssh", "box-host", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    let res = r.json().result;
    assert.equal(r.json().ok, true);
    assert.equal(res.id, "box"); assert.equal(res.ready, false); assert.equal(res.registration, null);
    assert.deepEqual(res.steps.map((x) => x.step), STEPS);
    assert.deepEqual(statuses(res), ["ok", "needs-human", "skipped", "skipped", "skipped", "skipped"]);
    assert.equal(stepOf(res, "oats").remedy, "install Node.js 22+ (npm) on box-host, or pass --path <the directory holding npm>");
    for (const name of STEPS.slice(2)) assert.equal(stepOf(res, name).detail, "waits for oats");
    assert.deepEqual(res.human, [stepOf(res, "oats").remedy]);
    assert.deepEqual(s.servers(), {}, "nothing registered");

    // npm there but no oats, without --install-oats: the exact command, for the human to run.
    r = s.oats(["server", "connect", "box", "--ssh", "box-host", "--path", s.npmDir, "--json"]);
    res = r.json().result;
    assert.deepEqual(statuses(res), ["ok", "needs-human", "skipped", "skipped", "skipped", "skipped"]);
    assert.equal(stepOf(res, "oats").remedy, `on box-host: npm install -g @awebai/oats@${VERSION} (or pass --install-oats)`);
    assert.deepEqual(s.npmCalls(), [["--version"]], "npm was asked its version, nothing installed");

    // --install-oats: installed exactly this kernel's version, then the rest in the same run.
    r = s.oats(["server", "connect", "box", "--ssh", "box-host", "--path", s.npmDir, "--install-oats", "--label", "Box", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    res = r.json().result;
    assert.deepEqual(statuses(res), ["ok", "done", "ok", "done", "done", "ok"], JSON.stringify(res.steps, null, 1));
    assert.equal(stepOf(res, "oats").detail, `installed @awebai/oats ${VERSION} (was missing)`);
    assert.deepEqual(s.npmCalls().slice(1), [["--version"], ["install", "-g", `@awebai/oats@${VERSION}`]], "argv fixed: exactly this kernel's version");
    assert.equal(res.ready, true);
    assert.deepEqual(res.human, []);
    const registration = { sshHost: "box-host", workspace: s.defaultDir, path: s.npmDir, label: "Box", workspaceKey: s.fx.key };
    assert.deepEqual(res.registration, registration);
    assert.deepEqual(s.servers().box, registration);
    assert.equal(existsSync(join(s.defaultDir, "oats-local.yaml")), true, "onboarded at ~/Agents/<this deployment's basename> on the host");

    // Idempotent: every step re-checked, nothing done twice.
    const before = s.npmCalls().length;
    r = s.oats(["server", "connect", "box", "--ssh", "box-host", "--path", s.npmDir, "--install-oats", "--label", "Box", "--json"]);
    res = r.json().result;
    assert.deepEqual(statuses(res), ["ok", "ok", "ok", "ok", "ok", "ok"], JSON.stringify(res.steps, null, 1));
    assert.equal(res.ready, true);
    assert.deepEqual(s.npmCalls().slice(before), [], "an up-to-date host never reaches npm");

    // Text mode prints the steps.
    r = s.oats(["server", "connect", "box", "--ssh", "box-host", "--path", s.npmDir]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ssh\s+ok/); assert.match(r.stdout, /readiness\s+ok/); assert.match(r.stdout, /ready/);
  } finally { s.cleanup(); }
});

test("an existing deployment: ok through, readiness problems become human lines once each, disabled souls skipped", () => {
  const s = setup({ capabilities: ACME, souls: { dev: acmeSoul, qa: acmeSoul, old: acmeSoul }, local: { souls: { disabled: ["old"] } } });
  try {
    const r = s.oats(["server", "connect", "here", "--ssh", "here-host", "--dir", s.fx.dep, "--oats", CLI, "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const res = r.json().result;
    assert.deepEqual(statuses(res), ["ok", "ok", "ok", "ok", "done", "needs-human"], JSON.stringify(res.steps, null, 1));
    assert.equal(stepOf(res, "deployment").detail, `${s.fx.dep} realizes ${s.fx.key}`);
    const line = "dev, qa: acme.tool requires acme-cli: the acme CLI → brew install acme";
    assert.deepEqual(res.human, [line], "one line for the problem both souls share; the disabled soul is not checked");
    assert.equal(stepOf(res, "readiness").remedy, line);
    assert.equal(res.ready, false);
    assert.deepEqual(s.servers().here, { sshHost: "here-host", workspace: s.fx.dep, oatsPath: CLI, workspaceKey: s.fx.key });
  } finally { s.cleanup(); }
});

test("git cannot read the workspace remote: needs-human at git, the rest waits; a re-run after the fix completes", () => {
  const s = setup();
  try {
    const away = `${s.fx.repo}.away`;
    renameSync(s.fx.repo, away);
    let r = s.oats(["server", "connect", "box", "--ssh", "box-host", "--oats", CLI, "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    let res = r.json().result;
    assert.deepEqual(statuses(res), ["ok", "ok", "needs-human", "skipped", "skipped", "skipped"]);
    const git = stepOf(res, "git");
    assert.equal(git.code, "E_REMOTE_UNREADABLE");
    assert.match(git.detail, /cannot read remote .*not-found/);
    assert.match(git.remedy, /on box-host: make .* readable by git there/);
    for (const name of ["deployment", "register", "readiness"]) assert.equal(stepOf(res, name).detail, "waits for git");
    assert.deepEqual(res.human, [git.remedy]);
    assert.equal(existsSync(s.defaultDir), false, "nothing written on the host");

    renameSync(away, s.fx.repo);
    r = s.oats(["server", "connect", "box", "--ssh", "box-host", "--oats", CLI, "--json"]);
    res = r.json().result;
    assert.deepEqual(statuses(res), ["ok", "ok", "ok", "done", "done", "ok"], JSON.stringify(res.steps, null, 1));
    assert.equal(res.ready, true);
  } finally { s.cleanup(); }
});

test("a deployment of another workspace at --dir fails the run with the steps so far", () => {
  const s = setup();
  const other = v2Deployment({ name: "other" });
  try {
    const r = s.oats(["server", "connect", "box", "--ssh", "box-host", "--dir", other.dep, "--oats", CLI, "--json"]);
    assert.equal(r.status, 1, r.stdout);
    const { ok, error } = r.json();
    assert.equal(ok, false);
    assert.equal(error.code, "E_SERVER_WORKSPACE_MISMATCH");
    assert.deepEqual(error.details.steps.map((x) => [x.step, x.status]), [["ssh", "ok"], ["oats", "ok"], ["git", "ok"], ["deployment", "failed"]]);
    assert.equal(error.details.steps[3].code, "E_SERVER_WORKSPACE_MISMATCH");
    assert.deepEqual(s.servers(), {});
  } finally { other.cleanup(); s.cleanup(); }
});

test("a non-empty directory without oats-local.yaml is never written into", () => {
  const s = setup();
  try {
    const full = join(s.base, "full"); mkdirSync(full); writeFileSync(join(full, "notes.txt"), "mine\n");
    const r = s.oats(["server", "connect", "box", "--ssh", "box-host", "--dir", full, "--oats", CLI, "--json"]);
    assert.equal(r.status, 1);
    assert.equal(r.json().error.code, "E_DIR_NOT_EMPTY");
    assert.deepEqual(r.json().error.details.steps.at(-1).step, "deployment");
    assert.deepEqual(readdirSync(full), ["notes.txt"]);
    // A relative --dir is refused before anything runs.
    const rel = s.oats(["server", "connect", "box", "--ssh", "box-host", "--dir", "Agents/x", "--json"]);
    assert.equal(rel.json().error.code, "E_BAD_ARGS");
  } finally { s.cleanup(); }
});

test("register: an id taken by another target fails unless --replace; the same target under another id is reported, not duplicated; a contradicted key is refused", () => {
  const s = setup();
  try {
    const write = (servers) => writeFileSync(s.serversFile, JSON.stringify({ servers }, null, 2) + "\n");
    write({ box: { sshHost: "elsewhere", workspace: "/srv/other" } });
    let r = s.oats(["server", "connect", "box", "--ssh", "box-host", "--dir", s.fx.dep, "--oats", CLI, "--json"]);
    assert.equal(r.status, 1);
    assert.equal(r.json().error.code, "E_SERVER_EXISTS");
    assert.equal(r.json().error.details.steps.at(-1).step, "register");
    assert.deepEqual(s.servers().box, { sshHost: "elsewhere", workspace: "/srv/other" });
    r = s.oats(["server", "connect", "box", "--ssh", "box-host", "--dir", s.fx.dep, "--oats", CLI, "--replace", "--json"]);
    assert.equal(r.status, 0, r.stdout);
    assert.equal(stepOf(r.json().result, "register").status, "done");
    assert.equal(s.servers().box.sshHost, "box-host");

    write({ old: { sshHost: "box-host", workspace: s.fx.dep, oatsPath: CLI, workspaceKey: s.fx.key } });
    r = s.oats(["server", "connect", "new", "--ssh", "box-host", "--dir", s.fx.dep, "--oats", CLI, "--json"]);
    assert.equal(r.status, 0, r.stdout);
    let reg = stepOf(r.json().result, "register");
    assert.equal(reg.status, "ok");
    assert.match(reg.detail, /already registered as old/);
    assert.deepEqual(Object.keys(s.servers()), ["old"], "not duplicated");
    // The same target without a key yet: the key is recorded on THAT registration (done), still not duplicated.
    write({ old: { sshHost: "box-host", workspace: s.fx.dep, oatsPath: CLI } });
    r = s.oats(["server", "connect", "new", "--ssh", "box-host", "--dir", s.fx.dep, "--oats", CLI, "--json"]);
    reg = stepOf(r.json().result, "register");
    assert.equal(reg.status, "done");
    assert.match(reg.detail, /already registered as old/);
    assert.deepEqual(s.servers(), { old: { sshHost: "box-host", workspace: s.fx.dep, oatsPath: CLI, workspaceKey: s.fx.key } });

    write({ box: { sshHost: "box-host", workspace: s.fx.dep, oatsPath: CLI, workspaceKey: "github.com/acme/other" } });
    const before = readFileSync(s.serversFile, "utf8");
    r = s.oats(["server", "connect", "box", "--ssh", "box-host", "--dir", s.fx.dep, "--oats", CLI, "--json"]);
    assert.equal(r.status, 1);
    assert.equal(r.json().error.code, "E_SERVER_WORKSPACE_MISMATCH");
    assert.deepEqual(r.json().error.details.steps.at(-1).details, { recorded: "github.com/acme/other", reported: s.fx.key });
    assert.equal(readFileSync(s.serversFile, "utf8"), before);
  } finally { s.cleanup(); }
});

test("a failed npm install is relayed and ends the run", () => {
  const s = setup();
  try {
    writeFileSync(join(s.base, "npm-fails"), "");
    const r = s.oats(["server", "connect", "box", "--ssh", "box-host", "--path", s.npmDir, "--install-oats", "--json"]);
    assert.equal(r.status, 1);
    const { error } = r.json();
    assert.equal(error.code, "E_REMOTE_INSTALL");
    assert.match(error.message, /npm error 404 Not Found/);
    assert.deepEqual(error.details.steps.map((x) => x.status), ["ok", "failed"]);
  } finally { s.cleanup(); }
});

test("an unreachable host fails at ssh", () => {
  const s = setup();
  try {
    writeFileSync(join(s.bin, "ssh"), "#!/bin/sh\necho 'ssh: Could not resolve hostname nowhere' >&2\nexit 255\n");
    const r = s.oats(["server", "connect", "box", "--ssh", "nowhere", "--json"]);
    assert.equal(r.status, 1);
    assert.equal(r.json().error.code, "E_SSH");
    assert.deepEqual(r.json().error.details.steps.map((x) => [x.step, x.status]), [["ssh", "failed"]]);
  } finally { s.cleanup(); }
});

test("server check reports whether the host's git reads the workspace remote", () => {
  const s = setup();
  try {
    let r = s.oats(["server", "connect", "box", "--ssh", "box-host", "--dir", s.fx.dep, "--oats", CLI, "--json"]);
    assert.equal(r.json().result.ready, true, r.stdout);
    r = s.oats(["server", "check", "box", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(r.json().result.workspaceReadable, true);
    assert.equal(Object.hasOwn(r.json().result, "workspaceReadError"), false);
    renameSync(s.fx.repo, `${s.fx.repo}.away`);
    r = s.oats(["server", "check", "box", "--json"]);
    assert.equal(r.json().result.workspaceReadable, false, r.stdout);
    assert.equal(r.json().result.workspaceReadError.code, "E_REMOTE_UNREADABLE");
    assert.equal(r.json().result.workspaceReadError.reason, "not-found");
    renameSync(`${s.fx.repo}.away`, s.fx.repo);
  } finally { s.cleanup(); }
});

test("readiness is bounded: souls the budget does not reach become one line naming the command", () => {
  // In process, over an injected transport and clock: each readiness call costs 35 s of a 60 s budget.
  let now = 0;
  const souls = ["a", "b", "c", "d"].map((name) => ({ name, problem: null }));
  const answer = (cmd) => {
    if (cmd === "true") return "";
    if (/ version --json$/.test(cmd)) return JSON.stringify({ schemaVersion: 1, desktopApi: 1, name: "@awebai/oats", version: "99.0.0", features: [] });
    if (/ onboard .* --check --json$/.test(cmd)) return JSON.stringify({ schemaVersion: 1, ok: true, result: { check: true, dir: "/srv/ws", state: "deployment", workspace: { ref: "git:github.com/acme/ws", key: "github.com/acme/ws" }, remote: { readable: true, commit: "a".repeat(40) } } });
    if (/ status --json --dir \/srv\/ws$/.test(cmd)) return JSON.stringify({ schemaVersion: 1, ok: true, result: { root: "/srv/ws/agents", agents: [], workspace: { key: "github.com/acme/ws" } } });
    if (/ souls --json --dir \/srv\/ws$/.test(cmd)) return JSON.stringify({ schemaVersion: 1, ok: true, result: { souls } });
    if (/ readiness --soul [a-d] --dir \/srv\/ws --json$/.test(cmd)) { now += 35000; return JSON.stringify({ schemaVersion: 1, ok: true, result: { summary: { ready: true }, checks: {} } }); }
    throw new Error(`unexpected remote command: ${cmd}`);
  };
  const execFileSync = (bin, argv) => answer(argv.at(-1));
  const prev = process.env.OATS_HOME_DIR; process.env.OATS_HOME_DIR = mkdtempSync("/tmp/oats-scb-");
  try {
    const res = connectServer({ id: "b", sshHost: "b-host", workspaceRef: "git:github.com/acme/ws", dir: "/srv/ws", localVersion: "0.39.0" }, { execFileSync, now: () => now });
    assert.deepEqual(statuses(res), ["ok", "ok", "ok", "ok", "done", "needs-human"]);
    assert.equal(stepOf(res, "oats").detail, "oats 99.0.0 (this kernel 0.39.0)");
    assert.deepEqual(res.human, ["readiness not checked for 2 souls: run `oats readiness --soul <s> --server b` for c, d"]);
  } finally { rmSync(process.env.OATS_HOME_DIR, { recursive: true, force: true }); if (prev === undefined) delete process.env.OATS_HOME_DIR; else process.env.OATS_HOME_DIR = prev; }
});

test("the requested id's own target conflict comes before the same-target twin, and text mode names the id that serves", () => {
  const s = setup();
  try {
    const write = (servers) => writeFileSync(s.serversFile, JSON.stringify({ servers }, null, 2) + "\n");
    write({ box: { sshHost: "elsewhere", workspace: "/srv/other", workspaceKey: "github.com/acme/other" }, twin: { sshHost: "box-host", workspace: s.fx.dep, oatsPath: CLI, workspaceKey: s.fx.key } });
    let r = s.oats(["server", "connect", "box", "--ssh", "box-host", "--dir", s.fx.dep, "--oats", CLI, "--json"]);
    assert.equal(r.status, 1, r.stdout);
    assert.equal(r.json().error.code, "E_SERVER_EXISTS", "box still routes elsewhere: never reported ready");
    assert.equal(s.servers().box.sshHost, "elsewhere");

    // A new id whose target is already registered as twin: the success line names twin, the id that exists.
    r = s.oats(["server", "connect", "fresh", "--ssh", "box-host", "--dir", s.fx.dep, "--oats", CLI]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /twin is ready: oats spawn <soul> --server twin/);
    assert.equal(Object.hasOwn(s.servers(), "fresh"), false);
  } finally { s.cleanup(); }
});

/** The bounded-readiness transport: the fixed host answers of the budget test, with `readiness`
 *  (and optionally `souls`) handed to a REAL child process under the timeout runRemote gives it. */
function hostAnswers(souls) {
  return (cmd) => {
    if (cmd === "true") return "";
    if (/ version --json$/.test(cmd)) return JSON.stringify({ schemaVersion: 1, desktopApi: 1, name: "@awebai/oats", version: "99.0.0", features: [] });
    if (/ onboard .* --check --json$/.test(cmd)) return JSON.stringify({ schemaVersion: 1, ok: true, result: { check: true, dir: "/srv/ws", state: "deployment", workspace: { ref: "git:github.com/acme/ws", key: "github.com/acme/ws" }, remote: { readable: true, commit: "a".repeat(40) } } });
    if (/ status --json --dir \/srv\/ws$/.test(cmd)) return JSON.stringify({ schemaVersion: 1, ok: true, result: { root: "/srv/ws/agents", agents: [], workspace: { key: "github.com/acme/ws" } } });
    if (/ souls --json --dir \/srv\/ws$/.test(cmd)) return JSON.stringify({ schemaVersion: 1, ok: true, result: { souls: souls.map((name) => ({ name, problem: null })) } });
    throw new Error(`unexpected remote command: ${cmd}`);
  };
}
const slowChild = (opts) => execFileSyncReal(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], opts);
const isolatedHome = (fn) => {
  const prev = process.env.OATS_HOME_DIR; process.env.OATS_HOME_DIR = mkdtempSync("/tmp/oats-scb-");
  try { return fn(); } finally { rmSync(process.env.OATS_HOME_DIR, { recursive: true, force: true }); if (prev === undefined) delete process.env.OATS_HOME_DIR; else process.env.OATS_HOME_DIR = prev; }
};
const budgetOptions = { id: "b", sshHost: "b-host", workspaceRef: "git:github.com/acme/ws", dir: "/srv/ws", localVersion: "0.39.0" };

test("readiness: a check the budget cuts off is not checked (needs-human), never an ssh failure; the listing gets the budget too", () => isolatedHome(() => {
  const answer = hostAnswers(["a", "b"]);
  let listTimeout;
  const execFileSync = (bin, argv, opts) => {
    const cmd = argv.at(-1);
    if (/ souls /.test(cmd)) listTimeout = opts.timeout;
    if (/ readiness --soul a /.test(cmd)) return slowChild(opts);
    return answer(cmd);
  };
  const res = connectServer(budgetOptions, { execFileSync, readinessBudgetMs: 1500 });
  assert.ok(listTimeout <= 1500, `the soul listing runs within the budget (got ${listTimeout})`);
  assert.deepEqual(statuses(res), ["ok", "ok", "ok", "ok", "done", "needs-human"]);
  assert.deepEqual(res.human, ["readiness not checked for 2 souls: run `oats readiness --soul <s> --server b` for a, b"]);
}));

test("readiness: a soul listing the budget cuts off is one human line; a real transport failure still fails", () => isolatedHome(() => {
  const answer = hostAnswers(["a"]);
  let res = connectServer(budgetOptions, { readinessBudgetMs: 1500, execFileSync: (bin, argv, opts) => (/ souls /.test(argv.at(-1)) ? slowChild(opts) : answer(argv.at(-1))) });
  assert.equal(stepOf(res, "readiness").status, "needs-human");
  assert.deepEqual(res.human, ["readiness not checked: the host did not list its souls within 2 s; run `oats readiness --soul <s> --server b` for each soul"]);

  const lost = (bin, argv) => {
    if (/ readiness /.test(argv.at(-1))) throw Object.assign(new Error("ssh failed"), { status: 255, stdout: "", stderr: "Connection reset by peer" });
    return answer(argv.at(-1));
  };
  assert.throws(() => connectServer(budgetOptions, { execFileSync: lost }), (e) => e.code === "E_SSH" && e.details.steps.at(-1).step === "readiness");
}));
