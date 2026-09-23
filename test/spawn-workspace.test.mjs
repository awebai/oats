// bin/oats.mjs — the live workspace-model spawn chain as a test (module contract §5/§6,
// decisions 7, 13, 14, 17).
//
// Runs the REAL CLI as a child process over the Northwind fixture (real bare Git remotes,
// real lib/remote.mjs): `oats sync` → approve (by editing the lock, what a TTY sync would
// record) → `oats spawn <workspace soul> --no-launch --provider …` → the home on disk →
// `spawn --preview` (changedSince) → a member move → `oats status` drift → refusals.
// Never invokes bare `oats setup`; never touches ~/.cache (OATS_REMOTE_CACHE) or the
// operator's HOME; never creates a tmux session (--no-launch + a non-existent session name).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildNorthwind, moveMember, dropBacklink } from "./fixtures/northwind/build.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const HEX40 = /^[0-9a-f]{40}$/;

/** A fixture base without whitespace or "@" (repo keys embed it) under the OS temp dir. */
function fixtureBase() {
  const base = mkdtempSync(join(tmpdir(), "oats-spawn-ws-"));
  if (/[\s@]/.test(base)) { rmSync(base, { recursive: true, force: true }); throw new Error(`tmpdir ${base} contains whitespace or @`); }
  return base;
}

/** Run the CLI non-interactively: stdin is /dev/null (never a TTY); HOME, cache and catalog are isolated. */
function oats(args, { cwd, env = {}, base }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env, PI_AGENT_HOME: "", OATS_HOME: "", PI_AGENTS_ROOT: "",
      OATS_REMOTE_CACHE: join(base, "cache"), HOME: join(base, "home"),
      // Never a real tmux session: --no-launch everywhere, and liveness lookups hit a session that does not exist.
      OATS_TMUX_SESSION: `none-${process.pid}`, PI_AGENTS_TMUX_SESSION: `none-${process.pid}`,
      ...env,
    },
  });
}
/** stdout must be exactly one JSON envelope. */
function envelope(r) {
  const doc = JSON.parse(r.stdout);
  assert.equal(r.stdout.trim(), JSON.stringify(doc), "stdout is exactly one compact JSON object");
  assert.equal(doc.schemaVersion, 1);
  return doc;
}
const isDir = (p) => existsSync(p) && statSync(p).isDirectory() && !lstatSync(p).isSymbolicLink();
const isRegular = (p) => existsSync(p) && lstatSync(p).isFile();
const isRelativeLink = (p) => lstatSync(p).isSymbolicLink() && !readlinkSync(p).startsWith("/");

