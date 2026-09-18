import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PI_SDK_HOST, parsePiHostRecipeArgs, parsePiHostArgv, validatePiHostRecipe, piHostArgv, resolvePiSdkEntry, createPiResourceLoader, guardPiPrintRuntime, runPiSdkHost } from "../lib/pi-sdk-host.mjs";
import { renderLaunchRecipe, parseLaunchCommand } from "../lib/core.mjs";
import { capturedPiSessionDirectory, requireCapturedPiRecordSupport } from "../lib/captured-pi-custody.mjs";
import { nativeHistoryPath } from "../packages/record/lib/native-history.mjs";

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oats-pi-host-unit-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home"), sdkRoot = join(root, "sdk"), sessionDir = join(root, "history"), skillPath = join(root, "selected", "SKILL.md");
  for (const dir of [home, sdkRoot, sessionDir, join(root, "selected")]) mkdirSync(dir);
  const manifest = { name: "@earendil-works/pi-coding-agent", version: "0.85.1", exports: { ".": { import: "./index.mjs" } } };
  writeFileSync(join(sdkRoot, "package.json"), JSON.stringify(manifest));
  writeFileSync(join(sdkRoot, "index.mjs"), "throw new Error('unit fixture must not import or create real services');\n");
  writeFileSync(join(home, "TASK.md"), "  Exact task bytes\n");
  writeFileSync(skillPath, "---\nname: selected\ndescription: Selected fixture\n---\n# Selected\n");
  const args = ["--oats-pi-host", "1", "--mode", "print", "--thinking", "medium", "--sdk-root", sdkRoot, "--sdk-version", "0.85.1"];
  const recipe = { runtime: "pi", executable: PI_SDK_HOST, args, model: "native-provider/exact-model", yolo: false, env: {} };
  const selection = { cwd: home, agentsPath: join(home, "AGENTS.md"), text: "selected instruction bytes", skills: [{ name: "selected", path: skillPath }] };
  const argv = piHostArgv(recipe, { home, sessionDir });
  return { root, home, sdkRoot, sessionDir, skillPath, manifest, args, recipe, selection, argv };
}

test("Pi host grammar separates closed operator args from one kernel history/model/task prefix", t => {
  const f = fixture(t), options = parsePiHostArgv(f.argv);
  assert.equal(options.sessionDir, f.sessionDir);
  assert.equal(f.argv.indexOf("--session-dir"), 2);
  assert.equal(f.argv.filter(value => value === "--session-dir").length, 1);
  assert.equal(options.thinkingLevel, "medium");
  for (const args of [[], [...f.args, "--session", "/other"], [...f.args, "--native-auth-file", "/auth"], [...f.args, "--agent-dir", "/profile"], [...f.args, "--model", "other/model"], f.args.map(value => value === "print" ? "interactive" : value), f.args.map(value => value === "medium" ? "off" : value)]) assert.throws(() => parsePiHostRecipeArgs(args), { code: "E_PI_HOST_ARGS" });
  for (const argv of [f.argv.slice(2), [...f.argv, "--resume"], f.argv.map(value => value === join(f.home, "TASK.md") ? "/other/task" : value)]) assert.throws(() => parsePiHostArgv(argv), { code: "E_PI_HOST_ARGS" });
  for (const changes of [{ executable: "/bin/pi" }, { runtime: "claude" }, { env: { API_KEY: "fixture" } }, { yolo: true }, { model: "default" }, { model: "native-provider/*" }, { hooks: { launch: { pi: "--extension x" } } }]) assert.throws(() => validatePiHostRecipe({ ...f.recipe, ...changes }));
});

