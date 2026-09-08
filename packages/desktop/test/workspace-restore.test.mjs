import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restoreWorkspaceDirs, saveWorkspaceDirs, matchWorkspaceDirs, createAddExecutor } from "../workspace-registry.mjs";

const validate = (p) => {
  if (p === "/missing") throw new Error("ENOENT");
  if (p === "/team/member" || p === "/alias") return { path: "/team" };
  return ["/team", "/second", "/third"].includes(p) ? { path: p } : null;
};

test("restart restores only valid opened scopes, deduplicates aliases, and retains launch intent", () => {
  const saved = JSON.stringify(["/second", "/team/member", "/missing", "/alias", "relative", null, {}]);
  assert.deepEqual(restoreWorkspaceDirs("/team", saved, validate), ["/team", "/second"]);
  assert.deepEqual(restoreWorkspaceDirs("/third", saved, validate), ["/third", "/second", "/team"]);
  assert.deepEqual(restoreWorkspaceDirs("/", saved, validate), ["/second", "/team"]);
  for (const raw of ["invalid", "{}", "null", "[]"]) {
    assert.deepEqual(restoreWorkspaceDirs("/team", raw, validate), ["/team"]);
    assert.deepEqual(restoreWorkspaceDirs("/", raw, validate), ["/"]);
  }
});

test("a compatible backend serving only the launch workspace cannot hide restored workspaces", () => {
  const dirs = restoreWorkspaceDirs("/team", '["/second"]', validate);
  assert.equal(matchWorkspaceDirs(dirs, [{ id: "/team" }]), null);
  assert.equal(matchWorkspaceDirs(dirs, [{ id: "/second" }, { id: "/team" }]), "/team");
  assert.equal(matchWorkspaceDirs(["/team/member"], [{ id: "/team" }]), "/team");
  assert.equal(matchWorkspaceDirs(["/team-other"], [{ id: "/team" }]), null);
});

test("successful adds survive restart; failed readiness and storage writes preserve the last open set", async () => {
  const root = mkdtempSync(join(tmpdir(), "oats-workspace-restore-"));
  try {
    const file = join(root, "userData", "workspace-open.json");
    let dirs = ["/team"], ready = true;
    const replaced = [];
    saveWorkspaceDirs(file, dirs);
    const execute = createAddExecutor({
      getDirs: () => [...dirs],
      commitDirs: (next) => { saveWorkspaceDirs(file, next); dirs = next; },
      commitRecent: () => {},
      replaceServer: async (next) => { replaced.push([...next]); },
      probeVersion: async () => ({ ok: true }),
      isCompatible: () => true,
      advertises: async () => ready,
      refreshAdvertised: async () => true,
      delay: async () => {}, attempts: 1,
    });
    const restart = () => restoreWorkspaceDirs("/team", readFileSync(file, "utf8"), validate);
    assert.equal((await execute({ path: "/second", id: "/second" }, () => true)).ok, true);
    assert.deepEqual(restart(), ["/team", "/second"]);
    const lastGood = readFileSync(file, "utf8");
    ready = false;
    assert.equal((await execute({ path: "/third", id: "/third" }, () => true)).code, "server-timeout");
    assert.deepEqual(replaced.at(-1), ["/team", "/second"]);
    assert.equal(readFileSync(file, "utf8"), lastGood);
    ready = true;
    // Actual filesystem failure, independent of uid/root permission behavior.
    mkdirSync(`${file}.tmp`);
    assert.equal((await execute({ path: "/third", id: "/third" }, () => true)).code, "server-error");
    assert.deepEqual(dirs, ["/team", "/second"]);
    assert.deepEqual(replaced.at(-1), dirs);
    assert.deepEqual(restart(), dirs);
    assert.equal(readFileSync(file, "utf8"), lastGood);
    rmSync(`${file}.tmp`, { recursive: true });
    assert.equal((await execute({ path: "/third", id: "/third" }, () => true)).ok, true);
    assert.deepEqual(restart(), ["/team", "/second", "/third"]);
    assert.equal(existsSync(`${file}.tmp`), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
