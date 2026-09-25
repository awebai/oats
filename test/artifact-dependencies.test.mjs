import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CORE = new URL("../lib/core.mjs", import.meta.url).href;
const V2 = new URL("./helpers/v2-deployment.mjs", import.meta.url).href;
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-artifact-foundation-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  for (const dir of ["user", "bin", "state"]) mkdirSync(join(base, dir));
  symlinkSync(process.execPath, join(base, "bin/node"));
  // No ambient identity, credentials, config, harness, Git, or scheduler.
  const env = { HOME: join(base, "user"), OATS_HOME_DIR: join(base, "state"), PATH: join(base, "bin") };
  return { base, env };
}
function run(f, script, flags = []) {
  return execFileSync(process.execPath, [...flags, "--input-type=module", "-e", script], {
    cwd: f.base, env: f.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

test("changed core scaffold-only probe composes copied resources and retires normally without native backends", (t) => {
  const f = fixture(t);
  // A workspace deployment needs Git (the soul is fetched from its member repository).
  symlinkSync(execFileSync("/usr/bin/which", ["git"], { encoding: "utf8" }).trim(), join(f.base, "bin/git"));
  const harness = join(f.base, "bin/pi");
  // Preflight can discover this file but nothing may execute it.
  writeFileSync(harness, `#!/bin/sh\necho invoked > '${f.base}/harness-invoked'\nexit 98\n`);
  chmodSync(harness, 0o755);
  const result = run(f, `
    import assert from 'node:assert/strict';
    import { chmodSync, existsSync, lstatSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { retireInstance } from ${JSON.stringify(CORE)};
    import { v2Deployment } from ${JSON.stringify(V2)};
    const fx = v2Deployment({
      souls: { probe: { agents: '# Artifact leaf probe\\n', skills: { 'leaf-skill': { description: 'Hermetic leaf probe.', text: '# Leaf skill' } } } },
      files: { 'souls/probe/skills/leaf-skill/payload.bin': { text: Buffer.from([0, 255, 10]), mode: 0o751 } },
    });
    try {
      Object.assign(process.env, { OATS_REMOTE_CACHE: fx.env.OATS_REMOTE_CACHE });
      const spawned = await fx.spawn('probe', { purpose: 'leaf' });
      assert.equal(spawned.launched, false);
      assert.equal(spawned.work, 'directory');
      assert.equal(lstatSync(join(spawned.home, 'work')).isDirectory(), true);
      assert.equal(lstatSync(join(spawned.home, 'work')).isSymbolicLink(), false);
      assert.equal(readlinkSync(join(spawned.home, 'CLAUDE.md')), 'AGENTS.md');
      assert.equal(readlinkSync(join(spawned.home, '.claude/skills')), '../.agents/skills');
      assert.match(readFileSync(join(spawned.home, 'AGENTS.md'), 'utf8'), /Artifact leaf probe/);
      const copied = join(spawned.home, '.agents/skills/leaf-skill');
      assert.deepEqual(readFileSync(join(copied, 'payload.bin')), Buffer.from([0, 255, 10]));
      // Git records only the executable bit of a member's file (100755): it survives, exactly.
      assert.equal(lstatSync(join(copied, 'payload.bin')).mode & 0o7777, 0o755);
      // (A symlink inside a fetched soul is refused by the workspace model; the work tree's is recovered below.)
      assert.equal(JSON.parse(readFileSync(join(spawned.home, 'instance.json'))).launched, false);
      // Exercise copyTreeSafe's retirement caller too: normal verified recovery,
      // not force, keep-dir or manual removal of the scaffold.
      writeFileSync(join(spawned.home, 'work/result.bin'), Buffer.from([4, 0, 255]));
      chmodSync(join(spawned.home, 'work/result.bin'), 0o751);
      symlinkSync('result.bin', join(spawned.home, 'work/alias'));
      const retired = retireInstance(fx.root, spawned.instance);
      assert.equal(existsSync(spawned.home), false);
      assert.equal(retired.worktreeRemoved, false);
      assert.equal(retired.branchDeleted, false);
      const recovered = join(retired.workRecovery.path, 'work');
      assert.deepEqual(readFileSync(join(recovered, 'result.bin')), Buffer.from([4, 0, 255]));
      assert.equal(lstatSync(join(recovered, 'result.bin')).mode & 0o7777, 0o751);
      assert.equal(readlinkSync(join(recovered, 'alias')), 'result.bin');
      assert.equal(existsSync('harness-invoked'), false);
      console.log('scaffold inspected; normal retirement and recovery verified; no backend launched');
    } finally { fx.cleanup(); }
  `);
  assert.equal(result, "scaffold inspected; normal retirement and recovery verified; no backend launched");
});
