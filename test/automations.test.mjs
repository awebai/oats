// Workspace triggers and schedules (kernel 0.29.0, docs/design/2026-09-26-okf-knowledge-operations.md
// §2.3a): declared in Git in a confirmed member, discovered by `oats sync` into a snapshot, and run
// ONLY on the host named by runsOn, logged in (gh) as owner. Each kind keeps its own module, its own
// file contract and its own opt-out list; lib/automations.mjs holds what they share. A fake `gh` on
// PATH answers `api user` and the PR poll; spawns are real children with --no-launch.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const A = await import("../lib/automations.mjs");
const T = await import("../lib/triggers.mjs");
const S = await import("../lib/schedule.mjs");
const ok = (r, what) => { assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`); const j = r.json(); assert.equal(j.ok, true, `${what}: ${r.stdout}`); return j.result; };
const fails = (r, code, what) => { const j = r.json(); assert.equal(j.ok, false, `${what}: ${r.stdout}${r.stderr}`); assert.equal(j.error.code, code, `${what}: ${r.stdout}`); return j.error; };
const KINDS = [T.triggerKind(), S.scheduleKind({ dep: "/dep" })];

const REPO = "github.com/acme/knowledge";
const pr = (number) => ({ number, html_url: `https://github.com/acme/knowledge/pull/${number}`, title: "t", body: "", draft: false, head: { sha: `${number}`.padEnd(40, "a"), ref: `h-${number}` }, base: { ref: "main" }, labels: [{ name: "okf-harvest" }], created_at: `2026-09-26T10:0${number}:00Z`, updated_at: `2026-09-26T11:0${number}:00Z` });

/** A fake `gh`: `api user` answers <dir>/login (exit 1 when absent), the pulls poll <dir>/pulls.json. */
function fakeGh(dir) {
  const bin = join(dir, "bin"); mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gh"), `#!/bin/sh
echo "$*" >> "${dir}/calls.log"
case "$*" in
  "api user"*) [ -f "${dir}/login" ] || { echo "HTTP 401: Bad credentials" >&2; exit 1; }; cat "${dir}/login"; exit 0 ;;
  *"/pulls"*) cat "${dir}/pulls.json"; exit 0 ;;
