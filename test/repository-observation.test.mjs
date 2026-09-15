import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRepositoryTransaction } from "../lib/repository-observation.mjs";

const origin = { kind: "operator", document: { kind: "operator", id: "source-request" }, pointer: "/source" };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oats-repository-observation-")), repo = join(root, "upstream"), marker = join(root, "executed");
  const transactions = [];
  t.after(() => { for (const transaction of transactions.reverse()) transaction.close(); rmSync(root, { recursive: true, force: true }); });
  mkdirSync(repo); mkdirSync(join(repo, "agents/expert"), { recursive: true });
  const config = join(root, "gitconfig");
  writeFileSync(config, '[filter "must-not-run"]\n smudge = "sh -c \'echo invoked > \\\"$OATS_SOURCE_EXEC_MARKER\\\"; cat\'"\n');
  const environment = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", OATS_SOURCE_EXEC_MARKER: marker };
  for (const key of Object.keys(environment)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG_COUNT|CONFIG_KEY_|CONFIG_VALUE_)/.test(key)) delete environment[key];
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--quiet", "--initial-branch=topic"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  git("config", "uploadpack.allowFilter", "true"); git("config", "uploadpack.allowAnySHA1InWant", "true");
  writeFileSync(join(repo, "agents/expert/soul.yaml"), "schemaVersion: 1\nname: expert\n");
  writeFileSync(join(repo, "agents/expert/AGENTS.md"), "Revision A\n"); symlinkSync("AGENTS.md", join(repo, "agents/expert/CLAUDE.md"));
  writeFileSync(join(repo, "agents/expert/run.mjs"), "throw new Error('must not execute');\n", { mode: 0o755 });
  writeFileSync(join(repo, ".gitattributes"), "*.mjs filter=must-not-run\n");
  const commit = () => { git("add", "."); git("commit", "--quiet", "-m", "fixture"); return git("rev-parse", "HEAD"); };
  const head = commit(), source = "git:https://example.invalid/repository.git", aliasSource = "git:ssh://git@example.invalid/repository";
  // Public, canonical locators with an explicit fixture-only native transport
  // mapping. Do not relax portable identity grammar to admit local file URLs.
  for (const remote of [source.slice(4), aliasSource.slice(4)]) git("config", "--file", config, "--add", `url.${pathToFileURL(repo).href}.insteadOf`, remote);
  const transaction = (extra = {}) => {
    const value = createRepositoryTransaction({ directory: root, accessContextKey: "fixture-account", environment, allowLocalGit: true, ...extra });
    transactions.push(value); return value;
  };
  return { root, repo, head, source, aliasSource, marker, commit, transaction };
}

test("real Git observes the actual default branch once and materializes exact source bytes without checkout filters", (t) => {
  const f = fixture(t), tx = f.transaction(), first = tx.observe(f.source, { origin });
  assert.equal(first.source.selector, "topic"); assert.equal(first.source.commit, f.head);
  const definition = tx.readFile(first, "agents/expert/soul.yaml");
  assert.equal(definition.origin.revision, f.head);
  writeFileSync(join(f.repo, "agents/expert/AGENTS.md"), "Revision B\n"); f.commit();
  const named = tx.observe(f.source, { revision: "topic", origin });
  assert.equal(named.source.commit, f.head, "resolved default and explicit same selector share one snapshot");
  const destination = join(f.root, "projection");
  tx.materialize(named, ["agents/expert"], destination);
  assert.equal(readFileSync(join(destination, "agents/expert/AGENTS.md"), "utf8"), "Revision A\n");
  assert.equal(readlinkSync(join(destination, "agents/expert/CLAUDE.md")), "AGENTS.md");
  assert.equal(lstatSync(join(destination, "agents/expert/run.mjs")).mode & 0o100, 0o100);
  assert.equal(existsSync(join(destination, ".git")), false);
  assert.equal(existsSync(f.marker), false);
  tx.close();
  assert.equal(readFileSync(join(destination, "agents/expert/AGENTS.md"), "utf8"), "Revision A\n");
  assert.throws(() => tx.readFile(first, "agents/expert/soul.yaml"), { code: "source-unavailable" });
});

test("qualified identity unifies transport aliases and rejects changed or fabricated observations", (t) => {
  const f = fixture(t);
  const identity = { kind: "provider-repository", provider: "fixture", host: "example.invalid", id: "1" };
  const tx = f.transaction({ identityReader: () => ({ identity, defaultBranch: "topic" }) });
  const first = tx.observe(f.source, { revision: "topic", origin });
  writeFileSync(join(f.repo, "agents/expert/AGENTS.md"), "Revision B\n"); f.commit();
  const second = tx.observe(f.aliasSource, { revision: "topic", origin });
  assert.equal(second.source.commit, first.source.commit);
  assert.notEqual(second.source.remote, first.source.remote);
  assert.throws(() => tx.observe(f.source, { revision: "topic", origin, expectedIdentity: { ...identity, id: "2" } }), { code: "source-identity-change" });
  assert.throws(() => tx.readFile(structuredClone(first), "agents/expert/soul.yaml"), { code: "invalid-source" });
  assert.equal(tx.readFile(first, "not-present.yaml", { optional: true }), null);
});

test("source reads enforce byte budgets and projection refuses escaping links", (t) => {
  const f = fixture(t), bounded = f.transaction({ maxBytes: 8 }), small = bounded.observe(f.source, { origin });
  assert.throws(() => bounded.readFile(small, "agents/expert/soul.yaml"), { code: "resource-limit" });
  symlinkSync("../../../outside", join(f.repo, "agents/expert/escape")); f.commit();
  const tx = f.transaction(), observation = tx.observe(f.source, { origin });
  assert.throws(() => tx.materialize(observation, ["agents/expert"], join(f.root, "unsafe")), { code: "artifact-not-contained" });
});
