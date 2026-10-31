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
    assert.ok(skill.includes(`oats spawn S --dir D --task-file D/.oats-handover.md --name R ${options}${verb ? ` ${verb}` : ""}\n`), `the global spawn${verb ? " preview" : ""}`);
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

test("on a machine found-list, step 1 is the machine's round, with a default for every value", () => {
  assert.ok(skill.includes("On a machine found-list, ask the machine's round below instead of this list."));
  const round = skill.slice(skill.indexOf("**The machine's round.**"), skill.indexOf("## 2. Check"));
  assert.ok(round.includes("Enter, or\n\"yes\", accepts every default. Nothing is asked after this round, and never\na key."));
  assert.ok(round.includes("lowercased, with every character outside `[a-z0-9-]` turned\n  into `-`"), "the workspace and N default to the normalised hostname");
  // N follows the hostname, never the workspace's name, which the person may change.
  assert.match(round, /\*\*The namespace `N`:\*\*[^-]*Default:\s+the hostname, normalised as above/);
  // R is the chosen name, prefixed by the hostname in another machine's namespace, whatever name was chosen.
  assert.match(round, /`R` is the chosen name,\s+or `<hostname>-<chosen name>`/);
  for (const value of ["**The workspace:**", "`<workspace>-root`", "**The steward's name:**", "Default: `steward`", "**The deployment directory `D`:** default `<home>/Agents/<workspace>`", "**OATS Desktop:** installed and started by default", "**The harness:** the found-list's `harness`"]) {
    assert.ok(round.includes(value), `the machine's round gives ${value}`);
  }
});

test("after step 1, a machine found-list asks nothing: a step that would ask tells and stops", () => {
  assert.match(skill, /Wherever a later step says to ask the\s+person, on a machine found-list you tell them what happened, as it is, and\s+stop instead/);
  assert.match(skill, /On a machine found-list, ask nothing: tell the person that the run\s+failed, most likely because `N` is taken, and stop\./);
});

test("the steward's harness is recorded before readiness and harness trust read it", () => {
  const set = "oats soul launch set S --harness <harness> --dir D";
  const plan = skill.indexOf(`${set} --plan\n`), apply = skill.indexOf(`${set}\n`);
  assert.ok(plan > 0 && apply > plan, "planned, then applied");
  assert.ok(apply < skill.indexOf("oats harness trust --dir D"), "before harness trust");
  assert.ok(apply < skill.indexOf("oats readiness --soul S --dir D --json"), "before readiness");
  assert.ok(apply < skill.indexOf("oats spawn S --dir D --task-file D/.oats-handover.md --name R"), "before the spawn, which then takes no --harness");
});

test("a root that is not a member of the team stops step 9 before the spawn, with its fix", () => {
  // The fields the stop reads are the ones `oats aweb setup --check-only` prints.
  const provider = read("mirrors/oats-aweb/bin/oats-aweb.mjs");
  assert.match(provider, /console\.log\(JSON\.stringify\(\{ aw, defaultTeam: label \|\| team \? \{ label, team \} : null, member, root: teamRoot \}\)\)/);
  const stop = skill.indexOf("**`\"member\": false` on a new workspace, without a machine found-list:**\n     stop, spawn nothing");
  assert.ok(stop > skill.indexOf("## 9. Messaging on this machine") && stop < skill.indexOf("## 10. Spawn the setup expert"), "in step 9, before the spawn");
  const fix = skill.slice(stop, skill.indexOf("\n2. ", stop));
  assert.match(fix, /With\s+`"root": null`, there is no root in `D\/\.aw`: step 5's team creation did\s+not finish there, so run its line for an interrupted run, then check\s+again\./);
  assert.match(fix, /the team id step 7 wrote must be step 5's `canonical_team_id` exactly/);
  assert.match(skill, /expect `"member": true`\.\n\s+On `"member": false`, stop and spawn nothing/);
  // A machine found-list skips step 5 and signs up in item 2, so its first check is not a member and goes on.
  assert.match(skill, /A machine found-list skipped step 5, so\s+its `"member": false` here is expected: go on to item 2\./);
  assert.ok(stop < skill.indexOf("2. **Machine found-list: sign up its aweb account and team,**"), "the found-list's first check reaches the signup");
});
