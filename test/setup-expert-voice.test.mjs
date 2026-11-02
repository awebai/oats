// The setup expert keeps the getting-started skill's newcomer voice (#1665, onboarding VM campaign):
// its first questions and its brief speak about the person's project, not OATS's model.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const flat = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\s+/g, " ");

test("the setup expert talks to the person in everyday words", () => {
  const expert = flat("oats-package/capabilities/oats-setup/skills/oats-setup-expert/SKILL.md");
  assert.ok(expert.includes("**Talk to the person in everyday words.**"));
  assert.ok(expert.includes("Don't say repository, member, host, workspace file, soul, instance, root, harness, readiness, deployment, capability, CLI, token, merge, branch protection or ruleset"));
  assert.ok(expert.includes("with a recommended default"));
});

test("tailoring the workspace keeps that voice, in its questions and its brief", () => {
  const tailor = flat("oats-package/capabilities/oats-onboarding/skills/oats-tailor-workspace/SKILL.md");
  assert.ok(tailor.includes("Talk to them in everyday words, as `/oats-setup-expert` says, in every question and in the brief (step 6)."));
  assert.ok(!tailor.includes("where to read them (repository and path)"), "the brief names no repository paths");
});
