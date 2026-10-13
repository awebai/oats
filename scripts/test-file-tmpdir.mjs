// Preloaded into the process of each test file by the root run (scripts/run-tests.mjs gives it to
// node --test as --import). It gives the file a temporary directory of its own, inside the run's
// directory, before any code of the file runs.
//
// A test file leaves nothing behind (awebai/oats#1025): where a directory is made, its removal is
// registered. The root run reads each file's directory when the run has ended and fails when one
// is not empty. So everything a file makes in a temporary directory has to land in its own:
//   - TMPDIR: os.tmpdir() in the file's process and in every process it starts with its environment;
//   - TMUX_TMPDIR: tmux's default place. A tmux client that runs with no TMUX_TMPDIR of a fixture
//     then makes its socket directory here, where the run sees it, and never reaches a tmux server
//     of the host;
//   - OATS_TEST_TMPDIR: the same directory, for the fixture helpers that go to /tmp when the
//     temporary directory's path is long (test/helpers/host-fixture.mjs fixtureBase).
//
// Only a test file's process takes a directory: node --test names it by NODE_TEST_CONTEXT. A process
// a file starts is not preloaded and inherits the file's directory; one that is preloaded all the
// same (it was given this process's execArgv) keeps the directory it inherited.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";

const run = process.env.OATS_TEST_RUN_DIR;
if (run && process.env.NODE_TEST_CONTEXT && !`${process.env.TMPDIR}${sep}`.startsWith(`${run}${sep}`)) {
  for (let n = 0; ; n++) {
    const dir = join(run, String(n)); // short: a socket path under it has about 104 bytes in all
    try { mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (e.code === "EEXIST") continue; throw e; }
    writeFileSync(join(run, `${n}.file`), process.argv[1] ?? "");
    Object.assign(process.env, { TMPDIR: dir, TMUX_TMPDIR: dir, OATS_TEST_TMPDIR: dir });
    break;
  }
}
