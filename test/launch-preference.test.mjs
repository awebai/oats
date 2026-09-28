// Soul launch preferences (feature launch-preference, docs/design/2026-09-28-soul-launch-preference.md): a
// soul may declare `launch: {harness, model?}`; a machine overrides it in oats-local.yaml `souls.launch`
// (a soul key or "*" → a launch configuration's name or an inline {harness, model?}). For a NEW selection
// the first layer with a value decides — flags, souls.launch.<key>, souls.launch."*", the soul, the host
// default — and every report says which (`from`) and where (`at`). A home's recorded launch stays frozen:
// only --reselect-launch or a respawn applies a changed preference.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { launchLayers, selectionFrom, soulLaunchAt } from "../lib/launch-preference.mjs";
import { homeLaunchLayers, planLaunch } from "../lib/core.mjs";
// The Desktop's released decoder is the consumer: every Launch the kernel emits must decode under it.
import { launchOf, PREVIEW_FROM, RECORD_FROM, REPORT_FROM } from "../packages/desktop/renderer/launch-contract.mjs";
const decodes = (launch, from = REPORT_FROM) => assert.notEqual(launchOf(launch, from), undefined, `the Desktop refuses ${JSON.stringify(launch)}`);

const OPUS = { harness: "claude", model: "claude-opus-5-5" };
const LOCAL = "oats-local.yaml";

test("the precedence table: flags, souls.launch.<key>, souls.launch.\"*\", the soul's launch, the host default", () => {
  const entry = { repoKey: "github.com/acme/agents", path: "souls/dev" };
  const soulAt = "github.com/acme/agents:souls/dev/soul.yaml#/launch";
  const definition = { launch: OPUS };
  const local = (launch) => ({ souls: { launch } });
  const decide = (flags, layersIn) => { const c = selectionFrom({ flags, layers: layersIn }); return [c.from, c.at, c.selection.launchConfig ?? null, c.selection.harness ?? null, c.selection.model ?? null, c.preference]; };
  const all = launchLayers({ definition, entry, key: "dev", local: local({ "*": "fast", dev: { harness: "codex", model: "o4" } }) });
  assert.deepEqual(all.declared, { harness: "claude", model: "claude-opus-5-5" });
  // 1. flags: --launch-config or --harness decide; --model alone keeps the next layer's harness.
  assert.deepEqual(decide({ launchConfig: "big" }, all), ["flag", null, "big", null, null, null]);
  assert.deepEqual(decide({ harness: "pi" }, all), ["flag", null, null, "pi", null, null]);
  assert.deepEqual(decide({ model: "o3" }, all), ["local", `${LOCAL}#/souls/launch/dev`, "none", null, "o3", { harness: "codex", model: "o4", from: "local" }]);
  // 2. the soul's own entry, 3. "*", 4. the soul, 5. the host.
  assert.deepEqual(decide({}, all), ["local", `${LOCAL}#/souls/launch/dev`, "none", null, null, { harness: "codex", model: "o4", from: "local" }]);
  const star = launchLayers({ definition, entry, key: "dev", local: local({ "*": "fast" }) });
  assert.deepEqual(decide({}, star), ["local-default", `${LOCAL}#/souls/launch/*`, "fast", null, null, null]);
  const soul = launchLayers({ definition, entry, key: "dev", local: local({ other: "fast" }) });
  assert.deepEqual(decide({}, soul), ["soul", soulAt, "none", null, null, { ...OPUS, from: "soul" }]);
  const host = launchLayers({ definition: {}, entry, key: "dev", local: {} });
  assert.deepEqual([host.declared, decide({}, host)], [null, ["host", null, null, null, null, null]]);
  // A preference without a model is a unit: its harness, the harness's own model.
  const bare = launchLayers({ definition, entry, key: "dev", local: local({ dev: { harness: "codex" } }) });
  assert.deepEqual(decide({}, bare)[5], { harness: "codex", model: null, from: "local" });
  // A package soul: keyed <package>/<soul> (`/` escaped in `at`), its launch at package:<id>:<path>.
  const pkg = { package: "oats.engineering", qualifiedName: "oats.engineering/code-reviewer", path: "oats-package/souls/code-reviewer", repoKey: "github.com/awebai/oats-engineering" };
  assert.equal(soulLaunchAt(pkg), "package:oats.engineering:oats-package/souls/code-reviewer/soul.yaml#/launch");
  const p = launchLayers({ definition, entry: pkg, key: pkg.qualifiedName, local: local({ "oats.engineering/code-reviewer": { harness: "codex" } }) });
  assert.deepEqual([p.layer.from, p.layer.at], ["local", `${LOCAL}#/souls/launch/oats.engineering~1code-reviewer`]);
});

