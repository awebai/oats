import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { RUNTIME_STUBS, inertHarnessDir } from "./helpers/runtime-stub.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

// The inert stub lets fixtures spawn without a real harness installed; it must
// not hide the kernel's refusal. With no launch executable resolvable, a
// `--no-launch` spawn is still refused before anything is created.
for (const harness of RUNTIME_STUBS) {
  test(`spawn --no-launch without a ${harness} executable is refused with nothing created; the inert stub is the only difference`, t => {
    const fx = v2Deployment();
    t.after(() => fx.cleanup());
    // Minimal PATH: node and git alone (discovery reads the workspace over git).
    // Not process.execPath's own directory, which often holds globally
    // installed harnesses (nvm puts `pi` and `claude` there).
    const minimal = join(fx.base, "node-only"); mkdirSync(minimal);
    symlinkSync(process.execPath, join(minimal, "node"));
    symlinkSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim(), join(minimal, "git"));
    const spawn = (PATH, purpose) => fx.cli(["spawn", "dev", "--purpose", purpose, "--harness", harness, "--no-launch", "--json"], { env: { PATH } }).json();
    const instances = () => existsSync(join(fx.root, "dev", "instances")) ? readdirSync(join(fx.root, "dev", "instances")).filter(n => !n.startsWith(".")) : [];

    const refused = spawn(minimal, "bare");
    assert.equal(refused.ok, false, JSON.stringify(refused));
    assert.match(refused.error.message, new RegExp(`^${harness} binary not found on PATH`));
    assert.deepEqual(instances(), [], "a refused spawn creates no home");

    const stubbed = spawn(`${inertHarnessDir(fx.base)}:${minimal}`, "stubbed");
    assert.equal(stubbed.ok, true, JSON.stringify(stubbed));
    assert.deepEqual(instances(), ["dev-stubbed"]);
  });
}
