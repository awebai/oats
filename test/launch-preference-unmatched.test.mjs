// A key of oats-local.yaml `souls.launch` that names no soul refuses the launch the fall-through would
// decide (E_LAUNCH_PREFERENCE_UNMATCHED, awebai/oats#989). Before, the key was never read and the soul it
// was meant to pin ran on `souls.launch."*"`. The kernel cannot tell which soul such a key was meant for,
// so every new launch that names none and has no entry of its own is refused, and every reader of
// souls.launch says which keys and how to end it: `oats soul launch set`, then `remove`.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { packageRepo } from "./helpers/package-repo.mjs";
import { REF, soulFile, world } from "./helpers/memory-workspace.mjs";
import { isolateSessionEnvironment, oatsSocket, waitUntil } from "./helpers/host-fixture.mjs";
import { LAUNCH_PREFERENCE_UNMATCHED, LAUNCH_PROBLEM_TEXT_MAX, launchLayers, launchPreferenceUnmatched, selectionFrom, UNMATCHED_FIX } from "../lib/launch-preference.mjs";
import { launchReportFor, restartInstanceSession, selectNewLaunch, startInstanceSession } from "../lib/core.mjs";
import { discoverOrStandalone, findSoulEntry, prepareInstance, soulsOffered } from "../lib/instance-resolution.mjs";
import { soulKeyOf } from "../lib/teams.mjs";
// The 0.52 Desktop reads these answers unchanged: its decoders are the consumers.
import { launchOf, REPORT_FROM } from "../packages/client/launch-contract.mjs";
import { soulsData } from "../packages/client/deployment-data.mjs";
import { previewFailure } from "../packages/client/spawn-preview-contract.mjs";

