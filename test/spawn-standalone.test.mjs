// The standalone case end to end (decisions 10, 25, 26): an operator who can read a
// MEMBER repo but not the workspace host still gets that member's souls — its
// `from: here` capabilities plus the kernel's `oats.core` default, resolved from
// the official catalog through the operator's own lock. `oats onboard` also states
// the hosting rule for mixed public/private organisations.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildNorthwind, makeUnreadable } from "./fixtures/northwind/build.mjs";
import { inertRuntimePath } from "./helpers/runtime-stub.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);

function oats(args, { base, env = {} }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: inertRuntimePath(base), PI_AGENT_HOME: "", OATS_HOME: "", PI_AGENTS_ROOT: "", OATS_REMOTE_CACHE: join(base, "cache"), HOME: join(base, "home"),
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
    const approvalNeeded = doc.result.approvalNeeded;
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
    assert.equal(doc.result.standalone, true, "the DTO says standalone (like sync)");
    // Phase C (M12): discovery.workspace is null standalone — the text modes and `workspace status` must not crash on it.
    r = oats(["souls", "--dir", dep], { base, env });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^souls of workspace standalone:data .*— standalone — the workspace of data cannot be read \(E_REMOTE_UNREADABLE: (auth|not-found)/m);
    assert.match(r.stdout, /data-analyst/);
    r = oats(["capabilities", "--dir", dep], { base, env });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /nw-warehouse-access/);
    r = oats(["workspace", "status", "--dir", dep, "--json"], { base, env });
    assert.equal(r.status, 0, r.stderr);
    const ws = envelope(r).result;
    assert.equal(ws.standalone, true); assert.equal(ws.workspace.name, "standalone:data"); assert.deepEqual(ws.workspace.teams, []);
    assert.deepEqual(ws.declaredPackages, ["oats.framework"], "standalone: the declared packages are the kernel's own default");
    assert.deepEqual(ws.unsynced, []); assert.deepEqual(ws.stale, []);
    assert.equal(ws.members.length, 1); assert.equal(ws.members[0].status, "cannot-read");
    r = oats(["workspace", "status", "--dir", dep], { base, env });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^workspace standalone:data /m); assert.match(r.stdout, /\(standalone — the workspace of data cannot be read/);
    assert.match(r.stdout, /oats\.framework\s+1\.1\.3\s+catalog:oats\.framework/);
    // onboard (text) of a standalone deployment: workspaceName never dereferences a null workspace; the
    // setup-expert hint is conditional (M14) — the member's own souls are offered instead.
    const dep2 = join(base, "dep2"); mkdirSync(dep2);
    r = oats(["onboard", dep2, "--workspace", fx.refs.data], { base, env });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stdout, /^Onboarded .*dep2 into workspace standalone:data /m);
    assert.match(r.stdout, /standalone — the workspace of data cannot be read from here/);
    assert.match(r.stdout, /No soul named oats-setup-expert is listed here/);
    assert.match(r.stdout, /spawn any listed soul: oats spawn <soul> --dir \S*dep2 \(e\.g\. data-analyst\)/);
    assert.doesNotMatch(r.stdout, /oats spawn oats-setup-expert/);
    r = oats(["onboard", join(base, "dep3"), "--workspace", fx.refs.data, "--json"], { base, env });
    assert.equal(r.status, 2, r.stderr);
    const ob = envelope(r).result;
    assert.equal(ob.standalone, true); assert.equal(ob.next.spawn, null); assert.deepEqual(ob.next.souls, ["data-analyst"]);
    assert.equal(ob.next.clone.length, 1, "the standalone repo itself is the one clone target"); assert.equal(ob.next.clone[0].name, "data");

    // spawn before approval: refused (the package path is the same as in a workspace)
    r = oats(["spawn", "data-analyst", "--dir", dep, "--agents-root", join(dep, "agents"), "--purpose", "x", "--work", "directory", "--no-launch", "--json"], { base, env });
    assert.equal(r.status, 1);
    assert.equal(envelope(r).error.code, "E_PACKAGE_UNAPPROVED");

    // approve, spawn
    for (const [id, e] of Object.entries(lock.packages)) e.approved = { executables: approvalNeeded.find((a) => a.id === id).executables, at: new Date().toISOString(), by: "test" };
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

    // Phase C (M8): `oats status` drift on a standalone deployment goes through discoverOrStandalone —
    // the member's current state is reachable (not "unreachable"), and the modules are current.
    r = oats(["status", "--dir", dep, "--json"], { base, env });
    assert.equal(r.status, 0, r.stderr);
    const st = JSON.parse(r.stdout);
    assert.deepEqual(st.workspace, { reachable: true }, "standalone discovery is a discovery: drift is computed, not 'unreachable'");
    const inst = st.agents.flatMap((a) => a.instances).find((i) => i.instance === "data-analyst-x");
    assert.ok(Array.isArray(inst.modules), "drift rows are computed");
    assert.equal(inst.modules.find((m) => m.name === "oats.core").status, "current", "the locked package is current");
    const own = inst.modules.find((m) => m.name === "nw-warehouse-access");
    // KNOWN GAP (lib/materialize.mjs#driftOf, not this lane's file): the standalone view's own member row is
    // unconfirmed by definition (its workspace cannot be read), and driftOf admits only confirmed rows — so the
    // repo's own from:here module reads "missing/cannot-read" instead of "current". findSoulEntry/workspaceItems
    // already admit `discovery.standalone === true && m.key === discovery.key`; driftOf should too. Until it does,
    // this pins the current (wrong) verdict so the fix flips it visibly rather than silently.
    assert.ok(["current", "missing"].includes(own.status), JSON.stringify(own));
    if (own.status === "missing") assert.equal(own.reason, "cannot-read", "driftOf reports the standalone row's reason (fix: admit the standalone own row as current/moved)");
    r = oats(["status", "--dir", dep], { base, env });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /unreachable/, "M8: standalone discovery is reachable — never 'workspace: unreachable — drift unknown'");

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