esac
echo "unexpected gh $*" >&2; exit 2
`);
  chmodSync(join(bin, "gh"), 0o755);
  writeFileSync(join(dir, "pulls.json"), "[]");
  return { dir, bin, login: (l) => (l === null ? rmSync(join(dir, "login"), { force: true }) : writeFileSync(join(dir, "login"), `${l}\n`)), pulls: (list) => writeFileSync(join(dir, "pulls.json"), JSON.stringify(list)), calls: () => (existsSync(join(dir, "calls.log")) ? readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n") : []) };
}

const trigger = { kind: "oats-trigger", schemaVersion: 1, description: "Review harvest PRs", runsOn: "kb-host", owner: "github.com/kb-bot",
  on: { source: "github.pull_request", repo: REPO, events: ["opened"], labels: ["okf-harvest"], poll: "2m" },
  spawn: { soul: "reviewer", purpose: "review-pr-{number}", task: "Review {repo}#{number} ({url})." } };
const schedule = { kind: "oats-schedule", schemaVersion: 1, runsOn: "kb-host", owner: "github.com/kb-bot", run: "spawn", cron: "0 7 * * *", tz: "UTC", agent: "reviewer", task: "Write the nightly digest." };

function fixture({ local = { host: { name: "kb-host" } }, files = {} } = {}) {
  const fx = v2Deployment({
    name: "acme",
    souls: { reviewer: {} },
    local,
    files: {
      "oats-triggers/kb-review.yaml": { yaml: trigger },
      "ops/nightly.oats-schedule.yaml": { yaml: schedule },
      // Not candidates: never scanned, or not following the naming rule.
      "node_modules/x/stray.oats-trigger.yaml": { yaml: trigger },
      "docs/readme.yaml": "a: 1\n",
      ...files,
    },
  });
  fx.gh = fakeGh(join(fx.base, "gh"));
  fx.gh.login("kb-bot");
  fx.env.PATH = `${fx.gh.bin}:${fx.env.PATH}`;
  fx.setLocal = (extra) => writeFileSync(join(fx.dep, "oats-local.yaml"), YAML.stringify({ schemaVersion: 2, workspace: fx.ref, ...extra }));
  /** In process, as the host tick runs it: the fake gh on PATH. */
  fx.inGh = (fn) => fx.inEnv(() => { const path = process.env.PATH; process.env.PATH = fx.env.PATH; try { return fn(); } finally { process.env.PATH = path; } });
  return fx;
}

test("the file contract: where a trigger or schedule file is, its self-describing header, and each kind's own body", () => {
  assert.deepEqual(A.candidateOf("oats-triggers/a.yaml", KINDS), { kind: "trigger", stem: "a" });
  assert.deepEqual(A.candidateOf("oats-schedules/sub/b.yml", KINDS), { kind: "schedule", stem: "b" });
  assert.deepEqual(A.candidateOf("services/billing/nightly.oats-schedule.yaml", KINDS), { kind: "schedule", stem: "nightly" });
  assert.deepEqual(A.candidateOf("x.oats-trigger.yml", KINDS), { kind: "trigger", stem: "x" });
  for (const p of ["oats-package/oats-triggers/a.yaml", "node_modules/p/a.oats-trigger.yaml", ".git/a.oats-schedule.yaml", "triggers/a.yaml", "oats-triggers/readme.md", "a.oats-trigger.json"]) assert.equal(A.candidateOf(p, KINDS), null, p);

  const parse = (kind, doc, path = `oats-${kind}s/x.yaml`) => A.parseAutomationFile(KINDS.find((k) => k.kind === kind), { stem: "x", path, bytes: Buffer.from(YAML.stringify(doc)), member: "kb", repoKey: "github.com/acme/kb", commit: "c".repeat(40) });
  const t = parse("trigger", trigger).entry;
  assert.deepEqual([t.kind, t.id, t.name, t.runsOn, t.owner, t.origin.kind], ["trigger", "kb/x", "x", "kb-host", "github.com/kb-bot", "workspace"]);
  assert.equal(parse("trigger", { ...trigger, id: "named" }).entry.id, "kb/named", "id: wins over the stem");
  assert.deepEqual(parse("trigger", { kind: "oats-trigger", schemaVersion: 1, runsOn: "h", owner: "github.com/o", from: "oats.okf:harvest-review", set: { repo: REPO, teams: ["okf", "global"] } }).entry.source, { from: "oats.okf:harvest-review", set: { repo: REPO, teams: "okf,global" } });
  assert.equal(parse("schedule", schedule).entry.source.definition.kind, "spawn");
  const problem = (kind, doc, field) => { const r = parse(kind, doc); assert.equal(r.problem?.code, "E_AUTOMATION_SCHEMA", JSON.stringify(doc)); if (field) assert.match(r.problem.path, new RegExp(`#/${field}$`)); return r.problem; };
  assert.match(problem("trigger", schedule, "kind").message, /kind must be "oats-trigger"/, "a schedule file in oats-triggers/ is the wrong kind, never silently read");
  problem("trigger", { ...trigger, kind: undefined }, "kind");
  problem("trigger", { ...trigger, schemaVersion: 2 }, "schemaVersion");
  problem("trigger", { ...trigger, runsOn: undefined }, "runsOn");
  problem("trigger", { ...trigger, owner: "kb-bot" }, "owner");
  problem("trigger", { ...trigger, cron: "* * * * *" }, "cron");
  problem("schedule", { ...schedule, on: {} }, "on");
  problem("trigger", { ...trigger, from: "a:b" }, "from");
  assert.match(problem("schedule", { ...schedule, run: "wake" }, "run").message, /declare it locally/);
});

