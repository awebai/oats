import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRemoteSupport, launchConfigRemote, remoteQuote, restartRemote, snapshotPath, startRemote, writeServers, writeSnapshot } from "../lib/servers.mjs";

const base = mkdtempSync(join(tmpdir(), "oats-launch-remote-"));
const oldHome = process.env.OATS_HOME_DIR;
process.env.OATS_HOME_DIR = base;
test.after(() => { if (oldHome === undefined) delete process.env.OATS_HOME_DIR; else process.env.OATS_HOME_DIR = oldHome; rmSync(base, { recursive: true, force: true }); });
const target = { sshHost: "original-host", workspace: "/original/team", oatsPath: "/installed/oats" };
writeServers({ s: { sshHost: "new-host", workspace: "/new/team" } });
writeSnapshot("s", target, { version: "0.22.17", schemaVersion: 1 }, { instance: "dev-one", home: "/original/home", agent: "dev" });
const envelope = result => JSON.stringify({ schemaVersion: 1, ok: true, result });
const allFeatures = ["session-start", "session-restart", "launch-config"];
function transport(features = allFeatures, response = { instance: "dev-one" }) {
  const calls = [];
  return { calls, execFileSync(bin, argv, options) {
    assert.equal(bin, "ssh"); calls.push({ command: argv.at(-1), host: argv.at(-2), options });
    return argv.at(-1).includes("version --json")
      ? envelope({ desktopApi: 1, version: "0.22.17", remote: ["session"], features })
      : envelope(response);
  } };
}

test("remote restart is one operation on the frozen home and does not rewrite its route", () => {
  const before = readFileSync(snapshotPath("s", "dev-one"), "utf8"), io = transport();
  const model = "model with 'quotes' $(literal)";
  const r = restartRemote("s", { home: "/original/home", runtime: "codex", launchConfig: "personal", model, yolo: false }, io);
  assert.equal(r.envelope.ok, true);
  assert.deepEqual(io.calls.map(c => c.host), ["original-host", "original-host"]);
  assert.equal(io.calls[1].command, `/installed/oats session restart --home /original/home --launch-config personal --runtime codex --model ${remoteQuote(model)} --no-yolo --json`);
  assert.equal(readFileSync(snapshotPath("s", "dev-one"), "utf8"), before);
});

test("old remote kernels reject new launch options before mutation while model-only starts remain compatible", () => {
  for (const [fn, choices, features, missing] of [
    [restartRemote, {}, ["session-start", "launch-config"], "session-restart"],
    [startRemote, { yolo: false }, ["session-start"], "launch-config"],
    [startRemote, { launchConfig: "personal" }, ["session-start"], "launch-config"],
    [startRemote, { runtime: "codex" }, ["session-start"], "launch-config"],
    [restartRemote, {}, ["session-restart", "launch-config"], "session-start"],
  ]) {
    const io = transport(features);
    assert.throws(() => fn("s", { instance: "dev-one", ...choices }, io), e => e.code === "E_REMOTE_INCOMPATIBLE" && e.message.includes(missing));
    assert.equal(io.calls.length, 1); assert.match(io.calls[0].command, /version --json/);
  }
  const io = transport(["session-start"]);
  startRemote("s", { instance: "dev-one", model: "m" }, io);
  assert.match(io.calls[1].command, /session start --home \/original\/home --model m --json/);
  for (const choices of [{ yolo: "false" }, { runtime: "unknown" }, { model: "--oops" }, { launchConfig: "bad name" }]) {
    const invalid = transport();
    assert.throws(() => restartRemote("s", { instance: "dev-one", ...choices }, invalid), e => e.code === "E_BAD_ARGS");
    assert.equal(invalid.calls.length, 0);
  }
});

test("configuration definitions stream on stdin to the chosen remote scope, with refs left unresolved", () => {
  const definition = { runtime: "codex", args: ["--profile", "a,b # x", "", "$(literal)"], env: { API_KEY: { fromEnv: "PERSONAL_KEY" }, CONFIG_DIR: "literal private directory" } };
  const io = transport();
  launchConfigRemote("s", { action: "set", name: "personal", context: "/new/member with spaces", definition }, io);
  assert.deepEqual(io.calls.map(c => c.host), ["new-host", "new-host"]);
  assert.equal(io.calls[0].options.input, undefined, "the version probe never receives definition data");
  assert.deepEqual(JSON.parse(io.calls[1].options.input.toString()), definition);
  assert.equal(io.calls[1].command, "oats launch-config set personal --file - --dir '/new/member with spaces' --json");
  assert.equal(io.calls[1].command.includes("literal private directory"), false);
  const kept = transport();
  launchConfigRemote("s", { action: "set", name: "personal", definition: { runtime: "claude" }, keepEnv: true }, kept);
  assert.match(kept.calls[1].command, /--file - --keep-env --dir \/new\/team/);
});

test("configuration scope and home routing stay distinct, and invalid or unsupported requests send no mutation", () => {
  const home = transport();
  launchConfigRemote("s", { action: "preview", instance: "dev-one", launchConfig: "personal", yolo: true }, home);
  assert.equal(home.calls[1].host, "original-host");
  assert.match(home.calls[1].command, /launch-config preview --launch-config personal --yolo --home \/original\/home --json/);
  const soul = transport();
  launchConfigRemote("s", { action: "list", soul: "dev", agentsRoot: "/new/team/agents" }, soul);
  assert.equal(soul.calls[1].host, "new-host"); assert.match(soul.calls[1].command, /--dir \/new\/team/);
  const unknown = transport();
  assert.throws(() => launchConfigRemote("missing", { action: "set", name: "x", definition: { runtime: "pi" } }, unknown), e => e.code === "E_SERVER_UNKNOWN");
  assert.equal(unknown.calls.length, 0);
  for (const options of [
    { action: "set", home: "/original/home", name: "x" },
    { action: "list", home: "/original/home", context: "/new/team" },
    { action: "preview" }, { action: "list", context: "relative" },
    { action: "set", name: "x", definition: { runtime: "pi", env: {} }, keepEnv: true },
  ]) {
    const io = transport();
    assert.throws(() => launchConfigRemote("s", options, io), e => e.code === "E_BAD_ARGS");
    assert.equal(io.calls.length, 0);
  }
  const old = transport([]);
  assert.throws(() => launchConfigRemote("s", { action: "remove", name: "personal" }, old), e => e.code === "E_REMOTE_INCOMPATIBLE");
  assert.equal(old.calls.length, 1);
});

test("remote named-config spawns gate support without substituting the soul runtime for the configuration", () => {
  const remote = { version: "0.22.17", features: ["launch-config"], runtimes: ["codex"], sessionBackends: [], launchOptions: [], advertised: true };
  const roster = { agents: [{ name: "dev", runtime: "claude" }] };
  const args = ["dev", "--launch-config", "personal"];
  assert.equal(checkRemoteSupport(remote, target, args, roster).runtime, undefined);
  assert.throws(() => checkRemoteSupport({ ...remote, features: [] }, target, args, roster), e => e.code === "E_REMOTE_INCOMPATIBLE");
  assert.throws(() => checkRemoteSupport(remote, target, [...args, "--runtime", "claude"], roster), e => e.code === "E_REMOTE_INCOMPATIBLE");
});