test("workspace spawn chain over Northwind: sync → approve → spawn materializes whole modules, composes AGENTS.md, records provenance/providers; preview changedSince; status drift; refusals", { timeout: 600_000 }, async () => {
  const base = fixtureBase();
  try {
    const fx = await buildNorthwind(join(base, "fx"));
    const catalogFile = join(base, "catalog.json");
    writeFileSync(catalogFile, JSON.stringify({ packages: fx.catalog }, null, 2));
    const env = { OATS_PACKAGE_CATALOG: catalogFile };
    mkdirSync(join(base, "home"));
    // The deployment: <name>-workspace/ with oats-local.yaml naming the workspace host by its bare-repo path.
    const dep = join(base, "northwind-workspace");
    const agentsRoot = join(dep, "agents");
    mkdirSync(agentsRoot, { recursive: true });
    writeFileSync(join(dep, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${fx.refs.agents}\n`);
    const spawnArgs = (soul, ...extra) => ["spawn", soul, "--dir", dep, "--agents-root", agentsRoot, "--purpose", "x", "--work", "directory", "--no-launch", ...extra, "--json"];

    // ---- sync (non-TTY → exit 2, lock written, nothing approved) ----
    let r = oats(["sync", "--dir", dep, "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 2, `sync exits 2 with approvals pending\n${r.stdout}\n${r.stderr}`);
    assert.equal(envelope(r).ok, true);
    const lockFile = join(dep, "oats-lock.json");
    assert.ok(existsSync(lockFile), "the lock is written");
    const lock = JSON.parse(readFileSync(lockFile, "utf8"));
    assert.equal(lock.lockfileVersion, 3);
    assert.deepEqual(Object.keys(lock.packages), ["nw.tools", "oats.framework", "oats.okf"]);
    assert.ok(Object.values(lock.packages).every((p) => p.approved === null), "no approval without a terminal");

    // ---- an unapproved package refuses the spawn (nothing created) ----
    r = oats(spawnArgs("release-manager"), { cwd: dep, env, base });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(envelope(r).error.code, "E_PACKAGE_UNAPPROVED");
    assert.ok(!existsSync(join(agentsRoot, "release-manager", "instances", "release-manager-x")), "a refused spawn leaves no home");

    // ---- approve by editing the lock (what `sync` on a TTY records) ----
    for (const p of Object.values(lock.packages)) p.approved = { executables: "sha256-" + "0".repeat(64), at: "2026-09-23T00:00:00.000Z" };
    writeFileSync(lockFile, JSON.stringify(lock, null, 2) + "\n");

    // ---- spawn release-manager with an instance-level provider payload ----
    r = oats(spawnArgs("release-manager", "--provider", "oats.okf", "state-dir=/tmp/x"), { cwd: dep, env, base });
    assert.equal(r.status, 0, `spawn\n${r.stdout}\n${r.stderr}`);
    let doc = envelope(r);
    assert.equal(doc.ok, true);
    const spawned = doc.result;
    assert.equal(spawned.instance, "release-manager-x");
    assert.equal(spawned.launched, false);
    assert.match(r.stderr, /workspace soul: "release-manager" from .*agents\.git @ [0-9a-f]{12}, team engineering/, "progress goes to stderr");
    const home = spawned.home;
    assert.equal(home, join(agentsRoot, "release-manager", "instances", "release-manager-x"));

    // The home on disk: every module copied WHOLE under .oats/modules/<name>/ (decision 7).
    const modulesDir = join(home, ".oats", "modules");
    const expectedModules = ["nw-deploy", "nw-house-style", "nw-release-tooling", "oats.core", "oats.okf"];
    for (const m of expectedModules) {
      assert.ok(isDir(join(modulesDir, m)), `${m} is a real directory under .oats/modules`);
      assert.ok(isRegular(join(modulesDir, m, "oats.json")), `${m}/oats.json travels with the copy`);
    }
    const deployBin = join(modulesDir, "nw-deploy", "bin", "nw-deploy.mjs");
    assert.ok(isRegular(deployBin), "the package executable is copied");
    assert.equal(statSync(deployBin).mode & 0o777, 0o755, "git mode 755 is preserved on the executable");
    assert.ok(isRegular(join(modulesDir, "nw-release-tooling", "bin", "nw-release.mjs")));
    assert.ok(isRegular(join(modulesDir, "nw-release-tooling", "injects", "release-policy.md")));
    assert.ok(isRegular(join(modulesDir, "nw-house-style", "injects", "house-style.md")));
    // Skills are copied (not symlinked) to where the harness already looks (decision 13).
    for (const [cap, skill] of [["nw-deploy", "deploy"], ["nw-release-tooling", "cut-release"], ["oats.core", "oats-operate"], ["oats.okf", "okf"]]) {
      const f = join(home, ".agents", "skills", cap, skill, "SKILL.md");
      assert.ok(isRegular(f), `.agents/skills/${cap}/${skill}/SKILL.md is a regular file`);
      assert.ok(!lstatSync(join(home, ".agents", "skills", cap)).isSymbolicLink(), `.agents/skills/${cap} is not a symlink`);
    }
    // Composed instructions: soul AGENTS.md + each module's inject, markers in module order (nw-deploy has no inject).
    const agentsMd = readFileSync(join(home, "AGENTS.md"), "utf8");
    const markers = agentsMd.match(/<!-- oats:capability:[^ ]+/g) || [];
    assert.deepEqual(markers, ["<!-- oats:capability:nw-house-style", "<!-- oats:capability:nw-release-tooling", "<!-- oats:capability:oats.core", "<!-- oats:capability:oats.okf"]);
    // Canonical-plus-alias construction (relative symlinks).
    assert.ok(isRelativeLink(join(home, "CLAUDE.md")), "CLAUDE.md is a relative symlink");
    assert.equal(readlinkSync(join(home, "CLAUDE.md")), "AGENTS.md");
    assert.ok(isRelativeLink(join(home, ".claude", "skills")), ".claude/skills is a relative symlink");
    assert.equal(readlinkSync(join(home, ".claude", "skills")), join("..", ".agents", "skills"));

    // instance.json records provenance (from/commit/digest), providers and the resolution revision.
    const meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
    assert.deepEqual(Object.keys(meta.modules).sort(), expectedModules);
    for (const [name, rec] of Object.entries(meta.modules)) {
      assert.ok(["member", "package"].includes(rec.from.kind), `${name}: from.kind`);
      assert.match(rec.commit, HEX40, `${name}: commit is a full OID`);
      assert.match(rec.from.commit, HEX40, `${name}: from.commit is a full OID`);
      assert.match(rec.digest, /^sha256-[0-9a-f]{64}$/, `${name}: digest`);
    }
    assert.equal(meta.modules["nw-deploy"].from.kind, "package"); assert.equal(meta.modules["nw-deploy"].from.package, "nw.tools"); assert.equal(meta.modules["nw-deploy"].from.version, "0.4.0");
    assert.equal(meta.modules["nw-deploy"].commit, fx.commits["nw-tools"], "non-collapse: nw-deploy comes from the nw.tools package at the locked tag");
    assert.equal(meta.modules["oats.okf"].from.kind, "package"); assert.equal(meta.modules["oats.okf"].commit, fx.commits["pkg-okf"]);
    assert.equal(meta.modules["nw-house-style"].from.kind, "member"); assert.equal(meta.modules["nw-house-style"].from.repoKey, fx.keys.agents); assert.equal(meta.modules["nw-house-style"].commit, fx.commits.agents);
    assert.equal(meta.modules["nw-release-tooling"].from.kind, "member"); assert.equal(meta.modules["nw-release-tooling"].from.repoKey, fx.keys.agents);
    assert.equal(meta.providers["oats.okf"]["state-dir"], "/tmp/x", "the --provider payload is recorded under providers.<cap>");
    assert.equal(meta.providers["oats.okf"].owns, "release-manager", "…merged over the soul's own payload");
    assert.match(meta.workspace.resolution, /^[0-9a-f]{24}$/, "the resolution revision is recorded");
    assert.equal(meta.workspace.soul.repoKey, fx.keys.agents); assert.equal(meta.workspace.soul.team, "engineering");
    // Harness starts normally: no ambient-skill exclusion anywhere in the launch.
    const launchText = `${meta.command || ""} ${JSON.stringify(meta.launch || {})} ${JSON.stringify(spawned.launch || {})}`;
    assert.ok(!launchText.includes("--no-skills"), "the launch has no --no-skills");
    assert.ok(!/skills?-?(exclude|profile)/i.test(launchText), "no skill exclusion arguments/profile keys");
    // The soul source was copied under <agents-root>/<soul>/soul/ for the classic skeleton.
    assert.ok(isRegular(join(agentsRoot, "release-manager", "soul", "soul.yaml")));
    assert.ok(isRegular(join(agentsRoot, "release-manager", "soul", "AGENTS.md")));

    // ---- preview: modules[] with changedSince false (nothing moved yet) ----
    const rmProvider = ["--provider", "oats.okf", "state-dir=/tmp/x"];
    r = oats(spawnArgs("release-manager", "--preview", ...rmProvider), { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    doc = envelope(r);
    let preview = doc.result;
    assert.equal(preview.preview, true); assert.equal(preview.spawnPreviewApi, 2);
    assert.equal(preview.team, "engineering");
    assert.equal(preview.resolution, meta.workspace.resolution, "same inputs (incl. the provider payload) → same revision");
    assert.equal(preview.decision?.resolution, meta.workspace.resolution, "the decision binds the resolution revision");
    r = oats(spawnArgs("release-manager", "--preview"), { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.notEqual(envelope(r).result.resolution, meta.workspace.resolution, "the instance-level payload is part of the revision (decision 14)");
    assert.deepEqual(preview.modules.map((m) => m.name).sort(), expectedModules);
    assert.ok(preview.modules.every((m) => m.changedSince === false), `nothing changed since release-manager-x: ${JSON.stringify(preview.modules.map((m) => [m.name, m.changedSince]))}`);
    assert.equal(preview.modules.find((m) => m.name === "oats.okf").layer, "knowledge");
    assert.ok(!existsSync(join(agentsRoot, "release-manager", "instances", "release-manager-x2")), "a preview creates nothing");

    // ---- spawn tools-expert once BEFORE the move (so status can show 'moved' for nw-tools-dev) ----
    r = oats(spawnArgs("tools-expert"), { cwd: dep, env, base });
    assert.equal(r.status, 0, `spawn tools-expert\n${r.stdout}\n${r.stderr}`);
    const toolsHome = envelope(r).result.home;
    const toolsMeta = JSON.parse(readFileSync(join(toolsHome, "instance.json"), "utf8"));
    assert.deepEqual(Object.keys(toolsMeta.modules).sort(), ["nw-house-style", "nw-lint", "nw-release-tooling", "nw-tools-dev", "oats.core", "oats.okf"]);
    assert.equal(toolsMeta.modules["nw-tools-dev"].from.kind, "member"); assert.equal(toolsMeta.modules["nw-tools-dev"].commit, fx.commits["nw-tools"]);
    assert.equal(toolsMeta.modules["nw-lint"].from.kind, "package", "non-collapse: nw-lint is package-tier even though nw-tools is a member");
    assert.ok(isRegular(join(toolsHome, ".agents", "skills", "nw-tools-dev", "package-conventions", "SKILL.md")));

    // ---- status before any move: no drift lines in the default view ----
    r = oats(["status", "--dir", dep, "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    let st = JSON.parse(r.stdout);
    assert.deepEqual(st.workspace, { reachable: true });
    const instanceOf = (payload, name) => payload.agents.flatMap((a) => a.instances).find((i) => i.instance === name);
    let rm = instanceOf(st, "release-manager-x");
    assert.ok(Array.isArray(rm.modules) && rm.modules.length === 5, "--json: instances[].modules[] has 5 rows");
    assert.ok(rm.modules.every((m) => m.status === "current"), JSON.stringify(rm.modules.map((m) => [m.name, m.status])));
    r = oats(["status", "--dir", dep], { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /modules:/, "the default view lists only moved/missing modules");
    assert.doesNotMatch(r.stdout, /unreachable/);
    r = oats(["status", "--dir", dep, "--verbose"], { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`modules: nw-house-style from agents @ ${fx.commits.agents.slice(0, 7)}$`, "m"), "--verbose lists every module");
    assert.match(r.stdout, new RegExp(`modules: nw-deploy from package nw\\.tools v0\\.4\\.0 @ ${fx.commits["nw-tools"].slice(0, 7)}$`, "m"));
    assert.doesNotMatch(r.stdout, /moved since|no longer present/);

    // ---- move nw-tools (edit the MEMBER capability); the package tag does not move ----
    const move = await moveMember(fx, "nw-tools", async (work, { fs, path }) => {
      await fs.appendFile(path.join(work, "capabilities", "nw-tools-dev", "injects", "nw-tools-dev.md"), "\nMoved: conventions v2.\n");
    });
    assert.match(move.commit, HEX40); assert.notEqual(move.commit, move.previous);

    // release-manager: nw-deploy is PACKAGE-tier (pinned at the tag) → unchanged; nothing else moved.
    r = oats(spawnArgs("release-manager", "--preview", ...rmProvider), { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    preview = envelope(r).result;
    assert.equal(preview.modules.find((m) => m.name === "nw-deploy").changedSince, false, "a member move never touches the package pinned from that repo");
    assert.equal(preview.modules.find((m) => m.name === "nw-deploy").from.commit, fx.tags["nw-tools"].commit);
    assert.ok(preview.modules.every((m) => m.changedSince === false));
    assert.equal(preview.resolution, meta.workspace.resolution, "release-manager's revision is unchanged by the nw-tools move");
    // tools-expert: nw-tools-dev is MEMBER-tier → changedSince names the previous instance and its commit.
    r = oats(spawnArgs("tools-expert", "--preview"), { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    preview = envelope(r).result;
    const dev = preview.modules.find((m) => m.name === "nw-tools-dev");
    assert.deepEqual(dev.changedSince, { instance: "tools-expert-x", was: move.previous });
    assert.equal(dev.from.commit, move.commit, "the preview resolves the member's latest state");
    assert.equal(preview.modules.find((m) => m.name === "nw-lint").changedSince, false, "nw-lint (package) did not move");
    assert.notEqual(preview.resolution, toolsMeta.workspace.resolution, "a moved member changes the revision (→ E_DECISION_STALE for a stale confirmed preview)");
    // A confirmed decision from before the move is stale now: nothing is created.
    r = oats(spawnArgs("tools-expert", "--expect-decision", "0".repeat(24)), { cwd: dep, env, base });
    assert.equal(r.status, 1); assert.equal(envelope(r).error.code, "E_DECISION_STALE");
    assert.ok(!existsSync(join(agentsRoot, "tools-expert", "instances", "tools-expert-x2")));

    // ---- status after the move: drift shown, not prevented (decision 17) ----
    r = oats(["status", "--dir", dep, "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    st = JSON.parse(r.stdout);
    rm = instanceOf(st, "release-manager-x");
    assert.equal(rm.modules.length, 5);
    assert.ok(!rm.modules.some((m) => m.name === "nw-tools-dev"), "release-manager never had nw-tools-dev");
    assert.ok(rm.modules.every((m) => m.status === "current"), `release-manager is unaffected by the move: ${JSON.stringify(rm.modules.map((m) => [m.name, m.status]))}`);
    const te = instanceOf(st, "tools-expert-x");
    const teDev = te.modules.find((m) => m.name === "nw-tools-dev");
    assert.equal(teDev.status, "moved"); assert.equal(teDev.commit, move.previous); assert.equal(teDev.current.commit, move.commit);
    assert.equal(te.modules.find((m) => m.name === "nw-lint").status, "current", "the package is pinned: no drift");
    r = oats(["status", "--dir", dep], { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`modules: nw-tools-dev from nw-tools @ ${move.previous.slice(0, 7)} {2}\\[member moved since \\(now @ ${move.commit.slice(0, 7)}\\)\\]`));
    assert.equal((r.stdout.match(/modules:/g) || []).length, 1, "only the moved module appears in the default view");

    // ---- a capability removed from a member → 'capability no longer present' ----
    await moveMember(fx, "nw-tools", async (work, { fs, path }) => { await fs.rm(path.join(work, "capabilities", "nw-tools-dev"), { recursive: true }); });
    r = oats(["status", "--dir", dep, "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    st = JSON.parse(r.stdout);
    const gone = instanceOf(st, "tools-expert-x").modules.find((m) => m.name === "nw-tools-dev");
    assert.equal(gone.status, "missing"); assert.equal(gone.reason, "capability-absent");
    r = oats(["status", "--dir", dep], { cwd: dep, env, base });
    assert.match(r.stdout, /modules: nw-tools-dev from nw-tools @ [0-9a-f]{7} {2}\[capability no longer present\]/);

    // ---- a soul in an unconfirmed member (backlink dropped) cannot be spawned ----
    await dropBacklink(fx, "platform");
    r = oats(spawnArgs("platform-engineer"), { cwd: dep, env, base });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const unconfirmed = envelope(r).error;
    assert.ok(["E_SOUL_UNKNOWN", "E_MEMBERSHIP_UNCONFIRMED"].includes(unconfirmed.code), `got ${unconfirmed.code}: ${unconfirmed.message}`);
    // Reported for the record: the unconfirmed member contributes nothing but its row, so the soul is not
    // discovered at all (E_SOUL_UNKNOWN) rather than found-then-gated (E_MEMBERSHIP_UNCONFIRMED).
    assert.ok(!existsSync(join(agentsRoot, "platform-engineer")), "nothing is created for a refused soul");

    // ---- --provider naming a capability the soul does not resolve → E_CAPABILITY_MISSING ----
    r = oats(spawnArgs("release-manager", "--provider", "oats.aweb", "x=y"), { cwd: dep, env, base });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const missing = envelope(r).error;
    assert.equal(missing.code, "E_CAPABILITY_MISSING");
    assert.equal(missing.details?.capability, "oats.aweb");
    assert.ok(!existsSync(join(agentsRoot, "release-manager", "instances", "release-manager-x2")), "nothing is created");

    // ---- offline: an unreachable workspace host → status still answers, drift unknown ----
    // Point the deployment at a workspace host that cannot be read (a non-existent bare repo) in a
    // sibling deployment sharing the same agents root layout.
    const offline = join(base, "offline-workspace");
    mkdirSync(join(offline, "agents"), { recursive: true });
    writeFileSync(join(offline, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${join(base, "nowhere.git")}\n`);
    // Carry one materialized instance over so drift has something to compute against.
    spawnSync("cp", ["-R", join(agentsRoot, "release-manager"), join(offline, "agents", "release-manager")]);
    r = oats(["status", "--dir", offline], { cwd: offline, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /workspace: unreachable \(.+\) — drift unknown/);
    assert.match(r.stdout, /release-manager-x/);
    r = oats(["status", "--dir", offline, "--json"], { cwd: offline, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    st = JSON.parse(r.stdout);
    assert.equal(st.workspace.reachable, false);
    assert.equal(st.workspace.code, "E_REMOTE_UNREADABLE");
    assert.ok(!Array.isArray(instanceOf(st, "release-manager-x").modules), "without discovery, modules stay the recorded map (no drift rows)");
  } finally { rmSync(base, { recursive: true, force: true }); }
});
