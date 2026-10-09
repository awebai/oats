// `processesInHome` answers which live processes work in an instance home, from one scan of the
// host: /proc on Linux, else one `lsof` listing (#625). Retire removes a home on an empty answer, so a
// scan counts only when it completed. lsof exits 1 with a full listing when some process could not
// be read, and that is the one failure whose output is used. A scan that was cut off (a timeout, too
// much output, a signal) is unknown, never none, whatever it printed first. So is a listing with no
// process row at all: a real lsof always lists at least itself and its caller, a real /proc at least
// this process. Unit tests over the injected exec (lsof) and an injected /proc root, a real /proc
// scan on Linux, and doctor's line for a host with neither.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { observeSessionWithoutReceipt, processesInHome, processScanAvailability, processScanInformation } from "../lib/core.mjs";
import { fixtureBase, waitUntil } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const base = fixtureBase("oats-pih-");
const home = join(base, "home");
mkdirSync(join(home, "work"), { recursive: true });
test.after(() => { chmodSync(base, 0o700); rmSync(base, { recursive: true, force: true }); });
const ROOT = process.getuid?.() === 0;

// What lsof prints first on any host: a process that works outside the home.
const PREFIX = "p1\nR0\ncinit\nn/\n";
// A process that works in the home. The scan leaves out this process and its children, so the row's
// pid and parent pid are ones this test's own process cannot have.
const PID = process.pid + 1;
const IN_HOME = `p${PID}\nR${process.pid + 2}\ncnode\nn${join(home, "work")}\n`;
/** An exec that fails the way execFileSync does: an error carrying what the child printed. */
const failing = (props) => ({ exec: () => { throw Object.assign(new Error("Command failed: lsof"), { stdout: PREFIX, stderr: "", ...props }); } });
/** An exec that succeeds, as execFileSync does when the child exits 0: what the child printed. */
const printing = (stdout) => ({ exec: () => stdout });
function unknown(io, why) {
  const scan = processesInHome(home, io);
  assert.equal(scan.ok, false, JSON.stringify(scan));
  assert.match(scan.error, why);
  assert.equal(/init|p1/.test(scan.error), false, "the error says what happened, never a line of the listing");
  assert.equal("processes" in scan, false);
}

test("a scan that timed out is unknown, whatever it printed first", () => {
  unknown(failing({ code: "ETIMEDOUT", status: null, signal: "SIGTERM" }), /timed out/);
});

test("a scan whose output was too large is unknown, whatever it printed first", () => {
  unknown(failing({ code: "ENOBUFS", status: null, signal: "SIGTERM" }), /more output than/);
});

test("a scan ended by a signal is unknown, whatever it printed first", () => {
  unknown(failing({ status: null, signal: "SIGKILL" }), /ended by SIGKILL/);
});

test("a scan that exited with a status other than 1 is unknown, whatever it printed first", () => {
  unknown(failing({ status: 2, signal: null }), /Command failed/);
});

test("a scan that timed out while lsof exited 1 by itself is still unknown", () => {
  unknown(failing({ code: "ETIMEDOUT", status: 1, signal: null }), /timed out/);
});

test("a listing lsof completed with status 1 is used: a process in the home is named by pid and program", () => {
  const scan = processesInHome(home, failing({ status: 1, signal: null, stdout: PREFIX + IN_HOME }));
  assert.deepEqual(scan, { ok: true, processes: [{ pid: PID, command: "node" }] });
});

test("a listing lsof completed with status 1 is used: no process in the home is none", () => {
  const scan = processesInHome(home, failing({ status: 1, signal: null }));
  assert.deepEqual(scan, { ok: true, processes: [] });
});

test("a scan that exited 0 and printed nothing is unknown: a listing has at least one process", () => {
  unknown(printing(""), /^lsof listed no process$/);
});

test("a scan that exited 0 and printed no process row is unknown", () => {
  unknown(printing("lsof: a wrapper that lists nothing\nn/\n"), /^lsof listed no process$/);
});