test("captured host renderer preserves explicit prefix while legacy renderer stays native", t => {
  const f = fixture(t), command = renderLaunchRecipe(f.recipe, { home: f.home, instance: "unit" });
  const { tokens, binary } = parseLaunchCommand(command), args = tokens.slice(binary + 1).map(token => token.value);
  assert.deepEqual(args, piHostArgv(f.recipe, { home: f.home, sessionDir: capturedPiSessionDirectory(f.home) }));
  assert.equal(args.indexOf("--session-dir"), 2);
  assert.ok(!command.includes("--no-context-files"));
  assert.notEqual(capturedPiSessionDirectory(f.home), nativeHistoryPath(f.home));
  assert.ok(!capturedPiSessionDirectory(f.home).startsWith(nativeHistoryPath(f.home) + "/"));
  const legacy = renderLaunchRecipe({ ...f.recipe, executable: "/bin/pi", args: [] }, { home: f.home, instance: "unit" });
  assert.ok(legacy.includes("--no-context-files"));
  assert.ok(!legacy.includes("--oats-pi-host"));
});

test("SDK selection resolves only selected physical package public root export without imports", t => {
  const f = fixture(t);
  assert.match(resolvePiSdkEntry(parsePiHostRecipeArgs(f.args)), /sdk\/index\.mjs$/);
  for (const change of [{ name: "other-sdk" }, { version: "0.99.0" }, { exports: { ".": { import: "../outside.mjs" } } }, { exports: { "./private": { import: "./index.mjs" } } }]) {
    writeFileSync(join(f.sdkRoot, "package.json"), JSON.stringify({ ...f.manifest, ...change }));
    assert.throws(() => resolvePiSdkEntry(parsePiHostRecipeArgs(f.args)), { code: "E_PI_HOST_SDK" });
  }
});

test("strict loader validates before SDK reads, pins exact skills and refuses additions/reload drift", async t => {
  const f = fixture(t), calls = []; let drift = false;
  const sdk = {
    loadSkills(options) { calls.push(options); return { skills: [{ name: "selected", filePath: f.skillPath }], diagnostics: [] }; },
    createExtensionRuntime: () => ({}),
  };
  const loader = createPiResourceLoader(sdk, { cwd: f.home, agentDir: "/normal/native/profile", verify: () => { if (drift) throw new Error("retained drift"); return f.selection; } });
  assert.throws(() => loader.getAgentsFiles());
  await loader.reload();
  assert.equal(calls[0].includeDefaults, false);
  assert.deepEqual(calls[0].skillPaths, [f.skillPath]);
  assert.equal(loader.getExtensions().extensions.length, 0);
  assert.deepEqual(loader.getAgentsFiles().agentsFiles, [{ path: f.selection.agentsPath, content: f.selection.text }]);
  assert.throws(() => loader.extendResources({ skillPaths: ["/ambient"] }), { code: "E_PI_HOST_CURRICULUM" });
  assert.throws(() => loader.extendResources({ extensions: [] }), { code: "E_PI_HOST_CURRICULUM" });
  loader.extendResources({ skillPaths: [], promptPaths: [], themePaths: [] });
  drift = true;
  await assert.rejects(loader.reload(), /retained drift/);
  assert.equal(calls.length, 1, "drift refuses before another SDK resource read");
});

test("print runtime guard rejects history operations BEFORE delegating to actual runtime methods", () => {
  let delegated = 0;
  const runtime = { session: { native: true }, switchSession: () => delegated++, importFromJsonl: () => delegated++, newSession: () => delegated++, fork: () => delegated++, dispose() { delegated++; } };
  const guarded = guardPiPrintRuntime(runtime);
  for (const method of ["switchSession", "importFromJsonl", "newSession", "fork"]) assert.throws(() => guarded[method]("/foreign"), { code: "E_PI_HOST_HISTORY" });
  assert.equal(delegated, 0); assert.equal(guarded.session, runtime.session);
  guarded.dispose(); assert.equal(delegated, 1);
});

