// OATS_YOLO (awebai/oats#1675): a spawn or launch hook reads this launch's resolved yolo, because `launch.yolo` in
// instance.json is the previous launch's and a spawn has none. A real start is in
// test/pane-path.test.mjs, on real tmux.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childEnv } from "../lib/automation-scope.mjs";
import { validateLaunchConfig } from "../lib/core.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-hook-yolo-")));
test.after(() => rmSync(base, { recursive: true, force: true }));
const out = join(base, "runs.jsonl");

const hook = `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(out)}, JSON.stringify({ event: process.env.OATS_EVENT, preview: process.env.OATS_LAUNCH_PREVIEW === "1", yolo: process.env.OATS_YOLO ?? null }) + "\\n");
console.log("{}");
`;
const fx = v2Deployment({
  souls: { dev: { soul: { capabilities: { "acme.env": { from: "here" } } } } },
  capabilities: { "acme.env": { manifest: { launchPreview: true, hooks: { spawn: "hook.mjs", launch: "hook.mjs" } }, files: { "hook.mjs": hook } } },
  local: { "launch-configs": {
    bypass: { harness: "pi", yolo: true },
    careful: { harness: "pi", yolo: false },
    flagged: { harness: "pi", args: ["--some-bypass"] },
  } },
});
test.after(fx.cleanup);

const ok = (r) => { assert.equal(r.status, 0, r.stdout + r.stderr); return r.json().result; };
const lastRun = () => JSON.parse(readFileSync(out, "utf8").trim().split("\n").at(-1));
let n = 0;
const spawn = (args, env = {}) => ok(fx.cli(["spawn", "dev", "--name", `yolo-${++n}`, "--no-launch", ...args, "--json"], { env }));
const preview = (home, args, env = {}) => ok(fx.cli(["launch-config", "preview", "--home", home, ...args, "--json"], { env }));

test("the spawn hook and a preview's launch hook read 1 when this launch's yolo is true, from a flag or a launch configuration", () => {
  const flagged = spawn(["--launch-config", "none", "--harness", "pi", "--yolo"]);
  assert.deepEqual(lastRun(), { event: "spawn", preview: false, yolo: "1" });
  preview(flagged.home, ["--launch-config", "none", "--harness", "pi", "--yolo"]);
  assert.deepEqual(lastRun(), { event: "launch", preview: true, yolo: "1" });
  const configured = spawn(["--launch-config", "bypass"]);
  assert.deepEqual(lastRun(), { event: "spawn", preview: false, yolo: "1" });
  preview(configured.home, ["--launch-config", "bypass"]);
  assert.deepEqual(lastRun(), { event: "launch", preview: true, yolo: "1" });
});

test("anything but a true reads absent, never 0: not set, set false, and a bypass in args", () => {
  for (const args of [["--launch-config", "none", "--harness", "pi"], ["--launch-config", "none", "--harness", "pi", "--no-yolo"], ["--launch-config", "careful"], ["--launch-config", "flagged"]]) {
    const { home } = spawn(args);
    assert.deepEqual(lastRun(), { event: "spawn", preview: false, yolo: null }, args.join(" "));
    preview(home, args);
    assert.deepEqual(lastRun(), { event: "launch", preview: true, yolo: null }, args.join(" "));
  }
});

test("the flag this launch chose wins over the one the home recorded, which is what instance.json would have said", () => {
  const { home } = spawn(["--launch-config", "none", "--harness", "pi", "--yolo"]);
  preview(home, ["--launch-config", "none", "--harness", "pi", "--no-yolo"]);
  assert.deepEqual(lastRun(), { event: "launch", preview: true, yolo: null });
});

test("an inherited 1 reads absent on a launch that isn't yolo, at spawn and in a preview, and an inherited 0 never shows", () => {
  for (const value of ["1", "0"]) {
    const { home } = spawn(["--launch-config", "none", "--harness", "pi"], { OATS_YOLO: value });
    assert.deepEqual(lastRun(), { event: "spawn", preview: false, yolo: null }, value);
    preview(home, ["--launch-config", "none", "--harness", "pi", "--no-yolo"], { OATS_YOLO: value });
    assert.deepEqual(lastRun(), { event: "launch", preview: true, yolo: null }, value);
  }
});

test("a launch configuration cannot set it, and an automation's child drops it", () => {
  assert.throws(() => validateLaunchConfig("forged", { harness: "claude", env: { OATS_YOLO: "1" } }), (e) => e.code === "E_LAUNCH_CONFIG_INVALID" && e.message.includes("OATS_YOLO"));
  const before = process.env.OATS_YOLO;
  process.env.OATS_YOLO = "1";
  try { assert.equal(Object.hasOwn(childEnv(), "OATS_YOLO"), false); }
  finally { if (before === undefined) delete process.env.OATS_YOLO; else process.env.OATS_YOLO = before; }
});
