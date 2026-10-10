// The walk of the door (awebai/oats#892, with #874 item 3, #891 and #866). The lifecycle verbs
// (`oats retire`, `oats instance stop`, `oats session inspect|start|restart`, `oats worktree
// add|remove`) answered a thrown error that had a `code` with that code, so a home the kernel could
// not read left the CLI as `{"error":{"code":"EACCES"}}`, or as a stack. Every answer of these verbs
// now goes through one door (bin/oats.mjs lifecycleFail, lib/errors.mjs): a kernel code
// (`^E_[A-Z0-9_]+$`), the system's own code in `details.cause` alone, and the stack of an exception
// without a code on stderr, never in the answer.
//
// This file does not pin which code answers which case (the tests of each verb do). It walks every
// lifecycle command, in JSON mode, over a small set of broken homes, through the real CLI, and holds
// every answer to the same rules: exactly one JSON answer on stdout, exit 0 or 1, no stack, no
// system code anywhere outside a `cause`. An intact home is the control: there every command
// succeeds, under the same rules. One more test breaks the kernel itself (an exception without a
// code, thrown from inside the retire's walk of the home) and reads the one envelope and the stack.
//
// The one answer that is not an envelope is documented (docs/desktop-cli-api.md, "Not an envelope"):
// a first `oats retire --json` that retires prints the raw retire receipt, one JSON document on
// several lines. The walk admits it for that command alone and holds it to the same rules.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { CLI, v2Deployment } from "./helpers/v2-deployment.mjs";

const KERNEL_CODE = /^E_[A-Z0-9_]+$/;
/** The system codes a broken home produces: none may be anywhere in an answer but in a `cause` or in a message's text. */
const SYSTEM_CODES = ["ENOENT", "EACCES", "ENOTDIR", "EEXIST", "EISDIR", "ENOTEMPTY", "EPERM"];
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isRoot = () => process.getuid?.() === 0;
const ROOT_SKIP = "the process is root, which reads through mode 000: this shape cannot fail";
/** Whether tmux is installed. Without it no session starts, in an intact home either: the answer is
 *  then held to the rules like any other, and the control does not expect a start to succeed. */
const HAS_TMUX = (() => { try { execFileSync("tmux", ["-V"], { stdio: "ignore", timeout: 5000 }); return true; } catch { return false; } })();

// ---- the rules every answer is held to ----

/** Whether `stderr` holds a JavaScript stack trace. */
const hasStack = (stderr) => /^\s+at .*\(.*:\d+:\d+\)/m.test(stderr) || stderr.includes("node:internal");

/** Whether `cause` is what lib/errors.mjs errorCause gives: `{ code, syscall? }` or `{ name }`, strings,
 *  and nothing else (no message, no path, no stack). */
function isCause(cause) {
  if (!isObject(cause)) return false;
  const keys = Object.keys(cause);
  const text = (v) => typeof v === "string" && v.length > 0;
  if (keys.length === 1 && keys[0] === "name") return text(cause.name);
  return keys.includes("code") && keys.every((k) => k === "code" || k === "syscall") && keys.every((k) => text(cause[k]));
}

/** What in `doc` (a whole answer: a result or an error) breaks the rule on codes, as sentences. The
 *  walk is generic, over every key at every depth:
 *    - every value under a key named `code` is a kernel code;
 *    - every `cause` that is an object has errorCause's shape.
 *  With two exceptions, stated here because they are the whole point of the rule:
 *    1. a `cause` object is not walked: it is where the system's own code belongs (`ENOENT`, `ERR_…`);
 *    2. a `reason` is checked only directly inside a `session` or a `work` object (a plan's facts),
 *       where it is null, the documented `"no-worktree"`, or a kernel code. Every other `reason`
 *       (`skipped[].reason: "recursive=false"`, `ambiguous[].reason`, an extra worktree's) is prose. */
