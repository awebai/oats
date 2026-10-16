// The operational skills (oats.core, oats.setup, the oats-getting-started bootstrap)
// may teach only commands and flags the shipped CLI has (implementation plan
// W9b: "every skill is validated against the shipped CLI ... so they cannot
// drift from the commands"). Every `oats …` line inside a fenced shell
// block must name a command `oats help` lists, and every flag on it must appear
// in that help text.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKILLS = [
  "oats-package/capabilities/oats-core/skills/oats-operate/SKILL.md",
  "oats-package/capabilities/oats-core/skills/oats-souls/SKILL.md",
  "oats-package/capabilities/oats-setup/skills/oats-setup-model/SKILL.md",
  "oats-package/capabilities/oats-setup/skills/oats-onboarding/SKILL.md",
  "oats-package/capabilities/oats-setup/skills/oats-setup-expert/SKILL.md",
  "oats-package/capabilities/oats-setup/skills/oats-host-delivery/SKILL.md",
  "oats-package/capabilities/oats-setup/skills/oats-workspace-config/SKILL.md",
  "oats-package/capabilities/oats-setup/skills/oats-teams/SKILL.md",
  "oats-package/capabilities/oats-setup/skills/oats-package-pins/SKILL.md",
  "oats-package/capabilities/oats-setup/skills/oats-automations/SKILL.md",
  "skills/oats-getting-started/SKILL.md",
];
// Flags a command's own usage line accepts but the top-level `oats help` omits.
// Each one must still exist in the CLI source; remove the entry once help lists it.
const HELP_GAPS = new Set(["--preview"]);
const cliSource = readFileSync(join(ROOT, "bin/oats.mjs"), "utf8");

const help = spawnSync(process.execPath, [join(ROOT, "bin/oats.mjs"), "help"], { encoding: "utf8" });
const helpText = `${help.stdout}${help.stderr}`;
// "oats <word> [<word>]" usage heads, e.g. "oats spawn", "oats workspace status", "oats instance events".
const commands = new Set();
for (const m of helpText.matchAll(/^\s*oats ([a-z][a-z-]*)(?:[ |]([a-z][a-z|-]*))?/gm)) {
  commands.add(m[1]);
  if (m[2]) for (const sub of m[2].split("|")) commands.add(`${m[1]} ${sub}`);
}

function oatsLines(text) {
  const lines = [];
  for (const block of text.matchAll(/```(?:bash|sh)\n([\s\S]*?)```/g)) {
    for (const raw of block[1].split("\n")) {
      const line = raw.replace(/#.*$/, "").trim();
      if (line.startsWith("oats ")) lines.push(line);
    }
  }
  return lines;
}

test("the CLI help is readable", () => {
  assert.equal(help.status, 0, helpText);
  assert.ok(commands.has("spawn") && commands.has("sync") && commands.has("workspace status"));
});

// A reader concluded from the help that --task-file did not exist: the spawn help line names it.
test("oats spawn --help names both task inputs, --task and --task-file", () => {
  for (const argv of [["help"], ["spawn", "--help"]]) {
    const r = spawnSync(process.execPath, [join(ROOT, "bin/oats.mjs"), ...argv], { encoding: "utf8" });
    assert.match(`${r.stdout}${r.stderr}`, /^ {2}oats spawn <agent> \[--task <text> \| --task-file <f>\]/m, argv.join(" "));
  }
});

// oats-operate quotes the drift markers `oats status` prints; they must be the CLI's own strings.
test("oats-operate quotes only drift markers the CLI renders", () => {
  const text = readFileSync(join(ROOT, SKILLS[0]), "utf8");
  const markers = [...text.matchAll(/`\[([^\]`<]+)\]`/g)].map((m) => m[1].replace(/ \(now @ …\)$/, ""));
  assert.ok(markers.length >= 4, "the drift markers are listed");
  for (const marker of markers) {
    assert.ok(cliSource.includes(marker), `drift marker [${marker}] is not rendered by bin/oats.mjs`);
  }
});

// No published skill (framework, oats.framework package, this repository's capabilities and package mirrors, or a soul's own) may teach a verb the kernel refuses (REMOVED_VERBS in bin/oats.mjs).
// The captured selector form of trust (`--deployment` plus `--resolution` or
// `--artifact-set`) is routed before that table and stays live; bare `trust` is removed.
const removedVerbs = Object.keys(Function(`return (${cliSource.match(/const REMOVED_VERBS = (\{[^\n]*\});/)[1]})`)());
const capturedTrust = (line) => /--deployment\b/.test(line) && /--(resolution|artifact-set)\b/.test(line);
function skillFiles(dir) {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...skillFiles(rel));
    else if (entry.name.endsWith(".md")) out.push(rel);
  }
  return out;
}
test("no published skill teaches a removed verb", () => {
  assert.ok(removedVerbs.includes("install") && removedVerbs.includes("trust"), "REMOVED_VERBS parsed");
  const soulSkills = readdirSync(join(ROOT, "souls"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(ROOT, "souls", d.name, "skills")))
    .flatMap((d) => skillFiles(join("souls", d.name, "skills")));
  // This repository's capabilities and its first-party package mirrors
  // (capabilities/<slug>/skills, mirrors/<slug>/skills) are published too.
  const capabilitySkills = ["capabilities", "mirrors"].flatMap((parent) => readdirSync(join(ROOT, parent), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(ROOT, parent, d.name, "skills")))
    .flatMap((d) => skillFiles(join(parent, d.name, "skills"))));
  const files = [...skillFiles("skills"), ...skillFiles("oats-package/capabilities"), ...soulSkills, ...capabilitySkills];
  const found = [];
  for (const rel of files) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    for (const [n, line] of text.split("\n").entries()) {
      for (const m of line.matchAll(/oats ([a-z][a-z-]*)(?![\w-])/g)) {
        if (!removedVerbs.includes(m[1])) continue;
        if (m[1] === "trust" && capturedTrust(line + " " + (text.split("\n")[n + 1] || ""))) continue;
        found.push(`${rel}:${n + 1} "oats ${m[1]}": ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(found, [], `skills teach removed verbs:\n${found.join("\n")}`);
});

