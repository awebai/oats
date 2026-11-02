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
  const at = (phrase) => { const i = step.indexOf(phrase); assert.ok(i >= 0, `missing: ${phrase}`); return i; };
  at("Put it on GitHub only on the person's yes, as a private repository");
  // A folder inside another repository: the parent's code on GitHub is asked about, never duplicated or pushed (review H2, N3).
  at('`git -C "<dir>" rev-parse --show-toplevel`');
  at("the code is on GitHub already: ask whether the parent is the project to add");
  at("never the parent's");
  // What is pushed is found without changing the folder, with secrets searched by content, and shown before the question.
  at('git --git-dir="$T/.git" --work-tree="<dir>" ls-files --others --exclude-standard');
  at("xargs -0 grep -IilE \"$P\"");
  at("(api[_-]?key|secret|token|passw(or)?d)[a-z0-9_-]*[[:space:]]*[:=]");
  assert.ok(at("**Before you ask, find what would be pushed,**") < at("**Ask, showing it:**"));
  assert.ok(at("**Ask, showing it:**") < at("**On their yes, a new repository:**"));
  // An existing repository pushes its history: its content is searched, and any match means push nothing (review H1, N2).
  at('git -C "<dir>" log --all -p --format= | grep -icE "$P"');
  at("any match, now or anywhere in its history, means push nothing");
  at("A detached HEAD prints no branch: stop and ask.");
  // The staged list is checked against what was shown, before the commit (review M1, N4).
  assert.ok(at('git -C "<dir>" diff --cached --name-only') < at('git -C "<dir>" commit -m "First commit"'));
  at("must be exactly what you showed, plus `.gitignore`");
  assert.ok(at("add what you leave out to the folder's `.gitignore`") < at('git -C "<dir>" init -b main'));
  at('gh repo create "<owner>/<name>" --private --source "<dir>" --remote origin --push');
  at("`PRIVATE`");
  at("that putting it on GitHub also starts the automations in it");
  at("**On their no:** create nothing.");
  at("record it as open in the hand-back");
});
