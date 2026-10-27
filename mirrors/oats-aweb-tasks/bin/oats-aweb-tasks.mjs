#!/usr/bin/env node
// No identity reads, aw calls, minting or team membership changes.
// The spawn brief is advisory: messaging hooks finish before their metadata is
// persisted; the skill checks the principal when the agent starts using tasks.
const event = process.env.OATS_EVENT || process.argv[2];
const brief = "Tasks: aweb tasks, as your oats.aweb identity in its default team (joined teams: `aw --identity-home <home> task …`). Load /aweb-tasks. If `aw whoami` fails, report it to your human and don't use tasks.";
let result;
if (event === 'upgrade') {
  // Spawn records no state: adoption needs only the supplied metadata, never home or host reads.
  if (process.env.OATS_UPGRADE_PHASE === 'plan') result = { adopt: true };
  else if (process.env.OATS_UPGRADE_PHASE === 'apply') {
    try { result = { meta: JSON.parse(process.env.OATS_META || '{}') }; }
    catch { process.stderr.write('oats-aweb-tasks: OATS_META must be valid JSON\n'); process.exit(1); }
  } else {
    process.stderr.write('oats-aweb-tasks: OATS_UPGRADE_PHASE must be plan or apply\n'); process.exit(1);
  }
} else result = event === 'spawn' ? { brief } : { warning: 'oats-aweb-tasks: expected spawn' };
process.stdout.write(JSON.stringify(result) + '\n');