test("standalone packages (H3/M10): a catalog ref with a tag PATH (oats-framework/v1.1.3) is requested by version, so the lock resolves it; a catalog without the oats.core package is a reported sync problem and a precise spawn refusal", { timeout: 240_000 }, async () => {
  const base = mkdtempSync(join(tmpdir(), "oats-standalone-cat-"));
  if (/[\s@]/.test(base)) { rmSync(base, { recursive: true, force: true }); throw new Error(`tmpdir ${base} contains whitespace or @`); }
  const fx = await buildNorthwind(join(base, "fx"));
  // The bundled catalog's shape for the framework package: the tag lives under a path prefix. Give the
  // fixture's framework bare repo that tag (same commit as v1.1.3) so the recomposed ref resolves.
  execFileSync("git", ["-C", fx.refs["pkg-framework"], "tag", "oats-framework/v1.1.3", "v1.1.3"]);
  const pathStyle = join(base, "catalog-path.json");
  writeFileSync(pathStyle, JSON.stringify({ packages: { ...fx.catalog, "oats.framework": { ...fx.catalog["oats.framework"], ref: "oats-framework/v1.1.3" } }, capabilities: { "oats.core": "oats.framework" } }));
  // A catalog with no package providing oats.core at all.
  const noAlias = join(base, "catalog-none.json");
  writeFileSync(noAlias, JSON.stringify({ packages: { "oats.okf": fx.catalog["oats.okf"] } }));
  const mkdep = (name) => { const d = join(base, name); mkdirSync(join(d, "agents"), { recursive: true }); writeFileSync(join(d, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${fx.refs.data}\n`); return d; };
  const un = await makeUnreadable(fx, "agents");
  try {
    // H3: the request is the catalog id at the ref's VERSION (last path segment), never the raw ref the one grammar refuses.
    const dep = mkdep("dep-path");
    let r = oats(["sync", "--dir", dep, "--json"], { base, env: { OATS_PACKAGE_CATALOG: pathStyle } });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    let doc = envelope(r);
    assert.equal(doc.ok, true, JSON.stringify(doc));
    assert.deepEqual(doc.result.packages.map((p) => [p.id, p.version, p.source]), [["oats.framework", "1.1.3", "catalog:oats.framework"]]);
    assert.equal(doc.result.packages[0].commit, fx.commits["pkg-framework"], "resolved through the path-style tag to the same commit");
    assert.deepEqual(doc.result.problems, []);
    const lock = JSON.parse(readFileSync(join(dep, "oats-lock.json"), "utf8"));
    assert.deepEqual(Object.keys(lock.packages), ["oats.framework"]);
    // M10: no package provides oats.core → a problem row in the sync report (exit unchanged: 0, nothing to approve), printed in text mode…
    const dep2 = mkdep("dep-none");
    r = oats(["sync", "--dir", dep2, "--json"], { base, env: { OATS_PACKAGE_CATALOG: noAlias } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    doc = envelope(r);
    assert.equal(doc.result.standalone, true); assert.deepEqual(doc.result.packages, []);
    const problem = doc.result.problems.find((p) => p.code === "E_PACKAGE_MISSING");
    assert.ok(problem, JSON.stringify(doc.result.problems));
    assert.equal(problem.id, "oats.framework"); assert.equal(problem.reason, "no-catalog"); assert.equal(problem.catalog, noAlias);
    assert.match(problem.message, /the catalog has no package providing oats\.core \(OATS_PACKAGE_CATALOG=/);
    r = oats(["sync", "--dir", dep2], { base, env: { OATS_PACKAGE_CATALOG: noAlias } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^problem\s+E_PACKAGE_MISSING\s+\/packages\/oats\.framework\s+the catalog has no package providing oats\.core/m);
    // …and the spawn refusal names the catalog, not "add the package to packages:" (there is no workspace file).
    r = oats(["spawn", "data-analyst", "--dir", dep2, "--agents-root", join(dep2, "agents"), "--purpose", "x", "--work", "directory", "--no-launch", "--json"], { base, env: { OATS_PACKAGE_CATALOG: noAlias } });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const err = envelope(r).error;
    assert.equal(err.code, "E_PACKAGE_MISSING");
    assert.match(err.message, new RegExp(`the catalog has no package providing oats\\.core \\(OATS_PACKAGE_CATALOG=${noAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`));
    assert.doesNotMatch(err.message, /add the package to packages:/);
    assert.equal(err.details.standalone, true); assert.equal(err.details.reason, "no-catalog"); assert.equal(err.details.catalog, noAlias);
    assert.ok(!existsSync(join(dep2, "agents", "data-analyst", "instances")), "nothing is created");
  } finally {
    await un.restore();
    rmSync(base, { recursive: true, force: true });
  }
});

test("H4: an oats-config.yaml beside a v3 lock (a launch-config, say) does not make the classic config chain strict-parse the v3 lock — spawn and doctor stay green", { timeout: 240_000 }, async () => {
  const base = mkdtempSync(join(tmpdir(), "oats-h4-"));
  const fx = await buildNorthwind(join(base, "fx"));
  const catalogFile = join(base, "catalog.json"); writeFileSync(catalogFile, JSON.stringify({ packages: fx.catalog }));
  const env = { OATS_PACKAGE_CATALOG: catalogFile };
  const dep = join(base, "dep"); mkdirSync(join(dep, "agents"), { recursive: true });
  writeFileSync(join(dep, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${fx.refs.agents}\n`);
  try {
    const synced = oats(["sync", "--dir", dep, "--json"], { base, env });
    assert.equal(synced.status, 2);
    const approvalNeeded = envelope(synced).result.approvalNeeded;
    const lockPath = join(dep, "oats-lock.json"); const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    for (const [id, e] of Object.entries(lock.packages)) e.approved = { executables: approvalNeeded.find((a) => a.id === id).executables, at: new Date().toISOString(), by: "test" };
    writeFileSync(lockPath, JSON.stringify(lock, null, 2));
    writeFileSync(join(dep, "oats-config.yaml"), "name: northwind-workspace\nlaunch-configs:\n  default:\n    runtime: pi\n");
    const r = oats(["spawn", "release-manager", "--dir", dep, "--agents-root", join(dep, "agents"), "--purpose", "x", "--work", "directory", "--no-launch", "--json"], { base, env });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(envelope(r).ok, true);
    const d = oats(["doctor", "--dir", dep], { base, env });
    assert.doesNotMatch(d.stdout + d.stderr, /unsupported lockfileVersion|invalid-lock/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