function codeProblems(doc) {
  const problems = [];
  const visit = (value, path, parent) => {
    if (Array.isArray(value)) { value.forEach((v, n) => visit(v, `${path}[${n}]`, parent)); return; }
    if (!isObject(value)) return;
    for (const [key, v] of Object.entries(value)) {
      const at = path ? `${path}.${key}` : key;
      if (key === "cause" && isObject(v)) {
        if (!isCause(v)) problems.push(`${at} is ${JSON.stringify(v)}: not { code, syscall? } or { name }`);
        continue;
      }
      if (key === "code" && !(typeof v === "string" && KERNEL_CODE.test(v))) problems.push(`${at} is ${JSON.stringify(v)}: not a kernel code`);
      if (key === "reason" && (parent === "session" || parent === "work") && !(v === null || v === "no-worktree" || (typeof v === "string" && KERNEL_CODE.test(v)))) {
        problems.push(`${at} is ${JSON.stringify(v)}: not null, "no-worktree" or a kernel code`);
      }
      visit(v, at, key);
    }
  };
  visit(doc, "", null);
  return problems;
}

/** `doc` without its `cause` objects and its `message` strings: what is left may name no system code at all. */
function withoutCausesAndMessages(value) {
  if (Array.isArray(value)) return value.map(withoutCausesAndMessages);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key, v]) => !(key === "cause" && isObject(v)) && !(key === "message" && typeof v === "string"))
    .map(([key, v]) => [key, withoutCausesAndMessages(v)]));
}

/** Hold one answer of the CLI (`r`, a spawnSync result) to the rules of the door. `where` names the
 *  command and the shape; every failure message starts with it and ends with what the CLI said.
 *    - `retires: <name>`: the command is a retire apply, which answers the raw receipt when it retires;
 *    - `defect: true`: the test made the kernel throw an exception without a code, so a stack on stderr
 *      is the contract and not a finding.
 *  Returns `{ ok, code, doc }`: `code` is the error's code, `"ok"`, or `"receipt"`. */
function doorAnswer(r, where, { retires, defect = false } = {}) {
  const said = `${where}\n  exit status: ${r.status}${r.signal ? ` (signal ${r.signal})` : ""}\n  stdout: ${r.stdout}\n  stderr: ${r.stderr}`;
  assert.equal(r.error, undefined, `the CLI could not be run (${r.error?.message}): ${said}`);
  assert.equal(r.signal, null, `the CLI was ended by a signal: ${said}`);
  assert.ok(r.status === 0 || r.status === 1, `the exit status is 0 or 1, never a crash status: ${said}`);
  if (!defect) assert.equal(hasStack(r.stderr), false, `a JavaScript stack on stderr, which only an exception without a code prints (a kernel defect): ${said}`);

  let doc;
  try { doc = JSON.parse(r.stdout); } catch (e) { assert.fail(`stdout is not exactly one JSON document (${e.message}): ${said}`); }
  assert.ok(isObject(doc), `the answer is a JSON object: ${said}`);
  const receipt = retires !== undefined && doc.schemaVersion === undefined;
  if (receipt) {
    // The documented exception: the raw retire receipt of a first retire, printed whole.
    assert.equal(doc.retired, retires, `an answer of a retire that is no envelope is its raw receipt: ${said}`);
    assert.equal("ok" in doc || "error" in doc, false, `a raw receipt is not half an envelope: ${said}`);
    assert.equal(r.status, doc.rollbackIncomplete ? 1 : 0, `a receipt exits 0, or 1 when it says the cleanup is incomplete: ${said}`);
  } else {
    assert.equal(r.stdout.trim().split("\n").length, 1, `stdout is exactly one line: ${said}`);
    assert.equal(doc.schemaVersion, 1, `the envelope has schemaVersion 1: ${said}`);
    assert.equal(typeof doc.ok, "boolean", `the envelope has ok, a boolean: ${said}`);
    assert.equal(r.status, doc.ok ? 0 : 1, `an ok envelope exits 0 and an error envelope exits 1: ${said}`);
    if (!doc.ok) {
      assert.ok(isObject(doc.error), `an error envelope has error: ${said}`);
      assert.equal(typeof doc.error.code, "string", `error.code is a string: ${said}`);
      assert.match(doc.error.code, KERNEL_CODE, `error.code is a kernel code: ${said}`);
      assert.equal(typeof doc.error.message, "string", `error.message is a string: ${said}`);
      const cause = doc.error.details?.cause;
      if (cause !== undefined) assert.ok(isCause(cause), `error.details.cause is { code, syscall? } or { name } and nothing else: ${said}`);
    }
  }
  assert.deepEqual(codeProblems(doc), [], `no system code in the answer outside a cause: ${said}`);
  const rest = JSON.stringify(withoutCausesAndMessages(doc));
  for (const code of SYSTEM_CODES) assert.equal(rest.includes(code), false, `${code} is in the answer outside every cause and every message: ${said}`);
  return { ok: receipt ? !doc.rollbackIncomplete : doc.ok, code: receipt ? "receipt" : doc.ok ? "ok" : doc.error.code, doc };
}

