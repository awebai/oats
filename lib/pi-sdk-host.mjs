/** Explicit, zero-plugin Pi SDK host. No auth wrapper, default resource loader,
 * private SDK imports, model substitution or interpretation of legacy Pi argv. */
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readPortableBytes } from "./portable-files.mjs";
import { parseStrictJson } from "./portable-values.mjs";
import { oatsError } from "./errors.mjs";

export const PI_SDK_HOST_VERSION = "1";
export const PI_SDK_VERSION = "0.85.1";
export const PI_SDK_HOST = fileURLToPath(new URL("../bin/oats-pi-sdk-host.mjs", import.meta.url));
const fail = (code, message) => { throw oatsError(code, message); };
const absolute = value => typeof value === "string" && value.length > 0 && !value.includes("\0") && isAbsolute(value) && resolve(value) === value;
export function isPiSdkHost(recipe) {
  return recipe?.runtime === "pi" && recipe.executable === PI_SDK_HOST;
}

export function parsePiHostModel(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*\/[^\s\0*?\\]+$/.test(value)
    || value.includes("!") || value.includes("$") || value.includes("..")) {
    fail("E_PI_HOST_MODEL", "captured Pi host requires an exact provider/model identifier");
  }
  const slash = value.indexOf("/");
  return { provider: value.slice(0, slash), id: value.slice(slash + 1) };
}

/** Only operator-owned options; internal home/session/model/task are NEVER here. */
export function parsePiHostRecipeArgs(args) {
  const keys = ["--oats-pi-host", "--mode", "--thinking", "--sdk-root", "--sdk-version"];
  if (!Array.isArray(args) || args.length !== keys.length * 2
    || args.some(value => typeof value !== "string" || value.includes("\0"))
    || keys.some((key, i) => args[i * 2] !== key)
    || args[1] !== PI_SDK_HOST_VERSION || args[3] !== "print" || args[5] !== "medium"
    || !absolute(args[7]) || args[9] !== PI_SDK_VERSION) {
    fail("E_PI_HOST_ARGS", "unsupported captured Pi SDK host profile or arguments");
  }
  return { hostVersion: args[1], mode: args[3], thinkingLevel: args[5], sdkRoot: args[7], sdkVersion: args[9] };
}

export function validatePiHostRecipe(recipe) {
  if (!isPiSdkHost(recipe) || recipe.executableResource || (recipe.executableResolvedFrom !== undefined && recipe.executableResolvedFrom !== "explicit-host")) {
    fail("E_PI_HOST_SELECTION", "Pi SDK host requires its exact explicit kernel executable");
  }
  const options = parsePiHostRecipeArgs(recipe.args);
  parsePiHostModel(recipe.model);
  if (!recipe.env || typeof recipe.env !== "object" || Array.isArray(recipe.env) || Object.keys(recipe.env).length
    || recipe.yolo !== false) fail("E_PI_HOST_SELECTION", "Pi host-v1 has no launch environment contributions or yolo policy");
  if (recipe.hooks && (Object.keys(recipe.hooks.env ?? {}).length || Object.keys(recipe.hooks.launch ?? {}).length || (recipe.hooks.contributions ?? []).length)) {
    fail("E_PI_HOST_SELECTION", "Pi host-v1 does not accept launch-hook contributions");
  }
  return options;
}

export function piHostArgv(recipe, { home, sessionDir, taskFile = join(home, "TASK.md") }) {
  validatePiHostRecipe(recipe);
  if (![home, sessionDir, taskFile].every(absolute) || taskFile !== join(home, "TASK.md")) fail("E_PI_HOST_ARGS", "invalid kernel Pi host paths");
  return ["--home", home, "--session-dir", sessionDir, "--model", recipe.model, "--task-file", taskFile, ...recipe.args];
}

