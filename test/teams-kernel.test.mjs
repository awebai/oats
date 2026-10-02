// Team model v2 (docs/design/2026-09-27-team-model-v2.md, option B), the kernel half as the CLI exposes
// it: SHARED teams committed in oats-workspace.yaml, LOCAL teams + the default + which teams each soul
// belongs to in the deployment's oats-local.yaml, written by `oats teams` / `oats soul teams` (config
// only). The kernel hands the messaging provider the soul's teams here — in the spawn preview, in
// `inspect`, in OATS_DEFAULT_TEAM* / OATS_TEAMS for a home's commands (live: the workspace and
// oats-local.yaml as they are now), and beside the settings in a provider check's environment (never
// on its stdin). Joining any team but the default is the provider's explicit act.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { homeTarget, runProviderCheck } from "../lib/instance-inspect.mjs";

const envProbe = "const u=(k)=>process.env[k]===undefined?null:process.env[k];console.log(JSON.stringify({schemaVersion:1,ok:true,result:{def:u('OATS_DEFAULT_TEAM'),id:u('OATS_DEFAULT_TEAM_ID'),from:u('OATS_DEFAULT_TEAM_FROM'),source:u('OATS_TEAMS_SOURCE'),old:[u('OATS_TEAM_LABEL'),u('OATS_TEAM_LABELS'),u('OATS_TEAM_ID')],teams:u('OATS_TEAMS')===null?null:JSON.parse(process.env.OATS_TEAMS)}}))\n";
// A binding check that answers `ready` and echoes, as a warning, the teams its ENVIRONMENT carries and
// the keys of its stdin request.
const echoCheck = `let raw = ""; process.stdin.on("data", (c) => (raw += c)); process.stdin.on("end", () => {
  const req = JSON.parse(raw);
  process.stdout.write(JSON.stringify({ schemaVersion: 1, phase: "check", slot: "messaging", capability: "acme.chat", ok: true,
    result: { status: "ready", problems: [], warnings: [{ code: "teams-seen", message: JSON.stringify({ def: process.env.OATS_DEFAULT_TEAM, teams: JSON.parse(process.env.OATS_TEAMS), source: process.env.OATS_TEAMS_SOURCE, contextKeys: Object.keys(req.input.context).sort() }) }] } }) + "\\n");
});\n`;