// ---- the commands ----

/** The revision of the stop plan of `i` as it is now, read through the CLI. */
function stopPlanRevision(fx, i, when) {
  const r = fx.cli(["instance", "stop", i.name, "--plan", "--json"]);
  assert.equal(r.status, 0, `fixture premise: a stop plan of ${i.name} ${when}\n${r.stdout}\n${r.stderr}`);
  return r.json().result.planRevision;
}
const inHome = (i) => ({ env: { OATS_INSTANCE_HOME: i.home } });
const stopApply = (i, revision, key) => ["instance", "stop", i.name, "--apply", "--plan-revision", revision, "--idempotency-key", key, "--json"];
const treeAdd = (i) => ["worktree", "add", "--purpose", "p", "--branch", `agents/${i.name}-p`, "--base", "main", "--json"];

/** Every lifecycle command. `key` goes into the instance's name; `argv` is the whole command line
 *  after `oats`; `before` runs on the intact home, before it is broken; `needsTmux` marks a command
 *  that succeeds over an intact home only where tmux is installed. */
const COMMANDS = [
  { id: "retire", key: "retire", retires: true, argv: (i) => ["retire", i.name, "--json"] },
  { id: "retire --plan", key: "retire-plan", argv: (i) => ["retire", i.name, "--plan", "--json"] },
  { id: "instance stop --plan", key: "stop-plan", argv: (i) => ["instance", "stop", i.name, "--plan", "--json"] },
  // The revision is of a plan made before the home was broken: the Desktop's case, a plan shown and
  // then confirmed. When the break changed the plan the kernel answers E_PLAN_STALE, which is right;
  // the walk then applies the revision of a plan made after the break too (walkPair).
  { id: "instance stop --apply", key: "stop-apply", before: (fx, i) => { i.revision = stopPlanRevision(fx, i, "before the home is broken"); }, argv: (i) => stopApply(i, i.revision, "k1") },
  { id: "session inspect", key: "inspect", argv: (i) => ["session", "inspect", "--home", i.home, "--json"] },
  { id: "session start", key: "start", needsTmux: true, argv: (i) => ["session", "start", "--home", i.home, "--json"] },
  { id: "session restart", key: "restart", needsTmux: true, argv: (i) => ["session", "restart", "--home", i.home, "--json"] },
  { id: "worktree add", key: "tree-add", argv: treeAdd, options: inHome },
  // A remove has a tree to remove: it was added while the home was intact.
  { id: "worktree remove", key: "tree-remove", argv: () => ["worktree", "remove", "--purpose", "p", "--json"], options: inHome,
    before: (fx, i) => { const r = fx.cli(treeAdd(i), inHome(i)); assert.equal(r.status, 0, `fixture premise: the tree of ${i.name} is added while its home is intact\n${r.stdout}\n${r.stderr}`); } },
];

