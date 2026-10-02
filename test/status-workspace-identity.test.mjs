// `oats status --json` reports the deployment's workspace identity (feature workspace-identity,
// awebai/oats#482): the `workspace` object carries `key` (oats-local.yaml's `workspace:`),
// `standalone`, `defaultTeam` {label, team}, `teams` {label: id | null} and `teamsFrom`, read
// OFFLINE. Shared teams come from the workspace file this run observed, else this machine's parsed
// cache at the host's last observed commit, else nowhere (local teams only). Real CLI, real bare
// remote (test/helpers/v2-deployment.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { CLI, v2Deployment } from "./helpers/v2-deployment.mjs";

const SHARED = "shared:fixture.aweb.ai", MINE = "mine:fixture.aweb.ai";
/** A deployment whose workspace commits `global` (no id yet) and `shared`, and whose oats-local.yaml
 *  maps `mine` locally; `defaultTeam` as given. */
function deployment(local = {}) {
  return v2Deployment({
    workspace: { teams: { global: { description: "Fixture team" }, shared: { team: SHARED } } },
    local: { teams: { mine: { team: MINE } }, ...local },
  });
}
const status = (fx, extra) => {
  const r = fx.cli(["status", "--json"], { env: extra });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout);
};
const writeLocal = (fx, local) => writeFileSync(join(fx.dep, "oats-local.yaml"), YAML.stringify({ schemaVersion: 2, workspace: fx.ref, teams: { mine: { team: MINE } }, ...local }));
/** A PATH directory whose `git` logs every invocation, then runs the real git. */
function loggingGit(fx) {
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const bin = join(fx.base, "logging-git"), log = join(fx.base, "git.log");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "git"), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(real)} "$@"\n`);
  chmodSync(join(bin, "git"), 0o755);
  return { env: { PATH: `${bin}:${fx.env.PATH}` }, calls: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []) };
}
const unreachable = (fx) => renameSync(fx.repo, `${fx.repo}.gone`);

test("teamsFrom local: a host with no cache reports local teams only, and a shared default team's id is null", () => {
  const fx = deployment({ defaultTeam: "shared" });
  try {
    const ws = status(fx).workspace;
    assert.deepEqual(ws, { reachable: true, key: fx.ref, standalone: false, defaultTeam: { label: "shared", team: null }, teams: { mine: MINE }, teamsFrom: "local" });
  } finally { fx.cleanup(); }
});

test("teamsFrom cache: the parsed cache at the last observed commit answers with no git process, the host unreachable", () => {
  const fx = deployment({ defaultTeam: "shared" });
  try {
    const seen = fx.cli(["teams", "--json"]); // observes the host: the parsed cache now holds its workspace file
    assert.equal(seen.status, 0, seen.stdout + seen.stderr);
    unreachable(fx);
    const git = loggingGit(fx);
    const ws = status(fx, git.env).workspace;
    // The one git process every `oats status` runs is ensureRoot's local canonical-root probe of the
    // deployment checkout (lib/core.mjs canonicalDeploymentPath); the teams read adds none, and nothing
    // reaches the remote.
    assert.deepEqual(git.calls(), [`-C ${fx.dep} rev-parse --show-toplevel`], "status ran no git process beyond the local root probe");
    assert.deepEqual(ws, { reachable: true, key: fx.ref, standalone: false, defaultTeam: { label: "shared", team: SHARED },
      teams: { global: null, mine: MINE, shared: SHARED }, teamsFrom: "cache" });
  } finally { fx.cleanup(); }
});

test("teamsFrom observed when this run read the workspace file; unreachable falls back to the cache; unmapped and no default", async () => {
  const fx = deployment({ defaultTeam: "mine" });
  try {
    await fx.spawn("dev", { instance: "dev-1" }); // a workspace soul: status discovers the workspace
    let ws = status(fx).workspace;
    const teams = { global: null, mine: MINE, shared: SHARED };
    assert.deepEqual(ws, { reachable: true, key: fx.ref, standalone: false, defaultTeam: { label: "mine", team: MINE }, teams, teamsFrom: "observed" });

    unreachable(fx);
    ws = status(fx).workspace;
    assert.equal(ws.reachable, false);
    for (const k of ["code", "reason", "message"]) assert.equal(typeof ws[k], "string", `unreachable keeps ${k}`);
    assert.deepEqual({ ...ws, code: undefined, reason: undefined, message: undefined },
      { reachable: false, code: undefined, reason: undefined, message: undefined, key: fx.ref, standalone: false, defaultTeam: { label: "mine", team: MINE }, teams, teamsFrom: "cache" });

    // A label the workspace declares without an id: genuinely unmapped (the cache read the shared file).
    writeLocal(fx, { defaultTeam: "global" });
    ws = status(fx).workspace;
    assert.deepEqual([ws.teamsFrom, ws.defaultTeam], ["cache", { label: "global", team: null }]);

    // No defaultTeam in oats-local.yaml: no default team at all.
    writeLocal(fx, {});
    ws = status(fx).workspace;
    assert.deepEqual([ws.teamsFrom, ws.defaultTeam, ws.teams], ["cache", null, teams]);
  } finally { fx.cleanup(); }
});

test("a standalone deployment reports standalone true and its local teams only", () => {
  const fx = deployment({ defaultTeam: "mine" });
  try {
    const seen = fx.cli(["teams", "--json"]); // a cache of the shared file exists; standalone never uses it
    assert.equal(seen.status, 0, seen.stdout + seen.stderr);
    writeLocal(fx, { standalone: fx.ref, defaultTeam: "mine" });
    const ws = status(fx).workspace;
    assert.deepEqual(ws, { reachable: true, key: fx.ref, standalone: true, defaultTeam: { label: "mine", team: MINE }, teams: { mine: MINE }, teamsFrom: "local" });
  } finally { fx.cleanup(); }
});

test("`oats version --json` advertises workspace-identity", () => {
  const r = spawnSync(process.execPath, [CLI, "version", "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).features.includes("workspace-identity"));
});

test("a deployment without oats-local.yaml has no workspace object", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-legacy-"));
  try {
    mkdirSync(join(base, "agents"));
    const r = spawnSync(process.execPath, [CLI, "status", "--json", "--dir", base], { cwd: base, encoding: "utf8", env: { ...process.env, HOME: base, OATS_HOME_DIR: join(base, "oh"), OATS_REMOTE_CACHE: join(base, "cache") } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(Object.hasOwn(JSON.parse(r.stdout), "workspace"), false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("the human-readable `oats status` carries none of the identity fields", async () => {
  const fx = deployment({ defaultTeam: "shared" });
  try {
    await fx.spawn("dev", { instance: "dev-1" });
    for (const reach of [true, false]) {
      if (!reach) unreachable(fx);
      const r = fx.cli(["status"]);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      for (const s of [SHARED, MINE, "teamsFrom", "defaultTeam", "standalone"]) assert.ok(!r.stdout.includes(s), `human status shows ${s}`);
      const lines = r.stdout.split("\n");
      assert.match(lines[0], /^oats status — agents root /);
      if (reach) assert.ok(!lines.some((l) => l.includes("workspace:")), "a reachable workspace prints no workspace line");
      else assert.match(lines.find((l) => l.includes("workspace:")), /^ {2}workspace: unreachable \(.+\) — drift unknown$/);
    }
  } finally { fx.cleanup(); }
});
