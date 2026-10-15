// Preloaded into the process of each test file by the root run (scripts/run-tests.mjs gives it to
// node --test as --import). It gives the file a temporary directory of its own, inside the run's
// directory, before any code of the file runs.
//
// A test file leaves nothing behind (awebai/oats#1025): where a directory is made, its removal is
// registered. The root run reads each file's directory when the run has ended and fails when one
// is not empty. So everything a file makes in a temporary directory has to land in its own:
//   - TMPDIR: os.tmpdir() in the file's process and in every process it starts with its environment;
//   - TMUX_TMPDIR: tmux's default place. A tmux client that runs with no TMUX_TMPDIR of a fixture
//     then makes its socket directory here, where the run sees it, instead of reaching the host's
//     default server. TMUX is left as it is: a client that names no server (no -L or -S) and
//     inherits TMUX still uses that session's server, and makes nothing here.
// Beside the directory, <n>.file names the test file. The run reads it to name the file, and the
// fixture helpers that go to /tmp when the temporary directory's path is long know the directory by
// it and by its shape, and use it all the same (test/helpers/host-fixture.mjs fixtureParent).
//
// Only a test file's process takes a directory: node --test names it by NODE_TEST_CONTEXT. A process
// a file starts is not preloaded and inherits the file's directory; one that is preloaded all the
// same (it was given this process's execArgv) keeps the directory it inherited.
//
// OATS_TEST_RUN_DIR, which names the run's directory, is how the run reaches this preload, and no test
// sees it: a test file's process takes it out of its environment before any code of the file runs, so
// no process the file starts inherits it either (a test that compares a whole environment, or the
// OATS_ variables of one, sees the environment it was given). node --test's own process keeps it:
// that process starts the files.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";

const run = process.env.OATS_TEST_RUN_DIR;
if (process.env.NODE_TEST_CONTEXT) delete process.env.OATS_TEST_RUN_DIR;
if (run && process.env.NODE_TEST_CONTEXT && !`${process.env.TMPDIR}${sep}`.startsWith(`${run}${sep}`)) {
  for (let n = 0; ; n++) {
    const dir = join(run, String(n)); // short: a socket path under it has about 104 bytes in all
    try { mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (e.code === "EEXIST") continue; throw e; }
    writeFileSync(join(run, `${n}.file`), process.argv[1] ?? "");
    Object.assign(process.env, { TMPDIR: dir, TMUX_TMPDIR: dir });
    break;
  }
}
