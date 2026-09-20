import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv from "ajv";
import { parseMemberExports, parseWorkspaceDefinition } from "../lib/workspace-definition.mjs";
import { parsePortableSoul } from "../lib/portable-soul.mjs";
import { parseRepositorySource } from "../lib/source-spec.mjs";
import { bytesIntegrity } from "../lib/portable-digest.mjs";
import { planSoftwareChoices } from "../lib/portable-composition.mjs";
import { createRepositoryTransaction } from "../lib/repository-observation.mjs";
import { createWorkspaceDiscovery } from "../lib/workspace-discovery.mjs";
import { normalizeKnowledgeDeclaration } from "../capabilities/oats-okf/lib/portable-binding.mjs";
import { parseConfigData } from "../lib/config-data.mjs";

const EDITIONS = [
  ["oats-expert", "c448f593-9b2d-4c48-a679-1c468bda5beb", ["git-tag-release", "pr-review"]],
  ["oats-kernel-expert", "4f532e2d-72f6-4dd0-9743-c9eeab2809ba", []],
  ["oats-desktop-expert", "76085278-3874-4382-9f7a-f11de3dbceb4", ["accessible-desktop-interactions", "electron-live-verification"]],
  ["market-research-expert", "2a073e37-2114-474d-917d-29cf3333932f", ["sourced-market-research"]],
  ["oats-assistant", "2dab92c7-701d-4101-bc7f-09acf4fc374e", ["oats-onboarding"]],
];
// The bootstrap edition is exported separately; the workspace still imports
// only the five published expertise editions until the maintainer pins it.
const EXPORTED_NAMES = [...EDITIONS.map(([name]) => name), "oats-setup-expert"];
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE = "git:github.com/awebai/oats", EXPORT = "souls/oats-expert";
const origin = { kind: "operator", document: { kind: "operator", id: "workspace-layout-test" }, pointer: "/source" };
const bytes = path => readFileSync(join(ROOT, path));
const workspace = () => parseWorkspaceDefinition(bytes("oats-workspace.yaml"));
const index = () => parseMemberExports(bytes("oats.yaml"));
// Editions declare `repo:oats-package`, so they are parsed as a repository document
// (the production discovery path), never as an operator input without a snapshot.
const sourceDocument = (name) => ({ kind: "source", source: parseRepositorySource(SOURCE).normalized, revision: "0".repeat(40), path: `souls/${name}/soul.yaml`, integrity: bytesIntegrity(bytes(`souls/${name}/soul.yaml`)) });
const soul = (name = "oats-expert") => parsePortableSoul(bytes(`souls/${name}/soul.yaml`), { origin: sourceDocument(name) });

