// Feature soul-composed-skills: `oats inspect --soul <soul> --composed-skills` reports every skill an instance
// of the soul gets — its own and its capabilities' — from the same scratch materialization as --instructions
// (lib/soul-composition.mjs composeSoulInstructions `inScratch`, lib/instance-inspect.mjs composedSkillsIn,
// withComposition). awebai/oats#1421 §1.
//
// What is pinned here, over real deployments (test/helpers/v2-deployment.mjs) and real spawns:
// - the rows: one per skill a spawn gives, codepoint order by name, `source` "soul" | "module:<cap>", `path`
//   soul-relative or home-relative (`.oats/modules/<cap>/…`), and the --skills row shape otherwise; the names
//   are exactly the spawned home's .agents/skills and instance.json's skills, and spawn --preview's skills[];
// - a capability manifest whose entry is a root of skills (`skills: ["skills"]`): the preview names each skill
//   under it (the fix in the same change), not one named `skills`;
// - a collision a spawn refuses: null, with spawn's own sentence, which a real spawn gives;
// - a soul that cannot be composed: null with the composition's problem, per asked field;
// - one scratch composition serves --instructions and --composed-skills together;
// - the 2 MiB budget across both sources, in answer order;
// - the CLI: the key only when asked, --home refused, a switch, the feature advertised.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { fixtureBase } from "./helpers/host-fixture.mjs";
import { COMPOSED_SKILLS_TEXT_BUDGET, composedSkillCollision, composedSkillsIn, inspectDocument, withComposition } from "../lib/instance-inspect.mjs";

