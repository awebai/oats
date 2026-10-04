import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseConfigData } from "../lib/config-data.mjs";

test("direct main pushes retain the same read-only CI gates as pull requests", () => {
  const workflow = parseConfigData(readFileSync(new URL("../.github/workflows/pull-request.yml", import.meta.url))).value;
  // main and every release/** maintenance branch (release/0.24 → 0.24.x) get the
  // same gate on push and on pull request — the two lists must stay equal.
  assert.deepEqual(workflow.on.push.branches, ["main", "release/**"]);
  assert.deepEqual(workflow.on.pull_request.branches, workflow.on.push.branches);
  assert.equal(workflow.permissions.contents, "read");
  assert.match(workflow.concurrency.group, /github\.event\.pull_request\.number \|\| github\.sha/);
  const steps = workflow.jobs.verify.steps, commands = steps.map((step) => step.run);
  for (const command of ["npm run check", "npm run check:pi", "npm run validate", "npm run pack:check", "npm run smoke:tarball"]) {
    assert.ok(commands.includes(command), `missing gate: ${command}`);
  }
  // The legacy soul knowledge bundles (agents/*/soul/knowledge) moved to the central base,
  // which validates itself; the repository no longer carries a validate:okf gate.
  assert.ok(!commands.includes("npm run validate:okf"), "no gate for the removed soul bundles");
  // The suite runs sharded: every shard of the matrix runs `npm test -- --test-shard=k/N`,
  // and each shard installs the desktop deps (no Desktop suite silently skipped).
  const tests = workflow.jobs.tests, shards = tests.strategy.matrix.shard;
  const n = shards.length;
  assert.deepEqual(shards, Array.from({ length: n }, (_, i) => i + 1));
  assert.ok(tests.steps.some((step) => step.run === `npm test -- --test-shard=\${{ matrix.shard }}/${n}`), "every shard must run npm test with its shard");
  assert.ok(tests.steps.some((step) => step.run === "npm ci" && step["working-directory"] === "packages/desktop"), "Desktop regressions must not be silently skipped");
  assert.equal(tests.strategy["fail-fast"], false);
  // One stable check name gates on BOTH the shards and the static gates.
  const gate = workflow.jobs.gate;
  assert.equal(gate.name, "Node 22 / test, validate, pack, smoke");
  assert.deepEqual(gate.needs, ["tests", "verify", "desktop-standalone"]);
  assert.equal(gate.if, "always()");
  // `always()` runs the gate after a failed job too, so needing a job is not enough: the
  // gate must test each needed job's result itself, or that job's failure passes the gate.
  const checks = gate.steps.flatMap((step) => (step.run ?? "").split("\n").map((line) => line.trim()));
  for (const job of gate.needs) {
    assert.ok(checks.includes(`test "\${{ needs.${job}.result }}" = success`), `the gate must fail when ${job} did not succeed`);
  }
});

test("pull-request CI runs the Desktop suite with only packages/desktop installed, as the release does", () => {
  const read = (name) => parseConfigData(readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url))).value;
  const DESKTOP = "packages/desktop", INSTALL = /\bnpm\s+(ci|i|install|clean-install)\b/;
  // Every command line a job runs, with the directory it runs in (the repository root unless the step names one).
  const commands = (job) => job.steps.filter((step) => step.run).flatMap((step) => step.run.split("\n")
    .map((line) => line.trim()).filter(Boolean).map((line) => ({ line, dir: step["working-directory"] ?? "." })));
  const using = (job, action) => job.steps.find((step) => step.uses?.startsWith(`actions/${action}@`));

  // release.yml's desktop-build installs and tests in packages/desktop only, never at the
  // root. The shards install the root first, so they cannot see a Desktop test that reaches
  // a root-only dependency: this job is the one place pull-request CI runs it as the tag will.
  const job = read("pull-request.yml").jobs["desktop-standalone"];
  assert.ok(job, "pull-request CI must run the Desktop suite with a Desktop-only install");
  assert.equal(job["runs-on"], "ubuntu-latest");
  for (const { line, dir } of commands(job)) {
    assert.ok(!INSTALL.test(line) || dir === DESKTOP, `the Desktop-only job must not install outside ${DESKTOP}: \`${line}\` runs in ${dir}`);
  }
  const standalone = [{ line: "npm ci", dir: DESKTOP }, { line: "npm test", dir: DESKTOP }];
  assert.deepEqual(commands(job), standalone, "the Desktop-only job runs npm ci, then npm test, in packages/desktop, and nothing else");
  // A red run must stay red: nothing skips the job or a step, and no failure is tolerated.
  for (const part of [job, ...job.steps]) {
    assert.equal(part.if, undefined, "no condition may skip the Desktop-only job or one of its steps");
    assert.equal(part["continue-on-error"], undefined, "a Desktop-only failure must fail the job");
  }

  // Parity with the release: before packaging, desktop-build runs exactly these commands, on
  // the same Node and the same shallow checkout. Change how the release installs or tests
  // Desktop and this fails until the pull-request job is changed with it.
  const build = read("release.yml").jobs["desktop-build"], released = commands(build);
  const dist = build.steps.find((step) => /^\s*npm run dist(\s|$)/m.test(step.run ?? ""));
  assert.ok(dist, "release desktop-build packages with npm run dist");
  const block = commands({ steps: [dist] });
  assert.deepEqual(block.slice(0, block.findIndex(({ line }) => /^npm run dist(\s|$)/.test(line))), standalone,
    "release desktop-build no longer runs npm ci then npm test in packages/desktop before npm run dist: change the desktop-standalone job with it");
  assert.deepEqual(released.filter(({ line }) => INSTALL.test(line)), [standalone[0]],
    "release desktop-build installs somewhere else too: the desktop-standalone job must install the same way");
  assert.equal(using(job, "setup-node").with["node-version"], using(build, "setup-node").with["node-version"]);
  for (const checkout of [using(job, "checkout"), using(build, "checkout")]) {
    assert.equal(checkout.with?.["fetch-depth"], undefined, "both check out shallow: history a Desktop test needs is missing at the tag too");
  }
});
