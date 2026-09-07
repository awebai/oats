import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-use-json-")));
test.after(() => rmSync(base, { recursive: true, force: true }));
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
function gitRepo(dir) { mkdirSync(dir, { recursive: true }); execFileSync("git", ["init", "-q", dir]); execFileSync("git", ["-C", dir, "config", "user.email", "t@example.invalid"]); execFileSync("git", ["-C", dir, "config", "user.name", "T"]); write(join(dir, ".gitignore"), "\n"); execFileSync("git", ["-C", dir, "add", "."]); execFileSync("git", ["-C", dir, "commit", "-qm", "init"]); }
const env = () => { const e = { ...process.env, OATS_HOME_DIR: join(base, "oats-home") }; for (const k of ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT"]) delete e[k]; return e; };
function oats(args, cwd = base) { const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: env(), cwd }); const json = () => { try { return JSON.parse(r.stdout.trim()); } catch { throw new Error(`no JSON: ${r.stdout}\n${r.stderr}`); } }; return { ...r, json }; }
function owned(repo, folder, manifest) { const dir = join(repo, ".agents", "capabilities", "owned", folder); write(join(dir, "oats.json"), JSON.stringify({ version: "1.0.0", description: "t", compatibility: { oats: ">=0.6.2" }, ...manifest })); return dir; }

