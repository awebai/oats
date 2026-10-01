// The instance home a capability command finds from its working directory when the harness
// stripped the session env (#342): the directory the shell names, so an attached instance's
// work/ (a symlink into its owner's tree) keeps the instance it belongs to.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { enclosingInstanceHome } from "../lib/core.mjs";

const CORE = new URL("../lib/core.mjs", import.meta.url).href;
const home = (root, agent, name) => { const d = join(root, "agents", agent, "instances", name); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "instance.json"), JSON.stringify({ instance: name })); return d; };

test("enclosingInstanceHome: the nearest <agents-root>/<agent>/instances/<name> recording that name", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "enclosing-"))); t.after(() => rmSync(root, { recursive: true, force: true }));
  const owner = home(root, "dev", "owner-1");
  mkdirSync(join(owner, "work", "sub"), { recursive: true });
  assert.equal(enclosingInstanceHome(owner), owner);
  assert.equal(enclosingInstanceHome(join(owner, "work", "sub")), owner);
  assert.equal(enclosingInstanceHome(root), undefined);
  const misnamed = join(root, "agents", "dev", "instances", "other"); mkdirSync(misnamed);
  writeFileSync(join(misnamed, "instance.json"), JSON.stringify({ instance: "owner-1" }));
  assert.equal(enclosingInstanceHome(misnamed), undefined, "an instance.json naming another instance is not a home");
});

test("a capability command below an attached instance's work/ resolves that instance, not the work tree's owner", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "enclosing-"))); t.after(() => rmSync(root, { recursive: true, force: true }));
  const owner = home(root, "dev", "owner-1"), mine = home(root, "dev", "mine-1");
  mkdirSync(join(owner, "work", "sub"), { recursive: true });
  symlinkSync(join(owner, "work"), join(mine, "work"));
  const logical = join(mine, "work", "sub");
  // As a shell runs it: the process cwd is the physical directory, PWD the path the shell took.
  const run = (env) => spawnSync(process.execPath, ["--input-type=module", "-e", `import { enclosingInstanceHome, logicalCwd } from ${JSON.stringify(CORE)}; console.log(enclosingInstanceHome(logicalCwd()));`], { cwd: logical, env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
  let r = run({ PWD: logical });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), mine);
  // A PWD naming another directory is stale (not the cwd): the physical directory decides.
  r = run({ PWD: join(mine, "work") });
  assert.equal(r.stdout.trim(), owner);
  r = run({});
  assert.equal(r.stdout.trim(), owner);
});
