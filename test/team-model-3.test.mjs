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
