// Feature soul-skills: `oats inspect --soul <soul> --skills` reports the soul's own skills, exactly the ones a
// spawn copies (skillEntriesIn), with each file's text by `capabilities show`'s rules (decodeText,
// skillDescription), under one text budget for the whole field (lib/instance-inspect.mjs soulSkills, withSkills).
//
// What is pinned here:
// - the answer's shape and order (codepoint order, not locale order), descriptions, binary and non-UTF-8 files,
//   the 200-file cut, the >4 MiB head, the 1 MiB budget (`omitted`, from the overflowing file on);
// - containment: no symlink is ever followed (a file, a nested directory, a skill directory, `skills/` itself,
//   one pointing outside), a FIFO is skipped without blocking, an unsafe name or an unreadable listed file makes
//   that skill's `files` null with a problem naming its path;
// - the CLI: the key only with --skills, --home refused, --skills with --instructions, the feature;
// - the names equal the soul-owned entries of `spawn --preview`'s skills[] for the same soul copy, and the one
//   case where they differ on purpose (a symlinked `skills/`, which spawn follows and this read does not).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fixtureBase } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { FILES_PER_SKILL, TEXT_LIMIT } from "../lib/capability-show.mjs";
import { inspectDocument, SOUL_SKILLS_TEXT_BUDGET, soulSkills, withSkills } from "../lib/instance-inspect.mjs";

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const doc = (description, body = "") => `---\nname: x\ndescription: ${description}\n---\n${body}`;

/** A soul directory under a fresh fixture base: spec { "<relpath>": string | Buffer | { symlink } | { fifo } }. */
function soulDir(t, spec) {
  const base = fixtureBase("oats-soul-skills-");
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, "soul");
  mkdirSync(dir, { recursive: true });
  for (const [rel, v] of Object.entries(spec)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    if (v && v.symlink !== undefined) symlinkSync(v.symlink, abs);
    else if (v && v.fifo) { const r = spawnSync("mkfifo", [abs]); assert.equal(r.status, 0, String(r.stderr)); }
    else if (v && v.dir) mkdirSync(abs, { recursive: true });
    else writeFileSync(abs, v);
  }
  return { base, dir };
}

/** The contract's invariants, over every file of an answer. */
function assertInvariants(skills) {
  for (const s of skills ?? []) {
    assert.deepEqual(Object.keys(s), ["name", "path", "description", "files", "filesTruncated"]);
    if (s.files === null) { assert.equal(s.filesTruncated, false); continue; }
    for (const f of s.files) {
      assert.deepEqual(Object.keys(f), f.omitted ? ["path", "bytes", "text", "binary", "truncated", "omitted"] : ["path", "bytes", "text", "binary", "truncated"], f.path);
      assert.ok(f.path.startsWith(`${s.path}/`), f.path);
      assert.equal(typeof f.bytes, "number");
      if (f.binary) { assert.equal(f.text, null); assert.equal(f.truncated, false); }
      if (f.truncated) assert.equal(typeof f.text, "string");
      if (f.text === null) assert.ok(f.binary || f.omitted === true, `${f.path}: text is null only when binary or omitted`);
      if (f.omitted) assert.deepEqual([f.text, f.binary, f.truncated, f.omitted], [null, false, false, true]);
    }
  }
}
async function listed(dir) {
  const r = await soulSkills(dir);
  assertInvariants(r.skills);
  return r;
}
const textFile = (path, text) => ({ path, bytes: Buffer.byteLength(text), text, binary: false, truncated: false });

test("soulSkills: no skills/ and an empty one are [], as is one with no SKILL.md anywhere", async (t) => {
  assert.deepEqual(await listed(soulDir(t, { "AGENTS.md": "# x\n" }).dir), { skills: [], problems: [] });
  assert.deepEqual(await listed(soulDir(t, { "skills": { dir: true } }).dir), { skills: [], problems: [] });
  assert.deepEqual(await listed(soulDir(t, { "skills/notes/README.md": "no skill\n", "skills/deep/a/SKILL.md": doc("too deep") }).dir), { skills: [], problems: [] });
});

