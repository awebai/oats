// oats.core's Claude Code waiting emitter (the first producer of `oats instance waiting`):
// its spawn/launch hook manages oats.core's own entries in <home>/.claude/settings.json,
// and claude-waiting.sh, which those entries run, reports set/clear through the CLI.
// The script's pinned condition: it can never hurt the Claude session — exit 0, empty
// stdout, bounded time — whatever the CLI or the environment does.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeWaitingSettings, markerDir, markerPath, mergeSettings, shq, waitingCommand } from "../oats-package/capabilities/oats-core/bin/oats-core.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CAP = join(ROOT, "oats-package", "capabilities", "oats-core");
const HOOK = join(CAP, "bin", "oats-core.mjs");
const SCRIPT = realpathSync(join(CAP, "bin", "claude-waiting.sh"));
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-core-waiting-")));
test.after(() => rmSync(base, { recursive: true, force: true }));

const TMP = join(base, "tmp"); mkdirSync(TMP);
/** Where claude-waiting.sh keeps the debounce marker of home `h` under temp dir `tmp`. */
// The per-user marker directory under TMPDIR (XDG_RUNTIME_DIR is unset in these runs).
const WDIR = `oats-waiting-${process.getuid()}`;
const markerOf = (h, tmp = TMP) => join(tmp, WDIR, `${createHash("sha256").update(h).digest("hex").slice(0, 16)}.claude`);
let n = 0;
/** A fresh instance home: a directory with an instance.json. */
function home() {
  const h = join(base, `home-${++n}`);
  mkdirSync(h, { recursive: true });
  writeFileSync(join(h, "instance.json"), "{}\n");
  return h;
}
// A fake kernel CLI that records its argv; FAKE_MODE selects how it misbehaves.
const FAKE_CLI = join(base, "fake-cli.mjs");
// FAKE_SET_DELAY_MS / FAKE_CLEAR_DELAY_MS delay that action's record (a slow call the other
// overtakes); FAKE_CWD_LOG
// records the cwd the CLI ran in.
writeFileSync(FAKE_CLI, `import { appendFileSync } from "node:fs";
const delay = Number((process.argv[4] === "set" ? process.env.FAKE_SET_DELAY_MS : process.env.FAKE_CLEAR_DELAY_MS) || 0);
setTimeout(() => {
  if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
  if (process.env.FAKE_CWD_LOG) appendFileSync(process.env.FAKE_CWD_LOG, process.cwd() + "\\n");
  const mode = process.env.FAKE_MODE || "ok";
  if (mode === "fail") { process.stdout.write('{"decision":"block","reason":"from stdout"}\\n'); process.stderr.write("boom on stderr\\n"); process.exit(1); }
  if (mode === "hang") setTimeout(() => {}, 30000);
  if (mode === "ok") process.stdout.write('{"ok":true}\\n');
}, delay);
`);
const FAKE_CLI_ABS = "/fake/oats/bin/oats.mjs"; // the CLI path the hook bakes; never run

function cleanEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  return env;
}
function runHook(event, env) {
  const r = spawnSync(process.execPath, [HOOK, event], { cwd: base, encoding: "utf8", timeout: 20000, env: cleanEnv({ OATS_EVENT: event, OATS_LAUNCH_PREVIEW: undefined, TMPDIR: TMP, XDG_RUNTIME_DIR: undefined, ...env }) });
  assert.equal(r.status, 0, r.stderr);
  const last = r.stdout.trim().split("\n").filter(Boolean).pop();
  return JSON.parse(last);
}
// The marker argument the launch hook passes: the home's marker under TMPDIR's per-user
// directory (created 0700 when absent, as markerDir does). An explicit one is kept.
function withMarker(args, env = {}) {
  const want = args[0] === "set" ? 5 : 4;
  if (!["set", "clear", "clear-tool"].includes(args[0]) || args.length >= want || !env.OATS_INSTANCE_HOME) return args;
  const tmp = env.TMPDIR ?? TMP, dir = join(tmp, WDIR);
  let present = true; try { lstatSync(dir); } catch { present = false; }
  if (!present) { mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700); }
  return [...args, markerOf(env.OATS_INSTANCE_HOME, tmp)];
}
function runScript(args, env) {
  const started = Date.now();
  // TMPDIR is the test's own: the debounce marker lives under it, never in a real temp dir.
  const r = spawnSync("/bin/sh", [SCRIPT, ...withMarker(args, env)], { encoding: "utf8", timeout: 15000, env: cleanEnv({ TMPDIR: TMP, XDG_RUNTIME_DIR: undefined, ...env }) });
  return { ...r, ms: Date.now() - started };
}
const settingsOf = (h) => join(h, ".claude", "settings.json");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const allEntries = (settings) => Object.values(settings.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks));

test("the launch hook answers {} for claude in preview and real mode alike, and the preview writes nothing", () => {
  const h = home();
  const env = { OATS_HARNESS: "claude", OATS_INSTANCE_HOME: h, OATS_CLI_BIN: FAKE_CLI_ABS };
  assert.deepEqual(runHook("launch", { ...env, OATS_LAUNCH_PREVIEW: "1" }), {});
  assert.ok(!existsSync(join(h, ".claude")), "the preview created nothing");
  assert.deepEqual(runHook("launch", env), {});
  assert.ok(existsSync(settingsOf(h)), "the real pass wrote the settings");
  // A second preview on a written home answers the same and changes nothing.
  const before = readFileSync(settingsOf(h), "utf8");
  assert.deepEqual(runHook("launch", { ...env, OATS_LAUNCH_PREVIEW: "1" }), {});
  assert.equal(readFileSync(settingsOf(h), "utf8"), before);
});

