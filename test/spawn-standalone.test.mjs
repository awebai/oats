// The standalone case end to end (decisions 10, 25, 26): an operator who can read a
// MEMBER repo but not the workspace host still gets that member's souls — its
// `from: here` capabilities plus the kernel's `oats.core` default, resolved from
// the official catalog through the operator's own lock. `oats onboard` also states
// the hosting rule for mixed public/private organisations.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildNorthwind, makeUnreadable } from "./fixtures/northwind/build.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);

function oats(args, { base, env = {} }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PI_AGENT_HOME: "", OATS_HOME: "", PI_AGENTS_ROOT: "", OATS_REMOTE_CACHE: join(base, "cache"), HOME: join(base, "home"),
      OATS_TMUX_SESSION: `none-${process.pid}`, PI_AGENTS_TMUX_SESSION: `none-${process.pid}`, ...env },
  });
}
const envelope = (r) => { const doc = JSON.parse(r.stdout.trim().split("\n").pop()); assert.equal(doc.schemaVersion, 1); return doc; };

test("standalone: unreadable workspace host → sync locks only the oats.core package; souls lists the member's own; spawn materializes from:here + oats.core", { timeout: 240_000 }, async () => {
  const base = mkdtempSync(join(tmpdir(), "oats-standalone-"));
  if (/[\s@]/.test(base)) { rmSync(base, { recursive: true, force: true }); throw new Error(`tmpdir ${base} contains whitespace or @`); }
  const fx = await buildNorthwind(join(base, "fx"));
  const catalogFile = join(base, "catalog.json");
  writeFileSync(catalogFile, JSON.stringify({ packages: fx.catalog, capabilities: { "oats.core": "oats.framework" } }));
  const env = { OATS_PACKAGE_CATALOG: catalogFile };
  const dep = join(base, "dep"); mkdirSync(join(dep, "agents"), { recursive: true });
  // oats-local.yaml points at the MEMBER (data) — the operator has no access to the host.
  writeFileSync(join(dep, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${fx.refs.data}\n`);
  const un = await makeUnreadable(fx, "agents");
  try {
    // sync: standalone view, one package request (the catalog's oats.framework pin)
    let r = oats(["sync", "--dir", dep, "--json"], { base, env });
    assert.equal(r.status, 2, r.stderr);
    let doc = envelope(r);
    assert.equal(doc.ok, true);
    assert.equal(doc.result.standalone, true);
    assert.equal(doc.result.workspace.name, "standalone:data");
    const lockPath = join(dep, "oats-lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    assert.equal(lock.lockfileVersion, 3);
    assert.deepEqual(Object.keys(lock.packages), ["oats.framework"], "no workspace file → no version list; only the kernel's own default is requested");
    assert.equal(lock.packages["oats.framework"].approved, null);

    // souls: the standalone member's own rows are listed (its row is unconfirmed by definition)
    r = oats(["souls", "--dir", dep, "--json"], { base, env });
    assert.equal(r.status, 0, r.stderr);
    doc = envelope(r);
    assert.ok(doc.result.souls.some((s) => s.name === "data-analyst"), JSON.stringify(doc.result.souls));

    // spawn before approval: refused (the package path is the same as in a workspace)
    r = oats(["spawn", "data-analyst", "--dir", dep, "--agents-root", join(dep, "agents"), "--purpose", "x", "--work", "directory", "--no-launch", "--json"], { base, env });
    assert.equal(r.status, 1);
    assert.equal(envelope(r).error.code, "E_PACKAGE_UNAPPROVED");

    // approve, spawn
    for (const e of Object.values(lock.packages)) e.approved = { executables: "sha256-" + "0".repeat(64), at: new Date().toISOString(), by: "test" };
    writeFileSync(lockPath, JSON.stringify(lock, null, 2));
    r = oats(["spawn", "data-analyst", "--dir", dep, "--agents-root", join(dep, "agents"), "--purpose", "x", "--work", "directory", "--no-launch", "--json"], { base, env });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    doc = envelope(r);
    const home = doc.result.home;
    const meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
    assert.deepEqual(Object.keys(meta.modules).sort(), ["nw-warehouse-access", "oats.core"]);
    assert.equal(meta.modules["nw-warehouse-access"].from.kind, "member");
    assert.equal(meta.modules["oats.core"].from.kind, "package");
    assert.ok(existsSync(join(home, ".oats", "modules", "oats.core", "oats.json")));
    assert.ok(existsSync(join(home, ".agents", "skills", "oats.core")));
    assert.ok(readdirSync(join(home, ".agents", "skills", "nw-warehouse-access")).length > 0);
    const agentsMd = readFileSync(join(home, "AGENTS.md"), "utf8");
    assert.ok(agentsMd.includes("<!-- oats:capability:oats.core"), "oats.core inject composed");
    assert.ok(!doc.result.command?.includes("--no-skills"));

    // `oats.core: off` in the soul is respected — exercised at the resolver level (test/resolve.test.mjs);
    // here: --provider for a capability outside the standalone set is refused.
    r = oats(["spawn", "data-analyst", "--dir", dep, "--agents-root", join(dep, "agents"), "--purpose", "y", "--work", "directory", "--no-launch", "--provider", "oats.okf", "a=b", "--json"], { base, env });
    assert.equal(r.status, 1);
    assert.equal(envelope(r).error.code, "E_CAPABILITY_MISSING");
  } finally {
    await un.restore();
    rmSync(base, { recursive: true, force: true });
  }
});

test("onboard states the hosting rule (decision 26): hostIsMember + the rule in --json; the text next-steps carry it", { timeout: 240_000 }, async () => {
  const base = mkdtempSync(join(tmpdir(), "oats-onboard-host-"));
  const fx = await buildNorthwind(join(base, "fx"));
  const catalogFile = join(base, "catalog.json");
  writeFileSync(catalogFile, JSON.stringify({ packages: fx.catalog }));
  const env = { OATS_PACKAGE_CATALOG: catalogFile };
  const dep = join(base, "dep"); mkdirSync(dep);
  try {
    let r = oats(["onboard", dep, "--workspace", fx.refs.agents, "--json"], { base, env });
    assert.equal(r.status, 2, r.stderr);
    const doc = envelope(r);
    assert.equal(doc.result.hosting.hostIsMember, true, "Northwind's host (agents) is itself a member");
    assert.match(doc.result.hosting.rule, /private repo that is not a public member/);
    rmSync(join(dep, "oats-local.yaml")); rmSync(join(dep, "oats-lock.json"), { force: true });
    r = oats(["onboard", dep, "--workspace", fx.refs.agents], { base, env });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stdout, /is itself a member/);
    assert.match(r.stdout, /if any member is private the host must be a private repo/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
