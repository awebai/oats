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
  assert.ok(expert.includes("Avoid OATS's and Git's own words, for example repository, member, host, workspace file, soul, instance"));
  assert.ok(expert.includes("with a recommended default"));
  // What the person must act on is shown exactly, and the briefing's rules come first (review H1).
  assert.ok(expert.includes("**When they must act on something exact, show it:**"));
  assert.ok(expert.includes("The briefing's rules on what the person types and on showing a change before a push come first."));
  // The example matches step 3, which adds the membership file to a repository on GitHub, with the change shown first (review H2).
  assert.ok(expert.includes("I'll show you the change before I save it there."));
});

test("tailoring the workspace keeps that voice, in its questions and its brief", () => {
  const tailor = flat("oats-package/capabilities/oats-onboarding/skills/oats-tailor-workspace/SKILL.md");
  assert.ok(tailor.includes("Talk to them in everyday words, as `/oats-setup-expert` says, in every question and in the brief (step 6), and show them what they must act on exactly, as it says."));
  assert.ok(!tailor.includes("where to read them (repository and path)"), "the brief names no repository paths");
});

// The onboarding VM campaign's further runs (#1665): attribution is the person's click, never a terminal step.
test("tailoring: the person ties their agents with one click, never a terminal step with a passphrase", () => {
  const tailor = flat("oats-package/capabilities/oats-onboarding/skills/oats-tailor-workspace/SKILL.md");
  assert.ok(tailor.includes("## 4. Tie the agents to the person, for human attribution"));
  assert.ok(tailor.includes("**agents run every command, and no agent holds the person's signing key**. The person's one act is a click"));
  // The condition comes first: no step in the messaging skill, a self-custodial key or no aweb Cloud means run nothing.
  const step4 = tailor.slice(tailor.indexOf("## 4. Tie the agents"), tailor.indexOf("## 5. "));
  const look = step4.indexOf("**First, look for the step.**"), none = step4.indexOf("If that skill names no such step, run nothing"), click = step4.indexOf("The person's one act is a click");
  assert.ok(look > 0 && none > look && click > none, "look for the step, run nothing without it, only then the click");
  assert.ok(step4.includes("**Also run nothing** when the person's aweb key is self-custodial"));
  assert.ok(step4.includes("Say in step 6 that their agents stay unattributed and keep working."));
  assert.ok(step4.includes("A declined or expired request leaves nothing signed. Report it to the person; never start another request on your own."));
  assert.ok(tailor.includes("They type no command and no passphrase for it."));
  assert.ok(tailor.includes("Agents already running, you included, are attached in place: no respawn and no new identities."));
  assert.ok(tailor.includes("run nothing: no terminal step and no respawn."));
  assert.doesNotMatch(tailor, /deployment[- ]agent|The deployment's agent|asks for their passphrase|stay `unknown` until they are|what respawning would change/);
});

test("the setup expert's hand-over list matches the getting-started template, and its hand-back is in plain words", () => {
  const expert = flat("oats-package/capabilities/oats-setup/skills/oats-setup-expert/SKILL.md");
  const holds = expert.slice(expert.indexOf("It holds:"), expert.indexOf("It holds no secret"));
  for (const line of ["the host and its type: a monorepo, a dedicated host or the first repository", "the steward lines", "the harness's channel mode", "Tasks (a new workspace with aweb): `oats.aweb-tasks`, or `none` beside a tracker", "what the person may want to know later"]) {
    assert.ok(holds.includes(line), `the list holds: ${line}`);
  }
  // Each of those is a line the template writes.
  const template = flat("skills/oats-getting-started/SKILL.md");
  for (const line of ["- Host: <owner>/<repo>, a monorepo | a dedicated host | the first repository", "- Machine found-list only: steward R", "- Harness channel mode:", "- Tasks (new workspace with aweb):", "- For the person, later:"]) {
    assert.ok(template.includes(line), `the template writes: ${line}`);
  }
  assert.ok(expert.includes("a tasks default (`defaults.tasks`: `oats.aweb-tasks`, or `none` beside a tracker, as the hand-over's Tasks line says)"));
  const handBack = expert.slice(expert.indexOf("8. **Hand back to the person**"), expert.indexOf("These steps need oats.framework"));
  assert.ok(handBack.includes("in everyday words"));
  assert.ok(handBack.includes("with no versions"));
  assert.ok(!/OATS 0\.52\.0|session attach/.test(handBack), "no versions or attach commands in the hand-back");
  assert.ok(handBack.includes("give them the one line to type there only if they ask: `oats tui --dir D`"));
  // The agent replaces itself, in order: the new one named and checked first, the retirement last; the person runs none of it.
  const swap = expert.slice(expert.indexOf("offer to start a new setup assistant for them"), expert.indexOf("7. **Sync, check, first working soul:**"));
  const steps = [
    "`oats spawn <your soul> --dir D --relation unrelated --name <your name>-2 --task-file <file>`",
    "`oats status --dir D --json` shows it running and not waiting on you, and the briefing's read-only aweb check for its soul says `member: true`",
    "Tell the person its name as the Desktop lists it.",
    "Read `oats retire <your name> --plan`. If it lists children, tell the person which of their agents would stop, and ask.",
    "Write your state file. Only then retire yourself: `oats retire <your name> --self`.",
    "If a check fails, keep this session, and tell the person so. The person runs none of these.",
  ];
  let at = 0;
  for (const step of steps) { const i = swap.indexOf(step, at); assert.ok(i >= at, `in order: ${step}`); at = i + step.length; }
  assert.ok(!expert.includes("they retire this one"));
  assert.ok(!expert.includes("own coordination, knowledge and tasks capabilities"), "tasks is authored only beside a tracker, on the person's yes");
  assert.ok(expert.includes("own coordination and knowledge capabilities, and, beside a tracker and on the person's yes, a tasks capability"));
  assert.ok(expert.includes("`<workspace>-<machine>-oats-setup-expert` on a machine that joins an existing workspace, or `<workspace>-oats-setup` when a soul holds the first name"));
});

test("the setup model names the framework's setup soul as onboard picks it, and every tasks provider", () => {
  const model = flat("oats-package/capabilities/oats-setup/skills/oats-setup-model/SKILL.md");
  assert.ok(model.includes("tasks (`oats.aweb-tasks`, `oats.jira`, `oats.linear`)"));
  assert.ok(!model.includes("a soul of its own that holds `oats.setup`"));
  assert.ok(model.includes("among the souls that declare `oats.setup`, the workspace's own soul named `<workspace>-oats-setup-expert`, else `oats.framework`'s `oats-setup-expert`, else the first by name"));
  // The order and the names are the kernel's, pinned by behaviour in test/onboard.test.mjs ("#1665 D1: next.spawn takes the workspace's own setup soul, ...").
  assert.ok(model.includes("`<workspace>-<machine>-oats-setup-expert`"));
  assert.ok(model.includes("`<workspace>-oats-setup` when a soul of the workspace already holds the first name"));
  assert.ok(model.includes("Before `oats.framework` 1.18.0, add one like any soul (`/oats-workspace-config`)."));
  const soul = flat("oats-package/souls/oats-setup-expert/AGENTS.md");
  assert.ok(soul.includes("`<workspace>-oats-setup-expert` for a new workspace, and `<workspace>-<machine>-oats-setup-expert` on a machine that joins an existing one (`<workspace>-oats-setup` in place of the first when a soul of the workspace holds that name)"));
});