test("a listing lsof completed with status 0 is used, with a process in the home and with none", () => {
  assert.deepEqual(processesInHome(home, printing(PREFIX + IN_HOME)), { ok: true, processes: [{ pid: PID, command: "node" }] });
  assert.deepEqual(processesInHome(home, printing(PREFIX)), { ok: true, processes: [] });
});

// ---- /proc (#625) ---------------------------------------------------------------------------------

/** A fake /proc: one directory per pid with its `cwd` link, `comm` and `stat`, as Linux lays them out. */
function procTree(name, rows) {
  const root = join(base, name);
  mkdirSync(root);
  for (const { pid, cwd, comm = "sleep", ppid = 1, files = true } of rows) {
    const dir = join(root, String(pid));
    mkdirSync(dir);
    if (!files) continue;
    symlinkSync(cwd, join(dir, "cwd"));
    writeFileSync(join(dir, "comm"), `${comm}\n`);
    // The command sits in parentheses and may hold any byte, ")" and spaces included: the ppid is read after the last ")".
    writeFileSync(join(dir, "stat"), `${pid} (${comm}) S ${ppid} ${pid} ${pid} 0 -1 4194560 0 0 0 0\n`);
  }
  // Entries that are not pids are not processes.
  writeFileSync(join(root, "uptime"), "1.0 1.0\n");
  mkdirSync(join(root, "self"));
  return root;
}
const OTHER = process.pid + 1000;

test("/proc: a process in the home is found by pid and program, one outside is not, and a command with a parenthesis is read whole", () => {
  const root = procTree("proc-basic", [
    { pid: OTHER, cwd: join(home, "work"), comm: "har) ness" },
    { pid: OTHER + 1, cwd: base },
    { pid: OTHER + 2, cwd: "/" },
  ]);
  assert.deepEqual(processesInHome(home, { procRoot: root }), { ok: true, processes: [{ pid: OTHER, command: "har) ness" }] });
});

test("/proc: a pid that vanished is skipped, and an unreadable cwd is not seen, without failing the scan", (t) => {
  const root = procTree("proc-partial", [
    { pid: OTHER, cwd: home },
    { pid: OTHER + 1, files: false }, // ended between the listing and the reads: its files are gone
    { pid: OTHER + 2, cwd: home },
  ]);
  if (ROOT) t.diagnostic("running as root: a mode-000 directory is still readable, so the unreadable cwd is not exercised");
  else chmodSync(join(root, String(OTHER + 2)), 0o000); // another user's process, or a non-dumpable one
  try {
    const scan = processesInHome(home, { procRoot: root });
    assert.deepEqual(scan, { ok: true, processes: ROOT ? [{ pid: OTHER, command: "sleep" }, { pid: OTHER + 2, command: "sleep" }] : [{ pid: OTHER, command: "sleep" }] });
  } finally { chmodSync(join(root, String(OTHER + 2)), 0o700); }
});

test("/proc: a cwd the kernel reports deleted still counts as in the home", () => {
  const root = procTree("proc-deleted", [{ pid: OTHER, cwd: `${home} (deleted)` }, { pid: OTHER + 1, cwd: `${join(home, "work", "gone")} (deleted)` }]);
  assert.deepEqual(processesInHome(home, { procRoot: root }).processes.map((p) => p.pid).sort(), [OTHER, OTHER + 1]);
});

test("/proc: this process and its direct children are left out, as with lsof", () => {
  const root = procTree("proc-self", [
    { pid: process.pid, cwd: home, comm: "node", ppid: process.ppid },
    { pid: OTHER, cwd: home, ppid: process.pid },
    { pid: OTHER + 1, cwd: home, ppid: OTHER },
  ]);
  assert.deepEqual(processesInHome(home, { procRoot: root }), { ok: true, processes: [{ pid: OTHER + 1, command: "sleep" }] });
});

