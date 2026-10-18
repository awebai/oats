import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bin/oats.mjs", import.meta.url));

function parserFlags() {
  const source = readFileSync(cli, "utf8");
  const flags = new Set();
  // Read the actual allow-lists; refuse a changed declaration rather than
  // letting an empty or partial extraction make an omission pass.
  for (const name of ["SPAWN_VALUE_FLAGS", "SPAWN_SWITCHES"]) {
    const match = new RegExp(`const ${name}\\s*=\\s*new Set\\(\\[([^\\]]*)\\]\\)`).exec(source);
    assert.ok(match, `cannot extract ${name} from bin/oats.mjs`);
    let names;
    try { names = JSON.parse(`[${match[1]}]`); }
    catch { assert.fail(`cannot read ${name} as an array of flag names`); }
    assert.ok(names.length > 0, `${name} must not extract an empty inventory`);
    for (const flag of names) {
      assert.match(flag, /^[a-z][a-z-]*$/, `${name} contains an unreadable flag name`);
      flags.add(`--${flag}`);
    }
  }
  // --provider consumes two words in spawnArgvProblem; --server is stripped
  // by the route before that scanner. Help switches exit before dispatch.
  for (const flag of ["--provider", "--server", "--help", "-h"]) flags.add(flag);
  return flags;
}

function spawnUsage(output) {
  const lines = [];
  let inside = false;
  for (const line of output.split("\n")) {
    if (/^\s*oats\s+spawn(?:\s|$)/.test(line)) inside = true;
    else if (!/^\s+\S/.test(line) || /^\s*oats\s/.test(line)) inside = false;
    if (inside) lines.push(line);
  }
  assert.ok(lines.length > 0, "CLI help contains no spawn usage block");
  return lines.join("\n");
}

for (const args of [["spawn", "--help"], ["help"]]) {
  test(`oats ${args.join(" ")} exposes every spawn parser flag outside a deployment`, (t) => {
    const scratch = mkdtempSync(join(tmpdir(), "oats-spawn-help-"));
    t.after(() => rmSync(scratch, { recursive: true, force: true }));
    for (const dir of ["home", "tmp", "bin", "cwd"]) mkdirSync(join(scratch, dir));
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: join(scratch, "cwd"),
      // No inherited OATS, captured-context, credential or harness settings.
      // An empty PATH also keeps external launch tools out of this help check.
      env: { HOME: join(scratch, "home"), TMPDIR: join(scratch, "tmp"), PATH: join(scratch, "bin"), LANG: "C", LC_ALL: "C" },
      encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, "", "help wrote unexpected stderr");
    const documented = new Set(spawnUsage(result.stdout).match(/--[a-z][a-z-]*\b|(?<![\w-])-h\b/g) ?? []);
    const missing = [...parserFlags()].filter((flag) => !documented.has(flag)).sort();
    assert.deepEqual(missing, [], `spawn help is missing parser flags: ${missing.join(", ")}`);
  });
}
