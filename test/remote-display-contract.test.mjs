/** Display projections must not overwrite values subsequently consumed by commands. */
import test from "node:test";
import assert from "node:assert/strict";
import { parseRepoRef, redactUrl } from "../lib/remote.mjs";
import { discoverWorkspace, observeWorkspace, readDeclaration, validateSoul } from "../lib/workspace.mjs";

const TOKEN = "CONTRACT_CREDENTIAL_MARKER";
const WITHHELD = "[repository reference withheld]";
const commit = "a".repeat(40);
const workspaceRef = "git:host.invalid/org/workspace";
const soul = (from) => ({ schemaVersion: 2, name: "fixture", description: "fixture", work: "directory", capabilities: { "fixture.cap": { from } } });
const remoteFor = (workspace, externalSoul = soul("here")) => ({
  parseRepoRef,
  async listRemoteTree() { assert.fail("fixture has no member trees to enumerate"); },
  async observeRemote(ref) { const parsed = parseRepoRef(ref); return { ...parsed, commit, observedAt: "2026-10-13T00:00:00Z" }; },
  async readRemoteFile(ref, at, path) {
    assert.equal(at, commit);
    return { bytes: Buffer.from(JSON.stringify(path === "oats-workspace.yaml" ? workspace : externalSoul)) };
  },
});

test("soul from diagnostics retain the pointer and raw decoded configuration", () => {
  for (const from of [`https://${TOKEN}@host.invalid/org/repo`, `https://${TOKEN}@host.invalid/org/repo mixed`]) {
    const value = soul(from), before = structuredClone(value);
    const problems = validateSoul(value);
    assert.ok(problems.some(p => p.path === "/capabilities/fixture.cap/from"));
    assert.ok(!JSON.stringify(problems).includes(TOKEN));
    assert.deepEqual(value, before, "validation cannot rewrite operational capability.from");
    const declaration = readDeclaration("soul", Buffer.from(JSON.stringify(value)), { path: "souls/fixture/soul.yaml", repoKey: "host.invalid/org/repo", commit });
    assert.equal(declaration.value.capabilities["fixture.cap"].from, from);
    assert.deepEqual(declaration.problems, problems);
    assert.ok(problems.some(p => p.message.includes(from.endsWith(" mixed") ? WITHHELD : "https://host.invalid/org/repo")));
  }
  const canonical = soul("host.invalid/org/repo");
  assert.deepEqual(validateSoul(canonical), []);
  assert.equal(canonical.capabilities["fixture.cap"].from, "host.invalid/org/repo");
});

test("configured mixed-member refusal retains file, pointer, commit and repository location", async () => {
  const member = `https://${TOKEN}@host.invalid/org/repo https://other.invalid/a/b`;
  const workspace = { schemaVersion: 2, name: "fixture", members: [member] };
  await assert.rejects(observeWorkspace(workspaceRef, { remote: remoteFor(workspace) }), e => {
    assert.equal(e.code, "E_WORKSPACE_SCHEMA");
    assert.equal(e.details.path, "oats-workspace.yaml");
    assert.equal(e.details.repoKey, "host.invalid/org/workspace");
    assert.equal(e.details.commit, commit);
    assert.ok(e.message.includes("oats-workspace.yaml"));
    assert.ok(e.message.includes("/members/0"));
    assert.ok(e.message.includes(WITHHELD));
    assert.ok(!JSON.stringify({ message: e.message, details: e.details, provenance: e.provenance }).includes(TOKEN));
    assert.equal(e.message.split("(the repository reference was withheld)").length - 1, 1);
    assert.ok(e.details.problems.every(p => p.path === "/members/0"));
    return true;
  });
  assert.equal(workspace.members[0], member);
});

