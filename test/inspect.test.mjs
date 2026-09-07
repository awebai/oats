import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-inspect-")));
test.after(() => rmSync(base, { recursive: true, force: true }));
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
function gitRepo(dir) {
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@example.invalid"]); execFileSync("git", ["-C", dir, "config", "user.name", "T"]);
  write(join(dir, ".gitignore"), "\n"); execFileSync("git", ["-C", dir, "add", "."]); execFileSync("git", ["-C", dir, "commit", "-qm", "init"]);
}
const env = () => { const e = { ...process.env, OATS_HOME_DIR: join(base, "oats-home") }; for (const k of ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT"]) delete e[k]; return e; };
function oats(args, cwd = base) { const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: env(), cwd }); const json = () => { try { return JSON.parse(r.stdout.trim()); } catch { throw new Error(`no JSON: ${r.stdout}\n${r.stderr}`); } }; return { ...r, json }; }

/** A scope with an ALTERNATIVE knowledge provider (owned, different command
 *  and layout than OKF), an additive owned capability, two souls and one
 *  running-home snapshot. Nothing here names okf. */
function scope(name) {
  const repo = join(base, name); gitRepo(repo);
  // Owned knowledge provider "test.notes": namespace notes, commands digest + inspect, operations harvest (action) + inspect (view).
  const notes = join(repo, ".agents", "capabilities", "owned", "notes");
  write(join(notes, "oats.json"), JSON.stringify({
    capability: "test.notes", version: "0.1.0", description: "Test knowledge provider", compatibility: { oats: ">=0.6.2" }, layer: "knowledge", command: "notes",
    commands: { digest: "bin/notes.mjs digest", inspect: "bin/notes.mjs inspect" },
    operations: { harvest: { kind: "action", command: "digest", context: "home", description: "Digest MEMORY.md into the soul" }, inspect: { kind: "view", command: "inspect", context: "home", description: "Show MEMORY.md" } },
    settings: { tone: { description: "digest tone" } },
  }, null, 2));
  write(join(notes, "bin", "notes.mjs"), "console.log(JSON.stringify({ ok: true }));\n");
  // Additive owned capability with a scope operation and a packaged soul.
  const tools = join(repo, ".agents", "capabilities", "owned", "tools");
  write(join(tools, "oats.json"), JSON.stringify({ capability: "test.tools", version: "2.0.0", description: "Tools", compatibility: { oats: ">=0.6.2" }, command: "tools", commands: { tidy: "bin/tools.mjs tidy" }, operations: { tidy: { command: "tidy", context: "scope" } }, agents: ["agents/helper"] }, null, 2));
  write(join(tools, "bin", "tools.mjs"), "console.log('{}')\n");
  write(join(tools, "agents", "helper", "soul.yaml"), "name: helper\ndescription: packaged helper\nruntime: claude\nwork: checkout\n");
  write(join(tools, "agents", "helper", "AGENTS.md"), "# helper\n");
  write(join(repo, "oats-config.yaml"), "name: t\ncapabilities:\n  layers:\n    knowledge:\n      capability: test.notes\n      from: owned\n      global: true\n      settings:\n        tone: dry\n      souls:\n        dev:\n          settings:\n            tone: warm\n    messaging: none\n    tasks: none\n  additive:\n    test.tools:\n      from: owned\n      souls:\n        dev: true\n");
  write(join(repo, "agents", "dev", "soul", "soul.yaml"), "name: dev\nkind: persistent\ndescription: developer\nrepo: .\nwork: worktree\nruntime: claude\nmodel: opus\nyolo: true\n");
  write(join(repo, "agents", "dev", "soul", "AGENTS.md"), "# dev\n\nYou are dev.\n");
  write(join(repo, "local-agents", "scratch", "soul", "soul.yaml"), "name: scratch\nkind: local\nrepo: .\nwork: checkout\nruntime: pi\n");
  write(join(repo, "local-agents", "scratch", "soul", "AGENTS.md"), "# scratch\n");
  // A running-home snapshot for dev with an older setting and a capability no longer active.
  const home = join(repo, "agents", "dev", "instances", "dev-one");
  write(join(home, "instance.json"), JSON.stringify({ agent: "dev", instance: "dev-one", home, repo, work: "worktree", runtime: "claude", yolo: true, launched: true, createdAt: "2026-09-07T00:00:00.000Z",
    layers: { knowledge: "test.notes [global @ " + repo + "]" }, capabilities: [{ id: "test.notes", level: repo, settings: { tone: "cold" } }, { id: "test.gone", level: repo, settings: {} }],
    capabilityRuntime: [{ id: "test.notes", trust: { trusted: true, integrity: "sha256-old" } }], instructions: [{ source: "kernel:oats", file: "/x/oats.md" }] }));
  write(join(home, "AGENTS.md"), "# dev-one composed\n");
  return { repo, home };
}

