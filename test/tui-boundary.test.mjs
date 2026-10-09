// The boundaries of the terminal client (packages/tui, `oats tui`; awebai/oats#855 section 3.2).
// Every test here READS files and never imports them: on a checkout with every dependency
// installed an import would simply succeed, and an import cannot see what a file names.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TUI = join(ROOT, "packages/tui");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
function filesUnder(dir, keep = (name) => name.endsWith(".mjs")) {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path, keep));
    else if (entry.isFile() && keep(entry.name)) out.push(path);
  }
  return out.sort();
}
/** A source without its comments: what the file does, not what it says about itself. */
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");
/** Every module a source imports or re-exports statically, as written. */
function staticImports(source) {
  const found = [];
  for (const match of code(source).matchAll(/(?:^|[\n;])\s*(?:import|export)\b\s*(?:[^"'`;]*?\bfrom\s*)?["']([^"'\n]+)["']/g)) found.push(match[1]);
  return found;
}
const TUI_SOURCES = [...filesUnder("packages/tui/bin"), ...filesUnder("packages/tui/lib")];
const TUI_FILES = [...TUI_SOURCES, ...filesUnder("packages/tui/test")];
const CLIENT = "packages/tui/lib/client.mjs";

test("the reading itself works: it finds the imports of a file it is shown, and not the ones in its comments", () => {
  const sample = `// import x from "commented"\n/* import y from "blocked" */\nimport a from "./a.mjs";\nimport { b,\n  c } from "../b.mjs";\nexport { d } from "node:fs";\nexport * from "./e.mjs";\nimport "./side.mjs";\nconst url = "https://example.com/not-an-import";\nexport const f = 1;\n`;
  assert.deepEqual(staticImports(sample), ["./a.mjs", "../b.mjs", "node:fs", "./e.mjs", "./side.mjs"]);
  assert.equal(TUI_SOURCES.includes("packages/tui/bin/tui.mjs") && TUI_SOURCES.includes(CLIENT) && TUI_SOURCES.length >= 10, true);
});

test("bin/oats.mjs holds exactly one import of packages/tui, and it is dynamic, at dispatch", () => {
  assert.deepEqual(filesUnder("bin", () => true), ["bin/oats.mjs"], "the CLI is one file: a second one would need this test too");
  const source = code(read("bin/oats.mjs"));
  const naming = source.split("\n").filter((line) => line.includes("packages/tui"));
  assert.equal(naming.length, 1, `one line of code names packages/tui, found: ${naming.join(" | ")}`);
  assert.match(naming[0], /^\s*await import\(new URL\("\.\.\/packages\/tui\/bin\/tui\.mjs", import\.meta\.url\)\);\s*$/);
  assert.deepEqual(staticImports(read("bin/oats.mjs")).filter((name) => /tui/.test(name)), [], "and no static import does");
});

test("no file under lib/ names packages/tui: the kernel does not know its client", () => {
  const naming = filesUnder("lib").filter((path) => /packages\/tui|packages\\tui/.test(read(path)));
  assert.deepEqual(naming, []);
});

test("only packages/tui/lib/client.mjs imports from the shared client home, and it names one module of it", () => {
  for (const path of TUI_FILES) {
    const shared = staticImports(read(path)).filter((name) => /(^|\/)client\//.test(name) || /packages\/client/.test(name));
    assert.deepEqual(shared, path === CLIENT ? ["../../client/display-text.mjs"] : [], path);
  }
  assert.equal(existsSync(join(ROOT, "packages/client/display-text.mjs")), true, "the module it names is there");
  for (const path of TUI_FILES.filter((p) => p !== CLIENT)) assert.doesNotMatch(code(read(path)), /packages\/client|\.\.\/client\//, `${path} names no reader path`);
});

test("no file in packages/tui imports anything but node: modules, its own files and that one path", () => {
  for (const path of TUI_FILES) {
    for (const name of staticImports(read(path))) {
      if (name.startsWith("node:")) continue;
      if (path === CLIENT && name === "../../client/display-text.mjs") continue;
      assert.match(name, /^\.\.?\//, `${path} imports ${name}: not a node: module and not a relative path`);
      const target = resolve(dirname(join(ROOT, path)), name);
      assert.equal(relative(TUI, target).startsWith(".."), false, `${path} imports ${name}, outside packages/tui`);
      assert.equal(existsSync(target), true, `${path} imports ${name}, which is not there`);
    }
  }
});

test("no file in packages/tui uses a dynamic import", () => {
  for (const path of TUI_FILES) assert.doesNotMatch(code(read(path)), /\bimport\s*\(/, path);
});

test("every module under packages/tui/lib is reached by static imports from bin/tui.mjs, so loading the entry proves the package holds them all", () => {
  const reached = new Set();
  const visit = (path) => {
    if (reached.has(path)) return;
    reached.add(path);
    for (const name of staticImports(read(path))) {
      const target = relative(ROOT, resolve(dirname(join(ROOT, path)), name));
      if (target.startsWith("packages/tui/")) visit(target);
    }
  };
  visit("packages/tui/bin/tui.mjs");
  assert.deepEqual(filesUnder("packages/tui/lib").filter((path) => !reached.has(path)), []);
  assert.deepEqual(filesUnder("packages/tui/lib", () => true), filesUnder("packages/tui/lib"), "and lib/ holds nothing but .mjs modules");
});

test("the entry loads its whole graph before it looks at the terminal: its only statement after the imports is the call of main", () => {
  const source = code(read("packages/tui/bin/tui.mjs")).trim().split("\n").map((line) => line.trim()).filter(Boolean);
  assert.deepEqual(source, [
    'import { main } from "../lib/main.mjs";',
    "process.exitCode = await main({ argv: process.argv.slice(2), stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, env: process.env });",
  ]);
});

test("only term/screen.mjs and term/tty.mjs can produce an ESC byte: no other shipped module writes one in a string", () => {
  const writers = ["packages/tui/lib/term/screen.mjs", "packages/tui/lib/term/tty.mjs"];
  const escape = /\\x1b|\\u001b|\\u\{0*1b\}|\\033|\\e\[|\x1b|fromCharCode\(\s*(?:27|0x1b)\s*\)/i;
  for (const path of TUI_SOURCES) assert.equal(escape.test(read(path)), writers.includes(path), path);
});

test("the views are pure: they import only the TUI's own text, style and action modules, and name no IO, clock or process", () => {
  const views = filesUnder("packages/tui/lib/views");
  assert.equal(views.length >= 2, true);
  for (const path of views) {
    for (const name of staticImports(read(path))) assert.match(name, /^(\.\.\/actions\.mjs|\.\.\/term\/(text|style|width)\.mjs|\.\/[a-z-]+\.mjs)$/, `${path} imports ${name}`);
    assert.doesNotMatch(code(read(path)), /\b(process|Date|setTimeout|setInterval|performance|console|fetch|require)\b/, path);
  }
});

test("packages/tui is private, has no dependency of any kind, no bin and no script, and the root manifest ships its bin, lib, README and manifest but not its tests", () => {
  const manifest = JSON.parse(read("packages/tui/package.json"));
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, "module");
  for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "bundledDependencies", "bin", "scripts", "workspaces"]) assert.equal(key in manifest, false, key);
  const files = JSON.parse(read("package.json")).files;
  for (const entry of ["packages/tui/bin/", "packages/tui/lib/", "packages/tui/README.md", "packages/tui/package.json", "packages/client/"]) assert.equal(files.includes(entry), true, entry);
  assert.deepEqual(files.filter((entry) => /packages\/(tui|client)/.test(entry)).sort(), ["packages/client/", "packages/tui/README.md", "packages/tui/bin/", "packages/tui/lib/", "packages/tui/package.json"], "nothing wider: packages/tui/ whole would ship its tests");
});
