// The walk of `oats session …` (awebai/oats#892, with #874 item 3, #891 and #866). The door of the
// lifecycle verbs (bin/oats.mjs lifecycleFail, lib/errors.mjs) answers an error that has a system
// code with a kernel code and `details.cause`, and prints the stack of a kernel defect on stderr.
// An ordinary refusal is neither: a session that is no longer there, a tmux that exited non-zero, a
// refusal the kernel wrote as a plain `Error` without a code. The door must answer those as
// `origin/main` did: `oats: <message>` on stderr and nothing else there, no stack, no
// `details.cause`. The first head of the pull request did not: `oats session attach --home <home>`
// of an instance whose window was gone printed `Error: session no longer exists`, a stack, and
// then the line.
//
// This file walks every subcommand `oats session` dispatches (bin/oats.mjs sessionCmd: attach,
// inspect, input, upload, receive, start, restart) over three states of the instance's session,
// in JSON mode and in text mode, through the real CLI, and pins what each pair answers:
//   - a stopped session: the harness has exited and its window is still there, as a shell. That is
//     what the kernel's own stop leaves (a test here holds the two to be the same);
//   - the window is gone (`tmux kill-window`);
//   - the tmux server is gone (`tmux kill-server`; its socket file stays, so tmux answers
//     `no server running on <socket>`).
// Every run is held to the same rules as well: not ended by a signal, exit 0 or 1, no JavaScript
// stack on stderr; in JSON mode exactly one envelope, a kernel code when it failed, and a
// `details.cause` only of errorCause's shape; in text mode nothing on stdout when it failed.
//
// How the expectations were obtained: each command was run over the same kind of state with the CLI
// of `origin/main` before the door (`ae9308b2`), on tmux 3.7c, and what it printed is pinned here:
// as an exact string where it is fixed, as a regular expression where it holds a tmux command line.
// This head printed the same for every pair, once paths, pane ids and times are set aside. The
// committed test holds the expectations; it does not run that kernel.
//
// Real tmux, on the fixture's own `oats` server (a private TMUX_TMPDIR; test/helpers/
// v2-deployment.mjs), never the operator's. The harness is the fixture's inert stand-in, which
// exits at once: a spawn records the launch executable it finds on PATH, so the spawns here run
// with the fixture's PATH, and no harness installed on the host is ever started. The server's shell
// is /bin/sh on every host. The last test needs no tmux; the others are skipped without it.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { processesInHome } from "../lib/core.mjs";
import { oatsSocket, waitUntil } from "./helpers/host-fixture.mjs";
import { CLI, v2Deployment } from "./helpers/v2-deployment.mjs";

const HAS_TMUX = (() => { try { execFileSync("tmux", ["-V"], { stdio: "ignore", timeout: 5000 }); return true; } catch { return false; } })();
const NO_TMUX = !HAS_TMUX && "tmux is not installed";

const KERNEL_CODE = /^E_[A-Z0-9_]+$/;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const escaped = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** Whether `stderr` holds a JavaScript stack trace: a frame (`    at f (file:1:2)`, `    at file:1:2`), or a line of Node's own. */
const hasStack = (stderr) => /^\s+at .+:\d+:\d+\)?$/m.test(stderr) || stderr.includes("node:internal");
/** Whether `cause` is what lib/errors.mjs errorCause gives: `{ code, syscall? }` or `{ name }`, strings, and nothing else. */
function isCause(cause) {
  if (!isObject(cause)) return false;
  const keys = Object.keys(cause);
  const text = (v) => typeof v === "string" && v.length > 0;
  if (keys.length === 1 && keys[0] === "name") return text(cause.name);
  return keys.includes("code") && keys.every((k) => k === "code" || k === "syscall") && keys.every((k) => text(cause[k]));
}

// ---- the rules every run is held to ----

/** Hold one run of the CLI (`r`, a spawnSync result) to the rules, whatever it answered. `where`
 *  names the command, the mode and the state. Returns the envelope in JSON mode. */
