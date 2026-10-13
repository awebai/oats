/** Remote refusal rendering: synthetic credentials only, no network or shared cache. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { oatsError } from "../lib/errors.mjs";
import { redactUrl, scrubGitLine, parseRepoRef, observeRemote, readRemoteFile, runGit } from "../lib/remote.mjs";
import { confirmMembership, observeWorkspace, validateWorkspace, validateLocal, loadLocal } from "../lib/workspace.mjs";
import { parsePackageRequest, resolvePackages } from "../lib/packages.mjs";
import { remoteFailureCause } from "../packages/client/deployment-contract.mjs";

const USER = "FIXTURE_USER_TOKEN", PASSWORD = "FIXTURE_PASSWORD_TOKEN";
const host = "example.invalid", path = "org/repo.git", key = "example.invalid/org/repo";
const ssh = `ssh://${USER}:${PASSWORD}@${host}/${path}`;
const clean = `ssh://${host}/${path}`;
const https = [`https://${USER}@${host}/${path}`, `https://${USER}:${PASSWORD}@${host}/${path}`];
const malformed = [
  `git:${USER}@${host}/${path}`, `${USER}@${host}/${path}`,
  `${USER}@my_host:org/repo`, `https:/${USER}@${host}/${path}`,
  `https:${USER}@${host}/${path}`,
  `https://${USER}:${PASSWORD}/extra@${host}/${path}`,
  `https://${USER}:123/extra@${host}/${path}`,
  `https://${USER}:${PASSWORD}/extra@${host}`,
];
const clause = "(its user information is not shown)";
const httpUserinfoReason = (ref) => `repository reference ${ref} carries user information, which an http(s) reference may not: give credentials to Git (a credential helper), not in the URL`;
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
  const e = diagnostic("E_REMOTE_UNREADABLE", `new diagnostic: ${ssh}`, details);
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
    ...malformed, ...https, `http://${USER}:${PASSWORD}@${host}/${path}`,
    `https://${USER}:${PASSWORD}@@${host}/${path}`,
    `https://${USER}:${PASSWORD}/extra@${host}/${path}`,
    `https://${USER}:123/extra@${host}/${path}`,
    `https://${USER} ${PASSWORD}@${host}/${path}`,
    `https://${USER}\n${PASSWORD}@${host}/${path}`,
    `https://${USER}:${PASSWORD}@bad host/${path}`,
    `file://${USER}:${PASSWORD}@${host}/${path}`,
    `ssh://${USER}:${PASSWORD}@bad_host/${path}`,
    `ssh://${USER}:${PASSWORD}@${host}/bad path`,
    { key, url: https[0] }, { key: https[0], url: ssh },
    { bad: [https[0], { [https[1]]: ssh }] },
    { bad: [malformed[0], { [malformed[1]]: malformed[2] }] },
  ];
  for (const ref of bad) safeError(await refused(() => parseRepoRef(ref)), "E_REPO_REF");
  // Invalid non-reference options also cross the module's diagnostic boundary.
  safeError(await refused(() => parseRepoRef("git:example.invalid/org/repo", { transport: https[0] })), "E_REPO_REF");
  safeError(await refused(() => readRemoteFile(ssh, https[0], "x")), "E_REPO_REF");
  assert.equal(parseRepoRef(ssh).url, ssh);
  assert.equal(parseRepoRef(`ssh://${USER}@${host}/${path}`).url, `ssh://${USER}@${host}/${path}`);
});

test("refusals explain removed userinfo once, without changing diagnostic fields", async () => {
  const refs = [...https, `https://:${PASSWORD}@${host}/${path}`,
    `ssh://${USER}:${PASSWORD}@bad_host/${path}`, `ssh://${USER}:${PASSWORD}@${host}/bad path`, ...malformed];
  for (const ref of refs) {
    const e = await refused(() => parseRepoRef(ref));
    safeError(e, "E_REPO_REF");
    assert.ok(e.message.endsWith(clause), ref);
    assert.equal(e.message.split(clause).length - 1, 1);
    assert.equal(e.details.ref, redactUrl(ref, null, { reference: true }));
    assert.ok(!JSON.stringify(e.details).includes(clause), "only the message carries the explanation");
    const value = `git:${ref}@v1`;
    const pkg = await refused(() => parsePackageRequest("p", value, {}));
    safeError(pkg, "E_REPO_REF");
    assert.ok(pkg.message.endsWith(clause), value);
    assert.doesNotMatch(pkg.message, /give credentials|credential helper/, "package refusal keeps its own cause, without HTTP parser advice");
    assert.equal(pkg.message.split(clause).length - 1, 1);
    assert.deepEqual(pkg.details, { id: "p", value: redactUrl(value, null, { reference: true }),
      path: "/packages/p", problems: ["a git package carries exactly one @<ref> (a repo ref has no @ except the git@host: ssh form)"] });
  }
  // Non-git package refusals have a schema code but still quote the refused value.
  const pkg = await refused(() => parsePackageRequest("p", https[0], {}));
  safeError(pkg, "E_WORKSPACE_SCHEMA");
  assert.ok(pkg.message.endsWith(clause));
  // Invalid object inputs and validated objects forwarded to the string parser.
  for (const ref of [{ bad: [https[0], { [https[1]]: ssh }] }, { key, url: https[0] },
    { key: "other.invalid/o/r", url: ssh }]) {
    const e = await refused(() => parseRepoRef(ref));
    safeError(e, "E_REPO_REF");
    assert.equal(e.message.split(clause).length - 1, 1);
    assert.ok(!JSON.stringify(e.details).includes(clause));
    assert.equal(redactUrl(`forwarded: ${e.message}`, [https[0], ssh], { known: false, refusal: true }), `forwarded: ${e.message}`);
  }
  const workspaceObs = { key: "example.invalid/org/workspace", commit: "1".repeat(40),
    workspace: { schemaVersion: 2, name: "fixture", members: ["git:example.invalid/org/repo"] } };
  const row = await confirmMembership(workspaceObs, https[0]);
  noTokens(row);
  assert.equal(row.detail.split(clause).length - 1, 1, "membership forwards the refusal once");
});

test("HTTP userinfo refusals name their cause and remedy, while SSH host/path refusals only explain omission", async () => {
  for (const scheme of ["http", "https"]) for (const info of [USER, `${USER}:${PASSWORD}`, `:${PASSWORD}`]) {
    const ref = `${scheme}://${info}@${host}/${path}`;
    const e = await refused(() => parseRepoRef(ref));
    safeError(e, "E_REPO_REF");
    const shown = `${scheme}://${host}/${path}`;
    assert.equal(e.message, `${httpUserinfoReason(shown)} ${clause}`);
    assert.deepEqual(e.details, { ref: shown });
  }
  for (const [ref, shown, field, value] of [
    ["git@my_host:org/repo", "ssh://my_host/org/repo", "host", "my_host"],
    ["ssh://git@host.x/bad path", "ssh://host.x/bad path", "path", "bad path"],
    ["git@host.x:bad path", "ssh://host.x/bad path", "path", "bad path"],
    [`ssh://${USER}:${PASSWORD}@bad_host/o/r`, "ssh://bad_host/o/r", "host", "bad_host"],
  ]) {
    const e = await refused(() => parseRepoRef(ref));
    safeError(e, "E_REPO_REF");
    assert.equal(e.message, `repository reference has an invalid ${field}: ${shown} ${clause}`);
    assert.deepEqual(e.details, { ref: shown, [field]: value });
    assert.doesNotMatch(e.message, /give credentials|credential helper|http\(s\)/);
  }
  // An @ in a path is not authority userinfo, and the accepted grammar stays intact.
  const pathError = await refused(() => parseRepoRef("https://host.x/org/repo@bad"));
  assert.equal(pathError.message, "repository reference has an invalid path: https://host.x/org/repo@bad");
  assert.equal(parseRepoRef("https://host.x/org/repo").url, "https://host.x/org/repo.git");
});

test("the omission clause is absent without removed userinfo in the named refused reference", async () => {
  for (const ref of ["not-a-ref", "https://host", "ssh://host/bad path", "https://host:8443/repo@v1@x", "https://@host/o/r"]) {
    const e = await refused(() => parseRepoRef(ref));
    assert.equal(e.code, "E_REPO_REF");
    assert.ok(!e.message.includes(clause), ref);
  }
  for (const value of ["wat", "git:https://host:8443/org/repo.git@v1@x", "git:https://@host/o/r@v1", "git:@host:repo"]) {
    const e = await refused(() => parsePackageRequest("p", value, {}));
    assert.ok(!e.message.includes(clause), value);
  }
  assert.equal(redactUrl("@host:repo", null, { reference: true }), "ssh://host/repo");
  assert.equal(redactUrl("refused @host:repo", "@host:repo", { known: false, refusal: true }), "refused ssh://host/repo",
    "SCP display normalization without nonempty userinfo is not omission");
  for (const e of [
    await refused(() => parseRepoRef("git:example.invalid/org/repo", { transport: https[0] })),
    await refused(() => readRemoteFile(ssh, https[0], "x")),
  ]) { safeError(e, "E_REPO_REF"); assert.ok(!e.message.includes(clause), "unrelated fields do not annotate a refusal"); }
  for (const ref of [ssh, `ssh://${USER}@${host}/${path}`, `git@${host}:${path}`]) {
    assert.equal(parseRepoRef(ref).url, ref, "successful parsing keeps transport and adds no explanation");
  }
  // Rendering ordinary text may change it without annotating any refusal.
  assert.equal(redactUrl(`plain: ${https[0]}`, null, { refusal: true }), `plain: https://${host}/${path}`);
});

test("configured member refusals retain the clause through schema wrapping, while pattern-only local refusals stay unchanged", async () => {
  const dir = scratch();
  writeFileSync(join(dir, "oats-workspace.yaml"), JSON.stringify({ schemaVersion: 2, name: "fixture", members: https }));
  await runGit(["init", "-q", dir]);
  await runGit(["-C", dir, "add", "oats-workspace.yaml"]);
  await runGit(["-C", dir, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"]);
  const e = await refused(() => observeWorkspace(dir, { remoteOptions: { cacheDir: scratch() } }));
  safeError(e, "E_WORKSPACE_SCHEMA");
  assert.equal(e.details.path, "oats-workspace.yaml");
  assert.equal(e.message.split(clause).length - 1, 2, "once per originating refusal, not once per combined error");
  assert.deepEqual(e.details.problems, https.flatMap((_, i) => [
    { path: `/members/${i}`, message: `"https://${host}/${path}" does not match ^(?:git@[^@\\s]+|[^@\\s]+)$` },
  ]).concat(https.map((_, i) => ({ path: `/members/${i}`, message: `not a repo ref: ${httpUserinfoReason(`https://${host}/${path}`)} ${clause}` }))));
  assert.equal(e.provenance.problems, e.details.problems);
  const local = scratch();
  writeFileSync(join(local, "oats-local.yaml"), JSON.stringify({ schemaVersion: 2, workspace: https[0] }));
  const localError = await refused(() => loadLocal(local));
  safeError(localError, "E_WORKSPACE_SCHEMA");
  assert.ok(!localError.message.includes(clause));
  assert.deepEqual(localError.details.problems, [{ path: "/workspace", message: `"https://${host}/${path}" does not match ^(?:git@[^@\\s]+|[^@\\s]+)$` }]);
});

test("one renderer handles quoted URLs, SCP host display and credentials echoed outside URLs", () => {
  for (const ref of [...https, ssh, `ssh://${USER}@${host}/${path}`, `git@${host}:${path}`]) {
    const displayed = redactUrl(ref);
    noTokens(displayed);
    assert.equal(remoteFailureCause({ reason: "unknown", url: displayed }).host, host);
  }
  assert.equal(redactUrl(`git@${host}:${path}`), clean);
  for (const prefix of ["url=", "(git:", "fatal:", "[", "{", ",", ";"]) assert.equal(redactUrl(prefix + ssh), prefix + clean);
  assert.equal(redactUrl(`failure '${https[0]}' and '${ssh}'`), `failure 'https://${host}/${path}' and '${clean}'`);
  assert.equal(redactUrl(`failure '${https[0]},${ssh}'`), `failure 'https://${host}/${path},${clean}'`);
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
    assert.ok(!e.message.includes(clause), "transport failures do not explain a reference refusal");
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
  for (const ref of [...https, ...malformed]) { const invalid = await confirmMembership(workspaceObs, ref); noTokens(invalid); assert.equal(invalid.reason, "not-listed"); }
});

test("configured reference fields and package refusals redact without admitting new syntax or filtering unrelated values", async () => {
  for (const ref of [...https, ...malformed, ssh, `ssh://${USER}@${host}/${path}`]) {
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


test("refusal rendering preserves hosts, paths, fixed prose and schema patterns with short credentials", async () => {
  for (const [ref, clean] of [
    ["https://git@github.com/org/repo.git", "https://github.com/org/repo.git"],
    ["https://u:a@h.x/o/r", "https://h.x/o/r"],
    ["git@", ""],
  ]) {
    const e = await refused(() => parseRepoRef(ref));
    const reason = clean ? httpUserinfoReason(clean) : `unrecognized repository reference: ${clean}`;
    assert.equal(e.message, `${reason} ${clause}`);
    assert.equal(e.details.ref, clean);
    const before = validateWorkspace({ schemaVersion: 2, name: "fixture", members: [ref] });
    assert.deepEqual(before, [
      { path: "/members/0", message: `${JSON.stringify(clean)} does not match ^(?:git@[^@\\s]+|[^@\\s]+)$` },
      { path: "/members/0", message: `not a repo ref: ${reason} ${clause}` },
    ]);
    if (!clean) continue; // The userinfo-only reference has no repository to retain in a package.
    const pkg = await refused(() => parsePackageRequest("p", `git:${ref}@v1`, {}));
    assert.equal(pkg.details.value, `git:${clean}@v1`);
    assert.match(pkg.message, /^packages.p: a git package carries exactly one @<ref>/);
  }
});

test("parser fragments remove only userinfo overlap, preserving equal text in a refused path", async () => {
  const e = await refused(() => parseRepoRef("ssh://u:a@h.x/a bad/path"));
  assert.equal(e.details.path, "a bad/path");
  assert.equal(e.details.ref, "ssh://h.x/a bad/path");
  const split = await refused(() => parseRepoRef(`https://${USER}:${PASSWORD}/extra@h.x/o/r`));
  safeError(split, "E_REPO_REF");
});

test("quoted URL boundaries preserve unrelated Git words and path at-signs", () => {
  for (const text of [
    "fatal: 'ssh://host' does not appear to be a git repository; mail admin@corp.com",
    "… see https://host.x:8443/a@b",
  ]) assert.equal(redactUrl(text), text);
  assert.equal(scrubGitLine("fatal: git rejected https://git@github.com/org/repo.git", "https://git@github.com/org/repo.git"),
    "fatal: rejected https://github.com/org/repo.git");
  assert.equal(scrubGitLine("u a https://h.x/a/u", "https://u:a@h.x/a/u"), "https://h.x/a/u");
});


test("refused package suffixes retain the repository host, port and path", async () => {
  for (const value of ["git:https://host:8443/org/repo.git@v1@x", "git:ssh://host:2222/org/repo.git@v1@x", "git:https://host:8443/repo.git@v1@x"]) {
    const e = await refused(() => parsePackageRequest("p", value, {}));
    assert.equal(e.details.value, value);
    assert.ok(e.message.endsWith(`got ${JSON.stringify(value)}`));
  }
});

test("large remote declaration diagnostics finish without pathological backtracking", (t) => {
  // A subprocess timeout makes a quadratic regression fail promptly instead of stalling
  // this test runner. The generous bounds cover shared-host load, not a microbenchmark.
  const probe = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { performance } from "node:perf_hooks";
    import { redactUrl } from ${JSON.stringify(new URL("../lib/remote.mjs", import.meta.url).href)};
    import { readDeclaration } from ${JSON.stringify(new URL("../lib/workspace.mjs", import.meta.url).href)};
    const timings = [];
    for (const size of [32768, 65536, 1048576]) {
      for (const kind of ["prose", "scheme-candidates", "reference", "membership", "credential-membership"]) {
        const valueSize = kind.endsWith("membership") ? Math.min(size, 1047000) : size;
        const value = kind === "reference" ? ":".repeat(size) + " " : kind === "scheme-candidates" ? "a-".repeat(size / 2) : "-".repeat(valueSize) + " x";
        const start = performance.now();
        let output;
        if (kind.endsWith("membership")) {
          const workspace = kind === "credential-membership" ? "https://" + "-".repeat(valueSize) + "@host/org/repo" : value;
          output = readDeclaration("membership", Buffer.from(JSON.stringify({schemaVersion:2, workspace})), {path:"oats-membership.yaml"});
          if (output.value?.workspace !== workspace || !output.problems?.some(p => p.path === "/workspace")) throw Error("expected decoded membership reference refusal, not a byte-budget or syntax failure");
          if (kind === "credential-membership" && JSON.stringify(output.problems).includes("-".repeat(100))) throw Error("credential leaked");
        } else output = redactUrl(value, null, {reference:kind === "reference"});
        timings.push({kind, size, ms:performance.now() - start});
      }
    }
    console.log(JSON.stringify(timings));
  `], { encoding: "utf8", timeout: 10000 });
  assert.equal(probe.error, undefined, `large-input probe timed out: ${probe.error}`);
  assert.equal(probe.status, 0, probe.stderr);
  const timings = JSON.parse(probe.stdout);
  for (const row of timings) assert.ok(row.ms < 2000, `${row.kind} (${row.size} bytes) took ${row.ms} ms`);
  t.diagnostic(JSON.stringify(timings));
});


// This is an explicit audit of raw error-text access, rather than a check that a scrubber
// merely exists. Any added access requires review; the output routes also pin their source
// URL and reject interpolating the unrendered local text into fail(). Mutation probes below
// demonstrate that adding a quoting site or bypassing a scrubber actually fails the guard.
function assertGitQuoting(source) {
  const declarations = [...source.matchAll(/^(?:export )?(?:(?:async )?function|const) (\w+)/gm)];
  const sites = {};
  for (const match of source.matchAll(/\bstderrText\s*\(|\b\w+(?:\?\.|\.)(?:message|stderr)\b|\$\{\s*(?:e|err|error)\s*\}|\bString\s*\(\s*(?:e|err|error)\s*\)/g)) {
    if (source.slice(match.index - 9, match.index) === "function ") continue;
    const owner = declarations.findLast((d) => d.index <= match.index)?.[1];
    (sites[owner] ??= []).push(match[0]);
  }
  assert.deepEqual(sites, {
    fail: ["safe.message"], runGit: ["child.stderr", "child.stderr"],
    stderrText: ["error?.stderr", "error?.message"], classifyText: ["stderrText("],
    gitLastLine: ["stderrText("], lockFileOf: ["stderrText("], isLocalWriteFailure: ["stderrText("],
    cacheFailure: ["stderrText(", "error?.message"], isLockRace: ["stderrText("],
    // Filesystem failures on the owned cache lock, not Git's error/transport text.
    withCacheWriteLock: ["error.message", "error.message", "error.message"],
    isRefusedWant: ["stderrText("], lsTree: ["stderrText("],
    listingUnreadable: ["stderrText(", "error?.message"], openBatch: ["child.stderr", "child.stderr"],
  }, "new raw error-text access must be classified and its diagnostic route guarded");
  const body = (name) => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0] ?? "";
  assert.match(body("gitLastLine"), /map\(\(line\) => scrubGitLine\(line, url\)\)/);
  assert.match(body("unreadable"), /gitLastLine\(error, ref\.url\)/);
  assert.match(body("cacheFailure"), /const why = redactUrl\(stderrText\(error\)[^\n]+, ref\.url\);/);
  assert.match(body("listingUnreadable"), /scrubGitLine\(text\.trim\(\)\.split\("\\n"\)\[0\], ref\?\.url\)/);
  assert.match(body("listingUnreadable"), /scrubGitLine\(error\?\.message, ref\?\.url\)/);
  for (const name of ["classifyText", "gitLastLine", "lockFileOf", "cacheFailure", "lsTree", "listingUnreadable"]) {
    for (const line of body(name).split("\n").filter((line) => /\bfail\(/.test(line))) {
      assert.doesNotMatch(line, /\b(?:text|lines|stderrText|stderr)\b|error\??\.message/, "raw Git text cannot be quoted directly by fail");
    }
  }
}

test("every Git error-text quoting route is guarded, including newly introduced sites", () => {
  const source = readFileSync(new URL("../lib/remote.mjs", import.meta.url), "utf8");
  assertGitQuoting(source);
  for (const mutation of [
    source + '\nfunction newQuote(error) { return fail("E_REMOTE_UNREADABLE", stderrText(error)); }',
    source + '\nfunction newQuote(error) { return fail("E_REMOTE_UNREADABLE", error.message); }',
    ...["e", "err", "error"].flatMap((name) => [
      source + '\nfunction newQuote(' + name + ') { return fail("E_REMOTE_UNREADABLE", `raw: ${' + name + '}`); }',
      source + '\nfunction newQuote(' + name + ') { return fail("E_REMOTE_UNREADABLE", String(' + name + ')); }',
    ]),
    source.replace("scrubGitLine(line, url)", "String(line)"),
    source.replace("const why = redactUrl(stderrText(error)", "const why = String(stderrText(error)"),
    source.replace('scrubGitLine(text.trim().split("\\n")[0], ref?.url)', 'text.trim().split("\\n")[0]'),
    source.replace('scrubGitLine(error?.message, ref?.url)', 'String(error?.message)'),
    source.replace('  const missingObject =', '  fail("E_REMOTE_UNREADABLE", `raw git: ${text}`);\n  const missingObject ='),
  ]) {
    assert.notEqual(mutation, source, "mutation must exercise the guard");
    assert.throws(() => assertGitQuoting(mutation), assert.AssertionError);
  }
});

test("all Git quoting helpers remove known secrets outside URLs in stderr and message fallbacks", () => {
  const source = readFileSync(new URL("../lib/remote.mjs", import.meta.url), "utf8");
  const definitions = ["fail", "stderrText", "gitLastLine", "unreadable", "cacheFailure", "listingUnreadable"]
    .map((name) => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0]).join("\n");
  const helpers = new Function("oatsError", "redactUrl", "scrubGitLine", "classifyRemoteFailure", "keychainHint", "isLockRace", "isLocalWriteFailure", "markCacheDamaged", "KEYCHAIN_REMEDY",
    `${definitions}; return [unreadable, cacheFailure, (ref, error) => listingUnreadable(error, {ref,repo:{dir:"fixture"},spec:"HEAD"})];`)(
    oatsError, redactUrl, scrubGitLine, () => "unknown", () => null, () => false, () => false, () => {}, "");
  for (const fn of helpers) for (const error of [gitError(`unexpected ${ssh}; ${PASSWORD}`), new Error(`unexpected ${ssh}; ${PASSWORD}`)]) {
    safeError(fn({ url: ssh, key }, error), "E_REMOTE_UNREADABLE");
  }
});


test("no-path slash-in-password refusal removes userinfo from every error field", async () => {
  const e = await refused(() => parseRepoRef("https://TOKSECRET:P/extra@h.x"));
  assert.equal(e.code, "E_REPO_REF");
  assert.equal(e.message, `repository reference has an invalid host: https://h.x ${clause}`);
  assert.deepEqual(e.details, { ref: "https://h.x", host: "" });
  assert.equal(e.provenance, e.details);
});
