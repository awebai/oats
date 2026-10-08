// Fixture 13 on another host (awebai/oats#799): the recordings must hold byte for byte whatever the
// machine's environment is, because the fixture runs from an explicit environment of its own
// (trigger-pipeline-fixture.test.mjs, `isolate`). This runs that whole fixture in a child whose
// environment is a different machine's: another HOME, XDG base directories (CI's runner sets
// XDG_CONFIG_HOME), TMPDIR, user bus, gh configuration and token, OATS variables, Git repository
// selectors (a hook or wrapper may export them) and locale, and a
// PATH whose `systemctl` reports the host timer active and whose `gh` fails. Any of it reaching a
// recording fails the child.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "trigger-pipeline-fixture.test.mjs");

test("13 on another host: the recordings hold byte for byte under a foreign environment", (t) => {
  const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "oats-elsewhere-")));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  const bin = join(elsewhere, "bin");
  for (const d of [bin, join(elsewhere, "tmp"), join(elsewhere, "home"), join(elsewhere, ".config")]) mkdirSync(d, { recursive: true });
  // This host's timer is active and its gh is broken: the fixture's own fakes must answer instead.
  const fake = { systemctl: "echo active\nexit 0", launchctl: "echo loaded\nexit 0", gh: "echo 'host gh must not run' >&2\nexit 7" };
  for (const [name, body] of Object.entries(fake)) { writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755); }
  const env = { ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    HOME: join(elsewhere, "home"),
    XDG_CONFIG_HOME: join(elsewhere, ".config"), XDG_CACHE_HOME: join(elsewhere, ".cache"), XDG_DATA_HOME: join(elsewhere, ".local", "share"),
    XDG_STATE_HOME: join(elsewhere, ".local", "state"), XDG_RUNTIME_DIR: join(elsewhere, "run"), DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(elsewhere, "bus")}`,
    TMPDIR: join(elsewhere, "tmp"),
    GH_CONFIG_DIR: join(elsewhere, "gh"), GH_TOKEN: "not-a-token", GH_HOST: "github.example.invalid",
    GIT_DIR: join(elsewhere, "no-such.git"), GIT_WORK_TREE: join(elsewhere, "no-such-tree"), GIT_INDEX_FILE: join(elsewhere, "no-such-index"),
    GIT_OBJECT_DIRECTORY: join(elsewhere, "no-such-objects"),
    OATS_HOME_DIR: join(elsewhere, "oats-home"), OATS_REMOTE_CACHE: join(elsewhere, "cache"), OATS_PACKAGE_CATALOG: join(elsewhere, "catalog"),
    LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8" };
  // The child compares against the recordings (never records) and runs as a standalone test run.
  delete env.OATS_RECORD_TRIGGER_FIXTURE;
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", FIXTURE], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, `fixture 13 differs on another host:\n${r.stdout}\n${r.stderr}`);
  const count = (what) => Number(r.stdout.match(new RegExp(`^# ${what} (\\d+)$`, "m"))?.[1]);
  assert.ok(count("tests") > 1, `the child ran fixture 13's scenarios:\n${r.stdout}`);
  assert.equal(count("pass"), count("tests"), `every scenario passed on another host:\n${r.stdout}`);
});
