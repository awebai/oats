// On a machine found-list (oats-omarchy's installer hands one over), the
// getting-started skill makes the workspace the machine's own: it pins the
// catalog's oats.machine, its setup soul is oats.machine/steward, and the steward
// gets a global, contacts-only aweb address through `oats aweb resident create`'s
// root route, or a local team identity when that route is not there. The skill's
// literals are checked here against the catalog and against the oats.aweb
// provider's own source (mirrors/oats-aweb), so they cannot drift from what the
// provider prints.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const skill = read("skills/oats-getting-started/SKILL.md");
const catalog = JSON.parse(read("package-catalog.json"));
const residentSource = read("mirrors/oats-aweb/lib/resident.mjs");
const providerVersion = JSON.parse(read("mirrors/oats-aweb/oats.json")).version;
const atLeast = (v, min) => {
  const a = v.split(".").map(Number), b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

// The floors the skill names for the root route: oats.aweb 1.33.0 ships it, and
// its aw floor is 1.36.48 (oats.aweb's AW_RESIDENT_ROOT_MIN).
const PROVIDER_ROOT_ROUTE = "1.33.0";
const AW_ROOT_ROUTE = "1.36.48";

test("the catalog lists oats.machine at v0.1.1, and oats.machine-care resolves to it", () => {
  assert.deepEqual(catalog.packages["oats.machine"], { url: "https://github.com/awebai/oats-machine.git", ref: "v0.1.1", path: "oats-package" });
  assert.equal(catalog.capabilities["oats.machine-care"], "oats.machine");
  assert.match(read("docs/official-catalog.md"), /^\| `oats\.machine` \| `v0\.1\.1` \| `oats\.machine-care` \| `steward`, `technician` \|$/m);
});

test("on a machine found-list the workspace pins the catalog's oats.machine by bare version", () => {
  assert.match(skill, /^  oats\.machine: v0\.1\.1\b/m);
  assert.equal(`v${skill.match(/^  oats\.machine: v(\S+)/m)[1]}`, catalog.packages["oats.machine"].ref);
  assert.doesNotMatch(skill, /git:github\.com\/awebai\/oats-machine/, "an official package is pinned by bare version, never by Git");
  assert.match(skill, /`machine\.platform`/, "the step applies only to a machine found-list");
});

test("the steward's resident is planned, checked for the root route, then created, with no API key", () => {
  const plan = "env -u AWEB_API_KEY oats aweb resident create R --team-label L --plan --json";
  const run = "env -u AWEB_API_KEY oats aweb resident create R --team-label L --json";
  assert.ok(skill.includes(`cd "D" && ${plan}\n`), "the plan line");
  assert.ok(skill.includes(`cd "D" && ${run}\n`), "the run line: the plan's argv without --plan");
  assert.ok(skill.includes("`result.init.route` is `root`"), "the plan's route is checked");
  assert.ok(skill.includes("`result.init` is `null`"), "an existing resident is adopted, never created twice");
  // The flags exist in the provider's parser.
  for (const flag of ["--team-label", "--plan", "--json"]) assert.ok(residentSource.includes(`"${flag}"`), `oats aweb resident create takes ${flag}`);
});

test("the steward is spawned with the provider's printed grant-seat options", () => {
  const spawn = residentSource.match(/const SPAWN = \(name\) => `oats spawn <soul> (.*?)\$\{name\}`;/);
  assert.ok(spawn, "the provider prints the seat's spawn line");
  const options = `${spawn[1]}R`;
  assert.equal(options, "--provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=R");
  for (const verb of ["--preview", ""]) {
    assert.ok(skill.includes(`oats spawn S --dir D --task-file D/.oats-handover.md --harness <harness> --name R ${options}${verb ? ` ${verb}` : ""}\n`), `the global spawn${verb ? " preview" : ""}`);
  }
});

test("the fallback names the floors, and says it in one line, with no question and no key", () => {
  assert.match(skill, /Tell the person in one line,\s+without asking anything/);
  assert.ok(skill.includes("Never ask for a key."));
  assert.ok(skill.includes(`\`oats.aweb\` ${PROVIDER_ROOT_ROUTE} or later`));
  assert.ok(skill.includes(`aw ${AW_ROOT_ROUTE} or later`));
  assert.match(skill, /GLOBAL residents and grant\s+seats section of `\/oats-aweb`/, "the line names /oats-aweb's section that moves it later");
  // Once the mirror carries the root route, its floor and route literal must be the skill's.
  if (atLeast(providerVersion, PROVIDER_ROOT_ROUTE)) {
    assert.match(read("mirrors/oats-aweb/lib/aw-floor.mjs"), new RegExp(`AW_RESIDENT_ROOT_MIN = '${AW_ROOT_ROUTE.replaceAll(".", "\\.")}'`));
    assert.ok(residentSource.includes('route: "root"'), "the plan reports the root route as init.route");
  }
});

test("the person chooses the namespace and the steward's name once, at step 1, each with a default", () => {
  assert.ok(skill.includes("Enter, or \"yes\", accepts every\n  default. After this round there are no more questions, and never a key."));
  assert.ok(skill.includes("lowercased, with every character outside\n    `[a-z0-9-]` turned into `-`"), "N defaults to the normalised hostname");
  assert.ok(skill.includes("**The steward's name `R`:**") && skill.includes("Default: `steward`."), "R defaults to steward");
  // R is the resident's name and the instance's, and the collision fallback keeps both equal.
  assert.ok(skill.includes("`<hostname>-R` instead") && skill.includes("for the resident and the\ninstance alike"));
});
