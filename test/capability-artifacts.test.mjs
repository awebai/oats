import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs, { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import {
  acquirePackage, capabilityArtifactIntegrity, installedCapabilityDir,
  OATS_LOCK_FILE, parseLockFileStrict, updatePackage,
} from "../lib/core.mjs";
import {
  retainCapabilityArtifact, retainedCapabilityDir, verifyRetainedCapability,
} from "../lib/capability-artifacts.mjs";
import { copyTreeSafe } from "../lib/artifact-tree.mjs";

const ID = "example.expert";
const write = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
function makeFixtureRemovable(path) {
  if (!lstatSync(path).isDirectory()) return;
  chmodSync(path, 0o700);
  for (const name of readdirSync(path)) makeFixtureRemovable(join(path, name));
}
function snapshot(root) {
  const entries = [];
  const walk = (path, name) => {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) entries.push([name, "link", readlinkSync(path)]);
    else if (st.isFile()) entries.push([name, "file", st.mode & 0o7777, readFileSync(path).toString("hex")]);
    else {
      entries.push([name, "dir", st.mode & 0o7777]);
      for (const child of readdirSync(path).sort()) walk(join(path, child), `${name}/${child}`);
    }
  };
  walk(root, ".");
  return entries;
}
function withFsOverrides(overrides, run) {
  const originals = Object.fromEntries(Object.keys(overrides).map((key) => [key, fs[key]]));
  Object.assign(fs, overrides);
  syncBuiltinESMExports();
  try { return run(); }
  finally { Object.assign(fs, originals); syncBuiltinESMExports(); }
}
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-retained-")));
  t.after(() => { makeFixtureRemovable(base); rmSync(base, { recursive: true, force: true }); });
  const scope = join(base, "scope");
  const source = join(base, "source");
  write(join(scope, "oats-config.yaml"), "name: test\n");
  write(join(source, "oats-package.json"), JSON.stringify({
    package: "example.package", version: "1.0.0", description: "Example package",
    compatibility: { oats: ">=0.1.0" }, capabilities: ["expert"],
  }));
  write(join(source, "expert", "oats.json"), JSON.stringify({
    capability: ID, version: "1.0.0", description: "Example expert", skills: ["skills/expert"],
  }));
  write(join(source, "expert", "skills/expert/SKILL.md"), "# Expert\nRevision A\n");
  write(join(source, "expert", "version.mjs"), "console.log('A');\n");
  symlinkSync("version.mjs", join(source, "expert", "current.mjs"));
  acquirePackage(scope, `path:${source}`);
  return {
    base, scope, source, installed: installedCapabilityDir(scope, ID),
    lock: parseLockFileStrict(join(scope, OATS_LOCK_FILE)),
  };
}

test("retained A and B execute independently after update and removal of the source and flat store", (t) => {
  const f = fixture(t);
  const a = retainCapabilityArtifact(f.scope, f.installed, ID, f.lock);
  write(join(f.source, "expert", "version.mjs"), "console.log('B');\n");
  write(join(f.source, "expert", "skills/expert/SKILL.md"), "# Expert\nRevision B\n");
  updatePackage(f.scope, "example.package");
  const lockB = parseLockFileStrict(join(f.scope, OATS_LOCK_FILE));
  const b = retainCapabilityArtifact(f.scope, f.installed, ID, lockB);
  assert.notEqual(a.integrity, b.integrity);
  assert.notEqual(a.dir, b.dir);
  rmSync(f.source, { recursive: true });
  rmSync(f.installed, { recursive: true });
  rmSync(join(f.scope, OATS_LOCK_FILE));
  for (const [receipt, lock, expected] of [[a, f.lock, "A"], [b, lockB, "B"]]) {
    assert.equal(verifyRetainedCapability(f.scope, ID, lock).dir, receipt.dir);
    assert.equal(execFileSync(process.execPath, [join(receipt.dir, "current.mjs")], { encoding: "utf8" }).trim(), expected);
  }
});