test("soulSkills: two skills with references, in codepoint order (not locale order), every regular file by full path, descriptions from the front matter", async (t) => {
  const { dir } = soulDir(t, {
    "skills/alpha/SKILL.md": doc("Alpha — ü", "Body.\n"),
    "skills/alpha/references/x.md": "x\n",
    "skills/alpha/references-b.md": "b\n",
    "skills/alpha/references/sub/y.md": "y\n",
    "skills/Zeta/SKILL.md": "no front matter\n",
    "skills/Zeta/é.md": "accent\n",
    "skills/Zeta/z.md": "z\n",
    "skills/notes/README.md": "not a skill\n",
  });
  const { skills, problems } = await listed(dir);
  assert.deepEqual(problems, []);
  assert.deepEqual(skills, [
    { name: "Zeta", path: "skills/Zeta", description: null, filesTruncated: false, files: [
      textFile("skills/Zeta/SKILL.md", "no front matter\n"), textFile("skills/Zeta/z.md", "z\n"), textFile("skills/Zeta/é.md", "accent\n")] },
    { name: "alpha", path: "skills/alpha", description: "Alpha — ü", filesTruncated: false, files: [
      textFile("skills/alpha/SKILL.md", doc("Alpha — ü", "Body.\n")), textFile("skills/alpha/references-b.md", "b\n"),
      textFile("skills/alpha/references/sub/y.md", "y\n"), textFile("skills/alpha/references/x.md", "x\n")] },
  ]);
});

test("soulSkills: a skills/ that holds SKILL.md itself is one skill, the tree, as spawn names it", async (t) => {
  const { skills } = await listed(soulDir(t, { "skills/SKILL.md": doc("whole"), "skills/a.md": "a\n" }).dir);
  assert.deepEqual(skills.map((s) => [s.name, s.path, s.description, s.files.map((f) => f.path)]), [["skills", "skills", "whole", ["skills/SKILL.md", "skills/a.md"]]]);
});

test("soulSkills: binary and non-UTF-8 files are binary (text null, not truncated); a binary SKILL.md is listed with description null", async (t) => {
  const { dir } = soulDir(t, {
    "skills/b/SKILL.md": Buffer.from("---\ndescription: hidden\n---\n\0"),
    "skills/b/nul.bin": Buffer.from([1, 0, 2]),
    "skills/b/latin1.txt": Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]),
  });
  const [b] = (await listed(dir)).skills;
  assert.equal(b.description, null);
  assert.deepEqual(b.files, [
    { path: "skills/b/SKILL.md", bytes: 29, text: null, binary: true, truncated: false },
    { path: "skills/b/latin1.txt", bytes: 5, text: null, binary: true, truncated: false },
    { path: "skills/b/nul.bin", bytes: 3, text: null, binary: true, truncated: false },
  ]);
});

test("soulSkills: a 300-file skill lists the first 200 in codepoint order, filesTruncated", async (t) => {
  const spec = { "skills/many/SKILL.md": doc("many") };
  for (let i = 0; i < 299; i++) spec[`skills/many/f${String(i).padStart(3, "0")}.md`] = `${i}\n`;
  const [many] = (await listed(soulDir(t, spec).dir)).skills;
  assert.equal(many.files.length, FILES_PER_SKILL);
  assert.equal(many.filesTruncated, true);
  assert.deepEqual(many.files.map((f) => f.path), ["skills/many/SKILL.md", ...Array.from({ length: 199 }, (_, i) => `skills/many/f${String(i).padStart(3, "0")}.md`)]);
});

