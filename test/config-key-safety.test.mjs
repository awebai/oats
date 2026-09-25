// Config keys are attacker-reachable strings. Every table they index must
// answer for its OWN entries and nothing else: `Object.prototype` supplies
// `constructor`, `toString`, `valueOf`, `hasOwnProperty` … to a plain-object
// lookup, and `__proto__` is not a key at all — assigning it rewrites the
// parsed object's prototype, so the entry disappears from `Object.keys` (past
// every validator) while still answering property reads.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  capabilityManifest, marketplaceCapabilities, parseYamlFlat, parseYamlNested,
  validateConfigShape, withConfigFile,
} from "../lib/core.mjs";

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
});