test("retaining identical bytes keeps the original tree and does not select or approve it", (t) => {
  const f = fixture(t);
  const before = readFileSync(join(f.scope, OATS_LOCK_FILE));
  const a = retainCapabilityArtifact(f.scope, f.installed, ID, f.lock);
  const original = statSync(join(a.dir, "oats.json"));
  const b = retainCapabilityArtifact(f.scope, f.installed, ID, f.lock);
  assert.equal(a.status, "retained");
  assert.equal(b.status, "kept");
  assert.equal(statSync(join(b.dir, "oats.json")).ino, original.ino);
  assert.deepEqual(readFileSync(join(f.scope, OATS_LOCK_FILE)), before);
  assert.equal(f.lock.capabilities[ID].trusted, false);
  assert.equal(Object.hasOwn(b, "trusted"), false);
  assert.equal(readdirSync(dirname(a.dir)).some((name) => name.startsWith(".staging-")), false);
});

test("retention preserves the complete byte/mode/link tree without changing the old digest", (t) => {
  const f = fixture(t);
  chmodSync(f.installed, 0o750);
  chmodSync(join(f.installed, "version.mjs"), 0o751);
  chmodSync(join(f.installed, "skills"), 0o550);
  chmodSync(join(f.installed, "skills/expert"), 0o550);
  chmodSync(join(f.installed, "skills/expert/SKILL.md"), 0o400);
  // Mode changes above are intentionally NOT a new artifact identity in this step.
  assert.equal(capabilityArtifactIntegrity(f.installed), f.lock.capabilities[ID].integrity);
  const before = snapshot(f.installed);
  const a = retainCapabilityArtifact(f.scope, f.installed, ID, f.lock);
  assert.deepEqual(snapshot(a.dir), before);
  assert.equal(retainCapabilityArtifact(f.scope, f.installed, ID, f.lock).status, "kept");
  assert.deepEqual(snapshot(a.dir), before, "reuse never makes published read-only directories writable");
  assert.deepEqual(snapshot(f.installed), before);
  rmSync(f.source, { recursive: true });
  makeFixtureRemovable(f.installed);
  rmSync(f.installed, { recursive: true });
  assert.equal(verifyRetainedCapability(f.scope, ID, f.lock).integrity, a.integrity);
  assert.deepEqual(snapshot(a.dir), before, "retained modes/links/bytes survive removal of both sources");
});

test("source drift or incorrect provenance refuses retention before creating a store", (t) => {
  const f = fixture(t);
  const wrong = structuredClone(f.lock);
  wrong.packages["example.package"].source = "path:/different-source";
  assert.throws(() => retainCapabilityArtifact(f.scope, f.installed, ID, wrong), { code: "invalid-lock" });
  write(join(f.installed, "version.mjs"), "console.log('changed');\n");
  assert.throws(() => retainCapabilityArtifact(f.scope, f.installed, ID, f.lock), { code: "integrity-drift" });
  assert.equal(existsSync(join(f.scope, ".agents/capabilities/artifacts")), false);
});

test("damaged retained content is never repaired from an otherwise valid source", (t) => {
  const f = fixture(t);
  const a = retainCapabilityArtifact(f.scope, f.installed, ID, f.lock);
  const marker = join(a.dir, "version.mjs");
  write(marker, "damaged retained content\n");
  assert.throws(() => verifyRetainedCapability(f.scope, ID, f.lock), { code: "integrity-drift" });
  assert.throws(() => retainCapabilityArtifact(f.scope, f.installed, ID, f.lock), { code: "integrity-drift" });
  assert.equal(readFileSync(marker, "utf8"), "damaged retained content\n");
});

test("missing scope, store or revision is distinct from damaged retained content", (t) => {
  const f = fixture(t);
  assert.throws(() => verifyRetainedCapability(join(f.base, "absent"), ID, f.lock), { code: "artifact-not-found" });
  assert.throws(() => retainCapabilityArtifact(join(f.base, "absent"), f.installed, ID, f.lock), { code: "artifact-not-found" });
  assert.throws(() => verifyRetainedCapability(f.scope, ID, f.lock), { code: "artifact-not-found" });
  const a = retainCapabilityArtifact(f.scope, f.installed, ID, f.lock);
  rmSync(a.dir, { recursive: true });
  assert.throws(() => verifyRetainedCapability(f.scope, ID, f.lock), { code: "artifact-not-found" });
  write(a.dir, "not a tree\n");
  assert.throws(() => verifyRetainedCapability(f.scope, ID, f.lock), { code: "invalid-artifact" });
  rmSync(a.dir);
  mkdirSync(a.dir);
  assert.throws(() => verifyRetainedCapability(f.scope, ID, f.lock), { code: "integrity-drift" });
});

