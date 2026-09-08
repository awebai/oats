import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-soul-set-")));
test.after(() => rmSync(base, { recursive: true, force: true }));
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
function gitRepo(dir) { mkdirSync(dir, { recursive: true }); execFileSync("git", ["init", "-q", dir]); execFileSync("git", ["-C", dir, "config", "user.email", "t@example.invalid"]); execFileSync("git", ["-C", dir, "config", "user.name", "T"]); write(join(dir, ".gitignore"), "\n"); execFileSync("git", ["-C", dir, "add", "."]); execFileSync("git", ["-C", dir, "commit", "-qm", "init"]); }
const ambient = { OATS_INSTANCE: "other-seat", PI_AGENTS_ROOT: "/elsewhere/agents", OATS_HOME: "/elsewhere/other-seat" };
function oats(args, cwd = base) { const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, OATS_HOME_DIR: join(base, "oats-home"), ...ambient }, cwd }); const json = () => { try { return JSON.parse(r.stdout.trim()); } catch { throw new Error(`no JSON: ${r.stdout}\n${r.stderr}`); } }; return { ...r, json }; }

test("soul set rewrites only the given soul.yaml fields, clears with --no-*, replaces instructions from a file, and refuses packaged souls and bad values", () => {
  const repo = join(base, "r"); gitRepo(repo);
  write(join(repo, "oats-config.yaml"), "capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n  additive:\n    test.tools:\n      from: owned\n      global: true\n");
  const tools = join(repo, ".agents", "capabilities", "owned", "tools");
  write(join(tools, "oats.json"), JSON.stringify({ capability: "test.tools", version: "1.0.0", description: "t", compatibility: { oats: ">=0.6.2" }, agents: ["agents/helper"] }));
  write(join(tools, "agents", "helper", "soul.yaml"), "name: helper\nruntime: claude\n"); write(join(tools, "agents", "helper", "AGENTS.md"), "# helper\n");
  const soulYaml = join(repo, "agents", "dev", "soul", "soul.yaml");
  write(soulYaml, "name: dev\nkind: persistent\n# authored comment stays\nrole: release-coordinator\nrepo: .\nwork: worktree\nruntime: pi\nmodel: gpt\ndescription: old words\nyolo: false\n");
  write(join(repo, "agents", "dev", "soul", "AGENTS.md"), "# dev\n");
  let r = oats(["soul", "set", "dev", "--dir", repo, "--runtime", "claude", "--no-model", "--yolo", "--backend", "herdr", "--description", "new words", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  let rc = r.json().result;
  assert.equal(rc.soul, "dev"); assert.equal(rc.kind, "persistent"); assert.equal(rc.file, soulYaml); assert.deepEqual(rc.changed.sort(), ["backend", "description", "model", "runtime", "yolo"]);
  assert.deepEqual(rc.before, { runtime: "pi", model: "gpt", yolo: false, backend: null, description: "old words", launchConfig: null });
  assert.deepEqual(rc.after, { runtime: "claude", model: null, yolo: true, backend: "herdr", description: "new words" }); assert.equal(rc.instructions, null);
  const text = readFileSync(soulYaml, "utf8");
  assert.equal(text, "name: dev\nkind: persistent\n# authored comment stays\nrole: release-coordinator\nrepo: .\nwork: worktree\nruntime: claude\ndescription: new words\nyolo: true\nbackend: herdr\n", "lines replaced in place, model line removed, unknown keys and comments kept, new key appended");
  // Clearing the description and replacing instructions.
  const instr = join(base, "instructions.md"); writeFileSync(instr, "# dev v2\n\n`literal` $(not run)\n");
  r = oats(["soul", "set", "dev", "--dir", repo, "--no-description", "--instructions-file", instr, "--json"]); rc = r.json().result;
  assert.equal(rc.after.description, null); assert.doesNotMatch(readFileSync(soulYaml, "utf8"), /description:/);
  assert.equal(readFileSync(join(repo, "agents", "dev", "soul", "AGENTS.md"), "utf8"), "# dev v2\n\n`literal` $(not run)\n");
  assert.equal(rc.instructions.after, createHash("sha256").update(readFileSync(instr)).digest("hex")); assert.equal(rc.instructions.before, createHash("sha256").update("# dev\n").digest("hex")); assert.equal(rc.instructions.bytes, readFileSync(instr).length);
  // inspect reads the same file back.
  const seen = oats(["inspect", "--dir", repo, "--soul", "dev", "--json"]).json().result.souls[0];
  assert.equal(seen.runtime, "claude"); assert.equal(seen.backend, "herdr"); assert.equal(seen.description, null); assert.equal(seen.instructions.sha256, rc.instructions.after);
  // Refusals.
  assert.equal(oats(["soul", "set", "helper", "--dir", repo, "--runtime", "pi", "--json"]).json().error.code, "E_SOUL_READONLY");
  assert.equal(oats(["soul", "set", "dev", "--dir", repo, "--json"]).json().error.code, "E_BAD_ARGS", "nothing to set");
  assert.equal(oats(["soul", "set", "dev", "--dir", repo, "--model", "x", "--no-model", "--json"]).json().error.code, "E_BAD_ARGS");
  assert.equal(oats(["soul", "set", "dev", "--dir", repo, "--description", "x", "--no-description", "--json"]).json().error.code, "E_BAD_ARGS");
  assert.equal(oats(["soul", "set", "dev", "--dir", repo, "--runtime", "gemini", "--json"]).json().error.code, "E_BAD_ARGS");
  assert.equal(oats(["soul", "set", "dev", "--dir", repo, "--description", "two\nlines", "--json"]).json().error.code, "unsafe-config-value", "a newline would inject a document: the engine's own typed refusal");
  assert.equal(oats(["soul", "set", "dev", "--dir", repo, "--instructions-file", join(base, "missing.md"), "--json"]).json().error.code, "E_BAD_ARGS");
  assert.equal(oats(["soul", "set", "ghost", "--dir", repo, "--runtime", "pi", "--json"]).json().error.code, "E_SOUL_UNKNOWN");
  assert.equal(oats(["soul", "set", "dev", "--dir", repo, "--agents-root", "/elsewhere/agents", "--runtime", "pi", "--json"]).json().error.code, "E_SOUL_UNKNOWN", "the ambient root never selects; the explicit one is refused when wrong");
  // A local soul is editable too.
  write(join(repo, "local-agents", "scratch", "soul", "soul.yaml"), "name: scratch\nkind: local\nrepo: .\nwork: checkout\nruntime: pi\n"); write(join(repo, "local-agents", "scratch", "soul", "AGENTS.md"), "# s\n");
  rc = oats(["soul", "set", "scratch", "--dir", repo, "--model", "opus", "--json"]).json().result;
  assert.equal(rc.kind, "local"); assert.equal(rc.after.model, "opus");
});