function fixture({ local = {}, souls } = {}) {
  return v2Deployment({
    name: "acme",
    souls: souls ?? { dev: {}, writer: { soul: { launch: OPUS } }, runner: {} },
    local: { "launch-configs": { opus: { harness: "claude", model: "claude-opus-5-5" }, fast: { harness: "pi" } }, ...local },
  });
}
const ok = (r, what) => { assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`); const j = r.json(); assert.equal(j.ok, true, `${what}: ${r.stdout}`); return j.result; };
const refused = (r, code, what) => { const j = r.json(); assert.equal(j.ok, false, `${what}: ${r.stdout}`); assert.equal(j.error.code, code, `${what}: ${r.stdout}`); return j.error; };
const setLocal = (fx, edit) => { const p = join(fx.dep, LOCAL); const v = YAML.parse(readFileSync(p, "utf8")); edit(v); writeFileSync(p, YAML.stringify(v, { lineWidth: 0 })); };

test("oats souls / inspect --soul / spawn --preview report the launch: declared, effective, from, at; spawn records it", async (t) => {
  const fx = fixture({ local: { souls: { launch: { runner: "opus", "*": { harness: "codex" } } } } }); t.after(fx.cleanup);
  const souls = Object.fromEntries(ok(fx.cli(["souls", "--json"]), "souls").souls.map((s) => [s.name, s]));
  const soulAt = `${fx.key}:souls/writer/soul.yaml#/launch`;
  // writer: the "*" override wins over its own launch; runner: its own entry names a configuration.
  assert.deepEqual(souls.writer.launch, { declared: OPUS, effective: { harness: "codex", model: null, launchConfig: null }, from: "local-default", at: `${LOCAL}#/souls/launch/*`, problem: null });
  assert.deepEqual(souls.runner.launch, { declared: null, effective: { harness: "claude", model: "claude-opus-5-5", launchConfig: "opus" }, from: "local", at: `${LOCAL}#/souls/launch/runner`, problem: null });
  assert.deepEqual([souls.runner.harness, souls.runner.model, souls.runner.harnessFrom], ["claude", "claude-opus-5-5", "local"], "the desktop facts equal the effective launch");
  for (const s of Object.values(souls)) decodes(s.launch);
  // Without the "*" entry, writer's own launch decides.
  setLocal(fx, (v) => { delete v.souls.launch["*"]; });
  const writer = ok(fx.cli(["inspect", "--soul", "writer", "--json"]), "inspect --soul").launch;
  assert.deepEqual(writer, { declared: OPUS, effective: { harness: "claude", model: "claude-opus-5-5", launchConfig: null }, from: "soul", at: soulAt, problem: null });
  const dev = ok(fx.cli(["souls", "--json"]), "souls").souls.find((s) => s.name === "dev");
  assert.deepEqual([dev.launch.effective, dev.launch.from, dev.harnessFrom], [{ harness: "pi", model: null, launchConfig: null }, "host", "kernel-default"]);

  // The preview carries the same report, flags applied; its top-level harness/model/launchConfig agree.
  const preview = ok(fx.cli(["spawn", "writer", "--preview", "--json"]), "preview");
  assert.deepEqual(preview.launch, writer);
  decodes(preview.launch, PREVIEW_FROM);
  assert.deepEqual([preview.harness, preview.model, preview.launchConfig, preview.modelSource], ["claude", "claude-opus-5-5", null, "soul preference"]);
  const flagged = ok(fx.cli(["spawn", "writer", "--harness", "pi", "--preview", "--json"]), "preview --harness");
  assert.deepEqual([flagged.launch.from, flagged.launch.at, flagged.launch.effective], ["flag", null, { harness: "pi", model: null, launchConfig: null }], "a flag decides; the soul's model never crosses to pi");
  decodes(flagged.launch, PREVIEW_FROM);
  const modelOnly = ok(fx.cli(["spawn", "writer", "--model", "sonnet", "--preview", "--json"]), "preview --model");
  assert.deepEqual([modelOnly.launch.from, modelOnly.launch.effective.harness, modelOnly.launch.effective.model], ["soul", "claude", "sonnet"], "--model alone keeps the soul's harness");

  // The spawn records what decided it.
  const { home } = await fx.spawn("writer", { instance: "writer-1" });
  const meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  assert.deepEqual([meta.harness, meta.model, meta.modelFrom, meta.launchFrom, meta.launchAt, meta.launchDeclared], ["claude", "claude-opus-5-5", "soul", "soul", soulAt, OPUS]);
  const { home: runnerHome } = await fx.spawn("runner", { instance: "runner-1" });
  const rmeta = JSON.parse(readFileSync(join(runnerHome, "instance.json"), "utf8"));
  assert.deepEqual([rmeta.harness, rmeta.launch.launchConfig, rmeta.modelFrom, rmeta.launchFrom], ["claude", "opus", "launch-config", "local"]);
});

