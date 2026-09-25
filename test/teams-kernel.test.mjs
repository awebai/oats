// Teams contract 2026-09-25 (docs/design/2026-09-25-teams-contract.md), the kernel half as the CLI
// exposes it: a soul names several team labels; the kernel hands the messaging provider every
// label's payload as the ELIGIBLE teams — in the spawn preview, in `inspect`, in OATS_TEAMS for a
// home's commands (live: the workspace as it is now, never the spawn's frozen view), and beside
// the settings in a provider check's environment (never on its stdin: the released binding wire is
// decoded strictly). Joining any of them is the provider's explicit act.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { homeTarget, runProviderCheck } from "../lib/instance-inspect.mjs";

const envProbe = "console.log(JSON.stringify({schemaVersion:1,ok:true,result:{labels:process.env.OATS_TEAM_LABELS,label:process.env.OATS_TEAM_LABEL,id:process.env.OATS_TEAM_ID,source:process.env.OATS_TEAMS_SOURCE,teams:process.env.OATS_TEAMS===''?null:JSON.parse(process.env.OATS_TEAMS)}}))\n";
// A binding check that answers `ready` and echoes, as a warning, the teams its ENVIRONMENT carries
// and the keys of its stdin request.
const echoCheck = `let raw = ""; process.stdin.on("data", (c) => (raw += c)); process.stdin.on("end", () => {
  const req = JSON.parse(raw);
  process.stdout.write(JSON.stringify({ schemaVersion: 1, phase: "check", slot: "messaging", capability: "acme.chat", ok: true,
    result: { status: "ready", problems: [], warnings: [{ code: "teams-seen", message: JSON.stringify({ teams: JSON.parse(process.env.OATS_TEAMS), source: process.env.OATS_TEAMS_SOURCE, labels: process.env.OATS_TEAM_LABELS, requestKeys: Object.keys(req).sort(), settingsHasTeams: "teams" in req.settings }) }] } }) + "\\n");
});\n`;

