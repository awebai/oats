// bin/oats.mjs — workspace model v2 CLI cutover (module contract §6).
//
// Runs the REAL CLI as a child process over the Northwind fixture (real bare Git
// remotes, real lib/remote.mjs): `oats sync`, `oats workspace status`,
// `oats capabilities` / `oats souls`, `oats package add|remove`, and the removed
// 0.24 verbs (`install`, `use`, `init`, …) which must now be unknown commands.
// Never invokes bare `oats setup`; never touches ~/.cache (OATS_REMOTE_CACHE).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildNorthwind } from "./fixtures/northwind/build.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);

/** A fixture base without whitespace or "@" (repo keys embed it) under the OS temp dir. */
function fixtureBase() {
  const base = mkdtempSync(join(tmpdir(), "oats-cli-ws-"));
  if (/[\s@]/.test(base)) { rmSync(base, { recursive: true, force: true }); throw new Error(`tmpdir ${base} contains whitespace or @`); }
  return base;
}

/** Run the CLI non-interactively: stdin is /dev/null (never a TTY), HOME-side state is isolated. */
function oats(args, { cwd, env = {}, base }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PI_AGENT_HOME: "", OATS_HOME: "", OATS_REMOTE_CACHE: join(base, "cache"), ...env },
  });
}
/** stdout must be exactly one JSON envelope. */
function envelope(r) {
  const doc = JSON.parse(r.stdout);
  assert.equal(r.stdout.trim(), JSON.stringify(doc), "stdout is exactly one compact JSON object");
  assert.equal(doc.schemaVersion, 1);
  return doc;
}

