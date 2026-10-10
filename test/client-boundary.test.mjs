// The reading test of the shared home (packages/client): who may import what, read from the sources.
// It reads files and imports none of them, so it runs on a root-only checkout with nothing installed.
//
//   packages/client/   imports only its own files and node: builtins: nothing from packages/desktop,
//                      packages/tui or lib/, no third-party package. It names Electron neither as a
//                      module nor as a runtime. No module but liveness-main.mjs imports
//                      own-environment.mjs. The directory holds .mjs modules and nothing else.
//   packages/tui/      (when it exists) imports only node: builtins, its own files, and from
//                      packages/client only the modules and exports of the stable surface (SURFACE).
//   lib/ and bin/      import nothing from packages/client or packages/desktop.
//
// Each rule is proved to fail on the break it names, on fixtures built here (the last tests).
//
// What a static reader sees: `import … from`, `export … from`, `import "x"`, `import("literal")`,
// `require("literal")` and `new URL("literal", import.meta.url)`. A module loaded by a computed path is
// refused in packages/client and packages/tui, where nothing needs one. In lib/ and bin/, which load
// hooks and subcommands by computed paths, a relative path literal that leads into packages/client or
// packages/desktop is refused wherever it stands in the code.
//
// Two things this test does not prove, and what does:
//   * that a module of the home uses no DOM global (the modules use `window` and `document` as ordinary
//     local names, so a name check cannot tell): test/client-loading.test.mjs loads every one under
//     plain Node;
//   * where the Desktop's package carries the home: packages/desktop/test/inventory.test.mjs, which
//     keeps its own reading rule for the job that installs only the Desktop. Neither depends on the other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HOME = "packages/client", TUI = "packages/tui", DESKTOP = "packages/desktop";

/**
 * The stable surface of packages/client for packages/tui: the modules the TUI may import, each with the
 * exports it may name. A change to one of them updates the TUI in the same PR; anything not listed is
 * the Desktop's own composition and may change without notice.
 * From specs/2026-10-10-stable-surface-v1.md of the Desktop expert (v1, revised for 1b): its firm table
 * and its provisional lists, both. "All" of a module is written out, so a new export is unlisted until
 * this list says otherwise.
 */