test("soulSkills: a file over 4 MiB is listed with its real size and its first TEXT_LIMIT bytes; a SKILL.md that large has no description", async (t) => {
  const huge = 4 * 1024 * 1024 + 7;
  const { dir } = soulDir(t, {
    "skills/big/SKILL.md": doc("big") + "é".repeat(huge / 2),
    "skills/big/huge.md": "a".repeat(TEXT_LIMIT - 1) + "é" + "b".repeat(huge),
  });
  const [big] = (await listed(dir)).skills;
  assert.equal(big.description, null, "parsed from at most 4 MiB, as capabilities show reads a SKILL.md");
  const [skillMd, file] = big.files;
  assert.equal(skillMd.truncated, true);
  assert.equal(file.bytes, TEXT_LIMIT - 1 + 2 + huge);
  assert.equal(file.text, "a".repeat(TEXT_LIMIT - 1), "cut on the code point boundary below TEXT_LIMIT");
  assert.equal(file.truncated, true);
  assert.equal(file.binary, false);
});

test("soulSkills: the field's text budget is 1 MiB in answer order — the overflowing file and every file after it are omitted, a binary costs nothing; exactly the budget fits", async (t) => {
  const skillMd = doc("budget");
  const full = "x".repeat(TEXT_LIMIT);
  const over = await listed(soulDir(t, {
    "skills/a/SKILL.md": skillMd, "skills/a/f1.md": full, "skills/a/f2.md": full, "skills/a/f3.bin": Buffer.alloc(TEXT_LIMIT * 2), "skills/a/f4.md": full,
    "skills/a/f5.md": full, "skills/a/f6.bin": Buffer.from([0]), "skills/a/f7.md": "small\n",
    "skills/b/SKILL.md": doc("after the budget"), "skills/b/g.md": "g\n",
  }).dir);
  const [a, b] = over.skills;
  assert.deepEqual(a.files.map((f) => [f.path.slice(9), f.omitted === true]), [["SKILL.md", false], ["f1.md", false], ["f2.md", false], ["f3.bin", false], ["f4.md", false], ["f5.md", true], ["f6.bin", true], ["f7.md", true]]);
  assert.deepEqual(a.files[3], { path: "skills/a/f3.bin", bytes: TEXT_LIMIT * 2, text: null, binary: true, truncated: false });
  assert.deepEqual(a.files[5], { path: "skills/a/f5.md", bytes: TEXT_LIMIT, text: null, binary: false, truncated: false, omitted: true });
  assert.ok(b.files.every((f) => f.omitted === true));
  assert.equal(b.description, "after the budget", "a description is not text of the budget");
  const spent = [...a.files, ...b.files].reduce((n, f) => n + (f.text === null ? 0 : Buffer.byteLength(f.text)), 0);
  assert.ok(spent <= SOUL_SKILLS_TEXT_BUDGET);

  const exact = await listed(soulDir(t, {
    "skills/a/SKILL.md": skillMd, "skills/a/f1.md": full, "skills/a/f2.md": full, "skills/a/f3.md": full,
    "skills/a/f4.md": "y".repeat(SOUL_SKILLS_TEXT_BUDGET - 3 * TEXT_LIMIT - Buffer.byteLength(skillMd)),
  }).dir);
  assert.ok(exact.skills[0].files.every((f) => !Object.hasOwn(f, "omitted")), "a sum equal to the budget is not past it");
});