// ---- the shapes ----

/** Make `path` a regular file, whatever it was. */
function replaceByFile(path) {
  rmSync(path, { recursive: true, force: true });
  writeFileSync(path, "a regular file where a kernel directory belongs\n");
}
/** `path` at mode 000, with the fixture premise that this process can then no longer use it (`probe`
 *  throws EACCES). Returns the function that gives its mode back. */
function unreadable(path, probe) {
  const mode = lstatSync(path).mode & 0o7777;
  chmodSync(path, 0);
  const restore = () => chmodSync(path, mode);
  try { assert.throws(probe, { code: "EACCES" }, `fixture premise: ${path} at mode 000 cannot be read`); } catch (e) { restore(); throw e; }
  return restore;
}

/** The homes the walk goes over. `break(i)` breaks the home of instance `i` (`{ name, home }`) and
 *  returns the function that mends it, when the break would be felt by the commands of another
 *  instance (an unreadable instance.json is: a retire or a stop reads every home's record). `soul`
 *  is the agent the shape's instances belong to: the shape that breaks a directory all the instances
 *  of an agent share has its own. */
const SHAPES = [
  { id: "an intact home (the control)", key: "intact", control: true, break: () => {} },
  { id: "instance.json unreadable (mode 000)", key: "json000", modes: true,
    break: (i) => unreadable(join(i.home, "instance.json"), () => readFileSync(join(i.home, "instance.json"))) },
  { id: "the home directory unreadable (mode 000)", key: "home000", modes: true,
    break: (i) => unreadable(i.home, () => readdirSync(i.home)) },
  { id: "<home>/.oats/trees is a regular file", key: "treesfile", break: (i) => replaceByFile(join(i.home, ".oats", "trees")) },
  { id: "<home>/.oats is a regular file", key: "oatsfile", break: (i) => replaceByFile(join(i.home, ".oats")) },
  // Beside the homes, shared by every instance of the agent: the retirement directory (claims,
  // baselines, recovery). Broken once all the shape's instances exist: a spawn writes there.
  { id: "<instances>/.oats-retirement is a regular file", key: "retfile", soul: "ops", break: (i) => replaceByFile(join(dirname(i.home), ".oats-retirement")) },
];

/** Run `command` over the home of `i`, broken as `shape` says, and hold each answer to the rules.
 *  Returns the answers as `[label, answer]`. */
function walkPair(fx, shape, command, i) {
  const answers = [];
  const answer = (label, argv) => {
    const where = `\`oats ${argv.join(" ")}\` (${label}) over ${shape.id}`;
    const a = doorAnswer(fx.cli(argv, command.options?.(i)), where, command.retires ? { retires: i.name } : {});
    answers.push([label, a]);
    return a;
  };
  const mend = shape.break(i);
  try {
    const first = answer(command.id, command.argv(i));
    if (command.key === "stop-apply" && first.code === "E_PLAN_STALE") {
      // The break changed the plan. When a plan of the broken home can be made, apply that one.
      const planned = doorAnswer(fx.cli(["instance", "stop", i.name, "--plan", "--json"]), `\`oats instance stop ${i.name} --plan --json\` (the plan made after the break) over ${shape.id}`);
      if (planned.ok) {
        const second = answer(`${command.id}, the revision of a plan made after the break`, stopApply(i, planned.doc.result.planRevision, "k2"));
        assert.notEqual(second.code, "E_PLAN_STALE", `a plan of the broken home, applied at once, is not stale: ${shape.id}\n${JSON.stringify(second.doc)}`);
      }
    }
  } finally { mend?.(); }
  return answers;
}

/** Give every directory under `path` back to its owner (u+rwx), so that the fixture can be removed:
 *  a home this file made unreadable, and any copy the kernel made of one (a retire's recovery copy
 *  keeps the modes of what it copies). A file needs no bit of its own to be removed. */
