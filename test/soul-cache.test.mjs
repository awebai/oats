// lib/instance-resolution.mjs#ensureWorkspaceSoul + lib/core.mjs spawnBody (soul link) — the
// per-commit soul cache (0.25.1, finding M1: a running instance's soul changed under it).
//
//   agents/<name>/souls/<commit12>/   immutable per-commit entries, fetched to staging then renamed
//                                     in, NEVER removed by the kernel;
//   agents/<name>/soul                a SYMLINK ("current") into souls/, swapped atomically, so the
//                                     classic readers (findAgent, doctor, the classic skeleton) see
//                                     the current commit at the usual place;
//   <home>/soul                       links the spawning commit's directory by REALPATH — never the
//                                     swappable pointer — so a preview/spawn at a newer commit never
//                                     changes anything under a running instance (decision 7);
//   .oats-soul-source.json            stamps what the pointer shows;
//   migration                         a 0.25.0 real `soul/` directory moves to souls/<stamp commit|unknown>/.
//
// In-process over the Northwind fixture (real bare remotes, real lib/remote.mjs); prepareInstance →
// ensureWorkspaceSoul → spawnInstanceAsync exactly as bin does. Never bare `oats setup`; HOME and
// the remote cache are isolated; --no-launch equivalent (launch: false).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename, dirname } from "node:path";
import { buildNorthwind, moveMember } from "./fixtures/northwind/build.mjs";
import { prepareInstance, ensureWorkspaceSoul, toCapabilityRows, modulesPreview, soulPointerTarget, SOULS_DIR, SOUL_SOURCE_STAMP } from "../lib/instance-resolution.mjs";
import { spawnInstanceAsync, findAgent, listAgents } from "../lib/core.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const c12 = (c) => String(c).slice(0, 12);
const isRealDir = (p) => existsSync(p) && lstatSync(p).isDirectory() && !lstatSync(p).isSymbolicLink();

