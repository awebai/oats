// Which kernel the bridge loads (awebai/oats#1604). Inside an instance it is the
// kernel that launched the home, through the home's shim, whatever PATH pi has;
// outside one it is OATS_PKG_ROOT, an `oats` on PATH that links into a kernel
// package, or the global npm package, and otherwise an error naming those three.
// Each case loads core-loader.mjs in a node of its own, with an environment
// built from nothing: its own HOME, pi folder and npm prefix, and a PATH of one
// fixture directory (node, and the case's `oats`), so no global install, no
// `oats` and no instance of the host that runs the suite can answer.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const LOADER = new URL("../extension/core-loader.mjs", import.meta.url).href;
const REPO_ROOT = realpathSync(fileURLToPath(new URL("../../../", import.meta.url)));

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-pi-loader-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const bin = join(base, "bin");
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, "node"));
  for (const d of ["home", "pi-agent", "npm-prefix"]) mkdirSync(join(base, d));
  return { base, bin };
}
/** A kernel package of its own: the name and lib/core.mjs the loader checks for, and the two exports it reads. */
function fakeKernel(base, name) {
  const root = join(base, name);
  mkdirSync(join(root, "lib"), { recursive: true });
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@awebai/oats", version: "0.0.0-fixture" }));
  writeFileSync(join(root, "lib", "core.mjs"), `export const appendLogEntry = () => {};\nexport const PACKAGED_SKILLS_DIR = ${JSON.stringify(name)};\n`);
  writeFileSync(join(root, "bin", "oats.mjs"), "#!/usr/bin/env node\n", { mode: 0o755 });
  return root;
}
/** An instance home whose shim links to `target` (the kernel's bin/oats.mjs), as the kernel writes it at launch. */
function instanceHome(base, target) {
  const home = join(base, "instance");
  mkdirSync(join(home, ".oats", "bin"), { recursive: true });
  if (target) symlinkSync(target, join(home, ".oats", "bin", "oats"));
  return home;
}
function load(fx, extra = {}) {
  const env = { PATH: fx.bin, HOME: join(fx.base, "home"), PI_CODING_AGENT_DIR: join(fx.base, "pi-agent"),
    NPM_CONFIG_PREFIX: join(fx.base, "npm-prefix"), npm_config_prefix: join(fx.base, "npm-prefix"), ...extra };
  const script = `const m = await import(${JSON.stringify(LOADER)}); console.log(JSON.stringify({ root: m.OATS_PKG_ROOT }));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: fx.base, env, encoding: "utf8", timeout: 60000 });
  return { ...r, root: r.status === 0 ? JSON.parse(r.stdout.trim().split("\n").pop()).root : undefined };
}

test("an instance home loads the kernel that launched it with no oats on PATH and no global install", (t) => {
  const fx = fixture(t);
  const home = instanceHome(fx.base, join(REPO_ROOT, "bin", "oats.mjs"));
  const r = load(fx, { OATS_INSTANCE_HOME: home });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.root, REPO_ROOT);
});

test("the home's shim comes before an oats on PATH", (t) => {
  const fx = fixture(t);
  const launching = fakeKernel(fx.base, "launching"), other = fakeKernel(fx.base, "other");
  symlinkSync(join(other, "bin", "oats.mjs"), join(fx.bin, "oats"));
  const r = load(fx, { OATS_INSTANCE_HOME: instanceHome(fx.base, join(launching, "bin", "oats.mjs")) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.root, launching);
});

test("OATS_PKG_ROOT still comes first, before the home's shim", (t) => {
  const fx = fixture(t);
  const chosen = fakeKernel(fx.base, "chosen"), launching = fakeKernel(fx.base, "launching");
  const r = load(fx, { OATS_PKG_ROOT: chosen, OATS_INSTANCE_HOME: instanceHome(fx.base, join(launching, "bin", "oats.mjs")) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.root, chosen);
});

test("a home with no shim, a shim that is not a link, or a link to no kernel falls through to PATH", async (t) => {
  for (const [name, make] of [
    ["no shim", (base) => instanceHome(base)],
    ["a file", (base) => { const h = instanceHome(base); writeFileSync(join(h, ".oats", "bin", "oats"), "#!/bin/sh\n"); return h; }],
    ["a dangling link", (base) => instanceHome(base, join(base, "gone", "bin", "oats.mjs"))],
    ["a link to no kernel", (base) => { mkdirSync(join(base, "plain")); writeFileSync(join(base, "plain", "oats"), ""); return instanceHome(base, join(base, "plain", "oats")); }],
  ]) {
    await t.test(name, (t) => {
      const fx = fixture(t);
      const onPath = fakeKernel(fx.base, "on-path");
      symlinkSync(join(onPath, "bin", "oats.mjs"), join(fx.bin, "oats"));
      const r = load(fx, { OATS_INSTANCE_HOME: make(fx.base) });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.root, onPath);
    });
  }
});

test("outside an instance, an oats on PATH that links into a kernel package is found", (t) => {
  const fx = fixture(t);
  const kernel = fakeKernel(fx.base, "linked");
  symlinkSync(join(kernel, "bin", "oats.mjs"), join(fx.bin, "oats"));
  const r = load(fx);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.root, kernel);
});

test("outside an instance, an oats script that runs a kernel is not followed, and the error names the three ways out", (t) => {
  const fx = fixture(t);
  const kernel = fakeKernel(fx.base, "wrapped");
  writeFileSync(join(fx.bin, "oats"), `#!/bin/sh\nexec node ${JSON.stringify(join(kernel, "bin", "oats.mjs"))} "$@"\n`);
  chmodSync(join(fx.bin, "oats"), 0o755);
  const r = load(fx);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /OATS kernel not found\. In an OATS instance the bridge uses the kernel that launched it; elsewhere it needs one of:/);
  assert.match(r.stderr, /npm install -g @awebai\/oats/);
  assert.match(r.stderr, /an `oats` on PATH that links to the kernel's bin\/oats\.mjs \(npm link, in a checkout\); a script that runs it is not followed/);
  assert.match(r.stderr, /OATS_PKG_ROOT=<the kernel's package directory/);
});