export function parsePiHostArgv(argv) {
  const keys = ["--home", "--session-dir", "--model", "--task-file"];
  if (!Array.isArray(argv) || argv.length !== 18 || keys.some((key, i) => argv[i * 2] !== key)) {
    fail("E_PI_HOST_ARGS", "Pi host accepts only the kernel-rendered argv prefix and closed host profile");
  }
  const [home, sessionDir, model, taskFile] = keys.map((_, i) => argv[i * 2 + 1]);
  if (![home, sessionDir, taskFile].every(absolute) || taskFile !== join(home, "TASK.md")) fail("E_PI_HOST_ARGS", "invalid kernel Pi host paths");
  const modelSelection = parsePiHostModel(model);
  return { home, sessionDir, model, modelSelection, taskFile, ...parsePiHostRecipeArgs(argv.slice(8)) };
}

/** Package metadata only; no SDK import, auth inspection, refresh or model call. */
export function resolvePiSdkEntry({ sdkRoot, sdkVersion }) {
  if (!absolute(sdkRoot) || sdkVersion !== PI_SDK_VERSION || !lstatSync(sdkRoot).isDirectory() || realpathSync(sdkRoot) !== sdkRoot) {
    fail("E_PI_HOST_SDK", "Pi SDK root must be the exact physical selected installation");
  }
  // OATS-managed payloads must use their own retained-resource approval surface.
  if (sdkRoot.split(sep).includes(".agents")) fail("E_PI_HOST_SDK", "managed OATS resources cannot be used as an external SDK installation");
  const pkg = parseStrictJson(readPortableBytes(join(sdkRoot, "package.json")));
  const entry = pkg.exports?.["."]?.import;
  if (pkg.name !== "@earendil-works/pi-coding-agent" || pkg.version !== sdkVersion || typeof entry !== "string" || !entry.startsWith("./")) {
    fail("E_PI_HOST_SDK", "selected SDK package/name/version/public export does not match the host profile");
  }
  const file = resolve(sdkRoot, entry);
  if (!file.startsWith(sdkRoot + sep) || realpathSync(file) !== file || !lstatSync(file).isFile()) fail("E_PI_HOST_SDK", "Pi public SDK export escapes its selected installation");
  return pathToFileURL(file).href;
}

export function readPiHostTask(taskFile) {
  const bytes = readPortableBytes(taskFile);
  if (bytes.length > 512 * 1024) fail("E_PI_HOST_TASK", "captured Pi task exceeds the launch bound");
  let task;
  try { task = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail("E_PI_HOST_TASK", "captured Pi task is not UTF-8"); }
  if (!task.trim() || task.includes("\0")) fail("E_PI_HOST_TASK", "captured Pi print requires a nonempty task");
  return { bytes, task };
}

/** Public ResourceLoader interface. verify() reopens retained authority on EVERY
 * reload, before loadSkills reads anything. No SDK discovery/loader is copied. */
export function createPiResourceLoader(sdk, { cwd, agentDir, verify }) {
  let agents, skills, extensions;
  const ready = () => { if (!agents) fail("E_PI_HOST_CURRICULUM", "Pi curriculum has not been verified"); };
  return {
    getExtensions() { ready(); return extensions; },
    getSkills() { ready(); return skills; },
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles() { ready(); return { agentsFiles: [agents] }; },
    getSystemPrompt: () => undefined,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources(paths) {
      if (!paths || typeof paths !== "object" || Array.isArray(paths)
        || Object.keys(paths).some(key => !["skillPaths", "promptPaths", "themePaths"].includes(key))
        || Object.values(paths).some(value => !Array.isArray(value) || value.length)) {
        fail("E_PI_HOST_CURRICULUM", "unselected Pi resource additions are not supported");
      }
    },
    async reload() {
      agents = skills = extensions = undefined; // failed reload cannot expose a stale verified view
      const selected = await verify();
      if (selected.cwd !== cwd || typeof selected.text !== "string" || !Array.isArray(selected.skills)) fail("E_PI_HOST_CURRICULUM", "Pi retained curriculum context changed");
      const result = sdk.loadSkills({ cwd, agentDir, skillPaths: selected.skills.map(skill => skill.path), includeDefaults: false });
      if (result.diagnostics.length || result.skills.length !== selected.skills.length) fail("E_PI_HOST_CURRICULUM", "Pi skill loader did not consume the exact retained skill set");
      for (const wanted of selected.skills) {
        const found = result.skills.filter(skill => skill.name === wanted.name);
        if (found.length !== 1 || realpathSync(found[0].filePath) !== realpathSync(wanted.path)) fail("E_PI_HOST_CURRICULUM", "Pi skill identity differs from its retained selection");
      }
      await verify(); // no selected-file drift during SDK parsing
      agents = { path: selected.agentsPath, content: selected.text };
      skills = result;
      extensions = { extensions: [], errors: [], runtime: sdk.createExtensionRuntime() };
    },
  };
}