function fixture({ local = {} } = {}) {
  return v2Deployment({
    name: "acme",
    local,
    souls: { dev: { soul: { team: ["global", "night"], capabilities: { "acme.env": { from: "here" }, "acme.chat": { from: "here" } } } } },
    capabilities: {
      "acme.env": { manifest: { layer: "knowledge", command: "envprobe", commands: { show: "show.mjs" }, operations: { show: { command: "show", context: "home" } } }, files: { "show.mjs": envProbe } },
      "acme.chat": { manifest: { layer: "messaging", settings: { join: { description: "labels to join at spawn" }, identity: { description: "the identity to use" } }, hooks: { spawn: "spawn.mjs", retire: "retire.mjs" }, binding: { version: 1, normalize: "bn", bind: "bb", check: "bc", reasons: ["not ready"] }, command: "chat", commands: { bn: "noop.mjs", bb: "noop.mjs", bc: "check.mjs", teams: "show.mjs" }, operations: { teams: { command: "teams", context: "home" } } },
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
  // Amendment K: no label's byTeam entry is merged into the settings, the primary's included; its
  // payload is teams[0].payload (GLOBAL), and the settings carry no teams list.
  assert.deepEqual(preview.settings["acme.chat"], { private: "per-human" }, "the mapped primary's team is NOT in the settings");
  assert.equal(Object.values(preview.settingsOrigins["acme.chat"]).some((o) => o.kind === "workspace-team"), false, "no byTeam origin row");
  const doc = ok(fx.cli(["inspect", "--soul", "dev", "--json"]), "inspect --soul");
  assert.deepEqual(doc.teams, [GLOBAL, NIGHT_UNMAPPED]);
  assert.equal(doc.teamsSource, "live");
  const souls = ok(fx.cli(["souls", "--json"]), "souls");
  assert.deepEqual(souls.souls.find((s) => s.name === "dev").labels, ["global", "night"]);
  const version = JSON.parse(fx.cli(["version", "--json"]).stdout);
  assert.ok(version.features.includes("teams"), "feature `teams` advertises the surface");
});

test("a home's teams are LIVE: inspect --home, a home's command (OATS_TEAMS) and a provider check's environment follow the workspace; the spawn record and modules stay frozen", async (t) => {
  const fx = fixture(); t.after(fx.cleanup);
  const { home } = await fx.spawn("dev", { instance: "dev-teams" });
  const meta0 = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  assert.deepEqual(meta0.teams, [GLOBAL, NIGHT_UNMAPPED], "spawn records the eligible teams (evidence)");
  assert.deepEqual(meta0.workspace.soul.labels, ["global", "night"]);
  assert.equal("teams" in meta0.providers, false, "never inside the capability-keyed providers map");
  const spawnHook = JSON.parse(readFileSync(join(home, "spawn-teams.json"), "utf8"));
  assert.deepEqual(spawnHook, { labels: "global,night", teams: [GLOBAL, NIGHT_UNMAPPED], settings: { private: "per-human" } }, "the spawn hook gets OATS_TEAMS beside OATS_SETTINGS, which carries no byTeam entry (amendment K) — the primary's payload");
  // The MESSAGING module's commands (its team verbs) get the teams live; every other command gets
  // the spawn record at no remote cost, marked `recorded` (review A1, OATS_TEAMS_SOURCE).
  const inHome = (ns, sub) => ok(fx.cli([ns, sub, "--json"], { cwd: home, env: { OATS_INSTANCE_HOME: home } }), `${ns} ${sub} in the home`);
  const messaging = () => inHome("chat", "teams");
  const other = () => inHome("envprobe", "show");
  let seen = messaging();
  // OATS_TEAM_ID is the settings' team: empty = the provider's default (personal), not the mapped primary's.
  assert.deepEqual([seen.labels, seen.label, seen.id, seen.source], ["global,night", "global", "", "live"]);
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
  assert.deepEqual(echoed, { teams: [GLOBAL, NIGHT_MAPPED], source: "live", labels: "global,night", requestKeys: ["capability", "input", "phase", "schemaVersion", "settings", "slot"], settingsHasTeams: false },
    "the check gets the live teams and their source in its env; its stdin stays the released wire");
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
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), { label: "global", id: "", labels: "global,night", teams: [GLOBAL, NIGHT_UNMAPPED] });
});

test("amendment K: a personal team the HOST sets (oats-local.yaml settings) reaches settings.team and OATS_TEAM_ID; the mapped primary stays in OATS_TEAMS only", async (t) => {
  const fx = fixture({ local: { settings: { "acme.chat": { team: "aweb:me.personal" } } } }); t.after(fx.cleanup);
  const preview = ok(fx.cli(["spawn", "dev", "--preview", "--json"]), "spawn --preview");
  assert.deepEqual(preview.settings["acme.chat"], { private: "per-human", team: "aweb:me.personal" });
  assert.equal(preview.settingsOrigins["acme.chat"]["/team"].kind, "host");
  assert.deepEqual(preview.teams, [GLOBAL, NIGHT_UNMAPPED], "the label's own payload is untouched");
  const { home } = await fx.spawn("dev", { instance: "dev-personal" });
  const spawnHook = JSON.parse(readFileSync(join(home, "spawn-teams.json"), "utf8"));
  assert.equal(spawnHook.settings.team, "aweb:me.personal");
  const seen = ok(fx.cli(["chat", "teams", "--json"], { cwd: home, env: { OATS_INSTANCE_HOME: home } }), "chat teams in the home");
  assert.equal(seen.id, "aweb:me.personal", "OATS_TEAM_ID is the host-set personal team");
  assert.deepEqual(seen.teams, [GLOBAL, NIGHT_UNMAPPED]);
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
  // inspect --soul refuses the same way (the soul cannot be spawned until the workspace resolves
  // it): no teams answered; the details name the capability and both labels.
  const ins = fx.cli(["inspect", "--soul", "dev", "--json"]).json();
  assert.equal(ins.ok, false, JSON.stringify(ins));
  assert.equal(ins.error.code, "E_TEAM_CONFLICT");
  assert.deepEqual([ins.error.details?.capability, ins.error.details?.labels], ["acme.other", ["global", "night"]], JSON.stringify(ins.error));
});

test("the REAL oats.aweb 1.13.1 binding check decodes the kernel's check request for a two-label home: the teams never break its strict wire", async (t) => {
  const fx = fixture(); t.after(fx.cleanup);
  const { home } = await fx.spawn("dev", { instance: "dev-aweb" });
  const meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  const target = await homeTarget(home, meta);
  assert.deepEqual([target.teams, target.teamsSource], [[GLOBAL, NIGHT_UNMAPPED], "live"], "a live two-label target");
  // The released provider, from this repository, filling the messaging slot with an aweb-shaped payload.
  const dir = fileURLToPath(new URL("../capabilities/oats-aweb", import.meta.url));
  const manifest = JSON.parse(readFileSync(join(dir, "oats.json"), "utf8"));
  assert.equal(manifest.version, "1.13.1", "the released provider 0.26.0 pins");
  const aweb = { ...target, payloads: { ...target.payloads, "oats.aweb": { team: "aweb:acme.global" } }, slots: { ...target.slots, messaging: "oats.aweb" } };
  const out = runProviderCheck(aweb, { name: "oats.aweb", manifest }, dir);
  // Its decoder accepted the request: the answer is one of its check statuses (here no messaging
  // root is set up), never its wire refusal (`invalid-binding` / `provider-not-qualified`).
  assert.equal(out.outcome, "result", JSON.stringify(out));
  assert.equal(out.result.status, "needs-configuration");
  assert.equal(out.result.problems.some((p) => ["invalid-binding", "provider-not-qualified"].includes(p.code)), false, JSON.stringify(out));
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