/** Fixture + deployment + `oats sync` (child process) + approval by editing the lock. */
async function deployment() {
  const base = mkdtempSync(join(tmpdir(), "oats-soul-cache-"));
  if (/[\s@]/.test(base)) { rmSync(base, { recursive: true, force: true }); throw new Error(`tmpdir ${base} contains whitespace or @`); }
  const fx = await buildNorthwind(join(base, "fx"));
  const catalogFile = join(base, "catalog.json");
  writeFileSync(catalogFile, JSON.stringify({ packages: fx.catalog }, null, 2));
  const dep = join(base, "northwind-workspace");
  const root = join(dep, "agents");
  mkdirSync(root, { recursive: true });
  mkdirSync(join(base, "home"));
  writeFileSync(join(dep, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${fx.refs.agents}\n`);
  const env = { ...process.env, PI_AGENT_HOME: "", OATS_HOME: "", PI_AGENTS_ROOT: "", OATS_PACKAGE_CATALOG: catalogFile, OATS_REMOTE_CACHE: join(base, "cache"), HOME: join(base, "home"), OATS_TMUX_SESSION: `none-${process.pid}`, PI_AGENTS_TMUX_SESSION: `none-${process.pid}` };
  const r = spawnSync(process.execPath, [CLI, "sync", "--dir", dep, "--json"], { cwd: dep, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env });
  assert.equal(r.status, 2, `sync exits 2 with approvals pending\n${r.stdout}\n${r.stderr}`);
  const lockFile = join(dep, "oats-lock.json");
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  // Approve exactly what a TTY sync would record: the digest the sync report computed per package.
  const needed = JSON.parse(r.stdout).result?.approvalNeeded ?? JSON.parse(r.stdout).approvalNeeded ?? [];
  for (const [id, p] of Object.entries(lock.packages)) {
    const need = needed.find((a) => a.id === id);
    p.approved = { executables: need?.executables ?? "sha256-" + "0".repeat(64), at: "2026-09-23T00:00:00.000Z" };
  }
  writeFileSync(lockFile, JSON.stringify(lock, null, 2) + "\n");
  return { base, fx, dep, root, env, remoteOptions: { cacheDir: join(base, "cache") } };
}
/** What bin does before spawnInstanceAsync (and ALL a `--preview` does to the soul cache). */
async function prepare(d, soul) {
  const prepared = await prepareInstance(d.dep, soul, { spawn: { providers: { "oats.okf": { "state-dir": "/tmp/x" } } }, remoteOptions: d.remoteOptions });
  const soulDir = await ensureWorkspaceSoul(prepared, d.root);
  prepared.capabilityRows = []; prepared.preview = modulesPreview(prepared.resolution, d.root, soul); prepared.toCapabilityRows = toCapabilityRows;
  const agent = findAgent(d.root, soul);
  assert.ok(agent, `soul ${soul} readable at ${d.root} (through the pointer)`);
  return { prepared, agent, soulDir };
}
function withFixtureEnv(d, fn) {
  const saved = { ...process.env };
  Object.assign(process.env, { OATS_PACKAGE_CATALOG: d.env.OATS_PACKAGE_CATALOG, OATS_REMOTE_CACHE: d.env.OATS_REMOTE_CACHE, OATS_TMUX_SESSION: d.env.OATS_TMUX_SESSION, PI_AGENTS_TMUX_SESSION: d.env.PI_AGENTS_TMUX_SESSION });
  return fn().finally(() => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); rmSync(d.base, { recursive: true, force: true }); });
}

test("M1: per-commit soul cache — a preview/spawn at a newer commit swaps the pointer and never touches the directory a running instance links", { timeout: 300_000 }, async () => {
  const d = await deployment();
  await withFixtureEnv(d, async () => {
    const agentDir = join(d.root, "release-manager"), pointer = join(agentDir, "soul"), souls = join(agentDir, SOULS_DIR), stamp = join(agentDir, SOUL_SOURCE_STAMP);
    const c1 = d.fx.commits.agents;

    // ---- spawn A at commit1 ----
    const a = await prepare(d, "release-manager");
    assert.equal(a.soulDir, realpathSync(join(souls, c12(c1))), "ensureWorkspaceSoul returns the PER-COMMIT directory");
    assert.ok(isRealDir(join(souls, c12(c1))), "souls/<c1>/ is a real directory");
    assert.ok(lstatSync(pointer).isSymbolicLink(), "agents/<name>/soul is a symlink (the 'current' pointer)");
    assert.equal(soulPointerTarget(pointer), a.soulDir, "…pointing into souls/");
    assert.equal(JSON.parse(readFileSync(stamp, "utf8")).commit, c1, "the stamp says what the pointer shows");
    assert.equal(a.agent._dir, agentDir, "findAgent reads the soul through the pointer");
    assert.ok(listAgents(d.root).some((x) => x.name === "release-manager"), "listAgents reads through the pointer too");
    const A = await spawnInstanceAsync(d.root, a.agent, { prepared: a.prepared, purpose: "a", work: "directory", repo: d.dep, launch: false });
    const aSoul = join(A.home, "soul");
    assert.ok(lstatSync(aSoul).isSymbolicLink());
    const aReal = realpathSync(aSoul);
    assert.equal(aReal, realpathSync(join(souls, c12(c1))), "A's home/soul links ITS commit's directory (realpath), never the pointer");
    const aAgentsMd = readFileSync(join(aSoul, "AGENTS.md"), "utf8");
    // The OKF spawn hook pins its owner by realpath(<home>/soul): remember what it saw.
    const aMeta = JSON.parse(readFileSync(join(A.home, "instance.json"), "utf8"));
    assert.equal(aMeta.workspace.soul.commit, c1);

    // ---- the soul moves upstream (commit2) ----
    const moved = await moveMember(d.fx, "agents", async (work, { fs, path }) => {
      await fs.appendFile(path.join(work, "souls", "release-manager", "AGENTS.md"), "\nM1: release policy revised while A runs.\n");
    }, { message: "agents: revise release-manager soul (M1)" });
    const c2 = moved.commit;
    assert.notEqual(c12(c2), c12(c1));

    // ---- a PREVIEW (prepareInstance + ensureWorkspaceSoul, nothing else) fetches c2 and swaps the pointer ----
    const p = await prepare(d, "release-manager");
    assert.equal(p.soulDir, realpathSync(join(souls, c12(c2))));
    assert.ok(isRealDir(join(souls, c12(c1))) && isRealDir(join(souls, c12(c2))), "BOTH per-commit directories exist — the kernel removes none");
    assert.equal(soulPointerTarget(pointer), realpathSync(join(souls, c12(c2))), "the pointer now shows c2");
    assert.equal(JSON.parse(readFileSync(stamp, "utf8")).commit, c2, "the stamp follows the pointer");
    assert.match(readFileSync(join(pointer, "AGENTS.md"), "utf8"), /M1: release policy revised/, "classic readers see 'current' at agents/<name>/soul");
    // A is untouched.
    assert.equal(realpathSync(aSoul), aReal, "A's soul realpath is unchanged (the OKF owner pin stays valid)");
    assert.equal(readFileSync(join(aSoul, "AGENTS.md"), "utf8"), aAgentsMd, "A's soul/AGENTS.md is byte-identical");
    assert.doesNotMatch(readFileSync(join(aSoul, "AGENTS.md"), "utf8"), /M1: release policy revised/);
    assert.doesNotMatch(readFileSync(join(A.home, "AGENTS.md"), "utf8"), /M1: release policy revised/, "A's composed instructions are unchanged");
    const leftovers = readdirSync(agentDir).filter((n) => n.startsWith(".soul-staging-") || n.startsWith("soul.previous-") || n.startsWith("soul.pointer-"));
    assert.deepEqual(leftovers, [], "no staging / previous / pointer temp files remain beside the pointer");
    assert.deepEqual(readdirSync(souls).filter((n) => n.startsWith(".")), [], "no staging left inside souls/");

    // ---- spawn B at commit2 ----
    const B = await spawnInstanceAsync(d.root, p.agent, { prepared: p.prepared, purpose: "b", work: "directory", repo: d.dep, launch: false });
    assert.equal(realpathSync(join(B.home, "soul")), realpathSync(join(souls, c12(c2))), "B's home/soul links souls/<c2>/");
    assert.match(readFileSync(join(B.home, "soul", "AGENTS.md"), "utf8"), /M1: release policy revised/);
    assert.match(readFileSync(join(B.home, "AGENTS.md"), "utf8"), /M1: release policy revised/, "B is composed from c2");
    assert.equal(JSON.parse(readFileSync(join(B.home, "instance.json"), "utf8")).workspace.soul.commit, c2);
    assert.equal(realpathSync(aSoul), aReal, "…and A still links c1");

    // ---- idempotence: same commit → the entry is reused as is (never rewritten), pointer untouched ----
    writeFileSync(join(souls, c12(c2), ".marker"), "x");
    const again = await ensureWorkspaceSoul(p.prepared, d.root);
    assert.equal(again, realpathSync(join(souls, c12(c2))));
    assert.ok(existsSync(join(souls, c12(c2), ".marker")), "an existing complete entry is not refetched");
    // ---- going BACK to c1 (a stale local view, or a member reverted) reuses the c1 entry and re-points ----
    const back = await ensureWorkspaceSoul(a.prepared, d.root);
    assert.equal(back, aReal);
    assert.equal(soulPointerTarget(pointer), aReal);
    assert.equal(JSON.parse(readFileSync(stamp, "utf8")).commit, c1);
    assert.equal(realpathSync(join(B.home, "soul")), realpathSync(join(souls, c12(c2))), "B still links c2 — swapping the pointer back touches no instance");
  });
});

test("M1 migration: a 0.25.0 real agents/<name>/soul directory becomes souls/<stamp commit>/ behind the pointer; a damaged entry is set aside, not deleted; a foreign symlink is not a kernel pointer", { timeout: 300_000 }, async () => {
  const d = await deployment();
  await withFixtureEnv(d, async () => {
    const agentDir = join(d.root, "release-manager"), pointer = join(agentDir, "soul"), souls = join(agentDir, SOULS_DIR), stamp = join(agentDir, SOUL_SOURCE_STAMP);
    const c1 = d.fx.commits.agents;
    // Build the 0.25.0 layout by hand: a REAL soul/ directory + the stamp, no souls/.
    const prepared = await prepareInstance(d.dep, "release-manager", { spawn: {}, remoteOptions: d.remoteOptions });
    await ensureWorkspaceSoul(prepared, d.root);
    const real = realpathSync(pointer);
    rmSync(pointer); renameSync(real, pointer); rmSync(souls, { recursive: true, force: true });
    assert.ok(isRealDir(pointer) && existsSync(join(pointer, "soul.yaml")) && !existsSync(souls), "0.25.0 layout: real soul/ dir, stamp, no souls/");
    writeFileSync(join(pointer, ".legacy-marker"), "from 0.25.0");
    // A spawn/preview at the SAME commit migrates in place: no refetch (the marker survives).
    const out = await ensureWorkspaceSoul(prepared, d.root);
    assert.equal(out, realpathSync(join(souls, c12(c1))));
    assert.ok(lstatSync(pointer).isSymbolicLink(), "soul/ is now the pointer");
    assert.equal(soulPointerTarget(pointer), out);
    assert.ok(existsSync(join(souls, c12(c1), ".legacy-marker")), "the legacy directory was MOVED (not refetched) to souls/<stamp commit>/");
    assert.ok(findAgent(d.root, "release-manager"), "findAgent still reads it");
    // A real soul/ dir WITHOUT a usable stamp migrates to souls/unknown/ and the current commit is fetched beside it.
    rmSync(pointer); renameSync(join(souls, c12(c1)), pointer); rmSync(souls, { recursive: true, force: true }); rmSync(stamp, { force: true });
    const out2 = await ensureWorkspaceSoul(prepared, d.root);
    assert.equal(out2, realpathSync(join(souls, c12(c1))));
    assert.ok(isRealDir(join(souls, "unknown")) && existsSync(join(souls, "unknown", ".legacy-marker")), "the unstamped legacy dir is kept as souls/unknown/");
    assert.ok(!existsSync(join(souls, c12(c1), ".legacy-marker")), "the current commit was fetched fresh");
    // A damaged per-commit entry (soul.yaml gone) is moved aside — never deleted — and refetched.
    rmSync(join(souls, c12(c1), "soul.yaml"));
    writeFileSync(join(souls, c12(c1), ".damaged-marker"), "x");
    const out3 = await ensureWorkspaceSoul(prepared, d.root);
    assert.equal(out3, realpathSync(join(souls, c12(c1))));
    assert.ok(existsSync(join(souls, c12(c1), "soul.yaml")), "refetched under the canonical name");
    const aside = readdirSync(souls).filter((n) => n.startsWith(`${c12(c1)}.damaged-`));
    assert.equal(aside.length, 1, "the damaged entry is set aside");
    assert.ok(existsSync(join(souls, aside[0], ".damaged-marker")), "…with its bytes (an instance may link it)");
    // A symlink that points OUTSIDE souls/ is not the kernel's pointer.
    const elsewhere = join(d.base, "elsewhere"); mkdirSync(elsewhere);
    const foreign = join(agentDir, "soul-foreign"); symlinkSync(elsewhere, foreign);
    assert.equal(soulPointerTarget(foreign), null);
    assert.equal(soulPointerTarget(join(agentDir, "nope")), null);
    assert.equal(soulPointerTarget(join(souls, c12(c1))), null, "a real directory is not a pointer");
    // sanity on the shape the classic skeleton depends on
    assert.equal(basename(dirname(realpathSync(pointer))), SOULS_DIR);
    assert.ok(statSync(join(pointer, "soul.yaml")).isFile());
  });
});
