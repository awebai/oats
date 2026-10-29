// The lifted deployment reads (awebai/oats#1630, lib/read-call.mjs) answer in one process as the CLI does: in ONE
// test process `statusAnswer` and `workspaceStatusAnswer` are called many times, alternating two deployments and
// --max-age none / 0 / 60, with refusals interleaved (no deployment, no oats-local.yaml, a workspace that cannot be
// reached), and each answer (exit, JSON, stderr) equals a fresh `oats ... --json` run's at the same deployment. Each
// call opens its read session as a reader does, settles the deployments-list observer once, and leaves no git child
// once its session is closed; a 0.26-era home's deprecated-name warning stays in its own call.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { CLI, setProcessEnvironment, v2Deployment } from "./helpers/v2-deployment.mjs";

const UNREACHABLE = "https://unreachable.invalid/org/ws";
const BUDGET = { OATS_READ_REMOTE_BUDGET_MS: "5000" };

function cli(fx, dir, args, extra = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env: { ...fx.env, ...extra }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}
function ok(r) {
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

// Time-dependent by contract, and nothing else: `observation.observedAt` (the oldest head observation the call
// used, else the time its session began) and, in workspace status, `result.workspace.observedAt` (its discovery's
// observation, live unless reused). Both are kept as they are when both sides reused the same stored observation.
function normalise(doc, reused) {
  const copy = structuredClone(doc);
  const at = (holder, key) => {
    if (!holder || !Object.hasOwn(holder, key)) return;
    assert.ok(!Number.isNaN(Date.parse(holder[key])), `${key} is a time: ${holder[key]}`);
    if (!reused) holder[key] = "<observed>";
  };
  at(copy.observation, "observedAt");
  at(copy.result?.observation, "observedAt");
  at(copy.result?.workspace, "observedAt");
  return copy;
}
const observationOf = (doc) => doc?.observation ?? doc?.result?.observation;

test("status and workspace status answer in one process exactly as fresh CLI runs, call after call", { timeout: 300_000 }, async (t) => {
  const a = v2Deployment({ t, name: "alpha-ws", souls: { alpha: {} } });
  const b = v2Deployment({ t, name: "beta-ws", souls: { beta: {} } });
  for (const fx of [a, b]) ok(cli(fx, fx.dep, ["sync", "--json"]));
  const homeA = ok(cli(a, a.dep, ["spawn", "alpha", "--purpose", "a", "--work", "directory", "--no-launch", "--json"])).result.home;
  ok(cli(b, b.dep, ["spawn", "beta", "--purpose", "b", "--work", "directory", "--no-launch", "--json"]));
  // Drift: alpha's soul moves after its instance was spawned.
  a.commit({ "souls/alpha/AGENTS.md": "# alpha, moved\n" }, "move alpha");
  // A 0.26-era home: `runtime` where `harness` is meant.
  const metaFile = join(homeA, "instance.json");
  const meta = JSON.parse(readFileSync(metaFile, "utf8"));
  assert.ok(Object.hasOwn(meta, "harness"), "a spawned home records its harness");
  meta.runtime = meta.harness;
  delete meta.harness;
  writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  // No deployment at all, and a deployment whose workspace cannot be reached (beta's roster, so status has drift to look for).
  const empty = join(a.base, "empty");
  mkdirSync(empty);
  const lost = join(b.base, "unreachable");
  mkdirSync(lost);
  cpSync(join(b.dep, "agents"), join(lost, "agents"), { recursive: true, verbatimSymlinks: true });
  writeFileSync(join(lost, "oats-local.yaml"), YAML.stringify({ schemaVersion: 2, workspace: UNREACHABLE }));

  // Loaded in the fixture's environment: a module may read the environment as it loads (the tmux session name).
  let kernel = null;
  const load = async () => {
    const [{ callSession, readBudget }, { statusAnswer }, { workspaceStatusAnswer }, { liveGitChildren }, { listResolved }] = await Promise.all([
      import("../lib/read-call.mjs"), import("../lib/roster-read.mjs"), import("../lib/workspace-read.mjs"), import("../lib/remote.mjs"), import("../lib/deployments.mjs")]);
    return { callSession, readBudget, liveGitChildren, listResolved, reads: { status: statusAnswer, workspace: workspaceStatusAnswer } };
  };

  /** One in-process call, as a reader makes it, then the CLI at once; their answers compared. */
  async function compare(fx, verb, dir, maxAge, extra = {}) {
    const inProcess = await fx.inEnv(async () => {
      // The CLI's environment and cwd exactly (PATH has the fixture's inert harnesses first in fx.env), for this call only.
      setProcessEnvironment({ ...fx.env, ...extra });
      const cwd = process.cwd();
      process.chdir(dir);
      try {
        kernel ??= await load();
        const seen = [];
        const deployments = (d, opts) => { seen.push([d, opts]); return kernel.listResolved(d, opts); };
        const session = kernel.callSession({ maxAge, budgetMs: kernel.readBudget(process.env) });
        let answer;
        try { answer = await kernel.reads[verb]({ dir, maxAge, session: () => session, cacheDir: resolve(process.env.OATS_REMOTE_CACHE), deployments }); }
        finally { await session.close(); }
        // A killed git child leaves the registry on its 'close' event, which can land a tick after close() returns:
        // wait for that, bounded, rather than sleeping a fixed time.
        for (let i = 0; i < 200 && kernel.liveGitChildren() > 0; i++) await new Promise((r) => setTimeout(r, 10));
        assert.equal(kernel.liveGitChildren(), 0, `${verb} at ${dir} (max-age ${maxAge}): no git child outlives its closed session`);
        return { answer, seen };
      } finally { process.chdir(cwd); }
    });
    const args = [...(verb === "status" ? ["status"] : ["workspace", "status"]), "--dir", dir, ...(maxAge === null ? [] : ["--max-age", String(maxAge)]), "--json"];
    const r = cli(fx, dir, args, extra);
    const label = `oats ${args.join(" ")}`;
    const { answer, seen } = inProcess;
    assert.equal(answer.exit, r.status, `${label}: exit\n${r.stdout}\n${r.stderr}`);
    const doc = JSON.parse(r.stdout);
    // The answer as a reader sends it, serialised: a key whose value is undefined (workspace status's
    // `standalone` when not standalone) is absent from both.
    const sent = JSON.parse(JSON.stringify(answer.answer));
    const reused = observationOf(doc)?.reused === true && observationOf(sent)?.reused === true;
    assert.deepEqual(normalise(sent, reused), normalise(doc, reused), label);
    assert.equal(answer.stderr, r.stderr, `${label}: stderr`);
    assert.equal(Object.hasOwn(answer.answer.result ?? answer.answer, "observation"), maxAge !== null && answer.exit === 0, `${label}: observation only with --max-age`);
    return { answer: answer.answer, exit: answer.exit, seen };
  }
  const once = (seen, dir, label) => {
    assert.equal(seen.length, 1, `${label}: the deployments observer is called once`);
    assert.equal(seen[0][0], dir, label);
  };

  // Order keeps each pair on the same cache state: the CLI runs right after its in-process call, and every
  // --max-age 60 call comes after a --max-age 0 round of the same deployment within the window, so the store
  // holds every head both sides read (both reuse); with none or 0 both observe live.
  for (const maxAge of [null, 0, 60]) {
    for (const fx of [a, b]) {
      const soul = fx === a ? "alpha" : "beta";
      const st = await compare(fx, "status", fx.dep, maxAge);
      assert.equal(st.exit, 0);
      once(st.seen, fx.dep, `status ${soul}`);
      assert.equal(st.answer.workspace.reachable, true);
      const agent = st.answer.agents.find((x) => x.name === soul);
      assert.equal(agent.instances.length, 1);
      if (fx === a) {
        assert.equal(agent.soulSource.status, "moved", "alpha's soul moved after its spawn");
        assert.deepEqual(st.answer.warnings.map((w) => w.code), ["deprecated-runtime-name"]);
      } else assert.equal(Object.hasOwn(st.answer, "warnings"), false, "alpha's warning is not beta's");
      if (maxAge === 60) assert.equal(st.answer.observation.reused, true);

      const ws = await compare(fx, "workspace", fx.dep, maxAge);
      assert.equal(ws.exit, 0);
      assert.equal(ws.answer.ok, true);
      once(ws.seen, fx.dep, `workspace status ${soul}`);
      assert.equal(Object.hasOwn(ws.answer, "warnings"), false, "status's warning is not workspace status's");
      if (maxAge === 60) assert.equal(ws.answer.result.observation.reused, true);
    }

    const none = await compare(a, "status", empty, maxAge);
    assert.equal(none.exit, 1);
    assert.equal(none.answer.error.code, "E_NO_DEPLOYMENT");
    assert.deepEqual(none.seen, [], "no deployment, nothing to list");
    const noLocal = await compare(a, "workspace", empty, maxAge);
    assert.equal(noLocal.exit, 1);
    assert.equal(noLocal.answer.ok, false);
    assert.deepEqual(noLocal.seen, [], "no oats-local.yaml, nothing to list");

    const offline = await compare(b, "status", lost, maxAge, BUDGET);
    assert.equal(offline.exit, 0);
    assert.equal(offline.answer.workspace.reachable, false);
    once(offline.seen, lost, "status unreachable");
    const refused = await compare(b, "workspace", lost, maxAge, BUDGET);
    assert.equal(refused.exit, 1);
    assert.equal(refused.answer.ok, false);
    once(refused.seen, lost, "workspace status unreachable");
  }
});