const SCRATCH = "oats-compose-home-";
const skillDoc = (name, description = name) => `---\nname: ${name}\ndescription: ${description}\n---\n\n${name} body.\n`;
/** acme.ops declares a ROOT of skills (`skills: ["skills"]`, the documented form) holding two skills. */
const ops = {
  "acme.ops": {
    manifest: { skills: ["skills"] },
    files: { "skills/deploy/SKILL.md": skillDoc("deploy", "Deploying."), "skills/deploy/notes.md": "notes\n", "skills/rollback/SKILL.md": skillDoc("rollback") },
  },
};
const withOps = (soul = {}) => ({ capabilities: { "acme.ops": { from: "here" } }, ...soul });

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
function privateTmp(fx, name) {
  const dir = join(fx.base, `tmp-${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The --skills row invariants, plus `source`. */
function assertRows(rows) {
  for (const s of rows) {
    assert.deepEqual(Object.keys(s), ["name", "source", "path", "description", "files", "filesTruncated"]);
    assert.match(s.source, /^(soul|module:.+)$/);
    if (s.source === "soul") assert.ok(s.path.startsWith("skills"), s.path);
    else assert.equal(s.path, `.oats/modules/${s.source.slice("module:".length)}/skills/${s.name}`);
    for (const f of s.files ?? []) assert.ok(f.path.startsWith(`${s.path}/`), f.path);
  }
}

test("inspect --soul --composed-skills: the soul's and its capabilities' skills, as a spawn gives them; the preview names the same skills", (t) => {
  const fx = v2Deployment({ t, capabilities: ops, souls: { dev: { soul: withOps(), skills: { review: { description: "Reviewing." }, Zeta: {} } } } });
  const tmp = privateTmp(fx, "inspect");
  const plain = okResult(fx.cli(["inspect", "--soul", "dev", "--json"]), "inspect --soul");
  assert.equal(Object.hasOwn(plain.souls[0], "composedSkills"), false, "the key is absent unless asked for");

  const result = okResult(fx.cli(["inspect", "--soul", "dev", "--composed-skills", "--json"], { env: { TMPDIR: tmp } }), "--composed-skills");
  assert.deepEqual(readdirSync(tmp).filter((n) => n.startsWith(SCRATCH)), [], "the scratch home is removed");
  const { composedSkills, ...row } = result.souls[0];
  assert.deepEqual(row, plain.souls[0], "the rest of the soul row is plain inspect's");
  assert.deepEqual(result.problems, plain.problems);
  assertRows(composedSkills);
  assert.deepEqual(composedSkills.map((s) => [s.name, s.source, s.path, s.description, s.files.map((f) => f.path)]), [
    ["Zeta", "soul", "skills/Zeta", "Zeta", ["skills/Zeta/SKILL.md"]],
    ["deploy", "module:acme.ops", ".oats/modules/acme.ops/skills/deploy", "Deploying.", [".oats/modules/acme.ops/skills/deploy/SKILL.md", ".oats/modules/acme.ops/skills/deploy/notes.md"]],
    ["review", "soul", "skills/review", "Reviewing.", ["skills/review/SKILL.md"]],
    ["rollback", "module:acme.ops", ".oats/modules/acme.ops/skills/rollback", "rollback", [".oats/modules/acme.ops/skills/rollback/SKILL.md"]],
  ]);
  assert.equal(composedSkills[1].files[1].text, "notes\n");

  // The spawn preview names the same skills: each capability skill under the declared root, not one named "skills".
  const preview = okResult(fx.cli(["spawn", "dev", "--preview", "--json"]), "spawn --preview");
  assert.deepEqual(preview.skills.filter((s) => typeof s === "object"), [{ name: "deploy", source: "module:acme.ops" }, { name: "rollback", source: "module:acme.ops" }]);
  const previewNames = preview.skills.map((s) => (typeof s === "string" ? s : s.name)).sort();
  assert.deepEqual(previewNames, composedSkills.map((s) => s.name).sort());

  // And a real spawn gives exactly these skills, from these sources.
  const spawned = okResult(fx.cli(["spawn", "dev", "--purpose", "x", "--no-launch", "--json"]), "spawn");
  assert.deepEqual(readdirSync(join(spawned.home, ".agents", "skills")).sort(), composedSkills.map((s) => s.name).sort());
  const meta = JSON.parse(readFileSync(join(spawned.home, "instance.json"), "utf8"));
  assert.deepEqual(meta.skills.map((s) => [s.name, s.source]).sort(), composedSkills.map((s) => [s.name, s.source]).sort());
  for (const s of composedSkills.filter((x) => x.source !== "soul")) {
    assert.equal(readFileSync(join(spawned.home, s.path, "SKILL.md"), "utf8"), s.files[0].text, `${s.path} is where the instance carries it`);
  }
});

test("inspect --composed-skills: --home refused; a switch; with --instructions both keys from one composition; the feature is advertised", async (t) => {
  const fx = v2Deployment({ t, capabilities: ops, souls: { dev: { soul: withOps(), skills: { review: {} } } } });
  const alone = okResult(fx.cli(["inspect", "--soul", "dev", "--composed-skills", "--json"]), "alone").souls[0].composedSkills;
  const both = okResult(fx.cli(["inspect", "--soul", "dev", "--instructions", "--composed-skills", "--skills", "--json"]), "with --instructions --skills").souls[0];
  assert.deepEqual(both.composedSkills, alone);
  assert.equal(typeof both.composedInstructions.text, "string");
  assert.deepEqual(both.skills.map((s) => s.name), ["review"], "--skills is still the soul's own");

  // One scratch materialization serves both fields.
  const target = await fx.inEnv(async () => (await import("../lib/instance-inspect.mjs")).soulTarget(fx.dep, "dev", { remoteOptions: fx.remoteOptions }));
  let calls = 0;
  const { composeSoulInstructions } = await import("../lib/soul-composition.mjs");
  const counted = (o) => { calls++; return composeSoulInstructions(o); };
  const composed = await fx.inEnv(() => withComposition(target, { instructions: true, skills: true, compose: counted }));
  assert.equal(calls, 1);
  assert.deepEqual(inspectDocument(composed, { kernel: "0.0.0" }).souls[0].composedSkills, alone);

  const home = okResult(fx.cli(["spawn", "dev", "--purpose", "h", "--no-launch", "--json"]), "spawn").home;
  const e = refused(fx.cli(["inspect", "--home", home, "--composed-skills", "--json"]), "--home --composed-skills");
  assert.equal(e.code, "E_BAD_ARGS");
  assert.match(e.message, /^--composed-skills lists the skills a spawn of a soul would give its instance: it takes --soul, not --home/);
  const v = refused(fx.cli(["inspect", "--soul", "dev", "--composed-skills=true", "--json"]), "--composed-skills=true");
  assert.equal(v.code, "E_BAD_ARGS");
  assert.match(v.message, /--composed-skills takes no value/);
  assert.ok(JSON.parse(fx.cli(["version", "--json"]).stdout).features.includes("soul-composed-skills"));
});

test("a soul skill that collides with a capability's: composedSkills null with spawn's own sentence, the one a real spawn refuses with", (t) => {
  const fx = v2Deployment({ t, capabilities: ops, souls: { dev: { soul: withOps(), skills: { Deploy: {} } } } });
  const result = okResult(fx.cli(["inspect", "--soul", "dev", "--composed-skills", "--json"]), "inspect");
  assert.equal(result.souls[0].composedSkills, null);
  const problem = result.problems.find((p) => p.code === "E_SKILL_DUPLICATE");
  assert.deepEqual(problem, { code: "E_SKILL_DUPLICATE", message: "composedSkills: skill \"Deploy\" from soul collides with module acme.ops's skill" });
  const e = refused(fx.cli(["spawn", "dev", "--purpose", "x", "--no-launch", "--json"]), "spawn");
  assert.equal(e.code, "E_SKILL_DUPLICATE");
  assert.equal(`composedSkills: ${e.message}`, problem.message, "the message is the one spawn gives");
});

test("composedSkillCollision: spawn's rule — case-insensitive, soul against capability skills and against the soul's others", () => {
  const mods = [{ module: "a.b", name: "deploy" }];
  assert.equal(composedSkillCollision([{ name: "review" }], mods), null);
  assert.deepEqual(composedSkillCollision([{ name: "DEPLOY" }], mods), { name: "DEPLOY", message: "skill \"DEPLOY\" from soul collides with module a.b's skill" });
  assert.deepEqual(composedSkillCollision([{ name: "Foo" }, { name: "foo" }], []), { name: "foo", message: "skill \"foo\" from soul collides with soul" });
});

test("a soul that cannot be composed: each asked field null, each with the composition's refusal naming it", async (t) => {
  const fx = v2Deployment({ t, capabilities: ops, souls: { dev: { soul: withOps() } } });
  const target = await fx.inEnv(async () => (await import("../lib/instance-inspect.mjs")).soulTarget(fx.dep, "dev", { remoteOptions: fx.remoteOptions }));
  const failing = async () => { throw Object.assign(new Error("cannot compose"), { code: "E_COMPOSITION_INCOMPLETE" }); };
  const only = inspectDocument(await withComposition(target, { skills: true, compose: failing }), { kernel: "0.0.0" });
  assert.equal(only.souls[0].composedSkills, null);
  assert.equal(Object.hasOwn(only.souls[0], "composedInstructions"), false);
  assert.ok(only.problems.some((p) => p.code === "E_COMPOSITION_INCOMPLETE" && p.message === "composedSkills: cannot compose"));
  const both = inspectDocument(await withComposition(target, { instructions: true, skills: true, compose: failing }), { kernel: "0.0.0" });
  assert.equal(both.souls[0].composedInstructions, null);
  assert.deepEqual(both.problems.filter((p) => p.code === "E_COMPOSITION_INCOMPLETE").map((p) => p.message), ["composedInstructions: cannot compose", "composedSkills: cannot compose"]);
});

test("composedSkillsIn: one 2 MiB text budget over both sources, in answer order; a symlinked soul skills/ is unreadable", (t) => {
  const base = fixtureBase("oats-composed-skills-");
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const soulDir = join(base, "soul"), scratch = join(base, "home");
  const put = (dir, files) => { mkdirSync(dir, { recursive: true }); for (const [n, v] of Object.entries(files)) writeFileSync(join(dir, n), v); };
  // Each skill carries ~1,000,045 bytes of text (SKILL.md, then five 200,001-byte files): two fit in 2 MiB, a third does not.
  const big = "x".repeat(200_000) + "\n";
  const files = Object.fromEntries([["SKILL.md", skillDoc("s")], ...Array.from({ length: 5 }, (_, i) => [`f${i}.md`, big])]);
  // Soul skills a1, a3 and capability skills a2, a4: interleaved by name, so answer order crosses sources.
  for (const n of ["a1", "a3"]) put(join(soulDir, "skills", n), files);
  for (const n of ["a2", "a4"]) put(join(scratch, ".oats", "modules", "m.x", "skills", n), files);
  const mods = ["a2", "a4"].map((name) => ({ module: "m.x", name, from: `.oats/modules/m.x/skills/${name}` }));
  const { composedSkills, problems } = composedSkillsIn(soulDir, scratch, mods);
  assert.deepEqual(problems, []);
  assertRows(composedSkills.filter((s) => s.source !== "soul"));
  assert.deepEqual(composedSkills.map((s) => [s.name, s.source]), [["a1", "soul"], ["a2", "module:m.x"], ["a3", "soul"], ["a4", "module:m.x"]]);
  const [a1, a2, a3, a4] = composedSkills;
  assert.ok([...a1.files, ...a2.files].every((f) => typeof f.text === "string"), "the first two skills, one from each source, are carried whole");
  assert.equal(typeof a3.files[0].text, "string", "a3's SKILL.md still fits");
  assert.ok([...a3.files.slice(1), ...a4.files].every((f) => f.omitted === true && f.text === null), "from the file that would pass 2 MiB on, every file is omitted");
  const used = composedSkills.flatMap((s) => s.files).filter((f) => !f.omitted).reduce((n, f) => n + Buffer.byteLength(f.text, "utf8"), 0);
  assert.ok(used <= COMPOSED_SKILLS_TEXT_BUDGET && used + Buffer.byteLength(big) > COMPOSED_SKILLS_TEXT_BUDGET, `${used} bytes carried`);

  // A symlinked skills/ is never followed, as for --skills: null with a problem naming composedSkills.
  const linked = join(base, "linked-soul");
  mkdirSync(linked);
  symlinkSync(join(soulDir, "skills"), join(linked, "skills"));
  assert.deepEqual(composedSkillsIn(linked, scratch, mods), { composedSkills: null, problems: [{ code: "soul-skills-unreadable", message: "composedSkills: the soul's skills/ is a symbolic link, which is not followed" }] });
});
