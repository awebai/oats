// A macOS host reached without a terminal (an ssh command, a background job) cannot open the
// login keychain, where git's credential helper usually keeps the forge token: the remote read
// fails as `auth` and nothing says why. The kernel names that case (details.hint) and its
// remedies, and never touches credentials itself (lib/remote.mjs keychainHint).

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { linkExecutables } from "./helpers/host-fixture.mjs";
import { keychainHint, KEYCHAIN_REMEDY, observeRemote } from "../lib/remote.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);

test("keychainHint: only darwin, only a non-interactive session, only an auth failure", () => {
  const session = (over = {}) => ({ platform: "darwin", stdinIsTTY: true, env: {}, reason: "auth", ...over });
  // Non-interactive: no TTY on stdin, or an ssh session (SSH_CONNECTION) whatever stdin is.
  assert.equal(keychainHint(session({ stdinIsTTY: false })), "keychain-non-interactive");
  assert.equal(keychainHint(session({ env: { SSH_CONNECTION: "10.0.0.2 51000 10.0.0.3 22" } })), "keychain-non-interactive");
  assert.equal(keychainHint(session({ stdinIsTTY: undefined })), "keychain-non-interactive", "an absent isTTY is no terminal");
  // An interactive macOS terminal can unlock its keychain: no hint.
  assert.equal(keychainHint(session()), null);
  assert.equal(keychainHint(session({ env: { SSH_CONNECTION: "" } })), null, "an empty SSH_CONNECTION is not a session");
  // Other platforms keep their credentials elsewhere (out of scope): no hint.
  for (const platform of ["linux", "win32", "freebsd"]) assert.equal(keychainHint(session({ platform, stdinIsTTY: false })), null, platform);
  // Only an auth failure: a missing repository or a dead network is not about credentials.
  for (const reason of ["not-found", "network", "timeout", "unknown", "cache"]) assert.equal(keychainHint(session({ reason, stdinIsTTY: false })), null, reason);
});

test("KEYCHAIN_REMEDY names both ways out and no secret", () => {
  assert.match(KEYCHAIN_REMEDY, /gh auth login --insecure-storage/);
  assert.match(KEYCHAIN_REMEDY, /gh auth setup-git/);
  assert.match(KEYCHAIN_REMEDY, /SSH key/);
});

/** A PATH with a git that fails every network read as a forge does when no credential reaches it. */
function authFailingGit(base) {
  const bin = join(base, "bin");
  linkExecutables(bin, ["node", "sh"]);
  writeFileSync(join(bin, "git"), `#!/bin/sh
case "$1" in --version|version) echo "git version 2.50.0"; exit 0;; esac
echo "fatal: could not read Username for 'https://github.com': terminal prompts disabled" >&2
exit 128
`);
  chmodSync(join(bin, "git"), 0o755);
  return bin;
}

test("E_REMOTE_UNREADABLE (auth) carries the hint and the remedies exactly when this session qualifies", async () => {
  const base = mkdtempSync(join(tmpdir(), "oats-keychain-"));
  const prevPath = process.env.PATH, prevSsh = process.env.SSH_CONNECTION;
  try {
    process.env.PATH = authFailingGit(base);
    process.env.SSH_CONNECTION = "10.0.0.2 51000 10.0.0.3 22";
    const cacheDir = join(base, "cache"); mkdirSync(cacheDir);
    const e = await observeRemote("https://github.com/acme/private-workspace", { cacheDir }).then(() => null, (err) => err);
    assert.ok(e, "the read fails");
    assert.equal(e.code, "E_REMOTE_UNREADABLE");
    assert.equal(e.details.reason, "auth");
    if (process.platform === "darwin") {
      assert.equal(e.details.hint, "keychain-non-interactive");
      assert.equal(e.details.remedy, KEYCHAIN_REMEDY);
      assert.ok(e.message.includes(KEYCHAIN_REMEDY), e.message);
    } else {
      assert.equal(e.details.hint, undefined, "the hint is darwin-only");
      assert.equal(e.message.includes("keychain"), false);
    }
  } finally {
    process.env.PATH = prevPath;
    if (prevSsh === undefined) delete process.env.SSH_CONNECTION; else process.env.SSH_CONNECTION = prevSsh;
    rmSync(base, { recursive: true, force: true });
  }
});