test("oats sync discovers a member's triggers and schedules into one snapshot, kept per kind; the problems are named", async (t) => {
  const fx = fixture({ files: {
    "oats-triggers/broken.yaml": { yaml: schedule },
    "misc/dup.oats-trigger.yaml": { yaml: { ...trigger, id: "kb-review" } },
  } });
  t.after(() => fx.cleanup());
  const sync = ok(fx.cli(["sync", "--json"]), "sync");
  assert.deepEqual([sync.automations.triggers, sync.automations.schedules], [1, 1]);
  const codes = sync.problems.map((p) => [p.code, p.path]).sort();
  assert.deepEqual(codes, [["E_AUTOMATION_DUPLICATE", "oats-triggers/kb-review.yaml"], ["E_AUTOMATION_SCHEMA", "oats-triggers/broken.yaml#/kind"]].sort(), JSON.stringify(sync.problems));
  const snap = A.readSnapshot(fx.dep);
  assert.deepEqual(snap.triggers.map((a) => a.id), ["ws/kb-review"]);
  assert.equal(snap.triggers[0].origin.path, "misc/dup.oats-trigger.yaml", "the first path (sorted) is listed; the duplicate is reported");
  assert.deepEqual(snap.schedules.map((a) => [a.id, a.origin.path]), [["ws/nightly", "ops/nightly.oats-schedule.yaml"]]);
  assert.ok(snap.members[fx.key].candidates.every((p) => !p.startsWith("node_modules/")));
  const status = ok(fx.cli(["workspace", "status", "--json"]), "workspace status").automations;
  assert.deepEqual(status.rows.map((r) => [r.kind, r.id, r.runsHere]), [["trigger", "ws/kb-review", true], ["schedule", "ws/nightly", true]]);
});

test("the list rows (the Desktop's contract): a trigger and a schedule each answer who, where, the soul, the prompt verbatim and when", async (t) => {
  const fx = fixture();
  t.after(() => fx.cleanup());
  ok(fx.cli(["sync", "--json"]), "sync");
  const tl = ok(fx.cli(["trigger", "list", "--json"]), "trigger list");
  assert.equal(tl.host.name, "kb-host");
  const tr = tl.triggers.find((r) => r.id === "ws/kb-review");
  assert.deepEqual({ kind: tr.kind, qualifiedId: tr.qualifiedId, name: tr.name, owner: tr.owner, runsOn: tr.runsOn, runsHere: tr.runsHere, reason: tr.reason, enabledHere: tr.enabledHere, task: tr.task, teams: tr.teams },
    { kind: "trigger", qualifiedId: "ws/kb-review", name: "kb-review", owner: "github.com/kb-bot", runsOn: "kb-host", runsHere: true, reason: null, enabledHere: true, task: "Review {repo}#{number} ({url}).", teams: [] });
  assert.deepEqual({ ...tr.origin, commit: typeof tr.origin.commit }, { kind: "workspace", repoKey: fx.key, path: "oats-triggers/kb-review.yaml", commit: "string" });
  assert.deepEqual(tr.soul, { name: "reviewer", origin: { kind: "member", repoKey: fx.key, member: "ws" } });
  assert.equal(tr.on.repo, REPO);
  const sl = ok(fx.cli(["schedule", "list", "--json"]), "schedule list");
  const sr = sl.schedules.find((r) => r.qualifiedId === "ws/nightly");
  assert.deepEqual({ id: sr.id, name: sr.name, kind: sr.kind, cron: sr.cron, tz: sr.tz, runsHere: sr.runsHere, task: sr.task, soul: sr.soul?.name }, { id: "ws/nightly", name: "nightly", kind: "spawn", cron: "0 7 * * *", tz: "UTC", runsHere: true, task: "Write the nightly digest.", soul: "reviewer" });
  assert.match(sr.nextDue, /T07:00:00/);
  assert.equal(sl.schedules.some((r) => r.kind === "trigger"), false, "a schedule listing never carries a trigger");
  assert.equal(sl.triggers.count, 1);
  // A local schedule keeps its bare id (the 0.28 contract); its qualified form is qualifiedId.
  const mine = ok(fx.cli(["schedule", "add", "mine", "--spec-json", JSON.stringify({ kind: "command", cron: "0 8 * * *", tz: "UTC", cwd: fx.dep, argv: ["oats", "status"] }), "--json"]), "add local").schedule;
  assert.deepEqual([mine.id, mine.qualifiedId, mine.name, mine.origin.kind, mine.runsHere, mine.owner], ["mine", "local/mine", "mine", "local", true, null]);
});