test("use --json answers receipts for enable, disable, settings, layer none, and --inherit returns a level to inheritance", () => {
  // Outer scope binds the knowledge layer globally; the inner repo overrides for one soul.
  const outer = join(base, "outer"); mkdirSync(outer, { recursive: true });
  const repo = join(outer, "repo"); gitRepo(repo);
  owned(outer, "kb", { capability: "acme.kb", layer: "knowledge" });
  owned(outer, "extra", { capability: "acme.extra" });
  write(join(outer, "oats-config.yaml"), "capabilities:\n  layers:\n    knowledge:\n      capability: acme.kb\n      from: owned\n      global: true\n      settings:\n        tone: dry\n    messaging: none\n    tasks: none\n");
  write(join(repo, "oats-config.yaml"), "name: r\n");
  write(join(repo, "agents", "dev", "soul", "soul.yaml"), "name: dev\nrepo: .\nwork: checkout\nruntime: pi\n");
  write(join(repo, "agents", "dev", "soul", "AGENTS.md"), "# dev\n");
  // Enable additive for the soul, with a setting.
  let r = oats(["use", "acme.extra", "--soul", "dev", "--settings", "mode=fast", "--dir", repo, "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  let rc = r.json().result;
  assert.equal(rc.action, "enable"); assert.equal(rc.capability, "acme.extra"); assert.equal(rc.target, "soul:dev"); assert.equal(rc.level, "repo"); assert.equal(rc.file, join(repo, "oats-config.yaml"));
  assert.deepEqual(rc.before, { bound: false, enabled: null, settings: {} }); assert.equal(rc.after.bound, true); assert.equal(rc.after.enabled, true); assert.deepEqual(rc.after.settings, { mode: "fast" });
  assert.equal(rc.after.effective.enabled, true); assert.deepEqual(rc.missingRequires, []);
  // Existing engine behaviour, reported not changed here: entry-level settings
  // reach instances through the entry's global binding; a soul-only entry
  // carries them in the file (after.settings) without them being effective.
  assert.deepEqual(rc.after.effective.settings, {});
  // Explicit exclusion of the outer knowledge layer for this soul: distinct from inheritance.
  r = oats(["use", "acme.kb", "--soul", "dev", "--disable", "--dir", repo, "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr); rc = r.json().result;
  assert.equal(rc.action, "disable"); assert.equal(rc.layer, "knowledge"); assert.equal(rc.after.enabled, false); assert.equal(rc.after.effective.id, null, "for soul dev the layer now has no provider");
  assert.match(readFileSync(join(repo, "oats-config.yaml"), "utf8"), /knowledge:\n      capability: acme\.kb\n(?:.*\n)*?      souls:\n        dev: false/);
  // --inherit removes ONLY the soul binding; the explicit global:false this level carries stays (the receipt says so), so the entry remains.
  r = oats(["use", "acme.kb", "--soul", "dev", "--inherit", "--dir", repo, "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr); rc = r.json().result;
  assert.equal(rc.action, "inherit"); assert.equal(rc.entryRemoved, false); assert.deepEqual(rc.before, { bound: true, enabled: false, settings: {} }); assert.equal(rc.after.bound, false);
  assert.deepEqual(rc.remaining, ["global: false"]); assert.match(rc.note, /--inherit --global/);
  assert.equal(rc.after.effective.id, null, "the level's explicit global exclusion still applies to dev");
  assert.equal(oats(["use", "acme.kb", "--soul", "dev", "--inherit", "--dir", repo, "--json"]).json().error.code, "E_NOT_BOUND");
  // Removing the remaining global binding removes the entry; the outer global applies again.
  r = oats(["use", "acme.kb", "--global", "--inherit", "--dir", repo, "--json"]); rc = r.json().result;
  assert.equal(rc.entryRemoved, true); assert.deepEqual(rc.remaining, []); assert.equal(rc.after.effective.id, "acme.kb"); assert.match(rc.after.effective.provenance, /global @/);
  assert.doesNotMatch(readFileSync(join(repo, "oats-config.yaml"), "utf8"), /acme\.kb/);
  // A layer none is a level statement: no soul or type target.
  assert.equal(oats(["use", "none", "--layer", "knowledge", "--soul", "dev", "--dir", repo, "--json"]).json().error.code, "E_BAD_ARGS");
  assert.doesNotMatch(readFileSync(join(repo, "oats-config.yaml"), "utf8"), /knowledge: none/);
  // Another provider for a bound layer is refused, even as an exclusion, with the exact remedy.
  owned(outer, "kb2", { capability: "acme.kb2", layer: "knowledge" });
  oats(["use", "acme.kb", "--global", "--dir", repo, "--json"]);
  for (const extra of [[], ["--disable"], ["--soul", "dev", "--disable"]]) {
    const e = oats(["use", "acme.kb2", ...extra, "--dir", repo, "--json"]).json().error;
    assert.equal(e.code, "E_LAYER_BOUND"); assert.match(e.message, /oats use acme\.kb --inherit --global/); assert.match(e.message, /oats use none --layer knowledge/);
  }
  assert.match(readFileSync(join(repo, "oats-config.yaml"), "utf8"), /capability: acme\.kb\n/, "the bound entry is untouched");
  oats(["use", "acme.kb", "--global", "--inherit", "--dir", repo, "--json"]);
  // --inherit on a soul target keeps the entry when another target remains.
  oats(["use", "acme.extra", "--global", "--dir", repo, "--json"]);
  r = oats(["use", "acme.extra", "--soul", "dev", "--inherit", "--dir", repo, "--json"]); rc = r.json().result;
  assert.equal(rc.entryRemoved, false); assert.deepEqual(rc.after.settings, { mode: "fast" }, "settings stay with the entry that remains");
  assert.match(readFileSync(join(repo, "oats-config.yaml"), "utf8"), /acme\.extra:\n(?:.*\n)*?      global: true/);
  // Layer none and its inheritance.
  r = oats(["use", "none", "--layer", "messaging", "--dir", repo, "--json"]); rc = r.json().result;
  assert.equal(rc.action, "layer-none"); assert.equal(rc.after.layer, "none"); assert.equal(rc.after.effective.disabled, true);
  r = oats(["use", "none", "--layer", "messaging", "--inherit", "--dir", repo, "--json"]); rc = r.json().result;
  assert.equal(rc.action, "inherit"); assert.equal(rc.before.layer, "none"); assert.equal(rc.after.effective.disabled, true, "the outer scope still says none");
  assert.equal(oats(["use", "none", "--layer", "messaging", "--inherit", "--dir", repo, "--json"]).json().error.code, "E_NOT_BOUND");
  // Error codes in JSON mode.
  assert.equal(oats(["use", "acme.nope", "--dir", repo, "--json"]).json().error.code, "E_UNKNOWN_CAPABILITY");
  assert.equal(oats(["use", "acme.kb", "--layer", "tasks", "--dir", repo, "--json"]).json().error.code, "E_LAYER_MISMATCH");
  assert.equal(oats(["use", "acme.kb", "--global", "--soul", "dev", "--dir", repo, "--json"]).json().error.code, "E_BAD_ARGS");
  assert.equal(oats(["use", "acme.kb", "--inherit", "--disable", "--dir", repo, "--json"]).json().error.code, "E_BAD_ARGS");
  assert.equal(oats(["use", "--dir", repo, "--json"]).json().error.code, "E_USAGE");
  // Text mode still prints the historical lines.
  const t = oats(["use", "acme.extra", "--type", "reviewers", "--dir", repo]);
  assert.equal(t.status, 0, t.stderr); assert.match(t.stdout, /Activated acme\.extra for type reviewers at repo level/); assert.match(t.stdout, /New instances receive the resolved capability/);
});
