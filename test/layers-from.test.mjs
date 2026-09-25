// layers.<layer>.from (feature layers-from): `oats inspect --json` names where each filled slot's
// capability came from — "soul" | "workspace" | "team:<label>". A soul answers from its resolution;
// a home answers what its spawn recorded (instance.json workspace.layers), never re-derived.
//
// The real CLI over a v2 deployment (test/helpers/v2-deployment.mjs). Never bare `oats setup`; no network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const EMPTY = { messaging: { id: null, from: null }, tasks: { id: null, from: null } };

test("layers-from: a soul reports its live origin; a home reports its spawn-time origin after the workspace moves it; a home without the record reports none", { timeout: 120_000 }, async (t) => {
  const fx = v2Deployment({ capabilities: { notes: { manifest: { layer: "knowledge" } } } });
  t.after(fx.cleanup);
  const ws = (defaults) => ({ "oats-workspace.yaml": { yaml: { schemaVersion: 2, name: "fixture", members: [fx.ref], teams: { global: { description: "Fixture team" } },
    defaults: { knowledge: "none", messaging: "none", tasks: "none", ...defaults } } } });
  fx.commit(ws({ knowledge: { notes: { from: fx.key } } }), "notes is the knowledge slot default");
  const inspect = (...args) => { const r = fx.cli(["inspect", ...args, "--json"]); assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`); return r.json().result; };
  assert.equal(fx.cli(["sync", "--json"]).status, 0);

  assert.deepEqual(inspect("--soul", "dev").layers, { knowledge: { id: "notes", from: "workspace" }, ...EMPTY });
  const { home } = await fx.spawn("dev");
  assert.deepEqual(JSON.parse(readFileSync(join(home, "instance.json"), "utf8")).workspace.layers,
    { knowledge: { capability: "notes", from: "workspace" }, messaging: null, tasks: null }, "the spawn records its slot rows");

  // The workspace now gives notes through the team's defaults: the soul follows, the home keeps its record.
  fx.commit(ws({ byTeam: { global: { capabilities: { notes: { from: fx.key } } } } }), "notes via the global team");
  assert.equal(fx.cli(["sync", "--json"]).status, 0);
  assert.deepEqual(inspect("--soul", "dev").layers.knowledge, { id: "notes", from: "team:global" });
  assert.deepEqual(inspect("--home", home).layers, { knowledge: { id: "notes", from: "workspace" }, ...EMPTY });

  // A home spawned before the kernel recorded it: no guess.
  const file = join(home, "instance.json");
  const meta = JSON.parse(readFileSync(file, "utf8")); delete meta.workspace.layers; writeFileSync(file, JSON.stringify(meta, null, 2));
  assert.deepEqual(inspect("--home", home).layers, { knowledge: { id: "notes", from: null }, ...EMPTY });

  const v = fx.cli(["version", "--json"]);
  assert.ok(JSON.parse(v.stdout).features.includes("layers-from"));
});