function held(r, mode, where) {
  const said = `${where}\n  exit status: ${r.status}${r.signal ? ` (signal ${r.signal})` : ""}\n  stdout: ${JSON.stringify(r.stdout)}\n  stderr: ${JSON.stringify(r.stderr)}`;
  assert.equal(r.error, undefined, `the CLI could not be run (${r.error?.message}): ${said}`);
  assert.equal(r.signal, null, `the CLI was ended by a signal: ${said}`);
  assert.ok(r.status === 0 || r.status === 1, `the exit status is 0 or 1, never a crash status: ${said}`);
  assert.equal(hasStack(r.stderr), false, `a JavaScript stack on stderr, which only a kernel defect prints: ${said}`);
  if (mode === "text") {
    if (r.status !== 0) assert.equal(r.stdout, "", `nothing on stdout when it failed: ${said}`);
    return undefined;
  }
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1, `stdout is exactly one line: ${said}`);
  let doc;
  try { doc = JSON.parse(lines[0]); } catch (e) { assert.fail(`stdout is not one JSON envelope (${e.message}): ${said}`); }
  assert.ok(isObject(doc), `the answer is a JSON object: ${said}`);
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
  return doc;
}

// ---- what a pair answers ----
// An expectation is checked against one run: `{ r, doc, i, said }`, where `i` is the instance
// (`{ name, home, session, socket }`) and `doc` the envelope of a JSON run. A message is a string,
// a regular expression, or a function of the instance that gives one.

const messageOf = (message, i) => (typeof message === "function" ? message(i) : message);
function sameMessage(actual, message, i, what) {
  const expected = messageOf(message, i);
  if (expected instanceof RegExp) assert.match(actual, expected, what);
  else assert.equal(actual, expected, what);
}
/** JSON mode: an error envelope of exactly this code and this message, and nothing more. No
 *  `details`, so no `details.cause`: a plain refusal, as main answers it. */
const envelope = (code, message) => ({ r, doc, i, said }) => {
  assert.equal(r.status, 1, said);
  assert.equal(doc.ok, false, `it is refused: ${said}`);
  assert.deepEqual(Object.keys(doc).sort(), ["error", "ok", "schemaVersion"], `the envelope holds nothing else: ${said}`);
  assert.equal(doc.error.code, code, said);
  sameMessage(doc.error.message, message, i, said);
  assert.deepEqual(Object.keys(doc.error).sort(), ["code", "message"], `a plain refusal: no details, so no details.cause: ${said}`);
  assert.equal(r.stderr, "", `nothing on stderr: ${said}`);
};
/** Text mode: exit 1, nothing on stdout, and stderr is the one line `oats: <message>` (a message
 *  that quotes tmux runs over several lines; it is still the whole of stderr). */
const line = (message) => ({ r, i, said }) => {
  assert.equal(r.status, 1, said);
  assert.equal(r.stdout, "", `nothing on stdout: ${said}`);
  assert.ok(r.stderr.startsWith("oats: ") && r.stderr.endsWith("\n"), `stderr is \`oats: <message>\` and nothing else: ${said}`);
  sameMessage(r.stderr.slice("oats: ".length, -1), message, i, `stderr is \`oats: <message>\` and nothing else: ${said}`);
  assert.doesNotMatch(r.stderr, /^Error:/m, `no \`Error:\` line: ${said}`);
};
/** A refusal, in both modes: the envelope, and the same message as the line. */
const refused = (code, message) => ({ json: envelope(code, message), text: line(message) });
/** Text mode, when what is on stderr is not the kernel's: this status, nothing on stdout, exactly this stderr. */
const says = (status, stderr) => ({ r, said }) => {
  assert.equal(r.status, status, said);
  assert.equal(r.stdout, "", `nothing on stdout: ${said}`);
  assert.equal(r.stderr, stderr, said);
};
/** A success, in both modes: an ok envelope (JSON mode), or the result alone as indented JSON (text
 *  mode), and on stderr at most the kernel's own warnings. `check(result, run)` pins the result. */
const succeeds = (check) => {
  const both = (result, run) => {
    assert.equal(run.r.status, 0, run.said);
    for (const text of run.r.stderr.split("\n").filter(Boolean)) assert.match(text, /^oats: warning: /, `stderr of a success holds only warnings: ${run.said}`);
    check(result, run);
  };
  return {
    json: (run) => { assert.equal(run.doc.ok, true, `it succeeds: ${run.said}`); assert.deepEqual(Object.keys(run.doc).sort(), ["ok", "result", "schemaVersion"], run.said); both(run.doc.result, run); },
    text: (run) => {
      let result;
      try { result = JSON.parse(run.r.stdout); } catch (e) { assert.fail(`stdout of a success is the result as JSON (${e.message}): ${run.said}`); }
      assert.equal(run.r.stdout, `${JSON.stringify(result, null, 2)}\n`, `the result, indented: ${run.said}`);
      both(result, run);
    },
  };
};

