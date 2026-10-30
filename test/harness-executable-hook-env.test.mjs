// OATS_HARNESS_EXECUTABLE (awebai/oats#1667): a spawn or launch hook is handed the kernel's pane-side
// answer as an absolute real path, for every harness, and nothing where that lookup has no answer.
// The lookups' races are test/pane-path.test.mjs, on real tmux; this is what every spawn and preview gets.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childEnv } from "../lib/automation-scope.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-harness-executable-")));
test.after(() => rmSync(base, { recursive: true, force: true }));
const out = join(base, "runs.jsonl");
const real = join(base, "real-harness");
writeFileSync(real, "#!/bin/sh\nexit 0\n"); chmodSync(real, 0o755);
const link = join(base, "harness-link");
symlinkSync(real, link);

const hook = `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(out)}, JSON.stringify({ event: process.env.OATS_EVENT, preview: process.env.OATS_LAUNCH_PREVIEW === "1", executable: process.env.OATS_HARNESS_EXECUTABLE ?? null }) + "\\n");
console.log("{}");
`;
const fx = v2Deployment({
  souls: { dev: { soul: { capabilities: { "acme.env": { from: "here" } } } } },
  capabilities: { "acme.env": { manifest: { launchPreview: true, hooks: { spawn: "hook.mjs", launch: "hook.mjs" } }, files: { "hook.mjs": hook } } },
  local: { "launch-configs": {
    linkedclaude: { harness: "claude", executable: link },
    linkedpi: { harness: "pi", executable: link },
    missing: { harness: "pi", executable: join(base, "no-such-harness") },
  } },
});
test.after(fx.cleanup);

const ok = (r) => { assert.equal(r.status, 0, r.stdout + r.stderr); return r.json().result; };
const runs = () => { try { return readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); } catch { return []; } };
const lastRun = () => runs().at(-1);
let n = 0;
const spawn = (args, env = {}) => ok(fx.cli(["spawn", "dev", "--name", `handed-${++n}`, "--no-launch", ...args, "--json"], { env }));

for (const [config, harness] of [["linkedclaude", "claude"], ["linkedpi", "pi"]]) {
  test(`${harness}: a declared executable reaches the spawn hook and a preview's launch hook as its real path`, () => {
    const { home } = spawn(["--launch-config", config]);
    assert.deepEqual(lastRun(), { event: "spawn", preview: false, executable: real });
    ok(fx.cli(["launch-config", "preview", "--home", home, "--launch-config", config, "--json"]));
    assert.deepEqual(lastRun(), { event: "launch", preview: true, executable: real });
  });
}

test("a spawn with no launch names a bare harness on this process's PATH: no answer from the pane, so nothing is handed, and an inherited value never stands in", () => {
  writeFileSync(join(base, "pi"), "#!/bin/sh\nexit 0\n"); chmodSync(join(base, "pi"), 0o755);
  spawn(["--launch-config", "none", "--harness", "pi"], { PATH: `${base}:${process.env.PATH}`, OATS_HARNESS_EXECUTABLE: "/ambient/harness" });
  assert.deepEqual(lastRun(), { event: "spawn", preview: false, executable: null });
});

test("an automation's child drops an inherited OATS_HARNESS_EXECUTABLE, as it does OATS_HARNESS", () => {
  const before = process.env.OATS_HARNESS_EXECUTABLE;
  process.env.OATS_HARNESS_EXECUTABLE = "/ambient/harness";
  try { assert.equal(Object.hasOwn(childEnv(), "OATS_HARNESS_EXECUTABLE"), false); }
  finally { if (before === undefined) delete process.env.OATS_HARNESS_EXECUTABLE; else process.env.OATS_HARNESS_EXECUTABLE = before; }
});