test("soulSkills never follows a symlink: a file, a nested directory, one pointing outside, a skill directory; a FIFO is skipped without blocking", async (t) => {
  const { base, dir } = soulDir(t, {
    "skills/s/SKILL.md": doc("s"),
    "skills/s/real.md": "real\n",
    "skills/s/alias.md": { symlink: "real.md" },
    "skills/s/nested/inner.md": "inner\n",
    "skills/s/nested-link": { symlink: "nested" },
    "skills/s/out.md": { symlink: "../../../outside/secret.md" },
    "skills/s/out-dir": { symlink: "../../../outside" },
    "skills/s/pipe": { fifo: true },
    "skills/linked": { symlink: "s" },
    "skills/away": { symlink: "../../outside" },
  });
  mkdirSync(join(base, "outside"));
  writeFileSync(join(base, "outside", "secret.md"), "SECRET\n");
  writeFileSync(join(base, "outside", "SKILL.md"), doc("SECRET"));
  const r = await listed(dir);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.skills.map((s) => s.name), ["s"], "a symlinked skill directory is not a skill");
  assert.deepEqual(r.skills[0].files.map((f) => f.path), ["skills/s/SKILL.md", "skills/s/nested/inner.md", "skills/s/real.md"]);
  assert.ok(!JSON.stringify(r).includes("SECRET"), "nothing outside the skill was read");
});

test("soulSkills: a symlinked SKILL.md is not read (description null) and not listed, yet the skill is spawn's", async (t) => {
  const { dir } = soulDir(t, { "skills/s/real.md": doc("through a link"), "skills/s/SKILL.md": { symlink: "real.md" } });
  const [s] = (await listed(dir)).skills;
  assert.equal(s.description, null);
  assert.deepEqual(s.files.map((f) => f.path), ["skills/s/real.md"]);
});

test("soulSkills: a symlinked skills/ is not followed — null with one problem saying so", async (t) => {
  const { base, dir } = soulDir(t, { "skills": { symlink: "../shared" } });
  mkdirSync(join(base, "shared", "s"), { recursive: true });
  writeFileSync(join(base, "shared", "s", "SKILL.md"), doc("shared"));
  const r = await listed(dir);
  assert.equal(r.skills, null);
  assert.equal(r.problems.length, 1);
  assert.deepEqual(Object.keys(r.problems[0]), ["code", "message"]);
  assert.equal(r.problems[0].code, "soul-skills-unreadable");
  assert.match(r.problems[0].message, /^skills: .*skills\/ is a symbolic link/);
  // A file where the directory belongs cannot be listed either: null, not [].
  const file = await listed(soulDir(t, { "skills": "not a directory\n" }).dir);
  assert.equal(file.skills, null);
  assert.match(file.problems[0].message, /^skills: .*not a directory/);
});

test("soulSkills: an unsafe name (a control character, .git in any case, a backslash) makes that skill's files null with a problem naming its path; the others are listed", async (t) => {
  for (const bad of ["bad\u0001name.md", ".GIT/config", "back\\slash.md", "new\nline.md"]) {
    const { dir } = soulDir(t, { "skills/a/SKILL.md": doc("a"), [`skills/a/${bad}`]: "x\n", "skills/b/SKILL.md": doc("b") });
    const { skills, problems } = await listed(dir);
    assert.deepEqual(skills.map((s) => [s.name, s.description, s.files === null, s.filesTruncated]), [["a", "a", true, false], ["b", "b", false, false]], JSON.stringify(bad));
    assert.equal(problems.length, 1);
    assert.equal(problems[0].code, "soul-skill-files-unreadable");
    assert.ok(problems[0].message.startsWith("skills: skills/a: could not list its files: "), problems[0].message);
  }
});

test("soulSkills: a listed file that cannot be read makes its skill's files null with a problem naming the skill — never a text-less file", { skip: isRoot && "root reads a mode-000 file" }, async (t) => {
  const { dir } = soulDir(t, { "skills/a/SKILL.md": doc("a"), "skills/a/locked.md": "locked\n", "skills/b/SKILL.md": doc("b") });
  const locked = join(dir, "skills", "a", "locked.md");
  chmodSync(locked, 0o000);
  let answer;
  try { answer = await listed(dir); } finally { chmodSync(locked, 0o644); }
  const { skills, problems } = answer;
  assert.deepEqual(skills.map((s) => [s.name, s.files === null]), [["a", true], ["b", false]]);
  assert.equal(skills[0].description, "a");
  assert.equal(problems.length, 1);
  assert.equal(problems[0].code, "soul-skill-files-unreadable");
  assert.match(problems[0].message, /^skills: skills\/a: could not list its files: could not read skills\/a\/locked\.md \(EACCES\)$/);
  // The skill whose files are not listed spends nothing of the budget.
  assert.deepEqual(skills[1].files.map((f) => f.path), ["skills/b/SKILL.md"]);
});

