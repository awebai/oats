/** Remote refusal rendering: synthetic credentials only, no network or shared cache. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { oatsError } from "../lib/errors.mjs";
import { redactUrl, scrubGitLine, parseRepoRef, observeRemote, readRemoteFile, runGit } from "../lib/remote.mjs";
import { confirmMembership, validateWorkspace, validateLocal, loadLocal } from "../lib/workspace.mjs";
import { parsePackageRequest, resolvePackages } from "../lib/packages.mjs";
import { remoteFailureCause } from "../packages/client/deployment-contract.mjs";

const USER = "FIXTURE_USER_TOKEN", PASSWORD = "FIXTURE_PASSWORD_TOKEN";
const host = "example.invalid", path = "org/repo.git", key = "example.invalid/org/repo";
const ssh = `ssh://${USER}:${PASSWORD}@${host}/${path}`;
const clean = `ssh://${host}/${path}`;
const https = [`https://${USER}@${host}/${path}`, `https://${USER}:${PASSWORD}@${host}/${path}`];
const roots = [];
const scratch = () => { const dir = mkdtempSync(join(tmpdir(), "oats-redaction-")); roots.push(dir); return dir; };
test.after(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }); });
const refused = async (fn) => { try { await fn(); } catch (e) { return e; } assert.fail("expected refusal"); };
const noTokens = (value) => {
  const text = JSON.stringify(value);
  for (const token of [USER, PASSWORD]) assert.ok(!text.includes(token), `diagnostic leaked ${token}: ${text}`);
};
const safeError = (e, code) => {
  assert.equal(e.code, code);
  noTokens({ message: e.message, details: e.details, provenance: e.provenance });
  assert.equal(e.details, e.provenance, "both diagnostic aliases use the rendered copy");
};
const gitError = (stderr, extra = {}) => Object.assign(new Error("fixture Git failure"), { code: 128, stderr: Buffer.from(stderr), ...extra });

// The common boundary means even a newly added diagnostic with raw interpolations is safe.
// Pin that construction, not a list of the currently known failure messages.
test("every remote diagnostic uses the renderer at its error boundary", () => {
  const source = readFileSync(new URL("../lib/remote.mjs", import.meta.url), "utf8");
  const definition = source.match(/function fail\(code, message, details\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(definition);
  assert.equal((source.match(/\boatsError\(/g) || []).length, 1, "new diagnostic constructors must use fail");
  const diagnostic = new Function("oatsError", "redactUrl", `${definition}; return fail;`)(oatsError, redactUrl);
  const details = { url: ssh, ref: { nested: [https[0]], [https[1]]: true }, path: https[1], reason: "unknown" };
  const e = diagnostic("E_REMOTE_UNREADABLE", `new diagnostic: ${ssh}; ${PASSWORD}`, details);
  safeError(e, "E_REMOTE_UNREADABLE");
  assert.equal(e.details.reason, "unknown");
  assert.equal(details.url, ssh, "never mutate the operational source");
  assert.equal(e.details.url, clean);
  const urlInterpolations = source.split("\n").filter((line) => line.includes("${ref.url}"));
  assert.equal(urlInterpolations.length, 1, "raw URL interpolation is reserved for transport");
  assert.match(urlInterpolations[0], /remote\.origin\.url=/);
  assert.match(source, /function scrubGitLine[\s\S]*?const text = redactUrl\(/, "Git line formatting delegates redaction");
});

test("parser refusals redact strings, malformed URLs, nested objects and auxiliary fields", async () => {
  const bad = [
    ...https, `http://${USER}:${PASSWORD}@${host}/${path}`,
    `https://${USER}:${PASSWORD}@@${host}/${path}`,
    `https://${USER}:${PASSWORD}/extra@${host}/${path}`,
    `https://${USER} ${PASSWORD}@${host}/${path}`,
    `https://${USER}\n${PASSWORD}@${host}/${path}`,
    `https://${USER}:${PASSWORD}@bad host/${path}`,
    `file://${USER}:${PASSWORD}@${host}/${path}`,
    `ssh://${USER}:${PASSWORD}@bad_host/${path}`,
    `ssh://${USER}:${PASSWORD}@${host}/bad path`,
    { key, url: https[0] }, { key: https[0], url: ssh },
    { bad: [https[0], { [https[1]]: ssh }] },
  ];
  for (const ref of bad) safeError(await refused(() => parseRepoRef(ref)), "E_REPO_REF");
  // Invalid non-reference options also cross the module's diagnostic boundary.
  safeError(await refused(() => parseRepoRef("git:example.invalid/org/repo", { transport: https[0] })), "E_REPO_REF");
  safeError(await refused(() => readRemoteFile(ssh, https[0], "x")), "E_REPO_REF");
  assert.equal(parseRepoRef(ssh).url, ssh);
  assert.equal(parseRepoRef(`ssh://${USER}@${host}/${path}`).url, `ssh://${USER}@${host}/${path}`);
});

test("one renderer handles quoted URLs, SCP host display and credentials echoed outside URLs", () => {
  for (const ref of [...https, ssh, `ssh://${USER}@${host}/${path}`, `git@${host}:${path}`]) {
    const displayed = redactUrl(ref);
    noTokens(displayed);
    assert.equal(remoteFailureCause({ reason: "unknown", url: displayed }).host, host);
  }
  assert.equal(redactUrl(`git@${host}:${path}`), clean);
  assert.equal(redactUrl(`failure '${https[0]}' and '${ssh}'`), `failure 'https://${host}/${path}' and '${clean}'`);
  noTokens(scrubGitLine(`fatal: '${ssh}': ${PASSWORD}`, ssh));
  noTokens(scrubGitLine(`fatal: ${USER} and ${PASSWORD}`, https[1]));
  assert.equal(scrubGitLine("secret%5Fvalue and secret_value", "ssh://bot:secret%5Fvalue@example.invalid/org/repo"), "and");
  assert.equal(redactUrl("normal host/path and opaque text"), "normal host/path and opaque text");
  // A credential equal to a classification word cannot change the contract's reason value.
  assert.equal(redactUrl({ url: "https://unknown@example.invalid/org/repo", reason: "unknown" }).reason, "unknown");
});

test("SSH read, cache stderr and explicit fetch timeout redact output but preserve Git transport", async () => {
  for (const kind of ["unknown", "cache", "timeout"]) {
    const argsSeen = [];
    const exec = async (args, opts) => {
      argsSeen.push(args);
      if (args.includes("fetch")) throw gitError(
        kind === "cache" ? `fatal: unable to write file for ${ssh}; password ${PASSWORD}` : `fatal: unexpected refusal for ${ssh}; password ${PASSWORD}`,
        kind === "timeout" ? { timedOut: true } : {},
      );
      return runGit(args, opts);
    };
    const e = await refused(() => readRemoteFile(ssh, "1".repeat(40), "small", { cacheDir: scratch(), exec }));
    safeError(e, "E_REMOTE_UNREADABLE");
    assert.equal(e.details.reason, kind);
    assert.equal(e.details.url, clean);
    assert.ok(argsSeen.some((args) => args.includes(`remote.origin.url=${ssh}`)), "Git receives the credential-bearing URL unchanged");
    if (kind === "timeout") { assert.equal(e.details.operation, "fetch"); assert.match(e.message, /git fetch.*timed out/); }
    if (kind === "cache") assert.match(e.message, /unable to write file/);
  }
});

test("ref-not-found and malformed Git advertisement diagnostics redact their URL", async () => {
  for (const advertisement of ["", "invalid\tHEAD\n"]) {
    const exec = async (args, opts) => args.includes("ls-remote")
      ? { stdout: Buffer.from(advertisement), stderr: Buffer.alloc(0) } : runGit(args, opts);
    const e = await refused(() => observeRemote(ssh, { cacheDir: scratch(), exec }));
    safeError(e, "E_REMOTE_UNREADABLE");
    assert.equal(e.details.reason, "not-found");
  }
});

test("membership answers redact both cannot-read and invalid-ref diagnostics, including injected errors", async () => {
  const workspaceObs = { key: "example.invalid/org/workspace", commit: "1".repeat(40), workspace: { schemaVersion: 2, name: "fixture", members: ["git:example.invalid/org/repo"] } };
  const exec = async (args, opts) => { if (args.includes("ls-remote")) throw gitError(`fatal: ${ssh} ${PASSWORD}`); return runGit(args, opts); };
  const row = await confirmMembership(workspaceObs, ssh, { remoteOptions: { cacheDir: scratch(), exec } });
  noTokens(row); assert.equal(row.reason, "cannot-read"); assert.equal(row.url, clean); assert.equal(row.key, key);
  const injected = { parseRepoRef, observeRemote: async () => { throw Object.assign(new Error("unreadable"), { code: "E_REMOTE_UNREADABLE", details: { url: ssh, reason: "auth" } }); }, readRemoteFile, listRemoteTree: async () => [] };
  const other = await confirmMembership(workspaceObs, ssh, { remote: injected });
  noTokens(other); assert.equal(other.reason, "cannot-read"); assert.equal(other.url, clean);
  for (const ref of https) { const invalid = await confirmMembership(workspaceObs, ref); noTokens(invalid); assert.equal(invalid.reason, "not-listed"); }
});

test("configured reference fields and package refusals redact without admitting new syntax or filtering unrelated values", async () => {
  for (const ref of [...https, ssh, `ssh://${USER}@${host}/${path}`]) {
    const workspace = { schemaVersion: 2, name: "fixture", members: [ref], packages: { "fixture.pkg": `git:${ref}@v1` } };
    const problems = validateWorkspace(workspace);
    assert.ok(problems.some((p) => p.path === "/members/0"));
    assert.ok(problems.some((p) => p.path === "/packages/fixture.pkg"));
    noTokens(problems);
    assert.equal(workspace.members[0], ref);
    const local = { schemaVersion: 2, workspace: ref };
    noTokens(validateLocal(local));
    const dir = scratch(); writeFileSync(join(dir, "oats-local.yaml"), JSON.stringify(local));
    safeError(await refused(() => loadLocal(dir)), "E_WORKSPACE_SCHEMA");
    const e = await refused(() => parsePackageRequest("fixture.pkg", `git:${ref}@v1`, {}));
    safeError(e, "E_REPO_REF");
    assert.equal(e.details.path, "/packages/fixture.pkg");
  }
  const unrelated = validateWorkspace({ schemaVersion: 2, name: https[0], members: ["git:example.invalid/org/repo"], messaging: { url: https[1] } });
  assert.ok(unrelated.some((p) => p.path === "/name" && p.message.includes(USER)), "unrelated invalid values retain their diagnostic");
  assert.ok(!unrelated.some((p) => p.path.startsWith("/messaging")), "opaque provider data is not scanned");
  assert.deepEqual(validateWorkspace({ schemaVersion: 2, name: "fixture", members: [`git@${host}:${path}`] }), []);
});

test("catalog source reaches real remote refusal rendering", async () => {
  for (const ref of [...https, ssh]) {
    const exec = async (args, opts) => { if (args.includes("ls-remote")) throw gitError(`fatal: ${ssh} ${PASSWORD}`); return runGit(args, opts); };
    const e = await refused(() => resolvePackages({ packages: { "fixture.pkg": "v1" } }, { catalog: { "fixture.pkg": { url: ref, ref: "v1" } }, remoteOptions: { cacheDir: scratch(), exec } }));
    safeError(e, ref === ssh ? "E_REMOTE_UNREADABLE" : "E_REPO_REF");
  }
});