test("retention rejects links to mutable external sources even when the lock matches", (t) => {
  const f = fixture(t);
  for (const target of [join(f.installed, "version.mjs"), join(f.source, "expert/version.mjs"), "../../outside"]) {
    const link = join(f.installed, "extra-link");
    symlinkSync(target, link);
    const lock = structuredClone(f.lock);
    lock.capabilities[ID].integrity = capabilityArtifactIntegrity(f.installed);
    assert.throws(() => retainCapabilityArtifact(f.scope, f.installed, ID, lock), { code: "artifact-not-contained" });
    rmSync(link);
  }
});

test("store symlinks and invalid artifact references cannot redirect publication", (t) => {
  const f = fixture(t);
  for (const id of ["../elsewhere", "/tmp/elsewhere", "", "__proto__"]) {
    assert.throws(() => retainedCapabilityDir(f.scope, id, f.lock.capabilities[ID].integrity), { code: "invalid-artifact-reference" });
  }
  assert.throws(() => retainedCapabilityDir(f.scope, ID, "sha256-abcd"), { code: "invalid-artifact-reference" });
  const outside = join(f.base, "elsewhere");
  mkdirSync(outside);
  symlinkSync(outside, join(f.scope, ".agents/capabilities/artifacts"));
  assert.throws(() => retainCapabilityArtifact(f.scope, f.installed, ID, f.lock), { code: "invalid-artifact-store" });
  assert.deepEqual(readdirSync(outside), []);
});

test("retained payload is ignored by Git, while authored capabilities remain visible", (t) => {
  const f = fixture(t);
  execFileSync("git", ["init", "-q", f.scope]);
  const a = retainCapabilityArtifact(f.scope, f.installed, ID, f.lock);
  const ignored = execFileSync("git", ["-C", f.scope, "check-ignore", join(a.dir, "oats.json")], { encoding: "utf8" });
  assert.match(ignored, /oats\.json/);
  write(join(f.scope, ".agents/capabilities/owned/example/oats.json"), "{}\n");
  assert.match(execFileSync("git", ["-C", f.scope, "ls-files", "--others", "--exclude-standard"], { encoding: "utf8" }), /owned\/example\/oats.json/);
});

for (const rootMode of [0o750, 0o550, 0o500]) {
  test(`two preparers retain root mode ${rootMode.toString(8)} without replacing each other's result`, async (t) => {
  const f = fixture(t);
  chmodSync(f.installed, rootMode);
  chmodSync(join(f.installed, "skills"), 0o550);
  chmodSync(join(f.installed, "skills/expert"), 0o550);
  const before = snapshot(f.installed);
  const module = new URL("../lib/capability-artifacts.mjs", import.meta.url).href;
  const script = `
    import { readFileSync } from 'node:fs';
    import { retainCapabilityArtifact } from ${JSON.stringify(module)};
    const [scope, source, id, lockFile] = process.argv.slice(1);
    const result = retainCapabilityArtifact(scope, source, id, JSON.parse(readFileSync(lockFile)));
    console.log(JSON.stringify(result));
  `;
  const publish = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, f.scope, f.installed, ID, join(f.scope, OATS_LOCK_FILE)], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) { reject(new Error(stderr || `publisher exited ${code}`)); return; }
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
    });
  });
  const [a, b] = await Promise.all([publish(), publish()]);
  assert.equal(a.dir, b.dir);
  assert.deepEqual([a.status, b.status].sort(), ["kept", "retained"]);
  assert.equal(verifyRetainedCapability(f.scope, ID, f.lock).dir, a.dir);
  assert.deepEqual(snapshot(a.dir), before);
  assert.deepEqual(snapshot(f.installed), before);
  assert.deepEqual(readdirSync(dirname(a.dir)), [a.integrity]);
  });
}

