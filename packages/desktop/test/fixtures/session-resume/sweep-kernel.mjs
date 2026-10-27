// A stand-in `oats session resume --json` (session-resume-cli.test.mjs, the default exec end to end). It answers by
// SWEEP_FIXTURE: `ok` prints the sweep's envelope, with what it was run with under `result.seen`, and exits 0;
// `busy` prints E_RESUME_BUSY, says something on stderr and exits 1.
const seen = { argv: process.argv.slice(2), cwd: process.cwd(), instanceHome: process.env.OATS_INSTANCE_HOME ?? null, homeDir: process.env.OATS_HOME_DIR ?? null };
if (process.env.SWEEP_FIXTURE === 'busy') {
  process.stderr.write('stderr noise that must not reach a result\n');
  process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: false, error: { code: 'E_RESUME_BUSY', message: 'Another sweep is running.' } }));
  process.exitCode = 1;
} else {
  process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: true, result: { schemaVersion: 1, plan: false, deployments: [], rows: [], seen } }));
}
