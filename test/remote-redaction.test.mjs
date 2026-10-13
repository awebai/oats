/** Remote refusal rendering: synthetic credentials only, no network or shared cache. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { oatsError } from "../lib/errors.mjs";
import { redactUrl, scrubGitLine, parseRepoRef, classifyRemoteFailure, observeRemote, readRemoteFile, listRemoteTree, listRemoteFiles, contentDigest, fetchRemoteTree, runGit } from "../lib/remote.mjs";
import { confirmMembership, observeWorkspace, validateWorkspace, validateLocal, validateMembership, readDeclaration, loadLocal } from "../lib/workspace.mjs";
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
const WITHHELD = "[repository reference withheld]";
const withheldClause = "(the repository reference was withheld)";
const VALUE_WITHHELD = "[value withheld]";
const valueWithheldClause = "(the value was withheld)";
const GIT_WITHHELD = "Git's diagnostic was withheld; run the same Git operation by hand to see Git's own words.";
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
  const definition = source.match(/function fail\(code, message, details, \{ rejected = \[\] \} = \{\}\) \{[\s\S]*?\n\}/)?.[0];
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
  assert.equal(parseRepoRef(ssh).url, ssh);
  assert.equal(parseRepoRef(`ssh://${USER}@${host}/${path}`).url, `ssh://${USER}@${host}/${path}`);
});

test("plain refused references retain exact selected spelling and original-source fragments", async () => {
  const cases = [
    ["notaref", "unrecognized repository reference: notaref", undefined],
    ["https://github.com/org", "repository reference has an invalid path: https://github.com/org", "org"],
    ["htps://github.com/org/repo", "unrecognized repository reference: htps://github.com/org/repo", undefined],
    ["github.com:org/repo", "unrecognized repository reference: github.com:org/repo", undefined],
  ];
  for (const [input, reason, derived] of cases) {
    const e = await refused(() => parseRepoRef(input));
    assert.equal(e.code, "E_REPO_REF");
    assert.equal(e.message, reason);
    assert.deepEqual(e.details, derived === undefined ? { ref: input } : { ref: input, path: derived });
    assert.equal(e.details, e.provenance);
    const workspace = { schemaVersion: 2, name: "fixture", members: [input] };
    assert.ok(validateWorkspace(workspace).some(p => p.path === "/members/0" && p.message === `not a repo ref: ${reason}`));
    const remote = {
      parseRepoRef,
      async observeRemote(ref) { return { ...parseRepoRef(ref), commit: "a".repeat(40) }; },
      async listRemoteTree() { assert.fail("no member trees are read on a refused workspace"); },
      async readRemoteFile() { return { bytes: Buffer.from(JSON.stringify(workspace)) }; },
    };
    const wrapped = await refused(() => observeWorkspace("git:github.com/org/workspace", { remote }));
    assert.equal(wrapped.code, "E_WORKSPACE_SCHEMA");
    assert.equal(wrapped.details.path, "oats-workspace.yaml");
    assert.ok(wrapped.details.problems.some(p => p.path === "/members/0" && p.message === `not a repo ref: ${reason}`));
    assert.ok(wrapped.message.includes(reason));
    assert.equal(wrapped.details, wrapped.provenance);
  }
  for (const input of ["a".repeat(256), " ", " : ", "  notaref  ", "AZaz09 ._/+:-", "https://h/o/r mixed text"]) {
    assert.equal(redactUrl(input, null, { reference: true }), input, JSON.stringify(input));
    assert.equal(redactUrl(`value ${JSON.stringify(input)}`, input, { known: false, refusal: true }), `value ${JSON.stringify(input)}`);
  }
  for (const input of ["", "a".repeat(257), "notaref?query", "notaref@host", "notaref\n", "café", "a\u0000b"]) {
    assert.equal(redactUrl(input, null, { reference: true }), WITHHELD, JSON.stringify(input));
  }
  assert.equal(redactUrl("org", "https://github.com/org", { fragment: true, known: false }), "org");
  for (const ref of [`https://${USER}:${PASSWORD}/org@github.com/repo`, `ssh://${USER}:${PASSWORD}@github.com/org`]) {
    const e = await refused(() => parseRepoRef(ref));
    safeError(e, "E_REPO_REF");
    assert.equal(e.details.ref, WITHHELD);
    for (const name of ["host", "path"]) if (name in e.details) assert.equal(e.details[name], WITHHELD);
    assert.equal(redactUrl(PASSWORD, ref, { fragment: true, known: false }), WITHHELD, "a plain fragment cannot override its credentialed original source");
  }
  assert.equal(redactUrl("org/repo", https[0], { fragment: true, known: false }), WITHHELD, "only the validated exact path may survive a nonplain source");
  assert.equal(redactUrl(path, https[0], { fragment: true, known: false }), path);
  for (const source of ["notaref", "https://github.com/org", "htps://github.com/org/repo", "github.com:org/repo"]) {
    assert.equal(scrubGitLine("plain Git line", source), GIT_WITHHELD, "plain fallback cannot establish safe Git operation provenance");
  }
});

test("rejected transport preserves safe words and successful transport stays exact", async () => {
  for (const [value, display, withheld] of [
    ...https.map(value => [value, VALUE_WITHHELD, true]),
    ...["ftp", "transport", "must", "abc123", "v1..2"].map(value => [value, value, false]),
    [{ https: [https[0]], ssh: https[1] }, { https: [VALUE_WITHHELD], ssh: VALUE_WITHHELD }, true],
    [42, 42, false], [false, false, false],
  ]) {
    const e = await refused(() => parseRepoRef("git:example.invalid/org/repo", { transport: value }));
    safeError(e, "E_REPO_REF");
    assert.deepEqual(e.details, { transport: display });
    assert.deepEqual(e.provenance, e.details);
    assert.equal(e.message, `remoteOptions.transport must be "https" or "ssh", got ${JSON.stringify(display)}${withheld ? ` ${valueWithheldClause}` : ""}`);
    assert.ok(!e.message.includes(clause) && !e.message.includes(withheldClause), "rejected options do not claim reference omission");
  }
  assert.equal(parseRepoRef("git:example.invalid/org/repo", { transport: "https" }).url, "https://example.invalid/org/repo.git");
  assert.equal(parseRepoRef("git:example.invalid/org/repo", { transport: "ssh" }).url, "git@example.invalid:org/repo.git");
});

test("rejected commit preserves safe words and valid OIDs on other errors stay exact", async () => {
  for (const [value, display, withheld] of [
    ...https.map(value => [value, VALUE_WITHHELD, true]),
    ...["invalid-oid", "commit", "must", "OID", "abc123", "v1..2"].map(value => [value, value, false]),
  ]) {
    const e = await refused(() => readRemoteFile(ssh, value, "x"));
    safeError(e, "E_REPO_REF");
    assert.deepEqual(e.details, { commit: display });
    assert.deepEqual(e.provenance, e.details);
    assert.equal(e.message, `commit must be a full 40-hex OID${withheld ? ` ${valueWithheldClause}` : ""}`);
  }
  const commit = "1".repeat(40);
  const e = await refused(() => readRemoteFile(ssh, commit, "x", { cacheDir: scratch(), exec: async (args, opts) => {
    if (args.includes("fetch")) throw gitError("fixture error", { timedOut: true });
    return runGit(args, opts);
  } }));
  assert.equal(e.code, "E_REMOTE_UNREADABLE");
  assert.equal(e.details.commit, commit);
});

test("other rejected inputs use value display without changing accepted data", async () => {
  const commit = "1".repeat(40), input = https[0];
  const cases = [
    ["at", VALUE_WITHHELD, () => observeRemote(ssh, { at: input })],
    ["at", { nested: VALUE_WITHHELD }, () => observeRemote(ssh, { at: { nested: input } })],
    ["path", { nested: VALUE_WITHHELD }, () => readRemoteFile(ssh, commit, { nested: input })],
    ["path", VALUE_WITHHELD, () => readRemoteFile(ssh, commit, `${input}/../x`)],
    ["depth", VALUE_WITHHELD, () => listRemoteTree(ssh, commit, "", { depth: input })],
    ["limit", VALUE_WITHHELD, () => listRemoteFiles(ssh, commit, "", { limit: input })],
    ["path", VALUE_WITHHELD, () => contentDigest(input)],
    ["destDir", VALUE_WITHHELD, () => fetchRemoteTree(ssh, commit, "", input)],
  ];
  for (const [field, display, call] of cases) {
    const e = await refused(call);
    safeError(e, "E_REPO_REF");
    assert.deepEqual(e.details, { [field]: display });
    assert.deepEqual(e.provenance, e.details);
    assert.equal(e.message.split(valueWithheldClause).length - 1, 1);
    assert.ok(!e.message.includes(clause) && !e.message.includes(withheldClause));
  }
  for (const [field, value, call] of [
    ["at", "v1..2", () => observeRemote(ssh, { at: "v1..2" })],
    ["path", "../escape", () => readRemoteFile(ssh, commit, "../escape")],
    ["depth", "2", () => listRemoteTree(ssh, commit, "", { depth: "2" })],
    ["limit", -1, () => listRemoteFiles(ssh, commit, "", { limit: -1 })],
    ["destDir", "relative/path", () => fetchRemoteTree(ssh, commit, "", "relative/path")],
  ]) {
    const e = await refused(call);
    assert.equal(e.code, "E_REPO_REF");
    assert.deepEqual(e.details, { [field]: value });
    assert.ok(!e.message.includes(valueWithheldClause) && !e.message.includes(clause) && !e.message.includes(withheldClause));
  }
  const raw = { nested: input };
  await refused(() => observeRemote(ssh, { at: raw }));
  assert.equal(raw.nested, input, "refusing diagnostics never mutate caller input");
});

test("rejected-value display accepts only the complete bounded ASCII spelling", async () => {
  const allowed = ["a", "0", ".", "_", "/", "+", "-", "ftp", "abc123", "v1..2", "AZaz09 ._/+:-", " ", ":", " a", "a ", "a b", "https://host/org", "a".repeat(256)];
  const forbidden = ["", "a".repeat(257), "café", "漢字", "😀", "a\u0301", "a\u0085b", "a\u00a0b", "a\u200bb", "a\u2028b", "a\u2029b", "a\ufeffb",
    ...Array.from({ length: 32 }, (_, i) => `a${String.fromCharCode(i)}b`),
    `a${String.fromCharCode(127)}b`, `a${String.fromCharCode(128)}b`,
    ...["@", "'", '"', "%", "?", "#", "=", ",", ";", "\\", "[", "]", "{", "}", "(", ")", "<", ">", "!", "$", "&", "*", "|", "~", "^", "`"].map(character => `a${character}b`),
    ...https];
  for (const [values, expectedWithheld] of [[allowed, false], [forbidden, true]]) for (const value of values) {
    const display = expectedWithheld ? VALUE_WITHHELD : value;
    assert.equal(redactUrl(value, null, { rejectedValue: true, reference: true }), display, JSON.stringify(value));
    const e = await refused(() => parseRepoRef("git:example.invalid/org/repo", { transport: value }));
    assert.equal(e.code, "E_REPO_REF");
    assert.deepEqual(e.details, { transport: display });
    assert.equal(e.details, e.provenance);
    assert.equal(e.message, `remoteOptions.transport must be "https" or "ssh", got ${JSON.stringify(display)}${expectedWithheld ? ` ${valueWithheldClause}` : ""}`);
  }
  // The explicit context leaves non-string data and valid operational values alone.
  for (const value of [null, undefined, true, false, 0, -1, 1.5]) {
    assert.equal(redactUrl(value, null, { rejectedValue: true, reference: true }), value);
  }
  const original = { keep: ["abc123", https[0], 4, null], [https[1]]: { nested: "ftp" } };
  const expected = { keep: ["abc123", VALUE_WITHHELD, 4, null], [VALUE_WITHHELD]: { nested: "ftp" } };
  assert.deepEqual(redactUrl(original, null, { rejectedValue: true, reference: true }), expected);
  assert.equal(original.keep[1], https[0]);
  assert.ok(Object.hasOwn(original, https[1]));
  const collision = { [https[0]]: "first", [https[1]]: "second", [VALUE_WITHHELD]: "third" };
  assert.deepEqual(redactUrl(collision, null, { rejectedValue: true, reference: true }), { [VALUE_WITHHELD]: "third" },
    "distinct withheld keys deliberately share the fixed display key");
  const message = "transport must be a supported value";
  const explained = `${message} ${valueWithheldClause}`;
  assert.equal(redactUrl(message, original, { rejectedValue: true, known: false, refusal: true, substitute: false }), explained);
  assert.equal(redactUrl(explained, original, { rejectedValue: true, known: false, refusal: true, substitute: false }), explained);
  assert.equal(redactUrl(message, ["ftp", "abc123"], { rejectedValue: true, known: false, refusal: true, substitute: false }), message);
  assert.equal(redactUrl(https[0], null, { reference: true }), `https://${host}/${path}`, "reference display is a separate explicit context");
  assert.equal(parseRepoRef(ssh).url, ssh, "accepted transport still contains its exact user information");
});

test("refusals explain omission or withholding once, without changing diagnostic field shapes", async () => {
  const refs = [...https, `https://:${PASSWORD}@${host}/${path}`,
    `ssh://${USER}:${PASSWORD}@bad_host/${path}`, `ssh://${USER}:${PASSWORD}@${host}/bad path`, ...malformed];
  for (const ref of refs) {
    const e = await refused(() => parseRepoRef(ref));
    safeError(e, "E_REPO_REF");
    const explanation = malformed.includes(ref) || ref.includes("bad_host") || ref.includes("bad path") ? withheldClause : clause;
    assert.ok(e.message.endsWith(explanation), ref);
    assert.equal(e.message.split(explanation).length - 1, 1);
    assert.equal(e.details.ref, redactUrl(ref, null, { reference: true }));
    assert.ok(!JSON.stringify(e.details).includes(clause), "only the message carries the explanation");
    const value = `git:${ref}@v1`;
    const pkg = await refused(() => parsePackageRequest("p", value, {}));
    safeError(pkg, "E_REPO_REF");
    assert.ok(pkg.message.endsWith(withheldClause), value);
    assert.doesNotMatch(pkg.message, /give credentials|credential helper/, "package refusal keeps its own cause, without HTTP parser advice");
    assert.equal(pkg.message.split(withheldClause).length - 1, 1);
    assert.deepEqual(pkg.details, { id: "p", value: WITHHELD,
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
    const explanation = clause; // Plain object keys remain visible; these nested references only omit userinfo.
    if (ref.bad) assert.ok(Object.hasOwn(e.details.ref, "bad"));
    assert.equal(e.message.split(explanation).length - 1, 1);
    assert.ok(!JSON.stringify(e.details).includes(clause));
    assert.ok(!JSON.stringify(e.details).includes(withheldClause));
    assert.equal(redactUrl(`forwarded: ${e.message}`, [https[0], ssh], { known: false, refusal: true }), `forwarded: ${e.message}`);
  }
  const workspaceObs = { key: "example.invalid/org/workspace", commit: "1".repeat(40),
    workspace: { schemaVersion: 2, name: "fixture", members: ["git:example.invalid/org/repo"] } };
  const row = await confirmMembership(workspaceObs, https[0]);
  noTokens(row);
  assert.equal(row.detail.split(clause).length - 1, 1, "membership forwards the refusal once");
});

test("HTTP userinfo refusals name their cause and remedy, while malformed SSH refusals explain withholding", async () => {
  for (const scheme of ["http", "https"]) for (const info of [USER, `${USER}:${PASSWORD}`, `:${PASSWORD}`]) {
    const ref = `${scheme}://${info}@${host}/${path}`;
    const e = await refused(() => parseRepoRef(ref));
    safeError(e, "E_REPO_REF");
    const shown = `${scheme}://${host}/${path}`;
    assert.equal(e.message, `${httpUserinfoReason(shown)} ${clause}`);
    assert.deepEqual(e.details, { ref: shown });
  }
  for (const [ref, shown, field, value] of [
    ["git@my_host:org/repo", WITHHELD, "host", WITHHELD],
    ["ssh://git@host.x/bad path", WITHHELD, "path", WITHHELD],
    ["git@host.x:bad path", WITHHELD, "path", WITHHELD],
    [`ssh://${USER}:${PASSWORD}@bad_host/o/r`, WITHHELD, "host", WITHHELD],
  ]) {
    const e = await refused(() => parseRepoRef(ref));
    safeError(e, "E_REPO_REF");
    assert.equal(e.message, `repository reference has an invalid ${field}: ${shown} ${withheldClause}`);
    assert.deepEqual(e.details, { ref: shown, [field]: value });
    assert.doesNotMatch(e.message, /give credentials|credential helper|http\(s\)/);
  }
  // An @ in a path is not authority userinfo, and the accepted grammar stays intact.
  const pathError = await refused(() => parseRepoRef("https://host.x/org/repo@bad"));
  assert.equal(pathError.message, `repository reference has an invalid path: ${WITHHELD} ${withheldClause}`);
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
  assert.equal(redactUrl("@host:repo", null, { reference: true }), WITHHELD);
  assert.equal(redactUrl("refused @host:repo", "@host:repo", { known: false, refusal: true }), `refused ${WITHHELD} ${withheldClause}`,
    "an unrecognised SCP value is withheld without claiming userinfo omission");
  for (const ref of [ssh, `ssh://${USER}@${host}/${path}`, `git@${host}:${path}`]) {
    assert.equal(parseRepoRef(ref).url, ref, "successful parsing keeps transport and adds no explanation");
  }
  // Rendering ordinary text may change it without annotating any refusal.
  assert.equal(redactUrl(`plain: ${https[0]}`, null, { refusal: true }), GIT_WITHHELD);
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

test("one renderer separates selected reference display from whole Git-line withholding", () => {
  for (const ref of [...https, ssh, `ssh://${USER}@${host}/${path}`, `git@${host}:${path}`]) {
    const displayed = redactUrl(ref, null, { reference: true });
    noTokens(displayed);
    assert.equal(remoteFailureCause({ reason: "unknown", url: displayed }).host, host);
  }
  assert.equal(redactUrl(`git@${host}:${path}`, null, { reference: true }), clean);
  for (const prefix of ["url=", "(git:", "fatal:", "[", "{", ",", ";"]) assert.equal(redactUrl(prefix + ssh), GIT_WITHHELD, "a line without a known operation reference is withheld whole");
  assert.equal(redactUrl(`failure '${https[0]}' and '${ssh}'`), GIT_WITHHELD);
  assert.equal(redactUrl(`failure '${https[0]},${ssh}'`), GIT_WITHHELD);
  noTokens(scrubGitLine(`fatal: '${ssh}': ${PASSWORD}`, ssh));
  noTokens(scrubGitLine(`fatal: ${USER} and ${PASSWORD}`, https[1]));
  assert.equal(scrubGitLine("secret%5Fvalue and secret_value", "ssh://bot:secret%5Fvalue@example.invalid/org/repo"), GIT_WITHHELD);
  assert.equal(redactUrl("normal host/path and opaque text"), GIT_WITHHELD);
  // A credential equal to a classification word cannot change the contract's reason value.
  assert.equal(redactUrl({ url: "https://unknown@example.invalid/org/repo", reason: "unknown" }, null, { known: false }).reason, "unknown");
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
    if (kind === "cache") { assert.match(e.message, /cannot write the cache/); assert.ok(e.message.includes(GIT_WITHHELD)); }
    if (kind === "unknown") assert.ok(e.message.includes(GIT_WITHHELD), "unknown classification retains safe kernel reason and withholds Git words");
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
    ["git@", WITHHELD],
  ]) {
    const e = await refused(() => parseRepoRef(ref));
    const reason = clean === WITHHELD ? `unrecognized repository reference: ${clean}` : httpUserinfoReason(clean);
    const explanation = clean === WITHHELD ? withheldClause : clause;
    assert.equal(e.message, `${reason} ${explanation}`);
    assert.equal(e.details.ref, clean);
    const before = validateWorkspace({ schemaVersion: 2, name: "fixture", members: [ref] });
    assert.deepEqual(before, [
      { path: "/members/0", message: `${JSON.stringify(clean)} does not match ^(?:git@[^@\\s]+|[^@\\s]+)$` },
      { path: "/members/0", message: `not a repo ref: ${reason} ${explanation}` },
    ]);
    if (clean === WITHHELD) continue; // This malformed value has no display components.
    const pkg = await refused(() => parsePackageRequest("p", `git:${ref}@v1`, {}));
    assert.equal(pkg.details.value, WITHHELD);
    assert.match(pkg.message, /^packages.p: a git package carries exactly one @<ref>/);
  }
});

test("parser fragments follow the whole-source withholding decision", async () => {
  const e = await refused(() => parseRepoRef("ssh://u:a@h.x/a bad/path"));
  assert.equal(e.details.path, WITHHELD);
  assert.equal(e.details.ref, WITHHELD);
  const split = await refused(() => parseRepoRef(`https://${USER}:${PASSWORD}/extra@h.x/o/r`));
  safeError(split, "E_REPO_REF");
});

test("unknown operation context and rebuilt references withhold the whole Git line", () => {
  for (const text of [
    "fatal: 'ssh://host' does not appear to be a git repository; mail admin@corp.com",
    "… see https://host.x:8443/a@b",
  ]) assert.equal(redactUrl(text), GIT_WITHHELD);
  assert.equal(scrubGitLine("fatal: git rejected https://git@github.com/org/repo.git", "https://git@github.com/org/repo.git"),
    GIT_WITHHELD);
  assert.equal(scrubGitLine("u a https://h.x/a/u", "https://u:a@h.x/a/u"), GIT_WITHHELD);
});


test("refused package suffixes withhold the whole selected value", async () => {
  for (const value of ["git:https://host:8443/org/repo.git@v1@x", "git:ssh://host:2222/org/repo.git@v1@x", "git:https://host:8443/repo.git@v1@x"]) {
    const e = await refused(() => parsePackageRequest("p", value, {}));
    assert.equal(e.details.value, WITHHELD);
    assert.ok(e.message.endsWith(`got ${JSON.stringify(WITHHELD)} ${withheldClause}`));
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
      for (const kind of ["prose", "scheme-candidates", "scp-candidates", "adjacent-schemes", "reference", "membership", "credential-membership"]) {
        const valueSize = kind.endsWith("membership") ? Math.min(size, 1047000) : size;
        const value = kind === "reference" ? ":".repeat(size) + " " : kind === "scheme-candidates" ? "a-".repeat(size / 2) : kind === "scp-candidates" ? String.fromCharCode(92).repeat(size) : kind === "adjacent-schemes" ? "a://".repeat(Math.min(size, 262144) / 4) : "-".repeat(valueSize) + " x";
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
    fail: ["safe.message", "safe.message"], runGit: ["child.stderr", "child.stderr"],
    stderrText: ["error?.stderr", "error?.message"], classifyText: ["stderrText("],
    gitLastLine: ["error?.stderr"], lockFileOf: ["stderrText("], isLocalWriteFailure: ["stderrText("],
    cacheFailure: ["stderrText(", "error?.message"], isLockRace: ["stderrText("],
    // Filesystem failures on the owned cache lock, not Git's error/transport text.
    withCacheWriteLock: ["error.message", "error.message", "error.message"],
    isRefusedWant: ["stderrText("], lsTree: ["stderrText("],
    listingUnreadable: ["stderrText(", "error?.message"], openBatch: ["child.stderr", "child.stderr"],
  }, "new raw error-text access must be classified and its diagnostic route guarded");
  const body = (name) => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0] ?? "";
  assert.match(body("gitLastLine"), /map\(\(line\) => scrubGitLine\(line, url\)\)/);
  assert.match(body("gitLastLine"), /const stderr = error\?\.stderr;/);
  assert.match(body("gitLastLine"), /const text = Buffer\.isBuffer\(stderr\) \? stderr\.toString\("utf8"\) : typeof stderr === "string" \? stderr : "";/);
  assert.match(body("gitLastLine"), /const lines = text\.split\(/);
  assert.match(body("unreadable"), /gitLastLine\(error, ref\.url\)/);
  assert.match(body("cacheFailure"), /const why = scrubGitLine\(stderrText\(error\) \|\| error\?\.message \|\| error\?\.code \|\| "git failed", ref\.url\);/);
  assert.match(body("listingUnreadable"), /scrubGitLine\(text\.split\("\\n"\)\[0\], ref\?\.url\)/);
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
    source.replace("const stderr = error?.stderr;", "const stderr = error?.message;"),
    source.replace("const why = scrubGitLine(stderrText(error)", "const why = String(stderrText(error)"),
    source.replace('scrubGitLine(text.split("\\n")[0], ref?.url)', 'text.trim().split("\\n")[0]'),
    source.replace('scrubGitLine(error?.message, ref?.url)', 'String(error?.message)'),
    source.replace('  const missingObject =', '  fail("E_REMOTE_UNREADABLE", `raw git: ${text}`);\n  const missingObject ='),
  ]) {
    assert.notEqual(mutation, source, "mutation must exercise the guard");
    assert.throws(() => assertGitQuoting(mutation), assert.AssertionError);
  }
});

test("Git-line display requires unchanged operation references and an original line without at-signs", () => {
  const operation = "https://example.invalid/org/repo.git";
  // These are Git's words, not URLs selected from within a sentence. Colons inside
  // ordinary words must not suppress a safe line for an unchanged operation.
  for (const line of ["fatal: ssh: unsupported setting", "git: command failed", "profile: missing", "digit: invalid",
    "fatal: no repository found at https://example.invalid/org/repo.git", "ordinary words without a reference"]) {
    assert.equal(redactUrl(line, operation), line);
    assert.equal(scrubGitLine(line, operation), line);
    assert.equal(redactUrl(line), GIT_WITHHELD, "missing source is conservative even when the line looks harmless");
    assert.equal(scrubGitLine(line), GIT_WITHHELD);
  }
  assert.equal(redactUrl("fatal: no repository", [operation, operation]), "fatal: no repository");
  assert.equal(redactUrl("fatal: no repository", []), "fatal: no repository", "an explicit empty operation source list proves that no reference was used");
  for (const source of [[operation, null], [operation, undefined], { url: operation }, [operation, { url: operation }]]) {
    assert.equal(redactUrl("fatal: no repository", source), GIT_WITHHELD, "partial or unproven source context is not sufficient");
  }
  assert.equal(redactUrl("fatal: no repository", [operation, ssh]), GIT_WITHHELD, "every supplied source must be unchanged");
  for (const source of [ssh, ...https, ...malformed, "not-a-reference", `git@${host}:${path}`]) {
    for (const line of [`fatal: echoed ${USER} and ${PASSWORD}`, "fatal: no repository"]) {
      assert.equal(redactUrl(line, source), GIT_WITHHELD);
      assert.equal(scrubGitLine(line, source), GIT_WITHHELD);
    }
  }
  for (const line of [`fatal: '${operation}' user@example.invalid`, `fatal: hidden@${PASSWORD}`, "mail operator@example.invalid"]) {
    assert.equal(redactUrl(line, operation), GIT_WITHHELD, "inspect the original entire line for @ before any formatting");
    assert.equal(scrubGitLine(line, operation), GIT_WITHHELD);
  }
  assert.equal(scrubGitLine(`${"x".repeat(500)}@late`, operation), GIT_WITHHELD, "the original line is inspected before truncation");
  assert.equal(scrubGitLine("fatal: screen control \x1b[@", operation), GIT_WITHHELD, "control-sequence removal cannot erase the original at-sign");
  assert.equal(scrubGitLine(""), "");
  assert.equal(scrubGitLine(" \r\n\t", ssh), "", "an absent line does not invent Git text");
  for (const local of ["file:///owned/path@name/repo", "/owned/path@name/repo"]) {
    assert.equal(redactUrl(local, null, { reference: true }), local, "selected local values keep their path meaning");
    assert.equal(redactUrl(local), GIT_WITHHELD, "an untrusted Git line has no standalone path exemption");
  }
});

test("all Git quoting helpers withhold known credentials outside URLs in stderr and message fallbacks", () => {
  const source = readFileSync(new URL("../lib/remote.mjs", import.meta.url), "utf8");
  const definitions = ["fail", "stderrText", "gitLastLine", "unreadable", "cacheFailure", "listingUnreadable"]
    .map((name) => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0]).join("\n");
  const helpers = new Function("oatsError", "redactUrl", "scrubGitLine", "classifyRemoteFailure", "keychainHint", "isLockRace", "isLocalWriteFailure", "markCacheDamaged", "KEYCHAIN_REMEDY",
    `${definitions}; return [unreadable, cacheFailure, (ref, error) => listingUnreadable(error, {ref,repo:{dir:"fixture"},spec:"HEAD"})];`)(
    oatsError, redactUrl, scrubGitLine, () => "unknown", () => null, () => false, () => false, () => {}, "");
  for (const [index, fn] of helpers.entries()) for (const text of [`unexpected ${ssh}; ${PASSWORD}`, `unexpected ${USER}; ${PASSWORD}`]) {
    for (const error of [gitError(text), new Error(text)]) {
      const e = fn({ url: ssh, key }, error);
      safeError(e, "E_REMOTE_UNREADABLE");
      if (index === 0 && error.stderr === undefined) {
        assert.equal(e.message, `cannot read remote ${clean} (unknown)`, "ordinary read failures do not invent stderr from Error.message");
      } else assert.ok(e.message.includes(GIT_WITHHELD), "existing stderr and fallback routes use whole-line withholding");
    }
  }
});


test("read failures with no stderr keep the reason and output-budget fallback without a Git notice", () => {
  const source = readFileSync(new URL("../lib/remote.mjs", import.meta.url), "utf8");
  const definitions = ["fail", "gitLastLine", "unreadable"]
    .map(name => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0]).join("\n");
  const unreadable = new Function("oatsError", "redactUrl", "scrubGitLine", "classifyRemoteFailure", "keychainHint", "cacheFailure", "KEYCHAIN_REMEDY",
    `${definitions}; return unreadable;`)(oatsError, redactUrl, scrubGitLine, classifyRemoteFailure, () => null,
    () => assert.fail("fixture must take the ordinary remote-read route"), "");
  for (const [url, shown] of [
    [`https://${host}/${path}`, `https://${host}/${path}`],
    [`git@${host}:${path}`, clean],
    [ssh, clean],
  ]) {
    const ref = { key, url };
    for (const stderr of [undefined, Buffer.alloc(0), "", " \n\r\t"]) for (const overflowed of [false, true]) {
      const error = Object.assign(new Error(`fixture command failed ${PASSWORD}`), { code: 128, overflowed });
      if (stderr !== undefined) error.stderr = stderr;
      const e = unreadable(ref, error);
      safeError(e, "E_REMOTE_UNREADABLE");
      assert.equal(e.details.reason, "unknown");
      assert.equal(e.message, `cannot read remote ${shown} (unknown)${overflowed ? ": git's output exceeded its budget" : ""}`);
      assert.ok(!e.message.includes(GIT_WITHHELD), "no stderr means no quoted Git text and no withholding notice");
    }
    const gitText = "fatal: fixture failure";
    for (const stderr of [gitText, Buffer.from(gitText)]) {
      const e = unreadable(ref, Object.assign(new Error("ignored wrapper message"), { code: 128, stderr }));
      const said = url.startsWith("https:") ? gitText : GIT_WITHHELD;
      assert.equal(e.message, `cannot read remote ${shown} (unknown): ${said}`, "actual nonempty stderr still follows the Git display policy");
      assert.equal(e.details.reason, "unknown");
    }
  }
});


test("no-path slash-in-password refusal removes userinfo from every error field", async () => {
  const e = await refused(() => parseRepoRef("https://TOKSECRET:P/extra@h.x"));
  assert.equal(e.code, "E_REPO_REF");
  assert.equal(e.message, `repository reference has an invalid host: ${WITHHELD} ${withheldClause}`);
  assert.deepEqual(e.details, { ref: WITHHELD, host: WITHHELD });
  assert.equal(e.provenance, e.details);
});


// Inspect output values and object keys, not just the fixture's known markers. Every
// supported scheme authority is safe even when another URL precedes it in a scalar.
function authorityInvariant(value) {
  if (typeof value === "string") {
    for (const match of value.matchAll(/([a-z][a-z0-9+.-]*):\/\/(\/*)([^/\s'"<>]*)/gi)) {
      if (match[2] && !/^(?:https?|ssh)$/i.test(match[1])) continue; // file:/// remains a path
      assert.ok(!match[3].includes("@"), `userinfo remains in authority: ${match[0]}`);
    }
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) { authorityInvariant(key); authorityInvariant(item); }
  }
}

test("every composed reference output sanitizes later authorities in all renderer modes", async () => {
  const later = `https://${PASSWORD}@github.com/c/d`;
  const refs = [
    ...[" ", "\n", ", ", ";", "|"].map(separator => `https://${USER}@github.com/a/b${separator}${later}`),
    `https://github.com/a/b ${later}`, `git@github.com:a/b ${later}`,
    `https://github.com:8443/a/b ${later}`,
    `https://${USER}@github.com/a/b -${later}`,
    `https://${USER}@github.com/a/b; git@other.invalid:c/d`,
    `https://${USER}@github.com/a/b ssh://git:${PASSWORD}@other.invalid:22/c/d`,
  ];
  for (const ref of refs) {
    const rendered = redactUrl(ref, null, { reference: true });
    noTokens(rendered); authorityInvariant(rendered);
    assert.equal(rendered, WITHHELD, "composed values lose all input components");
    const e = await refused(() => parseRepoRef(ref));
    safeError(e, "E_REPO_REF"); authorityInvariant({ message: e.message, details: e.details });
    assert.equal(e.details.ref, rendered);
    const nested = await refused(() => parseRepoRef({ nested: { [ref]: [ref] } }));
    safeError(nested, "E_REPO_REF"); authorityInvariant(nested.details);
    assert.equal(e.message.split(withheldClause).length - 1, 1, "one explanation for the whole composed refusal");
    const outputs = [
      redactUrl(ref), redactUrl(ref, ref, { known: false }),
      redactUrl(`refused ${JSON.stringify(ref)}`, ref, { known: false, refusal: true }),
      redactUrl(ref, ref, { fragment: true, known: false }),
      redactUrl({ [ref]: { nested: [ref] } }, null, { reference: true }),
      redactUrl({ [ref]: { nested: [ref] } }, ref, { known: false }),
    ];
    noTokens(outputs); authorityInvariant(outputs);
    for (const [problems, location] of [
      [validateLocal({ schemaVersion: 2, workspace: ref }), "/workspace"],
      [validateWorkspace({ schemaVersion: 2, name: "fixture", members: [ref] }), "/members/0"],
      [validateMembership({ schemaVersion: 2, workspace: ref }), "/workspace"],
    ]) {
      assert.ok(problems.some(p => p.path === location));
      noTokens(problems); authorityInvariant(problems);
      for (const p of problems.filter(p => p.message.includes("does not match"))) assert.ok(!p.message.includes(clause));
    }
  }
  // Missing YAML list marker folds the second URL into the first member scalar.
  const yaml = `schemaVersion: 2\nname: fixture\nmembers:\n  - https://${USER}@github.com/a/b\n    ${later}\n`;
  const declaration = readDeclaration("workspace", Buffer.from(yaml), { path: "oats-workspace.yaml" });
  assert.equal(declaration.value.members[0], refs[0], "must reach decoded member validation");
  assert.ok(declaration.problems.some(p => p.path === "/members/0"));
  noTokens(declaration.problems); authorityInvariant(declaration.problems);
});

test("HTTP and SSH extra-slash values are withheld whole, while standalone file paths retain their meaning", async () => {
  for (const scheme of ["http", "https", "ssh"]) for (const slashes of ["///", "////", "/////"]) {
    const ref = `${scheme}:${slashes}${USER}:${PASSWORD}@github.com/a/b`;
    const displayed = WITHHELD;
    assert.equal(redactUrl(ref), GIT_WITHHELD);
    for (const result of [redactUrl(ref, null, { reference: true }),
      redactUrl(`quoted ${JSON.stringify(ref)}`, ref, { known: false }),
      redactUrl(`https://github.com/c/d\n${ref}`, null, { reference: true })]) {
      noTokens(result); authorityInvariant(result); assert.ok(result.includes(displayed));
    }
    const e = await refused(() => parseRepoRef(ref));
    safeError(e, "E_REPO_REF");
    assert.equal(e.details.ref, displayed);
    assert.equal(e.message.split(withheldClause).length - 1, 1);
    noTokens(validateLocal({ schemaVersion: 2, workspace: ref }));
    noTokens(validateWorkspace({ schemaVersion: 2, name: "fixture", members: [ref] }));
    noTokens(validateMembership({ schemaVersion: 2, workspace: ref }));
  }
  for (const prefix of ["-", ".", "_", "123", "\\n"]) {
    const output = redactUrl(`${prefix}https:///${USER}@github.com/a/b`);
    noTokens(output); authorityInvariant(output);
  }
  for (const slashes of ["///", "////", "/////"]) {
    const file = `file:${slashes}${USER}@github.com/a/b`;
    assert.equal(redactUrl(file), GIT_WITHHELD, "unknown Git text does not inherit file-path semantics");
    assert.equal(redactUrl(file, null, { reference: true }), file);
  }
  const query = "https://github.com/a/b?token=QUERY_TOKEN#FRAGMENT_TOKEN";
  assert.equal(redactUrl(query, null, { reference: true }), WITHHELD);
  assert.equal(redactUrl(query), GIT_WITHHELD, "unknown Git text is withheld whole");
});

test("derived fragments display only recognized complete components, including repeated and absent matches", () => {
  for (const [source, fragment, expected] of [
    ["https://aaaaa@host/path", "aaa", WITHHELD],
    ["https://ababab@host/path", "abab", WITHHELD],
    ["https://ababab@host/path", "aaba", WITHHELD],
    ["https://aaaaa@host/aaa", "aaa", WITHHELD],
    ["https://aaaaa@host/path", "aa@host", WITHHELD],
    ["https://aaaaa@host/path", "host/path", WITHHELD],
    ["https://aaaaa@host/org/repo", "org/repo", "org/repo"],
    ["https://aaaaa@host/org/repo", "host", "host"],
  ]) assert.equal(redactUrl(fragment, source, { fragment: true, known: false }), expected);
});

test("periodic host fragments remain bounded through full parser refusals and decoded members", (t) => {
  const probe = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { performance } from "node:perf_hooks";
    import { parseRepoRef } from ${JSON.stringify(new URL("../lib/remote.mjs", import.meta.url).href)};
    import { readDeclaration } from ${JSON.stringify(new URL("../lib/workspace.mjs", import.meta.url).href)};
    const timings = [];
    for (const n of [5000, 10000, 20000, 240000]) {
      const ref = "https://" + "a:".repeat(n) + "/" + "x@".repeat(n) + "y/z";
      for (const mode of ["parse", "member"]) {
        const start = performance.now();
        if (mode === "parse") {
          assert.throws(() => parseRepoRef(ref), e => {
            assert.equal(e.code, "E_REPO_REF");
            assert.equal(e.details.ref, "[repository reference withheld]");
            assert.equal(e.details.host, "[repository reference withheld]");
            assert.ok(e.message.includes("invalid host"));
            return true;
          });
        } else {
          const bytes = Buffer.from(JSON.stringify({schemaVersion:2, name:"fixture", members:[ref]}));
          assert.ok(bytes.length < 1048576);
          const decoded = readDeclaration("workspace", bytes, {path:"oats-workspace.yaml"});
          assert.equal(decoded.value?.members?.[0], ref, "must decode rather than hit a byte/syntax refusal");
          assert.ok(decoded.problems.some(p => p.path === "/members/0" && p.message.includes("invalid host")));
          assert.ok(!JSON.stringify(decoded.problems).includes("a:".repeat(10)));
        }
        timings.push({mode, size:ref.length, ms:performance.now() - start});
      }
    }
    console.log(JSON.stringify(timings));
  `], { encoding: "utf8", timeout: 15000 });
  assert.equal(probe.error, undefined, `full refusal probe timed out: ${probe.error}`);
  assert.equal(probe.status, 0, probe.stderr);
  const timings = JSON.parse(probe.stdout);
  assert.equal(timings.length, 8);
  for (const row of timings) assert.ok(row.ms < 3000, `${row.mode} (${row.size} bytes) took ${row.ms} ms`);
  t.diagnostic(JSON.stringify(timings));
});


test("scheme tokens own punctuation-bearing userinfo with ports, without hiding later URLs", async () => {
  for (const punctuation of ["=", ",", ";", "(", "[", "{", "|", "\\"]) {
    const ref = `https://${USER}:${PASSWORD}${punctuation}x@github.com:443/a/b`;
    const shown = "https://github.com:443/a/b";
    assert.equal(redactUrl(ref), GIT_WITHHELD);
    assert.equal(redactUrl(ref, null, { reference: true }), shown);
    assert.equal(scrubGitLine(`fatal: '${ref}': unexpected`), GIT_WITHHELD);
    for (const value of [ref, `${ref} https://${PASSWORD}@other.invalid/c/d`,
      `${ref};https://${PASSWORD}@other.invalid/c/d`]) {
      const e = await refused(() => parseRepoRef(value));
      safeError(e, "E_REPO_REF"); authorityInvariant(e.details);
      const expected = value === ref ? shown : WITHHELD;
      const explanation = value === ref ? clause : withheldClause;
      assert.equal(e.details.ref, expected);
      assert.equal(e.message.split(explanation).length - 1, 1);
      const nested = await refused(() => parseRepoRef({ nested: { [value]: [value] } }));
      safeError(nested, "E_REPO_REF"); authorityInvariant(nested.details);
      for (const problems of [validateLocal({ schemaVersion: 2, workspace: value }),
        validateMembership({ schemaVersion: 2, workspace: value }),
        validateWorkspace({ schemaVersion: 2, name: "fixture", members: [value] })]) {
        noTokens(problems); authorityInvariant(problems);
        assert.ok(problems.some(p => p.message.includes(expected)), "schema diagnostics use the same whole-value decision");
      }
    }
    const rawSSH = ref.replace("https:", "ssh:");
    assert.equal(parseRepoRef(rawSSH).url, rawSSH);
    const argsSeen = [];
    const exec = async (args, opts) => {
      argsSeen.push(args);
      if (args.includes("fetch")) throw gitError(`fatal: unexpected refusal for '${rawSSH}'`);
      return runGit(args, opts);
    };
    const e = await refused(() => readRemoteFile(rawSSH, "1".repeat(40), "small", { cacheDir: scratch(), exec }));
    safeError(e, "E_REMOTE_UNREADABLE");
    assert.equal(e.details.url, "ssh://github.com:443/a/b");
    assert.ok(!e.message.includes(clause));
    assert.ok(argsSeen.some(args => args.includes(`remote.origin.url=${rawSSH}`)));
  }
  // An SCP-shaped substring joined to a URL is mixed input, not a separate safe display.
  const pathText = "https://github.com/a/b;git@other.invalid:c/d";
  assert.equal(redactUrl(pathText), GIT_WITHHELD);
});

test("later malformed references withhold the whole selected value and derived fragments", async () => {
  for (const separator of [" ", "\n", ", ", ";"]) for (const tail of ["", ":443", ":443/c/d"]) {
    const later = `https://${USER}:${PASSWORD}/extra@other.invalid${tail}`;
    const ref = `https://github.com/a/b${separator}${later}`;
    const shown = WITHHELD;
    assert.equal(redactUrl(ref, null, { reference: true }), shown);
    assert.equal(redactUrl(ref, ref, { known: false }), shown);
    assert.equal(redactUrl(`quoted ${JSON.stringify(ref)}`, ref, { known: false }), `quoted ${JSON.stringify(shown)}`);
    const e = await refused(() => parseRepoRef(ref));
    safeError(e, "E_REPO_REF");
    assert.equal(e.details.ref, shown);
    assert.equal(e.message.split(withheldClause).length - 1, 1);
    for (const problems of [validateLocal({ schemaVersion: 2, workspace: ref }),
      validateMembership({ schemaVersion: 2, workspace: ref }),
      validateWorkspace({ schemaVersion: 2, name: "fixture", members: [ref] })]) {
      noTokens(problems);
      assert.ok(problems.some(p => p.message.includes(JSON.stringify(shown))));
    }
    const nested = await refused(() => parseRepoRef({ nested: { [ref]: [ref] } }));
    safeError(nested, "E_REPO_REF");
  }
  const ref = `https://github.com/a/b https://${USER}:${PASSWORD}/q@other.invalid/c/d https://${USER}:${PASSWORD}/z@third.invalid/e/f`;
  const e = await refused(() => parseRepoRef(ref));
  safeError(e, "E_REPO_REF");
  assert.equal(e.details.path, WITHHELD);
  assert.equal(e.message.split(withheldClause).length - 1, 1);
  const boundedProse = `fatal: 'https://host.x:8443/a@b' remains a URL; mail admin@corp.com`;
  assert.equal(redactUrl(boundedProse), GIT_WITHHELD);
  // These selected values are outside the component grammar, including query
  // suffixes. They are withheld whole rather than scanned for query secrets.
  for (const tail of ["https://host.x:8443/repo@v1@x", "https://abc:4567/x@h.x",
    "https://host.x:443/o?value=user:QUERY_SECRET/q@h.x/c/d",
    "https://host.x:443/o#user:FRAGMENT_SECRET/q@h.x/c/d"]) {
    const value = `https://github.com/a/b ${tail}`;
    assert.equal(redactUrl(value, null, { reference: true }), WITHHELD);
    assert.equal(redactUrl(value, value, { known: false, refusal: true }), `${WITHHELD} ${withheldClause}`);
  }
});


test("recognized userinfo delimiters retain safe components and mixed values are withheld", async () => {
  for (const delimiter of ["?", "#", "'", '"']) for (const combo of [delimiter, `=${delimiter},;`]) {
    const ref = `https://${USER}:${PASSWORD}${combo}x@github.com:443/a/b`;
    const shown = "https://github.com:443/a/b";
    for (const [value, output] of [[ref, shown],
      [`https://host.x/o/r ${ref}`, WITHHELD],
      [`${ref},https://${PASSWORD}@other.invalid/c/d`, WITHHELD]]) {
      assert.equal(redactUrl(value, null, { reference: true }), output);
      assert.equal(redactUrl(value, value, { known: false }), output);
      assert.equal(redactUrl(`quoted ${JSON.stringify(value)}`, value, { known: false }), `quoted ${JSON.stringify(output)}`);
      const e = await refused(() => parseRepoRef(value));
      safeError(e, "E_REPO_REF"); authorityInvariant(e.details);
      assert.equal(e.details.ref, output);
      assert.equal(e.message.split(output === WITHHELD ? withheldClause : clause).length - 1, 1);
      for (const problems of [validateLocal({ schemaVersion: 2, workspace: value }),
        validateMembership({ schemaVersion: 2, workspace: value }),
        validateWorkspace({ schemaVersion: 2, name: "fixture", members: [value] })]) {
        noTokens(problems); authorityInvariant(problems);
        assert.ok(problems.some(p => p.message.includes(JSON.stringify(output))));
      }
      safeError(await refused(() => parseRepoRef({ [value]: [value] })), "E_REPO_REF");
    }
    assert.equal(scrubGitLine(`fatal: '${ref}': unexpected`, ref), GIT_WITHHELD);
    const rawSSH = ref.replace("https:", "ssh:"), argsSeen = [];
    assert.equal(parseRepoRef(rawSSH).url, rawSSH);
    const exec = async (args, opts) => {
      argsSeen.push(args);
      if (args.includes("fetch")) throw gitError(`fatal: unexpected refusal for '${rawSSH}'`);
      return runGit(args, opts);
    };
    const e = await refused(() => readRemoteFile(rawSSH, "1".repeat(40), "small", { cacheDir: scratch(), exec }));
    safeError(e, "E_REMOTE_UNREADABLE");
    assert.equal(e.details.url, "ssh://github.com:443/a/b");
    assert.ok(!e.message.includes(clause));
    assert.ok(argsSeen.some(args => args.includes(`remote.origin.url=${rawSSH}`)));
  }
  for (const suffix of ["?Q", "#F"]) {
    const value = `https://host:443${suffix}@h.x`;
    assert.equal(redactUrl(value, null, { reference: true }), WITHHELD,
      "an authority without a recognized repository path is withheld");
  }
  const prose = "fatal: 'ssh://host' does not appear to be a repository; mail admin@corp.com";
  assert.equal(redactUrl(prose), GIT_WITHHELD, "unknown Git prose is withheld whole");
});


test("seeded generated reference diagnostics never retain injected credential markers", (t) => {
  const seed = 0x10771090;
  let state = seed, serial = 0;
  const random = (n) => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) % n; };
  const forms = ["http", "https", "ssh", "scp", "file"];
  const delimiters = ["@", ":", "/", "?", "#", "=", ",", ";", "'", '"', " "];
  const separators = [" ", "\n", ","];
  // The original axes and RNG calls stay unchanged. Each original gets one
  // deterministic after-delimiter partner, without consuming another random value.
  const coverage = { seed, cases: 0, variants: 0, executedCases: 0, components: 0, checks: 0, parserSuccesses: 0,
    ordinaryProseChecked: 0, ordinaryProseExcluded: 0, filePathControls: 0, forms: {}, slashes: {}, delimiters: {}, ports: {}, widths: {}, separators: {}, checksByMode: {}, variantsChecked: {} };
  const count = (record, key) => { record[key] = (record[key] ?? 0) + 1; };
  const make = (form, slashes, delimiter) => {
    const id = serial++, port = random(2) ? ":443" : "";
    coverage.components++; count(coverage.forms, form); count(coverage.slashes, slashes);
    count(coverage.delimiters, delimiter); count(coverage.ports, port || "none");
    if (form === "file" && slashes >= 3) {
      coverage.filePathControls++;
      const control = `PATH_CONTROL_${id}`;
      const raw = `file:${"/".repeat(slashes)}${control}@name/o/r`;
      return { raw, after: raw, tokens: [], controls: [control] };
    }
    const token = `CRED_MARKER_${id}_END`, host = `h${id}.invalid`;
    const renderInput = (info) => form === "scp" ? `${info}@${host}:${"/".repeat(slashes)}o/r`
      : `${form}:${"/".repeat(slashes)}${info}@${host}${port}/o/r`;
    return { raw: renderInput(`u:${token}${delimiter}x`), after: renderInput(`u:x${delimiter}${token}`), tokens: [token], controls: [] };
  };
  const cases = [];
  // No case is discarded based on parsing, rendering, or the invariant's outcome.
  for (const form of forms) for (let slash = 0; slash <= 5; slash++) for (const delimiter of delimiters) {
    const parts = [make(form, slash, delimiter)], width = 1 + random(3), separator = separators[random(3)];
    while (parts.length < width) parts.push(make(forms[random(forms.length)], random(6), delimiters[random(delimiters.length)]));
    const shared = { width, tokens: parts.flatMap(p => p.tokens), controls: parts.flatMap(p => p.controls) };
    cases.push({ ...shared, variant: "original", input: parts.map(p => p.raw).join(separator) });
    cases.push({ ...shared, variant: "after-delimiter", input: parts.map(p => p.after).join(separator) });
    coverage.cases++; coverage.variants++; count(coverage.widths, width); count(coverage.separators, separator);
  }
  const failures = [];
  const check = (sample, mode, output, preserve = false) => {
    coverage.checks++; count(coverage.checksByMode, mode);
    const text = JSON.stringify(output);
    const leaked = sample.tokens.filter(token => text.includes(token));
    // Standalone file paths remain operational path data in selected-reference
    // displays. Whole Git-line decisions and mixed references may lose that data.
    const lost = preserve && sample.width === 1 ? sample.controls.filter(token => !text.includes(token)) : [];
    if (preserve && sample.width > 1 && !text.includes(WITHHELD))
      failures.push({ mode, variant: sample.variant, input: sample.input, expected: WITHHELD, output });
    if (leaked.length || lost.length) failures.push({ mode, variant: sample.variant, input: sample.input, leaked, lost, output });
  };
  for (const sample of cases) {
    coverage.executedCases++; count(coverage.variantsChecked, sample.variant);
    check(sample, "reference", redactUrl(sample.input, null, { reference: true }), true);
    check(sample, "source", redactUrl(sample.input, sample.input, { known: false }), true);
    check(sample, "quoted-source", redactUrl(`quoted ${JSON.stringify(sample.input)}`, sample.input, { known: false }), true);
    check(sample, "nested-reference", redactUrl({ [sample.input]: [sample.input] }, null, { reference: true }), true);
    coverage.ordinaryProseChecked++;
    check(sample, "prose", redactUrl(sample.input));
    const gitLine = `fatal: unable to access '${sample.input}': x`;
    const slashLine = `fatal: unable to access '${sample.input}/': x`;
    check(sample, "git-unknown", scrubGitLine(gitLine));
    check(sample, "git-known", scrubGitLine(gitLine, sample.input));
    check(sample, "git-known-added-slash", scrubGitLine(slashLine, sample.input));
    try { parseRepoRef(sample.input); coverage.parserSuccesses++; }
    catch (e) { check(sample, "parser", { code: e.code, message: e.message, details: e.details, provenance: e.provenance }); }
    try { parseRepoRef({ nested: { [sample.input]: [sample.input] } }); assert.fail("object must be refused"); }
    catch (e) { check(sample, "nested-parser", { code: e.code, message: e.message, details: e.details, provenance: e.provenance }); }
    check(sample, "local", validateLocal({ schemaVersion: 2, workspace: sample.input }));
    check(sample, "membership", validateMembership({ schemaVersion: 2, workspace: sample.input }));
    check(sample, "workspace", validateWorkspace({ schemaVersion: 2, name: "fixture", members: [sample.input] }));
  }
  assert.equal(coverage.cases, 330);
  assert.equal(coverage.variants, 330);
  assert.equal(coverage.executedCases, 660);
  assert.equal(coverage.ordinaryProseChecked, 660);
  assert.equal(coverage.ordinaryProseExcluded, 0);
  const query = "https://h.invalid/o/r?value=QUERY_CONTROL#FRAGMENT_CONTROL";
  assert.equal(redactUrl(query, null, { reference: true }), WITHHELD);
  assert.equal(redactUrl(query), GIT_WITHHELD, "a Git line with unknown operation context is withheld whole");
  const unrelated = validateWorkspace({ schemaVersion: 2, name: "https://UNRELATED_CONTROL@h.invalid/o/r" });
  assert.ok(unrelated.some(p => p.path === "/name" && p.message.includes("UNRELATED_CONTROL")));
  const failuresByMode = {};
  for (const failure of failures) count(failuresByMode, failure.mode);
  t.diagnostic(JSON.stringify({ coverage, failureCount: failures.length, failuresByMode, firstFailures: failures.slice(0, 5) }));
  assert.equal(failures.length, 0, `seed=${seed}; failures=${failures.length}; first=${JSON.stringify(failures[0])}`);
});