test("withSkills: a soul target gets skills (and skillsProblems); a copy error or an unresolved soul is null with no added problem; a home is untouched; the document carries both", async (t) => {
  const { dir } = soulDir(t, { "skills/a/SKILL.md": doc("a"), "skills/a/bad\u0001.md": "x" });
  const target = (soul = {}, extra = {}) => ({ kind: "soul", deployment: "/d", prepared: {}, soul: { name: "dev", soulDir: dir, problems: [], ...soul }, home: null, meta: null, modules: [], slots: {}, payloads: {}, turnedOff: [], workspace: null, subject: { kind: "soul", soul: "dev" }, ...extra });
  const got = await withSkills(target());
  assert.deepEqual(got.skills.map((s) => s.name), ["a"]);
  assert.equal(got.skillsProblems.length, 1);
  const d = inspectDocument(got, { kernel: "0.0.0" });
  assert.deepEqual(d.souls[0].skills, got.skills);
  assert.deepEqual(d.problems, got.skillsProblems);

  const copyError = { code: "E_SOUL_COPY_FAILED", message: "cannot copy" };
  const failed = await withSkills(target({ copyError, soulDir: null }));
  assert.equal(failed.skills, null);
  assert.equal(failed.skillsProblems, undefined);
  assert.deepEqual(inspectDocument(failed, { kernel: "0.0.0" }).problems, [copyError], "the copy's own problem, no second one");
  const unresolved = await withSkills(target({}, { prepared: null }));
  assert.equal(unresolved.skills, null);
  assert.equal(unresolved.skillsProblems, undefined);

  const home = { kind: "instance", soul: { name: "dev", soulDir: dir } };
  assert.equal(await withSkills(home), home);
  assert.equal(Object.hasOwn(inspectDocument(target(), { kernel: "0.0.0" }).souls[0], "skills"), false, "absent unless asked for");
});

// ---- the CLI ----------------------------------------------------------------------------------------------

function okResult(r, what) {
  assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1, `${what}: one envelope: ${r.stdout}`);
  const j = JSON.parse(lines[0]);
  assert.equal(j.ok, true, `${what}: ${r.stdout}`);
  return j.result;
}
function refused(r, what) {
  assert.notEqual(r.status, 0, what);
  const j = JSON.parse(r.stdout.trim());
  assert.equal(j.ok, false, what);
  return j.error;
}
const skillsFixture = { dev: { skills: { review: { description: "Reviewing.", text: "Review it." }, deploy: { description: "Deploying." } } } };