for (const scenario of ["copy-failure", "copied-drift", "valid-winner", "invalid-winner", "escaping-staged-link", "drift-cleanup-failure"]) {
  test(`read-only retention rollback: ${scenario} preserves source, prior artifacts and real verification diagnostics`, (t) => {
    const f = fixture(t);
    chmodSync(f.installed, 0o750);
    chmodSync(join(f.installed, "skills"), 0o550);
    chmodSync(join(f.installed, "skills/expert"), 0o550);
    chmodSync(join(f.installed, "skills/expert/SKILL.md"), 0o400);
    // An already published artifact is a protected link target/negative control,
    // not the staging preparer's property to make writable or clean up.
    const priorScope = join(f.base, "prior-scope");
    mkdirSync(priorScope);
    const prior = retainCapabilityArtifact(priorScope, f.installed, ID, f.lock);
    const protectedRoots = [f.source, f.installed, prior.dir];
    const before = protectedRoots.map(snapshot);
    const lockBytes = readFileSync(join(f.scope, OATS_LOCK_FILE));
    const dest = retainedCapabilityDir(f.scope, ID, f.lock.capabilities[ID].integrity);
    const original = { copy: fs.copyFileSync, rename: fs.renameSync, rm: fs.rmSync };
    const copyError = Object.freeze(Object.assign(new Error("bounded copy I/O failure"), { code: "EIO" }));
    const cleanupError = Object.freeze(Object.assign(new Error("bounded staging cleanup failure"), { code: "EACCES" }));
    let injected = false, staged, winner, winnerInode, caught;
    const overrides = {
      copyFileSync(src, target, ...args) {
        if (src !== join(f.installed, "version.mjs") || !target.startsWith(join(dirname(dest), ".staging-"))) {
          return original.copy(src, target, ...args);
        }
        staged = dirname(target);
        // This sorted sibling is copied only AFTER the nested directories have
        // received their preserved read-only modes (including the 0400 file).
        assert.equal(lstatSync(join(staged, "skills/expert")).mode & 0o777, 0o550);
        assert.equal(lstatSync(join(staged, "skills/expert/SKILL.md")).mode & 0o777, 0o400);
        if (scenario === "copy-failure") { injected = true; throw copyError; }
        const result = original.copy(src, target, ...args);
        if (["copied-drift", "drift-cleanup-failure"].includes(scenario)) {
          writeFileSync(target, "copied bytes drifted\n");
          injected = true;
        } else if (scenario === "escaping-staged-link") {
          symlinkSync(prior.dir, join(staged, "escape"));
          injected = true;
        }
        return result;
      },
      renameSync(from, to) {
        assert.equal(from, staged);
        assert.equal(to, dest);
        assert.equal(lstatSync(from).mode & 0o777, 0o750);
        if (["valid-winner", "invalid-winner"].includes(scenario)) {
          copyTreeSafe(f.installed, dest);
          if (scenario === "invalid-winner") writeFileSync(join(dest, "version.mjs"), "damaged winner\n");
          winner = snapshot(dest);
          winnerInode = lstatSync(dest).ino;
          injected = true;
        }
        return original.rename(from, to); // real nonempty competing-tree error
      },
      rmSync(path, options) {
        if (scenario === "drift-cleanup-failure" && staged && path === staged) throw cleanupError;
        return original.rm(path, options);
      },
    };
    withFsOverrides(overrides, () => {
      if (scenario === "valid-winner") {
        assert.equal(retainCapabilityArtifact(f.scope, f.installed, ID, f.lock).status, "kept");
      } else {
        assert.throws(() => retainCapabilityArtifact(f.scope, f.installed, ID, f.lock), (e) => {
          caught = e;
          if (scenario === "copy-failure") assert.equal(e, copyError);
          else if (scenario === "escaping-staged-link") assert.equal(e.code, "artifact-not-contained");
          else assert.equal(e.code, "integrity-drift");
          return true;
        });
      }
    });
    assert.equal(injected, true, "the intended failure/race window was reached");
    assert.deepEqual(protectedRoots.map(snapshot), before);
    assert.deepEqual(readFileSync(join(f.scope, OATS_LOCK_FILE)), lockBytes);
    assert.equal(verifyRetainedCapability(priorScope, ID, f.lock).dir, prior.dir);
    if (winner) {
      assert.deepEqual(snapshot(dest), winner);
      assert.equal(lstatSync(dest).ino, winnerInode);
      if (scenario === "valid-winner") assert.equal(verifyRetainedCapability(f.scope, ID, f.lock).dir, dest);
      else assert.throws(() => verifyRetainedCapability(f.scope, ID, f.lock), { code: "integrity-drift" });
    } else assert.equal(existsSync(dest), false);
    const leftovers = readdirSync(dirname(dest)).filter((name) => name.startsWith(".staging-"));
    if (scenario === "drift-cleanup-failure") {
      assert.equal(leftovers.length, 1);
      assert.equal(caught.stagingPath, join(dirname(dest), leftovers[0]));
      assert.ok(caught instanceof AggregateError);
      assert.equal(caught.cause, caught.errors[0]);
      assert.equal(caught.cause.code, "integrity-drift");
      assert.equal(caught.errors[1], cleanupError);
      assert.match(caught.message, /expected sha256-.*got sha256-.*artifact staging cleanup failed at/);
      assert.match(caught.message, /bounded staging cleanup failure/);
    } else assert.deepEqual(leftovers, []);
  });
}

