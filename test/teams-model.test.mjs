// Team model v2 (docs/design/2026-09-27-team-model-v2.md, option B), the kernel's pure half
// (lib/teams.mjs): the committed SHARED teams and the deployment's LOCAL teams, the default, and
// which teams each soul belongs to here — as the rows the reports, OATS_TEAMS and instance.json carry.
import test from "node:test";
import assert from "node:assert/strict";
import { soulKeyOf, soulTeams, teamModel, teamProblems, teamReferences, teamsEnv } from "../lib/teams.mjs";

const WS = { teams: { oats: { team: "oats:oats.aweb.ai", description: "The OATS project" }, reviewers: {} } };
const LOCAL = {
  teams: { "antares-oats": { team: "antares-oats:juan.aweb.ai" }, night: { team: "night:juan.aweb.ai", description: "Night shift" } },
  defaultTeam: "antares-oats",
  souls: { teams: { "*": ["oats"], "oats-expert": ["reviewers"], "oats.okf/harvester": ["night"] }, default: { "oats-expert": "oats" } },
};
const model = (ws = WS, local = LOCAL) => teamModel(ws, local, { workspaceKey: "github.com/awebai/oats" });
const code = (fn) => { try { fn(); } catch (e) { return [e.code, e.details]; } assert.fail("expected a refusal"); };

test("a soul's teams: the default (deployment's, or souls.default) ∪ souls.teams['*'] ∪ its own; default first, then by label", () => {
  const m = model();
  assert.deepEqual(soulTeams(m, "dev"), {
    key: "dev",
    defaultTeam: { label: "antares-oats", team: "antares-oats:juan.aweb.ai", from: "deployment" },
    teams: [
      { label: "antares-oats", team: "antares-oats:juan.aweb.ai", default: true, from: "local", via: ["default"] },
      { label: "oats", team: "oats:oats.aweb.ai", default: false, from: "shared", via: ["*"] },
    ],
  });
  // souls.default overrides the deployment default; the deployment default is then NOT one of its teams.
  assert.deepEqual(soulTeams(m, "oats-expert"), {
    key: "oats-expert",
    defaultTeam: { label: "oats", team: "oats:oats.aweb.ai", from: "soul" },
    teams: [
      { label: "oats", team: "oats:oats.aweb.ai", default: true, from: "shared", via: ["default", "*"] },
      { label: "reviewers", team: null, default: false, from: "shared", via: ["soul"] },
    ],
  });
  assert.deepEqual(soulTeams(m, "oats.okf/harvester").teams.map((r) => r.label), ["antares-oats", "night", "oats"]);
  // '*': the deployment default's row + souls.teams['*'].
  assert.deepEqual(soulTeams(m, "*").teams.map((r) => [r.label, r.via]), [["antares-oats", ["default"]], ["oats", ["*"]]]);
});

test("the soul's key: its bare name for a member or external soul, <package>/<soul> for a package soul", () => {
  assert.equal(soulKeyOf({ name: "dev", repoKey: "github.com/a/b" }), "dev");
  assert.equal(soulKeyOf({ name: "harvester", package: "oats.okf", qualifiedName: "oats.okf/harvester" }), "oats.okf/harvester");
});

test("no default configured: defaultTeam null, the soul's listed teams only; nothing at all → []", () => {
  assert.deepEqual(soulTeams(model(WS, { souls: { teams: { dev: ["oats"] } } }), "dev"), {
    key: "dev", defaultTeam: null, teams: [{ label: "oats", team: "oats:oats.aweb.ai", default: false, from: "shared", via: ["soul"] }],
  });
  assert.deepEqual(soulTeams(teamModel(null, null), "dev"), { key: "dev", defaultTeam: null, teams: [] });
});

test("an UNMAPPED default (a shared team without an id) is {label, team: null, from}", () => {
  const t = soulTeams(model(WS, { defaultTeam: "reviewers" }), "dev");
  assert.deepEqual(t.defaultTeam, { label: "reviewers", team: null, from: "deployment" });
  assert.deepEqual(t.teams, [{ label: "reviewers", team: null, default: true, from: "shared", via: ["default"] }]);
});