const SHARED = { oats: { team: "oats:oats.aweb.ai", description: "The OATS project" }, night: { description: "Night shift (not created yet)" } };
function fixture({ local = {}, messaging = true } = {}) {
  return v2Deployment({
    name: "acme",
    local,
    souls: { dev: { soul: { capabilities: { "acme.env": { from: "here" }, ...(messaging ? { "acme.chat": { from: "here" } } : {}) } } } },
    capabilities: {
      "acme.env": { manifest: { layer: "knowledge", command: "envprobe", commands: { show: "show.mjs" }, operations: { show: { command: "show", context: "home" } } }, files: { "show.mjs": envProbe } },
      "acme.chat": { manifest: { layer: "messaging", settings: { join: { description: "labels to join at spawn" }, identity: { description: "the identity to use" } }, hooks: { spawn: "spawn.mjs", retire: "retire.mjs" }, binding: { version: 1, normalize: "bn", bind: "bb", check: "bc", reasons: ["not ready"] }, command: "chat", commands: { bn: "noop.mjs", bb: "noop.mjs", bc: "check.mjs", teams: "show.mjs" }, operations: { teams: { command: "teams", context: "home" } } },
        files: { "check.mjs": echoCheck, "noop.mjs": "process.exit(0);\n", "show.mjs": envProbe,
          "retire.mjs": `import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.TEAMS_RETIRE_OUT, JSON.stringify({ def: process.env.OATS_DEFAULT_TEAM, id: process.env.OATS_DEFAULT_TEAM_ID, teams: JSON.parse(process.env.OATS_TEAMS) }));\nprocess.stdout.write("{}\\n");\n`,
          "spawn.mjs": `import { writeFileSync } from "node:fs"; import { join } from "node:path";\nwriteFileSync(join(process.env.OATS_INSTANCE_HOME, "spawn-teams.json"), JSON.stringify({ def: process.env.OATS_DEFAULT_TEAM, id: process.env.OATS_DEFAULT_TEAM_ID, from: process.env.OATS_DEFAULT_TEAM_FROM, teams: JSON.parse(process.env.OATS_TEAMS), settings: JSON.parse(process.env.OATS_SETTINGS) }));\nprocess.stdout.write("{}\\n");\n` } },
    },
    workspace: { teams: SHARED, messaging: { private: "per-human" } },
  });
}
const ok = (r, what) => { assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`); const j = r.json(); assert.equal(j.ok, true, `${what}: ${r.stdout}`); return j.result; };
const refused = (r, code, what) => { const j = r.json(); assert.equal(j.ok, false, `${what}: ${r.stdout}`); assert.equal(j.error.code, code, `${what}: ${r.stdout}`); return j.error; };
const localYaml = (fx) => YAML.parse(readFileSync(join(fx.dep, "oats-local.yaml"), "utf8"));
const MINE = { label: "mine", team: "mine:me.aweb.ai", default: true, from: "local" };
const OATS = { label: "oats", team: "oats:oats.aweb.ai", default: false, from: "shared" };
const NIGHT = { label: "night", team: null, default: false, from: "shared" };

test("oats teams: the deployment's teams; add (the first becomes the default), default, remove refuses a referenced, shared or unknown label", (t) => {
  const fx = fixture(); t.after(fx.cleanup);
  writeFileSync(join(fx.dep, "oats-local.yaml"), `${readFileSync(join(fx.dep, "oats-local.yaml"), "utf8")}# a comment the verbs keep\n`);
  let doc = ok(fx.cli(["teams", "--json"]), "teams");
  assert.equal(doc.teamsApi, 1);
  assert.equal(doc.defaultTeam, null);
  assert.deepEqual(doc.teams.map((r) => [r.label, r.team, r.from, r.default]), [["night", null, "shared", false], ["oats", "oats:oats.aweb.ai", "shared", false]]);
  assert.match(doc.teams[1].at, /oats-workspace\.yaml#\/teams\/oats$/);
  assert.deepEqual(doc.problems.map((p) => [p.code, p.severity]), [["team-unmapped", "warning"]], "the workspace fills no messaging slot (the soul brings its own): no deployment-wide E_TEAM_UNCONFIGURED");

  doc = ok(fx.cli(["teams", "add", "mine", "--team", "mine:me.aweb.ai", "--description", "Mine", "--json"]), "teams add");
  assert.equal(doc.changed, true);
  assert.equal(doc.defaultTeam, "mine", "the first team added becomes the default");
  assert.deepEqual(localYaml(fx).teams, { mine: { team: "mine:me.aweb.ai", description: "Mine" } });
  assert.match(readFileSync(join(fx.dep, "oats-local.yaml"), "utf8"), /# a comment the verbs keep/, "the rest of the file is kept");
  assert.deepEqual(refused(fx.cli(["teams", "add", "oats", "--team", "x:y", "--json"]), "E_TEAM_EXISTS", "add a shared label").details, { label: "oats", from: "shared" });
  assert.deepEqual(refused(fx.cli(["teams", "add", "mine", "--team", "x:y", "--json"]), "E_TEAM_EXISTS", "add twice").details, { label: "mine", from: "local" });
  ok(fx.cli(["teams", "add", "spare", "--team", "spare:me.aweb.ai", "--json"]), "add a second");
  // A hostile provider id never reaches oats-local.yaml (the provider's argv later): the kernel's safety rule.
  const localBefore = readFileSync(join(fx.dep, "oats-local.yaml"), "utf8");
  for (const id of ["--json", "-x"]) refused(fx.cli(["teams", "add", "bad", `--team=${id}`, "--json"]), "E_BAD_ARGS", `option-like id ${id} (the CLI's own guard)`);
  for (const id of ["a b", "a\nb", "x".repeat(257)]) {
    assert.deepEqual(refused(fx.cli(["teams", "add", "bad", "--team", id, "--json"]), "E_BAD_ARGS", `hostile id ${JSON.stringify(id)}`).details, { label: "bad", team: id });
  }
  assert.equal(readFileSync(join(fx.dep, "oats-local.yaml"), "utf8"), localBefore, "nothing was written");
  assert.equal(localYaml(fx).defaultTeam, "mine", "only the first add sets the default");

  ok(fx.cli(["soul", "teams", "*", "--add", "oats", "--json"]), "every soul in oats");
  ok(fx.cli(["soul", "teams", "dev", "--add", "spare", "--default", "spare", "--json"]), "dev: spare, its default");
  assert.deepEqual(refused(fx.cli(["teams", "remove", "mine", "--json"]), "E_TEAM_IN_USE", "remove the default").details, { label: "mine", usedBy: ["defaultTeam"] });
  assert.deepEqual(refused(fx.cli(["teams", "remove", "spare", "--json"]), "E_TEAM_IN_USE", "remove a referenced label").details, { label: "spare", usedBy: ["souls.teams:dev", "souls.default:dev"] });
  assert.deepEqual(refused(fx.cli(["teams", "remove", "oats", "--json"]), "E_TEAM_SHARED", "remove a shared label").details.label, "oats");
  refused(fx.cli(["teams", "remove", "ghost", "--json"]), "E_TEAM_UNKNOWN", "remove an unknown label");
  refused(fx.cli(["teams", "default", "ghost", "--json"]), "E_TEAM_UNKNOWN", "default to an unknown label");

  ok(fx.cli(["soul", "teams", "dev", "--remove", "spare", "--clear-default", "--json"]), "drop dev's references");
  doc = ok(fx.cli(["teams", "remove", "spare", "--json"]), "remove");
  assert.deepEqual(Object.keys(localYaml(fx).teams), ["mine"]);
  doc = ok(fx.cli(["teams", "default", "oats", "--json"]), "default to a shared team");
  assert.equal(doc.defaultTeam, "oats");
  assert.equal(ok(fx.cli(["teams", "default", "oats", "--json"]), "the same again").changed, false);
});

test("oats soul teams: a soul's teams here and why; --default must be one of them; '*' takes no default", (t) => {
  const fx = fixture({ local: { teams: { mine: { team: "mine:me.aweb.ai" } }, defaultTeam: "mine" } }); t.after(fx.cleanup);
  let doc = ok(fx.cli(["soul", "teams", "dev", "--json"]), "soul teams");
  assert.deepEqual(doc, { soulTeamsApi: 1, soul: "dev", key: "dev", defaultTeam: { label: "mine", team: "mine:me.aweb.ai", from: "deployment" },
    teams: [{ ...MINE, via: ["default"] }], local: { teams: [], default: null }, all: [] });
  refused(fx.cli(["soul", "teams", "dev", "--default", "oats", "--json"]), "E_TEAM_NOT_ELIGIBLE", "a default outside the soul's teams");
  assert.equal(localYaml(fx).souls, undefined, "a refused write writes nothing");
  refused(fx.cli(["soul", "teams", "dev", "--add", "ghost", "--json"]), "E_TEAM_UNKNOWN", "an unknown label");
  refused(fx.cli(["soul", "teams", "*", "--default", "oats", "--json"]), "E_BAD_ARGS", "'*' has no default");
  refused(fx.cli(["soul", "teams", "nobody", "--json"]), "E_SOUL_UNKNOWN", "an unknown soul");
  ok(fx.cli(["soul", "teams", "*", "--add", "oats", "--json"]), "* += oats");
  doc = ok(fx.cli(["soul", "teams", "dev", "--add", "night", "--default", "oats", "--json"]), "dev += night, default oats");
  assert.equal(doc.changed, true);
  assert.deepEqual(doc.defaultTeam, { label: "oats", team: "oats:oats.aweb.ai", from: "soul" });
  assert.deepEqual(doc.teams, [{ ...OATS, default: true, via: ["default", "*"] }, { ...NIGHT, via: ["soul"] }], "the deployment default is not dev's team any more");
  assert.deepEqual([doc.local, doc.all], [{ teams: ["night"], default: "oats" }, ["oats"]]);
  assert.deepEqual(localYaml(fx).souls, { teams: { "*": ["oats"], dev: ["night"] }, default: { dev: "oats" } });
  const every = ok(fx.cli(["soul", "teams", "*", "--json"]), "soul teams *");
  assert.deepEqual([every.soul, every.key, every.teams.map((r) => r.label), every.local], ["*", "*", ["mine", "oats"], { teams: ["oats"], default: null }]);
});

test("spawn preview, inspect --soul and `oats souls` report the soul's teams here and its default; feature team-model-2", (t) => {
  const fx = fixture({ local: { teams: { mine: { team: "mine:me.aweb.ai" } }, defaultTeam: "mine", souls: { teams: { dev: ["oats", "night"] } } } }); t.after(fx.cleanup);
  const preview = ok(fx.cli(["spawn", "dev", "--preview", "--json"]), "spawn --preview");
  assert.deepEqual(preview.teams, [MINE, NIGHT, OATS], "default first, then by label; the unmapped row reported");
  assert.deepEqual(preview.defaultTeam, { label: "mine", team: "mine:me.aweb.ai", from: "deployment" });
  assert.equal("team" in preview, false, "no primary label");
  assert.deepEqual(preview.settings["acme.chat"], { private: "per-human" }, "teams are never settings");
  const doc = ok(fx.cli(["inspect", "--soul", "dev", "--json"]), "inspect --soul");
  assert.deepEqual([doc.teams, doc.defaultTeam, doc.teamsSource], [[MINE, NIGHT, OATS], preview.defaultTeam, "live"]);
  assert.equal("team" in doc.subject, false);
  assert.equal("team" in doc.souls[0], false);
  const row = ok(fx.cli(["souls", "--json"]), "souls").souls.find((s) => s.name === "dev");
  assert.deepEqual([row.teams, row.defaultTeam, "team" in row, "labels" in row], [[MINE, NIGHT, OATS], preview.defaultTeam, false, false]);
  const version = JSON.parse(fx.cli(["version", "--json"]).stdout);
  assert.ok(version.features.includes("team-model-2"));
  assert.equal(version.features.includes("teams"), false, "team-model-2 replaces teams");
  const status = ok(fx.cli(["workspace", "status", "--json"]), "workspace status");
  assert.deepEqual(status.workspace.teams, [{ label: "night", team: null, description: "Night shift (not created yet)" }, { label: "oats", team: "oats:oats.aweb.ai", description: "The OATS project" }]);
  assert.equal("byTeam" in status.defaults, false);
  assert.deepEqual(status.warnings, []);
});

test("an unknown or ineligible label in oats-local.yaml refuses the spawn preview and inspect --soul", (t) => {
  const fx = fixture({ local: { defaultTeam: "ghost" } }); t.after(fx.cleanup);
  assert.deepEqual(refused(fx.cli(["spawn", "dev", "--preview", "--json"]), "E_TEAM_UNKNOWN", "preview").details, { label: "ghost", at: "oats-local.yaml#/defaultTeam" });
  refused(fx.cli(["inspect", "--soul", "dev", "--json"]), "E_TEAM_UNKNOWN", "inspect --soul");
  const rd = ok(fx.cli(["readiness", "--soul", "dev", "--json"]), "readiness reports it");
  const items = rd.checks.configured.items.filter((i) => i.producer === "team model");
  assert.deepEqual(items.map((i) => [i.subject, i.code, i.status, i.required, i.condition]), [["team ghost", "E_TEAM_UNKNOWN", "fail", true, undefined],
    ["teams", "team-model-3-migration", "fail", false, "local-teams-closed"]], "a local defaultTeam without localTeams: true warns (0.36.x)");
  assert.equal(rd.checks.installed.items.some((i) => i.code === "E_TEAM_UNKNOWN"), false, "reported once, as configuration");
  assert.deepEqual(Object.keys(rd.checks), ["installed", "configured", "member", "providers"], "no fifth check");
});

test("readiness: no default with messaging is E_TEAM_UNCONFIGURED; an unmapped default blocks with team-unmapped default:true; unmapped extras warn", (t) => {
  const fx = fixture(); t.after(fx.cleanup);
  const items = () => ok(fx.cli(["readiness", "--soul", "dev", "--json"]), "readiness").checks.configured.items.filter((i) => i.producer === "team model");
  assert.deepEqual(items().map((i) => [i.subject, i.code, i.required]), [["teams", "E_TEAM_UNCONFIGURED", true]]);
  ok(fx.cli(["teams", "default", "night", "--json"]), "default to the unmapped shared team");
  const [unmapped] = items();
  assert.deepEqual([unmapped.code, unmapped.label, unmapped.default, unmapped.required, unmapped.reason], ["team-unmapped", "night", true, true, "the default team night has no provider id yet"]);
  assert.equal(unmapped.remedy, "its owner runs `oats aweb setup`, then commits the id; or choose another default with `oats teams default`");
  const preview = ok(fx.cli(["spawn", "dev", "--preview", "--json"]), "preview with an unmapped default");
  assert.deepEqual(preview.defaultTeam, { label: "night", team: null, from: "deployment" });
  ok(fx.cli(["teams", "default", "oats", "--json"]), "a mapped default");
  ok(fx.cli(["soul", "teams", "dev", "--add", "night", "--json"]), "night as an extra");
  assert.deepEqual(items().map((i) => [i.code, i.label, i.default, i.required, i.condition]), [["team-unmapped", "night", false, false, undefined],
    ["team-model-3-migration", undefined, undefined, false, "local-soul-teams"], ["team-model-3-migration", undefined, undefined, false, "local-teams-closed"]]);
  // A shared label also declared locally: the committed definition wins; a warning.
  ok(fx.cli(["teams", "add", "zed", "--team", "zed:me.aweb.ai", "--json"]), "a local team");
  const ws = YAML.parse(readFileSync(join(fx.base, "seed", "oats-workspace.yaml"), "utf8"));
  ws.teams.zed = { team: "zed:shared.aweb.ai" };
  fx.commit({ "oats-workspace.yaml": YAML.stringify(ws, { lineWidth: 0 }) }, "share zed");
  ok(fx.cli(["soul", "teams", "dev", "--add", "zed", "--json"]), "dev in zed");
  const collision = items().find((i) => i.code === "team-label-collision");
  assert.deepEqual([collision.label, collision.required, collision.shared.team, collision.local.team], ["zed", false, "zed:shared.aweb.ai", "zed:me.aweb.ai"]);
  assert.equal(ok(fx.cli(["spawn", "dev", "--preview", "--json"]), "preview").teams.find((r) => r.label === "zed").team, "zed:shared.aweb.ai");
  ok(fx.cli(["teams", "remove", "zed", "--json"]), "the collision's fix: the local copy goes even while referenced (the shared label still resolves)");
});

test("a home's teams are LIVE: its commands, operations, inspect --home and a provider check follow oats-local.yaml; the spawn record stays frozen", async (t) => {
  const fx = fixture({ local: { teams: { mine: { team: "mine:me.aweb.ai" } }, defaultTeam: "mine", souls: { teams: { dev: ["oats", "night"] } } } }); t.after(fx.cleanup);
  const { home } = await fx.spawn("dev", { instance: "dev-teams" });
  const meta0 = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  assert.deepEqual(meta0.teams, [MINE, OATS], "spawn records what the providers received: mapped rows only");
  assert.deepEqual(meta0.defaultTeam, { label: "mine", team: "mine:me.aweb.ai", from: "deployment" });
  assert.equal("team" in meta0.workspace.soul || "labels" in meta0.workspace.soul, false);
  const spawnHook = JSON.parse(readFileSync(join(home, "spawn-teams.json"), "utf8"));
  assert.deepEqual(spawnHook, { def: "mine", id: "mine:me.aweb.ai", from: "deployment", teams: [MINE, OATS], settings: { private: "per-human" } });

  const inHome = (ns, sub) => ok(fx.cli([ns, sub, "--json"], { cwd: home, env: { OATS_INSTANCE_HOME: home, OATS_TEAM_ID: "ambient", OATS_DEFAULT_TEAM_ID: "ambient" } }), `${ns} ${sub} in the home`);
  let seen = inHome("chat", "teams");
  assert.deepEqual([seen.def, seen.id, seen.from, seen.source, seen.teams, seen.old], ["mine", "mine:me.aweb.ai", "deployment", "live", [MINE, OATS], [null, null, null]], "no pre-0.30 name, never an ambient value");
  // The soul gains a default of its own here: the live views follow; the record does not.
  ok(fx.cli(["soul", "teams", "dev", "--default", "oats", "--json"]), "dev's default");
  seen = inHome("chat", "teams");
  assert.deepEqual([seen.def, seen.from, seen.teams], ["oats", "soul", [{ ...OATS, default: true }]]);
  seen = inHome("envprobe", "show");
  assert.deepEqual([seen.def, seen.teams, seen.source], ["mine", [MINE, OATS], "recorded"], "a non-messaging command reads no remote: the record");
  // The same split for provider operations run on the home: the messaging layer's live, others recorded.
  const operation = (address) => ok(fx.cli(["operation", "run", address, "--home", home, "--json"]), `operation run ${address}`).result;
  seen = operation("messaging:teams");
  assert.deepEqual([seen.def, seen.from, seen.teams, seen.source], ["oats", "soul", [{ ...OATS, default: true }], "live"]);
  seen = operation("knowledge:show");
  assert.deepEqual([seen.def, seen.teams, seen.source], ["mine", [MINE, OATS], "recorded"], "a non-messaging operation reads no remote: the record");
  const doc = ok(fx.cli(["inspect", "--home", home, "--json"]), "inspect --home");
  assert.deepEqual([doc.defaultTeam, doc.recordedDefaultTeam, doc.teamsSource], [{ label: "oats", team: "oats:oats.aweb.ai", from: "soul" }, meta0.defaultTeam, "live"]);
  assert.deepEqual(doc.teams, [{ ...OATS, default: true }, NIGHT], "live report rows include the unmapped one");
  const rd = ok(fx.cli(["readiness", "--home", home, "--json"]), "readiness --home");
  const changed = rd.checks.configured.items.find((i) => i.code === "default-team-changed");
  assert.deepEqual([changed.required, changed.recorded.label, changed.current.label, changed.remedy], [false, "mine", "oats", "respawn"]);
  const check = rd.checks.providers.items.find((i) => i.subject === "acme.chat");
  const echoed = JSON.parse(check.result.warnings.find((w) => w.code === "teams-seen").message);
  assert.deepEqual(echoed, { def: "oats", teams: [{ ...OATS, default: true }], source: "live", contextKeys: ["deployment", "home", "instance", "kind", "soul", "workspace"] }, "no team on the released wire");
  // The workspace host unreachable → the spawn record, marked `recorded`.
  const bare = fx.repo, parked = `${fx.repo}.parked`;
  renameSync(bare, parked);
  try {
    seen = inHome("chat", "teams");
    assert.deepEqual([seen.def, seen.teams, seen.source], ["mine", [MINE, OATS], "recorded"]);
    const off = ok(fx.cli(["inspect", "--home", home, "--json"]), "inspect --home, host unreachable");
    assert.deepEqual([off.teams, off.defaultTeam, off.teamsSource], [[MINE, OATS], meta0.defaultTeam, "recorded"], "the record, marked recorded");
  } finally { renameSync(parked, bare); }
  assert.deepEqual(JSON.parse(readFileSync(join(home, "instance.json"), "utf8")).teams, meta0.teams, "the spawn record is evidence, never rewritten");
  const out = join(fx.base, "retire-teams.json");
  const retired = fx.cli(["retire", "dev-teams", "--json"], { env: { TEAMS_RETIRE_OUT: out } });
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), { def: "mine", id: "mine:me.aweb.ai", teams: [MINE, OATS] }, "retire works from the record");
});

