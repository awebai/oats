// An ssh:// reference with a user and no password (ssh://user@host:port/path) is a repo ref in every
// file that holds one, as parseRepoRef already reads it and as git@host:path always was (k1, awebai/oats#1665).
// The user part excludes `@ / :` and the host and path exclude `@`, so in a pinned source the last `@`
// is always the pin. A password, an empty user and a second user stay refused, and no refusal prints a password.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocal, validateLocal, validateMembership, validateWorkspace } from "../lib/workspace.mjs";

const PIN = "0123456789abcdef0123456789abcdef01234567";
const PASSWORD = "K1_PASSWORD_TOKEN";
const ref = "ssh://tester@10.0.2.2:2222/srv/notes.git";
const refused = [`ssh://tester:${PASSWORD}@10.0.2.2/srv/notes.git`, `ssh://tester%3A${PASSWORD}@10.0.2.2/srv/notes.git`, "ssh://@10.0.2.2/srv/notes.git", "ssh://a@b@10.0.2.2/srv/notes.git", "ssh://-oProxyCommand=x@10.0.2.2/srv/notes.git"];

const files = {
  "oats-local.yaml workspace": (r) => validateLocal({ schemaVersion: 2, workspace: r }),
  "oats-local.yaml standalone": (r) => validateLocal({ schemaVersion: 2, workspace: "git:github.com/acme/acme-oats", standalone: r }),
  "oats-membership.yaml workspace": (r) => validateMembership({ schemaVersion: 2, workspace: r }),
  "oats-workspace.yaml members": (r) => validateWorkspace({ schemaVersion: 2, name: "fixture", members: [r] }),
  "oats-workspace.yaml stores": (r) => validateWorkspace({ schemaVersion: 2, name: "fixture", members: [], stores: { notes: r } }),
};
const pinned = (source) => validateWorkspace({ schemaVersion: 2, name: "fixture", members: [], external: [{ source, soul: "souls/x" }] });

test("an ssh:// user without a password is accepted wherever a repo ref is", () => {
  for (const [file, validate] of Object.entries(files)) assert.deepEqual(validate(ref), [], file);
  assert.deepEqual(pinned(`${ref}@${PIN}`), [], "the pinned form reads its last @ as the pin");
});

test("a repo ref with no revision still refuses a pin", () => {
  for (const [file, validate] of Object.entries(files)) assert.ok(validate(`${ref}@${PIN}`).length > 0, file);
});

test("a password, an empty user and a second user stay refused, pinned or not, and no refusal prints the password", () => {
  for (const bad of refused) {
    for (const [file, validate] of Object.entries(files)) {
      const problems = validate(bad);
      assert.ok(problems.length > 0, `${file}: ${bad}`);
      assert.ok(!JSON.stringify(problems).includes(PASSWORD), `${file} prints no password`);
    }
    const problems = pinned(`${bad}@${PIN}`);
    assert.ok(problems.some((p) => p.path === "/external/0/source"), `pinned: ${bad}`);
    assert.ok(!JSON.stringify(problems).includes(PASSWORD), "a pinned refusal prints no password");
  }
});

test("oats-local.yaml with an ssh:// user loads", () => {
  const dir = mkdtempSync(join(tmpdir(), "oats-ssh-user-"));
  writeFileSync(join(dir, "oats-local.yaml"), JSON.stringify({ schemaVersion: 2, workspace: ref }));
  try { assert.equal(loadLocal(dir).local.workspace, ref); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
