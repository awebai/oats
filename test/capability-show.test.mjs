// `oats capabilities show` (feature capability-show, capabilityShowApi 1; docs/desktop-cli-api.md
// "`oats capabilities show`"): what one catalog row ships — its inject text and each skill's files — and one
// listed file's text, at the row's commit, through the read path a spawn uses.
//
// Unit: the text decoding and cut, the SKILL.md description, the --file path check, row selection. CLI: the real
// CLI over a v2 deployment (test/helpers/v2-deployment.mjs) with a member and a package repo; no network.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESCRIPTION_LIMIT, FILES_PER_SKILL, TEXT_LIMIT, cutUtf8, decodeText, selectCapabilityRow, skillDescription, unsafeFilePath } from "../lib/capability-show.mjs";
import { FILE_BUDGET } from "../lib/remote.mjs";
import { git, v2Deployment } from "./helpers/v2-deployment.mjs";
import { packageRepo } from "./helpers/package-repo.mjs";

/** stdout must be exactly one JSON document — anything else is contamination. */
function parseOnly(stdout) {
  const doc = JSON.parse(stdout);
  assert.equal(stdout.trim(), JSON.stringify(doc), "stdout is exactly one compact JSON object");
  return doc;
}
const ok = (r) => { assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`); const d = parseOnly(r.stdout); assert.equal(d.ok, true); return d.result; };
const refused = (r, code, what) => {
  assert.notEqual(r.status, 0, `${what}: nonzero exit`);
  const d = parseOnly(r.stdout);
  assert.equal(d.ok, false, what);
  assert.equal(d.error.code, code, `${what} → ${code} (got ${d.error.code}: ${d.error.message})`);
  return d.error;
};
/** The text invariants the Desktop relies on, for any {bytes, text, binary, truncated}. */
function assertTextInvariants(t, what) {
  if (t.binary) assert.deepEqual([t.text, t.truncated], [null, false], `${what}: binary ⇒ text null, truncated false`);
  if (t.truncated) assert.ok(typeof t.text === "string" && t.binary === false, `${what}: truncated ⇒ a text, not binary`);
  if (t.bytes === null) assert.deepEqual([t.text, t.binary, t.truncated], [null, false, false], `${what}: no bytes ⇒ nothing read`);
}

// ---------------------------------------------------------------------------
// unit
// ---------------------------------------------------------------------------

test("decodeText: text up to the limit; a cut on a code point boundary; NUL or invalid UTF-8 in the examined bytes is binary; the BOM is kept", () => {
  const ascii = (n) => Buffer.alloc(n, 0x61);
  let r = decodeText(Buffer.from("\uFEFFhé\n"));
  assert.deepEqual(r, { text: "\uFEFFhé\n", binary: false, truncated: false }, "the BOM stays in the text");
  r = decodeText(ascii(TEXT_LIMIT));
  assert.deepEqual([r.text.length, r.truncated, r.binary], [TEXT_LIMIT, false, false], "exactly the limit is whole");
  r = decodeText(ascii(TEXT_LIMIT + 1));
  assert.deepEqual([r.text.length, r.truncated], [TEXT_LIMIT, true], "one byte over is cut");
  // A 2-byte character straddling the limit (262145 bytes in all): cut before it.
  r = decodeText(Buffer.concat([ascii(TEXT_LIMIT - 1), Buffer.from("é")]));
  assert.deepEqual([Buffer.byteLength(r.text), r.truncated, r.text.endsWith("a")], [TEXT_LIMIT - 1, true, true]);
  // A 4-byte character ending exactly at the limit is kept; one straddling it is not.
  r = decodeText(Buffer.concat([ascii(TEXT_LIMIT - 4), Buffer.from("😀"), ascii(10)]));
  assert.deepEqual([Buffer.byteLength(r.text), r.text.endsWith("😀"), r.truncated], [TEXT_LIMIT, true, true]);
  r = decodeText(Buffer.concat([ascii(TEXT_LIMIT - 2), Buffer.from("😀"), ascii(10)]));
  assert.deepEqual([Buffer.byteLength(r.text), r.text.endsWith("a"), r.truncated], [TEXT_LIMIT - 2, true, true]);
  const binary = { text: null, binary: true, truncated: false };
  assert.deepEqual(decodeText(Buffer.from([0x61, 0x00, 0x62])), binary, "a NUL");
  assert.deepEqual(decodeText(Buffer.from([0x61, 0xff, 0x62])), binary, "invalid UTF-8");
  assert.deepEqual(decodeText(Buffer.from([0x61, 0xc3])), binary, "a truncated sequence at the end of the file");
  assert.deepEqual(decodeText(Buffer.concat([ascii(TEXT_LIMIT + 2), Buffer.from([0x00])])), binary, "a NUL in the last examined byte (limit + 3)");
  assert.deepEqual(decodeText(Buffer.concat([ascii(TEXT_LIMIT + 2), Buffer.from([0xff])])), binary, "invalid UTF-8 in the last examined byte");
  // Beyond the examined bytes nothing is looked at: a NUL there leaves a (truncated) text.
  r = decodeText(Buffer.concat([ascii(TEXT_LIMIT + 3), Buffer.from([0x00])]));
  assert.deepEqual([r.binary, r.truncated, r.text.length], [false, true, TEXT_LIMIT]);
  // A valid multi-byte sequence the examined bytes end inside of is not judged incomplete.
  r = decodeText(Buffer.concat([ascii(TEXT_LIMIT + 1), Buffer.from("😀")]));
  assert.deepEqual([r.binary, r.truncated, r.text.length], [false, true, TEXT_LIMIT]);
  assert.deepEqual(decodeText(Buffer.alloc(0)), { text: "", binary: false, truncated: false });
  // An invalid byte inside the examined bytes of a LONGER file is binary too (review round 1): never dropped as
  // a would-be incomplete tail.
  for (const [at, bad] of [[TEXT_LIMIT + 2, 0xff], [TEXT_LIMIT + 2, 0xf5], [TEXT_LIMIT + 1, 0xc0], [TEXT_LIMIT + 1, 0xc1], [TEXT_LIMIT, 0xf8]]) {
    assert.deepEqual(decodeText(Buffer.concat([ascii(at), Buffer.from([bad]), ascii(8)])), binary, `0x${bad.toString(16)} at ${at} of a longer file`);
  }
  // A valid lead the examined bytes end inside of, in a longer file, is not judged.
  r = decodeText(Buffer.concat([ascii(TEXT_LIMIT + 1), Buffer.from([0xf0, 0x9f]), Buffer.from([0x98, 0x80]), ascii(4)]));
  assert.deepEqual([r.binary, r.truncated, r.text.length], [false, true, TEXT_LIMIT]);
});

test("skillDescription: the front matter's description string (block scalars too), cut to 1 KiB on a code point boundary; null otherwise", () => {
  assert.equal(skillDescription("---\nname: x\ndescription: One line.\n---\nbody\n"), "One line.");
  assert.equal(skillDescription("---\nname: x\ndescription: |\n  first\n  second\n---\n"), "first\nsecond\n", "a literal block scalar");
  assert.equal(skillDescription("---\ndescription: >-\n  folded\n  text\n---\n"), "folded text", "a folded block scalar");
  assert.equal(skillDescription("\uFEFF---\r\ndescription: crlf\r\n---\r\n"), "crlf", "a BOM and CRLF line ends");
  assert.equal(skillDescription("---\ndescription: 42\n---\n"), null, "a number is not a description");
  assert.equal(skillDescription("---\ndescription: [a, b]\n---\n"), null, "a list is not a description");
  assert.equal(skillDescription("---\nname: x\n---\n"), null, "no description key");
  assert.equal(skillDescription("# Just markdown\ndescription: no\n"), null, "no front matter");
  assert.equal(skillDescription("---\ndescription: never closed\n"), null, "front matter never closed");
  assert.equal(skillDescription("---\ndescription: [unclosed\n---\n"), null, "front matter that does not parse");
  assert.equal(skillDescription("---\n- a list\n---\n"), null, "front matter that is not a mapping");
  assert.equal(skillDescription("text\n---\ndescription: late\n---\n"), null, "the front matter must lead");
  assert.equal(skillDescription(null), null, "an unreadable or binary SKILL.md");
  // Over 1 KiB, a 3-byte character straddling the cut: cut before it.
  const long = `${"a".repeat(DESCRIPTION_LIMIT - 1)}€tail`;
  const cut = skillDescription(`---\ndescription: "${long}"\n---\n`);
  assert.equal(cut, "a".repeat(DESCRIPTION_LIMIT - 1));
  assert.equal(cutUtf8("€€", 4), "€");
  assert.equal(cutUtf8("short", DESCRIPTION_LIMIT), "short");
});

test("unsafeFilePath: absolute, empty, `.`/`..`/`.git` or empty components, a backslash, a NUL, a trailing slash", () => {
  for (const p of ["", "/etc/passwd", "../oats.json", "skills/x/../../oats.json", "./skills/x", "skills/./x", "skills//x", "skills/x/", ".git/config", "skills/.GIT/x",
    "skills\\x", "skills/x\0", "..", "."]) assert.equal(unsafeFilePath(p), true, JSON.stringify(p));
  for (const p of ["oats.json", "skills/x/SKILL.md", "injects/a.md", "skills/.github/x", "skills/x/.hidden", "a..b/c"]) assert.equal(unsafeFilePath(p), false, p);
});

test("capabilitySkills: a skill path is reported as the install reads it (a backslash is a separator); a `.git` one makes the skills unlistable", async () => {
  const { capabilitySkills, manifestFilePath } = await import("../lib/resolve.mjs");
  const { parseRepoRef } = await import("../lib/remote.mjs");
  const remote = { parseRepoRef, readRemoteFile: async () => { throw new Error("not read"); }, listRemoteTree: async () => [{ path: "SKILL.md", type: "blob" }] };
  const skills = (declared) => capabilitySkills({ ref: "https://github.com/acme/x", commit: "a".repeat(40), dir: "cap", manifest: { capability: "acme.x", skills: declared }, remote });
  assert.deepEqual(await skills(["skills\\x"]), { skills: [{ name: "skills\\x", path: "skills/x" }], problem: null });
  assert.deepEqual((await skills(["./skills/y/"])).skills, [{ name: "y", path: "skills/y" }]);
  for (const bad of [".git", "skills/.GIT", "skills\\.git"]) {
    const r = await skills([bad]);
    assert.equal(r.skills, null, bad);
    assert.deepEqual([r.problem.code, r.problem.details.why], ["E_CAPABILITY_MISSING", "unsafe"], bad);
  }
  assert.equal((await capabilitySkills({ ref: "https://github.com/acme/x", commit: "a".repeat(40), dir: "cap", manifest: { capability: "acme.x", skills: [".git"] }, remote, missingCode: "E_PACKAGE_MANIFEST" })).problem.code, "E_PACKAGE_MANIFEST");
  for (const [raw, path] of [["injects\\guide.md", "injects/guide.md"], ["./injects/a.md", "injects/a.md"], [".git/config", null], ["x/.GIT/y", null], ["../x", null], ["/abs", null], ["", null]]) {
    assert.equal(manifestFilePath(raw), path, JSON.stringify(raw));
  }
});

test("selectCapabilityRow: by name, narrowed by --member or --package; none is UNKNOWN, more than one AMBIGUOUS with the candidates", () => {
  const rows = [
    { name: "x", kind: "member", repoKey: "github.com/a/one", origin: "member github.com/a/one @ 1" },
    { name: "x", kind: "package", package: "acme.pkg", origin: "package acme.pkg v1" },
    { name: "y", kind: "member", repoKey: "github.com/a/one", origin: "member github.com/a/one @ 1" },
  ];
  const caught = (fn) => { try { fn(); } catch (e) { return e; } assert.fail("expected a refusal"); };
  assert.equal(selectCapabilityRow(rows, "y"), rows[2], "a unique name needs no selector");
  assert.equal(selectCapabilityRow(rows, "x", { member: "github.com/a/one" }), rows[0]);
  assert.equal(selectCapabilityRow(rows, "x", { package: "acme.pkg" }), rows[1]);
  let e = caught(() => selectCapabilityRow(rows, "x"));
  assert.equal(e.code, "E_CAPABILITY_AMBIGUOUS");
  assert.deepEqual(e.details, { name: "x", candidates: [{ kind: "member", repoKey: "github.com/a/one", origin: rows[0].origin }, { kind: "package", package: "acme.pkg", origin: rows[1].origin }] });
  e = caught(() => selectCapabilityRow(rows, "nope"));
  assert.deepEqual([e.code, e.details], ["E_CAPABILITY_UNKNOWN", { name: "nope" }]);
  e = caught(() => selectCapabilityRow(rows, "y", { package: "acme.pkg" }));
  assert.deepEqual([e.code, e.details], ["E_CAPABILITY_UNKNOWN", { name: "y", package: "acme.pkg" }]);
  e = caught(() => selectCapabilityRow(rows, "x", { member: "github.com/a/two" }));
  assert.deepEqual([e.code, e.details], ["E_CAPABILITY_UNKNOWN", { name: "x", member: "github.com/a/two" }]);
});

// ---------------------------------------------------------------------------
// the CLI over a deployment
// ---------------------------------------------------------------------------

const BIG = Buffer.concat([Buffer.alloc(TEXT_LIMIT - 1, 0x62), Buffer.from("é")]); // 262145 bytes, é straddling the cut
const EXACT = Buffer.alloc(TEXT_LIMIT, 0x63);
const INJECT = "\uFEFF  Leading spaces, {{settings.x}} untemplated.\n\n\n";
const ALPHA = "---\nname: alpha\ndescription: |\n  Alpha does\n  two lines.\n---\n\nbody\n";
const PKG_SKILL = "---\nname: tool-skill\ndescription: tool\n---\n\nuse the tool\n"; // test/helpers/package-repo.mjs
const size = (text) => Buffer.byteLength(text);
const LONG_DESCRIPTION = `${"d".repeat(DESCRIPTION_LIMIT - 2)}€ and more`;
const LONG_FRONT_MATTER = `---\nextra: ${"a".repeat(TEXT_LIMIT)}\ndescription: This is valid.\n---\n`;
const many = Object.fromEntries(Array.from({ length: FILES_PER_SKILL }, (_, i) => [`skills/many/f${String(i).padStart(3, "0")}.md`, `${i}\n`]));

const SOURCES = { branches: { command: "poll", description: "Ready branches", events: ["opened", "updated"], fields: { branch: { pattern: "^harvest/[a-z0-9-]+$" } }, urlHosts: ["graph.example.org"] } };
const BAD_SOURCES = { good: { command: "poll", events: ["opened"] }, bad: { command: "nope", events: ["Opened"] } };

let pkg, fx, catalogRows;
test.before(() => {
  pkg = packageRepo();
  fx = v2Deployment({
    workspace: { packages: { "acme.pkg": `${pkg.ref}@v1.0.0` } },
    capabilities: {
      "acme.tool": { manifest: { inject: "./injects/tool.md", skills: ["skills"] }, files: {
        "injects/tool.md": INJECT,
        "skills/alpha/SKILL.md": ALPHA,
        "skills/alpha/ref/nested/deep.md": "deep\n",
        "skills/alpha/link.md": { symlink: "SKILL.md" },
        "skills/beta/SKILL.md": "No front matter.\n",
        "skills/beta/data.bin": { text: Buffer.from([0x50, 0x4b, 0x00, 0x01]) },
        "skills/beta/big.md": { text: BIG },
        "skills/beta/exact.md": { text: EXACT },
        "skills/beta/huge.txt": { text: Buffer.alloc(FILE_BUDGET + 1, 0x68) },
        "skills/gamma/SKILL.md": `---\ndescription: "${LONG_DESCRIPTION}"\n---\n`,
        "skills/delta/SKILL.md": "---\ndescription:\n  - not a string\n---\n",
        "skills/epsilon/SKILL.md": LONG_FRONT_MATTER,
        "scripts/run.mjs": "secret()\n",
      } },
      "acme.many": { manifest: { skills: ["skills/many"] }, files: { "skills/many/SKILL.md": "---\ndescription: many\n---\n", ...many } },
      "acme.binject": { manifest: { inject: "inject.bin" }, files: { "inject.bin": { text: Buffer.from([0xff, 0xfe, 0x00]) } } },
      "acme.missing": { manifest: { inject: "injects/gone.md" }, files: {} },
      "acme.unsafe": { manifest: { inject: "../outside.md" }, files: {} },
      "acme.badskills": { manifest: { skills: ["nope"] }, files: {} },
      // Manifest paths as the install reads them: a backslash is a separator; a `.git` component is unsafe.
      "acme.backslash": { manifest: { inject: "injects\\guide.md", skills: ["skills\\x"] }, files: { "injects/guide.md": "guide\n", "skills/x/SKILL.md": "---\ndescription: x\n---\n" } },
      "acme.dotgit": { manifest: { inject: ".git/config" }, files: {} },
      "acme.dotgit2": { manifest: { inject: "injects/.GIT" }, files: {} },
      // The package's capability name, also a member's: a name without a selector is ambiguous.
      "acme-tool": { manifest: {}, files: {} },
      // Trigger sources (#669): shown as declared; a malformed one is a problem of the show, never a refusal.
      "acme.sources": { manifest: { commands: { poll: "bin/poll.mjs poll" }, triggerSources: SOURCES }, files: { "bin/poll.mjs": "process.exit(0)\n" } },
      "acme.badsources": { manifest: { commands: { poll: "bin/poll.mjs poll" }, triggerSources: BAD_SOURCES }, files: {} },
    },
  });
});
test.after(() => { fx?.cleanup(); pkg?.cleanup(); });

const show = (...argv) => fx.cli(["capabilities", "show", ...argv, "--json"]);

test("before `oats sync` a package's capabilities are not in the catalog: UNKNOWN; the member's row of the same name answers", () => {
  refused(show("acme-tool", "--package", "acme.pkg"), "E_CAPABILITY_UNKNOWN", "an unsynced package");
  assert.equal(ok(show("acme-tool")).kind, "member", "the only row of that name yet");
  assert.equal(fx.cli(["sync", "--json"]).status, 0);
  catalogRows = ok(fx.cli(["capabilities", "--json"])).capabilities;
});

test("a member capability: the full document at the catalog row's commit; paths relative to the capability; the inject exactly as committed", () => {
  const doc = ok(show("acme.tool"));
  const row = catalogRows.find((r) => r.name === "acme.tool");
  assert.deepEqual(Object.keys(doc), ["capabilityShowApi", "name", "kind", "repoKey", "package", "version", "commit", "path", "inject", "skills", "problems", "warnings"]);
  assert.deepEqual(doc.warnings, [], "a capability that declares nothing this kernel ignores: none");
  assert.deepEqual({ api: doc.capabilityShowApi, name: doc.name, kind: doc.kind, repoKey: doc.repoKey, package: doc.package, version: doc.version, path: doc.path },
    { api: 1, name: "acme.tool", kind: "member", repoKey: fx.key, package: null, version: null, path: "capabilities/acme.tool" });
  assert.equal(doc.commit, row.commit, "the catalog row's commit");
  assert.deepEqual(doc.inject, { path: "injects/tool.md", bytes: Buffer.byteLength(INJECT), text: INJECT, binary: false, truncated: false }, "untrimmed, untemplated, BOM kept");
  assert.deepEqual(doc.skills.map((s) => s.name), row.skills, "the catalog row's skills, in its order");
  const skill = Object.fromEntries(doc.skills.map((s) => [s.name, s]));
  assert.deepEqual(skill.alpha, { name: "alpha", path: "skills/alpha", description: "Alpha does\ntwo lines.\n",
    files: [{ path: "skills/alpha/SKILL.md", bytes: size(ALPHA) }, { path: "skills/alpha/ref/nested/deep.md", bytes: 5 }], filesTruncated: false },
    "nested files listed; the symlink is not");
  assert.deepEqual(skill.beta.files, [
    { path: "skills/beta/SKILL.md", bytes: size("No front matter.\n") }, { path: "skills/beta/big.md", bytes: BIG.length }, { path: "skills/beta/data.bin", bytes: 4 },
    { path: "skills/beta/exact.md", bytes: TEXT_LIMIT }, { path: "skills/beta/huge.txt", bytes: FILE_BUDGET + 1 }], "codepoint order; a file over the read budget listed with its size");
  assert.equal(skill.beta.description, null, "no front matter");
  assert.equal(skill.delta.description, null, "a non-string description");
  assert.equal(skill.gamma.description, "d".repeat(DESCRIPTION_LIMIT - 2), "cut to 1 KiB before the straddling €");
  assert.equal(skill.epsilon.description, "This is valid.", "front matter running past the display cut is read whole");
  assert.equal(skill.epsilon.files[0].bytes, size(LONG_FRONT_MATTER));
  assert.deepEqual(doc.problems, []);
  assert.ok(!JSON.stringify(doc).includes("scripts/run.mjs"), "nothing outside the inject and the skills");
  assertTextInvariants(doc.inject, "inject");
});

test("a package capability: read at the locked commit; repoKey is the repo it is read from; the commit equals the catalog row's", () => {
  const doc = ok(show("acme-tool", "--package", "acme.pkg"));
  const row = catalogRows.find((r) => r.name === "acme-tool" && r.kind === "package");
  const lock = JSON.parse(readFileSync(join(fx.dep, "oats-lock.json"), "utf8")).packages["acme.pkg"];
  assert.deepEqual({ kind: doc.kind, package: doc.package, version: doc.version, commit: doc.commit, path: doc.path, inject: doc.inject },
    { kind: "package", package: "acme.pkg", version: "1.0.0", commit: lock.commit, path: "oats-package/capabilities/acme-tool", inject: null });
  assert.equal(doc.commit, row.commit);
  assert.equal(doc.repoKey, `local/${pkg.bare}`);
  assert.deepEqual(doc.skills, [{ name: "tool-skill", path: "skills/tool-skill", description: "tool", files: [{ path: "skills/tool-skill/SKILL.md", bytes: size(PKG_SKILL) }], filesTruncated: false }]);
  assert.deepEqual(doc.skills.map((s) => s.name), row.skills);
  const file = ok(show("acme-tool", "--package", "acme.pkg", "--file", "skills/tool-skill/SKILL.md"));
  assert.deepEqual(file, { capabilityShowApi: 1, name: "acme-tool", kind: "package", commit: lock.commit,
    file: { path: "skills/tool-skill/SKILL.md", bytes: size(PKG_SKILL), text: PKG_SKILL, binary: false, truncated: false }, warnings: [] });
});

test("every catalog row answers, at its commit, with the catalog's skills (null exactly when the catalog's are)", () => {
  for (const row of catalogRows) {
    const doc = ok(show(row.name, ...(row.kind === "package" ? ["--package", row.package] : ["--member", row.repoKey])));
    assert.equal(doc.commit, row.commit, row.name);
    assert.deepEqual(doc.skills === null ? null : doc.skills.map((s) => s.name), row.skills, `${row.name}: skills`);
    for (const s of doc.skills ?? []) for (const f of s.files) assert.ok(!unsafeFilePath(f.path) && f.path.startsWith(`${s.path}/`), f.path);
  }
});

test("ambiguity and selectors: a name two rows share needs --member or --package; an unknown name or selector is UNKNOWN", () => {
  const e = refused(show("acme-tool"), "E_CAPABILITY_AMBIGUOUS", "member and package rows");
  assert.deepEqual(e.details.candidates.map((c) => c.kind).sort(), ["member", "package"]);
  assert.deepEqual(e.details.candidates.find((c) => c.kind === "member"), { kind: "member", repoKey: fx.key, origin: catalogRows.find((r) => r.name === "acme-tool" && r.kind === "member").origin });
  assert.deepEqual(e.details.candidates.find((c) => c.kind === "package"), { kind: "package", package: "acme.pkg", origin: "package acme.pkg v1.0.0" });
  assert.equal(ok(show("acme-tool", "--member", fx.key)).kind, "member");
  assert.equal(ok(show("acme-tool", "--member", fx.ref)).kind, "member", "any ref spelling of the member's repository");
  assert.deepEqual(refused(show("nope"), "E_CAPABILITY_UNKNOWN", "unknown name").details, { name: "nope" });
  assert.deepEqual(refused(show("acme-tool", "--package", "acme.other"), "E_CAPABILITY_UNKNOWN", "unknown package").details, { name: "acme-tool", package: "acme.other" });
  assert.deepEqual(refused(show("acme-tool", "--member", "github.com/acme/other"), "E_CAPABILITY_UNKNOWN", "unknown member").details, { name: "acme-tool", member: "github.com/acme/other" });
  refused(show("acme.tool", "--package", "acme.pkg"), "E_CAPABILITY_UNKNOWN", "a member capability under --package");
});

test("inject edge cases: declared but missing, binary, an unsafe declared path — the show still answers, with a problem", () => {
  const missing = ok(show("acme.missing"));
  assert.deepEqual(missing.inject, { path: "injects/gone.md", bytes: null, text: null, binary: false, truncated: false });
  assert.deepEqual(missing.problems.map((p) => [p.code, p.path]), [["E_REMOTE_PATH_MISSING", "injects/gone.md"]]);
  assertTextInvariants(missing.inject, "missing inject");
  const binary = ok(show("acme.binject"));
  assert.deepEqual(binary.inject, { path: "inject.bin", bytes: 3, text: null, binary: true, truncated: false });
  assert.deepEqual(binary.problems, []);
  const unsafe = ok(show("acme.unsafe"));
  assert.deepEqual(unsafe.inject, { path: null, bytes: null, text: null, binary: false, truncated: false }, "an unsafe string never sits in a path field");
  assert.equal(unsafe.problems.length, 1);
  assert.deepEqual([unsafe.problems[0].code, unsafe.problems[0].path], ["E_CAPABILITY_MISSING", null], "spawn's code for it");
  assert.ok(unsafe.problems[0].message.includes(JSON.stringify("../outside.md")), "the raw value only inside the message");
  assert.equal(ok(show("acme.many")).inject, null, "no inject declared");
});

test("triggerSources: shown exactly as declared; a malformed declaration adds triggerSourceProblems and never refuses the show or the catalog", () => {
  const doc = ok(show("acme.sources"));
  assert.deepEqual(doc.triggerSources, SOURCES, "as declared, patterns as strings");
  assert.equal("triggerSourceProblems" in doc, false, "no problems: no key");
  assert.deepEqual(Object.keys(doc).slice(-2), ["warnings", "triggerSources"], "an added key, after the existing ones");
  const bad = ok(show("acme.badsources"));
  assert.deepEqual(bad.triggerSources, BAD_SOURCES);
  assert.deepEqual(bad.triggerSourceProblems.map((p) => [p.source, p.pointer]), [["bad", "/triggerSources/bad/command"], ["bad", "/triggerSources/bad/events/0"]], "only the malformed source");
  assert.ok(bad.triggerSourceProblems.every((p) => typeof p.message === "string" && p.message.startsWith('trigger source "bad": ')));
  assert.deepEqual(bad.problems, [], "the show's own problems are unchanged");
  assert.ok(catalogRows.some((r) => r.name === "acme.badsources"), "the catalog lists the capability: discovery does not refuse it");
  assert.equal("triggerSources" in ok(show("acme.many")), false, "a manifest without triggerSources answers exactly as before");
});

test("manifest paths: a backslash reads as a separator (the answer's paths are safe POSIX, and --file reads them); a `.git` component is an unsafe declaration", () => {
  const doc = ok(show("acme.backslash"));
  assert.deepEqual(doc.inject, { path: "injects/guide.md", bytes: 6, text: "guide\n", binary: false, truncated: false });
  assert.deepEqual(doc.skills.map((s) => [s.path, s.files.map((f) => f.path)]), [["skills/x", ["skills/x/SKILL.md"]]]);
  assert.deepEqual(doc.problems, []);
  assert.equal(ok(show("acme.backslash", "--file", "skills/x/SKILL.md")).file.text, "---\ndescription: x\n---\n");
  assert.equal(ok(show("acme.backslash", "--file", "injects/guide.md")).file.text, "guide\n");
  for (const [name, raw] of [["acme.dotgit", ".git/config"], ["acme.dotgit2", "injects/.GIT"]]) {
    const d = ok(show(name));
    assert.deepEqual(d.inject, { path: null, bytes: null, text: null, binary: false, truncated: false }, name);
    assert.deepEqual(d.problems.map((p) => [p.code, p.path]), [["E_CAPABILITY_MISSING", null]], name);
    assert.ok(d.problems[0].message.includes(JSON.stringify(raw)), name);
  }
  // Every path anywhere in every answer is a safe POSIX path.
  for (const row of catalogRows) {
    const d = ok(show(row.name, ...(row.kind === "package" ? ["--package", row.package] : ["--member", row.repoKey])));
    const paths = [d.inject?.path, ...(d.skills ?? []).flatMap((s) => [s.path, ...(s.files ?? []).map((f) => f.path)]), ...d.problems.map((p) => p.path)].filter((p) => p !== null && p !== undefined);
    for (const p of paths) assert.equal(unsafeFilePath(p), false, `${row.name}: ${p}`);
  }
});

test("declared skills that cannot be enumerated: skills null with spawn's problem, as the catalog row's", () => {
  const doc = ok(show("acme.badskills"));
  assert.equal(doc.skills, null);
  assert.equal(catalogRows.find((r) => r.name === "acme.badskills").skills, null);
  assert.deepEqual(doc.problems.map((p) => [p.code, p.path]), [["E_CAPABILITY_MISSING", null]]);
});

test("a skill with 201 files lists the first 200 (codepoint order), filesTruncated; --file past the cap is UNKNOWN", () => {
  const [skill] = ok(show("acme.many")).skills;
  assert.equal(skill.files.length, FILES_PER_SKILL);
  assert.equal(skill.filesTruncated, true);
  assert.deepEqual(skill.files.slice(0, 2).map((f) => f.path), ["skills/many/SKILL.md", "skills/many/f000.md"], "uppercase sorts first (codepoint order)");
  assert.equal(skill.files.at(-1).path, "skills/many/f198.md");
  assert.deepEqual(ok(show("acme.many", "--file", "skills/many/f198.md")).file.text, "198\n");
  refused(show("acme.many", "--file", "skills/many/f199.md"), "E_CAPABILITY_FILE_UNKNOWN", "the 201st file");
});

test("--file: a listed file's text, binary, exactly the limit, cut on a code point boundary; the inject; over the read budget refused by the remote", () => {
  const head = { capabilityShowApi: 1, name: "acme.tool", kind: "member", commit: catalogRows.find((r) => r.name === "acme.tool").commit };
  const file = (path) => { const d = ok(show("acme.tool", "--file", path)); assert.deepEqual(Object.keys(d), ["capabilityShowApi", "name", "kind", "commit", "file", "warnings"]); assert.deepEqual({ ...d, file: undefined }, { ...head, file: undefined, warnings: [] }); assertTextInvariants(d.file, path); return d.file; };
  assert.deepEqual(file("skills/alpha/ref/nested/deep.md"), { path: "skills/alpha/ref/nested/deep.md", bytes: 5, text: "deep\n", binary: false, truncated: false });
  assert.deepEqual(file("injects/tool.md"), { path: "injects/tool.md", bytes: Buffer.byteLength(INJECT), text: INJECT, binary: false, truncated: false });
  assert.deepEqual(file("skills/beta/data.bin"), { path: "skills/beta/data.bin", bytes: 4, text: null, binary: true, truncated: false });
  const exact = file("skills/beta/exact.md");
  assert.deepEqual([exact.bytes, exact.text.length, exact.truncated], [TEXT_LIMIT, TEXT_LIMIT, false]);
  const big = file("skills/beta/big.md");
  assert.deepEqual([big.bytes, Buffer.byteLength(big.text), big.truncated, big.binary], [TEXT_LIMIT + 1, TEXT_LIMIT - 1, true, false], "bytes is the real size; é straddling the cut is dropped");
  const over = refused(show("acme.tool", "--file", "skills/beta/huge.txt"), "E_REMOTE_FILE_OVERSIZE", "over the 4 MiB read budget");
  assert.equal(over.details.path, "capabilities/acme.tool/skills/beta/huge.txt", "the remote's refusal, unchanged (repository-relative path)");
});

test("--file refusals: unsafe paths, paths the show does not list (a symlink, oats.json, scripts), all before any content is read", () => {
  for (const path of ["../oats.json", "/etc/passwd", "skills/x/../../oats.json", "skills/alpha/", "./injects/tool.md", ".git/config", "skills\\alpha\\SKILL.md"]) {
    assert.deepEqual(refused(show("acme.tool", "--file", path), "E_CAPABILITY_FILE_UNSAFE", path).details, { path });
  }
  for (const path of ["oats.json", "scripts/run.mjs", "skills/alpha/link.md", "skills/alpha", "skills/nope/SKILL.md"]) {
    assert.deepEqual(refused(show("acme.tool", "--file", path), "E_CAPABILITY_FILE_UNKNOWN", path).details, { path, name: "acme.tool" });
  }
  // A declared inject the show cannot read is still the inject path: the remote says why.
  refused(show("acme.missing", "--file", "injects/gone.md"), "E_REMOTE_PATH_MISSING", "a declared, missing inject");
});

test("a package whose lock lists a capability its manifest at the locked commit lacks: E_PACKAGE_INTEGRITY, as spawn", () => {
  const file = join(fx.dep, "oats-lock.json");
  const saved = readFileSync(file, "utf8");
  try {
    const lock = JSON.parse(saved);
    lock.packages["acme.pkg"].capabilities = [...lock.packages["acme.pkg"].capabilities, "acme-ghost"];
    writeFileSync(file, JSON.stringify(lock, null, 2));
    const e = refused(show("acme-ghost"), "E_PACKAGE_INTEGRITY", "a capability the manifest lacks");
    assert.deepEqual({ why: e.details.why, listed: e.details.listed, locked: e.details.locked }, { why: "capabilities", listed: ["acme-tool"], locked: ["acme-ghost", "acme-tool"] });
    refused(show("acme-tool", "--package", "acme.pkg"), "E_PACKAGE_INTEGRITY", "a list that disagrees refuses every capability of the package");
  } finally { writeFileSync(file, saved); }
});

test("--max-age adds the observation block to both answers, and only then", () => {
  const plain = ok(show("acme.tool"));
  assert.equal(plain.observation, undefined);
  for (const argv of [["acme.tool"], ["acme.tool", "--file", "injects/tool.md"]]) {
    const aged = ok(show(...argv, "--max-age", "60"));
    assert.deepEqual(Object.keys(aged.observation), ["observedAt", "reused", "localRevision"], argv.join(" "));
    assert.equal(aged.commit, plain.commit);
  }
  assert.equal(ok(show("acme.tool", "--file", "injects/tool.md")).observation, undefined);
});

test("argv refusals are one E_BAD_ARGS envelope: no name, two names, both selectors, --server, a flag without a value, an unknown flag or subcommand", () => {
  for (const argv of [
    ["capabilities", "show"], ["capabilities", "show", "a", "b"], ["capabilities", "show", "acme.tool", "--member", fx.key, "--package", "acme.pkg"],
    ["capabilities", "show", "acme.tool", "--server", "http://127.0.0.1:9"], ["capabilities", "show", "acme.tool", "--file"], ["capabilities", "show", "acme.tool", "--member"],
    ["capabilities", "show", "acme.tool", "--nope"], ["capabilities", "nope"], ["capabilities", "--dir", fx.dep, "nope"],
  ]) refused(fx.cli([...argv, "--json"]), "E_BAD_ARGS", argv.join(" "));
  // `oats capabilities` itself is unchanged.
  assert.deepEqual(Object.keys(ok(fx.cli(["capabilities", "--json"]))), ["capabilitiesApi", "workspace", "capabilities", "problems"]);
});

test("without --json: an operator listing; --file prints the text, or a one-line note", () => {
  const listing = fx.cli(["capabilities", "show", "acme.tool"]);
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, /^acme\.tool — member .* @ [0-9a-f]{8}, capabilities\/acme\.tool\n/);
  assert.match(listing.stdout, /\n {2}inject: injects\/tool\.md \(\d+ B\)\n/);
  assert.match(listing.stdout, new RegExp(String.raw`\n {4}alpha {2}skills\/alpha\n {6}skills\/alpha\/SKILL\.md {2}${size(ALPHA)} B\n {6}skills\/alpha\/ref\/nested\/deep\.md {2}5 B\n`));
  const text = fx.cli(["capabilities", "show", "acme.tool", "--file", "skills/alpha/ref/nested/deep.md"]);
  assert.deepEqual([text.status, text.stdout], [0, "deep\n"]);
  const bin = fx.cli(["capabilities", "show", "acme.tool", "--file", "skills/beta/data.bin"]);
  assert.match(bin.stdout, /^\(skills\/beta\/data\.bin: binary, 4 B — not shown\)\n$/);
  const cut = fx.cli(["capabilities", "show", "acme.tool", "--file", "skills/beta/big.md"]);
  assert.match(cut.stdout, /\n\(skills\/beta\/big\.md: truncated — 256\.0 KiB, the first 256\.0 KiB shown\)\n$/);
  const bad = fx.cli(["capabilities", "show", "nope"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^oats: no capability "nope"/);
});

test("a skill whose files cannot be listed (an unsafe name deep in its tree, before or past the 200 cap): files null with the problem; --file under it is UNKNOWN", (t) => {
  const crowded = Object.fromEntries(Array.from({ length: FILES_PER_SKILL + 1 }, (_, i) => [`skills/crowded/f${String(i).padStart(3, "0")}.md`, `${i}\n`]));
  const f = v2Deployment({ capabilities: { "acme.hostile": { manifest: { skills: ["skills"] }, files: { "skills/ok/SKILL.md": "---\ndescription: ok\n---\n", "skills/bad/SKILL.md": "---\ndescription: bad\n---\n",
    "skills/crowded/SKILL.md": "---\ndescription: crowded\n---\n", ...crowded } } } });
  t.after(f.cleanup);
  // Graft skills/bad/deep/x/.git into the member's HEAD tree (git's transport does not fsck entry names).
  const seed = join(f.base, "seed");
  // commit-tree needs an identity: CI runners have none configured.
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const run = (input, ...args) => execFileSync("git", args, { cwd: seed, input, env, stdio: ["pipe", "pipe", "pipe"] }).toString("utf8").trim();
  const mkTree = (entries) => run(Buffer.concat(entries.sort((a, b) => Buffer.compare(Buffer.from(a.name + (a.mode === "040000" ? "/" : "")), Buffer.from(b.name + (b.mode === "040000" ? "/" : ""))))
    .map(({ mode, name, oid }) => Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(oid, "hex")]))), "hash-object", "-w", "-t", "tree", "--stdin", "--literally");
  const entries = (tree) => run("", "ls-tree", tree).split("\n").map((l) => { const [meta, name] = l.split("\t"); const [mode, , oid] = meta.split(" "); return { mode: mode === "40000" ? "040000" : mode, name, oid }; });
  const graft = (tree, [head, ...rest], leaf) => {
    const list = entries(tree);
    if (!rest.length) return mkTree([...list.filter((e) => e.name !== head), leaf]);
    const sub = list.find((e) => e.name === head);
    const child = sub ? graft(sub.oid, rest, leaf) : mkTree([leaf]);
    return mkTree([...list.filter((e) => e.name !== head), { mode: "040000", name: head, oid: child }]);
  };
  const blob = run("evil\n", "hash-object", "-w", "--stdin");
  const hostileLeaf = (names) => names.reduceRight((leaf, name) => ({ mode: "040000", name, oid: mkTree([leaf]) }), { mode: "100644", name: ".git", oid: blob });
  // skills/crowded/zzz/.git sorts after its first 200 files: the scan still covers every entry (#409).
  const tree = graft(graft(run("", "rev-parse", "HEAD^{tree}"), ["capabilities", "acme.hostile", "skills", "bad", "deep"], hostileLeaf(["x"])),
    ["capabilities", "acme.hostile", "skills", "crowded", "(leaf)"], hostileLeaf(["zzz"])); // graft adds the leaf beside the path's last name
  const commit = run("", "commit-tree", tree, "-p", "HEAD", "-m", "hostile");
  git(seed, "push", "-q", "origin", `${commit}:main`);
  const doc = ok(f.cli(["capabilities", "show", "acme.hostile", "--json"]));
  assert.equal(doc.commit, commit);
  const skill = Object.fromEntries(doc.skills.map((s) => [s.name, s]));
  assert.deepEqual([skill.bad.files, skill.bad.filesTruncated], [null, false], "could not list ≠ listed nothing");
  assert.deepEqual(skill.ok.files, [{ path: "skills/ok/SKILL.md", bytes: size("---\ndescription: ok\n---\n") }]);
  assert.deepEqual([skill.crowded.files, skill.crowded.filesTruncated], [null, false], "a hostile name past the cap still makes the skill unlistable");
  assert.deepEqual(doc.problems.map((p) => [p.code, p.path]), [["E_REMOTE_TREE_UNSAFE", "skills/bad"], ["E_REMOTE_TREE_UNSAFE", "skills/crowded"]]);
  refused(f.cli(["capabilities", "show", "acme.hostile", "--file", "skills/crowded/f000.md", "--json"]), "E_CAPABILITY_FILE_UNKNOWN", "a file under a skill unlistable past the cap");
  refused(f.cli(["capabilities", "show", "acme.hostile", "--file", "skills/bad/SKILL.md", "--json"]), "E_CAPABILITY_FILE_UNKNOWN", "a file under an unlistable skill");
  assert.equal(ok(f.cli(["capabilities", "show", "acme.hostile", "--file", "skills/ok/SKILL.md", "--json"])).file.text, "---\ndescription: ok\n---\n");
});

test("a package's manifest paths: a backslash reads as a separator; a `.git` inject is an unsafe declaration with the package code", (t) => {
  const p = packageRepo({ id: "acme.paths" }); t.after(p.cleanup);
  writeFileSync(join(p.seed, "oats-package/capabilities/acme-tool/oats.json"), JSON.stringify({ capability: "acme-tool", version: "1.0.0", description: "tool", compatibility: { oats: ">=0.24.0" }, inject: ".GIT/x", skills: ["skills\\tool-skill"] }, null, 2));
  git(p.seed, "add", "-A"); git(p.seed, "commit", "-qm", "paths"); git(p.seed, "tag", "-f", "v1.0.0"); git(p.seed, "push", "-q", "-f", "origin", "HEAD:main", "v1.0.0");
  const f = v2Deployment({ workspace: { packages: { "acme.paths": `${p.ref}@v1.0.0` } } }); t.after(f.cleanup);
  assert.equal(f.cli(["sync", "--json"]).status, 0);
  const d = ok(f.cli(["capabilities", "show", "acme-tool", "--json"]));
  assert.deepEqual(d.inject, { path: null, bytes: null, text: null, binary: false, truncated: false });
  assert.deepEqual(d.problems.map((x) => [x.code, x.path]), [["E_PACKAGE_MANIFEST", null]]);
  assert.deepEqual(d.skills.map((s) => [s.path, s.files.map((x) => x.path)]), [["skills/tool-skill", ["skills/tool-skill/SKILL.md"]]]);
  assert.equal(ok(f.cli(["capabilities", "show", "acme-tool", "--file", "skills/tool-skill/SKILL.md", "--json"])).file.text, PKG_SKILL);
});
