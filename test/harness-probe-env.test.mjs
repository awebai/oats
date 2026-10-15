// The Claude package probe's environment (#1246): `claude plugin list --json` runs with
// DISABLE_TELEMETRY=1 added for its own run (Claude then skips its telemetry flush at exit), and
// with every other name exactly as the gate gave it: PATH, HOME and CLAUDE_CONFIG_DIR, which select
// the account it reads, included. The caller's environment object is not changed.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HARNESS_PACKAGE_MANAGERS } from "../lib/core.mjs";

test("the Claude plugin listing runs with DISABLE_TELEMETRY=1 added and every other name as given (#1246)", (t) => {
  const base = mkdtempSync(join(tmpdir(), "oats-probe-env-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  // A claude that records its argv and environment, and lists one user-scope plugin.
  const claude = join(base, "claude"), log = join(base, "probe.json");
  writeFileSync(claude, `#!${process.execPath}
require("node:fs").writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), env: process.env }));
process.stdout.write(JSON.stringify([{ id: "chat@acme-market", scope: "user", enabled: true }]));
`);
  chmodSync(claude, 0o755);
  const env = { PATH: "/fixture/bin:/usr/bin", HOME: join(base, "home"), CLAUDE_CONFIG_DIR: join(base, "account"), LANG: "C.UTF-8", OTHER: "kept" };
  const given = structuredClone(env);
  const rows = HARNESS_PACKAGE_MANAGERS.claude.list(env, { bin: claude });
  assert.deepEqual(rows.map((r) => r.source), ["chat@acme-market"], "the answer is read as before");
  const probe = JSON.parse(readFileSync(log, "utf8"));
  assert.deepEqual(probe.argv, ["plugin", "list", "--json"]);
  assert.deepEqual(probe.env, { ...given, DISABLE_TELEMETRY: "1" }, "one name added, nothing else changed");
  assert.deepEqual(env, given, "the caller's environment is not changed");
  // A value the gate was given is replaced for this run only.
  HARNESS_PACKAGE_MANAGERS.claude.list({ ...env, DISABLE_TELEMETRY: "0" }, { bin: claude });
  assert.equal(JSON.parse(readFileSync(log, "utf8")).env.DISABLE_TELEMETRY, "1");
});
