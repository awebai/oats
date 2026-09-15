import test from "node:test";
import assert from "node:assert/strict";
import { parseConfigData } from "../lib/config-data.mjs";
import { canonicalJson } from "../lib/portable-values.mjs";

test("portable YAML preserves nested map sequences, source references and pointer origins", () => {
  const source = `schemaVersion: 1
name: example
members:
  - source: git:github.com/example/project
    revision: main
imports:
  - source: git:github.com/publisher/experts
    soul: agents/research-expert
    revision: release/stable
    alias: research
    adoption:
      teams: { experts: platform }
knowledge:
  reads:
    - {store: public, node: research}
`;
  const parsed = parseConfigData(source, { origin: { kind: "fixture", path: "oats-workspace.yaml" } });
  assert.equal(parsed.value.members[0].revision, "main");
  assert.equal(parsed.value.imports[0].adoption.teams.experts, "platform");
  assert.equal(parsed.value.knowledge.reads[0].node, "research");
  assert.equal(Object.getPrototypeOf(parsed.value.imports[0]), null);
  assert.equal(parsed.origins["/imports/0/revision"].pointer, "/imports/0/revision");
  assert.equal(source.slice(...Object.values(parsed.origins["/imports/0/revision"].span)), "release/stable");
  assert.equal(parsed.integrity.format, "oats.bytes.v1");
});

test("JSON uses the shared strict reader and quoted YAML metacharacters remain data", () => {
  assert.equal(canonicalJson(parseConfigData('{"x":[1,true,null]}').value), '{"x":[1,true,null]}\n');
  const parsed = parseConfigData('a: "*alias"\nb: "&anchor"\n"<<": ordinary\ntext: |\n  first\n  second\n');
  assert.equal(parsed.value.a, "*alias");
  assert.equal(parsed.value.b, "&anchor");
  assert.equal(parsed.value["<<"], "ordinary");
  assert.equal(parsed.value.text, "first\nsecond\n");
  assert.throws(() => parseConfigData('{"a":1,"\\u0061":2}'), { code: "invalid-declaration" });
});

test("aliases, tags, duplicate/coercive keys, malformed indentation and multiple documents refuse", () => {
  for (const source of [
    'a: &shared [1]\nb: *shared\n',
    'a: *missing\n',
    'a: !!str 1\n',
    '<<: {x: 1}\n',
    'a: 1\na: 2\n',
    'a: 1\n"\\u0061": 2\n',
    '1: one\n',
    'a:\n  b: 1\n c: 2\n',
    '---\na: 1\n---\nb: 2\n',
    'a: .inf\n',
  ]) assert.throws(() => parseConfigData(source), { code: "invalid-declaration" }, source);
});

test("portable documents enforce byte/depth/entry limits without reading input getters", () => {
  assert.throws(() => parseConfigData('a: 1', { limits: { maxBytes: 2 } }), { code: "resource-limit" });
  assert.throws(() => parseConfigData('a:\n  b:\n    c: 1\n', { limits: { maxDepth: 1 } }), { code: "resource-limit" });
  assert.throws(() => parseConfigData('a: [1, 2, 3]', { limits: { maxEntries: 3 } }), { code: "resource-limit" });
  const bytes = new Uint8Array(Buffer.from('a: 1'));
  let accessed = false;
  Object.defineProperty(bytes, "byteLength", { get() { accessed = true; return 0; } });
  assert.throws(() => parseConfigData(bytes, { limits: { maxBytes: 1 } }), { code: "resource-limit" });
  assert.equal(accessed, false);
});