// Separate isolate, real filesystem, explicit barrier: no timing/retry-based
// race qualification. Splitting the write exposes BOTH the empty and partial
// file windows even when Node normally uses its native writeFile fast path.
function pausedMetadataPreparer(f, window) {
  const barrier = new Int32Array(new SharedArrayBuffer(4));
  const module = new URL("../lib/capability-artifacts.mjs", import.meta.url).href;
  const worker = new Worker(String.raw`
    const { workerData: d, parentPort } = require('node:worker_threads');
    const fs = require('node:fs');
    const { join } = require('node:path');
    const { syncBuiltinESMExports } = require('node:module');
    const control = new Int32Array(d.barrier);
    const original = { mkdir: fs.mkdtempSync, write: fs.writeFileSync, link: fs.linkSync };
    const store = join(d.scope, '.agents/capabilities/artifacts');
    const ignore = join(store, '.gitignore');
    let staging;
    function pause(point) {
      if (point !== d.window) return;
      parentPort.postMessage({ type: 'paused', point, staging, temp: staging ? join(staging, '.gitignore') : ignore });
      Atomics.wait(control, 0, 0);
    }
    fs.mkdtempSync = (prefix, ...args) => {
      const result = original.mkdir(prefix, ...args);
      if (prefix === join(store, '.gitignore-')) { staging = result; pause('directory-created'); }
      return result;
    };
    fs.writeFileSync = (path, bytes, options) => {
      if (bytes !== '*\n' || (path !== ignore && path !== (staging && join(staging, '.gitignore')))) {
        return original.write(path, bytes, options);
      }
      if (options?.flag !== 'wx') throw new Error('metadata must be exclusively created');
      const fd = fs.openSync(path, options.flag, options.mode);
      try {
        pause('opened');
        fs.writeSync(fd, '*');
        pause('partial');
        fs.writeSync(fd, '\n');
      } finally { fs.closeSync(fd); }
      pause('written');
    };
    fs.linkSync = (from, to) => {
      const result = original.link(from, to);
      if (to === ignore) pause('linked');
      return result;
    };
    syncBuiltinESMExports();
    import(d.module).then(({ retainCapabilityArtifact }) => {
      const result = retainCapabilityArtifact(d.scope, d.installed, d.id, d.lock);
      parentPort.postMessage({ type: 'done', result });
    });
  `, { eval: true, workerData: { ...f, id: ID, module, window, barrier: barrier.buffer } });
  let pauseResolve, pauseReject, doneResolve, doneReject, paused = false, result;
  const ready = new Promise((resolve, reject) => { pauseResolve = resolve; pauseReject = reject; });
  const done = new Promise((resolve, reject) => { doneResolve = resolve; doneReject = reject; });
  // An assertion can fail while the worker is paused; final termination must
  // not turn its expected early exit into an unhandled rejection.
  done.catch(() => {});
  worker.on("message", (message) => {
    if (message.type === "paused") { paused = true; pauseResolve(message); }
    if (message.type === "done") result = message.result;
  });
  worker.on("error", (error) => { pauseReject(error); doneReject(error); });
  worker.on("exit", (code) => {
    const error = new Error(`metadata preparer exited ${code} without the expected checkpoint/result`);
    if (!paused) pauseReject(error);
    if (code === 0 && result) doneResolve(result);
    else doneReject(error);
  });
  return {
    worker, ready, done,
    resume() { Atomics.store(barrier, 0, 1); Atomics.notify(barrier, 0); },
  };
}

