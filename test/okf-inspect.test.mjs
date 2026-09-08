import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { cpSync as copyTree } from "node:fs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const CLI = join(ROOT, "bin", "oats.mjs");
const OKF = join(ROOT, "capabilities", "oats-okf");
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-okf-inspect-")));
test.after(() => rmSync(base, { recursive: true, force: true }));
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
function gitRepo(dir) { mkdirSync(dir, { recursive: true }); execFileSync("git", ["init", "-q", dir]); execFileSync("git", ["-C", dir, "config", "user.email", "t@example.invalid"]); execFileSync("git", ["-C", dir, "config", "user.name", "T"]); write(join(dir, ".gitignore"), "\n"); execFileSync("git", ["-C", dir, "add", "."]); execFileSync("git", ["-C", dir, "commit", "-qm", "init"]); }
const env = () => { const e = { ...process.env, OATS_HOME_DIR: join(base, "oats-home") }; for (const k of ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "OATS_EVENT", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT"]) delete e[k]; return e; };

test("the OKF package declares inspect (view) and harvest (action); its inspect answers the home's working memory as documents, directly and through oats operation run", () => {
  const manifest = JSON.parse(readFileSync(join(OKF, "oats.json"), "utf8"));
  assert.equal(manifest.version, JSON.parse(readFileSync(join(ROOT, "package-catalog.json"), "utf8")).packages["oats.okf"].ref.replace(/^v/, ""));
  assert.deepEqual(Object.keys(manifest.operations).sort(), ["harvest", "inspect"]);
  assert.equal(manifest.operations.inspect.kind, "view"); assert.equal(manifest.operations.harvest.kind, "action"); assert.equal(manifest.commands.inspect, "bin/oats-okf.mjs inspect");
  // A home with state, log and two notes.
  const repo = join(base, "repo"); gitRepo(repo);
  const home = join(repo, "agents", "dev", "instances", "dev-one");
  write(join(home, "instance.json"), JSON.stringify({ agent: "dev", instance: "dev-one", home, repo, launched: false, capabilities: [{ id: "oats.okf", level: repo, settings: {} }], layers: {} }));
  write(join(home, "STATE.md"), "# state\n\nworking\n"); write(join(home, "log.md"), "# log\n"); write(join(home, "notes", "b.md"), "note b\n"); write(join(home, "notes", "a.md"), "note a\n"); write(join(home, "notes", "skip.txt"), "x");
  // Directly, as the kernel runs it (OATS_HOME = the home).
  let r = spawnSync(process.execPath, [join(OKF, "bin", "oats-okf.mjs"), "inspect", "--json"], { encoding: "utf8", env: { ...env(), OATS_HOME: home }, cwd: home });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  let out = JSON.parse(r.stdout.trim()); assert.equal(out.ok, true);
  assert.deepEqual(out.result.documents.map((d) => [d.label, d.kind, d.path]), [["Working state (STATE.md)", "markdown", join(home, "STATE.md")], ["Log (log.md)", "markdown", join(home, "log.md")], ["Pending note: a.md", "markdown", join(home, "notes", "a.md")], ["Pending note: b.md", "markdown", join(home, "notes", "b.md")]]);
  assert.equal(out.result.documents[0].text, "# state\n\nworking\n"); assert.match(out.result.summary, /4 documents: state, log, 2 pending notes/);
  // Through the kernel's generic operation runner, with the bundled package installed as an owned capability in the fixture.
  copyTree(OKF, join(repo, ".agents", "capabilities", "owned", "okf"), { recursive: true });
  write(join(repo, "oats-config.yaml"), "capabilities:\n  layers:\n    knowledge:\n      capability: oats.okf\n      from: owned\n      global: true\n    messaging: none\n    tasks: none\n");
  write(join(repo, "agents", "dev", "soul", "soul.yaml"), "name: dev\nrepo: .\nwork: checkout\nruntime: pi\n"); write(join(repo, "agents", "dev", "soul", "AGENTS.md"), "# dev\n");
  r = spawnSync(process.execPath, [CLI, "inspect", "--home", home, "--json"], { encoding: "utf8", env: env(), cwd: base });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const ins = JSON.parse(r.stdout.trim()).result;
  assert.equal(ins.knowledge.provider, "oats.okf"); assert.deepEqual(ins.knowledge.operations.map((o) => [o.name, o.kind, o.available]).sort(), [["harvest", "action", true], ["inspect", "view", true]]);
  r = spawnSync(process.execPath, [CLI, "operation", "run", "knowledge:inspect", "--home", home, "--json"], { encoding: "utf8", env: env(), cwd: base });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  out = JSON.parse(r.stdout.trim()).result;
  assert.equal(out.capability, "oats.okf"); assert.deepEqual(out.argv, ["okf", "inspect"]); assert.equal(out.result.documents.length, 4); assert.equal(out.instance, undefined, "a view launches nothing");
  // An empty home answers no documents and says so.
  const empty = join(repo, "agents", "dev", "instances", "dev-two"); write(join(empty, "instance.json"), JSON.stringify({ agent: "dev", instance: "dev-two", home: empty, repo, launched: false, capabilities: [{ id: "oats.okf", level: repo, settings: {} }], layers: {} }));
  r = spawnSync(process.execPath, [CLI, "operation", "run", "knowledge:inspect", "--home", empty, "--json"], { encoding: "utf8", env: env(), cwd: base });
  assert.equal(r.status, 0, r.stdout + r.stderr); out = JSON.parse(r.stdout.trim()).result; assert.deepEqual(out.result.documents, []); assert.match(out.result.summary, /no working memory/);
});

test("a view larger than a pipe buffer arrives whole: the provider's answer through an actual pipe, directly and through oats operation run", () => {
  // The first test installed the bundled package as an owned capability in
  // `repo`; this home carries a STATE.md bigger than the 64 KiB a macOS pipe
  // holds while the writer exits (BeadHub's reproduction of the 1.6.0 defect:
  // exactly 65536 bytes, invalid JSON, exit 0).
  const repo = join(base, "repo");
  const home = join(repo, "agents", "dev", "instances", "dev-big");
  write(join(home, "instance.json"), JSON.stringify({ agent: "dev", instance: "dev-big", home, repo, launched: false, capabilities: [{ id: "oats.okf", level: repo, settings: {} }], layers: {} }));
  const state = "# state\n\n" + "a line of working state that repeats until the document is long enough to matter\n".repeat(2500);
  assert.ok(Buffer.byteLength(state) > 128 * 1024 && Buffer.byteLength(state) < 256 * 1024, "over one pipe buffer, under the provider's own cap");
  write(join(home, "STATE.md"), state); write(join(home, "log.md"), "# log\n");
  // Directly, stdout a pipe (spawnSync's default), as the kernel and a Desktop read it.
  let r = spawnSync(process.execPath, [join(OKF, "bin", "oats-okf.mjs"), "inspect", "--json"], { encoding: "utf8", env: { ...env(), OATS_HOME: home }, cwd: home, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(Buffer.byteLength(r.stdout) > 128 * 1024, `whole answer left the pipe (${Buffer.byteLength(r.stdout)} bytes)`);
  let out = JSON.parse(r.stdout.trim()); assert.equal(out.ok, true);
  assert.equal(out.result.documents[0].text, state, "STATE.md text is byte-exact"); assert.equal(out.result.documents[0].truncated, undefined);
  // Through the kernel's generic runner into a JSON envelope on ITS stdout (a second pipe).
  r = spawnSync(process.execPath, [CLI, "operation", "run", "knowledge:inspect", "--home", home, "--json"], { encoding: "utf8", env: env(), cwd: base, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stdout.slice(0, 500) + r.stderr);
  out = JSON.parse(r.stdout.trim()); assert.equal(out.ok, true, String(JSON.stringify(out.error ?? null)).slice(0, 300));
  assert.equal(out.result.result.documents[0].text, state, "the runner relays the whole document");
  assert.match(out.result.result.summary, /2 documents: state, log, 0 pending notes/);
});
