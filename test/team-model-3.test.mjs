// Team model 3 (awebai/oats#484, prepared in 0.36.x by #485): the workspace commits its default team
// (`defaultTeam`), whether deployments may declare their own teams (`localTeams`) and, per soul pattern,
// the default and the other teams a soul may join (`souls:`).
import test from "node:test";
import assert from "node:assert/strict";
import { validateWorkspace } from "../lib/workspace.mjs";

const TEAMS = { engineering: { team: "engineering:acme.aweb.ai" }, security: { team: "security:acme.aweb.ai" }, docs: {} };
const ws = (extra) => ({ schemaVersion: 2, name: "acme", teams: TEAMS, ...extra });
const pick = (problems) => problems.map((p) => [p.path, p.message]);

test("the workspace accepts defaultTeam, localTeams and souls: whose labels are shared teams", () => {
  assert.deepEqual(validateWorkspace(ws({
    defaultTeam: "engineering",
    localTeams: false,
    souls: {
      "*": { teams: [] },
      "security-souls/*": { default: "security", teams: ["engineering"] },
      "security-souls/incident-responder": { default: "security", teams: ["engineering", "docs"] },
      "oats.engineering/*": { teams: "any" },
      "acme-docs/writer": {},
    },
  })), []);
  assert.deepEqual(validateWorkspace(ws({ localTeams: true })), []);
  // An unmapped shared team (declared, no provider id yet) is a shared label.
  assert.deepEqual(validateWorkspace(ws({ defaultTeam: "docs" })), []);
});

test("a label that is not a shared team of this file is a schema problem where it is written", () => {
  assert.deepEqual(pick(validateWorkspace(ws({ defaultTeam: "night" }))), [
    ["/defaultTeam", "\"night\" is not a shared team: declare it in teams: of this file"],
  ]);
  assert.deepEqual(pick(validateWorkspace(ws({ souls: { "a/b": { default: "night", teams: ["docs", "ops"] } } }))), [
    ["/souls/a~1b/default", "\"night\" is not a shared team: declare it in teams: of this file"],
    ["/souls/a~1b/teams/1", "\"ops\" is not a shared team: declare it in teams: of this file"],
  ]);
  // No teams: at all → every label is unknown.
  assert.deepEqual(pick(validateWorkspace({ schemaVersion: 2, name: "acme", defaultTeam: "engineering" })), [
    ["/defaultTeam", "\"engineering\" is not a shared team: declare it in teams: of this file"],
  ]);
});

test("souls: keys are \"*\", <member|package>/* or <member|package>/<soul>; entries are { default?, teams?: [labels] | \"any\" }", () => {
  const bad = (souls) => validateWorkspace(ws({ souls })).map((p) => p.path);
  assert.deepEqual(bad({ "*": {}, "a/*": { teams: [] }, "a.b-c/dev-x": { teams: "any" } }), [], "{} and teams: [] are both default-only");
  assert.ok(bad({ dev: {} }).length > 0, "a bare soul name is not a pattern");
  assert.ok(bad({ "a/b/c": {} }).length > 0);
  assert.ok(bad({ "*/dev": {} }).length > 0);
  assert.ok(bad({ "A/dev": {} }).length > 0);
  assert.ok(bad({ "a/*": { teams: "all" } }).length > 0, "teams is a list or \"any\"");
  assert.ok(bad({ "a/*": { teams: ["docs", "docs"] } }).length > 0, "labels are unique");
  assert.ok(bad({ "a/*": { join: ["docs"] } }).length > 0, "no other keys");
  assert.ok(bad({ "a/*": { default: "any" } }).length > 0, "a default is a shared label, never any");
  assert.ok(validateWorkspace(ws({ localTeams: "yes" })).some((p) => p.path === "/localTeams"));
});

test("0.36.x accepts the keys without applying them: a soul's teams and default are what oats-local.yaml says", async () => {
  const { soulTeams, teamModel } = await import("../lib/teams.mjs");
  const local = { teams: { mine: { team: "mine:me.aweb.ai" } }, defaultTeam: "mine", souls: { teams: { "*": ["docs"] } } };
  const committed = ws({ defaultTeam: "engineering", localTeams: false, souls: { "*": { default: "security", teams: "any" }, "acme/dev": { default: "docs" } } });
  assert.deepEqual(validateWorkspace(committed), []);
  for (const key of ["dev", "acme/dev", "*"]) assert.deepEqual(soulTeams(teamModel(committed, local), key), soulTeams(teamModel(ws({}), local), key), key);
});

