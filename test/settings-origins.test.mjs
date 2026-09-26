// OATS_SETTINGS_ORIGINS (0.29.0): beside OATS_SETTINGS, a provider receives where each leaf of its
// merged payload came from — JSON pointer → { kind, at }, kind manifest-default | workspace | soul |
// host | spawn — so it can tell a value the soul set from one the host set (OKF's harvest switch
// read soul.yaml for that). Same map in every context a provider runs in: its lifecycle hooks
// (spawn; launch, from what the home recorded) and its commands (in a home; operator dispatch).
//
// The real CLI over a v2 deployment (test/helpers/v2-deployment.mjs). No network.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const ok = (r) => { const j = r.json(); assert.equal(j.ok, true, `${r.stdout}${r.stderr}`); return j.result; };

test("every hook and command of a provider gets OATS_SETTINGS_ORIGINS: the layer that set each leaf", { timeout: 120_000 }, (t) => {
  const out = realpathSync(mkdtempSync(join(tmpdir(), "oats-origins-")));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const hook = `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(out)} + "/" + process.env.OATS_EVENT + ".json", JSON.stringify({ settings: JSON.parse(process.env.OATS_SETTINGS), origins: JSON.parse(process.env.OATS_SETTINGS_ORIGINS) }));
console.log("{}");
`;
  const show = `console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: { settings: JSON.parse(process.env.OATS_SETTINGS), origins: JSON.parse(process.env.OATS_SETTINGS_ORIGINS) } }));\n`;
  const fx = v2Deployment({
    souls: { dev: { soul: { capabilities: { "acme.kb": { from: "here" } }, knowledge: { harvest: "on" } } } },
    capabilities: { "acme.kb": {
      manifest: { layer: "knowledge", command: "kbx", commands: { show: "show.mjs" }, settings: { depth: { default: 2 } }, hooks: { spawn: "hook.mjs", launch: "hook.mjs" } },
      files: { "hook.mjs": hook, "show.mjs": show },
    } },
    local: { settings: { "acme.kb": { store: "/srv/kb" } } },
  });
  t.after(fx.cleanup);
  const expected = {
    "/depth": { kind: "manifest-default", at: "oats.json#/settings/depth/default" },
    "/harvest": { kind: "soul", at: "soul.yaml#/knowledge" },
    "/store": { kind: "host", at: "oats-local.yaml#/settings/acme.kb" },
  };
  const spawnExpected = { ...expected, "/mode": { kind: "spawn", at: "--provider acme.kb" } };

  const spawned = ok(fx.cli(["spawn", "dev", "--provider", "acme.kb", "mode=review", "--no-launch", "--json"]));
  const atSpawn = JSON.parse(readFileSync(join(out, "spawn.json"), "utf8"));
  assert.deepEqual(atSpawn.settings, { depth: 2, harvest: "on", store: "/srv/kb", mode: "review" });
  assert.deepEqual(atSpawn.origins, spawnExpected, "the spawn hook: one origin per leaf");

  // A later launch runs from what the home recorded, origins included.
  ok(fx.cli(["launch-config", "preview", "--home", spawned.home, "--json"]));
  assert.deepEqual(JSON.parse(readFileSync(join(out, "launch.json"), "utf8")).origins, spawnExpected, "the launch hook");
  const meta = JSON.parse(readFileSync(join(spawned.home, "instance.json"), "utf8"));
  assert.deepEqual(meta.capabilityRuntime.find((c) => c.id === "acme.kb").settingsOrigins, spawnExpected, "instance.json records them with the settings");

  // Its commands: in the home (the recorded payload) and from the deployment (the soul's, live).
  const inHome = ok(fx.cli(["kbx", "show", "--json"], { cwd: spawned.home, env: { OATS_INSTANCE_HOME: spawned.home } }));
  assert.deepEqual(inHome.origins, spawnExpected, "a command in the home");
  const operator = ok(fx.cli(["kbx", "show", "--soul", "dev", "--json"], { env: { OATS_INSTANCE_HOME: "", PI_AGENT_HOME: "", OATS_HOME: "" } }));
  assert.deepEqual(operator.origins, expected, "an operator-level command: no spawn layer");
});