test("codex and pi: the hook answers {} and writes nothing, at spawn and at launch", () => {
  for (const harness of ["codex", "pi"]) for (const event of ["spawn", "launch"]) {
    const h = home();
    assert.deepEqual(runHook(event, { OATS_HARNESS: harness, OATS_INSTANCE_HOME: h, OATS_CLI_BIN: FAKE_CLI_ABS }), {});
    assert.ok(!existsSync(join(h, ".claude")), `${harness} ${event}: nothing written`);
  }
});

test("the real pass writes settings.json 0600 with absolute, single-quoted commands that end in `; exit 0`, timeout 5", () => {
  const h = home();
  assert.deepEqual(runHook("spawn", { OATS_HARNESS: "claude", OATS_INSTANCE_HOME: h, OATS_CLI_BIN: FAKE_CLI_ABS }), {});
  assert.equal(statSync(settingsOf(h)).mode & 0o777, 0o600);
  const settings = readJson(settingsOf(h));
  assert.deepEqual(Object.keys(settings), ["hooks"]);
  assert.deepEqual(Object.keys(settings.hooks), ["Notification", "PreToolUse", "PostToolUse", "PostToolUseFailure", "UserPromptSubmit", "Stop", "SessionEnd"]);
  const map = Object.entries(settings.hooks).flatMap(([event, groups]) => groups.map((g) => [event, g.matcher ?? null, g.hooks.map((e) => e.command.match(/claude-waiting\.sh' ((?:set \w+)|clear(?:-tool)?) /)[1])]));
  assert.deepEqual(map, [
    ["Notification", "permission_prompt", ["set permission"]],
    ["Notification", "elicitation_dialog", ["set question"]],
    ["PreToolUse", "AskUserQuestion", ["set question"]],
    ["PreToolUse", "^(?!AskUserQuestion$).*", ["clear-tool"]],
    ["PostToolUse", "*", ["clear-tool"]],
    ["PostToolUseFailure", "*", ["clear-tool"]],
    ["UserPromptSubmit", null, ["clear"]],
    ["Stop", null, ["clear"]],
    ["SessionEnd", null, ["clear"]],
  ]);
  const node = process.execPath;
  for (const e of allEntries(settings)) {
    assert.deepEqual(Object.keys(e).sort(), ["command", "timeout", "type"]);
    assert.equal(e.type, "command");
    assert.equal(e.timeout, 5);
    assert.match(e.command, /; exit 0$/);
    assert.ok(e.command.startsWith(`/bin/sh ${shq(SCRIPT)} `), e.command);
    assert.ok(e.command.endsWith(` ${shq(node)} ${shq(FAKE_CLI_ABS)} ${shq(markerOf(h))} >/dev/null 2>&1; exit 0`), e.command);
    assert.ok(!/\bagent\b/.test(e.command), "no command names producer agent");
  }
  // The JS regex Claude Code compiles for the catch-all PreToolUse matcher skips only AskUserQuestion.
  const other = new RegExp("^(?!AskUserQuestion$).*");
  assert.ok(other.test("Bash") && other.test("AskUserQuestions") && !other.test("AskUserQuestion"));
});

test("commands quote paths with spaces and single quotes: /bin/sh receives them intact", () => {
  const dir = join(base, "it's a dir");
  mkdirSync(dir, { recursive: true });
  const recorder = join(dir, "rec'order.sh"), log = join(base, "quoted.log");
  writeFileSync(recorder, `printf '%s\\n' "$@" > ${shq(log)}\n`);
  const cmd = waitingCommand({ script: recorder, node: join(dir, "no de"), cli: join(dir, "c'li.mjs") }, ["set", "permission"]);
  const r = spawnSync("/bin/sh", ["-c", cmd], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), ["set", "permission", join(dir, "no de"), join(dir, "c'li.mjs")]);
});

test("merge by marker: unrelated keys and hooks stay, in order; a second run is a no-op; old entries are replaced, not duplicated", () => {
  const h = home();
  mkdirSync(join(h, ".claude"));
  const foreign = { type: "command", command: "/usr/local/bin/notify-me", timeout: 10 };
  const stale = { type: "command", command: `/bin/sh ${shq(SCRIPT)} clear '/old/node' '/old/oats.mjs' >/dev/null 2>&1 </dev/null; exit 0`, timeout: 5 };
  const existing = {
    model: "opus",
    permissions: { allow: ["Bash(ls:*)"] },
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [foreign] }, { matcher: "*", hooks: [stale] }, { matcher: "Edit", hooks: [stale, foreign] }],
      Stop: [{ hooks: [stale] }],
      PostCompact: [],
    },
    env: { FOO: "1" },
  };
  writeFileSync(settingsOf(h), JSON.stringify(existing));
  const env = { OATS_HARNESS: "claude", OATS_INSTANCE_HOME: h, OATS_CLI_BIN: FAKE_CLI_ABS };
  assert.deepEqual(runHook("launch", env), {});
  const merged = readJson(settingsOf(h));
  assert.deepEqual(Object.keys(merged), ["model", "permissions", "hooks", "env"], "top-level keys keep their order");
  assert.equal(merged.model, "opus");
  assert.deepEqual(merged.permissions, existing.permissions);
  assert.deepEqual(merged.env, existing.env);
  assert.deepEqual(Object.keys(merged.hooks), ["PreToolUse", "PostCompact", "Notification", "PostToolUse", "PostToolUseFailure", "UserPromptSubmit", "Stop", "SessionEnd"], "existing events keep their slots; Stop, emptied by the removal, is dropped and comes back with ours, appended");
  // The foreign groups survive in order; the group emptied of our stale entry is gone; a mixed group keeps its foreign entry.
  assert.deepEqual(merged.hooks.PreToolUse.slice(0, 2), [{ matcher: "Bash", hooks: [foreign] }, { matcher: "Edit", hooks: [foreign] }]);
  assert.deepEqual(merged.hooks.PostCompact, [], "an event array that was already empty is not ours to drop");
  const ours = allEntries(merged).filter((e) => e.command.includes(SCRIPT));
  assert.equal(ours.length, 9, "exactly our nine entries, no stale one left");
  assert.ok(!JSON.stringify(merged).includes("/old/node"));
  // Second run: no write at all.
  const before = readFileSync(settingsOf(h), "utf8");
  const mtime = statSync(settingsOf(h)).mtimeMs;
  assert.deepEqual(runHook("launch", env), {});
  assert.equal(readFileSync(settingsOf(h), "utf8"), before);
  assert.equal(statSync(settingsOf(h)).mtimeMs, mtime, "unchanged content is not rewritten");
});

test("mergeSettings (pure): the Stop event re-added as ours, nothing foreign touched", () => {
  const ours = claudeWaitingSettings({ script: "/m/claude-waiting.sh", node: "/n", cli: "/c" });
  const r = mergeSettings({ hooks: { Stop: [{ hooks: [{ type: "command", command: "/bin/sh '/m/claude-waiting.sh' clear '/x' '/y'" }] }] } }, ours, "/m/claude-waiting.sh");
  assert.equal(r.ok, true);
  assert.deepEqual(r.settings.hooks.Stop, ours.hooks.Stop);
  for (const bad of [[], "x", null, { hooks: [] }, { hooks: { Stop: {} } }]) assert.equal(mergeSettings(bad, ours, "/m/claude-waiting.sh").ok, false, JSON.stringify(bad));
});

test("an unparseable or non-object settings.json is left untouched, with a warning and exit 0", () => {
  for (const text of ["{ not json", "[1,2]", '{"hooks": []}', '{"hooks": {"Stop": {"bad": true}}}']) {
    const h = home();
    mkdirSync(join(h, ".claude"));
    writeFileSync(settingsOf(h), text);
    const answer = runHook("launch", { OATS_HARNESS: "claude", OATS_INSTANCE_HOME: h, OATS_CLI_BIN: FAKE_CLI_ABS });
    assert.match(answer.warning, /left it alone/, text);
    assert.deepEqual(Object.keys(answer), ["warning"]);
    assert.equal(readFileSync(settingsOf(h), "utf8"), text);
  }
});

test("a symlinked settings.json or .claude is left untouched, with a warning", () => {
  const h = home();
  mkdirSync(join(h, ".claude"));
  const target = join(base, "elsewhere-settings.json");
  writeFileSync(target, "{}\n");
  symlinkSync(target, settingsOf(h));
  const answer = runHook("launch", { OATS_HARNESS: "claude", OATS_INSTANCE_HOME: h, OATS_CLI_BIN: FAKE_CLI_ABS });
  assert.match(answer.warning, /not a regular file/);
  assert.equal(readFileSync(target, "utf8"), "{}\n");
  assert.ok(lstatSync(settingsOf(h)).isSymbolicLink());

  const h2 = home();
  const dir = join(base, "elsewhere-claude");
  mkdirSync(dir);
  symlinkSync(dir, join(h2, ".claude"));
  const answer2 = runHook("spawn", { OATS_HARNESS: "claude", OATS_INSTANCE_HOME: h2, OATS_CLI_BIN: FAKE_CLI_ABS });
  assert.match(answer2.warning, /not a directory/);
  assert.ok(!existsSync(join(dir, "settings.json")));
});

test("a missing or relative home or CLI path: a warning, nothing written", () => {
  const h = home();
  assert.match(runHook("launch", { OATS_HARNESS: "claude", OATS_INSTANCE_HOME: h, OATS_CLI_BIN: undefined }).warning, /OATS_CLI_BIN/);
  assert.match(runHook("launch", { OATS_HARNESS: "claude", OATS_INSTANCE_HOME: h, OATS_CLI_BIN: "bin/oats.mjs" }).warning, /OATS_CLI_BIN/);
  assert.ok(!existsSync(join(h, ".claude")));
  assert.match(runHook("launch", { OATS_HARNESS: "claude", OATS_INSTANCE_HOME: "relative/home", OATS_CLI_BIN: FAKE_CLI_ABS }).warning, /OATS_INSTANCE_HOME/);
});

test("the emitter only ever uses producer oats.core: it can never clear the agent's own claim", () => {
  const text = readFileSync(SCRIPT, "utf8");
  const producers = [...text.matchAll(/--producer\s+([^\s`;]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(producers)], ["oats.core"]);
  assert.ok(!/--producer\s+["']?agent/.test(text));
  const settings = claudeWaitingSettings({ script: SCRIPT, node: process.execPath, cli: FAKE_CLI_ABS });
  for (const e of allEntries(settings)) assert.ok(!e.command.includes("--producer"), "the producer is the script's, never a command's argument");
});

// PINNED condition 2: claude-waiting.sh can never hurt the Claude session.
test("PINNED: claude-waiting.sh exits 0 with empty stdout, in bounded time, whatever the CLI or environment does", { timeout: 60000 }, () => {
  const h = home();
  const node = process.execPath;
  const cases = [
    ["CLI exits 1 with stdout and stderr", ["set", "permission", node, FAKE_CLI], { OATS_INSTANCE_HOME: h, FAKE_MODE: "fail" }],
    ["CLI hangs (the watchdog)", ["set", "question", node, FAKE_CLI], { OATS_INSTANCE_HOME: h, FAKE_MODE: "hang" }],
    ["CLI clear hangs (the watchdog)", ["clear", node, FAKE_CLI], { OATS_INSTANCE_HOME: h, FAKE_MODE: "hang" }],
    ["CLI is a missing path", ["set", "permission", node, join(base, "missing.mjs")], { OATS_INSTANCE_HOME: h }],
    ["node is a missing path", ["set", "permission", join(base, "no-node"), FAKE_CLI], { OATS_INSTANCE_HOME: h }],
    ["home unset", ["set", "permission", node, FAKE_CLI], { OATS_INSTANCE_HOME: undefined }],
    ["home relative", ["set", "permission", node, FAKE_CLI], { OATS_INSTANCE_HOME: "relative" }],
    ["home nonexistent", ["set", "permission", node, FAKE_CLI], { OATS_INSTANCE_HOME: "/nonexistent" }],
    ["unknown reason", ["set", "bogus", node, FAKE_CLI], { OATS_INSTANCE_HOME: h }],
    ["unknown action", ["frob"], { OATS_INSTANCE_HOME: h }],
    ["no arguments", [], { OATS_INSTANCE_HOME: h }],
  ];
  for (const [what, args, env] of cases) {
    const r = runScript(args, env);
    assert.equal(r.status, 0, `${what}: exit ${r.status} ${r.signal || ""}`);
    assert.equal(r.stdout, "", `${what}: stdout must be empty`);
    assert.equal(r.stderr, "", `${what}: stderr is discarded`);
    assert.ok(r.ms < 5000, `${what}: took ${r.ms} ms`);
  }
});

test("set touches the marker and calls the CLI with the exact argv; clear without a marker starts no CLI; clear with one removes it and clears", () => {
  const h = home();
  const log = join(base, `argv-${n}.log`);
  const marker = markerOf(h);
  const node = process.execPath;
  const calls = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

  let r = runScript(["clear", node, FAKE_CLI], { OATS_INSTANCE_HOME: h, FAKE_LOG: log });
  assert.equal(r.status, 0); assert.equal(r.stdout, "");
  assert.deepEqual(calls(), [], "no marker: clear starts no node process");

  r = runScript(["set", "permission", node, FAKE_CLI], { OATS_INSTANCE_HOME: h, FAKE_LOG: log });
  assert.equal(r.status, 0); assert.equal(r.stdout, "");
  assert.ok(existsSync(marker), "set touches the marker");
  assert.deepEqual(calls(), [["instance", "waiting", "set", "--producer", "oats.core", "--reason", "permission", "--home", h, "--json"]]);

  r = runScript(["clear", node, FAKE_CLI], { OATS_INSTANCE_HOME: h, FAKE_LOG: log });
  assert.equal(r.status, 0); assert.equal(r.stdout, "");
  assert.ok(!existsSync(marker), "clear removes the marker");
  assert.deepEqual(calls()[1], ["instance", "waiting", "clear", "--producer", "oats.core", "--home", h, "--json"]);

  r = runScript(["clear", node, FAKE_CLI], { OATS_INSTANCE_HOME: h, FAKE_LOG: log });
  assert.equal(calls().length, 2, "a second clear is a no-op");
  assert.equal(statSync(join(TMP, WDIR)).mode & 0o777, 0o700, "the marker directory is private");
  assert.ok(!existsSync(join(h, ".oats-waiting-claude")), "nothing of the emitter's is kept in the home");
});

test("an open question is not relabelled by its own permission prompt: the marker holds the reason; any clear ends the question", () => {
  const h = home(), node = process.execPath;
  const log = join(base, `argv-question-${n}.log`);
  const calls = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  runScript(["set", "question", node, FAKE_CLI], { OATS_INSTANCE_HOME: h, FAKE_LOG: log });
  assert.match(readFileSync(markerOf(h), "utf8"), /^question \d+\n$/, "the marker holds the reason and its writer");
  const r = runScript(["set", "permission", node, FAKE_CLI], { OATS_INSTANCE_HOME: h, FAKE_LOG: log });
  assert.equal(r.status, 0); assert.equal(r.stdout, "");
  assert.deepEqual(calls().map((c) => c[6]), ["question"], "the permission prompt of an open question starts no CLI");
  runScript(["clear", node, FAKE_CLI], { OATS_INSTANCE_HOME: h, FAKE_LOG: log });
  runScript(["set", "permission", node, FAKE_CLI], { OATS_INSTANCE_HOME: h, FAKE_LOG: log });
  assert.deepEqual(calls().map((c) => c[2] === "clear" ? "clear" : c[6]), ["question", "clear", "permission"], "after a clear, a permission prompt sets permission");
  assert.match(readFileSync(markerOf(h), "utf8"), /^permission \d+\n$/);
});

test("an unusable marker means no debounce, never a skipped claim: a symlinked marker directory or a marker path that is not a regular file is not followed, and set and clear always call the CLI", () => {
  const node = process.execPath;
  // (a) the marker directory is a symlink: never followed, nothing written through it.
  const tmpA = join(base, `tmp-link-${n}`), elsewhere = join(base, `elsewhere-${n}`);
  mkdirSync(tmpA); mkdirSync(elsewhere); symlinkSync(elsewhere, join(tmpA, WDIR));
  // (b) the marker path exists as a directory.
  const tmpB = join(base, `tmp-dir-${n}`);
  for (const [tmp, prepare] of [[tmpA, () => {}], [tmpB, (h) => { mkdirSync(markerOf(h, tmpB), { recursive: true }); chmodSync(join(tmpB, WDIR), 0o700); }]]) {
    const h = home(); prepare(h);
    const log = join(base, `argv-unusable-${n}.log`);
    const calls = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).length : 0;
    let r = runScript(["clear", node, FAKE_CLI], { OATS_INSTANCE_HOME: h, FAKE_LOG: log, TMPDIR: tmp });
    assert.equal(r.status, 0); assert.equal(r.stdout, "");
    assert.equal(calls(), 1, "no usable marker: a clear calls the (idempotent) CLI");
    r = runScript(["set", "question", node, FAKE_CLI], { OATS_INSTANCE_HOME: h, FAKE_LOG: log, TMPDIR: tmp });
    assert.equal(r.status, 0); assert.equal(calls(), 2, "set still reports the claim");
  }
  assert.deepEqual(readdirSync(elsewhere), [], "nothing was written through the symlink");
});

test("markerDir vets the per-user directory once (at spawn or launch): created 0700; a 0777, group- or other-accessible, symlinked or non-directory one is refused and left as it is", () => {
  const uidDir = (tmp) => join(tmp, WDIR);
  const fresh = join(base, `vet-fresh-${n}`); mkdirSync(fresh);
  assert.equal(markerDir({ TMPDIR: fresh }), uidDir(fresh));
  assert.equal(statSync(uidDir(fresh)).mode & 0o7777, 0o700, "created 0700");
  assert.equal(markerDir({ TMPDIR: fresh }), uidDir(fresh), "an existing 0700 directory is used");
  for (const mode of [0o777, 0o770, 0o750, 0o701, 0o1700]) {
    const tmp = join(base, `vet-${mode.toString(8)}-${n}`); mkdirSync(uidDir(tmp), { recursive: true }); chmodSync(uidDir(tmp), mode);
    assert.equal(markerDir({ TMPDIR: tmp }), null, mode.toString(8));
    assert.equal(statSync(uidDir(tmp)).mode & 0o7777, mode, `${mode.toString(8)}: never repaired`);
  }
  const linked = join(base, `vet-link-${n}`), target = join(base, `vet-target-${n}`); mkdirSync(linked); mkdirSync(target, { mode: 0o700 }); symlinkSync(target, uidDir(linked));
  assert.equal(markerDir({ TMPDIR: linked }), null, "a symlink is never followed");
  const file = join(base, `vet-file-${n}`); mkdirSync(file); writeFileSync(uidDir(file), "x");
  assert.equal(markerDir({ TMPDIR: file }), null, "a file is not a directory");
  const xdg = join(base, `vet-xdg-${n}`); mkdirSync(xdg, { mode: 0o700 });
  assert.equal(markerDir({ XDG_RUNTIME_DIR: xdg, TMPDIR: fresh }), join(xdg, "oats-waiting"), "an absolute XDG_RUNTIME_DIR holds it");
  assert.equal(markerDir({ XDG_RUNTIME_DIR: "relative/run", TMPDIR: fresh }), uidDir(fresh), "a relative one is ignored");
  assert.equal(markerPath("/h/dev-1", "/d"), `/d/${createHash("sha256").update("/h/dev-1").digest("hex").slice(0, 16)}.claude`);
  // The hook bakes '' (no debounce) when the directory is refused.
  const h = home(), bad = join(base, `vet-hook-${n}`); mkdirSync(uidDir(bad), { recursive: true }); chmodSync(uidDir(bad), 0o777);
  runHook("spawn", { OATS_HARNESS: "claude", OATS_INSTANCE_HOME: h, OATS_CLI_BIN: FAKE_CLI_ABS, TMPDIR: bad });
  for (const e of allEntries(readJson(settingsOf(h)))) assert.ok(e.command.endsWith(` '' >/dev/null 2>&1; exit 0`), e.command);
});

test("macOS: markerDir refuses a directory whose ACL hides behind the xattr indicator (`drwx------@`), and accepts xattrs alone", { skip: process.platform !== "darwin" && "macOS ACLs" }, () => {
  const tmp = join(base, `vet-acl-${n}`), dir = join(tmp, WDIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
  spawnSync("chmod", ["+a", "everyone allow list,search,add_file,add_subdirectory,delete_child", dir]);
  spawnSync("xattr", ["-w", "oats.test", "x", dir]);
  const listing = spawnSync("ls", ["-lde", dir], { encoding: "utf8" }).stdout;
  assert.match(listing.split("\n")[0], /^drwx------@ /, "the ACL is concealed by the @ indicator");
  assert.match(listing, /everyone allow/);
  assert.equal(markerDir({ TMPDIR: tmp }), null);
  assert.equal(spawnSync("ls", ["-lde", dir], { encoding: "utf8" }).stdout, listing, "left untouched");
  spawnSync("chmod", ["-N", dir]);
  assert.match(spawnSync("ls", ["-ld", dir], { encoding: "utf8" }).stdout, /^drwx------@ /);
  assert.equal(markerDir({ TMPDIR: tmp }), dir, "an xattr alone does not refuse it");
});

test("the hot path runs no ls, hash or id; an unusable marker argument (empty, relative, under a missing directory) means no debounce and creates nothing", () => {
  const node = process.execPath;
  const bin = join(base, `hot-bin-${n}`), toolLog = join(base, `hot-tools-${n}.log`); mkdirSync(bin);
  for (const tool of ["ls", "shasum", "sha256sum", "cksum", "id", "mkdir"]) writeFileSync(join(bin, tool), `#!/bin/sh\necho ${tool} >> '${toolLog}'\nexit 1\n`, { mode: 0o755 });
  const h = home(), env = { OATS_INSTANCE_HOME: h, PATH: `${bin}:${process.env.PATH}` };
  runScript(["set", "permission", node, FAKE_CLI], env);
  spawnSync("/bin/sh", [SCRIPT, ...withMarker(["clear-tool", node, FAKE_CLI], env)], { input: '{"session_id":"s","hook_event_name":"PostToolUse"}', encoding: "utf8", timeout: 15000, env: cleanEnv({ TMPDIR: TMP, XDG_RUNTIME_DIR: undefined, ...env }) });
  runScript(["clear", node, FAKE_CLI], env);
  assert.ok(!existsSync(toolLog), existsSync(toolLog) ? readFileSync(toolLog, "utf8") : "");
  const missing = join(base, `hot-missing-${n}`, "oats-waiting", "k.claude");
  for (const marker of ["", "relative/k.claude", missing]) {
    const h2 = home(), log = join(base, `argv-hot-${n}.log`), e2 = { OATS_INSTANCE_HOME: h2, FAKE_LOG: log };
    runScript(["set", "permission", node, FAKE_CLI, marker], e2);
    runScript(["clear", node, FAKE_CLI, marker], e2);
    runScript(["clear", node, FAKE_CLI, marker], e2);
    assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 3, `${JSON.stringify(marker)}: every call reaches the CLI`);
  }
  assert.ok(!existsSync(join(base, `hot-missing-${n}`)), "a missing directory is not created on the hot path");
});

test("a clear the watchdog kills, or that fails, keeps the marker, so the next clear retries", { timeout: 60000 }, () => {
  const h = home(), node = process.execPath, log = join(base, `argv-retry-${n}.log`);
  const calls = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)[2]) : [];
  runScript(["set", "permission", node, FAKE_CLI], { OATS_INSTANCE_HOME: h, FAKE_LOG: log });
  for (const mode of ["hang", "fail"]) {
    const r = runScript(["clear", node, FAKE_CLI], { OATS_INSTANCE_HOME: h, FAKE_LOG: log, FAKE_MODE: mode });
    assert.equal(r.status, 0); assert.equal(r.stdout, "");
    assert.ok(existsSync(markerOf(h)), `${mode}: the marker is kept`);
  }
  runScript(["clear", node, FAKE_CLI], { OATS_INSTANCE_HOME: h, FAKE_LOG: log });
  assert.ok(!existsSync(markerOf(h)), "a clear that is recorded removes it");
  assert.deepEqual(calls(), ["set", "clear", "clear", "clear"], "each clear after the failed ones retried");
});

test("a clear racing a set ends cleared: a slow set that lands after the clear is followed by a clear; a set that comes in during a clear is recorded again", async () => {
  const node = process.execPath;
  const run = (args, env) => new Promise((done) => {
    const child = spawn("/bin/sh", [SCRIPT, ...withMarker([...args, node, FAKE_CLI], env)], { env: cleanEnv({ TMPDIR: TMP, XDG_RUNTIME_DIR: undefined, ...env }), stdio: "ignore" });
    child.on("exit", (code) => done(code));
  });
  const actions = (log) => readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)[2]);
  // (a) The set's CLI is slow; a clear starts and lands while it runs.
  let h = home(), log = join(base, `argv-race-a-${n}.log`);
  const slowSet = run(["set", "permission"], { OATS_INSTANCE_HOME: h, FAKE_LOG: log, FAKE_SET_DELAY_MS: "800" });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await run(["clear"], { OATS_INSTANCE_HOME: h, FAKE_LOG: log }), 0);
  assert.equal(await slowSet, 0);
  assert.deepEqual(actions(log), ["clear", "set", "clear"], "the set landed last, so it clears again");
  // (b) A clear's CLI is slow; a set starts and lands while it runs, so the clear lands last.
  h = home(); log = join(base, `argv-race-b-${n}.log`);
  assert.equal(await run(["set", "question"], { OATS_INSTANCE_HOME: h, FAKE_LOG: log }), 0);
  const slowClear = run(["clear"], { OATS_INSTANCE_HOME: h, FAKE_LOG: log, FAKE_CLEAR_DELAY_MS: "800" });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await run(["set", "permission"], { OATS_INSTANCE_HOME: h, FAKE_LOG: log }), 0);
  assert.equal(await slowClear, 0);
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((a) => a[2] === "set" ? a[6] : a[2]), ["question", "permission", "clear", "permission"], "the clear landed last, so the set is recorded again");
  assert.match(readFileSync(markerOf(h), "utf8"), /^permission \d+\n$/, "and the marker stays with it");
});

