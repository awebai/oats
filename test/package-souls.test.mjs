// Package souls (kernel 0.28.0, docs/design/2026-09-26-okf-knowledge-operations.md §2.2): a package
// manifest may declare `souls: ["souls/<name>"]`, ordinary soul directories versioned and locked
// with the package. The lock records each soul's name and digest; discovery lists them with their
// package origin; they spawn by the qualified name `<package>/<soul>` (or the bare name when it is
// unique); `from: here` in a package soul is its own package at the locked commit.
//
// Real git: one bare member repo (the v2Deployment helper) plus one bare package repo with tags.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { v2Deployment, git } from "./helpers/v2-deployment.mjs";

const ok = (r, what) => { assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`); const j = r.json(); assert.equal(j.ok, true, `${what}: ${r.stdout}`); return j.result; };
const fails = (r, code, what) => { const j = r.json(); assert.equal(j.ok, false, `${what}: ${r.stdout}${r.stderr}`); assert.equal(j.error.code, code, `${what}: ${r.stdout}`); return j.error; };

/** A package repo: oats-package/ with one capability (acme-tool) and the given souls. */
function packageRepo({ id = "acme.pkg", version = "1.0.0", souls = { keeper: {} } } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-pkgsoul-")));
  const bare = join(base, "pkg.git");
  git(base, "init", "-q", "--bare", bare);
  const seed = join(base, "seed");
  git(base, "clone", "-q", bare, seed);
  const write = (rel, text) => { const abs = join(seed, rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, text); };
  const pkg = { base, bare, seed, ref: `git:${pathToFileURL(bare).href}`, id };
  pkg.files = (v, soulDefs) => {
    write("oats-package/oats-package.json", JSON.stringify({ package: id, version: v, description: "fixture package", compatibility: { oats: ">=0.24.0" }, capabilities: ["capabilities/acme-tool"], souls: Object.keys(soulDefs).map((n) => `souls/${n}`) }, null, 2) + "\n");
    write("oats-package/capabilities/acme-tool/oats.json", JSON.stringify({ capability: "acme-tool", version: v, description: "tool", compatibility: { oats: ">=0.24.0" }, skills: ["skills"] }, null, 2) + "\n");
    write("oats-package/capabilities/acme-tool/skills/tool-skill/SKILL.md", "---\nname: tool-skill\ndescription: tool\n---\n\nuse the tool\n");
    for (const [name, def] of Object.entries(soulDefs)) {
      write(`oats-package/souls/${name}/soul.yaml`, YAML.stringify({ schemaVersion: 2, name, description: `${name} package soul.`, work: "directory", capabilities: { "acme-tool": { from: "here" } }, ...(def.soul || {}) }));
      write(`oats-package/souls/${name}/AGENTS.md`, def.agents ?? `# ${name} (package ${v})\n`);
    }
  };
  pkg.release = (v, soulDefs, { tag = `v${v}`, force = false } = {}) => {
    pkg.files(v, soulDefs);
    git(seed, "add", "-A"); git(seed, "commit", "-qm", `release ${v}`, "--allow-empty");
    git(seed, "tag", ...(force ? ["-f"] : []), tag);
    git(seed, "push", "-q", ...(force ? ["-f"] : []), "origin", "HEAD:main", tag);
    return git(seed, "rev-parse", "HEAD");
  };
  pkg.commit1 = pkg.release(version, souls);
  pkg.cleanup = () => rmSync(base, { recursive: true, force: true });
  return pkg;
}

function fixture({ souls = { dev: {} }, pkgSouls = { keeper: {} }, teams = { global: { description: "Fixture team" } }, local = {} } = {}) {
  const pkg = packageRepo({ souls: pkgSouls });
  const fx = v2Deployment({ name: "acme", souls, workspace: { packages: { "acme.pkg": `${pkg.ref}@v1.0.0` }, teams }, local });
  const cleanup = fx.cleanup;
  fx.cleanup = () => { cleanup(); pkg.cleanup(); };
  fx.pkg = pkg;
  return fx;
}
const lockOf = (fx) => JSON.parse(readFileSync(join(fx.dep, "oats-lock.json"), "utf8"));

