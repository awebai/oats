import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-ops-route-")));
test.after(() => rmSync(base, { recursive: true, force: true }));
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
function gitRepo(dir) { mkdirSync(dir, { recursive: true }); execFileSync("git", ["init", "-q", dir]); execFileSync("git", ["-C", dir, "config", "user.email", "t@example.invalid"]); execFileSync("git", ["-C", dir, "config", "user.name", "T"]); write(join(dir, ".gitignore"), "\n"); execFileSync("git", ["-C", dir, "add", "."]); execFileSync("git", ["-C", dir, "commit", "-qm", "init"]); }

test("inspect, use, soul set and operation run route to a registered server over its saved route: explicit --dir travels as is, --home is its own context, instructions travel on stdin, an old remote is refused before anything is sent", () => {
  const env = { ...process.env, OATS_HOME_DIR: join(base, "oats-home") };
  for (const k of ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT"]) delete env[k];
  // A fake ssh that logs its argv and runs the remote command locally through sh -c with THIS stdin.
  const bin = join(base, "bin"); mkdirSync(bin, { recursive: true });
  const log = join(base, "ssh.log");
  write(join(bin, "ssh"), `#!/bin/sh\nprintf '%s\\n' "$@" >> ${JSON.stringify(log)}\nprintf -- '--\\n' >> ${JSON.stringify(log)}\nwhile [ "$1" != "--" ]; do shift; done\nshift; shift\nexec sh -c "$1"\n`);
  chmodSync(join(bin, "ssh"), 0o755);
  env.PATH = `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`;
  // The "remote" workspace: a team scope with one member repo holding an owned knowledge provider and a soul with a home.
  const team = join(base, "team"); mkdirSync(team, { recursive: true });
  write(join(team, "oats-config.yaml"), "team:\n  name: t\ncapabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n");
  const member = join(team, "member"); gitRepo(member);
  const notes = join(member, ".agents", "capabilities", "owned", "notes");
  write(join(notes, "oats.json"), JSON.stringify({ capability: "test.notes", version: "0.1.0", description: "p", compatibility: { oats: ">=0.6.2" }, layer: "knowledge", command: "notes", commands: { inspect: "bin/notes.mjs" }, operations: { inspect: { kind: "view", command: "inspect", context: "home" } } }));
  write(join(notes, "bin", "notes.mjs"), `console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: { documents: [{ label: "Memory", kind: "text", text: "remote memory" }] } }));\n`);
  write(join(member, "oats-config.yaml"), "capabilities:\n  layers:\n    knowledge:\n      capability: test.notes\n      from: owned\n      global: true\n");
  write(join(member, "agents", "dev", "soul", "soul.yaml"), "name: dev\nrepo: .\nwork: checkout\nruntime: pi\n"); write(join(member, "agents", "dev", "soul", "AGENTS.md"), "# dev\n");
  const home = join(member, "agents", "dev", "instances", "dev-r1");
  write(join(home, "instance.json"), JSON.stringify({ agent: "dev", instance: "dev-r1", home, repo: member, launched: false, capabilities: [{ id: "test.notes", level: member, settings: {} }], layers: {} }));
  const oldOats = join(base, "old-oats.sh");
  write(oldOats, `#!/bin/sh\necho '{"schemaVersion":1,"name":"@awebai/oats","version":"0.22.14","desktopApi":1,"runtimes":["pi"],"sessionBackends":["tmux"],"launchOptions":[],"remote":["session"],"features":["session-upload"]}'\n`); chmodSync(oldOats, 0o755);
  write(join(env.OATS_HOME_DIR, "servers.json"), JSON.stringify({ servers: { build: { sshHost: "build-host", workspace: team, oatsPath: CLI }, old: { sshHost: "old-host", workspace: team, oatsPath: oldOats } } }));
  write(join(env.OATS_HOME_DIR, "remote", "build", "dev-r1.json"), JSON.stringify({ serverId: "build", instance: "dev-r1", home, target: { sshHost: "build-host", workspace: team, oatsPath: CLI } }));
  const oats = (args) => { const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env, cwd: base }); const json = () => { try { return JSON.parse(r.stdout.trim()); } catch { throw new Error(`no JSON: ${r.stdout}\n${r.stderr}`); } }; return { ...r, json }; };
  const sent = () => readFileSync(log, "utf8");
  // inspect with an explicit member --dir: the exact scope travels; the answer carries the server.
  let r = oats(["inspect", "--server", "build", "--dir", member, "--soul", "dev", "--agents-root", join(member, "agents"), "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  let res = r.json().result; assert.equal(res.server, "build"); assert.equal(res.selected.soul, "dev"); assert.equal(res.scope.context, member);
  assert.match(sent(), new RegExp(`inspect --dir ${member.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")} --soul dev`));
  // inspect --home without --dir: no workspace scope is added; the home is its own context.
  r = oats(["inspect", "--server", "build", "--home", home, "--json"]); assert.equal(r.status, 0, r.stdout + r.stderr);
  const homeLine = sent().split("\n").filter((l) => l.includes("inspect --home")).at(-1);
  assert.ok(homeLine && !homeLine.includes("--dir"), `no --dir added for a home: ${homeLine}`);
  assert.equal(r.json().result.selected.source, "snapshot");
  // A scope command without --dir gets the registered workspace.
  r = oats(["inspect", "--server", "build", "--json"]); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(sent().split("\n").some((l) => l.includes(`inspect --dir ${team}`)), "the registered workspace scopes an unscoped command");
  // use on the member scope, receipt relayed.
  r = oats(["use", "test.notes", "--soul", "dev", "--disable", "--server", "build", "--dir", member, "--json"]); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.json().result.action, "disable"); assert.equal(r.json().result.server, "build");
  assert.match(readFileSync(join(member, "oats-config.yaml"), "utf8"), /dev: false/);
  oats(["use", "test.notes", "--soul", "dev", "--inherit", "--server", "build", "--dir", member, "--json"]);
  // soul set with instructions: the bytes travel on ssh stdin, never the local path.
  const instr = join(base, "local-instructions.md"); writeFileSync(instr, "# remote dev\n\n$(not run) `literal`\n");
  r = oats(["soul", "set", "dev", "--server", "build", "--dir", member, "--model", "opus", "--instructions-file", instr, "--json"]); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.json().result.after.model, "opus"); assert.equal(readFileSync(join(member, "agents", "dev", "soul", "AGENTS.md"), "utf8"), "# remote dev\n\n$(not run) `literal`\n");
  assert.ok(sent().includes("--instructions-stdin") && !sent().includes(instr), "instructions travel as bytes, not as a local path");
  // Clearing the instructions: an empty local file replaces the remote AGENTS.md with nothing (the GUI's empty editor), locally and remotely alike.
  const emptyInstr = join(base, "empty.md"); writeFileSync(emptyInstr, "");
  r = oats(["soul", "set", "dev", "--server", "build", "--dir", member, "--instructions-file", emptyInstr, "--json"]); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(join(member, "agents", "dev", "soul", "AGENTS.md"), "utf8"), ""); assert.equal(r.json().result.instructions.bytes, 0);
  oats(["soul", "set", "dev", "--server", "build", "--dir", member, "--instructions-file", instr, "--json"]);
  assert.equal(readFileSync(join(member, "agents", "dev", "soul", "AGENTS.md"), "utf8"), "# remote dev\n\n$(not run) `literal`\n", "restored");
  // operation run on the home: the provider's documents come back.
  r = oats(["operation", "run", "knowledge:inspect", "--server", "build", "--home", home, "--json"]); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.json().result.result.documents, [{ label: "Memory", kind: "text", text: "remote memory" }]); assert.equal(r.json().result.server, "build");
  // An exact remote home or a saved instance name resolves its FROZEN route: the snapshot's target, even after the registration moved; a home/name disagreement is refused.
  write(join(env.OATS_HOME_DIR, "servers.json"), JSON.stringify({ servers: { build: { sshHost: "moved-host", workspace: team, oatsPath: CLI }, old: { sshHost: "old-host", workspace: team, oatsPath: oldOats } } }));
  r = oats(["inspect", "--server", "build", "--instance", "dev-r1", "--json"]); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.json().result.selected.home, home, "--instance resolved to the saved route's home"); assert.deepEqual(r.json().result.route, { home, instance: "dev-r1", frozen: true });
  const lastHost = sent().split("\n--\n").filter((b) => b.includes("inspect --home")).at(-1);
  assert.ok(lastHost.includes("build-host") && !lastHost.includes("moved-host"), `frozen route target used: ${lastHost}`);
  r = oats(["inspect", "--server", "build", "--json"]); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(sent().split("\n--\n").filter((b) => b.includes(`inspect --dir ${team}`)).at(-1).includes("moved-host"), "a scope request uses the registration");
  assert.equal(oats(["inspect", "--server", "build", "--instance", "dev-r1", "--home", join(team, "elsewhere"), "--json"]).json().error.code, "E_HOME_MISMATCH");
  write(join(env.OATS_HOME_DIR, "servers.json"), JSON.stringify({ servers: { build: { sshHost: "build-host", workspace: team, oatsPath: CLI }, old: { sshHost: "old-host", workspace: team, oatsPath: oldOats } } }));
  // An old remote is refused before anything is sent.
  const before = sent();
  r = oats(["inspect", "--server", "old", "--json"]); assert.equal(r.json().error.code, "E_REMOTE_INCOMPATIBLE"); assert.match(r.json().error.message, /operations contract/);
  assert.equal(sent().split("inspect").length, before.split("inspect").length, "no inspect was sent to the old remote");
});