test("inspect --soul --skills: the key only when asked; --home refused like --instructions; a switch; combined with --instructions; the feature is advertised", (t) => {
  const fx = v2Deployment({ souls: skillsFixture, files: { "souls/dev/skills/review/references/checklist.md": "- [ ] tests\n" } });
  t.after(fx.cleanup);
  const plain = okResult(fx.cli(["inspect", "--soul", "dev", "--json"]), "inspect --soul");
  assert.equal(Object.hasOwn(plain.souls[0], "skills"), false, "the key is absent unless asked for");

  const result = okResult(fx.cli(["inspect", "--soul", "dev", "--skills", "--json"]), "inspect --soul --skills");
  const { skills, ...row } = result.souls[0];
  assert.deepEqual(row, plain.souls[0], "the rest of the soul row is plain inspect's");
  assertInvariants(skills);
  assert.deepEqual(skills.map((s) => [s.name, s.path, s.description, s.filesTruncated, s.files.map((f) => f.path)]), [
    ["deploy", "skills/deploy", "Deploying.", false, ["skills/deploy/SKILL.md"]],
    ["review", "skills/review", "Reviewing.", false, ["skills/review/SKILL.md", "skills/review/references/checklist.md"]],
  ]);
  assert.equal(skills[1].files[1].text, "- [ ] tests\n");
  assert.deepEqual(result.problems, plain.problems);

  const both = okResult(fx.cli(["inspect", "--soul", "dev", "--instructions", "--skills", "--json"]), "--instructions --skills");
  assert.ok(Object.hasOwn(both.souls[0], "composedInstructions"));
  assert.deepEqual(both.souls[0].skills, skills);

  const home = okResult(fx.cli(["spawn", "dev", "--purpose", "h", "--no-launch", "--json"]), "spawn").home;
  const e = refused(fx.cli(["inspect", "--home", home, "--skills", "--json"]), "--home --skills");
  assert.equal(e.code, "E_BAD_ARGS");
  assert.match(e.message, /^--skills lists a soul's own skills before a spawn: it takes --soul, not --home/);
  for (const arg of ["--skills=true", "--skills=false"]) {
    const v = refused(fx.cli(["inspect", "--soul", "dev", arg, "--json"]), arg);
    assert.equal(v.code, "E_BAD_ARGS");
    assert.match(v.message, /--skills takes no value/);
  }
  const version = JSON.parse(fx.cli(["version", "--json"]).stdout);
  assert.ok(version.features.includes("soul-skills"));
});

test("the field's skill names are the soul-owned entries of spawn --preview's skills[] for the same soul copy; a symlinked skills/ is where they differ (null here, followed by spawn)", (t) => {
  const fx = v2Deployment({
    souls: { dev: { skills: { alpha: {}, beta: {}, Gamma: {} } } },
    files: { "souls/dev/skills/notes/README.md": "a directory without SKILL.md\n" },
  });
  t.after(fx.cleanup);
  const names = () => {
    const r = okResult(fx.cli(["inspect", "--soul", "dev", "--skills", "--json"]), "inspect --skills");
    return { r, names: r.souls[0].skills === null ? null : r.souls[0].skills.map((s) => s.name) };
  };
  const previewed = () => okResult(fx.cli(["spawn", "dev", "--preview", "--json"]), "spawn --preview").skills.filter((s) => typeof s === "string").sort();
  const sorted = (a) => [...a].sort();
  const first = names();
  assert.deepEqual(first.names, ["Gamma", "alpha", "beta"]);
  assert.deepEqual(sorted(first.names), previewed());

  // A soul source cannot carry a symlink (the fetch refuses it), so it is put into the soul copy both read.
  const copy = dirname(first.r.souls[0].instructions.file);
  symlinkSync("alpha", join(copy, "skills", "linked"));
  const linked = names();
  assert.deepEqual(linked.names, ["Gamma", "alpha", "beta"], "a symlinked skill directory is not a skill");
  assert.deepEqual(sorted(linked.names), previewed());

  // A symlinked skills/: spawn follows it (existsSync/readdirSync) and lists its skills; this read does not
  // follow it and answers null with a problem. The difference is deliberate and reported, not hidden.
  const shared = join(fx.base, "shared-skills");
  mkdirSync(join(shared, "delta"), { recursive: true });
  writeFileSync(join(shared, "delta", "SKILL.md"), doc("delta"));
  rmSync(join(copy, "skills"), { recursive: true });
  symlinkSync(shared, join(copy, "skills"));
  const followed = names();
  assert.equal(followed.names, null);
  assert.ok(followed.r.problems.some((p) => p.code === "soul-skills-unreadable" && /symbolic link/.test(p.message)));
  assert.deepEqual(previewed(), ["delta"], "spawn follows a symlinked skills/ (reported, not changed here)");
});
