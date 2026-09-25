// A capability's own kernel range (its manifest's `compatibility.oats`) is enforced on the
// workspace model: a module written for another kernel is refused where a soul resolves
// (spawn --preview, inspect --soul) with E_CAPABILITY_INCOMPATIBLE, and `inspect` shows each
// module's range against the running kernel. Found by the (e) assessment: before this, v2 never
// checked it (the only checker lived in the captured loaders).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const KERNEL = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const ok = (r, what) => { assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`); const j = r.json(); assert.equal(j.ok, true, `${what}: ${r.stdout}`); return j.result; };

function fixture(range) {
  return v2Deployment({
    name: "acme",
    souls: { dev: { soul: { capabilities: { "acme.tool": { from: "here" }, "acme.plain": { from: "here" } } } } },
    capabilities: {
      "acme.tool": { manifest: { compatibility: { oats: range }, command: "tool", commands: { show: "show.mjs" } }, files: { "show.mjs": "process.exit(0);\n" } },
      "acme.plain": { manifest: { command: "plain", commands: { show: "show.mjs" } }, files: { "show.mjs": "process.exit(0);\n" } },
    },
  });
}

test("a module whose compatibility.oats does not admit the running kernel refuses spawn --preview and inspect --soul (E_CAPABILITY_INCOMPATIBLE)", (t) => {
  const fx = fixture(">=99.0.0"); t.after(fx.cleanup);
  for (const args of [["spawn", "dev", "--preview", "--json"], ["inspect", "--soul", "dev", "--json"]]) {
    const r = fx.cli(args);
    const j = r.json();
    assert.equal(j.ok, false, `${args[0]}: ${r.stdout}`);
    assert.equal(j.error.code, "E_CAPABILITY_INCOMPATIBLE", r.stdout);
    assert.deepEqual([j.error.details.capability, j.error.details.range, j.error.details.kernel], ["acme.tool", ">=99.0.0", KERNEL]);
    assert.match(j.error.message, /acme\.tool requires oats >=99\.0\.0; this kernel is /);
  }
});

test("a compatible module resolves, and inspect shows every module's range against the running kernel; a home whose module copy no longer admits the kernel reports capability-incompatible", async (t) => {
  const fx = fixture(`>=${KERNEL}`); t.after(fx.cleanup);
  ok(fx.cli(["spawn", "dev", "--preview", "--json"]), "spawn --preview");
  const soul = ok(fx.cli(["inspect", "--soul", "dev", "--json"]), "inspect --soul");
  const rows = Object.fromEntries(soul.capabilities.map((c) => [c.id, c.compatibility]));
  assert.deepEqual(rows["acme.tool"], { ok: true, range: `>=${KERNEL}`, kernel: KERNEL });
  assert.deepEqual(rows["acme.plain"], { ok: true, range: ">=0.24.0", kernel: KERNEL }, "the fixture helper's default range (a manifest with none: range null, unit-tested in resolve.test.mjs)");
  assert.equal(soul.problems.some((p) => p.code === "capability-incompatible"), false);

  const { home } = await fx.spawn("dev", { instance: "dev-compat" });
  let doc = ok(fx.cli(["inspect", "--home", home, "--json"]), "inspect --home");
  assert.equal(doc.problems.some((p) => p.code === "capability-incompatible"), false);
  // A later kernel is simulated by raising the range in the home's own module copy (what a home
  // spawned under one kernel looks like to a kernel its module no longer admits): the home is
  // not refused (it exists), inspect names the problem.
  const manifestFile = join(home, ".oats", "modules", "acme.tool", "oats.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  writeFileSync(manifestFile, JSON.stringify({ ...manifest, compatibility: { oats: ">=99.0.0" } }, null, 2));
  doc = ok(fx.cli(["inspect", "--home", home, "--json"]), "inspect --home, incompatible module");
  assert.deepEqual(doc.capabilities.find((c) => c.id === "acme.tool").compatibility, { ok: false, range: ">=99.0.0", kernel: KERNEL });
  const problem = doc.problems.find((p) => p.code === "capability-incompatible");
  assert.deepEqual([problem?.capability, problem?.range, problem?.kernel], ["acme.tool", ">=99.0.0", KERNEL], JSON.stringify(doc.problems));
});

test("a capability agent is held to its capability's range too (E_CAPABILITY_INCOMPATIBLE at its spawn)", (t) => {
  const fx = v2Deployment({
    name: "acme",
    souls: { dev: { soul: {} } },
    capabilities: { "acme.rev": { manifest: { compatibility: { oats: ">=99.0.0" }, agents: ["agents/reviewer"] }, files: {
      "agents/reviewer/soul.yaml": "name: reviewer\nkind: capability\nwork: directory\nruntime: pi\ndescription: Reviewer.\n",
      "agents/reviewer/AGENTS.md": "# Reviewer\n",
    } } },
  });
  t.after(fx.cleanup);
  const r = fx.cli(["spawn", "reviewer", "--no-launch", "--json"]);
  const j = r.json();
  assert.equal(j.ok, false, r.stdout);
  assert.equal(j.error.code, "E_CAPABILITY_INCOMPATIBLE", r.stdout);
  assert.deepEqual([j.error.details.capability, j.error.details.range, j.error.details.kernel], ["acme.rev", ">=99.0.0", KERNEL]);
});