// The host timer's unit records the PATH and the node of the shell that installs it
// (docs/schedules.md, "The host timer's unit"), so `oats schedule host install` is the
// operator's step, in their own shell, and never the agent's (#967). The two oats.setup
// skills that show the command may show it only that way: in a fenced block of install
// lines alone, under a paragraph that hands it to the operator. `--print` is not a preview
// an agent can offer: from the agent's shell it renders the agent's environment.
const HOST_INSTALL = "oats schedule host install";
const HOST_INSTALL_SKILLS = SKILLS.filter((rel) => /\/oats-(automations|onboarding)\/SKILL\.md$/.test(rel));
test("oats schedule host install is the operator's step in the skills that show it", () => {
  assert.equal(HOST_INSTALL_SKILLS.length, 2, "both oats.setup skills are checked");
  for (const rel of HOST_INSTALL_SKILLS) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    const blocks = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].filter((block) => block[1].includes(HOST_INSTALL));
    assert.ok(blocks.length > 0, `${rel}: the command stays visible, for the operator to copy`);
    for (const block of blocks) {
      const lines = block[1].split("\n").map((line) => line.replace(/#.*$/, "").trim()).filter(Boolean);
      assert.deepEqual(lines.filter((line) => !line.startsWith(HOST_INSTALL)), [], `${rel}: the install block holds no command of the agent's own`);
      assert.deepEqual(lines.filter((line) => /--print\b/.test(line)), [], `${rel}: --print is not offered as a preview of the operator's unit`);
      const before = text.slice(0, block.index).trimEnd().split(/\n[ \t]*\n/).pop().replace(/\s+/g, " ");
      for (const said of [/operator's step/, /never yours/, /their own terminal/, /outside every instance home/]) {
        assert.match(before, said, `${rel}: the paragraph before the install block hands it to the operator`);
      }
    }
  }
});

for (const rel of SKILLS) {
  test(`${rel}: every oats command and flag exists in the shipped CLI`, () => {
    const lines = oatsLines(readFileSync(join(ROOT, rel), "utf8"));
    assert.ok(lines.length > 0, "skill teaches at least one command");
    for (const line of lines) {
      const words = line.split(/\s+/).slice(1);
      const verb = words[0], sub = words[1] && /^[a-z][a-z-]*$/.test(words[1]) ? `${verb} ${words[1]}` : null;
      assert.ok(commands.has(verb) || (sub && commands.has(sub)), `unknown command in "${line}"`);
      for (const flag of line.match(/(?<![\w-])--[a-z][a-z-]*/g) || []) {
        const known = helpText.includes(flag) || (HELP_GAPS.has(flag) && cliSource.includes(`"${flag}"`));
        assert.ok(known, `flag ${flag} in "${line}" is not in oats help`);
      }
    }
  });
}
