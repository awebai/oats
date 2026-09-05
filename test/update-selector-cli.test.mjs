// `oats update <package> [<package>@<ref>] [--to <ref>]` through the CLI, against
// a LOCAL Git fixture bound through OATS_PACKAGE_CATALOG: nothing here touches
// the network, and a fake `npm` on PATH proves the kernel self-update is never
// entered by mistake.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { OATS_LOCK_FILE } from "../lib/core.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
function write(path, content) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
function git(dir, ...args) { return execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { encoding: "utf8" }).trim(); }

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "oats-update-to-"));
  const repo = join(base, "repo");
  const pkg = (version) => write(join(repo, "oats-package/oats-package.json"), JSON.stringify({ package: "x.p", version, description: "fixture package", compatibility: { oats: ">=0.1.0" }, capabilities: ["capabilities/a"] }, null, 2) + "\n");
  pkg("1.0.0");
  write(join(repo, "oats-package/capabilities/a/oats.json"), JSON.stringify({ capability: "x.a", version: "1.0.0", description: "a", commands: { go: "bin/go.mjs run" } }, null, 2) + "\n");
  write(join(repo, "oats-package/capabilities/a/bin/go.mjs"), "//\n");
  execFileSync("git", ["init", "-q", repo]); git(repo, "add", "-A"); git(repo, "commit", "-qm", "v1"); git(repo, "tag", "v1");
  pkg("2.0.0"); write(join(repo, "oats-package/capabilities/a/more.md"), "v2\n"); git(repo, "add", "-A"); git(repo, "commit", "-qm", "v2"); git(repo, "tag", "v2");
  const catalog = join(base, "catalog.json");
  write(catalog, JSON.stringify({ packages: { "x.p": { url: `file://${repo}`, ref: "v2", path: "oats-package" } } }, null, 2));
  const scope = join(base, "scope"); write(join(scope, "oats-config.yaml"), "name: t\n");
  // A fake npm that records any invocation: the kernel self-update must never run.
  const bin = join(base, "bin"); const npmLog = join(base, "npm.log");
  write(join(bin, "npm"), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(npmLog)}\nexit 1\n`); chmodSync(join(bin, "npm"), 0o755);
  const home = join(base, "home"); mkdirSync(home);
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(OATS|PI)_/.test(k)) env[k] = v;
  Object.assign(env, { HOME: home, OATS_HOME_DIR: join(home, ".oats"), OATS_PACKAGE_CATALOG: catalog, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin` });
  const cli = (...argv) => spawnSync(process.execPath, [CLI, ...argv, "--dir", scope, "--json"], { encoding: "utf8", env, cwd: scope });
  const lock = () => JSON.parse(readFileSync(join(scope, OATS_LOCK_FILE), "utf8"));
  return { base, repo, scope, cli, lock, npmLog };
}
const doc = (r) => { try { return JSON.parse(r.stdout); } catch { throw new Error(`no JSON envelope: ${r.stdout}\n${r.stderr}`); } };

test("oats update moves a pinned catalog selector only when told to, by spec or by --to", () => {
  const f = fixture();
  let r = f.cli("install", "x.p@v1");
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(f.lock().packages["x.p"].source, "catalog:x.p@v1");
  r = f.cli("trust", "x.a"); assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(f.lock().capabilities["x.a"].trusted, true);
  // Plain update keeps the explicit selector.
  r = f.cli("update", "x.p"); assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(doc(r).result.changed, false); assert.equal(f.lock().packages["x.p"].source, "catalog:x.p@v1");
  // The engine's spec form moves it: new artifact, approval invalidated.
  r = f.cli("update", "x.p", "x.p@v2"); assert.equal(r.status, 0, r.stderr + r.stdout);
  const moved = doc(r).result;
  assert.equal(moved.changed, true); assert.equal(moved.after.source, "catalog:x.p@v2"); assert.equal(moved.after.version, "2.0.0");
  assert.equal(f.lock().packages["x.p"].source, "catalog:x.p@v2");
  assert.equal(f.lock().capabilities["x.a"].trusted, false, "a changed artifact loses approval");
  r = f.cli("trust", "x.a"); assert.equal(r.status, 0, r.stderr + r.stdout);
  // --to moves it back.
  r = f.cli("update", "x.p", "--to", "v1"); assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(doc(r).result.after.source, "catalog:x.p@v1"); assert.equal(doc(r).result.after.version, "1.0.0");
  // Refusals, each before any change.
  r = f.cli("update", "x.p", "--to"); assert.equal(doc(r).error?.code, "E_BAD_ARGS", r.stdout);
  r = f.cli("update", "x.p", "x.p@v2", "--to", "v2"); assert.equal(doc(r).error?.code, "E_BAD_ARGS", r.stdout);
  r = f.cli("update", "x.p", "x.other@v2"); assert.equal(doc(r).error?.code, "invalid-source", r.stdout);
  assert.equal(f.lock().packages["x.p"].source, "catalog:x.p@v1", "refusals change nothing");
  // No package: refused before the kernel self-update, which never runs npm.
  r = f.cli("update", "--to", "v2"); assert.equal(doc(r).error?.code, "E_BAD_ARGS", r.stdout);
  assert.match(doc(r).error.message, /needs a package/);
  assert.equal(existsSync(f.npmLog), false, "the kernel self-update (npm) was never invoked");
});