function makeRemovable(path) {
  const st = lstatSync(path);
  if (!st.isDirectory()) return;
  if ((st.mode & 0o700) !== 0o700) chmodSync(path, (st.mode & 0o7777) | 0o700);
  for (const name of readdirSync(path)) makeRemovable(join(path, name));
}

test("every lifecycle command, in JSON mode, answers a broken home with exactly one JSON answer on stdout: a kernel code, exit 0 or 1, no stack, and no system code outside details.cause (awebai/oats#892)", async (t) => {
  const fx = v2Deployment({ t, souls: { dev: { soul: { work: "worktree" } }, ops: { soul: { work: "worktree" } } } });
  fx.beforeCleanup(() => makeRemovable(fx.base));

  for (const shape of SHAPES) {
    await t.test(`over ${shape.id}`, async (st) => {
      if (shape.modes && isRoot()) { st.skip(ROOT_SKIP); return; }
      const soul = shape.soul ?? "dev";
      // One freshly spawned instance for each command (a retire may remove or change the home), all
      // made, and prepared, while everything is intact.
      const instances = [];
      for (const command of COMMANDS) {
        const name = `${shape.key}-${command.key}`;
        const made = await fx.spawn(soul, { name });
        assert.equal(made.home, join(fx.root, soul, "instances", name), "fixture premise: where a spawned home is");
        const i = { name, home: made.home };
        command.before?.(fx, i);
        instances.push([command, i]);
      }
      const all = [];
      let walked = 0;
      for (const [command, i] of instances) {
        await st.test(command.id, () => { all.push(...walkPair(fx, shape, command, i).map((answered) => [...answered, command])); walked++; });
      }
      // The walk means something only when the shape was felt, and the control only when nothing failed.
      if (shape.control) assert.deepEqual(all.filter(([, a, command]) => !a.ok && (HAS_TMUX || !command.needsTmux)).map(([label, a]) => `${label}: ${a.code}`), [], "over an intact home every command succeeds");
      else if (walked === COMMANDS.length) assert.ok(all.some(([, a]) => !a.ok), `fixture premise: at least one command is refused over ${shape.id}`);
    });
  }
});

// ---- an exception without a code ----

/** A tree as `{ <relative path>: what it is }`: mode and bytes of a file, target of a link, mode of a
 *  directory. Two snapshots that are deep-equal are the same tree, byte for byte. */
function snapshot(root) {
  const seen = {};
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name), at = rel ? `${rel}/${name}` : name;
      const st = lstatSync(path);
      const mode = (st.mode & 0o7777).toString(8);
      if (st.isSymbolicLink()) seen[at] = `link ${readlinkSync(path)}`;
      else if (st.isDirectory()) { seen[`${at}/`] = `directory ${mode}`; walk(path, at); }
      else seen[at] = `file ${mode} ${readFileSync(path).toString("base64")}`;
    }
  };
  walk(root, "");
  return seen;
}

