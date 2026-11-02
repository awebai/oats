// A project only on the person's computer goes to GitHub only on their yes, private, with what is pushed
// shown first (#1665, onboarding VM campaign; the newcomer run's setup expert improvised this step).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const skill = readFileSync(join(ROOT, "oats-package/capabilities/oats-setup/skills/oats-setup-expert/SKILL.md"), "utf8");
const flat = skill.replace(/\s+/g, " ");

test("a local-only project is put on GitHub only on the person's yes, private, with what is pushed shown first", () => {
  const step = flat.slice(flat.indexOf("**A project only on this computer**"), flat.indexOf("For each repository the intake names"));
  assert.ok(step.length > 0, "the step comes before the members are added");
  assert.ok(step.includes("put it on GitHub only on the person's yes"));
  assert.ok(step.indexOf("show them what would be pushed") < step.indexOf("**On their yes:**"), "shown before the yes");
  assert.ok(step.includes("leave out anything that looks like a secret"));
  assert.ok(step.includes("first add what you left out to the folder's `.gitignore`"), "excluded files never reach the commit");
  assert.ok(step.includes('gh repo create "<owner>/<name>" --private --source "<dir>" --remote origin --push'));
  assert.ok(step.includes("`PRIVATE`"), "the visibility is checked after the create");
  assert.ok(step.includes("**On their no:** create nothing."));
  assert.ok(step.includes("record it as open in the hand-back"));
});
