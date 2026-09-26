// oats.core and oats.setup split one surface by audience: oats.core is day-to-day
// OATS operation from inside an instance; oats.setup is the setup and config of
// an OATS workspace. oats.core is a default nearly every soul carries, so it must
// not teach another capability's domain (knowledge, messaging) or workspace
// administration. oats.setup's inject must reach the instances that declare it.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CAPS = join(ROOT, "oats-package", "capabilities");

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name)] : []);
}

// Each is a command or a file only another capability, or workspace setup, teaches.
const NOT_CORE = [
  [/oats okf\b/, "oats okf (the knowledge capability's commands)"],
  [/(^|[\s`(])aw\s+[a-z]/m, "aw (the messaging capability's CLI)"],
  [/oats trigger add\b/, "oats trigger add (workspace automations)"],
  [/oats package add\b/, "oats package add (package pins)"],
  [/oats-workspace\.yaml/, "oats-workspace.yaml (workspace config)"],
  [/\bokf\b|knowledge\//i, "okf or knowledge/ (the knowledge capability's domain)"],
];

test("oats.core teaches no other capability's domain and no workspace setup", () => {
  const found = [];
  for (const file of files(join(CAPS, "oats-core"))) {
    const text = readFileSync(file, "utf8");
    for (const [pattern, what] of NOT_CORE) {
      if (pattern.test(text)) found.push(`${file.slice(ROOT.length)}: ${what}`);
    }
  }
  assert.deepEqual(found, []);
});

test("both injects and every skill description state the boundary", () => {
  for (const [slug, inject] of [["oats-core", "injects/oats.md"], ["oats-setup", "injects/setup.md"]]) {
    const root = join(CAPS, slug);
    const text = readFileSync(join(root, inject), "utf8");
    assert.match(text, /`oats\.core`/, `${slug}: the inject names oats.core`);
    assert.match(text, /`oats\.setup`/, `${slug}: the inject names oats.setup`);
    for (const skill of JSON.parse(readFileSync(join(root, "oats.json"), "utf8")).skills) {
      const head = readFileSync(join(root, skill, "SKILL.md"), "utf8").split("\n---\n")[0].replace(/\s+/g, " ");
      assert.match(head, /oats\.core/, `${skill}: its description names oats.core`);
      assert.match(head, /oats\.setup/, `${skill}: its description names oats.setup`);
    }
  }
});

test("oats.setup's inject and skills compose into an instance that declares it", (t) => {
  const manifest = JSON.parse(readFileSync(join(CAPS, "oats-setup", "oats.json"), "utf8"));
  assert.equal(manifest.inject, "injects/setup.md");
  const fx = v2Deployment({
    souls: { admin: { soul: { work: "directory", capabilities: { "oats.setup": { from: "here" } } } } },
    capabilityDirs: { "oats-setup": join(CAPS, "oats-setup") },
  });
  t.after(() => fx.cleanup());
  const r = fx.cli(["spawn", "admin", "--name", "admin-probe", "--no-launch", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const { home } = JSON.parse(r.stdout).result;
  const agents = readFileSync(join(home, "AGENTS.md"), "utf8");
  const inject = readFileSync(join(CAPS, "oats-setup", manifest.inject), "utf8");
  assert.ok(agents.includes(inject.trim()), "the setup inject is composed into AGENTS.md");
  const names = manifest.skills.map((skill) => skill.split("/").pop());
  const recorded = JSON.parse(readFileSync(join(home, "instance.json"), "utf8")).skills;
  assert.deepEqual(recorded.map((s) => [s.name, s.source]).sort(), names.map((n) => [n, "module:oats.setup"]).sort());
  for (const name of names) {
    assert.ok(existsSync(join(home, ".agents", "skills", "oats.setup", name, "SKILL.md")), `${name} is materialized`);
  }
});
