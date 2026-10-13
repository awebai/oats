// The `retire-refused` event (awebai/oats#954), where the kernel's rows meet the Desktop's events
// reader. This file lives in the root suite because it needs the kernel: the Desktop's own tests
// run without it.
//
// The reader (`eventsData`, packages/desktop/renderer/instance-events-data.mjs) reads `reason` on a
// row of any kind, and refuses the WHOLE read when one is longer than its bound (`eventsDetail`,
// packages/client/instance-events-contract.mjs). So the kernel writes none that is longer: it holds
// the number as RETIRE_REFUSED_REASON_MAX and cuts the sentence a retire answered to it
// (`retireRefusedReason`, lib/instance-events.mjs). Nothing under lib/ reads the Desktop's
// packages; this file is what pins the two numbers together.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { MAX_INSTANCE_NAME, deferredRetireResultPath, retirePendingMarkerPath } from "../lib/core.mjs";
import { RETIRE_REFUSED_REASON_MAX, appendEvent, readEvents, retireRefusedReason } from "../lib/instance-events.mjs";
import { EVENTS_WITHHELD, eventsDetail } from "../packages/client/instance-events-contract.mjs";
import { eventsData } from "../packages/desktop/renderer/instance-events-data.mjs";
import { fixtureBase } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const CORE = pathToFileURL(new URL("../lib/core.mjs", import.meta.url).pathname).href;
const MAX = RETIRE_REFUSED_REASON_MAX;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
/** The Desktop's target for the instance `instance` of the agent `dev` under `deployment`. */
const targetOf = (deployment, home, instance, incarnation) => ({ workspace: "fixture", context: deployment, selector: { instance, agent: "dev", agentsRoot: join(deployment, "agents"), server: null }, home, incarnation });

test("the kernel's bound of a retire-refused reason is the Desktop reader's: the longest detail eventsDetail accepts, and one unit more is what it refuses", () => {
  assert.equal(eventsDetail("x".repeat(MAX)), "x".repeat(MAX), "a detail at the kernel's bound is accepted");
  assert.throws(() => eventsDetail("x".repeat(MAX + 1)), /invalid event detail/, "one unit more is refused");
});

test("retireRefusedReason: one line, at most the bound with its final mark counted, never cut through a surrogate pair", () => {
  assert.equal(retireRefusedReason("  a retire\nanswered\t\tthis \r\n  sentence.\n"), "a retire answered this sentence.");
  assert.equal(retireRefusedReason("line separator and paragraph"), "line separator and paragraph", "every kind of whitespace is one space");
  assert.equal(retireRefusedReason("x".repeat(MAX)), "x".repeat(MAX), "a sentence at the bound is not cut");
  const cut = retireRefusedReason("x".repeat(MAX + 1));
  assert.deepEqual([cut.length, cut], [MAX, `${"x".repeat(MAX - 1)}…`], "one unit more: cut, and the mark is inside the bound");
  assert.equal(retireRefusedReason("x".repeat(10 * MAX)).length, MAX);
  // The bound counts after the whitespace is collapsed, not before.
  assert.equal(retireRefusedReason(`${"x".repeat(MAX - 2)}\n\n\n\n y`), `${"x".repeat(MAX - 2)} y`);
  // A pair that the cut would go through is left out whole; one that fits is kept whole.
  const through = retireRefusedReason(`${"x".repeat(MAX - 2)}\u{1F600}tail`);
  assert.deepEqual([through.length, through], [MAX - 1, `${"x".repeat(MAX - 2)}…`]);
  const fits = retireRefusedReason(`${"x".repeat(MAX - 3)}\u{1F600}tail`);
  assert.deepEqual([fits.length, fits], [MAX, `${"x".repeat(MAX - 3)}\u{1F600}…`]);
  for (const reason of [cut, through, fits]) assert.equal(reason.isWellFormed(), true, "no half of a pair is left");
});

test("the Desktop's reader accepts the kernel's read of a log that holds retire-refused rows: a code or null, either value of homeChanged, and text it withholds", (t) => {
  const base = fixtureBase("oats-rr-");
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, "agents", "dev", "instances", "dev-1"), createdAt = "2026-10-01T00:00:00.000Z";
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "instance.json"), JSON.stringify({ agent: "dev", instance: "dev-1", home, createdAt, modules: {}, workspace: { deployment: base } }));
  const refused = (data, options) => assert.equal(appendEvent(home, { kind: "retire-refused", data }, options).ok, true);
  refused({ code: "E_CHILDREN_RUNNING", homeChanged: false, reason: "kid could not be stopped (E_LIFECYCLE_BUSY); nothing was retired and nothing was escalated" }, { incarnation: createdAt, workspaceOnly: true });
  refused({ code: null, homeChanged: true, reason: "the retirement of dev-1 is incomplete: its cleanup did not finish, and the home is retained" }, { incarnation: createdAt, workspaceOnly: true });
  refused({ code: "E_LIFECYCLE_FAILED", homeChanged: true, reason: retireRefusedReason("could not fetch https://example.invalid/repo.git:\n  token=abcdef") }, { incarnation: createdAt, workspaceOnly: true });

  const read = readEvents(home, { limit: 100 });
  assert.deepEqual(read.events.map((row) => row.kind), ["retire-refused", "retire-refused", "retire-refused"], "the kernel reads the three rows from the workspace's log, where a completion writes them");
  const data = eventsData(read, targetOf(base, home, "dev-1", createdAt), 100);
  assert.notEqual(data, null, "the Desktop accepts the read");
  assert.deepEqual(data.events.map((row) => [row.kind, row.incarnation, row.data.reason]), [
    ["retire-refused", createdAt, "kid could not be stopped (E_LIFECYCLE_BUSY); nothing was retired and nothing was escalated"],
    ["retire-refused", createdAt, "the retirement of dev-1 is incomplete: its cleanup did not finish, and the home is retained"],
    ["retire-refused", createdAt, EVENTS_WITHHELD],
  ]);
});