test("a label in BOTH files: the committed definition wins (a readiness problem, never a refusal)", () => {
  const m = model(WS, { teams: { oats: { team: "oats:mine.aweb.ai", description: "mine" } }, defaultTeam: "oats" });
  assert.deepEqual(soulTeams(m, "dev").teams, [{ label: "oats", team: "oats:oats.aweb.ai", default: true, from: "shared", via: ["default"] }]);
  const collision = teamProblems(m).find((p) => p.code === "team-label-collision");
  assert.deepEqual(collision, {
    code: "team-label-collision", label: "oats", severity: "warning",
    shared: { team: "oats:oats.aweb.ai", description: "The OATS project", at: "github.com/awebai/oats:oats-workspace.yaml#/teams/oats" },
    local: { team: "oats:mine.aweb.ai", description: "mine", at: "oats-local.yaml#/teams/oats" },
    message: "team oats is declared in both oats-workspace.yaml (shared) and oats-local.yaml (local); the shared definition wins",
    fix: "rename the local label in oats-local.yaml",
  });
});

test("an undeclared label the soul reaches is E_TEAM_UNKNOWN naming where it is written; souls.default outside the soul's teams is E_TEAM_NOT_ELIGIBLE", () => {
  assert.deepEqual(code(() => soulTeams(model(WS, { defaultTeam: "ghost" }), "dev")), ["E_TEAM_UNKNOWN", { label: "ghost", at: "oats-local.yaml#/defaultTeam" }]);
  assert.deepEqual(code(() => soulTeams(model(WS, { souls: { teams: { "*": ["oats", "ghost"] } } }), "dev")), ["E_TEAM_UNKNOWN", { label: "ghost", at: "oats-local.yaml#/souls/teams/*/1" }]);
  assert.deepEqual(code(() => soulTeams(model(WS, { souls: { default: { dev: "ghost" } } }), "dev")), ["E_TEAM_UNKNOWN", { label: "ghost", at: "oats-local.yaml#/souls/default/dev" }]);
  // Another soul's unknown label does not refuse this one (readiness reports it).
  assert.equal(soulTeams(model(WS, { souls: { teams: { other: ["ghost"] } } }), "dev").teams.length, 0);
  assert.deepEqual(code(() => soulTeams(model(WS, { defaultTeam: "oats", souls: { default: { dev: "reviewers" } } }), "dev")),
    ["E_TEAM_NOT_ELIGIBLE", { soul: "dev", label: "reviewers", at: "oats-local.yaml#/souls/default/dev" }]);
  // The deployment default itself is always eligible as an override.
  assert.equal(soulTeams(model(WS, { defaultTeam: "oats", souls: { default: { dev: "oats" } } }), "dev").defaultTeam.from, "soul");
});

test("the deployment's problems: collisions, unmapped shared teams (blocking when the default), unknown references, no default with messaging", () => {
  const m = model(WS, { defaultTeam: "reviewers", souls: { teams: { dev: ["ghost"] }, default: { x: "oats" } } });
  assert.deepEqual(teamProblems(m, { messaging: true }).map((p) => [p.code, p.label ?? null, p.severity, p.default ?? null]), [
    ["team-unmapped", "reviewers", "failure", true],
    ["E_TEAM_UNKNOWN", "ghost", "failure", null],
    ["E_TEAM_NOT_ELIGIBLE", "oats", "failure", null],
  ]);
  const unmapped = teamProblems(m).find((p) => p.code === "team-unmapped");
  assert.equal(unmapped.message, "the default team reviewers has no provider id yet");
  assert.equal(unmapped.fix, "its owner runs `oats aweb setup`, then commits the id; or choose another default with `oats teams default`");
  const plain = teamProblems(model(WS, LOCAL)).find((p) => p.code === "team-unmapped");
  assert.deepEqual(plain, { code: "team-unmapped", label: "reviewers", default: false, severity: "warning", at: "github.com/awebai/oats:oats-workspace.yaml#/teams/reviewers",
    message: "shared team reviewers has no provider id yet", fix: "its owner runs `oats aweb setup`, then commits the id" });
  assert.deepEqual(teamProblems(model(WS, {}), { messaging: true }).map((p) => [p.code, p.severity, p.message]),
    [["team-unmapped", "warning", "shared team reviewers has no provider id yet"], ["E_TEAM_UNCONFIGURED", "failure", "no teams configured: run `oats aweb setup`"]]);
  assert.equal(teamProblems(model(WS, {}), { messaging: false }).some((p) => p.code === "E_TEAM_UNCONFIGURED"), false, "no messaging layer: no default is fine");
});

test("a soul's problems: only what concerns it; `default` marks ITS default", () => {
  const m = model(WS, { defaultTeam: "antares-oats", teams: { "antares-oats": { team: "a:b" } }, souls: { teams: { dev: ["reviewers"] } } });
  assert.deepEqual(teamProblems(m, { key: "dev" }).map((p) => [p.code, p.label, p.default]), [["team-unmapped", "reviewers", false]]);
  assert.deepEqual(teamProblems(m, { key: "other" }), [], "a soul that is not in reviewers is not told about it");
});