test("an unavailable harness is refused naming its source and the fix — never a fallback; reports carry it as problem", (t) => {
  const fx = fixture({ local: { souls: { launch: { dev: { harness: "codex" } } } } }); t.after(fx.cleanup);
  // A PATH where codex does not exist (the stub removed; no host directories that could hold one).
  const stubs = join(fx.base, "runtime-stub");
  rmSync(join(stubs, "codex"));
  const PATH = `${stubs}:${dirname(process.execPath)}:/usr/bin:/bin`;
  const e = refused(fx.cli(["spawn", "dev", "--preview", "--json"], { env: { PATH } }), "E_HARNESS_UNAVAILABLE", "preview");
  assert.deepEqual(e.details, { harness: "codex", from: "local", at: `${LOCAL}#/souls/launch/dev`, fix: `install codex, or change ${LOCAL} souls.launch` });
  const row = ok(fx.cli(["souls", "--json"], { env: { PATH } }), "souls").souls.find((s) => s.name === "dev");
  assert.deepEqual([row.launch.problem.code, row.launch.problem.fix], ["E_HARNESS_UNAVAILABLE", `install codex, or change ${LOCAL} souls.launch`], "the soul still lists");
  decodes(row.launch);
  // From a flag, the fix names the flags; the soul's own launch names the override.
  const f = refused(fx.cli(["spawn", "dev", "--harness", "codex", "--preview", "--json"], { env: { PATH } }), "E_HARNESS_UNAVAILABLE", "flag");
  assert.deepEqual([f.details.from, f.details.at, f.details.fix], ["flag", null, "install codex, or choose another --harness / --launch-config"]);
  // A configuration the layer names but this oats-local.yaml lacks.
  setLocal(fx, (v) => { v.souls.launch.dev = "gone"; });
  assert.deepEqual(refused(fx.cli(["spawn", "dev", "--preview", "--json"]), "E_LAUNCH_CONFIG_UNKNOWN", "unknown config").details, { name: "gone", from: "local", at: `${LOCAL}#/souls/launch/dev` });
  // A malformed preference is a schema error naming the path.
  setLocal(fx, (v) => { v.souls.launch.dev = { harness: "claude", args: ["--x"] }; });
  const bad = refused(fx.cli(["souls", "--json"]), "E_WORKSPACE_SCHEMA", "schema");
  assert.match(bad.message, /souls\/launch\/dev\/args/);
});

