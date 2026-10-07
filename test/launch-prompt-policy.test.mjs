import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalLaunchPromptHome, effectiveLaunchPromptPolicy } from "../lib/launch-prompt-policy.mjs";
import { validateLocal, validateSoul, validateWorkspace } from "../lib/workspace.mjs";

function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-launch-policy-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const local = (home, consent) => ({ schemaVersion: 2, workspace: "example.com/team/workspace", launchPromptAnswers: { homes: { [home]: consent } } });
const disabled = { awebDevelopmentChannel: false, consentSource: null };

test("sole exact-home development-channel consent defaults false", (t) => {
  const home = join(fixture(t), "new", "home");
  assert.deepEqual(validateLocal(local(home, {})), []);
  const config = local(home, { awebDevelopmentChannel: true });
  assert.deepEqual(effectiveLaunchPromptPolicy(config, home, "/host/oats-local.yaml"), {
    awebDevelopmentChannel: true,
    consentSource: `/host/oats-local.yaml#/launchPromptAnswers/homes/${home.replaceAll("/", "~1")}`,
  });
  assert.deepEqual(effectiveLaunchPromptPolicy(config, join(home, "child"), "file"), disabled);
  assert.deepEqual(effectiveLaunchPromptPolicy(config, join(home, "..", "other"), "file"), disabled);
  assert.deepEqual(effectiveLaunchPromptPolicy({ settings: { "oats.aweb": { claudeChannelMode: "development" } } }, home, "file"), disabled);
  assert.deepEqual(effectiveLaunchPromptPolicy({}, home, "file"), disabled);
  assert.equal(effectiveLaunchPromptPolicy(local(home, { awebDevelopmentChannel: false }), home, "file").awebDevelopmentChannel, false);
});

test("workspaceTrust is unknown even when false and gives actionable separate-work guidance", (t) => {
  const home = fixture(t);
  for (const value of [true, false]) {
    const config = local(home, { workspaceTrust: value });
    const problems = validateLocal(config);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].reason, "unsupported-launch-prompt");
    assert.match(problems[0].message, /remove this key.*oats#712/);
    assert.throws(() => effectiveLaunchPromptPolicy(config, home, "file"), error => error.code === "E_WORKSPACE_SCHEMA" && /remove this key.*oats#712/.test(error.message));
  }
});

test("all policy levels reject unknown keys, nonobjects and boolean coercion", (t) => {
  const home = fixture(t);
  const bad = [null, [], true, { workspaceTrust: true }, { homes: null }, { homes: [] }, { homes: { [home]: null } }, { homes: { [home]: { other: true } } }];
  for (const value of ["true", "false", 1, 0, null, [], {}]) for (const key of ["awebDevelopmentChannel"]) bad.push({ homes: { [home]: { [key]: value } } });
  for (const policy of bad) {
    const config = { ...local(home, {}), launchPromptAnswers: policy };
    assert.ok(validateLocal(config).length, JSON.stringify(policy));
    assert.throws(() => effectiveLaunchPromptPolicy(config, home, "file"), { code: "E_WORKSPACE_SCHEMA" });
  }
});

test("canonical existing ancestors permit future homes but aliases and unsafe path spellings fail", (t) => {
  const dir = fixture(t), home = join(dir, "future", "home");
  assert.equal(canonicalLaunchPromptHome(home), home);
  mkdirSync(home, { recursive: true });
  assert.equal(canonicalLaunchPromptHome(home), home);
  symlinkSync(join(dir, "future"), join(dir, "alias"));
  symlinkSync(join(dir, "missing"), join(dir, "dangling"));
  writeFileSync(join(dir, "file"), "x");
  for (const bad of ["relative", "~/home", `${dir}/*`, `${dir}/../x`, `${home}/`, `${dir}//x`, join(dir, "alias", "home"), join(dir, "alias", "not-created"), join(dir, "dangling", "home"), join(dir, "file", "home"), `${dir}/\0`]) {
    assert.throws(() => canonicalLaunchPromptHome(bad), undefined, bad);
    assert.ok(validateLocal(local(bad, { awebDevelopmentChannel: true })).some((p) => p.reason === "noncanonical-home"), bad);
  }
});

test("replacing a future ancestor with a symlink disables previously valid policy", (t) => {
  const dir = fixture(t), home = join(dir, "future", "home"), config = local(home, { awebDevelopmentChannel: true });
  assert.equal(effectiveLaunchPromptPolicy(config, home, "file").awebDevelopmentChannel, true);
  mkdirSync(join(dir, "elsewhere"));
  symlinkSync(join(dir, "elsewhere"), join(dir, "future"));
  assert.throws(() => effectiveLaunchPromptPolicy(config, home, "file"), { code: "E_WORKSPACE_SCHEMA" });
});

test("workspace and soul declarations cannot carry host launch consent", () => {
  for (const validate of [validateWorkspace, validateSoul]) assert.ok(validate({ schemaVersion: 2, launchPromptAnswers: {} }).some((p) => p.path === "/launchPromptAnswers"));
});
