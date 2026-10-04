// `processesInHome` answers which live processes work in an instance home, from one `lsof` listing.
// Retire removes a home on an empty answer, so a listing counts only when lsof completed: it exits
// 1 with a full listing when some process could not be read, and that is the one failure whose
// output is used. A scan that was cut off (a timeout, too much output, a signal) is unknown, never
// none, whatever it printed first. Unit tests over the injected exec.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processesInHome } from "../lib/core.mjs";

const home = realpathSync(mkdtempSync(join(tmpdir(), "oats-processes-in-home-")));
test.after(() => rmSync(home, { recursive: true, force: true }));

// What lsof prints first on any host: a process that works outside the home.
const PREFIX = "p1\nR0\ncinit\nn/\n";
const IN_HOME = `p4242\nR1\ncnode\nn${join(home, "work")}\n`;
/** An exec that fails the way execFileSync does: an error carrying what the child printed. */
const failing = (props) => ({ exec: () => { throw Object.assign(new Error("Command failed: lsof"), { stdout: PREFIX, stderr: "", ...props }); } });
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
  assert.deepEqual(scan, { ok: true, processes: [{ pid: 4242, command: "node" }] });
});

test("a listing lsof completed with status 1 is used: no process in the home is none", () => {
  const scan = processesInHome(home, failing({ status: 1, signal: null }));
  assert.deepEqual(scan, { ok: true, processes: [] });
});
