// Teams contract 2026-09-25 (docs/design/2026-09-25-teams-contract.md), the kernel half as the CLI
// exposes it: a soul names several team labels; the kernel hands the messaging provider every
// label's payload as the ELIGIBLE teams — in the spawn preview, in `inspect`, in OATS_TEAMS for a
// home's commands (live: the workspace as it is now, never the spawn's frozen view), and beside
// the settings on a provider check's stdin. Joining any of them is the provider's explicit act.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const envProbe = "console.log(JSON.stringify({schemaVersion:1,ok:true,result:{labels:process.env.OATS_TEAM_LABELS,label:process.env.OATS_TEAM_LABEL,id:process.env.OATS_TEAM_ID,source:process.env.OATS_TEAMS_SOURCE,teams:process.env.OATS_TEAMS===''?null:JSON.parse(process.env.OATS_TEAMS)}}))\n";
// A binding check that answers `ready` and echoes the `teams` it was handed on stdin as a warning.
const echoCheck = `let raw = ""; process.stdin.on("data", (c) => (raw += c)); process.stdin.on("end", () => {
  const req = JSON.parse(raw);
  process.stdout.write(JSON.stringify({ schemaVersion: 1, phase: "check", slot: "messaging", capability: "acme.chat", ok: true,
    result: { status: "ready", problems: [], warnings: [{ code: "teams-seen", message: JSON.stringify({ teams: req.teams, teamsSource: req.teamsSource, settingsHasTeams: "teams" in req.settings }) }] } }) + "\\n");
});\n`;

