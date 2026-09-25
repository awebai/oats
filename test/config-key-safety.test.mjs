// Config keys are attacker-reachable strings. Every table they index must
// answer for its OWN entries and nothing else: `Object.prototype` supplies
// `constructor`, `toString`, `valueOf`, `hasOwnProperty` … to a plain-object
// lookup, and `__proto__` is not a key at all — assigning it rewrites the
// parsed object's prototype, so the entry disappears from `Object.keys` (past
// every validator) while still answering property reads.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  capabilityManifest, marketplaceCapabilities, parseYamlFlat, parseYamlNested,
  resolveCapabilities, resolveOatsConfig, validateConfigShape, withConfigFile,
} from "../lib/core.mjs";
import { inertRuntimePath } from "./helpers/runtime-stub.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
function temp() { return mkdtempSync(join(tmpdir(), "oats-keysafe-test-")); }
function write(path, content) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
/** Native function source text is what an inherited-name lookup leaks into a diagnostic. */
const NATIVE_SOURCE = /\[native code\]|function \w*\s*\(/;

test("inherited-name config keys get the ordinary unsupported-key diagnostic", () => {
  const file = join(temp(), "oats-config.yaml");
  for (const key of ["constructor", "toString", "valueOf", "hasOwnProperty"]) {
    const cfg = parseYamlNested(`${key}: x\n`);
    assert.deepEqual(Object.keys(cfg), [key]);
    assert.throws(() => validateConfigShape(cfg, file), (e) => {
      assert.equal(e.message, `unsupported oats-config key in ${file}: ${key}`);
      assert.doesNotMatch(e.message, NATIVE_SOURCE);
      return true;
    });
  }
  // The renamed-key table still answers for its own entries.
  assert.throws(() => validateConfigShape(parseYamlNested("groups:\n  devs: [dev]\n"), file), /unsupported oats-config key "groups".*agent-types/s);
  // …and inside a capability entry, where RENAMED_ENTRY_KEYS is indexed the same way.
  assert.throws(
    () => validateConfigShape(parseYamlNested("capabilities:\n  additive:\n    acme.thing:\n      constructor: x\n"), file),
    (e) => {
      assert.equal(e.message, `unsupported keys for capability acme.thing in ${file}: constructor`);
      assert.doesNotMatch(e.message, NATIVE_SOURCE);
      return true;
    });
  assert.throws(() => validateConfigShape(parseYamlNested("capabilities:\n  additive:\n    acme.thing:\n      injection: none\n"), file), /unsupported key "injection".*injection-override/s);
});

test("__proto__ is refused by every YAML reader and pollutes nothing", () => {
  const documents = [
    "__proto__:\n  polluted: true\n",                       // nested map
    "__proto__: {polluted: true}\n",                         // inline map
    "capabilities:\n  additive:\n    __proto__:\n      polluted: true\n", // nested under a real key
    'name: demo\n"__proto__": {polluted: true}\n',           // quoted spelling
  ];
  for (const doc of documents) {
    assert.throws(() => parseYamlNested(doc), (e) => {
      assert.equal(e.code, "unsafe-config-key");
      assert.match(e.message, /unsupported mapping key "__proto__"/);
      // The raw reader parses a STRING and cannot name the document, so it must
      // not claim the document is an oats-config: soul.yaml and skill
      // frontmatter go through the same readers. The file is added by whoever
      // holds the path.
      assert.doesNotMatch(e.message, /oats-config key/);
      return true;
    }, doc);
  }
  assert.throws(() => parseYamlFlat("__proto__: polluted\n"), (e) => e.code === "unsafe-config-key");
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal({}.polluted, undefined);
  // A template shipped as config source material is refused on the same path,
  // so it can neither mutate a prototype nor smuggle an unvalidated key past
  // validateConfigShape by vanishing from Object.keys.
  const file = join(temp(), "oats-config.yaml");
  assert.throws(() => validateConfigShape(parseYamlNested("__proto__: {name: smuggled}\n"), file), /unsupported mapping key "__proto__"/);
  assert.equal(Object.prototype.name, undefined);
});

test("ordinary config parses unchanged (control)", () => {
  const cfg = parseYamlNested([
    "name: demo",
    "team:",
    "  name: Demo",
    "agent-types:",
    "  developers:",
    "    description: Devs",
    "capabilities:",
    "  layers:",
    "    knowledge:",
    "      capability: acme.knowledge",
    "      global: true",
    "  additive:",
    "    acme.chat:",
    "      souls: {dev: true}",
    "",
  ].join("\n"));
  assert.deepEqual(Object.keys(cfg), ["name", "team", "agent-types", "capabilities"]);
  assert.equal(cfg.name, "demo");
  assert.equal(cfg.team.name, "Demo");
  assert.equal(cfg.capabilities.layers.knowledge.capability, "acme.knowledge");
  assert.equal(cfg.capabilities.additive["acme.chat"].souls.dev, true);
  validateConfigShape(cfg, join(temp(), "oats-config.yaml"));
  assert.deepEqual(parseYamlFlat("type: developers\nruntime: pi\n"), { type: "developers", runtime: "pi" });
});

test("an inherited-name capability id is not acquired just because Object.prototype has it", () => {
  const repo = temp();
  // `constructor` and `toString` both satisfy the capability-id grammar, so the
  // manifest maps must report them as NOT acquired rather than hand back
  // Object.prototype.constructor as if it were a manifest.
  assert.equal(capabilityManifest("constructor", repo), undefined);
  assert.equal(capabilityManifest("toString", repo), undefined);
  assert.equal(marketplaceCapabilities().toString, undefined);
  write(join(repo, "oats-config.yaml"), "name: keysafe\ncapabilities:\n  additive:\n    constructor:\n      global: true\n");
  assert.throws(() => resolveOatsConfig(repo, "dev"), /capability "constructor" is activated but no manifest was acquired/);
});

test("a soul named __proto__ gets no binding: targeting reads own properties only", () => {
  const repo = temp();
  write(join(repo, ".agents", "capabilities", "owned", "acme.x", "oats.json"),
    JSON.stringify({ capability: "acme.x", version: "1.0.0", description: "cap" }));
  write(join(repo, "oats-config.yaml"), [
    "name: keysafe",
    "capabilities:",
    "  additive:",
    "    acme.x:",
    "      from: owned",
    "      global: false",
    "      souls:",
    "        alice: true",
    "",
  ].join("\n"));

  // `souls.__proto__` is Object.prototype — an object, so `bindingObject`
  // accepted it and filed it at specificity 2 (the highest), overriding the
  // explicit global: false for a soul the config never mentions.
  const ids = (soul) => resolveCapabilities(repo, soul).map((c) => c.id);
  assert.deepEqual(ids("__proto__"), [], "an inherited soul name enabled an excluded capability");
  assert.deepEqual(ids("constructor"), []);
  assert.deepEqual(ids("hasOwnProperty"), []);
  // The declared soul still wins over the exclusion, unchanged.
  assert.deepEqual(ids("alice"), ["acme.x"]);
  assert.deepEqual(ids("bob"), []);
  assert.equal(Object.prototype.enabled, undefined);
});

test("an agent type named constructor is matched by declaration, never by inheritance", () => {
  const repo = temp();
  write(join(repo, ".agents", "capabilities", "owned", "acme.x", "oats.json"),
    JSON.stringify({ capability: "acme.x", version: "1.0.0", description: "cap" }));
  write(join(repo, "agents", "dev", "soul", "soul.yaml"), "name: dev\ntype: constructor\n");
  write(join(repo, "oats-config.yaml"), [
    "name: keysafe",
    "capabilities:",
    "  additive:",
    "    acme.x:",
    "      from: owned",
    "      global: false",
    "      agent-types:",
    "        constructor: true",
    "",
  ].join("\n"));
  // Declared: ordinary type targeting applies.
  assert.deepEqual(resolveCapabilities(repo, "dev").map((c) => c.id), ["acme.x"]);
  // Undeclared: a soul of ANOTHER type gets nothing, and no inherited name
  // stands in for the declaration.
  write(join(repo, "agents", "other", "soul", "soul.yaml"), "name: other\ntype: toString\n");
  assert.deepEqual(resolveCapabilities(repo, "other").map((c) => c.id), []);
});

test("a capability command namespace named constructor is not a duplicate of Object.prototype", () => {
  const repo = temp();
  write(join(repo, ".agents", "capabilities", "owned", "acme.x", "oats.json"),
    JSON.stringify({ capability: "acme.x", version: "1.0.0", description: "cap", command: "constructor" }));
  write(join(repo, "oats-config.yaml"), [
    "name: keysafe",
    "capabilities:",
    "  additive:",
    "    acme.x:",
    "      from: owned",
    "      global: true",
    "",
  ].join("\n"));
  // The owner table used to answer `Object` for "constructor", so a SINGLE
  // capability collided with the prototype and the diagnostic embedded native
  // function source.
  assert.deepEqual(resolveOatsConfig(repo).capabilities.map((c) => c.command), ["constructor"]);
  // A REAL duplicate is still refused, and names only real owners.
  write(join(repo, ".agents", "capabilities", "owned", "acme.y", "oats.json"),
    JSON.stringify({ capability: "acme.y", version: "1.0.0", description: "cap", command: "constructor" }));
  writeFileSync(join(repo, "oats-config.yaml"),
    readFileSync(join(repo, "oats-config.yaml"), "utf8") + "    acme.y:\n      from: owned\n      global: true\n");
  assert.throws(() => resolveOatsConfig(repo), (e) => {
    assert.match(e.message, /duplicate capability command namespace "constructor": acme\.[xy], acme\.[xy]/);
    assert.doesNotMatch(e.message, NATIVE_SOURCE);
    return true;
  });
});

/** A hermetic CLI run: the config/lock walk climbs to `/`, so a developer's own
 * ~/oats-config.yaml must not decide what a case sees. */
function runCli(argv, cwd) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(OATS|PI)_/.test(k)) env[k] = v;
  const home = temp();
  Object.assign(env, { HOME: home, OATS_HOME_DIR: join(home, ".oats"), PATH: inertRuntimePath(home) });
  return spawnSync(process.execPath, [CLI, ...argv], { encoding: "utf8", env, cwd: cwd || home });
}
/** A Node crash: an uncaught throw prints the source frame and a stack. */
const NODE_STACK = /^\s+at |\bthrow oatsError\b|node:internal/m;