test("a retire's sentence that is longer than the bound: the completion's row is at the bound and the Desktop's reader accepts the read; with one unit more it refuses the whole read", async (t) => {
  const fx = v2Deployment({ t });
  const spawn = async (name, opts = {}) => {
    const hostPath = process.env.PATH;
    process.env.PATH = fx.env.PATH; // an in-process spawn finds the fixture's inert harness
    try { return (await fx.spawn("dev", { name, ...opts })).home; } finally { process.env.PATH = hostPath; }
  };
  const parent = await spawn("parent");
  const kidName = `k${"i".repeat(MAX_INSTANCE_NAME - 2)}d`;
  const kid = await spawn(kidName, { relativeTo: "parent", relation: "child" });
  // No stop of the child can take its claim: the file there is no claim, so it is refused at once.
  const claim = join(dirname(kid), ".oats-retirement", "claims", `${kidName}.lock`);
  mkdirSync(dirname(claim), { recursive: true });
  writeFileSync(claim, "not a claim\n");
  // A retire names every recorded child that did not stop. Thirty of them, in a scheduling's
  // intent: the same child each time, which makes the same sentence thirty children make.
  const children = Array.from({ length: 30 }, () => ({ instance: kidName, home: kid }));
  const intent = { instance: "parent", agent: "dev", root: fx.root, requestedAt: "2026-10-10T00:00:00.000Z", requestedByPid: 1, delaySec: 0, options: { home: parent, tmuxSession: "oats-agents", children }, resultPath: deferredRetireResultPath(parent) };
  writeFileSync(retirePendingMarkerPath(parent), JSON.stringify(intent, null, 2) + "\n");
  const completion = spawnSync(process.execPath, ["--input-type=module", "-e", `import { completeDeferredRetirement } from ${JSON.stringify(CORE)};
process.exitCode = completeDeferredRetirement(JSON.parse(process.env.OATS_RETIRE_INTENT), { delaySec: 0 }) ? 0 : 1;`], { cwd: fx.dep, env: { ...fx.env, OATS_RETIRE_INTENT: JSON.stringify(intent) }, encoding: "utf8", timeout: 180000 });
  assert.equal(completion.status, 1, completion.stdout + completion.stderr);

  // The sentence as the retire answered it is in the outcome, whole.
  const sentence = readJson(deferredRetireResultPath(parent)).error.message;
  assert.ok(sentence.length > MAX, `fixture premise: the retire's sentence (${sentence.length} units) is longer than the bound`);
  t.diagnostic(`the sentence the retire answered is ${sentence.length} UTF-16 code units long; the row carries ${MAX}`);
  assert.equal(existsSync(retirePendingMarkerPath(parent)), false, "fixture premise: the completion was refused before the home was touched");

  const created = readJson(join(parent, "instance.json")).createdAt;
  const read = await fx.inEnv(() => readEvents(parent, { limit: 100 }));
  const row = read.events.find((event) => event.kind === "retire-refused");
  assert.deepEqual({ code: row.data.code, homeChanged: row.data.homeChanged }, { code: "E_CHILDREN_RUNNING", homeChanged: false });
  assert.equal(row.data.reason.length, MAX, "the kernel's row is at the bound");
  assert.equal(row.data.reason, `${sentence.slice(0, MAX - 1)}…`);

  const target = targetOf(fx.dep, parent, "parent", created);
  const data = eventsData(read, target, 100);
  assert.notEqual(data, null, "the Desktop accepts the read");
  assert.equal(data.events.find((event) => event.kind === "retire-refused").data.reason, row.data.reason, "and shows the sentence as the kernel cut it");
  // What the bound is for: the same read with that sentence one unit longer.
  const longer = structuredClone(read);
  longer.events.find((event) => event.kind === "retire-refused").data.reason += "x";
  assert.equal(eventsData(longer, target, 100), null, "one unit more and the reader refuses the whole read");
});