test("/proc: a root that cannot be read fails the scan, never an empty answer, and so does one that lists no process", (t) => {
  const missing = processesInHome(home, { procRoot: join(base, "no-proc") });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /no-proc cannot be read \(ENOENT\)$/);
  const empty = procTree("proc-empty", []);
  assert.deepEqual(processesInHome(home, { procRoot: empty }), { ok: false, error: `${empty} listed no process` });
  if (ROOT) { t.diagnostic("running as root: a mode-000 directory is still readable"); return; }
  const locked = procTree("proc-locked", [{ pid: OTHER, cwd: base }]);
  chmodSync(locked, 0o000);
  try {
    const scan = processesInHome(home, { procRoot: locked });
    assert.equal(scan.ok, false);
    assert.match(scan.error, /proc-locked cannot be read \(EACCES\)$/);
  } finally { chmodSync(locked, 0o700); }
});

test("/proc on this host (Linux): a reparented grandchild working in the home is found", { skip: process.platform !== "linux" && "the host's /proc is read on Linux only; elsewhere the scan is lsof's" }, async () => {
  assert.equal(processScanAvailability().mechanism, "proc", "a Linux host reads its own /proc");
  const pid = Number(execFileSync("sh", ["-c", '(cd "$1" && exec sleep 600) >/dev/null 2>&1 & echo $!', "sh", join(home, "work")], { encoding: "utf8" }).trim());
  try {
    await waitUntil(() => processesInHome(home).processes?.some((p) => p.pid === pid), `pid ${pid} working in the home`);
    const scan = processesInHome(home);
    assert.equal(scan.ok, true);
    assert.deepEqual(scan.processes.filter((p) => p.pid === pid), [{ pid, command: "sleep" }]);
  } finally { process.kill(pid, "SIGKILL"); }
  await waitUntil(() => !processesInHome(home).processes.some((p) => p.pid === pid), `pid ${pid} gone`);
});

test("a home without its session receipt is not observably absent when the scan cannot run: retire refuses it as ambiguous", () => {
  const seen = observeSessionWithoutReceipt(home, { launched: false }, { procRoot: join(base, "no-proc") });
  assert.equal(seen.absent, false);
  assert.match(seen.note, /^could not scan for a process working in this home \(.*no-proc cannot be read \(ENOENT\)\)$/);
});

// ---- doctor ---------------------------------------------------------------------------------------

test("doctor's line for a host with no process scan names why and what it blocks; none where a scan runs", () => {
  assert.deepEqual(processScanInformation({ mechanism: null, error: "this host has no /proc to read (it is not Linux), and lsof is not on PATH" }), [
    "process-scan-unavailable: this host has no /proc to read (it is not Linux), and lsof is not on PATH; retire refuses where it must rule out a live process in an instance home (a home without its session receipt, a missing recorded tmux socket, a Herdr home), and session start/stop refuse when a recorded tmux socket is missing; install lsof",
  ]);
  assert.deepEqual(processScanInformation({ mechanism: "proc" }), []);
  assert.deepEqual(processScanInformation({ mechanism: "lsof" }), []);
});

test("doctor on a host with a process scan: no process-scan line, in JSON and text, and the JSON keys are unchanged", () => {
  assert.ok(processScanAvailability().mechanism, "this host offers a scan (/proc, or lsof: a prerequisite of the suite)");
  const fx = v2Deployment();
  try {
    const r = fx.cli(["doctor", "--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const doctor = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(doctor), ["schemaVersion", "workspaceApi", "context", "workspace", "workspaceError", "lockFile", "packages", "lockError", "information", "warnings"]);
    assert.equal(doctor.information.some((line) => line.startsWith("process-scan-unavailable")), false, JSON.stringify(doctor.information));
    const text = fx.cli(["doctor"]);
    assert.equal(text.status, 0, text.stdout + text.stderr);
    assert.doesNotMatch(text.stdout, /process-scan-unavailable/);
  } finally { fx.cleanup(); }
});
