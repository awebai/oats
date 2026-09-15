import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { parseConfigData } from "../lib/config-data.mjs";
import { parsePortableSoul } from "../lib/portable-soul.mjs";

const source = `schemaVersion: 1
name: research-expert
requires:
  capabilities:
    example.research:
      source: git:github.com/example/tools@main#packages/research
  messaging: any
defaults:
  tasks:
    capability: example.tasks
    source: repo:packages/tasks
knowledge:
  contract: alternate.documents
  version: 1
  payload:
    collection: research
teams: [experts, marketing]
resources: [references]
work: directory
runtime: pi
yolo: false
`;

test("portable soul parsing preserves requirements/defaults and records exact source origins without choosing providers", () => {
  const result = parsePortableSoul(source, { origin: { kind: "fixture", path: "agents/research/soul.yaml" } });
  assert.equal(result.declaration.requires.messaging, "any");
  assert.equal(result.sources["/requires/capabilities/example.research/source"].path, "packages/research");
  assert.deepEqual(result.sources["/defaults/tasks/source"], { kind: "repo", path: "packages/tasks" });
  assert.equal(result.declaration.knowledge.payload.collection, "research");
  assert.equal(Object.hasOwn(result.declaration.knowledge.payload, "owns"), false, "alternate provider is not forced into OKF");
  assert.deepEqual(result.declaration.teams, ["experts", "marketing"]);
  assert.equal(Object.hasOwn(result, "enrolled"), false);
  assert.equal(Object.hasOwn(result.declaration.defaults, "messaging"), false, "any supplies no provider");
  assert.equal(result.origins["/defaults/tasks/source"].document.path, "agents/research/soul.yaml");
});

test("versioned souls reject removed policy tiers, malformed selections and conflicting syntax, not silently drop fields", () => {
  for (const suffix of ['type: developers\n', 'repo: /author/work\n', '_dir: /internal\n', 'agent-types: {}\n']) {
    assert.throws(() => parsePortableSoul(source + suffix), { code: "invalid-declaration" });
  }
  assert.throws(() => parsePortableSoul(source.replace('schemaVersion: 1', 'schemaVersion: 2')), { code: "unsupported-wire-version" });
  assert.throws(() => parsePortableSoul(source.replace('messaging: any', 'messaging: none')), { code: "invalid-declaration" });
  assert.throws(() => parsePortableSoul(source.replace('teams: [experts, marketing]', 'teams: [experts, experts]')), { code: "invalid-declaration" });
  assert.throws(() => parsePortableSoul(source.replace('resources: [references]', 'resources: [../outside]')), { code: "path-escape" });
  assert.throws(() => parsePortableSoul(source.replace('git:github.com/example/tools@main#packages/research', 'example.research')), (error) => {
    assert.equal(error.code, 'invalid-source');
    assert.equal(error.provenance[0].pointer, '/requires/capabilities/example.research/source');
    return true;
  });
});

test("published soul shape and runtime codec agree on declarations and structural refusals", () => {
  const schema = JSON.parse(readFileSync(new URL('../docs/soul.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv({ strict: true, allErrors: true, ownProperties: true }).compile(schema);
  assert.equal(validate(parsePortableSoul(source).declaration), true, JSON.stringify(validate.errors));
  for (const changed of [source + 'type: developers\n', source.replace('messaging: any', 'messaging: none'),
    source.replace('teams: [experts, marketing]', 'teams: [experts, experts]'), source.replace('resources: [references]', 'resources: [../outside]')]) {
    assert.equal(validate(parseConfigData(changed).value), false);
    assert.throws(() => parsePortableSoul(changed));
  }
});

test("local source preparation requires an explicit base and authorization; parsing otherwise does not consult a workspace", () => {
  const local = source.replace('git:github.com/example/tools@main#packages/research', 'path:packages/research');
  assert.throws(() => parsePortableSoul(local), { code: "invalid-source" });
  const parsed = parsePortableSoul(local, { localBase: "/operator/sources", allowLocalPaths: true });
  assert.equal(parsed.sources['/requires/capabilities/example.research/source'].localPath, '/operator/sources/packages/research');
  assert.equal(parsed.sources['/requires/capabilities/example.research/source'].portable, false);
  const minimal = parsePortableSoul('schemaVersion: 1\nname: minimal-expert\n');
  assert.equal(Object.keys(minimal.sources).length, 0);
  assert.equal(Object.hasOwn(minimal.declaration, 'defaults'), false, 'no ambient defaults invented');
});