// Actual native Git and the production discovery/projection path, with public
// locators mapped to isolated local repositories. These member fixture indexes
// model the proposed reciprocal graph, NOT publication of the six real repos.
function fixture(t) {
  const parent = join(ROOT, ".agents", "workspace-p1"); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "layout-test-")), config = join(root, "gitconfig");
  writeFileSync(config, "[protocol]\n allow = never\n");
  const home = join(root, "home"); mkdirSync(home);
  const env = { PATH: process.env.PATH, HOME: home, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0" };
  const git = (repo, ...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-C", repo, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (path, content) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };
  const commit = repo => { git(repo, "add", "."); git(repo, "commit", "--quiet", "-m", "Isolated declaration fixture"); return git(repo, "rev-parse", "HEAD"); };
  const repos = new Map(), transactions = [];
  t.after(() => { for (const tx of transactions.reverse()) tx.close(); rmSync(root, { recursive: true, force: true }); });
  for (const [n, member] of workspace().members.entries()) {
    const repo = join(root, `repo-${n}`); mkdirSync(repo);
    git(repo, "init", "--quiet", "--initial-branch=fixture-default");
    git(repo, "config", "user.name", "Workspace fixture"); git(repo, "config", "user.email", "workspace@example.invalid");
    git(repo, "config", "uploadpack.allowFilter", "true"); git(repo, "config", "uploadpack.allowAnySHA1InWant", "true");
    if (n === 0) {
      for (const name of ["oats.yaml", "oats-workspace.yaml"]) write(join(repo, name), bytes(name));
      for (const name of EXPORTED_NAMES) cpSync(join(ROOT, "souls", name), join(repo, "souls", name), { recursive: true, verbatimSymlinks: true });
      // Every edition declares oats.core from this repository's own oats-package payload.
      cpSync(join(ROOT, "oats-package"), join(repo, "oats-package"), { recursive: true, verbatimSymlinks: true, filter: (src) => !src.includes("/node_modules") });
    } else {
      write(join(repo, "oats.yaml"), JSON.stringify({ schemaVersion: 1, workspace: { source: SOURCE }, exports: { packages: [{ path: "oats-package" }] } }));
    }
    commit(repo); repos.set(member.source, repo);
    git(repo, "config", "--file", config, "--add", `url.${pathToFileURL(repo).href}.insteadOf`, parseRepositorySource(member.source).url);
  }
  const transaction = () => {
    const tx = createRepositoryTransaction({ directory: root, accessContextKey: "owned-layout-fixture", environment: env, allowLocalGit: true,
      identityReader: repository => ({ identity: { kind: "canonical-remote", remote: repository.normalized }, defaultBranch: "fixture-default" }) });
    transactions.push(tx); return tx;
  };
  return { root, repos, framework: repos.get(parseRepositorySource(SOURCE).normalized), git, commit, write, transaction };
}

test("workspace metadata has explicit reciprocal candidates and only existing package/source exports", () => {
  const ws = workspace(), member = index();
  assert.deepEqual(ws.members.map(m => m.source), ["oats", "oats-dev", "oats-okf", "oats-aweb", "oats-authoring", "oats-jira", "oats-linear"].map(name => `git:https://github.com/awebai/${name}.git`));
  assert.ok(ws.members.every(m => !Object.hasOwn(m, "revision")), "observe host defaults, never guess main or future commits");
  // Stage two: the five editions are published, so the workspace pins each import to the exact
  // reviewed commit that exported them with explicit oats.core. Full SHA, same repository, one alias each.
  assert.deepEqual(ws.imports.map(i => [i.soul, i.alias]), EDITIONS.map(([name]) => [`souls/${name}`, name]));
  for (const item of ws.imports) {
    assert.equal(item.source, parseRepositorySource(SOURCE).normalized);
    assert.match(item.revision, /^[a-f0-9]{40}$/, "import revision is an immutable commit, not a branch");
    assert.equal(execFileSync("git", ["-C", ROOT, "cat-file", "-t", item.revision], { encoding: "utf8" }).trim(), "commit");
  }
  assert.deepEqual({ ...ws.declaration.defaults }, { tasks: "none" });
  assert.equal(member.workspace.source, ws.members[0].source);
  assert.equal(Object.hasOwn(member.workspace, "revision"), false);
  assert.deepEqual(member.exports.souls.map(s => [s.path, s.definition]), EXPORTED_NAMES.map(name => [`souls/${name}`, `souls/${name}/soul.yaml`]));
  assert.deepEqual(member.exports.packages.map(p => p.path), ["oats-package", "capabilities/oats-authoring"]);
  for (const entry of member.exports.packages) assert.ok(lstatSync(join(ROOT, entry.path, "oats-package.json")).isFile());
  for (const declaration of [ws.declaration, member.exports]) assert.equal(Object.hasOwn(declaration, "knowledge"), false, "phase2 corpus is not advertised");
  assert.equal(Object.hasOwn(ws.declaration, "teams"), false, "no private team identity invented");
  const ajv = new Ajv({ strict: true, ownProperties: true });
  for (const name of ["soul", "oats-workspace", "oats-member"]) ajv.addSchema(JSON.parse(bytes(`docs/${name}.schema.json`)));
  for (const [uri, value] of [...EXPORTED_NAMES.map(name => ["soul", soul(name).declaration]), ["workspace", ws.declaration], ["member", member.declaration]]) {
    const validate = ajv.getSchema(`https://oats.dev/schemas/${uri}-v1.json`);
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
  }
});

test("transitional role preserves external owner/read routing and hard knowledge plus messaging requirements", () => {
  const parsed = soul(), declaration = parsed.declaration;
  assert.equal(declaration.name, "oats-expert"); assert.equal(declaration.work, "directory");
  assert.deepEqual(JSON.parse(JSON.stringify(declaration.requires)), {
    capabilities: { "oats.core": { source: "repo:oats-package" } },
    knowledge: { capability: "oats.okf", source: "git:github.com/awebai/oats-okf@v2.1.1#oats-package" },
    messaging: { capability: "oats.aweb", source: "git:github.com/awebai/oats-aweb@v1.10.3#oats-package" },
  });
  const model = normalizeKnowledgeDeclaration(declaration.knowledge, { origins: parsed.origins, origin });
  assert.equal(model.owner, "c448f593-9b2d-4c48-a679-1c468bda5beb");
  assert.deepEqual(model.owns.map(n => [n.node, n.destination]), [["oats-expert", "oats"]]);
  assert.deepEqual(model.reads.map(n => [n.store, n.node]), ["oats-kernel-expert", "oats-desktop-expert", "market-research-expert", "oats-assistant"].map(node => ["oats", node]));
  assert.deepEqual(model.requirements.map(r => [r.key, r.kind]), [["/bindings/knowledge/stores/oats", "required"]]);
  assert.deepEqual(model.candidates, [], "operator fixture/store is required, not a publisher writer default");
  const identity = { kind: "git-soul", repository: { kind: "canonical-remote", remote: parseRepositorySource(SOURCE).normalized }, exportPath: EXPORT };
  for (const slot of ["knowledge", "messaging"]) {
    const plan = planSoftwareChoices({ identity, soul: parsed, operator: { document: origin.document, policy: { [slot]: "none" } } });
    assert.notEqual(plan.status, "resolved", `${slot} cannot be silently disabled`);
  }
  for (const absent of ["knowledge", "okf.json", "instances", "work", "STATE.md", "log.md"]) assert.equal(existsSync(join(ROOT, EXPORT, absent)), false);
  assert.equal(readlinkSync(join(ROOT, EXPORT, "CLAUDE.md")), "AGENTS.md");
  assert.equal(lstatSync(join(ROOT, EXPORT, "AGENTS.md")).isFile(), true);
  assert.doesNotMatch(bytes(`${EXPORT}/AGENTS.md`).toString(), /oats-portable-setup/, "no dangling promise of the human-removed setup skill");
  assert.deepEqual(readdirSync(join(ROOT, EXPORT, "skills")).sort(), ["git-tag-release", "pr-review"]);
  assert.ok(bytes(`${EXPORT}/skills/pr-review/references/reviewed-delivery.md`).length > 0);
});

test("five expert editions preserve owners, own-node/four-read routing and contained current skill references", () => {
  for (const [name, owner, privateSkills] of EDITIONS) {
    const root = join(ROOT, "souls", name), parsed = soul(name), d = parsed.declaration;
    assert.equal(d.name, name); assert.equal(d.work, "directory");
    assert.deepEqual(JSON.parse(JSON.stringify(d.requires.knowledge)), { capability: "oats.okf", source: "git:github.com/awebai/oats-okf@v2.1.1#oats-package" });
    assert.deepEqual(JSON.parse(JSON.stringify(d.requires.messaging)), { capability: "oats.aweb", source: "git:github.com/awebai/oats-aweb@v1.10.3#oats-package" });
    assert.equal(d.defaults.tasks, "none");
    assert.deepEqual(JSON.parse(JSON.stringify(d.requires.capabilities)), { "oats.core": { source: "repo:oats-package" } }, "explicit, removable day-to-day capability from this repository's payload");
    const model = normalizeKnowledgeDeclaration(d.knowledge, { origins: parsed.origins, origin });
    assert.equal(model.owner, owner);
    assert.deepEqual(model.owns.map(n => [n.node, n.destination]), [[name, "oats"]]);
    assert.deepEqual(model.reads.map(n => [n.store, n.node]), EDITIONS.filter(([other]) => other !== name).map(([other]) => ["oats", other]));
    assert.deepEqual(model.requirements.map(r => [r.key, r.kind]), [["/bindings/knowledge/stores/oats", "required"]]);
    assert.deepEqual(model.candidates, [], "no production writer/store default");
    for (const path of ["okf.json", "knowledge", "work", "instances", "STATE.md", "log.md"]) assert.equal(existsSync(join(root, path)), false);
    assert.equal(lstatSync(join(root, "AGENTS.md")).isFile(), true);
    assert.equal(readlinkSync(join(root, "CLAUDE.md")), "AGENTS.md");
    const instructions = readFileSync(join(root, "AGENTS.md"), "utf8");
    assert.doesNotMatch(instructions, /`(?:oats|oats-config|oats-packages|okf\.json)`|oats-portable-setup|oats-soul-setup/, "no obsolete or removed instruction/skill pointer");
    const skillRoot = join(root, "skills"), actualSkills = existsSync(skillRoot) ? readdirSync(skillRoot).sort() : [];
    assert.deepEqual(actualSkills, privateSkills);
    if (name !== "oats-expert") {
      const domain = instructions.split("## Domain workflows\n\n")[1]?.split("\n\n##")[0];
      assert.ok(domain, `${name}: domain workflow instructions`);
      const references = [...domain.matchAll(/`([a-z0-9-]+)`/g)].map(match => match[1]).sort();
      assert.deepEqual(references, name === "oats-kernel-expert" ? ["integration-authoring"] : privateSkills, "every named domain procedure is contained or explicitly conditional below");
    }
    for (const skill of privateSkills) {
      const dir = join(skillRoot, skill), text = readFileSync(join(dir, "SKILL.md"), "utf8"), frontmatter = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
      assert.ok(frontmatter, `${name}/${skill}: frontmatter`);
      const header = parseConfigData(frontmatter[1]).value;
      assert.equal(header.name, skill); assert.ok(typeof header.description === "string" && header.description.length > 0);
      for (const match of text.matchAll(/(?:\]\(|`)(references\/[A-Za-z0-9._/-]+\.md)(?:\)|`)/g)) {
        assert.equal(match[1].split("/").includes(".."), false);
        assert.ok(lstatSync(join(dir, match[1])).isFile(), `${name}/${skill}: contained ${match[1]}`);
      }
    }
  }
  // This shared procedure is explicitly conditional, not a fabricated private
  // skill or an unannounced additional source requirement.
  const kernel = bytes("souls/oats-kernel-expert/AGENTS.md").toString();
  assert.match(kernel, /belongs to `oats\.authoring`/);
  assert.match(kernel, /only when that capability is explicitly selected/);
  assert.match(kernel, /report the curriculum gap/);
  assert.ok(lstatSync(join(ROOT, "capabilities/oats-authoring/skills/integration-authoring/SKILL.md")).isFile());
  assert.match(bytes("souls/oats-assistant/skills/oats-onboarding/SKILL.md").toString(), /required knowledge and messaging cannot be disabled/);
  assert.match(bytes("souls/oats-assistant/skills/oats-onboarding/references/first-task.md").toString(), /classic OATS 0\.23 compatibility/);
});

test("real Git publication order permits later immutable source imports and matching reciprocal observations", t => {
  const f = fixture(t), sourceCommit = f.git(f.framework, "rev-parse", "HEAD");
  const later = structuredClone(workspace().declaration);
  later.imports = [{ source: SOURCE, soul: EXPORT, revision: sourceCommit, alias: "oats-expert" }];
  f.write(join(f.framework, "oats-workspace.yaml"), JSON.stringify(later));
  const workspaceCommit = f.commit(f.framework);
  assert.notEqual(workspaceCommit, sourceCommit, "source exists before the import that pins it");
  const tx = f.transaction(), discovery = createWorkspaceDiscovery(tx), ws = discovery.readWorkspace({ source: SOURCE, origin });
  assert.equal(ws.source.selector, "fixture-default"); assert.equal(ws.source.commit, workspaceCommit);
  for (const member of ws.parsed.members) {
    const checked = discovery.checkMember(ws, { source: member.source, origin });
    assert.equal(checked.status, "eligible", JSON.stringify(checked.problems));
    assert.equal(checked.workspace.revision, workspaceCommit);
    if (member.source === ws.parsed.members[0].source) assert.equal(checked.member.revision, workspaceCommit, "self-member shares the workspace observation");
  }
  const imported = discovery.importSoul(ws.parsed.imports[0], { origin });
  assert.equal(imported.observation.source.commit, sourceCommit);
  assert.equal(imported.identity.exportPath, EXPORT);
  const destination = join(f.root, "projection"); tx.materialize(imported.observation, imported.roots, destination);
  assert.deepEqual(readFileSync(join(destination, EXPORT, "AGENTS.md")), bytes(`${EXPORT}/AGENTS.md`));
  assert.equal(readlinkSync(join(destination, EXPORT, "CLAUDE.md")), "AGENTS.md");
  assert.deepEqual(readFileSync(join(destination, EXPORT, "skills/pr-review/references/reviewed-delivery.md")), bytes(`${EXPORT}/skills/pr-review/references/reviewed-delivery.md`));
  assert.equal(existsSync(join(destination, "agents")), false, "no legacy/live roster is copied");
  assert.equal(existsSync(join(destination, "oats-workspace.yaml")), false);
  for (const [name, , skills] of EDITIONS.slice(1)) {
    const selected = discovery.importSoul({ source: SOURCE, soul: `souls/${name}`, revision: sourceCommit, alias: name }, { origin });
    const target = join(f.root, `projection-${name}`);
    tx.materialize(selected.observation, selected.roots, target);
    for (const file of ["AGENTS.md", "soul.yaml"]) assert.deepEqual(readFileSync(join(target, `souls/${name}/${file}`)), bytes(`souls/${name}/${file}`));
    assert.equal(readlinkSync(join(target, `souls/${name}/CLAUDE.md`)), "AGENTS.md");
    for (const skill of skills) {
      const path = `souls/${name}/skills/${skill}`;
      assert.deepEqual(readFileSync(join(target, path, "SKILL.md")), bytes(`${path}/SKILL.md`));
      if (existsSync(join(ROOT, path, "references"))) for (const ref of readdirSync(join(ROOT, path, "references"))) {
        assert.deepEqual(readFileSync(join(target, path, "references", ref)), bytes(`${path}/references/${ref}`));
      }
    }
    assert.equal(existsSync(join(target, "agents")), false);
    assert.equal(existsSync(join(target, `souls/${name}/knowledge`)), false);
  }
});

test("standalone consumption does not read or adopt the publisher workspace", t => {
  const f = fixture(t), tx = f.transaction(), reads = [];
  const discovery = createWorkspaceDiscovery({ ...tx, readFile(observation, path, options) { reads.push(path); return tx.readFile(observation, path, options); } });
  const imported = discovery.importSoul({ source: SOURCE, soul: EXPORT, revision: f.git(f.framework, "rev-parse", "HEAD"), alias: "local-expert" }, { origin });
  assert.equal(imported.reference.alias, "local-expert");
  assert.deepEqual(reads, ["oats.yaml", `${EXPORT}/soul.yaml`]);
  assert.equal(Object.hasOwn(imported, "enrolled"), false);
});

test("one-sided and stale backlinks refuse rather than turning membership into activation", t => {
  const f = fixture(t), member = workspace().members[1], repo = f.repos.get(member.source);
  const missing = { schemaVersion: 1, exports: { packages: [{ path: "oats-package" }] } };
  f.write(join(repo, "oats.yaml"), JSON.stringify(missing)); f.commit(repo);
  let discovery = createWorkspaceDiscovery(f.transaction()), ws = discovery.readWorkspace({ source: SOURCE, origin });
  assert.equal(discovery.checkMember(ws, { source: member.source, origin }).status, "not-member");
  const old = f.git(f.framework, "rev-parse", "HEAD");
  f.write(join(f.framework, "progress.md"), "A later workspace observation\n"); f.commit(f.framework);
  f.write(join(repo, "oats.yaml"), JSON.stringify({ ...missing, workspace: { source: SOURCE, revision: old } })); f.commit(repo);
  discovery = createWorkspaceDiscovery(f.transaction()); ws = discovery.readWorkspace({ source: SOURCE, origin });
  assert.equal(discovery.checkMember(ws, { source: member.source, origin }).status, "stale");
});