test("every reference to a label, as `oats teams remove` names them", () => {
  assert.deepEqual(teamReferences(model(WS, { ...LOCAL, souls: { ...LOCAL.souls, teams: { ...LOCAL.souls.teams, dev: ["oats"] } } }), "oats"),
    ["souls.teams:*", "souls.teams:dev", "souls.default:oats-expert"]);
  assert.deepEqual(teamReferences(model(), "antares-oats"), ["defaultTeam"]);
  assert.deepEqual(teamReferences(model(), "night"), ["souls.teams:oats.okf/harvester"]);
  assert.deepEqual(teamReferences(model(), "unused"), []);
});

test("the provider environment: mapped rows only; an unmapped default sets the label and FROM without the id; no default sets none", () => {
  const env = (ws, local, key = "dev", source = "live") => teamsEnv({ ...soulTeams(model(ws, local), key), source });
  assert.deepEqual(env(WS, LOCAL, "oats-expert"), {
    OATS_DEFAULT_TEAM: "oats", OATS_DEFAULT_TEAM_ID: "oats:oats.aweb.ai", OATS_DEFAULT_TEAM_FROM: "soul",
    OATS_TEAMS: JSON.stringify([{ label: "oats", team: "oats:oats.aweb.ai", default: true, from: "shared" }]),
    OATS_TEAMS_SOURCE: "live", OATS_TEAM_LABEL: undefined, OATS_TEAM_LABELS: undefined, OATS_TEAM_ID: undefined,
  });
  const unmapped = env(WS, { defaultTeam: "reviewers" }, "dev", "recorded");
  assert.deepEqual([unmapped.OATS_DEFAULT_TEAM, unmapped.OATS_DEFAULT_TEAM_ID, unmapped.OATS_DEFAULT_TEAM_FROM, unmapped.OATS_TEAMS, unmapped.OATS_TEAMS_SOURCE],
    ["reviewers", undefined, "deployment", "[]", "recorded"]);
  const none = env(WS, {});
  assert.deepEqual([none.OATS_DEFAULT_TEAM, none.OATS_DEFAULT_TEAM_ID, none.OATS_DEFAULT_TEAM_FROM, none.OATS_TEAMS], [undefined, undefined, undefined, "[]"]);
  // Unknown teams (no resolution, a home recorded before 0.30): every name unset, never an ambient value.
  assert.deepEqual(Object.values(teamsEnv(null)).filter((v) => v !== undefined), []);
});

test("the removed team keys are schema problems naming their replacement (no alias, no fallback)", async () => {
  const { validateWorkspace, validateMembership, validateSoul } = await import("../lib/workspace.mjs");
  const MOVED = "team membership is local since 0.30: `oats soul teams`";
  const pick = (problems) => problems.map((p) => [p.path, p.reason ?? null, p.message]);
  assert.deepEqual(pick(validateMembership({ schemaVersion: 2, workspace: "git:github.com/a/b", team: "global" })), [["/team", "removed-key", MOVED]]);
  assert.deepEqual(pick(validateSoul({ schemaVersion: 2, name: "dev", description: "d", work: "directory", team: ["a", "b"] })), [["/team", "removed-key", MOVED]]);
  const ws = { schemaVersion: 2, name: "acme", teams: { oats: { team: "oats:oats.aweb.ai" }, later: {} },
    messaging: { byTeam: { oats: { team: "x" } } }, defaults: { byTeam: { oats: { capabilities: {} } } },
    external: [{ source: `git:github.com/a/b@${"a".repeat(40)}`, soul: "s", team: "oats" }] };
  assert.deepEqual(pick(validateWorkspace(ws)), [
    ["/messaging/byTeam", "removed-key", "messaging.byTeam was removed in 0.30: a team's provider id is teams.<label>.team (committed, shared) or oats-local.yaml teams.<label>.team (local)"],
    ["/defaults/byTeam", "removed-key", "defaults.byTeam was removed in 0.30: capabilities compose from defaults.capabilities and the soul only"],
    ["/external/0/team", "removed-key", MOVED],
  ]);
  assert.deepEqual(validateWorkspace({ schemaVersion: 2, name: "acme", teams: { oats: { team: "oats:oats.aweb.ai", description: "d" }, later: {} } }), [], "a shared team with or without its id");
});
