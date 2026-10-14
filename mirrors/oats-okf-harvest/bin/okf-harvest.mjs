#!/usr/bin/env node
// A required spawn hook checks live/retired provenance and snapshots the
// submitted proposal and named evidence into this harvester's home. Judging
// and publishing remain the model's procedure, not delivery commands.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotSource } from '../lib/source-snapshot.mjs';
export { checkSource } from '../lib/source-snapshot.mjs';

const HELP = `oats.okf-harvest 5.0 has no commands of its own: a harvester follows the
knowledge-harvest skill (read its verified harvest-source snapshot,
judge, publish one labelled PR with git and gh, hand over and retire on success
or nothing promotable; publication failure retains the live home and reports
the error without retiring).
oats okf-harvest complete | harvest-status   removed in 5.0 (E_REMOVED)
`;
export const REMOVED = 'was removed in oats.okf 5.0: there are no harvest runs, custody or delivery to complete. A 5.0 harvester judges the proposal in its TASK.md and opens the PR itself (skill knowledge-harvest). A 4.x TASK (one naming a source descriptor and a run) cannot be processed by 5.0: report it to your operator and retire; nothing was delivered';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), event = process.env.OATS_EVENT || args[0];
  if (event === 'spawn') {
    // No meta: only instance-home files, removed with a rolled-back spawn.
    // Reporting external state would quarantine a failure in a later hook.
    try {
      snapshotSource({ task: process.env.OATS_TASK, deployment: process.env.OATS_WORKSPACE, home: process.env.OATS_INSTANCE_HOME || process.env.OATS_HOME });
      process.stdout.write('{}\n');
    } catch (e) {
      process.stdout.write(JSON.stringify({ warning: `oats-okf-harvest ${e.code || 'E_SOURCE'}: ${e.message}` }) + '\n');
      process.exitCode = 1;
    }
  } else if (!event || args.includes('--help') || args.includes('-h')) process.stdout.write(HELP);
  else {
    const error = ['complete', 'harvest-status'].includes(event)
      ? { code: 'E_REMOVED', message: `oats okf-harvest ${event} ${REMOVED}` }
      : { code: 'E_USAGE', message: `unknown command ${event}; see --help` };
    if (args.includes('--json')) process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: false, error }) + '\n');
    else process.stderr.write(`oats okf-harvest ${event}: ${error.code}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
