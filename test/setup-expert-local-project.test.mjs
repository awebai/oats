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
  const from = flat.indexOf("**A project only on this computer:**"), to = flat.indexOf("For each repository the intake names");
  assert.ok(from >= 0 && to > from, "the step comes before the members are added");
  const step = flat.slice(from, to);
  assert.ok(step.includes("Put it on GitHub only on the person's yes, as a private repository"));
  // A folder inside another repository never pushes the parent (review H2).
  assert.ok(step.includes('`git -C "<dir>" rev-parse --show-toplevel` is `<dir>` itself'));
  assert.ok(step.includes("never the parent's"));
  // What is pushed is found without changing the folder, and shown before the question.
  assert.ok(step.includes('git --git-dir="$T/.git" --work-tree="<dir>" ls-files --others --exclude-standard'));
  assert.ok(step.indexOf("**Before you ask, find what would be pushed,**") < step.indexOf("**Ask, showing it:**"));
  assert.ok(step.indexOf("**Ask, showing it:**") < step.indexOf("**On their yes, a new repository:**"));
  // An existing repository pushes its history: a secret in it means push nothing (review H1).
  assert.ok(step.includes('git -C "<dir>" log --all --format= --name-only | sort -u'));
  assert.ok(step.includes("a secret that is tracked now or appears in its history means push nothing"));
  // The staged list is checked against what was shown, before the commit (review M1).
  assert.ok(step.indexOf('git -C "<dir>" diff --cached --name-only') < step.indexOf('git -C "<dir>" commit -m "First commit"'));
  assert.ok(step.includes("must be exactly what you showed"));
  assert.ok(step.indexOf("add what you leave out to the folder's `.gitignore`") < step.indexOf('git -C "<dir>" init -b main'));
  assert.ok(step.includes('gh repo create "<owner>/<name>" --private --source "<dir>" --remote origin --push'));
  assert.ok(step.includes("`PRIVATE`"), "the visibility is checked after the create");
  assert.ok(step.includes("that putting it on GitHub also starts the automations in it"), "push-triggered automations are named (briefing)");
  assert.ok(step.includes("**On their no:** create nothing."));
  assert.ok(step.includes("record it as open in the hand-back"));
});
