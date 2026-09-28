// The team facts a lifecycle hook receives (human decisions 2026-09-24: oats.aweb is
// the messaging default). Workspace model: no classic `team:` block — OATS_TEAM_SCOPE is
// the deployment directory, and the provider gets the workspace's name and canonical key.
// Team model v2 (0.30, docs/desktop-cli-api.md "The provider environment"): the soul's
// teams come from the resolution's TeamRows — OATS_DEFAULT_TEAM(+_ID, _FROM), OATS_TEAMS
// (mapped rows only), OATS_TEAMS_SOURCE — never from the messaging payload. A name that
// does not apply is undefined (so a child never inherits an ambient value); the pre-0.30
// OATS_TEAM_LABEL / OATS_TEAM_LABELS / OATS_TEAM_ID are always undefined.
import { test } from "node:test";
import assert from "node:assert/strict";
import { teamEnv } from "../lib/core.mjs";

const v2 = (over = {}) => ({
  workspace: { key: "github.com/acme/agents", name: "acme", deployment: "/srv/acme-workspace", slots: { messaging: "oats.aweb", knowledge: "oats.okf" }, ...over.workspace },
  payloads: { "oats.aweb": { team: "aweb:acme.payload", delivery: "channel" }, "oats.okf": {}, ...over.payloads },
  ...(over.teams !== undefined ? { teams: over.teams, defaultTeam: over.defaultTeam ?? null, teamsSource: over.teamsSource ?? "live" } : {}),
});
const TEAMS = [
  { label: "cloud", team: "aweb:acme.cloud", default: true, from: "shared" },
  { label: "mine", team: "aweb:me.x", default: false, from: "local" },
  { label: "design", team: null, default: false, from: "shared" },
];
const DEFAULT = { label: "cloud", team: "aweb:acme.cloud", from: "deployment" };
const PRE_030 = ["OATS_TEAM_LABEL", "OATS_TEAM_LABELS", "OATS_TEAM_ID"];

test("teams known: the default team, the MAPPED rows as OATS_TEAMS, the source; scope = deployment; workspace identity; the pre-0.30 names unset", () => {
  assert.deepEqual(teamEnv(v2({ teams: TEAMS, defaultTeam: DEFAULT })), {
    OATS_TEAM_NAME: "", OATS_TEAM_SCOPE: "/srv/acme-workspace",
    OATS_DEFAULT_TEAM: "cloud", OATS_DEFAULT_TEAM_ID: "aweb:acme.cloud", OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify(TEAMS.slice(0, 2)), OATS_TEAMS_SOURCE: "live",
    OATS_TEAM_LABEL: undefined, OATS_TEAM_LABELS: undefined, OATS_TEAM_ID: undefined,
    OATS_WORKSPACE_NAME: "acme", OATS_WORKSPACE_KEY: "github.com/acme/agents",
  });
});

test("no team is [] with no default; teams not known leave every team name unset, never []", () => {
  const none = teamEnv(v2({ teams: [] }));
  assert.equal(none.OATS_TEAMS, "[]");
  assert.equal(none.OATS_TEAMS_SOURCE, "live");
  for (const k of ["OATS_DEFAULT_TEAM", "OATS_DEFAULT_TEAM_ID", "OATS_DEFAULT_TEAM_FROM"]) assert.equal(none[k], undefined, k);
  const unknown = teamEnv(v2({ teams: null, defaultTeam: DEFAULT }));
  for (const k of ["OATS_TEAMS", "OATS_TEAMS_SOURCE", "OATS_DEFAULT_TEAM", "OATS_DEFAULT_TEAM_ID", "OATS_DEFAULT_TEAM_FROM"]) assert.equal(unknown[k], undefined, `${k}: a home whose teams are unknown gets no claim`);
  assert.equal(teamEnv(v2({ teams: TEAMS, teamsSource: "recorded" })).OATS_TEAMS_SOURCE, "recorded", "a spawn-time list is marked recorded");
  assert.equal(teamEnv(v2({ teams: TEAMS, teamsSource: "bogus" })).OATS_TEAMS_SOURCE, undefined, "only live|recorded");
});

test("an unmapped default sets the label and FROM, never an id; only mapped rows reach OATS_TEAMS", () => {
  const e = teamEnv(v2({ teams: TEAMS, defaultTeam: { label: "design", team: null, from: "soul" } }));
  assert.equal(e.OATS_DEFAULT_TEAM, "design");
  assert.equal(e.OATS_DEFAULT_TEAM_FROM, "soul");
  assert.equal(e.OATS_DEFAULT_TEAM_ID, undefined);
  assert.ok(!JSON.parse(e.OATS_TEAMS).some((r) => r.label === "design"));
});

test("the messaging payload's `team` never becomes a team fact (0.30); identity still passed with no teams", () => {
  const e = teamEnv(v2());
  for (const k of [...PRE_030, "OATS_DEFAULT_TEAM", "OATS_DEFAULT_TEAM_ID", "OATS_TEAMS"]) assert.equal(e[k], undefined, k);
  assert.equal(e.OATS_WORKSPACE_NAME, "acme");
  assert.equal(e.OATS_WORKSPACE_KEY, "github.com/acme/agents");
  assert.equal(e.OATS_TEAM_SCOPE, "/srv/acme-workspace");
  assert.equal(teamEnv(v2({ workspace: { slots: { messaging: null } }, teams: TEAMS, defaultTeam: DEFAULT })).OATS_DEFAULT_TEAM_ID, "aweb:acme.cloud", "the slot does not gate the teams");
});

test("a resolved view with no workspace answers empty identity strings and no team names", () => {
  const empty = {
    OATS_TEAM_NAME: "", OATS_TEAM_SCOPE: "", OATS_WORKSPACE_NAME: "", OATS_WORKSPACE_KEY: "",
    OATS_DEFAULT_TEAM: undefined, OATS_DEFAULT_TEAM_ID: undefined, OATS_DEFAULT_TEAM_FROM: undefined, OATS_TEAMS: undefined, OATS_TEAMS_SOURCE: undefined,
    OATS_TEAM_LABEL: undefined, OATS_TEAM_LABELS: undefined, OATS_TEAM_ID: undefined,
  };
  assert.deepEqual(teamEnv({}), empty);
  assert.deepEqual(teamEnv({ payloads: { "oats.aweb": { team: "aweb:acme.cloud" } } }), empty);
  assert.deepEqual(teamEnv(null), empty);
});

test("an ambient or recorded team name never reaches OATS_TEAM_NAME", () => {
  const saved = process.env.OATS_TEAM_NAME;
  process.env.OATS_TEAM_NAME = "ambient";
  try {
    assert.equal(teamEnv(v2()).OATS_TEAM_NAME, "");
    assert.equal(teamEnv({ ...v2(), team: { name: "recorded", id: "recorded:oats.aweb.ai", scope: "/ws" } }).OATS_TEAM_NAME, "");
    assert.equal(teamEnv(v2({ workspace: { name: "recorded" } })).OATS_TEAM_NAME, "", "the workspace name is OATS_WORKSPACE_NAME, never the team name");
  } finally {
    if (saved === undefined) delete process.env.OATS_TEAM_NAME; else process.env.OATS_TEAM_NAME = saved;
  }
});