const SURFACE = Object.freeze({
  // Firm: the frame and the Instances view.
  "display-text.mjs": ["displayLine", "cleanLine", "DETAIL_WITHHELD", "MAX_DISPLAY_LINE", "NOT_NOTE_TEXT", "UNSAFE"],
  "cli-locator.mjs": ["ACCEPT_RANGE", "ACCEPT_RANGE_TEXT", "PROBE_NAME", "parseSemver", "parseProbeStdout", "acceptProbe"],
  "cli-probe-contract.mjs": ["probeSignature", "probeChanged"],
  "deployment-contract.mjs": ["DEPLOYMENT_FEATURES", "deploymentRecord", "deploymentReadGate", "deploymentFailure", "OBSERVE_MAX_AGE_FEATURE", "validMaxAge", "maxAgeArgv"],
  "deployment-read-cli.mjs": ["cliDeploymentRead", "DEPLOYMENT_READ_TIMEOUT", "DEPLOYMENT_READ_MAX_BUFFER"],
  "deployment-data.mjs": ["deploymentStatusData", "workspaceStatusData", "observationData",
    "soulsData", "soulCapabilitiesOf", "capabilitiesData"],
  "deployment-observer.mjs": ["createDeploymentObserver", "mapBounded", "MAX_DEPLOYMENT_OBSERVATIONS"],
  "refresh-loop.mjs": ["createRefreshLoop", "REFRESH_FOCUSED_MS", "REFRESH_BLURRED_MS"],
  "instance-presentation.mjs": ["runtimeState", "runtimeCounts", "unsupportedSession"],
  "waiting-on-you.mjs": ["waitingClaim", "waitingLabel", "waitedText", "waitingClock", "waitingNames", "waitingBelowText", "waitingSentence"],
  "harness-names.mjs": ["HARNESSES", "HARNESS_NAMES", "harnessFeature", "harnessFlag", "harnessKey", "harnessOf", "harnessList"],
  "team-rows.mjs": ["teamRow", "teamRowsOf", "defaultTeamOf", "teamModelOf"],
  "launch-contract.mjs": ["effectiveOf", "launchOf", "REPORT_FROM", "PREVIEW_FROM", "RECORD_FROM"],
  "deployment-facts.mjs": ["memberLabel", "servedIdentityText"],
  "instance-admission.mjs": ["admitInstance", "instanceSelector"],
  "instance-tree.mjs": ["instanceId", "resolveLinkId", "clusterInstances", "rosterGroups", "waitingRollup", "instanceVisibleInTree"],
  "roster-sections.mjs": ["rosterSections"],
  "kernel-environment.mjs": ["INSTANCE_VARIABLES", "withoutInstanceVariables"],
  // Provisional: machines and the switcher.
  "cli-adapter.mjs": ["parseEnvelope", "cliRemoteRoster", "cliStart", "launchChoiceArgv", "cliCapability", "writeTaskFile"],
  "remote-roster.mjs": ["remoteWorkspace", "remotePanel", "remoteAgents", "unavailableGroups"],
  "workspace-views.mjs": ["readIdentity", "attachment", "viewId", "buildViews", "deploymentReason", "deploymentReasonParts"],
  "deployment-label.mjs": ["shortPath", "pathTail", "deploymentLabel", "deploymentLabelParts", "machineLabels", "machineLabelParts"],
  "remote-address.mjs": ["canAddressRemote", "serverLabel", "shownLabel", "unaddressableSentence", "rowReason", "remoteHeadline", "hostReason", "unroutableReason", "kernelCode"],
  "machine-contract.mjs": ["machinesGated"],
  "workspace-admission.mjs": ["validateWorkspace", "deploymentsInside"],
  // Provisional: lifecycle.
  "lifecycle-cli.mjs": ["cliLifecycle", "lifecycleArgv"],
  "lifecycle-contract.mjs": ["LIFECYCLE_API", "MAX_LIFECYCLE_TARGETS", "planRevision", "planReference", "lifecyclePlan", "lifecycleOptions", "lifecycleChoicesApplicable",
    "lifecycleReceipt", "stoppedTargets", "spawnCompensationOf", "lifecycleReason", "lifecycleFailure", "lifecycleDetailCode"],
  "instance-acts.mjs": ["instanceActs"],
  // Provisional: souls, inspect, spawn.
  "inspect-contract.mjs": ["inspectSupported", "inspectData", "originText", "inspectFacts"],
  "spawn-preview-cli.mjs": ["cliSpawnPreview"],
  "spawn-preview-contract.mjs": ["previewSupported", "previewSelector", "previewChoices", "choiceArgv", "previewTarget", "previewData", "previewFailure", "worktreeHooksOf", "INSTANCE_NAME_MAX"],
  "spawn-decision.mjs": ["spawnEffective", "spawnDecision", "sameSpawnDecision"],
  "spawn-apply-cli.mjs": ["cliSpawnApply"],
  "spawn-apply-contract.mjs": ["spawnApplySupported", "spawnApplyDeadlineMs", "spawnReference", "spawnCreationReceipt", "ROLLED_BACK_CODES", "spawnApplyReason", "spawnApplyFailure"],
  "launch-prompt-outcome.mjs": ["LAUNCH_INSPECTION", "LAUNCH_DIAGNOSTIC_BYTES", "launchPromptOutcome", "retainedSpawnDetails", "retainedSpawnMessage"],
  "capability-warnings-contract.mjs": ["warningsOf", "previewWarningsOf", "warningsShown"],
  // Provisional: capabilities.
  "workspace-cli.mjs": ["cliWorkspace", "workspaceGate", "workspaceFailure", "WORKSPACE_ACTIONS"],
  "capability-show-contract.mjs": ["capabilityShowSupported", "capabilitySelector", "sameSelector", "capabilityShowData", "capabilityFileData", "listedFiles", "skillFilePath", "skillRelativePath"],
});
/** Never importable, by anyone but the one the comment names. */
const ENVIRONMENT = "own-environment.mjs"; // changes the environment of whoever imports it; the collector's entry does, first
const COLLECTOR = "liveness-main.mjs";     // a program: started as a child, never imported

// ── The reader ────────────────────────────────────────────────────────────────
// A tree is a Map of repository-relative path (with `/`) to the file's text; a file that is not a
// module is there with the text "". The rules read a tree and nothing else, so the same rules run on
// the repository and on the fixtures.

const isModule = (path) => /\.(mjs|cjs|js|jsx|ts|mts|cts|tsx)$/.test(path);
const under = (path, dir) => path.startsWith(`${dir}/`);
const isRelative = (spec) => spec.startsWith("./") || spec.startsWith("../");
const names = (list) => list.split(",").map((entry) => entry.trim()).filter(Boolean);

/**
 * What a source asks for: `{ spec, form, names }`. `names` are the exported names it takes from `spec`
 * (the left of an `as`), for the two forms that list them.
 *   named       import { a, b as c } from "x"        reexport   export { a } from "x"
 *   default     import a from "x"                    star       export * from "x"
 *   namespace   import * as a from "x"               dynamic    import("x")
 *   bare        import "x"                           require    require("x")
 *                                                    url        new URL("x", import.meta.url)
 */