test("the CLI runs in the home", () => {
  const h = home(), node = process.execPath, cwdLog = join(base, `cwd-${n}.log`);
  runScript(["set", "permission", node, FAKE_CLI], { OATS_INSTANCE_HOME: h, FAKE_CWD_LOG: cwdLog });
  assert.equal(realpathSync(readFileSync(cwdLog, "utf8").trim()), realpathSync(h), "cd into the home before the CLI");
});

test("clear-tool: a subagent's tool event (top-level agent_id before hook_event_name) skips the clear; any other input clears; never a hang, never output", { timeout: 60000 }, () => {
  const node = process.execPath;
  const head = (extra) => `{"session_id":"s","transcript_path":"/t.jsonl","cwd":"/c","prompt_id":"p","permission_mode":"default",${extra}"hook_event_name":"PostToolUse","tool_name":"Bash"`;
  const sub = `${head('"agent_id":"a506d4183b984bb54","agent_type":"general-purpose",')},"tool_input":{"command":"ls"},"tool_use_id":"toolu_1"}`;
  const cases = [
    ["a main-thread tool event", `${head("")},"tool_input":{"command":"ls"},"tool_use_id":"toolu_1"}`, true],
    ["a subagent's tool event", sub, false],
    ["agent_id escaped inside a string value", `${head("")},"tool_input":{"command":"echo {\\"agent_id\\":\\"x1\\"}"},"tool_use_id":"toolu_1"}`, true],
    ["agent_id escaped inside a top-level string before hook_event_name", `{"session_id":"s","cwd":"/c/\\"agent_id\\":\\"x1\\"",${head("").slice(1)},"tool_use_id":"toolu_1"}`, true],
    ["agent_id as a key inside tool_input, after hook_event_name", `${head("")},"tool_input":{"agent_id":"x1"},"tool_use_id":"toolu_1"}`, true],
    ["an empty agent_id", `${head('"agent_id":"",')},"tool_use_id":"toolu_1"}`, true],
    ["a main-thread payload over 64 KiB", `${head("")},"tool_response":"${"x".repeat(100000)}","tool_use_id":"toolu_1"}`, true],
    ["a subagent payload over 64 KiB (the id is in the first 64 KiB)", `${head('"agent_id":"a1",')},"tool_response":"${"x".repeat(100000)}","tool_use_id":"toolu_1"}`, false],
    ["empty stdin", "", true],
    ["not JSON", "garbage \u0000\n\n", true],
    ["agent_id with no hook_event_name after it (truncated)", '{"session_id":"s","agent_id":"a1","agent_type":"x"', true],
  ];
  for (const [label, input, clears] of cases) {
    const h = home(), log = join(base, `argv-tool-${n}.log`);
    runScript(["set", "permission", node, FAKE_CLI], { OATS_INSTANCE_HOME: h });
    const started = Date.now();
    const r = spawnSync("/bin/sh", [SCRIPT, ...withMarker(["clear-tool", node, FAKE_CLI], { OATS_INSTANCE_HOME: h })], { input, encoding: "utf8", timeout: 15000, env: cleanEnv({ TMPDIR: TMP, XDG_RUNTIME_DIR: undefined, OATS_INSTANCE_HOME: h, FAKE_LOG: log }) });
    assert.equal(r.status, 0, label); assert.equal(r.stdout, "", label); assert.ok(Date.now() - started < 5000, `${label}: bounded`);
    const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").length : 0;
    assert.equal(calls, clears ? 1 : 0, `${label}: ${clears ? "clears" : "skips the clear"}`);
    assert.equal(existsSync(markerOf(h)), !clears, `${label}: the marker ${clears ? "goes" : "stays"}`);
  }
  // A closed stdin means the main thread.
  {
    const h = home(), log = join(base, `argv-tool-closed-${n}.log`);
    runScript(["set", "permission", node, FAKE_CLI], { OATS_INSTANCE_HOME: h });
    const r = spawnSync("/bin/sh", ["-c", `exec /bin/sh "$0" "$@" <&-`, SCRIPT, ...withMarker(["clear-tool", node, FAKE_CLI], { OATS_INSTANCE_HOME: h })], { encoding: "utf8", timeout: 15000, env: cleanEnv({ TMPDIR: TMP, XDG_RUNTIME_DIR: undefined, OATS_INSTANCE_HOME: h, FAKE_LOG: log }) });
    assert.equal(r.status, 0, "closed stdin"); assert.equal(r.stdout, "");
    assert.equal(existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").length : 0, 1, "closed stdin: clears");
  }
  // No claim (no marker): a tool clear reads nothing and starts no CLI, even for a stdin that never ends.
  const h = home(), log = join(base, `argv-tool-none-${n}.log`), started = Date.now();
  const r = spawnSync("/bin/sh", [SCRIPT, ...withMarker(["clear-tool", node, FAKE_CLI], { OATS_INSTANCE_HOME: h })], { stdio: ["pipe", "pipe", "pipe"], encoding: "utf8", timeout: 15000, env: cleanEnv({ TMPDIR: TMP, XDG_RUNTIME_DIR: undefined, OATS_INSTANCE_HOME: h, FAKE_LOG: log }) });
  assert.equal(r.status, 0); assert.ok(Date.now() - started < 900, "no read without a claim"); assert.ok(!existsSync(log));
});

test("clear-tool: a stdin that never ends is read for at most ~1 s, then means the main thread", { timeout: 30000 }, async () => {
  const node = process.execPath, h = home(), log = join(base, `argv-tool-open-${n}.log`);
  runScript(["set", "permission", node, FAKE_CLI], { OATS_INSTANCE_HOME: h });
  const started = Date.now();
  const child = spawn("/bin/sh", [SCRIPT, ...withMarker(["clear-tool", node, FAKE_CLI], { OATS_INSTANCE_HOME: h })], { stdio: ["pipe", "pipe", "pipe"], env: cleanEnv({ TMPDIR: TMP, XDG_RUNTIME_DIR: undefined, OATS_INSTANCE_HOME: h, FAKE_LOG: log }) });
  child.stdin.write('{"session_id":"s","agent_id":"a1"'); // a subagent's start, never finished, never closed
  let out = ""; child.stdout.on("data", (d) => { out += d; });
  const code = await new Promise((done) => child.on("exit", done));
  child.stdin.destroy();
  assert.equal(code, 0); assert.equal(out, "");
  assert.ok(Date.now() - started < 6000, `bounded (${Date.now() - started} ms)`);
  assert.ok(existsSync(log), "an input cut short before hook_event_name means the main thread: it clears");
});

test("no watchdog sleep outlives the script: every sleep it starts is gone when it exits, on the CLI path and the input read alike", { timeout: 60000 }, async () => {
  const node = process.execPath;
  // A `sleep` first on PATH that records its pid, then becomes the real sleep.
  const bin = join(base, `fake-bin-${n}`), sleepLog = join(base, `sleeps-${n}.log`);
  mkdirSync(bin); writeFileSync(join(bin, "sleep"), `#!/bin/sh\necho $$ >> '${sleepLog}'\nexec /bin/sleep "$@"\n`, { mode: 0o755 });
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  // Each call is slow enough (800 ms) for the sleep under it to have logged its pid; one
  // killed before it could log is gone anyway.
  const h = home(), env = { OATS_INSTANCE_HOME: h, PATH: `${bin}:${process.env.PATH}`, FAKE_SET_DELAY_MS: "800", FAKE_CLEAR_DELAY_MS: "800" };
  runScript(["set", "permission", node, FAKE_CLI], env);
  const child = spawn("/bin/sh", [SCRIPT, ...withMarker(["clear-tool", node, FAKE_CLI], env)], { stdio: ["pipe", "ignore", "ignore"], env: cleanEnv({ TMPDIR: TMP, XDG_RUNTIME_DIR: undefined, ...env }) });
  setTimeout(() => child.stdin.end(`{"session_id":"s","hook_event_name":"PostToolUse","tool_name":"Bash","tool_use_id":"t"}`), 800);
  assert.equal(await new Promise((done) => child.on("exit", done)), 0);
  const pids = readFileSync(sleepLog, "utf8").trim().split("\n").map(Number);
  assert.ok(pids.length >= 2, `watchdogs ran under the set's CLI, the input read and the clear's CLI (${pids.length} logged)`);
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(pids.filter(alive), [], "none of them is still sleeping");
});

test("a temp file an interrupted write left in .claude is removed by the next pass (even an unchanged one); a live writer's, and anything else, is left alone", () => {
  const h = home(), env = { OATS_HARNESS: "claude", OATS_INSTANCE_HOME: h, OATS_CLI_BIN: FAKE_CLI_ABS };
  runHook("spawn", env);
  const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout;
  const claude = join(h, ".claude");
  const stale = join(claude, `.settings.json.oats-core-${dead}-1700000000000.tmp`);
  const live = join(claude, `.settings.json.oats-core-${process.pid}-1700000000001.tmp`);
  const other = join(claude, ".settings.json.someone-else.tmp");
  for (const f of [stale, live, other]) writeFileSync(f, "{}");
  const before = readFileSync(settingsOf(h), "utf8");
  assert.deepEqual(runHook("launch", env), {});
  assert.equal(readFileSync(settingsOf(h), "utf8"), before, "nothing else changed");
  assert.ok(!existsSync(stale), "the dead writer's temp file is gone");
  assert.ok(existsSync(live), "a live writer's is kept");
  assert.ok(existsSync(other), "a name not ours is kept");
});

test("end to end: a command the hook wrote, run as Claude Code runs it, reaches the CLI", () => {
  const h = home();
  const log = join(base, `e2e-${n}.log`);
  assert.deepEqual(runHook("launch", { OATS_HARNESS: "claude", OATS_INSTANCE_HOME: h, OATS_CLI_BIN: FAKE_CLI }), {});
  const settings = readJson(settingsOf(h));
  const set = settings.hooks.Notification[0].hooks[0].command;
  const r = spawnSync("/bin/sh", ["-c", set], { encoding: "utf8", env: cleanEnv({ TMPDIR: TMP, XDG_RUNTIME_DIR: undefined, OATS_INSTANCE_HOME: h, FAKE_LOG: log }) });
  assert.equal(r.status, 0); assert.equal(r.stdout, "");
  assert.deepEqual(JSON.parse(readFileSync(log, "utf8").trim()), ["instance", "waiting", "set", "--producer", "oats.core", "--reason", "permission", "--home", h, "--json"]);
});

test("packaging: the capability ships bin/oats-core.mjs and bin/claude-waiting.sh as regular files, wired as spawn and launch hooks", () => {
  for (const f of ["bin/oats-core.mjs", "bin/claude-waiting.sh"]) assert.ok(lstatSync(join(CAP, f)).isFile(), f);
  const manifest = readJson(join(CAP, "oats.json"));
  assert.deepEqual(manifest.hooks, { spawn: "bin/oats-core.mjs spawn", launch: "bin/oats-core.mjs launch" });
  assert.equal(manifest.launchPreview, true);
  assert.match(readFileSync(SCRIPT, "utf8"), /^#!\/bin\/sh\n(?:#.*\n)*exec >\/dev\/null 2>&1\n(?:#.*\n)*if \[ -e \/dev\/fd\/0 \]; then exec 3<&0; else exec 3<\/dev\/null; fi\nexec <\/dev\/null\n/, "the script detaches stdout and stderr first, keeps the input on fd 3 and detaches stdin");
});