test("inspect answers souls with editability, capabilities with health separate from activation, layers and declared operations", () => {
  const { repo } = scope("s1");
  const r = oats(["inspect", "--dir", repo, "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const res = r.json().result;
  assert.equal(res.operationsApi, 1); assert.equal(res.selected.source, "config"); assert.equal(res.selected.soul, null);
  const names = res.souls.map((s) => `${s.name}:${s.kind}`).sort();
  assert.deepEqual(names, ["dev:persistent", "helper:capability", "scratch:local"]);
  const dev = res.souls.find((s) => s.name === "dev");
  assert.equal(dev.runtime, "claude"); assert.equal(dev.model, "opus"); assert.equal(dev.yolo, true); assert.equal(dev.work, "worktree");
  assert.deepEqual(dev.editable.fields, ["runtime", "model", "yolo", "backend", "description"]); assert.equal(dev.editable.instructions, true);
  assert.equal(dev.agentsRoot, join(repo, "agents")); assert.deepEqual(dev.instances, ["dev-one"]); assert.equal(dev.instructions, undefined, "instructions travel only for the selected soul");
  const helper = res.souls.find((s) => s.name === "helper");
  assert.equal(helper.capability, "test.tools"); assert.deepEqual(helper.editable.fields, []); assert.equal(helper.editable.instructions, false); assert.match(helper.editable.reason, /packaged soul/);
  assert.equal(res.layers.knowledge.id, "test.notes"); assert.equal(res.layers.messaging.disabled, true); assert.equal(res.layers.messaging.id, null);
  const notes = res.capabilities.find((c) => c.id === "test.notes");
  assert.equal(notes.origin, "owned"); assert.equal(notes.version, "0.1.0"); assert.equal(notes.layer, "knowledge"); assert.equal(notes.command, "notes");
  assert.equal(notes.health.status, "ok"); assert.equal(notes.health.trusted, true, "owned capabilities are config-owned trust");
  assert.equal(notes.activation.enabled, true); assert.equal(notes.activation.target, "global"); assert.deepEqual(notes.activation.settings, { tone: "dry" });
  const ops = Object.fromEntries(notes.operations.map((o) => [o.name, o]));
  assert.deepEqual(ops.harvest.argv, ["notes", "digest"]); assert.equal(ops.harvest.kind, "action"); assert.equal(ops.inspect.kind, "view");
  assert.equal(ops.harvest.available, false); assert.match(ops.harvest.reason, /needs a running home/);
  const tools = res.capabilities.find((c) => c.id === "test.tools");
  assert.equal(tools.activation.enabled, false, "soul-only activation is not active for the scope"); assert.equal(tools.activation.target, "declared");
  assert.equal(res.knowledge.provider, "test.notes"); assert.deepEqual(res.knowledge.operations.map((o) => o.name).sort(), ["harvest", "inspect"]);
  assert.deepEqual(res.problems, []);
});

test("inspect --soul selects one soul with its instructions and soul-specific bindings; --home adds the snapshot and its drift", () => {
  const { repo, home } = scope("s2");
  let res = oats(["inspect", "--dir", repo, "--soul", "dev", "--json"]).json().result;
  assert.equal(res.selected.soul, "dev"); assert.equal(res.souls.length, 1);
  assert.equal(res.souls[0].instructions.text, "# dev\n\nYou are dev.\n"); assert.equal(res.souls[0].instructions.sha256.length, 64); assert.equal(res.souls[0].instructions.truncated, false);
  const notes = res.capabilities.find((c) => c.id === "test.notes");
  assert.equal(notes.activation.target, "soul:dev"); assert.deepEqual(notes.activation.settings, { tone: "warm" });
  const tools = res.capabilities.find((c) => c.id === "test.tools");
  assert.equal(tools.activation.enabled, true); assert.equal(tools.activation.target, "soul:dev");
  assert.equal(tools.operations[0].available, true, "a scope operation of an active trusted capability is available without a home");
  assert.equal(oats(["inspect", "--dir", repo, "--soul", "nobody", "--json"]).json().error.code, "E_SOUL_UNKNOWN");
  // Snapshot: the home is the identity; --dir must agree with it.
  res = oats(["inspect", "--home", home, "--json"]).json().result;
  assert.equal(res.selected.source, "snapshot"); assert.equal(res.selected.soul, "dev"); assert.equal(res.selected.home, home); assert.equal(res.selected.agentsRoot, join(repo, "agents"));
  // Effective fields are the home's CAPTURED bindings, not the live config; the live config is reported beside them.
  const snapNotes = res.capabilities.find((c) => c.id === "test.notes");
  assert.equal(snapNotes.activation.source, "snapshot"); assert.equal(snapNotes.activation.enabled, true); assert.deepEqual(snapNotes.activation.settings, { tone: "cold" }); assert.equal(snapNotes.activation.target, "snapshot");
  const snapTools = res.capabilities.find((c) => c.id === "test.tools");
  assert.equal(snapTools.activation.enabled, false, "not captured at spawn, so not effective for this home"); assert.equal(snapTools.activation.source, "snapshot");
  assert.equal(res.layers.knowledge.id, "test.notes"); assert.equal(res.layers.messaging.id, null);
  assert.deepEqual(res.currentConfig.activations.map((a) => a.id).sort(), ["test.notes", "test.tools"]); assert.deepEqual(res.currentConfig.activations.find((a) => a.id === "test.notes").settings, { tone: "warm" });
  assert.ok(res.problems.some((p) => p.code === "captured-capability-missing" && p.capability === "test.gone"));
  assert.equal(oats(["inspect", "--home", home, "--dir", join(base, "elsewhere"), "--json"]).json().error.code, "E_HOME_MISMATCH", "--dir must be the home's context");
  assert.equal(oats(["inspect", "--home", home, "--agents-root", join(base, "elsewhere"), "--json"]).json().error.code, "E_HOME_MISMATCH", "--agents-root must be the home's root");
  assert.equal(res.snapshot.instance, "dev-one"); assert.equal(res.snapshot.instructions.text, "# dev-one composed\n"); assert.deepEqual(res.snapshot.instructions.sources, [{ source: "kernel:oats", file: "/x/oats.md" }]);
  const drift = Object.fromEntries(res.snapshot.drift.map((d) => [`${d.id}:${d.field}`, d]));
  assert.deepEqual(drift["test.notes:settings"], { id: "test.notes", field: "settings", snapshot: { tone: "cold" }, config: { tone: "warm" } });
  assert.deepEqual(drift["test.gone:activation"], { id: "test.gone", field: "activation", snapshot: true, config: false });
  assert.deepEqual(drift["test.tools:activation"], { id: "test.tools", field: "activation", snapshot: false, config: true });
  assert.ok(drift["test.notes:integrity"], "a changed artifact integrity since spawn is drift");
  const harvest = res.capabilities.find((c) => c.id === "test.notes").operations.find((o) => o.name === "harvest");
  assert.equal(harvest.available, true, "with a home the home operation is available");
  assert.equal(oats(["inspect", "--home", home, "--soul", "scratch", "--json"]).json().error.code, "E_HOME_MISMATCH");
  assert.equal(oats(["inspect", "--home", join(base, "nowhere"), "--json"]).json().error.code, "E_SESSION_UNKNOWN");
});

test("inspect in a team scope lists every member root and disambiguates same-named souls with --agents-root", () => {
  const team = join(base, "team"); mkdirSync(team, { recursive: true });
  write(join(team, "oats-config.yaml"), "team:\n  name: t\ncapabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n");
  for (const m of ["a", "b"]) {
    const repo = join(team, m); gitRepo(repo);
    write(join(repo, "oats-config.yaml"), "name: " + m + "\n");
    write(join(repo, "agents", "dev", "soul", "soul.yaml"), `name: dev\nrepo: .\nwork: checkout\nruntime: pi\ndescription: dev of ${m}\n`);
    write(join(repo, "agents", "dev", "soul", "AGENTS.md"), `# dev ${m}\n`);
  }
  const res = oats(["inspect", "--dir", join(team, "a"), "--json"]).json().result;
  assert.deepEqual(res.scope.agentsRoots.map((r) => r.replace(team, "")).sort(), ["/a/agents", "/b/agents"]);
  assert.equal(res.souls.filter((s) => s.name === "dev").length, 2);
  assert.equal(oats(["inspect", "--dir", join(team, "a"), "--soul", "dev", "--json"]).json().error.code, "E_SOUL_AMBIGUOUS");
  const one = oats(["inspect", "--dir", join(team, "a"), "--soul", "dev", "--agents-root", join(team, "b", "agents"), "--json"]).json().result;
  assert.equal(one.souls[0].description, "dev of b"); assert.equal(one.selected.agentsRoot, join(team, "b", "agents"));
  assert.equal(one.layers.knowledge.disabled, true); assert.equal(one.knowledge.provider, null);
  // A home selects its own soul by its root: same-named souls elsewhere are never ambiguous for it.
  const homeB = join(team, "b", "agents", "dev", "instances", "dev-b1");
  write(join(homeB, "instance.json"), JSON.stringify({ agent: "dev", instance: "dev-b1", home: homeB, repo: join(team, "b"), launched: false, capabilities: [] }));
  const viaHome = oats(["inspect", "--home", homeB, "--json"]).json().result;
  assert.equal(viaHome.selected.agentsRoot, join(team, "b", "agents")); assert.equal(viaHome.souls[0].description, "dev of b"); assert.equal(viaHome.selected.source, "snapshot");
  assert.equal(oats(["inspect", "--home", homeB, "--agents-root", join(team, "a", "agents"), "--json"]).json().error.code, "E_HOME_MISMATCH");
});

test("instruction text is capped by bytes at a character boundary and unreadable files report the reason", () => {
  const repo = join(base, "cap"); gitRepo(repo);
  write(join(repo, "oats-config.yaml"), "capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n");
  write(join(repo, "agents", "big", "soul", "soul.yaml"), "name: big\nrepo: .\nwork: checkout\nruntime: pi\n");
  // 256 KiB of two-byte characters plus one more: the cap falls inside a character.
  write(join(repo, "agents", "big", "soul", "AGENTS.md"), "é".repeat(128 * 1024 + 1));
  write(join(repo, "agents", "gone", "soul", "soul.yaml"), "name: gone\nrepo: .\nwork: checkout\nruntime: pi\n");
  const big = oats(["inspect", "--dir", repo, "--soul", "big", "--json"]).json().result.souls[0].instructions;
  assert.equal(big.truncated, true); assert.equal(Buffer.byteLength(big.text), 256 * 1024, "cut at the byte bound on a character boundary"); assert.ok(!big.text.includes("�")); assert.equal(big.bytes, 2 * (128 * 1024 + 1));
  const gone = oats(["inspect", "--dir", repo, "--soul", "gone", "--json"]).json().result.souls[0].instructions;
  assert.equal(gone.text, null); assert.match(gone.error, /ENOENT/);
});