test("an unsafe config key is a typed CLI failure, not an uncaught stack", () => {
  const dir = temp();
  write(join(dir, "oats-config.yaml"), "name: demo\n__proto__:\n  polluted: true\n");

  for (const argv of [["doctor", dir]]) { // `use` was removed by the workspace model v2
    const human = runCli(argv, dir);
    assert.notEqual(human.status, 0, human.stdout);
    assert.doesNotMatch(human.stderr, NODE_STACK, `${argv[0]} crashed instead of reporting`);
    assert.equal(human.stderr.trim().split("\n").length, 1, human.stderr);
    assert.match(human.stderr, /^oats: unsupported mapping key "__proto__" in /);
    assert.ok(human.stderr.includes(join(dir, "oats-config.yaml")), "the message must name the offending file");

    const json = runCli([...argv, "--json"], dir);
    assert.notEqual(json.status, 0, json.stdout);
    assert.doesNotMatch(json.stderr, NODE_STACK);
    const doc = JSON.parse(json.stdout);
    assert.equal(json.stdout.trim(), JSON.stringify(doc), "exactly one envelope on stdout");
    assert.equal(doc.schemaVersion, 1);
    assert.equal(doc.ok, false);
    assert.equal(doc.error.code, "unsafe-config-key", doc.error.message);
    assert.ok(doc.error.message.includes(join(dir, "oats-config.yaml")));
  }
});

test("the reported filename is the path itself, even when it contains regex substitution syntax", () => {
  // `$&`, `$'`, "$`" and `$1` are substitution syntax in String.replace, so
  // inserting the path as a REPLACEMENT STRING expanded them against the match
  // and corrupted the reported filename. A replacer function passes it as data.
  const weird = "/tmp/$&$'$`$1/oats-config.yaml";
  assert.throws(() => withConfigFile(weird, () => parseYamlNested("__proto__: x\n")), (e) => {
    assert.equal(e.code, "unsafe-config-key");
    assert.ok(e.message.includes(weird), e.message);
    assert.deepEqual(e.provenance, [{ file: weird }]);
    return true;
  });

  // End to end, with a real directory whose name carries the same characters.
  const dir = join(temp(), "$&$'dollar");
  const file = join(dir, "oats-config.yaml");
  write(file, "name: demo\n__proto__:\n  polluted: true\n");
  const r = runCli(["doctor", dir], dir);
  assert.notEqual(r.status, 0, r.stdout);
  assert.ok(r.stderr.includes(file), r.stderr);
});
