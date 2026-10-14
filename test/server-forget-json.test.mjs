// `oats server forget <id> --instance <name> --json`: the answer the Desktop
// reads (docs/desktop-cli-api.md, "Forget a saved route"), pinned against the
// real CLI. The Desktop runs it for a remote roster row whose host no longer
// lists it (`missingRemotely: true`, #1131) and reads `ok`, `error.code` and,
// on success, `result.forgotten` with the echoed `server` and `instance`.
//
// Hermetic: every child runs with OATS_HOME_DIR and HOME in a fresh temporary
// directory and no inherited OATS_* or PI_* variable, and the saved route is
// seeded in process under the same OATS_HOME_DIR. Nothing here reads or
// writes ~/.oats, and forget never runs ssh.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { snapshotPath, writeSnapshot } from "../lib/servers.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const TARGET = Object.freeze({ sshHost: "build-host", workspace: "/srv/team", oatsPath: "oats" });
const HOME_ON_HOST = "/srv/team/agents/dev/instances/dev-a";

/** A fresh OATS_HOME_DIR and HOME for one case, removed after it. */
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "oats-server-forget-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const oatsHome = join(base, "oats-home"), home = join(base, "home");
  mkdirSync(oatsHome, { recursive: true }); mkdirSync(home, { recursive: true });
  return { base, oatsHome, home };
}

/** Run `fn` with process.env.OATS_HOME_DIR set to `dir` (lib/servers.mjs reads it at call time), then restore it. */
function underOatsHome(dir, fn) {
  const outer = process.env.OATS_HOME_DIR;
  process.env.OATS_HOME_DIR = dir;
  try { return fn(); } finally { if (outer === undefined) delete process.env.OATS_HOME_DIR; else process.env.OATS_HOME_DIR = outer; }
}

/** A saved route to `instance` through `server`, as a spawn from this machine records it. */
function seedRoute(fx, server, instance) {
  return underOatsHome(fx.oatsHome, () => {
    writeSnapshot(server, { ...TARGET }, { version: "0.55.0", schemaVersion: 1 },
      { instance, agent: "dev", home: HOME_ON_HOST, agentsRoot: "/srv/team/agents" });
    return snapshotPath(server, instance);
  });
}

/** The CLI with only this case's directories: no OATS_* or PI_* leaks in from a hosting instance. */
function oats(fx, argv) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(OATS|PI)_/.test(k)) env[k] = v;
  Object.assign(env, { HOME: fx.home, OATS_HOME_DIR: fx.oatsHome });
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [CLI, ...argv], { cwd: fx.base, env, encoding: "utf8" });
  if (r.error) throw r.error;
  return r;
}

/** stdout is exactly one schema-v1 envelope. */
function envelope(r) {
  const doc = JSON.parse(r.stdout);
  assert.equal(r.stdout.trim(), JSON.stringify(doc), "stdout is exactly one JSON document");
  assert.equal(doc.schemaVersion, 1);
  return doc;
}

function refused(r, code) {
  const doc = envelope(r);
  assert.equal(doc.ok, false, r.stdout);
  assert.equal(doc.error.code, code, doc.error.message);
  assert.equal(typeof doc.error.message, "string");
  assert.equal(r.status, 1, r.stderr);
  return doc;
}

test("forget drops the saved route and answers {server, instance, home, target, forgotten: true}", (t) => {
  const fx = fixture(t);
  const file = seedRoute(fx, "build", "dev-a");
  assert.ok(existsSync(file), "the route is seeded under the temporary OATS_HOME_DIR");
  assert.ok(file.startsWith(fx.oatsHome), file);

  const r = oats(fx, ["server", "forget", "build", "--instance", "dev-a", "--json"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const doc = envelope(r);
  assert.equal(doc.ok, true, r.stdout);
  assert.deepEqual(Object.keys(doc.result).sort(), ["forgotten", "home", "instance", "server", "target"]);
  assert.equal(doc.result.forgotten, true);
  assert.equal(doc.result.server, "build");
  assert.equal(doc.result.instance, "dev-a");
  assert.equal(doc.result.home, HOME_ON_HOST);
  assert.deepEqual(doc.result.target, TARGET);
  assert.ok(!existsSync(file), "the route file is gone");
});

test("a second forget of the same row is E_SNAPSHOT_UNKNOWN", (t) => {
  const fx = fixture(t);
  seedRoute(fx, "build", "dev-a");
  const first = oats(fx, ["server", "forget", "build", "--instance", "dev-a", "--json"]);
  assert.equal(first.status, 0, first.stderr + first.stdout);
  refused(oats(fx, ["server", "forget", "build", "--instance", "dev-a", "--json"]), "E_SNAPSHOT_UNKNOWN");
});

test("a server id outside ^[a-z0-9][a-z0-9-]{0,63}$ is E_SERVER_INVALID", (t) => {
  const fx = fixture(t);
  refused(oats(fx, ["server", "forget", "Bad_Id", "--instance", "dev-a", "--json"]), "E_SERVER_INVALID");
});

test("an instance name outside ^[a-z0-9][a-z0-9-]*$ is E_BAD_ARGS, and the saved route is kept", (t) => {
  const fx = fixture(t);
  const file = seedRoute(fx, "build", "dev-a");
  refused(oats(fx, ["server", "forget", "build", "--instance", "Dev_A", "--json"]), "E_BAD_ARGS");
  assert.ok(existsSync(file), "a refusal removes nothing");
});

test("no --instance is E_USAGE", (t) => {
  const fx = fixture(t);
  const file = seedRoute(fx, "build", "dev-a");
  refused(oats(fx, ["server", "forget", "build", "--json"]), "E_USAGE");
  assert.ok(existsSync(file), "a refusal removes nothing");
});
