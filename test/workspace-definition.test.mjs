import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { parseMemberExports, parseSoulImport, parseWorkspaceDefinition } from "../lib/workspace-definition.mjs";

const imported = { source: "git:github.com/publisher/experts", soul: "agents/research-expert", revision: "main", alias: "research" };
const workspace = {
  schemaVersion: 1, name: "Example workspace",
  members: [{ source: "git:github.com/example/project", revision: "main" }],
  defaults: { messaging: { capability: "example.messaging", source: "git:github.com/example/messaging@main" } },
  knowledge: { stores: [{ contract: "alternate.documents", version: 1, payload: { location: "public-corpus" } }] },
  teams: { private: "per-human", experts: { provider: "example.messaging", id: "experts:example.invalid" } },
  catalogs: [{ source: "git:github.com/example/tools", path: "oats.yaml" }],
  imports: [{ ...imported, adoption: { teamAliases: { research: "experts" }, providers: { tasks: "none" }, bindings: {} } }],
};

test("workspace data preserves shared defaults, stores and team references without admission or enrollment claims", () => {
  const parsed = parseWorkspaceDefinition(JSON.stringify(workspace));
  assert.equal(parsed.members[0].source, "git:https://github.com/example/project.git");
  assert.equal(parsed.sources["/defaults/messaging/source"].path, "oats-package");
  assert.equal(parsed.imports[0].adoption.teamAliases.research, "experts");
  assert.equal(parsed.declaration.knowledge.stores[0].payload.location, "public-corpus");
  assert.equal(parsed.declaration.teams.private, "per-human");
  for (const key of ["eligible", "enrolled", "trusted", "privateTeamId"]) assert.equal(Object.hasOwn(parsed, key), false);
});

test("the identical external soul reference works standalone and in a workspace without copying or requiring publisher membership", () => {
  const standalone = parseSoulImport(imported);
  const inWorkspace = parseWorkspaceDefinition(JSON.stringify({ schemaVersion: 1, name: "org", imports: [imported] }));
  assert.deepEqual(inWorkspace.imports[0], standalone.reference);
  const renamed = parseSoulImport({ ...imported, alias: "another-alias" }).reference;
  assert.equal(renamed.source, standalone.reference.source);
  assert.equal(renamed.soul, standalone.reference.soul);
  assert.equal(renamed.revision, standalone.reference.revision);
  assert.equal(inWorkspace.members.length, 0, "source consumption is not membership");
});

test("member exports cover source/package/store repositories with explicit contained soul definition paths", () => {
  const parsed = parseMemberExports(JSON.stringify({ schemaVersion: 1,
    workspace: { source: "git:github.com/example/workspace" },
    exports: { souls: [{ path: "agents/expert", definition: "agents/expert/soul/soul.yaml" }],
      packages: [{ path: "." }], knowledge: [{ contract: "alternate.documents", version: 1, payload: { store: "public" } }] },
  }));
  assert.equal(parsed.workspace.source, "git:https://github.com/example/workspace.git");
  assert.equal(parsed.exports.souls[0].definition, "agents/expert/soul/soul.yaml");
  assert.equal(parseMemberExports('{"schemaVersion":1,"exports":{}}').workspace, null, "public nonmember export index is valid data");
  assert.throws(() => parseMemberExports(JSON.stringify({ schemaVersion: 1, exports: {
    souls: [{ path: "agents/expert", definition: "another/soul.yaml" }],
  } })), { code: "invalid-declaration" });
});

test("workspace/member schemas resolve shared definitions without network and agree on structural boundaries", () => {
  const ajv = new Ajv({ strict: true, ownProperties: true });
  for (const name of ["soul", "oats-workspace", "oats-member"]) {
    ajv.addSchema(JSON.parse(readFileSync(new URL(`../docs/${name}.schema.json`, import.meta.url), "utf8")));
  }
  const validateWorkspace = ajv.getSchema("https://oats.dev/schemas/workspace-v1.json");
  const validateMember = ajv.getSchema("https://oats.dev/schemas/member-v1.json");
  assert.equal(validateWorkspace(workspace), true, JSON.stringify(validateWorkspace.errors));
  assert.equal(validateMember({ schemaVersion: 1, exports: {} }), true, JSON.stringify(validateMember.errors));
  assert.equal(validateWorkspace({ ...workspace, "agent-types": {} }), false);
  assert.equal(validateMember({ schemaVersion: 1, exports: {}, defaults: {} }), false);
  assert.throws(() => parseMemberExports('{"schemaVersion":1,"exports":{},"defaults":{}}'), { code: "invalid-declaration" });
});

test("duplicate aliases/members and extra policy tiers refuse with both relevant origins", () => {
  for (const field of ["members", "imports"]) {
    const value = structuredClone(workspace); value[field].push(value[field][0]);
    assert.throws(() => parseWorkspaceDefinition(JSON.stringify(value)), (error) => {
      assert.equal(error.code, "requirement-conflict");
      assert.deepEqual(error.provenance.map((p) => p.pointer), [`/${field}/0`, `/${field}/1`]);
      return true;
    });
  }
  assert.throws(() => parseWorkspaceDefinition(JSON.stringify({ ...workspace, "agent-types": {} })), { code: "invalid-declaration" });
  assert.throws(() => parseWorkspaceDefinition(JSON.stringify({ ...workspace, teams: { private: "none" } })), { code: "invalid-declaration" });
  assert.throws(() => parseSoulImport({ ...imported, source: "git:github.com/publisher/experts@main" }), { code: "invalid-source" });
  assert.throws(() => parseSoulImport({ ...imported, adoption: { providers: { capabilities: {} } } }), { code: "invalid-declaration" });
});