for (const window of ["directory-created", "opened", "partial", "written", "linked"]) {
  test(`atomic ignore publication: two preparers with first paused at ${window}`, { timeout: 15000 }, async (t) => {
    const f = fixture(t);
    chmodSync(f.installed, 0o750);
    chmodSync(join(f.installed, "skills"), 0o550);
    chmodSync(join(f.installed, "skills/expert"), 0o550);
    const dest = retainedCapabilityDir(f.scope, ID, f.lock.capabilities[ID].integrity);
    const store = dirname(dirname(dest)), ignore = join(store, ".gitignore");
    const otherMetadata = join(store, ".gitignore-other-producer");
    const otherPayload = join(dirname(dest), ".staging-other-producer");
    write(join(otherMetadata, ".gitignore"), "*");
    write(join(otherPayload, "tree/payload"), "another preparer's unpublished bytes\n");
    symlinkSync(f.installed, join(otherPayload, "source-link"));
    chmodSync(otherMetadata, 0o500);
    chmodSync(join(otherPayload, "tree"), 0o500);
    const priorScope = join(f.base, "prior-scope");
    mkdirSync(priorScope);
    const prior = retainCapabilityArtifact(priorScope, f.installed, ID, f.lock);
    const protectedRoots = [f.source, f.installed, prior.dir, otherMetadata, otherPayload];
    const before = protectedRoots.map(snapshot);
    const scopeBytes = [OATS_LOCK_FILE, "oats-config.yaml"].map((name) => readFileSync(join(f.scope, name)));
    const first = pausedMetadataPreparer(f, window);
    try {
      const paused = await first.ready;
      assert.equal(paused.point, window);
      assert.equal(existsSync(dest), false, "no artifact is published before metadata completion");
      if (window === "linked") {
        assert.equal(readFileSync(ignore, "utf8"), "*\n");
        assert.equal(lstatSync(ignore).ino, lstatSync(paused.temp).ino);
      } else assert.equal(existsSync(ignore), false, "empty/partial metadata must not have a public name");
      assert.equal(dirname(paused.staging), store, "metadata staging is on the store filesystem");
      assert.notEqual(paused.temp, ignore);
      if (window === "directory-created") assert.deepEqual(readdirSync(paused.staging), []);
      else assert.equal(readFileSync(paused.temp, "utf8"), { opened: "", partial: "*", written: "*\n", linked: "*\n" }[window]);
      const staged = snapshot(paused.staging);
      const stagedInode = lstatSync(paused.staging).ino;
      const publishedInode = window === "linked" ? lstatSync(ignore).ino : null;
      assert.deepEqual(protectedRoots.map(snapshot), before);

      // This preparer must finish NOW, while the other remains blocked. It
      // must neither wait for nor clean up another producer's incomplete temp.
      const second = retainCapabilityArtifact(f.scope, f.installed, ID, f.lock);
      assert.equal(second.status, "retained");
      assert.deepEqual(snapshot(paused.staging), staged);
      assert.equal(lstatSync(paused.staging).ino, stagedInode);
      assert.equal(lstatSync(ignore).isFile(), true);
      assert.equal(readFileSync(ignore, "utf8"), "*\n");
      const ignoreInode = lstatSync(ignore).ino, winnerInode = lstatSync(dest).ino;
      if (publishedInode !== null) assert.equal(ignoreInode, publishedInode);
      const winner = snapshot(dest), metadata = snapshot(ignore);
      assert.deepEqual(winner, snapshot(f.installed));
      assert.deepEqual(protectedRoots.map(snapshot), before);

      first.resume();
      const receipt = await first.done;
      assert.equal(receipt.status, "kept");
      assert.equal(receipt.dir, second.dir);
      assert.equal(verifyRetainedCapability(f.scope, ID, f.lock).dir, dest);
      assert.equal(lstatSync(ignore).ino, ignoreInode, "losing publisher never replaces existing metadata");
      assert.deepEqual(snapshot(ignore), metadata);
      assert.equal(lstatSync(dest).ino, winnerInode);
      assert.deepEqual(snapshot(dest), winner);
      assert.deepEqual(protectedRoots.map(snapshot), before);
      assert.deepEqual([OATS_LOCK_FILE, "oats-config.yaml"].map((name) => readFileSync(join(f.scope, name))), scopeBytes);
      assert.equal(existsSync(paused.staging), false, "only the owned metadata temp is removed");
      assert.deepEqual(readdirSync(store).sort(), [".gitignore", ".gitignore-other-producer", ID].sort());
      assert.deepEqual(readdirSync(dirname(dest)).sort(), [".staging-other-producer", receipt.integrity].sort());
    } finally {
      first.resume();
      await first.worker.terminate();
    }
  });
}

