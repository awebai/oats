import test from "node:test";
import assert from "node:assert/strict";
import { parseLockedSource3, parsePortableSource, parseRepositorySource, portablePath } from "../lib/source-spec.mjs";

test("portable Git sources retain slash-bearing refs and resolve the documented package default", () => {
  const source = parsePortableSource("git:github.com/example/tools@refs/heads/stable");
  assert.equal(source.source, "git:https://github.com/example/tools.git@refs/heads/stable");
  assert.equal(source.selector, "refs/heads/stable");
  assert.equal(source.path, "oats-package");
  assert.deepEqual(parseLockedSource3(source.source, source.path), source);
  assert.equal(parsePortableSource("git:github.com/example/tools@main#.").path, ".");
  assert.equal(parsePortableSource("git:github.com/example/tools@main#").path, ".");
  assert.equal(parsePortableSource("git:github.com/example/tools@main#packages/research").path, "packages/research");
});

test("SSH authority is not a revision delimiter and explicit repository URLs are not rewritten", () => {
  const scp = parsePortableSource("git:git@example.invalid:group/tools@release/stable#pkg");
  assert.equal(scp.source, "git:ssh://git@example.invalid/group/tools@release/stable");
  assert.equal(scp.path, "pkg");
  assert.deepEqual(parseLockedSource3(scp.source, scp.path), scp);
  const https = parsePortableSource("git:https://example.invalid/group/tools@main#pkg");
  assert.equal(https.url, "https://example.invalid/group/tools", "do not append .git to an explicitly supplied endpoint");
  assert.throws(() => parsePortableSource("git:https://user:secret@example.invalid/group/tools@main"), { code: "invalid-source" });
});

test("repo sources describe a repository-root relation; local paths need explicit authoring authorization and base", () => {
  assert.deepEqual(parsePortableSource("repo:packages/research"), { kind: "repo", path: "packages/research" });
  for (const source of ["repo:../outside", "repo:/absolute", "repo:./package", "repo:pkg//sub"]) {
    assert.throws(() => parsePortableSource(source), { code: "path-escape" });
  }
  assert.throws(() => parsePortableSource("path:/operator/dev"), { code: "invalid-source" });
  assert.throws(() => parsePortableSource("path:dev", { allowLocalPaths: true }), { code: "invalid-source" });
  const local = parsePortableSource("path:dev", { allowLocalPaths: true, localBase: "/operator" });
  assert.deepEqual(local, { kind: "path", source: "path:/operator/dev", path: ".", localPath: "/operator/dev", portable: false });
  assert.deepEqual(parseLockedSource3(local.source, local.path), local);
  assert.throws(() => parsePortableSource("path:~/dev", { allowLocalPaths: true }), { code: "invalid-source" });
});

test("imports and knowledge repository locators never acquire package paths or hidden revisions", () => {
  assert.deepEqual(parseRepositorySource("git:github.com/example/experts"), {
    kind: "git", url: "https://github.com/example/experts.git", normalized: "git:https://github.com/example/experts.git",
  });
  for (const value of ["git:github.com/example/experts@main", "git:github.com/example/experts#."]) {
    assert.throws(() => parseRepositorySource(value), { code: "invalid-source" });
  }
  assert.throws(() => parseRepositorySource("git:file:///operator/experts"), { code: "invalid-source" });
  assert.equal(parseRepositorySource("git:file:///operator/experts", { allowLocalGit: true }).url, "file:///operator/experts");
});

test("ambiguous, source-incomplete and escaping declarations refuse instead of selecting another repository", () => {
  for (const value of ["oats.okf", "./pkg", "git:github.com/example/tools", "git:github.com/example/tools@",
    "git:github.com/example/tools@a@b", "git:github.com/example/tools@a..b", "git:github.com/example/tools@-option",
    "git:github.com/example/tools@main#pkg#other", "git:https://example.invalid/org/../other@main#pkg",
    "git:https://example.invalid/org/%2fother@main#pkg", "git:ext::command@main#pkg"]) {
    assert.throws(() => parsePortableSource(value), { code: "invalid-source" }, value);
  }
  assert.throws(() => parsePortableSource("git:github.com/example/tools@main#../outside"), { code: "path-escape" });
  assert.throws(() => portablePath("C:/outside"), { code: "path-escape" });
});

test("new lock reader requires canonical source/path fields and keeps catalog convenience out of souls", () => {
  assert.throws(() => parseLockedSource3("git:github.com/example/tools@main", "oats-package"), { code: "invalid-source" });
  assert.throws(() => parseLockedSource3("git:https://github.com/example/tools.git@main#pkg", "pkg"), { code: "invalid-source" });
  assert.throws(() => parseLockedSource3("path:/operator/../other", "."), { code: "invalid-source" });
  assert.throws(() => parseLockedSource3("git:https://github.com/example/tools.git@main", "./pkg"), { code: "path-escape" });
  assert.deepEqual(parseLockedSource3("catalog:oats.okf@v2.0.0", "oats-package"), {
    kind: "catalog", source: "catalog:oats.okf@v2.0.0", path: "oats-package", id: "oats.okf", selector: "v2.0.0",
  });
  assert.throws(() => parsePortableSource("catalog:oats.okf@v2.0.0"), { code: "invalid-source" });
});
