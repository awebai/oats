import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkVersionProbe } from "../scripts/check-version-probe.mjs";

const root = new URL("../", import.meta.url);
const version = JSON.parse(readFileSync(new URL("package.json", root))).version;
const probe = JSON.parse(execFileSync(process.execPath, ["bin/oats.mjs", "version", "--json"], { cwd: root, encoding: "utf8" }));

test("release probe accepts the real CLI and additive capabilities", () => {
  checkVersionProbe(probe, version);
  checkVersionProbe({ ...probe, futureField: true, runtimes: [...probe.runtimes, "future"] }, version);
});

test("release probe rejects the wrong release or missing required capabilities", () => {
  assert.throws(() => checkVersionProbe(probe, "wrong"), /probe mismatch: version/);
  for (const key of ["schemaVersion", "name", "desktopApi", "runtimes", "sessionBackends", "launchOptions", "remote"]) {
    const missing = { ...probe };
    delete missing[key];
    assert.throws(() => checkVersionProbe(missing, version), /probe mismatch/);
  }
  assert.throws(() => checkVersionProbe({ ...probe, runtimes: ["pi", "claude"] }, version), /runtimes.codex/);
});

test("both release lanes execute the shared probe check", () => {
  for (const path of ["scripts/release-lane.mjs", ".github/workflows/release.yml"]) {
    assert.match(readFileSync(new URL(path, root), "utf8"), /scripts\/check-version-probe\.mjs/);
  }
});