const CODE = LAUNCH_PREFERENCE_UNMATCHED;
const LOCAL = "oats-local.yaml";
const at = (key) => `${LOCAL}#/souls/launch/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
const OPUS = { harness: "claude", model: "claude-opus-5-5" };
const CONFIGS = { private: { harness: "claude", model: "claude-opus-5-5" }, fast: { harness: "pi" } };
/** The same configurations as a deployment's reader gives them to a report (launchConfigsAt): each with its name. */
const NAMED = Object.fromEntries(Object.entries(CONFIGS).map(([name, config]) => [name, { name, ...config }]));
const row = (key, value, suggestions = []) => ({ key, at: at(key), value, suggestions });

/* ───────────────────────────── the refusal, over layers ───────────────── */

const offered = (keys, unread = {}) => ({ keys, unread: { all: null, bare: null, packages: {}, ...unread } });
const ENTRY = { repoKey: "github.com/acme/agents", path: "souls/planner" };
/** The layers of soul `planner` over a souls.launch and a read that offers `keys`. */
const layersOf = (launch, { keys = ["planner", "example.pkg/reviewer"], definition = {}, key = "planner", unread } = {}) =>
  launchLayers({ definition, entry: ENTRY, key, local: { souls: { launch } }, offered: offered(keys, unread) });
const refusal = (layers, flags = {}) => { try { selectNewLaunch({ launchConfigs: CONFIGS, flags, layers }); return null; } catch (e) { return e; } };

test("the layers carry the unmatched keys, and the refusal is the proposal's: its code, its details, a remedy in order", () => {
  const layers = layersOf({ "*": "fast", "example.okf/reviewer": "private" });
  const keys = [row("example.okf/reviewer", "private", ["example.pkg/reviewer"])];
  assert.deepEqual([layers.key, layers.unmatched], ["planner", keys]);
  const e = refusal(layers);
  // The code and the bound of each text are the module's own constants, which the constructor uses.
  assert.deepEqual([LAUNCH_PREFERENCE_UNMATCHED, LAUNCH_PROBLEM_TEXT_MAX], ["E_LAUNCH_PREFERENCE_UNMATCHED", 1024]);
  assert.equal(e.code, "E_LAUNCH_PREFERENCE_UNMATCHED");
  assert.ok(UNMATCHED_FIX.length <= LAUNCH_PROBLEM_TEXT_MAX);
  assert.deepEqual(e.details, { soul: "planner", from: "local-default", at: at("*"), keys, fix: UNMATCHED_FIX });
  assert.equal(e.details.fix, "pin the soul each key was meant for (oats soul launch set), then remove the key (oats soul launch remove <key>); or name this launch with --launch-config <name> or --harness <h>");
  assert.equal(e.message, `oats-local.yaml souls.launch names "example.okf/reviewer" (nearest: example.pkg/reviewer), which is no soul this workspace offers. A new launch of planner that names no launch has no entry of its own, so souls.launch."*" would decide it, and the kernel cannot tell which soul that key was meant to pin: it is refused, and nothing was created or started. Pin the soul it was meant for (oats soul launch set <soul> --launch-config <name> | --harness <h>), then remove the key (oats soul launch remove example.okf/reviewer); or name this launch (--launch-config <name> or --harness <h>).`);
  // The remedy's order is set, then remove.
  assert.ok(e.message.indexOf("oats soul launch set") < e.message.indexOf("oats soul launch remove"));
  // Without a read of the workspace the layers say nothing: no caller computes it for them.
  assert.deepEqual(launchLayers({ definition: {}, entry: ENTRY, key: "planner", local: { souls: { launch: { ghost: "fast" } } } }).unmatched, []);
});

test("which launches are refused: the fall-through decides (\"*\", the soul's launch, the host default), --model alone included; an own entry, --launch-config and --harness go on", () => {
  const ghost = { ghost: "private" };
  // The three layers below a soul's own entry.
  for (const [launch, definition, from, where] of [
    [{ ...ghost, "*": "fast" }, { launch: OPUS }, "local-default", at("*")],
    [ghost, { launch: OPUS }, "soul", "github.com/acme/agents:souls/planner/soul.yaml#/launch"],
    [ghost, {}, "host", null],
  ]) {
    const e = refusal(layersOf(launch, { definition }));
    assert.deepEqual([e?.code, e?.details.from, e?.details.at, e?.details.keys], [CODE, from, where, [row("ghost", "private")]], from);
    assert.equal(/[\n\r]/.test(e.message + e.details.fix), false);
  }
  assert.match(refusal(layersOf(ghost, { definition: { launch: OPUS } })).message, / so the soul's own launch would decide it, /);
  assert.match(refusal(layersOf(ghost)).message, / so the host default would decide it, /);
  // --model names no launch: it keeps the deciding layer's harness.
  assert.equal(refusal(layersOf({ ...ghost, "*": "fast" }), { model: "o4" })?.code, CODE);
  // The launch is named, or the soul has its own entry: neither can be the one the key was meant for.
  const star = layersOf({ ...ghost, "*": "fast" });
  assert.equal(refusal(star, { launchConfig: "private" }), null);
  assert.equal(refusal(star, { harness: "codex" }), null);
  assert.equal(refusal(star, { harness: "codex", model: "o4" }), null);
  assert.equal(refusal(layersOf({ ...ghost, "*": "fast", planner: "private" })), null);
  // Only "*", or no souls.launch: nothing to report, nothing refused.
  for (const launch of [{ "*": "fast" }, {}]) {
    const layers = layersOf(launch);
    assert.deepEqual([layers.unmatched, refusal(layers)], [[], null]);
  }
  // A key the read could not check refuses nothing.
  const unchecked = layersOf({ ghost: "private", "*": "fast" }, { unread: { bare: "member-unconfirmed" } });
  assert.deepEqual([unchecked.unmatched, refusal(unchecked)], [[], null]);
});

test("it comes before the refusals that describe the fall-through launch, and a report carries it as problem with effective unchanged", () => {
  // "*" names a configuration this host does not have: alone that is E_LAUNCH_CONFIG_UNKNOWN.
  assert.equal(refusal(layersOf({ "*": "gone" }))?.code, "E_LAUNCH_CONFIG_UNKNOWN");
  assert.equal(refusal(layersOf({ "*": "gone", ghost: "private" }))?.code, CODE);
  // The report: what the fall-through would have given, and the refusal as {code, message, fix}.
  const layers = layersOf({ "*": "private", ghost: "fast" });
  const report = launchReportFor({ layers, launchConfigs: NAMED, contextDir: tmpdir() });
  const e = launchPreferenceUnmatched({ choice: selectionFrom({ layers }), layers });
  assert.deepEqual(Object.keys(report), ["declared", "effective", "from", "at", "problem"]);
  assert.deepEqual([report.effective, report.from, report.at], [{ harness: "claude", model: "claude-opus-5-5", launchConfig: "private" }, "local-default", at("*")]);
  assert.deepEqual(report.problem, { code: CODE, message: e.message, fix: UNMATCHED_FIX });
  assert.notEqual(launchOf(report, REPORT_FROM), undefined, "the Desktop's Launch reader decodes it");
  // A soul with its own entry reports no such problem.
  assert.equal(launchReportFor({ layers: layersOf({ "*": "private", ghost: "fast", planner: "fast" }), launchConfigs: NAMED, contextDir: tmpdir() }).problem?.code ?? null, null);
});

test("the message names at most three keys, then \"and K more\", and stays within 1024 characters whatever the file holds; details.keys is complete", () => {
  const five = layersOf({ "*": "fast", e: "fast", d: "fast", c: "fast", b: "fast", a: "fast" });
  const e5 = refusal(five);
  assert.match(e5.message, /^oats-local\.yaml souls\.launch names "a", "b", "c" and 2 more, which are no soul this workspace offers\. /);
  assert.match(e5.message, / which soul those keys were meant to pin: .* Pin the soul each was meant for /);
  assert.deepEqual(e5.details.keys.map((k) => k.key), ["a", "b", "c", "d", "e"]);
  assert.match(refusal(layersOf({ b: "fast", a: "fast" })).message, /^oats-local\.yaml souls\.launch names "a" and "b", which are /);
  // Fifty keys as long as the schema allows a name to be: the sentence is bounded, the data is whole.
  const long = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`${String(i).padStart(2, "0")}${"k".repeat(62)}.pkg/${"s".repeat(64)}`, { harness: "claude", model: "m".repeat(200) }]));
  for (const launch of [{ "*": "fast", ...long }, long]) {
    const layers = layersOf(launch, { keys: ["planner", ...Object.keys(long).slice(0, 3).map((k) => `other.pkg/${k.slice(k.indexOf("/") + 1)}`)] });
    const e = refusal(layers);
    assert.ok(e.message.length <= LAUNCH_PROBLEM_TEXT_MAX, `the message is ${e.message.length} characters`);
    assert.ok(e.details.fix.length <= LAUNCH_PROBLEM_TEXT_MAX);
    assert.match(e.message, / more, which are no soul this workspace offers\. /);
    assert.match(e.message, /\(oats soul launch set .*\(oats soul launch remove /, "the remedy stays in the sentence");
    assert.deepEqual(e.details.keys.map((k) => k.key), Object.keys(long).sort());
    const report = launchReportFor({ layers, launchConfigs: NAMED, contextDir: tmpdir() });
    assert.equal(report.problem.message, e.message);
    assert.notEqual(launchOf(report, REPORT_FROM), undefined, "the Desktop's Launch reader decodes it");
  }
  // One key longer than the bound allows a sentence to name: still bounded.
  const huge = refusal(layersOf({ ["x".repeat(2000)]: "fast" }));
  assert.ok(huge.message.length <= LAUNCH_PROBLEM_TEXT_MAX && huge.details.keys[0].key.length === 2000);
});

/* ───────────────────────────── told apart, through the spawn's read ───── */

/** What a spawn of `soul` decides over a workspace held in memory: prepareInstance (the spawn's own
 *  preparation, with this read of the workspace), then the selection. → the refusal, or null.
 *  `resolve: false` is for a standalone view, whose resolution needs a locked package this fixture does
 *  not hold: the layers are then built here as prepareInstance builds them, from the same read. */
async function spawnOver(w, soul, launch, { local = {}, flags = {}, ref = REF("agents"), resolve: resolved = true } = {}) {
  const config = { schemaVersion: 2, workspace: ref, ...local, souls: { ...(local.souls ?? {}), launch } };
  const discovery = await discoverOrStandalone(config, { lock: w.lock, remote: w.remote });
  const entry = findSoulEntry(discovery, soul);
  const prepared = resolved ? await prepareInstance(tmpdir(), soul, { local: config, remote: w.remote, discovery })
    : { discovery, launch: launchLayers({ definition: entry.definition, entry, key: soulKeyOf(entry), local: config, offered: soulsOffered(discovery) }) };
  try { selectNewLaunch({ launchConfigs: CONFIGS, flags, layers: prepared.launch }); return { refused: null, prepared }; }
  catch (e) { return { refused: e, prepared }; }
}

test("unmatched: a package key beside a soul of that bare name elsewhere, a key with nothing near, <member>/<soul>", async () => {
  // acme.pkg (locked, read) offers keeper; `agents` offers reviewer and planner, `platform` reviewer and builder.
  const beside = await spawnOver(world(), "planner", { "*": "fast", "other.pkg/keeper": "private" });
  assert.deepEqual([beside.refused?.code, beside.refused?.details.keys], [CODE, [row("other.pkg/keeper", "private", ["acme.pkg/keeper"])]]);
  assert.equal(beside.refused.details.keys[0].suggestions[0], "acme.pkg/keeper", "the soul of that bare name under another package comes first");
  const lone = await spawnOver(world(), "planner", { "*": "fast", quartermaster: "private" });
  assert.deepEqual(lone.refused?.details.keys, [row("quartermaster", "private", [])]);
  // A member's soul is keyed by its bare name: <member>/<soul> can never match, and suggests that name.
  const qualified = await spawnOver(world(), "builder", { "platform/builder": { harness: "codex" } });
  assert.deepEqual([qualified.refused?.code, qualified.refused?.details.from, qualified.refused?.details.keys], [CODE, "host", [row("platform/builder", { harness: "codex", model: null }, ["builder"])]]);
  // No "*": the soul's own launch would decide (planner declares one).
  const own = await spawnOver(world(), "planner", { quartermaster: "private" });
  assert.deepEqual([own.refused?.code, own.refused?.details.from, own.refused?.details.soul], [CODE, "soul", "planner"]);
  // Only "*": nothing refused.
  assert.equal((await spawnOver(world(), "planner", { "*": "fast" })).refused, null);
  // The soul's own entry, --launch-config, --harness: go on. --model alone: refused.
  const launch = { "*": "fast", quartermaster: "private" };
  assert.equal((await spawnOver(world(), "planner", { ...launch, planner: "private" })).refused, null);
  assert.equal((await spawnOver(world(), "planner", launch, { flags: { launchConfig: "private" } })).refused, null);
  assert.equal((await spawnOver(world(), "planner", launch, { flags: { harness: "codex" } })).refused, null);
  assert.equal((await spawnOver(world(), "planner", launch, { flags: { model: "o4" } })).refused?.code, CODE);
  // A package soul without an entry is refused under its qualified key.
  assert.equal((await spawnOver(world(), "acme.pkg/keeper", launch)).refused?.details.soul, "acme.pkg/keeper");
});

test("not unmatched, each going on: a disabled soul's key, and every key the read could not check", async () => {
  const goesOn = async (w, launch, options = {}, soul = "planner") => {
    const r = await spawnOver(w, soul, { "*": "fast", ...launch }, options);
    assert.equal(r.refused, null, r.refused?.message);
    return r.prepared;
  };
  // The key of a soul in souls.disabled matches: souls.disabled is not consulted.
  await goesOn(world(), { builder: "private", "acme.pkg/keeper": "private" }, { local: { souls: { disabled: ["builder", "acme.pkg/keeper"] } } });
  // A member that cannot be confirmed: a bare key may be a soul of it.
  const unconfirmed = await goesOn(world((repos) => { delete repos.platform.files["oats-membership.yaml"]; }), { ghost: "private" });
  assert.equal(unconfirmed.discovery.members.some((m) => m.confirmed === false), true, "the member's row says so, as before");
  // A member soul that failed to read, and an external soul that cannot be read.
  const skipped = await goesOn(world((repos) => { repos.platform.files["souls/ghost/soul.yaml"] = { schemaVersion: 2, name: "Not A Slug" }; }), { ghost: "private" });
  assert.ok(skipped.discovery.problems.some((p) => /souls\/ghost/.test(`${p.path} ${p.message}`)), "the read's problem is there, as before");
  await goesOn(world((repos, workspace) => { repos.experts = { files: {} }; workspace.external = [{ source: `${REF("experts")}@${"9".repeat(40)}`, soul: "souls/auditor" }]; }), { ghost: "private" });
  // A package declared and not locked: <that package>/… is unchecked.
  await goesOn(world((repos, workspace) => { workspace.packages["new.pkg"] = "v2.0.0"; }), { "new.pkg/x": "private" });
  // A locked package one of whose souls failed to read.
  await goesOn(world((repos, workspace, lock) => { lock.packages["acme.pkg"].souls.push({ name: "gone", path: "souls/gone", digest: `sha256-${"0".repeat(64)}` }); }), { "acme.pkg/other": "private" });
  // …while a bare key is still checked there, and a key under a package that is read is unmatched.
  const mixed = await spawnOver(world((repos, workspace) => { workspace.packages["new.pkg"] = "v2.0.0"; }), "planner", { "*": "fast", "new.pkg/x": "private", "acme.pkg/gone": "private" });
  assert.deepEqual(mixed.refused?.details.keys.map((k) => k.key), ["acme.pkg/gone"]);
  // The standalone view of a workspace whose host cannot be read: every key is unchecked.
  const alone = world((repos) => { repos.agents.unreadable = true; });
  const view = await goesOn(alone, { ghost: "private", "acme.pkg/gone": "private", "platform/builder": "private" }, { ref: REF("platform"), resolve: false }, "builder");
  assert.deepEqual([view.discovery.standalone, view.discovery.standaloneReason], [true, "unreadable-host"]);
  // An explicit standalone: is the configured view: what it offers is known, so a key that names none of it refuses.
  const explicit = await spawnOver(world(), "builder", { "*": "fast", ghost: "private" }, { local: { standalone: REF("platform") }, resolve: false });
  assert.equal(explicit.refused?.code, CODE);
});

/* ───────────────────────────── the readers, through the CLI ───────────── */

function deployment(t, { local = {}, souls, workspace = {} } = {}) {
  return v2Deployment({ t, name: "acme", workspace, souls: souls ?? { dev: {}, writer: { soul: { launch: OPUS } }, runner: {} }, local: { "launch-configs": CONFIGS, ...local } });
}
/** The one envelope of a `--json` answer: stdout is exactly one compact JSON object. */
function envelope(r) {
  const doc = JSON.parse(r.stdout);
  assert.equal(r.stdout.trim(), JSON.stringify(doc), `stdout is one compact JSON object: ${r.stdout}`);
  return doc;
}
const ok = (r, what) => { const j = envelope(r); assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`); assert.equal(j.ok, true, `${what}: ${r.stdout}`); return j.result; };
const refused = (r, code, what) => { const j = envelope(r); assert.equal(j.ok, false, `${what}: ${r.stdout}`); assert.notEqual(r.status, 0, what); assert.equal(j.error.code, code, `${what}: ${r.stdout}`); return j.error; };
const localOf = (fx) => readFileSync(join(fx.dep, LOCAL), "utf8");
const setLocal = (fx, edit) => { const v = YAML.parse(localOf(fx)); edit(v); writeFileSync(join(fx.dep, LOCAL), YAML.stringify(v, { lineWidth: 0 })); };
const preview = (fx, soul, ...flags) => fx.cli(["spawn", soul, "--preview", ...flags, "--json"]);
/** Everything under a directory, as sorted relative paths. */
function tree(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) tree(p, base, out); else out.push(p.slice(base.length + 1)); }
  return out.sort();
}

