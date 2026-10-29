// A warm reader never answers from an install that changed under it (awebai/oats#1630, lib/install-stamp.mjs;
// docs/desktop-cli-api.md "The warm reader"). A reader started from a copy of this kernel answers a request; then a
// file of the copy changes, and the next two requests, sent in one write so that one is queued, are both refused
// E_READER_STALE with their ids, never answered, and the reader exits 0 by itself (its stdin still open). One case
// per kind of stamp input: a lib file's content, a file added under lib/, package.json, and a docs schema whose
// mtime alone changes. The copy holds what the CLI loads: bin/, lib/, docs/, package.json, package-catalog.json,
// packages/record/ (lib/ imports it) and a node_modules link to this checkout's. The baseline is taken before the
// kernel loads (lib/install-stamp.mjs, from bin/oats.mjs), so a change while the reader starts is refused too; and a
// dependency is stamped where it resolves now, so one newly installed nearer the install, shadowing the loaded one,
// is a change.
import test from "node:test";
import module from "node:module";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const FRAME_TIMEOUT_MS = 30_000;
const STALE = "E_READER_STALE";

/** `oats reader --stdio` of the install at `root`, as a client starts it: stdin and stdout piped, stderr drained. */
function startReader(root, env, nodeArgs = []) {
  const child = spawn(process.execPath, [...nodeArgs, join(root, "bin", "oats.mjs"), "reader", "--stdio"], { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d) => { if (stderr.length < 256 * 1024) stderr += d; });
  const frames = [], waiting = [];
  let closed = false;
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const frame = JSON.parse(line);
    if (waiting.length) waiting.shift().done(frame); else frames.push(frame);
  });
  lines.on("close", () => { closed = true; for (const w of waiting.splice(0)) w.done(null); });
  const exited = new Promise((done) => child.on("exit", (code, signal) => done({ code, signal })));
  return {
    child, exited, stderr: () => stderr,
    /** The next frame, or null once its stdout has ended. */
    next: () => (frames.length ? Promise.resolve(frames.shift()) : closed ? Promise.resolve(null) : new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`no frame from the reader in ${FRAME_TIMEOUT_MS} ms\n${stderr}`)), FRAME_TIMEOUT_MS);
      waiting.push({ done: (frame) => { clearTimeout(timer); done(frame); } });
    })),
    send: (...requests) => child.stdin.write(requests.map((r) => `${JSON.stringify(r)}\n`).join("")),
  };
}
const within = (promise, ms, what) => Promise.race([promise, new Promise((_, fail) => setTimeout(() => fail(new Error(`timed out: ${what}`)), ms).unref())]);

/** A copy of this kernel's install under `dir` → its root. Its node_modules link is in the install (`modules:
 *  "root"`) or in `dir` above it, where Node finds it the same way (`"parent"`, a hoisted layout). */
function copyInstall(dir, { modules = "root" } = {}) {
  const root = join(dir, "install");
  mkdirSync(join(root, "packages"), { recursive: true });
  for (const name of ["bin", "lib", "docs", "package.json", "package-catalog.json"]) cpSync(join(ROOT, name), join(root, name), { recursive: true });
  cpSync(join(ROOT, "packages", "record"), join(root, "packages", "record"), { recursive: true, filter: (src) => !src.split("/").includes("node_modules") });
  symlinkSync(realpathSync(join(ROOT, "node_modules")), join(modules === "root" ? root : dir, "node_modules"));
  return root;
}

test("a reader whose install changed refuses the request and every queued one E_READER_STALE, then exits 0", { timeout: 300_000 }, async (t) => {
  const fx = v2Deployment({ t, name: "reader-install-ws" });
  const root = copyInstall(fx.base);
  const empty = join(fx.base, "empty");
  mkdirSync(empty);
  const readers = [];
  fx.beforeCleanup(() => { for (const r of readers) if (r.child.exitCode === null && r.child.signalCode === null) r.child.kill("SIGKILL"); });
  const schema = readdirSync(join(root, "docs")).find((n) => n.endsWith(".schema.json"));
  assert.ok(schema, "fixture premise: the install has a docs schema");

  const changes = [
    ["a lib file's content", () => appendFileSync(join(root, "lib", "semver.mjs"), "\n// changed under the reader\n")],
    ["a file added under lib/", () => writeFileSync(join(root, "lib", "added-under-the-reader.mjs"), "export {};\n")],
    ["package.json", () => {
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      writeFileSync(join(root, "package.json"), `${JSON.stringify({ ...pkg, description: `${pkg.description ?? ""} (changed)` }, null, 2)}\n`);
    }],
    ["a docs schema's mtime alone", () => {
      const file = join(root, "docs", schema), { size, mtime } = statSync(file);
      utimesSync(file, mtime, new Date(mtime.getTime() - 60_000));
      assert.equal(statSync(file).size, size, "fixture premise: only its mtime changed");
    }],
  ];
  for (const [what, change] of changes) {
    await t.test(what, async () => {
      const reader = startReader(root, fx.env);
      readers.push(reader);
      const hello = await reader.next();
      assert.equal(hello?.readerApi, 1, `the hello\n${reader.stderr()}`);

      // Its install unchanged: an answer (no deployment at --dir is the CLI's own answer).
      reader.send({ id: "before", argv: ["status", "--dir", empty, "--json"] });
      const before = await reader.next();
      assert.equal(before?.id, "before", JSON.stringify(before));
      assert.equal(before.exit, 1, JSON.stringify(before));
      assert.equal(before.answer.error.code, "E_NO_DEPLOYMENT", JSON.stringify(before));

      change();
      // Two requests in one write: the second is queued behind the first.
      reader.send({ id: "after", argv: ["status", "--dir", empty, "--json"] }, { id: 2, argv: ["workspace", "status", "--dir", empty, "--json"] });
      const frames = [await reader.next(), await reader.next()];
      for (const [i, frame] of frames.entries()) {
        assert.ok(frame, `frame ${i}: a refusal, not silence\n${reader.stderr()}`);
        assert.deepEqual(Object.keys(frame).sort(), ["id", "refused"], `frame ${i}: a refusal, never an answer: ${JSON.stringify(frame)}`);
        assert.equal(frame.refused.code, STALE, JSON.stringify(frame));
        assert.equal(typeof frame.refused.message, "string");
      }
      assert.deepEqual(frames.map((f) => f.id), ["after", 2], "each refusal carries its request's id, in order");
      // It exits by itself, its stdin still open, and says nothing more.
      assert.deepEqual(await within(reader.exited, 10_000, "the stale reader exits by itself"), { code: 0, signal: null }, reader.stderr());
      assert.equal(await reader.next(), null, "no frame after the refusals");
      reader.child.stdin.destroy();
    });
  }
});