test("an exception without a code, thrown inside the retire's walk of the home, is answered as one envelope (E_WORK_INSPECTION_FAILED, cause { name }) and its stack is printed on stderr, in JSON mode and in text mode", async (t) => {
  const fx = v2Deployment({ t, souls: { dev: { soul: { work: "worktree" } } } });
  fx.beforeCleanup(() => makeRemovable(fx.base));
  const name = "defect";
  const { home } = await fx.spawn("dev", { name });
  // A directory of the home that only the retire's walk reads (lib/core.mjs fingerprintTrees, through
  // lib/tree-copy.mjs entriesAsBytes: readdirSync of node:fs).
  const probe = join(home, "notes");
  mkdirSync(probe);
  writeFileSync(join(probe, "note.txt"), "bytes of the home\n");
  // The defect: a preload that makes readdirSync of that one directory throw a TypeError, which has no
  // code. Every other call is the original. The CLI is the real one, with the preload before it.
  const preload = join(fx.base, "throwing-readdir.mjs");
  writeFileSync(preload, `// Written by test/lifecycle-door-walk.test.mjs: a kernel defect on demand.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const directory = ${JSON.stringify(probe)};
const readdirSync = fs.readdirSync;
fs.readdirSync = function (path, ...rest) {
  if ((Buffer.isBuffer(path) ? path.toString() : String(path)) === directory) throw new TypeError("boom from the test preload");
  return readdirSync.call(this, path, ...rest);
};
syncBuiltinESMExports();
`);
  // As fx.cli runs the CLI (test/helpers/v2-deployment.mjs), with the preload.
  const oats = (args) => spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, CLI, ...args], { cwd: fx.dep, env: fx.env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const STACK = /^TypeError: boom from the test preload\n(?: {4}at .+\n)+/m;
  const MESSAGE = `could not inspect the home of ${name} or its work: boom from the test preload. Nothing was stopped, run or removed.`;
  const before = snapshot(home);
  const recovery = join(dirname(home), ".oats-retirement", "recovery");
  const untouched = (mode) => {
    assert.deepEqual(snapshot(home), before, `${mode}: the home is byte for byte what it was`);
    assert.deepEqual(existsSync(recovery) ? readdirSync(recovery) : [], [], `${mode}: no recovery copy, and no staging of one, was left`);
  };

  // JSON mode: one envelope on stdout, the stack on stderr.
  const json = oats(["retire", name, "--json"]);
  const where = `\`oats retire ${name} --json\` with a walk that throws a TypeError`;
  const said = `${where}\n  exit status: ${json.status}\n  stdout: ${json.stdout}\n  stderr: ${json.stderr}`;
  const answer = doorAnswer(json, where, { defect: true });
  assert.equal(json.status, 1, said);
  assert.equal(json.stdout.trim().split("\n").length, 1, `exactly one envelope on stdout: ${said}`);
  assert.equal(answer.doc.schemaVersion, 1, said);
  assert.equal(answer.doc.ok, false, said);
  assert.equal(answer.doc.error.code, "E_WORK_INSPECTION_FAILED", said);
  assert.equal(answer.doc.error.message, MESSAGE, said);
  assert.deepEqual(answer.doc.error.details.cause, { name: "TypeError" }, said);
  assert.deepEqual(answer.doc.error.details.reached, { phase: "before-effects", sessionStopAttempted: false, hooksStarted: false, home: "kept", recovery: null }, said);
  // The envelope carries no stack text: no frame, no file of the kernel or of the preload, no `stack` key.
  assert.doesNotMatch(json.stdout, /\bat .*:\d+:\d+|throwing-readdir|core\.mjs|tree-copy\.mjs|"stack"/, `the envelope carries no stack: ${said}`);
  assert.match(json.stderr, STACK, `the stack of the exception is on stderr: ${said}`);
  untouched("JSON mode");

  // Text mode: nothing on stdout; the stack and the same message on stderr.
  const text = oats(["retire", name]);
  const saidText = `\`oats retire ${name}\` with a walk that throws a TypeError\n  exit status: ${text.status}\n  stdout: ${text.stdout}\n  stderr: ${text.stderr}`;
  assert.equal(text.signal, null, saidText);
  assert.equal(text.status, 1, saidText);
  assert.equal(text.stdout, "", `nothing on stdout: ${saidText}`);
  assert.match(text.stderr, STACK, `the stack of the exception is on stderr: ${saidText}`);
  assert.ok(text.stderr.split("\n").includes(`oats: ${MESSAGE}`), `the message is a line of stderr, as \`oats: could not inspect …\`: ${saidText}`);
  untouched("text mode");

  // The preload is the whole defect: without it the same retire retires the same home.
  const plain = doorAnswer(fx.cli(["retire", name, "--json"]), `\`oats retire ${name} --json\` without the preload`, { retires: name });
  assert.equal(plain.code, "receipt", JSON.stringify(plain.doc));
  assert.equal(existsSync(home), false, "the home is removed");
});
