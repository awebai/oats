import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_STUBS, inertRuntimeDir } from "./helpers/runtime-stub.mjs";

const CLI = fileURLToPath(new URL("../bin/oats.mjs", import.meta.url));

// The inert stub lets fixtures spawn without a real harness installed; it must
// not hide the kernel's refusal. With no launch executable resolvable, a
// `--no-launch` spawn is still refused before anything is created.
for (const runtime of RUNTIME_STUBS) {
  test(`spawn --no-launch without a ${runtime} executable is refused with nothing created; the inert stub is the only difference`, t => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-runtime-stub-")));
    t.after(() => rmSync(base, { recursive: true, force: true }));
    const context = join(base, "project"), soul = join(context, "agents", "dev", "soul"), user = join(base, "user");
    for (const dir of [soul, user]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(context, "oats-config.yaml"), "capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n");
    writeFileSync(join(soul, "soul.yaml"), `name: dev\nwork: directory\nruntime: ${runtime}\n`);
    writeFileSync(join(soul, "AGENTS.md"), "# dev\n");
    // Minimal PATH: node alone. Not process.execPath's own directory, which
    // often holds globally installed harnesses (nvm puts `pi` and `claude` there).
    const minimal = join(base, "node-only"); mkdirSync(minimal);
    symlinkSync(process.execPath, join(minimal, "node"));
    const spawn = (PATH, purpose) => {
      const r = spawnSync(process.execPath, [CLI, "spawn", "dev", "--purpose", purpose, "--no-launch", "--json"], {
        cwd: context, encoding: "utf8",
        env: { PATH, HOME: user, OATS_HOME_DIR: join(base, "store"), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      });
      return JSON.parse(r.stdout.trim().split("\n").pop());
    };
    const instances = () => existsSync(join(context, "agents", "dev", "instances")) ? readdirSync(join(context, "agents", "dev", "instances")).filter(n => !n.startsWith(".")) : [];

    const refused = spawn(minimal, "bare");
    assert.equal(refused.ok, false, JSON.stringify(refused));
    assert.match(refused.error.message, new RegExp(`^${runtime} binary not found on PATH`));
    assert.deepEqual(instances(), [], "a refused spawn creates no home");

    const stubbed = spawn(`${inertRuntimeDir(base)}:${minimal}`, "stubbed");
    assert.equal(stubbed.ok, true, JSON.stringify(stubbed));
    assert.deepEqual(instances(), ["dev-stubbed"]);
  });
}