test("placement: runsOn names the host and owner the gh account; otherwise host-unnamed, assigned-elsewhere or owner-mismatch", async (t) => {
  const fx = fixture();
  t.after(() => fx.cleanup());
  ok(fx.cli(["sync", "--json"]), "sync");
  const row = () => ok(fx.cli(["trigger", "show", "ws/kb-review", "--json"]), "show").trigger;
  assert.deepEqual([row().runsHere, row().reason], [true, null]);
  fx.gh.login("someone-else");
  assert.deepEqual([row().runsHere, row().reason], [false, "owner-mismatch"]);
  assert.match(row().reasonDetail, /logged in as github\.com\/someone-else/);
  fx.gh.login(null);
  assert.equal(row().reason, "owner-mismatch", "gh not logged in: nothing runs");
  fx.gh.login("KB-Bot");
  assert.equal(row().runsHere, true, "a login compares case-insensitively");
  fx.setLocal({ host: { name: "laptop" } });
  assert.deepEqual([row().runsHere, row().reason], [false, "assigned-elsewhere"]);
  fx.setLocal({});
  assert.deepEqual([row().runsHere, row().reason], [false, "host-unnamed"]);
  const test = ok(fx.cli(["trigger", "test", "ws/kb-review", "--json"]), "test");
  assert.equal(test.ok, false);
  assert.equal(test.placement.reason, "host-unnamed");
  assert.match(test.problems[0], /not run on this host \(host-unnamed\)/);
});

test("each kind keeps its own opt-out: trigger disable writes triggers.disabled, schedule disable schedules.disabled; Git-defined ones are never edited or removed here", async (t) => {
  const fx = fixture({ files: { "oats-schedules/kb-review.yaml": { yaml: schedule } } });
  t.after(() => fx.cleanup());
  ok(fx.cli(["sync", "--json"]), "sync");
  const off = ok(fx.cli(["trigger", "disable", "ws/kb-review", "--json"]), "disable").trigger;
  assert.deepEqual([off.enabledHere, off.runsHere], [false, false]);
  let local = YAML.parse(readFileSync(join(fx.dep, "oats-local.yaml"), "utf8"));
  assert.deepEqual(local.triggers, { disabled: ["ws/kb-review"] });
  assert.equal(local.schedules, undefined);
  assert.equal(ok(fx.cli(["schedule", "show", "ws/kb-review", "--json"]), "schedule of the same id").schedule.enabledHere, true, "the schedule named kb-review is a different automation");
  ok(fx.cli(["schedule", "disable", "ws/nightly", "--json"]), "schedule disable");
  local = YAML.parse(readFileSync(join(fx.dep, "oats-local.yaml"), "utf8"));
  assert.deepEqual([local.triggers.disabled, local.schedules.disabled], [["ws/kb-review"], ["ws/nightly"]]);
  assert.equal(ok(fx.cli(["trigger", "enable", "ws/kb-review", "--json"]), "enable").trigger.runsHere, true);
  assert.equal(YAML.parse(readFileSync(join(fx.dep, "oats-local.yaml"), "utf8")).triggers, undefined, "the emptied list goes away");
  fails(fx.cli(["trigger", "remove", "ws/kb-review", "--json"]), "E_AUTOMATION_WORKSPACE", "remove a Git-defined trigger");
  fails(fx.cli(["schedule", "remove", "ws/nightly", "--json"]), "E_AUTOMATION_WORKSPACE", "remove a Git-defined schedule");
  fails(fx.cli(["schedule", "update", "ws/nightly", "--spec-json", JSON.stringify(schedule), "--json"]), "E_AUTOMATION_WORKSPACE", "update a Git-defined schedule");
  fails(fx.cli(["trigger", "show", "ws/nope", "--json"]), "E_TRIGGER_UNKNOWN", "unknown");
  fails(fx.cli(["schedule", "show", "../x", "--json"]), "E_BAD_ARGS", "malformed");
});

