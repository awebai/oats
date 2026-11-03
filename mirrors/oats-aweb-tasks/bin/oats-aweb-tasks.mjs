#!/usr/bin/env node
// No identity reads, aw calls, minting or team membership changes.
// The spawn brief is advisory: messaging hooks finish before their metadata is
// persisted; the skill checks the principal when the agent starts using tasks.
import { teamSetting } from '../lib/team.mjs';

const event = process.env.OATS_EVENT || process.argv[2];
const defaultBrief = "Tasks: aweb tasks, as your oats.aweb identity in its default team (joined teams: `aw --identity-home <home> task …`). Load /aweb-tasks. If `aw whoami` fails, report it to your human and don't use tasks.";

/** The spawn answer. With `team` absent it is the fixed default brief, byte for
 *  byte. An invalid `team` is refused in the brief itself: the hook is not
 *  required, so a failure would only warn and leave the default-team inject. */
function spawnAnswer() {
  let settings = {};
  if (process.env.OATS_SETTINGS !== undefined) {
    try { settings = JSON.parse(process.env.OATS_SETTINGS); } catch { settings = null; }
  }
  const team = teamSetting(settings);
  if (team.absent) return { brief: defaultBrief };
  if (team.problem) {
    return {
      brief: `Tasks: refused: oats.aweb-tasks ${team.problem}. Don't use tasks; report it to your human.`,
      warning: `oats-aweb-tasks: ${team.problem}; tasks are refused in this home until the tasks: payload names a valid label or drops team`,
    };
  }
  const label = team.label;
  if (label === process.env.OATS_DEFAULT_TEAM) {
    return { brief: `Tasks: aweb tasks in team \`${label}\`, your default team at spawn: plain \`aw task …\` and \`aw work …\`, as your oats.aweb identity. Load /aweb-tasks and follow its "Tasks team" section. If \`aw whoami\` fails, report it to your human and don't use tasks.` };
  }
  return { brief: `Tasks: aweb tasks in team \`${label}\`, never your default team. Load /aweb-tasks and follow its "Tasks team" section: from your instance home, \`oats aweb teams --json\` gives the identity home, \`joined[].identityHome\` where \`label\` is \`${label}\`, and every task command runs as \`aw --identity-home <identityHome> task|work …\`. If \`${label}\` is not joined, report it to your human and don't use tasks.` };
}

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
} else result = event === 'spawn' ? spawnAnswer() : { warning: 'oats-aweb-tasks: expected spawn' };
process.stdout.write(JSON.stringify(result) + '\n');
