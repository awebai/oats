// A worktree spawn branches from the member commit it observed (awebai/oats#445), not from whatever the member
// clone has checked out: a clone that is a human's checkout or a shared reference is often far behind. The
// commit is fetched into the clone by id, and the clone's own branches and work tree are never moved.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v2Deployment, git } from "./helpers/v2-deployment.mjs";
import { cloneRemoteFor } from "../lib/instance-resolution.mjs";
import { existsSync } from "node:fs";

/** The deployment, with the remote's main one commit ahead of the member clone's local main. */
function behind(t) {
  const fx = v2Deployment({ souls: { dev: { soul: { work: "worktree" } } } });
  t.after(fx.cleanup);
  const hostPath = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = hostPath; });
  const other = mkdtempSync(join(tmpdir(), "oats-spawn-base-")); t.after(() => rmSync(other, { recursive: true, force: true }));
  git(other, "clone", "-q", fx.repo, "c");
  writeFileSync(join(other, "c", "newer.txt"), "upstream moved on\n");
  git(join(other, "c"), "add", "-A"); git(join(other, "c"), "commit", "-qm", "upstream work"); git(join(other, "c"), "push", "-q", "origin", "HEAD:main");
  const head = git(fx.repo, "rev-parse", "main");
  const local = git(fx.member, "rev-parse", "HEAD");
  assert.notEqual(local, head, "the clone's local main is behind the remote");
  // Everything of the clone's own: its refs (the spawn's new instance branch aside), HEAD and work tree.
  const cloneState = () => [git(fx.member, "for-each-ref", "--format=%(refname) %(objectname)").split("\n").filter((l) => !l.startsWith("refs/heads/agents/")), git(fx.member, "rev-parse", "HEAD"), git(fx.member, "status", "--porcelain")];
  return { fx, head, local, cloneState };
}

test("a worktree spawn branches from the observed member head, not the clone's stale local main; the clone is untouched", async (t) => {
  const { fx, head, cloneState } = behind(t);
  const before = cloneState();
  const r = await fx.spawn("dev", { instance: "dev-base", work: "worktree" });
  assert.equal(git(join(r.home, "work"), "rev-parse", "HEAD"), head, "the branch starts at the observed head");
  assert.deepEqual(r.base, { ref: fx.key, oid: head }, "the result states the base commit");
  assert.deepEqual(cloneState(), before, "the clone's refs, HEAD and work tree are exactly as they were");
});

test("the CLI says the base commit, in text and --json", (t) => {
  const { fx, head } = behind(t);
  let r = fx.cli(["spawn", "dev", "--name", "dev-text", "--no-launch"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`base: +${head.slice(0, 12)} \\(observed head of ${fx.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`));
  r = fx.cli(["spawn", "dev", "--name", "dev-json", "--no-launch", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.json().result.base, { ref: fx.key, oid: head });
});

test("a commit that cannot be fetched into the clone refuses the spawn, naming the clone and the commit; nothing falls back to the local branch", async (t) => {
  const { fx, head, cloneState } = behind(t);
  // The clone's remote still names the member, but its fetch cannot run.
  git(fx.member, "config", "remote.origin.uploadpack", "/usr/bin/false");
  const before = cloneState();
  const e = await fx.spawn("dev", { instance: "dev-unfetchable", work: "worktree" }).then(() => null, (x) => x);
  assert.equal(e?.code, "E_REMOTE_UNREADABLE", String(e?.message));
  assert.ok(e.message.includes(fx.member) && e.message.includes(head.slice(0, 12)), e.message);
  assert.throws(() => readFileSync(join(fx.root, "dev", "instances", "dev-unfetchable", "instance.json")), "no home was created");
  assert.deepEqual(cloneState(), before);
});

test("an explicit --base is the operator's word, as before", async (t) => {
  const { fx, local } = behind(t);
  const r = await fx.spawn("dev", { instance: "dev-explicit", work: "worktree", baseRef: "HEAD" });
  assert.equal(git(join(r.home, "work"), "rev-parse", "HEAD"), local);
  assert.deepEqual(r.base, { ref: "HEAD", oid: local });
});

test("the fetch never prompts: ssh runs in BatchMode and askpass is refused", (t) => {
  const { fx } = behind(t);
  // The clone's remote still names the member (its configured url), but git reaches it over ssh, through a
  // logging ssh that fails: the spawn refuses, and the argv says whether ssh could have prompted.
  const log = join(fx.base, "ssh-argv.log"), ssh = join(fx.base, "logging-ssh");
  writeFileSync(ssh, `#!/bin/sh\necho "$@" >> '${log}'\necho "askpass=$GIT_ASKPASS" >> '${log}'\nexit 1\n`, { mode: 0o755 });
  git(fx.member, "config", `url.ssh://example.invalid${fx.repo}.insteadOf`, fx.repo);
  const r = fx.cli(["spawn", "dev", "--name", "dev-ssh", "--no-launch", "--json"], { env: { GIT_SSH_COMMAND: ssh } });
  assert.notEqual(r.status, 0, r.stdout);
  assert.equal(r.json().error.code, "E_REMOTE_UNREADABLE", r.stdout);
  assert.deepEqual(r.json().error.details, { repo: fx.member, repoKey: fx.key, commit: git(fx.repo, "rev-parse", "main"), remote: "origin" });
  const argv = readFileSync(log, "utf8");
  assert.match(argv, /-o BatchMode=yes/, argv);
  assert.match(argv, /askpass=\/usr\/bin\/false/, argv);
});

test("a remote whose name reads like an option is passed to the fetch as a name, never as an option", async (t) => {
  const { fx, head } = behind(t);
  const marker = join(fx.base, "upload-pack-ran"), script = join(fx.base, "upload-pack");
  writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\nexec git-upload-pack "$@"\n`, { mode: 0o755 });
  // The only remote naming the member is called `--upload-pack=<script>`.
  const name = `--upload-pack=${script}`;
  git(fx.member, "config", "--unset", "remote.origin.url");
  git(fx.member, "config", `remote.${name}.url`, fx.repo);
  git(fx.member, "config", `remote.${name}.fetch`, `+refs/heads/*:refs/remotes/x/*`);
  const r = await fx.spawn("dev", { instance: "dev-option-remote", work: "worktree" });
  assert.equal(git(join(r.home, "work"), "rev-parse", "HEAD"), head, "fetched from the remote of that name");
  assert.equal(existsSync(marker), false, "the name never became --upload-pack");
});

test("remote urls are read NUL-separated: a newline inside one url cannot forge another remote", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "oats-remotes-")); t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, "init", "-q");
  const target = join(repo, "target.git");
  git(repo, "config", "remote.weird.url", `nothing\nremote.forged.url ${target}`);
  assert.equal(cloneRemoteFor(repo, `local/${target}`), null, "no remote's url names the target");
});