test("oats spawn, preview and apply: the same code and details, and after the refused apply no home, no worktree and no event; the remedy in its order makes it go on", (t) => {
  const pkg = packageRepo({ souls: { reviewer: {} } });
  t.after(pkg.cleanup);
  const fx = deployment(t, { local: { souls: { launch: { "*": "fast", "acme.okf/reviewer": "private", writer: "private" } } } });
  fx.commit({ "oats-workspace.yaml": { yaml: { schemaVersion: 2, name: "acme", members: [fx.ref], packages: { "acme.pkg": `${pkg.ref}@v1.0.0` }, teams: { global: { description: "Fixture team" } }, defaults: { knowledge: "none", messaging: "none", tasks: "none" } } } });
  ok(fx.cli(["sync", "--json"]), "sync");
  const keys = [row("acme.okf/reviewer", "private", ["acme.pkg/reviewer"])];
  // Preview: refused, with the decided details.
  const p = refused(preview(fx, "dev"), CODE, "preview");
  assert.deepEqual(p.details, { soul: "dev", from: "local-default", at: at("*"), keys, fix: UNMATCHED_FIX });
  assert.match(p.message, /^oats-local\.yaml souls\.launch names "acme\.okf\/reviewer" \(nearest: acme\.pkg\/reviewer\), which is no soul this workspace offers\. A new launch of dev that names no launch /);
  // The Desktop's preview reader keeps the kernel's code, message and fix.
  assert.deepEqual(previewFailure(p.code, null, p.message, p.details.fix).reason, { code: CODE, message: p.message, fix: UNMATCHED_FIX });
  // Apply: the same code and details, and nothing was created.
  const before = { agents: tree(fx.root), worktrees: execFileSync("git", ["-C", fx.member, "worktree", "list", "--porcelain"], { encoding: "utf8" }) };
  for (const argv of [["spawn", "dev", "--no-launch", "--name", "one", "--json"], ["spawn", "dev", "--name", "two", "--json"], ["spawn", "acme.pkg/reviewer", "--no-launch", "--json"]]) {
    const a = refused(fx.cli(argv), CODE, argv.join(" "));
    if (argv[1] === "dev") assert.deepEqual([a.message, a.details], [p.message, p.details]);
    else assert.deepEqual([a.details.soul, a.details.keys], ["acme.pkg/reviewer", keys]);
  }
  assert.deepEqual(tree(fx.root).filter((f) => /\/instances\//.test(f)), [], "no home, so no record and no event of an instance");
  // What an apply leaves before its selection is the soul's own copy, the per-commit cache every spawn of it reads.
  assert.deepEqual(tree(fx.root).filter((f) => !/^[^/]+\/(\.oats-soul-source\.json|soul|souls\/[0-9a-f]{12}\/[^/]+)$/.test(f)), before.agents.filter((f) => /\/instances\//.test(f)), "and nothing else under the agents root");
  assert.equal(execFileSync("git", ["-C", fx.member, "worktree", "list", "--porcelain"], { encoding: "utf8" }), before.worktrees, "no worktree");
  // --model alone names no launch; a named launch and a soul with its own entry go on.
  refused(preview(fx, "dev", "--model", "o4"), CODE, "--model alone");
  assert.equal(ok(preview(fx, "dev", "--launch-config", "private"), "--launch-config").launch.from, "flag");
  assert.equal(ok(preview(fx, "dev", "--harness", "codex"), "--harness").launch.from, "flag");
  assert.equal(ok(preview(fx, "writer"), "its own entry").launch.from, "local");
  // The remedy, as the message says it: set for the soul the key was meant for, then remove the key.
  const set = ok(fx.cli(["soul", "launch", "set", "acme.pkg/reviewer", "--launch-config", "private", "--json"]), "soul launch set");
  assert.deepEqual([set.key, set.launch.problem, set.unmatched], ["acme.pkg/reviewer", null, keys]);
  // Between the two commands the intended soul already spawns, on its pin; the others are still refused.
  const pinned = ok(preview(fx, "acme.pkg/reviewer"), "the intended soul, between set and remove");
  assert.deepEqual([pinned.launch.from, pinned.launch.effective.launchConfig], ["local", "private"]);
  refused(preview(fx, "dev"), CODE, "dev, between set and remove");
  const removed = ok(fx.cli(["soul", "launch", "remove", "acme.okf/reviewer", "--json"]), "soul launch remove");
  assert.deepEqual([removed.key, removed.unmatched], ["acme.okf/reviewer", []]);
  const after = ok(preview(fx, "dev"), "dev, after the remedy");
  assert.deepEqual([after.launch.from, after.launch.at, after.launch.problem], ["local-default", at("*"), null]);
  const spawned = ok(fx.cli(["spawn", "dev", "--no-launch", "--name", "one", "--json"]), "the apply goes on");
  assert.ok(existsSync(join(spawned.home, "instance.json")));
});

test("the workspace cannot be read: the read's own error, never this code", (t) => {
  const fx = deployment(t, { local: { souls: { launch: { "*": "fast", ghost: "private" } } } });
  refused(preview(fx, "dev"), CODE, "read: refused");
  writeFileSync(join(fx.dep, LOCAL), localOf(fx).replace(fx.ref, `file://${fx.repo}.gone`));
  refused(preview(fx, "dev"), "E_REMOTE_UNREADABLE", "unreadable: its own error");
  refused(fx.cli(["souls", "--json"]), "E_REMOTE_UNREADABLE", "oats souls, unreadable");
});

test("oats souls and oats inspect --soul: launch.problem on exactly the souls without their own entry, one problems row per key, and the Desktop's readers decode the real answers", (t) => {
  const fx = deployment(t, { local: { souls: { launch: { "*": "fast", runer: "private", "ws/dev": { harness: "codex", model: "o4" }, writer: "private" } } } });
  const r = fx.cli(["souls", "--json"]);
  const doc = ok(r, "souls");
  const by = Object.fromEntries(doc.souls.map((s) => [s.name, s.launch]));
  // writer has its own entry; dev and runner fall through.
  assert.deepEqual(Object.fromEntries(Object.entries(by).map(([name, launch]) => [name, launch.problem?.code ?? null])), { dev: CODE, runner: CODE, writer: null });
  assert.deepEqual([by.dev.effective, by.dev.from, by.dev.at], [{ harness: "pi", model: null, launchConfig: "fast" }, "local-default", at("*")], "effective stays the fall-through's");
  assert.deepEqual(Object.keys(by.dev.problem), ["code", "message", "fix"]);
  assert.equal(by.dev.problem.fix, UNMATCHED_FIX);
  assert.match(by.dev.problem.message, /^oats-local\.yaml souls\.launch names "runer" \(nearest: runner\) and "ws\/dev" \(nearest: dev\), which are no soul this workspace offers\. A new launch of dev /);
  // One row per unmatched key, sorted, beside the read's own problems.
  const rows = doc.problems.filter((p) => p.code === CODE);
  assert.deepEqual(rows.map(({ message, ...rest }) => rest), [
    { code: CODE, path: at("runer"), key: "runer", value: "private", suggestions: ["runner"] },
    { code: CODE, path: at("ws/dev"), key: "ws/dev", value: { harness: "codex", model: "o4" }, suggestions: ["dev"] },
  ]);
  assert.equal(rows[0].message, `oats-local.yaml souls.launch names "runer" (nearest: runner), which is no soul this workspace offers: a new launch of a soul with no entry of its own that names no launch is refused while it is there. Pin the soul it was meant for (oats soul launch set <soul> --launch-config <name> | --harness <h>), then remove the key (oats soul launch remove runer)`);
  for (const p of rows) assert.ok(p.message.length <= 1024 && !/[\n\r]/.test(p.message));
  assert.equal(doc.problems.some((p) => p.key === "*" || /\/souls\/launch\/\*$/.test(p.path ?? "")), false, "\"*\" is never reported");
  // The 0.52 Desktop's reader of this document decodes it, rows and launches.
  const read = soulsData(JSON.parse(r.stdout));
  assert.deepEqual(read.problems.filter((p) => p.code === CODE).map((p) => [p.code, p.path, p.message]), rows.map((p) => [p.code, p.path, p.message]));
  assert.deepEqual(read.souls.map((s) => [s.name, s.launch.problem?.code ?? null]), [["dev", CODE], ["runner", CODE], ["writer", null]]);
  // Text mode prints the rows under the table.
  const text = fx.cli(["souls"]);
  assert.equal(text.status, 0, text.stderr);
  const lines = text.stdout.trimEnd().split("\n");
  assert.deepEqual(lines.slice(-3), [`! ${CODE}: ${rows[0].message}`, "", `! ${CODE}: ${rows[1].message}`]);
  assert.ok(lines.findIndex((l) => /^\s*runner\b/.test(l)) < lines.findIndex((l) => l.startsWith("! ")), "under the table");
  // inspect --soul says what a spawn of that soul would be refused for.
  const dev = ok(fx.cli(["inspect", "--soul", "dev", "--json"]), "inspect --soul dev");
  assert.deepEqual(dev.launch, by.dev);
  assert.notEqual(launchOf(dev.launch, REPORT_FROM), undefined);
  assert.equal(ok(fx.cli(["inspect", "--soul", "writer", "--json"]), "inspect --soul writer").launch.problem, null);
  // Fifty long keys: the row per key, the bounded sentence on each soul, and the reader still decodes.
  setLocal(fx, (v) => { v.souls.launch = { "*": "fast", ...Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`${String(i).padStart(2, "0")}${"k".repeat(60)}`, "private"])) }; });
  const many = fx.cli(["souls", "--json"]);
  const big = ok(many, "souls, fifty keys");
  assert.equal(big.problems.filter((p) => p.code === CODE).length, 50);
  for (const s of big.souls) { assert.equal(s.launch.problem.code, CODE); assert.ok(s.launch.problem.message.length <= 1024); }
  assert.equal(soulsData(JSON.parse(many.stdout)).problems.filter((p) => p.code === CODE).length, 50);
  const e = refused(preview(fx, "dev"), CODE, "preview, fifty keys");
  assert.ok(e.message.length <= 1024);
  assert.equal(e.details.keys.length, 50, "details.keys is complete");
  // Only "*": no row, no problem.
  setLocal(fx, (v) => { v.souls.launch = { "*": "fast" }; });
  const clean = ok(fx.cli(["souls", "--json"]), "souls, only *");
  assert.deepEqual([clean.problems.filter((p) => p.code === CODE), clean.souls.map((s) => s.launch.problem)], [[], [null, null, null]]);
});

test("oats doctor: a problem per unmatched key from this machine's last read, with its remedy; an information line for a key it could not check and for a cache that cannot answer; never a failure of doctor", (t) => {
  const fx = deployment(t, { local: { souls: { launch: { "*": "fast", runer: "private", "ws/dev": "fast" } } } });
  // `oats doctor --json` prints its own document (workspaceApi 2), not the envelope.
  const doctor = () => { const r = fx.cli(["doctor", "--json"]); assert.equal(r.status, 0, r.stdout + r.stderr); const d = JSON.parse(r.stdout); assert.equal(d.workspaceApi, 2); return d; };
  const ours = (d) => ({ problems: (d.problems ?? []).filter((p) => p.code === CODE), information: d.information.filter((l) => l.startsWith("launch-preference-unchecked: ")) });
  // Nothing read yet on this machine: the cache cannot answer, and doctor says so as information.
  const cold = ours(doctor());
  assert.deepEqual(cold.problems, []);
  assert.equal(cold.information.length, 1);
  assert.match(cold.information[0], /^launch-preference-unchecked: the keys of oats-local\.yaml souls\.launch \("runer", "ws\/dev"\) were not checked against the souls this workspace offers: this machine's cache cannot answer /);
  // After a read (oats souls), the cache answers: one problem per key, with the command that fixes it.
  ok(fx.cli(["souls", "--json"]), "souls");
  const warm = ours(doctor());
  assert.deepEqual(warm.information, []);
  assert.deepEqual(warm.problems.map(({ message, ...rest }) => rest), [
    { code: CODE, key: "runer", at: at("runer"), value: "private", suggestions: ["runner"], remedy: "pin the soul it was meant for (oats soul launch set <soul> --launch-config <name> | --harness <h>), then: oats soul launch remove runer" },
    { code: CODE, key: "ws/dev", at: at("ws/dev"), value: "fast", suggestions: ["dev"], remedy: "pin the soul it was meant for (oats soul launch set <soul> --launch-config <name> | --harness <h>), then: oats soul launch remove ws/dev" },
  ]);
  // The row speaks about this machine's last read, and names the spawn as the authority.
  assert.equal(warm.problems[0].message, `oats-local.yaml souls.launch names "runer" (nearest: runner), which is no soul in this machine's last read of the souls this workspace offers. A spawn reads the workspace itself and is the authority: where it finds the same, a new launch of a soul with no entry of its own that names no launch is refused`);
  // Text mode: `! code: message`, the remedy under it, and doctor still exits 0.
  const text = fx.cli(["doctor"]);
  assert.equal(text.status, 0, text.stderr);
  assert.ok(text.stdout.includes(`\n! ${CODE}: ${warm.problems[0].message}\n  ${warm.problems[0].remedy}\n`), text.stdout);
  // A key the last read could not check (a member soul it skipped): information, not a problem.
  fx.commit({ "souls/ghost/soul.yaml": "schemaVersion: 2\nname: Not A Slug\n", "souls/ghost/AGENTS.md": "# ghost\n" });
  ok(fx.cli(["souls", "--json"]), "souls, after the member moved");
  const skipped = ours(doctor());
  assert.deepEqual(skipped.problems.map((p) => p.key), ["ws/dev"], "a qualified key is still checked");
  assert.deepEqual(skipped.information, [`launch-preference-unchecked: oats-local.yaml souls.launch "runer" was not checked against the souls this workspace offers: a member's or an external soul could not be read, and the key may be that soul's; this is this machine's last read, and a spawn reads the workspace itself`]);
  const said = fx.cli(["doctor"]);
  assert.equal(said.status, 0);
  assert.ok(said.stdout.includes(`\nINFO: ${skipped.information[0]}\n`), said.stdout);
  // Only "*", or no key at all: nothing is said.
  setLocal(fx, (v) => { v.souls.launch = { "*": "fast" }; });
  assert.deepEqual(ours(doctor()), { problems: [], information: [] });
});

/* ───────────────────────────── a start that selects again ─────────────── */
// Real tmux on a private socket, and a harness that records its PID and idles.

const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-unmatched-session-")));
const restoreEnvironment = isolateSessionEnvironment(base);
const socket = oatsSocket();
const session = "u";
const tmux = (...args) => execFileSync("tmux", ["-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const windows = () => { try { return tmux("list-windows", "-t", session, "-F", "#{window_name}").split("\n").filter(Boolean); } catch { return []; } };
const binDir = join(base, "bin"); mkdirSync(binDir);
for (const name of ["polite", "claude", "pi", "codex"]) { writeFileSync(join(binDir, name), `#!/bin/sh\necho $$ > "$OATS_INSTANCE_HOME/pid.txt"\nexec sleep 86400\n`); chmodSync(join(binDir, name), 0o755); }
process.env.PATH = `${binDir}:${process.env.PATH}`;
const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const sessionEnv = (fx) => { const e = { ...process.env, PATH: `${binDir}:${process.env.PATH}`, OATS_HOME_DIR: join(base, "oats-home"), OATS_REMOTE_CACHE: fx.env.OATS_REMOTE_CACHE }; for (const k of ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT"]) delete e[k]; return e; };
const oats = (fx, args) => spawnSync(process.execPath, [CLI, ...args, "--json"], { encoding: "utf8", env: sessionEnv(fx) });
const runningPid = (home) => {
  try {
    const text = readFileSync(join(home, "pid.txt"), "utf8").trim();
    const pid = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(pid) || pid <= 1) return null;
    process.kill(pid, 0);
    return pid;
  } catch { return null; }
};
test.after(() => { try { tmux("kill-server"); } catch { /* gone */ } finally { restoreEnvironment(); rmSync(base, { recursive: true, force: true }); } });

test("session start|restart --reselect-launch is refused like a spawn, before anything is stopped or started: the session that was running still runs; a plain restart, and one that names its harness, are unchanged", async (t) => {
  const fx = v2Deployment({ name: "acme", souls: { dev: {}, runner: {} }, local: { "launch-configs": { quiet: { harness: "claude", executable: join(binDir, "polite") } } } });
  // The fixture refuses to go while a process still works in it: end the panes first, then remove it
  // (its check gives a process that is exiting the time to go).
  t.after(() => { try { tmux("kill-server"); } catch { /* gone */ } fx.cleanup(); });
  // A home of dev with a recorded launch on the private socket, and its harness running.
  async function makeHome(name) {
    const { home } = await fx.spawn("dev", { name, work: "checkout", launch: false, harness: "claude", launchConfig: "none" });
    const command = `OATS_INSTANCE=${shq(name)} OATS_INSTANCE_HOME=${shq(home)} PI_AGENT_INSTANCE=${shq(name)} PI_AGENT_HOME=${shq(home)} ${shq(join(binDir, "polite"))} --dangerously-skip-permissions -- "$(cat TASK.md)"`;
    const meta = { ...JSON.parse(readFileSync(join(home, "instance.json"), "utf8")), harness: "claude", tmux: { session, window: name, socket }, launched: true, command,
      launch: { version: 2, harness: "claude", launchConfig: null, launchConfigSource: null, executable: join(binDir, "polite"), executableDeclared: null, executableResolvedFrom: "PATH", args: [], env: {}, model: null, yolo: true, hooks: { launch: {}, env: {}, contributions: [] }, prompt: { kind: "task-file", file: "TASK.md" } } };
    writeFileSync(join(home, "instance.json"), `${JSON.stringify(meta, null, 2)}\n`);
    const baselinePath = join(dirname(home), ".oats-retirement", "baselines", `${createHash("sha256").update(home).digest("hex")}.json`);
    writeFileSync(baselinePath, `${JSON.stringify({ ...JSON.parse(readFileSync(baselinePath, "utf8")), runtime: { launched: true, tmux: { session, window: name, socket } } }, null, 2)}\n`);
    return home;
  }
  const env = sessionEnv(fx);
  const home = await makeHome("dev-run");
  tmux("new-session", "-d", "-s", session, "-n", "hq", "-c", home);
  assert.equal(startInstanceSession(home, { env }).reused, "new");
  await waitUntil(() => runningPid(home) !== null, "the harness to be up");
  const pid = runningPid(home);
  const stopped = await makeHome("dev-idle");
  // souls.launch now holds a key that names no soul; dev has no entry of its own.
  setLocal(fx, (v) => { v.souls = { launch: { "*": "quiet", runer: "quiet" } }; });
  const keys = [row("runer", "quiet", ["runner"])];
  for (const verb of ["restart", "start"]) {
    const r = oats(fx, ["session", verb, "--home", verb === "restart" ? home : stopped, "--reselect-launch"]);
    const e = refused(r, CODE, `session ${verb} --reselect-launch`);
    assert.deepEqual(e.details, { soul: "dev", from: "local-default", at: at("*"), keys, fix: UNMATCHED_FIX });
  }
  assert.equal(runningPid(home), pid, "the session that was running still runs, on the same harness");
  assert.equal(existsSync(join(home, ".oats-restart.json")), false, "no stop was attempted");
  assert.deepEqual(windows().sort(), ["dev-run", "hq"], "and nothing was started for the other home");
  // In process, a caller that reselects without the read of the workspace is refused too: never unchecked.
  assert.throws(() => restartInstanceSession(home, { reselectLaunch: true, env }), (e) => e.code === "E_BAD_ARGS" && /needs a read of the workspace's souls/.test(e.message));
  assert.equal(runningPid(home), pid);
  // If that read fails, its own error is the answer, and nothing is stopped.
  const text = localOf(fx);
  writeFileSync(join(fx.dep, LOCAL), text.replace(fx.ref, `file://${fx.repo}.gone`));
  refused(oats(fx, ["session", "restart", "--home", home, "--reselect-launch"]), "E_REMOTE_UNREADABLE", "the read fails");
  assert.equal(runningPid(home), pid);
  writeFileSync(join(fx.dep, LOCAL), text);
  // A start that names its harness consults no key, and a plain restart selects nothing again: both go on.
  ok(oats(fx, ["session", "restart", "--home", home, "--reselect-launch", "--harness", "claude", "--stop-grace", "5"]), "--reselect-launch --harness");
  await waitUntil(() => runningPid(home) !== null && runningPid(home) !== pid, "the named restart's harness");
  const second = runningPid(home);
  ok(oats(fx, ["session", "restart", "--home", home, "--stop-grace", "5"]), "a plain restart");
  await waitUntil(() => runningPid(home) !== null && runningPid(home) !== second, "the plain restart's harness");
  // The key removed, the same restart selects again from "*" and goes on.
  ok(oats(fx, ["soul", "launch", "remove", "runer", "--dir", fx.dep]), "soul launch remove");
  const third = runningPid(home);
  const again = ok(oats(fx, ["session", "restart", "--home", home, "--reselect-launch", "--stop-grace", "5"]), "--reselect-launch, after the remedy");
  assert.equal(again.launchConfig, "quiet");
  await waitUntil(() => runningPid(home) !== null && runningPid(home) !== third, "the reselected harness");
});
