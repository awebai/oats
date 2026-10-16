// Qualification Q1d (#1108 checkpoint Q): first capture, first upgrade and no-op
// of one outgoing release beside this head, on the same synthetic home (1,300
// streams), the same runner and the same run. One file per outgoing release
// keeps each within the runner's 20-minute bound. Every version does, from an
// empty root of its own: (a) a first capture, (b) dropDerived then a capture
// again, a first upgrade over its own journals, (c) a no-op capture. Each step
// runs that version's CLI. This head's CLI repeats a step while its bounded pass
// reports partial; an outgoing CLI runs one unbounded invocation. This head also
// runs the same steps through measured passes for the counts. Assertions cover
// this head only; an outgoing release's failure is reported as a finding.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { readCaptureStatus } from "../../lib/capture-status.mjs";
import { REPORT_MARGIN_MS, TEST_TIMEOUT_MS, cliCapture, dropDerived, headCli, installRelease, journalBytes, measuredPass, passReserveMs,
  passRow, realManagerSkip, report, runnerFacts, scratch, syntheticHome, table, untilComplete } from "./qualify.mjs";

const STREAMS = 1300;
// A head pass may run to its 300 s deadline once started; nothing starts
// without that reserve before the test's end.
const PASS_RESERVE_MS = passReserveMs();
const STEPS = ["first capture", "first upgrade", "no-op"];
const tail = text => (text ?? "").trim().split("\n").slice(-3).join("\n").slice(-600);
// Killed at what the test has left, so an unbounded outgoing invocation cannot
// outlive the test's bound.
const capture = (cli, root, home, timeoutMs) => cliCapture(cli, root, home, [], { timeoutMs, killSignal: "SIGKILL" });

/** Registers the comparison of the published `version` with this head. */
export function outgoingComparison(version) {
  const skip = realManagerSkip("linux") ?? false;
  test(`Q1d v${version} beside this head: first capture, first upgrade and no-op over ${STREAMS} streams`, { skip, timeout: TEST_TIMEOUT_MS }, async t => {
    const began = performance.now(), end = began + TEST_TIMEOUT_MS - REPORT_MARGIN_MS, left = () => end - performance.now(), base = scratch(t, `qualify-outgoing-${version}-`);
    const roots = { head: join(base, "record-head"), old: join(base, `record-v${version}`), measured: join(base, "record-head-measured") };
    fs.mkdirSync(roots.head);
    runnerFacts(t, { root: roots.head, scratch: base });
    const release = installRelease(base, version);
    report(t, "outgoing-release", release);
    const synthetic = syntheticHome(base, { streams: STREAMS });
    report(t, "outgoing-home", { streams: STREAMS, homeBytes: synthetic.bytes, sessions: synthetic.sessions.length });

    const rows = [];
    const step = (label, root, name, invocations) => {
      const last = invocations.at(-1), journals = journalBytes(root);
      const row = { version: label, step: name, invocations: invocations.length, wallMs: invocations.reduce((a, r) => a + r.wallMs, 0),
        exit: last.status, signal: last.signal ?? "", timedOut: last.timedOut, outcome: label === "head" ? readCaptureStatus(root)?.lastRun?.outcome ?? null : "",
        journalStreams: journals.streams, journalBytes: journals.bytes };
      report(t, "outgoing-step", { ...row, exits: invocations.map(r => r.status), stdoutTail: tail(last.stdout), stderrTail: tail(last.stderr) });
      rows.push(row); return { row, invocations };
    };
    // This head first: its steps are the asserted ones.
    const headSteps = [];
    for (const name of STEPS) {
      if (name === "first upgrade") dropDerived(roots.head);
      const invocations = [];
      do invocations.push(capture(headCli, roots.head, synthetic.home, left()));
      while (invocations.at(-1).status === 0 && readCaptureStatus(roots.head)?.lastRun?.outcome === "partial" && left() > PASS_RESERVE_MS);
      headSteps.push(step("head", roots.head, name, invocations));
    }
    for (const name of STEPS) {
      if (name === "first upgrade") dropDerived(roots.old);
      step(`v${version}`, roots.old, name, [capture(release.cli, roots.old, synthetic.home, left())]);
    }
    table(t, `Q1d v${version} and this head, CLI side by side (wallMs summed over invocations)`,
      STEPS.flatMap(name => rows.filter(r => r.step === name)));

    // The counts of this head's steps, through the measurement worker.
    const measured = [];
    for (const name of STEPS) {
      if (left() <= PASS_RESERVE_MS) { report(t, "outgoing-measured", { step: name, ran: false, reason: "file bound", leftMs: Math.round(left()) }); continue; }
      if (name === "first upgrade") dropDerived(roots.measured);
      const passes = name === "no-op" ? [await measuredPass(roots.measured, synthetic.home)]
        : (await untilComplete(roots.measured, synthetic.home, { budgetMs: left() })).passes;
      for (const [i, pass] of passes.entries()) {
        const row = passRow(`${name} pass ${i + 1}`, pass);
        report(t, "outgoing-measured", { step: name, ran: true, ...row }); measured.push(row);
      }
    }
    table(t, "Q1d this head, measured passes", measured);

    for (const { row, invocations } of headSteps) {
      assert.deepEqual(invocations.map(r => r.status), invocations.map(() => 0), `head ${row.step}: exits ${JSON.stringify(invocations.map(r => [r.status, r.signal, r.timedOut]))}`);
      assert.equal(row.outcome, "complete", `head ${row.step} did not complete within the bound: ${row.invocations} invocations in ${row.wallMs} ms, journals ${row.journalStreams} streams ${row.journalBytes} bytes`);
    }
  });
}
