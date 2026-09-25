import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { historicalSessionRoots, initializeNativeHistory, nativeHistoryPath, prepareNativeStart, recordNativeStart } from "../lib/native-history.mjs";
import { sessionsForHome } from "../lib/sessions-for-home.mjs";
import { nativeLaunchLocations } from "../lib/session-roots.mjs";

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "native-history-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, "source"), user = join(base, "user");
  mkdirSync(home); mkdirSync(user);
  return { base, home, user };
}

test("unknown standalone/legacy roots fail closed; current-env and explicit API roots are opt-in inventories", t => {
  const f = fixture(t);
  mkdirSync(join(f.user, ".claude", "projects"), { recursive: true });
  const env = { HOME: f.user };
  for (const meta of [undefined, { harness: "claude", command: "'claude'" }, { launch: { version: 2, harness: "claude", env: { CLAUDE_CONFIG_DIR: { fromEnv: "CURRENT_ROOT" } } } }]) {
    if (meta) writeFileSync(join(f.home, "instance.json"), JSON.stringify(meta));
    assert.throws(() => sessionsForHome(f.home, { env }), /ENOENT/);
  }
  writeFileSync(join(f.home, "instance.json"), JSON.stringify({ launch: { version: 2, harness: "claude", env: {} } }));
  assert.deepEqual(sessionsForHome(f.home, { env, fallback: "current-env" }), []);
  assert.deepEqual(sessionsForHome(f.home, { roots: {} }), [], "explicit inventory excludes unspecified formats");
  assert.throws(() => sessionsForHome(f.home, { roots: { cc: [join(f.base, "missing")] } }), /ENOENT/);
});

test("Pi native option precedence, relative and tilde paths are retained as locations only", t => {
  const f = fixture(t), env = { HOME: f.user, PI_CODING_AGENT_DIR: "~/other", PI_CODING_AGENT_SESSION_DIR: "../sessions", API_KEY: "SECRET" };
  assert.deepEqual(nativeLaunchLocations("pi", { cwd: f.home, env }), [join(f.base, "sessions")]);
  assert.deepEqual(nativeLaunchLocations("pi", { cwd: f.home, env, args: ["@TASK.md", "--session-dir", "../first", "--session-dir=../last"] }), [join(f.base, "last")]);
  delete env.PI_CODING_AGENT_SESSION_DIR;
  assert.deepEqual(nativeLaunchLocations("pi", { cwd: f.home, env }), [join(f.user, "other", "sessions")]);
  initializeNativeHistory(f.home);
  const id = prepareNativeStart(f.home, "pi");
  recordNativeStart(f.home, id, "pi", ["--session-dir", "../actual", "--api-key", "ARGV_SECRET"], env);
  const rows = readdirSync(nativeHistoryPath(f.home)).map(n => readFileSync(join(nativeHistoryPath(f.home), n), "utf8")).join("");
  assert.doesNotMatch(rows, /SECRET|API_KEY|--api-key|PI_CODING/);
  assert.deepEqual(historicalSessionRoots(f.home).pi, [join(f.base, "actual")]);
});

test("unsupported explicit Pi session leaves custody pending; recorder never invents a default root", t => {
  const f = fixture(t);
  initializeNativeHistory(f.home);
  const id = prepareNativeStart(f.home, "pi");
  assert.throws(() => recordNativeStart(f.home, id, "pi", ["--session", "private-source"], { HOME: f.user }), /explicit Pi/);
  assert.throws(() => historicalSessionRoots(f.home), /pending/);
  assert.equal(readFileSync(join(nativeHistoryPath(f.home), `${id}.json`), "utf8").includes("private-source"), false);
});

test("history retains unknown earlier starts, interrupted writes and pending evidence across retries", t => {
  const f = fixture(t);
  const id = prepareNativeStart(f.home, "claude"); // no independent scaffold authority
  recordNativeStart(f.home, id, "claude", [], { HOME: f.user });
  assert.throws(() => historicalSessionRoots(f.home), /earlier launches/);
  initializeNativeHistory(f.home); // a name reuse cannot erase the history gap
  assert.throws(() => historicalSessionRoots(f.home), /earlier launches/);
  const newer = join(f.base, "newer"); mkdirSync(newer); initializeNativeHistory(newer);
  writeFileSync(join(nativeHistoryPath(newer), "unfinished.tmp"), "{}");
  assert.throws(() => historicalSessionRoots(newer), /unfinished/);
});


test("a substituted source-home leaf cannot select another home's empty history", t => {
  const f = fixture(t), other = join(f.base, "other"), preserved = join(f.base, "preserved-source");
  mkdirSync(other); initializeNativeHistory(f.home); initializeNativeHistory(other);
  const originalAuthority = nativeHistoryPath(f.home);
  renameSync(f.home, preserved); symlinkSync(other, f.home);
  assert.throws(() => nativeHistoryPath(f.home), /substituted/);
  assert.throws(() => historicalSessionRoots(f.home), /substituted/);
  assert.throws(() => sessionsForHome(f.home), /substituted/);
  assert.equal(JSON.parse(readFileSync(join(originalAuthority, "history.json"))).home, f.home);
  assert.deepEqual(historicalSessionRoots(other), { cc: [], pi: [], codex: [] });
  rmSync(f.home); renameSync(preserved, f.home);
  assert.equal(nativeHistoryPath(f.home), originalAuthority);
});

test("recorded native root symlinks retain their execution-time target after retargeting", t => {
  const f = fixture(t), first = join(f.base, "first"), second = join(f.base, "second"), link = join(f.base, "native");
  mkdirSync(join(first, "projects"), { recursive: true }); mkdirSync(join(second, "projects"), { recursive: true }); symlinkSync(first, link);
  initializeNativeHistory(f.home);
  const id = prepareNativeStart(f.home, "claude");
  recordNativeStart(f.home, id, "claude", [], { HOME: f.user, CLAUDE_CONFIG_DIR: link });
  rmSync(link); symlinkSync(second, link);
  assert.deepEqual(historicalSessionRoots(f.home).cc, [join(first, "projects")]);
});