test("a home's recorded launch is frozen: a changed preference shows as launchCurrent and launch-changed until --reselect-launch", async (t) => {
  const fx = fixture(); t.after(fx.cleanup);
  const { home } = await fx.spawn("dev", { instance: "dev-1" });
  let doc = ok(fx.cli(["inspect", "--home", home, "--json"]), "inspect --home");
  assert.deepEqual([doc.launch.effective, doc.launch.from, doc.launchCurrent.effective], [{ harness: "pi", model: null, launchConfig: null }, "host", { harness: "pi", model: null, launchConfig: null }]);
  const items = () => ok(fx.cli(["readiness", "--home", home, "--json"]), "readiness").checks.configured.items.filter((i) => i.producer === "launch preference");
  assert.deepEqual(items(), []);
  // The machine now prefers Claude for dev: the running home is untouched.
  setLocal(fx, (v) => { v.souls = { launch: { dev: OPUS } }; });
  doc = ok(fx.cli(["inspect", "--home", home, "--json"]), "inspect --home");
  assert.deepEqual([doc.launch.effective.harness, doc.launchCurrent.effective, doc.launchCurrent.from], ["pi", { harness: "claude", model: "claude-opus-5-5", launchConfig: null }, "local"]);
  decodes(doc.launch, RECORD_FROM); decodes(doc.launchCurrent);
  const [changed] = items();
  assert.deepEqual([changed.code, changed.required, changed.subject, changed.recorded.harness, changed.current.harness, changed.from, changed.at, changed.remedy],
    ["launch-changed", false, "launch", "pi", "claude", "local", `${LOCAL}#/souls/launch/dev`, "`oats session restart --reselect-launch`, or respawn"]);
  // --reselect-launch plans from the layers (the frozen recipe otherwise).
  const meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  const kept = planLaunch({ home, instance: meta.instance, meta, contextDir: fx.dep, preview: true });
  assert.deepEqual([kept.harness, kept.launchChoice], ["pi", null], "a plain start keeps the recorded launch");
  const next = await fx.inEnv(() => planLaunch({ home, instance: meta.instance, meta, contextDir: fx.dep, preview: true, reselect: homeLaunchLayers(home, meta) }));
  assert.deepEqual([next.harness, next.model, next.launchChoice.from, next.launchChoice.at], ["claude", "claude-opus-5-5", "local", `${LOCAL}#/souls/launch/dev`]);
  // A home spawned with explicit flags never warns: its launch was chosen, not preferred.
  const { home: pinned } = await fx.spawn("dev", { instance: "dev-2", harness: "codex" });
  assert.equal(JSON.parse(readFileSync(join(pinned, "instance.json"), "utf8")).launchFrom, "flag");
  assert.deepEqual(ok(fx.cli(["readiness", "--home", pinned, "--json"]), "readiness").checks.configured.items.filter((i) => i.producer === "launch preference"), []);
  // The CLI flag is refused beside --launch-config (one selection at a time).
  const r = fx.cli(["session", "start", "--home", home, "--reselect-launch", "--launch-config", "opus", "--json"]);
  assert.equal(r.json().ok, false);
  mkdirSync(join(fx.base, "unused"), { recursive: true });
});

test("a report naming a missing configuration keeps a real effective launch (the host default) with the problem — never a null harness", (t) => {
  const fx = fixture({ local: { souls: { launch: { dev: "gone" } } } }); t.after(fx.cleanup);
  const row = ok(fx.cli(["souls", "--json"]), "souls").souls.find((s) => s.name === "dev");
  assert.deepEqual([row.launch.effective, row.launch.from, row.launch.problem.code], [{ harness: "pi", model: null, launchConfig: null }, "local", "E_LAUNCH_CONFIG_UNKNOWN"]);
  decodes(row.launch);
});
