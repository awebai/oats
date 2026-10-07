// `oats sync --plan` (#731): the same discovery, resolution and report as `oats sync`, written nowhere. And
// `oats sync` refuses a flag or a positional it does not read, before anything is written: `--plan` was once
// such a flag, silently ignored, and the "preview" applied.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { buildNorthwind } from "./fixtures/northwind/build.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);

function oats(args, { cwd, env, base }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PI_AGENT_HOME: "", OATS_HOME: "", OATS_REMOTE_CACHE: join(base, "cache"), ...env },
  });
}
const envelope = (r) => { const doc = JSON.parse(r.stdout); assert.equal(r.stdout.trim(), JSON.stringify(doc), "one JSON envelope"); return doc; };
/** Every entry under the deployment: path → bytes digest and mtime (directories: mtime). */
function tree(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name), st = statSync(p);
      out[relative(dir, p)] = e.isDirectory() ? { dir: true, mtimeMs: st.mtimeMs } : { sha: createHash("sha256").update(readFileSync(p)).digest("hex"), mtimeMs: st.mtimeMs };
      if (e.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out;
}

async function northwind() {
  const base = mkdtempSync(join(tmpdir(), "oats-sync-plan-"));
  const fx = await buildNorthwind(join(base, "fx"));
  const catalogFile = join(base, "catalog.json");
  writeFileSync(catalogFile, JSON.stringify({ packages: fx.catalog }, null, 2));
  mkdirSync(join(base, "home"));
  const dep = join(base, "dep");
  mkdirSync(dep);
  writeFileSync(join(dep, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${fx.refs.agents}\n`);
  return { base, dep, env: { OATS_PACKAGE_CATALOG: catalogFile, HOME: join(base, "home") } };
}

test("sync --plan writes nothing and reports the changes the following bare sync applies", { timeout: 300_000 }, async () => {
  const { base, dep, env } = await northwind();
  try {
    const lockFile = join(dep, "oats-lock.json");
    // A first plan on a deployment that never synced: nothing at all is created.
    const before0 = tree(dep);
    let r = oats(["sync", "--plan", "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const first = envelope(r).result;
    assert.equal(first.plan, true);
    assert.deepEqual(first.changes.map((c) => [c.id, c.from, c.to]), [["nw.tools", null, "0.4.0"], ["oats.framework", null, "1.1.3"], ["oats.okf", null, "2.1.3"]]);
    assert.equal(first.workspace.lock, lockFile, "the lock a sync would write");
    assert.deepEqual(tree(dep), before0, "no lock, no agents/, no automations snapshot");

    // A synced deployment whose lock lacks a package: the plan names it, the lock keeps its bytes and mtime.
    r = oats(["sync", "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(envelope(r).result.plan, undefined, "a bare sync is no plan");
    // An automations snapshot to replace: a sync would rewrite it (Northwind has no automations), a plan must not.
    mkdirSync(join(dep, ".agents", "automations"), { recursive: true });
    writeFileSync(join(dep, ".agents", "automations", "snapshot.json"), JSON.stringify({ triggers: [], schedules: [] }) + "\n");
    const lock = JSON.parse(readFileSync(lockFile, "utf8"));
    delete lock.packages["oats.okf"];
    writeFileSync(lockFile, JSON.stringify(lock, null, 2) + "\n");
    const past = new Date(Date.now() - 3_600_000);
    for (const f of [lockFile, join(dep, ".agents", "automations", "snapshot.json")]) utimesSync(f, past, past);
    const before = tree(dep);
    r = oats(["sync", "--plan", "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const plan = envelope(r).result;
    assert.equal(plan.plan, true);
    assert.deepEqual(plan.changes.map((c) => [c.id, c.from, c.to]), [["oats.okf", null, "2.1.3"]]);
    assert.deepEqual(tree(dep), before, "the lock keeps its bytes and mtime; nothing else under the deployment moves");

    // The text preview says what a bare sync would change, and still writes nothing.
    r = oats(["sync", "--plan"], { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^to change {2}oats\.okf {2}— → 2\.1\.3/m);
    assert.match(r.stdout, /^plan {7}nothing written: `oats sync` would write \S+ with the changes above and the automations snapshot$/m);
    assert.doesNotMatch(r.stdout, /^lock /m);
    assert.deepEqual(tree(dep), before);

    // The bare sync applies exactly what the plan reported.
    r = oats(["sync", "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const applied = envelope(r).result;
    assert.deepEqual(applied.changes, plan.changes);
    assert.deepEqual(applied.packages, plan.packages);
    assert.deepEqual(applied.members, plan.members);
    assert.ok(JSON.parse(readFileSync(lockFile, "utf8")).packages["oats.okf"], "the sync wrote it");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("sync refuses a flag or a positional it does not read, before anything is written", { timeout: 300_000 }, async () => {
  const { base, dep, env } = await northwind();
  try {
    const before = tree(dep);
    for (const [argv, named] of [[["--plna"], "--plna"], [["--force"], "--force"], [["--dir", dep, "extra"], "\"extra\""], [["-n"], "-n"], [["--dir", dep, "--dir", dep], "--dir once"]]) {
      let r = oats(["sync", ...argv, "--json"], { cwd: dep, env, base });
      assert.equal(r.status, 1, `${argv.join(" ")}: ${r.stdout}${r.stderr}`);
      const err = envelope(r).error;
      assert.equal(err.code, "E_BAD_ARGS");
      assert.ok(err.message.includes(named), err.message);
      assert.match(err.message, /usage: oats sync \[--dir <deployment>\] \[--plan\] \[--json\]/);
      r = oats(["sync", ...argv], { cwd: dep, env, base });
      assert.equal(r.status, 1);
      assert.ok(r.stderr.includes(named), r.stderr);
    }
    assert.equal(existsSync(join(dep, "oats-lock.json")), false);
    assert.deepEqual(tree(dep), before, "a refused sync writes nothing");
  } finally { rmSync(base, { recursive: true, force: true }); }
});