/* ───────────── 0.36.x: the readiness warning team-model-3-migration ───────────── */

const SOUL_TEAMS_MOVE = {
  code: "team-model-3-migration", severity: "warning", condition: "local-soul-teams", keys: ["souls.teams", "souls.default"],
  message: "oats-local.yaml souls.teams, souls.default: OATS 0.38.0 refuses these keys; which teams a soul may join, and its default, move to souls: in oats-workspace.yaml",
  fix: "commit the same choices as souls: entries in oats-workspace.yaml (\"*\" or <member|package>/<soul>: { default, teams }), then remove souls.teams and souls.default from oats-local.yaml",
};
const closed = (keys) => ({
  code: "team-model-3-migration", severity: "warning", condition: "local-teams-closed", keys,
  message: `oats-local.yaml declares ${keys.join(", ")}, but oats-workspace.yaml does not say localTeams: true: OATS 0.38.0 refuses local teams and a local defaultTeam unless the workspace allows them`,
  fix: "either (a) add `localTeams: true` to oats-workspace.yaml, or (b) commit the teams and defaultTeam in oats-workspace.yaml, then remove them from oats-local.yaml",
});
const migration = (problems) => problems.filter((p) => p.code === "team-model-3-migration");

test("team-model-3-migration: local souls.teams/souls.default, and local teams/defaultTeam without localTeams: true", async () => {
  const { teamModel, teamProblems } = await import("../lib/teams.mjs");
  const local = { teams: { mine: { team: "mine:me.aweb.ai" } }, defaultTeam: "mine", souls: { teams: { "*": ["docs"] }, default: { dev: "docs" } } };
  // Without a key (oats teams) and with one (a soul's readiness): the same deployment facts.
  for (const opts of [{}, { key: "dev" }]) {
    assert.deepEqual(migration(teamProblems(teamModel(ws({}), local), opts)), [SOUL_TEAMS_MOVE, closed(["teams", "defaultTeam"])]);
    assert.deepEqual(migration(teamProblems(teamModel(ws({ localTeams: false }), local), opts)), [SOUL_TEAMS_MOVE, closed(["teams", "defaultTeam"])]);
    assert.deepEqual(migration(teamProblems(teamModel(ws({ localTeams: true }), local), opts)), [SOUL_TEAMS_MOVE], "localTeams: true admits them");
    // The standalone view (no workspace file): no workspace rules, so only the removed keys.
    assert.deepEqual(migration(teamProblems(teamModel(null, local), opts)), [SOUL_TEAMS_MOVE]);
  }
  // Each key on its own names only itself.
  assert.deepEqual(migration(teamProblems(teamModel(ws({}), { souls: { default: { dev: "docs" } } }))), [{ ...SOUL_TEAMS_MOVE, keys: ["souls.default"],
    message: "oats-local.yaml souls.default: OATS 0.38.0 refuses this key; which teams a soul may join, and its default, move to souls: in oats-workspace.yaml",
    fix: "commit the same choices as souls: entries in oats-workspace.yaml (\"*\" or <member|package>/<soul>: { default, teams }), then remove souls.default from oats-local.yaml" }]);
  assert.deepEqual(migration(teamProblems(teamModel(ws({}), { defaultTeam: "docs" }))), [closed(["defaultTeam"])], "a local default naming a SHARED team is still local");
  assert.deepEqual(migration(teamProblems(teamModel(ws({}), { souls: { disabled: ["x"] } }))), [], "nothing to migrate");
  assert.deepEqual(migration(teamProblems(teamModel(ws({ defaultTeam: "docs", souls: { "*": { teams: "any" } } }), null))), [], "a migrated deployment");
});

/* The warning on every surface: `oats teams --json`, readiness (a non-required configured item) and doctor
 * (offline: the cached workspace file, else an information line). */