// ---- the fixture ----

/** The shell of the fixture's tmux server and of its panes. */
const SHELL = "/bin/sh";
/** The bytes the walk uploads, receives and submits. */
const NOTE = "a note of the session walk\n";
const NOTE_SHA256 = createHash("sha256").update(NOTE).digest("hex");

/** A deployment whose instances run on its own tmux server, and what the tests do to them. */
function sessions(t) {
  const fx = v2Deployment({ t });
  const socket = oatsSocket(fx.env.TMUX_TMPDIR);
  /** tmux, on the fixture's own server only: addressed by its socket. */
  const tmux = (...args) => execFileSync("tmux", ["-f", "/dev/null", "-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, env: fx.env, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const serverPid = () => { try { const pid = Number(tmux("display-message", "-p", "#{pid}")); return Number.isSafeInteger(pid) && pid > 1 ? pid : null; } catch { return null; } };
  const windows = (session) => { try { return tmux("list-windows", "-t", `=${session}`, "-F", "#{window_name}").split("\n").filter(Boolean); } catch { return []; } };
  // The server ends before the fixture's cleanup looks for processes left in its base.
  fx.beforeCleanup(() => { try { tmux("kill-server"); } catch { /* no server runs */ } });
  const note = join(fx.base, "note.txt");
  writeFileSync(note, NOTE);

  /** The CLI as fx.cli runs it, with one shell for every host: a start that has to create the tmux
   *  server gives it its own SHELL, and a pane falls back to that shell when its harness exits. */
  const cli = (argv) => fx.cli(argv, { env: { SHELL } });
  /** The same; with `input`, those bytes on its stdin. */
  const oats = (argv, input) => (input === undefined ? cli(argv) : spawnSync(process.execPath, [CLI, ...argv], { cwd: fx.dep, env: { ...fx.env, SHELL }, encoding: "utf8", input, maxBuffer: 32 * 1024 * 1024 }));
  const inspected = (home) => { const r = cli(["session", "inspect", "--home", home, "--json"]); return r.status === 0 ? r.json().result : null; };
  /** No process works in the home any more: the pane's shell has gone with its window or its server. */
  const idle = (home) => waitUntil(() => { const scan = processesInHome(home); return scan.ok && scan.processes.length === 0; }, `no process to work in ${home}`);

  /** Spawn an instance (no launch). `path` is the PATH its launch executable is found on: the
   *  fixture's, whose `pi`, `claude` and `codex` are inert. */
  const spawn = async (name, path = fx.env.PATH) => {
    const saved = process.env.PATH;
    process.env.PATH = path;
    try { return (await fx.spawn("dev", { name })).home; } finally { process.env.PATH = saved; }
  };
  /** Start the session of a spawned instance through the CLI. → the instance, with its tmux target. */
  const start = (name, home) => {
    const r = cli(["session", "start", "--home", home, "--json"]);
    assert.equal(r.status, 0, `fixture premise: \`oats session start\` starts ${name}\n${r.stdout}\n${r.stderr}`);
    const { target } = r.json().result;
    assert.deepEqual({ backend: target.backend, window: target.window, socket: target.socket }, { backend: "tmux", window: name, socket }, "fixture premise: the session is a window of the fixture's own tmux server");
    return { name, home, session: target.session, socket };
  };
  /** An instance whose session was started and has stopped: the inert harness has exited, and the
   *  window is a shell. */
  const stopped = async (name) => {
    const i = start(name, await spawn(name));
    let last;
    await waitUntil(() => { last = inspected(i.home); return last?.state === "shell"; }, `the session of ${name} to read as a shell once its harness has exited`);
    assert.equal(last.present, true, "fixture premise: the window of a stopped session is still there");
    return i;
  };
  /** The window of `i` is gone; its server and its session are still there. */
  const killWindow = async (i) => {
    tmux("kill-window", "-t", `=${i.session}:=${i.name}`);
    assert.equal(windows(i.session).includes(i.name), false, "fixture premise: the window is gone");
    assert.notEqual(serverPid(), null, "fixture premise: the server still runs");
    await idle(i.home);
  };
  /** The server `i` ran on is gone. Its socket file stays: tmux then says that no server runs on it. */
  const killServer = async (i) => {
    const pid = serverPid();
    assert.notEqual(pid, null, "fixture premise: the fixture's tmux server runs before it is killed");
    tmux("kill-server");
    await waitUntil(() => !alive(pid), "the tmux server to have exited");
    assert.equal(existsSync(socket), true, "fixture premise: a tmux server that was told to exit leaves its socket file");
    await idle(i.home);
  };
  return { fx, socket, tmux, windows, note, cli, oats, inspected, spawn, start, stopped, killWindow, killServer };
}

// ---- the walk ----

const ATTACH_JSON = "session attach is interactive; omit --json";
/** What a failed tmux call reads as when no server listens on the socket: Node's `Command failed:`
 *  line with tmux's command line, then what tmux said. `lead` is what the kernel puts before it. */
const noServer = (lead = "") => (i) => new RegExp(`^${escaped(lead)}Command failed: tmux -u -S ${escaped(i.socket)} list-panes -t =${escaped(i.session)}:=${escaped(i.name)} -F [^\\n]+\\nno server running on ${escaped(i.socket)}\\n$`);

/** `upload` and `receive` never ask for the session: they store the bytes in the home, whatever its state. */
const uploads = succeeds((result, { i, said }) => {
  const path = join(i.home, ".oats-attachments", "note.txt");
  assert.deepEqual(result, { path, bytes: Buffer.byteLength(NOTE), sha256: NOTE_SHA256, name: "note.txt", home: i.home, source: i.note }, said);
  assert.equal(readFileSync(path, "utf8"), NOTE, `the attachment is in the home: ${said}`);
});
const receives = succeeds((result, { i, said }) => {
  const path = join(i.home, ".oats-attachments", "note.txt");
  assert.deepEqual(result, { path, bytes: Buffer.byteLength(NOTE), sha256: NOTE_SHA256 }, said);
  assert.equal(readFileSync(path, "utf8"), NOTE, `the attachment is in the home: ${said}`);
});
/** A start, or a restart, over a session that does not run: it starts, in the window when that is
 *  still there (`reused: "pane"`), in a new one otherwise (`"new"`). The second start of the home. */
const starts = (reused) => succeeds((result, { i, said, windows }) => {
  assert.equal(typeof result.startedAt, "string", said);
  assert.deepEqual({ ...result, startedAt: "" }, { instance: i.name, agent: "dev", home: i.home, harness: "pi", backend: "tmux", model: null, launchConfig: null, yolo: null,
    target: { backend: "tmux", session: i.session, window: i.name, socket: i.socket }, startedAt: "", restartCount: 2, reused, warnings: [] }, said);
  assert.equal(windows(i.session).includes(i.name), true, `the window is there: ${said}`);
});

const COMMANDS = [
  { id: "attach", argv: (i) => ["session", "attach", "--home", i.home] },
  { id: "inspect", argv: (i) => ["session", "inspect", "--home", i.home] },
  { id: "input", argv: (i) => ["session", "input", "--home", i.home, "--text-file", i.note] },
  { id: "upload", argv: (i) => ["session", "upload", "--home", i.home, "--file", i.note] },
  { id: "receive", argv: (i) => ["session", "receive", "--home", i.home, "--name", "note.txt"], input: NOTE },
  { id: "start", argv: (i) => ["session", "start", "--home", i.home] },
  { id: "restart", argv: (i) => ["session", "restart", "--home", i.home] },
];

/** The states, and what each command answers over each. `attach` refuses `--json` before it looks
 *  at anything, so its JSON answer is the same everywhere and its text answer is the state's. */
const STATES = [
  { id: "a stopped session: the harness has exited, the window is a shell", key: "stopped", make: () => {},
    answers: {
      // The viewer is made and the tmux client is started; it has no terminal here and says so
      // itself. The attach answers the client's status: nothing of the kernel's is on stderr.
      attach: { json: envelope("E_BAD_ARGS", ATTACH_JSON), text: says(1, "open terminal failed: not a terminal\n") },
      inspect: succeeds((result, { i, said }) => {
        assert.match(String(result.paneId), /^%\d+$/, said);
        assert.deepEqual(result, { home: i.home, backend: "tmux", present: true, state: "shell", paneId: result.paneId, waitingOnYou: null }, said);
      }),
      input: refused("E_SESSION_INPUT_FAILED", "cannot submit session input: cannot submit input: session is shell"),
      upload: uploads, receive: receives, start: starts("pane"), restart: starts("pane"),
    } },
  { id: "the window is gone (kill-window)", key: "window", make: (s, i) => s.killWindow(i),
    answers: {
      // The regression of the pull request's first head: a plain Error without a code.
      attach: { json: envelope("E_BAD_ARGS", ATTACH_JSON), text: line("session no longer exists") },
      inspect: succeeds((result, { i, said }) => assert.deepEqual(result, { home: i.home, backend: "tmux", present: false, state: "stopped", waitingOnYou: null }, said)),
      input: refused("E_SESSION_INPUT_FAILED", "cannot submit session input: cannot submit input: session is stopped"),
      upload: uploads, receive: receives, start: starts("new"), restart: starts("new"),
    } },
  { id: "the tmux server is gone (kill-server)", key: "server", make: (s, i) => s.killServer(i),
    answers: {
      // A child process that exited non-zero: an Error without a code too.
      attach: { json: envelope("E_BAD_ARGS", ATTACH_JSON), text: line(noServer()) },
      inspect: refused("E_SESSION_UNAVAILABLE", noServer("cannot inspect session: ")),
      input: refused("E_SESSION_INPUT_FAILED", noServer("cannot submit session input: ")),
      upload: uploads, receive: receives, start: starts("new"), restart: starts("new"),
    } },
];

test("every `oats session` subcommand, over a stopped session, a window that is gone and a tmux server that is gone, in JSON mode and in text mode, answers what main answers: one envelope or one `oats:` line, no stack, no details.cause on a plain refusal (awebai/oats#892)", { skip: NO_TMUX }, async (t) => {
  const s = sessions(t);
  for (const state of STATES) {
    await t.test(`over ${state.id}`, async (st) => {
      for (const command of COMMANDS) {
        for (const mode of ["json", "text"]) {
          await st.test(`session ${command.id}${mode === "json" ? " --json" : ""}`, async () => {
            // A session of its own for every run: a start changes the state it ran over.
            const i = { ...await s.stopped(`${state.key}-${command.id}-${mode}`), note: s.note };
            await state.make(s, i);
            const argv = [...command.argv(i), ...(mode === "json" ? ["--json"] : [])];
            const where = `\`oats ${argv.join(" ")}\` over ${state.id}`;
            const r = s.oats(argv, command.input);
            const doc = held(r, mode, where);
            const said = `${where}\n  exit status: ${r.status}\n  stdout: ${JSON.stringify(r.stdout)}\n  stderr: ${JSON.stringify(r.stderr)}`;
            state.answers[command.id][mode]({ r, doc, i, said, windows: s.windows });
          });
        }
      }
    });
  }
});

test("`oats session attach` in text mode, of an instance whose window is gone, prints exactly `oats: session no longer exists` on stderr; of one whose tmux server is gone, `oats: Command failed: tmux …`: no `Error:` line and no stack (the regression of awebai/oats#892's first head)", { skip: NO_TMUX }, async (t) => {
  const s = sessions(t);

  const gone = await s.stopped("window-gone");
  await s.killWindow(gone);
  const a = s.oats(["session", "attach", "--home", gone.home]);
  const saidA = `\`oats session attach --home ${gone.home}\` with the window gone\n  exit status: ${a.status}\n  stdout: ${JSON.stringify(a.stdout)}\n  stderr: ${JSON.stringify(a.stderr)}`;
  held(a, "text", saidA);
  assert.equal(a.status, 1, saidA);
  assert.equal(a.stdout, "", saidA);
  assert.equal(a.stderr, "oats: session no longer exists\n", `stderr is that line and nothing else: ${saidA}`);

  const lost = await s.stopped("server-gone");
  await s.killServer(lost);
  const b = s.oats(["session", "attach", "--home", lost.home]);
  const saidB = `\`oats session attach --home ${lost.home}\` with the tmux server gone\n  exit status: ${b.status}\n  stdout: ${JSON.stringify(b.stdout)}\n  stderr: ${JSON.stringify(b.stderr)}`;
  held(b, "text", saidB);
  assert.equal(b.status, 1, saidB);
  assert.equal(b.stdout, "", saidB);
  assert.match(b.stderr, new RegExp(`^oats: Command failed: tmux -u -S ${escaped(lost.socket)} list-panes -t =${escaped(lost.session)}:=${escaped(lost.name)} -F [^\\n]+\\nno server running on ${escaped(lost.socket)}\\n\\n$`), `stderr is the failed tmux call, as main prints it, and nothing else: ${saidB}`);
  assert.doesNotMatch(b.stderr, /^Error:/m, saidB);
  assert.equal(hasStack(b.stderr), false, saidB);
});

test("the kernel's own stop leaves a session as the walk's stopped state: the window still there, a shell, read the same as a session whose harness exited by itself", { skip: NO_TMUX }, async (t) => {
  const s = sessions(t);
  const { fx } = s;
  // A stand-in harness that says which process it is and idles until it is signalled.
  const bin = join(fx.base, "idle-bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "pi"), `#!/bin/sh\necho $$ > "$OATS_INSTANCE_HOME/harness.pid"\nexec sleep 600\n`);
  chmodSync(join(bin, "pi"), 0o755);
  const name = "idles";
  const home = await s.spawn(name, `${bin}:${fx.env.PATH}`);
  const harness = () => { try { const text = readFileSync(join(home, "harness.pid"), "utf8").trim(); return /^\d+$/.test(text) && Number(text) > 1 ? Number(text) : null; } catch { return null; } };
  // Whatever a failed assertion leaves: the harness ends before the fixture's cleanup.
  fx.beforeCleanup(() => { const pid = harness(); if (pid !== null && alive(pid)) process.kill(pid, "SIGKILL"); });
  s.start(name, home);
  await waitUntil(() => harness() !== null && alive(harness()), "the stand-in harness to run");
  const pid = harness();

  const stop = (...flags) => s.cli(["instance", "stop", name, ...flags, "--json"]);
  let plan;
  await waitUntil(() => { const r = stop("--plan"); assert.equal(r.status, 0, r.stdout + r.stderr); plan = r.json().result; const session = plan.targets[0].session; return session.present === true && session.state !== "shell"; }, "the session to read as running");
  const applied = stop("--apply", "--plan-revision", plan.planRevision, "--idempotency-key", "k1");
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  assert.deepEqual(applied.json().result.results, [{ instance: name, home, ok: true, stopped: true, alreadyIdle: false, state: "shell" }], "the kernel's stop ended the harness and left a shell");
  await waitUntil(() => !alive(pid), "the stopped harness to have exited");

  const other = await s.stopped("exits");
  const facts = ({ home: _home, paneId, ...rest }) => { assert.match(String(paneId), /^%\d+$/); return rest; };
  assert.deepEqual(facts(s.inspected(home)), { backend: "tmux", present: true, state: "shell", waitingOnYou: null }, "what the kernel's stop leaves");
  assert.deepEqual(facts(s.inspected(other.home)), facts(s.inspected(home)), "a session whose harness exited by itself reads the same");
});

test("the answers of `oats session` that reach no session (a removed subcommand, an unknown one, none, a removed flag) are a kernel code in JSON mode and the same message as one `oats:` line in text mode", async (t) => {
  const fx = v2Deployment({ t });
  const home = join(fx.root, "dev", "instances", "nobody"); // never read: each of these is refused on its arguments
  const USAGE = /^usage: oats session inspect\|input\|attach\|start\|restart\|receive\|upload --home \/absolute\/home .*\[--json\]$/;
  const cases = [
    [["session", "recompose", "--home", home], refused("E_UNKNOWN_COMMAND", 'unknown command "session recompose" — removed by the workspace model v2; use a re-spawn: an instance never changes under itself')],
    [["session", "walk", "--home", home], refused("E_BAD_ARGS", USAGE)],
    [["session"], refused("E_BAD_ARGS", USAGE)],
    [["session", "inspect", "--home", home, "--native-record", "x"], refused("E_BAD_ARGS", "--native-record outcome inspection is gone (the captured/portable path was removed in 0.26)")],
    [["session", "inspect", "--home", "relative/home"], refused("E_BAD_ARGS", "session needs an absolute instance home")],
  ];
  for (const [argv, answer] of cases) {
    for (const mode of ["json", "text"]) {
      const all = [...argv, ...(mode === "json" ? ["--json"] : [])];
      const where = `\`oats ${all.join(" ")}\``;
      const r = fx.cli(all);
      const doc = held(r, mode, where);
      answer[mode]({ r, doc, i: null, said: `${where}\n  exit status: ${r.status}\n  stdout: ${JSON.stringify(r.stdout)}\n  stderr: ${JSON.stringify(r.stderr)}` });
    }
  }
});
