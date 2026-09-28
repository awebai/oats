// The team verbs' writes to oats-local.yaml (lib/teams-verbs.mjs): surgical (comments and styles kept on
// everything the edit does not change) and from the file as it is NOW (never the command's snapshot).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { soulTeamsEdit, teamsAdd, teamsDefault, teamsRemove } from "../lib/teams-verbs.mjs";

const HEAD = "schemaVersion: 2\nworkspace: git:github.com/acme/agents\n";
function fixture(t, text) {
  const dir = mkdtempSync(join(tmpdir(), "oats-teams-verbs-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const localPath = join(dir, "oats-local.yaml");
  writeFileSync(localPath, HEAD + text);
  const ctx = () => ({ deployment: dir, localPath, local: YAML.parse(readFileSync(localPath, "utf8")), workspace: { schemaVersion: 2, name: "acme", teams: { oats: { team: "oats:oats.aweb.ai" } } }, workspaceKey: "github.com/acme/agents" });
  return { localPath, ctx, text: () => readFileSync(localPath, "utf8") };
}

test("an edit touches only what changes: inline comments on sibling entries survive, a flow list stays flow", (t) => {
  const fx = fixture(t, [
    "teams:",
    "  mine: { team: \"mine:me.aweb.ai\" }   # my own team",
    "  spare:",
    "    team: spare:me.aweb.ai            # the spare id",
    "    description: Spare                # keep me",
    "defaultTeam: mine                     # the default",
    "souls:",
    "  teams:",
    "    dev: [mine, oats]                 # dev's teams",
    "    ops:                              # ops' teams",
    "      - mine                          # first",
    "      - spare                         # second",
    "  default:",
    "    ops: spare                        # ops' default",
    "",
  ].join("\n"));
  teamsAdd(fx.ctx(), "third", { team: "third:me.aweb.ai" });
  soulTeamsEdit(fx.ctx(), "dev", { add: ["third"] });
  soulTeamsEdit(fx.ctx(), "ops", { remove: ["mine"] });
  soulTeamsEdit(fx.ctx(), "dev", { setDefault: "oats" });
  const out = fx.text();
  for (const c of ["# my own team", "# the spare id", "# keep me", "# the default", "# dev's teams", "# ops' teams", "# second", "# ops' default"]) assert.ok(out.includes(c), `${c} kept:\n${out}`);
  assert.equal(out.includes("# first"), false, "the removed item's own comment goes with it");
  assert.match(out, /dev: \[ mine, oats, third \]/, `the flow list stays flow:\n${out}`);
  assert.deepEqual(YAML.parse(out).souls, { teams: { dev: ["mine", "oats", "third"], ops: ["spare"] }, default: { ops: "spare", dev: "oats" } });
  // Emptying a map removes it, and an empty `souls` goes too; the rest of the file stays byte-equal.
  soulTeamsEdit(fx.ctx(), "dev", { clearDefault: true });
  soulTeamsEdit(fx.ctx(), "ops", { clearDefault: true });
  assert.equal(YAML.parse(fx.text()).souls.default, undefined);
  // (The YAML library normalises the spacing before an inline comment; the comment and the flow map stay.)
  assert.ok(fx.text().startsWith(HEAD + "teams:\n  mine: { team: \"mine:me.aweb.ai\" } # my own team\n"), fx.text());
});

test("a verb works from the file as it is NOW: a stale snapshot never drops another write, and its refusals see the current file", (t) => {
  const fx = fixture(t, "teams:\n  mine: { team: \"mine:me.aweb.ai\" }\ndefaultTeam: mine\n");
  const stale = fx.ctx();
  // Another verb writes after this command read the file.
  teamsAdd(fx.ctx(), "other", { team: "other:me.aweb.ai" });
  teamsAdd(stale, "third", { team: "third:me.aweb.ai" });
  assert.deepEqual(Object.keys(YAML.parse(fx.text()).teams), ["mine", "other", "third"], "both writes are kept");
  // The stale snapshot has no `other`: removing it is still judged on the current file.
  soulTeamsEdit(fx.ctx(), "dev", { add: ["other"] });
  assert.throws(() => teamsRemove(stale, "other"), (e) => e.code === "E_TEAM_IN_USE" && e.details.usedBy.includes("souls.teams:dev"));
  assert.throws(() => teamsAdd(stale, "other", { team: "x:y" }), (e) => e.code === "E_TEAM_EXISTS" && e.details.from === "local");
  teamsDefault(stale, "other");
  assert.equal(YAML.parse(fx.text()).defaultTeam, "other");
});

test("oats soul teams --default outside the soul's teams is E_TEAM_NOT_ELIGIBLE with `at`, and nothing is written", (t) => {
  const fx = fixture(t, "teams:\n  mine: { team: \"mine:me.aweb.ai\" }\n");
  const before = fx.text();
  assert.throws(() => soulTeamsEdit(fx.ctx(), "oats.okf/harvester", { setDefault: "mine" }), (e) => {
    assert.equal(e.code, "E_TEAM_NOT_ELIGIBLE");
    assert.deepEqual(e.details, { soul: "oats.okf/harvester", label: "mine", at: "oats-local.yaml#/souls/default/oats.okf~1harvester" });
    return true;
  });
  assert.equal(fx.text(), before);
});