test("an unmapped default reaches the provider as the label and FROM without the id", async (t) => {
  const fx = fixture({ local: { defaultTeam: "night" } }); t.after(fx.cleanup);
  const { home } = await fx.spawn("dev", { instance: "dev-unmapped" });
  const spawnHook = JSON.parse(readFileSync(join(home, "spawn-teams.json"), "utf8"));
  assert.deepEqual(spawnHook, { def: "night", from: "deployment", teams: [], settings: { private: "per-human" } }, "OATS_DEFAULT_TEAM_ID unset");
  assert.deepEqual(JSON.parse(readFileSync(join(home, "instance.json"), "utf8")).defaultTeam, { label: "night", team: null, from: "deployment" });
});

test("the REAL bundled oats.aweb binding check decodes the kernel's check request: the teams never break its strict wire", async (t) => {
  const fx = fixture({ local: { teams: { mine: { team: "mine:me.aweb.ai" } }, defaultTeam: "mine", souls: { teams: { dev: ["oats"] } } } }); t.after(fx.cleanup);
  const { home } = await fx.spawn("dev", { instance: "dev-aweb" });
  const meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  const target = await homeTarget(home, meta);
  assert.deepEqual([target.teams, target.teamsSource], [[MINE, OATS], "live"]);
  const dir = fileURLToPath(new URL("../mirrors/oats-aweb", import.meta.url));
  const manifest = JSON.parse(readFileSync(join(dir, "oats.json"), "utf8"));
  const catalog = JSON.parse(readFileSync(fileURLToPath(new URL("../package-catalog.json", import.meta.url)), "utf8"));
  assert.equal(`v${manifest.version}`, catalog.packages["oats.aweb"].ref, "the bundled provider is the catalog's pinned release");
  const aweb = { ...target, payloads: { ...target.payloads, "oats.aweb": {} }, slots: { ...target.slots, messaging: "oats.aweb" } };
  const out = runProviderCheck(aweb, { name: "oats.aweb", manifest }, dir);
  // Its decoder accepted the request: the answer is one of its check statuses, never its wire refusal
  // (`invalid-binding` / `provider-not-qualified`).
  assert.equal(out.outcome, "result", JSON.stringify(out));
  assert.equal(out.result.problems.some((p) => ["invalid-binding", "provider-not-qualified"].includes(p.code)), false, JSON.stringify(out));
  // What the bundled 1.18.1 answers under the 0.30 env (its actual output, recorded from this run):
  // needs-configuration for the missing messaging root only. It reads the kernel's default team
  // (OATS_DEFAULT_TEAM_ID), so the 1.16 "no team" problem is gone. An `aw` version problem depends on the machine.
  assert.equal(out.result.status, "needs-configuration", JSON.stringify(out));
  const reasons = out.result.problems.filter((p) => !/^aw /.test(p.message)).map((p) => [p.code, p.message.replace(/ at \S+:/, " at <deployment>:")]);
  assert.deepEqual(reasons, [
    ["needs-configuration", "no messaging root at <deployment>: run oats aweb setup there or set settings.oats.aweb.root"],
  ], JSON.stringify(out));
  assert.deepEqual(out.result.warnings, [], JSON.stringify(out));
});

