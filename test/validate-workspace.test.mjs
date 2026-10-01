// `npm run validate` reads the repository's own oats-workspace.yaml and package-catalog.json with the kernel's
// readers (what `oats sync` uses), and refuses unresolved merge-conflict markers in any tracked text file. A
// conflicted oats-workspace.yaml once passed check, validate, pack and smoke.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkWorkspaceFiles } from "../scripts/check-workspace-files.mjs";

const REPO = resolve(new URL("..", import.meta.url).pathname);
// Conflict markers, built so this file's own lines never start with one.
const OURS = "<".repeat(7), MID = "=".repeat(7), THEIRS = ">".repeat(7);

/** A git repository holding a copy of this repo's own workspace file and catalog, committed. */
function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-validate-ws-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { stdio: "pipe" });
  git("init", "-q");
  copyFileSync(join(REPO, "oats-workspace.yaml"), join(dir, "oats-workspace.yaml"));
  copyFileSync(join(REPO, "package-catalog.json"), join(dir, "package-catalog.json"));
  mkdirSync(join(dir, "docs"));
  writeFileSync(join(dir, "docs", "guide.md"), "# Guide\n\nText.\n");
  git("add", "-A"); git("commit", "-qm", "fixture");
  return { dir, git, write: (rel, text) => writeFileSync(join(dir, rel), text), track: (rel) => git("add", rel) };
}
const conflicted = (text) => { const [first, ...rest] = text.split("\n"); return [first, `${OURS} HEAD`, "name: ours", MID, "name: theirs", `${THEIRS} feature`, ...rest].join("\n"); };

test("the repository itself passes", () => {
  assert.deepEqual(checkWorkspaceFiles(REPO), []);
});

test("a valid workspace file, catalog and tree pass", (t) => {
  assert.deepEqual(checkWorkspaceFiles(fixture(t).dir), []);
});

test("conflict markers in oats-workspace.yaml fail it: the kernel's reader refuses the file, and each marker is named with its line", (t) => {
  const f = fixture(t);
  f.write("oats-workspace.yaml", conflicted(readFileSync(join(f.dir, "oats-workspace.yaml"), "utf8")));
  const failures = checkWorkspaceFiles(f.dir);
  assert.ok(failures.some((m) => /^oats-workspace\.yaml: the kernel cannot read it: .*line 2/.test(m)), failures.join("\n"));
  for (const line of [2, 4, 6]) assert.ok(failures.includes(`oats-workspace.yaml:${line}: unresolved merge-conflict marker`), `line ${line}: ${failures.join("\n")}`);
});

test("a workspace file the kernel's schema refuses fails, naming where", (t) => {
  const f = fixture(t);
  f.write("oats-workspace.yaml", "schemaVersion: 2\nmembers: []\n");
  const failures = checkWorkspaceFiles(f.dir);
  assert.equal(failures.length, 1, failures.join("\n"));
  assert.match(failures[0], /^oats-workspace\.yaml: the kernel refuses it: .*name/);
});

test("a broken package-catalog.json fails, naming the line", (t) => {
  const f = fixture(t);
  f.write("package-catalog.json", '{\n  "packages": {\n    "x": \n  }\n}\n');
  const failures = checkWorkspaceFiles(f.dir);
  assert.equal(failures.length, 1, failures.join("\n"));
  assert.match(failures[0], /^package-catalog\.json: the kernel cannot read it: .*line 4/);
});

test("markers in any tracked text file fail, with file and line; untracked, binary and allow-listed files do not", (t) => {
  const f = fixture(t);
  f.write("docs/guide.md", `# Guide\n\n${OURS} HEAD\nmine\n${MID}\ntheirs\n${THEIRS} other\n`);
  f.write("docs/untracked.md", `${OURS} HEAD\n`);
  f.write("docs/blob.bin", Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(`\n${OURS} HEAD\n`)]));
  f.track("docs/blob.bin");
  // A heading underline of another length, or a marker not at the start of a line, is not a marker.
  f.write("docs/other.md", `Title\n${MID}=\n\nsay ${OURS} HEAD\n`);
  f.track("docs/other.md");
  assert.deepEqual(checkWorkspaceFiles(f.dir), ["docs/guide.md:3: unresolved merge-conflict marker", "docs/guide.md:5: unresolved merge-conflict marker", "docs/guide.md:7: unresolved merge-conflict marker"]);
  assert.deepEqual(checkWorkspaceFiles(f.dir, { markerAllowList: ["docs/guide.md"] }), []);
});
