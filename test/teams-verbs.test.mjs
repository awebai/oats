// The team verbs' writes to oats-local.yaml (lib/teams-verbs.mjs): surgical (comments and styles kept on
// everything the edit does not change) and from the file as it is NOW (never the command's snapshot).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { teamsAdd, teamsDefault, teamsRemove } from "../lib/teams-verbs.mjs";

const HEAD = "schemaVersion: 2\nworkspace: git:github.com/acme/agents\n";
const WORKSPACE = { schemaVersion: 2, name: "acme", teams: { oats: { team: "oats:oats.aweb.ai" } }, localTeams: true };
function fixture(t, text, workspace = WORKSPACE) {
  const dir = mkdtempSync(join(tmpdir(), "oats-teams-verbs-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const localPath = join(dir, "oats-local.yaml");
  writeFileSync(localPath, HEAD + text);
  const ctx = () => ({ deployment: dir, localPath, local: YAML.parse(readFileSync(localPath, "utf8")), workspace, workspaceKey: "github.com/acme/agents" });
  return { localPath, ctx, text: () => readFileSync(localPath, "utf8") };
}

test("an edit touches only what changes: inline comments on sibling entries survive", (t) => {
  const fx = fixture(t, [
    "teams:",
    "  mine: { team: \"mine:me.aweb.ai\" }   # my own team",
    "  spare:",
    "    team: spare:me.aweb.ai            # the spare id",
    "    description: Spare                # keep me",
    "  gone: { team: \"gone:me.aweb.ai\" }   # removed below",
    "defaultTeam: mine                     # the default",
    "souls:",
    "  disabled: [old]                     # not a team key",
    "",
  ].join("\n"));
  teamsAdd(fx.ctx(), "third", { team: "third:me.aweb.ai" });
  teamsRemove(fx.ctx(), "gone");
  teamsDefault(fx.ctx(), "spare");
  const out = fx.text();
  for (const c of ["# my own team", "# the spare id", "# keep me", "# not a team key"]) assert.ok(out.includes(c), `${c} kept:\n${out}`);
  assert.equal(out.includes("# removed below"), false, "the removed entry's own comment goes with it");
  assert.deepEqual(YAML.parse(out), { schemaVersion: 2, workspace: "git:github.com/acme/agents",
    teams: { mine: { team: "mine:me.aweb.ai" }, spare: { team: "spare:me.aweb.ai", description: "Spare" }, third: { team: "third:me.aweb.ai" } },
    defaultTeam: "spare", souls: { disabled: ["old"] } });
  // (The YAML library normalises the spacing before an inline comment; the comment and the flow map stay.)
  assert.ok(out.startsWith(HEAD + "teams:\n  mine: { team: \"mine:me.aweb.ai\" } # my own team\n"), out);
});

test("a verb works from the file as it is NOW: a stale snapshot never drops another write, and its refusals see the current file", (t) => {
  const fx = fixture(t, "teams:\n  mine: { team: \"mine:me.aweb.ai\" }\ndefaultTeam: mine\n");
  const stale = fx.ctx();
  // Another verb writes after this command read the file.
  teamsAdd(fx.ctx(), "other", { team: "other:me.aweb.ai" });
  teamsAdd(stale, "third", { team: "third:me.aweb.ai" });
  assert.deepEqual(Object.keys(YAML.parse(fx.text()).teams), ["mine", "other", "third"], "both writes are kept");
  // The stale snapshot's default is mine: removing `other`, now the default, is still judged on the current file.
  teamsDefault(fx.ctx(), "other");
  assert.throws(() => teamsRemove(stale, "other"), (e) => e.code === "E_TEAM_IN_USE" && e.details.usedBy.includes("defaultTeam"));
  assert.throws(() => teamsAdd(stale, "other", { team: "x:y" }), (e) => e.code === "E_TEAM_EXISTS" && e.details.from === "local");
  teamsDefault(stale, "mine");
  assert.equal(YAML.parse(fx.text()).defaultTeam, "mine");
});

test("where the workspace does not allow local teams, add and default are refused (local-teams-closed, nothing written); remove is allowed", (t) => {
  const FIX = "either (a) add `localTeams: true` to oats-workspace.yaml, or (b) commit the teams and defaultTeam in oats-workspace.yaml, then remove them from oats-local.yaml";
  for (const workspace of [{ ...WORKSPACE, localTeams: false }, { schemaVersion: 2, name: "acme", teams: WORKSPACE.teams }]) {
    const fx = fixture(t, "teams:\n  mine: { team: \"mine:me.aweb.ai\" }\n  spare: { team: \"spare:me.aweb.ai\" }\n", workspace);
    const before = fx.text();
    assert.throws(() => teamsAdd(fx.ctx(), "third", { team: "third:me.aweb.ai" }), (e) => {
      assert.deepEqual([e.code, e.details], ["E_WORKSPACE_SCHEMA", { reason: "local-teams-closed", path: "oats-local.yaml", keys: ["teams"] }]);
      assert.equal(e.message, `oats teams add writes teams in oats-local.yaml, but oats-workspace.yaml does not allow local teams (localTeams: true): ${FIX}`);
      return true;
    });
    assert.throws(() => teamsDefault(fx.ctx(), "oats"), (e) => e.code === "E_WORKSPACE_SCHEMA" && e.details.reason === "local-teams-closed" && e.details.keys[0] === "defaultTeam");
    assert.equal(fx.text(), before, "nothing was written");
    // Removing local teams moves the file toward what the workspace allows (fix b's last step).
    assert.equal(teamsRemove(fx.ctx(), "mine").changed, true);
    assert.equal(teamsRemove(fx.ctx(), "spare").changed, true);
    assert.equal(YAML.parse(fx.text()).teams, undefined);
  }
  // The standalone view (no workspace file) has no workspace rules.
  const fx = fixture(t, "", null);
  assert.equal(teamsAdd(fx.ctx(), "mine", { team: "mine:me.aweb.ai" }).changed, true);
});
