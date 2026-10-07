// Desktop facts (feature `desktop-facts`, 0.29.0): facts the Desktop's Workspace v4 shows, reported by the
// kernel so the Desktop never derives them ("the kernel is the model; the Desktop renders it").
//
// The real CLI over a v2 deployment (test/helpers/v2-deployment.mjs). Never bare `oats setup`; no network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { packageRepo } from "./helpers/package-repo.mjs";

const ok = (r) => { assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`); const j = r.json(); assert.equal(j.ok, true, r.stdout); return j.result; };

/** A workspace that composes a capability for dev from each place: the workspace, the soul (no team since 0.30); the
 *  soul turns one workspace default off and empties the knowledge slot the workspace fills. */
function composition() {
  const caps = Object.fromEntries(["acme.kept", "acme.ws", "acme.own"].map((id) => [id, { manifest: {} }]));
  const fx = v2Deployment({
    souls: { dev: { soul: { knowledge: "none", capabilities: { "acme.ws": "off", "acme.own": { from: "here" } } } } },
    capabilities: { ...caps, notes: { manifest: { layer: "knowledge" } } },
  });
  fx.commit({ "oats-workspace.yaml": { yaml: { schemaVersion: 2, name: "fixture", members: [fx.ref], teams: { global: { description: "Fixture team" } },
    defaults: { knowledge: { notes: { from: fx.key } }, messaging: "none", tasks: "none",
      capabilities: { "acme.kept": { from: fx.key }, "acme.ws": { from: fx.key } } } } } }, "composition");
  assert.equal(fx.cli(["sync", "--json"]).status, 0);
  return fx;
}

test("1. inspect --soul: each capability's composedFrom, and the capabilities the soul turned off", (t) => {
  const fx = composition(); t.after(fx.cleanup);
  const doc = ok(fx.cli(["inspect", "--soul", "dev", "--json"]));
  assert.deepEqual(Object.fromEntries(doc.capabilities.map((c) => [c.id, c.composedFrom])),
    { "acme.kept": "workspace", "acme.own": "soul" });
  assert.equal(typeof doc.capabilities[0].from, "object", "`from` stays the module's origin");
  assert.deepEqual(doc.capabilitiesOff, [
    { id: "acme.ws", off: true, from: "soul", reason: "off", overrides: "workspace" },
    { id: "notes", off: true, from: "soul", reason: "slot-none", slot: "knowledge", overrides: "workspace" },
  ]);
});

test("2. oats souls: each soul's default harness and model, and where they come from (a v2 soul.yaml declares neither: the kernel default)", (t) => {
  const fx = v2Deployment(); t.after(fx.cleanup);
  const souls = ok(fx.cli(["souls", "--json"])).souls;
  const dev = souls.find((s) => s.name === "dev");
  assert.deepEqual({ harness: dev.harness, model: dev.model, harnessFrom: dev.harnessFrom }, { harness: "pi", model: null, harnessFrom: "kernel-default" });
  // The same default a spawn of it takes.
  assert.equal(ok(fx.cli(["spawn", "dev", "--preview", "--json"])).harness, dev.harness);
});

test("3 + 11. oats capabilities: layer and description on every row, package rows included; skills, commands and hooks by name", (t) => {
  const pkg = packageRepo(); t.after(pkg.cleanup);
  const fx = v2Deployment({
    workspace: { packages: { "acme.pkg": `${pkg.ref}@v1.0.0` } },
    capabilities: { "acme.tool": { manifest: { description: "A member tool.", layer: "tasks", skills: ["skills"], commands: { ping: "ping.mjs" }, hooks: { spawn: "spawn.mjs" } },
      files: { "skills/tool-craft/SKILL.md": "---\nname: tool-craft\ndescription: x\n---\n", "ping.mjs": "", "spawn.mjs": "" } } },
  });
  t.after(fx.cleanup);
  assert.equal(fx.cli(["sync", "--json"]).status, 0);
  const rows = ok(fx.cli(["capabilities", "--json"])).capabilities;
  const tool = rows.find((c) => c.name === "acme.tool");
  assert.deepEqual({ layer: tool.layer, description: tool.description, skills: tool.skills, commands: tool.commands, hooks: tool.hooks },
    { layer: "tasks", description: "A member tool.", skills: ["tool-craft"], commands: ["ping"], hooks: ["spawn"] });
  const packaged = rows.find((c) => c.name === "acme-tool");
  assert.deepEqual({ kind: packaged.kind, layer: packaged.layer, description: packaged.description, skills: packaged.skills, commands: packaged.commands, hooks: packaged.hooks },
    { kind: "package", layer: null, description: "tool", skills: ["tool-skill"], commands: [], hooks: [] });
  for (const c of rows) {
    assert.ok(Object.hasOwn(c, "layer") && Object.hasOwn(c, "description"), `${c.name}: layer and description are reported`);
    assert.ok(Array.isArray(c.skills) && Array.isArray(c.commands) && Array.isArray(c.hooks), `${c.name}: provides`);
  }
});

test("4. oats souls: spawnable, or the refusal a spawn would meet (resolution, souls.disabled), computed without spawning", (t) => {
  const fx = v2Deployment({
    souls: { dev: {}, broken: { soul: { capabilities: { nope: { from: "here" } } } }, off: {} },
    capabilities: { "acme.x": { manifest: {} } },
    local: { souls: { disabled: ["off"] } },
  });
  t.after(fx.cleanup);
  fx.commit({ "oats-workspace.yaml": { yaml: { schemaVersion: 2, name: "fixture", members: [fx.ref], teams: { global: { description: "g" }, a: { description: "a" }, b: { description: "b" } },
    defaults: { knowledge: "none", messaging: "none", tasks: "none" } } } }, "shared teams a and b");
  assert.equal(fx.cli(["sync", "--json"]).status, 0);
  const rows = Object.fromEntries(ok(fx.cli(["souls", "--json"])).souls.map((s) => [s.name, s]));
  assert.deepEqual([rows.dev.spawnable, rows.dev.problem], [true, null]);
  assert.ok(Array.isArray(rows.dev.capabilities), "a spawnable soul says what it composes (souls-capabilities)");
  for (const [name, code] of [["broken", "E_CAPABILITY_MISSING"], ["off", "E_SOUL_DISABLED"]]) {
    assert.equal(rows[name].spawnable, false, name);
    assert.equal(rows[name].problem.code, code, `${name}: ${JSON.stringify(rows[name].problem)}`);
    assert.equal(rows[name].capabilities, null, `${name}: not spawnable, so capabilities is null (never [])`);
    assert.equal(typeof rows[name].problem.message, "string");
    // The same refusal a spawn meets.
    const spawn = fx.cli(["spawn", name, "--preview", "--json"]);
    assert.equal(spawn.json().error.code, code, `${name} spawn: ${spawn.stdout}`);
  }
  // Team model 3: a team refusal is the deployment's (local teams the workspace does not allow), so it is every soul's.
  writeFileSync(join(fx.dep, "oats-local.yaml"), YAML.stringify({ schemaVersion: 2, workspace: fx.ref, defaultTeam: "a" }));
  const closed = ok(fx.cli(["souls", "--json"])).souls.find((x) => x.name === "dev");
  assert.deepEqual([closed.spawnable, closed.problem.code], [false, "E_WORKSPACE_SCHEMA"]);
  assert.equal(closed.capabilities, null, "a soul refused only for a team problem has null capabilities too: null whenever spawnable is false");
  assert.equal(fx.cli(["spawn", "dev", "--preview", "--json"]).json().error.details.reason, "local-teams-closed");
});

test("5 + 6. workspace status: the workspace defaults as rows; this computer's clones (and the rule that found each), disabled souls and lock", (t) => {
  const fx = v2Deployment({ capabilities: { "acme.x": { manifest: {} }, "acme.y": { manifest: {} }, notes: { manifest: { layer: "knowledge" } } }, local: { souls: { disabled: ["dev"] } } });
  t.after(fx.cleanup);
  fx.commit({ "oats-workspace.yaml": { yaml: { schemaVersion: 2, name: "fixture", members: [fx.ref], teams: { global: { description: "g" } },
    defaults: { knowledge: { notes: { from: fx.key } }, messaging: "none", tasks: "none", capabilities: { "acme.x": { from: fx.key } } } } } }, "defaults");
  assert.equal(fx.cli(["sync", "--json"]).status, 0);
  const doc = ok(fx.cli(["workspace", "status", "--json"]));
  assert.deepEqual(doc.defaults, {
    slots: { knowledge: { name: "notes", from: fx.key }, messaging: "none", tasks: "none" },
    capabilities: [{ name: "acme.x", from: fx.key, off: false }],
  }, "defaults.byTeam is no longer reported (removed in 0.30)");
  // The fixture's member clone sits at the convention path <deployment>/<member name>.
  assert.deepEqual(doc.clones, [{ key: fx.key, name: "ws", path: fx.member, rule: "convention" }]);
  assert.deepEqual(doc.disabledSouls, ["dev"]);
  assert.deepEqual(doc.lock, { path: `${fx.dep}/oats-lock.json`, lockfileVersion: 3 });
});

test("9. workspace status: a catalog package pinned behind the official catalog names the latest version", (t) => {
  const pkg = packageRepo({ id: "acme.pkg", version: "1.0.0" }); t.after(pkg.cleanup);
  const bare = pkg.ref.replace(/^git:/, "");
  const fx = v2Deployment({ workspace: { packages: { "acme.pkg": "v1.0.0" } } }); t.after(fx.cleanup);
  const catalog = (ref) => { const file = `${fx.base}/catalog.json`; writeFileSync(file, JSON.stringify({ packages: { "acme.pkg": { url: bare, ref, path: "oats-package" } } })); return { OATS_PACKAGE_CATALOG: file }; };
  assert.equal(fx.cli(["sync", "--json"], { env: catalog("v1.0.0") }).status, 0);
  const row = (env) => ok(fx.cli(["workspace", "status", "--json"], { env })).packages.find((p) => p.id === "acme.pkg");
  assert.equal(row(catalog("v1.0.0")).latest, null, "the pin is the catalog's");
  pkg.release("1.1.0", { keeper: {} });
  assert.deepEqual(row(catalog("v1.1.0")).latest, { version: "1.1.0", ref: "v1.1.0" });
});

test("10. file locations: the workspace file, each membership file, each soul.yaml and member oats.json by path, with a browsable url for GitHub repos", async (t) => {
  const { browseUrl } = await import("../lib/remote.mjs");
  assert.equal(browseUrl("github.com/acme/agents", "0123abcd", "souls/dev/soul.yaml"), "https://github.com/acme/agents/blob/0123abcd/souls/dev/soul.yaml");
  assert.equal(browseUrl("github.com/acme/agents", "0123abcd"), "https://github.com/acme/agents/tree/0123abcd");
  assert.equal(browseUrl("local//tmp/x.git", "0123abcd", "a"), null, "no browsable form for a local repo");
  const fx = v2Deployment({ capabilities: { "acme.x": { manifest: {} } } }); t.after(fx.cleanup);
  assert.equal(fx.cli(["sync", "--json"]).status, 0);
  const ws = ok(fx.cli(["workspace", "status", "--json"]));
  assert.deepEqual(ws.workspace.file, { path: "oats-workspace.yaml", url: null });
  assert.deepEqual(ws.members[0].membershipFile, { path: "oats-membership.yaml", url: null });
  assert.equal(ws.members[0].url, null);
  const soul = ok(fx.cli(["souls", "--json"])).souls.find((s) => s.name === "dev");
  assert.deepEqual(soul.file, { path: "souls/dev/soul.yaml", url: null });
  const cap = ok(fx.cli(["capabilities", "--json"])).capabilities.find((c) => c.name === "acme.x");
  assert.deepEqual(cap.file, { path: "capabilities/acme.x/oats.json", url: null });
  assert.match(cap.tree, /^[0-9a-f]{40}$/, "a member capability's fingerprint: its Git tree at the commit");
});

test("7. oats status: a moved member module's current names the version now, beside the commit", async (t) => {
  const fx = v2Deployment({ souls: { dev: { soul: { capabilities: { "acme.x": { from: "here" } } } } }, capabilities: { "acme.x": { manifest: { version: "1.0.0" } } } });
  t.after(fx.cleanup);
  const { home } = await fx.spawn("dev");
  const commit = fx.commit({ "capabilities/acme.x/oats.json": { json: { capability: "acme.x", version: "1.1.0", description: "x", compatibility: { oats: ">=0.24.0" } } } }, "acme.x 1.1.0");
  const status = JSON.parse(fx.cli(["status", "--json"]).stdout);
  const row = status.agents.flatMap((a) => a.instances).find((i) => i.home === home).modules.find((m) => m.name === "acme.x");
  assert.equal(row.status, "moved");
  assert.deepEqual(row.current, { commit, version: "1.1.0" });
});

test("8 + 12 + 13. oats status rows: startedAt (last start, else the spawn's launch), modelFrom, identityAddress", async (t) => {
  const fx = v2Deployment(); t.after(fx.cleanup);
  const { home } = await fx.spawn("dev");
  const rowOf = () => JSON.parse(fx.cli(["status", "--json"]).stdout).agents.flatMap((a) => a.instances).find((i) => i.home === home);
  let row = rowOf();
  assert.equal(row.startedAt, null, "never launched");
  assert.equal(row.modelFrom, "harness-default", "no --model, and a v2 soul names none");
  assert.equal(row.identityAddress, null);
  // A recorded start and a messaging identity (as the session receipt and a messaging hook record them).
  const file = `${home}/instance.json`, meta = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...meta, launched: true, restarts: [{ startedAt: "2026-09-26T10:00:00.000Z", model: null, reused: false }, { startedAt: "2026-09-26T11:00:00.000Z", model: null, reused: false }],
    capabilityRuntime: [{ id: "acme.chat", layer: "messaging" }], capabilityMeta: { "acme.chat": { identity: { alias: "dev-1", address: "acme/dev-1", team: "global" } } } }, null, 2));
  row = rowOf();
  assert.equal(row.startedAt, "2026-09-26T11:00:00.000Z", "the last start");
  assert.equal(row.identityAddress, "acme/dev-1");
  assert.equal(row.createdAt, meta.createdAt, "createdAt stays the spawn time");
});

test("12. modelFrom records where the model came from: an explicit --model at spawn is `spawn`", async (t) => {
  const fx = v2Deployment(); t.after(fx.cleanup);
  const { home } = await fx.spawn("dev", { model: "sonnet" });
  assert.equal(JSON.parse(readFileSync(`${home}/instance.json`, "utf8")).modelFrom, "spawn");
});

test("12. modelFromOf: resolveLaunchSelection's modelSource → modelFrom", async () => {
  const { modelFromOf } = await import("../lib/core.mjs");
  assert.equal(modelFromOf("explicit", { at: "spawn" }), "spawn");
  assert.equal(modelFromOf("explicit", { at: "start" }), "start");
  assert.equal(modelFromOf("soul default"), "soul");
  assert.equal(modelFromOf("launch-config fast"), "launch-config");
  assert.equal(modelFromOf("native default (harness changed)"), "harness-default");
  assert.equal(modelFromOf("recorded", { prior: "soul" }), "soul", "a recorded model keeps where it came from");
  assert.equal(modelFromOf(undefined), null);
});

test("feature desktop-facts is advertised", (t) => {
  const fx = v2Deployment(); t.after(fx.cleanup);
  assert.ok(JSON.parse(fx.cli(["version", "--json"]).stdout).features.includes("desktop-facts"));
});

// ---- Feature preview-composed-from (0.30.2): `oats spawn … --preview --json` says why each module is there —
// modules[].composedFrom, "soul" | "workspace", the same resolution's capabilitiesFrom. Provenance only:
// no fingerprint moves with it.

/** A workspace that gives dev a capability from each place: the soul's own (acme.own), a slot default
 *  (messaging: chat), defaults.capabilities (acme.ws), and a package default the soul overrides with its
 *  own member capability of the same name (acme-tool: workspace `from: package`, soul `from: here`).
 *  The package's soul keeper declares acme-tool `from: here` (its package). */
function origins(t) {
  const pkg = packageRepo(); t.after(pkg.cleanup);
  const fx = v2Deployment({
    souls: { dev: { soul: { capabilities: { "acme.own": { from: "here" }, "acme-tool": { from: "here" } } } } },
    capabilities: { "acme.own": { manifest: {} }, "acme.ws": { manifest: {} }, "acme-tool": { manifest: {} }, chat: { manifest: { layer: "messaging" } } },
  });
  t.after(fx.cleanup);
  fx.commit({ "oats-workspace.yaml": { yaml: { schemaVersion: 2, name: "fixture", members: [fx.ref], teams: { global: { description: "Fixture team" } },
    packages: { "acme.pkg": `${pkg.ref}@v1.0.0` },
    defaults: { knowledge: "none", messaging: { chat: { from: fx.key } }, tasks: "none",
      capabilities: { "acme.ws": { from: fx.key }, "acme-tool": { from: "package" } } } } } }, "origins");
  assert.equal(fx.cli(["sync", "--json"]).status, 0);
  return fx;
}
const composedFromOf = (preview) => Object.fromEntries(preview.modules.map((m) => [m.name, m.composedFrom]));

test("preview-composed-from: every modules[] row says why it is there — the soul, or the workspace defaults (a slot default, defaults.capabilities)", (t) => {
  const fx = origins(t);
  const preview = ok(fx.cli(["spawn", "dev", "--preview", "--json"]));
  assert.deepEqual(composedFromOf(preview), { "acme-tool": "soul", "acme.own": "soul", "acme.ws": "workspace", chat: "workspace" });
  const tool = preview.modules.find((m) => m.name === "acme-tool");
  assert.equal(tool.from.kind, "member", "the soul's entry overrode the workspace's package default of the same name: its own `from` won, and so did its origin");
  // Agreement: the preview says what inspect --soul says, capability by capability.
  const inspect = ok(fx.cli(["inspect", "--soul", "dev", "--json"]));
  assert.deepEqual(composedFromOf(preview), Object.fromEntries(inspect.capabilities.map((c) => [c.id, c.composedFrom])));
});

test("preview-composed-from: a package soul's own `from: here` capability is the soul's", (t) => {
  const fx = origins(t);
  const preview = ok(fx.cli(["spawn", "acme.pkg/keeper", "--preview", "--json"]));
  assert.deepEqual(composedFromOf(preview), { "acme-tool": "soul", "acme.ws": "workspace", chat: "workspace" });
  assert.deepEqual(preview.modules.find((m) => m.name === "acme-tool").from.kind, "package", "keeper's `from: here` is its package");
});

test("preview-composed-from: the same decision under two origins — a module's origin moves composedFrom and no fingerprint (positive control)", async (t) => {
  // One capability at one source, reached two ways: declared by the soul (over a workspace default of the same
  // capability at the same source), and, in a copy of the same discovery whose soul entry drops that
  // declaration (same soul, same commit), through defaults.capabilities alone. Everything else is identical.
  const fx = v2Deployment({
    souls: { dev: { soul: { capabilities: { "acme.x": { from: "here" } } } } },
    capabilities: { "acme.x": { manifest: {} } },
  });
  t.after(fx.cleanup);
  fx.commit({ "oats-workspace.yaml": { yaml: { schemaVersion: 2, name: "fixture", members: [fx.ref], teams: { global: { description: "Fixture team" } },
    defaults: { knowledge: "none", messaging: "none", tasks: "none", capabilities: { "acme.x": { from: fx.key } } } } } }, "acme.x by default");
  assert.equal(fx.cli(["sync", "--json"]).status, 0);
  const saved = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = saved; });
  const { prepareInstance, ensureWorkspaceSoul, modulesPreview, toCapabilityRows } = await import("../lib/instance-resolution.mjs");
  const { findAgent, spawnInstanceAsync } = await import("../lib/core.mjs");
  // The CLI's own wiring of a prepared spawn (bin/oats.mjs): `preview` is the preview's modules[], the rest the apply's rows.
  // In-process, because only here can the soul's declaration change while its commit (fingerprinted) does not.
  const prepare = (discovery) => fx.inEnv(async () => {
    const prepared = await prepareInstance(fx.dep, "dev", { remoteOptions: fx.remoteOptions, ...(discovery ? { discovery } : {}) });
    await ensureWorkspaceSoul(prepared, fx.root);
    return Object.assign(prepared, { capabilityRows: [], preview: modulesPreview(prepared.resolution, fx.root, "dev"), toCapabilityRows });
  });
  const bySoul = await prepare();
  const discovery = structuredClone(bySoul.discovery);
  const entry = discovery.members.flatMap((m) => m.souls).find((s) => s.name === "dev");
  delete entry.definition.capabilities["acme.x"];
  const byWorkspace = await prepare(discovery);
  assert.equal(byWorkspace.soulEntry.commit, bySoul.soulEntry.commit, "the same soul at the same commit");
  const opts = (prepared, extra = {}) => ({ prepared, purpose: "x", work: "directory", repo: fx.dep, launch: false, ...extra });
  const spawn = (prepared, extra) => fx.inEnv(() => spawnInstanceAsync(fx.root, findAgent(fx.root, "dev"), opts(prepared, extra)));
  const a = await spawn(bySoul, { preview: true }), b = await spawn(byWorkspace, { preview: true });
  assert.deepEqual([composedFromOf(a), composedFromOf(b)], [{ "acme.x": "soul" }, { "acme.x": "workspace" }]);
  const strip = (p) => p.modules.map(({ composedFrom, ...rest }) => rest);
  assert.deepEqual(strip(a), strip(b), "the rows differ only in composedFrom");
  for (const k of ["resolution", "declRevision", "payloadRevision", "decision"]) assert.deepEqual(a[k], b[k], `${k} is the same`);
  // The decision previewed with one origin binds the apply with the other: `expectDecision` is what
  // --expect-decision hands spawnInstanceAsync, the same E_DECISION_STALE check.
  const applied = await spawn(byWorkspace, { expectDecision: a.decision.revision });
  assert.equal(applied.instance, a.decision.instance);
});

test("feature preview-composed-from is advertised, after launch-preference", (t) => {
  const fx = v2Deployment(); t.after(fx.cleanup);
  const { features } = JSON.parse(fx.cli(["version", "--json"]).stdout);
  assert.equal(features.indexOf("preview-composed-from"), features.indexOf("launch-preference") + 1);
});

// ---- Feature souls-capabilities (0.45.0): each `oats souls --json` row says what the soul's resolution
// composes — the same resolution `spawnable` comes from — keyed like `oats capabilities` rows, with `from`.

/** dev composes from every place: its own member capabilities (acme.own, acme_z), a workspace default it also
 *  declares (acme.ws), a messaging slot default (chat) and a package default (acme-tool); it turns a workspace
 *  default off (acme.off) and empties the knowledge slot the workspace fills (notes). acme_z sorts after
 *  acme.own by codepoint and before it under a locale compare. The package's keeper declares acme-tool itself. */
function soulCapabilities(t) {
  const pkg = packageRepo(); t.after(pkg.cleanup);
  const fx = v2Deployment({
    souls: { dev: { soul: { knowledge: "none", capabilities: { "acme.own": { from: "here" }, acme_z: { from: "here" }, "acme.ws": { from: "here" }, "acme.off": "off" } } } },
    capabilities: { ...Object.fromEntries(["acme.own", "acme_z", "acme.ws", "acme.off"].map((id) => [id, { manifest: {} }])),
      notes: { manifest: { layer: "knowledge" } }, chat: { manifest: { layer: "messaging" } } },
  });
  t.after(fx.cleanup);
  fx.commit({ "oats-workspace.yaml": { yaml: { schemaVersion: 2, name: "fixture", members: [fx.ref], teams: { global: { description: "Fixture team" } },
    packages: { "acme.pkg": `${pkg.ref}@v1.0.0` },
    defaults: { knowledge: { notes: { from: fx.key } }, messaging: { chat: { from: fx.key } }, tasks: "none",
      capabilities: { "acme.ws": { from: fx.key }, "acme.off": { from: fx.key }, "acme-tool": { from: "package" } } } } } }, "soul capabilities");
  assert.equal(fx.cli(["sync", "--json"]).status, 0);
  return fx;
}

test("souls-capabilities: a soul row lists what its resolution composes, by name in codepoint order, keyed like capability rows, with from", (t) => {
  const fx = soulCapabilities(t);
  const souls = ok(fx.cli(["souls", "--json"])).souls;
  const dev = souls.find((s) => s.name === "dev");
  assert.equal(dev.spawnable, true, JSON.stringify(dev.problem));
  assert.deepEqual(dev.capabilities, [
    { name: "acme-tool", kind: "package", package: "acme.pkg", from: "workspace" },
    { name: "acme.own", kind: "member", repoKey: fx.key, from: "soul" },
    { name: "acme.ws", kind: "member", repoKey: fx.key, from: "soul" },
    { name: "acme_z", kind: "member", repoKey: fx.key, from: "soul" },
    { name: "chat", kind: "member", repoKey: fx.key, from: "workspace" },
  ], "acme.off (off) and notes (knowledge: none) are absent; acme.ws, defaulted and declared, appears once as the soul's");
  const keeper = souls.find((s) => s.qualifiedName === "acme.pkg/keeper");
  assert.deepEqual(keeper.capabilities.find((c) => c.name === "acme-tool"), { name: "acme-tool", kind: "package", package: "acme.pkg", from: "soul" });
  // The same composition a spawn of it previews.
  assert.deepEqual(dev.capabilities.map((c) => [c.name, c.from]), ok(fx.cli(["spawn", "dev", "--preview", "--json"])).modules.map((m) => [m.name, m.composedFrom]));
  // Each entry names exactly one `oats capabilities` row.
  const rows = ok(fx.cli(["capabilities", "--json"])).capabilities;
  for (const s of souls) for (const c of s.capabilities) {
    const hits = rows.filter((r) => r.name === c.name && r.kind === c.kind && (c.kind === "package" ? r.package === c.package : r.repoKey === c.repoKey));
    assert.equal(hits.length, 1, `${s.name}: ${JSON.stringify(c)} matches ${hits.length} capability rows`);
  }
});

test("souls-capabilities: a slot conflict is not spawnable, and its capabilities are null", (t) => {
  const fx = v2Deployment({
    souls: { dev: {}, clash: { soul: { capabilities: { one: { from: "here" }, two: { from: "here" } } } } },
    capabilities: { one: { manifest: { layer: "tasks" } }, two: { manifest: { layer: "tasks" } } },
  });
  t.after(fx.cleanup);
  const rows = Object.fromEntries(ok(fx.cli(["souls", "--json"])).souls.map((s) => [s.name, s]));
  assert.deepEqual([rows.clash.spawnable, rows.clash.problem.code, rows.clash.capabilities], [false, "E_SLOT_CONFLICT", null]);
  assert.ok(Array.isArray(rows.dev.capabilities), "a resolvable soul beside it still lists its capabilities");
});

test("feature souls-capabilities is advertised, after automation-descriptions", (t) => {
  const fx = v2Deployment(); t.after(fx.cleanup);
  const { features } = JSON.parse(fx.cli(["version", "--json"]).stdout);
  assert.equal(features.indexOf("souls-capabilities"), features.indexOf("automation-descriptions") + 1);
});
