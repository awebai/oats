// The team facts a lifecycle hook receives (human decisions 2026-09-24: oats.aweb is
// the messaging default; teams are seamless — a personal team per person per
// workspace, and seamless joining of workspace-defined teams). Workspace model: no
// classic `team:` block — OATS_TEAM_SCOPE is the deployment directory, OATS_TEAM_ID
// is the messaging slot's merged payload `team` (empty = personal), and the provider
// also gets the soul's team label and the workspace's name and canonical key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { teamEnv } from "../lib/core.mjs";

const v2 = (over = {}) => ({
  workspace: { key: "github.com/acme/agents", name: "acme", deployment: "/srv/acme-workspace", team: "cloud", slots: { messaging: "oats.aweb", knowledge: "oats.okf" }, ...over.workspace },
  payloads: { "oats.aweb": { team: "aweb:acme.cloud", delivery: "channel" }, "oats.okf": {} , ...over.payloads },
});

test("workspace model, shared team mapped: team id from the messaging payload, scope = deployment, label + workspace identity", () => {
  assert.deepEqual(teamEnv(v2()), {
    OATS_TEAM_NAME: "", OATS_TEAM_ID: "aweb:acme.cloud", OATS_TEAM_SCOPE: "/srv/acme-workspace",
    OATS_TEAM_LABEL: "cloud", OATS_WORKSPACE_NAME: "acme", OATS_WORKSPACE_KEY: "github.com/acme/agents",
  });
});

test("workspace model, no shared team for the label: OATS_TEAM_ID is empty (= personal), identity still passed", () => {
  const e = teamEnv(v2({ payloads: { "oats.aweb": { delivery: "channel" } } }));
  assert.equal(e.OATS_TEAM_ID, "");
  assert.equal(e.OATS_TEAM_LABEL, "cloud");
  assert.equal(e.OATS_WORKSPACE_NAME, "acme");
  assert.equal(e.OATS_WORKSPACE_KEY, "github.com/acme/agents");
  assert.equal(e.OATS_TEAM_SCOPE, "/srv/acme-workspace");
});

test("workspace model, messaging slot empty (none): no team id; a non-string payload team is ignored", () => {
  assert.equal(teamEnv(v2({ workspace: { slots: { messaging: null } } })).OATS_TEAM_ID, "");
  assert.equal(teamEnv(v2({ payloads: { "oats.aweb": { team: { evil: 1 } } } })).OATS_TEAM_ID, "");
});

test("classic deployment: unchanged — the config chain's team: block, no workspace keys", () => {
  assert.deepEqual(teamEnv({ team: { name: "default", id: "default:oats.aweb.ai", scope: "/ws" } }),
    { OATS_TEAM_NAME: "default", OATS_TEAM_ID: "default:oats.aweb.ai", OATS_TEAM_SCOPE: "/ws" });
  assert.deepEqual(teamEnv({}), { OATS_TEAM_NAME: "", OATS_TEAM_ID: "", OATS_TEAM_SCOPE: "" });
});
