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
  "oats-package/capabilities/oats-setup/skills/oats-onboarding/SKILL.md",
  "oats-package/capabilities/oats-setup/skills/oats-package-pins/SKILL.md",
  "oats-package/capabilities/oats-setup/skills/oats-rebuild/SKILL.md",
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

// oats-operate quotes the drift markers `oats status` prints; they must be the CLI's own strings.
test("oats-operate quotes only drift markers the CLI renders", () => {
  const text = readFileSync(join(ROOT, SKILLS[0]), "utf8");
  const markers = [...text.matchAll(/`\[([^\]`<]+)\]`/g)].map((m) => m[1].replace(/ \(now @ …\)$/, ""));
  assert.ok(markers.length >= 4, "the drift markers are listed");
  for (const marker of markers) {
    assert.ok(cliSource.includes(marker), `drift marker [${marker}] is not rendered by bin/oats.mjs`);
  }
});

// No published skill (framework, oats.framework package, bundled capability copies, or a soul's own) may teach a verb the kernel refuses (REMOVED_VERBS in bin/oats.mjs).
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
  // Bundled first-party capability copies (capabilities/<slug>/skills) are published too.
  const capabilitySkills = readdirSync(join(ROOT, "capabilities"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(ROOT, "capabilities", d.name, "skills")))
    .flatMap((d) => skillFiles(join("capabilities", d.name, "skills")));
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