function requestsOf(source) {
  const found = [];
  const add = (match, spec, form, taken = []) => found.push({ at: match.index, spec, form, names: taken });
  for (const m of source.matchAll(/^[ \t]*import\s+(?:type\s+)?([^;'"`]*?)\s*\bfrom\s*["']([^"']+)["']/gm)) {
    const [, clause, spec] = m, braces = /\{([^}]*)\}/.exec(clause);
    if (braces) add(m, spec, "named", names(braces[1]).map((entry) => entry.split(/\s+as\s+/)[0].replace(/^type\s+/, "")));
    for (const part of names(clause.replace(/\{[^}]*\}/, ""))) add(m, spec, part.startsWith("*") ? "namespace" : "default");
  }
  for (const m of source.matchAll(/^[ \t]*import\s*["']([^"']+)["']/gm)) add(m, m[1], "bare");
  for (const m of source.matchAll(/^[ \t]*export\s*(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/gm)) add(m, m[2], "reexport", names(m[1]).map((entry) => entry.split(/\s+as\s+/)[0]));
  for (const m of source.matchAll(/^[ \t]*export\s*\*\s*(?:as\s+[\w$]+\s*)?from\s*["']([^"']+)["']/gm)) add(m, m[1], "star");
  for (const m of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) add(m, m[1], "dynamic");
  for (const m of source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)) add(m, m[1], "require");
  for (const m of source.matchAll(/\bnew URL\(\s*["'](\.{1,2}\/[^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) add(m, m[1], "url");
  // In the order the source has them: the first import of a program's entry is a rule of its own.
  return found.sort((a, b) => a.at - b.at).map(({ spec, form, names: taken }) => ({ spec, form, names: taken }));
}
/** A module loaded by a path that is not one string literal. `require()` with nothing in it is prose in a comment. */
const COMPUTED_LOAD = /\bimport\s*\(\s*(?!["'])|\brequire\s*\(\s*(?!["')])/;
/** Electron as a module or as a runtime. The names its variables carry in the environment (ELECTRON_RUN_AS_NODE) are data, not a dependency. */
const ELECTRON = /["']electron(?:\/[^"']*)?["']|\bprocess\.versions\.electron\b|\bprocess\.resourcesPath\b|\bprocess\.type\b/;
/** The names a module exports, read from its text: declarations and `export { … }` lists. */
function exportsOf(source) {
  const out = new Set();
  for (const [, name] of source.matchAll(/^export\s+(?:async\s+)?(?:function\s*\*?|class)\s+([\w$]+)/gm)) out.add(name);
  for (const m of source.matchAll(/^export\s+(?:const|let|var)\s+/gm)) for (const name of declaredNames(source, m.index + m[0].length)) out.add(name);
  for (const [, list] of source.matchAll(/^export\s*\{([^}]*)\}/gm)) for (const entry of names(list)) out.add(entry.split(/\s+as\s+/).at(-1));
  return out;
}
/** The names one `const a = …, b = …` declares, from the first name's position: a name follows the keyword and every
 * comma outside brackets and strings, until the statement ends (a `;`, or a line break that nothing continues). */
function declaredNames(source, from) {
  const out = [], name = /[\w$]+/y;
  const take = (at) => { name.lastIndex = at; const m = name.exec(source); if (m) out.push(m[0]); };
  take(from);
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") { for (i++; i < source.length && source[i] !== c; i++) if (source[i] === "\\") i++; continue; }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    if (depth > 0) continue;
    if (depth < 0 || c === ";") break;
    if (c === ",") take(i + 1 + /^\s*/.exec(source.slice(i + 1))[0].length);
    if (c === "\n") {
      const before = source.slice(from, i).trimEnd().at(-1), after = source.slice(i).trimStart();
      if (!",=?:&|+-*<>".includes(before) && !/^[.?:&|+\-*,=<>]/.test(after)) break;
    }
  }
  return out;
}
const resolve = (from, spec) => posix.normalize(posix.join(posix.dirname(from), spec));
const filesIn = (tree, dir) => [...tree.keys()].filter((path) => under(path, dir)).sort();

/** packages/client: its own files and node: builtins, no Electron, one importer of own-environment.mjs, modules only. */
function homeProblems(tree) {
  const problems = [];
  for (const path of filesIn(tree, HOME)) {
    const name = path.slice(HOME.length + 1);
    if (name.includes("/")) { problems.push(`${path}: the shared home is flat, and this is in a directory of it`); continue; }
    if (!name.endsWith(".mjs")) { problems.push(`${path}: not a .mjs module; the shared home holds modules and nothing else`); continue; }
    if (name.endsWith(".test.mjs")) problems.push(`${path}: a test does not go in the shared home`);
    const source = tree.get(path);
    for (const { spec } of requestsOf(source)) {
      if (spec.startsWith("node:")) continue;
      if (!isRelative(spec)) { problems.push(`${path}: imports "${spec}", which is not a Node builtin (node:…) or a file of the shared home`); continue; }
      const target = resolve(path, spec);
      if (!under(target, HOME)) problems.push(`${path}: "${spec}" leaves the shared home (${target})`);
      else if (!tree.has(target)) problems.push(`${path}: "${spec}" is ${target}, which does not exist`);
      else if (target === `${HOME}/${ENVIRONMENT}` && name !== COLLECTOR) problems.push(`${path}: imports ${ENVIRONMENT}, which changes the environment of whoever imports it; only ${COLLECTOR} does`);
      else if (target === `${HOME}/${COLLECTOR}`) problems.push(`${path}: imports ${COLLECTOR}, which is a program`);
    }
    if (COMPUTED_LOAD.test(source)) problems.push(`${path}: loads a module by a computed path`);
    if (ELECTRON.test(source)) problems.push(`${path}: names Electron`);
  }
  return problems;
}

/** packages/tui: node: builtins, its own files, and the stable surface of packages/client by name. Nothing to say when it does not exist. */
function tuiProblems(tree, surface = SURFACE) {
  const problems = [];
  for (const path of filesIn(tree, TUI).filter(isModule)) {
    const source = tree.get(path);
    for (const { spec, form, names: taken } of requestsOf(source)) {
      if (spec.startsWith("node:")) continue;
      if (!isRelative(spec)) { problems.push(`${path}: imports "${spec}", which is not a Node builtin (node:…), a file of its own or the shared home`); continue; }
      const target = resolve(path, spec);
      if (under(target, TUI)) { if (!tree.has(target)) problems.push(`${path}: "${spec}" is ${target}, which does not exist`); continue; }
      if (!under(target, HOME)) { if (form !== "url") problems.push(`${path}: "${spec}" leaves packages/tui for ${target}, which is not the shared home`); continue; }
      // A path into the home that is not an import is how a program is started as a child: nothing is imported.
      if (form === "url") continue;
      const module = target.slice(HOME.length + 1);
      if (module === ENVIRONMENT || module === COLLECTOR) { problems.push(`${path}: imports ${module}, which is never imported from outside the shared home`); continue; }
      if (!Object.hasOwn(surface, module)) { problems.push(`${path}: imports ${module}, which is not on the stable surface`); continue; }
      if (form !== "named" && form !== "reexport") { problems.push(`${path}: takes ${module} by a ${form} import; the stable surface is imported by name (import { a } from …)`); continue; }
      for (const name of taken) if (!surface[module].includes(name)) problems.push(`${path}: imports ${name} from ${module}, which is not on the stable surface`);
    }
    if (COMPUTED_LOAD.test(source)) problems.push(`${path}: loads a module by a computed path`);
  }
  return problems;
}

/** lib/ and bin/: nothing from packages/client or packages/desktop. */
function kernelProblems(tree) {
  const problems = [];
  for (const path of [...filesIn(tree, "lib"), ...filesIn(tree, "bin")].filter(isModule)) {
    const source = tree.get(path), found = new Set();
    for (const { spec } of requestsOf(source).filter((request) => isRelative(request.spec))) {
      const target = resolve(path, spec);
      for (const dir of [HOME, DESKTOP]) if (target === dir || under(target, dir)) found.add(`${path}: "${spec}" is ${target}: the kernel imports nothing from ${dir}`);
    }
    // A load by a computed path (a template, a join) still spells the directory it leads into. Read from the
    // whole text, comments included: a quoted relative path into either directory has no business there.
    if (!found.size) for (const [, dir] of source.matchAll(/["'`](?:\.{1,2}\/)+(?:[^"'`\n]*\/)?(packages\/(?:client|desktop))(?=[/"'`])/g))
      found.add(`${path}: a relative path into ${dir}: the kernel imports nothing from ${dir}`);
    problems.push(...found);
  }
  return problems;
}

/** The surface names what the home has: every listed module exists and exports every listed name. */
function surfaceProblems(tree, surface = SURFACE) {
  const problems = [];
  for (const [module, listed] of Object.entries(surface)) {
    const path = `${HOME}/${module}`;
    if (module === ENVIRONMENT || module === COLLECTOR) problems.push(`${module}: on the stable surface, and it is never importable`);
    else if (!tree.has(path)) problems.push(`${module}: on the stable surface, and ${path} does not exist`);
    else { const has = exportsOf(tree.get(path)); for (const name of listed) if (!has.has(name)) problems.push(`${module}: ${name} is on the stable surface, and the module does not export it`); }
    if (new Set(listed).size !== listed.length) problems.push(`${module}: a name is listed twice`);
  }
  return problems;
}
const allProblems = (tree) => [...homeProblems(tree), ...tuiProblems(tree), ...kernelProblems(tree)];

/** The repository as a tree: the four places the rules read, every file of each. */
function repositoryTree() {
  const tree = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else tree.set(path, entry.isFile() && isModule(path) ? readFileSync(join(ROOT, path), "utf8") : "");
    }
  };
  for (const dir of [HOME, TUI, "lib", "bin"]) if (existsSync(join(ROOT, dir))) walk(dir);
  return tree;
}

// ── The repository ────────────────────────────────────────────────────────────

const repository = repositoryTree();

test("packages/client imports only its own files and node: builtins, names no Electron, and holds modules only", (t) => {
  assert.deepEqual(homeProblems(repository), []);
  // Not vacuous: the home was read, and the reader finds what its modules import.
  const modules = filesIn(repository, HOME);
  assert.ok(modules.length >= 48, `the shared home was read (${modules.length} files)`);
  const asked = modules.flatMap((path) => requestsOf(repository.get(path)));
  assert.ok(asked.filter((request) => isRelative(request.spec)).length > 60, "the reader sees the home's imports of its own files");
  assert.ok(asked.some((request) => request.spec.startsWith("node:")), "and its imports of node: builtins");
  assert.deepEqual(requestsOf(repository.get(`${HOME}/instance-acts.mjs`)).map((request) => request.spec), ["./instance-tree.mjs", "./instance-presentation.mjs", "./remote-address.mjs"]);
  // The one importer of the module that cleans an environment is the collector's entry, and it imports it first.
  assert.equal(requestsOf(repository.get(`${HOME}/${COLLECTOR}`))[0].spec, `./${ENVIRONMENT}`);
  t.diagnostic(`${modules.length} modules read`);
});

test("packages/tui imports only node: builtins, its own files and the stable surface of packages/client", (t) => {
  assert.deepEqual(tuiProblems(repository), []);
  // Until the TUI exists the rule holds for no files; the fixtures below prove it is a rule.
  t.diagnostic(`${filesIn(repository, TUI).filter(isModule).length} modules read${existsSync(join(ROOT, TUI)) ? "" : " (packages/tui does not exist yet)"}`);
});

test("lib/ and bin/ import nothing from packages/client or packages/desktop", (t) => {
  assert.deepEqual(kernelProblems(repository), []);
  const modules = [...filesIn(repository, "lib"), ...filesIn(repository, "bin")].filter(isModule);
  assert.ok(modules.includes("bin/oats.mjs") && modules.includes("lib/core.mjs"), "the kernel was read");
  assert.ok(requestsOf(repository.get("bin/oats.mjs")).some((request) => resolve("bin/oats.mjs", request.spec) === "lib/core.mjs"), "the reader sees the CLI's imports of the kernel");
  t.diagnostic(`${modules.length} modules read`);
});

test("the stable surface names what packages/client has: every listed module, every listed export", () => {
  assert.deepEqual(surfaceProblems(repository), []);
  assert.equal(Object.keys(SURFACE).length, 38);
  // The five modules 1b made are on it, with the names the TUI's first views take.
  for (const module of ["instance-tree.mjs", "roster-sections.mjs", "kernel-environment.mjs", "workspace-admission.mjs", "instance-acts.mjs"]) assert.ok(Object.hasOwn(SURFACE, module), module);
  // Not on it: the Desktop spawn dialog's copy, and the two files nobody imports.
  for (const module of ["spawn-messages.mjs", ENVIRONMENT, COLLECTOR, "terminal-contract.mjs"]) assert.ok(!Object.hasOwn(SURFACE, module), module);
});

// ── The rules fail on the breaks they name ────────────────────────────────────

/** A small repository that breaks no rule: a home, a TUI that uses it, the kernel. */
function fixture(changes = {}) {
  const tree = new Map(Object.entries({
    "packages/client/display-text.mjs": 'export function displayLine(v) { return v; }\nexport const cleanLine = (v) => v;\n',
    "packages/client/cli-locator.mjs": 'import { execFile } from "node:child_process";\nimport { displayLine } from "./display-text.mjs";\nexport const PROBE_NAME = "@awebai/oats";\nexport function discover() { return [execFile, displayLine]; }\n',
    "packages/client/terminal-contract.mjs": 'export const HERDR_REMOVED = "gone";\n',
    "packages/client/liveness.mjs": 'import { displayLine } from "./display-text.mjs";\nexport const collect = () => displayLine;\n// ELECTRON_RUN_AS_NODE is the name of a variable: data, not a dependency. process.title names no runtime.\n',
    "packages/client/own-environment.mjs": 'delete process.env.ELECTRON_RUN_AS_NODE;\nexport {};\n',
    "packages/client/liveness-main.mjs": 'import "./own-environment.mjs";\nimport { collect } from "./liveness.mjs";\ncollect();\n',
    "packages/tui/main.mjs": 'import { stdout } from "node:process";\nimport { frame } from "./frame.mjs";\nimport {\n  displayLine,\n  cleanLine as clean,\n} from "../client/display-text.mjs";\nexport { PROBE_NAME } from "../client/cli-locator.mjs";\nconst collector = new URL("../client/liveness-main.mjs", import.meta.url);\nstdout.write(frame(displayLine(clean(String(collector)))));\n',
    "packages/tui/frame.mjs": 'export const frame = (text) => `[${text}]`;\n',
    "packages/tui/README.md": "",
    "lib/core.mjs": 'import { readFileSync } from "node:fs";\nimport YAML from "yaml";\nimport { helper } from "./helper.mjs";\n// packages/desktop/server/tmux-status.mjs keeps the same default (a comment names a path; nothing is imported).\nexport const core = [readFileSync, YAML, helper];\n',
    "lib/helper.mjs": 'export const helper = 1;\n',
    "bin/oats.mjs": 'import { core } from "../lib/core.mjs";\nconst sub = process.argv[2];\nawait import(new URL(`../packages/record/bin/${sub}.mjs`, import.meta.url));\nconsole.log(core, "the OATS Desktop app (packages/desktop) is the control panel now.");\n',
  }));
  for (const [path, source] of Object.entries(changes)) if (source === null) tree.delete(path); else tree.set(path, source);
  return tree;
}
/** The fixture with one change breaks exactly one rule, in the words given. */
function breaks(rule, changes, pattern) {
  const tree = fixture(changes), problems = allProblems(tree);
  assert.equal(problems.length, 1, `one problem expected, got: ${JSON.stringify(problems)}`);
  assert.match(problems[0], pattern);
  assert.deepEqual(rule(tree), problems, "and the rule that names it is the one that finds it");
}

test("fixture: a repository that breaks no rule has no problem, with or without a TUI", () => {
  assert.deepEqual(allProblems(fixture()), []);
  const without = fixture({ "packages/tui/main.mjs": null, "packages/tui/frame.mjs": null, "packages/tui/README.md": null });
  assert.deepEqual(filesIn(without, TUI), []);
  assert.deepEqual(tuiProblems(without), [], "the TUI's rule holds when there is no TUI");
  assert.deepEqual(allProblems(without), []);
  // The reader reads the fixture's TUI the way the rules need: names on the left of an `as`, a re-export, a path that is not an import.
  assert.deepEqual(requestsOf(fixture().get("packages/tui/main.mjs")), [
    { spec: "node:process", form: "named", names: ["stdout"] },
    { spec: "./frame.mjs", form: "named", names: ["frame"] },
    { spec: "../client/display-text.mjs", form: "named", names: ["displayLine", "cleanLine"] },
    { spec: "../client/cli-locator.mjs", form: "reexport", names: ["PROBE_NAME"] },
    { spec: "../client/liveness-main.mjs", form: "url", names: [] },
  ]);
});

test("fixture, packages/client: a third-party import fails", () => {
  breaks(homeProblems, { "packages/client/liveness.mjs": 'import YAML from "yaml";\nexport const collect = YAML;\n' }, /^packages\/client\/liveness\.mjs: imports "yaml", which is not a Node builtin/);
  breaks(homeProblems, { "packages/client/liveness.mjs": 'export const collect = () => require("left-pad");\n' }, /imports "left-pad"/);
  // A builtin is imported as node:…, so a bare name is never mistaken for one.
  breaks(homeProblems, { "packages/client/liveness.mjs": 'import { readFileSync } from "fs";\nexport const collect = readFileSync;\n' }, /imports "fs", which is not a Node builtin \(node:…\)/);
});

test("fixture, packages/client: an import that leaves the home fails (the Desktop, the TUI, the kernel)", () => {
  breaks(homeProblems, { "packages/client/liveness.mjs": 'import { skeleton } from "../desktop/renderer/loading.mjs";\nexport const collect = skeleton;\n' }, /"\.\.\/desktop\/renderer\/loading\.mjs" leaves the shared home \(packages\/desktop\/renderer\/loading\.mjs\)$/);
  breaks(homeProblems, { "packages/client/liveness.mjs": 'export { frame as collect } from "../tui/frame.mjs";\n' }, /leaves the shared home \(packages\/tui\/frame\.mjs\)$/);
  breaks(homeProblems, { "packages/client/liveness.mjs": 'export const collect = () => import("../../lib/core.mjs");\n' }, /leaves the shared home \(lib\/core\.mjs\)$/);
  breaks(homeProblems, { "packages/client/liveness.mjs": 'export const collect = new URL("../desktop/main.mjs", import.meta.url);\n' }, /leaves the shared home \(packages\/desktop\/main\.mjs\)$/);
  breaks(homeProblems, { "packages/client/liveness.mjs": 'export const collect = (name) => import(`../desktop/${name}.mjs`);\n' }, /loads a module by a computed path$/);
  breaks(homeProblems, { "packages/client/liveness.mjs": 'import { gone } from "./gone.mjs";\nexport const collect = gone;\n' }, /is packages\/client\/gone\.mjs, which does not exist$/);
});

test("fixture, packages/client: each Electron name fails", () => {
  for (const line of ['import { app } from "electron";', "const { ipcRenderer } = require('electron/renderer');", "const inApp = !!process.versions.electron;",
    "const resources = process.resourcesPath;", 'const renderer = process.type === "renderer";'])
    assert.deepEqual(homeProblems(fixture({ "packages/client/liveness.mjs": `${line}\nexport const collect = 1;\n` })).filter((problem) => /names Electron$/.test(problem)),
      ["packages/client/liveness.mjs: names Electron"], line);
  breaks(homeProblems, { "packages/client/liveness.mjs": "export const collect = () => process.versions.electron;\n" }, /^packages\/client\/liveness\.mjs: names Electron$/);
});

test("fixture, packages/client: a library that imports own-environment.mjs fails, and so does importing the collector", () => {
  breaks(homeProblems, { "packages/client/liveness.mjs": 'import "./own-environment.mjs";\nexport const collect = 1;\n' }, /^packages\/client\/liveness\.mjs: imports own-environment\.mjs, which changes the environment of whoever imports it; only liveness-main\.mjs does$/);
  breaks(homeProblems, { "packages/client/liveness.mjs": 'import "./liveness-main.mjs";\nexport const collect = 1;\n' }, /imports liveness-main\.mjs, which is a program$/);
});

test("fixture, packages/client: a file that is not a module fails", () => {
  for (const name of ["notes.md", "package.json", "fixture.json", "probe.sh", "legacy.js", "types.d.ts"])
    breaks(homeProblems, { [`packages/client/${name}`]: "" }, new RegExp(`^packages/client/${name.replace(/\./g, "\\.")}: not a \\.mjs module; the shared home holds modules and nothing else$`));
  breaks(homeProblems, { "packages/client/test/x.mjs": "export const x = 1;\n" }, /the shared home is flat/);
  breaks(homeProblems, { "packages/client/display-text.test.mjs": 'import test from "node:test";\ntest("x", () => {});\n' }, /a test does not go in the shared home$/);
});

test("fixture, packages/tui: an import of a module that is not on the surface fails", () => {
  breaks(tuiProblems, { "packages/tui/frame.mjs": 'import { HERDR_REMOVED } from "../client/terminal-contract.mjs";\nexport const frame = () => HERDR_REMOVED;\n' }, /^packages\/tui\/frame\.mjs: imports terminal-contract\.mjs, which is not on the stable surface$/);
  // The two files nobody imports, whatever is taken from them.
  breaks(tuiProblems, { "packages/tui/frame.mjs": 'import "../client/own-environment.mjs";\nexport const frame = (t) => t;\n' }, /imports own-environment\.mjs, which is never imported from outside the shared home$/);
  breaks(tuiProblems, { "packages/tui/frame.mjs": 'export const frame = () => import("../client/liveness-main.mjs");\n' }, /imports liveness-main\.mjs, which is never imported/);
});

test("fixture, packages/tui: an import of an export that is not on the surface, from a module that is, fails", () => {
  breaks(tuiProblems, { "packages/tui/frame.mjs": 'import { PROBE_NAME, discover } from "../client/cli-locator.mjs";\nexport const frame = () => [PROBE_NAME, discover];\n' }, /^packages\/tui\/frame\.mjs: imports discover from cli-locator\.mjs, which is not on the stable surface$/);
  breaks(tuiProblems, { "packages/tui/frame.mjs": 'import { discover as acceptProbe } from "../client/cli-locator.mjs";\nexport const frame = acceptProbe;\n' }, /imports discover from cli-locator\.mjs/);
  breaks(tuiProblems, { "packages/tui/frame.mjs": 'export { discover } from "../client/cli-locator.mjs";\nexport const frame = (t) => t;\n' }, /imports discover from cli-locator\.mjs/);
  // A form that names no export cannot be held to a list of exports: the surface is imported by name.
  for (const [form, source] of [["namespace", 'import * as locator from "../client/cli-locator.mjs";\nexport const frame = locator;\n'], ["default", 'import locator from "../client/cli-locator.mjs";\nexport const frame = locator;\n'],
    ["bare", 'import "../client/cli-locator.mjs";\nexport const frame = (t) => t;\n'], ["star", 'export * from "../client/cli-locator.mjs";\nexport const frame = (t) => t;\n'],
    ["dynamic", 'export const frame = () => import("../client/cli-locator.mjs");\n'], ["require", 'export const frame = () => require("../client/cli-locator.mjs");\n']])
    breaks(tuiProblems, { "packages/tui/frame.mjs": source }, new RegExp(`takes cli-locator\\.mjs by a ${form} import; the stable surface is imported by name`));
});

test("fixture, packages/tui: anything else it imports fails (a package, the Desktop, the kernel, a computed path)", () => {
  breaks(tuiProblems, { "packages/tui/frame.mjs": 'import blessed from "blessed";\nexport const frame = blessed;\n' }, /^packages\/tui\/frame\.mjs: imports "blessed", which is not a Node builtin/);
  breaks(tuiProblems, { "packages/tui/frame.mjs": 'import { skeleton } from "../desktop/renderer/loading.mjs";\nexport const frame = skeleton;\n' }, /leaves packages\/tui for packages\/desktop\/renderer\/loading\.mjs, which is not the shared home$/);
  breaks(tuiProblems, { "packages/tui/frame.mjs": 'import { core } from "../../lib/core.mjs";\nexport const frame = core;\n' }, /leaves packages\/tui for lib\/core\.mjs/);
  breaks(tuiProblems, { "packages/tui/frame.mjs": 'export const frame = (name) => import(`../client/${name}.mjs`);\n' }, /loads a module by a computed path$/);
  breaks(tuiProblems, { "packages/tui/frame.mjs": 'import { gone } from "./gone.mjs";\nexport const frame = gone;\n' }, /is packages\/tui\/gone\.mjs, which does not exist$/);
});

test("fixture, lib/ and bin/: an import of the home or of the Desktop fails", () => {
  breaks(kernelProblems, { "lib/helper.mjs": 'import { displayLine } from "../packages/client/display-text.mjs";\nexport const helper = displayLine;\n' }, /^lib\/helper\.mjs: "\.\.\/packages\/client\/display-text\.mjs" is packages\/client\/display-text\.mjs: the kernel imports nothing from packages\/client$/);
  breaks(kernelProblems, { "lib/helper.mjs": 'export const helper = () => import("../packages/desktop/server-compat.mjs");\n' }, /the kernel imports nothing from packages\/desktop$/);
  breaks(kernelProblems, { "bin/oats.mjs": 'import { core } from "../lib/core.mjs";\nexport { displayLine } from "../packages/client/display-text.mjs";\nconsole.log(core);\n' }, /^bin\/oats\.mjs: .* the kernel imports nothing from packages\/client$/);
  breaks(kernelProblems, { "lib/sub/deep.mjs": 'const collector = new URL("../../packages/client/liveness-main.mjs", import.meta.url);\nexport default collector;\n' }, /^lib\/sub\/deep\.mjs: .* the kernel imports nothing from packages\/client$/);
  // A computed load still spells the directory it leads into.
  breaks(kernelProblems, { "bin/oats.mjs": 'const name = process.argv[2];\nawait import(new URL(`../packages/client/${name}.mjs`, import.meta.url));\n' }, /^bin\/oats\.mjs: a relative path into packages\/client/);
  breaks(kernelProblems, { "lib/helper.mjs": 'import { join } from "node:path";\nexport const helper = (root) => import(join(root, "../packages/desktop", "main.mjs"));\n' }, /^lib\/helper\.mjs: a relative path into packages\/desktop/);
});

test("fixture: a surface entry the home does not have fails", () => {
  const tree = fixture(), surface = { "display-text.mjs": ["displayLine", "cleanLine"], "cli-locator.mjs": ["PROBE_NAME"] };
  assert.deepEqual(surfaceProblems(tree, surface), []);
  assert.deepEqual(surfaceProblems(tree, { ...surface, "gone.mjs": ["x"] }), ["gone.mjs: on the stable surface, and packages/client/gone.mjs does not exist"]);
  assert.deepEqual(surfaceProblems(tree, { ...surface, "cli-locator.mjs": ["PROBE_NAME", "acceptProbe"] }), ["cli-locator.mjs: acceptProbe is on the stable surface, and the module does not export it"]);
  assert.deepEqual(surfaceProblems(tree, { ...surface, "own-environment.mjs": [] }), ["own-environment.mjs: on the stable surface, and it is never importable"]);
  assert.deepEqual(surfaceProblems(tree, { ...surface, "liveness-main.mjs": [] }), ["liveness-main.mjs: on the stable surface, and it is never importable"]);
  // The reader of exports sees every form the home uses: a function, a class, one `const` that declares two names, a list.
  assert.deepEqual([...exportsOf('export async function a() {}\nexport class B {}\nexport const c = (x, y = [1, 2]) => ({ x, y }), d = "e, f = 1";\nconst g = 1, h = 2;\nexport { g, h as i };\nexport const j = 1\nconst k = 2;\n')].sort(),
    ["B", "a", "c", "d", "g", "i", "j"]);
  // A TUI held to a surface is held to that surface: the export the fixture's home has is refused when the list does not name it.
  assert.deepEqual(tuiProblems(tree, { "display-text.mjs": ["displayLine"], "cli-locator.mjs": ["PROBE_NAME"] }), ["packages/tui/main.mjs: imports cleanLine from display-text.mjs, which is not on the stable surface"]);
});
