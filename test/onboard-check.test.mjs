// `oats onboard <dir> --workspace <ref> --check --json` (awebai/oats#517): the
// read-only form `server connect` asks a host before it onboards there, and
// `server check` asks of a registered deployment. It writes nothing; it answers
// where <dir> is (a leading ~ is this machine's home), what is there, and
// whether this machine's git can read the workspace remote.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { linkExecutables } from "./helpers/host-fixture.mjs";
import { v2Deployment, CLI } from "./helpers/v2-deployment.mjs";
import { KEYCHAIN_REMEDY } from "../lib/remote.mjs";

const fx = v2Deployment();
test.after(() => fx.cleanup());
const check = (args, { env = {}, cwd = fx.base } = {}) => fx.cli(["onboard", ...args, "--check", "--json"], { cwd, env });

test("a fresh directory: absent, and the workspace remote readable; nothing is written", () => {
  const dir = join(fx.base, "fresh", "deployment");
  const r = check([dir, "--workspace", fx.ref]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const res = r.json().result;
  assert.equal(res.dir, dir);
  assert.equal(res.state, "absent");
  assert.deepEqual(res.workspace, { ref: fx.ref, key: fx.key });
  assert.equal(res.remote.readable, true);
  assert.match(res.remote.commit, /^[0-9a-f]{40}$/);
  assert.equal(existsSync(join(fx.base, "fresh")), false, "read-only: nothing created");
});

test("an empty directory, a non-empty one, and a file are told apart", () => {
  const empty = join(fx.base, "empty"); mkdirSync(empty);
  const full = join(fx.base, "full"); mkdirSync(full); writeFileSync(join(full, "notes.txt"), "mine\n");
  const file = join(fx.base, "a-file"); writeFileSync(file, "x");
  assert.equal(check([empty, "--workspace", fx.ref]).json().result.state, "empty");
  assert.equal(check([full, "--workspace", fx.ref]).json().result.state, "not-empty");
  assert.equal(check([file, "--workspace", fx.ref]).json().result.state, "not-a-directory");
  assert.deepEqual(readdirSync(empty), [], "still empty");
  assert.deepEqual(readdirSync(full), ["notes.txt"]);
});

test("a deployment: its own workspace is read when --workspace is not given", () => {
  const r = check([fx.dep]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const res = r.json().result;
  assert.equal(res.state, "deployment");
  assert.deepEqual(res.workspace, { ref: fx.ref, key: fx.key });
  assert.equal(res.remote.readable, true);
  // Not a deployment and no --workspace: nothing to read.
  const bad = check([join(fx.base, "nowhere")]);
  assert.equal(bad.status, 1);
  assert.equal(bad.json().error.code, "E_BAD_ARGS");
});

test("a leading ~ is this machine's home", () => {
  const home = fx.env.HOME;
  let r = check(["~/Agents/acme", "--workspace", fx.ref]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.json().result.dir, join(home, "Agents", "acme"));
  r = check(["--dir", "~", "--workspace", fx.ref]);
  assert.equal(r.json().result.dir, home);
});

test("an unreadable remote is an answer, not a failure: readable false with the error", () => {
  const r = check([join(fx.base, "x"), "--workspace", `file://${join(fx.base, "remotes", "missing.git")}`]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const remote = r.json().result.remote;
  assert.equal(remote.readable, false);
  assert.equal(remote.error.code, "E_REMOTE_UNREADABLE");
  assert.equal(remote.error.reason, "not-found");
  assert.equal(typeof remote.error.message, "string");
});

test("an auth failure over ssh on macOS carries the keychain hint and remedy", () => {
  const bin = join(fx.base, "authbin");
  linkExecutables(bin, ["node", "sh"]);
  writeFileSync(join(bin, "git"), `#!/bin/sh
case "$1" in --version|version) echo "git version 2.50.0"; exit 0;; esac
echo "fatal: could not read Username for 'https://github.com': terminal prompts disabled" >&2
exit 128
`);
  chmodSync(join(bin, "git"), 0o755);
  const r = check([join(fx.base, "y"), "--workspace", "https://github.com/acme/private-workspace"], { env: { PATH: bin, SSH_CONNECTION: "10.0.0.2 51000 10.0.0.3 22" } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const { error } = r.json().result.remote;
  assert.equal(error.reason, "auth");
  if (process.platform === "darwin") { assert.equal(error.hint, "keychain-non-interactive"); assert.equal(error.remedy, KEYCHAIN_REMEDY); }
  else assert.equal(error.hint, undefined);
});

test("--check outside a deployment and without --workspace has nothing to read", () => {
  const r = fx.cli(["onboard", "--check", "--json"], { cwd: fx.base });
  assert.equal(r.status, 1);
  assert.equal(r.json().error.code, "E_BAD_ARGS");
  assert.match(r.json().error.message, /--workspace <repo ref>/);
});