test("workspace v2 CLI over the Northwind fixture: sync (non-TTY → exit 2, lock written unapproved), workspace status, capabilities/souls, package add, removed verbs", { timeout: 300_000 }, async () => {
  const base = fixtureBase();
  try {
    const fx = await buildNorthwind(join(base, "fx"));
    // The catalog the fixture's bare versions resolve through (OATS_PACKAGE_CATALOG points the
    // CLI at it, exactly as the kernel's officialPackageCatalog() already allows).
    const catalogFile = join(base, "catalog.json");
    writeFileSync(catalogFile, JSON.stringify({ packages: fx.catalog }, null, 2));
    const env = { OATS_PACKAGE_CATALOG: catalogFile };
    // The deployment: oats-local.yaml naming the workspace host by its bare-repo path.
    const dep = join(base, "northwind-workspace");
    mkdirSync(dep);
    writeFileSync(join(dep, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${fx.refs.agents}\nsouls:\n  disabled: [data-analyst]\n`);

    // ---- oats sync --json (stdin is not a TTY) ----
    let r = oats(["sync", "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 2, `sync exits 2 when approvals are pending\n${r.stdout}\n${r.stderr}`);
    let doc = envelope(r);
    assert.equal(doc.ok, true);
    const sync = doc.result;
    assert.equal(sync.syncApi, 1);
    assert.equal(sync.workspace.name, "northwind");
    assert.equal(sync.workspace.key, fx.keys.agents);
    assert.equal(sync.workspace.commit, fx.commits.agents);
    assert.deepEqual(Object.keys(sync).sort(), ["approvalNeeded", "changes", "members", "packages", "problems", "syncApi", "workspace"]);
    assert.equal(sync.members.length, 5);
    assert.ok(sync.members.every((m) => m.confirmed && m.status === "confirmed"), JSON.stringify(sync.members.map((m) => [m.name, m.status])));
    assert.deepEqual(sync.members.map((m) => m.name).sort(), ["agents", "data", "marketing", "nw-tools", "platform"]);
    assert.deepEqual(sync.members.find((m) => m.name === "nw-tools").publishes, { package: "nw.tools", version: "0.4.0" });
    assert.deepEqual(sync.packages.map((p) => p.id), ["nw.tools", "oats.framework", "oats.okf"]);
    assert.ok(sync.packages.every((p) => p.approved === null), "nothing is approved without a terminal");
    assert.deepEqual(sync.changes.map((c) => [c.id, c.from, c.to]), [["nw.tools", null, "0.4.0"], ["oats.framework", null, "1.1.3"], ["oats.okf", null, "2.1.3"]]);
    assert.deepEqual(sync.approvalNeeded.map((a) => a.id), ["nw.tools", "oats.framework", "oats.okf"]);
    for (const a of sync.approvalNeeded) { assert.match(a.executables, /^sha256-[0-9a-f]{64}$/); assert.match(a.commit, /^[0-9a-f]{40}$/); }
    assert.ok(sync.approvalNeeded.find((a) => a.id === "nw.tools").targets.length > 0, "nw.tools has bin/ executables to approve");
    assert.deepEqual(sync.problems, []);
    assert.equal(existsSync(join(dep, "oats-lock.json")), true, "the lock is written even when approvals are pending");
    const lock = JSON.parse(readFileSync(join(dep, "oats-lock.json"), "utf8"));
    assert.equal(lock.lockfileVersion, 3);
    assert.deepEqual(Object.keys(lock.packages), ["nw.tools", "oats.framework", "oats.okf"]);
    assert.equal(lock.packages["nw.tools"].approved, null);
    assert.equal(lock.packages["nw.tools"].commit, fx.commits["nw-tools"]);
    assert.equal(lock.packages["nw.tools"].source, `git:${fx.keys["nw-tools"]}@v0.4.0`);
    assert.equal(lock.packages["oats.okf"].commit, fx.commits["pkg-okf"]);
    assert.equal(existsSync(join(base, "cache")), true, "OATS_REMOTE_CACHE is honoured (nothing under ~/.cache from this test)");

    // The human report (§8 shape), still exit 2, still no prompt.
    r = oats(["sync"], { cwd: dep, env, base });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stdout, /^workspace {2}northwind {2}\(/m);
    assert.match(r.stdout, /^members {4}.*agents ✓↔/m);
    assert.match(r.stdout, /^packages {3}.*oats\.okf 2\.1\.3 ✓ \(approval needed\)/m);
    assert.match(r.stdout, /^changed {4}/m);
    assert.match(r.stdout, /^souls {6}9 discovered \(8 members, 1 external, 1 disabled here\) · 1 private \(platform-reviewer, platform only\)/m);
    assert.match(r.stdout, /^teams {6}.*engineering 5 souls, 3 capabilities.*marketing 2 souls, 2 capabilities/m);
    assert.match(r.stdout, /Approval needed for nw\.tools 0\.4\.0, oats\.framework 1\.1\.3, oats\.okf 2\.1\.3 — not a terminal/);
    // A second sync is idempotent: the lock already describes the workspace (nothing changed).
    r = oats(["sync", "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 2);
    assert.deepEqual(envelope(r).result.changes, []);

    // --dir from elsewhere (the flag, not cwd) reaches the deployment.
    r = oats(["sync", "--json", "--dir", dep], { cwd: base, env, base });
    assert.equal(r.status, 2, r.stderr);
    assert.equal(envelope(r).result.workspace.name, "northwind");

    // ---- oats workspace status --json ----
    r = oats(["workspace", "status", "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stderr);
    doc = envelope(r);
    const st = doc.result;
    assert.equal(st.workspaceStatusApi, 1);
    assert.deepEqual(st.workspace.teams, ["global", "engineering", "marketing"]);
    assert.equal(st.members.length, 5);
    const platform = st.members.find((m) => m.name === "platform");
    assert.equal(platform.status, "confirmed"); assert.equal(platform.team, "engineering");
    assert.deepEqual(platform.souls, ["platform-engineer", "platform-reviewer"], "status lists every soul, private ones included (it is the membership view)");
    assert.deepEqual(st.approval, { approved: [], needed: ["nw.tools", "oats.framework", "oats.okf"] });
    assert.deepEqual(st.unsynced, []); assert.deepEqual(st.stale, []);
    assert.deepEqual(st.external.map((e) => e.soul), ["security-reviewer"]);
    r = oats(["workspace", "status"], { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /member\s+status\s+commit\s+team/);
    assert.match(r.stdout, /nw-tools\s+confirmed\s+[0-9a-f]{8}\s+engineering.*nw\.tools v0\.4\.0/);
    assert.match(r.stdout, /oats\.okf\s+2\.1\.3\s+catalog:oats\.okf\s+[0-9a-f]{8}\s+NEEDED\s+oats\.okf/);
    r = oats(["workspace", "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 1); assert.equal(envelope(r).error.code, "E_USAGE");

    // ---- oats capabilities --json ----
    r = oats(["capabilities", "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stderr);
    doc = envelope(r);
    const caps = doc.result.capabilities;
    const brand = caps.find((c) => c.name === "nw-brand-voice");
    assert.ok(brand, "nw-brand-voice is listed");
    assert.equal(brand.kind, "member"); assert.equal(brand.repoKey, fx.keys.marketing); assert.equal(brand.team, "marketing");
    assert.equal(brand.origin, `member ${fx.keys.marketing} @ ${fx.commits.marketing.slice(0, 8)}`);
    const okf = caps.find((c) => c.name === "oats.okf");
    assert.ok(okf, "oats.okf is listed from the lock");
    assert.equal(okf.kind, "package"); assert.equal(okf.package, "oats.okf"); assert.equal(okf.origin, "package oats.okf v2.1.3"); assert.equal(okf.approved, false);
    // Non-collapse: nw-tools-dev is a MEMBER capability; nw-lint / nw-deploy are PACKAGE capabilities.
    assert.equal(caps.find((c) => c.name === "nw-tools-dev").kind, "member");
    assert.equal(caps.find((c) => c.name === "nw-lint").kind, "package");
    assert.equal(caps.find((c) => c.name === "nw-deploy").origin, "package nw.tools v0.4.0");
    assert.ok(caps.every((c) => !c.private), "private capabilities are not listed");
    r = oats(["capabilities"], { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /name\s+origin\s+team\s+layer/);
    assert.match(r.stdout, /nw-brand-voice\s+member .*marketing\.git @ [0-9a-f]{8}\s+marketing/);
    assert.match(r.stdout, /oats\.okf\s+package oats\.okf v2\.1\.3/);

    // ---- oats souls --json ----
    r = oats(["souls", "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stderr);
    doc = envelope(r);
    const souls = doc.result.souls;
    const names = souls.map((s) => s.name);
    assert.ok(names.includes("tools-expert"), "tools-expert (member soul of the package publisher) is visible");
    assert.ok(!names.includes("platform-reviewer"), "platform-reviewer is private: not visible");
    assert.ok(names.includes("platform-engineer"));
    assert.ok(names.includes("security-reviewer"), "the pinned external soul is visible");
    const tools = souls.find((s) => s.name === "tools-expert");
    assert.equal(tools.team, "engineering"); assert.equal(tools.origin, `member ${fx.keys["nw-tools"]} @ ${fx.commits["nw-tools"].slice(0, 8)}`);
    assert.equal(souls.find((s) => s.name === "security-reviewer").kind, "external");
    assert.equal(souls.find((s) => s.name === "support-triager").team, "global", "team falls back to the repo's oats-membership.yaml default");
    r = oats(["souls"], { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /tools-expert\s+member .*nw-tools\.git @ [0-9a-f]{8}\s+engineering\s+worktree/);
    assert.doesNotMatch(r.stdout, /platform-reviewer/);

    // ---- oats package add outside a workspace checkout prints the line ----
    const elsewhere = join(base, "elsewhere"); mkdirSync(elsewhere);
    r = oats(["package", "add", "x", "git:github.com/acme/x@v1", "--dir", elsewhere], { cwd: base, env, base });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /oats-workspace\.yaml is not in this checkout/);
    assert.match(r.stdout, /^packages:\n {2}x: git:github\.com\/acme\/x@v1$/m);
    assert.equal(existsSync(join(elsewhere, "oats-workspace.yaml")), false, "nothing is written outside a checkout");
    r = oats(["package", "add", "x", "git:github.com/acme/x@v1", "--json", "--dir", elsewhere], { cwd: base, env, base });
    assert.equal(r.status, 0, r.stderr);
    doc = envelope(r);
    assert.equal(doc.result.edited, false); assert.equal(doc.result.line, "packages:\n  x: git:github.com/acme/x@v1");
    // Malformed values are refused with the schema code (the one grammar: classifyPackageValue).
    r = oats(["package", "add", "x", "1.2.3/not", "--json", "--dir", elsewhere], { cwd: base, env, base });
    assert.equal(r.status, 1); assert.equal(envelope(r).error.code, "E_WORKSPACE_SCHEMA");
    r = oats(["package", "add", "Bad", "v1", "--json", "--dir", elsewhere], { cwd: base, env, base });
    assert.equal(r.status, 1); assert.equal(envelope(r).error.code, "E_WORKSPACE_SCHEMA");

    // ---- oats package add|remove INSIDE a workspace checkout edits packages: byte-preservingly ----
    const clone = join(base, "agents-clone");
    execFileSync("git", ["clone", "-q", fx.refs.agents, clone]);
    const before = readFileSync(join(clone, "oats-workspace.yaml"), "utf8");
    r = oats(["package", "add", "oats.aweb", "v1.11.2", "--json", "--dir", join(clone, "souls")], { cwd: base, env, base });
    assert.equal(r.status, 0, r.stderr);
    doc = envelope(r);
    assert.equal(doc.result.edited, true); assert.equal(doc.result.file, join(clone, "oats-workspace.yaml")); assert.equal(doc.result.previous, null);
    const after = readFileSync(join(clone, "oats-workspace.yaml"), "utf8");
    assert.equal(after.split("\n").length, before.split("\n").length + 1, "exactly one line added");
    assert.match(after, /^ {2}oats\.aweb: v1\.11\.2$/m);
    assert.ok(after.startsWith(before.slice(0, before.indexOf("packages:"))), "everything before packages: is byte-identical");
    r = oats(["package", "remove", "oats.aweb", "--json", "--dir", clone], { cwd: base, env, base });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(envelope(r).result.previous, "v1.11.2");
    assert.equal(readFileSync(join(clone, "oats-workspace.yaml"), "utf8"), before, "add + remove round-trips to the original bytes");
    r = oats(["package", "remove", "nope", "--json", "--dir", clone], { cwd: base, env, base });
    assert.equal(r.status, 1); assert.equal(envelope(r).error.code, "E_PACKAGE_MISSING");
    // Phase C (M15): the UNTRACKED branch (no workspace checkout, but a deployment with oats-local.yaml)
    // checks the id against the DISCOVERED workspace too — an undeclared id is E_PACKAGE_MISSING in both branches.
    r = oats(["package", "remove", "nope", "--json", "--dir", dep], { cwd: base, env, base });
    assert.equal(r.status, 1, r.stdout + r.stderr); assert.equal(envelope(r).error.code, "E_PACKAGE_MISSING");
    assert.deepEqual(envelope(r).error.details.declared, ["nw.tools", "oats.framework", "oats.okf"]);
    r = oats(["package", "remove", "oats.okf", "--json", "--dir", dep], { cwd: base, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(envelope(r).result.edited, false, "a declared id in the untracked branch still prints the instruction (the file is shared through Git)");
    assert.match(envelope(r).result.hint, /not in this checkout/);
    r = oats(["package", "remove", "nope", "--dir", dep], { cwd: base, env, base });
    assert.equal(r.status, 1); assert.match(r.stderr, /packages\.nope is not declared by workspace northwind/);
    // Without any deployment (no oats-local.yaml, no checkout) nothing can be checked: the instruction is printed.
    r = oats(["package", "remove", "nope", "--json", "--dir", elsewhere], { cwd: base, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(envelope(r).result.edited, false);
    // Phase B (CLI M4): `remove <id> --json` never reports "--json" as the value.
    r = oats(["package", "add", "oats.aweb", "v1.11.2", "--json", "--dir", clone], { cwd: base, env, base });
    r = oats(["package", "remove", "oats.aweb", "--json", "--dir", clone], { cwd: base, env, base });
    assert.equal(r.status, 0, r.stderr); assert.equal(envelope(r).result.value, null);
    // Phase B (CLI M3): an UNTRACKED copy of oats-workspace.yaml inside a checkout is not edited (prints the line).
    mkdirSync(join(clone, "sub"));
    writeFileSync(join(clone, "sub", "oats-workspace.yaml"), before);
    r = oats(["package", "add", "p.z", "v9.9.9", "--json", "--dir", join(clone, "sub")], { cwd: base, env, base });
    assert.equal(r.status, 0, r.stderr); assert.equal(envelope(r).result.edited, false);
    assert.equal(readFileSync(join(clone, "sub", "oats-workspace.yaml"), "utf8"), before, "untracked copy untouched");
    // Phase B (CLI H2): a malformed `packages:` node (scalar / sequence) or a non-mapping root is E_WORKSPACE_SCHEMA in one envelope, never a raw TypeError.
    for (const text of ["schemaVersion: 2\nname: ws3\nmembers: []\npackages: 5\n", "schemaVersion: 2\nname: ws3\nmembers: []\npackages: [a, b]\n", "- a\n- b\n"]) {
      const ws3 = mkdtempSync(join(base, "ws3-"));
      execFileSync("git", ["-C", ws3, "init", "-q"]);
      writeFileSync(join(ws3, "oats-workspace.yaml"), text);
      execFileSync("git", ["-C", ws3, "add", "oats-workspace.yaml"]);
      r = oats(["package", "add", "q.q", "v1.0.0", "--json", "--dir", ws3], { cwd: base, env, base });
      assert.equal(r.status, 1, `${JSON.stringify(text)}: ${r.stdout} ${r.stderr}`);
      assert.equal(envelope(r).error.code, "E_WORKSPACE_SCHEMA", JSON.stringify(text));
      assert.equal(readFileSync(join(ws3, "oats-workspace.yaml"), "utf8"), text, "file untouched");
    }

    // ---- no oats-local.yaml → E_LOCAL_MISSING, one envelope ----
    r = oats(["sync", "--json", "--dir", elsewhere], { cwd: base, env, base });
    assert.equal(r.status, 1); assert.equal(envelope(r).error.code, "E_LOCAL_MISSING");
    r = oats(["capabilities", "--dir", elsewhere], { cwd: base, env, base });
    assert.equal(r.status, 1); assert.match(r.stderr, /no oats-local\.yaml/);

    // ---- doctor reports the lock offline (no remote access) ----
    r = oats(["doctor", dep], { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Workspace \(v2, offline view\):/);
    assert.match(r.stdout, /Locked packages \(oats-lock\.json v3\):/);
    assert.match(r.stdout, /oats\.okf 2\.1\.3 {2}catalog:oats\.okf {2}@ [0-9a-f]{12} {2}APPROVAL NEEDED/);
    // Phase C (M18): a v2 deployment has no config chain / layers / installed tier — the v1 half is not printed.
    for (const v1 of [/Config chain/, /Layers:/, /Layers unresolved/, /Kernel injection:/, /Unconditional injections/, /Acquired capability packages/, /Active capabilities:/, /is in installed\/ but has no lock entry/, /oats-config\.yaml/]) assert.doesNotMatch(r.stdout, v1, `v1 doctor section leaks on a v2 deployment: ${v1}`);
    r = oats(["doctor", dep, "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stderr);
    const dj = JSON.parse(r.stdout);
    assert.equal(dj.workspace.ref, fx.refs.agents); assert.equal(dj.lockFile, join(dep, "oats-lock.json"));
    assert.deepEqual(dj.packages.map((p) => p.id), ["nw.tools", "oats.framework", "oats.okf"]);
    assert.equal(dj.workspaceApi, 2);
    for (const k of ["chain", "layers", "acquired", "injects", "kernelInjection", "capabilities", "retiredLocks", "retiredArtifacts", "oasScopes", "team"]) assert.ok(!(k in dj), `--json omits the v1 key ${k} on a v2 deployment`);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("removed 0.24 verbs are unknown commands: install / use / init / trust / list / catalog / remove / migrate / inject exit nonzero and name the v2 replacement", () => {
  const base = fixtureBase();
  try {
    for (const verb of ["install", "use", "init", "trust", "list", "catalog", "remove", "migrate", "config", "inject"]) {
      let r = oats([verb], { cwd: base, base });
      assert.notEqual(r.status, 0, `${verb} must fail`);
      assert.match(r.stderr, new RegExp(`unknown command "${verb}" — removed by the workspace model v2`), `${verb}: ${r.stderr}`);
      r = oats([verb, "--json"], { cwd: base, base });
      assert.equal(r.status, 1, `${verb} --json`);
      const doc = envelope(r);
      assert.equal(doc.ok, false); assert.equal(doc.error.code, "E_UNKNOWN_COMMAND");
      assert.match(doc.error.message, new RegExp(`unknown command "${verb}" — removed by the workspace model v2; use `), `${verb} --json carries the replacement`);
      assert.equal(doc.error.details?.removed ?? doc.error.removed, verb);
    }
    // Phase C (M17): `oats inject eject <cap>` (wrote oats-config.yaml injection-override) is gone with the v1 config surface.
    const inj = oats(["inject", "eject", "oats", "--json"], { cwd: base, base });
    assert.equal(inj.status, 1); assert.equal(envelope(inj).error.code, "E_UNKNOWN_COMMAND");
    assert.match(envelope(inj).error.details.replacement, /injection overrides are not part of the workspace model yet/);
    assert.doesNotMatch(oats(["--help"], { cwd: base, base }).stdout, /oats inject/, "usage no longer lists inject");
    // `oats install` with what used to be a source argument is equally gone.
    const r = oats(["install", "oats.okf", "--json"], { cwd: base, base });
    assert.equal(r.status, 1); assert.equal(envelope(r).error.code, "E_UNKNOWN_COMMAND");
    // `oats update <package>` is refused (the kernel self-update stays: `oats update --check` is not exercised here — it goes to npm).
    const u = oats(["update", "oats.okf", "--json"], { cwd: base, base });
    assert.equal(u.status, 1); assert.equal(envelope(u).error.code, "E_BAD_ARGS");
    // The new verbs are kernel commands: --help prints their usage without touching the remotes.
    for (const verb of ["sync", "package", "workspace", "capabilities", "souls"]) {
      const h = oats([verb, "--help"], { cwd: base, base });
      assert.equal(h.status, 0, `${verb} --help`);
      assert.match(h.stdout, new RegExp(`^Usage:\\n {2}oats ${verb}`), `${verb} --help: ${h.stdout.slice(0, 120)}`);
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("oats version --json advertises workspaceApi 2 and only the wired v2 features", () => {
  const base = fixtureBase();
  try {
    const r = oats(["version", "--json"], { cwd: base, base });
    assert.equal(r.status, 0);
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.workspaceApi, 2);
    assert.ok(doc.features.includes("workspace-v2"));
    // Phase C: spawn runs on resolve/materialize, so both features are now advertised (a feature is listed only once wired).
    for (const f of ["instance-modules", "spawn-provider-payload"]) assert.ok(doc.features.includes(f), `${f} is wired in Phase C`);
    assert.ok(!doc.features.includes("catalog"), "the `catalog` verb is removed, so the feature is no longer advertised");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("Phase B (CLI M5): `oats status --json` on a v2 deployment without agents/ is one E_NO_DEPLOYMENT envelope, never a raw stack", () => {
  const base = fixtureBase();
  try {
    const dep = join(base, "dep");
    mkdirSync(dep);
    writeFileSync(join(dep, "oats-local.yaml"), "schemaVersion: 2\nworkspace: git:github.com/northwind/agents\n");
    let r = oats(["status", "--json"], { cwd: dep, base, env: { PI_AGENTS_ROOT: "" } });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const doc = envelope(r);
    assert.equal(doc.error.code, "E_NO_DEPLOYMENT");
    assert.doesNotMatch(doc.error.message, /oats-config\.yaml/, "does not name the removed file");
    assert.doesNotMatch(r.stderr, /at .*core\.mjs/, "no stack trace");
    r = oats(["status"], { cwd: dep, base, env: { PI_AGENTS_ROOT: "" } });
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stderr, /\n\s+at /, "no stack trace in text mode");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// ---- lane 3 (0.25.2) ----
// R9: `oats sync --approve <id>@<version>` approves exactly that locked entry without a terminal,
// recording the digest computed over the locked tree (never anything typed); an id@version that
// is not in the resolution is E_BAD_ARGS and writes nothing. Ctrl+D at the TTY prompt is covered
// by askYesNo's abort handling (a real pty is needed to exercise it; see the 0.25.2 notes).
test("0.25.2 R9: sync --approve <id>@<version> approves what is there with the real digest (exit 0 when nothing else is pending); wrong version / unknown id → E_BAD_ARGS, lock untouched", { timeout: 300_000 }, async () => {
  const base = fixtureBase();
  try {
    const fx = await buildNorthwind(join(base, "fx"));
    mkdirSync(join(base, "home"));
    const catalogFile = join(base, "catalog.json");
    writeFileSync(catalogFile, JSON.stringify({ packages: fx.catalog }, null, 2));
    const env = { OATS_PACKAGE_CATALOG: catalogFile, HOME: join(base, "home") };
    const dep = join(base, "dep");
    mkdirSync(join(dep, "agents"), { recursive: true });
    writeFileSync(join(dep, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${fx.refs.agents}\n`);
    const lockFile = join(dep, "oats-lock.json");

    // Baseline: the real digests a non-TTY sync reports.
    let r = oats(["sync", "--dir", dep, "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    const need = envelope(r).result.approvalNeeded;
    const digestOf = (id) => need.find((a) => a.id === id).executables;
    assert.match(digestOf("nw.tools"), /^sha256-[0-9a-f]{64}$/);

    // Wrong version → E_BAD_ARGS naming the locked version; nothing approved.
    r = oats(["sync", "--dir", dep, "--approve", "nw.tools@0.9.9", "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    let err = envelope(r).error;
    assert.equal(err.code, "E_BAD_ARGS");
    assert.match(err.message, /approve what is there: --approve nw\.tools@0\.4\.0/);
    assert.deepEqual({ id: err.details.id, version: err.details.version, locked: err.details.locked }, { id: "nw.tools", version: "0.9.9", locked: "0.4.0" });
    assert.ok(Object.values(JSON.parse(readFileSync(lockFile, "utf8")).packages).every((p) => p.approved === null), "a refused --approve writes no approval");
    // Unknown id → E_BAD_ARGS listing what IS locked.
    r = oats(["sync", "--dir", dep, "--approve", "nope@1.0.0", "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 1); err = envelope(r).error;
    assert.equal(err.code, "E_BAD_ARGS"); assert.deepEqual(err.details.locked, ["nw.tools", "oats.framework", "oats.okf"]);
    // Malformed → E_BAD_ARGS.
    r = oats(["sync", "--dir", dep, "--approve", "nw.tools", "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 1); assert.equal(envelope(r).error.code, "E_BAD_ARGS");
    r = oats(["sync", "--dir", dep, "--approve", "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 1); assert.equal(envelope(r).error.code, "E_BAD_ARGS");

    // Two of three, repeatable, non-interactive: approved with the REAL digest; exit 2 (one still pending).
    r = oats(["sync", "--dir", dep, "--approve", "nw.tools@0.4.0", "--approve", "oats.okf@2.1.3", "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    let res = envelope(r).result;
    assert.deepEqual(res.approved.map((a) => a.id).sort(), ["nw.tools", "oats.okf"]);
    assert.deepEqual(res.approvalNeeded.map((a) => a.id), ["oats.framework"]);
    let lock = JSON.parse(readFileSync(lockFile, "utf8"));
    assert.equal(lock.packages["nw.tools"].approved.executables, digestOf("nw.tools"), "the digest is the tree's, computed by sync");
    assert.equal(lock.packages["oats.okf"].approved.executables, digestOf("oats.okf"));
    assert.match(lock.packages["nw.tools"].approved.at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(lock.packages["oats.framework"].approved, null);
    // Text mode reports the approval line.
    r = oats(["sync", "--dir", dep, "--approve", "oats.framework@1.1.3"], { cwd: dep, env, base });
    assert.equal(r.status, 0, `nothing else pending → exit 0\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /^approved {3}oats\.framework 1\.1\.3 @ [0-9a-f]{8} {2}\(--approve; /m);
    assert.match(r.stdout, /^lock {7}/m);
    lock = JSON.parse(readFileSync(lockFile, "utf8"));
    assert.equal(lock.packages["oats.framework"].approved.executables, digestOf("oats.framework"));
    // Re-approving an approved entry is a no-op (exit 0, no approved[] in the report).
    r = oats(["sync", "--dir", dep, "--approve", "oats.framework@1.1.3", "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 0); res = envelope(r).result;
    assert.ok(!Object.hasOwn(res, "approved")); assert.deepEqual(res.approvalNeeded, []);
    // The flag is documented.
    r = oats(["help"], { cwd: dep, env, base });
    assert.match(r.stdout + r.stderr, /--approve <id>@<version>/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
