// What the Desktop can show (0.44.0). The Desktop refuses a WHOLE readiness answer whose item reason or remedy
// is over 1024 characters, or whose team label does not match its grammar (at most 64 characters):
// readiness clamps every item's text (#725), and a team label is at most 64 characters wherever the kernel
// accepts one (#726: both schemas, `oats teams add`, a trigger's spawn.teams).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { readinessData } from "../packages/desktop/renderer/readiness-contract.mjs";
import * as T from "../lib/triggers.mjs";

const DESKTOP_TEXT = 1024;
/** Every free-text field the Desktop's reader bounds, anywhere in a readiness document. */
function texts(doc) {
  const out = [];
  for (const c of Object.values(doc.checks)) for (const i of c.items) {
    out.push(["reason", i.reason], ["remedy", i.remedy], ...(i.problems || []).map((p) => ["problems", p.message]));
  }
  return out.filter(([, v]) => typeof v === "string");
}

test("#725 a readiness item's reason and remedy are clamped: an oversized discovery error through the member item, and the Desktop reads the whole answer", (t) => {
  const fx = v2Deployment({}); t.after(fx.cleanup);
  assert.equal(fx.cli(["sync", "--json"]).status, 0);
  const spawned = fx.cli(["spawn", "dev", "--purpose", "p", "--no-launch", "--json"]);
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const { home, instance } = spawned.json().result;
  // The workspace this deployment names cannot be read, and its reference is long: the discovery error
  // the member item reports carries it whole.
  const gone = `file://${join(fx.base, "remotes", `${"gone-".repeat(300)}ws.git`)}`;
  const localPath = join(fx.dep, "oats-local.yaml");
  writeFileSync(localPath, YAML.stringify({ ...YAML.parse(readFileSync(localPath, "utf8")), workspace: gone }));
  // As the Desktop asks for it (--policy).
  const r = fx.cli(["readiness", "--home", home, "--policy", "--json"], { cwd: home, env: { OATS_INSTANCE_HOME: home } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const doc = r.json().result;
  const member = doc.checks.member.items[0];
  assert.equal(member.status, "unknown");
  assert.match(member.reason, /^the workspace could not be read: /);
  assert.equal(member.reason.length, 1000, "clipped to 1000 characters");
  assert.ok(member.reason.endsWith("…"));
  for (const [field, value] of texts(doc)) assert.ok(value.length <= DESKTOP_TEXT, `${field}: ${value.length} characters`);
  // The Desktop's own reader takes the answer (it returns null for an answer it refuses).
  const target = { workspace: "fixture", context: fx.dep, observedAs: "instance", home: doc.subject.home,
    selector: { kind: "instance", instance, agent: "dev", agentsRoot: fx.root, server: null } };
  assert.ok(readinessData(doc, target), "the Desktop reads the whole answer");
});

test("#726 a team label is at most 64 characters: both files refuse a longer one naming the limit and the label; teams add and a trigger's spawn.teams use the same bound", (t) => {
  const at64 = `t${"a".repeat(63)}`, at65 = `t${"a".repeat(64)}`;
  // The workspace file: a 64-character label is a label; a 65-character one is E_WORKSPACE_SCHEMA.
  const fx = v2Deployment({ workspace: { teams: { [at64]: { description: "longest" } }, defaultTeam: at64 } }); t.after(fx.cleanup);
  assert.equal(fx.cli(["sync", "--json"]).status, 0, "a 64-character label is valid");
  fx.commit({ "oats-workspace.yaml": { yaml: { schemaVersion: 2, name: "fixture", members: [fx.ref], teams: { [at65]: { description: "too long" } }, defaultTeam: at65,
    defaults: { knowledge: "none", messaging: "none", tasks: "none" } } } }, "a 65-character label");
  const ws = fx.cli(["sync", "--json"]);
  assert.notEqual(ws.status, 0);
  assert.equal(ws.json().error.code, "E_WORKSPACE_SCHEMA", ws.stdout);
  assert.match(ws.stdout, new RegExp(`${at65}.*65 characters: must be at most 64`));
  // oats-local.yaml: the same bound, the same refusal.
  const localPath = join(fx.dep, "oats-local.yaml");
  writeFileSync(localPath, YAML.stringify({ ...YAML.parse(readFileSync(localPath, "utf8")), teams: { [at65]: { team: "local:long" } } }));
  const local = fx.cli(["teams", "--json"]);
  assert.notEqual(local.status, 0);
  assert.equal(local.json().error.code, "E_WORKSPACE_SCHEMA", local.stdout);
  assert.match(local.stdout, new RegExp(`${at65}.*must be at most 64`));
  // `oats teams add`: the schema's bound, named.
  const add = (label) => { const fx2 = v2Deployment({ workspace: { localTeams: true } }); t.after(fx2.cleanup); return fx2.cli(["teams", "add", label, "--team", "local:x.example", "--json"]); };
  assert.equal(add(at64).status, 0, "teams add takes a 64-character label");
  const refused = add(at65);
  assert.equal(refused.json().error.code, "E_BAD_ARGS", refused.stdout);
  assert.match(refused.json().error.message, /65 characters: must be at most 64/);
  // A trigger's spawn.teams: the same bound.
  const definition = (teams) => ({ id: "kb-review", enabled: true, kind: "trigger",
    on: { source: "github.pull_request", repo: "github.com/acme/knowledge", events: ["opened"], poll: "2m" },
    spawn: { soul: "reviewer", purpose: "review-pr-{number}", task: "Review {url}.", teams }, concurrency: { max: 1, perKey: 1 } });
  assert.deepEqual(T.validateTrigger(definition([at64])).spawn.teams, [at64]);
  assert.throws(() => T.validateTrigger(definition([at65])), (e) => e.code === "E_TRIGGER_INVALID" && e.field === "spawn.teams");
});