test("sync locks each package soul (name + digest); souls/workspace status list it with its package origin", (t) => {
  const fx = fixture(); t.after(fx.cleanup);
  const synced = ok(fx.cli(["sync", "--json"]), "sync");
  const entry = lockOf(fx).packages["acme.pkg"];
  assert.deepEqual(entry.capabilities, ["acme-tool"]);
  assert.equal(entry.commit, fx.pkg.commit1);
  assert.deepEqual(entry.souls.map((s) => s.name), ["keeper"]);
  assert.match(entry.souls[0].digest, /^sha256-[0-9a-f]{64}$/);
  assert.deepEqual(synced.packages.find((p) => p.id === "acme.pkg").souls, ["keeper"]);

  const souls = ok(fx.cli(["souls", "--json"]), "souls").souls;
  const row = souls.find((s) => s.name === "keeper");
  assert.deepEqual({ kind: row.kind, package: row.package, version: row.version, commit: row.commit, qualifiedName: row.qualifiedName, origin: row.origin, work: row.work },
    { kind: "package", package: "acme.pkg", version: "1.0.0", commit: fx.pkg.commit1, qualifiedName: "acme.pkg/keeper", origin: "package acme.pkg v1.0.0", work: "directory" });
  const text = fx.cli(["souls"]);
  assert.match(text.stdout, /keeper\s+package acme\.pkg v1\.0\.0/);

  const ws = ok(fx.cli(["workspace", "status", "--json"]), "workspace status");
  assert.deepEqual(ws.packages.find((p) => p.id === "acme.pkg").souls, ["keeper"]);
  assert.match(fx.cli(["sync"]).stdout, /souls {6}2 discovered \(1 members, 0 external, 1 package, 0 disabled here\)/);
});

