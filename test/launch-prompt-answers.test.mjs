// oats-local.yaml launchPromptAnswers: kept in the schema only so it can be
// judged. `true` entries, an empty block and workspaceTrust are ignored with one
// warning; a home entry `false` is an operator's refusal this kernel cannot
// honour, refused as a removed key naming the two settings that keep the prompt unanswered.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateLocal, loadLocal } from "../lib/workspace.mjs";
import { launchPromptAnswersNotice } from "../lib/core.mjs";

const home = "/srv/agents/dev/instances/dev-1";
const pointer = "/launchPromptAnswers/homes/~1srv~1agents~1dev~1instances~1dev-1";
const base = { schemaVersion: 2, workspace: "github.com/example/workspace" };
const local = homes => ({ ...base, launchPromptAnswers: { homes } });

function deployment(t, value) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-lpa-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "oats-local.yaml"), JSON.stringify(value));
  return dir;
}

for (const [label, value] of [["true entries", local({ [home]: { awebDevelopmentChannel: true } })], ["an empty block", { ...base, launchPromptAnswers: {} }],
  ["empty homes", local({})], ["workspaceTrust", local({ [home]: { awebDevelopmentChannel: true, workspaceTrust: true } })],
  ["a noncanonical true key", local({ "relative/home": { awebDevelopmentChannel: true } })]]) {
  test(`${label}: no validation problem, ignored with one warning naming the key`, t => {
    assert.deepEqual(validateLocal(value), []);
    const dir = deployment(t, value);
    const notice = launchPromptAnswersNotice(dir);
    assert.match(notice, /^launchPromptAnswers in .*oats-local\.yaml is ignored: remove it\./);
    assert.match(notice, /--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace/);
  });
}

test("a home entry false is a removed-key problem at that entry naming the key and both settings", () => {
  const problems = validateLocal(local({ [home]: { awebDevelopmentChannel: false }, "/srv/other": { awebDevelopmentChannel: true } }));
  assert.equal(problems.length, 1);
  const [p] = problems;
  assert.equal(p.path, pointer);
  assert.equal(p.reason, "removed-key");
  assert.match(p.message, /launchPromptAnswers/);
  assert.match(p.message, /awebDevelopmentChannel: false/);
  assert.match(p.message, /settings\.oats\.aweb\.claudeChannelMode: approved/);
  assert.doesNotMatch(p.message, /delivery: session/);
});

test("loading a deployment whose host file says false fails with E_WORKSPACE_SCHEMA", t => {
  const dir = deployment(t, local({ [home]: { awebDevelopmentChannel: false } }));
  assert.throws(() => loadLocal(dir), e => e.code === "E_WORKSPACE_SCHEMA" && e.details.problems.some(p => p.reason === "removed-key" && p.path === pointer));
});

test("the shape is still checked: a non-boolean or unknown key is a schema problem", () => {
  assert.ok(validateLocal(local({ [home]: { awebDevelopmentChannel: "true" } })).length);
  assert.ok(validateLocal(local({ [home]: { other: true } })).length);
  assert.ok(validateLocal({ ...base, launchPromptAnswers: { everyone: true } }).length);
});

test("no block, no warning", t => {
  assert.equal(launchPromptAnswersNotice(deployment(t, base)), null);
  const empty = realpathSync(mkdtempSync(join(tmpdir(), "oats-lpa-none-")));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  mkdirSync(join(empty, "x"));
  assert.equal(launchPromptAnswersNotice(join(empty, "x")), null);
});
