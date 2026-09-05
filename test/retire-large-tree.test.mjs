// Retirement of an instance whose work tree makes git talk more than Node's
// default 1 MiB child buffer (cjr: ~9500 tracked long paths): every git call
// on the retirement path must be bounded well above that, or the spawn dies
// with ENOBUFS and the retirement reports the recovery as unverifiable while
// the home, worktree and identity are left behind.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { findAgent, retireInstance, spawnInstance } from "../lib/core.mjs";

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }

// Always on: the source contract. Every execFileSync("git", ...) between the
// retirement inspection helpers and retireInstance carries the bound; a new
// call added without it is exactly the regression, and it must fail here
// before it fails on someone's 9,500-file tree.
test("every git call on the retirement path carries GIT_MAX_BUFFER", () => {
  const src = readFileSync(new URL("../lib/core.mjs", import.meta.url), "utf8");
  const start = src.indexOf("function fingerprintTree(");
  const end = src.indexOf("export function retireInstance(");
  assert.ok(start > 0 && end > start, "retirement section located");
  const section = src.slice(start, end);
  const calls = section.match(/execFileSync\("git",[\s\S]*?\)(?=;|\.trim\(\)|\.toString\(|\s*\)|,\s*\{)/g) || [];
  assert.ok(calls.length >= 15, `expected the retirement section's git calls, found ${calls.length}`);
  const unbounded = calls.filter((c) => !c.includes("GIT_MAX_BUFFER"));
  assert.deepEqual(unbounded, [], "git calls on the retirement path without the bound");
});

// Opt in (OATS_SLOW_TESTS=1): the real thing, about three minutes of git and
// hashing over a tree whose listings exceed the default buffer.
const slow = process.env.OATS_SLOW_TESTS === "1";
test("retire succeeds on a work tree whose index listing exceeds 1 MiB, and preserves an uncommitted change to a >1 MiB file byte for byte", { skip: slow ? false : "set OATS_SLOW_TESTS=1 to run the large-tree retirement" }, () => {
  const base = mkdtempSync(join(tmpdir(), "oats-large-tree-"));
  const bin = join(base, "bin"); mkdirSync(bin);
  for (const rt of ["pi", "claude"]) write(join(bin, rt), "#!/bin/sh\nexit 0\n");
  write(join(bin, "tmux"), "#!/bin/sh\nexit 0\n");
  execFileSync("chmod", ["-R", "+x", bin]);
  const oldPath = process.env.PATH; process.env.PATH = `${bin}:${process.env.PATH}`;
  try {
    const repo = join(base, "repo"); mkdirSync(repo);
    write(join(repo, "oats-config.yaml"), "capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n");
    write(join(repo, "agents", "dev", "soul", "soul.yaml"), "name: dev\nrepo: .\nwork: worktree\nruntime: pi\n");
    write(join(repo, "agents", "dev", "soul", "AGENTS.md"), "You are dev.\n");
    // ~4,500 tracked files at ~280-character paths (deep, long directory
    // names): `git ls-files --stage -z`, which work preservation reads whole,
    // runs past 1 MiB of output on this tree, as cjr's ~9,500 long paths did
    // (a clean tree's status listing stays small; the index is the
    // reproduction). The fixture stays as small as that allows.
    const deep = Array.from({ length: 6 }, (_, k) => `level-${k}-with-a-deliberately-long-directory-name-for-the-listing`).join("/");
    for (let i = 0; i < 4500; i++) write(join(repo, "src", deep, `sub${i % 30}`, `file-with-a-long-descriptive-name-${i}.txt`), `${i}\n`);
    write(join(repo, "big.bin"), "x".repeat(1_100_000));
    execFileSync("git", ["init", "-q", repo]);
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "add", "-A"]);
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "init"]);
    const indexBytes = execFileSync("git", ["-C", repo, "ls-files", "--stage", "-z"], { maxBuffer: 64 * 1024 * 1024 }).length;
    assert.ok(indexBytes > 1024 * 1024, `the index listing must exceed Node's 1 MiB default child buffer to reproduce ENOBUFS (got ${indexBytes})`);
    const root = join(repo, "agents");
    const r = spawnInstance(root, findAgent(root, "dev"), { instance: "dev-big", launch: false });
    const home = join(root, "dev", "instances", "dev-big");
    // An uncommitted change to the large file: preservation must carry it.
    writeFileSync(join(home, "work", "big.bin"), "y".repeat(1_200_000));
    const done = retireInstance(root, "dev-big", { tmuxSession: "oats-test-nosuch" });
    assert.equal(done.rollbackIncomplete, undefined, JSON.stringify(done.rollbackIncomplete));
    assert.equal(done.removedDir, true);
    assert.equal(existsSync(home), false, "the home is gone");
    const rec = done.workRecovery;
    assert.ok(rec && rec.path, "uncommitted work was preserved");
    assert.ok(rec.classes.some((c) => /worktree|uncommitted|changed/i.test(c)), rec.classes.join(", "));
    // The preserved copy must carry the 1.2 MB of changed bytes, not a truncated or stale file.
    const recovered = execFileSync("find", [rec.path, "-name", "big.bin", "-type", "f"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
    assert.ok(recovered.length >= 1, `big.bin present in the recovery at ${rec.path}`);
    const bytes = readFileSync(recovered[0], "utf8");
    assert.equal(bytes.length, 1_200_000); assert.equal(bytes, "y".repeat(1_200_000), "the uncommitted content survived byte for byte");
    void r;
  } finally { process.env.PATH = oldPath; rmSync(base, { recursive: true, force: true }); }
});
