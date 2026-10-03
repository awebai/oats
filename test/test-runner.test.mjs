import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DESKTOP_TEST_DEPS } from "../scripts/desktop-test-deps.mjs";

for (const desktopInstalled of [false, true]) {
  test(`root runner selects ${desktopInstalled ? "Desktop and integration coverage" : "root-only coverage with an explicit omission notice"}`, () => {
    const root = mkdtempSync(join(tmpdir(), "oats-test-runner-"));
    try {
      mkdirSync(join(root, "scripts"));
      for (const name of ["run-tests.mjs", "desktop-test-deps.mjs"]) {
        cpSync(new URL(`../scripts/${name}`, import.meta.url), join(root, "scripts", name));
      }
      for (const name of ["desktop", "pi", "record"]) mkdirSync(join(root, "packages", name), { recursive: true });
      if (desktopInstalled) {
        for (const name of DESKTOP_TEST_DEPS) {
          const dir = join(root, "packages", "desktop", "node_modules", name);
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, "package.json"), "{}");
        }
      }
      // Intercept only the final child launch: exercise the real dependency
      // detector and argument construction without running another test suite.
      const preload = join(root, "capture.mjs");
      writeFileSync(preload, `import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
childProcess.spawnSync = (bin, args, options) => {
  console.log("RUNNER_CALL=" + JSON.stringify({bin, args, options}));
  return {status: 23};
};
syncBuiltinESMExports();\n`);
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const result = spawnSync(process.execPath, ["--import", preload, join(root, "scripts", "run-tests.mjs"),
        "--test-shard=2/6", "--test-name-pattern=roundtrip", "test/selected.test.mjs"], { encoding: "utf8", env });
      assert.equal(result.status, 23, result.stderr);
      const calls = result.stdout.split("\n").filter(line => line.startsWith("RUNNER_CALL="));
      assert.equal(calls.length, 1);
      const call = JSON.parse(calls[0].slice("RUNNER_CALL=".length));
      assert.equal(call.bin, process.execPath);
      assert.deepEqual(call.args, ["--test", "--test-shard=2/6", "--test-name-pattern=roundtrip",
        "test/**/*.test.mjs", "tests/**/*.test.mjs", "capabilities/**/*.test.mjs",
        ...(desktopInstalled ? ["packages/**/*.test.mjs", "test/desktop-schedule-roundtrip.integration.mjs"]
          : ["packages/pi/**/*.test.mjs", "packages/record/**/*.test.mjs"]),
        "test/selected.test.mjs"]);
      assert.equal(realpathSync(call.options.cwd), realpathSync(root));
      assert.equal(call.options.stdio, "inherit");
      if (desktopInstalled) {
        assert.doesNotMatch(result.stdout, /SKIPPED/);
      } else {
        assert.equal(result.stdout.match(/Desktop suites and root\/Desktop integration coverage were SKIPPED/g)?.length, 2);
        assert.equal(result.stdout.split("Root integration omitted: test/desktop-schedule-roundtrip.integration.mjs").length - 1, 2);
        assert.match(result.stdout, /cd packages\/desktop && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci/);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
