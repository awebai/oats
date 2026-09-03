// scripts/release-lane.mjs — the runnerless mirror of release.yml.
//
// Phase logic is tested against fixtures and stubs: a throwaway git repo for
// the build gates, a hand-written stage directory for stage/publish-npm, and
// a fake `npm` ahead on PATH that records its argv. The real `build` takes
// minutes and is exercised by operators, not here.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const LANE = fileURLToPath(new URL("../scripts/release-lane.mjs", import.meta.url));
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function lane(args, { cwd = tmpdir(), env = {} } = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.NODE_TEST_CONTEXT; // never let a nested node --test think it is recursive
  return spawnSync(process.execPath, [LANE, ...args], { cwd, env: childEnv, encoding: "utf8" });
}
function scratch(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), `oats-lane-${prefix}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function fixtureRepo(t) {
  const repo = scratch(t, "repo");
  const run = (...args) => { const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  run("init", "-q", "-b", "main");
  run("config", "user.name", "Lane Test");
  run("config", "user.email", "lane@example.invalid");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "@awebai/oats", version: "0.0.0", private: true }));
  mkdirSync(join(repo, "docs", "release-notes"), { recursive: true });
  writeFileSync(join(repo, "docs", "release-notes", "README.md"), "notes\n");
  run("add", ".");
  run("commit", "-qm", "fixture");
  return { repo, run, sha: run("rev-parse", "HEAD") };
}
/** A stage directory the way `build` leaves it: MANIFEST.json + npm/ tarballs. */
function stagedBuild(t, { version = "1.2.3", sha = "0123456789abcdef0123456789abcdef01234567" } = {}) {
  const stage = scratch(t, "stage");
  mkdirSync(join(stage, "npm"));
  const tarballs = [];
  for (const [pkg, file] of [["@awebai/oats", `awebai-oats-${version}.tgz`], ["@awebai/oats-pi", `awebai-oats-pi-${version}.tgz`]]) {
    writeFileSync(join(stage, "npm", file), `fake tarball ${pkg}\n`);
    tarballs.push({ package: pkg, version, filename: file, sha256: sha256(join(stage, "npm", file)), size: 1 });
  }
  const manifest = { lane: "scripts/release-lane.mjs", tag: `v${version}`, version, sha, createdAt: "2026-01-01T00:00:00.000Z", node: process.version, phases: { build: { completedAt: "2026-01-01T00:00:00.000Z" } }, npm: { tarballs }, assets: [] };
  writeFileSync(join(stage, "MANIFEST.json"), JSON.stringify(manifest, null, 2));
  return { stage, manifest };
}
/** A fake npm ahead on PATH: records argv (and any userconfig it was handed), answers `view` from FAKE_NPM_LIVE. */
function fakeNpm(t) {
  const bin = scratch(t, "bin");
  const log = join(bin, "npm.log");
  writeFileSync(join(bin, "npm"), [
    "#!/bin/sh",
    `printf '%s\\n' "$*" >> "$FAKE_NPM_LOG"`,
    `if [ -n "$NPM_CONFIG_USERCONFIG" ] && [ -f "$NPM_CONFIG_USERCONFIG" ]; then printf 'userconfig: %s\\n' "$(cat "$NPM_CONFIG_USERCONFIG")" >> "$FAKE_NPM_LOG"; fi`,
    'case "$1" in',
    '  view) case ",$FAKE_NPM_LIVE," in *",$2,"*) echo 1.2.3; exit 0;; *) echo "npm ERR! 404" >&2; exit 1;; esac;;',
    '  publish) echo "+ fake publish $2"; exit 0;;',
    "esac",
    "exit 0",
    "",
  ].join("\n"));
  chmodSync(join(bin, "npm"), 0o755);
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);
  return { env: { PATH: `${bin}:${process.env.PATH}`, FAKE_NPM_LOG: log }, calls };
}

test("--help works and names every phase", () => {
  const r = lane(["--help"]);
  assert.equal(r.status, 0, r.stderr);
  for (const phase of ["build", "desktop", "stage", "publish-npm", "tag", "release-github", "status"]) assert.match(r.stdout, new RegExp(`^  ${phase}\\b`, "m"), `help documents ${phase}`);
  assert.match(r.stdout, /Linux AppImage\/DEB leg needs a Linux host/);
  assert.match(r.stdout, /NO npm provenance attestation/);
  assert.match(r.stdout, /Pushing triggers release\.yml/);
  assert.equal(lane([]).status, 2, "no phase: usage, refused");
  assert.match(lane(["bogus", "--tag", "v1.0.0"]).stderr, /unknown phase/);
  assert.match(lane(["status", "--tag", "1.0.0"]).stderr, /--tag must look like vX\.Y\.Z/);
});

test("build refuses on a dirty tree before touching anything", (t) => {
  const { repo } = fixtureRepo(t);
  writeFileSync(join(repo, "package.json"), "{ \"dirty\": true }\n");
  const stage = join(repo, "stage");
  const r = lane(["build", "--tag", "v9.9.9", "--stage", stage, "--allow-off-main"], { cwd: repo });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /working tree is not clean/);
  assert.match(r.stderr, /package\.json/);
  assert.ok(!existsSync(stage), "nothing staged");
});

test("build refuses when the SHA is not on origin/main unless --allow-off-main", (t) => {
  const { repo } = fixtureRepo(t);
  const r = lane(["build", "--tag", "v9.9.9", "--stage", join(repo, "stage")], { cwd: repo });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not on origin\/main/);
  assert.match(r.stderr, /--allow-off-main/);
});

test("build refuses when docs/release-notes/<tag>.md is missing at the SHA (fixture repo)", (t) => {
  const { repo, sha } = fixtureRepo(t);
  const stage = join(scratch(t, "stage"), "v9.9.9");
  const exportDir = join(scratch(t, "export"), "v9.9.9");
  const r = lane(["build", "--tag", "v9.9.9", "--stage", stage, "--export", exportDir, "--allow-off-main"], { cwd: repo });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /missing docs\/release-notes\/v9\.9\.9\.md/);
  // it got as far as a clean detached export of the SHA, and no further
  const manifest = JSON.parse(readFileSync(join(stage, "MANIFEST.json"), "utf8"));
  assert.equal(manifest.sha, sha);
  assert.equal(manifest.export, exportDir);
  assert.deepEqual(manifest.phases, {});
  assert.equal(spawnSync("git", ["-C", exportDir, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(), sha);
  assert.ok(!existsSync(join(exportDir, "node_modules")), "no install happened");
  assert.equal(spawnSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" }).stdout, "", "the checkout is untouched");
});

test("stage writes SHA256SUMS.txt in shasum format and records staged/missing assets in MANIFEST.json", (t) => {
  const { stage, manifest } = stagedBuild(t);
  mkdirSync(join(stage, "assets"));
  const files = ["oats-desktop-1.2.3-mac-arm64.dmg", "oats-desktop-1.2.3-mac-arm64.zip"];
  for (const f of files) writeFileSync(join(stage, "assets", f), `payload ${f}\n`);
  const r = lane(["stage", "--tag", "v1.2.3", "--stage", stage]);
  assert.equal(r.status, 0, r.stderr);
  const sums = readFileSync(join(stage, "assets", "SHA256SUMS.txt"), "utf8");
  assert.equal(sums, files.map((f) => `${sha256(join(stage, "assets", f))}  ${f}\n`).join(""));
  const after = JSON.parse(readFileSync(join(stage, "MANIFEST.json"), "utf8"));
  assert.equal(after.tag, manifest.tag);
  assert.equal(after.sha, manifest.sha);
  assert.deepEqual(after.npm, manifest.npm, "build outputs untouched");
  assert.ok(after.phases.build, "earlier phases kept");
  assert.equal(after.phases.stage.checksums, "assets/SHA256SUMS.txt");
  assert.match(after.phases.stage.completedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(after.phases.stage.staged, files);
  assert.deepEqual(after.phases.stage.missing, [
    "oats-desktop-1.2.3-mac-x64.dmg", "oats-desktop-1.2.3-mac-x64.zip",
    "oats-desktop-1.2.3-linux-x64.AppImage", "oats-desktop-1.2.3-linux-x64.deb",
  ]);
  assert.deepEqual(after.assets.map((a) => a.filename), files);
  for (const a of after.assets) { assert.equal(a.sha256, sha256(join(stage, "assets", a.filename))); assert.equal(typeof a.size, "number"); }
  assert.match(r.stdout, /linux-x64\.AppImage — Linux x64 host/);
  // rerun is idempotent: SHA256SUMS.txt never lists itself
  assert.equal(lane(["stage", "--tag", "v1.2.3", "--stage", stage]).status, 0);
  assert.equal(readFileSync(join(stage, "assets", "SHA256SUMS.txt"), "utf8"), sums);
});

test("stage refuses with no assets; status reports what remains", (t) => {
  const { stage } = stagedBuild(t);
  assert.equal(lane(["stage", "--tag", "v1.2.3", "--stage", stage]).status, 2);
  const r = lane(["status", "--tag", "v1.2.3", "--stage", stage]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"tag": "v1\.2\.3"/);
  assert.match(r.stdout, /done +build/);
  assert.match(r.stdout, /ok +npm\/awebai-oats-1\.2\.3\.tgz/);
  assert.match(r.stdout, /assets\/oats-desktop-1\.2\.3-linux-x64\.deb +\(desktop --arch x64 on Linux x64 host\)/);
  assert.match(r.stdout, /remaining: desktop, stage, publish-npm, tag, release-github/);
  assert.match(lane(["status", "--tag", "v1.2.4", "--stage", stage]).stderr, /is for v1\.2\.3, not v1\.2\.4/);
});

test("publish-npm refuses without --yes, prints the plan, and never calls npm publish", (t) => {
  const { stage } = stagedBuild(t);
  const npm = fakeNpm(t);
  const r = lane(["publish-npm", "--tag", "v1.2.3", "--stage", stage], { env: npm.env });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /refusing to publish without --yes/);
  assert.match(r.stdout, /@awebai\/oats@1\.2\.3 {2}awebai-oats-1\.2\.3\.tgz/);
  assert.match(r.stdout, /@awebai\/oats-pi@1\.2\.3/);
  assert.match(r.stdout, /no npm provenance attestation/);
  assert.deepEqual(npm.calls(), [], "npm was not invoked at all");
  // --dry-run alone is still not consent
  assert.equal(lane(["publish-npm", "--tag", "v1.2.3", "--stage", stage, "--dry-run"], { env: npm.env }).status, 2);
  assert.deepEqual(npm.calls(), []);
});

test("publish-npm --dry-run --yes: guard, then kernel before adapter, --access public --dry-run", (t) => {
  const { stage } = stagedBuild(t);
  const npm = fakeNpm(t);
  const r = lane(["publish-npm", "--tag", "v1.2.3", "--stage", stage, "--dry-run", "--yes"], { env: npm.env });
  assert.equal(r.status, 0, r.stderr);
  const kernel = join(stage, "npm", "awebai-oats-1.2.3.tgz");
  const adapter = join(stage, "npm", "awebai-oats-pi-1.2.3.tgz");
  assert.deepEqual(npm.calls(), [
    "view @awebai/oats@1.2.3 version",
    `publish ${kernel} --access public --dry-run`,
    "view @awebai/oats-pi@1.2.3 version",
    `publish ${adapter} --access public --dry-run`,
  ]);
  assert.match(r.stdout, /publishing as whatever npm is logged in as/);
  assert.match(r.stdout, /@awebai\/oats: dry-run/);
  const manifest = JSON.parse(readFileSync(join(stage, "MANIFEST.json"), "utf8"));
  assert.equal(manifest.phases["publish-npm"], undefined, "a dry run does not mark the phase complete");
  assert.ok(existsSync(join(stage, "logs")), "npm output logged under the stage directory");
});

test("publish-npm skips a version npm view reports live (same-tag retry), publishes the rest", (t) => {
  const { stage } = stagedBuild(t);
  const npm = fakeNpm(t);
  const r = lane(["publish-npm", "--tag", "v1.2.3", "--stage", stage, "--yes"], { env: { ...npm.env, FAKE_NPM_LIVE: "@awebai/oats@1.2.3" } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /@awebai\/oats@1\.2\.3 already published — skipping \(same-tag retry\)/);
  assert.deepEqual(npm.calls(), [
    "view @awebai/oats@1.2.3 version",
    "view @awebai/oats-pi@1.2.3 version",
    `publish ${join(stage, "npm", "awebai-oats-pi-1.2.3.tgz")} --access public`,
  ]);
  const manifest = JSON.parse(readFileSync(join(stage, "MANIFEST.json"), "utf8"));
  assert.deepEqual(manifest.phases["publish-npm"].results, [
    { package: "@awebai/oats", status: "already-published" },
    { package: "@awebai/oats-pi", status: "published" },
  ]);
});

test("publish-npm with NPM_TOKEN hands npm a temporary userconfig and removes it afterwards", (t) => {
  const { stage } = stagedBuild(t);
  const npm = fakeNpm(t);
  const r = lane(["publish-npm", "--tag", "v1.2.3", "--stage", stage, "--dry-run", "--yes"], { env: { ...npm.env, NPM_TOKEN: "npm_test_token_123" } });
  assert.equal(r.status, 0, r.stderr);
  const userconfigLines = npm.calls().filter((l) => l.startsWith("userconfig: "));
  assert.equal(userconfigLines.length, 4, "every npm call saw the userconfig");
  assert.equal(userconfigLines[0], "userconfig: //registry.npmjs.org/:_authToken=npm_test_token_123");
  const m = r.stdout.match(/temporary userconfig (\S+)/);
  assert.ok(m, "reports the temporary userconfig path");
  assert.ok(!existsSync(m[1]), "temporary .npmrc removed");
  assert.ok(!m[1].startsWith(stage), "never written under the stage directory");
});

test("publish-npm refuses a tarball whose bytes differ from MANIFEST.json", (t) => {
  const { stage } = stagedBuild(t);
  const npm = fakeNpm(t);
  writeFileSync(join(stage, "npm", "awebai-oats-1.2.3.tgz"), "tampered\n");
  const r = lane(["publish-npm", "--tag", "v1.2.3", "--stage", stage, "--yes"], { env: npm.env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /sha256 .* differs from MANIFEST\.json/);
  assert.deepEqual(npm.calls(), []);
});

test("tag creates the annotated tag at the recorded SHA and does not push without --push --yes", (t) => {
  const { repo, run, sha } = fixtureRepo(t);
  const { stage } = stagedBuild(t, { sha });
  const r = lane(["tag", "--tag", "v1.2.3", "--stage", stage], { cwd: repo });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(run("rev-parse", "v1.2.3^{commit}"), sha);
  assert.equal(run("cat-file", "-t", "v1.2.3"), "tag", "annotated");
  assert.match(r.stdout, /tag not pushed/);
  assert.match(r.stdout, /triggers release\.yml/);
  assert.equal(JSON.parse(readFileSync(join(stage, "MANIFEST.json"), "utf8")).phases.tag.pushed, false);
  // rerun: exists at the same SHA, fine; --push without --yes refuses
  assert.match(lane(["tag", "--tag", "v1.2.3", "--stage", stage], { cwd: repo }).stdout, /already exists at/);
  const pushless = lane(["tag", "--tag", "v1.2.3", "--stage", stage, "--push"], { cwd: repo });
  assert.equal(pushless.status, 2);
  assert.match(pushless.stderr, /without --yes/);
  // a tag that already exists elsewhere is a hard error, never retagged
  run("commit", "-q", "--allow-empty", "-m", "later");
  const { stage: other } = stagedBuild(t, { sha: run("rev-parse", "HEAD") });
  assert.match(lane(["tag", "--tag", "v1.2.3", "--stage", other], { cwd: repo }).stderr, /already exists at .* but the staged build is/);
});