function fixture() {
  return v2Deployment({
    name: "acme",
    souls: { dev: { soul: { team: ["global", "night"], capabilities: { "acme.env": { from: "here" }, "acme.chat": { from: "here" } } } } },
    capabilities: {
      "acme.env": { manifest: { layer: "knowledge", command: "envprobe", commands: { show: "show.mjs" }, operations: { show: { command: "show", context: "home" } } }, files: { "show.mjs": envProbe } },
      "acme.chat": { manifest: { layer: "messaging", hooks: { spawn: "spawn.mjs", retire: "retire.mjs" }, binding: { version: 1, normalize: "bn", bind: "bb", check: "bc", reasons: ["not ready"] }, command: "chat", commands: { bn: "noop.mjs", bb: "noop.mjs", bc: "check.mjs", teams: "show.mjs" }, operations: { teams: { command: "teams", context: "home" } } },
        files: { "check.mjs": echoCheck, "noop.mjs": "process.exit(0);\n", "show.mjs": envProbe,
          "retire.mjs": `import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.TEAMS_RETIRE_OUT, JSON.stringify({ label: process.env.OATS_TEAM_LABEL, id: process.env.OATS_TEAM_ID, labels: process.env.OATS_TEAM_LABELS, teams: JSON.parse(process.env.OATS_TEAMS) }));\nprocess.stdout.write("{}\\n");\n`,
          "spawn.mjs": `import { writeFileSync } from "node:fs"; import { join } from "node:path";\nwriteFileSync(join(process.env.OATS_INSTANCE_HOME, "spawn-teams.json"), JSON.stringify({ labels: process.env.OATS_TEAM_LABELS, teams: JSON.parse(process.env.OATS_TEAMS), settings: JSON.parse(process.env.OATS_SETTINGS) }));\nprocess.stdout.write("{}\\n");\n` } },
    },
    workspace: {
      teams: { global: { description: "Everyone" }, night: { description: "Night shift" } },
      messaging: { private: "per-human", byTeam: { global: { team: "aweb:acme.global" } } },
    },
  });
}
const GLOBAL = { label: "global", team: "aweb:acme.global", mapped: true, payload: { private: "per-human", team: "aweb:acme.global" } };
const NIGHT_UNMAPPED = { label: "night", team: null, mapped: false, payload: { private: "per-human" } };
const NIGHT_MAPPED = { label: "night", team: "aweb:acme.night", mapped: true, payload: { private: "per-human", team: "aweb:acme.night" } };
const ok = (r, what) => { assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`); const j = r.json(); assert.equal(j.ok, true, `${what}: ${r.stdout}`); return j.result; };
const workspaceChange = (fx, edit) => {
  const ws = YAML.parse(readFileSync(join(fx.base, "seed", "oats-workspace.yaml"), "utf8"));
  edit(ws);
  return { "oats-workspace.yaml": YAML.stringify(ws, { lineWidth: 0 }) };
};

test("spawn preview and inspect --soul show the eligible teams, one per label in soul order; `oats souls` lists every label", (t) => {
  const fx = fixture(); t.after(fx.cleanup);
  const preview = ok(fx.cli(["spawn", "dev", "--preview", "--json"]), "spawn --preview");
  assert.deepEqual(preview.teams, [GLOBAL, NIGHT_UNMAPPED]);
  assert.equal(preview.team, "global", "`team` stays the primary label");
  assert.deepEqual(preview.settings["acme.chat"], { private: "per-human", team: "aweb:acme.global" }, "the merged payload is the PRIMARY label's, and carries no teams list");
  const doc = ok(fx.cli(["inspect", "--soul", "dev", "--json"]), "inspect --soul");
  assert.deepEqual(doc.teams, [GLOBAL, NIGHT_UNMAPPED]);
  assert.equal(doc.teamsSource, "live");
  const souls = ok(fx.cli(["souls", "--json"]), "souls");
  assert.deepEqual(souls.souls.find((s) => s.name === "dev").labels, ["global", "night"]);
  const version = JSON.parse(fx.cli(["version", "--json"]).stdout);
  assert.ok(version.features.includes("teams"), "feature `teams` advertises the surface");
});

test("a home's teams are LIVE: inspect --home, a home's command (OATS_TEAMS) and a provider check's stdin follow the workspace; the spawn record and modules stay frozen", async (t) => {
  const fx = fixture(); t.after(fx.cleanup);
  const { home } = await fx.spawn("dev", { instance: "dev-teams" });
  const meta0 = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  assert.deepEqual(meta0.teams, [GLOBAL, NIGHT_UNMAPPED], "spawn records the eligible teams (evidence)");
  assert.deepEqual(meta0.workspace.soul.labels, ["global", "night"]);
  assert.equal("teams" in meta0.providers, false, "never inside the capability-keyed providers map");
  const spawnHook = JSON.parse(readFileSync(join(home, "spawn-teams.json"), "utf8"));
  assert.deepEqual(spawnHook, { labels: "global,night", teams: [GLOBAL, NIGHT_UNMAPPED], settings: { private: "per-human", team: "aweb:acme.global" } }, "the spawn hook gets OATS_TEAMS beside OATS_SETTINGS, which stays the primary's payload");
  // The MESSAGING module's commands (its team verbs) get the teams live; every other command gets
  // the spawn record at no remote cost, marked `recorded` (review A1, OATS_TEAMS_SOURCE).
  const inHome = (ns, sub) => ok(fx.cli([ns, sub, "--json"], { cwd: home, env: { OATS_INSTANCE_HOME: home } }), `${ns} ${sub} in the home`);
  const messaging = () => inHome("chat", "teams");
  const other = () => inHome("envprobe", "show");
  let seen = messaging();
  assert.deepEqual([seen.labels, seen.label, seen.id, seen.source], ["global,night", "global", "aweb:acme.global", "live"]);
  assert.deepEqual(seen.teams, [GLOBAL, NIGHT_UNMAPPED]);
  // The workspace maps "night" after the spawn: the live views see it now.
  fx.commit(workspaceChange(fx, (ws) => { ws.messaging.byTeam.night = { team: "aweb:acme.night" }; }), "map night");
  seen = messaging();
  assert.deepEqual([seen.teams, seen.source], [[GLOBAL, NIGHT_MAPPED], "live"]);
  seen = other();
  assert.deepEqual([seen.teams, seen.source], [[GLOBAL, NIGHT_UNMAPPED], "recorded"], "a non-messaging command reads no remote: the record, marked recorded");
  // The same split for provider operations run on the home: the messaging layer's live, others recorded.
  const operation = (address) => ok(fx.cli(["operation", "run", address, "--home", home, "--json"]), `operation run ${address}`).result;
  seen = operation("messaging:teams");
  assert.deepEqual([seen.teams, seen.source], [[GLOBAL, NIGHT_MAPPED], "live"]);
  seen = operation("knowledge:show");
  assert.deepEqual([seen.teams, seen.source], [[GLOBAL, NIGHT_UNMAPPED], "recorded"], "a non-messaging operation reads no remote: the record");
  const doc = ok(fx.cli(["inspect", "--home", home, "--json"]), "inspect --home");
  assert.deepEqual(doc.teams, [GLOBAL, NIGHT_MAPPED]);
  assert.equal(doc.teamsSource, "live");
  const rd = ok(fx.cli(["readiness", "--home", home, "--json"]), "readiness --home");
  const check = rd.checks.providers.items.find((i) => i.subject === "acme.chat");
  const echoed = JSON.parse(check.result.warnings.find((w) => w.code === "teams-seen").message);
  assert.deepEqual(echoed, { teams: [GLOBAL, NIGHT_MAPPED], teamsSource: "live", settingsHasTeams: false }, "teams and their source beside the settings on stdin, never inside them");
  // …and removing it takes it away again.
  fx.commit(workspaceChange(fx, (ws) => { delete ws.messaging.byTeam.night; }), "unmap night");
  assert.deepEqual(messaging().teams, [GLOBAL, NIGHT_UNMAPPED]);
  // Review B: the workspace host unreachable → the spawn record, marked `recorded` everywhere, so a
  // provider never LEAVES a membership on a stale list; the command still runs.
  const bare = fx.repo, parked = `${fx.repo}.parked`;
  renameSync(bare, parked);
  try {
    seen = messaging();
    assert.deepEqual([seen.teams, seen.source], [[GLOBAL, NIGHT_UNMAPPED], "recorded"]);
    const off = ok(fx.cli(["inspect", "--home", home, "--json"]), "inspect --home, host unreachable");
    assert.deepEqual([off.teams, off.teamsSource], [[GLOBAL, NIGHT_UNMAPPED], "recorded"]);
  } finally { renameSync(parked, bare); }
  const meta1 = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  assert.deepEqual(meta1.modules, meta0.modules, "modules stay frozen");
  assert.deepEqual(meta1.teams, meta0.teams, "the spawn record is evidence, never rewritten");
  // Retire works from the RECORD (the provider revokes what it recorded, never the live set), and
  // gets the primary's team facts from the home's recorded workspace and payload.
  const out = join(fx.base, "retire-teams.json");
  const retired = fx.cli(["retire", "dev-teams", "--json"], { env: { TEAMS_RETIRE_OUT: out } });
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), { label: "global", id: "aweb:acme.global", labels: "global,night", teams: [GLOBAL, NIGHT_UNMAPPED] });
});

test("an unmapped label is a workspace-status WARNING; two labels that disagree on a capability refuse the spawn preview with E_TEAM_CONFLICT", (t) => {
  const fx = fixture(); t.after(fx.cleanup);
  const status = ok(fx.cli(["workspace", "status", "--json"]), "workspace status");
  assert.deepEqual(status.warnings.map((w) => [w.code, w.label, w.souls]), [["unmapped-team-label", "night", ["dev"]]]);
  assert.equal(status.problems.some((p) => p.code === "unmapped-team-label"), false);
  const human = fx.cli(["workspace", "status"]);
  assert.match(human.stdout, /Warnings:\n\s+unmapped-team-label\s+team "night" has no messaging\.byTeam entry; its souls \(dev\) fall back to the personal team for it/);
  fx.commit(workspaceChange(fx, (ws) => {
    // acme.other: a capability the soul does not name itself (a soul's own entry would settle it).
    ws.defaults.byTeam = { global: { capabilities: { "acme.other": { from: fx.key } } }, night: { capabilities: { "acme.other": "off" } } };
  }), "conflicting team defaults");
  const r = fx.cli(["spawn", "dev", "--preview", "--json"]);
  const j = r.json();
  assert.equal(j.ok, false, r.stdout);
  assert.equal(j.error.code, "E_TEAM_CONFLICT");
  assert.match(j.error.message, /"global" and "night"/);
});