for (const timing of ["preexisting", "at-link"]) {
  for (const kind of ["empty", "bad", "symlink-valid", "symlink-broken", "directory", "valid"]) {
    test(`managed ignore ${timing} ${kind}: verify without replacement or repair`, (t) => {
      const f = fixture(t);
      const dest = retainedCapabilityDir(f.scope, ID, f.lock.capabilities[ID].integrity);
      const store = dirname(dirname(dest)), ignore = join(store, ".gitignore");
      mkdirSync(store, { recursive: true });
      const target = join(f.base, "ignore-target");
      write(target, "*\n");
      chmodSync(target, 0o400);
      let existing, inode, injected = false;
      const createExisting = () => {
        if (kind.startsWith("symlink")) symlinkSync(kind === "symlink-valid" ? target : join(f.base, "absent"), ignore);
        else if (kind === "directory") mkdirSync(ignore);
        else { write(ignore, { empty: "", bad: "unexpected\n", valid: "*\n" }[kind]); chmodSync(ignore, 0o400); }
        existing = snapshot(ignore);
        inode = lstatSync(ignore).ino;
        injected = true;
      };
      if (timing === "preexisting") createExisting();
      const protectedRoots = [f.source, f.installed, target];
      const before = protectedRoots.map(snapshot);
      const lockBytes = readFileSync(join(f.scope, OATS_LOCK_FILE));
      const originalLink = fs.linkSync, originalTemp = fs.mkdtempSync;
      let temps = 0, links = 0;
      withFsOverrides({
        mkdtempSync(prefix, ...args) {
          if (prefix === join(store, ".gitignore-")) temps++;
          return originalTemp(prefix, ...args);
        },
        linkSync(from, to) {
          assert.equal(to, ignore);
          assert.equal(readFileSync(from, "utf8"), "*\n", "link only a fully written candidate");
          links++;
          assert.equal(timing, "at-link", "preexisting entries need no publication attempt");
          createExisting();
          return originalLink(from, to); // real EEXIST, including dangling symlinks
        },
      }, () => {
        if (kind === "valid") assert.equal(retainCapabilityArtifact(f.scope, f.installed, ID, f.lock).status, "retained");
        else assert.throws(() => retainCapabilityArtifact(f.scope, f.installed, ID, f.lock), { code: "invalid-artifact-store" });
      });
      assert.equal(injected, true);
      assert.equal(temps, timing === "preexisting" ? 0 : 1);
      assert.equal(links, temps);
      assert.equal(lstatSync(ignore).ino, inode);
      assert.deepEqual(snapshot(ignore), existing);
      assert.deepEqual(protectedRoots.map(snapshot), before);
      assert.deepEqual(readFileSync(join(f.scope, OATS_LOCK_FILE)), lockBytes);
      assert.deepEqual(readdirSync(store).sort(), (kind === "valid" ? [".gitignore", ID] : [".gitignore"]).sort());
      assert.equal(existsSync(dest), kind === "valid");
      if (kind === "valid") assert.equal(verifyRetainedCapability(f.scope, ID, f.lock).dir, dest);
    });
  }
}