function unitSdk(f, calls) {
  // Explicit unit doubles only; no installed SDK import/services/model/backend.
  const model = { provider: "native-provider", id: "exact-model" };
  const modelRuntime = { getModel(provider, id) { calls.push(["model", provider, id]); return model; } };
  return {
    VERSION: "0.85.1", getAgentDir: () => "/normal/native/profile",
    ModelRuntime: { async create(...args) { calls.push(["native-model-create", args]); return modelRuntime; } },
    SettingsManager: { create(...args) { calls.push(["native-settings-create", args]); return { nativeSettings: true }; } },
    loadSkills: options => { calls.push(["skills", options]); return { skills: [{ name: "selected", filePath: f.skillPath }], diagnostics: [] }; },
    createExtensionRuntime: () => ({}),
    SessionManager: { create(cwd, dir) { calls.push(["session-create", cwd, dir]); return { getCwd: () => cwd, getSessionDir: () => dir }; } },
    async createAgentSessionFromServices(options) { calls.push(["from-services", options]); return { session: { model, native: true }, newTools: [] }; },
    async createAgentSessionRuntime(factory, options) { const built = await factory(options); return { ...built, dispose() { calls.push(["dispose"]); } }; },
    async runPrintMode(runtime, options) { calls.push(["native-print", options]); assert.equal(runtime.session.native, true); await runtime.dispose(); return 0; },
  };
}

test("unit host assembly delegates NORMAL native model/auth/profile/settings and exact selected print", async t => {
  const f = fixture(t), calls = [], sdk = unitSdk(f, calls), before = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
  const code = await runPiSdkHost(f.argv, { cwd: f.home, verifyContext: () => f.selection, importSdk: async () => sdk });
  assert.equal(code, 0);
  assert.deepEqual(calls.find(([name]) => name === "native-model-create"), ["native-model-create", []], "no credential store/path/config/refresh override");
  assert.deepEqual(calls.find(([name]) => name === "native-settings-create")[1], [f.home, "/normal/native/profile"]);
  const built = calls.find(([name]) => name === "from-services")[1];
  assert.equal(built.services.agentDir, "/normal/native/profile");
  assert.equal(built.thinkingLevel, "medium");
  assert.equal(built.services.resourceLoader.getExtensions().extensions.length, 0);
  assert.deepEqual(calls.find(([name]) => name === "native-print")[1], { mode: "text", initialMessage: "  Exact task bytes\n" });
  assert.deepEqual({ HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR }, before);
});

test("unit host refuses custody and empty task BEFORE SDK import, and never substitutes a missing model", async t => {
  const f = fixture(t); let imports = 0;
  const importSdk = async () => { imports++; return unitSdk(f, []); };
  await assert.rejects(runPiSdkHost(f.argv, { cwd: f.home, verifyContext: () => { throw new Error("missing original witness"); }, importSdk }), /missing original witness/);
  assert.equal(imports, 0);
  writeFileSync(join(f.home, "TASK.md"), " \n\t");
  await assert.rejects(runPiSdkHost(f.argv, { cwd: f.home, verifyContext: () => f.selection, importSdk }), { code: "E_PI_HOST_TASK" });
  assert.equal(imports, 0);
  writeFileSync(join(f.home, "TASK.md"), "task");
  const sdk = unitSdk(f, []); sdk.ModelRuntime.create = async () => ({ getModel: () => undefined });
  sdk.createAgentSessionFromServices = () => assert.fail("no session/default model after missing selection");
  await assert.rejects(runPiSdkHost(f.argv, { cwd: f.home, verifyContext: () => f.selection, importSdk: async () => sdk }), { code: "E_PI_HOST_MODEL" });
});

test("host executable rejects arbitrary caller invocation with a nonsecret diagnostic", t => {
  const f = fixture(t), result = spawnSync(process.execPath, [PI_SDK_HOST, "--native-auth-file", "unit-secret-sentinel"], { cwd: f.home, encoding: "utf8", env: { PATH: process.env.PATH, HOME: f.root } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /E_PI_HOST_ARGS/);
  assert.ok(!result.stderr.includes("unit-secret-sentinel"));
  assert.equal(result.stdout, "");
});
