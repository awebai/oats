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
  // The scans print names only, never content, so no secret reaches the agent; P and T are set in each block.
  at("never a line's content, so no secret reaches you");
  at("Run each block as one command");
  at("(api[_-]?key|secret|token|passw(or)?d)[a-z0-9_-]*[[:space:]]*[:=]");
  assert.ok(at("**Before you ask, find what would be pushed,**") < at("**Ask, showing it:**"));
  assert.ok(at("**Ask, showing it:**") < at("**On their yes, a new repository:**"));
  // An existing repository pushes its history, which is searched: certain matches decide, possible ones are the person's call (review H1, N2).
  at('git -C "<dir>" log --all -i -G"$P" --format=\'%h\' --name-only | sort -u');
  // Certain signals decide; a possible content match is the person's call, by file name (review N9).
  at("one in its history means push nothing");
  at("so show these files to the person by name, as files that may hold a password or key, and let them choose what to leave out");
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
  // The release lane's follow-ups: the scratch repositories are removed, and a history file over 100 MB is caught.
  assert.equal(step.split('rm -rf "$T"').length - 1, 2, "both preview blocks remove their scratch repository");
  at("awk '$1 == \"blob\" && $2 > 100000000 { print $3 }'");
  at("If it names one, push nothing: offer a fresh repository");
});