const { v2Deployment } = await import("./helpers/v2-deployment.mjs");
const YAML = (await import("yaml")).default;
const { readFileSync } = await import("node:fs");
const { join } = await import("node:path");
function deployment(local) {
  return v2Deployment({ name: "acme", local, souls: { dev: { soul: {} } }, workspace: { teams: { docs: { team: "docs:acme.aweb.ai" } } } });
}
const ok = (r, what) => { assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`); const j = r.json(); assert.equal(j.ok ?? true, true, `${what}: ${r.stdout}`); return j.result ?? j; };
const LOCAL_V2 = { teams: { mine: { team: "mine:me.aweb.ai" } }, defaultTeam: "mine", souls: { teams: { "*": ["docs"] }, default: { dev: "docs" } } };
const setWorkspace = (fx, change) => {
  const file = YAML.parse(readFileSync(join(fx.base, "seed", "oats-workspace.yaml"), "utf8"));
  fx.commit({ "oats-workspace.yaml": YAML.stringify({ ...file, ...change }, { lineWidth: 0 }) }, "workspace change");
};

test("oats teams --json and readiness carry team-model-3-migration; localTeams: true clears local-teams-closed", (t) => {
  const fx = deployment(LOCAL_V2); t.after(fx.cleanup);
  assert.deepEqual(migration(ok(fx.cli(["teams", "--json"]), "teams").problems), [SOUL_TEAMS_MOVE, closed(["teams", "defaultTeam"])]);
  const items = () => ok(fx.cli(["readiness", "--soul", "dev", "--json"]), "readiness").checks.configured.items.filter((i) => i.code === "team-model-3-migration");
  assert.deepEqual(items(), [SOUL_TEAMS_MOVE, closed(["teams", "defaultTeam"])].map((p) => ({
    subject: "teams", status: "fail", required: false, reason: p.message, producer: "team model", evidence: null, remedy: p.fix, code: p.code, condition: p.condition, keys: p.keys,
  })));
  setWorkspace(fx, { localTeams: true });
  assert.deepEqual(migration(ok(fx.cli(["teams", "--json"]), "teams").problems), [SOUL_TEAMS_MOVE]);
  assert.deepEqual(items().map((i) => i.condition), ["local-soul-teams"]);
});

test("doctor reports team-model-3-migration offline: from the cached workspace file, else it says local teams couldn't be checked", (t) => {
  const fx = deployment({ teams: { mine: { team: "mine:me.aweb.ai" } }, defaultTeam: "mine", souls: { teams: { "*": ["docs"] } } }); t.after(fx.cleanup);
  const UNCHECKED = "team-model-3-migration: whether oats-local.yaml teams/defaultTeam need localTeams: true couldn't be checked: this deployment hasn't observed its workspace yet; run oats sync";
  const soulTeams = { ...SOUL_TEAMS_MOVE, keys: ["souls.teams"],
    message: "oats-local.yaml souls.teams: OATS 0.38.0 refuses this key; which teams a soul may join, and its default, move to souls: in oats-workspace.yaml",
    fix: "commit the same choices as souls: entries in oats-workspace.yaml (\"*\" or <member|package>/<soul>: { default, teams }), then remove souls.teams from oats-local.yaml" };
  // Nothing observed yet: the removed keys are known offline; local teams are not checked.
  let doc = JSON.parse(fx.cli(["doctor", "--json"]).stdout);
  assert.deepEqual(migration(doc.problems ?? []), [soulTeams]);
  assert.deepEqual(doc.information, [UNCHECKED]);
  let text = fx.cli(["doctor"]).stdout;
  assert.match(text, /! team-model-3-migration: oats-local\.yaml souls\.teams: OATS 0\.38\.0 refuses this key/);
  assert.ok(text.includes(`INFO: ${UNCHECKED}`), text);
  // Any command that reads the workspace leaves it in the parsed cache: doctor then knows.
  ok(fx.cli(["teams", "--json"]), "teams observes the workspace");
  doc = JSON.parse(fx.cli(["doctor", "--json"]).stdout);
  assert.deepEqual(migration(doc.problems), [soulTeams, closed(["teams", "defaultTeam"])]);
  assert.deepEqual(doc.information, []);
  text = fx.cli(["doctor"]).stdout;
  assert.ok(text.includes(`! team-model-3-migration: ${closed(["teams", "defaultTeam"]).message} — ${closed(["teams", "defaultTeam"]).fix}`), text);
  setWorkspace(fx, { localTeams: true });
  ok(fx.cli(["teams", "--json"]), "observe the change");
  assert.deepEqual(migration(JSON.parse(fx.cli(["doctor", "--json"]).stdout).problems), [soulTeams]);
});