for (const fault of ["write-empty", "write-partial", "link", "after-link", "cleanup", "link-and-cleanup"]) {
  test(`managed ignore fault at ${fault}: preserve diagnosis, public state and other producer staging`, (t) => {
    const f = fixture(t);
    const dest = retainedCapabilityDir(f.scope, ID, f.lock.capabilities[ID].integrity);
    const store = dirname(dirname(dest)), ignore = join(store, ".gitignore");
    const other = join(store, ".gitignore-other-producer");
    write(join(other, ".gitignore"), "*");
    chmodSync(other, 0o500);
    const protectedRoots = [f.source, f.installed, other];
    const before = protectedRoots.map(snapshot);
    const primary = Object.freeze(Object.assign(new Error("injected metadata I/O failure"), { code: "EIO", provenance: { operation: "metadata" } }));
    const cleanup = Object.freeze(Object.assign(new Error("injected metadata cleanup failure"), { code: "EACCES" }));
    const original = { write: fs.writeFileSync, link: fs.linkSync, rm: fs.rmSync };
    let staging, caught, injected = false, publicInode;
    withFsOverrides({
      writeFileSync(path, bytes, options) {
        assert.equal(bytes, "*\n");
        assert.equal(options.flag, "wx");
        staging = dirname(path);
        assert.equal(dirname(staging), store);
        const result = original.write(path, fault === "write-empty" ? "" : fault === "write-partial" ? "*" : bytes, options);
        if (fault.startsWith("write-")) { injected = true; throw primary; }
        return result;
      },
      linkSync(from, to) {
        assert.equal(readFileSync(from, "utf8"), "*\n");
        assert.equal(to, ignore);
        if (fault === "link" || fault === "link-and-cleanup") { injected = true; throw primary; }
        const result = original.link(from, to);
        publicInode = lstatSync(ignore).ino;
        if (fault === "after-link") { injected = true; throw primary; }
        return result;
      },
      rmSync(path, options) {
        assert.equal(path, staging, "cleanup touches only the current metadata producer's temp");
        if (fault === "cleanup" || fault === "link-and-cleanup") { injected = true; throw cleanup; }
        return original.rm(path, options);
      },
    }, () => {
      assert.throws(() => retainCapabilityArtifact(f.scope, f.installed, ID, f.lock), (error) => { caught = error; return true; });
    });
    assert.equal(injected, true);
    const cleanupFailed = fault === "cleanup" || fault === "link-and-cleanup";
    if (cleanupFailed) {
      assert.equal(caught.stagingPath, staging);
      assert.match(caught.message, /artifact ignore staging cleanup failed at/);
      assert.equal(caught.code, fault === "cleanup" ? "EACCES" : "EIO");
      assert.equal(caught.cause, fault === "cleanup" ? cleanup : primary);
      if (fault === "link-and-cleanup") {
        assert.ok(caught instanceof AggregateError);
        assert.deepEqual(caught.errors, [primary, cleanup]);
        assert.equal(caught.provenance, primary.provenance);
      }
    } else assert.equal(caught, primary);
    assert.equal(existsSync(staging), cleanupFailed);
    assert.equal(existsSync(ignore), publicInode !== undefined);
    if (publicInode !== undefined) {
      assert.equal(lstatSync(ignore).ino, publicInode, "failure cleanup never removes published metadata");
      assert.equal(readFileSync(ignore, "utf8"), "*\n");
    }
    assert.equal(existsSync(dirname(dest)), false, "no payload staging or capability directory before valid metadata + cleanup");
    assert.deepEqual(protectedRoots.map(snapshot), before);
    const expected = [".gitignore-other-producer"];
    if (publicInode !== undefined) expected.push(".gitignore");
    if (cleanupFailed) expected.push(staging.slice(store.length + 1));
    assert.deepEqual(readdirSync(store).sort(), expected.sort());
  });
}