test("external problem source is display-only while successful and configured sources remain exact", async () => {
  for (const [ref, display] of [
    ["git:host.invalid/org/external", "git:host.invalid/org/external"],
    ["https://host.invalid/org/external", "https://host.invalid/org/external"],
  ]) {
    const source = `${ref}@${commit}`;
    const workspace = { schemaVersion: 2, name: "fixture", external: [{ source, soul: "souls/fixture" }] };
    const invalid = soul(`https://${TOKEN}@host.invalid/org/cap`);
    const discovery = await discoverWorkspace(workspaceRef, { remote: remoteFor(workspace, invalid) });
    const problem = discovery.problems.find(p => p.path === "external/0:souls/fixture/soul.yaml#/capabilities/fixture.cap/from");
    assert.ok(problem);
    assert.equal(problem.source, `${display}@${commit}`);
    assert.ok(!JSON.stringify(problem).includes(TOKEN));
    assert.equal(discovery.workspace.external[0].source, source);
    assert.equal(discovery.soulsUnread.external[0], source, "deduplication still uses the exact configured source");
    const success = await discoverWorkspace(workspaceRef, { remote: remoteFor(workspace) });
    assert.equal(success.external[0].source, source, "resolver repo/name matching needs the original source");
    assert.equal(success.external[0].soul.definition.capabilities["fixture.cap"].from, "here");
    assert.equal(redactUrl(success.external[0].source, null, { reference: true }), WITHHELD, "pinned sources require explicit context");
    assert.equal(redactUrl(success.external[0].source, null, { pinned: true }), problem.source);
    assert.equal(redactUrl(problem.source, null, { pinned: true }), problem.source, "listing projection is idempotent");
    assert.equal(success.external[0].source, source, "display projection cannot mutate its source");
  }
});


test("literal reference collisions cannot rename fixed diagnostic field keys", () => {
  for (const input of ["ref", "url", "host", "path", "reason", "[repository reference withheld]"]) {
    assert.throws(() => parseRepoRef(input), e => {
      assert.equal(e.code, "E_REPO_REF");
      assert.deepEqual(Object.keys(e.details), ["ref"]);
      assert.equal(e.details.ref, WITHHELD);
      assert.equal(e.details, e.provenance);
      return true;
    });
  }
});


test("pinned display requires an explicit usable reference and a full OID", () => {
  const refs = ["git:host.invalid/org/repo", "https://host.invalid/org/repo", `ssh://u:${TOKEN}@host.invalid:22/org/repo`, "/owned/repo", "file:///owned/repo"];
  for (const ref of refs) {
    const display = ref.startsWith("ssh:") ? "ssh://host.invalid:22/org/repo" : ref;
    const input = `${ref}@${commit}`;
    assert.equal(redactUrl(input, null, { pinned: { ref, commit } }), `${display}@${commit}`);
    assert.equal(redactUrl(input, null, { pinned: true }), `${display}@${commit}`);
    assert.equal(redactUrl(`${display}@${commit}`, null, { pinned: true }), `${display}@${commit}`);
    for (const bad of ["", "a".repeat(39), "a".repeat(41), "A".repeat(40), `${commit}\n`, "not-an-oid"]) {
      assert.equal(redactUrl(`${ref}@${bad}`, null, { pinned: { ref, commit: bad } }), WITHHELD);
      assert.equal(redactUrl(`${ref}@${bad}`, null, { pinned: true }), WITHHELD);
    }
  }
  for (const ref of [`https://u:${TOKEN}/extra@host.invalid/org/repo`, `https://host.invalid/org/repo https://${TOKEN}@other.invalid/a/b`]) {
    assert.equal(redactUrl(`${ref}@${commit}`, null, { pinned: { ref, commit } }), WITHHELD);
    assert.equal(redactUrl(`${ref}@${commit}`, null, { pinned: true }), WITHHELD);
  }
  assert.equal(redactUrl("https://host.invalid/org/repo", null, { pinned: true }), WITHHELD);
  assert.equal(redactUrl(WITHHELD, null, { pinned: true }), WITHHELD);
  assert.equal(redactUrl(`https://host.invalid/org/repo@${commit}`, null, { pinned: { ref: "https://other.invalid/a/b", commit } }), WITHHELD);
  for (const path of ["/owned/a@b/repo", "file:///owned/a@b/repo"]) assert.equal(redactUrl(path, null, { reference: true }), path);
});


test("credentialed SSH pinned display does not expand configured external admission", async () => {
  const source = `ssh://user:${TOKEN}@host.invalid:2222/org/external@${commit}`;
  const workspace = { schemaVersion: 2, name: "fixture", external: [{ source, soul: "souls/fixture" }] };
  await assert.rejects(discoverWorkspace(workspaceRef, { remote: remoteFor(workspace) }), e => {
    assert.equal(e.code, "E_WORKSPACE_SCHEMA");
    assert.equal(e.details.path, "oats-workspace.yaml");
    assert.ok(e.details.problems.some(p => p.path === "/external/0/source"));
    assert.ok(!JSON.stringify({ message: e.message, details: e.details }).includes(TOKEN));
    return true;
  });
  assert.equal(redactUrl(source, null, { pinned: true }), `ssh://host.invalid:2222/org/external@${commit}`);
  assert.equal(workspace.external[0].source, source);
});