test("spawn by the qualified and the bare name materializes the soul at the locked commit; from: here is its own package; instance.json records the package provenance", async (t) => {
  const fx = fixture(); t.after(fx.cleanup);
  ok(fx.cli(["sync", "--json"]), "sync");
  for (const [name, purpose] of [["acme.pkg/keeper", "q"], ["keeper", "b"]]) {
    const r = ok(fx.cli(["spawn", name, "--purpose", purpose, "--no-launch", "--json"]), `spawn ${name}`);
    assert.equal(r.home, join(fx.root, "acme-pkg--keeper", "instances", `acme-pkg-keeper-${purpose}`));
    const meta = JSON.parse(readFileSync(join(r.home, "instance.json"), "utf8"));
    const home = r.home;
    assert.equal(meta.agent, "acme-pkg--keeper");
    assert.equal(meta.workspace.soul.name, "keeper");
    assert.equal(meta.workspace.soul.qualifiedName, "acme.pkg/keeper");
    const { id, version, commit, path } = meta.workspace.soul.package;
    assert.deepEqual({ id, version, commit, path }, { id: "acme.pkg", version: "1.0.0", commit: fx.pkg.commit1, path: "oats-package/souls/keeper" });
    assert.equal(meta.workspace.soul.id, "package:acme.pkg#keeper");
    assert.equal(meta.workspace.soul.commit, fx.pkg.commit1);
    assert.equal(meta.modules["acme-tool"].from.kind, "package");
    assert.equal(meta.modules["acme-tool"].from.package, "acme.pkg");
    assert.ok(existsSync(join(home, ".agents", "skills", "acme-tool", "tool-skill", "SKILL.md")));
    assert.match(readFileSync(join(home, "AGENTS.md"), "utf8"), /# keeper \(package 1\.0\.0\)/);
  }
  const status = JSON.parse(fx.cli(["status", "--json"]).stdout);
  const keeper = status.agents.find((a) => a.name === "acme-pkg--keeper");
  assert.equal(keeper.instances.length, 2);
  assert.equal(keeper.instances[0].soul.status, "current", JSON.stringify(keeper.instances[0].soul));
  assert.equal(keeper.instances[0].soul.package, "acme.pkg");
});

test("a bare name shared by a member soul and a package soul is E_SOUL_AMBIGUOUS naming the qualified forms; each qualified form spawns", (t) => {
  const fx = fixture({ souls: { dev: {}, keeper: {} } }); t.after(fx.cleanup);
  ok(fx.cli(["sync", "--json"]), "sync");
  const e = fails(fx.cli(["spawn", "keeper", "--no-launch", "--json"]), "E_SOUL_AMBIGUOUS", "bare ambiguous");
  assert.deepEqual([...e.details.qualified].sort(), ["acme.pkg/keeper", "ws/keeper"]);
  assert.match(e.message, /acme\.pkg\/keeper/);
  const pkg = ok(fx.cli(["spawn", "acme.pkg/keeper", "--purpose", "p", "--no-launch", "--json"]), "qualified package");
  const mem = ok(fx.cli(["spawn", "ws/keeper", "--purpose", "m", "--no-launch", "--json"]), "qualified member");
  // Side by side, in distinct agent directories, each attributed to its own source.
  assert.equal(pkg.home, join(fx.root, "acme-pkg--keeper", "instances", "acme-pkg-keeper-p"));
  assert.equal(mem.home, join(fx.root, "keeper", "instances", "keeper-m"));
  const status = JSON.parse(fx.cli(["status", "--json"]).stdout);
  const rows = Object.fromEntries(status.agents.map((a) => [a.name, a]));
  assert.deepEqual(rows["acme-pkg--keeper"].instances.map((i) => i.instance), ["acme-pkg-keeper-p"]);
  assert.deepEqual(rows.keeper.instances.map((i) => i.instance), ["keeper-m"]);
  assert.equal(rows["acme-pkg--keeper"].soulSource.repoKey, `local/${fx.pkg.bare}`);
  assert.equal(rows["acme-pkg--keeper"].instances[0].soul.package, "acme.pkg");
  assert.equal(rows["acme-pkg--keeper"].instances[0].soul.status, "current");
  assert.equal(rows.keeper.soulSource.repoKey, fx.key);
  assert.equal(rows.keeper.instances[0].soul.package, undefined);
  assert.equal(rows.keeper.instances[0].soul.status, "current");
  const text = fx.cli(["status"]).stdout;
  assert.match(text, /acme-pkg--keeper {2}\[work: directory, repo: package acme\.pkg v1\.0\.0 @ [0-9a-f]{7}\]/);
  assert.match(text, /^ {2}keeper {2}\[work: directory, repo: ws @ [0-9a-f]{7}\]/m);
});

test("oats-local.yaml souls.disabled refuses a package soul by its qualified name (E_SOUL_DISABLED)", (t) => {
  const fx = fixture({ local: { souls: { disabled: ["acme.pkg/keeper"] } } }); t.after(fx.cleanup);
  ok(fx.cli(["sync", "--json"]), "sync");
  for (const name of ["keeper", "acme.pkg/keeper"]) {
    const e = fails(fx.cli(["spawn", name, "--no-launch", "--json"]), "E_SOUL_DISABLED", `spawn ${name}`);
    assert.equal(e.details.qualifiedName, "acme.pkg/keeper");
  }
  assert.match(fx.cli(["sync"]).stdout, /1 disabled here/);
});

test("a package soul's undeclared team is E_TEAM_UNKNOWN in discovery; workspace defaults and off apply as for any soul", (t) => {
  const fx = fixture({ pkgSouls: { keeper: { soul: { team: "okf" } }, loner: { soul: { capabilities: { "acme-tool": { from: "here" }, house: "off" } } } } }); t.after(fx.cleanup);
  const ws = YAML.parse(readFileSync(join(fx.member, "oats-workspace.yaml"), "utf8"));
  ws.defaults.capabilities = { house: { from: fx.key } };
  fx.commit({ "oats-workspace.yaml": YAML.stringify(ws), "capabilities/house/oats.json": JSON.stringify({ capability: "house", version: "0.0.0", description: "house style", compatibility: { oats: ">=0.24.0" } }) }, "house default");
  ok(fx.cli(["sync", "--json"]), "sync");
  const souls = ok(fx.cli(["souls", "--json"]), "souls");
  assert.ok(souls.problems.some((p) => p.code === "E_TEAM_UNKNOWN" && p.package === "acme.pkg" && p.path.includes("souls/keeper/soul.yaml")), JSON.stringify(souls.problems));
  assert.equal(souls.souls.find((s) => s.name === "keeper").team, "okf");
  const modules = (name) => ok(fx.cli(["spawn", name, "--preview", "--json"]), `preview ${name}`).modules.map((m) => m.name).sort();
  assert.deepEqual(modules("acme.pkg/loner"), ["acme-tool"], "house: off drops the workspace default");
  // The team is declared: the soul spawns and the workspace default applies.
  ws.teams.okf = { description: "Knowledge operations" };
  fx.commit({ "oats-workspace.yaml": YAML.stringify(ws) }, "declare okf");
  assert.deepEqual(modules("acme.pkg/keeper"), ["acme-tool", "house"]);
});

test("integrity: a lock whose soul digest was edited, or a moved tag, is E_PACKAGE_INTEGRITY on sync; spawn verifies the fetched soul against the lock", (t) => {
  const fx = fixture(); t.after(fx.cleanup);
  ok(fx.cli(["sync", "--json"]), "sync");
  const good = lockOf(fx);
  const edited = structuredClone(good);
  edited.packages["acme.pkg"].souls[0].digest = `sha256-${"0".repeat(64)}`;
  writeFileSync(join(fx.dep, "oats-lock.json"), JSON.stringify(edited, null, 2) + "\n");
  let e = fails(fx.cli(["spawn", "acme.pkg/keeper", "--no-launch", "--json"]), "E_PACKAGE_INTEGRITY", "spawn with an edited soul digest");
  assert.equal(e.details.why, "soul-digest");
  e = fails(fx.cli(["sync", "--json"]), "E_PACKAGE_INTEGRITY", "sync with an edited soul digest");
  assert.equal(e.details.why, "souls");

  // A lock written before 0.28.0 records no souls: the next sync fills them in.
  const older = structuredClone(good);
  delete older.packages["acme.pkg"].souls;
  writeFileSync(join(fx.dep, "oats-lock.json"), JSON.stringify(older, null, 2) + "\n");
  ok(fx.cli(["sync", "--json"]), "sync fills the souls of a pre-0.28 lock");
  assert.deepEqual(lockOf(fx), good);
  // The soul's content changes under the SAME tag: the tag moved.
  fx.pkg.release("1.0.0", { keeper: { agents: "# keeper, changed under the same tag\n" } }, { force: true });
  fails(fx.cli(["sync", "--json"]), "E_PACKAGE_INTEGRITY", "sync after the tag moved");
});

test("drift: the package pin moving shows the instance's soul as moved", (t) => {
  const fx = fixture(); t.after(fx.cleanup);
  ok(fx.cli(["sync", "--json"]), "sync");
  ok(fx.cli(["spawn", "acme.pkg/keeper", "--purpose", "d", "--no-launch", "--json"]), "spawn");
  const c2 = fx.pkg.release("1.1.0", { keeper: { agents: "# keeper 1.1.0\n" } });
  const ws = YAML.parse(readFileSync(join(fx.member, "oats-workspace.yaml"), "utf8"));
  ws.packages["acme.pkg"] = `${fx.pkg.ref}@v1.1.0`;
  fx.commit({ "oats-workspace.yaml": YAML.stringify(ws) }, "bump acme.pkg");
  ok(fx.cli(["sync", "--json"]), "sync 1.1.0");
  const status = JSON.parse(fx.cli(["status", "--json"]).stdout);
  const soul = status.agents.find((a) => a.name === "acme-pkg--keeper").instances[0].soul;
  assert.equal(soul.status, "moved", JSON.stringify(soul));
  assert.equal(soul.current, c2);
  assert.match(fx.cli(["status"]).stdout, /soul: keeper from package acme\.pkg v1\.0\.0 @ [0-9a-f]{7}\s+\[package moved since \(now v1\.1\.0 @ [0-9a-f]{7}\)\]/);
});

test("a package soul must carry soul.yaml and AGENTS.md, and its name is its directory (E_PACKAGE_MANIFEST on sync)", (t) => {
  const fx = fixture(); t.after(fx.cleanup);
  rmSync(join(fx.pkg.seed, "oats-package", "souls", "keeper", "AGENTS.md"));
  git(fx.pkg.seed, "add", "-A"); git(fx.pkg.seed, "commit", "-qm", "broken"); git(fx.pkg.seed, "tag", "v1.0.1"); git(fx.pkg.seed, "push", "-q", "origin", "HEAD:main", "v1.0.1");
  const ws = YAML.parse(readFileSync(join(fx.member, "oats-workspace.yaml"), "utf8"));
  ws.packages["acme.pkg"] = `${fx.pkg.ref}@v1.0.1`;
  fx.commit({ "oats-workspace.yaml": YAML.stringify(ws) }, "pin broken");
  const e = fails(fx.cli(["sync", "--json"]), "E_PACKAGE_MANIFEST", "sync a soul without AGENTS.md");
  assert.match(e.message, /souls\/keeper/);
  assert.equal(lstatSync(join(fx.dep, "oats-local.yaml")).isFile(), true);
});
