import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadCapturedDispatch, prepareCapturedComposition, scaffoldCapturedInstance } from "../lib/core.mjs";
import { readCapturedResolution } from "../lib/captured-resolutions.mjs";
import { canonicalJson } from "../lib/portable-values.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const BEFORE = "9e922fc079f03055aa171ef1c1f49452717fb95e";
const OLD = "oats-portable-setup", CURRENT = "oats-soul-setup";
function scratch(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oats-soul-setup-rename-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function write(file, value) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value)); }
function gitAt(cwd, args, env = process.env) { return execFileSync("git", args, { cwd, env, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }); }

// This one old-name producer uses EXACT approved pre-rename source. It is an
// isolated package archive, not another Git worktree, old matrix or live runtime.
function previousKernel(root) {
  assert.equal(gitAt(ROOT, ["rev-parse", `${BEFORE}^{commit}`]).toString().trim(), BEFORE);
  assert.deepEqual(gitAt(ROOT, ["show", `${BEFORE}:package-lock.json`]), readFileSync(join(ROOT, "package-lock.json")), "only identical locked local dependencies may be reused");
  const directory = join(root, "previous-kernel"), archive = join(root, "previous.tar"); mkdirSync(directory);
  gitAt(ROOT, ["archive", "--format=tar", `--output=${archive}`, BEFORE,
    "lib", "bin", "skills", "injects", "packages/record", "package.json", "package-lock.json", "package-catalog.json"]);
  execFileSync("tar", ["-xf", archive, "-C", directory]);
  symlinkSync(realpathSync(join(ROOT, "node_modules")), join(directory, "node_modules"), "dir");
  return directory;
}

test("Soul Setup is one renamed shipped procedure, without an active old-name alias or unshipped inspection flow", t => {
  const root = scratch(t), file = join(ROOT, "skills", CURRENT, "SKILL.md");
  assert.equal(existsSync(join(ROOT, "skills", OLD)), false);
  const text = readFileSync(file, "utf8");
  assert.match(text, /^---\nname: oats-soul-setup\n/);
  assert.match(text, /# OATS Soul Setup/);
  assert.match(text, /oats prepare --request/);
  assert.match(text, /oats session start/);
  assert.ok(!text.includes("inspect --request"), "parked proposal is not advertised as available");
  const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: ROOT, encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, npm_config_cache: join(root, "npm-cache"), npm_config_update_notifier: "false" },
  }));
  const entries = packed[0].files.map(value => value.path);
  assert.equal(entries.filter(path => path === `skills/${CURRENT}/SKILL.md`).length, 1);
  assert.equal(entries.some(path => path.startsWith(`skills/${OLD}/`)), false);
});

test("new preparation uses Soul Setup while the actual old-name retained capture and home still replay unchanged", t => {
  const root = scratch(t), previous = previousKernel(root), repo = join(root, "source"), deployment = join(root, "deployment"), user = join(root, "operator");
  for (const path of [repo, deployment, user]) mkdirSync(path);
  const config = join(user, "gitconfig"); write(config, "[commit]\n  gpgsign = false\n");
  const env = { PATH: process.env.PATH, HOME: user, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args) => gitAt(repo, args, env).toString().trim();
  git("init", "--quiet", "--initial-branch=fixture"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  git("config", "uploadpack.allowFilter", "true"); git("config", "uploadpack.allowAnySHA1InWant", "true");
  const source = "git:https://rename.invalid/source.git";
  git("config", "--file", config, `url.${pathToFileURL(repo).href}.insteadOf`, source.slice(4));
  write(join(repo, "oats.yaml"), { schemaVersion: 1, exports: { souls: [{ path: "souls/example", definition: "souls/example/soul.yaml" }] } });
  write(join(repo, "souls/example/soul.yaml"), { schemaVersion: 1, name: "example", work: "directory" });
  write(join(repo, "souls/example/AGENTS.md"), "# Retained example\n"); symlinkSync("AGENTS.md", join(repo, "souls/example/CLAUDE.md"));
  git("add", "."); git("commit", "--quiet", "-m", "old and new name use the same source");
  const input = { deployment, source: { source, revision: git("rev-parse", "HEAD"), soul: "souls/example", alias: "example" }, standaloneContextKey: null };
  const home = join(root, "old-home"), script = `import {prepareCapturedComposition,scaffoldCapturedInstance} from ${JSON.stringify(pathToFileURL(join(previous, "lib/core.mjs")).href)};
const input=${JSON.stringify(input)};const result=prepareCapturedComposition(input,{repositoryOptions:{environment:process.env,allowLocalGit:true}});
scaffoldCapturedInstance({deployment:input.deployment,resolution:result.resolution,home:${JSON.stringify(home)},instance:'old-home'});
console.log(JSON.stringify(result));`;
  const old = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: root, env, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 }));
  const oldRecord = readCapturedResolution(deployment, old.resolution), oldBytes = canonicalJson(oldRecord);
  const oldSkill = oldRecord.dispatch.composition.skills.find(value => value.name === OLD);
  assert.ok(oldSkill); assert.equal(oldRecord.resources[oldSkill.resource].path, `skills/${OLD}`);
  const oldHomeFiles = ["instance.json", "AGENTS.md", `.agents/skills/${OLD}/SKILL.md`].map(path => [path, readFileSync(join(home, path))]);
  const current = prepareCapturedComposition(input, { repositoryOptions: { environment: env, allowLocalGit: true } });
  const currentRecord = readCapturedResolution(deployment, current.resolution);
  assert.equal(currentRecord.dispatch.composition.skills.some(value => value.name === CURRENT), true);
  assert.equal(currentRecord.dispatch.composition.skills.some(value => value.name === OLD), false);
  assert.notEqual(current.resolution.id, old.resolution.id, "a new resource capture is not an old-record rewrite");
  rmSync(previous, { recursive: true }); rmSync(repo, { recursive: true }); // Owned fixture sources only, not deployment artifacts.
  const loaded = loadCapturedDispatch({ deployment, resolution: old.resolution, action: { kind: "compose" } });
  assert.equal(loaded.composition.skills.some(value => value.name === OLD), true);
  assert.equal(loaded.composition.skills.some(value => value.name === CURRENT), false);
  assert.match(readFileSync(join(loaded.composition.skills.find(value => value.name === OLD).path, "SKILL.md"), "utf8"), /^---\nname: oats-portable-setup\n/);
  const replayHome = join(root, "old-record-new-home");
  scaffoldCapturedInstance({ deployment, resolution: old.resolution, home: replayHome, instance: "old-record-new-home" });
  assert.equal(existsSync(join(replayHome, ".agents/skills", OLD, "SKILL.md")), true);
  assert.equal(existsSync(join(replayHome, ".agents/skills", CURRENT)), false);
  const newHome = join(root, "new-name-home");
  scaffoldCapturedInstance({ deployment, resolution: current.resolution, home: newHome, instance: "new-name-home" });
  assert.equal(existsSync(join(newHome, ".agents/skills", CURRENT, "SKILL.md")), true);
  assert.equal(existsSync(join(newHome, ".agents/skills", OLD)), false);
  assert.equal(canonicalJson(readCapturedResolution(deployment, old.resolution)), oldBytes);
  for (const [path, bytes] of oldHomeFiles) assert.deepEqual(readFileSync(join(home, path)), bytes, "existing retained home stays byte-identical");
});
