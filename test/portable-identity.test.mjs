import test from "node:test";
import assert from "node:assert/strict";
import { sameIdentity, soulIdentityKey, validateRepositoryIdentity, validateSoulIdentity, validateWorkspaceIdentity } from "../lib/portable-identity.mjs";

const repository = { kind: "provider-repository", provider: "github", host: "github.com", id: "123" };
const soul = { kind: "git-soul", repository, exportPath: "agents/research-expert" };

test("qualified soul identity excludes revision, alias and local checkout placement", () => {
  assert.equal(validateSoulIdentity(soul), soul);
  assert.equal(soulIdentityKey(soul), soulIdentityKey({ exportPath: soul.exportPath, repository, kind: "git-soul" }));
  assert.equal(sameIdentity(soul, { ...soul, repository: { ...repository, id: "456" } }), false);
  assert.notEqual(soulIdentityKey(soul), soulIdentityKey({ ...soul, repository: { ...repository, id: "456" } }));
  for (const extra of [{ alias: "research" }, { revision: "main" }, { checkout: "/operator/repo" }]) {
    assert.throws(() => validateSoulIdentity({ ...soul, ...extra }), { code: "invalid-declaration" });
  }
});

test("workspace and canonical-remote identities validate shape without claiming observed membership", () => {
  const workspace = { repository, path: "oats-workspace.yaml" };
  assert.equal(validateWorkspaceIdentity(workspace), workspace);
  assert.equal(Object.hasOwn(workspace, "eligible"), false);
  assert.throws(() => validateWorkspaceIdentity({ ...workspace, path: "other.yaml" }), { code: "invalid-declaration" });
  assert.throws(() => validateRepositoryIdentity({ ...repository, host: "GitHub.com" }), { code: "invalid-declaration" });
  assert.throws(() => validateRepositoryIdentity({ kind: "canonical-remote", remote: "git:github.com/example/repo" }), { code: "invalid-declaration" });
  assert.equal(validateRepositoryIdentity({ kind: "canonical-remote", remote: "git:https://github.com/example/repo.git" }).kind, "canonical-remote");
});

test("local-only identity uses an explicit canonical source, not an ambient directory", () => {
  assert.equal(validateSoulIdentity({ kind: "local-soul", source: "path:/operator/soul", exportPath: "." }).kind, "local-soul");
  assert.throws(() => validateSoulIdentity({ kind: "local-soul", source: "path:relative", exportPath: "." }), { code: "invalid-source" });
  assert.throws(() => validateSoulIdentity({ ...soul, exportPath: "../other" }), { code: "path-escape" });
});