test("the spawn preview's modules and inspect's capabilities list the setting keys each manifest DECLARES (names only); feature settings-declared", async (t) => {
  const fx = fixture(); t.after(fx.cleanup);
  const declares = (rows, key) => Object.fromEntries(rows.map((r) => [r[key], r.declares]));
  const preview = ok(fx.cli(["spawn", "dev", "--preview", "--json"]), "spawn --preview");
  assert.deepEqual(declares(preview.modules, "name"), { "acme.chat": ["identity", "join"], "acme.env": [] }, "sorted key names; a manifest with no settings declares []");
  const soul = ok(fx.cli(["inspect", "--soul", "dev", "--json"]), "inspect --soul");
  assert.deepEqual(declares(soul.capabilities, "id"), { "acme.chat": ["identity", "join"], "acme.env": [] });
  const { home } = await fx.spawn("dev", { instance: "dev-declares" });
  const doc = ok(fx.cli(["inspect", "--home", home, "--json"]), "inspect --home");
  assert.deepEqual(declares(doc.capabilities, "id"), { "acme.chat": ["identity", "join"], "acme.env": [] }, "a home answers from its own module copies");
  assert.equal(JSON.stringify(doc.capabilities).includes("labels to join at spawn"), false, "never a declaration's description");
  const version = JSON.parse(fx.cli(["version", "--json"]).stdout);
  assert.ok(version.features.includes("settings-declared"));
});

test("a package soul carrying the removed `team:` is refused (not listed), naming the move", async (t) => {
  const { discoverPackageSouls } = await import("../lib/workspace.mjs");
  const soulYaml = "schemaVersion: 2\nname: harvester\ndescription: d\nwork: directory\nteam: okf\n";
  const remote = {
    parseRepoRef: (ref) => ({ key: ref.replace(/^git:/, "") }),
    readRemoteFile: async () => ({ bytes: Buffer.from(soulYaml) }),
    observeRemote: async () => { throw new Error("not read"); }, listRemoteTree: async () => [],
  };
  const lock = { packages: { "oats.okf": { version: "4.0.1", commit: "a".repeat(40), path: "oats-package", url: "git:github.com/awebai/oats-okf", souls: [{ name: "harvester", path: "souls/harvester", digest: "sha256-x" }] } } };
  const { souls, problems } = await discoverPackageSouls({ packages: { "oats.okf": "v4.0.1" } }, lock, { remote });
  assert.deepEqual(souls, []);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].code, "E_WORKSPACE_SCHEMA");
  assert.match(problems[0].message, /team membership is local since 0\.30: `oats soul teams`/);
});
