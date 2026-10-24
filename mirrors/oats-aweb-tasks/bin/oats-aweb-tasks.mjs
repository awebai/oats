#!/usr/bin/env node
// Advisory only: no identity reads, aw calls, minting or team membership changes.
// Messaging hooks finish before their metadata is persisted; the skill checks
// the principal when the agent actually starts using tasks.
const event = process.env.OATS_EVENT || process.argv[2];
const brief = "Tasks: aweb tasks, as your oats.aweb identity in its default team (joined teams: `aw --identity-home <home> task …`). Load /aweb-tasks. If `aw whoami` fails, report it to your human and don't use tasks.";
process.stdout.write(JSON.stringify(event === 'spawn'
  ? { brief }
  : { warning: 'oats-aweb-tasks: expected spawn' }) + '\n');
