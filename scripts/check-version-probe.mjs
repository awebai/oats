import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Check required features without rejecting additive probe fields or features.
export function checkVersionProbe(probe, version) {
  for (const [key, value] of Object.entries({ schemaVersion: 1, name: "@awebai/oats", version, desktopApi: 1 })) {
    assert.equal(probe[key], value, `version --json probe mismatch: ${key}`);
  }
  for (const [key, values] of Object.entries({
    runtimes: ["pi", "claude", "codex"], sessionBackends: ["tmux", "herdr"],
    launchOptions: ["yolo"], remote: ["spawn", "retire", "status", "session", "roster", "harvest"],
  })) {
    assert.ok(Array.isArray(probe[key]), `version --json probe mismatch: ${key}`);
    for (const value of values) assert.ok(probe[key].includes(value), `version --json probe mismatch: ${key}.${value}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  assert.ok(version, "usage: node scripts/check-version-probe.mjs VERSION");
  const probe = JSON.parse(execFileSync(process.execPath, ["bin/oats.mjs", "version", "--json"], { encoding: "utf8" }));
  checkVersionProbe(probe, version);
  console.log(`version --json probe ok: ${JSON.stringify(probe)}`);
}