/** Print exposes no history UI/import/resume/branch operations. The proxy is a
 * before-delegation boundary around the real public SDK runtime, not an engine
 * replacement. It never calls a late factory after opening an unowned target. */
export function guardPiPrintRuntime(runtime) {
  const unsupported = new Set(["switchSession", "importFromJsonl", "fork", "newSession"]);
  return new Proxy(runtime, {
    get(target, key) {
      if (unsupported.has(key)) return () => fail("E_PI_HOST_HISTORY", "session replacement/import is not supported by this explicit print profile");
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Production uses native services in the user's UNCHANGED profile. No options
 * are passed to ModelRuntime to override stores/auth/config/refresh behavior.
 * Dependencies are injectable for UNIT orchestration checks, not readiness. */
export async function runPiSdkHost(argv, { verifyContext, importSdk = url => import(url), cwd = process.cwd() } = {}) {
  const options = parsePiHostArgv(argv);
  if (typeof verifyContext !== "function" || realpathSync(cwd) !== options.home) fail("E_PI_HOST_CUSTODY", "Pi host requires its admitted captured home context");
  const verify = () => verifyContext(options);
  await verify();
  const { task } = readPiHostTask(options.taskFile);
  const entry = resolvePiSdkEntry(options);
  const sdk = await importSdk(entry); // the verified PUBLIC root export only
  if (sdk.VERSION !== options.sdkVersion) fail("E_PI_HOST_SDK", "loaded Pi SDK version differs from selection");
  await verify();
  const agentDir = sdk.getAgentDir(); // native profile resolution, never sessionDir
  const modelRuntime = await sdk.ModelRuntime.create();
  const model = modelRuntime.getModel(options.modelSelection.provider, options.modelSelection.id);
  if (!model || model.provider !== options.modelSelection.provider || model.id !== options.modelSelection.id) fail("E_PI_HOST_MODEL", "selected native Pi model is unavailable; no default was selected");
  const factory = async ({ cwd: target, agentDir: profile, sessionManager, sessionStartEvent }) => {
    await verify();
    if (target !== options.home || profile !== agentDir || sessionManager.getCwd() !== target || sessionManager.getSessionDir() !== options.sessionDir) fail("E_PI_HOST_HISTORY", "Pi runtime context differs from its owned history");
    const settingsManager = sdk.SettingsManager.create(target, agentDir);
    const resourceLoader = createPiResourceLoader(sdk, { cwd: target, agentDir, verify });
    await resourceLoader.reload();
    const services = { cwd: target, agentDir, modelRuntime, settingsManager, resourceLoader, diagnostics: [] };
    const built = await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model, thinkingLevel: options.thinkingLevel });
    if (built.session.model?.id !== model.id || built.session.model?.provider !== model.provider || built.modelFallbackMessage) fail("E_PI_HOST_MODEL", "Pi substituted the captured model");
    return { ...built, services, diagnostics: [] };
  };
  await verify();
  const sessionManager = sdk.SessionManager.create(options.home, options.sessionDir);
  const runtime = await sdk.createAgentSessionRuntime(factory, { cwd: options.home, agentDir, sessionManager });
  let handedToPrint = false;
  try {
    await verify();
    if (readPiHostTask(options.taskFile).task !== task) fail("E_PI_HOST_TASK", "captured task changed during Pi startup");
    handedToPrint = true; // native runPrintMode owns normal disposal/signals/errors
    const exitCode = await sdk.runPrintMode(guardPiPrintRuntime(runtime), { mode: "text", initialMessage: task });
    await verify(); // no successful host outcome after observed custody drift
    return exitCode;
  } finally {
    if (!handedToPrint) await runtime.dispose();
  }
}