test("the tick runs what this host runs: a workspace trigger fires under its qualified id; a workspace schedule launches at its minute; another host's are left alone", async (t) => {
  const fx = fixture();
  t.after(() => fx.cleanup());
  ok(fx.cli(["sync", "--json"]), "sync");
  fx.gh.pulls([pr(1)]);
  const ctx = () => fx.inGh(() => S.scopeAutomations(fx.dep, {}));
  const fired = await fx.inGh(async () => T.tickTriggers(fx.dep, { now: new Date("2026-09-26T12:00:00Z"), io: { noLaunch: true }, ctx: await ctx() }));
  assert.deepEqual(fired.map((r) => [r.trigger, r.action, r.key]), [["ws/kb-review", "fired", `ws/kb-review:${REPO}#1:opened:2026-09-26T10:01:00Z`]]);
  const [live] = T.liveTriggerInstances(fx.dep, "ws/kb-review");
  assert.equal(JSON.parse(readFileSync(join(live.home, "instance.json"), "utf8")).trigger.id, "ws/kb-review");
  assert.match(readFileSync(join(live.home, "TASK.md"), "utf8"), /OATS trigger "ws\/kb-review"/);

  const due = new Date("2026-09-27T07:00:10Z");
  const ran = await fx.inGh(async () => S.tickWorkspace(fx.dep, { now: due, io: { noLaunch: true }, reg: { maxConcurrent: 4, workspaces: [fx.dep] }, wsList: [fx.dep], ctx: await ctx() }));
  assert.deepEqual(ran.map((r) => [r.id, r.action]), [["ws~nightly", "launched"]], JSON.stringify(ran));
  const row = ok(fx.cli(["schedule", "show", "ws/nightly", "--json"]), "show").schedule;
  assert.equal(row.lastRun.outcome, "launched");
  assert.match(row.lastRun.instance, /^reviewer-nightly-/);

  // Another host: nothing runs, nothing is reported every minute.
  fx.setLocal({ host: { name: "laptop" } });
  fx.gh.pulls([pr(1), pr(2)]);
  const elsewhere = await fx.inGh(async () => T.tickTriggers(fx.dep, { now: new Date("2026-09-26T13:00:00Z"), io: { noLaunch: true }, ctx: await ctx() }));
  assert.deepEqual(elsewhere, []);
  // The named host logged in as another account: reported (it is this host's to fix).
  fx.setLocal({ host: { name: "kb-host" } });
  fx.gh.login("someone-else");
  const mismatch = await fx.inGh(async () => T.tickTriggers(fx.dep, { now: new Date("2026-09-26T13:00:00Z"), io: { noLaunch: true }, ctx: await ctx() }));
  assert.deepEqual(mismatch.map((r) => [r.trigger, r.action, r.reason]), [["ws/kb-review", "not-here", "owner-mismatch"]]);
});