/** Its install unchanged, a reader answers (no deployment at `dir` is the CLI's own answer). */
async function answers(reader, dir) {
  reader.send({ id: "before", argv: ["status", "--dir", dir, "--json"] });
  const before = await reader.next();
  assert.equal(before?.id, "before", `${JSON.stringify(before)}\n${reader.stderr()}`);
  assert.equal(before.answer?.error?.code, "E_NO_DEPLOYMENT", JSON.stringify(before));
}
/** The next request is refused E_READER_STALE, never answered, and the reader exits 0 by itself. */
async function refusesStale(reader, dir) {
  reader.send({ id: "after", argv: ["status", "--dir", dir, "--json"] });
  const frame = await reader.next();
  assert.ok(frame, `a refusal, not silence\n${reader.stderr()}`);
  assert.deepEqual(frame, { id: "after", refused: { code: STALE, message: frame.refused?.message } }, JSON.stringify(frame));
  assert.deepEqual(await within(reader.exited, 10_000, "the stale reader exits by itself"), { code: 0, signal: null }, reader.stderr());
  reader.child.stdin.destroy();
}

test("an install that changes while the reader starts, after its baseline and before its hello, is refused at the first request", { timeout: 120_000, skip: typeof module.registerHooks !== "function" && "module.registerHooks is newer than this Node" }, async (t) => {
  const fx = v2Deployment({ t, name: "reader-start-ws" });
  const root = copyInstall(fx.base);
  const empty = join(fx.base, "empty");
  mkdirSync(empty);
  // The race made certain: as the kernel's own read-call.mjs loads (after the baseline), a lib file of the install changes.
  const hook = join(fx.base, "change-on-load.mjs");
  writeFileSync(hook, `import module from "node:module";
import { appendFileSync } from "node:fs";
let changed = false;
module.registerHooks({ load(url, context, nextLoad) {
  if (!changed && url.endsWith("/lib/read-call.mjs")) { changed = true; appendFileSync(${JSON.stringify(join(root, "lib", "semver.mjs"))}, "\\n// changed while the reader started\\n"); }
  return nextLoad(url, context);
} });
`);
  const reader = startReader(root, fx.env, ["--import", hook]);
  fx.beforeCleanup(() => { if (reader.child.exitCode === null && reader.child.signalCode === null) reader.child.kill("SIGKILL"); });
  assert.equal((await reader.next())?.readerApi, 1, `the hello\n${reader.stderr()}`);
  assert.match(readFileSync(join(root, "lib", "semver.mjs"), "utf8"), /changed while the reader started/, "fixture premise: the hook changed the install");
  await refusesStale(reader, empty);
});

test("a dependency newly installed nearer the install, shadowing the one the reader loaded, is a change", { timeout: 120_000 }, async (t) => {
  const fx = v2Deployment({ t, name: "reader-shadow-ws" });
  // A hoisted layout: yaml resolves from node_modules above the install.
  const root = copyInstall(fx.base, { modules: "parent" });
  const empty = join(fx.base, "empty");
  mkdirSync(empty);
  const reader = startReader(root, fx.env);
  fx.beforeCleanup(() => { if (reader.child.exitCode === null && reader.child.signalCode === null) reader.child.kill("SIGKILL"); });
  assert.equal((await reader.next())?.readerApi, 1, `the hello\n${reader.stderr()}`);
  await answers(reader, empty);
  // Nothing the reader loaded changes: yaml now resolves to a new package in the install's own node_modules.
  mkdirSync(join(root, "node_modules", "yaml"), { recursive: true });
  writeFileSync(join(root, "node_modules", "yaml", "package.json"), `${JSON.stringify({ name: "yaml", version: "0.0.0-shadow" })}\n`);
  await refusesStale(reader, empty);
});