test("add --workspace writes the file into a checkout of the member (or prints it); what is written reads back as the same trigger or schedule", async (t) => {
  const fx = fixture();
  t.after(() => fx.cleanup());
  ok(fx.cli(["sync", "--json"]), "sync");
  const defFile = join(fx.base, "t.json");
  writeFileSync(defFile, JSON.stringify({ on: trigger.on, spawn: trigger.spawn }));
  const printed = ok(fx.cli(["trigger", "add", "--file", defFile, "--id", "second", "--workspace", "ws", "--runs-on", "kb-host", "--owner", "github.com/kb-bot", "--json"]), "print");
  assert.equal(printed.written, false, "the deployment directory is not a checkout of the member");
  assert.equal(printed.file.path, "oats-triggers/second.yaml");
  assert.deepEqual(YAML.parse(printed.file.content), { kind: "oats-trigger", schemaVersion: 1, id: "second", runsOn: "kb-host", owner: "github.com/kb-bot", on: trigger.on, spawn: trigger.spawn });
  const wrote = ok(fx.cli(["trigger", "add", "--file", defFile, "--id", "second", "--workspace", "ws", "--runs-on", "kb-host", "--owner", "github.com/kb-bot", "--dir", fx.member, "--json"]), "write");
  assert.equal(wrote.written, true);
  assert.equal(readFileSync(join(fx.member, "oats-triggers", "second.yaml"), "utf8"), printed.file.content);
  fails(fx.cli(["trigger", "add", "--file", defFile, "--id", "second", "--workspace", "ws", "--runs-on", "kb-host", "--owner", "github.com/kb-bot", "--dir", fx.member, "--json"]), "E_TRIGGER_EXISTS", "twice");
  const sched = ok(fx.cli(["schedule", "add", "digest", "--spec-json", JSON.stringify({ kind: "spawn", cron: "0 6 * * *", tz: "UTC", agent: "reviewer", task: "Digest." }), "--workspace", "ws", "--runs-on", "kb-host", "--owner", "github.com/kb-bot", "--dir", fx.member, "--json"]), "schedule add --workspace");
  assert.equal(sched.id, "ws/digest");
  assert.deepEqual(YAML.parse(readFileSync(join(fx.member, "oats-schedules", "digest.yaml"), "utf8")), { kind: "oats-schedule", schemaVersion: 1, id: "digest", runsOn: "kb-host", owner: "github.com/kb-bot", run: "spawn", cron: "0 6 * * *", tz: "UTC", agent: "reviewer", task: "Digest." });
  fails(fx.cli(["trigger", "add", "--file", defFile, "--id", "x", "--workspace", "ws", "--runs-on", "kb-host", "--owner", "nobody", "--json"]), "E_BAD_ARGS", "owner");
  fails(fx.cli(["trigger", "add", "--file", defFile, "--id", "x", "--workspace", "nope", "--runs-on", "kb-host", "--owner", "github.com/kb-bot", "--json"]), "E_AUTOMATION_MEMBER", "member");
  const bad = join(fx.base, "bad.json");
  writeFileSync(bad, JSON.stringify({ on: trigger.on, spawn: { ...trigger.spawn, task: "Review {title}" } }));
  fails(fx.cli(["trigger", "add", "--file", bad, "--id", "x", "--workspace", "ws", "--runs-on", "kb-host", "--owner", "github.com/kb-bot", "--json"]), "E_TRIGGER_INVALID", "the definition is validated before the file is written");
});

test("the tick refreshes a stale snapshot at most once per interval, keeping the last good one on failure", async (t) => {
  const fx = fixture();
  t.after(() => fx.cleanup());
  ok(fx.cli(["sync", "--json"]), "sync");
  const local = { workspace: fx.ref, host: { name: "kb-host" } };
  let calls = 0;
  const io = { gh: () => ({ status: 0, stdout: "kb-bot\n" }), refresh: () => { calls++; return { ok: false, error: "remote down" }; } };
  const taken = Date.parse(A.readSnapshot(fx.dep).takenAt);
  const at = (min) => new Date(taken + min * 60_000);
  assert.equal(A.automationContext(fx.dep, { local, io, now: at(5), refresh: true }).refresh, null, "fresh: no refresh");
  const failed = A.automationContext(fx.dep, { local, io, now: at(11), refresh: true });
  assert.deepEqual([failed.refresh.ok, failed.triggers.length, calls], [false, 1, 1], "the last good snapshot keeps serving");
  assert.equal(A.automationContext(fx.dep, { local, io, now: at(12), refresh: true }).refresh, null, "one attempt per interval");
  A.automationContext(fx.dep, { local, io, now: at(22), refresh: true });
  assert.equal(calls, 2);
  const refreshed = ok(fx.cli(["automations", "refresh", "--json"]), "automations refresh");
  assert.deepEqual([refreshed.triggers, refreshed.schedules], [1, 1]);
});
